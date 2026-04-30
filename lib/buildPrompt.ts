import { formatPct, formatUsd } from "./calculations";
import { type PromptVariables, renderRiskOfficerPrompt } from "./prompts";
import type { DerivedValues, MarketSnapshot } from "./types";
import type { ValidatedRequest } from "./validation";

export interface BuildPromptArgs {
  request: ValidatedRequest;
  derived: DerivedValues;
  snapshot: MarketSnapshot;
  chartContext: string | null;
}

export function buildRiskOfficerPrompt(args: BuildPromptArgs): string {
  const { request, derived, snapshot, chartContext } = args;
  const vars: PromptVariables = {
    coin: request.coin,
    direction: request.direction.toUpperCase(),
    leverage: request.leverage,
    entry: request.entry,
    stop_or_none: stopFieldDescription(request, derived),
    accountSize: request.accountSize,
    risk_budget_pct: derived.riskBudgetPct.toFixed(2),
    risk_budget_usd: formatUsd(derived.riskBudgetUsd),
    sizing_mode:
      derived.mode === "risk-budget"
        ? "RISK-BUDGET (stop derived from risk% / leverage)"
        : "STOP-DEFINED (trader provided their own stop)",
    liquidation_price: formatLiquidationPrice(derived.liquidationPrice, request.direction),
    liq_distance_pct: Number.isFinite(derived.liqDistancePct)
      ? derived.liqDistancePct.toFixed(2)
      : "n/a (no liquidation at this leverage)",
    stop_distance_pct:
      derived.stopDistancePct !== null
        ? `${derived.stopDistancePct.toFixed(2)}%`
        : "no stop set",
    notional: formatUsd(derived.notional),
    proper_notional: formatUsd(derived.properNotional),
    proper_margin: formatUsd(derived.properMargin),
    derived_stop_block: derivedStopBlock(derived),
    mark_price: formatUsd(snapshot.markPrice),
    funding_rate: snapshot.fundingRatePct.toFixed(4),
    oi_current: formatNumberCompact(snapshot.openInterest),
    oi_7d_change:
      snapshot.openInterest7dChangePct !== null
        ? snapshot.openInterest7dChangePct.toFixed(2)
        : "n/a",
    btc_dominance:
      snapshot.btcDominance !== null ? snapshot.btcDominance.toFixed(2) : "n/a",
    price_summary: snapshot.priceSummary,
    chart_timeframe: request.chartTimeframe ?? "auto",
    chart_context_or_none: chartContext ?? "No screenshot provided."
  };
  return renderRiskOfficerPrompt(vars);
}

function stopFieldDescription(request: ValidatedRequest, derived: DerivedValues): string {
  if (request.stop !== null) {
    const dist = derived.stopDistancePct?.toFixed(2) ?? "?";
    return `${formatUsd(request.stop)} (${dist}% away — TRADER-SET)`;
  }
  if (derived.derivedStopPrice !== null) {
    const dist = derived.derivedStopDistancePct?.toFixed(3) ?? "?";
    const tightness = derived.derivedStopTooTight
      ? ` — TIGHTNESS WARNING: under 0.5%, this is a market-microstructure stop, not a structural stop`
      : "";
    return `${formatUsd(derived.derivedStopPrice)} (${dist}% away — DERIVED from ${derived.riskBudgetPct.toFixed(2)}% risk at ${request.leverage}x leverage assuming full account margin${tightness})`;
  }
  return "NONE — trader has no stop set";
}

function derivedStopBlock(derived: DerivedValues): string {
  if (derived.derivedStopPrice === null) return "";
  return `- DERIVED STOP (risk-budget mode): ${formatUsd(derived.derivedStopPrice)} (${
    derived.derivedStopDistancePct?.toFixed(3) ?? "?"
  }% away)
- DERIVED STOP TIGHTNESS: ${
    derived.derivedStopTooTight
      ? "TOO TIGHT — under 0.5%, you will get wicked"
      : "within reasonable range for the asset"
  }`;
}

function formatLiquidationPrice(price: number, direction: "long" | "short"): string {
  if (!Number.isFinite(price) || price <= 0) {
    return direction === "long"
      ? "n/a (1x or below — no upside liquidation)"
      : "n/a (1x or below — no downside liquidation)";
  }
  return formatUsd(price);
}

function formatNumberCompact(n: number): string {
  if (!Number.isFinite(n)) return "n/a";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(2);
}
