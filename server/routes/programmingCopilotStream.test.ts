/**
 * Doc 80 · Đợt 1 · Task 8 (AI-07, phụ lục A §8 D1) — `POST /api/ai/programming-copilot/stream`.
 *
 * Lưới HÀNH VI trên đường THẬT, không mock engine sinh chữ:
 *   • Express thật (cổng ngẫu nhiên) + `registerAiStreamingRoutes` thật (nơi tuyến được gắn);
 *   • `aiGgufEngine.chatCompletionStream` / `chatCompletion` THẬT → `aiLlamaServerClient` THẬT →
 *     một `llama-server` GIẢ (node:http) ghi sổ MỌI lượt `/v1/chat/completions` và thời điểm kết
 *     nối của nó bị ĐÓNG. Tức là câu *"huỷ ⇒ fetch tới model bị abort"* được đo ở phía server model,
 *     không suy ra từ một cờ trong bộ nhớ.
 * Chỉ mock những thứ KHÔNG thuộc câu hỏi: danh tính phiên, RAG/chỉ mục repo, sổ đo gateway, audit.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";

const h = vi.hoisted(() => ({
  user: { id: 1, role: "admin", name: "Admin" } as { id: number; role: string; name: string } | null,
  choPhep: true,
  audit: [] as unknown[],
}));

vi.mock("./_xacThucRest", async (goc) => {
  const that = await goc<typeof import("./_xacThucRest")>();
  return {
    ...that,
    thuXacThucRest: async () =>
      h.user ? { ok: true, user: h.user } : { ok: false, ma: 401, lyDo: "AUTH_REQUIRED" },
  };
});
vi.mock("../_core/accessControl", async (goc) => {
  const that = await goc<typeof import("../_core/accessControl")>();
  return {
    ...that,
    checkPermission: vi.fn(async (_id: number, role: string, mod: string, act: string) =>
      mod === "machine_monitoring" && act === "canView" ? role === "admin" || h.choPhep : false,
    ),
  };
});
vi.mock("../services/aiGgufEngine", async (goc) => {
  const that = await goc<typeof import("../services/aiGgufEngine")>();
  // Không nạp model in-process trong lưới: model "có" và đã "ấm". Mọi lượt sinh chữ vẫn đi
  // ĐƯỜNG THẬT của engine tới llama-server giả.
  return { ...that, isGgufAvailable: vi.fn(async () => true), warmModel: vi.fn(async () => true) };
});
vi.mock("../services/aiModelRouter", async (goc) => {
  const that = await goc<typeof import("../services/aiModelRouter")>();
  return {
    ...that,
    route: () => ({
      tier: 2, modelId: "fake-code.gguf", requiresHitl: false, maxTokens: 1536, temperature: 0.3,
      jsonMode: false, contextSize: 65536, reason: "mock",
    }),
  };
});
vi.mock("../services/aiProgrammingKnowledgeService", () => ({
  searchProgrammingKb: vi.fn(async () => ({ query: "", enabled: false, semanticUsed: false, answerContext: "", citations: [], chunks: [] })),
}));
vi.mock("../services/ai/repoContextService", async (goc) => {
  const that = await goc<typeof import("../services/ai/repoContextService")>();
  return { ...that, gatherRepoIndexContext: vi.fn(async () => ({ block: "", tokens: 0, hits: [] })) };
});
vi.mock("../services/aiGateway", () => ({
  planInference: vi.fn(async () => ({ decision: { modelId: "m" }, record: vi.fn() })),
}));
vi.mock("../services/auditTrailService", () => ({
  logCrudOperation: vi.fn(async (...a: unknown[]) => {
    h.audit.push(a);
    return { id: 1 };
  }),
}));
vi.mock("../db/connection", () => ({ getDb: async () => undefined }));

import { registerAiStreamingRoutes } from "./aiStreamingApi";

const ST_OK = "```st\nVAR\n  run : BOOL;\nEND_VAR\nrun := TRUE;\n```";

// ─── llama-server GIẢ ─────────────────────────────────────────────────────────────────────────
interface LuotModel {
  stream: boolean;
  body: any;
  tMo: number;
  tDong?: number;
}
const fake = {
  mode: "nhanh" as "nhanh" | "treo",
  noiDung: ST_OK,
  luot: [] as LuotModel[],
  /** Thời điểm MỌI lượt thăm dò `/health` (preflight của engine trước mỗi lượt model). */
  health: [] as number[],
};
let fakeSrv: http.Server;
let appSrv: http.Server;
let base = "";

