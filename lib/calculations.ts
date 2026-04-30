import type { Direction, DerivedValues, SizingMode } from "./types";

const ASSUMED_STOP_PCT_WHEN_NONE = 2;
const DEFAULT_RISK_PCT = 1;
const TIGHT_STOP_THRESHOLD_PCT = 0.5;

export interface CalcInput {
  entry: number;
  leverage: number;
  direction: Direction;
  stop: number | null;
  accountSize: number;
  riskPct?: number;
  mode?: SizingMode;
}

export function deriveValues(input: CalcInput): DerivedValues {
  const { entry, leverage, direction, accountSize } = input;
  const mode: SizingMode = input.mode ?? "stop-defined";
  const riskPct = clampRiskPct(input.riskPct ?? DEFAULT_RISK_PCT);

  const liquidationPrice = computeLiquidationPrice(entry, leverage, direction);
  const liqDistancePct = pctDistance(entry, liquidationPrice);

  // In risk-budget mode, derive a stop from risk% / leverage assuming the trader
  // intends to deploy their full account as margin (worst-case sizing).
  let derivedStopPrice: number | null = null;
  let derivedStopDistancePct: number | null = null;
  if (mode === "risk-budget" && leverage > 0) {
    derivedStopDistancePct = riskPct / leverage;
    derivedStopPrice = priceAtDistance(entry, derivedStopDistancePct, direction);
  }

  // Effective stop: explicit stop (Mode A), derived stop (Mode B), or assumed default (Mode A no-stop).
  let effectiveStopForSizing: number | null = input.stop;
  if (effectiveStopForSizing === null && derivedStopPrice !== null) {
    effectiveStopForSizing = derivedStopPrice;
  }

  const stopDistancePct =
    input.stop !== null
      ? pctDistance(entry, input.stop)
      : derivedStopDistancePct;

  const notional = accountSize * leverage;
  const margin = accountSize;

  const riskBudgetUsd = (accountSize * riskPct) / 100;

  const effectiveStopPct = stopDistancePct ?? ASSUMED_STOP_PCT_WHEN_NONE;
  const assumedStopUsed = input.stop === null && derivedStopPrice === null;

  const properNotional =
    effectiveStopPct > 0 ? riskBudgetUsd / (effectiveStopPct / 100) : 0;
  const properMargin = leverage > 0 ? properNotional / leverage : 0;

  const derivedStopTooTight =
    derivedStopDistancePct !== null && derivedStopDistancePct < TIGHT_STOP_THRESHOLD_PCT;

  return {
    liquidationPrice,
    liqDistancePct,
    stopDistancePct,
    notional,
    margin,
    riskBudgetPct: riskPct,
    riskBudgetUsd,
    properNotional,
    properMargin,
    effectiveStopPct,
    assumedStopUsed,
    derivedStopPrice,
    derivedStopDistancePct,
    derivedStopTooTight,
    mode
  };
}

export function computeLiquidationPrice(
  entry: number,
  leverage: number,
  direction: Direction
): number {
  if (leverage <= 0) return entry;
  if (leverage <= 1) {
    return direction === "long" ? 0 : Number.POSITIVE_INFINITY;
  }
  const moveToLiq = 1 / leverage;
  return direction === "long" ? entry * (1 - moveToLiq) : entry * (1 + moveToLiq);
}

export function priceAtDistance(
  entry: number,
  distancePct: number,
  direction: Direction
): number {
  const factor = distancePct / 100;
  return direction === "long" ? entry * (1 - factor) : entry * (1 + factor);
}

export function deriveStopFromRiskBudget(
  entry: number,
  leverage: number,
  riskPct: number,
  direction: Direction
): { stopPrice: number; stopDistancePct: number } {
  const distance = leverage > 0 ? riskPct / leverage : 0;
  return {
    stopPrice: priceAtDistance(entry, distance, direction),
    stopDistancePct: distance
  };
}

export function pctDistance(from: number, to: number): number {
  if (from === 0) return 0;
  return Math.abs(((to - from) / from) * 100);
}

function clampRiskPct(p: number): number {
  if (!Number.isFinite(p)) return DEFAULT_RISK_PCT;
  return Math.min(5, Math.max(0.1, p));
}

export function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return "n/a";
  if (Math.abs(n) >= 1000) return `$${Math.round(n).toLocaleString("en-US")}`;
  if (Math.abs(n) >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

export function formatPct(n: number, digits: number = 2): string {
  if (!Number.isFinite(n)) return "n/a";
  return `${n.toFixed(digits)}%`;
}
