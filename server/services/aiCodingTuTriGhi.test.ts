/**
 * ★★★ 2026-08-24 · VÒNG TỰ-TRỊ-GHI — LƯỚI cho cửa NGUY HIỂM NHẤT: model tự ghi mã + tự chạy test,
 * KHÔNG người duyệt.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ĐỘT BIẾN FILE NÀY PHẢI BẮT ĐƯỢC (mỗi cái một ca then chốt):
 *   (a) cờ mặc định lật thành BẬT                          ⇒ §0 ĐỎ
 *   (b) gỡ ánh xạ tệp-bẩn ⇒ tự-ghi (FILE_DIRTY→tep_ban_nguoi) ⇒ §2 ĐỎ
 *   (c) gỡ dừng-không-tiến-bộ (vòng chạy quá số lượt)        ⇒ §5 ĐỎ
 *   (d) apply_diff ra khỏi ineligible KỂ CẢ khi cờ tắt      ⇒ §0 (TU_TRI_TAT) ĐỎ
 *   (e) laYDinhTuTri luôn true (câu thường khởi động vòng)   ⇒ §0 (khởi động) ĐỎ
 *   (f) một lệnh phá huỷ lọt danh sách trắng                ⇒ §6 ĐỎ
 *   • đổi tool ở lời gọi ghi thành lệnh khác / bỏ `autonomy` khi confirm ⇒ §1 ĐỎ
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * KHÔNG MOCK NHỮNG THỨ ĐANG ĐƯỢC ĐO: chính sách (`autonomyPolicy`), hộp cát lệnh
 * (`repoCommandSandbox`), cầu chì vòng (`shared/aiCodingLoop`), bước CHẠY (`aiCodingVerify`), vị từ
 * khởi động (`intentClassifier`) — TẤT CẢ là mã THẬT. Chỉ ba cạnh I/O bị thay bằng bản giả tối
 * thiểu: `executeDecision`/`confirmAction` (không sinh tiến trình, không ghi đĩa) và `db/connection`
 * (kill-switch đọc bảng ai_system_config) + sổ audit.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const h = vi.hoisted(() => ({
  /** Mọi quyết định đi qua `executeDecision` — bản kiểm đếm của §1. */
  quyetDinh: [] as Array<{ tool: string | null; args: Record<string, unknown> }>,
  /** Tham số lượt `confirmAction` nhận — §1 đọc `autonomy`. */
  confirmNhan: [] as Array<{ actionId: string; autonomy: unknown }>,
  /** Mục ở gốc dự án mà `list_files` giả trả về (để suy lệnh kiểm chứng). */
  mucGoc: [{ path: "CalculatorDemo.sln", kind: "file" }] as Array<{ path: string; kind: string }>,
  /** Chuỗi kết quả run_command theo lượt: {output, exit}. */
  runSeq: [] as Array<{ out: string; exit: number | null }>,
  runIdx: 0,
  /** Kết quả apply_diff: note (từ chối) hoặc null (thành công + data). */
  applyNote: null as string | null,
  applyData: { path: "src/Calculator.cs", bytes: 42, created: false, sha256Before: "b0", sha256After: "a1" },
  /** Ép propose từ chối (RBAC). */
  tuChoiRun: null as string | null,
  tuChoiGhi: null as string | null,
  /** Hàng kill-switch giả: [] = chưa bật; [{value:"true"}] = đã bật. */
  killRows: [] as Array<{ value: string }>,
  /** Hàng WORM audit đã ghi. */
  auditRows: [] as Array<{ action: string; details: unknown }>,
}));

vi.mock("../db/connection", () => ({
  getDb: vi.fn(async () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => h.killRows }) }) }),
  })),
}));

vi.mock("./aiLocalTools", () => ({
  executeDecision: async (d: { tool: string | null; args: Record<string, unknown> }) => {
    h.quyetDinh.push({ tool: d.tool, args: d.args });
    if (d.tool === "list_files") {
      return { result: { type: "action_result", title: "ls", data: { entries: h.mucGoc }, textSummary: "" } };
    }
    if (d.tool === "run_command") {
      if (h.tuChoiRun) return { result: null, denied: { message: h.tuChoiRun, reason: "PERMISSION_DENIED" } };
      return { result: null, pendingAction: { actionId: "run-1", token: "t", tool: "run_command", args: d.args, summary: "", preview: {}, expiresAt: "" } };
    }
    if (d.tool === "apply_diff") {
      if (h.tuChoiGhi) return { result: null, denied: { message: h.tuChoiGhi, reason: "PERMISSION_DENIED" } };
      return { result: null, pendingAction: { actionId: "ap-1", token: "t", tool: "apply_diff", args: d.args, summary: "", preview: {}, expiresAt: "" } };
    }
    return { result: null, error: "TOOL_NOT_REGISTERED" };
  },
}));

