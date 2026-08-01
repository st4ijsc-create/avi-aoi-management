// Schema domain: MQTT tables
import { pgTable, serial, integer, varchar, decimal, boolean, timestamp, text, json, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { approvalStatusEnum, mappingTypeEnum, connectionStatusEnum_1, summaryTypeEnum, messageTypeEnum, deliveryStatusEnum, ruleTypeEnum, comparisonOperatorEnum_2, protocolEnum_1, defaultQosEnum, targetTypeEnum, eventTypeEnum, deviceTypeEnum, messageFormatEnum, eventTypeEnum_1, statusEnum_11, alertTypeEnum_2, severityEnum } from "./enums";

export const mqttClients = pgTable("mqtt_clients", {
  id: serial("id").primaryKey(),
  clientId: varchar("clientId", { length: 128 }).notNull().unique(), // MQTT client ID
  deviceId: varchar("deviceId", { length: 128 }).notNull().unique(), // Unique device identifier (Android ID)
  deviceName: varchar("deviceName", { length: 255 }), // Tên thiết bị do user đặt
  deviceModel: varchar("deviceModel", { length: 100 }), // Model thiết bị (Samsung, Xiaomi, etc.)
  osVersion: varchar("osVersion", { length: 50 }), // Android version
  appVersion: varchar("appVersion", { length: 50 }), // App version
  ipAddress: varchar("ipAddress", { length: 45 }), // Device IP address
  brand: varchar("brand", { length: 100 }), // Device brand (Samsung, Xiaomi, etc.)
  manufacturer: varchar("manufacturer", { length: 100 }), // Device manufacturer
  screenResolution: varchar("screenResolution", { length: 50 }), // Screen resolution
  networkType: varchar("networkType", { length: 50 }), // Network type (wifi, cellular, etc.)
  // Mapping to station
  stationId: integer("stationId"), // Công trạm được gán
  processId: integer("processId"), // Công đoạn được gán (optional, for filtering)
  // Doc 56 Đ2a Việc 4 (IoT identity, migration 0292) — soft link mqtt_clients → machines.id.
  // Column name kept camelCase ("machineId") to match this table's convention (stationId /
  // deviceId / processId). Nullable; the migration adds the FK (ON DELETE SET NULL) — kept
  // as a soft-ref here (no .references()) exactly like stationId/processId in this table, so
  // the schema does not diverge from the hand-written migration. Populated when an IoT device
  // is bound to its machines row; a retired/rejected machine's link is revoked (hierarchy.ts).
  machineId: integer("machineId"),
  // Approval status
  approvalStatus: approvalStatusEnum("approvalStatus").default("PENDING").notNull(),
  approvedBy: integer("approvedBy"), // User ID who approved
  approvedAt: timestamp("approvedAt"),
  rejectionReason: text("rejectionReason"),
  // Mapping type
  mappingType: mappingTypeEnum("mappingType").default("MANUAL").notNull(),
  autoReconnect: boolean("autoReconnect").default(true).notNull(), // Tự động kết nối lại khi disconnect
  // Connection status
  connectionStatus: connectionStatusEnum_1("connectionStatus").default("OFFLINE").notNull(),
  lastConnectedAt: timestamp("lastConnectedAt"),
  lastDisconnectedAt: timestamp("lastDisconnectedAt"),
  lastHeartbeat: timestamp("lastHeartbeat"),
  // Settings
  receiveNGAlerts: boolean("receiveNGAlerts").default(true).notNull(), // Nhận cảnh báo NG
  receiveDailySummary: boolean("receiveDailySummary").default(true).notNull(), // Nhận tổng hợp ngày
  receiveWeeklySummary: boolean("receiveWeeklySummary").default(true).notNull(), // Nhận tổng hợp tuần
  fcmToken: varchar("fcmToken", { length: 500 }), // Firebase Cloud Messaging token for push notifications
  // Doc 27 W2-C (R12, migration 0178) — per-device MQTT password.
  // `passwordHash` (bcrypt) is the AT-REST credential the broker verifies against.
  // `password` is a LEGACY plaintext staging column: ops may set it once; on the
  // device's next successful connect it is transparently upgraded into
  // passwordHash and cleared (see mqttService.verifyMqttDevicePassword).
  password: varchar("password", { length: 255 }),
  passwordHash: varchar("passwordHash", { length: 255 }),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_mqtt_clients_clientId").on(table.clientId),
  index("idx_mqtt_clients_deviceId").on(table.deviceId),
  index("idx_mqtt_clients_station").on(table.stationId),
  // Doc 56 Đ2a Việc 4 — lookup a machine's linked MQTT devices (lifecycle revoke).
  index("idx_mqtt_clients_machine").on(table.machineId),
  index("idx_mqtt_clients_approval").on(table.approvalStatus),
  index("idx_mqtt_clients_connection").on(table.connectionStatus),
  index("idx_mqtt_clients_active").on(table.isActive),
]);

export type MqttClient = typeof mqttClients.$inferSelect;
export type InsertMqttClient = typeof mqttClients.$inferInsert;

/**
 * MQTT Subscriptions - Các topic mà client đăng ký nhận
 */
export const mqttSubscriptions = pgTable("mqtt_subscriptions", {
  id: serial("id").primaryKey(),
  clientId: integer("clientId").notNull(), // FK to mqtt_clients
  topic: varchar("topic", { length: 255 }).notNull(), // MQTT topic pattern
  qos: integer("qos").default(1).notNull(), // Quality of Service (0, 1, 2)
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_mqtt_subs_client").on(table.clientId),
  index("idx_mqtt_subs_topic").on(table.topic),
  uniqueIndex("mqtt_subscriptions_client_topic_unique").on(table.clientId, table.topic),
]);

export type MqttSubscription = typeof mqttSubscriptions.$inferSelect;
export type InsertMqttSubscription = typeof mqttSubscriptions.$inferInsert;

/**
 * MQTT Error Summary - Tổng hợp lỗi theo ngày/tuần cho từng điểm đo và trạm
 */
export const mqttErrorSummary = pgTable("mqtt_error_summary", {
  id: serial("id").primaryKey(),
  summaryType: summaryTypeEnum("summaryType").notNull(),
  summaryDate: timestamp("summaryDate").notNull(), // Ngày/tuần tổng hợp
  stationId: integer("stationId").notNull(),
  processId: integer("processId"), // Công đoạn (optional)
  measurementPointId: integer("measurementPointId"), // Điểm đo cụ thể (optional)
  // Statistics
  totalInspections: integer("totalInspections").default(0).notNull(),
  totalNG: integer("totalNG").default(0).notNull(),
  totalNTF: integer("totalNTF").default(0).notNull(),
  ngRate: decimal("ngRate", { precision: 5, scale: 2 }).default("0").notNull(),
  // Top NG points JSON
  topNGPoints: json("topNGPoints").$type<Array<{
    pointId: number;
    pointName: string;
    ngCount: number;
    percentage: number;
  }>>(),
  // Sent status
  sentToClients: boolean("sentToClients").default(false).notNull(),
  sentAt: timestamp("sentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_error_summary_type").on(table.summaryType),
  index("idx_error_summary_date").on(table.summaryDate),
  index("idx_error_summary_station").on(table.stationId),
  index("idx_error_summary_sent").on(table.sentToClients),
]);

export type MqttErrorSummary = typeof mqttErrorSummary.$inferSelect;
export type InsertMqttErrorSummary = typeof mqttErrorSummary.$inferInsert;

/**
 * MQTT Message Log - Log các message đã gửi qua MQTT
 */
export const mqttMessageLogs = pgTable("mqtt_message_logs", {
  id: serial("id").primaryKey(),
  messageType: messageTypeEnum("messageType").notNull(),
  topic: varchar("topic", { length: 255 }).notNull(),
  payload: json("payload").notNull(), // Message content
  targetClientId: integer("targetClientId"), // Specific client (null = broadcast)
  stationId: integer("stationId"), // Related station
  inspectionId: integer("inspectionId"), // Related inspection (for NG alerts)
  deliveryStatus: deliveryStatusEnum("deliveryStatus").default("PENDING").notNull(),
  deliveredAt: timestamp("deliveredAt"),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_mqtt_logs_type").on(table.messageType),
  index("idx_mqtt_logs_topic").on(table.topic),
  index("idx_mqtt_logs_client").on(table.targetClientId),
  index("idx_mqtt_logs_station").on(table.stationId),
  index("idx_mqtt_logs_status").on(table.deliveryStatus),
  index("idx_mqtt_logs_created").on(table.createdAt),
]);

export type MqttMessageLog = typeof mqttMessageLogs.$inferSelect;
export type InsertMqttMessageLog = typeof mqttMessageLogs.$inferInsert;


/**
 * MQTT Alert Rules - Cấu hình cảnh báo cho MQTT
 */
export const mqttAlertRules = pgTable("mqtt_alert_rules", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(), // Tên rule
  description: text("description"), // Mô tả
  ruleType: ruleTypeEnum("ruleType").notNull(),
  // Threshold configuration
  thresholdValue: decimal("thresholdValue", { precision: 10, scale: 2 }).notNull(), // Giá trị ngưỡng
  thresholdUnit: varchar("thresholdUnit", { length: 50 }).default("ms").notNull(), // Đơn vị (ms, %, msg/min, minutes)
  comparisonOperator: comparisonOperatorEnum_2("comparisonOperator").default("GT").notNull(),
  // Time window for evaluation
  timeWindowMinutes: integer("timeWindowMinutes").default(5).notNull(), // Khoảng thời gian đánh giá (phút)
  // Notification settings
  notifyOwner: boolean("notifyOwner").default(true).notNull(), // Gửi notification cho owner
  notifyEmail: boolean("notifyEmail").default(false).notNull(), // Gửi email
  notifyMqtt: boolean("notifyMqtt").default(false).notNull(), // Gửi qua MQTT
  // Cooldown to prevent spam
  cooldownMinutes: integer("cooldownMinutes").default(15).notNull(), // Thời gian chờ giữa các alert
  lastTriggeredAt: timestamp("lastTriggeredAt"), // Lần trigger gần nhất
  // Category filter (optional - only trigger for specific product category)
  categoryId: integer("categoryId"), // FK to product_categories (null = all categories)
  // Status
  isEnabled: boolean("isEnabled").default(true).notNull(),
  createdBy: integer("createdBy"), // FK to users
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_mqtt_alert_rules_type").on(table.ruleType),
  index("idx_mqtt_alert_rules_enabled").on(table.isEnabled),
]);

