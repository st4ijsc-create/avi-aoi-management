/**
 * SCADA R1b-2b-2a A2(m2) (AN TOÀN, L-7) — a run the server stopped (crash / restart) while it was COMPENSATING. Before A2(m2) such a run
 * was put to 'failed' at boot ("not auto-resumed"): if the compensation in flight was a pinned OT STOP that never reached the device, the
 * STOP was dropped SILENTLY. This module holds the two decisions the engine's boot hook (foeEngine.rehydrateInterruptedRuns) makes:
 *
 *   1. phanLoaiBuTruBiNgat (pure) — WHICH compensation was in flight: exactly ONE top-level compensation not final ⇒ the run is held
 *      (resume state compensationHeld for that step: a Continue re-sends ONLY it); none ⇒ 'failed' as before; two or more / nested /
 *      undecidable ⇒ never a guess: 'failed' + URGENT.
 *   2. xetGuiLaiBuTruBiNgat + quyetDinhGuiLai — may the boot re-send that compensation ONCE by itself? Only when ALL hold (coordinator b1–b4):
 *      b1 it is a PINNED STOP (the A2(h) shared predicate via commandDispatcher.phanLoaiStopGhimChoFoe — never laStopChoKhoa / a content stop);
 *      b2 the DB clock (`now()` in SQL — never the process clock) is still before LEAST(intent + D, the original STOP's own authorisation
 *         expiry), where the INTENT time is orchestration_run_steps."createdAt" of the compensation's row (see INTENT below);
 *      b3 the adapter is not edge-owned now, its owner epoch did not change since the run (device_owner_changes), and NO other command
 *         reached that adapter / machine since the intent (command_log);
 *      b4 is the engine's job (the re-send goes through runCompensation → execCommand → the central store → equipmentRegistry →
 *         commandDispatcher with every gate; exactly one attempt on a fresh key / fresh authorisation row).
 *      Anything else — a check that fails, a lookup that errors or times out, a missing fact — ⇒ NOT sent (held + URGENT).
 *
 * INTENT time = orchestration_run_steps."createdAt" of the compensation row: `DEFAULT now()` (the DB clock), written ONCE by the FIRST
 * insert of that row — runCompensation's "running row", written right before the compensation's body is dispatched — and never changed
 * by an upsert (upsertStepOn's ON CONFLICT set has no "createdAt"). So it is the moment the engine decided to send THIS compensation,
 * on the DB's clock. (An earlier segment that already wrote the row — a compensation held earlier — only makes it OLDER ⇒ the window
 * closes sooner: fail-closed.) "startedAt" is NOT used: it is the process clock (`new Date()`) of the process that crashed.
 * No compensation row (the crash came before it) ⇒ no intent time ⇒ never auto-sent.
 *
 * No new flag (b6): AI_OT_CONTROL_ENABLED / FOE flags are not read here; OT_CONTROL_ENABLED is the dispatcher's own gate (b4).
 */
import { sql } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { STOP_DB_STEP_DEADLINE_MS } from "../../robot/stopJob";
import { withDeadline } from "../../ot/drivers/boundedClose";
import { FOE_REJECT_CLAIM_CTX_KEY } from "./foeGateApproval";
import { ABORT_ROW_PREFIX, FOE_ACTION_TTL_MS, loadMachines, withResolvedAdapter } from "./foeRunStore";
import { allStepsOf, buildEquipmentCommand, commandOf, isRobotKind } from "./foeStepClass";
import type { WorkflowDefinition, WorkflowStep } from "./workflowModel";
import { napMotLan } from "./foeNapMotLan";

const napDispatcher = napMotLan(() => import("../../ot/commandDispatcher"));
const napOtManager = napMotLan(() => import("../../ot/otManager"));

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/**
 * D — how long after the STOP intent (DB clock) the boot may still re-send it by itself. 5 minutes: a restart that takes longer leaves
 * the run held for a person (URGENT). Never beyond the engine's authorisation lifetime (FOE_ACTION_TTL_MS, 1 h) — hanGuiLaiMs().
 */
