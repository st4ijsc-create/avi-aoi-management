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
 * STATE C (T5, decisions 2, A, C, H1) — on a latched run a stop-typed step that nobody could decide, or that was refused with a clear answer, stays OWED (FOE_STOP_NOT_SENT): not "not sent, final". Pins
 * unreadable is not "not pinned": it goes by the marked route (a fresh marked row; on an edge no authorisation at all), so only the dispatcher's own verdict sends it. One layer at foeEngine.execCommand
 * (lopChuaRa), whatever said no; a robot's budget stays its own. The row carries it (foeRunStore.stopChuaRaTuHang), it is not settled, the run ends held, an Abort sends it. Not state C: a read that
 * answered "not pinned", a non-STOP, an attempt with no answer (the last word decides; "may have gone out" is H2).
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
import { napMotLan } from "./foeNapMotLan";
import { ABORT_RESEND_WINDOW_MS } from "@shared/foeAbortResend"; // T7b-1 fix 1 — the words name the window the engine applies

const napCanhBao = napMotLan(() => import("../../robot/criticalStopAlert"));
const napAudit = napMotLan(() => import("../../auditTrailService"));
const napQuyen = napMotLan(() => import("../../../_core/accessControl"));

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
 * A2(n) T7 (decision 1, plan point 4) — run-context key (central-written, by the end gate foeRunStore.quyetDinhKetThucAnh): { stepId, at }. A durable URGENT about this run's latch exists: a later end
 * of the run needs no new one. Never written by an edge (edgeContextPolicy keeps central keys out). Absent ⇔ the obligation stands (the scan of T12 reads it).
 */
export const KET_CUC_KHONG_RO_DA_BAO_CTX_KEY = "foeKetCucKhongRoDaBao";
/**
 * A2(n) T7b-1 (no-cho-T7b, DUYỆT) — run-context key (central-written, by the walk: foeEngine.datChuaRa, persisted with the context, the `held` write of the end gate too): the STOPs this run's
 * walk left in state C, ids only. The debt is the rows' AND this (foeRunStore.stopChuaRaTuHang): a row in state C is a bounded write and may be the one lost. It only ADDS evidence of a debt; it
 * never clears one a row names. Never written by an edge (edgeContextPolicy keeps central keys out).
 */
export const STOP_CHUA_RA_CTX_KEY = "foeStopChuaRa";
/**
 * A2(n) T7b-1d (H22) — what an Abort left of a STOP it tried or meant to send and that did not go, on its `abort:` row (result.abortStop). `daThu`: handed over and refused. `chuaXacMinh`: it could not verify it as a
 * pinned STOP, so it did not send it. `chuaTraLoi`: handed over, no answer yet. foeRunStore.dauVetAbort reads it.
 */
