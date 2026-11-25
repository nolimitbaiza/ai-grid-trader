"""Render the Pitwall (F1 Constructor Performance Tracker) screenshots shown on the home page:
assets/img/f1-dashboard.png        wide screens: the headline numbers and the championship chart
assets/img/f1-dashboard-phone.png  phones (up to 640px): the championship chart card only

Pitwall has a single dark theme, so one image serves both site themes. The shots come from the
live demo on GitHub Pages. After running it, copy the printed sizes into the width/height
attributes of the Pitwall card's <source> and <img> in index.html.

Usage: python tools/build_f1_shot.py
Needs: pip install playwright pillow && python -m playwright install chromium
"""
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
URL = "https://nolimitbaiza.github.io/f1_constructor_performance_tracker/"
# (viewport width in CSS px, file name). Each region gets 8px of the page around it.
SHOTS = [(1280, "f1-dashboard.png"), (600, "f1-dashboard-phone.png")]
pad = 8

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    for width, name in SHOTS:
        page = browser.new_page(viewport={"width": width, "height": 1200}, device_scale_factor=2)
        page.goto(URL, wait_until="networkidle")
        page.wait_for_timeout(1500)                      # chart entrance animation
        if width >= 900:
            # From the top of the four headline numbers to the bottom of the points chart.
            top = page.locator("#view > *:first-child").bounding_box()
            chart = page.locator("#progress").bounding_box()
            view = page.locator("#view").bounding_box()
            clip = {"x": view["x"] - pad, "y": top["y"] - pad, "width": view["width"] + 2 * pad,
                    "height": chart["y"] + chart["height"] - top["y"] + 2 * pad}
        else:
            # The whole "Championship progression" card, legend included.
            card = page.locator("#progress").evaluate_handle("(e) => e.closest('.panel')").as_element().bounding_box()
            clip = {"x": card["x"] - pad, "y": card["y"] - pad, "width": card["width"] + 2 * pad,
                    "height": card["height"] + 2 * pad}
        out = ROOT / "assets" / "img" / name
        page.screenshot(path=str(out), clip=clip)
        # Palette PNG: the dashboard is a few flat colours, so this is a fraction of the size.
        Image.open(out).convert("RGB").quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(out, optimize=True)
        w, h = Image.open(out).size
        print(f"wrote assets/img/{name}: {w} x {h}, {out.stat().st_size // 1024} KB")
        page.close()
    browser.close()
