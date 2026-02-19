/**
 * Migration script: Add i18n support to all MQTT page files
 * Usage: node migrate-mqtt-i18n.mjs
 * 
 * This script:
 * 1. Adds useTranslation import & hook to each component
 * 2. Replaces all hardcoded Vietnamese/English UI strings with t() calls
 * 3. Updates vi.json and en.json with new translation keys
 */
import fs from 'fs';

const FILES = [
  'client/src/pages/MqttDashboard.tsx',
  'client/src/pages/MqttAlertRules.tsx',
  'client/src/pages/MqttTopicsMessages.tsx',
  'client/src/pages/MQTTReplay.tsx',
  'client/src/pages/MqttBulletin.tsx',
  'client/src/pages/MqttClientManagement.tsx',
  'client/src/pages/MqttProfileManagement.tsx',
];

const stats = {};

function addImportAndHook(content, componentName) {
  // Add import after last import line
  if (!content.includes("useTranslation")) {
    const lines = content.split('\n');
    let insertIdx = 0;
    let inImport = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('import ')) {
        inImport = true;
        if (line.includes(' from ')) { insertIdx = i + 1; inImport = false; }
      } else if (inImport && line.includes(' from ')) {
        insertIdx = i + 1; inImport = false;
      }
    }
    lines.splice(insertIdx, 0, "import { useTranslation } from 'react-i18next';");
    content = lines.join('\n');
  }

  // Add hook after component declaration (only if not already present)
  if (!content.includes("const { t } = useTranslation()")) {
    const funcRegex = new RegExp(`(export default function ${componentName}\\(\\)\\s*\\{)`);
    content = content.replace(funcRegex, `$1\n  const { t } = useTranslation();`);
  }

  return content;
}

function countReplacements(orig, mod) {
  const a = orig.split('\n'), b = mod.split('\n');
  let c = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) c++;
  }
  return c;
}

// ==================== MqttDashboard.tsx ====================
function migrateMqttDashboard(c) {
  c = addImportAndHook(c, 'MqttDashboard');

  // Toasts
  c = c.replace("toast.info(newMuted ? 'Đã tắt âm thanh cảnh báo' : 'Đã bật âm thanh cảnh báo');",
    "toast.info(newMuted ? t('mqtt.dashboard.alertSoundOff') : t('mqtt.dashboard.alertSoundOn'));");
  c = c.replace(/toast\.success\(`NG Alert đã gửi: \$\{data\.data\.serialNumber\}`\)/,
    "toast.success(t('mqtt.dashboard.ngAlertSent', { serial: data.data.serialNumber }))");
  c = c.replace(/toast\.error\(`Lỗi: \$\{error\.message\}`\)/,
    "toast.error(t('mqtt.dashboard.errorMsg', { message: error.message }))");

  // Status badges in getStatusBadge
  c = c.replace('/> Đã gửi</Badge>', '/> {t(\'mqtt.dashboard.delivered\')}</Badge>');
  c = c.replace('/> Thất bại</Badge>', '/> {t(\'mqtt.dashboard.failed\')}</Badge>');
  c = c.replace('/> Đang chờ</Badge>', '/> {t(\'mqtt.dashboard.pending\')}</Badge>');

  // Page header
  c = c.replace('>Giám sát kết nối và tin nhắn MQTT realtime</p>',
    '>{t(\'mqtt.dashboard.description\')}</p>');

  // Sound button titles
  c = c.replace("title={soundMuted ? 'Bật âm thanh cảnh báo' : 'Tắt âm thanh cảnh báo'}",
    "title={soundMuted ? t('mqtt.dashboard.enableAlertSound') : t('mqtt.dashboard.disableAlertSound')}");

  // Test NG Alert button
  c = c.replace("{testNGAlertMutation.isPending ? 'Đang gửi...' : 'Test NG Alert'}",
    "{testNGAlertMutation.isPending ? t('mqtt.dashboard.sending') : 'Test NG Alert'}");

  // Refresh button - match with whitespace
  c = c.replace(/(\s+)Làm mới\n(\s+)<\/Button>/,
    "$1{t('common.refresh')}\n$2</Button>");

  // Stats cards
  c = c.replace(' tổng clients', " {t('mqtt.dashboard.totalClients')}");
  c = c.replace('{stats?.clients.pendingApproval || 0} chờ phê duyệt',
    "{stats?.clients.pendingApproval || 0} {t('mqtt.dashboard.pendingApproval')}");
  c = c.replace('>Tin nhắn hôm nay</span>', ">{t('mqtt.dashboard.messagesToday')}</span>");
  c = c.replace('>Tin nhắn</span>', ">{t('mqtt.messages')}</span>");
  c = c.replace('>Tỷ lệ gửi thành công</span>', ">{t('mqtt.dashboard.successRate')}</span>");
  c = c.replace('>Tỷ lệ</span>', ">{t('mqtt.dashboard.rate')}</span>");
  c = c.replace(' tin nhắn\n', " {t('mqtt.messages')}\n");

  // Throughput cards
  c = c.replace('Throughput (1 phút)', "{t('mqtt.dashboard.throughput1min')}");
  c = c.replace(/msg\/phút\n/, "{t('mqtt.dashboard.msgPerMin')}\n");
  c = c.replace('Throughput (5 phút)', "{t('mqtt.dashboard.throughput5min')}");
  c = c.replace('avg msg/phút', "{t('mqtt.dashboard.avgMsgPerMin')}");

  // Throughput Realtime chart
  c = c.replace('Throughput Realtime', "{t('mqtt.dashboard.throughputRealtime')}");
  c = c.replace('>Số lượng message trong 1 giờ qua (theo phút)</CardDescription>',
    ">{t('mqtt.dashboard.messagesLastHour')}</CardDescription>");
  c = c.replace(/Chưa có dữ liệu\n/, "{t('common.noData')}\n");

  // Chart legend names (replaceAll for multiple occurrences)
  c = c.replaceAll('name="Tổng"', "name={t('common.total')}");
  c = c.replaceAll('name="Đã gửi"', "name={t('mqtt.dashboard.delivered')}");
  c = c.replaceAll('name="Thất bại"', "name={t('mqtt.dashboard.failed')}");

  // Message trend
  c = c.replace('Xu hướng tin nhắn', "{t('mqtt.dashboard.messageTrend')}");
  c = c.replace('>Số lượng tin nhắn theo ngày</CardDescription>',
    ">{t('mqtt.dashboard.messagesByDay')}</CardDescription>");
  c = c.replace('>7 ngày</SelectItem>', ">{t('mqtt.dashboard.7days')}</SelectItem>");
  c = c.replace('>14 ngày</SelectItem>', ">{t('mqtt.dashboard.14days')}</SelectItem>");
  c = c.replace('>30 ngày</SelectItem>', ">{t('mqtt.dashboard.30days')}</SelectItem>");
  c = c.replace(/Đang tải\.\.\.\n/, "{t('common.loading')}\n");

  // Pie chart
  c = c.replace('Phân loại tin nhắn', "{t('mqtt.dashboard.messageClassification')}");
  c = c.replace('>Hôm nay</CardDescription>', ">{t('mqtt.dashboard.today')}</CardDescription>");
  c = c.replace(/Chưa có tin nhắn\n/, "{t('mqtt.dashboard.noMessages')}\n");

  // Tabs
  c = c.replace('Connected Clients ({clients?.length || 0})',
    "{t('mqtt.dashboard.connectedClients')} ({clients?.length || 0})");
  c = c.replace('Recent Messages', "{t('mqtt.dashboard.recentMessages')}");

  // Client list table
  c = c.replace('<CardTitle>Danh sách Clients</CardTitle>',
    "<CardTitle>{t('mqtt.dashboard.clientList')}</CardTitle>");
  c = c.replace('>Các thiết bị đã kết nối qua MQTT</CardDescription>',
    ">{t('mqtt.dashboard.clientListDesc')}</CardDescription>");
  c = c.replace('<TableHead>Thiết bị</TableHead>', "<TableHead>{t('mqtt.dashboard.device')}</TableHead>");
  c = c.replace('<TableHead>Trạng thái</TableHead>', "<TableHead>{t('common.status')}</TableHead>");
  c = c.replace('<TableHead>Phê duyệt</TableHead>', "<TableHead>{t('mqtt.dashboard.approval')}</TableHead>");
  c = c.replace('<TableHead>Trạm</TableHead>', "<TableHead>{t('mqtt.dashboard.station')}</TableHead>");
  c = c.replace('<TableHead>Kết nối lần cuối</TableHead>',
    "<TableHead>{t('mqtt.dashboard.lastConnection')}</TableHead>");
  c = c.replace('Chưa có client nào kết nối', "{t('mqtt.dashboard.noClients')}");

  // FCM badges
  c = c.replace('/> Có\n', "/> {t('common.yes')}\n");
  c = c.replace('>Không</Badge>', ">{t('common.no')}</Badge>");

  // Recent messages table
  c = c.replace('<CardTitle>Tin nhắn gần đây</CardTitle>',
    "<CardTitle>{t('mqtt.dashboard.recentMessagesTitle')}</CardTitle>");
  c = c.replace('>20 tin nhắn mới nhất</CardDescription>',
    ">{t('mqtt.dashboard.recentMessagesDesc')}</CardDescription>");
  c = c.replace('<TableHead>Loại</TableHead>', "<TableHead>{t('mqtt.dashboard.type')}</TableHead>");
  c = c.replace('<TableHead>Trạng thái</TableHead>', "<TableHead>{t('common.status')}</TableHead>");
  c = c.replace('<TableHead>Thời gian</TableHead>', "<TableHead>{t('mqtt.dashboard.time')}</TableHead>");
  c = c.replace(/Đang tải\.\.\.\n/, "{t('common.loading')}\n");
  c = c.replace('Chưa có tin nhắn nào', "{t('mqtt.dashboard.noMessages')}");

  return c;
}

