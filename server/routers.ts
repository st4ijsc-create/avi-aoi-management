import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { establishSession, LoginError, verifyCredentials } from "./_core/authService";
import { systemRouter } from "./_core/systemRouter";
import { isManusOAuthEnabled, listEnabledExternalProviders } from "./_core/oauthProviders";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "./db";

// ─── Pre-existing external router imports ────────────────────────────────────
import { processRouter } from "./routers/processRouter";
import { spcAnalysisRouter } from "./routers/spcAnalysisRouter";
import { twoFactorRouter } from "./routers/twoFactorRouter";
import { sessionRouter } from "./routers/sessionRouter";
import { annotationComparisonRouter } from "./routers/annotationComparisonRouter";
import { defectHeatmapRouter } from "./routers/defectHeatmapRouter";
import { aiFeedbackRouter } from "./routers/aiFeedbackRouter";
import { trainingBatchCommentsRouter } from "./routers/trainingBatchCommentsRouter";
import { mqttClientManagementRouter } from "./routers/mqttClientManagementRouter";
import { mqttBulletinRouter } from "./routers/mqttBulletinRouter";
import { aoiPackageRouter } from "./routers/aoiPackageRouter";
import { permissionsRouter } from "./routers/permissionsRouter";
import { backupRouter } from "./routers/backupRouter";
import { webhookRouter } from "./routers/webhookRouter";
import { spcConfigRouter, workstationSpcRouter, correlationRouter, spcRuleViolationRouter, cpkTrendRouter, qualityGateRouter } from "./routers/spcAdvancedRouter";

// ─── Extracted domain router imports ─────────────────────────────────────────
import { factoryRouter, workshopRouter, lineRouter, stationRouter, machineRouter } from "./routers/hierarchyRouters";
import { productModelRouter, measurementPointRouter, productMachineMappingRouter, productCategoryRouter, productDocumentRouter, fiducialMarkRouter, measurementTypeCatalogRouter, defectCatalogRouter, measurementInstrumentRouter, samplingPlanRouter, productViewRouter, msaWizardRouter, instrumentCalibrationRouter, instrumentMsaRecordRouter, mpLightingProfileRouter, measurementSamplesRouter, spcAlertsRouter, mpDefectStatsRouter, msaAdvancedRouter, cadImportRouter } from "./routers/productRouters";
import { inspectionRouter, measurementResultRouter } from "./routers/inspectionRouters";
import { layoutRouter } from "./routers/layoutRouters";
import { dashboardRouter, seedDataRouter } from "./routers/dashboardStatsRouters";
import { machineApiRouter } from "./routers/machineApiRouters";
import { publicProductApiRouter } from "./routers/publicProductApiRouter";
import { shiftConfigRouter } from "./routers/shiftConfigRouter";
import { userRouter, userAssignmentRouter, userSettingsRouter } from "./routers/userRouters";
import { alertRouter, yieldThresholdRouter } from "./routers/alertRouters";
import { productionOrderRouter, lineStageRouter, lineProductAssignmentRouter } from "./routers/productionRouters";
import { productionSessionRouter } from "./routers/productionSessionRouter";
import { machineStatusRouter, templateRouter, bulkImportRouter, manualMappingRouter } from "./routers/statusTemplateRouters";
import { mqttClientRouter, oeeRouter, mqttAlertRouter } from "./routers/mqttOeeRouters";
import { inlineAuditRouter, workstationRouter, scheduledReportRouter, smtpRouter, systemConfigRouter, corporateFactoryStatsRouter } from "./routers/systemRouters";
import { importRouter, exportRouter } from "./routers/dataRouters";
import { notificationRouter } from "./routers/notificationRouters";
import { dashboardWidgetRouter } from "./routers/dashboardWidgetRouters";
import { drillDownRouter, annotationRouter, annotationTemplateRouter, annotationHistoryRouter } from "./routers/annotationRouters";
import { rootCauseRouter, predictiveAlertRouter } from "./routers/aiRouters";
import { causalGraphRouter } from "./routers/causalGraphRouter"; // Causal knowledge-graph admin CRUD (validated + atomic write to knowledge/causal-graph.json)
import { predictiveMaintenanceRouter } from "./routers/predictiveMaintenanceRouter";
import { mesControlTowerRouter } from "./routers/mesControlTowerRouter";
import { maintenanceRouter } from "./routers/maintenanceRouter"; // Work-order CRUD + close→MTTR (machine_monitoring RBAC)
import { digitalTwinRouter } from "./routers/digitalTwinRouter";
import { realtimeReportRouter } from "./routers/realtimeReportRouter";
import { machineContractRouter } from "./routers/machineContractRouter";
import { wipRouter } from "./routers/wipRouter";
import { traceabilityRouter } from "./routers/traceabilityRouter";

