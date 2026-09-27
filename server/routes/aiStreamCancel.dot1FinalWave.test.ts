/**
 * Doc 80 Đợt 1 final wave (item 2) — HUỶ của client phải tới tận llama-server trên NĂM tuyến SSE cũ.
 *
 * Final review 2026-09-27 (xác nhận trên Node 24.18): `req.on("close")` gắn SAU một `await` ở
 * `aiStreamingApi.ts` (/stream/generate · /stream/chat · /stream/narrative), `aiLocalKnowledgeApi.ts`
 * (/local-kb/stream) và `openaiGateway.ts` (/v1/chat/completions) — vì `req` phát `close` ~1 ms sau khi
 * thân JSON đã đọc xong, lắng nghe ấy KHÔNG BAO GIỜ chạy ⇒ nút Dừng không huỷ lượt model, khe bị giữ.
 * Nay cả năm dùng `huyKhiClientBoDi` (`res.on("close")` + `!writableFinished` + kiểm socket đã chết).
 *
 * Cùng cách đo với `programmingCopilotStream.test.ts`: Express thật + tuyến thật + engine THẬT
 * (`aiGgufEngine` → `aiLlamaServerClient` → `fetch`) tới một llama-server GIẢ ghi sổ thời điểm kết
 * nối của nó bị ĐÓNG. Mỗi tuyến: client huỷ giữa lúc model "đang nghĩ" ⇒ fake thấy kết nối đóng ≤ 1 s,
 * và SAU huỷ không còn lưu lượng nào tới fake (không lượt lùi, không preflight), không sự kiện G1-D giả.
 * Chỉ mock thứ KHÔNG thuộc câu hỏi: danh tính phiên, kế hoạch gateway, audit, DB, và — riêng tuyến
 * local-kb — `streamAnswer` (RAG/tool/DB) được thay bằng một generator gọi ĐÚNG `generateTextStream`
 * thật với `execCtx.signal`, tức đo phần dây của TUYẾN; phần dây của service (`generateWithOllamaStream`
 * → `ggufStream` đối số 3) đo ở `aiLocalKnowledgeService.huyKbQa.test.ts`.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";

vi.mock("./_xacThucRest", async (goc) => {
  const that = await goc<typeof import("./_xacThucRest")>();
  return {
    ...that,
    // ⚠ Xác thực giả phải mất ÍT NHẤT một macrotask (như phiên/DB thật, vài ms), KHÔNG chỉ một microtask:
    //   `req` phát `close` ở tick kế tiếp sau khi thân đã đọc (~1 ms). Với mock trả về tức thì, chỗ gắn
    //   `req.on("close")` của đột biến có lúc kịp TRƯỚC sự kiện ấy ⇒ đột biến "xanh" ngẫu nhiên (đo 2/3
    //   lượt trên local-kb trong final wave). 5 ms tái hiện đúng điều review đo: gắn sau `await` ⇒ đã lỡ.
    thuXacThucRest: async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { ok: true, user: { id: 1, role: "admin", name: "Admin" } };
    },
  };
});
vi.mock("../services/aiGgufEngine", async (goc) => {
  const that = await goc<typeof import("../services/aiGgufEngine")>();
  return { ...that, isGgufAvailable: vi.fn(async () => true), warmModel: vi.fn(async () => true) };
});
vi.mock("../services/aiGateway", async (goc) => {
  const that = await goc<typeof import("../services/aiGateway")>();
  return {
    ...that,
    planInference: vi.fn(async (o: { text?: string }) => ({
      decision: { modelId: "m" },
      abVariant: null,
      record: vi.fn(),
      safeText: o?.text ?? "",
      safetyFlags: { injectionRisk: "none", redactions: 0 },
      sanitizeOutput: (t: string) => t,
    })),
  };
});
vi.mock("../services/aiLocalKnowledgeService", () => ({
  answerQuestion: vi.fn(),
  getKbHealth: vi.fn(async () => ({})),
  reloadKbArtifacts: vi.fn(),
  retrieveKnowledge: vi.fn(),
  warmUpOllamaModels: vi.fn(),
  // Thay RAG/tool/DB bằng đúng một lượt model THẬT mang `execCtx.signal` — như nhánh vận hành thật làm
  // sau final wave (`generateWithOllamaStream(…, execCtx?.signal)` → `ggufStream(…, signal)`).
  streamAnswer: async function* (question: string, _k: unknown, _h: unknown, _r: unknown, _c: unknown, execCtx?: { signal?: AbortSignal }) {
    yield { type: "meta", intent: "howto", language: "vi", confidence: 0.5, citations: [] };
    const eng = await import("../services/aiGgufEngine");
    let full = "";
    for await (const c of eng.generateTextStream({ prompt: question, maxTokens: 64 }, undefined, execCtx?.signal)) {
      if (c.type === "token" && typeof c.token === "string" && c.token) {
        full += c.token;
        yield { type: "token", token: c.token };
      }
    }
    yield { type: "done", answer: full, provider: "ollama", cached: false, followUpSuggestions: [] };
  },
}));
vi.mock("../services/auditTrailService", () => ({ logCrudOperation: vi.fn(async () => ({ id: 1 })) }));
vi.mock("../db/connection", () => ({ getDb: async () => undefined }));

import { registerAiStreamingRoutes } from "./aiStreamingApi";
import { registerAiLocalKnowledgeRoutes } from "./aiLocalKnowledgeApi";
import { registerOpenAiGateway } from "./openaiGateway";

// ─── llama-server GIẢ: mọi lượt "treo" IM LẶNG (không một byte thân nào) cho tới khi bên gọi ĐÓNG ──
// ⚠⚠ Fake phải IM LẶNG trong lúc "nghĩ", KHÔNG phát `reasoning_content` mỗi 40 ms như fake của Task 8.
//   Đo trong final wave (đột biến `req.on("close")` trên cả 5 tuyến): với fake "nói" mỗi 40 ms, ba tuyến
//   generate/chat/gateway vẫn XANH vì vòng `for await` của chúng có `if (res.destroyed) break;` — mảnh
//   kế tiếp cứu chúng trong 40 ms, còn đường HUỶ thật sự (signal → fetch) không hề chạy. Với fake im
//   lặng (đúng ca "model bí, mảnh kế tiếp không bao giờ tới" của review), đột biến ĐỎ ở cả năm tuyến và
//   bản vá xanh ở cả năm (3–23 ms). Một fake nói nhiều là một thiết bị đo tự cho điểm.
interface LuotModel { tMo: number; tDong?: number; stream: boolean }
const fake = { luot: [] as LuotModel[], health: [] as number[] };
let fakeSrv: http.Server;
let appSrv: http.Server;
let base = "";
const API_KEY = "final-wave-key";
const ENV_KEYS = [
  "LLAMA_SERVER_ENABLED", "LLAMA_SERVER_URL", "LLAMA_SERVER_MODEL", "GGUF_DEFAULT_MODEL",
  "OPENAI_GATEWAY_ENABLED", "OPENAI_GATEWAY_API_KEY", "OPENAI_GATEWAY_PATH", "SERVICE_MTLS_ENABLED",
] as const;
const envCu: Record<string, string | undefined> = {};

beforeAll(async () => {
  fakeSrv = http.createServer((req, res) => {
    if (req.url === "/health") {
      fake.health.push(Date.now());
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"status":"ok"}');
      return;
    }
    if (req.url === "/v1/chat/completions" && req.method === "POST") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = JSON.parse(raw);
        const luot: LuotModel = { tMo: Date.now(), stream: !!body.stream };
        fake.luot.push(luot);
        // Đúng mẫu đang được kiểm: `res.on("close")` + `!writableFinished` (xem programmingCopilotStream.test.ts).
        res.on("close", () => {
          if (!res.writableFinished) luot.tDong = Date.now();
        });
        res.writeHead(200, { "content-type": "text/event-stream" });
        // …và rồi IM LẶNG: model đang "nghĩ", không có mảnh nào cho tới khi kết nối bị đóng.
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => fakeSrv.listen(0, "127.0.0.1", r));
  const fakePort = (fakeSrv.address() as AddressInfo).port;

  for (const k of ENV_KEYS) envCu[k] = process.env[k];
  process.env.LLAMA_SERVER_ENABLED = "true";
  process.env.LLAMA_SERVER_URL = `http://127.0.0.1:${fakePort}`;
  process.env.LLAMA_SERVER_MODEL = "fake-deep.gguf";
  process.env.GGUF_DEFAULT_MODEL = "fake-deep.gguf"; // modelId vắng ⇒ "model mặc định" = model server đang giữ
  process.env.OPENAI_GATEWAY_ENABLED = "true";
  process.env.OPENAI_GATEWAY_API_KEY = API_KEY;
  delete process.env.OPENAI_GATEWAY_PATH;
  delete process.env.SERVICE_MTLS_ENABLED;

  const app = express();
  app.use(express.json({ limit: "20mb" }));
  registerAiStreamingRoutes(app);
  registerAiLocalKnowledgeRoutes(app);
  expect(registerOpenAiGateway(app), "gateway phải gắn được (cờ + khoá đã đặt)").toBe(true);
  appSrv = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => appSrv.once("listening", () => r()));
  base = `http://127.0.0.1:${(appSrv.address() as AddressInfo).port}`;
});

afterAll(async () => {
  appSrv.closeAllConnections?.();
  await new Promise<void>((r) => appSrv.close(() => r()));
  fakeSrv.closeAllConnections?.();
  await new Promise<void>((r) => fakeSrv.close(() => r()));
  for (const k of ENV_KEYS) {
    if (envCu[k] === undefined) delete process.env[k];
    else process.env[k] = envCu[k];
  }
});

let loiConsole: string[] = [];
beforeEach(() => {
  fake.luot = [];
  fake.health = [];
  loiConsole = [];
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    loiConsole.push(a.map(String).join(" "));
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function cho(dk: () => boolean, ms: number): Promise<boolean> {
  const het = Date.now() + ms;
  while (Date.now() < het) {
    if (dk()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return dk();
}

interface TuyenSse {
  ten: string;
  duong: string;
  body: unknown;
  headers?: Record<string, string>;
}

const TUYEN: TuyenSse[] = [
  { ten: "POST /api/ai/stream/generate", duong: "/api/ai/stream/generate", body: { prompt: "explain the andon board" } },
  { ten: "POST /api/ai/stream/chat", duong: "/api/ai/stream/chat", body: { messages: [{ role: "user", content: "hello" }] } },
  { ten: "POST /api/ai/stream/narrative", duong: "/api/ai/stream/narrative", body: { prompt: "write an executive summary" } },
  { ten: "POST /api/ai/local-kb/stream", duong: "/api/ai/local-kb/stream", body: { question: "how do I acknowledge an alert?" } },
  {
    ten: "POST /v1/chat/completions (stream:true)",
    duong: "/v1/chat/completions",
    body: { model: "chat", stream: true, messages: [{ role: "user", content: "hello" }] },
    headers: { Authorization: `Bearer ${API_KEY}` },
  },
];

describe("final wave item 2 — client huỷ giữa lượt ⇒ llama-server GIẢ thấy kết nối ĐÓNG ≤ 1 s, không lưu lượng sau huỷ", () => {
  for (const t of TUYEN) {
    it(`★★ ${t.ten}`, async () => {
      const boHuy = new AbortController();
      const p = fetch(`${base}${t.duong}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(t.headers ?? {}) },
        body: JSON.stringify(t.body),
        signal: boHuy.signal,
      }).catch(() => null);

      // Lượt model đã tới fake và đang "nghĩ" — KHÔNG được bị đóng trước khi client huỷ
      // (một bản `req.on("close")` gắn KỊP sự kiện sớm của Node 24 sẽ huỷ ngay lượt vừa bắt đầu ⇒ đỏ ở đây).
      expect(await cho(() => fake.luot.length === 1, 4000), "lượt model không tới llama-server giả").toBe(true);
      await new Promise((r) => setTimeout(r, 150));
      expect(fake.luot[0].tDong, "lượt bị đóng TRƯỚC khi client huỷ").toBeUndefined();

      const tHuy = Date.now();
      boHuy.abort();
      await p;
      expect(await cho(() => fake.luot[0].tDong !== undefined, 3000), "llama-server giả KHÔNG thấy kết nối bị đóng").toBe(true);
      expect(fake.luot[0].tDong! - tHuy).toBeLessThanOrEqual(1000);

      // Sau huỷ: không lượt lùi in-process/lượt mới, không preflight, không sự kiện G1-D giả.
      await new Promise((r) => setTimeout(r, 400));
      expect(fake.luot, "sau huỷ KHÔNG được có lượt model nào nữa").toHaveLength(1);
      expect(fake.health.filter((x) => x >= tHuy), "sau huỷ vẫn còn lưu lượng tới llama-server").toEqual([]);
      expect(loiConsole.filter((l) => /TỪ CHỐI TRUNG THỰC|lui_in_process_bi_chan/.test(l))).toEqual([]);
    }, 15_000);
  }

  it("đối chứng: không huỷ ⇒ lượt model vẫn mở (fake không thấy đóng) — phép đo không tự ĐỎ/XANH", async () => {
    const boHuy = new AbortController();
    const p = fetch(`${base}/api/ai/stream/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
      signal: boHuy.signal,
    }).catch(() => null);
    expect(await cho(() => fake.luot.length === 1, 4000)).toBe(true);
    await new Promise((r) => setTimeout(r, 600));
    expect(fake.luot[0].tDong).toBeUndefined();
    boHuy.abort();
    await p;
    await cho(() => fake.luot[0].tDong !== undefined, 3000);
  });
});
