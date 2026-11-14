// Automated checks for the trading model (assets/engine.js).
// Run with:  node --test tests/engine.test.js   (Node 18+, no installs needed)
// They also run on GitHub for every push (.github/workflows/test.yml).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const E = require(path.join(__dirname, "..", "assets", "engine.js"))();
global.window = {};
require(path.join(__dirname, "..", "assets", "data", "markets.js"));
const MARKETS = global.window.GRID_MARKETS;

const DEFAULT_BATTERY = { cap: 100, pw: 25, wear: 3000, eff: 88, frag: 300, lo: 10, hi: 90 };
const SCENARIOS = {
  typical:  { seed: 42, volatility: 5,  morning: 38, evening: 75,  solar: 34, spikes: [1, 3], spikeSize: [25, 80] },
  volatile: { seed: 7,  volatility: 11, morning: 38, evening: 75,  solar: 34, spikes: [3, 5], spikeSize: [40, 120] },
  solar:    { seed: 21, volatility: 5,  morning: 30, evening: 70,  solar: 72, spikes: [0, 1], spikeSize: [20, 50] },
  heatwave: { seed: 99, volatility: 7,  morning: 50, evening: 140, solar: 25, spikes: [2, 4], spikeSize: [50, 120] },
};

// A spread of battery set-ups, including extremes of the sliders.
function batteries() {
  const rng = E.mulberry32(2024);
  const pick = (lo, hi, step) => lo + step * Math.floor(rng() * ((hi - lo) / step + 1));
  const list = [
    DEFAULT_BATTERY,
    { ...DEFAULT_BATTERY, wear: 0, frag: 0 },
    { cap: 10, pw: 200, wear: 0, eff: 98, frag: 0, lo: 0, hi: 100 },     // tiny, very fast battery
    { cap: 500, pw: 5, wear: 20000, eff: 70, frag: 2000, lo: 45, hi: 55 }, // huge, slow, narrow window
  ];
  for (let i = 0; i < 8; i++) {
    list.push({ cap: pick(10, 500, 10), pw: pick(5, 200, 5), wear: pick(0, 20000, 250), eff: pick(70, 98, 1),
                frag: pick(0, 2000, 50), lo: pick(0, 45, 5), hi: pick(55, 100, 5) });
  }
  return list;
}

// 48-hour price windows: the simulated scenarios plus slices of every real market.
function windows() {
  const out = Object.entries(SCENARIOS).map(([k, s]) => [`sim:${k}`, E.generateMarket(s)]);
  for (const [k, m] of Object.entries(MARKETS)) {
    for (const d of [0, m.typical, 150, 362]) out.push([`${k}:day${d}`, Float64Array.from(m.prices.slice(d * 96, d * 96 + E.N))]);
  }
  return out;
}

// What the agent optimises: profit after wear, minus the micro-cycling penalty per run.
const objective = (res, b) => res.net - b.frag * res.runs;
const tol = (prices, b) => 1e-6 * (1 + b.cap * Math.max(...Array.from(prices, Math.abs)));

function assertWithinLimits(res, b, g, label) {
  const lo = g.lo * g.delta - 1e-9, hi = g.hi * g.delta + 1e-9, maxMove = Math.min(b.pw * E.DT, b.cap) + 1e-9;
  for (let t = 0; t < res.moves.length; t++) {
    assert.ok(res.soc[t] >= lo && res.soc[t] <= hi, `${label}: charge ${res.soc[t]} MWh outside [${lo}, ${hi}] at step ${t}`);
    assert.ok(Math.abs(res.moves[t]) <= maxMove, `${label}: moved ${res.moves[t]} MWh in one step (limit ${maxMove})`);
  }
}

test("battery stays inside its allowed charge window and power limit", () => {
  for (const b of batteries()) {
    const g = E.socGrid(b);
    for (const [name, prices] of windows().slice(0, 8)) {
      const w = E.runWindow(prices, b, { mode: "forecast", fe: 20, seed: 1 });
      for (const [who, res] of [["AI", w.ai], ["hindsight", w.hind], ["bot", w.bot]]) {
        assertWithinLimits(res, b, g, `${who} on ${name} with ${JSON.stringify(b)}`);
      }
    }
  }
});

