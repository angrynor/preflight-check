import { describe, expect, it } from "vitest";
import {
  atr,
  bollingerBands,
  crossedAbove,
  crossedBelow,
  donchian,
  ema,
  macd,
  rsi,
  sma
} from "../../lib/indicators";

describe("sma", () => {
  it("returns null for warmup period", () => {
    const r = sma([1, 2, 3, 4, 5], 3);
    expect(r[0]).toBeNull();
    expect(r[1]).toBeNull();
    expect(r[2]).toBe(2);
    expect(r[3]).toBe(3);
    expect(r[4]).toBe(4);
  });
  it("rejects non-positive period", () => {
    expect(() => sma([1, 2, 3], 0)).toThrow();
  });
});

describe("ema", () => {
  it("seeds with SMA, then weights recent values higher", () => {
    const r = ema([1, 2, 3, 4, 5, 6, 7, 8], 3);
    // First 2 are null, third is SMA(1,2,3) = 2
    expect(r[0]).toBeNull();
    expect(r[1]).toBeNull();
    expect(r[2]).toBe(2);
    // k = 2/(3+1) = 0.5
    // EMA[3] = 4*0.5 + 2*0.5 = 3
    expect(r[3]).toBeCloseTo(3);
    // EMA[4] = 5*0.5 + 3*0.5 = 4
    expect(r[4]).toBeCloseTo(4);
  });
  it("returns all nulls if input shorter than period", () => {
    const r = ema([1, 2], 5);
    expect(r.every((v) => v === null)).toBe(true);
  });
});

describe("rsi", () => {
  it("returns 100 when there are no losses", () => {
    const r = rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 14);
    expect(r[14]).toBe(100);
  });
  it("returns ~50 for a flat-ish series", () => {
    const v: number[] = [];
    for (let i = 0; i < 30; i++) v.push(100 + (i % 2 === 0 ? 0.5 : -0.5));
    const r = rsi(v, 14);
    const last = r[r.length - 1] as number;
    expect(last).toBeGreaterThan(40);
    expect(last).toBeLessThan(60);
  });
  it("returns null in warmup", () => {
    const r = rsi([1, 2, 3], 14);
    expect(r.every((v) => v === null)).toBe(true);
  });
});

describe("bollingerBands", () => {
  it("middle equals SMA, upper > middle > lower", () => {
    const v = [10, 12, 14, 13, 15, 17, 16, 18, 20, 19, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30];
    const bb = bollingerBands(v, 20, 2);
    const last = v.length - 1;
    expect(bb.middle[last]).not.toBeNull();
    expect(bb.upper[last]).not.toBeNull();
    expect(bb.lower[last]).not.toBeNull();
    expect(bb.upper[last]!).toBeGreaterThan(bb.middle[last] as number);
    expect(bb.lower[last]!).toBeLessThan(bb.middle[last] as number);
  });
});

describe("macd", () => {
  it("produces non-null values once enough data is available", () => {
    const v: number[] = [];
    for (let i = 0; i < 60; i++) v.push(100 + i);
    const m = macd(v, 12, 26, 9);
    expect(m.macd[v.length - 1]).not.toBeNull();
    expect(m.signal[v.length - 1]).not.toBeNull();
    expect(m.histogram[v.length - 1]).not.toBeNull();
  });
  it("histogram is macd minus signal", () => {
    const v: number[] = [];
    for (let i = 0; i < 60; i++) v.push(100 + Math.sin(i / 5) * 10);
    const m = macd(v);
    const last = v.length - 1;
    const expected = (m.macd[last] as number) - (m.signal[last] as number);
    expect(m.histogram[last]).toBeCloseTo(expected, 6);
  });
});

describe("atr", () => {
  it("computes ATR from high/low/close", () => {
    const highs = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26];
    const lows = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];
    const closes = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25];
    const a = atr(highs, lows, closes, 14);
    expect(a[a.length - 1]).not.toBeNull();
    expect(a[a.length - 1]).toBeGreaterThan(0);
  });
  it("rejects mismatched lengths", () => {
    expect(() => atr([1], [1, 2], [1])).toThrow();
  });
});

describe("donchian", () => {
  it("upper = max(highs[lookback]), lower = min(lows[lookback])", () => {
    const highs = [10, 12, 11, 15, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23, 24];
    const lows = [8, 9, 10, 11, 12, 13, 11, 14, 15, 16, 17, 18, 19, 20, 21];
    const d = donchian(highs, lows, 5);
    // At i=4 (5th element), upper = max(10,12,11,15,13) = 15, lower = min(8,9,10,11,12) = 8
    expect(d.upper[4]).toBe(15);
    expect(d.lower[4]).toBe(8);
    expect(d.middle[4]).toBe((15 + 8) / 2);
  });
});

describe("crossedAbove / crossedBelow", () => {
  it("detects a transition", () => {
    const a = [1, 2, 3, 4];
    const b = [2, 2, 2, 2];
    // Indexes: 0 a<b, 1 a=b, 2 a>b (cross above happens at i=2), 3 a>b
    expect(crossedAbove(a, b, 2)).toBe(true);
    expect(crossedAbove(a, b, 3)).toBe(false);
  });
  it("returns false on null values", () => {
    expect(crossedAbove([null, 1], [null, 2], 1)).toBe(false);
  });
  it("crossedBelow inverse", () => {
    const a = [4, 3, 2, 1];
    const b = [2, 2, 2, 2];
    // a=2 at i=2 (a >= b), a=1 at i=3 (a < b) → cross happens at i=3
    expect(crossedBelow(a, b, 3)).toBe(true);
    expect(crossedBelow(a, b, 2)).toBe(false);
  });
});
