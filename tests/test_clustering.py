import pytest
from datetime import datetime, timedelta
import numpy as np

from app.models.observation import Observation
from app.schemas.harmonization import BoundingBox
from app.services.clustering import SpatioTemporalClusteringEngine


def test_coordinate_projection():
    """
    Test local equirectangular metric projection.
    1 degree of latitude should approximate ~111 km.
    """
    engine = SpatioTemporalClusteringEngine()
    lats = np.array([38.0, 39.0])
    lons = np.array([-120.0, -120.0])
    dts = [datetime(2023, 8, 15, 12, 0), datetime(2023, 8, 15, 14, 0)]

    x_km, y_km, t_hours = engine._project_coordinates(lats, lons, dts)

    delta_y = abs(y_km[1] - y_km[0])
    assert 110.0 < delta_y < 112.5

    delta_t = t_hours[1] - t_hours[0]
    assert abs(delta_t - 2.0) < 1e-5


def test_sensor_harmonization_resolves_fragmentation():
    """
    Core NASA Challenge test:
    Simulate a wildland fire event observed by MODIS (coarse 1km pixels)
    and VIIRS (fine 375m pixels) during afternoon overpasses.
    Assert that HDBSCAN clusters all 15 co-occurring detections into 1 unified harmonized event
    while isolating distant noise points.
    """
    base_time = datetime(2023, 8, 15, 21, 30)  # Aqua MODIS overpass
    center_lat = 38.5000
    center_lon = -120.0000

    observations = []
    np.random.seed(42)

    # 3 MODIS detections (1km)
    for i in range(3):
        modis_obs = Observation(
            id=1 + i,
            latitude=center_lat + np.random.normal(0, 0.002),
            longitude=center_lon + np.random.normal(0, 0.002),
            acq_datetime=base_time,
            instrument="MODIS",
            satellite="Aqua",
            confidence=85.0,
            frp=45.0,
            scan=1.0,
            track=1.0,
            daynight="D",
            source_file="test_modis.csv",
            created_at=base_time,
        )
        observations.append(modis_obs)

    # 12 VIIRS detections (375m) ~10 minutes later (Suomi-NPP) distributed around the fire front
    for i in range(12):
        viirs_obs = Observation(
            id=10 + i,
            latitude=center_lat + np.random.normal(0, 0.003),
            longitude=center_lon + np.random.normal(0, 0.003),
            acq_datetime=base_time + timedelta(minutes=10),
            instrument="VIIRS",
            satellite="Suomi-NPP",
            confidence=95.0,
            frp=12.0,
            scan=0.375,
            track=0.375,
            daynight="D",
            source_file="test_viirs.csv",
            created_at=base_time,
        )
        observations.append(viirs_obs)

    # 2 isolated noise points far away and at different times
    for i in range(2):
        noise_obs = Observation(
            id=990 + i,
            latitude=center_lat + 3.0 + i * 0.5,
            longitude=center_lon + 2.0 + i * 0.5,
            acq_datetime=base_time + timedelta(hours=14 + i),
            instrument="MODIS" if i == 0 else "VIIRS",
            satellite="Terra",
            confidence=35.0,
            frp=3.0,
            scan=1.0,
            track=1.0,
            daynight="N",
            source_file="noise.csv",
            created_at=base_time,
        )
        observations.append(noise_obs)

    bbox = BoundingBox(
        min_lon=center_lon - 3.0,
        min_lat=center_lat - 3.0,
        max_lon=center_lon + 4.0,
        max_lat=center_lat + 5.0,
    )

    engine = SpatioTemporalClusteringEngine(
        spatial_bandwidth_km=3.0,
        temporal_bandwidth_hours=6.0,
        min_cluster_size=4,
        cluster_selection_epsilon=0.5,
    )

    response = engine.harmonize(
        observations=observations,
        query_bbox=bbox,
        include_observations=True,
        include_noise=True,
    )

    # Verify clustering results
    assert response.status == "success"
    assert response.summary.total_observations == 17
    assert response.summary.total_clusters == 1, "The 15 co-located detections must form exactly 1 harmonized cluster"
    assert response.summary.total_noise_points == 2, "The 2 distant points must be classified as noise"

    cluster = response.clusters[0]
    assert cluster.total_detections == 15
    assert cluster.modis_count == 3
    assert cluster.viirs_count == 12
    assert cluster.cross_validated is True, "Must be cross-validated since both MODIS and VIIRS observed it"
    assert cluster.total_frp > 200.0
    assert cluster.harmonized_confidence >= 90.0, "Multi-sensor cross validation must award confidence bonus"
    assert cluster.estimated_area_km2 > 0.0
    assert "coordinates" in cluster.geojson_geometry


def test_empty_dataset_handling():
    """Ensure graceful handling of empty observation lists."""
    engine = SpatioTemporalClusteringEngine()
    bbox = BoundingBox(min_lon=-120, min_lat=30, max_lon=-110, max_lat=40)
    response = engine.harmonize(observations=[], query_bbox=bbox)

    assert response.status == "success"
    assert response.summary.total_clusters == 0
    assert response.summary.total_observations == 0
    assert len(response.clusters) == 0
