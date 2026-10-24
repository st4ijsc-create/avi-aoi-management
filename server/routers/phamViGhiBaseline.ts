/**
 * ★★★ 2026-10-24 — **SỔ NỢ "THỦ TỤC GHI (mutation) NHẬN KHOÁ ĐỊNH DANH THỰC THỂ MÀ KHÔNG QUA BỘ PHÂN GIẢI PHẠM VI".**
 *
 * ⚠⚠⚠ ĐÂY KHÔNG PHẢI DANH SÁCH CHO PHÉP. ĐÂY LÀ **MỘT CÁI TRẦN, VÀ NÓ CHỈ ĐƯỢC CO LẠI** (khuôn `phamViDocBaseline.ts`).
 * Các mục dưới đây là **nợ CÓ SẴN đo được 2026-10-24** (kiểm định, chưa ai vá). Mỗi mục là một `.mutation` mà
 * `.input(...)` có ≥ 1 khoá định danh thực thể (id · machineId · stationId · lineId · factoryId · adapterId · robotId · serial ·
 * lotId · orderId …) và chuỗi gọi của nó KHÔNG với tới bộ phân giải phạm vi nào (phamViCua · idsTrongPhamVi · adapterTrongPhamVi ·
 * mayTrongPhamVi · assert*InScope · trongPhamVi …) trước khi ghi. Người dùng nhà máy A gọi được mutation lên thực thể nhà máy B
 * (ĐO ĐỎ THẬT: `phamViGhiDo.db.test.ts` — recipes.create/archive/setGolden · aoiOnboarding.saveDraft/deleteDraft · safety.updateZone).
 *
 *   • mutation MỚI nhận khoá định danh mà quên cổng ⇒ không có tên trong sổ ⇒ **ĐỎ**;
 *   • mục đã VÁ mà quên gỡ khỏi sổ ⇒ **ĐỎ** (chống sổ hoá thạch);
 *   • thêm một vá một trong cùng lượt ⇒ **ĐỎ** ở cả hai ô (so có hướng, không so số lượng).
 * ⇒ **Trả nợ = XOÁ dòng.** Khoá là `file#đườngRouter.tên` — KHÔNG mang số dòng.
 *
 * ⚠ "Có cổng" là bằng chứng THEO TÊN (chuỗi gọi với tới một bộ phân giải), không chứng minh cổng áp lên đúng khoá nhận được.
 * Sinh bởi `quetPhamViGhi()` + `laNoGhi()` (`phamViGhiScan.ts`). Đừng sửa tay để làm cổng xanh — sửa mã, rồi xoá dòng.
 *
 * LỊCH SỬ TRẢ NỢ: 2026-10-24 lô W1 (−14: recipes.create/archive/setGolden/approve · equipmentIntegration.create/archive/release/rollbackRecipeVersion +
 * recordRecipeLoad · aoiOnboarding.saveDraft/deleteDraft/signOff/decommission · bom.recordComponentInstallation) ⇒ 724 → 710.
 * 2026-10-24 lô W2 (−13: safety.createZone/updateZone/ingestProximity/ingestSimulatedHuman/ingestDetectionFrame/startCollaboration ·
 * aiRobotAnomaly.scanRobot/acknowledgeAnomaly · twin.pipeline.convertUrdf/convertStep · rootCause.analyze/update/delete) ⇒ 710 → 697.
 * 2026-10-24 lô W4a (−3, khoá theo MÁY: productMachineMapping.update/delete · measurementSamples.ingest) ⇒ 697 → 694 (693 trong sổ + 1 miễn trừ).
 * 2026-10-24 bộ quét CHÍNH XÁC HƠN: hàm dẫn xuất tới được cổng chỉ tính là cổng khi lời gọi TRUYỀN danh tính (ctx, user, scope, phamVi..., cổng gốc) —
 * `db.getFactoryById(id)` (phạm vi là tham số tuỳ chọn, bỏ trống = không lọc) trước đó bị tính là cổng ⇒ +42 nợ THẬT bị che (factoryRouter.update/delete,
 * machineRouter.create/update/delete, productModelRouter.update …) ⇒ 694 → 736 (735 trong sổ + 1 miễn trừ); không mục nào biến mất.
 * 2026-10-24 lô W5 (−28, cây phân cấp: factory.update/delete/restore/updateMapPosition/updateFloorDims/uploadFloorPlan · factoryZone.* · workshop/line/station create/update/delete/restore ·
 * machine.create/update/delete/restore/setLifecycleStatus/updateLayout/updateLayoutPosition) ⇒ 736 → 708. Còn lại ở hierarchyRouters: thủ tục adminProcedure (admin phạm vi toàn quyền) và đường MÁY tự khai (register/claimKey/enroll — publicProcedure).
 * 2026-10-24 QUY TẮC MỚI: sàn adminProcedure/superAdminProcedure KHÔNG còn là nợ (admin phạm vi TOÀN QUYỀN theo thiết kế, canh bằng phamViGhiCensus §5c) ⇒ −218 (708 → 490).
 * 2026-10-24 lô W6 (−15, luật ghi theo SẢN PHẨM — chủ dự án duyệt: productModel.update/delete/clone · measurementPoint.create/delete/revert · productMachineMapping.create ·
 * productDocument.upload/delete · cadImport.parsePreview/applyCoordinates · msaWizard presets · spcAlerts.ack · measurementSamples.analyze) ⇒ 490 → 475; thêm 4 MIỄN TRỪ có lý do
 * (productModel.create · defectCatalog.update/delete · annotationTemplate.delete) ⇒ sổ 470 + 5 miễn trừ.
 */