// ─── New Feature Router Imports ──────────────────────────────────────────────
import { pdfReportRouter } from "./routers/pdfReportRouter";
import { dataComparisonRouter } from "./routers/dataComparisonRouter";
import { powerpointRouter } from "./routers/powerpointRouter";
import { reportBuilderRouter } from "./routers/reportBuilderRouter";
import { executiveReportRouter } from "./routers/executiveReportRouter"; // Phase B4.3: automated AI executive reports
import { enhancedAuditRouter } from "./routers/enhancedAuditRouter";
import { paretoAnalysisRouter } from "./routers/paretoAnalysisRouter";
import { qualityGateTemplateRouter } from "./routers/qualityGateTemplateRouter";
import { licenseRouter } from "./routers/licenseRouter";
import { ngRateThresholdRouter } from "./routers/ngRateThresholdRouter";
import { productionDashboardRouter } from "./routers/productionDashboardRouter";
import { stationAnalysisRouter } from "./routers/stationAnalysisRouter";
import { stationTriangulationRouter } from "./routers/stationTriangulationRouter";
import { genealogyRouter } from "./routers/genealogyRouter";
import { processResultRouter } from "./routers/processResultRouter";
import { bomRouter } from "./routers/bomRouter"; // G2.4: BOM + Feeder + component genealogy (no machine write)
import { energyRouter } from "./routers/energyRouter"; // G2.6a: advanced energy analytics (read + telemetry, no machine write)
import { thresholdSuggestionRouter } from "./routers/thresholdSuggestionRouter";
import { thresholdApprovalRouter } from "./routers/thresholdApprovalRouter";
import { monteCarloFlowRouter } from "./routers/monteCarloFlowRouter";
import { inspectionVariantRouter } from "./routers/inspectionVariantRouter";
import { mpVariantSubformRouter } from "./routers/mpVariantSubformRouter";
import { ipcAcceptanceRouter } from "./routers/ipcAcceptanceRouter";
import { hierarchyTreeRouter } from "./routers/hierarchyTreeRouter";
import { mqttNgAlertSettingsRouter } from "./routers/mqttNgAlertSettingsRouter";
import { mqttSoftwareVersionRouter } from "./routers/mqttSoftwareVersionRouter";
import { aiModelRouter } from "./routers/aiModelRouter";
import { aiAdvancedRouter } from "./routers/aiAdvancedRouter";
import { aiQualityGateRouter } from "./routers/aiQualityGateRouter";
import { aiVisionLanguageRouter } from "./routers/aiVisionLanguageRouter";
import { aiImageSearchRouter } from "./routers/aiImageSearchRouter";
import { aiActiveLearningRouter } from "./routers/aiActiveLearningRouter";
import { aiTimeSeriesRouter } from "./routers/aiTimeSeriesRouter";
import { aiReportRouter } from "./routers/aiReportRouter";
import { aiSmartAlertRoutingRouter } from "./routers/aiSmartAlertRoutingRouter";
import { edgeDeploymentRouter } from "./routers/edgeDeploymentRouter"; // WS-2: edge deployment control plane (new, migration-safe)
import { aiLocalTrainingRouter } from "./routers/aiLocalTrainingRouter"; // WS-1: re-enabled (schema-mismatch fixed)
import { aiEvalRouter } from "./routers/aiEvalRouter"; // WS-1: eval + auto active-learning
import { aiChatRouter } from "./routers/aiChatRouter";
import { aiAnalysisHubRouter } from "./routers/aiAnalysisHubRouter";
import { aiSettingsRouter } from "./routers/aiSettingsRouter";
import { aiGgufRouter } from "./routers/aiGgufRouter";
import { aiInspectionAnalyticsRouter } from "./routers/aiInspectionAnalyticsRouter";
import { aiAdvancedVisionRouter } from "./routers/aiAdvancedVisionRouter";
import { aiSpecialistAgentRouter } from "./routers/aiSpecialistAgentRouter";
import { aiLocalKbRouter } from "./routers/aiLocalKbRouter";
import { aiCopilotRouter } from "./routers/aiCopilotRouter"; // GĐ2: HITL write-action confirm/cancel
import { aiRcaCopilotRouter } from "./routers/aiRcaCopilotRouter"; // Technician Copilot ③: RCA diagnose + 1-tap fix
import { aiThresholdAdvisorRouter } from "./routers/aiThresholdAdvisorRouter"; // Technician Copilot ②: Threshold/Param Advisor (recommend + HITL apply)
import { aiSetupAdvisorRouter } from "./routers/aiSetupAdvisorRouter"; // Technician Copilot ①: Setup Advisor (pre-fill new-machine config from similar template)
import { aiAgentRouter } from "./routers/aiAgentRouter"; // GĐ3b: multi-step agentic orchestrator (on top of HITL)
import { aiCalibrationRouter } from "./routers/aiCalibrationRouter"; // B2: confidence calibration (ECE + reliability)
import { aiAnomalyRouter } from "./routers/aiAnomalyRouter"; // B3: unsupervised anomaly detection (PatchCore-style)
import { aiSegmentationRouter } from "./routers/aiSegmentationRouter"; // B7: segmentation mask + sub-pixel metrology
import { aiVisionRouter } from "./routers/aiVisionRouter"; // P4-F: vision-close-loop (propose defect → HITL) + vision-router consolidation
import { andonRouter } from "./routers/andonRouter"; // F5a: Andon (ALERT-ONLY)
import { interlockRouter } from "./routers/interlockRouter"; // F5a: Interlock rules (ALERT-ONLY, no command path)
import { deviceAdapterRouter } from "./routers/deviceAdapterRouter"; // G2.2a: OT adapter/tag CONFIG + read-only testConnection (no write path)
import { visionAdapterRouter } from "./routers/visionAdapterRouter"; // P1a: vendor-agnostic vision/inspection adapter ingest (VISION_ADAPTERS_ENABLED)
import { mtconnectRouter } from "./routers/mtconnectRouter"; // P1b: MTConnect (CNC) test/status
import { masterDataRouter } from "./routers/masterDataRouter"; // P1c: MES master data (suppliers/materials/customers/skills/tools)
import { equipmentRouter } from "./routers/equipmentRouter"; // E0: unified equipment capability model + PackML (read-only)
import { orchestrationRouter } from "./routers/orchestrationRouter"; // E2: Factory Orchestration Engine (FOE_ENABLED)
import { aiOrchestrationRouter } from "./routers/aiOrchestrationRouter"; // E5: AI-assisted orchestration advisor (AI_ORCHESTRATION_ADVISOR_ENABLED; advisory, HITL)
import { edgeRuntimeRouter } from "./routers/edgeRuntimeRouter"; // E4: edge control runtime coordinator (EDGE_RUNTIME_ENABLED)
import { programmingRouter } from "./routers/programmingRouter"; // Doc 09 / D0: Device Programming & Control (DPC_DEPLOY_ENABLED; build/sim safe, deploy gated)
import { irRouter } from "./routers/irRouter"; // Doc 16 §11.1 / D1: IR programming layer (motion/IO block AST + semantic safety linter + URScript/ROS2 transpilers; DPC_IR_V2_ENABLED; flows through the EXISTING programming gate)
import { apiKeyRouter } from "./routers/apiKeyRouter"; // Control plane: scoped API-key admin CRUD (create-show-once + sha256 hash reuse)
import { erpAdminRouter } from "./routers/erpAdminRouter"; // K0+ (doc 16 Khối 0): ERP gateway admin — OAuth clients (create-show-once) + outbox status/dead-letter retry (ERP_OAUTH_ENABLED for client mutations)
import { machineRecipeRouter } from "./routers/machineRecipeRouter"; // G2.2a: recipe versioning + deploy (catalog/ledger only, no device push)
import { commandLogRouter } from "./routers/commandLogRouter"; // G2.2a: command audit log (READ-ONLY)
import { robotRouter } from "./routers/robotRouter"; // Phase 3: robot registry/telemetry/jobs (control via internal dispatcher)
import { secsGemRouter } from "./routers/secsGemRouter"; // P3a: SECS/GEM framework (SECS_GEM_ENABLED)
import { vda5050Router } from "./routers/vda5050Router"; // P3b: VDA 5050 AGV/AMR framework (VDA5050_ENABLED)
import { simTargetsRouter } from "./routers/simTargetsRouter"; // I3a (doc 20 §3/§5): URSim + ROS2 validation harness (URSIM_ENABLED / ROS2_BRIDGE_ENABLED)
import { fleetRouter } from "./routers/fleetRouter"; // G1 (doc 16 Khối 2): Fleet & Task Orchestration (FLEET_ORCH_ENABLED)
import { twinRouter } from "./routers/twinRouter"; // T1 (doc 16 Khối 7): Digital Twin — models/sceneGraph/replay/occupancyGrid (TWIN_LIVE_ENABLED)
import { safetyRouter } from "./routers/safetyRouter"; // S1 (doc 16 Khối 3): Safety audit + mixed workforce + near-miss advisory (ADVISORY; SAFETY_AUDIT_ENABLED / WORKFORCE_ENABLED)
import { equipmentStandardsRouter } from "./routers/equipmentStandardsRouter"; // E1 (doc 16 Khối 5): Equipment standardization governance — device type registry/alarm taxonomy/CR workflow/conformance/compliance (EQ_GOVERN_ENABLED)
import { equipmentIntegrationRouter } from "./routers/equipmentIntegrationRouter"; // I1 (doc 16 Khối 1B): multi-vendor integration — FOCAS/Euromap frameworks (read-only) + recipe versioning genealogy + alarm normalization (EQ_INTEG_ENABLED)
import { fieldRouter } from "./routers/fieldRouter"; // X1 (doc 16 Khối 1): Field & device abstraction — UDM state/staleness, field health, hot-plug discovery (FIELD_V2_ENABLED)
import { aiRobotAnomalyRouter } from "./routers/aiRobotAnomalyRouter"; // I2 (doc 16 Khối 4): robot-behaviour anomaly (advisory) + model auto-rollback history/trigger (AI_ROBOT_ANOMALY_ENABLED / AI_MODEL_AUTOROLLBACK_ENABLED)
import { aiInsightRouter } from "./routers/aiInsightRouter"; // Phase 4: AI orchestration insights (advisory, read + ack)
import { aiInboxRouter } from "./routers/aiInboxRouter"; // AI Action Inbox: push + 1-tap approve/dismiss/ask
import { aiTodayRouter } from "./routers/aiTodayRouter"; // "Today" briefing: role-aware zero-click login summary
import { kbVectorRouter } from "./routers/kbVectorRouter"; // Phase 4: KB pgvector store (ingest + search)
import { sitesRouter } from "./routers/sitesRouter"; // Doc 13 / F0: Multi-site Federation sites registry (admin CRUD + probe + self-enroll-local; read-only)
import { federationRouter } from "./routers/federationRouter"; // Doc 13 / F1: Federation roll-up read API (siteRollups/history/syncLog/aggregateSummary; read-only)
import { commandCenterRouter } from "./routers/commandCenterRouter"; // Doc 21 / U2: Ecosystem Command Center aggregation (hierarchy tree + KPI strip + seed alerts; read-only)
import { assetCockpitRouter } from "./routers/assetCockpitRouter"; // Doc 21 / U3: Machine & Robot Cockpit aggregation (machineDetail/robotDetail/machineAlarms; read-only)

