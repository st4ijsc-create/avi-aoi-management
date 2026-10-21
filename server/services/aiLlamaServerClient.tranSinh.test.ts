/**
 * ★ Đợt 9 (dieu-phoi 2026-10-22) — trần thời gian SINH riêng cho lượt KHÔNG stream của hồ sơ khe NẶNG
 * (`AI_KHE_NANG_INFER_TIMEOUT_MS`, mặc định 900 000 ms); mọi lượt khác giữ `LLAMA_SERVER_TIMEOUT_MS` (mặc định 120 000 ms).
 * Lý do đo được: A/B /v1 2026-10-22 lần 4 — 27B (code.plc) nghĩ 16k, trung vị 296 s ở đường raw; trần 120 s chung cắt lượt.
 *
 * ĐỘT BIẾN PHẢI BẮT: áp trần dài cho MỌI model (4B nhẹ cũng chờ 15 phút) · bỏ qua hồ sơ khe nặng · bỏ qua biến riêng ·
 * hồ sơ nặng TẮT / tệp vắng vẫn được trần dài · giá trị rác (0, âm, chữ) không lùi về mặc định.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnhSoModel } from "./ai/soModel/anhSoModel";
import { laModelHoSoKheNang } from "./ai/soModel/tapKheNang";
import { tranSinhKhongLuongMs } from "./aiLlamaServerClient";

const P = (artifactFile: string, o: Partial<{ slotClass: "nang" | "nho"; artifactStatus: string; enabled: boolean }> = {}) => ({
  artifactFile, slotClass: "nang" as const, artifactStatus: "available", license: "apache-2.0", enabled: true, ...o,
});
const ANH = {
  taiLuc: 1,
  vaiTro: new Map(),
  gan: [],
  profile: new Map([
    ["q27", P("Qwen3.6-27B-UD-Q4_K_XL.gguf")],
    ["q35", P("Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf")],
    ["q4", P("Qwen3-4B-Instruct.gguf", { slotClass: "nho" })],
    ["tat", P("Tat-30B.gguf", { enabled: false })],
    ["mat", P("Mat-30B.gguf", { artifactStatus: "missing" })],
  ]),
} as unknown as AnhSoModel;

describe("tranSinhKhongLuongMs", () => {
  it("hồ sơ khe NẶNG (kể cả model nhà có hồ sơ) ⇒ AI_KHE_NANG_INFER_TIMEOUT_MS, mặc định 900 000", () => {
    for (const m of ["Qwen3.6-27B-UD-Q4_K_XL", "Qwen3.6-27B-UD-Q4_K_XL.gguf", "Qwen3.6-35B-A3B-UD-Q4_K_XL"]) {
      expect(tranSinhKhongLuongMs(m, {}, ANH), m).toBe(900_000);
      expect(tranSinhKhongLuongMs(m, { AI_KHE_NANG_INFER_TIMEOUT_MS: "600000", LLAMA_SERVER_TIMEOUT_MS: "120000" }, ANH)).toBe(600_000);
    }
  });

  it("★ mọi lượt KHÁC giữ LLAMA_SERVER_TIMEOUT_MS (mặc định 120 000): khe nhỏ, hồ sơ tắt/vắng tệp, model lạ, không model", () => {
    for (const m of ["Qwen3-4B-Instruct", "Tat-30B", "Mat-30B", "khong-co", undefined]) {
      expect(tranSinhKhongLuongMs(m, { AI_KHE_NANG_INFER_TIMEOUT_MS: "900000" }, ANH), String(m)).toBe(120_000);
      expect(tranSinhKhongLuongMs(m, { LLAMA_SERVER_TIMEOUT_MS: "45000", AI_KHE_NANG_INFER_TIMEOUT_MS: "900000" }, ANH)).toBe(45_000);
    }
  });

  it("giá trị rác (0, âm, chữ) ⇒ mặc định của nhánh", () => {
    for (const v of ["0", "-5", "abc", ""]) {
      expect(tranSinhKhongLuongMs("Qwen3.6-27B-UD-Q4_K_XL", { AI_KHE_NANG_INFER_TIMEOUT_MS: v }, ANH)).toBe(900_000);
      expect(tranSinhKhongLuongMs("Qwen3-4B-Instruct", { LLAMA_SERVER_TIMEOUT_MS: v }, ANH)).toBe(120_000);
    }
  });

  it("laModelHoSoKheNang KHÔNG phụ thuộc cờ đổi khe (AI_KHE_NANG_HOAN_DOI) — trần là về thời gian sinh, không về đổi khe", () => {
    expect(laModelHoSoKheNang("Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf", ANH)).toBe(true);
    expect(laModelHoSoKheNang("", ANH)).toBe(false);
  });
});

describe("NỐI DÂY — serverChatCompletion thật cắt lượt treo theo ĐÚNG trần của model", () => {
  const giu = { ...process.env };
  const treo = vi.fn((_u: string, o?: { signal?: AbortSignal }) =>
    new Promise((_r, rej) => {
      const huy = () => rej(new DOMException("This operation was aborted", "AbortError"));
      if (o?.signal?.aborted) huy();
      else o?.signal?.addEventListener("abort", huy);
    }),
  );
  beforeEach(() => {
    Object.assign(process.env, {
      LLAMA_SERVER_ENABLED: "true",
      LLAMA_SERVER_URL: "http://127.0.0.1:8091",
      LLAMA_SERVER_MODEL: "Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf",
      LLAMA_SERVER_TIMEOUT_MS: "40",
      AI_KHE_NANG_INFER_TIMEOUT_MS: "600",
    });
    vi.stubGlobal("fetch", treo);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...giu };
  });
  const chay = async (model: string) => {
    vi.resetModules();
    const { datAnhSoModel } = await import("./ai/soModel/anhSoModel");
    datAnhSoModel({ ...ANH, profile: new Map([["q35", P("Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf")], ["q4", P("Qwen3-4B-Instruct.gguf", { slotClass: "nho" })]]) } as AnhSoModel);
    const c = await import("./aiLlamaServerClient");
    const t0 = Date.now();
    await expect(c.serverChatCompletion({ messages: [{ role: "user", content: "x" }] }, model)).rejects.toThrow();
    return Date.now() - t0;
  };
  it("★ model hồ sơ khe NẶNG chờ tới trần riêng (~600 ms), model nhẹ bị cắt ở trần chung (~40 ms)", async () => {
    const nang = await chay("Qwen3.6-35B-A3B-UD-Q4_K_XL");
    const nhe = await chay("Qwen3-4B-Instruct");
    expect(nang).toBeGreaterThanOrEqual(500);
    expect(nhe).toBeLessThan(400);
  }, 10_000);
});
