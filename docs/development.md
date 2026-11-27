# Development

How the site is hosted, tested and rebuilt.

[Back to the project overview](../README.md)

## Hosting

The demo is static: plain HTML, CSS and JavaScript with no build step.

- **[baizakisaev.com](https://baizakisaev.com)** is put together and hosted by the
  [portfolio repository](https://github.com/nolimitbaiza/portfolio): the home page, the posts,
  everything the pages share (styles, fonts, the header, the light/dark switch, the offline
  service worker, icons) and the server ([Caddy](https://caddyserver.com) in Docker on
  [Railway](https://railway.com), behind Cloudflare) all live there.
- **This repository publishes the demo and its case study**:
  [/ai-grid-trader](https://baizakisaev.com/ai-grid-trader) (`ai-grid-trader.html`) and
  [/ai-grid-trader-case-study](https://baizakisaev.com/ai-grid-trader-case-study), with their
  scripts, data, images and videos. `publish.json` lists every published file and its address on
  the site; tools, tests, docs and the prototype aren't published.
- **Getting a change live:** push to `main`. Every hour the portfolio's *Sync projects* workflow
  copies the files `publish.json` lists, builds and smoke-tests the production image, and commits
  the update, which redeploys the site. A file added to the demo must also be added to
  `publish.json`, or it won't be served.
- Each deploy stamps a build number into file addresses (`app.js?v=…`, the `__BUILD__`
  placeholder) and the offline cache, so browsers and Cloudflare never mix a new page with old
  files.
- Old links keep working: shared scenarios and `?kiosk=1` / `?embed=1` open the demo.

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

The demo uses the site's shared files, so it is previewed through the portfolio's local server.
Check the portfolio out next to this repository once, then serve and open
http://localhost:8600/ai-grid-trader:

```bash
git clone https://github.com/nolimitbaiza/portfolio ../portfolio
python tools/serve.py
```

`tools/serve.py` runs the portfolio's server with this checkout in place of its copy of AI Grid
Trader (set `PORTFOLIO` if it is somewhere else), with the live site's clean URLs and "Page not
found" page. Edits show up on reload.

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

GitHub runs these on every push (see the **Actions** tab), together with the portfolio's site
checks, run on the whole site with this checkout in place of its copy of AI Grid Trader:

- the browser checks: the demo, its case study and the rest of the site in Firefox, Chromium,
  WebKit (Safari's engine), an iPad and offline, including the full-year simulation, revenue
  streams, lifetime view, "Why this trade?", the business-case PDF and the accessibility audit.
  Screenshots are attached to each run;
- the release-upgrade check: a returning visitor gets each new release without a manual refresh;
- a build and smoke test of the production image.

To run the browser checks yourself, from the portfolio checkout, with this repository's files:

```bash
pip install playwright && python -m playwright install chromium firefox webkit
cd ../portfolio
python tools/serve.py --project ai-grid-trader=../ai-grid-trader &
python tools/browser_check.py
```

**Rebuilding the market data by hand:**

```bash
python tools/fetch_data.py raw --year 2025      # ~1,000 small public downloads, 20-40 minutes
python tools/build_markets.py raw --year 2025
python tools/build_services.py raw --year 2025  # needs: pip install openpyxl
```

**Repository layout:**

```
ai-grid-trader.html         The demo (served at /ai-grid-trader)
ai-grid-trader-case-study.html  The project write-up (served at /ai-grid-trader-case-study)
publish.json                The files published on baizakisaev.com, and their addresses
assets/engine.js            The model: markets, trading agent, forecasts, benchmarks, accounting, full year
assets/app.js               The demo page: controls, charts, full-year worker, kiosk, PDF, sharing
assets/data/markets.js      Index of the real markets (loaded with the page)
assets/data/prices-*.js     A full year of 15-minute prices per market (loaded on demand)
assets/data/services.js     Yearly grid-services price averages (the defaults)
assets/vendor/              Plotly.js (bundled for offline use)
assets/img/, assets/video/  The demo loop and chart replay (light and dark) and the phone stills
assets/og.png, og-case-study.png  Link-preview images (the demo; the case study)
tools/fetch_data.py         Downloads a year of public market data
tools/build_markets.py      Rebuilds the real-price data files
tools/build_services.py     Rebuilds the grid-services price averages
tools/build_og.py           Rebuilds the link-preview images (assets/og.png, og-case-study.png)
tools/build_demo_loop.py    Records the demo loop on the home page's project card (assets/video/)
tools/build_project_shot.py Rebuilds the AI Grid Trader phone stills (light and dark)
tools/build_demo_video.py   Records the case study's chart replay clip, its stills and the README GIF
tools/build_webp.py         WebP copies of the phone stills
tools/writing_numbers.js    Reproduces the numbers quoted in the posts
tools/serve.py              Local preview through the portfolio's server
tests/engine.test.js        Automated model tests
.github/workflows/          test.yml (every push: model, and the site's browser and image checks),
                            refresh-data.yml (monthly data refresh)
streamlit_app/              Earlier analyst prototype in Python (Streamlit)
docs/                       Methodology, user guide and development notes
LICENSE.md                  PolyForm Noncommercial 1.0.0
```

The home page, the posts, the shared styles and scripts, the photo, the résumé and the server
configuration are in the [portfolio repository](https://github.com/nolimitbaiza/portfolio).

**Earlier analyst prototype.** `streamlit_app/` is the original Streamlit prototype, kept for
reference. It uses simulated prices and a perfect-foresight agent only, so its numbers aren't
comparable with the web demo. It still offers a decision log with CSV export and a heatmap of the
learned policy:

```bash
cd streamlit_app
pip install -r requirements.txt
python -m streamlit run app.py
```
