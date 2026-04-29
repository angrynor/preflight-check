import {
  compute7dOiChangePct,
  getDailyKlines,
  getOpenInterest,
  getOpenInterestHistory,
  getPremiumIndex,
  summarizeKlines
} from "./binance";
import { getFallbackPrice, getGlobalMarket } from "./coingecko";
import { type CoinSymbol } from "./coins";
import type { MarketSnapshot } from "./types";

export async function buildMarketSnapshot(coin: CoinSymbol): Promise<MarketSnapshot> {
  const warnings: string[] = [];

  const [premiumRes, oiRes, oiHistRes, klinesRes, globalRes] = await Promise.allSettled([
    getPremiumIndex(coin),
    getOpenInterest(coin),
    getOpenInterestHistory(coin),
    getDailyKlines(coin, 14),
    getGlobalMarket()
  ]);

  let markPrice: number | null = null;
  let fundingRatePct = 0;
  if (premiumRes.status === "fulfilled") {
    markPrice = premiumRes.value.markPrice;
    fundingRatePct = premiumRes.value.lastFundingRate * 100;
  } else {
    warnings.push(`binance premiumIndex failed: ${describeError(premiumRes.reason)}`);
  }

  let openInterest = 0;
  if (oiRes.status === "fulfilled") {
    openInterest = oiRes.value.openInterest;
  } else {
    warnings.push(`binance openInterest failed: ${describeError(oiRes.reason)}`);
  }

  let oi7dChangePct: number | null = null;
  if (oiHistRes.status === "fulfilled") {
    oi7dChangePct = compute7dOiChangePct(oiHistRes.value);
  } else {
    warnings.push(`binance openInterestHist failed: ${describeError(oiHistRes.reason)}`);
  }

  let klines = klinesRes.status === "fulfilled" ? klinesRes.value : [];
  if (klinesRes.status === "rejected") {
    warnings.push(`binance klines failed: ${describeError(klinesRes.reason)}`);
  }
  const priceSummary = klines.length > 0 ? summarizeKlines(klines) : "no recent kline data";

  let btcDominance: number | null = null;
  if (globalRes.status === "fulfilled") {
    btcDominance = globalRes.value.btcDominance;
  } else {
    warnings.push(`coingecko global failed: ${describeError(globalRes.reason)}`);
  }

  let source: MarketSnapshot["source"] = "binance";
  if (markPrice === null) {
    try {
      markPrice = await getFallbackPrice(coin);
      source = "coingecko-fallback";
      warnings.push("used coingecko fallback for mark price");
    } catch (err) {
      throw new Error(
        `Live market data unavailable for ${coin}: ${describeError(err)}. Both Binance and CoinGecko failed.`
      );
    }
  }

  return {
    markPrice,
    fundingRatePct,
    openInterest,
    openInterest7dChangePct: oi7dChangePct,
    klines,
    priceSummary,
    btcDominance,
    source,
    warnings
  };
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
