/**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * G2-B — LƯỚI CHO TOOL-CALLING **GỐC** TRÊN `/v1/chat/completions`.
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * TRƯỚC BẢN VÁ (đo trực tiếp, không trích tài liệu):
 *   • `openaiGateway.ts` **không hề đọc** `body.tools` / `body.tool_choice` — grep chữ "tools"
 *     trên cả file ra ĐÚNG 1 lần, nằm trong một dòng chú thích.
 *   • `toGgufMessages` bóp MỌI vai lạ về `"user"` ⇒ message `role:"tool"` bị nuốt ⇒ mắt xích giữa
 *     của vòng đời tool-call đứt.
 * Hai điều đó cộng lại: model **không bao giờ tự quyết định gọi tool** trên bề mặt này.
 *
 * ⚠⚠ LỚP LỖI LƯỚI NÀY CỐ Ý CHỐNG — **"NỐI DÂY XONG, CỔNG XANH, MÀ HÀNG KHÔNG TỚI"**:
 * mọi ca dưới đây kiểm ô `tools` **THẬT SỰ ĐẾN ĐƯỢC ENGINE** (đọc lại đối số engine nhận được),
 * chứ không chỉ kiểm "đáp ứng có hình dạng đúng". Một gateway đọc `body.tools` rồi quên truyền
 * xuống vẫn trả 200 với `content` hợp lệ — và không ca "hình dạng" nào đỏ.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  lastChatArgs: null as any,
  lastStreamArgs: null as any,
  /** Kịch bản cho lượt chat kế tiếp (không-stream). */
  chatResult: null as any,
  /** Các chunk mà chatCompletionStream sẽ phát ra ở lượt kế tiếp. */
  streamChunks: [] as any[],
}));

vi.mock("../services/aiGgufEngine", () => ({
  isGgufAvailable: vi.fn(async () => true),
  chatCompletion: vi.fn(async (opts: any, modelId?: string) => {
    h.lastChatArgs = { opts, modelId };
    return (
      h.chatResult ?? {
        text: "hello from chat",
        tokensPrompt: 7,
        tokensGenerated: 3,
        modelId: modelId || "default",
        totalTimeMs: 1,
        tokensPerSecond: 1,
      }
    );
  }),
  chatCompletionStream: vi.fn(async function* (opts: any, modelId?: string) {
    h.lastStreamArgs = { opts, modelId };
    for (const c of h.streamChunks) yield c;
  }),
  generateText: vi.fn(async () => ({
    text: "x", tokensPrompt: 1, tokensGenerated: 1, modelId: "d", totalTimeMs: 1, tokensPerSecond: 1,
  })),
  generateFim: vi.fn(async () => ({
    text: "x", tokensPrompt: 1, tokensGenerated: 1, modelId: "d", totalTimeMs: 1, tokensPerSecond: 1,
  })),
  generateEmbedding: vi.fn(async () => ({ embedding: [0.1], dimensions: 1, modelId: "e" })),
  generateEmbeddings: vi.fn(async (t: string[]) => ({ embeddings: t.map(() => [0.1]), dimensions: 1, modelId: "e" })),
  generateTextStream: async function* () {
    yield { type: "done", fullText: "" };
  },
  LoiToolCallKhongHoTro: class LoiToolCallKhongHoTro extends Error {
    readonly code = "tool_calls_unsupported_path";
  },
}));

import { createOpenAiGatewayRouter } from "./openaiGateway";

const API_KEY = "SECRET-TEST-KEY";
const AUTH = { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" };

let srv: { url: string; server: Server };
const SAVED: Record<string, string | undefined> = {};
const KEYS = ["AI_NATIVE_TOOLCALLS_ENABLED", "AI_SAFETY_ENABLED"] as const;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_machine_oee",
      description: "Lấy OEE hiện tại của một máy",
      parameters: { type: "object", properties: { machineId: { type: "string" } }, required: ["machineId"] },
    },
  },
];

beforeAll(async () => {
  for (const k of KEYS) SAVED[k] = process.env[k];
  process.env.AI_NATIVE_TOOLCALLS_ENABLED = "true";
  const app = express();
  app.use("/v1", createOpenAiGatewayRouter({ apiKey: API_KEY }));
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  srv = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
});

