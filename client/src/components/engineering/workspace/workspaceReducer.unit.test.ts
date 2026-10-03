/**
 * doc 81 Đợt 2 Task 12 — reducer thuần của WorkspaceContext (IDE `/engineering`).
 *
 * Trọng tâm: CHUỖI RESET (Review Focus #2). Trên mã cũ chuỗi này nằm rải ở 1 handler + 3 effect:
 *   · bấm project khác  ⇒ setProjectId; setArtifactId(null); setBuildId(null); setSimResult(null); setDiagnostics(null)
 *   · effect [artifactId] ⇒ setBuildId(null); setSimResult(null); setDiagnostics(null)   (WS-05)
 *   · effect [projectId]  ⇒ setWatching(false); setFleetDeviceIds([])
 * Reducer phải tái hiện ĐÚNG các hệ quả đó (kể cả chỗ cũ KHÔNG reset), không hơn không kém.
 */
import { describe, expect, it } from "vitest";
import {
  initialWorkspaceState,
  workspaceReducer,
  type WorkspaceAction,
  type WorkspaceState,
} from "./workspaceReducer";

const run = (s: WorkspaceState, ...actions: WorkspaceAction[]) => actions.reduce(workspaceReducer, s);

/** P1 đã chọn, phiên bản 11, build 5, đã kiểm tra + mô phỏng, đang theo dõi, đã chọn máy đội. */
function armed(): WorkspaceState {
  return run(
    initialWorkspaceState,
    { type: "project/select", projectId: 1 },
    { type: "artifact/select", artifactId: 11 },
    { type: "diagnostics/set", artifactId: 11, diagnostics: [{ severity: "error", message: "E1" }] },
    { type: "build/select", buildId: 5 },
    { type: "sim/set", buildId: 5, simResult: { ok: true, warnings: ["W"], timeline: [] } },
    { type: "watch/set", watching: true },
    { type: "fleet/toggleDevice", deviceId: 3 },
    { type: "code/set", code: "A\nB" },
    { type: "deploy/set", patch: { signOff: true, stage: "production", approverId: "9", reason: "r" } },
  );
}

describe("trạng thái đầu = giá trị useState cũ", () => {
  it("khớp từng trường", () => {
    expect(initialWorkspaceState).toEqual({
      projectId: null,
      artifactId: null,
      buildId: null,
      diagnostics: null,
      simResult: null,
      watching: false,
      explorer: { search: "", kindFilter: "all" },
      code: "",
      language: "text",
      editorMode: "code",
      diffBaseId: null,
      diffCompareId: null,
      pendingNav: null,
      deleteSymTarget: null,
      rollbackTarget: null,
      demoCreating: false,
      sym: { open: false, id: null, name: "", addr: "", type: "", comment: "", watchable: true },
      newProject: { open: false, code: "", name: "", kind: "stub", deviceId: "" },
      attach: { open: false, deviceId: "" },
      deploy: { stage: "staging", signOff: false, approverId: "", reason: "" },
      fleet: {
        deviceIds: [], stage: "staging", signOff: false, canary: 1, promoteVerified: false,
        autoRollback: true, approverId: "", reason: "",
      },
      // doc 81 Đợt 2 Task 13 — phần UI của vỏ P1 Workbench (không có trên mã cũ ⇒ thêm, không đổi trường cũ).
      cursor: { line: 1, col: 1 },
      ui: {
        activity: "projects", editorTab: "source", bottomTab: "problems", bottomOpenRequest: 0,
        wizard: { open: false, mode: "single", buildId: null }, copilotMounted: false,
      },
    });
  });
});

