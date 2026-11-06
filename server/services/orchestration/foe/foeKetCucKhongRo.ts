/**
 * SCADA R1b-2b-2a A2(n) (AN TOÀN, L-7 — gates follow the energy direction; a STOP never waits for a person) — a FOE command step whose
 * outcome is UNKNOWN (FOE_OUTCOME_UNKNOWN: a dispatch that timed out, or a "may already have flown" refusal — DUPLICATE_IN_FLIGHT,
 * IDEMPOTENCY_KEY_REUSED, FOE_ROW_SPENT_FOR_KEY …; EDGE_OUTCOME_UNKNOWN: an edge sent it and its result was not recorded). Before A2(n) the
 * step's compensation (and the compensations of the containers around it) ran by itself, i.e. a WRITE to a device whose state the engine had
 * just declared unknown (a reset / setpoint on another machine, an "undo" of a command that may never have been sent), and nobody was told.
 *
 * Coordinator ruling (C), conditions n1–n6 + fix round 1 — the engine (foeEngine.execStep) splits each due compensation BY ENERGY DIRECTION, at
 * EVERY level (a held child never blocks an ancestor's STOP):
 *   • a STOP — OT: a PINNED STOP (the A2(h) shared predicate, commandDispatcher.phanLoaiStopGhimChoFoe → classifyOtStop(...).pinnedStop);
 *     robot: the robot dispatcher's own non-motion rule (stopJob.isStopJob, R-2) — runs AUTOMATICALLY, through the dispatcher and every gate,
 *     never a shortcut, and an URGENT alert says what really happened (sent / simulated / not confirmed / not handed over);
 *   • ANY other compensation (setpoint, reset, start, motion, a stop whose pins cannot be read / are not pinned) is NOT sent: the run is HELD
 *     with resume state `compensationHeld` for that step + an URGENT alert "… waiting for a person". Nothing is written to the device.
 * The unknown flag travels with the failure (`khongRo`), survives a failed row write (I-2) and is never swallowed by a parallel (I-4).
 * A KNOWN failure is unchanged (n6). An unknown outcome with no compensation due anywhere ⇒ URGENT too (R-4).
 *
 * THE SINK (S-1, fix round 4 (a)) — the aggregators may lose the flag, so the guarantee does not live there, and a compensation admitted before the latch may
 * write after it, so it does not live at a compensation's door either. It is ONE check in the same tick as the hand-over to the dispatcher
 * (foeEngine.xetCongBuTru, read by execCommand, central and edge): a step of a compensation on a latched run goes if it is a pinned STOP (+ URGENT), else it is
 * held + URGENT unless a Continue that passed n3 approved exactly that step + compensation. foeEngine.congBuTru only sorts at the door.
 *
 * THE FACT (b) — the moment an unknown outcome is decided the RUN is latched: central in the context (KET_CUC_KHONG_RO_CHOT_CTX_KEY, persisted first), the edge on
 * the step row (the code on it, journaled at once). A code on ANY row of the run is the fact: a compensation's own unknown and a STOP-typed step's included
 * (chotTuHang). Central turns it into the latch at every hand-back, /authorize reads it again (buTruBiChanKhongRo). Nothing clears it.
 *
 * THE FORWARD SINK (A2(n) extension, owner's ruling) — the same check, at the same line: a forward step on a latched run that is not a STOP for this dispatch is not handed
 * over either. Its row is failed, FOE_NOT_SENT_RUN_LATCHED, final (no retry, nothing of its own to undo), and the failure rises so the containers' compensations take the
 * split. Sibling branches on other devices stop too (accepted). A step that MAY have gone out (buocCoTheDaBayTuHang, the latch's own step) never reads "not sent": it stays
 * unknown and takes the path of a fresh unknown. So a walk on a latched run writes nothing forward and needs no person: the auto-resume walks one (a crash before the split).
 *
 * WHAT CANNOT BE RECALLED (c) — a write handed to a dispatcher BEFORE the latch: it leaves a trace, an URGENT and an audit row ("in flight at latch time").
 *
 * Resume v1 (n3) — THE rule (C-2): a pending `compensationHeld` carrying the unknown flag is what requires the check, not a marker and not a run
 * status. Continue (sends ONLY the held compensation(s), nothing forward — I-4): a person with machine-control rights (the router's own floor,
 * re-checked because the engine has other callers), a REQUIRED reason, an audit row that must land first (m-6); out of scope ⇒ "not found"
 * (resumeRun's scope rule). The walker keys on the same fact: a held compensation is only written when THAT step is in the approval central
 * recorded for this Continue (KHONG_RO_DUYET_CTX_KEY); otherwise it is split again. Abort: reason optional (R-1 — no STOP waits on a text
 * field), audited. Nothing expires into a write.
 *
 * No migration, no flag (AI_OT_CONTROL_ENABLED unchanged): the run / step statuses exist; the marker and the resume state are context JSON;
 * the alert kind and the audit action are free text.
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { users } from "../../../../drizzle/schema";
import { appError } from "../../../_core/appError";
import { STOP_DB_STEP_DEADLINE_MS } from "../../robot/stopJob";
import { withDeadline } from "../../ot/drivers/boundedClose";

/** The two machine-readable codes of the class (foeEngine.FOE_OUTCOME_UNKNOWN; the edge's EDGE_OUTCOME_UNKNOWN). Pinned by the unit test. */
export const MA_KET_CUC_KHONG_RO = ["FOE_OUTCOME_UNKNOWN", "EDGE_OUTCOME_UNKNOWN"] as const;
export type MaKetCucKhongRo = (typeof MA_KET_CUC_KHONG_RO)[number];

