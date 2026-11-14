# NASA FIRMS Incident Harmonization Grid // Deployment Guide

This guide details configuration, environment variables, and deployment steps for deploying the FastAPI backend (e.g. on Render, Cloud Run, or Railway) and the Next.js frontend (e.g. on Vercel).

---

## 1. Environment Variables Reference

### Backend (FastAPI / Render / Cloud Run / Docker)

| Variable Name | Required | Default Value | Description | Where to Set |
| :--- | :--- | :--- | :--- | :--- |
| **`MAP_KEY`** | **YES** | *None (Fails loudly)* | Your official NASA FIRMS API key. Get a free instant key at [NASA FIRMS API Key](https://firms.modaps.eosdis.nasa.gov/api/map_key/). | Render Dashboard $\to$ Environment Variables, or `.env` |
| **`ALLOWED_ORIGINS`** | **YES** (Prod) | `http://localhost:3000,http://127.0.0.1:3000` | Comma-separated list of allowed frontend origins (e.g. `https://your-firesync.vercel.app,http://localhost:3000`). | Render Dashboard $\to$ Environment Variables |
| **`PORT`** | Auto | `8000` | Cloud hosting port (Render sets this dynamically to `10000`). Dockerfile automatically reads `${PORT:-8000}`. | Injected by platform |
| **`DATABASE_URL`** | No | `sqlite:///./data/nasa_observations.db` | Connection string for SQLite or PostgreSQL/PostGIS (e.g. Supabase, Neon, RDS). | Render Dashboard $\to$ Environment Variables |
| **`DEBUG`** | No | `False` | Enables verbose debug mode. | Render Dashboard |

### Frontend (Next.js / Vercel)

| Variable Name | Required | Default Value | Description | Where to Set |
| :--- | :--- | :--- | :--- | :--- |
| **`NEXT_PUBLIC_API_URL`** | **YES** (Prod) | `http://127.0.0.1:8000` | The public URL of your deployed FastAPI backend (e.g. `https://firesync-backend.onrender.com`). | Vercel Project Settings $\to$ Environment Variables |
| **`NEXT_PUBLIC_MAP_STYLE`**| No | OpenFreeMap Dark | Free vector/raster tile basemap style URL. | Vercel Project Settings |
| **`NEXT_PUBLIC_CARTO_API_KEY`** | No | *None* | Optional CARTO Dark Matter API key if using CARTO vector styles. | Vercel Project Settings |

---

## 2. Deploying the Backend to Render

1. Go to [Render Dashboard](https://dashboard.render.com/) and create a **New Web Service**.
2. Connect your GitHub repository (`FireSync`).
3. Set the following configuration:
   - **Environment**: `Docker` (or `Python 3.11`)
   - **Dockerfile Path**: `./Dockerfile`
   - **Health Check Path**: `/api/health`
4. Under **Environment Variables**, add:
   - `MAP_KEY`: `<your_nasa_firms_map_key>`
   - `ALLOWED_ORIGINS`: `https://<your-vercel-app>.vercel.app,http://localhost:3000`
5. Click **Deploy Web Service**.

> [!NOTE]
> The backend verifies `MAP_KEY` on startup. If `MAP_KEY` is not set, the application will fail loudly at startup with an explanatory `RuntimeError`.

---

## 3. Deploying the Frontend to Vercel

1. Go to [Vercel Dashboard](https://vercel.com/) and import your GitHub repository.
2. Set **Root Directory** to `frontend`.
3. Under **Environment Variables**, add:
   - `NEXT_PUBLIC_API_URL`: `https://<your-render-backend-url>.onrender.com`
4. Click **Deploy**.

---

## 4. Health & Live Diagnostics Verification

Once deployed, you can verify each component directly from your browser or terminal:

1. **Service Readiness & DB Count**:
   ```bash
   curl -s https://<your-backend-url>/api/health
   # Returns: {"status":"healthy","database_records":...,"clustering_engine":"sklearn.cluster.HDBSCAN"}
   ```

2. **Live NASA FIRMS Connectivity Check**:
   ```bash
   curl -s https://<your-backend-url>/api/health/firms
   # Returns: {"status":"healthy","http_code":200,"row_count":...,"source":"VIIRS_SNPP_NRT","day_range":1}
   ```

3. **Multi-Sensor Harmonization (Western Sector, Lookback 10 Days)**:
   ```bash
   curl -X POST https://<your-backend-url>/api/harmonize \
     -H "Content-Type: application/json" \
     -d '{
       "bbox": {"min_lon": -125.0, "min_lat": 36.0, "max_lon": -118.0, "max_lat": 45.0},
       "day_range": 10
     }'
   ```
