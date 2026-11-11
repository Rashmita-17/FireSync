"""
Database Seeder Script.

Initializes the database schema and loads historical MODIS and VIIRS records
using the Pandas + SQLAlchemy ingestion service.
"""

import os
import sys
from pathlib import Path

# Add project root to path
root_dir = Path(__file__).resolve().parent.parent
sys.path.append(str(root_dir))

from app.core.database import init_db, SessionLocal, engine
from app.services.ingestion import ingestion_service
from scripts.generate_sample_data import generate_synthetic_nasa_firms_dataset


TARGET_DATASETS = [
    "MODIS_C6_1_Global_7d.csv",
    "J1_VIIRS_C2_Global_7d.csv",
]


def seed(csv_path: str = None, force: bool = False):
    print("Initializing Database schema...")
    init_db()

    data_dir = os.path.join(root_dir, "data")
    files_to_ingest = [csv_path] if csv_path else [os.path.join(data_dir, f) for f in TARGET_DATASETS]

    db = SessionLocal()
    try:
        from app.models.observation import Observation
        # Remove old sample data if present
        legacy = db.query(Observation).filter(Observation.source_file == "sample_modis_viirs_data.csv").count()
        if legacy > 0:
            print(f"Purging {legacy} legacy sample records...")
            db.query(Observation).filter(Observation.source_file == "sample_modis_viirs_data.csv").delete(synchronize_session=False)
            db.commit()

        for path in files_to_ingest:
            if not os.path.exists(path):
                print(f"Dataset file not found: {path}. Skipping.")
                continue

            fname = os.path.basename(path)
            existing = db.query(Observation).filter(Observation.source_file == fname).count()
            if existing > 0 and not force:
                print(f"File {fname} already has {existing:,} records in DB. Skipping (pass force=True to re-ingest).")
                continue

            if force and existing > 0:
                print(f"Force re-ingest: deleting previous records for {fname}...")
                db.query(Observation).filter(Observation.source_file == fname).delete(synchronize_session=False)
                db.commit()

            print(f"\nIngesting records from: {path} ({os.path.getsize(path) / (1024*1024):.1f} MB)...")
            report = ingestion_service.ingest_csv(path, db, source_name=fname, chunksize=25000)
            print(f"Ingestion completed for {fname}:")
            print(f" - Valid records inserted: {report.valid_rows_inserted:,}")
            print(f" - MODIS records: {report.modis_rows:,}")
            print(f" - VIIRS records: {report.viirs_rows:,}")
            print(f" - Duration: {report.duration_seconds:.2f} seconds")
    finally:
        db.close()


if __name__ == "__main__":
    seed()

