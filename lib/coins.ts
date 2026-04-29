export const TOP_COINS = [
  "BTC",
  "ETH",
  "SOL",
  "BNB",
  "XRP",
  "DOGE",
  "ADA",
  "AVAX",
  "LINK",
  "DOT",
  "MATIC",
  "NEAR",
  "LTC",
  "BCH",
  "ATOM",
  "APT",
  "ARB",
  "OP",
  "SUI",
  "INJ"
] as const;

export type CoinSymbol = (typeof TOP_COINS)[number];

export const COINGECKO_IDS: Record<CoinSymbol, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  XRP: "ripple",
  DOGE: "dogecoin",
  ADA: "cardano",
  AVAX: "avalanche-2",
  LINK: "chainlink",
  DOT: "polkadot",
  MATIC: "matic-network",
  NEAR: "near",
  LTC: "litecoin",
  BCH: "bitcoin-cash",
  ATOM: "cosmos",
  APT: "aptos",
  ARB: "arbitrum",
  OP: "optimism",
  SUI: "sui",
  INJ: "injective-protocol"
};

export function isSupportedCoin(symbol: string): symbol is CoinSymbol {
  return (TOP_COINS as readonly string[]).includes(symbol);
}

export function binanceSymbol(coin: CoinSymbol): string {
  return `${coin}USDT`;
}
