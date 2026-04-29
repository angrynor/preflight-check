import { describe, expect, it } from "vitest";
import { stripDataUrl, validateRiskCheckRequest } from "../../lib/validation";

const validBody = {
  coin: "BTC",
  direction: "long",
  leverage: 10,
  entry: 67000,
  stop: 65660,
  accountSize: 10000
};

describe("validateRiskCheckRequest — happy path", () => {
  it("accepts a minimal valid long with stop", () => {
    const r = validateRiskCheckRequest(validBody);
    expect(r.ok).toBe(true);
    expect(r.data?.coin).toBe("BTC");
  });

  it("accepts null stop", () => {
    const r = validateRiskCheckRequest({ ...validBody, stop: null });
    expect(r.ok).toBe(true);
    expect(r.data?.stop).toBeNull();
  });

  it("uppercases lowercase coin symbols", () => {
    const r = validateRiskCheckRequest({ ...validBody, coin: "btc" });
    expect(r.ok).toBe(true);
    expect(r.data?.coin).toBe("BTC");
  });

  it("accepts a numeric string for leverage and entry", () => {
    const r = validateRiskCheckRequest({
      ...validBody,
      leverage: "10",
      entry: "67000"
    });
    expect(r.ok).toBe(true);
    expect(r.data?.leverage).toBe(10);
  });
});

describe("validateRiskCheckRequest — rejection paths", () => {
  it("rejects unknown coins", () => {
    const r = validateRiskCheckRequest({ ...validBody, coin: "PEPE" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Unsupported coin/);
  });

  it("rejects bad direction", () => {
    const r = validateRiskCheckRequest({ ...validBody, direction: "buy" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/long.*short/);
  });

  it("rejects non-integer leverage", () => {
    const r = validateRiskCheckRequest({ ...validBody, leverage: 10.5 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/integer/);
  });

  it("rejects leverage below 1", () => {
    expect(validateRiskCheckRequest({ ...validBody, leverage: 0 }).ok).toBe(false);
  });

  it("rejects leverage above 100", () => {
    expect(validateRiskCheckRequest({ ...validBody, leverage: 101 }).ok).toBe(false);
  });

  it("rejects negative entry", () => {
    expect(validateRiskCheckRequest({ ...validBody, entry: -5 }).ok).toBe(false);
  });

  it("rejects zero entry", () => {
    expect(validateRiskCheckRequest({ ...validBody, entry: 0 }).ok).toBe(false);
  });

  it("rejects non-positive accountSize", () => {
    expect(validateRiskCheckRequest({ ...validBody, accountSize: 0 }).ok).toBe(false);
  });

  it("rejects long with stop above entry", () => {
    const r = validateRiskCheckRequest({ ...validBody, stop: 68000 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/long.*below/);
  });

  it("rejects short with stop below entry", () => {
    const r = validateRiskCheckRequest({
      ...validBody,
      direction: "short",
      stop: 65000
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/short.*above/);
  });

  it("rejects non-object body", () => {
    expect(validateRiskCheckRequest(null).ok).toBe(false);
    expect(validateRiskCheckRequest("foo").ok).toBe(false);
  });

  it("rejects screenshot over 5MB", () => {
    const tooBig = "x".repeat(7 * 1024 * 1024);
    const r = validateRiskCheckRequest({ ...validBody, screenshotBase64: tooBig });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/5MB/);
  });

  it("accepts a small base64 screenshot", () => {
    const tiny = "iVBORw0KGgoAAAANS";
    const r = validateRiskCheckRequest({ ...validBody, screenshotBase64: tiny });
    expect(r.ok).toBe(true);
    expect(r.data?.screenshotBase64).toBe(tiny);
  });
});

describe("stripDataUrl", () => {
  it("strips data URL prefix", () => {
    expect(stripDataUrl("data:image/png;base64,iVBORw")).toBe("iVBORw");
  });
  it("returns unchanged when no prefix", () => {
    expect(stripDataUrl("iVBORw")).toBe("iVBORw");
  });
});
