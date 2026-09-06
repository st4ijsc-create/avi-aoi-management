/**
 * SESSION 5 (residuals) — WHAT A LOGOUT MUST EMPTY, AND THE TWO ENTRIES IT MUST NOT.
 *
 * ── WHY THIS IS ITS OWN MODULE ───────────────────────────────────────────────────────────────────
 * `lib/auth.ts` imports React and `@/lib/api`, so `node --test` cannot `import()` it: the `@/` path
 * alias is a bundler/tsconfig fact with no Node resolver behind it. A rule about WHICH cache entries
 * survive a logout is exactly the kind of claim that must be EXECUTED rather than pattern-matched —
 * the standing lesson of this programme — so the rule lives here, in a module with no imports at all,
 * and `runtime-tests/authLogoutCache.test.mjs` runs it against a real `QueryClient`.
 *
 * Same shape and same reason as `hmi-runtime/publishedScreen.ts` (plain `.ts` so the join's arithmetic
 * is runnable) and `lib/roleRank.ts` (this session's other hoist).
 *
 * ── THE TWO KEYS, DEFINED ONCE ───────────────────────────────────────────────────────────────────
 * These were `auth.ts`-local constants. They move here rather than being copied, so the predicate and
 * the queries it exempts can never name different keys — a second copy is precisely how an exemption
 * silently stops matching the thing it was meant to exempt.
 */

/** `GET /v1/auth/me` — the current session. `App.tsx`'s `AuthGate` reads it as `auth.user`. */
export const AUTH_ME_QUERY_KEY = ["auth", "me"] as const

/** `GET /v1/auth/bootstrap-status` — read by `AuthGate` BEFORE the session check. */
export const BOOTSTRAP_STATUS_QUERY_KEY = ["auth", "bootstrap-status"] as const

/**
 * Is `queryKey` one of the two entries `App.tsx`'s `AuthGate` renders from?
 *
 * 🔴 THE EXEMPTION IS FOR TWO ENTRIES, NOT FOR A NAMESPACE. Compared ELEMENTWISE against the two
 * literals rather than by a `queryKey[0] === "auth"` prefix test, because a future `["auth", …]` key
 * that the gate does not read — a permissions summary, a session roster — would then survive a logout
 * for free, which is the very defect (M-1) this exemption exists inside the fix for. Anything not
 * exactly one of these two is cleared.
 *
 * `logout` uses it NEGATED (`removeQueries({ predicate: (q) => !isAuthGateQueryKey(q.queryKey) })`),
 * so the default for any key nobody thought about is REMOVED — the direction that fails safe.
 */
export function isAuthGateQueryKey(queryKey: readonly unknown[]): boolean {
  const exempt: readonly (readonly unknown[])[] = [AUTH_ME_QUERY_KEY, BOOTSTRAP_STATUS_QUERY_KEY]
  return exempt.some(
    (candidate) =>
      queryKey.length === candidate.length && candidate.every((part, i) => queryKey[i] === part)
  )
}