export type DangDauVetAbort = "daThu" | "chuaXacMinh" | "chuaTraLoi";
/** The ids the context holds owed (a value that is not a list of ids is none). Pure. */
export function stopChuaRaTuNguCanh(ctx: Record<string, unknown> | null | undefined): string[] {
  const v = ctx?.[STOP_CHUA_RA_CTX_KEY];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
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
 * A2(n) T1 — what the evidence says about one step after the latch. "chuaGui" only when proven; "chuaDen" = nothing says it started; "giuNguyen" = a known last word stays as it is;
 * "coTheDaGui" = no last word, the safe side. Table: bang-ca-f12.md.
 */
export type NhanSauChot = "xong" | "coTheDaGui" | "chuaGui" | "chuaDen" | "giuNguyen";
export interface BangChungBuoc {
  /** the row's status; null ⇔ no row */
  status: string | null;
  error?: string | null;
  routedTo: boolean;
  /** the latch's own step, an unknown this walk decided, or a state central derived */
  khongRo: boolean;
  /** foeDispatchedSteps, or handed over in this walk */
  daGiao: boolean;
  /** edge: an authorisation neither reported nor superseded */
  uyQuyenSong: boolean;
  /** A2(n) T5 (H16): the row says only what an edge reported, central could not verify it: no last word, whatever its status */
  khongXacNhan?: boolean;
}
/** The prefix foeRunStore.loiKhongGuiChot writes. Spelled here: foeRunStore imports this module, a pure function must not pull the store in. F12-11 builds its row with the writer. */
const DAU_KHONG_GUI_CHOT = "FOE_NOT_SENT_RUN_LATCHED:";

export function nhanBuocSauChot(x: BangChungBuoc): NhanSauChot {
  if (x.khongXacNhan) return "coTheDaGui";
  if (x.status === "completed" || x.status === "compensated") return "xong";
  const khongRo = x.khongRo || loiLaKetCucKhongRo(x.error);
  if (x.status === "skipped") return khongRo ? "coTheDaGui" : "xong"; // N-1: a skip an old walk wrote over an unknown is no last word on it
  if (khongRo) return "coTheDaGui";
  const dauVet = x.routedTo || x.daGiao || x.uyQuyenSong;
  if (x.status === "failed" && typeof x.error === "string" && x.error.startsWith(DAU_KHONG_GUI_CHOT)) return dauVet ? "coTheDaGui" : "chuaGui";
  if (x.status === "held") return dauVet ? "giuNguyen" : "chuaGui"; // held at a gate of the walk, nothing handed over
  if (x.status === "failed") return "giuNguyen"; // a device's own error, FOE_OUTCOME_PARTIAL, a known refusal: never overwritten
  if (x.status !== null) return "coTheDaGui"; // running is written BEFORE the hand-over and proves nothing either way; pending, queued, awaiting_confirm: no row says it stayed unsent (N-1)
  return dauVet ? "coTheDaGui" : "chuaDen";
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
 * forwardNotSent — A2(n) extension, T6 (H13): `stepId` is the first command not sent of a branch the latched walk dropped, one per branch (BUOC_KHONG_XAC_DINH: the evidence could not be read);
 * runEnd — A2(n) T2: the one URGENT of a latched run's end, `stepId` = the latch step, under the fixed event "chot". Check on site (H2): by then Abort may answer "already terminal";
 * stopUntakenBranch — A2(n) M1: `stepId` is a STOP in a branch the run never evaluated: listed, never sent, under the fixed event "chot";
 * stopNotSent — A2(n) T5, state C: a STOP that stays owed (`vi` says why): the run is held so an Abort can send it. A forward STOP: `stepId` is the STOP, `compId` "-"; a compensation: its owner and the STOP;
 * stopKhongXacNhanDoc — A2(n) T5 (H16): an edge reports this STOP handed over, central could not read its pins to verify it. No confirmation;
 * stopGhimLech — A2(n) T5 (H16): an edge reports it handed over, central read the pins and they differ: what went out may not have been a STOP.
 * stopGhimLechChuaGui — A2(n) T6d (dieu-phoi 08/11 T6d-K1, E-C6): central verified a pinned STOP, the edge dispatcher's snapshot said "not pinned" and refused it before any driver: NOT sent.
 *   Not state C (H1's exception "read, not pinned"), no word that an Abort sends it: it would not.
 * abortStopNotSent — A2(n) T7b-1 (5a, B2, H1, C4): an Abort of a latched run handed `stepId` (a STOP, `compId` "-") over and it was refused or got no answer: the run is aborted, the STOP stays owed on
 *   its `abort:` row, and a person presses Abort again, with no time limit (the background only repeats this URGENT). Never "it went".
 * stopEndedUnswept — A2(n) T7b-3 (H36, chu du an 10/11): a run that acted and never latched ended (`ketThuc`) with no STOP sweep, and `stepId` is a pinned STOP still owed by the sweep's own reading
 *   (`stopKhongXacMinh`: its pins could not be read; BUOC_KHONG_XAC_DINH: the records could not be read). Nothing is sent: a person checks the machine. Under the fixed event "ket". No command has an unknown outcome.
 */
export type LoaiCanhBaoKhongRo = "abortDefUnread" | "abortSweepUnfinished" | "abortStopNotSent" | "stopKhongXacNhanDoc" | "stopGhimLech" | "held" | "stopSent" | "stopSimulated" | "stopNotConfirmed" | "stopNotHanded" | "noCompensation" | "approvedNotConfirmed" | "approvedNotSent" | "failedNotSent" | "compensationUnknown" | "inFlight" | "forwardNotSent" | "runEnd" | "stopUntakenBranch" | "stopNotSent" | "stopGhimLechChuaGui" | "stopEndedUnswept";
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
  runEnd: "foe_outcome_unknown_run_end",
  stopUntakenBranch: "foe_outcome_unknown_stop_untaken_branch",
  stopNotSent: "foe_outcome_unknown_stop_not_sent",
  stopKhongXacNhanDoc: "foe_outcome_unknown_stop_unconfirmed_read",
  stopGhimLech: "foe_outcome_unknown_stop_pin_mismatch",
  stopGhimLechChuaGui: "foe_outcome_unknown_stop_pin_mismatch_not_sent",
  abortStopNotSent: "foe_outcome_unknown_abort_stop_not_sent",
  abortDefUnread: "foe_outcome_unknown_abort_definition_unread",
  abortSweepUnfinished: "foe_outcome_unknown_abort_sweep_unfinished",
  stopEndedUnswept: "foe_outcome_unknown_stop_ended_unswept",
});
/** n2 — the words a person reads (critical-stop alerts carry raw text, they are not localised — as A2(m2)). */
export const CHO_NGUOI_TIEU_DE = "waiting for a person";
export const STOP_DA_GUI_TIEU_DE = "STOP compensation sent";
/** The compensation id of an alert about a step with none (R-4): the dedup key keeps its shape. */
export const KHONG_CO_BU_TRU = "-";
/** A2(n) T6 (H13) — the step of a forwardNotSent whose evidence could not be read: which command was dropped is not known, and the words say so. Central's own walk only. */
export const BUOC_KHONG_XAC_DINH = "?";

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
  /** A2(n) T5 — stopNotSent: why. A code, never a driver's text */
  vi?: ViChuaRa;
  /** A2(n) T6e K1 (dieu-phoi 08/11 T6e-K1, A) — forwardNotSent: a stop-typed step whose pin the STOP sweep could not verify (central's own walk only) */
  stopKhongXacMinh?: true;
  /** A2(n) T7b-1c — abortStopNotSent: the words of THE classification (chuStopAbort) */
  chuAbort?: ChuStopAbort;
  /** A2(n) T7b-3 (H36) — stopEndedUnswept: how the run ended (`completed`: with a step of it failed) */
  ketThuc?: KetThucKhongQuet;
}

/** A2(n) T7b-3 (H36) — the terminal statuses of a run that ends with no STOP sweep */
export type KetThucKhongQuet = "aborted" | "failed" | "completed";
/** A2(n) T7b-3 (H36) — what such a run still owes, by the sweep's own reading (foeEngine.noKetThucKhongQuet): pinned STOPs; stop-typed steps whose pins could not be read; or the records could not be read at all */
export interface NoKetThucKhongQuet {
  ketThuc: KetThucKhongQuet;
  ghim: readonly string[];
  chuaXacMinh: readonly string[];
  khongDoc: boolean;
}
/** H36 — how the run ended, in words true of every source: no claim of who or what ended it */
const cachKetThuc = (ket: KetThucKhongQuet): string => (ket === "completed" ? "ended completed although a step of it failed" : `ended ${ket}`);
/**
 * H36 — what a press of Abort can do on such a run, said as it is. Aborted: a press in the window may send it (measured, r2), an upper limit from MOC_CUA_SO, never a promise. Failed / completed: Abort answers
 * "already terminal" and sends nothing, so no word suggests it does.
 */
