'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { BoundingBox, HarmonizedCluster, RawObservation } from '@/types/fire';
import { normalizeBoundingBox, wrapLongitude } from '@/utils/api';
import { Layers, Maximize2, Crosshair, AlertTriangle, Flame, Radio } from 'lucide-react';

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
  // Normalize layout visibility properties
  const isSubPixelsVisible = showSubPixels !== undefined ? showSubPixels : showRawObservations;
  const isPerimetersVisible = showPerimeters;
  const isNoiseVisible = showNoisePoints;
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const bboxRectangleRef = useRef<L.Rectangle | null>(null);
  const clustersLayerRef = useRef<L.LayerGroup | null>(null);
  const perimetersLayerRef = useRef<L.LayerGroup | null>(null);
  const rawObsLayerRef = useRef<L.LayerGroup | null>(null);
  const noiseLayerRef = useRef<L.LayerGroup | null>(null);

  const [isDrawing, setIsDrawing] = useState(false);
  const drawStartLatLngRef = useRef<L.LatLng | null>(null);
  const drawTempRectRef = useRef<L.Rectangle | null>(null);
  const [mapTileTheme, setMapTileTheme] = useState<'dark' | 'satellite' | 'streets'>('dark');
  const tileLayerGroupRef = useRef<L.LayerGroup | null>(null);

  // Mapbox token check (if present, use high-resolution Mapbox tiles; otherwise use 100% free ESRI/OSM with zero watermarks)
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim();

  // Helper: Factory for pristine, watermark-free basemap tile layers
  const createBasemapLayerGroup = useCallback(
    (theme: 'dark' | 'satellite' | 'streets'): L.LayerGroup => {
      const group = L.layerGroup();
      const hasMapbox = Boolean(mapboxToken && mapboxToken.startsWith('pk.'));

      if (theme === 'dark') {
        if (hasMapbox) {
          // Mapbox Dark v11 (High-resolution rasterized vector tiles)
          const mbDark = L.tileLayer(
            `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/{z}/{x}/{y}?access_token=${mapboxToken}`,
            {
              tileSize: 512,
              zoomOffset: -1,
              maxZoom: 19,
              attribution: '© Mapbox © OpenStreetMap',
            }
          );
          group.addLayer(mbDark);
        } else {
          // ESRI World Dark Gray Canvas: 100% Free, NO API key required, NO watermark
          const esriDark = L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
            {
              maxZoom: 16,
              attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
            }
          );
          const esriLabels = L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
            {
              maxZoom: 16,
            }
          );
          group.addLayer(esriDark);
          group.addLayer(esriLabels);
        }
      } else if (theme === 'satellite') {
        if (hasMapbox) {
          // Mapbox Satellite Streets
          const mbSat = L.tileLayer(
            `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/{z}/{x}/{y}?access_token=${mapboxToken}`,
            {
              tileSize: 512,
              zoomOffset: -1,
              maxZoom: 19,
              attribution: '© Mapbox © Maxar',
            }
          );
          group.addLayer(mbSat);
        } else {
          // ESRI World Imagery: 100% Free, NO API key required, NO watermark
          const esriSat = L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            {
              maxZoom: 18,
              attribution:
                'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
            }
          );
          group.addLayer(esriSat);
        }
      } else {
        // Standard OpenStreetMap: 100% Free, NO API key required
        const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap contributors',
        });
        group.addLayer(osm);
      }

      return group;
    },
    [mapboxToken]
  );

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

  // 1. Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const initialCenter: [number, number] = [
      (bbox.min_lat + bbox.max_lat) / 2,
      (bbox.min_lon + bbox.max_lon) / 2,
    ];

    const map = L.map(mapContainerRef.current, {
      center: initialCenter,
      zoom: 7,
      zoomControl: false,
      attributionControl: false,
    });

    // Mount initial basemap layer group
    const initialTiles = createBasemapLayerGroup(mapTileTheme);
    initialTiles.addTo(map);
    tileLayerGroupRef.current = initialTiles;

    // Tactical Zoom Control top-right
    L.control.zoom({ position: 'topright' }).addTo(map);

    // Attribution bottom-right
    L.control.attribution({ position: 'bottomright', prefix: 'NASA FIRMS / MODIS & VIIRS' }).addTo(map);

    // Initialize layer groups
    clustersLayerRef.current = L.layerGroup().addTo(map);
    perimetersLayerRef.current = L.layerGroup().addTo(map);
    rawObsLayerRef.current = L.layerGroup().addTo(map);
    noiseLayerRef.current = L.layerGroup().addTo(map);

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // 2. Tile layer theme switch
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (tileLayerGroupRef.current) {
      map.removeLayer(tileLayerGroupRef.current);
    }

    const newGroup = createBasemapLayerGroup(mapTileTheme);
    newGroup.addTo(map);
    tileLayerGroupRef.current = newGroup;
  }, [mapTileTheme, createBasemapLayerGroup]);

  // 3. Render Query Bounding Box Rectangle
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (bboxRectangleRef.current) {
      map.removeLayer(bboxRectangleRef.current);
    }

    const bounds: L.LatLngBoundsExpression = [
      [bbox.min_lat, bbox.min_lon],
      [bbox.max_lat, bbox.max_lon],
    ];

    const rect = L.rectangle(bounds, {
      color: '#06B6D4', // Tactical Cyan
      weight: 1.5,
      dashArray: '6, 6',
      fillOpacity: 0.04,
      fillColor: '#06B6D4',
      interactive: false,
    }).addTo(map);

    bboxRectangleRef.current = rect;
  }, [bbox]);

  // 4. Render Harmonized Clusters & Perimeters
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    let clustersGroup = clustersLayerRef.current;
    if (!clustersGroup) {
      clustersGroup = L.layerGroup().addTo(map);
      clustersLayerRef.current = clustersGroup;
    } else if (!map.hasLayer(clustersGroup)) {
      clustersGroup.addTo(map);
    }

    let perimetersGroup = perimetersLayerRef.current;
    if (!perimetersGroup) {
      perimetersGroup = L.layerGroup().addTo(map);
      perimetersLayerRef.current = perimetersGroup;
    } else if (!map.hasLayer(perimetersGroup)) {
      perimetersGroup.addTo(map);
    }

    clustersGroup.clearLayers();
    perimetersGroup.clearLayers();

    clusters.forEach((cluster) => {
      const isSelected = selectedClusterId === cluster.cluster_id;
      const frpColor = getFrpColor(cluster.total_frp);

      // Render Convex Hull / Footprint Perimeter if layout visibility is 'visible'
      if (isPerimetersVisible) {
        if (cluster.geojson_geometry && cluster.geojson_geometry.type === 'Polygon') {
          const polyCoords = cluster.geojson_geometry.coordinates[0].map(
            (pt: [number, number]) => [pt[1], pt[0]] as [number, number]
          );

          const polygon = L.polygon(polyCoords, {
            color: frpColor,
            weight: isSelected ? 3 : 1.5,
            opacity: 0.85,
            fillColor: frpColor,
            fillOpacity: isSelected ? 0.35 : 0.18,
            dashArray: isSelected ? undefined : '4, 4',
          });

          polygon.on('click', () => onSelectCluster(cluster));
          perimetersGroup.addLayer(polygon);
        } else {
          // Point / localized cluster perimeter footprint
          const radiusMeters = Math.max(375, Math.sqrt((cluster.estimated_area_km2 || 1.0) / Math.PI) * 1000);
          const circle = L.circle([cluster.centroid_lat, cluster.centroid_lon], {
            radius: radiusMeters,
            color: frpColor,
            weight: isSelected ? 3 : 1.5,
            opacity: 0.85,
            fillColor: frpColor,
            fillOpacity: isSelected ? 0.35 : 0.18,
            dashArray: isSelected ? undefined : '4, 4',
          });
          circle.on('click', () => onSelectCluster(cluster));
          perimetersGroup.addLayer(circle);
        }
      }

      // Render Tactical FRP Beacon Marker (DivIcon)
      const size = Math.min(46, Math.max(26, Math.round(Math.sqrt(cluster.total_frp) * 2.2)));
      const pulseSize = size + 16;

      const markerHtml = `
        <div class="relative flex items-center justify-center cursor-pointer group" style="width: ${pulseSize}px; height: ${pulseSize}px;">
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

      const customIcon = L.divIcon({
        html: markerHtml,
        className: 'custom-fire-marker',
        iconSize: [pulseSize, pulseSize],
        iconAnchor: [pulseSize / 2, pulseSize / 2],
      });

      const markerLat = cluster.weighted_centroid_lat ?? cluster.centroid_lat;
      const markerLon = cluster.weighted_centroid_lon ?? cluster.centroid_lon;

      const marker = L.marker([markerLat, markerLon], {
        icon: customIcon,
      });

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

      marker.bindPopup(popupContent, {
        className: 'tactical-leaflet-popup',
        offset: [0, -10],
      });

      marker.on('click', () => onSelectCluster(cluster));
      clustersGroup.addLayer(marker);
    });
  }, [clusters, selectedClusterId, isPerimetersVisible, onSelectCluster]);

  // 5. Render Raw Observations (MODIS vs VIIRS sub-pixels)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    let rawObsGroup = rawObsLayerRef.current;
    if (!rawObsGroup) {
      rawObsGroup = L.layerGroup().addTo(map);
      rawObsLayerRef.current = rawObsGroup;
    } else if (!map.hasLayer(rawObsGroup)) {
      rawObsGroup.addTo(map);
    }

    rawObsGroup.clearLayers();
    if (!isSubPixelsVisible) return;

    clusters.forEach((cluster) => {
      const observations = cluster.observations && cluster.observations.length > 0
        ? cluster.observations
        : [
          {
            id: cluster.cluster_id,
            latitude: cluster.weighted_centroid_lat,
            longitude: cluster.weighted_centroid_lon,
            acq_datetime: cluster.first_detected,
            instrument: cluster.cross_validated ? 'MODIS+VIIRS' : (cluster.viirs_count > 0 ? 'VIIRS' : 'MODIS'),
            satellite: cluster.cross_validated ? 'Multi-Sensor' : (cluster.viirs_count > 0 ? 'NOAA-20' : 'Aqua/Terra'),
            confidence: cluster.harmonized_confidence,
            confidence_raw: 'high',
            frp: cluster.total_frp,
            brightness: null,
            scan: 0.375,
            track: 0.375,
            daynight: 'D',
            source_file: null,
            created_at: cluster.first_detected,
          }
        ];

      observations.forEach((obs) => {
        const isModis = obs.instrument.toUpperCase().includes('MODIS');
        const color = isModis ? '#C084FC' : '#06B6D4'; // Purple for MODIS, Cyan for VIIRS
        const radius = isModis ? 6 : 4;

        const circle = L.circleMarker([obs.latitude, obs.longitude], {
          radius,
          color: isModis ? '#E9D5FF' : '#67E8F9',
          fillColor: color,
          fillOpacity: 0.85,
          weight: 1.5,
        });

        circle.bindTooltip(
          `<strong>${obs.instrument}</strong> (${obs.satellite})<br/>FRP: ${obs.frp} MW | Conf: ${obs.confidence}%`,
          { className: 'text-[11px] bg-slate-900 text-white border-slate-700' }
        );

        rawObsGroup.addLayer(circle);
      });
    });

    rawObsGroup.eachLayer((layer: any) => {
      if (layer.bringToFront) layer.bringToFront();
    });
  }, [clusters, isSubPixelsVisible]);

  // 6. Render Noise Points (Isolated False Alarms / Solar Glints)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    let noiseGroup = noiseLayerRef.current;
    if (!noiseGroup) {
      noiseGroup = L.layerGroup().addTo(map);
      noiseLayerRef.current = noiseGroup;
    } else if (!map.hasLayer(noiseGroup)) {
      noiseGroup.addTo(map);
    }

    noiseGroup.clearLayers();
    if (!isNoiseVisible || !noisePoints.length) return;

    noisePoints.forEach((obs) => {
      const circle = L.circleMarker([obs.latitude, obs.longitude], {
        radius: 4,
        color: '#94A3B8',
        fillColor: '#64748B',
        fillOpacity: 0.6,
        weight: 1.5,
        dashArray: '2, 2',
      });

      circle.bindTooltip(
        `<strong>Noise / Isolated singleton</strong><br/>${obs.instrument} (${obs.satellite})<br/>FRP: ${obs.frp} MW`,
        { className: 'text-[11px] bg-slate-900 text-slate-300 border-slate-700' }
      );

      noiseGroup.addLayer(circle);
    });

    noiseGroup.eachLayer((layer: any) => {
      if (layer.bringToFront) layer.bringToFront();
    });
  }, [noisePoints, isNoiseVisible]);

  // 7. Interactive Area of Interest (AOI) Bounding Box Drawing Mode
  const startDrawingMode = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    setIsDrawing(true);
    map.dragging.disable();
    map.getContainer().style.cursor = 'crosshair';

    const onMouseDown = (e: L.LeafletMouseEvent) => {
      drawStartLatLngRef.current = e.latlng;

      if (drawTempRectRef.current) {
        map.removeLayer(drawTempRectRef.current);
      }

      drawTempRectRef.current = L.rectangle(L.latLngBounds(e.latlng, e.latlng), {
        color: '#22D3EE',
        weight: 2,
        dashArray: '4, 4',
        fillColor: '#22D3EE',
        fillOpacity: 0.15,
      }).addTo(map);

      map.on('mousemove', onMouseMove);
      map.on('mouseup', onMouseUp);
    };

    const onMouseMove = (e: L.LeafletMouseEvent) => {
      if (!drawStartLatLngRef.current || !drawTempRectRef.current) return;
      drawTempRectRef.current.setBounds(L.latLngBounds(drawStartLatLngRef.current, e.latlng));
    };

    const onMouseUp = (e: L.LeafletMouseEvent) => {
      map.off('mousemove', onMouseMove);
      map.off('mouseup', onMouseUp);
      map.off('mousedown', onMouseDown);

      if (drawStartLatLngRef.current) {
        const bounds = L.latLngBounds(drawStartLatLngRef.current, e.latlng);
        const south = bounds.getSouth();
        const north = bounds.getNorth();
        const west = bounds.getWest();
        const east = bounds.getEast();

        // Ensure sensible bounding box dimensions (minimum ~500m)
        if (Math.abs(north - south) > 0.005 && Math.abs(east - west) > 0.005) {
          // Normalize coordinates and wrap longitudes into standard [-180, 180] range
          const rawBox: BoundingBox = {
            min_lat: south,
            max_lat: north,
            min_lon: west,
            max_lon: east,
          };
          onBoundsChange(normalizeBoundingBox(rawBox));
        }
      }

      if (drawTempRectRef.current) {
        map.removeLayer(drawTempRectRef.current);
        drawTempRectRef.current = null;
      }

      setIsDrawing(false);
      map.dragging.enable();
      map.getContainer().style.cursor = '';
    };

    map.once('mousedown', onMouseDown);
  }, [onBoundsChange]);

  // Fit map to current query bounding box
  const fitToQueryBounds = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    map.fitBounds([
      [bbox.min_lat, bbox.min_lon],
      [bbox.max_lat, bbox.max_lon],
    ], { padding: [30, 30] });
  }, [bbox]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-slate-950">
      {/* Map Container */}
      <div ref={mapContainerRef} className="w-full h-full z-0" />

      {/* Floating Tactical Overlay Controls (Unified Responsive Top Bar) */}
      <div className="absolute top-4 left-4 right-16 z-[1000] flex flex-wrap items-center justify-between gap-4 pointer-events-none">
        {/* Left Side: Drawing Tools & Basemap Switcher */}
        <div className="flex flex-wrap items-center gap-2 pointer-events-auto">
          <div className="flex items-center gap-1.5 p-1.5 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-lg shadow-2xl">
            <button
              onClick={startDrawingMode}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all ${isDrawing
                  ? 'bg-cyan-500 text-slate-950 shadow-glow-cyan font-semibold animate-pulse'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700'
                }`}
              title="Click and drag on map to define Area of Interest"
            >
              <Crosshair className="w-3.5 h-3.5" />
              <span>{isDrawing ? 'Drawing AOI (Drag on Map)...' : 'Draw AOI Box'}</span>
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

            {/* Map Layer Style Switcher */}
            <div className="flex bg-slate-800/80 p-0.5 rounded border border-slate-700/80 text-[11px]">
              <button
                onClick={() => setMapTileTheme('dark')}
                className={`px-2 py-1 rounded transition ${mapTileTheme === 'dark' ? 'bg-cyan-600 text-white font-medium shadow-sm' : 'text-slate-400 hover:text-white'
                  }`}
                title="Tactical Dark Map (Mapbox Dark or ESRI Dark Gray Base)"
              >
                Dark
              </button>
              <button
                onClick={() => setMapTileTheme('satellite')}
                className={`px-2 py-1 rounded transition ${mapTileTheme === 'satellite' ? 'bg-cyan-600 text-white font-medium shadow-sm' : 'text-slate-400 hover:text-white'
                  }`}
                title="High-Resolution Satellite Imagery (ESRI / Mapbox)"
              >
                Sat
              </button>
              <button
                onClick={() => setMapTileTheme('streets')}
                className={`px-2 py-1 rounded transition ${mapTileTheme === 'streets' ? 'bg-cyan-600 text-white font-medium shadow-sm' : 'text-slate-400 hover:text-white'
                  }`}
                title="OpenStreetMap Standard Vector Streets"
              >
                Street
              </button>
            </div>
          </div>

          {isDrawing && (
            <div className="px-3 py-1.5 bg-cyan-950/90 border border-cyan-500/50 rounded-lg text-xs text-cyan-200 backdrop-blur-md shadow-lg flex items-center gap-2">
              <Radio className="w-3.5 h-3.5 animate-pulse text-cyan-400" />
              <span>Drag to define AOI bounding box</span>
            </div>
          )}
        </div>

        {/* Right Side: Floating Status Pill (Separated, Never Overlapping Drawing Tools) */}
        <div className="pointer-events-auto flex items-center gap-3 px-3 py-1.5 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-lg shadow-xl text-xs ml-auto">
          <div className="flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 text-rose-500 animate-pulse" />
            <span className="text-slate-300">
              Harmonized: <strong className="text-white font-mono">{clusters.length}</strong>
            </span>
          </div>
          <div className="h-3 w-px bg-slate-800" />
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-slate-300">
              Cross-Validated:{' '}
              <strong className="text-emerald-400 font-mono">
                {clusters.filter((c) => c.cross_validated).length}
              </strong>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
