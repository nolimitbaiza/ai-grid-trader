# ⚡ AI Grid Trader

[![Tests](https://github.com/nolimitbaiza/ai-grid-trader/actions/workflows/test.yml/badge.svg)](https://github.com/nolimitbaiza/ai-grid-trader/actions/workflows/test.yml)
[![Live demo](https://img.shields.io/badge/live%20demo-baizakisaev.com%2Fai--grid--trader-0c0a09)](https://baizakisaev.com/ai-grid-trader)
[![License: PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm%20Noncommercial-lightgrey)](LICENSE.md)

**An AI that trades a grid-scale battery, and protects it.**

The agent buys electricity when it's cheap, sells it when it's expensive, and counts battery wear
as a real cost, so it never wears the battery out on trades that aren't worth it. Try it on
simulated markets, on a full year of real prices from California, Germany and South Australia, or
on your own price file.

### ▶ [Live demo: baizakisaev.com/ai-grid-trader](https://baizakisaev.com/ai-grid-trader) · [About me: baizakisaev.com](https://baizakisaev.com)

[![AI Grid Trader: the 48-hour trading view with buy and sell decisions](assets/og.png)](https://baizakisaev.com/ai-grid-trader)

Everything runs in the visitor's browser: no sign-up, no backend, works on phones and tablets,
and keeps working offline after the first visit.

Built by **Baizak Isaev**, a student at North American University interested in renewable energy ·
[About me](https://baizakisaev.com) · [LinkedIn](https://www.linkedin.com/in/baizakisaev/) ·
[GitHub](https://github.com/nolimitbaiza) · baizak@baizakisaev.com

---

**Contents:** [Highlights](#highlights) · [Presenting it](#presenting-it) ·
[How the agent decides](#how-the-agent-decides) · [Real market data](#real-market-data) ·
[Why this trade?](#why-this-trade) · [Revenue streams](#revenue-streams) ·
[Costs and tax credit](#costs-and-tax-credit) · [Battery lifetime](#battery-lifetime) ·
[Uploading a CSV](#uploading-a-csv) · [Accessibility](#accessibility) · [Hosting](#hosting) ·
[Development](#development) · [License](#license)

## Highlights

- **Honest benchmark.** The agent trades on a *forecast*, never the real future, and is scored
  on what actually happened. It's compared with perfect hindsight (the most any strategy could
  earn) and with a simple rule-based bot.
- **A full year of real prices** for three markets, with the agent re-planning every hour.
  It captures 93–95% of the hindsight maximum.
- **"Why this trade?"** Click any buy or sell to see what the AI expected, its margin after losses
  and wear, and what actually happened.
- **The whole business case:** grid services, capacity payments and co-located solar on top of
  trading, plus 15 years of battery health, replacement cells, NPV, IRR and payback.
- **Ready for a conference booth:** auto-play kiosk mode, a one-page PDF business case, shareable
  scenario links, light and dark themes, works offline.

## Presenting it

| To… | Do this |
|---|---|
| Run it unattended on a booth screen | Open **[baizakisaev.com/ai-grid-trader?kiosk=1](https://baizakisaev.com/ai-grid-trader?kiosk=1)**. It goes full-window and auto-plays every market while the headline numbers count up, with a QR code to LinkedIn in the corner. Scrolling keeps it playing; a tap, click or key hands control to the visitor; after 60 s idle it starts again. |
| Start or stop auto-play by hand | Click **Auto-play**, or press **K** |
| Switch market | Click a chip, or press **1–7** (four simulated, then California, Germany, South Australia) |
| Show a different 48 hours | Click **New day** or press **N** (real markets: or pick dates from the menu) |
| Show the realistic vs. ideal agent | **Agent sees: Forecast / Perfect hindsight**, or press **H** |
| Explain a decision | Click any ▲ or ▼ on the chart, or **explain the first trade** below it |
| Make the point about battery health | Drag **Wear cost per cycle** to $0 and watch the AI start micro-cycling |
| Talk beyond trading | Scroll to **Revenue streams** and **Battery lifetime** |
| Run it on a prospect's own prices | **Upload CSV** ([format](#uploading-a-csv)) |
| Leave a one-page business case | **Business case** → enter their name → *Save as PDF* in the print window |
| Send the exact scenario you showed | **Share**: the link stores every setting |
| Light or dark | The sun/moon button, or **T** (remembered) |
| Full screen | **Present**, or **F** |

**No Wi-Fi at the venue?** Open [the demo](https://baizakisaev.com/ai-grid-trader) once while you're
online; after that it opens with no connection, because the browser keeps a copy. You can also
install it like an app: the install icon in Chrome or Edge's address bar, or *Share → Add to Home
Screen* on iPad and iPhone. As a last resort, download this repo (**Code → Download ZIP**), unzip
it and open `ai-grid-trader.html`.

**Sharing the link** on LinkedIn, Slack or email shows a preview card (`assets/og.png`). LinkedIn
caches previews; after changing the image, refresh it with the
[LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/).

## How the agent decides

Every 15 minutes over 48 hours, the agent chooses how much to charge, discharge or hold.
Its reward is:

```
reward = arbitrage cash − battery wear − micro-cycling penalty
```

- **Arbitrage cash:** sale revenue minus purchase cost, after efficiency losses.
- **Battery wear:** each MWh moved is charged a share of the per-cycle wear cost, so trades whose
  price gap doesn't beat it are skipped.
- **Micro-cycling penalty:** starting a new charge or discharge run has a cost, so the agent
  commits to a few clean cycles instead of chasing every price wiggle.

The state is *(time, state of charge, current mode)*. The decision table is computed with exact
Bellman updates: the same answer a fully trained Q-learning agent converges to, in milliseconds
and reproducible every time.

**Forecast mode (the default).** The agent never sees the real future. Every hour it gets a fresh
forecast, re-plans, executes the next hour, and is scored on the prices that actually happened.
The forecast misses short spikes, flattens peaks and dips further ahead, and adds correlated
noise; the **Forecast error** slider sets how wrong it is. The *Of hindsight maximum* figure
compares the result with perfect hindsight, the number a technical buyer will ask for.

The **rule-based bot** buys below the 3-hour average and sells above it. All three strategies are
scored with the same accounting.

## Real market data

A full calendar year (365 days, 15-minute steps) for each market, currently **2025**:

| Market | Prices | Source |
|---|---|---|
| California | CAISO SP15 trading hub, day-ahead (USD) | [CAISO OASIS](https://oasis.caiso.com) |
| Germany | Germany-Luxembourg day-ahead (EUR) | Bundesnetzagentur / SMARD.de via [Energy-Charts](https://energy-charts.info), CC BY 4.0 |
| South Australia | NEM SA1 spot (AUD) | [AEMO](https://aemo.com.au) |

Times are each market's standard time all year (no daylight-saving jumps); hourly prices are
repeated across their quarter-hours. Each market's prices load only when that market is opened,
so the first visit stays light.

**Full-year results.** For a real market, the page runs the agent through all 8,760 hours of the
year in the background (a few seconds), re-planning every hour on a forecast with a 24-hour
look-ahead. Perfect hindsight is one optimisation over the whole year on actual prices. Annual
revenue, ROI and payback come from this, not from scaling up 48 hours. With the default
100 MWh / 25 MW battery on 2025 prices:

| Market | AI energy-trading revenue | Of hindsight max | Rule-based bot | ROI, trading only | ROI, all streams |
|---|---|---|---|---|---|
| California | $0.87M | 95% | −$0.36M | 4.4% | 13.6% |
| Germany | €2.54M | 95% | −€0.55M | 12.4% | 15.5% |
| South Australia | A$8.18M | 93% | +A$1.33M | 21.2% | 21.2% |

Revenue is after battery wear. "All streams" adds grid services and capacity payments
([below](#revenue-streams)); ROI is on the installed cost after any tax credit.

The 48-hour chart opens on a representative window (the median price spread of the year), not a
cherry-picked one; any other day can be picked from the date menu.

**Kept up to date automatically.** Once a month, a GitHub Actions job (`refresh-data.yml`) checks
whether a newer complete calendar year is available. When it is (2026 prices once January 2027
starts), it downloads that year, rebuilds the price and grid-services files, runs the tests and
pushes the update. If a source hasn't published the whole year yet, the job fails and tries again
the next month. You can also run it from the **Actions** tab (*Refresh market data → Run
workflow*) and pick a year. Installed-cost benchmarks don't update automatically, and the results
in this README are for 2025.

## Why this trade?

Click any buy (▲) or sell (▼) marker, or use **explain the first trade** and step through with
*Previous / Next trade*. The panel reconstructs the decision from the plan the agent was following
at that moment (in forecast mode, its hourly re-plan and the forecast it had then):

- **Buys:** the price paid, when and at what forecast price it planned to sell, the cost per stored
  MWh after efficiency losses, battery wear, the expected margin, and what actually happened.
- **Sells:** what the energy cost when it was bought (or, for energy already in the battery, the
  planned cheaper refill), the margin, and whether the forecast showed better prices later.
- What the rule-based bot did at the same moment.

## Revenue streams

Energy trading is only one way a battery earns. The **Revenue streams** section adds:

- **Grid services:** part of the power is kept back for frequency services, paid per MW per hour
  of availability. Reserved power can't be traded, and both simulations account for that.
- **Capacity payments:** paid per kW per year for being available at peak; counted in full for a
  4-hour battery, proportionally less for shorter ones.
- **Co-located solar:** panels at 1.3× their inverter rating clip on sunny middays; a DC-coupled
  battery stores that energy for free. Solar output is *simulated* for the region, not measured.
  Clipping alone adds little; the bigger real benefits of pairing with solar (shared grid
  connection, tax credits) aren't modelled.

**Grid-services prices default to real 2025 averages** for products a battery can sell with the
same reserved megawatt:

| Market | Product | 2025 average, per MW per hour | Source |
|---|---|---|---|
| California | Regulation up + regulation down, day-ahead (mileage not included) | $7.2 | CAISO OASIS |
| Germany | FCR (primary frequency reserve) | €15.2 (aFRR up + down: €33.6) | regelleistung.net |
| South Australia | Six contingency FCAS markets combined (raise and lower, 6 s / 60 s / 5 min) | A$5.6 | AEMO |

In South Australia no power is reserved by default, because trading pays far more there. Prices
tend to fall as more batteries join these small markets. **Capacity payments are an illustrative
assumption:** California pays for capacity through resource adequacy contracts, whose prices vary
widely; Germany and Australia's NEM have no capacity payment.

## Costs and tax credit

Default installed costs are 2025 benchmarks for a utility-scale 4-hour battery, all-in
(equipment, installation and grid connection), in each market's currency:

| Market | Installed cost | New cells (battery part) | Basis |
|---|---|---|---|
| California | $280/kWh, minus a 30% investment tax credit | $150/kWh | BloombergNEF 2025 US turnkey average ($219) + ~$60 installation and grid connection (Ember, 2025); federal storage ITC (IRC §48E) |
| Germany | €205/kWh | €120/kWh | BloombergNEF 2025 Europe turnkey average ($177 ≈ €155) + ~€50 installation and grid connection |
| South Australia | A$385/kWh | A$265/kWh | CSIRO GenCost 2025-26, 4-hour battery (A$265 battery + A$120 balance of plant) |

The **Tax credit** slider (under *More settings*) lowers the upfront cost; O&M is still charged on
the full installed cost. The US credit has eligibility rules (including foreign-entity sourcing
limits) and phases down from the early 2030s, so check a real project with a tax adviser.

The agent's **wear cost per cycle** defaults to the physical wear these costs imply (new cells for
the 20% of capacity a cycle-life's worth of cycles uses up): about $500, €400 and A$900.

## Battery lifetime

Years of cash flow with *physical* battery wear instead of the agent's internal wear price. Health
falls 20% over the cycle life plus 1% a year with age; below 80% health, new cells restore it
(getting 3% cheaper each year). O&M is 1.5% of the installed cost a year, and trading revenue
scales with health. The AI and the rule-based bot are shown side by side: lifetime value (NPV),
IRR, payback, new cells needed, health over time, cumulative cash, and cycles per year against a
typical 365-cycle-a-year warranty. A button sets the agent's wear price to the physical wear the
assumptions imply. Financing, other taxes and residual value aren't modelled.

With the defaults (100 MWh / 25 MW, 2025 prices and costs, 8% discount rate, 15 years), for the
AI agent:

| Market | Revenue per year | Lifetime value (NPV) | IRR | Payback |
|---|---|---|---|---|
| California (30% tax credit) | $2.67M | −$0.9M | 7.2% | 8.5 years |
| Germany | €3.17M | +€2.5M | 10.0% | 7.3 years |
| South Australia | A$8.18M | +A$21.1M | 16.5% | 5.2 years |

The rule-based bot loses money over the project life in all three markets. Installed cost, the tax
credit, and the services and capacity prices are the big levers; set them to your own numbers.

> Results are illustrative. For real markets, annual figures come from simulating a full year; for
> the simulated scenarios they scale a 48-hour window. Forecast error is simulated. Past prices
> don't guarantee future revenue.

## Uploading a CSV

Any CSV with a price column works, ideally with a timestamp column: 5, 15, 30 or 60-minute data,
at least 48 hours (up to a year is used; four weeks or more also gets the full-year view, scaled to
365 days). Comma or semicolon separated, decimal points or commas. The file is processed only in
the visitor's browser and never uploaded, and it isn't included in Share links.

```
timestamp,price_eur_mwh
2025-06-02 00:00,61.20
2025-06-02 01:00,58.75
...
```

## Accessibility

Every control works with the keyboard and shows a focus ring. Charts carry text descriptions for
screen readers, including the main chart's price range, trades and profit. **Explain the first
trade** opens "Why this trade?" without a mouse, and explanations are announced to screen readers.
Text contrast meets WCAG AA in both themes. An automated audit (axe-core) runs on every push.

## Hosting

The site is static: plain HTML, CSS and JavaScript with no build step.

- **[baizakisaev.com](https://baizakisaev.com)** is hosted on [Railway](https://railway.com):
  the home page is the About me page (`index.html`), with the demo at
  [/ai-grid-trader](https://baizakisaev.com/ai-grid-trader) (`ai-grid-trader.html`). The
  `Dockerfile` serves the website files with [Caddy](https://caddyserver.com) (`Caddyfile`: clean
  URLs, compression, caching, Railway's `$PORT`); tools, tests and the prototype aren't published.
  Each deploy stamps a build number into file addresses (`style.css?v=…`, the `__BUILD__`
  placeholder) and the offline cache, so browsers and Cloudflare never mix a new page with old
  files; open pages reload once when a new release takes over. `tools/upgrade_check.py` tests this.
  Old links keep working: shared scenarios and `?kiosk=1` / `?embed=1` on the home page open the
  demo, and `/about.html` goes to the home page.
  Deploy with the [Railway CLI](https://docs.railway.com/guides/cli) by running `railway up` in the
  repo folder. To redeploy automatically on every push, including the monthly data refresh,
  connect this GitHub repo to the service in Railway (*service → Settings → Source*).
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

GitHub runs these on every push (see the **Actions** tab), together with `tools/browser_check.py`:
the demo and the home page in Firefox, Chromium, WebKit (Safari's engine), an iPad and offline,
including the full-year simulation, revenue streams, lifetime view, "Why this trade?" and the
accessibility audit. Screenshots are attached to each run.

**Rebuilding the market data by hand:**

```bash
python tools/fetch_data.py raw --year 2025      # ~1,000 small public downloads, 20-40 minutes
python tools/build_markets.py raw --year 2025
python tools/build_services.py raw --year 2025  # needs: pip install openpyxl
```

**Repository layout:**

```
index.html, assets/about.js Home page: about me and the project
ai-grid-trader.html         The demo (served at /ai-grid-trader)
about.html                  Redirect from the old About address to the home page
assets/engine.js            The model: markets, RL agent, forecasts, benchmarks, accounting, full year
assets/app.js               The page: controls, charts, full-year worker, kiosk, PDF, sharing
assets/style.css            Minimal light/dark theme and the printable business case
assets/data/markets.js      Index of the real markets (loaded with the page)
assets/data/prices-*.js     A full year of 15-minute prices per market (loaded on demand)
assets/data/services.js     Yearly grid-services price averages (the defaults)
assets/vendor/              Plotly.js (bundled for offline use)
assets/img/                 Profile photo and LinkedIn QR code
assets/icons/, manifest.webmanifest, sw.js   Installable app + offline cache
assets/og.png               Link-preview image
Dockerfile, Caddyfile       Hosting on Railway
tools/fetch_data.py         Downloads a year of public market data
tools/build_markets.py      Rebuilds the real-price data files
tools/build_services.py     Rebuilds the grid-services price averages
tools/build_assets.py       Rebuilds the app icons and QR code
tools/build_og.py           Rebuilds the link-preview image
tools/serve.py              Local dev server with clean URLs
tools/browser_check.py      Cross-browser and accessibility checks
tools/upgrade_check.py      Returning visitors get each new release (no stale cached files)
tests/engine.test.js        Automated model tests
.github/workflows/          test.yml (every push), refresh-data.yml (monthly data refresh)
streamlit_app/              Earlier analyst prototype in Python (Streamlit)
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

## About the author

I'm **Baizak Isaev**, a student at North American University with a strong interest in renewable
energy. More on [baizakisaev.com](https://baizakisaev.com), or reach me on
[LinkedIn](https://www.linkedin.com/in/baizakisaev/) or at baizak@baizakisaev.com.

## License

**PolyForm Noncommercial 1.0.0** (see [LICENSE.md](LICENSE.md)). You may use, study and modify
this code for non-commercial purposes such as learning, research and personal projects.
**Commercial use requires a separate license**: contact baizak@baizakisaev.com or
[LinkedIn](https://www.linkedin.com/in/baizakisaev/).

Third-party parts keep their own terms: Plotly.js (`assets/vendor/`, MIT license) and the market
data (each source's terms; the German data is CC BY 4.0, Bundesnetzagentur | SMARD.de).
