import fs from 'fs';

const FILES = [
  'client/src/pages/MqttAlertRules.tsx',
  'client/src/pages/MqttTopicsMessages.tsx',
  'client/src/pages/MQTTReplay.tsx',
  'client/src/pages/MqttBulletin.tsx',
  'client/src/pages/MqttClientManagement.tsx',
  'client/src/pages/MqttProfileManagement.tsx',
];

const stats = {};

function countReplacements(orig, mod) {
  const a = orig.split('\n'), b = mod.split('\n');
  let diff = 0;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) diff++;
  }
  return diff;
}

// ==================== MqttAlertRules.tsx ====================
function fixMqttAlertRules(c) {
  // Line 304
  c = c.replace('<Label>Cooldown (phút)</Label>', "<Label>{t('mqtt.alertRulesPage.cooldownLabel')}</Label>");
  // Line 333
  c = c.replace('Chọn category để chỉ áp dụng cảnh báo cho sản phẩm thuộc category đó',
    "{t('mqtt.alertRulesPage.categoryHint')}");
  // Line 336
  c = c.replace('<Label className="text-base font-semibold">Thông báo</Label>',
    '<Label className="text-base font-semibold">{t(\'mqtt.alertRulesPage.notifications\')}</Label>');
  // Line 340
  c = c.replace('Gửi thông báo qua Manus', "{t('mqtt.alertRulesPage.sendViaManus')}");
  // Line 350
  c = c.replace('Gửi email cảnh báo', "{t('mqtt.alertRulesPage.sendEmailAlert')}");
  // Line 370 - Hủy button in alert rules dialog
  c = c.replace(
    `<Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>Hủy</Button>`,
    `<Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>{t('common.cancel')}</Button>`);
  // Line 372
  c = c.replace("{editingRule ? 'Cập nhật' : 'Tạo Rule'}",
    "{editingRule ? t('common.update') : t('mqtt.alertRulesPage.createRule')}");
  // Line 421
  c = c.replace(/(\s+)Lịch sử\n(\s+)<\/TabsTrigger>/,
    "$1{t('mqtt.alertRulesPage.history')}\n$2</TabsTrigger>");
  // Line 441 & 528 - Thao tác
  c = c.replaceAll('<TableHead className="text-right">Thao tác</TableHead>',
    '<TableHead className="text-right">{t(\'common.actions\')}</TableHead>');
  // Line 467
  c = c.replace('<span className="text-muted-foreground text-xs">Tất cả</span>',
    '<span className="text-muted-foreground text-xs">{t(\'common.all\')}</span>');
  // Line 503
  c = c.replace('{t(\'mqtt.alertRulesPage.noRules\')}. Nhấn "Tạo Rule" để bắt đầu.',
    "{t('mqtt.alertRulesPage.noRulesHint')}");
  // Line 542
  c = c.replace('{alert.triggeredValue} (ngưỡng: {alert.thresholdValue})',
    "{alert.triggeredValue} ({t('mqtt.alertRulesPage.threshold')}: {alert.thresholdValue})");
  // Line 550
  c = c.replace(/(\s+)Đã xử lý\n(\s+)<\/Badge>/,
    "$1{t('mqtt.alertRulesPage.resolved')}\n$2</Badge>");
  // Line 555
  c = c.replace(/(\s+)Chưa xử lý\n(\s+)<\/Badge>/,
    "$1{t('mqtt.alertRulesPage.unresolved')}\n$2</Badge>");
  return c;
}

// ==================== MqttTopicsMessages.tsx ====================
function fixMqttTopicsMessages(c) {
  // Line 172
  c = c.replace('Quản lý topics và xem lịch sử messages MQTT',
    "{t('mqtt.topicsMessages.pageDesc')}");
  // Line 192
  c = c.replace(/(\s+)Tổng Topics\n/, "$1{t('mqtt.topicsMessages.totalTopics')}\n");
  // Line 202
  c = c.replace(/(\s+)Tổng Messages\n/, "$1{t('mqtt.topicsMessages.totalMessages')}\n");
  // Line 372 & 446 - Đang tải...
  c = c.replaceAll(/(\s+)Đang tải\.\.\.\n/g, "$1{t('common.loading')}\n");
  // Line 378
  c = c.replace(/(\s+)Không có messages\n/, "$1{t('mqtt.topicsMessages.noMessages')}\n");
  // Line 491
  c = c.replace('Chi tiết message MQTT', "{t('mqtt.topicsMessages.messageDetail')}");
  // Line 563
  c = c.replace('Gửi lại message này', "{t('mqtt.topicsMessages.replayMessage')}");
  return c;
}

