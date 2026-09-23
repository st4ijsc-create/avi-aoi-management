import { describe, it, expect } from "vitest";
import { tienToNhungCauHoi, TIEN_TO_QWEN3_EMBEDDING } from "./tienToNhungCauHoi";

describe("tienToNhungCauHoi — suy từ tên model nhúng", () => {
  it.each(["Qwen3-Embedding-0.6B-f16.gguf", "Qwen3-Embedding-0.6B-f16", "qwen3_embedding-4b-q8", "D:/m/Qwen3-Embedding-8B.gguf"])(
    "%s ⇒ tiền tố Instruct chung của thẻ model",
    (ten) => {
      expect(tienToNhungCauHoi(ten)).toBe(TIEN_TO_QWEN3_EMBEDDING);
    },
  );

  it.each(["mxbai-embed-large-v1-f16.gguf", "Qwen3-4B-Instruct.gguf", "", undefined, null])("%s ⇒ '' (hành vi cũ)", (ten) => {
    expect(tienToNhungCauHoi(ten as string)).toBe("");
  });

  it("đúng khuôn thẻ model: 'Instruct: …\\nQuery:' — không dấu cách sau 'Query:' (câu hỏi nối liền)", () => {
    expect(TIEN_TO_QWEN3_EMBEDDING.startsWith("Instruct: ")).toBe(true);
    expect(TIEN_TO_QWEN3_EMBEDDING.endsWith("\nQuery:")).toBe(true);
  });
});
