/**
 * ★★★ 2026-08-18 — **SỔ NỢ "TUYẾN EXPRESS ĐỌC TRẢ DỮ LIỆU TENANT MÀ KHÔNG AI LỌC".**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ ĐÂY KHÔNG PHẢI DANH SÁCH CHO PHÉP. ĐÂY LÀ **MỘT CÁI TRẦN, VÀ NÓ CHỈ ĐƯỢC CO LẠI.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Sổ này là bản song sinh của `phamViDocBaseline.ts` cho một bề mặt mà bản kia **theo cấu tạo
 * không đếm được**: `phamViDocScan` cũ chỉ nhìn thấy ô trong `router({…})` của tRPC, nên
 * **223 tuyến Express** dưới `server/**` nằm hoàn toàn ngoài phép điều tra dân số 2.209 thủ tục.
 * Lỗ đã chứng minh: `GET /api/public/products/:productCode/reference-image-file` phục vụ ĐÚNG
 * cùng dữ liệu cho ĐÚNG cùng người gọi bằng ĐÚNG cùng ba chứng thực như 8 thủ tục
 * `publicProductApiRouter`, và cổng §4 **không thể** đỏ vì nó.
 *
 * ⚠⚠ **VÌ SAO KHÔNG PHẢI "MỖI MỤC MỘT LÝ DO MIỄN TRỪ".** Với 88 mục đo được, viết 88 câu lý do
 * trong một lượt là viết 87 câu **BỊA** — và một lý do bịa còn tệ hơn không có lý do, vì nó biến
 * một món nợ thành một quyết định đã-được-duyệt. Cơ chế ở đây là **RATCHET**, giống hệt sổ tRPC:
 *   • tuyến ĐỌC dữ liệu tenant **MỚI** mà quên lọc ⇒ không có tên trong sổ ⇒ **ĐỎ**;
 *   • mục đã VÁ mà **quên gỡ** khỏi sổ ⇒ sổ hoá thạch ⇒ **ĐỎ**;
 *   • thêm một lỗ **và** vá một lỗ trong cùng lượt ⇒ con số ghim không đổi nhưng **hai** danh
 *     sách đều lệch ⇒ **ĐỎ** (hai phép so CÓ HƯỚNG, không phải một phép so số lượng).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ LƯỢT TẠO SỔ ĐÃ TRẢ **3** MỤC — số 88 dưới đây là **91 − 3**, và đây là lời khai kèm số liệu
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Số đo được ngay trước khi vá: **A = 91**. Ba tuyến sau đã được thu hẹp về nhà máy của TÀI KHOẢN
 * gọi (`server/routes/_phamViNgoai.ts`) trong CHÍNH lượt này, nên chúng **chưa bao giờ** vào sổ:
 *
 *   1. `GET /api/external/machines`             — trả `apiKey` của **TOÀN BỘ** đội máy
 *   2. `GET /api/external/machines/by-code/:code` — trả `apiKey` của một máy bất kỳ
 *   3. `GET /api/external/stations`             — bản đồ trạm của mọi nhà máy
 *
 * Hai mục đầu xếp trên đầu bảng vì một lượt gọi trái phép ở đó trả về **PHƯƠNG TIỆN lấy thêm sự
 * thật** (khoá máy mở tiếp `/api/public/**`, `/api/machine/**`, `/api/v1/**`), chứ không chỉ sự
 * thật. ⚠ Nhánh `x-master-key` giữ NGUYÊN TỪNG BYTE ở cả ba — chiều DƯƠNG chống vá quá tay.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ **NĂM MỤC TRONG SỔ NÀY KHÔNG VÁ ĐƯỢC BẰNG MÃ — CHÚNG CẦN MỘT QUYẾT ĐỊNH SẢN PHẨM.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Năm tuyến sau **KHÔNG có một phép xác thực nào** (không middleware, không khoá, không cookie —
 * đã đọc từng dòng thân handler, không phải suy từ tên):
 *
 *   `GET /api/inspection/:id/images` · `GET /api/measurement-point/:id/reference-image` ·
 *   `GET /api/product-model/:id/reference-images` · `GET /api/aoi/image/:packageId/:fileName` ·
 *   `GET /api/aoi/download/:packageId`
 *
 * Không có danh tính thì **không tồn tại trục nào để thu hẹp** — cách vá duy nhất là ĐÒI một
 * chứng thực, tức **đổi hợp đồng API**. Và hợp đồng ấy đang được dùng: ứng dụng Android ghi thẳng
 * *"/api/inspection/:id/images does not require auth — no headers needed"*
 * (`FactoryAlertSystem/src/services/imageService.ts:96`), còn `client/src/pages/AOIPackages.tsx`
 * mở `/api/aoi/image/…` bằng `window.open`. ⇒ Đây là việc của chủ dự án, **không** của một lượt
 * trả nợ tự quyết. Giữ trong sổ là lời khai đúng: nợ vẫn còn, và ai cũng đọc được nó ở đây.
 *
 * ⚠ Khoá là `file#PHƯƠNGTHỨC đườngDẫn` — **KHÔNG mang số dòng** (dòng trôi ở mọi lượt sửa) và
 *   **KHÔNG mang tiền tố mount** (`app.use("/api/v1", …)`): bộ suy không đi đoán nơi gắn, vì đoán
 *   là bịa. Vì thế khoá mang cả `file` để vẫn duy nhất.
 *
 * SINH RA BỞI: `quetPhamViDoc().tuyen` + `nhomTuyenCua()` (`server/routers/phamViDocScan.ts`).
 * Đừng sửa tay để làm cổng xanh — sửa mã, rồi xoá dòng.
 */
