/**
 * Factory Alert System - Type Definitions
 * Định nghĩa tất cả types và interfaces cho hệ thống
 */

// ============================================
// ALERT TYPES
// ============================================

/**
 * Severity levels của alert
 * critical: Máy dừng khẩn cấp, cần xử lý ngay
 * high: Lỗi nghiêm trọng, ảnh hưởng sản xuất
 * medium: Lỗi trung bình, cần theo dõi
 * low: Cảnh báo nhẹ
 * info: Thông tin
 */
export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * Trạng thái xử lý của alert
 * pending: Chưa xử lý
 * acknowledged: Đã xem/xác nhận
 * resolved: Đã xử lý xong
 */
export type AlertStatus = 'pending' | 'acknowledged' | 'resolved';

/**
 * Thông tin Station (trạm làm việc)
 */
export interface Station {
  id: string;           // VD: "ST-A-001"
  name: string;         // VD: "Wire Cutting Station A1"
  line: string;         // VD: "Line A"
  area?: string;        // VD: "Zone 1"
}

/**
 * Thông tin Product (sản phẩm)
 */
export interface Product {
  id: string;           // VD: "PRD-WH-12345"
  name: string;         // VD: "Wire Harness Model X"
  customer?: string;    // VD: "Toyota"
  serialNumber?: string; // VD: "SN-12345-ABC"
  model?: string;       // VD: "WH-12345"
}

/**
 * Thông tin Machine (máy kiểm tra)
 */
export interface Machine {
  id: number;           // VD: 1
  name: string;         // VD: "AVI Machine 01"
  code: string;         // VD: "AVI-01"
}

/**
 * Thông tin điểm đo (measurement point)
 */
export interface MeasurementPoint {
  id: number;
  code: string;
  name: string;
  referenceImageUrl?: string; // URL ảnh mẫu (reference image) cho so sánh
}

/**
 * Thông tin model sản phẩm (lọc theo model)
 */
export interface ProductModel {
  id: number;
  code: string;
  name: string;
}

/**
 * Thông tin NG rate hiện tại
 */
export interface NGRateInfo {
  current: number;
  threshold: number;
  totalInspections: number;
  ngCount: number;
}

/**
 * Cấu hình ngưỡng cảnh báo
 */
export interface ThresholdConfig {
  id: number;
  name: string;
  warningThreshold: number;
  criticalThreshold: number;
  minSampleSize: number;
}

/**
 * Khoảng thời gian tính toán alert
 */
export interface AlertPeriod {
  date: string;
  from: string;
  to: string;
}

/**
 * Thông tin điểm kiểm tra NG
 */
export interface NGPoint {
  pointId: number;        // VD: 0
  pointName: string;      // VD: "POINT-001"
  result: string;         // VD: "NG" hoặc "OK"
  actualValue?: string;   // VD: "145"
  expectedValue?: string; // VD: "120" - giá trị kỳ vọng
  imageUrl?: string;      // Relative URL hình ảnh điểm lỗi (e.g., /uploads/inspections/142/R105.jpg)
  referenceImageUrl?: string; // URL ảnh mẫu (reference image) cho so sánh
  workstationId?: number; // Workstation ID of this measurement point
  normalizedX?: number;      // B5: normalized [0..1] X of the NG marker on the board (server-provided)
  normalizedY?: number;      // B5: normalized [0..1] Y of the NG marker on the board
  normalizedRadius?: number; // B5: normalized radius of the NG marker
}

// ============================================
// ON-DEMAND IMAGE LOADING TYPES
// ============================================

/**
 * Thông tin ảnh của 1 điểm kiểm tra từ REST API
 */
export interface InspectionPointImage {
  pointDefId: number;
  pointCode: string;
  pointName: string;
  result: string;
  measuredValue: string;
  imageUrl: string;        // Relative URL (e.g., /uploads/inspections/142/R105-a1b2c3.jpg)
}

/**
 * Response từ REST API: GET /api/inspection/{id}/images
 */
export interface InspectionImagesResponse {
  success: boolean;
  inspectionId: number;
  serialNumber: string;
  overallResult: string;
  inspectionTime: string;
  totalPoints: number;
  pointsWithImages: InspectionPointImage[];
}

/**
 * Trạng thái tải ảnh on-demand
 */
export type ImageLoadingState = 'idle' | 'loading' | 'loaded' | 'error';

