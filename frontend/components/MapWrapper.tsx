'use client';

import dynamic from 'next/dynamic';
import React from 'react';
import { BoundingBox, HarmonizedCluster, RawObservation } from '@/types/fire';

interface MapWrapperProps {
  bbox: BoundingBox;
  clusters: HarmonizedCluster[];
  noisePoints?: RawObservation[];
  selectedClusterId: number | null;
  onSelectCluster: (cluster: HarmonizedCluster | null) => void;
  onBoundsChange: (newBbox: BoundingBox) => void;
  showPerimeters: boolean;
  showRawObservations: boolean;
  showNoisePoints: boolean;
}

const DynamicMap = dynamic(() => import('@/components/Map'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex flex-col items-center justify-center bg-slate-950 text-slate-400 gap-3 border border-slate-900">
      <div className="relative flex items-center justify-center">
        <div className="w-12 h-12 rounded-full border-2 border-cyan-500/30 border-t-cyan-400 animate-spin" />
        <div className="absolute w-6 h-6 rounded-full bg-cyan-500/20 animate-pulse" />
      </div>
      <div className="text-xs font-mono tracking-wider text-slate-300">
        INITIALIZING GEOSPATIAL RADAR CANVAS...
      </div>
    </div>
  ),
});

export default function MapWrapper(props: MapWrapperProps) {
  return <DynamicMap {...props} />;
}