export type MqttAlertRule = typeof mqttAlertRules.$inferSelect;
export type InsertMqttAlertRule = typeof mqttAlertRules.$inferInsert;

/**
 * MQTT Alert History - Lịch sử các alert đã trigger
 */
export const mqttAlertHistory = pgTable("mqtt_alert_history", {
  id: serial("id").primaryKey(),
  ruleId: integer("ruleId").notNull(), // FK to mqtt_alert_rules
  ruleName: varchar("ruleName", { length: 255 }).notNull(), // Snapshot của tên rule
  ruleType: varchar("ruleType", { length: 50 }).notNull(), // Snapshot của loại rule
  // Alert details
  triggeredValue: decimal("triggeredValue", { precision: 10, scale: 2 }).notNull(), // Giá trị khi trigger
  thresholdValue: decimal("thresholdValue", { precision: 10, scale: 2 }).notNull(), // Ngưỡng đã set
  message: text("message").notNull(), // Nội dung alert
  // Notification status
  notificationSent: boolean("notificationSent").default(false).notNull(),
  notificationError: text("notificationError"),
  // Resolution
  isResolved: boolean("isResolved").default(false).notNull(),
  resolvedAt: timestamp("resolvedAt"),
  resolvedBy: integer("resolvedBy"), // FK to users
  resolvedByName: varchar("resolvedByName", { length: 255 }), // Human-readable identity (mobile / master-key auth)
  resolutionNote: text("resolutionNote"),
  // Escalation (0186 — set ONCE by mqttAlertScheduler sweep)
  escalatedAt: timestamp("escalatedAt"),
  // Timestamps
  triggeredAt: timestamp("triggeredAt").defaultNow().notNull(),
}, (table) => [
  index("idx_mqtt_alert_history_rule").on(table.ruleId),
  index("idx_mqtt_alert_history_type").on(table.ruleType),
  index("idx_mqtt_alert_history_resolved").on(table.isResolved),
  index("idx_mqtt_alert_history_triggered").on(table.triggeredAt),
]);