vi.mock("./aiCopilotActions", () => ({
  confirmAction: async (
    actionId: string,
    _token: string,
    _u: unknown,
    _l: unknown,
    _r: unknown,
    _d: unknown,
    autonomy: unknown,
  ) => {
    h.confirmNhan.push({ actionId, autonomy });
    if (actionId === "ap-1") {
      if (h.applyNote) {
        return { ok: true, status: "executed", result: { type: "action_result", note: h.applyNote, textSummary: `TỪ CHỐI: ${h.applyNote}`, data: null } };
      }
      return { ok: true, status: "executed", result: { type: "action_result", note: null, textSummary: "đã ghi", data: h.applyData } };
    }
    // run_command — tiêu một mục của chuỗi kết quả.
    const seq = h.runSeq[h.runIdx] ?? h.runSeq[h.runSeq.length - 1] ?? { out: "Failed: 2, Passed: 4", exit: 1 };
    h.runIdx++;
    return {
      ok: true,
      status: "executed",
      result: { type: "action_result", title: "Chạy lệnh", data: { exitCode: seq.exit, timedOut: false, output: seq.out }, textSummary: seq.out },
    };
  },
}));

vi.mock("./auditTrailService", () => ({
  AUDIT_ACTIONS: { AI_CODING_TU_TRI_LUOT: "ai_coding_tu_tri_luot" },
  ENTITY_TYPES: { AI_ACTION: "ai_action" },
  createAuditContext: (x: { user?: { id?: number } }) => ({ userId: x.user?.id }),
  logCrudOperation: async (_c: unknown, e: { action: string; details: unknown }) => {
    h.auditRows.push({ action: e.action, details: e.details });
    return { id: h.auditRows.length };
  },
}));

import {
  chayLuotTuTriGhi,
  chayVongTuTriGhi,
  khoiDongTuTriGhiDuoc,
  tranTuTriGhi,
  laTepTest,
  LY_DO_TU_TRI_GHI,
  gocRepoChinh,
  laGhiVaoRepoChinh,
  type SinhBanVa,
} from "./aiCodingTuTriGhi";
import { chayKiemChung, laLenhKiemChung } from "./aiCodingVerify";
import { DANH_SACH_TRANG } from "./aiLocalTools/repoCommandSandbox";

const ENV = ["AI_CODING_AUTOLOOP", "AI_CODING_AUTOLOOP_MAX", "AI_CODING_TU_TRI_GHI", "AI_CODING_TU_TRI_GHI_MAX", "AI_REPO_SANDBOX_ROOTS", "AI_CODING_TU_TRI_GHI_REPO_CHINH"] as const;
const NGUOI = { id: 7, role: "admin", name: "T" };
/**
 * ★ Q1 (2026-10-14) — gốc dự án HỘP CÁT ở thư mục TẠM, NGOÀI repo chính. Trước Q1 các ca dưới đây
 * chạy với gốc mặc định (= cwd = repo chính) vì khi ấy vị trí gốc không ảnh hưởng gì. Nay vòng tự ghi
 * TỪ CHỐI repo chính (ngoài `sandbox-projects/`) ⇒ các ca đo hàng rào KHÁC phải đứng trên một dự án
 * hộp cát thật, nếu không chúng đỏ vì hàng rào Q1 chứ không vì thứ chúng đo. §8 đo riêng Q1.
 */
const GOC_HOP_CAT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tu-tri-ghi-hopcat-")));
function ctx(projectRoot: string | null = GOC_HOP_CAT) {
  return { user: NGUOI, lang: "vi" as const, ...(projectRoot ? { projectRoot } : {}) };
}
/** SinhBanVa giả: trả một bản vá cố định cho mọi lượt (khác nhau qua `luot` để không bị "lặp diff"). */
const banVaGia: SinhBanVa = async (_loi, luot) => ({ path: "src/Calculator.cs", original: "old", modified: `new-${luot}` });
const CAU = "tự sửa cho test xanh";

