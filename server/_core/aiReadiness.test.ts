/**
 * aiReadiness.test.ts — G1-E (2026-08-16).
 *
 * CA QUAN TRỌNG NHẤT (được đặt lên đầu, và được khẳng định bằng NGUYÊN VĂN câu báo):
 *   llama-server chết ⇒ endpoint PHẢI nói "đang chạy in-process, MẤT PREFIX-CACHE" và KHÔNG được
 *   trả 200. Đây là bằng chứng nó bắt được LỖ 1 — chứ không phải chỉ "có thêm một endpoint".
 *
 * Mọi hệ con đều tiêm được (sống / chết / CHẬM QUÁ TRẦN), nên bộ test này không cần DB, không cần
 * GPU, không cần llama-server thật.
 */
import { describe, it, expect } from "vitest";
import {
  probeAiReadiness,
  redactEndpoint,
  isLoopbackRequest,
  type AiReadinessDeps,
  type LlamaServerProbeResult,
} from "./aiReadiness";

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

/** env khớp cấu hình ĐÃ NGHIỆM THU ở G1-A (.env thật), để test nói về hệ thống thật. */
function goodEnv(over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    LLAMA_SERVER_ENABLED: "true",
    LLAMA_SERVER_URL: "http://127.0.0.1:8091",
    LLAMA_SERVER_MODEL: "Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL.gguf",
    GGUF_DEFAULT_MODEL: "Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL.gguf",
    GGUF_EMBED_MODEL: "Qwen3-Embedding-0.6B-f16.gguf",
    ...over,
  } as NodeJS.ProcessEnv;
}