// ==================== MQTTReplay.tsx ====================
function fixMQTTReplay(c) {
  // Line 157
  c = c.replace('Theo dõi và phát lại tin nhắn MQTT để debug',
    "{t('mqtt.replayPage.pageDesc')}");
  // Line 163
  c = c.replace('{connected ? "Đã kết nối" : "Mất kết nối"}',
    "{connected ? t('mqtt.replayPage.connected') : t('mqtt.replayPage.disconnected')}");
  // Bug fix line 285: t() calls inside string literals
  c = c.replace(
    `{isPlaying ? "{t('mqtt.replayPage.streamRunning')}" : "{t('mqtt.replayPage.streamPaused')}"}`,
    `{isPlaying ? t('mqtt.replayPage.streamRunning') : t('mqtt.replayPage.streamPaused')}`);
  // Line 297
  c = c.replace('<CardTitle className="text-lg">Chi tiết Message</CardTitle>',
    "<CardTitle className=\"text-lg\">{t('mqtt.replayPage.messageDetail')}</CardTitle>");
  // Line 340
  c = c.replace('<CardTitle className="text-lg">Lịch sử Message</CardTitle>',
    "<CardTitle className=\"text-lg\">{t('mqtt.replayPage.messageHistory')}</CardTitle>");
  // Line 342
  c = c.replace('Xem lại các tin nhắn MQTT đã được lưu trữ',
    "{t('mqtt.replayPage.messageHistoryDesc')}");
  // Line 414
  c = c.replace('Các máy được tự động phát hiện từ MQTT topics',
    "{t('mqtt.replayPage.autoDiscoveryDesc')}");
  // Line 421
  c = c.replace(/(\s+)Làm mới\n(\s+)<\/Button>/, "$1{t('common.refresh')}\n$2</Button>");
  // Line 461
  c = c.replace(/(\s+)Đăng ký máy\n/, "$1{t('mqtt.replayPage.registerMachine')}\n");
  return c;
}

