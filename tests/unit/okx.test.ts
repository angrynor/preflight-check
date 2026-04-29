import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCache } from "../../lib/cache";
import {
  getDailyKlinesOkx,
  getOpenInterestOkx,
  getPremiumIndexOkx,
  okxSwapInst
} from "../../lib/okx";

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
    if (!route) return new Response(JSON.stringify({ error: "no route" }), { status: 404 });
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

describe("okxSwapInst", () => {
  it("formats coin symbol as OKX swap instrument", () => {
    expect(okxSwapInst("BTC")).toBe("BTC-USDT-SWAP");
    expect(okxSwapInst("ETH")).toBe("ETH-USDT-SWAP");
  });
});

describe("getPremiumIndexOkx", () => {
  it("combines ticker + funding-rate calls into a normalized PremiumIndex", async () => {
    installRouter([
      {
        match: (u) => u.includes("/api/v5/market/ticker"),
        body: {
          code: "0",
          msg: "",
          data: [{ instId: "BTC-USDT-SWAP", last: "76000", markPx: "76001", ts: "1" }]
        }
      },
      {
        match: (u) => u.includes("/api/v5/public/funding-rate"),
        body: {
          code: "0",
          msg: "",
          data: [
            {
              instId: "BTC-USDT-SWAP",
              fundingRate: "0.00012",
              nextFundingTime: "1700000000000"
            }
          ]
        }
      }
    ]);
    const r = await getPremiumIndexOkx("BTC");
    expect(r.markPrice).toBe(76001);
    expect(r.lastFundingRate).toBe(0.00012);
  });

  it("falls back to last price if markPx is missing", async () => {
    installRouter([
      {
        match: (u) => u.includes("/api/v5/market/ticker"),
        body: {
          code: "0",
          msg: "",
          data: [{ instId: "BTC-USDT-SWAP", last: "76050", ts: "1" }]
        }
      },
      {
        match: (u) => u.includes("/api/v5/public/funding-rate"),
        body: { code: "0", msg: "", data: [{ instId: "BTC-USDT-SWAP", fundingRate: "0", nextFundingTime: "0" }] }
      }
    ]);
    const r = await getPremiumIndexOkx("BTC");
    expect(r.markPrice).toBe(76050);
  });

  it("throws on non-zero OKX code", async () => {
    installRouter([
      {
        match: (u) => u.includes("/api/v5/market/ticker"),
        body: { code: "51001", msg: "Instrument not found", data: [] }
      },
      {
        match: (u) => u.includes("/api/v5/public/funding-rate"),
        body: { code: "0", msg: "", data: [{ instId: "x", fundingRate: "0", nextFundingTime: "0" }] }
      }
    ]);
    await expect(getPremiumIndexOkx("BTC")).rejects.toThrow(/Instrument not found/);
  });
});

describe("getOpenInterestOkx", () => {
  it("parses oi field into a number", async () => {
    installRouter([
      {
        match: (u) => u.includes("/api/v5/public/open-interest"),
        body: { code: "0", msg: "", data: [{ instId: "BTC-USDT-SWAP", oi: "12345.67", oiCcy: "0", ts: "1" }] }
      }
    ]);
    const r = await getOpenInterestOkx("BTC");
    expect(r.openInterest).toBe(12345.67);
  });
});

describe("getDailyKlinesOkx", () => {
  it("reverses OKX's most-recent-first candles to oldest-first", async () => {
    installRouter([
      {
        match: (u) => u.includes("/api/v5/market/candles"),
        body: {
          code: "0",
          msg: "",
          data: [
            ["1700086400000", "76000", "77000", "75500", "76500", "100", "0", "0", "1"],
            ["1700000000000", "75000", "76000", "74000", "76000", "150", "0", "0", "1"]
          ]
        }
      }
    ]);
    const r = await getDailyKlinesOkx("BTC", 2);
    expect(r).toHaveLength(2);
    expect(r[0].open).toBe(75000);
    expect(r[0].close).toBe(76000);
    expect(r[1].open).toBe(76000);
    expect(r[1].close).toBe(76500);
  });
});
