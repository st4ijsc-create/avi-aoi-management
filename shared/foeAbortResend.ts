/**
 * doc 81 Đợt 6 fix 3 (ruling R-6-d) — "Send STOP steps again" on an aborted orchestration run is allowed only within this
 * window after the abort (the run's `finishedAt`): an old STOP must never reach a machine that has since been restarted and
 * put back to work. Past it — or when the abort time is unknown — the re-send is refused ("too old — use the machine's
 * direct STOP / E-STOP"). ONE definition, used by the engine (the decision) and the Studio (hiding the button).
 */
export const ABORT_RESEND_WINDOW_MS = 15 * 60_000;

/** true ⇔ a re-send is still allowed for a run aborted at `finishedAt` (unknown / unparsable ⇒ false: fail toward NOT sending an old STOP). */
export function abortResendAllowed(finishedAt: Date | string | number | null | undefined, now: number = Date.now()): boolean {
  if (finishedAt == null) return false;
  const at = new Date(finishedAt).getTime();
  if (!Number.isFinite(at)) return false;
  return Math.abs(now - at) <= ABORT_RESEND_WINDOW_MS; // a clock a little ahead is tolerated, never a far-future stamp
}
