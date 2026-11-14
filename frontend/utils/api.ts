import {
  BoundingBox,
  HarmonizationResponse,
  HarmonizedCluster,
  HarmonizationSummary,
  RawObservation,
  BackendStats,
  PresetRegion,
} from '@/types/fire';

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
  // If running in browser on deployed domain (not localhost), use same-origin fallback
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      return '';
    }
  }
  // Default to 127.0.0.1 on local environments to bypass Windows IPv6 resolution latency
  return 'http://127.0.0.1:8000';
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
  // Global Major Fire Fronts
  {
    id: 'world-overview',
    name: 'World Overview (Global)',
    description: 'Planet-scale satellite active fire detection grid (1-2 day lookback)',
    bbox: { min_lon: -180.0, min_lat: -60.0, max_lon: 180.0, max_lat: 75.0 },
    center: [15.0, 0.0],
    zoom: 2,
  },
  {
    id: 'australia-east',
    name: 'Australia East (NSW/QLD)',
    description: 'Eastern Australia bushfire monitoring zone (New South Wales & Queensland)',
    bbox: { min_lon: 140.0, min_lat: -38.0, max_lon: 154.0, max_lat: -25.0 },
    center: [-31.5, 147.0],
    zoom: 6,
  },
  {
    id: 'amazon-arc',
    name: 'Amazon Arc of Deforestation',
    description: 'Southern Brazilian Amazon active fire belt (Mato Grosso / Para)',
    bbox: { min_lon: -62.0, min_lat: -12.0, max_lon: -50.0, max_lat: -3.0 },
    center: [-7.5, -56.0],
    zoom: 6,
  },
  {
    id: 'central-africa',
    name: 'Central Africa / Sahel',
    description: 'Sub-Saharan equatorial active burning and savanna fire belt',
    bbox: { min_lon: 15.0, min_lat: -10.0, max_lon: 30.0, max_lat: 5.0 },
    center: [-2.5, 22.5],
    zoom: 5,
  },
  {
    id: 'indonesia',
    name: 'Indonesia (Sumatra/Kalimantan)',
    description: 'Peatland and tropical forest fire management zone',
    bbox: { min_lon: 100.0, min_lat: -6.0, max_lon: 112.0, max_lat: 3.0 },
    center: [-1.5, 106.0],
    zoom: 6,
  },
  {
    id: 'india-punjab',
    name: 'India (Punjab/Haryana)',
    description: 'Indo-Gangetic agricultural residue burning and seasonal fire front',
    bbox: { min_lon: 73.0, min_lat: 29.0, max_lon: 77.0, max_lat: 32.0 },
    center: [30.5, 75.0],
    zoom: 7,
  },
  {
    id: 'mediterranean',
    name: 'Mediterranean Europe',
    description: 'Southern Europe wildland-urban interface (Spain, Italy, Greece)',
    bbox: { min_lon: -10.0, min_lat: 35.0, max_lon: 30.0, max_lat: 45.0 },
    center: [40.0, 10.0],
    zoom: 5,
  },
  {
    id: 'siberia-taiga',
    name: 'Siberia / Russian Far East',
    description: 'Boreal taiga wildfire complexes in Sakha and Eastern Siberia',
    bbox: { min_lon: 115.0, min_lat: 50.0, max_lon: 140.0, max_lat: 65.0 },
    center: [57.5, 127.5],
    zoom: 5,
  },
  {
    id: 'canada-boreal',
    name: 'Canada Boreal Forest',
    description: 'Western Canadian shield and subarctic wildfire belt',
    bbox: { min_lon: -125.0, min_lat: 50.0, max_lon: -105.0, max_lat: 60.0 },
    center: [55.0, -115.0],
    zoom: 5,
  },
  // United States Monitoring Sectors
  {
    id: 'all-california-pnw',
    name: 'Western Sector Overview (US)',
    description: 'Full active monitoring zone covering California and Pacific Northwest',
    bbox: { min_lon: -125.0, min_lat: 36.0, max_lon: -118.0, max_lat: 45.0 },
    center: [40.5, -121.5],
    zoom: 6,
  },
  {
    id: 'sierra-complex',
    name: 'Sierra Nevada Complex (US)',
    description: 'High-threat active perimeter in central California forest zones',
    bbox: { min_lon: -120.8, min_lat: 37.2, max_lon: -119.0, max_lat: 38.6 },
    center: [37.85, -119.55],
    zoom: 9,
  },
  {
    id: 'cascade-front',
    name: 'Cascade Range Front (US)',
    description: 'Oregon Cascade crest timber and wildland-urban interface',
    bbox: { min_lon: -122.8, min_lat: 43.5, max_lon: -121.0, max_lat: 44.9 },
    center: [44.15, -121.75],
    zoom: 9,
  },
  {
    id: 'shasta-klamath',
    name: 'Shasta-Klamath Ridge (US)',
    description: 'Northern California steep terrain fire management zone',
    bbox: { min_lon: -123.0, min_lat: 40.8, max_lon: -121.3, max_lat: 42.4 },
    center: [41.5, -122.1],
    zoom: 9,
  },
];

