import io
import pytest
from datetime import datetime

from app.core.database import SessionLocal
from app.schemas.harmonization import HarmonizationRequest, BoundingBox
from app.services.exporter import export_service
from app.services.ingestion import ingestion_service
from app.api.routes import (
    health_check,
    get_dataset_stats,
    harmonize_get,
    harmonize_post,
    get_raw_observations,
)


@pytest.fixture(scope="module")
def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def test_health_check_endpoint(db_session):
    result = health_check(db=db_session)
    assert result["status"] == "healthy"
    assert result["clustering_engine"] == "sklearn.cluster.HDBSCAN"
    assert result["database_records"] > 0
    assert "MODIS (Terra, Aqua)" in result["supported_sensors"][0]


def test_stats_endpoint(db_session):
    stats = get_dataset_stats(db=db_session)
    assert "total_observations" in stats
    assert "modis_observations" in stats
    assert "viirs_observations" in stats
    assert stats["total_observations"] > 0
    # Because of 375m vs 1km spatial resolution, VIIRS detections must exceed MODIS
    assert stats["viirs_observations"] > stats["modis_observations"]
    assert stats["sensor_ratio_viirs"] > 0.5


def test_harmonize_get_endpoint(db_session):
    # California wildfire complex bounding box
    result = harmonize_get(
        min_lon=-125.0,
        min_lat=36.0,
        max_lon=-118.0,
        max_lat=45.0,
        start_datetime=None,
        end_datetime=None,
        spatial_bandwidth_km=3.0,
        temporal_bandwidth_hours=8.0,
        min_cluster_size=4,
        min_samples=1,
        cluster_selection_epsilon=0.5,
        min_confidence=0.0,
        include_observations=True,
        include_noise=True,
        db=db_session,
    )
    assert result.status == "success"
    assert result.summary.total_observations > 0
    assert result.summary.total_clusters > 0
    assert result.summary.cross_validated_clusters > 0
    assert len(result.clusters) == result.summary.total_clusters

    first_cluster = result.clusters[0]
    assert first_cluster.cluster_id >= 0
    assert first_cluster.total_frp > 0.0
    assert first_cluster.modis_count >= 0
    assert first_cluster.viirs_count >= 0
    assert first_cluster.total_detections == first_cluster.modis_count + first_cluster.viirs_count
    assert first_cluster.estimated_area_km2 > 0.0
    assert "coordinates" in first_cluster.geojson_geometry
    assert len(first_cluster.observations) > 0


def test_harmonize_post_endpoint(db_session):
    payload = HarmonizationRequest(
        bbox=BoundingBox(
            min_lon=-123.0,
            min_lat=39.0,
            max_lon=-120.0,
            max_lat=42.0
        ),
        spatial_bandwidth_km=3.5,
        temporal_bandwidth_hours=6.0,
        min_cluster_size=3,
        min_samples=1,
        cluster_selection_epsilon=0.5,
        include_observations=False,
        include_noise=True,
    )
    result = harmonize_post(payload=payload, db=db_session)
    assert result.status == "success"
    assert result.summary.total_clusters >= 1
    assert len(result.clusters) > 0


def test_export_service_csv_generation(db_session):
    # Retrieve harmonized clusters
    harm = harmonize_get(
        min_lon=-125.0,
        min_lat=36.0,
        max_lon=-118.0,
        max_lat=45.0,
        spatial_bandwidth_km=3.0,
        temporal_bandwidth_hours=8.0,
        min_cluster_size=4,
        db=db_session,
    )
    csv_str = export_service.clusters_to_csv_string(harm.clusters)
    lines = [line.strip() for line in csv_str.strip().split("\n") if line.strip()]
    assert len(lines) >= 2  # Header + at least one cluster

    header = lines[0]
    assert "cluster_id" in header
    assert "centroid_lat" in header
    assert "weighted_centroid_lat" in header
    assert "total_frp_mw" in header
    assert "modis_count" in header
    assert "viirs_count" in header
    assert "cross_validated" in header
    assert "estimated_area_km2" in header


def test_get_raw_observations_endpoint(db_session):
    records = get_raw_observations(
        min_lon=-125.0,
        min_lat=35.0,
        max_lon=-118.0,
        max_lat=45.0,
        instrument="VIIRS",
        limit=10,
        offset=0,
        db=db_session,
    )
    assert len(records) <= 10
    assert len(records) > 0
    first = records[0]
    assert first.instrument == "VIIRS"
    assert -90.0 <= first.latitude <= 90.0
    assert -180.0 <= first.longitude <= 180.0


def test_ingestion_service_dataframe(db_session):
    sample_csv = (
        "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,frp,daynight\n"
        "38.51,-120.21,330.5,1.0,1.0,2023-08-16,1330,Aqua,MODIS,85,45.2,D\n"
        "38.52,-120.22,342.1,0.375,0.375,2023-08-16,1340,Suomi-NPP,VIIRS,high,12.4,D\n"
    )
    buffer = io.StringIO(sample_csv)
    report = ingestion_service.ingest_csv(buffer, db_session, source_name="test_buffer.csv")
    assert report.valid_rows_inserted == 2
    assert report.modis_rows == 1
    assert report.viirs_rows == 1


def test_harmonize_out_of_range_lon_wrapping(db_session):
    """
    Verifies that when Mapbox/Leaflet continuous panning outputs longitudes
    outside [-180, 180] (e.g. -235 to -225), BoundingBox wraps them to standard
    EPSG:4326 range (e.g. 125 to 135) and GET/POST harmonization succeeds without 422 error.
    """
    bbox = BoundingBox(
        min_lon=-232.73,
        min_lat=36.0,
        max_lon=-220.0,
        max_lat=45.0
    )
    assert -180.0 <= bbox.min_lon <= 180.0
    assert -180.0 <= bbox.max_lon <= 180.0
    assert bbox.min_lon <= bbox.max_lon

    # Test GET endpoint with out-of-range lon values
    result_get = harmonize_get(
        min_lon=-235.0,
        min_lat=36.0,
        max_lon=-225.0,
        max_lat=45.0,
        db=db_session
    )
    assert result_get.status == "success"

