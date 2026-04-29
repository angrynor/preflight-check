import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCache } from "../../lib/cache";
import {
  getDailyKlinesBybit,
  getOpenInterestHistoryBybit,
  getPremiumIndexBybit
} from "../../lib/bybit";

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

describe("getPremiumIndexBybit", () => {
  it("parses ticker response into normalized fields", async () => {
    mockFetchOnce({
      retCode: 0,
      retMsg: "OK",
      result: {
        category: "linear",
        list: [
          {
            symbol: "BTCUSDT",
            markPrice: "76000.5",
            lastPrice: "76001",
            fundingRate: "0.00012345",
            nextFundingTime: "1700000000000",
            openInterest: "12345.6"
          }
        ]
      }
    });
    const r = await getPremiumIndexBybit("BTC");
    expect(r.markPrice).toBe(76000.5);
    expect(r.lastFundingRate).toBe(0.00012345);
    expect(r.openInterest).toBe(12345.6);
  });

  it("throws on non-zero retCode", async () => {
    mockFetchOnce({ retCode: 10001, retMsg: "Invalid symbol", result: null });
    await expect(getPremiumIndexBybit("BTC")).rejects.toThrow(/Invalid symbol/);
  });

  it("throws when ticker list is empty", async () => {
    mockFetchOnce({ retCode: 0, retMsg: "OK", result: { category: "linear", list: [] } });
    await expect(getPremiumIndexBybit("BTC")).rejects.toThrow(/no ticker/);
  });
});

describe("getOpenInterestHistoryBybit", () => {
  it("reverses Bybit's most-recent-first response to oldest-first", async () => {
    mockFetchOnce({
      retCode: 0,
      retMsg: "OK",
      result: {
        symbol: "BTCUSDT",
        category: "linear",
        list: [
          { openInterest: "100", timestamp: "3" },
          { openInterest: "90", timestamp: "2" },
          { openInterest: "80", timestamp: "1" }
        ]
      }
    });
    const r = await getOpenInterestHistoryBybit("BTC");
    expect(r[0].timestamp).toBe(1);
    expect(r[0].sumOpenInterest).toBe(80);
    expect(r[2].timestamp).toBe(3);
    expect(r[2].sumOpenInterest).toBe(100);
  });
});

describe("getDailyKlinesBybit", () => {
  it("maps and reverses Bybit's kline tuples to oldest-first", async () => {
    mockFetchOnce({
      retCode: 0,
      retMsg: "OK",
      result: {
        symbol: "BTCUSDT",
        category: "linear",
        list: [
          ["1700086400000", "76000", "77000", "75000", "76500", "200", "0"],
          ["1700000000000", "75000", "76000", "74000", "76000", "150", "0"]
        ]
      }
    });
    const r = await getDailyKlinesBybit("BTC", 2);
    expect(r).toHaveLength(2);
    expect(r[0].open).toBe(75000);
    expect(r[0].close).toBe(76000);
    expect(r[1].open).toBe(76000);
    expect(r[1].close).toBe(76500);
  });
});
