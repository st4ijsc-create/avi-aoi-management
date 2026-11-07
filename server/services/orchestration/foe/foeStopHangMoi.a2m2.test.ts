/**
 * SCADA R1b-2b-2a A2(m2) — unit half (no DB): the two pure decisions of foeBuTruBiNgat (which compensation was in flight; may the boot
 * re-send it) + source pins of what the DB half cannot see in one place (the DB clock only; the generic auto-resume skips these runs; the
 * boot re-send is one attempt through runCompensation with a pinned-STOP-only walk). The DB half: foeStopHangMoi.a2m2.db.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BU_TRU_BI_NGAT_CTX_KEY,
  LAN_GUI_LAI_KHOI_DONG,
  LY_DO_KHONG_GUI,
  STOP_BU_TRU_KHOI_DONG_HAN_MS,
  BIEN_LUOT_GUI_MS,
  HAN_GHI_KET_QUA_LUOT_MS,
  hanGuiLaiMs,
  hangCuaKetQua,
  phanLoaiBuTruBiNgat,
  quyetDinhGuiLai,
  type BangChungGuiLai,
} from "./foeBuTruBiNgat";
import { FOE_ACTION_TTL_MS } from "./foeRunStore";
import type { WorkflowDefinition, WorkflowStep } from "./workflowModel";

const lenh = (id: string, comp?: WorkflowStep): WorkflowStep => ({ id, type: "command", machineId: 1, command: "start", ...(comp ? { compensation: comp } : {}) }) as WorkflowStep;
const bu = (id: string): WorkflowStep => ({ id, type: "command", machineId: 1, command: "stop" }) as WorkflowStep;
const def = (steps: WorkflowStep[]): WorkflowDefinition => ({ ref: "a2m2", name: "a2m2", steps });

describe("A2(m2) — phanLoaiBuTruBiNgat: which compensation was in flight (pure)", () => {
  it("exactly ONE top-level compensation not final ⇒ mot (its step, its id, the step's error)", () => {
    for (const st of ["running", "held", "pending"]) {
      expect(phanLoaiBuTruBiNgat(def([lenh("g0"), lenh("main", bu("undo"))]), [{ stepId: "g0", status: "completed" }, { stepId: "main", status: "failed", error: "boom" }, { stepId: "undo", status: st }], {}), st).toEqual({
        kind: "mot",
        stepId: "main",
        compId: "undo",
        error: "boom",
      });
    }
  });
  it("the compensation row ABSENT while its step failed ⇒ still due (mot)", () => {
    expect(phanLoaiBuTruBiNgat(def([lenh("main", bu("undo"))]), [{ stepId: "main", status: "failed" }], {})).toMatchObject({ kind: "mot", compId: "undo" });
  });
  it("every compensation final / none started for a step that did not fail ⇒ khong ('failed' as before)", () => {
    for (const st of ["completed", "skipped", "compensated", "failed"]) {
      expect(phanLoaiBuTruBiNgat(def([lenh("main", bu("undo"))]), [{ stepId: "main", status: "failed" }, { stepId: "undo", status: st }], {}), st).toEqual({ kind: "khong" });
    }
    expect(phanLoaiBuTruBiNgat(def([lenh("main", bu("undo"))]), [{ stepId: "main", status: "completed" }], {})).toEqual({ kind: "khong" });
    expect(phanLoaiBuTruBiNgat(def([lenh("main")]), [{ stepId: "main", status: "failed" }], {})).toEqual({ kind: "khong" });
  });
  it("TWO not final ⇒ nhieu (never a guess)", () => {
    expect(
      phanLoaiBuTruBiNgat(def([lenh("m1", bu("u1")), lenh("m2", bu("u2"))]), [{ stepId: "m1", status: "failed" }, { stepId: "u1", status: "running" }, { stepId: "m2", status: "failed" }, { stepId: "u2", status: "running" }], {}),
    ).toEqual({ kind: "nhieu", compIds: ["u1", "u2"] });
  });
  it("ONE but nested / step row not failed / definition unreadable with live rows / a gate rejection's unwind ⇒ khongRo", () => {
    const nested = def([{ id: "par", type: "parallel", steps: [lenh("main", bu("undo"))] } as WorkflowStep]);
    expect(phanLoaiBuTruBiNgat(nested, [{ stepId: "main", status: "failed" }, { stepId: "undo", status: "running" }], {})).toMatchObject({ kind: "khongRo", lyDo: "nested" });
    expect(phanLoaiBuTruBiNgat(def([lenh("main", bu("undo"))]), [{ stepId: "main", status: "completed" }, { stepId: "undo", status: "running" }], {})).toMatchObject({ kind: "khongRo", lyDo: "stepRowNotFailed" });
    expect(phanLoaiBuTruBiNgat(null, [{ stepId: "undo", status: "running" }], {})).toMatchObject({ kind: "khongRo", lyDo: "definitionUnreadable", compIds: ["undo"] });
    expect(phanLoaiBuTruBiNgat(null, [{ stepId: "main", status: "failed" }], {})).toEqual({ kind: "khong" }); // nothing live ⇒ as before
    expect(phanLoaiBuTruBiNgat(def([lenh("main", bu("undo"))]), [{ stepId: "main", status: "failed" }, { stepId: "undo", status: "running" }], { foeRejectClaim: "t" })).toMatchObject({ kind: "khongRo", lyDo: "rejectionUnwind" });
  });
});

/** Facts of a re-sendable pinned STOP compensation (every check passes). */
function duBangChung(): BangChungGuiLai {
  return {
    runId: 7,
    stepId: "main",
    compId: "undo",
    daThuGuiLai: false,
    foeBat: true,
    dinhNghiaKhop: true,
    b1: { laLenh: true, robot: false, adapterId: 3, machineId: 1, commandType: "stop", pinnedStop: true, loiDocGhim: null },
    b2: { intentAt: "2026-11-03 05:00:00", dbNow: "2026-11-03 05:00:10+00", hanMs: 300_000, authExpiresAt: null, tuoiMs: 10_000, conLaiMs: 290_000, runCreatedAt: "2026-11-03 04:59:00" },
    b3: { adapterTonTai: true, edgeNodeId: null, doiChuSoHuu: 0, lenhSau: [] },
    loi: null,
  };
}

