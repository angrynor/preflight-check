import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectImageMediaType, getClient, streamReport } from "../../lib/claude";

const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  // Reset client between tests by toggling env
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
});

describe("getClient", () => {
  it("throws a clear error when ANTHROPIC_API_KEY is missing", () => {
    expect(() => getClient()).toThrow(/ANTHROPIC_API_KEY is not set/);
  });
});

describe("streamReport", () => {
  it("propagates the missing-key error to consumers", async () => {
    const iter = streamReport({ prompt: "hello" });
    // The error is thrown when we ask for the first chunk
    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of iter) {
        break;
      }
    }).rejects.toThrow(/ANTHROPIC_API_KEY is not set/);
  });
});

describe("detectImageMediaType", () => {
  it("identifies PNG by base64 signature", () => {
    expect(detectImageMediaType("iVBORw0KGgoAAAANSUhEUgAA")).toBe("image/png");
  });

  it("identifies JPEG by base64 signature", () => {
    expect(detectImageMediaType("/9j/4AAQSkZJRg")).toBe("image/jpeg");
  });

  it("identifies WEBP by RIFF base64 prefix", () => {
    expect(detectImageMediaType("UklGRpYRAABXRUJQ")).toBe("image/webp");
  });

  it("identifies GIF by GIF8 base64 prefix", () => {
    expect(detectImageMediaType("R0lGODlhAQAB")).toBe("image/gif");
  });

  it("falls back to PNG for unknown signatures", () => {
    expect(detectImageMediaType("XXXXXXXXXXXX")).toBe("image/png");
  });
});