export const NO_PHAM_VI_GHI: readonly string[] = [
  // ── server/_core/systemRouter.ts (1) ──
  "server/_core/systemRouter.ts#systemRouter.marketplace.download",
  // ── server/routers/aiActiveLearningRouter.ts (2) ──
  "server/routers/aiActiveLearningRouter.ts#aiActiveLearningRouter.skipItem",
  "server/routers/aiActiveLearningRouter.ts#aiActiveLearningRouter.submitLabel",
  // ── server/routers/aiAdvancedRouter.ts (5) ──
  "server/routers/aiAdvancedRouter.ts#abTestRouter.runInference",
  "server/routers/aiAdvancedRouter.ts#abTestRouter.submitFeedback",
  "server/routers/aiAdvancedRouter.ts#edgeRouter.heartbeat",
  "server/routers/aiAdvancedRouter.ts#edgeRouter.syncResults",
  "server/routers/aiAdvancedRouter.ts#edgeRouter.updateStatus",
  // ── server/routers/aiAdvancedVisionRouter.ts (1) ──
  "server/routers/aiAdvancedVisionRouter.ts#aiAdvancedVisionRouter.explainHeatmap",
  // ── server/routers/aiAgentRouter.ts (10) ──
  "server/routers/aiAgentRouter.ts#aiAgentRouter.approvePlan",
  "server/routers/aiAgentRouter.ts#aiAgentRouter.bac",
  "server/routers/aiAgentRouter.ts#aiAgentRouter.boDeXuat",
  "server/routers/aiAgentRouter.ts#aiAgentRouter.cancelSession",
  "server/routers/aiAgentRouter.ts#aiAgentRouter.confirmStep",
  "server/routers/aiAgentRouter.ts#aiAgentRouter.duyet",
  "server/routers/aiAgentRouter.ts#aiAgentRouter.hoanTac",
  "server/routers/aiAgentRouter.ts#aiAgentRouter.nhoDeXuat",
  "server/routers/aiAgentRouter.ts#aiAgentRouter.phanHoi",
  "server/routers/aiAgentRouter.ts#aiAgentRouter.startPlaybook",
  // ── server/routers/aiAnalysisHubRouter.ts (3) ──
  "server/routers/aiAnalysisHubRouter.ts#aiAnalysisHubRouter.imageDefectDescription",
  "server/routers/aiAnalysisHubRouter.ts#aiAnalysisHubRouter.quickQualityCheck",
  "server/routers/aiAnalysisHubRouter.ts#aiAnalysisHubRouter.similarDefectSearch",
  // ── server/routers/aiAnomalyRouter.ts (1) ──
  "server/routers/aiAnomalyRouter.ts#aiAnomalyRouter.score",
  // ── server/routers/aiChatRouter.ts (5) ──
  "server/routers/aiChatRouter.ts#aiChatRouter.chat",
  "server/routers/aiChatRouter.ts#aiChatRouter.deleteConversation",
  "server/routers/aiChatRouter.ts#aiChatRouter.deleteMessage",
  "server/routers/aiChatRouter.ts#aiChatRouter.saveStreamedMessage",
  "server/routers/aiChatRouter.ts#aiChatRouter.updateConversation",
  // ── server/routers/aiChayUngDungRouter.ts (3) ──
  "server/routers/aiChayUngDungRouter.ts#aiChayUngDungRouter.chay",
  "server/routers/aiChayUngDungRouter.ts#aiChayUngDungRouter.deXuatLenh",
  "server/routers/aiChayUngDungRouter.ts#aiChayUngDungRouter.dung",
  // ── server/routers/aiCopilotRouter.ts (2) ──
  "server/routers/aiCopilotRouter.ts#aiCopilotRouter.cancelAction",
  "server/routers/aiCopilotRouter.ts#aiCopilotRouter.confirmAction",
  // ── server/routers/aiEvalRouter.ts (2) ──
  "server/routers/aiEvalRouter.ts#aiEvalRouter.driftCheck",
  "server/routers/aiEvalRouter.ts#aiEvalRouter.evaluate",
  // ── server/routers/aiFeedbackRouter.ts (4) ──
  "server/routers/aiFeedbackRouter.ts#aiFeedbackRouter.createSuggestion",
  "server/routers/aiFeedbackRouter.ts#aiFeedbackRouter.createTrainingBatch",
  "server/routers/aiFeedbackRouter.ts#aiFeedbackRouter.exportTrainingBatch",
  "server/routers/aiFeedbackRouter.ts#aiFeedbackRouter.submitFeedback",
  // ── server/routers/aiGatewayTokenRouter.ts (1) ──
  "server/routers/aiGatewayTokenRouter.ts#aiGatewayTokenRouter.thuHoi",
  // ── server/routers/aiGgufRouter.ts (8) ──
  "server/routers/aiGgufRouter.ts#aiGgufRouter.analyzeDefect",
  "server/routers/aiGgufRouter.ts#aiGgufRouter.chat",
  "server/routers/aiGgufRouter.ts#aiGgufRouter.embedding",
  "server/routers/aiGgufRouter.ts#aiGgufRouter.generate",
  "server/routers/aiGgufRouter.ts#aiGgufRouter.qualityInsights",
  "server/routers/aiGgufRouter.ts#aiGgufRouter.soModelDatGan",
  "server/routers/aiGgufRouter.ts#aiGgufRouter.soModelSuaArtifact",
  "server/routers/aiGgufRouter.ts#aiGgufRouter.soModelTaoHoSo",
  // ── server/routers/aiImageSearchRouter.ts (2) ──
  "server/routers/aiImageSearchRouter.ts#aiImageSearchRouter.searchByUpload",
  "server/routers/aiImageSearchRouter.ts#aiImageSearchRouter.searchByVector",
  // ── server/routers/aiInsightRouter.ts (1) ──
  "server/routers/aiInsightRouter.ts#aiInsightRouter.setStatus",
  // ── server/routers/aiLocalTrainingRouter.ts (1) ──
  "server/routers/aiLocalTrainingRouter.ts#aiLocalTrainingRouter.predict",
  // ── server/routers/aiModelRouter.ts (4) ──
  "server/routers/aiModelRouter.ts#aiModelRouter.approveCard",
  "server/routers/aiModelRouter.ts#aiModelRouter.createCard",
  "server/routers/aiModelRouter.ts#aiModelRouter.runInference",
  "server/routers/aiModelRouter.ts#aiModelRouter.updateCard",
  // ── server/routers/aiQualityGateRouter.ts (2) ──
  "server/routers/aiQualityGateRouter.ts#aiQualityGateRouter.processInspection",
  "server/routers/aiQualityGateRouter.ts#aiQualityGateRouter.reviewDecision",
  // ── server/routers/aiRcaCopilotRouter.ts (1) ──
  "server/routers/aiRcaCopilotRouter.ts#aiRcaCopilotRouter.applyTopFix",
  // ── server/routers/aiRobotAnomalyRouter.ts (2) ──
  "server/routers/aiRobotAnomalyRouter.ts#aiRobotAnomalyRouter.evaluateRollback",
  "server/routers/aiRobotAnomalyRouter.ts#aiRobotAnomalyRouter.manualRollback",
  // ── server/routers/aiRouters.ts (4) ──
  "server/routers/aiRouters.ts#predictiveAlertRouter.acknowledge",
  "server/routers/aiRouters.ts#predictiveAlertRouter.dismiss",
  "server/routers/aiRouters.ts#predictiveAlertRouter.generatePredictions",
  "server/routers/aiRouters.ts#predictiveAlertRouter.resolve",
  // ── server/routers/aiSegmentationRouter.ts (3) ──
  "server/routers/aiSegmentationRouter.ts#aiSegmentationRouter.deleteMask",
  "server/routers/aiSegmentationRouter.ts#aiSegmentationRouter.runSegmentation",
  "server/routers/aiSegmentationRouter.ts#aiSegmentationRouter.saveMask",
  // ── server/routers/aiSettingsRouter.ts (1) ──
  "server/routers/aiSettingsRouter.ts#aiSettingsRouter.cancelAiJob",
  // ── server/routers/aiSmartAlertRoutingRouter.ts (1) ──
  "server/routers/aiSmartAlertRoutingRouter.ts#aiSmartAlertRoutingRouter.acknowledge",
  // ── server/routers/aiSpecialistAgentRouter.ts (2) ──
  "server/routers/aiSpecialistAgentRouter.ts#aiSpecialistAgentRouter.runModuleAudit",
  "server/routers/aiSpecialistAgentRouter.ts#aiSpecialistAgentRouter.submitFeedback",
  // ── server/routers/aiThresholdAdvisorRouter.ts (1) ──
  "server/routers/aiThresholdAdvisorRouter.ts#aiThresholdAdvisorRouter.applyNgThreshold",
  // ── server/routers/aiVisionLanguageRouter.ts (2) ──
  "server/routers/aiVisionLanguageRouter.ts#aiVisionLanguageRouter.describeDefect",
  "server/routers/aiVisionLanguageRouter.ts#aiVisionLanguageRouter.generateReport",
  // ── server/routers/aiVisionRouter.ts (1) ──
  "server/routers/aiVisionRouter.ts#aiVisionRouter.proposeDefect",
  // ── server/routers/alertEscalationRouter.ts (3) ──
  "server/routers/alertEscalationRouter.ts#alertEscalationRouter.delete",
  "server/routers/alertEscalationRouter.ts#alertEscalationRouter.toggle",
  "server/routers/alertEscalationRouter.ts#alertEscalationRouter.update",
  // ── server/routers/alertRouters.ts (7) ──
  "server/routers/alertRouters.ts#alertRouter.acknowledge",
  "server/routers/alertRouters.ts#alertRouter.create",
  "server/routers/alertRouters.ts#alertRouter.delete",
  "server/routers/alertRouters.ts#alertRouter.test",
  "server/routers/alertRouters.ts#alertRouter.update",
  "server/routers/alertRouters.ts#yieldThresholdRouter.update",
  "server/routers/alertRouters.ts#yieldThresholdRouter.updateWithHistory",
  // ── server/routers/annotationComparisonRouter.ts (2) ──
  "server/routers/annotationComparisonRouter.ts#annotationComparisonRouter.createSession",
  "server/routers/annotationComparisonRouter.ts#annotationComparisonRouter.detectPatterns",
  // ── server/routers/annotationRouters.ts (6) ──
  "server/routers/annotationRouters.ts#annotationHistoryRouter.rollback",
  "server/routers/annotationRouters.ts#annotationRouter.bulkApplyTemplate",
  "server/routers/annotationRouters.ts#annotationRouter.copyAnnotations",
  "server/routers/annotationRouters.ts#annotationRouter.delete",
  "server/routers/annotationRouters.ts#annotationRouter.export",
  "server/routers/annotationRouters.ts#annotationRouter.save",
  // ── server/routers/apiKeyRouter.ts (4) ──
  "server/routers/apiKeyRouter.ts#apiKeyRouter.create",
  "server/routers/apiKeyRouter.ts#apiKeyRouter.delete",
  "server/routers/apiKeyRouter.ts#apiKeyRouter.revoke",
  "server/routers/apiKeyRouter.ts#apiKeyRouter.update",
  // ── server/routers/bomRouter.ts (10) ──
  "server/routers/bomRouter.ts#bomRouter.addLineItem",
  "server/routers/bomRouter.ts#bomRouter.archiveDefinition",
  "server/routers/bomRouter.ts#bomRouter.assignFeederMaterial",
  "server/routers/bomRouter.ts#bomRouter.bulkAddLineItems",
  "server/routers/bomRouter.ts#bomRouter.createDefinition",
  "server/routers/bomRouter.ts#bomRouter.deleteLineItem",
  "server/routers/bomRouter.ts#bomRouter.loadFeeder",
  "server/routers/bomRouter.ts#bomRouter.updateDefinition",
  "server/routers/bomRouter.ts#bomRouter.updateFeeder",
  "server/routers/bomRouter.ts#bomRouter.updateLineItem",
  // ── server/routers/causalGraphRouter.ts (3) ──
  "server/routers/causalGraphRouter.ts#causalGraphRouter.deleteNode",
  "server/routers/causalGraphRouter.ts#causalGraphRouter.replaceGraph",
  "server/routers/causalGraphRouter.ts#causalGraphRouter.updateNode",
  // ── server/routers/componentLibraryRouter.ts (4) ──
  "server/routers/componentLibraryRouter.ts#componentLibraryRouter.footprints.create",
  "server/routers/componentLibraryRouter.ts#componentLibraryRouter.footprints.update",
  "server/routers/componentLibraryRouter.ts#componentLibraryRouter.linkMaterial",
  "server/routers/componentLibraryRouter.ts#componentLibraryRouter.packages.update",
  // ── server/routers/dashboardStatsRouters.ts (1) ──
  "server/routers/dashboardStatsRouters.ts#dashboardRouter.applyTemplate",
  // ── server/routers/dashboardWidgetRouters.ts (13) ──
  "server/routers/dashboardWidgetRouters.ts#dashboardWidgetRouter.applySharedTemplate",
  "server/routers/dashboardWidgetRouters.ts#dashboardWidgetRouter.applyStylePreset",
  "server/routers/dashboardWidgetRouters.ts#dashboardWidgetRouter.cloneSharedPreset",
  "server/routers/dashboardWidgetRouters.ts#dashboardWidgetRouter.createCustomDashboard",
  "server/routers/dashboardWidgetRouters.ts#dashboardWidgetRouter.deleteCustomDashboard",
  "server/routers/dashboardWidgetRouters.ts#dashboardWidgetRouter.deleteStylePreset",
  "server/routers/dashboardWidgetRouters.ts#dashboardWidgetRouter.duplicateCustomDashboard",
  "server/routers/dashboardWidgetRouters.ts#dashboardWidgetRouter.saveCustomDashboardAsTemplate",
  "server/routers/dashboardWidgetRouters.ts#dashboardWidgetRouter.saveLayout",
  "server/routers/dashboardWidgetRouters.ts#dashboardWidgetRouter.toggleCustomDashboardFavorite",
  "server/routers/dashboardWidgetRouters.ts#dashboardWidgetRouter.toggleCustomDashboardPublic",
  "server/routers/dashboardWidgetRouters.ts#dashboardWidgetRouter.updateCustomDashboard",
  "server/routers/dashboardWidgetRouters.ts#dashboardWidgetRouter.updateStylePreset",
  // ── server/routers/dataRouters.ts (6) ──
  "server/routers/dataRouters.ts#exportRouter.exportMeasurementPoints",
  "server/routers/dataRouters.ts#importRouter.importLines",
  "server/routers/dataRouters.ts#importRouter.importMachines",
  "server/routers/dataRouters.ts#importRouter.importStations",
  "server/routers/dataRouters.ts#importRouter.importWorkshops",
  "server/routers/dataRouters.ts#importRouter.importWorkstations",
  // ── server/routers/defectDispositionRouter.ts (3) ──
  "server/routers/defectDispositionRouter.ts#defectDispositionRouter.create",
  "server/routers/defectDispositionRouter.ts#defectDispositionRouter.transition",
  "server/routers/defectDispositionRouter.ts#defectDispositionRouter.updateStatus",
  // ── server/routers/defectHeatmapRouter.ts (1) ──
  "server/routers/defectHeatmapRouter.ts#defectHeatmapRouter.generate",
  // ── server/routers/ecnRouter.ts (2) ──
  "server/routers/ecnRouter.ts#ecnRouter.create",
  "server/routers/ecnRouter.ts#ecnRouter.transition",
  // ── server/routers/edgeRuntimeRouter.ts (1) ──
  "server/routers/edgeRuntimeRouter.ts#edgeRuntimeRouter.deleteNode",
  // ── server/routers/energyRouter.ts (2) ──
  "server/routers/energyRouter.ts#energyRouter.recordReading",
  "server/routers/energyRouter.ts#energyRouter.snapshotEnpi",
  // ── server/routers/equipmentStandardsRouter.ts (8) ──
  "server/routers/equipmentStandardsRouter.ts#equipmentStandardsRouter.deleteMasterAlarm",
  "server/routers/equipmentStandardsRouter.ts#equipmentStandardsRouter.publishChangeRequest",
  "server/routers/equipmentStandardsRouter.ts#equipmentStandardsRouter.registerDeviceType",
  "server/routers/equipmentStandardsRouter.ts#equipmentStandardsRouter.reviewChangeRequest",
  "server/routers/equipmentStandardsRouter.ts#equipmentStandardsRouter.shelveMasterAlarm",
  "server/routers/equipmentStandardsRouter.ts#equipmentStandardsRouter.submitChangeRequest",
  "server/routers/equipmentStandardsRouter.ts#equipmentStandardsRouter.upsertAlarmMapping",
  "server/routers/equipmentStandardsRouter.ts#equipmentStandardsRouter.upsertMasterAlarm",
  // ── server/routers/erpAdminRouter.ts (5) ──
  "server/routers/erpAdminRouter.ts#erpAdminRouter.createOauthClient",
  "server/routers/erpAdminRouter.ts#erpAdminRouter.retryOutboxDeadLetters",
  "server/routers/erpAdminRouter.ts#erpAdminRouter.rotateOauthClientSecret",
  "server/routers/erpAdminRouter.ts#erpAdminRouter.setOauthClientEnabled",
  "server/routers/erpAdminRouter.ts#erpAdminRouter.updateOauthClient",
  // ── server/routers/feederVerifyRouter.ts (1) ──
  "server/routers/feederVerifyRouter.ts#feederVerifyRouter.verifyScan",
  // ── server/routers/fieldRouter.ts (2) ──
  "server/routers/fieldRouter.ts#fieldRouter.discover",
  "server/routers/fieldRouter.ts#fieldRouter.registerDiscovered",
  // ── server/routers/fleetRouter.ts (1) ──
  "server/routers/fleetRouter.ts#fleetRouter.createVariant",
  // ── server/routers/goldenSampleRouter.ts (8) ──
  "server/routers/goldenSampleRouter.ts#goldenSampleRouter.approve",
  "server/routers/goldenSampleRouter.ts#goldenSampleRouter.captureFromInspection",
  "server/routers/goldenSampleRouter.ts#goldenSampleRouter.captureFromUpload",
  "server/routers/goldenSampleRouter.ts#goldenSampleRouter.diffForMeasurement",
  "server/routers/goldenSampleRouter.ts#goldenSampleRouter.diffWithUpload",
  "server/routers/goldenSampleRouter.ts#goldenSampleRouter.reject",
  "server/routers/goldenSampleRouter.ts#goldenSampleRouter.retire",
  "server/routers/goldenSampleRouter.ts#goldenSampleRouter.setAlignBeforeDiff",
  // ── server/routers/hierarchyRouters.ts (3) ──
  "server/routers/hierarchyRouters.ts#machineRouter.claimKey",
  "server/routers/hierarchyRouters.ts#machineRouter.enroll",
  "server/routers/hierarchyRouters.ts#machineRouter.register",
  // ── server/routers/hotFolderRouter.ts (4) ──
  "server/routers/hotFolderRouter.ts#hotFolderRouter.deleteConfig",
  "server/routers/hotFolderRouter.ts#hotFolderRouter.dryRun",
  "server/routers/hotFolderRouter.ts#hotFolderRouter.processNow",
  "server/routers/hotFolderRouter.ts#hotFolderRouter.updateConfig",
  // ── server/routers/inspectionProgramRouter.ts (5) ──
  "server/routers/inspectionProgramRouter.ts#inspectionProgramRouter.approve",
  "server/routers/inspectionProgramRouter.ts#inspectionProgramRouter.createDraft",
  "server/routers/inspectionProgramRouter.ts#inspectionProgramRouter.reject",
  "server/routers/inspectionProgramRouter.ts#inspectionProgramRouter.release",
  "server/routers/inspectionProgramRouter.ts#inspectionProgramRouter.submit",
  // ── server/routers/inspectionRouters.ts (10) ──
  "server/routers/inspectionRouters.ts#inspectionRouter.bulkAcknowledge",
  "server/routers/inspectionRouters.ts#inspectionRouter.confirmNTF",
  "server/routers/inspectionRouters.ts#measurementResultRouter.analyzeWithAI",
  "server/routers/inspectionRouters.ts#measurementResultRouter.batchAcknowledge",
  "server/routers/inspectionRouters.ts#measurementResultRouter.batchAddNote",
  "server/routers/inspectionRouters.ts#measurementResultRouter.batchAddTag",
  "server/routers/inspectionRouters.ts#measurementResultRouter.batchArchive",
  "server/routers/inspectionRouters.ts#measurementResultRouter.classifyDefect",
  "server/routers/inspectionRouters.ts#measurementResultRouter.correctResult",
  "server/routers/inspectionRouters.ts#measurementResultRouter.updateRemark",
  // ── server/routers/inspectionVariantRouter.ts (1) ──
  "server/routers/inspectionVariantRouter.ts#inspectionVariantRouter.setVariant",
  // ── server/routers/interlockRouter.ts (4) ──
  "server/routers/interlockRouter.ts#interlockRouter.delete",
  "server/routers/interlockRouter.ts#interlockRouter.disable",
  "server/routers/interlockRouter.ts#interlockRouter.enable",
  "server/routers/interlockRouter.ts#interlockRouter.resolveEvent",
  // ── server/routers/irRouter.ts (2) ──
  "server/routers/irRouter.ts#irRouter.requestBuild",
  "server/routers/irRouter.ts#irRouter.saveFlow",
  // ── server/routers/kbStudioRouter.ts (2) ──
  "server/routers/kbStudioRouter.ts#kbStudioRouter.huyEvalMa",
  "server/routers/kbStudioRouter.ts#kbStudioRouter.startFinetune",
  // ── server/routers/layoutRouters.ts (6) ──
  "server/routers/layoutRouters.ts#layoutRouter.addMachinePosition",
  "server/routers/layoutRouters.ts#layoutRouter.create",
  "server/routers/layoutRouters.ts#layoutRouter.delete",
  "server/routers/layoutRouters.ts#layoutRouter.removeMachinePosition",
  "server/routers/layoutRouters.ts#layoutRouter.update",
  "server/routers/layoutRouters.ts#layoutRouter.updateMachinePosition",
  // ── server/routers/licenseRouter.ts (2) ──
  "server/routers/licenseRouter.ts#publicLicenseRouter.floatingCheckin",
  "server/routers/licenseRouter.ts#publicLicenseRouter.floatingHeartbeat",
  // ── server/routers/lineControllerRouter.ts (7) ──
  "server/routers/lineControllerRouter.ts#lineControllerRouter.command",
  "server/routers/lineControllerRouter.ts#lineControllerRouter.recipeSet.addItem",
  "server/routers/lineControllerRouter.ts#lineControllerRouter.recipeSet.create",
  "server/routers/lineControllerRouter.ts#lineControllerRouter.recipeSet.distribute",
  "server/routers/lineControllerRouter.ts#lineControllerRouter.recipeSet.removeItem",
  "server/routers/lineControllerRouter.ts#lineControllerRouter.recipeSet.unlock",
  "server/routers/lineControllerRouter.ts#lineControllerRouter.transition",
  // ── server/routers/machineApiRouters.ts (1) ──
  "server/routers/machineApiRouters.ts#machineApiRouter.revokeKey",
  // ── server/routers/maintenanceRouter.ts (4) ──
  "server/routers/maintenanceRouter.ts#maintenanceRouter.closeWorkOrder",
  "server/routers/maintenanceRouter.ts#maintenanceRouter.deleteWorkOrder",
  "server/routers/maintenanceRouter.ts#maintenanceRouter.recordPartsUsed",
  "server/routers/maintenanceRouter.ts#maintenanceRouter.updateWorkOrder",
  // ── server/routers/maintenanceScheduleRouter.ts (4) ──
  "server/routers/maintenanceScheduleRouter.ts#maintenanceScheduleRouter.create",
  "server/routers/maintenanceScheduleRouter.ts#maintenanceScheduleRouter.remove",
  "server/routers/maintenanceScheduleRouter.ts#maintenanceScheduleRouter.setEnabled",
  "server/routers/maintenanceScheduleRouter.ts#maintenanceScheduleRouter.update",
  // ── server/routers/masterDataRouter.ts (26) ──
  "server/routers/masterDataRouter.ts#calendarRouter.assignShift",
  "server/routers/masterDataRouter.ts#calendarRouter.create",
  "server/routers/masterDataRouter.ts#calendarRouter.createDay",
  "server/routers/masterDataRouter.ts#calendarRouter.update",
  "server/routers/masterDataRouter.ts#calendarRouter.updateDay",
  "server/routers/masterDataRouter.ts#customersRouter.create",
  "server/routers/masterDataRouter.ts#customersRouter.update",
  "server/routers/masterDataRouter.ts#inventoryRouter.createLocation",
  "server/routers/masterDataRouter.ts#inventoryRouter.createWarehouse",
  "server/routers/masterDataRouter.ts#inventoryRouter.updateBalance",
  "server/routers/masterDataRouter.ts#inventoryRouter.updateLocation",
  "server/routers/masterDataRouter.ts#inventoryRouter.updateWarehouse",
  "server/routers/masterDataRouter.ts#inventoryRouter.upsertBalance",
  "server/routers/masterDataRouter.ts#materialsRouter.create",
  "server/routers/masterDataRouter.ts#materialsRouter.update",
  "server/routers/masterDataRouter.ts#materialsRouter.updateClass",
  "server/routers/masterDataRouter.ts#skillsRouter.grantCertification",
  "server/routers/masterDataRouter.ts#skillsRouter.update",
  "server/routers/masterDataRouter.ts#skillsRouter.updateCertification",
  "server/routers/masterDataRouter.ts#suppliersRouter.create",
  "server/routers/masterDataRouter.ts#suppliersRouter.update",
  "server/routers/masterDataRouter.ts#toolsRouter.create",
  "server/routers/masterDataRouter.ts#toolsRouter.update",
  "server/routers/masterDataRouter.ts#uomRouter.update",
  "server/routers/masterDataRouter.ts#uomRouter.updateConversion",
  "server/routers/masterDataRouter.ts#userCertificationsRouter.assign",
  // ── server/routers/mesControlTowerRouter.ts (3) ──
  "server/routers/mesControlTowerRouter.ts#mesControlTowerRouter.createLotDisposition",
  "server/routers/mesControlTowerRouter.ts#mesControlTowerRouter.createMaterialReceipt",
  "server/routers/mesControlTowerRouter.ts#mesControlTowerRouter.createSupplierLot",
  // ── server/routers/mpVariantSubformRouter.ts (1) ──
  "server/routers/mpVariantSubformRouter.ts#mpVariantSubformRouter.setExtra",
  // ── server/routers/mqttBulletinRouter.ts (7) ──
  "server/routers/mqttBulletinRouter.ts#mqttBulletinRouter.bulkToggle",
  "server/routers/mqttBulletinRouter.ts#mqttBulletinRouter.deleteSetting",
  "server/routers/mqttBulletinRouter.ts#mqttBulletinRouter.quickSetup",
  "server/routers/mqttBulletinRouter.ts#mqttBulletinRouter.sendTestBulletin",
  "server/routers/mqttBulletinRouter.ts#mqttBulletinRouter.toggleEnabled",
  "server/routers/mqttBulletinRouter.ts#mqttBulletinRouter.triggerNow",
  "server/routers/mqttBulletinRouter.ts#mqttBulletinRouter.upsertSetting",
  // ── server/routers/mqttClientManagementRouter.ts (7) ──
  "server/routers/mqttClientManagementRouter.ts#mqttClientManagementRouter.acknowledgeAlert",
  "server/routers/mqttClientManagementRouter.ts#mqttClientManagementRouter.createAlert",
  "server/routers/mqttClientManagementRouter.ts#mqttClientManagementRouter.logConnectionEvent",
  "server/routers/mqttClientManagementRouter.ts#mqttClientManagementRouter.logReconnectEvent",
  "server/routers/mqttClientManagementRouter.ts#mqttClientManagementRouter.resolveAlert",
  "server/routers/mqttClientManagementRouter.ts#mqttClientManagementRouter.updateAlertConfig",
  "server/routers/mqttClientManagementRouter.ts#mqttClientManagementRouter.updateConnectionStatus",
  // ── server/routers/mqttNgAlertSettingsRouter.ts (4) ──
  "server/routers/mqttNgAlertSettingsRouter.ts#mqttNgAlertSettingsRouter.bulkToggle",
  "server/routers/mqttNgAlertSettingsRouter.ts#mqttNgAlertSettingsRouter.deleteSetting",
  "server/routers/mqttNgAlertSettingsRouter.ts#mqttNgAlertSettingsRouter.toggleEnabled",
  "server/routers/mqttNgAlertSettingsRouter.ts#mqttNgAlertSettingsRouter.upsertSetting",
  // ── server/routers/mqttOeeRouters.ts (14) ──
  "server/routers/mqttOeeRouters.ts#mqttAlertRouter.delete",
  "server/routers/mqttOeeRouters.ts#mqttAlertRouter.resolve",
  "server/routers/mqttOeeRouters.ts#mqttAlertRouter.toggle",
  "server/routers/mqttOeeRouters.ts#mqttAlertRouter.update",
  "server/routers/mqttOeeRouters.ts#mqttClientRouter.calculateBenchmarks",
  "server/routers/mqttOeeRouters.ts#mqttClientRouter.calculateMachineHealth",
  "server/routers/mqttOeeRouters.ts#mqttClientRouter.calculateOEE",
  "server/routers/mqttOeeRouters.ts#mqttClientRouter.endDowntime",
  "server/routers/mqttOeeRouters.ts#mqttClientRouter.startDowntime",
  "server/routers/mqttOeeRouters.ts#mqttClientRouter.testNGAlert",
  "server/routers/mqttOeeRouters.ts#mqttClientRouter.updateFcmToken",
  "server/routers/mqttOeeRouters.ts#oeeRouter.createTarget",
  "server/routers/mqttOeeRouters.ts#oeeRouter.deleteTarget",
  "server/routers/mqttOeeRouters.ts#oeeRouter.updateTarget",
  // ── server/routers/msdRouter.ts (3) ──
  "server/routers/msdRouter.ts#msdRouter.closeExposure",
  "server/routers/msdRouter.ts#msdRouter.openExposure",
  "server/routers/msdRouter.ts#msdRouter.startBake",
  // ── server/routers/ncrRouter.ts (2) ──
  "server/routers/ncrRouter.ts#ncrRouter.create",
  "server/routers/ncrRouter.ts#ncrRouter.transition",
  // ── server/routers/ngRateThresholdRouter.ts (5) ──
  "server/routers/ngRateThresholdRouter.ts#ngRateThresholdRouter.create",
  "server/routers/ngRateThresholdRouter.ts#ngRateThresholdRouter.delete",
  "server/routers/ngRateThresholdRouter.ts#ngRateThresholdRouter.resolveAlert",
  "server/routers/ngRateThresholdRouter.ts#ngRateThresholdRouter.toggle",
  "server/routers/ngRateThresholdRouter.ts#ngRateThresholdRouter.update",
  // ── server/routers/notificationRouters.ts (2) ──
  "server/routers/notificationRouters.ts#notificationRouter.delete",
  "server/routers/notificationRouters.ts#notificationRouter.markAsRead",
  // ── server/routers/operatorBadgeRouter.ts (2) ──
  "server/routers/operatorBadgeRouter.ts#operatorBadgeRouter.revoke",
  "server/routers/operatorBadgeRouter.ts#operatorBadgeRouter.update",
  // ── server/routers/orderLifecycleRouter.ts (4) ──
  "server/routers/orderLifecycleRouter.ts#orderLifecycleRouter.allocate",
  "server/routers/orderLifecycleRouter.ts#orderLifecycleRouter.cancel",
  "server/routers/orderLifecycleRouter.ts#orderLifecycleRouter.hold",
  "server/routers/orderLifecycleRouter.ts#orderLifecycleRouter.resume",
  // ── server/routers/parameterGuardrailRouter.ts (2) ──
  "server/routers/parameterGuardrailRouter.ts#parameterGuardrailRouter.delete",
  "server/routers/parameterGuardrailRouter.ts#parameterGuardrailRouter.set",
  // ── server/routers/pdfReportRouter.ts (1) ──
  "server/routers/pdfReportRouter.ts#pdfReportRouter.generateInspectionPDF",
  // ── server/routers/processRouter.ts (7) ──
  "server/routers/processRouter.ts#processRouter.createLineAssignment",
  "server/routers/processRouter.ts#processRouter.delete",
  "server/routers/processRouter.ts#processRouter.deleteLineAssignment",
  "server/routers/processRouter.ts#processRouter.reorder",
  "server/routers/processRouter.ts#processRouter.reorderLineAssignments",
  "server/routers/processRouter.ts#processRouter.update",
  "server/routers/processRouter.ts#processRouter.updateLineAssignment",
  // ── server/routers/productionRouters.ts (17) ──
  "server/routers/productionRouters.ts#lineProductAssignmentRouter.create",
  "server/routers/productionRouters.ts#lineProductAssignmentRouter.delete",
  "server/routers/productionRouters.ts#lineProductAssignmentRouter.update",
  "server/routers/productionRouters.ts#lineStageRouter.create",
  "server/routers/productionRouters.ts#lineStageRouter.delete",
  "server/routers/productionRouters.ts#lineStageRouter.reorder",
  "server/routers/productionRouters.ts#lineStageRouter.update",
  "server/routers/productionRouters.ts#productionOrderRouter.create",
  "server/routers/productionRouters.ts#productionOrderRouter.createFromTemplate",
  "server/routers/productionRouters.ts#productionOrderRouter.createTemplate",
  "server/routers/productionRouters.ts#productionOrderRouter.delete",
  "server/routers/productionRouters.ts#productionOrderRouter.deleteTemplate",
  "server/routers/productionRouters.ts#productionOrderRouter.optimizeSchedule",
  "server/routers/productionRouters.ts#productionOrderRouter.reschedule",
  "server/routers/productionRouters.ts#productionOrderRouter.update",
  "server/routers/productionRouters.ts#productionOrderRouter.updateTemplate",
  "server/routers/productionRouters.ts#productionOrderRouter.whatIf",
  // ── server/routers/productionSessionRouter.ts (6) ──
  "server/routers/productionSessionRouter.ts#productionSessionRouter.close",
  "server/routers/productionSessionRouter.ts#productionSessionRouter.handover",
  "server/routers/productionSessionRouter.ts#productionSessionRouter.open",
  "server/routers/productionSessionRouter.ts#productionSessionRouter.pause",
  "server/routers/productionSessionRouter.ts#productionSessionRouter.resume",
  "server/routers/productionSessionRouter.ts#productionSessionRouter.supervisorSignOff",
  // ── server/routers/productOnboardingRouter.ts (3) ──
  "server/routers/productOnboardingRouter.ts#productOnboardingRouter.complete",
  "server/routers/productOnboardingRouter.ts#productOnboardingRouter.deleteDraft",
  "server/routers/productOnboardingRouter.ts#productOnboardingRouter.saveDraft",
  // ── server/routers/productPanelRouter.ts (4) ──
  "server/routers/productPanelRouter.ts#productPanelRouter.create",
  "server/routers/productPanelRouter.ts#productPanelRouter.remove",
  "server/routers/productPanelRouter.ts#productPanelRouter.saveBoards",
  "server/routers/productPanelRouter.ts#productPanelRouter.update",
  // ── server/routers/productRouters.ts (1) ──
  "server/routers/productRouters.ts#msaAdvancedRouter.anovaOfStudy",
  // ── server/routers/productVariantRouter.ts (3) ──
  "server/routers/productVariantRouter.ts#productVariantRouter.createVariant",
  "server/routers/productVariantRouter.ts#productVariantRouter.deleteVariant",
  "server/routers/productVariantRouter.ts#productVariantRouter.updateVariant",
  // ── server/routers/programmingRouter.ts (16) ──
  "server/routers/programmingRouter.ts#programmingRouter.approveDeployment",
  "server/routers/programmingRouter.ts#programmingRouter.buildArtifact",
  "server/routers/programmingRouter.ts#programmingRouter.createArtifact",
  "server/routers/programmingRouter.ts#programmingRouter.createProject",
  "server/routers/programmingRouter.ts#programmingRouter.deleteProject",
  "server/routers/programmingRouter.ts#programmingRouter.deleteSymbol",
  "server/routers/programmingRouter.ts#programmingRouter.rejectDeployment",
  "server/routers/programmingRouter.ts#programmingRouter.requestVersionReview",
  "server/routers/programmingRouter.ts#programmingRouter.reviewArtifact",
  "server/routers/programmingRouter.ts#programmingRouter.rollbackDeployment",
  "server/routers/programmingRouter.ts#programmingRouter.simulateBuild",
  "server/routers/programmingRouter.ts#programmingRouter.startWatch",
  "server/routers/programmingRouter.ts#programmingRouter.stopWatch",
  "server/routers/programmingRouter.ts#programmingRouter.updateProject",
  "server/routers/programmingRouter.ts#programmingRouter.upsertSymbol",
  "server/routers/programmingRouter.ts#programmingRouter.validateArtifact",
  // ── server/routers/qualityGateTemplateRouter.ts (3) ──
  "server/routers/qualityGateTemplateRouter.ts#qualityGateTemplateRouter.applyToLine",
  "server/routers/qualityGateTemplateRouter.ts#qualityGateTemplateRouter.deleteCustom",
  "server/routers/qualityGateTemplateRouter.ts#qualityGateTemplateRouter.updateCustom",
  // ── server/routers/reportArtifactRouter.ts (1) ──
  "server/routers/reportArtifactRouter.ts#reportArtifactRouter.delete",
  // ── server/routers/reportBuilderRouter.ts (2) ──
  "server/routers/reportBuilderRouter.ts#reportBuilderRouter.duplicate",
  "server/routers/reportBuilderRouter.ts#reportBuilderRouter.update",
  // ── server/routers/repoWorkspaceRouter.ts (17) ──
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.baiHocSua",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.baiHocThem",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.baiHocXoa",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.chayKiemChung",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.deXuatDoiTenTep",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.deXuatSuaTay",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.deXuatThayTheLo",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.deXuatXoaTep",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.doiTenDuAnCaNhan",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.doiTenPhien",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.gitChuyenNhanh",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.gitCommit",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.gitGoiYThongDiep",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.gitTaoNhanh",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.luuPhien",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.xoaDuAnCaNhan",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.xoaPhien",
  // ── server/routers/robotRouter.ts (1) ──
  "server/routers/robotRouter.ts#robotRouter.consoleStop",
  // ── server/routers/routingRouter.ts (10) ──
  "server/routers/routingRouter.ts#routingRouter.activate",
  "server/routers/routingRouter.ts#routingRouter.addStep",
  "server/routers/routingRouter.ts#routingRouter.archive",
  "server/routers/routingRouter.ts#routingRouter.create",
  "server/routers/routingRouter.ts#routingRouter.delete",
  "server/routers/routingRouter.ts#routingRouter.deleteStep",
  "server/routers/routingRouter.ts#routingRouter.importRouting",
  "server/routers/routingRouter.ts#routingRouter.replaceSteps",
  "server/routers/routingRouter.ts#routingRouter.update",
  "server/routers/routingRouter.ts#routingRouter.updateStep",
  // ── server/routers/safetyRouter.ts (6) ──
  "server/routers/safetyRouter.ts#safetyRouter.abortCollaboration",
  "server/routers/safetyRouter.ts#safetyRouter.advancePhase",
  "server/routers/safetyRouter.ts#safetyRouter.auditEvent",
  "server/routers/safetyRouter.ts#safetyRouter.recordEvent",
  "server/routers/safetyRouter.ts#safetyRouter.signalHandshake",
  "server/routers/safetyRouter.ts#safetyRouter.upsertCameraCalibration",
  // ── server/routers/secsGemRouter.ts (1) ──
  "server/routers/secsGemRouter.ts#secsGemRouter.testConnection",
  // ── server/routers/sessionRouter.ts (1) ──
  "server/routers/sessionRouter.ts#sessionRouter.revoke",
  // ── server/routers/shiftConfigRouter.ts (3) ──
  "server/routers/shiftConfigRouter.ts#shiftConfigRouter.create",
  "server/routers/shiftConfigRouter.ts#shiftConfigRouter.delete",
  "server/routers/shiftConfigRouter.ts#shiftConfigRouter.update",
  // ── server/routers/simTargetsRouter.ts (1) ──
  "server/routers/simTargetsRouter.ts#simTargetsRouter.validateUrscript",
  // ── server/routers/sopRouter.ts (10) ──
  "server/routers/sopRouter.ts#sopRouter.abandonExecution",
  "server/routers/sopRouter.ts#sopRouter.cloneNewVersion",
  "server/routers/sopRouter.ts#sopRouter.confirmStep",
  "server/routers/sopRouter.ts#sopRouter.create",
  "server/routers/sopRouter.ts#sopRouter.delete",
  "server/routers/sopRouter.ts#sopRouter.finishExecution",
  "server/routers/sopRouter.ts#sopRouter.replaceSteps",
  "server/routers/sopRouter.ts#sopRouter.setStatus",
  "server/routers/sopRouter.ts#sopRouter.startExecution",
  "server/routers/sopRouter.ts#sopRouter.update",
  // ── server/routers/spcAdvancedRouter.ts (14) ──
  "server/routers/spcAdvancedRouter.ts#correlationRouter.save",
  "server/routers/spcAdvancedRouter.ts#cpkTrendRouter.calculate",
  "server/routers/spcAdvancedRouter.ts#qualityGateRouter.acknowledgeEvent",
  "server/routers/spcAdvancedRouter.ts#qualityGateRouter.create",
  "server/routers/spcAdvancedRouter.ts#qualityGateRouter.delete",
  "server/routers/spcAdvancedRouter.ts#qualityGateRouter.resolveEvent",
  "server/routers/spcAdvancedRouter.ts#qualityGateRouter.triggerEvent",
  "server/routers/spcAdvancedRouter.ts#qualityGateRouter.update",
  "server/routers/spcAdvancedRouter.ts#spcConfigRouter.create",
  "server/routers/spcAdvancedRouter.ts#spcConfigRouter.delete",
  "server/routers/spcAdvancedRouter.ts#spcConfigRouter.update",
  "server/routers/spcAdvancedRouter.ts#spcRuleViolationRouter.acknowledge",
  "server/routers/spcAdvancedRouter.ts#spcRuleViolationRouter.resolve",
  "server/routers/spcAdvancedRouter.ts#spcRuleViolationRouter.saveViolations",
  // ── server/routers/stationTriangulationRouter.ts (2) ──
  "server/routers/stationTriangulationRouter.ts#stationTriangulationRouter.recomputeForLot",
  "server/routers/stationTriangulationRouter.ts#stationTriangulationRouter.recomputeForSerial",
  // ── server/routers/stencilRouter.ts (1) ──
  "server/routers/stencilRouter.ts#stencilRouter.recordPrints",
  // ── server/routers/systemRouters.ts (5) ──
  "server/routers/systemRouters.ts#workstationRouter.assignMachine",
  "server/routers/systemRouters.ts#workstationRouter.create",
  "server/routers/systemRouters.ts#workstationRouter.restore",
  "server/routers/systemRouters.ts#workstationRouter.unassignMachine",
  "server/routers/systemRouters.ts#workstationRouter.update",
  // ── server/routers/thresholdApprovalRouter.ts (6) ──
  "server/routers/thresholdApprovalRouter.ts#thresholdApprovalRouter.approve",
  "server/routers/thresholdApprovalRouter.ts#thresholdApprovalRouter.batchApprove",
  "server/routers/thresholdApprovalRouter.ts#thresholdApprovalRouter.reject",
  "server/routers/thresholdApprovalRouter.ts#thresholdApprovalRouter.request",
  "server/routers/thresholdApprovalRouter.ts#thresholdApprovalRouter.revert",
  "server/routers/thresholdApprovalRouter.ts#thresholdApprovalRouter.withdraw",
  // ── server/routers/trainingBatchCommentsRouter.ts (7) ──
  "server/routers/trainingBatchCommentsRouter.ts#trainingBatchCommentsRouter.addComment",
  "server/routers/trainingBatchCommentsRouter.ts#trainingBatchCommentsRouter.assignTag",
  "server/routers/trainingBatchCommentsRouter.ts#trainingBatchCommentsRouter.deleteComment",
  "server/routers/trainingBatchCommentsRouter.ts#trainingBatchCommentsRouter.deleteTag",
  "server/routers/trainingBatchCommentsRouter.ts#trainingBatchCommentsRouter.removeTag",
  "server/routers/trainingBatchCommentsRouter.ts#trainingBatchCommentsRouter.updateComment",
  "server/routers/trainingBatchCommentsRouter.ts#trainingBatchCommentsRouter.updateTag",
  // ── server/routers/twinGovRouter.ts (1) ──
  "server/routers/twinGovRouter.ts#twinGovRouter.runFidelityCheck",
  // ── server/routers/twinRouter.ts (3) ──
  "server/routers/twinRouter.ts#twinRouter.models.archive",
  "server/routers/twinRouter.ts#twinRouter.models.register",
  "server/routers/twinRouter.ts#twinRouter.models.uploadAndRegister",
  // ── server/routers/userRouters.ts (2) ──
  "server/routers/userRouters.ts#userRouter.revokeSession",
  "server/routers/userRouters.ts#userSettingsRouter.setUiPrefs",
  // ── server/routers/vda5050Router.ts (2) ──
  "server/routers/vda5050Router.ts#vda5050Router.sendOrder",
  "server/routers/vda5050Router.ts#vda5050Router.testConnection",
  // ── server/routers/visionAdapterRouter.ts (2) ──
  "server/routers/visionAdapterRouter.ts#visionAdapterRouter.ingest",
  "server/routers/visionAdapterRouter.ts#visionAdapterRouter.stopAcquisitionWorker",
  // ── server/routers/webhookRouter.ts (5) ──
  "server/routers/webhookRouter.ts#webhookRouter.clearLogs",
  "server/routers/webhookRouter.ts#webhookRouter.delete",
  "server/routers/webhookRouter.ts#webhookRouter.test",
  "server/routers/webhookRouter.ts#webhookRouter.toggle",
  "server/routers/webhookRouter.ts#webhookRouter.update",
];

