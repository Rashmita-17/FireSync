import json
import httpx
from datetime import datetime

payload = {
    "bbox": {
        "min_lon": -125.0,
        "min_lat": 36.0,
        "max_lon": -118.0,
        "max_lat": 45.0
    },
    "day_range": 5,
    "use_live": True,
    "spatial_bandwidth_km": 2.5,
    "temporal_bandwidth_hours": 6.0,
    "min_cluster_size": 2,
    "min_samples": 1,
    "cluster_selection_epsilon": 0.5,
    "include_observations": True,
    "include_noise": True
}

print("=" * 65)
print("NASA FIRMS // LIVE WESTERN SECTOR HARMONIZATION QUERY")
print("Target Bbox: [-125.0, 36.0, -118.0, 45.0]")
print("Lookback Window: 10 days")
print("=" * 65)

start = datetime.now()
with httpx.Client(timeout=90.0) as client:
    resp = client.post("http://127.0.0.1:8000/api/harmonize", json=payload)
    elapsed = (datetime.now() - start).total_seconds()

print(f"HTTP Status Code: {resp.status_code}")
if resp.status_code != 200:
    print(f"Error Response: {resp.text}")
else:
    data = resp.json()
    summary = data.get("summary", {})
    clusters = data.get("clusters", [])
    print(f"Total Raw FIRMS Detections: {summary.get('total_observations'):,}")
    print(f" -> MODIS Detections: {summary.get('modis_detections'):,}")
    print(f" -> VIIRS Detections: {summary.get('viirs_detections'):,}")
    print(f"Harmonized Clusters Synthesized: {summary.get('total_clusters'):,}")
    print(f"Cross-Validated Clusters (MODIS + VIIRS): {summary.get('cross_validated_clusters'):,}")
    rate = summary.get('cross_validation_rate', 0.0) * 100.0
    print(f"Multi-Sensor Verification Rate: {rate:.1f}%")
    print(f"Total Harmonized FRP Energy: {summary.get('total_harmonized_frp_mw'):,.1f} MW")
    ratio = summary.get('spatial_compression_ratio', 1.0)
    print(f"Spatial Compression Ratio: {ratio:.2f}x")
    print(f"Total Noise / Ephemeral Detections: {summary.get('total_noise_points'):,}")
    print(f"Clustering Runtime: {summary.get('execution_time_ms'):.1f}ms")
    print(f"Full Roundtrip Latency: {elapsed:.2f}s")

    if clusters:
        print("\nTop Harmonized Fire Complexes:")
        for c in sorted(clusters, key=lambda x: x.get('total_frp', 0), reverse=True)[:3]:
            print(f" - Complex #{c['cluster_id']}: {c['total_detections']} detections ({c['modis_count']}M + {c['viirs_count']}V), {c['total_frp']:.1f} MW, Centroid ({c['weighted_centroid_lat']:.3f}, {c['weighted_centroid_lon']:.3f}), Area: {c['estimated_area_km2']:.2f} km²")