/**
 * Thông tin Error (lỗi)
 */
export interface ErrorInfo {
  code: string;         // VD: "E-CUT-001"
  type: string;         // VD: "Cutting Error"
  description: string;  // VD: "Wire length mismatch"
  imageUrl?: string;    // URL hình ảnh lỗi (optional)
}

/**
 * Alert object chính
 */
export interface Alert {
  id: string;                    // Unique ID (UUID)
  alertId: string;               // Alert ID từ máy (VD: "ALT-2026-001234")
  serverAlertId?: string;        // Server ack/resolve target id ("mqtt-123"/"alert-45"/"conn-9") captured from live MQTT payloads; PREFERRED over alertId for ack/resolve HTTP calls.
  alertType?: string;            // Loại alert từ nguồn MQTT (VD: NG_RATE_THRESHOLD)
  timestamp: string;             // ISO datetime khi lỗi xảy ra
  receivedAt: string;            // ISO datetime khi app nhận được
  station: Station;
  product: Product;
  error: ErrorInfo;
  severity: AlertSeverity;
  status: AlertStatus;
  acknowledgedAt?: string;       // Thời gian acknowledge
  ackComment?: string;           // MB6: lý do/ghi chú khi acknowledge
  resolvedAt?: string;           // Thời gian resolve
  notes?: string;                // Ghi chú của supervisor
  escalated?: boolean;           // MB6: đã leo thang (server ALERT_ESCALATION)
  escalatedAt?: string;          // MB6: thời điểm leo thang
  imageUrl?: string;             // URL hình ảnh lỗi (có thể từ error.imageUrl hoặc riêng)
  machine?: Machine;             // Thông tin máy kiểm tra
  ngPoints?: NGPoint[];          // Danh sách các điểm NG
  totalNG?: number;              // Tổng số điểm NG
  inspectionId?: number;         // ID của lần kiểm tra
  message?: string;              // Message hiển thị từ backend
  measurementPoint?: MeasurementPoint | null;
  productModel?: ProductModel | null;
  ngRate?: NGRateInfo;
  thresholdConfig?: ThresholdConfig;
  period?: AlertPeriod;
}

/**
 * Alert payload từ MQTT (raw data)
 */
export interface AlertPayload {
  alertId: string;
  serverAlertId?: string;        // Server ack/resolve target id captured from live MQTT payloads (see Alert.serverAlertId)
  alertType?: string;
  timestamp: string;
  station: Station;
  product: Product;
  error: ErrorInfo;
  severity: AlertSeverity;
  imageUrl?: string;             // URL hình ảnh lỗi chính
  machine?: Machine;             // Thông tin máy kiểm tra
  ngPoints?: NGPoint[];          // Danh sách các điểm NG
  totalNG?: number;              // Tổng số điểm NG
  inspectionId?: number;         // ID của lần kiểm tra
  message?: string;
  measurementPoint?: MeasurementPoint | null;
  productModel?: ProductModel | null;
  ngRate?: NGRateInfo;
  thresholdConfig?: ThresholdConfig;
  period?: AlertPeriod;
}

// ============================================
// MQTT TYPES
// ============================================

/**
 * Trạng thái kết nối MQTT
 */
export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

/**
 * MQTT Protocol type
 */
export type MqttProtocol = 'websocket' | 'tcp';

/**
 * MQTT Authentication Mode
 * - 'device-id': Local Aedes broker - username format: deviceId:deviceName:deviceModel
 * - 'standard': External brokers (HiveMQ, EMQX, Mosquitto) - standard username/password
 * - 'none': No authentication required
 */
export type MqttAuthMode = 'device-id' | 'standard' | 'none';

/**
 * Device Info for local broker authentication
 */
export interface DeviceAuthInfo {
  deviceId: string;              // Unique device identifier
  deviceName: string;            // App/device name (e.g., 'FactoryAlertApp')
  deviceModel: string;           // Device model (e.g., 'Android_14', 'iOS_17')
}

/**
 * MQTT Configuration
 */
