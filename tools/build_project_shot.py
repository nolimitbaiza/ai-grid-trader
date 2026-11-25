"""Render the AI Grid Trader stills shown on phones on the home page and the case study, one per theme:
assets/img/project-chart-phone.png and assets/img/project-chart-phone-dark.png (up to 640px wide):
    the 48-hour chart for Germany rendered at phone width with its legend, so the labels stay readable.
Wide screens show looping clips and their stills instead: the home page's card from
tools/build_demo_loop.py, the case study's figure from tools/build_demo_video.py.

After running it, copy the printed sizes into the width/height attributes of the matching <img>
and <source> elements in index.html and ai-grid-trader-case-study.html.

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
# (colour scheme, viewport width, device scale, file name)
SHOTS = [
    ("light", 600, 2, "project-chart-phone.png"),
    ("dark", 600, 2, "project-chart-phone-dark.png"),
]

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    for scheme, width, scale, name in SHOTS:
        page = browser.new_page(viewport={"width": width, "height": 1400}, device_scale_factor=scale,
                                color_scheme=scheme, service_workers="block",
                                reduced_motion="reduce")   # the still frame, not an entrance mid-way
        page.goto(URL + "ai-grid-trader#p=de", wait_until="networkidle")
        # The return-on-investment figure comes from the full-year simulation: wait for it.
        page.wait_for_function("!document.getElementById('stack').classList.contains('pending')", timeout=180000)
        chart = page.locator("#chart-main").bounding_box()
        if width >= 900:
            page.wait_for_timeout(500)
            top = page.locator("#kpis").bounding_box()
            # From just above the numbers to the bottom of the chart, as wide as the chart (which
            # overhangs the card's text column by a few pixels on each side).
            clip = {"x": chart["x"], "y": top["y"] - 4, "width": chart["width"],
                    "height": chart["y"] + chart["height"] - top["y"] + 4}
        else:
            # Phone: the legend and the chart. The Forecast / Perfect hindsight switch is hidden,
            # because in a picture it would look like a control.
            page.add_style_tag(content=".chart-head .seg { display: none !important; }")
            page.wait_for_timeout(800)                   # the chart re-fits after the layout change
            chart = page.locator("#chart-main").bounding_box()
            head = page.locator(".chart-head").first.bounding_box()
            clip = {"x": chart["x"], "y": head["y"] - 4, "width": chart["width"],
                    "height": chart["y"] + chart["height"] - head["y"] + 4}
        out = ROOT / "assets" / "img" / name
        page.screenshot(path=str(out), clip=clip)
        w, h = struct.unpack(">II", out.read_bytes()[16:24])     # PNG header
        print(f"wrote assets/img/{name}: {w} x {h}")
        page.close()
    browser.close()