export type MqttAlertHistory = typeof mqttAlertHistory.$inferSelect;
export type InsertMqttAlertHistory = typeof mqttAlertHistory.$inferInsert;

/**
 * Alert Escalation Rules (0186, doc 27 MB6) — minimal honest escalation for MQTT alerts.
 * A rule matches open alerts (mqtt_connection_alerts not acked/resolved; mqtt_alert_history
 * not resolved) older than escalateAfterMin. severity filter applies to connection alerts
 * only (mqtt_alert_history has no severity column). The scheduler sweep marks escalatedAt
 * exactly once (WHERE escalatedAt IS NULL) — no re-storm.
 */
export const alertEscalationRules = pgTable("alert_escalation_rules", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  severity: varchar("severity", { length: 20 }), // null = any; 'info'|'warning'|'critical'
  alertType: varchar("alertType", { length: 50 }), // null = any; conn alertType or history ruleType
  escalateAfterMin: integer("escalateAfterMin").default(15).notNull(),
  notifyRoles: jsonb("notifyRoles").$type<string[]>().default([]).notNull(),
  notifyUserIds: jsonb("notifyUserIds").$type<number[]>().default([]).notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_alert_escalation_rules_enabled").on(table.enabled),
]);

export type AlertEscalationRule = typeof alertEscalationRules.$inferSelect;
export type InsertAlertEscalationRule = typeof alertEscalationRules.$inferInsert;

export const mqttMessageHistory = pgTable("mqtt_message_history", {
  id: serial("id").primaryKey(),
  topic: varchar("topic", { length: 255 }).notNull(),
  machineCode: varchar("machineCode", { length: 50 }),
  payload: json("payload").$type<Record<string, any>>().notNull(),
  qos: integer("qos").default(0).notNull(),
  timestamp: timestamp("timestamp").notNull(),
  // Metadata
  messageSize: integer("messageSize"), // Bytes
  processingTime: integer("processingTime"), // Milliseconds
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_mqtt_history_topic").on(table.topic),
  index("idx_mqtt_history_machine").on(table.machineCode),
  index("idx_mqtt_history_timestamp").on(table.timestamp),
  index("idx_mqtt_history_topic_time").on(table.topic, table.timestamp),
]);

export type MqttMessageHistory = typeof mqttMessageHistory.$inferSelect;
export type InsertMqttMessageHistory = typeof mqttMessageHistory.$inferInsert;