afterAll(async () => {
  for (const k of KEYS) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k]!;
  }
  await new Promise<void>((r) => srv.server.close(() => r()));
});

beforeEach(() => {
  h.lastChatArgs = null;
  h.lastStreamArgs = null;
  h.chatResult = null;
  h.streamChunks = [];
  process.env.AI_NATIVE_TOOLCALLS_ENABLED = "true";
});

async function chat(body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${srv.url}/v1/chat/completions`, {
    method: "POST",
    headers: AUTH,
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function chatSse(body: unknown): Promise<string> {
  const res = await fetch(`${srv.url}/v1/chat/completions`, {
    method: "POST",
    headers: AUTH,
    body: JSON.stringify({ ...(body as object), stream: true }),
  });
  return await res.text();
}

/** Bóc các payload JSON của một luồng SSE. */
function sseEvents(raw: string): any[] {
  return raw
    .split("\n\n")
    .map((b) => b.replace(/^data: /, "").trim())
    .filter((s) => s && s !== "[DONE]")
    .map((s) => {
      try {
        return JSON.parse(s);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// ═══ 1. `tools` PHẢI TỚI ĐƯỢC ENGINE ═══════════════════════════════════════════════════════════
describe("G2-B · gateway đọc `tools` và truyền XUỐNG engine", () => {
  it("truyền `tools` nguyên vẹn vào GgufChatOptions (không chỉ 'nhận rồi bỏ')", async () => {
    await chat({ model: "chat", messages: [{ role: "user", content: "OEE máy AOI-01?" }], tools: TOOLS });
    expect(h.lastChatArgs.opts.tools).toHaveLength(1);
    expect(h.lastChatArgs.opts.tools[0].function.name).toBe("get_machine_oee");
    expect(h.lastChatArgs.opts.tools[0].function.parameters).toEqual(TOOLS[0].function.parameters);
    expect(h.lastChatArgs.opts.toolChoice).toBe("auto");
  });

  it("KHÔNG gửi tools ⇒ engine KHÔNG nhận ô `tools` (mọi lượt chat cũ giữ nguyên hình dạng)", async () => {
    await chat({ model: "chat", messages: [{ role: "user", content: "chào" }] });
    expect(h.lastChatArgs.opts.tools).toBeUndefined();
    expect(h.lastChatArgs.opts.toolChoice).toBeUndefined();
  });

  it("`tools: []` coi như không có (không rẽ nhánh template với danh sách rỗng)", async () => {
    await chat({ model: "chat", messages: [{ role: "user", content: "chào" }], tools: [] });
    expect(h.lastChatArgs.opts.tools).toBeUndefined();
  });
});

// ═══ 2. ĐÁP ỨNG KHÔNG-STREAM ═══════════════════════════════════════════════════════════════════
describe("G2-B · đáp ứng KHÔNG-stream trả `tool_calls` THẬT", () => {
  it("trả `tool_calls` + finish_reason='tool_calls' khi engine báo có", async () => {
    h.chatResult = {
      text: "",
      toolCalls: [
        { id: "call_1", type: "function", function: { name: "get_machine_oee", arguments: '{"machineId":"AOI-01"}' } },
      ],
      finishReason: "tool_calls",
      tokensPrompt: 190, tokensGenerated: 27, modelId: "m", totalTimeMs: 1, tokensPerSecond: 1,
    };
    const { status, json } = await chat({
      model: "chat", messages: [{ role: "user", content: "OEE AOI-01?" }], tools: TOOLS,
    });
    expect(status).toBe(200);
    expect(json.choices[0].finish_reason).toBe("tool_calls");
    expect(json.choices[0].message.tool_calls).toEqual([
      { id: "call_1", type: "function", function: { name: "get_machine_oee", arguments: '{"machineId":"AOI-01"}' } },
    ]);
  });

  it("⚠ KHÔNG có tool-call ⇒ ô `tool_calls` VẮNG MẶT, KHÔNG phải `[]`", async () => {
    const { json } = await chat({ model: "chat", messages: [{ role: "user", content: "chào" }], tools: TOOLS });
    expect(json.choices[0].message).not.toHaveProperty("tool_calls");
    expect(json.choices[0].finish_reason).toBe("stop");
  });

  it("`arguments` đi qua NGUYÊN VĂN — bộ cắt suy luận/che bí mật không được đụng vào JSON args", async () => {
    const args = '{"machineId":"AOI-01","note":"<think>không phải thẻ thật</think>"}';
    h.chatResult = {
      text: "",
      toolCalls: [{ id: "c", type: "function", function: { name: "get_machine_oee", arguments: args } }],
      finishReason: "tool_calls",
      tokensPrompt: 1, tokensGenerated: 1, modelId: "m", totalTimeMs: 1, tokensPerSecond: 1,
    };
    const { json } = await chat({ model: "chat", messages: [{ role: "user", content: "x" }], tools: TOOLS });
    expect(json.choices[0].message.tool_calls[0].function.arguments).toBe(args);
  });
});

// ═══ 3. tool_choice — CƯỠNG CHẾ ĐƯỢC vs KHÔNG ══════════════════════════════════════════════════
describe("G2-B · tool_choice", () => {
  it("'none' được cưỡng chế Ở PHÍA TA: engine KHÔNG nhận tools", async () => {
    await chat({
      model: "chat", messages: [{ role: "user", content: "OEE?" }], tools: TOOLS, tool_choice: "none",
    });
    expect(h.lastChatArgs.opts.tools).toBeUndefined();
  });

  it("'required' ⇒ 400 có mã `tool_choice_unsupported` (KHÔNG im lặng bỏ qua ràng buộc)", async () => {
    const { status, json } = await chat({
      model: "chat", messages: [{ role: "user", content: "x" }], tools: TOOLS, tool_choice: "required",
    });
    expect(status).toBe(400);
    expect(json.error.code).toBe("tool_choice_unsupported");
    expect(h.lastChatArgs).toBeNull(); // KHÔNG được gọi engine
  });

  it("tool_choice theo TÊN ⇒ 400 `tool_choice_unsupported`", async () => {
    const { status, json } = await chat({
      model: "chat",
      messages: [{ role: "user", content: "x" }],
      tools: TOOLS,
      tool_choice: { type: "function", function: { name: "get_machine_oee" } },
    });
    expect(status).toBe(400);
    expect(json.error.code).toBe("tool_choice_unsupported");
  });

  it("'auto' đi qua", async () => {
    await chat({ model: "chat", messages: [{ role: "user", content: "x" }], tools: TOOLS, tool_choice: "auto" });
    expect(h.lastChatArgs.opts.toolChoice).toBe("auto");
  });
});

// ═══ 4. ĐẦU VÀO HỎNG ⇒ 400 CÓ MÃ, KHÔNG PHẢI 500/ IM LẶNG ═════════════════════════════════════
describe("G2-B · tools hỏng", () => {
  it("`tools` không phải mảng ⇒ 400 `invalid_tools`", async () => {
    const { status, json } = await chat({ model: "chat", messages: [{ role: "user", content: "x" }], tools: {} });
    expect(status).toBe(400);
    expect(json.error.code).toBe("invalid_tools");
  });

  it("tool thiếu name ⇒ 400 `invalid_tools`, engine KHÔNG bị gọi", async () => {
    const { status, json } = await chat({
      model: "chat", messages: [{ role: "user", content: "x" }], tools: [{ type: "function", function: {} }],
    });
    expect(status).toBe(400);
    expect(json.error.code).toBe("invalid_tools");
    expect(h.lastChatArgs).toBeNull();
  });
});

// ═══ 5. VÒNG ĐỜI — vai `tool` KHÔNG ĐƯỢC BÓP VỀ `user` ═════════════════════════════════════════
describe("G2-B · vòng đời tool-call: vai `tool` giữ nguyên", () => {
  const HOI_THOAI = [
    { role: "user", content: "OEE máy AOI-01?" },
    {
      role: "assistant",
      content: "",
      tool_calls: [
        { id: "call_abc", type: "function", function: { name: "get_machine_oee", arguments: '{"machineId":"AOI-01"}' } },
      ],
    },
    { role: "tool", tool_call_id: "call_abc", content: '{"oee":0.873}' },
  ];

  it("message `role:\"tool\"` tới engine VẪN LÀ `tool` (trước bản vá: bị bóp về `user`)", async () => {
    await chat({ model: "chat", messages: HOI_THOAI, tools: TOOLS });
    const msgs = h.lastChatArgs.opts.messages;
    expect(msgs).toHaveLength(3);
    expect(msgs[2].role).toBe("tool");
    expect(msgs[2].tool_call_id).toBe("call_abc");
  });

  it("`tool_calls` trên message assistant được giữ (mắt xích giữa của vòng đời)", async () => {
    await chat({ model: "chat", messages: HOI_THOAI, tools: TOOLS });
    const msgs = h.lastChatArgs.opts.messages;
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].tool_calls).toHaveLength(1);
    expect(msgs[1].tool_calls[0].id).toBe("call_abc");
  });

  it("vai LẠ (vd 'developer') vẫn bị bóp về `user` — chỉ `tool` được thêm, không nới lỏng chung", async () => {
    await chat({ model: "chat", messages: [{ role: "developer", content: "x" }] });
    expect(h.lastChatArgs.opts.messages[0].role).toBe("user");
  });
});

