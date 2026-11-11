'use client';

import React, { useState, useEffect, useCallback } from 'react';
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

  // Harmonize function
  const executeHarmonization = useCallback(
    async (overrideParams?: Partial<HarmonizeParams>) => {
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
        };

        const result = await fetchHarmonizedData(queryParams);
        setClusters([...(result.clusters || [])]);
        setSummary(result.summary ? { ...result.summary } : null);
        setNoisePoints([...(result.noise_points || [])]);
      } catch (err: any) {
        console.error('[Dashboard Error] Failed to harmonize AOI bounding box:', {
          error: err,
          message: err.message,
          stack: err.stack,
          bbox,
        });
        setErrorNotice(err.message || 'Failed to connect to FastAPI /api/harmonize endpoint');
      } finally {
        setLoading(false);
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
      setBackendHealthy(health.status === 'healthy');
      setTotalDbRecords(health.records);
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

