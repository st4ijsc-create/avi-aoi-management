# Phân tầng 314 thủ tục tRPC nhóm (A) — đọc dữ liệu tenant không lọc phạm vi (2026-10-24)

> **Phân tầng SƠ BỘ bằng heuristic** (tên thủ tục + khoá `.input` + bảng chạm tới do bộ quét `phamViDocScan` ghi nhận) — CHƯA đọc từng thủ tục; dùng để xếp lô, không phải kết luận an ninh. Mỗi lô vá sẽ đọc lại từng thủ tục và đo đỏ trước khi vá.
>
> Nhóm (A) chỉ gồm thủ tục **.query**. Mutation nằm ở nhóm (D, 1 198 thủ tục) — bộ quét KHÔNG kiểm phạm vi ghi của chúng (xem mục "Ghi chú" cuối).

- **T1** — dữ liệu thô / chi tiết / xuất / tải tệp theo id từ client (ưu tiên cao nhất)
- **T2** — danh sách / tổng hợp trộn mọi nhà máy
- **T3** — danh mục dùng chung thật hoặc dữ liệu không mang nhà máy (đề xuất MIỄN TRỪ có lý do)

Tổng: **T1 74 · T2 211 · T3 29** (314).

## Theo router

| router | T1 | T2 | T3 |
|---|---:|---:|---:|
| aoiPackage | 5 | 3 | 0 |
| defectDisposition | 4 | 3 | 0 |
| inspection | 3 | 2 | 0 |
| sop | 3 | 2 | 0 |
| edgeDeployment | 3 | 1 | 0 |
| ir | 3 | 1 | 0 |
| predictiveMaintenance | 3 | 1 | 0 |
| programming | 2 | 7 | 0 |
| aiAdvanced | 2 | 5 | 0 |
| annotation | 2 | 5 | 0 |
| bom | 2 | 3 | 0 |
| mqttBulletin | 2 | 3 | 0 |
| annotationComparison | 2 | 2 | 0 |
| aoiOnboarding | 2 | 2 | 0 |
| inspectionProgram | 2 | 2 | 0 |
| equipment | 2 | 1 | 0 |
| interlock | 2 | 1 | 0 |
| orderLifecycle | 2 | 1 | 0 |
| productionSession | 2 | 1 | 0 |
| traceability | 2 | 0 | 0 |
| processResult | 1 | 6 | 0 |
| mqttClientManagement | 1 | 5 | 0 |
| goldenSample | 1 | 4 | 0 |
| parameterGuardrail | 1 | 4 | 0 |
| robot | 1 | 4 | 0 |
| ai | 1 | 3 | 0 |
| ngRateThreshold | 1 | 3 | 0 |
| aiCalibration | 1 | 2 | 0 |
| aiImageSearch | 1 | 2 | 0 |
| feederVerify | 1 | 2 | 0 |
| hotFolder | 1 | 2 | 0 |
| thresholdApproval | 1 | 2 | 0 |
| alert | 1 | 1 | 0 |
| ecn | 1 | 1 | 0 |
| layout | 1 | 1 | 0 |
| maintenanceSchedule | 1 | 1 | 0 |
| mqttNgAlertSettings | 1 | 1 | 0 |
| ncr | 1 | 1 | 0 |
| productVariant | 1 | 1 | 0 |
| sites | 1 | 1 | 0 |
| stencil | 1 | 1 | 0 |
| vda5050 | 1 | 1 | 0 |
| _core/system | 1 | 0 | 0 |
| twin | 1 | 0 | 1 |
| lineController | 0 | 8 | 0 |
| federation | 0 | 7 | 0 |
| aiActiveLearning | 0 | 6 | 0 |
| energy | 0 | 6 | 0 |
| paretoAnalysis | 0 | 6 | 0 |
| equipmentIntegration | 0 | 5 | 0 |
| productionDashboard | 0 | 5 | 0 |
| safety | 0 | 5 | 0 |
| aiQualityGate | 0 | 4 | 0 |
| hierarchyTree | 0 | 4 | 0 |
| wip | 0 | 4 | 0 |
| aiAnomaly | 0 | 3 | 1 |
| aiFeedback | 0 | 3 | 0 |
| aiSmartAlertRouting | 0 | 3 | 0 |
| aiThresholdAdvisor | 0 | 3 | 0 |
| erpAdmin | 0 | 3 | 0 |
| field | 0 | 3 | 0 |
| reportingMart | 0 | 3 | 0 |
| aiModel | 0 | 2 | 0 |
| aiOrchestration | 0 | 2 | 0 |
| aiRobotAnomaly | 0 | 2 | 0 |
| measurementCorrections | 0 | 2 | 0 |
| msd | 0 | 2 | 0 |
| process | 0 | 2 | 0 |
| realtimeReport | 0 | 2 | 0 |
| spcAnalysis | 0 | 2 | 0 |
| thresholdSuggestion | 0 | 2 | 0 |
| aiInsight | 0 | 1 | 0 |
| aiRcaCopilot | 0 | 1 | 0 |
| aiSegmentation | 0 | 1 | 0 |
| aiSetupAdvisor | 0 | 1 | 0 |
| apiKey | 0 | 1 | 0 |
| dashboardStats | 0 | 1 | 0 |
| edgeRuntime | 0 | 1 | 0 |
| hierarchy | 0 | 1 | 0 |
| machineApi | 0 | 1 | 0 |
| maintenance | 0 | 1 | 0 |
| mqttSoftwareVersion | 0 | 1 | 0 |
| ntfClassifier | 0 | 1 | 1 |
| oversight | 0 | 1 | 0 |
| simulation | 0 | 1 | 0 |
| stationTriangulation | 0 | 1 | 0 |
| system | 0 | 1 | 0 |
| user | 0 | 1 | 0 |
| aiEval | 0 | 0 | 1 |
| aiLocalTraining | 0 | 0 | 1 |
| aiSettings | 0 | 0 | 1 |
| componentLibrary | 0 | 0 | 1 |
| ecosystemAdmin | 0 | 0 | 1 |
| equipmentStandards | 0 | 0 | 8 |
| machineRecipe | 0 | 0 | 4 |
| permissions | 0 | 0 | 2 |
| semantics | 0 | 0 | 3 |
| shiftConfig | 0 | 0 | 2 |
| simTargets | 0 | 0 | 1 |
| systemHealth | 0 | 0 | 1 |