/** A code of the class as a WORD of the text (never inside an identifier: `XFOE_OUTCOME_UNKNOWN_Y` does not match). */
const RE_KHONG_RO = /(?<![A-Za-z0-9_])(FOE_OUTCOME_UNKNOWN|EDGE_OUTCOME_UNKNOWN)(?![A-Za-z0-9_])/;

/**
 * Does a step error say "outcome unknown"? Only where the walk cannot carry the flag itself: the resume state central DERIVED from the step
 * rows of an EDGE run (foeRunStore.edgeResumeStateOf — the rows hold the error text, nothing else). A code that appears in a KNOWN failure's
 * text can only HOLD a compensation that would have run (the safe direction), never run one that is held.
 */
export function loiLaKetCucKhongRo(error: string | null | undefined): boolean {
  return typeof error === "string" && RE_KHONG_RO.test(error);
}
/** The first code of the class in the text (FOE_OUTCOME_UNKNOWN when none — the walker's own flag said so). */
export function maKetCucKhongRoCua(error: string | null | undefined): MaKetCucKhongRo {
  const m = typeof error === "string" ? RE_KHONG_RO.exec(error) : null;
  return (m?.[1] as MaKetCucKhongRo | undefined) ?? "FOE_OUTCOME_UNKNOWN";
}
/** I-1 — the error a step row carries: the code is on it, so central can tell the class from the rows (a STOP-typed step's timeout has none). */
export function loiCoMaKhongRo(error: string): string {
  return loiLaKetCucKhongRo(error) ? error : `FOE_OUTCOME_UNKNOWN: ${error}`;
}

/**
 * Run-context key (server-written) of a run HELD by A2(n): { stepId, compId, ma, at, lan, ds } — codes and ids only (no free text: a masked
 * viewer sees the context as it is). `ds` (m-3) = every compensation held in this walk. It drives the Studio notice, the oversight hint and the
 * auto-resume skip; the n3 check keys on buTruKhongRoCho (C-2), which also counts it. Cleared by the Continue that passed the checks.
 */
export const KET_CUC_KHONG_RO_CTX_KEY = "foeKetCucKhongRo";
export interface DauKetCucKhongRo {
  stepId: string;
  compId: string;
  ma: MaKetCucKhongRo;
  /** ISO time of the hold (process clock — a label, never a decision) */
  at: string;
  /** the walk segment / interruption the hold belongs to (the alert's dedup) */
  lan: string;
  /** m-3 — every compensation held in this walk (a parallel can hold several) */
  ds?: Array<{ stepId: string; compId: string }>;
}
export function dauKetCucKhongRoCua(ctx: Record<string, unknown> | null | undefined): DauKetCucKhongRo | null {
  const v = ctx?.[KET_CUC_KHONG_RO_CTX_KEY];
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const d = v as Partial<DauKetCucKhongRo>;
  return typeof d.stepId === "string" && typeof d.compId === "string"
    ? {
        stepId: d.stepId,
        compId: d.compId,
        ma: d.ma === "EDGE_OUTCOME_UNKNOWN" ? d.ma : "FOE_OUTCOME_UNKNOWN",
        at: typeof d.at === "string" ? d.at : "",
        lan: typeof d.lan === "string" ? d.lan : "",
        ds: Array.isArray(d.ds) ? d.ds : [{ stepId: d.stepId, compId: d.compId }],
      }
    : // a marker whose ids cannot be read still marks the run (fail-closed: the Continue checks apply)
      { stepId: "?", compId: "?", ma: "FOE_OUTCOME_UNKNOWN", at: "", lan: "", ds: [{ stepId: "?", compId: "?" }] };
}

