import { isSupportedCoin, type CoinSymbol } from "./coins";
import type { Direction, RiskCheckRequest } from "./types";

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const MAX_SCREENSHOT_BASE64_LEN = Math.ceil((MAX_SCREENSHOT_BYTES * 4) / 3);

export interface ValidatedRequest extends Omit<RiskCheckRequest, "coin"> {
  coin: CoinSymbol;
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
  data?: ValidatedRequest;
}

export function validateRiskCheckRequest(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Request body must be a JSON object." };
  }
  const r = raw as Record<string, unknown>;

  const coin = typeof r.coin === "string" ? r.coin.toUpperCase() : null;
  if (!coin || !isSupportedCoin(coin)) {
    return { ok: false, error: `Unsupported coin. Pick one of the supported assets.` };
  }

  const direction = r.direction;
  if (direction !== "long" && direction !== "short") {
    return { ok: false, error: `direction must be "long" or "short".` };
  }

  const leverage = toFiniteNumber(r.leverage);
  if (leverage === null || !Number.isInteger(leverage) || leverage < 1 || leverage > 100) {
    return { ok: false, error: `leverage must be an integer between 1 and 100.` };
  }

  const entry = toFiniteNumber(r.entry);
  if (entry === null || entry <= 0) {
    return { ok: false, error: `entry must be a positive number.` };
  }

  let stop: number | null = null;
  if (r.stop !== null && r.stop !== undefined && r.stop !== "") {
    const parsedStop = toFiniteNumber(r.stop);
    if (parsedStop === null || parsedStop <= 0) {
      return { ok: false, error: `stop must be a positive number or null.` };
    }
    if (direction === "long" && parsedStop >= entry) {
      return { ok: false, error: `For a long, stop must be below entry.` };
    }
    if (direction === "short" && parsedStop <= entry) {
      return { ok: false, error: `For a short, stop must be above entry.` };
    }
    stop = parsedStop;
  }

  const accountSize = toFiniteNumber(r.accountSize);
  if (accountSize === null || accountSize <= 0) {
    return { ok: false, error: `accountSize must be a positive number.` };
  }

  let screenshotBase64: string | undefined;
  if (typeof r.screenshotBase64 === "string" && r.screenshotBase64.length > 0) {
    const stripped = stripDataUrl(r.screenshotBase64);
    if (stripped.length > MAX_SCREENSHOT_BASE64_LEN) {
      return { ok: false, error: `screenshot exceeds 5MB limit.` };
    }
    screenshotBase64 = stripped;
  }

  return {
    ok: true,
    data: {
      coin: coin as CoinSymbol,
      direction: direction as Direction,
      leverage,
      entry,
      stop,
      accountSize,
      screenshotBase64
    }
  };
}

export function stripDataUrl(s: string): string {
  const idx = s.indexOf(",");
  if (s.startsWith("data:") && idx > 0) {
    return s.slice(idx + 1);
  }
  return s;
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
