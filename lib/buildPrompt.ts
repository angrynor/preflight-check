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
    stop_or_none:
      request.stop !== null
        ? `${formatUsd(request.stop)} (${formatPct(derived.stopDistancePct ?? 0)} away)`
        : "NONE — trader has no stop set",
    accountSize: request.accountSize,
    liquidation_price: formatLiquidationPrice(derived.liquidationPrice, request.direction),
    liq_distance_pct: Number.isFinite(derived.liqDistancePct)
      ? derived.liqDistancePct.toFixed(2)
      : "n/a (no liquidation at this leverage)",
    stop_distance_pct:
      derived.stopDistancePct !== null
        ? `${derived.stopDistancePct.toFixed(2)}%`
        : "no stop set",
    notional: formatUsd(derived.notional),
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
    chart_context_or_none: chartContext ?? "No screenshot provided."
  };
  return renderRiskOfficerPrompt(vars);
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
