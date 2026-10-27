/**
 * ★ Đợt 11.0 (CHỈ ĐO) — `preserve_thinking`: chỉ khi lịch sử MANG `reasoning_content` (host bật `AI_AGENT_GIU_NGHI=1`) thì yêu cầu engine có
 * `preserveThinking` + tin assistant mang suy luận; vắng ⇒ tùy chọn như cũ. Đường dây llama-server: gộp vào `chat_template_kwargs`.
 */
import { describe, expect, it } from "vitest";
import { taoGoiModelMayChu } from "./goiModelMayChu";
import { chuyenMessageLenDay } from "../../aiLlamaServerClient";
import type { GgufChatOptions } from "../../aiGgufEngine";
import type { TinNhan } from "@shared/agentCore";

async function goiVoi(tinNhan: TinNhan[]) {
  let nhan: GgufChatOptions | null = null;
  const goi = taoGoiModelMayChu({
    khongGhiDauVet: true,
    chatStream: async function* (o) {
      nhan = o;
      yield { type: "done", toolCalls: [] } as never;
    },
  });
  for await (const _ of goi({ tinNhan, congCu: [], signal: new AbortController().signal })) {
    /* rút hết */
  }
  return nhan!;
}

describe("goiModelMayChu — preserveThinking", () => {
  it("lịch sử KHÔNG có reasoning_content ⇒ không preserveThinking, tin không có trường đó", async () => {
    const o = await goiVoi([{ role: "user", content: "hỏi" }, { role: "assistant", content: "đáp" }]);
    expect(o).not.toHaveProperty("preserveThinking");
    expect(o.messages.some((m) => "nghiTruoc" in m)).toBe(false);
  });
  it("rà kiem-dinh — suy luận chỉ-khoảng-trắng ⇒ coi như KHÔNG có (không gửi, không preserveThinking)", async () => {
    const o = await goiVoi([{ role: "user", content: "hỏi" }, { role: "assistant", content: "đáp", reasoning_content: " \t \n " }]);
    expect(o).not.toHaveProperty("preserveThinking");
    expect(o.messages.some((m) => "nghiTruoc" in m)).toBe(false);
  });
  it("lịch sử CÓ reasoning_content ⇒ preserveThinking + chuyển nguyên trên assistant", async () => {
    const o = await goiVoi([{ role: "user", content: "hỏi" }, { role: "assistant", content: "đáp", reasoning_content: "nghĩ" }]);
    expect(o.preserveThinking).toBe(true);
    expect(o.messages[1]).toMatchObject({ role: "assistant", nghiTruoc: "nghĩ" });
  });
  it("lên dây llama-server: assistant mang reasoning_content; user không", () => {
    expect(chuyenMessageLenDay({ role: "assistant", content: "đáp", nghiTruoc: "nghĩ" })).toMatchObject({ reasoning_content: "nghĩ" });
    expect(chuyenMessageLenDay({ role: "user", content: "x", nghiTruoc: "lạ" } as never)).not.toHaveProperty("reasoning_content");
    expect(chuyenMessageLenDay({ role: "assistant", content: "đáp" })).not.toHaveProperty("reasoning_content");
  });
});

describe("thân yêu cầu llama-server — chat_template_kwargs", async () => {
  const { lapCoTatSuyLuan } = await import("../../aiLlamaServerClient");
  it("preserve_thinking GỘP với enable_thinking (một điểm ghi); cờ tắt ⇒ thân Y HỆT trước 11.0", () => {
    const b: Record<string, unknown> = {};
    lapCoTatSuyLuan(b, true, true);
    expect(b.chat_template_kwargs).toEqual({ enable_thinking: false, preserve_thinking: true });
    const g: Record<string, unknown> = {};
    lapCoTatSuyLuan(g, undefined, true);
    expect(g.chat_template_kwargs).toEqual({ preserve_thinking: true });
    const t: Record<string, unknown> = {};
    lapCoTatSuyLuan(t, true, undefined);
    expect(t).toEqual({ chat_template_kwargs: { enable_thinking: false } }); // như trước 11.0
    const c: Record<string, unknown> = {};
    lapCoTatSuyLuan(c, undefined, undefined);
    expect(c).toEqual({});
  });
});
