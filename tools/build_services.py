"""2025 average grid-services (reserve) prices per market, used as the demo's default
"Grid services price" (per MW of reserved power per hour).

Usage: python tools/build_services.py <download_dir>

Downloads expected in <download_dir> (all public):
  California (CAISO OASIS, day-ahead ancillary services, system region), each request < 31 days:
    cas_<RU|RD|SR|NR>_<yyyymmdd>.zip
      https://oasis.caiso.com/oasisapi/SingleZip?queryname=PRC_AS&startdatetime=20250101T08:00-0000
      &enddatetime=20250131T08:00-0000&version=1&market_run_id=DAM&anc_type=RU&anc_region=AS_CAISO_EXP&resultformat=6
  Germany (regelleistung.net, the German TSOs' tender platform), one file per day and product:
    de/FCR_2025-01-01.xlsx   https://www.regelleistung.net/apps/crds/api/v2/tenders/results/aggregated
    de/aFRR_2025-01-01.xlsx    ?deliveryDate=2025-01-01&productType=FCR&market=CAPACITY&exportFormat=xlsx
  South Australia (AEMO NEMweb, MMSDM monthly archive, 5-minute dispatch prices incl. FCAS):
    aemo_01.zip ... aemo_12.zip
      https://nemweb.com.au/Data_Archive/Wholesale_Electricity/MMSDM/2025/MMSDM_2025_01/
      MMSDM_Historical_Data_SQLLoader/DATA/PUBLIC_ARCHIVE%23DISPATCHPRICE%23FILE01%23202501010000.zip

Products a battery can sell with the same reserved megawatt at the same time:
  California:      regulation up + regulation down (capacity payments only; mileage not included)
  Germany:         FCR (symmetric, one price per 4-hour block); aFRR shown for comparison
  South Australia: the six contingency FCAS markets (raise and lower, 6 s / 60 s / 5 min).
                   The 1-second and regulation markets are left out: they are small and their
                   averages are dominated by a handful of extreme price events.
"""
import csv
import glob
import io
import statistics
import sys
import warnings
import zipfile
from pathlib import Path

warnings.filterwarnings("ignore")
SRC = Path(sys.argv[1])


def caiso():
    out = {}
    for prod in ("RU", "RD", "SR", "NR"):
        vals, seen = [], set()
        for f in sorted(glob.glob(str(SRC / f"cas_{prod}_*.zip"))):
            z = zipfile.ZipFile(f)
            for r in csv.DictReader(io.TextIOWrapper(z.open(z.namelist()[0]))):
                if r.get("ANC_REGION") != "AS_CAISO_EXP" or r["INTERVALSTARTTIME_GMT"] in seen:
                    continue
                seen.add(r["INTERVALSTARTTIME_GMT"])
                vals.append(float(r["MW"]))
        out[prod] = (statistics.mean(vals), statistics.median(vals), len(vals))
    return out


def germany():
    import openpyxl
    out = {}
    for prod in ("FCR", "aFRR"):
        vals = {}
        for f in sorted(glob.glob(str(SRC / "de" / f"{prod}_*.xlsx"))):
            rows = list(openpyxl.load_workbook(f).active.iter_rows(values_only=True))
            head = rows[0]
            if prod == "FCR":
                col = head.index("GERMANY_SETTLEMENTCAPACITY_PRICE_[EUR/MW]")
                for r in rows[1:]:
                    if isinstance(r[col], (int, float)):                      # "-" = no result
                        vals.setdefault("FCR", []).append(float(r[col]) / 4)   # per 4-hour block -> per hour
            else:
                col = head.index("GERMANY_AVERAGE_CAPACITY_PRICE_[(EUR/MW)/h]")
                for r in rows[1:]:
                    if isinstance(r[col], (int, float)):
                        vals.setdefault(r[3][:3], []).append(float(r[col]))    # POS / NEG
        for k, v in vals.items():
            out[k] = (statistics.mean(v), statistics.median(v), len(v))
    return out


def australia():
    cols, vals = None, {}
    for f in sorted(glob.glob(str(SRC / "aemo_*.zip"))):
        z = zipfile.ZipFile(f)
        for line in csv.reader(io.TextIOWrapper(z.open(z.namelist()[0]))):
            if line[0] == "I":
                cols = line
                continue
            if line[0] != "D" or line[6] != "SA1" or line[8] != "0":
                continue
            r = dict(zip(cols, line))
            for k, v in r.items():
                if k.endswith("RRP") and k != "RRP" and v:
                    vals.setdefault(k[:-3], []).append(float(v))
    return {k: (statistics.mean(v), statistics.median(v), len(v)) for k, v in vals.items()}


def show(name, d):
    print(f"\n{name}  (mean / median per MW per hour, n)")
    for k, (m, med, n) in d.items():
        print(f"  {k:12s} {m:8.2f} {med:8.2f} {n:7d}")


ca, de, sa = caiso(), germany(), australia()
show("California, CAISO day-ahead ($)", ca)
show("Germany ( EUR)", de)
show("South Australia SA1 (A$)", sa)
cont = ["RAISE6SEC", "RAISE60SEC", "RAISE5MIN", "LOWER6SEC", "LOWER60SEC", "LOWER5MIN"]
print("\nDefaults:")
print(f"  California regulation up + down: {ca['RU'][0] + ca['RD'][0]:.1f} $/MW/h")
print(f"  Germany FCR:                     {de['FCR'][0]:.1f} EUR/MW/h   (aFRR up + down: {de['POS'][0] + de['NEG'][0]:.1f})")
print(f"  South Australia contingency FCAS: {sum(sa[k][0] for k in cont):.1f} A$/MW/h")
