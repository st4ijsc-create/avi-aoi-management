/**
 * ★★★ 2026-08-18 — **SỔ NỢ "THỦ TỤC ĐỌC TRẢ DỮ LIỆU TENANT MÀ KHÔNG AI LỌC".**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ ĐÂY KHÔNG PHẢI DANH SÁCH CHO PHÉP. ĐÂY LÀ **MỘT CÁI TRẦN, VÀ NÓ CHỈ ĐƯỢC CO LẠI.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * 552 mục dưới đây là **nợ CÓ SẴN đo được ngày 2026-08-18**, không phải 552 quyết định
 * "chỗ này rò cũng được". Mỗi mục là một thủ tục `.query` với tới được một lượt đọc **bảng thuộc
 * tenant** mà **danh tính người gọi không rời tay handler** — nên (xem tiền đề đã đo ở
 * `phamViDocScan.ts`: hệ này KHÔNG có danh tính ngầm, RLS ở tầng CSDL nằm im) **không tầng nào
 * lọc được nó**.
 *
 * ⚠⚠ **VÌ SAO KHÔNG PHẢI "MỖI MỤC MỘT LÝ DO MIỄN TRỪ".** Bản mô tả nhiệm vụ đòi nhóm (A) rỗng
 * *hoặc* nằm trong một danh sách miễn trừ **có lý do từng mục**. Với 552 mục đo được, viết
 * 552 câu lý do trong một lượt là viết 552 câu **BỊA** — và một lý do bịa còn tệ hơn không
 * có lý do, vì nó biến một món nợ thành một quyết định đã-được-duyệt. Nên cơ chế ở đây là **RATCHET**,
 * và nó vẫn ĐỎ đúng lúc cần:
 *   • thủ tục ĐỌC dữ liệu tenant **MỚI** mà quên lọc ⇒ không có tên trong sổ ⇒ **ĐỎ** (§4);
 *   • mục đã VÁ mà **quên gỡ** khỏi sổ ⇒ sổ hoá thạch ⇒ **ĐỎ** (§5);
 *   • thêm một lỗ **và** vá một lỗ trong cùng lượt ⇒ con số ghim không đổi nhưng **hai** danh sách
 *     đều lệch ⇒ **ĐỎ** (§4 và §5 độc lập, phép cộng-trừ triệt tiêu không qua được).
 *
 * ⇒ **Trả nợ = XOÁ dòng.** Sổ này chỉ được co lại. Thêm dòng mới là một lời khai công khai rằng
 *   bạn vừa mở một lỗ phạm vi, và người review phải thấy đúng dòng ấy trong diff.
 *
 * ⚠ Khoá là `file#đườngRouter.tên` — **KHÔNG mang số dòng**: dòng trôi ở mọi lượt sửa, và một sổ
 *   khoá theo dòng sẽ đỏ vì những lượt chẳng liên quan gì tới phạm vi, rồi người sau sẽ tắt nó đi.
 *
 * SINH RA BỞI: `quetPhamViDoc()` + `nhomCua()` (`server/routers/phamViDocScan.ts`). Đừng sửa tay
 * để làm cổng xanh — sửa mã, rồi xoá dòng.
 */
