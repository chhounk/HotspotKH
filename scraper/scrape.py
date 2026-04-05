#!/usr/bin/env python3
"""
Cambodia Wildfire Monitor — NASA FIRMS Data Scraper

Fetches active fire/hotspot data from NASA FIRMS API,
enriches with province and protected area info,
classifies threat level, writes static JSON files for the frontend.
"""

import csv
import io
import json
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests
from shapely.geometry import Point, shape

# --- Configuration ---
FIRMS_MAP_KEY = os.environ.get("FIRMS_MAP_KEY", "DEMO_KEY")
CAMBODIA_BBOX = "102,10,108,15"  # lon_min,lat_min,lon_max,lat_max
FETCH_DAYS = 2
ICT = timezone(timedelta(hours=7))

SOURCES = [
    "VIIRS_SNPP_NRT",
    "VIIRS_NOAA20_NRT",
    "MODIS_NRT",
]

BASE_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
GEO_DIR = DATA_DIR / "geo"

FIELDS_TO_KEEP = [
    "latitude", "longitude", "brightness", "confidence",
    "acq_date", "acq_time", "satellite", "frp", "daynight",
]


def classify_hotspot(confidence: str, frp: float) -> str:
    """
    Classify a hotspot based on confidence + FRP.

    NASA FIRMS detects thermal anomalies, not confirmed fires.
    This classification estimates wildfire likelihood:

    - 'likely_wildfire': High confidence + strong heat (FRP >= 15 MW)
    - 'possible_wildfire': Nominal+ confidence with moderate heat (FRP >= 10 MW),
                           or high confidence with any FRP
    - 'thermal_anomaly': Everything else — agricultural burns, industrial heat, etc.
    """
    conf = str(confidence).strip().lower()

    # Normalize confidence to a level
    if conf in ("h", "high") or _conf_num(conf) >= 80:
        conf_level = "high"
    elif conf in ("n", "nominal") or _conf_num(conf) >= 30:
        conf_level = "nominal"
    else:
        conf_level = "low"

    frp_val = float(frp) if frp else 0.0

    if conf_level == "high" and frp_val >= 15:
        return "likely_wildfire"
    elif conf_level == "high" or (conf_level == "nominal" and frp_val >= 10):
        return "possible_wildfire"
    else:
        return "thermal_anomaly"


def _conf_num(conf: str) -> int:
    """Try to parse confidence as a number, return 0 if not numeric."""
    try:
        return int(conf)
    except (ValueError, TypeError):
        return 0


def fetch_firms_data(source: str) -> list[dict]:
    """Fetch fire data from a single FIRMS source."""
    url = f"{BASE_URL}/{FIRMS_MAP_KEY}/{source}/{CAMBODIA_BBOX}/{FETCH_DAYS}"
    print(f"  Fetching {source}...")
    try:
        resp = requests.get(url, timeout=60)
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"  WARNING: Failed to fetch {source}: {e}")
        return []

    text = resp.text.strip()
    if not text or text.startswith("<!") or "Invalid" in text[:200]:
        print(f"  WARNING: Invalid response from {source}: {text[:200]}")
        return []

    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for row in reader:
        point = {}
        for field in FIELDS_TO_KEEP:
            val = row.get(field, "")
            if field in ("latitude", "longitude", "brightness", "frp"):
                try:
                    point[field] = float(val) if val else 0.0
                except ValueError:
                    point[field] = 0.0
            else:
                point[field] = val
        point["source"] = source
        # Classify each point
        point["classification"] = classify_hotspot(point.get("confidence", ""), point.get("frp", 0))
        rows.append(point)

    print(f"  Got {len(rows)} points from {source}")
    return rows


def load_geojson(path: Path) -> list[dict]:
    """Load GeoJSON features with pre-built shapely geometries."""
    if not path.exists():
        print(f"  WARNING: GeoJSON not found: {path}")
        return []
    with open(path) as f:
        data = json.load(f)
    features = []
    for feat in data.get("features", []):
        try:
            geom = shape(feat["geometry"])
            features.append({"geometry": geom, "properties": feat.get("properties", {})})
        except Exception as e:
            print(f"  WARNING: Skipping invalid geometry: {e}")
    return features


def enrich_fires(fires: list[dict], provinces: list[dict], protected_areas: list[dict]) -> list[dict]:
    """Add province and protected area info to each fire point."""
    enriched = []
    discarded = 0

    for fire in fires:
        pt = Point(fire["longitude"], fire["latitude"])

        # Province lookup
        province_name = None
        for prov in provinces:
            if prov["geometry"].contains(pt):
                province_name = prov["properties"].get("NAME_1", "Unknown")
                break

        if province_name is None:
            discarded += 1
            continue

        fire["province"] = province_name

        # Protected area lookup
        fire["protected_area"] = False
        fire["protected_area_name"] = None
        for pa in protected_areas:
            if pa["geometry"].contains(pt):
                fire["protected_area"] = True
                fire["protected_area_name"] = pa["properties"].get("NAME", "Unknown Protected Area")
                break

        enriched.append(fire)

    print(f"  Enriched: {len(enriched)}, Discarded (outside Cambodia): {discarded}")
    return enriched


