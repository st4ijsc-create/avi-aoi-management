/**
 * Đợt 0.3 — `/api/health/ai` phơi trạng thái CỔNG ƯU TIÊN trước llama-server.
 *
 * Hai điều được canh:
 *   1. ô `hangDoiLlm` có mặt với đúng hình dạng (đang chạy, đang chờ theo mức, p50/max chờ gần đây);
 *   2. nó là ô QUAN SÁT, không phải một phép kiểm: hàng dài KHÔNG kéo `status`/mã HTTP xuống — model
 *      bận là chuyện bình thường của 1 slot, không phải "mất năng lực AI".
 *   + số slot cổng tin ≠ số slot server khai trong `/props` ⇒ có câu cảnh báo (cấu hình trôi).
 */
import { describe, expect, it } from "vitest";
import { probeAiReadiness, type AiReadinessDeps, type LlamaServerProbeResult } from "./aiReadiness";

const ALIVE: LlamaServerProbeResult = {
  reachable: true,
  servedModel: "Qwen3.6-35B-A3B-UD-Q4_K_XL",
  slots: 1,
  ctxPerSlot: 65536,
};

function deps(over: Partial<AiReadinessDeps> = {}): AiReadinessDeps {
  return {
    env: {
      LLAMA_SERVER_ENABLED: "true",
      LLAMA_SERVER_URL: "http://127.0.0.1:8091",
      LLAMA_SERVER_MODEL: "Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf",
      GGUF_DEFAULT_MODEL: "Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf",
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

const HANG_DAI = {
  batCong: true,
  cacMuc: ["tuong-tac", "agent", "nen"] as const,
  soSlot: 1,
  dangChay: 1,
  dangCho: { "tuong-tac": 2, agent: 0, nen: 5 },
  daPhucVu: 40,
  daNangChongDoi: 1,
  tuChoiQuaTai: 0,
  hetGioCho: 0,
  huyKhiCho: 0,
  thuHoiCuong: 0,
  choGanDay: { soMau: 40, p50Ms: 1200, maxMs: 95_000 },
};

describe("/api/health/ai × cổng ưu tiên LLM", () => {
  it("phơi ô hangDoiLlm và KHÔNG để hàng dài kéo status xuống", async () => {
    const r = await probeAiReadiness(deps({ thongKeHangDoiLlm: () => HANG_DAI }));
    expect(r.status).toBe("ok");
    expect(r.httpStatus).toBe(200);
    expect(r.hangDoiLlm).toMatchObject({
      batCong: true,
      soSlot: 1,
      dangChay: 1,
      dangCho: { "tuong-tac": 2, agent: 0, nen: 5 },
      choGanDay: { p50Ms: 1200, maxMs: 95_000 },
      slotServerKhai: 1,
    });
    expect(r.hangDoiLlm?.canhBao).toBeUndefined();
  });

  it("số slot cổng ≠ số slot server khai ⇒ câu cảnh báo cấu hình trôi", async () => {
    const r = await probeAiReadiness(
      deps({ probeLlamaServer: async () => ({ ...ALIVE, slots: 2 }), thongKeHangDoiLlm: () => HANG_DAI }),
    );
    expect(r.hangDoiLlm?.slotServerKhai).toBe(2);
    expect(r.hangDoiLlm?.canhBao).toMatch(/LLAMA_SERVER_SLOTS/);
  });

  it("mặc định đọc thống kê THẬT của tiến trình (không cần deps)", async () => {
    const r = await probeAiReadiness(deps());
    expect(r.hangDoiLlm).toMatchObject({ dangChay: expect.any(Number), soSlot: expect.any(Number) });
  });
});