export interface MqttConfig {
  brokerAddress: string;         // VD: "mqtt.factory.local" hoặc IP
  port: number;                  // VD: 8000 (WebSocket) hoặc 1883 (TCP)
  protocol: MqttProtocol;        // 'websocket' (ws/wss) hoặc 'tcp' (mqtt/mqtts)
  useSSL: boolean;               // Sử dụng SSL hay không
  username?: string;             // Username cho external broker (optional)
  password?: string;             // Password (optional)
  clientId?: string;             // Client ID (auto-generated nếu không set)
  topics: string[];              // Danh sách topics để subscribe
  keepAlive?: number;            // Keep alive interval (seconds)
  reconnectPeriod?: number;      // Reconnect delay (ms)
  connectTimeout?: number;       // Connection timeout (ms)
  authMode?: MqttAuthMode;       // Authentication mode (auto-detected if not set)
}

/**
 * MQTT Connection Event
 */
export interface MqttConnectionEvent {
  status: ConnectionStatus;
  timestamp: string;
  error?: string;
  reconnectAttempt?: number;
}

// ============================================
// NOTIFICATION TYPES
// ============================================

/**
 * Notification Configuration
 */
export interface FloatingPanelSections {
  statistics: boolean;
  trend: boolean;
  defects: boolean;
  captures: boolean;
  measurements: boolean;
  events: boolean;
}

export interface NotificationConfig {
  enabled: boolean;
  sound: boolean;
  vibration: boolean;
  severityFilter: AlertSeverity[];   // Chỉ notify cho các severity này
  quietHoursEnabled: boolean;
  quietHoursStart: string;           // HH:mm format
  quietHoursEnd: string;             // HH:mm format
  // Station filter - only show notifications for these stations
  stationFilterEnabled: boolean;
  stationFilters: string[];          // List of station IDs (e.g., ['ST-A-001', 'ST-B-002'])
  floatingBubbleEnabled: boolean;    // Enable floating bubble when in background
  showAlertDialog: boolean;           // Show overlay alert dialog for critical/high severity
  overlayDisplayDuration: number;     // Duration in seconds to show overlay alert (default: 15)
  floatingPanelSections: FloatingPanelSections; // Toggle visibility of panel sections
}

/**
 * Sound configuration theo severity
 */
export interface SoundConfig {
  severity: AlertSeverity;
  soundFile: string;
  repeatCount: number;
  vibrationPattern: number[];
}

// ============================================
// APP SETTINGS TYPES
// ============================================

/**
 * Ngôn ngữ hỗ trợ
 */
export type Language = 'vi' | 'en' | 'zh';

/**
 * Theme mode
 */
export type ThemeMode = 'light' | 'dark' | 'system';

/**
 * App Settings
 */
export type SubscriptionMode = 'manual' | 'hierarchy';

export type CanvasImageMode = 'fit' | 'fill' | 'cover';

export type AlertAnimationType = 'bomb' | 'alarm' | 'triangle';

export interface AppSettings {
  language: Language;
  theme: ThemeMode;
  autoReconnect: boolean;
  keepScreenOn: boolean;
  maxQueueSize: number;              // Số alerts tối đa trong queue
  alertRetentionDays: number;        // Số ngày giữ alerts
  apiBaseUrl: string;                // Base URL cho REST API (e.g., http://192.168.1.100:3000)
  apiKey: string;                    // Master API key for server authentication (x-master-key header)
  apiUsername: string;               // Username cho session-based auth (auth.login)
  apiPassword: string;               // Password cho session-based auth (auth.login)
  subscriptionMode: SubscriptionMode; // 'manual' = free text topics, 'hierarchy' = tree from API
  hierarchySelectedKeys: string[];   // Selected hierarchy node keys for topic generation
  ngFlashDurationMs: number;         // Duration (ms) for newly-alerted NG point flash animation
  ngBubbleDismissSec: number;        // Auto-dismiss seconds for NgRateBubble (0 = no auto-dismiss)
  ngExplosionDismissSec: number;     // Auto-dismiss seconds for NgRateExplosionOverlay
  alertAnimationEnabled: boolean;    // true = show animation overlay on each MQTT Alert before updating PCB Canvas
  alertAnimationType: AlertAnimationType; // Animation type: 'bomb' | 'alarm' | 'triangle'
  alertAnimationDurationSec: number; // Display duration in seconds for alert animation (1-5)
  proactivePollingEnabled: boolean;  // true = fetch production data proactively at interval, false = rely on MQTT bulletin
  proactivePollingIntervalSec: number; // Polling interval in seconds (min 15, default 60)
  workstationId: number | null;       // Selected workstation ID for filtering data (null = no filter)
  filterPointsByWorkstation: boolean;  // true = only show measurement points belonging to selected workstation on canvas/panel
  slowNetworkMode: boolean;             // true = load panel data sequentially (2 at a time), defer images last
  ngAutoClearColor: boolean;          // true = NG red color disappears with blink+bubble, false = only on next MQTT alert
  ngMarkerScale: number;              // Scale multiplier for NG red indicator (1.0-3.0, default 1.5)
  canvasImageMode: CanvasImageMode;  // Canvas image display mode: fit (contain), fill (stretch), cover (crop)
  updateServerUrl: string;           // URL server cập nhật LAN (e.g., http://192.168.1.100:3000/api/factory-alert)
  autoCheckUpdate: boolean;          // Tự động kiểm tra cập nhật khi mở app
  autoUpdate: boolean;               // true = tự động hiện dialog cập nhật, false = chỉ cảnh báo, user nhấn thủ công
  useCustomApiIp: boolean;           // true = nhập IP thủ công, false = tự động lấy từ MQTT broker
  useCustomUpdateIp: boolean;        // true = nhập IP thủ công, false = tự động lấy từ MQTT broker
  debugMode: boolean;                 // true = hiện nút debug và bật ghi log debug trong StationDetailScreen
  mqttHealthCheckInterval: number;    // Chu kỳ kiểm tra kết nối MQTT (ms), mặc định 15000
  mqttRetryMaxAttempts: number;       // Số lần retry tối đa khi mất kết nối, mặc định 5
  mqttRetryInterval: number;          // Khoảng cách giữa các lần retry (ms), mặc định 10000
}

