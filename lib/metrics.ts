import type { CompletedTrade } from "./backtest";

export interface BacktestMetrics {
  numTrades: number;
  numWins: number;
  numLosses: number;
  winRatePct: number;
  avgWinUsd: number;
  avgLossUsd: number;
  largestWinUsd: number;
  largestLossUsd: number;
  /** Sum of winners / sum of |losers|. >1 means net profitable. */
  profitFactor: number;
  /** Average P&L per trade in account currency. */
  expectancyUsd: number;
  /** Per-trade Sharpe ratio (mean / stddev). */
  perTradeSharpe: number;
  /** Annualized Sharpe assuming candles are 1-day. */
  annualizedSharpe: number;
  /** Worst peak-to-trough drawdown as a percent of peak. */
  maxDrawdownPct: number;
  /** Final equity / starting equity (e.g. 1.25 = +25%). */
  growthFactor: number;
  /** Compound annual growth rate as a fraction. Assumes daily candles. */
  cagr: number;
  /** Bars-held per trade, average. */
  avgBarsHeld: number;
  /** Honest 1-line verdict for retail consumption. */
  verdict: string;
  /** Verdict severity for UI styling. */
  verdictSeverity: "good" | "neutral" | "bad";
}

export function computeMetrics(
  trades: CompletedTrade[],
  equityCurve: number[],
  startingEquity: number = 10_000
): BacktestMetrics {
  const numTrades = trades.length;
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const numWins = wins.length;
  const numLosses = losses.length;
  const winRatePct = numTrades > 0 ? (numWins / numTrades) * 100 : 0;

  const avgWinUsd = numWins > 0 ? sum(wins.map((t) => t.pnl)) / numWins : 0;
  const avgLossUsd = numLosses > 0 ? sum(losses.map((t) => t.pnl)) / numLosses : 0;
  const largestWinUsd = wins.length > 0 ? Math.max(...wins.map((t) => t.pnl)) : 0;
  const largestLossUsd = losses.length > 0 ? Math.min(...losses.map((t) => t.pnl)) : 0;

  const grossWin = sum(wins.map((t) => t.pnl));
  const grossLoss = Math.abs(sum(losses.map((t) => t.pnl)));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
  const expectancyUsd = numTrades > 0 ? sum(trades.map((t) => t.pnl)) / numTrades : 0;

  // Per-trade Sharpe (mean P&L / stddev P&L)
  const pnls = trades.map((t) => t.pnl);
  const meanPnl = pnls.length > 0 ? sum(pnls) / pnls.length : 0;
  const variance =
    pnls.length > 1
      ? sum(pnls.map((p) => (p - meanPnl) ** 2)) / (pnls.length - 1)
      : 0;
  const stddev = Math.sqrt(variance);
  const perTradeSharpe = stddev > 0 ? meanPnl / stddev : 0;

  // Annualized Sharpe from daily-candle equity curve
  const dailyReturns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1];
    if (prev > 0) dailyReturns.push((equityCurve[i] - prev) / prev);
  }
  const meanRet = dailyReturns.length > 0 ? sum(dailyReturns) / dailyReturns.length : 0;
  const retVar =
    dailyReturns.length > 1
      ? sum(dailyReturns.map((r) => (r - meanRet) ** 2)) / (dailyReturns.length - 1)
      : 0;
  const retStd = Math.sqrt(retVar);
  const annualizedSharpe = retStd > 0 ? (meanRet / retStd) * Math.sqrt(365) : 0;

  // Max drawdown
  let peak = equityCurve[0] ?? startingEquity;
  let maxDrawdownPct = 0;
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq;
    const dd = peak > 0 ? ((peak - eq) / peak) * 100 : 0;
    if (dd > maxDrawdownPct) maxDrawdownPct = dd;
  }

  const finalEquity = equityCurve[equityCurve.length - 1] ?? startingEquity;
  const growthFactor = startingEquity > 0 ? Math.max(0, finalEquity / startingEquity) : 0;
  const years = equityCurve.length > 0 ? equityCurve.length / 365 : 0;
  const cagr =
    years > 0 && growthFactor > 0 && Number.isFinite(growthFactor)
      ? Math.pow(growthFactor, 1 / years) - 1
      : growthFactor === 0
      ? -1
      : 0;
  const avgBarsHeld =
    numTrades > 0 ? sum(trades.map((t) => t.barsHeld)) / numTrades : 0;

  const { verdict, verdictSeverity } = renderVerdict({
    totalReturnPct: (growthFactor - 1) * 100,
    profitFactor,
    expectancyUsd,
    maxDrawdownPct,
    numTrades,
    cagr,
    avgWinUsd,
    avgLossUsd,
    winRatePct
  });

  // Sanitize: any NaN/Infinity gets coerced to a JSON-safe number so the UI doesn't crash on .toFixed().
  // (JSON.stringify turns NaN into null; Infinity into null too.)
  const safe = (n: number): number => (Number.isFinite(n) ? n : 0);

  return {
    numTrades,
    numWins,
    numLosses,
    winRatePct: safe(winRatePct),
    avgWinUsd: safe(avgWinUsd),
    avgLossUsd: safe(avgLossUsd),
    largestWinUsd: safe(largestWinUsd),
    largestLossUsd: safe(largestLossUsd),
    profitFactor: profitFactor === Infinity ? Infinity : safe(profitFactor),
    expectancyUsd: safe(expectancyUsd),
    perTradeSharpe: safe(perTradeSharpe),
    annualizedSharpe: safe(annualizedSharpe),
    maxDrawdownPct: safe(maxDrawdownPct),
    growthFactor: safe(growthFactor),
    cagr: safe(cagr),
    avgBarsHeld: safe(avgBarsHeld),
    verdict,
    verdictSeverity
  };
}