export interface HarmonizeParams {
  bbox: BoundingBox;
  day_range?: number;
  use_live?: boolean;
  spatial_bandwidth_km?: number;
  temporal_bandwidth_hours?: number;
  min_cluster_size?: number;
  min_samples?: number;
  cluster_selection_epsilon?: number;
  min_confidence?: number;
  include_observations?: boolean;
  include_noise?: boolean;
  signal?: AbortSignal;
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

  // If drawn right-to-left without crossing antimeridian (|lon1 - lon2| < 180), order min <= max.
  // When lon1 > lon2 and difference >= 180, this represents an antimeridian crossing query.
  let minLon = lon1;
  let maxLon = lon2;
  if (lon1 > lon2 && (lon1 - lon2) < 180) {
    minLon = lon2;
    maxLon = lon1;
  }

  return {
    min_lat: Number(Math.min(lat1, lat2).toFixed(4)),
    max_lat: Number(Math.max(lat1, lat2).toFixed(4)),
    min_lon: Number(minLon.toFixed(4)),
    max_lon: Number(maxLon.toFixed(4)),
  };
}

export const DEFAULT_FETCH_TIMEOUT_MS = 8000;
export const HARMONIZATION_TIMEOUT_MS = 20000;

/**
 * Executes a browser fetch with an abort timeout and supports external cancellation signals.
 * Prevents hanging connections on cold start delays while allowing heavy HDBSCAN calculations.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  // Link external abort signal if provided (e.g. superseding previous harmonization requests)
  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener('abort', () => controller.abort());
    }
  }

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (err: any) {
    if (err?.name === 'AbortError' || controller.signal.aborted) {
      if (options.signal?.aborted) {
        throw new Error('Request aborted (superseded by newer query)');
      }
      throw new Error(`Request timed out after ${timeoutMs / 1000}s (backend unreachable or heavy clustering)`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Calls FastAPI POST /api/harmonize endpoint with bounding box and HDBSCAN parameters.
 * Includes defensive parsing so empty databases, empty lists, or null payloads
 * gracefully return 0 active complexes instead of crashing or hanging the map.
 */
