/**
 * ★★★ G3-C VIỆC 1 — **BẢN KIỂM ĐẾM (CENSUS) TRÊN REGISTRY SỐNG, KHÔNG PHẢI MỘT BẢN LIỆT KÊ THỨ HAI.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO FILE NÀY TỒN TẠI, TÁCH KHỎI `autonomyPolicy.test.ts`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `autonomyPolicy.test.ts` đối chiếu `AUTONOMY_INELIGIBLE` (21 tên viết cứng) với **một mảng 21
 * tên viết cứng khác**. Hai bản sao của cùng một bản liệt kê, không bên nào đọc `listTools()`.
 * ⇒ Thêm một write tool mới hôm nay: nó **mặc định đủ tư cách tự trị** và **không ca nào đỏ**.
 * File này là lưới đi theo **ĐƯỜNG THOÁT** (registry sống) thay vì theo **DANH SÁCH**.
 *
 * Nó cố ý KHÔNG mock `drizzle-orm` (khác `autonomyPolicy.test.ts`) vì nó phải nạp **thật** cả cây
 * `aiLocalTools` để có registry thật; chỉ `db/connection` và `aiCopilotActions` bị thay bằng bản
 * giả tối thiểu — hai cạnh I/O duy nhất của `evaluateAutonomy`.
 *
 * ⚠⚠ MỌI khẳng định về "tool này bị cấm" đều đi qua **`evaluateAutonomy()`**, KHÔNG qua
 * `AUTONOMY_INELIGIBLE.has(...)`. Lý do là một bài học đã trả giá: một ca đọc `Set.has` là đọc
 * **tên định danh**, không đọc **thứ tên đó trỏ tới** — xoá nguyên điều kiện denylist khỏi
 * `evaluateAutonomyChain` thì cái Set vẫn còn đủ tên và ca ấy vẫn XANH.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hai cạnh I/O duy nhất, thay bằng bản giả tối thiểu ───────────────────────────────────────
// `isKillSwitchTripped` đọc ai_system_config; bảng rỗng ⇒ "chưa bao giờ bật" ⇒ NOT tripped.
const fakeDb = {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [] as unknown[] }) }) }),
};
vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => fakeDb) }));

const evaluateContractForAutonomy = vi.fn();
vi.mock("../aiCopilotActions", () => ({
  // `aiLocalTools/index.ts` nhập TĨNH `proposeAction` ⇒ phải có mặt trong factory.
  proposeAction: vi.fn(),
  evaluateContractForAutonomy: (...a: unknown[]) => evaluateContractForAutonomy(...a),
}));

// ── Nạp MỌI module tự đăng ký tool (side-effect). Xem ca §C: danh sách này được canh bằng
//    một phép quét NGUỒN, nên một file đăng ký MỚI không thể lặng lẽ nằm ngoài phép đếm. ──
import "../aiLocalTools";
import "../visionDefectProposal";

import { listTools, registerTool, type Tool } from "../aiLocalTools/toolRegistry";
import {
  evaluateAutonomy,
  AUTONOMY_REASONS,
  AUTONOMY_INELIGIBLE,
  AUTONOMY_REVIEWED_SAFE,
  apDungDiffTuTriDuoc,
  autonomyGhiTuTriBat,
  phanLoaiTuTri,
  writeToolChuaPhanLoai,
  __resetAutonomyRateCapForTests,
  type AutonomyContext,
} from "./autonomyPolicy";

/**
 * ẢNH CHỤP registry ở trạng thái SẢN XUẤT — lấy ở scope module, TRƯỚC khi bất kỳ ca nào đăng ký
 * tool tổng hợp (§B). `clearRegistry()` cố ý không được gọi ở đây: ca §B cần registry thật.
 */
const ANH_CHUP_SAN_XUAT = listTools().map((t) => ({ name: t.name, kind: t.kind ?? "read" }));
const WRITE_SAN_XUAT = ANH_CHUP_SAN_XUAT.filter((t) => t.kind === "write");

const USER = { id: 1, role: "admin", name: "Admin" };
function ctx(tool: string): AutonomyContext {
  return { user: USER, tool, actionId: "census", lang: "vi" };
}

beforeEach(() => {
  vi.clearAllMocks();
  evaluateContractForAutonomy.mockResolvedValue({ ok: true });
  process.env.AI_AUTONOMY_ENABLED = "true";
  __resetAutonomyRateCapForTests();
});

afterEach(() => {
  delete process.env.AI_AUTONOMY_ENABLED;
  delete process.env.AI_AUTONOMY_ALLOWLIST;
  delete process.env.AI_CODING_TU_TRI_GHI;
});

