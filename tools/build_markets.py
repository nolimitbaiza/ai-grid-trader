"""Build assets/data/: a full calendar year of real prices per market, 15-minute steps.
  markets.js          index (names, sources, dates, default window), loaded with the page
  prices-<market>.js  the prices, loaded only when that market is opened

Usage: python tools/build_markets.py <download_dir> [assets/data] [--year 2025]
       (tools/fetch_data.py downloads everything below)

Downloads expected in <download_dir> (all public):
  Germany (Energy-Charts / SMARD, CC BY 4.0), one file per quarter:
    de_2025-01-01.json  https://api.energy-charts.info/price?bzn=DE-LU&start=2025-01-01&end=2025-03-31
    de_2025-04-01.json  ...&start=2025-04-01&end=2025-06-30
    de_2025-07-01.json  ...&start=2025-07-01&end=2025-09-30
    de_2025-10-01.json  ...&start=2025-10-01&end=2026-01-01
  South Australia (AEMO), one file per month:
    sa_01.csv ... sa_12.csv  https://aemo.com.au/aemo/data/nem/priceanddemand/PRICE_AND_DEMAND_2025MM_SA1.csv
  California (CAISO OASIS, SP15 hub, day-ahead), any number of zips covering 2025 (each request < 31 days):
    caiso_*.zip  https://oasis.caiso.com/oasisapi/SingleZip?queryname=PRC_LMP&startdatetime=20250101T08:00-0000
                 &enddatetime=20250201T08:00-0000&version=1&market_run_id=DAM&node=TH_SP15_GEN-APND&resultformat=6

Times are converted to each market's *standard* time all year (no daylight-saving jumps), so every
day has exactly 96 quarter-hours. Germany switched from hourly to 15-minute day-ahead prices on
1 Oct 2025; hourly prices are repeated across their four quarter-hours.
"""
import csv
import glob
import io
import json
import sys
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

ARGS = [a for i, a in enumerate(sys.argv[1:], 1) if not a.startswith("--") and sys.argv[i - 1] != "--year"]
SRC = Path(ARGS[0])
OUT_DIR = Path(ARGS[1]) if len(ARGS) > 1 else Path(__file__).resolve().parent.parent / "assets" / "data"
YEAR = int(sys.argv[sys.argv.index("--year") + 1]) if "--year" in sys.argv else 2025
START = datetime(YEAR, 1, 1)
STEPS = 365 * 96                     # 365 days (in a leap year, 31 December is left out)
Q = timedelta(minutes=15)


