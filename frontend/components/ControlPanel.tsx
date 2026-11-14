'use client';

import React, { useState } from 'react';
import { BoundingBox, PresetRegion } from '@/types/fire';
import { PRESET_REGIONS, HarmonizeParams, normalizeBoundingBox } from '@/utils/api';
import {
  Compass,
  Sliders,
  Layers,
  Download,
  Flame,
  RotateCcw,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Calendar,
} from 'lucide-react';

interface ControlPanelProps {
  bbox: BoundingBox;
  onBboxChange: (bbox: BoundingBox) => void;
  onHarmonize: (params?: Partial<HarmonizeParams>) => void;
  dayRange: number;
  onDayRangeChange: (days: number) => void;
  onExportCsv: () => void;
  loading: boolean;
  exporting: boolean;
  showPerimeters: boolean;
  setShowPerimeters: (val: boolean) => void;
  showRawObservations: boolean;
  setShowRawObservations: (val: boolean) => void;
  showNoisePoints: boolean;
  setShowNoisePoints: (val: boolean) => void;
}

export default function ControlPanel({
  bbox,
  onBboxChange,
  onHarmonize,
  dayRange,
  onDayRangeChange,
  onExportCsv,
  loading,
  exporting,
  showPerimeters,
  setShowPerimeters,
  showRawObservations,
  setShowRawObservations,
  showNoisePoints,
  setShowNoisePoints,
}: ControlPanelProps) {
  // Advanced parameters accordion state
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Hyperparameters
  const [spatialBandwidth, setSpatialBandwidth] = useState(2.5);
  const [temporalBandwidth, setTemporalBandwidth] = useState(6.0);
  const [minClusterSize, setMinClusterSize] = useState(2);
  const [minConfidence, setMinConfidence] = useState(0);

  // Handle manual coordinate input changes
  const handleCoordChange = (field: keyof BoundingBox, value: string) => {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      onBboxChange({
        ...bbox,
        [field]: num,
      });
    }
  };

  // Select preset region
  const handleSelectPreset = (preset: PresetRegion) => {
    onBboxChange(preset.bbox);
  };

  const handleApplyHarmonize = () => {
    onHarmonize({
      bbox: normalizeBoundingBox(bbox),
      day_range: dayRange,
      spatial_bandwidth_km: spatialBandwidth,
      temporal_bandwidth_hours: temporalBandwidth,
      min_cluster_size: minClusterSize,
      min_confidence: minConfidence,
    });
  };

  return (
    <aside className="w-80 md:w-88 lg:w-96 bg-slate-950/95 border-r border-slate-800/80 flex flex-col h-full text-slate-200 z-20 select-none overflow-y-auto">
      <div className="p-4 space-y-5">
        {/* Section 1: Presets for Emergency Responders */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-400 uppercase tracking-wider">
            <div className="flex items-center gap-1.5">
              <Compass className="w-3.5 h-3.5 text-cyan-400" />
              <span>Response Sectors (AOI)</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {PRESET_REGIONS.map((region) => {
              const isSelected =
                Math.abs(bbox.min_lat - region.bbox.min_lat) < 0.1 &&
                Math.abs(bbox.max_lat - region.bbox.max_lat) < 0.1;

              return (
                <button
                  key={region.id}
                  onClick={() => handleSelectPreset(region)}
                  className={`text-left p-2 rounded-lg border text-xs transition-all ${
                    isSelected
                      ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-300 font-medium shadow-glow-cyan/20'
                      : 'bg-slate-900/80 hover:bg-slate-850 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="font-semibold truncate">{region.name}</div>
                  <div className="text-[10px] text-slate-500 truncate">{region.description}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Section 2: Coordinates Bounding Box Input */}
        <div className="space-y-2 p-3 bg-slate-900/60 rounded-xl border border-slate-800/80">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
            <span>Bounding Box (EPSG:4326)</span>
            <span className="text-[10px] font-mono text-cyan-400">WGS84</span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <label className="text-[10px] text-slate-400 block mb-0.5">West (Min Lon)</label>
              <input
                type="number"
                step="0.05"
                value={bbox.min_lon}
                onChange={(e) => handleCoordChange('min_lon', e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700/80 rounded-md font-mono text-slate-100 focus:outline-none focus:border-cyan-500 transition"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-0.5">East (Max Lon)</label>
              <input
                type="number"
                step="0.05"
                value={bbox.max_lon}
                onChange={(e) => handleCoordChange('max_lon', e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700/80 rounded-md font-mono text-slate-100 focus:outline-none focus:border-cyan-500 transition"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-0.5">South (Min Lat)</label>
              <input
                type="number"
                step="0.05"
                value={bbox.min_lat}
                onChange={(e) => handleCoordChange('min_lat', e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700/80 rounded-md font-mono text-slate-100 focus:outline-none focus:border-cyan-500 transition"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-0.5">North (Max Lat)</label>
              <input
                type="number"
                step="0.05"
                value={bbox.max_lat}
                onChange={(e) => handleCoordChange('max_lat', e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700/80 rounded-md font-mono text-slate-100 focus:outline-none focus:border-cyan-500 transition"
              />
            </div>
          </div>
        </div>

        {/* Section 2b: NASA FIRMS Lookback Window (1-10 days) */}
        <div className="space-y-2 p-3 bg-slate-900/60 rounded-xl border border-slate-800/80">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-amber-400" />
              <span>FIRMS Lookback Window</span>
            </div>
            <span className="font-mono text-amber-400 font-bold">{dayRange} {dayRange === 1 ? 'day' : 'days'}</span>
          </div>

          <input
            type="range"
            min="1"
            max="10"
            step="1"
            value={dayRange}
            onChange={(e) => onDayRangeChange(parseInt(e.target.value, 10))}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
          />

          <div className="flex justify-between text-[10px] text-slate-500">
            <span>1 day (NRT)</span>
            <span>3 days (Default)</span>
            <span>7 days</span>
            <span>10 days (Max)</span>
          </div>

          <div className="grid grid-cols-4 gap-1 pt-1">
            {[1, 3, 7, 10].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => onDayRangeChange(d)}
                className={`py-1 rounded text-[10px] font-semibold border transition ${
                  dayRange === d
                    ? 'bg-amber-500/20 border-amber-500/60 text-amber-300 shadow-glow-amber/20'
                    : 'bg-slate-950/60 hover:bg-slate-800 border-slate-800 text-slate-400'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {/* Section 3: Spatio-Temporal Hyperparameter Sliders */}
        <div className="space-y-3 p-3 bg-slate-900/60 rounded-xl border border-slate-800/80">
          <div
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center justify-between text-xs font-semibold text-slate-300 cursor-pointer hover:text-white transition"
          >
            <div className="flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-purple-400" />
              <span>Harmonization Hyperparameters</span>
            </div>
            {showAdvanced ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </div>

          {/* Core Slider: Spatial Bandwidth (km) */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Spatial Proximity (S):</span>
              <span className="font-mono text-cyan-400 font-semibold">{spatialBandwidth.toFixed(1)} km</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="8.0"
              step="0.25"
              value={spatialBandwidth}
              onChange={(e) => setSpatialBandwidth(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
            />
            <div className="flex justify-between text-[10px] text-slate-500">
              <span>0.5 km (Strict)</span>
              <span>2.5 km (MODIS Grid)</span>
              <span>8.0 km (Broad)</span>
            </div>
          </div>

          {showAdvanced && (
            <div className="space-y-3 pt-2 border-t border-slate-800">
              {/* Temporal Window (Hours) */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Temporal Window (T):</span>
                  <span className="font-mono text-purple-400 font-semibold">{temporalBandwidth.toFixed(1)} hrs</span>
                </div>
                <input
                  type="range"
                  min="1.0"
                  max="24.0"
                  step="0.5"
                  value={temporalBandwidth}
                  onChange={(e) => setTemporalBandwidth(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                />
              </div>

              {/* Min Cluster Size */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Min Cluster Detections:</span>
                  <span className="font-mono text-emerald-400 font-semibold">{minClusterSize}</span>
                </div>
                <input
                  type="range"
                  min="2"
                  max="8"
                  step="1"
                  value={minClusterSize}
                  onChange={(e) => setMinClusterSize(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
              </div>

              {/* Min Confidence Threshold */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Min Confidence Filter:</span>
                  <span className="font-mono text-amber-400 font-semibold">{minConfidence}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="90"
                  step="5"
                  value={minConfidence}
                  onChange={(e) => setMinConfidence(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
              </div>
            </div>
          )}
        </div>

        {/* Section 4: Visual Layer Toggles */}
        <div className="space-y-2 p-3 bg-slate-900/60 rounded-xl border border-slate-800/80">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-2">
            <Layers className="w-3.5 h-3.5 text-amber-400" />
            <span>Map Visual Layers</span>
          </div>

          <div className="space-y-2 text-xs">
            <label className="flex items-center justify-between cursor-pointer group">
              <span className="text-slate-300 group-hover:text-white">Convex Hull Perimeters</span>
              <input
                type="checkbox"
                checked={showPerimeters}
                onChange={(e) => setShowPerimeters(e.target.checked)}
                className="w-4 h-4 rounded border-slate-700 bg-slate-800 text-rose-500 focus:ring-0 cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer group">
              <span className="text-slate-300 group-hover:text-white">
                Multi-Sensor Sub-pixels (MODIS / VIIRS)
              </span>
              <input
                type="checkbox"
                checked={showRawObservations}
                onChange={(e) => setShowRawObservations(e.target.checked)}
                className="w-4 h-4 rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-0 cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer group">
              <span className="text-slate-300 group-hover:text-white">Filtered Noise / Glints</span>
              <input
                type="checkbox"
                checked={showNoisePoints}
                onChange={(e) => setShowNoisePoints(e.target.checked)}
                className="w-4 h-4 rounded border-slate-700 bg-slate-800 text-slate-400 focus:ring-0 cursor-pointer"
              />
            </label>
          </div>
        </div>

        {/* Section 5: Primary Action Buttons */}
        <div className="space-y-2 pt-2">
          <button
            onClick={handleApplyHarmonize}
            disabled={loading}
            className={`w-full py-2.5 px-4 rounded-xl font-semibold text-xs tracking-wider uppercase transition-all flex items-center justify-center gap-2 shadow-lg ${
              loading
                ? 'bg-rose-950/60 text-rose-300 border border-rose-500/30 cursor-not-allowed'
                : 'bg-gradient-to-r from-rose-600 to-orange-600 hover:from-rose-500 hover:to-orange-500 text-white shadow-glow-danger border border-rose-500/50'
            }`}
          >
            {loading ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-rose-400/40 border-t-rose-200 rounded-full animate-spin" />
                <span>Running Spatio-Temporal HDBSCAN...</span>
              </>
            ) : (
              <>
                <Flame className="w-4 h-4 animate-pulse text-white" />
                <span>Harmonize Area of Interest</span>
              </>
            )}
          </button>

          <button
            onClick={onExportCsv}
            disabled={exporting || loading}
            className="w-full py-2 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700/80 hover:border-slate-600 text-slate-200 hover:text-white text-xs font-semibold transition flex items-center justify-center gap-2 shadow"
            title="Download full harmonized dataset formatted for GIS / QGIS / Google Earth Engine"
          >
            {exporting ? (
              <>
                <div className="w-3 h-3 border-2 border-slate-400/40 border-t-slate-200 rounded-full animate-spin" />
                <span>Preparing CSV Stream...</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5 text-cyan-400" />
                <span>Export Harmonized Events (CSV)</span>
              </>
            )}
          </button>
        </div>
      </div>
    </aside>
  );
}