/** Chạy `evaluateAutonomy` với MỌI điều kiện khác đã xanh + tool được allowlist. */
async function quyetDinhKhiMoiThuKhacXanh(toolName: string) {
  process.env.AI_AUTONOMY_ALLOWLIST = toolName;
  return evaluateAutonomy(
    { type: toolName, idempotencyKey: `idem-${toolName}`, contract: { requires: [] }, args: {} },
    ctx(toolName),
  );
}

describe("§A — census: MỌI write tool trong registry SỐNG phải đã được phân loại", () => {
  it("registry sống có write tool (nếu con số này về 0 thì chính phép đo đã hỏng, không phải hệ an toàn)", () => {
    expect(WRITE_SAN_XUAT.length).toBeGreaterThanOrEqual(27);
  });

  it("★ KHÔNG write tool nào chưa phân loại — đây là ca vỡ khi thêm tool thứ N+1", () => {
    // Thông điệp lỗi nói thẳng phải làm gì, vì người gặp nó là người vừa thêm tool.
    expect(
      writeToolChuaPhanLoai(ANH_CHUP_SAN_XUAT),
      "write tool mới chưa được triage: thêm tên vào AUTONOMY_INELIGIBLE (mặc định đúng) " +
        "hoặc vào AUTONOMY_REVIEWED_SAFE kèm LÝ DO viết ra",
    ).toEqual([]);
  });

  it("hai tập rời nhau — một tên không được vừa cấm vừa 'đã duyệt an toàn'", () => {
    const giao = [...AUTONOMY_REVIEWED_SAFE.keys()].filter((n) => AUTONOMY_INELIGIBLE.has(n));
    expect(giao).toEqual([]);
  });

  it("mọi mục REVIEWED_SAFE đều có LÝ DO thật (không phải chuỗi rỗng/placeholder)", () => {
    for (const [ten, lyDo] of AUTONOMY_REVIEWED_SAFE) {
      expect(lyDo.trim().length, `"${ten}" phải có lý do viết ra`).toBeGreaterThan(20);
    }
  });

  it("★ HÀNH VI, không phải Set.has — mỗi write tool đăng ký cho ra ĐÚNG quyết định của phân loại nó", async () => {
    for (const t of WRITE_SAN_XUAT) {
      const loai = phanLoaiTuTri(t.name);
      const res = await quyetDinhKhiMoiThuKhacXanh(t.name);
      if (loai === "INELIGIBLE") {
        expect(res, `"${t.name}" bị denylist ⇒ phải TỪ CHỐI dù đã allowlist`).toEqual({
          allowed: false,
          reason: AUTONOMY_REASONS.TYPE_INELIGIBLE,
        });
      } else if (loai === "REVIEWED_SAFE") {
        expect(res, `"${t.name}" đã duyệt an toàn ⇒ phải đủ tư cách khi được allowlist`).toEqual({
          allowed: true,
          reason: AUTONOMY_REASONS.OK,
        });
      } else {
        throw new Error(`"${t.name}" chưa phân loại — xem ca census phía trên`);
      }
    }
  });
});

