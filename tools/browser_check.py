"""Cross-browser smoke test: Chromium, Firefox, WebKit (Safari's engine) and an iPad.

Usage: serve the repo locally (python tools/serve.py), then
       python tools/browser_check.py [http://localhost:8600/] [screenshot_dir] [chromium,firefox,webkit,ipad,offline]
Needs: pip install playwright && python -m playwright install chromium firefox webkit
Exit code is non-zero if any check fails.
"""
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8600/"
SHOTS = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(tempfile.gettempdir()) / "agt-shots"
SHOTS.mkdir(parents=True, exist_ok=True)
CSV = "timestamp,price_eur_mwh\n" + "".join(
    f"2025-06-{2 + h // 24:02d} {h % 24:02d}:00,{40 + 30 * ((h % 24) in range(17, 21)) - 25 * ((h % 24) in range(11, 15))}\n"
    for h in range(24 * 4))
failures = []


def check(name, ok, detail=""):
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{'  ' + detail if detail else ''}")
    if not ok:
        failures.append(name)


def run(pw, label, browser_type, **ctx):
    print(f"\n== {label}")
    browser = browser_type.launch()
    context = browser.new_context(service_workers="block", **ctx)
    context.add_init_script("window.print = () => { window.__printed = true; };")
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: m.type == "error" and "profile.jpg" not in m.text and "404" not in m.text and errors.append(m.text))
    page.goto(URL + "ai-grid-trader", wait_until="networkidle")

    kpis = page.locator("#kpis .value").all_inner_texts()
    check("page renders 5 headline numbers", len(kpis) == 5 and all(kpis), " | ".join(kpis))
    check("main chart drawn", page.locator("#chart-main .main-svg").count() > 0)

    pts = page.locator("#chart-main .scatterlayer .trace .points path")
    if pts.count():
        pts.nth(min(3, pts.count() - 1)).click(force=True)
        page.wait_for_timeout(400)
    check("clicking a trade opens 'Why this trade?'", page.is_visible("#explain") and "MW" in page.inner_text("#explain-body"))

    page.click(".chip[data-key=de]")          # loads Germany's prices on demand
    try:
        page.wait_for_function("document.querySelector('#kpis .value').textContent.includes('€')", timeout=15000)
    except Exception:
        pass
    check("real market (Germany) loads", "€" in page.locator("#kpis .value").first.inner_text())
    check("source line shows data provenance", "SMARD" in page.inner_text("#source"))
    try:
        page.wait_for_function("!document.getElementById('stack').classList.contains('pending')"
                               " && document.getElementById('life-kpis').children.length === 4", timeout=180000)
        ok = True
    except Exception:
        ok = False
    check("full-year simulation finishes (revenue streams + lifetime)", ok)
    if ok:
        check("revenue streams total shown", "Total per year" in page.inner_text("#stack-table"))
        life = page.locator("#life-kpis .value").all_inner_texts()
        check("lifetime figures shown", len(life) == 4 and all(life), " | ".join(life))
        check("lifetime charts drawn", page.locator("#chart-health .main-svg").count() > 0 and page.locator("#chart-cash .main-svg").count() > 0)

    page.click("#explain-first")                  # keyboard-friendly route to "Why this trade?"
    page.wait_for_timeout(300)
    check("'explain the first trade' button works", page.is_visible("#explain") and "trades" in page.inner_text("#explain-body"))
    if label.startswith("Chromium"):
        # Automated accessibility audit (axe-core: contrast, labels, roles, ...), both themes.
        page.add_script_tag(url="https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js")
        audit = "async () => (await axe.run(document, {resultTypes: ['violations']})).violations.map(v => v.id + ' x' + v.nodes.length)"
        for theme in ("light", "dark"):
            page.evaluate(f"document.documentElement.setAttribute('data-theme', '{theme}')")
            page.wait_for_timeout(500)
            found = page.evaluate(audit)
            check(f"no accessibility violations ({theme} theme)", not found, ", ".join(found))
        page.evaluate("document.documentElement.removeAttribute('data-theme')")

    page.click(".seg button[data-mode=hindsight]")
    page.wait_for_timeout(300)
    check("hindsight switch works", page.locator("#kpis .value").nth(2).inner_text() == "100%")
    page.click(".seg button[data-mode=forecast]")

    before = page.evaluate("getComputedStyle(document.body).backgroundColor")
    page.click("#btn-theme")
    try:   # the colour change is a short CSS transition
        page.wait_for_function(f"getComputedStyle(document.body).backgroundColor !== '{before}'", timeout=3000)
    except Exception:
        pass
    after = page.evaluate("getComputedStyle(document.body).backgroundColor")
    check("light/dark switch changes theme", before != after, f"{before} -> {after}")

    page.set_input_files("#file-input", files=[{"name": "prices.csv", "mimeType": "text/csv", "buffer": CSV.encode()}])
    page.wait_for_timeout(500)
    check("CSV upload adds 'Your data'", page.locator(".chip[data-key=upload]").count() == 1)

    page.click("#btn-report")
    page.fill("[name=client]", "Test Client")
    page.click(".dialog .btn-primary")
    page.wait_for_function("window.__printed === true", timeout=15000)
    check("business case builds (chart image + print)", page.locator("#report img").count() == 1)
    check("business case defaults to your name", "Baizak Isaev" in page.inner_text("#report"))

    check("project page has no 'Built by' card", page.locator("#contact").count() == 0)

    about = context.new_page()
    about.on("pageerror", lambda e: errors.append(str(e)))
    about.goto(URL, wait_until="networkidle")
    text = about.inner_text("main")
    check("Home page is About me", "North American University" in text and "Renewable energy" in text)
    check("Home page: business email link", about.get_attribute("#email-link", "href").startswith("mailto:baizak@baizakisaev.com"))
    check("Home page: photo loads", about.evaluate("(() => { const i = document.querySelector('.avatar-xl img'); return !!i && i.naturalWidth > 0; })()"))
    about.click(".project-card")
    about.wait_for_load_state("networkidle")
    check("Home page: project card opens the demo", about.url.split("#")[0].split("?")[0].rstrip("/").endswith("ai-grid-trader") and about.locator("#chart-main").count() == 1, about.url)
    about.go_back(wait_until="networkidle")
    old = context.new_page()
    old.goto(URL + "#p=de&mode=forecast", wait_until="networkidle")
    check("old shared demo links still open the demo", "ai-grid-trader" in old.url and "p=de" in old.url, old.url)
    old.goto(URL + "about.html", wait_until="networkidle")
    check("old about.html link reaches the home page", old.locator(".about-hero").count() == 1, old.url)
    old.close()
    if label.startswith("Chromium"):
        about.add_script_tag(url="https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js")
        found = about.evaluate("async () => (await axe.run(document, {resultTypes: ['violations']})).violations.map(v => v.id + ' x' + v.nodes.length)")
        check("Home page: no accessibility violations", not found, ", ".join(found))
    about.screenshot(path=str(SHOTS / f"{label.replace(' ', '_')}_about.png"), full_page=True)
    about.close()

    page.click("#btn-play")
    page.wait_for_timeout(3500)
    labels = page.locator("#kpis .label").all_inner_texts()
    check("auto-play running with live numbers", page.evaluate("document.body.classList.contains('kiosk')") and "so far" in labels[0], labels[0])
    fit = page.evaluate("""() => { const c = document.getElementById('chart-main').getBoundingClientRect();
        const s = document.querySelector('#chart-main .main-svg').getBoundingClientRect();
        return { chartBottom: Math.round(c.bottom), vh: innerHeight, svg: Math.round(s.height), box: Math.round(c.height) }; }""")
    check("auto-play chart sized to its box", abs(fit["svg"] - fit["box"]) <= 2, str(fit))
    page.screenshot(path=str(SHOTS / f"{label.replace(' ', '_')}_kiosk.png"))
    page.evaluate("window.scrollBy(0, 300)")          # works on desktop and touch devices
    page.wait_for_timeout(200)
    check("scrolling keeps auto-play running", page.evaluate("document.body.classList.contains('kiosk')"))
    page.locator("#chart-main").click()
    page.wait_for_timeout(300)
    check("tap/click exits auto-play", not page.evaluate("document.body.classList.contains('kiosk')"))

    page.screenshot(path=str(SHOTS / f"{label.replace(' ', '_')}.png"), full_page=True)
    check("no JavaScript errors", not errors, "; ".join(errors[:3]))
    browser.close()


