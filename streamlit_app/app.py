"""
=====================================================================================
 AI GRID TRADER  -  Reinforcement-Learning Battery Arbitrage Demo
 ** EARLIER ANALYST PROTOTYPE **
=====================================================================================

 NOTE: This Streamlit app is the original prototype. It uses simulated prices and a
 perfect-foresight agent only. The main product is the web demo (ai-grid-trader.html at the
 repository root, live at https://baizakisaev.com/ai-grid-trader), which adds
 real market data for a full year, forecast-driven trading, a hindsight benchmark and
 automated tests. Results from the two versions are not directly comparable.

 WHAT THIS APP DOES (the 30-second stakeholder pitch)
 ----------------------------------------------------
 A grid-scale battery makes money by buying electricity when it is cheap (charging)
 and selling it back when it is expensive (discharging). The catch: every cycle wears
 the battery out. A naive bot that chases every tiny price wiggle earns a little
 revenue but quietly destroys millions of dollars of hardware.

 Our "AI Grid Trader" is a Reinforcement-Learning (RL) agent whose REWARD FUNCTION
 prices that wear in explicitly. It therefore:
     1. Buys low / sells high (arbitrage),
     2. Refuses trades whose spread does not pay for the battery wear it causes,
     3. Avoids "micro-cycling" (fragmented back-and-forth trading) entirely.

 HOW THE "AGENT" IS BUILT FOR A LIVE DEMO
 ----------------------------------------
 Training a deep RL model live on stage is slow and non-deterministic. Instead we
 compute the *converged* Q-function directly with exact Bellman backups (backward
 induction / dynamic programming) over a discretised state space:

        state  = (time step, battery state-of-charge, current operating mode)
        action = how many MWh to charge (+) or discharge (-) this interval

 This is mathematically the same fixed point that tabular Q-learning converges to
 after unlimited training on this price curve, i.e. it mimics a FULLY TRAINED agent,
 but it is computed in well under a second, every time a slider moves.

 CODE MAP
 --------
   Configuration ........ BatteryConfig, MarketConfig, SocGrid
   Market data .......... MarketSimulator           (48h mock wholesale prices)
   Physics & accounting . BatteryLedger             (shared by every agent - fair test)
   Agents ............... RLGridTrader              (the AI - Q-table via Bellman)
                          NaiveThresholdTrader      (degradation-blind benchmark bot)
   Analytics ............ FinancialSummary          (ROI, payback, annualisation)
   Charts ............... ChartFactory              (all Plotly figures)
   UI ................... DashboardUI               (Streamlit layout)

 Run with:   streamlit run app.py
=====================================================================================
"""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass
from typing import Dict, Iterator, Tuple

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from plotly.subplots import make_subplots

# -----------------------------------------------------------------------------------
# GLOBAL CONSTANTS
# -----------------------------------------------------------------------------------
STEPS_PER_HOUR = 4                          # 15-minute market intervals
DT_HOURS = 1.0 / STEPS_PER_HOUR             # length of one interval in hours
HORIZON_HOURS = 48                          # two trading days
N_STEPS = HORIZON_HOURS * STEPS_PER_HOUR    # 192 decision points
TARGET_SOC_GRID_POINTS = 101                # ~1% state-of-charge resolution
NEG_INF = -1e12                             # "impossible" value for infeasible states

# Operating modes - part of the agent's state so it can "remember" what it is doing.
IDLE, CHARGE, DISCHARGE = 0, 1, 2
MODE_LABELS = {IDLE: "Hold", CHARGE: "Charge", DISCHARGE: "Discharge"}

# A single colour palette keeps every chart visually consistent.
COLORS = {
    "price": "#F5A623",        # amber  - market price
    "soc": "#3D7EFF",          # blue   - battery state of charge
    "soc_fill": "rgba(61,126,255,0.15)",
    "charge": "#00C853",       # green  - buying / charging
    "discharge": "#FF3B30",    # red    - selling / discharging
    "ai": "#00B8D9",           # teal   - the AI agent
    "naive": "#9E9E9E",        # grey   - the benchmark bot
    "neutral": "rgba(128,128,128,0.10)",
}


# ===================================================================================
# 1. CONFIGURATION OBJECTS
# ===================================================================================
@dataclass(frozen=True)
class BatteryConfig:
    """Physical and economic description of the battery asset (all sidebar-driven)."""

    capacity_mwh: float = 100.0              # usable energy capacity
    max_power_mw: float = 25.0               # max charge/discharge rate
    round_trip_eff_pct: float = 88.0         # energy out / energy in, over a full cycle
    degradation_cost_per_cycle: float = 3000.0   # $ of battery life consumed per full cycle
    fragmentation_penalty: float = 300.0     # $ penalty for starting a new trade block
    soc_min_pct: float = 10.0                # health guard-rails: never drain below...
    soc_max_pct: float = 90.0                # ...or fill above these levels
    initial_soc_pct: float = 50.0            # where the battery starts the horizon
    capex_per_kwh: float = 300.0             # installed cost, used for ROI

    # --- Derived quantities (kept as properties so they can never go out of sync) ---
    @property
    def eta_charge(self) -> float:
        """One-way charging efficiency (round-trip split evenly across both legs)."""
        return float(np.sqrt(self.round_trip_eff_pct / 100.0))

    @property
    def eta_discharge(self) -> float:
        """One-way discharging efficiency."""
        return float(np.sqrt(self.round_trip_eff_pct / 100.0))

    @property
    def degradation_cost_per_mwh(self) -> float:
        """
        Wear cost per MWh of throughput. One full cycle = charge the full capacity AND
        discharge it again, i.e. 2 x capacity of throughput.
        """
        return self.degradation_cost_per_cycle / (2.0 * self.capacity_mwh)

    @property
    def capex_usd(self) -> float:
        return self.capacity_mwh * 1000.0 * self.capex_per_kwh

    @property
    def c_rate(self) -> float:
        """Power-to-energy ratio. 0.25C = a '4-hour battery'."""
        return self.max_power_mw / self.capacity_mwh


@dataclass(frozen=True)
class MarketConfig:
    """Controls for the synthetic wholesale market."""

    seed: int = 42                 # change for a different (but reproducible) scenario
    volatility: float = 5.0        # std-dev of short-term price noise ($/MWh)
    base_price: float = 42.0       # average off-peak price level ($/MWh)