describe("A2(m2) — quyetDinhGuiLai: the boot re-sends ONLY when every check holds (pure)", () => {
  it("all of b1–b3 hold ⇒ gui, with what is left of the window", () => {
    expect(quyetDinhGuiLai(duBangChung())).toEqual({ gui: true, conLaiMs: 290_000 });
  });
  const tung: Array<[string, (b: BangChungGuiLai) => void, keyof typeof LY_DO_KHONG_GUI]> = [
    ["a lookup error", (b) => (b.loi = "x"), "loiTraCuu"],
    ["already attempted once", (b) => (b.daThuGuiLai = true), "daGuiLaiMotLan"],
    ["FOE off", (b) => (b.foeBat = false), "foeTat"],
    ["redeployed", (b) => (b.dinhNghiaKhop = false), "dinhNghiaDaDoi"],
    ["b1 not a command", (b) => (b.b1 = null), "khongPhaiLenh"],
    ["b1 robot", (b) => (b.b1!.robot = true), "robot"],
    ["b1 no adapter", (b) => (b.b1!.adapterId = null), "khongCoAdapter"],
    ["b1 pins unreadable", (b) => (b.b1!.loiDocGhim = "boom"), "khongDocDuocGhim"],
    ["b1 content / unpinned stop (pinnedStop false)", (b) => (b.b1!.pinnedStop = false), "khongPhaiStopGhim"],
    ["b1 pinned unknown (null)", (b) => (b.b1!.pinnedStop = null), "khongPhaiStopGhim"],
    ["b2 no intent row", (b) => (b.b2!.intentAt = null), "khongCoThoiDiemYDinh"],
    ["b2 no age", (b) => (b.b2!.tuoiMs = null), "khongCoThoiDiemYDinh"],
    ["b2 no run row", (b) => (b.b2!.runCreatedAt = null), "khongCoThoiDiemYDinh"],
    ["b2 intent in the DB's future", (b) => (b.b2!.tuoiMs = -1), "dongHoBatThuong"],
    ["b2 window closed", (b) => (b.b2!.conLaiMs = 0), "quaHan"],
    ["b3 not read", (b) => (b.b3 = null), "khongCoAdapterCsdl"],
    ["b3 adapter gone", (b) => (b.b3!.adapterTonTai = false), "khongCoAdapterCsdl"],
    ["b3 edge-owned", (b) => (b.b3!.edgeNodeId = 4), "thietBiThuocEdge"],
    ["b3 owner changed", (b) => (b.b3!.doiChuSoHuu = 1), "chuSoHuuDaDoi"],
    ["b3 a later command", (b) => (b.b3!.lenhSau = [{ id: 1, status: "acked", actionId: null }]), "coLenhSau"],
  ];
  for (const [ten, sua, lyDo] of tung) {
    it(`${ten} ⇒ NOT sent (${lyDo})`, () => {
      const b = duBangChung();
      sua(b);
      expect(quyetDinhGuiLai(b)).toEqual({ gui: false, lyDo });
      expect(LY_DO_KHONG_GUI[lyDo]).toEqual(expect.any(String));
    });
  }
  it("D = 5 min, never beyond the engine authorisation lifetime; the boot key is attempt 2", () => {
    expect(STOP_BU_TRU_KHOI_DONG_HAN_MS).toBe(300_000);
    expect(hanGuiLaiMs()).toBe(Math.min(300_000, FOE_ACTION_TTL_MS));
    expect(hanGuiLaiMs()).toBeLessThanOrEqual(FOE_ACTION_TTL_MS);
    expect(LAN_GUI_LAI_KHOI_DONG).toBe(2);
    expect(BU_TRU_BI_NGAT_CTX_KEY).toBe("foeBuTruBiNgat");
  });
});

