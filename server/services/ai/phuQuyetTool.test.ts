/** ★ B6 — lưới cho vị từ tín hiệu yếu + phép kết hợp phủ quyết. Luật đắt nhất: model CHỈ được nói KHÔNG. */
import { describe, it, expect } from "vitest";
import { ketHopPhuQuyet, tinHieuYeu } from "./phuQuyetTool";

describe("tinHieuYeu", () => {
  it("★★ câu mệnh lệnh rõ ⇒ MẠNH (null) — không hỏi model, giữ tất định", () => {
    for (const q of [
      "Đọc server/routers.ts và tóm tắt nó",
      "Chạy npm run check",
      "dotnet test sandbox-projects/csharp-demo",
      "Chạy dotnet test và cho tôi biết lỗi",
      "Run python -m pytest tests/ and read the errors",
      "Tìm nơi gọi executeDecision trong repo",
      "Liệt kê các tệp trong server/services/ai",
      "git status",
    ]) {
      expect(tinHieuYeu(q), q).toBeNull();
    }
  });
  it("dấu hỏi cuối câu ⇒ dau-hoi", () => {
    expect(tinHieuYeu("hàm getVramState được dùng ở đâu?")).toBe("dau-hoi");
    expect(tinHieuYeu("what files are in client/src/hooks？")).toBe("dau-hoi");
  });
  it("từ hỏi / giải thích / so sánh ⇒ tu-hoi", () => {
    expect(tinHieuYeu("Giải thích npm run check làm gì trong dự án này")).toBe("tu-hoi");
    expect(tinHieuYeu("Explain the difference between git merge and git rebase")).toBe("tu-hoi");
  });
  it("★★ VIẾT/TẠO MỚI ⇒ viet-moi; nhưng 'viết thêm … vào tệp' / sửa / refactor ⇒ MẠNH", () => {
    expect(tinHieuYeu("Viết một tệp routers.ts mới cho service báo cáo")).toBe("viet-moi");
    expect(tinHieuYeu("Write a Go HTTP server that lists files in a directory")).toBe("viet-moi");
    expect(tinHieuYeu("viết thêm hàm Multiply vào sandbox-projects/csharp-demo/src/Calculator.cs")).toBeNull();
    expect(tinHieuYeu("sửa sandbox-projects/csharp-demo/src/Calculator.cs để Divide ném lỗi")).toBeNull();
    expect(tinHieuYeu("refactor hàm Add trong Calculator.cs sang expression-bodied")).toBeNull();
  });
  it("rỗng ⇒ null", () => {
    expect(tinHieuYeu("")).toBeNull();
    expect(tinHieuYeu("   ")).toBeNull();
  });
});

describe("ketHopPhuQuyet — model chỉ được nói KHÔNG", () => {
  const h = { tool: "run_command", args: { command: "npm run check" }, reason: "CODING_RUN_SHORTCUT" };
  it("★★★ tín hiệu mạnh ⇒ giữ heuristic, bất kể model nói gì", () => {
    expect(ketHopPhuQuyet(h, null, null)).toBe(h);
    expect(ketHopPhuQuyet(h, "read_file", null)).toBe(h);
  });
  it("★★★ yếu + model XÁC NHẬN cùng tool ⇒ giữ heuristic (cả tham số)", () => {
    expect(ketHopPhuQuyet(h, "run_command", "tu-hoi")).toBe(h);
  });
  it("★★★ yếu + model nói KHÔNG tool ⇒ không gọi tool", () => {
    const r = ketHopPhuQuyet(h, null, "tu-hoi");
    expect(r.tool).toBeNull();
    expect(r.args).toEqual({});
    expect(r.reason).toMatch(/^CODING_VETO_NATIVE:tu-hoi:run_command→none$/);
  });
  it("★★ yếu + model chọn tool KHÁC ⇒ vẫn KHÔNG gọi tool (model không được đổi tool)", () => {
    const r = ketHopPhuQuyet(h, "read_file", "tu-hoi");
    expect(r.tool).toBeNull();
    expect(r.reason).toContain("run_command→read_file");
  });
  it("★★ model vắng/lỗi (undefined) ⇒ giữ heuristic — lớp phủ quyết hỏng không phá đường cũ", () => {
    expect(ketHopPhuQuyet(h, undefined, "tu-hoi")).toBe(h);
  });
  it("heuristic không chọn tool ⇒ model không thêm được tool", () => {
    const k = { tool: null, args: {}, reason: "CODING_NO_MATCH" };
    expect(ketHopPhuQuyet(k, "read_file", "tu-hoi")).toBe(k);
  });
});