export const STOP_BU_TRU_KHOI_DONG_HAN_MS = 5 * 60_000;
/** The window actually applied: D, capped by the authorisation lifetime of the original STOP (never beyond its own deadline). */
export function hanGuiLaiMs(): number {
  return Math.min(STOP_BU_TRU_KHOI_DONG_HAN_MS, FOE_ACTION_TTL_MS);
}
/**
 * The attempt number of the boot re-send: its idempotency key is `run<R>-<compId>-a2` — a key no walk ever used (a compensation is always
 * dispatched as attempt 1, and the boot re-sends at most once per run), so the dispatcher sees a FRESH key; a pinned STOP also gets a
 * FRESH authorisation row (A2(m): stopActionIdMoi(key, 2, uuid)).
 */
export const LAN_GUI_LAI_KHOI_DONG = 2;
/** The lookups of the decision (b1–b3) together: bounded (the boot is never held on a hung DB; past it ⇒ not sent, held + URGENT). */
export const HAN_XET_GUI_LAI_MS = 5 * STOP_DB_STEP_DEADLINE_MS;

/**
 * Run-context key (server-written) of a run held because a compensation was interrupted: { stepId, compId, at, daThuGuiLai?, dangGuiLai?,
 * ketQuaGuiLai? }. While it is set the generic FOE_DURABLE auto-resume never continues the run (only this guarded path or a person may).
 * `daThuGuiLai` — the boot re-send was ATTEMPTED (written BEFORE the attempt, compare-and-set): never a second one, across any number of
 * boots. `dangGuiLai` — the nonce of the attempt in progress: only that attempt may write the run's outcome.
 */
export const BU_TRU_BI_NGAT_CTX_KEY = "foeBuTruBiNgat";

export interface DauBuTruBiNgat {
  stepId: string;
  compId: string;
  at: string;
  daThuGuiLai?: true;
  dangGuiLai?: string;
  ketQuaGuiLai?: string;
}

export function dauBuTruCua(ctx: Record<string, unknown> | null | undefined): DauBuTruBiNgat | null {
  const v = ctx?.[BU_TRU_BI_NGAT_CTX_KEY];
  return v && typeof v === "object" && !Array.isArray(v) ? (v as DauBuTruBiNgat) : null;
}

// ── 1. which compensation was in flight (pure) ─────────────────────────────────────────────────────────────────────────

export type PhanLoaiBuTru =
  /** nothing in flight ⇒ 'failed' as before */
  | { kind: "khong" }
  /** exactly ONE top-level compensation not final ⇒ held (compensationHeld for `stepId`) */
  | { kind: "mot"; stepId: string; compId: string; error: string }
  /** two or more ⇒ never a guess: 'failed' + URGENT */
  | { kind: "nhieu"; compIds: string[] }
  /** undecidable (nested, unreadable definition with live rows, a gate rejection's unwind, the step row is not failed) ⇒ 'failed' + URGENT */
  | { kind: "khongRo"; lyDo: string; compIds: string[] };

/** Final step-row statuses: a compensation row in any other status (running / held / pending / …) is NOT final. */
export const TRANG_THAI_CUOI = ["completed", "skipped", "compensated", "failed"] as const;

/**
 * A compensation is "in flight" when its row exists and is not final, or when its row is ABSENT while its step's own row says failed (the
 * crash came between the step's failed row and the compensation's running row — still due). Pure.
 */