## Chi tiết từng thủ tục

### T1

- `aoiPackage.downloadZip` (packageId)
- `aoiPackage.getImage` (packageId, pointCode, fileName)
- `aoiPackage.getPackage` (packageId, id)
- `aoiPackage.getPackageImages` (packageId, id)
- `aoiPackage.getPackageLogs` (packageId, id, limit)
- `defectDisposition.countOpen` (inspectionId) → countOpenDispositions
- `defectDisposition.listByInspection` (inspectionId) → listDispositionsByInspection
- `defectDisposition.listBySerial` (serial) → listDispositionsBySerial
- `defectDisposition.reInspectStatus` (inspectionId) → getReInspectStatus
- `inspection.getById` (id) → getMachineById,getMeasurementResultsByInspection
- `inspection.getById` (id) → getMeasurementResultById
- `inspection.getByInspection` (inspectionId) → getMeasurementResultsByInspection
- `sop.execution` (id) → getExecution
- `sop.get` (id) → getSop
- `sop.resolveActive` (productModelId, stationId) → resolveActiveSop
- `edgeDeployment.getDeploymentStatus` (deploymentId) → getEdgeDeployment
- `edgeDeployment.getFleetOverview` (deploymentId) → getFleetOverview
- `edgeDeployment.getUnifiedFleetStatus` (deploymentId) → getUnifiedFleetStatus
- `ir.diffVersions` (beforeArtifactId, afterArtifactId) → loadArtifactFlow
- `ir.getFlow` (artifactId)
- `ir.mergeVersions` (baseArtifactId, oursArtifactId, theirsArtifactId) → loadArtifactFlow
- `predictiveMaintenance.getMachineRisk` (machineId, windowHours) → computeFailureRisk
- `predictiveMaintenance.getReliabilityStats` (machineId, windowHours) → computeReliabilityStats
- `predictiveMaintenance.getRulEstimate` (machineId) → getLatestRulEstimate
- `programming.getArtifact` (id)
- `programming.getProject` (id)
- `aiAdvanced.deviceDeployments` (deviceId) → getDeviceDeployments
- `aiAdvanced.getById` (id) → getEdgeDeployment
- `annotation.getByImage` (imageUrl)
- `annotation.getByInspection` (inspectionId)
- `bom.traceForward` (serialNumber) → listInstallationsBySerial
- `bom.traceReverse` (supplierLotId, componentCode) → listInstallationsByComponentCode,listInstallationsBySupplierLot
- `mqttBulletin.getHistoryDetail` (id)
- `mqttBulletin.getSetting` (stationId)
- `annotationComparison.compareTwo` (inspectionId1, inspectionId2)
- `annotationComparison.getById` (id)
- `aoiOnboarding.getDraft` (machineId) → getDraftRecord
- `aoiOnboarding.status` (machineId) → getAoiIngestMode,getDraftRecord
- `inspectionProgram.compare` (aId, bId) → compareReleases
- `inspectionProgram.get` (id) → getReleaseById
- `equipment.getCapabilities` (machineId) → loadMachine
- `equipment.getState` (machineId) → loadMachine
- `interlock.get` (id)
- `interlock.testEvaluate` (id, observedValue, series)
- `orderLifecycle.detail` (orderId) → getOrderDetail
- `orderLifecycle.trace` (orderId) → traceOrder
- `productionSession.getById` (id)
- `productionSession.verifySignoff` (id)
- `traceability.byLot` (lotNumber)
- `traceability.bySerial` (serialNumber) → listInstallationsBySerial
- `processResult.listBySerial` (serialNumber, limit) → listProcessResultsBySerial
- `mqttClientManagement.exportAssignmentReport` (profileId, targetType, isActive)
- `goldenSample.getThumbnail` (id) → getReferenceById
- `parameterGuardrail.get` (id) → getGuardrail
- `robot.get` (id)
- `ai.get` (id)
- `ngRateThreshold.getById` (id)
- `aiCalibration.getCalibration` (id) → getCalibrationReport
- `aiImageSearch.findSimilar` (embeddingId, limit, machineId, productModelId) → findSimilarByIdWithMode
- `feederVerify.setupStatus` (machineId, productModelId) → getSetupStatus
- `hotFolder.status` (configId, limit) → getHotFolderStatus
- `thresholdApproval.getById` (id) → getById
- `alert.getById` (id) → getAlertSettingById
- `ecn.getById` (id) → getEcnById
- `layout.getById` (id) → getFactoryLayoutById,getMachinePositionsByLayout
- `maintenanceSchedule.get` (id) → getRow
- `mqttNgAlertSettings.getSetting` (stationId)
- `ncr.getById` (id) → getNcrById
- `productVariant.getVariant` (variantId) → resolveEffectivePoints
- `sites.get` (id)
- `stencil.status` (stencilToolId) → getStatus
- `vda5050.status` (robotId) → getAgvAdapter
- `_core/system.exportConfig` (categories) → exportSystemConfig
- `twin.models.resolve` (machineId, equipmentId, equipmentClass) → resolveModel