/**
 * C-2 — THE fact the n3 check keys on: the steps whose held compensation a resume would write. From the resume state in `ctx` (a
 * `compensationHeld` with the unknown flag, or the code in its error — central's own, or derived from an edge run's rows), plus the marker
 * (fail-closed: a marker names a hold even when the resume state is gone). The same fact the walker reads (execStep's resume branch).
 */
export function buTruKhongRoCho(ctx: Record<string, unknown> | null | undefined, resumeStateKey = "foeResumeState"): string[] {
  const out = new Set<string>();
  const rs = ctx?.[resumeStateKey];
  if (rs && typeof rs === "object" && !Array.isArray(rs)) {
    for (const [id, e] of Object.entries(rs as Record<string, { state?: unknown; khongRo?: unknown; error?: unknown }>)) {
      if (e?.state === "compensationHeld" && (e.khongRo === true || loiLaKetCucKhongRo(typeof e.error === "string" ? e.error : null))) out.add(id);
    }
  }
  const dau = dauKetCucKhongRoCua(ctx);
  for (const x of dau?.ds ?? []) out.add(x.stepId);
  return [...out];
}

/**
 * C-2 — run-context key (central-written, only by a Continue that passed the n3 check; an edge context patch can never set it): the steps whose
 * held compensation that Continue approved. Carried to the walker (central's rc, the edge's package context): without its step in here the walker
 * does not write a held compensation, it splits it again.
 */
export const KHONG_RO_DUYET_CTX_KEY = "foeKetCucKhongRoDuyet";
/** S-1 — did the Continue approve exactly THIS compensation of THIS step? */
export function daDuyetBuTruKhongRo(ctx: Record<string, unknown> | null | undefined, stepId: string, compId: string): boolean {
  const v = ctx?.[KHONG_RO_DUYET_CTX_KEY] as { buTru?: unknown } | null | undefined;
  return Array.isArray(v?.buTru) && (v.buTru as Array<{ stepId?: unknown; compId?: unknown }>).some((x) => x?.stepId === stepId && x?.compId === compId);
}

/** S-1 — run-context key (central-written, the moment an unknown outcome is decided): { stepId, ma, at }. Codes and ids only. Never cleared: the doubt stays with the run. */
export const KET_CUC_KHONG_RO_CHOT_CTX_KEY = "foeKetCucKhongRoChot";
/**
 * S-1 — is this run latched, from its context alone? The latch, a marker, the central-written list of an edge's unknown steps, or any resume state saying
 * so (an edge run's are central's to derive: the edge walker never writes the latch key). The walker adds its in-memory flag (rc.khongRoChot).
 */
export function runDaChotKhongRo(ctx: Record<string, unknown> | null | undefined): boolean {
  if (!ctx) return false;
  if (ctx[KET_CUC_KHONG_RO_CHOT_CTX_KEY] != null || ctx[KET_CUC_KHONG_RO_CTX_KEY] != null) return true;
  const ds = ctx.foeOutcomeUnknown;
  if (Array.isArray(ds) && ds.length > 0) return true;
  const rs = ctx.foeResumeState;
  if (!rs || typeof rs !== "object" || Array.isArray(rs)) return false;
  return Object.values(rs as Record<string, { state?: unknown; khongRo?: unknown; error?: unknown }>).some((e) => e?.state === "outcomeUnknown" || e?.khongRo === true || loiLaKetCucKhongRo(typeof e?.error === "string" ? e.error : null));
}

/**
 * A2(n) (b, C-C) — the latch the rows hold: the first row with the code (an `abort:` row is the sweep's, not a command's outcome), else an unknown state central
 * derived (the ledger: authorised, no result). null ⇔ nothing says so. Pure.
 */
export function chotTuHang(
  rows: ReadonlyArray<{ stepId: string; error?: string | null }>,
  resume?: Record<string, { state?: unknown; khongRo?: unknown; error?: unknown }>,
): { stepId: string; ma: MaKetCucKhongRo; at: string } | null {
  const at = new Date().toISOString();
  const r = rows.find((x) => !x.stepId.startsWith("abort:") && loiLaKetCucKhongRo(x.error));
  if (r) return { stepId: r.stepId, ma: maKetCucKhongRoCua(r.error), at };
  const e = Object.entries(resume ?? {}).find(([, v]) => v?.state === "outcomeUnknown" || v?.khongRo === true);
  return e ? { stepId: e[0], ma: maKetCucKhongRoCua(typeof e[1]?.error === "string" ? e[1].error : null), at } : null;
}

/**
 * A2(n) extension — the steps the rows say may have gone out with no last word: the code on the row, or a row left running (a walk died around the hand-over; its result
 * row may even be there). Such a step is never labelled "not sent". Central's walk only: an edge's are in the resume state central derived. Pure.
 */
