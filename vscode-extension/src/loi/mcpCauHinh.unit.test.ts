import { describe, it, expect } from "vitest";
import { docCauHinhMcpServers } from "./mcpCauHinh";

describe("docCauHinhMcpServers", () => {
  it("★★★ undefined/rỗng ⇒ danh sách rỗng, không lỗi", () => {
    expect(docCauHinhMcpServers(undefined)).toEqual({ danhSach: [], loi: [] });
    expect(docCauHinhMcpServers({})).toEqual({ danhSach: [], loi: [] });
  });

  it("★★★ hình dạng lạ (mảng, chuỗi, số) ⇒ rỗng + một lời khai, KHÔNG ném", () => {
    expect(() => docCauHinhMcpServers([1, 2])).not.toThrow();
    expect(docCauHinhMcpServers([1, 2]).danhSach).toEqual([]);
    expect(docCauHinhMcpServers("x").loi.length).toBeGreaterThan(0);
  });

  it("★★★ mục hợp lệ đầy đủ (command/args/cwd/env)", () => {
    const r = docCauHinhMcpServers({
      demo: { command: "npx", args: ["-y", "some-mcp"], cwd: "d:/x", env: { FOO: "bar" } },
    });
    expect(r.danhSach).toEqual([{ ten: "demo", lenh: "npx", doi: ["-y", "some-mcp"], thuMuc: "d:/x", moi: { FOO: "bar" } }]);
    expect(r.loi).toEqual([]);
  });

  it("★★ mục chỉ có command (args/cwd/env vắng) ⇒ vẫn hợp lệ, rơi về mặc định rỗng", () => {
    const r = docCauHinhMcpServers({ demo: { command: "node" } });
    expect(r.danhSach).toEqual([{ ten: "demo", lenh: "node", doi: [], thuMuc: undefined, moi: {} }]);
  });

  it("★★★ thiếu command ⇒ BỎ QUA mục đó, KHÔNG làm hỏng các mục khác", () => {
    const r = docCauHinhMcpServers({ hong: { args: ["x"] }, tot: { command: "node" } });
    expect(r.danhSach.map((c) => c.ten)).toEqual(["tot"]);
    expect(r.loi.length).toBe(1);
    expect(r.loi[0]).toContain("hong");
  });

  it("★★ command rỗng/chỉ khoảng trắng ⇒ bỏ qua", () => {
    expect(docCauHinhMcpServers({ x: { command: "" } }).danhSach).toEqual([]);
    expect(docCauHinhMcpServers({ x: { command: "   " } }).danhSach).toEqual([]);
  });

  it("★★ args sai kiểu (không phải mảng chuỗi) ⇒ bỏ qua mục", () => {
    expect(docCauHinhMcpServers({ x: { command: "node", args: "not-array" } }).danhSach).toEqual([]);
    expect(docCauHinhMcpServers({ x: { command: "node", args: [1, 2] } }).danhSach).toEqual([]);
  });

  it("★★ env sai kiểu (giá trị không phải chuỗi) ⇒ bỏ qua mục", () => {
    expect(docCauHinhMcpServers({ x: { command: "node", env: { A: 1 } } }).danhSach).toEqual([]);
  });

  it("★★ giá trị của một server không phải object (null/mảng/chuỗi) ⇒ bỏ qua mục đó", () => {
    const r = docCauHinhMcpServers({ a: null, b: [1], c: "x", d: { command: "node" } });
    expect(r.danhSach.map((c) => c.ten)).toEqual(["d"]);
    expect(r.loi.length).toBe(3);
  });

  it("★★ nhiều server hợp lệ cùng lúc", () => {
    const r = docCauHinhMcpServers({
      a: { command: "node", args: ["a.js"] },
      b: { command: "python", args: ["b.py"] },
    });
    expect(r.danhSach.map((c) => c.ten)).toEqual(["a", "b"]);
  });
});