@dataclass(frozen=True)
class SocGrid:
    """
    Discretisation of the battery's state of charge (SOC) into a grid of levels.

    The grid spacing is chosen so that "full power for one interval" is an exact
    integer number of grid steps, guaranteeing the agent never exceeds the MW rating.
    """

    delta_mwh: float     # energy represented by one grid step
    n_states: int        # number of SOC levels
    max_jump: int        # max grid steps the battery can move in one interval
    lo: int              # lowest allowed SOC index (health guard-rail)
    hi: int              # highest allowed SOC index (health guard-rail)
    s0: int              # starting SOC index

    @classmethod
    def from_battery(cls, b: BatteryConfig) -> "SocGrid":
        # Max energy movable in one interval - can never exceed the whole battery.
        e_max = min(b.max_power_mw * DT_HOURS, b.capacity_mwh)
        target_delta = b.capacity_mwh / (TARGET_SOC_GRID_POINTS - 1)
        max_jump = max(1, int(round(e_max / target_delta)))
        delta = e_max / max_jump                         # exact multiple of rated power
        n_states = int(np.floor(b.capacity_mwh / delta + 1e-9)) + 1

        lo = int(np.ceil(b.soc_min_pct / 100.0 * b.capacity_mwh / delta - 1e-9))
        hi = int(np.floor(b.soc_max_pct / 100.0 * b.capacity_mwh / delta + 1e-9))
        lo, hi = max(0, lo), min(n_states - 1, hi)
        if hi <= lo:                                     # defensive: degenerate window
            hi = min(n_states - 1, lo + 1)
        s0 = int(np.clip(round(b.initial_soc_pct / 100.0 * b.capacity_mwh / delta), lo, hi))
        return cls(delta, n_states, max_jump, lo, hi, s0)

    def to_pct(self, idx, capacity_mwh: float):
        return np.asarray(idx) * self.delta_mwh / capacity_mwh * 100.0


