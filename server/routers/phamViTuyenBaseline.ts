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
 * ★★★ LƯỢT TẠO SỔ ĐÃ TRẢ **3** MỤC — số 88 khi ấy là **91 − 3**, và đây là lời khai kèm số liệu
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
 * ★★★ 2026-08-18 (lượt uỷ quyền `/uploads/**`) — **NĂM MỤC ĐÃ TRẢ: 88 → 83.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bản trước của khối này ghi rằng năm tuyến ảnh
 *
 *   `GET /api/inspection/:id/images` · `GET /api/measurement-point/:id/reference-image` ·
 *   `GET /api/product-model/:id/reference-images` · `GET /api/aoi/image/:packageId/:fileName` ·
 *   `GET /api/aoi/download/:packageId`
 *
 * **KHÔNG vá được bằng mã** vì chúng không có một phép xác thực nào để bám vào. Lời khai ấy đã
 * ĐÚNG vào lúc viết và nay **HẾT ĐÚNG**: cả năm đã đi qua `thuMoCongAnh` (ba lối vào có tên) rồi
 * áp `mayTrongPhamViAnh` / `sanPhamTrongPhamViAnh` — đo lại bằng chính bộ suy, cả năm rơi vào
 * nhóm **S** (`danhTinhRoiTay = true`).
 *
 * ⚠⚠ **CON SỐ HẠ THEO SỐ ĐO, KHÔNG THEO PHÉP TRỪ NHẨM.** Chạy lại `quetPhamViDoc` trên cây hiện
 * tại: `A = 83 · C = 38 · D = 71 · S = 15 · U = 16 · tổng 223`. Trùng khớp với `88 − 5` và
 * `10 + 5`, nhưng con số ghim đến từ **lượt chạy**, không từ dấu trừ — hai lượt sửa triệt tiêu
 * nhau sẽ giữ nguyên tổng mà làm lệch **hai** danh sách, và ratchet bắt đúng chuyện đó.
 *
 * ⚠ Bộ quét trước đây **không thể** nhìn thấy lượt vá vì `thuMoCongAnh` chưa có tên trong
 *   `HAM_DANH_TINH_REST`. Vì sao **KHÔNG** khai vào `TEN_PHAN_GIAI` (như sổ nợ trước đề nghị):
 *   xem khối đính chính ngay tại chỗ khai tên (`phamViDocScan.ts`) — khai vào đó sẽ khoá chặt cả
 *   năm tuyến vào nhóm A **vĩnh viễn**.
 *
 * ⚠ Khoá là `file#PHƯƠNGTHỨC đườngDẫn` — **KHÔNG mang số dòng** (dòng trôi ở mọi lượt sửa) và
 *   **KHÔNG mang tiền tố mount** (`app.use("/api/v1", …)`): bộ suy không đi đoán nơi gắn, vì đoán
 *   là bịa. Vì thế khoá mang cả `file` để vẫn duy nhất.
 *
 * SINH RA BỞI: `quetPhamViDoc().tuyen` + `nhomTuyenCua()` (`server/routers/phamViDocScan.ts`).
 * Đừng sửa tay để làm cổng xanh — sửa mã, rồi xoá dòng.
 */