export function buocCoTheDaBayTuHang(rows: ReadonlyArray<{ stepId: string; status: string; error?: string | null }>): Set<string> {
  return new Set(rows.filter((r) => !r.stepId.startsWith("abort:") && (r.status === "running" || loiLaKetCucKhongRo(r.error))).map((r) => r.stepId));
}

/**
 * A2(n) (b) — /authorize's own check, a second line on the edge path (the walker's latch may have died with its memory): a compensation of a run latched by its
 * context OR its rows is refused unless a Continue that passed n3 approved exactly that step + compensation. A STOP never gets here (L-7). Pure.
 */
export function buTruBiChanKhongRo(ctx: Record<string, unknown> | null | undefined, rows: ReadonlyArray<{ stepId: string; error?: string | null }>, stepId: string, compId: string): boolean {
  return (runDaChotKhongRo(ctx) || chotTuHang(rows) !== null) && !daDuyetBuTruKhongRo(ctx, stepId, compId);
}

// ── the run's / step rows' texts ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The error of the held compensation's row and of the held run (the code first: a masked viewer keeps FOE_/EDGE_OUTCOME_UNKNOWN). */
export function loiGiuBuTruKhongRo(stepId: string, compId: string, stepError: string): string {
  const ma = maKetCucKhongRoCua(stepError);
  // m-K — a KNOWN failure held on a latched run does not say its own outcome is unknown
  const dau = loiLaKetCucKhongRo(stepError) ? `command "${stepId}" outcome unknown` : `step "${stepId}" failed; another command's outcome is unknown`;
  // data-raw-ok: machine-readable code first (the Studio / masked callers key on it); ids are the workflow's own
  return `${ma}: ${dau} — machine state unknown — compensation "${compId}" waiting for a person (it could not be confirmed as a STOP: NOT sent). Check the device, then Continue (sends only that compensation; a reason is required) or Abort.`;
}

// ── the URGENT alert ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * held — a compensation not confirmed as a STOP, held (nothing sent); stopSent — a STOP compensation the dispatcher accepted, not simulated;
 * stopSimulated — answered simulated: NOTHING reached the device (I-3); stopNotConfirmed — handed to the dispatcher, not confirmed;
 * stopNotHanded — never handed to a dispatcher (m-1); noCompensation — an unknown outcome with no compensation of its own (R-4);
 * approvedNotConfirmed — a compensation a Continue approved failed or got no answer (m-F); approvedNotSent — the same, nothing was handed over (its interlock, I-K);
 * failedNotSent — the run is FAILED, its compensation was not sent (m-C); compensationUnknown — a compensation's OWN outcome is unknown (I-I, m-P);
 * inFlight — `compId` was handed to a dispatcher before the run latched: it cannot be recalled (c);
 * forwardNotSent — A2(n) extension: `stepId` was refused at the sink and this walk told nobody of the latch (a STOP unknown on one attempt, confirmed on the next: nothing was split).
 */
export type LoaiCanhBaoKhongRo = "held" | "stopSent" | "stopSimulated" | "stopNotConfirmed" | "stopNotHanded" | "noCompensation" | "approvedNotConfirmed" | "approvedNotSent" | "failedNotSent" | "compensationUnknown" | "inFlight" | "forwardNotSent";
export const CANH_BAO_KHONG_RO_KIND: Readonly<Record<LoaiCanhBaoKhongRo, string>> = Object.freeze({
  held: "foe_outcome_unknown_compensation_held",
  stopSent: "foe_outcome_unknown_stop_compensation_sent",
  stopSimulated: "foe_outcome_unknown_stop_compensation_simulated",
  stopNotConfirmed: "foe_outcome_unknown_stop_compensation_unconfirmed",
  stopNotHanded: "foe_outcome_unknown_stop_compensation_not_handed",
  noCompensation: "foe_outcome_unknown_no_compensation",
  approvedNotConfirmed: "foe_outcome_unknown_approved_compensation_unconfirmed",
  approvedNotSent: "foe_outcome_unknown_approved_compensation_not_sent",
  failedNotSent: "foe_outcome_unknown_compensation_not_sent_run_failed",
  compensationUnknown: "foe_outcome_unknown_compensation_outcome_unknown",
  inFlight: "foe_outcome_unknown_write_in_flight_at_latch",
  forwardNotSent: "foe_outcome_unknown_forward_not_sent",
});
/** n2 — the words a person reads (critical-stop alerts carry raw text, they are not localised — as A2(m2)). */
export const CHO_NGUOI_TIEU_DE = "waiting for a person";
export const STOP_DA_GUI_TIEU_DE = "STOP compensation sent";
/** The compensation id of an alert about a step with none (R-4): the dedup key keeps its shape. */
export const KHONG_CO_BU_TRU = "-";