# ===================================================================================
# 2. MOCK MARKET DATA
# ===================================================================================
class MarketSimulator:
    """
    Generates 48 hours of realistic-looking wholesale electricity prices.

    The shape follows the well-known "duck curve" of solar-heavy grids:
        - cheap overnight (low demand),
        - a MORNING PEAK as people wake up (~08:00),
        - a MIDDAY DIP as solar floods the grid (~13:00, can even go negative),
        - a large EVENING PEAK as solar fades but demand stays high (~19:00).
    On top we add autocorrelated noise (the market never sits still) and a few random
    scarcity spikes in the evening - exactly the volatility that tempts naive bots.
    """

    def __init__(self, cfg: MarketConfig):
        self.cfg = cfg

    @staticmethod
    def _bump(hour_of_day: np.ndarray, center: float, width: float, height: float) -> np.ndarray:
        """Smooth Gaussian bump - the building block of each daily price feature."""
        return height * np.exp(-0.5 * ((hour_of_day - center) / width) ** 2)

    def generate(self) -> pd.DataFrame:
        rng = np.random.default_rng(self.cfg.seed)
        hours = np.arange(N_STEPS) * DT_HOURS
        hod = hours % 24                      # hour of day
        day = (hours // 24).astype(int)       # day index (0 or 1)

        # 1) Deterministic daily shape (the "duck curve")
        shape = (
            self.cfg.base_price
            + self._bump(hod, center=8.0, width=1.6, height=38.0)     # morning peak
            + self._bump(hod, center=19.0, width=2.0, height=75.0)    # evening peak
            - self._bump(hod, center=13.0, width=2.4, height=34.0)    # solar dip
            - self._bump(hod, center=3.5, width=2.2, height=12.0)     # overnight lull
        )

        # 2) Day 2 is a little different (weather, demand) - keeps the demo honest
        day2_scale = rng.uniform(0.9, 1.2)
        shape = np.where(day == 1, shape * day2_scale, shape)

        # 3) AR(1) noise: short-term deviations that persist for a few intervals
        noise = np.zeros(N_STEPS)
        shocks = rng.normal(0.0, self.cfg.volatility, N_STEPS)
        for t in range(1, N_STEPS):
            noise[t] = 0.8 * noise[t - 1] + shocks[t]

        # 4) Random evening scarcity spikes (e.g. a generator trips offline)
        spikes = np.zeros(N_STEPS)
        evening_idx = np.where((hod >= 17) & (hod <= 21))[0]
        for _ in range(int(rng.integers(1, 4))):
            start = int(rng.choice(evening_idx))
            length = int(rng.integers(2, 5))
            spikes[start:start + length] += rng.uniform(25, 80)

        price = np.clip(shape + noise + spikes, -25.0, None)   # price floor (curtailment)

        start_ts = pd.Timestamp.today().normalize()
        return pd.DataFrame({
            "timestamp": pd.date_range(start_ts, periods=N_STEPS, freq=f"{int(60 * DT_HOURS)}min"),
            "hour": hours,
            "price": price,
        })


# ===================================================================================
# 3. PHYSICS & ACCOUNTING (shared by all agents)
# ===================================================================================
@dataclass
class DispatchResult:
    """Everything we need to know about how an agent traded over the horizon."""

    name: str
    timeline: pd.DataFrame          # interval-by-interval decision log
    arbitrage_revenue: float        # cash from buying/selling energy (+ inventory value)
    degradation_cost: float         # $ of battery life consumed
    net_profit: float               # what actually matters: revenue - wear
    equivalent_cycles: float        # full-cycle equivalents used
    trade_blocks: int               # number of distinct charge/discharge episodes
    direction_reversals: int        # charge<->discharge flips (micro-cycling signature)


class BatteryLedger:
    """
    Converts an agent's energy decisions into money and battery wear.

    IMPORTANT FOR STAKEHOLDERS: both the AI and the benchmark bot are scored by this
    exact same ledger, so any difference in profit comes purely from decision quality.
    """

    def __init__(self, battery: BatteryConfig, market: pd.DataFrame):
        self.b = battery
        self.market = market

    def settle(self, name: str, moves_mwh: np.ndarray, soc_mwh: np.ndarray,
               soc_start_mwh: float) -> DispatchResult:
        prices = self.market["price"].to_numpy()

        # Battery-side energy: + means energy flowed INTO the battery (charging).
        buy_mwh = np.where(moves_mwh > 0, moves_mwh / self.b.eta_charge, 0.0)       # grid energy bought
        sell_mwh = np.where(moves_mwh < 0, -moves_mwh * self.b.eta_discharge, 0.0)  # grid energy sold

        cash = prices * (sell_mwh - buy_mwh)
        wear = np.abs(moves_mwh) * self.b.degradation_cost_per_mwh

        # End-of-horizon inventory mark-to-market: energy left in (or missing from) the
        # battery vs. the start is valued at the average price, so no agent can look
        # profitable just by draining the battery on the last day.
        inventory_adj = (soc_mwh[-1] - soc_start_mwh) * prices.mean()

        step_net = cash - wear
        cumulative = np.cumsum(step_net)
        cumulative[-1] += inventory_adj

        modes = np.where(moves_mwh > 1e-9, CHARGE, np.where(moves_mwh < -1e-9, DISCHARGE, IDLE))
        timeline = pd.DataFrame({
            "timestamp": self.market["timestamp"],
            "price": prices,
            "mode": modes,
            "action": [MODE_LABELS[m] for m in modes],
            "power_mw": moves_mwh / DT_HOURS,          # + charge, - discharge
            "soc_pct": soc_mwh / self.b.capacity_mwh * 100.0,
            "cash_flow": cash,
            "degradation": -wear,
            "net_reward": step_net,
            "cum_net_profit": cumulative,
        })

        revenue = float(cash.sum() + inventory_adj)
        degradation = float(wear.sum())
        return DispatchResult(
            name=name,
            timeline=timeline,
            arbitrage_revenue=revenue,
            degradation_cost=degradation,
            net_profit=revenue - degradation,
            equivalent_cycles=float(np.abs(moves_mwh).sum() / (2.0 * self.b.capacity_mwh)),
            trade_blocks=self._count_blocks(modes),
            direction_reversals=self._count_reversals(modes),
        )

    @staticmethod
    def _count_blocks(modes: np.ndarray) -> int:
        """A 'trade block' starts whenever the battery enters charge or discharge mode."""
        prev = np.concatenate([[IDLE], modes[:-1]])
        return int(np.sum((modes != IDLE) & (modes != prev)))

    @staticmethod
    def _count_reversals(modes: np.ndarray) -> int:
        """How often the battery flips between charging and discharging (ignoring holds)."""
        active = modes[modes != IDLE]
        return int(np.sum(active[1:] != active[:-1])) if active.size > 1 else 0


# ===================================================================================
# 4a. THE AI AGENT  -  converged Q-learning policy via exact Bellman backups
# ===================================================================================
class RLGridTrader:
    """
    Reinforcement-Learning battery trader.

    REWARD at each 15-min step (what the agent is trying to maximise in total):

        R_t =  price_t * (MWh sold - MWh bought)                 <- arbitrage cash
             - degradation_cost_per_MWh * |MWh moved|            <- battery wear
             - fragmentation_penalty * [started a NEW trade block] <- anti micro-cycling

    Q-FUNCTION: Q(s, a) = immediate reward + best achievable future reward.
    We obtain the optimal ("fully trained") Q-table by sweeping backwards in time:

        Q*(t, soc, mode, a) = R_t(a) + max_a' Q*(t+1, soc + a, mode(a), a')

    This is the Bellman optimality equation - the same target tabular Q-learning
    chases during training - solved exactly, so the demo is fast and repeatable.
    """

    def __init__(self, battery: BatteryConfig):
        self.b = battery
        self.grid = SocGrid.from_battery(battery)
        J = self.grid.max_jump

        # Action set, ordered [0, +1, -1, +2, -2, ...] so that, if two actions are
        # exactly equally good, argmax prefers HOLD (conservative tie-breaking).
        order = [0]
        for k in range(1, J + 1):
            order += [k, -k]
        self.jumps = np.array(order, dtype=int)                       # grid steps per action
        self.action_mode = np.where(self.jumps > 0, CHARGE,
                                    np.where(self.jumps < 0, DISCHARGE, IDLE))
        self.policy: np.ndarray | None = None     # (T, S, 3) -> best action index
        self.value_at_start: float = 0.0          # Bellman value of the starting state
        self.state_action_pairs: int = 0

    # ------------------------------------------------------------------ "training"
    def train(self, prices: np.ndarray) -> None:
        g, b = self.grid, self.b
        T, S, A = len(prices), g.n_states, len(self.jumps)
        energy = self.jumps * g.delta_mwh                              # (A,) MWh, + = charge

        # ---- Immediate reward matrix R[t, a] ------------------------------------
        p = prices[:, None]
        cash = np.where(energy > 0,
                        -p * energy / b.eta_charge,                    # pay to charge
                        -p * energy * b.eta_discharge)                 # get paid to discharge
        wear = np.abs(energy) * b.degradation_cost_per_mwh
        R = cash - wear[None, :]                                       # (T, A)

        # ---- Micro-cycling penalty P[prev_mode, a] --------------------------------
        # Charged only when the action STARTS a new block: entering charge/discharge
        # from a different mode. Continuing an existing block is free.
        prev_modes = np.arange(3)[:, None]
        new_block = (self.action_mode[None, :] != IDLE) & (self.action_mode[None, :] != prev_modes)
        P = np.where(new_block, b.fragmentation_penalty, 0.0)          # (3, A)

        # ---- State transitions -----------------------------------------------------
        s_idx = np.arange(S)
        nxt = s_idx[:, None] + self.jumps[None, :]                     # (S, A) next SOC
        in_window = (s_idx >= g.lo) & (s_idx <= g.hi)
        valid = (nxt >= g.lo) & (nxt <= g.hi) & in_window[:, None]     # SOC guard-rails
        nxt_c = np.clip(nxt, 0, S - 1)

        # ---- Terminal value: must finish at least as full as it started -----------
        # Surplus energy is valued at the average price (same rule as the ledger).
        V = np.full((S, 3), NEG_INF)
        ok = in_window & (s_idx >= g.s0)
        V[ok, :] = ((s_idx[ok] - g.s0) * g.delta_mwh * prices.mean())[:, None]

        # ---- Backward induction (Bellman backups), fully vectorised ---------------
        policy = np.zeros((T, S, 3), dtype=np.int16)
        for t in range(T - 1, -1, -1):
            future = V[nxt_c, self.action_mode[None, :]]               # (S, A)
            q_sa = np.where(valid, R[t][None, :] + future, NEG_INF)    # (S, A)
            Q = q_sa[:, None, :] - P[None, :, :]                       # (S, 3, A)
            policy[t] = Q.argmax(axis=2)                               # greedy = optimal
            V = Q.max(axis=2)

        self.policy = policy
        self.value_at_start = float(V[g.s0, IDLE])
        self.state_action_pairs = T * S * 3 * A

    # ------------------------------------------------------------------ "inference"
    def rollout(self) -> Tuple[np.ndarray, np.ndarray]:
        """Execute the learned policy from the starting state. Returns (moves, soc) in MWh."""
        assert self.policy is not None, "Call train() first."
        g = self.grid
        T = self.policy.shape[0]
        moves, soc = np.zeros(T), np.zeros(T)
        s, mode = g.s0, IDLE
        for t in range(T):
            a = int(self.policy[t, s, mode])
            j = int(self.jumps[a])
            s += j
            mode = int(self.action_mode[a])
            moves[t], soc[t] = j * g.delta_mwh, s * g.delta_mwh
        return moves, soc

    def policy_power_map(self) -> Tuple[np.ndarray, np.ndarray]:
        """
        The agent's 'brain' as a picture: for every (time, SOC) cell, the MW it would
        dispatch (assuming it is currently holding). Returns (z[SOC, time], soc_axis_pct).
        """
        g = self.grid
        actions = self.policy[:, g.lo:g.hi + 1, IDLE]                   # (T, W)
        power = self.jumps[actions] * g.delta_mwh / DT_HOURS
        soc_axis = g.to_pct(np.arange(g.lo, g.hi + 1), self.b.capacity_mwh)
        return power.T, soc_axis


# ===================================================================================
# 4b. BENCHMARK - a degradation-blind, rule-based trading bot
# ===================================================================================
class NaiveThresholdTrader:
    """
    The 'before' picture: a typical rules-based bot.

    Rule: if the price is a little BELOW its recent (3-hour) average -> charge flat out;
          if it is a little ABOVE -> discharge flat out; otherwise hold.

    It has no concept of battery wear and no foresight, so it reacts to every noisy
    wiggle in price - the textbook definition of micro-cycling.
    """

    def __init__(self, battery: BatteryConfig, lookback_steps: int = 12, band_usd: float = 2.0):
        self.b = battery
        self.grid = SocGrid.from_battery(battery)
        self.lookback = lookback_steps
        self.band = band_usd

    def run(self, prices: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        g = self.grid
        moves, soc = np.zeros(len(prices)), np.zeros(len(prices))
        s = g.s0
        for t, p in enumerate(prices):
            window = prices[max(0, t - self.lookback):t]
            reference = window.mean() if window.size else p
            if p < reference - self.band and s < g.hi:
                j = min(g.max_jump, g.hi - s)            # charge as fast as allowed
            elif p > reference + self.band and s > g.lo:
                j = -min(g.max_jump, s - g.lo)           # discharge as fast as allowed
            else:
                j = 0
            s += j
            moves[t], soc[t] = j * g.delta_mwh, s * g.delta_mwh
        return moves, soc


# ===================================================================================
# 5. FINANCIAL ANALYTICS
# ===================================================================================
@dataclass(frozen=True)
class FinancialSummary:
    """Scales 48-hour results to annual figures executives care about."""

    annual_profit: float
    roi_pct: float
    payback_years: float
    annual_cycles: float

    @classmethod
    def build(cls, result: DispatchResult, battery: BatteryConfig) -> "FinancialSummary":
        annualisation = 365.0 / (HORIZON_HOURS / 24.0)
        annual_profit = result.net_profit * annualisation
        roi = annual_profit / battery.capex_usd * 100.0 if battery.capex_usd > 0 else 0.0
        payback = battery.capex_usd / annual_profit if annual_profit > 0 else float("inf")
        return cls(annual_profit, roi, payback, result.equivalent_cycles * annualisation)


# ===================================================================================
# 6. CACHED SIMULATION PIPELINE (keeps the UI snappy when sliders move)
# ===================================================================================
@st.cache_data(show_spinner=False)
def simulate_market(seed: int, volatility: float) -> pd.DataFrame:
    return MarketSimulator(MarketConfig(seed=seed, volatility=volatility)).generate()


@st.cache_data(show_spinner=False)
def run_scenario(battery_params: Dict, seed: int, volatility: float) -> Dict:
    """End-to-end pipeline: market -> AI agent + benchmark -> settled results."""
    battery = BatteryConfig(**battery_params)
    market = simulate_market(seed, volatility)
    prices = market["price"].to_numpy()
    ledger = BatteryLedger(battery, market)

    # --- The AI agent ---
    agent = RLGridTrader(battery)
    t0 = time.perf_counter()
    agent.train(prices)
    solve_ms = (time.perf_counter() - t0) * 1000.0
    ai_moves, ai_soc = agent.rollout()
    soc_start = agent.grid.s0 * agent.grid.delta_mwh
    ai = ledger.settle("AI Grid Trader", ai_moves, ai_soc, soc_start)

    # --- The benchmark bot ---
    naive_moves, naive_soc = NaiveThresholdTrader(battery).run(prices)
    naive = ledger.settle("Rule-Based Bot", naive_moves, naive_soc, soc_start)

    policy_map, policy_soc_axis = agent.policy_power_map()
    return {
        "market": market,
        "ai": ai,
        "naive": naive,
        "policy_map": policy_map,
        "policy_soc_axis": policy_soc_axis,
        "solve_ms": solve_ms,
        "state_action_pairs": agent.state_action_pairs,
        "bellman_value": agent.value_at_start,
    }


# ===================================================================================
# 7. FORMATTING HELPERS
# ===================================================================================
def fmt_money(x: float, decimals: int = 0) -> str:
    sign = "-" if x < 0 else ""
    return f"{sign}${abs(x):,.{decimals}f}"


def fmt_signed_money(x: float) -> str:
    return f"{'+' if x >= 0 else '-'}${abs(x):,.0f}"


def iter_blocks(modes: np.ndarray) -> Iterator[Tuple[int, int, int]]:
    """Yield (mode, start_idx, end_idx) for each contiguous charge/discharge block."""
    start = None
    for i, m in enumerate(modes):
        if start is not None and m != modes[start]:
            yield int(modes[start]), start, i - 1
            start = None
        if start is None and m != IDLE:
            start = i
    if start is not None:
        yield int(modes[start]), start, len(modes) - 1


# ===================================================================================
# 8. CHARTS
# ===================================================================================
class ChartFactory:
    """All Plotly figures live here so the UI code stays readable."""

    BASE_LAYOUT = dict(
        hovermode="x unified",
        margin=dict(l=10, r=10, t=50, b=10),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="left", x=0),
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
    )

    @classmethod
    def _titled(cls, title: str, **overrides) -> dict:
        """Layout for titled charts: the legend moves below the plot so the two never collide."""
        layout = {
            **cls.BASE_LAYOUT,
            "title": dict(text=title, x=0, xanchor="left"),
            "legend": dict(orientation="h", yanchor="top", y=-0.14, xanchor="left", x=0),
        }
        layout.update(overrides)
        return layout

    # ---------------------------------------------------------------- main chart
    @classmethod
    def dispatch_chart(cls, result: DispatchResult) -> go.Figure:
        """Dual-axis: price curve (left) + battery SOC (right) + AI buy/sell markers."""
        df = result.timeline
        ts = df["timestamp"]
        fig = make_subplots(specs=[[{"secondary_y": True}]])

        # (a) Soft background shading for every trade block - the 'story' at a glance.
        step = pd.Timedelta(hours=DT_HOURS)
        for mode, i0, i1 in iter_blocks(df["mode"].to_numpy()):
            fig.add_vrect(
                x0=ts.iloc[i0], x1=ts.iloc[i1] + step,
                fillcolor=COLORS["charge"] if mode == CHARGE else COLORS["discharge"],
                opacity=0.14, line_width=0, layer="below",
            )

        # (b) Battery state of charge as a filled area on the secondary axis.
        fig.add_trace(go.Scatter(
            x=ts, y=df["soc_pct"], name="Battery SOC (%)", mode="lines",
            line=dict(color=COLORS["soc"], width=2), fill="tozeroy", fillcolor=COLORS["soc_fill"],
            hovertemplate="SOC: %{y:.1f}%<extra></extra>",
        ), secondary_y=True)

        # (c) The wholesale price curve.
        fig.add_trace(go.Scatter(
            x=ts, y=df["price"], name="Wholesale Price ($/MWh)", mode="lines",
            line=dict(color=COLORS["price"], width=2.5),
            hovertemplate="Price: $%{y:.2f}/MWh<extra></extra>",
        ), secondary_y=False)

        # (d) Decision markers sitting ON the price curve: green = buy, red = sell.
        for mode, label, symbol in ((CHARGE, "AI Charge (Buy)", "triangle-up"),
                                    (DISCHARGE, "AI Discharge (Sell)", "triangle-down")):
            sub = df[df["mode"] == mode]
            color = COLORS["charge"] if mode == CHARGE else COLORS["discharge"]
            fig.add_trace(go.Scatter(
                x=sub["timestamp"], y=sub["price"], name=label, mode="markers",
                marker=dict(symbol=symbol, size=10, color=color,
                            line=dict(width=1, color="rgba(255,255,255,0.8)")),
                customdata=np.abs(sub["power_mw"]),
                hovertemplate=f"{MODE_LABELS[mode].upper()}: " + "%{customdata:.1f} MW<extra></extra>",
            ), secondary_y=False)

        # (e) Day divider.
        midnight = ts.iloc[0] + pd.Timedelta(hours=24)
        fig.add_vline(x=midnight, line_dash="dot", line_color="rgba(128,128,128,0.6)")
        fig.add_annotation(x=midnight, y=1.0, yref="paper", text="  Day 2 →", showarrow=False,
                           xanchor="left", yanchor="top", font=dict(size=11, color="gray"))

        fig.update_layout(height=520, **cls.BASE_LAYOUT)
        fig.update_xaxes(tickformat="%a %H:%M", showgrid=False)
        fig.update_yaxes(title_text="Price ($/MWh)", secondary_y=False, zeroline=True)
        # Explicit ticks: stops the theme "syncing" SOC ticks to odd values like 30.4%.
        fig.update_yaxes(title_text="State of Charge (%)", range=[0, 105], tickmode="array",
                         tickvals=[0, 25, 50, 75, 100], ticksuffix="%",
                         secondary_y=True, showgrid=False)
        return fig

    # ---------------------------------------------------------------- comparison
    @classmethod
    def financial_bars(cls, ai: DispatchResult, naive: DispatchResult) -> go.Figure:
        cats = ["Arbitrage Revenue", "Battery Wear Cost", "Net Profit"]
        fig = go.Figure()
        for res, color in ((naive, COLORS["naive"]), (ai, COLORS["ai"])):
            vals = [res.arbitrage_revenue, -res.degradation_cost, res.net_profit]
            fig.add_bar(name=res.name, x=cats, y=vals, marker_color=color,
                        text=[fmt_money(v) for v in vals], textposition="outside",
                        hovertemplate="%{x}: %{text}<extra>" + res.name + "</extra>")
        fig.update_layout(height=420, barmode="group",
                          **cls._titled("48-Hour P&L Breakdown", hovermode="closest"))
        fig.update_yaxes(title_text="USD", zeroline=True)
        return fig

    @classmethod
    def cumulative_profit(cls, ai: DispatchResult, naive: DispatchResult) -> go.Figure:
        fig = go.Figure()
        for res, color in ((naive, COLORS["naive"]), (ai, COLORS["ai"])):
            fig.add_trace(go.Scatter(
                x=res.timeline["timestamp"], y=res.timeline["cum_net_profit"], name=res.name,
                mode="lines", line=dict(color=color, width=3),
                hovertemplate="%{y:$,.0f}<extra>" + res.name + "</extra>",
            ))
        fig.update_layout(height=420, **cls._titled("Cumulative Net Profit (after battery wear)"))
        fig.update_xaxes(tickformat="%a %H:%M", showgrid=False)
        fig.update_yaxes(title_text="USD", zeroline=True)
        return fig

    @classmethod
    def soc_fingerprint(cls, ai: DispatchResult, naive: DispatchResult) -> go.Figure:
        """The visual proof of micro-cycling: jagged grey sawtooth vs. smooth AI cycles."""
        fig = go.Figure()
        for res, color, width in ((naive, COLORS["naive"], 1.5), (ai, COLORS["ai"], 3)):
            fig.add_trace(go.Scatter(
                x=res.timeline["timestamp"], y=res.timeline["soc_pct"], name=res.name,
                mode="lines", line=dict(color=color, width=width),
                hovertemplate="%{y:.1f}%<extra>" + res.name + "</extra>",
            ))
        fig.update_layout(height=360, **cls._titled("Battery Stress Fingerprint — State of Charge"))
        fig.update_xaxes(tickformat="%a %H:%M", showgrid=False)
        fig.update_yaxes(title_text="SOC (%)", range=[0, 105])
        return fig

    # ---------------------------------------------------------------- policy map
    @classmethod
    def policy_heatmap(cls, z: np.ndarray, soc_axis: np.ndarray, ai: DispatchResult) -> go.Figure:
        zmax = max(float(np.abs(z).max()), 1.0)
        fig = go.Figure(go.Heatmap(
            z=z, x=ai.timeline["timestamp"], y=soc_axis, zmin=-zmax, zmax=zmax,
            colorscale=[[0.0, COLORS["discharge"]], [0.5, COLORS["neutral"]], [1.0, COLORS["charge"]]],
            colorbar=dict(title="MW", tickformat="+.0f"),
            hovertemplate="%{x|%a %H:%M}<br>If SOC = %{y:.0f}% → %{z:+.1f} MW<extra></extra>",
        ))
        fig.add_trace(go.Scatter(
            x=ai.timeline["timestamp"], y=ai.timeline["soc_pct"], mode="lines",
            name="Actual SOC path", line=dict(color=COLORS["soc"], width=3),
            hovertemplate="Actual SOC: %{y:.1f}%<extra></extra>",
        ))
        fig.update_layout(height=500, **cls._titled(
            "Learned Policy: action for every (time, SOC) state", hovermode="closest"))
        fig.update_xaxes(tickformat="%a %H:%M")
        fig.update_yaxes(title_text="State of Charge (%)")
        return fig


# ===================================================================================
# 9. STREAMLIT DASHBOARD
# ===================================================================================
CUSTOM_CSS = """
<style>
    .block-container {padding-top: 1.6rem;}
    .hero {
        background: linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%);
        padding: 1.4rem 1.8rem; border-radius: 16px; color: #fff; margin-bottom: 1.2rem;
        box-shadow: 0 8px 24px rgba(0,0,0,0.18);
    }
    .hero .title {font-size: 2.1rem; font-weight: 800; margin: 0; letter-spacing: -0.02em;}
    .hero .subtitle {margin: .35rem 0 .7rem; opacity: .85; font-size: 1.02rem;}
    .badge {
        display: inline-block; padding: .18rem .65rem; border-radius: 999px; margin-right: .4rem;
        font-size: .72rem; font-weight: 700; letter-spacing: .06em;
        background: rgba(0,230,118,.18); color: #69f0ae; border: 1px solid rgba(105,240,174,.35);
    }
    .badge.blue {background: rgba(61,126,255,.2); color: #9ec1ff; border-color: rgba(158,193,255,.35);}
    div[data-testid="stMetric"] {
        background: rgba(128,128,128,0.07); border: 1px solid rgba(128,128,128,0.22);
        border-radius: 14px; padding: .85rem 1rem;
    }
    div[data-testid="stMetricValue"] {font-weight: 700;}
    .insight {
        border-left: 5px solid #00C853; background: rgba(0,200,83,0.08);
        padding: .85rem 1.1rem; border-radius: 10px; margin: .4rem 0 1rem; font-size: 1.02rem;
    }
    .card {
        background: rgba(128,128,128,0.07); border: 1px solid rgba(128,128,128,0.22);
        border-radius: 14px; padding: 1rem 1.1rem; height: 100%;
    }
    .card h4 {margin: 0 0 .4rem; font-size: 1.05rem;}
    .card p {margin: 0; opacity: .85; font-size: .93rem; line-height: 1.45;}
</style>
"""


class DashboardUI:
    """Lays out the executive dashboard. Each render_* method is one visual section."""

    def __init__(self) -> None:
        st.set_page_config(page_title="AI Grid Trader", page_icon="⚡", layout="wide",
                           initial_sidebar_state="expanded")
        st.markdown(CUSTOM_CSS, unsafe_allow_html=True)

    # ---------------------------------------------------------------- sidebar
    def render_sidebar(self) -> Tuple[BatteryConfig, MarketConfig]:
        sb = st.sidebar
        sb.markdown("## ⚙️ Control Room")
        sb.caption("Change any setting — the AI re-plans the full 48 hours instantly.")

        sb.subheader("🔋 Battery Asset")
        capacity = sb.slider("Battery Capacity (MWh)", 10, 500, 100, 10,
                             help="Usable energy the battery can store.")
        power = sb.slider("Max Charge / Discharge Rate (MW)", 5, 200, 25, 5,
                          help="How fast the battery can buy or sell energy.")
        efficiency = sb.slider("Round-Trip Efficiency (%)", 70, 98, 88, 1,
                               help="Share of energy you get back after a full charge/discharge.")
        sb.caption(f"Duration: **{capacity / power:.1f} h** battery  ·  C-rate **{power / capacity:.2f}C**")

        sb.subheader("🩺 Battery Health")
        degradation = sb.slider("Degradation Cost per Cycle ($)", 0, 20000, 3000, 250,
                                help="Value of battery life consumed by one full charge+discharge "
                                     "cycle ≈ replacement cost ÷ rated cycle life.")
        fragmentation = sb.slider("Micro-Cycling Penalty ($ per new trade block)", 0, 2000, 300, 50,
                                  help="Extra cost of starting a new charge/discharge episode "
                                       "(thermal stress, partial cycles). Teaches the AI to trade "
                                       "in fewer, decisive blocks.")
        soc_lo, soc_hi = sb.slider("Allowed SOC Window (%)", 0, 100, (10, 90), 5,
                                   help="Keeping away from 0% and 100% extends lithium-ion life.")
        if soc_hi - soc_lo < 20:
            sb.warning("SOC window very narrow — widened to 20% for a meaningful demo.")
            soc_lo, soc_hi = (soc_lo, soc_lo + 20) if soc_lo + 20 <= 100 else (80, 100)

        sb.subheader("📈 Market Scenario")
        seed = int(sb.number_input("Scenario Seed", min_value=0, max_value=9999, value=42, step=1,
                                   help="Each seed is a different (reproducible) 48h market."))
        volatility = sb.slider("Price Volatility ($/MWh noise)", 0.0, 15.0, 5.0, 0.5,
                               help="Higher volatility tempts naive bots into micro-cycling.")

        sb.subheader("💰 Financials")
        capex = sb.slider("Installed CapEx ($/kWh)", 100, 600, 300, 25,
                          help="All-in installed cost, used for ROI and payback.")

        sb.divider()
        sb.caption("Prices are simulated for demonstration purposes.")

        battery = BatteryConfig(
            capacity_mwh=float(capacity), max_power_mw=float(power),
            round_trip_eff_pct=float(efficiency), degradation_cost_per_cycle=float(degradation),
            fragmentation_penalty=float(fragmentation), soc_min_pct=float(soc_lo),
            soc_max_pct=float(soc_hi), initial_soc_pct=float(np.clip(50, soc_lo, soc_hi)),
            capex_per_kwh=float(capex),
        )
        return battery, MarketConfig(seed=seed, volatility=float(volatility))

    # ---------------------------------------------------------------- header
    @staticmethod
    def render_header() -> None:
        st.markdown(
            """
            <div class="hero">
                <div class="title">⚡ AI Grid Trader</div>
                <div class="subtitle">Reinforcement-learning battery dispatch that maximises
                arbitrage profit <b>while protecting battery lifespan</b>.</div>
                <span class="badge">● LIVE DEMO</span>
                <span class="badge blue">RL POLICY · CONVERGED</span>
                <span class="badge blue">48H · 15-MIN INTERVALS</span>
            </div>
            """,
            unsafe_allow_html=True,
        )
        st.info(
            "**Earlier analyst prototype.** This version uses simulated prices and a perfect-foresight "
            "agent only. For real market data, forecast-driven trading and full-year results, use the "
            "[web demo](https://baizakisaev.com/ai-grid-trader).",
            icon="ℹ️",
        )

    # ---------------------------------------------------------------- KPIs
    @staticmethod
    def render_kpis(ai: DispatchResult, naive: DispatchResult, battery: BatteryConfig) -> None:
        fin = FinancialSummary.build(ai, battery)
        c1, c2, c3, c4, c5 = st.columns(5)
        c1.metric("Total Net Profit (48h)", fmt_money(ai.net_profit),
                  f"{fmt_signed_money(ai.net_profit - naive.net_profit)} vs rule-based bot",
                  help="Arbitrage revenue minus the dollar value of battery wear.")
        c2.metric("Cycles Used", f"{ai.equivalent_cycles:.2f}",
                  f"{ai.equivalent_cycles - naive.equivalent_cycles:+.2f} vs bot",
                  delta_color="inverse",
                  help="Full-cycle equivalents = total MWh throughput ÷ (2 × capacity).")
        payback = "n/a" if not np.isfinite(fin.payback_years) else f"{fin.payback_years:.1f} yr payback"
        c3.metric("Estimated ROI (annualised)", f"{fin.roi_pct:.1f}%", payback, delta_color="off",
                  help="48h net profit scaled to a year, divided by installed CapEx. Energy "
                       "arbitrage only (excludes capacity / ancillary-service revenue). Illustrative.")
        c4.metric("Battery Wear Cost", fmt_money(ai.degradation_cost),
                  f"{fmt_signed_money(ai.degradation_cost - naive.degradation_cost)} vs bot",
                  delta_color="inverse")
        c5.metric("Trade Blocks", f"{ai.trade_blocks}",
                  f"{ai.trade_blocks - naive.trade_blocks:+d} vs bot", delta_color="inverse",
                  help="Distinct charge/discharge episodes. Fewer = less micro-cycling.")

    @staticmethod
    def render_insight(ai: DispatchResult, naive: DispatchResult, battery: BatteryConfig) -> None:
        uplift = ai.net_profit - naive.net_profit
        cycles_saved = naive.equivalent_cycles - ai.equivalent_cycles
        hurdle = battery.degradation_cost_per_cycle / battery.capacity_mwh
        cycles_txt = (f"using <b>{cycles_saved:.1f} fewer cycles</b>" if cycles_saved > 0.05
                      else "with a comparable number of cycles")
        st.markdown(
            f"""<div class="insight">🧠 The AI earned <b>{fmt_signed_money(uplift)}</b> more net profit
            than a rule-based bot over 48 hours, {cycles_txt} and only <b>{ai.trade_blocks}</b> trade
            blocks (vs {naive.trade_blocks}). At current settings, a price spread must exceed roughly
            <b>${hurdle:,.0f}/MWh</b> plus efficiency losses before the AI considers a cycle worth the wear.
            </div>""",
            unsafe_allow_html=True,
        )

    # ---------------------------------------------------------------- tabs
    @staticmethod
    def render_dispatch_tab(ai: DispatchResult) -> None:
        st.plotly_chart(ChartFactory.dispatch_chart(ai))
        st.caption("Green ▲ = AI charges (buys) · Red ▼ = AI discharges (sells) · "
                   "Blue area = battery state of charge (right axis). Shaded bands mark each trade block.")

        st.markdown("#### Executive summary — how the AI decides")
        c1, c2, c3 = st.columns(3)
        c1.markdown("""<div class="card"><h4>💵 Buy low, sell high</h4><p>The agent is rewarded
            for every dollar of arbitrage: it charges into the overnight lull and solar dip, and
            sells into the morning and evening peaks.</p></div>""", unsafe_allow_html=True)
        c2.markdown("""<div class="card"><h4>🛡️ Pay for every cycle</h4><p>Each MWh pushed through
            the battery is charged a wear cost. Small spreads that don't cover that cost are
            ignored — the battery is a finite asset, not a free option.</p></div>""",
                    unsafe_allow_html=True)
        c3.markdown("""<div class="card"><h4>🎯 Decisive, not twitchy</h4><p>Starting a new trade
            block carries a penalty, so the agent plans whole-day strategies in a few clean
            cycles instead of reacting to every price wiggle.</p></div>""", unsafe_allow_html=True)

    @staticmethod
    def render_comparison_tab(ai: DispatchResult, naive: DispatchResult, battery: BatteryConfig) -> None:
        st.markdown("Both strategies trade the **same market** with the **same battery** and are "
                    "scored by the **same ledger** — the only difference is decision quality.")
        c1, c2 = st.columns(2)
        c1.plotly_chart(ChartFactory.financial_bars(ai, naive))
        c2.plotly_chart(ChartFactory.cumulative_profit(ai, naive))
        st.plotly_chart(ChartFactory.soc_fingerprint(ai, naive))

        rows = []
        for r in (ai, naive):
            fin = FinancialSummary.build(r, battery)
            rows.append({
                "Strategy": r.name,
                "Arbitrage Revenue": fmt_money(r.arbitrage_revenue),
                "Battery Wear": fmt_money(-r.degradation_cost),
                "Net Profit (48h)": fmt_money(r.net_profit),
                "Cycles (48h)": f"{r.equivalent_cycles:.2f}",
                "Cycles / Year": f"{fin.annual_cycles:,.0f}",
                "Trade Blocks": r.trade_blocks,
                "Direction Reversals": r.direction_reversals,
                "Annualised ROI": f"{fin.roi_pct:.1f}%",
            })
        st.dataframe(pd.DataFrame(rows).set_index("Strategy"))
        st.caption("Rule-based bot: charges when price is $2 below its 3-hour average, discharges "
                   "when $2 above. No foresight, no wear model.")

    @staticmethod
    def render_brain_tab(scenario: Dict) -> None:
        st.markdown(
            "This heatmap *is* the trained agent. Every cell answers: **“If the battery were at this "
            "state of charge at this moment, what would the AI do?”** Green = charge, red = discharge, "
            "clear = hold. The blue line is the path it actually took."
        )
        st.plotly_chart(ChartFactory.policy_heatmap(
            scenario["policy_map"], scenario["policy_soc_axis"], scenario["ai"]))
        c1, c2, c3 = st.columns(3)
        c1.metric("State-action values evaluated", f"{scenario['state_action_pairs']:,}")
        c2.metric("Policy solve time", f"{scenario['solve_ms']:.0f} ms")
        c3.metric("Bellman value of start state", fmt_money(scenario["bellman_value"]),
                  help="Expected 48h reward (incl. penalties) the agent forecast before trading.")
        st.caption("Shown for the case where the battery is currently holding. The wide clear bands "
                   "are where spreads are too small to justify battery wear.")

    @staticmethod
    def render_log_tab(ai: DispatchResult) -> None:
        only_active = st.toggle("Show only intervals where the AI traded", value=True)
        df = ai.timeline.drop(columns=["mode"])
        if only_active:
            df = df[df["action"] != MODE_LABELS[IDLE]]
        st.dataframe(
            df,
            hide_index=True,
            column_config={
                "timestamp": st.column_config.DatetimeColumn("Time", format="ddd HH:mm"),
                "price": st.column_config.NumberColumn("Price ($/MWh)", format="$%.2f"),
                "action": "Action",
                "power_mw": st.column_config.NumberColumn("Power (MW, +charge)", format="%.1f"),
                "soc_pct": st.column_config.NumberColumn("SOC (%)", format="%.1f"),
                "cash_flow": st.column_config.NumberColumn("Cash Flow ($)", format="$%.0f"),
                "degradation": st.column_config.NumberColumn("Wear Cost ($)", format="$%.0f"),
                "net_reward": st.column_config.NumberColumn("Net Reward ($)", format="$%.0f"),
                "cum_net_profit": st.column_config.NumberColumn("Cumulative ($)", format="$%.0f"),
            },
        )
        st.download_button("⬇️ Download full decision log (CSV)",
                           ai.timeline.to_csv(index=False).encode("utf-8"),
                           file_name="ai_grid_trader_dispatch.csv", mime="text/csv")

    @staticmethod
    def render_explanation_tab(battery: BatteryConfig) -> None:
        st.markdown("### The reward function: how the AI keeps score")
        st.markdown("Every 15 minutes the agent chooses to **charge, discharge or hold**, and receives a reward:")
        st.latex(
            r"R_t \;=\; \underbrace{p_t\left(\eta_d E^{\text{dis}}_t - \frac{E^{\text{ch}}_t}{\eta_c}\right)}"
            r"_{\text{arbitrage cash}}"
            r"\;-\; \underbrace{C_{\text{cycle}}\,\frac{|\Delta E_t|}{2\,E_{\max}}}_{\text{battery wear}}"
            r"\;-\; \underbrace{\lambda\;\mathbb{1}[\text{new trade block}]}_{\text{anti micro-cycling}}"
        )
        st.markdown(f"""
1. **Arbitrage cash** — revenue from selling at price *p* minus the cost of buying, after
   efficiency losses (η ≈ {battery.eta_charge:.1%} each way).
2. **Battery wear** — every MWh of throughput consumes a slice of the battery's finite cycle
   life, priced at **{fmt_money(battery.degradation_cost_per_cycle)} per full cycle**
   (≈ {fmt_money(battery.degradation_cost_per_mwh, 2)} per MWh moved). The agent pays for wear
   *the moment it trades*, so it only trades when the spread beats the wear.
3. **Micro-cycling penalty** — starting a new charge or discharge block costs
   **{fmt_money(battery.fragmentation_penalty)}**. Rapid back-and-forth trading creates partial
   cycles and thermal stress; this term teaches the agent to act in a few decisive blocks.
""")
        st.markdown("### How the agent learns")
        st.latex(r"Q^*(s_t, a_t) \;=\; R_t \;+\; \max_{a'} \, Q^*(s_{t+1}, a')")
        st.markdown("""
The agent's **state** is *(time, state of charge, current mode)* and its **action** is how much
energy to move. The Q-value of an action is today's reward **plus the best achievable future
reward** — so the agent will happily *wait* through a small price dip if a much better one is
coming, or keep energy in reserve for the evening peak.

In production this Q-function is learned by Q-learning over years of historical and forecast
prices. For this live demo we compute the **converged Q-table directly** with exact Bellman
backups — the same answer a fully trained agent arrives at, delivered in milliseconds and
completely reproducible.

### Why it matters to the business
- **Higher net profit, not just revenue** — the AI optimises the number that hits the P&L.
- **Longer asset life** — fewer, deeper, deliberate cycles protect warranty limits and defer
  multi-million-dollar augmentation.
- **Built-in hurdle rate** — the degradation term acts like a minimum spread; trades that
  don't pay for themselves are never executed.
- **Transparent & auditable** — every decision can be traced to its reward components
  (see the *Decision Log* tab).
""")

    # ---------------------------------------------------------------- main
    def run(self) -> None:
        battery, market_cfg = self.render_sidebar()
        self.render_header()

        with st.spinner("AI agent is planning the optimal 48-hour dispatch…"):
            scenario = run_scenario(asdict(battery), market_cfg.seed, market_cfg.volatility)
        ai, naive = scenario["ai"], scenario["naive"]

        self.render_kpis(ai, naive, battery)
        self.render_insight(ai, naive, battery)

        tabs = st.tabs(["📊 AI Dispatch", "🥊 AI vs Rule-Based Bot", "🧠 Inside the Agent's Brain",
                        "📋 Decision Log", "🎓 How the AI Works"])
        with tabs[0]:
            self.render_dispatch_tab(ai)
        with tabs[1]:
            self.render_comparison_tab(ai, naive, battery)
        with tabs[2]:
            self.render_brain_tab(scenario)
        with tabs[3]:
            self.render_log_tab(ai)
        with tabs[4]:
            self.render_explanation_tab(battery)


# ===================================================================================
# ENTRY POINT
# ===================================================================================
if __name__ == "__main__":
    DashboardUI().run()