### T2

- `aoiPackage.getQueueStatus` (machineId)
- `aoiPackage.getUploadStats` (dateFrom, dateTo)
- `aoiPackage.listPackages` (page, pageSize, machineId, machineCode)
- `defectDisposition.listOpen` (limit) → listOpenDispositions
- `defectDisposition.repairQueue` (machineId, lineId) → listRepairQueue
- `defectDisposition.repairStats` (id, status, note) → getRepairStats
- `inspection.aiAnalysis` (startDate, endDate) → getDailyStatistics
- `inspection.defectPatternClusters` (startDate, endDate, limit)
- `sop.executions` (sopId, limit) → listExecutions
- `sop.list` (status, productModelId) → listSops
- `edgeDeployment.listDeployments` (modelId, machineId, status) → getEdgeDeployments
- `ir.listFlows` (projectId, limit)
- `predictiveMaintenance.listRulForecast` (limit) → getMachines,computeFailureRisk
- `programming.fleetVersionMatrix` (projectId, deviceIds) → fleetVersionMatrix
- `programming.listArtifacts` (projectId, branch)
- `programming.listBuilds` (artifactId)
- `programming.listDeployApprovals` (projectId)
- `programming.listDeployments` (projectId)
- `programming.listProjects` (limit)
- `programming.listSymbols` (projectId)
- `aiAdvanced.inferenceResults` (deploymentId, deviceId, synced, limit) → getEdgeInferenceResults
- `aiAdvanced.list` (modelId, status, machineId, limit) → getEdgeDeployments
- `aiAdvanced.staleDeployments` (thresholdMinutes) → checkStaleDeployments
- `aiAdvanced.checkAutoRetrain` (modelId) → checkAutoRetrainTrigger
- `aiAdvanced.getDataStats` (modelId) → getTrainingDataStats
- `annotation.comparison` (serialNumber, productModelId, measurementPointId)
- `annotation.heatmapData` (machineId, productModelId, dateFrom, dateTo)
- `annotation.search` (textQuery, types, color, dateFrom)
- `annotation.statistics` (dateFrom, dateTo, machineId, productModelId)
- `annotation.trendPrediction` (machineId, productModelId, annotationType, days)
- `bom.feederReorderStatus` (machineId) → listFeedersBelowReorder
- `bom.getDefinition` (id) → listBomLineItemsByBom
- `bom.listFeeders` (machineId) → listFeederMaterialsByMachine
- `mqttBulletin.getDashboardStats` (stationId, days)
- `mqttBulletin.getHistory` (stationId, startDate, endDate, limit)
- `mqttBulletin.listSettings` (stationId, enabledOnly)
- `annotationComparison.getTrendData` (machineId, productModelId, dateFrom, dateTo)
- `annotationComparison.list` (productModelId, serialNumber, machineId, status)
- `aoiOnboarding.listAoiMachines` → listAllRecords
- `aoiOnboarding.listRecords` (machineId) → listRecordsForMachine
- `inspectionProgram.getActive` (productModelId, machineId) → getActiveRelease
- `inspectionProgram.list` (productModelId) → listReleases
- `equipment.listEquipment` (stationId, limit)
- `interlock.list` (id)
- `orderLifecycle.list` (lineId, limit) → listOrders
- `productionSession.list` (factoryId, workshopId, lineId, status)
- `processResult.dailyRollup` (sinceDays, machineId, machineType) → readProcessResultDaily
- `processResult.envSeries` (machineId, tagKey, sinceDays) → getTelemetrySeries
- `processResult.fleetRollup` (sinceDays, machineType) → aggregateProcessResultStatsByType
- `processResult.metricSeries` (machineId, stepType, metricKey) → getProcessMetricSeries
- `processResult.spcChart` (machineId, stepType, metricKey) → getProcessMetricPoints
- `processResult.stats` (machineId, serialNumber, stepType) → aggregateProcessResultStats
- `mqttClientManagement.getAvailableTargets` (targetType, search, excludeAssigned)
- `mqttClientManagement.getConnectionStatus` (profileId, targetType, status)
- `mqttClientManagement.getDashboardStats`
- `mqttClientManagement.getReconnectStatsByTarget` (targetType, days, limit)
- `mqttClientManagement.listAssignments` (profileId, targetType, limit)
- `goldenSample.getActiveForKey` → resolveActiveReference
- `goldenSample.listByProduct` (productModelId, activeOnly, status) → listByProduct
- `goldenSample.listForProduct` (productCode, activeOnly, limit) → listReferences
- `goldenSample.listManaged` (productCode, status, activeOnly) → listReferences
- `parameterGuardrail.changeLog` (machineId, paramKey, limit) → listChangeLog
- `parameterGuardrail.list` (machineId, machineType) → listGuardrails
- `parameterGuardrail.materialForecast.component` (machineId, componentCode, windowHours) → forecastTimeToEmpty
- `parameterGuardrail.materialForecast.machine` (machineId, windowHours) → forecastMachineMaterials
- `robot.interlockPreview` (robotId) → evaluateInterlockGate
- `robot.jobs` (robotId, limit)
- `robot.list` (id)
- `robot.telemetry` (robotId, limit)
- `ai.list` (status, severity)
- `ai.stats`
- `ai.list` (analysisType, machineId)
- `ngRateThreshold.alertHistory` (stationId, thresholdId, severity, isResolved)
- `ngRateThreshold.currentNgRates` (stationId) → getNgRateStatsForStation
- `ngRateThreshold.list` (stationId, machineId, isEnabled)
- `aiCalibration.getLatestCalibration` (modelId) → getLatestCalibrationReport
- `aiCalibration.listCalibration` (modelId, limit, offset) → listCalibrationReports
- `aiImageSearch.clusterDefects` (machineId, productModelId, label, minSimilarity) → clusterDefects
- `aiImageSearch.stats` (machineId, productModelId) → getEmbeddingStats
- `feederVerify.listForSetup` (machineId, productModelId, limit) → listForSetup
- `feederVerify.runGate` (machineId, productModelId) → assertSetupOkForRun
- `hotFolder.listConfigs` (configId, limit) → listHotFolderConfigs
- `hotFolder.recentFiles` (configId, limit) → listRecentHotFolderFiles
- `thresholdApproval.countPendingByProduct` (productModelId) → countPendingByPoint
- `thresholdApproval.list` (pointDefId, status)
- `alert.listAll` (id) → getAlertSettings
- `ecn.list` (status, changeType, productModelId) → listEcn
- `layout.listByWorkshop` (workshopId) → getFactoryLayoutsByWorkshop
- `maintenanceSchedule.list` (machineId, isActive, limit)
- `mqttNgAlertSettings.listSettings` (stationId, enabledOnly)
- `ncr.list` (status, source, lotNumber) → listNcr
- `productVariant.getEffectivePoints` (productModelId, variantId) → resolveEffectivePoints
- `sites.list` (id)
- `stencil.listUsage` (stencilToolId, limit) → listUsage
- `vda5050.listAgvs` (robotId)
- `lineController.getState` → getLineStateDetail
- `lineController.listStates` (factoryId) → listLinesWithState
- `lineController.readiness` (requireRecipe) → checkLineReadiness
- `lineController.recipeSet.get` → getRecipeSetDetail
- `lineController.recipeSet.list` (limit) → listRecipeSets
- `lineController.recipeSet.lockStatus` → getRecipeSetLockStatus
- `lineController.stages` → getLineStages
- `lineController.transitions` (limit) → listTransitions
- `federation.aggregateSummary` (corporateCode)
- `federation.alertRollup` (corporateCode)
- `federation.categoryRollup` (category, corporateCode)
- `federation.siteDetail` (siteCode)
- `federation.siteKpiHistory` (siteId, days)
- `federation.siteRollups` (corporateCode)
- `federation.syncLog` (siteId, limit)
- `aiActiveLearning.checkRetrain` (modelId, minNewLabels) → checkRetrainThreshold
- `aiActiveLearning.diversitySampling` (limit, machineId) → runDiversitySampling
- `aiActiveLearning.getQueue` (status, machineId, productModelId, assignedTo) → getReviewQueue
- `aiActiveLearning.labelAccuracy` (modelId) → getLabelAccuracy
- `aiActiveLearning.stats` (modelId, machineId) → getActiveLearningStats
- `aiActiveLearning.uncertaintySampling` (limit, machineId, productModelId) → runUncertaintySampling
- `energy.demandResponse` (thresholdKw, windowMin, horizon) → computePeakDemand,forecastEnergy
- `energy.enpi` (machineId, recipeId, from) → listEnpiMetrics
- `energy.forecast` (metric, horizon, algorithm) → forecastEnergy
- `energy.peakDemand` (windowMin) → computePeakDemand
- `energy.powerFactor` (threshold) → computePowerFactor
- `energy.recipeEnergy` → computeRecipeEnergy
- `paretoAnalysis.byDefectClass` (startDate, endDate, factoryId, workshopId) → getDefectClassPareto
- `paretoAnalysis.byDefectType` (startDate, endDate, factoryId, workshopId) → paretoByDefectType
- `paretoAnalysis.byLine` (startDate, endDate, factoryId, workshopId) → paretoByLine
- `paretoAnalysis.byMachine` (startDate, endDate, factoryId, workshopId) → paretoByMachine
- `paretoAnalysis.byPackage` (startDate, endDate, factoryId, workshopId) → getPackageDefectPareto
- `paretoAnalysis.byTimePeriod` (startDate, endDate, groupBy, factoryId) → paretoByTimePeriod
- `equipmentIntegration.euromapOpcuaSnapshot` (machineCode, machineId) → EuromapAdapter
- `equipmentIntegration.frameworkSnapshot` (kind, machineCode) → EuromapAdapter
- `equipmentIntegration.listCodeHistory` (code, limit) → listCodeHistory
- `equipmentIntegration.listLoadHistory` (machineId, limit) → listLoadHistory
- `equipmentIntegration.listRecipeVersions` (code) → listVersions
- `productionDashboard.getDefectAnalysis` (factoryId, lineId, startDate, endDate) → resolveMachineIds
- `productionDashboard.getFalseCallEscape` (startDate, endDate, machineId, lineId) → resolveMachineIds,getFalseCallEscapeKpi
- `productionDashboard.getSpcSummary` (factoryId, lineId, startDate, endDate) → resolveMachineIds
- `productionDashboard.getStationOverview` (factoryId, workshopId, lineId, startDate) → getTopDefectsForMachines
- `productionDashboard.getTrendData` (factoryId, lineId, startDate, endDate) → resolveMachineIds
- `safety.currentBoard` (operatorId, status) → getCurrentBoard
- `safety.evaluateZones` (humans, robots, robotId) → evaluateAndRecord
- `safety.listCameraCalibrations` (cameraId, safetyZoneId, robotId) → listCalibrations
- `safety.listCollaborations` (phase, limit)
- `safety.listZones` (robotId, stationId, lineId) → listZones
- `aiQualityGate.getConfig` (id)
- `aiQualityGate.listConfigs` (machineId, productModelId, enabled, limit)
- `aiQualityGate.listResults` (configId, decision, inspectionId)
- `aiQualityGate.stats` (configId, machineId, startDate, endDate) → getQualityGateStats
- `hierarchyTree.getFactoryTree` (factoryId) → getFactoryHierarchyFlat
- `hierarchyTree.getMqttTopics` (level, factoryId, workshopId) → getFullHierarchyFlat
- `hierarchyTree.getSummary` → getFullHierarchyFlat
- `hierarchyTree.getTree` (factoryId) → getFullHierarchyFlat
- `wip.dispatch` (lineId, max)
- `wip.dwellByStation` (lineId, hours)
- `wip.list` (lineId, stationId)
- `wip.summary` (lineId)
- `aiAnomaly.latestForMachine` (machineId, productModelId) → readMachineStatuses
- `aiAnomaly.machineStatuses` (machineIds, productModelId) → readMachineStatuses
- `aiAnomaly.stats` (productModelId, machineId) → getAnomalyStats
- `aiFeedback.getDashboardStats`
- `aiFeedback.getPendingSuggestions` (limit, offset, suggestionType)
- `aiFeedback.getSuggestionsByInspection` (inspectionId)
- `aiSmartAlertRouting.detectSpike` (machineId, windowMinutes, spikeThreshold) → detectDefectSpike
- `aiSmartAlertRouting.detectYieldDrop` (factoryId, dropThresholdPercent) → detectYieldDrop
- `aiSmartAlertRouting.stats` (days) → getAlertRoutingStats
- `aiThresholdAdvisor.recommendForPoint` (measurementPointId, productModelId, machineId) → recommendForMeasurementPoint
- `aiThresholdAdvisor.recommendInspectionParam` (ngThresholdId, windowDays) → recommendInspectionParam
- `aiThresholdAdvisor.recommendNgThreshold` (ngThresholdId, windowDays, minSampleDays) → recommendNgThreshold
- `erpAdmin.listOauthClients` (name, description, corporateCode)
- `erpAdmin.outboxDeadLetters` (limit) → listDeadLetters
- `erpAdmin.outboxStatus` (limit) → outboxStats
- `field.deviceState` (robotId)
- `field.health` (state, deviceKind) → listFieldHealth
- `field.healthSummary` (protocol, endpoint, rootNodeId) → fieldHealthSummary
- `reportingMart.productMix` → factConditions
- `reportingMart.yieldByShift` → factConditions
- `reportingMart.yieldTrendHourly` → factConditions
- `aiModel.getInferenceResults` (modelId, inspectionId, measurementResultId, status) → getInferenceResults
- `aiModel.getInferenceStats` (modelId) → getInferenceStats
- `aiOrchestration.optimizeWorkflow` (workflow, goal) → loadAdvisorMachines
- `aiOrchestration.suggestWorkflow` (goal, machineIds) → loadAdvisorMachines
- `aiRobotAnomaly.listAnomalies` (robotId, status, limit)
- `aiRobotAnomaly.rollbackHistory` (modelId, limit)
- `measurementCorrections.agreementTrend` (machineId) → getAgreementTrend
- `measurementCorrections.machineFalseCallSummary` (machineId, limit) → getMachineFalseCallSummary
- `msd.expiringSoon` → expiringSoon
- `msd.listActive` → listActive
- `process.getAssignmentsByProcess` (processId)
- `process.getLineAssignments` (lineId) → getLineProcessAssignments
- `realtimeReport.enpiSummary` (machineId, limit)
- `realtimeReport.healthSeries` (machineId, hours, points)
- `spcAnalysis.controlChart` (measurementPointDefId, productModelId, machineId, startDate) → getFullAnalysisData
- `spcAnalysis.topNGPoints` (startDate, endDate, machineId, factoryCode) → getTopNGMeasurementPointsEnhanced
- `thresholdSuggestion.suggestForPoint` (pointDefId, windowSize, fromTs) → getMeasurementPointDefById,listMeasurementSamples
- `thresholdSuggestion.suggestForProductModel` (productModelId, windowSize, priorWeight) → getMeasurementPointDefsByProductModel,listMeasurementSamples
- `aiInsight.list` (status, machineCode, limit)
- `aiRcaCopilot.latest` (machineId, limit) → latestRca
- `aiSegmentation.listMasks` (measurementResultId, inspectionId, imageUrl) → listDefectSegmentations
- `aiSetupAdvisor.suggestSetup` (machineType, productModelId, targetMachineId) → buildConfigBundle,findSimilarTemplate
- `apiKey.list` (name, description, expiresAt)
- `dashboardStats.overviewCounts` (factoryId, workshopId, lineId, machineId) → getOverviewEntityCounts
- `edgeRuntime.listNodes` (factoryCode) → listNodes
- `hierarchy.config` (serialNumber) → getLineByStationId,getMachineBySerialNumber
- `machineApi.listKeys` (machineId) → listMachineKeys
- `maintenance.partsBelowReorder` (limit)
- `mqttSoftwareVersion.deviceVersionSummary`
- `ntfClassifier.list` (limit)
- `oversight.posture` → fetchInterlockCauHinhHong,fetchInterlockCoverage
- `simulation.fromScene` (factoryId, lineId, lineRef) → buildSceneGraph
- `stationTriangulation.correlationMatrix` (lotCode, limit) → listSamplesForLot
- `system.warmingStats` (enabled, intervalMinutes, warmOnStartup) → cacheWarmingService
- `user.getAllUserAssignments` (userId, corporateCode) → getUserCorporateAssignments,getUserFactoryAssignments

