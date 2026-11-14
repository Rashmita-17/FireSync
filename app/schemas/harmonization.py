from datetime import datetime
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, model_validator
from app.schemas.observation import ObservationResponse


class BoundingBox(BaseModel):
    """
    Geographic bounding box in WGS84 coordinates (EPSG:4326).
    """
    min_lon: float = Field(..., ge=-180.0, le=180.0, description="Minimum longitude (West)")
    min_lat: float = Field(..., ge=-90.0, le=90.0, description="Minimum latitude (South)")
    max_lon: float = Field(..., ge=-180.0, le=180.0, description="Maximum longitude (East)")
    max_lat: float = Field(..., ge=-90.0, le=90.0, description="Maximum latitude (North)")

    @model_validator(mode="before")
    @classmethod
    def wrap_coordinates_before_validation(cls, data: Any) -> Any:
        """
        Intercepts raw input dictionary before field constraints to wrap longitudes
        outside [-180, 180] from infinite map panning (e.g. -232.73 -> 127.27).
        """
        if isinstance(data, dict):
            for k in ["min_lon", "max_lon"]:
                if k in data and isinstance(data[k], (int, float)):
                    lon = float(data[k])
                    if lon == 180.0:
                        data[k] = 180.0
                    elif lon == -180.0:
                        data[k] = -180.0
                    else:
                        wrapped = ((((lon + 180.0) % 360.0) + 360.0) % 360.0) - 180.0
                        if wrapped == -180.0 and lon > 0:
                            wrapped = 180.0
                        data[k] = round(wrapped, 4)
            for k in ["min_lat", "max_lat"]:
                if k in data and isinstance(data[k], (int, float)):
                    lat = float(data[k])
                    data[k] = round(max(-90.0, min(90.0, lat)), 4)
        return data

    @model_validator(mode="after")
    def validate_bounds(self) -> "BoundingBox":
        # Auto-detect and correct swapped Lon/Lat vs Lat/Lon orders:
        lats = [self.min_lat, self.max_lat]
        lons = [self.min_lon, self.max_lon]

        # Latitude cannot exceed [-90, 90] in EPSG:4326.
        # If user passed coordinates in [lat, lon] order where lon was > 90, swap them.
        if any(abs(l) > 90.0 for l in lats) and all(abs(l) <= 90.0 for l in lons):
            lats, lons = lons, lats

        # Normalize latitude boundaries strictly South <= North
        self.min_lat = float(min(lats))
        self.max_lat = float(max(lats))

        # Longitude validation:
        # Note: When min_lon > max_lon, this represents an antimeridian-crossing bounding box
        # (e.g. 170°E to 170°W). Only sort min/max if not crossing the antimeridian.
        # If drawn right-to-left by accident on non-antimeridian boxes (|lon1 - lon2| < 180), order them.
        lon1, lon2 = float(lons[0]), float(lons[1])
        if lon1 > lon2 and (lon1 - lon2) < 180.0:
            self.min_lon = lon2
            self.max_lon = lon1
        else:
            self.min_lon = lon1
            self.max_lon = lon2

        return self


class HarmonizationRequest(BaseModel):
    """
    Parameters for spatio-temporal harmonization query.
    """
    bbox: BoundingBox
    start_datetime: Optional[datetime] = Field(None, description="Start acquisition time filter (UTC)")
    end_datetime: Optional[datetime] = Field(None, description="End acquisition time filter (UTC)")
    
    # Clustering Hyperparameters
    spatial_bandwidth_km: float = Field(
        2.5,
        gt=0.0,
        le=50.0,
        description="Spatial proximity scaling (km) matching MODIS pixel footprint boundaries"
    )
    temporal_bandwidth_hours: float = Field(
        6.0,
        gt=0.0,
        le=168.0,
        description="Temporal coupling window (hours) for multi-satellite overpasses"
    )
    min_cluster_size: int = Field(
        2,
        ge=2,
        description="Minimum detections required to form a harmonized cluster"
    )
    min_samples: int = Field(
        1,
        ge=1,
        description="HDBSCAN min_samples parameter (neighborhood density sensitivity)"
    )
    cluster_selection_epsilon: float = Field(
        0.0,
        ge=0.0,
        description="HDBSCAN cluster_selection_epsilon"
    )

    # Optional Filters
    day_range: int = Field(
        3,
        ge=1,
        le=10,
        description="Lookback window in days (1-10) for NASA FIRMS queries"
    )
    use_live: Optional[bool] = Field(
        None,
        description="Whether to query live NASA FIRMS API directly"
    )
    instruments: Optional[List[str]] = Field(
        None,
        description="Filter by instruments (e.g. ['MODIS', 'VIIRS'])"
    )
    min_confidence: float = Field(
        0.0,
        ge=0.0,
        le=100.0,
        description="Minimum confidence threshold filter"
    )
    include_observations: bool = Field(
        False,
        description="Whether to include full raw member observations inside each cluster"
    )
    include_noise: bool = Field(
        False,
        description="Whether to return unclustered noise points"
    )