function chuBamSauKetThuc(ket: KetThucKhongQuet, nhieu: boolean): string {
  const no = nhieu ? "them" : "it";
  return ket === "aborted"
    ? `A press of Abort within ${Math.round(ABORT_RESEND_WINDOW_MS / 60_000)} minutes of ${MOC_CUA_SO} may send ${no}, but may not reach ${no}: none is promised.`
    : `Abort cannot reach a run that has ${cachKetThuc(ket)} (it answers "already terminal"), so no press sends ${no}.`;
}
/** A2(n) T7b-3 (H36) — the words of the URGENT: the STOP by name, NOT sent, the machine on site, and what a press can do (chuBamSauKetThuc). Nothing of the run has an unknown outcome, and no word says so. */
function chuKetThucKhongQuet(a: Pick<CanhBaoKhongRo, "runId" | "stepId" | "stopKhongXacMinh" | "ketThuc">): [string, string] {
  const ket = a.ketThuc ?? "failed";
  const dau = `Run ${a.runId} ${cachKetThuc(ket)}, and no STOP sweep ran at that end`;
  const tay = "Check the machine on site and use its direct STOP / E-STOP.";
  if (a.stepId === BUOC_KHONG_XAC_DINH) return [`the run ${cachKetThuc(ket)}, which STOP steps were NOT sent could not be told`, `${dau}. Its records could not be read, so which STOP steps of it were NOT sent cannot be told. ${tay} ${chuBamSauKetThuc(ket, true)}`];
  if (a.stopKhongXacMinh) return [`step "${a.stepId}" NOT sent: the run ${cachKetThuc(ket)}, not verified as a pinned STOP`, `${dau}: step "${a.stepId}" could not be verified as a pinned STOP, so it was NOT sent. ${tay} ${chuBamSauKetThuc(ket, false)}`];
  return [`STOP "${a.stepId}" NOT sent: the run ${cachKetThuc(ket)} with no STOP sweep`, `${dau}: its STOP "${a.stepId}" was NOT sent. ${tay} ${chuBamSauKetThuc(ket, false)}`];
}
/**
 * A2(n) T7b-3 (H36, brief point 3) — the answer to a press of Abort on a run that has ended `failed` / `completed` and still owes a STOP by the same reading as its URGENT: the STOPs by name, nothing sent, the machine
 * on site, no promise. "already terminal" stays: the Studio and the callers key on it. Pure.
 */
export function chuBamDaKetThuc(runId: number, no: NoKetThucKhongQuet): string {
  const ten = (ds: readonly string[]) => ds.map((id) => `"${id}"`).join(", ");
  const cau: string[] = [];
  if (no.khongDoc) cau.push("Its records could not be read, so whether a STOP step of it was NOT sent when it ended cannot be told.");
  if (no.ghim.length) cau.push(`STOP steps NOT sent when it ended: ${ten(no.ghim)}.`);
  if (no.chuaXacMinh.length) cau.push(`Could not be verified as a pinned STOP, NOT sent when it ended: ${ten(no.chuaXacMinh)}.`);
  return `Run ${runId} already terminal (${no.ketThuc}). ${cau.join(" ")} This press sends nothing: Abort cannot reach a run that has ${cachKetThuc(no.ketThuc)}. Check the machine on site and use its direct STOP / E-STOP.`;
}

/**
 * A2(n) T7b-1c (dieu-phoi 09/11) — THE classes of a STOP at an Abort of a latched run (foeRunStore.phanLoaiStopAbort). `truoc`: class `no` only, what its rows say of a hand-over before the debt: the words read
 * it, what goes never does. `khoaThu`: class `coTheDaRa` only, the attempt whose key it goes under.
 */
export type LopStopAbort = "chuaGiao" | "no" | "coTheDaRa" | "daGiao" | "xong" | "khongDoc";
export interface PhanLoaiStopAbort {
  lop: LopStopAbort;
  /** T7b-1d — `chuaXacMinh`: the trace of an Abort that could not verify it, it never handed it over. Only the words read this */
  truoc?: "coTheDaRa" | "daGiao" | "chuaXacMinh";
  khoaThu?: number;
}
export type ChuStopAbort = "chuaRaKhongHan" | "chuaRa15" | "coTheKhongHan" | "coThe15" | "daGiaoKhongHan" | "daGiaoKiemMay" | "khongDocKhongHan" | "khongDoc15" | "khongXacMinhKhongHan" | "khongXacMinh15" | "daKetThuc" | "daKetThucChuaKhoa" | "daKetThucKhongXacMinh";
/** A2(n) T7b-1c — which words a STOP gets whose hand-over by this Abort did not go: its class, and whether its debt is durable ("no time limit" only then). `xong`: nothing to say. Pure. */
export function chuStopAbort(p: Pick<PhanLoaiStopAbort, "lop" | "truoc">, ben: boolean): ChuStopAbort | null {
  if (p.lop === "xong") return null;
  const goc = p.truoc ?? p.lop;
  if (goc === "chuaXacMinh") return ben ? "khongXacMinhKhongHan" : "khongXacMinh15";
  if (goc === "coTheDaRa") return ben ? "coTheKhongHan" : "coThe15";
  if (goc === "daGiao") return ben ? "daGiaoKhongHan" : "daGiaoKiemMay";
  if (goc === "khongDoc") return ben ? "khongDocKhongHan" : "khongDoc15";
  return ben ? "chuaRaKhongHan" : "chuaRa15";
}

/**
 * T7b-1d lượt sửa 4 (H34, dieu-phoi 10/11) — where the window of a press starts, as the code counts it: the run's `finishedAt` (abortResendAllowed), written by the Abort, or by the rejection of a gate that aborted the
 * run (rejectGate). Every word that names the 15 minutes names this start
 * T7b-1d lượt sửa 5 (F-1, dieu-phoi 10/11) — and by every other writer of 'aborted': a precondition that aborts (finishWalk), an edge's end applied by central (applyEdgeSegmentEnd), the walker that lost its
 * write to an Abort. The words name what they share, never one of them
 */
export const MOC_CUA_SO = "when the run was aborted";

/** T7b-1d lượt sửa 2 (H32) — what a later press can do when a read failed: it may send, it may not reach it (P2-Y: a container ended in another step's words), and the window is an upper limit, never a promise (as H28). */
export function chuBamSauKhongDoc(): string {
  return `A further press of Abort may send it but may not reach it, and none can be counted on after ${Math.round(ABORT_RESEND_WINDOW_MS / 60_000)} minutes from ${MOC_CUA_SO}`;
}

/** A2(n) T7b-1c (dieu-phoi 09/11) — an Abort of a run that could not read its definition: no step to name, and the 15 minutes do not stretch. The URGENT and the answer say the same. T7b-1d lượt sửa 2 — no press promised: chuBamSauKhongDoc. */
export function chuKhongDocDinhNghia(runId: number): string {
  return `The system could not read the definition of run ${runId}, so which STOP steps are due is not known and a STOP may still not be out. Check the machine on site and use its direct STOP / E-STOP if needed. ${chuBamSauKhongDoc()}.`;
}

