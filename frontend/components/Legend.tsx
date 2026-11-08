'use client';

import React, { useState } from 'react';
import { Info, ChevronDown, ChevronUp } from 'lucide-react';

export default function Legend() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="absolute bottom-6 right-6 z-[1000] select-none text-xs">
      <div className="bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-xl shadow-2xl p-3 w-64 text-slate-300">
        <div
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center justify-between font-bold text-white tracking-wide cursor-pointer text-[11px] uppercase pb-1 border-b border-slate-800"
        >
          <div className="flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-cyan-400" />
            <span>Tactical Map Legend</span>
          </div>
          {collapsed ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
        </div>

        {!collapsed && (
          <div className="mt-2.5 space-y-2.5 text-[11px]">
            {/* FRP Energy Gradient */}
            <div>
              <div className="text-[10px] text-slate-400 font-semibold mb-1 uppercase tracking-wider">
                Fire Radiative Power (FRP)
              </div>
              <div className="grid grid-cols-2 gap-1 font-mono text-[10px]">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#FF1744] shadow-glow-danger" />
                  <span>&gt; 200 MW (Extreme)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#FF5252]" />
                  <span>80 - 200 MW (High)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#FF9100]" />
                  <span>30 - 80 MW (Moderate)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#FFEA00]" />
                  <span>&lt; 30 MW (Low)</span>
                </div>
              </div>
            </div>

            {/* Sensor Symbols */}
            <div className="pt-2 border-t border-slate-800/80">
              <div className="text-[10px] text-slate-400 font-semibold mb-1 uppercase tracking-wider">
                Sensor Multi-Sourcing
              </div>
              <div className="space-y-1 font-mono text-[10px]">
                <div className="flex items-center gap-2">
                  <span className="px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-bold">
                    M+V
                  </span>
                  <span>Cross-Validated (MODIS + VIIRS)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-purple-400" />
                  <span>MODIS 1km Detections (Aqua/Terra)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-400" />
                  <span>VIIRS 375m Detections (S-NPP/N20)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-0.5 border-b-2 border-dashed border-rose-400" />
                  <span>Convex Hull Ground Perimeter</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

