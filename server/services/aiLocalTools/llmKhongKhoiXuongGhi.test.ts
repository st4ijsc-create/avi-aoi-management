/**
 * ★★★ doc 81 — BỘ CHỌN LLM KHÔNG ĐƯỢC KHỞI XƯỚNG `apply_diff`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * LƯỚI NÀY SINH RA TỪ MỘT PHÉP ĐO LIVE, KHÔNG PHẢI TỪ SUY LUẬN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Nghiệm thu live 2026-08-19 trên trình duyệt:
 *   • Lượt 1: *"viết một hàm C# tính giai thừa"* ⇒ sinh mã đúng, đẹp.
 *   • Lượt 2: *"giờ đổi nó sang dùng đệ quy"* — câu tiếp nối, **KHÔNG nêu tệp nào**.
 *     ⇒ bộ chọn TẤT ĐỊNH trả `null` (đúng: không có đường dẫn để trích)
 *     ⇒ rơi xuống bộ chọn LLM, và nó **BỊA cả đường dẫn lẫn `original`**:
 *        `server/services/aiLocalTools/toolRegistry.ts` (tệp lõi THẬT, 24.902 byte) với nội dung
 *        `function processToolCall(...) { return result; }` — **không hề có trong tệp đó**.
 *     ⇒ đẻ ra thẻ "Đề xuất SỬA tệp" trông rất tự tin cho một tệp KHÔNG LIÊN QUAN.
 *
 * Hàng rào băm đã giữ được (bấm "Duyệt & ghi" ⇒ tệp nguyên vẹn từng byte, `git status` sạch).
 * Nhưng **"không hỏng" ≠ "đúng"**: người dùng vẫn thấy một đề xuất sai và mất một cú bấm.
 *
 * ⚠ LÝ LẼ CẤU TẠO (đây mới là điều lưới ghim, không phải một khẩu vị):
 *   `applyDiff` neo TOCTOU bằng `sha256(original) === sha256(đĩa)`. Bộ chọn LLM **không bao giờ đọc
 *   tệp** ⇒ `original` của nó **luôn là phỏng đoán** ⇒ đường này **về cấu tạo không thể** tạo ra một
 *   lượt ghi hợp lệ. Bỏ nó **không mất năng lực nào**; đường ghi hợp lệ (`streamCodingEdit`, đọc đĩa
 *   TRƯỚC) không đổi một byte.
 *
 * ⚠ `run_command` **GIỮ LẠI** — nó không có neo băm để hỏng, đi qua danh sách trắng 9 mục + khớp
 *   cấu trúc argv, và vẫn qua HITL. Hai lớp lỗi khác nhau; §3 ghim sự khác biệt ấy để lượt sau
 *   không ai "dọn cho gọn" bằng cách chặn luôn cả hai.
 *
 * ⚠⚠ VÌ SAO KIỂM HÀM THUẦN, KHÔNG GIẢ LẬP ENGINE: bản lưới ĐẦU của tôi mock `aiGateway`/
 *   `aiGgufEngine` bằng `vi.doMock`. Nó XANH khi chạy riêng và **ĐỎ khi chạy cả thư mục** — vì
 *   `doMock` chỉ chi phối đồ thị module của lượt nhập SAU nó, mà trong suite thì module đã bị tệp
 *   khác nạp trước. Đó đúng là lớp "đỏ/xanh theo THỨ TỰ CHẠY" mà repo này đã dính nhiều lần. Hàm
 *   thuần không có mặt tiếp xúc ấy.
 */
import { describe, it, expect } from "vitest";
import { locQuyetDinhLLMLapTrinh, CODING_TOOL_NAMES } from "./intentClassifier";

/** Nguyên văn thứ model đã bịa ra trong sự cố live. */
const QUYET_DINH_BIA = {
  tool: "apply_diff",
  args: {
    path: "server/services/aiLocalTools/toolRegistry.ts",
    original: "function processToolCall(toolName: string) {\n  // logic here\n  return result;\n}",
    modified: "function processToolCall(toolName: string) {\n  return processToolCall(toolName); // recursive call\n}",
  },
  reason: "LLM_OK",
} as const;

describe("§1 — CA THẬT: model bịa cả đường dẫn lẫn `original` ⇒ phải bị TỪ CHỐI", () => {
  it("★★★ `apply_diff` do LLM khởi xướng ⇒ tool = null, có mã đọc được", () => {
    const d = locQuyetDinhLLMLapTrinh({ ...QUYET_DINH_BIA });
    expect(d.tool, "LLM KHÔNG được khởi xướng lượt ghi — `original` của nó luôn là phỏng đoán").toBeNull();
    expect(d.reason).toBe("CODING_LLM_KHONG_KHOI_XUONG_GHI");
  });

  it("★★★ đường dẫn BỊA không được rò ra ngoài như thể nó có nghĩa", () => {
    const d = locQuyetDinhLLMLapTrinh({ ...QUYET_DINH_BIA });
    expect(JSON.stringify(d.args)).not.toContain("toolRegistry");
    expect(JSON.stringify(d.args)).not.toContain("processToolCall");
  });
});

describe("§2 — KHÔNG vá quá tay: mọi tool ĐỌC đi qua nguyên vẹn", () => {
  const DOC: Array<{ tool: string; args: Record<string, unknown> }> = [
    { tool: "read_file", args: { path: "server/routers.ts" } },
    { tool: "list_files", args: { path: "server/services" } },
    { tool: "grep_repo", args: { pattern: "executeDecision" } },
  ];
  for (const q of DOC) {
    it(`★★ \`${q.tool}\` qua nguyên vẹn, args KHÔNG bị đụng`, () => {
      const d = locQuyetDinhLLMLapTrinh({ ...q, reason: "LLM_OK" });
      expect(d.tool).toBe(q.tool);
      expect(d.args).toEqual(q.args);
      expect(d.reason).toBe("LLM_OK");
    });
  }

  it("★★★ ĐỐI CHỨNG — quyết định RỖNG (không tool) cũng qua nguyên vẹn", () => {
    const d = locQuyetDinhLLMLapTrinh({ tool: null, args: {}, reason: "LLM_NONE" });
    expect(d.tool).toBeNull();
    expect(d.reason).toBe("LLM_NONE");
  });
});

describe("§3 — RANH GIỚI: `run_command` KHÁC `apply_diff`, cố ý GIỮ LẠI", () => {
  it("★★★ `run_command` VẪN qua — không có neo băm để hỏng, và vẫn qua HITL", () => {
    const d = locQuyetDinhLLMLapTrinh({ tool: "run_command", args: { command: "npm run check" }, reason: "LLM_OK" });
    expect(d.tool, "chặn luôn run_command là vá quá tay — hai lớp lỗi khác nhau").toBe("run_command");
  });
});

describe("§4 — CẦU CHÌ: phép lọc chạm ĐÚNG MỘT tên trong 5 tool lập trình", () => {
  it("★★★ đúng 1/5 tool bị chặn — nếu con số này đổi, ai đó đã nới hoặc siết mà không khai", () => {
    // Cầu chì chiều dương: tập tool phải đủ lớn, nếu không mọi khẳng định dưới là chân lý rỗng.
    expect(CODING_TOOL_NAMES.length).toBe(5);
    const biChan = CODING_TOOL_NAMES.filter(
      (t) => locQuyetDinhLLMLapTrinh({ tool: t, args: {}, reason: "LLM_OK" }).tool === null,
    );
    expect(biChan).toEqual(["apply_diff"]);
  });
});
