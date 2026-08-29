/**
 * Task 9 (2026-08-24) — LƯỚI hợp nhất đường ghi ZIP (`aoiPackage.commit`) vào
 * `persistInspectionAtomic`, đóng cửa sau bỏ qua sổ idempotency + khoá tự nhiên +
 * sự kiện dò downtime mà `tx.insert(productInspections)` thẳng từng mở ra
 * (xem .superpowers/sdd/2026-08-24-aoi-pha0-va-no-co-san/task-9-report.md).
 *
 * §1 — KHÔNG còn `.insert(productInspections)` trực tiếp trong nguồn.
 * §2 — CÓ gọi `persistInspectionAtomic`.
 * §3 — CÓ chuỗi khoá idempotency ổn định theo packageId (`aoi-pkg:${pkg.packageId}`).
 * §4 — chống đọc-file-rỗng: độ dài nguồn phải > 1000 ký tự (một glob/path hỏng
 *      im lặng đọc ra chuỗi rỗng và mọi `expect(SOURCE).not.toMatch(...)` ở §1
 *      sẽ XANH GIẢ — "0 vi phạm" vì không có gì để đọc, không phải vì không có
 *      vi phạm).
 * §5 — `inferAoiOverallResult` / `toOriginalResult` (PHẦN 2): hai hàm THUẦN sinh
 *      ra để vá lỗi "NTF biến mất" và "ép kiểu vỡ INSERT", test trực tiếp —
 *      không cần DB, không cần mock tRPC.
 *
 * ĐỘT BIẾN BẮT BUỘC (task-9-report.md): bỏ nhánh NTF khỏi `inferAoiOverallResult`
 * (luôn trả OK/NG) → ca "không NG, có NTF → NTF" ở §5a phải ĐỎ; hoàn tác → xanh.
 *
 * §5c — BG-42 (Pha 1D task 4): `inferAoiOverallResult` từng để `explicitResult`
 * thắng VÔ ĐIỀU KIỆN (return ngay khi có, bất kể summary nói gì) — đúng hình
 * dạng Đ-21 mà Pha 1C đã đóng cho đường v2.0. Sau sửa, hàm lấy XẤU HƠN giữa
 * `explicitResult` và cuộn-từ-summary qua `verdictXauHon` (shared/rollupVerdict.ts).
 * ĐỘT BIẾN BẮT BUỘC: hoàn nguyên dòng đầu hàm về `if (input.explicitResult)
 * return input.explicitResult;` (bỏ qua verdictXauHon) → mệnh đề 1 ở §5c
 * ("khai OK với summary.ng>0 → NG") phải ĐỎ (kỳ vọng NG nhưng hàm trả OK);
 * hoàn tác → xanh lại.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inferAoiOverallResult, toOriginalResult } from "./aoiPackageRouter";

const SOURCE_PATH = join(__dirname, "aoiPackageRouter.ts");
const SOURCE = readFileSync(SOURCE_PATH, "utf-8");

describe("aoiPackageRouter — hợp nhất đường ghi ZIP vào persistInspectionAtomic (Task 9, PHẦN 3)", () => {
  it("§4 chống đọc-file-rỗng — nguồn đọc được phải dài hơn 1000 ký tự", () => {
    expect(SOURCE.length).toBeGreaterThan(1000);
  });

  it("§1 KHÔNG còn `.insert(productInspections)` trực tiếp — cửa sau đã đóng", () => {
    expect(SOURCE).not.toMatch(/\.insert\(\s*productInspections\s*\)/);
  });

  it("§2 có gọi `persistInspectionAtomic`", () => {
    expect(SOURCE).toMatch(/\bpersistInspectionAtomic\(/);
    // Gọi qua namespace `db.*` (khớp đúng chỗ import `import * as db from "../db"`),
    // không phải một hàm cùng tên tự khai trong chính router.
    expect(SOURCE).toMatch(/\bdb\.persistInspectionAtomic\(/);
  });

  it("§3 có chuỗi khoá idempotency ổn định theo packageId", () => {
    expect(SOURCE).toMatch(/idempotencyKey:\s*`aoi-pkg:\$\{pkg\.packageId\}`/);
  });

  describe("§5a inferAoiOverallResult (PHẦN 2 lỗi 1 — NTF từng bị nuốt thành OK)", () => {
    it("có NG → NG, bất kể NTF có mặt hay không", () => {
      expect(inferAoiOverallResult({ ngCount: 2, ntfCount: 5 })).toBe("NG");
      expect(inferAoiOverallResult({ ngCount: 1, ntfCount: 0 })).toBe("NG");
    });

    it("không NG, có NTF → NTF — ĐÂY LÀ CA LỖI CŨ (từng suy nhầm thành OK)", () => {
      expect(inferAoiOverallResult({ ngCount: 0, ntfCount: 3 })).toBe("NTF");
      expect(inferAoiOverallResult({ ntfCount: 1 })).toBe("NTF");
    });

    it("không NG, không NTF → OK", () => {
      expect(inferAoiOverallResult({ ngCount: 0, ntfCount: 0 })).toBe("OK");
      expect(inferAoiOverallResult({})).toBe("OK");
    });

    it("explicitResult NTF/NG với summary sạch (hoặc nhẹ hơn) → giữ nguyên lời khai", () => {
      expect(inferAoiOverallResult({ explicitResult: "NTF", ngCount: 0, ntfCount: 0 })).toBe("NTF");
      expect(inferAoiOverallResult({ explicitResult: "NG", ntfCount: 9 })).toBe("NG");
    });
  });

  describe("§5c BG-42 — explicitResult KHÔNG còn thắng vô điều kiện, dùng verdictXauHon với cuộn-từ-summary", () => {
    it("mệnh đề 1: gói khai OK với summary.ng>0 → ghi NG (Đ-21; TRƯỚC sửa hàm trả OK)", () => {
      expect(inferAoiOverallResult({ explicitResult: "OK", ngCount: 3, ntfCount: 0 })).toBe("NG");
      expect(inferAoiOverallResult({ explicitResult: "OK", ngCount: 9, ntfCount: 9 })).toBe("NG");
    });

    it("mệnh đề 2 (CHỐNG HỒI QUY): gói khai OK với summary.ng=0 → vẫn OK", () => {
      expect(inferAoiOverallResult({ explicitResult: "OK", ngCount: 0, ntfCount: 0 })).toBe("OK");
      expect(inferAoiOverallResult({ explicitResult: "OK", ngCount: 0, ntfCount: 3 })).toBe("NTF");
    });

    it("mệnh đề 3 (CHỐNG HỒI QUY): gói khai NG → vẫn NG, bất kể summary nói gì", () => {
      expect(inferAoiOverallResult({ explicitResult: "NG", ngCount: 0, ntfCount: 0 })).toBe("NG");
      expect(inferAoiOverallResult({ explicitResult: "NG", ngCount: 0, ntfCount: 9 })).toBe("NG");
    });
  });

  describe("§5b toOriginalResult (PHẦN 2 lỗi 2 — NTF từng lọt xuống originalResultEnum và vỡ INSERT)", () => {
    it("NTF → NG (originalResultEnum chỉ nhận OK/NG, drizzle/schema/enums.ts:59)", () => {
      expect(toOriginalResult("NTF")).toBe("NG");
    });
    it("OK giữ nguyên", () => {
      expect(toOriginalResult("OK")).toBe("OK");
    });
    it("NG giữ nguyên", () => {
      expect(toOriginalResult("NG")).toBe("NG");
    });
  });
});