test("perfect hindsight always does at least as well as the forecast-driven AI", () => {
  for (const b of batteries()) {
    for (const [name, prices] of windows()) {
      for (const fe of [10, 20, 40]) {
        const w = E.runWindow(prices, b, { mode: "forecast", fe, seed: 3 });
        assert.ok(objective(w.hind, b) >= objective(w.ai, b) - tol(prices, b),
          `${name}, fe=${fe}, ${JSON.stringify(b)}: hindsight ${objective(w.hind, b)} < AI ${objective(w.ai, b)}`);
      }
    }
  }
});

test("with a perfect forecast (0% error) the AI matches perfect hindsight exactly", () => {
  for (const b of batteries()) {
    const g = E.socGrid(b);
    for (const [name, prices] of windows()) {
      const meanP = E.mean(prices);
      const hind = E.settle(prices, E.hindsightAgent(prices, b, g, meanP), b, g, meanP);
      const ai = E.settle(prices, E.forecastAgent(prices, b, g, 0, 5, meanP), b, g, meanP);
      assert.ok(Math.abs(objective(hind, b) - objective(ai, b)) <= tol(prices, b),
        `${name}, ${JSON.stringify(b)}: hindsight ${objective(hind, b)} vs AI ${objective(ai, b)}`);
    }
  }
});

test("a 0% error forecast is exactly the actual prices", () => {
  const prices = E.generateMarket(SCENARIOS.volatile);
  const f = E.forecastAt(prices, E.smooth3h(prices), 0, 0, 50, E.mean(prices), 9);
  assert.deepEqual(Array.from(f), Array.from(prices));
});

test("forecasts get worse as the error setting grows", () => {
  const prices = Float64Array.from(MARKETS.de.prices.slice(0, E.N));
  const smooth = E.smooth3h(prices), meanP = E.mean(prices), scale = E.std(prices);
  const rmse = (fe) => {
    let s = 0;
    for (let seed = 0; seed < 20; seed++) {
      const f = E.forecastAt(prices, smooth, 0, fe, scale, meanP, seed);
      for (let t = 0; t < f.length; t++) s += (f[t] - prices[t]) ** 2;
    }
    return Math.sqrt(s / (20 * prices.length));
  };
  assert.ok(rmse(10) < rmse(20) && rmse(20) < rmse(40), `rmse 10/20/40: ${rmse(10)} ${rmse(20)} ${rmse(40)}`);
});

test("accounting adds up: cycles, cumulative profit and step profits agree", () => {
  const b = DEFAULT_BATTERY;
  for (const [name, prices] of windows()) {
    const w = E.runWindow(prices, b, { mode: "forecast", fe: 20, seed: 2 });
    for (const res of [w.ai, w.hind, w.bot]) {
      const throughput = res.moves.reduce((s, m) => s + Math.abs(m), 0);
      assert.ok(Math.abs(res.cycles - throughput / (2 * b.cap)) < 1e-9, `${name}: cycles`);
      assert.ok(Math.abs(res.cum[res.cum.length - 1] - res.net) < 1e-6, `${name}: cumulative profit ends at net`);
      assert.ok(Math.abs(res.stepNet.reduce((s, v) => s + v, 0) - res.net) < 1e-6, `${name}: step profits sum to net`);
      assert.ok(Math.abs(res.revenue - res.wear - res.net) < 1e-6, `${name}: revenue − wear = net`);
    }
  }
});

test("full year: hindsight is the maximum, limits hold, months add up", () => {
  const m = MARKETS.caiso;                                     // fastest market to simulate
  const b = { ...DEFAULT_BATTERY, cap: 50, pw: 25 };
  const r = E.annual(Float64Array.from(m.prices), E.parseNaive(m.start), b, { mode: "forecast", fe: 20, seed: 42 });
  const g = E.socGrid(b);
  assert.equal(r.days, 365);
  assert.equal(r.scale, 1);
  assert.equal(r.ai.monthly.length, 12);
  for (const [who, y] of [["AI", r.ai], ["hindsight", r.hind], ["bot", r.bot]]) {
    const monthSum = y.monthly.reduce((s, mo) => s + mo.net, 0);
    assert.ok(Math.abs(monthSum - y.net) < 1e-4 * (1 + Math.abs(y.net)), `${who}: months ${monthSum} vs year ${y.net}`);
    assert.ok(y.minSoc >= g.lo * g.delta - 1e-9 && y.maxSoc <= g.hi * g.delta + 1e-9, `${who}: charge window`);
  }
  assert.ok(r.hind.net - b.frag * r.hind.runs >= r.ai.net - b.frag * r.ai.runs - 1e-3, "hindsight objective >= AI objective");
  assert.ok(r.ai.net > r.bot.net, "AI beats the rule-based bot over the year");
});

