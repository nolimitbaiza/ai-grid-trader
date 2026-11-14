/*
 * AI Grid Trader: browser edition.
 *
 * Runs entirely in the visitor's browser (no server), so it can be hosted on any static
 * website or GitHub Pages, embedded in an iframe, or opened straight from disk offline.
 * The model mirrors streamlit_app/app.py:
 *
 *   1. MARKET   48h of 15-minute wholesale prices (duck curve + noise + evening spikes)
 *   2. AI AGENT exact Bellman backups over (time, state of charge, operating mode). This is
 *               the decision table a fully trained Q-learning agent converges to.
 *   3. BOT      a degradation-blind rule-based trader, used as the benchmark
 *   4. LEDGER   one shared accounting of cash, battery wear and cycles for both
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
  const N = 48 * STEPS_PER_HOUR;          // 192 decision points
  const NEG = -1e12;                      // value of an impossible state
  const IDLE = 0, CHARGE = 1, DISCHARGE = 2;
  const BASE_PRICE = 42;                  // $/MWh off-peak level

  // Market scenarios a presenter can switch between with one click.
  const SCENARIOS = {
    typical:  { label: "Typical day",     seed: 42, volatility: 5,  morning: 38, evening: 75,  solar: 34, spikes: [1, 3], spikeSize: [25, 80] },
    volatile: { label: "Volatile",        seed: 7,  volatility: 11, morning: 38, evening: 75,  solar: 34, spikes: [3, 5], spikeSize: [40, 120] },
    solar:    { label: "Solar surplus",   seed: 21, volatility: 5,  morning: 30, evening: 70,  solar: 72, spikes: [0, 1], spikeSize: [20, 50] },
    heatwave: { label: "Heatwave",        seed: 99, volatility: 7,  morning: 50, evening: 140, solar: 25, spikes: [2, 4], spikeSize: [50, 120] },
  };

  const money = (v) => (v < 0 ? "−" : "") + "$" + Math.round(Math.abs(v)).toLocaleString("en-US");
  const signedMoney = (v) => (v >= 0 ? "+" : "−") + "$" + Math.round(Math.abs(v)).toLocaleString("en-US");

  // Slider definitions. `main` sliders are always visible; the rest sit under "More settings".
  const CONTROLS = [
    { key: "cap",   label: "Battery size",          min: 10,  max: 500,   step: 10,  fmt: (v) => `${v} MWh`, main: true },
    { key: "pw",    label: "Power rating",          min: 5,   max: 200,   step: 5,   fmt: (v) => `${v} MW`, main: true },
    { key: "wear",  label: "Wear cost per cycle",   min: 0,   max: 20000, step: 250, fmt: (v) => money(v), main: true },
    { key: "vol",   label: "Price volatility",      min: 0,   max: 15,    step: 0.5, fmt: (v) => `±$${v}/MWh`, main: true },
    { key: "eff",   label: "Round-trip efficiency", min: 70,  max: 98,    step: 1,   fmt: (v) => `${v}%` },
    { key: "frag",  label: "Micro-cycling penalty", min: 0,   max: 2000,  step: 50,  fmt: (v) => `${money(v)} / run` },
    { key: "lo",    label: "Lowest charge level",   min: 0,   max: 45,    step: 5,   fmt: (v) => `${v}%` },
    { key: "hi",    label: "Highest charge level",  min: 55,  max: 100,   step: 5,   fmt: (v) => `${v}%` },
    { key: "capex", label: "Installed cost",        min: 100, max: 600,   step: 25,  fmt: (v) => `$${v}/kWh` },
  ];

  const DEFAULTS = { p: "typical", cap: 100, pw: 25, wear: 3000, vol: 5, eff: 88, frag: 300, lo: 10, hi: 90, capex: 300, seed: 42 };

  // ------------------------------------------------------------------------------------
  // 1. Market simulation (seeded, so every scenario is reproducible and shareable)
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

  function generateMarket(m) {
    const rng = mulberry32(m.seed);
    const day2Scale = 0.9 + 0.3 * rng();          // day 2 differs a little (weather, demand)
    const price = new Float64Array(N);
    const eveningIdx = [];
    let noise = 0;
    for (let t = 0; t < N; t++) {
      const hod = (t * DT) % 24;
      let shape = BASE_PRICE
        + bump(hod, 8, 1.6, m.morning)              // morning peak
        + bump(hod, 19, 2.0, m.evening)             // evening peak
        - bump(hod, 13, 2.4, m.solar)               // midday solar dip
        - bump(hod, 3.5, 2.2, 12);                  // overnight lull
      if (t * DT >= 24) shape *= day2Scale;
      noise = t === 0 ? 0 : 0.8 * noise + m.volatility * gaussian(rng);   // AR(1) noise
      price[t] = shape + noise;
      if (hod >= 17 && hod <= 21) eveningIdx.push(t);
    }
    // Evening scarcity spikes (e.g. a generator trips offline)
    const count = m.spikes[0] + Math.floor(rng() * (m.spikes[1] - m.spikes[0] + 1));
    for (let k = 0; k < count; k++) {
      const start = eveningIdx[Math.floor(rng() * eveningIdx.length)];
      const len = 2 + Math.floor(rng() * 3);
      const size = m.spikeSize[0] + rng() * (m.spikeSize[1] - m.spikeSize[0]);
      for (let t = start; t < Math.min(N, start + len); t++) price[t] += size;
    }
    for (let t = 0; t < N; t++) price[t] = Math.max(price[t], -25);  // curtailment floor
    return price;
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
  // 3. The AI agent: converged Q-values via backward induction (Bellman optimality)
  // ------------------------------------------------------------------------------------
  function solveAgent(prices, b, g) {
    const T = prices.length, S = g.S;
    // Actions ordered [0, +1, -1, +2, -2, ...] so ties resolve to HOLD (conservative).
    const jumps = [0];
    for (let k = 1; k <= g.J; k++) jumps.push(k, -k);
    const A = jumps.length;
    const modeOf = jumps.map((j) => (j > 0 ? CHARGE : j < 0 ? DISCHARGE : IDLE));
    const eta = Math.sqrt(b.eff / 100);
    const wearPerMWh = b.wear / (2 * b.cap);
    const meanPrice = prices.reduce((s, p) => s + p, 0) / T;

    // Terminal value: finish at least as full as you started; surplus valued at average price.
    let V = new Float64Array(S * 3).fill(NEG);
    let Vn = new Float64Array(S * 3);
    for (let s = Math.max(g.lo, g.s0); s <= g.hi; s++) {
      const v = (s - g.s0) * g.delta * meanPrice;
      V[s * 3] = V[s * 3 + 1] = V[s * 3 + 2] = v;
    }

    const policy = new Int16Array(T * S * 3);
    const reward = new Float64Array(A);
    for (let t = T - 1; t >= 0; t--) {
      const p = prices[t];
      for (let a = 0; a < A; a++) {
        const e = jumps[a] * g.delta;                               // + charge, − discharge
        const cash = e > 0 ? (-p * e) / eta : -p * e * eta;          // buy cost / sell revenue
        reward[a] = cash - Math.abs(e) * wearPerMWh;                 // minus battery wear
      }
      Vn.fill(NEG);
      for (let s = g.lo; s <= g.hi; s++) {
        for (let m = 0; m < 3; m++) {
          let best = NEG, bestA = 0;
          for (let a = 0; a < A; a++) {
            const ns = s + jumps[a];
            if (ns < g.lo || ns > g.hi) continue;                    // charge-level guard rails
            const mn = modeOf[a];
            const penalty = mn !== IDLE && mn !== m ? b.frag : 0;    // starting a new run
            const q = reward[a] - penalty + V[ns * 3 + mn];
            if (q > best) { best = q; bestA = a; }
          }
          Vn[s * 3 + m] = best;
          policy[(t * S + s) * 3 + m] = bestA;
        }
      }
      const tmp = V; V = Vn; Vn = tmp;
    }

    // Roll the learned policy forward from the starting state.
    const moves = new Float64Array(T), soc = new Float64Array(T);
    let s = g.s0, m = IDLE;
    for (let t = 0; t < T; t++) {
      const a = policy[(t * S + s) * 3 + m];
      s += jumps[a];
      m = modeOf[a];
      moves[t] = jumps[a] * g.delta;
      soc[t] = s * g.delta;
    }
    return { moves, soc };
  }

  // ------------------------------------------------------------------------------------
  // 4. Benchmark: rule-based bot that reacts to every wiggle (no wear model, no foresight)
  // ------------------------------------------------------------------------------------
  function runBot(prices, g, lookback = 12, band = 2) {
    const moves = new Float64Array(N), soc = new Float64Array(N);
    let s = g.s0;
    for (let t = 0; t < N; t++) {
      const from = Math.max(0, t - lookback);
      let ref = prices[t];
      if (t > from) {
        ref = 0;
        for (let k = from; k < t; k++) ref += prices[k];
        ref /= t - from;
      }
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
  // 5. Shared ledger: cash, wear, cycles. Identical scoring for AI and bot.
  // ------------------------------------------------------------------------------------
  function settle(prices, run, b, g) {
    const eta = Math.sqrt(b.eff / 100);
    const wearPerMWh = b.wear / (2 * b.cap);
    const startMWh = g.s0 * g.delta;
    const meanPrice = prices.reduce((s, p) => s + p, 0) / N;
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
    const inventory = (run.soc[N - 1] - startMWh) * meanPrice;
    cum[N - 1] += inventory;
    const revenue = cash + inventory;
    return {
      ...run, modes, cum, revenue, wear, net: revenue - wear, runs,
      cycles: throughput / (2 * b.cap),
      socPct: Array.from(run.soc, (v) => (v / b.cap) * 100),
    };
  }

  function simulate(state) {
    const sc = SCENARIOS[state.p];
    const prices = generateMarket({ ...sc, seed: state.seed, volatility: state.vol });
    const g = socGrid(state);
    const t0 = performance.now();
    const ai = settle(prices, solveAgent(prices, state, g), state, g);
    const ms = performance.now() - t0;
    const bot = settle(prices, runBot(prices, g), state, g);
    const capex = state.cap * 1000 * state.capex;
    const annual = ai.net * 182.5;                                   // 48h → one year
    return { prices, ai, bot, ms, roi: (annual / capex) * 100, payback: annual > 0 ? capex / annual : Infinity };
  }

  // ------------------------------------------------------------------------------------
  // 6. State ⇄ URL hash, so a scenario can be shared as a link
  // ------------------------------------------------------------------------------------
  function readState() {
    const s = { ...DEFAULTS };
    const params = new URLSearchParams(location.hash.slice(1));
    if (SCENARIOS[params.get("p")]) s.p = params.get("p");
    s.vol = SCENARIOS[s.p].volatility;          // scenario default unless the link overrides it
    for (const c of CONTROLS) {
      const v = parseFloat(params.get(c.key));
      if (Number.isFinite(v)) s[c.key] = Math.min(c.max, Math.max(c.min, v));
    }
    const seed = parseInt(params.get("seed"), 10);
    s.seed = Number.isFinite(seed) ? Math.abs(seed) % 100000 : SCENARIOS[s.p].seed;
    return s;
  }
  function writeState() {
    const params = new URLSearchParams();
    params.set("p", state.p);
    for (const c of CONTROLS) params.set(c.key, state[c.key]);
    params.set("seed", state.seed);
    history.replaceState(null, "", "#" + params.toString());
  }

  // ------------------------------------------------------------------------------------
  // 7. Rendering
  // ------------------------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  const startDay = new Date();
  startDay.setHours(0, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  const X = Array.from({ length: N }, (_, t) => {
    const d = new Date(startDay.getTime() + t * DT * 3600e3);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const XEND = (() => {
    const d = new Date(startDay.getTime() + N * DT * 3600e3);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 00:00`;
  })();

  function baseLayout(c) {
    return {
      margin: { l: 44, r: 44, t: 12, b: 28 },
      showlegend: false,                        // legends are plain HTML above each chart
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: getComputedStyle(document.body).fontFamily, size: 12, color: c.muted },
      hovermode: "x unified",
      hoverlabel: { bgcolor: c.surface, bordercolor: c.line, font: { color: c.ink, size: 12 } },
      xaxis: { type: "date", tickformat: "%a %H:%M", showgrid: false, linecolor: c.line, fixedrange: true, range: [X[0], XEND] },
      yaxis: { gridcolor: c.line, zeroline: false, fixedrange: true },
    };
  }

  function palette() {
    return {
      ink: css("--ink"), muted: css("--muted"), line: css("--line"), surface: css("--surface"),
      price: css("--price"), soc: css("--soc"), socFill: css("--soc-fill"),
      charge: css("--charge"), discharge: css("--discharge"), bot: css("--bot"),
    };
  }

  // Index of the first interval after each contiguous run of a mode, for shaded bands.
  function blocks(modes) {
    const out = [];
    let start = -1;
    for (let t = 0; t <= N; t++) {
      const m = t < N ? modes[t] : IDLE;
      if (start >= 0 && m !== modes[start]) { out.push([modes[start], start, t]); start = -1; }
      if (start < 0 && m !== IDLE) start = t;
    }
    return out;
  }

  function renderMainChart(r, c) {
    const { ai, prices } = r;
    const pick = (mode) => {
      const idx = [];
      for (let t = 0; t < N; t++) if (ai.modes[t] === mode) idx.push(t);
      return idx;
    };
    const buys = pick(CHARGE), sells = pick(DISCHARGE);
    const traces = [
      {
        x: X, y: ai.socPct, yaxis: "y2", name: "Battery charge", type: "scatter", mode: "lines",
        line: { color: c.soc, width: 1.5, shape: "linear" }, fill: "tozeroy", fillcolor: c.socFill,
        hovertemplate: "Battery %{y:.0f}%<extra></extra>",
      },
      {
        x: X, y: Array.from(prices), name: "Price", type: "scatter", mode: "lines",
        line: { color: c.price, width: 2 }, hovertemplate: "Price $%{y:.0f}/MWh<extra></extra>",
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
      },
    ];
    const shapes = blocks(ai.modes).map(([mode, i0, i1]) => ({
      type: "rect", xref: "x", yref: "paper", x0: X[i0], x1: i1 < N ? X[i1] : XEND, y0: 0, y1: 1,
      fillcolor: mode === CHARGE ? c.charge : c.discharge, opacity: 0.07, line: { width: 0 }, layer: "below",
    }));
    shapes.push({ type: "line", xref: "x", yref: "paper", x0: X[N / 2], x1: X[N / 2], y0: 0, y1: 1, line: { color: c.line, width: 1, dash: "dot" } });
    const layout = baseLayout(c);
    layout.shapes = shapes;
    layout.yaxis.tickprefix = "$";
    layout.yaxis2 = {
      overlaying: "y", side: "right", range: [0, 105], tickmode: "array",
      tickvals: [0, 25, 50, 75, 100], ticktext: ["0%", "25%", "50%", "75%", "100%"],
      showgrid: false, zeroline: false, fixedrange: true,
    };
    Plotly.react("chart-main", traces, layout, { displayModeBar: false, responsive: true });
  }

  function renderCumChart(r, c) {
    const traces = [
      { x: X, y: Array.from(r.bot.cum), name: "Rule-based bot", type: "scatter", mode: "lines",
        line: { color: c.bot, width: 2, dash: "dot" }, hovertemplate: "Bot %{y:$,.0f}<extra></extra>" },
      { x: X, y: Array.from(r.ai.cum), name: "AI agent", type: "scatter", mode: "lines",
        line: { color: c.ink, width: 2.5 }, hovertemplate: "AI %{y:$,.0f}<extra></extra>" },
    ];
    const layout = baseLayout(c);
    layout.margin = { l: 56, r: 8, t: 12, b: 28 };
    layout.yaxis.tickformat = "$,.0s";
    layout.yaxis.zeroline = true;
    layout.yaxis.zerolinecolor = c.muted;
    Plotly.react("chart-cum", traces, layout, { displayModeBar: false, responsive: true });
  }

  function renderKpis(r) {
    const { ai, bot } = r;
    const uplift = ai.net - bot.net;
    const payback = Number.isFinite(r.payback) ? `${r.payback.toFixed(1)}-year payback` : "No payback at these settings";
    const kpis = [
      { label: "Net profit, 48 hours", value: money(ai.net), sub: "after battery wear", cls: ai.net < 0 ? "neg" : "" },
      { label: "vs. rule-based bot", value: signedMoney(uplift), sub: `bot: ${money(bot.net)}`, cls: uplift >= 0 ? "pos" : "neg" },
      { label: "Battery cycles used", value: ai.cycles.toFixed(2), sub: `bot: ${bot.cycles.toFixed(2)}` },
      { label: "Estimated annual ROI", value: `${r.roi.toFixed(1)}%`, sub: payback, cls: r.roi < 0 ? "neg" : "" },
    ];
    $("kpis").innerHTML = kpis.map((k) => `
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
    const hurdle = state.wear / state.cap;
    const cyclePart = saved > 0.05
      ? `while using <b>${saved.toFixed(1)} fewer cycles</b>`
      : saved < -0.05 ? `using <b>${(-saved).toFixed(1)} more cycles</b> where they pay off` : "with a similar number of cycles";
    const lead = uplift >= 0
      ? `The AI earns <b>${signedMoney(uplift).slice(1)} more</b> than a rule-based bot over 48 hours, ${cyclePart}, in <b>${ai.runs}</b> charge and discharge runs (bot: ${bot.runs}).`
      : `In this scenario the AI earns ${money(-uplift)} less than the bot, but uses ${ai.runs} runs to the bot's ${bot.runs}.`;
    const tail = hurdle > 0.5
      ? ` It only cycles when the price gap beats about <b>$${Math.round(hurdle)}/MWh</b> of battery wear.`
      : " With wear priced at zero, it trades on almost any price gap.";
    $("insight").innerHTML = lead + tail;
  }

  function renderCompare(r, c) {
    const { ai, bot } = r;
    const rows = [
      ["Trading revenue", money(ai.revenue), money(bot.revenue)],
      ["Battery wear", money(-ai.wear), money(-bot.wear)],
      ["Net profit", money(ai.net), money(bot.net), "total"],
      ["Cycles used", ai.cycles.toFixed(2), bot.cycles.toFixed(2)],
      ["Charge / discharge runs", ai.runs, bot.runs],
    ];
    $("compare").innerHTML = `
      <thead><tr><th></th>
        <th><span class="dot" style="background:${c.ink}"></span>AI agent</th>
        <th><span class="dot" style="background:${c.bot}"></span>Bot</th></tr></thead>
      <tbody>${rows.map(([k, a, b, cls]) => `<tr class="${cls || ""}"><td>${k}</td><td class="ai">${a}</td><td>${b}</td></tr>`).join("")}</tbody>`;
  }

  let state = readState();

  function render() {
    const r = simulate(state);
    const c = palette();
    renderKpis(r);
    renderMainChart(r, c);
    renderInsight(r);
    renderCompare(r, c);
    renderCumChart(r, c);
    $("solve-time").textContent = `Agent planned 192 intervals in ${Math.max(1, Math.round(r.ms))} ms`;
    writeState();
  }

  let queued = false;
  function scheduleRender() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; render(); });
  }

  // ------------------------------------------------------------------------------------
  // 8. Controls & interactions
  // ------------------------------------------------------------------------------------
  function setPct(input) {
    const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
    input.style.setProperty("--pct", pct + "%");
  }

  function buildControls() {
    for (const c of CONTROLS) {
      const wrap = document.createElement("div");
      wrap.className = "field";
      wrap.innerHTML = `
        <label for="in-${c.key}"><span>${c.label}</span><output id="out-${c.key}"></output></label>
        <input type="range" id="in-${c.key}" min="${c.min}" max="${c.max}" step="${c.step}">`;
      $(c.main ? "main-controls" : "more-controls").appendChild(wrap);
      const input = wrap.querySelector("input");
      input.addEventListener("input", () => {
        state[c.key] = parseFloat(input.value);
        $("out-" + c.key).textContent = c.fmt(state[c.key]);
        setPct(input);
        scheduleRender();
      });
    }
    $("scenario-chips").innerHTML = Object.entries(SCENARIOS)
      .map(([k, s], i) => `<button type="button" class="chip" data-key="${k}" title="Shortcut: ${i + 1}">${s.label}</button>`).join("");
    $("scenario-chips").addEventListener("click", (e) => {
      const btn = e.target.closest(".chip");
      if (btn) selectScenario(btn.dataset.key);
    });
  }

  function syncControls() {
    for (const c of CONTROLS) {
      const input = $("in-" + c.key);
      input.value = state[c.key];
      $("out-" + c.key).textContent = c.fmt(state[c.key]);
      setPct(input);
    }
    document.querySelectorAll(".chip").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.key === state.p)));
  }

  function selectScenario(key) {
    const sc = SCENARIOS[key];
    state.p = key;
    state.seed = sc.seed;
    state.vol = sc.volatility;
    syncControls();
    scheduleRender();
  }

  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), 1800);
  }

  async function share() {
    const url = location.href;
    try {
      if (navigator.share && matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ title: "AI Grid Trader", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast("Link to this scenario copied");
    } catch (err) {
      if (err && err.name === "AbortError") return;
      window.prompt("Copy this link:", url);
    }
  }

  function togglePresent() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  }

  function init() {
    if (new URLSearchParams(location.search).has("embed")) document.body.classList.add("embed");
    buildControls();
    syncControls();
    render();

    $("btn-share").addEventListener("click", share);
    $("btn-present").addEventListener("click", togglePresent);
    $("btn-shuffle").addEventListener("click", () => {
      state.seed = Math.floor(Math.random() * 100000);
      scheduleRender();
      toast("New market generated");
    });

    // Keyboard shortcuts for presenting: 1–4 switch scenario, N new day, F full screen.
    document.addEventListener("keydown", (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || /input|textarea|select/i.test(e.target.tagName) && e.target.type !== "range") return;
      const keys = Object.keys(SCENARIOS);
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= keys.length) selectScenario(keys[n - 1]);
      else if (e.key === "f" || e.key === "F") togglePresent();
      else if (e.key === "n" || e.key === "N") $("btn-shuffle").click();
    });

    // Follow the system light/dark theme live.
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", scheduleRender);
    // Opening a shared link while the page is open.
    window.addEventListener("hashchange", () => {
      const next = readState();
      if (JSON.stringify(next) !== JSON.stringify(state)) { state = next; syncControls(); scheduleRender(); }
    });
  }

  init();
})();
