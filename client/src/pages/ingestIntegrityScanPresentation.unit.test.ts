/**
 * Lô 4 Mục 3 (BG-36) — integrityScan có đường đọc, PHẦN CLIENT.
 *
 * Đo TRƯỚC: `server/routers/integrityRouter.ts` (`summary`) ĐÃ persist + ĐÃ có
 * procedure đọc lại "kết quả integrityScan gần nhất" cho MỌI relationship (đọc
 * `integrity_scan_results`, bảng CÓ THẬT dữ liệu trên dev DB —
 * `current_database()=aoi_management`, 216 hàng, 21 scanKey khác nhau — xem
 * report). KHÔNG CẦN procedure mới cho "đọc kết quả gần nhất" (brief Mục 3.2:
 * "nếu nó đã persist thì đọc" — nó ĐÃ persist). Việc CÒN THIẾU chỉ là: (1) không
 * UI nào gọi `integrity.summary`/`history` (grep xác nhận 0 file client), và (2)
 * 21 relationship của `summary` là TOÀN BỘ master-data (machines/stations/lines/
 * workshops/...), không phải MỌI relationship đều "ingest" — trang quản trị
 * gói/ingest chỉ cần các relationship LIÊN QUAN ingest
 * (product_inspections/measurement_results).
 *
 * `locIngestLienQuan` (module này) là hàm THUẦN lọc `summary.relationships` (kiểu
 * trả về của `integrity.summary`) xuống đúng các khoá ingest-liên-quan — không
 * gọi mạng, test được không cần DB/render (BG-129).
 */
import { describe, it, expect } from "vitest";
import { locIngestLienQuan, INGEST_INTEGRITY_KEYS, laLoiTuChoiQuyen } from "./ingestIntegrityScanPresentation";

function relGia(key: string, violationCount: number | null) {
  return {
    key,
    kind: "fk-orphan" as const,
    childTable: "x",
    childColumn: "y",
    parentTable: null,
    parentColumn: null,
    enforcement: "RESTRICT" as const,
    repair: "manual" as const,
    constraintName: "c",
    dbState: "validated" as const,
    lastScan: violationCount === null ? null : { violationCount, samples: [], scanSource: "manual", scannedAt: "2026-08-29T00:00:00.000Z" },
  };
}

describe("INGEST_INTEGRITY_KEYS — danh sách khoá ingest-liên-quan (product_inspections/measurement_results)", () => {
  it("có ít nhất các khoá đã đo thật trên dev DB", () => {
    expect(INGEST_INTEGRITY_KEYS).toContain("fk:product_inspections.machineId->machines.id");
    expect(INGEST_INTEGRITY_KEYS).toContain("fk:measurement_results.inspectionId->product_inspections.id");
    expect(INGEST_INTEGRITY_KEYS).toContain("cha-khong-con:product_inspections(v2.0)->measurement_results");
  });
});

describe("locIngestLienQuan — lọc summary.relationships xuống đúng khoá ingest", () => {
  it("★★★ TRUNG TÂM — lọc đúng, không lẫn relationship master-data không liên quan (vd machines.stationId)", () => {
    const all = [
      relGia("fk:machines.stationId->stations.id", 0),
      relGia("fk:product_inspections.machineId->machines.id", 0),
      relGia("fk:measurement_results.inspectionId->product_inspections.id", 129770),
    ];
    const filtered = locIngestLienQuan(all);
    const keys = filtered.map((r) => r.key);
    expect(keys).toContain("fk:product_inspections.machineId->machines.id");
    expect(keys).toContain("fk:measurement_results.inspectionId->product_inspections.id");
    expect(keys).not.toContain("fk:machines.stationId->stations.id");
  });

  it("empty-state trung thực: mảng rỗng ⇒ mảng rỗng (không ném lỗi)", () => {
    expect(locIngestLienQuan([])).toEqual([]);
  });

  it("relationship chưa từng scan (lastScan: null) vẫn được GIỮ LẠI (để UI báo 'chưa scan lần nào', không lặng lẽ biến mất)", () => {
    const filtered = locIngestLienQuan([relGia("fk:product_inspections.machineId->machines.id", null)]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].lastScan).toBeNull();
  });
});

/**
 * Fix review Lô 4 (Important) — bối cảnh gốc khi hàm này được viết: `integrity.summary`/
 * `runNow`/`history` là `adminProcedure` (đòi `ctx.user.role === 'admin'` ĐÚNG CHỮ) trong khi
 * `listDeadLetters`/`getDeadLetterDetail` dùng `requirePermission("admin_system","canView")` —
 * nhóm quyền CÓ THỂ cấp cho một vai KHÔNG PHẢI admin (scoped-admin). Một scoped-admin xem được
 * tab dead-letter (đúng quyền) nhưng bị `integrity.summary` từ chối `FORBIDDEN` — TRƯỚC bản vá
 * fix, UI không phân biệt lỗi này với "đã quét, 0 relationship liên quan ingest" ⇒ empty-state
 * SAI Ý NGHĨA (giống lớp lỗi "một lối vào rồi từ chối" đã ghi trong memory dự án).
 *
 * BG-131 (Lô 9 Mục 3) ĐÃ hợp nhất `integrityRouter` về CÙNG mô hình `admin_system` — hàm
 * `laLoiTuChoiQuyen` vẫn CẦN THIẾT (một user thiếu `admin_system.canView` vẫn FORBIDDEN thật ở
 * `summary`, chỉ hẹp lại còn đúng nhóm đó thay vì mọi non-admin) nên các ca dưới đây KHÔNG đổi.
 * `laLoiTuChoiQuyen` là hàm THUẦN nhận diện lỗi FORBIDDEN từ hình dạng lỗi tRPC
 * (`error.data.code`), CÙNG quy ước `getErrorCode` nội bộ của `client/src/lib/trpcErrors.ts`
 * (không export, nên viết một bản hẹp — chỉ cần phân biệt FORBIDDEN, không cần toàn bộ bộ dịch
 * lỗi).
 */
describe("laLoiTuChoiQuyen — nhận diện lỗi FORBIDDEN (403) để phân biệt với empty-state THẬT", () => {
  it("★★★ TRUNG TÂM — lỗi tRPC code FORBIDDEN (hình dạng TRPCClientError.data) ⇒ true", () => {
    expect(laLoiTuChoiQuyen({ data: { code: "FORBIDDEN" } })).toBe(true);
  });

  it("lỗi khác (vd INTERNAL_SERVER_ERROR) ⇒ false — không được gộp chung mọi lỗi thành 'thiếu quyền'", () => {
    expect(laLoiTuChoiQuyen({ data: { code: "INTERNAL_SERVER_ERROR" } })).toBe(false);
  });

  it("null/undefined/không có data ⇒ false (không ném ngoại lệ khi tra hình dạng lỗi lạ)", () => {
    expect(laLoiTuChoiQuyen(null)).toBe(false);
    expect(laLoiTuChoiQuyen(undefined)).toBe(false);
    expect(laLoiTuChoiQuyen({})).toBe(false);
    expect(laLoiTuChoiQuyen("chuỗi lỗi trần")).toBe(false);
  });
});
