import { afterEach, describe, expect, it, vi } from "vitest";
import { _cacheSize, cached, clearCache, getCached, setCached } from "../../lib/cache";

afterEach(() => {
  clearCache();
  vi.useRealTimers();
});

describe("cache module", () => {
  it("returns undefined for missing keys", () => {
    expect(getCached("missing")).toBeUndefined();
  });

  it("set then get returns value", () => {
    setCached("k", { v: 1 }, 10_000);
    expect(getCached<{ v: number }>("k")).toEqual({ v: 1 });
  });

  it("expires after TTL", () => {
    vi.useFakeTimers();
    setCached("k", "v", 1_000);
    expect(getCached("k")).toBe("v");
    vi.advanceTimersByTime(1_500);
    expect(getCached("k")).toBeUndefined();
  });

  it("cached() loads only once when called repeatedly", async () => {
    let calls = 0;
    const loader = async () => {
      calls++;
      return calls;
    };
    const a = await cached("once", loader, 10_000);
    const b = await cached("once", loader, 10_000);
    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(calls).toBe(1);
  });

  it("cached() reloads after TTL", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const loader = async () => ++calls;
    await cached("k", loader, 1_000);
    vi.advanceTimersByTime(1_500);
    await cached("k", loader, 1_000);
    expect(calls).toBe(2);
  });

  it("clearCache empties the store", () => {
    setCached("a", 1);
    setCached("b", 2);
    expect(_cacheSize()).toBe(2);
    clearCache();
    expect(_cacheSize()).toBe(0);
  });
});