def offline(pw):
    print("\n== Chromium offline (service worker)")
    browser = pw.chromium.launch()
    context = browser.new_context()
    page = context.new_page()
    page.goto(URL, wait_until="networkidle")
    page.evaluate("navigator.serviceWorker.ready")
    page.wait_for_timeout(1500)
    page.reload(wait_until="networkidle")          # now controlled by the service worker
    context.set_offline(True)
    page.goto(URL, wait_until="load")
    check("home page opens with no network", page.locator(".about-hero").count() == 1)
    page.goto(URL + "ai-grid-trader?kiosk=1", wait_until="load")
    page.wait_for_timeout(1500)
    kpis = page.locator("#kpis .value").all_inner_texts()
    check("opens with no network after first visit", len(kpis) == 5 and all(kpis), " | ".join(kpis))
    browser.close()


with sync_playwright() as pw:
    only = set(sys.argv[3].split(",")) if len(sys.argv) > 3 else None
    want = lambda name: only is None or name in only
    if want("chromium"): run(pw, "Chromium desktop", pw.chromium, viewport={"width": 1366, "height": 768})
    if want("firefox"): run(pw, "Firefox desktop", pw.firefox, viewport={"width": 1366, "height": 768})
    if want("webkit"): run(pw, "WebKit desktop", pw.webkit, viewport={"width": 1366, "height": 768})
    if want("ipad"): run(pw, "WebKit iPad", pw.webkit, **pw.devices["iPad Pro 11 landscape"])
    if want("offline"): offline(pw)

print(f"\nScreenshots: {SHOTS}")
print("ALL PASSED" if not failures else f"{len(failures)} FAILED: {failures}")
sys.exit(1 if failures else 0)
