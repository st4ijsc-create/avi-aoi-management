/**
 * Khoá CẤU TRÚC của `phatLaiFixture.test.ts` để phát lại không quay lại để rác trong `_test` (mỗi lượt cổng từng để ~240 hàng `audit_logs` — bảng WORM, không xoá được — và ~80 `ai_pending_actions`).
 * Vỏ giao dịch ROLLBACK + đếm rò rỉ nằm ở MỘT chỗ (`trongRollbackPhatLai.ts`, khoá ở `trongRollbackPhatLai.test.ts` — gồm việc tệp này KHÔNG tự dựng vỏ). Ở đây: mock kênh `getDb` + bốn hàm kết nối khác,
 * `afterEach`/`afterAll` làm ca ĐỎ khi có lời gọi lọt ngoài giao dịch, khởi tạo kênh có `goi`, không `taoNguoiDungTest`. THUẦN: đọc mã nguồn bằng chuỗi; KHÔNG chạm CSDL.
 * ĐỘT BIẾN PHẢI BẮT: bỏ mock `getDb` hoặc bốn hàm kết nối khác · import lại `taoNguoiDungTest` · bỏ `afterEach(kiemKhongLot)` · import `getDb` thẳng (sẽ là bản bị mock).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const nguon = fs.readFileSync(path.join(__dirname, "phatLaiFixture.test.ts"), "utf8");
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("phatLaiFixture.test.ts — không để lại hàng nào trong CSDL", () => {
  it("★★★ khởi tạo kênh có `goi: {}` (bản tóm tắt chẩn đoán); không dùng `taoNguoiDungTest`", () => {
    expect(nguon).toMatch(/vi\.hoisted\(\(\): KenhGiaoDich => \(\{ db: null, lot: \[\], goi: \{\} \}\)\)/);
    expect(/taoNguoiDungTest|nguoiDungTest/.test(boChuThich(nguon))).toBe(false);
  });
  it("★★★ mock `../db/connection`: `getDb` = `layDbTheoKenh(kenh)`; `getJobsDb` / `getReadDb` / `openSessionClient` / `getNotifyClient` đều đè bằng `ghiNoiKhac` (lộ ngay nếu đường phát lại chạm chúng)", () => {
    expect(nguon).toMatch(/vi\.mock\("\.\.\/db\/connection"/);
    expect(nguon).toMatch(/getDb:\s*async\s*\(\)\s*=>\s*layDbTheoKenh\(kenh\)/);
    for (const ten of ["getJobsDb", "getReadDb", "openSessionClient", "getNotifyClient"]) {
      expect(nguon, ten).toMatch(new RegExp(`${ten}:\\s*(async\\s*)?\\(\\)\\s*=>\\s*ghiNoiKhac\\(kenh,\\s*"${ten}"\\)`));
    }
    expect(nguon).toMatch(/afterEach\(\(\)\s*=>\s*kiemKhongLot\(kenh\)\)/);
    expect(nguon).toMatch(/afterAll\(async \(\) => \{\s*kiemKhongLot\(kenh\);/);
  });
  it("★★★ không import `getDb` thẳng từ `../db/connection` (sẽ là bản bị mock)", () => {
    expect(/import\s*\{[^}]*\bgetDb\b[^}]*\}\s*from\s*"\.\.\/db\/connection"/.test(nguon)).toBe(false);
  });
});
