/*
 * AI Grid Trader: the model (no DOM, no charts).
 *
 * Everything that decides and scores battery trades lives here, as one self-contained factory
 * function. The same code runs:
 *   - in the page (window.GridEngine),
 *   - in a background Web Worker for the full-year simulation (built from createEngine's source,
 *     so it also works when index.html is opened straight from disk), and
 *   - in Node for the automated tests (module.exports).
 *
 * Reward per 15-minute step = arbitrage cash − battery wear − penalty for starting a new trade run.
 * The AI's decision table comes from exact Bellman backups over (time, state of charge, mode): the
 * answer a fully trained Q-learning agent converges to.
 */
function createEngine() {
  "use strict";

  const STEPS_PER_HOUR = 4;
  const DT = 1 / STEPS_PER_HOUR;          // hours per interval
  const STEPS_PER_DAY = 24 * STEPS_PER_HOUR;
  const N = 2 * STEPS_PER_DAY;            // the interactive view: 48 hours = 192 steps
  const NEG = -1e12;                      // value of an impossible state
  const IDLE = 0, CHARGE = 1, DISCHARGE = 2;
  const BASE_PRICE = 42;                  // $/MWh off-peak level for simulated markets
  const DAY_MS = 864e5, STEP_MS = DT * 3600e3;

  const mean = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; };
  const std = (a) => { const m = mean(a); let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - m) ** 2; return Math.sqrt(s / a.length); };

  // ---------------------------------------------------------------------------- dates
  // Timestamps are "market local time" handled as naive UTC, so a viewer's time zone never shifts them.
  const pad = (n) => String(n).padStart(2, "0");
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
  function todayMs() { const n = new Date(); return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()); }

  // ---------------------------------------------------------------------------- randomness
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

  // ---------------------------------------------------------------------------- simulated market
  // "Duck curve": morning + evening peaks, midday solar dip, AR(1) noise, evening spikes.
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

  // ---------------------------------------------------------------------------- battery grid
  // State of charge on a grid where full power for one interval is a whole number of steps.
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

  // ---------------------------------------------------------------------------- the AI agent
  // Backward induction over (time, SOC, mode). Returns the optimal action (signed grid steps,
  // at most ±100 so it fits in Int8) for the first `keepSteps` steps. Energy above the starting
  // charge level at the end is worth `terminalPrice` per MWh. By default the plan must end at or
  // above the starting level; with `softEnd` it may end lower, and the shortfall is charged at
  // the same price (used for intermediate plans of a rolling horizon).
  // Working buffers are reused between calls: a year of hourly re-planning calls solve() ~9,000
  // times, and allocating fresh typed arrays each time makes the garbage collector the bottleneck.
  // (A returned short policy is therefore only valid until the next solve() call.)
  let work = null;
  function buffers(S, J, policyLen) {
    if (!work || work.S !== S || work.J !== J) {
      work = { S, J, V: new Float64Array(S * 3), Vn: new Float64Array(S * 3), rc: new Float64Array(J + 1),
               rd: new Float64Array(J + 1), policy: new Int8Array(0) };
    }
    if (policyLen > 1 << 20) return { ...work, policy: new Int8Array(policyLen) };   // big one-off plans
    if (work.policy.length < policyLen) work.policy = new Int8Array(policyLen);
    return work;
  }

  // One Bellman backup (one time step) over every charge level and mode. Kept as its own small
  // function so the JavaScript engine optimises it once, instead of repeatedly re-optimising a
  // loop inside solve() (that alone made the full-year simulation about 3× slower).
  function backup(V, Vn, rc, rd, lo, hi, J, frag, policy, base) {
    Vn.fill(NEG);
    for (let s = lo; s <= hi; s++) {
      const hold = V[s * 3];                                    // stay: next mode is hold
      let bestC = NEG, jC = 0;
      const maxC = Math.min(J, hi - s);
      for (let j = 1; j <= maxC; j++) { const q = rc[j] + V[(s + j) * 3 + 1]; if (q > bestC) { bestC = q; jC = j; } }
      let bestD = NEG, jD = 0;
      const maxD = Math.min(J, s - lo);
      for (let j = 1; j <= maxD; j++) { const q = rd[j] + V[(s - j) * 3 + 2]; if (q > bestD) { bestD = q; jD = -j; } }
      // Starting a new charge/discharge run (from a different mode) pays the micro-cycling penalty.
      for (let m = 0; m < 3; m++) {
        let best = hold, act = 0;
        const qC = bestC - (m === 1 ? 0 : frag);
        if (jC && qC > best) { best = qC; act = jC; }
        const qD = bestD - (m === 2 ? 0 : frag);
        if (jD && qD > best) { best = qD; act = jD; }
        Vn[s * 3 + m] = best;
        if (base >= 0) policy[base + s * 3 + m] = act;
      }
    }
  }

  function solve(prices, b, g, terminalPrice, keepSteps, softEnd) {
    const T = prices.length, S = g.S, J = g.J;
    const eta = Math.sqrt(b.eff / 100);
    const wearPerMWh = b.wear / (2 * b.cap);
    const keep = Math.min(T, keepSteps == null ? T : keepSteps);
    const buf = buffers(S, J, keep * S * 3);
    const { rc, rd, policy } = buf;
    let V = buf.V.fill(NEG), Vn = buf.Vn;
    for (let s = softEnd ? g.lo : Math.max(g.lo, g.s0); s <= g.hi; s++) {
      const v = (s - g.s0) * g.delta * terminalPrice;
      V[s * 3] = V[s * 3 + 1] = V[s * 3 + 2] = v;
    }
    for (let t = T - 1; t >= 0; t--) {
      const p = prices[t];
      for (let j = 1; j <= J; j++) {
        const e = j * g.delta;
        rc[j] = (-p * e) / eta - e * wearPerMWh;      // pay to charge, plus wear
        rd[j] = p * e * eta - e * wearPerMWh;         // paid to discharge, minus wear
      }
      backup(V, Vn, rc, rd, g.lo, g.hi, J, b.frag, policy, t < keep ? t * S * 3 : -1);
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

  // Perfect hindsight: plans on the actual prices (theoretical maximum for this window).
  function hindsightAgent(prices, b, g, meanP) {
    const T = prices.length;
    const moves = new Float64Array(T), soc = new Float64Array(T);
    rollout(solve(prices, b, g, meanP), g, T, g.s0, IDLE, moves, soc, 0);
    return { moves, soc };
  }

  // Centred 3-hour moving average (what a forecast can see: no short spikes).
  function smooth3h(prices) {
    const T = prices.length, out = new Float64Array(T);
    for (let t = 0; t < T; t++) {
      let sum = 0, n = 0;
      for (let k = Math.max(0, t - 6); k <= Math.min(T - 1, t + 6); k++) { sum += prices[k]; n++; }
      out[t] = sum / n;
    }
    return out;
  }

  // A price forecast issued at step `tau` for steps tau..end. Only the current interval is known.
  // Beyond that it (a) misses short spikes: follows a 3-hour average of the actual price, (b) pulls
  // peaks and dips toward the average as lead time grows, and (c) carries correlated random error.
  // At 0% error it equals the actual prices.
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

  // Realistic agent for the 48-hour view: re-plans every hour on the latest forecast, executes the next hour.
  function forecastAgent(prices, b, g, errPct, seed, meanP) {
    const T = prices.length;
    const moves = new Float64Array(T), soc = new Float64Array(T);
    const scale = std(prices) + 0.5 * Math.abs(meanP);
    const smooth = smooth3h(prices);
    let s = g.s0, m = IDLE, first = null;
    for (let tau = 0; tau < T; tau += STEPS_PER_HOUR) {
      const f = forecastAt(prices, smooth, tau, errPct, scale, meanP, seed);
      if (!first) first = f;
      const plan = solve(f, b, g, meanP, STEPS_PER_HOUR);
      ({ s, m } = rollout(plan, g, Math.min(STEPS_PER_HOUR, T - tau), s, m, moves, soc, tau));
    }
    return { moves, soc, forecast: first };
  }

  // ---------------------------------------------------------------------------- benchmark bot
  // Buys when the price dips below its 3-hour average, sells when above. No wear model, no foresight.
  function runBot(prices, g, lookback = 12) {
    const T = prices.length;
    const moves = new Float64Array(T), soc = new Float64Array(T);
    const band = 0.05 * Math.max(10, std(prices));            // ~$2/MWh on a typical day
    let s = g.s0, sum = 0;
    for (let t = 0; t < T; t++) {
      const n = Math.min(t, lookback);
      const ref = n ? sum / n : prices[t];
      let j = 0;
      if (prices[t] < ref - band && s < g.hi) j = Math.min(g.J, g.hi - s);
      else if (prices[t] > ref + band && s > g.lo) j = -Math.min(g.J, s - g.lo);
      s += j;
      moves[t] = j * g.delta;
      soc[t] = s * g.delta;
      sum += prices[t];
      if (t >= lookback) sum -= prices[t - lookback];
    }
    return { moves, soc };
  }

  // ---------------------------------------------------------------------------- shared ledger
  // Cash, wear, cycles and trade runs, scored identically for every strategy.
  function settle(prices, run, b, g, meanP) {
    const T = prices.length;
    const eta = Math.sqrt(b.eff / 100);
    const wearPerMWh = b.wear / (2 * b.cap);
    const modes = new Int8Array(T), cum = new Float64Array(T), cumCycles = new Float64Array(T), stepNet = new Float64Array(T);
    let cash = 0, wear = 0, throughput = 0, running = 0, runs = 0;
    for (let t = 0; t < T; t++) {
      const e = run.moves[t];
      const c = e > 0 ? (-prices[t] * e) / eta : -prices[t] * e * eta;
      const w = Math.abs(e) * wearPerMWh;
      cash += c; wear += w; throughput += Math.abs(e);
      stepNet[t] = c - w;
      running += c - w;
      cum[t] = running;
      cumCycles[t] = throughput / (2 * b.cap);
      modes[t] = e > 1e-9 ? CHARGE : e < -1e-9 ? DISCHARGE : IDLE;
      if (modes[t] !== IDLE && modes[t] !== (t ? modes[t - 1] : IDLE)) runs++;
    }
    // Energy left in (or missing from) the battery at the end is valued at the average price.
    const inventory = (run.soc[T - 1] - g.s0 * g.delta) * meanP;
    cum[T - 1] += inventory;
    stepNet[T - 1] += inventory;
    const revenue = cash + inventory;
    return {
      moves: run.moves, soc: run.soc, modes, cum, cumCycles, stepNet, revenue, wear, net: revenue - wear, runs,
      cycles: throughput / (2 * b.cap),
      socPct: Array.from(run.soc, (v) => (v / b.cap) * 100),
    };
  }

  // ---------------------------------------------------------------------------- one 48h window
  // opts: { mode: "forecast" | "hindsight", fe: forecast error %, seed }
  function runWindow(prices, b, opts) {
    const g = socGrid(b);
    const meanP = mean(prices);
    const hind = settle(prices, hindsightAgent(prices, b, g, meanP), b, g, meanP);
    const useForecast = opts.mode === "forecast" && opts.fe > 0;
    let ai = hind, forecast = null;
    if (useForecast) {
      const run = forecastAgent(prices, b, g, opts.fe, opts.seed, meanP);
      ai = settle(prices, run, b, g, meanP);
      forecast = run.forecast;
    }
    const bot = settle(prices, runBot(prices, g), b, g, meanP);
    return { g, meanP, ai, hind, bot, forecast, useForecast };
  }

  // ---------------------------------------------------------------------------- a full year
  // Operates the battery over every whole day of `prices` (15-minute steps from startMs).
  //  - AI (forecast mode): re-plans every hour on a fresh forecast for the next `lookaheadHours`
  //    and executes the next hour, exactly like the 48-hour view but for a whole year.
  //  - Perfect hindsight: ONE optimisation over the entire year on the actual prices, i.e. the
  //    most any strategy could have earned.
  //  - Rule-based bot over the same prices.
  // Results are reported per calendar month; `scale` converts to 365 days if the data is shorter.
  function annual(prices, startMs, b, opts, onProgress) {
    const days = Math.floor(prices.length / STEPS_PER_DAY);
    const T = days * STEPS_PER_DAY;
    const all = prices.length === T ? prices : prices.subarray(0, T);
    const g = socGrid(b);
    const meanAll = mean(all);
    const useForecast = opts.mode === "forecast" && opts.fe > 0;
    const replanSteps = Math.max(1, Math.round((opts.replanHours || 1) * STEPS_PER_HOUR));
    const lookahead = Math.max(replanSteps, Math.round((opts.lookaheadHours || 24) * STEPS_PER_HOUR));

    // Rolling-horizon operation on forecasts. Intermediate plans value leftover energy at the
    // forecast's average price; the last plan must end at least as full as the year started.
    function rolling() {
      const moves = new Float64Array(T), soc = new Float64Array(T);
      const smooth = smooth3h(all);
      let s = g.s0, m = IDLE, n = 0;
      for (let from = 0; from < T; from += replanSteps, n++) {
        const end = Math.min(T, from + lookahead);
        const win = all.subarray(from, end);
        const meanW = mean(win);
        const scale = std(win) + 0.5 * Math.abs(meanW);
        const plan = forecastAt(win, smooth.subarray(from, end), 0, opts.fe, scale, meanW, (opts.seed || 0) + n * 7919);
        const pol = solve(plan, b, g, mean(plan), replanSteps, end < T);
        ({ s, m } = rollout(pol, g, Math.min(replanSteps, win.length), s, m, moves, soc, from));
        if (onProgress && n % 96 === 0) onProgress(0.15 + 0.85 * from / T);
      }
      return { moves, soc };
    }

    const summarise = (run) => {
      const r = settle(all, run, b, g, meanAll);
      const monthly = [];
      let key = null;
      for (let t = 0; t < T; t++) {
        const dt = new Date(startMs + t * STEP_MS);
        const k = dt.getUTCFullYear() * 12 + dt.getUTCMonth();
        if (k !== key) { monthly.push({ year: dt.getUTCFullYear(), month: dt.getUTCMonth(), net: 0, cycles: 0 }); key = k; }
        const cur = monthly[monthly.length - 1];
        cur.net += r.stepNet[t];
        cur.cycles += Math.abs(run.moves[t]) / (2 * b.cap);
      }
      return { net: r.net, revenue: r.revenue, wear: r.wear, cycles: r.cycles, runs: r.runs, monthly,
               minSoc: Math.min(...run.soc), maxSoc: Math.max(...run.soc) };
    };

    const hind = summarise(hindsightAgent(all, b, g, meanAll));
    if (onProgress) onProgress(0.15);
    const ai = useForecast ? summarise(rolling()) : hind;
    const bot = summarise(runBot(all, g));
    if (onProgress) onProgress(1);
    return { days, scale: 365 / days, useForecast, ai, hind, bot };
  }

  // ---------------------------------------------------------------------------- CSV upload
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

  // Finds a price column (and timestamps if present) and resamples to 15 minutes.
  // Keeps up to about one year (366 days) so the full-year view can use it.
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
    const vals = [], times = [];
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
    p15 = p15.slice(0, STEPS_PER_DAY * 366);
    const h = (header || []).join(" ");
    const currency = /€|eur/i.test(h) ? "€" : /£|gbp/i.test(h) ? "£" : /aud|a\$/i.test(h) ? "A$" : "$";
    const days = Math.floor(p15.length / STEPS_PER_DAY);
    return {
      label: "Your data", name: filename, currency, unit: `${currency}/MWh`,
      tz: timed ? "times as in your file" : "no timestamps found; assumed hourly",
      source: "your uploaded file (processed only in this browser)",
      start: fmtNaive(startMs), prices: p15, typical: 0,
      note: `Loaded ${days} day${days === 1 ? "" : "s"} of ${timed ? step + "-minute" : "hourly"} prices`,
    };
  }

  return {
    STEPS_PER_HOUR, STEPS_PER_DAY, DT, N, IDLE, CHARGE, DISCHARGE, DAY_MS, STEP_MS,
    mean, std, parseNaive, fmtNaive, todayMs, mulberry32, gaussian,
    generateMarket, socGrid, solve, rollout, hindsightAgent, smooth3h, forecastAt, forecastAgent,
    runBot, settle, runWindow, annual, parseDate, parseUpload,
  };
}

if (typeof window !== "undefined") window.GridEngine = createEngine();
if (typeof module !== "undefined" && module.exports) module.exports = createEngine;