export const NO_PHAM_VI_TUYEN: readonly string[] = [
  // ── server/_core/index.ts (0) ─────────────────────────────────────────────────────────────────
  // ── server/api/v1/advice.ts (0) ────────────────────────────────────────────────────────────────
  // ── server/api/v1/assets.ts (0) ────────────────────────────────────────────────────────────────
  // ── server/api/v1/events.ts (0) ────────────────────────────────────────────────────────────────
  // ── server/api/v1/genealogyApi.ts (0) ──────────────────────────────────────────────────────────
  // ── server/api/v1/lines.ts (0) ─────────────────────────────────────────────────────────────────
  // ── server/api/v1/metricsApi.ts (0) ────────────────────────────────────────────────────────────
  // ── server/api/v1/moduleReads.ts (0) ──────────────────────────────────────────────────────────
  // ★ Đợt 42 — `GET /machines/:id/detail` + `GET /robots/:id/detail` RỜI sổ: phạm vi của khoá
  //   (`req.apiPrincipal.tenantScope`, trục ②) nay đi vào `machineDetail`/`robotDetail` (đo trước vá:
  //   khoá SIM-FAC đọc identity máy 257 của NM18 — `.qa-dot41/api-vai/http-v1.json`).
  // ★ 2026-09-15 (QA lần 11, PH-23) — `GET /ecosystem/hierarchy` RỜI sổ: CÙNG lỗ với thủ tục tRPC
  //   `commandCenter.hierarchy`, chỉ khác trục (khoá API thay vì người dùng). Nay chiếu
  //   `req.apiPrincipal.tenantScope` → `resolveTenantCodeFactoryIds` → `buildHierarchy(scope, tenant)`,
  //   đúng khuôn `GET /ecosystem/kpi` đã vá 2026-08-18 ngay bên dưới nó trong cùng file.
  // ── server/api/v1/ordersLifecycle.ts (0) ───────────────────────────────────────────────────────
  // ── server/api/v1/pdmHealth.ts (0) ─────────────────────────────────────────────────────────────
  // ── server/api/v1/router.ts (0) ────────────────────────────────────────────────────────────────
  // ── server/api/v1/state.ts (0) ─────────────────────────────────────────────────────────────────
  // ── server/routes/edgeDownload.ts (0) ──────────────────────────────────────────────────────────
  // ── server/routes/externalHierarchyApi.ts (2) ───────────────────────────────────────────────
  // ★ 2026-10-24 — trích từ _core/index.ts; hierarchy/{tree,factory/:id,mqtt-topics,summary} đã lọc theo phạm vi (nhóm ④). Hai tuyến dưới còn nợ cho tới nhóm ⑤.
  "server/routes/externalHierarchyApi.ts#GET /api/external/dashboard/summary",
  "server/routes/externalHierarchyApi.ts#GET /api/external/statistics/measurement-points",
  // ── server/routes/externalInspectionApi.ts (18) ────────────────────────────────────────────────
  "server/routes/externalInspectionApi.ts#GET /api/external/alerts/summary",
  "server/routes/externalInspectionApi.ts#GET /api/external/fleet/summary",
  "server/routes/externalInspectionApi.ts#GET /api/external/inspections/ai-analysis",
  "server/routes/externalInspectionApi.ts#GET /api/external/inspections/cause-effect",
  "server/routes/externalInspectionApi.ts#GET /api/external/inspections/check-sheet",
  "server/routes/externalInspectionApi.ts#GET /api/external/inspections/control-chart",
  "server/routes/externalInspectionApi.ts#GET /api/external/inspections/defect-pareto",
  "server/routes/externalInspectionApi.ts#GET /api/external/inspections/diagnostics",
  "server/routes/externalInspectionApi.ts#GET /api/external/inspections/fail-history",
  "server/routes/externalInspectionApi.ts#GET /api/external/inspections/histogram",
  "server/routes/externalInspectionApi.ts#GET /api/external/inspections/scatter",
  "server/routes/externalInspectionApi.ts#GET /api/external/inspections/stratification",
  "server/routes/externalInspectionApi.ts#GET /api/external/inspections/summary",
  "server/routes/externalInspectionApi.ts#GET /api/external/inspections/trend",
  "server/routes/externalInspectionApi.ts#GET /api/external/inspections/yield-comparison",
  "server/routes/externalInspectionApi.ts#GET /api/external/oee/summary",
  "server/routes/externalInspectionApi.ts#GET /api/external/pdm/summary",
  "server/routes/externalInspectionApi.ts#GET /api/external/safety/summary",
  // ── server/routes/reportArtifactRoutes.ts (0) ──────────────────────────────────────────────────
  // ⚠ MỘT MỤC "TRONG SỔ VÌ BAO ĐÓNG, KHÔNG VÌ CÓ LỖ" — đọc trước khi ai đó đi vá nó. Tuyến này CÓ
  //   lọc theo người xem (`getDownloadTarget(id, viewer)`, `viewer` suy từ `authenticateExportRequest`).
  //   Nó ở nhóm (A) vì `chamTenant` bật do BAO ĐÓNG NGƯỢC: chính hàm XÁC THỰC đọc `api_keys` — một
  //   bảng CÓ `factoryCode` — nên mọi tuyến gọi nó đều "chạm dữ liệu tenant". Còn `report_artifacts`
  //   thì không thuộc tenant, nên `getDownloadTarget` không nằm trên đường đọc mà vị từ đo được.
  //   Cùng lớp với `systemRouters.ts#corporateFactoryStatsRouter.warmingStats` ở sổ tRPC.
];

/**
 * ★★★ 2026-10-24 — MIỄN TRỪ CÓ CHỦ Ý cho TUYẾN (khác SỔ NỢ: đây KHÔNG phải nợ chờ trả mà là quyết định ĐÃ DUYỆT, mỗi mục MỘT lý do thật có ngày).
 * Tuyến vẫn ở nhóm (A) theo bộ quét nhưng việc không lọc theo phạm vi là CỐ Ý: dữ liệu là DANH MỤC/REGISTRY dùng chung toàn tập đoàn.
 * §4 coi mục ở đây là đã khai; §5 giữ nó không hoá thạch (còn tồn tại · còn nhóm A · lý do ≥ 20 ký tự có ngày · không đồng thời nằm trong sổ nợ). Thêm mục = thêm quyết định.
 */
export const MIEN_TRU_TUYEN_CO_CHU_Y: Readonly<Record<string, string>> = {
  "server/api/v1/moduleReads.ts#GET /standards/alarm-taxonomy": "danh mục phân loại cảnh báo dùng chung toàn tập đoàn — duyệt mức kỹ thuật 2026-10-24 (cùng nguyên tắc danh mục công thức, chủ dự án duyệt)",
  "server/api/v1/moduleReads.ts#GET /standards/device-types": "danh mục kiểu thiết bị chuẩn dùng chung toàn tập đoàn — duyệt mức kỹ thuật 2026-10-24 (cùng nguyên tắc danh mục công thức, chủ dự án duyệt)",
  "server/routes/edgeDownload.ts#GET /api/edge/download/:deploymentId": "tải gói mô hình theo apiKey MÁY: deployment phải thuộc đúng máy gọi (403 chéo máy, 401 thiếu khoá) — đã kiểm bằng server/edgeDownloadProxy.test.ts, duyệt mức kỹ thuật 2026-10-24",
  "server/routes/reportArtifactRoutes.ts#GET /api/reports/artifacts/:id/download": "tệp báo cáo thuộc NGƯỜI TẠO (không thuộc nhà máy): getDownloadTarget từ chối người không đặc quyền khác (forbidden), admin tải được — đã kiểm bằng server/services/reportArtifactService.db.test.ts, duyệt mức kỹ thuật 2026-10-24",
  "server/api/v1/moduleReads.ts#GET /twin/models": "registry mô hình 3D dùng chung toàn tập đoàn — duyệt mức kỹ thuật 2026-10-24 (cùng nguyên tắc danh mục công thức, chủ dự án duyệt)",
};
