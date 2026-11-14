import { BoundingBox, HarmonizationResponse, BackendStats, PresetRegion } from '@/types/fire';

/**
 * Resolves the backend API base URL strictly using process.env.NEXT_PUBLIC_API_URL.
 * If unset in development, defaults to http://localhost:8000.
 */
export function resolveApiBaseUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (envUrl) {
    let cleanUrl = envUrl.replace(/\/+$/, '');
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = `https://${cleanUrl}`;
    }
    return cleanUrl;
  }
  return 'http://localhost:8000';
}

export const API_BASE_URL = resolveApiBaseUrl();

// Debug log printed to console so the active backend URL is immediately visible in Vercel logs / browser console
if (typeof window !== 'undefined') {
  console.log(
    `[FireSync API Debug] Configured API_BASE_URL: "${API_BASE_URL}" (from process.env.NEXT_PUBLIC_API_URL: "${process.env.NEXT_PUBLIC_API_URL || ''}")`
  );
}

// Alternate URL for local Windows IPv4 fallback (127.0.0.1 vs localhost) - only used for local dev
const isLocalhost = API_BASE_URL.includes('localhost') || API_BASE_URL.includes('127.0.0.1');
const ALTERNATE_API_BASE_URL = isLocalhost
  ? API_BASE_URL.includes('localhost')
    ? API_BASE_URL.replace('localhost', '127.0.0.1')
    : API_BASE_URL.replace('127.0.0.1', 'localhost')
  : API_BASE_URL;

export const PRESET_REGIONS: PresetRegion[] = [
  {
    id: 'all-california-pnw',
    name: 'Western Sector Overview',
    description: 'Full active monitoring zone covering California and Pacific Northwest',
    bbox: { min_lon: -125.0, min_lat: 36.0, max_lon: -118.0, max_lat: 45.0 },
    center: [40.5, -121.5],
    zoom: 6,
  },
  {
    id: 'sierra-complex',
    name: 'Sierra Nevada Complex',
    description: 'High-threat active perimeter in central California forest zones',
    bbox: { min_lon: -120.8, min_lat: 37.2, max_lon: -119.0, max_lat: 38.6 },
    center: [37.85, -119.55],
    zoom: 9,
  },
  {
    id: 'cascade-front',
    name: 'Cascade Range Front',
    description: 'Oregon Cascade crest timber and wildland-urban interface',
    bbox: { min_lon: -122.8, min_lat: 43.5, max_lon: -121.0, max_lat: 44.9 },
    center: [44.15, -121.75],
    zoom: 9,
  },
  {
    id: 'shasta-klamath',
    name: 'Shasta-Klamath Ridge',
    description: 'Northern California steep terrain fire management zone',
    bbox: { min_lon: -123.0, min_lat: 40.8, max_lon: -121.3, max_lat: 42.4 },
    center: [41.5, -122.1],
    zoom: 9,
  },
];

export interface HarmonizeParams {
  bbox: BoundingBox;
  spatial_bandwidth_km?: number;
  temporal_bandwidth_hours?: number;
  min_cluster_size?: number;
  min_samples?: number;
  cluster_selection_epsilon?: number;
  min_confidence?: number;
  include_observations?: boolean;
  include_noise?: boolean;
}

/**
 * Normalizes an arbitrary longitude into the standard [-180, 180] EPSG:4326 range.
 * Wraps values when users pan infinitely across world copies in Leaflet/Mapbox (e.g. -232.73 -> 127.27).
 */
export function wrapLongitude(lon: number): number {
  if (isNaN(lon)) return 0;
  let wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  if (lon === 180) wrapped = 180;
  return Number(wrapped.toFixed(4));
}

/**
 * Normalizes a BoundingBox before state dispatch or API transmission:
 * 1. Wraps min_lon and max_lon into [-180, 180].
 * 2. Clamps min_lat and max_lat into [-90, 90].
 * 3. Enforces min_lon <= max_lon and min_lat <= max_lat.
 */
export function normalizeBoundingBox(bbox: BoundingBox): BoundingBox {
  const lat1 = Math.max(-90, Math.min(90, Number(bbox.min_lat) || 0));
  const lat2 = Math.max(-90, Math.min(90, Number(bbox.max_lat) || 0));
  const lon1 = wrapLongitude(Number(bbox.min_lon) || 0);
  const lon2 = wrapLongitude(Number(bbox.max_lon) || 0);

  return {
    min_lat: Number(Math.min(lat1, lat2).toFixed(4)),
    max_lat: Number(Math.max(lat1, lat2).toFixed(4)),
    min_lon: Number(Math.min(lon1, lon2).toFixed(4)),
    max_lon: Number(Math.max(lon1, lon2).toFixed(4)),
  };
}

/**
 * Calls FastAPI POST /api/harmonize endpoint with bounding box and HDBSCAN parameters
 */
