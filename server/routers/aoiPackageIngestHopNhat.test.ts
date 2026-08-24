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

    it("metaData.overallResult khai sẵn → LUÔN tôn trọng lời khai, kể cả khi mâu thuẫn với summary", () => {
      expect(inferAoiOverallResult({ explicitResult: "OK", ngCount: 9, ntfCount: 9 })).toBe("OK");
      expect(inferAoiOverallResult({ explicitResult: "NTF", ngCount: 0, ntfCount: 0 })).toBe("NTF");
      expect(inferAoiOverallResult({ explicitResult: "NG", ntfCount: 9 })).toBe("NG");
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
