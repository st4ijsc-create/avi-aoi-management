/**
 * server/utils/timeOffsetPolicy.ts
 *
 * ★★★ doc 81 Đợt 1D Task 4 — MỘT chỗ cho chính sách "mốc thời gian máy khai PHẢI mang múi giờ"
 * (`INGEST_REQUIRE_TIME_OFFSET` cho `inspectionTime`, MẶC ĐỊNH BẬT; `INGEST_REQUIRE_PACKAGE_TIME_OFFSET`
 * cho `completedAt`/`startedAt`, MẶC ĐỊNH TẮT — ruling R-1D-j) và lỗi có mã của nó. Tách khỏi `machineApiRouters.ts` (nơi nó
 * sống từ doc 51 P2) để hợp đồng cây v2.0 (`contracts/machineDataContractV2.ts`, dùng chung bởi
 * cửa trực tiếp `submitInspection` và cửa ZIP `aoiPackage.commit`) đọc được ĐÚNG cờ đó mà không
 * import vòng qua router.
 *
 * Trường áp dụng: `inspectionTime` (v1.x `submitInspection`/`submitInspectionBatch`) và
 * `completedAt`/`startedAt` (v2.0 cây + `meta.json` ZIP, cấp bo VÀ cấp lá position/capture/
 * component). Luật "có múi giờ" là `coMuiGioTuongMinh` (factoryTime.ts) — KHÔNG viết regex thứ hai.
 */

/**
 * ENFORCEMENT flag — DEFAULT TRUE in code (2026-09-28). ON ⇒ a machine-declared time string
 * without an explicit UTC offset is a BAD_REQUEST carrying appError INVALID_VALUE
 * {field, reason:"timeOffsetRequired"}. Only an explicit false/0/off/no turns it OFF ⇒ accepted
 * (read as UTC by `docGioMay`; `inspectionTime` is also TAGGED timeSource='machine_naive').
 */
export function requireTimeOffset(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.INGEST_REQUIRE_TIME_OFFSET ?? "").trim().toLowerCase();
  return !(v === "false" || v === "0" || v === "off" || v === "no");
}

/**
 * ★ doc 81 Đợt 1D Task 4 — ruling R-1D-j (chủ dự án 2026-09-28): cờ RIÊNG cho `completedAt`/`startedAt`
 * của cây v2.0 (cửa trực tiếp + `meta.json` ZIP, MỌI cấp) — MẶC ĐỊNH TẮT, đọc kiểu opt-in
 * (`true/1/yes/on` mới BẬT). Lý do TẮT: mẫu máy THẬT (`D:\SOURCES\AOIData\dashboard-sample.json`,
 * `aoipackage-meta-sample.json` — InspectProAOI.Hooks) gửi chuỗi TRẦN ở cả bốn cấp; bật mặc định sẽ
 * từ chối MỌI bo thật. Bật khi phần mềm máy đã gửi `Z`/`±hh:mm`. `inspectionTime` KHÔNG đọc cờ này
 * (vẫn `requireTimeOffset()`, mặc định BẬT).
 */
export function requirePackageTimeOffset(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.INGEST_REQUIRE_PACKAGE_TIME_OFFSET ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

/** Trường thời gian máy khai chịu cờ `INGEST_REQUIRE_TIME_OFFSET` / `INGEST_REQUIRE_PACKAGE_TIME_OFFSET`. */
export type TruongThoiGianMay = "inspectionTime" | "completedAt" | "startedAt";

/**
 * Lỗi "mốc thời gian thiếu múi giờ" MANG MÃ. Ném (không `ctx.addIssue`) từ trong một refinement
 * zod: zod không nuốt exception của refinement, `createInputMiddleware` của tRPC bọc nó ĐÚNG MỘT
 * cấp thành TRPCError BAD_REQUEST với `cause` = lỗi này ⇒ `readAppErrorMeta(err)` (đọc
 * `err.cause.appCode`) thấy mã — cùng khuôn `DbUnavailableError` (`_core/dbErrors.ts`). Một
 * `appError()` (TRPCError) ném ở đây sẽ bị bọc thành HAI cấp và mất mã (xem ghi chú ở
 * `operatorBadgeRouter.ts`). Câu chữ mang `time_offset_required` vì cửa REST máy chỉ trả
 * `message`, không trả `shape.data.appCode`.
 *
 * Nơi parse KHÔNG nằm trong `.input()` (cửa ZIP: `metaJsonSchema.parse` trong thân `commit`) phải
 * tự đổi lỗi này sang `appError("BAD_REQUEST","INVALID_VALUE", …)` — xem `aoiPackageRouter.ts`.
 */
export class TimeOffsetRequiredError extends Error {
  readonly appCode = "INVALID_VALUE" as const;
  readonly appParams: { readonly field: TruongThoiGianMay; readonly reason: "timeOffsetRequired" };
  readonly field: TruongThoiGianMay;
  constructor(field: TruongThoiGianMay, value: string) {
    super(
      `time_offset_required: ${field} must carry an explicit UTC offset ` +
        `(e.g. 2026-07-15T08:00:00+07:00 or ...Z) — got "${value}", which the server can only ` +
        `interpret in its OWN timezone. ` +
        (field === "inspectionTime"
          ? `(INGEST_REQUIRE_TIME_OFFSET is on by default.)`
          : `(INGEST_REQUIRE_PACKAGE_TIME_OFFSET is on.)`),
    );
    this.field = field;
    this.appParams = { field, reason: "timeOffsetRequired" };
    this.name = "TimeOffsetRequiredError";
  }
}