// ==================== MqttAlertRules.tsx ====================
function migrateMqttAlertRules(c) {
  c = addImportAndHook(c, 'MqttAlertRules');

  // RULE_TYPES outside component - convert to key-based
  c = c.replace(`const RULE_TYPES = [
  { value: 'LATENCY_THRESHOLD', label: 'Latency vượt ngưỡng', unit: 'ms', description: 'Cảnh báo khi độ trễ message vượt ngưỡng' },
  { value: 'BROKER_DISCONNECT', label: 'Broker Disconnect', unit: 'minutes', description: 'Cảnh báo khi external broker bị ngắt kết nối' },
  { value: 'MESSAGE_FAILURE_RATE', label: 'Tỷ lệ thất bại', unit: '%', description: 'Cảnh báo khi tỷ lệ message thất bại vượt ngưỡng' },
  { value: 'THROUGHPUT_LOW', label: 'Throughput thấp', unit: 'msg/min', description: 'Cảnh báo khi throughput thấp hơn ngưỡng' },
  { value: 'THROUGHPUT_HIGH', label: 'Throughput cao', unit: 'msg/min', description: 'Cảnh báo khi throughput cao hơn ngưỡng (có thể là spam)' },
  { value: 'CLIENT_OFFLINE', label: 'Client Offline', unit: 'minutes', description: 'Cảnh báo khi client offline quá lâu' },
];`,
  `const RULE_TYPE_KEYS = [
  { value: 'LATENCY_THRESHOLD', labelKey: 'mqtt.alertRulesPage.types.latencyThreshold', unit: 'ms', descKey: 'mqtt.alertRulesPage.types.latencyThresholdDesc' },
  { value: 'BROKER_DISCONNECT', labelKey: 'mqtt.alertRulesPage.types.brokerDisconnect', unit: 'minutes', descKey: 'mqtt.alertRulesPage.types.brokerDisconnectDesc' },
  { value: 'MESSAGE_FAILURE_RATE', labelKey: 'mqtt.alertRulesPage.types.failureRate', unit: '%', descKey: 'mqtt.alertRulesPage.types.failureRateDesc' },
  { value: 'THROUGHPUT_LOW', labelKey: 'mqtt.alertRulesPage.types.throughputLow', unit: 'msg/min', descKey: 'mqtt.alertRulesPage.types.throughputLowDesc' },
  { value: 'THROUGHPUT_HIGH', labelKey: 'mqtt.alertRulesPage.types.throughputHigh', unit: 'msg/min', descKey: 'mqtt.alertRulesPage.types.throughputHighDesc' },
  { value: 'CLIENT_OFFLINE', labelKey: 'mqtt.alertRulesPage.types.clientOffline', unit: 'minutes', descKey: 'mqtt.alertRulesPage.types.clientOfflineDesc' },
];`);

  // Add RULE_TYPES derivation inside component after hook
  c = c.replace("const { t } = useTranslation();",
    "const { t } = useTranslation();\n  const RULE_TYPES = RULE_TYPE_KEYS.map(rt => ({ ...rt, label: t(rt.labelKey), description: t(rt.descKey) }));");

  // Toasts
  c = c.replace("toast.success('Đã tạo alert rule');", "toast.success(t('mqtt.alertRulesPage.ruleCreated'));");
  c = c.replace("toast.success('Đã cập nhật alert rule');", "toast.success(t('mqtt.alertRulesPage.ruleUpdated'));");
  c = c.replace("toast.success('Đã xóa alert rule');", "toast.success(t('mqtt.alertRulesPage.ruleDeleted'));");
  c = c.replace("toast.success('Đã resolve alert');", "toast.success(t('mqtt.alertRulesPage.alertResolved'));");

  // Helper function return
  c = c.replace("if (!categoryId) return 'Tất cả';", "if (!categoryId) return t('common.all');");

  // Page description
  c = c.replace('>Cấu hình cảnh báo cho MQTT broker và messages</p>',
    ">{t('mqtt.alertRulesPage.description')}</p>");

  // Buttons
  c = c.replace(/(\s+)Làm mới\n(\s+)<\/Button>/, "$1{t('common.refresh')}\n$2</Button>");
  c = c.replace(/(\s+)Tạo Rule\n(\s+)<\/Button>/, "$1{t('mqtt.alertRulesPage.createRule')}\n$2</Button>");

  // Dialog title - conditional
  c = c.replace("{editingRule ? 'Chỉnh sửa Alert Rule' : 'Tạo Alert Rule mới'}",
    "{editingRule ? t('mqtt.alertRulesPage.editRule') : t('mqtt.alertRulesPage.createNewRule')}");

  // Dialog description
  c = c.replace(/(\s+)Cấu hình điều kiện và thông báo khi có sự cố MQTT\n/,
    "$1{t('mqtt.alertRulesPage.dialogDescription')}\n");

  // Form labels
  c = c.replace('>Tên Rule</Label>', ">{t('mqtt.alertRulesPage.ruleName')}</Label>");
  c = c.replace('>Loại Rule</Label>', ">{t('mqtt.alertRulesPage.ruleType')}</Label>");
  c = c.replace('>Mô tả</Label>', ">{t('mqtt.alertRulesPage.descriptionLabel')}</Label>");
  c = c.replace('placeholder="Mô tả chi tiết về rule này..."',
    "placeholder={t('mqtt.alertRulesPage.descriptionPlaceholder')}");
  c = c.replace('>Toán tử</Label>', ">{t('mqtt.alertRulesPage.operator')}</Label>");
  c = c.replace('>Ngưỡng</Label>', ">{t('mqtt.alertRulesPage.threshold')}</Label>");
  c = c.replace('>Đơn vị</Label>', ">{t('mqtt.alertRulesPage.unit')}</Label>");
  c = c.replace('>Khoảng thời gian đánh giá (phút)</Label>',
    ">{t('mqtt.alertRulesPage.evaluationPeriod')}</Label>");
  c = c.replace('>Category sản phẩm (áp dụng cho)</Label>',
    ">{t('mqtt.alertRulesPage.productCategory')}</Label>");
  c = c.replace('>Tất cả category</SelectItem>',
    ">{t('mqtt.alertRulesPage.allCategories')}</SelectItem>");
  c = c.replaceAll('placeholder="Tất cả category"',
    "placeholder={t('mqtt.alertRulesPage.allCategories')}");

  // Notification labels
  c = c.replace('>Gửi notification cho Owner</Label>', ">{t('mqtt.alertRulesPage.notifyOwner')}</Label>");
  c = c.replace('>Gửi Email</Label>', ">{t('mqtt.alertRulesPage.notifyEmail')}</Label>");
  c = c.replace('>Gửi qua MQTT</Label>', ">{t('mqtt.alertRulesPage.notifyMqtt')}</Label>");

  // Dialog buttons
  c = c.replace(/(\s+)Hủy\n(\s+)<\/Button>/, "$1{t('common.cancel')}\n$2</Button>");
  c = c.replace(/(\s+)Cập nhật\n(\s+)<\/Button>/, "$1{t('mqtt.alertRulesPage.update')}\n$2</Button>");

  // Unresolved alerts banner
  c = c.replace('Alert chưa được xử lý', "{t('mqtt.alertRulesPage.unprocessedAlerts')}");

  // Tabs
  c = c.replace('>Lịch sử</TabsTrigger>', ">{t('mqtt.alertRulesPage.history')}</TabsTrigger>");

  // Rule list
  c = c.replace('<CardTitle>Danh sách Alert Rules</CardTitle>',
    "<CardTitle>{t('mqtt.alertRulesPage.ruleList')}</CardTitle>");
  c = c.replace(/>Các rule đang được áp dụng[^<]*<\/CardDescription>/,
    ">{t('mqtt.alertRulesPage.ruleListDesc')}</CardDescription>");

  // Table headers
  c = c.replace('<TableHead>Tên</TableHead>', "<TableHead>{t('mqtt.alertRulesPage.name')}</TableHead>");
  c = c.replace('<TableHead>Loại</TableHead>', "<TableHead>{t('mqtt.alertRulesPage.typeHeader')}</TableHead>");
  c = c.replace('<TableHead>Điều kiện</TableHead>', "<TableHead>{t('mqtt.alertRulesPage.condition')}</TableHead>");
  c = c.replace('<TableHead>Thông báo</TableHead>', "<TableHead>{t('mqtt.alertRulesPage.notification')}</TableHead>");
  c = c.replaceAll('<TableHead>Trạng thái</TableHead>', "<TableHead>{t('common.status')}</TableHead>");
  c = c.replaceAll('<TableHead>Thao tác</TableHead>', "<TableHead>{t('mqtt.alertRulesPage.actionsHeader')}</TableHead>");
  c = c.replaceAll('<TableHead>Thời gian</TableHead>', "<TableHead>{t('mqtt.alertRulesPage.timeHeader')}</TableHead>");

  // Filter items
  c = c.replaceAll('>Tất cả</SelectItem>', ">{t('common.all')}</SelectItem>");

  // Empty state
  c = c.replace('Chưa có alert rule nào', "{t('mqtt.alertRulesPage.noRules')}");

  // History tab
  c = c.replace('<CardTitle>Lịch sử Alert</CardTitle>',
    "<CardTitle>{t('mqtt.alertRulesPage.alertHistory')}</CardTitle>");
  c = c.replace(/>Các alert đã được trigger[^<]*<\/CardDescription>/,
    ">{t('mqtt.alertRulesPage.alertHistoryDesc')}</CardDescription>");

  // History table headers
  c = c.replace('<TableHead>Giá trị</TableHead>', "<TableHead>{t('mqtt.alertRulesPage.value')}</TableHead>");
  c = c.replace('<TableHead>Nội dung</TableHead>', "<TableHead>{t('mqtt.alertRulesPage.content')}</TableHead>");

  // Status badges
  c = c.replace('>Đã xử lý</Badge>', ">{t('mqtt.alertRulesPage.processed')}</Badge>");
  c = c.replace('>Chưa xử lý</Badge>', ">{t('mqtt.alertRulesPage.unprocessed')}</Badge>");

  // Empty history
  c = c.replace('Chưa có alert nào được trigger', "{t('mqtt.alertRulesPage.noAlerts')}");

  return c;
}

// ==================== MqttTopicsMessages.tsx ====================
function migrateMqttTopicsMessages(c) {
  c = addImportAndHook(c, 'MqttTopicsMessages');

  // Toasts (double quotes in original)
  c = c.replace('toast.success("Đã sao chép payload")', "toast.success(t('mqtt.topicsMessages.payloadCopied'))");
  c = c.replace('toast.success("Đã xuất messages")', "toast.success(t('mqtt.topicsMessages.messagesExported'))");
  c = c.replace('toast.info("Tính năng replay đang được phát triển")',
    "toast.info(t('mqtt.topicsMessages.replayInDev'))");

  // Page description
  c = c.replace('>Quản lý topics và xem lịch sử messages MQTT</p>',
    ">{t('mqtt.topicsMessages.description')}</p>");

  // Buttons
  c = c.replace(/(\s+)Làm mới\n(\s+)<\/Button>/, "$1{t('common.refresh')}\n$2</Button>");
  c = c.replace(/(\s+)Xuất JSON\n(\s+)<\/Button>/, "$1{t('mqtt.topicsMessages.exportJson')}\n$2</Button>");

  // Stats cards
  c = c.replace('<CardTitle>Tổng Topics</CardTitle>', "<CardTitle>{t('mqtt.topicsMessages.totalTopics')}</CardTitle>");
  c = c.replace('<CardTitle>Tổng Messages</CardTitle>', "<CardTitle>{t('mqtt.topicsMessages.totalMessages')}</CardTitle>");

  // Topic stats
  c = c.replace('Thống kê messages theo topic', "{t('mqtt.topicsMessages.topicStats')}");
  c = c.replace('Chưa có topic nào', "{t('mqtt.noTopics')}");

  // Search & filters
  c = c.replace('placeholder="Tìm kiếm topic hoặc payload..."',
    "placeholder={t('mqtt.topicsMessages.searchPlaceholder')}");
  c = c.replace('>Tất cả types</SelectItem>', ">{t('mqtt.topicsMessages.allTypes')}</SelectItem>");
  c = c.replace('>Tất cả status</SelectItem>', ">{t('mqtt.topicsMessages.allStatus')}</SelectItem>");

  // Loading/empty  
  c = c.replaceAll('>Đang tải...</p>', ">{t('common.loading')}</p>");
  c = c.replaceAll('>Không có messages</p>', ">{t('mqtt.topicsMessages.noMessages')}</p>");
  c = c.replace('50 messages gần nhất', "{t('mqtt.topicsMessages.recentMessages')}");
  c = c.replace('Chưa có messages', "{t('mqtt.topicsMessages.noMessages')}");

  // Detail dialog
  c = c.replace('>Chi tiết message MQTT</DialogTitle>',
    ">{t('mqtt.topicsMessages.messageDetail')}</DialogTitle>");
  c = c.replace(/(\s+)Đóng\n(\s+)<\/Button>/, "$1{t('common.close')}\n$2</Button>");

  // Replay dialog
  c = c.replace('>Gửi lại message này</DialogTitle>',
    ">{t('mqtt.topicsMessages.replayMessage')}</DialogTitle>");
  c = c.replace(/(\s+)Hủy\n(\s+)<\/Button>/, "$1{t('common.cancel')}\n$2</Button>");
  c = c.replace(/(\s+)Gửi lại\n(\s+)<\/Button>/, "$1{t('mqtt.topicsMessages.resend')}\n$2</Button>");

  return c;
}