/**
 * Network Quality result from each method
 */
export interface NetworkMethodResult {
  method: string;
  status: 'good' | 'fair' | 'poor' | 'failed' | 'disabled';
  latencyMs?: number;
  details: string;
  timestamp: string;
}

/**
 * Network Monitor Configuration
 */
export interface NetworkMonitorConfig {
  enabled: boolean;                    // Master toggle
  netInfoEnabled: boolean;             // Method 1: NetInfo (network type + signal)
  continuousMonitorEnabled: boolean;   // Method 2: Continuous monitoring (rolling latency)
  throughputTestEnabled: boolean;      // Method 3: Throughput/bandwidth test
  mqttRttEnabled: boolean;             // Method 4: MQTT RTT echo
  dnsTestEnabled: boolean;             // Method 5: DNS resolution
  serverHealthEnabled: boolean;        // Method 6: Server health endpoint
  monitorIntervalSec: number;          // Interval between auto-checks (seconds)
  throughputTestSizeKB: number;        // Payload size for throughput test (KB)
  latencyThresholdGood: number;        // Latency threshold for 'good' (ms)
  latencyThresholdFair: number;        // Latency threshold for 'fair' (ms)
  pingCount: number;                   // Number of pings per diagnostics run
}

/**
 * Full Settings object
 */
export interface Settings {
  mqtt: MqttConfig;
  notifications: NotificationConfig;
  app: AppSettings;
  networkMonitor: NetworkMonitorConfig;
}

// ============================================
// SIMULATOR TYPES
// ============================================

/**
 * Simulator Configuration
 */
export interface SimulatorConfig {
  autoGenerateEnabled: boolean;
  autoGenerateInterval: number;      // Milliseconds
  maxAutoGenerate: number;           // Số alerts tối đa auto generate
  randomSeverity: boolean;
  randomStation: boolean;
}

/**
 * Alert Template cho Simulator
 */
export interface AlertTemplate {
  id: string;
  name: string;
  station: Station;
  product: Product;
  error: ErrorInfo;
  severity: AlertSeverity;
}

// ============================================
// STORE TYPES
// ============================================

/**
 * Alert Store State
 */
export interface AlertStoreState {
  alerts: Alert[];
  pendingCount: number;
  totalCount: number;
  isLoading: boolean;
  error: string | null;
}

/**
 * Alert Store Actions
 */