describe("CHUỖI RESET khi chọn project khác (project/select)", () => {
  it("artifact / build / simResult / diagnostics về null; watching false; máy đội rỗng", () => {
    const s = workspaceReducer(armed(), { type: "project/select", projectId: 2 });
    expect(s.projectId).toBe(2);
    expect(s.artifactId).toBeNull();
    expect(s.buildId).toBeNull();
    expect(s.simResult).toBeNull();
    expect(s.diagnostics).toBeNull();
    expect(s.watching).toBe(false);
    expect(s.fleet.deviceIds).toEqual([]);
  });

  it("KHÔNG đụng phần còn lại (hành vi cũ): buffer, form deploy, form đội máy khác deviceIds, tìm kiếm", () => {
    const before = workspaceReducer(armed(), { type: "explorer/set", patch: { search: "cell" } });
    const s = workspaceReducer(before, { type: "project/select", projectId: 2 });
    expect(s.code).toBe("A\nB");
    expect(s.deploy).toEqual(before.deploy);
    expect({ ...s.fleet, deviceIds: before.fleet.deviceIds }).toEqual(before.fleet);
    expect(s.explorer).toEqual(before.explorer);
    expect(s.language).toBe(before.language);
  });

  it("kết quả về MUỘN (artifactId đã null nhưng diagnostics/sim/build còn) ⇒ vẫn xoá hết khi đổi project", () => {
    const late: WorkspaceState = {
      ...initialWorkspaceState,
      projectId: 2,
      artifactId: null,
      buildId: 5,
      diagnostics: [{ severity: "warning", message: "late" }],
      simResult: { ok: false, warnings: [], timeline: [] },
    };
    const s = workspaceReducer(late, { type: "project/select", projectId: 3 });
    expect([s.artifactId, s.buildId, s.simResult, s.diagnostics]).toEqual([null, null, null, null]);
  });

  it("chọn lại CHÍNH project đang mở ⇒ không đổi gì (cùng tham chiếu)", () => {
    const a = armed();
    expect(workspaceReducer(a, { type: "project/select", projectId: 1 })).toBe(a);
  });

  it("thuần: không biến đổi state đầu vào", () => {
    const a = armed();
    const snap = JSON.stringify(a);
    workspaceReducer(a, { type: "project/select", projectId: 2 });
    expect(JSON.stringify(a)).toBe(snap);
  });
});

describe("Task 12b (R-2-r) — không còn lối đổi project nào giữ state của dự án trước", () => {
  it("hành động cũ `project/assign` (giữ artifact/build/sim/diagnostics) đã bị gỡ: reducer bỏ qua nó", () => {
    const a = armed();
    // Không còn trong union ⇒ một nơi gọi cũ là LỖI BIÊN DỊCH; lúc chạy thì vô hiệu.
    const s = workspaceReducer(a, { type: "project/assign", projectId: 2 } as unknown as WorkspaceAction);
    expect(s).toBe(a);
  });
  it("tạo dự án / DEMO / deep-link đi qua project/select ⇒ build của dự án trước không còn", () => {
    const s = workspaceReducer(armed(), { type: "project/select", projectId: 2 });
    expect([s.artifactId, s.buildId, s.simResult, s.diagnostics]).toEqual([null, null, null, null]);
  });
});

describe("artifact/select (WS-05: đổi phiên bản HOẶC lưu phiên bản mới)", () => {
  it("phiên bản khác ⇒ build / simResult / diagnostics về null; watching + máy đội GIỮ", () => {
    const s = workspaceReducer(armed(), { type: "artifact/select", artifactId: 12 });
    expect(s.artifactId).toBe(12);
    expect(s.buildId).toBeNull();
    expect(s.simResult).toBeNull();
    expect(s.diagnostics).toBeNull();
    expect(s.watching).toBe(true);
    expect(s.fleet.deviceIds).toEqual([3]);
  });
  it("cùng phiên bản ⇒ không đổi", () => {
    const a = armed();
    expect(workspaceReducer(a, { type: "artifact/select", artifactId: 11 })).toBe(a);
  });
});

describe("build", () => {
  it("build/select (bấm chọn build) ⇒ simResult về null, diagnostics giữ", () => {
    const s = workspaceReducer(armed(), { type: "build/select", buildId: 6 });
    expect(s.buildId).toBe(6);
    expect(s.simResult).toBeNull();
    expect(s.diagnostics).not.toBeNull();
  });
  it("build/select cùng build ⇒ vẫn xoá simResult (hành vi cũ: handler không so sánh)", () => {
    const s = workspaceReducer(armed(), { type: "build/select", buildId: 5 });
    expect(s.simResult).toBeNull();
  });
  // Task 12b fix round 1 (review Minor 2) — trước đây GIỮ simResult ⇒ verdict của build A hiện dưới build B.
  it("build/created (buildArtifact.onSuccess) ⇒ đổi build đang chọn VÀ xoá simResult của build trước; diagnostics giữ", () => {
    const s = workspaceReducer(armed(), { type: "build/created", artifactId: 11, buildId: 6 });
    expect(s.buildId).toBe(6);
    expect(s.simResult).toBeNull();
    expect(s.diagnostics).not.toBeNull();
  });
});

