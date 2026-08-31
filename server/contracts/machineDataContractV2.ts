/**
 * Giai đoạn 1A (Task 4) — Machine Data Contract v2.0: cây 4 cấp
 * surface → position → capture → component.
 *
 * Thay thế hình dạng PHẲNG của v1.0/v1.1 (`measurements: []`) bằng hình dạng
 * THẬT mà `InspectProAOI.Hooks` gửi lên (xem `D:\SOURCES\AOIData\dashboard-sample.json`
 * và `sync-json-samples-reference.md`, mục 1).
 *
 * BA ĐIỂM THIẾT KẾ CỐT LÕI (đừng đoán lại — đã sai một lần trong draft trước):
 *
 * 1. `result` ở MỌI cấp chỉ có "OK"/"NG". KHÔNG có "NTF" trong enum này — NTF là
 *    **cờ `ntf` bool RIÊNG**, song song với `result`, ở mọi cấp. Máy có thể gửi
 *    `result="NG"` VÀ `ntf=true` cùng lúc; gộp thành một enum ba giá trị sẽ làm
 *    mất tổ hợp đó. (Khác với `shared/rollupVerdict.ts` — `ResultVerdict` ba giá
 *    trị "OK"|"NG"|"NTF" là kết quả CUỘN LẠI để hiển thị, không phải hợp đồng máy
 *    gửi lên. Hai thứ khác nhau có chủ đích, KHÔNG dùng lẫn.)
 *
 * 2. `captureId` (Capture.Id, nối sang manifest ảnh) và `componentId`
 *    (ComponentProject.Id, nối sang teach data) là BẮT BUỘC — chúng là khoá join
 *    THẬT. Optional sẽ mở đường cho dữ liệu không truy vết được.
 *
 * 3. `components: []` RỖNG là HỢP LỆ — một capture không có linh kiện nào (đèn
 *    chụp vùng trống) là hình dạng thật trong dữ liệu sản xuất. KHÔNG `.min(1)`.
 *
 * Additive — không đụng DB, không đụng đường ingest (`machineApiRouters.ts`).
 *
 * ── Vòng sửa 1 (review 10-đột-biến, F2/F3/F9) ──────────────────────────────
 * - Ba khoá join (`captureId`, `componentId`, `positionId`) đều `.trim().min(1)`
 *   — chuỗi TOÀN KHOẢNG TRẮNG bị từ chối, vì nó không join được với gì.
 * - `serialNumber` KHÔNG `.min(1)` (KHÔNG phải khoá join — rỗng là hình dạng
 *   thật, xem chú thích tại chỗ khai báo).
 *
 * ── Vòng sửa 2 (Pha 1B Task 3, BG-9) ────────────────────────────────────────
 * - Ba khoá join (`captureId`, `componentId`, `positionId`) đều thêm `.max(64)`
 *   khớp ĐÚNG sức chứa cột DB `varchar(64)`; `surface.name` thêm `.max(100)`
 *   khớp `varchar(100)`. Trước bản vá này, hợp đồng nhận chuỗi bất kỳ độ dài,
 *   DB mới chặn bằng `[22001] value too long for type character varying(64)`
 *   SAU cửa hợp đồng — một thông điệp Postgres không nêu tên trường máy gửi.
 *   Đã kiểm bằng mẫu máy thật (`D:\SOURCES\AOIData\dashboard-sample.json`):
 *   captureId dài nhất 37, componentId 37, positionId 3, surfaceName 6 — đều
 *   lọt xa dưới trần mới, KHÔNG vỡ mẫu thật.
 *
 * ── Vòng sửa 3 (Pha 1D Task 3, BG-27) ────────────────────────────────────────
 * KIỂM KÊ ĐẦY ĐỦ mọi trường chuỗi còn thiếu `.max()` — không chỉ hai trường
 * `productModel`/`captureName` mà review nêu. Sức chứa cột lấy từ
 * `information_schema.columns` THẬT, đọc bằng vai `avi_app` (không đoán từ tên
 * cột hay từ file `drizzle/schema/*.ts`), ngày kiểm 2026-08-30. Lưới census
 * đối chiếu (`capChuoiVarcharScan.ts` + `capChuoiVarcharCensus.test.ts`) canh
 * TOÀN BỘ bảng dưới đây bằng cách soi trực tiếp `._zod.def` của schema, không
 * phải regex trên văn bản.
 *
 * HAI NHÓM, hai lý do khác nhau (ĐỪNG lẫn — người đọc sau phải phân biệt được):
 *
 * (A) KHỚP CỘT THẬT — số đo từ `information_schema`, sai một ký tự là sai:
 *   - `productModel`      → `product_inspections.productModel`   varchar(100)
 *   - `captureName`       → `inspection_captures.captureName`    varchar(255)
 *   - `errorCode` (lá)    → `measurement_results.errorCode`      varchar(50)
 *     (cột đã tồn tại từ migration 0340 cho Khối B; đường ingest hôm nay CHƯA
 *     ghi cấp component — xem `submitInspectionTreeV2`,
 *     `server/routers/machineApiRouters.ts` — nhưng cột đã có sẵn, siết theo
 *     ĐÚNG sức chứa của nó ngay từ bây giờ để Khối B không phải quay lại đây).
 *   - (đã có từ Vòng sửa 1/2): `serialNumber`(100), `surface.name`(100),
 *     `positionId`(64), `captureId`(64), `componentId`(64).
 *
 * (B) VỆ SINH — KHÔNG khớp cột nào (đi vào cột `text`/`timestamp` không giới
 *   hạn ký tự, hoặc không hề được ghi xuống DB — chỉ dùng để băm khoá/so khớp/
 *   log). `.max()` ở đây là CHẶN PAYLOAD RÁC (một chuỗi vài MB vẫn hợp lệ theo
 *   hợp đồng cũ), KHÔNG PHẢI khớp sức chứa cột — census không đòi số cụ thể
 *   khớp DB cho nhóm này, chỉ đòi CÓ mặt và đúng hằng số đã chọn:
 *   - `identity.*` (7 trường)         → chỉ dùng băm SHA-256 làm khoá khử
 *     trùng (`dungKhoaKhuTrungV2`, `machineDataContract.ts`) + log lỗi WAL —
 *     KHÔNG cột nào. `.max(200)`.
 *   - `productId`                     → cùng lý do (vào hàm băm) — `.max(200)`.
 *   - `type`                          → chỉ parse, không đọc ở đâu trong
 *     đường ingest v2.0 hôm nay — `.max(100)`.
 *   - `apiKey`                        → so khớp bằng `eq()` trong SELECT xác
 *     thực (`authenticateMachine`), KHÔNG INSERT — dài quá chỉ khiến so khớp
 *     trượt (từ chối đúng), không có rủi ro `22001` — `.max(256)`.
 *   - `componentName`                 → CHƯA có cột đích (Khối B chưa định
 *     nghĩa) — `.max(255)` theo đúng quy ước "trường tên" 255 dùng xuyên suốt
 *     schema này (`captureName`, `mes.componentName`, `pointName`, …).
 *   - `value`/`lowerLimit`/`upperLimit` (nhánh chuỗi của `z.union`) — không
 *     có cột `varchar` đích thật: `value` dạng số/chuỗi-số đi `measuredValue`
 *     (decimal); chuỗi KHÔNG parse được số mới có khả năng đi
 *     `measuredValueText` varchar(255) (mẫu hành vi ở nhánh v1.x,
 *     `machineApiRouters.ts` dòng ~1830); `lowerLimit`/`upperLimit` KHÔNG có
 *     cột kết quả nào cả (cột `lowerLimit`/`upperLimit` DUY NHẤT tồn tại là
 *     `measurement_point_defs` — cấu hình/spec, khác bảng, khác ngữ nghĩa).
 *     Cả ba dùng chung `.max(255)` vì lý do đối xứng với `measuredValueText`,
 *     KHÔNG PHẢI vì đã xác nhận cột.
 *   - `startedAt`/`completedAt` (CẢ BỐN cấp: bo/position/capture/component)
 *     → luôn đi qua `new Date(...)`/`toDateOrUndefined` vào cột
 *     `timestamp without time zone` (KHÔNG PHẢI `varchar`) — `22001` không
 *     áp dụng ở đây. ★★★ Pha 1F Task 6 (review lượt 7, C-2 ⛔) — `.max(40)`
 *     → `.max(64)`: cùng trường/cùng Agent C# đã đo hồi quy thật ở
 *     `startedAt`/`finishedAt` của `metaJsonSchema` (cửa ZIP, xem docblock
 *     `aoiPackageRouter.ts`) — một `DateTime.ToString()` mặc định dài tới 50
 *     ký tự vẫn là ngày hợp lệ (`new Date()` parse được), `.max(40)` từ chối
 *     NHẦM. Review lượt 7 chỉ đo được `too_big@startedAt` ở CỬA ZIP (chưa có
 *     bằng chứng LIVE cho MDC v2 hôm nay), nhưng đây CHÍNH LÀ hợp đồng sẽ
 *     TRỞ THÀNH `meta.json` sau BG-85 (`docs/superpowers/specs/2026-09-01-aoi-chuan-goi-anh.md`)
 *     — vá theo tiêu chí MỚI ("trần có ≥ độ dài `new Date()` chấp nhận
 *     không?", không phải "có bằng chứng too_big hôm nay không?") ngay bây
 *     giờ để bản vá BG-85 không phải quay lại đây lần nữa. Áp dụng ĐỀU cho
 *     cả bốn cấp (không chỉ cấp gốc) — cùng Agent, cùng định dạng, không có
 *     lý do để một cấp an toàn còn cấp khác không. `.max(64)` dư 14 ký tự
 *     trên mẫu dài nhất đã đo (50) — census `capChuoiThoiGianCensus.test.ts`
 *     (`capChuoiVarcharScan.ts`, `kiemTraTranThoiGian`) canh trần này ≥64
 *     trên MỌI trường thời gian của MỌI hợp đồng ingest, không riêng đây.
 *
 * NGOẠI LỆ DUY NHẤT — `errorDesc` (lá): cột đích `measurement_results.errorDesc`
 * là `text`, KHÔNG có `character_maximum_length` (đã kiểm `information_schema`,
 * NULL = không giới hạn thật). KHÔNG thêm `.max()` — thêm vào sẽ là siết bịa
 * một con số không hề khớp "sức chứa cột" (chính điều task này cấm). Census
 * KHÔNG xét `errorDesc` trong bảng "phải có .max()".
 */
