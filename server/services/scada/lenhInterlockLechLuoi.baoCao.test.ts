/**
 * kiem-dinh R1b-1 N-1 (điều phối 2026-10-25) — "Chuỗi SQL trong báo cáo phải khớp NGUYÊN VĂN hằng trong mã". Khối ```sql của báo cáo nghiệm thu
 * §4 mục 2 (thụt 3 dấu cách vì nằm trong danh sách; dòng chú thích đầu `-- R1b-1 §4 mục 2` không thuộc hằng) bỏ thụt lề phải BẰNG
 * `TRUY_VAN_TRUOC_TRIEN_KHAI` từng ký tự. Sửa hằng mà quên báo cáo (hay ngược lại) ⇒ ĐỎ.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TRUY_VAN_TRUOC_TRIEN_KHAI } from "./lenhInterlockLechLuoi";

const BAO_CAO = path.resolve(__dirname, "../../../docs/superpowers/plans/2026-10-24-scada-r1b-1-bao-cao-nghiem-thu.md");

function khoiSqlBaoCao(): string {
  const doc = readFileSync(BAO_CAO, "utf8").replace(/\r\n/g, "\n");
  const dau = doc.indexOf("   ```sql\n   -- R1b-1 §4 mục 2");
  expect(dau, "báo cáo §4 mục 2 phải có khối ```sql bắt đầu bằng chú thích '-- R1b-1 §4 mục 2'").toBeGreaterThan(-1);
  const sauChuThich = doc.indexOf("\n", doc.indexOf("-- R1b-1 §4 mục 2", dau)) + 1;
  const cuoi = doc.indexOf("   ```\n", sauChuThich);
  return doc
    .slice(sauChuThich, cuoi)
    .replace(/\n$/, "")
    .split("\n")
    .map((l) => (l.startsWith("   ") ? l.slice(3) : l))
    .join("\n");
}

describe("kiem-dinh N-1 — SQL trước triển khai trong báo cáo = hằng trong mã", () => {
  it("khối SQL §4 mục 2 (bỏ thụt 3 dấu cách) bằng TRUY_VAN_TRUOC_TRIEN_KHAI từng ký tự", () => {
    expect(khoiSqlBaoCao()).toBe(TRUY_VAN_TRUOC_TRIEN_KHAI);
  });

  it("hằng trả hàng KHONG_PARSE_DUOC thay vì bỏ qua giá trị không đọc được (không còn `WHERE v IS NOT NULL AND`)", () => {
    expect(TRUY_VAN_TRUOC_TRIEN_KHAI).toContain("'KHONG_PARSE_DUOC'");
    expect(TRUY_VAN_TRUOC_TRIEN_KHAI).toMatch(/WHERE v IS NULL OR abs\(/);
    expect(TRUY_VAN_TRUOC_TRIEN_KHAI).not.toMatch(/WHERE v IS NOT NULL AND/);
  });
});
