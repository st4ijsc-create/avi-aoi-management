/**
 * ★★★ Đợt 4 (bộ đo cổng `vscode-e2e`, V-dot4-1/2) — `/v1/chat/completions` HỎI LẠI ĐÚNG MỘT LẦN với nghĩ TẮT khi lượt
 * sinh hỏng vì model trả lời vào KÊNH SUY LUẬN (content rỗng), và chỉ khi yêu cầu có `tools` (lượt agent).
 *
 * Hai lớp lỗi đo được trong `tmp/srv-dot4.err.log` (máy chủ :3010 của lượt đo):
 *   • `TOOL_CALL_TRONG_SUY_LUAN` — model phát `<tool_call>` trong suy luận chưa đóng `</think>` (≈40 lần; extension cũ
 *     đã tự hỏi lại ⇒ không lượt nào chết vì nó);
 *   • G5-D ca (B) — model viết NGUYÊN câu trả lời cuối ("Tất cả 5 tests đều xanh. ## Tóm tắt …") vào suy luận chưa đóng,
 *     content rỗng ⇒ "token cạn kiệt vào suy luận" ⇒ extension KHÔNG nhận ra ⇒ lõi thử lại y hệt ⇒ hỏng lần hai ⇒
 *     `loi-model` (5/6 lượt chết của V-dot4-1/2).
 * Chính sách giữ nguyên: chữ suy luận KHÔNG BAO GIỜ thành hành động hay chữ hiển thị — chỉ HỎI LẠI.
 * Lỗi lần hai ⇒ khung lỗi `/v1` có `code` (`tool_call_in_reasoning` | `reasoning_without_content`), không 500 trơn.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

type HanhVi = "loi-dau" | "loi-g5d" | "loi-khac" | "ok-tool" | "chu-roi-loi-dau";
const h = vi.hoisted(() => ({ kichBan: [] as string[], opts: [] as any[] }));

const LOI_DAU =
  "[aiGgufEngine] TỪ CHỐI TRUNG THỰC (G1-D, streaming chat completion): llama-server còn SỐNG (vừa qua thăm dò) nhưng lượt sinh chữ hỏng: " +
  "[llamaServer] TOOL_CALL_TRONG_SUY_LUAN: model phát <tool_call> TRONG chuỗi suy luận (chưa đóng </think>) và content rỗng — không thực thi chữ suy luận; hỏi lại lượt này với nghĩ TẮT.";
const LOI_G5D =
  "[aiGgufEngine] TỪ CHỐI TRUNG THỰC (G1-D, streaming chat completion): llama-server còn SỐNG (vừa qua thăm dò) nhưng lượt sinh chữ hỏng: " +
  "[llamaServer] TỪ CHỐI TRUNG THỰC (G5-D, stream): model đã tiêu HẾT hạn mức 16000 token vào chuỗi SUY LUẬN (698 ký tự trong `reasoning_content`) " +
  "mà chưa kịp phát một ký tự nào ra `content`. TRÍCH SUY LUẬN: .\n\nTất cả 5 tests đều xanh.";
const LOI_KHAC = "[aiGgufEngine] TỪ CHỐI TRUNG THỰC (G1-D, streaming chat completion): llama-server còn SỐNG nhưng lượt sinh chữ hỏng: [llamaServer] stream HTTP 500: Failed to parse tool call arguments as JSON";

function loiCua(hv: string): Error {
  return new Error(hv === "loi-dau" || hv === "chu-roi-loi-dau" ? LOI_DAU : hv === "loi-g5d" ? LOI_G5D : LOI_KHAC);
}
const TOOL_CALL = { id: "c1", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } };

vi.mock("../services/aiGgufEngine", () => ({
  isGgufAvailable: vi.fn(async () => true),
  chatCompletion: vi.fn(async (opts: any) => {
    h.opts.push(opts);
    const hv = h.kichBan.shift() ?? "ok-tool";
    if (hv !== "ok-tool") throw loiCua(hv);
    return { text: "", toolCalls: [TOOL_CALL], tokensPrompt: 3, tokensGenerated: 2, modelId: "x", totalTimeMs: 1, tokensPerSecond: 1 };
  }),
  generateText: vi.fn(),
  generateFim: vi.fn(),
  generateEmbedding: vi.fn(),
  generateEmbeddings: vi.fn(),
  chatCompletionStream: (opts: any) => {
    h.opts.push(opts);
    const hv = h.kichBan.shift() ?? "ok-tool";
    return (async function* () {
      // Mảnh suy luận của lượt hỏng: gateway KHÔNG phát nó ra dây (đường thật cũng vậy).
      yield { type: "reasoning", token: "<tool_call>{bí mật trong suy luận}" };
      if (hv === "chu-roi-loi-dau") {
        yield { type: "token", token: "đã phát chữ " };
        throw loiCua(hv);
      }
      if (hv !== "ok-tool") throw loiCua(hv);
      yield { type: "tool_call_delta", toolCallDelta: [{ index: 0, ...TOOL_CALL }] };
      yield { type: "done", tokensPrompt: 11, tokensGenerated: 7 };
    })();
  },
  generateTextStream: async function* () {},
}));
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => null) }));

import { createOpenAiGatewayRouter, maLoiSuyLuanV1 } from "./openaiGateway";

const KEY = "HOI-LAI-NGHI-TAT-KEY";
const KEYS = ["AI_NATIVE_TOOLCALLS_ENABLED", "AI_SAFETY_ENABLED"] as const;
const cu: Record<string, string | undefined> = {};
let may: { url: string; server: Server };
beforeAll(async () => {
  for (const k of KEYS) cu[k] = process.env[k];
  process.env.AI_NATIVE_TOOLCALLS_ENABLED = "true";
  const app = express();
  app.use(express.json());
  app.use("/v1", createOpenAiGatewayRouter({ apiKey: KEY }));
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  may = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
});
afterAll(async () => {
  for (const k of KEYS) (cu[k] === undefined ? delete process.env[k] : (process.env[k] = cu[k]));
  await new Promise<void>((r) => may.server.close(() => r()));
});
beforeEach(() => {
  h.kichBan = [];
  h.opts = [];
});

const TOOLS = [{ type: "function", function: { name: "read_file", parameters: { type: "object", properties: { path: { type: "string" } } } } }];
const MSG = [{ role: "user", content: "sửa lỗi" }];
const post = (than: Record<string, unknown>) =>
  fetch(`${may.url}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(than),
  });
async function docSse(r: Response): Promise<{ suKien: any[]; done: boolean; tho: string }> {
  const tho = await r.text();
  const suKien: any[] = [];
  let done = false;
  for (const k of tho.split("\n\n").map((x) => x.trim()).filter(Boolean)) {
    const d = k.replace(/^data:\s*/, "");
    if (d === "[DONE]") done = true;
    else suKien.push(JSON.parse(d));
  }
  return { suKien, done, tho };
}
const datKichBan = (...ds: HanhVi[]) => {
  h.kichBan = [...ds];
};

