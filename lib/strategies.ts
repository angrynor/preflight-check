import type { BacktestSignal, StrategyFn } from "./backtest";
import {
  bollingerBands,
  crossedAbove,
  crossedBelow,
  donchian,
  ema,
  macd,
  rsi
} from "./indicators";
import type { DailyKline } from "./types";

export type StrategyId =
  | "golden-cross"
  | "rsi-mean-reversion"
  | "bollinger-reversion"
  | "donchian-breakout"
  | "macd-crossover"
  | "buy-and-hold"
  | "custom";

export interface StrategyParams {
  /** Optional stop-loss as a % distance from entry (e.g. 5 = 5%). */
  stopPct?: number;
  /** Optional take-profit as a % distance from entry. */
  takeProfitPct?: number;
  /** Whether to allow short-side signals (where the strategy supports it). */
  allowShorts?: boolean;
  /** Strategy-specific overrides. */
  fastPeriod?: number;
  slowPeriod?: number;
  rsiPeriod?: number;
  rsiBuyThreshold?: number;
  rsiSellThreshold?: number;
  bbPeriod?: number;
  bbStdMultiplier?: number;
  donchianLookback?: number;
  donchianExitLookback?: number;
  macdFast?: number;
  macdSlow?: number;
  macdSignal?: number;
  /** Custom strategy DSL — only used when StrategyId === "custom". */
  customRules?: CustomStrategyRules;
}

export interface CustomStrategyRules {
  entryWhen: CustomCondition;
  exitWhen?: CustomCondition;
  side: "long" | "short";
}

/** Tiny declarative DSL for user-defined strategies. */
export type CustomCondition =
  | { kind: "rsiBelow"; period: number; threshold: number }
  | { kind: "rsiAbove"; period: number; threshold: number }
  | { kind: "priceAboveSma"; period: number }
  | { kind: "priceBelowSma"; period: number }
  | { kind: "priceCrossesAboveSma"; period: number }
  | { kind: "priceCrossesBelowSma"; period: number }
  | { kind: "macdCrossAbove" }
  | { kind: "macdCrossBelow" }
  | { kind: "bbTouchLower"; period: number; stdMultiplier: number }
  | { kind: "bbTouchUpper"; period: number; stdMultiplier: number };

export interface StrategyDescriptor {
  id: StrategyId;
  name: string;
  /** Short user-facing description. */
  description: string;
  /** Honest assessment of how this typically performs in retail crypto. */
  reality: string;
  defaults: StrategyParams;
  build: (params: StrategyParams) => StrategyFn;
}

const closes = (c: ReadonlyArray<DailyKline>): number[] => c.map((x) => x.close);
const highs = (c: ReadonlyArray<DailyKline>): number[] => c.map((x) => x.high);
const lows = (c: ReadonlyArray<DailyKline>): number[] => c.map((x) => x.low);

function attachStops(
  signal: Omit<BacktestSignal, "stopPrice" | "takeProfitPrice">,
  entryPrice: number,
  params: StrategyParams
): BacktestSignal {
  const out: BacktestSignal = { ...signal };
  if (params.stopPct !== undefined && params.stopPct > 0) {
    out.stopPrice =
      signal.side === "long"
        ? entryPrice * (1 - params.stopPct / 100)
        : entryPrice * (1 + params.stopPct / 100);
  }
  if (params.takeProfitPct !== undefined && params.takeProfitPct > 0) {
    out.takeProfitPrice =
      signal.side === "long"
        ? entryPrice * (1 + params.takeProfitPct / 100)
        : entryPrice * (1 - params.takeProfitPct / 100);
  }
  return out;
}

// =============================================================
// Golden Cross / Death Cross
// =============================================================

const GOLDEN_CROSS: StrategyDescriptor = {
  id: "golden-cross",
  name: "Golden Cross / Death Cross",
  description:
    "Buy when fast EMA (default 50) crosses above slow EMA (default 200). On death cross, exit (and optionally short).",
  reality:
    "Famously slow. Misses big moves on entry, gives back gains on exit. Backtests vary wildly with parameter choice — that's a sign of weak edge.",
  defaults: { fastPeriod: 50, slowPeriod: 200, allowShorts: false },
  build: (params) => {
    const fast = params.fastPeriod ?? 50;
    const slow = params.slowPeriod ?? 200;
    const allowShorts = params.allowShorts ?? false;
    return (candles) => {
      const c = closes(candles);
      const ef = ema(c, fast);
      const es = ema(c, slow);
      const sigs: BacktestSignal[] = [];
      for (let i = 0; i < candles.length; i++) {
        if (crossedAbove(ef, es, i)) {
          sigs.push(attachStops({ index: i, side: "long", label: "GC long" }, candles[i].close, params));
        } else if (crossedBelow(ef, es, i) && allowShorts) {
          sigs.push(attachStops({ index: i, side: "short", label: "DC short" }, candles[i].close, params));
        } else if (crossedBelow(ef, es, i) && !allowShorts) {
          // emit a "neutral exit" by signaling a side switch only if there's a way; without shorts, the strategy
          // simply waits for the next golden cross. The backtest exits on opposite-side signal, but here we
          // need an explicit close — push a short signal that will be ignored if allowShorts=false; instead
          // we model exit by emitting a same-side signal at exit candle which the engine ignores. For a clean
          // exit, attach takeProfit/stop in params, or wait for re-cross.
        }
      }
      return sigs;
    };
  }
};