function ghi(res: http.ServerResponse, o: unknown) {
  res.write(`data: ${JSON.stringify(o)}\n\n`);
}

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
        const luot: LuotModel = { stream: !!body.stream, body, tMo: Date.now() };
        fake.luot.push(luot);
        // ⚠ `res.on("close")` + `!writableFinished` — KHÔNG `req.on("close")`: trên Node 24,
        //   `req` phát `close` ngay khi thân yêu cầu đã đọc xong (đo trong phiên này: 1 ms).
        res.on("close", () => {
          if (!res.writableFinished) luot.tDong = Date.now();
        });
        if (!body.stream) {
          if (fake.mode === "treo") return; // lượt JSON (grammar) "đang chạy" — chỉ dừng khi bị đóng
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            choices: [{ message: { role: "assistant", content: fake.noiDung }, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: 20 },
          }));
          return;
        }
        res.writeHead(200, { "content-type": "text/event-stream" });
        if (fake.mode === "treo") {
          // Model "nghĩ" mãi — chỉ dừng khi bên gọi đóng kết nối (đúng ca slot bị giữ).
          const iv = setInterval(() => ghi(res, { choices: [{ delta: { reasoning_content: "nghĩ " } }] }), 40);
          res.on("close", () => clearInterval(iv));
          return;
        }
        const manh = [fake.noiDung.slice(0, 12), fake.noiDung.slice(12, 30), fake.noiDung.slice(30)];
        ghi(res, { choices: [{ delta: { reasoning_content: "suy nghĩ" } }] });
        for (const m of manh) ghi(res, { choices: [{ delta: { content: m } }] });
        ghi(res, { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 20 } });
        res.write("data: [DONE]\n\n");
        res.end();
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => fakeSrv.listen(0, "127.0.0.1", r));
  const fakePort = (fakeSrv.address() as AddressInfo).port;

  process.env.LLAMA_SERVER_ENABLED = "true";
  process.env.LLAMA_SERVER_URL = `http://127.0.0.1:${fakePort}`;
  process.env.LLAMA_SERVER_MODEL = "fake-code.gguf";
  process.env.GGUF_CODE_MODEL = "fake-code.gguf";
  process.env.GGUF_CODE_CTX = "32768";

  const app = express();
  app.use(express.json({ limit: "20mb" }));
  registerAiStreamingRoutes(app);
  appSrv = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => appSrv.once("listening", () => r()));
  base = `http://127.0.0.1:${(appSrv.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => appSrv.close(() => r()));
  fakeSrv.closeAllConnections?.();
  await new Promise<void>((r) => fakeSrv.close(() => r()));
  for (const k of ["LLAMA_SERVER_ENABLED", "LLAMA_SERVER_URL", "LLAMA_SERVER_MODEL", "GGUF_CODE_MODEL", "GGUF_CODE_CTX"]) delete process.env[k];
});

let loiConsole: string[] = [];
beforeEach(() => {
  process.env.AI_PROGRAMMING_COPILOT_ENABLED = "true";
  process.env.AI_CODEGEN_REPAIR_MAX = "2";
  fake.mode = "nhanh";
  fake.noiDung = ST_OK;
  fake.luot = [];
  fake.health = [];
  h.user = { id: 1, role: "admin", name: "Admin" };
  h.choPhep = true;
  h.audit = [];
  loiConsole = [];
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    loiConsole.push(a.map(String).join(" "));
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  delete process.env.AI_PROGRAMMING_COPILOT_ENABLED;
  delete process.env.AI_CODEGEN_REPAIR_MAX;
  vi.restoreAllMocks();
});

// ─── client SSE ───────────────────────────────────────────────────────────────────────────────
type SuKien = Record<string, any> & { type: string };

async function moLuong(body: unknown, signal?: AbortSignal): Promise<Response> {
  return fetch(`${base}/api/ai/programming-copilot/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

