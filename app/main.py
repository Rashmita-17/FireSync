import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Optional

# Ensure project root is in sys.path when executed directly as a script
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from app.core.config import settings
from app.core.database import init_db, SessionLocal
from app.models.observation import Observation
from app.services.ingestion import ingestion_service, IngestionReport
from app.api.routes import router as api_router

logger = logging.getLogger("nasa_firms")

# Project data directory & target NASA FIRMS Global 7-day CSV datasets
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
TARGET_DATASET_FILENAMES = [
    "MODIS_C6_1_Global_7d.csv",
    "J1_VIIRS_C2_Global_7d.csv",
]


def ingest_global_fire_datasets(
    data_dir: Optional[Path] = None,
    target_files: Optional[List[str]] = None,
    force: bool = False,
) -> List[IngestionReport]:
    """
    Loops through and ingests the specific NASA FIRMS global fire datasets
    (MODIS_C6_1_Global_7d.csv and J1_VIIRS_C2_Global_7d.csv) into the database.
    Replaces old sample data and ensures robust parsing of the new FIRMS schemas.
    """
    target_dir = Path(data_dir) if data_dir else DATA_DIR
    files_to_process = target_files or TARGET_DATASET_FILENAMES

    reports: List[IngestionReport] = []
    db = SessionLocal()
    try:
        # Purge legacy synthetic records from sample_modis_viirs_data.csv if present
        legacy_count = db.query(Observation).filter(Observation.source_file == "sample_modis_viirs_data.csv").count()
        if legacy_count > 0:
            logger.info(f"Purging {legacy_count} legacy records from 'sample_modis_viirs_data.csv'...")
            db.query(Observation).filter(Observation.source_file == "sample_modis_viirs_data.csv").delete(synchronize_session=False)
            db.commit()

        for filename in files_to_process:
            csv_path = target_dir / filename
            if not csv_path.exists():
                logger.warning(f"Target dataset file not found at: {csv_path}")
                continue

            existing_count = db.query(Observation).filter(Observation.source_file == filename).count()
            if existing_count > 0 and not force:
                status_msg = (
                    f"[NASA FIRMS] Dataset '{filename}' already ingested ({existing_count:,} records in database). "
                    "Skipping. (Pass --force to re-ingest)."
                )
                print(status_msg)
                logger.info(status_msg)
                continue

            if force and existing_count > 0:
                logger.info(f"Force re-ingest: clearing {existing_count:,} existing records for '{filename}'...")
                db.query(Observation).filter(Observation.source_file == filename).delete(synchronize_session=False)
                db.commit()

            print(f"[NASA FIRMS] Ingesting global fire dataset: {filename} ({csv_path.stat().st_size / (1024*1024):.1f} MB)...")
            logger.info(f"Ingesting records from: {csv_path}")

            report = ingestion_service.ingest_csv(
                filepath_or_buffer=str(csv_path),
                db=db,
                source_name=filename,
                chunksize=25000,
            )
            reports.append(report)

            summary_msg = (
                f"[NASA FIRMS] Ingestion complete for '{filename}': {report.valid_rows_inserted:,} valid records "
                f"({report.modis_rows:,} MODIS, {report.viirs_rows:,} VIIRS) in {report.duration_seconds:.2f}s."
            )
            print(summary_msg)
            logger.info(summary_msg)
    finally:
        db.close()

    return reports


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan context manager:
    Initializes database schema and automatically checks/ingests target global fire datasets.
    """
    init_db()
    try:
        ingest_global_fire_datasets()
    except Exception as e:
        logger.warning(f"Startup global dataset ingestion check skipped or deferred: {e}")
    yield


app = FastAPI(
    title=settings.PROJECT_NAME,
    description="""
# NASA Space Apps: Harmonization of MODIS & VIIRS Backend

A high-performance spatio-temporal data engineering engine that resolves sensor differences between:
- **MODIS** (Terra & Aqua, 1km spatial resolution, 10:30 & 13:30 orbits)
- **VIIRS** (Suomi-NPP & NOAA-20/21, 375m / 750m spatial resolution, 13:30 afternoon orbit)

### Core Capabilities:
- **Sensor-Agnostic Harmonization**: Spatio-temporal HDBSCAN clustering in metric cylindrical coordinates so sensor-of-origin does not bias counts or area calculations.
- **Resolution De-biasing**: Combines fragmented sub-pixel VIIRS detections (4-9 per fire front) with coarse MODIS detections into unified ground events.
- **Multi-Sensor Cross-Validation**: Calculates cross-sensor verification flags and Bayesian confidence bonuses.
- **Interactive Endpoints**: `/api/harmonize` (bounding box queries) and `/api/export` (streamed scientific CSV exports).
    """,
    version="1.0.0",
    lifespan=lifespan,
)

# Enable CORS for frontend applications (Leaflet, Next.js, Cesium, Mapbox, Deck.gl)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "*",
    ],
    allow_origin_regex=r"https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Register API router
app.include_router(api_router, prefix=settings.API_V1_STR, tags=["Harmonization & Data Services"])


@app.get("/", include_in_schema=False)
def root_redirect():
    """Redirect root path to interactive Swagger documentation."""
    return RedirectResponse(url="/docs")


if __name__ == "__main__":
    import sys
    import uvicorn

    init_db()

    # If run directly with --ingest, execute the batch ingestion pipeline
    if "--ingest" in sys.argv or "-i" in sys.argv:
        force_flag = "--force" in sys.argv
        print("=" * 65)
        print("NASA Space Apps // MODIS & VIIRS Global Ingestion Script")
        print("=" * 65)
        reports = ingest_global_fire_datasets(force=force_flag)
        for r in reports:
            print(f" -> {r.filename}: {r.valid_rows_inserted:,} records inserted ({r.duration_seconds:.2f}s)")
        print("Ingestion pipeline finished successfully!")
    else:
        uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)