/**
 * MIỄN TRỪ CÓ LÝ DO — mutation khớp hình dạng "nhận khoá định danh" (theo TÊN trường) nhưng KHÔNG ghi thực thể nào của tenant.
 * Khác sổ nợ: mục ở đây KHÔNG phải nợ cần trả; census đòi (a) mục vẫn đúng hình dạng nợ (không thì gỡ), (b) lý do không rỗng,
 * (c) không đồng thời nằm trong sổ nợ. Thêm mục = lời khai công khai, người review phải thấy.
 */
export const MIEN_TRU_GHI: Readonly<Record<string, string>> = {
  "server/routers/productRouters.ts#productModelRouter.create":
    "Luật ghi theo SẢN PHẨM (chủ dự án duyệt 2026-10-24): sản phẩm MỚI chưa gắn nhà máy nào là bản nháp, ai có settings_products/canCreate đều được tạo; khoá `categoryId` chỉ là nhóm sản phẩm dùng chung. Sửa/xoá/nhân bản đã bị chặn theo phạm vi (phamViGhiDoW6).",
  "server/routers/productRouters.ts#defectCatalogRouter.update":
    "Danh mục lỗi DÙNG CHUNG toàn tập đoàn — chủ dự án duyệt 2026-10-24 (không có cột nhà máy); sàn qualityProcedure (vai chất lượng/quản trị) giới hạn người ghi.",
  "server/routers/productRouters.ts#defectCatalogRouter.delete":
    "Danh mục lỗi DÙNG CHUNG toàn tập đoàn — chủ dự án duyệt 2026-10-24 (không có cột nhà máy); sàn qualityProcedure (vai chất lượng/quản trị) giới hạn người ghi.",
  "server/routers/annotationRouters.ts#annotationTemplateRouter.delete":
    "Mẫu chú thích DÙNG CHUNG, không dữ liệu theo nhà máy; chỉ người tạo hoặc admin được xoá (luong-ui xác nhận, dieu-phoi chuyển 2026-10-24).",
  "server/routers/aoiOnboardingRouter.ts#aoiOnboardingRouter.dryRun":
    "Hàm THUẦN: chuẩn hoá một mẫu xuất của máy qua adapter rồi trả bản tóm tắt, KHÔNG đọc/ghi CSDL và không giữ trạng thái; `machineCode` chỉ là nhãn truyền vào bộ chuẩn hoá (không tra máy nào). Bộ quét khớp vì tên trường kết thúc bằng Code.",
};
