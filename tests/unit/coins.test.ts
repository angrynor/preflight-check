import { describe, expect, it } from "vitest";
import { binanceSymbol, COINGECKO_IDS, isSupportedCoin, TOP_COINS } from "../../lib/coins";

describe("coins module", () => {
  it("has 20 supported coins", () => {
    expect(TOP_COINS).toHaveLength(20);
  });

  it("starts with BTC and includes top majors", () => {
    expect(TOP_COINS[0]).toBe("BTC");
    expect(TOP_COINS).toContain("ETH");
    expect(TOP_COINS).toContain("SOL");
  });

  it("isSupportedCoin returns true for listed coins, false otherwise", () => {
    expect(isSupportedCoin("BTC")).toBe(true);
    expect(isSupportedCoin("ETH")).toBe(true);
    expect(isSupportedCoin("PEPE")).toBe(false);
    expect(isSupportedCoin("")).toBe(false);
  });

  it("binanceSymbol appends USDT", () => {
    expect(binanceSymbol("BTC")).toBe("BTCUSDT");
    expect(binanceSymbol("ETH")).toBe("ETHUSDT");
  });

  it("COINGECKO_IDS covers every supported coin", () => {
    for (const coin of TOP_COINS) {
      expect(COINGECKO_IDS[coin]).toBeTruthy();
      expect(typeof COINGECKO_IDS[coin]).toBe("string");
    }
  });
});