export interface AlertStoreActions {
  addAlert: (alert: Alert) => void;
  removeAlert: (id: string) => void;
  /** MB6: optional ack comment (quick-reason chips + free text) synced to the server. */
  acknowledgeAlert: (id: string, comment?: string) => void;
  resolveAlert: (id: string, notes?: string) => void;
  /** MB6: mark an alert escalated (from a server ALERT_ESCALATION MQTT notice). Idempotent. */
  markEscalated: (alertId: string, escalatedAt?: string) => void;
  clearAll: () => void;
  clearResolved: () => void;
  loadAlerts: () => Promise<void>;
  saveAlerts: () => Promise<void>;
  setError: (error: string | null) => void;
  loadAlertsFromServer: (params?: AlertHistoryParams) => Promise<AlertHistoryResponse | null>;
}

/**
 * Settings Store State
 */
export interface SettingsStoreState {
  settings: Settings;
  isLoading: boolean;
}

/**
 * Settings Store Actions
 */
export interface SettingsStoreActions {
  updateMqttConfig: (config: Partial<MqttConfig>) => void;
  updateNotificationConfig: (config: Partial<NotificationConfig>) => void;
  updateAppSettings: (settings: Partial<AppSettings>) => void;
  updateNetworkMonitorConfig: (config: Partial<NetworkMonitorConfig>) => void;
  loadSettings: () => Promise<void>;
  saveSettings: () => Promise<void>;
  resetToDefaults: () => void;
}

/**
 * Connection Store State
 */
export interface ConnectionStoreState {
  status: ConnectionStatus;
  lastConnected: string | null;
  reconnectAttempts: number;
  error: string | null;
  showMqttDisconnectDialog: boolean;
  allRetriesFailed: boolean;
}

/**
 * Connection Store Actions
 */
export interface ConnectionStoreActions {
  setStatus: (status: ConnectionStatus) => void;
  setError: (error: string | null) => void;
  incrementReconnectAttempts: () => void;
  resetReconnectAttempts: () => void;
  setLastConnected: (timestamp: string) => void;
  setShowMqttDisconnectDialog: (show: boolean) => void;
  setAllRetriesFailed: (failed: boolean) => void;
}

// ============================================
// PERIODIC BULLETIN TYPES
// ============================================

/**
 * Thông tin khoảng thời gian báo cáo
 */
export interface BulletinPeriod {
  start: string;              // ISO datetime bắt đầu
  end: string;                // ISO datetime kết thúc
  intervalMinutes: number;    // Khoảng thời gian (phút)
}

/**
 * Thống kê sản xuất trong bulletin
 */
export interface BulletinStatistics {
  totalCount: number;         // Tổng số sản phẩm kiểm tra
  okCount: number;            // Số sản phẩm OK
  ngCount: number;            // Số sản phẩm NG
  ntfCount: number;           // Số sản phẩm NTF (Not Found)
  yieldRate: number;          // Tỷ lệ yield (%)
  avgCycleTime: number;       // Cycle time trung bình (giây)
}

/**
 * Thông tin điểm lỗi trong bulletin
 */
export interface BulletinFailPoint {
  pointId: number;            // ID điểm kiểm tra
  pointName: string;          // Tên điểm kiểm tra (VD: "IC U5 - Thiếu thiếc")
  pointCode: string;          // Mã điểm lỗi (VD: "FP-001")
  ngCount: number;            // Số lượng NG tại điểm này
  percentage: number;         // Phần trăm (%)
  imageUrl: string | null;    // URL hình ảnh lỗi (có thể null)
  referenceImageUrl?: string | null; // URL ảnh mẫu (reference image) cho so sánh
  latestInspectionId: number; // ID lần kiểm tra gần nhất
  latestSerialNumber: string; // Serial number gần nhất
  workstationId?: number;     // Workstation ID of this fail point
}

/**
 * Thông tin máy kiểm tra trong bulletin
 */
export interface BulletinMachine {
  machineId: number;          // ID máy
  machineName: string;        // Tên máy (VD: "AOI Machine 01")
  machineCode: string;        // Mã máy (VD: "AOI-01")
  totalCount: number;         // Tổng sản phẩm kiểm tra
  ngCount: number;            // Số lượng NG
}

/**
 * Periodic Bulletin - Bản tin định kỳ từ MQTT
 */