export function phanLoaiBuTruBiNgat(
  def: WorkflowDefinition | null | undefined,
  rows: ReadonlyArray<{ stepId: string; status: string; error?: string | null }>,
  ctx: Record<string, unknown> | null | undefined,
): PhanLoaiBuTru {
  const cuoi = new Set<string>(TRANG_THAI_CUOI);
  if (ctx && FOE_REJECT_CLAIM_CTX_KEY in ctx) {
    // a gate REJECTION's unwind (its claim token): its STOPs are the abort sweep's — never re-walked here
    return { kind: "khongRo", lyDo: "rejectionUnwind", compIds: [] };
  }
  if (!def || !Array.isArray(def.steps)) {
    const song = rows.filter((r) => !cuoi.has(r.status)).map((r) => r.stepId);
    return song.length ? { kind: "khongRo", lyDo: "definitionUnreadable", compIds: song } : { kind: "khong" };
  }
  const byId = new Map(rows.map((r) => [r.stepId, r] as const));
  // fix round 1 (m-3) — a NOT-final row that names no step of the (head) definition: the workflow was redeployed with the step renamed during
  // the outage ⇒ which compensation was in flight cannot be told from this definition ⇒ never 'failed' silently
  const tenBuoc = new Set(allStepsOf(def.steps).map((s) => s.id));
  const lac = rows.filter((r) => !cuoi.has(r.status) && !tenBuoc.has(r.stepId) && !r.stepId.startsWith(ABORT_ROW_PREFIX)).map((r) => r.stepId);
  if (lac.length) return { kind: "khongRo", lyDo: "definitionChanged", compIds: lac };
  const dangDo = allStepsOf(def.steps).filter((s): s is WorkflowStep & { compensation: WorkflowStep } => {
    if (!s.compensation) return false;
    const c = byId.get(s.compensation.id);
    if (c) return !cuoi.has(c.status);
    return byId.get(s.id)?.status === "failed";
  });
  if (dangDo.length === 0) return { kind: "khong" };
  const compIds = dangDo.map((s) => s.compensation.id);
  if (dangDo.length > 1) return { kind: "nhieu", compIds };
  const s = dangDo[0];
  // a TOP-LEVEL step: a sequence re-walk reaches it with every earlier step completed and runs nothing after it (it failed); a step inside a
  // parallel / branch / sequence could restart a sibling ⇒ not taken
  if (!def.steps.some((t) => t.id === s.id)) return { kind: "khongRo", lyDo: "nested", compIds };
  const r = byId.get(s.id);
  if (!r || (r.status !== "failed" && r.status !== "running")) return { kind: "khongRo", lyDo: "stepRowNotFailed", compIds };
  return { kind: "mot", stepId: s.id, compId: s.compensation.id, error: r.error ?? "" };
}

// ── 2. may the boot re-send it by itself? ──────────────────────────────────────────────────────────────────────────────

/** The facts the decision is made on — recorded verbatim in the audit row (b5). `null` = not established (⇒ not sent). */
export interface BangChungGuiLai {
  runId: number;
  stepId: string;
  compId: string;
  /** the boot re-send of this run was already attempted (marker daThuGuiLai) */
  daThuGuiLai: boolean;
  /** FOE_ENABLED (the engine's own switch — not a new flag) */
  foeBat: boolean;
  /** the deployed head definition is one the run executed (no record ⇒ true: legacy runs, as resumeRun) */
  dinhNghiaKhop: boolean;
  b1: {
    laLenh: boolean;
    robot: boolean;
    adapterId: number | null;
    machineId: number | null;
    commandType: string | null;
    pinnedStop: boolean | null;
    loiDocGhim: string | null;
  } | null;
  b2: {
    /** orchestration_run_steps."createdAt" of the compensation row (DB clock), as the DB prints it */
    intentAt: string | null;
    /** now() of the DB at the check */
    dbNow: string | null;
    hanMs: number;
    /** the earliest "expiresAt" of this compensation's own authorisation rows (the original STOP's own deadline), if any */
    authExpiresAt: string | null;
    /** now() − intent, ms (DB clock) */
    tuoiMs: number | null;
    /** LEAST(intent + D, authExpiresAt) − now(), ms (DB clock) */
    conLaiMs: number | null;
    runCreatedAt: string | null;
  } | null;
  b3: {
    adapterTonTai: boolean;
    edgeNodeId: number | null;
    /** device_owner_changes rows of the adapter since the run was created (each one bumped its ownerEpoch) */
    doiChuSoHuu: number;
    /** command_log rows of that adapter / machine since the intent that are not this run's own (actionId foe-run<R>-…) */
    lenhSau: Array<{ id: number; status: string; actionId: string | null }>;
  } | null;
  /** the first lookup error (⇒ not sent) */
  loi: string | null;
}