export const NO_PHAM_VI_DOC: readonly string[] = [
  // ── server/_core/systemRouter.ts (1) ───────────────────────────────────────────────────────
  "server/_core/systemRouter.ts#systemRouter.exportConfig",
  // ── server/routers/aiAnomalyRouter.ts (4) ──────────────────────────────────────────────────
  // ★★★ 2026-08-18, lượt 4 — BỐN mục dưới đây (3 ở `aiCalibrationRouter.ts` + `vda5050Router.status`)
  // **KHÔNG PHẢI NỢ MỚI**. Không một dòng nào của chúng đổi. Cái đổi là **THƯỚC ĐO**: `nhap()` của
  // `phamViDocScan` trước đây ánh xạ `import { getCalibrationReport } from "../db"` thành
  // `server/db/index.ts#…` — một nút KHÔNG TỒN TẠI, vì `server/db/index.ts` là barrel thuần (24
  // dòng `export *`). Nhánh `import * as db` thì lại CÓ đi qua `xuat()`. Cùng một lượt đọc, viết
  // bằng hai cú pháp, cho hai phán quyết khác nhau — và cú pháp phổ biến hơn cho phán quyết LỎNG
  // HƠN (rơi vào nhóm C "không thuộc tenant"). Lượt 4 vá `nhap()`, và bốn lượt rò VỐN CÓ lộ ra.
  // ⇒ Thêm dòng vào sổ ở đây là một lời khai *"thước vừa sắc hơn"*, **không** phải *"tôi vừa mở
  //   một lỗ"*. Đó là lý do khối chú thích này dài: một dòng thêm im lặng vào sổ RATCHET là đúng
  //   thứ mà cả sổ này tồn tại để ngăn.
  // ── server/routers/aiRcaCopilotRouter.ts (1) ───────────────────────────────────────────────
  // ── server/routers/aiRouters.ts (4) ────────────────────────────────────────────────────────
  // ── server/routers/alertRouters.ts (2) ─────────────────────────────────────────────────────
  // ── server/routers/aoiOnboardingRouter.ts (4) ──────────────────────────────────────────────
  // ── server/routers/apiKeyRouter.ts (1) ─────────────────────────────────────────────────────
  // ── server/routers/bomRouter.ts (5) ────────────────────────────────────────────────────────
  // ── server/routers/commandCenterRouter.ts — ĐÃ TRẢ 2026-09-15 (QA lần 11, PH-23) ───────────
  //    `commandCenterRouter.hierarchy` rời sổ: nay phân giải phạm vi từ `ctx.user` qua
  //    `resolveHierarchyScope` (nhóm A → S). Đo được TRƯỚC khi vá: 5 vai nhận CÙNG 450.811
  //    byte, CÙNG md5, kể cả tài khoản 0 gán nhà máy. Lưới hai chiều:
  //    `server/routers/commandCenterHierarchyScope.db.test.ts`.
  // ── server/routers/deviceAdapterRouter.ts — ★ 2026-10-24: 2 mục ĐÃ TRẢ (get · list ⇒ S qua server/routers/_adapterPhamVi.ts), xoá khỏi sổ ──
  // ── server/routers/digitalTwinRouter.ts — ★ ĐỢT 14 LÔ Q1: 5 mục ĐÃ TRẢ, xoá khỏi sổ ────────
  //    twinState · defectHeatmap · wipFlowState · stationLoadHeatmap · predictionOverlay đều đã
  //    mang `phamViCua(ctx)` xuống tầng dữ liệu. Nghiệm thu hai chiều trên CSDL thật ở
  //    `digitalTwinPhamVi.db.test.ts`; phân đôi toàn tập ở `phamViTwinCanh.unit.test.ts`.
  //    (`whatIf` chưa từng có tên ở đây — nó là hàm thuần, không chạm CSDL.)
  // ── server/routers/ecosystemAdminRouter.ts (1) ─────────────────────────────────────────────
  // ── server/routers/edgeRuntimeRouter.ts (1) — 2026-10-10 (doc 81 Đợt 5 E2 fix): nodeStatus đã vá (runs lọc theo phạm vi), dòng đã gỡ.
  // ── server/routers/equipmentStandardsRouter.ts (8) ─────────────────────────────────────────
  // 2026-09-27 (doc 80 Đợt 1 Task 3, STD-04) — `alarmKpis` không còn tự đọc `andon_events`
  // (toàn cục, bộ tính thứ hai): nó uỷ quyền `alarmKpiRouter.createCaller(ctx).summary(…)`,
  // tức đi qua CÙNG cổng `resolveAlertScope(ctx.user)` với /alarm-kpi ⇒ danh tính RỜI TAY
  // handler ⇒ nhóm S, XOÁ khỏi sổ này (GHIM.A 342→341, S 329→330).
  // ── server/routers/erpAdminRouter.ts (3) ───────────────────────────────────────────────────
  // ── server/routers/federationRouter.ts (7) ─────────────────────────────────────────────────
  // ── server/routers/feederVerifyRouter.ts (3) ───────────────────────────────────────────────
  // ── server/routers/fieldRouter.ts (3) ──────────────────────────────────────────────────────
  // ── server/routers/hierarchyRouters.ts (1) ─────────────────────────────────────────────────
  // ── server/routers/hierarchyTreeRouter.ts (4) ──────────────────────────────────────────────
  // ── server/routers/hotFolderRouter.ts (3) ──────────────────────────────────────────────────
  // ── server/routers/layoutRouters.ts (2) ────────────────────────────────────────────────────
  // ── server/routers/machineApiRouters.ts (1) ────────────────────────────────────────────────
  // ── server/routers/mappingAsCodeRouter.ts — ★ 2026-10-24: 1 mục ĐÃ TRẢ (exportOne ⇒ S qua _adapterPhamVi.ts), xoá khỏi sổ ──
  // ── server/routers/mqttBulletinRouter.ts (5) ───────────────────────────────────────────────
  // ── server/routers/mqttClientManagementRouter.ts (6) ───────────────────────────────────────
  // ── server/routers/mqttNgAlertSettingsRouter.ts (2) ────────────────────────────────────────
  // ── server/routers/mqttSoftwareVersionRouter.ts (1) ────────────────────────────────────────
  // ── server/routers/ngRateThresholdRouter.ts (4) ────────────────────────────────────────────
  "server/routers/oversightRouter.ts#oversightRouter.posture",
  // ── server/routers/parameterGuardrailRouter.ts (5) ─────────────────────────────────────────
  // ── server/routers/permissionsRouter.ts (2) ────────────────────────────────────────────────
  // ── server/routers/processRouter.ts (2) ────────────────────────────────────────────────────
  // ── server/routers/productVariantRouter.ts (2) ─────────────────────────────────────────────
  // ── server/routers/programmingRouter.ts (9) ────────────────────────────────────────────────
  // ★★★ 2026-08-18 — 8 mục của `server/routers/publicProductApiRouter.ts` ĐÃ ĐƯỢC TRẢ, xoá khỏi
  // đây. Tám thủ tục ấy nay thu hẹp về nhà máy của MÁY GỌI (`publicProductScope.ts`) và bộ suy
  // xếp chúng vào nhóm **B** — xem `phamViDocCensus.test.ts` §8, nơi tập ấy được ghim TỪNG TÊN.
  // ── server/routers/safetyRouter.ts (5) ─────────────────────────────────────────────────────
  // ★ 2026-10-09 (doc 81 Đợt 3b final wave, rà soát bảo mật) — `safetyRouter.listAssignments` RỜI sổ: nay lọc theo phạm vi
  //   nhà máy của HÀNG (factoryId › chuyền › trạm; mồ côi bị loại) bằng `resolveTenantFactoryScope(phamViCua(ctx))` — bộ lọc
  //   ca Đợt 3b Task 1 từng cho phép dò hàng nhà máy khác theo id ca. Bộ quét xếp nó sang S.
  // ── server/routers/simTargetsRouter.ts (1) ─────────────────────────────────────────────────
  // ★ 2026-09-27 (doc 81 Đợt 1B final wave, item 4) — `ursimPing` vào nhóm (A) vì Task 3 (R3/R9)
  // cho `resolveSimTarget` đọc `robots` + `device_adapters` của MỌI tenant để TỪ CHỐI một sim
  // target trỏ vào host của thiết bị thật (nhả phanh robot thật là điều cổng này ngăn). Thủ tục
  // KHÔNG trả một hàng tenant nào (chỉ reachable:true/false của cổng dashboard URSim) và phép so
  // CỐ Ý xuyên tenant — thu hẹp theo `ctx.user` sẽ làm YẾU chính cổng an toàn ấy. Cùng loại lời
  // khai như `oversightRouter.posture` (số đếm gộp, không phải dữ liệu tenant). Sàn: URSIM_ENABLED
  // + machine_control/canCreate. Bộ suy xếp (A) vì đúng hình dạng nó canh; giữ ở đây để không ai
  // quên nó là một lượt đọc xuyên tenant có chủ đích.
  // ── server/routers/simulationRouter.ts (1) ─────────────────────────────────────────────────
  // ── server/routers/sitesRouter.ts (2) ──────────────────────────────────────────────────────
  // ── server/routers/systemHealthRouter.ts (1) ───────────────────────────────────────────────
  // ── server/routers/systemRouters.ts (1) ────────────────────────────────────────────────────
  // ── server/routers/thresholdApprovalRouter.ts (3) ──────────────────────────────────────────
  // ── server/routers/twinRouter.ts (2) ───────────────────────────────────────────────────────
  // doc 81 Đợt 4 Task A3: occupancyGrid · replay · sceneGraph · twinModels đã vá (assertTwinFactoryInScope) — đã GỠ.
  // ── server/routers/userRouters.ts (1) ──────────────────────────────────────────────────────
  // ── server/routers/vda5050Router.ts (2) ────────────────────────────────────────────────────
  // ↓ cùng lời khai "thước vừa sắc hơn" như khối `aiCalibrationRouter.ts` ở trên.
];

