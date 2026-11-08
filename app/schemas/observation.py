from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class ObservationBase(BaseModel):
    latitude: float = Field(..., ge=-90.0, le=90.0, description="Latitude in decimal degrees (WGS84)")
    longitude: float = Field(..., ge=-180.0, le=180.0, description="Longitude in decimal degrees (WGS84)")
    acq_datetime: datetime = Field(..., description="UTC acquisition timestamp")
    instrument: str = Field(..., description="Sensor instrument ('MODIS' or 'VIIRS')")
    satellite: str = Field(..., description="Satellite platform (e.g. Terra, Aqua, Suomi-NPP, NOAA-20)")
    confidence: float = Field(..., ge=0.0, le=100.0, description="Normalized detection confidence (0-100%)")
    confidence_raw: Optional[str] = Field(None, description="Original raw confidence from FIRMS")
    frp: float = Field(0.0, ge=0.0, description="Fire Radiative Power (MW)")
    brightness: Optional[float] = Field(None, description="Brightness temperature (Kelvin)")
    scan: Optional[float] = Field(None, description="Pixel dimension along scan (km)")
    track: Optional[float] = Field(None, description="Pixel dimension along track (km)")
    daynight: Optional[str] = Field(None, description="Day ('D') or Night ('N') flag")
    source_file: Optional[str] = Field(None, description="Source file name or catalog ID")


class ObservationCreate(ObservationBase):
    pass


class ObservationResponse(ObservationBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

