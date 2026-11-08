from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field


class Settings(BaseSettings):
    """
    Application configuration settings for the NASA MODIS-VIIRS Harmonization Service.
    Configurable via environment variables or .env file.
    """
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True)

    PROJECT_NAME: str = "NASA Space Apps: MODIS & VIIRS Harmonization Engine"
    API_V1_STR: str = "/api"
    DEBUG: bool = False
    
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


settings = Settings()
