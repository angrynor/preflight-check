import { cached } from "./cache";
import { binanceSymbol, type CoinSymbol } from "./coins";
import { fetchJson } from "./http";
import type { DailyKline, OpenInterestHistPoint, OpenInterestSnapshot, PremiumIndex } from "./types";

const BASE_URL = "https://api.bybit.com";

interface BybitEnvelope<T> {
  retCode: number;
  retMsg: string;
  result: T;
}

interface BybitTickerResp {
  category: string;
  list: Array<{
    symbol: string;
    markPrice: string;
    lastPrice: string;
    fundingRate: string;
    nextFundingTime: string;
    openInterest: string;
    openInterestValue?: string;
  }>;
}

interface BybitOIHistResp {
  symbol: string;
  category: string;
  list: Array<{ openInterest: string; timestamp: string }>;
}

interface BybitKlineResp {
  symbol: string;
  category: string;
  list: Array<[string, string, string, string, string, string, string]>;
}

function unwrap<T>(env: BybitEnvelope<T>, ctx: string): T {
  if (env.retCode !== 0) {
    throw new Error(`Bybit error in ${ctx}: ${env.retMsg} (code ${env.retCode})`);
  }
  return env.result;
}

export async function getPremiumIndexBybit(coin: CoinSymbol): Promise<PremiumIndex & { openInterest: number }> {
  const symbol = binanceSymbol(coin);
  return cached(`bybit:ticker:${symbol}`, async () => {
    const env = await fetchJson<BybitEnvelope<BybitTickerResp>>(
      `${BASE_URL}/v5/market/tickers?category=linear&symbol=${symbol}`
    );
    const result = unwrap(env, "tickers");
    const t = result.list[0];
    if (!t) throw new Error(`Bybit returned no ticker for ${symbol}`);
    return {
      markPrice: parseNum(t.markPrice),
      lastFundingRate: parseNum(t.fundingRate),
      nextFundingTime: Number(t.nextFundingTime),
      openInterest: parseNum(t.openInterest)
    };
  });
}

export async function getOpenInterestBybit(coin: CoinSymbol): Promise<OpenInterestSnapshot> {
  // Bybit ticker already returns OI; reuse the cache by calling getPremiumIndexBybit
  const ticker = await getPremiumIndexBybit(coin);
  return { openInterest: ticker.openInterest };
}

export async function getOpenInterestHistoryBybit(coin: CoinSymbol): Promise<OpenInterestHistPoint[]> {
  const symbol = binanceSymbol(coin);
  return cached(`bybit:oihist:${symbol}`, async () => {
    const env = await fetchJson<BybitEnvelope<BybitOIHistResp>>(
      `${BASE_URL}/v5/market/open-interest?category=linear&symbol=${symbol}&intervalTime=1h&limit=168`
    );
    const result = unwrap(env, "open-interest");
    // Bybit returns most-recent-first; reverse so first = oldest, last = newest (matches binance contract)
    return result.list
      .slice()
      .reverse()
      .map((row) => ({
        timestamp: Number(row.timestamp),
        sumOpenInterest: parseNum(row.openInterest)
      }));
  });
}

export async function getDailyKlinesBybit(coin: CoinSymbol, limit: number = 14): Promise<DailyKline[]> {
  const symbol = binanceSymbol(coin);
  return cached(`bybit:klines:${symbol}:${limit}`, async () => {
    const env = await fetchJson<BybitEnvelope<BybitKlineResp>>(
      `${BASE_URL}/v5/market/kline?category=linear&symbol=${symbol}&interval=D&limit=${limit}`
    );
    const result = unwrap(env, "kline");
    // Bybit returns most-recent-first; reverse to oldest-first
    return result.list
      .slice()
      .reverse()
      .map((row) => ({
        openTime: Number(row[0]),
        open: parseNum(row[1]),
        high: parseNum(row[2]),
        low: parseNum(row[3]),
        close: parseNum(row[4]),
        volume: parseNum(row[5])
      }));
  });
}

function parseNum(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`Bybit returned non-numeric value: ${raw}`);
  }
  return n;
}
