"""Download one calendar year of public market data for the demo.

Usage: python tools/fetch_data.py <download_dir> --year 2025 [--skip-services]

Writes into <download_dir> exactly the files tools/build_markets.py and tools/build_services.py
read. Files already downloaded are kept, so an interrupted run can simply be started again.
Only the Python standard library is needed. Takes roughly 20-40 minutes, mostly because the
California and German services are queried in small pieces with pauses between requests.
"""
import sys
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

ARGS = [a for i, a in enumerate(sys.argv[1:], 1) if not a.startswith("--") and sys.argv[i - 1] != "--year"]
OUT = Path(ARGS[0])
YEAR = int(sys.argv[sys.argv.index("--year") + 1]) if "--year" in sys.argv else date.today().year - 1
SERVICES = "--skip-services" not in sys.argv
UA = {"User-Agent": "Mozilla/5.0 (compatible; ai-grid-trader-data/1.0)"}
OUT.mkdir(parents=True, exist_ok=True)
(OUT / "de").mkdir(exist_ok=True)
stats = {"new": 0, "kept": 0, "failed": []}


def get(url, name, pause=0.0, check=None):
    path = OUT / name
    if path.exists() and path.stat().st_size > 0:
        stats["kept"] += 1
        return
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
                data = r.read()
            if check and not check(data):
                raise ValueError("unexpected content")
            path.write_bytes(data)
            stats["new"] += 1
            time.sleep(pause)
            return
        except (urllib.error.URLError, TimeoutError, ValueError, ConnectionError) as e:
            time.sleep(5 * (attempt + 1) + pause)
            err = e
    stats["failed"].append(f"{name}: {err}")
    print("  FAILED", name, err, flush=True)


is_zip = lambda d: d[:2] == b"PK"
is_csv = lambda d: b"SETTLEMENTDATE" in d[:500]
is_json = lambda d: d[:1] == b"{" and b"unix_seconds" in d[:200]


def caiso_ranges(days):
    """CAISO OASIS accepts at most 31 days per request; times are GMT (midnight PST = 08:00)."""
    t, end = datetime(YEAR, 1, 1, 8), datetime(YEAR + 1, 1, 1, 8)
    while t < end:
        e = min(t + timedelta(days=days), end)
        yield t, e
        t = e


def oasis(query, extra, t, e):
    return (f"https://oasis.caiso.com/oasisapi/SingleZip?queryname={query}&startdatetime={t:%Y%m%dT%H:%M}-0000"
            f"&enddatetime={e:%Y%m%dT%H:%M}-0000&version=1&{extra}&resultformat=6")


print(f"Downloading {YEAR} into {OUT}", flush=True)

# ---- Energy prices (tools/build_markets.py)
print("Germany day-ahead prices (Energy-Charts)", flush=True)
for q, (start, end) in enumerate([(f"{YEAR}-01-01", f"{YEAR}-03-31"), (f"{YEAR}-04-01", f"{YEAR}-06-30"),
                                  (f"{YEAR}-07-01", f"{YEAR}-09-30"), (f"{YEAR}-10-01", f"{YEAR + 1}-01-01")]):
    get(f"https://api.energy-charts.info/price?bzn=DE-LU&start={start}&end={end}", f"de_{start}.json", 2, is_json)

print("South Australia spot prices (AEMO)", flush=True)
for m in range(1, 13):
    get(f"https://aemo.com.au/aemo/data/nem/priceanddemand/PRICE_AND_DEMAND_{YEAR}{m:02d}_SA1.csv", f"sa_{m:02d}.csv", 1, is_csv)

print("California day-ahead prices (CAISO OASIS)", flush=True)
for t, e in caiso_ranges(15):
    get(oasis("PRC_LMP", "market_run_id=DAM&node=TH_SP15_GEN-APND", t, e), f"caiso_{t:%Y%m%d}.zip", 6, is_zip)

if SERVICES:
    # ---- Grid-services prices (tools/build_services.py)
    print("California ancillary services (CAISO OASIS)", flush=True)
    for t, e in caiso_ranges(30):
        for prod in ("RU", "RD", "SR", "NR"):
            get(oasis("PRC_AS", f"market_run_id=DAM&anc_type={prod}&anc_region=AS_CAISO_EXP", t, e),
                f"cas_{prod}_{t:%Y%m%d}.zip", 6, is_zip)

    print("South Australia FCAS (AEMO MMSDM archive)", flush=True)
    for m in range(1, 13):
        get(f"https://nemweb.com.au/Data_Archive/Wholesale_Electricity/MMSDM/{YEAR}/MMSDM_{YEAR}_{m:02d}/"
            f"MMSDM_Historical_Data_SQLLoader/DATA/PUBLIC_ARCHIVE%23DISPATCHPRICE%23FILE01%23{YEAR}{m:02d}010000.zip",
            f"aemo_{m:02d}.zip", 1, is_zip)

    print("Germany FCR and aFRR (regelleistung.net)", flush=True)
    d = date(YEAR, 1, 1)
    while d.year == YEAR:
        for prod in ("FCR", "aFRR"):
            get(f"https://www.regelleistung.net/apps/crds/api/v2/tenders/results/aggregated?deliveryDate={d}"
                f"&productType={prod}&market=CAPACITY&exportFormat=xlsx", f"de/{prod}_{d}.xlsx", 0.3, is_zip)
        d += timedelta(days=1)

print(f"Done: {stats['new']} downloaded, {stats['kept']} already there, {len(stats['failed'])} failed", flush=True)
sys.exit(1 if stats["failed"] else 0)
