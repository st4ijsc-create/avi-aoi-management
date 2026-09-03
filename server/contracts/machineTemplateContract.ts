/**
 * Khối B — Task 1 (B-1): HỢP ĐỒNG CÂY DẠY mà MÁY ĐẨY LÊN hệ sinh thái.
 *
 * Hình dạng: `surfaces[] → positions[] → captures[] → components[]`, lấy NGUYÊN
 * VĂN từ mẫu máy thật `D:\SOURCES\AOIData\template-sync-sample.json`
 * (2 surface · 4 position · 8 capture · 16 component).
 *
 * ── ĐÂY LÀ CHIỀU NGƯỢC VỚI `configSyncGeneric` ─────────────────────────────
 * `machineApiRouters.ts` (configSync) gần như toàn `.query()` ⇒ **máy KÉO cấu
 * hình TỪ hệ**. Quyết định của chủ dự án 2026-09-03 chọn hướng (a): **máy dạy
 * xong thì ĐẨY cây + UUID của CHÍNH NÓ lên, hệ soi gương máy**. File này chỉ
 * là HỢP ĐỒNG (hình dạng). ★ Task 2 (2026-09-03) ĐÃ mở cửa tiêu thụ:
 * `machineApiRouter.submitMachineTemplate` (`server/routers/machineApiRouters.ts`,
 * `.input(submitMachineTemplateCoreObject)`) + đường ghi bốn bảng
 * `ghiCayDay` (`server/db/cayDay.ts`).
 *
 * ── ⚠ BẪY KHOÁ NỐI — BỐN CẤP KHÔNG NỐI CÙNG MỘT KIỂU ───────────────────────
 * Đo đủ bốn cấp trên HAI mẫu thật (`template-sync-sample.json` = cấu hình,
 * `dashboard-sample.json` = kết quả). §2 của nền đo được từng KHAI QUÁ ("máy
 * dùng cùng một UUID cho cùng một thực thể ở cả hai chiều") và đã được sửa ở
 * commit `f774c704`:
 *
 * | Cấp       | Cấu hình (file này) có   | Kết quả (MDC v2) có | Nối bằng          |
 * |-----------|--------------------------|---------------------|-------------------|
 * | surface   | `surfaceId` + `surfaceName` | **chỉ `name`**   | **TÊN**           |
 * | position  | `id` (UUID) + `positionId`  | **chỉ `positionId`** | **MÃ "P01"** |
 * | capture   | `id` (UUID)              | `captureId` (UUID)  | **UUID** ✅       |
 * | component | `id` (UUID)              | `componentId` (UUID)| **UUID** ✅       |
 *
 * ⇒ Hai cấp SÂU nối bằng UUID (đây đúng hai cấp Đ-19/BG-92 cần). Hai cấp TRÊN
 * nối bằng **tên/mã** — YẾU HƠN: đổi `surfaceName` hoặc đổi mã `positionId` là
 * **đứt nối**, im lặng.
 *
 * ── ⚠ MỌI TRƯỜNG CHUỖI CÓ `.max()` ────────────────────────────────────────
 * Census `capChuoiVarcharScan.ts` (bảng `KIEM_KE_CAY_DAY` + walker
 * `kiemTraToanBoTruongChuoi`) soi file này; lưới tiêu thụ:
 * `machineTemplateContract.test.ts`. Sức chứa cột đo bằng
 * `information_schema.columns`, **vai `avi_app`** (KHÔNG phải `aoi`), ngày
 * 2026-09-03, **cả hai** DB `current_database()='aoi_management'` và
 * `='aoi_management_test'` cho **cùng** con số:
 *
 *   (A) KHỚP CỘT THẬT — sai một ký tự là `[22001] value too long`:
 *     `surfaceId`   → `product_surfaces.surfaceExtId`        varchar(64)
 *     `surfaceName` → `product_surfaces.surfaceName`         varchar(100)
 *     `positionId`  → `product_positions.positionId`         varchar(64)
 *     `position.name` → `product_positions.name`             varchar(255)
 *     `shape`       → `product_positions.shape`              varchar(**20**)
 *     `capture.id`  → `product_captures.captureExtId`        varchar(64)
 *     `capture.name`→ `product_captures.captureName`         varchar(255)
 *     `component.id`→ `measurement_point_defs.componentExtId` varchar(64)
 *     `componentName` → `measurement_point_defs.name`        varchar(255)
 *
 *   (B) VỆ SINH — cột đích là `text` (không có sức chứa thật để khớp), hoặc
 *       KHÔNG có cột đích nào. Con số do task này CHỌN, chặn payload rác:
 *     `*.templateImagePath` / `surfaceTemplateImagePath` → `templateImageUrl`
 *       là `text` ⇒ 1000 (mẫu thật dài nhất 137 ký tự)
 *     `description` → `measurement_point_defs.description` là `text` ⇒ 1000
 *     `position.id` → **KHÔNG có cột đích** (xem chú thích tại chỗ khai) ⇒ 64
 *
 * ⚠ `shape` là **varchar(20)**, KHÔNG phải 50. Kế hoạch Khối B viết "string max
 * 50"; đo lại bằng `avi_app` ra 20 ở CẢ HAI DB. Lấy 50 sẽ cho lọt chuỗi 21-50
 * ký tự qua cửa hợp đồng rồi vỡ ở DB bằng `[22001]` — đúng lớp lỗi "hợp đồng
 * RỘNG HƠN hiện thực" mà census này sinh ra để chặn.
 *
 * ── ⚠ KHÔNG thêm trường mẫu thật không có ─────────────────────────────────
 * Mọi trường dưới đây đều xuất hiện trong `template-sync-sample.json`. Ngược
 * lại, `markerRadius` **CÓ trong mẫu thật** (2/4 position, đúng các position
 * `shape="Circle"`) và **CÓ cột đích** `product_positions.markerRadius`
 * numeric(10,4) — nhưng KHÔNG có trong bảng khai của kế hoạch. Bỏ nó ⇒ zod
 * `.object()` (không `.strict()`) **cắt im lặng** một trường máy đã dạy, và
 * Task 2 không còn gì để ghi vào cột đó. Vì vậy nó ĐƯỢC khai ở đây.
 */
