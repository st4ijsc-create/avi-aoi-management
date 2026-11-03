/**
 * SCADA R1b-2b-2a A2(l) — THE set of machines whose `targetMachineId` interlock rules a robot MOTION must satisfy, read from WHERE the robot is.
 *
 * Hole (before A2(l)): the robot gate asked `evaluateInterlockGate({ adapterId: -1, machineId: robotId })` — a ROBOT id compared with
 * `interlock_rules."targetMachineId"`, a MACHINE id. A rule on machine N blocked robot N (DEV: robots 1–3 share their ids with machines
 * SPI / AOI / AVI), and a rule on the machine(s) where the robot works never applied to it.
 *
 * Rule (coordinator, A2(l) option (B) — no migration, the `ot/safetyTarget.ts` precedent, stricter only):
 *   • `robots."stationId"` set ⇒ the machines of THAT station (its `lineId`, when also set, must agree; otherwise the place is contradictory);
 *     fix round 1 (m3, controller ruling): a station with NO machine rows ⇒ the machines of that station's LINE (`tramKhongMay: true` — never
 *     silently unguarded; same "possibly anywhere on the line" reasoning). If the line has none either ⇒ an empty set, and the preview says
 *     "no machines to check" (not "clear");
 *   • only `robots."lineId"` ⇒ EVERY machine of that line (over-blocking accepted — decision (1): a line-level robot may be at any station);
 *   • neither, or a station / line that does not exist, or a contradictory pair ⇒ UNPLACED: MOTION refused with `ROBOT_CHUA_DINH_VI`
 *     (decision (2)), the gate is not consulted;
 *   • a lookup error (no DB, query failure) ⇒ `loi`: MOTION refused fail-closed (INTERLOCK_BLOCKED, failClosed).
 * The robot id is NEVER passed as a machine id. The resolver reads through the db handle it is given (a ROLLBACK transaction in tests) and never
 * throws. Machines are taken whatever their `isActive` (stricter: a rule on a machine that is still on the floor keeps applying).
 *
 * Used by the three robot interlock call sites — robotCommandDispatcher (4b, MOTION only), robotRouter.interlockPreview and
 * edgeAuthorizeCentral.robotGates — always as `danhGiaInterlockRobot(await tapMayChoRobot(db, robotId))` (pinned by tapMayChoRobot.a2l.test.ts,
 * source scan). L-7: a STOP never reaches any of them (dispatcher `if (motion)`, edge step 5, the preview is a motion preview).
 * Own module ON PURPOSE (like tapMayChoInterlock.ts): many suites replace `./interlockGate` with a factory mock that would not carry these exports.
 */
import { asc, eq, inArray } from "drizzle-orm";
import type { getDb } from "../../db/connection";
import { machines, productionLines, robots, stations, interlockRules } from "../../../drizzle/schema";
import type { InterlockGateResult, InterlockGateTarget } from "./interlockGate";

/**
 * A robot has no device_adapters row: -1 can never equal a device_adapters.id (serial ≥ 1) nor an interlockRouter targetAdapterId
 * (z.number().int().positive()), so an adapter- or tag-targeted OT rule never blocks a robot by accident. (Moved here from
 * robotCommandDispatcher, which re-exports it.)
 */
export const ROBOT_NO_OT_ADAPTER_ID = -1;

/** Refusal code of MOTION to a robot whose place (station / line) is unknown, dangling or contradictory — A2(l) decision (2). STOP unaffected. */
export const ROBOT_CHUA_DINH_VI = "ROBOT_CHUA_DINH_VI" as const;

export type LyDoChuaDinhVi = "khong_co_robot" | "khong_vi_tri" | "tram_khong_ton_tai" | "chuyen_khong_ton_tai" | "mau_thuan";

export type ViTriRobot =
  | { loai: "tram"; robotId: number; stationId: number; lineId: number; machineIds: number[]; tramKhongMay?: true }
  | { loai: "chuyen"; robotId: number; lineId: number; machineIds: number[] }
  | { loai: "chua_dinh_vi"; robotId: number; lyDo: LyDoChuaDinhVi }
  | { loai: "loi"; robotId: number; loi: string };

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
/** Anything with drizzle's `select` (the pool, or a transaction). */
export type DbDoc = Pick<Db, "select">;

