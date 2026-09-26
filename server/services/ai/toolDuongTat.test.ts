import { describe, it, expect } from "vitest";
import { quyetDinhDuongTat, moiVongDeuTuChoi, cauChiNenNo, TOOL_MANG_NGU_CANH, type ThamSoDuongTat } from "./toolDuongTat";

const nen: ThamSoDuongTat = {
  tenTool: "get_today_stats",
  doDaiSummary: 900,
  daDaBuoc: false,
  khongCoGiDeNoi: false,
  tranDoDai: 150,
};
const voi = (p: Partial<ThamSoDuongTat>): ThamSoDuongTat => ({ ...nen, ...p });

describe("quyetDinhDuongTat — bản vá P11 (audit 2026-09-21)", () => {
  // ─── CA DƯƠNG ĐÃ BIẾT: hành vi CŨ phải giữ nguyên ──────────────────────────────────────────
  it("★ tool DỮ-LIỆU-SỐNG với summary đủ dài VẪN đi đường tắt (không cộng 10-15s cho câu vận hành)", () => {
    expect(quyetDinhDuongTat(nen)).toEqual({ dungDuongTat: true, lyDo: "summary_du_dai" });
  });

  it("summary quá ngắn ⇒ vẫn gọi LLM như cũ", () => {
    expect(quyetDinhDuongTat(voi({ doDaiSummary: 149 }))).toEqual({
      dungDuongTat: false,
      lyDo: "summary_qua_ngan",
    });
  });

  it("đúng biên: bằng trần thì ĐI đường tắt", () => {
    expect(quyetDinhDuongTat(voi({ doDaiSummary: 150 })).dungDuongTat).toBe(true);
  });

  it("đã đi NHIỀU bước ⇒ không đường tắt (giá trị nằm ở phép TỔNG HỢP)", () => {
    expect(quyetDinhDuongTat(voi({ daDaBuoc: true }))).toEqual({
      dungDuongTat: false,
      lyDo: "da_da_buoc",
    });
  });

  it("tool nói KHÔNG CÓ GÌ ⇒ trả thẳng, không mời LLM diễn giải cái rỗng (chống bịa)", () => {
    expect(quyetDinhDuongTat(voi({ khongCoGiDeNoi: true, doDaiSummary: 0 }))).toEqual({
      dungDuongTat: true,
      lyDo: "tool_khong_co_gi_de_noi",
    });
  });

  // ─── BẢN VÁ P11: tool MANG NGỮ CẢNH không bao giờ được là câu trả lời ──────────────────────
  it.each([...TOOL_MANG_NGU_CANH])(
    "★★★ P11 — `%s` KHÔNG đi đường tắt dù summary rất dài (26.004 byte là ca THẬT đã đo)",
    (tenTool) => {
      expect(quyetDinhDuongTat(voi({ tenTool, doDaiSummary: 26_004 }))).toEqual({
        dungDuongTat: false,
        lyDo: "tool_mang_ngu_canh",
      });
    },
  );

  it("★★★ P11 — summary CÀNG DÀI càng không được đường tắt (dài = đọc được nhiều ngữ cảnh)", () => {
    for (const n of [151, 1_000, 26_004, 1_000_000]) {
      expect(quyetDinhDuongTat(voi({ tenTool: "read_file", doDaiSummary: n })).dungDuongTat).toBe(false);
    }
  });

  it("tool ngữ cảnh mà KHÔNG CÓ GÌ ĐỂ NÓI thì vẫn trả thẳng lời từ chối trung thực", () => {
    // Thứ tự cổng có tải trọng: `khongCoGiDeNoi` đứng TRƯỚC `TOOL_MANG_NGU_CANH`.
    expect(quyetDinhDuongTat(voi({ tenTool: "read_file", khongCoGiDeNoi: true }))).toEqual({
      dungDuongTat: true,
      lyDo: "tool_khong_co_gi_de_noi",
    });
  });

  it("tenTool null/undefined ⇒ rơi về nhánh CŨ, không đổi hành vi", () => {
    expect(quyetDinhDuongTat(voi({ tenTool: null })).dungDuongTat).toBe(true);
    expect(quyetDinhDuongTat(voi({ tenTool: undefined })).dungDuongTat).toBe(true);
  });

  // ─── CANH DANH SÁCH: đột biến xoá một mục phải bị bắt ──────────────────────────────────────
  it("★ danh sách tool mang ngữ cảnh đúng 5 mục đã khai (đột biến thêm/bớt ⇒ ĐỎ)", () => {
    expect([...TOOL_MANG_NGU_CANH].sort()).toEqual(
      ["grep_repo", "list_files", "read_file", "read_project_file", "retrieve_programming_kb"].sort(),
    );
  });

  it("★ tool GHI/ hành động KHÔNG nằm trong danh sách ngữ cảnh (chỉ tool ĐỌC)", () => {
    for (const t of ["apply_diff", "run_command", "get_today_stats", "lot_status"]) {
      expect(TOOL_MANG_NGU_CANH.has(t)).toBe(false);
    }
  });
});

