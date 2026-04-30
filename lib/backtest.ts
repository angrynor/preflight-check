import type { DailyKline } from "./types";

export type BacktestSide = "long" | "short";

export interface BacktestSignal {
  /** Index in the candle array where the signal was generated. Entry happens at this candle's close. */
  index: number;
  side: BacktestSide;
  /** Optional override for entry/exit logic; if absent, exits happen on reverse signals only. */
  stopPrice?: number;
  takeProfitPrice?: number;
  /** Optional human-readable label that ends up in the trade row. */
  label?: string;
}

export interface BacktestParams {
  /** Cost per side as a fraction (e.g. 0.0005 = 0.05% per side, so 0.10% round trip). Default 0.0005. */
  costPerSide?: number;
  /** Slippage per side as a fraction. Default 0.0005. */
  slippagePerSide?: number;
  /** Starting equity. Default 10000. */
  startingEquity?: number;
  /** Position size as a fraction of equity per trade. Default 1 (full equity). */
  positionFraction?: number;
  /** If a strategy emits the same side signal back-to-back, ignore re-entries. Default true. */
  ignoreReentryWhileOpen?: boolean;
  /** Per-bar funding cost as a fraction (e.g. 0.0001 = 0.01% per candle). Default 0. */
  fundingCostPerBar?: number;
}

export interface CompletedTrade {
  side: BacktestSide;
  entryIndex: number;
  exitIndex: number;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  /** Net P&L on the position in account currency (after fees + slippage + funding). */
  pnl: number;
  /** P&L as a percent of equity at entry. */
  pnlPct: number;
  exitReason: "stop" | "take-profit" | "signal-reverse" | "end-of-data";
  label?: string;
  barsHeld: number;
}

export interface BacktestResult {
  trades: CompletedTrade[];
  /** Equity at end of each candle (length matches candles). */
  equityCurve: number[];
  finalEquity: number;
  totalReturnPct: number;
  costPerSide: number;
  slippagePerSide: number;
  fundingCostPerBar: number;
  candleCount: number;
}

export type StrategyFn = (candles: ReadonlyArray<DailyKline>) => BacktestSignal[];

interface OpenPos {
  side: BacktestSide;
  entryIndex: number;
  entryPrice: number;
  notional: number;
  stopPrice?: number;
  takeProfitPrice?: number;
  label?: string;
}

/**
 * Run a strategy over a candle series and return executed trades + equity curve.
 *
 * Execution rules:
 * - Signals at index `i` enter at candles[i].close (with slippage applied against the trader).
 * - Stops/TPs are checked using high/low of subsequent candles.
 * - If both stop and TP would fire in the same candle, the stop wins (conservative).
 * - On a reverse-side signal, the open trade exits at that candle's close before the new entry opens.
 */
