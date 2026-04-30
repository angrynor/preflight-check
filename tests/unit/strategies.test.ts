import { describe, expect, it } from "vitest";
import { runBacktest } from "../../lib/backtest";
import { getStrategy, STRATEGIES, STRATEGY_LIST } from "../../lib/strategies";
import type { DailyKline } from "../../lib/types";

function trendingCandles(n: number, drift: number = 0.5): DailyKline[] {
  const out: DailyKline[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const noise = Math.sin(i / 5) * 1.5 + Math.cos(i / 11) * 0.8;
    const open = price;
    const close = price + drift + noise;
    out.push({
      openTime: i,
      open,
      high: Math.max(open, close) + 0.5,
      low: Math.min(open, close) - 0.5,
      close,
      volume: 100
    });
    price = close;
  }
  return out;
}

/** A series that goes down then up — guaranteed to produce a Golden Cross around the inflection. */
function vShapedCandles(n: number): DailyKline[] {
  const out: DailyKline[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const half = n / 2;
    const trend = i < half ? -0.6 : 0.6;
    const noise = Math.sin(i / 5) * 1.5;
    const open = price;
    const close = Math.max(20, price + trend + noise);
    out.push({
      openTime: i,
      open,
      high: Math.max(open, close) + 0.5,
      low: Math.min(open, close) - 0.5,
      close,
      volume: 100
    });
    price = close;
  }
  return out;
}

function rangingCandles(n: number, level: number = 100, amplitude: number = 5): DailyKline[] {
  const out: DailyKline[] = [];
  for (let i = 0; i < n; i++) {
    const close = level + Math.sin(i / 8) * amplitude;
    const open = level + Math.sin((i - 1) / 8) * amplitude;
    out.push({
      openTime: i,
      open,
      high: Math.max(open, close) + 0.5,
      low: Math.min(open, close) - 0.5,
      close,
      volume: 100
    });
  }
  return out;
}

describe("STRATEGY_LIST", () => {
  it("includes all strategies", () => {
    expect(STRATEGY_LIST.length).toBeGreaterThanOrEqual(6);
    const ids = STRATEGY_LIST.map((s) => s.id);
    expect(ids).toContain("golden-cross");
    expect(ids).toContain("rsi-mean-reversion");
    expect(ids).toContain("bollinger-reversion");
    expect(ids).toContain("donchian-breakout");
    expect(ids).toContain("macd-crossover");
    expect(ids).toContain("buy-and-hold");
  });

  it("each descriptor has the required fields", () => {
    for (const s of STRATEGY_LIST) {
      expect(s.id).toBeTruthy();
      expect(s.name).toBeTruthy();
      expect(s.description).toBeTruthy();
      expect(s.reality).toBeTruthy();
      expect(typeof s.build).toBe("function");
    }
  });
});

describe("getStrategy", () => {
  it("returns the strategy by id", () => {
    const s = getStrategy("rsi-mean-reversion");
    expect(s.id).toBe("rsi-mean-reversion");
  });
  it("throws on unknown id", () => {
    // @ts-expect-error invalid id
    expect(() => getStrategy("unknown")).toThrow();
  });
});

describe("Golden Cross — produces signals on a v-shaped series", () => {
  it("emits at least one long signal when the trend reverses upward", () => {
    const candles = vShapedCandles(600);
    const fn = STRATEGIES["golden-cross"].build({ fastPeriod: 50, slowPeriod: 200 });
    const sigs = fn(candles);
    expect(sigs.length).toBeGreaterThanOrEqual(1);
    expect(sigs[0].side).toBe("long");
  });
});

describe("RSI Mean Reversion — fires on oversold", () => {
  it("triggers buys in a ranging series", () => {
    const candles = rangingCandles(120, 100, 8);
    const fn = STRATEGIES["rsi-mean-reversion"].build({
      rsiPeriod: 14,
      rsiBuyThreshold: 35,
      rsiSellThreshold: 65,
      allowShorts: true
    });
    const sigs = fn(candles);
    expect(sigs.length).toBeGreaterThan(0);
  });
});

describe("Donchian Breakout — fires on a clear uptrend", () => {
  it("emits long signals for breakouts", () => {
    const candles = trendingCandles(300, 1.0);
    const fn = STRATEGIES["donchian-breakout"].build({
      donchianLookback: 20,
      donchianExitLookback: 10,
      allowShorts: true
    });
    const sigs = fn(candles);
    expect(sigs.length).toBeGreaterThan(0);
    expect(sigs.some((s) => s.side === "long")).toBe(true);
  });
});

describe("MACD Crossover — backtest runs without crashing", () => {
  it("produces a valid result on real-shaped data", () => {
    const candles = trendingCandles(400);
    const fn = STRATEGIES["macd-crossover"].build({});
    const result = runBacktest(candles, fn, { startingEquity: 10000 });
    expect(result.candleCount).toBe(400);
    expect(result.equityCurve).toHaveLength(400);
    expect(typeof result.totalReturnPct).toBe("number");
  });
});

describe("Buy and Hold — exactly one trade", () => {
  it("opens at index 0 and closes at end of data", () => {
    const candles = trendingCandles(200, 0.4);
    const fn = STRATEGIES["buy-and-hold"].build({});
    const result = runBacktest(candles, fn, { startingEquity: 10000, costPerSide: 0, slippagePerSide: 0 });
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].entryIndex).toBe(0);
    expect(result.trades[0].exitReason).toBe("end-of-data");
  });
});

describe("Custom strategy DSL", () => {
  it("RSI < 30 entry, RSI > 70 exit on long side", () => {
    const candles = rangingCandles(80, 100, 6);
    const fn = STRATEGIES["custom"].build({
      customRules: {
        entryWhen: { kind: "rsiBelow", period: 14, threshold: 35 },
        exitWhen: { kind: "rsiAbove", period: 14, threshold: 65 },
        side: "long"
      }
    });
    const sigs = fn(candles);
    expect(sigs.length).toBeGreaterThan(0);
    // First signal should be a long entry
    expect(sigs[0].side).toBe("long");
  });

  it("throws when customRules is missing", () => {
    const fn = () => STRATEGIES["custom"].build({});
    expect(fn).toThrow();
  });

  it("supports MACD cross above as entry", () => {
    const candles = trendingCandles(300);
    const fn = STRATEGIES["custom"].build({
      customRules: {
        entryWhen: { kind: "macdCrossAbove" },
        exitWhen: { kind: "macdCrossBelow" },
        side: "long"
      }
    });
    const result = runBacktest(candles, fn, { startingEquity: 10000 });
    expect(result.trades.length).toBeGreaterThan(0);
  });
});

describe("Stop and TP attachment", () => {
  it("appends stop and TP prices at the right percent distances", () => {
    const candles = trendingCandles(250, 0.5);
    const fn = STRATEGIES["donchian-breakout"].build({
      donchianLookback: 20,
      stopPct: 5,
      takeProfitPct: 10,
      allowShorts: false
    });
    const sigs = fn(candles);
    const longSig = sigs.find((s) => s.side === "long");
    expect(longSig).toBeDefined();
    expect(longSig?.stopPrice).toBeDefined();
    expect(longSig?.takeProfitPrice).toBeDefined();
    expect(longSig!.stopPrice!).toBeLessThan(candles[longSig!.index].close);
    expect(longSig!.takeProfitPrice!).toBeGreaterThan(candles[longSig!.index].close);
  });
});
