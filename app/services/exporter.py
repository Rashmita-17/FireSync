import io
import csv
from typing import List, Generator
from app.schemas.harmonization import HarmonizedCluster


class DataExportService:
    """
    Export service generating standardized scientific CSV reports for harmonized clusters.
    Enables direct integration into QGIS, ArcGIS, Google Earth Engine, and scientific notebooks.
    """

    CSV_HEADERS = [
        "cluster_id",
        "centroid_lat",
        "centroid_lon",
        "weighted_centroid_lat",
        "weighted_centroid_lon",
        "first_detected_utc",
        "last_detected_utc",
        "duration_hours",
        "total_detections",
        "modis_count",
        "viirs_count",
        "sensor_ratio_viirs",
        "cross_validated",
        "total_frp_mw",
        "peak_frp_mw",
        "mean_frp_mw",
        "harmonized_confidence_pct",
        "estimated_area_km2",
        "bbox_min_lon",
        "bbox_min_lat",
        "bbox_max_lon",
        "bbox_max_lat",
    ]

    @classmethod
    def clusters_to_csv_stream(cls, clusters: List[HarmonizedCluster]) -> Generator[str, None, None]:
        """
        Generates CSV rows incrementally for streaming responses.
        """
        output = io.StringIO()
        writer = csv.writer(output)
        
        # Write header
        writer.writerow(cls.CSV_HEADERS)
        yield output.getvalue()
        output.seek(0)
        output.truncate(0)

        # Write data rows
        for c in clusters:
            writer.writerow([
                c.cluster_id,
                f"{c.centroid_lat:.6f}",
                f"{c.centroid_lon:.6f}",
                f"{c.weighted_centroid_lat:.6f}",
                f"{c.weighted_centroid_lon:.6f}",
                c.first_detected.isoformat(),
                c.last_detected.isoformat(),
                c.duration_hours,
                c.total_detections,
                c.modis_count,
                c.viirs_count,
                c.sensor_ratio,
                c.cross_validated,
                c.total_frp,
                c.peak_frp,
                c.mean_frp,
                c.harmonized_confidence,
                c.estimated_area_km2,
                c.bbox[0],
                c.bbox[1],
                c.bbox[2],
                c.bbox[3],
            ])
            yield output.getvalue()
            output.seek(0)
            output.truncate(0)

    @classmethod
    def clusters_to_csv_string(cls, clusters: List[HarmonizedCluster]) -> str:
        """
        Generates full CSV text string.
        """
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(cls.CSV_HEADERS)
        for c in clusters:
            writer.writerow([
                c.cluster_id,
                f"{c.centroid_lat:.6f}",
                f"{c.centroid_lon:.6f}",
                f"{c.weighted_centroid_lat:.6f}",
                f"{c.weighted_centroid_lon:.6f}",
                c.first_detected.isoformat(),
                c.last_detected.isoformat(),
                c.duration_hours,
                c.total_detections,
                c.modis_count,
                c.viirs_count,
                c.sensor_ratio,
                c.cross_validated,
                c.total_frp,
                c.peak_frp,
                c.mean_frp,
                c.harmonized_confidence,
                c.estimated_area_km2,
                c.bbox[0],
                c.bbox[1],
                c.bbox[2],
                c.bbox[3],
            ])
        return output.getvalue()


export_service = DataExportService()