def build_summary(fires: list[dict]) -> dict:
    """Build summary statistics from enriched fire data."""
    now = datetime.now(ICT)

    province_counts: dict[str, int] = {}
    pa_count = 0
    dates = []
    classification_counts = {"likely_wildfire": 0, "possible_wildfire": 0, "thermal_anomaly": 0}

    for fire in fires:
        prov = fire.get("province", "Unknown")
        province_counts[prov] = province_counts.get(prov, 0) + 1
        if fire.get("protected_area"):
            pa_count += 1
        if fire.get("acq_date"):
            dates.append(fire["acq_date"])
        cls = fire.get("classification", "thermal_anomaly")
        classification_counts[cls] = classification_counts.get(cls, 0) + 1

    top_provinces = sorted(
        [{"province": k, "count": v} for k, v in province_counts.items()],
        key=lambda x: x["count"],
        reverse=True,
    )

    date_range = {}
    if dates:
        dates_sorted = sorted(dates)
        date_range = {"start": dates_sorted[0], "end": dates_sorted[-1]}

    return {
        "total_hotspots": len(fires),
        "likely_wildfires": classification_counts["likely_wildfire"],
        "possible_wildfires": classification_counts["possible_wildfire"],
        "thermal_anomalies": classification_counts["thermal_anomaly"],
        "hotspots_in_protected_areas": pa_count,
        "top_provinces": top_provinces,
        "last_updated": now.isoformat(),
        "date_range": date_range,
    }



def deduplicate(fires: list[dict]) -> list[dict]:
    """Remove duplicate fire detections (same lat/lon/date/time)."""
    seen = set()
    unique = []
    for fire in fires:
        key = (
            round(fire["latitude"], 4),
            round(fire["longitude"], 4),
            fire.get("acq_date", ""),
            fire.get("acq_time", ""),
        )
        if key not in seen:
            seen.add(key)
            unique.append(fire)
    return unique


def main():
    print("=" * 60)
    print("Cambodia Wildfire Monitor — Scraper")
    print(f"Time: {datetime.now(ICT).isoformat()}")
    print(f"API Key: {'SET' if FIRMS_MAP_KEY != 'DEMO_KEY' else 'DEMO_KEY (fallback)'}")
    print("=" * 60)

    # Fetch from all sources
    all_fires = []
    for source in SOURCES:
        all_fires.extend(fetch_firms_data(source))

    print(f"\nTotal raw hotspot points: {len(all_fires)}")

    # Deduplicate
    all_fires = deduplicate(all_fires)
    print(f"After deduplication: {len(all_fires)}")

    # Load geo data
    print("\nLoading geographic data...")
    provinces = load_geojson(GEO_DIR / "cambodia_provinces.geojson")
    protected_areas = load_geojson(GEO_DIR / "cambodia_protected_areas.geojson")
    print(f"  Provinces loaded: {len(provinces)}")
    print(f"  Protected areas loaded: {len(protected_areas)}")

    # Enrich
    print("\nEnriching hotspot data...")
    if provinces:
        enriched = enrich_fires(all_fires, provinces, protected_areas)
    else:
        print("  WARNING: No province data — skipping enrichment, keeping all points")
        enriched = all_fires
        for fire in enriched:
            fire["province"] = "Unknown"
            fire["protected_area"] = False
            fire["protected_area_name"] = None

    # Build summary
    summary = build_summary(enriched)

    # Write output
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    fires_path = DATA_DIR / "fires_latest.json"
    with open(fires_path, "w") as f:
        json.dump(enriched, f, separators=(",", ":"))
    print(f"\nWrote {len(enriched)} hotspots to {fires_path}")

    summary_path = DATA_DIR / "summary.json"
    with open(summary_path, "w") as f:
        json.dump(summary, f, indent=2)
    print(f"Wrote summary to {summary_path}")

    # Print summary
    print("\n--- Summary ---")
    print(f"Total hotspots: {summary['total_hotspots']}")
    print(f"  Likely wildfires: {summary['likely_wildfires']}")
    print(f"  Possible wildfires: {summary['possible_wildfires']}")
    print(f"  Thermal anomalies (agri burns etc.): {summary['thermal_anomalies']}")
    print(f"In protected areas: {summary['hotspots_in_protected_areas']}")
    if summary["top_provinces"]:
        print("Top provinces:")
        for p in summary["top_provinces"][:5]:
            print(f"  {p['province']}: {p['count']}")
    print(f"Last updated: {summary['last_updated']}")
    print("=" * 60)


if __name__ == "__main__":
    main()