/** A2(n) T7b-1d lượt sửa 2 (H32) — a sweep past its ceiling: nothing here was refused or unread, it has simply not answered. It goes on behind this: a STOP may be out already or may yet go. No step to name: no second picture of a sweep for this. The URGENT and the answer say the same. */
export function chuQuetChuaXong(runId: number): string {
  return `The STOP sweep of run ${runId} has not finished and is still running: STOP steps of this run may have gone out or may still go, which ones is not known, and nothing confirms them yet. Check the machine on site and use its direct STOP / E-STOP if needed. Abort can be pressed again.`;
}

/** The STOP of state C, as the words name it. */
const stopCua = (a: Pick<CanhBaoKhongRo, "stepId" | "compId">): string => (a.compId === KHONG_CO_BU_TRU ? a.stepId : a.compId);

/** A2(n) T5 (H11) — the two sides of the words of state C: true of the source. "did NOT go out" only where nothing reached a driver; "once the read recovers" only where a read failed. */
function chuStopChuaRa(a: Pick<CanhBaoKhongRo, "stepId" | "compId" | "vi">): [string, string] {
  const id = `"${stopCua(a)}"`;
  // T5 fix 1 — never "the run is held": on an edge this is told before central's run row can say so
  const giu = "It stays owed";
  const tay = "Use the machine's direct STOP / E-STOP if needed";
  if (a.vi?.nguon === "driverLoi") return [`STOP ${id} NOT confirmed out`, `STOP ${id} is not confirmed out: it may have reached the device (${a.vi.ma}). ${giu}: Abort sends it again. ${tay}.`];
  if (a.vi?.nguon === "tuChoi") return [`STOP ${id} did NOT go out`, `STOP ${id} did NOT go out: it was refused before it reached a driver (${a.vi.ma}). ${giu}: Abort sends it again. ${tay}.`];
  const ma = a.vi ? ` (${a.vi.ma})` : "";
  return [`STOP ${id} did NOT go out`, `STOP ${id} did NOT go out: nobody could read its pins${ma}. ${giu}: if it is a pinned STOP, Abort sends it once the read recovers; if it is not, nothing is sent. ${tay}.`];
}

/**
 * A2(n) T7b-1 — the words of a STOP an Abort handed over and that did not go: true of the source (H11), never "it went". T7b-1c — they read THE classification (chuStopAbort): "no time limit" (B2) only where the
 * debt is durable; "did NOT go out" never of a STOP that may have gone (coTheDaRa), was handed over (daGiao) or whose rows could not be read (khongDoc). Not durable: within the window a press still sends it, past
 * it nothing can; one a dispatcher took is not handed over again (H3).
 */
function chuAbortChuaRa(a: Pick<CanhBaoKhongRo, "stepId" | "compId" | "vi" | "chuAbort">): [string, string] {
  const id = `"${stopCua(a)}"`;
  const ma = a.vi ? ` (${a.vi.ma})` : "";
  const tay = "use the machine's direct STOP / E-STOP";
  const chu = a.chuAbort ?? "chuaRaKhongHan";
  // T7b-1d lượt sửa 3 (F1, dieu-phoi 10/11, (a)) — "no time limit" is of the debt while it stands. A press that reads it as no pinned STOP ends it (C-CLR); a pin set again after that is sent only within the window of the Abort (H31):
  // the upper limit is said, nothing is promised past it. One key, as before
  const khongHan = `It stays owed: press Abort again, there is no time limit on this STOP. Until then ${tay}. If a press finds it not pinned, nothing is sent, and a pin set again after that press is sent only by a press within ${Math.round(ABORT_RESEND_WINDOW_MS / 60_000)} minutes of ${MOC_CUA_SO}: past that, check the machine on site and use its direct STOP / E-STOP.`;
  // H28 (dieu-phoi 09/11) — a debt durable nowhere: a press may send it (the body of a container: it does) or may not reach it (a compensation not due): no promise, no minutes
  const han = `This could not be recorded: a further press of Abort may send it, but may not reach it: check the machine on site and ${tay}.`;
  // T7b-1c (RC12b, dieu-phoi 09/11) — the run reached another end before this Abort's write: a press cannot reach it ("already terminal"), so none is promised
  // T7b-1d (H26) — a run that never latched, the pins unreadable at its other end: listed and told, no marked route, and no word that calls a step a STOP nobody could verify
  if (chu === "daKetThucKhongXacMinh") return [`run has ended, step ${id} NOT sent`, `The run has ended on its own, before this Abort. Step ${id} could not be verified as a pinned STOP, so it was NOT sent, and a further Abort may not reach it: check the machine on site and ${tay}.`];
  if (chu === "daKetThuc" || chu === "daKetThucChuaKhoa") return [`run has ended, STOP ${id} NOT confirmed out`, `The run has ended on its own, before this Abort. Its STOP ${id} was refused or got no answer when the Abort handed it over${ma}: it may or may not have reached the device, and a further Abort may not reach it: check the machine on site and ${tay}.`];
  if (chu === "daGiaoKhongHan" || chu === "daGiaoKiemMay") return [`run aborted, STOP ${id} NOT confirmed`, `The run is aborted. Its STOP ${id} was handed over earlier and never confirmed; the Abort's new hand-over was refused or got no answer${ma}. ${chu === "daGiaoKhongHan" ? khongHan : `This could not be recorded and it is not sent again: check the machine on site and ${tay}.`}`];
  if (chu === "coTheKhongHan" || chu === "coThe15") return [`run aborted, STOP ${id} may have gone out`, `The run is aborted. Its STOP ${id} was handed over earlier with no answer, so it may have gone out: check the machine on site. The Abort's new hand-over was refused or got no answer${ma}. ${chu === "coTheKhongHan" ? khongHan : han}`];
  if (chu === "khongDocKhongHan" || chu === "khongDoc15") return [`run aborted, STOP ${id}: its records could not be read`, `The run is aborted. Its records could not be read, so whether STOP ${id} went earlier is not known: check the machine on site. The Abort's hand-over was refused or got no answer${ma}. ${chu === "khongDocKhongHan" ? khongHan : han}`];
  // T7b-1d (H22, KS-UNV) — the Abort never handed it over: not "refused", and a press sends it only if its read finds a pinned STOP
  if (chu === "khongXacMinhKhongHan" || chu === "khongXacMinh15") return [`run aborted, step ${id} NOT sent: not verified as a pinned STOP`, `The run is aborted. The Abort could not verify step ${id} as a pinned STOP and did NOT send it. ${chu === "khongXacMinhKhongHan" ? khongHan : `${han} If a press finds it not pinned, nothing is sent.`}`];
  const sau = chu === "chuaRaKhongHan" ? khongHan : han;
  if (a.vi?.nguon === "tuChoi") return [`run aborted, STOP ${id} did NOT go out`, `The run is aborted, but its STOP ${id} was refused before it reached a driver${ma}. ${sau}`];
  return [`run aborted, STOP ${id} NOT confirmed out`, `The run is aborted, but its STOP ${id} was refused or got no answer when the Abort handed it over${ma}: it may or may not have reached the device. ${sau}`];
}

