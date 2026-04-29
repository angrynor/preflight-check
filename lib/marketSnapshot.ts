import {
  compute7dOiChangePct,
  getDailyKlines,
  getOpenInterest,
  getOpenInterestHistory,
  getPremiumIndex,
  summarizeKlines
} from "./binance";
import {
  getDailyKlinesBybit,
  getOpenInterestBybit,
  getOpenInterestHistoryBybit,
  getPremiumIndexBybit
} from "./bybit";
import {
  getDailyKlinesOkx,
  getOpenInterestHistoryOkx,
  getOpenInterestOkx,
  getPremiumIndexOkx
} from "./okx";
import { getFallbackPrice, getGlobalMarket } from "./coingecko";
import { type CoinSymbol } from "./coins";
import { HttpError } from "./http";
import type { MarketSnapshot } from "./types";

export async function buildMarketSnapshot(coin: CoinSymbol): Promise<MarketSnapshot> {
  const warnings: string[] = [];

  // Try Binance suite first (it's the canonical perp data source).
  // If any Binance call returns a geo-block (451) or a fatal error,
  // fall through to Bybit which is reachable from US-East/Vercel.
  const binanceResult = await tryBinanceSnapshot(coin, warnings);
  if (binanceResult.ok) {
    return finalizeSnapshot(binanceResult.snapshot, "binance", warnings);
  }

  warnings.push(`binance suite unavailable (${binanceResult.reason}) — switching to bybit`);
  const bybitResult = await tryBybitSnapshot(coin, warnings);
  if (bybitResult.ok) {
    return finalizeSnapshot(bybitResult.snapshot, "bybit", warnings);
  }

  warnings.push(`bybit suite unavailable (${bybitResult.reason}) — switching to okx`);
  const okxResult = await tryOkxSnapshot(coin, warnings);
  if (okxResult.ok) {
    return finalizeSnapshot(okxResult.snapshot, "okx", warnings);
  }

  warnings.push(`okx suite also unavailable (${okxResult.reason})`);

  // Last-resort: just CoinGecko price + global. No funding/OI.
  try {
    const [price, global] = await Promise.all([
      getFallbackPrice(coin).catch(() => null),
      getGlobalMarket().catch(() => null)
    ]);
    if (price === null) {
      throw new Error("no price feed available from binance, bybit, or coingecko");
    }
    return finalizeSnapshot(
      {
        markPrice: price,
        fundingRatePct: 0,
        openInterest: 0,
        openInterest7dChangePct: null,
        klines: [],
        priceSummary: "no recent kline data (fallback mode)",
        btcDominance: global?.btcDominance ?? null
      },
      "coingecko-fallback",
      warnings
    );
  } catch (err) {
    throw new Error(
      `Live market data unavailable for ${coin}: ${describeError(err)}. Binance, Bybit, and CoinGecko all failed.`
    );
  }
}

interface PartialSnapshot {
  markPrice: number;
  fundingRatePct: number;
  openInterest: number;
  openInterest7dChangePct: number | null;
  klines: MarketSnapshot["klines"];
  priceSummary: string;
  btcDominance: number | null;
}

type SnapshotAttempt =
  | { ok: true; snapshot: PartialSnapshot }
  | { ok: false; reason: string };

