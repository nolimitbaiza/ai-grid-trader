"""Render the 1200x630 link-preview image (assets/og.png) from the live demo.

Usage: serve the repo locally (python tools/serve.py), then
       python tools/build_og.py [http://localhost:8600/]
Needs: pip install playwright && python -m playwright install chromium
"""
import base64
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8600/"

CARD = """<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; overflow: hidden; background: #fafaf9; color: #0c0a09;
         font-family: Inter, "Segoe UI", -apple-system, Roboto, sans-serif; position: relative; }
  .text { position: absolute; left: 64px; top: 56px; width: 520px; }
  .brand { display: flex; align-items: center; gap: 12px; font-weight: 600; font-size: 22px; }
  .mark { width: 40px; height: 40px; border-radius: 11px; background: #0c0a09; color: #fff; display: grid; place-items: center; }
  h1 { font-size: 54px; line-height: 1.04; letter-spacing: -0.035em; font-weight: 700; margin-top: 40px; }
  p { color: #78716c; font-size: 22px; line-height: 1.4; margin-top: 22px; }
  .by { position: absolute; left: 64px; bottom: 48px; font-size: 20px; color: #0c0a09; font-weight: 600;
         display: flex; align-items: center; gap: 14px; }
  .by img { width: 48px; height: 48px; border-radius: 50%; object-fit: cover; border: 1px solid #e7e5e4; }
  .by span { color: #78716c; font-weight: 400; }
  .live { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #16a34a; margin-right: 10px;
          box-shadow: 0 0 0 5px rgba(22,163,74,.18); vertical-align: 2px; }
  .shot { position: absolute; left: 630px; top: 70px; width: 780px; border-radius: 18px; border: 1px solid #e7e5e4;
          box-shadow: 0 30px 60px rgba(0,0,0,.12); background: #fff; }
</style></head><body>
  <div class="text">
    <div class="brand"><span class="mark"><svg viewBox="0 0 24 24" width="21" height="21"><path d="M13.5 2 5 14h5.5L9 22l8.5-12H12z" fill="currentColor"/></svg></span>AI Grid Trader</div>
    <h1>An AI that trades a grid battery, and protects it.</h1>
    <p><span class="live"></span>Live demo on real market prices. Runs in your browser.</p>
  </div>
  <div class="by">{avatar}<div>Baizak Isaev <span>· baizakisaev.com</span></div></div>
  <img class="shot" src="data:image/png;base64,{shot}">
</body></html>"""

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={"width": 1100, "height": 900}, device_scale_factor=2, color_scheme="light")
    page.goto(URL + "ai-grid-trader#p=de", wait_until="networkidle")
    page.wait_for_timeout(800)
    shot = page.locator(".main-card").screenshot()
    card = browser.new_page(viewport={"width": 1200, "height": 630}, device_scale_factor=1)
    photo = ROOT / "assets" / "img" / "profile.jpg"
    avatar = f'<img src="data:image/jpeg;base64,{base64.b64encode(photo.read_bytes()).decode()}">' if photo.exists() else ""
    card.set_content(CARD.replace("{shot}", base64.b64encode(shot).decode()).replace("{avatar}", avatar))
    card.wait_for_timeout(300)
    card.screenshot(path=str(ROOT / "assets" / "og.png"))
    browser.close()
print("wrote assets/og.png")
