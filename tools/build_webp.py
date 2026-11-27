"""WebP copies of the phone stills (the AI Grid Trader chart on the home page and the case study).

The pages offer the .webp first (<source type="image/webp">) and keep the .png as the fallback.
Lossless, so the charts' text stays exactly as sharp: about 45% smaller than the PNGs.
Re-run after rebuilding them (build_project_shot.py):

    python tools/build_webp.py
"""
from pathlib import Path
from PIL import Image

IMG = Path(__file__).resolve().parent.parent / "assets" / "img"
SHOTS = ["project-chart-phone", "project-chart-phone-dark"]

for name in SHOTS:
    src, out = IMG / f"{name}.png", IMG / f"{name}.webp"
    Image.open(src).save(out, "WEBP", lossless=True, method=6)
    print(f"{out.name}: {src.stat().st_size // 1024} kB -> {out.stat().st_size // 1024} kB")
