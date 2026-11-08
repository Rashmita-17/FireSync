from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from app.core.config import settings
from app.core.database import init_db
from app.api.routes import router as api_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan context manager:
    Initializes database schema and warm-up services at startup.
    """
    init_db()
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

# Enable CORS for frontend applications (Leaflet, Cesium, Mapbox, Deck.gl)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API router
app.include_router(api_router, prefix=settings.API_V1_STR, tags=["Harmonization & Data Services"])


@app.get("/", include_in_schema=False)
def root_redirect():
    """Redirect root path to interactive Swagger documentation."""
    return RedirectResponse(url="/docs")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)

