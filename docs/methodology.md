# Methodology

How the agent makes decisions, which data it uses, and how the financial results are calculated.

[Back to the project overview](../README.md)

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
