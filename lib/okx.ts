import { cached } from "./cache";
import { type CoinSymbol } from "./coins";
import { fetchJson } from "./http";
import type { DailyKline, OpenInterestHistPoint, OpenInterestSnapshot, PremiumIndex } from "./types";

const BASE_URL = "https://www.okx.com";

interface OkxEnvelope<T> {
  code: string;
  msg: string;
  data: T;
}

interface OkxTicker {
  instId: string;
  last: string;
  markPx?: string;
  ts: string;
}

interface OkxFunding {
  instId: string;
  fundingRate: string;
  nextFundingTime: string;
}

interface OkxOpenInterest {
  instId: string;
  oi: string;
  oiCcy: string;
  ts: string;
}

type OkxCandle = string[]; // [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]

function unwrap<T>(env: OkxEnvelope<T>, ctx: string): T {
  if (env.code !== "0") {
    throw new Error(`OKX error in ${ctx}: ${env.msg} (code ${env.code})`);
  }
  return env.data;
}

export function okxSwapInst(coin: CoinSymbol): string {
  return `${coin}-USDT-SWAP`;
}

export async function getPremiumIndexOkx(coin: CoinSymbol): Promise<PremiumIndex> {
  const inst = okxSwapInst(coin);
  return cached(`okx:ticker+funding:${inst}`, async () => {
    const [tickerEnv, fundingEnv] = await Promise.all([
      fetchJson<OkxEnvelope<OkxTicker[]>>(`${BASE_URL}/api/v5/market/ticker?instId=${inst}`),
      fetchJson<OkxEnvelope<OkxFunding[]>>(
        `${BASE_URL}/api/v5/public/funding-rate?instId=${inst}`
      )
    ]);
    const ticker = unwrap(tickerEnv, "market/ticker")[0];
    const funding = unwrap(fundingEnv, "public/funding-rate")[0];
    if (!ticker) throw new Error(`OKX returned no ticker for ${inst}`);
    if (!funding) throw new Error(`OKX returned no funding for ${inst}`);
    return {
      markPrice: parseNum(ticker.markPx ?? ticker.last),
      lastFundingRate: parseNum(funding.fundingRate),
      nextFundingTime: Number(funding.nextFundingTime)
    };
  });
}

export async function getOpenInterestOkx(coin: CoinSymbol): Promise<OpenInterestSnapshot> {
  const inst = okxSwapInst(coin);
  return cached(`okx:oi:${inst}`, async () => {
    const env = await fetchJson<OkxEnvelope<OkxOpenInterest[]>>(
      `${BASE_URL}/api/v5/public/open-interest?instType=SWAP&instId=${inst}`
    );
    const data = unwrap(env, "public/open-interest")[0];
    if (!data) throw new Error(`OKX returned no OI for ${inst}`);
    return { openInterest: parseNum(data.oi) };
  });
}

export async function getOpenInterestHistoryOkx(coin: CoinSymbol): Promise<OpenInterestHistPoint[]> {
  const inst = okxSwapInst(coin);
  // OKX history endpoint requires different scope; use 7d candles of OI via the historical endpoint.
  return cached(`okx:oihist:${inst}`, async () => {
    try {
      const env = await fetchJson<OkxEnvelope<Array<[string, string, string]>>>(
        `${BASE_URL}/api/v5/rubik/stat/contracts/open-interest-volume?ccy=${coin}&begin=&end=&period=1H`
      );
      const data = unwrap(env, "stat/oi-volume");
      // Returns most-recent-first; reverse for oldest-first parity.
      return data
        .slice()
        .reverse()
        .map((row) => ({ timestamp: Number(row[0]), sumOpenInterest: parseNum(row[1]) }))
        .slice(-168); // last 7d hourly
    } catch {
      // Fall back to a single point so 7d change is null but the call doesn't blow up.
      const snap = await getOpenInterestOkx(coin);
      return [{ timestamp: Date.now(), sumOpenInterest: snap.openInterest }];
    }
  });
}

export async function getDailyKlinesOkx(coin: CoinSymbol, limit: number = 14): Promise<DailyKline[]> {
  const inst = okxSwapInst(coin);
  return cached(`okx:klines:${inst}:${limit}`, async () => {
    const env = await fetchJson<OkxEnvelope<OkxCandle[]>>(
      `${BASE_URL}/api/v5/market/candles?instId=${inst}&bar=1D&limit=${limit}`
    );
    const data = unwrap(env, "market/candles");
    // OKX returns most-recent-first; reverse for oldest-first.
    return data
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
    throw new Error(`OKX returned non-numeric value: ${raw}`);
  }
  return n;
}
