/**
 * C0-3 — NỐI DÂY lớp DỪNG MÁY nổi (kiem-dinh 2026-11-06, đột biến w1: xoá `<LopDungMayNoi />` khỏi App.tsx ⇒ 124/124 test vẫn xanh,
 * vì lớp chỉ được test ở mức component). Lưới NGUỒN này ghim phần nối (mẫu: CongMoDunRobot.noiDay.unit.test.ts):
 *   • App.tsx import `LopDungMayNoi` từ "@/components/scada/LopDungMayNoi" và render ĐÚNG MỘT `<LopDungMayNoi />`;
 *   • nó nằm TRƯỚC `<Router />` (ngoài Suspense / Switch của route ⇒ không bị route nào gỡ);
 *   • trần số nút nổi ghim SỐ 3 (không so với chính hằng số).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TOI_DA_NUT_NOI } from "./LopDungMayNoi";

const app = readFileSync(resolve(__dirname, "../../App.tsx"), "utf8");

describe("C0-3 nối dây — App.tsx", () => {
  it("import LopDungMayNoi từ đúng mô-đun", () => {
    expect(app).toMatch(/import\s*\{\s*LopDungMayNoi\s*\}\s*from\s*"@\/components\/scada\/LopDungMayNoi"/);
  });

  it("render ĐÚNG MỘT <LopDungMayNoi />, trước <Router /> (ngoài Suspense/Switch)", () => {
    expect(app.match(/<LopDungMayNoi\s*\/>/g)?.length).toBe(1);
    const lop = app.indexOf("<LopDungMayNoi />");
    const router = app.indexOf("<Router />");
    expect(router).toBeGreaterThan(-1);
    expect(lop).toBeLessThan(router);
  });
});

describe("C0-3 — trần số nút nổi", () => {
  it("TOI_DA_NUT_NOI = 3 (ghim số, không so với chính hằng số)", () => {
    expect(TOI_DA_NUT_NOI).toBe(3);
  });
});
