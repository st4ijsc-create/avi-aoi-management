# Comprehensive Codebase Research Report

**Project:** `avi-aoi-management`  
**Date:** Auto-generated  
**Purpose:** Complete inventory for refactoring planning  

---

## Table of Contents

1. [Schema Tables (99 tables)](#1-schema-tables)
2. [Database Functions (~350 exported functions)](#2-database-functions)
3. [Router Inline Procedures (routers.ts — 9,715 lines)](#3-router-inline-procedures)
4. [External Router Files (16 files)](#4-external-router-files)
5. [Pages with Hardcoded/Mock Data (8 pages)](#5-pages-with-hardcodedmock-data)

---

## 1. Schema Tables

**File:** `drizzle/schema.ts` (3,412 lines)  
**Total:** 99 `pgTable` definitions, 80+ `pgEnum` definitions (L6–L93)

| # | Table Name | Line | Domain |
|---|-----------|------|--------|
| 1 | `users` | L95 | Auth |
| 2 | `permissions` | L138 | Auth |
| 3 | `user_roles` | L168 | Auth |
| 4 | `factories` | L185 | Hierarchy |
| 5 | `workshops` | L209 | Hierarchy |
| 6 | `production_lines` | L230 | Hierarchy |
| 7 | `stations` | L252 | Hierarchy |
| 8 | `machines` | L273 | Hierarchy |
| 9 | `product_models` | L318 | Product |
| 10 | `measurement_point_defs` | L355 | Product |
| 11 | `product_inspections` | L394 | Inspection |
| 12 | `measurement_results` | L439 | Inspection |
| 13 | `factory_layouts` | L469 | Layout |
| 14 | `machine_positions` | L497 | Layout |
| 15 | `daily_statistics` | L525 | Statistics |
| 16 | `workshop_positions` | L552 | Layout |
| 17 | `factory_positions` | L576 | Layout |
| 18 | `alert_settings` | L600 | Alerts |
| 19 | `alert_history` | L629 | Alerts |
| 20 | `product_machine_mappings` | L653 | Product |
| 21 | `shift_configs` | L673 | Production |
| 22 | `production_orders` | L698 | Production |
| 23 | `line_stages` | L738 | Production |
| 24 | `line_product_assignments` | L762 | Production |
| 25 | `machine_status_logs` | L786 | Machine Status |
| 26 | `machine_heartbeats` | L807 | Machine Status |
| 27 | `manual_machine_connections` | L830 | Machine Status |
| 28 | `yield_alert_thresholds` | L859 | Alerts |
| 29 | `yield_threshold_history` | L884 | Alerts |
| 30 | `audit_logs` | L913 | Audit |
| 31 | `backup_codes` | L939 | Auth |
| 32 | `user_sessions` | L956 | Auth |
| 33 | `system_settings` | L982 | System |
| 34 | `workstations` | L1003 | Hierarchy |
| 35 | `measurement_point_templates` | L1029 | Product |
| 36 | `scheduled_reports` | L1069 | Reports |
| 37 | `scheduled_report_logs` | L1111 | Reports |
| 38 | `smtp_config` | L1132 | Email |
| 39 | `mqtt_clients` | L1154 | MQTT |
| 40 | `mqtt_subscriptions` | L1201 | MQTT |
| 41 | `mqtt_error_summary` | L1220 | MQTT |
| 42 | `mqtt_message_logs` | L1256 | MQTT |
| 43 | `mqtt_alert_rules` | L1284 | MQTT |
| 44 | `mqtt_alert_history` | L1320 | MQTT |
| 45 | `system_config` | L1353 | System |
| 46 | `user_corporate_assignments` | L1375 | Auth |
| 47 | `user_factory_assignments` | L1394 | Auth |
| 48 | `email_template_config` | L1416 | Email |
| 49 | `notifications` | L1461 | Notifications |
| 50 | `user_notification_preferences` | L1497 | Notifications |
| 51 | `dashboard_widget_layouts` | L1536 | Dashboard |
| 52 | `user_custom_dashboards` | L1572 | Dashboard |
| 53 | `user_settings` | L1614 | User |
| 54 | `dashboard_templates` | L1649 | Dashboard |
| 55 | `processes` | L1692 | Production |
| 56 | `line_process_assignments` | L1722 | Production |
| 57 | `widget_style_presets` | L1751 | Dashboard |
| 58 | `product_categories` | L1789 | Product |
| 59 | `backup_logs` | L1819 | Backup |
| 60 | `scheduled_backups` | L1848 | Backup |
| 61 | `template_marketplace` | L1877 | Marketplace |
| 62 | `template_reviews` | L1910 | Marketplace |
| 63 | `production_order_templates` | L1932 | Production |
| 64 | `oee_metrics` | L1962 | OEE |
| 65 | `downtime_events` | L1999 | OEE |
| 66 | `oee_targets` | L2041 | OEE |
| 67 | `machine_health_history` | L2076 | Machine Status |
| 68 | `mqtt_message_history` | L2115 | MQTT |
| 69 | `report_templates` | L2140 | Reports |
| 70 | `annotation_history` | L2183 | Annotation |
| 71 | `predictive_alerts` | L2223 | AI/Predictive |
| 72 | `root_cause_analysis` | L2282 | AI/Predictive |
| 73 | `history_export_schedules` | L2349 | Export |
| 74 | `history_export_logs` | L2400 | Export |
| 75 | `annotation_comparison_sessions` | L2434 | Annotation |
| 76 | `defect_heatmap_data` | L2499 | Annotation |
| 77 | `ai_suggestions` | L2554 | AI |
| 78 | `ai_feedback` | L2589 | AI |
| 79 | `ai_model_metrics` | L2619 | AI |
| 80 | `ai_training_batches` | L2662 | AI |
| 81 | `training_batch_comments` | L2697 | AI |
| 82 | `training_batch_tags` | L2718 | AI |
| 83 | `training_batch_tag_assignments` | L2734 | AI |
| 84 | `mqtt_client_profiles` | L2754 | MQTT |
| 85 | `mqtt_profile_assignments` | L2818 | MQTT |
| 86 | `mqtt_connection_logs` | L2852 | MQTT |
| 87 | `mqtt_topic_templates` | L2883 | MQTT |
| 88 | `mqtt_reconnect_logs` | L2926 | MQTT |
| 89 | `mqtt_connection_status` | L2967 | MQTT |
| 90 | `mqtt_connection_alerts` | L3012 | MQTT |
| 91 | `mqtt_alert_config` | L3057 | MQTT |
| 92 | `inspection_packages` | L3101 | Inspection |
| 93 | `package_images` | L3155 | Inspection |
| 94 | `upload_queue_metrics` | L3184 | Inspection |
| 95 | `package_activity_logs` | L3227 | Inspection |
| 96 | `mqtt_bulletin_settings` | L3268 | MQTT |
| 97 | `mqtt_bulletin_history` | L3301 | MQTT |
| 98 | `webhook_configs` | L3362 | Webhook |
| 99 | `webhook_delivery_logs` | L3391 | Webhook |

### Domain Summary

| Domain | Tables | Count |
|--------|--------|-------|
| MQTT | 39–44, 68, 84–91, 96–97 | 18 |
| Auth/User | 1–3, 31–32, 46–47, 53 | 8 |
| Hierarchy | 4–8, 34 | 6 |
| Product | 9–10, 20, 35, 58 | 5 |
| Inspection | 11–12, 92–95 | 6 |
| Layout | 13–14, 16–17 | 4 |
| Dashboard | 51–52, 54, 57 | 4 |
| Production | 21–24, 55–56, 63 | 7 |
| Alerts | 18–19, 28–29 | 4 |
| Machine Status | 25–27, 67 | 4 |
| AI/Predictive | 71–72, 77–83 | 9 |
| Annotation | 70, 75–76 | 3 |
| Reports | 36–37, 69 | 3 |
| Backup | 59–60 | 2 |
| Marketplace | 61–62 | 2 |
| OEE | 64–66 | 3 |
| Email | 38, 48 | 2 |
| Notifications | 49–50 | 2 |
| Export | 73–74 | 2 |
| System | 33, 45 | 2 |
| Audit | 30 | 1 |
| Statistics | 15 | 1 |
| Webhook | 98–99 | 2 |

---

## 2. Database Functions

**File:** `server/db.ts` (7,815 lines)  
**Total:** ~350 exported async functions + helper utilities

### 2.1 Core (L74)
- `getDb`

### 2.2 User/Auth (L96–L344)
- `upsertUser`, `getUserByOpenId`, `getAllUsers`, `updateUserRole`, `deleteUser`
- `getUserById`, `getUserByUsername`, `createLocalUser`, `updateUser`, `updateUserPassword`
- `getActiveUsers`, `getUsersByRole`, `getUsers`, `createUser`, `searchUsers`
- `setup2FA`, `enable2FA`, `disable2FA`, `get2FAStatus`

### 2.3 Factory (L355–L381)
- `createFactory`, `getFactories`, `getFactoryById`, `updateFactory`, `deleteFactory`

### 2.4 Workshop (L388–L422)
- `createWorkshop`, `getWorkshopsByFactory`, `getWorkshops`, `getWorkshopById`, `updateWorkshop`, `deleteWorkshop`

### 2.5 Production Line (L429–L463)
- `createProductionLine`, `getProductionLinesByWorkshop`, `getProductionLines`, `getLineById`, `updateProductionLine`, `deleteProductionLine`

### 2.6 Station (L470–L512)
- `createStation`, `getStationsByLine`, `getStations`, `getDefaultStation`, `getStationById`, `updateStation`, `deleteStation`

### 2.7 Machine (L519–L660)
- `createMachine`, `getMachinesByStation`, `getMachines`, `getMachinesWithHierarchy`
- `getMachineByApiKey`, `getMachineById`, `getMachineByCode`
- `updateMachineHeartbeat`, `updateMachine`, `deleteMachine`
- `getMachineBySerialNumber`, `getPendingMachines`, `approveMachine`, `rejectMachine`, `getLineByStationId`

### 2.8 Product Model (L670–L774)
- `createProductModel`, `getProductModels`, `getProductModelById`, `getProductModelByCode`, `updateProductModel`, `deleteProductModel`

### 2.9 Inspection (L784–L864)
- `createProductInspection`, `getProductInspections`, `getProductInspectionById`, `updateProductInspectionNTF`

### 2.10 Measurement Points (L876–L936)
- `createMeasurementPointDef`, `getMeasurementPointDefsByProductModel`, `getMeasurementPointDefsByMachine`
- `getMeasurementPointDefById`, `getMeasurementPointDefByCode`, `getMeasurementPointDefByMachineAndCode`
- `updateMeasurementPointDef`, `deleteMeasurementPointDef`

### 2.11 Measurement Results (L943–L972)
- `createMeasurementResult`, `createMeasurementResults`, `getMeasurementResultsByInspection`
- `getMeasurementResultById`, `updateMeasurementResultRemark`

### 2.12 Layout/Position (L979–L1089)
- `createFactoryLayout`, `getFactoryLayoutsByWorkshop`, `getFactoryLayoutsByFactory`, `getCorporationLayouts`
- `getFactoryLayoutById`, `updateFactoryLayout`
- `createMachinePosition`, `getMachinePositionsByLayout`, `updateMachinePosition`, `deleteMachinePosition`
- `createWorkshopPosition`, `getWorkshopPositionsByLayout`
- `createFactoryPosition`, `getFactoryPositionsByLayout`

### 2.13 Statistics/Dashboard (L1096–L1720)
- `upsertDailyStatistics`, `getDailyStatistics`, `getDashboardStats`, `getMachineStats`
- `getStatsWithComparison`, `getShiftStats`, `getTopBottomMachines`, `getActiveAlertsCount`
- `getDailyStats`, `getHourlyStats`, `searchInspections`, `getTopNGMeasurementPoints`
- `seedSampleData`

### 2.14 Alerts (L1850–L1913)
- `getAlertSettings`, `getAlertSettingById`, `createAlertSetting`, `updateAlertSetting`, `deleteAlertSetting`
- `getAlertHistory`, `createAlertHistory`, `acknowledgeAlert`

### 2.15 Seed Data (L1923)
- `seedInspectionData`

### 2.16 Product-Machine Mapping (L2008–L2057)
- `getProductMachineMappings`, `createProductMachineMapping`, `updateProductMachineMapping`
- `deleteProductMachineMapping`, `getMappingsByMachine`, `getMappingsByProduct`

### 2.17 Shift Config (L2072–L2104)
- `getShiftConfigs`, `createShiftConfig`, `updateShiftConfig`, `deleteShiftConfig`, `getDefaultShiftConfigs`

### 2.18 Production Orders (L2116–L2284)
- `getProductionOrders`, `getProductionOrderById`, `getProductionOrderByCode`
- `createProductionOrder`, `updateProductionOrder`, `deleteProductionOrder`, `updateProductionOrderQuantities`
- `getLineStages`, `getLineStageById`, `createLineStage`, `updateLineStage`, `deleteLineStage`, `reorderLineStages`
- `getLineProductAssignments`, `createLineProductAssignment`, `updateLineProductAssignment`, `deleteLineProductAssignment`

### 2.19 Layout with Relations (L2291–L2321)
- `getWorkshopLayoutsWithMachines`, `getFactoryLayoutsWithWorkshops`

### 2.20 Machine Status/Heartbeat (L2353–L2727)
- `createMachineStatusLog`, `getMachineStatusLogs`, `getLatestMachineStatus`
- `getAllMachinesWithStatus`, `getMachineUptimeStats`
- `markOfflineNotificationSent`, `getUnnotifiedOfflineMachines`
- `createMachineHeartbeat`, `getMachineHeartbeats`, `getLatestMachineHeartbeat`, `getHeartbeatHistory`
- `bulkCreateMeasurementPoints`
- `getUptimeTimeline`, `getAllMachinesUptimeTimeline`
- `getAlertConfiguration`, `updateAlertConfiguration`, `getMachineStatusReport`

### 2.21 Manual Connections (L2803–L2878)
- `listManualConnections`, `getManualConnectionById`, `getManualConnectionByMachineId`
- `createManualConnection`, `updateManualConnection`, `deleteManualConnection`
- `updateManualConnectionStatus`, `incrementManualConnectionRetry`, `getEnabledManualConnections`

### 2.22 Yield Thresholds (L2887–L2969)
- `getYieldAlertThresholds`, `getYieldAlertThresholdById`, `getYieldAlertThresholdByType`
- `createYieldAlertThreshold`, `updateYieldAlertThreshold`, `deleteYieldAlertThreshold`
- `getEnabledYieldAlertThresholds`
- `createYieldThresholdHistory`, `getYieldThresholdHistoryByThreshold`
- `getYieldThresholdHistoryByType`, `getAllYieldThresholdHistory`, `getYieldThresholdHistoryWithComparison`

### 2.23 Audit (L3001–L3129)
- `createAuditLog`, `getAuditLogs`, `getAuditLogStats`

### 2.24 Backup Codes / 2FA (L3209–L3267)
- `generateBackupCodes`, `getBackupCodes`, `verifyBackupCode`, `getUnusedBackupCodesCount`

### 2.25 Sessions (L3286–L3373)
- `createUserSession`, `getUserSessions`, `getSessionByToken`
- `updateSessionActivity`, `revokeSession`, `revokeAllSessions`, `cleanupExpiredSessions`

### 2.26 System Settings (L3386–L3430)
- `getSystemSetting`, `getSystemSettings`, `updateSystemSetting`, `createSystemSetting`

### 2.27 Workstations (L3440–L3500)
- `getWorkstations`, `getWorkstationById`, `getWorkstationByCode`
- `createWorkstation`, `updateWorkstation`, `deleteWorkstation`

### 2.28 Workstation Analytics (L3500–L3935)
- `getDefectsByWorkstation` (complex SQL with joins)
- `getTopNGMeasurementPointsByWorkstation`, `getWorkstationSummary`
- `getMeasurementPointsByWorkstation`, `seedWorkstationAnalyticsData`

### 2.29 NG Trend/Comparison (L3938–L4110)
- `getNGTrendByDay`, `getNGComparison`

### 2.30 Scheduled Reports (L4115–L4210)
- `getScheduledReports`, `getScheduledReportById`, `createScheduledReport`, `updateScheduledReport`, `deleteScheduledReport`
- `getScheduledReportLogs`, `createScheduledReportLog`, `getReportsDueForSending`, `updateReportNextSchedule`

### 2.31 SMTP Config (L4220–L4245)
- `getSmtpConfig`, `createOrUpdateSmtpConfig`

### 2.32 MQTT Clients (L4250–L4510)
- `getMqttClients`, `getMqttClientById`, `getMqttClientByDeviceId`
- `approveMqttClient`, `rejectMqttClient`
- `updateMqttClientMapping`, `updateMqttClientSettings`, `deleteMqttClient`, `disconnectAndResetMqttClient`
- `getMqttErrorSummaries`, `getMqttMessageLogs`
- `getMqttDashboardStats`, `getMqttMessageTrend`, `getRecentMqttMessages`

### 2.33 MQTT FCM/Push (L4510–L4555)
- `updateMqttClientFcmToken`, `getMqttClientsWithFcmToken`, `getOfflineMqttClientsWithFcmToken`

### 2.34 MQTT Realtime Stats (L4558–L4680)
- `getMqttMessageCountSince`, `getMqttLatencyStats`, `getMqttThroughputHistory`

### 2.35 MQTT Alert Rules (L4685–L4810)
- `getMqttAlertRules`, `getMqttAlertRuleById`, `getEnabledMqttAlertRules`
- `createMqttAlertRule`, `updateMqttAlertRule`, `deleteMqttAlertRule`, `updateMqttAlertRuleLastTriggered`

### 2.36 MQTT Alert History (L4815–L4905)
- `getMqttAlertHistory`, `getUnresolvedMqttAlerts`, `createMqttAlertHistoryEntry`, `resolveMqttAlert`

### 2.37 System Config (L4910–L4970)
- `getAllSystemConfig`, `getSystemConfigByKey`, `updateSystemConfig`, `createSystemConfig`

### 2.38 Corporate/Factory Statistics (L4975–L5350)
- `getYieldRateByCorporate`, `getYieldRateByFactory`
- `getThroughputByCorporate`, `getThroughputByFactory`

### 2.39 Bulk Import Helpers (L5355–L5395)
- `getFactoryByCode`, `getWorkshopByCode`, `getStationByCode`, `getProductionLineByCode`

### 2.40 User Assignments (L5400–L5495)
- `getUserCorporateAssignments`, `getUserFactoryAssignments`
- `createCorporateAssignment`, `createFactoryAssignment`
- `deleteCorporateAssignment`, `deleteFactoryAssignment`
- `reassignCorporate`, `reassignFactory`
- `hasAccessToCorporate`, `hasAccessToFactory`

### 2.41 Email Template Config (L5500–L5595)
- `getEmailTemplateConfigs`, `getEmailTemplateConfigById`, `getDefaultEmailTemplateConfig`
- `createEmailTemplateConfig`, `updateEmailTemplateConfig`, `deleteEmailTemplateConfig`
- `setDefaultEmailTemplateConfig`

### 2.42 Notifications (L5600–L5720)
- `createNotification`, `getNotifications`, `getUnreadNotificationCount`
- `markNotificationAsRead`, `markAllNotificationsAsRead`
- `deleteNotification`, `deleteOldNotifications`, `broadcastNotification`

### 2.43 User Notification Preferences (L5725–L5520)
- `getUserNotificationPreferences`, `upsertUserNotificationPreferences`

### 2.44 User Settings (L5525–L5555)
- `getUserSettings`, `upsertUserSettings`

### 2.45 Dashboard Widget Layouts (L5560–L5610)
- `getDashboardWidgetLayout`, `saveDashboardWidgetLayout`, `resetDashboardWidgetLayout`

### 2.46 Dashboard Templates — Shared (L5620–L5730)
- `getDashboardTemplates`, `listDashboardTemplates`, `getDashboardTemplateById`
- `createDashboardTemplate`, `updateDashboardTemplate`, `deleteDashboardTemplate`
- `incrementTemplateUsage`, `applyDashboardTemplate`

### 2.47 User Custom Dashboards (L5735–L5870)
- `getUserCustomDashboards`, `getPublicCustomDashboards`, `getUserCustomDashboardById`
- `createUserCustomDashboard`, `updateUserCustomDashboard`, `deleteUserCustomDashboard`
- `duplicateUserCustomDashboard`, `toggleCustomDashboardFavorite`, `toggleCustomDashboardPublic`
- `saveCustomDashboardFromTemplate`

### 2.48 Processes (L5875–L5950)
- `getProcesses`, `getProcessById`, `getProcessByCode`
- `createProcess`, `updateProcess`, `deleteProcess`, `reorderProcesses`

### 2.49 Line Process Assignments (L5960–L6045)
- `getLineProcessAssignments`, `getLineProcessAssignmentById`
- `createLineProcessAssignment`, `updateLineProcessAssignment`, `deleteLineProcessAssignment`
- `reorderLineProcessAssignments`, `deleteLineProcessAssignmentsByLine`

### 2.50 Top NG Analysis Enhanced (L6050–L6140)
- `getTopNGMeasurementPointsEnhanced`

### 2.51 Trend Analysis (L6145–L6230)
- `getYieldTrendData`

### 2.52 Anomaly Detection (L6235–L6300)
- `getRecentYieldData`

### 2.53 Workstation NG Analysis (L6305–L6430)
- `getNGByWorkstation`

### 2.54 Widget Style Presets (L6435–L6520)
- `getWidgetStylePresets`, `getWidgetStylePresetById`
- `createWidgetStylePreset`, `updateWidgetStylePreset`, `deleteWidgetStylePreset`
- `incrementWidgetStylePresetUsage`
- `getPublicWidgetStylePresets`, `getUserWidgetStylePresets`

### 2.55 Workstation-Measurement Point Linked Analysis (L6525–L6580)
- `getNGByMeasurementPointForWorkstation`, `getLinkedMeasurementPointsForWorkstation`
- `getSharedWidgetStylePresets`

### 2.56 Cursor-Based Pagination Helpers (L6585–L6880)
- `encodeCursor`, `decodeCursor` (utility functions)
- `getProductInspectionsCursor`, `getMeasurementResultsCursor`
- `getAlertHistoryCursor`, `getMqttAlertHistoryCursor`

### 2.57 Product Categories (L6885–L6990)
- `getProductCategories`, `getProductCategoryById`, `getProductCategoryByCode`
- `createProductCategory`, `updateProductCategory`, `deleteProductCategory`
- `getProductCategoryTree`, `updateProductCategoryCount`, `reorderProductCategories`

### 2.58 Backup/Restore (L6995–L7090)
- `exportSystemConfig`, `importSystemConfig`

### 2.59 Backup Logs (L7095–L7145)
- `createBackupLog`, `listBackupLogs`

### 2.60 Scheduled Backups (L7150–L7220)
- `createScheduledBackup`, `updateScheduledBackup`, `deleteScheduledBackup`
- `listScheduledBackups`, `getScheduledBackupById`, `getScheduledBackupsDue`

### 2.61 Template Marketplace (L7225–L7330)
- `publishTemplateToMarketplace`, `listMarketplaceTemplates`, `getMarketplaceTemplateById`
- `incrementTemplateDownloads`, `updateMarketplaceTemplate`, `deleteMarketplaceTemplate`

### 2.62 Template Reviews (L7335–L7385)
- `createTemplateReview`, `listTemplateReviews`, `updateMarketplaceRating`

### 2.63 Production Order Templates (L7390–L7440)
- `listOrderTemplates`, `getOrderTemplate`, `createOrderTemplate`, `updateOrderTemplate`, `deleteOrderTemplate`

### 2.64 WIP Tracking (L7445–L7500)
- `getWIPStatus`, `getWIPByLine`

### 2.65 Scheduling Optimization (L7505–L7600)
- `optimizeSchedule`, `applyScheduleSuggestion`

### 2.66 MQTT Client Create (L7605–L7650)
- `createMqttClient`

### 2.67 MQTT Client Connection History (L7655–L7680)
- `getMqttClientConnectionHistory`

### 2.68 MQTT Client Health (L7685–L7785)
- `getMqttClientHealth`, `calculateClientHealthScore` (private helper), `getAllMqttClientsHealth`

### 2.69 Workstation Errors (L7790–L7815)
- `getWorkstationErrors`, `getWorkstationErrorSummary`

---

## 3. Router Inline Procedures

**File:** `server/routers.ts` (9,715 lines)  
**Total:** 55+ sub-routers defined inline, ~320+ procedures

### 3.1 `factoryRouter` (~L155–L225)
| Procedure | Type | Auth |
|-----------|------|------|
| `list` | query | user |
| `getById` | query | user |
| `create` | mutation | admin |
| `update` | mutation | admin |
| `delete` | mutation | admin |

### 3.2 `workshopRouter` (~L226–L270)
| Procedure | Type | Auth |
|-----------|------|------|
| `list` | query | user |
| `listByFactory` | query | user |
| `create` | mutation | admin |
| `update` | mutation | admin |
| `delete` | mutation | admin |

### 3.3 `lineRouter` (~L271–L315)
| Procedure | Type | Auth |
|-----------|------|------|
| `list` | query | user |
| `listByWorkshop` | query | user |
| `create` | mutation | admin |
| `update` | mutation | admin |
| `delete` | mutation | admin |

### 3.4 `stationRouter` (~L316–L365)
| Procedure | Type | Auth |
|-----------|------|------|
| `list` | query | user |
| `listByLine` | query | user |
| `create` | mutation | admin |
| `update` | mutation | admin |
| `delete` | mutation | admin |

### 3.5 `machineRouter` (~L366–L627)
| Procedure | Type | Auth |
|-----------|------|------|
| `register` | mutation | **public** |
| `config` | query | **public** |
| `list` | query | user |
| `listByStation` | query | user |
| `getById` | query | user |
| `getStats` | query | user |
| `updateLayoutPosition` | mutation | admin |

### 3.6 `productModelRouter` (~L628–L808)
| Procedure | Type | Auth |
|-----------|------|------|
| `list` | query | user |
| `getById` | query | user |
| `getByCode` | query | user |
| `create` | mutation | admin |
| `update` | mutation | admin |
| `delete` | mutation | admin |

### 3.7 `measurementPointDefRouter` (~L809–L921)
| Procedure | Type | Auth |
|-----------|------|------|
| `listByProductModel` | query | user |
| `listByMachine` | query | user |
| `getById` | query | user |
| `create` | mutation | admin |
| `update` | mutation | admin |
| `delete` | mutation | admin |
| `templates` | query | user |

### 3.8 `inspectionRouter` (~L922–L1149)
| Procedure | Type | Auth |
|-----------|------|------|
| `list` | query | user |
| `search` | query | user |
| `getById` | query | user |
| `confirmNTF` | mutation | user |
| `listCursor` | query | user |
| `topNGPoints` | query | user |
| `aiAnalysis` | query | user |

### 3.9 `measurementResultRouter` (~L1150–L1433)
| Procedure | Type | Auth |
|-----------|------|------|
| `getByInspection` | query | user |
| `getById` | query | user |
| `updateRemark` | mutation | user |
| `analyzeWithAI` | mutation | user |
| `batchAcknowledge` | mutation | user |
| `batchAddNote` | mutation | user |
| `batchAddTag` | mutation | user |
| `batchArchive` | mutation | user |
| `correctResult` | mutation | admin |

### 3.10 `layoutRouter` (~L1434–L1525)
| Procedure | Type | Auth |
|-----------|------|------|
| `listByWorkshop` | query | user |
| `getById` | query | user |
| `create` | mutation | admin |
| `update` | mutation | admin |
| `delete` | mutation | admin |

### 3.11 `dashboardRouter` (~L1526–L1793)
| Procedure | Type | Auth |
|-----------|------|------|
| `getStats` | query | user |
| `getMachineStats` | query | user |
| `getAllMachinesStats` | query | user |
| `getDailyStats` | query | user |
| `getStatsWithComparison` | query | user |
| `getShiftStats` | query | user |
| `getTopBottomMachines` | query | user |
| `getActiveAlertsCount` | query | user |
| `getHourlyStats` | query | user |
| `listTemplates` | query | user |
| `getTemplate` | query | user |
| `applyTemplate` | mutation | user |

### 3.12 `apiRouter` (~L1794–L2390) — **Public machine API**
| Procedure | Type | Auth |
|-----------|------|------|
| `submitInspection` | mutation | **public** |
| `uploadImage` | mutation | **public** |
| `syncMeasurementPoints` | mutation | **public** |
| `heartbeat` | mutation | **public** |
| `getPoints` | query | **public** |

### 3.13 `productMachineMappingRouter` (~L2391–L2445)
| Procedure | Type | Auth |
|-----------|------|------|
| `list` | query | user |
| `byMachine` | query | user |
| `byProduct` | query | user |
| `create` | mutation | admin |
| `update` | mutation | admin |
| `delete` | mutation | admin |

### 3.14 `shiftConfigRouter` (~L2446–L2499)
| Procedure | Type | Auth |
|-----------|------|------|
| `list` | query | user |
| `defaults` | query | user |
| `create` | mutation | admin |
| `update` | mutation | admin |
| `delete` | mutation | admin |

### 3.15 `usersRouter` (~L2500–L2873)
| Procedure | Type | Auth |
|-----------|------|------|
| `list` | query | user |
| `updateRole` | mutation | admin |
| `delete` | mutation | admin |
| `updateProfile` | mutation | user |
| `changePassword` | mutation | user |
| `setup2FA` | mutation | user |
| `verify2FA` | mutation | user |
| `disable2FA` | mutation | user |
| `get2FAStatus` | query | user |
| `generateBackupCodes` | mutation | user |
| `getBackupCodesStatus` | query | user |
| `getSessions` | query | user |
| `revokeSession` | mutation | user |
| `revokeAllSessions` | mutation | user |

### 3.16 `alertSettingsRouter` (~L2874–L3027)
| Procedure | Type | Auth |
|-----------|------|------|
| `list` | query | user |
| `getById` | query | user |
| `create` | mutation | admin |
| `update` | mutation | admin |
| `delete` | mutation | admin |
| `history` | query | user |
| `historyCursor` | query | user |
| `acknowledge` | mutation | user |
| `test` | mutation | admin |

### 3.17 `productionOrdersRouter` (~L3028–L3392)
| Procedure | Type | Auth |
|-----------|------|------|
| `list` | query | user |
| `getById` | query | user |
| `getByCode` | query | user |
| `create` | mutation | admin |
| `update` | mutation | admin |
| `delete` | mutation | admin |
| `checkScheduleOverlap` | query | user |
| `listTemplates` | query | user |
| `getTemplate` | query | user |
| `createFromTemplate` | mutation | admin |
| `getWIPStatus` | query | user |
| `getWIPByLine` | query | user |
| `optimizeSchedule` | query | admin |

### 3.18 `lineStagesRouter` (~L3393–L3456)
| Procedure | Type | Auth |
|-----------|------|------|
| `list` | query | user |
| `getById` | query | user |
| `create` | mutation | admin |
| `update` | mutation | admin |
| `delete` | mutation | admin |

### 3.19 `lineProductAssignmentsRouter` (~L3457–L3508)
| Procedure | Type | Auth |
|-----------|------|------|
| `list` | query | user |
| `create` | mutation | admin |
| `update` | mutation | admin |
| `delete` | mutation | admin |

### 3.20 `machineStatusRouter` (~L3509–L3605)
| Procedure | Type | Auth |
|-----------|------|------|
| `listWithStatus` | query | user |
| `getLogs` | query | user |
| `getHeartbeats` | query | user |
| `getUptimeStats` | query | user |
| `getUptimeTimeline` | query | user |
| `getAllUptimeTimelines` | query | user |
| `getReport` | query | user |

### 3.21 `manualMappingRouter` (~L3606–L3740)
| Procedure | Type | Auth |
|-----------|------|------|
| `list` | query | user |
| `getById` | query | user |
| `getByCategory` | query | user |
| `create` | mutation | admin |
| `update` | mutation | admin |
| `delete` | mutation | admin |

### 3.22 `mqttClientRouter` (~L3741–L3880)
| Procedure | Type | Auth |
|-----------|------|------|
| `list` | query | user |
| `getById` | query | user |
| `getByMachineId` | query | user |
| `create` | mutation | admin |
| `update` | mutation | admin |
| `delete` | mutation | admin |
| `alertRules` | query | user |
| `alertHistory` | query | user |
| `pendingCount` | query | user |

### 3.23 `mqttDashboardRouter` (~L3956–L4184)
| Procedure | Type | Auth |
|-----------|------|------|
| `status` | query | user |
| `errorSummaries` | query | user |
| `messageLogs` | query | user |
| `dashboardStats` | query | user |
| `messageTrend` | query | user |
| `recentMessages` | query | user |
| `updateFcmToken` | mutation | user |
| `testNGAlert` | mutation | admin |
| `realtimeStats` | query | user |
| `throughputHistory` | query | user |
| `messageHistory` | query | user |
| `discoveredMachines` | query | user |

### 3.24 `oeeRouter` (~L4185–L4381)
| Procedure | Type | Auth |
|-----------|------|------|
| `calculateOEE` | query | user |
| `getMachineOEE` | query | user |
| `getAllOEE` | query | user |
| `startDowntime` | mutation | user |
| `endDowntime` | mutation | user |
| `getActiveDowntime` | query | user |
| `getDowntimeHistory` | query | user |
| `calculateMachineHealth` | query | user |
| `getMachineHealth` | query | user |
| `connectionHistory` | query | user |
| `clientHealth` | query | user |
| `allClientsHealth` | query | user |
| `workstationErrors` | query | user |
| `workstationErrorSummary` | query | user |
| `calculateBenchmarks` | query | user |

### 3.25 `oeeTargetsRouter` (~L4382–L4495)
| Procedure | Type | Auth |
|-----------|------|------|
| `listTargets` | query | user |
| `createTarget` | mutation | admin |
| `updateTarget` | mutation | admin |
| `deleteTarget` | mutation | admin |

### 3.26 `yieldAlertThresholdsRouter` (~L4496–L4598)
| Procedure | Type | Auth |
|-----------|------|------|
| `list` | query | user |
| `getById` | query | user |
| `create` | mutation | admin |
| `update` | mutation | admin |
| `delete` | mutation | admin |
| `toggle` | mutation | admin |
| `history` | query | user |
| `unresolved` | query | user |
| `resolve` | mutation | user |

### 3.27 `yieldThresholdHistoryRouter` (~L4599–L4753)
| Procedure | Type | Auth |
|-----------|------|------|
| `list` | query | user |
| `getById` | query | user |
| `getByType` | query | user |
| `update` | mutation | admin |
| `getEnabled` | query | user |
| `getHistory` | query | user |
| `getHistoryByType` | query | user |
| `getHistoryByThreshold` | query | user |
| `updateWithHistory` | mutation | admin |

### 3.28 `workstationRouter` (~L4754–L4881)
| Procedure | Type | Auth |
|-----------|------|------|
| `list` | query | user |
| `getById` | query | user |
| `create` | mutation | admin |
| `update` | mutation | admin |
| `delete` | mutation | admin |
| `defectsByWorkstation` | query | user |
| `summary` | query | user |
| `topNGMeasurementPoints` | query | user |
| `measurementPointsByWorkstation` | query | user |
| `ngTrend` | query | user |
| `ngComparison` | query | user |

### 3.29 `scheduledReportsRouter` (~L4882–L5167)
| Procedure | Type | Auth |
|-----------|------|------|
| `list` | query | user |
| `getById` | query | user |
| `create` | mutation | admin |
| `update` | mutation | admin |
| `delete` | mutation | admin |
| `getLogs` | query | user |

### 3.30 `reportTemplatesRouter` (~L5168–L5528)
| Procedure | Type | Auth |
|-----------|------|------|
| `listTemplates` | query | user |
| `getTemplateById` | query | user |
| `getTemplateByCode` | query | user |

### 3.31 `corporateStatsRouter` (~L5529–L5873)
| Procedure | Type | Auth |
|-----------|------|------|
| `yieldRateByCorporate` | query | user |
| `yieldRateByFactory` | query | user |
| `throughputByCorporate` | query | user |
| `throughputByFactory` | query | user |
| `machineStats` | query | user |

### 3.32 `exportRouter` (~L5874–L6368)
| Procedure | Type | Auth |
|-----------|------|------|
| `exportInspections` | query | user |
| `exportDashboardStats` | query | user |
| `exportProducts` | query | user |
| `exportMachines` | query | user |
| `exportMeasurementPoints` | query | user |
| `exportFactories` | query | user |
| `exportWorkshops` | query | user |

### 3.33 `assignmentsRouter` (~L6369–L6461)
| Procedure | Type | Auth |
|-----------|------|------|
| `getMyAssignments` | query | user |

### 3.34 `notificationsRouter` (~L6462–L6582)
| Procedure | Type | Auth |
|-----------|------|------|
| `list` | query | user |
| `unreadCount` | query | user |
| `markAsRead` | mutation | user |
| `markAllAsRead` | mutation | user |
| `delete` | mutation | user |
| `deleteOld` | mutation | user |
| `getPreferences` | query | user |
| `updatePreferences` | mutation | user |
| `sendToUser` | mutation | admin |
| `broadcast` | mutation | admin |

### 3.35 `userSettingsRouter` (~L6585–L6617)
| Procedure | Type | Auth |
|-----------|------|------|
| `get` | query | user |
| `update` | mutation | user |

### 3.36 `dashboardWidgetRouter` (~L6620–L7200)

#### Layout Management (~L6620–L6770)
| Procedure | Type | Auth |
|-----------|------|------|
| `getLayout` | query | user |
| `saveLayout` | mutation | user |
| `resetLayout` | mutation | user |
| `getSharedTemplates` | query | user |
| `getSharedTemplateById` | query | user |
| `createSharedTemplate` | mutation | admin |
| `updateSharedTemplate` | mutation | admin |
| `deleteSharedTemplate` | mutation | admin |
| `applySharedTemplate` | mutation | user |
| `saveAsSharedTemplate` | mutation | admin |

#### Widget Style Presets (~L6770–L6970)
| Procedure | Type | Auth |
|-----------|------|------|
| `getStylePresets` | query | user |
| `getStylePresetById` | query | user |
| `createStylePreset` | mutation | user |
| `updateStylePreset` | mutation | user |
| `deleteStylePreset` | mutation | user |
| `applyStylePreset` | mutation | user |
| `getPublicStylePresets` | query | user |
| `exportStylePreset` | query | user |
| `importStylePreset` | mutation | user |
| `exportAllUserPresets` | query | user |
| `importMultiplePresets` | mutation | user |
| `sharePreset` | mutation | admin |
| `unsharePreset` | mutation | admin |
| `getSharedStylePresets` | query | user |
| `cloneSharedPreset` | mutation | user |

#### Custom Dashboards (~L6970–L7200)
| Procedure | Type | Auth |
|-----------|------|------|
| `listCustomDashboards` | query | user |
| `listPublicDashboards` | query | user |
| `getCustomDashboard` | query | user |
| `createCustomDashboard` | mutation | user |
| `updateCustomDashboard` | mutation | user |
| `deleteCustomDashboard` | mutation | user |
| `duplicateCustomDashboard` | mutation | user |
| `toggleCustomDashboardFavorite` | mutation | user |
| `toggleCustomDashboardPublic` | mutation | user |
| `exportCustomDashboard` | query | user |
| `importCustomDashboard` | mutation | user |
| `saveCustomDashboardAsTemplate` | mutation | admin |

### 3.37 `productCategoryRouter` (~L7200–L7370)
| Procedure | Type | Auth |
|-----------|------|------|
| `list` | query | user |
| `getById` | query | user |
| `getByCode` | query | user |
| `getTree` | query | user |
| `create` | mutation | admin |
| `update` | mutation | admin |
| `delete` | mutation | admin |
| `reorder` | mutation | admin |
| `updateCount` | mutation | admin |

### 3.38 `drillDownRouter` (~L7370–L7600)
| Procedure | Type | Auth |
|-----------|------|------|
| `corporateStats` | query | user |
| `factoriesByCorporate` | query | user |
| `linesByFactory` | query | user |
| `machinesByLine` | query | user |

### 3.39 `annotationRouter` (~L7600–L8800) — **Largest sub-router**
| Procedure | Type | Auth |
|-----------|------|------|
| `save` | mutation | user |
| `getByImage` | query | user |
| `getByInspection` | query | user |
| `search` | query | user |
| `statistics` | query | user |
| `bulkApplyTemplate` | mutation | user |
| `bulkDelete` | mutation | user |
| `copyAnnotations` | mutation | user |
| `analyzeImage` | mutation | user |
| `delete` | mutation | user |
| `comparison` | query | user |
| `heatmapData` | query | user |
| `trendPrediction` | query | user |
| `export` | query | user |
| `import` | mutation | user |

### 3.40 `annotationTemplateRouter` (~L8800–L8900)
| Procedure | Type | Auth |
|-----------|------|------|
| `list` | query | user |
| `create` | mutation | user |
| `delete` | mutation | user |

### 3.41 `rootCauseRouter` (~L8900–L9200)
| Procedure | Type | Auth |
|-----------|------|------|
| `analyze` | mutation | user |
| `list` | query | user |
| `get` | query | user |

### 3.42 `annotationHistoryRouter` (~L9200–L9350)
| Procedure | Type | Auth |
|-----------|------|------|
| `list` | query | user |
| `get` | query | user |
| `rollback` | mutation | user |
| `compare` | query | user |

### 3.43 `predictiveAlertRouter` (~L9350–L9620)
| Procedure | Type | Auth |
|-----------|------|------|
| `list` | query | user |
| `get` | query | user |
| `acknowledge` | mutation | user |
| `resolve` | mutation | user |
| `dismiss` | mutation | user |
| `generatePredictions` | mutation | user |
| `stats` | query | user |

### 3.44 Final `appRouter` Export (~L9620–L9715)

All 55+ sub-routers registered:

```
system, auth, factory, workshop, line, station, machine, productModel,
measurementPoint, inspection, measurementResult, layout, dashboard,
machineApi, seedData, alert, user, productMachineMapping, shiftConfig,
productionOrder, lineStage, lineProductAssignment, machineStatus,
bulkImport, manualMapping, yieldThreshold, audit, workstation, template,
scheduledReport, smtp, mqttClient, mqttAlert, systemConfig,
corporateFactoryStats, import, export, userAssignment, notification,
userSettingsRouter, dashboardWidget, process, spcAnalysis, twoFactor,
session, productCategory, oee, drillDown, annotation, annotationTemplate,
rootCause, annotationHistory, predictiveAlert, annotationComparison,
defectHeatmap, aiFeedback, trainingBatchComments, mqttClientManagement,
mqttBulletin, aoiPackage, permissions, backup, webhook
```

---

## 4. External Router Files

**Directory:** `server/routers/`  
**Total:** 16 router files + 11 test files

| # | File | Domain |
|---|------|--------|
| 1 | `processRouter.ts` | Processes |
| 2 | `spcAnalysisRouter.ts` | SPC Analysis |
| 3 | `twoFactorRouter.ts` | 2FA Auth |
| 4 | `sessionRouter.ts` | Sessions |
| 5 | `annotationComparisonRouter.ts` | Annotation Comparison |
| 6 | `defectHeatmapRouter.ts` | Defect Heatmaps |
| 7 | `aiFeedbackRouter.ts` | AI Feedback |
| 8 | `trainingBatchCommentsRouter.ts` | AI Training |
| 9 | `mqttClientManagementRouter.ts` | MQTT Client Management |
| 10 | `mqttBulletinRouter.ts` | MQTT Bulletin |
| 11 | `aoiPackageRouter.ts` | AOI Package Upload |
| 12 | `permissionsRouter.ts` | Permissions |
| 13 | `backupRouter.ts` | Backup/Restore |
| 14 | `webhookRouter.ts` | Webhooks |
| 15 | `auditRouter.ts` | Audit Logs |
| 16 | `reportScheduleRouter.ts` | Report Scheduling |

### Test Files (11)
- `*.test.ts` files covering: audit, backup, permissions, sessions, SPC analysis, 2FA, webhook, MQTT bulletin, AI feedback, training batch, MQTT client management

---

## 5. Pages with Hardcoded/Mock Data

**Directory:** `client/src/pages/` (64 total page files)  
**Found:** 8 pages with hardcoded or mock data patterns

### 5.1 Entirely Mock Pages (No Backend Integration)

#### `HistoryExportScheduling.tsx` (931 lines)
- **L64:** `MOCK_SCHEDULES` — Array of 3 hardcoded schedule objects
- **L126:** `MOCK_LOGS` — Array of 3 hardcoded log objects
- **Impact:** Page is completely non-functional (no tRPC queries at all)
- **Action needed:** Build backend API + replace mocks with tRPC queries

#### `DashboardMarketplace.tsx` (485 lines)
- **L41:** `MOCK_TEMPLATES` — Array of 5 hardcoded marketplace template objects
- **Impact:** Page is completely non-functional (no tRPC queries)
- **Action needed:** Connect to template marketplace DB functions

#### `CorporateDashboard.tsx` (421 lines)
- **L48:** `corporateOverview` — Hardcoded overview stats
- **L59:** `corporationData` — Hardcoded corporation data array
- **L65:** `monthlyTrend` — Hardcoded monthly trend data
- **Impact:** Page displays only static dummy data (no tRPC queries)
- **Action needed:** Connect to `corporateStatsRouter` / `drillDownRouter` APIs

#### `CustomDashboard.tsx` (429 lines)
- **L32:** `mockLayouts` — Array of 2 mock dashboard layout objects
- **Storage:** Uses localStorage fallback instead of backend persistence
- **Impact:** No backend integration — all dashboards lost on browser clear
- **Action needed:** Connect to `dashboardWidgetRouter` custom dashboards API

### 5.2 Partially Mock Pages (Mixed Real + Fake Data)

#### `CorporateLayout.tsx` (823 lines)
- **L91:** `mockStats` — Generated with `Math.random()` inside `useMemo`
- **Real data:** Uses tRPC queries for layout/hierarchy data
- **Impact:** Stats overlay on layout map shows random numbers
- **Action needed:** Replace `mockStats` with real corporate statistics API

#### `MachineHealthMonitoring.tsx` (751 lines)
- **L200:** Health history data generated with `Math.random()` for chart
- **Real data:** Uses `trpc.mqttClient.getMachineHealth.useQuery()` for current health score
- **Impact:** Historical health trend chart is entirely fabricated
- **Action needed:** Use `machine_health_history` table + real historical data

#### `DashboardTemplates.tsx` (385 lines)
- **L29:** `SYSTEM_TEMPLATES` — Hardcoded array of 4 template objects:
  - `production-overview`, `quality-control`, `machine-health`, `executive-summary`
- **Real data:** Uses tRPC for shared templates
- **Impact:** System templates cannot be edited or managed by admins
- **Action needed:** Move system templates to DB, seed via migration

### 5.3 Intentional Static Content (Likely OK)

#### `Home.tsx`
- **L36:** `features` — Array of feature descriptions for landing page
- **L69:** `stats` — Array of static statistics for landing page
- **Impact:** Landing page marketing content — likely intentional
- **Action needed:** None (unless dynamic content is desired)

---

## Summary Statistics

| Area | Count | File(s) | Lines |
|------|-------|---------|-------|
| Schema tables | 99 | `drizzle/schema.ts` | 3,412 |
| DB functions | ~350 | `server/db.ts` | 7,815 |
| Inline router procedures | ~320+ | `server/routers.ts` | 9,715 |
| External router files | 16 | `server/routers/*.ts` | — |
| Pages with mock data | 8 | `client/src/pages/` | — |
| **Total monolithic code** | — | `db.ts` + `routers.ts` | **17,530** |

### Key Refactoring Observations

1. **Monolithic files are the #1 problem**: `routers.ts` (9,715 lines) and `db.ts` (7,815 lines) together form 17,530 lines — splitting these by domain is the highest-impact refactoring.

2. **16 router files already extracted** — follow this pattern to extract the remaining ~40 inline sub-routers from `routers.ts`.

3. **db.ts has 65 domain sections** — each section can become its own module (e.g., `server/db/mqtt.ts`, `server/db/factory.ts`).

4. **4 pages are entirely non-functional** with only mock data: `HistoryExportScheduling`, `DashboardMarketplace`, `CorporateDashboard`, `CustomDashboard`. These need backend integration.

5. **MQTT is the largest domain** spanning 18 schema tables, 30+ DB functions, and 3 sub-routers — consider a dedicated `server/mqtt/` module.

6. **99 schema tables** in one file — consider splitting by domain into `schema/auth.ts`, `schema/mqtt.ts`, etc.
