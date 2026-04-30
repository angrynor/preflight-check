import { describe, expect, it } from "vitest";
import {
  CHART_VISION_PROMPT,
  REQUIRED_REPORT_SECTIONS,
  RISK_OFFICER_SYSTEM_PROMPT,
  renderChartVisionPrompt,
  renderRiskOfficerPrompt,
  type PromptVariables
} from "../../lib/prompts";

const baseVars: PromptVariables = {
  coin: "BTC",
  direction: "LONG",
  leverage: 10,
  entry: 67000,
  stop_or_none: "$65,660 (2.00% away — TRADER-SET)",
  accountSize: 10000,
  risk_budget_pct: "1.00",
  risk_budget_usd: "$100",
  sizing_mode: "STOP-DEFINED (trader provided their own stop)",
  liquidation_price: "$60,300",
  liq_distance_pct: "10.00",
  stop_distance_pct: "2.00%",
  notional: "$100,000",
  proper_notional: "$5,000",
  proper_margin: "$500",
  derived_stop_block: "",
  mark_price: "$67,001",
  funding_rate: "0.0100",
  oi_current: "5.20B",
  oi_7d_change: "3.10",
  btc_dominance: "53.20",
  price_summary: "14d range $63,000-$70,500 (12% range)",
  chart_timeframe: "auto",
  chart_context_or_none: "No screenshot provided."
};

describe("renderRiskOfficerPrompt", () => {
  it("substitutes every placeholder", () => {
    const out = renderRiskOfficerPrompt(baseVars);
    expect(out).not.toMatch(/\{\{[a-zA-Z_]+\}\}/);
  });

  it("includes the literal trade and risk-budget variables", () => {
    const out = renderRiskOfficerPrompt(baseVars);
    expect(out).toContain("ASSET: BTC");
    expect(out).toContain("DIRECTION: LONG");
    expect(out).toContain("LEVERAGE: 10x");
    expect(out).toContain("ENTRY PRICE: 67000 USD");
    expect(out).toContain("ACCOUNT SIZE: 10000 USD");
    expect(out).toContain("RISK BUDGET: 1.00% of account ($100");
    expect(out).toContain("Mark price: $67,001 USD");
    expect(out).toContain("BTC dominance: 53.20%");
  });

  it("throws if a placeholder cannot be filled", () => {
    const broken = { ...baseVars };
    // @ts-expect-error intentional break
    delete broken.coin;
    expect(() => renderRiskOfficerPrompt(broken as PromptVariables)).toThrowError(/Unfilled/);
  });

  it("allows derived_stop_block to be empty", () => {
    const out = renderRiskOfficerPrompt({ ...baseVars, derived_stop_block: "" });
    expect(out).toBeTruthy();
  });

  it("renders the six required section headings as instructions", () => {
    for (const section of REQUIRED_REPORT_SECTIONS) {
      expect(RISK_OFFICER_SYSTEM_PROMPT).toContain(section);
    }
  });

  it("includes TRADE PLAN as the 5th section", () => {
    expect(REQUIRED_REPORT_SECTIONS).toContain("TRADE PLAN");
    const planIdx = REQUIRED_REPORT_SECTIONS.indexOf("TRADE PLAN");
    const exitIdx = REQUIRED_REPORT_SECTIONS.indexOf("THREE EXIT TRIGGERS");
    expect(planIdx).toBeLessThan(exitIdx);
  });

  it("instructs the model to emit TP1/TP2/TP3 lines", () => {
    expect(RISK_OFFICER_SYSTEM_PROMPT).toContain("TP1:");
    expect(RISK_OFFICER_SYSTEM_PROMPT).toContain("TP2:");
    expect(RISK_OFFICER_SYSTEM_PROMPT).toContain("TP3:");
    expect(RISK_OFFICER_SYSTEM_PROMPT).toContain("Not financial advice");
  });
});

describe("CHART_VISION_PROMPT", () => {
  it("requests the original six fields plus derived stop and TPs", () => {
    expect(CHART_VISION_PROMPT).toContain("TIMEFRAME");
    expect(CHART_VISION_PROMPT).toContain("TREND");
    expect(CHART_VISION_PROMPT).toContain("KEY LEVELS");
    expect(CHART_VISION_PROMPT).toContain("RECENT ACTION");
    expect(CHART_VISION_PROMPT).toContain("INDICATORS");
    expect(CHART_VISION_PROMPT).toContain("DIVERGENCES");
    expect(CHART_VISION_PROMPT).toContain("SUGGESTED_STOP");
    expect(CHART_VISION_PROMPT).toContain("TP1");
    expect(CHART_VISION_PROMPT).toContain("TP2");
    expect(CHART_VISION_PROMPT).toContain("TP3");
  });
});

describe("renderChartVisionPrompt", () => {
  it("substitutes the timeframe placeholder", () => {
    const out = renderChartVisionPrompt("4h");
    expect(out).toContain("4h");
    expect(out).not.toContain("{{chart_timeframe}}");
  });
  it("falls back gracefully with auto", () => {
    const out = renderChartVisionPrompt("auto");
    expect(out).toContain("auto");
  });
});
