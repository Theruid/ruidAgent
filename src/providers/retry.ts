/**
 * Retry helper for transient network and API rate limit errors (429, 500, 502, 503, 529).
 */

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  signal?: AbortSignal;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 15000;
const DEFAULT_BACKOFF_FACTOR = 2;

// HTTP Status codes worth retrying
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504, 529]);

export function isRetryableError(error: unknown, status?: number): boolean {
  if (status && RETRYABLE_STATUS_CODES.has(status)) return true;
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("fetch failed") ||
      msg.includes("network error") ||
      msg.includes("econnreset") ||
      msg.includes("etimedout") ||
      msg.includes("rate limit") ||
      msg.includes("overloaded")
    );
  }
  return false;
}

export function calculateBackoff(
  attempt: number,
  initialDelay = DEFAULT_INITIAL_DELAY_MS,
  maxDelay = DEFAULT_MAX_DELAY_MS,
  factor = DEFAULT_BACKOFF_FACTOR
): number {
  // Add jitter between 0% and 30%
  const jitter = 1 + (Math.random() * 0.3);
  const delay = initialDelay * Math.pow(factor, attempt) * jitter;
  return Math.min(Math.round(delay), maxDelay);
}

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error("Operation aborted"));
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("Operation aborted"));
    });
  });
}

/**
 * Executes a fetch with automatic retries for transient failures.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: RetryOptions = {}
): Promise<Response> {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const initialDelay = opts.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const maxDelay = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const factor = opts.backoffFactor ?? DEFAULT_BACKOFF_FACTOR;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (opts.signal?.aborted) {
      throw new Error("Operation aborted");
    }

    try {
      const res = await fetch(url, { ...init, signal: opts.signal });
      if (res.ok) return res;

      if (!isRetryableError(null, res.status) || attempt === maxRetries) {
        return res; // Return non-retryable response (e.g. 401, 404) or exhausted retries
      }

      // Check Retry-After header if provided
      const retryAfterHeader = res.headers.get("retry-after");
      let waitMs = calculateBackoff(attempt, initialDelay, maxDelay, factor);
      if (retryAfterHeader) {
        const seconds = parseInt(retryAfterHeader, 10);
        if (!isNaN(seconds)) {
          waitMs = Math.min(seconds * 1000, maxDelay);
        }
      }

      await sleep(waitMs, opts.signal);
    } catch (err) {
      lastError = err;
      if (!isRetryableError(err) || attempt === maxRetries) {
        throw err;
      }
      const waitMs = calculateBackoff(attempt, initialDelay, maxDelay, factor);
      await sleep(waitMs, opts.signal);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
