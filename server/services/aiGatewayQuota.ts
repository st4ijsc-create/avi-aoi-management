/**
 * AI Gateway Quota (doc69 G2-4) — per-user/role DAILY (rolling 24h) token budget, enforced
 * inside `aiGateway.planInference` when `AI_QUOTA_ENFORCE` is explicitly turned on (default
 * OFF — ships dark, see the flag's doc comment in aiGateway.ts; real budgets are a product
 * decision, not something this task should turn on for anyone).
 *
 * Budget resolution order (first match wins):
 *   1. an ENABLED `ai_gateway_quota` row scoped to the caller's `userId`
 *   2. an ENABLED `ai_gateway_quota` row scoped to the caller's `role` (only consulted when
 *      the caller supplies one — most `planInference` call-sites today only carry `userId`,
 *      so this tier exists for admin-configured per-role defaults but is not yet fed by every
 *      caller; extending `GatewayRequest` with an optional `role` is what would light it up)
 *   3. the deployment-wide DEFAULT row (`userId` AND `role` both null), if an admin created one
 *   4. `AI_QUOTA_DEFAULT_DAILY_TOKENS` env fallback (sane built-in default; ships even with an
 *      empty table)
 *
 * Usage is read from the EXISTING `ai_gateway_metrics` table (tokensIn+tokensOut, rolling 24h
 * window — same "since" pattern as `aiGateway.getGatewayStats`) — there is no separate counter
 * to keep in sync with the gateway's own metering.
 *
 * Fail-safe by construction: every exported function returns a "nothing to enforce" value
 * (`null` / an env-default budget / 0 used) on ANY error (DB down, table not yet migrated on
 * an older deployment, …) instead of throwing — infra issues must never block inference, per
 * the task brief. Only a genuinely-resolved "usage >= budget" ever reports `allowed:false`.
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Built-in sane default when no admin-configured budget row applies (tokens / rolling 24h). */
export function defaultDailyTokenBudget(): number {
  return envInt("AI_QUOTA_DEFAULT_DAILY_TOKENS", 200_000);
}

export interface QuotaBudget {
  budgetTokens: number;
  source: "user" | "role" | "default-row" | "env-default";
  /** id of the ai_gateway_quota row that supplied this budget, or null for the env fallback. */
  quotaRowId: number | null;
}

/** Resolve the effective daily token budget for a user (+ optional role). Never throws. */
export async function resolveQuotaBudget(userId: number, role?: string | null): Promise<QuotaBudget> {
  try {
    const { getDb } = await import("../db/connection");
    const db = await getDb();
    if (!db) return { budgetTokens: defaultDailyTokenBudget(), source: "env-default", quotaRowId: null };

    const { aiGatewayQuota } = await import("../../drizzle/schema");
    const { and, eq, isNull } = await import("drizzle-orm");

    const userRows = await db
      .select()
      .from(aiGatewayQuota)
      .where(and(eq(aiGatewayQuota.userId, userId), eq(aiGatewayQuota.enabled, true)))
      .limit(1);
    if (userRows[0]) {
      return { budgetTokens: userRows[0].dailyTokenBudget, source: "user", quotaRowId: userRows[0].id };
    }

    if (role) {
      const roleRows = await db
        .select()
        .from(aiGatewayQuota)
        .where(and(eq(aiGatewayQuota.role, role), isNull(aiGatewayQuota.userId), eq(aiGatewayQuota.enabled, true)))
        .limit(1);
      if (roleRows[0]) {
        return { budgetTokens: roleRows[0].dailyTokenBudget, source: "role", quotaRowId: roleRows[0].id };
      }
    }

    const defaultRows = await db
      .select()
      .from(aiGatewayQuota)
      .where(and(isNull(aiGatewayQuota.userId), isNull(aiGatewayQuota.role), eq(aiGatewayQuota.enabled, true)))
      .limit(1);
    if (defaultRows[0]) {
      return { budgetTokens: defaultRows[0].dailyTokenBudget, source: "default-row", quotaRowId: defaultRows[0].id };
    }

    return { budgetTokens: defaultDailyTokenBudget(), source: "env-default", quotaRowId: null };
  } catch (err) {
    console.warn(
      "[aiGatewayQuota] resolveQuotaBudget failed — using env default (fail-safe):",
      (err as Error)?.message,
    );
    return { budgetTokens: defaultDailyTokenBudget(), source: "env-default", quotaRowId: null };
  }
}

/** Rolling-24h tokens used (tokensIn+tokensOut) for a user, read from ai_gateway_metrics. */
export async function getTokensUsedToday(userId: number): Promise<number> {
  try {
    const { getDb } = await import("../db/connection");
    const db = await getDb();
    if (!db) return 0;

    const { aiGatewayMetrics } = await import("../../drizzle/schema");
    const { sql, and, eq, gte } = await import("drizzle-orm");
    const since = new Date(Date.now() - 24 * 3_600_000);

    const rows = await db
      .select({
        used: sql<number>`coalesce(sum(${aiGatewayMetrics.tokensIn} + ${aiGatewayMetrics.tokensOut}),0)::int`,
      })
      .from(aiGatewayMetrics)
      .where(and(eq(aiGatewayMetrics.userId, userId), gte(aiGatewayMetrics.createdAt, since)));

    return Number(rows[0]?.used) || 0;
  } catch (err) {
    console.warn(
      "[aiGatewayQuota] getTokensUsedToday failed — treating as 0 used (fail-safe):",
      (err as Error)?.message,
    );
    return 0;
  }
}

export interface QuotaCheckResult {
  allowed: boolean;
  usedTokens: number;
  budgetTokens: number;
  source: QuotaBudget["source"];
}

/**
 * The one function `aiGateway.planInference` calls (only when `AI_QUOTA_ENFORCE` is on).
 * Returns `null` when the caller has no `userId` (anonymous/system callers have no per-user
 * budget concept — nothing to enforce) OR any resolution step failed (fail-safe/allow). A
 * non-null result with `allowed:false` is the ONLY signal that should ever cause a caller to
 * block a request.
 */
export async function checkQuota(userId: number | undefined, role?: string | null): Promise<QuotaCheckResult | null> {
  if (userId == null) return null;
  try {
    // Sequential (not Promise.all) — this is an opt-in, non-hot-path check, and sequencing
    // keeps the two DB reads trivially easy to reason about/test in isolation.
    const budget = await resolveQuotaBudget(userId, role);
    const used = await getTokensUsedToday(userId);
    return {
      allowed: used < budget.budgetTokens,
      usedTokens: used,
      budgetTokens: budget.budgetTokens,
      source: budget.source,
    };
  } catch (err) {
    console.warn("[aiGatewayQuota] checkQuota failed — allowing (fail-safe):", (err as Error)?.message);
    return null;
  }
}