// ═══ 6. STREAM ════════════════════════════════════════════════════════════════════════════════
describe("G2-B · streaming trả delta.tool_calls", () => {
  it("phát `delta.tool_calls` theo từng mảnh và đóng bằng finish_reason='tool_calls'", async () => {
    h.streamChunks = [
      { type: "tool_call_delta", toolCallDelta: [{ index: 0, id: "c1", type: "function", function: { name: "get_machine_oee", arguments: "{" } }] },
      { type: "tool_call_delta", toolCallDelta: [{ index: 0, function: { arguments: '"machineId":"AOI-01"}' } }] },
      { type: "done", fullText: "", toolCalls: [{ id: "c1", type: "function", function: { name: "get_machine_oee", arguments: '{"machineId":"AOI-01"}' } }], finishReason: "tool_calls", tokensPrompt: 1, tokensGenerated: 1 },
    ];
    const raw = await chatSse({ model: "chat", messages: [{ role: "user", content: "x" }], tools: TOOLS });
    const evs = sseEvents(raw);
    const deltas = evs.filter((e) => e.choices?.[0]?.delta?.tool_calls);
    expect(deltas.length).toBe(2);
    expect(deltas[0].choices[0].delta.tool_calls[0].function.name).toBe("get_machine_oee");
    expect(deltas[1].choices[0].delta.tool_calls[0].function.arguments).toBe('"machineId":"AOI-01"}');
    // Mảnh sau KHÔNG được lặp lại `name` (client chuẩn sẽ nối chuỗi tên thành "ff")
    expect(deltas[1].choices[0].delta.tool_calls[0].function.name).toBeUndefined();
    const last = evs[evs.length - 1];
    expect(last.choices[0].finish_reason).toBe("tool_calls");
  });

  it("mảnh tool_call KHÔNG BAO GIỜ đi ra dưới dạng `delta.content` (nếu không nó bị IN RA MÀN HÌNH)", async () => {
    h.streamChunks = [
      { type: "tool_call_delta", toolCallDelta: [{ index: 0, id: "c1", type: "function", function: { name: "f", arguments: "{}" } }] },
      { type: "done", fullText: "", toolCalls: [{ id: "c1", type: "function", function: { name: "f", arguments: "{}" } }], finishReason: "tool_calls" },
    ];
    const raw = await chatSse({ model: "chat", messages: [{ role: "user", content: "x" }], tools: TOOLS });
    for (const e of sseEvents(raw)) {
      expect(typeof e.choices?.[0]?.delta?.content === "string" ? e.choices[0].delta.content : "").not.toContain("tool_call");
      expect(typeof e.choices?.[0]?.delta?.content === "string" ? e.choices[0].delta.content : "").not.toContain("machineId");
    }
  });

  it("luồng chữ THƯỜNG (không tool) vẫn đóng bằng finish_reason='stop' — không hồi quy", async () => {
    h.streamChunks = [
      { type: "token", token: "xin " },
      { type: "token", token: "chào" },
      { type: "done", fullText: "xin chào", tokensPrompt: 1, tokensGenerated: 2 },
    ];
    const raw = await chatSse({ model: "chat", messages: [{ role: "user", content: "x" }] });
    const evs = sseEvents(raw);
    expect(evs[evs.length - 1].choices[0].finish_reason).toBe("stop");
    expect(evs.filter((e) => e.choices?.[0]?.delta?.tool_calls).length).toBe(0);
  });
});