/** Why the boot did NOT re-send (machine-readable; the alert / audit / run error carry the code and its text). */
export const LY_DO_KHONG_GUI = {
  loiTraCuu: "a lookup of the re-send checks failed or did not answer",
  daGuiLaiMotLan: "the boot already re-sent this compensation once (never twice)",
  foeTat: "FOE is disabled (FOE_ENABLED)",
  dinhNghiaDaDoi: "the workflow was redeployed after the run (its compensation may differ)",
  khongPhaiLenh: "the compensation is not a command step",
  robot: "the compensation is a robot command (only a pinned OT STOP is re-sent at boot)",
  khongCoAdapter: "the compensation's adapter could not be resolved",
  khongDocDuocGhim: "the STOP pins could not be read",
  khongPhaiStopGhim: "the compensation is not a PINNED STOP (content stop / unpinned stop / non-STOP)",
  khongCoThoiDiemYDinh: "no STOP intent time is recorded (the compensation's row was never written)",
  dongHoBatThuong: "the recorded STOP intent time is in the future of the database clock",
  quaHan: "the re-send window D (database clock) or the original STOP's own deadline has passed",
  khongCoAdapterCsdl: "the adapter row does not exist any more",
  thietBiThuocEdge: "the device is owned by an edge node now",
  chuSoHuuDaDoi: "the device's ownership (ownerEpoch) changed since the run",
  coLenhSau: "another command reached that device after the interruption",
  // the attempt itself (b4 — the engine's dispatch through commandDispatcher)
  moPhong: "the dispatcher did not write the device (OT control is off — simulated)",
  guiLoi: "the dispatch was refused by a gate or failed at the device",
  khongXacNhan: "the re-send could not be confirmed (no answer within D, or an error)",
  daHuy: "the run was aborted or moved during the re-send",
  // fix round 1
  ketNoiChuaSan: "the device's connection was not up within the re-send window (D) after the restart",
  loiGhiNhan: "the claim of the re-send could not be written (database error)",
  // fix round 2 (C-1)
  luotTruocDungGiua: "a previous boot claimed the STOP re-send and then stopped: the STOP may or may not have reached the device — check the machine on site",
  // fix round 3 (I-1) — the previous boot's attempt left its compensation row final, then stopped before its outcome write
  luotTruocDaGui: "the STOP was re-sent at a previous boot (the outcome was not recorded) — check the machine on site",
  luotTruocKhongXong: "a previous boot's STOP re-send did not complete — the STOP may not have reached the device — check on site",
} as const;
export type LyDoKhongGui = keyof typeof LY_DO_KHONG_GUI;

/** The decision from the facts (pure; in the order of the coordinator's conditions). Any missing fact ⇒ not sent. */
export function quyetDinhGuiLai(bc: BangChungGuiLai): { gui: true; conLaiMs: number } | { gui: false; lyDo: LyDoKhongGui } {
  if (bc.loi !== null) return { gui: false, lyDo: "loiTraCuu" };
  if (bc.daThuGuiLai) return { gui: false, lyDo: "daGuiLaiMotLan" };
  if (!bc.foeBat) return { gui: false, lyDo: "foeTat" };
  if (!bc.dinhNghiaKhop) return { gui: false, lyDo: "dinhNghiaDaDoi" };
  // b1
  if (!bc.b1 || !bc.b1.laLenh) return { gui: false, lyDo: "khongPhaiLenh" };
  if (bc.b1.robot) return { gui: false, lyDo: "robot" };
  if (bc.b1.adapterId == null) return { gui: false, lyDo: "khongCoAdapter" };
  if (bc.b1.loiDocGhim !== null) return { gui: false, lyDo: "khongDocDuocGhim" };
  if (bc.b1.pinnedStop !== true) return { gui: false, lyDo: "khongPhaiStopGhim" };
  // b2 — DB clock only
  if (!bc.b2 || bc.b2.intentAt === null || bc.b2.tuoiMs === null || bc.b2.conLaiMs === null || bc.b2.runCreatedAt === null) return { gui: false, lyDo: "khongCoThoiDiemYDinh" };
  if (bc.b2.tuoiMs < 0) return { gui: false, lyDo: "dongHoBatThuong" };
  if (bc.b2.conLaiMs <= 0) return { gui: false, lyDo: "quaHan" };
  // b3
  if (!bc.b3 || !bc.b3.adapterTonTai) return { gui: false, lyDo: "khongCoAdapterCsdl" };
  if (bc.b3.edgeNodeId !== null) return { gui: false, lyDo: "thietBiThuocEdge" };
  if (bc.b3.doiChuSoHuu > 0) return { gui: false, lyDo: "chuSoHuuDaDoi" };
  if (bc.b3.lenhSau.length > 0) return { gui: false, lyDo: "coLenhSau" };
  return { gui: true, conLaiMs: bc.b2.conLaiMs };
}