function sum(arr: number[]): number {
  let s = 0;
  for (const x of arr) s += x;
  return s;
}

interface VerdictInput {
  totalReturnPct: number;
  profitFactor: number;
  expectancyUsd: number;
  maxDrawdownPct: number;
  numTrades: number;
  cagr: number;
  avgWinUsd: number;
  avgLossUsd: number;
  winRatePct: number;
}

function renderVerdict(m: VerdictInput): {
  verdict: string;
  verdictSeverity: "good" | "neutral" | "bad";
} {
  if (m.numTrades < 10) {
    return {
      verdict: `Too few trades (${m.numTrades}) to draw a conclusion. Run on a longer window or a more active strategy.`,
      verdictSeverity: "neutral"
    };
  }

  if (m.expectancyUsd <= 0 || m.profitFactor < 1) {
    return {
      verdict: `This strategy lost money (${m.totalReturnPct.toFixed(1)}% over ${m.numTrades} trades). Profit factor ${m.profitFactor.toFixed(2)} — losers eat the winners. This is not an edge.`,
      verdictSeverity: "bad"
    };
  }

  if (m.profitFactor < 1.2 || m.maxDrawdownPct > 40) {
    return {
      verdict: `Marginal: ${m.totalReturnPct.toFixed(1)}% over ${m.numTrades} trades, but profit factor ${m.profitFactor.toFixed(2)} and ${m.maxDrawdownPct.toFixed(1)}% max drawdown. The math barely beats break-even after costs and would not survive parameter drift.`,
      verdictSeverity: "neutral"
    };
  }

  if (m.winRatePct < 35 && Math.abs(m.avgLossUsd) > Math.abs(m.avgWinUsd) * 0.6) {
    return {
      verdict: `Positive expectancy (${m.totalReturnPct.toFixed(1)}% / PF ${m.profitFactor.toFixed(2)}) but win rate is only ${m.winRatePct.toFixed(0)}% — psychologically brutal. Most retail traders abandon strategies like this after a 5-loss streak even when the math is right.`,
      verdictSeverity: "neutral"
    };
  }

  return {
    verdict: `Edge present: ${m.totalReturnPct.toFixed(1)}% over ${m.numTrades} trades, profit factor ${m.profitFactor.toFixed(2)}, ${m.maxDrawdownPct.toFixed(1)}% max drawdown. CAGR ~${(m.cagr * 100).toFixed(1)}%. This survives realistic costs — but past performance is not destiny.`,
    verdictSeverity: "good"
  };
}
