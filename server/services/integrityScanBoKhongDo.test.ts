/**
 * Pha 1C Task 5 (BG-28, spec §13 Đ-19) — luật giám sát MỚI trong `integrityScanService.ts`:
 * bo (`product_inspections`) đi qua đường ingest CÂY v2.0 (`summaryCounts IS NOT NULL` —
 * cột này chỉ được ghi ở `machineApiRouters.ts:3225`, nhánh `submitInspection` v2.0) mà
 * KHÔNG có dòng nào trong `measurement_results`.
 *
 * Trước bản vá này: 12 luật fk-orphan + 1 luật fk-soft-orphan trong file, TẤT CẢ bắt chiều
 * "con mồ côi" (con trỏ tới cha không tồn tại). KHÔNG luật nào bắt chiều NGƯỢC LẠI — cha
 * (product_inspections) tồn tại mà không có con (measurement_results) nào. Hậu quả đo được
 * (spec §13 Đ-19): khi total=0 cho một trạm chỉ có bo v2.0,
 *   • stationAnalysisRouter.ts:1922 → defectRate=0 ⇒ status='pass' → bản đồ bo TOÀN XANH
 *   • ngRateAlertService.ts:208     → total<minSampleSize ⇒ return  → cảnh báo NG-rate KHÔNG BAO GIỜ bắn
 *   • integrityScanService.ts       → 0 luật (TRƯỚC bản vá này)     → lỗ VÔ HÌNH với giám sát toàn vẹn
 *
 * DỮ LIỆU THẬT: DB test đã có sẵn ~65 bo v2.0 với 0 dòng đo (để lại bởi Task 4 XUYÊN SUỐT —
 * server/db/ingestV2XuyenSuot.db.test.ts). Bài test này CHỈ ĐỌC (SELECT), KHÔNG INSERT/DELETE
 * `product_inspections` — `avi_app` không có DELETE trên bảng đó (WORM), và đằng nào cũng
 * không cần chế fixture khi dữ liệu thật đã sẵn có.
 *
 * Mutation-test (xem task-5-report.md): gỡ `CHA_KHONG_CON_CHECKS` khỏi vòng quét trong
 * `runIntegrityScanNow` (hoặc gỡ hẳn khối khai báo) ⇒ ca 2 và ca 3 dưới đây phải ĐỎ.
 */
import { describe, it, expect, vi } from "vitest";
import postgres from "postgres";
import {
  runIntegrityScanNow,
  CHA_KHONG_CON_CHECKS,
  getIntegrityScanSchedulerStatus,
} from "./integrityScanService";

const DB_URL = process.env.DATABASE_URL;
const KEY = "cha-khong-con:product_inspections(v2.0)->measurement_results";

describe.skipIf(!DB_URL)("BG-28 — luật giám sát: bo v2.0 có header mà 0 dòng đo", () => {
  it("luật đã đăng ký với kind mới 'cha-khong-con' (đối xứng ngược với fk-orphan/fk-soft-orphan)", () => {
    expect(CHA_KHONG_CON_CHECKS.some((c) => c.key === KEY && c.kind === "cha-khong-con")).toBe(true);
    expect(getIntegrityScanSchedulerStatus().chaKhongConCheckCount).toBe(CHA_KHONG_CON_CHECKS.length);
  });

  it("đếm ĐÚNG số bo v2.0 không có dòng đo — đối chiếu SELECT trực tiếp trên DB thật (không chế fixture)", async () => {
    const sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    try {
      // Sự thật tính ĐỘC LẬP với countSql của luật (không copy nguyên văn) — cùng vị từ
      // nghiệp vụ (bo v2.0 mà LEFT JOIN measurement_results ra NULL) nhưng viết lại tay
      // để phép đối chiếu có giá trị (không tự thoả bằng cách so sánh một câu với chính nó).
      const [truth] = await sql`
        SELECT count(*)::int AS n
        FROM product_inspections c
        WHERE c."summaryCounts" IS NOT NULL
          AND c.id NOT IN (SELECT DISTINCT "inspectionId" FROM measurement_results)`;
      const groundTruth = Number(truth.n);
      // Dữ liệu THẬT có sẵn (Task 4 để lại) — nếu đây là 0, ca này PHẢI đỏ, không được
      // âm thầm bỏ qua bằng skip: đúng lời dặn "dùng dữ liệu thật đã có sẵn".
      expect(groundTruth).toBeGreaterThan(0);

      const run = await runIntegrityScanNow("manual");
      const found = run.chaKhongConResults.find((r) => r.key === KEY);
      expect(found).toBeTruthy();
      expect(found!.degraded).toBe(false);
      expect(found!.violationCount).toBe(groundTruth);
      // Mẫu trả về phải đúng là các bo bị đếm — không rỗng khi có vi phạm.
      expect(Array.isArray(found!.samples)).toBe(true);
      expect((found!.samples as unknown[]).length).toBeGreaterThan(0);
    } finally {
      await sql.end();
    }
  }, 120_000);

  it("thông điệp cảnh báo nêu SỐ ĐẾM và trỏ §13 Đ-19 — người trực đêm không phải tự suy nguyên nhân", async () => {
    const warnings: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((msg?: unknown) => {
      warnings.push(String(msg));
    });
    try {
      await runIntegrityScanNow("manual");
    } finally {
      spy.mockRestore();
    }
    const hit = warnings.find((w) => w.includes("BG-28"));
    expect(hit).toBeTruthy();
    // Có số đếm (ít nhất một chữ số) VÀ trỏ đúng Đ-19 — không phải chỉ báo "có lỗi" suông.
    expect(hit).toMatch(/\d+ bo v2\.0/);
    expect(hit).toMatch(/Đ-19/);
  }, 120_000);

  it("dưới ngưỡng cấu hình (INTEGRITY_SCAN_CHA_KHONG_CON_MIN) thì KHÔNG cảnh báo — nhưng violationCount vẫn ĐÚNG số thật (ngưỡng không cắt số đếm)", async () => {
    const prev = process.env.INTEGRITY_SCAN_CHA_KHONG_CON_MIN;
    // Đặt ngưỡng cao hơn CHẮC CHẮN mọi số liệu thật có thể có trên DB test này.
    process.env.INTEGRITY_SCAN_CHA_KHONG_CON_MIN = "1000000";
    const warnings: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((msg?: unknown) => {
      warnings.push(String(msg));
    });
    try {
      const run = await runIntegrityScanNow("manual");
      const found = run.chaKhongConResults.find((r) => r.key === KEY)!;
      expect(found.violationCount).toBeGreaterThan(0); // số đếm THẬT, không bị ngưỡng cắt
      expect(warnings.some((w) => w.includes("BG-28"))).toBe(false); // nhưng không ồn dưới ngưỡng
    } finally {
      spy.mockRestore();
      if (prev === undefined) delete process.env.INTEGRITY_SCAN_CHA_KHONG_CON_MIN;
      else process.env.INTEGRITY_SCAN_CHA_KHONG_CON_MIN = prev;
    }
  }, 120_000);
});
