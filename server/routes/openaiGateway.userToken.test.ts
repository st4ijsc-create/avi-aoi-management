/**
 * ★★★ Đợt 4A — cổng `/v1` nhận TOKEN THEO NGƯỜI DÙNG (`Authorization: Bearer avgw_…`).
 *
 * Canh, mỗi ô một hợp đồng:
 *   §1 token hợp lệ ⇒ 200, và `planInference` nhận ĐÚNG `userId`/`role` của chủ token (đo lường theo người — trước
 *      đây mọi lượt rơi vào xô "anon");
 *   §2 token sai/hết hạn/thu hồi ⇒ 401 có MÃ riêng; tài khoản tắt / mất quyền AI ⇒ 403; CSDL sập ⇒ 503 (fail-closed);
 *   §3 phạm vi: token chỉ `chat` gọi `/completions` (fim) ⇒ 403 `insufficient_scope`; `/models` mở cho mọi token;
 *   §4 rate-limit THEO TOKEN ⇒ 429 + Retry-After, token khác của cùng người không bị vạ lây;
 *   §5 key chung: cờ BẬT (mặc định) ⇒ vẫn chạy + dấu deprecate; cờ TẮT ⇒ 401 `shared_key_disabled`, token vẫn chạy;
 *      đăng ký cổng: cờ TẮT + không key ⇒ VẪN gắn (chế độ chỉ-token); cờ BẬT + không key ⇒ từ chối như cũ;
 *   §6 CORS: đường `/v1` KHÔNG BAO GIỜ trả `*`; chỉ origin trong `OPENAI_GATEWAY_CORS_ORIGINS` được phản chiếu.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import express from "express";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

vi.mock("../services/aiGgufEngine", () => ({
  isGgufAvailable: vi.fn(async () => true),
  chatCompletion: vi.fn(async () => ({ text: "xin chao", tokensPrompt: 3, tokensGenerated: 2, modelId: "x", totalTimeMs: 1, tokensPerSecond: 1 })),
  generateText: vi.fn(),
  generateFim: vi.fn(async () => ({ text: "  return 1;", tokensPrompt: 3, tokensGenerated: 2, modelId: "x", totalTimeMs: 1, tokensPerSecond: 1 })),
  generateEmbedding: vi.fn(async () => ({ embedding: [0.1], dimensions: 1, modelId: "embed" })),
  generateEmbeddings: vi.fn(async () => ({ embeddings: [[0.1]], dimensions: 1, modelId: "embed" })),
  chatCompletionStream: async function* () {},
  generateTextStream: async function* () {},
}));

const getDbMock = vi.fn();
vi.mock("../db/connection", () => ({ getDb: (...a: unknown[]) => getDbMock(...a) }));

const planSpy = vi.fn();
vi.mock("../services/aiGateway", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../services/aiGateway")>();
  return {
    ...goc,
    planInference: (req: Parameters<typeof goc.planInference>[0]) => {
      planSpy(req);
      return goc.planInference(req);
    },
  };
});

import { createOpenAiGatewayRouter, registerOpenAiGateway, xuLyCorsCongOpenAi } from "./openaiGateway";
import type { KetQuaXacThucToken } from "../db/aiGatewayTokens";

const T_CHAT_FIM = "avgw_" + "A".repeat(43);
const T_CHAT = "avgw_" + "B".repeat(43);
const T_HET_HAN = "avgw_" + "C".repeat(43);
const T_THU_HOI = "avgw_" + "D".repeat(43);
const T_TAT = "avgw_" + "E".repeat(43);
const T_CSDL = "avgw_" + "F".repeat(43);
const T_KHONG_QUYEN = "avgw_" + "G".repeat(43);
const T_RPM = "avgw_" + "H".repeat(43);

const BANG: Record<string, KetQuaXacThucToken> = {
  [T_CHAT_FIM]: { ok: true, tokenId: 11, userId: 501, role: "engineer", name: "KS A", phamVi: ["chat", "fim"], ten: "vscode" },
  [T_CHAT]: { ok: true, tokenId: 12, userId: 501, role: "engineer", name: "KS A", phamVi: ["chat"], ten: "chat-only" },
  [T_HET_HAN]: { ok: false, ma: "het-han" },
  [T_THU_HOI]: { ok: false, ma: "thu-hoi" },
  [T_TAT]: { ok: false, ma: "tai-khoan-tat" },
  [T_CSDL]: { ok: false, ma: "csdl" },
  [T_KHONG_QUYEN]: { ok: true, tokenId: 13, userId: 777, role: "viewer", name: null, phamVi: ["chat"], ten: "x" },
  [T_RPM]: { ok: true, tokenId: 14, userId: 501, role: "engineer", name: "KS A", phamVi: ["chat", "fim"], ten: "rpm" },
};
const xacThucToken = vi.fn(async (t: string): Promise<KetQuaXacThucToken> => BANG[t] ?? { ok: false, ma: "khong-hop-le" });
const coQuyenAi = vi.fn(async (userId: number) => userId !== 777);
const ghiDung = vi.fn();

const KEY_CHUNG = "KEY-CHUNG-CU";

async function serve(app: express.Express): Promise<{ url: string; server: Server }> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}
const dong = (s: { server: Server }) => new Promise<void>((r) => s.server.close(() => r()));

let cong: { url: string; server: Server };
const ENV = ["OPENAI_GATEWAY_SHARED_KEY_ENABLED", "OPENAI_GATEWAY_TOKEN_RPM", "OPENAI_GATEWAY_ENABLED", "OPENAI_GATEWAY_API_KEY", "OPENAI_GATEWAY_PATH", "OPENAI_GATEWAY_CORS_ORIGINS"] as const;
const luu: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of ENV) luu[k] = process.env[k];
  const app = express();
  app.use("/v1", createOpenAiGatewayRouter({ apiKey: KEY_CHUNG, xacThucToken, coQuyenAi, ghiDung }));
  cong = await serve(app);
});
afterAll(async () => {
  await dong(cong);
  for (const k of ENV) {
    if (luu[k] === undefined) delete process.env[k];
    else process.env[k] = luu[k];
  }
});
beforeEach(() => {
  vi.clearAllMocks();
  getDbMock.mockResolvedValue(null);
  delete process.env.OPENAI_GATEWAY_SHARED_KEY_ENABLED;
  delete process.env.OPENAI_GATEWAY_TOKEN_RPM;
});
afterEach(() => vi.restoreAllMocks());

const chat = (token: string, url = cong.url) =>
  fetch(`${url}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
  });
const fim = (token: string) =>
  fetch(`${cong.url}/v1/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "function f() {", suffix: "}" }),
  });

describe("§1 token hợp lệ ⇒ phục vụ, userId vào đo lường", () => {
  it("chat: 200, planInference nhận userId + role của CHỦ token; ghi lần dùng cuối", async () => {
    const r = await chat(T_CHAT_FIM);
    expect(r.status).toBe(200);
    expect((await r.json()).choices[0].message.content).toBe("xin chao");
    expect(planSpy).toHaveBeenCalledTimes(1);
    expect(planSpy.mock.calls[0][0]).toMatchObject({ userId: 501, role: "engineer" });
    expect(ghiDung).toHaveBeenCalledWith(11);
    expect(coQuyenAi).toHaveBeenCalledWith(501, "engineer");
  });

  it("fim: 200, planInference task fim nhận userId", async () => {
    const r = await fim(T_CHAT_FIM);
    expect(r.status).toBe(200);
    expect(planSpy.mock.calls[0][0]).toMatchObject({ task: "fim", userId: 501 });
  });

  it("key chung ⇒ KHÔNG có userId (đối chứng: không bịa người)", async () => {
    const r = await chat(KEY_CHUNG);
    expect(r.status).toBe(200);
    expect(planSpy.mock.calls[0][0].userId).toBeUndefined();
  });
});

describe("§2 từ chối có mã", () => {
  const ca: Array<[string, string, number, string]> = [
    ["sai", "avgw_" + "Z".repeat(43), 401, "invalid_api_key"],
    ["hết hạn", T_HET_HAN, 401, "token_expired"],
    ["thu hồi", T_THU_HOI, 401, "token_revoked"],
    ["tài khoản tắt", T_TAT, 403, "account_disabled"],
    ["CSDL sập", T_CSDL, 503, "auth_backend_unavailable"],
    ["mất quyền AI", T_KHONG_QUYEN, 403, "permission_denied"],
  ];
  for (const [ten, token, ma, code] of ca) {
    it(`${ten} ⇒ ${ma} ${code}, engine KHÔNG chạy`, async () => {
      const r = await chat(token);
      expect(r.status).toBe(ma);
      expect((await r.json()).error.code).toBe(code);
      expect(planSpy).not.toHaveBeenCalled();
    });
  }
  it("không Bearer ⇒ 401", async () => {
    const r = await fetch(`${cong.url}/v1/models`);
    expect(r.status).toBe(401);
  });
});

describe("§3 phạm vi theo đường", () => {
  it("token chỉ `chat` gọi FIM ⇒ 403 insufficient_scope; gọi embeddings ⇒ 403", async () => {
    const r = await fim(T_CHAT);
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe("insufficient_scope");
    const e = await fetch(`${cong.url}/v1/embeddings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${T_CHAT_FIM}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input: "x" }),
    });
    expect(e.status).toBe(403);
  });
  it("`/models` mở cho mọi token hợp lệ", async () => {
    const r = await fetch(`${cong.url}/v1/models`, { headers: { Authorization: `Bearer ${T_CHAT}` } });
    expect(r.status).toBe(200);
  });
});

describe("§4 rate-limit THEO TOKEN", () => {
  it("vượt trần/phút ⇒ 429 rate_limit_exceeded + Retry-After; token khác cùng người vẫn qua", async () => {
    process.env.OPENAI_GATEWAY_TOKEN_RPM = "2";
    expect((await fetch(`${cong.url}/v1/models`, { headers: { Authorization: `Bearer ${T_RPM}` } })).status).toBe(200);
    expect((await fetch(`${cong.url}/v1/models`, { headers: { Authorization: `Bearer ${T_RPM}` } })).status).toBe(200);
    const r = await fetch(`${cong.url}/v1/models`, { headers: { Authorization: `Bearer ${T_RPM}` } });
    expect(r.status).toBe(429);
    expect((await r.json()).error.code).toBe("rate_limit_exceeded");
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await fetch(`${cong.url}/v1/models`, { headers: { Authorization: `Bearer ${T_CHAT}` } })).status).toBe(200);
  });
});

describe("§5 key chung — tương thích + deprecate", () => {
  it("cờ VẮNG (mặc định) ⇒ key chung chạy, kèm dấu Deprecation", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await chat(KEY_CHUNG);
    expect(r.status).toBe(200);
    expect(r.headers.get("deprecation")).toBe("true");
    warn.mockRestore();
  });
  it("cờ TẮT ⇒ key chung 401 shared_key_disabled; token người dùng vẫn chạy", async () => {
    process.env.OPENAI_GATEWAY_SHARED_KEY_ENABLED = "0";
    const r = await chat(KEY_CHUNG);
    expect(r.status).toBe(401);
    expect((await r.json()).error.code).toBe("shared_key_disabled");
    expect((await chat(T_CHAT_FIM)).status).toBe(200);
  });
  it("đăng ký: cờ TẮT + không key ⇒ VẪN gắn (chỉ-token); cờ BẬT + không key ⇒ từ chối như cũ", async () => {
    process.env.OPENAI_GATEWAY_ENABLED = "true";
    process.env.OPENAI_GATEWAY_API_KEY = "";
    delete process.env.OPENAI_GATEWAY_PATH;
    process.env.OPENAI_GATEWAY_SHARED_KEY_ENABLED = "0";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(registerOpenAiGateway(express())).toBe(true);
    delete process.env.OPENAI_GATEWAY_SHARED_KEY_ENABLED;
    expect(registerOpenAiGateway(express())).toBe(false);
    expect(err).toHaveBeenCalled();
    log.mockRestore();
    err.mockRestore();
  });
});

describe("§6 CORS của đường /v1 — không bao giờ `*`", () => {
  let mo: { url: string; server: Server };
  beforeAll(async () => {
    // Mô phỏng đúng chỗ gọi ở `_core/index.ts`: bộ CORS chung đặt `*` cho yêu cầu không Origin — trừ khi cổng nhận trước.
    const app = express();
    app.use((req, res, next) => {
      const kq = xuLyCorsCongOpenAi(req, res);
      if (kq === "da-xu-ly") return;
      if (kq === "tiep") return next();
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
      if (req.method === "OPTIONS") return void res.status(204).end();
      next();
    });
    app.use("/v1", createOpenAiGatewayRouter({ apiKey: KEY_CHUNG, xacThucToken, coQuyenAi, ghiDung }));
    app.get("/khac", (_q, r) => void r.json({ ok: true }));
    mo = await serve(app);
  });
  afterAll(async () => dong(mo));
  beforeEach(() => {
    process.env.OPENAI_GATEWAY_ENABLED = "true";
    delete process.env.OPENAI_GATEWAY_PATH;
    process.env.OPENAI_GATEWAY_CORS_ORIGINS = "https://ide.noi-bo.vn";
  });

  it("không Origin (extension host Node) ⇒ không có header ACAO nào", async () => {
    const r = await fetch(`${mo.url}/v1/models`, { headers: { Authorization: `Bearer ${T_CHAT}` } });
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
  });
  it("Origin lạ ⇒ không phản chiếu; preflight ⇒ 403", async () => {
    const r = await fetch(`${mo.url}/v1/models`, { headers: { Authorization: `Bearer ${T_CHAT}`, Origin: "https://ac-y.example" } });
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
    const p = await fetch(`${mo.url}/v1/chat/completions`, { method: "OPTIONS", headers: { Origin: "https://ac-y.example" } });
    expect(p.status).toBe(403);
    expect(p.headers.get("access-control-allow-origin")).toBeNull();
  });
  it("Origin đã cấu hình ⇒ phản chiếu đúng origin, KHÔNG Allow-Credentials; preflight 204", async () => {
    const p = await fetch(`${mo.url}/v1/chat/completions`, { method: "OPTIONS", headers: { Origin: "https://ide.noi-bo.vn" } });
    expect(p.status).toBe(204);
    expect(p.headers.get("access-control-allow-origin")).toBe("https://ide.noi-bo.vn");
    expect(p.headers.get("access-control-allow-credentials")).toBeNull();
    expect(p.headers.get("access-control-allow-headers")).toMatch(/authorization/i);
  });
  it("đường ngoài /v1 ⇒ bộ CORS chung giữ nguyên (đối chứng chống vá quá tay)", async () => {
    const r = await fetch(`${mo.url}/khac`);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
  });
  it("cổng TẮT ⇒ không chạm CORS của ai (hành vi cũ từng bit)", async () => {
    delete process.env.OPENAI_GATEWAY_ENABLED;
    const r = await fetch(`${mo.url}/v1/models`, { headers: { Authorization: `Bearer ${T_CHAT}` } });
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
  });
  it("★ `_core/index.ts` gọi `xuLyCorsCongOpenAi` TRƯỚC khi đặt `*` (đọc mã nguồn)", () => {
    const goc = join(dirname(fileURLToPath(import.meta.url)), "..", "_core", "index.ts");
    const ma = readFileSync(goc, "utf8");
    const iCong = ma.indexOf("xuLyCorsCongOpenAi(req, res)");
    const iSao = ma.indexOf('res.setHeader("Access-Control-Allow-Origin", "*")');
    expect(iCong).toBeGreaterThan(0);
    expect(iSao).toBeGreaterThan(iCong);
  });
});

/**
 * ★★★ Rà bảo mật de591c868 — phát hiện 1 (authorization-bypass): Express khớp tuyến KHÔNG phân biệt hoa/thường
 * (`caseSensitive: false` mặc định) nhưng `phamViCuaDuong` so CHÍNH XÁC chữ thường ⇒ `/v1/Completions`,
 * `/v1/EMBEDDINGS` rơi vào `"khong-ro"` ⇒ middleware bỏ qua kiểm phạm vi ⇒ handler thật vẫn chạy. Một token chỉ
 * `chat` (hay token thiết bị chỉ `chat/fim`) gọi được mọi đường của cổng. Cùng gốc: `xuLyCorsCongOpenAi` so `/v1` phân
 * biệt hoa/thường ⇒ `/V1/...` rơi về bộ CORS chung (`*` / phản chiếu kèm credentials).
 */