describe("§B — ĐỘT BIẾN: thêm một write tool MỚI chưa phân loại", () => {
  const TEN_MOI = "__tool_write_tong_hop_chua_phan_loai";
  const toolMoi: Tool<Record<string, never>, unknown> = {
    name: TEN_MOI,
    description: "tool tổng hợp cho ca đột biến",
    parameters: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
    triggers: [],
    kind: "write",
    requiredPermission: { module: "ai", action: "canEdit" },
    summarize: () => "tổng hợp",
    preview: async () => ({ entityType: "test", changes: [], warnings: [], humanSummary: "x" }),
    execute: async () => ({ type: "action_result", title: "x", data: {}, textSummary: "x" }),
  };

  it("★ census ĐỎ ngay khi tool mới xuất hiện trong registry", () => {
    registerTool(toolMoi);
    expect(writeToolChuaPhanLoai(listTools())).toContain(TEN_MOI);
  });

  it("★ và LÚC CHẠY nó bị TỪ CHỐI (TYPE_UNCLASSIFIED) DÙ người vận hành đã ghi nó vào allowlist", async () => {
    registerTool(toolMoi);
    const res = await quyetDinhKhiMoiThuKhacXanh(TEN_MOI);
    expect(res).toEqual({ allowed: false, reason: AUTONOMY_REASONS.TYPE_UNCLASSIFIED });
  });

  it("chống-vá-quá-tay: một tool ĐÃ phân loại REVIEWED_SAFE vẫn qua được điều kiện 3b", async () => {
    const daDuyet = [...AUTONOMY_REVIEWED_SAFE.keys()][0]!;
    const res = await quyetDinhKhiMoiThuKhacXanh(daDuyet);
    expect(res).toEqual({ allowed: true, reason: AUTONOMY_REASONS.OK });
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// §C — LƯỚI CHO CHÍNH LƯỚI: phép đếm ở §A chỉ thấy những tool đã được NẠP. Một file đăng ký write
// tool mới mà không nằm trong đồ thị nhập của file này sẽ vô hình với §A — đúng lớp lỗi "lưới theo
// FILE, không theo ĐƯỜNG THOÁT". Ca dưới quét NGUỒN `server/` và đòi mọi file đăng ký write tool
// phải nằm trong danh sách nhập tĩnh ở đầu file này.
//
// ⚠ GIỚI HẠN ĐÃ BIẾT, CÓ CHỦ Ý: phép quét đọc chữ `kind: "write"` viết thẳng trong nguồn. Một tool
// đặt `kind` bằng BIẾN sẽ lọt lưới quét này — và đó chính là lý do điều kiện 3b của
// `evaluateAutonomyChain` cưỡng chế LÚC CHẠY trên registry, chứ không phải chỉ ở đây.
// ══════════════════════════════════════════════════════════════════════════════════════════════
const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Đường dẫn (POSIX, tương đối `server/`) của mọi file được §A nạp gián tiếp hoặc trực tiếp. */
const FILE_DANG_KY_WRITE_TOOL_DA_NAP = [
  "services/aiLocalTools/writeHandlers.ts",
  "services/aiLocalTools/writeHandlers/alerts.ts",
  "services/aiLocalTools/writeHandlers/engineering.ts",
  "services/aiLocalTools/writeHandlers/interlock.ts",
  "services/aiLocalTools/writeHandlers/machineControl.ts",
  "services/aiLocalTools/writeHandlers/maintenance.ts",
  "services/aiLocalTools/writeHandlers/measurementPoint.ts",
  "services/aiLocalTools/writeHandlers/programmingFile.ts",
  "services/aiLocalTools/writeHandlers/qualityAdvisory.ts",
  // doc 78 PHA B — `run_command` (nạp qua `import "./writeHandlers/repoCommand"` ở aiLocalTools/index.ts).
  "services/aiLocalTools/writeHandlers/repoCommand.ts",
  /**
   * ★ doc 78 PHA C — `apply_diff`. **File này ĐÃ được nạp từ 2026-08-19 mà DANH SÁCH NÀY KHÔNG
   * BIẾT**, nên §A khai `apply_diff` "chưa phân loại" và §C lệch 14/13 — cả hai ĐỎ từ trước đợt
   * doc 79. Đúng lớp lỗi "N+1" mà chính file này được dựng ra để chặn: lưới bắt được, nhưng không
   * ai đọc con đỏ. Nay `apply_diff` đã được xếp vào `AUTONOMY_INELIGIBLE` (xem lý do ở đó).
   */
  "services/aiLocalTools/writeHandlers/applyDiff.ts",
  /**
   * ★ doc 79 (2026-08-20) — `apply_diff_batch`. Nạp qua `import "./writeHandlers/applyDiffBatch"`
   * ở `aiLocalTools/index.ts` (đồ thị nhập của `import "../aiLocalTools"` dòng 43). §C đã ĐỎ đúng
   * lượt tool này ra đời — tức lưới N+1 chạy đúng chức năng của nó. Tool đã được xếp vào
   * `AUTONOMY_INELIGIBLE` (xem lý do tại đó: nó ghi N tệp và hỏng giữa chừng thì để lại cây mã
   * NỬA VỜI — trạng thái khó dò nhất để tự động hoá).
   */
  "services/aiLocalTools/writeHandlers/applyDiffBatch.ts",
  "services/aiLocalTools/writeHandlers/visionControl.ts",
  "services/aiLocalTools/writeHandlers/yield.ts",
  "services/visionDefectProposal.ts",
].sort();

function duyetTs(dir: string, ra: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist" || e.name === "build") continue;
      duyetTs(p, ra);
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") && !e.name.endsWith(".spec.ts")) {
      ra.push(p);
    }
  }
  return ra;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ 2026-08-24 · §D — LỜI KHAI: `apply_diff` "GỠ KHỎI INELIGIBLE CÓ ĐIỀU KIỆN" NGHĨA LÀ GÌ.
//
// Vòng TỰ-TRỊ-GHI (`AI_CODING_TU_TRI_GHI`, mặc định TẮT) auto-confirm `apply_diff` KHÔNG người bấm.
// "Gỡ có điều kiện" ở đây là một **VỊ TỪ** (`apDungDiffTuTriDuoc`), KHÔNG phải xoá tên khỏi
// `AUTONOMY_INELIGIBLE`. Hai lời khai phải cùng đúng, nếu không census đang nói dối:
//   1. VỊ TỪ mở cửa THỨ HAI (vòng tự-ghi) theo cờ — CHỈ cho `apply_diff`, CHỈ khi cờ `"1"`.
//   2. Đường bounded-autonomy VẬN HÀNH (`evaluateAutonomy`) VẪN từ chối `apply_diff` ở điều kiện 3
//      — BẤT KỂ cờ. Cờ tự-ghi KHÔNG mở đường vận hành; đó là điểm của "hai cửa, hai chính sách".
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§D — apply_diff: cửa tự-ghi mở CÓ ĐIỀU KIỆN, cửa vận hành VẪN đóng", () => {
  it("★★★ VỊ TỪ `apDungDiffTuTriDuoc` chỉ mở cho apply_diff + CHỈ khi cờ `\"1\"` (đột biến 'luôn true' ⇒ ĐỎ)", () => {
    delete process.env.AI_CODING_TU_TRI_GHI;
    expect(autonomyGhiTuTriBat(), "vắng cờ ⇒ TẮT").toBe(false);
    expect(apDungDiffTuTriDuoc("apply_diff"), "cờ TẮT ⇒ apply_diff KHÔNG tự-ghi được").toBe(false);

    process.env.AI_CODING_TU_TRI_GHI = "true";
    expect(apDungDiffTuTriDuoc("apply_diff"), "chỉ chuỗi \"1\" mới bật — \"true\" không").toBe(false);

    process.env.AI_CODING_TU_TRI_GHI = "1";
    expect(autonomyGhiTuTriBat()).toBe(true);
    expect(apDungDiffTuTriDuoc("apply_diff"), "cờ BẬT ⇒ apply_diff tự-ghi được").toBe(true);
    // Chỉ apply_diff — không tool ghi nào khác được vị từ này mở, kể cả khi cờ bật.
    for (const t of ["apply_diff_batch", "run_command", "machine_start", "set_spec_limits"]) {
      expect(apDungDiffTuTriDuoc(t), `${t} KHÔNG được cửa tự-ghi mở`).toBe(false);
    }
  });

  it("★★★ đường VẬN HÀNH: apply_diff VẪN TYPE_INELIGIBLE — BẤT KỂ cờ tự-ghi (cửa hai KHÔNG mở cửa một)", async () => {
    for (const flag of [undefined, "1"] as const) {
      if (flag === undefined) delete process.env.AI_CODING_TU_TRI_GHI;
      else process.env.AI_CODING_TU_TRI_GHI = flag;
      const res = await quyetDinhKhiMoiThuKhacXanh("apply_diff");
      expect(res, `cờ=${flag}: evaluateAutonomy phải VẪN từ chối apply_diff`).toEqual({
        allowed: false,
        reason: AUTONOMY_REASONS.TYPE_INELIGIBLE,
      });
    }
  });

  it("★★ apply_diff vẫn nằm trong AUTONOMY_INELIGIBLE (không xoá cứng khỏi tập — chỉ thêm một VỊ TỪ)", () => {
    expect(AUTONOMY_INELIGIBLE.has("apply_diff")).toBe(true);
    expect(phanLoaiTuTri("apply_diff")).toBe("INELIGIBLE");
  });
});

describe("§C — mọi FILE đăng ký write tool đều nằm trong đồ thị nhập của phép đếm", () => {
  it("★ phép quét nguồn khớp ĐÚNG danh sách file đã nạp", () => {
    const timThay = duyetTs(SERVER_DIR)
      .filter((p) => {
        const src = fs.readFileSync(p, "utf8");
        return src.includes("registerTool") && /kind:\s*"write"/.test(src);
      })
      .map((p) => path.relative(SERVER_DIR, p).split(path.sep).join("/"))
      .sort();
    expect(
      timThay,
      "một file đăng ký write tool vừa xuất hiện/biến mất: thêm `import` của nó ở đầu " +
        "autonomyWriteToolCensus.test.ts rồi triage tool mới vào AUTONOMY_INELIGIBLE/AUTONOMY_REVIEWED_SAFE",
    ).toEqual(FILE_DANG_KY_WRITE_TOOL_DA_NAP);
  });
});
