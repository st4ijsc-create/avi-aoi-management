/**
 * SCADA R1b-2b-2a A2(n) (AN TOÀN, L-7 — gates follow the energy direction; a STOP never waits for a person) — a FOE command step whose
 * outcome is UNKNOWN (FOE_OUTCOME_UNKNOWN: a dispatch that timed out, or a "may already have flown" refusal — DUPLICATE_IN_FLIGHT,
 * IDEMPOTENCY_KEY_REUSED, FOE_ROW_SPENT_FOR_KEY …; EDGE_OUTCOME_UNKNOWN: an edge sent it and its result was not recorded). Before A2(n) the
 * step's compensation (and the compensations of the containers around it) ran by itself, i.e. a WRITE to a device whose state the engine had
 * just declared unknown (a reset / setpoint on another machine, an "undo" of a command that may never have been sent), and nobody was told.
 *
 * Coordinator ruling (C), conditions n1–n6 — the engine (foeEngine.execStep) splits each due compensation BY ENERGY DIRECTION:
 *   • a PINNED STOP (the A2(h) shared predicate, commandDispatcher.phanLoaiStopGhimChoFoe → classifyOtStop(...).pinnedStop) runs
 *     AUTOMATICALLY — through commandDispatcher and every gate, never a shortcut — and an URGENT alert says "STOP compensation sent";
 *   • ANY other compensation (setpoint, reset, start, motion, robot, a stop whose pins cannot be read / are not pinned) is NOT sent: the run
 *     is HELD with resume state `compensationHeld` for that step + an URGENT alert "… waiting for a person". Nothing is written to the device.
 *   Container (ancestor) compensations follow the same split (the unknown flag travels with the failure: `khongRo`).
 * A KNOWN failure is unchanged (n6): its compensation runs exactly as before.
 *
 * Resume v1 (n3) of such a held run: Continue (sends ONLY the held compensation) — a person with machine-control rights (the router's own
 * floor: ACTUATION_ROLES + machine_control/canCreate, re-checked here because the engine has other callers: the FOE_DURABLE auto-resume, the
 * QT pump), a REQUIRED reason, an audit row; out of scope ⇒ "not found" (resumeRun's scope rule). Abort is never refused (L-7: it only ever
 * sends STOPs; the held non-STOP compensation is not one of them) and is audited. Nothing expires into a write: the marker below keeps every
 * system / automatic path out.
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

/**
 * Run-context key (server-written) of a run HELD by A2(n): { stepId, compId, ma, at, lan } — codes and ids only (no free text: a masked viewer
 * sees the context as it is). While it is set:
 *   • resumeRun refuses a Continue that is not a person's with machine-control rights and a reason (system / auto-resume / QT pump included);
 *   • the Studio shows the notice and asks for the reason.
 * Cleared by the Continue that passed those checks.
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
}
export function dauKetCucKhongRoCua(ctx: Record<string, unknown> | null | undefined): DauKetCucKhongRo | null {
  const v = ctx?.[KET_CUC_KHONG_RO_CTX_KEY];
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const d = v as Partial<DauKetCucKhongRo>;
  return typeof d.stepId === "string" && typeof d.compId === "string"
    ? { stepId: d.stepId, compId: d.compId, ma: d.ma === "EDGE_OUTCOME_UNKNOWN" ? d.ma : "FOE_OUTCOME_UNKNOWN", at: typeof d.at === "string" ? d.at : "", lan: typeof d.lan === "string" ? d.lan : "" }
    : // a marker whose ids cannot be read still marks the run (fail-closed: the Continue checks apply)
      { stepId: "?", compId: "?", ma: "FOE_OUTCOME_UNKNOWN", at: "", lan: "" };
}

// ── the run's / step rows' texts ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The error of the held compensation's row and of the held run (the code first: a masked viewer keeps FOE_/EDGE_OUTCOME_UNKNOWN). */
export function loiGiuBuTruKhongRo(stepId: string, compId: string, stepError: string): string {
  const ma = maKetCucKhongRoCua(stepError);
  // data-raw-ok: machine-readable code first (the Studio / masked callers key on it); ids are the workflow's own
  return `${ma}: command "${stepId}" outcome unknown — machine state unknown — compensation "${compId}" waiting for a person (it is not a pinned STOP: NOT sent). Check the device, then Continue (sends only that compensation; a reason is required) or Abort.`;
}