export const mqttClientProfiles = pgTable("mqtt_client_profiles", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  
  // Broker Configuration
  brokerUrl: varchar("brokerUrl", { length: 500 }).notNull(),
  port: integer("port").default(1883).notNull(),
  protocol: protocolEnum_1("protocol").default("mqtt").notNull(),
  
  // Authentication
  username: varchar("username", { length: 255 }),
  password: varchar("password", { length: 255 }),
  clientIdPrefix: varchar("clientIdPrefix", { length: 100 }),
  
  // TLS/SSL Settings
  useTls: boolean("useTls").default(false).notNull(),
  tlsCertPath: text("tlsCertPath"),
  tlsKeyPath: text("tlsKeyPath"),
  tlsCaPath: text("tlsCaPath"),
  rejectUnauthorized: boolean("rejectUnauthorized").default(true).notNull(),
  
  // Connection Settings
  keepAlive: integer("keepAlive").default(60).notNull(), // seconds
  connectTimeout: integer("connectTimeout").default(30000).notNull(), // ms
  reconnectPeriod: integer("reconnectPeriod").default(5000).notNull(), // ms
  cleanSession: boolean("cleanSession").default(true).notNull(),
  
  // Auto-Reconnect Settings
  maxReconnectAttempts: integer("maxReconnectAttempts").default(10).notNull(), // 0 = unlimited
  reconnectBackoffMultiplier: decimal("reconnectBackoffMultiplier", { precision: 3, scale: 1 }).default("1.5").notNull(), // Exponential backoff
  maxReconnectDelay: integer("maxReconnectDelay").default(60000).notNull(), // Max delay between reconnects (ms)
  autoReconnect: boolean("autoReconnect").default(true).notNull(), // Enable/disable auto-reconnect
  
  // QoS Settings
  defaultQos: defaultQosEnum("defaultQos").default("1").notNull(),
  
  // Topic Configuration (JSON array)
  subscribeTopics: json("subscribeTopics").$type<string[]>().default([]),
  publishTopics: json("publishTopics").$type<string[]>().default([]),
  
  // Message Settings
  messageRetain: boolean("messageRetain").default(false).notNull(),
  
  // Status
  isDefault: boolean("isDefault").default(false).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  
  // Metadata
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_mqtt_profiles_name").on(table.name),
  index("idx_mqtt_profiles_active").on(table.isActive),
  index("idx_mqtt_profiles_default").on(table.isDefault),
]);

export type MqttClientProfile = typeof mqttClientProfiles.$inferSelect;
export type InsertMqttClientProfile = typeof mqttClientProfiles.$inferInsert;

/**
 * MQTT Profile Assignments - Gán profile cho máy/station
 */
export const mqttProfileAssignments = pgTable("mqtt_profile_assignments", {
  id: serial("id").primaryKey(),
  profileId: integer("profileId").notNull(),
  
  // Target type: machine, station, or factory
  targetType: targetTypeEnum("targetType").notNull(),
  targetId: integer("targetId").notNull(),
  
  // Override settings (JSON - partial override of profile settings)
  overrideSettings: json("overrideSettings").$type<{
    subscribeTopics?: string[];
    publishTopics?: string[];
    qos?: string;
    clientIdSuffix?: string;
  }>(),
  
  // Status
  isActive: boolean("isActive").default(true).notNull(),
  
  // Metadata
  assignedBy: integer("assignedBy"),
  assignedAt: timestamp("assignedAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_mqtt_assignments_profile").on(table.profileId),
  index("idx_mqtt_assignments_target").on(table.targetType, table.targetId),
]);

export type MqttProfileAssignment = typeof mqttProfileAssignments.$inferSelect;
export type InsertMqttProfileAssignment = typeof mqttProfileAssignments.$inferInsert;

/**
 * MQTT Connection Logs - Lịch sử kết nối
 */
export const mqttConnectionLogs = pgTable("mqtt_connection_logs", {
  id: serial("id").primaryKey(),
  profileId: integer("profileId"),
  assignmentId: integer("assignmentId"),
  
  // Connection Info
  clientId: varchar("clientId", { length: 255 }).notNull(),
  brokerUrl: varchar("brokerUrl", { length: 500 }).notNull(),
  
  // Event
  eventType: eventTypeEnum("eventType").notNull(),
  eventMessage: text("eventMessage"),
  errorCode: varchar("errorCode", { length: 50 }),
  
  // Metadata
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: text("userAgent"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
}, (table) => [
  index("idx_mqtt_conn_logs_profile").on(table.profileId),
  index("idx_mqtt_conn_logs_client").on(table.clientId),
  index("idx_mqtt_conn_logs_event").on(table.eventType),
  index("idx_mqtt_conn_logs_timestamp").on(table.timestamp),
]);

export type MqttConnectionLog = typeof mqttConnectionLogs.$inferSelect;
export type InsertMqttConnectionLog = typeof mqttConnectionLogs.$inferInsert;

/**
 * MQTT Topic Templates - Mẫu topic cho các loại thiết bị
 */
export const mqttTopicTemplates = pgTable("mqtt_topic_templates", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  
  // Device Type
  deviceType: deviceTypeEnum("deviceType").notNull(),
  
  // Topic Patterns (với placeholders: {factory}, {line}, {machine}, {serial})
  inspectionResultTopic: varchar("inspectionResultTopic", { length: 500 }),
  ngAlertTopic: varchar("ngAlertTopic", { length: 500 }),
  statusTopic: varchar("statusTopic", { length: 500 }),
  commandTopic: varchar("commandTopic", { length: 500 }),
  heartbeatTopic: varchar("heartbeatTopic", { length: 500 }),
  
  // Message Format
  messageFormat: messageFormatEnum("messageFormat").default("json").notNull(),
  
  // Sample Messages (JSON)
  sampleMessages: json("sampleMessages").$type<{
    inspectionResult?: object;
    ngAlert?: object;
    status?: object;
  }>(),
  
  // Status
  isActive: boolean("isActive").default(true).notNull(),
  
  // Metadata
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_mqtt_templates_device").on(table.deviceType),
  index("idx_mqtt_templates_active").on(table.isActive),
]);