export async function fetchHarmonizedData(params: HarmonizeParams): Promise<HarmonizationResponse> {
  const normalizedBbox = normalizeBoundingBox(params.bbox);
  const payload = {
    bbox: normalizedBbox,
    day_range: params.day_range ?? 3,
    use_live: params.use_live ?? false,
    spatial_bandwidth_km: params.spatial_bandwidth_km ?? 2.5,
    temporal_bandwidth_hours: params.temporal_bandwidth_hours ?? 6.0,
    min_cluster_size: params.min_cluster_size ?? 2,
    min_samples: params.min_samples ?? 1,
    cluster_selection_epsilon: params.cluster_selection_epsilon ?? 0.5,
    min_confidence: params.min_confidence ?? 0.0,
    include_observations: params.include_observations ?? true,
    include_noise: params.include_noise ?? true,
  };

  const defaultEmptyResponse: HarmonizationResponse = {
    status: 'empty',
    query_bbox: normalizedBbox,
    summary: {
      total_observations: 0,
      total_clusters: 0,
      total_noise_points: 0,
      modis_detections: 0,
      viirs_detections: 0,
      cross_validated_clusters: 0,
      cross_validation_rate: 0,
      total_harmonized_frp_mw: 0,
      spatial_compression_ratio: 1.0,
      execution_time_ms: 0,
    },
    clusters: [],
    noise_points: [],
  };

  const executePost = async (baseUrl: string) => {
    const fullUrl = `${baseUrl}/api/harmonize`;
    console.log(`[FireSync API Fetch] Calling: ${fullUrl}`);
    return fetchWithTimeout(
      fullUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: params.signal,
      },
      HARMONIZATION_TIMEOUT_MS
    );
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
        console.error(`[Harmonization Network Error] Failed to reach backend:`, retryErr);
        throw new Error(`Failed to reach FastAPI backend: ${retryErr.message}`);
      }
    } else {
      console.error(`[Harmonization Network Error] Failed to reach production backend at ${API_BASE_URL}:`, err);
      throw new Error(`Failed to reach production FastAPI backend: ${err.message}`);
    }
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    console.error(`[Harmonization API Error HTTP ${response.status}] Server response from ${activeUrl}:`, errorText);
    if (errorText.includes('<!DOCTYPE') || errorText.includes('<html')) {
      throw new Error(
        `FastAPI backend returned HTML error at ${activeUrl} (Status ${response.status}). Check backend logs.`
      );
    }
    let detailMsg = errorText;
    try {
      const parsed = JSON.parse(errorText);
      if (parsed?.detail) {
        detailMsg = typeof parsed.detail === 'string' ? parsed.detail : JSON.stringify(parsed.detail);
      }
    } catch {}
    throw new Error(`Harmonization failed (HTTP ${response.status}): ${detailMsg || response.statusText}`);
  }

  // Safe Harmonize Parsing: gracefully handle [], null, {}, or missing clusters
  let rawData: any = null;
  try {
    rawData = await response.json();
  } catch {
    return defaultEmptyResponse;
  }

  if (!rawData) {
    return defaultEmptyResponse;
  }

  let parsedClusters: HarmonizedCluster[] = [];
  if (Array.isArray(rawData)) {
    parsedClusters = rawData.filter(Boolean);
  } else if (Array.isArray(rawData.clusters)) {
    parsedClusters = rawData.clusters.filter(Boolean);
  }

  const parsedNoise: RawObservation[] = Array.isArray(rawData?.noise_points)
    ? rawData.noise_points.filter(Boolean)
    : [];

  const rawSummary = rawData?.summary;
  const safeSummary: HarmonizationSummary = {
    total_observations: Number(
      rawSummary?.total_observations ??
      parsedClusters.reduce((acc, c) => acc + (Number(c?.total_detections) || 0), 0)
    ),
    total_clusters: Number(rawSummary?.total_clusters ?? parsedClusters.length),
    total_noise_points: Number(rawSummary?.total_noise_points ?? parsedNoise.length),
    modis_detections: Number(
      rawSummary?.modis_detections ??
      parsedClusters.reduce((acc, c) => acc + (Number(c?.modis_count) || 0), 0)
    ),
    viirs_detections: Number(
      rawSummary?.viirs_detections ??
      parsedClusters.reduce((acc, c) => acc + (Number(c?.viirs_count) || 0), 0)
    ),
    cross_validated_clusters: Number(
      rawSummary?.cross_validated_clusters ??
      parsedClusters.filter((c) => Boolean(c?.cross_validated)).length
    ),
    cross_validation_rate: Number(
      rawSummary?.cross_validation_rate ??
      (parsedClusters.length > 0
        ? parsedClusters.filter((c) => Boolean(c?.cross_validated)).length / parsedClusters.length
        : 0)
    ),
    total_harmonized_frp_mw: Number(
      rawSummary?.total_harmonized_frp_mw ??
      parsedClusters.reduce((acc, c) => acc + (Number(c?.total_frp) || 0), 0)
    ),
    spatial_compression_ratio: Number(
      rawSummary?.spatial_compression_ratio ??
      (parsedClusters.length > 0 && safeSummaryFallbackObs(rawSummary, parsedClusters) > 0
        ? safeSummaryFallbackObs(rawSummary, parsedClusters) / parsedClusters.length
        : 1.0)
    ),
    execution_time_ms: Number(rawSummary?.execution_time_ms ?? 0),
  };

  return {
    status: rawData?.status || 'success',
    query_bbox: rawData?.query_bbox || normalizedBbox,
    summary: safeSummary,
    clusters: parsedClusters,
    noise_points: parsedNoise,
  };
}