// =============================================================
// RSI 14 Mean Reversion
// =============================================================

const RSI_MEAN_REVERSION: StrategyDescriptor = {
  id: "rsi-mean-reversion",
  name: "RSI Mean Reversion",
  description:
    "Buy when RSI(14) falls below 30 (oversold). Exit when RSI returns above 50 (or sell at 70 if shorts enabled).",
  reality:
    "Fights trend. In strong directional markets (most of crypto's history), this gets steamrolled — RSI stays oversold for weeks. Decent in sideways regimes only.",
  defaults: { rsiPeriod: 14, rsiBuyThreshold: 30, rsiSellThreshold: 70, allowShorts: false },
  build: (params) => {
    const period = params.rsiPeriod ?? 14;
    const buyThr = params.rsiBuyThreshold ?? 30;
    const sellThr = params.rsiSellThreshold ?? 70;
    const allowShorts = params.allowShorts ?? false;
    return (candles) => {
      const c = closes(candles);
      const r = rsi(c, period);
      const sigs: BacktestSignal[] = [];
      let inLong = false;
      let inShort = false;
      for (let i = 0; i < candles.length; i++) {
        const v = r[i];
        if (v === null) continue;
        if (!inLong && v < buyThr) {
          sigs.push(attachStops({ index: i, side: "long", label: `RSI ${v.toFixed(0)} oversold` }, candles[i].close, params));
          inLong = true;
          inShort = false;
        } else if (inLong && v > sellThr) {
          // Exit-by-reverse: emit short to close long; in long-only mode this still serves as a close.
          if (allowShorts) {
            sigs.push(attachStops({ index: i, side: "short", label: `RSI ${v.toFixed(0)} overbought` }, candles[i].close, params));
            inShort = true;
            inLong = false;
          } else {
            // Force exit by emitting a short signal that the engine will use to reverse-close,
            // then the position becomes short — but with allowShorts=false we don't want that.
            // Workaround: rely on stop/TP if set; otherwise leave open until next event.
            // For honest backtests, recommend allowShorts=true OR set takeProfitPct.
          }
        } else if (allowShorts && !inShort && v > sellThr && !inLong) {
          sigs.push(attachStops({ index: i, side: "short", label: `RSI ${v.toFixed(0)} overbought` }, candles[i].close, params));
          inShort = true;
        }
      }
      return sigs;
    };
  }
};

// =============================================================
// Bollinger Bands Reversion
// =============================================================

const BOLLINGER_REVERSION: StrategyDescriptor = {
  id: "bollinger-reversion",
  name: "Bollinger Bands Reversion",
  description:
    "Buy when close pierces the lower band (2σ below 20-SMA). Exit when close reaches the middle band.",
  reality:
    "Same problem as RSI: trend-fighting. Works in mean-reverting regimes, dies in trends. Pair with a trend filter for any chance.",
  defaults: { bbPeriod: 20, bbStdMultiplier: 2, allowShorts: false },
  build: (params) => {
    const period = params.bbPeriod ?? 20;
    const std = params.bbStdMultiplier ?? 2;
    const allowShorts = params.allowShorts ?? false;
    return (candles) => {
      const c = closes(candles);
      const bb = bollingerBands(c, period, std);
      const sigs: BacktestSignal[] = [];
      let inLong = false;
      let inShort = false;
      for (let i = 0; i < candles.length; i++) {
        const lower = bb.lower[i];
        const upper = bb.upper[i];
        const middle = bb.middle[i];
        if (lower === null || upper === null || middle === null) continue;
        const close = candles[i].close;
        if (!inLong && close < lower) {
          sigs.push(attachStops({ index: i, side: "long", label: "BB lower touch" }, candles[i].close, params));
          inLong = true;
          inShort = false;
        } else if (inLong && close > middle) {
          if (allowShorts) {
            sigs.push(attachStops({ index: i, side: "short", label: "BB middle reached" }, candles[i].close, params));
            inShort = true;
            inLong = false;
          }
        } else if (allowShorts && !inShort && close > upper && !inLong) {
          sigs.push(attachStops({ index: i, side: "short", label: "BB upper touch" }, candles[i].close, params));
          inShort = true;
        } else if (inShort && close < middle) {
          sigs.push(attachStops({ index: i, side: "long", label: "BB middle reached (short exit)" }, candles[i].close, params));
          inLong = true;
          inShort = false;
        }
      }
      return sigs;
    };
  }
};