// ==================== MqttBulletin.tsx ====================
function fixMqttBulletin(c) {
  // Line 316
  c = c.replace('>Bản tin MQTT</h1>', ">{t('mqtt.bulletinPage.title')}</h1>");
  // Line 338
  c = c.replace('{schedulerStatus?.isRunning ? "Đang chạy" : "Tắt"}',
    "{schedulerStatus?.isRunning ? t('mqtt.bulletinPage.running') : t('mqtt.bulletinPage.off')}");
  // Line 341
  c = c.replace('{schedulerStatus?.activeIntervals ?? 0} station đang gửi',
    "{schedulerStatus?.activeIntervals ?? 0} {t('mqtt.bulletinPage.stationSending')}");
  // Line 351
  c = c.replace(/(\s+)Tổng quan\n(\s+)<\/TabsTrigger>/, "$1{t('mqtt.bulletinPage.overview')}\n$2</TabsTrigger>");
  // Line 355
  c = c.replace(/(\s+)Cấu hình\n(\s+)<\/TabsTrigger>/, "$1{t('mqtt.bulletinPage.configuration')}\n$2</TabsTrigger>");
  // Line 359
  c = c.replace(/(\s+)Lịch sử\n(\s+)<\/TabsTrigger>/, "$1{t('mqtt.bulletinPage.historyTab')}\n$2</TabsTrigger>");
  // Line 369
  c = c.replace('>Số bản tin (7 ngày)</CardDescription>', ">{t('mqtt.bulletinPage.bulletinCount7d')}</CardDescription>");
  // Line 375
  c = c.replace('{dashboardStats?.summary.deliveredCount ?? 0} thành công',
    "{dashboardStats?.summary.deliveredCount ?? 0} {t('mqtt.bulletinPage.successful')}");
  // Line 381
  c = c.replace('>Tổng kiểm tra</CardDescription>', ">{t('mqtt.bulletinPage.totalInspections')}</CardDescription>");
  // Line 395
  c = c.replace('>Tổng NG</CardDescription>', ">{t('mqtt.bulletinPage.totalNG')}</CardDescription>");
  // Line 427
  c = c.replace('>Tổng hợp bản tin 7 ngày gần nhất</CardDescription>',
    ">{t('mqtt.bulletinPage.summary7d')}</CardDescription>");
  // Line 432
  c = c.replace("{t('mqtt.bulletinPage.noData')}. Hãy cấu hình và bật bản tin cho các station.",
    "{t('mqtt.bulletinPage.noDataHint')}");
  // Line 439
  c = c.replace('<TableHead className="text-center">Số bản tin</TableHead>',
    '<TableHead className="text-center">{t(\'mqtt.bulletinPage.bulletinCount\')}</TableHead>');
  // Line 440
  c = c.replace('<TableHead className="text-center">TB NG/bản tin</TableHead>',
    '<TableHead className="text-center">{t(\'mqtt.bulletinPage.avgNGPerBulletin\')}</TableHead>');
  // Line 441 - Gửi lần cuối (used multiple times)
  c = c.replaceAll('<TableHead className="text-center">Gửi lần cuối</TableHead>',
    '<TableHead className="text-center">{t(\'mqtt.bulletinPage.lastSent\')}</TableHead>');
  // Line 492 & 619 - Đang tải...
  c = c.replaceAll('>Đang tải...</p>', ">{t('common.loading')}</p>");
  // Line 499
  c = c.replace(/(\s+)Thêm cấu hình đầu tiên\n/, "$1{t('mqtt.bulletinPage.addFirstConfig')}\n");
  // Line 507
  c = c.replace('<TableHead className="text-center">Trạng thái</TableHead>',
    '<TableHead className="text-center">{t(\'common.status\')}</TableHead>');
  // Handle second Trạng thái (line 637)
  c = c.replace('<TableHead className="text-center">Trạng thái</TableHead>',
    '<TableHead className="text-center">{t(\'common.status\')}</TableHead>');
  // Line 508
  c = c.replace('<TableHead className="text-center">Chu kỳ</TableHead>',
    '<TableHead className="text-center">{t(\'mqtt.bulletinPage.cycle\')}</TableHead>');
  // Line 509
  c = c.replace('<TableHead className="text-center">Giờ hoạt động</TableHead>',
    '<TableHead className="text-center">{t(\'mqtt.bulletinPage.activeHours\')}</TableHead>');
  // Line 510
  c = c.replace('<TableHead className="text-center">Ảnh</TableHead>',
    '<TableHead className="text-center">{t(\'mqtt.bulletinPage.image\')}</TableHead>');
  // Handle second Ảnh (line 994)
  c = c.replace('<TableHead className="text-center">Ảnh</TableHead>',
    '<TableHead className="text-center">{t(\'mqtt.bulletinPage.image\')}</TableHead>');
  // Line 512
  c = c.replace('<TableHead className="text-center">Thao tác</TableHead>',
    '<TableHead className="text-center">{t(\'common.actions\')}</TableHead>');
  // Line 528
  c = c.replace('{s.intervalMinutes} phút', "{s.intervalMinutes} {t('mqtt.bulletinPage.minutes')}");
  // Line 537
  c = c.replace('<span className="text-muted-foreground text-xs">Tắt</span>',
    '<span className="text-muted-foreground text-xs">{t(\'mqtt.bulletinPage.off\')}</span>');
  // Line 568
  c = c.replace('"Xác nhận xóa cấu hình bản tin này?"',
    "t('mqtt.bulletinPage.confirmDeleteConfig')");
  // Line 589
  c = c.replace('>Lịch sử bản tin</h3>', ">{t('mqtt.bulletinPage.bulletinHistory')}</h3>");
  // Line 630
  c = c.replace('<TableHead className="text-center">Thời điểm</TableHead>',
    '<TableHead className="text-center">{t(\'mqtt.bulletinPage.timestamp\')}</TableHead>');
  // Line 667
  c = c.replace("{(b.failPoints as any[])?.length ?? 0} điểm",
    "{(b.failPoints as any[])?.length ?? 0} {t('mqtt.bulletinPage.points')}");
  // Line 699
  c = c.replace('Hiển thị {historyData.items.length} / {historyData.total} bản tin',
    "{t('mqtt.bulletinPage.showing')} {historyData.items.length} / {historyData.total} {t('mqtt.bulletinPage.bulletins')}");
  // Line 733-734
  c = c.replace('? "Chỉnh sửa cấu hình bản tin"', "? t('mqtt.bulletinPage.editConfig')");
  c = c.replace(': "Thêm cấu hình bản tin cho nhiều Station"', ": t('mqtt.bulletinPage.addConfigMultiStation')");
  // Line 738-739
  c = c.replace('? "Cập nhật thông số gửi bản tin cho station đã chọn"',
    "? t('mqtt.bulletinPage.updateConfigDesc')");
  c = c.replace(': "Chọn nhiều station cùng lúc và áp dụng cùng một cấu hình để tiết kiệm thời gian"',
    ": t('mqtt.bulletinPage.multiStationConfigDesc')");
  // Line 758
  c = c.replace('Chọn Station ({selectedStationIds.length} đã chọn)',
    "{t('mqtt.bulletinPage.selectStation')} ({selectedStationIds.length} {t('mqtt.bulletinPage.selected')})");
  // Line 768-769
  c = c.replace('? "Bỏ chọn tất cả"', "? t('common.deselectAll')");
  c = c.replace(': "Chọn tất cả"', ": t('common.selectAll')");
  // Line 789-790
  c = c.replace('? "Không tìm thấy station phù hợp"', "? t('mqtt.bulletinPage.noMatchingStations')");
  c = c.replace(': "Tất cả station đã được cấu hình"', ": t('mqtt.bulletinPage.allStationsConfigured')");
  // Line 834
  c = c.replace('+{selectedStationIds.length - 10} station khác',
    "+{selectedStationIds.length - 10} {t('mqtt.bulletinPage.moreStations')}");
  // Line 853-858 - interval options
  c = c.replace('>15 phút</SelectItem>', ">{t('mqtt.bulletinPage.15min')}</SelectItem>");
  c = c.replace('>30 phút</SelectItem>', ">{t('mqtt.bulletinPage.30min')}</SelectItem>");
  c = c.replace('>1 giờ</SelectItem>', ">{t('mqtt.bulletinPage.1hour')}</SelectItem>");
  c = c.replace('>2 giờ</SelectItem>', ">{t('mqtt.bulletinPage.2hours')}</SelectItem>");
  c = c.replace('>4 giờ</SelectItem>', ">{t('mqtt.bulletinPage.4hours')}</SelectItem>");
  c = c.replace('>8 giờ (mỗi ca)</SelectItem>', ">{t('mqtt.bulletinPage.8hours')}</SelectItem>");
  // Line 977
  c = c.replace('Chu kỳ: {formatDate(selectedBulletin.periodStart)} → {formatDate(selectedBulletin.periodEnd)}',
    "{t('mqtt.bulletinPage.cycle')}: {formatDate(selectedBulletin.periodStart)} → {formatDate(selectedBulletin.periodEnd)}");
  // Line 985
  c = c.replace('Danh sách điểm đo Fail ({(selectedBulletin.failPoints as any[]).length})',
    "{t('mqtt.bulletinPage.failPointList')} ({(selectedBulletin.failPoints as any[]).length})");
  // Line 1055
  c = c.replace('>Gửi bản tin test</DialogTitle>', ">{t('mqtt.bulletinPage.sendTestBulletin')}</DialogTitle>");
  // Line 1058
  c = c.replace('Gửi một bản tin MQTT với dữ liệu ngẫu nhiên để kiểm tra kết nối với app',
    "{t('mqtt.bulletinPage.testBulletinDesc')}");
  // Line 1099
  c = c.replace("{t('mqtt.bulletinPage.testInfoLine1')}<strong>ngẫu nhiên</strong>",
    "{t('mqtt.bulletinPage.testInfoLine1')}<strong>{t('mqtt.bulletinPage.random')}</strong>");
  // Line 1112
  c = c.replace(/(\s+)Đang gửi\.\.\.\n/, "$1{t('mqtt.bulletinPage.sending')}\n");
  // Line 1117
  c = c.replace(/(\s+)Gửi bản tin test\n/, "$1{t('mqtt.bulletinPage.sendTestBulletin')}\n");
  return c;
}