test("bundled market data: a full year of finite 15-minute prices", () => {
  for (const [k, m] of Object.entries(MARKETS)) {
    assert.equal(m.prices.length, 365 * 96, `${k}: length`);
    assert.ok(m.prices.every(Number.isFinite), `${k}: finite`);
    assert.ok(m.typical >= 0 && m.typical < 364, `${k}: typical day`);
    for (const f of ["label", "name", "currency", "unit", "tz", "source", "start"]) assert.ok(m[f], `${k}: ${f}`);
  }
});

test("CSV upload: common formats are read, bad files give clear errors", () => {
  const hours = (n, fmt) => Array.from({ length: n }, (_, h) => fmt(h, 40 + 30 * Math.sin(h / 4))).join("\n");
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (h) => `2025-06-${pad(2 + Math.floor(h / 24))} ${pad(h % 24)}:00`;

  const a = E.parseUpload("timestamp,price_eur_mwh\n" + hours(72, (h, p) => `${iso(h)},${p.toFixed(2)}`), "a.csv");
  assert.equal(a.prices.length, 72 * 4);
  assert.equal(a.currency, "€");
  assert.equal(a.start, "2025-06-02 00:00");

  const de = "Datum;Preis (EUR/MWh)\n" + Array.from({ length: 96 * 3 }, (_, q) =>
    `${pad(2 + Math.floor(q / 96))}.06.2025 ${pad(Math.floor((q % 96) / 4))}:${pad((q % 4) * 15)};${(50 + q % 7).toFixed(2).replace(".", ",")}`).join("\n");
  const b = E.parseUpload(de, "b.csv");
  assert.equal(b.prices.length, 96 * 3);
  assert.equal(b.prices[0], 50);
  assert.equal(b.prices[1], 51);

  const five = "time,rrp\n" + Array.from({ length: 12 * 50 }, (_, i) =>
    `2025/09/01 ${pad(Math.floor(i / 12) % 24)}:${pad((i % 12) * 5)},${i % 3}`).join("\n");
  assert.throws(() => E.parseUpload("a,b\nx,y\n", "x.csv"), /empty|price/i);
  assert.throws(() => E.parseUpload("time,price\n" + hours(20, (h, p) => `${iso(h)},${p}`), "short.csv"), /48 hours/);
  assert.ok(E.parseUpload(five, "five.csv").prices.length > 0, "5-minute data is averaged to 15 minutes");

  const bare = E.parseUpload(hours(60, (h, p) => p.toFixed(1)), "bare.csv");
  assert.equal(bare.prices.length, 60 * 4, "no timestamps: assumed hourly");
});

// ---------------------------------------------------------------------------- solar + storage
test("co-located solar: clipping is bounded, yields are realistic, free energy is never over-used", () => {
  for (const [site, m] of Object.entries(MARKETS)) {
    const T = m.prices.length, start = E.parseNaive(m.start);
    const none = E.solarClipping(start, T, site, 0, 1);
    assert.equal(none.clippedMWh, 0, `${site}: no panels, no clipping`);
    const sc = E.solarClipping(start, T, site, 100, 1);
    const cf = sc.producedMWh / (100 * 8760);
    assert.ok(cf > 0.08 && cf < 0.3, `${site}: yearly capacity factor ${cf}`);
    assert.ok(sc.clippedMWh > 0 && sc.clippedMWh < 0.1 * sc.producedMWh, `${site}: clipped ${sc.clippedMWh} of ${sc.producedMWh}`);
  }
  const b = DEFAULT_BATTERY, m = MARKETS.caiso, d = 180;
  const prices = Float64Array.from(m.prices.slice(d * 96, d * 96 + E.N));
  const free = E.solarClipping(E.parseNaive(m.start) + d * E.DAY_MS, E.N, "caiso", 300, 1).free;
  const w = E.runWindow(prices, b, { mode: "forecast", fe: 20, seed: 4, free });
  for (const res of [w.ai, w.hind]) {
    for (let t = 0; t < E.N; t++) {
      assert.ok(res.freeUsed[t] <= free[t] + 1e-9, `step ${t}: used ${res.freeUsed[t]} of ${free[t]} free`);
      if (res.freeUsed[t] > 0) assert.ok(res.moves[t] > 0, `step ${t}: free solar only used while charging`);
    }
  }
  const plain = E.runWindow(prices, b, { mode: "forecast", fe: 20, seed: 4 });
  assert.ok(objective(w.hind, b) >= objective(plain.hind, b) - 1e-6, "free solar never makes the best plan worse");
  assert.ok(objective(w.hind, b) >= objective(w.ai, b) - tol(prices, b), "hindsight still beats the forecast agent with solar");
});

