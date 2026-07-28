/**
 * Wave 2 đường B — Task 5: `filesFromInput` / `filesFromDrop` (chuẩn hoá danh sách file cho
 * ingest nhiều-file + kéo-thả THẬT trong SourceTab.tsx).
 *
 * ⚠ Đặt tên `*.unit.test.ts` bắt buộc — `vitest.config.ts:27` chỉ glob mẫu đó cho
 * `client/src/**`; tên khác sẽ không bao giờ được chạy (đỏ giả vĩnh viễn).
 */
import { describe, it, expect } from "vitest";
import { filesFromInput, filesFromDrop } from "./sourceTabLogic";

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
