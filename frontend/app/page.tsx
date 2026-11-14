'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Header from '@/components/Header';
import ControlPanel from '@/components/ControlPanel';
import MapWrapper from '@/components/MapWrapper';
import TelemetryPanel from '@/components/TelemetryPanel';
import ClusterDetailModal from '@/components/ClusterDetailModal';
import Legend from '@/components/Legend';
import BurningActivityCalendar from '@/components/BurningCalendar';
import { BoundingBox, HarmonizedCluster, HarmonizationSummary, RawObservation } from '@/types/fire';
import {
  fetchHarmonizedData,
  downloadHarmonizedCsv,
  fetchHealthStatus,
  normalizeBoundingBox,
  HarmonizeParams,
  PRESET_REGIONS,
} from '@/utils/api';

export default function DisasterResponseDashboard() {
  // Navigation View State: 'map' | 'calendar'
  const [currentView, setCurrentView] = useState<'map' | 'calendar'>('map');

  // Primary Bounding Box state (Default: Sierra Nevada / Central California)
  const [bbox, setBbox] = useState<BoundingBox>(PRESET_REGIONS[0].bbox);

  // Harmonization data states
  const [clusters, setClusters] = useState<HarmonizedCluster[]>([]);
  const [summary, setSummary] = useState<HarmonizationSummary | null>(null);
  const [noisePoints, setNoisePoints] = useState<RawObservation[]>([]);

  // Selected cluster for deep incident inspection
  const [selectedCluster, setSelectedCluster] = useState<HarmonizedCluster | null>(null);

  // Layer toggles
  const [showPerimeters, setShowPerimeters] = useState(true);
  const [showRawObservations, setShowRawObservations] = useState(false);
  const [showNoisePoints, setShowNoisePoints] = useState(false);

  // Loading & operational states
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [backendHealthy, setBackendHealthy] = useState(true);
  const [totalDbRecords, setTotalDbRecords] = useState(0);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  // Tracks active in-flight harmonization to cancel superseded requests
  const activeHarmonizeAbortRef = useRef<AbortController | null>(null);

  // Harmonize function
  const executeHarmonization = useCallback(
    async (overrideParams?: Partial<HarmonizeParams>) => {
      // Abort any previous pending harmonization query
      if (activeHarmonizeAbortRef.current) {
        activeHarmonizeAbortRef.current.abort();
      }
      const controller = new AbortController();
      activeHarmonizeAbortRef.current = controller;

      setLoading(true);
      setErrorNotice(null);

      const targetBbox = overrideParams?.bbox ?? bbox;

      try {
        const queryParams: HarmonizeParams = {
          bbox: targetBbox,
          spatial_bandwidth_km: overrideParams?.spatial_bandwidth_km ?? 2.5,
          temporal_bandwidth_hours: overrideParams?.temporal_bandwidth_hours ?? 6.0,
          min_cluster_size: overrideParams?.min_cluster_size ?? 2,
          min_samples: overrideParams?.min_samples ?? 1,
          cluster_selection_epsilon: overrideParams?.cluster_selection_epsilon ?? 0.5,
          min_confidence: overrideParams?.min_confidence ?? 0.0,
          include_observations: true,
          include_noise: true,
          signal: controller.signal,
        };

        const result = await fetchHarmonizedData(queryParams);
        if (controller.signal.aborted) return;

        const safeClusters = Array.isArray(result?.clusters) ? result.clusters : [];
        setClusters([...safeClusters]);
        setSummary(
          result?.summary
            ? { ...result.summary }
            : {
                total_observations: 0,
                total_clusters: safeClusters.length,
                total_noise_points: 0,
                modis_detections: 0,
                viirs_detections: 0,
                cross_validated_clusters: 0,
                cross_validation_rate: 0,
                total_harmonized_frp_mw: 0,
                spatial_compression_ratio: 1.0,
                execution_time_ms: 0,
              }
        );
        setNoisePoints(Array.isArray(result?.noise_points) ? [...result.noise_points] : []);
      } catch (err: any) {
        // If superseded by a newer query or manually aborted, silently ignore
        if (controller.signal.aborted || err?.message?.includes('aborted')) {
          return;
        }

        console.error('[Dashboard Error] Failed to harmonize AOI bounding box:', {
          error: err,
          message: err.message,
          stack: err.stack,
          bbox,
        });
        // Gracefully render 0 active complexes without crashing or hanging
        setClusters([]);
        setSummary({
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
        });
        setNoisePoints([]);
        setErrorNotice(err.message || 'Failed to connect to FastAPI /api/harmonize endpoint');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    },
    [bbox]
  );

  // Trigger CSV export
  const handleExportCsv = async () => {
    setExporting(true);
    try {
      await downloadHarmonizedCsv({ bbox });
    } catch (err: any) {
      console.error('Export error:', err);
      setErrorNotice('CSV export failed. Ensure FastAPI backend is online.');
    } finally {
      setExporting(false);
    }
  };

  // When user draws an Area of Interest on map or types coordinates
  const handleBoundsChange = (newBbox: BoundingBox) => {
    setBbox(normalizeBoundingBox(newBbox));
  };

  // Re-run harmonization whenever bbox changes
  useEffect(() => {
    executeHarmonization();
  }, [bbox]);

  // Check backend health on mount and every 30 seconds
  useEffect(() => {
    const checkHealth = async () => {
      const health = await fetchHealthStatus();
      // Permissive: Any HTTP 200 / ok sets backend status to ONLINE
      setBackendHealthy(
        Boolean(
          health.ok ||
          health.status === 'online' ||
          health.status === 'healthy' ||
          health.status === 'empty_database'
        )
      );
      setTotalDbRecords(health.records || 0);
    };

    checkHealth();
    const timer = setInterval(checkHealth, 30000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#090D16]">
      {/* Top Banner Navigation */}
      <Header
        backendHealthy={backendHealthy}
        totalDbRecords={totalDbRecords}
        currentView={currentView}
        onViewChange={setCurrentView}
      />

      {/* Main Workspace Toggle: Map vs Burning Activity Calendar */}
      {currentView === 'map' ? (
        <main className="flex-1 flex overflow-hidden relative">
          {/* Left Side: Tactical Control Panel */}
          <ControlPanel
            bbox={bbox}
            onBboxChange={handleBoundsChange}
            onHarmonize={executeHarmonization}
            onExportCsv={handleExportCsv}
            loading={loading}
            exporting={exporting}
            showPerimeters={showPerimeters}
            setShowPerimeters={setShowPerimeters}
            showRawObservations={showRawObservations}
            setShowRawObservations={setShowRawObservations}
            showNoisePoints={showNoisePoints}
            setShowNoisePoints={setShowNoisePoints}
          />

          {/* Center: Dynamic Geospatial Map */}
          <div className="flex-1 relative h-full">
            {errorNotice && (
              <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[1500] px-4 py-2 bg-rose-950/90 border border-rose-500 text-rose-200 text-xs rounded-lg backdrop-blur-md shadow-2xl flex items-center gap-3">
                <span>⚠️ {errorNotice}</span>
                <button
                  onClick={() => setErrorNotice(null)}
                  className="text-xs text-rose-400 hover:text-white underline font-semibold"
                >
                  Dismiss
                </button>
              </div>
            )}

            <MapWrapper
              bbox={bbox}
              clusters={clusters}
              noisePoints={noisePoints}
              selectedClusterId={selectedCluster?.cluster_id ?? null}
              onSelectCluster={(cluster) => setSelectedCluster(cluster)}
              onBoundsChange={handleBoundsChange}
              showPerimeters={showPerimeters}
              showRawObservations={showRawObservations}
              showNoisePoints={showNoisePoints}
            />

            <Legend />
          </div>

          {/* Right Side: Incident Telemetry Feed & Summary Cards */}
          <TelemetryPanel
            summary={summary}
            clusters={clusters}
            selectedClusterId={selectedCluster?.cluster_id ?? null}
            onSelectCluster={(cluster) => setSelectedCluster(cluster)}
            loading={loading}
          />
        </main>
      ) : (
        <main className="flex-1 overflow-hidden relative">
          <BurningActivityCalendar />
        </main>
      )}

      {/* Incident Deep Intelligence Inspector Modal */}
      {selectedCluster && currentView === 'map' && (
        <ClusterDetailModal
          cluster={selectedCluster}
          onClose={() => setSelectedCluster(null)}
        />
      )}
    </div>
  );
}

