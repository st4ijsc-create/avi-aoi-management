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
  // ── server/routers/aiActiveLearningRouter.ts (6) ───────────────────────────────────────────
  "server/routers/aiActiveLearningRouter.ts#aiActiveLearningRouter.checkRetrain",
  "server/routers/aiActiveLearningRouter.ts#aiActiveLearningRouter.diversitySampling",
  "server/routers/aiActiveLearningRouter.ts#aiActiveLearningRouter.getQueue",
  "server/routers/aiActiveLearningRouter.ts#aiActiveLearningRouter.labelAccuracy",
  "server/routers/aiActiveLearningRouter.ts#aiActiveLearningRouter.stats",
  "server/routers/aiActiveLearningRouter.ts#aiActiveLearningRouter.uncertaintySampling",
  // ── server/routers/aiAdvancedRouter.ts (7) ─────────────────────────────────────────────────
  "server/routers/aiAdvancedRouter.ts#edgeRouter.deviceDeployments",
  "server/routers/aiAdvancedRouter.ts#edgeRouter.getById",
  "server/routers/aiAdvancedRouter.ts#edgeRouter.inferenceResults",
  "server/routers/aiAdvancedRouter.ts#edgeRouter.list",
  "server/routers/aiAdvancedRouter.ts#edgeRouter.staleDeployments",
  "server/routers/aiAdvancedRouter.ts#trainingRouter.checkAutoRetrain",
  "server/routers/aiAdvancedRouter.ts#trainingRouter.getDataStats",
  // ── server/routers/aiAnomalyRouter.ts (4) ──────────────────────────────────────────────────
  "server/routers/aiAnomalyRouter.ts#aiAnomalyRouter.getProfile",
  "server/routers/aiAnomalyRouter.ts#aiAnomalyRouter.latestForMachine",
  "server/routers/aiAnomalyRouter.ts#aiAnomalyRouter.machineStatuses",
  "server/routers/aiAnomalyRouter.ts#aiAnomalyRouter.stats",
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
  // ── server/routers/aiCalibrationRouter.ts (3) ──────────────────────────────────────────────
  "server/routers/aiCalibrationRouter.ts#aiCalibrationRouter.getCalibration",
  "server/routers/aiCalibrationRouter.ts#aiCalibrationRouter.getLatestCalibration",
  "server/routers/aiCalibrationRouter.ts#aiCalibrationRouter.listCalibration",
  // ── server/routers/aiEvalRouter.ts (1) ─────────────────────────────────────────────────────
  "server/routers/aiEvalRouter.ts#aiEvalRouter.autoRetrainCheck",
  // ── server/routers/aiFeedbackRouter.ts (3) ─────────────────────────────────────────────────
  "server/routers/aiFeedbackRouter.ts#aiFeedbackRouter.getDashboardStats",
  "server/routers/aiFeedbackRouter.ts#aiFeedbackRouter.getPendingSuggestions",
  "server/routers/aiFeedbackRouter.ts#aiFeedbackRouter.getSuggestionsByInspection",
  // ── server/routers/aiImageSearchRouter.ts (3) ──────────────────────────────────────────────
  "server/routers/aiImageSearchRouter.ts#aiImageSearchRouter.clusterDefects",
  "server/routers/aiImageSearchRouter.ts#aiImageSearchRouter.findSimilar",
  "server/routers/aiImageSearchRouter.ts#aiImageSearchRouter.stats",
  // ── server/routers/aiInsightRouter.ts (1) ──────────────────────────────────────────────────
  "server/routers/aiInsightRouter.ts#aiInsightRouter.list",
  // ── server/routers/aiLocalTrainingRouter.ts (1) ────────────────────────────────────────────
  "server/routers/aiLocalTrainingRouter.ts#aiLocalTrainingRouter.capabilities",
  // ── server/routers/aiModelRouter.ts (2) ────────────────────────────────────────────────────
  "server/routers/aiModelRouter.ts#aiModelRouter.getInferenceResults",
  "server/routers/aiModelRouter.ts#aiModelRouter.getInferenceStats",
  // ── server/routers/aiOrchestrationRouter.ts (2) ────────────────────────────────────────────
  "server/routers/aiOrchestrationRouter.ts#aiOrchestrationRouter.optimizeWorkflow",
  "server/routers/aiOrchestrationRouter.ts#aiOrchestrationRouter.suggestWorkflow",
  // ── server/routers/aiQualityGateRouter.ts (4) ──────────────────────────────────────────────
  "server/routers/aiQualityGateRouter.ts#aiQualityGateRouter.getConfig",
  "server/routers/aiQualityGateRouter.ts#aiQualityGateRouter.listConfigs",
  "server/routers/aiQualityGateRouter.ts#aiQualityGateRouter.listResults",
  "server/routers/aiQualityGateRouter.ts#aiQualityGateRouter.stats",
  // ── server/routers/aiRcaCopilotRouter.ts (1) ───────────────────────────────────────────────
  "server/routers/aiRcaCopilotRouter.ts#aiRcaCopilotRouter.latest",
  // ── server/routers/aiRobotAnomalyRouter.ts (2) ─────────────────────────────────────────────
  "server/routers/aiRobotAnomalyRouter.ts#aiRobotAnomalyRouter.listAnomalies",
  "server/routers/aiRobotAnomalyRouter.ts#aiRobotAnomalyRouter.rollbackHistory",
  // ── server/routers/aiRouters.ts (4) ────────────────────────────────────────────────────────
  "server/routers/aiRouters.ts#predictiveAlertRouter.get",
  "server/routers/aiRouters.ts#predictiveAlertRouter.list",
  "server/routers/aiRouters.ts#predictiveAlertRouter.stats",
  "server/routers/aiRouters.ts#rootCauseRouter.list",
  // ── server/routers/aiSegmentationRouter.ts (1) ─────────────────────────────────────────────
  "server/routers/aiSegmentationRouter.ts#aiSegmentationRouter.listMasks",
  // ── server/routers/aiSettingsRouter.ts (1) ─────────────────────────────────────────────────
  "server/routers/aiSettingsRouter.ts#aiSettingsRouter.getDataPipelineStats",
  // ── server/routers/aiSetupAdvisorRouter.ts (1) ─────────────────────────────────────────────
  "server/routers/aiSetupAdvisorRouter.ts#aiSetupAdvisorRouter.suggestSetup",
  // ── server/routers/aiSmartAlertRoutingRouter.ts (3) ────────────────────────────────────────
  "server/routers/aiSmartAlertRoutingRouter.ts#aiSmartAlertRoutingRouter.detectSpike",
  "server/routers/aiSmartAlertRoutingRouter.ts#aiSmartAlertRoutingRouter.detectYieldDrop",
  "server/routers/aiSmartAlertRoutingRouter.ts#aiSmartAlertRoutingRouter.stats",
  // ── server/routers/aiThresholdAdvisorRouter.ts (3) ─────────────────────────────────────────
  "server/routers/aiThresholdAdvisorRouter.ts#aiThresholdAdvisorRouter.recommendForPoint",
  "server/routers/aiThresholdAdvisorRouter.ts#aiThresholdAdvisorRouter.recommendInspectionParam",
  "server/routers/aiThresholdAdvisorRouter.ts#aiThresholdAdvisorRouter.recommendNgThreshold",
  // ── server/routers/alertRouters.ts (2) ─────────────────────────────────────────────────────
  "server/routers/alertRouters.ts#alertRouter.getById",
  "server/routers/alertRouters.ts#alertRouter.listAll",
  // ── server/routers/andonRouter.ts (4) ──────────────────────────────────────────────────────
  "server/routers/andonRouter.ts#andonRouter.active",
  "server/routers/andonRouter.ts#andonRouter.get",
  "server/routers/andonRouter.ts#andonRouter.list",
  "server/routers/andonRouter.ts#andonRouter.metrics",
  // ── server/routers/annotationComparisonRouter.ts (4) ───────────────────────────────────────
  "server/routers/annotationComparisonRouter.ts#annotationComparisonRouter.compareTwo",
  "server/routers/annotationComparisonRouter.ts#annotationComparisonRouter.getById",
  "server/routers/annotationComparisonRouter.ts#annotationComparisonRouter.getTrendData",
  "server/routers/annotationComparisonRouter.ts#annotationComparisonRouter.list",
  // ── server/routers/annotationRouters.ts (7) ────────────────────────────────────────────────
  "server/routers/annotationRouters.ts#annotationRouter.comparison",
  "server/routers/annotationRouters.ts#annotationRouter.getByImage",
  "server/routers/annotationRouters.ts#annotationRouter.getByInspection",
  "server/routers/annotationRouters.ts#annotationRouter.heatmapData",
  "server/routers/annotationRouters.ts#annotationRouter.search",
  "server/routers/annotationRouters.ts#annotationRouter.statistics",
  "server/routers/annotationRouters.ts#annotationRouter.trendPrediction",
  // ── server/routers/aoiOnboardingRouter.ts (4) ──────────────────────────────────────────────
  "server/routers/aoiOnboardingRouter.ts#aoiOnboardingRouter.getDraft",
  "server/routers/aoiOnboardingRouter.ts#aoiOnboardingRouter.listAoiMachines",
  "server/routers/aoiOnboardingRouter.ts#aoiOnboardingRouter.listRecords",
  "server/routers/aoiOnboardingRouter.ts#aoiOnboardingRouter.status",
  // ── server/routers/aoiPackageRouter.ts (8) ─────────────────────────────────────────────────
  "server/routers/aoiPackageRouter.ts#aoiPackageRouter.downloadZip",
  "server/routers/aoiPackageRouter.ts#aoiPackageRouter.getImage",
  "server/routers/aoiPackageRouter.ts#aoiPackageRouter.getPackage",
  "server/routers/aoiPackageRouter.ts#aoiPackageRouter.getPackageImages",
  "server/routers/aoiPackageRouter.ts#aoiPackageRouter.getPackageLogs",
  "server/routers/aoiPackageRouter.ts#aoiPackageRouter.getQueueStatus",
  "server/routers/aoiPackageRouter.ts#aoiPackageRouter.getUploadStats",
  "server/routers/aoiPackageRouter.ts#aoiPackageRouter.listPackages",
  // ── server/routers/apiKeyRouter.ts (1) ─────────────────────────────────────────────────────
  "server/routers/apiKeyRouter.ts#apiKeyRouter.list",
  // ── server/routers/assetCockpitRouter.ts (3) ───────────────────────────────────────────────
  "server/routers/assetCockpitRouter.ts#assetCockpitRouter.machineAlarms",
  "server/routers/assetCockpitRouter.ts#assetCockpitRouter.machineDetail",
  "server/routers/assetCockpitRouter.ts#assetCockpitRouter.robotDetail",
  // ── server/routers/bomRouter.ts (5) ────────────────────────────────────────────────────────
  "server/routers/bomRouter.ts#bomRouter.feederReorderStatus",
  "server/routers/bomRouter.ts#bomRouter.getDefinition",
  "server/routers/bomRouter.ts#bomRouter.listFeeders",
  "server/routers/bomRouter.ts#bomRouter.traceForward",
  "server/routers/bomRouter.ts#bomRouter.traceReverse",
  // ── server/routers/commandCenterRouter.ts (1) ──────────────────────────────────────────────
  "server/routers/commandCenterRouter.ts#commandCenterRouter.hierarchy",
  // ── server/routers/commandLogRouter.ts (4) ─────────────────────────────────────────────────
  "server/routers/commandLogRouter.ts#commandLogRouter.avgDurations",
  "server/routers/commandLogRouter.ts#commandLogRouter.get",
  "server/routers/commandLogRouter.ts#commandLogRouter.list",
  "server/routers/commandLogRouter.ts#commandLogRouter.stats",
  // ── server/routers/componentLibraryRouter.ts (1) ───────────────────────────────────────────
  "server/routers/componentLibraryRouter.ts#componentLibraryRouter.linkStats",
  // ── server/routers/dashboardStatsRouters.ts (1) ────────────────────────────────────────────
  "server/routers/dashboardStatsRouters.ts#dashboardRouter.overviewCounts",
  // ── server/routers/defectDispositionRouter.ts (7) ──────────────────────────────────────────
  "server/routers/defectDispositionRouter.ts#defectDispositionRouter.countOpen",
  "server/routers/defectDispositionRouter.ts#defectDispositionRouter.listByInspection",
  "server/routers/defectDispositionRouter.ts#defectDispositionRouter.listBySerial",
  "server/routers/defectDispositionRouter.ts#defectDispositionRouter.listOpen",
  "server/routers/defectDispositionRouter.ts#defectDispositionRouter.reInspectStatus",
  "server/routers/defectDispositionRouter.ts#defectDispositionRouter.repairQueue",
  "server/routers/defectDispositionRouter.ts#defectDispositionRouter.repairStats",
  // ── server/routers/deviceAdapterRouter.ts (2) ──────────────────────────────────────────────
  "server/routers/deviceAdapterRouter.ts#deviceAdapterRouter.get",
  "server/routers/deviceAdapterRouter.ts#deviceAdapterRouter.list",
  // ── server/routers/digitalTwinRouter.ts (5) ────────────────────────────────────────────────
  "server/routers/digitalTwinRouter.ts#digitalTwinRouter.defectHeatmap",
  "server/routers/digitalTwinRouter.ts#digitalTwinRouter.predictionOverlay",
  "server/routers/digitalTwinRouter.ts#digitalTwinRouter.stationLoadHeatmap",
  "server/routers/digitalTwinRouter.ts#digitalTwinRouter.twinState",
  "server/routers/digitalTwinRouter.ts#digitalTwinRouter.wipFlowState",
  // ── server/routers/ecnRouter.ts (2) ────────────────────────────────────────────────────────
  "server/routers/ecnRouter.ts#ecnRouter.getById",
  "server/routers/ecnRouter.ts#ecnRouter.list",
  // ── server/routers/ecosystemAdminRouter.ts (1) ─────────────────────────────────────────────
  "server/routers/ecosystemAdminRouter.ts#ecosystemAdminRouter.softRefIntegrity",
  // ── server/routers/edgeDeploymentRouter.ts (4) ─────────────────────────────────────────────
  "server/routers/edgeDeploymentRouter.ts#edgeDeploymentRouter.getDeploymentStatus",
  "server/routers/edgeDeploymentRouter.ts#edgeDeploymentRouter.getFleetOverview",
  "server/routers/edgeDeploymentRouter.ts#edgeDeploymentRouter.getUnifiedFleetStatus",
  "server/routers/edgeDeploymentRouter.ts#edgeDeploymentRouter.listDeployments",
  // ── server/routers/edgeRuntimeRouter.ts (2) ────────────────────────────────────────────────
  "server/routers/edgeRuntimeRouter.ts#edgeRuntimeRouter.listNodes",
  "server/routers/edgeRuntimeRouter.ts#edgeRuntimeRouter.nodeStatus",
  // ── server/routers/energyRouter.ts (6) ─────────────────────────────────────────────────────
  "server/routers/energyRouter.ts#energyRouter.demandResponse",
  "server/routers/energyRouter.ts#energyRouter.enpi",
  "server/routers/energyRouter.ts#energyRouter.forecast",
  "server/routers/energyRouter.ts#energyRouter.peakDemand",
  "server/routers/energyRouter.ts#energyRouter.powerFactor",
  "server/routers/energyRouter.ts#energyRouter.recipeEnergy",
  // ── server/routers/equipmentIntegrationRouter.ts (5) ───────────────────────────────────────
  "server/routers/equipmentIntegrationRouter.ts#equipmentIntegrationRouter.euromapOpcuaSnapshot",
  "server/routers/equipmentIntegrationRouter.ts#equipmentIntegrationRouter.frameworkSnapshot",
  "server/routers/equipmentIntegrationRouter.ts#equipmentIntegrationRouter.listCodeHistory",
  "server/routers/equipmentIntegrationRouter.ts#equipmentIntegrationRouter.listLoadHistory",
  "server/routers/equipmentIntegrationRouter.ts#equipmentIntegrationRouter.listRecipeVersions",
  // ── server/routers/equipmentRouter.ts (3) ──────────────────────────────────────────────────
  "server/routers/equipmentRouter.ts#equipmentRouter.getCapabilities",
  "server/routers/equipmentRouter.ts#equipmentRouter.getState",
  "server/routers/equipmentRouter.ts#equipmentRouter.listEquipment",
  // ── server/routers/equipmentStandardsRouter.ts (9) ─────────────────────────────────────────
  "server/routers/equipmentStandardsRouter.ts#equipmentStandardsRouter.alarmKpis",
  "server/routers/equipmentStandardsRouter.ts#equipmentStandardsRouter.complianceMetrics",
  "server/routers/equipmentStandardsRouter.ts#equipmentStandardsRouter.hierarchyTree",
  "server/routers/equipmentStandardsRouter.ts#equipmentStandardsRouter.listAlarmMappings",
  "server/routers/equipmentStandardsRouter.ts#equipmentStandardsRouter.listChangeRequests",
  "server/routers/equipmentStandardsRouter.ts#equipmentStandardsRouter.listMasterAlarms",
  "server/routers/equipmentStandardsRouter.ts#equipmentStandardsRouter.mapAlarm",
  "server/routers/equipmentStandardsRouter.ts#equipmentStandardsRouter.resolveForMachineType",
  "server/routers/equipmentStandardsRouter.ts#equipmentStandardsRouter.resolveType",
  // ── server/routers/erpAdminRouter.ts (3) ───────────────────────────────────────────────────
  "server/routers/erpAdminRouter.ts#erpAdminRouter.listOauthClients",
  "server/routers/erpAdminRouter.ts#erpAdminRouter.outboxDeadLetters",
  "server/routers/erpAdminRouter.ts#erpAdminRouter.outboxStatus",
  // ── server/routers/factoryCommandRouter.ts (2) ─────────────────────────────────────────────
  "server/routers/factoryCommandRouter.ts#factoryCommandRouter.machineDetail",
  "server/routers/factoryCommandRouter.ts#factoryCommandRouter.overview",
  // ── server/routers/federationRouter.ts (7) ─────────────────────────────────────────────────
  "server/routers/federationRouter.ts#federationRouter.aggregateSummary",
  "server/routers/federationRouter.ts#federationRouter.alertRollup",
  "server/routers/federationRouter.ts#federationRouter.categoryRollup",
  "server/routers/federationRouter.ts#federationRouter.siteDetail",
  "server/routers/federationRouter.ts#federationRouter.siteKpiHistory",
  "server/routers/federationRouter.ts#federationRouter.siteRollups",
  "server/routers/federationRouter.ts#federationRouter.syncLog",
  // ── server/routers/feederVerifyRouter.ts (3) ───────────────────────────────────────────────
  "server/routers/feederVerifyRouter.ts#feederVerifyRouter.listForSetup",
  "server/routers/feederVerifyRouter.ts#feederVerifyRouter.runGate",
  "server/routers/feederVerifyRouter.ts#feederVerifyRouter.setupStatus",
  // ── server/routers/fieldRouter.ts (3) ──────────────────────────────────────────────────────
  "server/routers/fieldRouter.ts#fieldRouter.deviceState",
  "server/routers/fieldRouter.ts#fieldRouter.health",
  "server/routers/fieldRouter.ts#fieldRouter.healthSummary",
  // ── server/routers/genealogyRouter.ts (5) ──────────────────────────────────────────────────
  "server/routers/genealogyRouter.ts#genealogyRouter.getByLot",
  "server/routers/genealogyRouter.ts#genealogyRouter.getBySerial",
  "server/routers/genealogyRouter.ts#genealogyRouter.getFullHistory",
  "server/routers/genealogyRouter.ts#genealogyRouter.getLineage",
  "server/routers/genealogyRouter.ts#genealogyRouter.verify",
  // ── server/routers/goldenSampleRouter.ts (5) ───────────────────────────────────────────────
  "server/routers/goldenSampleRouter.ts#goldenSampleRouter.getActiveForKey",
  "server/routers/goldenSampleRouter.ts#goldenSampleRouter.getThumbnail",
  "server/routers/goldenSampleRouter.ts#goldenSampleRouter.listByProduct",
  "server/routers/goldenSampleRouter.ts#goldenSampleRouter.listForProduct",
  "server/routers/goldenSampleRouter.ts#goldenSampleRouter.listManaged",
  // ── server/routers/hierarchyRouters.ts (1) ─────────────────────────────────────────────────
  "server/routers/hierarchyRouters.ts#machineRouter.config",
  // ── server/routers/hierarchyTreeRouter.ts (4) ──────────────────────────────────────────────
  "server/routers/hierarchyTreeRouter.ts#hierarchyTreeRouter.getFactoryTree",
  "server/routers/hierarchyTreeRouter.ts#hierarchyTreeRouter.getMqttTopics",
  "server/routers/hierarchyTreeRouter.ts#hierarchyTreeRouter.getSummary",
  "server/routers/hierarchyTreeRouter.ts#hierarchyTreeRouter.getTree",
  // ── server/routers/hotFolderRouter.ts (3) ──────────────────────────────────────────────────
  "server/routers/hotFolderRouter.ts#hotFolderRouter.listConfigs",
  "server/routers/hotFolderRouter.ts#hotFolderRouter.recentFiles",
  "server/routers/hotFolderRouter.ts#hotFolderRouter.status",
  // ── server/routers/inspectionProgramRouter.ts (4) ──────────────────────────────────────────
  "server/routers/inspectionProgramRouter.ts#inspectionProgramRouter.compare",
  "server/routers/inspectionProgramRouter.ts#inspectionProgramRouter.get",
  "server/routers/inspectionProgramRouter.ts#inspectionProgramRouter.getActive",
  "server/routers/inspectionProgramRouter.ts#inspectionProgramRouter.list",
  // ── server/routers/inspectionRouters.ts (5) ────────────────────────────────────────────────
  "server/routers/inspectionRouters.ts#inspectionRouter.aiAnalysis",
  "server/routers/inspectionRouters.ts#inspectionRouter.defectPatternClusters",
  "server/routers/inspectionRouters.ts#inspectionRouter.getById",
  "server/routers/inspectionRouters.ts#measurementResultRouter.getById",
  "server/routers/inspectionRouters.ts#measurementResultRouter.getByInspection",
  // ── server/routers/interlockRouter.ts (3) ──────────────────────────────────────────────────
  "server/routers/interlockRouter.ts#interlockRouter.get",
  "server/routers/interlockRouter.ts#interlockRouter.list",
  "server/routers/interlockRouter.ts#interlockRouter.testEvaluate",
  // ── server/routers/irRouter.ts (4) ─────────────────────────────────────────────────────────
  "server/routers/irRouter.ts#irRouter.diffVersions",
  "server/routers/irRouter.ts#irRouter.getFlow",
  "server/routers/irRouter.ts#irRouter.listFlows",
  "server/routers/irRouter.ts#irRouter.mergeVersions",
  // ── server/routers/layoutRouters.ts (2) ────────────────────────────────────────────────────
  "server/routers/layoutRouters.ts#layoutRouter.getById",
  "server/routers/layoutRouters.ts#layoutRouter.listByWorkshop",
  // ── server/routers/lineControllerRouter.ts (8) ─────────────────────────────────────────────
  "server/routers/lineControllerRouter.ts#lineControllerRouter.getState",
  "server/routers/lineControllerRouter.ts#lineControllerRouter.listStates",
  "server/routers/lineControllerRouter.ts#lineControllerRouter.readiness",
  "server/routers/lineControllerRouter.ts#lineControllerRouter.recipeSet.get",
  "server/routers/lineControllerRouter.ts#lineControllerRouter.recipeSet.list",
  "server/routers/lineControllerRouter.ts#lineControllerRouter.recipeSet.lockStatus",
  "server/routers/lineControllerRouter.ts#lineControllerRouter.stages",
  "server/routers/lineControllerRouter.ts#lineControllerRouter.transitions",
  // ── server/routers/machineApiRouters.ts (1) ────────────────────────────────────────────────
  "server/routers/machineApiRouters.ts#machineApiRouter.listKeys",
  // ── server/routers/machineRecipeRouter.ts (9) ──────────────────────────────────────────────
  "server/routers/machineRecipeRouter.ts#machineRecipeRouter.changeover.list",
  "server/routers/machineRecipeRouter.ts#machineRecipeRouter.changeover.recipeOptions",
  "server/routers/machineRecipeRouter.ts#machineRecipeRouter.deployments.list",
  "server/routers/machineRecipeRouter.ts#machineRecipeRouter.machines.list",
  "server/routers/machineRecipeRouter.ts#machineRecipeRouter.recipes.genealogy",
  "server/routers/machineRecipeRouter.ts#machineRecipeRouter.recipes.get",
  "server/routers/machineRecipeRouter.ts#machineRecipeRouter.recipes.getActive",
  "server/routers/machineRecipeRouter.ts#machineRecipeRouter.recipes.listCodes",
  "server/routers/machineRecipeRouter.ts#machineRecipeRouter.recipes.listVersions",
  // ── server/routers/maintenanceRouter.ts (4) ────────────────────────────────────────────────
  "server/routers/maintenanceRouter.ts#maintenanceRouter.getWorkOrder",
  "server/routers/maintenanceRouter.ts#maintenanceRouter.listWorkOrders",
  "server/routers/maintenanceRouter.ts#maintenanceRouter.partsBelowReorder",
  "server/routers/maintenanceRouter.ts#maintenanceRouter.summary",
  // ── server/routers/maintenanceScheduleRouter.ts (2) ────────────────────────────────────────
  "server/routers/maintenanceScheduleRouter.ts#maintenanceScheduleRouter.get",
  "server/routers/maintenanceScheduleRouter.ts#maintenanceScheduleRouter.list",
  // ── server/routers/mappingAsCodeRouter.ts (1) ──────────────────────────────────────────────
  "server/routers/mappingAsCodeRouter.ts#mappingAsCodeRouter.exportOne",
  // ── server/routers/measurementCorrectionsRouter.ts (2) ─────────────────────────────────────
  "server/routers/measurementCorrectionsRouter.ts#measurementCorrectionsRouter.agreementTrend",
  "server/routers/measurementCorrectionsRouter.ts#measurementCorrectionsRouter.machineFalseCallSummary",
  // ── server/routers/mqttBulletinRouter.ts (5) ───────────────────────────────────────────────
  "server/routers/mqttBulletinRouter.ts#mqttBulletinRouter.getDashboardStats",
  "server/routers/mqttBulletinRouter.ts#mqttBulletinRouter.getHistory",
  "server/routers/mqttBulletinRouter.ts#mqttBulletinRouter.getHistoryDetail",
  "server/routers/mqttBulletinRouter.ts#mqttBulletinRouter.getSetting",
  "server/routers/mqttBulletinRouter.ts#mqttBulletinRouter.listSettings",
  // ── server/routers/mqttClientManagementRouter.ts (6) ───────────────────────────────────────
  "server/routers/mqttClientManagementRouter.ts#mqttClientManagementRouter.exportAssignmentReport",
  "server/routers/mqttClientManagementRouter.ts#mqttClientManagementRouter.getAvailableTargets",
  "server/routers/mqttClientManagementRouter.ts#mqttClientManagementRouter.getConnectionStatus",
  "server/routers/mqttClientManagementRouter.ts#mqttClientManagementRouter.getDashboardStats",
  "server/routers/mqttClientManagementRouter.ts#mqttClientManagementRouter.getReconnectStatsByTarget",
  "server/routers/mqttClientManagementRouter.ts#mqttClientManagementRouter.listAssignments",
  // ── server/routers/mqttNgAlertSettingsRouter.ts (2) ────────────────────────────────────────
  "server/routers/mqttNgAlertSettingsRouter.ts#mqttNgAlertSettingsRouter.getSetting",
  "server/routers/mqttNgAlertSettingsRouter.ts#mqttNgAlertSettingsRouter.listSettings",
  // ── server/routers/mqttSoftwareVersionRouter.ts (1) ────────────────────────────────────────
  "server/routers/mqttSoftwareVersionRouter.ts#mqttSoftwareVersionRouter.deviceVersionSummary",
  // ── server/routers/msdRouter.ts (2) ────────────────────────────────────────────────────────
  "server/routers/msdRouter.ts#msdRouter.expiringSoon",
  "server/routers/msdRouter.ts#msdRouter.listActive",
  // ── server/routers/ncrRouter.ts (2) ────────────────────────────────────────────────────────
  "server/routers/ncrRouter.ts#ncrRouter.getById",
  "server/routers/ncrRouter.ts#ncrRouter.list",
  // ── server/routers/ngRateThresholdRouter.ts (4) ────────────────────────────────────────────
  "server/routers/ngRateThresholdRouter.ts#ngRateThresholdRouter.alertHistory",
  "server/routers/ngRateThresholdRouter.ts#ngRateThresholdRouter.currentNgRates",
  "server/routers/ngRateThresholdRouter.ts#ngRateThresholdRouter.getById",
  "server/routers/ngRateThresholdRouter.ts#ngRateThresholdRouter.list",
  // ── server/routers/ntfClassifierRouter.ts (2) ──────────────────────────────────────────────
  "server/routers/ntfClassifierRouter.ts#ntfClassifierRouter.list",
  "server/routers/ntfClassifierRouter.ts#ntfClassifierRouter.status",
  // ── server/routers/orchestrationRouter.ts (1) ──────────────────────────────────────────────
  "server/routers/orchestrationRouter.ts#orchestrationRouter.simulate",
  // ── server/routers/orderLifecycleRouter.ts (3) ─────────────────────────────────────────────
  "server/routers/orderLifecycleRouter.ts#orderLifecycleRouter.detail",
  "server/routers/orderLifecycleRouter.ts#orderLifecycleRouter.list",
  "server/routers/orderLifecycleRouter.ts#orderLifecycleRouter.trace",
  // ── server/routers/oversightRouter.ts (1) ──────────────────────────────────────────────────
  "server/routers/oversightRouter.ts#oversightRouter.pendingSummary",
  // ── server/routers/parameterGuardrailRouter.ts (5) ─────────────────────────────────────────
  "server/routers/parameterGuardrailRouter.ts#parameterGuardrailRouter.changeLog",
  "server/routers/parameterGuardrailRouter.ts#parameterGuardrailRouter.get",
  "server/routers/parameterGuardrailRouter.ts#parameterGuardrailRouter.list",
  "server/routers/parameterGuardrailRouter.ts#parameterGuardrailRouter.materialForecast.component",
  "server/routers/parameterGuardrailRouter.ts#parameterGuardrailRouter.materialForecast.machine",
  // ── server/routers/paretoAnalysisRouter.ts (6) ─────────────────────────────────────────────
  "server/routers/paretoAnalysisRouter.ts#paretoAnalysisRouter.byDefectClass",
  "server/routers/paretoAnalysisRouter.ts#paretoAnalysisRouter.byDefectType",
  "server/routers/paretoAnalysisRouter.ts#paretoAnalysisRouter.byLine",
  "server/routers/paretoAnalysisRouter.ts#paretoAnalysisRouter.byMachine",
  "server/routers/paretoAnalysisRouter.ts#paretoAnalysisRouter.byPackage",
  "server/routers/paretoAnalysisRouter.ts#paretoAnalysisRouter.byTimePeriod",
  // ── server/routers/permissionsRouter.ts (2) ────────────────────────────────────────────────
  "server/routers/permissionsRouter.ts#permissionsRouter.getBuiltInRoles",
  "server/routers/permissionsRouter.ts#permissionsRouter.getDefaultPermissionsForRole",
  // ── server/routers/predictiveMaintenanceRouter.ts (4) ──────────────────────────────────────
  "server/routers/predictiveMaintenanceRouter.ts#predictiveMaintenanceRouter.getMachineRisk",
  "server/routers/predictiveMaintenanceRouter.ts#predictiveMaintenanceRouter.getReliabilityStats",
  "server/routers/predictiveMaintenanceRouter.ts#predictiveMaintenanceRouter.getRulEstimate",
  "server/routers/predictiveMaintenanceRouter.ts#predictiveMaintenanceRouter.listRulForecast",
  // ── server/routers/processResultRouter.ts (7) ──────────────────────────────────────────────
  "server/routers/processResultRouter.ts#processResultRouter.dailyRollup",
  "server/routers/processResultRouter.ts#processResultRouter.envSeries",
  "server/routers/processResultRouter.ts#processResultRouter.fleetRollup",
  "server/routers/processResultRouter.ts#processResultRouter.listBySerial",
  "server/routers/processResultRouter.ts#processResultRouter.metricSeries",
  "server/routers/processResultRouter.ts#processResultRouter.spcChart",
  "server/routers/processResultRouter.ts#processResultRouter.stats",
  // ── server/routers/processRouter.ts (2) ────────────────────────────────────────────────────
  "server/routers/processRouter.ts#processRouter.getAssignmentsByProcess",
  "server/routers/processRouter.ts#processRouter.getLineAssignments",
  // ── server/routers/productionDashboardRouter.ts (5) ────────────────────────────────────────
  "server/routers/productionDashboardRouter.ts#productionDashboardRouter.getDefectAnalysis",
  "server/routers/productionDashboardRouter.ts#productionDashboardRouter.getFalseCallEscape",
  "server/routers/productionDashboardRouter.ts#productionDashboardRouter.getSpcSummary",
  "server/routers/productionDashboardRouter.ts#productionDashboardRouter.getStationOverview",
  "server/routers/productionDashboardRouter.ts#productionDashboardRouter.getTrendData",
  // ── server/routers/productionSessionRouter.ts (3) ──────────────────────────────────────────
  "server/routers/productionSessionRouter.ts#productionSessionRouter.getById",
  "server/routers/productionSessionRouter.ts#productionSessionRouter.list",
  "server/routers/productionSessionRouter.ts#productionSessionRouter.verifySignoff",
  // ── server/routers/productVariantRouter.ts (2) ─────────────────────────────────────────────
  "server/routers/productVariantRouter.ts#productVariantRouter.getEffectivePoints",
  "server/routers/productVariantRouter.ts#productVariantRouter.getVariant",
  // ── server/routers/programmingRouter.ts (9) ────────────────────────────────────────────────
  "server/routers/programmingRouter.ts#programmingRouter.fleetVersionMatrix",
  "server/routers/programmingRouter.ts#programmingRouter.getArtifact",
  "server/routers/programmingRouter.ts#programmingRouter.getProject",
  "server/routers/programmingRouter.ts#programmingRouter.listArtifacts",
  "server/routers/programmingRouter.ts#programmingRouter.listBuilds",
  "server/routers/programmingRouter.ts#programmingRouter.listDeployApprovals",
  "server/routers/programmingRouter.ts#programmingRouter.listDeployments",
  "server/routers/programmingRouter.ts#programmingRouter.listProjects",
  "server/routers/programmingRouter.ts#programmingRouter.listSymbols",
  // ★★★ 2026-08-18 — 8 mục của `server/routers/publicProductApiRouter.ts` ĐÃ ĐƯỢC TRẢ, xoá khỏi
  // đây. Tám thủ tục ấy nay thu hẹp về nhà máy của MÁY GỌI (`publicProductScope.ts`) và bộ suy
  // xếp chúng vào nhóm **B** — xem `phamViDocCensus.test.ts` §8, nơi tập ấy được ghim TỪNG TÊN.
  // ── server/routers/realtimeReportRouter.ts (2) ─────────────────────────────────────────────
  "server/routers/realtimeReportRouter.ts#realtimeReportRouter.enpiSummary",
  "server/routers/realtimeReportRouter.ts#realtimeReportRouter.healthSeries",
  // ── server/routers/reportingMartRouter.ts (3) ──────────────────────────────────────────────
  "server/routers/reportingMartRouter.ts#reportingMartRouter.productMix",
  "server/routers/reportingMartRouter.ts#reportingMartRouter.yieldByShift",
  "server/routers/reportingMartRouter.ts#reportingMartRouter.yieldTrendHourly",
  // ── server/routers/robotRouter.ts (5) ──────────────────────────────────────────────────────
  "server/routers/robotRouter.ts#robotRouter.get",
  "server/routers/robotRouter.ts#robotRouter.interlockPreview",
  "server/routers/robotRouter.ts#robotRouter.jobs",
  "server/routers/robotRouter.ts#robotRouter.list",
  "server/routers/robotRouter.ts#robotRouter.telemetry",
  // ── server/routers/safetyRouter.ts (9) ─────────────────────────────────────────────────────
  "server/routers/safetyRouter.ts#safetyRouter.currentBoard",
  "server/routers/safetyRouter.ts#safetyRouter.evaluateZones",
  "server/routers/safetyRouter.ts#safetyRouter.feed",
  "server/routers/safetyRouter.ts#safetyRouter.listAssignments",
  "server/routers/safetyRouter.ts#safetyRouter.listCameraCalibrations",
  "server/routers/safetyRouter.ts#safetyRouter.listCollaborations",
  "server/routers/safetyRouter.ts#safetyRouter.listSafetyPlcConfigs",
  "server/routers/safetyRouter.ts#safetyRouter.listZones",
  "server/routers/safetyRouter.ts#safetyRouter.nearMissTrend",
  // ── server/routers/semanticsRouter.ts (3) ──────────────────────────────────────────────────
  "server/routers/semanticsRouter.ts#semanticsRouter.compute",
  "server/routers/semanticsRouter.ts#semanticsRouter.get",
  "server/routers/semanticsRouter.ts#semanticsRouter.list",
  // ── server/routers/sensorRouter.ts (2) ─────────────────────────────────────────────────────
  "server/routers/sensorRouter.ts#sensorRouter.listTypes",
  "server/routers/sensorRouter.ts#sensorRouter.readSeries",
  // ── server/routers/shiftConfigRouter.ts (2) ────────────────────────────────────────────────
  "server/routers/shiftConfigRouter.ts#shiftConfigRouter.defaults",
  "server/routers/shiftConfigRouter.ts#shiftConfigRouter.list",
  // ── server/routers/simulationRouter.ts (1) ─────────────────────────────────────────────────
  "server/routers/simulationRouter.ts#simulationRouter.fromScene",
  // ── server/routers/sitesRouter.ts (2) ──────────────────────────────────────────────────────
  "server/routers/sitesRouter.ts#sitesRouter.get",
  "server/routers/sitesRouter.ts#sitesRouter.list",
  // ── server/routers/sopRouter.ts (5) ────────────────────────────────────────────────────────
  "server/routers/sopRouter.ts#sopRouter.execution",
  "server/routers/sopRouter.ts#sopRouter.executions",
  "server/routers/sopRouter.ts#sopRouter.get",
  "server/routers/sopRouter.ts#sopRouter.list",
  "server/routers/sopRouter.ts#sopRouter.resolveActive",
  // ── server/routers/spcAnalysisRouter.ts (2) ────────────────────────────────────────────────
  "server/routers/spcAnalysisRouter.ts#spcAnalysisRouter.controlChart",
  "server/routers/spcAnalysisRouter.ts#spcAnalysisRouter.topNGPoints",
  // ── server/routers/stationTriangulationRouter.ts (1) ───────────────────────────────────────
  "server/routers/stationTriangulationRouter.ts#stationTriangulationRouter.correlationMatrix",
  // ── server/routers/stencilRouter.ts (2) ────────────────────────────────────────────────────
  "server/routers/stencilRouter.ts#stencilRouter.listUsage",
  "server/routers/stencilRouter.ts#stencilRouter.status",
  // ── server/routers/systemHealthRouter.ts (1) ───────────────────────────────────────────────
  "server/routers/systemHealthRouter.ts#systemHealthRouter.connectionSupervisors",
  // ── server/routers/systemRouters.ts (1) ────────────────────────────────────────────────────
  "server/routers/systemRouters.ts#corporateFactoryStatsRouter.warmingStats",
  // ── server/routers/thresholdApprovalRouter.ts (3) ──────────────────────────────────────────
  "server/routers/thresholdApprovalRouter.ts#thresholdApprovalRouter.countPendingByProduct",
  "server/routers/thresholdApprovalRouter.ts#thresholdApprovalRouter.getById",
  "server/routers/thresholdApprovalRouter.ts#thresholdApprovalRouter.list",
  // ── server/routers/thresholdSuggestionRouter.ts (2) ────────────────────────────────────────
  "server/routers/thresholdSuggestionRouter.ts#thresholdSuggestionRouter.suggestForPoint",
  "server/routers/thresholdSuggestionRouter.ts#thresholdSuggestionRouter.suggestForProductModel",
  // ── server/routers/traceabilityRouter.ts (2) ───────────────────────────────────────────────
  "server/routers/traceabilityRouter.ts#traceabilityRouter.byLot",
  "server/routers/traceabilityRouter.ts#traceabilityRouter.bySerial",
  // ── server/routers/twinRouter.ts (7) ───────────────────────────────────────────────────────
  "server/routers/twinRouter.ts#twinRouter.models.list",
  "server/routers/twinRouter.ts#twinRouter.models.resolve",
  "server/routers/twinRouter.ts#twinRouter.occupancyGrid",
  "server/routers/twinRouter.ts#twinRouter.replay",
  "server/routers/twinRouter.ts#twinRouter.sceneGraph",
  "server/routers/twinRouter.ts#twinRouter.twinModels",
  "server/routers/twinRouter.ts#twinRouter.usdExport",
  // ── server/routers/userRouters.ts (1) ──────────────────────────────────────────────────────
  "server/routers/userRouters.ts#userAssignmentRouter.getAllUserAssignments",
  // ── server/routers/vda5050Router.ts (2) ────────────────────────────────────────────────────
  "server/routers/vda5050Router.ts#vda5050Router.listAgvs",
  // ↓ cùng lời khai "thước vừa sắc hơn" như khối `aiCalibrationRouter.ts` ở trên.
  "server/routers/vda5050Router.ts#vda5050Router.status",
  // ── server/routers/wipRouter.ts (5) ────────────────────────────────────────────────────────
  "server/routers/wipRouter.ts#wipRouter.dispatch",
  "server/routers/wipRouter.ts#wipRouter.dwellByStation",
  "server/routers/wipRouter.ts#wipRouter.lineBalance",
  "server/routers/wipRouter.ts#wipRouter.list",
  "server/routers/wipRouter.ts#wipRouter.summary",
];
