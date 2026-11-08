'use client';

import React, { useState, useMemo } from 'react';
import {
  generateHistoricalFireData,
  getAccessibleColor,
  exportCalendarToCsv,
  MONTH_NAMES,
} from '@/utils/calendarData';
import { MonthlyFireActivity, ColorRampType, MonthClimatology } from '@/types/calendar';
import {
  Calendar,
  Flame,
  Download,
  Eye,
  TrendingUp,
  AlertTriangle,
  Info,
  ChevronRight,
  Sparkles,
  BarChart3,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';

export default function BurningActivityCalendar() {
  // Pre-generate historical dataset spanning 2000 to 2026
  const { monthlyData, annualSummaries, climatology } = useMemo(
    () => generateHistoricalFireData(),
    []
  );

  // Active visualization configuration
  const [metricMode, setMetricMode] = useState<'hotspots' | 'frp'>('hotspots');
  const [colorRamp, setColorRamp] = useState<ColorRampType>('inferno');

  // Interactive selection state
  // Default selected month is November (current month in 2026)
  const [selectedMonth, setSelectedMonth] = useState<number>(11);
  const [selectedYear, setSelectedYear] = useState<number>(2026);
  const [hoveredCell, setHoveredCell] = useState<MonthlyFireActivity | null>(null);

  // Max value for color normalization
  const maxValue = useMemo(() => {
    if (metricMode === 'hotspots') {
      return Math.max(...monthlyData.map((d) => d.hotspots));
    }
    return Math.max(...monthlyData.map((d) => d.total_frp_mw));
  }, [monthlyData, metricMode]);

  // Look up selected item & climatology
  const activeItem = useMemo(() => {
    return (
      monthlyData.find((d) => d.year === selectedYear && d.month === selectedMonth) ||
      monthlyData[monthlyData.length - 2] // fallback to recent
    );
  }, [monthlyData, selectedYear, selectedMonth]);

  const activeClimatology: MonthClimatology = climatology[selectedMonth] || climatology[11];

  // Compare selected/current month against historical median
  const currentMonthAnomaly = activeItem ? activeItem.anomaly_pct : 0;

  // Handle Export CSV
  const handleExportCsv = () => {
    exportCalendarToCsv(monthlyData);
  };

  return (
    <div className="flex flex-col h-full bg-[#090D16] text-slate-100 overflow-y-auto p-4 md:p-6 space-y-6">
      {/* 1. Header & Controls Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-4 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-2xl backdrop-blur-md">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-rose-500/20 to-orange-500/20 border border-rose-500/40 flex items-center justify-center text-rose-500 shadow-glow-danger">
              <Calendar className="w-5 h-5" />
            </div>
            <h1 className="text-lg font-bold text-white tracking-wide uppercase font-sans">
              Burning Activity Calendar // 2000 – 2026
            </h1>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
              NASA FIRMS Climatology
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Longitudinal satellite hotspot detection matrix with accessible color scales and anomaly detection against 25-year medians.
          </p>
        </div>

        {/* Tactical Controls & Prominent Export Button */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Metric Selector */}
          <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setMetricMode('hotspots')}
              className={`px-3 py-1.5 rounded-lg transition font-medium ${
                metricMode === 'hotspots'
                  ? 'bg-rose-600 text-white shadow-glow-danger'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Hotspot Count
            </button>
            <button
              onClick={() => setMetricMode('frp')}
              className={`px-3 py-1.5 rounded-lg transition font-medium ${
                metricMode === 'frp'
                  ? 'bg-rose-600 text-white shadow-glow-danger'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Energy (MW)
            </button>
          </div>

          {/* Color Ramp Selector with Accessibility Badges */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
            <span className="text-[10px] font-semibold text-slate-500 px-2 uppercase tracking-wider flex items-center gap-1">
              <Eye className="w-3 h-3 text-cyan-400" />
              <span>Palette:</span>
            </span>

            <button
              onClick={() => setColorRamp('inferno')}
              className={`px-2.5 py-1.5 rounded-lg transition text-[11px] font-medium flex items-center gap-1.5 ${
                colorRamp === 'inferno'
                  ? 'bg-slate-800 text-amber-300 border border-slate-700 shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Inferno: Perceptually uniform, monotonically increasing luminance. NASA/Matplotlib standard."
            >
              <span className="w-2.5 h-2.5 rounded-full bg-gradient-to-r from-purple-800 via-rose-500 to-yellow-300" />
              <span>Inferno</span>
            </button>

            <button
              onClick={() => setColorRamp('viridis')}
              className={`px-2.5 py-1.5 rounded-lg transition text-[11px] font-medium flex items-center gap-1.5 ${
                colorRamp === 'viridis'
                  ? 'bg-slate-800 text-emerald-300 border border-slate-700 shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Viridis: WCAG AAA compliant, fully accessible under all colorblindness variations."
            >
              <span className="w-2.5 h-2.5 rounded-full bg-gradient-to-r from-purple-900 via-teal-500 to-yellow-400" />
              <span>Viridis</span>
            </button>

            <button
              onClick={() => setColorRamp('cividis')}
              className={`px-2.5 py-1.5 rounded-lg transition text-[11px] font-medium flex items-center gap-1.5 ${
                colorRamp === 'cividis'
                  ? 'bg-slate-800 text-cyan-300 border border-slate-700 shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Cividis: Mathematically optimized specifically for deuteranopes & protanopes."
            >
              <span className="w-2.5 h-2.5 rounded-full bg-gradient-to-r from-blue-900 via-slate-400 to-yellow-300" />
              <span>Cividis</span>
            </button>
          </div>

          {/* Prominent Export to CSV Button */}
          <button
            onClick={handleExportCsv}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-glow-cyan flex items-center gap-2 border border-cyan-400/40"
          >
            <Download className="w-4 h-4 text-white" />
            <span>Export to CSV</span>
          </button>
        </div>
      </div>

      {/* 2. Top-Tier Analytics Card: Historical Comparisons & Anomalies */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Card Column 1 & 2: Current Month vs Historical Median Inspector */}
        <div className="lg:col-span-2 p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                <BarChart3 className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white tracking-wide uppercase">
                  Historical Comparison & Climatological Anomaly
                </h2>
                <p className="text-xs text-slate-400">
                  Benchmarked against 25-Year Multi-Sensor Baseline (2000–2025 Medians)
                </p>
              </div>
            </div>

            {/* Quick Month Selector */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400 font-medium">Month:</span>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 font-semibold focus:outline-none focus:border-cyan-500 transition"
              >
                {MONTH_NAMES.map((name, idx) => (
                  <option key={name} value={idx + 1}>
                    {name} {idx + 1 === 11 ? '(Current)' : ''}
                  </option>
                ))}
              </select>

              <span className="text-slate-400 font-medium ml-1">Year:</span>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 font-semibold focus:outline-none focus:border-cyan-500 transition"
              >
                {Array.from({ length: 27 }, (_, i) => 2026 - i).map((y) => (
                  <option key={y} value={y}>
                    {y} {y === 2026 ? '(Present)' : y === 2020 ? '🔥 (Record)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Anomaly Highlight Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Value vs Median */}
            <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800/80">
              <div className="text-[11px] text-slate-400 mb-1 flex items-center justify-between">
                <span>{activeItem.month_name} {activeItem.year} Activity</span>
                <Flame className="w-3.5 h-3.5 text-rose-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-white">
                {metricMode === 'hotspots'
                  ? activeItem.hotspots.toLocaleString()
                  : `${(activeItem.total_frp_mw / 1000).toFixed(1)}k MW`}
              </div>
              <div className="text-xs text-slate-400 mt-1 font-mono">
                Historical Median: <strong className="text-slate-200">{activeClimatology.median.toLocaleString()}</strong>
              </div>
            </div>

            {/* Anomaly Percentage & Classification */}
            <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800/80">
              <div className="text-[11px] text-slate-400 mb-1 flex items-center justify-between">
                <span>Anomaly vs 25-Year Median</span>
                <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <div
                className={`text-2xl font-bold font-mono ${
                  currentMonthAnomaly >= 40
                    ? 'text-rose-400'
                    : currentMonthAnomaly >= 15
                    ? 'text-amber-400'
                    : currentMonthAnomaly <= -15
                    ? 'text-cyan-400'
                    : 'text-emerald-400'
                }`}
              >
                {currentMonthAnomaly > 0 ? `+${currentMonthAnomaly}%` : `${currentMonthAnomaly}%`}
              </div>
              <div className="mt-1">
                {currentMonthAnomaly >= 40 ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/40">
                    EXTREME FIRE SURGE
                  </span>
                ) : currentMonthAnomaly >= 15 ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40">
                    ELEVATED BURNING
                  </span>
                ) : currentMonthAnomaly <= -15 ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/20 text-cyan-400 border border-cyan-500/40">
                    BELOW SEASONAL NORM
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                    SEASONAL BASELINE
                  </span>
                )}
              </div>
            </div>

            {/* Historical Climatology Bounds (Q25 - Q75) */}
            <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800/80">
              <div className="text-[11px] text-slate-400 mb-1 flex items-center justify-between">
                <span>Interquartile Range (IQR)</span>
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <div className="text-sm font-mono text-slate-200 mt-1">
                Q25: <strong className="text-slate-300">{activeClimatology.q25.toLocaleString()}</strong> — Q75: <strong className="text-slate-300">{activeClimatology.q75.toLocaleString()}</strong>
              </div>
              <div className="text-[11px] text-slate-500 mt-2 font-mono">
                Record High: {activeClimatology.record_count.toLocaleString()} ({activeClimatology.record_year})
              </div>
            </div>
          </div>

          {/* Climatological Range Bar */}
          <div className="p-3 bg-slate-950/50 rounded-xl border border-slate-800 text-xs space-y-1.5">
            <div className="flex justify-between text-slate-400 text-[11px]">
              <span>Historical Range for {activeItem.month_name} (2000–2025)</span>
              <span className="text-slate-300 font-mono">
                Min: {activeClimatology.min.toLocaleString()} | Max: {activeClimatology.max.toLocaleString()}
              </span>
            </div>

            {/* Visual distribution gauge bar */}
            <div className="relative w-full h-3 bg-slate-800 rounded-full overflow-hidden">
              {/* IQR Normal band (Q25 to Q75) */}
              <div
                className="absolute top-0 bottom-0 bg-cyan-600/40 border-x border-cyan-400"
                style={{
                  left: `${((activeClimatology.q25 - activeClimatology.min) / (activeClimatology.max - activeClimatology.min)) * 100}%`,
                  width: `${((activeClimatology.q75 - activeClimatology.q25) / (activeClimatology.max - activeClimatology.min)) * 100}%`,
                }}
              />
              {/* Median Tick */}
              <div
                className="absolute top-0 bottom-0 w-1 bg-white shadow-lg"
                style={{
                  left: `${((activeClimatology.median - activeClimatology.min) / (activeClimatology.max - activeClimatology.min)) * 100}%`,
                }}
              />
              {/* Current Active Item Marker */}
              <div
                className="absolute top-0 bottom-0 w-2 bg-rose-500 rounded-full shadow-glow-danger"
                style={{
                  left: `${Math.min(98, Math.max(2, ((activeItem.hotspots - activeClimatology.min) / (activeClimatology.max - activeClimatology.min)) * 100))}%`,
                }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>Low Fire Year</span>
              <span className="text-white font-semibold">● 25-Year Median</span>
              <span className="text-rose-400 font-semibold">● {activeItem.year} Value</span>
              <span>Record Fire Year</span>
            </div>
          </div>
        </div>

        {/* Card Column 3: Multi-Decadal Sensor Transition & Trend Insight */}
        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-800">
              <Sparkles className="w-4 h-4 text-purple-400" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                Multi-Decade Sensor Transition
              </h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Historical comparisons from 2000 to the present span two distinct remote sensing eras:
            </p>
          </div>

          <div className="space-y-2 text-xs font-mono">
            <div className="p-2.5 rounded-lg bg-purple-950/20 border border-purple-500/30">
              <div className="flex justify-between text-purple-300 font-bold mb-1">
                <span>2000 – 2011 (MODIS Era)</span>
                <span>1,000m Pixel</span>
              </div>
              <div className="text-[11px] text-slate-400">
                Terra & Aqua provided the initial 1km continuous active fire baseline.
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-cyan-950/20 border border-cyan-500/30">
              <div className="flex justify-between text-cyan-300 font-bold mb-1">
                <span>2012 – Present (VIIRS Era)</span>
                <span>375m I-Band</span>
              </div>
              <div className="text-[11px] text-slate-400">
                Suomi-NPP & NOAA-20/21 added 375m resolution, detecting fragmented sub-pixel fire fronts.
              </div>
            </div>
          </div>

          <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 text-[11px] text-slate-400">
            ⚖️ <strong>Climatological Note:</strong> In {activeItem.year}, MODIS accounted for{' '}
            <strong className="text-purple-300">{activeItem.modis_hotspots.toLocaleString()}</strong> detections while VIIRS contributed{' '}
            <strong className="text-cyan-300">{activeItem.viirs_hotspots.toLocaleString()}</strong> detections.
          </div>
        </div>
      </div>

      {/* 3. The Burning Activity Calendar Heatmap Grid (27 Years x 12 Months) */}
      <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-2xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Flame className="w-4 h-4 text-orange-400" />
              <span>Multi-Decadal Burning Activity Matrix (2000 – 2026)</span>
            </h2>
            <p className="text-xs text-slate-400">
              Click any month to inspect historical comparisons, anomalies, and multi-sensor composition.
            </p>
          </div>

          {/* Color Scale Gradient Legend Bar */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[10px] text-slate-400 font-mono">Low</span>
            <div
              className="w-32 h-3 rounded-full border border-slate-700 shadow-inner"
              style={{
                background:
                  colorRamp === 'inferno'
                    ? 'linear-gradient(to right, #0F172A, #280B54, #651A80, #A8326E, #E15349, #FA9E3B, #FCFFA4)'
                    : colorRamp === 'viridis'
                    ? 'linear-gradient(to right, #0F172A, #440154, #3B528B, #21918C, #5EC962, #FDE725)'
                    : 'linear-gradient(to right, #0F172A, #00204D, #415570, #7F847F, #BFA666, #FFEA46)',
              }}
            />
            <span className="text-[10px] text-slate-400 font-mono">
              {metricMode === 'hotspots' ? `${Math.round(maxValue / 1000)}k Hotspots` : `${Math.round(maxValue / 1000)}k MW`}
            </span>
          </div>
        </div>

        {/* Matrix Container */}
        <div className="overflow-x-auto pb-2">
          <div className="min-w-[760px]">
            {/* Header: Months Jan - Dec + Annual Total */}
            <div className="grid grid-cols-14 gap-1.5 pb-2 text-[11px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800 text-center">
              <div className="text-left pl-2">Year</div>
              {MONTH_NAMES.map((m) => (
                <div key={m} className={m === 'Nov' ? 'text-cyan-400' : ''}>
                  {m}
                </div>
              ))}
              <div className="text-right pr-2">Annual Total</div>
            </div>

            {/* Matrix Rows: 2026 down to 2000 */}
            <div className="space-y-1 pt-1.5">
              {annualSummaries
                .slice()
                .reverse()
                .map((annSummary) => {
                  const y = annSummary.year;
                  const yearMonths = monthlyData.filter((d) => d.year === y);

                  return (
                    <div
                      key={y}
                      className={`grid grid-cols-14 gap-1.5 items-center rounded-lg transition-colors p-0.5 ${
                        selectedYear === y ? 'bg-slate-800/40 ring-1 ring-cyan-500/30' : 'hover:bg-slate-800/20'
                      }`}
                    >
                      {/* Year Label */}
                      <div className="flex items-center gap-1.5 pl-2 text-xs font-mono font-bold">
                        <span className={y === 2026 ? 'text-cyan-400' : y === 2020 ? 'text-rose-400' : 'text-slate-300'}>
                          {y}
                        </span>
                        {annSummary.record_year && (
                          <span className="text-[10px]" title="Historic Record Fire Season">🔥</span>
                        )}
                      </div>

                      {/* 12 Months Cells */}
                      {yearMonths.map((item) => {
                        const val = metricMode === 'hotspots' ? item.hotspots : item.total_frp_mw;
                        const normalized = val / maxValue;
                        const { backgroundColor, textColor } = getAccessibleColor(normalized, colorRamp);
                        const isSelected = selectedYear === item.year && selectedMonth === item.month;

                        return (
                          <div
                            key={item.month}
                            onClick={() => {
                              setSelectedYear(item.year);
                              setSelectedMonth(item.month);
                            }}
                            onMouseEnter={() => setHoveredCell(item)}
                            onMouseLeave={() => setHoveredCell(null)}
                            style={{ backgroundColor, color: textColor }}
                            className={`h-8 rounded-md flex flex-col items-center justify-center cursor-pointer transition-all text-[10px] font-mono font-semibold relative group select-none ${
                              isSelected ? 'ring-2 ring-white scale-105 z-10 shadow-lg' : 'hover:scale-105 hover:z-10'
                            }`}
                          >
                            <span>
                              {metricMode === 'hotspots'
                                ? item.hotspots >= 1000
                                  ? `${(item.hotspots / 1000).toFixed(1)}k`
                                  : item.hotspots
                                : `${Math.round(item.total_frp_mw / 1000)}k`}
                            </span>

                            {/* Extreme anomaly indicator dot */}
                            {item.anomaly_pct >= 50 && (
                              <span
                                className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-rose-500 shadow-sm"
                                title={`Anomaly: +${item.anomaly_pct}%`}
                              />
                            )}
                          </div>
                        );
                      })}

                      {/* Annual Total Column */}
                      <div className="text-right pr-2 text-xs font-mono font-bold">
                        <span
                          className={
                            annSummary.anomaly_vs_mean_pct >= 30
                              ? 'text-rose-400'
                              : annSummary.anomaly_vs_mean_pct >= 10
                              ? 'text-amber-400'
                              : 'text-slate-300'
                          }
                        >
                          {(annSummary.total_hotspots / 1000).toFixed(1)}k
                        </span>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>

        {/* Dynamic Hover Tooltip Preview */}
        {hoveredCell && (
          <div className="p-3 bg-slate-950 rounded-xl border border-slate-700/80 shadow-2xl flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
            <div className="flex items-center gap-2">
              <span className="font-bold text-white text-sm">
                {hoveredCell.month_name} {hoveredCell.year}
              </span>
              <span className="text-slate-400">
                Hotspots: <strong className="text-rose-400">{hoveredCell.hotspots.toLocaleString()}</strong>
              </span>
              <span className="text-slate-400">
                FRP: <strong className="text-amber-400">{hoveredCell.total_frp_mw.toLocaleString()} MW</strong>
              </span>
            </div>

            <div className="flex items-center gap-4">
              <span className="text-slate-400">
                Sensors: <span className="text-purple-400">{hoveredCell.modis_hotspots.toLocaleString()} MODIS</span> +{' '}
                <span className="text-cyan-400">{hoveredCell.viirs_hotspots.toLocaleString()} VIIRS</span>
              </span>
              <span
                className={`font-bold ${
                  hoveredCell.anomaly_pct > 0 ? 'text-rose-400' : 'text-cyan-400'
                }`}
              >
                Anomaly: {hoveredCell.anomaly_pct > 0 ? `+${hoveredCell.anomaly_pct}%` : `${hoveredCell.anomaly_pct}%`}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

