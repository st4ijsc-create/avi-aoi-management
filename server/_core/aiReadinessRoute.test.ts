/**
 * aiReadinessRoute.test.ts — G1-E (2026-08-16): **BẰNG CHỨNG CHO LỖ 2.**
 *
 * Điều được chứng minh ở đây KHÔNG phải "logic đúng" (đó là việc của `aiReadiness.test.ts`) mà là
 * điều đã làm cho lỗ 2 tồn tại: **thứ tự mount**. `/api/health` hôm nay trả 200 + `text/html`
 * 369 KB vì nó KHÔNG PHẢI route — nó rơi vào SPA catch-all `app.use("*")` của `_core/vite.ts`.
 * Mọi câu "health 200 ⇒ hệ thống sống" từng viết vì thế chỉ chứng minh index.html tải được.
 *
 * Bộ test này dựng LẠI đúng hình dạng đó — handler THẬT (`createAiReadinessHandler`, chính hàm mà
 * `_core/index.ts` mount) đứng trước, catch-all SPA đứng sau — rồi bắn HTTP thật vào một cổng thật
 * và khẳng định:
 *   • `/api/health`     → HTML 200 (lỗ CŨ vẫn còn nguyên như thế — có chủ ý, không đổi ngữ nghĩa);
 *   • `/api/health/ai`  → JSON, và mã HTTP nói THẬT khi llama-server chết.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "http";
import { createAiReadinessHandler, type AiReadinessDeps, type LlamaServerProbeResult } from "./aiReadiness";

const ALIVE: LlamaServerProbeResult = {
  reachable: true,
  servedModel: "Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL",
  slots: 2,
  ctxPerSlot: 32768,
};
const DEAD: LlamaServerProbeResult = {
  reachable: false,
  servedModel: null,
  slots: null,
  ctxPerSlot: null,
  error: "connect ECONNREFUSED 127.0.0.1:8091",
};

function baseDeps(over: Partial<AiReadinessDeps> = {}): AiReadinessDeps {
  return {
    env: {
      LLAMA_SERVER_ENABLED: "true",
      LLAMA_SERVER_URL: "http://127.0.0.1:8091",
      LLAMA_SERVER_MODEL: "Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL.gguf",
      GGUF_DEFAULT_MODEL: "Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL.gguf",
      GGUF_EMBED_MODEL: "Qwen3-Embedding-0.6B-f16.gguf",
    } as NodeJS.ProcessEnv,
    timeoutMs: 200,
    checkDb: async () => true,
    probeLlamaServer: async () => ALIVE,
    rerankerStatus: () => ({ enabled: true, mode: "gguf", modelConfigured: true, modelResolved: true, activeBackend: "gguf" }),
    ggufExists: () => true,
    auditTierFlags: async () => [],
    ...over,
  };
}

/**
 * App có HÌNH DẠNG GIỐNG sản xuất: route API trước, SPA catch-all sau (bản sao `_core/vite.ts:61`).
 * `deps` được đọc TẠI THỜI ĐIỂM REQUEST qua một handler-bọc, để mỗi ca test đổi được kịch bản mà
 * không phải dựng lại server.
 */
let server: Server;
let port = 0;
let current: AiReadinessDeps = baseDeps();