// ---------------------------------------------------------------------------- battery lifetime
const LIFE_BASE = { years: 15, capex: 30e6, capKWh: 1e5, trading: 3e6, cyclesPerYear: 300, other: 0, cycleLife: 6000,
                    calendarFade: 0.01, augmentAt: 0.8, augCost: 150, augDecline: 0.03, omPct: 0.015, discount: 0.08, warrantyCycles: 365 };

test("lifetime: a simple case matches hand-calculated NPV, IRR and payback", () => {
  const o = { ...LIFE_BASE, years: 10, cyclesPerYear: 0, calendarFade: 0, omPct: 0, trading: 0, other: 5e6, capex: 30e6 };
  const r = E.lifetime(o);
  let npv = -30e6;
  for (let y = 1; y <= 10; y++) npv += 5e6 / 1.08 ** y;
  assert.ok(Math.abs(r.npv - npv) < 1, `npv ${r.npv} vs ${npv}`);
  assert.ok(Math.abs(r.payback - 6) < 1e-9, `payback ${r.payback}`);
  const npvAtIrr = [-30e6, ...Array(10).fill(5e6)].reduce((s, f, i) => s + f / (1 + r.irr) ** i, 0);
  assert.ok(Math.abs(npvAtIrr) < 1e3, `NPV at IRR should be ~0, got ${npvAtIrr}`);
  assert.equal(r.augments, 0);
});

test("lifetime: more cycling wears the battery faster and needs new cells sooner", () => {
  const gentle = E.lifetime({ ...LIFE_BASE, cyclesPerYear: 250 });
  const hard = E.lifetime({ ...LIFE_BASE, cyclesPerYear: 600 });
  assert.ok(hard.augments >= gentle.augments, "more augmentations");
  assert.ok(hard.firstAug != null && (gentle.firstAug == null || hard.firstAug < gentle.firstAug), "earlier first augmentation");
  assert.ok(hard.augTotal > gentle.augTotal, "more spent on cells");
  assert.equal(gentle.withinWarranty, true);
  assert.equal(hard.withinWarranty, false);
  for (const r of [gentle, hard]) for (const row of r.rows) {
    assert.ok(row.healthEnd < row.healthStart, "health falls every year");
    assert.ok(row.healthAfter >= LIFE_BASE.augmentAt - 0.2, "health stays in a sane range");
  }
});

// ---------------------------------------------------------------------------- why this trade?
test("every AI trade can be explained with consistent numbers", () => {
  const b = DEFAULT_BATTERY;
  for (const [name, prices] of windows().slice(0, 10)) {
    for (const mode of ["forecast", "hindsight"]) {
      const w = E.runWindow(prices, b, { mode, fe: 20, seed: 6 });
      for (let t = 0; t < E.N; t++) {
        const x = E.explainTrade(prices, w, b, t);
        if (w.ai.modes[t] === E.IDLE) { assert.equal(x, null); continue; }
        assert.equal(x.kind, w.ai.modes[t] === E.CHARGE ? "buy" : "sell", `${name} ${mode} t=${t}`);
        assert.ok(Number.isFinite(x.price) && x.mw > 0, `${name}: price and power`);
        if (x.kind === "buy") assert.ok(Math.abs(x.costPerStored - x.price / x.eta) < 1e-9, `${name}: cost per stored MWh`);
        if (x.margin != null) assert.ok(Number.isFinite(x.margin), `${name}: margin`);
      }
    }
  }
});