beforeEach(() => {
  for (const k of ENV) delete process.env[k];
  process.env.AI_CODING_AUTOLOOP = "1"; // bước CHẠY (chayKiemChung) đòi cờ này
  process.env.AI_CODING_TU_TRI_GHI = "1"; // bước GHI đòi cờ này
  h.quyetDinh = [];
  h.confirmNhan = [];
  h.mucGoc = [{ path: "CalculatorDemo.sln", kind: "file" }];
  h.runSeq = [{ out: "Failed!  - Failed:     2, Passed:     4, Skipped: 0, Total: 6", exit: 1 }];
  h.runIdx = 0;
  h.applyNote = null;
  h.applyData = { path: "src/Calculator.cs", bytes: 42, created: false, sha256Before: "b0", sha256After: "a1" };
  h.tuChoiRun = null;
  h.tuChoiGhi = null;
  h.killRows = [];
  h.auditRows = [];
});
afterEach(() => {
  for (const k of ENV) delete process.env[k];
});
afterAll(() => {
  try {
    fs.rmSync(GOC_HOP_CAT, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§0 — CỜ + KHỞI ĐỘNG TƯỜNG MINH (đột biến a·d·e)", () => {
  it("★★★ cờ TẮT ⇒ tự-ghi KHÔNG xảy ra (TU_TRI_TAT), KHÔNG một apply_diff nào được đề xuất", async () => {
    delete process.env.AI_CODING_TU_TRI_GHI;
    const r = await chayLuotTuTriGhi({ path: "src/a.cs", original: "x", modified: "y", luot: 1 }, ctx(), NGUOI, "vi");
    expect(r.ok).toBe(false);
    expect(r.ma).toBe("TU_TRI_TAT");
    expect(h.quyetDinh.some((q) => q.tool === "apply_diff"), "cờ tắt ⇒ 0 apply_diff").toBe(false);
  });

  it("★★★ cờ = giá trị LẠ (\"true\") ⇒ như TẮT (chỉ \"1\" bật)", async () => {
    process.env.AI_CODING_TU_TRI_GHI = "true";
    const r = await chayLuotTuTriGhi({ path: "src/a.cs", original: "x", modified: "y", luot: 1 }, ctx(), NGUOI, "vi");
    expect(r.ma).toBe("TU_TRI_TAT");
  });

  it("★★★ khởi động: câu TỰ TRỊ + cờ bật ⇒ mở; câu THƯỜNG ⇒ KHÔNG mở (dù cờ bật)", () => {
    expect(khoiDongTuTriGhiDuoc(CAU)).toBe(true);
    expect(khoiDongTuTriGhiDuoc("đọc tệp src/Calculator.cs"), "câu đọc KHÔNG được mở vòng tự-ghi").toBe(false);
    expect(khoiDongTuTriGhiDuoc("giải thích lớp Calculator")).toBe(false);
  });

  it("★★★ cờ TẮT ⇒ khởi động KHÔNG mở kể cả với câu tự trị", () => {
    delete process.env.AI_CODING_TU_TRI_GHI;
    expect(khoiDongTuTriGhiDuoc(CAU)).toBe(false);
  });

  it("★★ vòng KHÔNG khởi động cho câu thường ⇒ batDau=false, 0 lượt, 0 đề xuất", async () => {
    const r = await chayVongTuTriGhi({ cauHoi: "đọc tệp X" }, ctx(), NGUOI, "vi", banVaGia);
    expect(r.batDau).toBe(false);
    expect(r.soLuot).toBe(0);
    expect(h.quyetDinh.length).toBe(0);
  });

  it("★ trần tự-ghi đọc được và kẹp [1..10]", () => {
    expect(tranTuTriGhi()).toBeGreaterThanOrEqual(1);
    process.env.AI_CODING_TU_TRI_GHI_MAX = "99";
    expect(tranTuTriGhi()).toBe(10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — MỘT LƯỢT GHI: đúng cửa HITL, và lượt tự động KHÔNG vô danh", () => {
  it("★★★ cờ bật ⇒ đề xuất apply_diff → confirm → BYTE vào đĩa, đọc được băm trước/sau", async () => {
    const r = await chayLuotTuTriGhi({ path: "src/Calculator.cs", original: "old", modified: "new", luot: 1 }, ctx(), NGUOI, "vi");
    expect(r.ok).toBe(true);
    expect(h.quyetDinh.some((q) => q.tool === "apply_diff")).toBe(true);
    expect(r.bamTruoc).toBe("b0");
    expect(r.bamSau).toBe("a1");
    expect(r.bytes).toBe(42);
  });

  it("★★★ lượt confirm TỰ ĐỘNG được ĐÁNH DẤU (`autonomy.reason = AI_CODING_TU_TRI_GHI`), không vô danh", async () => {
    await chayLuotTuTriGhi({ path: "src/Calculator.cs", original: "old", modified: "new", luot: 1 }, ctx(), NGUOI, "vi");
    expect(h.confirmNhan.length).toBe(1);
    expect(h.confirmNhan[0]!.actionId).toBe("ap-1");
    expect(h.confirmNhan[0]!.autonomy).toEqual({ reason: LY_DO_TU_TRI_GHI });
  });

  it("★★ tool ở lời gọi ghi là HẰNG CHỮ apply_diff — KHÔNG BAO GIỜ run_command/tool khác", async () => {
    await chayLuotTuTriGhi({ path: "src/Calculator.cs", original: "old", modified: "new", luot: 1 }, ctx(), NGUOI, "vi");
    for (const q of h.quyetDinh) expect(q.tool).toBe("apply_diff");
  });

  it("★★ lượt VƯỢT TRẦN ⇒ LOOP_CAP ở server (client không tự nới)", async () => {
    process.env.AI_CODING_TU_TRI_GHI_MAX = "2";
    const r = await chayLuotTuTriGhi({ path: "src/a.cs", original: "x", modified: "y", luot: 3 }, ctx(), NGUOI, "vi");
    expect(r.ma).toBe("LOOP_CAP");
    expect(h.quyetDinh.length).toBe(0);
  });

  it("★★ RBAC từ chối ở propose ⇒ DENIED, KHÔNG confirm", async () => {
    h.tuChoiGhi = "Bạn không có quyền ai_repo_read/canEdit.";
    const r = await chayLuotTuTriGhi({ path: "src/a.cs", original: "x", modified: "y", luot: 1 }, ctx(), NGUOI, "vi");
    expect(r.ma).toBe("DENIED");
    expect(h.confirmNhan.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — TỆP BẨN CỦA NGƯỜI ⇒ DỪNG `tep_ban_nguoi`, đĩa 0 đổi (đột biến b)", () => {
  it("★★★ apply_diff trả FILE_DIRTY ⇒ lượt ghi `TEP_BAN_NGUOI`, ok=false", async () => {
    h.applyNote = "FILE_DIRTY";
    const r = await chayLuotTuTriGhi({ path: "src/a.cs", original: "x", modified: "y", luot: 1 }, ctx(), NGUOI, "vi");
    expect(r.ok).toBe(false);
    expect(r.ma).toBe("TEP_BAN_NGUOI");
    expect(r.maTuChoi).toBe("FILE_DIRTY");
  });

  it("★★★ trong VÒNG: tệp bẩn ⇒ DỪNG `tep_ban_nguoi` NGAY, không ghi thêm lượt nào", async () => {
    h.applyNote = "FILE_DIRTY";
    const r = await chayVongTuTriGhi({ cauHoi: CAU }, ctx(), NGUOI, "vi", banVaGia);
    expect(r.lyDo).toBe("tep_ban_nguoi");
    // ĐÚNG một lượt ghi được thử (bị từ chối), rồi dừng — không lặp.
    expect(h.quyetDinh.filter((q) => q.tool === "apply_diff").length).toBe(1);
  });

  it("★★ note KHÁC (BASE_MISMATCH) ⇒ GHI_TU_CHOI (không nhầm là tệp bẩn)", async () => {
    h.applyNote = "BASE_MISMATCH";
    const r = await chayLuotTuTriGhi({ path: "src/a.cs", original: "x", modified: "y", luot: 1 }, ctx(), NGUOI, "vi");
    expect(r.ma).toBe("GHI_TU_CHOI");
    expect(r.maTuChoi).toBe("BASE_MISMATCH");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — KILL-SWITCH runtime (dùng lại autonomyPolicy.isKillSwitchTripped)", () => {
  it("★★★ kill-switch BẬT ⇒ lượt ghi `KILL_SWITCH`, KHÔNG đề xuất gì", async () => {
    h.killRows = [{ value: "true" }];
    const r = await chayLuotTuTriGhi({ path: "src/a.cs", original: "x", modified: "y", luot: 1 }, ctx(), NGUOI, "vi");
    expect(r.ma).toBe("KILL_SWITCH");
    expect(h.quyetDinh.length).toBe(0);
  });

  it("★★★ kill-switch bật GIỮA vòng ⇒ vòng DỪNG `kill_switch` ngay lượt kế", async () => {
    h.killRows = [{ value: "true" }];
    const r = await chayVongTuTriGhi({ cauHoi: CAU }, ctx(), NGUOI, "vi", banVaGia);
    expect(r.lyDo).toBe("kill_switch");
    expect(h.quyetDinh.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — CHIỀU DƯƠNG: vòng đầy đủ tự ghi + tự chạy tới XANH, audit đủ N hàng", () => {
  it("★★★ 2 đỏ → 1 đỏ → 0 đỏ ⇒ DỪNG `xanh`, 2 lượt GHI, audit 2 hàng WORM", async () => {
    h.runSeq = [
      { out: "Failed!  - Failed: 2, Passed: 4, Total: 6", exit: 1 },
      { out: "Failed!  - Failed: 1, Passed: 5, Total: 6", exit: 1 },
      { out: "Passed!  - Failed: 0, Passed: 6, Total: 6", exit: 0 },
    ];
    const r = await chayVongTuTriGhi({ cauHoi: CAU }, ctx(), NGUOI, "vi", banVaGia);
    expect(r.batDau).toBe(true);
    expect(r.lyDo).toBe("xanh");
    const soGhi = h.quyetDinh.filter((q) => q.tool === "apply_diff").length;
    expect(soGhi, "2 lượt sửa (luot 1,2), lượt 3 xanh nên không sửa").toBe(2);
    expect(h.auditRows.length, "một hàng WORM cho mỗi lượt CÓ GHI").toBe(2);
    // Sổ WORM khai đủ: lệnh đã chạy + kết quả test + băm + lượt.
    const d0 = h.auditRows[0]!.details as { metadata: { luot: number; command: string; test: { soDo: number }; sha256After: string; sua_tep_test: boolean } };
    expect(d0.metadata.luot).toBe(1);
    expect(d0.metadata.command).toBe("dotnet test CalculatorDemo.sln");
    expect(d0.metadata.test.soDo).toBe(2);
    expect(d0.metadata.sha256After).toBe("a1");
    expect(d0.metadata.sua_tep_test, "banVaGia trỏ src/Calculator.cs ⇒ KHÔNG phải tệp test").toBe(false);
    expect(h.auditRows.every((row) => row.action === "ai_coding_tu_tri_luot")).toBe(true);
  });

  it("★★★ CHỐNG-GAMING: model chọn ghi TỆP TEST ⇒ sổ WORM khai `sua_tep_test:true` (KHÔNG chặn)", async () => {
    // banVa trỏ một tệp TEST — vòng VẪN ghi (không chặn cứng), nhưng audit phải KHAI để người xem lại thấy.
    const banVaTest: SinhBanVa = async (_loi, luot) => ({ path: "tests/CalculatorTests.cs", original: "old", modified: `new-${luot}` });
    h.runSeq = [
      { out: "Failed: 1, Passed: 5", exit: 1 },
      { out: "Passed! - Failed: 0, Passed: 6", exit: 0 },
    ];
    const r = await chayVongTuTriGhi({ cauHoi: CAU }, ctx(), NGUOI, "vi", banVaTest);
    expect(r.lyDo).toBe("xanh");
    expect(h.auditRows.length).toBe(1);
    const d0 = h.auditRows[0]!.details as { metadata: { sua_tep_test: boolean } };
    expect(d0.metadata.sua_tep_test, "model chạm tệp test ⇒ cờ audit BẬT").toBe(true);
  });

  it("★★ mỗi lượt confirm ghi mang `autonomy.reason` — không lượt tự động nào vô danh", async () => {
    h.runSeq = [
      { out: "Failed: 1, Passed: 5", exit: 1 },
      { out: "Passed! - Failed: 0, Passed: 6", exit: 0 },
    ];
    await chayVongTuTriGhi({ cauHoi: CAU }, ctx(), NGUOI, "vi", banVaGia);
    const ghi = h.confirmNhan.filter((c) => c.actionId === "ap-1");
    expect(ghi.length).toBe(1);
    expect(ghi.every((c) => JSON.stringify(c.autonomy) === JSON.stringify({ reason: LY_DO_TU_TRI_GHI }))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§5 — CẦU CHÌ: không-tiến-bộ + hết-trần (đột biến c)", () => {
  it("★★★ test ĐỎ Y HỆT 2 lượt ⇒ DỪNG `khong_tien_bo` (không đốt hết trần)", async () => {
    h.runSeq = [
      { out: "Failed!  - Failed: 2, Passed: 4, Total: 6", exit: 1 },
      { out: "Failed!  - Failed: 2, Passed: 4, Total: 6", exit: 1 },
    ];
    const r = await chayVongTuTriGhi({ cauHoi: CAU }, ctx(), NGUOI, "vi", banVaGia);
    expect(r.lyDo).toBe("khong_tien_bo");
    expect(r.soLuot, "dừng ở lượt 2, không chạy hết trần 3").toBe(2);
  });

  it("★★★ số đỏ GIẢM nhưng chưa xanh, chạm TRẦN ⇒ DỪNG `het_tran`", async () => {
    process.env.AI_CODING_TU_TRI_GHI_MAX = "2";
    h.runSeq = [
      { out: "Failed!  - Failed: 3, Passed: 3, Total: 6", exit: 1 },
      { out: "Failed!  - Failed: 1, Passed: 5, Total: 6", exit: 1 },
    ];
    const r = await chayVongTuTriGhi({ cauHoi: CAU }, ctx(), NGUOI, "vi", banVaGia);
    expect(r.lyDo).toBe("het_tran");
    expect(r.soLuot).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§6 — BẤT BIẾN AN TOÀN: lệnh PHÁ HUỶ vẫn NGOÀI TẦM (đột biến f)", () => {
  it("★★★ model 'đề nghị' git checkout / rm ⇒ VẪN CMD_NOT_VERIFY (không lệnh phá huỷ nào chạy)", () => {
    for (const c of ["git checkout HEAD -- .", "rm -rf src", "git reset --hard", "npm publish"]) {
      const r = laLenhKiemChung(c);
      expect(r.ok, `"${c}" phải bị từ chối`).toBe(false);
    }
  });

  it("★★★ danh sách trắng KHÔNG chứa mục phá huỷ nào (git checkout/reset/rm/drop/publish)", () => {
    const cam = /(checkout|reset|\brm\b|drop|publish|clean|stash)/i;
    for (const m of DANH_SACH_TRANG) {
      expect(cam.test(m.nhan), `danh sách trắng có mục nghi phá huỷ: ${m.nhan}`).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// §7 — CỜ CHỐNG-GAMING "model chạm tệp TEST" (`laTepTest`) — vị từ THUẦN
//   ⚠ `trichTepTuLoi` (regex-nhặt-tệp-đầu) ĐÃ BỊ GỠ sau nghiệm thu live 30B (2026-08-24): nó nhặt
//     tệp TEST / đường tuyệt đối. Thay bằng model-chọn-tệp + server-xác-thực (oracle ở
//     `aiCodingBanVaSua.test.ts`); còn lại đây là cờ AUDIT.
//   Đột biến: `laTepTest` luôn false ⇒ §7 + ca audit-tệp-test ĐỎ.
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§7 — laTepTest: tệp TEST ⇒ true (cờ audit), tệp NGUỒN ⇒ false", () => {
  it("★★★ theo THƯ MỤC: có đoạn /test/ hoặc /tests/ ⇒ true", () => {
    for (const d of ["tests/CalculatorTests.cs", "src/tests/Foo.cs", "test/foo.ts", "a\\tests\\b.cs"]) {
      expect(laTepTest(d), d).toBe(true);
    }
  });
  it("★★★ theo TÊN: *.test.ts / *Tests.cs ⇒ true", () => {
    for (const d of ["src/Calculator.test.ts", "src/foo.test.js", "CalculatorTests.cs", "src/FooTest.cs"]) {
      expect(laTepTest(d), d).toBe(true);
    }
  });
  it("★★★ tệp NGUỒN thường ⇒ false (không over-match 'latest', 'contest')", () => {
    for (const d of ["src/Calculator.cs", "src/utils.ts", "src/latest/Foo.cs", "app/contest.ts", ""]) {
      expect(laTepTest(d), d).toBe(false);
    }
  });
  it("★★ null/undefined ⇒ false (không ném)", () => {
    expect(laTepTest(null)).toBe(false);
    expect(laTepTest(undefined)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★★★ Q1 (2026-10-14, quyết định chủ dự án) — vòng TỰ GHI KHÔNG chạy trên REPO CHÍNH cho tới khi có
 * điểm khôi phục (Đợt 1). Quy tắc theo ĐƯỜNG TỆP ĐÍCH THẬT (realpath), không theo id dự án:
 *   đích ở TRONG repo chính VÀ KHÔNG dưới `<repo chính>/sandbox-projects/` ⇒ từ chối.
 *
 * ĐỘT BIẾN PHẢI BẮT:
 *   • gỡ cổng ⇒ ca "repo chính bị từ chối" ĐỎ (có apply_diff).
 *   • cổng so theo id "repo" thay vì đường ⇒ ca "gốc = repo/server" + ca "gốc viết HOA" + ca junction ĐỎ.
 *   • cổng chặn cả sandbox-projects ⇒ ca bộ đo agentic (projectId "repo" + sandbox-projects/…) ĐỎ.
 *   • so tiền tố chuỗi không chuẩn hoá `..` ⇒ ca `sandbox-projects/../server` ĐỎ.
 *   • bỏ cờ ghi đè ⇒ ca ghi đè ĐỎ.
 */
describe("§8 — Q1: repo chính KHÔNG tự ghi khi chưa có checkpoint (theo đường tệp đích)", () => {
  const REPO = gocRepoChinh();
  const coApplyDiff = () => h.quyetDinh.some((q) => q.tool === "apply_diff");

  it("★ gốc repo chính = thư mục có .git, đi lên từ cwd (ở lưới: gốc worktree này)", () => {
    expect(fs.existsSync(path.join(REPO, ".git")), REPO).toBe(true);
    expect(path.relative(REPO, process.cwd()).startsWith(".."), "cwd phải nằm trong repo chính").toBe(false);
  });

  it("★★★ gốc mặc định (= repo chính) + tệp mã server ⇒ REPO_CHINH_CHUA_CHECKPOINT, 0 apply_diff", async () => {
    const r = await chayLuotTuTriGhi({ path: "server/x.ts", original: "a", modified: "b", luot: 1 }, ctx(null), NGUOI, "vi");
    expect(r.ok).toBe(false);
    expect(r.ma).toBe("REPO_CHINH_CHUA_CHECKPOINT");
    expect(coApplyDiff(), "bị chặn TRƯỚC khi đề xuất").toBe(false);
    expect(h.confirmNhan.length).toBe(0);
  });

  it("★★★ projectId 'repo' (danh sách trắng trỏ repo chính) ⇒ từ chối", async () => {
    process.env.AI_REPO_SANDBOX_ROOTS = `repo=Repo chinh|${REPO}`;
    const r = await chayLuotTuTriGhi({ projectId: "repo", path: "client/src/App.tsx", original: "a", modified: "b", luot: 1 }, ctx(null), NGUOI, "vi");
    expect(r.ma).toBe("REPO_CHINH_CHUA_CHECKPOINT");
    expect(coApplyDiff()).toBe(false);
  });

  it("★★★ xác định bằng ĐƯỜNG, không bằng id: dự án gốc = <repo>/server ⇒ vẫn từ chối", async () => {
    const r = await chayLuotTuTriGhi({ path: "services/x.ts", original: "a", modified: "b", luot: 1 }, ctx(path.join(REPO, "server")), NGUOI, "vi");
    expect(r.ma).toBe("REPO_CHINH_CHUA_CHECKPOINT");
  });

  it.skipIf(process.platform !== "win32")("★★ Windows: gốc viết HOA vẫn nhận ra là repo chính (FS không phân biệt hoa/thường)", async () => {
    const r = await chayLuotTuTriGhi({ path: "server/x.ts", original: "a", modified: "b", luot: 1 }, ctx(REPO.toUpperCase()), NGUOI, "vi");
    expect(r.ma).toBe("REPO_CHINH_CHUA_CHECKPOINT");
  });

  it("★★★ `sandbox-projects/../server/x.ts` (thoát bằng ..) ⇒ từ chối", async () => {
    const r = await chayLuotTuTriGhi({ path: "sandbox-projects/../server/x.ts", original: "a", modified: "b", luot: 1 }, ctx(null), NGUOI, "vi");
    expect(r.ma).toBe("REPO_CHINH_CHUA_CHECKPOINT");
    expect(coApplyDiff()).toBe(false);
  });

  it("★★ junction/symlink trong dự án hộp cát trỏ vào repo chính ⇒ từ chối (so realpath)", async (c) => {
    const lien = path.join(GOC_HOP_CAT, "lien-repo");
    try {
      if (!fs.existsSync(lien)) fs.symlinkSync(path.join(REPO, "server"), lien, "junction");
    } catch {
      c.skip();
      return;
    }
    const r = await chayLuotTuTriGhi({ path: "lien-repo/x.ts", original: "a", modified: "b", luot: 1 }, ctx(), NGUOI, "vi");
    expect(r.ma).toBe("REPO_CHINH_CHUA_CHECKPOINT");
  });

  it("★★★ BỘ ĐO AGENTIC: projectId repo + tệp dưới sandbox-projects/ ⇒ VẪN được tự ghi", async () => {
    process.env.AI_REPO_SANDBOX_ROOTS = `repo=Repo chinh|${REPO}`;
    const r = await chayLuotTuTriGhi({ projectId: "repo", path: "sandbox-projects/agentic-demo/src/kho.mjs", original: "a", modified: "b", luot: 1 }, ctx(null), NGUOI, "vi");
    expect(r.ma).toBeNull();
    expect(r.ok).toBe(true);
    expect(coApplyDiff()).toBe(true);
  });

  it("★★★ dự án hộp cát đăng ký (gốc <repo>/sandbox-projects/…) ⇒ được tự ghi", async () => {
    const r = await chayLuotTuTriGhi({ path: "src/Calc.cs", original: "a", modified: "b", luot: 1 }, ctx(path.join(REPO, "sandbox-projects", "csharp-demo")), NGUOI, "vi");
    expect(r.ok).toBe(true);
  });

  it("★★★ dự án ngoài repo chính (thư mục tạm) ⇒ được tự ghi", async () => {
    const r = await chayLuotTuTriGhi({ path: "src/Calc.cs", original: "a", modified: "b", luot: 1 }, ctx(), NGUOI, "vi");
    expect(r.ok).toBe(true);
  });

  it("★★★ cờ ghi đè AI_CODING_TU_TRI_GHI_REPO_CHINH=1 ⇒ repo chính được tự ghi; giá trị lạ ⇒ vẫn chặn", async () => {
    process.env.AI_CODING_TU_TRI_GHI_REPO_CHINH = "true";
    const r0 = await chayLuotTuTriGhi({ path: "server/x.ts", original: "a", modified: "b", luot: 1 }, ctx(null), NGUOI, "vi");
    expect(r0.ma).toBe("REPO_CHINH_CHUA_CHECKPOINT");
    process.env.AI_CODING_TU_TRI_GHI_REPO_CHINH = "1";
    const r = await chayLuotTuTriGhi({ path: "server/x.ts", original: "a", modified: "b", luot: 1 }, ctx(null), NGUOI, "vi");
    expect(r.ok).toBe(true);
    expect(coApplyDiff()).toBe(true);
  });

  it("★★★ trong VÒNG: dừng `repo_chinh_chua_checkpoint`, 0 lượt ghi confirm, sổ WORM khai mã từ chối", async () => {
    const banVaServer: SinhBanVa = async () => ({ path: "server/x.ts", original: "a", modified: "b" });
    const r = await chayVongTuTriGhi({ cauHoi: CAU }, ctx(null), NGUOI, "vi", banVaServer);
    expect(r.batDau).toBe(true);
    expect(r.lyDo).toBe("repo_chinh_chua_checkpoint");
    expect(h.confirmNhan.some((c) => c.actionId === "ap-1"), "0 lượt ghi được xác nhận").toBe(false);
    expect(h.auditRows.length, "lượt bị từ chối vẫn có hàng WORM").toBe(1);
    const md = (h.auditRows[0]!.details as { metadata: Record<string, unknown> }).metadata;
    expect(md.tu_choi).toBe("REPO_CHINH_CHUA_CHECKPOINT");
    expect(md.path).toBe("server/x.ts");
  });

  it("★★ lượt ghi THÀNH CÔNG ⇒ sổ WORM `tu_choi: null`", async () => {
    h.runSeq = [{ out: "Failed: 2, Passed: 4", exit: 1 }, { out: "Passed!  - Failed: 0, Passed: 6", exit: 0 }];
    await chayVongTuTriGhi({ cauHoi: CAU }, ctx(), NGUOI, "vi", banVaGia);
    const md = (h.auditRows[0]!.details as { metadata: Record<string, unknown> }).metadata;
    expect(md.tu_choi).toBeNull();
  });

  it("★★ vị từ thuần: bảng chân trị", () => {
    expect(laGhiVaoRepoChinh(REPO, "server/a.ts")).toBe(true);
    expect(laGhiVaoRepoChinh(REPO, "package.json")).toBe(true);
    expect(laGhiVaoRepoChinh(REPO, "sandbox-projects/x/a.ts")).toBe(false);
    expect(laGhiVaoRepoChinh(REPO, "sandbox-projects"), "chính thư mục sandbox-projects không phải tệp dự án hộp cát").toBe(true);
    expect(laGhiVaoRepoChinh(REPO, "sandbox-projectsX/a.ts"), "tiền tố CHUỖI không đủ — phải là ĐOẠN").toBe(true);
    expect(laGhiVaoRepoChinh(GOC_HOP_CAT, "src/a.ts")).toBe(false);
    expect(laGhiVaoRepoChinh(GOC_HOP_CAT, path.join(REPO, "server", "a.ts")), "đường tuyệt đối vào repo").toBe(true);
  });

  it("★★★ ĐƯỜNG DUYỆT TAY không đổi: bước CHẠY (chayKiemChung) trên repo chính vẫn chạy", async () => {
    const r = await chayKiemChung({ cauHoi: CAU, luot: 1 }, ctx(null), NGUOI, "vi");
    expect(r.ok).toBe(true);
  });

  it("★★★ ĐƯỜNG DUYỆT TAY không đổi: cổng Q1 chỉ được gọi từ vòng tự ghi (census nguồn)", () => {
    const goc = path.resolve(__dirname);
    const nguoiDung: string[] = [];
    const duyet = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (e.name !== "node_modules") duyet(p);
        } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          const t = fs.readFileSync(p, "utf8");
          if (/laGhiVaoRepoChinh|tuTriGhiRepoChinhDuoc/.test(t)) nguoiDung.push(path.relative(goc, p).split(path.sep).join("/"));
        }
      }
    };
    duyet(goc);
    expect(nguoiDung.sort()).toEqual(["ai/autonomyPolicy.ts", "aiCodingTuTriGhi.ts"]);
  });
});
