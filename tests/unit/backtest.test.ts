import { describe, expect, it } from "vitest";
import { runBacktest, type BacktestSignal, type StrategyFn } from "../../lib/backtest";
import type { DailyKline } from "../../lib/types";

function k(o: number, h: number, l: number, c: number, t: number = 0): DailyKline {
  return { openTime: t, open: o, high: h, low: l, close: c, volume: 100 };
}

describe("runBacktest — long happy path", () => {
  it("buys at signal close, sells at TP hit, computes pnl after fees", () => {
    const candles: DailyKline[] = [
      k(100, 100, 100, 100, 1), // signal here
      k(100, 110, 99, 105, 2), // TP at 110 hits via high
      k(105, 106, 100, 102, 3)
    ];
    const strategy: StrategyFn = () => [
      { index: 0, side: "long", takeProfitPrice: 110 }
    ];
    const result = runBacktest(candles, strategy, {
      costPerSide: 0,
      slippagePerSide: 0,
      startingEquity: 10000,
      positionFraction: 1
    });
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].side).toBe("long");
    expect(result.trades[0].exitReason).toBe("take-profit");
    expect(result.trades[0].entryPrice).toBe(100);
    expect(result.trades[0].exitPrice).toBe(110);
    expect(result.trades[0].pnl).toBeCloseTo(10000 * 0.1);
    expect(result.finalEquity).toBeCloseTo(11000);
  });

  it("hits stop before TP within the same candle", () => {
    const candles: DailyKline[] = [
      k(100, 100, 100, 100), // entry
      k(100, 120, 90, 95) // both stop (95) and TP (110) could hit; stop wins
    ];
    const strategy: StrategyFn = () => [
      { index: 0, side: "long", stopPrice: 95, takeProfitPrice: 110 }
    ];
    const result = runBacktest(candles, strategy, {
      costPerSide: 0,
      slippagePerSide: 0
    });
    expect(result.trades[0].exitReason).toBe("stop");
    expect(result.trades[0].exitPrice).toBe(95);
  });

  it("applies fees + slippage against the trader", () => {
    const candles: DailyKline[] = [
      k(100, 100, 100, 100),
      k(100, 110, 99, 110)
    ];
    const strategy: StrategyFn = () => [
      { index: 0, side: "long", takeProfitPrice: 110 }
    ];
    const result = runBacktest(candles, strategy, {
      costPerSide: 0.001, // 0.1% per side
      slippagePerSide: 0.001 // 0.1% per side
    });
    // Entry fills at 100 * 1.001 = 100.1. Exit at 110 * 0.999 = 109.89.
    // Gross move = (109.89 - 100.1)/100.1 = 0.0978
    // Notional = 10000. Gross pnl = ~978. Fees = 10000 * 0.001 * 2 = 20.
    expect(result.trades[0].entryPrice).toBeCloseTo(100.1, 3);
    expect(result.trades[0].exitPrice).toBeCloseTo(109.89, 3);
    expect(result.trades[0].pnl).toBeLessThan(978);
    expect(result.trades[0].pnl).toBeGreaterThan(950);
  });
});

describe("runBacktest — short happy path", () => {
  it("shorts at signal, exits on stop above entry", () => {
    const candles: DailyKline[] = [
      k(100, 100, 100, 100), // short entry
      k(100, 110, 95, 105) // stop at 110 hit via high
    ];
    const strategy: StrategyFn = () => [
      { index: 0, side: "short", stopPrice: 110, takeProfitPrice: 90 }
    ];
    const result = runBacktest(candles, strategy, {
      costPerSide: 0,
      slippagePerSide: 0
    });
    expect(result.trades[0].side).toBe("short");
    expect(result.trades[0].exitReason).toBe("stop");
    expect(result.trades[0].exitPrice).toBe(110);
    // Loss: 10000 * 10/100 = 1000
    expect(result.trades[0].pnl).toBeCloseTo(-1000);
  });
});

describe("runBacktest — signal reversal", () => {
  it("closes long on opposite-side signal", () => {
    const candles: DailyKline[] = [
      k(100, 100, 100, 100), // long entry at 100
      k(100, 105, 99, 105),  // open continues
      k(105, 106, 102, 103) // short signal here, long closes at 103
    ];
    const strategy: StrategyFn = () => [
      { index: 0, side: "long" },
      { index: 2, side: "short" }
    ];
    const result = runBacktest(candles, strategy, {
      costPerSide: 0,
      slippagePerSide: 0
    });
    // Two trades: long closed by signal-reverse, then a new short opened
    expect(result.trades.length).toBeGreaterThanOrEqual(1);
    const longTrade = result.trades[0];
    expect(longTrade.side).toBe("long");
    expect(longTrade.exitReason).toBe("signal-reverse");
    expect(longTrade.exitPrice).toBe(103);
  });
});

describe("runBacktest — open position closed at end of data", () => {
  it("force-closes any remaining open trade", () => {
    const candles: DailyKline[] = [
      k(100, 100, 100, 100),
      k(100, 105, 99, 102)
    ];
    const strategy: StrategyFn = () => [{ index: 0, side: "long" }];
    const result = runBacktest(candles, strategy, {
      costPerSide: 0,
      slippagePerSide: 0
    });
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].exitReason).toBe("end-of-data");
    expect(result.trades[0].exitPrice).toBe(102);
  });
});

describe("runBacktest — equity curve is monotonic with mark-to-market", () => {
  it("equity curve length equals candle count and starts at startingEquity", () => {
    const candles: DailyKline[] = [];
    for (let i = 0; i < 5; i++) candles.push(k(100, 100, 100, 100, i));
    const strategy: StrategyFn = () => [];
    const result = runBacktest(candles, strategy, { startingEquity: 5000 });
    expect(result.equityCurve).toHaveLength(5);
    expect(result.equityCurve[0]).toBe(5000);
    expect(result.equityCurve[4]).toBe(5000);
    expect(result.finalEquity).toBe(5000);
  });
});

describe("runBacktest — funding cost drag on long-held positions", () => {
  it("subtracts funding from PnL proportional to bars held", () => {
    const candles: DailyKline[] = [];
    for (let i = 0; i < 11; i++) candles.push(k(100, 100, 100, 100, i)); // flat
    const strategy: StrategyFn = () => [{ index: 0, side: "long" }];
    const result = runBacktest(candles, strategy, {
      costPerSide: 0,
      slippagePerSide: 0,
      fundingCostPerBar: 0.001 // 0.1% per bar
    });
    // 10 bars held, notional 10000, funding drag = 10000 * 0.001 * 10 = 100
    expect(result.trades[0].pnl).toBeCloseTo(-100, 1);
  });
});

describe("runBacktest — ignores re-entry signals while open", () => {
  it("keeps original entry price when same-side signal repeats", () => {
    const candles: DailyKline[] = [
      k(100, 100, 100, 100), // long entry
      k(100, 100, 100, 105), // same-side signal — should be ignored
      k(105, 110, 102, 110)
    ];
    const sigs: BacktestSignal[] = [
      { index: 0, side: "long" },
      { index: 1, side: "long" }
    ];
    const result = runBacktest(candles, () => sigs, {
      costPerSide: 0,
      slippagePerSide: 0
    });
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].entryIndex).toBe(0);
    expect(result.trades[0].entryPrice).toBe(100);
  });
});
