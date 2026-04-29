export type Direction = "long" | "short";

export interface RiskCheckRequest {
  coin: string;
  direction: Direction;
  leverage: number;
  entry: number;
  stop: number | null;
  accountSize: number;
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
  oneRiskUsd: number;
  properNotionalAt1R: number;
  properMarginAt1R: number;
  effectiveStopPct: number;
  assumedStopUsed: boolean;
}
