/**
 * ★★★ doc 79 · VÒNG TỰ ĐỘNG — LƯỚI CHO **BƯỚC CHẠY TEST** (mặt duy nhất được chạy không cần người bấm).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ĐỘT BIẾN FILE NÀY PHẢI BẮT ĐƯỢC:
 *   • thêm `dotnet format <đường-dẫn>` vào `NHAN_KIEM_CHUNG`  ⇒ §1 ĐỎ (mục DUY NHẤT ghi đè tệp)
 *   • cho phép mọi mục danh sách trắng (bỏ tập con)           ⇒ §1 + §2 ĐỎ
 *   • tin lệnh CLIENT gửi mà không phán quyết lại             ⇒ §2 ĐỎ
 *   • bỏ kiểm TRẦN ở server                                   ⇒ §4 ĐỎ
 *   • phép SUY tự chọn `npm run check` (tsc 4 phút toàn repo) ⇒ §3 ĐỎ
 *   • đổi tool ở lời gọi `executeDecision` thành `apply_diff`  ⇒ §5 ĐỎ
 *   • bỏ `autonomy` khi confirm (lượt tự động thành vô danh)  ⇒ §5 ĐỎ
 *
 * ⚠ `sandbox-projects/**` là ĐỀ THI — lưới này KHÔNG chạy một tiến trình nào (mọi lượt chạy đều bị
 *   chặn ở `executeDecision` giả), nên nó không thể chạm vào đó.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  /** Mọi quyết định đi qua `executeDecision` — bản kiểm đếm của §5. */
  quyetDinh: [] as Array<{ tool: string | null; args: Record<string, unknown> }>,
  /** Mục ở gốc dự án mà `list_files` giả trả về. */
  mucGoc: [] as Array<{ path: string; kind: string }>,
  /** Tham số lượt `confirmAction` nhận được — §5 đọc tham số `autonomy`. */
  confirmNhan: [] as Array<{ actionId: string; autonomy: unknown }>,
  /** Đầu ra giả của lượt chạy lệnh. */
  dauRa: "Failed!  - Failed:     2, Passed:     4, Skipped: 0, Total: 6",
  maThoat: 1 as number | null,
  /** Ép `proposeAction` từ chối (RBAC). */
  tuChoi: null as string | null,
}));

vi.mock("./aiLocalTools", () => ({
  executeDecision: async (d: any) => {
    h.quyetDinh.push({ tool: d.tool, args: d.args });
    if (d.tool === "list_files") {
      return { result: { type: "action_result", title: "ls", data: { entries: h.mucGoc }, textSummary: "" } };
    }
    if (d.tool === "run_command") {
      if (h.tuChoi) return { result: null, denied: { message: h.tuChoi, reason: "PERMISSION_DENIED" } };
      return {
        result: null,
        pendingAction: { actionId: "act-1", token: "tok-1", tool: "run_command", args: d.args, summary: "", preview: {}, expiresAt: "" },
      };
    }
    return { result: null, error: "TOOL_NOT_REGISTERED" };
  },
}));

vi.mock("./aiCopilotActions", () => ({
  confirmAction: async (actionId: string, _token: string, _u: unknown, _l: unknown, _r: unknown, _d: unknown, autonomy: unknown) => {
    h.confirmNhan.push({ actionId, autonomy });
    return {
      ok: true,
      status: "executed",
      result: {
        type: "action_result",
        title: "Chạy lệnh trong repo",
        data: { exitCode: h.maThoat, timedOut: false, output: h.dauRa },
        textSummary: h.dauRa,
      },
    };
  },
}));

import {
  NHAN_KIEM_CHUNG,
  NHAN_SUY_DUOC,
  chayKiemChung,
  laLenhKiemChung,
  suyLenhKiemChung,
  tranVongLap,
  vongTuDongBat,
} from "./aiCodingVerify";
import { DANH_SACH_TRANG } from "./aiLocalTools/repoCommandSandbox";

const ENV = ["AI_CODING_AUTOLOOP", "AI_CODING_AUTOLOOP_MAX", "AI_REPO_SANDBOX_ROOTS"] as const;

function ctx() {
  return { user: { id: 7, role: "admin", name: "T" }, lang: "vi" as const };
}
const NGUOI = { id: 7, role: "admin", name: "T" };

