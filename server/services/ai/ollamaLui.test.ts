/**
 * ★ 2026-10-14 · Đợt 0.5 — ĐƯỜNG LÙI OLLAMA không được lùi IM LẶNG vào một model không tồn tại.
 *
 * Bối cảnh đo được: khi GGUF hỏng/vắng, `aiLocalKnowledgeService` lùi sang Ollama với mặc định trong mã
 * `qwen2.5:7b-instruct` / `mxbai-embed-large` — trên máy dev cả hai đều KHÔNG có trong `ollama list`.
 * Mỗi lượt lùi khi ấy là một POST chắc chắn 404 (hoặc ECONNREFUSED) mà không ai thấy lý do.
 * Nay mọi lượt lùi hỏi `/api/tags` TRƯỚC (đệm ngắn), thiếu model ⇒ KHÔNG gọi, log RÕ một lần.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { khopTenModelOllama, kiemModelOllama, ollamaDungDuoc, __datLaiOllamaLuiChoTest } from "./ollamaLui";

const BASE = "http://127.0.0.1:11434";
let goi: string[] = [];
let tags: unknown = { models: [{ name: "qwen3:4b" }, { name: "nomic-embed-text:latest" }] };
let hong: Error | null = null;

beforeEach(() => {
  __datLaiOllamaLuiChoTest();
  goi = [];
  hong = null;
  tags = { models: [{ name: "qwen3:4b" }, { name: "nomic-embed-text:latest" }] };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    goi.push(String(url));
    if (hong) throw hong;
    return { ok: true, json: async () => tags } as Response;
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("khopTenModelOllama", () => {
  it("★★ khớp đúng tên; tên không thẻ khớp ':latest'; tên khác thẻ KHÔNG khớp", () => {
    const ds = ["qwen3:4b", "nomic-embed-text:latest"];
    expect(khopTenModelOllama("qwen3:4b", ds)).toBe(true);
    expect(khopTenModelOllama("nomic-embed-text", ds)).toBe(true);
    expect(khopTenModelOllama("qwen3", ds), "'qwen3' = 'qwen3:latest' — không có").toBe(false);
    expect(khopTenModelOllama("qwen2.5:7b-instruct", ds)).toBe(false);
    expect(khopTenModelOllama("", ds)).toBe(false);
  });
});

describe("kiemModelOllama", () => {
  it("★★★ model KHÔNG có trong /api/tags ⇒ khong_co_model, kèm danh sách thật", async () => {
    const r = await kiemModelOllama(BASE, "qwen2.5:7b-instruct");
    expect(r.lyDo).toBe("khong_co_model");
    expect(r.ok).toBe(false);
    expect(r.danhSach).toContain("qwen3:4b");
    expect(goi).toEqual([`${BASE}/api/tags`]);
  });

  it("★★★ Ollama không chạy ⇒ khong_ket_noi (không ném)", async () => {
    hong = new Error("connect ECONNREFUSED");
    const r = await kiemModelOllama(BASE, "qwen3:4b");
    expect(r.lyDo).toBe("khong_ket_noi");
    expect(r.ok).toBe(false);
  });

  it("★★ có model ⇒ ok; /api/tags được ĐỆM (lượt hai không gọi lại)", async () => {
    expect((await kiemModelOllama(BASE, "qwen3:4b")).ok).toBe(true);
    expect((await kiemModelOllama(BASE, "nomic-embed-text")).ok).toBe(true);
    expect(goi.length, "một lần /api/tags cho hai lượt").toBe(1);
  });

  it("★ thân /api/tags sai hình ⇒ khong_ket_noi (không đoán là có)", async () => {
    tags = { khac: 1 };
    expect((await kiemModelOllama(BASE, "qwen3:4b")).lyDo).toBe("khong_ket_noi");
  });
});

describe("ollamaDungDuoc — log RÕ, một lần", () => {
  it("★★★ thiếu model ⇒ false + cảnh báo nêu tên model, biến env, và danh sách có thật; lặp lại không spam", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await ollamaDungDuoc(BASE, "qwen2.5:7b-instruct", "qa")).toBe(false);
    expect(await ollamaDungDuoc(BASE, "qwen2.5:7b-instruct", "qa")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    const cau = String(warn.mock.calls[0]![0]);
    expect(cau).toContain("qwen2.5:7b-instruct");
    expect(cau).toContain("OLLAMA_QA_MODEL");
    expect(cau).toContain("qwen3:4b");
  });

  it("★★ vai trò embed nêu OLLAMA_EMBED_MODEL", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await ollamaDungDuoc(BASE, "mxbai-embed-large", "embed")).toBe(false);
    expect(String(warn.mock.calls[0]![0])).toContain("OLLAMA_EMBED_MODEL");
  });

  it("★★ có model ⇒ true, không log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await ollamaDungDuoc(BASE, "qwen3:4b", "qa")).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });
});
