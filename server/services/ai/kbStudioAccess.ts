/**
 * Final-fix round, Task 6 (SECURITY — product-owner decision, not a technical finding) —
 * role gate for Training Studio corpus content.
 *
 * BỐI CẢNH: Wave 2 đường B wired `gatherStudioHits` (server/services/aiLocalKnowledgeStudio.ts)
 * into `retrieveKnowledge` (server/services/aiLocalKnowledgeService.ts) with NO role check —
 * `listCorpora()` inside `gatherStudioHits` enumerates EVERY Training Studio corpus with no
 * ownership/visibility filter, and the merge block pushes `h.text` verbatim into `contexts`
 * (fed straight into the LLM prompt) and `h.sourceRef` into `citations.title`. Before Wave 2,
 * that content was only reachable via `kbStudioRouter.ts`'s `corpusPreview` =
 * `kbStudioProcedure` = `roleProcedure("admin","engineer").use(require2FA)` (kbStudioRouter.ts:
 * 63, 312). Every authenticated caller of `retrieveKnowledge`/`answerQuestion`/`streamAnswer` —
 * including operator, via `POST /api/ai/local-kb/ask` and `/retrieve` (only
 * `sdk.authenticateRequest`, no role, no 2FA) — silently gained read access to it. Nobody
 * decided that on purpose.
 *
 * Product decision (2026-07-29): restrict Studio-corpus citations/contexts to `admin` and
 * `engineer`. Operator still uses the assistant normally, just against the system corpus only.
 *
 * ⚠ THIS GATE IS ROLE-ONLY — it does NOT match the pre-Wave-2 protection level, and callers
 * must not assume it does. `corpusPreview`'s pre-Wave-2 gate was role AND a fresh 2FA step-up
 * (`.use(require2FA)`); `canAccessStudioCorpus` below checks role alone — there is no 2FA
 * concept available in the `retrieveKnowledge()` call chain to check against (it isn't threaded
 * an HTTP session/step-up state). Net effect: an admin/engineer session that has NOT
 * (or no longer, if the step-up expired) completed 2FA now reads Studio content through the
 * assistant, where it previously could not through `corpusPreview`. This gap is INTENTIONAL per
 * the product decision above (the decision speaks only to role, not 2FA) — not an oversight —
 * but a future reader deciding whether this gate is "as strict as `corpusPreview`" needs to know
 * it is NOT, so they can weigh whether to close that gap (e.g. by threading a 2FA-freshness
 * signal through `ToolExecContext`/`KbQueryContext`, not attempted here) rather than assume it
 * away.
 *
 * FAIL-CLOSED BY DESIGN: this is an ALLOWLIST (closed set), not a denylist — an unrecognized,
 * missing, or misspelled role NEVER gets Studio content. The default posture is closed, not
 * open. This mirrors `canDecide` (pendingSuggestionLogic.ts) and `resolveAppliedThreshold`'s own
 * "unknown ⇒ safe branch" convention from earlier in this wave.
 *
 * NO EXISTENCE LEAK: callers of this gate must render "no Studio citations" identically to "the
 * Studio corpus happens to be empty" — never a message like "N documents you can't see". See
 * `retrieveKnowledge`'s merge block (`aiLocalKnowledgeService.ts`) for how the gate is wired in
 * so that an ineligible/unknown role produces BYTE-IDENTICAL output to an empty Studio corpus,
 * not a distinguishable "blocked" state.
 *
 * `callerRole` MUST be the REAL authenticated RBAC role (`server/db/auth.ts`'s `UserRole` —
 * `ctx.user.role` / `ToolExecContext.user.role` / the DB `User.role` column) — NEVER a
 * client-suppliable value. In particular this is NOT the same as this file's sibling
 * `aiLocalKnowledgeService.ts`'s own `UserRole` export (a "tone" type — worker/engineer/
 * manager/it_admin — derived from the real role for answer phrasing, and on
 * `POST /api/ai/local-kb/ask` even directly settable by the request body). Passing that tone
 * value here would be a spoofable security hole.
 */
const STUDIO_ELIGIBLE_ROLES: ReadonlySet<string> = new Set(["admin", "engineer"]);

export function canAccessStudioCorpus(callerRole: string | null | undefined): boolean {
  if (!callerRole) return false;
  return STUDIO_ELIGIBLE_ROLES.has(callerRole);
}