beforeEach(() => {
  for (const k of ENV) delete process.env[k];
  // ⚠ Cờ mặc định là TẮT (xem §0). Mọi ca đo HÀNH VI của vòng phải tự BẬT nó — nếu không, chúng
  //   sẽ "xanh" chỉ vì vòng không chạy, đúng khuôn ca-âm-tự-thoả. Ca §0 tự xoá lại để đo mặc định.
  process.env.AI_CODING_AUTOLOOP = "1";
  h.quyetDinh = [];
  h.confirmNhan = [];
  h.mucGoc = [];
  h.dauRa = "Failed!  - Failed:     2, Passed:     4, Skipped: 0, Total: 6";
  h.maThoat = 1;
  h.tuChoi = null;
});
afterEach(() => {
  for (const k of ENV) delete process.env[k];
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§0 — CẦU CHÌ: tập con đang tra vào BẢNG THẬT, không phải một bản sao đã trôi", () => {
  it("★★★ mọi `nhan` trong NHAN_KIEM_CHUNG đều TỒN TẠI trong DANH_SACH_TRANG", () => {
    const that = new Set(DANH_SACH_TRANG.map((m) => m.nhan));
    for (const n of NHAN_KIEM_CHUNG) {
      expect(that.has(n), `"${n}" không còn trong danh sách trắng — tập con đã trôi khỏi bảng gốc`).toBe(true);
    }
    expect(NHAN_KIEM_CHUNG.size, "tập rỗng ⇒ mọi ca ÂM tự thoả").toBeGreaterThan(0);
  });

  it("★★ NHAN_SUY_DUOC là TẬP CON THỰC SỰ của NHAN_KIEM_CHUNG (suy hẹp hơn chạy)", () => {
    for (const n of NHAN_SUY_DUOC) expect(NHAN_KIEM_CHUNG.has(n), n).toBe(true);
    expect(NHAN_SUY_DUOC.size).toBeLessThan(NHAN_KIEM_CHUNG.size);
  });

  /**
   * ★★★ MẶC ĐỊNH **TẮT** — và ca này canh chính điều đó, vì mặc định ở đây là một PHÁN QUYẾT an
   * toàn, không phải một tiện nghi. `autonomyPolicy.ts` khai `run_command` là
   * `AUTONOMY_INELIGIBLE` với câu *"Không có cấu hình nào mở được điều này"*; cờ này là một ngoại
   * lệ có chủ ý với bất biến ấy, nên nó phải do NGƯỜI bật. Một lượt "cho tiện" đảo mặc định thành
   * BẬT sẽ lật một lập trường an toàn đã viết ra cho mọi người pull nhánh này ⇒ ca này ĐỎ.
   */
  it("★★★ cờ mặc định TẮT (ngoại lệ với AUTONOMY_INELIGIBLE phải do NGƯỜI bật)", () => {
    delete process.env.AI_CODING_AUTOLOOP; // `beforeEach` bật sẵn cho các ca khác — ca này đo MẶC ĐỊNH
    expect(vongTuDongBat(), "vắng cờ ⇒ vòng KHÔNG chạy").toBe(false);
    process.env.AI_CODING_AUTOLOOP = "0";
    expect(vongTuDongBat()).toBe(false);
    process.env.AI_CODING_AUTOLOOP = "true";
    expect(vongTuDongBat(), "chỉ đúng chuỗi \"1\" mới bật — không nhận giá trị mơ hồ").toBe(false);
    process.env.AI_CODING_AUTOLOOP = "1";
    expect(vongTuDongBat()).toBe(true);
  });

  it("★ trần mặc định trong khoảng cho phép, và trần CỨNG kẹp được cấu hình", () => {
    expect(tranVongLap()).toBeGreaterThanOrEqual(1);
    process.env.AI_CODING_AUTOLOOP_MAX = "99";
    expect(tranVongLap(), "trần cứng phải kẹp được cấu hình").toBeLessThanOrEqual(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — TẬP CON KIỂM CHỨNG: mục GHI ĐÈ TỆP bị loại", () => {
  /**
   * ⚠⚠⚠ CA QUAN TRỌNG NHẤT CỦA FILE. `dotnet format` là mục DUY NHẤT trong chín mục danh sách
   * trắng có GHI ĐÈ tệp mã nguồn. Cho vòng TỰ ĐỘNG chạy nó = byte rời ra đĩa mà không ai bấm
   * duyệt — đúng cái bất biến mà cả thiết kế này tồn tại để giữ.
   */
  it("★★★ `dotnet format` KHÔNG nằm trong tập kiểm chứng (nó GHI ĐÈ mã nguồn)", () => {
    expect(NHAN_KIEM_CHUNG.has("dotnet format <đường-dẫn>")).toBe(false);
    const r = laLenhKiemChung("dotnet format sandbox-projects/csharp-demo");
    expect(r.ok, "một lệnh GHI phải bị vòng tự động từ chối").toBe(false);
    expect(r.ok === false && r.ma).toBe("CMD_NOT_VERIFY");
  });

  it("★★ `git status` / `git diff` cũng bị loại (không trả lời được 'đã xanh chưa')", () => {
    for (const c of ["git status", "git diff"]) {
      expect(laLenhKiemChung(c).ok, c).toBe(false);
    }
  });

  it("★★ CHỐNG VÁ QUÁ TAY — bốn bộ chạy test THẬT vẫn qua được", () => {
    const qua = [
      "dotnet test sandbox-projects/csharp-demo/CalculatorDemo.sln",
      "dotnet build sandbox-projects/csharp-demo/CalculatorDemo.sln",
      "node --test sandbox-projects/react-pg-demo/test",
      "npm run check",
    ];
    for (const c of qua) expect(laLenhKiemChung(c).ok, c).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — BA LỚP PHÁN QUYẾT chạy LẠI trên lệnh do CLIENT gửi", () => {
  const chan: Array<[string, string]> = [
    ["nối lệnh bằng &&", "dotnet test x && rm -rf /"],
    ["chuyển hướng", "npm run check > /tmp/x"],
    ["lệnh ngoài danh sách trắng", "curl http://evil"],
    ["đường ra ngoài hộp cát", "dotnet test ../../../etc"],
    ["đường tuyệt đối", "node --test C:/Windows"],
    ["rỗng", ""],
  ];
  for (const [ten, c] of chan) {
    it(`★★★ ${ten} ⇒ TỪ CHỐI (CMD_NOT_VERIFY)`, () => {
      const r = laLenhKiemChung(c);
      expect(r.ok).toBe(false);
    });
  }

  it("★★★ lệnh client gửi đi qua chayKiemChung vẫn bị phán quyết LẠI (không tin client)", async () => {
    const r = await chayKiemChung({ command: "dotnet format sandbox-projects/csharp-demo", luot: 1 }, ctx(), NGUOI, "vi");
    expect(r.ok).toBe(false);
    expect(r.ma).toBe("CMD_NOT_VERIFY");
    expect(h.quyetDinh.some((q) => q.tool === "run_command"), "không được chạy gì").toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — SUY LỆNH: tất định, phạm vi DỰ ÁN, không bao giờ tự chọn lệnh toàn repo", () => {
  it("★★★ có `.sln` ở gốc ⇒ `dotnet test <sln>` (đúng dự án Demo Csharp)", () => {
    const r = suyLenhKiemChung([
      { path: "src", kind: "dir" }, { path: "tests", kind: "dir" }, { path: "CalculatorDemo.sln", kind: "file" },
    ]);
    expect(r).toEqual({ ok: true, command: "dotnet test CalculatorDemo.sln", nguon: "du_an" });
  });

  it("★★ không có `.sln` nhưng có `.csproj` ⇒ `dotnet test <csproj>`", () => {
    const r = suyLenhKiemChung([{ path: "App.csproj", kind: "file" }]);
    expect(r.ok && r.command).toBe("dotnet test App.csproj");
  });

  it("★★★ `package.json` + thư mục `test` ⇒ `node --test test` (đúng dự án Demo React + Postgres)", () => {
    const r = suyLenhKiemChung([
      { path: "package.json", kind: "file" }, { path: "src", kind: "dir" },
      { path: "test", kind: "dir" }, { path: "web", kind: "dir" },
    ]);
    expect(r).toEqual({ ok: true, command: "node --test test", nguon: "du_an" });
  });

  /**
   * ⚠⚠ Repo CHÍNH có `package.json` nhưng KHÔNG có thư mục `test` ở gốc. Nếu phép suy rơi về
   * `npm run check` thì một người duyệt một diff hai dòng sẽ kích hoạt một lượt tsc 4 phút, heap
   * 8 GB — **bất ngờ**, và bất ngờ là cách nhanh nhất để người dùng tắt hẳn tính năng.
   */
  it("★★★ KHÔNG suy ra được ⇒ NÓI THẲNG `NO_VERIFY_CMD` (KHÔNG rơi về `npm run check`)", () => {
    const r = suyLenhKiemChung([
      { path: "package.json", kind: "file" }, { path: "server", kind: "dir" }, { path: "client", kind: "dir" },
    ]);
    expect(r).toEqual({ ok: false, ma: "NO_VERIFY_CMD" });
  });

  it("★★★ phép suy KHÔNG BAO GIỜ trả một lệnh phạm vi repo, trên MỌI hình dạng gốc", () => {
    const gocThu = [
      [], [{ path: "package.json", kind: "file" }], [{ path: "README.md", kind: "file" }],
      [{ path: "src", kind: "dir" }], [{ path: "package.json", kind: "file" }, { path: "docs", kind: "dir" }],
    ];
    for (const g of gocThu) {
      const r = suyLenhKiemChung(g);
      if (r.ok) expect(r.command, JSON.stringify(g)).not.toMatch(/^npm run check/);
    }
  });

  it("★★★ NÊU ĐÍCH DANH thắng phép suy — kể cả lệnh toàn repo (nêu đích danh = đã đồng ý)", () => {
    const goc = [{ path: "CalculatorDemo.sln", kind: "file" }];
    const lenh = (cauHoi: string) => {
      const r = suyLenhKiemChung(goc, cauHoi);
      return r.ok ? r.command : null;
    };
    expect(lenh("sửa X rồi chạy npm run check")).toBe("npm run check");
    expect(lenh("chạy node --test test/a.test.mjs")).toBe("node --test test/a.test.mjs");
    expect(lenh("sửa Calculator.cs cho đúng")).toBe("dotnet test CalculatorDemo.sln");
  });

  it("★★★ `dotnet format` nêu đích danh CŨNG KHÔNG được suy (nó không phải lệnh kiểm chứng)", () => {
    const r = suyLenhKiemChung([{ path: "A.sln", kind: "file" }], "chạy dotnet format src rồi báo");
    expect(r.ok && r.command).not.toContain("format");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — CỔNG SERVER: cờ · trần · dự án", () => {
  it("★★★ cờ TẮT ⇒ KHÔNG chạy gì, khai `AUTOLOOP_OFF` (không im lặng)", async () => {
    process.env.AI_CODING_AUTOLOOP = "0";
    const r = await chayKiemChung({ command: "npm run check", luot: 1 }, ctx(), NGUOI, "vi");
    expect(r.ok).toBe(false);
    expect(r.ma).toBe("AUTOLOOP_OFF");
    expect(h.quyetDinh.length).toBe(0);
  });

  it("★★★ lượt VƯỢT TRẦN ⇒ TỪ CHỐI ở SERVER (client không tự nới trần được)", async () => {
    process.env.AI_CODING_AUTOLOOP_MAX = "2";
    const ok = await chayKiemChung({ command: "npm run check", luot: 2 }, ctx(), NGUOI, "vi");
    expect(ok.ok).toBe(true);
    h.quyetDinh = [];
    const qua = await chayKiemChung({ command: "npm run check", luot: 3 }, ctx(), NGUOI, "vi");
    expect(qua.ok).toBe(false);
    expect(qua.ma).toBe("LOOP_CAP");
    expect(h.quyetDinh.length, "vượt trần ⇒ không một lượt chạy nào").toBe(0);
  });

  it("★ lượt méo (0, âm, không nguyên) ⇒ LOOP_CAP", async () => {
    for (const l of [0, -1, 1.5]) {
      const r = await chayKiemChung({ command: "npm run check", luot: l }, ctx(), NGUOI, "vi");
      expect(r.ma, String(l)).toBe("LOOP_CAP");
    }
  });

  it("★★★ projectId LẠ ⇒ PROJECT_NOT_FOUND, KHÔNG âm thầm chạy trên gốc mặc định", async () => {
    const r = await chayKiemChung({ projectId: "khong-co-that", command: "npm run check", luot: 1 }, ctx(), NGUOI, "vi");
    expect(r.ok).toBe(false);
    expect(r.ma).toBe("PROJECT_NOT_FOUND");
    expect(h.quyetDinh.length).toBe(0);
  });

  it("★★ KHÔNG có ngữ cảnh phiên ⇒ TỪ CHỐI (không chạy lén)", async () => {
    const r = await chayKiemChung({ command: "npm run check", luot: 1 }, undefined, NGUOI, "vi");
    expect(r.ma).toBe("NO_EXEC_CONTEXT");
  });

  it("★★★ RBAC từ chối (thiếu ai_repo_exec) ⇒ khai `DENIED` kèm câu từ chối THẬT", async () => {
    h.tuChoi = "Bạn không có quyền ai_repo_exec/canCreate.";
    const r = await chayKiemChung({ command: "npm run check", luot: 1 }, ctx(), NGUOI, "vi");
    expect(r.ok).toBe(false);
    expect(r.ma).toBe("DENIED");
    expect(r.message).toContain("ai_repo_exec");
    expect(h.confirmNhan.length, "bị từ chối ở propose ⇒ KHÔNG confirm").toBe(0);
  });

  it("★★★ KHÔNG suy ra được lệnh ⇒ NO_VERIFY_CMD, và KHÔNG chạy gì", async () => {
    h.mucGoc = [{ path: "package.json", kind: "file" }, { path: "server", kind: "dir" }];
    const r = await chayKiemChung({ luot: 1 }, ctx(), NGUOI, "vi");
    expect(r.ma).toBe("NO_VERIFY_CMD");
    expect(h.quyetDinh.some((q) => q.tool === "run_command")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§5 — CHIỀU DƯƠNG + BẤT BIẾN: chỉ `run_command`, và lượt tự động KHÔNG vô danh", () => {
  it("★★★ chạy được: suy lệnh từ gốc dự án → run_command → confirm → ĐỌC ĐƯỢC 2 đỏ / 4 xanh", async () => {
    h.mucGoc = [{ path: "CalculatorDemo.sln", kind: "file" }, { path: "src", kind: "dir" }];
    const r = await chayKiemChung({ luot: 1 }, ctx(), NGUOI, "vi");
    expect(r.ok).toBe(true);
    expect(r.command).toBe("dotnet test CalculatorDemo.sln");
    expect(r.exitCode).toBe(1);
    expect(r.soDo).toBe(2);
    expect(r.soXanh).toBe(4);
    expect(r.xanh).toBe(false);
    expect(r.output).toContain("Failed");
  });

  it("★★★ XANH HẾT ⇒ `xanh=true` (điều kiện dừng của vòng)", async () => {
    h.dauRa = "Passed!  - Failed:     0, Passed:     6, Skipped: 0, Total: 6";
    h.maThoat = 0;
    const r = await chayKiemChung({ command: "dotnet test sandbox-projects/csharp-demo/CalculatorDemo.sln", luot: 1 }, ctx(), NGUOI, "vi");
    expect(r.xanh).toBe(true);
    expect(r.soDo).toBe(0);
  });

  /**
   * ⚠⚠⚠ BẤT BIẾN HITL. Tên tool ở lời gọi `executeDecision` là một HẰNG CHỮ. Nếu ai đó biến nó
   * thành tham số (hay thêm `apply_diff`), vòng tự động sẽ ghi được tệp mà không ai bấm duyệt.
   */
  it("★★★ MỌI lượt chỉ sinh ra `list_files` và `run_command` — KHÔNG BAO GIỜ `apply_diff`", async () => {
    h.mucGoc = [{ path: "CalculatorDemo.sln", kind: "file" }];
    await chayKiemChung({ luot: 1 }, ctx(), NGUOI, "vi");
    await chayKiemChung({ command: "npm run check", luot: 2 }, ctx(), NGUOI, "vi");
    expect(h.quyetDinh.length).toBeGreaterThan(0);
    for (const q of h.quyetDinh) expect(["list_files", "run_command"]).toContain(q.tool);
    expect(h.quyetDinh.some((q) => q.tool === "apply_diff")).toBe(false);
  });

  it("★★★ lượt confirm TỰ ĐỘNG được ĐÁNH DẤU trong audit (`autonomy.reason`), không vô danh", async () => {
    await chayKiemChung({ command: "npm run check", luot: 1 }, ctx(), NGUOI, "vi");
    expect(h.confirmNhan.length).toBe(1);
    expect(h.confirmNhan[0]!.autonomy).toEqual({ reason: "AI_CODING_AUTOLOOP_VERIFY" });
  });

  it("★★ lượt chạy đi qua ĐÚNG cửa HITL (propose ⇒ actionId ⇒ confirm cùng actionId)", async () => {
    await chayKiemChung({ command: "npm run check", luot: 1 }, ctx(), NGUOI, "vi");
    expect(h.confirmNhan[0]!.actionId).toBe("act-1");
  });
});
