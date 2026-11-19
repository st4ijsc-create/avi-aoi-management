/**
 * Lô D1-script — tao-khoa-llama.mjs KHÔNG in ký tự nào của khoá (bản cũ in 4 ký tự cuối, :119).
 * Dòng báo tạo chỉ mang vân tay = 16 ký tự hex đầu của sha256(khoá). Test thuần (hàm định dạng, không tạo tệp).
 */
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { dongDaTao } from "./tao-khoa-llama.mjs";

const KHOA = "khoa-gia-abcdefghijklmnop-ZZZZ";
const VAN_TAY = crypto.createHash("sha256").update(KHOA).digest("hex").slice(0, 16);

describe("tao-khoa-llama — dòng báo tạo", () => {
  it("mang đường dẫn + vân tay sha256 16 hex", () => {
    const d = dongDaTao("C:/ngoai-repo/llama.key", KHOA);
    expect(d).toContain("C:/ngoai-repo/llama.key");
    expect(d).toContain(VAN_TAY);
  });
  it("KHÔNG chứa khoá, KHÔNG chứa 4 ký tự cuối của khoá", () => {
    const d = dongDaTao("C:/ngoai-repo/llama.key", KHOA);
    expect(d.includes(KHOA), "dòng báo chứa khoá giả").toBe(false);
    expect(d.includes("ZZZZ"), "dòng báo chứa 4 ký tự cuối của khoá giả").toBe(false);
  });
});