/**
 * Test seam: called at the start of each lookup stage ("b1" | "b2" | "b3") and by the engine right before its claim ("claim"); a throw there is a
 * lookup / write error. Effective only under vitest.
 */
export type GiaiDoanDauDo = "b1" | "b2" | "b3" | "claim" | "claimSau" | "truocDiBo";
let dauDoChoTest: ((stage: GiaiDoanDauDo) => void | Promise<void>) | null = null;
export function _setBuTruBiNgatProbeForTests(fn: ((stage: GiaiDoanDauDo) => void | Promise<void>) | null): void {
  dauDoChoTest = fn;
}
export function dauDoBuTru(stage: GiaiDoanDauDo): void {
  if (dauDoChoTest && process.env.VITEST) void dauDoChoTest(stage);
}
/** The awaited form of the seam (a test can make that stage SLOW, e.g. "truocDiBo" — the walk before its run context exists). */
export async function dauDoBuTruCho(stage: GiaiDoanDauDo): Promise<void> {
  if (dauDoChoTest && process.env.VITEST) await dauDoChoTest(stage);
}

/**
 * The rows of a `d.execute` result (postgres-js: the array itself; node-postgres: `.rows`). fix round 1 (m-4) — any other shape THROWS: an empty
 * list would read as "no later command" (fail-open); a throw is a lookup error (⇒ not sent, held + URGENT).
 */
export function hangCuaKetQua(r: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(r)) return r as Array<Record<string, unknown>>;
  const rows = (r as { rows?: unknown } | null)?.rows;
  if (Array.isArray(rows)) return rows as Array<Record<string, unknown>>;
  throw new TypeError("unexpected database result shape (not a row list)");
}
const soHoacNull = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const chuoiHoacNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/**
 * b2 — the window of ONE compensation, on the DB clock only (now() in SQL; the process clock is never read):
 *   conLaiMs = LEAST(intent + D, the earliest expiry of this compensation's own authorisation rows) − now().
 * fix round 1 (m-1) — both bounds are compared as INSTANTS (timestamptz), each column read in the zone it was written in:
 *   • "createdAt" (`DEFAULT now()` into a naive column) is the SESSION zone's wall time ⇒ `::timestamptz` (session zone);
 *   • "expiresAt" is written by drizzle from a JS Date as the UTC wall time ⇒ `AT TIME ZONE 'UTC'`.
 * (Under `Etc/UTC` the two coincide; under any other session zone the old naive comparison was off by the zone offset.)
 * Parked m-2 (document only): the cap is the OLDEST authorisation row of this compensation across every walk (min "expiresAt"), and the intent is
 * the FIRST insert of its row — after a held, a Continue and a crash more than ~1 h later the run is held (fail-closed).
 */
