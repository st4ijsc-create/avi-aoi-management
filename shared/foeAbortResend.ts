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

// ── EDGE-ABORT-TRE-KHONG-HAN (X-EDGE-ABORT-TUOI, 28/11) — ONE source of the age of an abort, read the same way by central's answers to an
// edge node, by X-14 (edgeNodeCommands), by the re-send window of central (foeEngine) and by the Studio. A single clock: the timestamps below
// are written by central's own process, and `now` is read there too.

/** The run-context key of the server-only rejection claim (foeGateApproval FOE_REJECT_CLAIM_CTX_KEY — the same literal; a test pins it). */
export const FOE_REJECT_CLAIM_KEY = "foeRejectClaim";
/** The run-context key of WHEN that rejection claimed the run (central's ms clock), written in the SAME write as the claim key. Server-only. */
export const FOE_REJECT_CLAIM_AT_CTX_KEY = "foeRejectClaimAt";

type RunMocAbort = { status: string; finishedAt?: Date | string | number | null; contextJson?: unknown };

/** The rejection's own timestamp: only when the rejection claim key is there too (a v1 payload cannot plant a stamp alone). Else null. */
export function mocTuChoiMs(run: { contextJson?: unknown }): number | null {
  const ctx = run.contextJson;
  if (ctx == null || typeof ctx !== "object") return null;
  const c = ctx as Record<string, unknown>;
  if (c[FOE_REJECT_CLAIM_KEY] == null) return null;
  const at = c[FOE_REJECT_CLAIM_AT_CTX_KEY];
  return typeof at === "number" && Number.isFinite(at) ? at : null;
}

/**
 * The moment the age of an abort counts from — never made younger by a later write: the rejection's stamp when there is one (in EVERY
 * status: its final 'aborted' write and a person's later Abort both rewrite finishedAt); else finishedAt, only for an 'aborted' run; else null.
 */
export function mocAbortMs(run: RunMocAbort): number | null {
  const tuChoi = mocTuChoiMs(run);
  if (tuChoi !== null) return tuChoi;
  if (run.status !== "aborted" || run.finishedAt == null) return null;
  const at = new Date(run.finishedAt).getTime();
  return Number.isFinite(at) ? at : null;
}

/** The age of the abort on THIS clock: null when the moment is unknown, or the age is negative (the wall clock went back) or not finite. */
export function tuoiAbortMs(run: RunMocAbort, now: number = Date.now()): number | null {
  const moc = mocAbortMs(run);
  if (moc === null) return null;
  const t = now - moc;
  return Number.isFinite(t) && t >= 0 ? t : null;
}

/** The R-6-d window on ONE clock (central / Studio): inside ⇔ a known, non-negative age within ABORT_RESEND_WINDOW_MS. Never Math.abs. */
export function trongCuaAbort(run: RunMocAbort, now: number = Date.now()): boolean {
  const t = tuoiAbortMs(run, now);
  return t !== null && t <= ABORT_RESEND_WINDOW_MS;
}

/**
 * X-EDGE-ABORT-TUOI — the age of central's abort as an EDGE NODE received it: central's `abortAgeMs` (null: unknown), the node's monotonic ms right
 * before the request went out (`guiLuc`), and that clock. Never a stored number: the age is reckoned again at EACH decision (quyetAbortCu).
 */
export type TuoiAbortNhan = { abortAgeMs: number | null; guiLuc: number; monoNow: () => number };
/** quet: sweep as today; refusedTooOld / refusedNoTime: no sweep (STOPs withheld, the next non-STOP step held); trungTamCu: no age at all (an old central / a cut header) ⇒ as today. */
export type QuyetAbortCu = "quet" | "refusedTooOld" | "refusedNoTime" | "trungTamCu";
export function quyetAbortCu(t: TuoiAbortNhan | undefined): { quyet: QuyetAbortCu; tuoi: number | null } {
  if (t === undefined) return { quyet: "trungTamCu", tuoi: null };
  const a = t.abortAgeMs;
  if (a === null || typeof a !== "number" || !Number.isFinite(a) || a < 0) return { quyet: "refusedNoTime", tuoi: null };
  const tuoi = a + (t.monoNow() - t.guiLuc);
  if (!Number.isFinite(tuoi) || tuoi < 0) return { quyet: "refusedNoTime", tuoi: null };
  return { quyet: tuoi <= ABORT_RESEND_WINDOW_MS ? "quet" : "refusedTooOld", tuoi };
}
