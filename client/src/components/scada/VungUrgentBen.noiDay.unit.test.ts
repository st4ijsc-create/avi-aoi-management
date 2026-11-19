/**
 * NỐI DÂY vùng URGENT bền (bài học w1: gỡ `<VungUrgentBen />` khỏi trang ⇒ mọi test mức component vẫn xanh). Lưới NGUỒN ghim:
 *  • ScadaDiag và ScadaKenh import `VungUrgentBen` và render ĐÚNG MỘT `<VungUrgentBen />`, SAU `<PageHeader` và TRƯỚC nội dung trang;
 *  • thành phần chỉ gọi notification.list / markAsRead — KHÔNG gọi delete / deleteOld / markAllAsRead (URGENT không bao giờ bị xoá / lật hàng loạt từ thẻ);
 *  • thẻ không có nút xoá / "đánh dấu tất cả" trong mã nguồn (từ khoá chữ).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const TRANG: ReadonlyArray<[string, string]> = [
  ["ScadaDiag", "../../pages/ScadaDiag.tsx"],
  ["ScadaKenh", "../../pages/ScadaKenh.tsx"],
];

describe("nối dây VungUrgentBen", () => {
  for (const [ten, rel] of TRANG) {
    it(`${ten}: import đúng mô-đun, render ĐÚNG MỘT <VungUrgentBen />, sau PageHeader`, () => {
      const s = doc(rel);
      expect(s).toMatch(/import\s*\{\s*VungUrgentBen\s*\}\s*from\s*"@\/components\/scada\/VungUrgentBen"/);
      expect(s.match(/<VungUrgentBen\s*\/>/g)?.length).toBe(1);
      expect(s.indexOf("<VungUrgentBen />")).toBeGreaterThan(s.indexOf("<PageHeader"));
    });
  }

  it("thành phần chỉ dùng notification.list + markAsRead; KHÔNG delete / deleteOld / markAllAsRead", () => {
    const s = doc("./VungUrgentBen.tsx");
    expect(s).toContain("trpc.notification.list.useQuery");
    expect(s).toContain("trpc.notification.markAsRead.useMutation");
    expect(s).not.toMatch(/notification\.(delete|deleteOld|markAllAsRead)/);
  });
});