class HarmonizedCluster(BaseModel):
    """
    Synthesized spatio-temporal cluster representing a single ground event
    where sensor-of-origin bias and resolution differences have been resolved.
    """
    cluster_id: int = Field(..., description="Unique cluster identifier (-1 indicates noise)")
    
    # Spatial Centroid & Geometry
    centroid_lat: float = Field(..., description="Unweighted arithmetic mean latitude")
    centroid_lon: float = Field(..., description="Unweighted arithmetic mean longitude")
    weighted_centroid_lat: float = Field(..., description="FRP- and confidence-weighted latitude")
    weighted_centroid_lon: float = Field(..., description="FRP- and confidence-weighted longitude")
    
    # Temporal Extent
    first_detected: datetime = Field(..., description="Earliest detection UTC timestamp")
    last_detected: datetime = Field(..., description="Latest detection UTC timestamp")
    duration_hours: float = Field(..., description="Temporal lifespan of the cluster (hours)")
    
    # Sensor Breakdown (Resolving origin and footprint bias)
    total_detections: int = Field(..., description="Total combined detections across all sensors")
    modis_count: int = Field(..., description="Number of MODIS 1km detections")
    viirs_count: int = Field(..., description="Number of VIIRS 375m/750m detections")
    sensor_ratio: float = Field(..., description="Ratio of VIIRS detections to total detections")
    cross_validated: bool = Field(..., description="True if detected independently by BOTH MODIS and VIIRS")
    
    # Physical Energy & Footprint
    total_frp: float = Field(..., description="Integrated Fire Radiative Power (MW)")
    peak_frp: float = Field(..., description="Maximum detected FRP (MW)")
    mean_frp: float = Field(..., description="Mean FRP across detections (MW)")
    harmonized_confidence: float = Field(..., description="Unified Bayesian/sensor-fusion confidence score (0-100%)")
    estimated_area_km2: float = Field(..., description="Estimated ground physical area (km²) resolving sensor footprints")
    
    # Geographic Bounds & GeoJSON Feature Geometry
    bbox: List[float] = Field(..., description="Bounding box [min_lon, min_lat, max_lon, max_lat]")
    geojson_geometry: Dict[str, Any] = Field(..., description="GeoJSON Point or Polygon representation")
    
    # Optional member observations
    observations: Optional[List[ObservationResponse]] = Field(None, description="Member satellite detections")


class HarmonizationSummary(BaseModel):
    """
    High-level metadata and statistical synthesis of the harmonization run.
    """
    total_observations: int = Field(..., description="Number of input raw observations analyzed")
    total_clusters: int = Field(..., description="Number of unified spatio-temporal clusters identified")
    total_noise_points: int = Field(..., description="Number of isolated detections classified as noise")
    modis_detections: int = Field(..., description="Total MODIS raw detections in query bounding box")
    viirs_detections: int = Field(..., description="Total VIIRS raw detections in query bounding box")
    cross_validated_clusters: int = Field(..., description="Clusters verified by both MODIS and VIIRS")
    cross_validation_rate: float = Field(..., description="Fraction of clusters with multi-sensor confirmation")
    total_harmonized_frp_mw: float = Field(..., description="Sum of harmonized FRP across all active clusters")
    spatial_compression_ratio: float = Field(..., description="Raw detections divided by harmonized clusters")
    execution_time_ms: float = Field(..., description="Clustering pipeline runtime in milliseconds")


class HarmonizationResponse(BaseModel):
    """
    Complete response payload for /api/harmonize.
    """
    status: str = "success"
    query_bbox: BoundingBox
    summary: HarmonizationSummary
    clusters: List[HarmonizedCluster]
    noise_points: Optional[List[ObservationResponse]] = None
    warning: Optional[str] = Field(None, description="Diagnostic warning if box was tiled, clamped, or truncated")
    notice: Optional[str] = Field(None, description="User-facing notice for UI banners (e.g. lookback capped)")

