/**
 * ★★★ W19 (kiểm định phamViGhi, 2026-10-25; dieu-phoi duyệt) — BẰNG CHỨNG cho MỌI miễn trừ phạm vi.
 *
 * Một miễn trừ ("sở hữu theo người dùng", "danh mục dùng chung", "tính toán thuần", "đường PUBLIC có token"…) là một LỜI KHAI bằng chữ. Bốn lô W17 đã bác 8 lời khai như vậy khi đem ra test
 * (duplicateCustomDashboard, reportArtifact đa nhà máy, cancelJob, imageKey ×9, rollback model, yield/mqtt…). Tệp này bắt mỗi miễn trừ MANG THEO bằng chứng kiểm chứng được:
 *   • `test` — đường dẫn tệp test + MỘT chuỗi nằm trong TÊN ca (`it(` / `describe(`) chứng minh lời khai (census kiểm tệp tồn tại và chuỗi nằm trên dòng `it(`/`describe(`);
 *   • `ma`   — dẫn chứng mã cho loại không test được bằng DB (sàn quản trị / đường có token): đường dẫn tệp + MỘT đoạn mã phải có trong tệp.
 * Miễn trừ CHƯA có bằng chứng ⇒ vào "nợ-bằng-chứng" (số ghim GIẢM dần ở `phamViBangChungCensus.test.ts`; thêm miễn trừ mới mà không kèm bằng chứng ⇒ nợ tăng ⇒ ĐỎ).
 * Ba sổ: `MIEN_TRU_GHI` (ghi), `MIEN_TRU_CO_CHU_Y` (đọc, luong-ui), `MIEN_TRU_TUYEN_CO_CHU_Y` (tuyến REST). Cấu trúc ba sổ KHÔNG đổi — bằng chứng nằm ở đây, khoá giống hệt.
 */
export type BangChung =
  | { loai: "test"; tep: string; ca: string }
  | { loai: "ma"; tep: string; dau: string }
  /** `thuan` — thủ tục KHÔNG chạm CSDL ở tầng router: thân thủ tục (thuộc tính `ten` trong đối tượng router của `tep`) không chứa getDb / db. / import("…/db…") / drizzle. Chứng minh bằng AST, không phải lời khai. */
  | { loai: "thuan"; tep: string; ten: string };

const T = (tep: string, ca: string): BangChung => ({ loai: "test", tep, ca });
const M = (tep: string, dau: string): BangChung => ({ loai: "ma", tep, dau });
const P = (tep: string, ten: string): BangChung => ({ loai: "thuan", tep, ten });

const R = "server/routers/";
type Nhom = [file: string, thuTuc: string[], bc: BangChung];