import { z } from "zod";

/**
 * ROI của một component — **PIXEL TUYỆT ĐỐI** trên ảnh template của capture cha
 * (khác `relX`/`relY` của position: hai cái đó TƯƠNG ĐỐI 0..1).
 *
 * Bốn trường BẮT BUỘC: mẫu thật có đủ 16/16, và ROI thiếu một cạnh không dựng
 * được vùng kiểm nào — thiếu là lỗi hợp đồng, không phải chỗ để suy đoán.
 *
 * ⚠⚠⚠ SIẾT Ở TASK 2 (Khối B, B-2/B-3) — `z.number().int()`, KHÔNG còn `z.number()`.
 * Cột đích `measurement_point_defs.roiX/roiY/roiWidth/roiHeight` là `integer`.
 * Task 1 để `z.number()` và ghi lại quyết định cho ĐƯỜNG GHI; Task 2 (cửa
 * `submitMachineTemplate` + `ghiCayDay`) đã quyết: **TỪ CHỐI số lẻ tại CỬA**.
 * Lý do đo được, không phải sở thích:
 *   · Postgres **làm tròn IM LẶNG** khi ghi `12.5` vào cột `integer` (thành 12
 *     — làm tròn về SỐ CHẴN, `12.5→12` nhưng `13.5→14`): máy khai một ROI, hệ
 *     lưu một ROI KHÁC, không lỗi nào được ném. Đúng lớp "trường trông như bảo
 *     đảm mà không phải".
 *   · Mẫu máy thật có **64 giá trị `roi`, 0 giá trị lẻ** ⇒ siết BÂY GIỜ không
 *     từ chối một payload thật nào đang tồn tại. Siết SAU (khi đã có máy gửi số
 *     lẻ) mới là đổi hợp đồng gây đau.
 * ⚠ Đây là chỗ DUY NHẤT chặn: `ghiCayDay` KHÔNG kiểm lại `Number.isInteger` —
 * nếu ai nới `.int()` ở đây, số lẻ sẽ đi thẳng xuống Postgres và bị làm tròn im
 * lặng trở lại. Lưới ghim: `machineTemplateContract.test.ts` §2 (`roi.x = 12.5`
 * ⇒ TỪ CHỐI) và `cayDayGhiThat.db.test.ts`.
 */