// ==================== MqttClientManagement.tsx ====================
function fixMqttClientManagement(c) {
  // Line 187
  c = c.replace("toast.error('Vui lòng nhập Device ID và Device Name')",
    "toast.error(t('mqtt.clientMgmt.enterDeviceIdAndName'))");
  // Line 292
  c = c.replace('>Quản lý MQTT Clients</h1>', ">{t('mqtt.clientMgmt.title')}</h1>");
  // Line 295
  c = c.replace('{pendingCount} chờ duyệt', "{pendingCount} {t('mqtt.clientMgmt.pendingApproval')}");
  // Line 314
  c = c.replace('>Thêm MQTT Client</DialogTitle>', ">{t('mqtt.clientMgmt.addClient')}</DialogTitle>");
  // Line 328
  c = c.replace('placeholder="Nhập Device ID (unique)"', "placeholder={t('mqtt.clientMgmt.enterDeviceId')}");
  // Line 336
  c = c.replace('placeholder="Tên hiển thị của thiết bị"', "placeholder={t('mqtt.clientMgmt.enterDeviceName')}");
  // Line 398
  c = c.replace(
    `<Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>Hủy</Button>`,
    `<Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>{t('common.cancel')}</Button>`);
  // Line 400
  c = c.replace("{createMutation.isPending ? 'Đang tạo...' : 'Tạo Client'}",
    "{createMutation.isPending ? t('mqtt.clientMgmt.creating') : t('mqtt.clientMgmt.createClient')}");
  // Line 424
  c = c.replace('<SelectValue placeholder="Trạng thái kết nối" />',
    "<SelectValue placeholder={t('mqtt.clientMgmt.connectionStatus')} />");
  // Line 436
  c = c.replace('<SelectValue placeholder="Trạng thái duyệt" />',
    "<SelectValue placeholder={t('mqtt.clientMgmt.approvalStatus')} />");
  // Line 458
  c = c.replace('Kết nối thủ công ({manualConnections.length})',
    "{t('mqtt.clientMgmt.manualConnections')} ({manualConnections.length})");
  // Line 462
  c = c.replace(/(\s+)Sức khỏe\n(\s+)<\/TabsTrigger>/, "$1{t('mqtt.clientMgmt.health')}\n$2</TabsTrigger>");
  // Line 466
  c = c.replace(/(\s+)Lịch sử\n(\s+)<\/TabsTrigger>/, "$1{t('mqtt.clientMgmt.historyTab')}\n$2</TabsTrigger>");
  // Line 475
  c = c.replace('>Thiết bị Android/iOS kết nối qua MQTT protocol</CardDescription>',
    ">{t('mqtt.clientMgmt.deviceDesc')}</CardDescription>");
  // Line 488 & 636
  c = c.replaceAll('<TableHead className="text-right">Thao tác</TableHead>',
    '<TableHead className="text-right">{t(\'common.actions\')}</TableHead>');
  // Line 594
  c = c.replace("'Xác nhận xóa client này?'", "t('mqtt.clientMgmt.confirmDeleteClient')");
  // Line 609
  c = c.replace("{clients.length === 0 ? 'Chưa có MQTT client nào' : 'Không tìm thấy client phù hợp'}",
    "{clients.length === 0 ? t('mqtt.clientMgmt.noClients') : t('mqtt.clientMgmt.noMatchingClients')}");
  // Line 755
  c = c.replace('<CardTitle className="text-base">Chọn Client</CardTitle>',
    "<CardTitle className=\"text-base\">{t('mqtt.clientMgmt.selectClient')}</CardTitle>");
  // Line 782
  c = c.replace('<CardTitle className="text-base">Lịch sử kết nối</CardTitle>',
    "<CardTitle className=\"text-base\">{t('mqtt.clientMgmt.connectionHistory')}</CardTitle>");
  // Line 835
  c = c.replace("{selectedClient ? t('mqtt.clientMgmt.noHistory') : 'Chọn client để xem lịch sử'}",
    "{selectedClient ? t('mqtt.clientMgmt.noHistory') : t('mqtt.clientMgmt.selectClientForHistory')}");
  // Line 853
  c = c.replace(
    'Phê duyệt thiết bị "{approveDialog.client?.deviceName || approveDialog.client?.deviceId}" để nhận thông báo',
    '{t(\'mqtt.clientMgmt.approveDeviceDesc\', { device: approveDialog.client?.deviceName || approveDialog.client?.deviceId })}');
  // Line 885
  c = c.replace(
    `<Button variant="outline" onClick={() => setApproveDialog({ open: false, client: null })}>Hủy</Button>`,
    `<Button variant="outline" onClick={() => setApproveDialog({ open: false, client: null })}>{t('common.cancel')}</Button>`);
  // Line 898
  c = c.replace(/(\s+)Phê duyệt\n(\s+)<\/Button>/, "$1{t('mqtt.clientMgmt.approve')}\n$2</Button>");
  // Line 949
  c = c.replace('<Label>Nhận NG Alerts</Label>', "<Label>{t('mqtt.clientMgmt.receiveNGAlerts')}</Label>");
  // Line 956
  c = c.replace('<Label>Nhận Daily Summary</Label>', "<Label>{t('mqtt.clientMgmt.receiveDailySummary')}</Label>");
  // Line 963
  c = c.replace('<Label>Nhận Weekly Summary</Label>', "<Label>{t('mqtt.clientMgmt.receiveWeeklySummary')}</Label>");
  // Line 971
  c = c.replace(
    `<Button variant="outline" onClick={() => setEditingClient(null)}>Hủy</Button>`,
    `<Button variant="outline" onClick={() => setEditingClient(null)}>{t('common.cancel')}</Button>`);
  // Line 1033
  c = c.replace(
    `<Button variant="outline" onClick={() => setCreateManualDialog(false)}>Hủy</Button>`,
    `<Button variant="outline" onClick={() => setCreateManualDialog(false)}>{t('common.cancel')}</Button>`);
  // Line 1047
  c = c.replace(/(\s+)Tạo kết nối\n(\s+)<\/Button>/, "$1{t('mqtt.clientMgmt.createConnection')}\n$2</Button>");
  return c;
}