export type MqttTopicTemplate = typeof mqttTopicTemplates.$inferSelect;
export type InsertMqttTopicTemplate = typeof mqttTopicTemplates.$inferInsert;


/**
 * MQTT Reconnect Logs - Lịch sử reconnect để phân tích độ ổn định
 */
export const mqttReconnectLogs = pgTable("mqtt_reconnect_logs", {
  id: serial("id").primaryKey(),
  profileId: integer("profileId").notNull(),
  assignmentId: integer("assignmentId"),
  
  // Target Info
  targetType: targetTypeEnum("targetType"),
  targetId: integer("targetId"),
  
  // Reconnect Event
  eventType: eventTypeEnum_1("eventType").notNull(),
  attemptNumber: integer("attemptNumber").default(1).notNull(),
  
  // Timing
  reconnectDelay: integer("reconnectDelay"), // Delay before this attempt (ms)
  connectionDuration: integer("connectionDuration"), // How long was connected before disconnect (ms)
  
  // Error Info
  errorCode: varchar("errorCode", { length: 100 }),
  errorMessage: text("errorMessage"),
  
  // Connection Details
  clientId: varchar("clientId", { length: 255 }),
  brokerUrl: varchar("brokerUrl", { length: 500 }),
  
  // Metadata
  timestamp: timestamp("timestamp").defaultNow().notNull(),
}, (table) => [
  index("idx_reconnect_profile").on(table.profileId),
  index("idx_reconnect_assignment").on(table.assignmentId),
  index("idx_reconnect_event").on(table.eventType),
  index("idx_reconnect_timestamp").on(table.timestamp),
  index("idx_reconnect_target").on(table.targetType, table.targetId),
]);

export type MqttReconnectLog = typeof mqttReconnectLogs.$inferSelect;
export type InsertMqttReconnectLog = typeof mqttReconnectLogs.$inferInsert;

/**
 * MQTT Connection Status - Trạng thái kết nối real-time
 */
export const mqttConnectionStatus = pgTable("mqtt_connection_status", {
  id: serial("id").primaryKey(),
  profileId: integer("profileId").notNull(),
  assignmentId: integer("assignmentId"),
  
  // Target Info
  targetType: targetTypeEnum("targetType"),
  targetId: integer("targetId"),
  
  // Status
  status: statusEnum_11("status").default("unknown").notNull(),
  
  // Connection Info
  clientId: varchar("clientId", { length: 255 }),
  brokerUrl: varchar("brokerUrl", { length: 500 }),
  
  // Timing
  connectedAt: timestamp("connectedAt"),
  disconnectedAt: timestamp("disconnectedAt"),
  lastHeartbeat: timestamp("lastHeartbeat"),
  uptime: integer("uptime").default(0), // Total uptime in seconds
  
  // Stats
  reconnectCount: integer("reconnectCount").default(0).notNull(),
  totalConnectionTime: integer("totalConnectionTime").default(0), // Total time connected (seconds)
  lastErrorMessage: text("lastErrorMessage"),
  lastErrorCode: varchar("lastErrorCode", { length: 100 }),
  
  // Metadata
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_conn_status_profile").on(table.profileId),
  index("idx_conn_status_assignment").on(table.assignmentId),
  index("idx_conn_status_status").on(table.status),
  index("idx_conn_status_target").on(table.targetType, table.targetId),
]);

export type MqttConnectionStatus = typeof mqttConnectionStatus.$inferSelect;
export type InsertMqttConnectionStatus = typeof mqttConnectionStatus.$inferInsert;


/**
 * MQTT Connection Alerts - Cảnh báo mất kết nối
 */
export const mqttConnectionAlerts = pgTable("mqtt_connection_alerts", {
  id: serial("id").primaryKey(),
  profileId: integer("profileId").notNull(),
  assignmentId: integer("assignmentId"),
  
  // Target Info
  targetType: targetTypeEnum("targetType"),
  targetId: integer("targetId"),
  
  // Alert Info
  alertType: alertTypeEnum_2("alertType").notNull(),
  severity: severityEnum("severity").default("warning").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message"),
  
  // Timing
  triggeredAt: timestamp("triggeredAt").defaultNow().notNull(),
  acknowledgedAt: timestamp("acknowledgedAt"),
  acknowledgedBy: integer("acknowledgedBy"),
  acknowledgedByName: varchar("acknowledgedByName", { length: 255 }), // Human-readable identity (mobile / master-key auth)
  ackComment: text("ackComment"), // Lý do/ghi chú khi acknowledge (MB6)
  resolvedAt: timestamp("resolvedAt"),
  resolvedByName: varchar("resolvedByName", { length: 255 }),
  resolutionNote: text("resolutionNote"),

  // Escalation (0186 — set ONCE by mqttAlertScheduler sweep)
  escalatedAt: timestamp("escalatedAt"),

  // Threshold Config
  thresholdMinutes: integer("thresholdMinutes").default(5), // Ngưỡng thời gian mất kết nối (phút)

  // Status
  isAcknowledged: boolean("isAcknowledged").default(false).notNull(),
  isResolved: boolean("isResolved").default(false).notNull(),

  // Metadata
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_mqtt_alert_profile").on(table.profileId),
  index("idx_mqtt_alert_assignment").on(table.assignmentId),
  index("idx_mqtt_alert_type").on(table.alertType),
  index("idx_mqtt_alert_severity").on(table.severity),
  index("idx_mqtt_alert_acknowledged").on(table.isAcknowledged),
  index("idx_mqtt_alert_triggered").on(table.triggeredAt),
]);
export type MqttConnectionAlert = typeof mqttConnectionAlerts.$inferSelect;
export type InsertMqttConnectionAlert = typeof mqttConnectionAlerts.$inferInsert;

