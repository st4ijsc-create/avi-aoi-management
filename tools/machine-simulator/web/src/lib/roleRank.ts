/**
 * SESSION 5 (residuals) — THE ONE role ladder, hoisted out of the eight files that each declared it.
 *
 * ── WHAT WAS THERE BEFORE ────────────────────────────────────────────────────────────────────────
 * Measured at `5f00fef8`: `const ROLE_RANK: Record<string, number> = { Operator: 0, Engineer: 1,
 * Admin: 2 }` appeared VERBATIM in eight files — `components/MachineControlPanel.tsx`,
 * `routes/AlarmCenter.tsx`, `routes/AssetRegistry.tsx`, `routes/Connectors.tsx`,
 * `routes/LineControl.tsx`, `routes/Notifications.tsx`, `routes/Site.tsx` and `shell/Sidebar.tsx`.
 * Ten files MENTION the ladder; the other two (`hmi-runtime/writePermissionChannel.ts`, `lib/api.ts`)
 * only ever named it in prose to say they deliberately do NOT compare roles. A grep counting ten and
 * editing ten would have damaged two innocent files — recorded here so the next reader does not
 * repeat that arithmetic.
 *
 * This is the same hoist `lib/driverKind.ts` already performed for `AssetRegistry.tsx`'s own local
 * `KNOWN_DRIVER_KINDS`/`driverKindLabel` ("reuse it; do not invent a second pattern"), and this file
 * follows that one's shape: plain `.ts`, no JSX, no React import — so `node --test` can `import()` and
 * EXECUTE it rather than pattern-match it (`runtime-tests/roleRank.test.mjs`).
 *
 * ── WHY TWO FUNCTIONS AND NOT ONE ────────────────────────────────────────────────────────────────
 * The eight copies were NOT all the same function. Seven declared
 *
 *     function meetsMinRole(minRole: string, userRole: string | undefined): boolean {
 *       if (!userRole) return false
 *       return (ROLE_RANK[userRole] ?? -1) >= (ROLE_RANK[minRole] ?? Number.POSITIVE_INFINITY)
 *     }
 *
 * character for character. `Sidebar.tsx`'s took `minRole: string | undefined` and carried ONE extra
 * leading line, `if (!minRole) return true` — because its caller passes `NavItem.minRole`, which is
 * optional and whose absence means "every authenticated role may see this entry". Folding that guard
 * into the shared strict function would have changed the other seven: each of them passes a
 * REQUIRED `role`/literal, and under the merged body a `minRole` that ever arrived falsy would flip
 * from DENY (`ROLE_RANK[""] ?? Number.POSITIVE_INFINITY` → nothing outranks it) to ALLOW. That is a
 * gate opening, which is the one direction this codebase does not accept silently. So the ladder is
 * shared and the two comparison shapes stay two functions, each named for what it is.
 *
 * `meetsMinRole` is the strict one — a minimum that must be stated. `navMeetsMinRole` is the
 * nav-entry one — an UNSTATED minimum means visible to everyone signed in. Both read the same table,
 * so the hierarchy itself can no longer drift between call sites, which is the whole point.
 *
 * ── THE SERVER IS THE REAL GATE ──────────────────────────────────────────────────────────────────
 * Unchanged by this hoist and worth restating in the one place that now defines the ladder:
 * `Policies.cs`'s server-side `RequireRole` OR-chains are the enforcement (`Policies.Admin` = Admin
 * alone, `Policies.Engineer` = Engineer or Admin, `Policies.Operator` = any of the three). Everything
 * here only decides whether a control is worth DRAWING for the current user.
 */

/** Operator < Engineer < Admin. The single declaration; `runtime-tests/roleRank.test.mjs` pins that a
 * ninth copy cannot reappear anywhere under `web/src/`. */
export const ROLE_RANK: Record<string, number> = { Operator: 0, Engineer: 1, Admin: 2 }

/**
 * Does `userRole` reach `minRole`? Byte-for-byte the body the seven route/component copies carried.
 *
 * An unknown `userRole` ranks `-1` (below Operator, so it clears nothing); an unknown `minRole` ranks
 * `+Infinity` (so nothing clears it). Both unknowns therefore fail CLOSED, which is why the two
 * defaults are asymmetric rather than a single sentinel.
 */
export function meetsMinRole(minRole: string, userRole: string | undefined): boolean {
  if (!userRole) return false
  return (ROLE_RANK[userRole] ?? -1) >= (ROLE_RANK[minRole] ?? Number.POSITIVE_INFINITY)
}

/**
 * The nav-entry comparison — `Sidebar.tsx`'s own former local copy, verbatim including its extra
 * first line. An ABSENT `minRole` means the entry carries no restriction (`NavItem.minRole` is
 * optional and most entries omit it), so it is visible to every authenticated role. A PRESENT one is
 * compared exactly as {@link meetsMinRole} compares it.
 */
export function navMeetsMinRole(minRole: string | undefined, userRole: string | undefined): boolean {
  if (!minRole) return true
  if (!userRole) return false
  return (ROLE_RANK[userRole] ?? -1) >= (ROLE_RANK[minRole] ?? Number.POSITIVE_INFINITY)
}