// ==================== MqttProfileManagement.tsx ====================
function fixMqttProfileManagement(c) {
  // Line 225
  c = c.replace(
    "toast.success(`Bulk assign hoàn tất: ${result.success} thành công, ${result.skipped} bỏ qua`)",
    "toast.success(t('mqtt.profileMgmt.bulkAssignComplete', { success: result.success, skipped: result.skipped }))");
  // Line 374
  c = c.replace('>Quản lý MQTT Profiles</h1>', ">{t('mqtt.profileMgmt.title')}</h1>");
  // Line 376
  c = c.replace('Cấu hình tập trung các MQTT profiles và gán cho máy/station/factory',
    "{t('mqtt.profileMgmt.pageDesc')}");
  // Line 390
  c = c.replace("toast.success('Đã xuất profiles thành công')",
    "toast.success(t('mqtt.profileMgmt.exportProfilesSuccess'))");
  // Line 407
  c = c.replace("toast.success(`Đã xuất ${result.data.total} assignments thành công`)",
    "toast.success(t('mqtt.profileMgmt.exportAssignmentsSuccess', { total: result.data.total }))");
  // Line 647
  c = c.replace('"Bạn có chắc muốn xóa profile này?"', "t('mqtt.profileMgmt.confirmDeleteProfile')");
  // Line 695
  c = c.replace("{t('mqtt.profileMgmt.noProfiles')}. Nhấn \"Tạo Profile mới\" để bắt đầu.",
    "{t('mqtt.profileMgmt.noProfilesHint')}");
  // Line 1133
  c = c.replace('{editingProfile ? "Chỉnh sửa Profile" : "Tạo Profile mới"}',
    "{editingProfile ? t('mqtt.profileMgmt.editProfile') : t('mqtt.profileMgmt.createNewProfile')}");
  // Line 1135
  c = c.replace('Cấu hình thông số kết nối MQTT broker',
    "{t('mqtt.profileMgmt.configMqttBroker')}");
  // Line 1428
  c = c.replace('Chọn loại target và target cụ thể để gán profile',
    "{t('mqtt.profileMgmt.selectTargetDesc')}");
  // Line 1472
  c = c.replace(/(\s+)Hủy\n(\s+)<\/Button>\n(\s+)<Button onClick=\{handleAssignProfile\}/,
    "$1{t('common.cancel')}\n$2</Button>\n$3<Button onClick={handleAssignProfile}");
  // Line 1478
  c = c.replace(/(\s+)Gán Profile\n(\s+)<\/Button>\n(\s+)<\/DialogFooter>/,
    "$1{t('mqtt.profileMgmt.assignProfile')}\n$2</Button>\n$3</DialogFooter>");
  // Line 1490
  c = c.replace('Chọn file JSON đã export trước đó để import profiles',
    "{t('mqtt.profileMgmt.importDesc')}");
  // Line 1528
  c = c.replace(/(\s+)Hủy\n(\s+)<\/Button>\n(\s+)<Button onClick=\{handleImportProfiles\}/,
    "$1{t('common.cancel')}\n$2</Button>\n$3<Button onClick={handleImportProfiles}");
  // Line 1595
  c = c.replace('>Cấu hình Cảnh báo</CardTitle>', ">{t('mqtt.profileMgmt.alertConfig')}</CardTitle>");
  // Line 1740
  c = c.replace('Reconnect Heatmap (7 ngày gần nhất)',
    "{t('mqtt.profileMgmt.reconnectHeatmap7d')}");
  // Line 1814
  c = c.replace('Top Profiles có nhiều Reconnect nhất',
    "{t('mqtt.profileMgmt.topReconnectProfiles')}");
  // Line 1855
  c = c.replace('Xu hướng Reconnect (30 ngày)',
    "{t('mqtt.profileMgmt.reconnectTrend30d')}");
  // Line 1932
  c = c.replace('Chọn nhiều machines/stations/factories để gán profile cùng lúc',
    "{t('mqtt.profileMgmt.bulkAssignDesc')}");
  // Line 1967
  c = c.replace('<Label>Chọn Targets ({selectedTargets.length} đã chọn)</Label>',
    "<Label>{t('mqtt.profileMgmt.selectTargets')} ({selectedTargets.length} {t('mqtt.profileMgmt.selected')})</Label>");
  // Line 2021
  c = c.replace(
    'Sẽ gán profile cho {selectedTargets.length} {bulkAssignTargetType}(s)',
    "{t('mqtt.profileMgmt.bulkAssignPreview', { count: '{selectedTargets.length}', type: '{bulkAssignTargetType}' })}");
  // Line 2034
  c = c.replace(/(\s+)Hủy\n(\s+)<\/Button>\n(\s+)<Button\n(\s+)onClick=\{handleBulkAssign\}/,
    "$1{t('common.cancel')}\n$2</Button>\n$3<Button\n$4onClick={handleBulkAssign}");
  return c;
}