function boTrung(ids: Array<number | null | undefined>): number[] {
  const out: number[] = [];
  for (const m of ids) if (typeof m === "number" && Number.isSafeInteger(m) && !out.includes(m)) out.push(m);
  return out.sort((a, b) => a - b);
}

/** Every machine of every station of line `lineId` (any isActive), sorted, de-duplicated. Throws on a DB error (the caller turns it into `loi`). */
async function mayCuaChuyen(d: DbDoc, lineId: number): Promise<number[]> {
  const ms = await d
    .select({ id: machines.id })
    .from(machines)
    .innerJoin(stations, eq(stations.id, machines.stationId))
    .where(eq(stations.lineId, lineId))
    .orderBy(asc(machines.id));
  return boTrung(ms.map((m) => m.id));
}

/** WHERE the robot is ⇒ the machine set its MOTION is gated by. Never throws: an error is `{ loai: "loi" }` (the caller refuses motion). */
export async function tapMayChoRobot(d: DbDoc | null | undefined, robotId: number): Promise<ViTriRobot> {
  if (!Number.isSafeInteger(robotId) || robotId <= 0) return { loai: "chua_dinh_vi", robotId, lyDo: "khong_co_robot" };
  try {
    if (!d || typeof d.select !== "function") return { loai: "loi", robotId, loi: "DB unavailable" };
    const [r] = await d.select({ lineId: robots.lineId, stationId: robots.stationId }).from(robots).where(eq(robots.id, robotId)).limit(1);
    if (!r) return { loai: "chua_dinh_vi", robotId, lyDo: "khong_co_robot" };
    if (r.stationId != null) {
      const [s] = await d.select({ id: stations.id, lineId: stations.lineId }).from(stations).where(eq(stations.id, r.stationId)).limit(1);
      if (!s) return { loai: "chua_dinh_vi", robotId, lyDo: "tram_khong_ton_tai" };
      if (r.lineId != null && r.lineId !== s.lineId) return { loai: "chua_dinh_vi", robotId, lyDo: "mau_thuan" };
      const ms = await d.select({ id: machines.id }).from(machines).where(eq(machines.stationId, s.id)).orderBy(asc(machines.id));
      if (ms.length > 0) return { loai: "tram", robotId, stationId: s.id, lineId: s.lineId, machineIds: boTrung(ms.map((m) => m.id)) };
      // m3 — a station with no machine: the rules on its LINE apply (stricter than an empty, never-blocked set)
      return { loai: "tram", robotId, stationId: s.id, lineId: s.lineId, machineIds: await mayCuaChuyen(d, s.lineId), tramKhongMay: true };
    }
    if (r.lineId != null) {
      const [l] = await d.select({ id: productionLines.id }).from(productionLines).where(eq(productionLines.id, r.lineId)).limit(1);
      if (!l) return { loai: "chua_dinh_vi", robotId, lyDo: "chuyen_khong_ton_tai" };
      return { loai: "chuyen", robotId, lineId: l.id, machineIds: await mayCuaChuyen(d, l.id) };
    }
    return { loai: "chua_dinh_vi", robotId, lyDo: "khong_vi_tri" };
  } catch (err) {
    return { loai: "loi", robotId, loi: String((err as Error)?.message ?? err).slice(0, 160) };
  }
}

/** The gate key of a PLACED robot: no real adapter, no tag key, the machines of its place; the robot id travels separately (cap alert only). */
export function dichInterlockRobot(viTri: Extract<ViTriRobot, { loai: "tram" | "chuyen" }>): InterlockGateTarget {
  return { adapterId: ROBOT_NO_OT_ADAPTER_ID, machineIds: [...viTri.machineIds], tagKeys: [], robotId: viTri.robotId };
}

export interface KetQuaInterlockRobot extends InterlockGateResult {
  viTri: ViTriRobot;
  /** present ⇔ refused because the robot's place is unknown (the gate was NOT consulted). */
  maTuChoi?: typeof ROBOT_CHUA_DINH_VI;
}

/**
 * THE decision of the robot interlock for a MOTION, from the robot's place: unplaced ⇒ refused `ROBOT_CHUA_DINH_VI`; lookup error ⇒ refused
 * fail-closed; placed ⇒ `evaluateInterlockGate` on the place's machine set. Never throws (fail-closed).
 */
