/**
 * Pha 1F Task 2 (BG-72 ⛔) — `.max(40)` từ chối chuỗi mà `new Date()` VẪN nhận,
 * trên đường v1.x (`submitInspection`/`submitInspectionBatch`) — đường BẬN NHẤT.
 *
 * `inspectionTime`/`serverReceivedAt` (`machineApiRouters.ts`,
 * `submitInspectionCoreObject`) được Pha 1E Task 3 (BG-69) siết `.max(40)` với
 * chú thích khẳng định "không siết hơn HÀNH VI hôm nay" — SAI SỰ THẬT. Một Agent
 * C# dùng `DateTime.ToString()` MẶC ĐỊNH (không phải ISO-8601) sinh chuỗi dài
 * tới 45-50 ký tự — `new Date(...)` VẪN parse được (không phải payload rác)
 * nhưng bị `.max(40)` từ chối Ở CỬA `.input()`, TRƯỚC KHI `superRefine`
 * (`refineInspectionTime`) kịp chạy bước kiểm parseability. TRƯỚC Pha 1E T3
 * (`z.string().optional()`, không `.max()`) cả hai chuỗi này được nhận và ghi
 * bình thường ⇒ HỒI QUY THẬT, không phải chặn payload rác — cột đích
 * `product_inspections.inspectionTime` là `timestamp`, không phải `varchar`,
 * không có rủi ro `22001` nào để đóng.
 *
 * Bản vá: `.max(40)` → `.max(64)`. File này đo LẠI ba dòng bằng chứng NGUYÊN
 * VĂN từ review (không suy đoán): độ dài, `new Date(...)` có parse được không,
 * và `submitInspectionCoreObject.safeParse()` (lớp `.max()` sống ở đây) có
 * chấp nhận hay không SAU bản vá.
 *
 * Đột biến bắt buộc (xem report): đặt lại `.max(40)` ở CẢ HAI trường ⇒ hai ca
 * "ĐƯỢC CHẤP NHẬN" bên dưới phải ĐỎ (bị từ chối trở lại).
 */
import { describe, it, expect } from "vitest";
import { submitInspectionCoreObject } from "./machineApiRouters";

/** Payload v1.x TỐI THIỂU hợp lệ — đủ để `inspectionTime`/`serverReceivedAt` bị soi. */
function mauToiThieu(overrides: Record<string, unknown>): unknown {
  return {
    machineCode: "MC-01",
    apiKey: "mk_test",
    serialNumber: "SN123456",
    overallResult: "OK",
    measurements: [{ pointId: "P1", result: "OK" }],
    ...overrides,
  };
}

// Nguyên văn ba dòng bằng chứng từ review (task-2-brief.md).
const BANG_CHUNG = [
  { ten: "Date.toString() mặc định (múi giờ có tên)", chuoi: "Sun Aug 30 2026 14:26:51 GMT+0700 (Indochina Time)", doDaiKyVong: 50 },
  { ten: "toLocaleString() đầy đủ (weekday+month dài)", chuoi: "Sunday, August 30, 2026 12:00:00 PM GMT+07:00", doDaiKyVong: 45 },
  { ten: "ISO-8601 có offset (đường ngắn, luôn đã qua)", chuoi: "2026-08-30T12:00:00.0000000+07:00", doDaiKyVong: 33 },
] as const;

describe("★★★ BG-72 — ba dòng bằng chứng NGUYÊN VĂN từ review: độ dài, new Date(), và schema THẬT", () => {
  for (const { ten, chuoi, doDaiKyVong } of BANG_CHUNG) {
    describe(`${ten} — "${chuoi}"`, () => {
      it(`độ dài đúng ${doDaiKyVong} ký tự (khớp số review đã đo)`, () => {
        expect(chuoi.length).toBe(doDaiKyVong);
      });

      it("new Date(...) parse được (KHÔNG phải payload rác — Invalid Date)", () => {
        expect(Number.isNaN(new Date(chuoi).getTime())).toBe(false);
      });

      it("submitInspectionCoreObject.safeParse: inspectionTime ĐƯỢC CHẤP NHẬN sau bản vá .max(64)", () => {
        const r = submitInspectionCoreObject.safeParse(mauToiThieu({ inspectionTime: chuoi }));
        expect(r.success, r.success ? "" : JSON.stringify((r as { error?: unknown }).error)).toBe(true);
      });

      it("submitInspectionCoreObject.safeParse: serverReceivedAt ĐƯỢC CHẤP NHẬN sau bản vá .max(64)", () => {
        const r = submitInspectionCoreObject.safeParse(mauToiThieu({ serverReceivedAt: chuoi }));
        expect(r.success, r.success ? "" : JSON.stringify((r as { error?: unknown }).error)).toBe(true);
      });
    });
  }

  it("CHỐNG HỒI QUY (mệnh đề 3, giới hạn RIÊNG của hai trường timestamp): chuỗi 65 ký tự (quá .max(64) một ký tự) VẪN bị từ chối — không phải unbounded", () => {
    const raiRac = "x".repeat(65);
    expect(submitInspectionCoreObject.safeParse(mauToiThieu({ inspectionTime: raiRac })).success).toBe(false);
    expect(submitInspectionCoreObject.safeParse(mauToiThieu({ serverReceivedAt: raiRac })).success).toBe(false);
  });

  it("CHỐNG HỒI QUY (các .max() ĐÚNG khác của Pha 1E T3 không bị đụng): measurements[].pointId vẫn từ chối >50 ký tự", () => {
    const p = mauToiThieu({ measurements: [{ pointId: "x".repeat(51), result: "OK" }] });
    expect(submitInspectionCoreObject.safeParse(p).success).toBe(false);
  });
});
