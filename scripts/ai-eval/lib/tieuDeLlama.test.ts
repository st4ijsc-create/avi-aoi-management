/**
 * Lô D1-script — tiêu đề khoá cho mọi script gọi thẳng llama-server :8091.
 * `tieuDeLlama(env)` CHỈ đọc ĐƯỜNG DẪN `LLAMA_SERVER_API_KEY_FILE` (không bao giờ đọc giá trị `LLAMA_SERVER_API_KEY`,
 * cùng nguyên tắc napEnv.ts:30). Biến có giá trị mà đọc hỏng ⇒ NÉM: không lặng lẽ gửi không khoá rồi ăn 401 khó đoán.
 * Test thuần: tệp trong thư mục tạm, khoá GIẢ, không mạng.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tieuDeLlama, tieuDeLlamaCho, urlLlama } from "./tieuDeLlama.mjs";

const KHOA = "khoa-gia-0123456789abcdef-ZZZZ";
let kho: string;
beforeAll(() => {
  kho = fs.mkdtempSync(path.join(os.tmpdir(), "tieu-de-llama-"));
});
afterAll(() => fs.rmSync(kho, { recursive: true, force: true }));

describe("tieuDeLlama", () => {
  it("không đặt biến ⇒ {} (server chưa khoá vẫn gọi như cũ)", () => {
    expect(tieuDeLlama({})).toEqual({});
  });
  it("biến chỉ có khoảng trắng ⇒ {}", () => {
    expect(tieuDeLlama({ LLAMA_SERVER_API_KEY_FILE: "   " })).toEqual({});
  });
  it("tệp có khoá kèm CRLF cuối ⇒ đúng 'Bearer <khoá đã cắt>'", () => {
    const t = path.join(kho, "k-crlf");
    fs.writeFileSync(t, `${KHOA}\r\n`);
    expect(tieuDeLlama({ LLAMA_SERVER_API_KEY_FILE: t })).toEqual({ authorization: `Bearer ${KHOA}` });
  });
  it("KHÔNG đọc giá trị LLAMA_SERVER_API_KEY — chỉ đường dẫn mới được dùng", () => {
    expect(tieuDeLlama({ LLAMA_SERVER_API_KEY: KHOA })).toEqual({});
  });
  it("biến trỏ tệp KHÔNG có ⇒ ném, thông báo nêu tên biến", () => {
    expect(() => tieuDeLlama({ LLAMA_SERVER_API_KEY_FILE: path.join(kho, "khong-co") })).toThrow(/LLAMA_SERVER_API_KEY_FILE/);
  });
  it("tệp rỗng (chỉ xuống dòng) ⇒ ném, không gửi 'Bearer ' trống", () => {
    const t = path.join(kho, "k-rong");
    fs.writeFileSync(t, "\n");
    expect(() => tieuDeLlama({ LLAMA_SERVER_API_KEY_FILE: t })).toThrow(/LLAMA_SERVER_API_KEY_FILE/);
  });
  it("thông báo lỗi KHÔNG chứa nội dung tệp (đường dẫn trỏ vào thư mục chứa tệp khoá)", () => {
    const d = path.join(kho, "thu-muc");
    fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, "ben-trong"), KHOA);
    let loi = "";
    try {
      tieuDeLlama({ LLAMA_SERVER_API_KEY_FILE: d });
    } catch (e) {
      loi = String((e as Error)?.message ?? e);
    }
    expect(loi).toMatch(/LLAMA_SERVER_API_KEY_FILE/);
    expect(loi.includes(KHOA), "thông báo lỗi chứa khoá giả").toBe(false);
  });
});

// Thêm sau khi HST duyệt (lô D1-script, 19/11 13:1x): script có cờ --url / --raw-url / --openai trỏ được tới máy chủ BẤT KỲ.
// Khoá chỉ được gửi tới ĐÚNG gốc (origin) của llama-server khai báo (LLAMA_SERVER_URL, mặc định http://127.0.0.1:8091).
describe("tieuDeLlamaCho(url)", () => {
  it("đích cùng gốc với LLAMA_SERVER_URL ⇒ có Bearer", () => {
    const t = path.join(kho, "k-cho-1");
    fs.writeFileSync(t, KHOA);
    const env = { LLAMA_SERVER_URL: "http://127.0.0.1:59999", LLAMA_SERVER_API_KEY_FILE: t };
    expect(tieuDeLlamaCho("http://127.0.0.1:59999/v1/chat/completions", env)).toEqual({ authorization: `Bearer ${KHOA}` });
  });
  it("không có LLAMA_SERVER_URL ⇒ gốc mặc định http://127.0.0.1:8091 nhận khoá", () => {
    const t = path.join(kho, "k-cho-2");
    fs.writeFileSync(t, KHOA);
    expect(tieuDeLlamaCho("http://127.0.0.1:8091/v1/models", { LLAMA_SERVER_API_KEY_FILE: t })).toEqual({ authorization: `Bearer ${KHOA}` });
  });
  it("đích KHÁC gốc (cổng khác) ⇒ {} và KHÔNG đọc tệp (tệp không có cũng không ném)", () => {
    const env = { LLAMA_SERVER_API_KEY_FILE: path.join(kho, "khong-co-2") };
    expect(tieuDeLlamaCho("http://127.0.0.1:8095/v1/chat/completions", env)).toEqual({});
  });
  it("đích khác máy (cùng cổng 8091) ⇒ {}", () => {
    const t = path.join(kho, "k-cho-3");
    fs.writeFileSync(t, KHOA);
    expect(tieuDeLlamaCho("http://10.0.0.5:8091/v1/chat/completions", { LLAMA_SERVER_API_KEY_FILE: t })).toEqual({});
  });
  it("URL hỏng ⇒ {} (không ném, không gửi khoá)", () => {
    const t = path.join(kho, "k-cho-4");
    fs.writeFileSync(t, KHOA);
    expect(tieuDeLlamaCho("khong-phai-url", { LLAMA_SERVER_API_KEY_FILE: t })).toEqual({});
  });
});

describe("urlLlama", () => {
  it("có LLAMA_SERVER_URL ⇒ dùng biến", () => {
    expect(urlLlama("http://127.0.0.1:8091", { LLAMA_SERVER_URL: "http://127.0.0.1:59999" })).toBe("http://127.0.0.1:59999");
  });
  it("không có / rỗng ⇒ mặc định người gọi đưa", () => {
    expect(urlLlama("http://127.0.0.1:8091", {})).toBe("http://127.0.0.1:8091");
    expect(urlLlama("http://127.0.0.1:8091", { LLAMA_SERVER_URL: " " })).toBe("http://127.0.0.1:8091");
  });
});
