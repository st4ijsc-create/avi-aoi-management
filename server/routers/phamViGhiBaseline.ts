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
 * 2026-10-24 sửa điểm mù bộ quét: `.input(idInput)` (đối số là một ĐỊNH DANH hằng schema cấp file) trước bị coi "không khoá" ⇒ delete, bulk, import của masterData… không vào sổ; nay +36 nợ lộ ra (masterData 22, componentLibrary 3, interlock 2, aiSpecialistAgent 2…) ⇒ 457 → 493.
 * 2026-10-24 lô W7 (−36, masterDataRouter: suppliers/materials/customers/tools/plantCalendars(+ngày,+ca)/warehouses(+vị trí,+tồn kho) create-update-delete-bulk-import theo vị từ ĐỌC congMaTenant, hàng mới đóng dấu tenant trong phạm vi) ⇒ 493 → 457. CÒN LẠI ở masterData (12): skills · uom · unit_conversions · material_classes · user_certifications — danh mục KHÔNG có mã tenant, chờ quyết định chủ dự án.
 * 2026-10-24 lô W8 (điều khiển: interlock create/update/delete/enable/disable/resolveEvent · lineController transition/command/recipeSet.* · safety recordEvent/auditEvent/upsertCameraCalibration/signalHandshake/advancePhase/abortCollaboration) + 2 miễn trừ (robot.consoleStop · scadaCommands.huy).
 * 2026-10-24 lô W9 (−27, sản xuất: productionOrder create/update/delete/reschedule, template, createFromTemplate/optimizeSchedule/whatIf · lineStage · lineProductAssignment · orderLifecycle allocate/hold/resume/cancel · productionSession open/pause/resume/close/handover/supervisorSignOff) ⇒ 438 → 411.
 * 2026-10-24 W7b: chứng chỉ kỹ năng theo NGƯỜI được cấp (skills.grant/update/revokeCertification · userCertifications.assign/revoke); 8 danh mục chuẩn dùng chung (skills · uom · unit_conversions · material_classes) + safety.abortCollaboration (L-7) chuyển sang MIỄN TRỪ có lý do.
 * 2026-10-25 lô W7c (−1: msaAdvanced.anovaOfStudy) — migration 0421 `measurement_instruments."factoryId"`: thiết bị đo / hiệu chuẩn / MSA theo NHÀ MÁY (đọc + tên thiết bị suy qua instrumentId; NULL ⇒ chỉ toàn quyền) ⇒ 408 → 407.
 * 2026-10-25 lô W10 (−17 vá: routing · spcAdvanced · goldenSample · mqttOee machine/OEE/ngừng máy/mục tiêu · equipmentStandards thẻ tenant; −35 MIỄN TRỪ có lý do sau khi đọc mã: repoWorkspace 17 (danh sách trắng theo người gọi), dashboardWidget 13 (cấu hình cá nhân theo userId), aiGguf 5 (tính toán LLM thuần); aiGguf.soModel* = bí danh adminProcedure) ⇒ 407 → 355. CHƯA đụng (cần quyết định): mqttClient.updateFcmToken · mqttAlert.update/delete/toggle/resolve (luật cảnh báo toàn cục, KHÔNG có requirePermission) .
 * 2026-10-25 lô W11a (−5 vá: predictiveAlert acknowledge/resolve/dismiss/generatePredictions theo máy/nhà máy của cảnh báo + lọc dữ liệu quét; mqttClient.updateFcmToken theo trạm của client + requirePermission(machine_alerts)); mqttAlert.update/delete/toggle/resolve ⇒ MIỄN TRỪ (luật toàn cục) NHƯNG nay đòi requirePermission(machine_alerts); equipmentStandards: chuẩn KHÔNG thẻ chỉ admin + engineer ghi ⇒ 355 → 350.
 * 2026-10-25 lô W11b (−15 vá: aiQualityGate · aiFeedback (kể cả lô huấn luyện / xuất chỉ phần trong phạm vi) · aiSegmentation.saveMask · aiModel.runInference theo lần kiểm tra; aiSmartAlertRouting.acknowledge · aiInsight.setStatus · aiActiveLearning theo máy; edge deployments theo máy — router edge hiện BỊ COMMENT khỏi aiAdvancedRouter nên chưa tới được; −42 MIỄN TRỪ có dẫn mã: sở hữu theo người dùng (aiAgent · aiChat · aiCopilot · aiSpecialistAgent · …), tính toán / model toàn cục) ⇒ 350 → 335. CÒN LẠI nhóm AI (W11c): aiVision.proposeDefect · aiRcaCopilot.applyTopFix · aiThresholdAdvisor.applyNgThreshold (đề xuất HITL), aiAdvanced training/abTest (router bị comment), aiAdvancedVision.explainHeatmap, aiModel cards, aiImageSearch (mutation đọc-hình-tìm-kiếm trả ảnh nhiều nhà máy — cần đổi dịch vụ).
 * 2026-10-25 lô W13 (−45 sổ, +9 miễn trừ): shiftConfig · layout (+vị trí máy) · maintenanceSchedule (+đổi tên getRow trùng ⇒ 4 báo giả của maintenanceRouter hết) · ngRateThreshold · process (gán chuyền) · productPanel · productVariant · thresholdApproval (đổi tên getById trùng) · workstation (+gán máy) · alert.create theo phạm vi qua _cauHinhPhamVi.ts; miễn trừ: danh mục quy trình dùng chung, cảnh báo sở hữu theo người dùng, ngưỡng yield toàn cục. 291 → 246.
 */
