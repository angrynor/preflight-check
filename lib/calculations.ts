import type { Direction, DerivedValues } from "./types";

const ASSUMED_STOP_PCT_WHEN_NONE = 2;
const RISK_RULE_PCT = 1;

export interface CalcInput {
  entry: number;
  leverage: number;
  direction: Direction;
  stop: number | null;
  accountSize: number;
}

export function deriveValues(input: CalcInput): DerivedValues {
  const { entry, leverage, direction, stop, accountSize } = input;

  const liquidationPrice = computeLiquidationPrice(entry, leverage, direction);
  const liqDistancePct = pctDistance(entry, liquidationPrice);

  const stopDistancePct = stop !== null ? pctDistance(entry, stop) : null;

  const notional = accountSize * leverage;
  const margin = accountSize;

  const oneRiskUsd = (accountSize * RISK_RULE_PCT) / 100;

  const effectiveStopPct = stopDistancePct ?? ASSUMED_STOP_PCT_WHEN_NONE;
  const assumedStopUsed = stop === null;

  const properNotionalAt1R =
    effectiveStopPct > 0 ? oneRiskUsd / (effectiveStopPct / 100) : 0;
  const properMarginAt1R = leverage > 0 ? properNotionalAt1R / leverage : 0;

  return {
    liquidationPrice,
    liqDistancePct,
    stopDistancePct,
    notional,
    margin,
    oneRiskUsd,
    properNotionalAt1R,
    properMarginAt1R,
    effectiveStopPct,
    assumedStopUsed
  };
}

export function computeLiquidationPrice(
  entry: number,
  leverage: number,
  direction: Direction
): number {
  if (leverage <= 0) return entry;
  if (leverage <= 1) {
    // 1x or under: longs cannot be liquidated above $0; shorts have no upper bound.
    return direction === "long" ? 0 : Number.POSITIVE_INFINITY;
  }
  const moveToLiq = 1 / leverage;
  return direction === "long" ? entry * (1 - moveToLiq) : entry * (1 + moveToLiq);
}

export function pctDistance(from: number, to: number): number {
  if (from === 0) return 0;
  return Math.abs(((to - from) / from) * 100);
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
