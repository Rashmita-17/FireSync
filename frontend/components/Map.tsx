'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { BoundingBox, HarmonizedCluster, RawObservation } from '@/types/fire';
import { normalizeBoundingBox } from '@/utils/api';
import { Maximize2, Crosshair, Flame, Radio, Pentagon } from 'lucide-react';

interface MapProps {
  bbox: BoundingBox;
  clusters: HarmonizedCluster[];
  noisePoints?: RawObservation[];
  selectedClusterId: number | null;
  onSelectCluster: (cluster: HarmonizedCluster | null) => void;
  onBoundsChange: (newBbox: BoundingBox) => void;
  showPerimeters: boolean;
  showRawObservations: boolean;
  showSubPixels?: boolean;
  showNoisePoints: boolean;
}

// 100% Free Open-Source Basemaps with Zero API Key or Token Dependencies
// OpenFreeMap provides instant, high-speed vector tile styles (OSM-based) with NO API keys or accounts.
export const OPENFREEMAP_DARK_STYLE = 'https://tiles.openfreemap.org/styles/dark';
export const OPENFREEMAP_LIBERTY_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

// CARTO Dark Matter style URL (Note: CARTO now requires an API key for vector basemaps)
const CARTO_API_KEY = process.env.NEXT_PUBLIC_CARTO_API_KEY || '';
export const CARTO_DARK_STYLE = CARTO_API_KEY
  ? `https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json?key=${CARTO_API_KEY}`
  : 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// Default Dark Style: OpenFreeMap Dark (100% Free, zero tokens, dark tactical GIS basemap)
export const DEFAULT_DARK_STYLE =
  process.env.NEXT_PUBLIC_MAP_STYLE ||
  (CARTO_API_KEY ? CARTO_DARK_STYLE : OPENFREEMAP_DARK_STYLE);

export const ESRI_SATELLITE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    'esri-satellite': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution:
        'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
    },
  },
  layers: [
    {
      id: 'esri-satellite-layer',
      type: 'raster',
      source: 'esri-satellite',
    },
  ],
};

export const OSM_RASTER_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    'osm-tiles': {
      type: 'raster',
      tiles: [
        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [
    {
      id: 'osm-tiles-layer',
      type: 'raster',
      source: 'osm-tiles',
      minzoom: 0,
      maxzoom: 19,
    },
  ],
};

// ============================================================================
// DEFENSIVE MAPLIBRE LAYER RENDERING UTILITIES
// Prevents React hot-reloading / Turbopack console errors such as:
// 'Cannot add layer X before non-existing layer Y'
// 'A layer with the id "X" already exists on this map'
// 'A source with this id already exists'
// ============================================================================

function safeUpdateGeoJsonSource(
  map: maplibregl.Map,
  sourceId: string,
  data: GeoJSON.FeatureCollection | GeoJSON.Feature
): boolean {
  if (!map || !map.isStyleLoaded()) return false;
  try {
    const existingSource = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
    if (existingSource) {
      existingSource.setData(data);
    } else {
      map.addSource(sourceId, {
        type: 'geojson',
        data,
      });
    }
    return true;
  } catch (err) {
    console.warn(`[MapLibre] Failed to update source "${sourceId}":`, err);
    return false;
  }
}

function safeAddLayer(
  map: maplibregl.Map,
  layer: maplibregl.LayerSpecification,
  beforeId?: string
) {
  if (!map || !map.isStyleLoaded()) return;
  try {
    // Strict existence check: do not add if layer already exists
    if (map.getLayer(layer.id)) {
      return;
    }
    // Strict existence check on beforeId to prevent 'Cannot add layer X before non-existing layer Y'
    const validBeforeId = beforeId && map.getLayer(beforeId) ? beforeId : undefined;
    map.addLayer(layer, validBeforeId);
  } catch (err) {
    console.warn(`[MapLibre] Failed to add layer "${layer.id}":`, err);
  }
}

function safeRemoveLayer(map: maplibregl.Map, layerId: string) {
  if (!map) return;
  try {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
  } catch (err) {
    console.warn(`[MapLibre] Failed to remove layer "${layerId}":`, err);
  }
}

function safeRemoveSource(map: maplibregl.Map, sourceId: string) {
  if (!map) return;
  try {
    if (map.getSource(sourceId)) {
      map.removeSource(sourceId);
    }
  } catch (err) {
    console.warn(`[MapLibre] Failed to remove source "${sourceId}":`, err);
  }
}

// Generate geodesic circular polygon for cluster perimeter approximations
function generateCirclePolygon(
  centerLon: number,
  centerLat: number,
  radiusMeters: number,
  steps = 32
): [number, number][] {
  const coords: [number, number][] = [];
  const latRad = (centerLat * Math.PI) / 180;
  const lonRad = (centerLon * Math.PI) / 180;
  const earthRadius = 6371000;
  const dByR = radiusMeters / earthRadius;

  for (let i = 0; i <= steps; i++) {
    const bearing = (i * 2 * Math.PI) / steps;
    const pLat = Math.asin(
      Math.sin(latRad) * Math.cos(dByR) +
      Math.cos(latRad) * Math.sin(dByR) * Math.cos(bearing)
    );
    const pLon =
      lonRad +
      Math.atan2(
        Math.sin(bearing) * Math.sin(dByR) * Math.cos(latRad),
        Math.cos(dByR) - Math.sin(latRad) * Math.sin(pLat)
      );
    coords.push([(pLon * 180) / Math.PI, (pLat * 180) / Math.PI]);
  }
  return coords;
}

// Ensure MapboxDraw uses MapLibre's canvas and control classes
if (typeof window !== 'undefined' && MapboxDraw && (MapboxDraw as any).constants?.classes) {
  try {
    const classes = (MapboxDraw as any).constants.classes;
    classes.CANVAS = 'maplibregl-canvas';
    classes.CONTROL_BASE = 'maplibregl-ctrl';
    classes.CONTROL_PREFIX = 'maplibregl-ctrl-';
    classes.CONTROL_GROUP = 'maplibregl-ctrl-group';
    classes.ATTRIBUTION = 'maplibregl-ctrl-attrib';
  } catch {}
}

// MapLibre-compatible theme for Mapbox GL Draw
// Eliminates data-driven `line-dasharray: ['case', ...]` which causes MapLibre to reject and drop the line layer!
export const MAPLIBRE_COMPATIBLE_DRAW_THEME = [
  // Polygon fill
  {
    id: 'gl-draw-polygon-fill',
    type: 'fill',
    filter: ['all', ['==', '$type', 'Polygon']],
    paint: {
      'fill-color': '#06B6D4',
      'fill-opacity': 0.22,
    },
  },
  // Active and inactive lines: solid high-visibility neon cyan lines without buggy conditional line-dasharray
  {
    id: 'gl-draw-lines',
    type: 'line',
    filter: ['any', ['==', '$type', 'LineString'], ['==', '$type', 'Polygon']],
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': '#22D3EE',
      'line-width': 3,
    },
  },
  // Active Line highlight
  {
    id: 'gl-draw-lines-active',
    type: 'line',
    filter: ['all', ['==', '$type', 'LineString'], ['==', 'active', 'true']],
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': '#38BDF8',
      'line-width': 3.5,
    },
  },
  // Point feature halo
  {
    id: 'gl-draw-point-outer',
    type: 'circle',
    filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'feature']],
    paint: {
      'circle-radius': 7,
      'circle-color': '#FFFFFF',
    },
  },
  // Point feature center
  {
    id: 'gl-draw-point-inner',
    type: 'circle',
    filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'feature']],
    paint: {
      'circle-radius': 5,
      'circle-color': '#06B6D4',
    },
  },
  // Vertex handle outer
  {
    id: 'gl-draw-vertex-outer',
    type: 'circle',
    filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'vertex'], ['!=', 'mode', 'simple_select']],
    paint: {
      'circle-radius': 7,
      'circle-color': '#FFFFFF',
    },
  },
  // Vertex handle inner
  {
    id: 'gl-draw-vertex-inner',
    type: 'circle',
    filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'vertex'], ['!=', 'mode', 'simple_select']],
    paint: {
      'circle-radius': 5,
      'circle-color': '#0891B2',
    },
  },
  // Midpoint handle
  {
    id: 'gl-draw-midpoint',
    type: 'circle',
    filter: ['all', ['==', 'meta', 'midpoint']],
    paint: {
      'circle-radius': 4,
      'circle-color': '#F59E0B',
    },
  },
];

