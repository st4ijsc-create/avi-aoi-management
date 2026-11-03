/**
 * SCADA R1b-2b-2a A2(l) — the robot interlock gate never compares a robot id with machine ids; it gates robot MOTION by the machines WHERE the
 * robot is (tapMayChoRobot). Unit form (no DB): the composition `danhGiaInterlockRobot`, the gate key `dichInterlockRobot`, the cap alert naming
 * the robot by its own id, and the SOURCE census of the three call sites (dispatcher 4b, robot.interlockPreview, edge robotGates).
 * The decision table on real rows, the three sites end-to-end and the L-7 STOP pin live in tapMayChoRobot.a2l.db.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const H = vi.hoisted(() => ({ calls: [] as unknown[], verdict: { blocked: false, failClosed: false, violations: [] as unknown[] } as Record<string, unknown>, nem: false }));
vi.mock("./interlockGate", () => ({
  evaluateInterlockGate: vi.fn(async (p: unknown) => {
    H.calls.push(p);
    if (H.nem) throw new Error("gate exploded");
    return H.verdict;
  }),
}));

import { danhGiaInterlockRobot, dichInterlockRobot, moTaViTriKhongDung, ROBOT_CHUA_DINH_VI, ROBOT_NO_OT_ADAPTER_ID, tapMayChoRobot, type ViTriRobot } from "./tapMayChoRobot";

const ROOT = path.resolve(__dirname, "../../..");
const src = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
/** the code of a file without its block comments and whole-line `//` comments (the census reads code, not prose that names the old shape) */
const ma = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const ROBOT = "server/services/robot/robotCommandDispatcher.ts";
const ROUTER = "server/routers/robotRouter.ts";
const AUTH = "server/services/edge/edgeAuthorizeCentral.ts";

beforeEach(() => {
  H.calls = [];
  H.verdict = { blocked: false, failClosed: false, violations: [] };
  H.nem = false;
});