export interface CanhBaoKhongRo {
  loai: LoaiCanhBaoKhongRo;
  runId: number;
  stepId: string;
  compId: string;
  /** the failed step's error: ONLY its code reaches the alert (m-4 — a driver's host:port must not go to every admin) */
  error: string;
  /** the interruption / outcome event: in the dedup key AND the text (the durable dedup also matches kind + identical message) */
  lan: string;
  /** m-K — `stepId`'s own failure is KNOWN; the doubt is another command's (the run is latched) */
  biet?: boolean;
}

/** The alert of one event (pure; exported for the unit test). Dedup key `<kind>:<run>:<step>:<comp>:<event>`. */
export function noiDungCanhBaoKhongRo(a: CanhBaoKhongRo): { kind: string; title: string; message: string; dedupKey: string } {
  const kind = CANH_BAO_KHONG_RO_KIND[a.loai];
  const ma = maKetCucKhongRoCua(a.error);
  const dau = a.biet ? `step "${a.stepId}" failed; another command's outcome is unknown — machine state unknown` : `command "${a.stepId}" outcome unknown — machine state unknown`;
  const mo = a.biet
    ? `Step "${a.stepId}" of run ${a.runId} failed, but another command of this run has an UNKNOWN outcome (${ma}); the state of the machine is unknown.`
    : `The outcome of command step "${a.stepId}" of run ${a.runId} is UNKNOWN (${ma}); the state of the machine is unknown.`;
  const c = `"${a.compId}"`;
  const [duoi, than] = (
    {
      held: [`compensation ${c} ${CHO_NGUOI_TIEU_DE}`, `Its compensation ${c} could not be confirmed as a STOP, so it was NOT sent: the run is HELD and the compensation is ${CHO_NGUOI_TIEU_DE}. Check the device on site, then Continue (sends only that compensation; a reason is required) or Abort (sends the run's STOPs, no reason needed; no compensation that is not a STOP is sent).`],
      stopSent: [`${STOP_DA_GUI_TIEU_DE} (${c})`, `Its compensation ${c} is a STOP and was sent automatically (stopping never waits for a person): ${STOP_DA_GUI_TIEU_DE}. Check the machine state on site.`],
      stopSimulated: [`STOP compensation ${c} simulated — NOT sent (OT control off)`, `Its STOP compensation ${c} was only SIMULATED (OT control off): nothing reached the device. Check on site and use the machine's direct STOP / E-STOP if needed.`],
      stopNotConfirmed: [`STOP compensation ${c} sent but NOT confirmed`, `Its STOP compensation ${c} was handed to the dispatcher but NOT confirmed — check on site and use the machine's direct STOP / E-STOP if needed.`],
      stopNotHanded: [`STOP compensation ${c} NOT sent`, `Its STOP compensation ${c} was never handed to a dispatcher — check on site and use the machine's direct STOP / E-STOP if needed.`],
      noCompensation: [`no compensation of its own`, `It has no compensation of its own and it is never sent again; a compensation of a step around it may still be due. Check the device on site before running again.`],
      approvedNotConfirmed: [`compensation ${c} NOT confirmed`, `Its compensation ${c}, approved by a Continue, failed or got no answer: it may or may not have reached the device. Check the device on site and use the machine's direct STOP / E-STOP if needed.`],
      approvedNotSent: [`compensation ${c} NOT sent`, `Its compensation ${c}, approved by a Continue, was NOT sent: its interlock does not hold, or it was refused before the dispatcher. Nothing reached the device. Check the device on site and use the machine's direct STOP / E-STOP if needed.`],
      compensationUnknown: [`compensation ${c} outcome unknown`, `Its compensation ${c} went out and ITS outcome is unknown too, or an earlier segment may have sent it with no recorded result: it is never sent again. Check the device on site and use the machine's direct STOP / E-STOP if needed.`],
      inFlight: [`${c} in flight at latch time`, `Command ${c} was already handed to the dispatcher when this was decided: it cannot be recalled, and nothing says whether it reached the device. Check the machine on site.`],
      forwardNotSent: [`command NOT sent, forward work dropped`, `Command "${a.stepId}" was NOT handed to a dispatcher, and nothing further goes forward. Check the machine on site.`],
      failedNotSent: [`compensation ${c} NOT sent — run failed`, `The edge node stopped while run ${a.runId} was compensating. The run is FAILED and its compensation ${c} was NOT sent. Check the device on site and use the machine's direct STOP / E-STOP if needed.`],
    } satisfies Record<LoaiCanhBaoKhongRo, [string, string]>
  )[a.loai];
  return { kind, title: `Run ${a.runId}: ${dau} — ${duoi}`, message: `${mo} ${than} [event ${a.lan}]`, dedupKey: `${kind}:${a.runId}:${a.stepId}:${a.compId}:${a.lan}` };
}