export interface PeriodicBulletin {
  bulletinId: string;                   // VD: "BLT-20260214-1430-ST5"
  type: 'PERIODIC_BULLETIN';
  stationId: number;                    // ID trạm
  stationName: string;                  // Tên trạm (VD: "AOI Station 01")
  factoryName: string;                  // Tên nhà máy
  workshopName: string;                 // Tên xưởng
  lineName: string;                     // Tên chuyền
  period: BulletinPeriod;
  statistics: BulletinStatistics;
  failPoints: BulletinFailPoint[];
  machines: BulletinMachine[];
  timestamp: string;                    // ISO datetime nhận được
  receivedAt?: string;                  // Thời gian app nhận (local)
  isRead?: boolean;                     // Đã đọc chưa
}

/**
 * Bulletin Store State
 */
export interface BulletinStoreState {
  bulletins: PeriodicBulletin[];
  unreadCount: number;
  totalCount: number;
  isLoading: boolean;
  error: string | null;
}

/**
 * Bulletin Store Actions
 */
export interface BulletinStoreActions {
  addBulletin: (bulletin: PeriodicBulletin) => void;
  markAsRead: (bulletinId: string) => void;
  markAllAsRead: () => void;
  removeBulletin: (bulletinId: string) => void;
  clearAll: () => void;
  loadBulletins: () => Promise<void>;
  saveBulletins: () => Promise<void>;
  setError: (error: string | null) => void;
  loadBulletinsFromServer: (params?: BulletinListParams) => Promise<BulletinListResponse | null>;
}

// ============================================
// NAVIGATION TYPES
// ============================================

/**
 * Root Stack Params
 */
export type RootStackParamList = {
  Main: undefined;
  AlertDetail: { alertId: string };
  BulletinDetail: { bulletinId: string };
  StationDetail: { stationId?: string };
};

/**
 * Bottom Tab Params
 */
export type BottomTabParamList = {
  NotificationCenter: undefined;
  Stations: undefined;
  Settings: undefined;
  Simulator: undefined;
};

// ============================================
// UTILITY TYPES
// ============================================

/**
 * KPI Data
 */
export interface KPIData {
  totalAlerts: number;
  pendingAlerts: number;
  criticalAlerts: number;
  highAlerts: number;
  resolvedToday: number;
  avgResponseTime: number;          // Minutes
}

/**
 * Filter Options
 */
export interface AlertFilter {
  severity?: AlertSeverity[];
  status?: AlertStatus[];
  station?: string;
  line?: string;
  dateFrom?: string;
  dateTo?: string;
  searchText?: string;
}

/**
 * Sort Options
 */
export type SortField = 'timestamp' | 'severity' | 'station' | 'status';
export type SortOrder = 'asc' | 'desc';

export interface SortOption {
  field: SortField;
  order: SortOrder;
}

// ============================================
// STATION INSPECTION TYPES (AOI Station Detail)
// ============================================

/**
 * Trạng thái điểm kiểm tra
 */
export type InspectionPointStatus = 'pass' | 'fail' | 'warn';

/**
 * Loại điểm kiểm tra
 */
export type InspectionPointType = 'ASSY' | 'Irregular' | 'Pollution' | 'Visual';

/**
 * Thông tin lỗi tại điểm kiểm tra
 */
export interface InspectionDefect {
  name: string;           // VD: "SSD chưa lắp đúng vị trí"
  pct: number;            // Phần trăm (0-100)
  count: number;          // Số lượng phát hiện
  color: string;          // Mã màu (#ff3d5a)
}

/**
 * Thông tin phép đo tại điểm kiểm tra
 */
export interface InspectionMeasurement {
  param: string;          // VD: "Offset X"
  val: string;            // VD: "0.42 mm"
  spec: string;           // VD: "≤ 0.20 mm"
  status: 'ok' | 'ng' | 'warn';
}

/**
 * Sự kiện gần đây tại điểm kiểm tra
 */
export interface InspectionEvent {
  time: string;           // VD: "08:04"
  desc: string;           // Mô tả sự kiện
  type: 'fail' | 'warn' | 'pass';
}

/**
 * Điểm kiểm tra trên board (AOI Inspection Point)
 */
export interface InspectionPoint {
  id: string;             // VD: "MP-01"
  code?: string;          // Mã điểm đo từ API (VD: "MP-008")
  name: string;           // VD: "SSD Connector Lock"
  type: InspectionPointType;
  status: InspectionPointStatus;
  defectRate: number;     // Tỷ lệ lỗi (%)
  x: number;              // Tọa độ X trên board (0-1)
  y: number;              // Tọa độ Y trên board (0-1)
  defects: InspectionDefect[];
  measurements: InspectionMeasurement[];
  trend: number[];        // Dữ liệu trend (10 shifts)
  events: InspectionEvent[];
  imageDisplayMode?: string; // 'contain' | 'cover' | 'fill' từ API A3
  orderIndex?: number;    // Thứ tự điểm đo từ server (1-based), giữ nguyên khi lọc theo workstation
}

