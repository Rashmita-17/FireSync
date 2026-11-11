from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, Query, HTTPException, UploadFile, File, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import func, and_
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.config import settings
from app.models.observation import Observation
from app.schemas.observation import ObservationResponse
from app.schemas.harmonization import (
    BoundingBox,
    HarmonizationRequest,
    HarmonizationResponse,
    HarmonizedCluster,
)
from app.services.clustering import SpatioTemporalClusteringEngine
from app.services.ingestion import ingestion_service
from app.services.exporter import export_service

router = APIRouter()


def _query_filtered_observations(
    db: Session,
    bbox: BoundingBox,
    start_datetime: Optional[datetime] = None,
    end_datetime: Optional[datetime] = None,
    instruments: Optional[List[str]] = None,
    min_confidence: float = 0.0,
) -> List[Observation]:
    """
    Helper to query observations within geographic bounding box.
    1. Parses and normalizes coordinate orders (detects and fixes swapped Lon/Lat vs Lat/Lon).
    2. Supports both PostGIS geometries and standard SQLAlchemy (latitude, longitude) indices.
    3. Fetches all historical fire data regardless of current date (date filtering widened/disabled).
    """
    # 1. Parse and sanitize coordinate ordering (Lon/Lat vs Lat/Lon defensive detection)
    lats = [bbox.min_lat, bbox.max_lat]
    lons = [bbox.min_lon, bbox.max_lon]

    # Latitude cannot exceed [-90, 90] in EPSG:4326
    if any(abs(l) > 90.0 for l in lats):
        lats, lons = lons, lats
    elif all(l < 0 for l in lats) and all(l > 0 for l in lons):
        lats, lons = lons, lats

    lat_min, lat_max = min(lats), max(lats)
    lon_min, lon_max = min(lons), max(lons)

    # 2. Sanitize confidence threshold
    conf_val = float(min_confidence) if isinstance(min_confidence, (int, float)) else 0.0

    # 3. Build spatial bounding box filter
    spatial_filters = [
        Observation.latitude >= lat_min,
        Observation.latitude <= lat_max,
        Observation.longitude >= lon_min,
        Observation.longitude <= lon_max,
        Observation.confidence >= conf_val,
    ]

    # If the model has a PostGIS geometry column, apply ST_MakeEnvelope in (Lon, Lat) order:
    # PostGIS convention: ST_MakeEnvelope(xmin, ymin, xmax, ymax, srid) -> (lon_min, lat_min, lon_max, lat_max, 4326)
    if hasattr(Observation, "geometry") and getattr(Observation, "geometry") is not None:
        spatial_filters.append(
            func.ST_Within(
                getattr(Observation, "geometry"),
                func.ST_MakeEnvelope(lon_min, lat_min, lon_max, lat_max, 4326)
            )
        )

    query = db.query(Observation).filter(and_(*spatial_filters))

    # 4. Instrument filter (if explicitly passed)
    if instruments and isinstance(instruments, list):
        upper_insts = [str(i).strip().upper() for i in instruments]
        query = query.filter(Observation.instrument.in_(upper_insts))

    # NOTE: Date filtering is intentionally disabled/widened to ensure all historical
    # satellite fire records inside the bounding box are fetched, regardless of date.
    return query.order_by(Observation.acq_datetime.asc()).all()


@router.get("/health", summary="Service Health and Engine Status")
def health_check(db: Session = Depends(get_db)):
    """Healthcheck endpoint verifying DB connectivity and record counts."""
    total_records = db.query(func.count(Observation.id)).scalar() or 0
    return {
        "status": "healthy",
        "service": settings.PROJECT_NAME,
        "database_records": total_records,
        "clustering_engine": "sklearn.cluster.HDBSCAN",
        "supported_sensors": ["MODIS (Terra, Aqua)", "VIIRS (Suomi-NPP, NOAA-20, NOAA-21)"]
    }