/**
 * MQTT Alert Configuration - Cấu hình cảnh báo
 */
export const mqttAlertConfig = pgTable("mqtt_alert_config", {
  id: serial("id").primaryKey(),
  profileId: integer("profileId"), // null = global config
  
  // Thresholds
  connectionLostThreshold: integer("connectionLostThreshold").default(5).notNull(), // Phút
  reconnectFailedThreshold: integer("reconnectFailedThreshold").default(10).notNull(), // Số lần thất bại liên tiếp
  highReconnectRateThreshold: integer("highReconnectRateThreshold").default(20).notNull(), // Số lần reconnect trong 1 giờ
  longDisconnectionThreshold: integer("longDisconnectionThreshold").default(30).notNull(), // Phút
  
  // Notification Settings
  enableEmailNotification: boolean("enableEmailNotification").default(false).notNull(),
  enablePushNotification: boolean("enablePushNotification").default(true).notNull(),
  notificationEmails: text("notificationEmails"), // Comma-separated emails
  
  // Status
  isActive: boolean("isActive").default(true).notNull(),
  
  // Metadata
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_alert_config_profile").on(table.profileId),
  index("idx_alert_config_active").on(table.isActive),
]);
export type MqttAlertConfig = typeof mqttAlertConfig.$inferSelect;
export type InsertMqttAlertConfig = typeof mqttAlertConfig.$inferInsert;

export const mqttBulletinSettings = pgTable("mqtt_bulletin_settings", {
  id: serial("id").primaryKey(),
  stationId: integer("stationId").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  // Chu kỳ gửi (phút) - mặc định 60 phút
  intervalMinutes: integer("intervalMinutes").default(60).notNull(),
  // Loại lịch: 'interval' (theo chu kỳ) hoặc 'cron' (theo cron expression)
  scheduleType: varchar("scheduleType", { length: 20 }).default("interval").notNull(),
  cronExpression: varchar("cronExpression", { length: 100 }),
  // Giờ bắt đầu/kết thúc gửi trong ngày (chỉ gửi trong giờ làm việc)
  startHour: integer("startHour").default(6).notNull(),
  endHour: integer("endHour").default(22).notNull(),
  // Tùy chọn nội dung bản tin
  includeImages: boolean("includeImages").default(true).notNull(),
  maxFailPoints: integer("maxFailPoints").default(20).notNull(),
  // Kênh gửi
  sendToExternal: boolean("sendToExternal").default(true).notNull(),
  sendFcm: boolean("sendFcm").default(true).notNull(),
  // Trạng thái
  lastSentAt: timestamp("lastSentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_bulletin_settings_station").on(table.stationId),
  index("idx_bulletin_settings_enabled").on(table.enabled),
]);

export type MqttBulletinSetting = typeof mqttBulletinSettings.$inferSelect;
export type InsertMqttBulletinSetting = typeof mqttBulletinSettings.$inferInsert;

/**
 * MQTT Bulletin History - Lưu lịch sử bản tin đã gửi
 */
export const mqttBulletinHistory = pgTable("mqtt_bulletin_history", {
  id: serial("id").primaryKey(),
  stationId: integer("stationId").notNull(),
  bulletinType: varchar("bulletinType", { length: 20 }).default("PERIODIC").notNull(),
  periodStart: timestamp("periodStart").notNull(),
  periodEnd: timestamp("periodEnd").notNull(),
  // Thống kê tổng hợp
  totalCount: integer("totalCount").default(0).notNull(),
  okCount: integer("okCount").default(0).notNull(),
  ngCount: integer("ngCount").default(0).notNull(),
  ntfCount: integer("ntfCount").default(0).notNull(),
  yieldRate: decimal("yieldRate", { precision: 5, scale: 2 }),
  // Danh sách điểm đo Fail (JSON)
  failPoints: json("failPoints").$type<Array<{
    pointId: number;
    pointName: string;
    pointCode: string;
    ngCount: number;
    percentage: number;
    imageUrl?: string;
    latestInspectionId?: number;
    latestSerialNumber?: string;
  }>>(),
  // Full payload đã gửi
  payload: json("payload").notNull(),
  // Trạng thái gửi
  deliveryStatus: deliveryStatusEnum("deliveryStatus").default("PENDING").notNull(),
  deliveredAt: timestamp("deliveredAt"),
  sentViaLocal: boolean("sentViaLocal").default(false).notNull(),
  sentViaExternal: boolean("sentViaExternal").default(false).notNull(),
  sentViaFcm: boolean("sentViaFcm").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_bulletin_history_station").on(table.stationId),
  index("idx_bulletin_history_period").on(table.periodStart, table.periodEnd),
  index("idx_bulletin_history_created").on(table.createdAt),
  index("idx_bulletin_history_status").on(table.deliveryStatus),
]);

