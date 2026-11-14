# ⚡ AI Grid Trader

**An AI that trades a grid-scale battery, and protects it.**

An interactive demo of a reinforcement-learning agent that buys electricity when it is cheap,
sells it when it is expensive, and counts battery wear as a real cost, so it never burns
the asset on trades that aren't worth it. It trades on simulated markets, on real historical
prices from three markets, or on a price file you upload.

### ▶ Live demo: https://nolimitbaiza.github.io/ai-grid-trader/

The demo runs entirely in the visitor's browser: no server, no sign-up, loads in about a second
and works on phones and tablets.

---

## Presenting it

| To… | Do this |
|---|---|
| Run it unattended on a booth screen | Open **https://nolimitbaiza.github.io/ai-grid-trader/?kiosk=1**. It auto-plays every market, replaying the AI's trades with a live profit counter. Any touch hands control to the visitor; after 60 s idle it starts again. |
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

**No Wi-Fi at the venue?** Download this repo (green **Code** button → *Download ZIP*), unzip it,
and double-click `index.html`. Everything, including the charting library and the real market
data, is bundled, so it runs fully offline.

## Forecast mode: the honest benchmark

By default the agent **never sees the real future**. Every hour it receives a fresh price
forecast, re-plans the rest of the 48 hours, executes the next hour, and is scored on the prices
that actually happened. The forecast is the actual price with simulated error that misses short
spikes, flattens peaks and dips further ahead, and adds correlated noise; the **Forecast error**
slider sets how bad it is.

The **Of hindsight maximum** figure compares that with *perfect hindsight*, an agent that knows
every future price: the most any strategy could have earned. This is the number a technical
buyer will ask for.

## Real market data

Bundled: one typical week (the median-spread week of the month, not the best one) from each of:

| Market | Prices | Source |
|---|---|---|
| California | CAISO SP15 trading hub, day-ahead, May 2025 (USD) | [CAISO OASIS](https://oasis.caiso.com) |
| Germany | Germany-Luxembourg day-ahead, May 2025 (EUR) | Bundesnetzagentur / SMARD.de via [Energy-Charts](https://energy-charts.info), CC BY 4.0 |
| South Australia | NEM SA1 spot, September 2025 (AUD) | [AEMO](https://aemo.com.au) |

All are resampled to 15-minute steps. `tools/build_markets.py` rebuilds `assets/data/markets.js`
from the downloads (the URLs are in the script).

### Uploading a CSV

Any CSV with a price column works, ideally with a timestamp column; 5, 15, 30 or 60-minute data,
at least 48 hours. Comma or semicolon separated, decimal points or commas. The file is processed
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

> Results are illustrative and cover energy arbitrage only. Annual figures scale a 48-hour
> window to a year. Forecast error is simulated.

## Repository layout

```
index.html                  The demo page (served by GitHub Pages)
assets/app.js               Markets, RL agent, forecast mode, benchmarks, charts, kiosk, PDF
assets/style.css            Minimal light/dark theme and the printable business case
assets/data/markets.js      Real historical prices (15-minute)
assets/vendor/              Plotly.js (bundled for offline use)
tools/build_markets.py      Rebuilds the real-price data file
streamlit_app/              Full analyst dashboard in Python (Streamlit)
```

## Analyst dashboard (Python)

A deeper Streamlit version (simulated prices, perfect foresight) with a decision log, CSV export
and a heatmap of the learned policy:

```bash
cd streamlit_app
pip install -r requirements.txt
python -m streamlit run app.py
```
