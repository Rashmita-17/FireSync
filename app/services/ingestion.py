import io
import time
from datetime import datetime, timezone, time as dtime
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
    Utilizes Pandas vectorization and SQLAlchemy bulk mapping for high-throughput ingestion.
    """

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

    @staticmethod
    def _normalize_column_names(df: pd.DataFrame) -> pd.DataFrame:
        """Standardize column names to lowercase and stripped characters."""
        df.columns = [str(col).strip().lower() for col in df.columns]
        return df

    @classmethod
    def _parse_confidence(cls, row_dict: Dict[str, Any], instrument: str) -> Tuple[float, str]:
        """
        Normalizes confidence between MODIS (0-100 numerical) and VIIRS (low/nominal/high categorical).
        Returns (normalized_float_0_to_100, raw_string).
        """
        raw_val = row_dict.get("confidence")
        if pd.isna(raw_val) or raw_val is None:
            return 50.0, "50"

        raw_str = str(raw_val).strip()
        lower_str = raw_str.lower()

        # Check categorical (common in VIIRS)
        if lower_str in cls.CONFIDENCE_VIIRS_MAP:
            return cls.CONFIDENCE_VIIRS_MAP[lower_str], raw_str

        # Check numerical (common in MODIS or converted VIIRS)
        try:
            val_float = float(raw_str)
            clamped = max(0.0, min(100.0, val_float))
            return clamped, raw_str
        except ValueError:
            return 50.0, raw_str

    @classmethod
    def _infer_instrument(cls, row_dict: Dict[str, Any], source_name: str) -> str:
        """
        Infers instrument (MODIS vs VIIRS) from column values, satellite platform, or filename.
        """
        # 1. Explicit instrument column
        inst = row_dict.get("instrument")
        if pd.notna(inst) and inst:
            u_inst = str(inst).strip().upper()
            if "MODIS" in u_inst:
                return "MODIS"
            if "VIIRS" in u_inst:
                return "VIIRS"
            return u_inst

        # 2. Inspect source filename
        u_src = source_name.upper()
        if "MODIS" in u_src or "M-C6" in u_src:
            return "MODIS"
        if "VIIRS" in u_src or "J1" in u_src or "SV" in u_src or "J1_VIIRS" in u_src:
            return "VIIRS"

        # 3. Inspect satellite value
        sat_raw = str(row_dict.get("satellite", "")).strip().upper()
        if sat_raw in ["T", "A", "TERRA", "AQUA"]:
            return "MODIS"
        if sat_raw in ["N20", "N21", "N", "NPP", "SNPP", "NOAA-20", "NOAA-21", "J1", "J2"]:
            return "VIIRS"

        # 4. Sensor-specific channels
        if "bright_ti4" in row_dict or "bright_ti5" in row_dict:
            return "VIIRS"
        if "bright_t31" in row_dict:
            return "MODIS"

        return "MODIS"

    @classmethod
    def _normalize_satellite(cls, sat_raw: Any, instrument: str) -> str:
        """Standardizes satellite identifiers into human-readable platform names."""
        if pd.isna(sat_raw) or not sat_raw:
            return "Terra" if instrument == "MODIS" else "NOAA-20"
        s = str(sat_raw).strip()
        upper_s = s.upper()
        return cls.SATELLITE_NORMALIZATION.get(upper_s, s)

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
        chunk_size: int = 5000
    ) -> IngestionReport:
        """
        Ingests a pre-loaded Pandas DataFrame into the Observation database table.
        Optimized with dictionary records iteration and batch SQLAlchemy mapping.
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
        lat_numeric = pd.to_numeric(df[lat_col], errors="coerce")
        lon_numeric = pd.to_numeric(df[lon_col], errors="coerce")
        valid_coords = (
            df[lat_col].notna() &
            df[lon_col].notna() &
            lat_numeric.between(-90.0, 90.0) &
            lon_numeric.between(-180.0, 180.0)
        )
        clean_df = df[valid_coords].copy()
        report.skipped_rows = len(df) - len(clean_df)

        if clean_df.empty:
            report.duration_seconds = time.perf_counter() - start_time
            return report

        # Pre-compute datetime vectorially if possible for peak performance
        if "acq_datetime" not in clean_df.columns and "acq_date" in clean_df.columns and "acq_time" in clean_df.columns:
            time_padded = clean_df["acq_time"].astype(str).str.split(".").str[0].str.zfill(4)
            time_padded = time_padded.str.slice(0, 4)
            dt_strings = clean_df["acq_date"].astype(str) + " " + time_padded.str.slice(0, 2) + ":" + time_padded.str.slice(2, 4)
            clean_df["_dt_vector"] = pd.to_datetime(dt_strings, format="%Y-%m-%d %H:%M", errors="coerce")
        else:
            clean_df["_dt_vector"] = pd.NaT

        rows = clean_df.to_dict(orient="records")
        now_utc = datetime.now(timezone.utc)
        records_to_insert = []

        for row in rows:
            lat = float(row[lat_col])
            lon = float(row[lon_col])

            # Datetime resolution
            dt = None
            if pd.notna(row.get("_dt_vector")):
                dt = row["_dt_vector"].to_pydatetime()
            elif "acq_datetime" in row and pd.notna(row["acq_datetime"]):
                dt = pd.to_datetime(row["acq_datetime"]).to_pydatetime()
            else:
                date_val = row.get("acq_date")
                time_val = row.get("acq_time")
                dt = self._parse_acq_datetime(date_val, time_val)
                if dt is None:
                    report.skipped_rows += 1
                    continue

            # Instrument & Satellite identification
            instrument_name = self._infer_instrument(row, source_name)
            satellite_name = self._normalize_satellite(row.get("satellite"), instrument_name)

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
            for bcol in ["brightness", "bright_ti4", "bright_t31", "bright_ti5"]:
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
                "created_at": now_utc,
            })

            # Bulk insert in batches to maintain high throughput and low memory footprint
            if len(records_to_insert) >= chunk_size:
                db.bulk_insert_mappings(Observation, records_to_insert)
                db.commit()
                report.valid_rows_inserted += len(records_to_insert)
                records_to_insert = []

        # Flush remaining records
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
        chunksize: int = 25000,
    ) -> IngestionReport:
        """
        Streams and parses a CSV file in chunks using Pandas and bulk inserts into SQLAlchemy.
        Memory efficient for multi-gigabyte historical FIRMS datasets.
        """
        start_time = time.perf_counter()
        name = source_name or (filepath_or_buffer if isinstance(filepath_or_buffer, str) else "uploaded_file.csv")
        overall_report = IngestionReport(filename=str(name))

        for chunk_df in pd.read_csv(filepath_or_buffer, chunksize=chunksize, low_memory=False):
            sub_report = self.ingest_dataframe(chunk_df, db, source_name=str(name), chunk_size=5000)
            overall_report.total_rows_read += sub_report.total_rows_read
            overall_report.valid_rows_inserted += sub_report.valid_rows_inserted
            overall_report.skipped_rows += sub_report.skipped_rows
            overall_report.modis_rows += sub_report.modis_rows
            overall_report.viirs_rows += sub_report.viirs_rows

        overall_report.duration_seconds = time.perf_counter() - start_time
        return overall_report


ingestion_service = DataIngestionService()

