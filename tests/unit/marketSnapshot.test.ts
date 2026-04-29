import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCache } from "../../lib/cache";
import { buildMarketSnapshot } from "../../lib/marketSnapshot";

const ORIGINAL_FETCH = globalThis.fetch;

interface RouteResp {
  match: (url: string) => boolean;
  body: unknown;
  status?: number;
}

function installRouter(routes: RouteResp[]): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const route = routes.find((r) => r.match(url));
    if (!route) {
      return new Response(JSON.stringify({ error: "no route" }), { status: 404 });
    }
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;
}

beforeEach(() => clearCache());
afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe("buildMarketSnapshot", () => {
  it("returns a fully populated snapshot when all feeds succeed", async () => {
    installRouter([
      {
        match: (u) => u.includes("/fapi/v1/premiumIndex"),
        body: { markPrice: "67000", lastFundingRate: "0.0001", nextFundingTime: 1700000000 }
      },
      {
        match: (u) => u.includes("/fapi/v1/openInterest"),
        body: { openInterest: "12345" }
      },
      {
        match: (u) => u.includes("/futures/data/openInterestHist"),
        body: [
          { sumOpenInterest: "100", timestamp: 1 },
          { sumOpenInterest: "110", timestamp: 2 }
        ]
      },
      {
        match: (u) => u.includes("/fapi/v1/klines"),
        body: [
          [1700000000000, "65000", "67000", "64000", "66500", "1234", 0, "0", 0, "0", "0", "0"]
        ]
      },
      {
        match: (u) => u.includes("/api/v3/global"),
        body: {
          data: {
            market_cap_percentage: { btc: 53.4 },
            total_market_cap: { usd: 1 },
            total_volume: { usd: 1 }
          }
        }
      }
    ]);

    const s = await buildMarketSnapshot("BTC");
    expect(s.markPrice).toBe(67000);
    expect(s.fundingRatePct).toBeCloseTo(0.01);
    expect(s.openInterest).toBe(12345);
    expect(s.openInterest7dChangePct).toBeCloseTo(10);
    expect(s.btcDominance).toBe(53.4);
    expect(s.source).toBe("binance");
    expect(s.warnings).toEqual([]);
  });

  it("falls back to coingecko price when binance premiumIndex fails", async () => {
    installRouter([
      {
        match: (u) => u.includes("/fapi/v1/premiumIndex"),
        body: { msg: "down" },
        status: 500
      },
      {
        match: (u) => u.includes("/fapi/v1/openInterest"),
        body: { openInterest: "0" }
      },
      {
        match: (u) => u.includes("/futures/data/openInterestHist"),
        body: []
      },
      {
        match: (u) => u.includes("/fapi/v1/klines"),
        body: []
      },
      {
        match: (u) => u.includes("/api/v3/global"),
        body: {
          data: { market_cap_percentage: { btc: 50 }, total_market_cap: { usd: 1 }, total_volume: { usd: 1 } }
        }
      },
      {
        match: (u) => u.includes("/api/v3/coins/bitcoin/market_chart"),
        body: { prices: [[0, 65500]] }
      }
    ]);
    const s = await buildMarketSnapshot("BTC");
    expect(s.source).toBe("coingecko-fallback");
    expect(s.markPrice).toBe(65500);
    expect(s.warnings.length).toBeGreaterThan(0);
  });

  it("throws when both binance and coingecko price feeds die", async () => {
    installRouter([
      {
        match: (u) => u.includes("/fapi/v1/premiumIndex"),
        body: { msg: "down" },
        status: 500
      },
      {
        match: (u) => u.includes("/fapi/v1/openInterest"),
        body: { openInterest: "0" }
      },
      {
        match: (u) => u.includes("/futures/data/openInterestHist"),
        body: []
      },
      {
        match: (u) => u.includes("/fapi/v1/klines"),
        body: []
      },
      {
        match: (u) => u.includes("/api/v3/global"),
        body: { msg: "down" },
        status: 500
      },
      {
        match: (u) => u.includes("/api/v3/coins"),
        body: { msg: "down" },
        status: 500
      }
    ]);
    await expect(buildMarketSnapshot("BTC")).rejects.toThrow(/Live market data unavailable/);
  });

  it("survives partial failures (e.g. OI history missing) without throwing", async () => {
    installRouter([
      {
        match: (u) => u.includes("/fapi/v1/premiumIndex"),
        body: { markPrice: "1", lastFundingRate: "0", nextFundingTime: 0 }
      },
      {
        match: (u) => u.includes("/fapi/v1/openInterest"),
        body: { openInterest: "0" }
      },
      {
        match: (u) => u.includes("/futures/data/openInterestHist"),
        body: { msg: "rate limit" },
        status: 429
      },
      {
        match: (u) => u.includes("/fapi/v1/klines"),
        body: [[1700000000000, "1", "1", "1", "1", "1", 0, "0", 0, "0", "0", "0"]]
      },
      {
        match: (u) => u.includes("/api/v3/global"),
        body: {
          data: { market_cap_percentage: { btc: 50 }, total_market_cap: { usd: 1 }, total_volume: { usd: 1 } }
        }
      }
    ]);
    const s = await buildMarketSnapshot("BTC");
    expect(s.markPrice).toBe(1);
    expect(s.openInterest7dChangePct).toBeNull();
    expect(s.warnings.some((w) => w.includes("openInterestHist"))).toBe(true);
  });
});