describe("§7 phạm vi KHÔNG lách được bằng hoa/thường của đường (rà bảo mật de591c868 #1)", () => {
  const goi = (duong: string, token: string, than: unknown) =>
    fetch(`${cong.url}/v1${duong}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(than),
    });

  it("token chỉ `chat` gọi `/v1/Completions` (FIM) ⇒ 403 insufficient_scope, engine KHÔNG chạy", async () => {
    const r = await goi("/Completions", T_CHAT, { prompt: "function f() {", suffix: "}" });
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe("insufficient_scope");
    expect(planSpy).not.toHaveBeenCalled();
  });
  it("token `chat+fim` gọi `/v1/EMBEDDINGS` và `/v1/Embeddings/` ⇒ 403", async () => {
    for (const d of ["/EMBEDDINGS", "/Embeddings/"]) {
      const r = await goi(d, T_CHAT_FIM, { input: "x" });
      expect(r.status).toBe(403);
      expect((await r.json()).error.code).toBe("insufficient_scope");
    }
  });
  it("token chỉ `chat` vẫn gọi được `/v1/Chat/Completions` (đối chứng: chuẩn hoá không làm GÃY đường hợp lệ)", async () => {
    const r = await goi("/Chat/Completions", T_CHAT, { messages: [{ role: "user", content: "hi" }] });
    expect(r.status).toBe(200);
  });
  it("đường lạ với token người dùng ⇒ 404 NGAY ở cửa xác thực (fail-closed cho đường mới chưa khai phạm vi)", async () => {
    const r = await goi("/responses", T_CHAT_FIM, {});
    expect(r.status).toBe(404);
    expect(planSpy).not.toHaveBeenCalled();
  });
  it("CORS: `/V1/models` (hoa) vẫn đi bộ CORS RIÊNG — không bao giờ `*`", () => {
    process.env.OPENAI_GATEWAY_ENABLED = "true";
    delete process.env.OPENAI_GATEWAY_PATH;
    process.env.OPENAI_GATEWAY_CORS_ORIGINS = "";
    const headers: Record<string, string> = {};
    const res = { setHeader: (k: string, v: string) => void (headers[k] = v), status: () => ({ end: () => {} }) };
    const kq = xuLyCorsCongOpenAi({ path: "/V1/models", method: "GET", headers: {} } as never, res as never);
    expect(kq).toBe("tiep");
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});
