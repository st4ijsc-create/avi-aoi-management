/**
 * seed-twin-mau.unit.test.ts — CHỐT "MỘT BẢN CÀI ĐẶT DUY NHẤT"
 * ============================================================================
 *
 * Spec §8 hứa: "server gọi lại chính module này để không có hai bản cài đặt lệch
 * nhau". Trước bản vá này lời hứa ấy SAI: `scripts/seed-twin-mau.ts` có hàm
 * `lechYMay` riêng, khác THUẬT TOÁN với `lechTrongTram` của `sinhBoCuc.ts`
 * (đối xứng quanh tâm vs máy-0-tại-tâm-rồi-toả-hai-phía). Triệu chứng đo được:
 * seed xong rồi bấm "Sinh tự động" thì bố cục ĐỔI dù không ai sửa gì.
 *
 * Các test dưới đây KHÔNG kiểm "hàm trả đúng số" — `sinhBoCuc.unit.test.ts` đã
 * làm việc đó ở T1–T9. Chúng kiểm thứ mà một test giá-trị KHÔNG BAO GIỜ bắt
 * được: rằng script seed vẫn còn DÙNG CHUNG bản cài đặt ấy, chứ không âm thầm
 * mọc lại một bản sao. Một bản sao chép đúng công thức sẽ làm mọi test giá-trị
 * XANH và vẫn tái tạo nguyên vẹn lớp lỗi này — nên phép đo phải nhắm vào NGUỒN
 * của tệp, không vào đầu ra của hàm.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { lechTrongTram } from "../client/src/components/twin3d/sinhBoCuc.ts";

const thuMuc = path.dirname(fileURLToPath(import.meta.url));
const DUONG_SEED = path.join(thuMuc, "seed-twin-mau.ts");
const nguonSeed = fs.readFileSync(DUONG_SEED, "utf8");

/** Bỏ mọi chú thích để không chấm nhầm vào docblock lịch sử. */
function boChuThich(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}
const maSeed = boChuThich(nguonSeed);

describe("seed-twin-mau — một bản cài đặt duy nhất cho độ lệch máy trong trạm", () => {
  it("IMPORT `lechTrongTram` từ sinhBoCuc.ts (không tự cài lại)", () => {
    expect(maSeed).toMatch(
      /import\s*\{[^}]*\blechTrongTram\b[^}]*\}\s*from\s*["'][^"']*twin3d\/sinhBoCuc\.ts["']/,
    );
  });

  it("KHÔNG còn định nghĩa `lechYMay` — bản cài đặt thứ hai đã bị xoá", () => {
    // Chỉ chấm ĐỊNH NGHĨA. Docblock được phép nhắc tên để giữ lịch sử vì sao.
    expect(maSeed).not.toMatch(/function\s+lechYMay\b/);
    expect(maSeed).not.toMatch(/\blechYMay\s*[=(]/);
  });

  it("KHÔNG chép lại công thức lệch dưới bất kỳ tên nào khác", () => {
    // Hai dấu vân tay của hai thuật toán đã biết:
    //   - đối xứng quanh tâm: `(i − (n−1)/2) × bước`
    //   - toả hai phía      : `Math.ceil(i / 2)` kèm dấu theo `% 2`
    // Bản sao nào cũng phải mang một trong hai. `lechTrongTram` là hàm DUY NHẤT
    // được phép chứa chúng, và nó không sống trong tệp này.
    expect(maSeed).not.toMatch(/-\s*\(\s*\w+\s*-\s*1\s*\)\s*\/\s*2/);
    expect(maSeed).not.toMatch(/Math\.ceil\s*\(\s*\w+\s*\/\s*2\s*\)/);
  });

  it("mọi nơi tính lệch đều gọi `lechTrongTram` với bước từ CAU_HINH", () => {
    const goi = maSeed.match(/lechTrongTram\s*\(/g) ?? [];
    // Hai điểm: (1) tính nửa bề sâu chuyền dày nhất, (2) đặt máy.
    expect(goi.length).toBe(2);
    expect(maSeed).toMatch(/lechTrongTram\(\s*i\s*,\s*CAU_HINH\.buocMayTrongTramMm\s*\)/);
  });
});

describe("seed-twin-mau — đọc máy CÙNG NGỮ NGHĨA với sinhBoCuc", () => {
  /*
   * Gộp riêng công thức KHÔNG đủ để hai bên khớp — đo lại vẫn còn 6 hàng lệch.
   * `sinhBoCuc` xếp máy bằng `sapTheoMa` (code, rồi id) và LỌC `isActive`; truy
   * vấn của seed trước đây sắp theo `id` và không lọc. Cùng một công thức, hai
   * thứ tự đầu vào ⇒ hai vị trí. Hai test dưới khoá lại đúng hai điểm ấy.
   */
  it("sắp máy theo `code` rồi `id` — khớp `sapTheoMa`, KHÔNG theo id đơn thuần", () => {
    expect(maSeed).toMatch(/ORDER BY m\."stationId",\s*m\.code,\s*m\.id/);
    expect(maSeed).not.toMatch(/ORDER BY m\."stationId",\s*m\.id\b/);
  });

  it("lọc máy ngừng hoạt động — khớp `.filter((m) => m.isActive)`", () => {
    expect(maSeed).toMatch(/AND m\."isActive"/);
  });
});

describe("lechTrongTram — tính chất mà bản đối xứng KHÔNG có", () => {
  /*
   * Lý do chủ sở hữu chọn `sinhBoCuc` làm nguồn sự thật, viết thành phép đo:
   * thêm/bớt máy vào trạm thì máy CŨ KHÔNG DỊCH CHỖ. Công thức đối xứng cũ vi
   * phạm đúng tính chất này — và đó là thứ xoá công sức của người đã kéo tay.
   */
  it("vị trí máy thứ i KHÔNG phụ thuộc số máy trong trạm", () => {
    // `lechTrongTram` không nhận `soMay` — chữ ký đã bảo đảm điều đó. Ở đây đo
    // hệ quả: dựng vị trí cho trạm n máy với mọi n, máy cũ giữ nguyên chỗ.
    const buoc = 1400;
    const viTri = (n: number) => Array.from({ length: n }, (_, i) => lechTrongTram(i, buoc));
    for (let n = 1; n < 8; n++) {
      expect(viTri(n)).toEqual(viTri(n + 1).slice(0, n));
    }
  });

  it("máy đầu luôn ở tâm trạm với mọi số máy", () => {
    for (let n = 1; n < 8; n++) expect(lechTrongTram(0, 1400)).toBe(0);
  });

  it("đối chứng: công thức đối xứng CŨ vi phạm tính chất trên", () => {
    // Ca dương của phép đo — nếu bản cũ cũng "đạt" thì test trên không đo gì.
    const cu = (i: number, n: number, buoc: number) =>
      n <= 1 ? 0 : (i - (n - 1) / 2) * buoc;
    const viTriCu = (n: number) => Array.from({ length: n }, (_, i) => cu(i, n, 1400));
    expect(viTriCu(2)).not.toEqual(viTriCu(3).slice(0, 2));
  });
});