// ==================== Update Locale Files ====================
function updateLocaleFiles() {
  const newViKeys = {
    alertRulesPage: {
      cooldownLabel: "Cooldown (phút)",
      categoryHint: "Chọn category để chỉ áp dụng cảnh báo cho sản phẩm thuộc category đó",
      notifications: "Thông báo",
      sendViaManus: "Gửi thông báo qua Manus",
      sendEmailAlert: "Gửi email cảnh báo",
      createRule: "Tạo Rule",
      history: "Lịch sử",
      threshold: "ngưỡng",
      resolved: "Đã xử lý",
      unresolved: "Chưa xử lý",
      noRulesHint: 'Chưa có alert rule nào. Nhấn "Tạo Rule" để bắt đầu.',
    },
    topicsMessages: {
      pageDesc: "Quản lý topics và xem lịch sử messages MQTT",
      totalTopics: "Tổng Topics",
      totalMessages: "Tổng Messages",
      noMessages: "Không có messages",
      messageDetail: "Chi tiết message MQTT",
      replayMessage: "Gửi lại message này",
    },
    replayPage: {
      pageDesc: "Theo dõi và phát lại tin nhắn MQTT để debug",
      connected: "Đã kết nối",
      disconnected: "Mất kết nối",
      messageDetail: "Chi tiết Message",
      messageHistory: "Lịch sử Message",
      messageHistoryDesc: "Xem lại các tin nhắn MQTT đã được lưu trữ",
      autoDiscoveryDesc: "Các máy được tự động phát hiện từ MQTT topics",
      registerMachine: "Đăng ký máy",
    },
    bulletinPage: {
      title: "Bản tin MQTT",
      running: "Đang chạy",
      off: "Tắt",
      stationSending: "station đang gửi",
      overview: "Tổng quan",
      configuration: "Cấu hình",
      historyTab: "Lịch sử",
      bulletinCount7d: "Số bản tin (7 ngày)",
      successful: "thành công",
      totalInspections: "Tổng kiểm tra",
      totalNG: "Tổng NG",
      summary7d: "Tổng hợp bản tin 7 ngày gần nhất",
      noDataHint: "Chưa có dữ liệu. Hãy cấu hình và bật bản tin cho các station.",
      bulletinCount: "Số bản tin",
      avgNGPerBulletin: "TB NG/bản tin",
      lastSent: "Gửi lần cuối",
      addFirstConfig: "Thêm cấu hình đầu tiên",
      cycle: "Chu kỳ",
      activeHours: "Giờ hoạt động",
      image: "Ảnh",
      minutes: "phút",
      confirmDeleteConfig: "Xác nhận xóa cấu hình bản tin này?",
      bulletinHistory: "Lịch sử bản tin",
      timestamp: "Thời điểm",
      points: "điểm",
      showing: "Hiển thị",
      bulletins: "bản tin",
      editConfig: "Chỉnh sửa cấu hình bản tin",
      addConfigMultiStation: "Thêm cấu hình bản tin cho nhiều Station",
      updateConfigDesc: "Cập nhật thông số gửi bản tin cho station đã chọn",
      multiStationConfigDesc: "Chọn nhiều station cùng lúc và áp dụng cùng một cấu hình để tiết kiệm thời gian",
      selectStation: "Chọn Station",
      selected: "đã chọn",
      noMatchingStations: "Không tìm thấy station phù hợp",
      allStationsConfigured: "Tất cả station đã được cấu hình",
      moreStations: "station khác",
      "15min": "15 phút",
      "30min": "30 phút",
      "1hour": "1 giờ",
      "2hours": "2 giờ",
      "4hours": "4 giờ",
      "8hours": "8 giờ (mỗi ca)",
      failPointList: "Danh sách điểm đo Fail",
      sendTestBulletin: "Gửi bản tin test",
      testBulletinDesc: "Gửi một bản tin MQTT với dữ liệu ngẫu nhiên để kiểm tra kết nối với app",
      random: "ngẫu nhiên",
      sending: "Đang gửi...",
    },
    clientMgmt: {
      title: "Quản lý MQTT Clients",
      enterDeviceIdAndName: "Vui lòng nhập Device ID và Device Name",
      pendingApproval: "chờ duyệt",
      addClient: "Thêm MQTT Client",
      enterDeviceId: "Nhập Device ID (unique)",
      enterDeviceName: "Tên hiển thị của thiết bị",
      creating: "Đang tạo...",
      createClient: "Tạo Client",
      connectionStatus: "Trạng thái kết nối",
      approvalStatus: "Trạng thái duyệt",
      manualConnections: "Kết nối thủ công",
      health: "Sức khỏe",
      historyTab: "Lịch sử",
      deviceDesc: "Thiết bị Android/iOS kết nối qua MQTT protocol",
      confirmDeleteClient: "Xác nhận xóa client này?",
      noClients: "Chưa có MQTT client nào",
      noMatchingClients: "Không tìm thấy client phù hợp",
      selectClient: "Chọn Client",
      connectionHistory: "Lịch sử kết nối",
      selectClientForHistory: "Chọn client để xem lịch sử",
      approveDeviceDesc: 'Phê duyệt thiết bị "{{device}}" để nhận thông báo',
      approve: "Phê duyệt",
      receiveNGAlerts: "Nhận NG Alerts",
      receiveDailySummary: "Nhận Daily Summary",
      receiveWeeklySummary: "Nhận Weekly Summary",
      createConnection: "Tạo kết nối",
    },
    profileMgmt: {
      title: "Quản lý MQTT Profiles",
      pageDesc: "Cấu hình tập trung các MQTT profiles và gán cho máy/station/factory",
      exportProfilesSuccess: "Đã xuất profiles thành công",
      exportAssignmentsSuccess: "Đã xuất {{total}} assignments thành công",
      confirmDeleteProfile: "Bạn có chắc muốn xóa profile này?",
      noProfilesHint: 'Chưa có profile nào. Nhấn "Tạo Profile mới" để bắt đầu.',
      editProfile: "Chỉnh sửa Profile",
      createNewProfile: "Tạo Profile mới",
      configMqttBroker: "Cấu hình thông số kết nối MQTT broker",
      selectTargetDesc: "Chọn loại target và target cụ thể để gán profile",
      assignProfile: "Gán Profile",
      importDesc: "Chọn file JSON đã export trước đó để import profiles",
      alertConfig: "Cấu hình Cảnh báo",
      reconnectHeatmap7d: "Reconnect Heatmap (7 ngày gần nhất)",
      topReconnectProfiles: "Top Profiles có nhiều Reconnect nhất",
      reconnectTrend30d: "Xu hướng Reconnect (30 ngày)",
      bulkAssignDesc: "Chọn nhiều machines/stations/factories để gán profile cùng lúc",
      selectTargets: "Chọn Targets",
      selected: "đã chọn",
      bulkAssignPreview: "Sẽ gán profile cho {{count}} {{type}}(s)",
      bulkAssignComplete: "Bulk assign hoàn tất: {{success}} thành công, {{skipped}} bỏ qua",
    },
  };

  const newEnKeys = {
    alertRulesPage: {
      cooldownLabel: "Cooldown (minutes)",
      categoryHint: "Select category to apply alerts only for products in that category",
      notifications: "Notifications",
      sendViaManus: "Send notifications via Manus",
      sendEmailAlert: "Send email alerts",
      createRule: "Create Rule",
      history: "History",
      threshold: "threshold",
      resolved: "Resolved",
      unresolved: "Unresolved",
      noRulesHint: 'No alert rules yet. Click "Create Rule" to get started.',
    },
    topicsMessages: {
      pageDesc: "Manage topics and view MQTT message history",
      totalTopics: "Total Topics",
      totalMessages: "Total Messages",
      noMessages: "No messages",
      messageDetail: "MQTT message detail",
      replayMessage: "Replay this message",
    },
    replayPage: {
      pageDesc: "Monitor and replay MQTT messages for debugging",
      connected: "Connected",
      disconnected: "Disconnected",
      messageDetail: "Message Detail",
      messageHistory: "Message History",
      messageHistoryDesc: "View stored MQTT messages",
      autoDiscoveryDesc: "Machines auto-discovered from MQTT topics",
      registerMachine: "Register machine",
    },
    bulletinPage: {
      title: "MQTT Bulletin",
      running: "Running",
      off: "Off",
      stationSending: "station(s) sending",
      overview: "Overview",
      configuration: "Configuration",
      historyTab: "History",
      bulletinCount7d: "Bulletins (7 days)",
      successful: "successful",
      totalInspections: "Total Inspections",
      totalNG: "Total NG",
      summary7d: "Bulletin summary for the last 7 days",
      noDataHint: "No data yet. Configure and enable bulletins for stations.",
      bulletinCount: "Bulletin Count",
      avgNGPerBulletin: "Avg NG/Bulletin",
      lastSent: "Last Sent",
      addFirstConfig: "Add first configuration",
      cycle: "Cycle",
      activeHours: "Active Hours",
      image: "Image",
      minutes: "min",
      confirmDeleteConfig: "Confirm delete this bulletin configuration?",
      bulletinHistory: "Bulletin History",
      timestamp: "Timestamp",
      points: "points",
      showing: "Showing",
      bulletins: "bulletins",
      editConfig: "Edit bulletin configuration",
      addConfigMultiStation: "Add bulletin configuration for multiple Stations",
      updateConfigDesc: "Update bulletin settings for selected station",
      multiStationConfigDesc: "Select multiple stations and apply the same configuration to save time",
      selectStation: "Select Station",
      selected: "selected",
      noMatchingStations: "No matching stations found",
      allStationsConfigured: "All stations are already configured",
      moreStations: "more stations",
      "15min": "15 minutes",
      "30min": "30 minutes",
      "1hour": "1 hour",
      "2hours": "2 hours",
      "4hours": "4 hours",
      "8hours": "8 hours (per shift)",
      failPointList: "Fail Point List",
      sendTestBulletin: "Send test bulletin",
      testBulletinDesc: "Send an MQTT bulletin with random data to test the connection with app",
      random: "random",
      sending: "Sending...",
    },
    clientMgmt: {
      title: "MQTT Client Management",
      enterDeviceIdAndName: "Please enter Device ID and Device Name",
      pendingApproval: "pending approval",
      addClient: "Add MQTT Client",
      enterDeviceId: "Enter Device ID (unique)",
      enterDeviceName: "Device display name",
      creating: "Creating...",
      createClient: "Create Client",
      connectionStatus: "Connection Status",
      approvalStatus: "Approval Status",
      manualConnections: "Manual Connections",
      health: "Health",
      historyTab: "History",
      deviceDesc: "Android/iOS devices connected via MQTT protocol",
      confirmDeleteClient: "Confirm delete this client?",
      noClients: "No MQTT clients yet",
      noMatchingClients: "No matching clients found",
      selectClient: "Select Client",
      connectionHistory: "Connection History",
      selectClientForHistory: "Select a client to view history",
      approveDeviceDesc: 'Approve device "{{device}}" to receive notifications',
      approve: "Approve",
      receiveNGAlerts: "Receive NG Alerts",
      receiveDailySummary: "Receive Daily Summary",
      receiveWeeklySummary: "Receive Weekly Summary",
      createConnection: "Create connection",
    },
    profileMgmt: {
      title: "MQTT Profile Management",
      pageDesc: "Centrally configure MQTT profiles and assign to machines/stations/factories",
      exportProfilesSuccess: "Exported profiles successfully",
      exportAssignmentsSuccess: "Exported {{total}} assignments successfully",
      confirmDeleteProfile: "Are you sure you want to delete this profile?",
      noProfilesHint: 'No profiles yet. Click "Create New Profile" to get started.',
      editProfile: "Edit Profile",
      createNewProfile: "Create New Profile",
      configMqttBroker: "Configure MQTT broker connection settings",
      selectTargetDesc: "Select target type and specific targets to assign profile",
      assignProfile: "Assign Profile",
      importDesc: "Select a previously exported JSON file to import profiles",
      alertConfig: "Alert Configuration",
      reconnectHeatmap7d: "Reconnect Heatmap (last 7 days)",
      topReconnectProfiles: "Top Profiles with Most Reconnects",
      reconnectTrend30d: "Reconnect Trend (30 days)",
      bulkAssignDesc: "Select multiple machines/stations/factories to assign profile at once",
      selectTargets: "Select Targets",
      selected: "selected",
      bulkAssignPreview: "Will assign profile to {{count}} {{type}}(s)",
      bulkAssignComplete: "Bulk assign complete: {{success}} successful, {{skipped}} skipped",
    },
  };

  // Update vi.json
  const viPath = 'client/src/i18n/locales/vi.json';
  const viContent = JSON.parse(fs.readFileSync(viPath, 'utf-8'));
  if (!viContent.mqtt) viContent.mqtt = {};
  for (const [section, keys] of Object.entries(newViKeys)) {
    if (!viContent.mqtt[section]) viContent.mqtt[section] = {};
    Object.assign(viContent.mqtt[section], keys);
  }
  fs.writeFileSync(viPath, JSON.stringify(viContent, null, 2) + '\n', 'utf-8');
  console.log('✓ Updated vi.json with new mqtt keys');

  // Update en.json
  const enPath = 'client/src/i18n/locales/en.json';
  const enContent = JSON.parse(fs.readFileSync(enPath, 'utf-8'));
  if (!enContent.mqtt) enContent.mqtt = {};
  for (const [section, keys] of Object.entries(newEnKeys)) {
    if (!enContent.mqtt[section]) enContent.mqtt[section] = {};
    Object.assign(enContent.mqtt[section], keys);
  }
  fs.writeFileSync(enPath, JSON.stringify(enContent, null, 2) + '\n', 'utf-8');
  console.log('✓ Updated en.json with new mqtt keys');
}

// ==================== Main ====================
function main() {
  console.log('Starting MQTT i18n fix migration...\n');

  const migrations = {
    'MqttAlertRules.tsx': fixMqttAlertRules,
    'MqttTopicsMessages.tsx': fixMqttTopicsMessages,
    'MQTTReplay.tsx': fixMQTTReplay,
    'MqttBulletin.tsx': fixMqttBulletin,
    'MqttClientManagement.tsx': fixMqttClientManagement,
    'MqttProfileManagement.tsx': fixMqttProfileManagement,
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

  try {
    updateLocaleFiles();
  } catch (err) {
    console.error(`✗ Locale files: ${err.message}`);
  }

  console.log('\n--- Summary ---');
  for (const [f, cnt] of Object.entries(stats)) {
    console.log(`  ${f}: ${cnt} lines changed`);
  }
  console.log('\nDone!');
}

main();