describe("A2(l) — danhGiaInterlockRobot: the decision from the robot's place", () => {
  it("R2 placed at a station ⇒ the gate is asked for THAT station's machines, adapter -1, no tag, the robot id separately — never machineId = robotId", async () => {
    const r = await danhGiaInterlockRobot({ loai: "tram", robotId: 2, stationId: 40, lineId: 4, machineIds: [11, 12] });
    expect(H.calls).toEqual([{ adapterId: -1, machineIds: [11, 12], tagKeys: [], robotId: 2 }]);
    expect(H.calls[0]).not.toHaveProperty("machineId");
    expect(r).toMatchObject({ blocked: false, failClosed: false, violations: [] });
    expect(r.maTuChoi).toBeUndefined();
  });

  it("R3 line-level ⇒ every machine of the line; a violation passes through blocked", async () => {
    H.verdict = { blocked: true, failClosed: false, violations: [{ ruleId: 9, ruleName: "R9", action: "stop_line" }] };
    const r = await danhGiaInterlockRobot({ loai: "chuyen", robotId: 1, lineId: 4, machineIds: [11, 12, 13] });
    expect(H.calls).toEqual([{ adapterId: -1, machineIds: [11, 12, 13], tagKeys: [], robotId: 1 }]);
    expect(r).toMatchObject({ blocked: true, failClosed: false, violations: [{ ruleId: 9 }] });
  });

  it.each<[string, ViTriRobot]>([
    ["no station, no line", { loai: "chua_dinh_vi", robotId: 3, lyDo: "khong_vi_tri" }],
    ["dangling station", { loai: "chua_dinh_vi", robotId: 3, lyDo: "tram_khong_ton_tai" }],
    ["dangling line", { loai: "chua_dinh_vi", robotId: 3, lyDo: "chuyen_khong_ton_tai" }],
    ["contradictory station / line", { loai: "chua_dinh_vi", robotId: 3, lyDo: "mau_thuan" }],
    ["no robot row", { loai: "chua_dinh_vi", robotId: 3, lyDo: "khong_co_robot" }],
  ])("R4 unplaced (%s) ⇒ blocked with ROBOT_CHUA_DINH_VI, the gate is NOT consulted", async (_n, viTri) => {
    const r = await danhGiaInterlockRobot(viTri);
    expect(r).toMatchObject({ blocked: true, failClosed: false, violations: [], maTuChoi: ROBOT_CHUA_DINH_VI });
    expect(H.calls).toEqual([]);
    expect(moTaViTriKhongDung(viTri)).toContain("ROBOT_CHUA_DINH_VI");
  });

  it("R5 lookup error ⇒ blocked fail-closed (no maTuChoi), gate not consulted; the gate throwing ⇒ fail-closed too", async () => {
    const r = await danhGiaInterlockRobot({ loai: "loi", robotId: 3, loi: "connection reset" });
    expect(r).toMatchObject({ blocked: true, failClosed: true, violations: [] });
    expect(r.maTuChoi).toBeUndefined();
    expect(H.calls).toEqual([]);
    H.nem = true;
    expect(await danhGiaInterlockRobot({ loai: "tram", robotId: 2, stationId: 1, lineId: 1, machineIds: [5] })).toMatchObject({ blocked: true, failClosed: true });
  });

  it("R5 resolver: no DB / a select that throws ⇒ { loai: 'loi' } (never throws); a non-positive robot id ⇒ unplaced without a query", async () => {
    expect(await tapMayChoRobot(null, 5)).toMatchObject({ loai: "loi", robotId: 5 });
    const nem = { select: () => { throw new Error("pool exhausted"); } } as never;
    expect(await tapMayChoRobot(nem, 5)).toMatchObject({ loai: "loi", robotId: 5, loi: "pool exhausted" });
    let hoi = 0;
    const dem = { select: () => { hoi++; throw new Error("x"); } } as never;
    expect(await tapMayChoRobot(dem, -1)).toEqual({ loai: "chua_dinh_vi", robotId: -1, lyDo: "khong_co_robot" });
    expect(hoi).toBe(0);
  });

  it("dichInterlockRobot copies the set (the caller cannot mutate the resolver's array through the gate key)", () => {
    const v = { loai: "tram" as const, robotId: 2, stationId: 1, lineId: 1, machineIds: [5] };
    const d = dichInterlockRobot(v);
    expect(d.machineIds).not.toBe(v.machineIds);
    expect(ROBOT_NO_OT_ADAPTER_ID).toBe(-1);
  });
});

function prodFiles(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) prodFiles(p, out);
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) && !/^__/.test(n)) out.push(p);
  }
  return out;
}