export async function danhGiaInterlockRobot(viTri: ViTriRobot): Promise<KetQuaInterlockRobot> {
  if (viTri.loai === "loi") return { blocked: true, failClosed: true, violations: [], viTri };
  if (viTri.loai === "chua_dinh_vi") return { blocked: true, failClosed: false, violations: [], viTri, maTuChoi: ROBOT_CHUA_DINH_VI };
  try {
    const { evaluateInterlockGate } = await import("./interlockGate");
    const g = await evaluateInterlockGate(dichInterlockRobot(viTri));
    return { ...g, viTri };
  } catch {
    return { blocked: true, failClosed: true, violations: [], viTri };
  }
}

/** English one-liner of an unplaced / error result (ledger / edge refusal text; the console shows the localised code). */
export function moTaViTriKhongDung(viTri: ViTriRobot): string {
  if (viTri.loai === "loi") return `robot ${viTri.robotId} placement lookup error (${viTri.loi}) — fail-closed`;
  if (viTri.loai !== "chua_dinh_vi") return `robot ${viTri.robotId} placed`;
  const why: Record<LyDoChuaDinhVi, string> = {
    khong_co_robot: "the robot row does not exist",
    khong_vi_tri: "the robot has neither a station nor a line",
    tram_khong_ton_tai: "its station does not exist",
    chuyen_khong_ton_tai: "its line does not exist",
    mau_thuan: "its station belongs to another line than its line",
  };
  return `${ROBOT_CHUA_DINH_VI}: robot ${viTri.robotId} is not placed (${why[viTri.lyDo]}) — the machines whose interlock rules guard it are unknown`;
}

export interface LyDoViPhamRobot {
  ruleId: number;
  /** the machine of the robot's place the rule targets (null if the rule row could not be read) */
  machineId: number | null;
  machineCode: string | null;
  /** true ⇔ the rule matched through the robot's LINE (a line-level robot, or a station with no machines — m3), not its station */
  cungChuyen: boolean;
}

/**
 * For the console preview (A2(l) decision (1)): per violation, the machine of the robot's place that the rule targets, and whether it matched
 * because the robot is line-level ("rule on machine X (same line)"). Read-only; a read error ⇒ machine unknown (null), never throws.
 */
export async function lyDoViPhamRobot(d: DbDoc | null | undefined, kq: KetQuaInterlockRobot): Promise<LyDoViPhamRobot[]> {
  const cungChuyen = kq.viTri.loai === "chuyen" || (kq.viTri.loai === "tram" && kq.viTri.tramKhongMay === true);
  const ids = kq.violations.map((v) => v.ruleId).filter((x) => Number.isSafeInteger(x));
  const byRule = new Map<number, { machineId: number | null; machineCode: string | null }>();
  if (d && ids.length > 0) {
    try {
      const rows = await d
        .select({ id: interlockRules.id, machineId: interlockRules.targetMachineId, machineCode: machines.code })
        .from(interlockRules)
        .leftJoin(machines, eq(machines.id, interlockRules.targetMachineId))
        .where(inArray(interlockRules.id, ids));
      for (const r of rows) byRule.set(r.id, { machineId: r.machineId ?? null, machineCode: r.machineCode ?? null });
    } catch {
      /* machine unknown — the violation itself is still shown */
    }
  }
  return kq.violations.map((v) => ({ ruleId: v.ruleId, machineId: byRule.get(v.ruleId)?.machineId ?? null, machineCode: byRule.get(v.ruleId)?.machineCode ?? null, cungChuyen }));
}

/**
 * fix round 1 (m3) — what the console says besides the verdict: `khongCoMay` ⇔ the robot is placed but its set is EMPTY (no machine on its
 * station nor on its line ⇒ no machine rule can guard it: "no machines to check", never "clear"); `tramKhongMay` ⇔ its station has no machine
 * and the rules of line `lineId` apply.
 */
export function ghiChuViTri(viTri: ViTriRobot): { khongCoMay: boolean; tramKhongMay: boolean; lineId: number | null } {
  if (viTri.loai !== "tram" && viTri.loai !== "chuyen") return { khongCoMay: false, tramKhongMay: false, lineId: null };
  return { khongCoMay: viTri.machineIds.length === 0, tramKhongMay: viTri.loai === "tram" && viTri.tramKhongMay === true, lineId: viTri.lineId };
}
