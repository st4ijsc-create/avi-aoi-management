import { describe, it, expect } from "vitest";
import { docYeuCauLenh, TEN_TOOL_LENH } from "./docYeuCauLenh";

function khoi(tool: string, args: Record<string, unknown>): string {
  return ["```avi-tool", JSON.stringify({ tool, args }), "```"].join("\n");
}

describe("docYeuCauLenh", () => {
  it("khối hợp lệ ⇒ đọc được command", () => {
    const vb = khoi(TEN_TOOL_LENH, { command: "git status" });
    expect(docYeuCauLenh(vb)).toEqual([{ command: "git status" }]);
  });

  it("thiếu command ⇒ bỏ qua", () => {
    expect(docYeuCauLenh(khoi(TEN_TOOL_LENH, {}))).toEqual([]);
  });

  it("command không phải chuỗi ⇒ bỏ qua", () => {
    expect(docYeuCauLenh(khoi(TEN_TOOL_LENH, { command: 123 }))).toEqual([]);
  });

  it("command rỗng/chỉ khoảng trắng ⇒ bỏ qua", () => {
    expect(docYeuCauLenh(khoi(TEN_TOOL_LENH, { command: "   " }))).toEqual([]);
  });

  it("tool khác (doc_tep) ⇒ không lẫn vào", () => {
    expect(docYeuCauLenh(khoi("doc_tep", { path: "x.ts" }))).toEqual([]);
  });

  it("văn bản không có khối nào ⇒ []", () => {
    expect(docYeuCauLenh("chỉ là câu trả lời bình thường")).toEqual([]);
  });

  it("nhiều khối chay_lenh ⇒ đọc HẾT (nơi gọi tự giới hạn chỉ chạy khối đầu nếu muốn)", () => {
    const vb = khoi(TEN_TOOL_LENH, { command: "git status" }) + "\n" + khoi(TEN_TOOL_LENH, { command: "git diff" });
    expect(docYeuCauLenh(vb)).toEqual([{ command: "git status" }, { command: "git diff" }]);
  });
});
