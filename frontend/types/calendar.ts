export interface MonthlyFireActivity {
  year: number;
  month: number;
  month_name: string;
  hotspots: number;
  modis_hotspots: number;
  viirs_hotspots: number;
  total_frp_mw: number;
  historical_median: number;
  anomaly_pct: number;
  is_record_high?: boolean;
}

export interface AnnualSummary {
  year: number;
  total_hotspots: number;
  peak_month: string;
  peak_hotspots: number;
  total_frp_mw: number;
  anomaly_vs_mean_pct: number;
  record_year?: boolean;
}

export interface MonthClimatology {
  month: number;
  month_name: string;
  median: number;
  mean: number;
  min: number;
  max: number;
  q25: number;
  q75: number;
  record_year: number;
  record_count: number;
}

export type ColorRampType = 'inferno' | 'viridis' | 'cividis';

