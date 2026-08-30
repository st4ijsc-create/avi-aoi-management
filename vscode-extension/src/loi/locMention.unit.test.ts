/**
 * LƯỚI vị từ THUẦN lọc danh sách @-mention. Xem docblock `locMention.ts` cho vì sao hàm này KHÔNG
 * chạm `@` (webview đã cắt ký tự đó trước khi gửi `truy` — bài học `/ai-coding-workspace`).
 */
import { describe, it, expect } from "vitest";
import { locDanhSachMention } from "./locMention";

describe("locDanhSachMention", () => {
  it("★★★ truy RỖNG ⇒ trả về ĐẦU danh sách (không phải mảng rỗng) — thấy gợi ý trước khi gõ thêm", () => {
    const ds = ["a.ts", "b.ts", "c.ts"];
    expect(locDanhSachMention(ds, "")).toEqual(ds);
  });

  it("★★★ lọc theo CHUỖI CON, không phân biệt hoa/thường", () => {
    const ds = ["src/Calculator.cs", "src/config.ts", "README.md"];
    expect(locDanhSachMention(ds, "calc")).toEqual(["src/Calculator.cs"]);
    expect(locDanhSachMention(ds, "CONFIG")).toEqual(["src/config.ts"]);
  });

  it("★★ không khớp gì ⇒ mảng rỗng (không rơi về toàn bộ danh sách)", () => {
    expect(locDanhSachMention(["a.ts", "b.ts"], "khong-ton-tai")).toEqual([]);
  });

  it("★★★ khớp Ở VỊ TRÍ SỚM HƠN đứng TRƯỚC khớp ở giữa tên", () => {
    const ds = ["app/legacy/src/foo/old.ts", "src/foo.ts"];
    expect(locDanhSachMention(ds, "src/foo")).toEqual(["src/foo.ts", "app/legacy/src/foo/old.ts"]);
  });

  it("★★ cùng vị trí khớp ⇒ đường NGẮN hơn đứng trước", () => {
    const ds = ["a/b.ts", "a/b-longer-name.ts"];
    expect(locDanhSachMention(ds, "a/b")).toEqual(["a/b.ts", "a/b-longer-name.ts"]);
  });

  it("★★★ giới hạn `tran` — danh sách dài không tràn ra một dropdown vô dụng", () => {
    const ds = Array.from({ length: 100 }, (_, i) => `f${i}.ts`);
    expect(locDanhSachMention(ds, "f", 5)).toHaveLength(5);
    expect(locDanhSachMention(ds, "", 5)).toHaveLength(5);
  });

  it("★ khoảng trắng quanh truy bị cắt trước khi so", () => {
    expect(locDanhSachMention(["a.ts"], "  a  ")).toEqual(["a.ts"]);
  });
});