/** Bằng chứng cho sổ GHI (khoá = `server/routers/<file>#<đường>`; riêng `server/_core/…` ghi đủ đường dẫn trong `file`). */
const NHOM_GHI: Nhom[] = [
  // ── sở hữu theo NGƯỜI DÙNG (W17a) ──
  ["dashboardWidgetRouters.ts", ["dashboardWidgetRouter.updateCustomDashboard", "dashboardWidgetRouter.deleteCustomDashboard", "dashboardWidgetRouter.toggleCustomDashboardFavorite", "dashboardWidgetRouter.toggleCustomDashboardPublic", "dashboardWidgetRouter.saveCustomDashboardAsTemplate"], T(R + "phamViGhiDoW17a.db.test.ts", "B sửa / xoá / bật-tắt / lưu thành mẫu bảng RIÊNG của A")],
  ["dashboardWidgetRouters.ts", ["dashboardWidgetRouter.duplicateCustomDashboard"], T(R + "phamViGhiDoW17a.db.test.ts", "B sao chép bảng RIÊNG của A")],
  ["dashboardWidgetRouters.ts", ["dashboardWidgetRouter.updateStylePreset", "dashboardWidgetRouter.deleteStylePreset", "dashboardWidgetRouter.cloneSharedPreset"], T(R + "phamViGhiDoW17a.db.test.ts", "B sửa / xoá / nhân bản preset RIÊNG của A")],
  ["alertRouters.ts", ["alertRouter.update", "alertRouter.delete", "alertRouter.test", "alertRouter.acknowledge"], T(R + "phamViGhiDoW17a.db.test.ts", "alertRouter: B update / delete / test / acknowledge")],
  ["notificationRouters.ts", ["notificationRouter.markAsRead", "notificationRouter.delete"], T(R + "phamViGhiDoW17a.db.test.ts", "notification.markAsRead / delete")],
  ["sessionRouter.ts", ["sessionRouter.revoke"], T(R + "phamViGhiDoW17a.db.test.ts", "session.revoke / user.revokeSession")],
  ["userRouters.ts", ["userRouter.revokeSession"], T(R + "phamViGhiDoW17a.db.test.ts", "session.revoke / user.revokeSession")],
  ["aiGatewayTokenRouter.ts", ["aiGatewayTokenRouter.thuHoi"], T(R + "phamViGhiDoW17a.db.test.ts", "aiGatewayToken.thuHoi")],
  ["annotationRouters.ts", ["annotationTemplateRouter.delete"], T(R + "phamViGhiDoW17a.db.test.ts", "annotationTemplate.delete")],
  ["aiAgentRouter.ts", ["aiAgentRouter.approvePlan", "aiAgentRouter.confirmStep", "aiAgentRouter.cancelSession"], T(R + "phamViGhiDoW17a.db.test.ts", "aiAgent: B approvePlan")],
  ["reportBuilderRouter.ts", ["reportBuilderRouter.duplicate"], T(R + "phamViGhiDoW14.db.test.ts", "reportBuilder.duplicate báo cáo RIÊNG của người khác")],
  // ── danh mục / cấu hình TOÀN CỤC: sàn quyền ghi (W17b) ──
  ["componentLibraryRouter.ts", ["componentLibraryRouter.packages.update", "componentLibraryRouter.packages.delete", "componentLibraryRouter.packages.restore", "componentLibraryRouter.footprints.create", "componentLibraryRouter.footprints.update", "componentLibraryRouter.footprints.delete", "componentLibraryRouter.linkMaterial"], T(R + "phamViGhiDoW17b.db.test.ts", "operator VÀ giám sát viên không có hàng quyền module")],
  ["causalGraphRouter.ts", ["causalGraphRouter.addNode", "causalGraphRouter.updateNode", "causalGraphRouter.deleteNode"], T(R + "phamViGhiDoW17b.db.test.ts", "operator VÀ giám sát viên không có hàng quyền module")],
  ["aiModelRouter.ts", ["aiModelRouter.createCard", "aiModelRouter.updateCard", "aiModelRouter.approveCard"], T(R + "phamViGhiDoW17b.db.test.ts", "operator VÀ giám sát viên không có hàng quyền module")],
  ["processRouter.ts", ["processRouter.update", "processRouter.delete", "processRouter.reorder"], T(R + "phamViGhiDoW17b.db.test.ts", "operator VÀ giám sát viên không có hàng quyền module")],
  ["masterDataRouter.ts", ["skillsRouter.update", "skillsRouter.delete", "uomRouter.update", "uomRouter.delete", "uomRouter.updateConversion", "uomRouter.deleteConversion", "materialsRouter.updateClass", "materialsRouter.deleteClass"], T(R + "phamViGhiDoW17b.db.test.ts", "operator VÀ giám sát viên không có hàng quyền module")],
  ["webhookRouter.ts", ["webhookRouter.update", "webhookRouter.delete", "webhookRouter.test", "webhookRouter.toggle"], T(R + "phamViGhiDoW17b.db.test.ts", "operator VÀ giám sát viên không có hàng quyền module")],
  ["qualityGateTemplateRouter.ts", ["qualityGateTemplateRouter.updateCustom", "qualityGateTemplateRouter.deleteCustom"], T(R + "phamViGhiDoW17b.db.test.ts", "nhóm qualityProcedure")],
  ["productRouters.ts", ["defectCatalogRouter.update", "defectCatalogRouter.delete"], T(R + "phamViGhiDoW17b.db.test.ts", "nhóm qualityProcedure")],
  // ── công cụ AI ghi qua cổng tool (W11c) ──
  ["aiRcaCopilotRouter.ts", ["aiRcaCopilotRouter.applyTopFix"], T(R + "phamViGhiDoW11c.db.test.ts", "phân tích gốc của máy A")],
  ["aiThresholdAdvisorRouter.ts", ["aiThresholdAdvisorRouter.applyNgThreshold"], T(R + "phamViGhiDoW11c.db.test.ts", "ngưỡng của nhà máy A")],
  ["aiVisionRouter.ts", ["aiVisionRouter.proposeDefect"], T(R + "phamViGhiDoW11c.db.test.ts", "lần kiểm tra A ⇒ đề xuất được")],
  // ── đường máy / token / công khai ──
  ["hierarchyRouters.ts", ["machineRouter.register"], T(R + "phamViGhiDoW15.db.test.ts", "máy ĐÃ DUYỆT + register cùng serial")],
  ["hierarchyRouters.ts", ["machineRouter.claimKey"], T(R + "machineClaimKey.test.ts", "R1 — machine.claimKey")],
  ["hierarchyRouters.ts", ["machineRouter.enroll"], T(R + "machineEnroll.test.ts", "machine.enroll — EnrollmentTokenError mapping")],
  ["machineApiRouters.ts", ["machineApiRouter.submitProcessResult"], T(R + "phamViGhiDoW15.db.test.ts", "máy A gửi kết quả khai stationId")],
  ["licenseRouter.ts", ["publicLicenseRouter.floatingCheckin", "publicLicenseRouter.floatingHeartbeat"], M(R + "licenseRouter.ts", "licenseServerSdk")],
  // ── AI/OT: chỉ giảm năng lượng / có cổng riêng / hàm thuần ──
  ["safetyRouter.ts", ["safetyRouter.abortCollaboration"], T(R + "phamViGhiDoW8.db.test.ts", "abortCollaboration")],
  ["robotRouter.ts", ["robotRouter.consoleStop"], T(R + "robotStopDegradedAuth.dot10.db.test.ts", "another factory's STOP is refused")],
  ["scadaCommandsRouter.ts", ["scadaCommandsRouter.huy"], T(R + "scadaCommandsRouter.confirm.db.test.ts", "người khác huy ⇒ NOT_FOUND")],
  ["simTargetsRouter.ts", ["simTargetsRouter.validateUrscript"], T(R + "simTargetsRouter.test.ts", "validateUrscript — không nhận host/cổng tuỳ ý")],
  ["hotFolderRouter.ts", ["hotFolderRouter.dryRun"], T(R + "hotFolderRouter.test.ts", "dryRun (persists nothing)")],
  ["aoiOnboardingRouter.ts", ["aoiOnboardingRouter.dryRun"], T(R + "aoiOnboardingRouter.test.ts", "dryRun (persists nothing)")],
  // ── W19: sở hữu theo người dùng — hội thoại AI · bình luận · báo cáo ──
  ["aiChatRouter.ts", ["aiChatRouter.updateConversation", "aiChatRouter.deleteConversation", "aiChatRouter.deleteMessage", "aiChatRouter.saveStreamedMessage"], T(R + "phamViGhiDoW19.db.test.ts", "aiChat: B sửa / xoá hội thoại")],
  ["trainingBatchCommentsRouter.ts", ["trainingBatchCommentsRouter.updateComment", "trainingBatchCommentsRouter.deleteComment"], T(R + "phamViGhiDoW19.db.test.ts", "trainingBatchComments: B sửa / xoá bình luận")],
  ["reportBuilderRouter.ts", ["reportBuilderRouter.update", "reportBuilderRouter.save"], T(R + "phamViGhiDoW19.db.test.ts", "reportBuilder.update: B sửa báo cáo của A")],
  // ── bằng chứng có sẵn trong repo (đã đọc, khớp lời khai) ──
  ["dashboardStatsRouters.ts", ["dashboardRouter.applyTemplate"], T(R + "loMauBangDieuKhienRiengTu.db.test.ts", "applyTemplate — mẫu riêng của người khác ⇒ null")],
  ["aiSettingsRouter.ts", ["aiSettingsRouter.cancelAiJob"], T("server/services/aiJobQueue.cancel.test.ts", "aiJobQueue.cancelJob — sở hữu")],
  ["aiLocalKbRouter.ts", ["aiLocalKbRouter.feedback"], T(R + "aiLocalKbRouter.test.ts", "aiLocalKbRouter.feedback")],
  ["aiSpecialistAgentRouter.ts", ["aiSpecialistAgentRouter.submitFeedback"], T(R + "aiSpecialistAgentRouter.test.ts", "phiên không thuộc về người dùng hiện tại ⇒ FORBIDDEN")],
  ["kbStudioRouter.ts", ["kbStudioRouter.startFinetune"], T(R + "kbStudioRouter.test.ts", "flag OFF ⇒ FORBIDDEN before any job")],
  ["aiAgentRouter.ts", ["aiAgentRouter.duyet", "aiAgentRouter.bac", "aiAgentRouter.hoanTac", "aiAgentRouter.nhoDeXuat", "aiAgentRouter.boDeXuat"], T("server/services/ai/agent/quanLyLuotChay.test.ts", "người khác ⇒ NOT_FOUND")],
  ["repoWorkspaceRouter.ts", ["repoWorkspaceRouter.doiTenPhien"], T(R + "repoWorkspaceDot3b.test.ts", "người khác ⇒ NOT_FOUND")],
  ["repoWorkspaceRouter.ts", ["repoWorkspaceRouter.luuPhien", "repoWorkspaceRouter.doiTenDuAnCaNhan", "repoWorkspaceRouter.xoaDuAnCaNhan"], T(R + "duAnCaNhanRouter.test.ts", "B đọc tệp / liệt kê / lưu phiên trên dự án của A")],
  ["repoWorkspaceRouter.ts", ["repoWorkspaceRouter.xoaPhien"], T(R + "aiCodingSessionScope.test.ts", "B mở phiên của A ⇒ NOT_FOUND")],
  ["repoWorkspaceRouter.ts", ["repoWorkspaceRouter.gitCommit", "repoWorkspaceRouter.gitTaoNhanh", "repoWorkspaceRouter.gitChuyenNhanh", "repoWorkspaceRouter.deXuatXoaTep", "repoWorkspaceRouter.deXuatDoiTenTep", "repoWorkspaceRouter.baiHocThem", "repoWorkspaceRouter.baiHocSua", "repoWorkspaceRouter.baiHocXoa"], T(R + "repoWorkspaceDot3b.test.ts", "dự án cá nhân của A: B ⇒ PROJECT_NOT_FOUND")],
  ["repoWorkspaceRouter.ts", ["repoWorkspaceRouter.deXuatThayTheLo", "repoWorkspaceRouter.deXuatSuaTay", "repoWorkspaceRouter.chayKiemChung", "repoWorkspaceRouter.gitGoiYThongDiep"], T(R + "aiCodingSessionScope.test.ts", "id ĐÚNG HÌNH DẠNG nhưng KHÔNG trong danh sách trắng ⇒ PROJECT_NOT_FOUND")],
  // ── W19b ──
  ["causalGraphRouter.ts", ["causalGraphRouter.replaceGraph"], T(R + "phamViGhiDoW17b.db.test.ts", "operator VÀ giám sát viên không có hàng quyền module")],
  ["webhookRouter.ts", ["webhookRouter.clearLogs"], T(R + "phamViGhiDoW17b.db.test.ts", "operator VÀ giám sát viên không có hàng quyền module")],
  ["aiAnomalyRouter.ts", ["aiAnomalyRouter.score"], T(R + "loAiDocNhom2PhamVi.db.test.ts", "★★★ aiAnomaly")],
  ["userRouters.ts", ["userSettingsRouter.setUiPrefs"], M(R + "userRouters.ts", "input.expectedUserId !== ctx.user.id")],
  ["server/_core/systemRouter.ts", ["systemRouter.marketplace.download"], M("server/db/dashboard.ts", "incrementTemplateUsage")],
  ["dashboardWidgetRouters.ts", ["dashboardWidgetRouter.applyStylePreset"], M(R + "dashboardWidgetRouters.ts", "incrementWidgetStylePresetUsage(input.id)")],
  ["dashboardWidgetRouters.ts", ["dashboardWidgetRouter.applySharedTemplate"], M(R + "dashboardWidgetRouters.ts", "incrementTemplateUsage(input.id)")],
  ["dashboardWidgetRouters.ts", ["dashboardWidgetRouter.saveLayout"], M(R + "dashboardWidgetRouters.ts", "saveDashboardWidgetLayout(ctx.user.id")],
  ["dashboardWidgetRouters.ts", ["dashboardWidgetRouter.createCustomDashboard"], M(R + "dashboardWidgetRouters.ts", "userId: ctx.user.id,")],
  ["operatorBadgeRouter.ts", ["operatorBadgeRouter.update", "operatorBadgeRouter.revoke"], M(R + "operatorBadgeRouter.ts", "requirePermission(MODULE, \"canEdit\")")],
  // ── W19c ──
  ["aiCopilotRouter.ts", ["aiCopilotRouter.confirmAction"], T("server/services/aiCopilotActions.test.ts", "confirm with wrong userId is blocked")],
  ["aiCopilotRouter.ts", ["aiCopilotRouter.cancelAction"], T(R + "phamViGhiDoW19.db.test.ts", "aiCopilot.cancelAction: B huỷ hành động chờ duyệt của A")],
  ["aiChayUngDungRouter.ts", ["aiChayUngDungRouter.chay"], T("server/services/ai/chayUngDung/dichVu.test.ts", "dự án CÁ NHÂN của người khác ⇒ PROJECT_NOT_FOUND")],
  ["aiChayUngDungRouter.ts", ["aiChayUngDungRouter.dung"], T("server/services/ai/chayUngDung/dichVu.test.ts", "người KHÁC dừng ⇒ NOT_FOUND")],
  ["aiChayUngDungRouter.ts", ["aiChayUngDungRouter.deXuatLenh"], T(R + "aiCodingSessionScope.test.ts", "id ĐÚNG HÌNH DẠNG nhưng KHÔNG trong danh sách trắng ⇒ PROJECT_NOT_FOUND")],
  ["aiAgentRouter.ts", ["aiAgentRouter.startPlaybook"], T("server/services/aiPlaybookEngine.test.ts", "startPlaybook — RBAC gate")],
  ["aiAgentRouter.ts", ["aiAgentRouter.phanHoi"], T("server/services/ai/agent/thuTucLuotChay.phanHoi.test.ts", "bác thất bại (không phải của mình / đã xử lý) ⇒ KHÔNG ghi")],
  // ── W19c: thuần tầng router (AST: thân thủ tục không chạm CSDL) ──
  ["aiGgufRouter.ts", ["aiGgufRouter.generate"], P(R + "aiGgufRouter.ts", "generate")],
  ["aiGgufRouter.ts", ["aiGgufRouter.chat"], P(R + "aiGgufRouter.ts", "chat")],
  ["aiGgufRouter.ts", ["aiGgufRouter.analyzeDefect"], P(R + "aiGgufRouter.ts", "analyzeDefect")],
  ["aiGgufRouter.ts", ["aiGgufRouter.qualityInsights"], P(R + "aiGgufRouter.ts", "qualityInsights")],
  ["aiGgufRouter.ts", ["aiGgufRouter.embedding"], P(R + "aiGgufRouter.ts", "embedding")],
  ["aiEvalRouter.ts", ["aiEvalRouter.evaluate"], P(R + "aiEvalRouter.ts", "evaluate")],
  ["aiEvalRouter.ts", ["aiEvalRouter.driftCheck"], P(R + "aiEvalRouter.ts", "driftCheck")],
  ["aiLocalTrainingRouter.ts", ["aiLocalTrainingRouter.predict"], P(R + "aiLocalTrainingRouter.ts", "predict")],
  ["aiSpecialistAgentRouter.ts", ["aiSpecialistAgentRouter.run"], P(R + "aiSpecialistAgentRouter.ts", "run")],
  ["aiSpecialistAgentRouter.ts", ["aiSpecialistAgentRouter.runWorkflowChain"], P(R + "aiSpecialistAgentRouter.ts", "runWorkflowChain")],
  ["aiSpecialistAgentRouter.ts", ["aiSpecialistAgentRouter.runModuleAudit"], P(R + "aiSpecialistAgentRouter.ts", "runModuleAudit")],
  ["kbStudioRouter.ts", ["kbStudioRouter.huyEvalMa"], P(R + "kbStudioRouter.ts", "huyEvalMa")],
  ["defectHeatmapRouter.ts", ["defectHeatmapRouter.generate"], T(R + "defectHeatmapScope.test.ts", "generate: cũng nối `scope` từ phiên")],
  ["aiChatRouter.ts", ["aiChatRouter.chat"], M(R + "aiChatRouter.ts", "const convIdNum = parseInt(input.conversationId, 10);")], // chỉ GHI vào hội thoại của chính người gọi (kiểm userId trước khi insert); LLM chạy trên đầu vào của người gọi
  ["productRouters.ts", ["productModelRouter.create"], T(R + "phamViGhiDoW19.db.test.ts", "productModel.create: thiếu quyền settings_products")],
  // ── router không mount ──
  ["aiAdvancedRouter.ts", ["abTestRouter.runInference", "abTestRouter.submitFeedback"], T(R + "phamViGhiCensus.test.ts", "§5d router TẮT")],
  // ── thủ tục AI nhận khoá ảnh (W17c): các thủ tục còn miễn trừ chỉ nhận ảnh base64 / văn bản của người gọi ──
  ["aiSegmentationRouter.ts", ["aiSegmentationRouter.runSegmentation"], M(R + "aiSegmentationRouter.ts", "image: z.string().min(16)")],
  ["aiSegmentationRouter.ts", ["aiSegmentationRouter.deleteMask"], M(R + "aiSegmentationRouter.ts", "row.createdBy !== ctx.user.id")],
];

