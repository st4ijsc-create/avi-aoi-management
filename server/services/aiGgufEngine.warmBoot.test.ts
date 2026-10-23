/**
 * ★ Đợt 9 (2026-10-23, dieu-phoi duyệt) — warm BOOT bỏ qua khi llama-server SỐNG và đang giữ BẤT KỲ model nào (hỏi thẳng `/v1/models`),
 * không so ENV. Chạy với `aiLlamaServerClient` THẬT (env + `fetch` giả lập server) — vị từ env và phép thăm dò cùng được đo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { lyDoBoQuaWarmBoot } from "./aiGgufEngine";
import { modelServerDangChay } from "./aiLlamaServerClient";

const M35 = "Qwen3.6-35B-A3B-UD-Q4_K_XL";
const M27 = "Qwen3.6-27B-UD-Q4_K_XL";
const KHOA = ["LLAMA_SERVER_ENABLED", "LLAMA_SERVER_URL", "LLAMA_SERVER_MODEL", "GGUF_DEFAULT_MODEL", "AI_KHE_NANG_HOAN_DOI"] as const;
const cu: Record<string, string | undefined> = {};

/** Server giả: `/v1/models` trả model đang giữ (dạng llama.cpp: đường tuyệt đối trong `data[0].id`); `null` ⇒ không trả lời. */
function serverGiu(model: string | null) {
  const f = vi.fn(async (url: string) => {
    if (model === null) throw new Error("ECONNREFUSED");
    expect(String(url)).toBe("http://127.0.0.1:8091/v1/models");
    return new Response(JSON.stringify({ object: "list", data: [{ id: `D:\\SOURCES\\16.AI\\${model}.gguf`, object: "model" }] }), { status: 200 });
  });
  vi.stubGlobal("fetch", f);
  return f;
}

beforeEach(() => {
  for (const k of KHOA) cu[k] = process.env[k];
  process.env.LLAMA_SERVER_ENABLED = "true";
  process.env.LLAMA_SERVER_URL = "http://127.0.0.1:8091";
  process.env.LLAMA_SERVER_MODEL = `${M35}.gguf`;
  process.env.AI_KHE_NANG_HOAN_DOI = "false"; // tập khe nặng phụ rỗng ⇒ chỉ vế env + thăm dò được đo
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of KHOA) (cu[k] === undefined ? delete process.env[k] : (process.env[k] = cu[k]));
});

describe("modelServerDangChay — hỏi thẳng server", () => {
  it("trả basename model đang giữ (bỏ đường + .gguf); server không trả lời ⇒ null; server tắt cấu hình ⇒ null, không gọi mạng", async () => {
    serverGiu(M27);
    expect(await modelServerDangChay()).toBe(M27);
    serverGiu(null);
    expect(await modelServerDangChay()).toBeNull();
    process.env.LLAMA_SERVER_ENABLED = "false";
    const f = serverGiu(M27);
    expect(await modelServerDangChay()).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});

describe("lyDoBoQuaWarmBoot", () => {
  it("★★★ (ca dieu-phoi) env nói 35B, KHE GIỮ 27B, GGUF_DEFAULT=35B ⇒ KHÔNG warm in-process", async () => {
    process.env.GGUF_DEFAULT_MODEL = `${M35}.gguf`;
    serverGiu(M27);
    expect(await lyDoBoQuaWarmBoot(M35)).not.toBeNull();
  });

  it("★★★ model mặc định KHÁC env server và không thuộc khe nặng, khe giữ 27B ⇒ KHÔNG warm (vế env một mình sẽ cho warm ⇒ OOM)", async () => {
    process.env.GGUF_DEFAULT_MODEL = "Qwen3-30B-A3B-Instruct-2507-Q4_K_M.gguf";
    serverGiu(M27);
    const lyDo = await lyDoBoQuaWarmBoot("Qwen3-30B-A3B-Instruct-2507-Q4_K_M");
    expect(lyDo).toContain(`đang giữ "${M27}"`);
  });

  it("server KHÔNG trả lời + model không phải của server ⇒ warm (null) — đường in-process là đường còn lại", async () => {
    serverGiu(null);
    expect(await lyDoBoQuaWarmBoot("Qwen3-30B-A3B-Instruct-2507-Q4_K_M")).toBeNull();
  });

  it("llama-server tắt cấu hình ⇒ warm như trước (không chạm mạng)", async () => {
    process.env.LLAMA_SERVER_ENABLED = "false";
    const f = serverGiu(M27);
    expect(await lyDoBoQuaWarmBoot(M35)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});