describe("Task 12b (b, R-2-r) — kết quả gắn id lúc YÊU CẦU; lệch lựa chọn hiện tại ⇒ BỎ", () => {
  it("build/created cho phiên bản KHÁC phiên bản đang chọn ⇒ bỏ (cùng tham chiếu)", () => {
    const a = armed();
    expect(workspaceReducer(a, { type: "build/created", artifactId: 12, buildId: 6 })).toBe(a);
  });
  it("build/created về sau khi đã đổi project (artifactId null) ⇒ bỏ: không build nào để Deploy", () => {
    const s = run(armed(), { type: "project/select", projectId: 2 }, { type: "build/created", artifactId: 11, buildId: 6 });
    expect(s.buildId).toBeNull();
  });
  it("diagnostics/set cho phiên bản khác ⇒ bỏ; đúng phiên bản ⇒ đặt", () => {
    const a = workspaceReducer(armed(), { type: "artifact/select", artifactId: 12 });
    expect(workspaceReducer(a, { type: "diagnostics/set", artifactId: 11, diagnostics: [] })).toBe(a);
    expect(workspaceReducer(a, { type: "diagnostics/set", artifactId: 12, diagnostics: [] }).diagnostics).toEqual([]);
  });
  it("sim/set cho build khác build đang chọn ⇒ bỏ; đúng build ⇒ đặt", () => {
    const a = workspaceReducer(armed(), { type: "build/select", buildId: 6 });
    const sim = { ok: true, warnings: [], timeline: [] };
    expect(workspaceReducer(a, { type: "sim/set", buildId: 5, simResult: sim })).toBe(a);
    expect(workspaceReducer(a, { type: "sim/set", buildId: 6, simResult: sim }).simResult).toEqual(sim);
  });
  it("artifact/created (lưu phiên bản) cho project KHÁC project đang mở ⇒ bỏ; đúng project ⇒ như artifact/select", () => {
    const a = workspaceReducer(armed(), { type: "project/select", projectId: 2 });
    expect(workspaceReducer(a, { type: "artifact/created", projectId: 1, artifactId: 13 })).toBe(a);
    const b = armed();
    const s = workspaceReducer(b, { type: "artifact/created", projectId: 1, artifactId: 13 });
    expect([s.artifactId, s.buildId, s.simResult, s.diagnostics]).toEqual([13, null, null, null]);
  });
});

describe("buffer editor", () => {
  it("buffer/loadArtifact đặt code + language; buffer/defaultLanguage chỉ đặt language", () => {
    let s = workspaceReducer(initialWorkspaceState, { type: "buffer/loadArtifact", code: "X", language: "st" });
    expect([s.code, s.language]).toEqual(["X", "st"]);
    s = workspaceReducer(s, { type: "buffer/defaultLanguage", language: "ld" });
    expect([s.code, s.language]).toEqual(["X", "ld"]);
  });
  it("code/append (Copilot onApply) nối sau hai dòng trống; buffer rỗng/trắng ⇒ thay", () => {
    expect(workspaceReducer({ ...initialWorkspaceState, code: "A" }, { type: "code/append", text: "G" }).code).toBe("A\n\nG");
    expect(workspaceReducer({ ...initialWorkspaceState, code: "  \n" }, { type: "code/append", text: "G" }).code).toBe("G");
  });
});

