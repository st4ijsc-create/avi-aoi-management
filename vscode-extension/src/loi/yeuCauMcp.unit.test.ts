import { describe, it, expect } from "vitest";
import { docYeuCauMcpNgoai, TEN_TOOL_MCP } from "./yeuCauMcp";

function khoi(obj: unknown): string {
  return ["```avi-tool", JSON.stringify(obj), "```"].join("\n");
}

describe("docYeuCauMcpNgoai", () => {
  it("★★★ khối hợp lệ đầy đủ (server + tool + dauVao)", () => {
    const vb = khoi({ tool: TEN_TOOL_MCP, args: { server: "demo", tool: "get_weather", dauVao: { city: "Hà Nội" } } });
    expect(docYeuCauMcpNgoai(vb)).toEqual([{ server: "demo", tool: "get_weather", dauVao: { city: "Hà Nội" } }]);
  });

  it("★★ dauVao vắng mặt ⇒ object rỗng, KHÔNG bị loại", () => {
    const vb = khoi({ tool: TEN_TOOL_MCP, args: { server: "demo", tool: "ping" } });
    expect(docYeuCauMcpNgoai(vb)).toEqual([{ server: "demo", tool: "ping", dauVao: {} }]);
  });

  it("★★★ tool khác (doc_tep/liet_ke/grep/de_xuat_sua) KHÔNG lọt vào đây", () => {
    for (const tool of ["doc_tep", "liet_ke", "grep", "de_xuat_sua", "de_xuat_sua_doan"]) {
      const vb = khoi({ tool, args: { server: "x", tool: "y" } });
      expect(docYeuCauMcpNgoai(vb), tool).toEqual([]);
    }
  });

  it("★★ thiếu server hoặc tool ⇒ BỎ QUA, không đoán", () => {
    expect(docYeuCauMcpNgoai(khoi({ tool: TEN_TOOL_MCP, args: { tool: "y" } }))).toEqual([]);
    expect(docYeuCauMcpNgoai(khoi({ tool: TEN_TOOL_MCP, args: { server: "x" } }))).toEqual([]);
    expect(docYeuCauMcpNgoai(khoi({ tool: TEN_TOOL_MCP, args: { server: "", tool: "y" } }))).toEqual([]);
  });

  it("★★ dauVao sai kiểu (mảng/chuỗi/số) ⇒ bỏ qua khối", () => {
    expect(docYeuCauMcpNgoai(khoi({ tool: TEN_TOOL_MCP, args: { server: "x", tool: "y", dauVao: [1, 2] } }))).toEqual([]);
    expect(docYeuCauMcpNgoai(khoi({ tool: TEN_TOOL_MCP, args: { server: "x", tool: "y", dauVao: "z" } }))).toEqual([]);
  });

  it("★★ JSON hỏng ⇒ bỏ qua, không ném", () => {
    const vb = "```avi-tool\nkhong-phai-json\n```";
    expect(() => docYeuCauMcpNgoai(vb)).not.toThrow();
    expect(docYeuCauMcpNgoai(vb)).toEqual([]);
  });

  it("★★ nhiều khối trong một văn bản, chỉ giữ mcp_goi", () => {
    const vb = [khoi({ tool: "doc_tep", args: { path: "a.ts" } }), khoi({ tool: TEN_TOOL_MCP, args: { server: "s", tool: "t" } })].join("\n\n");
    expect(docYeuCauMcpNgoai(vb)).toEqual([{ server: "s", tool: "t", dauVao: {} }]);
  });

  it("★★ văn bản không có khối nào ⇒ rỗng", () => {
    expect(docYeuCauMcpNgoai("chỉ là văn xuôi thường")).toEqual([]);
  });
});
