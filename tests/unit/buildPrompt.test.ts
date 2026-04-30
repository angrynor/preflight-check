import { describe, expect, it } from "vitest";
import { buildRiskOfficerPrompt } from "../../lib/buildPrompt";
import type { DerivedValues, MarketSnapshot } from "../../lib/types";
import type { ValidatedRequest } from "../../lib/validation";

const request: ValidatedRequest = {
  coin: "BTC",
  direction: "long",
  leverage: 10,
  entry: 67000,
  stop: 65660,
  accountSize: 10000,
  mode: "stop-defined",
  riskPct: 1
};

const derived: DerivedValues = {
  liquidationPrice: 60300,
  liqDistancePct: 10,
  stopDistancePct: 2,
  notional: 100_000,
  margin: 10_000,
  riskBudgetPct: 1,
  riskBudgetUsd: 100,
  properNotional: 5_000,
  properMargin: 500,
  effectiveStopPct: 2,
  assumedStopUsed: false,
  derivedStopPrice: null,
  derivedStopDistancePct: null,
  derivedStopTooTight: false,
  mode: "stop-defined"
};

const snapshot: MarketSnapshot = {
  markPrice: 67_001,
  fundingRatePct: 0.01,
  openInterest: 5.2e9,
  openInterest7dChangePct: 3.1,
  klines: [],
  priceSummary: "14d range $63,000-$70,500 (12% range)",
  btcDominance: 53.2,
  source: "binance",
  warnings: []
};

describe("buildRiskOfficerPrompt", () => {
  it("inserts trade and market values into the prompt", () => {
    const prompt = buildRiskOfficerPrompt({ request, derived, snapshot, chartContext: null });
    expect(prompt).toContain("ASSET: BTC");
    expect(prompt).toContain("DIRECTION: LONG");
    expect(prompt).toContain("LEVERAGE: 10x");
    expect(prompt).toContain("Mark price: $67,001 USD");
    expect(prompt).toContain("BTC dominance: 53.20%");
    expect(prompt).toContain("14d range $63,000-$70,500");
  });

  it("flags missing stop in the stop_or_none section", () => {
    const prompt = buildRiskOfficerPrompt({
      request: { ...request, stop: null },
      derived: { ...derived, stopDistancePct: null, assumedStopUsed: true },
      snapshot,
      chartContext: null
    });
    expect(prompt).toMatch(/STOP LOSS: NONE/);
  });

  it("renders DERIVED stop description when in risk-budget mode", () => {
    const prompt = buildRiskOfficerPrompt({
      request: { ...request, stop: null, mode: "risk-budget", riskPct: 2 },
      derived: {
        ...derived,
        stopDistancePct: 0.2,
        derivedStopPrice: 66866,
        derivedStopDistancePct: 0.2,
        derivedStopTooTight: true,
        mode: "risk-budget"
      },
      snapshot,
      chartContext: null
    });
    expect(prompt).toMatch(/DERIVED from/);
    expect(prompt).toMatch(/TIGHTNESS WARNING/);
    expect(prompt).toContain("RISK-BUDGET (stop derived");
  });

  it("describes trader-set stops as TRADER-SET", () => {
    const prompt = buildRiskOfficerPrompt({ request, derived, snapshot, chartContext: null });
    expect(prompt).toMatch(/TRADER-SET/);
    expect(prompt).toContain("STOP-DEFINED (trader provided");
  });

  it("renders chart timeframe in vision context line", () => {
    const prompt = buildRiskOfficerPrompt({
      request: { ...request, chartTimeframe: "4h" },
      derived,
      snapshot,
      chartContext: "TIMEFRAME: 4H\nTREND: uptrend"
    });
    expect(prompt).toContain("timeframe: 4h");
  });

  it("renders chart context when provided", () => {
    const prompt = buildRiskOfficerPrompt({
      request,
      derived,
      snapshot,
      chartContext: "TIMEFRAME: 4H\nTREND: uptrend"
    });
    expect(prompt).toContain("TIMEFRAME: 4H");
  });

  it("falls back to 'No screenshot provided.' when chart context absent", () => {
    const prompt = buildRiskOfficerPrompt({ request, derived, snapshot, chartContext: null });
    expect(prompt).toContain("No screenshot provided.");
  });
});