export const NO_PHAM_VI_TUYEN: readonly string[] = [
  // ── server/_core/index.ts (24) ─────────────────────────────────────────────────────────────────
  "server/_core/index.ts#GET /api/aoi/download/:packageId",
  "server/_core/index.ts#GET /api/aoi/image/:packageId/:fileName",
  "server/_core/index.ts#GET /api/external/alerts",
  "server/_core/index.ts#GET /api/external/alerts/:alertId",
  "server/_core/index.ts#GET /api/external/bulletins",
  "server/_core/index.ts#GET /api/external/dashboard/summary",
  "server/_core/index.ts#GET /api/external/hierarchy/factory/:factoryId",
  "server/_core/index.ts#GET /api/external/hierarchy/mqtt-topics",
  "server/_core/index.ts#GET /api/external/hierarchy/summary",
  "server/_core/index.ts#GET /api/external/hierarchy/tree",
  "server/_core/index.ts#GET /api/external/stations/:id",
  "server/_core/index.ts#GET /api/external/stations/:id/fail-history",
  "server/_core/index.ts#GET /api/external/stations/:id/inspection-points",
  "server/_core/index.ts#GET /api/external/stations/:id/measurement-stats",
  "server/_core/index.ts#GET /api/external/stations/:id/point-detail",
  "server/_core/index.ts#GET /api/external/stations/:id/products",
  "server/_core/index.ts#GET /api/external/stations/:id/statistics",
  "server/_core/index.ts#GET /api/external/stations/resolve-topic",
  "server/_core/index.ts#GET /api/external/statistics/measurement-points",
  "server/_core/index.ts#GET /api/external/workstations",
  "server/_core/index.ts#GET /api/external/workstations/:id",
  "server/_core/index.ts#GET /api/inspection/:id/images",
  "server/_core/index.ts#GET /api/measurement-point/:id/reference-image",
  "server/_core/index.ts#GET /api/product-model/:id/reference-images",
  // ── server/api/v1/advice.ts (1) ────────────────────────────────────────────────────────────────
  "server/api/v1/advice.ts#GET /recommendations",
  // ── server/api/v1/assets.ts (6) ────────────────────────────────────────────────────────────────
  "server/api/v1/assets.ts#GET /assets",
  "server/api/v1/assets.ts#GET /assets/:id",
  "server/api/v1/assets.ts#GET /assets/:id/config-drift",
  "server/api/v1/assets.ts#GET /assets/:id/health",
  "server/api/v1/assets.ts#GET /assets/:id/tags",
  "server/api/v1/assets.ts#GET /gateways/:id/status",
  // ── server/api/v1/events.ts (1) ────────────────────────────────────────────────────────────────
  "server/api/v1/events.ts#GET /events",
  // ── server/api/v1/genealogyApi.ts (1) ──────────────────────────────────────────────────────────
  "server/api/v1/genealogyApi.ts#GET /genealogy/:unitId",
  // ── server/api/v1/lines.ts (3) ─────────────────────────────────────────────────────────────────
  "server/api/v1/lines.ts#GET /lines",
  "server/api/v1/lines.ts#GET /lines/:id/stages",
  "server/api/v1/lines.ts#GET /lines/:id/state",
  // ── server/api/v1/metricsApi.ts (1) ────────────────────────────────────────────────────────────
  "server/api/v1/metricsApi.ts#GET /metrics/:metric",
  // ── server/api/v1/moduleReads.ts (16) ──────────────────────────────────────────────────────────
  "server/api/v1/moduleReads.ts#GET /anomaly/events",
  "server/api/v1/moduleReads.ts#GET /ecosystem/hierarchy",
  "server/api/v1/moduleReads.ts#GET /fleet/tasks",
  "server/api/v1/moduleReads.ts#GET /fleet/zones",
  "server/api/v1/moduleReads.ts#GET /machines/:id/detail",
  "server/api/v1/moduleReads.ts#GET /pdm/risk",
  "server/api/v1/moduleReads.ts#GET /programs",
  "server/api/v1/moduleReads.ts#GET /programs/:id/deployments",
  "server/api/v1/moduleReads.ts#GET /robots/:id/detail",
  "server/api/v1/moduleReads.ts#GET /safety/events",
  "server/api/v1/moduleReads.ts#GET /safety/zones",
  "server/api/v1/moduleReads.ts#GET /standards/alarm-taxonomy",
  "server/api/v1/moduleReads.ts#GET /standards/compliance",
  "server/api/v1/moduleReads.ts#GET /standards/device-types",
  "server/api/v1/moduleReads.ts#GET /twin/models",
  "server/api/v1/moduleReads.ts#GET /twin/scene-graph",
  // ── server/api/v1/ordersLifecycle.ts (3) ───────────────────────────────────────────────────────
  "server/api/v1/ordersLifecycle.ts#GET /orders",
  "server/api/v1/ordersLifecycle.ts#GET /orders/:id",
  "server/api/v1/ordersLifecycle.ts#GET /orders/:id/trace",
  // ── server/api/v1/pdmHealth.ts (2) ─────────────────────────────────────────────────────────────
  "server/api/v1/pdmHealth.ts#GET /health/assets/:id",
  "server/api/v1/pdmHealth.ts#GET /predictions",
  // ── server/api/v1/router.ts (4) ────────────────────────────────────────────────────────────────
  "server/api/v1/router.ts#GET /equipment",
  "server/api/v1/router.ts#GET /equipment/:id/capabilities",
  "server/api/v1/router.ts#GET /equipment/:id/state",
  "server/api/v1/router.ts#GET /equipment/:id/telemetry",
  // ── server/api/v1/state.ts (1) ─────────────────────────────────────────────────────────────────
  "server/api/v1/state.ts#GET /state/*",
  // ── server/routes/edgeDownload.ts (1) ──────────────────────────────────────────────────────────
  "server/routes/edgeDownload.ts#GET /api/edge/download/:deploymentId",
  // ── server/routes/externalInspectionApi.ts (23) ────────────────────────────────────────────────
  "server/routes/externalInspectionApi.ts#GET /api/external/alerts/summary",
  "server/routes/externalInspectionApi.ts#GET /api/external/fleet/summary",
  "server/routes/externalInspectionApi.ts#GET /api/external/inspections/ai-analysis",
  "server/routes/externalInspectionApi.ts#GET /api/external/inspections/cause-effect",
  "server/routes/externalInspectionApi.ts#GET /api/external/inspections/check-sheet",
  "server/routes/externalInspectionApi.ts#GET /api/external/inspections/control-chart",
  "server/routes/externalInspectionApi.ts#GET /api/external/inspections/defect-pareto",
  "server/routes/externalInspectionApi.ts#GET /api/external/inspections/diagnostics",
  "server/routes/externalInspectionApi.ts#GET /api/external/inspections/events",
  "server/routes/externalInspectionApi.ts#GET /api/external/inspections/fail-history",
  "server/routes/externalInspectionApi.ts#GET /api/external/inspections/histogram",
  "server/routes/externalInspectionApi.ts#GET /api/external/inspections/images",
  "server/routes/externalInspectionApi.ts#GET /api/external/inspections/measurements",
  "server/routes/externalInspectionApi.ts#GET /api/external/inspections/scatter",
  "server/routes/externalInspectionApi.ts#GET /api/external/inspections/stratification",
  "server/routes/externalInspectionApi.ts#GET /api/external/inspections/summary",
  "server/routes/externalInspectionApi.ts#GET /api/external/inspections/trend",
  "server/routes/externalInspectionApi.ts#GET /api/external/inspections/yield-comparison",
  "server/routes/externalInspectionApi.ts#GET /api/external/oee/summary",
  "server/routes/externalInspectionApi.ts#GET /api/external/pdm/summary",
  "server/routes/externalInspectionApi.ts#GET /api/external/products",
  "server/routes/externalInspectionApi.ts#GET /api/external/products/:id",
  "server/routes/externalInspectionApi.ts#GET /api/external/safety/summary",
  // ── server/routes/reportArtifactRoutes.ts (1) ──────────────────────────────────────────────────
  // ⚠ MỘT MỤC "TRONG SỔ VÌ BAO ĐÓNG, KHÔNG VÌ CÓ LỖ" — đọc trước khi ai đó đi vá nó. Tuyến này CÓ
  //   lọc theo người xem (`getDownloadTarget(id, viewer)`, `viewer` suy từ `authenticateExportRequest`).
  //   Nó ở nhóm (A) vì `chamTenant` bật do BAO ĐÓNG NGƯỢC: chính hàm XÁC THỰC đọc `api_keys` — một
  //   bảng CÓ `factoryCode` — nên mọi tuyến gọi nó đều "chạm dữ liệu tenant". Còn `report_artifacts`
  //   thì không thuộc tenant, nên `getDownloadTarget` không nằm trên đường đọc mà vị từ đo được.
  //   Cùng lớp với `systemRouters.ts#corporateFactoryStatsRouter.warmingStats` ở sổ tRPC.
  "server/routes/reportArtifactRoutes.ts#GET /api/reports/artifacts/:id/download",
];