import { z } from "zod";

// ── Cấp 0: định danh trạm (HookStation, HookContracts.cs:107-114) ───────────
// .max(200) — VỆ SINH, KHÔNG khớp cột nào (xem "Vòng sửa 3" ở đầu file): cả bảy
// trường chỉ đi vào hàm băm SHA-256 (`dungKhoaKhuTrungV2`) làm khoá khử trùng —
// đầu ra băm luôn cố định 64 hex bất kể độ dài đầu vào — và vào một dòng log
// lỗi WAL. `.max()` ở đây chặn payload rác (chuỗi vài MB vẫn "hợp lệ" nếu bỏ
// trần), KHÔNG PHẢI chống tràn cột DB.
const identityV2 = z.object({
  station: z.string().min(1).max(200),
  machine: z.string().min(1).max(200),
  line: z.string().min(1).max(200),
  plant: z.string().min(1).max(200),
  country: z.string().min(1).max(200),
  solutionName: z.string().min(1).max(200),
  appVersion: z.string().min(1).max(200),
});

// ── Cấp 4 (lá): component (HookComponent, HookContracts.cs:18-29) ───────────
// componentId = ComponentProject.Id — khoá join sang teach data (`template-sync-sample.json`).
// .trim() vì chuỗi TOÀN KHOẢNG TRẮNG qua .min(1) trần vẫn "hợp lệ" — một khoá
// join rỗng-thực-chất không join được với gì (F9, vòng sửa 1).
// .max(64) — cột đích `measurement_results.componentExtId` / `product.componentExtId`
// là `varchar(64)` (drizzle/schema/inspection.ts, drizzle/schema/product.ts). Không
// chặn ở đây thì chuỗi quá 64 ký tự lọt qua cửa hợp đồng ("ok: true"), rồi Postgres
// mới từ chối bằng `[22001] value too long for type character varying(64)` — một
// thông điệp không nêu tên trường máy gửi, kỹ sư hiện trường không đọc nổi (BG-9).
const componentV2 = z.object({
  componentId: z.string().trim().min(1).max(64),
  // .max(255) — VỆ SINH: CHƯA có cột đích (Khối B chưa định nghĩa tên linh
  // kiện cấp kết quả). Theo quy ước "trường tên" 255 dùng xuyên suốt schema
  // (captureName, mes.componentName, pointName…), KHÔNG khớp một cột đã xác
  // nhận — xem "Vòng sửa 3" đầu file.
  componentName: z.string().max(255).optional(),
  // "OK"/"NG" — KHÔNG "NTF". NTF là cờ `ntf` riêng ngay dưới đây.
  result: z.enum(["OK", "NG"]),
  ntf: z.boolean(),
  // .max(255) — VỆ SINH: nhánh SỐ đi `measuredValue` (decimal, không tràn
  // varchar); nhánh CHUỖI không parse được số mới có khả năng đi
  // `measuredValueText` varchar(255) (mẫu hành vi nhánh v1.x). Xem "Vòng sửa 3".
  value: z.union([z.string().max(255), z.number()]).nullable().optional(),
  // .max(255) — VỆ SINH, đối xứng với `value`. KHÔNG có cột kết quả nào cho
  // lowerLimit/upperLimit hôm nay — cột `lowerLimit`/`upperLimit` DUY NHẤT tồn
  // tại (`measurement_point_defs`) là cấu hình/spec, khác bảng khác ngữ nghĩa.
  lowerLimit: z.union([z.string().max(255), z.number()]).nullable().optional(),
  upperLimit: z.union([z.string().max(255), z.number()]).nullable().optional(),
  // .max(50) — KHỚP CỘT THẬT `measurement_results.errorCode` varchar(50) (đã
  // kiểm avi_app). Cột có sẵn từ migration 0340 cho Khối B dù đường ingest hôm
  // nay chưa ghi cấp component — xem "Vòng sửa 3" đầu file.
  errorCode: z.string().max(50).nullable().optional(),
  // KHÔNG `.max()` — cột đích `measurement_results.errorDesc` là `text`
  // (character_maximum_length = NULL, đã kiểm avi_app) — không giới hạn thật
  // để khớp. Thêm trần ở đây là siết bịa một con số không khớp cột nào cả.
  errorDesc: z.string().nullable().optional(),
  // .max(64) — VỆ SINH: đi `timestamp without time zone` qua `toDateOrUndefined`,
  // không phải `varchar` — `22001` không áp dụng. Pha 1F Task 6 (C-2 ⛔): nới
  // từ .max(40) — DateTime.ToString() mặc định dài tới 50 ký tự vẫn là ngày
  // hợp lệ, xem docblock đầu file.
  startedAt: z.string().max(64).optional(),
  completedAt: z.string().max(64).optional(),
});