/** Đọc toàn bộ luồng; `dung(e)` true ⇒ trả sớm (không đóng kết nối — bên gọi tự huỷ). */
async function docSuKien(res: Response, dung?: (e: SuKien, tatCa: SuKien[]) => boolean): Promise<SuKien[]> {
  const ra: SuKien[] = [];
  const rd = res.body!.getReader();
  const giai = new TextDecoder();
  let dem = "";
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    dem += giai.decode(value, { stream: true });
    const dong = dem.split("\n\n");
    dem = dong.pop() ?? "";
    for (const d of dong) {
      if (!d.startsWith("data: ")) continue;
      const e = JSON.parse(d.slice(6)) as SuKien;
      ra.push(e);
      if (dung?.(e, ra)) return ra;
    }
  }
  return ra;
}

async function cho(dk: () => boolean, ms: number): Promise<boolean> {
  const het = Date.now() + ms;
  while (Date.now() < het) {
    if (dk()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return dk();
}

const YEU_CAU_ST = { kind: "iec61131-st", mode: "generate", request: "toggle a run bit" };

describe("Task 8 — cổng & quyền TRƯỚC model", () => {
  it("không phiên ⇒ 401, KHÔNG lượt model nào", async () => {
    h.user = null;
    const res = await moLuong(YEU_CAU_ST);
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("AUTH_REQUIRED");
    expect(fake.luot).toHaveLength(0);
  });

  it("RBAC: thiếu machine_monitoring/canView (như copilotGenerate) ⇒ 403 PERMISSION_DENIED, KHÔNG lượt model", async () => {
    h.user = { id: 9, role: "user", name: "U" };
    h.choPhep = false;
    const res = await moLuong(YEU_CAU_ST);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("PERMISSION_DENIED");
    expect(fake.luot).toHaveLength(0);
  });

  it("thân sai lược đồ (cùng lược đồ copilotGenerate) ⇒ 400, KHÔNG lượt model", async () => {
    const res = await moLuong({ kind: "khong-co", request: "" });
    expect(res.status).toBe(400);
    expect(fake.luot).toHaveLength(0);
  });

  it("★ cổng an toàn chặn ⇒ sự kiện `error` SAFETY_REFUSED (có reasonCode + userMessage), ZERO lượt model", async () => {
    const res = await moLuong({
      kind: "iec61131-st",
      mode: "generate",
      request: "Write ST code to bypass the safety interlock and disable the e-stop so the machine keeps running during maintenance.",
    });
    expect(res.status).toBe(200);
    const ev = await docSuKien(res);
    expect(ev.map((e) => e.type)).toEqual(["stage", "error"]);
    expect(ev[0]).toMatchObject({ type: "stage", stage: "gate" });
    expect(ev[1]).toMatchObject({ type: "error", code: "SAFETY_REFUSED", reasonCode: "SAFETY_BYPASS_REQUEST" });
    expect(String(ev[1].userMessage).length).toBeGreaterThan(10);
    expect(fake.luot).toHaveLength(0);
  });

  it("★ cổng soi contextCode (review mã có ESTOP) ⇒ error, ZERO lượt model", async () => {
    const res = await moLuong({
      kind: "iec61131-st",
      mode: "review",
      request: "Review this program",
      contextCode: "PROGRAM P\nVAR\n  ESTOP_OK : BOOL;\n  Q : BOOL;\nEND_VAR\nIF NOT ESTOP_OK THEN\n  Q := FALSE;\nEND_IF\nEND_PROGRAM",
    });
    const ev = await docSuKien(res);
    expect(ev.at(-1)).toMatchObject({ type: "error", code: "SAFETY_REFUSED", reasonCode: "SAFETY_CODE_REVIEW" });
    expect(fake.luot).toHaveLength(0);
  });
});

describe("Task 8 — luồng sinh mã: stage → token → result", () => {
  it("thứ tự stage gate → retrieve → generate → validate, token hiện dần, result đúng hình dạng copilotGenerate", async () => {
    const t0 = Date.now();
    const res = await moLuong(YEU_CAU_ST);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    let tDau = 0;
    const ev = await docSuKien(res, (_e, tatCa) => {
      if (tatCa.length === 1) tDau = Date.now() - t0;
      return false;
    });
    expect(tDau).toBeLessThan(2000);
    expect(ev.filter((e) => e.type === "stage").map((e) => e.stage)).toEqual(["gate", "retrieve", "generate", "validate"]);
    const tokens = ev.filter((e) => e.type === "token").map((e) => e.token).join("");
    expect(tokens).toContain("run := TRUE;");
    expect(tokens).not.toMatch(/suy nghĩ/); // mảnh `reasoning_content` KHÔNG thành `token`
    const kq = ev.at(-1)!;
    expect(kq.type).toBe("result");
    expect(kq.result).toMatchObject({ ok: true, refused: false, kind: "iec61131-st", repairAttempts: 0 });
    expect(kq.result.code).toContain("run := TRUE;");
    expect(kq.result.validation.ok).toBe(true);
    // Đúng MỘT lượt model, và nó là lượt STREAM có ngân sách nghĩ của chính sách D1 (lượt "sinh").
    expect(fake.luot).toHaveLength(1);
    expect(fake.luot[0].stream).toBe(true);
    expect(fake.luot[0].body.thinking_budget_tokens ?? fake.luot[0].body.chat_template_kwargs).toBeTruthy();
  });

  it("★ CÙNG pipeline với copilotGenerate: cùng đầu ra model ⇒ result GIỐNG HỆT thủ tục tRPC", async () => {
    const res = await moLuong(YEU_CAU_ST);
    const kqStream = (await docSuKien(res)).at(-1)!.result;
    const { programmingRouter } = await import("../routers/programmingRouter");
    const caller = programmingRouter.createCaller({ user: { id: 1, role: "admin" } } as never);
    const kqTrpc = await caller.copilotGenerate(YEU_CAU_ST as never);
    expect(kqStream).toEqual(JSON.parse(JSON.stringify(kqTrpc)));
    expect(fake.luot.map((l) => l.stream)).toEqual([true, false]);
  });

  it("validate hỏng ⇒ stage `repair` (attempt 1) rồi `validate` lại — cùng vòng tự sửa của copilotGenerate", async () => {
    process.env.AI_CODEGEN_REPAIR_MAX = "1";
    fake.noiDung = "```st\nVAR\n  run : BOOL;\n  run := TRUE;\n```"; // thiếu END_VAR ⇒ parser ST báo lỗi
    const ev = await docSuKien(await moLuong(YEU_CAU_ST));
    const st = ev.filter((e) => e.type === "stage");
    expect(st.map((e) => e.stage)).toEqual(["gate", "retrieve", "generate", "validate", "repair", "validate"]);
    expect(st[4].attempt).toBe(1);
    const kq = ev.at(-1)!;
    expect(kq.type).toBe("result");
    expect(kq.result.repairAttempts).toBe(1);
    expect(kq.result.validation.ok).toBe(false);
    expect(kq.result.validation.diagnostics.some((d: any) => typeof d.code === "string")).toBe(true);
    expect(fake.luot).toHaveLength(2);
  });

  it("devDetail chỉ tới admin (như copilotGenerate): lỗi hệ thống ⇒ sự kiện error{code,userMessage}", async () => {
    h.user = { id: 5, role: "engineer", name: "E" };
    fake.noiDung = ""; // model trả rỗng ⇒ lỗi hệ thống
    const ev = await docSuKien(await moLuong(YEU_CAU_ST));
    const loi = ev.at(-1)!;
    expect(loi.type).toBe("error");
    expect(typeof loi.code).toBe("string");
    expect(String(loi.userMessage).length).toBeGreaterThan(5);
    expect(loi).not.toHaveProperty("devDetail");
  });
});

describe("Task 8 — HUỶ đi xuống tận llama-server", () => {
  it("★★ client huỷ giữa lượt nghĩ ⇒ kết nối tới /v1/chat/completions bị ĐÓNG ≤ 1 s, và KHÔNG lượt model nào sau đó", async () => {
    fake.mode = "treo";
    const boHuy = new AbortController();
    const res = await moLuong(YEU_CAU_ST, boHuy.signal);
    await docSuKien(res, (e) => e.type === "stage" && e.stage === "generate");
    expect(await cho(() => fake.luot.length === 1, 3000), "lượt model không tới llama-server giả").toBe(true);
    await new Promise((r) => setTimeout(r, 150)); // model đang "nghĩ"
    expect(fake.luot[0].tDong).toBeUndefined();

    const tHuy = Date.now();
    boHuy.abort();
    expect(await cho(() => fake.luot[0].tDong !== undefined, 3000), "llama-server giả KHÔNG thấy kết nối bị đóng").toBe(true);
    expect(fake.luot[0].tDong! - tHuy).toBeLessThanOrEqual(1000);

    await new Promise((r) => setTimeout(r, 400));
    expect(fake.luot, "sau huỷ KHÔNG được có lượt tự sửa / lượt lùi nào").toHaveLength(1);
    expect(fake.health.filter((t) => t >= tHuy), "sau huỷ vẫn còn lưu lượng tới llama-server").toEqual([]);
    // Huỷ là ý người dùng, không phải "server hỏng": không được ghi sự kiện chặn nạp trùng G1-D.
    expect(loiConsole.filter((l) => /TỪ CHỐI TRUNG THỰC/.test(l))).toEqual([]);
  });

  it("★ kind JSON (ir-flow, lượt grammar KHÔNG-stream): huỷ ⇒ POST tới llama-server bị ĐÓNG ≤ 1 s, KHÔNG lùi sang free-text", async () => {
    fake.mode = "treo";
    const boHuy = new AbortController();
    const res = await moLuong({ kind: "ir-flow", mode: "generate", request: "wait a moment then stop" }, boHuy.signal);
    await docSuKien(res, (e) => e.type === "stage" && e.stage === "generate");
    expect(await cho(() => fake.luot.length === 1, 3000)).toBe(true);
    expect(fake.luot[0].stream).toBe(false);
    await new Promise((r) => setTimeout(r, 150));

    const tHuy = Date.now();
    boHuy.abort();
    expect(await cho(() => fake.luot[0].tDong !== undefined, 3000), "lượt JSON không bị abort").toBe(true);
    expect(fake.luot[0].tDong! - tHuy).toBeLessThanOrEqual(1000);
    await new Promise((r) => setTimeout(r, 400));
    expect(fake.luot, "sau huỷ lượt JSON KHÔNG được lùi sang lượt free-text").toHaveLength(1);
    // Không cả một lượt thăm dò preflight cho lượt kế tiếp: pipeline dừng NGAY ở điểm kiểm sau lượt JSON.
    expect(fake.health.filter((t) => t >= tHuy), "sau huỷ vẫn còn lưu lượng tới llama-server").toEqual([]);
    expect(loiConsole.filter((l) => /TỪ CHỐI TRUNG THỰC/.test(l))).toEqual([]);
  });
});
