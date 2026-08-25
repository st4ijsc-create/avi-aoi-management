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
 */
import { z } from "zod";

// ── Cấp 0: định danh trạm (HookStation, HookContracts.cs:107-114) ───────────
const identityV2 = z.object({
  station: z.string().min(1),
  machine: z.string().min(1),
  line: z.string().min(1),
  plant: z.string().min(1),
  country: z.string().min(1),
  solutionName: z.string().min(1),
  appVersion: z.string().min(1),
});

// ── Cấp 4 (lá): component (HookComponent, HookContracts.cs:18-29) ───────────
// componentId = ComponentProject.Id — khoá join sang teach data (`template-sync-sample.json`).
// .trim() vì chuỗi TOÀN KHOẢNG TRẮNG qua .min(1) trần vẫn "hợp lệ" — một khoá
// join rỗng-thực-chất không join được với gì (F9, vòng sửa 1).
const componentV2 = z.object({
  componentId: z.string().trim().min(1),
  componentName: z.string().optional(),
  // "OK"/"NG" — KHÔNG "NTF". NTF là cờ `ntf` riêng ngay dưới đây.
  result: z.enum(["OK", "NG"]),
  ntf: z.boolean(),
  value: z.union([z.string(), z.number()]).nullable().optional(),
  lowerLimit: z.union([z.string(), z.number()]).nullable().optional(),
  upperLimit: z.union([z.string(), z.number()]).nullable().optional(),
  errorCode: z.string().nullable().optional(),
  errorDesc: z.string().nullable().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
});

// ── Cấp 3: capture (HookCapture, HookContracts.cs:41-50) ────────────────────
// captureId = Capture.Id — khoá join sang manifest ảnh (`aoipackage-meta-sample.json`).
// .trim() — cùng lý do componentId ở trên (F9, vòng sửa 1).
const captureV2 = z.object({
  captureId: z.string().trim().min(1),
  captureName: z.string().optional(),
  index: z.number().int().nonnegative().optional(),
  result: z.enum(["OK", "NG"]),
  ntf: z.boolean(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  // RỖNG là hợp lệ (đèn chụp vùng không có component) — KHÔNG .min(1).
  components: z.array(componentV2),
});

// ── Cấp 2: position (HookPosition, HookContracts.cs:61-69) ──────────────────
// positionId = ImagePosition.PositionId — định danh ổn định, tên thư mục lưu
// ảnh (sync-json-samples-reference.md:138) — cũng là khoá join, .trim() cùng
// nguyên tắc với captureId/componentId (F9, vòng sửa 1).
const positionV2 = z.object({
  positionId: z.string().trim().min(1),
  positionNumber: z.number().int().nonnegative().optional(),
  result: z.enum(["OK", "NG"]),
  ntf: z.boolean(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  captures: z.array(captureV2),
});

// ── Cấp 1: surface (gộp từ HookPosition.SurfaceName phía máy gửi) ───────────
const surfaceV2 = z.object({
  name: z.string().min(1),
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
  type: z.string().optional(),
  // Định danh xác thực máy (transport-level, giống v1/v1.1).
  apiKey: z.string().optional(),
  identity: identityV2,
  productId: z.string().min(1),
  // KHÔNG .min(1): serialNumber KHÔNG PHẢI khoá join (không dùng để nối dữ
  // liệu sang bảng khác) — rỗng là hình dạng THẬT khi máy chưa gán serial
  // (D:\SOURCES\AOIData\sync-json-samples-reference.md:26 — "serialNumber
  // ← HookProduct.Serial | Serial máy gửi; rỗng nếu máy chưa gửi"). Theo
  // §4.5 (ranh giới TỪ CHỐI vs GẮN THẺ): không phải khoá join ⇒ không từ
  // chối vì nội dung rỗng. Đã cân nhắc và loại `.min(1)` có chủ đích (F3,
  // vòng sửa 1) — ĐỪNG "sửa lại cho chặt".
  serialNumber: z.string().trim().max(100),
  productModel: z.string().optional(),
  overallResult: z.enum(["OK", "NG"]),
  ntf: z.boolean(),
  // null khi máy không gửi (HookProduct.MachineProductIndex).
  machineProductIndex: z.number().int().nullable().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  summary: z.object({
    surfaces: summaryGroupV2,
    positions: summaryGroupV2,
    captures: summaryGroupV2,
    components: summaryGroupV2,
  }),
  surfaces: z.array(surfaceV2),
});

export type MachineDataContractV2 = z.infer<typeof machineDataContractV2>;