// ── the URGENT alert ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** held — a non-STOP compensation held (nothing sent); stopSent — a pinned STOP compensation sent and confirmed; stopNotConfirmed — sent, not confirmed. */
export type LoaiCanhBaoKhongRo = "held" | "stopSent" | "stopNotConfirmed";
export const CANH_BAO_KHONG_RO_KIND: Readonly<Record<LoaiCanhBaoKhongRo, string>> = Object.freeze({
  held: "foe_outcome_unknown_compensation_held",
  stopSent: "foe_outcome_unknown_stop_compensation_sent",
  stopNotConfirmed: "foe_outcome_unknown_stop_compensation_unconfirmed",
});
/** n2 — the words a person reads (critical-stop alerts carry raw text, they are not localised — as A2(m2)). */
export const CHO_NGUOI_TIEU_DE = "waiting for a person";
export const STOP_DA_GUI_TIEU_DE = "STOP compensation sent";

export interface CanhBaoKhongRo {
  loai: LoaiCanhBaoKhongRo;
  runId: number;
  stepId: string;
  compId: string;
  /** the failed step's error (shortened in the text) */
  error: string;
  /** the interruption / outcome event: in the dedup key AND the text (the durable dedup also matches kind + identical message) */
  lan: string;
}

/** The alert of one event (pure; exported for the unit test). Dedup key `<kind>:<run>:<step>:<comp>:<event>`. */
export function noiDungCanhBaoKhongRo(a: CanhBaoKhongRo): { kind: string; title: string; message: string; dedupKey: string } {
  const kind = CANH_BAO_KHONG_RO_KIND[a.loai];
  const loi = a.error.length > 300 ? `${a.error.slice(0, 300)}…` : a.error;
  const dau = `command "${a.stepId}" outcome unknown — machine state unknown`;
  const title =
    a.loai === "held"
      ? `Run ${a.runId}: ${dau} — compensation "${a.compId}" ${CHO_NGUOI_TIEU_DE}`
      : a.loai === "stopSent"
        ? `Run ${a.runId}: ${dau} — ${STOP_DA_GUI_TIEU_DE} ("${a.compId}")`
        : `Run ${a.runId}: ${dau} — STOP compensation "${a.compId}" sent but NOT confirmed`;
  const than =
    a.loai === "held"
      ? `The outcome of command step "${a.stepId}" of run ${a.runId} is UNKNOWN (${loi}); the state of the machine is unknown. Its compensation "${a.compId}" is not a pinned STOP, so it was NOT sent: the run is HELD and the compensation is ${CHO_NGUOI_TIEU_DE}. Check the device on site, then Continue (sends only that compensation; a reason is required) or Abort (no compensation that is not a STOP is sent).`
      : a.loai === "stopSent"
        ? `The outcome of command step "${a.stepId}" of run ${a.runId} is UNKNOWN (${loi}); the state of the machine is unknown. Its compensation "${a.compId}" is a pinned STOP and was sent automatically (stopping never waits for a person): ${STOP_DA_GUI_TIEU_DE}. Check the machine state on site.`
        : `The outcome of command step "${a.stepId}" of run ${a.runId} is UNKNOWN (${loi}); the state of the machine is unknown. Its pinned STOP compensation "${a.compId}" was handed to the dispatcher but NOT confirmed — check on site and use the machine's direct STOP / E-STOP if needed.`;
  return { kind, title, message: `${than} [event ${a.lan}]`, dedupKey: `${kind}:${a.runId}:${a.stepId}:${a.compId}:${a.lan}` };
}