export type MqttBulletinHistoryRecord = typeof mqttBulletinHistory.$inferSelect;
export type InsertMqttBulletinHistory = typeof mqttBulletinHistory.$inferInsert;

// ============================================================
// MQTT NG Rate Threshold - Cấu hình ngưỡng tỉ lệ NG theo điểm đo
// Khi tỉ lệ NG của một điểm đo trong ngày vượt ngưỡng → tự động gửi MQTT alert
// ============================================================

/**
 * MQTT NG Rate Thresholds - Cấu hình ngưỡng NG rate cho từng điểm đo (hoặc toàn station)
 */
export const mqttNgRateThresholds = pgTable("mqtt_ng_rate_thresholds", {
  id: serial("id").primaryKey(),
  // Scope: có thể cấu hình cho từng điểm đo, từng machine, hoặc toàn station
  stationId: integer("stationId").notNull(),              // Trạm kiểm tra
  machineId: integer("machineId"),                        // Máy cụ thể (null = tất cả máy trong trạm)
  measurementPointId: integer("measurementPointId"),      // Điểm đo cụ thể (null = tất cả điểm đo)
  productModelId: integer("productModelId"),              // Model sản phẩm cụ thể (null = tất cả)
  
  // Tên mô tả
  name: varchar("name", { length: 255 }).notNull(),       // Ví dụ: "NG rate MP001 > 5%"
  description: text("description"),
  
  // Ngưỡng cảnh báo
  warningThreshold: decimal("warningThreshold", { precision: 5, scale: 2 }).notNull(),   // Ngưỡng cảnh báo (%) vd: 5.00
  criticalThreshold: decimal("criticalThreshold", { precision: 5, scale: 2 }).notNull(), // Ngưỡng nghiêm trọng (%) vd: 10.00
  
  // Số lượng mẫu tối thiểu để đánh giá (tránh false alarm khi ít mẫu)
  minSampleSize: integer("minSampleSize").default(10).notNull(),  // Tối thiểu 10 lần kiểm tra mới tính NG rate
  
  // Cooldown: tránh spam alert liên tục
  cooldownMinutes: integer("cooldownMinutes").default(30).notNull(),  // Thời gian chờ giữa 2 lần alert
  lastTriggeredAt: timestamp("lastTriggeredAt"),                     // Lần trigger gần nhất
  
  // Kênh gửi
  sendMqttLocal: boolean("sendMqttLocal").default(true).notNull(),    // Gửi qua MQTT local broker
  sendMqttExternal: boolean("sendMqttExternal").default(true).notNull(), // Gửi qua MQTT external broker
  sendFcm: boolean("sendFcm").default(true).notNull(),                // Gửi push notification (FCM)
  
  // Trạng thái
  isEnabled: boolean("isEnabled").default(true).notNull(),
  createdBy: integer("createdBy"),                        // User ID tạo
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_ng_rate_threshold_station").on(table.stationId),
  index("idx_ng_rate_threshold_machine").on(table.machineId),
  index("idx_ng_rate_threshold_point").on(table.measurementPointId),
  index("idx_ng_rate_threshold_product").on(table.productModelId),
  index("idx_ng_rate_threshold_enabled").on(table.isEnabled),
]);

export type MqttNgRateThreshold = typeof mqttNgRateThresholds.$inferSelect;
export type InsertMqttNgRateThreshold = typeof mqttNgRateThresholds.$inferInsert;

/**
 * MQTT NG Rate Alert History - Lịch sử cảnh báo NG rate đã gửi
 */
export const mqttNgRateAlertHistory = pgTable("mqtt_ng_rate_alert_history", {
  id: serial("id").primaryKey(),
  thresholdId: integer("thresholdId").notNull(),           // FK to mqtt_ng_rate_thresholds
  
  // Snapshot thông tin khi alert
  stationId: integer("stationId").notNull(),
  machineId: integer("machineId"),
  measurementPointId: integer("measurementPointId"),
  pointName: varchar("pointName", { length: 255 }),        // Tên điểm đo snapshot
  pointCode: varchar("pointCode", { length: 50 }),         // Mã điểm đo snapshot
  productModelName: varchar("productModelName", { length: 255 }),
  
  // Dữ liệu NG rate
  currentNgRate: decimal("currentNgRate", { precision: 5, scale: 2 }).notNull(), // NG rate hiện tại (%)
  thresholdValue: decimal("thresholdValue", { precision: 5, scale: 2 }).notNull(), // Ngưỡng đã vượt
  totalInspections: integer("totalInspections").notNull(),  // Tổng số lần kiểm tra trong ngày
  ngCount: integer("ngCount").notNull(),                    // Số lần NG trong ngày
  
  // Mức nghiêm trọng
  severity: varchar("severity", { length: 20 }).notNull(), // 'warning' | 'critical'
  
  // Thông tin gửi
  message: text("message").notNull(),                      // Nội dung thông báo
  mqttTopic: varchar("mqttTopic", { length: 255 }),
  sentMqttLocal: boolean("sentMqttLocal").default(false).notNull(),
  sentMqttExternal: boolean("sentMqttExternal").default(false).notNull(),
  sentFcm: boolean("sentFcm").default(false).notNull(),
  
  // Payload đã gửi
  payload: json("payload"),
  
  // Resolution
  isResolved: boolean("isResolved").default(false).notNull(),
  resolvedAt: timestamp("resolvedAt"),
  resolvedBy: integer("resolvedBy"),
  resolutionNote: text("resolutionNote"),
  
  triggeredAt: timestamp("triggeredAt").defaultNow().notNull(),
}, (table) => [
  index("idx_ng_rate_alert_threshold").on(table.thresholdId),
  index("idx_ng_rate_alert_station").on(table.stationId),
  index("idx_ng_rate_alert_point").on(table.measurementPointId),
  index("idx_ng_rate_alert_severity").on(table.severity),
  index("idx_ng_rate_alert_resolved").on(table.isResolved),
  index("idx_ng_rate_alert_triggered").on(table.triggeredAt),
]);