// ── Cấp 3: capture (HookCapture, HookContracts.cs:41-50) ────────────────────
// captureId = Capture.Id — khoá join sang manifest ảnh (`aoipackage-meta-sample.json`).
// .trim() — cùng lý do componentId ở trên (F9, vòng sửa 1).
// .max(64) — cột đích `inspection_captures.captureExtId` (drizzle/schema/
// inspectionTree.ts) là `varchar(64)`. Cùng lý do componentId ở trên (BG-9).
const captureV2 = z.object({
  captureId: z.string().trim().min(1).max(64),
  // .max(255) — KHỚP CỘT THẬT `inspection_captures.captureName` varchar(255)
  // (đã kiểm avi_app, Vòng sửa 3/BG-27). Trước bản vá này KHÔNG có `.max()` —
  // đúng lỗ review nêu, tên đã biết.
  captureName: z.string().max(255).optional(),
  index: z.number().int().nonnegative().optional(),
  result: z.enum(["OK", "NG"]),
  ntf: z.boolean(),
  // .max(64) — VỆ SINH, cùng lý do startedAt/completedAt ở componentV2: đích
  // là `timestamp`, không phải `varchar`. Pha 1F Task 6 (C-2 ⛔): nới từ .max(40).
  startedAt: z.string().max(64).optional(),
  completedAt: z.string().max(64).optional(),
  // RỖNG là hợp lệ (đèn chụp vùng không có component) — KHÔNG .min(1).
  components: z.array(componentV2),
});

