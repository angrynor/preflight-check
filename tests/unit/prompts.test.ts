import { describe, expect, it } from "vitest";
import {
  CHART_VISION_PROMPT,
  REQUIRED_REPORT_SECTIONS,
  RISK_OFFICER_SYSTEM_PROMPT,
  renderRiskOfficerPrompt,
  type PromptVariables
} from "../../lib/prompts";

const baseVars: PromptVariables = {
  coin: "BTC",
  direction: "LONG",
  leverage: 10,
  entry: 67000,
  stop_or_none: "$65,660 (2.00% away)",
  accountSize: 10000,
  liquidation_price: "$60,300",
  liq_distance_pct: "10.00",
  stop_distance_pct: "2.00%",
  notional: "$100,000",
  mark_price: "$67,001",
  funding_rate: "0.0100",
  oi_current: "5.20B",
  oi_7d_change: "3.10",
  btc_dominance: "53.20",
  price_summary: "14d range $63,000-$70,500 (12% range)",
  chart_context_or_none: "No screenshot provided."
};

describe("renderRiskOfficerPrompt", () => {
  it("substitutes every placeholder", () => {
    const out = renderRiskOfficerPrompt(baseVars);
    expect(out).not.toMatch(/\{\{[a-zA-Z_]+\}\}/);
  });

  it("includes the literal trade variables", () => {
    const out = renderRiskOfficerPrompt(baseVars);
    expect(out).toContain("ASSET: BTC");
    expect(out).toContain("DIRECTION: LONG");
    expect(out).toContain("LEVERAGE: 10x");
    expect(out).toContain("ENTRY PRICE: 67000 USD");
    expect(out).toContain("ACCOUNT SIZE: 10000 USD");
    expect(out).toContain("Mark price: $67,001 USD");
    expect(out).toContain("BTC dominance: 53.20%");
  });

  it("throws if a placeholder cannot be filled", () => {
    const broken = { ...baseVars };
    // @ts-expect-error intentional break
    delete broken.coin;
    expect(() => renderRiskOfficerPrompt(broken as PromptVariables)).toThrowError(/Unfilled/);
  });

  it("renders the five required section headings as instructions", () => {
    for (const section of REQUIRED_REPORT_SECTIONS) {
      expect(RISK_OFFICER_SYSTEM_PROMPT).toContain(section);
    }
  });
});

describe("CHART_VISION_PROMPT", () => {
  it("requests the six expected fields", () => {
    expect(CHART_VISION_PROMPT).toContain("TIMEFRAME");
    expect(CHART_VISION_PROMPT).toContain("TREND");
    expect(CHART_VISION_PROMPT).toContain("KEY LEVELS");
    expect(CHART_VISION_PROMPT).toContain("RECENT ACTION");
    expect(CHART_VISION_PROMPT).toContain("INDICATORS");
    expect(CHART_VISION_PROMPT).toContain("DIVERGENCES");
  });
});