/** The audit action of a URGENT that had nobody to go to (I-5 / condition 3): the durable trace, with the log line and the alert stream. */
export const KHONG_RO_KHONG_NGUOI_NHAN_AUDIT_OP = "foe_outcome_unknown_alert_no_recipient";
/** (c) — the audit operation of a write in flight at latch time. */
export const KHONG_RO_DANG_BAY_AUDIT_OP = "foe_outcome_unknown_in_flight_at_latch";

/**
 * Raise the URGENT alert of one event (central): the run owner + active admins / supervisors (bounded read; unreadable ⇒ the owner only),
 * the critical-stop alert's durable dedup per (person, key), retried until the inbox row lands (m-5: the DB trouble behind a timeout can eat it).
 * NOBODY to send it to (no owner, no active admin / supervisor, or the list unreadable) ⇒ still visible: raiseCriticalStopAlert's CRITICAL log
 * line + the critical anomaly on the alert stream (it publishes whatever the list), an explicit error line, and a durable audit row
 * (KHONG_RO_KHONG_NGUOI_NHAN_AUDIT_OP, action KET_CUC_KHONG_RO_AUDIT_ACTION). Bounded; never throws. Callers do not await it on a STOP's path.
 */
export async function canhBaoKetCucKhongRo(a: CanhBaoKhongRo & { owner: number | null; entityType?: string }): Promise<void> {
  try {
    let nguoi: number[] = [];
    try {
      const d = await getDb();
      if (d) {
        const rows = await withDeadline(
          Promise.resolve(d.select({ id: users.id }).from(users).where(and(eq(users.isActive, true), inArray(users.role, ["admin", "supervisor"] as never[])))),
          STOP_DB_STEP_DEADLINE_MS,
          `FOE run ${a.runId} outcome-unknown alert recipients`,
        );
        nguoi = rows.map((u) => Number(u.id));
      }
    } catch {
      /* the owner only */
    }
    const recipients = [...new Set([a.owner ?? 0, ...nguoi])].filter((u) => Number.isSafeInteger(u) && u > 0);
    const n = noiDungCanhBaoKhongRo(a);
    const { raiseCriticalStopAlert } = await import("../../robot/criticalStopAlert");
    await raiseCriticalStopAlert({ ...n, recipients, source: "ot", entityType: a.entityType ?? "orchestration_run", entityId: a.runId, khuTrungBenVung: {}, retryUntilPersisted: { everyMs: 30_000, attempts: 20 } });
    // (c) — what cannot be recalled is on the audit trail too, central's walk and an edge's report alike
    if (a.loai === "inFlight") await ghiAuditHeThongKhongRo(a.runId, { kind: n.kind, dedupKey: n.dedupKey, stepId: a.stepId, compId: a.compId }, KHONG_RO_DANG_BAY_AUDIT_OP, true);
    if (recipients.length === 0) {
      console.error(`[FOE] run ${a.runId}: outcome-unknown URGENT has NO recipient (no owner, no active admin / supervisor): ${n.title}`);
      await ghiAuditHeThongKhongRo(a.runId, { kind: n.kind, dedupKey: n.dedupKey, stepId: a.stepId, compId: a.compId });
    }
  } catch (err) {
    console.error(`[FOE] run ${a.runId}: outcome-unknown alert failed: ${(err as Error)?.message ?? err}`);
  }
}

// ── the edge mirror (n5): the edge walker has no database — it reports an anomaly, central raises the alert ──────────────────────────────

