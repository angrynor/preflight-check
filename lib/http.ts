export interface FetchJsonOptions {
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  init?: RequestInit;
}

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly url: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export async function fetchJson<T>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const retries = opts.retries ?? 1;
  const retryDelayMs = opts.retryDelayMs ?? 500;
  const timeoutMs = opts.timeoutMs ?? 8_000;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...opts.init,
        signal: controller.signal,
        headers: { Accept: "application/json", ...(opts.init?.headers ?? {}) }
      });
      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500;
        if (retryable && attempt < retries) {
          await sleep(retryDelayMs * Math.pow(2, attempt));
          continue;
        }
        throw new HttpError(`HTTP ${res.status} for ${url}`, res.status, url);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      const isAbort = err instanceof Error && err.name === "AbortError";
      const isHttp = err instanceof HttpError;
      const shouldRetry = (isAbort || (!isHttp && err instanceof Error)) && attempt < retries;
      if (shouldRetry) {
        await sleep(retryDelayMs * Math.pow(2, attempt));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("fetchJson: unknown failure");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
