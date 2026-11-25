"""WebP copies of the phone stills and Pitwall screenshots and a small avatar for the header.

The pages offer the .webp first (<source type="image/webp">) and keep the .png as the fallback.
Lossless, so the charts' text stays exactly as sharp: about 45% smaller than the PNGs.
Re-run after rebuilding any of them (build_project_shot.py, build_f1_shot.py):

    python tools/build_webp.py
"""
from pathlib import Path
from PIL import Image

IMG = Path(__file__).resolve().parent.parent / "assets" / "img"
SHOTS = ["project-chart-phone", "project-chart-phone-dark", "f1-dashboard", "f1-dashboard-phone"]

for name in SHOTS:
    src, out = IMG / f"{name}.png", IMG / f"{name}.webp"
    Image.open(src).save(out, "WEBP", lossless=True, method=6)
    print(f"{out.name}: {src.stat().st_size // 1024} kB -> {out.stat().st_size // 1024} kB")

# The header avatar shows at 28px (64px covers 2x screens); the hero's 52px one keeps profile.jpg.
photo = Image.open(IMG / "profile.jpg").convert("RGB")
small = photo.resize((64, 64), Image.LANCZOS)
small.save(IMG / "profile-64.jpg", "JPEG", quality=85, optimize=True, progressive=True)
print(f"profile-64.jpg: {(IMG / 'profile-64.jpg').stat().st_size} bytes")
