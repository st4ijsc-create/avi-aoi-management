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
 *
 * ── BG-85 (2026-09-02) — §5 (inferAoiOverallResult) XOÁ, KHÔNG hoàn nguyên ──
 * `inferAoiOverallResult` — bản logic cuộn verdict CHÉP TAY THỨ HAI mà §5a/§5c
 * pin xuống (bao gồm chính đột biến BG-42 mà §5c canh: "explicitResult thắng
 * vô điều kiện") — đã bị XOÁ khỏi `aoiPackageRouter.ts` (BG-85, đường ZIP nay
 * dùng THẲNG `dichCayKetQua`/`cay.verdictLuuTru`, CÙNG bộ dịch đường trực tiếp
 * v2.0 — không còn "hàm thuần suy verdict" đứng riêng để test đơn vị). Đây LÀ
 * bằng chứng "BG-42 tự tan": không phải lập luận — hàm sinh ra bug đó đã biến
 * mất, và §5a/§5c (test PIN hành vi của hàm đó, kể cả ca đột biến BG-42) không
 * còn gì để trỏ vào. `toOriginalResult` (PHẦN 2 lỗi 2) VẪN CÒN (không bị xoá —
 * ngoài phạm vi tường minh của BG-85) nhưng đường ZIP không còn gọi nó nữa (v2.0
 * tự giới hạn `overallResult` OK/NG ở cấp khai máy — ghi thẳng, không cần quy
 * đổi NTF→NG) — giữ lại §5b để không mất phủ cho một hàm THUẦN vẫn export.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toOriginalResult } from "./aoiPackageRouter";

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

  it("★★★ BG-85 — `inferAoiOverallResult` KHÔNG còn được ĐỊNH NGHĨA/GỌI trong nguồn (bằng chứng 'BG-42 tự tan' — không phải lập luận; tên hàm vẫn có thể xuất hiện trong MỘT dòng comment giải thích lịch sử, đó KHÔNG phải hộ tiêu thụ)", () => {
    expect(SOURCE).not.toMatch(/\bfunction inferAoiOverallResult\s*\(/);
    expect(SOURCE).not.toMatch(/inferAoiOverallResult\(\{/); // không còn LỜI GỌI nào
  });

  describe("§5b toOriginalResult (PHẦN 2 lỗi 2 — NTF từng lọt xuống originalResultEnum và vỡ INSERT) — VẪN CÒN, ngoài phạm vi xoá của BG-85", () => {
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