/**
 * KPI thống kê trạm kiểm tra
 */
export interface StationKPI {
  firstPassYield: number;   // Tỷ lệ đạt lần đầu (%)
  finalYield: number;       // Tỷ lệ đạt cuối (%)
  output: number;           // Sản lượng
  retestRate: number;       // Tỷ lệ kiểm tra lại (%)
  yieldDelta?: number;      // Thay đổi yield so với ca trước
}

/**
 * Cấu hình trạm kiểm tra (từ MQTT settings)
 */
export interface StationConfig {
  stationId: string;        // VD: "S4"
  stationName: string;      // VD: "MGMT Assy 1"
  category: string;         // VD: "MGMT ASSY"
  totalPoints: number;      // Tổng số điểm kiểm tra
  totalMeasurements: number;
  boardName: string;        // VD: "MGMT-PCB-REV3"
  factoryId?: string;
  workshopId?: string;
  lineId?: string;
  apiStationId?: string;    // Numeric API ID (e.g., "1") when stationId is MQTT-derived (e.g., "AVI-01")
}

/**
 * Accumulated real-time data per inspection point (from MQTT alerts)
 * Used to replace simulated data in StationDetailScreen
 */
export interface PointAccumulatedData {
  /** Total inspections counted today */
  totalInspections: number;
  /** Number of NG results today */
  ngCount: number;
  /** Number of NTF (No Trouble Found / retest) results today */
  ntfCount?: number;
  /** Calculated defect rate (ngCount / totalInspections * 100) */
  defectRate: number;
  /** Server-provided point status from A10 API (used when no MQTT override) */
  apiStatus?: 'fail' | 'warn' | 'pass';
  /** Defect type breakdown accumulated from alerts */
  defects: InspectionDefect[];
  /** Latest measurement values from alerts */
  measurements: InspectionMeasurement[];
  /** Recent events from alerts */
  events: InspectionEvent[];
  /** Trend data: defect rates over recent inspection batches */
  trend: number[];
  /** Error image URLs collected from alerts */
  errorImageUrls: string[];
  /** Reference image URLs */
  referenceImageUrls: string[];
  /** Last alert timestamp */
  lastAlertTime: string;
}

/**
 * Dữ liệu trạm kiểm tra đầy đủ
 */
export interface StationInspectionData {
  config: StationConfig;
  kpi: StationKPI;
  points: InspectionPoint[];
  lastSerialNumber?: string;
  lastInspectionTime?: string;
  referenceImageUrl?: string;   // URL ảnh tham chiếu board từ API
  isLive: boolean;
  lastUpdated: string;
}

/**
 * Station Inspection Store State
 */
export interface StationInspectionStoreState {
  stations: Record<string, StationInspectionData>;
  activeStationId: string | null;
  selectedPointId: string | null;
  availableStationIds: string[];
  isLoading: boolean;
  error: string | null;
}

/**
 * Station Inspection Store Actions
 */
