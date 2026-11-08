# NASA Space Apps Challenge: Harmonization of MODIS and VIIRS

[![FastAPI](https://img.shields.io/badge/FastAPI-0.110+-009688.svg?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Next.js](https://img.shields.io/badge/Next.js-14.2%20App%20Router-000000.svg?logo=next.js&logoColor=white)](https://nextjs.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-3.4+-06B6D4.svg?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Leaflet](https://img.shields.io/badge/Leaflet-1.9.4-199900.svg?logo=leaflet&logoColor=white)](https://leafletjs.com)
[![Scikit-Learn](https://img.shields.io/badge/Scikit--Learn-HDBSCAN-F7931E.svg?logo=scikit-learn&logoColor=white)](https://scikit-learn.org)
[![Pandas](https://img.shields.io/badge/Pandas-2.2+-150458.svg?logo=pandas&logoColor=white)](https://pandas.pydata.org)
[![SQLAlchemy](https://img.shields.io/badge/SQLAlchemy-2.0+-D71F00.svg?logo=sqlalchemy&logoColor=white)](https://www.sqlalchemy.org)

Full-stack production platform engineered for the **NASA International Space Apps Challenge ("Harmonization of MODIS and VIIRS")**:
- **Python FastAPI Backend**: Spatio-temporal HDBSCAN harmonization, resolution de-biasing, chunked Pandas ingestion, and streamed scientific CSV exports.
- **Next.js & Tailwind CSS Frontend**: Dark-themed mission control dashboard for **emergency responders** and **land managers** with interactive Leaflet bounding-box drawing, live incident telemetry feeds, and deep intelligence inspector modals.

---

## 1. The Core Scientific Challenge

Scientists, fire managers, and Earth science practitioners rely heavily on NASA's active fire and thermal anomaly records provided by **FIRMS** (*Fire Information for Resource Management System*). However, the historical record is split between two primary sensor systems:

| Sensor Attribute | MODIS (Moderate Resolution Imaging Spectroradiometer) | VIIRS (Visible Infrared Imaging Radiometer Suite) |
| :--- | :--- | :--- |
| **Satellites** | Terra (10:30 AM/PM orbit) & Aqua (1:30 PM/AM orbit) | Suomi-NPP (1:30 PM/AM), NOAA-20 (14:20 PM/AM), NOAA-21 |
| **Spatial Resolution** | **1,000 m (1.0 km)** at nadir | **375 m (0.375 km)** (I-Bands) / 750 m (M-Bands) |
| **Pixel Growth** | Bowtie effect: pixel expands up to 4.8x at scan edge | Bowtie deletion & pixel aggregation preserves ~375m |
| **Detection Count** | 1 coarse detection for a typical fire front | **4 to 9 sub-pixel detections** for the exact same front |
| **Historical Period**| 2000 – Present | 2011 – Present |

### Why Simple Detection Counting Breaks Science
Because VIIRS detects 4 to 9 pixels for every 1 MODIS pixel, **raw count comparisons create a massive sensor-of-origin bias**. In raw data, an area appears to have experienced an artificial 400–800% increase in fire events merely because a newer satellite flew overhead!

### The Engineering Objective
Build a spatio-temporal clustering engine that unifies detections across sensors so that:
1. **Sensor of Origin No Longer Matters**: Detections are fused into ground-truth unified events.
2. **Spatial Resolutions are Resolved**: The 1km MODIS footprint and 375m VIIRS sub-pixels are synthesized into calculated event geometries, weighted centroids, and effective physical areas ($km^2$).
3. **Multi-Sensor Cross-Validation**: Events observed by both sensor constellations receive multi-sensor verification flags and Bayesian confidence calibration.

---

## 2. Architecture & Mathematical Engine

```
                             NASA FIRMS HISTORICAL ARCHIVES
                        (MODIS: MOD14/MYD14  |  VIIRS: VNP14IMG/VJ114IMG)
                                       │
                                       ▼
                     ┌───────────────────────────────────┐
                     │     PANDAS INGESTION SERVICE      │
                     │  - Chunked streaming (low memory) │
                     │  - Schema & coordinate cleaning   │
                     │  - Confidence score normalization │
                     └─────────────────┬─────────────────┘
                                       │
                                       ▼
                     ┌───────────────────────────────────┐
                     │     SQLAlchemy 2.0 ORM DB         │
                     │  - Indexed (lat, lon, datetime)   │
                     │  - SQLite (dev) / PostGIS (prod)  │
                     └─────────────────┬─────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                 SPATIO-TEMPORAL HDBSCAN HARMONIZATION ENGINE                     │
│                                                                                 │
│  1. Metric Planar Projection:                                                   │
│     x = R · (λ - λ₀) · cos(φ₀) · (π/180) [km]                                   │
│     y = R · (φ - φ₀) · (π/180)           [km]                                   │
│                                                                                 │
│  2. Cylindrical Spatio-Temporal Scaling:                                        │
│     X_scaled = [ x / S_bandwidth,  y / S_bandwidth,  t / T_bandwidth ]          │
│                                                                                 │
│  3. Density Hierarchy Clustering (HDBSCAN):                                     │
│     - Arbitrary non-spherical active fire perimeters                            │
│     - Prunes transient false alarms and solar glints as noise (-1)              │
│     - Resolves 1km vs 375m pixel fragmentation                                  │
│                                                                                 │
│  4. Harmonized Synthesis:                                                       │
│     - FRP-weighted centroid: (Σ w_i · x_i) / Σ w_i                             │
│     - Integrated Fire Radiative Power (MW): Σ FRP_i                             │
│     - 2D Convex Hull effective footprint area (km²)                             │
│     - Multi-sensor cross-validation bonus (+15% confidence)                     │
└──────────────────────────────────────┬──────────────────────────────────────────┘
                                       │
                     ┌─────────────────┴─────────────────┐
                     │       FastAPI REST ENDPOINTS      │
                     │  /api/harmonize  - GeoJSON / JSON │
                     │  /api/export     - Streamed CSV   │
                     │  /api/ingest     - File Upload    │
                     │  /api/stats      - Metrics & EDA  │
                     └───────────────────────────────────┘
```

---

## 3. API Endpoints Specification

### 1. Spatio-Temporal Harmonization (`/api/harmonize`)
Clusters MODIS and VIIRS detections across space and time within a bounding box.

- **Methods**: `GET` and `POST`
- **GET Query Parameters**:
  - `min_lon` (*float*, required): West longitude bound [-180, 180]
  - `min_lat` (*float*, required): South latitude bound [-90, 90]
  - `max_lon` (*float*, required): East longitude bound [-180, 180]
  - `max_lat` (*float*, required): North latitude bound [-90, 90]
  - `spatial_bandwidth_km` (*float*, default: 2.5): Spatial tolerance (km)
  - `temporal_bandwidth_hours` (*float*, default: 6.0): Time window (hours)
  - `min_cluster_size` (*int*, default: 3): Minimum detections to form an event
  - `include_observations` (*bool*, default: false): Include member detections
  - `include_noise` (*bool*, default: false): Return isolated false-alarms
- **POST Request Body**:
  ```json
  {
    "bbox": {
      "min_lon": -122.5,
      "min_lat": 37.5,
      "max_lon": -119.5,
      "max_lat": 39.5
    },
    "spatial_bandwidth_km": 3.0,
    "temporal_bandwidth_hours": 6.0,
    "min_cluster_size": 3,
    "include_observations": false,
    "include_noise": false
  }
  ```
- **Example Response**:
  ```json
  {
    "status": "success",
    "query_bbox": {
      "min_lon": -122.5,
      "min_lat": 37.5,
      "max_lon": -119.5,
      "max_lat": 39.5
    },
    "summary": {
      "total_observations": 184,
      "total_clusters": 6,
      "total_noise_points": 8,
      "modis_detections": 32,
      "viirs_detections": 152,
      "cross_validated_clusters": 5,
      "cross_validation_rate": 0.8333,
      "total_harmonized_frp_mw": 1420.5,
      "spatial_compression_ratio": 30.67,
      "execution_time_ms": 14.8
    },
    "clusters": [
      {
        "cluster_id": 0,
        "centroid_lat": 37.85241,
        "centroid_lon": -119.55122,
        "weighted_centroid_lat": 37.85198,
        "weighted_centroid_lon": -119.55084,
        "first_detected": "2023-08-15T18:30:00",
        "last_detected": "2023-08-15T22:30:00",
        "duration_hours": 4.0,
        "total_detections": 48,
        "modis_count": 8,
        "viirs_count": 40,
        "sensor_ratio": 0.833,
        "cross_validated": true,
        "total_frp": 684.2,
        "peak_frp": 85.0,
        "mean_frp": 14.25,
        "harmonized_confidence": 98.5,
        "estimated_area_km2": 4.35,
        "bbox": [-119.572, 37.838, -119.531, 37.869],
        "geojson_geometry": {
          "type": "Polygon",
          "coordinates": [
            [
              [-119.572, 37.855],
              [-119.548, 37.869],
              [-119.531, 37.842],
              [-119.555, 37.838],
              [-119.572, 37.855]
            ]
          ]
        }
      }
    ]
  }
  ```

---

### 2. Scientific CSV Download (`/api/export`)
Downloads all harmonized event clusters formatted as a standardized CSV file for direct ingest into **QGIS**, **ArcGIS**, **Google Earth Engine**, and pandas data pipelines.

- **Methods**: `GET` and `POST`
- **Response Headers**:
  - `Content-Type: text/csv`
  - `Content-Disposition: attachment; filename="harmonized_modis_viirs_events_20261108_003900.csv"`
- **CSV Columns**:
  ```csv
  cluster_id,centroid_lat,centroid_lon,weighted_centroid_lat,weighted_centroid_lon,first_detected_utc,last_detected_utc,duration_hours,total_detections,modis_count,viirs_count,sensor_ratio_viirs,cross_validated,total_frp_mw,peak_frp_mw,mean_frp_mw,harmonized_confidence_pct,estimated_area_km2,bbox_min_lon,bbox_min_lat,bbox_max_lon,bbox_max_lat
  ```

---

### 3. Historical Dataset Ingestion (`/api/ingest`)
Uploads NASA FIRMS archive CSV files (either MODIS `fire_archive_M-C61_*.csv` or VIIRS `fire_archive_SV-N20_*.csv`).

- **Method**: `POST` (`multipart/form-data`)
- **Key Features**:
  - Chunked streaming via Pandas (`chunksize=5000`)
  - Auto-normalizes confidence: converts VIIRS `'l'`, `'n'`, `'h'` to numeric `30.0%`, `70.0%`, `95.0%`
  - High-throughput batch mapping using SQLAlchemy `bulk_insert_mappings`

---

### 4. Auxiliary Data Endpoints
- `GET /api/stats`: Comprehensive dataset summary, sensor counts, and date spans.
- `GET /api/observations`: Query raw ingested observations by bounding box.
- `GET /api/health`: Service health and database record count.
- `GET /docs`: Interactive Swagger UI documentation.

---

## 4. Disaster Response Dashboard (Next.js & Tailwind CSS)

Located in `frontend/`, the web dashboard is purpose-built for **Emergency Incident Commanders**, **Wildland Firefighters**, and **Land Resource Managers**:

- **Tactical Dark Mission Control UI**: High-contrast dark theme (`#090D16`), glowing thermal alert beacons, and live UTC mission clocks.
- **Interactive Leaflet Canvas**:
  - **Click-and-Drag Area of Interest (AOI)**: Hit **"Draw AOI Box"** and drag across the map to dynamically extract bounding box coordinates and harmonize the enclosed zone.
  - **Manual Coordinates Entry**: Input bounding coordinates (`min_lon`, `min_lat`, `max_lon`, `max_lat`) with automatic validation and smooth camera fly-to.
  - **Quick Tactical Presets**: One-click jump to active sectors (e.g. *Sierra Nevada Complex*, *Cascade Range Front*, *Shasta-Klamath Ridge*, *Western Sector Overview*).
- **Multi-Sensor Visualization**:
  - **Harmonized FRP Beacons**: Pulsing radar rings color-coded by Fire Radiative Power (Extreme, High, Moderate, Low).
  - **Multi-Sensor Cross-Validation Badges (`M+V`)**: Highlight events confirmed by both MODIS (1km) and VIIRS (375m).
  - **Convex Hull Perimeters**: Semi-transparent tactical heat polygons showing physical fire front perimeters.
  - **Raw Sub-Pixel Inspection**: Toggle raw MODIS 1km pixels (purple) vs VIIRS 375m sub-pixels (cyan) to inspect how the HDBSCAN algorithm resolved fragmentation.
- **Real-Time Telemetry & Incident Intelligence**:
  - **Summary Metrics**: Active complexes, spatial compression ratio, multi-sensor validation rate, and total cumulative radiative energy (MW).
  - **Deep Intel Modal**: Click any incident to inspect duration, sensor contribution breakdown, and member satellite detections.
  - **Streamed CSV Export**: One-click download directly from FastAPI `/api/export`.

---

## 5. Quickstart & Installation

### Option A: Local Full-Stack Setup

1. **Start the FastAPI Backend**:
   ```bash
   # Terminal 1
   pip install -r requirements.txt
   python scripts/seed_db.py
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```
   *FastAPI documentation will be running at `http://localhost:8000/docs`.*

2. **Start the Next.js Frontend Dashboard**:
   ```bash
   # Terminal 2
   cd frontend
   npm run dev
   ```
   *Open `http://localhost:3000` to access the Disaster Response Dashboard.*

---

### Option B: Docker Compose (Full Stack)

```bash
docker-compose up --build
```
- **Disaster Response Dashboard**: `http://localhost:3000`
- **FastAPI Harmonization Engine**: `http://localhost:8000`

---

## 6. Verification Results

Running the automated test suite (`tests/`):
```
tests/test_api.py::test_health_check_endpoint PASSED                     [ 10%]
tests/test_api.py::test_stats_endpoint PASSED                            [ 20%]
tests/test_api.py::test_harmonize_get_endpoint PASSED                    [ 30%]
tests/test_api.py::test_harmonize_post_endpoint PASSED                   [ 40%]
tests/test_api.py::test_export_service_csv_generation PASSED             [ 50%]
tests/test_api.py::test_get_raw_observations_endpoint PASSED             [ 60%]
tests/test_api.py::test_ingestion_service_dataframe PASSED               [ 70%]
tests/test_clustering.py::test_coordinate_projection PASSED              [ 80%]
tests/test_clustering.py::test_sensor_harmonization_resolves_fragmentation PASSED [ 90%]
tests/test_clustering.py::test_empty_dataset_handling PASSED             [100%]
======================= 10 passed in 5.76s =======================
```
On a 681-observation multi-satellite fire complex dataset, the clustering algorithm achieved a **28.38x spatial compression ratio**, reducing fragmented observations into **24 harmonized events with 17 cross-validated multi-sensor clusters** in under **25 milliseconds**.