### T3

- `twin.models.list` (equipmentClass, status, limit) → listModels
- `aiAnomaly.getProfile` → getProfile
- `ntfClassifier.status` → getActiveNtfClassifier
- `aiEval.autoRetrainCheck` (modelId) → checkAutoRetrainTrigger
- `aiLocalTraining.capabilities` (modelId) → getTrainingCapabilities
- `aiSettings.getDataPipelineStats`
- `componentLibrary.linkStats`
- `ecosystemAdmin.softRefIntegrity` → checkSoftRefIntegrity
- `equipmentStandards.complianceMetrics` → loadComplianceMetrics
- `equipmentStandards.hierarchyTree` (typeKey) → loadNodeSet
- `equipmentStandards.listAlarmMappings` (vendor) → loadAlarmMappings
- `equipmentStandards.listChangeRequests` (status, limit)
- `equipmentStandards.listMasterAlarms` (alarmKey, assetType) → loadMasterAlarms
- `equipmentStandards.mapAlarm` (vendor, nativeCode) → loadAlarmMappings
- `equipmentStandards.resolveForMachineType` (machineType) → loadNodeSet
- `equipmentStandards.resolveType` (typeKey) → loadNodeSet
- `machineRecipe.recipes.genealogy` (code, limit) → listCodeHistory [đã miễn trừ]
- `machineRecipe.recipes.get` (id) → getRecipeById [đã miễn trừ]
- `machineRecipe.recipes.listCodes` (code) [đã miễn trừ]
- `machineRecipe.recipes.listVersions` (code) → listRecipeVersions [đã miễn trừ]
- `permissions.getBuiltInRoles` → DEFAULT_ROLE_PERMISSIONS
- `permissions.getDefaultPermissionsForRole` (role) → DEFAULT_ROLE_PERMISSIONS
- `semantics.compute` → computeMetric
- `semantics.get` (metric) → getDefinition
- `semantics.list` (metric) → listMetrics
- `shiftConfig.defaults` (factoryId, name, code, startHour) → getDefaultShiftConfigs
- `shiftConfig.list` (factoryId) → getShiftConfigs
- `simTargets.ursimPing` → resolveSimTarget
- `systemHealth.connectionSupervisors` → listSupervisorStatuses

## Ghi chú

- **Mutation (nhóm D = 1 198)** không nằm trong con số 314 và không được bộ quét kiểm phạm vi GHI. Các lô rà trước đã vá một số (commissioning, deviceAdapter, unsMapping, mappingAsCode, machineRecipe.deploy/rollback/changeover, genealogy.appendEvent, commandLog…) nhưng chưa có phép đếm cho phần còn lại — cần một bước đo riêng (đề xuất: liệt kê mutation nhận id/machineId/stationId/lineId từ input mà không gọi bộ phân giải phạm vi).
- 4 thủ tục `machineRecipe.recipes.*` đã MIỄN TRỪ CÓ CHỦ Ý (chủ dự án duyệt 2026-10-24).
