# ⚡ AI Grid Trader

**An AI that trades a grid-scale battery, and protects it.**

An interactive demo of a reinforcement-learning agent that buys electricity when it is cheap,
sells it when it is expensive, and counts battery wear as a real cost, so it never burns
the asset on trades that aren't worth it.

### ▶ Live demo: https://nolimitbaiza.github.io/ai-grid-trader/

The demo runs entirely in the visitor's browser: no server, no sign-up, loads in about a second
and works on phones and tablets.

---

## Presenting it

| To… | Do this |
|---|---|
| Switch market scenario | Click **Typical day · Volatile · Solar surplus · Heatwave**, or press **1–4** |
| Show a different day | Click **New day**, or press **N** |
| Go full screen | Click **Present**, or press **F** |
| Send a customer the exact scenario you showed | Click **Share**: the link stores every setting |
| Make the point about battery health | Drag **Wear cost per cycle** to $0 and watch the AI start micro-cycling |

**No Wi-Fi at the venue?** Download this repo (green **Code** button → *Download ZIP*), unzip it,
and double-click `index.html`. Everything, including the charting library, is bundled, so it
runs fully offline.

## Putting it on your website

Link to the live demo, or embed it with an iframe. `?embed=1` hides the page header,
intro and footer so only the demo shows:

```html
<iframe
  src="https://nolimitbaiza.github.io/ai-grid-trader/?embed=1"
  style="width:100%; height:1150px; border:0;"
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

It is benchmarked against a rule-based bot (buy below the 3-hour average, sell above it) that
trades the same market with the same battery and the same accounting.

> Prices are simulated. Results are illustrative and cover energy arbitrage only.

## Repository layout

```
index.html                  The demo page (served by GitHub Pages)
assets/app.js               Market simulation, RL agent, benchmark bot, charts
assets/style.css            Minimal light/dark theme
assets/vendor/              Plotly.js (bundled for offline use)
streamlit_app/              Full analyst dashboard in Python (Streamlit)
```

## Analyst dashboard (Python)

A deeper Streamlit version with a decision log, CSV export and a heatmap of the learned policy:

```bash
cd streamlit_app
pip install -r requirements.txt
python -m streamlit run app.py
```
