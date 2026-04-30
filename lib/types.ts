export type Direction = "long" | "short";
export type SizingMode = "stop-defined" | "risk-budget";
export type ChartTimeframe = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d" | "auto";

export interface RiskCheckRequest {
  coin: string;
  direction: Direction;
  leverage: number;
  entry: number;
  stop: number | null;
  accountSize: number;
  riskPct?: number;
  mode?: SizingMode;
  chartTimeframe?: ChartTimeframe;
  screenshotBase64?: string;
}

export interface PremiumIndex {
  markPrice: number;
  lastFundingRate: number;
  nextFundingTime: number;
}

export interface OpenInterestSnapshot {
  openInterest: number;
}

export interface OpenInterestHistPoint {
  timestamp: number;
  sumOpenInterest: number;
}

export interface DailyKline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface GlobalMarket {
  btcDominance: number;
  totalMarketCapUsd: number;
  totalVolumeUsd: number;
}

export interface MarketSnapshot {
  markPrice: number;
  fundingRatePct: number;
  openInterest: number;
  openInterest7dChangePct: number | null;
  klines: DailyKline[];
  priceSummary: string;
  btcDominance: number | null;
  source: "binance" | "bybit" | "okx" | "coingecko-fallback";
  warnings: string[];
}

export interface DerivedValues {
  liquidationPrice: number;
  liqDistancePct: number;
  stopDistancePct: number | null;
  notional: number;
  margin: number;
  riskBudgetPct: number;
  riskBudgetUsd: number;
  properNotional: number;
  properMargin: number;
  effectiveStopPct: number;
  assumedStopUsed: boolean;
  /** When mode === "risk-budget", the stop derived from risk%/leverage. Null in stop-defined mode. */
  derivedStopPrice: number | null;
  derivedStopDistancePct: number | null;
  /** True when the derived stop is impractically tight for typical asset volatility (<0.5%). */
  derivedStopTooTight: boolean;
  mode: SizingMode;
}
