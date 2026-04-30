import { describe, expect, it } from "vitest";
import type { CompletedTrade } from "../../lib/backtest";
import { computeMetrics } from "../../lib/metrics";

function trade(pnl: number, idx: number = 0): CompletedTrade {
  return {
    side: "long",
    entryIndex: idx,
    exitIndex: idx + 1,
    entryTime: idx,
    exitTime: idx + 1,
    entryPrice: 100,
    exitPrice: 100 + pnl / 100,
    pnl,
    pnlPct: pnl / 100,
    exitReason: "take-profit",
    barsHeld: 1
  };
}

describe("computeMetrics — empty input", () => {
  it("returns zero everything", () => {
    const m = computeMetrics([], [10000], 10000);
    expect(m.numTrades).toBe(0);
    expect(m.winRatePct).toBe(0);
    expect(m.profitFactor).toBe(0);
  });

  it("flags too-few-trades verdict", () => {
    const m = computeMetrics([trade(50), trade(-30)], [10000, 10020], 10000);
    expect(m.verdictSeverity).toBe("neutral");
    expect(m.verdict).toMatch(/Too few trades/);
  });
});

describe("computeMetrics — losing strategy", () => {
  it("verdicts as bad with negative expectancy", () => {
    const trades: CompletedTrade[] = [];
    for (let i = 0; i < 20; i++) trades.push(trade(i % 3 === 0 ? 50 : -30, i));
    const equity: number[] = [10000];
    let eq = 10000;
    for (const t of trades) {
      eq += t.pnl;
      equity.push(eq);
    }
    const m = computeMetrics(trades, equity, 10000);
    expect(m.numTrades).toBe(20);
    expect(m.profitFactor).toBeLessThan(1);
    expect(m.verdictSeverity).toBe("bad");
    expect(m.verdict).toMatch(/lost money/i);
  });
});

describe("computeMetrics — winning strategy", () => {
  it("verdicts as good with profit factor >= 1.2", () => {
    const trades: CompletedTrade[] = [];
    for (let i = 0; i < 30; i++) trades.push(trade(i % 2 === 0 ? 200 : -50, i));
    const equity: number[] = [10000];
    let eq = 10000;
    for (let day = 0; day < 800; day++) {
      eq *= 1 + (Math.sin(day / 30) * 0.005 + 0.0005); // mild upward drift with noise
      equity.push(eq);
    }
    const m = computeMetrics(trades, equity, 10000);
    expect(m.numTrades).toBe(30);
    expect(m.profitFactor).toBeGreaterThan(1.2);
    expect(m.verdictSeverity).toBe("good");
  });
});

describe("computeMetrics — drawdown", () => {
  it("computes max drawdown as peak-to-trough %", () => {
    const equity = [10000, 12000, 11000, 9000, 13000];
    const m = computeMetrics([], equity, 10000);
    // Peak at 12000, trough at 9000 → DD = 25%
    expect(m.maxDrawdownPct).toBeCloseTo(25);
  });
});

describe("computeMetrics — profit factor", () => {
  it("sums winners over absolute losers", () => {
    const trades = [trade(100), trade(-25), trade(-25), trade(50)];
    const equity = [10000, 10100, 10075, 10050, 10100];
    const m = computeMetrics(trades, equity, 10000);
    // Wins: 100+50 = 150. Losses: 25+25 = 50. PF = 3.
    expect(m.profitFactor).toBeCloseTo(3);
  });

  it("returns Infinity when there are wins and zero losses", () => {
    const trades = [trade(50), trade(50)];
    const equity = [10000, 10050, 10100];
    const m = computeMetrics(trades, equity, 10000);
    expect(m.profitFactor).toBe(Infinity);
  });
});

describe("computeMetrics — win rate and expectancy", () => {
  it("computes correctly", () => {
    const trades = [trade(100), trade(-50), trade(100), trade(-50)];
    const equity = [10000, 10100, 10050, 10150, 10100];
    const m = computeMetrics(trades, equity, 10000);
    expect(m.winRatePct).toBe(50);
    expect(m.expectancyUsd).toBe(25); // (100-50+100-50)/4
  });
});
