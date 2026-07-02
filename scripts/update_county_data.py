"""
Download real county-year indicators for the Housing Stability Planning Dashboard.

Primary source:
  U.S. Census Bureau American Community Survey 5-Year Detailed Tables.

Output:
  data/county_indicators.json
  data/metadata.json

Required:
  CENSUS_API_KEY environment variable, or --api-key argument.

Optional:
  data/basic_needs.csv can be used to merge outside basic-cost estimates.
  Expected columns: fips,year,basic_monthly_cost

Example:
  python scripts/update_county_data.py --start-year 2018 --end-year 2024
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
OUTPUT = DATA_DIR / "county_indicators.json"
BASIC_COSTS = DATA_DIR / "basic_needs.csv"

ACS_VARIABLES = {
    # Poverty status in the past 12 months by age
    "poverty_total": "B17001_001E",
    "poverty_count": "B17001_002E",
    # Employment status for population 16 years and over
    "labor_force": "B23025_003E",
    "unemployed": "B23025_005E",
    # Housing and income
    "median_gross_rent": "B25064_001E",
    "median_household_income": "B19013_001E",
    "occupied_units": "B25003_001E",
    "renter_occupied": "B25003_003E",
    # Gross rent as percentage of household income
    "rent_burden_total": "B25070_001E",
    "rent_50_54": "B25070_010E",
    "rent_55_plus": "B25070_011E",
}

SOURCE_NOTE = "U.S. Census Bureau ACS 5-Year Detailed Tables"


def safe_float(value: str | None) -> Optional[float]:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    # Census missing/annotation codes are often large negative values.
    if number < -100000:
        return None
    return number


def rate(numerator: Optional[float], denominator: Optional[float]) -> Optional[float]:
    if numerator is None or denominator is None or denominator <= 0:
        return None
    return numerator / denominator * 100


def fetch_json(url: str) -> list:
    req = urllib.request.Request(url, headers={"User-Agent": "housing-stability-dashboard/1.0"})
    with urllib.request.urlopen(req, timeout=90) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_acs_year(year: int, api_key: str) -> List[dict]:
    base = f"https://api.census.gov/data/{year}/acs/acs5"
    variable_list = ["NAME"] + list(ACS_VARIABLES.values())
    params = {
        "get": ",".join(variable_list),
        "for": "county:*",
        "in": "state:*",
        "key": api_key,
    }
    url = base + "?" + urllib.parse.urlencode(params)
    payload = fetch_json(url)
    if not payload or len(payload) < 2:
        return []

    headers = payload[0]
    records: List[dict] = []

    for row in payload[1:]:
        raw = dict(zip(headers, row))
        name = raw.get("NAME", "")
        if "," in name:
            county_name, state_name = [part.strip() for part in name.split(",", 1)]
        else:
            county_name, state_name = name.strip(), ""

        state_fips = str(raw.get("state", "")).zfill(2)
        county_fips = str(raw.get("county", "")).zfill(3)
        fips = f"{state_fips}{county_fips}"
        values = {key: safe_float(raw.get(var)) for key, var in ACS_VARIABLES.items()}

        poverty_rate = rate(values["poverty_count"], values["poverty_total"])
        unemployment_rate = rate(values["unemployed"], values["labor_force"])
        renter_share = rate(values["renter_occupied"], values["occupied_units"])
        severe_rent_burden_rate = rate(
            (values["rent_50_54"] or 0) + (values["rent_55_plus"] or 0),
            values["rent_burden_total"],
        )

        records.append(
            {
                "sample_data": False,
                "year": year,
                "state_fips": state_fips,
                "county_fips": county_fips,
                "fips": fips,
                "state_name": state_name,
                "county_name": county_name,
                "poverty_rate": round(poverty_rate, 2) if poverty_rate is not None else None,
                "unemployment_rate": round(unemployment_rate, 2) if unemployment_rate is not None else None,
                "median_gross_rent": values["median_gross_rent"],
                "median_household_income": values["median_household_income"],
                "renter_share": round(renter_share, 2) if renter_share is not None else None,
                "severe_rent_burden_rate": round(severe_rent_burden_rate, 2) if severe_rent_burden_rate is not None else None,
                "basic_monthly_cost": None,
                "source": SOURCE_NOTE,
            }
        )
    return records


def load_basic_costs() -> Dict[Tuple[str, int], float]:
    if not BASIC_COSTS.exists():
        return {}
    costs: Dict[Tuple[str, int], float] = {}
    with BASIC_COSTS.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        required = {"fips", "year", "basic_monthly_cost"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"data/basic_needs.csv is missing columns: {sorted(missing)}")
        for row in reader:
            fips = str(row["fips"]).zfill(5)
            try:
                year = int(row["year"])
            except ValueError:
                continue
            cost = safe_float(row.get("basic_monthly_cost"))
            if cost is not None:
                costs[(fips, year)] = round(cost, 2)
    return costs


def merge_basic_costs(records: Iterable[dict], costs: Dict[Tuple[str, int], float]) -> List[dict]:
    merged = []
    for record in records:
        record = dict(record)
        record["basic_monthly_cost"] = costs.get((record["fips"], int(record["year"])))
        merged.append(record)
    return merged


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start-year", type=int, default=2018)
    parser.add_argument("--end-year", type=int, default=2024)
    parser.add_argument("--api-key", type=str, default=os.getenv("CENSUS_API_KEY"))
    args = parser.parse_args()

    if not args.api_key:
        print(
            "ERROR: A Census API key is required. Add CENSUS_API_KEY as a GitHub repository secret, "
            "or run locally with --api-key YOUR_KEY.",
            file=sys.stderr,
        )
        return 2

    DATA_DIR.mkdir(exist_ok=True)
    all_records: List[dict] = []
    skipped_years: List[int] = []

    for year in range(args.start_year, args.end_year + 1):
        print(f"Fetching ACS {year} county data...")
        try:
            records = fetch_acs_year(year, args.api_key)
            if not records:
                raise RuntimeError("No records returned")
            print(f"  {len(records):,} county records")
            all_records.extend(records)
            time.sleep(0.4)
        except Exception as exc:
            print(f"  Skipped {year}: {exc}", file=sys.stderr)
            skipped_years.append(year)

    if not all_records:
        raise RuntimeError("No county records were downloaded. Check API key, year range, and Census API availability.")

    all_records = merge_basic_costs(all_records, load_basic_costs())
    all_records.sort(key=lambda d: (d["state_name"], d["county_name"], int(d["year"])))

    with OUTPUT.open("w", encoding="utf-8") as f:
        json.dump(all_records, f, separators=(",", ":"))
        f.write("\n")

    metadata = {
        "status": "real_data_loaded",
        "record_count": len(all_records),
        "year_range_requested": [args.start_year, args.end_year],
        "years_loaded": sorted({record["year"] for record in all_records}),
        "years_skipped": skipped_years,
        "updated_at_utc": datetime.now(timezone.utc).isoformat(),
        "sources": [
            SOURCE_NOTE,
            "Optional data/basic_needs.csv for local basic-needs costs if provided by the user",
        ],
        "variables": ACS_VARIABLES,
    }
    with (DATA_DIR / "metadata.json").open("w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)
        f.write("\n")

    print(f"Wrote {OUTPUT} with {len(all_records):,} real county-year records")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