describe("A2(m2) fix round 1 — m-3 / m-4 (pure)", () => {
  it("m-3: a NOT-final row that names no step of the definition (renamed / redeployed) ⇒ khongRo definitionChanged (failed + URGENT, never silent)", () => {
    expect(phanLoaiBuTruBiNgat(def([lenh("main", bu("undo"))]), [{ stepId: "mainOld", status: "failed" }, { stepId: "undoOld", status: "running" }], {})).toEqual({
      kind: "khongRo",
      lyDo: "definitionChanged",
      compIds: ["undoOld"],
    });
    // final rows of renamed steps and the abort sweep's own rows are not "lost"
    expect(phanLoaiBuTruBiNgat(def([lenh("main", bu("undo"))]), [{ stepId: "mainOld", status: "failed" }, { stepId: "abort:x", status: "running" }], {})).toEqual({ kind: "khong" });
  });
  it("m-4: an unexpected result shape THROWS (a lookup error ⇒ not sent), never an empty list read as 'no later command'", () => {
    expect(hangCuaKetQua([{ a: 1 }])).toEqual([{ a: 1 }]);
    expect(hangCuaKetQua({ rows: [{ a: 2 }] })).toEqual([{ a: 2 }]);
    for (const x of [{}, null, undefined, { rows: "x" }, 7]) expect(() => hangCuaKetQua(x), String(x)).toThrow(/unexpected database result shape/);
  });
  it("m-4 (fix round 2): the lease outlasts the longest attempt (its window bound + the outcome write); the claim is bounded and its time is taken off the window", () => {
    expect(BIEN_LUOT_GUI_MS).toBeGreaterThan(HAN_GHI_KET_QUA_LUOT_MS);
    const src = readFileSync(resolve(__dirname, "./foeEngine.ts"), "utf8").replace(/\r\n/g, "\n");
    expect(src).toContain("const conLaiLuot = conLai - (performance.now() - tXetLai);");
    expect(src).toContain("withDeadline(guiLaiBuTruLucKhoiDong(run.id, k, b.def, nonce, huy), Math.max(1, conLaiLuot)");
    expect(src).toContain("        HAN_GHI_KET_QUA_LUOT_MS,\n        `FOE boot re-send run ${run.id} claim`,");
  });
  it("C-1 / I-1 (fix round 2): ownership of a live attempt = this process's boot nonce + its in-process registry; the abort handle exists before the attempt's first await", () => {
    const src = readFileSync(resolve(__dirname, "./foeEngine.ts"), "utf8").replace(/\r\n/g, "\n");
    expect(src).toContain("hienTai?.bootLuot === FOE_BOOT_NONCE && luotDangChay.has(dang)");
    expect(src).toContain("const huy: HuyLuotGui = { expired: false, controller: new AbortController() };");
    const i = src.indexOf("async function guiLaiBuTruLucKhoiDong(");
    const body = src.slice(i, src.indexOf("\n}\n", i));
    expect(body.indexOf("if (daHet()) return huyBo();")).toBeGreaterThan(-1);
    expect(body.indexOf("if (daHet()) return huyBo();")).toBeLessThan(body.indexOf("await getDb()"));
    expect(body).toContain("rc.controller = huy.controller;");
  });
  it("C-1: D stays 5 min, the single constant", () => {
    expect(STOP_BU_TRU_KHOI_DONG_HAN_MS).toBe(5 * 60_000);
  });
});

