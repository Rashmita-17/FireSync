export interface BoundingBox {
  min_lon: number;
  min_lat: number;
  max_lon: number;
  max_lat: number;
}

export interface HarmonizationSummary {
  total_observations: number;
  total_clusters: number;
  total_noise_points: number;
  modis_detections: number;
  viirs_detections: number;
  cross_validated_clusters: number;
  cross_validation_rate: number;
  total_harmonized_frp_mw: number;
  spatial_compression_ratio: number;
  execution_time_ms: number;
}

export interface GeoJsonGeometry {
  type: 'Point' | 'Polygon';
  coordinates: any;
}

export interface RawObservation {
  id: number;
  latitude: number;
  longitude: number;
  acq_datetime: string;
  instrument: 'MODIS' | 'VIIRS' | string;
  satellite: string;
  confidence: number;
  frp: number;
  brightness?: number;
  scan?: number;
  track?: number;
  daynight?: string;
  source_file?: string;
}

export interface HarmonizedCluster {
  cluster_id: number;
  centroid_lat: number;
  centroid_lon: number;
  weighted_centroid_lat: number;
  weighted_centroid_lon: number;
  first_detected: string;
  last_detected: string;
  duration_hours: number;
  total_detections: number;
  modis_count: number;
  viirs_count: number;
  sensor_ratio: number;
  cross_validated: boolean;
  total_frp: number;
  peak_frp: number;
  mean_frp: number;
  harmonized_confidence: number;
  estimated_area_km2: number;
  bbox: [number, number, number, number]; // [min_lon, min_lat, max_lon, max_lat]
  geojson_geometry: GeoJsonGeometry;
  observations?: RawObservation[];
}

export interface HarmonizationResponse {
  status: string;
  query_bbox: BoundingBox;
  summary: HarmonizationSummary;
  clusters: HarmonizedCluster[];
  noise_points?: RawObservation[];
  warning?: string;
}

export interface BackendStats {
  total_observations: number;
  modis_observations: number;
  viirs_observations: number;
  sensor_ratio_viirs: number;
  earliest_observation_utc?: string;
  latest_observation_utc?: string;
  total_historical_frp_mw: number;
}

export interface PresetRegion {
  id: string;
  name: string;
  description: string;
  bbox: BoundingBox;
  center: [number, number];
  zoom: number;
}

