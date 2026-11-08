from datetime import datetime
from sqlalchemy import Column, Integer, Float, String, DateTime, Index
from app.core.database import Base


class Observation(Base):
    """
    SQLAlchemy model representing a raw satellite observation (e.g. Active Fire / Thermal Anomaly)
    from NASA FIRMS historical archives (MODIS on Terra/Aqua or VIIRS on Suomi-NPP/NOAA-20/NOAA-21).
    """
    __tablename__ = "observations"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    
    # Spatial coordinates (WGS84 EPSG:4326)
    latitude = Column(Float, nullable=False, index=True)
    longitude = Column(Float, nullable=False, index=True)
    
    # Temporal timestamp (UTC)
    acq_datetime = Column(DateTime, nullable=False, index=True)
    
    # Satellite and Sensor metadata
    instrument = Column(String(20), nullable=False, index=True)  # 'MODIS' or 'VIIRS'
    satellite = Column(String(50), nullable=False)               # 'Terra', 'Aqua', 'Suomi-NPP', 'NOAA-20', 'NOAA-21'
    
    # Observation physical parameters
    confidence = Column(Float, nullable=False, default=50.0)      # Normalized confidence score [0.0 - 100.0]
    confidence_raw = Column(String(20), nullable=True)           # Original raw value (e.g., 'nominal', 'high', '85')
    frp = Column(Float, nullable=False, default=0.0)             # Fire Radiative Power (MW)
    brightness = Column(Float, nullable=True)                    # Brightness temperature (Kelvin)
    
    # Sensor pixel resolution footprint (km)
    scan = Column(Float, nullable=True)                          # Pixel dimension along scan direction (km)
    track = Column(Float, nullable=True)                         # Pixel dimension along track direction (km)
    
    # Overpass context
    daynight = Column(String(5), nullable=True)                  # 'D' (day) or 'N' (night)
    
    # Ingestion provenance
    source_file = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Composite indices for spatial and spatio-temporal range queries
    __table_args__ = (
        Index("idx_obs_lat_lon", "latitude", "longitude"),
        Index("idx_obs_bbox_time", "latitude", "longitude", "acq_datetime"),
        Index("idx_obs_instrument_time", "instrument", "acq_datetime"),
    )

    def __repr__(self) -> str:
        return (
            f"<Observation(id={self.id}, instrument='{self.instrument}', "
            f"sat='{self.satellite}', lat={self.latitude:.4f}, lon={self.longitude:.4f}, "
            f"time='{self.acq_datetime}', frp={self.frp})>"
        )

