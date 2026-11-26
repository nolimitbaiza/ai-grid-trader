# Development

How the site is hosted, tested and rebuilt.

[Back to the project overview](../README.md)

## Hosting

The site is static: plain HTML, CSS and JavaScript with no build step.

- **[baizakisaev.com](https://baizakisaev.com)** is hosted on [Railway](https://railway.com):
  the home page is the About me page (`index.html`), with the demo at
  [/ai-grid-trader](https://baizakisaev.com/ai-grid-trader) (`ai-grid-trader.html`). The
  `Dockerfile` serves the website files with [Caddy](https://caddyserver.com) (`Caddyfile`: clean
  URLs, compression, caching, security headers, a "Page not found" page, Railway's `$PORT`);
  tools, tests and the prototype aren't published. The image build validates the server
  configuration, and GitHub builds and smoke-tests the same image on every push, so a broken
  configuration fails before it reaches the live site.
  Each deploy stamps a build number into file addresses (`style.css?v=…`, the `__BUILD__`
  placeholder) and the offline cache, so browsers and Cloudflare never mix a new page with old
  files; open pages reload once when a new release takes over. `tools/upgrade_check.py` tests this.
  `robots.txt` and `sitemap.xml` point search engines at the two pages.
  Old links keep working: shared scenarios and `?kiosk=1` / `?embed=1` on the home page open the
  demo, and `/about.html` goes to the home page.
  Deploy with the [Railway CLI](https://docs.railway.com/guides/cli) by running `railway up` in the
  repo folder. To redeploy automatically on every push, including the monthly data refresh,
  connect this GitHub repo to the service in Railway (*service → Settings → Source*).
- **[/pitwall/](https://baizakisaev.com/pitwall/)** serves the Pitwall dashboard from `pitwall/`.
  Pitwall has its own repository
  ([f1_constructor_performance_tracker](https://github.com/nolimitbaiza/f1_constructor_performance_tracker)),
  which loads new race results after every race weekend. The *Sync Pitwall* workflow
  (`.github/workflows/sync-pitwall.yml`) copies its app into `pitwall/` every day with
  `tools/sync_pitwall.py`; a change is committed, and the push redeploys the site. Run
  `python tools/sync_pitwall.py <path to a Pitwall checkout>` to do the same by hand.
- A mirror on GitHub Pages also updates on every push to `main`.

**Embedding it on another website:** `?embed=1` hides the page header, intro and footer so only the
demo shows:

```html
<iframe
  src="https://baizakisaev.com/ai-grid-trader?embed=1"
  style="width:100%; height:1250px; border:0;"
  loading="lazy"
  title="AI Grid Trader demo">
</iframe>
```

## Development

Serve the folder with the bundled dev server (same clean URLs as the live site) and open
http://localhost:8600/:

```bash
python tools/serve.py
```

**Tests.** `tests/engine.test.js` checks the model with Node's built-in test runner (no installs):

```bash
node --test tests/engine.test.js
```

- The battery never leaves its allowed charge window or exceeds its power rating.
- Perfect hindsight always does at least as well as the forecast-driven AI; with a 0% forecast
  error they match exactly. Forecasts get worse as the error setting grows.
- Accounting adds up: cycles, cumulative and step profits, revenue minus wear.
- Full year: hindsight is the maximum, limits hold, months add up to the year.
- The bundled data is a complete year; CSV uploads in common formats parse correctly.
- Solar: clipping is bounded and yields are realistic; free energy is never over-used and never
  makes the best plan worse.
- Lifetime: matches a hand-calculated NPV, IRR and payback; more cycling means earlier new cells;
  a tax credit lowers the upfront cost but not O&M.
- Every AI trade can be explained, with consistent numbers.

GitHub runs these on every push (see the **Actions** tab), together with:

- `tools/browser_check.py`: the demo and the home page in Firefox, Chromium, WebKit (Safari's
  engine), an iPad and offline, including the full-year simulation, revenue streams, lifetime
  view, "Why this trade?", the business-case PDF, the "Page not found" page and the accessibility
  audit. Screenshots are attached to each run.
- `tools/upgrade_check.py`: a returning visitor gets each new release without a manual refresh.
- A build and smoke test of the production image (`Dockerfile` and `Caddyfile`).

To run the browser checks yourself:

```bash
pip install playwright && python -m playwright install chromium firefox webkit
python tools/serve.py &
python tools/browser_check.py
python tools/upgrade_check.py
```

**Rebuilding the market data by hand:**

```bash
python tools/fetch_data.py raw --year 2025      # ~1,000 small public downloads, 20-40 minutes
python tools/build_markets.py raw --year 2025
python tools/build_services.py raw --year 2025  # needs: pip install openpyxl
```

**Repository layout:**

```
index.html                  Home page: about me, projects, writing, contact
ai-grid-trader.html         The demo (served at /ai-grid-trader)
ai-grid-trader-case-study.html  The project write-up (served at /ai-grid-trader-case-study)
pitwall-case-study.html     The Pitwall write-up (served at /pitwall-case-study)
battery-wear-cost.html, perfect-hindsight-benchmark.html  Posts (served without .html; numbers from
                            tools/writing_numbers.js)
404.html                    "Page not found" page (self-contained)
about.html                  Redirect from the old About address to the home page
assets/site.js              Shared by both pages: light/dark switch, contact email, offline support
assets/engine.js            The model: markets, trading agent, forecasts, benchmarks, accounting, full year
assets/app.js               The demo page: controls, charts, full-year worker, kiosk, PDF, sharing
assets/style.css            Minimal light/dark theme and the printable business case
assets/home.css             Home page layout, type scale, accent colour and motion
assets/home.js              Home page scroll reveals, header state, count-up numbers, copy email
assets/fonts/               Inter and JetBrains Mono (self-hosted Latin subsets, OFL)
assets/Baizak-Isaev-Resume.pdf  Résumé linked from the header and contact (web copy: no phone number)
assets/data/markets.js      Index of the real markets (loaded with the page)
assets/data/prices-*.js     A full year of 15-minute prices per market (loaded on demand)
assets/data/services.js     Yearly grid-services price averages (the defaults)
assets/vendor/              Plotly.js (bundled for offline use)
assets/img/                 Profile photo, project screenshots (light and dark), LinkedIn QR code
assets/icons/, manifest.webmanifest, sw.js   Installable app + offline cache
assets/og.png, og-case-study.png, og-pitwall.png  Link-preview images (demo and home; the two case studies)
robots.txt, sitemap.xml     For search engines
Dockerfile, Caddyfile       Hosting on Railway
tools/fetch_data.py         Downloads a year of public market data
tools/build_markets.py      Rebuilds the real-price data files
tools/build_services.py     Rebuilds the grid-services price averages
tools/build_assets.py       Rebuilds the app icons and QR code
tools/build_og.py           Rebuilds the demo's link-preview image (assets/og.png) and the case studies' (og-case-study.png, og-pitwall.png)
tools/build_og_card.py      Rebuilds the home page and posts' preview card (assets/og-card.png)
tools/build_demo_loop.py    Records the demo loop on the home page's project card (assets/video/)
tools/build_project_shot.py Rebuilds the AI Grid Trader phone stills (light and dark)
tools/build_demo_video.py   Records the case study's chart replay clip, its stills and the README GIF
tools/build_webp.py         WebP copies of the phone stills and Pitwall screenshots, and the small header photo
tools/build_f1_shot.py     Records the Pitwall loop and rebuilds its stills from its live demo
tools/writing_numbers.js   Reproduces the numbers quoted in the posts
tools/serve.py              Local dev server with clean URLs and the "Page not found" page
tools/browser_check.py      Cross-browser and accessibility checks
tools/upgrade_check.py      Returning visitors get each new release (no stale cached files)
tests/engine.test.js        Automated model tests
.github/workflows/          test.yml (every push: model, browsers, production image),
                            refresh-data.yml (monthly data refresh)
streamlit_app/              Earlier analyst prototype in Python (Streamlit)
docs/                       Methodology, user guide and development notes
LICENSE.md                  PolyForm Noncommercial 1.0.0
```

To swap the profile photo, replace `assets/img/profile.jpg` (square, about 400×400). Visitors who
already opened the site get new versions on their next visit.

**Earlier analyst prototype.** `streamlit_app/` is the original Streamlit prototype, kept for
reference. It uses simulated prices and a perfect-foresight agent only, so its numbers aren't
comparable with the web demo. It still offers a decision log with CSV export and a heatmap of the
learned policy:

```bash
cd streamlit_app
pip install -r requirements.txt
python -m streamlit run app.py
```