/** The alert of one event (pure; exported for the unit test). Dedup key `<kind>:<run>:<step>:<comp>:<event>`. */
export function noiDungCanhBaoKhongRo(a: CanhBaoKhongRo): { kind: string; title: string; message: string; dedupKey: string } {
  const kind = CANH_BAO_KHONG_RO_KIND[a.loai];
  const ma = maKetCucKhongRoCua(a.error);
  const khongXd = a.loai === "forwardNotSent" && a.stepId === BUOC_KHONG_XAC_DINH; // T6 — no step to name
  const nhanh = a.loai === "stopUntakenBranch" || a.loai === "abortDefUnread" || a.loai === "abortSweepUnfinished" || khongXd || (a.loai === "abortStopNotSent" && (a.chuAbort === "khongXacMinhKhongHan" || a.chuAbort === "khongXacMinh15")); // `stepId` is the listed STOP: nothing happened to it
  // T7b-1d (H26) — a run that never latched and reached another end: no command of it has an unknown outcome, so no word says one has
  // T7b-3 (H36) — the same for a run that ended with no sweep and never latched
  const khongChot = (a.loai === "abortStopNotSent" && (a.chuAbort === "daKetThucChuaKhoa" || a.chuAbort === "daKetThucKhongXacMinh")) || a.loai === "stopEndedUnswept";
  const dau = nhanh ? `another command's outcome is unknown — machine state unknown` : a.biet ? `step "${a.stepId}" failed; another command's outcome is unknown — machine state unknown` : `command "${a.stepId}" outcome unknown — machine state unknown`;
  const mo = nhanh
    ? `A command of run ${a.runId} has an UNKNOWN outcome (${ma}); the state of the machine is unknown.`
    : a.biet
      ? `Step "${a.stepId}" of run ${a.runId} failed, but another command of this run has an UNKNOWN outcome (${ma}); the state of the machine is unknown.`
      : `The outcome of command step "${a.stepId}" of run ${a.runId} is UNKNOWN (${ma}); the state of the machine is unknown.`;
  const c = `"${a.compId}"`;
  const [duoi, than] = (
    {
      held: [`compensation ${c} ${CHO_NGUOI_TIEU_DE}`, `Its compensation ${c} could not be confirmed as a STOP, so it was NOT sent: the run is HELD and the compensation is ${CHO_NGUOI_TIEU_DE}. Check the device on site, then Continue (sends only that compensation; a reason is required) or Abort (sends the run's STOPs, no reason needed; no compensation that is not a STOP is sent).`],
      stopSent: [`${STOP_DA_GUI_TIEU_DE} (${c})`, `Its compensation ${c} is a STOP and was sent automatically (stopping never waits for a person): ${STOP_DA_GUI_TIEU_DE}. Check the machine state on site.`],
      stopSimulated: [`STOP compensation ${c} simulated — NOT sent (OT control off)`, `Its STOP compensation ${c} was only SIMULATED (OT control off): nothing reached the device. Check on site and use the machine's direct STOP / E-STOP if needed.`],
      stopNotConfirmed: [`STOP compensation ${c} handed over, NOT confirmed`, `Its STOP compensation ${c} was handed to the dispatcher but could not be confirmed: check the machine on site and use its direct STOP / E-STOP if needed.`],
      stopNotHanded: [`STOP compensation ${c} NOT sent`, `Its STOP compensation ${c} was never handed to a dispatcher — check on site and use the machine's direct STOP / E-STOP if needed.`],
      noCompensation: [`no compensation of its own`, `It has no compensation of its own and it is never sent again; a compensation of a step around it may still be due. Check the device on site before running again.`],
      approvedNotConfirmed: [`compensation ${c} NOT confirmed`, `Its compensation ${c}, approved by a Continue, failed or got no answer: it may or may not have reached the device. Check the device on site and use the machine's direct STOP / E-STOP if needed.`],
      approvedNotSent: [`compensation ${c} NOT sent`, `Its compensation ${c}, approved by a Continue, was NOT sent: its interlock does not hold, or it was refused before the dispatcher. Nothing reached the device. Check the device on site and use the machine's direct STOP / E-STOP if needed.`],
      compensationUnknown: [`compensation ${c} outcome unknown`, `Its compensation ${c} went out and ITS outcome is unknown too, or an earlier segment may have sent it with no recorded result: it is never sent again. Check the device on site and use the machine's direct STOP / E-STOP if needed.`],
      inFlight: [`${c} in flight at latch time`, `Command ${c} was already handed to the dispatcher when this was decided: it cannot be recalled, and nothing says whether it reached the device. Check the machine on site.`],
      forwardNotSent: khongXd
        ? [`forward work dropped, which command could not be determined`, `Forward work of this run was dropped, and which command was not sent could not be determined: the step records could not be read. Any command of this run may or may not have reached the device, and nothing further goes forward. Check the machine on site.`]
        : a.vi
          ? // T6c (Q2) — handed to its dispatcher on the marked route, answered "no pinned STOP" before any driver: nothing written (H11, true of the source)
            [`command NOT sent, forward work dropped`, `Command "${a.stepId}" was refused by its dispatcher before any driver (${a.vi.ma}): it is no pinned STOP, nothing was written, and nothing further goes forward. Check the machine on site.`]
          : a.stopKhongXacMinh
            ? // T6e K1 (A) — the pins read at two moments: the dispatcher's predicate said pinned, the sweep could not verify it. Not sent, no Abort promised (it is no state C)
              [`STOP-typed step "${a.stepId}" NOT sent: the STOP sweep could not verify its pin`, `Step "${a.stepId}" is a STOP-typed command, but the STOP sweep could not verify it as a pinned STOP, so it was NOT sent, and nothing further goes forward. Check the machine on site and use its direct STOP / E-STOP if needed.`]
            : [`command NOT sent, forward work dropped`, `Command "${a.stepId}" was NOT handed to a dispatcher, and nothing further goes forward. Check the machine on site.`],
      runEnd: [`nothing further goes forward, check the machine on site`, `The run has ended or is waiting; nothing further goes forward. A STOP this run sent, if any, could not be confirmed: check the machine on site and use its direct STOP / E-STOP if needed.`],
      stopUntakenBranch: [`STOP "${a.stepId}" in a branch never taken: NOT sent`, `STOP step "${a.stepId}" sits in a branch this run never evaluated, so it was NOT sent. Check the machine on site and use its direct STOP / E-STOP if needed.`],
      stopNotSent: chuStopChuaRa(a),
      stopKhongXacNhanDoc: [`STOP "${stopCua(a)}" reported sent, NOT confirmed`, `The edge node reports STOP "${stopCua(a)}" handed over, and central could not read its pins to verify it: this is no confirmation. Check the machine on site and use its direct STOP / E-STOP if needed.`],
      stopGhimLech: [`STOP "${stopCua(a)}": the pins differ, what went out may not be a STOP`, `The edge node reports step "${stopCua(a)}" handed over as a STOP, but the pins central reads do not match it: what went out may not have been a STOP. Check the machine on site and use its direct STOP / E-STOP.`],
      stopGhimLechChuaGui: [`STOP "${stopCua(a)}" NOT sent: the edge snapshot says it is not pinned`, `Central verified step "${stopCua(a)}" as a pinned STOP, but the edge node's dispatcher snapshot says it is not pinned: it was refused before any driver, so the STOP was NOT sent. Check the machine on site and use its direct STOP / E-STOP if needed.`],
      abortStopNotSent: chuAbortChuaRa(a),
      abortDefUnread: [`definition of the run unread, a STOP may still not be out`, chuKhongDocDinhNghia(a.runId)],
      abortSweepUnfinished: [`STOP sweep has not finished, a STOP may have gone out or may still go`, chuQuetChuaXong(a.runId)],
      stopEndedUnswept: chuKetThucKhongQuet(a),
      failedNotSent: [`compensation ${c} NOT sent — run failed`, `The edge node stopped while run ${a.runId} was compensating. The run is FAILED and its compensation ${c} was NOT sent. Check the device on site and use the machine's direct STOP / E-STOP if needed.`],
    } satisfies Record<LoaiCanhBaoKhongRo, [string, string]>
  )[a.loai];
  return { kind, title: khongChot ? `Run ${a.runId}: ${duoi}` : `Run ${a.runId}: ${dau} — ${duoi}`, message: khongChot ? `${than} [event ${a.lan}]` : `${mo} ${than} [event ${a.lan}]`, dedupKey: `${kind}:${a.runId}:${a.stepId}:${a.compId}:${a.lan}` };
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
 * A2(n) T2 — true ⇔ the URGENT is stored: the alert said so (no word is not a yes) and there was somebody to tell (M4: the log, the stream and the audit row are no URGENT).
 */
export async function canhBaoKetCucKhongRo(a: CanhBaoKhongRo & { owner: number | null; entityType?: string; /** A2(n) T7 — how many people it went to (the Abort's audit, decision B) */ soNguoiNhan?: (n: number) => void }): Promise<boolean> {
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
    a.soNguoiNhan?.(recipients.length);
    const n = noiDungCanhBaoKhongRo(a);
    const { raiseCriticalStopAlert } = await napCanhBao();
    let ben = false;
    await raiseCriticalStopAlert({ ...n, recipients, source: "ot", entityType: a.entityType ?? "orchestration_run", entityId: a.runId, khuTrungBenVung: {}, retryUntilPersisted: { everyMs: 30_000, attempts: 20 }, baoBen: (b) => (ben = b) });
    // (c) — what cannot be recalled is on the audit trail too, central's walk and an edge's report alike
    if (a.loai === "inFlight") await ghiAuditHeThongKhongRo(a.runId, { kind: n.kind, dedupKey: n.dedupKey, stepId: a.stepId, compId: a.compId }, KHONG_RO_DANG_BAY_AUDIT_OP, true);
    if (recipients.length === 0) {
      console.error(`[FOE] run ${a.runId}: outcome-unknown URGENT has NO recipient (no owner, no active admin / supervisor): ${n.title}`);
      await ghiAuditHeThongKhongRo(a.runId, { kind: n.kind, dedupKey: n.dedupKey, stepId: a.stepId, compId: a.compId });
    }
    return ben && recipients.length > 0;
  } catch (err) {
    console.error(`[FOE] run ${a.runId}: outcome-unknown alert failed: ${(err as Error)?.message ?? err}`);
    return false;
  }
}

