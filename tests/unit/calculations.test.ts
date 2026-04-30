import { describe, expect, it } from "vitest";
import {
  computeLiquidationPrice,
  deriveStopFromRiskBudget,
  deriveValues,
  formatPct,
  formatUsd,
  pctDistance,
  priceAtDistance
} from "../../lib/calculations";

describe("computeLiquidationPrice", () => {
  it("computes long liquidation as entry * (1 - 1/leverage)", () => {
    expect(computeLiquidationPrice(67000, 10, "long")).toBeCloseTo(67000 * 0.9, 6);
    expect(computeLiquidationPrice(100, 5, "long")).toBeCloseTo(80, 6);
    expect(computeLiquidationPrice(100, 100, "long")).toBeCloseTo(99, 6);
  });

  it("computes short liquidation as entry * (1 + 1/leverage)", () => {
    expect(computeLiquidationPrice(67000, 10, "short")).toBeCloseTo(67000 * 1.1, 6);
    expect(computeLiquidationPrice(100, 4, "short")).toBeCloseTo(125, 6);
  });

  it("returns entry when leverage is zero or negative", () => {
    expect(computeLiquidationPrice(100, 0, "long")).toBe(100);
    expect(computeLiquidationPrice(100, -5, "short")).toBe(100);
  });
});

describe("pctDistance", () => {
  it("returns absolute percent diff", () => {
    expect(pctDistance(100, 110)).toBeCloseTo(10);
    expect(pctDistance(100, 90)).toBeCloseTo(10);
    expect(pctDistance(67000, 65660)).toBeCloseTo(2);
  });

  it("returns 0 when from is 0", () => {
    expect(pctDistance(0, 100)).toBe(0);
  });
});

describe("deriveValues — Test 1 scenario (long with stop)", () => {
  it("computes the expected sizing for a 10x BTC long with 2% stop and $10k account", () => {
    const result = deriveValues({
      entry: 67000,
      leverage: 10,
      direction: "long",
      stop: 67000 * 0.98,
      accountSize: 10000
    });
    expect(result.liqDistancePct).toBeCloseTo(10);
    expect(result.stopDistancePct).toBeCloseTo(2);
    expect(result.notional).toBe(100_000);
    expect(result.margin).toBe(10_000);
    expect(result.riskBudgetPct).toBe(1);
    expect(result.riskBudgetUsd).toBe(100);
    expect(result.properNotional).toBeCloseTo(5_000);
    expect(result.properMargin).toBeCloseTo(500);
    expect(result.assumedStopUsed).toBe(false);
    expect(result.derivedStopPrice).toBeNull();
    expect(result.mode).toBe("stop-defined");
  });
});

describe("deriveValues — Test 2 scenario (no stop)", () => {
  it("uses a 2% assumed stop and flags it", () => {
    const result = deriveValues({
      entry: 3000,
      leverage: 25,
      direction: "long",
      stop: null,
      accountSize: 5000
    });
    expect(result.assumedStopUsed).toBe(true);
    expect(result.effectiveStopPct).toBe(2);
    expect(result.riskBudgetUsd).toBe(50);
    expect(result.properNotional).toBeCloseTo(2_500);
    expect(result.properMargin).toBeCloseTo(100);
    expect(result.stopDistancePct).toBeNull();
  });
});

describe("deriveValues — Test 3 scenario (short with 3% stop)", () => {
  it("computes correct short sizing", () => {
    const result = deriveValues({
      entry: 200,
      leverage: 5,
      direction: "short",
      stop: 206,
      accountSize: 20000
    });
    expect(result.liqDistancePct).toBeCloseTo(20);
    expect(result.stopDistancePct).toBeCloseTo(3);
    expect(result.notional).toBe(100_000);
    expect(result.riskBudgetUsd).toBe(200);
    expect(result.properNotional).toBeCloseTo(200 / 0.03, 1);
  });
});

