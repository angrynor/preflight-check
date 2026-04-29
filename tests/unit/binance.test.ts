import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  compute7dOiChangePct,
  getDailyKlines,
  getOpenInterest,
  getOpenInterestHistory,
  getPremiumIndex,
  summarizeKlines
} from "../../lib/binance";
import { clearCache } from "../../lib/cache";

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetchOnce(response: unknown, status: number = 200): void {
  globalThis.fetch = vi.fn(async () => {
    return new Response(JSON.stringify(response), {
      status,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;
}

function mockFetchSequence(responses: Array<{ body: unknown; status?: number }>): void {
  let i = 0;
  globalThis.fetch = vi.fn(async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return new Response(JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;
}

beforeEach(() => {
  clearCache();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe("getPremiumIndex", () => {
  it("parses string fields into numbers", async () => {
    mockFetchOnce({
      markPrice: "67000.5",
      lastFundingRate: "0.0001",
      nextFundingTime: 1700000000
    });
    const r = await getPremiumIndex("BTC");
    expect(r.markPrice).toBe(67000.5);
    expect(r.lastFundingRate).toBe(0.0001);
    expect(r.nextFundingTime).toBe(1700000000);
  });

  it("uses cache for repeated calls within TTL", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ markPrice: "1", lastFundingRate: "0", nextFundingTime: 0 }),
        { status: 200 }
      )
    );
    globalThis.fetch = fetchMock as typeof fetch;
    await getPremiumIndex("ETH");
    await getPremiumIndex("ETH");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once on 5xx then succeeds", async () => {
    mockFetchSequence([
      { body: { msg: "fail" }, status: 500 },
      { body: { markPrice: "1", lastFundingRate: "0", nextFundingTime: 0 }, status: 200 }
    ]);
    const r = await getPremiumIndex("SOL");
    expect(r.markPrice).toBe(1);
  });

  it("throws on persistent failure", async () => {
    mockFetchSequence([
      { body: {}, status: 500 },
      { body: {}, status: 500 }
    ]);
    await expect(getPremiumIndex("ATOM")).rejects.toThrow();
  });
});

describe("getOpenInterest", () => {
  it("parses openInterest string", async () => {
    mockFetchOnce({ openInterest: "12345.6" });
    const r = await getOpenInterest("BTC");
    expect(r.openInterest).toBe(12345.6);
  });
});

describe("getOpenInterestHistory", () => {
  it("parses sumOpenInterest entries", async () => {
    mockFetchOnce([
      { sumOpenInterest: "100", timestamp: 1 },
      { sumOpenInterest: "110", timestamp: 2 }
    ]);
    const r = await getOpenInterestHistory("BTC");
    expect(r).toHaveLength(2);
    expect(r[0].sumOpenInterest).toBe(100);
  });
});

describe("getDailyKlines", () => {
  it("maps raw kline arrays into structured objects", async () => {
    mockFetchOnce([
      [1700000000000, "65000", "67000", "64000", "66500", "1234", 0, "0", 0, "0", "0", "0"],
      [1700086400000, "66500", "68000", "66000", "67800", "2345", 0, "0", 0, "0", "0", "0"]
    ]);
    const r = await getDailyKlines("BTC", 2);
    expect(r).toHaveLength(2);
    expect(r[0].open).toBe(65000);
    expect(r[0].high).toBe(67000);
    expect(r[1].close).toBe(67800);
  });
});

describe("compute7dOiChangePct", () => {
  it("computes percent change first to last", () => {
    expect(
      compute7dOiChangePct([
        { sumOpenInterest: 100, timestamp: 1 },
        { sumOpenInterest: 110, timestamp: 2 }
      ])
    ).toBeCloseTo(10);
  });
  it("returns null on insufficient data", () => {
    expect(compute7dOiChangePct([])).toBeNull();
    expect(compute7dOiChangePct([{ sumOpenInterest: 100, timestamp: 1 }])).toBeNull();
  });
  it("returns null when first is zero", () => {
    expect(
      compute7dOiChangePct([
        { sumOpenInterest: 0, timestamp: 1 },
        { sumOpenInterest: 100, timestamp: 2 }
      ])
    ).toBeNull();
  });
});

describe("summarizeKlines", () => {
  it("returns a human-readable summary", () => {
    const summary = summarizeKlines([
      { openTime: 1, open: 100, high: 110, low: 95, close: 105, volume: 1000 },
      { openTime: 2, open: 105, high: 112, low: 100, close: 110, volume: 1200 }
    ]);
    expect(summary).toMatch(/range/i);
    expect(summary).toContain("$95");
    expect(summary).toContain("$112");
  });
  it("handles empty input", () => {
    expect(summarizeKlines([])).toMatch(/no recent/);
  });
});