// ─── App Router Assembly ─────────────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    checkSetupRequired: publicProcedure.query(async () => {
      const existingAdmins = await db.getUsersByRole('admin');
      return {
        required: existingAdmins.length === 0,
        message: existingAdmins.length === 0 ? 'Cần tạo tài khoản admin đầu tiên' : 'Hệ thống đã được cài đặt'
      };
    }),
    oauthProviders: publicProcedure.query(() => ({
      manus: isManusOAuthEnabled(),
      providers: listEnabledExternalProviders(),
    })),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    login: publicProcedure
      .input(z.object({
        username: z.string().min(1),
        password: z.string().min(1),
      }))
      .mutation(async ({ input, ctx }) => {
        // Single source of truth for brute-force lockout + login audit logging
        // (audit A bug #1). verifyCredentials throws LoginError with the right
        // semantics; we map it to the matching tRPC error code.
        let user;
        try {
          user = await verifyCredentials(input.username, input.password, ctx.req);
        } catch (err) {
          if (err instanceof LoginError) {
            const codeMap: Record<LoginError["code"], TRPCError["code"]> = {
              INVALID_CREDENTIALS: "UNAUTHORIZED",
              ACCOUNT_DISABLED: "FORBIDDEN",
              PASSWORD_UNSUPPORTED: "BAD_REQUEST",
              ACCOUNT_LOCKED: "TOO_MANY_REQUESTS",
            };
            throw new TRPCError({ code: codeMap[err.code], message: err.message });
          }
          throw err;
        }

        const twoFAStatus = await db.get2FAStatus(user.id);
        if (twoFAStatus?.twoFactorEnabled) {
          // Password verified + lockout reset; defer session creation until the
          // 2FA step completes (POST /api/auth/verify-2fa).
          return {
            requires2FA: true,
            userId: user.id,
            message: "Vui lòng nhập mã xác thực 2 bước"
          };
        }

        await establishSession(user, ctx.req, ctx.res, { method: "password" });

        return {
          success: true,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
          }
        };
      }),
    setupAdmin: publicProcedure
      .input(z.object({
        username: z.string().min(3).max(50),
        email: z.string().email(),
        name: z.string().min(1),
        password: z.string().min(8),
      }))
      .mutation(async ({ input }) => {
        const existingAdmins = await db.getUsersByRole('admin');
        if (existingAdmins.length > 0) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin already exists' });
        }

        const existingUser = await db.getUserByUsername(input.username);
        if (existingUser) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Tên đăng nhập đã tồn tại' });
        }

        const userId = await db.createUser({
          username: input.username,
          email: input.email,
          name: input.name,
          password: input.password,
          role: 'admin',
        });

        return { success: true, userId };
      }),
  }),

  // Hierarchy
  factory: factoryRouter,
  workshop: workshopRouter,
  line: lineRouter,
  station: stationRouter,
  machine: machineRouter,

  // Products
  productModel: productModelRouter,
  measurementPoint: measurementPointRouter,
  productMachineMapping: productMachineMappingRouter,
  productCategory: productCategoryRouter,
  productDocument: productDocumentRouter,
  fiducialMark: fiducialMarkRouter,
  measurementTypeCatalog: measurementTypeCatalogRouter,
  defectCatalog: defectCatalogRouter,
  measurementInstrument: measurementInstrumentRouter,
  samplingPlan: samplingPlanRouter,
  productView: productViewRouter,
  msaWizard: msaWizardRouter,
  // P4.A G19 + G17
  instrumentCalibration: instrumentCalibrationRouter,
  instrumentMsaRecord: instrumentMsaRecordRouter,
  mpLightingProfile: mpLightingProfileRouter,
  // P4.B G14
  measurementSamples: measurementSamplesRouter,
  spcAlerts: spcAlertsRouter,
  // P4.B G10
  mpDefectStats: mpDefectStatsRouter,
  // P4.B G12 advanced MSA
  msaAdvanced: msaAdvancedRouter,
  // P4.B G9 CAD import
  cadImport: cadImportRouter,

  // Inspection
  inspection: inspectionRouter,
  measurementResult: measurementResultRouter,

  // Layout & Dashboard
  layout: layoutRouter,
  dashboard: dashboardRouter,
  dashboardWidget: dashboardWidgetRouter,

  // Machine API
  machineApi: machineApiRouter,
  machineStatus: machineStatusRouter,

  // Public Product API (third-party integration)
  publicProductApi: publicProductApiRouter,

  // Production
  productionOrder: productionOrderRouter,
  lineStage: lineStageRouter,
  lineProductAssignment: lineProductAssignmentRouter,
  shiftConfig: shiftConfigRouter,
  productionSession: productionSessionRouter,

  // User Management
  user: userRouter,
  userAssignment: userAssignmentRouter,
  userSettingsRouter: userSettingsRouter,

  // Alerts
  alert: alertRouter,
  yieldThreshold: yieldThresholdRouter,

  // Templates & Import
  template: templateRouter,
  bulkImport: bulkImportRouter,
  manualMapping: manualMappingRouter,
  seedData: seedDataRouter,

  // MQTT & OEE
  mqttClient: mqttClientRouter,
  mqttAlert: mqttAlertRouter,
  oee: oeeRouter,

  // System & Admin
  audit: inlineAuditRouter,
  workstation: workstationRouter,
  scheduledReport: scheduledReportRouter,
  smtp: smtpRouter,
  systemConfig: systemConfigRouter,
  notification: notificationRouter,

  // Corporate & Analytics
  corporateFactoryStats: corporateFactoryStatsRouter,
  drillDown: drillDownRouter,

  // Data Import/Export
  import: importRouter,
  export: exportRouter,

  // Annotations
  annotation: annotationRouter,
  annotationTemplate: annotationTemplateRouter,
  annotationHistory: annotationHistoryRouter,

  // AI & Predictive
  rootCause: rootCauseRouter,
  causalGraph: causalGraphRouter,
  predictiveAlert: predictiveAlertRouter,
  predictiveMaintenance: predictiveMaintenanceRouter,
  mesControlTower: mesControlTowerRouter,
  maintenance: maintenanceRouter,
  digitalTwin: digitalTwinRouter,
  realtimeReport: realtimeReportRouter,
  machineContract: machineContractRouter,
  wip: wipRouter,
  traceability: traceabilityRouter,

  // F5a — Andon + Interlock (ALERT-ONLY; engine has no command path)
  andon: andonRouter,
  interlock: interlockRouter,

  // G2.2a — OT machine-control CONFIG + audit (config/query only; no write-to-device path)
  deviceAdapter: deviceAdapterRouter,
  visionAdapter: visionAdapterRouter,
  mtconnect: mtconnectRouter,
  equipment: equipmentRouter,
  orchestration: orchestrationRouter,
  aiOrchestration: aiOrchestrationRouter,
  edgeRuntime: edgeRuntimeRouter,
  programming: programmingRouter,
  ir: irRouter, // D1 (doc 16 §11.1 / Khối 6): IR programming layer (linter + URScript/ROS2 transpilers; DPC_IR_V2_ENABLED)
  apiKey: apiKeyRouter,
  erpAdmin: erpAdminRouter, // K0+ (doc 16 Khối 0): ERP gateway admin — OAuth2 clients + outbox ops
  machineRecipe: machineRecipeRouter,
  commandLog: commandLogRouter,
  robot: robotRouter,
  secsGem: secsGemRouter,
  vda5050: vda5050Router,
  simTargets: simTargetsRouter, // I3a (doc 20 §3/§5): URSim + ROS2 validation harness (URSIM_ENABLED / ROS2_BRIDGE_ENABLED)
  fleet: fleetRouter, // G1 (doc 16 Khối 2): Fleet & Task Orchestration (FLEET_ORCH_ENABLED)
  twin: twinRouter, // T1 (doc 16 Khối 7): Digital Twin — models/sceneGraph/replay/occupancyGrid (TWIN_LIVE_ENABLED)
  safety: safetyRouter, // S1 (doc 16 Khối 3): Safety audit + mixed workforce + near-miss advisory (ADVISORY ONLY; SAFETY_AUDIT_ENABLED / WORKFORCE_ENABLED)
  equipmentStandards: equipmentStandardsRouter, // E1 (doc 16 Khối 5): Equipment standardization governance (EQ_GOVERN_ENABLED)
  equipmentIntegration: equipmentIntegrationRouter, // I1 (doc 16 Khối 1B): multi-vendor integration — FOCAS/Euromap frameworks + recipe versioning genealogy + alarm normalization (EQ_INTEG_ENABLED)
  field: fieldRouter, // X1 (doc 16 Khối 1): Field & device abstraction — UDM state/staleness, field health, hot-plug discovery (FIELD_V2_ENABLED)
  aiRobotAnomaly: aiRobotAnomalyRouter, // I2 (doc 16 Khối 4): robot-behaviour anomaly (advisory) + model auto-rollback history/trigger (AI_ROBOT_ANOMALY_ENABLED / AI_MODEL_AUTOROLLBACK_ENABLED)
  aiInsight: aiInsightRouter,
  aiInbox: aiInboxRouter,
  aiToday: aiTodayRouter,
  kbVector: kbVectorRouter,

  // Federation (doc 13 / F0) — sites registry + enrollment + probe (read-only)
  sites: sitesRouter,
  // Federation (doc 13 / F1) — roll-up read API over the core aggregator (read-only)
  federation: federationRouter,
  // Ecosystem Command Center (doc 21 / U2) — whole-ecosystem hierarchy + KPI aggregation (read-only)
  commandCenter: commandCenterRouter,
  assetCockpit: assetCockpitRouter,

  // Process & SPC
  process: processRouter,
  spcAnalysis: spcAnalysisRouter,

  // Auth extensions
  twoFactor: twoFactorRouter,
  session: sessionRouter,

  // Comparison & Heatmap
  annotationComparison: annotationComparisonRouter,
  defectHeatmap: defectHeatmapRouter,

  // AI Feedback & Training
  aiFeedback: aiFeedbackRouter,
  trainingBatchComments: trainingBatchCommentsRouter,

  // MQTT Management
  mqttClientManagement: mqttClientManagementRouter,
  mqttBulletin: mqttBulletinRouter,

  // Packages & Permissions
  aoiPackage: aoiPackageRouter,
  permissions: permissionsRouter,

  // Backup & Webhook
  backup: backupRouter,
  webhook: webhookRouter,

  // SPC Advanced & Quality Gate
  spcConfig: spcConfigRouter,
  workstationSpc: workstationSpcRouter,
  correlation: correlationRouter,
  spcRuleViolation: spcRuleViolationRouter,
  cpkTrend: cpkTrendRouter,
  qualityGate: qualityGateRouter,

  // ─── New Feature Routers ──────────────────────────────────────────
  pdfReport: pdfReportRouter,
  dataComparison: dataComparisonRouter,
  powerpoint: powerpointRouter,
  reportBuilder: reportBuilderRouter,
  executiveReport: executiveReportRouter,
  enhancedAudit: enhancedAuditRouter,
  paretoAnalysis: paretoAnalysisRouter,
  qualityGateTemplate: qualityGateTemplateRouter,

  // License Management
  license: licenseRouter,

  // NG Rate Threshold Alerts
  ngRateThreshold: ngRateThresholdRouter,

  // Production Dashboard
  productionDashboard: productionDashboardRouter,

  // Station Analysis
  stationAnalysis: stationAnalysisRouter,
  stationTriangulation: stationTriangulationRouter,
  genealogy: genealogyRouter,
  processResult: processResultRouter,
  bom: bomRouter,
  masterData: masterDataRouter,
  energy: energyRouter,
  thresholdSuggestion: thresholdSuggestionRouter,
  thresholdApproval: thresholdApprovalRouter,
  monteCarloFlow: monteCarloFlowRouter,
  inspectionVariant: inspectionVariantRouter,
  mpVariantSubform: mpVariantSubformRouter,
  ipcAcceptance: ipcAcceptanceRouter,

  // Hierarchy Tree & MQTT Subscription Setup
  hierarchyTree: hierarchyTreeRouter,

  // MQTT NG Alert Settings
  mqttNgAlertSettings: mqttNgAlertSettingsRouter,

  // MQTT Software Version Management
  mqttSoftwareVersion: mqttSoftwareVersionRouter,

  // AI Model Management & Inference
  aiModel: aiModelRouter,

  // Advanced AI: Batch, Training, A/B Testing, Monitoring, Edge
  aiAdvanced: aiAdvancedRouter,

  // AI Quality Gate & Ensemble
  aiQualityGate: aiQualityGateRouter,

  // AI Vision-Language Model
  aiVisionLanguage: aiVisionLanguageRouter,

  // AI Image Similarity Search (pgvector)
  aiImageSearch: aiImageSearchRouter,

  // AI Active Learning & Auto-Labeling
  aiActiveLearning: aiActiveLearningRouter,

  // AI Time Series Anomaly Detection
  aiTimeSeries: aiTimeSeriesRouter,

  // AI-powered Reports
  aiReport: aiReportRouter,
  // AI Smart Alert Routing
  aiSmartAlertRouting: aiSmartAlertRoutingRouter,
  // WS-2: Edge Deployment control plane (admin) — migration-safe new router
  edgeDeployment: edgeDeploymentRouter,
  // AI Local Training (Phase 4.2) — WS-1: re-enabled after schema-mismatch fix
  aiLocalTraining: aiLocalTrainingRouter,
  // AI Eval Harness + auto active-learning + Tier-1 pipeline (WS-1)
  aiEval: aiEvalRouter,
  // AI Chat Assistant (Phase 4.3)
  aiChat: aiChatRouter,
  // AI Analysis Hub — unified user-selectable analysis
  aiAnalysisHub: aiAnalysisHubRouter,
  // AI Settings — API keys, model config, system config
  aiSettings: aiSettingsRouter,
  // AI GGUF — Local LLM model management & inference
  aiGguf: aiGgufRouter,
  // AI Specialist Agents — Data/Backend/Frontend/QA assistants on local GGUF
  aiSpecialistAgent: aiSpecialistAgentRouter,
  // AI Inspection Analytics — Trend, Pareto, forecast, SPC, risk
  aiInspectionAnalytics: aiInspectionAnalyticsRouter,
  // AI Advanced Vision — OK/NG compare, quality check, heatmap, OCR, ROI, augment, VQA, batch triage
  aiAdvancedVision: aiAdvancedVisionRouter,
  // AI Local Knowledge Base — Phase 2 codebase Q&A
  aiLocalKb: aiLocalKbRouter,
  // AI Copilot — GĐ2 HITL write-action confirm/cancel/get
  aiCopilot: aiCopilotRouter,
  aiRcaCopilot: aiRcaCopilotRouter,
  // AI Threshold/Param Advisor — LUỒNG ②: recommend LSL/USL/target + NG warning/critical, HITL apply
  aiThresholdAdvisor: aiThresholdAdvisorRouter,
  // AI Setup Advisor — LUỒNG ①: pre-fill a new machine's config from the most similar template (advisory only)
  aiSetupAdvisor: aiSetupAdvisorRouter,
  // AI Agent — GĐ3b multi-step agentic orchestrator (on top of HITL)
  aiAgent: aiAgentRouter,
  // AI Confidence Calibration — ECE / reliability diagram (B2)
  aiCalibration: aiCalibrationRouter,
  // AI Anomaly Detection — unsupervised PatchCore-style memory bank + kNN (B3)
  aiAnomaly: aiAnomalyRouter,
  // AI Segmentation — defect mask (QC vẽ/model) + sub-pixel metrology (B7)
  aiSegmentation: aiSegmentationRouter,
  // AI Vision (P4-F) — vision-close-loop: proposeDefect (HITL) + suggestDefectCodes
  // + consolidated sub-namespaces (advanced/anomaly/segmentation/imageSearch/language).
  // The original top-level vision namespaces above are kept for back-compat.
  aiVision: aiVisionRouter,
});

export type AppRouter = typeof appRouter;
