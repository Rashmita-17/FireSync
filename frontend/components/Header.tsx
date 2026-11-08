'use client';

import React, { useState, useEffect } from 'react';
import { Satellite, Radio, Flame, ShieldAlert, Clock, ExternalLink } from 'lucide-react';

interface HeaderProps {
  backendHealthy: boolean;
  totalDbRecords: number;
}

export default function Header({ backendHealthy, totalDbRecords }: HeaderProps) {
  const [utcTime, setUtcTime] = useState<string>('');

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setUtcTime(now.toUTCString().replace('GMT', 'UTC'));
    };
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="h-14 bg-slate-950/95 border-b border-slate-800/80 px-4 flex items-center justify-between text-slate-200 z-30 select-none">
      {/* Left: Branding & Mission Title */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-rose-500/20 to-orange-500/20 border border-rose-500/40 shadow-glow-danger">
          <Flame className="w-5 h-5 text-rose-500 animate-pulse" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold tracking-wider text-white uppercase font-sans">
              NASA FIRMS // Incident Harmonization Grid
            </h1>
            <span className="hidden sm:inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
              MODIS + VIIRS HDBSCAN
            </span>
          </div>
          <p className="text-[10px] text-slate-400 tracking-tight hidden md:block">
            Spatio-Temporal De-biasing & Multi-Sensor Fire Front Synthesis
          </p>
        </div>
      </div>

      {/* Center: Live Orbit Constellations & Clock */}
      <div className="hidden lg:flex items-center gap-4">
        {/* Constellations */}
        <div className="flex items-center gap-2 px-2.5 py-1 bg-slate-900/80 rounded border border-slate-800 text-[11px]">
          <Satellite className="w-3.5 h-3.5 text-purple-400" />
          <span className="text-slate-400">MODIS:</span>
          <span className="text-purple-300 font-mono font-medium">Terra / Aqua (1km)</span>
        </div>
        <div className="flex items-center gap-2 px-2.5 py-1 bg-slate-900/80 rounded border border-slate-800 text-[11px]">
          <Satellite className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-slate-400">VIIRS:</span>
          <span className="text-cyan-300 font-mono font-medium">S-NPP / NOAA-20 (375m)</span>
        </div>

        {/* Live Mission Clock */}
        <div className="flex items-center gap-1.5 text-slate-300 font-mono text-xs px-2.5 py-1 bg-slate-900/90 rounded border border-slate-800">
          <Clock className="w-3.5 h-3.5 text-cyan-400 animate-spin-slow" />
          <span>{utcTime || 'SYNCHRONIZING...'}</span>
        </div>
      </div>

      {/* Right: Backend Status & API Link */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-2.5 py-1 bg-slate-900/80 rounded border border-slate-800 text-xs">
          <div className="relative flex items-center justify-center">
            <span
              className={`w-2 h-2 rounded-full ${
                backendHealthy ? 'bg-emerald-400 shadow-glow-success' : 'bg-rose-500 animate-ping'
              }`}
            />
          </div>
          <span className="text-slate-300 hidden sm:inline">FastAPI:</span>
          <span
            className={`font-mono text-[11px] font-semibold ${
              backendHealthy ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {backendHealthy ? 'ONLINE' : 'CONNECTING...'}
          </span>
          {backendHealthy && (
            <span className="text-[10px] text-slate-500 font-mono">
              ({totalDbRecords.toLocaleString()} recs)
            </span>
          )}
        </div>

        <a
          href="http://localhost:8000/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded border border-slate-700 text-xs transition font-medium"
          title="Open FastAPI Swagger Interactive API documentation"
        >
          <span>API Docs</span>
          <ExternalLink className="w-3 h-3 opacity-70" />
        </a>
      </div>
    </header>
  );
}