// ==================== MQTTReplay.tsx ====================
function migrateMQTTReplay(c) {
  c = addImportAndHook(c, 'MQTTReplay');

  // Template literal toasts
  c = c.replace(/toast\.info\(`Máy mới: \$\{machine\.machineCode\} từ topic \$\{machine\.topic\}`\)/,
    "toast.info(t('mqtt.replayPage.newMachineDetected', { code: machine.machineCode, topic: machine.topic }))");
  c = c.replace(/toast\.success\(`Đã xuất \$\{filteredLiveMessages\.length\} messages`\)/,
    "toast.success(t('mqtt.replayPage.messagesExported', { count: filteredLiveMessages.length }))");

  // Page description
  c = c.replace('>Theo dõi và phát lại tin nhắn MQTT để debug</p>',
    ">{t('mqtt.replayPage.description')}</p>");

  // Connection status
  c = c.replace('>Đã kết nối</Badge>', ">{t('mqtt.connected')}</Badge>");
  c = c.replace('>Mất kết nối</Badge>', ">{t('mqtt.replayPage.lostConnection')}</Badge>");

  // Stream status
  c = c.replace('Đang chờ tin nhắn MQTT...', "{t('mqtt.replayPage.waitingMessages')}");
  c = c.replace('Stream đang chạy', "{t('mqtt.replayPage.streamRunning')}");
  c = c.replace('Stream đã tạm dừng', "{t('mqtt.replayPage.streamPaused')}");

  // Message detail
  c = c.replace('<CardTitle>Chi tiết Message</CardTitle>',
    "<CardTitle>{t('mqtt.replayPage.messageDetail')}</CardTitle>");
  c = c.replace('Chọn một message để xem chi tiết', "{t('mqtt.replayPage.selectMessage')}");

  // History tab
  c = c.replace('<CardTitle>Lịch sử Message</CardTitle>',
    "<CardTitle>{t('mqtt.replayPage.messageHistory')}</CardTitle>");
  c = c.replace('>Xem lại các tin nhắn MQTT đã được lưu trữ</CardDescription>',
    ">{t('mqtt.replayPage.historyDescription')}</CardDescription>");
  c = c.replace(/(\s+)Làm mới\n(\s+)<\/Button>/, "$1{t('common.refresh')}\n$2</Button>");
  c = c.replace('Không có lịch sử message', "{t('mqtt.replayPage.noHistory')}");

  // Auto-discovery
  c = c.replace('>Các máy được tự động phát hiện từ MQTT topics</CardDescription>',
    ">{t('mqtt.replayPage.autoDiscoveryDesc')}</CardDescription>");
  c = c.replace('>Phát hiện lần đầu:</span>', ">{t('mqtt.replayPage.firstDetected')}:</span>");
  c = c.replace('>Lần cuối:</span>', ">{t('mqtt.replayPage.lastSeen')}:</span>");
  c = c.replace('>Số message:</span>', ">{t('mqtt.replayPage.messageCountLabel')}:</span>");
  c = c.replace('>Đã đăng ký</Badge>', ">{t('mqtt.replayPage.registered')}</Badge>");
  c = c.replace('>Mới</Badge>', ">{t('mqtt.replayPage.new')}</Badge>");
  c = c.replace('>Đăng ký máy</Button>', ">{t('mqtt.replayPage.registerMachine')}</Button>");
  c = c.replace('Chưa phát hiện máy nào từ MQTT', "{t('mqtt.replayPage.noMachinesDetected')}");
  c = c.replace('Hệ thống sẽ tự động phát hiện khi có message từ máy mới',
    "{t('mqtt.replayPage.autoDetectInfo')}");

  return c;
}

// ==================== MqttBulletin.tsx ====================
function migrateMqttBulletin(c) {
  c = addImportAndHook(c, 'MqttBulletin');

  // Toasts
  c = c.replace('toast.success("Cấu hình đã được lưu")', "toast.success(t('mqtt.bulletinPage.settingsSaved'))");
  c = c.replaceAll(/toast\.error\(`Lỗi: \$\{err\.message\}`\)/g,
    "toast.error(t('mqtt.bulletinPage.errorMsg', { message: err.message }))");
  c = c.replace(/toast\.success\(`Đã cấu hình \$\{result\.total\} station \(\$\{result\.created\} mới, \$\{result\.updated\} cập nhật\)`\)/,
    "toast.success(t('mqtt.bulletinPage.stationsConfigured', { total: result.total, created: result.created, updated: result.updated }))");
  c = c.replace('toast.success("Đã cập nhật trạng thái")', "toast.success(t('mqtt.bulletinPage.statusUpdated'))");
  c = c.replace('toast.success("Đã xóa cấu hình")', "toast.success(t('mqtt.bulletinPage.settingsDeleted'))");
  c = c.replace('toast.success("Đã gửi bản tin")', "toast.success(t('mqtt.bulletinPage.bulletinSent'))");
  c = c.replace(/toast\.error\(`Lỗi gửi test: \$\{err\.message\}`\)/,
    "toast.error(t('mqtt.bulletinPage.testSendError', { message: err.message }))");
  c = c.replace('toast.error("Vui lòng chọn station")', "toast.error(t('mqtt.bulletinPage.pleaseSelectStation'))");
  c = c.replace('toast.error("Không xác định được station")', "toast.error(t('mqtt.bulletinPage.stationNotFound'))");
  c = c.replace('toast.error("Vui lòng chọn ít nhất 1 station")',
    "toast.error(t('mqtt.bulletinPage.selectAtLeast1'))");

  // Page title & description
  c = c.replace('>Bản tin MQTT</h2>', ">{t('mqtt.bulletinPage.title')}</h2>");
  c = c.replace(/Tổng hợp thông tin OK\/NG\/NTF[^"<]*/,
    "{t('mqtt.bulletinPage.description')}");

  // Test button
  c = c.replace(/(\s+)Gửi bản tin test\n(\s+)<\/Button>/, "$1{t('mqtt.bulletinPage.sendTestBulletin')}\n$2</Button>");

  // Status badges
  c = c.replace('>Đang chạy</Badge>', ">{t('mqtt.bulletinPage.running')}</Badge>");
  c = c.replace('>Tắt</Badge>', ">{t('mqtt.bulletinPage.off')}</Badge>");

  // Dashboard stats
  c = c.replace('>Số bản tin (7 ngày)</p>', ">{t('mqtt.bulletinPage.bulletinCount7d')}</p>");
  c = c.replace('>Tổng kiểm tra</p>', ">{t('mqtt.bulletinPage.totalInspection')}</p>");
  c = c.replace('>Tổng NG</p>', ">{t('mqtt.bulletinPage.totalNg')}</p>");

  // Station stats
  c = c.replace('Thống kê theo Station', "{t('mqtt.bulletinPage.stationStats')}");
  c = c.replace('Chưa có dữ liệu bản tin', "{t('mqtt.bulletinPage.noData')}");

  // Settings tab
  c = c.replace('Cấu hình bản tin theo Station', "{t('mqtt.bulletinPage.settingsTitle')}");
  c = c.replace(/(\s+)Thêm Station \(nhiều\)\n(\s+)<\/Button>/,
    "$1{t('mqtt.bulletinPage.addStations')}\n$2</Button>");

  c = c.replace('Chưa có cấu hình bản tin nào', "{t('mqtt.bulletinPage.noSettings')}");

  // Table headers
  c = c.replaceAll('<TableHead>Trạng thái</TableHead>', "<TableHead>{t('common.status')}</TableHead>");
  c = c.replace('<TableHead>Chu kỳ</TableHead>', "<TableHead>{t('mqtt.bulletinPage.interval')}</TableHead>");
  c = c.replace('<TableHead>Giờ hoạt động</TableHead>', "<TableHead>{t('mqtt.bulletinPage.activeHours')}</TableHead>");
  c = c.replace('<TableHead>Ảnh</TableHead>', "<TableHead>{t('mqtt.bulletinPage.images')}</TableHead>");
  c = c.replace('<TableHead>Gửi lần cuối</TableHead>', "<TableHead>{t('mqtt.bulletinPage.lastSent')}</TableHead>");
  c = c.replaceAll('<TableHead>Thao tác</TableHead>', "<TableHead>{t('mqtt.bulletinPage.actionsHeader')}</TableHead>");

  // Action button titles
  c = c.replaceAll('title="Gửi ngay"', "title={t('mqtt.bulletinPage.sendNow')}");
  c = c.replaceAll('title="Chỉnh sửa"', "title={t('common.edit')}");
  c = c.replaceAll('title="Xóa"', "title={t('common.delete')}");

  // History tab
  c = c.replace('>Lịch sử bản tin</CardTitle>', ">{t('mqtt.bulletinPage.historyTitle')}</CardTitle>");
  c = c.replace('>Tất cả station</SelectItem>', ">{t('mqtt.bulletinPage.allStations')}</SelectItem>");
  c = c.replaceAll('placeholder="Tất cả station"', "placeholder={t('mqtt.bulletinPage.allStations')}");
  c = c.replace('Chưa có lịch sử bản tin nào', "{t('mqtt.bulletinPage.noHistory')}");

  // Pagination
  c = c.replace(/(\s+)Trước\n(\s+)<\/Button>/, "$1{t('common.previous')}\n$2</Button>");
  c = c.replace(/(\s+)Sau\n(\s+)<\/Button>/, "$1{t('common.next')}\n$2</Button>");

  // Showing X-Y / Z
  c = c.replace(/Hiển thị \{[^}]+\} - \{[^}]+\} \/ \{[^}]+\} bản tin/,
    "{t('mqtt.bulletinPage.showing', { from: (historyPage) * pageSize + 1, to: Math.min((historyPage + 1) * pageSize, histories.length), total: histories.length })}");

  // Add/Edit dialog
  c = c.replace('>Chỉnh sửa cấu hình bản tin</DialogTitle>',
    ">{t('mqtt.bulletinPage.editSettings')}</DialogTitle>");
  c = c.replace('>Thêm cấu hình bản tin cho nhiều Station</DialogTitle>',
    ">{t('mqtt.bulletinPage.addSettingsMulti')}</DialogTitle>");

  // Form labels
  c = c.replace('>Chu kỳ gửi (phút)</Label>', ">{t('mqtt.bulletinPage.intervalMinutes')}</Label>");
  c = c.replace('>Giờ bắt đầu</Label>', ">{t('mqtt.bulletinPage.startHour')}</Label>");
  c = c.replace('>Giờ kết thúc</Label>', ">{t('mqtt.bulletinPage.endHour')}</Label>");
  c = c.replace('>Số điểm Fail tối đa</Label>', ">{t('mqtt.bulletinPage.maxFailPoints')}</Label>");

  // Station search
  c = c.replaceAll('placeholder="Tìm station theo tên hoặc ID..."',
    "placeholder={t('mqtt.bulletinPage.searchStation')}");
  c = c.replace(/(\s+)Chọn tất cả\n(\s+)<\/Button>/, "$1{t('common.selectAll')}\n$2</Button>");
  c = c.replace(/(\s+)Bỏ chọn tất cả\n(\s+)<\/Button>/, "$1{t('common.deselectAll')}\n$2</Button>");

  // Switch labels
  c = c.replace('>Bao gồm ảnh điểm Fail</Label>', ">{t('mqtt.bulletinPage.includeFailImages')}</Label>");
  c = c.replace('>Gửi qua External MQTT</Label>', ">{t('mqtt.bulletinPage.sendExternal')}</Label>");
  c = c.replace('>Gửi FCM Push</Label>', ">{t('mqtt.bulletinPage.sendFcm')}</Label>");

  // Dialog buttons
  c = c.replace(/(\s+)Hủy\n(\s+)<\/Button>/, "$1{t('common.cancel')}\n$2</Button>");
  c = c.replace(/"Đang lưu\.\.\."/, "t('mqtt.bulletinPage.saving')");
  c = c.replace(/"Lưu cấu hình"/, "t('mqtt.bulletinPage.saveSettings')");

  // Apply to N stations
  c = c.replace(/`Áp dụng cho \$\{selectedStationIds\.length\} station`/,
    "t('mqtt.bulletinPage.applyToStations', { count: selectedStationIds.length })");

  // Detail dialog
  c = c.replace('>Chi tiết bản tin</DialogTitle>', ">{t('mqtt.bulletinPage.detailTitle')}</DialogTitle>");
  c = c.replace('>Chu kỳ:', ">{t('mqtt.bulletinPage.period')}:");
  c = c.replace('>Danh sách điểm đo Fail', ">{t('mqtt.bulletinPage.failPointsList')}");
  c = c.replace('<TableHead>Mã điểm</TableHead>', "<TableHead>{t('mqtt.bulletinPage.pointCode')}</TableHead>");
  c = c.replace('<TableHead>Tên</TableHead>', "<TableHead>{t('mqtt.bulletinPage.pointName')}</TableHead>");
  c = c.replace(/(<TableHead[^>]*>)Số lần NG(<\/TableHead>)/, "$1{t('mqtt.bulletinPage.ngCountHeader')}$2");
  c = c.replace(/(<TableHead[^>]*>)Tỷ lệ(<\/TableHead>)/, "$1{t('mqtt.bulletinPage.rateHeader')}$2");

  // Test dialog
  c = c.replace('>Gửi bản tin test</DialogTitle>', ">{t('mqtt.bulletinPage.sendTestBulletin')}</DialogTitle>");
  c = c.replace(/>Gửi một bản tin MQTT với dữ liệu ngẫu nhiên để kiểm tra kết nối với app[^<]*/,
    ">{t('mqtt.bulletinPage.testDescription')}");
  c = c.replace('>Chọn Station để gửi test</Label>', ">{t('mqtt.bulletinPage.selectTestStation')}</Label>");
  c = c.replaceAll('placeholder="Chọn station"', "placeholder={t('mqtt.bulletinPage.selectStation')}");
  c = c.replace('>Gửi qua External MQTT (HiveMQ)</Label>',
    ">{t('mqtt.bulletinPage.sendExternalHiveMQ')}</Label>");
  c = c.replace(/"Đang gửi\.\.\."/, "t('mqtt.bulletinPage.sendingTest')");

  // JSON payload
  c = c.replace('>JSON Payload đã gửi:</Label>', ">{t('mqtt.bulletinPage.jsonPayloadSent')}:</Label>");
  c = c.replace(/Xem JSON đầy đủ ▸/, "{t('mqtt.bulletinPage.viewFullJson')} ▸");

  // Info box
  c = c.replace(/Bản tin test sẽ có dữ liệu[^<]*/, "{t('mqtt.bulletinPage.testInfoLine1')}");
  c = c.replace(/và được publish lên MQTT topic[^<]*/, "{t('mqtt.bulletinPage.testInfoLine2')}");

  // Refresh
  c = c.replace(/(\s+)Làm mới\n(\s+)<\/Button>/, "$1{t('common.refresh')}\n$2</Button>");

  return c;
}

