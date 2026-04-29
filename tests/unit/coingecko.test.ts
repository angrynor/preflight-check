import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCache } from "../../lib/cache";
import { getFallbackPrice, getGlobalMarket } from "../../lib/coingecko";

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetchOnce(body: unknown, status: number = 200): void {
  globalThis.fetch = vi.fn(async () => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;
}

beforeEach(() => clearCache());
afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe("getGlobalMarket", () => {
  it("extracts BTC dominance and totals", async () => {
    mockFetchOnce({
      data: {
        market_cap_percentage: { btc: 53.4 },
        total_market_cap: { usd: 2_500_000_000_000 },
        total_volume: { usd: 100_000_000_000 }
      }
    });
    const r = await getGlobalMarket();
    expect(r.btcDominance).toBe(53.4);
    expect(r.totalMarketCapUsd).toBe(2_500_000_000_000);
  });
});

describe("getFallbackPrice", () => {
  it("returns the latest price point", async () => {
    mockFetchOnce({
      prices: [
        [1700000000000, 65000],
        [1700086400000, 67000]
      ]
    });
    const price = await getFallbackPrice("BTC");
    expect(price).toBe(67000);
  });

  it("throws when no price points exist", async () => {
    mockFetchOnce({ prices: [] });
    await expect(getFallbackPrice("BTC")).rejects.toThrow(/no price points/);
  });
});