export async function docCuaSoGuiLai(d: Db, runId: number, compId: string) {
  const hanMs = hanGuiLaiMs();
  const [t] = hangCuaKetQua(
    await d.execute(sql`
      SELECT c."createdAt"::text AS "intentAt",
             now()::text AS "dbNow",
             r."createdAt"::text AS "runCreatedAt",
             (a."authExpiresAt" AT TIME ZONE 'UTC')::text AS "authExpiresAt",
             FLOOR(EXTRACT(EPOCH FROM (now() - c."createdAt"::timestamptz)) * 1000)::bigint AS "tuoiMs",
             FLOOR(EXTRACT(EPOCH FROM (LEAST(c."createdAt"::timestamptz + (${hanMs}::float8 * interval '1 millisecond'), a."authExpiresAt" AT TIME ZONE 'UTC') - now())) * 1000)::bigint AS "conLaiMs",
             FLOOR(EXTRACT(EPOCH FROM now()) * 1000)::bigint AS "dbNowMs"
        FROM public."orchestration_run_steps" c
        JOIN public."orchestration_runs" r ON r."id" = c."runId"
        LEFT JOIN LATERAL (
          SELECT min(p."expiresAt") AS "authExpiresAt" FROM public."ai_pending_actions" p WHERE p."id" LIKE ${`foe-run${runId}-%`} AND p."summary" = ${`FOE orchestration: step ${compId}`}
        ) a ON true
       WHERE c."runId" = ${runId} AND c."stepId" = ${compId}`),
  );
  return {
    intentAt: chuoiHoacNull(t?.intentAt),
    dbNow: chuoiHoacNull(t?.dbNow),
    hanMs,
    authExpiresAt: chuoiHoacNull(t?.authExpiresAt),
    tuoiMs: soHoacNull(t?.tuoiMs),
    conLaiMs: soHoacNull(t?.conLaiMs),
    runCreatedAt: chuoiHoacNull(t?.runCreatedAt),
    dbNowMs: soHoacNull(t?.dbNowMs),
  };
}

/**
 * b3 "another command reached that device after the interruption": every command_log row of that adapter OR that machine since the STOP intent
 * (DB clock, `>=`), any status, except THIS run's own engine authorisations (`actionId LIKE 'foe-run<R>-%'` — the `-` after the id keeps run 1 from
 * hiding run 10's rows; hashed long ids keep the prefix).
 * ★ ACCEPTED RESIDUAL RISK (coordinator C-3, L-7 register): a start at the machine's own HMI / panel never reaches command_log, so this check cannot
 *   see it — within D (5 min) after a restart an in-flight STOP compensation may be re-sent even though the machine was started locally. The
 *   re-send is a STOP (energy-reducing) and its URGENT says "check the machine state on site".
 * ★ SINGLE-INSTANCE ASSUMPTION (I-5b, parked): the exclusion of the run's OWN rows also hides a LIVE walk of the same run in ANOTHER app instance
 *   (FOE's liveRuns registry is per process; rehydrate treats every non-edge 'compensating' run as interrupted). With two instances on one DB, an
 *   instance booting while another is live-sending this compensation may send a second STOP. FOE as a whole assumes ONE app instance per DB.
 *   An OVERLAPPING restart or deploy (the old process still running while the new one boots) counts as TWO instances: the old process
 *   must be dead before the new one starts.
 */
export async function docLenhSau(d: Db, x: { runId: number; compId: string; adapterId: number; machineId: number }) {
  const sau = hangCuaKetQua(
    await d.execute(sql`
      SELECT l."id", l."status"::text AS "status", l."actionId" FROM public."command_log" l
       WHERE (l."adapterId" = ${x.adapterId} OR l."machineId" = ${x.machineId})
         AND l."createdAt" >= (SELECT c."createdAt" FROM public."orchestration_run_steps" c WHERE c."runId" = ${x.runId} AND c."stepId" = ${x.compId})
         AND (l."actionId" IS NULL OR l."actionId" NOT LIKE ${`foe-run${x.runId}-%`})
       ORDER BY l."id" LIMIT 20`),
  );
  return sau.map((l) => ({ id: Number(l.id), status: String(l.status), actionId: chuoiHoacNull(l.actionId) }));
}

/**
 * Collect the facts (b1–b3) of ONE interrupted compensation and decide. Every read is the DB's; every time comparison is in SQL on `now()`.
 * A lookup error stops the collection and is recorded (⇒ not sent). Never writes anything. Callers bound it (HAN_XET_GUI_LAI_MS).
 */