export type MqttNgRateAlertHistory = typeof mqttNgRateAlertHistory.$inferSelect;
export type InsertMqttNgRateAlertHistory = typeof mqttNgRateAlertHistory.$inferInsert;

// ============================================================
// MQTT NG Alert Settings - Cấu hình bản tin NG Alert theo từng trạm
// Cho phép bật/tắt, tùy chỉnh topic, kênh gửi cho từng station
// ============================================================

export const mqttNgAlertSettings = pgTable("mqtt_ng_alert_settings", {
  id: serial("id").primaryKey(),
  stationId: integer("stationId").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  
  // Topic cấu hình - hỗ trợ placeholder: {factoryId}, {workshopId}, {stationId}
  topicPattern: varchar("topicPattern", { length: 500 })
    .default("avi/factory/{factoryId}/workshop/{workshopId}/station/{stationId}/errors")
    .notNull(),
  externalTopicPattern: varchar("externalTopicPattern", { length: 500 }),
  
  // Kênh gửi
  sendToLocal: boolean("sendToLocal").default(true).notNull(),
  sendToExternal: boolean("sendToExternal").default(true).notNull(),
  sendFcm: boolean("sendFcm").default(true).notNull(),
  
  // Tùy chọn nội dung
  includeImages: boolean("includeImages").default(true).notNull(),
  includeReferenceImages: boolean("includeReferenceImages").default(true).notNull(),
  includePointImages: boolean("includePointImages").default(true).notNull(),
  includeOverallResult: boolean("includeOverallResult").default(true).notNull(),
  
  // QoS settings
  qos: integer("qos").default(1).notNull(),
  retain: boolean("retain").default(false).notNull(),
  
  // Cooldown - tránh spam alert
  cooldownSeconds: integer("cooldownSeconds").default(0).notNull(),
  lastTriggeredAt: timestamp("lastTriggeredAt"),
  
  // Metadata
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("idx_ng_alert_settings_station_unique").on(table.stationId),
  index("idx_ng_alert_settings_enabled").on(table.enabled),
]);

export type MqttNgAlertSetting = typeof mqttNgAlertSettings.$inferSelect;
export type InsertMqttNgAlertSetting = typeof mqttNgAlertSettings.$inferInsert;

// ─── Software Version Management ─────────────────────────────────────────────
export const mqttSoftwareVersions = pgTable("mqtt_software_versions", {
  id: serial("id").primaryKey(),
  version: varchar("version", { length: 50 }).notNull(),
  versionCode: integer("versionCode").notNull().unique(),
  releaseDate: timestamp("releaseDate").defaultNow().notNull(),
  changelog: text("changelog"),
  apkFileKey: varchar("apkFileKey", { length: 500 }),
  apkFileUrl: text("apkFileUrl"),
  apkFileName: varchar("apkFileName", { length: 255 }),
  fileSize: integer("fileSize"),
  mandatory: boolean("mandatory").default(false).notNull(),
  minVersionCode: integer("minVersionCode"),
  isLatest: boolean("isLatest").default(false).notNull(),
  uploadedBy: integer("uploadedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_sw_version_code").on(table.versionCode),
  index("idx_sw_version_latest").on(table.isLatest),
]);

export type MqttSoftwareVersion = typeof mqttSoftwareVersions.$inferSelect;
export type InsertMqttSoftwareVersion = typeof mqttSoftwareVersions.$inferInsert;

// ─── FactoryAlertSystem Version Management ───────────────────────────────────
export const factoryAlertVersions = pgTable("factory_alert_versions", {
  id: serial("id").primaryKey(),
  version: varchar("version", { length: 50 }).notNull(),
  versionCode: integer("versionCode").notNull(),
  releaseDate: timestamp("releaseDate").defaultNow().notNull(),
  changelog: text("changelog"),
  apkFileName: varchar("apkFileName", { length: 255 }),
  apkFilePath: varchar("apkFilePath", { length: 500 }),
  fileSize: integer("fileSize"),
  mandatory: boolean("mandatory").default(false).notNull(),
  minVersionCode: integer("minVersionCode"),
  isActive: boolean("isActive").default(false).notNull(),
  uploadedBy: integer("uploadedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_fa_version_code").on(table.versionCode),
  index("idx_fa_version_active").on(table.isActive),
]);

export type FactoryAlertVersion = typeof factoryAlertVersions.$inferSelect;
export type InsertFactoryAlertVersion = typeof factoryAlertVersions.$inferInsert;
