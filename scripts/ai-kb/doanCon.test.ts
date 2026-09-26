import { describe, it, expect } from "vitest";
// @ts-expect-error — module .mjs thuần, không có khai báo kiểu
import { tachDoanCon } from "./_doan-con.mjs";

const DOC = [
  "# AOI Workflow",
  "## Xử lý NG",
  "Bảng NG được đưa sang trạm sửa. Kỹ thuật viên kiểm tra lại từng điểm lỗi theo danh mục.",
  "Nếu sửa 2 lần rework mà vẫn hỏng thì loại bỏ (scrap) và ghi nhận vào hệ thống.",
  "## Mức độ",
  "| Mức | Mã | Xử lý |",
  "|---|---|---|",
  "| Minor | MI | Ghi nhận, không cần rework ngay |",
  "## Bảng lớn",
  "| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |\n| 7 | 8 |\n| 9 | 10 |",
].join("\n\n");

describe("tachDoanCon — đoạn con văn xuôi/danh sách", () => {
  const con = tachDoanCon(DOC, { maxCon: 200 }) as string[];
  it("★ mỗi đoạn con mang tiêu đề mục", () => {
    const rework = con.find((c) => c.includes("2 lần rework"));
    expect(rework).toBeDefined();
    expect(rework!.startsWith("## Xử lý NG")).toBe(true);
  });
  it("★ bảng NHỎ giữ làm đoạn con; bảng LỚN (đã có nhóm dòng) bị bỏ qua", () => {
    expect(con.some((c) => c.includes("| Minor | MI |"))).toBe(true);
    expect(con.some((c) => c.includes("| 9 | 10 |"))).toBe(false);
  });
  it("đoạn con TRÙNG nguyên văn đoạn gốc bị bỏ", () => {
    const mot = tachDoanCon("## A\n\nmột đoạn văn đủ dài để vượt ngưỡng tối thiểu sáu mươi ký tự của đoạn con nhé.", {});
    expect(mot).toHaveLength(1);
    expect(tachDoanCon("## A\n\nmột đoạn văn đủ dài để vượt ngưỡng tối thiểu sáu mươi ký tự của đoạn con nhé.", { doanGoc: mot })).toEqual([]);
  });
  it("rỗng ⇒ rỗng", () => expect(tachDoanCon(undefined)).toEqual([]));
});