describe("hộp thoại / form", () => {
  it("sym/open với biến ⇒ điền sẵn; không biến ⇒ trống, watchable mặc định true", () => {
    let s = workspaceReducer(initialWorkspaceState, {
      type: "sym/open",
      symbol: { id: 31, name: "X0", address: null, dataType: "INT", comment: null, watchable: false },
    });
    expect(s.sym).toEqual({ open: true, id: 31, name: "X0", addr: "", type: "INT", comment: "", watchable: false });
    s = workspaceReducer(s, { type: "sym/open" });
    expect(s.sym).toEqual({ open: true, id: null, name: "", addr: "", type: "", comment: "", watchable: true });
  });
  it("newProject/submitted ⇒ đóng + xoá mã/tên/thiết bị, GIỮ loại (hành vi cũ)", () => {
    const s = run(
      initialWorkspaceState,
      { type: "newProject/set", patch: { open: true, code: "C", name: "N", kind: "gcode", deviceId: "3" } },
      { type: "newProject/submitted" },
    );
    expect(s.newProject).toEqual({ open: false, code: "", name: "", kind: "gcode", deviceId: "" });
  });
  it("attach/open ⇒ mở với thiết bị hiện tại", () => {
    expect(workspaceReducer(initialWorkspaceState, { type: "attach/open", deviceId: "3" }).attach).toEqual({ open: true, deviceId: "3" });
  });
  it("fleet/toggleDevice bật/tắt theo thứ tự chọn", () => {
    const s = run(
      initialWorkspaceState,
      { type: "fleet/toggleDevice", deviceId: 3 },
      { type: "fleet/toggleDevice", deviceId: 4 },
      { type: "fleet/toggleDevice", deviceId: 3 },
    );
    expect(s.fleet.deviceIds).toEqual([4]);
  });
  it("nav/guard lưu hành động hoãn; nav/clear xoá", () => {
    const fn = () => {};
    const s = workspaceReducer(initialWorkspaceState, { type: "nav/guard", run: fn });
    expect(s.pendingNav).toBe(fn);
    expect(workspaceReducer(s, { type: "nav/clear" }).pendingNav).toBeNull();
  });
  it("rollback/open + rollback/close; deleteSym/open + deleteSym/close", () => {
    let s = workspaceReducer(initialWorkspaceState, { type: "rollback/open", target: { id: 90, stage: "staging", attemptKey: "k" } });
    expect(s.rollbackTarget).toEqual({ id: 90, stage: "staging", attemptKey: "k" });
    s = workspaceReducer(s, { type: "rollback/close" });
    expect(s.rollbackTarget).toBeNull();
    s = workspaceReducer(s, { type: "deleteSym/open", id: 31 });
    expect(s.deleteSymTarget).toEqual({ id: 31 });
    expect(workspaceReducer(s, { type: "deleteSym/close" }).deleteSymTarget).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// doc 81 Đợt 2 Task 13 — phần UI của vỏ P1 Workbench (explorer / tab editor / panel dưới / wizard deploy / Copilot).
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("Task 13 — UI vỏ Workbench", () => {
  it("ui/bottom {open:true} ⇒ đổi tab + TĂNG openRequest (ý định mở, R-2-l); không open ⇒ chỉ đổi tab", () => {
    const a = workspaceReducer(initialWorkspaceState, { type: "ui/bottom", tab: "builds", open: true });
    expect(a.ui.bottomTab).toBe("builds");
    expect(a.ui.bottomOpenRequest).toBe(1);
    const b = workspaceReducer(a, { type: "ui/bottom", tab: "matrix" });
    expect(b.ui.bottomTab).toBe("matrix");
    expect(b.ui.bottomOpenRequest).toBe(1);
    expect(workspaceReducer(b, { type: "ui/bottom", tab: "matrix", open: true }).ui.bottomOpenRequest).toBe(2);
  });

  it("wizard/open mở + GHIM build (giữ chế độ đã chọn); wizard/mode đổi chế độ; wizard/close đóng + bỏ ghim", () => {
    const a = run(initialWorkspaceState, { type: "wizard/mode", mode: "fleet" }, { type: "wizard/open", buildId: 5 });
    expect(a.ui.wizard).toEqual({ open: true, mode: "fleet", buildId: 5 });
    expect(workspaceReducer(a, { type: "wizard/close" }).ui.wizard).toEqual({ open: false, mode: "fleet", buildId: null });
  });

  it("ui/activity, ui/editorTab, copilot/mounted, cursor/set (cùng giá trị ⇒ cùng tham chiếu)", () => {
    const a = run(
      initialWorkspaceState,
      { type: "ui/activity", activity: "deploy" },
      { type: "ui/editorTab", tab: "tags" },
      { type: "copilot/mounted" },
      { type: "cursor/set", line: 3, col: 7 },
    );
    expect(a.ui.activity).toBe("deploy");
    expect(a.ui.editorTab).toBe("tags");
    expect(a.ui.copilotMounted).toBe(true);
    expect(a.cursor).toEqual({ line: 3, col: 7 });
    expect(workspaceReducer(a, { type: "cursor/set", line: 3, col: 7 })).toBe(a);
  });

  it("chuỗi reset KHÔNG đụng phần UI (đổi project giữ tab/panel); và phần UI KHÔNG đụng chuỗi reset", () => {
    const ui = run(armed(), { type: "ui/editorTab", tab: "diff" }, { type: "ui/bottom", tab: "deploys", open: true });
    const s = workspaceReducer(ui, { type: "project/select", projectId: 2 });
    expect(s.ui).toEqual(ui.ui);
    const back = run(armed(), { type: "ui/bottom", tab: "builds", open: true }, { type: "wizard/open", buildId: 5 }, { type: "copilot/mounted" });
    expect(back.buildId).toBe(5);
    expect(back.simResult).not.toBeNull();
    expect(back.diagnostics).not.toBeNull();
  });
});
