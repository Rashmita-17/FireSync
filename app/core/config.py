import os
from typing import List, Optional
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field


class Settings(BaseSettings):
    """
    Application configuration settings for the NASA MODIS-VIIRS Harmonization Service.
    Configurable via environment variables or .env file.
    """
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore"
    )

    PROJECT_NAME: str = "NASA Space Apps: MODIS & VIIRS Harmonization Engine"
    API_V1_STR: str = "/api"
    DEBUG: bool = False

    # NASA FIRMS API Map Key (read from MAP_KEY or FIRMS_MAP_KEY)
    MAP_KEY: Optional[str] = Field(default=None, description="NASA FIRMS API Map Key")
    FIRMS_MAP_KEY: Optional[str] = Field(default=None, description="NASA FIRMS API Map Key (alternate)")

    # CORS Allowed Origins (comma-separated or wildcard)
    ALLOWED_ORIGINS: str = Field(
        default="http://localhost:3000,http://127.0.0.1:3000,http://localhost:8000,http://127.0.0.1:8000",
        description="Comma-separated list of allowed CORS origins"
    )

    # Database Settings
    DATABASE_URL: str = Field(
        default="sqlite:///./data/nasa_observations.db",
        description="SQLAlchemy Database connection URI"
    )

    # Default Spatio-Temporal Clustering Hyperparameters
    DEFAULT_SPATIAL_BANDWIDTH_KM: float = Field(
        default=2.5,
        description="Spatial proximity threshold in kilometers (matching MODIS ~1-2km pixel footprint boundary)"
    )
    DEFAULT_TEMPORAL_BANDWIDTH_HOURS: float = Field(
        default=6.0,
        description="Temporal coupling window in hours (to cluster multi-satellite overpasses within the same diurnal cycle)"
    )
    DEFAULT_MIN_CLUSTER_SIZE: int = Field(
        default=3,
        description="Minimum detections to form a harmonized event cluster"
    )
    DEFAULT_MIN_SAMPLES: int = Field(
        default=1,
        description="HDBSCAN min_samples parameter (neighborhood density threshold)"
    )
    DEFAULT_CLUSTER_EPSILON: float = Field(
        default=0.5,
        description="HDBSCAN cluster_selection_epsilon (in normalized spatio-temporal metric units, e.g. ~1.25 km)"
    )

    # Sensor Characteristics
    MODIS_PIXEL_KM: float = 1.0       # 1000m nominal spatial resolution
    VIIRS_I_BAND_KM: float = 0.375    # 375m spatial resolution (VNP14IMG)
    VIIRS_M_BAND_KM: float = 0.750    # 750m spatial resolution (VNP14)

    # Confidence calibration bonus for multi-sensor cross-validated detections
    CROSS_SENSOR_CONFIDENCE_BONUS: float = 15.0

    # Large-Area Threshold & Cache Configuration
    LARGE_AREA_DEGREE_THRESHOLD: float = Field(
        default=40.0,
        description="Threshold in degrees (dimension or sqrt of area in deg^2) above which an AOI is treated as large-area"
    )
    LARGE_AREA_ROW_THRESHOLD: int = Field(
        default=40000,
        description="Raw observation count threshold above which thinning is applied"
    )
    LARGE_AREA_CACHE_TTL_SECONDS: int = Field(
        default=900,
        description="In-memory TTL cache duration in seconds (default 15 minutes) for large-area queries"
    )

    def get_map_key(self) -> str:
        """Returns the configured NASA FIRMS MAP_KEY from settings or OS environment."""
        key = self.MAP_KEY or self.FIRMS_MAP_KEY or os.environ.get("MAP_KEY") or os.environ.get("FIRMS_MAP_KEY") or ""
        return key.strip()

    def get_cors_origins(self) -> List[str]:
        """Parses comma-separated ALLOWED_ORIGINS into a clean list of origins."""
        raw = os.environ.get("ALLOWED_ORIGINS") or self.ALLOWED_ORIGINS or ""
        if not raw or raw.strip() == "*":
            return ["*"]
        return [origin.strip() for origin in raw.split(",") if origin.strip()]


settings = Settings()