export async function xetGuiLaiBuTruBiNgat(
  d: Db,
  x: {
    runId: number;
    stepId: string;
    compId: string;
    def: WorkflowDefinition;
    ctx: Record<string, unknown>;
    foeBat: boolean;
    dinhNghiaKhop: boolean;
  },
): Promise<{ bangChung: BangChungGuiLai; quyetDinh: ReturnType<typeof quyetDinhGuiLai> }> {
  const bc: BangChungGuiLai = {
    runId: x.runId,
    stepId: x.stepId,
    compId: x.compId,
    daThuGuiLai: dauBuTruCua(x.ctx)?.daThuGuiLai === true,
    foeBat: x.foeBat,
    dinhNghiaKhop: x.dinhNghiaKhop,
    b1: null,
    b2: null,
    b3: null,
    loi: null,
  };
  const xong = () => ({ bangChung: bc, quyetDinh: quyetDinhGuiLai(bc) });
  try {
    // ── b1: a PINNED STOP, by the A2(h) shared predicate (gate (1)'s own function) ──
    dauDoBuTru("b1");
    const step = x.def.steps.find((s) => s.id === x.stepId);
    const comp = step?.compensation;
    if (!comp || comp.id !== x.compId || comp.type !== "command") {
      bc.b1 = { laLenh: false, robot: false, adapterId: null, machineId: null, commandType: null, pinnedStop: null, loiDocGhim: null };
      return xong();
    }
    const may = await loadMachines([comp.machineId]);
    const c = commandOf(comp, may);
    if (!c) {
      bc.b1 = { laLenh: false, robot: false, adapterId: null, machineId: comp.machineId, commandType: comp.command, pinnedStop: null, loiDocGhim: null };
      return xong();
    }
    if (isRobotKind(c.cap.adapterKind)) {
      bc.b1 = { laLenh: true, robot: true, adapterId: null, machineId: comp.machineId, commandType: c.descriptor.name, pinnedStop: null, loiDocGhim: null };
      return xong();
    }
    const args = await withDeadline(withResolvedAdapter(c.cap.adapterKind, comp.machineId, comp.args ?? {}), STOP_DB_STEP_DEADLINE_MS, `FOE boot re-send run ${x.runId} adapter lookup`);
    const cmd = buildEquipmentCommand(c.descriptor, c.cap, comp.machineId, args, `run${x.runId}-${comp.id}-a${LAN_GUI_LAI_KHOI_DONG}`, { id: 0, role: "system" });
    bc.b1 = { laLenh: true, robot: false, adapterId: cmd.adapterId ?? null, machineId: comp.machineId, commandType: cmd.name, pinnedStop: null, loiDocGhim: null };
    if (cmd.adapterId == null) return xong();
    const { phanLoaiStopGhimChoFoe } = await napDispatcher();
    const ghim = await phanLoaiStopGhimChoFoe(d, { adapterId: cmd.adapterId, commandType: cmd.name, writes: cmd.writes ?? [] });
    bc.b1.pinnedStop = ghim.pinnedStop;
    bc.b1.loiDocGhim = ghim.loiDocGhim;
    if (ghim.loiDocGhim !== null || !ghim.pinnedStop) return xong();

    // ── b2: the window, on the DB clock only ──
    dauDoBuTru("b2");
    const { dbNowMs: _bo, ...cuaSo } = await docCuaSoGuiLai(d, x.runId, x.compId);
    bc.b2 = cuaSo;
    if (bc.b2.intentAt === null || bc.b2.runCreatedAt === null) return xong();

    // ── b3: not edge-owned now; owner epoch unchanged since the run; no other command to that device since the intent (see docLenhSau:
    //    the ACCEPTED local-HMI residual risk and the single-instance assumption) ──
    dauDoBuTru("b3");
    const adapterId = cmd.adapterId;
    const [a] = hangCuaKetQua(await d.execute(sql`SELECT a."edgeNodeId" FROM public."device_adapters" a WHERE a."id" = ${adapterId}`));
    const [o] = hangCuaKetQua(
      await d.execute(sql`
        SELECT count(*)::int AS n FROM public."device_owner_changes" o
         WHERE o."deviceKind" = 'adapter' AND o."deviceId" = ${adapterId}
           AND o."changedAt" >= (SELECT r."createdAt"::timestamptz FROM public."orchestration_runs" r WHERE r."id" = ${x.runId})`),
    );
    const lenhSau = await docLenhSau(d, { runId: x.runId, compId: x.compId, adapterId, machineId: comp.machineId });
    bc.b3 = { adapterTonTai: a !== undefined, edgeNodeId: soHoacNull(a?.edgeNodeId), doiChuSoHuu: Number(o?.n ?? NaN), lenhSau };
    if (!Number.isFinite(bc.b3.doiChuSoHuu)) bc.loi = "owner-change count unreadable"; // ⇒ not sent (fail-closed)
    return xong();
  } catch (err) {
    bc.loi = String((err as Error)?.message ?? err).slice(0, 300);
    return xong();
  }
}

