/**
 * LƯỚI cho `dayBoNhoDoc.ts` — ĐỢT H / TASK H3. Cùng khuôn `dayMcpDoc.unit.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { dungVanBanDayBoNho } from "./dayBoNhoDoc";
import { docDeXuatNho } from "./deXuatNho";
import type { MucBoNho } from "./khoBoNho";

function muc(noiDung: string): MucBoNho {
  return { ma: "m", noiDung, thoiDiem: 1, nguon: "nguoi_dung_bao_nho" };
}

describe("dungVanBanDayBoNho", () => {
  it("★★★ danh sách RỖNG ⇒ chuỗi RỖNG (workspace chưa từng dùng 'Nhớ điều này' không bị phình câu hỏi)", () => {
    expect(dungVanBanDayBoNho([])).toBe("");
  });

  it("★★ có mục nhớ ⇒ liệt kê ĐÚNG nội dung", () => {
    const vb = dungVanBanDayBoNho([muc("Dự án dùng workspaceState, không dùng globalState.")]);
    expect(vb).toContain("Dự án dùng workspaceState, không dùng globalState.");
  });

  it("★★ nhiều mục ⇒ liệt kê đủ, đúng thứ tự", () => {
    const vb = dungVanBanDayBoNho([muc("mục một"), muc("mục hai")]);
    expect(vb).toContain("mục một");
    expect(vb).toContain("mục hai");
    expect(vb.indexOf("mục một")).toBeLessThan(vb.indexOf("mục hai"));
  });

  it("★★★ ví dụ khối rào trong văn bản dạy PARSE ĐƯỢC bằng ĐÚNG docDeXuatNho — không lệch cú pháp", () => {
    const vb = dungVanBanDayBoNho([muc("có ít nhất một mục để kích hoạt teaching")]);
    const de = docDeXuatNho(vb);
    expect(de).toHaveLength(1);
    expect(typeof de[0]!.noiDung).toBe("string");
  });

  it("★★★ B4 — nói RÕ đây là DỮ LIỆU, KHÔNG PHẢI chỉ dẫn thực thi", () => {
    const vb = dungVanBanDayBoNho([muc("x")]);
    expect(vb).toMatch(/DỮ LIỆU/);
    expect(vb).toMatch(/KHÔNG PHẢI/);
  });

  it("★ nhắc người dùng phải DUYỆT — AI không tự ghi được", () => {
    const vb = dungVanBanDayBoNho([muc("x")]);
    expect(vb).toContain("KHÔNG tự ghi được");
  });
});