/** The anomaly code an EDGE walker journals for an A2(n) event (events stream → edgeReportsCentral → canhBaoTuAnomalyEdge). */
export const KHONG_RO_EDGE_ANOMALY = "FOE_OUTCOME_UNKNOWN_COMPENSATION";
export interface BaoCaoKhongRoEdge {
  loai: LoaiCanhBaoKhongRo;
  stepId: string;
  compId: string;
  /** the CODE only (m-4) */
  ma: MaKetCucKhongRo;
  claimSeq: number;
  /** m-K */
  biet?: boolean;
}
const LOAI_KHONG_RO: ReadonlySet<string> = new Set(Object.keys(CANH_BAO_KHONG_RO_KIND));
/** The anomaly's detail (≤ 1 000 characters, JSON: what central needs to raise the same alert; codes and ids only). */
export function chiTietAnomalyKhongRo(a: { loai: LoaiCanhBaoKhongRo; stepId: string; compId: string; error: string; claimSeq: number; biet?: boolean }): string {
  return JSON.stringify({ loai: a.loai, stepId: a.stepId.slice(0, 128), compId: a.compId.slice(0, 128), ma: maKetCucKhongRoCua(a.error), claimSeq: a.claimSeq, ...(a.biet ? { biet: true } : {}) } satisfies BaoCaoKhongRoEdge);
}
/** Central's reading of that detail; null ⇔ not one (the EDGE_ANOMALY audit still records it). */
export function docAnomalyKhongRo(detail: string | null | undefined): BaoCaoKhongRoEdge | null {
  try {
    const v = JSON.parse(String(detail ?? "")) as Record<string, unknown>;
    if (typeof v.loai !== "string" || !LOAI_KHONG_RO.has(v.loai) || typeof v.stepId !== "string" || typeof v.compId !== "string" || !Number.isSafeInteger(v.claimSeq)) return null;
    return { loai: v.loai as LoaiCanhBaoKhongRo, stepId: v.stepId, compId: v.compId, ma: v.ma === "EDGE_OUTCOME_UNKNOWN" ? v.ma : "FOE_OUTCOME_UNKNOWN", claimSeq: v.claimSeq as number, ...(v.biet === true ? { biet: true } : {}) };
  } catch {
    return null;
  }
}
/** I-5 — the same event for both edge routes (the anomaly and the segment end): the same dedup key, the same text ⇒ one inbox row. */
export function canhBaoTuBaoCaoEdge(runId: number, x: BaoCaoKhongRoEdge, owner: number | null): Promise<void> {
  return canhBaoKetCucKhongRo({ loai: x.loai, runId, stepId: x.stepId, compId: x.compId, error: x.ma, lan: `claim${x.claimSeq}`, owner, ...(x.biet ? { biet: true } : {}) });
}
/**
 * I-5, m-H — what central does with an EDGE anomaly: an A2(n) report of a run THIS node is assigned, that `kiem` finds valid (a claim of the run; a step of
 * the assigned definition paired with its own compensation) ⇒ the URGENT; anything else ⇒ nothing beyond the EDGE_ANOMALY audit its caller writes.
 * `kiem` answers the run's owner, or null when the report is not valid. true ⇔ an alert was raised. Never throws.
 */
export async function canhBaoTuAnomalyEdge(rec: { code: string; runId: number | null; detail?: string | null }, runCuaNode: boolean, kiem: (x: BaoCaoKhongRoEdge) => Promise<{ owner: number | null } | null>): Promise<boolean> {
  if (rec.code !== KHONG_RO_EDGE_ANOMALY || !runCuaNode || rec.runId == null) return false;
  const x = docAnomalyKhongRo(rec.detail);
  if (!x) return false;
  const hop = await kiem(x).catch(() => null);
  if (!hop) return false;
  void canhBaoTuBaoCaoEdge(rec.runId, x, hop.owner);
  return true;
}

const BAO_CAO_DAU = " [[A2N:";
const BAO_CAO_CUOI = "]]";
/**
 * I-5 — a full journal must not lose the URGENT: every report of a segment also rides on its end (`error`, the one free field of the strict
 * complete request — no protocol change), after the text, never cutting it. Central strips it (tachBaoCaoKhongRoEdge) before it stores the error.
 * M-2 — ALWAYS appended, even empty: the LAST rider is the edge's own, so text inside a device's error can never pose as one.
 */
export function ganBaoCaoKhongRoEdge(error: string | undefined, bao: readonly BaoCaoKhongRoEdge[], toiDa: number): string | undefined {
  const s = `${BAO_CAO_DAU}${JSON.stringify(bao)}${BAO_CAO_CUOI}`;
  if (s.length > toiDa) return error; // the anomalies are the first route; never a cut JSON
  return `${(error ?? "").slice(0, toiDa - s.length)}${s}`;
}
/** M-2 — `hopLe`: central's check of each report (this claim; a step / compensation of the assigned definition). */
export function tachBaoCaoKhongRoEdge(error: string | undefined, hopLe: (x: BaoCaoKhongRoEdge) => boolean = () => true): { error: string | undefined; bao: BaoCaoKhongRoEdge[] } {
  if (typeof error !== "string") return { error, bao: [] };
  const i = error.lastIndexOf(BAO_CAO_DAU);
  if (i < 0 || !error.endsWith(BAO_CAO_CUOI)) return { error, bao: [] };
  try {
    const v = JSON.parse(error.slice(i + BAO_CAO_DAU.length, -BAO_CAO_CUOI.length)) as unknown;
    const bao = Array.isArray(v) ? v.map((x) => docAnomalyKhongRo(JSON.stringify(x))).filter((x): x is BaoCaoKhongRoEdge => x !== null && hopLe(x)) : [];
    return { error: error.slice(0, i) || undefined, bao };
  } catch {
    return { error, bao: [] };
  }
}

