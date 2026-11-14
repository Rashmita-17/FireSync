import time
import threading
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional, Tuple
import numpy as np

from app.core.config import settings
from app.models.observation import Observation
from app.schemas.harmonization import BoundingBox, HarmonizationResponse


def is_large_area(bbox: BoundingBox, threshold_deg: Optional[float] = None) -> bool:
    """
    Checks if a bounding box exceeds the configured large-area threshold
    in either longitudinal span, latitudinal span, or total angular area (deg^2).
    """
    thresh = threshold_deg or settings.LARGE_AREA_DEGREE_THRESHOLD
    if bbox.min_lon > bbox.max_lon:
        lon_span = 360.0 - (bbox.min_lon - bbox.max_lon)
    else:
        lon_span = abs(bbox.max_lon - bbox.min_lon)
    lat_span = abs(bbox.max_lat - bbox.min_lat)
    
    return (
        lon_span > thresh
        or lat_span > thresh
        or (lon_span * lat_span) > (thresh * thresh)
    )


def thin_observations(
    observations: List[Observation],
    cell_size_deg: float = 0.35,
    min_confidence: float = 30.0,
) -> List[Observation]:
    """
    Thins dense large-area observation sets before HDBSCAN clustering:
    1. Filters out low-confidence detections (< min_confidence) to eliminate sensor glints.
    2. Spatial grid-bins detections into ~0.35° cells (~35 km), aggregating:
       - Summed FRP per cell per sensor (MODIS vs VIIRS)
       - Max confidence score per cell
       - Energy-weighted centroid within each grid cell
       - Distinct sensor flags to preserve multi-sensor cross-validation.
    """
    if not observations:
        return []

    # 1. Filter out low-confidence detections
    filtered = [o for o in observations if (o.confidence or 0.0) >= min_confidence]
    if not filtered:
        filtered = observations

    # 2. Grid-bin into spatial cells per sensor instrument
    bins: Dict[Tuple[int, int, str], Dict[str, Any]] = {}
    for o in filtered:
        lat_idx = int(np.floor(o.latitude / cell_size_deg))
        lon_idx = int(np.floor(o.longitude / cell_size_deg))
        inst = str(o.instrument).upper()
        key = (lat_idx, lon_idx, inst)

        if key not in bins:
            bins[key] = {
                "lats": [],
                "lons": [],
                "frps": [],
                "confs": [],
                "dts": [],
                "sat": o.satellite,
                "inst": inst,
                "daynight": o.daynight,
                "scan": o.scan,
                "track": o.track,
                "source_file": o.source_file,
            }
        b = bins[key]
        b["lats"].append(o.latitude)
        b["lons"].append(o.longitude)
        b["frps"].append(o.frp or 0.0)
        b["confs"].append(o.confidence or 50.0)
        b["dts"].append(o.acq_datetime)

    thinned: List[Observation] = []
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)

    for idx, (key, b) in enumerate(bins.items(), 1):
        tot_frp = float(sum(b["frps"]))
        max_conf = float(max(b["confs"]))

        # FRP-weighted centroid within cell
        if tot_frp > 0 and len(b["lats"]) > 1:
            w = np.array(b["frps"])
            w_sum = float(w.sum())
            avg_lat = float(np.sum(np.array(b["lats"]) * w) / w_sum)
            avg_lon = float(np.sum(np.array(b["lons"]) * w) / w_sum)
        else:
            avg_lat = float(np.mean(b["lats"]))
            avg_lon = float(np.mean(b["lons"]))

        rep_dt = min(b["dts"]) if b["dts"] else now_utc

        thinned.append(Observation(
            id=idx,
            latitude=round(avg_lat, 4),
            longitude=round(avg_lon, 4),
            acq_datetime=rep_dt,
            instrument=b["inst"],
            satellite=b["sat"],
            confidence=max_conf,
            frp=round(tot_frp, 2),
            brightness=None,
            scan=b["scan"],
            track=b["track"],
            daynight=b["daynight"],
            source_file=b["source_file"],
            created_at=now_utc,
        ))

    return thinned


class LargeAreaCache:
    """
    Thread-safe in-memory TTL cache for large-area harmonization responses.
    Caches expensive planet-scale results for fast repeat queries (default 15 mins).
    """

    def __init__(self, ttl_seconds: Optional[int] = None):
        self._ttl = ttl_seconds or settings.LARGE_AREA_CACHE_TTL_SECONDS
        self._cache: Dict[Tuple, Tuple[float, HarmonizationResponse]] = {}
        self._lock = threading.Lock()

    def _make_key(
        self,
        bbox: BoundingBox,
        day_range: int,
        instruments: Optional[List[str]] = None,
    ) -> Tuple:
        inst_tuple = tuple(sorted([str(i).upper() for i in instruments])) if instruments else ()
        return (
            round(bbox.min_lon, 2),
            round(bbox.min_lat, 2),
            round(bbox.max_lon, 2),
            round(bbox.max_lat, 2),
            int(day_range),
            inst_tuple,
        )

    def get(
        self,
        bbox: BoundingBox,
        day_range: int,
        instruments: Optional[List[str]] = None,
    ) -> Optional[HarmonizationResponse]:
        key = self._make_key(bbox, day_range, instruments)
        with self._lock:
            if key in self._cache:
                timestamp, response = self._cache[key]
                if (time.time() - timestamp) <= self._ttl:
                    return response
                else:
                    del self._cache[key]
        return None

    def set(
        self,
        bbox: BoundingBox,
        day_range: int,
        response: HarmonizationResponse,
        instruments: Optional[List[str]] = None,
    ) -> None:
        key = self._make_key(bbox, day_range, instruments)
        with self._lock:
            self._cache[key] = (time.time(), response)

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()


large_area_cache = LargeAreaCache()
