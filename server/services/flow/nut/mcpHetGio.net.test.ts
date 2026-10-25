/**
 * MCP client (`tich-hop.mcp-goi`) — hạn giờ và độ sâu trên MẠNG THẬT (node:http trên 127.0.0.1, fetchGhim thật; noiBo:true là cửa duy nhất tới 127.0.0.1) — của người kiểm định (2026-10-26).
 * Đối chứng cho các ca mock của mcpKhach.test: hết giờ khi đang ĐỌC THÂN phải ra MCP_HET_GIO (không phải 'aborted'); hạn TỔNG cắt cả lượt-node và rút ngắn lời gọi cuối; kết quả lồng sâu ⇒ MCP_PHAN_HOI_SAI.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { layNut, type NguCanhChay } from "../dangKyNut";
import "../nut";
import { SAU_TOI_DA_MCP } from "./mcpKhach";

vi.setConfig({ testTimeout: 90_000 });
type Item = { json: Record<string, unknown> };
const ngu = (main: Item[]): NguCanhChay => ({ runId: "r", flowId: "f", nodeId: "n", lan: 1, idempotencyKey: "r:n:1", inputs: { main }, nodes: {}, env: {}, run: { id: "r", flowId: "f", batDau: "x" } });
const chay = (n = 1) => layNut("tich-hop.mcp-goi")!.chay({ server: "loc", tool: "echo", thamSo: {}, truongRa: "mcp" }, ngu(Array.from({ length: n }, (_, i) => ({ json: { i } })))) as Promise<{ main: Item[] }>;

let srv: http.Server;
let port = 0;
let modo = "ok";
let soTool = 0;
beforeAll(async () => {
  srv = http.createServer((q, r) => {
    let b = "";
    q.on("data", (c) => (b += c));
    q.on("end", () => {
      let m: { method?: string } = {};
      try {
        m = JSON.parse(b);
      } catch {
        /* bỏ */
      }
      if (m.method === "initialize") {
        r.writeHead(200, { "content-type": "application/json" });
        r.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
        return;
      }
      if (m.method === "notifications/initialized") {
        r.writeHead(202);
        r.end();
        return;
      }
      soTool++;
      if (modo === "drip") {
        r.writeHead(200, { "content-type": "application/json" });
        const t = setInterval(() => r.write(" "), 100);
        r.on("close", () => clearInterval(t));
        return;
      }
      if (modo === "cham") {
        setTimeout(() => {
          r.writeHead(200, { "content-type": "application/json" });
          r.end(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: "ok" }] } }));
        }, 1200);
        return;
      }
      if (modo === "sau") {
        const d = 200_000;
        r.writeHead(200, { "content-type": "application/json" });
        r.end('{"jsonrpc":"2.0","id":2,"result":{"content":[],"structuredContent":' + "[".repeat(d) + "]".repeat(d) + "}}");
        return;
      }
      if (modo === "sau-vua") {
        let v: unknown = "x";
        for (let i = 0; i < SAU_TOI_DA_MCP - 3; i++) v = { a: v };
        r.writeHead(200, { "content-type": "application/json" });
        r.end(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: [], structuredContent: v } }));
        return;
      }
      r.writeHead(200, { "content-type": "application/json" });
      r.end(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: "ok" }] } }));
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  port = (srv.address() as AddressInfo).port;
});
afterAll(() => {
  srv.close();
});
const dat = () => {
  process.env.AI_FLOW_MCP_CHO_PHEP = JSON.stringify({ loc: { url: `http://127.0.0.1:${port}/mcp`, tools: ["echo"], noiBo: true } });
};
afterEach(() => {
  delete process.env.AI_FLOW_MCP_CHO_PHEP;
  delete process.env.AI_FLOW_MCP_TONG_MS;
  modo = "ok";
  soTool = 0;
});

describe("hạn giờ trên mạng thật", () => {
  it("★ thả giọt (1 byte/100 ms) khi đang ĐỌC THÂN ⇒ MCP_HET_GIO (không phải lỗi 'aborted' chung), sau ≈ 30 s", async () => {
    dat();
    modo = "drip";
    const t = Date.now();
    await expect(chay()).rejects.toMatchObject({ ma: "MCP_HET_GIO" });
    const ms = Date.now() - t;
    expect(ms).toBeGreaterThan(25_000);
    expect(ms).toBeLessThan(40_000);
  }, 90_000);

  it("★ hạn TỔNG rút ngắn lời gọi: tổng 3 s + thả giọt ⇒ MCP_HET_GIO_TONG sau ≈ 3 s (G4: hạn tổng là yếu tố cắt) (không phải 30 s)", async () => {
    dat();
    process.env.AI_FLOW_MCP_TONG_MS = "3000";
    modo = "drip";
    const t = Date.now();
    await expect(chay()).rejects.toMatchObject({ ma: "MCP_HET_GIO_TONG" });
    const ms = Date.now() - t;
    expect(ms).toBeLessThan(8_000);
  });

  it("★ hạn TỔNG cắt cả lượt-node: mỗi lời gọi 1,2 s, tổng 2,5 s, 6 item ⇒ MCP_HET_GIO_TONG hoặc MCP_HET_GIO, KHÔNG gọi hết 6 tool", async () => {
    dat();
    process.env.AI_FLOW_MCP_TONG_MS = "2500";
    modo = "cham";
    const t = Date.now();
    // lời gọi thứ ba bắt đầu khi còn ~0,1 s hạn tổng ⇒ bị cắt giữa chừng: mã MCP_HET_GIO (hạn từng lời gọi đã rút theo hạn tổng); nếu hạn tổng hết đúng LÚC chuyển item thì MCP_HET_GIO_TONG — cả hai đều đúng
    await expect(chay(6)).rejects.toSatisfy((e: { ma?: string }) => e.ma === "MCP_HET_GIO_TONG" || e.ma === "MCP_HET_GIO");
    expect(Date.now() - t).toBeLessThan(8_000);
    expect(soTool).toBeGreaterThanOrEqual(1);
    expect(soTool).toBeLessThanOrEqual(3);
  });

  it("đối chứng: tổng đủ lớn ⇒ cả 3 item chạy xong, gọi đúng 3 tool", async () => {
    dat();
    process.env.AI_FLOW_MCP_TONG_MS = "30000";
    modo = "cham";
    const r = await chay(3);
    expect(r.main).toHaveLength(3);
    expect(soTool).toBe(3);
  });
});

describe("độ sâu kết quả trên mạng thật", () => {
  it(`kết quả lồng 200 000 tầng ⇒ MCP_PHAN_HOI_SAI (trần ${SAU_TOI_DA_MCP}); item không bao giờ mang cấu trúc sâu`, async () => {
    dat();
    modo = "sau";
    await expect(chay()).rejects.toMatchObject({ ma: "MCP_PHAN_HOI_SAI" });
  });
  it(`kết quả lồng ${SAU_TOI_DA_MCP - 3} tầng (dưới trần) ⇒ qua`, async () => {
    dat();
    modo = "sau-vua";
    const r = await chay();
    expect(JSON.stringify(r)).toContain('"a"');
  });
});