export default function DisasterMap({
  bbox,
  clusters,
  noisePoints = [],
  selectedClusterId,
  onSelectCluster,
  onBoundsChange,
  showPerimeters,
  showRawObservations,
  showSubPixels,
  showNoisePoints,
}: MapProps) {
  const safeClusters = Array.isArray(clusters) ? clusters.filter(Boolean) : [];
  const safeNoisePoints = Array.isArray(noisePoints) ? noisePoints.filter(Boolean) : [];

  const isSubPixelsVisible = showSubPixels !== undefined ? showSubPixels : showRawObservations;
  const isPerimetersVisible = showPerimeters;
  const isNoiseVisible = showNoisePoints;

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<maplibregl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const hoverPopupRef = useRef<maplibregl.Popup | null>(null);
  const currentThemeRef = useRef<'dark' | 'satellite' | 'streets'>('dark');

  const [drawingMode, setDrawingMode] = useState<'none' | 'box' | 'polygon'>('none');
  const [boxDrawCorner, setBoxDrawCorner] = useState<{ lng: number; lat: number } | null>(null);
  const [screenBox, setScreenBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  } | null>(null);
  const isDrawing = drawingMode !== 'none';
  const [mapTileTheme, setMapTileTheme] = useState<'dark' | 'satellite' | 'streets'>('dark');
  const [styleEpoch, setStyleEpoch] = useState(0);

  // Helper: determine marker color from FRP
  const getFrpColor = (frp: number) => {
    if (frp >= 200) return '#FF1744'; // Extreme Red
    if (frp >= 80) return '#FF5252';  // High Red
    if (frp >= 30) return '#FF9100';  // Amber Orange
    return '#FFEA00';                 // Yellow Gold
  };

  // Helper: format date
  const formatUtcTime = (isoStr: string) => {
    try {
      const d = new Date(isoStr);
      return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
    } catch {
      return isoStr;
    }
  };

  // 1. Initialize MapLibre Map Instance
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const initialCenter: [number, number] = [
      (bbox.min_lon + bbox.max_lon) / 2,
      (bbox.min_lat + bbox.max_lat) / 2,
    ];

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: DEFAULT_DARK_STYLE,
      center: initialCenter,
      zoom: 7,
      attributionControl: false,
    });

    // Tactical Navigation Controls (top-right)
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');

    // Bottom-right attribution
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: 'NASA FIRMS / MODIS & VIIRS &bull; OpenFreeMap &bull; OpenStreetMap contributors',
      }),
      'bottom-right'
    );

    // Initialize Mapbox GL Draw control with MapLibre-compatible theme (no expression line-dasharray)
    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {
        polygon: true,
        trash: true,
      },
      defaultMode: 'simple_select',
      styles: MAPLIBRE_COMPATIBLE_DRAW_THEME,
    });
    drawRef.current = draw;

    // Hook draw control into MapLibre instance defensively (without throwing React/Turbopack error)
    try {
      map.addControl(draw as unknown as maplibregl.IControl, 'top-left');
    } catch (drawErr) {
      console.warn('[MapboxDraw] Could not add draw control to MapLibre:', drawErr);
    }

    // Handle polygon creation/updates from Mapbox Draw
    const handleDrawGeometry = (e: any) => {
      try {
        const feature = e?.features?.[0];
        if (feature?.geometry?.type === 'Polygon') {
          const coords: [number, number][] = feature.geometry.coordinates[0];
          if (Array.isArray(coords) && coords.length >= 3) {
            let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
            for (const [lon, lat] of coords) {
              if (lon < minLon) minLon = lon;
              if (lon > maxLon) maxLon = lon;
              if (lat < minLat) minLat = lat;
              if (lat > maxLat) maxLat = lat;
            }
            if (Math.abs(maxLat - minLat) > 0.005 && Math.abs(maxLon - minLon) > 0.005) {
              const newBbox: BoundingBox = {
                min_lat: minLat,
                max_lat: maxLat,
                min_lon: minLon,
                max_lon: maxLon,
              };
              onBoundsChange(normalizeBoundingBox(newBbox));
            }
          }
        }
      } catch (err) {
        console.warn('[MapboxDraw] Error processing geometry:', err);
      } finally {
        setDrawingMode('none');
      }
    };

    (map as any).on('draw.create', handleDrawGeometry);
    (map as any).on('draw.update', handleDrawGeometry);
    (map as any).on('draw.modechange', (e: any) => {
      const isPolygon = Boolean(e?.mode && e.mode.startsWith('draw_'));
      setDrawingMode((prev) => (isPolygon ? 'polygon' : prev === 'polygon' ? 'none' : prev));
    });

    map.on('load', () => {
      map.resize();
      map.getCanvas().classList.add('mapboxgl-canvas');
      map.getContainer().classList.add('mapboxgl-map');
      setStyleEpoch((prev) => prev + 1);
    });

    map.on('style.load', () => {
      map.resize();
      map.getCanvas().classList.add('mapboxgl-canvas');
      map.getContainer().classList.add('mapboxgl-map');
      setStyleEpoch((prev) => prev + 1);
    });

    // Defensive fallback: if the primary vector style cannot authenticate or fails to load,
    // fallback gracefully to OpenStreetMap raster tiles so the user is never left with a black void.
    let styleFallbackApplied = false;
    map.on('error', (e) => {
      console.warn('[MapLibre Event Notice]:', (e as any)?.error || e);
      if (!map.isStyleLoaded() && !styleFallbackApplied) {
        const errorStr = String((e as any)?.error?.message || (e as any)?.message || '');
        const status = (e as any)?.error?.status || (e as any)?.status;
        if (
          status === 401 ||
          status === 403 ||
          errorStr.includes('401') ||
          errorStr.includes('403') ||
          errorStr.includes('Failed to fetch')
        ) {
          styleFallbackApplied = true;
          console.warn('[MapLibre] Vector style authentication failed. Applying OpenStreetMap raster fallback.');
          try {
            map.setStyle(OSM_RASTER_STYLE);
          } catch (err) {
            console.error('[MapLibre] Fallback failed:', err);
          }
        }
      }
    });

    // ResizeObserver ensures canvas always fills the responsive container
    const resizeObserver = new ResizeObserver(() => {
      map.resize();
    });
    if (mapContainerRef.current) {
      resizeObserver.observe(mapContainerRef.current);
    }

    // Force an immediate layout resize calculation after DOM attachment
    const resizeTimer = setTimeout(() => {
      map.resize();
    }, 150);

    mapInstanceRef.current = map;

    return () => {
      clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      if (drawRef.current && mapInstanceRef.current) {
        try {
          if (mapInstanceRef.current.hasControl(drawRef.current as unknown as maplibregl.IControl)) {
            mapInstanceRef.current.removeControl(drawRef.current as unknown as maplibregl.IControl);
          }
        } catch {}
        drawRef.current = null;
      }
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      if (hoverPopupRef.current) {
        hoverPopupRef.current.remove();
        hoverPopupRef.current = null;
      }
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // 2. Basemap Style Switcher (only triggers when theme actually changes, NOT on initial mount)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (currentThemeRef.current === mapTileTheme) return;
    currentThemeRef.current = mapTileTheme;

    const targetStyle =
      mapTileTheme === 'dark'
        ? DEFAULT_DARK_STYLE
        : mapTileTheme === 'satellite'
        ? ESRI_SATELLITE_STYLE
        : OPENFREEMAP_LIBERTY_STYLE;

    map.setStyle(targetStyle);
  }, [mapTileTheme]);

  // 3. Defensive Bounding Box Layer Rendering
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const renderBbox = () => {
      if (!map.isStyleLoaded()) return;

      const bboxGeoJson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [bbox.min_lon, bbox.min_lat],
                  [bbox.max_lon, bbox.min_lat],
                  [bbox.max_lon, bbox.max_lat],
                  [bbox.min_lon, bbox.max_lat],
                  [bbox.min_lon, bbox.min_lat],
                ],
              ],
            },
            properties: {},
          },
        ],
      };

      safeUpdateGeoJsonSource(map, 'bbox-source', bboxGeoJson);

      safeAddLayer(map, {
        id: 'bbox-fill-layer',
        type: 'fill',
        source: 'bbox-source',
        paint: {
          'fill-color': '#06B6D4',
          'fill-opacity': 0.08,
        },
      });

      // Outer glow line for high visibility
      safeAddLayer(map, {
        id: 'bbox-glow-layer',
        type: 'line',
        source: 'bbox-source',
        paint: {
          'line-color': '#0891B2',
          'line-width': 6,
          'line-opacity': 0.35,
        },
      });

      // Sharp inner tactical border
      safeAddLayer(map, {
        id: 'bbox-line-layer',
        type: 'line',
        source: 'bbox-source',
        paint: {
          'line-color': '#22D3EE',
          'line-width': 2.5,
        },
      });
    };

    if (map.isStyleLoaded()) {
      renderBbox();
    } else {
      map.once('style.load', renderBbox);
      return () => {
        map.off('style.load', renderBbox);
      };
    }
  }, [bbox, styleEpoch]);

  // 4. Defensive Perimeters / Footprints Layer Rendering
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const renderPerimeters = () => {
      if (!map.isStyleLoaded()) return;

      if (!isPerimetersVisible) {
        safeRemoveLayer(map, 'perimeters-line');
        safeRemoveLayer(map, 'perimeters-fill');
        safeRemoveSource(map, 'perimeters-source');
        return;
      }

      const perimeterFeatures: GeoJSON.Feature[] = safeClusters.map((cluster) => {
        const isSelected = selectedClusterId === cluster.cluster_id;
        const frpColor = getFrpColor(cluster.total_frp);

        let coordinates: [number, number][][];
        if (cluster.geojson_geometry && cluster.geojson_geometry.type === 'Polygon') {
          coordinates = cluster.geojson_geometry.coordinates;
        } else {
          const radiusMeters = Math.max(375, Math.sqrt((cluster.estimated_area_km2 || 1.0) / Math.PI) * 1000);
          coordinates = [generateCirclePolygon(cluster.centroid_lon, cluster.centroid_lat, radiusMeters)];
        }

        return {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates,
          },
          properties: {
            cluster_id: cluster.cluster_id,
            color: frpColor,
            selected: isSelected,
            total_frp: cluster.total_frp,
          },
        };
      });

      const perimetersGeoJson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: perimeterFeatures,
      };

      safeUpdateGeoJsonSource(map, 'perimeters-source', perimetersGeoJson);

      safeAddLayer(map, {
        id: 'perimeters-fill',
        type: 'fill',
        source: 'perimeters-source',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': ['case', ['get', 'selected'], 0.35, 0.18],
        },
      });

      safeAddLayer(map, {
        id: 'perimeters-line',
        type: 'line',
        source: 'perimeters-source',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['case', ['get', 'selected'], 3, 1.5],
          'line-dasharray': [2, 2],
        },
      });
    };

    if (map.isStyleLoaded()) {
      renderPerimeters();
    } else {
      map.once('style.load', renderPerimeters);
      return () => {
        map.off('style.load', renderPerimeters);
      };
    }
  }, [safeClusters, selectedClusterId, isPerimetersVisible, styleEpoch]);

  // Click & hover interactions on perimeters
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const onPerimeterClick = (e: maplibregl.MapLayerMouseEvent) => {
      if (!map.getLayer('perimeters-fill')) return;
      const feature = e.features?.[0];
      if (feature?.properties?.cluster_id !== undefined) {
        const clusterId = Number(feature.properties.cluster_id);
        const found = safeClusters.find((c) => c.cluster_id === clusterId);
        if (found) {
          onSelectCluster(found);
        }
      }
    };

    const onPerimeterEnter = () => {
      if (map.getLayer('perimeters-fill')) {
        map.getCanvas().style.cursor = 'pointer';
      }
    };

    const onPerimeterLeave = () => {
      map.getCanvas().style.cursor = '';
    };

    if (map.getLayer('perimeters-fill')) {
      map.on('click', 'perimeters-fill', onPerimeterClick);
      map.on('mouseenter', 'perimeters-fill', onPerimeterEnter);
      map.on('mouseleave', 'perimeters-fill', onPerimeterLeave);
    }

    return () => {
      if (map.getLayer('perimeters-fill')) {
        map.off('click', 'perimeters-fill', onPerimeterClick);
        map.off('mouseenter', 'perimeters-fill', onPerimeterEnter);
        map.off('mouseleave', 'perimeters-fill', onPerimeterLeave);
      }
    };
  }, [safeClusters, onSelectCluster, styleEpoch, isPerimetersVisible]);

  // 5. Cluster Tactical FRP Beacon Markers with Popups
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Clear existing markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    safeClusters.forEach((cluster) => {
      const isSelected = selectedClusterId === cluster.cluster_id;
      const frpColor = getFrpColor(cluster.total_frp);
      const size = Math.min(46, Math.max(26, Math.round(Math.sqrt(cluster.total_frp) * 2.2)));
      const pulseSize = size + 16;

      const markerEl = document.createElement('div');
      markerEl.className = 'custom-fire-marker cursor-pointer select-none';
      markerEl.style.width = `${pulseSize}px`;
      markerEl.style.height = `${pulseSize}px`;

      markerEl.innerHTML = `
        <div class="relative flex items-center justify-center w-full h-full group">
          <!-- Radar beacon pulse ring -->
          <div class="absolute inset-0 rounded-full animate-ping opacity-30" style="background-color: ${frpColor};"></div>
          <!-- Outer glowing circle -->
          <div class="absolute rounded-full border shadow-lg ${isSelected ? 'ring-2 ring-white scale-110' : ''}" 
               style="width: ${size}px; height: ${size}px; background: radial-gradient(circle, ${frpColor}EE 30%, ${frpColor}88 80%); border-color: ${frpColor};">
          </div>
          <!-- Center Tactical Symbol / Multi-Sensor Indicator -->
          <div class="relative z-10 flex flex-col items-center justify-center text-[10px] font-bold text-white leading-none">
            ${cluster.cross_validated ? '<span class="text-[9px] tracking-tight">M+V</span>' : '<span>⚡</span>'}
            <span class="text-[8px] opacity-90">${Math.round(cluster.total_frp)}</span>
          </div>
        </div>
      `;

      // Tactical Popup
      const popupContent = `
        <div class="p-2 min-w-[240px] text-slate-100 bg-slate-900 rounded-lg border border-slate-700 shadow-xl font-sans text-xs">
          <div class="flex items-center justify-between pb-1 mb-2 border-b border-slate-800">
            <span class="font-bold text-sm tracking-wide text-white">Event #${cluster.cluster_id}</span>
            ${cluster.cross_validated
              ? '<span class="px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 rounded">M+V Cross-Validated</span>'
              : '<span class="px-1.5 py-0.5 text-[10px] font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/40 rounded">Single Sensor</span>'
            }
          </div>
          <div class="space-y-1.5">
            <div class="flex justify-between">
              <span class="text-slate-400">Total FRP:</span>
              <span class="font-semibold text-rose-400">${cluster.total_frp.toFixed(1)} MW</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">Harmonized Confidence:</span>
              <span class="font-semibold text-emerald-400">${cluster.harmonized_confidence.toFixed(1)}%</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">Est. Footprint Area:</span>
              <span class="font-semibold text-cyan-400">${cluster.estimated_area_km2.toFixed(2)} km²</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">Sensor Detections:</span>
              <span class="font-mono text-slate-200">
                <span class="text-purple-400">${cluster.modis_count} MODIS</span> + 
                <span class="text-cyan-400">${cluster.viirs_count} VIIRS</span> (${cluster.total_detections} total)
              </span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">Duration:</span>
              <span class="font-semibold text-slate-300">${cluster.duration_hours.toFixed(1)} hrs</span>
            </div>
            <div class="pt-1 text-[10px] text-slate-500">
              First detected: ${formatUtcTime(cluster.first_detected)}
            </div>
          </div>
        </div>
      `;

      const popup = new maplibregl.Popup({
        offset: [0, -10],
        className: 'tactical-maplibre-popup',
        closeButton: true,
        maxWidth: '300px',
      }).setHTML(popupContent);

      const markerLat = cluster.weighted_centroid_lat ?? cluster.centroid_lat;
      const markerLon = cluster.weighted_centroid_lon ?? cluster.centroid_lon;

      const marker = new maplibregl.Marker({
        element: markerEl,
      })
        .setLngLat([markerLon, markerLat])
        .setPopup(popup)
        .addTo(map);

      markerEl.addEventListener('click', () => {
        onSelectCluster(cluster);
      });

      markersRef.current.push(marker);
    });
  }, [safeClusters, selectedClusterId, onSelectCluster, styleEpoch]);

  // 6. Defensive Raw Observations (MODIS vs VIIRS sub-pixels) Layer
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const renderRawObs = () => {
      if (!map.isStyleLoaded()) return;

      if (!isSubPixelsVisible) {
        safeRemoveLayer(map, 'raw-obs-circle');
        safeRemoveSource(map, 'raw-obs-source');
        return;
      }

      const obsFeatures: GeoJSON.Feature[] = [];
      safeClusters.forEach((cluster) => {
        const observations =
          cluster.observations && cluster.observations.length > 0
            ? cluster.observations
            : [
                {
                  id: cluster.cluster_id,
                  latitude: cluster.weighted_centroid_lat,
                  longitude: cluster.weighted_centroid_lon,
                  acq_datetime: cluster.first_detected,
                  instrument: cluster.cross_validated
                    ? 'MODIS+VIIRS'
                    : cluster.viirs_count > 0
                    ? 'VIIRS'
                    : 'MODIS',
                  satellite: cluster.cross_validated
                    ? 'Multi-Sensor'
                    : cluster.viirs_count > 0
                    ? 'NOAA-20'
                    : 'Aqua/Terra',
                  confidence: cluster.harmonized_confidence,
                  confidence_raw: 'high',
                  frp: cluster.total_frp,
                  brightness: null,
                  scan: 0.375,
                  track: 0.375,
                  daynight: 'D',
                  source_file: null,
                  created_at: cluster.first_detected,
                },
              ];

        observations.forEach((obs) => {
          const isModis = obs.instrument.toUpperCase().includes('MODIS');
          obsFeatures.push({
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [obs.longitude, obs.latitude],
            },
            properties: {
              instrument: obs.instrument,
              satellite: obs.satellite,
              frp: obs.frp,
              confidence: obs.confidence,
              color: isModis ? '#C084FC' : '#06B6D4',
              strokeColor: isModis ? '#E9D5FF' : '#67E8F9',
              radius: isModis ? 6 : 4,
            },
          });
        });
      });

      safeUpdateGeoJsonSource(map, 'raw-obs-source', {
        type: 'FeatureCollection',
        features: obsFeatures,
      });

      safeAddLayer(map, {
        id: 'raw-obs-circle',
        type: 'circle',
        source: 'raw-obs-source',
        paint: {
          'circle-radius': ['get', 'radius'],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': ['get', 'strokeColor'],
          'circle-stroke-width': 1.5,
          'circle-opacity': 0.85,
        },
      });
    };

    if (map.isStyleLoaded()) {
      renderRawObs();
    } else {
      map.once('style.load', renderRawObs);
      return () => {
        map.off('style.load', renderRawObs);
      };
    }
  }, [safeClusters, isSubPixelsVisible, styleEpoch]);

  // 7. Defensive Noise Points (Isolated Singletons / Solar Glints) Layer
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const renderNoise = () => {
      if (!map.isStyleLoaded()) return;

      if (!isNoiseVisible || !safeNoisePoints.length) {
        safeRemoveLayer(map, 'noise-points-circle');
        safeRemoveSource(map, 'noise-points-source');
        return;
      }

      const noiseFeatures: GeoJSON.Feature[] = safeNoisePoints.map((obs) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [obs.longitude, obs.latitude],
        },
        properties: {
          instrument: obs.instrument,
          satellite: obs.satellite,
          frp: obs.frp,
        },
      }));

      safeUpdateGeoJsonSource(map, 'noise-points-source', {
        type: 'FeatureCollection',
        features: noiseFeatures,
      });

      safeAddLayer(map, {
        id: 'noise-points-circle',
        type: 'circle',
        source: 'noise-points-source',
        paint: {
          'circle-radius': 4,
          'circle-color': '#64748B',
          'circle-stroke-color': '#94A3B8',
          'circle-stroke-width': 1.5,
          'circle-opacity': 0.6,
        },
      });
    };

    if (map.isStyleLoaded()) {
      renderNoise();
    } else {
      map.once('style.load', renderNoise);
      return () => {
        map.off('style.load', renderNoise);
      };
    }
  }, [safeNoisePoints, isNoiseVisible, styleEpoch]);

  // Tooltips for sub-pixels and noise points with strict layer existence guards
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !map.isStyleLoaded()) return;

    if (!hoverPopupRef.current) {
      hoverPopupRef.current = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        className: 'tactical-maplibre-popup',
        offset: 8,
      });
    }
    const popup = hoverPopupRef.current;

    const onMouseEnterRaw = (e: maplibregl.MapLayerMouseEvent) => {
      if (!map.getLayer('raw-obs-circle')) return;
      map.getCanvas().style.cursor = 'pointer';
      const feature = e.features?.[0];
      if (feature?.properties) {
        const p = feature.properties;
        const html = `
          <div class="p-1.5 text-[11px] bg-slate-900 text-white rounded border border-slate-700 font-sans shadow-lg">
            <strong>${p.instrument}</strong> (${p.satellite})<br/>
            FRP: <span class="text-rose-400 font-semibold">${Number(p.frp).toFixed(1)} MW</span> | 
            Conf: <span class="text-emerald-400 font-semibold">${p.confidence}%</span>
          </div>
        `;
        popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
      }
    };

    const onMouseLeaveRaw = () => {
      map.getCanvas().style.cursor = '';
      popup.remove();
    };

    const onMouseEnterNoise = (e: maplibregl.MapLayerMouseEvent) => {
      if (!map.getLayer('noise-points-circle')) return;
      map.getCanvas().style.cursor = 'pointer';
      const feature = e.features?.[0];
      if (feature?.properties) {
        const p = feature.properties;
        const html = `
          <div class="p-1.5 text-[11px] bg-slate-900 text-slate-300 rounded border border-slate-700 font-sans shadow-lg">
            <strong>Noise / Isolated singleton</strong><br/>
            ${p.instrument} (${p.satellite})<br/>
            FRP: <span class="text-amber-400 font-semibold">${Number(p.frp).toFixed(1)} MW</span>
          </div>
        `;
        popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
      }
    };

    const onMouseLeaveNoise = () => {
      map.getCanvas().style.cursor = '';
      popup.remove();
    };

    if (map.getLayer('raw-obs-circle')) {
      map.on('mouseenter', 'raw-obs-circle', onMouseEnterRaw);
      map.on('mouseleave', 'raw-obs-circle', onMouseLeaveRaw);
    }

    if (map.getLayer('noise-points-circle')) {
      map.on('mouseenter', 'noise-points-circle', onMouseEnterNoise);
      map.on('mouseleave', 'noise-points-circle', onMouseLeaveNoise);
    }

    return () => {
      popup.remove();
      if (map.getLayer('raw-obs-circle')) {
        map.off('mouseenter', 'raw-obs-circle', onMouseEnterRaw);
        map.off('mouseleave', 'raw-obs-circle', onMouseLeaveRaw);
      }
      if (map.getLayer('noise-points-circle')) {
        map.off('mouseenter', 'noise-points-circle', onMouseEnterNoise);
        map.off('mouseleave', 'noise-points-circle', onMouseLeaveNoise);
      }
    };
  }, [styleEpoch, isSubPixelsVisible, isNoiseVisible]);

  // 8. Interactive Area of Interest (AOI) Dual-Mode Drawing:
  // Mode A: Drag-and-release OR 2-click Box drawing (custom WebGL preview layers + window pointerup)
  // Mode B: MapboxDraw Polygon drawing (freehand multi-vertex polygon with automatic bounding box)
  const boxStartRef = useRef<{ lng: number; lat: number; screenX: number; screenY: number } | null>(null);
  const isMouseDownRef = useRef(false);

  // Handle Box Drawing Mode events
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (drawingMode !== 'box') {
      safeRemoveLayer(map, 'draw-aoi-line');
      safeRemoveLayer(map, 'draw-aoi-fill');
      safeRemoveSource(map, 'draw-aoi-source');
      boxStartRef.current = null;
      isMouseDownRef.current = false;
      setBoxDrawCorner(null);
      setScreenBox(null);
      return;
    }

    map.dragPan.disable();
    map.getCanvas().style.cursor = 'crosshair';

    const canvas = map.getCanvas();

    const updatePreviewBox = (start: { lng: number; lat: number }, cur: { lng: number; lat: number }) => {
      const minX = Math.min(start.lng, cur.lng);
      const maxX = Math.max(start.lng, cur.lng);
      const minY = Math.min(start.lat, cur.lat);
      const maxY = Math.max(start.lat, cur.lat);

      // 1. Update Real-Time Screen-Space Overlay Box (0ms lag, luminous glowing border)
      try {
        const p1 = map.project([minX, maxY]);
        const p2 = map.project([maxX, minY]);
        setScreenBox({
          left: Math.min(p1.x, p2.x),
          top: Math.min(p1.y, p2.y),
          width: Math.max(2, Math.abs(p2.x - p1.x)),
          height: Math.max(2, Math.abs(p2.y - p1.y)),
          minLat: minY,
          maxLat: maxY,
          minLon: minX,
          maxLon: maxX,
        });
      } catch {}

      // 2. Also update MapLibre GeoJSON preview layer
      const rectGeoJson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [minX, minY],
                  [maxX, minY],
                  [maxX, maxY],
                  [minX, maxY],
                  [minX, minY],
                ],
              ],
            },
            properties: {},
          },
        ],
      };

      safeUpdateGeoJsonSource(map, 'draw-aoi-source', rectGeoJson);

      safeAddLayer(map, {
        id: 'draw-aoi-fill',
        type: 'fill',
        source: 'draw-aoi-source',
        paint: {
          'fill-color': '#06B6D4',
          'fill-opacity': 0.22,
        },
      });

      safeAddLayer(map, {
        id: 'draw-aoi-line',
        type: 'line',
        source: 'draw-aoi-source',
        paint: {
          'line-color': '#22D3EE',
          'line-width': 3,
        },
      });
    };

    const finishBox = (start: { lng: number; lat: number }, end: { lng: number; lat: number }) => {
      const south = Math.min(start.lat, end.lat);
      const north = Math.max(start.lat, end.lat);
      const west = Math.min(start.lng, end.lng);
      const east = Math.max(start.lng, end.lng);

      if (Math.abs(north - south) > 0.005 && Math.abs(east - west) > 0.005) {
        const rawBox: BoundingBox = {
          min_lat: south,
          max_lat: north,
          min_lon: west,
          max_lon: east,
        };
        onBoundsChange(normalizeBoundingBox(rawBox));
      }

      safeRemoveLayer(map, 'draw-aoi-line');
      safeRemoveLayer(map, 'draw-aoi-fill');
      safeRemoveSource(map, 'draw-aoi-source');
      boxStartRef.current = null;
      isMouseDownRef.current = false;
      setBoxDrawCorner(null);
      setScreenBox(null);
      setDrawingMode('none');
      map.dragPan.enable();
      map.getCanvas().style.cursor = '';
    };

    const onMapMouseDown = (e: maplibregl.MapMouseEvent) => {
      e.originalEvent?.preventDefault?.();
      if (!boxStartRef.current) {
        boxStartRef.current = {
          lng: e.lngLat.lng,
          lat: e.lngLat.lat,
          screenX: e.point.x,
          screenY: e.point.y,
        };
        isMouseDownRef.current = true;
        setBoxDrawCorner({ lng: e.lngLat.lng, lat: e.lngLat.lat });
      } else {
        // Second click in 2-click mode finishes the box!
        finishBox(boxStartRef.current, { lng: e.lngLat.lng, lat: e.lngLat.lat });
      }
    };

    const onWindowMouseMove = (e: MouseEvent) => {
      if (!boxStartRef.current) return;
      const rect = canvas.getBoundingClientRect();
      const currentX = e.clientX - rect.left;
      const currentY = e.clientY - rect.top;
      try {
        const curLngLat = map.unproject([currentX, currentY]);
        updatePreviewBox(boxStartRef.current, { lng: curLngLat.lng, lat: curLngLat.lat });
      } catch {}
    };

    const onWindowMouseUp = (e: MouseEvent) => {
      if (!isMouseDownRef.current || !boxStartRef.current) return;
      isMouseDownRef.current = false;

      const rect = canvas.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const dist = Math.hypot(
        screenX - boxStartRef.current.screenX,
        screenY - boxStartRef.current.screenY
      );

      // If user dragged more than 8 pixels, complete the drag-to-box!
      if (dist >= 8) {
        try {
          const endLngLat = map.unproject([screenX, screenY]);
          finishBox(boxStartRef.current, { lng: endLngLat.lng, lat: endLngLat.lat });
        } catch {}
      } else {
        // Keep first corner pinned for 2-click box
        setBoxDrawCorner({ lng: boxStartRef.current.lng, lat: boxStartRef.current.lat });
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        safeRemoveLayer(map, 'draw-aoi-line');
        safeRemoveLayer(map, 'draw-aoi-fill');
        safeRemoveSource(map, 'draw-aoi-source');
        boxStartRef.current = null;
        isMouseDownRef.current = false;
        setBoxDrawCorner(null);
        setScreenBox(null);
        setDrawingMode('none');
        map.dragPan.enable();
        map.getCanvas().style.cursor = '';
      }
    };

    map.on('mousedown', onMapMouseDown);
    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      map.off('mousedown', onMapMouseDown);
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [drawingMode, onBoundsChange]);

  // Toggle Box Draw Mode
  const toggleBoxDrawMode = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (drawingMode === 'box') {
      setDrawingMode('none');
    } else {
      if (drawRef.current) {
        try {
          drawRef.current.changeMode('simple_select');
          drawRef.current.deleteAll();
        } catch {}
      }
      setDrawingMode('box');
    }
  }, [drawingMode]);

  // Toggle MapboxDraw Polygon Draw Mode
  const togglePolygonDrawMode = useCallback(() => {
    const map = mapInstanceRef.current;
    const draw = drawRef.current;
    if (!map || !draw) return;

    if (drawingMode === 'polygon') {
      try {
        draw.changeMode('simple_select');
      } catch {}
      setDrawingMode('none');
    } else {
      try {
        draw.deleteAll();
        draw.changeMode('draw_polygon');
      } catch (err) {
        console.warn('MapboxDraw changeMode error:', err);
      }
      setDrawingMode('polygon');
    }
  }, [drawingMode]);

  // Fit view to current bounding box
  const fitToQueryBounds = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    map.fitBounds(
      [
        [bbox.min_lon, bbox.min_lat],
        [bbox.max_lon, bbox.max_lat],
      ],
      { padding: 30 }
    );
  }, [bbox]);

  return (
    <div className={`relative w-full h-full overflow-hidden bg-slate-950 ${isDrawing ? 'drawing-active' : ''}`}>
      {/* Map Container */}
      <div ref={mapContainerRef} className="absolute inset-0 w-full h-full z-0" />

      {/* Screen-Space Live Drawing Preview Box (0ms hardware-accelerated, glowing neon cyan lines) */}
      {screenBox && (
        <div
          className="absolute pointer-events-none z-[800] border-2 border-dashed border-cyan-400 bg-cyan-500/20 backdrop-blur-[1px] shadow-[0_0_15px_rgba(6,182,212,0.6)]"
          style={{
            left: `${screenBox.left}px`,
            top: `${screenBox.top}px`,
            width: `${screenBox.width}px`,
            height: `${screenBox.height}px`,
          }}
        >
          {/* Coordinates chip badge */}
          <div className="absolute -top-7 left-0 px-2 py-0.5 bg-slate-900/95 border border-cyan-400/80 rounded text-[10px] font-mono text-cyan-300 whitespace-nowrap shadow-md">
            AOI: {screenBox.minLat.toFixed(2)}°, {screenBox.minLon.toFixed(2)}° → {screenBox.maxLat.toFixed(2)}°, {screenBox.maxLon.toFixed(2)}°
          </div>
        </div>
      )}

      {/* Floating Tactical Overlay Controls (Unified Responsive Top Bar) */}
      <div className="absolute top-4 left-4 right-16 z-[1000] flex flex-wrap items-center justify-between gap-4 pointer-events-none">
        {/* Left Side: Drawing Tools & Basemap Switcher */}
        <div className="flex flex-wrap items-center gap-2 pointer-events-auto">
          <div className="flex items-center gap-1.5 p-1.5 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-lg shadow-2xl">
            {/* Box Draw Mode: Drag or 2-Click */}
            <button
              onClick={toggleBoxDrawMode}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all ${
                drawingMode === 'box'
                  ? 'bg-cyan-500 text-slate-950 shadow-glow-cyan font-semibold animate-pulse'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700'
              }`}
              title="Click & drag or click 2 opposite corners to define Area of Interest box"
            >
              <Crosshair className="w-3.5 h-3.5" />
              <span>
                {drawingMode === 'box'
                  ? boxDrawCorner
                    ? 'Click 2nd Corner'
                    : 'Drawing Box...'
                  : 'Draw AOI Box'}
              </span>
            </button>

            {/* Polygon Draw Mode: MapboxDraw multi-vertex */}
            <button
              onClick={togglePolygonDrawMode}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all ${
                drawingMode === 'polygon'
                  ? 'bg-cyan-500 text-slate-950 shadow-glow-cyan font-semibold animate-pulse'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700'
              }`}
              title="Draw multi-point polygon Area of Interest (click points, double-click to complete)"
            >
              <Pentagon className="w-3.5 h-3.5" />
              <span>{drawingMode === 'polygon' ? 'Drawing Polygon...' : 'Draw Polygon'}</span>
            </button>

            <button
              onClick={fitToQueryBounds}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded border border-slate-700 text-xs transition"
              title="Fit view to current bounding box"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>

            <div className="h-4 w-px bg-slate-800 mx-1" />

            {/* Map Layer Style Switcher (100% Free Open-Source Tiles) */}
            <div className="flex bg-slate-800/80 p-0.5 rounded border border-slate-700/80 text-[11px]">
              <button
                onClick={() => setMapTileTheme('dark')}
                className={`px-2 py-1 rounded transition ${
                  mapTileTheme === 'dark'
                    ? 'bg-cyan-600 text-white font-medium shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Tactical Dark Map (OpenFreeMap Dark Vector)"
              >
                Dark
              </button>
              <button
                onClick={() => setMapTileTheme('satellite')}
                className={`px-2 py-1 rounded transition ${
                  mapTileTheme === 'satellite'
                    ? 'bg-cyan-600 text-white font-medium shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="High-Resolution Satellite Imagery (ESRI World Imagery)"
              >
                Sat
              </button>
              <button
                onClick={() => setMapTileTheme('streets')}
                className={`px-2 py-1 rounded transition ${
                  mapTileTheme === 'streets'
                    ? 'bg-cyan-600 text-white font-medium shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Vector Streets (OpenFreeMap Liberty)"
              >
                Street
              </button>
            </div>
          </div>

          {drawingMode === 'box' && (
            <div className="px-3 py-1.5 bg-cyan-950/90 border border-cyan-500/50 rounded-lg text-xs text-cyan-200 backdrop-blur-md shadow-lg flex items-center gap-2">
              <Radio className="w-3.5 h-3.5 animate-pulse text-cyan-400" />
              <span>
                {boxDrawCorner
                  ? 'Corner 1 set. Click opposite corner on map to finish (or Esc to cancel)'
                  : 'Drag across map OR click 2 opposite corners to define AOI (Esc to cancel)'}
              </span>
            </div>
          )}

          {drawingMode === 'polygon' && (
            <div className="px-3 py-1.5 bg-cyan-950/90 border border-cyan-500/50 rounded-lg text-xs text-cyan-200 backdrop-blur-md shadow-lg flex items-center gap-2">
              <Radio className="w-3.5 h-3.5 animate-pulse text-cyan-400" />
              <span>Click points on map to draw polygon. Double-click or click start point to complete (Esc to cancel)</span>
            </div>
          )}
        </div>

        {/* Right Side: Floating Status Pill */}
        <div className="pointer-events-auto flex items-center gap-3 px-3 py-1.5 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-lg shadow-xl text-xs ml-auto">
          <div className="flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 text-rose-500 animate-pulse" />
            <span className="text-slate-300">
              Harmonized: <strong className="text-white font-mono">{safeClusters.length}</strong>
            </span>
          </div>
          <div className="h-3 w-px bg-slate-800" />
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-slate-300">
              Cross-Validated:{' '}
              <strong className="text-emerald-400 font-mono">
                {safeClusters.filter((c) => Boolean(c.cross_validated)).length}
              </strong>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