// ── fix round 1 (I-1) — readiness of the adapter's session before the hand-over ──────────────────────────────────────────────────────────────

/** The poll step of choKetNoiSanSang (in-memory getters; the DB is read only once the running connection exists). */
export const CHO_KET_NOI_BUOC_MS = 500;

/**
 * fix round 1 (I-1) — on a real boot rehydrate runs BEFORE the OT drivers start (index.ts: the FOE boot hook, then listenThenStartOt): a re-send
 * right away meets ADAPTER_OFFLINE / a stale connection and is NOT counted as a pinned STOP by the dispatcher. So the boot first waits until the
 * adapter's running session is the one its row names — the dispatcher's OWN check (`runningConnectionMatchesAdapterRow`, behind a cheap
 * in-memory `getActiveDriver` + fingerprint test) — woken early by `onOtGatewayStarted`, re-checked every CHO_KET_NOI_BUOC_MS, never longer than
 * `hanMs` (what is left of D). Not ready in time ⇒ { sanSang: false } (⇒ held + URGENT, nothing sent, the single try NOT consumed).
 * ⇒ A boot whose adapters connect more than D (5 min) after the STOP intent never auto-sends it (held + URGENT, a person continues it).
 */
export async function choKetNoiSanSang(
  d: Db,
  adapterId: number,
  hanMs: number,
  /** fix round 2 (m-2) — called ONCE when the session is not up at the first look (the early URGENT), with what is left of the wait (ms) */
  khiPhaiCho?: (conMs: number) => void,
): Promise<{ sanSang: boolean; choMs: number }> {
  const t0 = performance.now();
  const om = await napOtManager();
  const { runningConnectionMatchesAdapterRow } = await napDispatcher();
  let danhThuc: (() => void) | null = null;
  const boNghe = om.onOtGatewayStarted(() => danhThuc?.());
  try {
    for (;;) {
      // (fix round 2, m-2) the DB read of the dispatcher's check is bounded (a slow DB counts as not ready yet)
      if (
        om.getActiveDriver(adapterId) &&
        om.getActiveConnectionFingerprint(adapterId) &&
        (await withDeadline(runningConnectionMatchesAdapterRow(d, adapterId), STOP_DB_STEP_DEADLINE_MS, `FOE boot re-send adapter ${adapterId} connection check`).catch(() => false))
      ) {
        return { sanSang: true, choMs: Math.round(performance.now() - t0) };
      }
      const con = hanMs - (performance.now() - t0);
      if (khiPhaiCho) {
        const f = khiPhaiCho;
        khiPhaiCho = undefined;
        f(con);
      }
      if (con <= 0) return { sanSang: false, choMs: Math.round(performance.now() - t0) };
      await new Promise<void>((r) => {
        const t = setTimeout(r, Math.min(CHO_KET_NOI_BUOC_MS, con));
        danhThuc = () => {
          clearTimeout(t);
          r();
        };
      });
      danhThuc = null;
    }
  } finally {
    boNghe();
  }
}

/** fix round 2 (m-4) — the bound of the claim UPDATE and of the attempt's outcome / held writes. */
export const HAN_GHI_KET_QUA_LUOT_MS = 5 * STOP_DB_STEP_DEADLINE_MS;
/**
 * How long past its window a claimed attempt's lease lasts (evidence on the marker). fix round 2 (m-4) — it must outlast the longest attempt:
 * the window (the attempt's own bound) + its outcome write (HAN_GHI_KET_QUA_LUOT_MS) — pinned by a unit test. Ownership is NOT decided by the
 * lease (C-1): only by the boot nonce + the in-process registry.
 */
export const BIEN_LUOT_GUI_MS = 30_000;