// ── resume v1 (n3) ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const KET_CUC_KHONG_RO_AUDIT_ACTION = "foe_outcome_unknown_resolution";

/**
 * May `user` CONTINUE a run with a held outcome-unknown compensation, with `note`? The machine-control check of the router
 * (orchestrationRouter.resumeRun: actuationProcedure = ACTUATION_ROLES + 2FA, then requirePermission("machine_control", "canCreate")) —
 * re-located: the same role list and the same checkPermission, so the engine's own callers (system user 0, the FOE_DURABLE auto-resume, the QT
 * pump) are refused too. A REQUIRED reason (non-blank). Throws the refusal (FORBIDDEN / BAD_REQUEST) — before any state change.
 */
export async function xetTiepTucKetCucKhongRo(user: { id: number; role: string }, note: string | null | undefined): Promise<string> {
  const nguoiThat = Number.isSafeInteger(user.id) && user.id > 0;
  const { ACTUATION_ROLES } = await import("../../../_core/trpc");
  const vaiDuoc = (ACTUATION_ROLES as readonly string[]).includes(String(user.role));
  let quyen = false;
  if (nguoiThat && vaiDuoc) {
    const { checkPermission } = await import("../../../_core/accessControl");
    quyen = await checkPermission(user.id, String(user.role), "machine_control", "canCreate").catch(() => false);
  }
  if (!quyen) {
    throw appError(
      "FORBIDDEN",
      "PERMISSION_DENIED",
      { action: "canCreate" },
      "This run is held because a command's outcome is unknown: only a person with machine-control rights (engineer / supervisor / admin) may continue it.",
    );
  }
  const ly = (note ?? "").trim();
  if (!ly) {
    throw appError("BAD_REQUEST", "FIELD_REQUIRED", { field: "note" }, "A reason is required to continue a run held because a command's outcome is unknown (what you checked on the device).");
  }
  return ly;
}

/**
 * The audit row of a Continue / an Abort of such a held run (audit_logs; action is varchar(100), no enum ⇒ no migration). Bounded; never throws.
 * true ⇔ the row was written (logCrudOperation answers id -1 when it swallowed a failure). m-6 — a Continue is a person-gated WRITE: its caller
 * refuses when this is false (no write without its audit row). An Abort only logs it (R-1: no STOP waits on an audit).
 */
export async function ghiAuditKetCucKhongRo(user: { id: number; name?: string | null }, runId: number, op: "continue" | "abort", metadata: Record<string, unknown>, ok = true): Promise<boolean> {
  try {
    return await withDeadline(
      (async () => {
        const { logCrudOperation, createAuditContext } = await import("../../auditTrailService");
        const r = await logCrudOperation(createAuditContext({ user: { id: user.id, name: user.name ?? null } }), {
          action: KET_CUC_KHONG_RO_AUDIT_ACTION,
          entityType: "orchestration_run",
          entityId: runId,
          details: { operation: `foe_outcome_unknown_${op}`, metadata: { runId, ...metadata } },
          status: ok ? "success" : "failure",
        });
        return Number(r?.id) > 0;
      })(),
      5 * STOP_DB_STEP_DEADLINE_MS,
      `FOE run ${runId} outcome-unknown audit`,
    );
  } catch (err) {
    console.error(`[FOE] run ${runId}: outcome-unknown audit not written: ${(err as Error)?.message ?? err}`);
    return false;
  }
}

/** The audit row of a URGENT with nobody to go to, or (c) of a write in flight at latch time (system user). Bounded; never throws. */
async function ghiAuditHeThongKhongRo(runId: number, metadata: Record<string, unknown>, operation = KHONG_RO_KHONG_NGUOI_NHAN_AUDIT_OP, ok = false): Promise<void> {
  try {
    await withDeadline(
      (async () => {
        const { logCrudOperation, createAuditContext } = await import("../../auditTrailService");
        await logCrudOperation(createAuditContext({ user: { id: 0, name: "FOE" } }), {
          action: KET_CUC_KHONG_RO_AUDIT_ACTION,
          entityType: "orchestration_run",
          entityId: runId,
          details: { operation, metadata: { runId, ...metadata } },
          status: ok ? "success" : "failure",
        });
      })(),
      5 * STOP_DB_STEP_DEADLINE_MS,
      `FOE run ${runId} outcome-unknown no-recipient audit`,
    );
  } catch (err) {
    console.error(`[FOE] run ${runId}: outcome-unknown no-recipient audit not written: ${(err as Error)?.message ?? err}`);
  }
}
