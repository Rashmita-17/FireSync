import io
import re
import math
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, time as dtime
from typing import List, Dict, Any, Optional, Tuple
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


REPRESENTATIVE_GLOBAL_BELTS = [
    # Australia Bushfire Belt (NSW / Queensland)
    BoundingBox(min_lon=135.0, min_lat=-38.0, max_lon=155.0, max_lat=-18.0),
    # Amazon Arc of Deforestation (Brazil)
    BoundingBox(min_lon=-62.0, min_lat=-15.0, max_lon=-42.0, max_lat=5.0),
    # Central Africa / Sahel Savanna Belt
    BoundingBox(min_lon=12.0, min_lat=-12.0, max_lon=32.0, max_lat=8.0),
    # South Asia / Indo-Gangetic Fire Front
    BoundingBox(min_lon=68.0, min_lat=18.0, max_lon=88.0, max_lat=38.0),
    # Southeast Asia / Indonesia Tropical Peatland
    BoundingBox(min_lon=98.0, min_lat=-8.0, max_lon=118.0, max_lat=12.0),
    # Mediterranean Europe Wildland-Urban Interface
    BoundingBox(min_lon=-5.0, min_lat=35.0, max_lon=15.0, max_lat=48.0),
    # North America West Wildfire Belt
    BoundingBox(min_lon=-125.0, min_lat=32.0, max_lon=-105.0, max_lat=52.0),
    # Siberia / Russian Far East Boreal Taiga
    BoundingBox(min_lon=115.0, min_lat=50.0, max_lon=135.0, max_lat=65.0),
]


