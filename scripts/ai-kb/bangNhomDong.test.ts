import { describe, it, expect } from "vitest";
// @ts-expect-error — module .mjs thuần, không có khai báo kiểu
import { tachBangThanhNhom } from "./_bang-nhom-dong.mjs";

const DOC = [
  "# AOI Troubleshooting",
  "### E041 – E090: Lỗi",
  "| Mã | Mô tả | Xử lý |",
  "|----|-------|-------|",
  "| E041 | Network lost | Kiểm tra cáp |",
  "| E042 | DB fail | Kiểm tra SQL |",
  "| E043 | MES error | Kiểm tra MES |",
  "| E061 | Fiducial not found | Làm sạch fiducial |",
  "| E082 | Air pressure low | Kiểm tra máy nén khí |",
  "",
  "### Bảng nhỏ",
  "| A | B |",
  "|---|---|",
  "| 1 | 2 |",
].join("\n");

describe("tachBangThanhNhom — đoạn bổ sung theo nhóm dòng bảng", () => {
  const nhom = tachBangThanhNhom(DOC) as string[];
  it("★ bảng 5 dòng ⇒ 2 nhóm (4 + 1); bảng nhỏ (< 5 dòng) KHÔNG tách", () => {
    expect(nhom).toHaveLength(2);
  });
  it("★★ mỗi nhóm mang tiêu đề mục + dòng tiêu đề bảng (dòng lẻ vẫn có nghĩa)", () => {
    for (const n of nhom) {
      expect(n).toContain("### E041 – E090: Lỗi");
      expect(n).toContain("| Mã | Mô tả | Xử lý |");
    }
    expect(nhom[1]).toContain("E082");
    expect(nhom[1]).not.toContain("| E041 |");
  });
  it("không bảng ⇒ rỗng; đầu vào rác ⇒ rỗng", () => {
    expect(tachBangThanhNhom("chỉ văn bản")).toEqual([]);
    expect(tachBangThanhNhom(undefined)).toEqual([]);
  });
});