// ── the edge mirror (n5): the edge walker has no database — it reports an anomaly, central raises the alert ──────────────────────────────

/** The anomaly code an EDGE walker journals for an A2(n) event (events stream → edgeReportsCentral → canhBaoTuAnomalyEdge). */
export const KHONG_RO_EDGE_ANOMALY = "FOE_OUTCOME_UNKNOWN_COMPENSATION";
/**
 * A2(n) T5 (H1, H11) — why a STOP stays owed. `doc`: nobody could read its pins, or no dispatcher could be asked; `tuChoi`: answered, and nothing reached a driver; `driverLoi`: a driver was
 * called, or the hand-over threw: it may have gone. `ma` is a code (m-4): never a driver's text.
 */
export type NguonChuaRa = "doc" | "tuChoi" | "driverLoi";
export interface ViChuaRa {
  nguon: NguonChuaRa;
  ma: string;
}
const RE_MA = /^[A-Z][A-Z0-9_]{2,63}$/;
/**
 * A2(n) T5 — the code of a refusal: the dispatcher's own reason, else the code a text opens with, else its status. Only this leaves the walker (m-4). Pure.
 */
export function maTuChoiCua(r: { error?: string | null; status?: string | null; detail?: { reason?: unknown } | null }): string {
  const lyDo = typeof r.detail?.reason === "string" ? r.detail.reason : "";
  if (RE_MA.test(lyDo)) return lyDo;
  const dau = /^[A-Z][A-Z0-9_]{2,63}(?=$|[:\s(])/.exec(r.error ?? "")?.[0];
  if (dau) return dau;
  const tt = String(r.status ?? "").toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  return RE_MA.test(tt) ? tt : "REFUSED";
}
/**
 * R1b-2b-2a A2(n) T5 (decisions C, H1) — state C: a STOP that did not go, or may not have, and stays owed: nobody could decide it, or its dispatcher refused it. NOT "not sent, final": its row is
 * not settled, the run is held, an Abort sends it. Known code (MA_LOI_DA_BIET). Here: the pure functions spell the row, and this module does not import the store.
 */
export const FOE_STOP_NOT_SENT = "FOE_STOP_NOT_SENT";
/** H11 — an OT `failed` that never reached a driver: its dispatcher stopped before the write (commandDispatcher, otEdgeDispatch). Every other `failed` was a driver's. */
export const MA_CHUA_GHI: ReadonlySet<string> = new Set(["ADAPTER_OFFLINE", "DB_UNAVAILABLE", "LEDGER_INTENT_FAILED"]);
/** H17 — `rejected` that says nothing of the STOP: commandDispatcher.routeEdgeOwnedAdapterCommand has queued it for the owning node, or written it itself on a transient session. */
export const MA_TU_CHOI_CO_THE_RA: ReadonlySet<string> = new Set(["ADAPTER_OWNED_BY_EDGE"]);
/** H11 — the source of a dispatcher's answer on a STOP. `rejected` never reached a driver, but for the list above; a robot's `failed` did, whatever the code. */
export function nguonCuaKetQua(status: string, ma: string, robot: boolean): NguonChuaRa {
  if (MA_TU_CHOI_CO_THE_RA.has(ma)) return "driverLoi";
  return status === "rejected" || (!robot && MA_CHUA_GHI.has(ma)) ? "tuChoi" : "driverLoi";
}
/** The row of a STOP in state C: the code first, then its source, so a later walk and a person read the same thing. No driver text. */
export function loiChuaRaStop(stopId: string, attempt: number | "abort", vi: ViChuaRa): string {
  const lan = attempt === "abort" ? "on the Abort" : `attempt ${attempt}`; // A2(n) T7b-1 — an `abort:` row of a latched run says it the same way (C4)
  if (vi.nguon === "driverLoi") return `${FOE_STOP_NOT_SENT}: STOP "${stopId}" is not confirmed out (${lan}): may have gone out [${vi.ma}].`;
  if (vi.nguon === "tuChoi") return `${FOE_STOP_NOT_SENT}: STOP "${stopId}" did NOT go out (${lan}): refused before a driver [${vi.ma}].`;
  return `${FOE_STOP_NOT_SENT}: STOP "${stopId}" did NOT go out (${lan}): nobody could decide it [${vi.ma}].`;
}
/**
 * A2(n) T7b-2 (H7, 5a) — the closed value an edge's `abort_stop` record carries in its own `result` (`chuaRa`): a source of the three, a code. Anything else is not one (undefined): never a driver's text, never
 * a value central did not define. Pure.
 */
export function viChuaRaDong(x: unknown): ViChuaRa | undefined {
  const v = x as { nguon?: unknown; ma?: unknown } | null | undefined;
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  if (v.nguon !== "doc" && v.nguon !== "tuChoi" && v.nguon !== "driverLoi") return undefined;
  if (typeof v.ma !== "string" || !RE_MA.test(v.ma)) return undefined;
  return { nguon: v.nguon, ma: v.ma };
}
/** The source, read back from such a row: a later walk has no memory of the one that wrote it. undefined ⇔ not one. Pure. */
export function viChuaRaCuaLoi(error: string | null | undefined): ViChuaRa | undefined {
  const m = /(refused before a driver|may have gone out|nobody could decide it) \[([A-Za-z0-9_]{1,64})\]/.exec(String(error ?? ""));
  if (!m) return undefined;
  return { nguon: m[1] === "may have gone out" ? "driverLoi" : m[1] === "nobody could decide it" ? "doc" : "tuChoi", ma: m[2] as string };
}
/** The run's error while a STOP stays owed: the code first, the way out: Abort, never Continue. */
export function loiGiuChuaRa(stopId: string, vi: ViChuaRa | undefined): string {
  const dau = `${FOE_STOP_NOT_SENT}: STOP "${stopId}"`;
  if (vi?.nguon === "driverLoi") return `${dau} is not confirmed out: it may have reached the device (${vi.ma}). The run is held: Abort sends it again.`;
  if (vi?.nguon === "tuChoi") return `${dau} did NOT go out: it was refused before it reached a driver (${vi.ma}). The run is held: Abort sends it again.`;
  return `${dau} did NOT go out: nobody could read its pins. The run is held: if it is a pinned STOP, Abort sends it once the read recovers; if it is not, nothing is sent.`;
}
/**
 * A2(n) T7 (decision 1, H2, H18) — the run's error when the end gate holds it for want of a durable URGENT: the code first, then what nobody was told, then the way out. A Continue walks to the gate again
 * and tries the URGENT again; an Abort ends the run whatever the URGENT does (decision B). Never "the run ended".
 */
export function loiGiuKhongBen(runId: number, x: { ma?: MaKetCucKhongRo | null; khongXacNhan?: readonly string[] }): string {
  const tay = "The run is held and nothing further goes forward: Continue tries the URGENT again, Abort ends the run. Check the machine on site.";
  const dau = x.ma
    ? `${x.ma}: run ${runId} has a command whose outcome is unknown, and no URGENT about it could be stored: nobody has been told.`
    : `FOE_OUTCOME_UNKNOWN: run ${runId} has a STOP central could not confirm, and no URGENT about it could be stored: nobody has been told.`;
  const ds = x.khongXacNhan?.length ? ` STOP ${x.khongXacNhan.map((id) => `"${id}"`).join(", ")}: reported handed over, not confirmed by central.` : "";
  return `${dau}${ds} ${tay}`;
}
/** A2(n) T7 — the run's error when its end could not read its step rows: nothing says no STOP is owed, so it does not end. */
export function loiGiuChuaDocHang(runId: number, ma: MaKetCucKhongRo | null): string {
  return `${ma ?? "FOE_OUTCOME_UNKNOWN"}: run ${runId}: its step records could not be read at its end, so whether a STOP is still owed cannot be told. The run is held: Continue walks it to its end again, Abort ends it and sends its STOPs. Check the machine on site.`;
}
const docViChuaRa = (v: unknown): ViChuaRa | undefined => {
  const x = v as { nguon?: unknown; ma?: unknown } | null | undefined;
  return (x?.nguon === "doc" || x?.nguon === "tuChoi" || x?.nguon === "driverLoi") && typeof x.ma === "string" && /^[A-Za-z0-9_]{1,64}$/.test(x.ma) ? { nguon: x.nguon, ma: x.ma } : undefined;
};
export interface BaoCaoKhongRoEdge {
  loai: LoaiCanhBaoKhongRo;
  stepId: string;
  compId: string;
  /** the CODE only (m-4) */
  ma: MaKetCucKhongRo;
  claimSeq: number;
  /** m-K */
  biet?: boolean;
  /** A2(n) T5 — a code, same rule as `ma` */
  vi?: ViChuaRa;
}
const LOAI_KHONG_RO: ReadonlySet<string> = new Set(Object.keys(CANH_BAO_KHONG_RO_KIND));
/** The anomaly's detail (≤ 1 000 characters, JSON: what central needs to raise the same alert; codes and ids only). */
export function chiTietAnomalyKhongRo(a: { loai: LoaiCanhBaoKhongRo; stepId: string; compId: string; error: string; claimSeq: number; biet?: boolean; vi?: ViChuaRa }): string {
  return JSON.stringify({ loai: a.loai, stepId: a.stepId.slice(0, 128), compId: a.compId.slice(0, 128), ma: maKetCucKhongRoCua(a.error), claimSeq: a.claimSeq, ...(a.biet ? { biet: true } : {}), ...(a.vi ? { vi: { nguon: a.vi.nguon, ma: a.vi.ma.slice(0, 64) } } : {}) } satisfies BaoCaoKhongRoEdge);
}
/** Central's reading of that detail; null ⇔ not one (the EDGE_ANOMALY audit still records it). */
export function docAnomalyKhongRo(detail: string | null | undefined): BaoCaoKhongRoEdge | null {
  try {
    const v = JSON.parse(String(detail ?? "")) as Record<string, unknown>;
    if (typeof v.loai !== "string" || !LOAI_KHONG_RO.has(v.loai) || typeof v.stepId !== "string" || typeof v.compId !== "string" || !Number.isSafeInteger(v.claimSeq)) return null;
    return { loai: v.loai as LoaiCanhBaoKhongRo, stepId: v.stepId, compId: v.compId, ma: v.ma === "EDGE_OUTCOME_UNKNOWN" ? v.ma : "FOE_OUTCOME_UNKNOWN", claimSeq: v.claimSeq as number, ...(v.biet === true ? { biet: true } : {}), ...(docViChuaRa(v.vi) ? { vi: docViChuaRa(v.vi) } : {}) };
  } catch {
    return null;
  }
}
/** I-5 — the same event for both edge routes (the anomaly and the segment end): the same dedup key, the same text ⇒ one inbox row. */
export function canhBaoTuBaoCaoEdge(runId: number, x: BaoCaoKhongRoEdge, owner: number | null, stopKhongXacMinh = false): Promise<boolean> {
  // dieu-phoi 08/11 T6e-K2 — `stopKhongXacMinh` is CENTRAL's word (stopKhongXacMinhEdge), never the edge's: a forwardNotSent of a step central takes for a pinned STOP, or cannot verify,
  // says so in the T6e-K1 words. Both edge routes ask the same function, so one event keeps one text (I-5)
  return canhBaoKetCucKhongRo({ loai: x.loai, runId, stepId: x.stepId, compId: x.compId, error: x.ma, lan: `claim${x.claimSeq}`, owner, ...(x.biet ? { biet: true } : {}), ...(x.vi ? { vi: x.vi } : {}), ...(stopKhongXacMinh && x.loai === "forwardNotSent" ? { stopKhongXacMinh: true as const } : {}) });
}
/**
 * I-5, m-H — what central does with an EDGE anomaly: an A2(n) report of a run THIS node is assigned, that `kiem` finds valid (a claim of the run; a step of
 * the assigned definition paired with its own compensation) ⇒ the URGENT; anything else ⇒ nothing beyond the EDGE_ANOMALY audit its caller writes.
 * `kiem` answers the run's owner, or null when the report is not valid. true ⇔ an alert was raised. Never throws.
 */
export async function canhBaoTuAnomalyEdge(rec: { code: string; runId: number | null; detail?: string | null }, runCuaNode: boolean, kiem: (x: BaoCaoKhongRoEdge) => Promise<{ owner: number | null; stopKhongXacMinh?: boolean } | null>): Promise<boolean> {
  if (rec.code !== KHONG_RO_EDGE_ANOMALY || !runCuaNode || rec.runId == null) return false;
  const x = docAnomalyKhongRo(rec.detail);
  if (!x) return false;
  const hop = await kiem(x).catch(() => null);
  if (!hop) return false;
  void canhBaoTuBaoCaoEdge(rec.runId, x, hop.owner, hop.stopKhongXacMinh === true);
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
    const { checkPermission } = await napQuyen();
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
        const { logCrudOperation, createAuditContext } = await napAudit();
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
        const { logCrudOperation, createAuditContext } = await napAudit();
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
