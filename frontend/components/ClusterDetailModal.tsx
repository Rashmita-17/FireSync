'use client';

import React from 'react';
import { HarmonizedCluster } from '@/types/fire';
import {
  X,
  Flame,
  ShieldCheck,
  ShieldAlert,
  Satellite,
  Clock,
  Layers,
  MapPin,
  Activity,
  Zap,
} from 'lucide-react';

interface ClusterDetailModalProps {
  cluster: HarmonizedCluster | null;
  onClose: () => void;
}

export default function ClusterDetailModal({ cluster, onClose }: ClusterDetailModalProps) {
  if (!cluster) return null;

  const formatUtc = (isoStr: string) => {
    try {
      const d = new Date(isoStr);
      return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)} UTC`;
    } catch {
      return isoStr;
    }
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-2xl max-h-[90vh] shadow-2xl flex flex-col overflow-hidden text-slate-200">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-rose-500/15 border border-rose-500/40 flex items-center justify-center text-rose-500 shadow-glow-danger">
              <Flame className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white tracking-wide">
                  Wildfire Complex #{cluster.cluster_id}
                </h3>
                {cluster.cross_validated ? (
                  <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" />
                    <span>M+V Multi-Sensor Verified</span>
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/40 flex items-center gap-1">
                    <ShieldAlert className="w-3 h-3" />
                    <span>Single Constellation</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 font-mono">
                Centroid: {cluster.weighted_centroid_lat.toFixed(5)}° N, {cluster.weighted_centroid_lon.toFixed(5)}° W
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {/* Key Intelligence Metrics */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 bg-slate-950/70 rounded-xl border border-slate-800">
              <div className="text-[11px] text-slate-400 flex items-center gap-1 mb-1">
                <Zap className="w-3.5 h-3.5 text-rose-400" />
                <span>Integrated FRP</span>
              </div>
              <div className="text-xl font-bold font-mono text-rose-400">
                {cluster.total_frp.toFixed(1)} <span className="text-xs font-normal">MW</span>
              </div>
              <div className="text-[10px] text-slate-500">
                Peak: {cluster.peak_frp.toFixed(1)} MW | Mean: {cluster.mean_frp.toFixed(1)} MW
              </div>
            </div>

            <div className="p-3 bg-slate-950/70 rounded-xl border border-slate-800">
              <div className="text-[11px] text-slate-400 flex items-center gap-1 mb-1">
                <Layers className="w-3.5 h-3.5 text-cyan-400" />
                <span>Physical Footprint</span>
              </div>
              <div className="text-xl font-bold font-mono text-cyan-400">
                {cluster.estimated_area_km2.toFixed(2)} <span className="text-xs font-normal">km²</span>
              </div>
              <div className="text-[10px] text-slate-500">
                Resolving 1km vs 375m pixels
              </div>
            </div>

            <div className="p-3 bg-slate-950/70 rounded-xl border border-slate-800">
              <div className="text-[11px] text-slate-400 flex items-center gap-1 mb-1">
                <Activity className="w-3.5 h-3.5 text-emerald-400" />
                <span>Harmonized Confidence</span>
              </div>
              <div className="text-xl font-bold font-mono text-emerald-400">
                {cluster.harmonized_confidence.toFixed(1)}%
              </div>
              <div className="text-[10px] text-slate-500">
                {cluster.cross_validated ? '+15% Multi-sensor bonus' : 'Baseline score'}
              </div>
            </div>
          </div>

          {/* Sensor De-biasing Synthesis Breakdown */}
          <div className="p-4 bg-slate-950/50 rounded-xl border border-slate-800 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <Satellite className="w-4 h-4 text-purple-400" />
              <span>Multi-Sensor Synthesis & Resolution Resolution</span>
            </h4>

            <div className="grid grid-cols-2 gap-4 text-xs font-mono">
              <div className="p-3 rounded-lg bg-purple-950/20 border border-purple-500/30">
                <div className="text-purple-300 font-bold mb-1">MODIS (1,000m Footprint)</div>
                <div className="text-slate-300 text-sm">{cluster.modis_count} raw detections</div>
                <div className="text-[11px] text-slate-500 mt-1">Coarse active fire pixel baseline</div>
              </div>

              <div className="p-3 rounded-lg bg-cyan-950/20 border border-cyan-500/30">
                <div className="text-cyan-300 font-bold mb-1">VIIRS (375m Footprint)</div>
                <div className="text-slate-300 text-sm">{cluster.viirs_count} sub-pixel detections</div>
                <div className="text-[11px] text-slate-500 mt-1">
                  Fragmented ratio: {(cluster.viirs_count / Math.max(1, cluster.modis_count)).toFixed(1)}:1
                </div>
              </div>
            </div>

            <div className="text-[11px] text-slate-400 leading-relaxed bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
              💡 <strong>Harmonization Impact:</strong> Without spatio-temporal clustering, VIIRS would report{' '}
              <strong className="text-cyan-300">{cluster.viirs_count} separate fires</strong>. The HDBSCAN engine successfully grouped all{' '}
              <strong className="text-white">{cluster.total_detections} coincident satellite detections</strong> into this single unified fire complex.
            </div>
          </div>

          {/* Temporal Boundaries */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 bg-slate-950/70 rounded-xl border border-slate-800">
              <div className="text-[10px] text-slate-400 mb-1 flex items-center gap-1">
                <Clock className="w-3 h-3 text-slate-500" />
                <span>First Overpass Detection</span>
              </div>
              <div className="font-mono text-slate-200">{formatUtc(cluster.first_detected)}</div>
            </div>

            <div className="p-3 bg-slate-950/70 rounded-xl border border-slate-800">
              <div className="text-[10px] text-slate-400 mb-1 flex items-center gap-1">
                <Clock className="w-3 h-3 text-slate-500" />
                <span>Latest Overpass Detection</span>
              </div>
              <div className="font-mono text-slate-200">{formatUtc(cluster.last_detected)}</div>
              <div className="text-[10px] text-cyan-400 mt-0.5">Duration: {cluster.duration_hours.toFixed(1)} hours</div>
            </div>
          </div>

          {/* Member Satellite Detections List */}
          {cluster.observations && cluster.observations.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Member Satellite Detections ({cluster.observations.length})
              </h4>
              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                {cluster.observations.map((obs) => {
                  const isModis = obs.instrument.toUpperCase().includes('MODIS');
                  return (
                    <div
                      key={obs.id}
                      className="p-2 bg-slate-950/60 rounded-lg border border-slate-800 flex items-center justify-between text-[11px] font-mono"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            isModis
                              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                              : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                          }`}
                        >
                          {obs.instrument}
                        </span>
                        <span className="text-slate-300">{obs.satellite}</span>
                        <span className="text-slate-500">
                          {obs.latitude.toFixed(4)}°, {obs.longitude.toFixed(4)}°
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-rose-400 font-semibold">{obs.frp} MW</span>
                        <span className="text-emerald-400 font-semibold">{obs.confidence}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-950/60 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition"
          >
            Close Incident Intel
          </button>
        </div>
      </div>
    </div>
  );
}