beforeAll(async () => {
  const app = express();
  app.get("/api/health/ai", (req, res, next) => createAiReadinessHandler(current)(req, res, next));
  // ↓ CHÍNH LÀ CÁI ĐÃ NUỐT `/api/health` (server/_core/vite.ts, serveStatic)
  app.use("*", (_req, res) => {
    res.status(200).type("html").send("<!doctype html><html lang=\"vi\"><head><title>SYNAPSE</title></head></html>");
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      port = (server.address() as any).port;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function get(path: string) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  const contentType = res.headers.get("content-type") || "";
  const body = contentType.includes("json") ? await res.json() : await res.text();
  return { status: res.status, contentType, body: body as any, cacheControl: res.headers.get("cache-control") };
}

describe("G1-E LỖ 2 — `/api/health` là SPA catch-all, endpoint mới thì KHÔNG", () => {
  it("XÁC MINH LỜI KHAI: `/api/health` trả 200 + text/html (không phải route, không nói gì về AI)", async () => {
    const r = await get("/api/health");
    expect(r.status).toBe(200);
    expect(r.contentType).toContain("text/html");
    expect(String(r.body)).toContain("<!doctype html>");
  });

  it("`/api/health/ai` là ROUTE THẬT: trả JSON, không bị catch-all nuốt", async () => {
    current = baseDeps();
    const r = await get("/api/health/ai");
    expect(r.contentType).toContain("application/json");
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("ok");
    expect(r.body.checks.textGeneration.detail.path).toBe("llama-server");
    expect(r.cacheControl).toBe("no-store"); // giám sát không được ăn bản cache
  });

  it("★ llama-server CHẾT ⇒ HTTP 503 (KHÔNG 200) + câu 'in-process, MẤT PREFIX-CACHE' trong thân JSON", async () => {
    current = baseDeps({ probeLlamaServer: async () => DEAD });
    const r = await get("/api/health/ai");
    expect(r.status).toBe(503);
    expect(r.status).not.toBe(200);
    expect(r.body.checks.llamaServer.status).toBe("down");
    expect(r.body.checks.textGeneration.status).toBe("degraded");
    expect(r.body.checks.textGeneration.reason).toContain("in-process");
    expect(r.body.checks.textGeneration.reason).toContain("PREFIX-CACHE");
    // So sánh trực tiếp với cái cũ: cùng lúc đó `/api/health` VẪN xanh 200 — đó là lỗ.
    expect((await get("/api/health")).status).toBe(200);
  });

  it("chỉ degraded (reranker rơi backend) ⇒ 207 Multi-Status: phép kiểm `== 200` ĐỎ, phép kiểm 2xx vẫn xanh", async () => {
    current = baseDeps({
      rerankerStatus: () => ({ enabled: true, mode: "gguf", modelConfigured: true, modelResolved: false, activeBackend: "llm" }),
    });
    const r = await get("/api/health/ai");
    expect(r.status).toBe(207);
    expect(r.body.status).toBe("degraded");
    expect(r.body.ready).toBe(false);
  });

  it("HEALTH_AI_REQUIRE_LOOPBACK=true vẫn cho loopback đọc (test này chạy từ 127.0.0.1)", async () => {
    current = baseDeps({ env: { ...baseDeps().env, HEALTH_AI_REQUIRE_LOOPBACK: "true" } as NodeJS.ProcessEnv });
    const r = await get("/api/health/ai");
    expect(r.status).toBe(200);
  });

  it("handler tự nó NÉM ⇒ 503, không bao giờ 200 rỗng", async () => {
    // env mà MỌI phép đọc thuộc tính đều ném — mô phỏng một hỏng hóc ngay trong thân handler
    // (trước khi phép đo chạy). Endpoint sẵn sàng KHÔNG được phép tự biến thành "xanh giả".
    const throwingEnv = new Proxy({} as NodeJS.ProcessEnv, {
      get() {
        throw new Error("env đọc hỏng");
      },
    });
    current = { ...baseDeps(), env: throwingEnv };
    const r = await get("/api/health/ai");
    expect(r.status).toBe(503);
    expect(r.body.ready).toBe(false);
    expect(r.body.reason).toContain("env đọc hỏng");
    current = baseDeps();
  });

  it("một probe ném ĐỒNG BỘ chỉ hạ ĐÚNG hệ con đó, không làm sập cả phép đo", async () => {
    current = baseDeps({
      rerankerStatus: () => {
        throw new Error("reranker probe hỏng");
      },
    });
    const r = await get("/api/health/ai");
    expect(r.status).toBe(207); // vẫn đo được, chỉ reranker là degraded
    expect(r.body.checks.reranker.status).toBe("degraded");
    expect(r.body.checks.db.status).toBe("ok");
    expect(r.body.checks.llamaServer.status).toBe("ok");
    current = baseDeps();
  });
});
