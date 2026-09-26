/**
 * Lưới cho `mcpStdoutSach` — STDOUT của MCP phải thuần JSON-RPC.
 * Bắt hai đột biến: (M1) `laCheDoMcp` dùng `.includes` thay vì vị trí subcommand SỐ 0;
 * (M2) chuyển hướng nhắm nhầm sang stdout thay vì stderr.
 */
import { describe, expect, it, vi } from "vitest";
import { chuyenLogRaStderr, laCheDoMcp } from "./mcpStdoutSach";

describe("laCheDoMcp — chỉ true khi subcommand vị trí 0 là 'mcp'", () => {
  it("đúng khi argv[2]==='mcp'", () => {
    expect(laCheDoMcp(["node", "batDau.ts", "mcp"])).toBe(true);
  });
  it("sai ở chế độ CLI", () => {
    expect(laCheDoMcp(["node", "batDau.ts", "--du-an", "repo"])).toBe(false);
    expect(laCheDoMcp(["node", "batDau.ts"])).toBe(false);
  });
  it("KHÔNG bật nhầm khi 'mcp' xuất hiện ở vị trí khác (tên/đối số dự án)", () => {
    // M1: `.includes('mcp')` sẽ SAI ở đây — 'mcp' là giá trị của --du-an, không phải subcommand.
    expect(laCheDoMcp(["node", "batDau.ts", "--du-an", "mcp"])).toBe(false);
  });
});

describe("chuyenLogRaStderr — console.log/info/debug → stderr, KHÔNG ra stdout", () => {
  it("nuốt log khỏi stdout, đẩy sang stderr, và khôi phục được", () => {
    const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const khoiPhuc = chuyenLogRaStderr();
    console.log("XIN_CHAO_MCP_LOG");
    console.info("XIN_CHAO_MCP_INFO");
    console.debug("XIN_CHAO_MCP_DEBUG");
    khoiPhuc();

    const raStderr = errSpy.mock.calls.map((c) => String(c[0])).join("");
    const raStdout = outSpy.mock.calls.map((c) => String(c[0])).join("");
    outSpy.mockRestore();
    errSpy.mockRestore();

    // M2: nếu chuyển hướng nhắm nhầm stdout, ba dòng này rơi vào raStdout ⇒ ĐỎ.
    for (const s of ["XIN_CHAO_MCP_LOG", "XIN_CHAO_MCP_INFO", "XIN_CHAO_MCP_DEBUG"]) {
      expect(raStderr).toContain(s);
      expect(raStdout).not.toContain(s);
    }
  });

  it("sau khôi phục, console.log trở lại ĐÚNG tham chiếu ban đầu", () => {
    // ⚠ Kiểm bằng ĐỊNH DANH hàm, KHÔNG bắt output: dưới vitest `console.log` bị bọc nên bản gốc
    //   không ghi thẳng `process.stdout.write` — bắt output ở đây là phép đo mù đúng thứ nó đo.
    const truoc = console.log;
    const khoiPhuc = chuyenLogRaStderr();
    expect(console.log).not.toBe(truoc); // đã chuyển hướng
    khoiPhuc();
    expect(console.log).toBe(truoc); // đã khôi phục đúng bản gốc
  });
});