@router.get("/stats", summary="Dataset Overview and Sensor Breakdown")
def get_dataset_stats(db: Session = Depends(get_db)):
    """Provides high-level dataset metrics, sensor counts, and temporal coverage."""
    total = db.query(func.count(Observation.id)).scalar() or 0
    modis_count = db.query(func.count(Observation.id)).filter(Observation.instrument == "MODIS").scalar() or 0
    viirs_count = db.query(func.count(Observation.id)).filter(Observation.instrument == "VIIRS").scalar() or 0
    
    min_date = db.query(func.min(Observation.acq_datetime)).scalar()
    max_date = db.query(func.max(Observation.acq_datetime)).scalar()
    total_frp = db.query(func.sum(Observation.frp)).scalar() or 0.0

    return {
        "total_observations": total,
        "modis_observations": modis_count,
        "viirs_observations": viirs_count,
        "sensor_ratio_viirs": round(viirs_count / max(1, total), 3),
        "earliest_observation_utc": min_date.isoformat() if min_date else None,
        "latest_observation_utc": max_date.isoformat() if max_date else None,
        "total_historical_frp_mw": round(float(total_frp), 2),
    }


@router.get(
    "/harmonize",
    response_model=HarmonizationResponse,
    summary="Harmonize MODIS and VIIRS detections across space and time (GET)"
)
def harmonize_get(
    min_lon: float = Query(..., description="Bounding Box West Lon"),
    min_lat: float = Query(..., description="Bounding Box South Lat"),
    max_lon: float = Query(..., description="Bounding Box East Lon"),
    max_lat: float = Query(..., description="Bounding Box North Lat"),
    start_datetime: Optional[datetime] = Query(None, description="Start date/time UTC"),
    end_datetime: Optional[datetime] = Query(None, description="End date/time UTC"),
    spatial_bandwidth_km: float = Query(settings.DEFAULT_SPATIAL_BANDWIDTH_KM, gt=0.0, le=50.0),
    temporal_bandwidth_hours: float = Query(settings.DEFAULT_TEMPORAL_BANDWIDTH_HOURS, gt=0.0, le=168.0),
    min_cluster_size: int = Query(settings.DEFAULT_MIN_CLUSTER_SIZE, ge=2),
    min_samples: int = Query(settings.DEFAULT_MIN_SAMPLES, ge=1),
    cluster_selection_epsilon: float = Query(settings.DEFAULT_CLUSTER_EPSILON, ge=0.0),
    min_confidence: float = Query(0.0, ge=0.0, le=100.0),
    include_observations: bool = Query(False),
    include_noise: bool = Query(False),
    db: Session = Depends(get_db),
):
    """
    Spatio-Temporal Harmonization endpoint via GET query parameters.
    Clusters MODIS and VIIRS satellite detections within the bounding box so that
    sensor differences in spatial resolution (1km vs 375m) and overpass timing are resolved.
    """
    bbox = BoundingBox(min_lon=min_lon, min_lat=min_lat, max_lon=max_lon, max_lat=max_lat)
    
    observations = _query_filtered_observations(
        db=db,
        bbox=bbox,
        start_datetime=start_datetime,
        end_datetime=end_datetime,
        min_confidence=min_confidence,
    )

    # Parameter sanitization for direct Python invocations
    s_bandwidth = spatial_bandwidth_km if isinstance(spatial_bandwidth_km, (int, float)) else settings.DEFAULT_SPATIAL_BANDWIDTH_KM
    t_bandwidth = temporal_bandwidth_hours if isinstance(temporal_bandwidth_hours, (int, float)) else settings.DEFAULT_TEMPORAL_BANDWIDTH_HOURS
    c_size = min_cluster_size if isinstance(min_cluster_size, int) else settings.DEFAULT_MIN_CLUSTER_SIZE
    c_samples = min_samples if isinstance(min_samples, int) else settings.DEFAULT_MIN_SAMPLES
    c_eps = cluster_selection_epsilon if isinstance(cluster_selection_epsilon, (int, float)) else settings.DEFAULT_CLUSTER_EPSILON
    inc_obs = include_observations if isinstance(include_observations, bool) else False
    inc_noise = include_noise if isinstance(include_noise, bool) else False

    engine = SpatioTemporalClusteringEngine(
        spatial_bandwidth_km=s_bandwidth,
        temporal_bandwidth_hours=t_bandwidth,
        min_cluster_size=c_size,
        min_samples=c_samples,
        cluster_selection_epsilon=c_eps,
    )

    return engine.harmonize(
        observations=observations,
        query_bbox=bbox,
        include_observations=inc_obs,
        include_noise=inc_noise,
    )


