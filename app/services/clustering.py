import math
import time
from datetime import datetime
from typing import List, Tuple, Dict, Any, Optional
import numpy as np
import pandas as pd
from scipy.spatial import ConvexHull
from sklearn.cluster import HDBSCAN

from app.core.config import settings
from app.models.observation import Observation
from app.schemas.harmonization import (
    HarmonizationRequest,
    HarmonizedCluster,
    HarmonizationSummary,
    HarmonizationResponse,
    BoundingBox,
)
from app.schemas.observation import ObservationResponse

EARTH_RADIUS_KM = 6371.0088


def angular_mean_deg(degrees: np.ndarray, weights: Optional[np.ndarray] = None) -> float:
    """
    Computes circular mean of geographic angles in degrees.
    Accurately handles the antimeridian / International Date Line (-180° / +180°) circular wrap.
    """
    rad = np.radians(degrees)
    if weights is not None and np.sum(weights) > 0:
        sin_sum = float(np.sum(np.sin(rad) * weights))
        cos_sum = float(np.sum(np.cos(rad) * weights))
    else:
        sin_sum = float(np.sum(np.sin(rad)))
        cos_sum = float(np.sum(np.cos(rad)))
    mean_rad = math.atan2(sin_sum, cos_sum)
    return float(np.degrees(mean_rad))


