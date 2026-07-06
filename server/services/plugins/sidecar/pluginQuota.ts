/**
 * Plugin resource quota + rate-limit + call timeout — SYNAPSE §6.4.3 (doc 33 F3 · P4).
 *
 * "Plugin hỏng không được kéo sập platform": bound each out-of-process plugin's message rate,
 * enforce a per-call timeout, and track resource budget so a runaway plugin is throttled/killed
 * rather than starving the Hub. Pure/testable (time is injected — deterministic).
 */

export interface RateLimiterState {
  tokens: number;
  lastRefillTs: number;
}

export interface RateLimiterConfig {
  /** Bucket capacity (burst). */
  capacity: number;
  /** Tokens added per second. */
  refillPerSec: number;
}

/** Create a full token bucket. */
export function createBucket(config: RateLimiterConfig, nowTs: number): RateLimiterState {
  return { tokens: config.capacity, lastRefillTs: nowTs };
}

/**
 * Try to consume `cost` tokens at time `nowTs`. Returns the updated state + allowed flag.
 * Pure: caller threads the state (no hidden clock).
 */
export function tryConsume(
  state: RateLimiterState,
  config: RateLimiterConfig,
  nowTs: number,
  cost = 1,
): { state: RateLimiterState; allowed: boolean } {
  const elapsedSec = Math.max(0, (nowTs - state.lastRefillTs) / 1000);
  const refilled = Math.min(config.capacity, state.tokens + elapsedSec * config.refillPerSec);
  if (refilled >= cost) {
    return { state: { tokens: refilled - cost, lastRefillTs: nowTs }, allowed: true };
  }
  return { state: { tokens: refilled, lastRefillTs: nowTs }, allowed: false };
}

export interface ResourceBudget {
  cpuMillicores: number;
  memoryMiB: number;
}

/** Is a plugin's observed usage within its declared budget? Over → throttle/kill (never Hub). */
export function withinBudget(
  observed: ResourceBudget,
  budget: ResourceBudget,
): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  if (observed.cpuMillicores > budget.cpuMillicores)
    violations.push(`cpu ${observed.cpuMillicores}m > ${budget.cpuMillicores}m`);
  if (observed.memoryMiB > budget.memoryMiB)
    violations.push(`mem ${observed.memoryMiB}Mi > ${budget.memoryMiB}Mi`);
  return { ok: violations.length === 0, violations };
}

export class CallTimeoutError extends Error {
  constructor(public readonly ms: number) {
    super(`plugin call timed out after ${ms}ms`);
    this.name = "CallTimeoutError";
  }
}

/**
 * Wrap a promise with a timeout — every Hub→plugin call is bounded so a hung plugin can't block
 * the Hub. Rejects with CallTimeoutError on expiry.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new CallTimeoutError(ms)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