describe("A2(l) census — the robot id is never a machine id; the three robot sites use the ONE resolver", () => {
  const files = prodFiles(path.join(ROOT, "server"));

  it("no production file under server/ still has robotInterlockTarget, and no interlock gate call passes machineId = a robot id", () => {
    expect(files.length).toBeGreaterThan(500);
    const bad: string[] = [];
    for (const f of files) {
      const t = ma(readFileSync(f, "utf8"));
      if (/robotInterlockTarget/.test(t)) bad.push(`${path.relative(ROOT, f)}: robotInterlockTarget`);
      if (/evaluateInterlockGate\(\{[^}]*\bmachineId:\s*(?:input\.)?robotId\b/.test(t)) bad.push(`${path.relative(ROOT, f)}: machineId: robotId`);
      if (/\bmachineId:\s*(?:input\.|rb\.)?robotId\b/.test(t) && /evaluateInterlockGate/.test(t)) bad.push(`${path.relative(ROOT, f)}: machineId: robotId near the gate`);
    }
    expect(bad).toEqual([]);
  });

  it("the robot files never call evaluateInterlockGate directly — only danhGiaInterlockRobot(await tapMayChoRobot(<db>, <robot>))", () => {
    const dispatcher = ma(src(ROBOT));
    expect(dispatcher).not.toMatch(/evaluateInterlockGate/);
    expect(dispatcher.match(/danhGiaInterlockRobot\(/g)).toHaveLength(1);
    expect(dispatcher).toMatch(/const gate = await danhGiaInterlockRobot\(await tapMayChoRobot\(await getDb\(\), input\.robotId\)\);/);

    const router = ma(src(ROUTER));
    expect(router).not.toMatch(/evaluateInterlockGate/);
    expect(router.match(/danhGiaInterlockRobot\(/g)).toHaveLength(1);
    expect(router).toMatch(/const gate = await danhGiaInterlockRobot\(await tapMayChoRobot\(db, mucTieu\)\);/);

    const auth = ma(src(AUTH));
    expect(auth.match(/danhGiaInterlockRobot\(/g)).toHaveLength(1);
    expect(auth).toMatch(/const g = await danhGiaInterlockRobot\(await tapMayChoRobot\(d, robotId\)\);/);
    // the only gate call left in the edge file is the OT one (otGates)
    expect(auth.match(/evaluateInterlockGate\(/g)).toHaveLength(1);
    expect(auth).toMatch(/evaluateInterlockGate\(\{ adapterId, machineIds: tapMayChoInterlock\(adapter\.machineId, rb\.machineId\)/);
  });

  it("the only production callers of tapMayChoRobot / danhGiaInterlockRobot are those three files", () => {
    const users = files
      .filter((f) => !f.endsWith(`${path.sep}tapMayChoRobot.ts`))
      .filter((f) => /\b(?:tapMayChoRobot|danhGiaInterlockRobot)\(/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f).split(path.sep).join("/"))
      .sort();
    expect(users).toEqual([ROUTER, AUTH, ROBOT].sort());
  });

  it("L-7 (R8, source): dispatcher — the resolver + gate run INSIDE `if (motion) {`; edge — a robot STOP returns at step 5, before robotGates", () => {
    const t = src(ROBOT);
    const i = t.indexOf("const gate = await danhGiaInterlockRobot(");
    expect(i).toBeGreaterThan(-1);
    const before = t.slice(0, i);
    const blockOpen = before.lastIndexOf("\n  if (");
    expect(before.slice(blockOpen, blockOpen + 18)).toBe("\n  if (motion) {\n ");
    // nothing closes that block between its opening and the call
    expect(before.slice(blockOpen).match(/\n  \}/g)).toBeNull();

    const auth = src(AUTH);
    const stopReturn = auth.indexOf('if (rb.kind === "robot" && rb.isStop) return edgeError("stop_needs_no_authorization"');
    expect(stopReturn).toBeGreaterThan(-1);
    const callRobotGates = auth.indexOf("await robotGates(d, node.nodeId, rb,");
    expect(callRobotGates).toBeGreaterThan(stopReturn);
    // inside robotGates the interlock runs only on the real path
    const rg = auth.slice(auth.indexOf("export async function robotGates("), auth.indexOf("export async function otGates("));
    const ifReal = rg.indexOf("  if (real) {");
    expect(ifReal).toBeGreaterThan(-1);
    expect(rg.indexOf("danhGiaInterlockRobot(")).toBeGreaterThan(ifReal);
  });
});

describe("A2(l) (3) — the interlock engine's safety-audit row no longer stores a machine id as the robot id", () => {
  it("source: the safety-audit record() passes robotId: null and names the machines in notes", () => {
    const t = src("server/services/interlock/interlockEngine.ts");
    const i = t.indexOf('void import("../safety/safetyAuditService")');
    expect(i).toBeGreaterThan(-1);
    const block = t.slice(i, t.indexOf(".catch(", i));
    expect(block).toMatch(/robotId: null,/);
    expect(block).not.toMatch(/robotId: rule\./);
    expect(block).toMatch(/target machine \$\{rule\.targetMachineId \?\? "-"\}/);
  });
});