/**
 * Raise the URGENT alert of one event (central): the run owner + active admins / supervisors (bounded read; unreadable ⇒ the owner only),
 * the critical-stop alert's durable dedup per (person, key). Bounded; never throws. Callers do not await it on a STOP's path.
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
    await raiseCriticalStopAlert({ ...n, recipients, source: "ot", entityType: a.entityType ?? "orchestration_run", entityId: a.runId, khuTrungBenVung: {} });
  } catch (err) {
    console.error(`[FOE] run ${a.runId}: outcome-unknown alert failed: ${(err as Error)?.message ?? err}`);
  }
}

// ── the edge mirror (n5): the edge walker has no database — it reports an anomaly, central raises the alert ──────────────────────────────

/** The anomaly code an EDGE walker journals for an A2(n) event (events stream → edgeReportsCentral → canhBaoKetCucKhongRo). */
export const KHONG_RO_EDGE_ANOMALY = "FOE_OUTCOME_UNKNOWN_COMPENSATION";
/** The anomaly's detail (≤ 1 000 characters, JSON: what central needs to raise the same alert). */
export function chiTietAnomalyKhongRo(a: { loai: LoaiCanhBaoKhongRo; stepId: string; compId: string; error: string; claimSeq: number }): string {
  const base = { loai: a.loai, stepId: a.stepId.slice(0, 128), compId: a.compId.slice(0, 128), claimSeq: a.claimSeq };
  const s = JSON.stringify({ ...base, error: a.error.slice(0, 600) });
  return s.length <= 1_000 ? s : JSON.stringify({ ...base, error: "" });
}
/** Central's reading of that detail; null ⇔ not one (the EDGE_ANOMALY audit still records it). */
export function docAnomalyKhongRo(detail: string | null | undefined): { loai: LoaiCanhBaoKhongRo; stepId: string; compId: string; error: string; claimSeq: number } | null {
  try {
    const v = JSON.parse(String(detail ?? "")) as Record<string, unknown>;
    const loai = v.loai === "held" || v.loai === "stopSent" || v.loai === "stopNotConfirmed" ? v.loai : null;
    if (!loai || typeof v.stepId !== "string" || typeof v.compId !== "string" || !Number.isSafeInteger(v.claimSeq)) return null;
    return { loai, stepId: v.stepId, compId: v.compId, error: typeof v.error === "string" ? v.error : "", claimSeq: v.claimSeq as number };
  } catch {
    return null;
  }
}

// ── resume v1 (n3) ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const KET_CUC_KHONG_RO_AUDIT_ACTION = "foe_outcome_unknown_resolution";

/**
 * May `user` CONTINUE a run held by A2(n) with `note`? The machine-control check of the router (orchestrationRouter.resumeRun:
 * actuationProcedure = ACTUATION_ROLES + 2FA, then requirePermission("machine_control", "canCreate")) — re-located: the same role list
 * and the same checkPermission, so the engine's own callers (system user 0, the FOE_DURABLE auto-resume, the QT pump) are refused too.
 * A REQUIRED reason (non-blank). Throws the refusal (FORBIDDEN / BAD_REQUEST) — before any state change.
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

/** The audit row of a Continue / an Abort of such a held run (audit_logs; action is varchar(100), no enum ⇒ no migration). Bounded; never throws. */
export async function ghiAuditKetCucKhongRo(user: { id: number; name?: string | null }, runId: number, op: "continue" | "abort", metadata: Record<string, unknown>, ok = true): Promise<void> {
  try {
    await withDeadline(
      (async () => {
        const { logCrudOperation, createAuditContext } = await import("../../auditTrailService");
        await logCrudOperation(createAuditContext({ user: { id: user.id, name: user.name ?? null } }), {
          action: KET_CUC_KHONG_RO_AUDIT_ACTION,
          entityType: "orchestration_run",
          entityId: runId,
          details: { operation: `foe_outcome_unknown_${op}`, metadata: { runId, ...metadata } },
          status: ok ? "success" : "failure",
        });
      })(),
      5 * STOP_DB_STEP_DEADLINE_MS,
      `FOE run ${runId} outcome-unknown audit`,
    );
  } catch (err) {
    console.error(`[FOE] run ${runId}: outcome-unknown audit not written: ${(err as Error)?.message ?? err}`);
  }
}