def to_grid(points):
    """points: list of (naive standard-time start, price, minutes). Returns 35,040 quarter-hour prices + fill count."""
    buckets = {}
    for ts, price, minutes in points:
        for k in range(max(1, minutes // 15)):                    # coarse data: repeat per quarter-hour
            t = ts + k * Q
            buckets.setdefault(t - timedelta(minutes=t.minute % 15), []).append(price)
    grid, filled, last = [], 0, None
    for i in range(STEPS):
        t = START + i * Q
        if t in buckets:
            last = sum(buckets[t]) / len(buckets[t])
        else:
            filled += 1
            if last is None:                                      # leading gap: use the first value
                last = next(sum(v) / len(v) for k, v in sorted(buckets.items()) if k >= START)
        grid.append(round(last, 1))
    return grid, filled


def typical_day(grid):
    """Start day of the median-spread 48-hour window: a representative default, not a cherry-picked one."""
    spreads = []
    for d in range(364):
        w = grid[d * 96:(d + 2) * 96]
        spreads.append((max(w) - min(w), d))
    spreads.sort()
    return spreads[len(spreads) // 2][1]


markets = {}

# ---- Germany: Energy-Charts, unix seconds -> CET (UTC+1) standard time
points = []
for f in sorted(glob.glob(str(SRC / "de_*.json"))):
    js = json.load(open(f))
    ts = js["unix_seconds"]
    for i, (t, p) in enumerate(zip(ts, js["price"])):
        if p is None:
            continue
        step = (ts[i + 1] - t) // 60 if i + 1 < len(ts) else (t - ts[i - 1]) // 60
        local = datetime.fromtimestamp(t, timezone.utc).replace(tzinfo=None) + timedelta(hours=1)
        points.append((local, p, int(step)))
grid, filled = to_grid(points)
markets["de"] = dict(label="Germany", name="Germany-Luxembourg day-ahead", currency="€", unit="EUR/MWh",
                     tz="CET, UTC+1 all year", source="Bundesnetzagentur | SMARD.de via Energy-Charts (CC BY 4.0)")
markets["de"].update(start=START.strftime("%Y-%m-%d %H:%M"), year=YEAR, typical=typical_day(grid), prices=grid)
print("de", len(points), "points, filled", filled, "min", min(grid), "max", max(grid))

# ---- South Australia: AEMO 5-minute dispatch prices, market time AEST (UTC+10, no DST), interval-ending
points = []
for f in sorted(glob.glob(str(SRC / "sa_*.csv"))):
    for r in csv.DictReader(open(f)):
        end = datetime.strptime(r["SETTLEMENTDATE"], "%Y/%m/%d %H:%M:%S")
        points.append((end - timedelta(minutes=5), float(r["RRP"]), 5))
grid, filled = to_grid(points)
markets["sa"] = dict(label="South Australia", name="NEM South Australia (SA1) spot", currency="A$", unit="AUD/MWh",
                     tz="AEST market time, UTC+10", source="Australian Energy Market Operator (AEMO)")
markets["sa"].update(start=START.strftime("%Y-%m-%d %H:%M"), year=YEAR, typical=typical_day(grid), prices=grid)
print("sa", len(points), "points, filled", filled, "min", min(grid), "max", max(grid))

# ---- California: CAISO OASIS day-ahead hourly LMP, GMT -> PST (UTC-8) standard time
points, seen = [], set()
for f in sorted(glob.glob(str(SRC / "caiso_*.zip"))):
    z = zipfile.ZipFile(f)
    name = z.namelist()[0]
    if not name.endswith(".csv"):
        print("  skipping (not data):", f)
        continue
    for r in csv.DictReader(io.TextIOWrapper(z.open(name))):
        if r["LMP_TYPE"] != "LMP" or r["INTERVALSTARTTIME_GMT"] in seen:
            continue
        seen.add(r["INTERVALSTARTTIME_GMT"])
        t = datetime.fromisoformat(r["INTERVALSTARTTIME_GMT"].replace("Z", "+00:00")).astimezone(timezone.utc).replace(tzinfo=None)
        points.append((t - timedelta(hours=8), float(r["MW"]), 60))
grid, filled = to_grid(points)
markets["caiso"] = dict(label="California", name="CAISO SP15 trading hub, day-ahead", currency="$", unit="USD/MWh",
                        tz="PST, UTC−8 all year", source="California ISO OASIS")
markets["caiso"].update(start=START.strftime("%Y-%m-%d %H:%M"), year=YEAR, typical=typical_day(grid), prices=grid)
print("caiso", len(points), "points, filled", filled, "min", min(grid), "max", max(grid))

order = ["caiso", "de", "sa"]
# Written as a small index (loaded with the page) plus one price file per market, which the page
# loads only when that market is opened.
OUT_DIR.mkdir(parents=True, exist_ok=True)
index = {}
for k in order:
    meta = {f: v for f, v in markets[k].items() if f != "prices"}
    meta["days"] = len(markets[k]["prices"]) // 96
    meta["prices"] = None
    index[k] = meta
    with open(OUT_DIR / f"prices-{k}.js", "w", encoding="utf-8") as f:
        f.write(f"/* {markets[k]['name']}, {YEAR}, 15-minute prices ({markets[k]['unit']}). Source: {markets[k]['source']}.\n")
        f.write("   Generated by tools/build_markets.py; loaded by the page when this market is opened. */\n")
        f.write(f"window.GRID_MARKETS.{k}.prices = " + json.dumps(markets[k]["prices"], separators=(",", ":")) + ";\n")
with open(OUT_DIR / "markets.js", "w", encoding="utf-8") as f:
    f.write(f"/* Real wholesale prices for calendar year {YEAR}, 15-minute steps, standard time: the index.\n")
    f.write("   Prices are in prices-<market>.js. Generated by tools/build_markets.py. */\n")
    f.write("window.GRID_MARKETS = " + json.dumps(index, ensure_ascii=False, separators=(",", ":")) + ";\n")
for p in sorted(OUT_DIR.glob("*.js")):
    print("wrote", p, f"{p.stat().st_size / 1024:.0f} KB")