describe("A2(m2) — source pins", () => {
  const nguon = (p: string) => readFileSync(resolve(__dirname, p), "utf8").replace(/\r\n/g, "\n");
  const fnBody = (src: string, head: string) => {
    const i = src.indexOf(head);
    expect(i, head).toBeGreaterThan(-1);
    const j = src.indexOf("\n}\n", i);
    return src.slice(i, j);
  };
  it("b2 is on the DB clock: the collector and its readers compare in SQL on now() and never read the process clock; m-1: both bounds as instants", () => {
    const src = nguon("./foeBuTruBiNgat.ts");
    for (const head of ["export async function xetGuiLaiBuTruBiNgat(", "export async function docCuaSoGuiLai(", "export async function docLenhSau("]) {
      expect(fnBody(src, head), head).not.toMatch(/Date\.now|new Date\(/);
    }
    const body = fnBody(src, "export async function docCuaSoGuiLai(");
    expect(body).toMatch(/now\(\) - c\."createdAt"::timestamptz/);
    // m-1 — "createdAt" (DEFAULT now(): the session zone's wall time) as the session zone; "expiresAt" (drizzle: the UTC wall time) AT TIME ZONE 'UTC'
    expect(body).toContain(`LEAST(c."createdAt"::timestamptz + (\${hanMs}::float8 * interval '1 millisecond'), a."authExpiresAt" AT TIME ZONE 'UTC') - now()`);
  });
  it("the generic FOE_DURABLE auto-resume never continues a run held for an interrupted compensation", () => {
    const body = fnBody(nguon("./foeEngine.ts"), "export async function autoResumeInterruptedRuns(");
    expect(body).toContain("if (BU_TRU_BI_NGAT_CTX_KEY in ctx) continue;");
  });
  it("the boot re-send is ONE runCompensation (attempt 2) on a pinned-STOP-only walk, and execCommand refuses a non-pinned dispatch there", () => {
    const src = nguon("./foeEngine.ts");
    const gui = fnBody(src, "async function guiLaiBuTruLucKhoiDong(");
    expect(gui.match(/runCompensation\(/g)).toHaveLength(1);
    expect(gui).toContain("rc.chiGuiStopGhim = true;");
    expect(gui).toContain("{ attempt: LAN_GUI_LAI_KHOI_DONG }");
    expect(gui).not.toMatch(/getActiveDriver|writeTags|dispatch\(/); // never a shortcut around the dispatcher
    // A2(n) Q-6: execCommand is the one hand-over around the body; the body is the only way in, so the check still stands on every dispatch
    expect(fnBody(src, "async function execCommand(")).toContain("await execCommandMot(rc, step, attempt, giao, tt)");
    const exec = fnBody(src, "async function execCommandMot(");
    expect(exec).toContain("if (rc.chiGuiStopGhim && auth.stopGhim !== true) {");
  });
});
