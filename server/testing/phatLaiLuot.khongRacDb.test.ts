/**
 * Khoá CẤU TRÚC của `phatLaiLuot.test.ts` (vòng ghi ⇒ đóng gói ⇒ phát lại với sổ THẬT): tệp này từng rò +6 `audit_logs` / +2 `ai_pending_actions` mỗi lượt cổng — giờ mọi ca chạm DB đi qua vỏ ROLLBACK DÙNG CHUNG
 * (`trongRollbackPhatLai.ts`; cấu trúc vỏ + việc ba tệp không tự dựng vỏ được khoá ở `trongRollbackPhatLai.test.ts`). Ở đây: mock kênh, hook, đúng 3 ca bọc vỏ, và ca `epDo` ép từ chối. THUẦN: đọc mã bằng chuỗi; KHÔNG chạm CSDL.
 * ĐỘT BIẾN PHẢI BẮT: bỏ mock `getDb` hoặc bốn hàm kết nối khác · bỏ `afterEach(kiemKhongLot)` · gọi `chay`/`ghiFixture` ngoài `trongRollback` · bỏ cách ép từ chối thật ở `epDo`.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const nguon = fs.readFileSync(path.join(__dirname, "phatLaiLuot.test.ts"), "utf8");
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("phatLaiLuot.test.ts — không để lại hàng nào trong CSDL", () => {
  it("khởi tạo kênh phải có `goi: {}` để có bản tóm tắt chẩn đoán", () => {
    expect(nguon).toMatch(/vi\.hoisted\(\(\): KenhGiaoDich => \(\{ db: null, lot: \[\], goi: \{\} \}\)\)/);
  });
  it("★★★ mock `../db/connection`: `getDb` = `layDbTheoKenh(kenh)`; bốn hàm kết nối khác đè bằng `ghiNoiKhac`; `afterEach`/`afterAll` gọi `kiemKhongLot`", () => {
    expect(nguon).toMatch(/vi\.mock\("\.\.\/db\/connection"/);
    expect(nguon).toMatch(/getDb:\s*async\s*\(\)\s*=>\s*layDbTheoKenh\(kenh\)/);
    for (const ten of ["getJobsDb", "getReadDb", "openSessionClient", "getNotifyClient"]) {
      expect(nguon, ten).toMatch(new RegExp(`${ten}:\\s*(async\\s*)?\\(\\)\\s*=>\\s*ghiNoiKhac\\(kenh,\\s*"${ten}"\\)`));
    }
    expect(nguon).toMatch(/afterEach\(\(\)\s*=>\s*kiemKhongLot\(kenh\)\)/);
    expect(nguon).toMatch(/afterAll\(\(\) => \{\s*kiemKhongLot\(kenh\);/);
  });
  it("★★★ mọi ca chạm sổ (`ghiFixture` / `chay`) nằm TRONG `trongRollback(async (uid) => …)`; hook `beforeAll` không còn tạo người dùng hay chạy lượt", () => {
    const tenHook = /beforeAll\(\(\) => \{([\s\S]*?)\n\}\);/.exec(nguon);
    expect(tenHook, "beforeAll đồng bộ, không chạm DB").not.toBeNull();
    expect(/ghiFixture|chay\(|taoQuanLyLuotChay/.test(tenHook![1]!)).toBe(false);
    const caDb = [...nguon.matchAll(/", \(\) => trongRollback\(async \(uid\) => \{/g)].length;
    expect(caDb, "đúng 3 ca chạm DB bọc trong trongRollback").toBe(3);
  });
});

describe("phatLaiFixture.epDo.db.test.ts — ca ép `apply_diff` bị từ chối, đếm theo userId", () => {
  const ep = fs.readFileSync(path.join(__dirname, "phatLaiFixture.epDo.db.test.ts"), "utf8");
  it("★★★ ca thứ 3: ép từ chối THẬT ở RBAC lần 2 (cặp proposed → denied), khẳng định đường từ chối đã chạy thật (đếm `ai_action_denied` theo userId TRONG giao dịch) rồi mới đo rò rỉ trước/sau ROLLBACK", () => {
    // đường từ chối THẬT: vai operator có hàng quyền, cổng checkpoint (tiêm) thu hồi canEdit giữa đề xuất và duyệt ⇒ cặp proposed → denied
    expect(ep).toMatch(/role: tuChoi \? "operator" : "admin"/);
    expect(ep).toMatch(/tx\.insert\(permissions\)/);
    expect(ep).toMatch(/set\(\{ canEdit: false \}\)\.where\(and\(eq\(permissions\.userId, uidNguoi\), eq\(permissions\.moduleName, "ai_repo_read"\)\)\)[\s\S]{0,120}?return that\.chupTruocGhi\(y\)/);
    expect(ep).toMatch(/eq\(auditLogs\.action, "ai_action_proposed"\)/);
    expect(ep).toMatch(/expect\(k\.daDeXuat[\s\S]{0,120}?\)\.toBeGreaterThan\(0\)/);
    expect(/AI_REPO_SANDBOX_ROOTS = `phatlaifx=Phat lai fixture\|\$\{ngoai\}`/.test(ep), "không còn cách ép bằng đổi gốc hộp cát (không gây từ chối)").toBe(false);
    expect(ep).toMatch(/eq\(auditLogs\.action, "ai_action_denied"\)/);
    expect(ep).toMatch(/epDo\(null, \{\}, "tu-choi-apply-diff"\)/);
    expect(ep).toMatch(/expect\(k\.daTuChoi[\s\S]{0,200}?\)\.toBeGreaterThan\(0\)/);
    // đếm rò rỉ nằm TRƯỚC khi trả kênh
    expect(ep).toMatch(/kq\.daTuChoi = [\s\S]{0,500}?kq\.roTruocRollback = await demHangRoRi\(userId\);/);
    expect(/\.delete\(|DELETE\s+FROM|TRUNCATE/i.test(boChuThich(ep))).toBe(false);
  });
});
