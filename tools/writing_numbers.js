// Reproduces the numbers quoted in the two posts (battery-wear-cost.html and
// perfect-hindsight-benchmark.html, in the portfolio repository): full-year simulations on the real 2025 prices, with the
// demo's default battery and settings for each market.
// Run with:  node tools/writing_numbers.js   (Node 18+, no installs needed; takes about a minute)
"use strict";
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const E = require(path.join(ROOT, "assets", "engine.js"))();
global.window = {};
require(path.join(ROOT, "assets", "data", "markets.js"));

// The demo's defaults (assets/app.js): 100 MWh / 25 MW, 88% round trip, 6,000-cycle life.
// `aug`: new cells per kWh; `res`: share of power reserved for grid services (not traded).
const MARKETS = {
  caiso: { name: "California", cur: "$", aug: 150, res: 20 },
  de: { name: "Germany", cur: "€", aug: 120, res: 20 },
  sa: { name: "South Australia", cur: "A$", aug: 265, res: 0 },
};
const SEED = 42;
const DEFAULT_FE = 20;                                                    // forecast error, ±%
const wearFor = (aug) => Math.round((0.2 * 100 * 1000 * aug) / 6000 / 50) * 50;   // per full cycle
const money = (cur, v) => `${v < 0 ? "−" : ""}${cur}${(Math.abs(v) / 1e6).toFixed(3)}M`;

const wearRows = [], gross = [], forecastRows = [];
for (const [key, m] of Object.entries(MARKETS)) {
  require(path.join(ROOT, "assets", "data", `prices-${key}.js`));
  const data = global.window.GRID_MARKETS[key];
  const prices = Float64Array.from(data.prices), start = E.parseNaive(data.start);
  const wear = wearFor(m.aug);
  const battery = { cap: 100, pw: 25 * (1 - m.res / 100), eff: 88, frag: 300, lo: 10, hi: 90, wear };
  const year = (b, fe) => E.annual(prices, start, b, { mode: "forecast", fe, seed: SEED });

  // Post 1: the same agent with and without a price on wear, both charged for the wear they cause.
  const priced = year(battery, DEFAULT_FE);
  const blind = year({ ...battery, wear: 0 }, DEFAULT_FE);
  const afterWear = (y) => y.revenue - y.cycles * wear;
  wearRows.push({
    market: m.name, "wear/cycle": `${m.cur}${wear}`,
    "cycles (priced)": Math.round(priced.ai.cycles), "cycles (ignored)": Math.round(blind.ai.cycles),
    "net (priced)": money(m.cur, afterWear(priced.ai)), "net (ignored)": money(m.cur, afterWear(blind.ai)),
  });
  for (const [who, y] of [["AI agent", priced.ai], ["rule-based bot", priced.bot]]) {
    gross.push({ market: m.name, who, "before wear": money(m.cur, y.revenue), wear: money(m.cur, -y.wear),
                 "after wear": money(m.cur, y.net), cycles: Math.round(y.cycles) });
  }

  // Post 2: share of perfect hindsight as the forecast gets worse, plus the floor.
  const row = { market: m.name, hindsight: money(m.cur, priced.hind.net), bot: money(m.cur, priced.bot.net) };
  for (const fe of [5, 10, 20, 40]) {
    const y = fe === DEFAULT_FE ? priced : year(battery, fe);
    row[`±${fe}%`] = `${(100 * y.ai.net / y.hind.net).toFixed(1)}% (${money(m.cur, y.ai.net)})`;
  }
  forecastRows.push(row);
}

console.log("\nBefore and after wear, with wear priced (post 1, first table):");
console.table(gross);
console.log("\nWear priced vs ignored by the agent, both charged for real wear (post 1, second table):");
console.table(wearRows);
console.log("\nShare of perfect hindsight by forecast error, and the rule-based bot (post 2):");
console.table(forecastRows);
