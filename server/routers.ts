import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { sdk } from "./_core/sdk";
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
import { productModelRouter, measurementPointRouter, productMachineMappingRouter, productCategoryRouter, productDocumentRouter } from "./routers/productRouters";
import { inspectionRouter, measurementResultRouter } from "./routers/inspectionRouters";
import { layoutRouter } from "./routers/layoutRouters";
import { dashboardRouter, seedDataRouter } from "./routers/dashboardStatsRouters";
import { machineApiRouter } from "./routers/machineApiRouters";
import { publicProductApiRouter } from "./routers/publicProductApiRouter";
import { shiftConfigRouter } from "./routers/shiftConfigRouter";
import { userRouter, userAssignmentRouter, userSettingsRouter } from "./routers/userRouters";
import { alertRouter, yieldThresholdRouter } from "./routers/alertRouters";
import { productionOrderRouter, lineStageRouter, lineProductAssignmentRouter } from "./routers/productionRouters";
import { machineStatusRouter, templateRouter, bulkImportRouter, manualMappingRouter } from "./routers/statusTemplateRouters";
import { mqttClientRouter, oeeRouter, mqttAlertRouter } from "./routers/mqttOeeRouters";
import { inlineAuditRouter, workstationRouter, scheduledReportRouter, smtpRouter, systemConfigRouter, corporateFactoryStatsRouter } from "./routers/systemRouters";
import { importRouter, exportRouter } from "./routers/dataRouters";
import { notificationRouter } from "./routers/notificationRouters";
import { dashboardWidgetRouter } from "./routers/dashboardWidgetRouters";
import { drillDownRouter, annotationRouter, annotationTemplateRouter, annotationHistoryRouter } from "./routers/annotationRouters";
import { rootCauseRouter, predictiveAlertRouter } from "./routers/aiRouters";

// ─── New Feature Router Imports ──────────────────────────────────────────────
import { pdfReportRouter } from "./routers/pdfReportRouter";
import { dataComparisonRouter } from "./routers/dataComparisonRouter";
import { powerpointRouter } from "./routers/powerpointRouter";
import { reportBuilderRouter } from "./routers/reportBuilderRouter";
import { enhancedAuditRouter } from "./routers/enhancedAuditRouter";
import { paretoAnalysisRouter } from "./routers/paretoAnalysisRouter";
import { qualityGateTemplateRouter } from "./routers/qualityGateTemplateRouter";
import { licenseRouter } from "./routers/licenseRouter";
import { ngRateThresholdRouter } from "./routers/ngRateThresholdRouter";
import { productionDashboardRouter } from "./routers/productionDashboardRouter";
import { stationAnalysisRouter } from "./routers/stationAnalysisRouter";
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
import { aiEdgeEnhancedRouter } from "./routers/aiEdgeEnhancedRouter";
import { aiLocalTrainingRouter } from "./routers/aiLocalTrainingRouter";
import { aiChatRouter } from "./routers/aiChatRouter";
import { aiAnalysisHubRouter } from "./routers/aiAnalysisHubRouter";
import { aiSettingsRouter } from "./routers/aiSettingsRouter";
import { aiGgufRouter } from "./routers/aiGgufRouter";
import { aiInspectionAnalyticsRouter } from "./routers/aiInspectionAnalyticsRouter";
import { aiSpecialistAgentRouter } from "./routers/aiSpecialistAgentRouter";

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
        const bcrypt = await import('bcryptjs');

        const user = await db.getUserByUsername(input.username);
        if (!user) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Tên đăng nhập hoặc mật khẩu không đúng' });
        }

        if (!user.isActive) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Tài khoản đã bị vô hiệu hóa' });
        }

        if (!user.passwordHash) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Tài khoản này không hỗ trợ đăng nhập bằng mật khẩu' });
        }

        const isValid = await bcrypt.compare(input.password, user.passwordHash);
        if (!isValid) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Tên đăng nhập hoặc mật khẩu không đúng' });
        }

        const twoFAStatus = await db.get2FAStatus(user.id);
        if (twoFAStatus?.twoFactorEnabled) {
          return {
            requires2FA: true,
            userId: user.id,
            message: "Vui lòng nhập mã xác thực 2 bước"
          };
        }

        await db.upsertUser({
          openId: user.openId,
          lastSignedIn: new Date(),
        });

        const sessionToken = await sdk.createSessionToken(user.openId, {
          name: user.name || "",
          expiresInMs: ONE_YEAR_MS,
        });

        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

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
  predictiveAlert: predictiveAlertRouter,

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
  // AI Edge Enhanced (Phase 4.1)
  aiEdgeEnhanced: aiEdgeEnhancedRouter,
  // AI Local Training (Phase 4.2)
  aiLocalTraining: aiLocalTrainingRouter,
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
});

export type AppRouter = typeof appRouter;
