/**
 * ★ Đợt 12 H3.2 (rà kiem-dinh m9) — lượt sinh thử sau khi đổi model (`sinhThuNgan`) PHẢI tắt nghĩ bằng cờ của MÔ TẢ mặc định
 * (`chat_template_kwargs.enable_thinking=false`) — ảnh chụp thân yêu cầu chỉ phủ aiLlamaServerClient, ca này phủ đường khởi động.
 */
import { describe, expect, it } from "vitest";
import { sinhThuNgan } from "./doiModelLlamaServer";

describe("sinhThuNgan — thân yêu cầu", () => {
  it("mang chat_template_kwargs {enable_thinking:false} (mô tả mặc định), max_tokens 16, không stream", async () => {
    let than: Record<string, unknown> | null = null;
    const fetchGia = (async (_u: string, init: { body: string }) => {
      than = JSON.parse(init.body) as Record<string, unknown>;
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "OK" } }] }) } as unknown as Response;
    }) as unknown as typeof fetch;
    await sinhThuNgan("http://127.0.0.1:8091", fetchGia, 5_000, {});
    expect(than).toMatchObject({ max_tokens: 16, stream: false, chat_template_kwargs: { enable_thinking: false } });
    expect(Object.keys((than as unknown as { chat_template_kwargs: object }).chat_template_kwargs)).toEqual(["enable_thinking"]);
  });
});