class SpatioTemporalClusteringEngine:
    """
    Spatio-Temporal Harmonization Engine for Multi-Sensor Satellite Data (MODIS & VIIRS).
    
    Resolves differences between:
    1. Spatial resolution: MODIS (1000m) vs VIIRS (375m / 750m)
    2. Overpass orbits & timing: Terra (AM/PM), Aqua (PM/AM), Suomi-NPP (PM/AM), NOAA-20/21 (PM/AM)
    3. Multi-pixel fire front fragmentation (VIIRS detects 4-9 pixels for every 1 MODIS pixel)
    
    Transforms geographic coordinates (lat, lon, datetime) into a metric cylindrical feature space
    and applies density-based clustering (HDBSCAN) to produce unified, sensor-agnostic ground events.
    """

    def __init__(
        self,
        spatial_bandwidth_km: float = 2.5,
        temporal_bandwidth_hours: float = 6.0,
        min_cluster_size: int = 3,
        min_samples: Optional[int] = None,
        cluster_selection_epsilon: float = 0.0,
    ):
        self.spatial_bandwidth_km = max(0.1, spatial_bandwidth_km)
        self.temporal_bandwidth_hours = max(0.1, temporal_bandwidth_hours)
        self.min_cluster_size = max(2, min_cluster_size)
        self.min_samples = max(1, min_samples) if min_samples is not None else None
        self.cluster_selection_epsilon = max(0.0, cluster_selection_epsilon)

    def _project_coordinates(
        self,
        lats: np.ndarray,
        lons: np.ndarray,
        datetimes: List[datetime]
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Projects spherical WGS84 geographic coordinates and timestamps to metric Cartesian space:
        - x_km, y_km: Local metric equirectangular planar projection centered at region centroid
          with longitudinal wrap handling across the antimeridian (-180 / +180) and worldwide latitude scaling.
        - t_hours: Elapsed hours from earliest detection
        """
        lat_center = float(np.mean(lats))
        lon_center = angular_mean_deg(lons)

        # Longitudinal difference wrapped around circle [-180, 180]
        dlon_deg = ((lons - lon_center + 180.0) % 360.0) - 180.0
        dlon_rad = np.radians(dlon_deg)
        dlat_rad = np.radians(lats - lat_center)
        lat_center_rad = math.radians(lat_center)

        # Planar projection centered at region centroid
        # Works worldwide: cos(-lat) == cos(lat) ensures correct scaling in southern hemisphere
        x_km = EARTH_RADIUS_KM * dlon_rad * math.cos(lat_center_rad)
        y_km = EARTH_RADIUS_KM * dlat_rad

        # Temporal dimension in hours
        t0 = min(datetimes)
        t_hours = np.array([(dt - t0).total_seconds() / 3600.0 for dt in datetimes])

        return x_km, y_km, t_hours

    def _build_feature_matrix(
        self,
        x_km: np.ndarray,
        y_km: np.ndarray,
        t_hours: np.ndarray
    ) -> np.ndarray:
        """
        Constructs normalized feature matrix scaled by spatial and temporal bandwidths:
        X = [x / S, y / S, t / T]
        
        Under this metric space, a distance of 1.0 represents exactly S km in space or T hours in time.
        """
        x_scaled = x_km / self.spatial_bandwidth_km
        y_scaled = y_km / self.spatial_bandwidth_km
        t_scaled = t_hours / self.temporal_bandwidth_hours
        
        return np.column_stack([x_scaled, y_scaled, t_scaled])

    def _calculate_convex_hull_geometry(
        self,
        cluster_lons: np.ndarray,
        cluster_lats: np.ndarray,
        cluster_x: np.ndarray,
        cluster_y: np.ndarray,
        pixel_nominal_area_km2: float
    ) -> Tuple[float, Dict[str, Any]]:
        """
        Calculates estimated ground area (km²) and GeoJSON geometry resolving sensor resolution differences.
        Uses 2D Convex Hull when >= 3 non-collinear detections are present, buffered with nominal pixel area.
        """
        n_points = len(cluster_lons)
        
        if n_points >= 3:
            pts_metric = np.column_stack([cluster_x, cluster_y])
            try:
                hull = ConvexHull(pts_metric)
                polygon_area_km2 = float(hull.volume)  # In 2D, hull.volume is polygon area
                
                # Extract hull boundary coordinates in [lon, lat] for GeoJSON
                hull_indices = list(hull.vertices)
                # Close the polygon loop
                hull_indices.append(hull_indices[0])
                coords = [[float(cluster_lons[i]), float(cluster_lats[i])] for i in hull_indices]
                
                geojson = {
                    "type": "Polygon",
                    "coordinates": [coords]
                }
                # Effective area includes convex hull polygon + half-pixel buffer along perimeter
                effective_area = max(polygon_area_km2, pixel_nominal_area_km2)
                return effective_area, geojson
            except Exception:
                # Fallback for collinear points
                pass

        # For 1-2 points or collinear geometries, represent as Point or small footprint
        centroid_lon = angular_mean_deg(cluster_lons)
        centroid_lat = float(np.mean(cluster_lats))
        geojson = {
            "type": "Point",
            "coordinates": [round(centroid_lon, 6), round(centroid_lat, 6)]
        }
        return float(pixel_nominal_area_km2), geojson

    def harmonize(
        self,
        observations: List[Observation],
        query_bbox: BoundingBox,
        include_observations: bool = False,
        include_noise: bool = False,
        warning: Optional[str] = None,
    ) -> HarmonizationResponse:
        """
        Main pipeline: Ingests observation objects, runs spatio-temporal HDBSCAN,
        and synthesizes unified harmonized clusters.
        """
        start_time_sec = time.perf_counter()
        
        if not observations:
            execution_time = (time.perf_counter() - start_time_sec) * 1000.0
            return HarmonizationResponse(
                status="success",
                query_bbox=query_bbox,
                summary=HarmonizationSummary(
                    total_observations=0,
                    total_clusters=0,
                    total_noise_points=0,
                    modis_detections=0,
                    viirs_detections=0,
                    cross_validated_clusters=0,
                    cross_validation_rate=0.0,
                    total_harmonized_frp_mw=0.0,
                    spatial_compression_ratio=1.0,
                    execution_time_ms=execution_time,
                ),
                clusters=[],
                noise_points=[] if include_noise else None,
                warning=warning,
            )

        # Convert to working numpy / pandas vectors for vectorized computation
        obs_dicts = []
        for o in observations:
            obs_dicts.append({
                "id": o.id,
                "latitude": o.latitude,
                "longitude": o.longitude,
                "acq_datetime": o.acq_datetime,
                "instrument": str(o.instrument).upper(),
                "satellite": str(o.satellite),
                "confidence": float(o.confidence),
                "frp": float(o.frp or 0.0),
                "brightness": float(o.brightness) if o.brightness is not None else None,
                "scan": float(o.scan) if o.scan is not None else (
                    settings.MODIS_PIXEL_KM if "MODIS" in str(o.instrument).upper() else settings.VIIRS_I_BAND_KM
                ),
                "track": float(o.track) if o.track is not None else (
                    settings.MODIS_PIXEL_KM if "MODIS" in str(o.instrument).upper() else settings.VIIRS_I_BAND_KM
                ),
                "daynight": o.daynight,
                "confidence_raw": o.confidence_raw,
                "source_file": o.source_file,
                "created_at": o.created_at,
                "obj": o,
            })
            
        df = pd.DataFrame(obs_dicts)
        lats = df["latitude"].to_numpy()
        lons = df["longitude"].to_numpy()
        dts = df["acq_datetime"].tolist()

        # 1. Coordinate projection to metric space
        x_km, y_km, t_hours = self._project_coordinates(lats, lons, dts)
        df["x_km"] = x_km
        df["y_km"] = y_km
        df["t_hours"] = t_hours

        # 2. Spatio-temporal normalized feature scaling
        X = self._build_feature_matrix(x_km, y_km, t_hours)

        # 3. Fit HDBSCAN clustering
        if len(df) < self.min_cluster_size:
            # When points inside the AOI are below the HDBSCAN density threshold,
            # synthesize them into an active fire event cluster rather than discarding as zero events.
            labels = np.zeros(len(df), dtype=int)
        else:
            try:
                hdbscan = HDBSCAN(
                    min_cluster_size=self.min_cluster_size,
                    min_samples=self.min_samples,
                    metric="euclidean",
                    cluster_selection_epsilon=self.cluster_selection_epsilon,
                    allow_single_cluster=True,
                    copy=True,
                )
                labels = hdbscan.fit_predict(X)
            except (TypeError, ValueError) as err:
                if "only 0-dimensional arrays can be converted to Python scalars" in str(err):
                    # Compatibility fallback for scikit-learn 1.9+ Cython epsilon_search on numpy 2.x
                    hdbscan = HDBSCAN(
                        min_cluster_size=self.min_cluster_size,
                        min_samples=self.min_samples,
                        metric="euclidean",
                        cluster_selection_epsilon=0.0,
                        allow_single_cluster=True,
                        copy=True,
                    )
                    labels = hdbscan.fit_predict(X)
                else:
                    raise

        df["cluster_label"] = labels

        # 4. Synthesize clusters and resolve sensor differences
        clusters: List[HarmonizedCluster] = []
        modis_total_detections = int((df["instrument"] == "MODIS").sum())
        viirs_total_detections = int((df["instrument"] == "VIIRS").sum())
        cross_val_clusters_count = 0
        total_harmonized_frp = 0.0

        # Efficient single groupby over valid clusters instead of O(N*C) boolean masking
        valid_clusters_df = df[df["cluster_label"] != -1]
        grouped = valid_clusters_df.groupby("cluster_label", sort=True)

        for label, cluster_df in grouped:
            n_det = len(cluster_df)
            
            # Sensor composition
            modis_count = int((cluster_df["instrument"] == "MODIS").sum())
            viirs_count = int((cluster_df["instrument"] == "VIIRS").sum())
            is_cross_validated = (modis_count > 0 and viirs_count > 0)
            if is_cross_validated:
                cross_val_clusters_count += 1

            # Centroids
            mean_lat = float(cluster_df["latitude"].mean())
            mean_lon = angular_mean_deg(cluster_df["longitude"].to_numpy())
            
            # Weighted Centroid (weighted by FRP and confidence)
            # Detections with higher energy and confidence have higher spatial certainty
            weights = np.maximum(cluster_df["frp"].to_numpy(), 0.1) * (cluster_df["confidence"].to_numpy() / 100.0)
            w_sum = weights.sum()
            if w_sum > 0:
                weighted_lat = float(np.sum(cluster_df["latitude"].to_numpy() * weights) / w_sum)
                weighted_lon = angular_mean_deg(cluster_df["longitude"].to_numpy(), weights=weights)
            else:
                weighted_lat = mean_lat
                weighted_lon = mean_lon

            # Temporal boundaries
            first_det = cluster_df["acq_datetime"].min()
            last_det = cluster_df["acq_datetime"].max()
            duration_h = float((last_det - first_det).total_seconds() / 3600.0)

            # Fire Radiative Power (MW)
            # For harmonized clusters, total FRP is integrated over the fire complex
            c_total_frp = float(cluster_df["frp"].sum())
            c_peak_frp = float(cluster_df["frp"].max())
            c_mean_frp = float(cluster_df["frp"].mean())
            total_harmonized_frp += c_total_frp

            # Unified Harmonized Confidence Score (0 - 100%)
            # Baseline is weighted confidence of member detections.
            # If cross-validated by both MODIS and VIIRS independently, add sensor fusion validation bonus!
            base_confidence = float(np.average(cluster_df["confidence"], weights=np.maximum(cluster_df["frp"], 0.1)))
            if is_cross_validated:
                harmonized_conf = min(100.0, base_confidence + settings.CROSS_SENSOR_CONFIDENCE_BONUS)
            else:
                harmonized_conf = base_confidence

            # Bounding box of detections
            c_min_lon = float(cluster_df["longitude"].min())
            c_min_lat = float(cluster_df["latitude"].min())
            c_max_lon = float(cluster_df["longitude"].max())
            c_max_lat = float(cluster_df["latitude"].max())

            # Nominal pixel area resolving sensor footprint:
            # Sum of individual footprint contributions divided by density / overlap
            pixel_nominal_area = float((cluster_df["scan"] * cluster_df["track"]).mean())
            
            # Calculate convex hull geometry and estimated area (km²)
            estimated_area_km2, geojson_geom = self._calculate_convex_hull_geometry(
                cluster_df["longitude"].to_numpy(),
                cluster_df["latitude"].to_numpy(),
                cluster_df["x_km"].to_numpy(),
                cluster_df["y_km"].to_numpy(),
                pixel_nominal_area_km2=pixel_nominal_area
            )

            # Member observations if requested (direct model validation without to_dict overhead)
            member_obs = None
            if include_observations:
                member_obs = [
                    ObservationResponse.model_validate(obj)
                    for obj in cluster_df["obj"].tolist()
                ]

            cluster_item = HarmonizedCluster(
                cluster_id=int(label),
                centroid_lat=round(mean_lat, 6),
                centroid_lon=round(mean_lon, 6),
                weighted_centroid_lat=round(weighted_lat, 6),
                weighted_centroid_lon=round(weighted_lon, 6),
                first_detected=first_det,
                last_detected=last_det,
                duration_hours=round(duration_h, 2),
                total_detections=n_det,
                modis_count=modis_count,
                viirs_count=viirs_count,
                sensor_ratio=round(viirs_count / max(1, n_det), 3),
                cross_validated=is_cross_validated,
                total_frp=round(c_total_frp, 2),
                peak_frp=round(c_peak_frp, 2),
                mean_frp=round(c_mean_frp, 2),
                harmonized_confidence=round(harmonized_conf, 1),
                estimated_area_km2=round(estimated_area_km2, 3),
                bbox=[round(c_min_lon, 6), round(c_min_lat, 6), round(c_max_lon, 6), round(c_max_lat, 6)],
                geojson_geometry=geojson_geom,
                observations=member_obs,
            )
            clusters.append(cluster_item)

        # Sort clusters by total FRP descending
        clusters.sort(key=lambda c: c.total_frp, reverse=True)

        # Noise points
        noise_points_list: Optional[List[ObservationResponse]] = None
        noise_df = df[df["cluster_label"] == -1]
        noise_count = len(noise_df)
        if include_noise and noise_count > 0:
            noise_points_list = [
                ObservationResponse.model_validate(item["obj"])
                for item in noise_df.to_dict(orient="records")
            ]

        # Calculate high-level summary metrics
        total_obs = len(df)
        total_clust = len(clusters)
        cross_val_rate = (cross_val_clusters_count / max(1, total_clust)) if total_clust > 0 else 0.0
        compression_ratio = (total_obs / max(1, total_clust)) if total_clust > 0 else 1.0
        exec_time_ms = (time.perf_counter() - start_time_sec) * 1000.0

        summary = HarmonizationSummary(
            total_observations=total_obs,
            total_clusters=total_clust,
            total_noise_points=noise_count,
            modis_detections=modis_total_detections,
            viirs_detections=viirs_total_detections,
            cross_validated_clusters=cross_val_clusters_count,
            cross_validation_rate=round(cross_val_rate, 4),
            total_harmonized_frp_mw=round(total_harmonized_frp, 2),
            spatial_compression_ratio=round(compression_ratio, 2),
            execution_time_ms=round(exec_time_ms, 2),
        )

        return HarmonizationResponse(
            status="success",
            query_bbox=query_bbox,
            summary=summary,
            clusters=clusters,
            noise_points=noise_points_list,
            warning=warning,
        )