function deps(over: Partial<AiReadinessDeps> = {}): AiReadinessDeps {
  return {
    env: goodEnv(),
    timeoutMs: 200,
    checkDb: async () => true,
    probeLlamaServer: async () => ALIVE,
    rerankerStatus: () => ({
      enabled: true,
      mode: "gguf",
      modelConfigured: true,
      modelResolved: true,
      activeBackend: "gguf",
    }),
    ggufExists: () => true,
    auditTierFlags: async () => [],
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("G1-E — llama-server CHẾT phải bị BẮT (ca quan trọng nhất)", () => {
  it("server chết ⇒ KHÔNG 200, llamaServer=down, và câu báo nói ĐÚNG chữ 'in-process' + 'prefix-cache'", async () => {
    const r = await probeAiReadiness(deps({ probeLlamaServer: async () => DEAD }));

    expect(r.httpStatus).not.toBe(200); // ← lỗ cũ: mọi thứ vẫn 200
    expect(r.status).toBe("down");
    expect(r.ready).toBe(false);
    expect(r.checks.llamaServer.status).toBe("down");

    // Đường sinh chữ: vẫn chạy được, nhưng ĐÃ MẤT năng lực — và phải NÓI RA.
    expect(r.checks.textGeneration.status).toBe("degraded");
    expect(r.checks.textGeneration.reason).toContain("in-process");
    expect(r.checks.textGeneration.reason).toContain("PREFIX-CACHE");
    expect(r.checks.textGeneration.detail?.path).toBe("in-process");

    // Một dòng đủ cho cảnh báo.
    expect(r.problems.join("\n")).toMatch(/llama-server/);
  });

  it("server chết + LLAMA_SERVER_STRICT=true ⇒ textGeneration=down (KHÔNG có đường lùi)", async () => {
    const r = await probeAiReadiness(
      deps({ env: goodEnv({ LLAMA_SERVER_STRICT: "true" }), probeLlamaServer: async () => DEAD }),
    );
    expect(r.checks.textGeneration.status).toBe("down");
    expect(r.checks.textGeneration.reason).toContain("KHÔNG có đường lùi");
    expect(r.httpStatus).toBe(503);
  });

  it("server CHẬM QUÁ TRẦN (treo) ⇒ bị tính là chết, không kéo dài endpoint", async () => {
    const started = Date.now();
    const r = await probeAiReadiness(
      deps({
        timeoutMs: 120,
        probeLlamaServer: () => new Promise<LlamaServerProbeResult>((res) => setTimeout(() => res(ALIVE), 5000)),
      }),
    );
    expect(r.checks.llamaServer.status).toBe("down");
    expect(r.checks.textGeneration.status).toBe("degraded");
    expect(Date.now() - started).toBeLessThan(2000); // trần thời gian có tác dụng thật
  });

  it("llama-server TẮT theo cấu hình ⇒ disabled, nhưng đường sinh chữ vẫn phải khai là degraded", async () => {
    const r = await probeAiReadiness(deps({ env: goodEnv({ LLAMA_SERVER_ENABLED: "false" }) }));
    expect(r.checks.llamaServer.status).toBe("disabled");
    expect(r.checks.textGeneration.status).toBe("degraded");
    expect(r.checks.textGeneration.reason).toContain("IN-PROCESS");
    expect(r.httpStatus).toBe(207);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("G1-E — mọi hệ con: sống / chết / chậm", () => {
  it("tất cả sống ⇒ 200 + ready", async () => {
    const r = await probeAiReadiness(deps());
    expect(r.httpStatus).toBe(200);
    expect(r.status).toBe("ok");
    expect(r.ready).toBe(true);
    expect(r.problems).toEqual([]);
    expect(r.checks.textGeneration.detail?.path).toBe("llama-server");
  });

  it("DB chết ⇒ 503 (hệ con THIẾT YẾU chết thì không được 200)", async () => {
    const r = await probeAiReadiness(deps({ checkDb: async () => false }));
    expect(r.httpStatus).toBe(503);
    expect(r.checks.db.status).toBe("down");
    expect(r.checks.db.reason).toContain("PostgreSQL");
  });

  it("DB CHẬM quá trần ⇒ coi như chết (không treo endpoint)", async () => {
    const r = await probeAiReadiness(
      deps({ timeoutMs: 100, checkDb: () => new Promise<boolean>((res) => setTimeout(() => res(true), 3000)) }),
    );
    expect(r.checks.db.status).toBe("down");
  });

  it("model nhúng không có trên đĩa ⇒ down (RAG mất vector)", async () => {
    const r = await probeAiReadiness(deps({ ggufExists: () => false }));
    expect(r.checks.embedding.status).toBe("down");
    expect(r.httpStatus).toBe(503);
  });

  it("GGUF_EMBED_MODEL rỗng ⇒ down và nói rõ chưa gán", async () => {
    const r = await probeAiReadiness(deps({ env: goodEnv({ GGUF_EMBED_MODEL: undefined }) }));
    expect(r.checks.embedding.status).toBe("down");
    expect(r.checks.embedding.reason).toContain("chưa được gán");
  });

  it("reranker khai gguf nhưng backend thật là llm ⇒ degraded (thứ hạng đổi trong im lặng)", async () => {
    const r = await probeAiReadiness(
      deps({
        rerankerStatus: () => ({
          enabled: true,
          mode: "gguf",
          modelConfigured: true,
          modelResolved: false,
          activeBackend: "llm",
        }),
      }),
    );
    expect(r.checks.reranker.status).toBe("degraded");
    expect(r.checks.reranker.reason).toContain("im lặng");
    expect(r.httpStatus).toBe(207);
  });

  it("reranker tắt ⇒ disabled, KHÔNG kéo mã HTTP xuống", async () => {
    const r = await probeAiReadiness(
      deps({
        rerankerStatus: () => ({
          enabled: false,
          mode: "llm",
          modelConfigured: false,
          modelResolved: false,
          activeBackend: "identity",
        }),
      }),
    );
    expect(r.checks.reranker.status).toBe("disabled");
    expect(r.httpStatus).toBe(200);
  });

  it("TIER_FLAG_SPECS có phát hiện ⇒ degraded + mang nguyên lý do sang", async () => {
    const r = await probeAiReadiness(
      deps({
        auditTierFlags: async () => [
          { label: "rag-reranker(gguf)", env: "GGUF_RERANKER_MODEL", reason: "…file KHÔNG có trên đĩa…" },
        ],
      }),
    );
    expect(r.checks.tierFlags.status).toBe("degraded");
    expect(JSON.stringify(r.checks.tierFlags.detail)).toContain("GGUF_RERANKER_MODEL");
    expect(r.httpStatus).toBe(207);
  });

  it("một phép kiểm NÉM cũng không được làm hỏng endpoint", async () => {
    const r = await probeAiReadiness(
      deps({
        checkDb: async () => {
          throw new Error("boom");
        },
        auditTierFlags: async () => {
          throw new Error("boom");
        },
      }),
    );
    expect(r.checks.db.status).toBe("down");
    expect(r.checks.tierFlags.status).toBe("ok"); // ném ⇒ coi như không có phát hiện, không sập
    expect(r.httpStatus).toBe(503);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("G1-E — model server ĐANG NẠP THẬT vs cấu hình", () => {
  it("server nạp model KHÁC với cấu hình ⇒ degraded, nói rõ câu trả lời do model khác sinh", async () => {
    const r = await probeAiReadiness(
      deps({ probeLlamaServer: async () => ({ ...ALIVE, servedModel: "Qwen3-4B-Instruct-2507-UD-Q4_K_XL" }) }),
    );
    expect(r.checks.llamaServer.status).toBe("degraded");
    expect(r.checks.llamaServer.reason).toContain("MODEL KHÁC");
    expect(r.httpStatus).toBe(207);
  });

  it("GGUF_DEFAULT_MODEL không khớp LLAMA_SERVER_MODEL ⇒ mã KHÔNG định tuyến ⇒ in-process degraded", async () => {
    const r = await probeAiReadiness(
      deps({ env: goodEnv({ GGUF_DEFAULT_MODEL: "Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf" }) }),
    );
    expect(r.checks.textGeneration.status).toBe("degraded");
    expect(r.checks.textGeneration.detail?.path).toBe("in-process");
    expect(r.checks.textGeneration.reason).toContain("KHÔNG khớp");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("G1-E — KHÔNG rò bí mật", () => {
  it("không có API key, không có path tuyệt đối, không có hostname trong toàn bộ JSON", async () => {
    const r = await probeAiReadiness(
      deps({
        env: goodEnv({
          LLAMA_SERVER_API_KEY: "sk-super-secret-key",
          LLAMA_SERVER_URL: "http://ai-internal.factory.local:8091",
        }),
      }),
    );
    const blob = JSON.stringify(r);
    expect(blob).not.toContain("sk-super-secret-key");
    expect(blob).not.toContain("ai-internal.factory.local");
    expect(blob).not.toMatch(/[A-Za-z]:[\\/]/); // không "D:/SOURCES/…"
    expect(r.checks.llamaServer.detail?.host).toBe("remote");
    expect(r.checks.llamaServer.detail?.port).toBe(8091);
  });

  it("redactEndpoint phân biệt loopback/remote và không trả hostname", () => {
    expect(redactEndpoint("http://127.0.0.1:8091")).toEqual({ host: "loopback", port: 8091 });
    expect(redactEndpoint("http://localhost:8091")).toEqual({ host: "loopback", port: 8091 });
    expect(redactEndpoint("https://gpu-01.corp:9000")).toEqual({ host: "remote", port: 9000 });
    expect(redactEndpoint("khong-phai-url")).toEqual({ host: "unknown", port: null });
  });

  it("isLoopbackRequest nhận cả dạng IPv4-mapped ::ffff:127.0.0.1", () => {
    expect(isLoopbackRequest({ ip: "::ffff:127.0.0.1", socket: {} as any })).toBe(true);
    expect(isLoopbackRequest({ ip: "::1", socket: {} as any })).toBe(true);
    expect(isLoopbackRequest({ ip: "10.0.0.5", socket: {} as any })).toBe(false);
    expect(isLoopbackRequest({ ip: undefined as any, socket: { remoteAddress: "127.0.0.1" } as any })).toBe(true);
  });
});
