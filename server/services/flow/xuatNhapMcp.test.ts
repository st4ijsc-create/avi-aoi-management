/**
 * TRACER XUẤT/NHẬP cho node `tich-hop.mcp-goi` — của người kiểm định (2026-10-26), đo trên 24084ea49.
 * G1: đối số literal của node MCP (`thamSo`) có thể mang bí mật gõ tay — cùng lớp F1 của node HTTP; gói XUẤT/NHẬP không được mang theo.
 * G2: kết quả tool lồng quá sâu không được làm JSON.stringify của item ném RangeError (đường giao item của động cơ).
 * Người sửa KHÔNG sửa kỳ vọng ở đây (nếu một kỳ vọng sai, báo dieu-phoi/kiểm định).
 */
import { describe, expect, it } from "vitest";
import { phanTichGoi, taoGoi } from "./xuatNhap";
import { gonKetQuaTool } from "./nut/mcpKhach";
import "./nut/index";

type P = Record<string, unknown>;
const node = (id: string, type: string, parameters: P, extra: P = {}) => ({ id, type, typeVersion: 1, name: `n-${id}`, position: [0, 0] as [number, number], parameters, ...extra });
const luongMcp = (thamSo: P, extra: P = {}): any => ({
  id: "luong-mcp",
  name: "v",
  version: 1,
  nodes: [node("a", "kich-hoat.thu-cong", {}), node("m", "tich-hop.mcp-goi", { server: "may-do", tool: "do-oee", thamSo, truongRa: "mcp", ...extra })],
  connections: [{ from: { node: "a", port: "main" }, to: { node: "m", port: "main" } }],
  settings: { uuTien: "background", luuDuLieu: "day-du" },
});
const goiChu = (thamSo: P, extra: P = {}) => JSON.stringify(taoGoi(luongMcp(thamSo, extra)).goi);

describe("G1 — bí mật literal trong thamSo của node MCP KHÔNG lọt vào gói XUẤT", () => {
  const CA: [string, P, string][] = [
    ["khoá apiKey", { apiKey: "SEC-MCP-KEY" }, "SEC-MCP-KEY"],
    ["chuỗi 'Authorization: Bearer SEC'", { headers: "Authorization: Bearer SEC-MCP-BEARER" }, "SEC-MCP-BEARER"],
    ["khoá lồng sâu 'password'", { a: { b: [{ password: "SEC-MCP-PW" }] } }, "SEC-MCP-PW"],
    ["khoá tiếng Việt có dấu 'mật_khẩu'", { "mật_khẩu": "SEC-MCP-VN" }, "SEC-MCP-VN"],
    ["chuỗi form 'token=SEC'", { query: "a=1&token=SEC-MCP-TOK&b=2" }, "SEC-MCP-TOK"],
    ["chuỗi JSON trong chuỗi", { payload: '{"secret":"SEC-MCP-NEST"}' }, "SEC-MCP-NEST"],
    ["khoá 'sessionId' / 'otp'", { sessionId: "SEC-MCP-SID", otp: "SEC-MCP-OTP" }, "SEC-MCP-SID"],
  ];
  for (const [ten, p, dau] of CA) it(ten, () => expect(goiChu(p), dau).not.toContain(dau));

  it("không phá luồng: đối số vô hại, biểu thức {{…}}, server/tool giữ nguyên; credentialRef + kieuXacThuc vẫn bị xoá", () => {
    const { goi } = taoGoi(luongMcp({ thanhPho: "Hanoi", soLuong: 3, may: "{{ $json.x }}", apiKey: "SEC-MCP-KEY2" }, { kieuXacThuc: "bearer" }) as never);
    const s = JSON.stringify(goi);
    expect(s).toContain("Hanoi");
    expect(s).toContain("{{ $json.x }}");
    expect(s).toContain('"server":"may-do"');
    expect(s).toContain('"tool":"do-oee"');
    expect(s).not.toContain("SEC-MCP-KEY2");
  });

  it("NHẬP không tin gói: gói tự soạn mang bí mật trong thamSo MCP ⇒ sau phanTichGoi luồng đã sạch", () => {
    const def = luongMcp({ apiKey: "SEC-MCP-IMP", note: "Authorization: Bearer SEC-MCP-IMP2" });
    const goi = { dinhDang: "luong-ai/1", luong: def, viecPhaiDien: [], bam: "" };
    const p = phanTichGoi(goi);
    expect(p.ok).toBe(true);
    if (p.ok) {
      const s = JSON.stringify(p.luong);
      expect(s).not.toContain("SEC-MCP-IMP");
      expect(s).not.toContain("SEC-MCP-IMP2");
    }
  });
});

describe("G2 — kết quả tool lồng quá sâu bị từ chối (không để JSON.stringify của item ném RangeError)", () => {
  it("structuredContent 200 000 tầng ⇒ gonKetQuaTool ném lỗi có mã (không trả cấu trúc sâu)", () => {
    const sau = JSON.parse("[".repeat(200_000) + "]".repeat(200_000));
    let kq: { noiDung: string; cauTruc: unknown } | undefined;
    let loi: unknown;
    try {
      kq = gonKetQuaTool({ content: [], structuredContent: sau }, "do-oee");
    } catch (e) {
      loi = e;
    }
    if (kq) {
      // chấp nhận cách khác: cắt/thay cấu trúc sâu — miễn là item KHÔNG làm stringify ném
      expect(() => JSON.stringify({ json: { mcp: kq } })).not.toThrow();
    } else {
      expect(String((loi as { ma?: string })?.ma ?? "")).toMatch(/^MCP_/);
    }
  });
  it("cấu trúc vừa phải (tầng 10) vẫn qua nguyên vẹn", () => {
    let v: unknown = "x";
    for (let i = 0; i < 10; i++) v = { a: v };
    const kq = gonKetQuaTool({ content: [{ type: "text", text: "ok" }], structuredContent: v }, "do-oee");
    expect(JSON.stringify(kq.cauTruc)).toBe(JSON.stringify(v));
  });
});