// ==================== MqttClientManagement.tsx ====================
function migrateMqttClientManagement(c) {
  c = addImportAndHook(c, 'MqttClientManagement');

  // Toasts
  c = c.replace("toast.success('Đã tạo MQTT client');", "toast.success(t('mqtt.clientMgmt.clientCreated'));");
  c = c.replace("toast.success('Đã cập nhật client');", "toast.success(t('mqtt.clientMgmt.clientUpdated'));");
  c = c.replace("toast.success('Đã xóa client');", "toast.success(t('mqtt.clientMgmt.clientDeleted'));");
  c = c.replace("toast.success('Đã phê duyệt thiết bị');", "toast.success(t('mqtt.clientMgmt.deviceApproved'));");
  c = c.replace("toast.success('Đã từ chối thiết bị');", "toast.success(t('mqtt.clientMgmt.deviceRejected'));");
  c = c.replace("toast.success('Đã cập nhật mapping');", "toast.success(t('mqtt.clientMgmt.mappingUpdated'));");
  c = c.replace("toast.success('Đã ngắt kết nối và reset mapping');",
    "toast.success(t('mqtt.clientMgmt.disconnectResetDone'));");
  c = c.replace("toast.success('Đã tạo kết nối thủ công');",
    "toast.success(t('mqtt.clientMgmt.manualConnectionCreated'));");
  c = c.replace("toast.success('Đã xóa kết nối');", "toast.success(t('mqtt.clientMgmt.connectionDeleted'));");
  c = c.replace(/toast\.success\(`Kết nối thành công \(\$\{result\.latencyMs\}ms\)`\)/,
    "toast.success(t('mqtt.clientMgmt.connectionSuccess', { latency: result.latencyMs }))");
  c = c.replace(/toast\.error\(`Kết nối thất bại: \$\{result\.message\}`\)/,
    "toast.error(t('mqtt.clientMgmt.connectionFailed', { message: result.message }))");

  // Page title
  c = c.replace('>Quản lý MQTT Clients</h2>', ">{t('mqtt.clientMgmt.title')}</h2>");
  c = c.replace('>chờ duyệt</span>', ">{t('mqtt.clientMgmt.pendingLabel')}</span>");
  c = c.replace(/>Quản lý thiết bị MQTT[^<]*/, ">{t('mqtt.clientMgmt.description')}");

  // Buttons
  c = c.replace(/(\s+)Làm mới\n(\s+)<\/Button>/, "$1{t('common.refresh')}\n$2</Button>");
  c = c.replace(/(\s+)Thêm kết nối thủ công\n(\s+)<\/Button>/,
    "$1{t('mqtt.clientMgmt.addManualConnection')}\n$2</Button>");

  // Create dialog
  c = c.replace('>Thêm MQTT Client</DialogTitle>', ">{t('mqtt.addClient')}</DialogTitle>");
  c = c.replace(/>Tạo client thủ công để kết nối[^<]*/, ">{t('mqtt.clientMgmt.createClientDesc')}");

  // Form labels
  c = c.replaceAll('>Công trạm</Label>', ">{t('mqtt.clientMgmt.workstation')}</Label>");
  c = c.replaceAll('placeholder="Chọn công trạm"', "placeholder={t('mqtt.clientMgmt.selectWorkstation')}");
  c = c.replaceAll('>Không chọn</SelectItem>', ">{t('mqtt.clientMgmt.noSelection')}</SelectItem>");
  c = c.replace('>Nhận NG Alerts</Label>', ">{t('mqtt.clientMgmt.receiveNgAlerts')}</Label>");
  c = c.replace('>Nhận Daily Summary</Label>', ">{t('mqtt.clientMgmt.receiveDailySummary')}</Label>");
  c = c.replace('>Nhận Weekly Summary</Label>', ">{t('mqtt.clientMgmt.receiveWeeklySummary')}</Label>");

  // Dialog buttons
  c = c.replace(/(\s+)Hủy\n(\s+)<\/Button>/, "$1{t('common.cancel')}\n$2</Button>");
  c = c.replace('>Đang tạo...</Button>', ">{t('mqtt.clientMgmt.creating')}</Button>");
  c = c.replace('>Tạo Client</Button>', ">{t('mqtt.clientMgmt.createClient')}</Button>");

  // Search
  c = c.replace('placeholder="Tìm kiếm theo tên, Device ID, IP..."',
    "placeholder={t('mqtt.clientMgmt.searchPlaceholder')}");

  // Status filter
  c = c.replaceAll('>Tất cả trạng thái</SelectItem>',
    ">{t('mqtt.clientMgmt.allStatuses')}</SelectItem>");
  c = c.replaceAll('placeholder="Tất cả trạng thái"',
    "placeholder={t('mqtt.clientMgmt.allStatuses')}");

  // Approval filter
  c = c.replaceAll('>Tất cả</SelectItem>', ">{t('common.all')}</SelectItem>");
  c = c.replace('>Chờ duyệt</SelectItem>', ">{t('mqtt.clientMgmt.pendingFilter')}</SelectItem>");
  c = c.replace('>Đã duyệt</SelectItem>', ">{t('mqtt.clientMgmt.approvedFilter')}</SelectItem>");
  c = c.replace('>Từ chối</SelectItem>', ">{t('mqtt.clientMgmt.rejectedFilter')}</SelectItem>");

  // Tabs
  c = c.replace('>Kết nối thủ công</TabsTrigger>', ">{t('mqtt.clientMgmt.manualConnections')}</TabsTrigger>");
  c = c.replace('>Sức khỏe</TabsTrigger>', ">{t('mqtt.clientMgmt.health')}</TabsTrigger>");
  c = c.replace('>Lịch sử</TabsTrigger>', ">{t('mqtt.clientMgmt.historyTab')}</TabsTrigger>");

  // Client list
  c = c.replace('<CardTitle>Danh sách MQTT Clients</CardTitle>',
    "<CardTitle>{t('mqtt.clientMgmt.clientList')}</CardTitle>");
  c = c.replaceAll('<TableHead>Thiết bị</TableHead>', "<TableHead>{t('mqtt.clientMgmt.device')}</TableHead>");
  c = c.replaceAll('<TableHead>Kết nối</TableHead>', "<TableHead>{t('mqtt.clientMgmt.connection')}</TableHead>");
  c = c.replaceAll('<TableHead>Phê duyệt</TableHead>',
    "<TableHead>{t('mqtt.clientMgmt.approvalHeader')}</TableHead>");
  c = c.replaceAll('<TableHead>Công trạm</TableHead>',
    "<TableHead>{t('mqtt.clientMgmt.workstationHeader')}</TableHead>");
  c = c.replaceAll('<TableHead>Thông báo</TableHead>',
    "<TableHead>{t('mqtt.clientMgmt.notifications')}</TableHead>");
  c = c.replaceAll('<TableHead>Thao tác</TableHead>',
    "<TableHead>{t('mqtt.clientMgmt.actionsHeader')}</TableHead>");
  c = c.replaceAll('<TableHead>Trạng thái</TableHead>', "<TableHead>{t('common.status')}</TableHead>");
  c = c.replaceAll('<TableHead>Thời gian</TableHead>', "<TableHead>{t('mqtt.clientMgmt.timeHeader')}</TableHead>");
  c = c.replaceAll('<TableHead>Loại</TableHead>', "<TableHead>{t('mqtt.clientMgmt.typeHeader')}</TableHead>");

  // Action button titles
  c = c.replaceAll('title="Phê duyệt"', "title={t('mqtt.clientMgmt.approve')}");
  c = c.replaceAll('title="Từ chối"', "title={t('mqtt.clientMgmt.reject')}");
  c = c.replaceAll('title="Chỉnh sửa"', "title={t('common.edit')}");
  c = c.replaceAll('title="Ngắt kết nối & Reset"', "title={t('mqtt.clientMgmt.disconnectReset')}");
  c = c.replaceAll('title="Xóa"', "title={t('common.delete')}");
  c = c.replaceAll('title="Test kết nối"', "title={t('mqtt.testConnection')}");

  // Empty states
  c = c.replaceAll('>Chưa có MQTT client nào</p>', ">{t('mqtt.clientMgmt.noClients')}</p>");
  c = c.replaceAll('>Không tìm thấy client phù hợp</p>',
    ">{t('mqtt.clientMgmt.noMatchingClients')}</p>");

  // Manual connections tab
  c = c.replace('<CardTitle>Kết nối thủ công</CardTitle>',
    "<CardTitle>{t('mqtt.clientMgmt.manualConnections')}</CardTitle>");
  c = c.replace(/>Kết nối trực tiếp tới máy[^<]*<\/CardDescription>/,
    ">{t('mqtt.clientMgmt.manualConnectionsDesc')}</CardDescription>");
  c = c.replaceAll('<TableHead>Máy</TableHead>', "<TableHead>{t('mqtt.clientMgmt.machine')}</TableHead>");
  c = c.replace('Chưa có kết nối thủ công nào', "{t('mqtt.clientMgmt.noManualConnections')}");

  // Health tab
  c = c.replace('Chưa có dữ liệu sức khỏe clients', "{t('mqtt.clientMgmt.noHealthData')}");

  // History tab
  c = c.replaceAll('placeholder="Chọn Client"', "placeholder={t('mqtt.clientMgmt.selectClient')}");
  c = c.replace('<CardTitle>Lịch sử kết nối</CardTitle>',
    "<CardTitle>{t('mqtt.clientMgmt.connectionHistory')}</CardTitle>");
  c = c.replace("'Chưa có lịch sử'", "t('mqtt.clientMgmt.noHistory')");
  c = c.replace("'Chọn client để xem lịch sử'", "t('mqtt.clientMgmt.selectClientForHistory')");

  // Approve dialog
  c = c.replace('>Phê duyệt thiết bị</DialogTitle>',
    ">{t('mqtt.clientMgmt.approveDevice')}</DialogTitle>");
  c = c.replace(/>Phê duyệt thiết bị "[^"]*"[^<]*/,
    ">{t('mqtt.clientMgmt.approveDeviceDesc')}");
  c = c.replace('>Công trạm (tùy chọn)</Label>', ">{t('mqtt.clientMgmt.workstationOptional')}</Label>");
  c = c.replace('>Loại mapping</Label>', ">{t('mqtt.clientMgmt.mappingType')}</Label>");
  c = c.replace('>Thủ công - Giữ mapping khi reconnect</SelectItem>',
    ">{t('mqtt.clientMgmt.manualMapping')}</SelectItem>");
  c = c.replace('>Tự động - Cho phép reset mapping</SelectItem>',
    ">{t('mqtt.clientMgmt.autoMapping')}</SelectItem>");
  c = c.replace('>Phê duyệt</Button>', ">{t('mqtt.clientMgmt.approve')}</Button>");

  // Edit dialog
  c = c.replace('>Chỉnh sửa Client</DialogTitle>', ">{t('mqtt.editClient')}</DialogTitle>");
  c = c.replace(/>Cập nhật cài đặt cho [^<]*/, ">{t('mqtt.clientMgmt.updateSettingsFor')}");
  c = c.replace("'Đang lưu...'", "t('mqtt.clientMgmt.saving')");
  c = c.replace("'Lưu thay đổi'", "t('mqtt.clientMgmt.saveChanges')");

  // Manual connection dialog
  c = c.replace('>Thêm kết nối thủ công</DialogTitle>',
    ">{t('mqtt.clientMgmt.addManualConnection')}</DialogTitle>");
  c = c.replace('>Tạo kết nối trực tiếp tới máy qua IP</DialogDescription>',
    ">{t('mqtt.clientMgmt.createManualDesc')}</DialogDescription>");
  c = c.replaceAll('>Máy</Label>', ">{t('mqtt.clientMgmt.machine')}</Label>");
  c = c.replaceAll('placeholder="Chọn máy"', "placeholder={t('mqtt.clientMgmt.selectMachine')}");
  c = c.replace('>Tạo kết nối</Button>', ">{t('mqtt.clientMgmt.createConnection')}</Button>");

  return c;
}

