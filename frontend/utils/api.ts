import { BoundingBox, HarmonizationResponse, BackendStats, PresetRegion } from '@/types/fire';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

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
 * Calls FastAPI POST /api/harmonize endpoint with bounding box and HDBSCAN parameters
 */
export async function fetchHarmonizedData(params: HarmonizeParams): Promise<HarmonizationResponse> {
  const payload = {
    bbox: params.bbox,
    spatial_bandwidth_km: params.spatial_bandwidth_km ?? 2.5,
    temporal_bandwidth_hours: params.temporal_bandwidth_hours ?? 6.0,
    min_cluster_size: params.min_cluster_size ?? 3,
    min_samples: params.min_samples ?? 1,
    cluster_selection_epsilon: params.cluster_selection_epsilon ?? 0.5,
    min_confidence: params.min_confidence ?? 0.0,
    include_observations: params.include_observations ?? true,
    include_noise: params.include_noise ?? true,
  };

  const response = await fetch(`${API_BASE_URL}/api/harmonize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Harmonization failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Triggers scientific CSV export download from FastAPI /api/export
 */
export async function downloadHarmonizedCsv(params: HarmonizeParams): Promise<void> {
  const payload = {
    bbox: params.bbox,
    spatial_bandwidth_km: params.spatial_bandwidth_km ?? 2.5,
    temporal_bandwidth_hours: params.temporal_bandwidth_hours ?? 6.0,
    min_cluster_size: params.min_cluster_size ?? 3,
    min_samples: params.min_samples ?? 1,
    cluster_selection_epsilon: params.cluster_selection_epsilon ?? 0.5,
  };

  const response = await fetch(`${API_BASE_URL}/api/export`, {
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
export async function fetchHealthStatus(): Promise<{ status: string; records: number; engine: string }> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/health`, { cache: 'no-store' });
    if (!res.ok) return { status: 'offline', records: 0, engine: 'unavailable' };
    const data = await res.json();
    return {
      status: data.status,
      records: data.database_records,
      engine: data.clustering_engine,
    };
  } catch {
    return { status: 'offline', records: 0, engine: 'unavailable' };
  }
}

/**
 * Retrieves aggregate historical dataset statistics
 */
export async function fetchStats(): Promise<BackendStats | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/stats`, { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