@router.post(
    "/harmonize",
    response_model=HarmonizationResponse,
    summary="Harmonize MODIS and VIIRS detections across space and time (POST)"
)
def harmonize_post(
    payload: HarmonizationRequest,
    db: Session = Depends(get_db),
):
    """
    Spatio-Temporal Harmonization endpoint accepting a structured JSON payload with
    bounding box, temporal filters, and HDBSCAN hyperparameters.
    """
    observations = _query_filtered_observations(
        db=db,
        bbox=payload.bbox,
        start_datetime=payload.start_datetime,
        end_datetime=payload.end_datetime,
        instruments=payload.instruments,
        min_confidence=payload.min_confidence,
    )

    engine = SpatioTemporalClusteringEngine(
        spatial_bandwidth_km=payload.spatial_bandwidth_km,
        temporal_bandwidth_hours=payload.temporal_bandwidth_hours,
        min_cluster_size=payload.min_cluster_size,
        min_samples=payload.min_samples,
        cluster_selection_epsilon=payload.cluster_selection_epsilon,
    )

    return engine.harmonize(
        observations=observations,
        query_bbox=payload.bbox,
        include_observations=payload.include_observations,
        include_noise=payload.include_noise,
    )


@router.get(
    "/export",
    summary="Download harmonized clusters as a standardized scientific CSV (GET)"
)
def export_harmonized_csv_get(
    min_lon: float = Query(..., description="Bounding Box West Lon"),
    min_lat: float = Query(..., description="Bounding Box South Lat"),
    max_lon: float = Query(..., description="Bounding Box East Lon"),
    max_lat: float = Query(..., description="Bounding Box North Lat"),
    start_datetime: Optional[datetime] = Query(None),
    end_datetime: Optional[datetime] = Query(None),
    spatial_bandwidth_km: float = Query(settings.DEFAULT_SPATIAL_BANDWIDTH_KM, gt=0.0),
    temporal_bandwidth_hours: float = Query(settings.DEFAULT_TEMPORAL_BANDWIDTH_HOURS, gt=0.0),
    min_cluster_size: int = Query(settings.DEFAULT_MIN_CLUSTER_SIZE, ge=2),
    min_samples: int = Query(settings.DEFAULT_MIN_SAMPLES, ge=1),
    cluster_selection_epsilon: float = Query(settings.DEFAULT_CLUSTER_EPSILON, ge=0.0),
    min_confidence: float = Query(0.0, ge=0.0, le=100.0),
    db: Session = Depends(get_db),
):
    """
    Executes spatio-temporal harmonization and streams a downloadable CSV report.
    Compatible with GIS tools (QGIS, ArcGIS) and data science environments.
    """
    bbox = BoundingBox(min_lon=min_lon, min_lat=min_lat, max_lon=max_lon, max_lat=max_lat)

    observations = _query_filtered_observations(
        db=db,
        bbox=bbox,
        start_datetime=start_datetime,
        end_datetime=end_datetime,
        min_confidence=min_confidence,
    )

    # Parameter sanitization for direct Python invocations
    s_bandwidth = spatial_bandwidth_km if isinstance(spatial_bandwidth_km, (int, float)) else settings.DEFAULT_SPATIAL_BANDWIDTH_KM
    t_bandwidth = temporal_bandwidth_hours if isinstance(temporal_bandwidth_hours, (int, float)) else settings.DEFAULT_TEMPORAL_BANDWIDTH_HOURS
    c_size = min_cluster_size if isinstance(min_cluster_size, int) else settings.DEFAULT_MIN_CLUSTER_SIZE
    c_samples = min_samples if isinstance(min_samples, int) else settings.DEFAULT_MIN_SAMPLES
    c_eps = cluster_selection_epsilon if isinstance(cluster_selection_epsilon, (int, float)) else settings.DEFAULT_CLUSTER_EPSILON

    engine = SpatioTemporalClusteringEngine(
        spatial_bandwidth_km=s_bandwidth,
        temporal_bandwidth_hours=t_bandwidth,
        min_cluster_size=c_size,
        min_samples=c_samples,
        cluster_selection_epsilon=c_eps,
    )

    result = engine.harmonize(observations=observations, query_bbox=bbox)

    timestamp_str = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    filename = f"harmonized_modis_viirs_events_{timestamp_str}.csv"

    return StreamingResponse(
        export_service.clusters_to_csv_stream(result.clusters),
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            "X-Total-Clusters": str(len(result.clusters)),
            "X-Total-Observations": str(result.summary.total_observations),
        }
    )