// ==================== MqttProfileManagement.tsx ====================
function migrateMqttProfileManagement(c) {
  c = addImportAndHook(c, 'MqttProfileManagement');

  // Toasts
  c = c.replace('toast.success("Đã tạo profile mới")', "toast.success(t('mqtt.profileMgmt.profileCreated'))");
  c = c.replace('toast.success("Đã cập nhật profile")', "toast.success(t('mqtt.profileMgmt.profileUpdated'))");
  c = c.replace('toast.success("Đã xóa profile")', "toast.success(t('mqtt.profileMgmt.profileDeleted'))");
  c = c.replace('toast.success("Đã nhân bản profile")', "toast.success(t('mqtt.profileMgmt.profileDuplicated'))");
  c = c.replace('toast.success("Đã gán profile")', "toast.success(t('mqtt.profileMgmt.profileAssigned'))");
  c = c.replace(/toast\.success\(`Import hoàn tất: \$\{result\.profilesImported\} imported, \$\{result\.profilesUpdated\} updated, \$\{result\.profilesSkipped\} skipped`\)/,
    "toast.success(t('mqtt.profileMgmt.importComplete', { imported: result.profilesImported, updated: result.profilesUpdated, skipped: result.profilesSkipped }))");
  c = c.replace('toast.success("Đã gỡ bỏ assignment")', "toast.success(t('mqtt.profileMgmt.assignmentRemoved'))");
  c = c.replace('toast.success("Đã cập nhật cấu hình cảnh báo")',
    "toast.success(t('mqtt.profileMgmt.alertConfigUpdated'))");
  c = c.replace('toast.success("Đã xác nhận cảnh báo")',
    "toast.success(t('mqtt.profileMgmt.alertAcknowledged'))");
  c = c.replace('toast.success("Đã giải quyết cảnh báo")',
    "toast.success(t('mqtt.profileMgmt.alertResolved'))");
  c = c.replace("toast.error('File JSON không hợp lệ')",
    "toast.error(t('mqtt.profileMgmt.invalidJson'))");

  // Page title & description
  c = c.replace('>Quản lý MQTT Profiles</h2>', ">{t('mqtt.profileMgmt.title')}</h2>");
  c = c.replace(/>Cấu hình tập trung các MQTT profiles[^<]*/,
    ">{t('mqtt.profileMgmt.description')}");

  // Create button
  c = c.replace(/(\s+)Tạo Profile mới\n(\s+)<\/Button>/,
    "$1{t('mqtt.profileMgmt.createProfile')}\n$2</Button>");

  // Connection detail
  c = c.replace('Chi tiết kết nối:', "{t('mqtt.profileMgmt.connectionDetail')}:");

  // Profile action titles
  c = c.replaceAll('title="Gán cho 1 target"', "title={t('mqtt.profileMgmt.assignSingle')}");
  c = c.replaceAll('title="Gán cho nhiều targets"', "title={t('mqtt.profileMgmt.assignMultiple')}");

  // Empty states
  c = c.replaceAll('Chưa có profile nào', "{t('mqtt.profileMgmt.noProfiles')}");
  c = c.replace('Chưa có assignment nào', "{t('mqtt.profileMgmt.noAssignments')}");
  c = c.replace('Chưa có log nào', "{t('mqtt.profileMgmt.noLogs')}");
  c = c.replace('Chưa có template nào', "{t('mqtt.profileMgmt.noTemplates')}");
  c = c.replace('Chưa có dữ liệu connection status', "{t('mqtt.profileMgmt.noConnectionData')}");
  c = c.replace('Chưa có lịch sử reconnect', "{t('mqtt.profileMgmt.noReconnectHistory')}");

  // Create/Edit dialog
  c = c.replace('>Chỉnh sửa Profile</DialogTitle>', ">{t('mqtt.editProfile')}</DialogTitle>");
  c = c.replace('>Tạo Profile mới</DialogTitle>', ">{t('mqtt.profileMgmt.createProfile')}</DialogTitle>");
  c = c.replace(/>Cấu hình thông số kết nối MQTT broker[^<]*/,
    ">{t('mqtt.profileMgmt.dialogDescription')}");

  // Form labels
  c = c.replace('>Tên Profile *</Label>', ">{t('mqtt.profileMgmt.profileNameRequired')}</Label>");
  c = c.replaceAll('>Mô tả</Label>', ">{t('mqtt.profileMgmt.descriptionLabel')}</Label>");
  c = c.replaceAll('placeholder="Mô tả profile..."',
    "placeholder={t('mqtt.profileMgmt.descriptionPlaceholder')}");
  c = c.replace('>Broker URL *</Label>', ">{t('mqtt.profileMgmt.brokerUrlRequired')}</Label>");

  // Auto-reconnect descriptions
  c = c.replace('>Delay tăng theo hệ số này sau mỗi lần thử lại</p>',
    ">{t('mqtt.profileMgmt.backoffDesc')}</p>");
  c = c.replace('>Delay tối đa giữa các lần reconnect</p>',
    ">{t('mqtt.profileMgmt.maxDelayDesc')}</p>");

  // Topics labels
  c = c.replace('>Subscribe Topics (mỗi dòng 1 topic)</Label>',
    ">{t('mqtt.profileMgmt.subscribeTopics')}</Label>");
  c = c.replace('>Publish Topics (mỗi dòng 1 topic)</Label>',
    ">{t('mqtt.profileMgmt.publishTopics')}</Label>");

  // Dialog buttons
  c = c.replace(/(\s+)Hủy\n(\s+)<\/Button>/, "$1{t('common.cancel')}\n$2</Button>");
  c = c.replace('"Cập nhật"', "t('mqtt.profileMgmt.update')");
  c = c.replace('"Tạo Profile"', "t('mqtt.profileMgmt.createProfileBtn')");

  // Assign dialog
  c = c.replace('>Gán Profile cho Target</DialogTitle>',
    ">{t('mqtt.profileMgmt.assignToTarget')}</DialogTitle>");
  c = c.replace(/>Chọn loại target và target cụ thể để gán profile[^<]*/,
    ">{t('mqtt.profileMgmt.assignDescription')}");
  c = c.replaceAll('>Loại Target</Label>', ">{t('mqtt.profileMgmt.targetType')}</Label>");
  c = c.replaceAll('placeholder="Chọn target..."', "placeholder={t('mqtt.profileMgmt.selectTarget')}");
  c = c.replace('>Gán Profile</Button>', ">{t('mqtt.profileMgmt.assignProfile')}</Button>");

  // Import dialog
  c = c.replace(/>Chọn file JSON đã export[^<]*/,
    ">{t('mqtt.profileMgmt.importDescription')}");
  c = c.replace('>Ghi đè profiles trùng tên</Label>',
    ">{t('mqtt.profileMgmt.overwriteExisting')}</Label>");
  c = c.replace(/>Bỏ qua profiles trùng tên[^<]*<\/Label>/,
    ">{t('mqtt.profileMgmt.skipDuplicates')}</Label>");

  // Alert configuration tab
  c = c.replace('>Cấu hình Cảnh báo</CardTitle>', ">{t('mqtt.profileMgmt.alertConfig')}</CardTitle>");
  c = c.replace('>Mất kết nối (phút)</Label>', ">{t('mqtt.profileMgmt.connectionLostMin')}</Label>");
  c = c.replace('>Cảnh báo khi mất kết nối quá thời gian này</p>',
    ">{t('mqtt.profileMgmt.connectionLostDesc')}</p>");
  c = c.replace('>Reconnect thất bại (lần)</Label>', ">{t('mqtt.profileMgmt.reconnectFailedCount')}</Label>");
  c = c.replace('>Cảnh báo khi reconnect thất bại liên tiếp</p>',
    ">{t('mqtt.profileMgmt.reconnectFailedDesc')}</p>");
  c = c.replace('>Tần suất reconnect cao (lần/giờ)</Label>',
    ">{t('mqtt.profileMgmt.highReconnectRate')}</Label>");
  c = c.replace('>Cảnh báo khi reconnect quá nhiều trong 1 giờ</p>',
    ">{t('mqtt.profileMgmt.highReconnectRateDesc')}</p>");
  c = c.replace('>Ngắt kết nối lâu (phút)</Label>', ">{t('mqtt.profileMgmt.longDisconnection')}</Label>");
  c = c.replace('>Cảnh báo khi ngắt kết nối quá lâu</p>',
    ">{t('mqtt.profileMgmt.longDisconnectionDesc')}</p>");

  // Alert list
  c = c.replace('>Danh sách Cảnh báo</CardTitle>', ">{t('mqtt.profileMgmt.alertList')}</CardTitle>");
  c = c.replaceAll('>Không có cảnh báo nào</p>', ">{t('mqtt.profileMgmt.noAlerts')}</p>");

  // Analytics - Heatmap
  c = c.replace('>Reconnect Heatmap (7 ngày gần nhất)</CardTitle>',
    ">{t('mqtt.profileMgmt.reconnectHeatmap')}</CardTitle>");
  c = c.replace('>Phân bố reconnect theo giờ và ngày trong tuần</CardDescription>',
    ">{t('mqtt.profileMgmt.heatmapDesc')}</CardDescription>");
  c = c.replaceAll('>Ít</span>', ">{t('mqtt.profileMgmt.less')}</span>");
  c = c.replaceAll('>Nhiều</span>', ">{t('mqtt.profileMgmt.more')}</span>");
  c = c.replace('Chưa có dữ liệu heatmap', "{t('mqtt.profileMgmt.noHeatmapData')}");

  // Top reconnect profiles
  c = c.replace('>Top Profiles có nhiều Reconnect nhất</CardTitle>',
    ">{t('mqtt.profileMgmt.topReconnectProfiles')}</CardTitle>");
  c = c.replace(/>Profiles có tần suất reconnect cao[^<]*<\/CardDescription>/,
    ">{t('mqtt.profileMgmt.topReconnectDesc')}</CardDescription>");
  c = c.replace('Chưa có dữ liệu reconnect', "{t('mqtt.profileMgmt.noReconnectData')}");

  // Reconnect trend
  c = c.replace('>Xu hướng Reconnect (30 ngày)</CardTitle>',
    ">{t('mqtt.profileMgmt.reconnectTrend')}</CardTitle>");
  c = c.replace('Chưa có dữ liệu trend', "{t('mqtt.profileMgmt.noTrendData')}");

  // Bulk assign dialog
  c = c.replace('>Gán Profile cho nhiều Targets</DialogTitle>',
    ">{t('mqtt.profileMgmt.bulkAssignTitle')}</DialogTitle>");
  c = c.replace(/>Chọn nhiều machines\/stations\/factories[^<]*/,
    ">{t('mqtt.profileMgmt.bulkAssignDesc')}");
  c = c.replace('>Thay thế assignments hiện có</Label>',
    ">{t('mqtt.profileMgmt.replaceExisting')}</Label>");
  c = c.replace(/(\s+)Chọn tất cả\n(\s+)<\/Button>/, "$1{t('common.selectAll')}\n$2</Button>");
  c = c.replace(/(\s+)Bỏ chọn\n(\s+)<\/Button>/, "$1{t('mqtt.profileMgmt.deselect')}\n$2</Button>");
  c = c.replaceAll('>Đã gán</Badge>', ">{t('mqtt.profileMgmt.assigned')}</Badge>");
  c = c.replace('Không có target nào khả dụng', "{t('mqtt.profileMgmt.noTargetsAvailable')}");
  c = c.replace('>Các assignments hiện có sẽ bị thay thế</p>',
    ">{t('mqtt.profileMgmt.replaceWarning')}</p>");
  c = c.replace("'Đang gán...'", "t('mqtt.profileMgmt.assigning')");

  // Dynamic button text
  c = c.replace(/`Gán \$\{selectedTargets\.length\} targets`/,
    "t('mqtt.profileMgmt.assignTargets', { count: selectedTargets.length })");

  // Refresh
  c = c.replace(/(\s+)Làm mới\n(\s+)<\/Button>/, "$1{t('common.refresh')}\n$2</Button>");

  // Common table headers
  c = c.replaceAll('<TableHead>Tên</TableHead>', "<TableHead>{t('common.name')}</TableHead>");

  return c;
}

