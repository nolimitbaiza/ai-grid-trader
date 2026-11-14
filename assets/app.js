/*
 * AI Grid Trader: browser edition.
 *
 * Runs entirely in the visitor's browser (no server), so it can be hosted on any static
 * website or GitHub Pages, embedded in an iframe, or opened straight from disk offline.
 *
 *   1. MARKET    simulated 48h prices, real historical prices (assets/data/markets.js),
 *                or a CSV the visitor uploads (processed locally, never sent anywhere)
 *   2. AI AGENT  exact Bellman backups over (time, state of charge, operating mode): the
 *                decision table a fully trained Q-learning agent converges to.
 *                Forecast mode: the agent only sees a noisy forecast, re-plans every hour
 *                (model-predictive control) and is scored on the actual prices.
 *   3. BENCHMARKS  perfect hindsight (theoretical maximum) and a rule-based bot
 *   4. LEDGER    one shared accounting of cash, battery wear and cycles for everyone
 *
 * Extras for presenting: kiosk auto-play, shareable links, a printable business case,
 * and a light/dark switch.
 *
 * Reward per step = arbitrage cash − battery wear − penalty for starting a new trade run.
 */
(function () {
  "use strict";

  // ------------------------------------------------------------------------------------
  // Constants & configuration
  // ------------------------------------------------------------------------------------
  const STEPS_PER_HOUR = 4;
  const DT = 1 / STEPS_PER_HOUR;          // hours per interval
  const N = 48 * STEPS_PER_HOUR;          // 192 decision points (48 hours)
  const NEG = -1e12;                      // value of an impossible state
  const IDLE = 0, CHARGE = 1, DISCHARGE = 2;
  const BASE_PRICE = 42;                  // $/MWh off-peak level for simulated markets
  const DAY_MS = 864e5, STEP_MS = DT * 3600e3;

  // Simulated scenarios.
  const SIM = {
    typical:  { label: "Typical day",   seed: 42, volatility: 5,  morning: 38, evening: 75,  solar: 34, spikes: [1, 3], spikeSize: [25, 80] },
    volatile: { label: "Volatile",      seed: 7,  volatility: 11, morning: 38, evening: 75,  solar: 34, spikes: [3, 5], spikeSize: [40, 120] },
    solar:    { label: "Solar surplus", seed: 21, volatility: 5,  morning: 30, evening: 70,  solar: 72, spikes: [0, 1], spikeSize: [20, 50] },
    heatwave: { label: "Heatwave",      seed: 99, volatility: 7,  morning: 50, evening: 140, solar: 25, spikes: [2, 4], spikeSize: [50, 120] },
  };
  // Real historical markets, bundled as 15-minute series (see tools/build_markets.py).
  const REAL = window.GRID_MARKETS || {};
  let uploaded = null;                    // a market built from the visitor's CSV

  // Chart colours, mirrored from style.css (charts are drawn in JS, and the PDF always uses light).
  const PALETTES = {
    light: { ink: "#0c0a09", muted: "#78716c", line: "#e7e5e4", surface: "#ffffff", price: "#d97706", forecast: "#a8a29e",
             soc: "#3b82f6", socFill: "rgba(59,130,246,0.12)", charge: "#16a34a", discharge: "#dc2626", bot: "#a8a29e" },
    dark:  { ink: "#f5f5f4", muted: "#a1a1aa", line: "#27272a", surface: "#151517", price: "#fbbf24", forecast: "#71717a",
             soc: "#60a5fa", socFill: "rgba(96,165,250,0.14)", charge: "#22c55e", discharge: "#f87171", bot: "#71717a" },
  };

  // Currency of the market on screen (real markets trade in their own currency).
  let CUR = "$";
  const fmtNum = (v) => Math.round(Math.abs(v)).toLocaleString("en-US");
  const money = (v) => (v < 0 ? "−" : "") + CUR + fmtNum(v);
  const signedMoney = (v) => (v >= 0 ? "+" : "−") + CUR + fmtNum(v);
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const std = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };

  // Slider definitions. `main` sliders are always visible; the rest sit under "More settings".
  const CONTROLS = [
    { key: "cap",   label: "Battery size",          min: 10,  max: 500,   step: 10,  fmt: (v) => `${v} MWh`, main: true },
    { key: "pw",    label: "Power rating",          min: 5,   max: 200,   step: 5,   fmt: (v) => `${v} MW`, main: true },
    { key: "wear",  label: "Wear cost per cycle",   min: 0,   max: 20000, step: 250, fmt: (v) => money(v), main: true },
    { key: "fe",    label: "Forecast error",        min: 0,   max: 40,    step: 5,   fmt: (v) => (v === 0 ? "none" : `±${v}%`), main: true },
    { key: "vol",   label: "Price volatility",      min: 0,   max: 15,    step: 0.5, fmt: (v) => `±${CUR}${v}/MWh`, simOnly: true },
    { key: "eff",   label: "Round-trip efficiency", min: 70,  max: 98,    step: 1,   fmt: (v) => `${v}%` },
    { key: "frag",  label: "Micro-cycling penalty", min: 0,   max: 2000,  step: 50,  fmt: (v) => `${money(v)} / run` },
    { key: "capex", label: "Installed cost",        min: 100, max: 600,   step: 25,  fmt: (v) => `${CUR}${v}/kWh` },
    { key: "lo",    label: "Lowest charge level",   min: 0,   max: 45,    step: 5,   fmt: (v) => `${v}%` },
    { key: "hi",    label: "Highest charge level",  min: 55,  max: 100,   step: 5,   fmt: (v) => `${v}%` },
  ];

  const DEFAULTS = { p: "typical", d: 0, mode: "forecast", cap: 100, pw: 25, wear: 3000, fe: 20, vol: 5,
                     eff: 88, frag: 300, capex: 300, lo: 10, hi: 90, seed: 42 };

  // ------------------------------------------------------------------------------------
  // Dates: every timestamp is "market local time", handled as naive UTC so the
  // visitor's own time zone never shifts the chart.
  // ------------------------------------------------------------------------------------
  const pad = (n) => String(n).padStart(2, "0");
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function parseNaive(s) {
    const [d, t = "00:00"] = s.split(" ");
    const [Y, M, D] = d.split("-").map(Number);
    const [h, mi] = t.split(":").map(Number);
    return Date.UTC(Y, M - 1, D, h, mi);
  }
  function fmtNaive(ms) {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  }
  const fmtDay = (ms) => { const d = new Date(ms); return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MO[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
  const fmtShortDay = (ms) => { const d = new Date(ms); return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MO[d.getUTCMonth()]}`; };
  const fmtClock = (ms) => { const d = new Date(ms); return `${WD[d.getUTCDay()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
  function todayMs() { const n = new Date(); return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()); }

  // ------------------------------------------------------------------------------------
  // 1. Markets
  // ------------------------------------------------------------------------------------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gaussian(rng) {
    let u = 0;
    while (u === 0) u = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
  }
  const bump = (h, center, width, height) => height * Math.exp(-0.5 * ((h - center) / width) ** 2);

  // Simulated "duck curve" market: morning + evening peaks, midday solar dip, noise, spikes.
  function generateMarket(m) {
    const rng = mulberry32(m.seed);
    const day2Scale = 0.9 + 0.3 * rng();
    const price = new Float64Array(N);
    const eveningIdx = [];
    let noise = 0;
    for (let t = 0; t < N; t++) {
      const hod = (t * DT) % 24;
      let shape = BASE_PRICE
        + bump(hod, 8, 1.6, m.morning)
        + bump(hod, 19, 2.0, m.evening)
        - bump(hod, 13, 2.4, m.solar)
        - bump(hod, 3.5, 2.2, 12);
      if (t * DT >= 24) shape *= day2Scale;
      noise = t === 0 ? 0 : 0.8 * noise + m.volatility * gaussian(rng);
      price[t] = shape + noise;
      if (hod >= 17 && hod <= 21) eveningIdx.push(t);
    }
    const count = m.spikes[0] + Math.floor(rng() * (m.spikes[1] - m.spikes[0] + 1));
    for (let k = 0; k < count; k++) {
      const start = eveningIdx[Math.floor(rng() * eveningIdx.length)];
      const len = 2 + Math.floor(rng() * 3);
      const size = m.spikeSize[0] + rng() * (m.spikeSize[1] - m.spikeSize[0]);
      for (let t = start; t < Math.min(N, start + len); t++) price[t] += size;
    }
    for (let t = 0; t < N; t++) price[t] = Math.max(price[t], -25);
    return price;
  }

  const realMarket = (key) => (key === "upload" ? uploaded : REAL[key]);
  const dayCount = (m) => Math.max(1, Math.floor(m.prices.length / 96) - 1);   // possible 48h windows

  // The 48 hours of prices to trade, plus labels for the chosen market.
  function marketFor(state) {
    const sim = SIM[state.p];
    if (sim) {
      return {
        prices: generateMarket({ ...sim, seed: state.seed, volatility: state.vol }),
        startMs: todayMs(), currency: "$", label: sim.label, real: false,
      };
    }
    const m = realMarket(state.p);
    const d = Math.min(Math.max(0, state.d | 0), dayCount(m) - 1);
    return {
      prices: Float64Array.from(m.prices.slice(d * 96, d * 96 + N)),
      startMs: parseNaive(m.start) + d * DAY_MS, currency: m.currency, label: m.label, real: true, meta: m, d,
    };
  }

  // ------------------------------------------------------------------------------------
  // 2. Battery state-of-charge grid: full power for one interval = whole number of steps
  // ------------------------------------------------------------------------------------
  function socGrid(b) {
    const eMax = Math.min(b.pw * DT, b.cap);
    const J = Math.max(1, Math.round(eMax / (b.cap / 100)));
    const delta = eMax / J;
    const S = Math.floor(b.cap / delta + 1e-9) + 1;
    const lo = Math.max(0, Math.ceil((b.lo / 100) * b.cap / delta - 1e-9));
    let hi = Math.min(S - 1, Math.floor((b.hi / 100) * b.cap / delta + 1e-9));
    if (hi <= lo) hi = Math.min(S - 1, lo + 1);
    const startPct = Math.min(Math.max(50, b.lo), b.hi);
    const s0 = Math.min(hi, Math.max(lo, Math.round((startPct / 100) * b.cap / delta)));
    return { delta, S, J, lo, hi, s0 };
  }

  // ------------------------------------------------------------------------------------
  // 3. The AI agent: converged Q-values via backward induction (Bellman optimality).
  //    Returns the optimal action (signed grid steps) for every (time, SOC, mode).
  // ------------------------------------------------------------------------------------
  function solve(prices, b, g, terminalPrice, keepSteps) {
    const T = prices.length, S = g.S, J = g.J;
    const eta = Math.sqrt(b.eff / 100);
    const wearPerMWh = b.wear / (2 * b.cap);
    const rc = new Float64Array(J + 1), rd = new Float64Array(J + 1);
    let V = new Float64Array(S * 3).fill(NEG);
    let Vn = new Float64Array(S * 3);

    // Terminal value: finish at least as full as the battery started; surplus is worth the average price.
    for (let s = Math.max(g.lo, g.s0); s <= g.hi; s++) {
      const v = (s - g.s0) * g.delta * terminalPrice;
      V[s * 3] = V[s * 3 + 1] = V[s * 3 + 2] = v;
    }

    const keep = Math.min(T, keepSteps == null ? T : keepSteps);
    const policy = new Int16Array(keep * S * 3);
    for (let t = T - 1; t >= 0; t--) {
      const p = prices[t];
      for (let j = 1; j <= J; j++) {
        const e = j * g.delta;
        rc[j] = (-p * e) / eta - e * wearPerMWh;      // pay to charge, plus wear
        rd[j] = p * e * eta - e * wearPerMWh;         // paid to discharge, minus wear
      }
      Vn.fill(NEG);
      for (let s = g.lo; s <= g.hi; s++) {
        const hold = V[s * 3 + IDLE];
        let bestC = NEG, jC = 0;
        const maxC = Math.min(J, g.hi - s);
        for (let j = 1; j <= maxC; j++) { const q = rc[j] + V[(s + j) * 3 + CHARGE]; if (q > bestC) { bestC = q; jC = j; } }
        let bestD = NEG, jD = 0;
        const maxD = Math.min(J, s - g.lo);
        for (let j = 1; j <= maxD; j++) { const q = rd[j] + V[(s - j) * 3 + DISCHARGE]; if (q > bestD) { bestD = q; jD = -j; } }
        // Starting a new charge/discharge run (from a different mode) pays the micro-cycling penalty.
        for (let m = 0; m < 3; m++) {
          let best = hold, act = 0;
          const qC = bestC - (m === CHARGE ? 0 : b.frag);
          if (jC && qC > best) { best = qC; act = jC; }
          const qD = bestD - (m === DISCHARGE ? 0 : b.frag);
          if (jD && qD > best) { best = qD; act = jD; }
          Vn[s * 3 + m] = best;
          if (t < keep) policy[(t * S + s) * 3 + m] = act;
        }
      }
      const tmp = V; V = Vn; Vn = tmp;
    }
    return { policy, S };
  }

  // Execute `steps` decisions of a plan from (s, m), writing into moves/soc at `offset`.
  function rollout(plan, g, steps, s, m, moves, soc, offset) {
    for (let k = 0; k < steps; k++) {
      const j = plan.policy[(k * plan.S + s) * 3 + m];
      s += j;
      m = j > 0 ? CHARGE : j < 0 ? DISCHARGE : IDLE;
      moves[offset + k] = j * g.delta;
      soc[offset + k] = s * g.delta;
    }
    return { s, m };
  }

  // Perfect hindsight: plans on the actual prices (theoretical maximum).
  function hindsightAgent(prices, b, g, meanP) {
    const moves = new Float64Array(N), soc = new Float64Array(N);
    rollout(solve(prices, b, g, meanP), g, N, g.s0, IDLE, moves, soc, 0);
    return { moves, soc };
  }

  // A price forecast issued at step `tau`. Only the current interval is known exactly. Beyond
  // that the forecast (a) misses short spikes and sharp moves: it follows a 3-hour average of
  // the actual price, (b) pulls peaks and dips toward the average as lead time grows, and
  // (c) carries correlated random error. At 0% error it equals the actual prices.
  function forecastAt(prices, smooth, tau, errPct, scale, meanP, seed) {
    const T = prices.length - tau, out = new Float64Array(T);
    const rng = mulberry32((Math.imul(seed + 1, 2654435761) ^ Math.imul(tau + 7, 40503)) >>> 0);
    const sigma = (errPct / 100) * scale;
    const pull = Math.min(0.75, errPct / 40);
    const blur = Math.min(1, errPct / 10);
    let e = gaussian(rng);
    for (let k = 0; k < T; k++) {
      const p = prices[tau + k];
      if (k === 0) { out[0] = p; continue; }
      e = 0.9 * e + 0.4359 * gaussian(rng);                    // unit-variance AR(1) error
      const L = k * DT;
      const shape = p + blur * Math.min(1, L / 2) * (smooth[tau + k] - p);
      out[k] = shape + pull * Math.min(1, L / 24) * (meanP - shape) + sigma * Math.min(1, Math.sqrt((L + 0.5) / 6)) * e;
    }
    return out;
  }

  // Realistic agent: re-plans every hour on the latest forecast, executes the next hour.
  function forecastAgent(prices, b, g, errPct, seed, meanP) {
    const moves = new Float64Array(N), soc = new Float64Array(N);
    const scale = std(prices) + 0.5 * Math.abs(meanP);
    const smooth = new Float64Array(N);                        // centred 3-hour moving average
    for (let t = 0; t < N; t++) {
      let sum = 0, n = 0;
      for (let k = Math.max(0, t - 6); k <= Math.min(N - 1, t + 6); k++) { sum += prices[k]; n++; }
      smooth[t] = sum / n;
    }
    let s = g.s0, m = IDLE, first = null;
    for (let tau = 0; tau < N; tau += STEPS_PER_HOUR) {
      const f = forecastAt(prices, smooth, tau, errPct, scale, meanP, seed);
      if (!first) first = f;
      const plan = solve(f, b, g, meanP, STEPS_PER_HOUR);
      ({ s, m } = rollout(plan, g, Math.min(STEPS_PER_HOUR, N - tau), s, m, moves, soc, tau));
    }
    return { moves, soc, forecast: first };
  }

  // ------------------------------------------------------------------------------------
  // 4. Benchmark: rule-based bot that reacts to every wiggle (no wear model, no foresight)
  // ------------------------------------------------------------------------------------
  function runBot(prices, g, lookback = 12) {
    const moves = new Float64Array(N), soc = new Float64Array(N);
    const band = 0.05 * Math.max(10, std(prices));             // ~$2/MWh on a typical day
    let s = g.s0;
    for (let t = 0; t < N; t++) {
      const from = Math.max(0, t - lookback);
      let ref = prices[t];
      if (t > from) { ref = 0; for (let k = from; k < t; k++) ref += prices[k]; ref /= t - from; }
      let j = 0;
      if (prices[t] < ref - band && s < g.hi) j = Math.min(g.J, g.hi - s);
      else if (prices[t] > ref + band && s > g.lo) j = -Math.min(g.J, s - g.lo);
      s += j;
      moves[t] = j * g.delta;
      soc[t] = s * g.delta;
    }
    return { moves, soc };
  }

  // ------------------------------------------------------------------------------------
  // 5. Shared ledger: cash, wear, cycles. Identical scoring for every strategy.
  // ------------------------------------------------------------------------------------
  function settle(prices, run, b, g, meanP) {
    const eta = Math.sqrt(b.eff / 100);
    const wearPerMWh = b.wear / (2 * b.cap);
    const modes = new Int8Array(N), cum = new Float64Array(N);
    let cash = 0, wear = 0, throughput = 0, running = 0, runs = 0;
    for (let t = 0; t < N; t++) {
      const e = run.moves[t];
      const c = e > 0 ? (-prices[t] * e) / eta : -prices[t] * e * eta;
      const w = Math.abs(e) * wearPerMWh;
      cash += c; wear += w; throughput += Math.abs(e);
      running += c - w;
      cum[t] = running;
      modes[t] = e > 1e-9 ? CHARGE : e < -1e-9 ? DISCHARGE : IDLE;
      if (modes[t] !== IDLE && modes[t] !== (t ? modes[t - 1] : IDLE)) runs++;
    }
    // Energy left in (or missing from) the battery at the end is valued at the average price.
    const inventory = (run.soc[N - 1] - g.s0 * g.delta) * meanP;
    cum[N - 1] += inventory;
    const revenue = cash + inventory;
    return {
      moves: run.moves, modes, cum, revenue, wear, net: revenue - wear, runs,
      cycles: throughput / (2 * b.cap),
      socPct: Array.from(run.soc, (v) => (v / b.cap) * 100),
    };
  }

  function simulate(state) {
    const mk = marketFor(state);
    CUR = mk.currency;
    const prices = mk.prices;
    const g = socGrid(state);
    const meanP = mean(prices);

    const t0 = performance.now();
    const hind = settle(prices, hindsightAgent(prices, state, g, meanP), state, g, meanP);
    const useForecast = state.mode === "forecast" && state.fe > 0;
    let ai = hind, forecast = null;
    if (useForecast) {
      const run = forecastAgent(prices, state, g, state.fe, state.seed, meanP);
      ai = settle(prices, run, state, g, meanP);
      forecast = run.forecast;
    }
    const ms = performance.now() - t0;
    const bot = settle(prices, runBot(prices, g), state, g, meanP);

    const capex = state.cap * 1000 * state.capex;
    const annual = ai.net * 182.5;                              // 48h → one year
    const X = Array.from({ length: N }, (_, t) => fmtNaive(mk.startMs + t * STEP_MS));
    return {
      mk, X, XEND: fmtNaive(mk.startMs + N * STEP_MS), prices, ai, hind, bot, forecast, useForecast, ms,
      capex, annual, roi: (annual / capex) * 100, payback: annual > 0 ? capex / annual : Infinity,
      captured: hind.net > 1 ? (ai.net / hind.net) * 100 : null,
    };
  }

  // ------------------------------------------------------------------------------------
  // 6. CSV upload: find a price column (and timestamps), resample to 15 minutes
  // ------------------------------------------------------------------------------------
  function parseDate(s) {
    if (!s) return null;
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2}))?/);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
    m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[ T,]+(\d{1,2}):(\d{2}))?/);
    if (m) {
      const dayFirst = s.includes(".") || +m[1] > 12;
      const D = dayFirst ? +m[1] : +m[2], M = dayFirst ? +m[2] : +m[1];
      return Date.UTC(+m[3], M - 1, D, +(m[4] || 0), +(m[5] || 0));
    }
    return null;
  }

  function parseUpload(text, filename) {
    const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 3) throw new Error("That file looks empty.");
    const delim = [",", ";", "\t"].reduce((a, d) => (lines[0].split(d).length > lines[0].split(a).length ? d : a), ",");
    const split = (l) => l.split(delim).map((c) => c.trim().replace(/^"(.*)"$/, "$1").trim());
    const toNum = (s) => {
      if (!s) return NaN;
      let t = s.replace(/\s/g, "");
      if (delim === ";" && t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");   // European decimals
      return /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t) ? parseFloat(t) : NaN;
    };
    const rows = lines.map(split);
    const header = rows[0].some((c) => c && Number.isNaN(toNum(c)) && parseDate(c) === null) ? rows.shift() : null;
    const ncol = Math.max(...rows.slice(0, 50).map((r) => r.length));
    const sample = rows.slice(0, 300);
    const share = (test) => (c) => sample.filter((r) => test(r[c])).length / sample.length;
    let dateCol = -1;
    for (let c = 0; c < ncol; c++) if (share((v) => parseDate(v) !== null)(c) > 0.9) { dateCol = c; break; }
    const priceCols = [];
    for (let c = 0; c < ncol; c++) if (c !== dateCol && share((v) => !Number.isNaN(toNum(v)))(c) > 0.9) priceCols.push(c);
    if (!priceCols.length) throw new Error("Couldn't find a column of prices in that file.");
    let pc = priceCols[priceCols.length - 1];
    if (header) {
      const named = priceCols.find((c) => /price|lmp|rrp|spot|eur|usd|aud|gbp|mwh/i.test(header[c] || ""));
      if (named !== undefined) pc = named;
    }

    let vals = [], times = [];
    for (const r of rows) {
      const v = toNum(r[pc]);
      if (Number.isNaN(v)) continue;
      vals.push(v);
      if (dateCol >= 0) times.push(parseDate(r[dateCol]));
    }
    let step = 60, startMs = todayMs();
    const timed = dateCol >= 0 && times.length > 2 && times.every((t) => t !== null);
    if (timed) {
      if (times[times.length - 1] < times[0]) { vals.reverse(); times.reverse(); }
      const diffs = times.slice(1).map((t, i) => (t - times[i]) / 60000).filter((d) => d > 0).sort((a, b) => a - b);
      step = Math.round(diffs[Math.floor(diffs.length / 2)]);
      startMs = times[0];
    }
    let p15;
    if (step >= 15 && step % 15 === 0) {
      p15 = vals.flatMap((v) => Array(step / 15).fill(v));
    } else if (step > 0 && step < 15 && 15 % step === 0) {
      const k = 15 / step;
      p15 = [];
      for (let i = 0; i + k <= vals.length; i += k) p15.push(mean(vals.slice(i, i + k)));
    } else {
      throw new Error(`Unsupported time step (${step} min). Use 5, 15, 30 or 60-minute prices.`);
    }
    if (p15.length < N) throw new Error(`Need at least 48 hours of prices; this file has about ${Math.floor(p15.length / 4)} hours.`);
    p15 = p15.slice(0, 96 * 62);
    const h = (header || []).join(" ");
    const currency = /€|eur/i.test(h) ? "€" : /£|gbp/i.test(h) ? "£" : /aud|a\$/i.test(h) ? "A$" : "$";
    const days = Math.floor(p15.length / 96);
    return {
      label: "Your data", name: filename, currency, unit: `${currency}/MWh`,
      tz: timed ? "times as in your file" : "no timestamps found; assumed hourly",
      source: "your uploaded file (processed only in this browser)",
      start: fmtNaive(startMs), prices: p15,
      note: `Loaded ${days} day${days === 1 ? "" : "s"} of ${timed ? step + "-minute" : "hourly"} prices`,
    };
  }

  // ------------------------------------------------------------------------------------
  // 7. State ⇄ URL hash, so a scenario can be shared as a link
  // ------------------------------------------------------------------------------------
  function readState() {
    const s = { ...DEFAULTS };
    const params = new URLSearchParams(location.hash.slice(1));
    const p = params.get("p");
    if (SIM[p] || REAL[p]) s.p = p;
    if (SIM[s.p]) { s.vol = SIM[s.p].volatility; s.seed = SIM[s.p].seed; }
    if (params.get("mode") === "hindsight") s.mode = "hindsight";
    for (const c of CONTROLS) {
      const v = parseFloat(params.get(c.key));
      if (Number.isFinite(v)) s[c.key] = Math.min(c.max, Math.max(c.min, v));
    }
    const seed = parseInt(params.get("seed"), 10);
    if (Number.isFinite(seed)) s.seed = Math.abs(seed) % 100000;
    const d = parseInt(params.get("d"), 10);
    if (Number.isFinite(d) && d >= 0) s.d = d;
    return s;
  }
  function writeState() {
    const params = new URLSearchParams();
    params.set("p", state.p);
    if (!SIM[state.p]) params.set("d", state.d);
    params.set("mode", state.mode);
    for (const c of CONTROLS) if (!(c.simOnly && !SIM[state.p])) params.set(c.key, state[c.key]);
    if (SIM[state.p]) params.set("seed", state.seed);
    history.replaceState(null, "", location.pathname + location.search + "#" + params.toString());
  }

  // ------------------------------------------------------------------------------------
  // 8. Rendering
  // ------------------------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const effectiveTheme = () =>
    document.documentElement.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const palette = () => PALETTES[effectiveTheme()];
  const PLOT_CONFIG = { displayModeBar: false, responsive: true };

  function baseLayout(c, r) {
    return {
      margin: { l: 48, r: 44, t: 8, b: 28 },
      showlegend: false,
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: getComputedStyle(document.body).fontFamily, size: 12, color: c.muted },
      hovermode: "x unified",
      hoverlabel: { bgcolor: c.surface, bordercolor: c.line, font: { color: c.ink, size: 12 } },
      xaxis: { type: "date", tickformat: "%a %H:%M", showgrid: false, linecolor: c.line, fixedrange: true, range: [r.X[0], r.XEND] },
      yaxis: { gridcolor: c.line, zeroline: false, fixedrange: true, tickprefix: CUR },
    };
  }

  // Contiguous charge/discharge runs (for the shaded bands), clipped at `upto`.
  function blocks(modes, upto) {
    const out = [];
    let start = -1;
    for (let t = 0; t <= upto; t++) {
      const m = t < upto ? modes[t] : IDLE;
      if (start >= 0 && m !== modes[start]) { out.push([modes[start], start, t]); start = -1; }
      if (start < 0 && m !== IDLE) start = t;
    }
    return out;
  }

  // Main chart. `upto` < N draws the battery's decisions only up to that step (auto-play).
  function renderMainChart(r, c, upto, el) {
    const { ai, prices, X } = r;
    const pick = (mode) => { const idx = []; for (let t = 0; t < upto; t++) if (ai.modes[t] === mode) idx.push(t); return idx; };
    const buys = pick(CHARGE), sells = pick(DISCHARGE);
    const traces = [
      {
        x: X.slice(0, upto), y: ai.socPct.slice(0, upto), yaxis: "y2", name: "Battery", type: "scatter", mode: "lines",
        line: { color: c.soc, width: 1.5 }, fill: "tozeroy", fillcolor: c.socFill,
        hovertemplate: "Battery %{y:.0f}%<extra></extra>",
      },
    ];
    if (r.forecast) {
      traces.push({
        x: X, y: Array.from(r.forecast), name: "Forecast", type: "scatter", mode: "lines",
        line: { color: c.forecast, width: 1.5, dash: "dash" }, hovertemplate: `Forecast ${CUR}%{y:.0f}<extra></extra>`,
      });
    }
    traces.push(
      {
        x: X, y: Array.from(prices), name: "Price", type: "scatter", mode: "lines",
        line: { color: c.price, width: 2 }, hovertemplate: `Price ${CUR}%{y:.0f}/MWh<extra></extra>`,
      },
      {
        x: buys.map((t) => X[t]), y: buys.map((t) => prices[t]), name: "AI buys", type: "scatter", mode: "markers",
        marker: { symbol: "triangle-up", size: 9, color: c.charge, line: { width: 1, color: c.surface } },
        customdata: buys.map((t) => ai.moves[t] / DT), hovertemplate: "Buy %{customdata:.0f} MW<extra></extra>",
      },
      {
        x: sells.map((t) => X[t]), y: sells.map((t) => prices[t]), name: "AI sells", type: "scatter", mode: "markers",
        marker: { symbol: "triangle-down", size: 9, color: c.discharge, line: { width: 1, color: c.surface } },
        customdata: sells.map((t) => -ai.moves[t] / DT), hovertemplate: "Sell %{customdata:.0f} MW<extra></extra>",
      }
    );
    const shapes = blocks(ai.modes, upto).map(([mode, i0, i1]) => ({
      type: "rect", xref: "x", yref: "paper", x0: X[i0], x1: i1 < N ? X[i1] : r.XEND, y0: 0, y1: 1,
      fillcolor: mode === CHARGE ? c.charge : c.discharge, opacity: 0.07, line: { width: 0 }, layer: "below",
    }));
    shapes.push({ type: "line", xref: "x", yref: "paper", x0: X[N / 2], x1: X[N / 2], y0: 0, y1: 1, line: { color: c.line, width: 1, dash: "dot" } });
    if (upto < N) {
      const at = upto > 0 ? X[upto - 1] : X[0];
      shapes.push({ type: "line", xref: "x", yref: "paper", x0: at, x1: at, y0: 0, y1: 1, line: { color: c.ink, width: 1.5 } });
    }
    const layout = baseLayout(c, r);
    layout.shapes = shapes;
    layout.yaxis2 = {
      overlaying: "y", side: "right", range: [0, 105], tickmode: "array",
      tickvals: [0, 25, 50, 75, 100], ticktext: ["0%", "25%", "50%", "75%", "100%"],
      showgrid: false, zeroline: false, fixedrange: true,
    };
    return Plotly.react(el, traces, layout, PLOT_CONFIG);
  }

  function renderCumChart(r, c) {
    const traces = [
      { x: r.X, y: Array.from(r.bot.cum), name: "Bot", type: "scatter", mode: "lines",
        line: { color: c.bot, width: 2, dash: "dot" }, hovertemplate: "Bot %{y:,.0f}<extra></extra>" },
    ];
    if (r.useForecast) {
      traces.push({ x: r.X, y: Array.from(r.hind.cum), name: "Hindsight", type: "scatter", mode: "lines",
        line: { color: c.soc, width: 1.5, dash: "dash" }, hovertemplate: "Hindsight %{y:,.0f}<extra></extra>" });
    }
    traces.push({ x: r.X, y: Array.from(r.ai.cum), name: "AI", type: "scatter", mode: "lines",
      line: { color: c.ink, width: 2.5 }, hovertemplate: "AI %{y:,.0f}<extra></extra>" });
    const layout = baseLayout(c, r);
    layout.margin = { l: 56, r: 8, t: 8, b: 28 };
    layout.yaxis.tickformat = ",.2s";
    layout.yaxis.zeroline = true;
    layout.yaxis.zerolinecolor = c.muted;
    Plotly.react("chart-cum", traces, layout, PLOT_CONFIG);
  }

  function kpiList(r) {
    const { ai, bot, hind } = r;
    const uplift = ai.net - bot.net;
    const payback = Number.isFinite(r.payback) ? `${r.payback.toFixed(1)}-year payback` : "no payback at these settings";
    const captured = r.captured == null ? "—" : `${Math.round(r.captured)}%`;
    return [
      { label: "Net profit, 48 hours", value: money(ai.net), sub: "after battery wear", cls: ai.net < 0 ? "neg" : "" },
      { label: "vs. rule-based bot", value: signedMoney(uplift), sub: `bot: ${money(bot.net)}`, cls: uplift >= 0 ? "pos" : "neg" },
      { label: "Of hindsight maximum", value: captured,
        sub: r.useForecast ? `max: ${money(hind.net)}` : "agent sees the future" },
      { label: "Battery cycles used", value: ai.cycles.toFixed(2), sub: `bot: ${bot.cycles.toFixed(2)}` },
      { label: "Estimated annual ROI", value: `${r.roi.toFixed(1)}%`, sub: payback, cls: r.roi < 0 ? "neg" : "" },
    ];
  }

  function renderKpis(r) {
    $("kpis").innerHTML = kpiList(r).map((k) => `
      <div class="kpi">
        <div class="label">${k.label}</div>
        <div class="value ${k.cls || ""}">${k.value}</div>
        <div class="sub">${k.sub}</div>
      </div>`).join("");
  }

  function renderInsight(r) {
    const { ai, bot } = r;
    const uplift = ai.net - bot.net;
    const saved = bot.cycles - ai.cycles;
    const cyclePart = saved > 0.05
      ? `while using <b>${saved.toFixed(1)} fewer cycles</b>`
      : saved < -0.05 ? `using <b>${(-saved).toFixed(1)} more cycles</b> where they pay off` : "with a similar number of cycles";
    let text = uplift >= 0
      ? `The AI earns <b>${signedMoney(uplift).slice(1)} more</b> than a rule-based bot over 48 hours, ${cyclePart}, in <b>${ai.runs}</b> charge and discharge runs (bot: ${bot.runs}).`
      : `Here the AI earns ${money(-uplift)} less than the bot, using ${ai.runs} runs to the bot's ${bot.runs}.`;
    if (r.useForecast && r.captured != null) {
      text += ` Trading on a forecast with ±${state.fe}% error, it still captures <b>${Math.round(r.captured)}%</b> of what perfect hindsight would earn.`;
    } else if (!r.useForecast) {
      text += " In this view the agent knows future prices exactly: the theoretical upper bound.";
    }
    const hurdle = state.wear / state.cap;
    text += hurdle > 0.5
      ? ` It only cycles when the price gap beats about <b>${CUR}${Math.round(hurdle)}/MWh</b> of battery wear.`
      : " With wear priced at zero, it trades on almost any price gap.";
    $("insight").innerHTML = text;
  }

  function sourceText(r) {
    if (!r.mk.real) return "Simulated prices. Choose a real market above to trade on historical data.";
    const m = r.mk.meta;
    return `${state.p === "upload" ? "Your prices" : "Real prices"}: ${m.name}, ${fmtDay(r.mk.startMs)} – ${fmtDay(r.mk.startMs + DAY_MS)} · ${m.tz} · ${m.unit} · Source: ${m.source}`;
  }

  function compareRows(r) {
    const { ai, hind, bot } = r;
    return [
      ["Trading revenue", money(ai.revenue), money(hind.revenue), money(bot.revenue)],
      ["Battery wear", money(-ai.wear), money(-hind.wear), money(-bot.wear)],
      ["Net profit", money(ai.net), money(hind.net), money(bot.net), "total"],
      ["Cycles used", ai.cycles.toFixed(2), hind.cycles.toFixed(2), bot.cycles.toFixed(2)],
      ["Charge / discharge runs", ai.runs, hind.runs, bot.runs],
    ];
  }

  function renderCompare(r, c) {
    const aiName = r.useForecast ? "AI (forecast)" : "AI";
    $("compare").innerHTML = `
      <thead><tr><th></th>
        <th><span class="dot" style="background:${c.ink}"></span>${aiName}</th>
        <th><span class="dot" style="background:${c.soc}"></span>Hindsight</th>
        <th><span class="dot" style="background:${c.bot}"></span>Bot</th></tr></thead>
      <tbody>${compareRows(r).map(([k, a, h, b, cls]) =>
        `<tr class="${cls || ""}"><td>${k}</td><td class="ai">${a}</td><td>${h}</td><td>${b}</td></tr>`).join("")}</tbody>`;
  }

  function updateDaySelect(r) {
    const sel = $("day-select");
    if (!r.mk.real) { sel.hidden = true; return; }
    const m = r.mk.meta, days = dayCount(m), key = `${state.p}:${m.prices.length}:${m.start}`;
    if (sel.dataset.key !== key) {
      const start = parseNaive(m.start);
      sel.innerHTML = Array.from({ length: days }, (_, d) =>
        `<option value="${d}">${fmtShortDay(start + d * DAY_MS)} – ${fmtShortDay(start + (d + 1) * DAY_MS)}</option>`).join("");
      sel.dataset.key = key;
    }
    sel.value = String(r.mk.d);
    sel.hidden = false;
  }

  let state = readState();
  let last = null;

  function render(upto = N) {
    const r = simulate(state);
    last = r;
    const c = palette();
    renderKpis(r);
    renderMainChart(r, c, upto, "chart-main");
    renderInsight(r);
    $("source").textContent = sourceText(r);
    renderCompare(r, c);
    renderCumChart(r, c);
    $("lg-forecast").hidden = !r.useForecast;
    $("lg-hind").hidden = !r.useForecast;
    updateOutputs();
    updateDaySelect(r);
    $("solve-time").textContent = `Agent planned 192 intervals in ${Math.max(1, Math.round(r.ms))} ms`;
    writeState();
    return r;
  }

  let queued = false;
  function scheduleRender() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; render(); });
  }

  // ------------------------------------------------------------------------------------
  // 9. Controls
  // ------------------------------------------------------------------------------------
  function setPct(input) {
    const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
    input.style.setProperty("--pct", pct + "%");
  }

  function buildControls() {
    for (const c of CONTROLS) {
      const wrap = document.createElement("div");
      wrap.className = "field";
      wrap.id = "field-" + c.key;
      wrap.innerHTML = `
        <label for="in-${c.key}"><span>${c.label}</span><output id="out-${c.key}"></output></label>
        <input type="range" id="in-${c.key}" min="${c.min}" max="${c.max}" step="${c.step}">`;
      $(c.main ? "main-controls" : "more-controls").appendChild(wrap);
      const input = wrap.querySelector("input");
      input.addEventListener("input", () => {
        state[c.key] = parseFloat(input.value);
        setPct(input);
        scheduleRender();
      });
    }
    $("sim-chips").innerHTML = Object.entries(SIM)
      .map(([k, s]) => `<button type="button" class="chip" data-key="${k}">${s.label}</button>`).join("");
    buildRealChips();
    for (const id of ["sim-chips", "real-chips"]) {
      $(id).addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (b) selectMarket(b.dataset.key); });
    }
    document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  }

  function buildRealChips() {
    const entries = Object.entries(REAL).map(([k, m]) => [k, m.label]);
    if (uploaded) entries.push(["upload", "Your data"]);
    $("real-chips").innerHTML = entries
      .map(([k, label]) => `<button type="button" class="chip" data-key="${k}">${esc(label)}</button>`).join("");
  }

  function updateOutputs() {
    for (const c of CONTROLS) {
      const disabled = c.simOnly && !SIM[state.p];
      $("in-" + c.key).disabled = disabled;
      $("field-" + c.key).classList.toggle("disabled", disabled);
      $("out-" + c.key).textContent = disabled ? "real data" : c.fmt(state[c.key]);
    }
  }

  function syncControls() {
    for (const c of CONTROLS) {
      const input = $("in-" + c.key);
      input.value = state[c.key];
      setPct(input);
    }
    document.querySelectorAll(".chip[data-key]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.key === state.p)));
    document.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode)));
    updateOutputs();
  }

  function selectMarket(key) {
    state.p = key;
    state.d = 0;
    if (SIM[key]) { state.seed = SIM[key].seed; state.vol = SIM[key].volatility; }
    syncControls();
    scheduleRender();
  }

  function setMode(mode) {
    state.mode = mode;
    syncControls();
    scheduleRender();
  }

  function newDay() {
    if (SIM[state.p]) {
      state.seed = Math.floor(Math.random() * 100000);
      toast("New simulated market");
    } else {
      state.d = (state.d + 1) % dayCount(realMarket(state.p));
    }
    scheduleRender();
  }

  function toast(msg, ms = 2000) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), ms);
  }

  async function share() {
    const url = location.href;
    try {
      if (navigator.share && matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ title: "AI Grid Trader", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast(state.p === "upload" ? "Link copied (uploaded data isn't included in links)" : "Link to this scenario copied");
    } catch (err) {
      if (err && err.name === "AbortError") return;
      window.prompt("Copy this link:", url);
    }
  }

  function togglePresent() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  }

  // ------------------------------------------------------------------------------------
  // 10. Light / dark switch (remembered in this browser)
  // ------------------------------------------------------------------------------------
  const SUN = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const MOON = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
  function updateThemeButton() {
    const dark = effectiveTheme() === "dark";
    const btn = $("btn-theme");
    btn.innerHTML = dark ? SUN : MOON;
    btn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  }
  function toggleTheme() {
    const next = effectiveTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("agt-theme", next); } catch (e) { /* storage unavailable: still switches */ }
    updateThemeButton();
    if (kiosk.on) renderMainChart(last, palette(), kiosk.t, "chart-main");
    else scheduleRender();
  }

  // ------------------------------------------------------------------------------------
  // 11. Kiosk / auto-play: loops every market, replaying the AI's decisions in time.
  //     ?kiosk=1 starts it on load and restarts it after 60 s without interaction.
  // ------------------------------------------------------------------------------------
  const kiosk = { on: false, timer: 0, idle: 0, i: 0, t: N, auto: new URLSearchParams(location.search).has("kiosk") };
  const kioskQueue = () => [...Object.keys(SIM), ...Object.keys(REAL)];

  function updateBanner(r, t) {
    const at = r.X[Math.max(0, t - 1)];
    const profit = t > 0 ? r.ai.cum[t - 1] : 0;
    $("kiosk-banner").innerHTML = `
      <span class="kb-live"><span class="live"></span>Auto-play</span>
      <span class="kb-market">${esc(r.mk.label)} · ${r.mk.real ? "real prices" : "simulated"}</span>
      <span class="kb-time">${fmtClock(parseNaive(at))}</span>
      <span class="kb-profit">Profit so far <b>${money(profit)}</b></span>
      <span class="kb-hint">Tap anywhere to explore</span>`;
  }

  function playNextMarket() {
    if (!kiosk.on) return;
    const q = kioskQueue();
    const key = q[kiosk.i % q.length];
    kiosk.i++;
    state.p = key; state.d = 0; state.mode = "forecast";
    if (SIM[key]) { state.seed = SIM[key].seed; state.vol = SIM[key].volatility; }
    syncControls();
    kiosk.t = 0;
    const r = render(0);
    updateBanner(r, 0);
    const tick = () => {
      if (!kiosk.on) return;
      kiosk.t = Math.min(N, kiosk.t + 2);
      renderMainChart(r, palette(), kiosk.t, "chart-main");
      updateBanner(r, kiosk.t);
      kiosk.timer = setTimeout(kiosk.t < N ? tick : playNextMarket, kiosk.t < N ? 90 : 6000);
    };
    kiosk.timer = setTimeout(tick, 1200);
  }

  function startKiosk() {
    if (kiosk.on) return;
    kiosk.on = true;
    document.body.classList.add("kiosk");
    window.scrollTo({ top: 0 });
    kiosk.i = Math.max(0, kioskQueue().indexOf(state.p));
    playNextMarket();
  }

  function stopKiosk() {
    if (!kiosk.on) return;
    kiosk.on = false;
    clearTimeout(kiosk.timer);
    kiosk.t = N;
    document.body.classList.remove("kiosk");
    render();
  }

  function armIdle() {
    if (!kiosk.auto) return;
    clearTimeout(kiosk.idle);
    kiosk.idle = setTimeout(startKiosk, 60000);
  }

  // ------------------------------------------------------------------------------------
  // 12. Business case PDF: fills a print-only page, then opens the print dialog
  // ------------------------------------------------------------------------------------
  const FIELDS = ["client", "project", "author", "contact"];

  function openReportDialog() {
    const dlg = $("report-dialog");
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem("agt-report") || "{}"); } catch (e) { saved = {}; }
    for (const f of ["author", "contact"]) if (saved[f] && !dlg.querySelector(`[name=${f}]`).value) dlg.querySelector(`[name=${f}]`).value = saved[f];
    if (typeof dlg.showModal === "function") dlg.showModal();
    else createReport({});
  }

  async function createReport(fields) {
    const r = last;
    const c = PALETTES.light;
    // Draw a light-theme copy of the main chart off screen and turn it into an image.
    const tmp = document.createElement("div");
    tmp.style.cssText = "position:fixed;left:-12000px;top:0;width:1000px;height:400px;";
    document.body.appendChild(tmp);
    let img = "";
    try {
      const layoutFont = { family: "Helvetica, Arial, sans-serif" };
      await renderMainChart(r, c, N, tmp);
      await Plotly.relayout(tmp, { font: { ...layoutFont, size: 12, color: c.muted }, "xaxis.tickformat": "%a %d %b %H:%M" });
      img = await Plotly.toImage(tmp, { format: "png", width: 1000, height: 400, scale: 2 });
    } finally {
      Plotly.purge(tmp);
      tmp.remove();
    }
    $("report").innerHTML = reportHtml(r, fields, img);
    const pic = $("report").querySelector("img");
    if (pic && pic.decode) { try { await pic.decode(); } catch (e) { /* print anyway */ } }
    window.print();
  }

  function reportHtml(r, f, img) {
    const today = new Date();
    const dateStr = `${today.getDate()} ${MO[today.getMonth()]} ${today.getFullYear()}`;
    const period = r.mk.real
      ? `${esc(r.mk.meta.name)}, ${fmtDay(r.mk.startMs)} – ${fmtDay(r.mk.startMs + DAY_MS)}`
      : `Simulated market (“${esc(r.mk.label)}” scenario), 48 hours`;
    const source = r.mk.real ? esc(r.mk.meta.source) : "Simulated prices";
    const agent = r.useForecast ? `Forecast-driven, ±${state.fe}% forecast error, re-planned hourly` : "Perfect hindsight (theoretical maximum)";
    const k = kpiList(r);
    const kpi = (label, value, sub) => `<div class="rp-kpi"><div class="l">${label}</div><div class="v">${value}</div><div class="s">${sub}</div></div>`;
    const rows = compareRows(r).map(([name, a, h, b]) => `<tr><td>${name}</td><td><b>${a}</b></td><td>${h}</td><td>${b}</td></tr>`).join("");
    const asset = [
      ["Energy capacity", `${state.cap} MWh`],
      ["Power rating", `${state.pw} MW (${(state.cap / state.pw).toFixed(1)}-hour)`],
      ["Round-trip efficiency", `${state.eff}%`],
      ["Operating charge window", `${state.lo}% – ${state.hi}%`],
      ["Wear cost per full cycle", money(state.wear)],
      ["Installed cost", `${CUR}${state.capex}/kWh (${money(r.capex)} total)`],
    ].map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join("");
    const contactLine = [f.author, f.contact].filter(Boolean).map(esc).join(" · ");
    return `
      <div class="rp-head">
        <div>
          <div class="rp-kicker">Battery trading business case</div>
          <div class="rp-title">${f.client ? "Prepared for " + esc(f.client) : "AI battery trading: what it earns"}</div>
          <div>${f.project ? esc(f.project) : `${state.cap} MWh / ${state.pw} MW battery`}</div>
        </div>
        <div class="rp-meta"><div class="rp-brand">⚡ AI Grid Trader</div>${dateStr}${contactLine ? "<br>" + contactLine : ""}</div>
      </div>
      <div class="rp-kpis">
        ${kpi("Net profit over 48 hours", k[0].value, "after battery wear")}
        ${kpi("Annualised net revenue", money(r.annual), "48 hours × 182.5")}
        ${kpi("Estimated annual ROI", k[4].value, k[4].sub)}
        ${kpi("Of the perfect-hindsight max", k[2].value, `vs. rule-based bot: ${k[1].value}`)}
      </div>
      <h3>48-hour dispatch</h3>
      <img class="rp-chart" src="${img}" alt="Price, battery charge and AI trades over 48 hours">
      <div class="rp-legend">Orange: actual price${r.forecast ? " · grey dashed: forecast at start" : ""} · blue area: battery charge (right axis) · green ▲ buy · red ▼ sell.</div>
      <div class="rp-cols">
        <div>
          <h3>Results compared</h3>
          <table class="rp-table"><thead><tr><th></th><th>AI</th><th>Hindsight</th><th>Rule-based bot</th></tr></thead><tbody>${rows}</tbody></table>
        </div>
        <div>
          <h3>Asset assumptions</h3>
          <table class="rp-table"><tbody>${asset}</tbody></table>
        </div>
      </div>
      <h3>Market and method</h3>
      <table class="rp-table"><tbody>
        <tr><td>Prices</td><td>${period}</td></tr>
        <tr><td>Data source</td><td>${source}</td></tr>
        <tr><td>Agent</td><td>${agent}</td></tr>
      </tbody></table>
      <ul class="rp-notes">
        <li>Annual figures scale the 48-hour result to a year; real revenue varies with season and market conditions.</li>
        <li>Energy arbitrage only. Ancillary services, capacity payments and other revenue streams are not included.</li>
        <li>Battery wear is charged at the stated cost per full cycle. Forecast error is simulated on top of actual prices.</li>
        <li>Illustrative estimate, not a financial forecast or investment advice.</li>
      </ul>
      <div class="rp-foot"><span>Generated with AI Grid Trader</span><span>${esc(location.origin + location.pathname)}</span></div>`;
  }

  // ------------------------------------------------------------------------------------
  // 13. Wire everything up
  // ------------------------------------------------------------------------------------
  function init() {
    if (new URLSearchParams(location.search).has("embed")) document.body.classList.add("embed");
    if (state.p === "upload" || !(SIM[state.p] || REAL[state.p])) state.p = DEFAULTS.p;
    buildControls();
    syncControls();
    updateThemeButton();
    render();

    $("btn-share").addEventListener("click", share);
    $("btn-present").addEventListener("click", togglePresent);
    $("btn-shuffle").addEventListener("click", newDay);
    $("btn-theme").addEventListener("click", toggleTheme);
    $("btn-play").addEventListener("click", () => (kiosk.on ? stopKiosk() : startKiosk()));
    $("btn-report").addEventListener("click", openReportDialog);
    $("day-select").addEventListener("change", (e) => { state.d = parseInt(e.target.value, 10) || 0; scheduleRender(); });

    $("report-dialog").addEventListener("close", () => {
      const dlg = $("report-dialog");
      if (dlg.returnValue !== "ok") return;
      const fields = {};
      for (const f of FIELDS) fields[f] = dlg.querySelector(`[name=${f}]`).value.trim();
      try { localStorage.setItem("agt-report", JSON.stringify({ author: fields.author, contact: fields.contact })); } catch (e) { /* optional */ }
      createReport(fields).catch(() => toast("Couldn't create the PDF in this browser"));
    });

    $("file-input").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      if (file.size > 20e6) { toast("That file is too large (20 MB max)", 3500); return; }
      try {
        uploaded = parseUpload(await file.text(), file.name);
        buildRealChips();
        selectMarket("upload");
        toast(uploaded.note, 3500);
      } catch (err) {
        toast(err.message || "Couldn't read that file", 4500);
      }
    });

    // Leaving kiosk: any interaction hands control back to the visitor.
    for (const ev of ["pointerdown", "keydown", "wheel", "touchstart"]) {
      document.addEventListener(ev, (e) => {
        const ownToggle = (ev === "pointerdown" && e.target.closest("#btn-play")) || (ev === "keydown" && /^k$/i.test(e.key));
        if (kiosk.on && !ownToggle) stopKiosk();
        armIdle();
      }, { capture: true, passive: true });
    }

    // Keyboard shortcuts: 1–7 markets, N new day, H hindsight/forecast, F full screen, K auto-play, T theme.
    document.addEventListener("keydown", (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^(input|textarea|select)$/i.test(e.target.tagName) && e.target.type !== "range") return;
      if ($("report-dialog").open) return;
      const q = kioskQueue();
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= q.length) selectMarket(q[n - 1]);
      else if (/^n$/i.test(e.key)) newDay();
      else if (/^h$/i.test(e.key)) setMode(state.mode === "forecast" ? "hindsight" : "forecast");
      else if (/^f$/i.test(e.key)) togglePresent();
      else if (/^k$/i.test(e.key)) (kiosk.on ? stopKiosk() : startKiosk());
      else if (/^t$/i.test(e.key)) toggleTheme();
    });

    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { updateThemeButton(); scheduleRender(); });
    window.addEventListener("hashchange", () => {
      const next = readState();
      if (JSON.stringify(next) !== JSON.stringify(state)) { state = next; syncControls(); scheduleRender(); }
    });

    if (kiosk.auto) startKiosk();
  }

  init();
})();
