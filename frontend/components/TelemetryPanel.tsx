'use client';

import React from 'react';
import { HarmonizedCluster, HarmonizationSummary } from '@/types/fire';
import {
  Flame,
  Activity,
  Layers,
  ShieldCheck,
  Zap,
  Clock,
  MapPin,
  ChevronRight,
  TrendingUp,
} from 'lucide-react';

interface TelemetryPanelProps {
  summary: HarmonizationSummary | null;
  clusters: HarmonizedCluster[];
  selectedClusterId: number | null;
  onSelectCluster: (cluster: HarmonizedCluster) => void;
  loading: boolean;
}

export default function TelemetryPanel({
  summary,
  clusters,
  selectedClusterId,
  onSelectCluster,
  loading,
}: TelemetryPanelProps) {
  // Derive active live metrics from summary or calculated directly from cluster collection
  const totalHarmonizedEvents = summary?.total_clusters ?? clusters.length;
  const totalDetections =
    summary?.total_observations ??
    clusters.reduce((acc, c) => acc + c.total_detections, 0);
  const crossValidatedCount =
    summary?.cross_validated_clusters ??
    clusters.filter((c) => c.cross_validated).length;
  const crossValRate =
    summary?.cross_validation_rate !== undefined
      ? (summary.cross_validation_rate * 100).toFixed(0)
      : clusters.length > 0
        ? ((crossValidatedCount / clusters.length) * 100).toFixed(0)
        : '0';
  const totalEnergy =
    summary?.total_harmonized_frp_mw !== undefined
      ? summary.total_harmonized_frp_mw
      : clusters.reduce((acc, c) => acc + c.total_frp, 0);
  const compressionRatio =
    summary?.spatial_compression_ratio !== undefined
      ? summary.spatial_compression_ratio
      : totalHarmonizedEvents > 0 && totalDetections > 0
        ? Number((totalDetections / totalHarmonizedEvents).toFixed(2))
        : 1.0;
  const executionTime = summary?.execution_time_ms
    ? `${summary.execution_time_ms.toFixed(0)}ms`
    : 'live';

  const getSeverityBadge = (frp: number) => {
    if (frp >= 200) {
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/40">
          EXTREME ({frp.toFixed(0)} MW)
        </span>
      );
    }
    if (frp >= 80) {
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-500/20 text-orange-400 border border-orange-500/40">
          HIGH ({frp.toFixed(0)} MW)
        </span>
      );
    }
    if (frp >= 30) {
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40">
          MODERATE ({frp.toFixed(0)} MW)
        </span>
      );
    }
    return (
      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-yellow-500/20 text-yellow-400 border border-yellow-500/40">
        LOW ({frp.toFixed(0)} MW)
      </span>
    );
  };

  return (
    <section className="w-84 md:w-92 lg:w-96 bg-slate-950/95 border-l border-slate-800/80 flex flex-col h-full text-slate-200 z-20 select-none overflow-hidden">
      {/* Header */}
      <div className="p-3.5 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-rose-500 animate-pulse" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-white">
            Incident Telemetry Feed
          </h2>
        </div>
        <span className="text-[11px] font-mono text-cyan-400 font-semibold">
          {totalHarmonizedEvents} active complexes
        </span>
      </div>

      {/* Summary KPI Grid */}
      <div className="p-3 grid grid-cols-2 gap-2 border-b border-slate-800/80 bg-slate-900/40">
        {/* KPI 1: Harmonized Clusters */}
        <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-[10px] mb-1">
            <span>Harmonized Events</span>
            <Flame className="w-3.5 h-3.5 text-rose-400" />
          </div>
          <div className="text-lg font-bold font-mono text-white">
            {totalHarmonizedEvents.toLocaleString()}
          </div>
          <div className="text-[10px] text-slate-400 truncate">
            from <strong className="text-slate-200">{totalDetections.toLocaleString()}</strong> raw detections
          </div>
        </div>

        {/* KPI 2: Spatial Compression Ratio */}
        <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-[10px] mb-1">
            <span>Resolution De-bias</span>
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="text-lg font-bold font-mono text-cyan-400">
            {compressionRatio}x
          </div>
          <div className="text-[10px] text-slate-400 truncate">
            sensor footprint unified
          </div>
        </div>

        {/* KPI 3: Cross Validation Rate */}
        <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-[10px] mb-1">
            <span>Cross-Validated</span>
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-lg font-bold font-mono text-emerald-400">
            {crossValRate}%
          </div>
          <div className="text-[10px] text-slate-400 truncate">
            <strong className="text-emerald-300">{crossValidatedCount}</strong> multi-sensor events
          </div>
        </div>

        {/* KPI 4: Total FRP Energy */}
        <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-[10px] mb-1">
            <span>Cumulative Energy</span>
            <Zap className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="text-lg font-bold font-mono text-amber-400">
            {Math.round(totalEnergy).toLocaleString()} MW
          </div>
          <div className="text-[10px] text-slate-400 truncate">
            in <strong className="text-slate-300">{executionTime}</strong> runtime
          </div>
        </div>
      </div>

      {/* Cluster Incident Scrollable Feed */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-3">
            <div className="w-6 h-6 border-2 border-rose-500/30 border-t-rose-500 rounded-full animate-spin" />
            <div className="text-xs font-mono">CALCULATING SPATIO-TEMPORAL DENSITY...</div>
          </div>
        ) : clusters.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-slate-500 gap-2 px-4">
            <Flame className="w-8 h-8 opacity-20 text-rose-500" />
            <div className="text-xs font-semibold text-slate-400">No active fire events in AOI</div>
            <div className="text-[11px] text-slate-600">
              Draw a larger bounding box on the map or select a preset sector from the left control panel.
            </div>
          </div>
        ) : (
          clusters.map((cluster) => {
            const isSelected = selectedClusterId === cluster.cluster_id;

            return (
              <div
                key={cluster.cluster_id}
                onClick={() => onSelectCluster(cluster)}
                className={`p-3 rounded-xl border text-xs cursor-pointer transition-all ${isSelected
                  ? 'bg-slate-900 border-rose-500/70 shadow-glow-danger/20 ring-1 ring-rose-500/40'
                  : 'bg-slate-900/70 hover:bg-slate-900 border-slate-800 hover:border-slate-700'
                  }`}
              >
                {/* Top line: Event ID + Severity */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 font-bold text-white tracking-wide">
                    <span>Complex #{cluster.cluster_id}</span>
                    {cluster.cross_validated && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-glow-success" title="Verified by both MODIS and VIIRS" />
                    )}
                  </div>
                  {getSeverityBadge(cluster.total_frp)}
                </div>

                {/* Middle line: Sensor Breakdown & Area */}
                <div className="grid grid-cols-2 gap-2 text-[11px] mb-2 text-slate-400 font-mono">
                  <div className="flex items-center gap-1">
                    <span className="text-purple-400">{cluster.modis_count}M</span>
                    <span>+</span>
                    <span className="text-cyan-400">{cluster.viirs_count}V</span>
                    <span className="text-slate-500">({cluster.total_detections})</span>
                  </div>
                  <div className="text-right text-slate-300">
                    {cluster.estimated_area_km2.toFixed(2)} km²
                  </div>
                </div>

                {/* Bottom line: Coordinates & Duration */}
                <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1.5 border-t border-slate-800/80">
                  <div className="flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-slate-400" />
                    <span>
                      {cluster.weighted_centroid_lat.toFixed(3)}°, {cluster.weighted_centroid_lon.toFixed(3)}°
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-slate-400">
                    <Clock className="w-3 h-3 text-slate-500" />
                    <span>{cluster.duration_hours.toFixed(1)}h</span>
                    <ChevronRight className="w-3 h-3 text-slate-600" />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

