import io
import time
from datetime import datetime, time as dtime
from typing import Dict, Any, Optional, Union, BinaryIO, Tuple
import numpy as np
import pandas as pd
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.observation import Observation


class IngestionReport:
    """
    Metadata report returned after an ingestion operation.
    """
    def __init__(self, filename: str):
        self.filename = filename
        self.total_rows_read: int = 0
        self.valid_rows_inserted: int = 0
        self.skipped_rows: int = 0
        self.modis_rows: int = 0
        self.viirs_rows: int = 0
        self.duration_seconds: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "filename": self.filename,
            "total_rows_read": self.total_rows_read,
            "valid_rows_inserted": self.valid_rows_inserted,
            "skipped_rows": self.skipped_rows,
            "modis_count": self.modis_rows,
            "viirs_count": self.viirs_rows,
            "duration_seconds": round(self.duration_seconds, 3),
        }


class DataIngestionService:
    """
    Senior Data Engineer batch ingestion pipeline for NASA FIRMS historical datasets.
    Handles schema variations across MODIS (Terra/Aqua) and VIIRS (S-NPP/NOAA-20/NOAA-21).
    Utilizes Pandas chunking and SQLAlchemy bulk mapping for high-throughput ingestion.
    """

    CONFIDENCE_VIIRS_MAP = {
        "l": 30.0,
        "low": 30.0,
        "n": 70.0,
        "nominal": 70.0,
        "h": 95.0,
        "high": 95.0,
    }

    @staticmethod
    def _normalize_column_names(df: pd.DataFrame) -> pd.DataFrame:
        """Standardize column names to lowercase and stripped characters."""
        df.columns = [str(col).strip().lower() for col in df.columns]
        return df

    @classmethod
    def _parse_confidence(cls, row_series: pd.Series, instrument: str) -> Tuple[float, str]:
        """
        Normalizes confidence between MODIS (0-100 numerical) and VIIRS (low/nominal/high categorical).
        Returns (normalized_float_0_to_100, raw_string).
        """
        raw_val = row_series.get("confidence")
        if pd.isna(raw_val) or raw_val is None:
            return 50.0, "50"

        raw_str = str(raw_val).strip()

        # Check categorical (common in VIIRS)
        lower_str = raw_str.lower()
        if lower_str in cls.CONFIDENCE_VIIRS_MAP:
            return cls.CONFIDENCE_VIIRS_MAP[lower_str], raw_str

        # Check numerical (common in MODIS or converted VIIRS)
        try:
            val_float = float(raw_str)
            clamped = max(0.0, min(100.0, val_float))
            return clamped, raw_str
        except ValueError:
            return 50.0, raw_str

    @staticmethod
    def _parse_acq_datetime(date_val: Any, time_val: Any) -> Optional[datetime]:
        """
        Parses acq_date ('2023-08-15') and acq_time ('0345' or 345) into standard UTC datetime.
        """
        if pd.isna(date_val) or date_val is None:
            return None

        # Parse date component
        date_str = str(date_val).strip()
        try:
            if "-" in date_str:
                d = datetime.strptime(date_str, "%Y-%m-%d").date()
            elif "/" in date_str:
                d = datetime.strptime(date_str, "%Y/%m/%d").date()
            else:
                d = pd.to_datetime(date_str).date()
        except Exception:
            return None

        # Parse time component (e.g. '0345', '345', '1420')
        if pd.isna(time_val) or time_val is None:
            return datetime.combine(d, dtime(0, 0))

        time_str = str(time_val).strip().split(".")[0].zfill(4)
        try:
            hh = int(time_str[:2])
            mm = int(time_str[2:4])
            hh = max(0, min(23, hh))
            mm = max(0, min(59, mm))
            return datetime.combine(d, dtime(hh, mm))
        except Exception:
            return datetime.combine(d, dtime(0, 0))

    def ingest_dataframe(
        self,
        df: pd.DataFrame,
        db: Session,
        source_name: str = "dataframe",
        chunk_size: int = 1000
    ) -> IngestionReport:
        """
        Ingests a pre-loaded Pandas DataFrame into the Observation database table.
        """
        start_time = time.perf_counter()
        report = IngestionReport(filename=source_name)
        report.total_rows_read = len(df)

        if df.empty:
            report.duration_seconds = time.perf_counter() - start_time
            return report

        df = self._normalize_column_names(df)

        # Coordinate column checks
        lat_col = next((c for c in ["latitude", "lat"] if c in df.columns), None)
        lon_col = next((c for c in ["longitude", "lon", "long"] if c in df.columns), None)

        if not lat_col or not lon_col:
            raise ValueError(f"Missing required latitude/longitude columns in {source_name}. Found: {list(df.columns)}")

        # Drop invalid coordinates
        valid_coords = (
            df[lat_col].notna() &
            df[lon_col].notna() &
            (pd.to_numeric(df[lat_col], errors="coerce").between(-90.0, 90.0)) &
            (pd.to_numeric(df[lon_col], errors="coerce").between(-180.0, 180.0))
        )
        clean_df = df[valid_coords].copy()
        report.skipped_rows = len(df) - len(clean_df)

        if clean_df.empty:
            report.duration_seconds = time.perf_counter() - start_time
            return report

        # Detect instrument / satellite columns
        has_instrument = "instrument" in clean_df.columns
        has_satellite = "satellite" in clean_df.columns

        records_to_insert = []
        for _, row in clean_df.iterrows():
            lat = float(row[lat_col])
            lon = float(row[lon_col])

            # Timestamp parsing
            if "acq_datetime" in row and pd.notna(row["acq_datetime"]):
                dt = pd.to_datetime(row["acq_datetime"]).to_pydatetime()
            else:
                date_val = row.get("acq_date")
                time_val = row.get("acq_time")
                dt = self._parse_acq_datetime(date_val, time_val)
                if dt is None:
                    report.skipped_rows += 1
                    continue

            # Instrument identification
            if has_instrument and pd.notna(row["instrument"]):
                inst = str(row["instrument"]).strip().upper()
                if "MODIS" in inst:
                    instrument_name = "MODIS"
                elif "VIIRS" in inst:
                    instrument_name = "VIIRS"
                else:
                    instrument_name = inst
            else:
                # Infer from satellite or brightness columns
                sat_raw = str(row.get("satellite", "")).upper()
                if "TERRA" in sat_raw or "AQUA" in sat_raw:
                    instrument_name = "MODIS"
                elif "NPP" in sat_raw or "NOAA" in sat_raw or "JPSS" in sat_raw:
                    instrument_name = "VIIRS"
                elif "bright_ti4" in row:
                    instrument_name = "VIIRS"
                else:
                    instrument_name = "MODIS"

            # Satellite platform
            satellite_name = str(row.get("satellite", "Unknown")).strip()

            # Confidence normalization
            norm_conf, raw_conf = self._parse_confidence(row, instrument_name)

            # FRP (Fire Radiative Power)
            frp_raw = row.get("frp", 0.0)
            try:
                frp_val = float(frp_raw) if pd.notna(frp_raw) else 0.0
                frp_val = max(0.0, frp_val)
            except (ValueError, TypeError):
                frp_val = 0.0

            # Brightness temperature
            brightness_val = None
            for bcol in ["brightness", "bright_ti4", "bright_t31"]:
                if bcol in row and pd.notna(row[bcol]):
                    try:
                        brightness_val = float(row[bcol])
                        break
                    except (ValueError, TypeError):
                        pass

            # Scan and Track pixel footprint dimensions
            scan_raw = row.get("scan")
            track_raw = row.get("track")
            scan_val = None
            track_val = None
            try:
                if pd.notna(scan_raw):
                    scan_val = float(scan_raw)
            except (ValueError, TypeError):
                pass
            try:
                if pd.notna(track_raw):
                    track_val = float(track_raw)
            except (ValueError, TypeError):
                pass

            # Fallback nominal resolution if missing
            if scan_val is None or track_val is None:
                if instrument_name == "VIIRS":
                    scan_val = scan_val or settings.VIIRS_I_BAND_KM
                    track_val = track_val or settings.VIIRS_I_BAND_KM
                else:
                    scan_val = scan_val or settings.MODIS_PIXEL_KM
                    track_val = track_val or settings.MODIS_PIXEL_KM

            daynight_val = str(row.get("daynight", "D")).strip().upper()[:1]

            if instrument_name == "MODIS":
                report.modis_rows += 1
            else:
                report.viirs_rows += 1

            records_to_insert.append({
                "latitude": lat,
                "longitude": lon,
                "acq_datetime": dt,
                "instrument": instrument_name,
                "satellite": satellite_name,
                "confidence": norm_conf,
                "confidence_raw": raw_conf,
                "frp": frp_val,
                "brightness": brightness_val,
                "scan": scan_val,
                "track": track_val,
                "daynight": daynight_val,
                "source_file": source_name,
                "created_at": datetime.utcnow(),
            })

            # Bulk insert in batches to maintain high throughput and minimize memory footprint
            if len(records_to_insert) >= chunk_size:
                db.bulk_insert_mappings(Observation, records_to_insert)
                db.commit()
                report.valid_rows_inserted += len(records_to_insert)
                records_to_insert = []

        # Flush remainder
        if records_to_insert:
            db.bulk_insert_mappings(Observation, records_to_insert)
            db.commit()
            report.valid_rows_inserted += len(records_to_insert)

        report.duration_seconds = time.perf_counter() - start_time
        return report

    def ingest_csv(
        self,
        filepath_or_buffer: Union[str, BinaryIO, io.StringIO],
        db: Session,
        source_name: Optional[str] = None,
        chunksize: int = 5000,
    ) -> IngestionReport:
        """
        Streams and parses a CSV file in chunks using Pandas and bulk inserts into SQLAlchemy.
        Memory efficient for multi-gigabyte historical FIRMS datasets.
        """
        start_time = time.perf_counter()
        name = source_name or (filepath_or_buffer if isinstance(filepath_or_buffer, str) else "uploaded_file.csv")
        overall_report = IngestionReport(filename=str(name))

        for chunk_df in pd.read_csv(filepath_or_buffer, chunksize=chunksize, low_memory=False):
            sub_report = self.ingest_dataframe(chunk_df, db, source_name=str(name), chunk_size=1000)
            overall_report.total_rows_read += sub_report.total_rows_read
            overall_report.valid_rows_inserted += sub_report.valid_rows_inserted
            overall_report.skipped_rows += sub_report.skipped_rows
            overall_report.modis_rows += sub_report.modis_rows
            overall_report.viirs_rows += sub_report.viirs_rows

        overall_report.duration_seconds = time.perf_counter() - start_time
        return overall_report


ingestion_service = DataIngestionService()
