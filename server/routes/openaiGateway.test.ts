/**
 * Doc 34 §IV-P0 — OpenAI-compatible gateway tests.
 *
 * MOCKS the GGUF engine (no model load — VRAM is shared with a concurrent agent).
 * Covers: gating (disabled ⇒ not mounted/404; enabled+empty key ⇒ refuse to
 * mount/404), Bearer auth (401 without/with wrong token), and the OpenAI response
 * SHAPE for /models, /chat/completions, /completions (incl. the FIM suffix path)
 * and /embeddings.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  lastGenerateTextArgs: null as any,
  lastChatArgs: null as any,
}));

vi.mock("../services/aiGgufEngine", () => ({
  isGgufAvailable: vi.fn(async () => true),
  chatCompletion: vi.fn(async (opts: any, modelId?: string) => {
    h.lastChatArgs = { opts, modelId };
    return { text: "hello from chat", tokensPrompt: 7, tokensGenerated: 3, modelId: modelId || "default", totalTimeMs: 1, tokensPerSecond: 1 };
  }),
  generateText: vi.fn(async (opts: any, modelId?: string) => {
    h.lastGenerateTextArgs = { opts, modelId };
    return { text: "completed text", tokensPrompt: 5, tokensGenerated: 2, modelId: modelId || "default", totalTimeMs: 1, tokensPerSecond: 1 };
  }),
  // /v1/completions now routes to native FIM (generateFim), forwarding {prefix, suffix}.
  generateFim: vi.fn(async (opts: any, modelId?: string) => {
    h.lastFimArgs = { opts, modelId };
    return { text: "completed text", tokensPrompt: 5, tokensGenerated: 2, modelId: modelId || "default", totalTimeMs: 1, tokensPerSecond: 1 };
  }),
  generateEmbedding: vi.fn(async (_text: string) => ({ embedding: [0.1, 0.2, 0.3], dimensions: 3, modelId: "embed" })),
  generateEmbeddings: vi.fn(async (texts: string[]) => ({ embeddings: texts.map((_t, i) => [i, i + 1]), dimensions: 2, modelId: "embed" })),
  // Stream exports (present for import completeness; not exercised here).
  chatCompletionStream: async function* () {
    yield { type: "token", token: "hi" };
    yield { type: "done", fullText: "hi" };
  },
  generateTextStream: async function* () {
    yield { type: "token", token: "x" };
    yield { type: "done", fullText: "x" };
  },
}));

import { registerOpenAiGateway, createOpenAiGatewayRouter } from "./openaiGateway";

// ── Helper: stand up an app + real http server, return base url + closer ──
async function serve(app: express.Express): Promise<{ url: string; server: Server }> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

const API_KEY = "SECRET-TEST-KEY";
const AUTH = { Authorization: `Bearer ${API_KEY}` };

let disabled: { url: string; server: Server };
let noKey: { url: string; server: Server };
let enabled: { url: string; server: Server };

const ENV_KEYS = ["OPENAI_GATEWAY_ENABLED", "OPENAI_GATEWAY_API_KEY", "OPENAI_GATEWAY_PATH"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

  // (1) Disabled — flag off ⇒ registerOpenAiGateway must NOT mount.
  delete process.env.OPENAI_GATEWAY_ENABLED;
  delete process.env.OPENAI_GATEWAY_API_KEY;
  {
    const app = express();
    const mounted = registerOpenAiGateway(app);
    expect(mounted).toBe(false);
    disabled = await serve(app);
  }

  // (2) Enabled but empty key ⇒ fail-closed: refuse to mount + log error.
  {
    process.env.OPENAI_GATEWAY_ENABLED = "true";
    process.env.OPENAI_GATEWAY_API_KEY = "";
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = express();
    const mounted = registerOpenAiGateway(app);
    expect(mounted).toBe(false);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
    noKey = await serve(app);
  }

  // (3) Enabled with a key ⇒ mounted at /v1.
  {
    process.env.OPENAI_GATEWAY_ENABLED = "true";
    process.env.OPENAI_GATEWAY_API_KEY = API_KEY;
    delete process.env.OPENAI_GATEWAY_PATH; // default /v1
    const app = express();
    const mounted = registerOpenAiGateway(app);
    expect(mounted).toBe(true);
    enabled = await serve(app);
  }
});

afterAll(async () => {
  await Promise.all(
    [disabled, noKey, enabled].map(
      (s) => new Promise<void>((resolve) => s.server.close(() => resolve())),
    ),
  );
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("gating", () => {
  it("disabled ⇒ /v1/models is not mounted (404)", async () => {
    const res = await fetch(`${disabled.url}/v1/models`, { headers: AUTH });
    expect(res.status).toBe(404);
  });

  it("enabled + empty key ⇒ refused to mount (404)", async () => {
    const res = await fetch(`${noKey.url}/v1/models`, { headers: AUTH });
    expect(res.status).toBe(404);
  });
});

describe("auth", () => {
  it("no token ⇒ 401", async () => {
    const res = await fetch(`${enabled.url}/v1/models`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_api_key");
  });

  it("wrong token ⇒ 401", async () => {
    const res = await fetch(`${enabled.url}/v1/models`, { headers: { Authorization: "Bearer nope" } });
    expect(res.status).toBe(401);
  });
});

describe("GET /v1/models", () => {
  it("lists logical models in OpenAI models-list shape", async () => {
    const res = await fetch(`${enabled.url}/v1/models`, { headers: AUTH });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe("list");
    const ids = body.data.map((m: { id: string }) => m.id);
    // 5 tên logic cũ đứng ĐẦU, đúng thứ tự cũ (client lấy data[0] không đổi hành vi).
    expect(ids.slice(0, 5)).toEqual(["chat", "code", "fast", "fim", "embed"]);
    expect(body.data[0].object).toBe("model");
    // ★★ Đợt 7.0 — vai trò SINH CHỮ theo sau, đánh dấu kind:"role"; rerank/vision (không sinh chữ) KHÔNG được bày.
    const vaiTro = body.data.filter((m: { kind?: string }) => m.kind === "role").map((m: { id: string }) => m.id).sort();
    expect(vaiTro).toEqual(["chat.ops", "classify", "code.plc", "code.software", "extract", "summarize"]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("★★ Đợt 7.3 — model \"auto\" chọn vai trò từ câu hỏi", () => {
  it("câu viết mã PLC ⇒ vai trò code.plc (tầng 3), ghi vào model của phản hồi + header", async () => {
    const res = await fetch(`${enabled.url}/v1/chat/completions`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "auto", messages: [{ role: "user", content: "Viết function block ST điều khiển băng tải" }] }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-st4i-vai-tro")).toBe("code.plc; tang=3");
    expect((await res.json()).model).toBe("code.plc");
  });

  it("không tín hiệu chữ ⇒ tầng 4/5 (engine giả trả vector giả) — không lỗi, vai trò hợp lệ", async () => {
    const res = await fetch(`${enabled.url}/v1/chat/completions`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "auto", messages: [{ role: "user", content: "Hôm nay thế nào?" }] }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-st4i-vai-tro")).toMatch(/^(chat|chat\.ops|summarize|extract|code\.software|code\.plc); tang=[45]$/);
  });

  it("/v1/models có mục auto", async () => {
    const body = await (await fetch(`${enabled.url}/v1/models`, { headers: AUTH })).json();
    expect(body.data.find((m: { id: string }) => m.id === "auto")?.kind).toBe("auto");
  });
});

describe("POST /v1/chat/completions", () => {
  it("non-stream ⇒ chat.completion shape with message + usage", async () => {
    const res = await fetch(`${enabled.url}/v1/chat/completions`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "code", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe("chat.completion");
    expect(body.model).toBe("code");
    expect(body.choices[0].message).toEqual({ role: "assistant", content: "hello from chat" });
    expect(body.choices[0].finish_reason).toBe("stop");
    expect(body.usage).toEqual({ prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 });
  });

  it("empty messages ⇒ 400", async () => {
    const res = await fetch(`${enabled.url}/v1/chat/completions`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/completions", () => {
  it("plain prompt ⇒ text_completion shape", async () => {
    const res = await fetch(`${enabled.url}/v1/completions`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "code", prompt: "print(" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe("text_completion");
    expect(body.choices[0].text).toBe("completed text");
    expect(body.choices[0].finish_reason).toBe("stop");
    expect(body.usage.total_tokens).toBe(7);
  });

  it("suffix ⇒ native FIM: generateFim receives raw prefix + suffix (no chat template)", async () => {
    h.lastFimArgs = null;
    const res = await fetch(`${enabled.url}/v1/completions`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "def foo():\n  ", suffix: "\n  return x" }),
    });
    expect(res.status).toBe(200);
    // The gateway forwards prefix/suffix to the engine's native infill (LlamaCompletion),
    // NOT an assembled sentinel prompt through the chat path.
    expect(h.lastFimArgs).not.toBeNull();
    expect(h.lastFimArgs.opts.prefix).toContain("def foo():");
    expect(h.lastFimArgs.opts.suffix).toContain("return x");
  });
});

describe("POST /v1/embeddings", () => {
  it("single string ⇒ list with one embedding", async () => {
    const res = await fetch(`${enabled.url}/v1/embeddings`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "embed", input: "hello" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe("list");
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ object: "embedding", index: 0, embedding: [0.1, 0.2, 0.3] });
  });

  it("array input ⇒ one embedding per element, indexed", async () => {
    const res = await fetch(`${enabled.url}/v1/embeddings`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ input: ["a", "b"] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.data.map((d: { index: number }) => d.index)).toEqual([0, 1]);
  });

  it("missing input ⇒ 400", async () => {
    const res = await fetch(`${enabled.url}/v1/embeddings`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("createOpenAiGatewayRouter (unit)", () => {
  it("builds a router that 401s a bad token directly", async () => {
    const app = express();
    app.use("/v1", createOpenAiGatewayRouter({ apiKey: "K" }));
    const { url, server } = await serve(app);
    try {
      const bad = await fetch(`${url}/v1/models`, { headers: { Authorization: "Bearer WRONG" } });
      expect(bad.status).toBe(401);
      const ok = await fetch(`${url}/v1/models`, { headers: { Authorization: "Bearer K" } });
      expect(ok.status).toBe(200);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("★ M4 (audit kiem-dinh) — `model` của client không mang được đường dẫn tới engine", () => {
  for (const [duong, body] of [
    ["/v1/chat/completions", (m: string) => ({ model: m, messages: [{ role: "user", content: "hi" }] })],
    ["/v1/completions", (m: string) => ({ model: m, prompt: "print(" })],
  ] as const) {
    it(`${duong}: đường tuyệt đối / \`..\` / tên tệp không có ⇒ 400 chung, KHÔNG phản chiếu chuỗi`, async () => {
      for (const m of ["C:\\Windows\\System32\\x.gguf", "/etc/passwd", "../../secret", "khong-co-model-nao"]) {
        const res = await fetch(`${enabled.url}${duong}`, {
          method: "POST",
          headers: { ...AUTH, "Content-Type": "application/json" },
          body: JSON.stringify(body(m)),
        });
        expect(res.status, m).toBe(400);
        const j = await res.json();
        expect(j.error.code).toBe("model_not_found");
        expect(JSON.stringify(j)).not.toContain(m.slice(0, 8));
      }
    });
  }
});

describe("★ Đợt 9 (M4 tranh khe) — token /v1 vượt trần 3 lần đổi khe / 10 phút ⇒ đi model khe đang giữ", () => {
  it("dưới trần ⇒ model nặng được yêu cầu; vượt trần ⇒ model khe đang giữ + header tran-doi-khe-token", async () => {
    const { datAnhSoModel, layAnhSoModel } = await import("../services/ai/soModel/anhSoModel");
    const { __xoaTranDoiKhe, chayVoiTokenKhe, ghiDoiKheTheoNguCanh } = await import("../services/ai/soModel/tranDoiKheToken");
    const anhCu = layAnhSoModel();
    const envCu = process.env.LLAMA_SERVER_MODEL;
    process.env.LLAMA_SERVER_MODEL = "Q35-Home.gguf"; // khe đang giữ (không có KheNang thật ⇒ đọc env)
    datAnhSoModel({
      ...anhCu,
      taiLuc: 1,
      profile: new Map([["q27@64k", { artifactFile: "Q27-Nang.gguf", slotClass: "nang", artifactStatus: "available", license: "apache-2.0", enabled: true }]]),
    });
    __xoaTranDoiKhe();
    try {
      const goi = () =>
        fetch(`${enabled.url}/v1/chat/completions`, {
          method: "POST",
          headers: { ...AUTH, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "q27@64k", messages: [{ role: "user", content: "hi" }] }),
        });
      let res = await goi();
      expect(res.status).toBe(200);
      expect(h.lastChatArgs.modelId).toBe("Q27-Nang");
      expect(res.headers.get("x-st4i-khe")).toBeNull();
      // key chung đã gây 3 lần đổi khe THỰC trong cửa sổ
      for (let i = 0; i < 3; i++) await chayVoiTokenKhe("key-chung", async () => ghiDoiKheTheoNguCanh());
      res = await goi();
      expect(res.status).toBe(200);
      expect(h.lastChatArgs.modelId).toBe("Q35-Home");
      expect(res.headers.get("x-st4i-khe")).toBe("tran-doi-khe-token");
    } finally {
      datAnhSoModel(anhCu);
      if (envCu === undefined) delete process.env.LLAMA_SERVER_MODEL;
      else process.env.LLAMA_SERVER_MODEL = envCu;
      __xoaTranDoiKhe();
    }
  });
});
