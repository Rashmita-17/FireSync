import io
import re
import logging
from datetime import datetime, timezone, time as dtime
from typing import List, Dict, Any, Optional
import httpx
import pandas as pd
from fastapi import HTTPException

from app.core.config import settings
from app.models.observation import Observation
from app.schemas.harmonization import BoundingBox

logger = logging.getLogger("nasa_firms")

# NASA FIRMS Area API sources for multi-sensor harmonization
DEFAULT_FIRMS_SOURCES = [
    "VIIRS_SNPP_NRT",
    "VIIRS_NOAA20_NRT",
    "VIIRS_NOAA21_NRT",
    "MODIS_NRT",
]

CONFIDENCE_VIIRS_MAP = {
    "l": 30.0,
    "low": 30.0,
    "n": 70.0,
    "nominal": 70.0,
    "h": 95.0,
    "high": 95.0,
}

SATELLITE_NORMALIZATION = {
    "T": "Terra",
    "TERRA": "Terra",
    "A": "Aqua",
    "AQUA": "Aqua",
    "N20": "NOAA-20",
    "NOAA20": "NOAA-20",
    "NOAA-20": "NOAA-20",
    "J1": "NOAA-20",
    "JPSS-1": "NOAA-20",
    "N21": "NOAA-21",
    "NOAA21": "NOAA-21",
    "NOAA-21": "NOAA-21",
    "J2": "NOAA-21",
    "JPSS-2": "NOAA-21",
    "N": "Suomi-NPP",
    "NPP": "Suomi-NPP",
    "SNPP": "Suomi-NPP",
    "SUOMI-NPP": "Suomi-NPP",
}


def mask_map_key(url: str) -> str:
    """Masks NASA FIRMS map key in URLs for safe diagnostic logging."""
    return re.sub(r"/api/area/csv/[^/]+/", "/api/area/csv/***MASKED***/", url)


