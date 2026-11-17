"""Render the project screenshots shown on the home page, one per theme:
assets/img/project-chart.png (light) and assets/img/project-chart-dark.png (dark).

Each shows the demo's headline numbers and 48-hour chart for Germany. After running it, copy the
printed size into the width/height attributes of the two images in index.html.

Usage: serve the repo locally (python tools/serve.py), then
       python tools/build_project_shot.py [http://localhost:8600/]
Needs: pip install playwright && python -m playwright install chromium
"""
import struct
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8600/"
SHOTS = {"light": "project-chart.png", "dark": "project-chart-dark.png"}

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    for scheme, name in SHOTS.items():
        page = browser.new_page(viewport={"width": 1120, "height": 1400}, device_scale_factor=1.5,
                                color_scheme=scheme, service_workers="block")
        page.goto(URL + "ai-grid-trader#p=de", wait_until="networkidle")
        # The return-on-investment figure comes from the full-year simulation: wait for it.
        page.wait_for_function("!document.getElementById('stack').classList.contains('pending')", timeout=180000)
        page.wait_for_timeout(500)
        top = page.locator("#kpis").bounding_box()
        chart = page.locator("#chart-main").bounding_box()
        # From just above the numbers to the bottom of the chart, as wide as the chart (which
        # overhangs the card's text column by a few pixels on each side).
        clip = {"x": chart["x"], "y": top["y"] - 4, "width": chart["width"],
                "height": chart["y"] + chart["height"] - top["y"] + 4}
        out = ROOT / "assets" / "img" / name
        page.screenshot(path=str(out), clip=clip)
        width, height = struct.unpack(">II", out.read_bytes()[16:24])     # PNG header
        print(f"wrote assets/img/{name}: {width} x {height}")
        page.close()
    browser.close()