// ==================== Locale JSON updates ====================
function updateLocaleFiles() {
  const newMqttKeys = {
    "dashboard": {
      "description": "Giám sát kết nối và tin nhắn MQTT realtime",
      "alertSoundOff": "Đã tắt âm thanh cảnh báo",
      "alertSoundOn": "Đã bật âm thanh cảnh báo",
      "ngAlertSent": "NG Alert đã gửi: {{serial}}",
      "errorMsg": "Lỗi: {{message}}",
      "delivered": "Đã gửi",
      "failed": "Thất bại",
      "pending": "Đang chờ",
      "enableAlertSound": "Bật âm thanh cảnh báo",
      "disableAlertSound": "Tắt âm thanh cảnh báo",
      "sending": "Đang gửi...",
      "totalClients": "tổng clients",
      "pendingApproval": "chờ phê duyệt",
      "messagesToday": "Tin nhắn hôm nay",
      "successRate": "Tỷ lệ gửi thành công",
      "rate": "Tỷ lệ",
      "throughput1min": "Throughput (1 phút)",
      "msgPerMin": "msg/phút",
      "throughput5min": "Throughput (5 phút)",
      "avgMsgPerMin": "avg msg/phút",
      "throughputRealtime": "Throughput Realtime",
      "messagesLastHour": "Số lượng message trong 1 giờ qua (theo phút)",
      "messageTrend": "Xu hướng tin nhắn",
      "messagesByDay": "Số lượng tin nhắn theo ngày",
      "7days": "7 ngày",
      "14days": "14 ngày",
      "30days": "30 ngày",
      "messageClassification": "Phân loại tin nhắn",
      "today": "Hôm nay",
      "noMessages": "Chưa có tin nhắn",
      "connectedClients": "Connected Clients",
      "recentMessages": "Recent Messages",
      "clientList": "Danh sách Clients",
      "clientListDesc": "Các thiết bị đã kết nối qua MQTT",
      "device": "Thiết bị",
      "approval": "Phê duyệt",
      "station": "Trạm",
      "lastConnection": "Kết nối lần cuối",
      "noClients": "Chưa có client nào kết nối",
      "recentMessagesTitle": "Tin nhắn gần đây",
      "recentMessagesDesc": "20 tin nhắn mới nhất",
      "type": "Loại",
      "time": "Thời gian"
    },
    "alertRulesPage": {
      "description": "Cấu hình cảnh báo cho MQTT broker và messages",
      "createRule": "Tạo Rule",
      "editRule": "Chỉnh sửa Alert Rule",
      "createNewRule": "Tạo Alert Rule mới",
      "dialogDescription": "Cấu hình điều kiện và thông báo khi có sự cố MQTT",
      "ruleName": "Tên Rule",
      "ruleType": "Loại Rule",
      "descriptionLabel": "Mô tả",
      "descriptionPlaceholder": "Mô tả chi tiết về rule này...",
      "operator": "Toán tử",
      "threshold": "Ngưỡng",
      "unit": "Đơn vị",
      "evaluationPeriod": "Khoảng thời gian đánh giá (phút)",
      "productCategory": "Category sản phẩm (áp dụng cho)",
      "allCategories": "Tất cả category",
      "notifyOwner": "Gửi notification cho Owner",
      "notifyEmail": "Gửi Email",
      "notifyMqtt": "Gửi qua MQTT",
      "update": "Cập nhật",
      "unprocessedAlerts": "Alert chưa được xử lý",
      "history": "Lịch sử",
      "ruleList": "Danh sách Alert Rules",
      "ruleListDesc": "Các rule đang được áp dụng",
      "name": "Tên",
      "typeHeader": "Loại",
      "condition": "Điều kiện",
      "notification": "Thông báo",
      "actionsHeader": "Thao tác",
      "timeHeader": "Thời gian",
      "noRules": "Chưa có alert rule nào",
      "alertHistory": "Lịch sử Alert",
      "alertHistoryDesc": "Các alert đã được trigger",
      "value": "Giá trị",
      "content": "Nội dung",
      "processed": "Đã xử lý",
      "unprocessed": "Chưa xử lý",
      "noAlerts": "Chưa có alert nào được trigger",
      "ruleCreated": "Đã tạo alert rule",
      "ruleUpdated": "Đã cập nhật alert rule",
      "ruleDeleted": "Đã xóa alert rule",
      "alertResolved": "Đã resolve alert",
      "types": {
        "latencyThreshold": "Latency vượt ngưỡng",
        "latencyThresholdDesc": "Cảnh báo khi độ trễ message vượt ngưỡng",
        "brokerDisconnect": "Broker Disconnect",
        "brokerDisconnectDesc": "Cảnh báo khi external broker bị ngắt kết nối",
        "failureRate": "Tỷ lệ thất bại",
        "failureRateDesc": "Cảnh báo khi tỷ lệ message thất bại vượt ngưỡng",
        "throughputLow": "Throughput thấp",
        "throughputLowDesc": "Cảnh báo khi throughput thấp hơn ngưỡng",
        "throughputHigh": "Throughput cao",
        "throughputHighDesc": "Cảnh báo khi throughput cao hơn ngưỡng (có thể là spam)",
        "clientOffline": "Client Offline",
        "clientOfflineDesc": "Cảnh báo khi client offline quá lâu"
      }
    },
    "topicsMessages": {
      "description": "Quản lý topics và xem lịch sử messages MQTT",
      "exportJson": "Xuất JSON",
      "totalTopics": "Tổng Topics",
      "totalMessages": "Tổng Messages",
      "topicStats": "Thống kê messages theo topic",
      "searchPlaceholder": "Tìm kiếm topic hoặc payload...",
      "allTypes": "Tất cả types",
      "allStatus": "Tất cả status",
      "noMessages": "Không có messages",
      "recentMessages": "50 messages gần nhất",
      "messageDetail": "Chi tiết message MQTT",
      "replayMessage": "Gửi lại message này",
      "resend": "Gửi lại",
      "payloadCopied": "Đã sao chép payload",
      "messagesExported": "Đã xuất messages",
      "replayInDev": "Tính năng replay đang được phát triển"
    },
    "replayPage": {
      "description": "Theo dõi và phát lại tin nhắn MQTT để debug",
      "lostConnection": "Mất kết nối",
      "waitingMessages": "Đang chờ tin nhắn MQTT...",
      "streamRunning": "Stream đang chạy",
      "streamPaused": "Stream đã tạm dừng",
      "messageDetail": "Chi tiết Message",
      "selectMessage": "Chọn một message để xem chi tiết",
      "messageHistory": "Lịch sử Message",
      "historyDescription": "Xem lại các tin nhắn MQTT đã được lưu trữ",
      "noHistory": "Không có lịch sử message",
      "autoDiscoveryDesc": "Các máy được tự động phát hiện từ MQTT topics",
      "firstDetected": "Phát hiện lần đầu",
      "lastSeen": "Lần cuối",
      "messageCountLabel": "Số message",
      "registered": "Đã đăng ký",
      "new": "Mới",
      "registerMachine": "Đăng ký máy",
      "noMachinesDetected": "Chưa phát hiện máy nào từ MQTT",
      "autoDetectInfo": "Hệ thống sẽ tự động phát hiện khi có message từ máy mới",
      "newMachineDetected": "Máy mới: {{code}} từ topic {{topic}}",
      "messagesExported": "Đã xuất {{count}} messages"
    },
    "bulletinPage": {
      "title": "Bản tin MQTT",
      "description": "Tổng hợp thông tin OK/NG/NTF theo chu kỳ cho từng station",
      "sendTestBulletin": "Gửi bản tin test",
      "running": "Đang chạy",
      "off": "Tắt",
      "bulletinCount7d": "Số bản tin (7 ngày)",
      "totalInspection": "Tổng kiểm tra",
      "totalNg": "Tổng NG",
      "stationStats": "Thống kê theo Station",
      "noData": "Chưa có dữ liệu bản tin",
      "settingsTitle": "Cấu hình bản tin theo Station",
      "addStations": "Thêm Station (nhiều)",
      "noSettings": "Chưa có cấu hình bản tin nào",
      "interval": "Chu kỳ",
      "activeHours": "Giờ hoạt động",
      "images": "Ảnh",
      "lastSent": "Gửi lần cuối",
      "actionsHeader": "Thao tác",
      "sendNow": "Gửi ngay",
      "historyTitle": "Lịch sử bản tin",
      "allStations": "Tất cả station",
      "noHistory": "Chưa có lịch sử bản tin nào",
      "showing": "Hiển thị {{from}} - {{to}} / {{total}} bản tin",
      "editSettings": "Chỉnh sửa cấu hình bản tin",
      "addSettingsMulti": "Thêm cấu hình bản tin cho nhiều Station",
      "intervalMinutes": "Chu kỳ gửi (phút)",
      "startHour": "Giờ bắt đầu",
      "endHour": "Giờ kết thúc",
      "maxFailPoints": "Số điểm Fail tối đa",
      "searchStation": "Tìm station theo tên hoặc ID...",
      "includeFailImages": "Bao gồm ảnh điểm Fail",
      "sendExternal": "Gửi qua External MQTT",
      "sendFcm": "Gửi FCM Push",
      "saving": "Đang lưu...",
      "saveSettings": "Lưu cấu hình",
      "applyToStations": "Áp dụng cho {{count}} station",
      "detailTitle": "Chi tiết bản tin",
      "period": "Chu kỳ",
      "failPointsList": "Danh sách điểm đo Fail",
      "pointCode": "Mã điểm",
      "pointName": "Tên",
      "ngCountHeader": "Số lần NG",
      "rateHeader": "Tỷ lệ",
      "testDescription": "Gửi một bản tin MQTT với dữ liệu ngẫu nhiên để kiểm tra kết nối với app",
      "selectTestStation": "Chọn Station để gửi test",
      "selectStation": "Chọn station",
      "sendExternalHiveMQ": "Gửi qua External MQTT (HiveMQ)",
      "sendingTest": "Đang gửi...",
      "jsonPayloadSent": "JSON Payload đã gửi",
      "viewFullJson": "Xem JSON đầy đủ",
      "testInfoLine1": "Bản tin test sẽ có dữ liệu ngẫu nhiên",
      "testInfoLine2": "và được publish lên MQTT topic tương ứng",
      "settingsSaved": "Cấu hình đã được lưu",
      "errorMsg": "Lỗi: {{message}}",
      "stationsConfigured": "Đã cấu hình {{total}} station ({{created}} mới, {{updated}} cập nhật)",
      "statusUpdated": "Đã cập nhật trạng thái",
      "settingsDeleted": "Đã xóa cấu hình",
      "bulletinSent": "Đã gửi bản tin",
      "testSendError": "Lỗi gửi test: {{message}}",
      "pleaseSelectStation": "Vui lòng chọn station",
      "stationNotFound": "Không xác định được station",
      "selectAtLeast1": "Vui lòng chọn ít nhất 1 station"
    },
    "clientMgmt": {
      "title": "Quản lý MQTT Clients",
      "pendingLabel": "chờ duyệt",
      "description": "Quản lý thiết bị MQTT và phê duyệt kết nối",
      "addManualConnection": "Thêm kết nối thủ công",
      "createClientDesc": "Tạo client thủ công để kết nối với hệ thống",
      "workstation": "Công trạm",
      "selectWorkstation": "Chọn công trạm",
      "noSelection": "Không chọn",
      "receiveNgAlerts": "Nhận NG Alerts",
      "receiveDailySummary": "Nhận Daily Summary",
      "receiveWeeklySummary": "Nhận Weekly Summary",
      "creating": "Đang tạo...",
      "createClient": "Tạo Client",
      "searchPlaceholder": "Tìm kiếm theo tên, Device ID, IP...",
      "allStatuses": "Tất cả trạng thái",
      "pendingFilter": "Chờ duyệt",
      "approvedFilter": "Đã duyệt",
      "rejectedFilter": "Từ chối",
      "manualConnections": "Kết nối thủ công",
      "health": "Sức khỏe",
      "historyTab": "Lịch sử",
      "clientList": "Danh sách MQTT Clients",
      "device": "Thiết bị",
      "connection": "Kết nối",
      "approvalHeader": "Phê duyệt",
      "workstationHeader": "Công trạm",
      "notifications": "Thông báo",
      "actionsHeader": "Thao tác",
      "timeHeader": "Thời gian",
      "typeHeader": "Loại",
      "approve": "Phê duyệt",
      "reject": "Từ chối",
      "disconnectReset": "Ngắt kết nối & Reset",
      "noClients": "Chưa có MQTT client nào",
      "noMatchingClients": "Không tìm thấy client phù hợp",
      "manualConnectionsDesc": "Kết nối trực tiếp tới máy qua MQTT",
      "machine": "Máy",
      "noManualConnections": "Chưa có kết nối thủ công nào",
      "noHealthData": "Chưa có dữ liệu sức khỏe clients",
      "selectClient": "Chọn Client",
      "connectionHistory": "Lịch sử kết nối",
      "noHistory": "Chưa có lịch sử",
      "selectClientForHistory": "Chọn client để xem lịch sử",
      "approveDevice": "Phê duyệt thiết bị",
      "approveDeviceDesc": "Xác nhận phê duyệt thiết bị này",
      "workstationOptional": "Công trạm (tùy chọn)",
      "mappingType": "Loại mapping",
      "manualMapping": "Thủ công - Giữ mapping khi reconnect",
      "autoMapping": "Tự động - Cho phép reset mapping",
      "updateSettingsFor": "Cập nhật cài đặt cho client",
      "saving": "Đang lưu...",
      "saveChanges": "Lưu thay đổi",
      "createManualDesc": "Tạo kết nối trực tiếp tới máy qua IP",
      "selectMachine": "Chọn máy",
      "createConnection": "Tạo kết nối",
      "clientCreated": "Đã tạo MQTT client",
      "clientUpdated": "Đã cập nhật client",
      "clientDeleted": "Đã xóa client",
      "deviceApproved": "Đã phê duyệt thiết bị",
      "deviceRejected": "Đã từ chối thiết bị",
      "mappingUpdated": "Đã cập nhật mapping",
      "disconnectResetDone": "Đã ngắt kết nối và reset mapping",
      "manualConnectionCreated": "Đã tạo kết nối thủ công",
      "connectionDeleted": "Đã xóa kết nối",
      "connectionSuccess": "Kết nối thành công ({{latency}}ms)",
      "connectionFailed": "Kết nối thất bại: {{message}}"
    },
    "profileMgmt": {
      "title": "Quản lý MQTT Profiles",
      "description": "Cấu hình tập trung các MQTT profiles và gán cho máy/station/factory",
      "createProfile": "Tạo Profile mới",
      "connectionDetail": "Chi tiết kết nối",
      "assignSingle": "Gán cho 1 target",
      "assignMultiple": "Gán cho nhiều targets",
      "noProfiles": "Chưa có profile nào",
      "noAssignments": "Chưa có assignment nào",
      "noLogs": "Chưa có log nào",
      "noTemplates": "Chưa có template nào",
      "noConnectionData": "Chưa có dữ liệu connection status",
      "noReconnectHistory": "Chưa có lịch sử reconnect",
      "dialogDescription": "Cấu hình thông số kết nối MQTT broker",
      "profileNameRequired": "Tên Profile *",
      "descriptionLabel": "Mô tả",
      "descriptionPlaceholder": "Mô tả profile...",
      "brokerUrlRequired": "Broker URL *",
      "backoffDesc": "Delay tăng theo hệ số này sau mỗi lần thử lại",
      "maxDelayDesc": "Delay tối đa giữa các lần reconnect",
      "subscribeTopics": "Subscribe Topics (mỗi dòng 1 topic)",
      "publishTopics": "Publish Topics (mỗi dòng 1 topic)",
      "update": "Cập nhật",
      "createProfileBtn": "Tạo Profile",
      "assignToTarget": "Gán Profile cho Target",
      "assignDescription": "Chọn loại target và target cụ thể để gán profile",
      "targetType": "Loại Target",
      "selectTarget": "Chọn target...",
      "assignProfile": "Gán Profile",
      "importDescription": "Chọn file JSON đã export để import",
      "overwriteExisting": "Ghi đè profiles trùng tên",
      "skipDuplicates": "Bỏ qua profiles trùng tên",
      "invalidJson": "File JSON không hợp lệ",
      "alertConfig": "Cấu hình Cảnh báo",
      "connectionLostMin": "Mất kết nối (phút)",
      "connectionLostDesc": "Cảnh báo khi mất kết nối quá thời gian này",
      "reconnectFailedCount": "Reconnect thất bại (lần)",
      "reconnectFailedDesc": "Cảnh báo khi reconnect thất bại liên tiếp",
      "highReconnectRate": "Tần suất reconnect cao (lần/giờ)",
      "highReconnectRateDesc": "Cảnh báo khi reconnect quá nhiều trong 1 giờ",
      "longDisconnection": "Ngắt kết nối lâu (phút)",
      "longDisconnectionDesc": "Cảnh báo khi ngắt kết nối quá lâu",
      "alertList": "Danh sách Cảnh báo",
      "noAlerts": "Không có cảnh báo nào",
      "reconnectHeatmap": "Reconnect Heatmap (7 ngày gần nhất)",
      "heatmapDesc": "Phân bố reconnect theo giờ và ngày trong tuần",
      "less": "Ít",
      "more": "Nhiều",
      "noHeatmapData": "Chưa có dữ liệu heatmap",
      "topReconnectProfiles": "Top Profiles có nhiều Reconnect nhất",
      "topReconnectDesc": "Profiles có tần suất reconnect cao trong 7 ngày",
      "noReconnectData": "Chưa có dữ liệu reconnect",
      "reconnectTrend": "Xu hướng Reconnect (30 ngày)",
      "noTrendData": "Chưa có dữ liệu trend",
      "bulkAssignTitle": "Gán Profile cho nhiều Targets",
      "bulkAssignDesc": "Chọn nhiều machines/stations/factories để gán profile",
      "replaceExisting": "Thay thế assignments hiện có",
      "deselect": "Bỏ chọn",
      "assigned": "Đã gán",
      "noTargetsAvailable": "Không có target nào khả dụng",
      "replaceWarning": "Các assignments hiện có sẽ bị thay thế",
      "assigning": "Đang gán...",
      "assignTargets": "Gán {{count}} targets",
      "profileCreated": "Đã tạo profile mới",
      "profileUpdated": "Đã cập nhật profile",
      "profileDeleted": "Đã xóa profile",
      "profileDuplicated": "Đã nhân bản profile",
      "profileAssigned": "Đã gán profile",
      "importComplete": "Import hoàn tất: {{imported}} imported, {{updated}} updated, {{skipped}} skipped",
      "assignmentRemoved": "Đã gỡ bỏ assignment",
      "alertConfigUpdated": "Đã cập nhật cấu hình cảnh báo",
      "alertAcknowledged": "Đã xác nhận cảnh báo",
      "alertResolved": "Đã giải quyết cảnh báo"
    }
  };

  const newEnMqttKeys = {
    "dashboard": {
      "description": "Monitor MQTT connections and messages in realtime",
      "alertSoundOff": "Alert sound disabled",
      "alertSoundOn": "Alert sound enabled",
      "ngAlertSent": "NG Alert sent: {{serial}}",
      "errorMsg": "Error: {{message}}",
      "delivered": "Delivered",
      "failed": "Failed",
      "pending": "Pending",
      "enableAlertSound": "Enable alert sound",
      "disableAlertSound": "Disable alert sound",
      "sending": "Sending...",
      "totalClients": "total clients",
      "pendingApproval": "pending approval",
      "messagesToday": "Messages Today",
      "successRate": "Delivery Rate",
      "rate": "Rate",
      "throughput1min": "Throughput (1 min)",
      "msgPerMin": "msg/min",
      "throughput5min": "Throughput (5 min)",
      "avgMsgPerMin": "avg msg/min",
      "throughputRealtime": "Throughput Realtime",
      "messagesLastHour": "Messages in the last hour (per minute)",
      "messageTrend": "Message Trend",
      "messagesByDay": "Messages per day",
      "7days": "7 days",
      "14days": "14 days",
      "30days": "30 days",
      "messageClassification": "Message Classification",
      "today": "Today",
      "noMessages": "No messages yet",
      "connectedClients": "Connected Clients",
      "recentMessages": "Recent Messages",
      "clientList": "Client List",
      "clientListDesc": "Devices connected via MQTT",
      "device": "Device",
      "approval": "Approval",
      "station": "Station",
      "lastConnection": "Last Connection",
      "noClients": "No clients connected yet",
      "recentMessagesTitle": "Recent Messages",
      "recentMessagesDesc": "Latest 20 messages",
      "type": "Type",
      "time": "Time"
    },
    "alertRulesPage": {
      "description": "Configure alerts for MQTT broker and messages",
      "createRule": "Create Rule",
      "editRule": "Edit Alert Rule",
      "createNewRule": "Create New Alert Rule",
      "dialogDescription": "Configure conditions and notifications for MQTT issues",
      "ruleName": "Rule Name",
      "ruleType": "Rule Type",
      "descriptionLabel": "Description",
      "descriptionPlaceholder": "Detailed description of this rule...",
      "operator": "Operator",
      "threshold": "Threshold",
      "unit": "Unit",
      "evaluationPeriod": "Evaluation Period (minutes)",
      "productCategory": "Product Category (applies to)",
      "allCategories": "All categories",
      "notifyOwner": "Notify Owner",
      "notifyEmail": "Send Email",
      "notifyMqtt": "Send via MQTT",
      "update": "Update",
      "unprocessedAlerts": "Unprocessed alerts",
      "history": "History",
      "ruleList": "Alert Rules List",
      "ruleListDesc": "Currently active rules",
      "name": "Name",
      "typeHeader": "Type",
      "condition": "Condition",
      "notification": "Notification",
      "actionsHeader": "Actions",
      "timeHeader": "Time",
      "noRules": "No alert rules yet",
      "alertHistory": "Alert History",
      "alertHistoryDesc": "Triggered alerts",
      "value": "Value",
      "content": "Content",
      "processed": "Processed",
      "unprocessed": "Unprocessed",
      "noAlerts": "No alerts triggered yet",
      "ruleCreated": "Alert rule created",
      "ruleUpdated": "Alert rule updated",
      "ruleDeleted": "Alert rule deleted",
      "alertResolved": "Alert resolved",
      "types": {
        "latencyThreshold": "Latency Threshold",
        "latencyThresholdDesc": "Alert when message latency exceeds threshold",
        "brokerDisconnect": "Broker Disconnect",
        "brokerDisconnectDesc": "Alert when external broker disconnects",
        "failureRate": "Failure Rate",
        "failureRateDesc": "Alert when message failure rate exceeds threshold",
        "throughputLow": "Low Throughput",
        "throughputLowDesc": "Alert when throughput drops below threshold",
        "throughputHigh": "High Throughput",
        "throughputHighDesc": "Alert when throughput exceeds threshold (possible spam)",
        "clientOffline": "Client Offline",
        "clientOfflineDesc": "Alert when client is offline too long"
      }
    },
    "topicsMessages": {
      "description": "Manage topics and view MQTT message history",
      "exportJson": "Export JSON",
      "totalTopics": "Total Topics",
      "totalMessages": "Total Messages",
      "topicStats": "Messages by topic",
      "searchPlaceholder": "Search topic or payload...",
      "allTypes": "All types",
      "allStatus": "All status",
      "noMessages": "No messages",
      "recentMessages": "Latest 50 messages",
      "messageDetail": "MQTT Message Detail",
      "replayMessage": "Replay this message",
      "resend": "Resend",
      "payloadCopied": "Payload copied",
      "messagesExported": "Messages exported",
      "replayInDev": "Replay feature is under development"
    },
    "replayPage": {
      "description": "Monitor and replay MQTT messages for debugging",
      "lostConnection": "Connection lost",
      "waitingMessages": "Waiting for MQTT messages...",
      "streamRunning": "Stream running",
      "streamPaused": "Stream paused",
      "messageDetail": "Message Detail",
      "selectMessage": "Select a message to view details",
      "messageHistory": "Message History",
      "historyDescription": "Review stored MQTT messages",
      "noHistory": "No message history",
      "autoDiscoveryDesc": "Machines auto-discovered from MQTT topics",
      "firstDetected": "First detected",
      "lastSeen": "Last seen",
      "messageCountLabel": "Messages",
      "registered": "Registered",
      "new": "New",
      "registerMachine": "Register Machine",
      "noMachinesDetected": "No machines detected from MQTT",
      "autoDetectInfo": "System will auto-detect when messages from new machines arrive",
      "newMachineDetected": "New machine: {{code}} from topic {{topic}}",
      "messagesExported": "Exported {{count}} messages"
    },
    "bulletinPage": {
      "title": "MQTT Bulletin",
      "description": "Aggregate OK/NG/NTF information per cycle for each station",
      "sendTestBulletin": "Send Test Bulletin",
      "running": "Running",
      "off": "Off",
      "bulletinCount7d": "Bulletins (7 days)",
      "totalInspection": "Total Inspections",
      "totalNg": "Total NG",
      "stationStats": "Statistics by Station",
      "noData": "No bulletin data",
      "settingsTitle": "Bulletin Settings by Station",
      "addStations": "Add Stations (multiple)",
      "noSettings": "No bulletin settings configured",
      "interval": "Interval",
      "activeHours": "Active Hours",
      "images": "Images",
      "lastSent": "Last Sent",
      "actionsHeader": "Actions",
      "sendNow": "Send Now",
      "historyTitle": "Bulletin History",
      "allStations": "All stations",
      "noHistory": "No bulletin history",
      "showing": "Showing {{from}} - {{to}} / {{total}} bulletins",
      "editSettings": "Edit Bulletin Settings",
      "addSettingsMulti": "Add Bulletin Settings for Multiple Stations",
      "intervalMinutes": "Send Interval (minutes)",
      "startHour": "Start Hour",
      "endHour": "End Hour",
      "maxFailPoints": "Maximum Fail Points",
      "searchStation": "Search station by name or ID...",
      "includeFailImages": "Include Fail Point Images",
      "sendExternal": "Send via External MQTT",
      "sendFcm": "Send FCM Push",
      "saving": "Saving...",
      "saveSettings": "Save Settings",
      "applyToStations": "Apply to {{count}} stations",
      "detailTitle": "Bulletin Detail",
      "period": "Period",
      "failPointsList": "Fail Point List",
      "pointCode": "Point Code",
      "pointName": "Name",
      "ngCountHeader": "NG Count",
      "rateHeader": "Rate",
      "testDescription": "Send an MQTT bulletin with random data to test app connectivity",
      "selectTestStation": "Select Station for test",
      "selectStation": "Select station",
      "sendExternalHiveMQ": "Send via External MQTT (HiveMQ)",
      "sendingTest": "Sending...",
      "jsonPayloadSent": "JSON Payload sent",
      "viewFullJson": "View full JSON",
      "testInfoLine1": "Test bulletin will contain random data",
      "testInfoLine2": "and will be published to the corresponding MQTT topic",
      "settingsSaved": "Settings saved",
      "errorMsg": "Error: {{message}}",
      "stationsConfigured": "Configured {{total}} stations ({{created}} new, {{updated}} updated)",
      "statusUpdated": "Status updated",
      "settingsDeleted": "Settings deleted",
      "bulletinSent": "Bulletin sent",
      "testSendError": "Test send error: {{message}}",
      "pleaseSelectStation": "Please select a station",
      "stationNotFound": "Station not found",
      "selectAtLeast1": "Please select at least 1 station"
    },
    "clientMgmt": {
      "title": "MQTT Client Management",
      "pendingLabel": "pending",
      "description": "Manage MQTT devices and approve connections",
      "addManualConnection": "Add Manual Connection",
      "createClientDesc": "Create a manual client to connect to the system",
      "workstation": "Workstation",
      "selectWorkstation": "Select workstation",
      "noSelection": "None",
      "receiveNgAlerts": "Receive NG Alerts",
      "receiveDailySummary": "Receive Daily Summary",
      "receiveWeeklySummary": "Receive Weekly Summary",
      "creating": "Creating...",
      "createClient": "Create Client",
      "searchPlaceholder": "Search by name, Device ID, IP...",
      "allStatuses": "All statuses",
      "pendingFilter": "Pending",
      "approvedFilter": "Approved",
      "rejectedFilter": "Rejected",
      "manualConnections": "Manual Connections",
      "health": "Health",
      "historyTab": "History",
      "clientList": "MQTT Client List",
      "device": "Device",
      "connection": "Connection",
      "approvalHeader": "Approval",
      "workstationHeader": "Workstation",
      "notifications": "Notifications",
      "actionsHeader": "Actions",
      "timeHeader": "Time",
      "typeHeader": "Type",
      "approve": "Approve",
      "reject": "Reject",
      "disconnectReset": "Disconnect & Reset",
      "noClients": "No MQTT clients yet",
      "noMatchingClients": "No matching clients found",
      "manualConnectionsDesc": "Direct connections to machines via MQTT",
      "machine": "Machine",
      "noManualConnections": "No manual connections yet",
      "noHealthData": "No client health data available",
      "selectClient": "Select Client",
      "connectionHistory": "Connection History",
      "noHistory": "No history",
      "selectClientForHistory": "Select a client to view history",
      "approveDevice": "Approve Device",
      "approveDeviceDesc": "Confirm device approval",
      "workstationOptional": "Workstation (optional)",
      "mappingType": "Mapping Type",
      "manualMapping": "Manual - Keep mapping on reconnect",
      "autoMapping": "Automatic - Allow mapping reset",
      "updateSettingsFor": "Update settings for client",
      "saving": "Saving...",
      "saveChanges": "Save Changes",
      "createManualDesc": "Create direct connection to machine via IP",
      "selectMachine": "Select machine",
      "createConnection": "Create Connection",
      "clientCreated": "MQTT client created",
      "clientUpdated": "Client updated",
      "clientDeleted": "Client deleted",
      "deviceApproved": "Device approved",
      "deviceRejected": "Device rejected",
      "mappingUpdated": "Mapping updated",
      "disconnectResetDone": "Disconnected and mapping reset",
      "manualConnectionCreated": "Manual connection created",
      "connectionDeleted": "Connection deleted",
      "connectionSuccess": "Connection successful ({{latency}}ms)",
      "connectionFailed": "Connection failed: {{message}}"
    },
    "profileMgmt": {
      "title": "MQTT Profile Management",
      "description": "Centralized MQTT profile configuration for machines/stations/factories",
      "createProfile": "Create New Profile",
      "connectionDetail": "Connection Detail",
      "assignSingle": "Assign to 1 target",
      "assignMultiple": "Assign to multiple targets",
      "noProfiles": "No profiles yet",
      "noAssignments": "No assignments yet",
      "noLogs": "No logs yet",
      "noTemplates": "No templates yet",
      "noConnectionData": "No connection status data",
      "noReconnectHistory": "No reconnect history",
      "dialogDescription": "Configure MQTT broker connection parameters",
      "profileNameRequired": "Profile Name *",
      "descriptionLabel": "Description",
      "descriptionPlaceholder": "Profile description...",
      "brokerUrlRequired": "Broker URL *",
      "backoffDesc": "Delay increases by this factor after each retry",
      "maxDelayDesc": "Maximum delay between reconnect attempts",
      "subscribeTopics": "Subscribe Topics (one per line)",
      "publishTopics": "Publish Topics (one per line)",
      "update": "Update",
      "createProfileBtn": "Create Profile",
      "assignToTarget": "Assign Profile to Target",
      "assignDescription": "Select target type and specific target for profile assignment",
      "targetType": "Target Type",
      "selectTarget": "Select target...",
      "assignProfile": "Assign Profile",
      "importDescription": "Select exported JSON file to import",
      "overwriteExisting": "Overwrite existing profiles",
      "skipDuplicates": "Skip duplicate profiles",
      "invalidJson": "Invalid JSON file",
      "alertConfig": "Alert Configuration",
      "connectionLostMin": "Connection Lost (minutes)",
      "connectionLostDesc": "Alert when connection is lost for longer than this duration",
      "reconnectFailedCount": "Reconnect Failed (count)",
      "reconnectFailedDesc": "Alert when reconnect fails consecutively",
      "highReconnectRate": "High Reconnect Rate (per hour)",
      "highReconnectRateDesc": "Alert when too many reconnects in 1 hour",
      "longDisconnection": "Long Disconnection (minutes)",
      "longDisconnectionDesc": "Alert when disconnected for too long",
      "alertList": "Alert List",
      "noAlerts": "No alerts",
      "reconnectHeatmap": "Reconnect Heatmap (last 7 days)",
      "heatmapDesc": "Reconnect distribution by hour and day of week",
      "less": "Less",
      "more": "More",
      "noHeatmapData": "No heatmap data",
      "topReconnectProfiles": "Top Reconnect Profiles",
      "topReconnectDesc": "Profiles with high reconnect frequency in 7 days",
      "noReconnectData": "No reconnect data",
      "reconnectTrend": "Reconnect Trend (30 days)",
      "noTrendData": "No trend data",
      "bulkAssignTitle": "Assign Profile to Multiple Targets",
      "bulkAssignDesc": "Select multiple machines/stations/factories for profile assignment",
      "replaceExisting": "Replace existing assignments",
      "deselect": "Deselect",
      "assigned": "Assigned",
      "noTargetsAvailable": "No targets available",
      "replaceWarning": "Existing assignments will be replaced",
      "assigning": "Assigning...",
      "assignTargets": "Assign {{count}} targets",
      "profileCreated": "Profile created",
      "profileUpdated": "Profile updated",
      "profileDeleted": "Profile deleted",
      "profileDuplicated": "Profile duplicated",
      "profileAssigned": "Profile assigned",
      "importComplete": "Import complete: {{imported}} imported, {{updated}} updated, {{skipped}} skipped",
      "assignmentRemoved": "Assignment removed",
      "alertConfigUpdated": "Alert configuration updated",
      "alertAcknowledged": "Alert acknowledged",
      "alertResolved": "Alert resolved"
    }
  };

  // Update vi.json
  const viPath = 'client/src/i18n/locales/vi.json';
  const viContent = JSON.parse(fs.readFileSync(viPath, 'utf-8'));
  if (!viContent.mqtt) viContent.mqtt = {};
  Object.assign(viContent.mqtt, newMqttKeys);
  fs.writeFileSync(viPath, JSON.stringify(viContent, null, 2) + '\n', 'utf-8');
  console.log('✓ Updated vi.json with new mqtt keys');

  // Update en.json
  const enPath = 'client/src/i18n/locales/en.json';
  const enContent = JSON.parse(fs.readFileSync(enPath, 'utf-8'));
  if (!enContent.mqtt) enContent.mqtt = {};
  Object.assign(enContent.mqtt, newEnMqttKeys);
  fs.writeFileSync(enPath, JSON.stringify(enContent, null, 2) + '\n', 'utf-8');
  console.log('✓ Updated en.json with new mqtt keys');
}