const soNguyenRoi = (ten: string) =>
  z.number().int({
    message:
      `roi.${ten} phải là SỐ NGUYÊN (pixel tuyệt đối). Cột đích ` +
      `measurement_point_defs.roi${ten === "x" ? "X" : ten === "y" ? "Y" : ten === "width" ? "Width" : "Height"} ` +
      `là integer — số lẻ sẽ bị Postgres LÀM TRÒN IM LẶNG, hệ sẽ lưu một ROI KHÁC ` +
      `với ROI máy khai mà không lỗi nào được ném.`,
  });

export const roiTemplate = z.object({
  x: soNguyenRoi("x"),
  y: soNguyenRoi("y"),
  width: soNguyenRoi("width"),
  height: soNguyenRoi("height"),
});

/**
 * Cấp 4 — component (linh kiện) trong một capture.
 *
 * `id` = UUID **do máy sinh** → `measurement_point_defs.componentExtId`. Đây là
 * khoá nối THẬT sang kết quả (`measurement_results.componentExtId` =
 * `components[].componentId` của MDC v2). `.trim()` + `.min(1)`: chuỗi toàn
 * khoảng trắng không join được với gì (cùng nguyên tắc ba khoá join của
 * `machineDataContractV2`).
 */
export const componentTemplate = z.object({
  id: z.string().trim().min(1).max(64),
  // (A) KHỚP CỘT: `measurement_point_defs.name` varchar(255) — NOT NULL, nên
  // trường này BẮT BUỘC (mẫu thật 16/16 có).
  componentName: z.string().max(255),
  // (B) VỆ SINH: cột đích `measurement_point_defs.description` là `text`.
  description: z.string().max(1000).optional(),
  roi: roiTemplate,
  // (B) VỆ SINH. ★ Task 2 QUYẾT: GHI, vào `measurement_point_defs.referenceImageUrl`
  // (`text`) — bảng ánh xạ của kế hoạch bỏ sót trường này, Task 1 phát hiện.
  // Xem `ghiCayDay` (`server/db/cayDay.ts`).
  templateImagePath: z.string().max(1000).optional(),
});

/**
 * Cấp 3 — capture (lượt chụp) tại một position.
 *
 * `id` = UUID do máy sinh → `product_captures.captureExtId`, và là khoá nối
 * sang `measurement_results` qua `captures[].captureId` của MDC v2 (đã đo:
 * trùng khít `…000000001011` ở cả hai mẫu).
 */
export const captureTemplate = z.object({
  id: z.string().trim().min(1).max(64),
  // (A) KHỚP CỘT: `product_captures.captureName` varchar(255).
  name: z.string().max(255),
  // (B) VỆ SINH: `product_captures.templateImageUrl` là `text`. ★ Task 2 QUYẾT:
  // GHI (bảng ánh xạ của kế hoạch bỏ sót; cột tồn tại).
  templateImagePath: z.string().max(1000).optional(),
  // Mảng BẮT BUỘC (thiếu `components` ⇒ TỪ CHỐI). Mảng RỖNG vẫn hợp lệ: một
  // capture không dạy linh kiện nào là hình dạng thật (cùng quy ước
  // `machineDataContractV2.captureV2.components`) — KHÔNG `.min(1)`.
  components: z.array(componentTemplate),
});

/**
 * Cấp 2 — position (vị trí) trên một surface.
 *
 * ⚠⚠⚠ HAI KHOÁ, CHỈ MỘT DÙNG ĐƯỢC ĐỂ NỐI KẾT QUẢ — ĐỌC TRƯỚC KHI LÀM TASK 2:
 *  - `id` là UUID do máy sinh. **KHÔNG dùng `id` để nối kết quả.** Payload kết
 *    quả (`machineDataContractV2.positionV2`) **KHÔNG hề mang UUID này** — nó
 *    chỉ mang `positionId`. Join bằng `id` sẽ **LUÔN trượt, IM LẶNG** (0 hàng
 *    khớp, không lỗi nào được ném).
 *  - `positionId` (`"P01"`, `"P02"`) **mới là** khoá nối, và là cột thật
 *    `product_positions.positionId` (khoá duy nhất cùng `surfaceRowId`).
 * ⚠ `id` hiện **KHÔNG có cột đích** trong `product_positions` — trần 64 của nó
 * là VỆ SINH, không phải sức chứa cột.
 */
