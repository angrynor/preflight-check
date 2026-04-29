import { cached } from "./cache";
import { binanceSymbol, type CoinSymbol } from "./coins";
import { fetchJson } from "./http";
import type { DailyKline, OpenInterestHistPoint, OpenInterestSnapshot, PremiumIndex } from "./types";

const BASE_URL = "https://fapi.binance.com";

interface RawPremiumIndex {
  markPrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
}

interface RawOpenInterest {
  openInterest: string;
}

interface RawOpenInterestHist {
  sumOpenInterest: string;
  timestamp: number;
}

type RawKline = [
  number, // open time
  string, // open
  string, // high
  string, // low
  string, // close
  string, // volume
  number, // close time
  string, // quote asset volume
  number, // number of trades
  string, // taker buy base
  string, // taker buy quote
  string  // ignore
];

export async function getPremiumIndex(coin: CoinSymbol): Promise<PremiumIndex> {
  const symbol = binanceSymbol(coin);
  return cached(`binance:premium:${symbol}`, async () => {
    const raw = await fetchJson<RawPremiumIndex>(
      `${BASE_URL}/fapi/v1/premiumIndex?symbol=${symbol}`
    );
    return {
      markPrice: parseNum(raw.markPrice),
      lastFundingRate: parseNum(raw.lastFundingRate),
      nextFundingTime: raw.nextFundingTime
    };
  });
}

export async function getOpenInterest(coin: CoinSymbol): Promise<OpenInterestSnapshot> {
  const symbol = binanceSymbol(coin);
  return cached(`binance:oi:${symbol}`, async () => {
    const raw = await fetchJson<RawOpenInterest>(
      `${BASE_URL}/fapi/v1/openInterest?symbol=${symbol}`
    );
    return { openInterest: parseNum(raw.openInterest) };
  });
}

export async function getOpenInterestHistory(coin: CoinSymbol): Promise<OpenInterestHistPoint[]> {
  const symbol = binanceSymbol(coin);
  return cached(`binance:oihist:${symbol}`, async () => {
    const raw = await fetchJson<RawOpenInterestHist[]>(
      `${BASE_URL}/futures/data/openInterestHist?symbol=${symbol}&period=1h&limit=168`
    );
    return raw.map((r) => ({
      timestamp: r.timestamp,
      sumOpenInterest: parseNum(r.sumOpenInterest)
    }));
  });
}

export async function getDailyKlines(coin: CoinSymbol, limit: number = 14): Promise<DailyKline[]> {
  const symbol = binanceSymbol(coin);
  return cached(`binance:klines:${symbol}:${limit}`, async () => {
    const raw = await fetchJson<RawKline[]>(
      `${BASE_URL}/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=${limit}`
    );
    return raw.map((k) => ({
      openTime: k[0],
      open: parseNum(k[1]),
      high: parseNum(k[2]),
      low: parseNum(k[3]),
      close: parseNum(k[4]),
      volume: parseNum(k[5])
    }));
  });
}

export function compute7dOiChangePct(history: OpenInterestHistPoint[]): number | null {
  if (history.length < 2) return null;
  const first = history[0].sumOpenInterest;
  const last = history[history.length - 1].sumOpenInterest;
  if (first === 0) return null;
  return ((last - first) / first) * 100;
}

export function summarizeKlines(klines: DailyKline[]): string {
  if (klines.length === 0) return "no recent data";
  const first = klines[0];
  const last = klines[klines.length - 1];
  const high = Math.max(...klines.map((k) => k.high));
  const low = Math.min(...klines.map((k) => k.low));
  const changePct = ((last.close - first.open) / first.open) * 100;
  const direction = changePct >= 0 ? "+" : "";
  const range = ((high - low) / low) * 100;
  return `${klines.length}d range $${formatPrice(low)}-$${formatPrice(high)} (${range.toFixed(1)}% range), net ${direction}${changePct.toFixed(2)}% from $${formatPrice(first.open)} to $${formatPrice(last.close)}`;
}

function parseNum(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`Binance returned non-numeric value: ${raw}`);
  }
  return n;
}

function formatPrice(n: number): string {
  if (n >= 1000) return n.toFixed(0);
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}