describe("deriveValues — risk-budget mode", () => {
  it("derives stop from riskPct/leverage, long", () => {
    const result = deriveValues({
      entry: 100,
      leverage: 10,
      direction: "long",
      stop: null,
      accountSize: 10000,
      riskPct: 1,
      mode: "risk-budget"
    });
    // 1% risk / 10x leverage = 0.1% stop distance
    expect(result.derivedStopDistancePct).toBeCloseTo(0.1);
    expect(result.derivedStopPrice).toBeCloseTo(100 * (1 - 0.001), 6);
    expect(result.derivedStopTooTight).toBe(true);
    expect(result.mode).toBe("risk-budget");
  });

  it("derives stop from riskPct/leverage, short", () => {
    const result = deriveValues({
      entry: 100,
      leverage: 2,
      direction: "short",
      stop: null,
      accountSize: 10000,
      riskPct: 5,
      mode: "risk-budget"
    });
    // 5% risk / 2x leverage = 2.5% stop above entry for a short
    expect(result.derivedStopDistancePct).toBeCloseTo(2.5);
    expect(result.derivedStopPrice).toBeCloseTo(102.5, 6);
    expect(result.derivedStopTooTight).toBe(false);
    expect(result.riskBudgetUsd).toBe(500);
  });

  it("flags derived stop as too-tight when distance < 0.5%", () => {
    const result = deriveValues({
      entry: 100,
      leverage: 50,
      direction: "long",
      stop: null,
      accountSize: 10000,
      riskPct: 2,
      mode: "risk-budget"
    });
    // 2% / 50x = 0.04% — way too tight
    expect(result.derivedStopDistancePct).toBeCloseTo(0.04);
    expect(result.derivedStopTooTight).toBe(true);
  });

  it("uses derived stop for sizing when in risk-budget mode and no stop given", () => {
    const result = deriveValues({
      entry: 100,
      leverage: 4,
      direction: "long",
      stop: null,
      accountSize: 10000,
      riskPct: 2,
      mode: "risk-budget"
    });
    // 2% / 4x = 0.5% derived stop. Risk budget = $200. Proper notional = $200/0.005 = $40,000.
    expect(result.derivedStopDistancePct).toBeCloseTo(0.5);
    expect(result.effectiveStopPct).toBeCloseTo(0.5);
    expect(result.properNotional).toBeCloseTo(40_000);
    expect(result.properMargin).toBeCloseTo(10_000);
  });

  it("clamps risk budget within 0.1-5%", () => {
    const tooHigh = deriveValues({
      entry: 100, leverage: 10, direction: "long", stop: null,
      accountSize: 10000, riskPct: 50, mode: "risk-budget"
    });
    expect(tooHigh.riskBudgetPct).toBe(5);
    const tooLow = deriveValues({
      entry: 100, leverage: 10, direction: "long", stop: null,
      accountSize: 10000, riskPct: 0.001, mode: "risk-budget"
    });
    expect(tooLow.riskBudgetPct).toBe(0.1);
  });
});

describe("deriveStopFromRiskBudget", () => {
  it("computes long stop below entry", () => {
    const r = deriveStopFromRiskBudget(76000, 10, 1, "long");
    expect(r.stopDistancePct).toBeCloseTo(0.1);
    expect(r.stopPrice).toBeCloseTo(76000 * 0.999, 4);
  });
  it("computes short stop above entry", () => {
    const r = deriveStopFromRiskBudget(76000, 10, 1, "short");
    expect(r.stopDistancePct).toBeCloseTo(0.1);
    expect(r.stopPrice).toBeCloseTo(76000 * 1.001, 4);
  });
});

describe("priceAtDistance", () => {
  it("computes long stop below entry", () => {
    expect(priceAtDistance(100, 2, "long")).toBeCloseTo(98);
  });
  it("computes short stop above entry", () => {
    expect(priceAtDistance(100, 2, "short")).toBeCloseTo(102);
  });
});

describe("deriveValues — edge cases", () => {
  it("handles 1x leverage gracefully", () => {
    const result = deriveValues({
      entry: 100,
      leverage: 1,
      direction: "long",
      stop: 99,
      accountSize: 1000
    });
    expect(result.liquidationPrice).toBe(0);
    expect(result.liqDistancePct).toBe(100);
    expect(result.notional).toBe(1000);
  });

  it("handles 100x leverage", () => {
    const result = deriveValues({
      entry: 100,
      leverage: 100,
      direction: "long",
      stop: 99.5,
      accountSize: 1000
    });
    expect(result.liquidationPrice).toBe(99);
    expect(result.notional).toBe(100_000);
  });
});

describe("formatUsd", () => {
  it("formats large numbers with commas", () => {
    expect(formatUsd(1_234_567)).toBe("$1,234,567");
    expect(formatUsd(67000)).toBe("$67,000");
  });
  it("formats mid-range with 2 decimals", () => {
    expect(formatUsd(12.34)).toBe("$12.34");
    expect(formatUsd(1.5)).toBe("$1.50");
  });
  it("formats small numbers with 4 decimals", () => {
    expect(formatUsd(0.1234)).toBe("$0.1234");
  });
  it("returns n/a for non-finite", () => {
    expect(formatUsd(NaN)).toBe("n/a");
    expect(formatUsd(Infinity)).toBe("n/a");
  });
});

describe("formatPct", () => {
  it("formats with 2 decimals by default", () => {
    expect(formatPct(2.5)).toBe("2.50%");
  });
  it("respects digits arg", () => {
    expect(formatPct(2.5, 0)).toBe("3%");
  });
  it("returns n/a for non-finite", () => {
    expect(formatPct(NaN)).toBe("n/a");
  });
});
