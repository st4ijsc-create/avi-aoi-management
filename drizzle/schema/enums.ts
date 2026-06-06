// Schema domain: Enum definitions
import { pgEnum } from "drizzle-orm/pg-core";

// PostgreSQL Enum Definitions
export const roleEnum = pgEnum("roleenum", [
  "admin",           // Full system access
  "supervisor",      // Workshop supervisor - manage operators and view all data
  "quality_inspector", // QC specialist - focus on quality control and reports
  "operator",        // Machine operator - submit inspections, view assigned machines
  "maintenance",     // Maintenance technician - machine status and logs
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
export const aiPendingActionStatusEnum = pgEnum("aipendingactionstatus", [
  "proposed",
  "confirmed",
  "executed",
  "denied",
  "expired",
  "cancelled",
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
export const otProtocolEnum = pgEnum("otprotocolenum", ["opcua", "modbus", "s7", "mitsubishi-mc", "ethernet-ip", "stub"]);
// Logical data type of an OT tag value
export const otDataTypeEnum = pgEnum("otdatatypeenum", ["bool", "int", "float", "string", "json"]);
// Runtime connection state of an OT adapter
export const otAdapterStatusEnum = pgEnum("otadapterstatusenum", ["disabled", "connecting", "connected", "error"]);

// === Sprint F4a — Machine control: recipe versioning + deployment + command dispatch ===
// Lifecycle of a machine recipe version (draft → active → archived)
export const recipeStatusEnum = pgEnum("recipestatusenum", ["draft", "active", "archived"]);
// Lifecycle of a recipe deployment to a machine
export const deploymentStatusEnum = pgEnum("deploymentstatusenum", ["pending", "deployed", "failed", "rolled_back"]);
// Outcome of a dispatched machine command. In F4a only "simulated" is produced
// (DRY-RUN); the wire states (sent/acked/...) are reserved for F4b when
// OT_CONTROL_ENABLED opens the path to driver.writeTags.
export const commandStatusEnum = pgEnum("commandstatusenum", ["simulated", "sent", "acked", "failed", "timeout", "rejected"]);

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
