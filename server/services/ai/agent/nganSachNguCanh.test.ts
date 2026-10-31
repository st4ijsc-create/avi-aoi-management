/**
 * ★ Đợt 12 H3.2b — ngân sách ngữ cảnh của vòng agent theo mô tả model + kiểm `/props` n_ctx (số NHỎ hơn; lỗi ⇒ mô tả).
 * ĐỘT BIẾN PHẢI BẮT: lấy số lớn hơn · tin /props khi rác · không đệm (GET mỗi lượt) · không áp vào lõi · áp cho lượt ngoài / khi người gọi
 * đã đặt gioiHan.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nganSachNguCanhCho, _datLaiCanhBaoNganSach } from "./nganSachNguCanh";

const dep = (nCtx: number | null | "nem", ten = "Qwen3.6-35B-A3B-UD-Q4_K_XL") => ({
  nCtxKhe: async () => {
    if (nCtx === "nem") throw new Error("mạng");
    return nCtx;
  },
  tenModelMacDinh: () => ten,
});

beforeEach(() => _datLaiCanhBaoNganSach());

describe("nganSachNguCanhCho", () => {
  it("Qwen3.6 + khe 65 536 ⇒ 65 536 (như hôm nay)", async () => {
    expect(await nganSachNguCanhCho(undefined, dep(65_536))).toBe(65_536);
  });
  it("khe NHỎ hơn mô tả ⇒ số của khe + cảnh báo một lần; khe LỚN hơn ⇒ vẫn mô tả (không tin số lớn)", async () => {
    const w = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(await nganSachNguCanhCho(undefined, dep(32_768))).toBe(32_768);
      expect(await nganSachNguCanhCho(undefined, dep(32_768))).toBe(32_768);
      expect(w).toHaveBeenCalledTimes(1);
      expect(await nganSachNguCanhCho(undefined, dep(131_072))).toBe(65_536);
    } finally {
      w.mockRestore();
    }
  });
  it("khe không đọc được (null / ném) ⇒ số của mô tả (fail-open về hôm nay)", async () => {
    expect(await nganSachNguCanhCho(undefined, dep(null))).toBe(65_536);
    expect(await nganSachNguCanhCho(undefined, dep("nem"))).toBe(65_536);
  });
  it("modelId tường minh thắng tên khe mặc định; Qwen3-4B-Instruct-2507 ⇒ 32 768", async () => {
    expect(await nganSachNguCanhCho("Qwen3-4B-Instruct-2507-Q4_K_M.gguf", dep(65_536))).toBe(32_768);
    expect(await nganSachNguCanhCho("model-la", dep(null, "Qwen3-4B-Instruct-2507"))).toBe(65_536);
  });
});

describe("nCtxKheServer — một GET /props, đệm 10 phút", () => {
  const ENV0 = { ...process.env };
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ENV0 };
  });
  it("đọc default_generation_settings.n_ctx; gọi lần hai trong 10 phút ⇒ KHÔNG GET lại; quá 10 phút ⇒ GET lại; rác ⇒ null", async () => {
    process.env.LLAMA_SERVER_ENABLED = "true";
    process.env.LLAMA_SERVER_URL = "http://127.0.0.1:8091";
    vi.resetModules();
    const c = await import("../../aiLlamaServerClient");
    let traVe: unknown = { default_generation_settings: { n_ctx: 65_536 } };
    const f = vi.fn(async () => ({ ok: true, json: async () => traVe }) as unknown as Response);
    vi.stubGlobal("fetch", f);
    expect(await c.nCtxKheServer(1500, 1_000)).toBe(65_536);
    expect(await c.nCtxKheServer(1500, 1_000 + 599_000)).toBe(65_536);
    expect(f).toHaveBeenCalledTimes(1);
    traVe = { default_generation_settings: { n_ctx: "abc" } };
    expect(await c.nCtxKheServer(1500, 1_000 + 601_000)).toBeNull();
    expect(f).toHaveBeenCalledTimes(2);
    c.__xoaDemNCtx();
  });
  it("llama-server tắt ⇒ null, không GET", async () => {
    process.env.LLAMA_SERVER_ENABLED = "false";
    vi.resetModules();
    const c = await import("../../aiLlamaServerClient");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await c.nCtxKheServer()).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});
