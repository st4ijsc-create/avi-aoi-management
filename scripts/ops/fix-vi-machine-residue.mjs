/**
 * doc 65 — sửa chuỗi dịch-máy rác trong vi.json (residue kiểu "Enter Mẫu Tên",
 * "Two f a Mô tả", "Please enter tại least one Email"). Map dịch TAY — không máy móc
 * thay chữ (tránh sinh rác mới). JSON round-trip 2-space (pattern navbar round doc63).
 * Chạy: node scripts/ops/fix-vi-machine-residue.mjs [--dry]
 */
import fs from "fs";

const FILE = "client/src/i18n/locales/vi.json";
const dry = process.argv.includes("--dry");

const FIXES = {
  // ── Mặt tiền: gate "chưa đăng nhập" của DashboardLayout ──
  "auth.loginTitle": "Cần đăng nhập",
  "auth.systemDescription": "Đăng nhập để tiếp tục sử dụng SYNAPSE — nền tảng vận hành sản xuất.",
  // ── auth / 2FA / phiên ──
  "auth.regenerateBackupCodesDescription": "Bộ mã dự phòng cũ sẽ bị vô hiệu và thay bằng bộ mã mới",
  "auth.twoFARequirementDescription": "Vai trò của bạn yêu cầu bật xác thực hai bước trước khi thao tác",
  "auth.logoutFromDeviceDescription": "Đăng xuất phiên làm việc trên thiết bị này",
  "auth.logoutAllDevicesDescription": "Thu hồi toàn bộ phiên đăng nhập trên mọi thiết bị",
  "auth.changePasswordDescription": "Đổi mật khẩu đăng nhập của tài khoản",
  "auth.twoFADisabledDescription": "Xác thực hai bước đang tắt cho tài khoản này",
  "auth.twoFAEnabledDescription": "Xác thực hai bước đang bật cho tài khoản này",
  "auth.regenerateBackupCodes": "Tạo lại mã dự phòng",
  "auth.enterAuthOrBackupCode": "Nhập mã xác thực hoặc mã dự phòng",
  "auth.changePasswordSuccess": "Đổi mật khẩu thành công",
  "auth.oauthPasswordMessage": "Tài khoản đăng nhập qua SSO — đổi mật khẩu tại nhà cung cấp định danh",
  "auth.enterSixDigitFromApp": "Nhập mã 6 số từ ứng dụng xác thực",
  "auth.twoFADisableSuccess": "Đã tắt xác thực hai bước",
  "auth.setup2FADescription": "Quét mã QR bằng ứng dụng xác thực rồi nhập mã 6 số để kích hoạt",
  "auth.regenerateWhenEmpty": "Hãy tạo lại khi đã dùng hết mã dự phòng",
  "auth.enterSecretManually": "Hoặc nhập mã bí mật thủ công",
  "auth.twoFAVerifySuccess": "Xác minh hai bước thành công",
  "auth.enterSixDigitCode": "Nhập mã 6 số",
  "auth.logoutFromDevice": "Đăng xuất thiết bị này",
  "auth.logoutAllWarning": "Mọi thiết bị sẽ phải đăng nhập lại",
  "auth.logoutAllDevices": "Đăng xuất mọi thiết bị",
  "auth.twoFASetupError": "Lỗi khi thiết lập xác thực hai bước",
  "auth.twoFASettingUp": "Đang thiết lập xác thực hai bước…",
  "auth.twoFADisabled": "Xác thực hai bước: đang tắt",
  "auth.enterAuthCode": "Nhập mã xác thực",
  "auth.twoFAEnabled": "Xác thực hai bước: đang bật",
  "auth.logoutAll": "Đăng xuất tất cả",
  // ── session (trang Quản lý phiên) ──
  "session.logoutSessionDescription": "Thu hồi phiên đăng nhập này",
  "session.logoutAllOtherSessions": "Đăng xuất mọi phiên khác",
  "session.logoutAllDescription": "Thu hồi tất cả phiên trừ phiên hiện tại",
  "session.logoutThisSession": "Đăng xuất phiên này",
  "session.logoutAllSuccess": "Đã đăng xuất tất cả phiên khác",
  "session.logoutAllError": "Lỗi khi đăng xuất các phiên khác",
  "session.loginSessions": "Phiên đăng nhập",
  // ── nhập liệu chung ──
  "ai.enterCorrectValue": "Nhập giá trị đúng",
  "common.enterSerialNumber": "Nhập số serial",
  "annotation.comparison.enterSerialOrFilter": "Nhập số serial hoặc chọn bộ lọc",
  "annotation.templates.enterTemplateName": "Nhập tên mẫu",
  "annotation.templates.enterName": "Nhập tên",
  "annotation.tags.enterTagName": "Nhập tên thẻ",
  "annotation.enterText": "Nhập văn bản",
  "history.batch.enterNoteContent": "Nhập nội dung ghi chú",
  "history.batch.enterNote": "Nhập ghi chú",
  "history.batch.enterTag": "Nhập thẻ",
  "dashboard.enterNewDashboardInfo": "Nhập thông tin dashboard mới",
  "dashboard.enterTemplateName": "Nhập tên mẫu",
  "dashboard.enterLayoutName": "Nhập tên bố cục",
  "dashboard.enterNewInfo": "Nhập thông tin mới",
  "products.enterOrPasteJson": "Nhập hoặc dán JSON",
  "products.enterCodeAndName": "Nhập mã và tên sản phẩm",
  "products.changeName": "Đổi tên",
  "users.enterCorporateCode": "Nhập mã tập đoàn",
  "users.enterFactoryCode": "Nhập mã nhà máy",
  "users.loginName": "Tên đăng nhập",
  "users.noEmail": "Chưa có email",
  "workstations.enterCodeAndName": "Nhập mã và tên trạm",
  "workstations.detailByWorkstationDesc": "Số liệu chi tiết theo từng trạm làm việc",
  "workstations.detailByWorkstation": "Chi tiết theo trạm làm việc",
  // ── assignments / roles / audit / settings ──
  "assignments.changeCorporateDesc": "Chuyển người dùng sang tập đoàn khác",
  "assignments.changeFactoryDesc": "Chuyển người dùng sang nhà máy khác",
  "assignments.changeCorporate": "Đổi tập đoàn",
  "assignments.changeFactory": "Đổi nhà máy",
  "roles.changeUserRole": "Đổi vai trò người dùng",
  "audit.changeDetails": "Chi tiết thay đổi",
  "settings.changeReasonPlaceholder": "Nhập lý do thay đổi…",
  "settings.changeReasonDescription": "Lý do sẽ được lưu vào nhật ký audit cùng thay đổi",
  "settings.changeReasonTitle": "Lý do thay đổi",
  "settings.changeHistory": "Lịch sử thay đổi",
  // ── reports (cụm email) ──
  "reports.pleaseEnterAtLeastOneEmail": "Vui lòng nhập ít nhất một email",
  "reports.enterInfoForInspectionPdf": "Nhập thông tin cho PDF kiểm tra",
  "reports.previewEmailDescription": "Xem trước nội dung email trước khi gửi",
  "reports.pleaseEnterValidEmail": "Vui lòng nhập email hợp lệ",
  "reports.previewEmailWithData": "Xem trước email với dữ liệu thật",
  "reports.enterResolutionNotes": "Nhập ghi chú xử lý",
  "reports.enterAtLeastOneEmail": "Nhập ít nhất một email",
  "reports.multipleEmailsHint": "Nhiều email cách nhau bằng dấu phẩy",
  "reports.enterInspectionId": "Nhập ID lượt kiểm tra",
  "reports.previewEmailDesc": "Xem trước nội dung email",
  "reports.detailByCategory": "Chi tiết theo danh mục",
  "reports.autoEmailFooter2": "Email này được gửi tự động — vui lòng không trả lời.",
  "reports.autoEmailFooter1": "Báo cáo tự động từ SYNAPSE.",
  "reports.enterReportName": "Nhập tên báo cáo",
  "reports.errorSendEmail": "Lỗi khi gửi email",
  "reports.emailSendError": "Gửi email thất bại",
  "reports.testEmailSent": "Đã gửi email thử",
  "reports.sendTestEmail": "Gửi email thử",
  "reports.previewEmail": "Xem trước email",
  "reports.invalidEmail": "Email không hợp lệ",
  // ── mqtt / khác ──
  "mqtt.replayPage.messageHistory": "Lịch sử bản tin",
  "mqtt.replayPage.messageDetail": "Chi tiết bản tin",
  "mqtt.profileMgmt.importComplete": "Import hoàn tất: {{imported}} thêm mới, {{updated}} cập nhật, {{skipped}} bỏ qua",
  "rtReport.complianceView": "Chế độ xem tuân thủ",
  "andonBoard.backToDashboard": "Về Bảng điều khiển",
  // ── batch 2 (doc65 vòng thị giác 1): residue lộ trên màn OEE/profile/settings/line-view ──
  "oee.machinesMonitored": "Máy được giám sát",
  "oee.lowOeeMachines": "Máy OEE thấp",
  "oee.avgOee": "OEE trung bình",
  "oee.avgOeeShort": "OEE TB",
  "lineView.navDesc": "Sơ đồ tuyến · trạng thái vận hành · nhịp/nút cổ chai · sẵn sàng · lệnh tuyến",
  "lineView.subtitle": "Sơ đồ tuyến: trạng thái vận hành, nhịp sản xuất, nút cổ chai, trạm nghẽn/đói liệu và lệnh tuyến.",
  "profile.notUpdated": "Chưa cập nhật",
  "profile.description": "Thông tin tài khoản và bảo mật của bạn",
  "profile.accountCreatedDate": "Ngày tạo tài khoản",
  "profile.backupCodesDescription": "Mã dự phòng dùng khi mất thiết bị xác thực",
  "settings.thresholdGuide": "Hướng dẫn ngưỡng",
  "settings.thresholdConfig": "Cấu hình ngưỡng",
  "settings.yieldThresholdConfigDescription": "Đặt ngưỡng FPY / FY / NTF / UPH — vượt ngưỡng sẽ đổi màu trạng thái và phát cảnh báo",
  // component đã in "<strong>FPY (First Pass Yield)</strong>: " phía trước → guide KHÔNG lặp acronym
  "settings.fpyGuide": "tỷ lệ đạt ngay lần đầu, không tính hàng sửa lại",
  "settings.fyGuide": "tỷ lệ đạt cuối cùng sau sửa chữa / kiểm tra lại",
  "settings.ntfGuide": "máy báo lỗi nhưng kiểm tra lại không thấy lỗi thật",
  "settings.uphGuide": "sản lượng mỗi giờ của trạm / chuyền",
  "dashboard.noAlerts": "Không có cảnh báo",
  // ── batch 3 (doc65 thị giác v2): sessions/settings/OEE/WIP/quality ──
  "session.description": "Xem và thu hồi các phiên đăng nhập của tài khoản trên mọi thiết bị",
  "session.accountSecurity": "Bảo mật tài khoản",
  "session.activeSessions": "Phiên đang hoạt động",
  "session.sessionsLoggedIn": "phiên đang đăng nhập",
  "settings.machineType_IOT_SENSOR": "Cảm biến IoT",
  "settings.machineType_SCREWDRIVE": "Máy vặn vít",
  "settings.machineType_SCREW_DRIVER": "Máy vặn vít",
  "settings.machineType_GLUE_DISPENSER": "Máy tra keo",
  "settings.machineType_CONVEYOR": "Băng tải",
  "oee.exportCsv": "Xuất CSV",
  "oee.exportExcel": "Xuất Excel",
  "wipDashboard.dwellByStation": "Thời gian lưu / Đói việc / Bị chặn theo trạm (giây, 24h)",
  "session.securityNotice": "Nếu thấy thiết bị hoặc vị trí lạ, hãy đăng xuất phiên đó ngay và đổi mật khẩu.",
  "history.perPage": "{{count}}/trang",
  // ── batch 4 (v3 findings): nhãn ngắn cho rail + jargon còn sót ──
  "settings.machineType_FCT": "FCT",
  "settings.machineType_ICT": "ICT",
  "settings.machineType_SPI": "SPI",
  "wipDashboard.subtitle": "Theo dõi WIP thời gian thực: thời gian lưu, nút thắt và điều phối chuyền",
  "qualityCockpit.fce.subtitle": "Tỉ lệ báo giả = NTF / số lần máy báo NG · tỉ lệ lọt lỗi tính từ dữ liệu truy vết trạm — hai chỉ số cần cân đối khi tinh chỉnh",
  "qualityCockpit.fce.escapeUnavailable": "Chưa có dữ liệu truy vết trạm trong khoảng này",
  "qualityCockpit.fce.escapeScopeNote": "Phạm vi lọt lỗi tính theo sản phẩm + khoảng thời gian (dữ liệu truy vết không gắn với từng máy)",
  "qualityCockpit.corrections.title": "Máy hay báo giả (từ nhật ký sửa kết quả)",
  "andonBoard.finalYield": "Tỷ lệ đạt cuối hôm nay",
  "andonBoard.allLines": "Toàn bộ dây chuyền",
  "lineView.title": "Sơ đồ chuyền",
  "nav.controlTower": "Tháp vận hành",
  "nav.hotFolders": "Nạp ảnh hot-folder",
  "settings.title": "Cài đặt chung",
  "lineView.kpi.recipeSet": "Bộ recipe",
  "lineView.flow.window": "Cửa sổ quan sát thời gian lưu: {{minutes}} phút — ngưỡng nghẽn/đói: {{threshold}}",
};

const raw = fs.readFileSync(FILE, "utf8");
const data = JSON.parse(raw);
let applied = 0, missing = [];
for (const [path, val] of Object.entries(FIXES)) {
  const parts = path.split(".");
  let o = data;
  for (let i = 0; i < parts.length - 1; i++) o = o?.[parts[i]];
  const leaf = parts[parts.length - 1];
  if (o && typeof o[leaf] === "string") {
    if (o[leaf] !== val) { if (!dry) o[leaf] = val; applied++; }
  } else if (o && o[leaf] === undefined && path.startsWith("settings.machineType_")) {
    // nhóm nhãn machineType: key MỚI được phép thêm (fallback util đọc key này)
    if (!dry) o[leaf] = val;
    applied++;
  } else missing.push(path);
}
if (!dry) fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
console.log(`${dry ? "[DRY] " : ""}applied: ${applied}/${Object.keys(FIXES).length}; missing keys: ${missing.length}`);
if (missing.length) console.log("missing:", missing.join(", "));
