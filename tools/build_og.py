"""Render the 1200x630 link-preview images: assets/og.png (from the live demo) and
assets/og-case-study.png (a type-only card with the headline results).

Usage: serve the repo locally (python tools/serve.py), then
       python tools/build_og.py [http://localhost:8600/] [demo|case-study|all]
Needs: pip install playwright && python -m playwright install chromium
"""
import base64
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8600/"
WHICH = sys.argv[2] if len(sys.argv) > 2 else "all"

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

# Case study card: the headline and the three numbers from its results strip (keep them in step).
CASE = """<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: "Inter"; src: url(data:font/woff2;base64,{inter}) format("woff2"); font-weight: 100 900; }
  @font-face { font-family: "Mono"; src: url(data:font/woff2;base64,{mono}) format("woff2"); font-weight: 500; }
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; overflow: hidden; background: #fafaf9; color: #0c0a09;
         font-family: Inter, sans-serif; position: relative; padding: 60px 64px; }
  .kicker { font: 500 18px/1 Mono, monospace; letter-spacing: .08em; text-transform: uppercase; color: #78716c; }
  .kicker b { color: #047857; font-weight: 500; }
  h1 { font-size: 64px; line-height: 1.02; letter-spacing: -0.04em; font-weight: 700; margin-top: 26px; max-width: 900px; }
  h1 span { background: linear-gradient(#047857, #047857) left 92% / 100% 6px no-repeat; }
  .stats { position: absolute; left: 64px; right: 64px; bottom: 130px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
  .stat { padding: 22px 24px; border: 1px solid #e7e5e4; border-radius: 16px; background: #fff; }
  .stat b { display: block; font-size: 44px; font-weight: 650; letter-spacing: -0.03em; line-height: 1; }
  .stat b.neg { color: #78716c; }
  .stat span { display: block; margin-top: 10px; font-size: 18px; line-height: 1.35; color: #78716c; }
  .by { position: absolute; left: 64px; bottom: 50px; font-size: 20px; font-weight: 600; display: flex; align-items: center; gap: 14px; }
  .by img { width: 48px; height: 48px; border-radius: 50%; object-fit: cover; border: 1px solid #e7e5e4; }
  .by span { color: #78716c; font-weight: 400; }
  .bolt { position: absolute; right: 64px; bottom: 50px; width: 48px; height: 48px; border-radius: 13px; background: #0c0a09;
          color: #fff; display: grid; place-items: center; }
</style></head><body>
  <p class="kicker"><b>Case study</b> · AI Grid Trader</p>
  <h1>Teaching a grid battery <span>when not to trade</span>.</h1>
  <div class="stats">
    <div class="stat"><b>€2.54M</b><span>earned on a year of real German prices, after battery wear</span></div>
    <div class="stat"><b>93–95%</b><span>of the perfect-hindsight maximum, in three markets</span></div>
    <div class="stat"><b class="neg">−€0.55M</b><span>what a rule-based bot made on the same prices</span></div>
  </div>
  <div class="by">{avatar}<div>Baizak Isaev <span>· baizakisaev.com</span></div></div>
  <span class="bolt"><svg viewBox="0 0 24 24" width="24" height="24"><path d="M13.5 2 5 14h5.5L9 22l8.5-12H12z" fill="currentColor"/></svg></span>
</body></html>"""

b64 = lambda path: base64.b64encode(path.read_bytes()).decode()
photo = ROOT / "assets" / "img" / "profile.jpg"
avatar = f'<img src="data:image/jpeg;base64,{b64(photo)}">' if photo.exists() else ""

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    if WHICH in ("demo", "all"):
        page = browser.new_page(viewport={"width": 1100, "height": 900}, device_scale_factor=2, color_scheme="light")
        page.goto(URL + "ai-grid-trader#p=de", wait_until="networkidle")
        page.wait_for_timeout(800)
        shot = page.locator(".main-card").screenshot()
        card = browser.new_page(viewport={"width": 1200, "height": 630}, device_scale_factor=1)
        card.set_content(CARD.replace("{shot}", base64.b64encode(shot).decode()).replace("{avatar}", avatar))
        card.wait_for_timeout(300)
        card.screenshot(path=str(ROOT / "assets" / "og.png"))
        print("wrote assets/og.png")
    if WHICH in ("case-study", "all"):
        fonts = ROOT / "assets" / "fonts"
        html = (CASE.replace("{inter}", b64(fonts / "inter-latin-var.woff2"))
                    .replace("{mono}", b64(fonts / "jetbrains-mono-latin-500.woff2")).replace("{avatar}", avatar))
        card = browser.new_page(viewport={"width": 1200, "height": 630}, device_scale_factor=1)
        card.set_content(html)
        card.evaluate("document.fonts.ready")
        card.wait_for_timeout(300)
        card.screenshot(path=str(ROOT / "assets" / "og-case-study.png"))
        print("wrote assets/og-case-study.png")
    browser.close()