async function tryBinanceSnapshot(coin: CoinSymbol, warnings: string[]): Promise<SnapshotAttempt> {
  const [premiumRes, oiRes, oiHistRes, klinesRes, globalRes] = await Promise.allSettled([
    getPremiumIndex(coin),
    getOpenInterest(coin),
    getOpenInterestHistory(coin),
    getDailyKlines(coin, 14),
    getGlobalMarket()
  ]);

  // If the primary price feed (premiumIndex) is geo-blocked, abandon Binance.
  if (premiumRes.status === "rejected") {
    const err = premiumRes.reason;
    if (err instanceof HttpError && (err.status === 451 || err.status === 403)) {
      return { ok: false, reason: `binance geo-block: HTTP ${err.status}` };
    }
    return { ok: false, reason: `binance premiumIndex failed: ${describeError(err)}` };
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

  const klines = klinesRes.status === "fulfilled" ? klinesRes.value : [];
  if (klinesRes.status === "rejected") {
    warnings.push(`binance klines failed: ${describeError(klinesRes.reason)}`);
  }

  const btcDominance =
    globalRes.status === "fulfilled" ? globalRes.value.btcDominance : null;
  if (globalRes.status === "rejected") {
    warnings.push(`coingecko global failed: ${describeError(globalRes.reason)}`);
  }

  return {
    ok: true,
    snapshot: {
      markPrice: premiumRes.value.markPrice,
      fundingRatePct: premiumRes.value.lastFundingRate * 100,
      openInterest,
      openInterest7dChangePct: oi7dChangePct,
      klines,
      priceSummary: klines.length > 0 ? summarizeKlines(klines) : "no recent kline data",
      btcDominance
    }
  };
}

async function tryBybitSnapshot(coin: CoinSymbol, warnings: string[]): Promise<SnapshotAttempt> {
  const [tickerRes, oiHistRes, klinesRes, globalRes] = await Promise.allSettled([
    getPremiumIndexBybit(coin),
    getOpenInterestHistoryBybit(coin),
    getDailyKlinesBybit(coin, 14),
    getGlobalMarket()
  ]);

  if (tickerRes.status === "rejected") {
    return { ok: false, reason: `bybit ticker failed: ${describeError(tickerRes.reason)}` };
  }

  let oi7dChangePct: number | null = null;
  if (oiHistRes.status === "fulfilled") {
    oi7dChangePct = compute7dOiChangePct(oiHistRes.value);
  } else {
    warnings.push(`bybit openInterestHist failed: ${describeError(oiHistRes.reason)}`);
  }

  const klines = klinesRes.status === "fulfilled" ? klinesRes.value : [];
  if (klinesRes.status === "rejected") {
    warnings.push(`bybit klines failed: ${describeError(klinesRes.reason)}`);
  }

  // OI is included in the ticker response. Open interest comes back as base-asset units;
  // for compactness and parity with the binance snapshot we expose it as-is.
  // Use the ticker's openInterest plus, when available, prefer it over a separate snapshot.
  let openInterest = tickerRes.value.openInterest;
  // Only call the dedicated OI endpoint if ticker didn't give us a value (defensive)
  if (openInterest === 0) {
    try {
      const oi = await getOpenInterestBybit(coin);
      openInterest = oi.openInterest;
    } catch (err) {
      warnings.push(`bybit openInterest failed: ${describeError(err)}`);
    }
  }

  const btcDominance =
    globalRes.status === "fulfilled" ? globalRes.value.btcDominance : null;
  if (globalRes.status === "rejected") {
    warnings.push(`coingecko global failed: ${describeError(globalRes.reason)}`);
  }

  return {
    ok: true,
    snapshot: {
      markPrice: tickerRes.value.markPrice,
      fundingRatePct: tickerRes.value.lastFundingRate * 100,
      openInterest,
      openInterest7dChangePct: oi7dChangePct,
      klines,
      priceSummary: klines.length > 0 ? summarizeKlines(klines) : "no recent kline data",
      btcDominance
    }
  };
}

async function tryOkxSnapshot(coin: CoinSymbol, warnings: string[]): Promise<SnapshotAttempt> {
  const [premiumRes, oiSnapRes, oiHistRes, klinesRes, globalRes] = await Promise.allSettled([
    getPremiumIndexOkx(coin),
    getOpenInterestOkx(coin),
    getOpenInterestHistoryOkx(coin),
    getDailyKlinesOkx(coin, 14),
    getGlobalMarket()
  ]);

  if (premiumRes.status === "rejected") {
    return { ok: false, reason: `okx ticker/funding failed: ${describeError(premiumRes.reason)}` };
  }

  let openInterest = 0;
  if (oiSnapRes.status === "fulfilled") {
    openInterest = oiSnapRes.value.openInterest;
  } else {
    warnings.push(`okx openInterest failed: ${describeError(oiSnapRes.reason)}`);
  }

  let oi7dChangePct: number | null = null;
  if (oiHistRes.status === "fulfilled") {
    oi7dChangePct = compute7dOiChangePct(oiHistRes.value);
  } else {
    warnings.push(`okx openInterestHist failed: ${describeError(oiHistRes.reason)}`);
  }

  const klines = klinesRes.status === "fulfilled" ? klinesRes.value : [];
  if (klinesRes.status === "rejected") {
    warnings.push(`okx klines failed: ${describeError(klinesRes.reason)}`);
  }

  const btcDominance =
    globalRes.status === "fulfilled" ? globalRes.value.btcDominance : null;
  if (globalRes.status === "rejected") {
    warnings.push(`coingecko global failed: ${describeError(globalRes.reason)}`);
  }

  return {
    ok: true,
    snapshot: {
      markPrice: premiumRes.value.markPrice,
      fundingRatePct: premiumRes.value.lastFundingRate * 100,
      openInterest,
      openInterest7dChangePct: oi7dChangePct,
      klines,
      priceSummary: klines.length > 0 ? summarizeKlines(klines) : "no recent kline data",
      btcDominance
    }
  };
}

function finalizeSnapshot(
  partial: PartialSnapshot,
  source: MarketSnapshot["source"],
  warnings: string[]
): MarketSnapshot {
  return { ...partial, source, warnings };
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