function safeSummaryFallbackObs(rawSummary: any, clusters: HarmonizedCluster[]): number {
  if (rawSummary?.total_observations !== undefined) return Number(rawSummary.total_observations);
  return clusters.reduce((acc, c) => acc + (Number(c?.total_detections) || 0), 0);
}

/**
 * Triggers scientific CSV export download from FastAPI /api/export with strict timeout
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
  const response = await fetchWithTimeout(
    exportUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    HARMONIZATION_TIMEOUT_MS
  );

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

export interface HealthStatusResult {
  status: 'online' | 'offline' | 'healthy' | 'empty_database' | string;
  ok: boolean;
  records: number;
  engine: string;
  is_empty?: boolean;
}

/**
 * Checks FastAPI backend health and database readiness.
 * PERMISSIVE: Any HTTP 200 (or 2xx) response automatically flags backend as ONLINE.
 */
export async function fetchHealthStatus(): Promise<HealthStatusResult> {
  const checkEndpoint = async (baseUrl: string): Promise<HealthStatusResult> => {
    const healthUrl = `${baseUrl}/api/health`;
    console.log(`[FireSync API Fetch] Checking health: ${healthUrl}`);
    const res = await fetchWithTimeout(
      healthUrl,
      { cache: 'no-store' },
      DEFAULT_FETCH_TIMEOUT_MS
    );

    // Permissive: Any 2xx response automatically establishes ONLINE state
    if (res.ok) {
      let data: any = {};
      try {
        data = await res.json();
      } catch {
        // Plain text 200 or non-JSON 200 is still ONLINE
      }
      return {
        status: 'online',
        ok: true,
        records: Number(data?.database_records ?? data?.records ?? data?.count ?? 0),
        engine: String(data?.clustering_engine ?? data?.engine ?? 'HDBSCAN'),
        is_empty: Boolean(data?.is_empty ?? (data?.database_records === 0)),
      };
    }
    throw new Error(`HTTP ${res.status}`);
  };

  try {
    return await checkEndpoint(API_BASE_URL);
  } catch (err: any) {
    if (isLocalhost) {
      try {
        return await checkEndpoint(ALTERNATE_API_BASE_URL);
      } catch (altErr: any) {
        console.warn(`[FastAPI Health Check Offline] Could not reach ${API_BASE_URL}/api/health:`, altErr.message);
        return { status: 'offline', ok: false, records: 0, engine: 'unavailable', is_empty: true };
      }
    } else {
      console.warn(`[FastAPI Health Check Offline] Could not reach remote ${API_BASE_URL}/api/health:`, err.message);
      return { status: 'offline', ok: false, records: 0, engine: 'unavailable', is_empty: true };
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
    const res = await fetchWithTimeout(
      dbStatusUrl,
      { cache: 'no-store' },
      DEFAULT_FETCH_TIMEOUT_MS
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (err: any) {
    console.error(`[FastAPI DB Status Check Failed] Could not reach ${dbStatusUrl}:`, err.message);
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
    const res = await fetchWithTimeout(
      statsUrl,
      { cache: 'no-store' },
      DEFAULT_FETCH_TIMEOUT_MS
    );
    if (!res.ok) return null;
    return res.json();
  } catch (err: any) {
    console.error(`[FastAPI Stats Check Failed]`, err.message);
    return null;
  }
}