// ═══ 7. CỜ — đường lùi phải TỒN TẠI, và TẮT phải NÓI RA ═══════════════════════════════════════
describe("G2-B · cờ AI_NATIVE_TOOLCALLS_ENABLED", () => {
  it("TẮT + caller gửi `tools` ⇒ 400 `native_tools_disabled` (KHÔNG âm thầm bỏ qua tools)", async () => {
    process.env.AI_NATIVE_TOOLCALLS_ENABLED = "false";
    const { status, json } = await chat({
      model: "chat", messages: [{ role: "user", content: "x" }], tools: TOOLS,
    });
    expect(status).toBe(400);
    expect(json.error.code).toBe("native_tools_disabled");
    expect(h.lastChatArgs).toBeNull();
  });

  it("TẮT + KHÔNG gửi tools ⇒ chạy bình thường (cờ không đụng đường chat cũ)", async () => {
    process.env.AI_NATIVE_TOOLCALLS_ENABLED = "false";
    const { status, json } = await chat({ model: "chat", messages: [{ role: "user", content: "chào" }] });
    expect(status).toBe(200);
    expect(json.choices[0].message.content).toBe("hello from chat");
  });
});

// ═══ 8. ★★ AN TOÀN — `/v1` LÀ BỀ MẶT **BYOT**, KHÔNG PHẢI CỬA VÀO REGISTRY 77 TOOL ════════════
describe("G2-B · an toàn: gateway KHÔNG thực thi tool, KHÔNG chạm registry", () => {
  it("tool trùng TÊN một tool registry vẫn chỉ được TRẢ VỀ, không được THỰC THI", async () => {
    // `updateMachineStatus` là tên một write-tool có HITL+RBAC trong registry nội bộ.
    h.chatResult = {
      text: "",
      toolCalls: [
        { id: "c", type: "function", function: { name: "updateMachineStatus", arguments: '{"__authCtx":{"userId":999,"role":"superadmin"}}' } },
      ],
      finishReason: "tool_calls",
      tokensPrompt: 1, tokensGenerated: 1, modelId: "m", totalTimeMs: 1, tokensPerSecond: 1,
    };
    const { status, json } = await chat({
      model: "chat",
      messages: [{ role: "user", content: "x" }],
      tools: [{ type: "function", function: { name: "updateMachineStatus", parameters: { type: "object" } } }],
    });
    expect(status).toBe(200);
    // Gateway TRẢ ý định của model cho CLIENT thực thi — nó không tự chạy gì.
    expect(json.choices[0].message.tool_calls[0].function.name).toBe("updateMachineStatus");
  });

  it("mã nguồn gateway KHÔNG import toolRegistry / aiLocalTools (bất biến theo CẤU TẠO)", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("./openaiGateway.ts", import.meta.url), "utf8");
    // ⚠ Ca này canh một BẤT BIẾN KIẾN TRÚC, không phải một hành vi: chừng nào gateway không
    // import registry thì `argsWithAuthCtx` / HITL / RBAC **không thể** bị đi vòng qua đường này,
    // vì không có đường nào để đi vòng. Ngày ai đó thêm import ấy, ca này đỏ và bắt họ đọc §8.
    expect(src).not.toMatch(/from\s+["'][^"']*aiLocalTools/);
    expect(src).not.toMatch(/from\s+["'][^"']*toolRegistry/);
  });
});