function xayKhoa(file: string, duong: string): string {
  return (file.startsWith("server/") ? file : R + file) + "#" + duong;
}

function dung(nhom: Nhom[]): Record<string, BangChung> {
  const ra: Record<string, BangChung> = {};
  for (const [file, ds, bc] of nhom) for (const d of ds) ra[xayKhoa(file, d)] = bc;
  return ra;
}

export const BANG_CHUNG_GHI: Readonly<Record<string, BangChung>> = dung(NHOM_GHI);

/** Sổ ĐỌC (luong-ui) — cấu trúc `MIEN_TRU_CO_CHU_Y` không đổi; bằng chứng ở đây. */
export const BANG_CHUNG_DOC: Readonly<Record<string, BangChung>> = {
  "server/routers/shiftConfigRouter.ts#shiftConfigRouter.defaults": T("server/routers/loCauHinhDocPhamVi.db.test.ts", "shiftConfig.list: ca nhà máy B ẩn"),
  "server/routers/alertRouters.ts#alertRouter.getById": T("server/routers/loCauHinhDocPhamVi.db.test.ts", "alertRouter.getById: chủ hoặc admin"),
  "server/routers/alertRouters.ts#alertRouter.listAll": T("server/routers/loCauHinhDocPhamVi.db.test.ts", "alertRouter.getById: chủ hoặc admin"),
  "server/routers/simTargetsRouter.ts#simTargetsRouter.ursimPing": M("server/routers/simTargetsRouter.ts", "resolveSimTarget(input.targetId)"),
  "server/routers/hierarchyRouters.ts#machineRouter.config": M("server/routers/hierarchyRouters.ts", "config: publicProcedure"),
  "server/routers/permissionsRouter.ts#permissionsRouter.getBuiltInRoles": M("server/routers/permissionsRouter.ts", "getBuiltInRoles: adminProcedure"),
  "server/routers/permissionsRouter.ts#permissionsRouter.getDefaultPermissionsForRole": M("server/routers/permissionsRouter.ts", "getDefaultPermissionsForRole: adminProcedure"),
  "server/routers/sitesRouter.ts#sitesRouter.get": M("server/routers/sitesRouter.ts", "get: adminProcedure"),
  "server/routers/sitesRouter.ts#sitesRouter.list": M("server/routers/sitesRouter.ts", "list: adminProcedure.query"),
  "server/routers/systemRouters.ts#corporateFactoryStatsRouter.warmingStats": M("server/routers/systemRouters.ts", "warmingStats: adminProcedure"),
  "server/routers/userRouters.ts#userAssignmentRouter.getAllUserAssignments": M("server/routers/userRouters.ts", "getAllUserAssignments: adminProcedure"),
  "server/routers/machineRecipeRouter.ts#machineRecipeRouter.recipes.genealogy": T("server/routers/machineRecipeRouter.test.ts", "recipes.genealogy returns the code history"),
  "server/routers/machineRecipeRouter.ts#machineRecipeRouter.recipes.get": M("server/routers/machineRecipeRouter.ts", "const row = await getRecipeById(input.id);"),
  "server/routers/machineRecipeRouter.ts#machineRecipeRouter.recipes.listCodes": M("server/routers/machineRecipeRouter.ts", ".groupBy(machineRecipes.code)"),
  "server/routers/machineRecipeRouter.ts#machineRecipeRouter.recipes.listVersions": M("server/routers/machineRecipeRouter.ts", "return listRecipeVersions(input.code);"),
  "server/routers/alertRouters.ts#alertRouter.list": M("server/routers/alertRouters.ts", "return db.getAlertSettings(ctx.user.id);"),
  "server/routers/machineRecipeRouter.ts#machineRecipeRouter.changeover.listMine": M("server/routers/machineRecipeRouter.ts", ".where(eq(changeoverRequests.requestedBy, ctx.user.id))"),
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.grep": M("server/routers/repoWorkspaceRouter.ts", "checkPermission(userId, role, \"ai_repo_read\", \"canView\")"),
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.listFiles": M("server/routers/repoWorkspaceRouter.ts", "checkPermission(userId, role, \"ai_repo_read\", \"canView\")"),
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.readFile": M("server/routers/repoWorkspaceRouter.ts", "checkPermission(userId, role, \"ai_repo_read\", \"canView\")"),
  "server/routers/scadaCommandsRouter.ts#scadaCommandsRouter.trangThai": M("server/routers/scadaCommandsRouter.ts", "trangThaiYeuCauGhi(nguoiGoi(ctx), input)"),
  "server/routers/edgeDeploymentRouter.ts#edgeDeploymentRouter.getFleetOverview": M("server/routers/edgeDeploymentRouter.ts", "getFleetOverview: adminProcedure"),
  "server/routers/edgeDeploymentRouter.ts#edgeDeploymentRouter.getDeploymentStatus": M("server/routers/edgeDeploymentRouter.ts", "getDeploymentStatus: adminProcedure"),
  "server/routers/edgeDeploymentRouter.ts#edgeDeploymentRouter.getUnifiedFleetStatus": M("server/routers/edgeDeploymentRouter.ts", "getUnifiedFleetStatus: adminProcedure"),
  "server/routers/edgeDeploymentRouter.ts#edgeDeploymentRouter.listDeployments": M("server/routers/edgeDeploymentRouter.ts", "listDeployments: adminProcedure"),
  "server/routers/equipmentIntegrationRouter.ts#equipmentIntegrationRouter.listRecipeVersions": M("server/routers/equipmentIntegrationRouter.ts", "versions: await listVersions(input.code)"),
  "server/routers/equipmentIntegrationRouter.ts#equipmentIntegrationRouter.frameworkSnapshot": M("server/routers/equipmentIntegrationRouter.ts", "? new FocasAdapter(input.machineCode)"),
  "server/routers/semanticsRouter.ts#semanticsRouter.list": T("server/routers/semanticsRouter.test.ts", "list returns the governed catalogue"),
  "server/routers/semanticsRouter.ts#semanticsRouter.get": T("server/routers/semanticsRouter.test.ts", "get returns the full definition; NOT_FOUND for unknown metric"),
  "server/routers/spcAnalysisRouter.ts#spcAnalysisRouter.topNGPoints": T("server/routers/loDoLuongPhamVi.db.test.ts", "spc.topNGPoints — số NG của điểm đo chung"),
  "server/routers/ntfClassifierRouter.ts#ntfClassifierRouter.list": M("server/routers/ntfClassifierRouter.ts", "list: adminProcedure"),
  "server/routers/ntfClassifierRouter.ts#ntfClassifierRouter.status": M("server/routers/ntfClassifierRouter.ts", "const active = await getActiveNtfClassifier();"),
  "server/routers/aiLocalTrainingRouter.ts#aiLocalTrainingRouter.capabilities": M("server/routers/aiLocalTrainingRouter.ts", "return getTrainingCapabilities(input.modelId);"),
  "server/routers/aiSettingsRouter.ts#aiSettingsRouter.getDataPipelineStats": M("server/routers/aiSettingsRouter.ts", "getDataPipelineStats: protectedProcedure.query"),
};

/** Miễn trừ tuyến REST (đường nhận khoá API / token). */
export const BANG_CHUNG_TUYEN: Readonly<Record<string, BangChung>> = {
  "server/api/v1/moduleReads.ts#GET /standards/alarm-taxonomy": T("server/api/v1/moduleReads.test.ts", "U4a — scope gating"),
  "server/api/v1/moduleReads.ts#GET /standards/device-types": T("server/api/v1/moduleReads.test.ts", "U4a — scope gating"),
  "server/api/v1/moduleReads.ts#GET /twin/models": T("server/api/v1/moduleReads.test.ts", "U4a — scope gating"),
  "server/routes/edgeDownload.ts#GET /api/edge/download/:deploymentId": T("server/edgeDownloadProxy.test.ts", "returns 403 when deployment belongs to a different machine"),
};
