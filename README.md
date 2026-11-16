# ⚡ AI Grid Trader

**An AI that trades a grid-scale battery, and protects it.**

An interactive demo of a reinforcement-learning agent that buys electricity when it is cheap,
sells it when it is expensive, and counts battery wear as a real cost, so it never burns
the asset on trades that aren't worth it. It trades on simulated markets, on real historical
prices from three markets, or on a price file you upload.

### ▶ Live demo: https://nolimitbaiza.github.io/ai-grid-trader/

The demo runs entirely in the visitor's browser: no server, no sign-up, loads in about a second
and works on phones and tablets.

Built by **Baizak Isaev** · [LinkedIn](https://www.linkedin.com/in/baizakisaev/) ·
[GitHub](https://github.com/nolimitbaiza) · baizakisaev@gmail.com

---

## Presenting it

| To… | Do this |
|---|---|
| Run it unattended on a booth screen | Open **https://nolimitbaiza.github.io/ai-grid-trader/?kiosk=1**. It goes full-window, the chart fills the screen, and it auto-plays every market while the headline numbers count up. A QR code to your LinkedIn sits in the corner. Scrolling keeps it playing; a tap, click or key hands control to the visitor; after 60 s idle it starts again. |
| Start or stop auto-play by hand | Click **Auto-play**, or press **K** |
| Switch market | Click a chip, or press **1–7** (four simulated, then California, Germany, South Australia) |
| Show a different 48 hours | Click **New day** or press **N** (real markets: or pick dates from the menu) |
| Show the realistic vs. ideal agent | **Agent sees: Forecast / Perfect hindsight**, or press **H** |
| Run it on a prospect's own prices | **Upload CSV** (see below) |
| Leave a prospect a one-page business case | **Business case** → enter their name → *Save as PDF* in the print window |
| Send the exact scenario you showed | **Share**: the link stores every setting |
| Make the point about battery health | Drag **Wear cost per cycle** to $0 and watch the AI start micro-cycling |
| Explain a decision | Click any ▲ or ▼ on the chart: **Why this trade?** shows what the AI expected, its margin after losses and wear, and what actually happened |
| Talk about the business case beyond trading | Scroll to **Revenue streams** (grid services, capacity payments, solar) and **Battery lifetime** (15 years, new cells, warranty) |
| Light or dark | The sun/moon button, or **T**. The choice is remembered. |
| Full screen | **Present**, or **F** |

**No Wi-Fi at the venue?** Open the live demo once while you're online. After that the same link
opens with no connection, because the browser keeps a copy. You can also install it like an app:
the install icon in Chrome/Edge's address bar, or *Share → Add to Home Screen* on iPad/iPhone.
As a last resort, download this repo (green **Code** button → *Download ZIP*), unzip it and
double-click `index.html`.

**Sharing the link** on LinkedIn, Slack or email shows a preview card (`assets/og.png`).
LinkedIn caches previews; after changing the image, refresh it with the
[LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/).

## Forecast mode: the honest benchmark

By default the agent **never sees the real future**. Every hour it receives a fresh price
forecast, re-plans the rest of the 48 hours, executes the next hour, and is scored on the prices
that actually happened. The forecast is the actual price with simulated error that misses short
spikes, flattens peaks and dips further ahead, and adds correlated noise; the **Forecast error**
slider sets how bad it is.

The **Of hindsight maximum** figure compares that with *perfect hindsight*, an agent that knows
every future price: the most any strategy could have earned. This is the number a technical
buyer will ask for.

## Real market data: a full year

Bundled: the **whole of 2025** (365 days, 15-minute steps) for each market:

| Market | Prices | Source |
|---|---|---|
| California | CAISO SP15 trading hub, day-ahead (USD) | [CAISO OASIS](https://oasis.caiso.com) |
| Germany | Germany-Luxembourg day-ahead (EUR) | Bundesnetzagentur / SMARD.de via [Energy-Charts](https://energy-charts.info), CC BY 4.0 |
| South Australia | NEM SA1 spot (AUD) | [AEMO](https://aemo.com.au) |

Times are each market's standard time all year (no daylight-saving jumps). Hourly prices are
repeated across their quarter-hours. Each market's prices are a separate file that the page
loads only when that market is opened, so the first visit stays light.

**Kept up to date automatically.** Once a month, a GitHub Actions job (`refresh-data.yml`) checks
whether a newer complete calendar year is available. When it is (2026 prices once January 2027
starts), it downloads that year from the sources above, rebuilds the price and grid-services
files, runs the model tests and publishes the update. If a source hasn't published the whole year
yet, the job fails and simply tries again the next month. You can also run it by hand from the
**Actions** tab (*Refresh market data → Run workflow*) and choose a year. Installed-cost
benchmarks don't update automatically, and the results quoted in this README are for 2025.

To rebuild by hand:

```bash
python tools/fetch_data.py raw --year 2025      # downloads ~1,000 small files, 20-40 minutes
python tools/build_markets.py raw --year 2025
python tools/build_services.py raw --year 2025  # needs: pip install openpyxl
```

**Full-year results.** For a real market, the page runs the same agent through all 8,760 hours
of 2025 in the background (a few seconds): it re-plans every hour on a forecast with a
24-hour look-ahead and is scored on actual prices. The *Of hindsight maximum* figure compares it
with one optimisation over the whole year on actual prices, the most any strategy could earn.
Annual revenue, ROI and payback come from this, not from scaling up 48 hours, and the monthly chart
shows the seasonality. With the default 100 MWh / 25 MW battery on 2025 prices:

| Market | AI net revenue | Of hindsight max | Annual ROI |
|---|---|---|---|
| California | $270k | 82% | 0.9% |
| Germany | €1.84M | 93% | 6.1% |
| South Australia | A$7.31M | 93% | 24.4% |

The 48-hour chart opens on a representative window (the median price spread of the year), not a
cherry-picked one; any other day can be picked from the date menu.

## Why this trade?

Click any buy (▲) or sell (▼) marker. The panel reconstructs the decision from the plan the agent
was following at that moment (in forecast mode, its hourly re-plan and the forecast it had then):

- **Buys:** the price paid, when and at what forecast price it planned to sell, the cost per stored
  MWh after efficiency losses, battery wear, the expected margin, and what actually happened.
- **Sells:** what the energy cost when it was bought (or, for energy already in the battery, the
  planned cheaper refill), the margin, and whether the forecast showed better prices later.
- What the rule-based bot did at the same moment.

## Revenue streams

Energy trading is only one way a battery earns. The **Revenue streams** section adds:

- **Grid services:** keep part of the power back for frequency services, paid per MW per hour of
  availability. Reserved power can't be traded, and the simulations (48 hours and full year) account
  for that.
- **Capacity payments:** paid per kW per year for being available at peak; counted in full for a
  4-hour battery, proportionally less for shorter ones.
- **Co-located solar:** panels at 1.3× their inverter rating clip on sunny middays; a DC-coupled
  battery stores that energy for free. Solar output is *simulated* for the region (typical shape
  and yearly yield, not measured data). Clipping alone adds little; the bigger real benefits of
  pairing with solar (shared grid connection, tax credits) aren't modelled.

**Grid-services prices default to real 2025 averages** for products a battery can sell with the
same reserved megawatt (rebuild with `tools/build_services.py`):

| Market | Product | 2025 average, per MW per hour | Source |
|---|---|---|---|
| California | Regulation up + regulation down, day-ahead (mileage not included) | $7.2 | CAISO OASIS |
| Germany | FCR (primary frequency reserve) | €15.2 (aFRR up + down: €33.6) | regelleistung.net |
| South Australia | Six contingency FCAS markets combined (raise and lower, 6 s / 60 s / 5 min) | A$5.6 | AEMO |

In South Australia no power is reserved by default, because trading pays far more there. These are
averages over the year; prices fall as more batteries join these small markets.
**Capacity payments are an illustrative assumption**: California pays for capacity through resource
adequacy contracts, whose prices vary widely; Germany and Australia's NEM have no capacity payment.
The annual ROI shown at the top includes every stream.

## Costs and tax credit

Default installed costs are 2025 benchmarks for a utility-scale 4-hour battery, all-in (equipment,
installation and grid connection), in each market's currency:

| Market | Installed cost | New cells (battery part) | Basis |
|---|---|---|---|
| California | $280/kWh, minus a 30% investment tax credit | $150/kWh | BloombergNEF 2025 US turnkey average ($219) + ~$60 installation and grid connection (Ember, 2025); federal storage ITC (IRC §48E) |
| Germany | €205/kWh | €120/kWh | BloombergNEF 2025 Europe turnkey average ($177 ≈ €155) + ~€50 installation and grid connection |
| South Australia | A$385/kWh | A$265/kWh | CSIRO GenCost 2025-26, 4-hour battery (A$265 battery + A$120 balance of plant) |

The **Tax credit** slider (under More settings) reduces the upfront cost; O&M is still charged on
the full installed cost. The US credit has eligibility rules (including foreign-entity sourcing
limits) and phases down from the early 2030s; check a real project with a tax adviser.

The agent's **wear cost per cycle** defaults to the physical wear these assumptions imply (new cells
for the 20% of capacity a cycle-life's worth of cycles uses up): about $500, €400 and A$900.

## Battery lifetime

Years of cash flow with *physical* battery wear instead of the agent's internal wear price:
health falls 20% over the cycle life plus 1% a year with age; below 80% health, new cells restore it
(getting 3% cheaper each year); O&M is 1.5% of the installed cost a year; trading revenue scales
with health. Shown for the AI and the rule-based bot side by side: lifetime value (NPV), IRR,
payback, new cells needed, health over time, cumulative cash, and cycles per year against a typical
365-cycle-a-year warranty. It also shows the wear cost per cycle these assumptions imply, with a
button to set the agent's wear price to it. No financing, other taxes or residual value.

With the defaults (100 MWh / 25 MW, 2025 prices and costs, 8% discount rate) the 15-year picture is
as follows for the AI agent (the rule-based bot loses money in every market):

| Market | Revenue per year | Lifetime value (NPV) | IRR | Payback |
|---|---|---|---|---|
| California (30% tax credit) | $2.67M | −$0.9M | 7.2% | 8.5 years |
| Germany | €3.17M | +€2.5M | 10.0% | 7.3 years |
| South Australia | A$8.18M | +A$21.1M | 16.5% | 5.2 years |

Installed cost, the tax credit, and the services and capacity prices are the big levers; set them to
your own numbers.

### Uploading a CSV

Any CSV with a price column works, ideally with a timestamp column; 5, 15, 30 or 60-minute data,
at least 48 hours (up to a year is used; four weeks or more also gets the full-year view, scaled to 365 days). Comma or semicolon separated, decimal points or commas. The file is processed
only in the visitor's browser and never uploaded. Uploaded data isn't included in Share links.

```
timestamp,price_eur_mwh
2025-06-02 00:00,61.20
2025-06-02 01:00,58.75
...
```

## Hosting

The site is static, so it runs anywhere. It's published two ways:

- **GitHub Pages:** every push to `main` updates it.
- **Railway:** `Dockerfile` serves the site with [Caddy](https://caddyserver.com) (`Caddyfile`, on
  Railway's `$PORT`); `railway.json` sets the build and a health check. Deploy with the
  [Railway CLI](https://docs.railway.com/guides/cli): `railway up`. To redeploy on every push, connect
  the GitHub repo to the service in the Railway dashboard.

`about.html` is the **About me** page; the demo links to it from the header and the bottom card.

## Putting it on your website

Link to the live demo, or embed it with an iframe. `?embed=1` hides the page header,
intro and footer so only the demo shows:

```html
<iframe
  src="https://nolimitbaiza.github.io/ai-grid-trader/?embed=1"
  style="width:100%; height:1250px; border:0;"
  loading="lazy"
  title="AI Grid Trader demo">
</iframe>
```

You can also copy `index.html` and the `assets/` folder onto any web host as-is.

## How the agent decides

Every 15 minutes over 48 hours, the agent chooses how much to charge, discharge or hold.
Its reward is:

```
reward = arbitrage cash − battery wear − micro-cycling penalty
```

- **Arbitrage cash:** sale revenue minus purchase cost, after efficiency losses.
- **Battery wear:** each MWh moved is charged a share of the per-cycle wear cost.
  Trades whose price gap doesn't beat it are skipped.
- **Micro-cycling penalty:** starting a new charge or discharge run has a cost, so the
  agent commits to a few clean cycles instead of chasing every price wiggle.

The state is *(time, state of charge, current mode)*. The agent's decision table is computed with
exact Bellman updates: the same answer a fully trained Q-learning agent converges to,
computed in milliseconds and reproducible every time.

It is benchmarked against perfect hindsight and a rule-based bot (buy below the 3-hour average,
sell above it), all scored with the same accounting.

> Results are illustrative. For real markets, annual figures
> come from simulating all of 2025; for the simulated scenarios they scale a 48-hour window.
> Forecast error is simulated. Past prices don't guarantee future revenue.

## Accessibility

Every control works with the keyboard and shows a focus ring. Charts carry text descriptions for
screen readers, including the main chart's price range, trades and profit. **Explain the first
trade** opens "Why this trade?" without a mouse, with *Previous / Next trade* buttons, and
explanations are announced to screen readers. Text contrast meets WCAG AA in both themes. An automated audit
(axe-core) runs with the browser checks on every push.

## Tests

`tests/engine.test.js` checks the model with Node's built-in test runner (no installs):

```bash
node --test tests/engine.test.js
```

- The battery never leaves its allowed charge window or exceeds its power rating.
- Perfect hindsight always does at least as well as the forecast-driven AI.
- With a 0% forecast error, the AI matches perfect hindsight exactly.
- Forecasts get worse as the error setting grows.
- Accounting adds up: cycles, cumulative and step profits, revenue minus wear.
- Full year: hindsight is the maximum, limits hold, months add up to the year.
- The bundled data is a complete year; CSV uploads in common formats parse correctly.
- Solar: clipping is bounded and yields are realistic; free energy is never over-used and never
  makes the best plan worse.
- Lifetime: matches a hand-calculated NPV, IRR and payback; more cycling means earlier new cells;
  a tax credit lowers the upfront cost but not O&M.
- Every AI trade can be explained, with consistent numbers.

GitHub runs these on every push (see the **Actions** tab), together with `tools/browser_check.py`:
the page itself in Firefox, Chromium, WebKit (Safari's engine), an iPad and offline, including
the full-year simulation, revenue streams, lifetime view and "Why this trade?". Screenshots are
attached to each run.

## Repository layout

```
index.html                  The demo page
about.html, assets/about.js The About me page
Dockerfile, Caddyfile, railway.json   Railway hosting
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
tools/fetch_data.py         Downloads a year of public market data
tools/build_markets.py      Rebuilds the real-price data files
tools/build_services.py     Rebuilds the grid-services price averages
tools/build_assets.py       Rebuilds the app icons and QR code
tools/build_og.py           Rebuilds the link-preview image
tools/browser_check.py      Cross-browser smoke test (Chromium, Firefox, WebKit, iPad, offline)
tests/engine.test.js        Automated model tests; .github/workflows/test.yml runs them on every push
.github/workflows/refresh-data.yml   Monthly check for a newer full year of prices
streamlit_app/              Earlier analyst prototype in Python (Streamlit)
LICENSE.md                  PolyForm Noncommercial 1.0.0
```

To swap the profile photo, replace `assets/img/profile.jpg` (square, about 400×400). Until it
exists the page shows the initials "BI". After publishing changes, visitors who already opened
the demo get the new version on their next visit.

## Earlier analyst prototype (Python)

`streamlit_app/` is the **original Streamlit prototype, kept for reference**. It uses simulated
prices and a perfect-foresight agent only, so its numbers are not comparable with the web demo,
which is the main product. It still offers a decision log with CSV export and a heatmap of the
learned policy:

```bash
cd streamlit_app
pip install -r requirements.txt
python -m streamlit run app.py
```

## License

**PolyForm Noncommercial 1.0.0** (see [LICENSE.md](LICENSE.md)). You may use, study and modify
this code for non-commercial purposes such as learning, research and personal projects.
**Commercial use requires a separate license**: contact Baizak Isaev at baizakisaev@gmail.com or on
[LinkedIn](https://www.linkedin.com/in/baizakisaev/).

Third-party parts keep their own terms: Plotly.js (`assets/vendor/`, MIT license) and the market
data (each source's terms; the German data is CC BY 4.0, Bundesnetzagentur | SMARD.de).
