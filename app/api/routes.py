import logging
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, Query, HTTPException, UploadFile, File, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import func, and_
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

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
from app.services.firms_client import firms_client

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
    if any(abs(l) > 90.0 for l in lats) and all(abs(l) <= 90.0 for l in lons):
        lats, lons = lons, lats

    lat_min, lat_max = min(lats), max(lats)
    lon_west, lon_east = lons[0], lons[1]
    is_antimeridian = (lon_west > lon_east) and (lon_west - lon_east) > 180.0

    # 2. Sanitize confidence threshold
    conf_val = float(min_confidence) if isinstance(min_confidence, (int, float)) else 0.0

    # 3. Build spatial bounding box filter
    spatial_filters = [
        Observation.latitude >= lat_min,
        Observation.latitude <= lat_max,
        Observation.confidence >= conf_val,
    ]

    if is_antimeridian:
        spatial_filters.append(
            (Observation.longitude >= lon_west) | (Observation.longitude <= lon_east)
        )
    else:
        spatial_filters.append(Observation.longitude >= min(lon_west, lon_east))
        spatial_filters.append(Observation.longitude <= max(lon_west, lon_east))

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


@router.get("/health", summary="Service Health and Database Readiness")
def health_check(db: Session = Depends(get_db)):
    """Healthcheck endpoint verifying DB connectivity, status, and record counts."""
    try:
        total_records = db.query(func.count(Observation.id)).scalar() or 0
        is_empty = total_records == 0
        return {
            "status": "healthy" if not is_empty else "empty_database",
            "service": settings.PROJECT_NAME,
            "database_records": total_records,
            "is_empty": is_empty,
            "clustering_engine": "sklearn.cluster.HDBSCAN",
            "supported_sensors": ["MODIS (Terra, Aqua)", "VIIRS (Suomi-NPP, NOAA-20, NOAA-21)"],
            "tip": "Database is populated and ready for queries." if not is_empty else "Database is empty (0 rows). Use POST /api/seed-sample to load demo records."
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return {
            "status": "unhealthy",
            "error": str(e),
            "database_records": 0,
            "is_empty": True,
        }


@router.get("/health/firms", summary="Test Live NASA FIRMS Connectivity")
def health_check_firms():
    """
    Makes a live test request to NASA FIRMS API and verifies key validity and network connectivity.
    Returns {status, http_code, row_count, source, day_range}.
    """
    return firms_client.health_check_live()


@router.get("/db-status", summary="Production Database Diagnostics and Row Counts")
def get_db_status(db: Session = Depends(get_db)):
    """
    Diagnostic endpoint to count rows and verify if production SQLite database is empty.
    Checks total rows, instrument distribution (MODIS vs VIIRS), and timestamp ranges.
    """
    try:
        total_count = db.query(func.count(Observation.id)).scalar() or 0
        modis_count = db.query(func.count(Observation.id)).filter(Observation.instrument == "MODIS").scalar() or 0
        viirs_count = db.query(func.count(Observation.id)).filter(Observation.instrument == "VIIRS").scalar() or 0
        
        min_date = db.query(func.min(Observation.acq_datetime)).scalar()
        max_date = db.query(func.max(Observation.acq_datetime)).scalar()
        is_empty = total_count == 0

        return {
            "status": "healthy" if not is_empty else "empty_database",
            "database_connected": True,
            "total_records": total_count,
            "is_empty": is_empty,
            "modis_records": modis_count,
            "viirs_records": viirs_count,
            "earliest_record_utc": min_date.isoformat() if min_date else None,
            "latest_record_utc": max_date.isoformat() if max_date else None,
            "message": "Production database contains active records." if not is_empty else "WARNING: SQLite database contains 0 records! If deployed to production without CSV files, call POST /api/seed-sample to insert demo records.",
            "recommended_query_bbox": {
                "min_lon": -125.0,
                "min_lat": 36.0,
                "max_lon": -118.0,
                "max_lat": 45.0,
                "description": "Western US Monitoring Sector (California / Oregon / Nevada)"
            }
        }
    except Exception as e:
        logger.error(f"Database status check failed: {e}")
        return {
            "status": "error",
            "database_connected": False,
            "error": str(e),
            "total_records": 0,
            "is_empty": True,
        }


@router.post("/seed-sample", summary="Seed Sample NASA FIRMS MODIS & VIIRS Records")
def seed_sample_records(db: Session = Depends(get_db)):
    """
    Seeds realistic NASA FIRMS fire detections (MODIS 1km + VIIRS 375m)
    in the Western Sector (Sierra Nevada / California) so cloud deployments
    with empty SQLite databases can immediately visualize active fire complexes.
    """
    import random
    from datetime import datetime, timedelta

    existing_count = db.query(func.count(Observation.id)).scalar() or 0
    if existing_count > 0:
        return {
            "message": f"Database already contains {existing_count:,} records. Seeding skipped.",
            "total_records": existing_count,
            "is_empty": False
        }

    now = datetime.utcnow()
    sample_obs = []
    
    # Complex 1: Sierra Nevada Forest Fire (Lat ~37.85, Lon ~-119.55)
    for i in range(15):
        sample_obs.append(
            Observation(
                latitude=37.85 + random.uniform(-0.02, 0.02),
                longitude=-119.55 + random.uniform(-0.02, 0.02),
                acq_datetime=now - timedelta(hours=random.uniform(0.5, 4.0)),
                instrument="MODIS",
                satellite="Aqua",
                confidence=random.uniform(75, 95),
                frp=random.uniform(40, 180),
                scan=1.0,
                track=1.0,
                daynight="D",
                source_file="sample_seed.csv",
                created_at=now,
            )
        )
    for i in range(35):
        sample_obs.append(
            Observation(
                latitude=37.85 + random.uniform(-0.025, 0.025),
                longitude=-119.55 + random.uniform(-0.025, 0.025),
                acq_datetime=now - timedelta(hours=random.uniform(0.2, 3.8)),
                instrument="VIIRS",
                satellite="NOAA-20",
                confidence=random.uniform(80, 99),
                frp=random.uniform(15, 90),
                scan=0.375,
                track=0.375,
                daynight="D",
                source_file="sample_seed.csv",
                created_at=now,
            )
        )

    # Complex 2: Shasta-Klamath Ridge Fire (Lat ~41.5, Lon ~-122.1)
    for i in range(8):
        sample_obs.append(
            Observation(
                latitude=41.5 + random.uniform(-0.015, 0.015),
                longitude=-122.1 + random.uniform(-0.015, 0.015),
                acq_datetime=now - timedelta(hours=random.uniform(1.0, 5.0)),
                instrument="MODIS",
                satellite="Terra",
                confidence=random.uniform(70, 90),
                frp=random.uniform(30, 120),
                scan=1.0,
                track=1.0,
                daynight="D",
                source_file="sample_seed.csv",
                created_at=now,
            )
        )
    for i in range(25):
        sample_obs.append(
            Observation(
                latitude=41.5 + random.uniform(-0.02, 0.02),
                longitude=-122.1 + random.uniform(-0.02, 0.02),
                acq_datetime=now - timedelta(hours=random.uniform(0.8, 4.5)),
                instrument="VIIRS",
                satellite="Suomi-NPP",
                confidence=random.uniform(85, 100),
                frp=random.uniform(10, 75),
                scan=0.375,
                track=0.375,
                daynight="D",
                source_file="sample_seed.csv",
                created_at=now,
            )
        )

    db.bulk_save_objects(sample_obs)
    db.commit()

    total_now = db.query(func.count(Observation.id)).scalar() or 0
    return {
        "status": "success",
        "message": f"Successfully seeded {len(sample_obs)} sample MODIS & VIIRS observations into database.",
        "total_records": total_now,
        "is_empty": False
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
    day_range: int = Query(3, ge=1, le=10, description="FIRMS lookback window in days (1-10)"),
    use_live: bool = Query(False, description="Force live FIRMS query"),
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
    
    # Parameter sanitization for direct Python invocations
    d_range = day_range if isinstance(day_range, (int, float)) else 3
    is_live = use_live if isinstance(use_live, bool) else False
    s_bandwidth = spatial_bandwidth_km if isinstance(spatial_bandwidth_km, (int, float)) else settings.DEFAULT_SPATIAL_BANDWIDTH_KM
    t_bandwidth = temporal_bandwidth_hours if isinstance(temporal_bandwidth_hours, (int, float)) else settings.DEFAULT_TEMPORAL_BANDWIDTH_HOURS
    c_size = min_cluster_size if isinstance(min_cluster_size, int) else settings.DEFAULT_MIN_CLUSTER_SIZE
    c_samples = min_samples if isinstance(min_samples, int) else settings.DEFAULT_MIN_SAMPLES
    c_eps = cluster_selection_epsilon if isinstance(cluster_selection_epsilon, (int, float)) else settings.DEFAULT_CLUSTER_EPSILON
    inc_obs = include_observations if isinstance(include_observations, bool) else False
    inc_noise = include_noise if isinstance(include_noise, bool) else False

    if is_live:
        observations = []
    else:
        observations = _query_filtered_observations(
            db=db,
            bbox=bbox,
            start_datetime=start_datetime,
            end_datetime=end_datetime,
            min_confidence=min_confidence,
        )

    # If database is empty for this AOI or live query is requested, fetch directly from NASA FIRMS Area API
    warning_message: Optional[str] = None
    if (len(observations) == 0 or is_live) and settings.get_map_key():
        clamped_days = max(1, min(5, int(d_range)))
        logger.info(f"[Harmonize GET] Database has {len(observations)} records in AOI. Querying live NASA FIRMS API (day_range={clamped_days})...")
        live_obs, warning_message = firms_client.fetch_area_observations(bbox=bbox, day_range=clamped_days)
        if live_obs:
            observations = live_obs
            try:
                to_save = live_obs if len(live_obs) <= 1000 else sorted(live_obs, key=lambda x: x.frp or 0.0, reverse=True)[:1000]
                db.bulk_save_objects(to_save)
                db.commit()
                logger.info(f"[Harmonize GET] Persisted {len(to_save)} live detections to database cache.")
            except Exception as e:
                db.rollback()
                logger.debug(f"[Harmonize GET] Live observations used directly in-memory: {e}")
            for idx, o in enumerate(observations, 1):
                if not getattr(o, "id", None):
                    o.id = idx

    engine = SpatioTemporalClusteringEngine(
        spatial_bandwidth_km=s_bandwidth,
        temporal_bandwidth_hours=t_bandwidth,
        min_cluster_size=c_size,
        min_samples=c_samples,
        cluster_selection_epsilon=c_eps,
    )

    result = engine.harmonize(
        observations=observations,
        query_bbox=bbox,
        include_observations=inc_obs,
        include_noise=inc_noise,
        warning=warning_message,
    )

    logger.info(
        f"[Harmonize Result] Bbox=[{bbox.min_lon},{bbox.min_lat},{bbox.max_lon},{bbox.max_lat}] "
        f"Raw={result.summary.total_observations}, Clusters={result.summary.total_clusters}, "
        f"CrossValidated={result.summary.cross_validated_clusters}, Time={result.summary.execution_time_ms:.1f}ms"
    )
    return result


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
    if payload.use_live:
        observations = []
    else:
        observations = _query_filtered_observations(
            db=db,
            bbox=payload.bbox,
            start_datetime=payload.start_datetime,
            end_datetime=payload.end_datetime,
            instruments=payload.instruments,
            min_confidence=payload.min_confidence,
        )

    # If database is empty for this AOI or live query is requested, fetch directly from NASA FIRMS Area API
    warning_message: Optional[str] = None
    if (len(observations) == 0 or payload.use_live) and settings.get_map_key():
        clamped_days = max(1, min(5, int(payload.day_range or 3)))
        logger.info(f"[Harmonize POST] Database has {len(observations)} records in AOI. Querying live NASA FIRMS API (day_range={clamped_days})...")
        live_obs, warning_message = firms_client.fetch_area_observations(bbox=payload.bbox, day_range=clamped_days)
        if live_obs:
            observations = live_obs
            try:
                to_save = live_obs if len(live_obs) <= 1000 else sorted(live_obs, key=lambda x: x.frp or 0.0, reverse=True)[:1000]
                db.bulk_save_objects(to_save)
                db.commit()
                logger.info(f"[Harmonize POST] Persisted {len(to_save)} live detections to database cache.")
            except Exception as e:
                db.rollback()
                logger.debug(f"[Harmonize POST] Live observations used directly in-memory: {e}")
            for idx, o in enumerate(observations, 1):
                if not getattr(o, "id", None):
                    o.id = idx

    engine = SpatioTemporalClusteringEngine(
        spatial_bandwidth_km=payload.spatial_bandwidth_km,
        temporal_bandwidth_hours=payload.temporal_bandwidth_hours,
        min_cluster_size=payload.min_cluster_size,
        min_samples=payload.min_samples,
        cluster_selection_epsilon=payload.cluster_selection_epsilon,
    )

    result = engine.harmonize(
        observations=observations,
        query_bbox=payload.bbox,
        include_observations=payload.include_observations,
        include_noise=payload.include_noise,
        warning=warning_message,
    )

    logger.info(
        f"[Harmonize Result] Bbox=[{payload.bbox.min_lon},{payload.bbox.min_lat},{payload.bbox.max_lon},{payload.bbox.max_lat}] "
        f"Raw={result.summary.total_observations}, Clusters={result.summary.total_clusters}, "
        f"CrossValidated={result.summary.cross_validated_clusters}, Time={result.summary.execution_time_ms:.1f}ms"
    )
    return result


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

    if len(observations) == 0 and settings.get_map_key():
        live_obs, _ = firms_client.fetch_area_observations(bbox=bbox, day_range=3)
        if live_obs:
            observations = live_obs
            try:
                db.bulk_save_objects(live_obs)
                db.commit()
            except Exception:
                db.rollback()

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

    if len(observations) == 0 and settings.get_map_key():
        live_obs, _ = firms_client.fetch_area_observations(bbox=payload.bbox, day_range=payload.day_range or 3)
        if live_obs:
            observations = live_obs
            try:
                db.bulk_save_objects(live_obs)
                db.commit()
            except Exception:
                db.rollback()

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
    
    if bbox.min_lon > bbox.max_lon:
        lon_filter = (Observation.longitude >= bbox.min_lon) | (Observation.longitude <= bbox.max_lon)
    else:
        lon_filter = and_(
            Observation.longitude >= bbox.min_lon,
            Observation.longitude <= bbox.max_lon,
        )

    query = db.query(Observation).filter(
        and_(
            Observation.latitude >= bbox.min_lat,
            Observation.latitude <= bbox.max_lat,
            lon_filter,
        )
    )
    if inst_list:
        query = query.filter(Observation.instrument == inst_list[0].upper())

    results = query.order_by(Observation.acq_datetime.asc()).offset(offset).limit(limit).all()
    return results
