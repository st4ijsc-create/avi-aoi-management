/**
 * ★ Đợt 10.3 Task 10 (B4) — rào chống nhầm: node Luồng không nhắm tới máy chủ AI ngoài (danh sách tĩnh + aggregator + Bedrock +
 * env + host/IP ĐỘNG của khoá tương thích / host nội bộ đã khai). Lúc LƯU (URL viết thẳng) và lúc CHẠY (URL từ biểu thức), MCP lúc
 * NẠP danh sách và lúc GỌI. Không mạng thật (DNS giả, fetch giả).
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { chanHostAiNgoai, hostChanThemEnv, laHostAiNgoai, __datNguonHostDongChoTest } from "./hostAiNgoai";
import { datPhanGiaiDns } from "../../flow/nut/mangAnToan";
import { kiemThamSoNutMoi } from "../../flow/kiemThamSoNut";
import { mayChuMcpChoPhep } from "../../flow/nut/mcpKhach";
import { layNut, type NguCanhChay } from "../../flow/dangKyNut";
import "../../flow/nut/index";
import { datFetchLuong } from "../../flow/nut/tichHop";

const dns: Record<string, string> = {};
datPhanGiaiDns(async (h) => [{ address: dns[h] ?? "93.184.216.34", family: 4 }]);
afterEach(() => {
  __datNguonHostDongChoTest(null);
  for (const k of Object.keys(dns)) delete dns[k];
  delete process.env.AI_NGOAI_HOST_CHAN_THEM;
});
afterAll(() => datPhanGiaiDns(null));

const ma = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { ma?: string }).ma ?? String(e);
  }
};

describe("laHostAiNgoai — danh sách tĩnh", () => {
  it.each([
    ["api.anthropic.com", true],
    ["API.OPENAI.COM.", true],
    ["foo.openai.azure.com", true],
    ["bedrock-runtime.us-east-1.amazonaws.com", true],
    ["bedrock-agent-runtime-fips.eu-west-3.amazonaws.com", true],
    ["openrouter.ai", true],
    ["generativelanguage.googleapis.com", true],
    ["api.groq.com", true],
    ["example.com", false],
    ["notopenai.com", false],
    ["openai.com.evil.example", false],
    ["s3.us-east-1.amazonaws.com", false],
  ])("%s ⇒ %s", (h, mong) => expect(laHostAiNgoai(h, [])).toBe(mong));

  it("env AI_NGOAI_HOST_CHAN_THEM (phẩy, chuẩn hoá) mở rộng danh sách", () => {
    expect(hostChanThemEnv({ AI_NGOAI_HOST_CHAN_THEM: " LLM.Proxy.vn. , ,ai.noi-bo.vn" })).toEqual(["llm.proxy.vn", "ai.noi-bo.vn"]);
    expect(laHostAiNgoai("x.llm.proxy.vn", ["llm.proxy.vn"])).toBe(true);
  });
});

describe("chanHostAiNgoai — lúc gọi", () => {
  it("host tĩnh ⇒ DICH_LA_AI_NGOAI; host thường ⇒ qua", async () => {
    __datNguonHostDongChoTest(async () => []);
    expect(await ma(chanHostAiNgoai(new URL("https://api.anthropic.com/v1/messages")))).toBe("DICH_LA_AI_NGOAI");
    expect(await ma(chanHostAiNgoai(new URL("https://example.com/api"), { ip: "93.184.216.34", family: 4 }))).toBeNull();
  });

  it("host tương thích ĐÃ KHAI (llm.nha-may.vn ⇒ 203.0.113.7): chặn theo TÊN và theo IP đã ghim (tên khác cùng IP)", async () => {
    dns["llm.nha-may.vn"] = "203.0.113.7";
    __datNguonHostDongChoTest(async () => ["llm.nha-may.vn"]);
    expect(await ma(chanHostAiNgoai(new URL("https://LLM.nha-may.vn/v1")))).toBe("DICH_LA_AI_NGOAI");
    expect(await ma(chanHostAiNgoai(new URL("https://khac.vn/v1"), { ip: "203.0.113.7", family: 4 }))).toBe("DICH_LA_AI_NGOAI");
    expect(await ma(chanHostAiNgoai(new URL("https://khac.vn/v1"), { ip: "203.0.113.8", family: 4 }))).toBeNull();
  });

  it("env bổ sung có hiệu lực lúc gọi", async () => {
    __datNguonHostDongChoTest(async () => []);
    process.env.AI_NGOAI_HOST_CHAN_THEM = "llm.proxy.vn";
    expect(await ma(chanHostAiNgoai(new URL("https://a.llm.proxy.vn/v1")))).toBe("DICH_LA_AI_NGOAI");
  });
});

describe("lúc LƯU — node http có URL viết thẳng tới máy chủ AI", () => {
  const def = (type: string, url: string) => ({ nodes: [{ id: "h", type, parameters: { url } }] });
  it("http-gui / http-doc URL tĩnh tới AI ⇒ lỗi DICH_LA_AI_NGOAI; biểu thức ⇒ để lúc chạy; host thường ⇒ không lỗi", () => {
    expect(kiemThamSoNutMoi(def("tich-hop.http-gui", "https://api.openai.com/v1/chat/completions")).join()).toContain("DICH_LA_AI_NGOAI");
    expect(kiemThamSoNutMoi(def("tich-hop.http-doc", "https://openrouter.ai/api/v1/models")).join()).toContain("DICH_LA_AI_NGOAI");
    expect(kiemThamSoNutMoi(def("tich-hop.http-gui", "{{ $json.url }}")).join()).not.toContain("DICH_LA_AI_NGOAI");
    expect(kiemThamSoNutMoi(def("tich-hop.http-gui", "https://example.com/hook")).join()).not.toContain("DICH_LA_AI_NGOAI");
  });
});

describe("MCP — lúc NẠP danh sách trắng", () => {
  it("máy chủ MCP khai tới host AI ⇒ bị bỏ khỏi danh sách (node không gọi được); máy chủ thường ⇒ giữ", () => {
    const ds = mayChuMcpChoPhep({
      AI_FLOW_MCP_CHO_PHEP: JSON.stringify({ ai: { url: "https://api.anthropic.com/mcp", tools: ["t"] }, thuong: { url: "https://mcp.example.com/mcp", tools: ["t"] } }),
    });
    expect([...ds.keys()]).toEqual(["thuong"]);
  });
});

describe("lúc CHẠY — node http (URL từ biểu thức) và MCP (lúc gọi), host đã nằm trong danh sách trắng của luồng", () => {
  const ngu = (main: { json: Record<string, unknown> }[]): NguCanhChay =>
    ({ runId: "r", flowId: "f", nodeId: "n", lan: 1, idempotencyKey: "r:n:1", inputs: { main }, nodes: {}, env: {}, run: { id: "r", flowId: "f", batDau: "x" } }) as never;
  it("http-doc: URL biểu thức ⇒ host tĩnh AI / tên khác cùng IP của host tương thích ⇒ DICH_LA_AI_NGOAI, KHÔNG gửi; host thường ⇒ gửi", async () => {
    const gui: string[] = [];
    const cu = datFetchLuong((async (u: URL) => (gui.push(String(u)), new Response("{}", { status: 200, headers: { "content-type": "application/json" } }))) as never);
    datPhanGiaiDns(async (h) => [{ address: dns[h] ?? "93.184.216.34", family: 4 }]);
    const cuEnv = process.env.AI_FLOW_HTTP_HOST_CHO_PHEP;
    process.env.AI_FLOW_HTTP_HOST_CHO_PHEP = "api.openai.com,khac.vn,example.com";
    dns["llm.nha-may.vn"] = "8.8.4.4";
    dns["khac.vn"] = "8.8.4.4";
    __datNguonHostDongChoTest(async () => ["llm.nha-may.vn"]);
    try {
      const chay = (u: string) => layNut("tich-hop.http-doc")!.chay({ url: "{{ $json.u }}" }, ngu([{ json: { u } }]));
      expect(await ma(chay("https://api.openai.com/v1/models"))).toBe("DICH_LA_AI_NGOAI");
      expect(await ma(chay("https://khac.vn/v1/chat/completions"))).toBe("DICH_LA_AI_NGOAI");
      expect(gui).toEqual([]);
      await chay("https://example.com/x");
      expect(gui).toEqual(["https://example.com/x"]);
    } finally {
      datFetchLuong(cu);
      if (cuEnv === undefined) delete process.env.AI_FLOW_HTTP_HOST_CHO_PHEP;
      else process.env.AI_FLOW_HTTP_HOST_CHO_PHEP = cuEnv;
    }
  });

  it("mcp-goi: máy chủ MCP khai tên thường nhưng phân giải ra IP của host AI tương thích ⇒ DICH_LA_AI_NGOAI lúc gọi, KHÔNG gửi", async () => {
    const gui: string[] = [];
    const cu = datFetchLuong((async (u: URL) => (gui.push(String(u)), new Response("{}", { status: 200 }))) as never);
    datPhanGiaiDns(async (h) => [{ address: dns[h] ?? "93.184.216.34", family: 4 }]);
    const cuEnv = process.env.AI_FLOW_MCP_CHO_PHEP;
    process.env.AI_FLOW_MCP_CHO_PHEP = JSON.stringify({ vong: { url: "https://mcp.khac.vn/mcp", tools: ["t"] } });
    dns["llm.nha-may.vn"] = "8.8.4.4";
    dns["mcp.khac.vn"] = "8.8.4.4";
    __datNguonHostDongChoTest(async () => ["llm.nha-may.vn"]);
    try {
      expect(await ma(layNut("tich-hop.mcp-goi")!.chay({ server: "vong", tool: "t", thamSo: {} }, ngu([{ json: {} }])))).toBe("DICH_LA_AI_NGOAI");
      expect(gui).toEqual([]);
    } finally {
      datFetchLuong(cu);
      if (cuEnv === undefined) delete process.env.AI_FLOW_MCP_CHO_PHEP;
      else process.env.AI_FLOW_MCP_CHO_PHEP = cuEnv;
    }
  });
});