export async function fetchHarmonizedData(params: HarmonizeParams): Promise<HarmonizationResponse> {
  const normalizedBbox = normalizeBoundingBox(params.bbox);
  const payload = {
    bbox: normalizedBbox,
    spatial_bandwidth_km: params.spatial_bandwidth_km ?? 2.5,
    temporal_bandwidth_hours: params.temporal_bandwidth_hours ?? 6.0,
    min_cluster_size: params.min_cluster_size ?? 2,
    min_samples: params.min_samples ?? 1,
    cluster_selection_epsilon: params.cluster_selection_epsilon ?? 0.5,
    min_confidence: params.min_confidence ?? 0.0,
    include_observations: params.include_observations ?? true,
    include_noise: params.include_noise ?? true,
  };

  const executePost = async (baseUrl: string) => {
    const fullUrl = `${baseUrl}/api/harmonize`;
    console.log(`[FireSync API Fetch] Calling: ${fullUrl}`);
    return fetch(fullUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  };

  let response: Response;
  let activeUrl = API_BASE_URL;

  try {
    response = await executePost(API_BASE_URL);
  } catch (err: any) {
    if (isLocalhost) {
      console.warn(`[Harmonization Fetch] Initial request to ${API_BASE_URL} failed (${err.message}). Retrying with alternate local IP ${ALTERNATE_API_BASE_URL}...`);
      try {
        response = await executePost(ALTERNATE_API_BASE_URL);
        activeUrl = ALTERNATE_API_BASE_URL;
      } catch (retryErr: any) {
        console.error(`[Harmonization Network Error] Failed to reach backend at ${API_BASE_URL}:`, retryErr);
        throw new Error(`Failed to reach FastAPI backend at ${API_BASE_URL}. Ensure server is running: ${retryErr.message}`);
      }
    } else {
      console.error(`[Harmonization Network Error] Failed to reach remote backend at ${API_BASE_URL}:`, err);
      throw new Error(`Failed to reach production FastAPI backend at ${API_BASE_URL}: ${err.message}`);
    }
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Harmonization API Error HTTP ${response.status}] Server response from ${activeUrl}:`, errorText);
    if (errorText.includes('<!DOCTYPE') || errorText.includes('<html')) {
      throw new Error(
        `FastAPI backend returned HTML error at ${activeUrl} (Status ${response.status}). Check backend logs.`
      );
    }
    throw new Error(`Harmonization failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Triggers scientific CSV export download from FastAPI /api/export
 */
export async function downloadHarmonizedCsv(params: HarmonizeParams): Promise<void> {
  const normalizedBbox = normalizeBoundingBox(params.bbox);
  const payload = {
    bbox: normalizedBbox,
    spatial_bandwidth_km: params.spatial_bandwidth_km ?? 2.5,
    temporal_bandwidth_hours: params.temporal_bandwidth_hours ?? 6.0,
    min_cluster_size: params.min_cluster_size ?? 3,
    min_samples: params.min_samples ?? 1,
    cluster_selection_epsilon: params.cluster_selection_epsilon ?? 0.5,
  };

  const exportUrl = `${API_BASE_URL}/api/export`;
  console.log(`[FireSync API Fetch] Calling export: ${exportUrl}`);
  const response = await fetch(exportUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Export failed with status: ${response.status}`);
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  a.download = `harmonized_modis_viirs_events_${timestamp}.csv`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

/**
 * Checks FastAPI backend health and database readiness
 */
export async function fetchHealthStatus(): Promise<{ status: string; records: number; engine: string; is_empty?: boolean }> {
  const checkEndpoint = async (baseUrl: string) => {
    const healthUrl = `${baseUrl}/api/health`;
    console.log(`[FireSync API Fetch] Checking health: ${healthUrl}`);
    const res = await fetch(healthUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

  try {
    const data = await checkEndpoint(API_BASE_URL);
    return {
      status: data.status,
      records: data.database_records,
      engine: data.clustering_engine,
      is_empty: data.is_empty,
    };
  } catch (err: any) {
    if (isLocalhost) {
      try {
        const data = await checkEndpoint(ALTERNATE_API_BASE_URL);
        return {
          status: data.status,
          records: data.database_records,
          engine: data.clustering_engine,
          is_empty: data.is_empty,
        };
      } catch (altErr: any) {
        console.error(`[FastAPI Health Check Offline] Could not reach ${API_BASE_URL}/api/health:`, altErr);
        return { status: 'offline', records: 0, engine: 'unavailable', is_empty: true };
      }
    } else {
      console.error(`[FastAPI Health Check Offline] Could not reach remote ${API_BASE_URL}/api/health:`, err);
      return { status: 'offline', records: 0, engine: 'unavailable', is_empty: true };
    }
  }
}

/**
 * Diagnostic helper to check production database row counts (/api/db-status)
 */
export async function fetchDbStatus(): Promise<any> {
  const dbStatusUrl = `${API_BASE_URL}/api/db-status`;
  console.log(`[FireSync API Fetch] Checking DB status: ${dbStatusUrl}`);
  try {
    const res = await fetch(dbStatusUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (err: any) {
    console.error(`[FastAPI DB Status Check Failed] Could not reach ${dbStatusUrl}:`, err);
    return null;
  }
}

/**
 * Retrieves aggregate historical dataset statistics
 */
export async function fetchStats(): Promise<BackendStats | null> {
  const statsUrl = `${API_BASE_URL}/api/stats`;
  console.log(`[FireSync API Fetch] Fetching statistics: ${statsUrl}`);
  try {
    const res = await fetch(statsUrl, { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  } catch (err) {
    console.error(`[FastAPI Stats Check Failed]`, err);
    return null;
  }
}

