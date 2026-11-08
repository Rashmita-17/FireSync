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


def seed(csv_path: str = None):
    print("Initializing Database schema...")
    init_db()
    
    if not csv_path:
        csv_path = os.path.join(root_dir, "data", "sample_modis_viirs_data.csv")

    if not os.path.exists(csv_path):
        print(f"Data file {csv_path} not found. Generating synthetic dataset...")
        generate_synthetic_nasa_firms_dataset(csv_path)

    print(f"Ingesting records from: {csv_path}")
    db = SessionLocal()
    try:
        report = ingestion_service.ingest_csv(csv_path, db, source_name=os.path.basename(csv_path))
        print("Ingestion completed successfully!")
        print(f"Total rows read: {report.total_rows_read}")
        print(f"Valid rows inserted: {report.valid_rows_inserted}")
        print(f"MODIS records: {report.modis_rows}")
        print(f"VIIRS records: {report.viirs_rows}")
        print(f"Duration: {report.duration_seconds} seconds")
    finally:
        db.close()


if __name__ == "__main__":
    seed()

