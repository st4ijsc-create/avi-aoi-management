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
const h = vi.hoisted(() => ({ banDau: "", soLanGoiLai: 0, soLanBienDich: 0, audit: [] as { redactedSnippet?: string | null }[], doDem: [] as Record<string, unknown>[], tranMs: [] as unknown[] }));
// ★ (2026-10-22) nối dây trần thời gian vòng theo khe: /v1 phải truyền `tranMs = tranMsVongSuaST(modelId)` cho MỌI lượt kiểm.
vi.mock("../services/ai/st/kiemBienDichSt", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../services/ai/st/kiemBienDichSt")>();
  return {
    ...goc,
    tranMsVongSuaST: () => 123_456,
    kiemVaSuaST: (y: Parameters<typeof goc.kiemVaSuaST>[0]) => (h.tranMs.push(y.tranMs), goc.kiemVaSuaST(y)),
  };
});
vi.mock("../services/aiGateway", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../services/aiGateway")>();
  return {
    ...goc,
    planInference: async (...a: Parameters<typeof goc.planInference>) => {
      const p = await goc.planInference(...a);
      return {
        ...p,
        record: (o: Record<string, unknown>) => { h.doDem.push({ ...o, chinh: true }); p.record(o as never); },
        recordPhu: (o: Record<string, unknown>) => { h.doDem.push(o); p.recordPhu?.(o as never); },
      };
    },
  };
});
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
  h.doDem = [];
  h.tranMs = [];
};
/** Hàng đo: chính + lượt phụ — CÙNG requestId. */
const kiemDoDem = (soPhu: number) => {
  const chinh = h.doDem.filter((d) => d.chinh);
  const phu = h.doDem.filter((d) => !d.chinh);
  expect(chinh).toHaveLength(1);
  expect(phu).toHaveLength(soPhu);
  for (const d of phu) {
    expect(d).toMatchObject({ luotPhu: "sua-bien-dich-st", outcome: "ok", tokensIn: 5, tokensOut: 5, requestId: chinh[0].requestId });
    expect(String(d.requestId)).toMatch(/^chatcmpl-/);
  }
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
    kiemDoDem(1); // lượt sửa = một hàng đo phụ, cùng requestId
    expect(h.tranMs).toEqual([123_456]); // trần vòng theo khe được truyền (không phải mặc định 90 s ngầm)
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
    kiemDoDem(0);
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
    expect(h.tranMs).toEqual([123_456]);
    kiemDoDem(1);
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

describe("★ (2026-10-22, dieu-phoi) MẶC ĐỊNH khi AI_KIEM_BIEN_DICH_ST KHÔNG đặt = v1-stream: stream BẬT · non-stream TẮT trừ opt-in", () => {
  const voiEnvTrong = async <T,>(f: () => Promise<T>) => {
    const cu = process.env.AI_KIEM_BIEN_DICH_ST;
    delete process.env.AI_KIEM_BIEN_DICH_ST;
    try {
      return await f();
    } finally {
      process.env.AI_KIEM_BIEN_DICH_ST = cu;
    }
  };
  const goiThuong = (them: Record<string, unknown> = {}) =>
    fetch(`${sv.url}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "code.plc", messages: [{ role: "user", content: "Viết FB" }], ...them }),
    });

  it("non-stream KHÔNG opt-in ⇒ không kiểm (không header, nội dung nguyên vẹn) — khách trần 300 s không bị đẩy quá hạn", async () => {
    await voiEnvTrong(async () => {
      datLai(`\`\`\`st\n${FB_SAI}\n\`\`\``);
      const res = await goiThuong();
      expect(res.headers.get("x-st4i-bien-dich")).toBeNull();
      expect((await res.json()).choices[0].message.content).toBe(h.banDau);
      expect(h.soLanBienDich).toBe(0);
    });
  });

  it("non-stream opt-in `st4i_kiem_bien_dich:true` ⇒ kiểm + sửa như khi bật", async () => {
    await voiEnvTrong(async () => {
      datLai(`\`\`\`st\n${FB_SAI}\n\`\`\``);
      const res = await goiThuong({ st4i_kiem_bien_dich: true });
      expect(res.headers.get("x-st4i-bien-dich")).toContain("trang-thai=da-sua");
      expect(h.soLanGoiLai).toBe(1);
    });
  });

  it("STREAM (không tham số gì) ⇒ BẬT: phần bổ sung tới TRƯỚC finish_reason (SDK openai thật)", async () => {
    await voiEnvTrong(async () => {
      datLai(`Mã:\n\`\`\`st\n${FB_SAI}\n\`\`\``);
      const s = await khach().chat.completions.create({ model: "code.plc", stream: true, messages: [{ role: "user", content: "Viết FB" }] });
      let chu = "";
      for await (const c of s) chu += c.choices[0]?.delta?.content ?? "";
      expect(chu).toContain("Đã tự sửa 1 lỗi biên dịch");
      expect(h.soLanGoiLai).toBe(1);
    });
  });

  it("stream mà khách tắt (`st4i_kiem_bien_dich:false`) ⇒ không kiểm", async () => {
    await voiEnvTrong(async () => {
      datLai(`\`\`\`st\n${FB_SAI}\n\`\`\``);
      const s = await khach().chat.completions.create({ model: "code.plc", stream: true, messages: [{ role: "user", content: "x" }], st4i_kiem_bien_dich: false } as never);
      for await (const _ of s) void _;
      expect(h.soLanBienDich).toBe(0);
    });
  });

  it("env đặt rõ `off` ⇒ tắt cả opt-in non-stream lẫn stream", async () => {
    const cu = process.env.AI_KIEM_BIEN_DICH_ST;
    process.env.AI_KIEM_BIEN_DICH_ST = "off";
    try {
      datLai(`\`\`\`st\n${FB_SAI}\n\`\`\``);
      const res = await goiThuong({ st4i_kiem_bien_dich: true });
      expect(res.headers.get("x-st4i-bien-dich")).toBeNull();
      expect(h.soLanBienDich).toBe(0);
    } finally {
      process.env.AI_KIEM_BIEN_DICH_ST = cu;
    }
  });
});
