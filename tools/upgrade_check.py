"""Release-upgrade check: a returning visitor must get a new release, not old cached files.

Emulates the live setup's worst case: every response says "keep for 4 hours" (what Cloudflare tells
browsers). Publishes build 1001, visits both pages, publishes build 1002 with a changed stylesheet,
visits again and expects the new stylesheet without a manual refresh.

Usage: python tools/upgrade_check.py [repo_dir] [work_dir]
Needs: pip install playwright && python -m playwright install chromium
"""
import http.server, os, shutil, sys, threading, time
from functools import partial
from pathlib import Path
from playwright.sync_api import sync_playwright

import tempfile
REPO = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
WORK = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(tempfile.mkdtemp(prefix="agt-upgrade-")); SITE = WORK / "site"; PROFILE = WORK / "profile"
FILES = ["index.html", "ai-grid-trader.html", "about.html", "manifest.webmanifest", "sw.js", "assets"]

def deploy(build, marker):
    if SITE.exists(): shutil.rmtree(SITE)
    SITE.mkdir(parents=True)
    for f in FILES:
        (shutil.copytree if (REPO / f).is_dir() else shutil.copy)(REPO / f, SITE / f)
    for f in ["index.html", "ai-grid-trader.html", "sw.js", "assets/app.js"]:
        p = SITE / f; p.write_text(p.read_text(encoding="utf-8").replace("__BUILD__", build), encoding="utf-8")
    css = SITE / "assets/style.css"; css.write_text(css.read_text(encoding="utf-8") + f"\n:root {{ --deploy-marker: {marker}; }}\n", encoding="utf-8")

class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        local = super().translate_path(path)
        return local + ".html" if not os.path.exists(local) and os.path.exists(local + ".html") else local
    def end_headers(self):
        self.send_header("Cache-Control", "public, max-age=14400")   # what Cloudflare tells browsers
        super().end_headers()
    def log_message(self, *a): pass

if PROFILE.exists(): shutil.rmtree(PROFILE)
deploy("1001", 1)
srv = http.server.ThreadingHTTPServer(("", 8611), partial(H, directory=str(SITE)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://localhost:8611/"
marker = "getComputedStyle(document.documentElement).getPropertyValue('--deploy-marker').trim()"
centred = "(() => { const r = document.querySelector('.about-hero h1').getBoundingClientRect(); return Math.abs((r.left + r.right) / 2 - innerWidth / 2) < 2; })()"
ok = True
with sync_playwright() as pw:
    ctx = pw.chromium.launch_persistent_context(str(PROFILE), viewport={"width": 1280, "height": 900})
    p = ctx.new_page()
    p.goto(URL, wait_until="networkidle"); p.evaluate("navigator.serviceWorker.ready"); p.wait_for_timeout(1500)
    p.goto(URL + "ai-grid-trader", wait_until="networkidle"); p.wait_for_timeout(800)
    p.goto(URL, wait_until="networkidle")
    print("visit 1 (build 1001): marker", p.evaluate(marker), "| controlled:", p.evaluate("!!navigator.serviceWorker.controller"))
    deploy("1002", 2)                                    # publish a new version
    for page in ["", "ai-grid-trader"]:
        p.goto(URL + page, wait_until="networkidle")
        deadline = time.time() + 15
        def read():
            try: return p.evaluate(marker)
            except Exception: p.wait_for_load_state("networkidle"); return None
        while time.time() < deadline and read() != "2":
            p.wait_for_timeout(500)
        p.wait_for_load_state("networkidle"); p.wait_for_timeout(500)
        m = p.evaluate(marker)
        extra = f" | hero centred: {p.evaluate(centred)}" if page == "" else f" | chart drawn: {p.locator('#chart-main .main-svg').count() > 0}"
        print(f"after deploy, /{page}: marker {m}{extra}")
        ok &= m == "2"
    ctx.close()
srv.shutdown()
print("UPGRADE OK" if ok else "UPGRADE FAILED")
sys.exit(0 if ok else 1)
