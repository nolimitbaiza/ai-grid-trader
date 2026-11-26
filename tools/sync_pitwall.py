"""Copy the Pitwall dashboard into pitwall/, which the site serves at /pitwall/.

Pitwall lives in its own repository (nolimitbaiza/f1_constructor_performance_tracker), whose
docs/ folder is the finished static app; that repository downloads new race results after
every race weekend. This copies only the files the app needs, so baizakisaev.com/pitwall/ shows
the same app and data. The "Sync Pitwall" workflow runs it every day.

Usage: python tools/sync_pitwall.py <checkout of the Pitwall repository>
"""
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "pitwall"
# The app, its data, the monthly explorer and the vendored chart library (with its licence).
FILES = [
    "index.html", "app.css", "app.js", "analytics.js", "logo.svg", "data.json",
    "monthly.html", "f1_data.csv", "vendor/chart.umd.js", "vendor/chart.LICENSE.md",
]


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    source = Path(sys.argv[1]) / "docs"
    missing = [name for name in FILES if not (source / name).is_file()]
    if missing:
        sys.exit(f"Not a Pitwall checkout, or files were renamed: missing {', '.join(missing)}")
    changed = []
    for name in FILES:
        new, old = source / name, TARGET / name
        if not old.is_file() or old.read_bytes() != new.read_bytes():
            old.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(new, old)
            changed.append(name)
    # Remove files the app no longer uses, so nothing stale is published.
    for path in sorted(TARGET.rglob("*"), reverse=True):
        relative = path.relative_to(TARGET).as_posix()
        if path.is_file() and relative not in FILES:
            path.unlink()
            changed.append(f"{relative} (removed)")
        elif path.is_dir() and not any(path.iterdir()):
            path.rmdir()
    print("Updated: " + ", ".join(changed) if changed else "Pitwall is already up to date.")


if __name__ == "__main__":
    main()