// ==================== Main ====================
function main() {
  console.log('Starting MQTT i18n migration...\n');

  const migrations = {
    'MqttDashboard.tsx': migrateMqttDashboard,
    'MqttAlertRules.tsx': migrateMqttAlertRules,
    'MqttTopicsMessages.tsx': migrateMqttTopicsMessages,
    'MQTTReplay.tsx': migrateMQTTReplay,
    'MqttBulletin.tsx': migrateMqttBulletin,
    'MqttClientManagement.tsx': migrateMqttClientManagement,
    'MqttProfileManagement.tsx': migrateMqttProfileManagement,
  };

  for (const filePath of FILES) {
    const fileName = filePath.split('/').pop();
    const migrateFn = migrations[fileName];
    if (!migrateFn) { console.log(`⚠ No migration for ${fileName}`); continue; }

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const hasCRLF = raw.includes('\r\n');
      const original = hasCRLF ? raw.replace(/\r\n/g, '\n') : raw;
      let modified = migrateFn(original);
      if (hasCRLF) modified = modified.replace(/\n/g, '\r\n');
      const changeCount = countReplacements(raw, modified);
      fs.writeFileSync(filePath, modified, 'utf-8');
      stats[fileName] = changeCount;
      console.log(`✓ ${fileName}: ${changeCount} lines changed`);
    } catch (err) {
      console.error(`✗ ${fileName}: ${err.message}`);
      stats[fileName] = 'ERROR: ' + err.message;
    }
  }

  // Update locale files
  try {
    updateLocaleFiles();
  } catch (err) {
    console.error(`✗ Locale files: ${err.message}`);
  }

  console.log('\n--- Summary ---');
  for (const [f, cnt] of Object.entries(stats)) {
    console.log(`  ${f}: ${cnt} lines changed`);
  }
  console.log('\nDone! Run a Vietnamese character search to verify remaining strings.');
}

main();