// ── Cấp 2: position (HookPosition, HookContracts.cs:61-69) ──────────────────
// positionId = ImagePosition.PositionId — định danh ổn định, tên thư mục lưu
// ảnh (sync-json-samples-reference.md:138) — cũng là khoá join, .trim() cùng
// nguyên tắc với captureId/componentId (F9, vòng sửa 1).
// .max(64) — cột đích `inspection_positions.positionId` (drizzle/schema/
// inspectionTree.ts) là `varchar(64)`. Cùng lý do captureId/componentId ở trên (BG-9).
const positionV2 = z.object({
  positionId: z.string().trim().min(1).max(64),
  positionNumber: z.number().int().nonnegative().optional(),
  result: z.enum(["OK", "NG"]),
  ntf: z.boolean(),
  // .max(64) — VỆ SINH, cùng lý do ở componentV2/captureV2: đích là
  // `timestamp`, không phải `varchar`. Pha 1F Task 6 (C-2 ⛔): nới từ .max(40).
  startedAt: z.string().max(64).optional(),
  completedAt: z.string().max(64).optional(),
  captures: z.array(captureV2),
});

// ── Cấp 1: surface (gộp từ HookPosition.SurfaceName phía máy gửi) ───────────
// .max(100) — cột đích `inspection_surfaces.surfaceName` (drizzle/schema/
// inspectionTree.ts) là `varchar(100)`. Cùng lý do BG-9 ở componentV2/captureV2/
// positionV2 phía trên: siết ở cửa hợp đồng, không để DB ném [22001] SAU cửa.
const surfaceV2 = z.object({
  name: z.string().min(1).max(100),
  result: z.enum(["OK", "NG"]),
  ntf: z.boolean(),
  positions: z.array(positionV2),
});

