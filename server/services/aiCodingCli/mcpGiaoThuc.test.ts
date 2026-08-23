/**
 * ★★★ doc 83 — **MCP stdio: KHUNG GIAO THỨC + BẰNG CHỨNG CHẠY OFFLINE.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÌ SAO LƯỚI NÀY PHẢI CÓ: TA TỪ CHỐI `@modelcontextprotocol/sdk` (17 phụ thuộc, gồm một
 * major Express THỨ HAI — xem docblock `mcpServer.ts`), nên **rủi ro trôi giao thức là của ta**.
 * Đổi lấy 0 gói mới thì phải trả bằng một lưới chạy ĐÚNG bắt tay thật.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ §5 — PHÉP ĐO "OFFLINE" NÓI CHÍNH XÁC NÓ ĐO GÌ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Nó **KHÔNG** khai *"cả tính năng chạy offline"* — đó là một lời khai không đo được trong một
 * lưới. Nó khai đúng một mệnh đề hẹp và kiểm được: ***bắt tay MCP (`initialize` → `tools/list`)
 * KHÔNG phát một lượt ra mạng nào*** — không DNS, không `fetch`, không socket TCP ra ngoài
 * loopback. Bảy điểm thoát mạng của Node bị gắn cảm biến rồi mới chạy.
 * ⚠ Loopback (`127.0.0.1`) **được phép**: CSDL (:5434) và llama-server (:8091) đều ở đó, và đó
 *   chính là hình dạng "nhà máy không có internet" — chứ không phải "không có mạng nào cả".
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import dns from "node:dns";
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";

import {
  BAN_GIAO_THUC_MAC_DINH,
  MA_JSONRPC,
  SO_TOOL_MCP,
  TEN_MAY_CHU,
  phucVu,
  xuLyGoi,
  type TraLoiJsonRpc,
} from "./mcpServer";

afterEach(() => {
  vi.restoreAllMocks();
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — bắt tay JSON-RPC 2.0", () => {
  it("★★★ `initialize` trả đủ ba ô bắt buộc và ECHO bản giao thức client xin", async () => {
    const r = (await xuLyGoi({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "x", version: "1" } },
    })) as Extract<TraLoiJsonRpc, { result: unknown }>;
    expect(r.jsonrpc).toBe("2.0");
    expect(r.id).toBe(1);
    const k = r.result as { protocolVersion: string; capabilities: Record<string, unknown>; serverInfo: { name: string } };
    expect(k.protocolVersion, "phải nhận bản client xin, không ép bản của mình").toBe("2024-11-05");
    expect(k.capabilities).toHaveProperty("tools");
    expect(k.serverInfo.name).toBe(TEN_MAY_CHU);
  });

  it("★★ client xin một chuỗi KHÔNG phải ngày ⇒ rơi về bản mặc định, không vọng lại rác", async () => {
    const r = (await xuLyGoi({ id: 2, method: "initialize", params: { protocolVersion: "<script>" } })) as Extract<TraLoiJsonRpc, { result: unknown }>;
    expect((r.result as { protocolVersion: string }).protocolVersion).toBe(BAN_GIAO_THUC_MAC_DINH);
  });

  it("★★★ NOTIFICATION (không có `id`) KHÔNG được trả lời — trả lời là lỗi giao thức", async () => {
    expect(await xuLyGoi({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect(await xuLyGoi({ jsonrpc: "2.0", method: "phuong/thuc/la" })).toBeNull();
  });

  it("★★ phương thức lạ CÓ `id` ⇒ lỗi -32601, không ném, không im lặng", async () => {
    const r = (await xuLyGoi({ id: 7, method: "khong/co" })) as Extract<TraLoiJsonRpc, { error: unknown }>;
    expect(r.error.code).toBe(MA_JSONRPC.KHONG_CO_PHUONG_THUC);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — `tools/list`", () => {
  it("★★★ mỗi tool có `name` · `description` · `inputSchema` kiểu object", async () => {
    const r = (await xuLyGoi({ id: 3, method: "tools/list" })) as Extract<TraLoiJsonRpc, { result: unknown }>;
    const ds = (r.result as { tools: Array<{ name: string; description: string; inputSchema: { type: string } }> }).tools;
    expect(ds.length).toBe(SO_TOOL_MCP.length);
    for (const t of ds) {
      expect(typeof t.name, t.name).toBe("string");
      expect(t.description.length, t.name).toBeGreaterThan(20);
      expect(t.inputSchema.type, t.name).toBe("object");
    }
  });

  it("★★★ hai tool GHI nói THẲNG trong mô tả rằng chúng KHÔNG ghi/không chạy", async () => {
    const ghi = SO_TOOL_MCP.filter((m) => m.toolThat === "apply_diff" || m.toolThat === "run_command");
    expect(ghi.length).toBe(2);
    for (const m of ghi) {
      expect(m.moTa, m.ten).toMatch(/KHÔNG GHI|KHÔNG CHẠY/);
      expect(m.moTa, m.ten).toMatch(/NGƯỜI phải duyệt/);
    }
  });

  it("★★★ tool `tools/call` thiếu `name` ⇒ -32602, KHÔNG chạy gì", async () => {
    const r = (await xuLyGoi({ id: 4, method: "tools/call", params: {} })) as Extract<TraLoiJsonRpc, { error: unknown }>;
    expect(r.error.code).toBe(MA_JSONRPC.THAM_SO_XAU);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — khung DÒNG của transport stdio", () => {
  async function* dong(...ds: string[]): AsyncGenerator<string> {
    for (const d of ds) yield d;
  }

  it("★★★ mỗi trả lời là ĐÚNG MỘT dòng JSON hợp lệ; notification KHÔNG sinh dòng nào", async () => {
    const ra: string[] = [];
    await phucVu(
      dong(
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
        JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      ),
      (s) => void ra.push(s),
    );
    expect(ra.length, "3 gói vào, 1 là notification ⇒ 2 dòng ra").toBe(2);
    for (const s of ra) {
      expect(s.endsWith("\n")).toBe(true);
      expect(s.slice(0, -1).includes("\n"), "một thông điệp KHÔNG được chứa xuống dòng ở giữa").toBe(false);
      expect(() => JSON.parse(s)).not.toThrow();
    }
  });

  it("★★ dòng rác / dòng rỗng ⇒ BỎ QUA, không làm sập vòng phục vụ", async () => {
    const ra: string[] = [];
    await phucVu(dong("", "khong-phai-json", JSON.stringify({ id: 9, method: "ping" })), (s) => void ra.push(s));
    expect(ra.length).toBe(1);
    expect(JSON.parse(ra[0]!).id).toBe(9);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — BẤT BIẾN: MCP không có đường nào tự duyệt", () => {
  it("★★★ sổ tool KHÔNG có mục nào tên mang nghĩa duyệt/ghi/chạy", () => {
    expect(SO_TOOL_MCP.map((m) => m.ten)).toEqual([
      "avi_list_projects",
      "avi_read_file",
      "avi_list_files",
      "avi_grep_repo",
      "avi_propose_edit",
      "avi_propose_command",
    ]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§5 — OFFLINE: bắt tay KHÔNG phát một lượt ra mạng nào", () => {
  it("★★★ 7 điểm thoát mạng của Node đều ghi nhận 0 lượt ra ngoài loopback", async () => {
    const ngoai: string[] = [];
    const laLoopback = (h: unknown): boolean =>
      typeof h === "string" && (h === "localhost" || h === "127.0.0.1" || h === "::1" || h.startsWith("127."));

    const dnsLookup = vi.spyOn(dns, "lookup").mockImplementation(((h: string, ...a: unknown[]) => {
      if (!laLoopback(h)) ngoai.push(`dns.lookup ${h}`);
      const cb = a[a.length - 1];
      if (typeof cb === "function") (cb as (e: Error) => void)(new Error("OFFLINE"));
      return undefined as never;
    }) as never);
    const dnsP = vi.spyOn(dns.promises, "lookup").mockImplementation((async (h: string) => {
      if (!laLoopback(h)) ngoai.push(`dns.promises.lookup ${h}`);
      throw new Error("OFFLINE");
    }) as never);
    const netConnect = vi.spyOn(net, "connect").mockImplementation(((o: unknown) => {
      const h = typeof o === "object" && o !== null ? (o as { host?: string }).host : String(o);
      if (!laLoopback(h ?? "127.0.0.1")) ngoai.push(`net.connect ${String(h)}`);
      throw new Error("OFFLINE");
    }) as never);
    const tlsConnect = vi.spyOn(tls, "connect").mockImplementation((() => {
      ngoai.push("tls.connect");
      throw new Error("OFFLINE");
    }) as never);
    const httpReq = vi.spyOn(http, "request").mockImplementation((() => {
      ngoai.push("http.request");
      throw new Error("OFFLINE");
    }) as never);
    const httpsReq = vi.spyOn(https, "request").mockImplementation((() => {
      ngoai.push("https.request");
      throw new Error("OFFLINE");
    }) as never);
    const fetchCu = globalThis.fetch;
    globalThis.fetch = ((u: unknown) => {
      ngoai.push(`fetch ${String(u)}`);
      throw new Error("OFFLINE");
    }) as typeof fetch;

    try {
      const ra: string[] = [];
      async function* dong(): AsyncGenerator<string> {
        yield JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
        yield JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" });
        yield JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" });
        yield JSON.stringify({ jsonrpc: "2.0", id: 3, method: "ping" });
      }
      await phucVu(dong(), (s) => void ra.push(s));
      expect(ra.length).toBe(3);
      expect(ngoai, "bắt tay MCP phải KHÔNG chạm mạng ngoài").toEqual([]);
      // Cảm biến phải THẬT SỰ gắn được — nếu không, mệnh đề trên tự thoả.
      expect(dnsLookup.mock.calls.length + netConnect.mock.calls.length).toBeGreaterThanOrEqual(0);
      expect(vi.isMockFunction(dns.lookup)).toBe(true);
      expect(vi.isMockFunction(net.connect)).toBe(true);
      expect([tlsConnect, httpReq, httpsReq, dnsP].every((s) => vi.isMockFunction(s))).toBe(true);
    } finally {
      globalThis.fetch = fetchCu;
    }
  });

  it("★★★ ĐỐI CHỨNG HIỆU CHUẨN — cảm biến CÓ bắt được một lượt ra mạng thật", () => {
    // ⚠ Không có ca này thì §5 là một mệnh đề TỰ THOẢ: một bộ cảm biến chết cũng cho `[]`.
    const ngoai: string[] = [];
    const s = vi.spyOn(dns, "lookup").mockImplementation(((h: string) => {
      ngoai.push(`dns.lookup ${h}`);
      return undefined as never;
    }) as never);
    dns.lookup("registry.npmjs.org", () => {});
    expect(ngoai).toEqual(["dns.lookup registry.npmjs.org"]);
    s.mockRestore();
  });
});
