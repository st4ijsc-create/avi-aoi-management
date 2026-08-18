/**
 * ggufCtxCap — G5-B (2026-08-16). Canh **một nguồn sự thật** cho trần `n_ctx`.
 *
 * Điều lưới này phải phát biểu được (chứ không chỉ "hàm trả đúng số"):
 *   • đổi GIÁ TRỊ NGUỒN (`GGUF_MAX_CTX`) ⇒ trần hiệu dụng đổi theo, **kể cả khi vượt 32768** —
 *     đây chính là ca mà hằng viết cứng `Math.min(max, 32768)` ở `aiModelRouter` đã nuốt;
 *   • KHÔNG còn nơi thứ hai nào trong `server/services` tự phân tích `GGUF_MAX_CTX` (vị từ đọc
 *     mã nguồn — thêm chỗ chặn thứ ba ⇒ ĐỎ, kể cả khi chưa ai viết ca cho nó).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { ggufMaxCtx, clampCtx, GGUF_MAX_CTX_DEFAULT, GGUF_MIN_CTX } from "./ggufCtxCap";

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.GGUF_MAX_CTX;
  delete process.env.GGUF_MAX_CTX;
});
afterEach(() => {
  if (saved === undefined) delete process.env.GGUF_MAX_CTX;
  else process.env.GGUF_MAX_CTX = saved;
});

describe("ggufMaxCtx — đọc tại thời điểm gọi, một nguồn duy nhất", () => {
  it("không gán ⇒ mặc định 32768", () => {
    expect(ggufMaxCtx()).toBe(GGUF_MAX_CTX_DEFAULT);
    expect(GGUF_MAX_CTX_DEFAULT).toBe(32768);
  });

  it("★ đổi giá trị nguồn ⇒ trần hiệu dụng đổi theo — KỂ CẢ VƯỢT 32768 (ca bị hằng cứng nuốt)", () => {
    process.env.GGUF_MAX_CTX = "131072";
    expect(ggufMaxCtx()).toBe(131072);
    process.env.GGUF_MAX_CTX = "262144";
    expect(ggufMaxCtx()).toBe(262144);
  });

  it("hạ trần cũng có tác dụng", () => {
    process.env.GGUF_MAX_CTX = "8192";
    expect(ggufMaxCtx()).toBe(8192);
  });

  it("giá trị rác / âm / 0 ⇒ về mặc định, KHÔNG ném", () => {
    for (const bad of ["", "abc", "-1", "0", "NaN"]) {
      process.env.GGUF_MAX_CTX = bad;
      expect(ggufMaxCtx(), `giá trị "${bad}"`).toBe(GGUF_MAX_CTX_DEFAULT);
    }
  });
});

describe("clampCtx", () => {
  it("kẹp vào [256, trần] và theo trần ĐANG cấu hình", () => {
    process.env.GGUF_MAX_CTX = "4096";
    expect(clampCtx(99999, 1024)).toBe(4096);
    expect(clampCtx(1, 1024)).toBe(GGUF_MIN_CTX);
    expect(clampCtx(2048, 1024)).toBe(2048);
  });

  it("undefined / không hợp lệ ⇒ fallback của bên gọi", () => {
    expect(clampCtx(undefined, 4096)).toBe(4096);
    expect(clampCtx(Number.NaN, 4096)).toBe(4096);
    expect(clampCtx(-5, 4096)).toBe(4096);
  });
});

/**
 * ★ VỊ TỪ, KHÔNG LIỆT KÊ TAY. Quét mã nguồn `server/**` tìm MỌI chỗ tự phân tích `GGUF_MAX_CTX`.
 * Chỉ `ggufCtxCap.ts` được phép. Một người sau thêm `Math.min(x, 32768)` ở nơi thứ ba ⇒ lưới ĐỎ
 * ngay, không cần ai nhớ viết ca cho nơi ấy.
 */
describe("★ không có nơi chặn thứ hai", () => {
  const ROOT = path.resolve(__dirname, "..", "..");

  function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "dist" || e.name === "build") continue;
        walk(p, out);
      } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
        out.push(p);
      }
    }
    return out;
  }

  it("chỉ ggufCtxCap.ts đọc thẳng process.env.GGUF_MAX_CTX trong server/**", () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      if (path.basename(file) === "ggufCtxCap.ts") continue;
      const src = fs.readFileSync(file, "utf8");
      // Bỏ qua chú thích/chuỗi mô tả: chỉ tính lượt ĐỌC env thật sự.
      if (/process\.env\.GGUF_MAX_CTX|process\.env\[\s*["']GGUF_MAX_CTX["']\s*\]/.test(src)) {
        offenders.push(path.relative(ROOT, file).replace(/\\/g, "/"));
      }
    }
    expect(offenders, `các file này tự phân tích GGUF_MAX_CTX thay vì gọi ggufMaxCtx()`).toEqual([
      // `aiLlamaServerClient.ts` KHÔNG phải chỗ chặn ctx của engine: nó dựng CỜ DÒNG LỆNH cho
      // tiến trình `llama-server` NGOÀI (`--ctx-size` mỗi slot), một mặt phẳng khác. Được khai
      // TƯỜNG MINH ở đây để nó không lặng lẽ biến thành chỗ chặn thứ hai: ai đổi nó thành phép
      // kẹp `contextSize` in-process sẽ phải đụng dòng này và giải thích.
      "services/aiLlamaServerClient.ts",
    ]);
  });
});