class FirmsClient:
    """
    Client for the official NASA FIRMS (Fire Information for Resource Management System) Area API.
    Fetches real-time Near Real-Time (NRT) active fire detections across MODIS and VIIRS sensors.
    """

    BASE_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"

    def __init__(self, map_key: Optional[str] = None):
        self._map_key = map_key

    @property
    def map_key(self) -> str:
        key = self._map_key or settings.get_map_key()
        return key.strip()

    def _require_map_key(self) -> str:
        key = self.map_key
        if not key:
            raise HTTPException(
                status_code=500,
                detail=(
                    "NASA FIRMS MAP_KEY is not configured on the backend. "
                    "Set the MAP_KEY environment variable. "
                    "Get a free instant key at https://firms.modaps.eosdis.nasa.gov/api/map_key/"
                ),
            )
        return key

    def _build_url(
        self,
        map_key: str,
        source: str,
        bbox: BoundingBox,
        day_range: int,
    ) -> str:
        """
        Constructs the NASA FIRMS Area API CSV URL:
        /api/area/csv/{MAP_KEY}/{SOURCE}/{west},{south},{east},{north}/{day_range}
        """
        w = round(bbox.min_lon, 4)
        s = round(bbox.min_lat, 4)
        e = round(bbox.max_lon, 4)
        n = round(bbox.max_lat, 4)
        clamped_days = max(1, min(10, int(day_range)))
        return f"{self.BASE_URL}/{map_key}/{source}/{w},{s},{e},{n}/{clamped_days}"

    def parse_firms_csv_to_observations(
        self,
        csv_text: str,
        source_name: str,
    ) -> List[Observation]:
        """
        Parses raw FIRMS CSV text into normalized Observation domain models.
        Handles empty data, schema differences between MODIS and VIIRS,
        and categorical vs numeric confidence scores.
        """
        stripped = csv_text.strip()
        if not stripped:
            return []

        # Defensive check for text errors disguised in response
        if stripped.startswith("Invalid MAP_KEY"):
            preview = stripped[:200]
            logger.error(f"[FIRMS API Error] Invalid MAP_KEY: {preview}")
            raise HTTPException(
                status_code=502,
                detail=f"NASA FIRMS API error: Invalid MAP_KEY ({preview})",
            )
        if "Transaction limit" in stripped:
            preview = stripped[:200]
            logger.error(f"[FIRMS API Error] Transaction limit exceeded: {preview}")
            raise HTTPException(
                status_code=502,
                detail=f"NASA FIRMS API error: Transaction limit exceeded ({preview})",
            )
        if "Invalid area coordinates" in stripped:
            preview = stripped[:200]
            logger.error(f"[FIRMS API Error] Invalid area coordinates: {preview}")
            raise HTTPException(
                status_code=400,
                detail=f"NASA FIRMS API error: Invalid area coordinates ({preview})",
            )

        try:
            df = pd.read_csv(io.StringIO(stripped))
        except Exception as e:
            preview = stripped[:200]
            logger.error(f"[FIRMS API Error] Failed to parse CSV response: {e}. Raw content: {preview}")
            raise HTTPException(
                status_code=502,
                detail=f"NASA FIRMS API returned non-CSV payload: {preview}",
            )

        if df.empty:
            return []

        # Normalize column names to lowercase and stripped
        df.columns = [str(col).strip().lower() for col in df.columns]

        # Latitude & Longitude columns
        lat_col = next((c for c in ["latitude", "lat"] if c in df.columns), None)
        lon_col = next((c for c in ["longitude", "lon"] if c in df.columns), None)
        if not lat_col or not lon_col:
            logger.warning(f"[FIRMS API] Missing latitude/longitude in response from {source_name}. Columns: {list(df.columns)}")
            return []

        # Filter out NaN coordinates
        df = df[df[lat_col].notna() & df[lon_col].notna()].copy()
        if df.empty:
            return []

        observations: List[Observation] = []
        now_utc = datetime.now(timezone.utc)

        for _, row in df.iterrows():
            try:
                lat = float(row[lat_col])
                lon = float(row[lon_col])

                # Instrument inference
                raw_inst = str(row.get("instrument", "")).strip().upper()
                if "MODIS" in raw_inst or "MODIS" in source_name.upper():
                    instrument = "MODIS"
                elif "VIIRS" in raw_inst or "VIIRS" in source_name.upper():
                    instrument = "VIIRS"
                elif "bright_ti4" in row:
                    instrument = "VIIRS"
                else:
                    instrument = "MODIS"

                # Satellite platform normalization
                sat_raw = str(row.get("satellite", "")).strip().upper()
                satellite = SATELLITE_NORMALIZATION.get(
                    sat_raw,
                    "Terra" if instrument == "MODIS" else "Suomi-NPP"
                )

                # Confidence normalization
                raw_conf = row.get("confidence")
                conf_val = 50.0
                conf_raw_str = str(raw_conf) if pd.notna(raw_conf) else "50"
                if pd.notna(raw_conf):
                    c_str = str(raw_conf).strip().lower()
                    if c_str in CONFIDENCE_VIIRS_MAP:
                        conf_val = CONFIDENCE_VIIRS_MAP[c_str]
                    else:
                        try:
                            conf_val = max(0.0, min(100.0, float(c_str)))
                        except ValueError:
                            conf_val = 50.0

                # FRP (Fire Radiative Power)
                raw_frp = row.get("frp")
                frp_val = float(raw_frp) if pd.notna(raw_frp) else 0.0

                # Brightness: normalize bright_ti4 (VIIRS) vs brightness (MODIS)
                brightness_val = None
                if "brightness" in row and pd.notna(row["brightness"]):
                    brightness_val = float(row["brightness"])
                elif "bright_ti4" in row and pd.notna(row["bright_ti4"]):
                    brightness_val = float(row["bright_ti4"])

                # Pixel scan and track
                scan_val = float(row["scan"]) if ("scan" in row and pd.notna(row["scan"])) else (
                    settings.MODIS_PIXEL_KM if instrument == "MODIS" else settings.VIIRS_I_BAND_KM
                )
                track_val = float(row["track"]) if ("track" in row and pd.notna(row["track"])) else (
                    settings.MODIS_PIXEL_KM if instrument == "MODIS" else settings.VIIRS_I_BAND_KM
                )

                # Day/Night flag
                dn_val = str(row.get("daynight", "D")).strip().upper()[:1] or "D"

                # Date & Time parsing
                date_val = row.get("acq_date")
                time_val = row.get("acq_time")
                acq_dt = None
                if pd.notna(date_val):
                    d_str = str(date_val).strip()
                    try:
                        d = datetime.strptime(d_str, "%Y-%m-%d").date()
                    except Exception:
                        d = now_utc.date()

                    t_str = str(time_val).strip().split(".")[0].zfill(4) if pd.notna(time_val) else "0000"
                    try:
                        hh = max(0, min(23, int(t_str[:2])))
                        mm = max(0, min(59, int(t_str[2:4])))
                        acq_dt = datetime.combine(d, dtime(hh, mm))
                    except Exception:
                        acq_dt = datetime.combine(d, dtime(0, 0))
                else:
                    acq_dt = now_utc.replace(tzinfo=None)

                obs = Observation(
                    latitude=lat,
                    longitude=lon,
                    acq_datetime=acq_dt,
                    instrument=instrument,
                    satellite=satellite,
                    confidence=conf_val,
                    confidence_raw=conf_raw_str,
                    frp=frp_val,
                    brightness=brightness_val,
                    scan=scan_val,
                    track=track_val,
                    daynight=dn_val,
                    source_file=source_name,
                    created_at=now_utc.replace(tzinfo=None),
                )
                observations.append(obs)
            except Exception as row_err:
                logger.debug(f"[FIRMS API] Skipping malformed record: {row_err}")
                continue

        return observations

    def fetch_area_observations(
        self,
        bbox: BoundingBox,
        day_range: int = 3,
        sources: Optional[List[str]] = None,
    ) -> List[Observation]:
        """
        Queries the NASA FIRMS Area API for all active fire observations in the specified
        bounding box over the requested day range across MODIS and VIIRS satellite sensors.
        """
        map_key = self._require_map_key()
        active_sources = sources or DEFAULT_FIRMS_SOURCES
        clamped_day_range = max(1, min(10, int(day_range)))

        all_observations: List[Observation] = []
        sensor_counts: Dict[str, int] = {}

        with httpx.Client(timeout=25.0) as client:
            for source in active_sources:
                url = self._build_url(map_key, source, bbox, clamped_day_range)
                masked_url = mask_map_key(url)
                logger.info(f"[FIRMS API] Querying {source}: {masked_url}")

                try:
                    resp = client.get(url)
                except httpx.RequestError as exc:
                    logger.error(f"[FIRMS API] Network request error connecting to {masked_url}: {exc}")
                    raise HTTPException(
                        status_code=502,
                        detail=f"Failed to reach NASA FIRMS server: {exc}",
                    )

                logger.info(f"[FIRMS API] Response HTTP {resp.status_code} for {source}")

                if resp.status_code != 200:
                    preview = resp.text[:200]
                    logger.error(f"[FIRMS API] Error HTTP {resp.status_code} from {masked_url}: {preview}")
                    raise HTTPException(
                        status_code=502,
                        detail=f"NASA FIRMS API returned HTTP {resp.status_code}: {preview}",
                    )

                obs_list = self.parse_firms_csv_to_observations(resp.text, source)
                sensor_counts[source] = len(obs_list)
                logger.info(f"[FIRMS API] Sensor {source} returned {len(obs_list)} valid observations.")
                all_observations.extend(obs_list)

        modis_count = sum(1 for o in all_observations if o.instrument == "MODIS")
        viirs_count = sum(1 for o in all_observations if o.instrument == "VIIRS")
        logger.info(
            f"[FIRMS API Aggregation] Completed live query: "
            f"MODIS={modis_count}, VIIRS={viirs_count}, Total={len(all_observations)} "
            f"across {len(active_sources)} sensor feeds."
        )

        return all_observations

    def health_check_live(self) -> Dict[str, Any]:
        """
        Tests live connectivity to NASA FIRMS API using a tiny sample request.
        Returns live status, HTTP status code, row count, source, and day range.
        """
        map_key = self._require_map_key()
        # Tiny sample bbox in California Sierra Nevada
        sample_bbox = BoundingBox(
            min_lon=-121.0,
            min_lat=37.0,
            max_lon=-120.0,
            max_lat=38.0,
        )
        sample_source = "VIIRS_SNPP_NRT"
        day_range = 1

        url = self._build_url(map_key, sample_source, sample_bbox, day_range)
        masked_url = mask_map_key(url)
        logger.info(f"[FIRMS Health] Probing live FIRMS connectivity: {masked_url}")

        with httpx.Client(timeout=15.0) as client:
            resp = client.get(url)

        logger.info(f"[FIRMS Health] Response HTTP {resp.status_code}")

        if resp.status_code != 200:
            preview = resp.text[:200]
            logger.error(f"[FIRMS Health] Error HTTP {resp.status_code}: {preview}")
            raise HTTPException(
                status_code=502,
                detail=f"NASA FIRMS Health Check failed with HTTP {resp.status_code}: {preview}",
            )

        body = resp.text.strip()
        if body.startswith("Invalid MAP_KEY"):
            preview = body[:200]
            logger.error(f"[FIRMS Health] Rejected MAP_KEY: {preview}")
            raise HTTPException(
                status_code=502,
                detail=f"NASA FIRMS Health Check failed: Invalid MAP_KEY ({preview})",
            )
        if "Transaction limit" in body:
            preview = body[:200]
            logger.error(f"[FIRMS Health] Transaction limit exceeded: {preview}")
            raise HTTPException(
                status_code=502,
                detail=f"NASA FIRMS Health Check failed: Transaction limit exceeded ({preview})",
            )

        obs = self.parse_firms_csv_to_observations(body, sample_source)
        return {
            "status": "healthy",
            "http_code": resp.status_code,
            "row_count": len(obs),
            "source": sample_source,
            "day_range": day_range,
        }


firms_client = FirmsClient()
