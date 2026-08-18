/**
 * ★★★ G5-D — HẠN MỨC TOKEN CỦA LƯỢT PHÂN LOẠI Ý ĐỊNH, NEO VÀO PHÉP ĐO.
 *
 * `maxTokens: 120` (giá trị cũ) là lỗi CHẶN với model suy luận lai: llama.cpp hoãn grammar
 * (`json_schema`) cho tới khi khối `<think>` đóng, nên model tiêu token vào suy luận TRƯỚC; hết
 * 120 token trước khi thoát `<think>` ⇒ `content` RỖNG ⇒ 0/21 và 1/21 lượt trả được tool (đo A/B
 * 2026-08-16).
 *
 * ⚠ LƯỚI NÀY CỐ Ý **KHÔNG** VIẾT `expect(TRAN).toBe(1536)` — câu đó chỉ chép lại hằng số, nó xanh
 * với mọi giá trị miễn là hai chỗ khớp nhau, tức nó canh CHÍNH NÓ. Nó phát biểu quan hệ với **con
 * số ĐO ĐƯỢC**: hạn mức phải phủ được khối suy luận DÀI NHẤT đã đo cộng phần JSON DÀI NHẤT đã đo.
 * Hạ hằng số về 120 (hay 512, hay 1024) ⇒ ĐỎ, kèm câu nói rõ vì sao.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TRAN_TOKEN_PHAN_LOAI_Y_DINH } from "./intentClassifier";

/**
 * PHÉP ĐO 2026-08-17 — POST thẳng `http://127.0.0.1:8091/v1/chat/completions` (llama-server
 * `b9814-487a6cc16`, `Qwen3-30B-A3B-Instruct-2507`), prompt phân loại THẬT dựng từ `listTools()`
 * (77 tool, 15.476 ký tự = 4.432 token theo `POST /tokenize` của chính tokenizer đang phục vụ),
 * 8 câu hỏi tiếng Việt thật.
 */
const DO_DUOC = {
  /** BỎ `json_schema` + yêu cầu suy luận từng bước: 396 · 486 · 495 · 502 · **1082** token. */
  khoiSuyLuanDaiNhat: 1082,
  /** CÓ `json_schema`: 14 · 14 · 17 · 21 · 22 · 22 · **29** · 29 token, `finish_reason="stop"` 8/8. */
  jsonToolDaiNhat: 29,
};

describe("G5-D — TRAN_TOKEN_PHAN_LOAI_Y_DINH neo vào phép đo, không neo vào cảm giác", () => {
  it("★★★ phủ được khối suy luận DÀI NHẤT đã đo + phần JSON DÀI NHẤT đã đo", () => {
    const canToiThieu = DO_DUOC.khoiSuyLuanDaiNhat + DO_DUOC.jsonToolDaiNhat; // 1.111
    expect(
      TRAN_TOKEN_PHAN_LOAI_Y_DINH,
      `Hạn mức ${TRAN_TOKEN_PHAN_LOAI_Y_DINH} KHÔNG phủ nổi ca xấu nhất ĐÃ ĐO ` +
        `(${DO_DUOC.khoiSuyLuanDaiNhat} token suy luận + ${DO_DUOC.jsonToolDaiNhat} token JSON = ${canToiThieu}). ` +
        `Với model suy luận lai, lượt phân loại sẽ cạn token TRƯỚC khi thoát <think> ⇒ \`content\` rỗng ⇒ ` +
        `nhánh LLM chọn tool chết trong im lặng (đo A/B 2026-08-16: 0/21 và 1/21).`,
    ).toBeGreaterThanOrEqual(canToiThieu);
  });

  it("★ nhưng KHÔNG phung phí: hạn mức + prompt vẫn lọt xa trần 32.768 token/slot", () => {
    const TOKEN_PROMPT_DA_DO = 4432;
    const TRAN_MOI_SLOT = 32768;
    expect(TOKEN_PROMPT_DA_DO + TRAN_TOKEN_PHAN_LOAI_Y_DINH).toBeLessThan(TRAN_MOI_SLOT / 2);
    // Trần, không phải chi phí: sinh dừng ở EOS (chi phí THẬT đo được vẫn là 14–29 token). Nhưng
    // cổng ngân sách GIỮ CHỖ đúng con số này, nên nó không được phép phình vô tội vạ.
    expect(TRAN_TOKEN_PHAN_LOAI_Y_DINH).toBeLessThanOrEqual(4096);
  });

  it("★★ điểm gọi dùng ĐÚNG hằng số — không còn số ma trong thân hàm", () => {
    const src = readFileSync(resolve(process.cwd(), "server/services/aiLocalTools/intentClassifier.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    expect(src).toMatch(/maxTokens:\s*TRAN_TOKEN_PHAN_LOAI_Y_DINH/);
    expect(src, "còn một hạn mức viết cứng — hai con số sẽ trôi khỏi nhau").not.toMatch(/maxTokens:\s*\d+/);
    // Lượt chọn tool KHÔNG cần suy luận ⇒ cờ tắt phải được gửi (phép tối ưu, không phải lưới).
    expect(src).toMatch(/disableThinking:\s*true/);
  });
});
