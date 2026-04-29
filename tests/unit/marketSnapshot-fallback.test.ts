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
      return new Response(JSON.stringify({ error: "no route", url }), { status: 404 });
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

describe("buildMarketSnapshot — Binance geo-block falls through to Bybit", () => {
  it("uses Bybit when Binance returns 451", async () => {
    installRouter([
      // Binance: geo-blocked
      {
        match: (u) => u.includes("fapi.binance.com"),
        body: { code: 0, msg: "Service unavailable from a restricted location" },
        status: 451
      },
      // Bybit: full data
      {
        match: (u) => u.includes("api.bybit.com/v5/market/tickers"),
        body: {
          retCode: 0,
          retMsg: "OK",
          result: {
            category: "linear",
            list: [
              {
                symbol: "BTCUSDT",
                markPrice: "76000",
                lastPrice: "76000",
                fundingRate: "0.0001",
                nextFundingTime: "1700000000000",
                openInterest: "12345"
              }
            ]
          }
        }
      },
      {
        match: (u) => u.includes("api.bybit.com/v5/market/open-interest"),
        body: {
          retCode: 0,
          retMsg: "OK",
          result: {
            symbol: "BTCUSDT",
            category: "linear",
            list: [
              { openInterest: "110", timestamp: "2" },
              { openInterest: "100", timestamp: "1" }
            ]
          }
        }
      },
      {
        match: (u) => u.includes("api.bybit.com/v5/market/kline"),
        body: {
          retCode: 0,
          retMsg: "OK",
          result: {
            symbol: "BTCUSDT",
            category: "linear",
            list: [["1700086400000", "76000", "77000", "75000", "76500", "200", "0"]]
          }
        }
      },
      {
        match: (u) => u.includes("api.coingecko.com/api/v3/global"),
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
    expect(s.markPrice).toBe(76000);
    expect(s.fundingRatePct).toBeCloseTo(0.01);
    expect(s.openInterest).toBe(12345);
    expect(s.openInterest7dChangePct).toBeCloseTo(10);
    expect(s.btcDominance).toBe(53.4);
    expect(s.source).toBe("bybit");
    expect(s.warnings.some((w) => /binance.*geo-block/.test(w))).toBe(true);
  });

  it("falls all the way to coingecko-fallback when both Binance and Bybit fail", async () => {
    installRouter([
      {
        match: (u) => u.includes("fapi.binance.com"),
        body: {},
        status: 451
      },
      {
        match: (u) => u.includes("api.bybit.com"),
        body: {},
        status: 503
      },
      {
        match: (u) => u.includes("api.coingecko.com/api/v3/global"),
        body: {
          data: {
            market_cap_percentage: { btc: 50 },
            total_market_cap: { usd: 1 },
            total_volume: { usd: 1 }
          }
        }
      },
      {
        match: (u) => u.includes("api.coingecko.com/api/v3/coins"),
        body: { prices: [[0, 65500]] }
      }
    ]);

    const s = await buildMarketSnapshot("BTC");
    expect(s.markPrice).toBe(65500);
    expect(s.source).toBe("coingecko-fallback");
    expect(s.warnings.length).toBeGreaterThanOrEqual(2);
  });
});