export const NO_PHAM_VI_GHI: readonly string[] = [
  // ── server/_core/systemRouter.ts (1) ──
  "server/_core/systemRouter.ts#systemRouter.marketplace.download",
  // ── server/routers/aiAdvancedRouter.ts (2) ──
  "server/routers/aiAdvancedRouter.ts#abTestRouter.runInference",
  "server/routers/aiAdvancedRouter.ts#abTestRouter.submitFeedback",
  // ── server/routers/aiAdvancedVisionRouter.ts (1) ──
  "server/routers/aiAdvancedVisionRouter.ts#aiAdvancedVisionRouter.explainHeatmap",
  // ── server/routers/aiModelRouter.ts (3) ──
  "server/routers/aiModelRouter.ts#aiModelRouter.approveCard",
  "server/routers/aiModelRouter.ts#aiModelRouter.createCard",
  "server/routers/aiModelRouter.ts#aiModelRouter.updateCard",
  // ── server/routers/alertEscalationRouter.ts (4) ──
  "server/routers/alertEscalationRouter.ts#alertEscalationRouter.create",
  "server/routers/alertEscalationRouter.ts#alertEscalationRouter.delete",
  "server/routers/alertEscalationRouter.ts#alertEscalationRouter.toggle",
  "server/routers/alertEscalationRouter.ts#alertEscalationRouter.update",
  // ── server/routers/alertRouters.ts (7) ──
  // ── server/routers/apiKeyRouter.ts (4) ──
  "server/routers/apiKeyRouter.ts#apiKeyRouter.create",
  "server/routers/apiKeyRouter.ts#apiKeyRouter.delete",
  "server/routers/apiKeyRouter.ts#apiKeyRouter.revoke",
  "server/routers/apiKeyRouter.ts#apiKeyRouter.update",
  // ── server/routers/bomRouter.ts (10) ──
  "server/routers/bomRouter.ts#bomRouter.addLineItem",
  "server/routers/bomRouter.ts#bomRouter.archiveDefinition",
  "server/routers/bomRouter.ts#bomRouter.bulkAddLineItems",
  "server/routers/bomRouter.ts#bomRouter.createDefinition",
  "server/routers/bomRouter.ts#bomRouter.deleteLineItem",
  "server/routers/bomRouter.ts#bomRouter.updateDefinition",
  "server/routers/bomRouter.ts#bomRouter.updateLineItem",
  // ── server/routers/causalGraphRouter.ts (4) ──
  "server/routers/causalGraphRouter.ts#causalGraphRouter.addNode",
  "server/routers/causalGraphRouter.ts#causalGraphRouter.deleteNode",
  "server/routers/causalGraphRouter.ts#causalGraphRouter.replaceGraph",
  "server/routers/causalGraphRouter.ts#causalGraphRouter.updateNode",
  // ── server/routers/componentLibraryRouter.ts (7) ──
  "server/routers/componentLibraryRouter.ts#componentLibraryRouter.footprints.create",
  "server/routers/componentLibraryRouter.ts#componentLibraryRouter.footprints.delete",
  "server/routers/componentLibraryRouter.ts#componentLibraryRouter.footprints.update",
  "server/routers/componentLibraryRouter.ts#componentLibraryRouter.linkMaterial",
  "server/routers/componentLibraryRouter.ts#componentLibraryRouter.packages.delete",
  "server/routers/componentLibraryRouter.ts#componentLibraryRouter.packages.restore",
  "server/routers/componentLibraryRouter.ts#componentLibraryRouter.packages.update",
  // ── server/routers/dashboardStatsRouters.ts (1) ──
  "server/routers/dashboardStatsRouters.ts#dashboardRouter.applyTemplate",
  // ── server/routers/dataRouters.ts (6) ──
  "server/routers/dataRouters.ts#exportRouter.exportMeasurementPoints",
  "server/routers/dataRouters.ts#importRouter.importLines",
  "server/routers/dataRouters.ts#importRouter.importMachines",
  "server/routers/dataRouters.ts#importRouter.importStations",
  "server/routers/dataRouters.ts#importRouter.importWorkshops",
  "server/routers/dataRouters.ts#importRouter.importWorkstations",
  // ── server/routers/defectDispositionRouter.ts (3) ──
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
  // ── server/routers/inspectionVariantRouter.ts (1) ──
  "server/routers/inspectionVariantRouter.ts#inspectionVariantRouter.setVariant",
  // ── server/routers/layoutRouters.ts (6) ──
  // ── server/routers/licenseRouter.ts (2) ──
  "server/routers/licenseRouter.ts#publicLicenseRouter.floatingCheckin",
  "server/routers/licenseRouter.ts#publicLicenseRouter.floatingHeartbeat",
  // ── server/routers/machineApiRouters.ts (2) ──
  "server/routers/machineApiRouters.ts#machineApiRouter.revokeKey",
  "server/routers/machineApiRouters.ts#machineApiRouter.submitProcessResult",
  // ── server/routers/maintenanceRouter.ts (4) ──
  // ── server/routers/maintenanceScheduleRouter.ts (4) ──
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
  // ── server/routers/msdRouter.ts (3) ──
  "server/routers/msdRouter.ts#msdRouter.closeExposure",
  "server/routers/msdRouter.ts#msdRouter.openExposure",
  "server/routers/msdRouter.ts#msdRouter.startBake",
  // ── server/routers/ncrRouter.ts (2) ──
  "server/routers/ncrRouter.ts#ncrRouter.create",
  "server/routers/ncrRouter.ts#ncrRouter.transition",
  // ── server/routers/ngRateThresholdRouter.ts (5) ──
  // ── server/routers/notificationRouters.ts (2) ──
  "server/routers/notificationRouters.ts#notificationRouter.delete",
  "server/routers/notificationRouters.ts#notificationRouter.markAsRead",
  // ── server/routers/operatorBadgeRouter.ts (2) ──
  "server/routers/operatorBadgeRouter.ts#operatorBadgeRouter.revoke",
  "server/routers/operatorBadgeRouter.ts#operatorBadgeRouter.update",
  // ── server/routers/parameterGuardrailRouter.ts (2) ──
  "server/routers/parameterGuardrailRouter.ts#parameterGuardrailRouter.delete",
  "server/routers/parameterGuardrailRouter.ts#parameterGuardrailRouter.set",
  // ── server/routers/pdfReportRouter.ts (1) ──
  "server/routers/pdfReportRouter.ts#pdfReportRouter.generateInspectionPDF",
  // ── server/routers/processResultRouter.ts (1) ──
  // ── server/routers/processRouter.ts (7) ──
  // ── server/routers/productOnboardingRouter.ts (3) ──
  "server/routers/productOnboardingRouter.ts#productOnboardingRouter.complete",
  "server/routers/productOnboardingRouter.ts#productOnboardingRouter.deleteDraft",
  "server/routers/productOnboardingRouter.ts#productOnboardingRouter.saveDraft",
  // ── server/routers/productPanelRouter.ts (4) ──
  // ── server/routers/productVariantRouter.ts (3) ──
  // ── server/routers/programmingRouter.ts (16) ──
  // ── server/routers/qualityGateTemplateRouter.ts (3) ──
  "server/routers/qualityGateTemplateRouter.ts#qualityGateTemplateRouter.applyToLine",
  "server/routers/qualityGateTemplateRouter.ts#qualityGateTemplateRouter.deleteCustom",
  "server/routers/qualityGateTemplateRouter.ts#qualityGateTemplateRouter.updateCustom",
  // ── server/routers/reportArtifactRouter.ts (1) ──
  "server/routers/reportArtifactRouter.ts#reportArtifactRouter.delete",
  // ── server/routers/reportBuilderRouter.ts (3) ──
  "server/routers/reportBuilderRouter.ts#reportBuilderRouter.duplicate",
  "server/routers/reportBuilderRouter.ts#reportBuilderRouter.save",
  "server/routers/reportBuilderRouter.ts#reportBuilderRouter.update",
  // ── server/routers/secsGemRouter.ts (1) ──
  "server/routers/secsGemRouter.ts#secsGemRouter.testConnection",
  // ── server/routers/sessionRouter.ts (1) ──
  "server/routers/sessionRouter.ts#sessionRouter.revoke",
  // ── server/routers/shiftConfigRouter.ts (3) ──
  // ── server/routers/simTargetsRouter.ts (1) ──
  "server/routers/simTargetsRouter.ts#simTargetsRouter.validateUrscript",
  // ── server/routers/stationTriangulationRouter.ts (2) ──
  "server/routers/stationTriangulationRouter.ts#stationTriangulationRouter.recomputeForLot",
  "server/routers/stationTriangulationRouter.ts#stationTriangulationRouter.recomputeForSerial",
  // ── server/routers/stencilRouter.ts (1) ──
  "server/routers/stencilRouter.ts#stencilRouter.recordPrints",
  // ── server/routers/systemRouters.ts (5) ──
  // ── server/routers/thresholdApprovalRouter.ts (6) ──
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
  // ── W13 (kiểm định phamViGhi, 2026-10-25): danh mục DÙNG CHUNG và cấu hình SỞ HỮU THEO NGƯỜI DÙNG ──
  "server/routers/processRouter.ts#processRouter.update": "danh mục quy trình (processes) DÙNG CHUNG toàn tập đoàn — bảng không có cột nhà máy; chỉ giữ bằng quyền settings_factory (luật chủ dự án 2026-10-24: danh mục dùng chung ⇒ miễn trừ). Gán quy trình vào chuyền (theo nhà máy) đã có cổng + test phamViGhiDoW13",
  "server/routers/processRouter.ts#processRouter.delete": "danh mục quy trình DÙNG CHUNG toàn tập đoàn (xem processRouter.update) — quyền settings_factory.canDelete; gán quy trình–chuyền theo nhà máy có cổng riêng",
  "server/routers/processRouter.ts#processRouter.reorder": "sắp xếp danh mục quy trình DÙNG CHUNG toàn tập đoàn (xem processRouter.update) — quyền settings_factory.canEdit",
  "server/routers/alertRouters.ts#alertRouter.update": "cài đặt cảnh báo SỞ HỮU THEO NGƯỜI DÙNG: chỉ chủ (alert.userId === ctx.user.id) hoặc admin sửa (mã: alertRouters.ts update — kiểm sở hữu trước khi ghi); máy / nhà máy của cảnh báo đã được kiểm phạm vi lúc TẠO (create có cổng + test phamViGhiDoW13)",
  "server/routers/alertRouters.ts#alertRouter.delete": "cài đặt cảnh báo SỞ HỮU THEO NGƯỜI DÙNG: chủ hoặc admin (xem alertRouter.update); id của người khác ⇒ FORBIDDEN trước khi ghi",
  "server/routers/alertRouters.ts#alertRouter.acknowledge": "xác nhận bản ghi lịch sử cảnh báo: phân giải về cài đặt cha, chỉ chủ hoặc admin (xem alertRouter.update)",
  "server/routers/alertRouters.ts#alertRouter.test": "gửi thử cảnh báo của CHÍNH người gọi: chủ hoặc admin (xem alertRouter.update); chỉ gửi tới chủ cảnh báo",
  "server/routers/alertRouters.ts#yieldThresholdRouter.update": "ngưỡng yield là cấu hình TOÀN CỤC (bảng yield_alert_thresholds không có cột nhà máy / máy); giữ bằng write-floor + settings_yield_thresholds.canEdit — cùng quyết định với tool AI set_yield_threshold",
  "server/routers/alertRouters.ts#yieldThresholdRouter.updateWithHistory": "ngưỡng yield TOÀN CỤC (xem yieldThresholdRouter.update) — write-floor + settings_yield_thresholds.canEdit, có lịch sử thay đổi",
  // ── Phạm vi QUA CỔNG TOOL kiemPhamViGhiTool (aiLocalTools/phamViGhi.ts) — mỗi mục có test DB cấp THỦ TỤC, gỡ cổng ⇒ đỏ (dieu-phoi 2026-10-25) ──
  "server/routers/aiRcaCopilotRouter.ts#aiRcaCopilotRouter.applyTopFix": "phạm vi qua cổng tool kiemPhamViGhiTool (create_maintenance_workorder … khoá machineId thật) — chứng minh: phamViGhiDoW11c.db.test.ts 'aiRcaCopilot.applyTopFix' (A→được, B→OUT_OF_SCOPE, đột biến 3/3 đỏ) — 2026-10-25. Id phân tích nhà máy khác ≡ id không có thật (cùng NOT_FOUND, có test)",
  "server/routers/aiThresholdAdvisorRouter.ts#aiThresholdAdvisorRouter.applyNgThreshold": "phạm vi qua cổng tool kiemPhamViGhiTool (adjust_ng_threshold, khoá thresholdId → trạm / máy / điểm đo / sản phẩm) — chứng minh: phamViGhiDoW11c.db.test.ts 'aiThresholdAdvisor.applyNgThreshold' (A→được, B→OUT_OF_SCOPE, đột biến đỏ) — 2026-10-25",
  "server/routers/aiVisionRouter.ts#aiVisionRouter.proposeDefect": "phạm vi qua cổng tool kiemPhamViGhiTool (propose_defect_from_vision, khoá inspectionId / measurementResultId → máy của lần kiểm tra) — chứng minh: phamViGhiDoW11c.db.test.ts 'aiVision.proposeDefect' (A→được, B và measurementResult B→OUT_OF_SCOPE, đột biến đỏ) — 2026-10-25",
  "server/routers/aiAgentRouter.ts#aiAgentRouter.approvePlan":
    "Sở hữu theo NGƯỜI DÙNG (không phải dữ liệu nhà máy): phiên agent / hội thoại / hành động chờ duyệt (HITL) chỉ chủ của nó thao tác — aiAgentOrchestrator.loadOwned, aiCopilotActions.confirmAction/cancelAction kiểm `row.userId === user.id` + token gắn userId, aiChat khoá theo userId; hành động ghi sau khi duyệt chạy dưới RBAC của người dùng (phạm vi nhà máy của TOOL GHI do AI đề xuất là hạng mục đo riêng — W11c). Đã đọc mã (2026-10-25); KHÔNG đổi hành vi agent / trợ lý.",
  "server/routers/aiAgentRouter.ts#aiAgentRouter.confirmStep":
    "Sở hữu theo NGƯỜI DÙNG (không phải dữ liệu nhà máy): phiên agent / hội thoại / hành động chờ duyệt (HITL) chỉ chủ của nó thao tác — aiAgentOrchestrator.loadOwned, aiCopilotActions.confirmAction/cancelAction kiểm `row.userId === user.id` + token gắn userId, aiChat khoá theo userId; hành động ghi sau khi duyệt chạy dưới RBAC của người dùng (phạm vi nhà máy của TOOL GHI do AI đề xuất là hạng mục đo riêng — W11c). Đã đọc mã (2026-10-25); KHÔNG đổi hành vi agent / trợ lý.",
  "server/routers/aiAgentRouter.ts#aiAgentRouter.cancelSession":
    "Sở hữu theo NGƯỜI DÙNG (không phải dữ liệu nhà máy): phiên agent / hội thoại / hành động chờ duyệt (HITL) chỉ chủ của nó thao tác — aiAgentOrchestrator.loadOwned, aiCopilotActions.confirmAction/cancelAction kiểm `row.userId === user.id` + token gắn userId, aiChat khoá theo userId; hành động ghi sau khi duyệt chạy dưới RBAC của người dùng (phạm vi nhà máy của TOOL GHI do AI đề xuất là hạng mục đo riêng — W11c). Đã đọc mã (2026-10-25); KHÔNG đổi hành vi agent / trợ lý.",
  "server/routers/aiAgentRouter.ts#aiAgentRouter.startPlaybook":
    "Sở hữu theo NGƯỜI DÙNG (không phải dữ liệu nhà máy): phiên agent / hội thoại / hành động chờ duyệt (HITL) chỉ chủ của nó thao tác — aiAgentOrchestrator.loadOwned, aiCopilotActions.confirmAction/cancelAction kiểm `row.userId === user.id` + token gắn userId, aiChat khoá theo userId; hành động ghi sau khi duyệt chạy dưới RBAC của người dùng (phạm vi nhà máy của TOOL GHI do AI đề xuất là hạng mục đo riêng — W11c). Đã đọc mã (2026-10-25); KHÔNG đổi hành vi agent / trợ lý.",
  "server/routers/aiAgentRouter.ts#aiAgentRouter.duyet":
    "Sở hữu theo NGƯỜI DÙNG (không phải dữ liệu nhà máy): phiên agent / hội thoại / hành động chờ duyệt (HITL) chỉ chủ của nó thao tác — aiAgentOrchestrator.loadOwned, aiCopilotActions.confirmAction/cancelAction kiểm `row.userId === user.id` + token gắn userId, aiChat khoá theo userId; hành động ghi sau khi duyệt chạy dưới RBAC của người dùng (phạm vi nhà máy của TOOL GHI do AI đề xuất là hạng mục đo riêng — W11c). Đã đọc mã (2026-10-25); KHÔNG đổi hành vi agent / trợ lý.",
  "server/routers/aiAgentRouter.ts#aiAgentRouter.bac":
    "Sở hữu theo NGƯỜI DÙNG (không phải dữ liệu nhà máy): phiên agent / hội thoại / hành động chờ duyệt (HITL) chỉ chủ của nó thao tác — aiAgentOrchestrator.loadOwned, aiCopilotActions.confirmAction/cancelAction kiểm `row.userId === user.id` + token gắn userId, aiChat khoá theo userId; hành động ghi sau khi duyệt chạy dưới RBAC của người dùng (phạm vi nhà máy của TOOL GHI do AI đề xuất là hạng mục đo riêng — W11c). Đã đọc mã (2026-10-25); KHÔNG đổi hành vi agent / trợ lý.",
  "server/routers/aiAgentRouter.ts#aiAgentRouter.hoanTac":
    "Sở hữu theo NGƯỜI DÙNG (không phải dữ liệu nhà máy): phiên agent / hội thoại / hành động chờ duyệt (HITL) chỉ chủ của nó thao tác — aiAgentOrchestrator.loadOwned, aiCopilotActions.confirmAction/cancelAction kiểm `row.userId === user.id` + token gắn userId, aiChat khoá theo userId; hành động ghi sau khi duyệt chạy dưới RBAC của người dùng (phạm vi nhà máy của TOOL GHI do AI đề xuất là hạng mục đo riêng — W11c). Đã đọc mã (2026-10-25); KHÔNG đổi hành vi agent / trợ lý.",
  "server/routers/aiAgentRouter.ts#aiAgentRouter.nhoDeXuat":
    "Sở hữu theo NGƯỜI DÙNG (không phải dữ liệu nhà máy): phiên agent / hội thoại / hành động chờ duyệt (HITL) chỉ chủ của nó thao tác — aiAgentOrchestrator.loadOwned, aiCopilotActions.confirmAction/cancelAction kiểm `row.userId === user.id` + token gắn userId, aiChat khoá theo userId; hành động ghi sau khi duyệt chạy dưới RBAC của người dùng (phạm vi nhà máy của TOOL GHI do AI đề xuất là hạng mục đo riêng — W11c). Đã đọc mã (2026-10-25); KHÔNG đổi hành vi agent / trợ lý.",
  "server/routers/aiAgentRouter.ts#aiAgentRouter.boDeXuat":
    "Sở hữu theo NGƯỜI DÙNG (không phải dữ liệu nhà máy): phiên agent / hội thoại / hành động chờ duyệt (HITL) chỉ chủ của nó thao tác — aiAgentOrchestrator.loadOwned, aiCopilotActions.confirmAction/cancelAction kiểm `row.userId === user.id` + token gắn userId, aiChat khoá theo userId; hành động ghi sau khi duyệt chạy dưới RBAC của người dùng (phạm vi nhà máy của TOOL GHI do AI đề xuất là hạng mục đo riêng — W11c). Đã đọc mã (2026-10-25); KHÔNG đổi hành vi agent / trợ lý.",
  "server/routers/aiAgentRouter.ts#aiAgentRouter.phanHoi":
    "Sở hữu theo NGƯỜI DÙNG (không phải dữ liệu nhà máy): phiên agent / hội thoại / hành động chờ duyệt (HITL) chỉ chủ của nó thao tác — aiAgentOrchestrator.loadOwned, aiCopilotActions.confirmAction/cancelAction kiểm `row.userId === user.id` + token gắn userId, aiChat khoá theo userId; hành động ghi sau khi duyệt chạy dưới RBAC của người dùng (phạm vi nhà máy của TOOL GHI do AI đề xuất là hạng mục đo riêng — W11c). Đã đọc mã (2026-10-25); KHÔNG đổi hành vi agent / trợ lý.",
  "server/routers/aiAnalysisHubRouter.ts#aiAnalysisHubRouter.imageDefectDescription":
    "Tính toán / suy luận LLM-VLM thuần trên dữ liệu người dùng đưa vào (machineCode chỉ là nhãn trong prompt); không đọc hay ghi bảng nhà máy.",
  "server/routers/aiAnalysisHubRouter.ts#aiAnalysisHubRouter.similarDefectSearch":
    "Tính toán / suy luận LLM-VLM thuần trên dữ liệu người dùng đưa vào (machineCode chỉ là nhãn trong prompt); không đọc hay ghi bảng nhà máy.",
  "server/routers/aiAnalysisHubRouter.ts#aiAnalysisHubRouter.quickQualityCheck":
    "Tính toán / suy luận LLM-VLM thuần trên dữ liệu người dùng đưa vào (machineCode chỉ là nhãn trong prompt); không đọc hay ghi bảng nhà máy.",
  "server/routers/aiAnomalyRouter.ts#aiAnomalyRouter.score":
    "Chấm điểm bất thường một ảnh do người dùng đưa vào; machineId / productModelId chỉ chọn hồ sơ model, không đọc dữ liệu nhà máy trả về.",
  "server/routers/aiChatRouter.ts#aiChatRouter.updateConversation":
    "Sở hữu theo NGƯỜI DÙNG (không phải dữ liệu nhà máy): phiên agent / hội thoại / hành động chờ duyệt (HITL) chỉ chủ của nó thao tác — aiAgentOrchestrator.loadOwned, aiCopilotActions.confirmAction/cancelAction kiểm `row.userId === user.id` + token gắn userId, aiChat khoá theo userId; hành động ghi sau khi duyệt chạy dưới RBAC của người dùng (phạm vi nhà máy của TOOL GHI do AI đề xuất là hạng mục đo riêng — W11c). Đã đọc mã (2026-10-25); KHÔNG đổi hành vi agent / trợ lý.",
  "server/routers/aiChatRouter.ts#aiChatRouter.deleteConversation":
    "Sở hữu theo NGƯỜI DÙNG (không phải dữ liệu nhà máy): phiên agent / hội thoại / hành động chờ duyệt (HITL) chỉ chủ của nó thao tác — aiAgentOrchestrator.loadOwned, aiCopilotActions.confirmAction/cancelAction kiểm `row.userId === user.id` + token gắn userId, aiChat khoá theo userId; hành động ghi sau khi duyệt chạy dưới RBAC của người dùng (phạm vi nhà máy của TOOL GHI do AI đề xuất là hạng mục đo riêng — W11c). Đã đọc mã (2026-10-25); KHÔNG đổi hành vi agent / trợ lý.",
  "server/routers/aiChatRouter.ts#aiChatRouter.deleteMessage":
    "Sở hữu theo NGƯỜI DÙNG (không phải dữ liệu nhà máy): phiên agent / hội thoại / hành động chờ duyệt (HITL) chỉ chủ của nó thao tác — aiAgentOrchestrator.loadOwned, aiCopilotActions.confirmAction/cancelAction kiểm `row.userId === user.id` + token gắn userId, aiChat khoá theo userId; hành động ghi sau khi duyệt chạy dưới RBAC của người dùng (phạm vi nhà máy của TOOL GHI do AI đề xuất là hạng mục đo riêng — W11c). Đã đọc mã (2026-10-25); KHÔNG đổi hành vi agent / trợ lý.",
  "server/routers/aiChatRouter.ts#aiChatRouter.chat":
    "Sở hữu theo NGƯỜI DÙNG (không phải dữ liệu nhà máy): phiên agent / hội thoại / hành động chờ duyệt (HITL) chỉ chủ của nó thao tác — aiAgentOrchestrator.loadOwned, aiCopilotActions.confirmAction/cancelAction kiểm `row.userId === user.id` + token gắn userId, aiChat khoá theo userId; hành động ghi sau khi duyệt chạy dưới RBAC của người dùng (phạm vi nhà máy của TOOL GHI do AI đề xuất là hạng mục đo riêng — W11c). Đã đọc mã (2026-10-25); KHÔNG đổi hành vi agent / trợ lý.",
  "server/routers/aiChatRouter.ts#aiChatRouter.saveStreamedMessage":
    "Sở hữu theo NGƯỜI DÙNG (không phải dữ liệu nhà máy): phiên agent / hội thoại / hành động chờ duyệt (HITL) chỉ chủ của nó thao tác — aiAgentOrchestrator.loadOwned, aiCopilotActions.confirmAction/cancelAction kiểm `row.userId === user.id` + token gắn userId, aiChat khoá theo userId; hành động ghi sau khi duyệt chạy dưới RBAC của người dùng (phạm vi nhà máy của TOOL GHI do AI đề xuất là hạng mục đo riêng — W11c). Đã đọc mã (2026-10-25); KHÔNG đổi hành vi agent / trợ lý.",
  "server/routers/aiChayUngDungRouter.ts#aiChayUngDungRouter.chay":
    "projectId của AI chạy ứng dụng phân giải qua DANH SÁCH TRẮNG THEO NGƯỜI GỌI (phanGiaiGoc, doc 79 trục 2) — tài nguyên thư mục dự án, không phải dữ liệu nhà máy.",
  "server/routers/aiChayUngDungRouter.ts#aiChayUngDungRouter.dung":
    "projectId của AI chạy ứng dụng phân giải qua DANH SÁCH TRẮNG THEO NGƯỜI GỌI (phanGiaiGoc, doc 79 trục 2) — tài nguyên thư mục dự án, không phải dữ liệu nhà máy.",
  "server/routers/aiChayUngDungRouter.ts#aiChayUngDungRouter.deXuatLenh":
    "projectId của AI chạy ứng dụng phân giải qua DANH SÁCH TRẮNG THEO NGƯỜI GỌI (phanGiaiGoc, doc 79 trục 2) — tài nguyên thư mục dự án, không phải dữ liệu nhà máy.",
  "server/routers/aiCopilotRouter.ts#aiCopilotRouter.confirmAction":
    "Sở hữu theo NGƯỜI DÙNG (không phải dữ liệu nhà máy): phiên agent / hội thoại / hành động chờ duyệt (HITL) chỉ chủ của nó thao tác — aiAgentOrchestrator.loadOwned, aiCopilotActions.confirmAction/cancelAction kiểm `row.userId === user.id` + token gắn userId, aiChat khoá theo userId; hành động ghi sau khi duyệt chạy dưới RBAC của người dùng (phạm vi nhà máy của TOOL GHI do AI đề xuất là hạng mục đo riêng — W11c). Đã đọc mã (2026-10-25); KHÔNG đổi hành vi agent / trợ lý.",
  "server/routers/aiCopilotRouter.ts#aiCopilotRouter.cancelAction":
    "Sở hữu theo NGƯỜI DÙNG (không phải dữ liệu nhà máy): phiên agent / hội thoại / hành động chờ duyệt (HITL) chỉ chủ của nó thao tác — aiAgentOrchestrator.loadOwned, aiCopilotActions.confirmAction/cancelAction kiểm `row.userId === user.id` + token gắn userId, aiChat khoá theo userId; hành động ghi sau khi duyệt chạy dưới RBAC của người dùng (phạm vi nhà máy của TOOL GHI do AI đề xuất là hạng mục đo riêng — W11c). Đã đọc mã (2026-10-25); KHÔNG đổi hành vi agent / trợ lý.",
  "server/routers/aiEvalRouter.ts#aiEvalRouter.evaluate":
    "Đánh giá / kiểm trôi MODEL (tài nguyên toàn cục `ai_models`, không cột nhà máy); không đụng dữ liệu nhà máy.",
  "server/routers/aiEvalRouter.ts#aiEvalRouter.driftCheck":
    "Đánh giá / kiểm trôi MODEL (tài nguyên toàn cục `ai_models`, không cột nhà máy); không đụng dữ liệu nhà máy.",
  "server/routers/aiGatewayTokenRouter.ts#aiGatewayTokenRouter.thuHoi":
    "Thu hồi token cổng AI của CHÍNH người gọi: thuHoiToken(u.id, id) lọc theo chủ token.",
  "server/routers/aiLocalKbRouter.ts#aiLocalKbRouter.feedback":
    "Ghi phản hồi câu trả lời KB của CHÍNH người gọi (recordAnswerFeedback userId = ctx.user.id); không có dữ liệu nhà máy.",
  "server/routers/aiLocalTrainingRouter.ts#aiLocalTrainingRouter.predict":
    "Suy luận model cục bộ trên dữ liệu người dùng đưa vào; không đọc / ghi bảng nhà máy.",
  "server/routers/aiRobotAnomalyRouter.ts#aiRobotAnomalyRouter.evaluateRollback":
    "Quay lui phiên bản MODEL (tài nguyên toàn cục, không cột nhà máy); đòi requirePermission(machine_control, canEdit) + quality gate eval (doc69 W0-2).",
  "server/routers/aiRobotAnomalyRouter.ts#aiRobotAnomalyRouter.manualRollback":
    "Quay lui phiên bản MODEL (tài nguyên toàn cục, không cột nhà máy); đòi requirePermission(machine_control, canEdit) + quality gate eval (doc69 W0-2).",
  "server/routers/aiSegmentationRouter.ts#aiSegmentationRouter.deleteMask":
    "deleteMask: chỉ người tạo mask hoặc admin (row.createdBy !== ctx.user.id && role !== admin ⇒ FORBIDDEN); runSegmentation: suy luận model trên ảnh người dùng đưa vào, không ghi bảng nhà máy.",
  "server/routers/aiSegmentationRouter.ts#aiSegmentationRouter.runSegmentation":
    "deleteMask: chỉ người tạo mask hoặc admin (row.createdBy !== ctx.user.id && role !== admin ⇒ FORBIDDEN); runSegmentation: suy luận model trên ảnh người dùng đưa vào, không ghi bảng nhà máy.",
  "server/routers/aiSettingsRouter.ts#aiSettingsRouter.cancelAiJob":
    "Huỷ job hàng đợi AI của CHÍNH người gọi: cancelJob(id, ctx.user.id) từ chối khi job.userId khác.",
  "server/routers/aiSpecialistAgentRouter.ts#aiSpecialistAgentRouter.run":
    "Phiên chuyên gia AI khoá theo userId của người gọi (completeAiSpecialistSession(sessionId, userId…)); thủ tục chạy model / ghi phản hồi trên phiên CỦA MÌNH. Đã đọc mã (2026-10-25).",
  "server/routers/aiSpecialistAgentRouter.ts#aiSpecialistAgentRouter.runWorkflowChain":
    "Phiên chuyên gia AI khoá theo userId của người gọi (completeAiSpecialistSession(sessionId, userId…)); thủ tục chạy model / ghi phản hồi trên phiên CỦA MÌNH. Đã đọc mã (2026-10-25).",
  "server/routers/aiSpecialistAgentRouter.ts#aiSpecialistAgentRouter.runModuleAudit":
    "Phiên chuyên gia AI khoá theo userId của người gọi (completeAiSpecialistSession(sessionId, userId…)); thủ tục chạy model / ghi phản hồi trên phiên CỦA MÌNH. Đã đọc mã (2026-10-25).",
  "server/routers/aiSpecialistAgentRouter.ts#aiSpecialistAgentRouter.submitFeedback":
    "Phiên chuyên gia AI khoá theo userId của người gọi (completeAiSpecialistSession(sessionId, userId…)); thủ tục chạy model / ghi phản hồi trên phiên CỦA MÌNH. Đã đọc mã (2026-10-25).",
  "server/routers/aiVisionLanguageRouter.ts#aiVisionLanguageRouter.describeDefect":
    "Suy luận VLM thuần trên dữ liệu người dùng đưa vào (machineCode là nhãn trong prompt); không đọc hay ghi bảng nhà máy.",
  "server/routers/aiVisionLanguageRouter.ts#aiVisionLanguageRouter.generateReport":
    "Suy luận VLM thuần trên dữ liệu người dùng đưa vào (machineCode là nhãn trong prompt); không đọc hay ghi bảng nhà máy.",
  "server/routers/kbStudioRouter.ts#kbStudioRouter.huyEvalMa":
    "KB Studio: tài nguyên toàn cục của vai kbStudioProcedure / kbStudioDeleteProcedure (sàn vai + 2FA); không có dữ liệu nhà máy.",
  "server/routers/kbStudioRouter.ts#kbStudioRouter.startFinetune":
    "KB Studio: tài nguyên toàn cục của vai kbStudioProcedure / kbStudioDeleteProcedure (sàn vai + 2FA); không có dữ liệu nhà máy.",
  "server/routers/mqttOeeRouters.ts#mqttAlertRouter.update":
    "Luật cảnh báo MQTT TOÀN CỤC (mqtt_alert_rules không có cột nhà máy) — danh mục dùng chung, chủ dự án duyệt 2026-10-25; từ lô W11 mọi thao tác đòi requirePermission(machine_alerts, canCreate|canEdit|canDelete) (trước đây chỉ đăng nhập). Bản ghi cảnh báo phát sinh (history) chỉ có ruleId — không gắn máy/trạm.",
  "server/routers/mqttOeeRouters.ts#mqttAlertRouter.delete":
    "Luật cảnh báo MQTT TOÀN CỤC (mqtt_alert_rules không có cột nhà máy) — danh mục dùng chung, chủ dự án duyệt 2026-10-25; từ lô W11 mọi thao tác đòi requirePermission(machine_alerts, canCreate|canEdit|canDelete) (trước đây chỉ đăng nhập). Bản ghi cảnh báo phát sinh (history) chỉ có ruleId — không gắn máy/trạm.",
  "server/routers/mqttOeeRouters.ts#mqttAlertRouter.toggle":
    "Luật cảnh báo MQTT TOÀN CỤC (mqtt_alert_rules không có cột nhà máy) — danh mục dùng chung, chủ dự án duyệt 2026-10-25; từ lô W11 mọi thao tác đòi requirePermission(machine_alerts, canCreate|canEdit|canDelete) (trước đây chỉ đăng nhập). Bản ghi cảnh báo phát sinh (history) chỉ có ruleId — không gắn máy/trạm.",
  "server/routers/mqttOeeRouters.ts#mqttAlertRouter.resolve":
    "Luật cảnh báo MQTT TOÀN CỤC (mqtt_alert_rules không có cột nhà máy) — danh mục dùng chung, chủ dự án duyệt 2026-10-25; từ lô W11 mọi thao tác đòi requirePermission(machine_alerts, canCreate|canEdit|canDelete) (trước đây chỉ đăng nhập). Bản ghi cảnh báo phát sinh (history) chỉ có ruleId — không gắn máy/trạm.",
  "server/routers/aiGgufRouter.ts#aiGgufRouter.generate":
    "Thủ tục TÍNH TOÁN LLM thuần: modelId là mã model trong danh sách trắng, machineCode / dữ liệu chất lượng là văn bản người dùng tự đưa vào prompt; không đọc hay ghi bảng nhà máy nào. Đã kiểm mã (2026-10-25).",
  "server/routers/aiGgufRouter.ts#aiGgufRouter.chat":
    "Thủ tục TÍNH TOÁN LLM thuần: modelId là mã model trong danh sách trắng, machineCode / dữ liệu chất lượng là văn bản người dùng tự đưa vào prompt; không đọc hay ghi bảng nhà máy nào. Đã kiểm mã (2026-10-25).",
  "server/routers/aiGgufRouter.ts#aiGgufRouter.analyzeDefect":
    "Thủ tục TÍNH TOÁN LLM thuần: modelId là mã model trong danh sách trắng, machineCode / dữ liệu chất lượng là văn bản người dùng tự đưa vào prompt; không đọc hay ghi bảng nhà máy nào. Đã kiểm mã (2026-10-25).",
  "server/routers/aiGgufRouter.ts#aiGgufRouter.qualityInsights":
    "Thủ tục TÍNH TOÁN LLM thuần: modelId là mã model trong danh sách trắng, machineCode / dữ liệu chất lượng là văn bản người dùng tự đưa vào prompt; không đọc hay ghi bảng nhà máy nào. Đã kiểm mã (2026-10-25).",
  "server/routers/aiGgufRouter.ts#aiGgufRouter.embedding":
    "Thủ tục TÍNH TOÁN LLM thuần: modelId là mã model trong danh sách trắng, machineCode / dữ liệu chất lượng là văn bản người dùng tự đưa vào prompt; không đọc hay ghi bảng nhà máy nào. Đã kiểm mã (2026-10-25).",
  "server/routers/dashboardWidgetRouters.ts#dashboardWidgetRouter.saveLayout":
    "Cấu hình GIAO DIỆN CÁ NHÂN của người dùng (bố cục, preset, dashboard tuỳ biến): ghi / xoá luôn khoá theo ctx.user.id (sở hữu), applySharedTemplate / applyStylePreset chỉ tăng bộ đếm dùng. Không có dữ liệu nhà máy. Đã kiểm mã (2026-10-25).",
  "server/routers/dashboardWidgetRouters.ts#dashboardWidgetRouter.applySharedTemplate":
    "Cấu hình GIAO DIỆN CÁ NHÂN của người dùng (bố cục, preset, dashboard tuỳ biến): ghi / xoá luôn khoá theo ctx.user.id (sở hữu), applySharedTemplate / applyStylePreset chỉ tăng bộ đếm dùng. Không có dữ liệu nhà máy. Đã kiểm mã (2026-10-25).",
  "server/routers/dashboardWidgetRouters.ts#dashboardWidgetRouter.updateStylePreset":
    "Cấu hình GIAO DIỆN CÁ NHÂN của người dùng (bố cục, preset, dashboard tuỳ biến): ghi / xoá luôn khoá theo ctx.user.id (sở hữu), applySharedTemplate / applyStylePreset chỉ tăng bộ đếm dùng. Không có dữ liệu nhà máy. Đã kiểm mã (2026-10-25).",
  "server/routers/dashboardWidgetRouters.ts#dashboardWidgetRouter.deleteStylePreset":
    "Cấu hình GIAO DIỆN CÁ NHÂN của người dùng (bố cục, preset, dashboard tuỳ biến): ghi / xoá luôn khoá theo ctx.user.id (sở hữu), applySharedTemplate / applyStylePreset chỉ tăng bộ đếm dùng. Không có dữ liệu nhà máy. Đã kiểm mã (2026-10-25).",
  "server/routers/dashboardWidgetRouters.ts#dashboardWidgetRouter.applyStylePreset":
    "Cấu hình GIAO DIỆN CÁ NHÂN của người dùng (bố cục, preset, dashboard tuỳ biến): ghi / xoá luôn khoá theo ctx.user.id (sở hữu), applySharedTemplate / applyStylePreset chỉ tăng bộ đếm dùng. Không có dữ liệu nhà máy. Đã kiểm mã (2026-10-25).",
  "server/routers/dashboardWidgetRouters.ts#dashboardWidgetRouter.cloneSharedPreset":
    "Cấu hình GIAO DIỆN CÁ NHÂN của người dùng (bố cục, preset, dashboard tuỳ biến): ghi / xoá luôn khoá theo ctx.user.id (sở hữu), applySharedTemplate / applyStylePreset chỉ tăng bộ đếm dùng. Không có dữ liệu nhà máy. Đã kiểm mã (2026-10-25).",
  "server/routers/dashboardWidgetRouters.ts#dashboardWidgetRouter.createCustomDashboard":
    "Cấu hình GIAO DIỆN CÁ NHÂN của người dùng (bố cục, preset, dashboard tuỳ biến): ghi / xoá luôn khoá theo ctx.user.id (sở hữu), applySharedTemplate / applyStylePreset chỉ tăng bộ đếm dùng. Không có dữ liệu nhà máy. Đã kiểm mã (2026-10-25).",
  "server/routers/dashboardWidgetRouters.ts#dashboardWidgetRouter.updateCustomDashboard":
    "Cấu hình GIAO DIỆN CÁ NHÂN của người dùng (bố cục, preset, dashboard tuỳ biến): ghi / xoá luôn khoá theo ctx.user.id (sở hữu), applySharedTemplate / applyStylePreset chỉ tăng bộ đếm dùng. Không có dữ liệu nhà máy. Đã kiểm mã (2026-10-25).",
  "server/routers/dashboardWidgetRouters.ts#dashboardWidgetRouter.deleteCustomDashboard":
    "Cấu hình GIAO DIỆN CÁ NHÂN của người dùng (bố cục, preset, dashboard tuỳ biến): ghi / xoá luôn khoá theo ctx.user.id (sở hữu), applySharedTemplate / applyStylePreset chỉ tăng bộ đếm dùng. Không có dữ liệu nhà máy. Đã kiểm mã (2026-10-25).",
  "server/routers/dashboardWidgetRouters.ts#dashboardWidgetRouter.duplicateCustomDashboard":
    "Cấu hình GIAO DIỆN CÁ NHÂN của người dùng (bố cục, preset, dashboard tuỳ biến): ghi / xoá luôn khoá theo ctx.user.id (sở hữu), applySharedTemplate / applyStylePreset chỉ tăng bộ đếm dùng. Không có dữ liệu nhà máy. Đã kiểm mã (2026-10-25).",
  "server/routers/dashboardWidgetRouters.ts#dashboardWidgetRouter.toggleCustomDashboardFavorite":
    "Cấu hình GIAO DIỆN CÁ NHÂN của người dùng (bố cục, preset, dashboard tuỳ biến): ghi / xoá luôn khoá theo ctx.user.id (sở hữu), applySharedTemplate / applyStylePreset chỉ tăng bộ đếm dùng. Không có dữ liệu nhà máy. Đã kiểm mã (2026-10-25).",
  "server/routers/dashboardWidgetRouters.ts#dashboardWidgetRouter.toggleCustomDashboardPublic":
    "Cấu hình GIAO DIỆN CÁ NHÂN của người dùng (bố cục, preset, dashboard tuỳ biến): ghi / xoá luôn khoá theo ctx.user.id (sở hữu), applySharedTemplate / applyStylePreset chỉ tăng bộ đếm dùng. Không có dữ liệu nhà máy. Đã kiểm mã (2026-10-25).",
  "server/routers/dashboardWidgetRouters.ts#dashboardWidgetRouter.saveCustomDashboardAsTemplate":
    "Cấu hình GIAO DIỆN CÁ NHÂN của người dùng (bố cục, preset, dashboard tuỳ biến): ghi / xoá luôn khoá theo ctx.user.id (sở hữu), applySharedTemplate / applyStylePreset chỉ tăng bộ đếm dùng. Không có dữ liệu nhà máy. Đã kiểm mã (2026-10-25).",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.deXuatThayTheLo":
    "Tài nguyên của AI coding workspace, KHÔNG phải dữ liệu nhà máy: `projectId` là gốc thư mục được phân giải qua DANH SÁCH TRẮNG THEO NGƯỜI GỌI (phanGiaiGoc / moRepoGit, doc 79 trục 2; id lạ ⇒ PROJECT_NOT_FOUND, fail-closed); phiên / dự án cá nhân / bài học lọc theo userId của chính người gọi (congPhien → userId). Đã kiểm mã từng thủ tục (2026-10-25).",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.deXuatSuaTay":
    "Tài nguyên của AI coding workspace, KHÔNG phải dữ liệu nhà máy: `projectId` là gốc thư mục được phân giải qua DANH SÁCH TRẮNG THEO NGƯỜI GỌI (phanGiaiGoc / moRepoGit, doc 79 trục 2; id lạ ⇒ PROJECT_NOT_FOUND, fail-closed); phiên / dự án cá nhân / bài học lọc theo userId của chính người gọi (congPhien → userId). Đã kiểm mã từng thủ tục (2026-10-25).",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.chayKiemChung":
    "Tài nguyên của AI coding workspace, KHÔNG phải dữ liệu nhà máy: `projectId` là gốc thư mục được phân giải qua DANH SÁCH TRẮNG THEO NGƯỜI GỌI (phanGiaiGoc / moRepoGit, doc 79 trục 2; id lạ ⇒ PROJECT_NOT_FOUND, fail-closed); phiên / dự án cá nhân / bài học lọc theo userId của chính người gọi (congPhien → userId). Đã kiểm mã từng thủ tục (2026-10-25).",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.luuPhien":
    "Tài nguyên của AI coding workspace, KHÔNG phải dữ liệu nhà máy: `projectId` là gốc thư mục được phân giải qua DANH SÁCH TRẮNG THEO NGƯỜI GỌI (phanGiaiGoc / moRepoGit, doc 79 trục 2; id lạ ⇒ PROJECT_NOT_FOUND, fail-closed); phiên / dự án cá nhân / bài học lọc theo userId của chính người gọi (congPhien → userId). Đã kiểm mã từng thủ tục (2026-10-25).",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.xoaPhien":
    "Tài nguyên của AI coding workspace, KHÔNG phải dữ liệu nhà máy: `projectId` là gốc thư mục được phân giải qua DANH SÁCH TRẮNG THEO NGƯỜI GỌI (phanGiaiGoc / moRepoGit, doc 79 trục 2; id lạ ⇒ PROJECT_NOT_FOUND, fail-closed); phiên / dự án cá nhân / bài học lọc theo userId của chính người gọi (congPhien → userId). Đã kiểm mã từng thủ tục (2026-10-25).",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.doiTenDuAnCaNhan":
    "Tài nguyên của AI coding workspace, KHÔNG phải dữ liệu nhà máy: `projectId` là gốc thư mục được phân giải qua DANH SÁCH TRẮNG THEO NGƯỜI GỌI (phanGiaiGoc / moRepoGit, doc 79 trục 2; id lạ ⇒ PROJECT_NOT_FOUND, fail-closed); phiên / dự án cá nhân / bài học lọc theo userId của chính người gọi (congPhien → userId). Đã kiểm mã từng thủ tục (2026-10-25).",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.xoaDuAnCaNhan":
    "Tài nguyên của AI coding workspace, KHÔNG phải dữ liệu nhà máy: `projectId` là gốc thư mục được phân giải qua DANH SÁCH TRẮNG THEO NGƯỜI GỌI (phanGiaiGoc / moRepoGit, doc 79 trục 2; id lạ ⇒ PROJECT_NOT_FOUND, fail-closed); phiên / dự án cá nhân / bài học lọc theo userId của chính người gọi (congPhien → userId). Đã kiểm mã từng thủ tục (2026-10-25).",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.gitCommit":
    "Tài nguyên của AI coding workspace, KHÔNG phải dữ liệu nhà máy: `projectId` là gốc thư mục được phân giải qua DANH SÁCH TRẮNG THEO NGƯỜI GỌI (phanGiaiGoc / moRepoGit, doc 79 trục 2; id lạ ⇒ PROJECT_NOT_FOUND, fail-closed); phiên / dự án cá nhân / bài học lọc theo userId của chính người gọi (congPhien → userId). Đã kiểm mã từng thủ tục (2026-10-25).",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.gitTaoNhanh":
    "Tài nguyên của AI coding workspace, KHÔNG phải dữ liệu nhà máy: `projectId` là gốc thư mục được phân giải qua DANH SÁCH TRẮNG THEO NGƯỜI GỌI (phanGiaiGoc / moRepoGit, doc 79 trục 2; id lạ ⇒ PROJECT_NOT_FOUND, fail-closed); phiên / dự án cá nhân / bài học lọc theo userId của chính người gọi (congPhien → userId). Đã kiểm mã từng thủ tục (2026-10-25).",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.gitChuyenNhanh":
    "Tài nguyên của AI coding workspace, KHÔNG phải dữ liệu nhà máy: `projectId` là gốc thư mục được phân giải qua DANH SÁCH TRẮNG THEO NGƯỜI GỌI (phanGiaiGoc / moRepoGit, doc 79 trục 2; id lạ ⇒ PROJECT_NOT_FOUND, fail-closed); phiên / dự án cá nhân / bài học lọc theo userId của chính người gọi (congPhien → userId). Đã kiểm mã từng thủ tục (2026-10-25).",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.gitGoiYThongDiep":
    "Tài nguyên của AI coding workspace, KHÔNG phải dữ liệu nhà máy: `projectId` là gốc thư mục được phân giải qua DANH SÁCH TRẮNG THEO NGƯỜI GỌI (phanGiaiGoc / moRepoGit, doc 79 trục 2; id lạ ⇒ PROJECT_NOT_FOUND, fail-closed); phiên / dự án cá nhân / bài học lọc theo userId của chính người gọi (congPhien → userId). Đã kiểm mã từng thủ tục (2026-10-25).",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.deXuatXoaTep":
    "Tài nguyên của AI coding workspace, KHÔNG phải dữ liệu nhà máy: `projectId` là gốc thư mục được phân giải qua DANH SÁCH TRẮNG THEO NGƯỜI GỌI (phanGiaiGoc / moRepoGit, doc 79 trục 2; id lạ ⇒ PROJECT_NOT_FOUND, fail-closed); phiên / dự án cá nhân / bài học lọc theo userId của chính người gọi (congPhien → userId). Đã kiểm mã từng thủ tục (2026-10-25).",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.deXuatDoiTenTep":
    "Tài nguyên của AI coding workspace, KHÔNG phải dữ liệu nhà máy: `projectId` là gốc thư mục được phân giải qua DANH SÁCH TRẮNG THEO NGƯỜI GỌI (phanGiaiGoc / moRepoGit, doc 79 trục 2; id lạ ⇒ PROJECT_NOT_FOUND, fail-closed); phiên / dự án cá nhân / bài học lọc theo userId của chính người gọi (congPhien → userId). Đã kiểm mã từng thủ tục (2026-10-25).",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.baiHocThem":
    "Tài nguyên của AI coding workspace, KHÔNG phải dữ liệu nhà máy: `projectId` là gốc thư mục được phân giải qua DANH SÁCH TRẮNG THEO NGƯỜI GỌI (phanGiaiGoc / moRepoGit, doc 79 trục 2; id lạ ⇒ PROJECT_NOT_FOUND, fail-closed); phiên / dự án cá nhân / bài học lọc theo userId của chính người gọi (congPhien → userId). Đã kiểm mã từng thủ tục (2026-10-25).",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.baiHocSua":
    "Tài nguyên của AI coding workspace, KHÔNG phải dữ liệu nhà máy: `projectId` là gốc thư mục được phân giải qua DANH SÁCH TRẮNG THEO NGƯỜI GỌI (phanGiaiGoc / moRepoGit, doc 79 trục 2; id lạ ⇒ PROJECT_NOT_FOUND, fail-closed); phiên / dự án cá nhân / bài học lọc theo userId của chính người gọi (congPhien → userId). Đã kiểm mã từng thủ tục (2026-10-25).",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.baiHocXoa":
    "Tài nguyên của AI coding workspace, KHÔNG phải dữ liệu nhà máy: `projectId` là gốc thư mục được phân giải qua DANH SÁCH TRẮNG THEO NGƯỜI GỌI (phanGiaiGoc / moRepoGit, doc 79 trục 2; id lạ ⇒ PROJECT_NOT_FOUND, fail-closed); phiên / dự án cá nhân / bài học lọc theo userId của chính người gọi (congPhien → userId). Đã kiểm mã từng thủ tục (2026-10-25).",
  "server/routers/repoWorkspaceRouter.ts#repoWorkspaceRouter.doiTenPhien":
    "Tài nguyên của AI coding workspace, KHÔNG phải dữ liệu nhà máy: `projectId` là gốc thư mục được phân giải qua DANH SÁCH TRẮNG THEO NGƯỜI GỌI (phanGiaiGoc / moRepoGit, doc 79 trục 2; id lạ ⇒ PROJECT_NOT_FOUND, fail-closed); phiên / dự án cá nhân / bài học lọc theo userId của chính người gọi (congPhien → userId). Đã kiểm mã từng thủ tục (2026-10-25).",
  "server/routers/masterDataRouter.ts#skillsRouter.update":
    "Danh mục CHUẨN DÙNG CHUNG toàn tập đoàn — chủ dự án duyệt 2026-10-24 (cùng nguyên tắc danh mục lỗi / loại phép đo; không có cột nhà máy); ghi cần masterdata/canEdit|canDelete (vai quản trị / kỹ sư), không chỉ đăng nhập.",
  "server/routers/masterDataRouter.ts#skillsRouter.delete":
    "Danh mục CHUẨN DÙNG CHUNG toàn tập đoàn — chủ dự án duyệt 2026-10-24 (cùng nguyên tắc danh mục lỗi / loại phép đo; không có cột nhà máy); ghi cần masterdata/canEdit|canDelete (vai quản trị / kỹ sư), không chỉ đăng nhập.",
  "server/routers/masterDataRouter.ts#uomRouter.update":
    "Danh mục CHUẨN DÙNG CHUNG toàn tập đoàn — chủ dự án duyệt 2026-10-24 (cùng nguyên tắc danh mục lỗi / loại phép đo; không có cột nhà máy); ghi cần masterdata/canEdit|canDelete (vai quản trị / kỹ sư), không chỉ đăng nhập.",
  "server/routers/masterDataRouter.ts#uomRouter.delete":
    "Danh mục CHUẨN DÙNG CHUNG toàn tập đoàn — chủ dự án duyệt 2026-10-24 (cùng nguyên tắc danh mục lỗi / loại phép đo; không có cột nhà máy); ghi cần masterdata/canEdit|canDelete (vai quản trị / kỹ sư), không chỉ đăng nhập.",
  "server/routers/masterDataRouter.ts#uomRouter.updateConversion":
    "Danh mục CHUẨN DÙNG CHUNG toàn tập đoàn — chủ dự án duyệt 2026-10-24 (cùng nguyên tắc danh mục lỗi / loại phép đo; không có cột nhà máy); ghi cần masterdata/canEdit|canDelete (vai quản trị / kỹ sư), không chỉ đăng nhập.",
  "server/routers/masterDataRouter.ts#uomRouter.deleteConversion":
    "Danh mục CHUẨN DÙNG CHUNG toàn tập đoàn — chủ dự án duyệt 2026-10-24 (cùng nguyên tắc danh mục lỗi / loại phép đo; không có cột nhà máy); ghi cần masterdata/canEdit|canDelete (vai quản trị / kỹ sư), không chỉ đăng nhập.",
  "server/routers/masterDataRouter.ts#materialsRouter.updateClass":
    "Danh mục CHUẨN DÙNG CHUNG toàn tập đoàn — chủ dự án duyệt 2026-10-24 (cùng nguyên tắc danh mục lỗi / loại phép đo; không có cột nhà máy); ghi cần masterdata/canEdit|canDelete (vai quản trị / kỹ sư), không chỉ đăng nhập.",
  "server/routers/masterDataRouter.ts#materialsRouter.deleteClass":
    "Danh mục CHUẨN DÙNG CHUNG toàn tập đoàn — chủ dự án duyệt 2026-10-24 (cùng nguyên tắc danh mục lỗi / loại phép đo; không có cột nhà máy); ghi cần masterdata/canEdit|canDelete (vai quản trị / kỹ sư), không chỉ đăng nhập.",
  "server/routers/safetyRouter.ts#safetyRouter.abortCollaboration":
    "Huỷ phiên cộng tác người–robot là hướng GIẢM năng lượng / an toàn ⇒ KHÔNG chặn theo nhà máy (chủ dự án duyệt 2026-10-24, nguyên tắc L-7 như robot.consoleStop). Vẫn đòi đăng nhập + machine_control/canCreate; abortCollaboration ghi sổ audit bất biến (ai · phiên nào · trước/sau, kèm factoryId của phiên). signalHandshake / advancePhase giữ cổng phạm vi.",
  "server/routers/robotRouter.ts#robotRouter.consoleStop":
    "Có cổng phạm vi RIÊNG cho STOP (stopScopeForActuate → decideStopScope, doc 81 Đợt 10 R-10-bc, nguyên tắc L-7): STOP là hướng GIẢM năng lượng nên chỉ bị từ chối khi BIẾT CHẮC hai phạm vi khác nhau; không biết ⇒ cho đi + cảnh báo + audit. Bộ quét không nhận ra cổng này theo tên; KHÔNG được siết thêm kẻo chặn một lệnh dừng khẩn cấp.",
  "server/routers/scadaCommandsRouter.ts#scadaCommandsRouter.huy":
    "Huỷ yêu cầu ghi của CHÍNH người gọi: huyYeuCauGhi → dongChoCuaNguoi(db, requestId, userId) chỉ tìm hàng chờ của userId đó (không phải của nhà máy/người khác); id lạ ≡ KHÔNG_THẤY_YÊU_CẦU. Khoá requestId là mã yêu cầu của chính người dùng, không phải định danh thực thể nhà máy.",
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