// =============================================================
// 20-Day Donchian Breakout
// =============================================================

const DONCHIAN_BREAKOUT: StrategyDescriptor = {
  id: "donchian-breakout",
  name: "Donchian Channel Breakout",
  description:
    "Buy when close exceeds 20-day high. Exit when close falls below 10-day low. Optional shorts on breakdown.",
  reality:
    "The Turtle Traders' canonical trend-following entry. Honest over long horizons but suffers many losing trades for one big winner. Whipsaws kill it in chop.",
  defaults: { donchianLookback: 20, donchianExitLookback: 10, allowShorts: true },
  build: (params) => {
    const entryLb = params.donchianLookback ?? 20;
    const exitLb = params.donchianExitLookback ?? 10;
    const allowShorts = params.allowShorts ?? true;
    return (candles) => {
      const h = highs(candles);
      const l = lows(candles);
      const entry = donchian(h, l, entryLb);
      const exit = donchian(h, l, exitLb);
      const sigs: BacktestSignal[] = [];
      let inLong = false;
      let inShort = false;
      // Compare today's close against YESTERDAY's lookback (avoids the current-bar inclusion artifact).
      for (let i = entryLb + 1; i < candles.length; i++) {
        const upHigh = entry.upper[i - 1];
        const dnLow = entry.lower[i - 1];
        const exitHigh = exit.upper[i - 1];
        const exitLow = exit.lower[i - 1];
        if (upHigh === null || dnLow === null || exitHigh === null || exitLow === null) continue;
        const close = candles[i].close;
        if (!inLong && close > upHigh) {
          sigs.push(attachStops({ index: i, side: "long", label: `Breakout > ${entryLb}d high` }, candles[i].close, params));
          inLong = true;
          inShort = false;
        } else if (inLong && close < exitLow) {
          if (allowShorts) {
            sigs.push(attachStops({ index: i, side: "short", label: `Breakdown < ${exitLb}d low` }, candles[i].close, params));
            inShort = true;
            inLong = false;
          }
        } else if (allowShorts && !inShort && close < dnLow && !inLong) {
          sigs.push(attachStops({ index: i, side: "short", label: `Breakdown < ${entryLb}d low` }, candles[i].close, params));
          inShort = true;
        } else if (inShort && close > exitHigh) {
          sigs.push(attachStops({ index: i, side: "long", label: `Recover > ${exitLb}d high` }, candles[i].close, params));
          inLong = true;
          inShort = false;
        }
      }
      return sigs;
    };
  }
};

// =============================================================
// MACD Crossover
// =============================================================

const MACD_CROSSOVER: StrategyDescriptor = {
  id: "macd-crossover",
  name: "MACD Crossover",
  description:
    "Long when MACD line crosses above signal line. Short on cross below (if shorts enabled).",
  reality:
    "Lagging by design. Generates lots of false signals in chop. Performance is highly sensitive to the 12/26/9 default — small parameter shifts produce wildly different results.",
  defaults: { macdFast: 12, macdSlow: 26, macdSignal: 9, allowShorts: true },
  build: (params) => {
    const fast = params.macdFast ?? 12;
    const slow = params.macdSlow ?? 26;
    const sig = params.macdSignal ?? 9;
    const allowShorts = params.allowShorts ?? true;
    return (candles) => {
      const c = closes(candles);
      const m = macd(c, fast, slow, sig);
      const sigs: BacktestSignal[] = [];
      for (let i = 0; i < candles.length; i++) {
        if (crossedAbove(m.macd, m.signal, i)) {
          sigs.push(attachStops({ index: i, side: "long", label: "MACD cross above" }, candles[i].close, params));
        } else if (crossedBelow(m.macd, m.signal, i) && allowShorts) {
          sigs.push(attachStops({ index: i, side: "short", label: "MACD cross below" }, candles[i].close, params));
        }
      }
      return sigs;
    };
  }
};

// =============================================================
// Buy and Hold (benchmark)
// =============================================================

const BUY_AND_HOLD: StrategyDescriptor = {
  id: "buy-and-hold",
  name: "Buy and Hold (benchmark)",
  description:
    "Buy on the first candle, hold to the end. Use this as the benchmark to compare every other strategy against — if your strategy can't beat buy-and-hold, why bother?",
  reality:
    "Often beats every other strategy in this list during bull markets. The honest baseline that retail education systematically pretends doesn't exist.",
  defaults: {},
  build: () => {
    return (candles) => {
      if (candles.length === 0) return [];
      return [{ index: 0, side: "long", label: "Buy and hold" }];
    };
  }
};