def bbox_intersects(b1: BoundingBox, b2: BoundingBox) -> bool:
    """Checks if two bounding boxes in EPSG:4326 intersect."""
    if b1.min_lon <= b1.max_lon and b2.min_lon <= b2.max_lon:
        lon_overlap = max(b1.min_lon, b2.min_lon) <= min(b1.max_lon, b2.max_lon)
    else:
        # Crosses antimeridian
        lon_overlap = True
    lat_overlap = max(b1.min_lat, b2.min_lat) <= min(b1.max_lat, b2.max_lat)
    return lon_overlap and lat_overlap


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
        clamped_days = max(1, min(5, int(day_range)))
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

    @classmethod
    def decompose_bbox(
        cls,
        bbox: BoundingBox,
        max_tile_deg: float = 20.0,
        max_tiles: int = 16,
    ) -> Tuple[List[BoundingBox], Optional[str]]:
        """
        Decomposes a bounding box into valid NASA FIRMS Area API sub-queries:
        1. Identifies planetary-scale queries (lon_span >= 120° or lat_span >= 70°) and samples
           representative wildfire and biomass burning monitoring belts (<= 20° x 20° each).
        2. Handles Antimeridian crossings (min_lon > max_lon) by splitting across +/-180°.
        3. Enforces the NASA FIRMS invariant that sub-tile dimensions NEVER exceed 20° x 20°.
        Returns (tiles, warning_message).
        """
        # Determine total longitudinal and latitudinal footprint
        if bbox.min_lon > bbox.max_lon:
            total_lon_span = 360.0 - (bbox.min_lon - bbox.max_lon)
        else:
            total_lon_span = bbox.max_lon - bbox.min_lon
        total_lat_span = bbox.max_lat - bbox.min_lat

        is_planetary = (
            total_lon_span >= 120.0
            or total_lat_span >= 70.0
            or (total_lon_span * total_lat_span >= 6000.0)
        )

        if is_planetary:
            intersecting_belts = [
                b for b in REPRESENTATIVE_GLOBAL_BELTS if bbox_intersects(bbox, b)
            ]
            selected_tiles = intersecting_belts if intersecting_belts else list(REPRESENTATIVE_GLOBAL_BELTS)
            warning = (
                f"Planetary Overview ({len(selected_tiles)} sub-tiles): Query spanned planet-scale footprint "
                f"({total_lon_span:.1f}° x {total_lat_span:.1f}°) and was partitioned into representative "
                f"wildfire monitoring belts (<= {max_tile_deg}°x{max_tile_deg}° each) to comply with NASA FIRMS constraints."
            )
            return selected_tiles, warning

        raw_boxes: List[Tuple[float, float, float, float]] = []

        # Check Antimeridian crossing (west > east)
        if bbox.min_lon > bbox.max_lon:
            raw_boxes.append((bbox.min_lon, bbox.min_lat, 180.0, bbox.max_lat))
            raw_boxes.append((-180.0, bbox.min_lat, bbox.max_lon, bbox.max_lat))
        else:
            raw_boxes.append((bbox.min_lon, bbox.min_lat, bbox.max_lon, bbox.max_lat))

        tiles: List[BoundingBox] = []
        is_tiled = False
        is_capped = False

        for (w, s, e, n) in raw_boxes:
            lon_span = abs(e - w)
            lat_span = abs(n - s)

            if lon_span <= max_tile_deg and lat_span <= max_tile_deg:
                tiles.append(BoundingBox(min_lon=w, min_lat=s, max_lon=e, max_lat=n))
            else:
                is_tiled = True
                n_lon = max(1, math.ceil(lon_span / max_tile_deg))
                n_lat = max(1, math.ceil(lat_span / max_tile_deg))

                if n_lon * n_lat <= max_tiles:
                    d_lon = lon_span / n_lon
                    d_lat = lat_span / n_lat
                    for i in range(n_lon):
                        tile_w = w + i * d_lon
                        tile_e = e if i == n_lon - 1 else tile_w + d_lon
                        for j in range(n_lat):
                            tile_s = s + j * d_lat
                            tile_n = n if j == n_lat - 1 else tile_s + d_lat
                            tiles.append(
                                BoundingBox(
                                    min_lon=round(tile_w, 4),
                                    min_lat=round(tile_s, 4),
                                    max_lon=round(tile_e, 4),
                                    max_lat=round(tile_n, 4),
                                )
                            )
                else:
                    is_capped = True
                    # Cap tile grid count while strictly preserving tile size <= max_tile_deg
                    k_lon = max(1, min(n_lon, int(math.isqrt(max_tiles))))
                    k_lat = max(1, min(n_lat, max_tiles // k_lon))
                    tile_w_deg = min(max_tile_deg, lon_span)
                    tile_h_deg = min(max_tile_deg, lat_span)
                    step_lon = (lon_span - tile_w_deg) / (k_lon - 1) if k_lon > 1 else 0.0
                    step_lat = (lat_span - tile_h_deg) / (k_lat - 1) if k_lat > 1 else 0.0
                    for i in range(k_lon):
                        cur_w = w + i * step_lon
                        cur_e = cur_w + tile_w_deg
                        for j in range(k_lat):
                            cur_s = s + j * step_lat
                            cur_n = cur_s + tile_h_deg
                            tiles.append(
                                BoundingBox(
                                    min_lon=round(cur_w, 4),
                                    min_lat=round(cur_s, 4),
                                    max_lon=round(cur_e, 4),
                                    max_lat=round(cur_n, 4),
                                )
                            )

        warning: Optional[str] = None
        if is_tiled or bbox.min_lon > bbox.max_lon:
            if is_capped:
                warning = (
                    f"Large Area of Interest ({len(tiles)} sub-tiles): The requested query exceeded "
                    f"the maximum single query footprint and was partitioned into {len(tiles)} sub-tiles "
                    f"(<= {max_tile_deg}°x{max_tile_deg}° each) to comply with NASA FIRMS API rate limits."
                )
            elif bbox.min_lon > bbox.max_lon:
                warning = (
                    f"Antimeridian crossing detected ({bbox.min_lon}° to {bbox.max_lon}°): "
                    f"Query was split into {len(tiles)} sub-tiles across the International Date Line."
                )
            else:
                warning = (
                    f"Large Area of Interest: Query footprint was partitioned into {len(tiles)} sub-tiles "
                    f"(<= {max_tile_deg}°x{max_tile_deg}° each) to comply with NASA FIRMS Area API constraints."
                )

        return tiles, warning

    def fetch_area_observations(
        self,
        bbox: BoundingBox,
        day_range: int = 3,
        sources: Optional[List[str]] = None,
    ) -> Tuple[List[Observation], Optional[str]]:
        """
        Queries the NASA FIRMS Area API for all active fire observations in the specified
        bounding box over the requested day range across MODIS and VIIRS satellite sensors.
        Handles planetary scale overviews, antimeridian crossings, large bounding box tiling (<= 20° x 20°),
        parallel fetching across sensor-tile workers with connection pooling, and duplicate observation pruning.
        Returns (observations, diagnostic_warning).
        """
        map_key = self._require_map_key()
        clamped_day_range = max(1, min(5, int(day_range)))

        tiles, warning = self.decompose_bbox(bbox)
        if warning:
            logger.warning(f"[FIRMS API Tiling] {warning}")

        # Check if planetary footprint
        if bbox.min_lon > bbox.max_lon:
            total_lon_span = 360.0 - (bbox.min_lon - bbox.max_lon)
        else:
            total_lon_span = bbox.max_lon - bbox.min_lon
        total_lat_span = bbox.max_lat - bbox.min_lat
        is_planetary = (
            total_lon_span >= 120.0
            or total_lat_span >= 70.0
            or (total_lon_span * total_lat_span >= 6000.0)
        )

        # Sensor selection
        if sources:
            active_sources = sources
        elif is_planetary:
            # For planetary overview queries, select primary high-yield sensors for fast round-trips
            # VIIRS NOAA-20 (375m) + MODIS (1km) provides instant multi-sensor cross-validation worldwide
            active_sources = ["MODIS_NRT", "VIIRS_NOAA20_NRT"]
        else:
            active_sources = DEFAULT_FIRMS_SOURCES

        tasks: List[Tuple[str, BoundingBox]] = []
        for tile in tiles:
            for source in active_sources:
                tasks.append((source, tile))

        limits = httpx.Limits(max_keepalive_connections=15, max_connections=25)
        timeout_cfg = (
            httpx.Timeout(connect=8.0, read=15.0, write=8.0, pool=8.0)
            if is_planetary
            else httpx.Timeout(connect=10.0, read=25.0, write=10.0, pool=10.0)
        )

        with httpx.Client(timeout=timeout_cfg, limits=limits) as client:
            def _fetch_single_task(source: str, tile: BoundingBox) -> List[Observation]:
                url = self._build_url(map_key, source, tile, clamped_day_range)
                masked_url = mask_map_key(url)
                logger.info(f"[FIRMS API] Querying {source} tile [{tile.min_lon},{tile.min_lat},{tile.max_lon},{tile.max_lat}]: {masked_url}")
                try:
                    resp = client.get(url)
                except httpx.RequestError as exc:
                    logger.error(f"[FIRMS API] Network request error connecting to {masked_url}: {exc}")
                    if len(tasks) > 1:
                        return []
                    raise HTTPException(
                        status_code=502,
                        detail=f"Failed to reach NASA FIRMS server: {exc}",
                    )

                logger.info(f"[FIRMS API] Response HTTP {resp.status_code} for {source}")

                if resp.status_code != 200:
                    preview = resp.text[:200]
                    logger.error(f"[FIRMS API] Error HTTP {resp.status_code} from {masked_url}: {preview}")
                    if len(tasks) > 1:
                        return []
                    raise HTTPException(
                        status_code=502,
                        detail=f"NASA FIRMS API returned HTTP {resp.status_code}: {preview}",
                    )

                obs_list = self.parse_firms_csv_to_observations(resp.text, source)
                logger.info(f"[FIRMS API] Sensor {source} tile returned {len(obs_list)} valid observations.")
                return obs_list

            all_observations: List[Observation] = []
            max_workers = min(6, max(1, len(tasks))) if is_planetary else min(10, max(1, len(tasks)))
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                future_to_task = {
                    executor.submit(_fetch_single_task, s, t): (s, t)
                    for s, t in tasks
                }
                for future in as_completed(future_to_task):
                    try:
                        obs_list = future.result()
                        all_observations.extend(obs_list)
                    except Exception as exc:
                        source, tile = future_to_task[future]
                        logger.error(f"[FIRMS API Task Failed] {source} on tile: {exc}")
                        if len(tasks) == 1:
                            raise

        # Deduplicate overlapping detections across adjacent tiles
        dedup_dict: Dict[Tuple[float, float, Any, str, str], Observation] = {}
        for o in all_observations:
            key = (
                round(float(o.latitude), 4),
                round(float(o.longitude), 4),
                o.acq_datetime,
                str(o.instrument).upper(),
                str(o.satellite),
            )
            if key not in dedup_dict or (o.frp or 0.0) > (dedup_dict[key].frp or 0.0):
                dedup_dict[key] = o

        unique_observations = list(dedup_dict.values())
        modis_count = sum(1 for o in unique_observations if o.instrument == "MODIS")
        viirs_count = sum(1 for o in unique_observations if o.instrument == "VIIRS")
        logger.info(
            f"[FIRMS API Aggregation] Completed query ({len(tiles)} tiles, {len(tasks)} requests): "
            f"MODIS={modis_count}, VIIRS={viirs_count}, Unique Total={len(unique_observations)}."
        )

        return unique_observations, warning

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
