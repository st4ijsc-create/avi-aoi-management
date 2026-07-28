/**
 * Wave 2 đường B — Task 5: `filesFromInput` / `filesFromDrop` (chuẩn hoá danh sách file cho
 * ingest nhiều-file + kéo-thả THẬT trong SourceTab.tsx).
 *
 * ⚠ Đặt tên `*.unit.test.ts` bắt buộc — `vitest.config.ts:27` chỉ glob mẫu đó cho
 * `client/src/**`; tên khác sẽ không bao giờ được chạy (đỏ giả vĩnh viễn).
 */
import { describe, it, expect } from "vitest";
import { filesFromInput, filesFromDrop, isQueuedFileStillPending } from "./sourceTabLogic";

const f = (name: string) => ({ name }) as File;

describe("filesFromInput", () => {
  it("lấy TẤT CẢ file, không chỉ file đầu", () => {
    expect(filesFromInput([f("a.pdf"), f("b.docx"), f("c.md")] as any).map((x) => x.name)).toEqual([
      "a.pdf",
      "b.docx",
      "c.md",
    ]);
  });
  it("null/rỗng ⇒ mảng rỗng", () => {
    expect(filesFromInput(null as any)).toEqual([]);
    expect(filesFromInput([] as any)).toEqual([]);
  });
});

describe("filesFromDrop", () => {
  it("lấy file từ DataTransfer.files", () => {
    const dt = { files: [f("x.pdf"), f("y.png")] } as any;
    expect(filesFromDrop(dt).map((x) => x.name)).toEqual(["x.pdf", "y.png"]);
  });
  it("DataTransfer không có file ⇒ rỗng, không ném", () => {
    expect(filesFromDrop({} as any)).toEqual([]);
    expect(filesFromDrop(null as any)).toEqual([]);
  });
});

// ─── Vòng sửa 1 (review) — huỷ file TRONG LÚC lô đang gửi phải huỷ THẬT ──────
// Bug: handleUpload cũ chụp snapshot hàng đợi lúc bấm "Gửi" rồi lặp qua snapshot đó; xoá một
// file "waiting" khỏi màn hình trong lúc lô đang chạy KHÔNG ngăn nó vẫn được gửi ở lượt kế —
// UI nói đã xoá nhưng job vẫn chạy, tổng kết cuối cùng nói dối ("Xong 3/3" dù chỉ còn 2 dòng).
// `isQueuedFileStillPending` là hàm thuần dùng để kiểm tra NGAY TRƯỚC KHI gửi từng file, đọc
// từ hàng đợi SỐNG (không phải snapshot) — nếu file đã bị xoá thì bỏ qua, không gửi, không
// tính vào tổng.
describe("isQueuedFileStillPending", () => {
  it("id còn trong hàng đợi hiện tại ⇒ true (vẫn nên gửi)", () => {
    expect(isQueuedFileStillPending("b", [{ id: "a" }, { id: "b" }, { id: "c" }])).toBe(true);
  });
  it("id đã bị xoá khỏi hàng đợi ⇒ false (bỏ qua, không gửi)", () => {
    expect(isQueuedFileStillPending("b", [{ id: "a" }, { id: "c" }])).toBe(false);
  });
  it("hàng đợi rỗng ⇒ false", () => {
    expect(isQueuedFileStillPending("a", [])).toBe(false);
  });
});