export interface StationInspectionStoreActions {
  setActiveStation: (stationId: string) => void;
  setSelectedPoint: (pointId: string | null) => void;
  updateStationData: (stationId: string, data: Partial<StationInspectionData>) => void;
  updateInspectionPoint: (stationId: string, pointId: string, point: Partial<InspectionPoint>) => void;
  addStation: (stationId: string, data: StationInspectionData) => void;
  removeStation: (stationId: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  initFromMqttTopics: (topics: string[]) => void;
}

// ============================================
// API RESPONSE TYPES (Server-synced)
// ============================================

/**
 * Pagination chung cho tất cả API có phân trang
 */
export interface ApiPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// --- 11.1: Alert Acknowledge/Resolve Sync ---

export interface AlertAcknowledgeRequest {
  acknowledgedBy: string;
  acknowledgedAt: string;
  /** MB6: lý do/ghi chú khi acknowledge (server acknowledge-v2 lưu vào ackComment). */
  comment?: string;
  notes?: string;
}

export interface AlertResolveRequest {
  resolvedBy: string;
  resolvedAt: string;
  resolution: string;
  rootCause?: string;
  notes?: string;
}

export interface AlertActionResponse {
  success: boolean;
  alertId: string;
  status: AlertStatus;
}

// --- 11.2: Alert History API ---

export interface AlertHistoryParams {
  stationId?: string;
  severity?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface AlertHistoryResponse {
  success: boolean;
  data: {
    alerts: Alert[];
    pagination: ApiPagination;
  };
}

export interface AlertDetailResponse {
  success: boolean;
  alert: Alert;
}

// --- 11.3: Bulletins REST API ---

export interface BulletinListParams {
  stationId?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export interface BulletinListResponse {
  success: boolean;
  data: {
    bulletins: PeriodicBulletin[];
    pagination: ApiPagination;
  };
}

// --- 11.4: Dashboard KPI ---

export interface DashboardSummaryParams {
  stationIds?: string;
  period?: 'today' | 'shift' | 'week' | 'month';
  shiftId?: string;
}

export interface DashboardSummaryResponse {
  success: boolean;
  data: {
    alertsSummary: {
      total: number;
      pending: number;
      acknowledged: number;
      resolved: number;
      bySeverity: Record<AlertSeverity, number>;
    };
    productionSummary: {
      totalOutput: number;
      totalNG: number;
      overallNgRate: number;
      firstPassYield: number;
      topDefects: Array<{ name: string; count: number; percentage: number }>;
    };
    stationsOnline: number;
    stationsTotal: number;
    lastUpdated: string;
  };
}

// --- 11.5: Export/Report API ---
// NOTE (doc 32, Wave R3, decision #5): the mobile app no longer calls the
// server report-generate endpoint (dashboardService.generateReport was
// removed — mobile stays light with a WEB-report deep-link, not a downloaded
// file). These interfaces are retained only to document the server-side
// contract (owned by R3-A); no app code consumes them.

export interface ReportGenerateRequest {
  reportType: 'daily_summary' | 'shift_report' | 'defect_analysis' | 'station_report';
  format: 'pdf' | 'csv' | 'excel';
  filters: {
    stationIds?: string[];
    startDate?: string;
    endDate?: string;
    severity?: string[];
  };
}

export interface ReportGenerateResponse {
  success: boolean;
  reportId: string;
  downloadUrl: string;
  generatedAt: string;
}

// --- 11.8: User Preferences Sync ---

export interface UserPreferencesData {
  notifications: {
    severityFilter: AlertSeverity[];
    quietHoursEnabled: boolean;
    quietHoursStart: string;
    quietHoursEnd: string;
    stationFilters: string[];
  };
  app: {
    language: string;
    theme: string;
    maxQueueSize: number;
  };
}

export interface UserPreferencesResponse {
  success: boolean;
  data: UserPreferencesData;
}

// --- 11.9: Station KPI (uses /api/external/inspections/summary) ---

export interface StationKPIParams {
  startDate: string;
  endDate: string;
  stationId?: number;
  productModelId?: number;
  productCode?: string;
}

export interface StationKPIDetailResponse {
  success: boolean;
  data: {
    dateRange: { startDate: string; endDate: string };
    totals: {
      totalInspections: number;
      okCount: number;
      ngCount: number;
      ntfCount?: number;
      yieldRate: number;
    };
    details: Array<{
      stationId: number;
      stationCode: string;
      stationName: string;
      totalInspections: number;
      okCount: number;
      ngCount: number;
      ntfCount?: number;
      yieldRate: number;
    }>;
  };
}

// --- 11.11: Trending Data (uses /api/external/inspections/trend) ---

export interface TrendDataParams {
  startDate: string;
  endDate: string;
  stationId?: number;
  productModelId?: number;
  productCode?: string;
  pointDefId?: number;
  groupBy?: 'hour' | 'day' | 'week' | 'month';
}

export interface TrendDataResponse {
  success: boolean;
  data: {
    dateRange: { startDate: string; endDate: string };
    groupBy: string;
    pointDefId?: number;
    trend: Array<{
      period: string;
      totalInspections?: number;
      totalCount?: number;
      okCount: number;
      ngCount: number;
      ntfCount?: number;
      yieldRate?: number;
      ngRate?: number;
      avgValue?: number;
      minValue?: number;
      maxValue?: number;
    }>;
  };
}