// ── Nhóm đếm total/pass/ng/ntf — lưu nguyên văn 4 nhóm để đối chiếu ──────────
const summaryGroupV2 = z.object({
  total: z.number().int().nonnegative(),
  pass: z.number().int().nonnegative(),
  ng: z.number().int().nonnegative(),
  ntf: z.number().int().nonnegative(),
});

// ── Cấp 0 (gốc): payload sản phẩm hoàn chỉnh (HookProduct/HookProductContext) ─
export const machineDataContractV2 = z.object({
  schemaVersion: z.literal("2.0").default("2.0"),
  // Nhãn phân loại payload phía máy — có mặt trong dữ liệu thật, không phải khoá.
  // .max(100) — VỆ SINH: KHÔNG đọc ở đâu trong đường ingest v2.0 hôm nay
  // (`submitInspectionTreeV2` không chạm `payload.type`) — chỉ parse rồi bỏ.
  type: z.string().max(100).optional(),
  // Định danh xác thực máy (transport-level, giống v1/v1.1).
  // .max(256) — VỆ SINH: so khớp bằng `eq()` trong SELECT xác thực
  // (`authenticateMachine`), KHÔNG INSERT — không có rủi ro `22001`.
  apiKey: z.string().max(256).optional(),
  identity: identityV2,
  // .max(200) — VỆ SINH, cùng lý do `identity.*`: chỉ vào hàm băm SHA-256
  // làm khoá khử trùng (`dungKhoaKhuTrungV2`), không có cột đích.
  productId: z.string().min(1).max(200),
  // KHÔNG .min(1): serialNumber KHÔNG PHẢI khoá join (không dùng để nối dữ
  // liệu sang bảng khác) — rỗng là hình dạng THẬT khi máy chưa gán serial
  // (D:\SOURCES\AOIData\sync-json-samples-reference.md:26 — "serialNumber
  // ← HookProduct.Serial | Serial máy gửi; rỗng nếu máy chưa gửi"). Theo
  // §4.5 (ranh giới TỪ CHỐI vs GẮN THẺ): không phải khoá join ⇒ không từ
  // chối vì nội dung rỗng. Đã cân nhắc và loại `.min(1)` có chủ đích (F3,
  // vòng sửa 1) — ĐỪNG "sửa lại cho chặt".
  // .max(100) — KHỚP CỘT THẬT `product_inspections.serialNumber` varchar(100)
  // (đã kiểm avi_app).
  serialNumber: z.string().trim().max(100),
  // .max(100) — KHỚP CỘT THẬT `product_inspections.productModel` varchar(100)
  // (đã kiểm avi_app, Vòng sửa 3/BG-27). Trước bản vá này KHÔNG có `.max()` —
  // đúng lỗ review nêu, tên đã biết.
  productModel: z.string().max(100).optional(),
  overallResult: z.enum(["OK", "NG"]),
  ntf: z.boolean(),
  // null khi máy không gửi (HookProduct.MachineProductIndex).
  machineProductIndex: z.number().int().nullable().optional(),
  // .max(64) — VỆ SINH: đi `new Date(...)` → `product_inspections.inspectionTime`
  // (`timestamp without time zone`, KHÔNG PHẢI `varchar`) qua `submitInspectionTreeV2`.
  // `22001` không áp dụng. Pha 1F Task 6 (C-2 ⛔): nới từ .max(40) — cùng lý
  // do/con số `startedAt`/`finishedAt` của `metaJsonSchema` (cửa ZIP, đọc
  // ĐÚNG trường này khi máy không gửi `inspectionTime` — xem docblock
  // `aoiPackageRouter.ts`).
  startedAt: z.string().max(64).optional(),
  completedAt: z.string().max(64).optional(),
  summary: z.object({
    surfaces: summaryGroupV2,
    positions: summaryGroupV2,
    captures: summaryGroupV2,
    components: summaryGroupV2,
  }),
  surfaces: z.array(surfaceV2),
});

export type MachineDataContractV2 = z.infer<typeof machineDataContractV2>;
