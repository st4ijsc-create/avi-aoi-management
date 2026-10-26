import { promises as fs } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { taoMayChuHttp, xuLyGoi, type CauHinhMcpCucBo } from "./mayChu";

const TOKEN = "t".repeat(32);
let tam: string;
let may: http.Server;
let cong: number;
const nhatKy: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  tam = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-may-chu-"));
  await fs.writeFile(path.join(tam, "a.txt"), "noi dung");
  const cfg: CauHinhMcpCucBo = { cong: 0, token: TOKEN, goc: [{ ten: "chung", duongDan: tam, chiDoc: false }], ghiNhatKy: (d) => nhatKy.push(d) };
  may = taoMayChuHttp(cfg);
  await new Promise<void>((r) => may.listen(0, "127.0.0.1", () => r()));
  cong = (may.address() as AddressInfo).port;
});
afterAll(async () => {
  await new Promise<void>((r) => may.close(() => r()));
  await fs.rm(tam, { recursive: true, force: true });
});

function post(than: unknown, tieuDe: Record<string, string> = {}): Promise<{ ma: number; json: unknown }> {
  return new Promise((ok, loi) => {
    const s = typeof than === "string" ? than : JSON.stringify(than);
    const req = http.request({ host: "127.0.0.1", port: cong, path: "/mcp", method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}`, ...tieuDe } }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => ok({ ma: res.statusCode ?? 0, json: b ? JSON.parse(b) : null }));
    });
    req.on("error", loi);
    req.end(s);
  });
}

describe("giao thức (đúng chuỗi mà node tich-hop.mcp-goi gửi)", () => {
  it("initialize → notifications/initialized (202) → tools/list → tools/call", async () => {
    const i = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "x", version: "1" } } });
    expect(i.ma).toBe(200);
    expect((i.json as { result: { protocolVersion: string } }).result.protocolVersion).toBe("2025-03-26");
    expect((await post({ jsonrpc: "2.0", method: "notifications/initialized" })).ma).toBe(202);
    const l = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const ten = (l.json as { result: { tools: Array<{ name: string }> } }).result.tools.map((t) => t.name);
    expect(ten).toEqual(["tep_liet_ke", "tep_doc", "tep_tim", "tep_ghi"]); // không DB ⇒ không có tool DB
    const c = await post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "tep_doc", arguments: { duongDan: "a.txt" } } });
    const r = (c.json as { result: { isError: boolean; structuredContent: { noiDung: string } } }).result;
    expect(r.isError).toBe(false);
    expect(r.structuredContent.noiDung).toBe("noi dung");
    expect(nhatKy.at(-1)).toMatchObject({ tool: "tep_doc", goc: "chung", ok: true });
  });
  it("lỗi tool ⇒ isError + mã, không ném ra JSON-RPC error", async () => {
    const c = await post({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "tep_doc", arguments: { duongDan: "../x" } } });
    const r = (c.json as { result: { isError: boolean; content: Array<{ text: string }> } }).result;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/^\[DUONG_DAN_CAM\]/);
  });
  it("phương thức lạ ⇒ -32601; batch ⇒ 400 -32600", async () => {
    expect(((await post({ jsonrpc: "2.0", id: 5, method: "resources/list" })).json as { error: { code: number } }).error.code).toBe(-32601);
    const b = await post([{ jsonrpc: "2.0", id: 6, method: "ping" }]);
    expect(b.ma).toBe(400);
  });
});

describe("hàng rào HTTP", () => {
  it("thiếu / sai token ⇒ 401", async () => {
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { Authorization: "" })).ma).toBe(401);
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { Authorization: `Bearer ${"x".repeat(32)}` })).ma).toBe(401);
  });
  it("có Origin (trình duyệt) ⇒ 403; Host lạ (DNS-rebinding) ⇒ 403", async () => {
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { Origin: "http://evil.example" })).ma).toBe(403);
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { Host: `evil.example:${cong}` })).ma).toBe(403);
  });
  it("content-type sai ⇒ 415; thân > 1 MiB ⇒ 413", async () => {
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { "Content-Type": "text/plain" })).ma).toBe(415);
    expect((await post("x".repeat(1024 * 1024 + 10))).ma).toBe(413);
  });
});

describe("xuLyGoi không DB", () => {
  it("db_truy_van khi chưa cấu hình ⇒ isError DB_TAT", async () => {
    const r = await xuLyGoi({ cong: 0, goc: [] }, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "db_truy_van", arguments: { sql: "SELECT 1" } } });
    expect((r?.result as { content: Array<{ text: string }> }).content[0].text).toMatch(/^\[DB_TAT\]/);
  });
});
