/**
 * doc 81 Đợt 10 C fix review 2 (ruling R-10-ae, R-10-n) — THE filter of an edge's run-context patch (`context` record of a run
 * stream): only the keys the WALKER itself writes may come from an edge — branch decisions, the dispatched-steps record, the
 * telemetry / state caches (and the R-10-y hint `foeCompensationHeld`, which central no longer DECIDES on — the resume state
 * is derived from the step rows, foeRunStore.edgeResumeStateOf). Every other key — `foeResumeState`, `foeOutcomeUnknown`, the
 * hold marks, a rejection's claim token, the API marker … — is central's and is refused (an anomaly when it would change).
 *
 * The same expression as group B's edgeReportsCentral.EDGE_CONTEXT_ALLOWED_KEY; B imports it from here at integration so the
 * report endpoint and the parity harness (foeRunStoreParity.dot10.test.ts) can never filter differently.
 */
export const EDGE_CONTEXT_ALLOWED_KEY = /^(branch:[^\s]{1,128}|foeDispatchedSteps|foeCompensationHeld|telemetry|states)$/;

/** The part of `patch` an edge may write, and the keys it tried to change that it may not (`held` = the stored context). */
export function edgeContextPatchOf(patch: Record<string, unknown>, held: Record<string, unknown> | null | undefined): { patch: Record<string, unknown>; refusedKeys: string[] } {
  const out: Record<string, unknown> = {};
  const refusedKeys: string[] = [];
  const now = held ?? {};
  for (const [k, v] of Object.entries(patch)) {
    if (EDGE_CONTEXT_ALLOWED_KEY.test(k)) out[k] = v;
    else if (JSON.stringify(now[k] ?? null) !== JSON.stringify(v ?? null)) refusedKeys.push(k);
  }
  return { patch: out, refusedKeys };
}