/**
 * ★★★ 2026-10-24 — MIỄN TRỪ CÓ CHỦ Ý (khác SỔ NỢ: đây KHÔNG phải nợ chờ trả, mà là quyết định ĐÃ DUYỆT, mỗi mục MỘT lý do thật).
 * Thủ tục vẫn ở nhóm (A) theo bộ quét (đọc bảng tenant không lọc phạm vi) nhưng việc không lọc là CỐ Ý. §4 coi mục ở đây là đã khai; §5 giữ nó không hoá thạch
 * (còn tồn tại, còn nhóm A, lý do ≥ 20 ký tự có ngày duyệt, không đồng thời nằm trong sổ nợ). Thêm mục = thêm quyết định của chủ dự án, KHÔNG phải cách làm cổng xanh.
 */
export const MIEN_TRU_CO_CHU_Y: Readonly<Record<string, string>> = {
  "server/routers/shiftConfigRouter.ts#shiftConfigRouter.defaults": "ca mặc định TOÀN CỤC (shift_configs.factoryId NULL) — dùng chung mọi nhà máy, chỉ GHI là toàn quyền (luật W13) — dieu-phoi duyệt 2026-10-25",
  "server/routers/alertRouters.ts#alertRouter.getById": "dữ liệu của CHÍNH người gọi: chỉ chủ cài đặt hoặc admin, ngoài ≡ NOT_FOUND (luật W17a) — dieu-phoi duyệt 2026-10-25",
  "server/routers/alertRouters.ts#alertRouter.listAll": "adminProcedure ⇒ admin = toàn quyền; liệt kê cài đặt cảnh báo của mọi người dùng — dieu-phoi duyệt 2026-10-25",
  "server/routers/simTargetsRouter.ts#simTargetsRouter.ursimPing": "một mục tiêu sim DUY NHẤT lấy từ env (URSIM_HOST); resolveSimTarget từ chối host trùng robot / adapter thật; chỉ trả reachable true/false, không trả hàng tenant; giữ cổng machine_control — dieu-phoi duyệt 2026-10-25",
  "server/routers/hierarchyRouters.ts#machineRouter.config": "TẠM MIỄN: hợp đồng thiết bị, public theo serial — KHÔNG xác thực: ai biết serial đều nhận machineId / code / ánh xạ trạm-chuyền (lộ không xác thực). Backlog: bắt khoá máy cho config = đổi hợp đồng client, chờ chủ dự án — dieu-phoi duyệt tạm 2026-10-25",
  "server/routers/permissionsRouter.ts#permissionsRouter.getBuiltInRoles": "adminProcedure ⇒ admin = toàn quyền; danh mục vai trò dựng sẵn, không dữ liệu tenant — dieu-phoi duyệt 2026-10-25",
  "server/routers/permissionsRouter.ts#permissionsRouter.getDefaultPermissionsForRole": "adminProcedure ⇒ admin = toàn quyền; quyền mặc định theo vai trò, không dữ liệu tenant — dieu-phoi duyệt 2026-10-25",
  "server/routers/sitesRouter.ts#sitesRouter.get": "adminProcedure ⇒ admin = toàn quyền; danh bạ site liên bang — dieu-phoi duyệt 2026-10-25",
  "server/routers/sitesRouter.ts#sitesRouter.list": "adminProcedure ⇒ admin = toàn quyền; danh bạ site liên bang — dieu-phoi duyệt 2026-10-25",
  "server/routers/systemRouters.ts#corporateFactoryStatsRouter.warmingStats": "adminProcedure ⇒ admin = toàn quyền; thống kê làm nóng bộ nhớ đệm hệ thống — dieu-phoi duyệt 2026-10-25",
  "server/routers/userRouters.ts#userAssignmentRouter.getAllUserAssignments": "adminProcedure ⇒ admin = toàn quyền; quản trị gán người dùng ↔ nhà máy — dieu-phoi duyệt 2026-10-25",
  "server/routers/machineRecipeRouter.ts#machineRecipeRouter.recipes.genealogy":
    "danh mục công thức dùng chung toàn tập đoàn — chủ dự án duyệt 2026-10-24",
  "server/routers/machineRecipeRouter.ts#machineRecipeRouter.recipes.get":
    "danh mục công thức dùng chung toàn tập đoàn — chủ dự án duyệt 2026-10-24",
  "server/routers/machineRecipeRouter.ts#machineRecipeRouter.recipes.listCodes":
    "danh mục công thức dùng chung toàn tập đoàn — chủ dự án duyệt 2026-10-24",
  "server/routers/machineRecipeRouter.ts#machineRecipeRouter.recipes.listVersions":
    "danh mục công thức dùng chung toàn tập đoàn — chủ dự án duyệt 2026-10-24",
  "server/routers/alertRouters.ts#alertRouter.list": "dữ liệu của CHÍNH người gọi (lọc theo chủ) — dieu-phoi duyệt mức kỹ thuật 2026-10-25: getAlertSettings(ctx.user.id) = WHERE userId = người gọi",
  "server/routers/machineRecipeRouter.ts#machineRecipeRouter.changeover.listMine": "dữ liệu của CHÍNH người gọi (lọc theo chủ) — dieu-phoi duyệt mức kỹ thuật 2026-10-25: WHERE requestedBy = người gọi",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.grep": "cây mã nguồn repo, RBAC ai_repo_read, không phải dữ liệu nhà máy — dieu-phoi duyệt mức kỹ thuật 2026-10-25",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.listFiles": "cây mã nguồn repo, RBAC ai_repo_read, không phải dữ liệu nhà máy — dieu-phoi duyệt mức kỹ thuật 2026-10-25",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.readFile": "cây mã nguồn repo, RBAC ai_repo_read, không phải dữ liệu nhà máy — dieu-phoi duyệt mức kỹ thuật 2026-10-25",
  "server/routers/scadaCommandsRouter.ts#scadaCommandsRouter.trangThai": "dữ liệu của CHÍNH người gọi (lọc theo chủ) — dieu-phoi duyệt mức kỹ thuật 2026-10-25: lenhHmi.dongChoCuaNguoi lọc userId từ ctx, attempts theo requestId+userId (scada-master xác nhận). Giới hạn chấp nhận: người mất phạm vi sau khi tạo yêu cầu vẫn xem trạng thái yêu cầu của mình tới khi hết hạn",
  "server/routers/edgeDeploymentRouter.ts#edgeDeploymentRouter.getFleetOverview": "adminProcedure ⇒ vai admin = phạm vi TOÀN QUYỀN trong hệ thống này (cùng lý do system.exportConfig); dieu-phoi duyệt mức kỹ thuật 2026-10-25",
  "server/routers/edgeDeploymentRouter.ts#edgeDeploymentRouter.getDeploymentStatus": "adminProcedure ⇒ vai admin = phạm vi TOÀN QUYỀN trong hệ thống này (cùng lý do system.exportConfig); dieu-phoi duyệt mức kỹ thuật 2026-10-25",
  "server/routers/edgeDeploymentRouter.ts#edgeDeploymentRouter.getUnifiedFleetStatus": "adminProcedure ⇒ vai admin = phạm vi TOÀN QUYỀN trong hệ thống này (cùng lý do system.exportConfig); dieu-phoi duyệt mức kỹ thuật 2026-10-25",
  "server/routers/edgeDeploymentRouter.ts#edgeDeploymentRouter.listDeployments": "adminProcedure ⇒ vai admin = phạm vi TOÀN QUYỀN trong hệ thống này (cùng lý do system.exportConfig); dieu-phoi duyệt mức kỹ thuật 2026-10-25",
  "server/routers/equipmentIntegrationRouter.ts#equipmentIntegrationRouter.listRecipeVersions": "danh mục phiên bản công thức dùng chung toàn tập đoàn (cùng quyết định với recipes.listVersions) — dieu-phoi duyệt mức kỹ thuật 2026-10-25",
  "server/routers/equipmentIntegrationRouter.ts#equipmentIntegrationRouter.frameworkSnapshot": "bộ nhớ đệm FocasAdapter/EuromapAdapter nằm TRÊN THỂ HIỆN và mỗi lượt gọi dựng thể hiện mới ⇒ ảnh chụp luôn rỗng, không chứa số đo nhà máy nào (đã đọc mã focasAdapter.ts) — 2026-10-25. ⚠ PHẢI XEM LẠI khi nối connector FOCAS/Euromap thật (cache theo máy/chia sẻ giữa lượt gọi ⇒ có thể chứa số đo nhà máy) — dieu-phoi duyệt 2026-10-25",
  "server/routers/semanticsRouter.ts#semanticsRouter.list": "định nghĩa metric TĨNH (YAML contracts/metrics, không có dữ liệu theo nhà máy) — dieu-phoi duyệt 2026-10-25",
  "server/routers/semanticsRouter.ts#semanticsRouter.get": "định nghĩa metric TĨNH (YAML contracts/metrics, không có dữ liệu theo nhà máy) — dieu-phoi duyệt 2026-10-25",
  "server/routers/spcAnalysisRouter.ts#spcAnalysisRouter.topNGPoints": "ĐÃ phạm vi qua userId/userRole → resolveStatsScope (db.getTopNGMeasurementPointsEnhanced); bộ quét không nhận lời gọi db.* — bằng chứng: loDoLuongPhamVi.db.test.ts \"spc.topNGPoints\" (A 1 · admin 2) + db/statisticsScope.test.ts — dieu-phoi duyệt 2026-10-25",
  "server/routers/ntfClassifierRouter.ts#ntfClassifierRouter.list": "adminProcedure ⇒ vai admin = phạm vi TOÀN QUYỀN (cùng lý do edgeDeployment); mô hình NTF trained toàn cục — dieu-phoi duyệt 2026-10-25",
  "server/routers/ntfClassifierRouter.ts#ntfClassifierRouter.status": "chỉ trả mô hình đang chạy phạm vi TOÀN CỤC (machineId NULL: getActiveNtfClassifier() không truyền máy) + cờ — theo quyết định \"NULL ⇒ thấy cho mọi người có quyền module\"; mô hình theo máy KHÔNG qua thủ tục này — dieu-phoi duyệt 2026-10-25",
  "server/routers/aiLocalTrainingRouter.ts#aiLocalTrainingRouter.capabilities": "chỉ cấu hình mô hình + số năng lực (ai_models, tệp mô hình trên đĩa, đếm mẫu toàn hệ thống); không trả hàng dữ liệu nhà máy — dieu-phoi duyệt 2026-10-25",
  "server/routers/aiSettingsRouter.ts#aiSettingsRouter.getDataPipelineStats": "4 con số tổng + cờ pipeline (đếm embedding, tệp uploads, lỗi, trạng thái); không trả hàng dữ liệu nhà máy — dieu-phoi duyệt 2026-10-25",
};
