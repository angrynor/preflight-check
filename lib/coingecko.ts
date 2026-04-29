import { cached } from "./cache";
import { COINGECKO_IDS, type CoinSymbol } from "./coins";
import { fetchJson } from "./http";
import type { GlobalMarket } from "./types";

const BASE_URL = "https://api.coingecko.com/api/v3";

interface RawGlobal {
  data: {
    market_cap_percentage: { btc: number };
    total_market_cap: { usd: number };
    total_volume: { usd: number };
  };
}

interface RawMarketChart {
  prices: [number, number][];
}

export async function getGlobalMarket(): Promise<GlobalMarket> {
  return cached("coingecko:global", async () => {
    const raw = await fetchJson<RawGlobal>(`${BASE_URL}/global`);
    return {
      btcDominance: raw.data.market_cap_percentage.btc,
      totalMarketCapUsd: raw.data.total_market_cap.usd,
      totalVolumeUsd: raw.data.total_volume.usd
    };
  });
}

export async function getFallbackPrice(coin: CoinSymbol): Promise<number> {
  const id = COINGECKO_IDS[coin];
  return cached(`coingecko:price:${id}`, async () => {
    const raw = await fetchJson<RawMarketChart>(
      `${BASE_URL}/coins/${id}/market_chart?vs_currency=usd&days=1`
    );
    const lastPoint = raw.prices[raw.prices.length - 1];
    if (!lastPoint) throw new Error(`CoinGecko returned no price points for ${id}`);
    return lastPoint[1];
  });
}
