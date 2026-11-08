"""
Synthetic NASA FIRMS Data Generator: MODIS & VIIRS Coincident Overpasses.

Generates realistic historical wildfire observations adhering to NASA FIRMS standards:
- MODIS (Terra & Aqua): 1km nominal spatial resolution, bowtie effects, 0-100% confidence.
- VIIRS (Suomi-NPP & NOAA-20): 375m I-band resolution, higher detection count per fire front,
  'low'/'nominal'/'high' confidence ratings.
- Realistic overpass schedules: Terra (10:30), Aqua (13:30), Suomi-NPP (13:40), NOAA-20 (14:20).
- Multi-day fire spread and isolated false alarm noise points.
"""

import os
from pathlib import Path
from datetime import datetime, timedelta
import random
import pandas as pd
import numpy as np


def generate_synthetic_nasa_firms_dataset(output_path: str, num_fire_complexes: int = 5) -> pd.DataFrame:
    random.seed(42)
    np.random.seed(42)

    # Reference wildfire epicenters (California, Pacific NW, Mediterranean)
    fire_epicenters = [
        {"name": "Sierra Complex", "lat": 37.850, "lon": -119.550, "base_frp": 65.0, "spread_km": 4.0},
        {"name": "Cascade Front", "lat": 44.150, "lon": -121.750, "base_frp": 120.0, "spread_km": 6.5},
        {"name": "Shasta Ridge", "lat": 41.200, "lon": -122.300, "base_frp": 45.0, "spread_km": 3.0},
        {"name": "Klamath Basin", "lat": 41.900, "lon": -121.800, "base_frp": 80.0, "spread_km": 5.0},
        {"name": "Plumas Perimeter", "lat": 39.950, "lon": -120.900, "base_frp": 150.0, "spread_km": 8.0},
    ]

    base_date = datetime(2023, 8, 15)
    records = []

    # KM to degrees approx in California (~38°N)
    km_per_lat = 111.0
    km_per_lon = 111.0 * np.cos(np.radians(38.0))

    for fire in fire_epicenters[:num_fire_complexes]:
        center_lat = fire["lat"]
        center_lon = fire["lon"]
        base_frp = fire["base_frp"]
        spread_km = fire["spread_km"]

        # Simulate over 3 consecutive days
        for day_offset in range(3):
            current_day = base_date + timedelta(days=day_offset)
            
            # Fire spreads eastward / northeastward over time
            day_drift_x_km = day_offset * 1.8
            day_drift_y_km = day_offset * 1.2
            
            day_center_lat = center_lat + (day_drift_y_km / km_per_lat)
            day_center_lon = center_lon + (day_drift_x_km / km_per_lon)

            # -------------------------------------------------------------
            # 1. Terra Overpass (MODIS) ~ 10:30 AM local / 18:30 UTC
            # 1km resolution -> Fewer, coarser pixels
            # -------------------------------------------------------------
            terra_time = current_day.replace(hour=18, minute=30)
            n_modis_terra = random.randint(2, 4)
            for _ in range(n_modis_terra):
                dx = np.random.normal(0, spread_km * 0.4)
                dy = np.random.normal(0, spread_km * 0.4)
                p_lat = day_center_lat + (dy / km_per_lat)
                p_lon = day_center_lon + (dx / km_per_lon)
                frp = max(5.0, np.random.normal(base_frp * 0.8, 15.0))
                conf = random.randint(60, 95)
                brightness = np.random.normal(325.0, 10.0)

                records.append({
                    "latitude": round(p_lat, 5),
                    "longitude": round(p_lon, 5),
                    "brightness": round(brightness, 1),
                    "scan": 1.2,
                    "track": 1.1,
                    "acq_date": terra_time.strftime("%Y-%m-%d"),
                    "acq_time": terra_time.strftime("%H%M"),
                    "satellite": "Terra",
                    "instrument": "MODIS",
                    "confidence": conf,
                    "version": "6.1NRT",
                    "bright_t31": round(brightness - 15.0, 1),
                    "frp": round(frp, 1),
                    "daynight": "D",
                    "type": 0,
                })

            # -------------------------------------------------------------
            # 2. Aqua Overpass (MODIS) ~ 13:30 local / 21:30 UTC
            # Peak diurnal burning cycle (coincident with afternoon orbit)
            # -------------------------------------------------------------
            aqua_time = current_day.replace(hour=21, minute=30)
            n_modis_aqua = random.randint(3, 6)
            for _ in range(n_modis_aqua):
                dx = np.random.normal(0.5, spread_km * 0.5)
                dy = np.random.normal(0.4, spread_km * 0.5)
                p_lat = day_center_lat + (dy / km_per_lat)
                p_lon = day_center_lon + (dx / km_per_lon)
                frp = max(10.0, np.random.normal(base_frp * 1.3, 25.0))
                conf = random.randint(70, 99)
                brightness = np.random.normal(345.0, 12.0)

                records.append({
                    "latitude": round(p_lat, 5),
                    "longitude": round(p_lon, 5),
                    "brightness": round(brightness, 1),
                    "scan": 1.0,
                    "track": 1.0,
                    "acq_date": aqua_time.strftime("%Y-%m-%d"),
                    "acq_time": aqua_time.strftime("%H%M"),
                    "satellite": "Aqua",
                    "instrument": "MODIS",
                    "confidence": conf,
                    "version": "6.1NRT",
                    "bright_t31": round(brightness - 18.0, 1),
                    "frp": round(frp, 1),
                    "daynight": "D",
                    "type": 0,
                })

            # -------------------------------------------------------------
            # 3. Suomi-NPP Overpass (VIIRS 375m) ~ 13:40 local / 21:40 UTC
            # Coincident with Aqua within 10 minutes!
            # High spatial resolution: 1 MODIS detection maps to 4-9 VIIRS detections!
            # -------------------------------------------------------------
            snpp_time = current_day.replace(hour=21, minute=40)
            n_viirs_snpp = random.randint(12, 22)  # High resolution detection fragmentation
            for _ in range(n_viirs_snpp):
                dx = np.random.normal(0.55, spread_km * 0.52)
                dy = np.random.normal(0.45, spread_km * 0.52)
                p_lat = day_center_lat + (dy / km_per_lat)
                p_lon = day_center_lon + (dx / km_per_lon)
                # Individual VIIRS sub-pixel pixels have smaller FRP individually but collectively sum to true energy
                frp = max(1.5, np.random.normal(base_frp * 0.28, 6.0))
                conf_choice = random.choice(["nominal", "high", "high"])
                brightness = np.random.normal(350.0, 15.0)

                records.append({
                    "latitude": round(p_lat, 5),
                    "longitude": round(p_lon, 5),
                    "bright_ti4": round(brightness, 1),
                    "scan": 0.38,
                    "track": 0.38,
                    "acq_date": snpp_time.strftime("%Y-%m-%d"),
                    "acq_time": snpp_time.strftime("%H%M"),
                    "satellite": "Suomi-NPP",
                    "instrument": "VIIRS",
                    "confidence": conf_choice,
                    "version": "2.0NRT",
                    "bright_ti5": round(brightness - 22.0, 1),
                    "frp": round(frp, 1),
                    "daynight": "D",
                    "type": 0,
                })

            # -------------------------------------------------------------
            # 4. NOAA-20 Overpass (VIIRS 375m) ~ 14:30 local / 22:30 UTC
            # ~50 minutes after Suomi-NPP, tracking fire front progression
            # -------------------------------------------------------------
            n20_time = current_day.replace(hour=22, minute=30)
            n_viirs_n20 = random.randint(14, 25)
            for _ in range(n_viirs_n20):
                # slight advance in front
                dx = np.random.normal(0.8, spread_km * 0.55)
                dy = np.random.normal(0.7, spread_km * 0.55)
                p_lat = day_center_lat + (dy / km_per_lat)
                p_lon = day_center_lon + (dx / km_per_lon)
                frp = max(1.5, np.random.normal(base_frp * 0.32, 7.0))
                conf_choice = random.choice(["nominal", "high", "high"])
                brightness = np.random.normal(352.0, 14.0)

                records.append({
                    "latitude": round(p_lat, 5),
                    "longitude": round(p_lon, 5),
                    "bright_ti4": round(brightness, 1),
                    "scan": 0.375,
                    "track": 0.375,
                    "acq_date": n20_time.strftime("%Y-%m-%d"),
                    "acq_time": n20_time.strftime("%H%M"),
                    "satellite": "NOAA-20",
                    "instrument": "VIIRS",
                    "confidence": conf_choice,
                    "version": "2.0NRT",
                    "bright_ti5": round(brightness - 20.0, 1),
                    "frp": round(frp, 1),
                    "daynight": "D",
                    "type": 0,
                })

    # -------------------------------------------------------------
    # 5. Inject isolated false alarms & noise points (solar glints, transient flares)
    # Crucial to test HDBSCAN noise rejection (-1 cluster assignment)
    # -------------------------------------------------------------
    for _ in range(15):
        noise_lat = random.uniform(36.5, 45.0)
        noise_lon = random.uniform(-124.0, -118.0)
        noise_dt = base_date + timedelta(days=random.randint(0, 2), hours=random.randint(8, 22))
        is_modis = random.choice([True, False])
        
        if is_modis:
            records.append({
                "latitude": round(noise_lat, 5),
                "longitude": round(noise_lon, 5),
                "brightness": 305.0,
                "scan": 1.4,
                "track": 1.2,
                "acq_date": noise_dt.strftime("%Y-%m-%d"),
                "acq_time": noise_dt.strftime("%H%M"),
                "satellite": "Terra",
                "instrument": "MODIS",
                "confidence": random.randint(30, 50),
                "version": "6.1NRT",
                "bright_t31": 298.0,
                "frp": round(random.uniform(2.0, 8.0), 1),
                "daynight": "D",
                "type": 2,  # other static / false
            })
        else:
            records.append({
                "latitude": round(noise_lat, 5),
                "longitude": round(noise_lon, 5),
                "bright_ti4": 310.0,
                "scan": 0.4,
                "track": 0.4,
                "acq_date": noise_dt.strftime("%Y-%m-%d"),
                "acq_time": noise_dt.strftime("%H%M"),
                "satellite": "Suomi-NPP",
                "instrument": "VIIRS",
                "confidence": "low",
                "version": "2.0NRT",
                "bright_ti5": 295.0,
                "frp": round(random.uniform(0.5, 3.0), 1),
                "daynight": "D",
                "type": 2,
            })

    df = pd.DataFrame(records)
    # Shuffle order to simulate real unsorted raw stream
    df = df.sample(frac=1, random_state=42).reset_index(drop=True)

    Path(os.path.dirname(os.path.abspath(output_path))).mkdir(parents=True, exist_ok=True)
    df.to_csv(output_path, index=False)
    print(f"Generated {len(df)} synthetic observations saved to: {output_path}")
    print(f"MODIS detections: {(df['instrument'] == 'MODIS').sum()}")
    print(f"VIIRS detections: {(df['instrument'] == 'VIIRS').sum()}")
    return df


if __name__ == "__main__":
    out_csv = os.path.join(os.path.dirname(__file__), "..", "data", "sample_modis_viirs_data.csv")
    generate_synthetic_nasa_firms_dataset(out_csv)