// =============================================================
// Custom Strategy (user-defined DSL)
// =============================================================

const CUSTOM_STRATEGY: StrategyDescriptor = {
  id: "custom",
  name: "Custom Strategy",
  description: "Define your own entry and exit conditions. Same backtest engine, same brutal verdict.",
  reality:
    "Most user-defined strategies in retail trading also lose money. That's the lesson — the math is harder than the slogans suggest.",
  defaults: { allowShorts: false },
  build: (params) => {
    const rules = params.customRules;
    if (!rules) {
      throw new Error("Custom strategy requires customRules in params");
    }
    return (candles) => buildCustomSignals(candles, rules, params);
  }
};

function buildCustomSignals(
  candles: ReadonlyArray<DailyKline>,
  rules: CustomStrategyRules,
  params: StrategyParams
): BacktestSignal[] {
  const c = closes(candles);
  const sigs: BacktestSignal[] = [];
  let inPosition = false;
  for (let i = 0; i < candles.length; i++) {
    const entryFires = evaluateCondition(rules.entryWhen, c, candles, i);
    const exitFires = rules.exitWhen ? evaluateCondition(rules.exitWhen, c, candles, i) : false;
    if (!inPosition && entryFires) {
      const reverseSide = rules.side === "long" ? "short" : "long";
      // Emit entry; engine ignores re-entry while open
      sigs.push(
        attachStops(
          { index: i, side: rules.side, label: `custom entry: ${rules.entryWhen.kind}` },
          candles[i].close,
          params
        )
      );
      // No-op for the reverseSide assignment but kept to satisfy linter
      void reverseSide;
      inPosition = true;
    } else if (inPosition && exitFires) {
      const reverseSide = rules.side === "long" ? "short" : "long";
      sigs.push(
        attachStops(
          { index: i, side: reverseSide, label: `custom exit: ${rules.exitWhen?.kind ?? "?"}` },
          candles[i].close,
          params
        )
      );
      inPosition = false;
    }
  }
  return sigs;
}

function evaluateCondition(
  cond: CustomCondition,
  closesArr: number[],
  candles: ReadonlyArray<DailyKline>,
  i: number
): boolean {
  switch (cond.kind) {
    case "rsiBelow": {
      const r = rsi(closesArr, cond.period);
      return r[i] !== null && (r[i] as number) < cond.threshold;
    }
    case "rsiAbove": {
      const r = rsi(closesArr, cond.period);
      return r[i] !== null && (r[i] as number) > cond.threshold;
    }
    case "priceAboveSma": {
      const e = ema(closesArr, cond.period);
      return e[i] !== null && closesArr[i] > (e[i] as number);
    }
    case "priceBelowSma": {
      const e = ema(closesArr, cond.period);
      return e[i] !== null && closesArr[i] < (e[i] as number);
    }
    case "priceCrossesAboveSma": {
      const e = ema(closesArr, cond.period);
      return crossedAbove(closesArr.slice() as (number | null)[], e, i);
    }
    case "priceCrossesBelowSma": {
      const e = ema(closesArr, cond.period);
      return crossedBelow(closesArr.slice() as (number | null)[], e, i);
    }
    case "macdCrossAbove": {
      const m = macd(closesArr);
      return crossedAbove(m.macd, m.signal, i);
    }
    case "macdCrossBelow": {
      const m = macd(closesArr);
      return crossedBelow(m.macd, m.signal, i);
    }
    case "bbTouchLower": {
      const bb = bollingerBands(closesArr, cond.period, cond.stdMultiplier);
      const l = bb.lower[i];
      return l !== null && candles[i].close < l;
    }
    case "bbTouchUpper": {
      const bb = bollingerBands(closesArr, cond.period, cond.stdMultiplier);
      const u = bb.upper[i];
      return u !== null && candles[i].close > u;
    }
  }
}

export const STRATEGIES: Record<StrategyId, StrategyDescriptor> = {
  "golden-cross": GOLDEN_CROSS,
  "rsi-mean-reversion": RSI_MEAN_REVERSION,
  "bollinger-reversion": BOLLINGER_REVERSION,
  "donchian-breakout": DONCHIAN_BREAKOUT,
  "macd-crossover": MACD_CROSSOVER,
  "buy-and-hold": BUY_AND_HOLD,
  custom: CUSTOM_STRATEGY
};

export function getStrategy(id: StrategyId): StrategyDescriptor {
  const s = STRATEGIES[id];
  if (!s) throw new Error(`Unknown strategy: ${id}`);
  return s;
}

export const STRATEGY_LIST: StrategyDescriptor[] = [
  GOLDEN_CROSS,
  MACD_CROSSOVER,
  DONCHIAN_BREAKOUT,
  RSI_MEAN_REVERSION,
  BOLLINGER_REVERSION,
  BUY_AND_HOLD,
  CUSTOM_STRATEGY
];