export const positionTemplate = z.object({
  id: z.string().trim().min(1).max(64),
  positionId: z.string().trim().min(1).max(64),
  positionIndex: z.number(),
  // (A) KHỚP CỘT: `product_positions.name` varchar(255).
  name: z.string().max(255),
  // (A) KHỚP CỘT: `product_positions.shape` varchar(**20**) — đo avi_app
  // 2026-09-03, KHÔNG phải 50 như bảng khai trong kế hoạch. Mẫu thật:
  // "Rectangle" (9) / "Circle" (6).
  shape: z.string().max(20).optional(),
  markerWidth: z.number().optional(),
  markerHeight: z.number().optional(),
  // ⚠ CÓ trong mẫu thật (2/4 position, đúng các position shape="Circle") và CÓ
  // cột đích `product_positions.markerRadius` numeric(10,4) — nhưng VẮNG khỏi
  // bảng khai của kế hoạch. Không khai ⇒ zod cắt im lặng ⇒ Task 2 mất dữ liệu
  // hình tròn. Xem docblock đầu file.
  markerRadius: z.number().optional(),
  // TƯƠNG ĐỐI 0..1 trên ảnh template của surface cha (đừng lẫn với `roi.*` =
  // PIXEL TUYỆT ĐỐI). Mẫu thật 4/4 có, nhưng giữ `.optional()` đúng bảng khai.
  relX: z.number().optional(),
  relY: z.number().optional(),
  // (B) VỆ SINH: `product_positions.templateImageUrl` là `text`. ★ Task 2 QUYẾT:
  // GHI (bảng ánh xạ của kế hoạch bỏ sót; cột tồn tại).
  templateImagePath: z.string().max(1000).optional(),
  captures: z.array(captureTemplate),
});

/**
 * Cấp 1 — surface (mặt sản phẩm: TOP / BOTTOM …).
 *
 * ⚠ `surfaceId` (UUID) đi vào `product_surfaces.surfaceExtId`, NHƯNG payload
 * kết quả **không mang UUID này** — kết quả chỉ có `name`. ⇒ Khoá nối kết quả ở
 * cấp này là **`surfaceName`**, không phải `surfaceId`. Vì vậy `surfaceName`
 * `.trim().min(1)`: nó vừa là khoá nối, vừa đi vào cột **NOT NULL**
 * `product_surfaces.surfaceName` (khoá duy nhất cùng `productModelId`).
 */
export const surfaceTemplate = z.object({
  surfaceId: z.string().trim().min(1).max(64),
  surfaceName: z.string().trim().min(1).max(100),
  // (B) VỆ SINH: `product_surfaces.templateImageUrl` là `text`.
  surfaceTemplateImagePath: z.string().max(1000).optional(),
  positions: z.array(positionTemplate),
});

/**
 * Hợp đồng cây dạy — gốc.
 *
 * Mẫu thật CHỈ có đúng một khoá gốc `surfaces` (đo được: `["surfaces"]`), nên
 * hợp đồng cũng chỉ có đúng một. `productModelCode` (máy dạy cho model nào) là
 * đầu vào của **CỬA** ở Task 2, KHÔNG phải của cây — để ở đây là khai một
 * trường mẫu thật không có.
 *
 * ⚠ `surfaces: []` RỖNG vẫn HỢP LỆ ở tầng hợp đồng (mẫu thật không chứng minh
 * được điều ngược lại) — GIỮ NGUYÊN có chủ đích. ★ Task 2 đã quyết ở **CỬA**,
 * không ở đây: `submitMachineTemplate` **TỪ CHỐI** `surfaces: []`
 * (`CAY_DAY_RONG`, xem `machineApiRouters.ts`). Lý do để phép từ chối ở cửa chứ
 * không ở hợp đồng: hợp đồng mô tả HÌNH DẠNG máy gửi được; "cây rỗng nghĩa là
 * gì" là một quyết định của ĐƯỜNG GHI (nó mới biết cây rỗng sẽ xoá mềm cái gì).
 * Ai muốn một cửa khác chấp nhận cây rỗng (vd. một cửa 'xoá bản dạy' tường
 * minh) không phải nới hợp đồng.
 */
export const machineTemplateContract = z.object({
  surfaces: z.array(surfaceTemplate),
});

export type MachineTemplate = z.infer<typeof machineTemplateContract>;
export type SurfaceTemplate = z.infer<typeof surfaceTemplate>;
export type PositionTemplate = z.infer<typeof positionTemplate>;
export type CaptureTemplate = z.infer<typeof captureTemplate>;
export type ComponentTemplate = z.infer<typeof componentTemplate>;
