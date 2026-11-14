import pytest
from fastapi import HTTPException
from app.services.firms_client import firms_client, mask_map_key
from app.api.routes import health_check_firms
from unittest.mock import patch


def test_mask_map_key():
    url = "https://firms.modaps.eosdis.nasa.gov/api/area/csv/1234567890abcdef1234567890abcdef/VIIRS_SNPP_NRT/-125,36,-118,45/3"
    masked = mask_map_key(url)
    assert "1234567890abcdef" not in masked
    assert "https://firms.modaps.eosdis.nasa.gov/api/area/csv/***MASKED***/VIIRS_SNPP_NRT/-125,36,-118,45/3" == masked


def test_parse_firms_csv_modis_normalization():
    csv_sample = """latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight
37.452,-119.821,315.4,1.1,1.0,2026-11-13,2145,Terra,MODIS,85,6.1NRT,292.1,42.5,D
37.458,-119.829,320.1,1.1,1.0,2026-11-13,2145,Aqua,MODIS,92,6.1NRT,294.0,55.0,D
"""
    obs = firms_client.parse_firms_csv_to_observations(csv_sample, "MODIS_NRT")
    assert len(obs) == 2
    assert obs[0].instrument == "MODIS"
    assert obs[0].satellite == "Terra"
    assert obs[0].confidence == 85.0
    assert obs[0].brightness == 315.4
    assert obs[0].frp == 42.5
    assert obs[0].daynight == "D"
    assert obs[0].acq_datetime.hour == 21
    assert obs[0].acq_datetime.minute == 45


def test_parse_firms_csv_viirs_normalization():
    csv_sample = """latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight
38.125,-120.345,340.2,0.38,0.37,2026-11-13,0930,N,VIIRS,nominal,2.0NRT,298.2,18.4,N
38.128,-120.349,365.0,0.38,0.37,2026-11-13,0930,N20,VIIRS,h,2.0NRT,305.1,42.1,N
38.130,-120.352,310.0,0.38,0.37,2026-11-13,0930,N21,VIIRS,low,2.0NRT,290.0,5.2,N
"""
    obs = firms_client.parse_firms_csv_to_observations(csv_sample, "VIIRS_SNPP_NRT")
    assert len(obs) == 3
    assert all(o.instrument == "VIIRS" for o in obs)
    assert obs[0].satellite == "Suomi-NPP"
    assert obs[0].confidence == 70.0  # 'nominal' maps to 70.0
    assert obs[0].brightness == 340.2  # bright_ti4 maps to brightness
    assert obs[0].daynight == "N"

    assert obs[1].satellite == "NOAA-20"
    assert obs[1].confidence == 95.0  # 'h' maps to 95.0

    assert obs[2].satellite == "NOAA-21"
    assert obs[2].confidence == 30.0  # 'low' maps to 30.0


def test_parse_firms_csv_error_responses():
    # 1. Invalid MAP_KEY
    with pytest.raises(HTTPException) as exc_info:
        firms_client.parse_firms_csv_to_observations("Invalid MAP_KEY.", "MODIS_NRT")
    assert exc_info.value.status_code == 502
    assert "Invalid MAP_KEY" in exc_info.value.detail

    # 2. Transaction limit exceeded
    with pytest.raises(HTTPException) as exc_info2:
        firms_client.parse_firms_csv_to_observations("Transaction limit exceeded for this MAP_KEY.", "MODIS_NRT")
    assert exc_info2.value.status_code == 502
    assert "Transaction limit" in exc_info2.value.detail

    # 3. Empty CSV or header only
    empty_obs = firms_client.parse_firms_csv_to_observations("latitude,longitude,brightness\n", "MODIS_NRT")
    assert empty_obs == []


def test_health_check_firms_endpoint():
    with patch.object(firms_client, "health_check_live", return_value={
        "status": "healthy",
        "http_code": 200,
        "row_count": 42,
        "source": "VIIRS_SNPP_NRT",
        "day_range": 1
    }):
        resp = health_check_firms()
        assert resp["status"] == "healthy"
        assert resp["http_code"] == 200
        assert resp["row_count"] == 42
        assert resp["source"] == "VIIRS_SNPP_NRT"


def test_validate_startup_config_fails_without_map_key(monkeypatch):
    from app.core.config import settings
    from app.main import validate_startup_config
    monkeypatch.setattr(settings, "MAP_KEY", None)
    monkeypatch.setattr(settings, "FIRMS_MAP_KEY", None)
    monkeypatch.delenv("MAP_KEY", raising=False)
    monkeypatch.delenv("FIRMS_MAP_KEY", raising=False)

    with pytest.raises(RuntimeError) as exc_info:
        validate_startup_config()
    assert "NASA FIRMS MAP_KEY is not configured" in str(exc_info.value)


def test_require_map_key_missing(monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "MAP_KEY", None)
    monkeypatch.setattr(settings, "FIRMS_MAP_KEY", None)
    monkeypatch.delenv("MAP_KEY", raising=False)
    monkeypatch.delenv("FIRMS_MAP_KEY", raising=False)

    with pytest.raises(HTTPException) as exc_info:
        firms_client._require_map_key()
    assert exc_info.value.status_code == 500
    assert "NASA FIRMS MAP_KEY is not configured" in exc_info.value.detail


def test_decompose_bbox_antimeridian_and_tiling():
    """Verify BoundingBox decomposition handles antimeridian and large box tiling."""
    from app.schemas.harmonization import BoundingBox

    # 1. Normal small bbox requires no tiling
    small_bbox = BoundingBox(min_lon=140.0, min_lat=-38.0, max_lon=154.0, max_lat=-25.0)
    tiles, warning = firms_client.decompose_bbox(small_bbox)
    assert len(tiles) == 1
    assert warning is None
    assert tiles[0].min_lat == -38.0
    assert tiles[0].max_lat == -25.0
    assert tiles[0].min_lon == 140.0
    assert tiles[0].max_lon == 154.0

    # 2. Antimeridian crossing (170°E to -170°W): splits across 180°
    cross_bbox = BoundingBox(min_lon=170.0, min_lat=-20.0, max_lon=-170.0, max_lat=-10.0)
    tiles_cross, warn_cross = firms_client.decompose_bbox(cross_bbox)
    assert len(tiles_cross) == 2
    assert "Antimeridian crossing detected" in (warn_cross or "")
    # First tile: [170, -20, 180, -10]
    assert tiles_cross[0].min_lon == 170.0
    assert tiles_cross[0].max_lon == 180.0
    # Second tile: [-180, -20, -170, -10]
    assert tiles_cross[1].min_lon == -180.0
    assert tiles_cross[1].max_lon == -170.0

    # 3. Large box (spanning 40° lon x 30° lat) must be partitioned into tiles <= 20° x 20°
    large_bbox = BoundingBox(min_lon=-60.0, min_lat=10.0, max_lon=-20.0, max_lat=40.0)
    tiles_large, warn_large = firms_client.decompose_bbox(large_bbox)
    assert len(tiles_large) > 1
    assert "Large Area of Interest" in (warn_large or "")
    for t in tiles_large:
        assert (t.max_lon - t.min_lon) <= 20.01
        assert (t.max_lat - t.min_lat) <= 20.01
