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
repeated across their quarter-hours. `tools/build_markets.py` rebuilds `assets/data/markets.js`
from the public downloads (the URLs are in the script).

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

> Results are illustrative and cover energy arbitrage only. For real markets, annual figures
> come from simulating all of 2025; for the simulated scenarios they scale a 48-hour window.
> Forecast error is simulated. Past prices don't guarantee future revenue.

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

GitHub runs these on every push (see the **Actions** tab). `tools/browser_check.py` is a separate
cross-browser check of the page itself (Chromium, Firefox, WebKit, iPad, offline).

## Repository layout

```
index.html                  The demo page (served by GitHub Pages)
assets/engine.js            The model: markets, RL agent, forecasts, benchmarks, accounting, full year
assets/app.js               The page: controls, charts, full-year worker, kiosk, PDF, sharing
assets/style.css            Minimal light/dark theme and the printable business case
assets/data/markets.js      Real prices for all of 2025 (15-minute)
assets/vendor/              Plotly.js (bundled for offline use)
assets/img/                 Profile photo and LinkedIn QR code
assets/icons/, manifest.webmanifest, sw.js   Installable app + offline cache
assets/og.png               Link-preview image
tools/build_markets.py      Rebuilds the real-price data file
tools/build_assets.py       Rebuilds the app icons and QR code
tools/build_og.py           Rebuilds the link-preview image
tools/browser_check.py      Cross-browser smoke test (Chromium, Firefox, WebKit, iPad, offline)
tests/engine.test.js        Automated model tests; .github/workflows/test.yml runs them
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
