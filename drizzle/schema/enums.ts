// Schema domain: Enum definitions
import { pgEnum } from "drizzle-orm/pg-core";

// PostgreSQL Enum Definitions
export const roleEnum = pgEnum("roleenum", [
  "admin",           // Full system access
  "supervisor",      // Workshop supervisor - manage operators and view all data
  "quality_inspector", // QC specialist - focus on quality control and reports
  "operator",        // Machine operator - submit inspections, view assigned machines
  "maintenance",     // Maintenance technician - machine status and logs
  "engineer",        // Automation-programming engineer (PLC/robot/Zmotion)
  "viewer",          // Read-only access - dashboards and reports only
  "user"             // Basic user access (default)
]);
export const machineTypeEnum = pgEnum("machinetypeenum", [
  "AVI",        // Automated Visual Inspection
  "AOI",        // Automated Optical Inspection
  "SPI",        // Solder Paste Inspection
  "AXI",        // Automated X-ray Inspection
  "ICT",        // In-Circuit Test
  "FCT",        // Functional Circuit Test
  "CMM",        // Coordinate Measuring Machine
  "AUTOMATION", // General automation station
  // --- Sprint F2: generic device model for any machine type ---
  "FEEDER",     // Component feeder
  "ASSEMBLY",   // Assembly station
  "SCREWDRIVE", // Automatic screwdriving station
  "DISPENSING", // Glue / paste dispensing
  "ICT_FUNC",   // Combined ICT + functional test cell
  "ROBOT_TEST", // Robotic test cell
  "PACKAGING",  // Packaging station
  "PALLETIZER", // Palletizer
  "ROBOT",      // Generic industrial robot
  // --- doc 40 W5 (MTX-03): SMT line machine types (migration 0241_smt_machine_types) ---
  "MOUNTER",         // SMT pick-and-place mounter
  "REFLOW",          // Reflow soldering oven
  "STENCIL_PRINTER", // Solder-paste stencil printer
  "WAVE_SOLDER",     // Wave / selective soldering
  // --- doc 56 Đ0 việc 5 (migration 0287_device_class_types): WELDER + IoT device classes ---
  "WELDER",          // Welding cell (process automation; deviceClass "automation")
  "IOT_SENSOR",      // Self-developed IoT sensor — telemetry-only (deviceClass "iot")
  "IOT_GATEWAY",     // Self-developed IoT gateway / relay (deviceClass "iot")
]);
// Sprint F2 — outcome of a generic process/station step (telemetry RESULT, not a control command)
export const processResultEnum = pgEnum("processresultenum", ["pass", "fail", "warn", "skip"]);
export const operationStatusEnum = pgEnum("operationstatusenum", [
  "running",
  "stopped",
  "error",
  "maintenance",
  "warming_up",  // Post-startup stabilization period
  "changeover",  // Product changeover / recipe change in progress
  "starved",     // Waiting for upstream material (line balance)
  "blocked",     // Blocked by downstream station (line balance)
]);
export const lifecycleStatusEnum = pgEnum("lifecyclestatusenum", ["development", "active", "eol", "archived"]);
export const measurementTypeEnum = pgEnum("measurementtypeenum", ["DIMENSION", "VISUAL", "ELECTRICAL", "POSITION", "COLOR", "SURFACE", "OTHER"]);
export const overallResultEnum = pgEnum("overallresultenum", ["OK", "NG", "NTF"]);
export const originalResultEnum = pgEnum("originalresultenum", ["OK", "NG"]);
export const layoutLevelEnum = pgEnum("layoutlevelenum", ["CORPORATION", "FACTORY", "WORKSHOP"]);
export const layoutTypeEnum = pgEnum("layouttypeenum", ["2D", "3D"]);
export const alertTypeEnum = pgEnum("alerttypeenum", ["yield_rate", "ng_count", "machine_status", "machine_offline"]);
export const comparisonOperatorEnum = pgEnum("comparisonoperatorenum", ["lt", "lte", "gt", "gte", "eq"]);
export const statusEnum = pgEnum("statusenum", ["pending", "in_progress", "completed", "cancelled", "paused"]);
export const statusEnum_1 = pgEnum("statusenum_1", ["online", "offline"]);
export const protocolEnum = pgEnum("protocolenum", ["websocket", "tcp", "http"]);
export const connectionStatusEnum = pgEnum("connectionstatusenum", ["connected", "disconnected", "error", "pending"]);
export const metricTypeEnum = pgEnum("metrictypeenum", ["FPY", "FY", "NTF", "UPH"]);
export const comparisonOperatorEnum_1 = pgEnum("comparisonoperatorenum_1", ["gt", "lt", "gte", "lte"]);
export const statusEnum_2 = pgEnum("statusenum_2", ["success", "failure"]);
export const processTypeEnum = pgEnum("processtypeenum", ["SMT", "DIP", "ASSEMBLY", "TESTING", "PACKAGING", "OTHER"]);
export const reportTypeEnum = pgEnum("reporttypeenum", ["NG_VISUAL", "DAILY_SUMMARY", "WEEKLY_SUMMARY", "MONTHLY_SUMMARY", "CUSTOM", "OEE_REPORT", "MACHINE_HEALTH"]);
export const scheduleEnum = pgEnum("scheduleenum", ["DAILY", "WEEKLY", "MONTHLY"]);
export const reportFormatEnum = pgEnum("reportformatenum", ["HTML", "PDF", "EXCEL"]);
export const statusEnum_3 = pgEnum("statusenum_3", ["SUCCESS", "FAILED", "PENDING"]);
export const approvalStatusEnum = pgEnum("approvalstatusenum", ["PENDING", "APPROVED", "REJECTED"]);
export const mappingTypeEnum = pgEnum("mappingtypeenum", ["AUTO", "MANUAL"]);
export const connectionStatusEnum_1 = pgEnum("connectionstatusenum_1", ["ONLINE", "OFFLINE", "DISCONNECTED"]);
export const summaryTypeEnum = pgEnum("summarytypeenum", ["DAILY", "WEEKLY"]);
export const messageTypeEnum = pgEnum("messagetypeenum", ["NG_ALERT", "DAILY_SUMMARY", "WEEKLY_SUMMARY", "CUSTOM", "COMMAND"]);
export const deliveryStatusEnum = pgEnum("deliverystatusenum", ["PENDING", "DELIVERED", "FAILED", "SENT"]);
export const ruleTypeEnum = pgEnum("ruletypeenum", ["LATENCY_THRESHOLD", "BROKER_DISCONNECT", "MESSAGE_FAILURE_RATE", "THROUGHPUT_LOW", "THROUGHPUT_HIGH", "CLIENT_OFFLINE"]);
export const comparisonOperatorEnum_2 = pgEnum("comparisonoperatorenum_2", ["GT", "GTE", "LT", "LTE", "EQ"]);
export const dataTypeEnum = pgEnum("datatypeenum", ["STRING", "NUMBER", "BOOLEAN", "JSON"]);
export const typeEnum = pgEnum("typeenum", ["ALERT", "REPORT", "SYSTEM", "INFO", "WARNING", "SUCCESS"]);
export const priorityEnum = pgEnum("priorityenum", ["LOW", "NORMAL", "HIGH", "URGENT"]);
export const themeEnum = pgEnum("themeenum", ["light", "dark", "system"]);
export const templateTypeEnum = pgEnum("templatetypeenum", ["system", "shared"]);
export const processTypeEnum_1 = pgEnum("processtypeenum_1", ["SMT", "DIP", "ASSEMBLY", "TESTING", "PACKAGING", "INSPECTION", "OTHER"]);
export const shadowEnum = pgEnum("shadowenum", ["none", "sm", "md", "lg", "xl"]);
export const presetTypeEnum = pgEnum("presettypeenum", ["system", "shared", "user"]);
export const actionEnum = pgEnum("actionenum", ["export", "import", "scheduled_export"]);
export const statusEnum_4 = pgEnum("statusenum_4", ["success", "failed", "partial"]);
export const scheduleEnum_1 = pgEnum("scheduleenum_1", ["daily", "weekly", "monthly"]);
export const storageTypeEnum = pgEnum("storagetypeenum", ["local", "s3"]);
export const lastRunStatusEnum = pgEnum("lastrunstatusenum", ["success", "failed"]);
export const periodTypeEnum = pgEnum("periodtypeenum", ["HOUR", "SHIFT", "DAY", "WEEK", "MONTH"]);
export const categoryEnum = pgEnum("categoryenum", ["planned", "unplanned", "breakdown", "changeover", "maintenance", "other"]);
export const detectionMethodEnum = pgEnum("detectionmethodenum", ["MANUAL", "AUTO", "MQTT"]);
export const maintenanceUrgencyEnum = pgEnum("maintenanceurgencyenum", ["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const templateTypeEnum_1 = pgEnum("templatetypeenum_1", ["DAILY", "WEEKLY", "MONTHLY", "CUSTOM"]);
export const changeTypeEnum = pgEnum("changetypeenum", ["CREATE", "UPDATE", "DELETE", "ROLLBACK"]);
export const alertTypeEnum_1 = pgEnum("alerttypeenum_1", ["DEFECT_SPIKE", "YIELD_DROP", "MACHINE_FAILURE", "QUALITY_DEGRADATION", "PATTERN_ANOMALY"]);
export const statusEnum_5 = pgEnum("statusenum_5", ["ACTIVE", "ACKNOWLEDGED", "RESOLVED", "DISMISSED", "EXPIRED"]);
// WS-4 — auto-schedule run lifecycle
export const scheduleRunStatusEnum = pgEnum("schedulerunstatusenum", ["DRAFT", "APPLIED", "DISMISSED"]);
export const analysisTypeEnum = pgEnum("analysistypeenum", ["DEFECT_ANALYSIS", "YIELD_ANALYSIS", "QUALITY_ANALYSIS", "MACHINE_ANALYSIS"]);
export const statusEnum_6 = pgEnum("statusenum_6", ["COMPLETED", "IN_PROGRESS", "FAILED"]);
export const exportFormatEnum = pgEnum("exportformatenum", ["CSV", "JSON", "EXCEL", "PDF"]);
export const resultFilterEnum = pgEnum("resultfilterenum", ["ALL", "OK", "NG", "NTF"]);
export const timeRangeTypeEnum = pgEnum("timerangetypeenum", ["LAST_24H", "LAST_7D", "LAST_30D", "LAST_MONTH", "CUSTOM"]);
export const statusEnum_7 = pgEnum("statusenum_7", ["SUCCESS", "FAILED", "PENDING", "RUNNING"]);
export const statusEnum_8 = pgEnum("statusenum_8", ["PENDING", "PROCESSING", "COMPLETED", "FAILED"]);
export const periodTypeEnum_1 = pgEnum("periodtypeenum_1", ["HOURLY", "DAILY", "WEEKLY", "MONTHLY"]);
export const suggestionTypeEnum = pgEnum("suggestiontypeenum", ["DEFECT_CLASSIFICATION", "ROOT_CAUSE", "CORRECTIVE_ACTION", "QUALITY_PREDICTION", "PROCESS_OPTIMIZATION"]);
export const statusEnum_9 = pgEnum("statusenum_9", ["PENDING", "ACCEPTED", "REJECTED", "REVIEWED"]);
export const feedbackTypeEnum = pgEnum("feedbacktypeenum", ["CORRECT", "INCORRECT", "PARTIAL", "UNSURE"]);
export const errorCategoryEnum = pgEnum("errorcategoryenum", ["FALSE_POSITIVE", "FALSE_NEGATIVE", "MISCLASSIFICATION", "WRONG_LOCATION", "WRONG_SEVERITY", "OTHER"]);
export const accuracyTrendEnum = pgEnum("accuracytrendenum", ["IMPROVING", "DECLINING", "STABLE"]);
export const exportFormatEnum_1 = pgEnum("exportformatenum_1", ["JSON", "CSV", "JSONL", "PARQUET"]);
export const statusEnum_10 = pgEnum("statusenum_10", ["PENDING", "PROCESSING", "COMPLETED", "FAILED", "UPLOADED"]);
export const protocolEnum_1 = pgEnum("protocolenum_1", ["mqtt", "mqtts", "ws", "wss"]);
export const defaultQosEnum = pgEnum("defaultqosenum", ["0", "1", "2"]);
export const targetTypeEnum = pgEnum("targettypeenum", ["machine", "station", "factory"]);
export const eventTypeEnum = pgEnum("eventtypeenum", ["connect", "disconnect", "error", "reconnect"]);
export const deviceTypeEnum = pgEnum("devicetypeenum", ["avi", "aoi", "spi", "other"]);
export const messageFormatEnum = pgEnum("messageformatenum", ["json", "xml", "csv", "binary"]);
export const eventTypeEnum_1 = pgEnum("eventtypeenum_1", ["attempt", "success", "failure", "max_attempts_reached"]);
export const statusEnum_11 = pgEnum("statusenum_11", ["connected", "disconnected", "connecting", "error", "unknown"]);
export const alertTypeEnum_2 = pgEnum("alerttypeenum_2", ["connection_lost", "reconnect_failed", "high_reconnect_rate", "long_disconnection"]);
export const severityEnum = pgEnum("severityenum", ["info", "warning", "critical"]);

// Sync enums
export const syncOperationEnum = pgEnum("syncoperationenum", ["POINTS_PUSH", "POINTS_PULL", "IMAGE_PUSH", "IMAGE_PULL", "FULL_SYNC", "DELTA_SYNC"]);
export const syncStatusEnum = pgEnum("syncstatusenum", ["SUCCESS", "PARTIAL", "FAILED"]);

// AI Model enums
export const modelFormatEnum = pgEnum("modelformatenum", ["ONNX", "TENSORRT", "OPENVINO", "CUSTOM", "GGUF"]);
export const modelStatusEnum = pgEnum("modelstatusenum", ["UPLOADING", "VALIDATING", "READY", "ACTIVE", "INACTIVE", "FAILED", "ARCHIVED"]);
export const inferenceStatusEnum = pgEnum("inferencestatusenum", ["PENDING", "RUNNING", "COMPLETED", "FAILED", "TIMEOUT"]);

// AI Comprehensive upgrade enums
export const batchJobStatusEnum = pgEnum("batchjobstatusenum", ["PENDING", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED"]);
export const batchItemStatusEnum = pgEnum("batchitemstatusenum", ["PENDING", "PROCESSING", "COMPLETED", "FAILED", "SKIPPED"]);
export const abTestStatusEnum = pgEnum("abteststatusenum", ["DRAFT", "RUNNING", "PAUSED", "COMPLETED", "CANCELLED"]);
export const abTestVariantEnum = pgEnum("abtestvariantenum", ["A", "B"]);
export const abTestWinnerEnum = pgEnum("abtestwinnerenum", ["A", "B", "INCONCLUSIVE"]);
export const driftAlertTypeEnum = pgEnum("driftalerttypeenum", ["ACCURACY_DROP", "LATENCY_SPIKE", "DRIFT_DETECTED", "ERROR_RATE_HIGH", "CONFIDENCE_SHIFT"]);
export const driftSeverityEnum = pgEnum("driftseverityenum", ["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const edgeDeployStatusEnum = pgEnum("edgedeploystatusenum", ["PENDING", "PACKAGING", "READY", "DOWNLOADING", "DEPLOYED", "ACTIVE", "FAILED", "OUTDATED"]);
export const trainingJobStatusEnum = pgEnum("trainingjobstatusenum", ["QUEUED", "PREPARING_DATA", "TRAINING", "VALIDATING", "COMPLETED", "FAILED", "CANCELLED"]);

// AI Quality Gate & Ensemble enums
export const aiDecisionEnum = pgEnum("aidecisionenum", ["AUTO_OK", "AUTO_NG", "NEEDS_REVIEW", "MANUAL"]);
export const ensembleStrategyEnum = pgEnum("ensemblestrategyenum", ["VOTING", "WEIGHTED_AVERAGE", "STACKING", "CASCADE"]);

// Active Learning enums
export const labelQueueStatusEnum = pgEnum("labelqueuestatusenum", ["PENDING", "IN_REVIEW", "LABELED", "AUTO_LABELED", "SKIPPED", "EXPERT_REQUIRED"]);
export const samplingStrategyEnum = pgEnum("samplingstrategyenum", ["UNCERTAINTY", "DIVERSITY", "COMMITTEE", "RANDOM"]);

// AI Chat enums
export const chatRoleEnum = pgEnum("chatroleenum", ["system", "user", "assistant", "tool"]);

// AI API Key enums
export const apiKeyProviderEnum = pgEnum("apikeyprovider", ["openai", "azure_openai", "huggingface", "custom"]);
export const apiKeyStatusEnum = pgEnum("apikeystatus", ["active", "inactive", "expired", "error"]);

// AI Copilot pending-action lifecycle (GĐ2 HITL write-action)
// ★★★ Đợt B · Task 6 (2026-08-29, drizzle/0341) — 'bi_tu_choi_ghi': execute() ĐÃ CHẠY nhưng TỪ
// CHỐI GHI (BASE_MISMATCH/FILE_DIRTY/…, daBiTuChoiGhi(result) === true) — 0 byte vào đĩa. KHÁC
// 'denied' (bị chặn TRƯỚC execute(), bởi RBAC/hợp đồng). Trước migration này `confirmAction` dán
// nhãn SAI 'executed' cho đúng ca này — xem docblock shared/aiCodingLoop.ts:325-360.
// ★★★ Rà soát cuối Đợt B (2026-08-29, drizzle/0342) — 'ap_mot_phan': lượt ghi LÔ hỏng GIỮA CHỪNG
// (`apply_diff_batch` trả `BATCH_PARTIAL`) ⇒ tệp 1..k−1 **ĐÃ TRÊN ĐĨA**, phần còn lại thì chưa.
// KHÔNG được dùng 'bi_tu_choi_ghi' cho ca này: hợp đồng chữ của nhãn đó là "0 byte vào đĩa", nên
// dán nó lên một lượt đã ghi một phần là khai SAI ở đúng ca nguy hiểm nhất (người đọc tưởng cây làm
// việc còn nguyên rồi đề xuất lại CẢ LÔ). Cột này phải nói được BA sự thật: ghi · không ghi · ghi
// MỘT PHẦN. Danh sách mã "đã có byte vào đĩa" nằm ở chính nơi sinh ra mã —
// `aiLocalTools/writeHandlers/applyDiffBatch.MA_GHI_MOT_PHAN`.
export const aiPendingActionStatusEnum = pgEnum("aipendingactionstatus", [
  "proposed",
  "confirmed",
  "executed",
  "denied",
  "expired",
  "cancelled",
  "bi_tu_choi_ghi",
  "ap_mot_phan",
]);

// AI Copilot agent session lifecycle (GĐ3b multi-step agentic orchestrator).
// planning → awaiting_approval → running → (awaiting_confirm at each write) →
// done | aborted | failed; paused when a write is blocked (limit/denied/error).
export const agentSessionStatusEnum = pgEnum("aiagentsessionstatus", [
  "planning",
  "awaiting_approval",
  "running",
  "awaiting_confirm",
  "paused",
  "done",
  "aborted",
  "failed",
]);

// Production Session enums (ISA-95 shift session)
export const sessionStatusEnum = pgEnum("sessionstatusenum", ["open", "paused", "closed", "transferred"]);

// === Giai đoạn 2 — MES / WIP / Traceability / PdM (G5/G6/G7) ===
// WIP lifecycle state of a unit/lot moving through the line
export const wipStatusEnum = pgEnum("wipstatusenum", ["queued", "in_process", "waiting", "completed", "hold", "scrapped", "reworked"]);
// Material/lot disposition decisions (G6)
export const lotDispositionEnum = pgEnum("lotdispositionenum", ["release", "rework", "scrap", "return", "hold", "quarantine"]);
// Supplier lot quality status (G6)
export const supplierLotStatusEnum = pgEnum("supplierlotstatusenum", ["received", "inspecting", "approved", "rejected", "consumed", "returned"]);
// Maintenance schedule type / trigger basis (G7)
export const maintenanceScheduleTypeEnum = pgEnum("maintenancescheduletypeenum", ["TIME_BASED", "USAGE_BASED", "CONDITION_BASED", "PREDICTIVE"]);
// Maintenance work-order lifecycle (G7) — drives MTTR/MTBF
export const workOrderStatusEnum = pgEnum("workorderstatusenum", ["OPEN", "SCHEDULED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED"]);
// Maintenance work-order classification (G7)
export const workOrderTypeEnum = pgEnum("workordertypeenum", ["PREVENTIVE", "PREDICTIVE", "CORRECTIVE", "BREAKDOWN", "INSPECTION"]);
// Source that triggered the work order (G7 closed-loop)
export const workOrderTriggerEnum = pgEnum("workordertriggerenum", ["MANUAL", "SCHEDULE", "PREDICTED_FAILURE", "HEALTH_SCORE", "SENSOR_ALERT"]);

// === Giai đoạn 3 — Energy / ML Ops / HA-DR (G9/G10/G12/G14) ===
// Energy meter source kind (G14 — ISO 50001)
export const energySourceEnum = pgEnum("energysourceenum", ["electricity", "compressed_air", "water", "gas", "steam", "other"]);
// Compliance export view profile (G9)
export const complianceViewEnum = pgEnum("complianceviewenum", ["CFR21_PART11", "IATF16949", "ISO9001", "ISO17025", "ISO50001"]);
// Disaster-recovery verify-restore check outcome (G12)
export const drCheckStatusEnum = pgEnum("drcheckstatusenum", ["passed", "failed", "skipped", "running"]);

// === Sprint F1.1 — OT Connectivity Framework ===
// Industrial protocol of an OT device adapter (driver scaffold; only "stub" is functional in F1.1)
// doc 40 Wave 5 OT-F8 — 'slmp' = SLMP 3E/4E binary (Mitsubishi FX5U/iQ-R) qua node:net
// (driver slmpDriver.ts). Bổ khuyết 'mitsubishi-mc' (chỉ 1E frame). Migration 0241.
export const otProtocolEnum = pgEnum("otprotocolenum", ["opcua", "modbus", "s7", "mitsubishi-mc", "ethernet-ip", "stub", "slmp"]);
// Logical data type of an OT tag value
export const otDataTypeEnum = pgEnum("otdatatypeenum", ["bool", "int", "float", "string", "json"]);
// Runtime connection state of an OT adapter
export const otAdapterStatusEnum = pgEnum("otadapterstatusenum", ["disabled", "connecting", "connected", "error"]);

// === Doc 12 §5 / P2 — Unified canonical telemetry store (ot_telemetry) ===
// Source protocol/channel that produced a canonical telemetry sample. ONE table
// (ot_telemetry) receives samples from every device protocol + the inspection
// pipeline; this enum records which path wrote each row. Append-only.
export const telemetryProtocolEnum = pgEnum("telemetryprotocolenum", [
  "mqtt",
  "opcua",
  "modbus",
  "s7",
  "ethernet_ip",
  "mtconnect",
  "sparkplug",
  "inspection",
  "other",
]);
// Quality flag of a canonical telemetry sample (OPC-UA style). Default 'good'.
export const telemetryQualityEnum = pgEnum("telemetryqualityenum", [
  "good",
  "bad",
  "uncertain",
]);

// === Sprint F4a — Machine control: recipe versioning + deployment + command dispatch ===
// Lifecycle of a machine recipe version (draft → active → archived)
export const recipeStatusEnum = pgEnum("recipestatusenum", ["draft", "active", "archived"]);
// Lifecycle of a recipe deployment to a machine
export const deploymentStatusEnum = pgEnum("deploymentstatusenum", ["pending", "deployed", "failed", "rolled_back"]);
// Outcome of a dispatched machine command. In F4a only "simulated" is produced
// (DRY-RUN); the wire states (sent/acked/...) are reserved for F4b when
// OT_CONTROL_ENABLED opens the path to driver.writeTags.
// Sprint G2.1 adds read-back ack verification:
//   acked_verified   = write ok AND read-back matched the requested value.
//   acked_unverified = write ok BUT read-back mismatched / unavailable (WARN only;
//                      NOT failed, NO blind retry — quyết định #4). ok stays true.
export const commandStatusEnum = pgEnum("commandstatusenum", ["simulated", "sent", "acked", "failed", "timeout", "rejected", "acked_verified", "acked_unverified"]);

// === Sprint F5b — who/what triggered a dispatched command ===
// 'hitl'      → a human-confirmed AI write-action (F4 path; actionId/confirmedBy).
// 'interlock' → a DETERMINISTIC, human-approved interlock rule auto-firing the
//               command (F5b path; ruleId/eventId/approvedBy). The AI has NO code
//               path to produce 'interlock' — it can only propose inert rules.
export const commandTriggerKindEnum = pgEnum("commandtriggerkindenum", ["hitl", "interlock"]);

// === Sprint F5a — Andon + Interlock model (ALERT-ONLY engine) ===
// SAFETY (F5a): the interlock engine raises Andon + records interlockEvents ONLY.
// It NEVER writes a command to a machine (no commandDispatcher / driver.writeTags).
// Auto block/stop is deferred to F5b → in F5a such an event is recorded 'skipped'.

// Andon signal-tower state (visual signal — NOT a control command).
export const andonStateEnum = pgEnum("andonstateenum", ["green", "yellow", "red", "call"]);
// Why an Andon was raised.
export const andonReasonEnum = pgEnum("andonreasonenum", ["quality", "material", "maintenance", "safety", "setup", "other"]);
// Lifecycle of an Andon event (raise → acknowledge → resolve).
export const andonStatusEnum = pgEnum("andonstatusenum", ["raised", "acknowledged", "resolved"]);
// Source data feed that can trigger an interlock rule.
export const interlockSourceTypeEnum = pgEnum("interlocksourcetypeenum", ["spc_violation", "ng_rate", "process_result", "telemetry_tag", "cpk"]);
// Intended interlock action. In F5a 'alert' raises a yellow Andon; block/stop raise a red
// Andon + a HITL proposal (requiresHumanConfirm) or are 'skipped' (auto, deferred to F5b).
export const interlockActionEnum = pgEnum("interlockactionenum", ["alert", "block_downstream", "stop_line", "reduce_speed"]);
// Granularity an interlock rule applies at.
export const interlockScopeEnum = pgEnum("interlockscopeenum", ["line", "station", "machine"]);
// Lifecycle/outcome of a fired interlock event. F5a never produces auto_blocked/
// confirmed_blocked (no command path); auto block/stop → 'skipped' until F5b.
export const interlockEventStatusEnum = pgEnum("interlockeventstatusenum", [
  "fired",
  "proposed",
  "auto_blocked",
  "confirmed_blocked",
  "alert_only",
  "skipped",
  "resolved",
  "failed",
]);

// === Doc 07 §③ — MES/MOM MASTER DATA (Supplier/Material/Customer/Skill/Tool) ===
// Kind of supplier (vendor master classification).
export const supplierTypeEnum = pgEnum("suppliertypeenum", ["component", "raw_material", "service", "equipment", "subcontractor", "other"]);
// Supplier qualification/approval state.
export const supplierApprovalStatusEnum = pgEnum("supplierapprovalstatusenum", ["pending", "approved", "conditional", "rejected", "suspended"]);
// Tool / fixture / consumable kind.
export const toolTypeEnum = pgEnum("tooltypeenum", ["nozzle", "stencil", "squeegee", "lens", "jig", "fixture", "other"]);
// Tool operational status.
export const toolStatusEnum = pgEnum("toolstatusenum", ["available", "in_use", "maintenance", "worn", "retired"]);
// Operator certification level for a skill (drives future qualification gating).
export const certificationLevelEnum = pgEnum("certificationlevelenum", ["trainee", "qualified", "expert", "trainer"]);

// === Doc 07 §③ — MASTER DATA EXTRAS (UoM / Plant Calendar / Warehouse-Inventory) ===
// Physical dimension a unit-of-measure belongs to (for safe conversions).
// doc 56 Đ1 (mig 0290a) — +torque/pressure/flow/current/frequency cho máy automation (torque siết vít, áp lực keo, dòng/tần hàn)
export const uomDimensionEnum = pgEnum("uomdimensionenum", ["length", "mass", "volume", "time", "temperature", "count", "percent", "other", "torque", "pressure", "flow", "current", "frequency"]);
// Day classification in a plant/shift calendar (drives takt / OEE-availability / APS).
export const calendarDayTypeEnum = pgEnum("calendardaytypeenum", ["working", "holiday", "planned_downtime"]);
// Warehouse kind (raw / work-in-progress / finished-goods / spare / other).
export const warehouseTypeEnum = pgEnum("warehousetypeenum", ["raw", "wip", "fg", "spare", "other"]);
// Storage-location granularity within a warehouse.
export const storageLocationKindEnum = pgEnum("storagelocationkindenum", ["bin", "shelf", "zone"]);

// === Phase E2 — Factory Control Plane: Factory Orchestration Engine (FOE) ===
// Lifecycle of a deployed orchestration workflow definition.
export const orchestrationWorkflowStatusEnum = pgEnum("orchestrationworkflowstatusenum", [
  "draft",
  "active",
  "archived",
]);
// Lifecycle of one workflow RUN. queued → running; held (precondition/interlock) or
// awaiting_confirm (a hitl_gate) pause it; compensating runs saga undo; terminal =
// completed | failed | aborted.
export const orchestrationRunStatusEnum = pgEnum("orchestrationrunstatusenum", [
  "queued",
  "running",
  "held",
  "awaiting_confirm",
  "completed",
  "failed",
  "aborted",
  "compensating",
]);
// Lifecycle of one RUN STEP (per node in the step tree).
export const orchestrationRunStepStatusEnum = pgEnum("orchestrationrunstepstatusenum", [
  "pending",
  "running",
  "awaiting_confirm",
  "held",
  "completed",
  "failed",
  "skipped",
  "compensated",
]);

// === Phase E4 — Factory Control Plane: EDGE CONTROL RUNTIME ===
// Connectivity/health state of a registered edge control runtime.
//   online   — heartbeat within the freshness window.
//   offline  — no heartbeat past the stale threshold (set by the central checker).
//   degraded — the node is up but self-reports impaired (buffering offline / partial).
export const edgeNodeStatusEnum = pgEnum("edgenodestatusenum", ["online", "offline", "degraded"]);

// === Doc 09 / Phase D0 — Device Programming & Control (DPC) ===
// SAFETY (non-negotiable, mirrors the control-plane): build/validate/simulate are
// always safe (no device I/O). A DEPLOY only reaches a device when DPC_DEPLOY_ENABLED
// is on AND a human signed off (HITL) — otherwise it is recorded 'simulated'. Logic
// for E-stop / interlock / SIL motion is NEVER authored or deployed from here; it stays
// on the certified PLC. Native IEC 61131-3 only targets an OPEN runtime (OpenPLC), never
// auto-pushed into a closed vendor PLC.
//
// The programming "target class" a project/artifact/adapter speaks. Open controllers
// (Zmotion BASIC, G-code), native IEC 61131-3 (→ open runtime), robot (TMSCT job-list),
// vendor-closed engineering (Mitsubishi). Additive — new targets append here.
export const programmingKindEnum = pgEnum("programmingkindenum", [
  "stub",                    // D0 — safe no-hardware pipeline proof
  "zmotion-basic",           // D2 — open motion controller (BASIC + motion)
  "gcode",                   // D2 — CNC / G-code
  "mitsubishi-engineering",  // D3 — tag/device + recipe (toolchain wrap)
  "robot-tm",                // D4 — Techman teach/job-list (TMSCT)
  "iec61131-st",             // D5 — native Structured Text → OpenPLC
  "iec61131-ld",             // D5 — native Ladder → OpenPLC
  "iec61131-pou",            // P4 (doc 24 Wave-3) — structured graphical POU (LAD/FBD/SFC, JSON) + PLCopen XML → ST → OpenPLC
  "ir-flow",                 // D1 (doc 16 §11.1) — IR motion/IO Flow (JSON AST) → URScript/ROS2
]);
// Lifecycle of a program ARTIFACT (one immutable source version on a branch).
export const programArtifactStatusEnum = pgEnum("programartifactstatusenum", [
  "draft",
  "validated",
  "released",
  "archived",
]);
// doc 38 T-2 — FOUR-EYES AT THE VERSION: review lifecycle of a program_artifacts row.
// A version must be 'approved' by a SECOND person (reviewer ≠ author) before it can be
// built/deployed. Enforcement is flag-gated (DPC_VERSION_REVIEW_ENABLED, default OFF).
export const programArtifactReviewStatusEnum = pgEnum("programartifactreviewstatusenum", [
  "pending_review",
  "approved",
  "rejected",
]);
// Outcome of a compile/build.
export const programBuildStatusEnum = pgEnum("programbuildstatusenum", ["pending", "ok", "failed"]);
// Which stage a deployment targets (staged deploy → verify → promote to production).
export const programDeployStageEnum = pgEnum("programdeploystageenum", ["staging", "production"]);
// Lifecycle/outcome of a program DEPLOYMENT (append-only audit). 'simulated' is the
// default outcome when DPC_DEPLOY_ENABLED is off — nothing reaches the device.
export const programDeployStatusEnum = pgEnum("programdeploystatusenum", [
  "pending",
  // doc 40 ENG-F2 — a production real-deploy queued for a SECOND person to sign off
  // in the Approval Inbox (two-phase request→approve). Migration 0239.
  "awaiting_approval",
  "simulated",
  "deployed",
  "verified",
  "failed",
  "rolled_back",
  "rejected",
]);
