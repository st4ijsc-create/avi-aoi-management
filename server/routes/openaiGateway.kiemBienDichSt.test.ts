/**
 * ★★ Đợt 9 — /v1 + VÒNG KIỂM BIÊN DỊCH ST (cờ AI_KIEM_BIEN_DICH_ST=v1, vai trò code.plc).
 * Engine GIẢ (không nạp model), trình biên dịch GIẢ (mã có "AND ;" ⇒ lỗi). Nhánh stream đọc bằng SDK `openai` THẬT để chứng
 * minh phần BỔ SUNG tới được client chuẩn (phát TRƯỚC chunk finish_reason — dieu-phoi 2026-10-21).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import OpenAI from "openai";

const FB_SAI = "FUNCTION_BLOCK A\nVAR_INPUT x : BOOL; END_VAR\nVAR_OUTPUT y : BOOL; END_VAR\n  y := x AND ;\nEND_FUNCTION_BLOCK";
const FB_DUNG = "FUNCTION_BLOCK A\nVAR_INPUT x : BOOL; END_VAR\nVAR_OUTPUT y : BOOL; END_VAR\n  y := x;\nEND_FUNCTION_BLOCK";
const h = vi.hoisted(() => ({ banDau: "", soLanGoiLai: 0, soLanBienDich: 0, audit: [] as { redactedSnippet?: string | null }[] }));
vi.mock("../services/ai/aiLlmAudit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/ai/aiLlmAudit")>()),
  recordLlmAudit: vi.fn((e: { redactedSnippet?: string | null }) => void h.audit.push(e)),
}));

vi.mock("../services/aiGgufEngine", () => ({
  isGgufAvailable: vi.fn(async () => true),
  chatCompletion: vi.fn(async (opts: { messages: { role: string; content: string }[] }) => {
    const sua = opts.messages.some((m) => m.role === "user" && m.content.includes("Trình biên dịch IEC 61131-3"));
    if (sua) h.soLanGoiLai++;
    const text = sua ? `Đã sửa:\n\`\`\`st\n${FB_DUNG}\n\`\`\`` : h.banDau;
    return { text, tokensPrompt: 5, tokensGenerated: 5, modelId: "gia", totalTimeMs: 1, tokensPerSecond: 1, finishReason: "stop" };
  }),
  chatCompletionStream: async function* () {
    for (const phan of h.banDau.match(/[\s\S]{1,20}/g) ?? []) yield { type: "token", token: phan };
    yield { type: "done", fullText: h.banDau, tokensPrompt: 5, tokensGenerated: 5, finishReason: "stop" };
  },
  generateText: vi.fn(),
  generateFim: vi.fn(),
  generateEmbedding: vi.fn(),
  generateEmbeddings: vi.fn(async (t: string[]) => ({ embeddings: t.map(() => [0, 1]), dimensions: 2, modelId: "embed" })),
  generateTextStream: async function* () {},
}));
vi.mock("../services/flow/lib/bienDichST", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../services/flow/lib/bienDichST")>();
  return {
    ...goc,
    bienDichST: vi.fn(async (ma: string) => {
      h.soLanBienDich++;
      return ma.includes("AND ;")
        ? { ok: false, chanDoan: [{ tep: "ma.st", dong: 4, cot: 13, mucDo: "error", ma: "E007", thongDiep: "Unexpected token ;" }], ms: 3 }
        : { ok: true, chanDoan: [], ms: 3 };
    }),
  };
});

import { registerOpenAiGateway } from "./openaiGateway";

const API_KEY = "SECRET-TEST-KEY-ST";
let sv: { url: string; server: Server };
const ENV = ["OPENAI_GATEWAY_ENABLED", "OPENAI_GATEWAY_API_KEY", "AI_KIEM_BIEN_DICH_ST"] as const;
const cu: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of ENV) cu[k] = process.env[k];
  process.env.OPENAI_GATEWAY_ENABLED = "true";
  process.env.OPENAI_GATEWAY_API_KEY = API_KEY;
  process.env.AI_KIEM_BIEN_DICH_ST = "v1";
  const app = express();
  registerOpenAiGateway(app);
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  sv = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
});
afterAll(async () => {
  await new Promise<void>((r) => sv.server.close(() => r()));
  for (const k of ENV) {
    if (cu[k] === undefined) delete process.env[k];
    else process.env[k] = cu[k];
  }
});

const datLai = (banDau: string) => {
  h.banDau = banDau;
  h.soLanGoiLai = 0;
  h.soLanBienDich = 0;
  h.audit = [];
};
const snippetKiem = () => h.audit.map((e) => e.redactedSnippet).filter((x): x is string => typeof x === "string" && x.startsWith("kiem-bien-dich-st"));
const khach = () => new OpenAI({ apiKey: API_KEY, baseURL: `${sv.url}/v1` });

describe("/v1 code.plc + kiểm biên dịch ST — không stream", () => {
  it("bản đầu lỗi ⇒ trả bản ĐÃ SỬA + dòng ghi chú + header x-st4i-bien-dich", async () => {
    datLai(`Mã:\n\`\`\`st\n${FB_SAI}\n\`\`\``);
    const res = await fetch(`${sv.url}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "code.plc", messages: [{ role: "user", content: "Viết FB" }] }),
    });
    const j = await res.json();
    expect(res.headers.get("x-st4i-bien-dich")).toContain("trang-thai=da-sua");
    expect(j.choices[0].message.content).not.toContain("AND ;");
    expect(j.choices[0].message.content).toContain("Đã tự sửa 1 lỗi biên dịch");
    expect(h.soLanGoiLai).toBe(1);
    // audit: MỘT bản ghi mang số liệu vòng (không mã nguồn)
    expect(snippetKiem()).toHaveLength(1);
    expect(snippetKiem()[0]).toMatch(/^kiem-bien-dich-st ok=1 trang-thai=da-sua vong=1 sua=1 con=0 ms=\d+$/);
    expect(snippetKiem()[0]).not.toContain("FUNCTION_BLOCK");
  });

  it("câu trả lời CHỮ THUẦN (không mã ST) ⇒ không biên dịch, không nhãn, header ok=skip", async () => {
    datLai("TON là bộ định thời trễ bật: Q lên khi IN giữ đủ PT.");
    const res = await fetch(`${sv.url}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "code.plc", messages: [{ role: "user", content: "TON là gì" }] }),
    });
    const j = await res.json();
    expect(res.headers.get("x-st4i-bien-dich")).toBe("ok=skip");
    expect(j.choices[0].message.content).toBe(h.banDau);
    expect(h.soLanBienDich).toBe(0);
    expect(snippetKiem()).toEqual([]); // bỏ qua ⇒ cột NULL như mọi lượt
  });

  it("khối nhãn python trông giống ST ⇒ KHÔNG biên dịch như ST", async () => {
    datLai(`\`\`\`python\n${FB_SAI}\n\`\`\``);
    const res = await fetch(`${sv.url}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "code.plc", messages: [{ role: "user", content: "x" }] }),
    });
    expect(res.headers.get("x-st4i-bien-dich")).toBe("ok=skip");
    expect(h.soLanBienDich).toBe(0);
  });

  it("cờ AI_KIEM_BIEN_DICH_ST TẮT (mặc định) ⇒ không kiểm, nội dung nguyên vẹn", async () => {
    datLai(`\`\`\`st\n${FB_SAI}\n\`\`\``);
    process.env.AI_KIEM_BIEN_DICH_ST = "off";
    try {
      const res = await fetch(`${sv.url}/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "code.plc", messages: [{ role: "user", content: "x" }] }),
      });
      expect(res.headers.get("x-st4i-bien-dich")).toBeNull();
      expect((await res.json()).choices[0].message.content).toBe(h.banDau);
      expect(h.soLanBienDich).toBe(0);
    } finally {
      process.env.AI_KIEM_BIEN_DICH_ST = "v1";
    }
  });

  it("vai trò KHÁC code.plc hoặc client tắt ⇒ không kiểm (không header)", async () => {
    datLai(`\`\`\`st\n${FB_SAI}\n\`\`\``);
    for (const body of [{ model: "chat" }, { model: "code.plc", st4i_kiem_bien_dich: false }]) {
      const res = await fetch(`${sv.url}/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, messages: [{ role: "user", content: "x" }] }),
      });
      expect(res.headers.get("x-st4i-bien-dich")).toBeNull();
    }
    expect(h.soLanBienDich).toBe(0);
  });
});

describe("/v1 code.plc + kiểm biên dịch ST — STREAM qua SDK openai THẬT", () => {
  it("bản đầu nguyên vẹn, rồi phần BỔ SUNG (bản đã sửa) tới client TRƯỚC finish_reason", async () => {
    datLai(`Mã:\n\`\`\`st\n${FB_SAI}\n\`\`\``);
    const s = await khach().chat.completions.create({ model: "code.plc", stream: true, messages: [{ role: "user", content: "Viết FB" }] });
    let chu = "";
    let finish: string | null = null;
    let chuSauFinish = "";
    for await (const c of s) {
      const d = c.choices[0]?.delta?.content ?? "";
      if (finish) chuSauFinish += d;
      else chu += d;
      if (c.choices[0]?.finish_reason) finish = c.choices[0].finish_reason;
    }
    expect(chu.startsWith(h.banDau)).toBe(true); // bản đầu ra NGUYÊN VẸN trước
    expect(chu).toContain("Đã tự sửa 1 lỗi biên dịch");
    expect(chu.slice(h.banDau.length)).toContain(FB_DUNG);
    expect(finish).toBe("stop");
    expect(chuSauFinish).toBe(""); // không gì sau finish_reason
    expect(snippetKiem()).toHaveLength(1);
    expect(snippetKiem()[0]).toMatch(/trang-thai=da-sua vong=1 sua=1 con=0/);
  });

  it("stream chữ thuần ⇒ không phần bổ sung, không biên dịch", async () => {
    datLai("Giải thích ngắn về TON.");
    const s = await khach().chat.completions.create({ model: "code.plc", stream: true, messages: [{ role: "user", content: "TON" }] });
    let chu = "";
    for await (const c of s) chu += c.choices[0]?.delta?.content ?? "";
    expect(chu).toBe(h.banDau);
    expect(h.soLanBienDich).toBe(0);
  });
});