@router.post(
    "/export",
    summary="Download harmonized clusters as a standardized scientific CSV (POST)"
)
def export_harmonized_csv_post(
    payload: HarmonizationRequest,
    db: Session = Depends(get_db),
):
    """
    Executes spatio-temporal harmonization via POST payload and streams downloadable CSV.
    """
    observations = _query_filtered_observations(
        db=db,
        bbox=payload.bbox,
        start_datetime=payload.start_datetime,
        end_datetime=payload.end_datetime,
        instruments=payload.instruments,
        min_confidence=payload.min_confidence,
    )

    engine = SpatioTemporalClusteringEngine(
        spatial_bandwidth_km=payload.spatial_bandwidth_km,
        temporal_bandwidth_hours=payload.temporal_bandwidth_hours,
        min_cluster_size=payload.min_cluster_size,
        min_samples=payload.min_samples,
        cluster_selection_epsilon=payload.cluster_selection_epsilon,
    )

    result = engine.harmonize(observations=observations, query_bbox=payload.bbox)

    timestamp_str = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    filename = f"harmonized_modis_viirs_events_{timestamp_str}.csv"

    return StreamingResponse(
        export_service.clusters_to_csv_stream(result.clusters),
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            "X-Total-Clusters": str(len(result.clusters)),
            "X-Total-Observations": str(result.summary.total_observations),
        }
    )


@router.post("/ingest", summary="Ingest Historical MODIS / VIIRS CSV File")
async def ingest_dataset_file(
    file: UploadFile = File(..., description="NASA FIRMS CSV file (MODIS or VIIRS)"),
    db: Session = Depends(get_db),
):
    """
    Upload and ingest historical NASA FIRMS datasets (e.g. MOD14/MYD14 or VNP14IMG)
    using chunked Pandas and bulk SQLAlchemy inserts.
    """
    if not file.filename.endswith((".csv", ".txt")):
        raise HTTPException(status_code=400, detail="Only CSV or TXT dataset files are supported.")

    contents = await file.read()
    buffer = io.BytesIO(contents)

    report = ingestion_service.ingest_csv(buffer, db, source_name=file.filename)
    return {
        "status": "success",
        "message": f"Successfully ingested {report.valid_rows_inserted} observations from {file.filename}",
        "report": report.to_dict(),
    }


@router.get("/observations", response_model=List[ObservationResponse], summary="Query Raw Satellite Detections")
def get_raw_observations(
    min_lon: float = Query(..., ge=-180.0, le=180.0),
    min_lat: float = Query(..., ge=-90.0, le=90.0),
    max_lon: float = Query(..., ge=-180.0, le=180.0),
    max_lat: float = Query(..., ge=-90.0, le=90.0),
    instrument: Optional[str] = Query(None, description="'MODIS' or 'VIIRS'"),
    limit: int = Query(500, ge=1, le=5000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """Retrieve raw historical observations within a bounding box."""
    bbox = BoundingBox(min_lon=min_lon, min_lat=min_lat, max_lon=max_lon, max_lat=max_lat)
    inst_list = [instrument] if instrument else None
    
    query = db.query(Observation).filter(
        and_(
            Observation.latitude >= bbox.min_lat,
            Observation.latitude <= bbox.max_lat,
            Observation.longitude >= bbox.min_lon,
            Observation.longitude <= bbox.max_lon,
        )
    )
    if inst_list:
        query = query.filter(Observation.instrument == inst_list[0].upper())

    results = query.order_by(Observation.acq_datetime.asc()).offset(offset).limit(limit).all()
    return results
