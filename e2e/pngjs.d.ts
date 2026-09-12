/**
 * ★ ĐỢT 56 (mục B) — KHAI KIỂU TỐI THIỂU CHO `pngjs`, chỉ cho `e2e/`.
 *
 * VÌ SAO CÓ TỆP NÀY (đo được 2026-09-12):
 *   · `e2e/` vừa được đưa vào cổng kiểu (`tsconfig.tests.json`). Hai spec đo pixel
 *     (`twin-lo-u-tuong-tac`, `twin-lo-v-tuong-tac`) `import { PNG } from "pngjs"`,
 *     mà `node_modules/@types/pngjs` KHÔNG có ⇒ TS7016 × 2.
 *   · ⚠⚠ Quan trọng hơn: **`pngjs` KHÔNG được khai trong `package.json`** — không ở
 *     `dependencies` lẫn `devDependencies`. Nó chỉ đang tồn tại như phụ thuộc BẮC CẦU.
 *     17 chỗ gọi trong 2 spec + ~10 script QA (`.qa-dot30/do-anh.mjs` … `.qa-dot53/thigiac53.mjs`)
 *     đều dựa vào nó. Một lần `npm ci` mà cây phụ thuộc đổi là MỌI phép đo pixel chết.
 *     Đây là NỢ đã ghi vào `.qa-dot56/NO.md`, cần chủ sở hữu quyết (xem mục B trong báo cáo).
 *
 * PHẠM VI: chỉ khai đúng bề mặt đang dùng — `PNG.sync.read(buffer)` và 3 ô `width`/`height`/`data`.
 * Cố ý KHÔNG khai rộng hơn: một khai báo tay rộng quá sẽ nói dối về những API chưa ai kiểm.
 * Khi `@types/pngjs` (6.0.5 trên registry) được thêm thật, XOÁ tệp này.
 */
declare module "pngjs" {
  /** Ảnh PNG đã giải mã — `data` là RGBA phẳng, 4 byte / điểm ảnh. */
  export interface PNGWithMetadata {
    width: number;
    height: number;
    data: Buffer;
  }
  export const PNG: {
    sync: {
      read(buffer: Buffer): PNGWithMetadata;
      write(png: PNGWithMetadata): Buffer;
    };
  };
}