describe("maLoiSuyLuanV1 — phân loại lỗi HỎI LẠI được", () => {
  it("dấu TOOL_CALL_TRONG_SUY_LUAN (kể cả bọc G1-D) ⇒ tool_call_in_reasoning", () => {
    expect(maLoiSuyLuanV1(new Error(LOI_DAU))).toBe("tool_call_in_reasoning");
  });
  it("G5-D ca (B) bọc G1-D ⇒ reasoning_without_content", () => {
    expect(maLoiSuyLuanV1(new Error(LOI_G5D))).toBe("reasoning_without_content");
  });
  it("lỗi khác ⇒ null", () => {
    expect(maLoiSuyLuanV1(new Error(LOI_KHAC))).toBeNull();
    expect(maLoiSuyLuanV1(undefined)).toBeNull();
  });
});

describe("stream + tools — hỏi lại ĐÚNG MỘT lần với nghĩ TẮT, trong CÙNG luồng SSE", () => {
  it("★★★ lần 1 tool call TRONG suy luận, lần 2 ổn ⇒ client nhận tool call bình thường, không khung lỗi, một role chunk, cùng id", async () => {
    datKichBan("loi-dau", "ok-tool");
    const { suKien, done, tho } = await docSse(await post({ messages: MSG, stream: true, tools: TOOLS }));
    expect(h.opts).toHaveLength(2);
    expect("disableThinking" in h.opts[0]).toBe(false);
    expect(h.opts[1].disableThinking).toBe(true);
    expect(h.opts[1].tools).toHaveLength(1);
    expect(suKien.some((s) => s.error)).toBe(false);
    expect(suKien.filter((s) => s.choices?.[0]?.delta?.role === "assistant")).toHaveLength(1);
    expect(new Set(suKien.map((s) => s.id)).size).toBe(1);
    const tc = suKien.flatMap((s) => s.choices?.[0]?.delta?.tool_calls ?? []);
    expect(tc[0].function.name).toBe("read_file");
    expect(suKien.at(-1)!.choices[0].finish_reason).toBe("tool_calls");
    expect(done).toBe(true);
    // chữ suy luận của lượt hỏng KHÔNG bao giờ rời máy chủ
    expect(tho).not.toContain("bí mật trong suy luận");
  });

  it("★★★ lần 1 câu trả lời nằm trong suy luận (G5-D ca B), lần 2 ổn ⇒ hỏi lại nghĩ TẮT, thành công", async () => {
    datKichBan("loi-g5d", "ok-tool");
    const { suKien, done } = await docSse(await post({ messages: MSG, stream: true, tools: TOOLS }));
    expect(h.opts).toHaveLength(2);
    expect(h.opts[1].disableThinking).toBe(true);
    expect(suKien.some((s) => s.error)).toBe(false);
    expect(done).toBe(true);
  });

  it("★★★ hỏng CẢ HAI lần ⇒ khung lỗi có code tool_call_in_reasoning, ĐÚNG hai lần gọi (không lần ba)", async () => {
    datKichBan("loi-dau", "loi-dau", "ok-tool");
    const { suKien } = await docSse(await post({ messages: MSG, stream: true, tools: TOOLS }));
    expect(h.opts).toHaveLength(2);
    const loi = suKien.find((s) => s.error)!.error;
    expect(loi.code).toBe("tool_call_in_reasoning");
    expect(loi.message).toContain("TOOL_CALL_TRONG_SUY_LUAN");
  });

  it("★★ KHÔNG có tools ⇒ KHÔNG hỏi lại (một lần gọi), lỗi vẫn mang code", async () => {
    datKichBan("loi-dau", "ok-tool");
    const { suKien } = await docSse(await post({ messages: MSG, stream: true }));
    expect(h.opts).toHaveLength(1);
    expect(suKien.find((s) => s.error)!.error.code).toBe("tool_call_in_reasoning");
  });

  it("★★ yêu cầu ĐÃ tắt nghĩ ⇒ không hỏi lại (lần hai sẽ y hệt)", async () => {
    datKichBan("loi-dau", "ok-tool");
    await docSse(await post({ messages: MSG, stream: true, tools: TOOLS, chat_template_kwargs: { enable_thinking: false } }));
    expect(h.opts).toHaveLength(1);
  });

  it("★★ lỗi KHÁC lớp ⇒ không hỏi lại, khung lỗi KHÔNG có code", async () => {
    datKichBan("loi-khac", "ok-tool");
    const { suKien } = await docSse(await post({ messages: MSG, stream: true, tools: TOOLS }));
    expect(h.opts).toHaveLength(1);
    const loi = suKien.find((s) => s.error)!.error;
    expect(loi.code).toBeUndefined();
  });

  it("★★ đã phát chữ ra client TRƯỚC khi hỏng ⇒ KHÔNG hỏi lại (nối hai lượt là bịa), báo lỗi có code", async () => {
    datKichBan("chu-roi-loi-dau", "ok-tool");
    const { suKien } = await docSse(await post({ messages: MSG, stream: true, tools: TOOLS }));
    expect(h.opts).toHaveLength(1);
    expect(suKien.find((s) => s.error)!.error.code).toBe("tool_call_in_reasoning");
  });
});

describe("không stream + tools", () => {
  it("★★★ lần 1 hỏng, lần 2 ổn ⇒ 200 với tool_calls; lần 2 nghĩ TẮT", async () => {
    datKichBan("loi-dau", "ok-tool");
    const r = await post({ messages: MSG, tools: TOOLS });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.choices[0].message.tool_calls[0].function.name).toBe("read_file");
    expect(h.opts).toHaveLength(2);
    expect(h.opts[1].disableThinking).toBe(true);
  });
  it("★★★ hỏng cả hai ⇒ lỗi có code tool_call_in_reasoning", async () => {
    datKichBan("loi-dau", "loi-dau");
    const r = await post({ messages: MSG, tools: TOOLS });
    const j = await r.json();
    expect(r.status).toBe(500);
    expect(j.error.code).toBe("tool_call_in_reasoning");
    expect(h.opts).toHaveLength(2);
  });
  it("★★ không tools ⇒ không hỏi lại", async () => {
    datKichBan("loi-g5d", "ok-tool");
    const r = await post({ messages: MSG });
    expect((await r.json()).error.code).toBe("reasoning_without_content");
    expect(h.opts).toHaveLength(1);
  });
});
