/**
 * ★ Đợt 10.3 (rà kiem-dinh mục 13) — `/v1/chat/completions` với `model: "ngoai:…"` đi qua CÙNG cổng `goiAiNgoai`: nhà máy = nhà máy của
 * CHỦ token; key chung / người nhiều nhà máy / model chưa bật ⇒ 404; tools ⇒ 400; lỗi cổng ⇒ mã, không chi tiết.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

const h = vi.hoisted(() => ({ nhaMay: { 501: [7], 502: [7, 8] } as Record<number, number[] | null>, goi: [] as unknown[], loi: null as unknown }));

vi.mock("../services/aiGgufEngine", () => ({
  isGgufAvailable: vi.fn(async () => true),
  chatCompletion: vi.fn(async () => ({ text: "LOCAL", tokensPrompt: 1, tokensGenerated: 1 })),
  chatCompletionStream: async function* () {},
  generateText: vi.fn(),
  generateFim: vi.fn(),
  generateEmbeddings: vi.fn(),
  generateTextStream: async function* () {},
}));
vi.mock("../db/reportAggregators", async (goc) => ({
  ...(await goc<typeof import("../db/reportAggregators")>()),
  resolveTenantFactoryScope: vi.fn(async (a: { userId?: number }) => ({ factoryIds: h.nhaMay[a.userId ?? 0] ?? null, labels: {} })),
}));
vi.mock("../services/ai/chonModel/danhMuc", async (goc) => {
  const that = await goc<typeof import("../services/ai/chonModel/danhMuc")>();
  return {
    ...that,
    layPhuThuocDanhMucMacDinh: async () => ({
      anh: { taiLuc: 1, vaiTro: new Map(), profile: new Map(), gan: [] },
      hoSoCoDo: new Set<string>(),
      kheDangGiu: null,
      uocTinhDoiKheGiay: async () => null,
      ngoai: { layModelDaBat: async (f: number | null) => (f === 7 ? [{ nhaCungCap: "anthropic", model: "claude-thu", nhan: "C" }] : []) },
    }),
  };
});
vi.mock("../services/ai/ngoai/congNgoai", async (goc) => ({
  ...(await goc<typeof import("../services/ai/ngoai/congNgoai")>()),
  goiAiNgoai: vi.fn(async (yc: unknown) => {
    h.goi.push(yc);
    if (h.loi) throw h.loi;
    return { noiDung: "TU NGOAI", toolCalls: [], khongTinCay: true, tokenVao: 5, tokenRa: 6 };
  }),
}));

import { createOpenAiGatewayRouter } from "./openaiGateway";
import { LoiNgoai } from "../services/ai/ngoai/loi";
import type { KetQuaXacThucToken } from "../db/aiGatewayTokens";

const T1 = "avgw_" + "A".repeat(43);
const T2 = "avgw_" + "B".repeat(43);
const BANG: Record<string, KetQuaXacThucToken> = {
  [T1]: { ok: true, tokenId: 1, userId: 501, role: "engineer", name: "A", phamVi: ["chat"], ten: "t1" },
  [T2]: { ok: true, tokenId: 2, userId: 502, role: "engineer", name: "B", phamVi: ["chat"], ten: "t2" },
};
const KEY_CHUNG = "KEY-CHUNG-NGOAI";
let sv: { url: string; server: Server };

beforeAll(async () => {
  process.env.OPENAI_GATEWAY_ENABLED = "true";
  const app = express();
  app.use(
    "/v1",
    createOpenAiGatewayRouter({ apiKey: KEY_CHUNG, xacThucToken: async (t: string) => BANG[t] ?? { ok: false, ma: "khong-hop-le" }, coQuyenAi: async () => true, ghiDung: vi.fn() }),
  );
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  sv = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
});
afterAll(async () => {
  await new Promise<void>((r) => sv.server.close(() => r()));
});
beforeEach(() => {
  h.goi = [];
  h.loi = null;
});

const chat = (token: string, body: Record<string, unknown> = {}) =>
  fetch(`${sv.url}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "ngoai:anthropic:claude-thu", messages: [{ role: "user", content: "hi" }], ...body }),
  });

describe("/v1 model ngoài", () => {
  it("token người dùng MỘT nhà máy (bật) ⇒ qua cổng goiAiNgoai với nhà máy của chủ token; phản hồi kiểu OpenAI", async () => {
    const r = await chat(T1);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.choices[0].message.content).toBe("TU NGOAI");
    expect(j.model).toBe("ngoai:anthropic:claude-thu");
    expect(h.goi).toHaveLength(1);
    expect(h.goi[0]).toMatchObject({ dich: { nhaCungCap: "anthropic", model: "claude-thu" }, ngu: { userId: 501, nhaMayNguoiGoi: [7], nhaMayChuDuLieu: [], nguonMuc: { loai: "be-mat", beMat: "v1" } } });
  });

  it("key chung / người nhiều nhà máy / model khớp regex mà chưa bật ⇒ 404 model_not_found, cổng không được gọi", async () => {
    for (const [t, body] of [[KEY_CHUNG, {}], [T2, {}], [T1, { model: "ngoai:anthropic:claude-khac" }]] as const) {
      const r = await chat(t, body);
      expect(r.status, t).toBe(404);
      expect((await r.json()).error.code).toBe("model_not_found");
    }
    expect(h.goi).toHaveLength(0);
  });

  it("rà Task 8 B — lượt mang kết quả tool (role tool / function / assistant.tool_calls) ⇒ phanDaGhep van-hanh + chủ dữ liệu = nhà máy chủ token; lời thường ⇒ []", async () => {
    const lots = [
      [{ role: "user", content: "hi" }, { role: "tool", tool_call_id: "x", content: "nhiệt độ lò 231" }],
      [{ role: "user", content: "hi" }, { role: "function", name: "f", content: "OEE 81" }],
      [{ role: "user", content: "hi" }, { role: "assistant", content: null, tool_calls: [{ id: "x", type: "function", function: { name: "f", arguments: "{}" } }] }],
    ];
    for (const messages of lots) expect((await chat(T1, { messages })).status).toBe(200);
    expect(h.goi).toHaveLength(3);
    for (const g of h.goi) expect(g).toMatchObject({ ngu: { nhaMayChuDuLieu: [7], nguonMuc: { loai: "be-mat", beMat: "v1", phanDaGhep: ["van-hanh"] } } });
    h.goi = [];
    await chat(T1, { messages: [{ role: "system", content: "s" }, { role: "assistant", content: "a" }, { role: "user", content: "u" }] });
    expect(h.goi[0]).toMatchObject({ ngu: { nhaMayChuDuLieu: [], nguonMuc: { phanDaGhep: [] } } });
  });

  it("rà Task 8 F — max_tokens rác / âm / 0 / 1e12 / chuỗi ⇒ kẹp ở biên trong [1, 32000]", async () => {
    for (const [v, mong] of [["abc", 1024], [-5, 1024], [0, 1024], [1e12, 32_000], ["4000", 1024], [77.9, 77]] as const) {
      h.goi = [];
      expect((await chat(T1, { max_tokens: v })).status).toBe(200);
      expect((h.goi[0] as { maxTokens: number }).maxTokens, String(v)).toBe(mong);
    }
  });

  it("tools ⇒ 400; stream ⇒ một mảnh + [DONE]; lỗi cổng ⇒ mã (không chi tiết)", async () => {
    expect((await chat(T1, { tools: [{ type: "function", function: { name: "x", parameters: {} } }] })).status).toBe(400);
    const s = await (await chat(T1, { stream: true })).text();
    expect(s).toContain("TU NGOAI");
    expect(s.trim().endsWith("data: [DONE]")).toBe(true);
    h.loi = new LoiNgoai("NGOAI_DU_LIEU_VAN_HANH", "chi tiet noi bo");
    const r = await chat(T1);
    expect(r.status).toBe(403);
    const j = JSON.stringify(await r.json());
    expect(j).toContain("NGOAI_DU_LIEU_VAN_HANH");
    expect(j).not.toContain("chi tiet noi bo");
  });
});