export function runBacktest(
  candles: ReadonlyArray<DailyKline>,
  strategy: StrategyFn,
  params: BacktestParams = {}
): BacktestResult {
  const cost = params.costPerSide ?? 0.0005;
  const slip = params.slippagePerSide ?? 0.0005;
  const startEquity = params.startingEquity ?? 10_000;
  const posFrac = params.positionFraction ?? 1;
  const ignoreReentry = params.ignoreReentryWhileOpen ?? true;
  const fundingCost = params.fundingCostPerBar ?? 0;

  const signals = strategy(candles);
  const signalAt = new Map<number, BacktestSignal>();
  for (const sig of signals) {
    if (!signalAt.has(sig.index)) signalAt.set(sig.index, sig);
  }

  const trades: CompletedTrade[] = [];
  const equityCurve: number[] = new Array(candles.length).fill(startEquity);
  let equity = startEquity;
  let open: OpenPos | null = null;

  const closeOpen = (
    exitFill: number,
    exitIndex: number,
    reason: CompletedTrade["exitReason"]
  ): void => {
    if (!open) return;
    const bars = Math.max(0, exitIndex - open.entryIndex);
    const pnl = computePnl(open, exitFill, cost, fundingCost, bars);
    equity += pnl;
    trades.push({
      side: open.side,
      entryIndex: open.entryIndex,
      exitIndex,
      entryTime: candles[open.entryIndex].openTime,
      exitTime: candles[exitIndex].openTime,
      entryPrice: open.entryPrice,
      exitPrice: exitFill,
      pnl,
      pnlPct: (pnl / open.notional) * 100,
      exitReason: reason,
      label: open.label,
      barsHeld: bars
    });
    open = null;
  };

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];

    // 1) Stop/TP check on open position
    if (open) {
      const exit = checkStopOrTp(candle, open);
      if (exit) {
        const exitFill = applySlippage(exit.price, open.side, "exit", slip);
        closeOpen(exitFill, i, exit.reason);
      }
    }

    // 2) Process new signal
    const sig = signalAt.get(i);
    if (sig) {
      // Reverse-side signal closes the open trade first
      if (open && open.side !== sig.side) {
        const exitFill = applySlippage(candle.close, open.side, "exit", slip);
        closeOpen(exitFill, i, "signal-reverse");
      }
      // Open new position if not already in one (or if reentry allowed)
      if (!open || (open.side === sig.side && !ignoreReentry)) {
        const entryFill = applySlippage(candle.close, sig.side, "entry", slip);
        const notional = equity * posFrac;
        open = {
          side: sig.side,
          entryIndex: i,
          entryPrice: entryFill,
          notional,
          stopPrice: sig.stopPrice,
          takeProfitPrice: sig.takeProfitPrice,
          label: sig.label
        };
      }
    }

    // Mark-to-market for the equity curve
    if (open) {
      const bars = Math.max(0, i - open.entryIndex);
      equityCurve[i] = equity + unrealizedPnl(open, candle.close, fundingCost, bars);
    } else {
      equityCurve[i] = equity;
    }
  }

  // Force-close any open position at end of series
  if (open) {
    const lastIdx = candles.length - 1;
    const exitFill = applySlippage(candles[lastIdx].close, open.side, "exit", slip);
    closeOpen(exitFill, lastIdx, "end-of-data");
    equityCurve[lastIdx] = equity;
  }

  return {
    trades,
    equityCurve,
    finalEquity: equity,
    totalReturnPct: ((equity - startEquity) / startEquity) * 100,
    costPerSide: cost,
    slippagePerSide: slip,
    fundingCostPerBar: fundingCost,
    candleCount: candles.length
  };
}

function checkStopOrTp(
  candle: DailyKline,
  open: OpenPos
): { price: number; reason: "stop" | "take-profit" } | null {
  if (open.side === "long") {
    if (open.stopPrice !== undefined && candle.low <= open.stopPrice) {
      return { price: open.stopPrice, reason: "stop" };
    }
    if (open.takeProfitPrice !== undefined && candle.high >= open.takeProfitPrice) {
      return { price: open.takeProfitPrice, reason: "take-profit" };
    }
  } else {
    if (open.stopPrice !== undefined && candle.high >= open.stopPrice) {
      return { price: open.stopPrice, reason: "stop" };
    }
    if (open.takeProfitPrice !== undefined && candle.low <= open.takeProfitPrice) {
      return { price: open.takeProfitPrice, reason: "take-profit" };
    }
  }
  return null;
}

function applySlippage(
  price: number,
  side: BacktestSide,
  action: "entry" | "exit",
  slip: number
): number {
  if (side === "long") {
    return action === "entry" ? price * (1 + slip) : price * (1 - slip);
  }
  return action === "entry" ? price * (1 - slip) : price * (1 + slip);
}

function computePnl(
  open: OpenPos,
  exitPrice: number,
  cost: number,
  fundingPerBar: number,
  bars: number
): number {
  const grossMove =
    open.side === "long"
      ? (exitPrice - open.entryPrice) / open.entryPrice
      : (open.entryPrice - exitPrice) / open.entryPrice;
  const grossPnl = open.notional * grossMove;
  const feesUsd = open.notional * cost * 2;
  const fundingDrag = open.notional * fundingPerBar * bars;
  return grossPnl - feesUsd - fundingDrag;
}

function unrealizedPnl(
  open: OpenPos,
  markPrice: number,
  fundingPerBar: number,
  bars: number
): number {
  const move =
    open.side === "long"
      ? (markPrice - open.entryPrice) / open.entryPrice
      : (open.entryPrice - markPrice) / open.entryPrice;
  return open.notional * move - open.notional * fundingPerBar * bars;
}