describe("moiVongDeuTuChoi — CẦU CHÌ CỨNG (G2): mệnh lệnh prompt chỉ đạt 3/10, cơ chế phải đạt 10/10", () => {
  it("★★★ mọi vòng đều có note từ chối ⇒ true (không gọi model, trả lời từ chối trung thực)", () => {
    expect(moiVongDeuTuChoi(["BUDGET_EXCEEDED", "BUDGET_EXCEEDED", "BUDGET_EXCEEDED"])).toBe(true);
    expect(moiVongDeuTuChoi(["DENIED_SECRET"])).toBe(true);
    expect(moiVongDeuTuChoi(["NOT_FOUND", "BUDGET_EXCEEDED"])).toBe(true);
  });

  it("★★★ MỘT vòng đọc được ⇒ false — model VẪN chạy (chống vá quá tay)", () => {
    expect(moiVongDeuTuChoi([undefined, "BUDGET_EXCEEDED"])).toBe(false);
    expect(moiVongDeuTuChoi(["BUDGET_EXCEEDED", undefined, "BUDGET_EXCEEDED"])).toBe(false);
    expect(moiVongDeuTuChoi([null])).toBe(false);
  });

  it("không có vòng nào ⇒ false (không phải ca này)", () => {
    expect(moiVongDeuTuChoi([])).toBe(false);
  });

  it("note rỗng/khoảng trắng KHÔNG tính là từ chối", () => {
    expect(moiVongDeuTuChoi([""])).toBe(false);
    expect(moiVongDeuTuChoi(["   "])).toBe(false);
    expect(moiVongDeuTuChoi(["BUDGET_EXCEEDED", ""])).toBe(false);
  });

  it("★ vị từ KHÔNG phụ thuộc số vòng — đây chính là lỗ của cổng cũ (`soVongDaChay > 1 ⇒ false`)", () => {
    for (const n of [1, 2, 3, 7]) {
      expect(moiVongDeuTuChoi(Array(n).fill("BUDGET_EXCEEDED"))).toBe(true);
    }
  });
});

describe("cauChiNenNo — G11 (audit 2026-09-22 · dự án thật D3)", () => {
  it("★★★ CA THẬT: đơn sinh mã + NOT_FOUND ⇒ cầu chì KHÔNG nổ (model phải được gọi)", () => {
    expect(cauChiNenNo(["NOT_FOUND"], true)).toBe(false);
    expect(cauChiNenNo(["NOT_FOUND", "NO_MATCH"], true)).toBe(false);
  });

  it("★★★ HÀNH VI CŨ GIỮ NGUYÊN: câu hỏi VỀ repo + NOT_FOUND ⇒ vẫn nổ", () => {
    expect(cauChiNenNo(["NOT_FOUND"], false)).toBe(true);
  });

  it("★★★ LỖ G2 KHÔNG MỞ LẠI: 'không được/không thể đọc' ⇒ nổ kể cả khi sinh mã", () => {
    for (const n of ["DENIED_SECRET", "BUDGET_EXHAUSTED", "OUTSIDE_SANDBOX", "READ_ERROR"]) {
      expect(cauChiNenNo([n], true), n).toBe(true);
    }
  });

  it("★ MỘT vòng bị cấm lẫn trong các vòng NOT_FOUND ⇒ vẫn nổ (fail-closed)", () => {
    expect(cauChiNenNo(["NOT_FOUND", "DENIED_SECRET"], true)).toBe(true);
  });

  it("★ có vòng đọc ĐƯỢC ⇒ không nổ, bất kể loại câu", () => {
    for (const laSinhMa of [true, false]) {
      expect(cauChiNenNo(["NOT_FOUND", null], laSinhMa)).toBe(false);
      expect(cauChiNenNo([], laSinhMa)).toBe(false);
    }
  });

  it("★ so sánh KHÔNG phân biệt hoa thường / khoảng trắng thừa", () => {
    expect(cauChiNenNo([" not_found "], true)).toBe(false);
  });
});
