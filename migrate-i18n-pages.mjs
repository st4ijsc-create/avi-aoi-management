/**
 * i18n Migration Script for Dashboard.tsx, History.tsx, Settings.tsx, ProductModels.tsx
 * 
 * Uses regex-based replacements to handle JSX whitespace patterns.
 * Run: node migrate-i18n-pages.mjs
 */

import fs from 'fs';
import path from 'path';

const PAGES_DIR = './client/src/pages';
const LOCALES_DIR = './client/src/i18n/locales';

// ============================================
// HELPERS
// ============================================
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Replace text between > and </ (handles whitespace)
function rTag(c, text, repl) {
  return c.replace(new RegExp(`(>)\\s*${esc(text)}\\s*(</)`, 'g'), `$1${repl}$2`);
}

// Replace attribute value: attr="text" → attr={expr}
function rAttr(c, attr, text, repl) {
  return c.replace(new RegExp(`${esc(attr)}="${esc(text)}"`, 'g'), `${attr}={${repl}}`);
}

// Replace inline text after self-closing tag /> with whitespace
function rAfterIcon(c, text, repl) {
  return c.replace(new RegExp(`(/>\\s*\\n[ \\t]+)${esc(text)}(\\s*\\n)`, 'g'), `$1${repl}$2`);
}

// Replace toast message
function rToast(c, text, repl) {
  return c.replace(new RegExp(`toast\\.(success|error)\\("${esc(text)}"\\)`, 'g'), `toast.$1(${repl})`);
}

// Replace label content: >text *</label> or >text</label>
function rLabel(c, text, repl) {
  return c.replace(new RegExp(`(>)${esc(text)}(\\s*\\*?\\s*</label>)`, 'g'), `$1{${repl}}$2`);
}

// Replace label with <span> star: Text <span...>*</span>
function rLabelSpan(c, text, repl) {
  return c.replace(new RegExp(`(>)${esc(text)}(\\s*<span)`, 'g'), `$1{${repl}}$2`);
}

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key]) target[key] = {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

function addImportAndHook(content, componentName) {
  if (!content.includes("useTranslation")) {
    const firstImportMatch = content.match(/^import .+;\n/m);
    if (firstImportMatch) {
      content = content.replace(
        firstImportMatch[0],
        firstImportMatch[0] + `import { useTranslation } from 'react-i18next';\n`
      );
    }
  }
  if (!content.includes("const { t } = useTranslation()")) {
    const funcMatch = content.match(new RegExp(`export default function ${componentName}\\(\\)\\s*\\{`));
    if (funcMatch) {
      const funcIndex = content.indexOf(funcMatch[0]);
      const afterBrace = funcIndex + funcMatch[0].length;
      content = content.slice(0, afterBrace) + `\n  const { t } = useTranslation();` + content.slice(afterBrace);
    }
  }
  return content;
}

// ============================================
// TRANSLATION KEYS
// ============================================
const newViKeys = {
  "dashboard": {
    "title": "Dashboard",
    "productionDashboard": "Production Dashboard",
    "monitoringQuality": "Theo dõi chất lượng sản xuất",
    "updatedAt": "Cập nhật lúc",
    "5seconds": "5 giây",
    "10seconds": "10 giây",
    "30seconds": "30 giây",
    "1minute": "1 phút",
    "off": "Tắt",
    "unclassified": "Chưa phân loại",
    "good": "Tốt",
    "warning": "Cảnh báo",
    "needsAttention": "Cần xử lý",
    "factory": "Nhà máy",
    "allFactories": "Tất cả nhà máy",
    "workshop": "Xưởng",
    "allWorkshops": "Tất cả xưởng",
    "line": "Line",
    "allLines": "Tất cả line",
    "7days": "7 ngày",
    "30days": "30 ngày",
    "yieldWarning": "Cảnh báo Yield",
    "configuration": "Cấu hình",
    "machineConnectionStatus": "Trạng thái kết nối máy",
    "online": "Online",
    "offline": "Offline",
    "avail": "Avail",
    "overviewTab": "Tổng quan",
    "ngVisualTab": "NG Visual",
    "layoutTab": "Layout dây chuyền",
    "customDashboardTab": "Custom Dashboard",
    "shiftStats": "Thống kê theo ca",
    "noDataYet": "Chưa có dữ liệu",
    "top5Best": "Top 5 máy tốt nhất",
    "top5NeedImprovement": "Top 5 máy cần cải thiện",
    "timeChart24h": "Biểu đồ theo thời gian (24 giờ qua)",
    "resultDistribution": "Phân bố kết quả",
    "topMachinesByOutput": "Top máy theo sản lượng",
    "top5HighErrorWorkstations": "Top 5 Công trạm có lỗi cao nhất",
    "totalOutput": "Total Output",
    "productionLineLayout": "Layout Dây chuyền sản xuất",
    "customizeMetrics": "Tùy chỉnh chỉ số",
    "linesMachines": "dây chuyền • máy",
    "noMachinesInFilter": "Chưa có máy nào trong bộ lọc hiện tại",
    "machinesActive": "máy hoạt động",
    "machineCode": "Mã máy:",
    "latestResults": "Kết quả gần nhất",
    "noInspectionResults": "Chưa có kết quả kiểm tra",
    "customizeMetricsTitle": "Tùy chỉnh chỉ số hiển thị",
    "customizeMetricsDesc": "Chọn các chỉ số bạn muốn hiển thị trên thẻ máy",
    "fpyDesc": "Tỷ lệ sản phẩm đạt lần đầu",
    "ngRateDesc": "Tỷ lệ sản phẩm lỗi",
    "ntfRateDesc": "Tỷ lệ không tìm thấy kết quả",
    "totalDesc": "Tổng số sản phẩm đã kiểm tra",
    "show": "Hiển thị",
    "hide": "Ẩn",
    "resetDefault": "Đặt lại mặc định",
    "done": "Xong",
    "workstationDetail": "Chi tiết công trạm:",
    "stationCode": "Mã:",
    "todayPeriod": "hôm nay",
    "7daysPeriod": "7 ngày qua",
    "30daysPeriod": "30 ngày qua",
    "limit": "Giới hạn:",
    "noMeasurementPoints": "Chưa có điểm đo",
    "pdfTitle": "BÁO CÁO CHẤT LƯỢNG SẢN XUẤT",
    "pdfFactory": "Nhà máy:",
    "pdfWorkshop": "Xưởng:",
    "pdfLine": "Line:",
    "pdfPeriod": "Kỳ báo cáo:",
    "pdfDate": "Ngày xuất:",
    "pdfKpiSummary": "1. TÓM TẮT CHỈ SỐ KPI",
    "pdfMetric": "Chỉ số",
    "pdfValue": "Giá trị",
    "pdfTrend": "Xu hướng",
    "pdfTotalOutput": "Tổng sản lượng",
    "pdfFpy": "FPY (First Pass Yield)",
    "pdfOkCount": "Số lượng OK",
    "pdfNgCount": "Số lượng NG",
    "pdfNtfCount": "Số lượng NTF",
    "pdfUp": "Tăng",
    "pdfDown": "Giảm",
    "pdfStable": "Ổn định",
    "pdfExportSuccess": "Đã xuất báo cáo PDF thành công!",
    "pdfExportError": "Không thể xuất PDF",
    "exportPdf": "Xuất PDF",
    "ngTrendByDay": "Xu hướng tỉ lệ NG theo ngày",
    "filterByWorkstation": "Lọc theo công trạm",
    "allWorkstations": "Tất cả",
    "filterByPoint": "Lọc theo điểm đo",
    "allPoints": "Tất cả",
    "ngCompare": "So sánh NG",
    "previous": "trước",
    "current": "hiện tại",
    "change": "thay đổi",
    "noNgData": "Không có dữ liệu NG",
    "ngSeverity": "Mức độ nghiêm trọng",
    "severityCritical": "Nghiêm trọng",
    "severityHigh": "Cao",
    "severityMedium": "Trung bình",
    "severityLow": "Thấp",
    "day": "Ngày",
    "week": "Tuần",
    "month": "Tháng",
    "exportData": "Xuất dữ liệu"
  },
  "history": {
    "title": "Lịch sử kiểm tra",
    "subtitle": "Tìm kiếm và phân tích kết quả kiểm tra từ tất cả máy",
    "listTab": "Danh sách",
    "infiniteTab": "Infinite",
    "yieldStatsTab": "Yield Stats",
    "analysisTab": "Phân tích",
    "workstationTab": "Công trạm",
    "spcTab": "SPC",
    "aiAnalysisTab": "AI Analysis",
    "comparisonTab": "So sánh",
    "galleryTab": "Gallery",
    "searchResults": "Kết quả tìm kiếm",
    "perPage": "/trang",
    "exportExcelBtn": "Xuất Excel",
    "selectAllBtn": "Chọn tất cả",
    "selectedCount": "Đã chọn",
    "totalProducts": "Tổng sản phẩm",
    "resultDistribution": "Phân bố kết quả",
    "trendByDay": "Xu hướng theo ngày",
    "statsByMachine": "Thống kê theo máy",
    "topErrorPoints": "Top Điểm Đo Lỗi Nhiều Nhất",
    "statsByProduct": "Thống kê theo sản phẩm",
    "workstationAnalysis": "Phân tích theo Công trạm",
    "spcTitle": "Statistical Process Control (SPC)",
    "controlChartYield": "Control Chart - Yield Rate",
    "histogramResults": "Histogram - Phân bố kết quả",
    "paretoTopErrors": "Pareto Chart - Top lỗi",
    "quantity": "Số lượng",
    "ngErrorCount": "Số lỗi NG",
    "cumulativePercent": "Tích lũy %",
    "processCapabilityTitle": "Đánh giá năng lực quá trình sản xuất",
    "processCapabilityExplanation": "Giải thích:",
    "heatmapTitle": "Heatmap - Phân bố NG theo điểm đo",
    "heatmapDescription": "Biểu đồ nhiệt thể hiện mật độ NG theo từng điểm đo",
    "lowNg": "Ít NG",
    "highNg": "Nhiều NG",
    "heatmapSummary": "Tổng hợp:",
    "westernElectricWarning": "Cảnh báo",
    "outOfControlPoints": "Phát hiện các điểm ngoài tầm kiểm soát",
    "processStable": "Quá trình ổn định",
    "noWesternElectricViolation": "Không phát hiện vi phạm quy tắc Western Electric",
    "aiAnalysisTitle": "Phân tích AI",
    "aiAnalysisDesc": "Dự đoán xu hướng và phát hiện bất thường bằng machine learning",
    "mean": "Trung bình",
    "stdDev": "Độ lệch chuẩn",
    "lowest": "Thấp nhất",
    "highest": "Cao nhất",
    "currentValue": "Hiện tại",
    "trendPrediction": "Dự đoán xu hướng",
    "increasing": "Tăng",
    "decreasing": "Giảm",
    "stable": "Ổn định",
    "predictedYield": "Dự đoán Yield",
    "anomalyDetection": "Phát hiện bất thường",
    "points": "điểm",
    "critical": "Nghiêm trọng",
    "improvementRecommendations": "Khuyến nghị cải thiện",
    "yieldStatsTitle": "Thống kê Yield - FPY, FY, NTF, UPH",
    "exportReport": "Xuất báo cáo",
    "exportPdf": "Xuất PDF",
    "exportExcel": "Xuất Excel",
    "exportCsv": "Xuất CSV",
    "currentFpy": "Current First Pass Yield",
    "dailyFailYield": "Daily Fail Yield",
    "avgNtfYield": "Avg NTF Yield",
    "avgUph": "Avg UPH",
    "yieldSummaryByDay": "Bảng tổng hợp Yield theo ngày",
    "dayColumn": "Ngày",
    "failRate": "Fail Rate",
    "ntfRate": "NTF Rate",
    "galleryTitle": "Gallery Hình Ảnh Kiểm Tra",
    "galleryDesc": "Xem tất cả hình ảnh kiểm tra",
    "measurementImages": "Hình ảnh điểm đo",
    "noImagesYet": "Chưa có hình ảnh",
    "searchedFor": "Đã tìm kiếm: {{serialNumber}}"
  },
  "settings": {
    "title": "AVI/AOI Management",
    "systemSettings": "Cài đặt hệ thống",
    "systemDescription": "Quản lý nhà máy, nhà xưởng, dây chuyền, công trạm và máy",
    "adminOnlyAccess": "Chỉ Admin mới có quyền truy cập",
    "contactAdmin": "Liên hệ quản trị viên để được cấp quyền",
    "seedData": "Tạo dữ liệu mẫu",
    "seed100Inspections": "Tạo 100 inspection",
    "cat": {
      "dashboardCenter": "Dashboard Center",
      "infrastructure": "Cơ sở hạ tầng",
      "production": "Sản xuất",
      "products": "Sản phẩm",
      "quality": "Chất lượng",
      "system": "Hệ thống"
    },
    "sidebar": {
      "customDashboard": "Custom Dashboard",
      "dashboardTemplates": "Dashboard Templates",
      "dashboardMarketplace": "Dashboard Marketplace",
      "factory": "Nhà máy",
      "workshop": "Nhà xưởng",
      "line": "Dây chuyền",
      "inspectionStation": "Trạm kiểm tra",
      "inspectionMachine": "Máy kiểm tra",
      "registerMapping": "Đăng ký & Mapping máy",
      "workstation": "Công trạm",
      "shift": "Ca làm việc",
      "stage": "Công đoạn",
      "productCategory": "Danh mục sản phẩm",
      "productModel": "Mẫu sản phẩm",
      "productMapping": "Mapping sản phẩm",
      "yield": "Yield",
      "alert": "Cảnh báo",
      "reportTemplate": "Mẫu báo cáo",
      "scheduledReport": "Báo cáo tự động",
      "smtpConfig": "Cấu hình SMTP",
      "emailTemplate": "Email Template",
      "auditLog": "Audit Log",
      "cacheStats": "Cache Statistics",
      "dataPermission": "Phân quyền dữ liệu",
      "userPermission": "Phân quyền người dùng",
      "roleManagement": "Quản lý vai trò",
      "backupRestore": "Backup & Restore",
      "webhook": "Webhook",
      "language": "Ngôn ngữ"
    },
    "factoryList": "Danh sách nhà máy",
    "factoryCount": "nhà máy",
    "addFactory": "Thêm nhà máy",
    "addFactoryNew": "Thêm nhà máy mới",
    "editFactory": "Chỉnh sửa nhà máy",
    "factoryCode": "Mã nhà máy",
    "factoryName": "Tên nhà máy",
    "address": "Địa chỉ",
    "addressPlaceholder": "Địa chỉ nhà máy",
    "noFactory": "Chưa có nhà máy nào",
    "workshopList": "Danh sách nhà xưởng",
    "workshopCount": "nhà xưởng",
    "addWorkshop": "Thêm nhà xưởng",
    "addWorkshopNew": "Thêm nhà xưởng mới",
    "editWorkshop": "Chỉnh sửa nhà xưởng",
    "workshopCode": "Mã nhà xưởng",
    "workshopName": "Tên nhà xưởng",
    "selectFactory": "Chọn nhà máy",
    "noWorkshop": "Chưa có nhà xưởng nào",
    "lineList": "Danh sách dây chuyền",
    "lineCount": "dây chuyền",
    "addLine": "Thêm dây chuyền",
    "addLineNew": "Thêm dây chuyền mới",
    "editLine": "Chỉnh sửa dây chuyền",
    "lineCode": "Mã dây chuyền",
    "lineName": "Tên dây chuyền",
    "selectWorkshop": "Chọn nhà xưởng",
    "noLine": "Chưa có dây chuyền nào",
    "stationList": "Danh sách công trạm",
    "stationCount": "công trạm",
    "addStation": "Thêm công trạm",
    "addStationNew": "Thêm công trạm mới",
    "editStation": "Chỉnh sửa công trạm",
    "stationCode": "Mã công trạm",
    "stationName": "Tên công trạm",
    "selectLine": "Chọn dây chuyền",
    "order": "Thứ tự",
    "orderDisplay": "Thứ tự hiển thị",
    "orderLabel": "Thứ tự:",
    "noStation": "Chưa có công trạm nào",
    "machineList": "Danh sách máy",
    "machineCount": "máy",
    "addMachine": "Thêm máy",
    "addMachineNew": "Thêm máy mới",
    "addMachineDesc": "Sau khi tạo, hệ thống sẽ cấp API Key để máy gửi dữ liệu",
    "editMachine": "Chỉnh sửa máy",
    "machineCode": "Mã máy",
    "machineName": "Tên máy",
    "machineType": "Loại máy",
    "model": "Model",
    "modelPlaceholder": "Model máy",
    "manufacturer": "Nhà sản xuất",
    "selectStation": "Chọn công trạm",
    "noMachine": "Chưa có máy nào",
    "apiKey": "API Key",
    "confirmDelete": "Xác nhận xóa",
    "deleteFactoryConfirm": "Bạn có chắc muốn xóa nhà máy",
    "cannotUndo": "Hành động này không thể hoàn tác.",
    "deleteWorkshopConfirm": "Bạn có chắc muốn xóa nhà xưởng",
    "deleteLineConfirm": "Bạn có chắc muốn xóa dây chuyền",
    "deleteStationConfirm": "Bạn có chắc muốn xóa công trạm",
    "create": "Tạo",
    "machineRegistration": "Quản lý đăng ký & Mapping máy",
    "machineRegistrationDesc": "Đăng ký thủ công qua API hoặc tự động qua WebSocket. Khi máy được mapping sẽ tự động nhận API Key và đồng bộ cấu hình.",
    "manualRegistration": "Đăng ký thủ công (API)",
    "autoRegistration": "Đăng ký tự động (WebSocket)",
    "pendingMachines": "Máy chờ duyệt",
    "pendingMachinesDesc": "máy đang chờ phê duyệt — Các máy AOI/AVI tự đăng ký qua API sẽ hiển thị ở đây",
    "approve": "Duyệt",
    "reject": "Từ chối",
    "noPendingMachines": "Không có máy nào chờ duyệt",
    "registeredAt": "Đăng ký lúc:",
    "approveMapping": "Duyệt & Mapping máy",
    "approveMappingDesc": "Đặt mã chuẩn, tên hiển thị, và gán vào công trạm/line. Hệ thống sẽ tự sinh API Key.",
    "machineCodeLabel": "Mã máy (code)",
    "displayName": "Tên hiển thị",
    "assignStation": "Gán vào Công trạm",
    "approveAndGenerateKey": "Duyệt & Cấp API Key",
    "rejectRegistration": "Từ chối đăng ký máy",
    "rejectReason": "Lý do từ chối (tùy chọn)",
    "confirmReject": "Xác nhận từ chối",
    "mqttClientsTitle": "Quản lý MQTT Clients",
    "mqttClientsDesc": "Phê duyệt, quản lý MQTT clients và kết nối thủ công đã được chuyển sang trang riêng",
    "goToMqttClients": "Đi đến MQTT Clients →",
    "autoRegistrationWs": "Đăng ký tự động (WebSocket)",
    "autoRegistrationWsDesc": "Máy tự động gửi yêu cầu đăng ký qua WebSocket. Khi được mapping, máy tự động nhận API Key và đồng bộ cấu hình.",
    "manualProcess": "Quy trình đăng ký thủ công",
    "autoProcess": "Quy trình đăng ký tự động",
    "shiftConfig": "Cấu hình ca làm việc",
    "shiftConfigDesc": "Quản lý các ca làm việc trong hệ thống",
    "addShift": "Thêm ca",
    "addShiftNew": "Thêm ca làm việc mới",
    "addShiftDesc": "Nhập thông tin ca làm việc",
    "editShift": "Chỉnh sửa ca làm việc",
    "shiftCode": "Mã ca",
    "shiftName": "Tên ca",
    "factoryOptional": "Nhà máy (để trống = áp dụng toàn hệ thống)",
    "allFactories": "Tất cả nhà máy",
    "startTime": "Giờ bắt đầu",
    "endTime": "Giờ kết thúc",
    "hour": "Giờ",
    "minute": "Phút",
    "createShift": "Tạo ca",
    "tableCode": "Mã",
    "tableShiftName": "Tên ca",
    "tableFactory": "Nhà máy",
    "tableTime": "Thời gian",
    "tableStatus": "Trạng thái",
    "tableActions": "Thao tác",
    "entireSystem": "Toàn hệ thống",
    "active": "Hoạt động",
    "paused": "Tạm dừng",
    "edit": "Chỉnh sửa",
    "noShifts": "Chưa có ca làm việc nào. Hãy thêm ca mới.",
    "productionStages": "Công đoạn sản xuất",
    "stageCount": "công đoạn",
    "addStage": "Thêm công đoạn",
    "addStageNew": "Thêm công đoạn mới",
    "addStageDesc": "Tạo công đoạn mới cho dây chuyền sản xuất",
    "editStage": "Chỉnh sửa công đoạn",
    "stageCode": "Mã công đoạn",
    "stageName": "Tên công đoạn",
    "linkedStation": "Trạm liên kết",
    "selectStation2": "Chọn trạm",
    "noLink": "Không liên kết",
    "descriptionLabel": "Mô tả",
    "descriptionPlaceholder": "Mô tả công đoạn",
    "createStage": "Tạo công đoạn",
    "noStages": "Chưa có công đoạn nào. Hãy thêm công đoạn mới.",
    "alertThreshold": "Cảnh báo ngưỡng chỉ số",
    "alertThresholdDesc": "Cấu hình cảnh báo khi FPY, FY hoặc NTFY xuống dưới ngưỡng",
    "addAlert": "Thêm cảnh báo",
    "createAlert": "Tạo cảnh báo mới",
    "createAlertDesc": "Cấu hình cảnh báo khi chỉ số xuống dưới ngưỡng",
    "editAlert": "Chỉnh sửa cảnh báo",
    "alertName": "Tên cảnh báo",
    "metricType": "Loại chỉ số",
    "condition": "Điều kiện",
    "alertThresholdLabel": "Ngưỡng cảnh báo",
    "alertThresholdNote": "VD: FPY < 90% sẽ gửi cảnh báo",
    "factoryOptionalAll": "Nhà máy (để trống = tất cả)",
    "machineOptionalAll": "Máy (để trống = tất cả)",
    "allMachines": "Tất cả máy",
    "cooldownMinutes": "Thời gian chờ giữa các cảnh báo (phút)",
    "cooldownLabel": "Thời gian chờ (phút)",
    "sendEmail": "Gửi Email",
    "inAppNotification": "Thông báo trong app",
    "createAlertBtn": "Tạo cảnh báo",
    "lessThan": "Nhỏ hơn (<)",
    "lessOrEqual": "Nhỏ hơn hoặc bằng (≤)",
    "greaterThan": "Lớn hơn (>)",
    "greaterOrEqual": "Lớn hơn hoặc bằng (≥)",
    "equalTo": "Bằng (=)",
    "yieldRate": "FPY/FY/NTFY (%)",
    "ngCount": "Số lượng NG",
    "machineStatus": "Trạng thái máy",
    "products": "sản phẩm",
    "alertEnabled": "Đang bật",
    "alertDisabled": "Đã tắt",
    "noAlerts": "Chưa có cảnh báo nào",
    "noAlertsDesc": "Tạo cảnh báo để nhận thông báo khi chỉ số xuống dưới ngưỡng",
    "productModels": "Mẫu sản phẩm",
    "productModelsDesc": "Quản lý các mẫu sản phẩm",
    "manageProductModels": "Quản lý Mẫu sản phẩm",
    "manageProductModelsDesc": "Quản lý các mẫu sản phẩm và điểm đo",
    "openProductModelsPage": "Mở trang Mẫu sản phẩm",
    "auditLogTitle": "Audit Log",
    "auditLogDesc": "Lịch sử thay đổi hệ thống",
    "machineImage": "Ảnh máy (cho Layout và Dashboard)",
    "image2D": "Ảnh 2D",
    "image3D": "Ảnh 3D",
    "upload2D": "Upload 2D",
    "upload3D": "Upload 3D",
    "imageNote": "Ảnh sẽ được hiển thị trong Layout và Dashboard. Tối đa 5MB.",
    "emptyApiKeyNote": "Để trống sẽ giữ nguyên mã tự sinh",
    "serialNumber": "Serial Number:",
    "machineTypeLabel": "Loại máy:",
    "manufacturerLabel": "Hãng:",
    "firmware": "Firmware:"
  },
  "products": {
    "managementTitle": "Quản lý sản phẩm",
    "productList": "Danh sách sản phẩm",
    "selectToManage": "Chọn sản phẩm để quản lý điểm đo",
    "createNew": "Tạo sản phẩm mới",
    "createNewDesc": "Thêm mẫu sản phẩm mới với ảnh tham chiếu",
    "productCodeLabel": "Mã sản phẩm",
    "productNameLabel": "Tên sản phẩm",
    "descriptionLabel": "Mô tả",
    "descriptionPlaceholder": "Mô tả sản phẩm...",
    "referenceImageLabel": "Ảnh tham chiếu",
    "creating": "Đang tạo...",
    "createProduct": "Tạo sản phẩm",
    "createSuccess": "Đã tạo sản phẩm thành công!",
    "createError": "Lỗi khi tạo sản phẩm",
    "editTitle": "Chỉnh sửa sản phẩm",
    "editDesc": "Cập nhật thông tin sản phẩm",
    "updating": "Đang cập nhật...",
    "updateProduct": "Cập nhật",
    "updateSuccess": "Đã cập nhật sản phẩm thành công!",
    "updateError": "Lỗi khi cập nhật sản phẩm",
    "deleteConfirm": "Bạn có chắc chắn muốn xóa sản phẩm này?",
    "deleteDesc": "Hành động này không thể hoàn tác. Tất cả điểm đo liên quan cũng sẽ bị xóa.",
    "deleteSuccess": "Đã xóa sản phẩm thành công!",
    "deleteError": "Lỗi khi xóa sản phẩm",
    "measurementPointsTitle": "Điểm đo",
    "addPointBtn": "Thêm điểm đo",
    "pointCode": "Mã điểm",
    "pointName": "Tên điểm",
    "pointType": "Loại đo",
    "unit": "Đơn vị",
    "lowerLimit": "Giới hạn dưới",
    "upperLimit": "Giới hạn trên",
    "nominalValue": "Giá trị danh nghĩa",
    "noPoints": "Chưa có điểm đo nào",
    "noPointsDesc": "Thêm điểm đo để bắt đầu quản lý chất lượng.",
    "addPointTitle": "Thêm điểm đo mới",
    "editPointTitle": "Chỉnh sửa điểm đo",
    "pointCodeLabel": "Mã điểm đo",
    "pointNameLabel": "Tên điểm đo",
    "typeDimension": "Kích thước",
    "typeVisual": "Ngoại quan",
    "typeElectrical": "Điện",
    "typePosition": "Vị trí",
    "typeColor": "Màu sắc",
    "typeSurface": "Bề mặt",
    "typeOther": "Khác",
    "pointSaved": "Đã lưu điểm đo",
    "pointDeleted": "Đã xóa điểm đo",
    "pointDeleteError": "Lỗi khi xóa điểm đo",
    "imageEditor": "Trình soạn ảnh",
    "clickToPlace": "Click vào ảnh để đặt điểm đo",
    "zoomIn": "Phóng to",
    "zoomOut": "Thu nhỏ",
    "resetZoom": "Đặt lại zoom",
    "bulkImport": "Nhập hàng loạt",
    "exportTemplate": "Xuất template",
    "downloadTemplate": "Tải template",
    "duplicate": "Nhân bản",
    "duplicateSuccess": "Đã nhân bản sản phẩm",
    "duplicateError": "Lỗi khi nhân bản",
    "cropWidth": "Rộng vùng cắt",
    "cropHeight": "Cao vùng cắt",
    "position": "Vị trí",
    "radius": "Bán kính",
    "noProductSelected": "Chưa chọn sản phẩm",
    "noProductSelectedDesc": "Chọn sản phẩm từ danh sách bên trái hoặc tạo mới",
    "referenceImageSection": "Ảnh tham chiếu & Điểm đo",
    "noReferenceImage": "Chưa có ảnh tham chiếu",
    "uploadImage": "Tải ảnh lên",
    "changeImage": "Đổi ảnh",
    "pointList": "Danh sách điểm đo",
    "deletePointConfirm": "Xóa điểm đo này?",
    "saveChanges": "Lưu thay đổi"
  }
};

const newEnKeys = {
  "dashboard": {
    "title": "Dashboard",
    "productionDashboard": "Production Dashboard",
    "monitoringQuality": "Monitor production quality",
    "updatedAt": "Updated at",
    "5seconds": "5 seconds",
    "10seconds": "10 seconds",
    "30seconds": "30 seconds",
    "1minute": "1 minute",
    "off": "Off",
    "unclassified": "Unclassified",
    "good": "Good",
    "warning": "Warning",
    "needsAttention": "Needs attention",
    "factory": "Factory",
    "allFactories": "All factories",
    "workshop": "Workshop",
    "allWorkshops": "All workshops",
    "line": "Line",
    "allLines": "All lines",
    "7days": "7 days",
    "30days": "30 days",
    "yieldWarning": "Yield Warning",
    "configuration": "Configuration",
    "machineConnectionStatus": "Machine Connection Status",
    "online": "Online",
    "offline": "Offline",
    "avail": "Avail",
    "overviewTab": "Overview",
    "ngVisualTab": "NG Visual",
    "layoutTab": "Line Layout",
    "customDashboardTab": "Custom Dashboard",
    "shiftStats": "Shift Statistics",
    "noDataYet": "No data yet",
    "top5Best": "Top 5 best machines",
    "top5NeedImprovement": "Top 5 machines needing improvement",
    "timeChart24h": "Time Chart (24 hours)",
    "resultDistribution": "Result Distribution",
    "topMachinesByOutput": "Top machines by output",
    "top5HighErrorWorkstations": "Top 5 workstations with highest errors",
    "totalOutput": "Total Output",
    "productionLineLayout": "Production Line Layout",
    "customizeMetrics": "Customize Metrics",
    "linesMachines": "lines • machines",
    "noMachinesInFilter": "No machines in current filter",
    "machinesActive": "machines active",
    "machineCode": "Machine Code:",
    "latestResults": "Latest Results",
    "noInspectionResults": "No inspection results yet",
    "customizeMetricsTitle": "Customize Display Metrics",
    "customizeMetricsDesc": "Choose the metrics to display on machine cards",
    "fpyDesc": "First pass yield rate",
    "ngRateDesc": "Defect rate",
    "ntfRateDesc": "Not found result rate",
    "totalDesc": "Total products inspected",
    "show": "Show",
    "hide": "Hide",
    "resetDefault": "Reset Default",
    "done": "Done",
    "workstationDetail": "Workstation Details:",
    "stationCode": "Code:",
    "todayPeriod": "today",
    "7daysPeriod": "last 7 days",
    "30daysPeriod": "last 30 days",
    "limit": "Limit:",
    "noMeasurementPoints": "No measurement points",
    "pdfTitle": "PRODUCTION QUALITY REPORT",
    "pdfFactory": "Factory:",
    "pdfWorkshop": "Workshop:",
    "pdfLine": "Line:",
    "pdfPeriod": "Report Period:",
    "pdfDate": "Export Date:",
    "pdfKpiSummary": "1. KPI SUMMARY",
    "pdfMetric": "Metric",
    "pdfValue": "Value",
    "pdfTrend": "Trend",
    "pdfTotalOutput": "Total Output",
    "pdfFpy": "FPY (First Pass Yield)",
    "pdfOkCount": "OK Count",
    "pdfNgCount": "NG Count",
    "pdfNtfCount": "NTF Count",
    "pdfUp": "Up",
    "pdfDown": "Down",
    "pdfStable": "Stable",
    "pdfExportSuccess": "PDF report exported successfully!",
    "pdfExportError": "Could not export PDF",
    "exportPdf": "Export PDF",
    "ngTrendByDay": "NG Trend by Day",
    "filterByWorkstation": "Filter by workstation",
    "allWorkstations": "All",
    "filterByPoint": "Filter by point",
    "allPoints": "All",
    "ngCompare": "NG Compare",
    "previous": "previous",
    "current": "current",
    "change": "change",
    "noNgData": "No NG data",
    "ngSeverity": "NG Severity",
    "severityCritical": "Critical",
    "severityHigh": "High",
    "severityMedium": "Medium",
    "severityLow": "Low",
    "day": "Day",
    "week": "Week",
    "month": "Month",
    "exportData": "Export Data"
  },
  "history": {
    "title": "Inspection History",
    "subtitle": "Search and analyze inspection results from all machines",
    "listTab": "List",
    "infiniteTab": "Infinite",
    "yieldStatsTab": "Yield Stats",
    "analysisTab": "Analysis",
    "workstationTab": "Workstation",
    "spcTab": "SPC",
    "aiAnalysisTab": "AI Analysis",
    "comparisonTab": "Comparison",
    "galleryTab": "Gallery",
    "searchResults": "Search Results",
    "perPage": "/page",
    "exportExcelBtn": "Export Excel",
    "selectAllBtn": "Select All",
    "selectedCount": "Selected",
    "totalProducts": "Total Products",
    "resultDistribution": "Result Distribution",
    "trendByDay": "Trend by Day",
    "statsByMachine": "Statistics by Machine",
    "topErrorPoints": "Top Error Measurement Points",
    "statsByProduct": "Statistics by Product",
    "workstationAnalysis": "Workstation Analysis",
    "spcTitle": "Statistical Process Control (SPC)",
    "controlChartYield": "Control Chart - Yield Rate",
    "histogramResults": "Histogram - Result Distribution",
    "paretoTopErrors": "Pareto Chart - Top Errors",
    "quantity": "Quantity",
    "ngErrorCount": "NG Error Count",
    "cumulativePercent": "Cumulative %",
    "processCapabilityTitle": "Process Capability Assessment",
    "processCapabilityExplanation": "Explanation:",
    "heatmapTitle": "Heatmap - NG Distribution by Point",
    "heatmapDescription": "Heat map showing NG density by each measurement point",
    "lowNg": "Low NG",
    "highNg": "High NG",
    "heatmapSummary": "Summary:",
    "westernElectricWarning": "Warning",
    "outOfControlPoints": "Out of control points detected",
    "processStable": "Process Stable",
    "noWesternElectricViolation": "No Western Electric rule violations detected",
    "aiAnalysisTitle": "AI Analysis",
    "aiAnalysisDesc": "Trend prediction and anomaly detection using machine learning",
    "mean": "Mean",
    "stdDev": "Std Deviation",
    "lowest": "Lowest",
    "highest": "Highest",
    "currentValue": "Current",
    "trendPrediction": "Trend Prediction",
    "increasing": "Increasing",
    "decreasing": "Decreasing",
    "stable": "Stable",
    "predictedYield": "Predicted Yield",
    "anomalyDetection": "Anomaly Detection",
    "points": "points",
    "critical": "Critical",
    "improvementRecommendations": "Improvement Recommendations",
    "yieldStatsTitle": "Yield Stats - FPY, FY, NTF, UPH",
    "exportReport": "Export Report",
    "exportPdf": "Export PDF",
    "exportExcel": "Export Excel",
    "exportCsv": "Export CSV",
    "currentFpy": "Current First Pass Yield",
    "dailyFailYield": "Daily Fail Yield",
    "avgNtfYield": "Avg NTF Yield",
    "avgUph": "Avg UPH",
    "yieldSummaryByDay": "Yield Summary by Day",
    "dayColumn": "Day",
    "failRate": "Fail Rate",
    "ntfRate": "NTF Rate",
    "galleryTitle": "Inspection Image Gallery",
    "galleryDesc": "View all inspection images",
    "measurementImages": "Measurement Point Images",
    "noImagesYet": "No images yet",
    "searchedFor": "Searched for: {{serialNumber}}"
  },
  "settings": {
    "title": "AVI/AOI Management",
    "systemSettings": "System Settings",
    "systemDescription": "Manage factories, workshops, lines, stations, and machines",
    "adminOnlyAccess": "Admin access only",
    "contactAdmin": "Contact administrator for access",
    "seedData": "Seed Data",
    "seed100Inspections": "Create 100 inspections",
    "cat": {
      "dashboardCenter": "Dashboard Center",
      "infrastructure": "Infrastructure",
      "production": "Production",
      "products": "Products",
      "quality": "Quality",
      "system": "System"
    },
    "sidebar": {
      "customDashboard": "Custom Dashboard",
      "dashboardTemplates": "Dashboard Templates",
      "dashboardMarketplace": "Dashboard Marketplace",
      "factory": "Factory",
      "workshop": "Workshop",
      "line": "Line",
      "inspectionStation": "Inspection Station",
      "inspectionMachine": "Inspection Machine",
      "registerMapping": "Register & Mapping",
      "workstation": "Workstation",
      "shift": "Shifts",
      "stage": "Stages",
      "productCategory": "Product Category",
      "productModel": "Product Models",
      "productMapping": "Product Mapping",
      "yield": "Yield",
      "alert": "Alerts",
      "reportTemplate": "Report Templates",
      "scheduledReport": "Scheduled Reports",
      "smtpConfig": "SMTP Config",
      "emailTemplate": "Email Template",
      "auditLog": "Audit Log",
      "cacheStats": "Cache Statistics",
      "dataPermission": "Data Permissions",
      "userPermission": "User Permissions",
      "roleManagement": "Role Management",
      "backupRestore": "Backup & Restore",
      "webhook": "Webhook",
      "language": "Language"
    },
    "factoryList": "Factory List",
    "factoryCount": "factories",
    "addFactory": "Add Factory",
    "addFactoryNew": "Add New Factory",
    "editFactory": "Edit Factory",
    "factoryCode": "Factory Code",
    "factoryName": "Factory Name",
    "address": "Address",
    "addressPlaceholder": "Factory address",
    "noFactory": "No factories yet",
    "workshopList": "Workshop List",
    "workshopCount": "workshops",
    "addWorkshop": "Add Workshop",
    "addWorkshopNew": "Add New Workshop",
    "editWorkshop": "Edit Workshop",
    "workshopCode": "Workshop Code",
    "workshopName": "Workshop Name",
    "selectFactory": "Select factory",
    "noWorkshop": "No workshops yet",
    "lineList": "Line List",
    "lineCount": "lines",
    "addLine": "Add Line",
    "addLineNew": "Add New Line",
    "editLine": "Edit Line",
    "lineCode": "Line Code",
    "lineName": "Line Name",
    "selectWorkshop": "Select workshop",
    "noLine": "No lines yet",
    "stationList": "Station List",
    "stationCount": "stations",
    "addStation": "Add Station",
    "addStationNew": "Add New Station",
    "editStation": "Edit Station",
    "stationCode": "Station Code",
    "stationName": "Station Name",
    "selectLine": "Select line",
    "order": "Order",
    "orderDisplay": "Display Order",
    "orderLabel": "Order:",
    "noStation": "No stations yet",
    "machineList": "Machine List",
    "machineCount": "machines",
    "addMachine": "Add Machine",
    "addMachineNew": "Add New Machine",
    "addMachineDesc": "API Key will be generated after creation for data submission",
    "editMachine": "Edit Machine",
    "machineCode": "Machine Code",
    "machineName": "Machine Name",
    "machineType": "Machine Type",
    "model": "Model",
    "modelPlaceholder": "Machine model",
    "manufacturer": "Manufacturer",
    "selectStation": "Select station",
    "noMachine": "No machines yet",
    "apiKey": "API Key",
    "confirmDelete": "Confirm Delete",
    "deleteFactoryConfirm": "Are you sure you want to delete factory",
    "cannotUndo": "This action cannot be undone.",
    "deleteWorkshopConfirm": "Are you sure you want to delete workshop",
    "deleteLineConfirm": "Are you sure you want to delete line",
    "deleteStationConfirm": "Are you sure you want to delete station",
    "create": "Create",
    "machineRegistration": "Machine Registration & Mapping",
    "machineRegistrationDesc": "Register manually via API or automatically via WebSocket. Mapped machines automatically receive API Keys and sync configuration.",
    "manualRegistration": "Manual Registration (API)",
    "autoRegistration": "Auto Registration (WebSocket)",
    "pendingMachines": "Pending Machines",
    "pendingMachinesDesc": "machines pending approval — AOI/AVI machines self-registered via API will appear here",
    "approve": "Approve",
    "reject": "Reject",
    "noPendingMachines": "No pending machines",
    "registeredAt": "Registered at:",
    "approveMapping": "Approve & Map Machine",
    "approveMappingDesc": "Set standard code, display name, and assign to station/line. API Key will be auto-generated.",
    "machineCodeLabel": "Machine Code",
    "displayName": "Display Name",
    "assignStation": "Assign to Station",
    "approveAndGenerateKey": "Approve & Generate API Key",
    "rejectRegistration": "Reject Machine Registration",
    "rejectReason": "Rejection reason (optional)",
    "confirmReject": "Confirm Rejection",
    "mqttClientsTitle": "MQTT Clients Management",
    "mqttClientsDesc": "Approve, manage MQTT clients and manual connections have been moved to a dedicated page",
    "goToMqttClients": "Go to MQTT Clients →",
    "autoRegistrationWs": "Auto Registration (WebSocket)",
    "autoRegistrationWsDesc": "Machines automatically send registration requests via WebSocket. When mapped, machines automatically receive API Keys and sync configuration.",
    "manualProcess": "Manual Registration Process",
    "autoProcess": "Auto Registration Process",
    "shiftConfig": "Shift Configuration",
    "shiftConfigDesc": "Manage shifts in the system",
    "addShift": "Add Shift",
    "addShiftNew": "Add New Shift",
    "addShiftDesc": "Enter shift information",
    "editShift": "Edit Shift",
    "shiftCode": "Shift Code",
    "shiftName": "Shift Name",
    "factoryOptional": "Factory (leave blank = apply to entire system)",
    "allFactories": "All factories",
    "startTime": "Start Time",
    "endTime": "End Time",
    "hour": "Hour",
    "minute": "Minute",
    "createShift": "Create Shift",
    "tableCode": "Code",
    "tableShiftName": "Shift Name",
    "tableFactory": "Factory",
    "tableTime": "Time",
    "tableStatus": "Status",
    "tableActions": "Actions",
    "entireSystem": "Entire system",
    "active": "Active",
    "paused": "Paused",
    "edit": "Edit",
    "noShifts": "No shifts yet. Add a new shift.",
    "productionStages": "Production Stages",
    "stageCount": "stages",
    "addStage": "Add Stage",
    "addStageNew": "Add New Stage",
    "addStageDesc": "Create a new stage for production line",
    "editStage": "Edit Stage",
    "stageCode": "Stage Code",
    "stageName": "Stage Name",
    "linkedStation": "Linked Station",
    "selectStation2": "Select station",
    "noLink": "No link",
    "descriptionLabel": "Description",
    "descriptionPlaceholder": "Stage description",
    "createStage": "Create Stage",
    "noStages": "No stages yet. Add a new stage.",
    "alertThreshold": "Metric Alert Thresholds",
    "alertThresholdDesc": "Configure alerts when FPY, FY or NTFY falls below threshold",
    "addAlert": "Add Alert",
    "createAlert": "Create New Alert",
    "createAlertDesc": "Configure alerts when metrics fall below threshold",
    "editAlert": "Edit Alert",
    "alertName": "Alert Name",
    "metricType": "Metric Type",
    "condition": "Condition",
    "alertThresholdLabel": "Alert Threshold",
    "alertThresholdNote": "E.g.: FPY < 90% will send alert",
    "factoryOptionalAll": "Factory (leave blank = all)",
    "machineOptionalAll": "Machine (leave blank = all)",
    "allMachines": "All machines",
    "cooldownMinutes": "Cooldown between alerts (minutes)",
    "cooldownLabel": "Cooldown (minutes)",
    "sendEmail": "Send Email",
    "inAppNotification": "In-app notification",
    "createAlertBtn": "Create Alert",
    "lessThan": "Less than (<)",
    "lessOrEqual": "Less or equal (≤)",
    "greaterThan": "Greater than (>)",
    "greaterOrEqual": "Greater or equal (≥)",
    "equalTo": "Equal (=)",
    "yieldRate": "FPY/FY/NTFY (%)",
    "ngCount": "NG Count",
    "machineStatus": "Machine Status",
    "products": "products",
    "alertEnabled": "Enabled",
    "alertDisabled": "Disabled",
    "noAlerts": "No alerts yet",
    "noAlertsDesc": "Create alerts to receive notifications when metrics fall below threshold",
    "productModels": "Product Models",
    "productModelsDesc": "Manage product models",
    "manageProductModels": "Manage Product Models",
    "manageProductModelsDesc": "Manage product models and measurement points",
    "openProductModelsPage": "Open Product Models page",
    "auditLogTitle": "Audit Log",
    "auditLogDesc": "System Change History",
    "machineImage": "Machine Image (for Layout and Dashboard)",
    "image2D": "2D Image",
    "image3D": "3D Image",
    "upload2D": "Upload 2D",
    "upload3D": "Upload 3D",
    "imageNote": "Images will be displayed in Layout and Dashboard. Max 5MB.",
    "emptyApiKeyNote": "Leave blank to keep auto-generated code",
    "serialNumber": "Serial Number:",
    "machineTypeLabel": "Machine Type:",
    "manufacturerLabel": "Manufacturer:",
    "firmware": "Firmware:"
  },
  "products": {
    "managementTitle": "Product Management",
    "productList": "Product List",
    "selectToManage": "Select a product to manage measurement points",
    "createNew": "Create New Product",
    "createNewDesc": "Add a new product model with reference image",
    "productCodeLabel": "Product Code",
    "productNameLabel": "Product Name",
    "descriptionLabel": "Description",
    "descriptionPlaceholder": "Product description...",
    "referenceImageLabel": "Reference Image",
    "creating": "Creating...",
    "createProduct": "Create Product",
    "createSuccess": "Product created successfully!",
    "createError": "Error creating product",
    "editTitle": "Edit Product",
    "editDesc": "Update product information",
    "updating": "Updating...",
    "updateProduct": "Update",
    "updateSuccess": "Product updated successfully!",
    "updateError": "Error updating product",
    "deleteConfirm": "Are you sure you want to delete this product?",
    "deleteDesc": "This action cannot be undone. All related measurement points will also be deleted.",
    "deleteSuccess": "Product deleted successfully!",
    "deleteError": "Error deleting product",
    "measurementPointsTitle": "Measurement Points",
    "addPointBtn": "Add Point",
    "pointCode": "Point Code",
    "pointName": "Point Name",
    "pointType": "Measurement Type",
    "unit": "Unit",
    "lowerLimit": "Lower Limit",
    "upperLimit": "Upper Limit",
    "nominalValue": "Nominal Value",
    "noPoints": "No measurement points",
    "noPointsDesc": "Add measurement points to start quality management.",
    "addPointTitle": "Add New Measurement Point",
    "editPointTitle": "Edit Measurement Point",
    "pointCodeLabel": "Point Code",
    "pointNameLabel": "Point Name",
    "typeDimension": "Dimension",
    "typeVisual": "Visual",
    "typeElectrical": "Electrical",
    "typePosition": "Position",
    "typeColor": "Color",
    "typeSurface": "Surface",
    "typeOther": "Other",
    "pointSaved": "Measurement point saved",
    "pointDeleted": "Measurement point deleted",
    "pointDeleteError": "Error deleting measurement point",
    "imageEditor": "Image Editor",
    "clickToPlace": "Click on image to place measurement point",
    "zoomIn": "Zoom In",
    "zoomOut": "Zoom Out",
    "resetZoom": "Reset Zoom",
    "bulkImport": "Bulk Import",
    "exportTemplate": "Export Template",
    "downloadTemplate": "Download Template",
    "duplicate": "Duplicate",
    "duplicateSuccess": "Product duplicated",
    "duplicateError": "Error duplicating",
    "cropWidth": "Crop Width",
    "cropHeight": "Crop Height",
    "position": "Position",
    "radius": "Radius",
    "noProductSelected": "No product selected",
    "noProductSelectedDesc": "Select a product from the list or create new",
    "referenceImageSection": "Reference Image & Measurement Points",
    "noReferenceImage": "No reference image",
    "uploadImage": "Upload Image",
    "changeImage": "Change Image",
    "pointList": "Measurement Point List",
    "deletePointConfirm": "Delete this measurement point?",
    "saveChanges": "Save Changes"
  }
};

// ============================================
// PRODUCT MODELS
// ============================================
function processProductModels() {
  const filePath = path.join(PAGES_DIR, 'ProductModels.tsx');
  let c = fs.readFileSync(filePath, 'utf-8');
  c = addImportAndHook(c, 'ProductModels');

  // DashboardLayout title
  c = rAttr(c, 'title', 'Quản lý sản phẩm', 't("products.managementTitle")');
  
  // Card titles & descriptions (tag content)
  c = rTag(c, 'Danh sách sản phẩm', '{t("products.productList")}');
  c = rTag(c, 'Chọn sản phẩm để quản lý điểm đo', '{t("products.selectToManage")}');
  c = rTag(c, 'Tạo sản phẩm mới', '{t("products.createNew")}');
  c = rTag(c, 'Thêm mẫu sản phẩm mới với ảnh tham chiếu', '{t("products.createNewDesc")}');
  c = rTag(c, 'Chỉnh sửa sản phẩm', '{t("products.editTitle")}');
  c = rTag(c, 'Cập nhật thông tin sản phẩm', '{t("products.editDesc")}');
  c = rTag(c, 'Điểm đo', '{t("products.measurementPointsTitle")}');
  c = rTag(c, 'Thêm điểm đo mới', '{t("products.addPointTitle")}');
  c = rTag(c, 'Chỉnh sửa điểm đo', '{t("products.editPointTitle")}');
  
  // Delete dialog
  c = rTag(c, 'Bạn có chắc chắn muốn xóa sản phẩm này?', '{t("products.deleteConfirm")}');
  c = rTag(c, 'Hành động này không thể hoàn tác. Tất cả điểm đo liên quan cũng sẽ bị xóa.', '{t("products.deleteDesc")}');
  
  // Labels with <span> star pattern
  c = rLabelSpan(c, 'Mã sản phẩm ', 't("products.productCodeLabel")');
  c = rLabelSpan(c, 'Tên sản phẩm ', 't("products.productNameLabel")');
  
  // Labels
  c = rTag(c, 'Mô tả', '{t("products.descriptionLabel")}');
  c = rTag(c, 'Ảnh tham chiếu', '{t("products.referenceImageLabel")}');
  c = rTag(c, 'Mã điểm đo', '{t("products.pointCodeLabel")}');
  c = rTag(c, 'Tên điểm đo', '{t("products.pointNameLabel")}');
  c = rTag(c, 'Loại đo', '{t("products.pointType")}');
  c = rTag(c, 'Đơn vị', '{t("products.unit")}');
  c = rTag(c, 'Giới hạn dưới', '{t("products.lowerLimit")}');
  c = rTag(c, 'Giới hạn trên', '{t("products.upperLimit")}');
  c = rTag(c, 'Giá trị danh nghĩa', '{t("products.nominalValue")}');
  c = rTag(c, 'Rộng vùng cắt', '{t("products.cropWidth")}');
  c = rTag(c, 'Cao vùng cắt', '{t("products.cropHeight")}');
  
  // Placeholders
  c = rAttr(c, 'placeholder', 'Mô tả sản phẩm...', 't("products.descriptionPlaceholder")');

  // Quoted strings for point type selects
  c = c.replace(/"Kích thước"/g, 't("products.typeDimension")');
  c = c.replace(/"Ngoại quan"/g, 't("products.typeVisual")');
  c = c.replace(/"Điện"/g, 't("products.typeElectrical")');
  c = c.replace(/"Vị trí"/g, 't("products.typePosition")');
  c = c.replace(/"Màu sắc"/g, 't("products.typeColor")');
  c = c.replace(/"Bề mặt"/g, 't("products.typeSurface")');

  // Empty states
  c = rTag(c, 'Chưa có điểm đo nào', '{t("products.noPoints")}');
  c = rTag(c, 'Thêm điểm đo để bắt đầu quản lý chất lượng.', '{t("products.noPointsDesc")}');
  c = rTag(c, 'Chưa chọn sản phẩm', '{t("products.noProductSelected")}');
  c = rTag(c, 'Chọn sản phẩm từ danh sách bên trái hoặc tạo mới', '{t("products.noProductSelectedDesc")}');
  c = rTag(c, 'Ảnh tham chiếu & Điểm đo', '{t("products.referenceImageSection")}');
  c = rTag(c, 'Chưa có ảnh tham chiếu', '{t("products.noReferenceImage")}');

  // Inline button text after icon
  c = rAfterIcon(c, 'Thêm điểm đo', '{t("products.addPointBtn")}');
  c = rAfterIcon(c, 'Nhập hàng loạt', '{t("products.bulkImport")}');
  c = rAfterIcon(c, 'Xuất template', '{t("products.exportTemplate")}');
  c = rAfterIcon(c, 'Tải template', '{t("products.downloadTemplate")}');
  c = rAfterIcon(c, 'Lưu thay đổi', '{t("products.saveChanges")}');
  c = rAfterIcon(c, 'Phóng to', '{t("products.zoomIn")}');
  c = rAfterIcon(c, 'Thu nhỏ', '{t("products.zoomOut")}');
  c = rAfterIcon(c, 'Thêm', '{t("common.add")}');

  // Toast messages
  c = rToast(c, 'Đã tạo sản phẩm thành công!', 't("products.createSuccess")');
  c = rToast(c, 'Đã cập nhật sản phẩm thành công!', 't("products.updateSuccess")');
  c = rToast(c, 'Đã xóa sản phẩm thành công!', 't("products.deleteSuccess")');
  c = rToast(c, 'Lỗi khi tạo sản phẩm', 't("products.createError")');
  c = rToast(c, 'Lỗi khi cập nhật sản phẩm', 't("products.updateError")');
  c = rToast(c, 'Lỗi khi xóa sản phẩm', 't("products.deleteError")');
  c = rToast(c, 'Đã lưu điểm đo', 't("products.pointSaved")');
  c = rToast(c, 'Đã xóa điểm đo', 't("products.pointDeleted")');
  c = rToast(c, 'Lỗi khi xóa điểm đo', 't("products.pointDeleteError")');
  c = rToast(c, 'Đã nhân bản sản phẩm', 't("products.duplicateSuccess")');
  c = rToast(c, 'Lỗi khi nhân bản', 't("products.duplicateError")');

  // Create/update button states
  c = c.replace(/"Đang tạo\.\.\." : "Tạo sản phẩm"/g, 't("products.creating") : t("products.createProduct")');
  c = c.replace(/"Đang cập nhật\.\.\." : "Cập nhật"/g, 't("products.updating") : t("products.updateProduct")');

  // Common buttons (regex for whitespace)
  c = c.replace(/>\s*Hủy\s*<\/Button>/g, '>{t("common.cancel")}</Button>');
  c = c.replace(/>\s*Lưu\s*<\/Button>/g, '>{t("common.save")}</Button>');
  c = c.replace(/>\s*Xóa\s*<\/Button>/g, '>{t("common.delete")}</Button>');
  c = c.replace(/>\s*Xóa\s*<\/AlertDialogAction>/g, '>{t("common.delete")}</AlertDialogAction>');
  c = c.replace(/>\s*Hủy\s*<\/AlertDialogCancel>/g, '>{t("common.cancel")}</AlertDialogCancel>');

  fs.writeFileSync(filePath, c, 'utf-8');
  console.log('✅ ProductModels.tsx processed');
}

// ============================================
// DASHBOARD
// ============================================
function processDashboard() {
  const filePath = path.join(PAGES_DIR, 'Dashboard.tsx');
  let c = fs.readFileSync(filePath, 'utf-8');
  c = addImportAndHook(c, 'Dashboard');

  // Move REFRESH_INTERVALS inside component
  c = c.replace(
    /const REFRESH_INTERVALS = \[\s*\{ value: "5", label: "5 giây" \},\s*\{ value: "10", label: "10 giây" \},\s*\{ value: "30", label: "30 giây" \},\s*\{ value: "60", label: "1 phút" \},\s*\{ value: "0", label: "Tắt" \},\s*\];/,
    '// REFRESH_INTERVALS moved inside component for i18n'
  );
  c = c.replace(
    'const { t } = useTranslation();',
    `const { t } = useTranslation();
  
  const REFRESH_INTERVALS = useMemo(() => [
    { value: "5", label: t("dashboard.5seconds") },
    { value: "10", label: t("dashboard.10seconds") },
    { value: "30", label: t("dashboard.30seconds") },
    { value: "60", label: t("dashboard.1minute") },
    { value: "0", label: t("dashboard.off") },
  ], [t]);`
  );

  // DashboardLayout title
  c = rAttr(c, 'title', 'Dashboard', 't("dashboard.title")');

  // Main header  
  c = rTag(c, 'Production Dashboard', '{t("dashboard.productionDashboard")}');
  c = rTag(c, 'Theo dõi chất lượng sản xuất', '{t("dashboard.monitoringQuality")}');
  c = c.replace(/• Cập nhật lúc /g, '• {t("dashboard.updatedAt")} ');

  // Filter labels
  c = c.replace(/<span className="text-xs font-medium">Nhà máy<\/span>/g, '<span className="text-xs font-medium">{t("dashboard.factory")}</span>');
  c = c.replace(/<span className="text-xs font-medium">Xưởng<\/span>/g, '<span className="text-xs font-medium">{t("dashboard.workshop")}</span>');
  c = c.replace(/<span className="text-xs font-medium">Line<\/span>/g, '<span className="text-xs font-medium">{t("dashboard.line")}</span>');

  // Select placeholders
  c = rAttr(c, 'placeholder', 'Tất cả nhà máy', 't("dashboard.allFactories")');
  c = rAttr(c, 'placeholder', 'Tất cả xưởng', 't("dashboard.allWorkshops")');
  c = rAttr(c, 'placeholder', 'Tất cả line', 't("dashboard.allLines")');

  // Time range buttons
  c = rTag(c, 'Hôm nay', '{t("common.today")}');
  c = rTag(c, '7 ngày', '{t("dashboard.7days")}');
  c = rTag(c, '30 ngày', '{t("dashboard.30days")}');

  // Yield warning & configuration
  c = rTag(c, 'Cảnh báo Yield', '{t("dashboard.yieldWarning")}');
  c = rTag(c, 'Cấu hình', '{t("dashboard.configuration")}');

  // Machine connection status
  c = rTag(c, 'Trạng thái kết nối máy', '{t("dashboard.machineConnectionStatus")}');

  // Tabs
  c = rTag(c, 'Tổng quan', '{t("dashboard.overviewTab")}');
  c = rTag(c, 'NG Visual', '{t("dashboard.ngVisualTab")}');
  c = rTag(c, 'Layout dây chuyền', '{t("dashboard.layoutTab")}');
  c = rTag(c, 'Custom Dashboard', '{t("dashboard.customDashboardTab")}');

  // Shift stats & cards
  c = rTag(c, 'Thống kê theo ca', '{t("dashboard.shiftStats")}');
  c = rTag(c, 'Chưa có dữ liệu', '{t("dashboard.noDataYet")}');
  c = rTag(c, 'Top 5 máy tốt nhất', '{t("dashboard.top5Best")}');
  c = rTag(c, 'Top 5 máy cần cải thiện', '{t("dashboard.top5NeedImprovement")}');
  c = rTag(c, 'Biểu đồ theo thời gian (24 giờ qua)', '{t("dashboard.timeChart24h")}');
  c = rTag(c, 'Phân bố kết quả', '{t("dashboard.resultDistribution")}');
  c = rTag(c, 'Top máy theo sản lượng', '{t("dashboard.topMachinesByOutput")}');
  c = rTag(c, 'Top 5 Công trạm có lỗi cao nhất', '{t("dashboard.top5HighErrorWorkstations")}');
  c = rTag(c, 'Layout Dây chuyền sản xuất', '{t("dashboard.productionLineLayout")}');
  c = rTag(c, 'Tùy chỉnh chỉ số', '{t("dashboard.customizeMetrics")}');
  c = rTag(c, 'Kết quả gần nhất', '{t("dashboard.latestResults")}');

  // Inline text
  c = rTag(c, 'Chưa có máy nào trong bộ lọc hiện tại', '{t("dashboard.noMachinesInFilter")}');
  c = rTag(c, 'Chưa có kết quả kiểm tra', '{t("dashboard.noInspectionResults")}');
  c = rTag(c, 'Chưa có điểm đo', '{t("dashboard.noMeasurementPoints")}');

  // Metrics settings dialog
  c = rTag(c, 'Tùy chỉnh chỉ số hiển thị', '{t("dashboard.customizeMetricsTitle")}');
  c = rTag(c, 'Chọn các chỉ số bạn muốn hiển thị trên thẻ máy', '{t("dashboard.customizeMetricsDesc")}');
  c = c.replace(/"Tỷ lệ sản phẩm đạt lần đầu"/g, 't("dashboard.fpyDesc")');
  c = c.replace(/"Tỷ lệ sản phẩm lỗi"/g, 't("dashboard.ngRateDesc")');
  c = c.replace(/"Tỷ lệ không tìm thấy kết quả"/g, 't("dashboard.ntfRateDesc")');
  c = c.replace(/"Tổng số sản phẩm đã kiểm tra"/g, 't("dashboard.totalDesc")');
  c = rTag(c, 'Hiển thị', '{t("dashboard.show")}');
  c = rTag(c, 'Ẩn', '{t("dashboard.hide")}');
  c = rTag(c, 'Đặt lại mặc định', '{t("dashboard.resetDefault")}');
  c = rTag(c, 'Xong', '{t("dashboard.done")}');

  // Workstation drilldown
  c = c.replace(/Chi tiết công trạm:/g, '{t("dashboard.workstationDetail")}');
  c = c.replace(/Mã máy:/g, '{t("dashboard.machineCode")}');
  c = c.replace(/Mã:/g, '{t("dashboard.stationCode")}');
  c = c.replace(/"hôm nay"/g, 't("dashboard.todayPeriod")');
  c = c.replace(/"7 ngày qua"/g, 't("dashboard.7daysPeriod")');
  c = c.replace(/"30 ngày qua"/g, 't("dashboard.30daysPeriod")');
  c = c.replace(/Giới hạn:/g, '{t("dashboard.limit")}');

  // PDF export
  c = c.replace(/"BÁO CÁO CHẤT LƯỢNG SẢN XUẤT"/g, 't("dashboard.pdfTitle")');
  c = c.replace(/"Nhà máy:"/g, 't("dashboard.pdfFactory")');
  c = c.replace(/"Xưởng:"/g, 't("dashboard.pdfWorkshop")');
  c = c.replace(/"Line:"/g, 't("dashboard.pdfLine")');
  c = c.replace(/"Kỳ báo cáo:"/g, 't("dashboard.pdfPeriod")');
  c = c.replace(/"Ngày xuất:"/g, 't("dashboard.pdfDate")');
  c = c.replace(/"1\. TÓM TẮT CHỈ SỐ KPI"/g, 't("dashboard.pdfKpiSummary")');
  c = c.replace(/"Chỉ số"/g, 't("dashboard.pdfMetric")');
  c = c.replace(/"Giá trị"/g, 't("dashboard.pdfValue")');
  c = c.replace(/"Xu hướng"/g, 't("dashboard.pdfTrend")');
  c = c.replace(/"Tổng sản lượng"/g, 't("dashboard.pdfTotalOutput")');
  c = c.replace(/"FPY \(First Pass Yield\)"/g, 't("dashboard.pdfFpy")');
  c = c.replace(/"Số lượng OK"/g, 't("dashboard.pdfOkCount")');
  c = c.replace(/"Số lượng NG"/g, 't("dashboard.pdfNgCount")');
  c = c.replace(/"Số lượng NTF"/g, 't("dashboard.pdfNtfCount")');
  c = c.replace(/"Tăng"/g, 't("dashboard.pdfUp")');
  c = c.replace(/"Giảm"/g, 't("dashboard.pdfDown")');
  c = c.replace(/"Ổn định"/g, 't("dashboard.pdfStable")');

  // Toast
  c = rToast(c, 'Đã xuất báo cáo PDF thành công!', 't("dashboard.pdfExportSuccess")');
  c = c.replace(/"Không thể xuất PDF"/g, 't("dashboard.pdfExportError")');

  // Export buttons
  c = rTag(c, 'Xuất PDF', '{t("dashboard.exportPdf")}');
  c = rTag(c, 'Xuất dữ liệu', '{t("dashboard.exportData")}');
  c = rAfterIcon(c, 'Xuất PDF', '{t("dashboard.exportPdf")}');
  c = rAfterIcon(c, 'Xuất dữ liệu', '{t("dashboard.exportData")}');

  // NG Visual tab
  c = rTag(c, 'Xu hướng tỉ lệ NG theo ngày', '{t("dashboard.ngTrendByDay")}');
  c = c.replace(/"Lọc theo công trạm"/g, 't("dashboard.filterByWorkstation")');
  c = c.replace(/"Lọc theo điểm đo"/g, 't("dashboard.filterByPoint")');
  c = c.replace(/"Nghiêm trọng"/g, 't("dashboard.severityCritical")');
  c = c.replace(/"Cao"/g, 't("dashboard.severityHigh")');
  c = c.replace(/"Trung bình"/g, 't("dashboard.severityMedium")');
  c = c.replace(/"Thấp"/g, 't("dashboard.severityLow")');

  // Status labels
  c = c.replace(/lineName: 'Chưa phân loại'/g, "lineName: t('dashboard.unclassified')");

  // NG time filters
  c = c.replace(/"Ngày"/g, 't("dashboard.day")');
  c = c.replace(/"Tuần"/g, 't("dashboard.week")');
  c = c.replace(/"Tháng"/g, 't("dashboard.month")');

  // Layout tab inline text
  c = c.replace(/dây chuyền • máy/g, '{t("dashboard.linesMachines")}');
  c = c.replace(/máy hoạt động/g, '{t("dashboard.machinesActive")}');

  // Sub-component MqttAlertWidget
  if (c.includes('function MqttAlertWidget()')) {
    c = c.replace(
      'function MqttAlertWidget() {',
      'function MqttAlertWidget() {\n  const { t } = useTranslation();'
    );
  }

  fs.writeFileSync(filePath, c, 'utf-8');
  console.log('✅ Dashboard.tsx processed');
}

// ============================================
// HISTORY
// ============================================
function processHistory() {
  const filePath = path.join(PAGES_DIR, 'History.tsx');
  let c = fs.readFileSync(filePath, 'utf-8');
  c = addImportAndHook(c, 'History');

  // DashboardLayout title
  c = c.replace(
    /title="AVI\/AOI Management"/g,
    'title={t("settings.title")}'
  );

  // Page header
  c = rTag(c, 'Lịch sử kiểm tra', '{t("history.title")}');
  c = rTag(c, 'Tìm kiếm và phân tích kết quả kiểm tra từ tất cả máy', '{t("history.subtitle")}');

  // Tab labels
  c = rTag(c, 'Danh sách', '{t("history.listTab")}');
  c = rTag(c, 'Infinite', '{t("history.infiniteTab")}');
  c = rTag(c, 'Yield Stats', '{t("history.yieldStatsTab")}');
  c = rTag(c, 'Phân tích', '{t("history.analysisTab")}');
  c = rTag(c, 'Công trạm', '{t("history.workstationTab")}');
  c = rTag(c, 'SPC', '{t("history.spcTab")}');
  c = rTag(c, 'AI Analysis', '{t("history.aiAnalysisTab")}');
  c = rTag(c, 'So sánh', '{t("history.comparisonTab")}');
  c = rTag(c, 'Gallery', '{t("history.galleryTab")}');

  // Search & filter
  c = rTag(c, 'Xuất Excel', '{t("history.exportExcelBtn")}');
  c = rAfterIcon(c, 'Xuất Excel', '{t("history.exportExcelBtn")}');
  c = rTag(c, 'Chọn tất cả', '{t("history.selectAllBtn")}');
  c = rTag(c, 'Đã chọn', '{t("history.selectedCount")}');

  // Analysis tab
  c = rTag(c, 'Tổng sản phẩm', '{t("history.totalProducts")}');
  c = rTag(c, 'Phân bố kết quả', '{t("history.resultDistribution")}');
  c = rTag(c, 'Xu hướng theo ngày', '{t("history.trendByDay")}');
  c = rTag(c, 'Thống kê theo máy', '{t("history.statsByMachine")}');
  c = rTag(c, 'Top Điểm Đo Lỗi Nhiều Nhất', '{t("history.topErrorPoints")}');
  c = rTag(c, 'Thống kê theo sản phẩm', '{t("history.statsByProduct")}');
  c = rTag(c, 'Phân tích theo Công trạm', '{t("history.workstationAnalysis")}');

  // SPC tab
  c = rTag(c, 'Statistical Process Control (SPC)', '{t("history.spcTitle")}');
  c = rTag(c, 'Control Chart - Yield Rate', '{t("history.controlChartYield")}');
  c = rTag(c, 'Histogram - Phân bố kết quả', '{t("history.histogramResults")}');
  c = rTag(c, 'Pareto Chart - Top lỗi', '{t("history.paretoTopErrors")}');
  c = c.replace(/name: "Số lượng"/g, 'name: t("history.quantity")');
  c = c.replace(/name: "Số lỗi NG"/g, 'name: t("history.ngErrorCount")');
  c = c.replace(/name: "Tích lũy %"/g, 'name: t("history.cumulativePercent")');

  // Cp/Cpk
  c = rTag(c, 'Đánh giá năng lực quá trình sản xuất', '{t("history.processCapabilityTitle")}');
  c = rTag(c, 'Giải thích:', '{t("history.processCapabilityExplanation")}');

  // Heatmap
  c = rTag(c, 'Heatmap - Phân bố NG theo điểm đo', '{t("history.heatmapTitle")}');
  c = rTag(c, 'Biểu đồ nhiệt thể hiện mật độ NG theo từng điểm đo', '{t("history.heatmapDescription")}');
  c = rTag(c, 'Ít NG', '{t("history.lowNg")}');
  c = rTag(c, 'Nhiều NG', '{t("history.highNg")}');
  c = rTag(c, 'Tổng hợp:', '{t("history.heatmapSummary")}');

  // Western Electric
  c = rTag(c, 'Phát hiện các điểm ngoài tầm kiểm soát', '{t("history.outOfControlPoints")}');
  c = rTag(c, 'Quá trình ổn định', '{t("history.processStable")}');
  c = rTag(c, 'Không phát hiện vi phạm quy tắc Western Electric', '{t("history.noWesternElectricViolation")}');

  // AI Analysis
  c = rTag(c, 'Phân tích AI', '{t("history.aiAnalysisTitle")}');
  c = rTag(c, 'Dự đoán xu hướng và phát hiện bất thường bằng machine learning', '{t("history.aiAnalysisDesc")}');
  c = rTag(c, 'Trung bình', '{t("history.mean")}');
  c = rTag(c, 'Độ lệch chuẩn', '{t("history.stdDev")}');
  c = rTag(c, 'Thấp nhất', '{t("history.lowest")}');
  c = rTag(c, 'Cao nhất', '{t("history.highest")}');
  c = rTag(c, 'Dự đoán xu hướng', '{t("history.trendPrediction")}');
  c = rTag(c, 'Dự đoán Yield', '{t("history.predictedYield")}');
  c = rTag(c, 'Phát hiện bất thường', '{t("history.anomalyDetection")}');
  c = rTag(c, 'Khuyến nghị cải thiện', '{t("history.improvementRecommendations")}');

  // Yield stats
  c = rTag(c, 'Thống kê Yield - FPY, FY, NTF, UPH', '{t("history.yieldStatsTitle")}');
  c = rTag(c, 'Xuất báo cáo', '{t("history.exportReport")}');
  c = rAfterIcon(c, 'Xuất báo cáo', '{t("history.exportReport")}');
  c = rTag(c, 'Xuất PDF', '{t("history.exportPdf")}');
  c = rTag(c, 'Xuất CSV', '{t("history.exportCsv")}');
  c = c.replace(/"Current First Pass Yield"/g, 't("history.currentFpy")');
  c = c.replace(/"Daily Fail Yield"/g, 't("history.dailyFailYield")');
  c = c.replace(/"Avg NTF Yield"/g, 't("history.avgNtfYield")');
  c = c.replace(/"Avg UPH"/g, 't("history.avgUph")');
  c = rTag(c, 'Bảng tổng hợp Yield theo ngày', '{t("history.yieldSummaryByDay")}');

  // Gallery tab
  c = rTag(c, 'Gallery Hình Ảnh Kiểm Tra', '{t("history.galleryTitle")}');
  c = rTag(c, 'Xem tất cả hình ảnh kiểm tra', '{t("history.galleryDesc")}');
  c = rTag(c, 'Hình ảnh điểm đo', '{t("history.measurementImages")}');
  c = rTag(c, 'Chưa có hình ảnh', '{t("history.noImagesYet")}');

  // Barcode search template literal
  c = c.replace(
    /toast\.success\(`Đã tìm kiếm: \$\{(\w+)\}`\)/g,
    'toast.success(t("history.searchedFor", { serialNumber: $1 }))'
  );

  // Per-page labels
  c = c.replace(/label: "(\d+)\/trang"/g, (_, num) => `label: "${num}" + t("history.perPage")`);

  fs.writeFileSync(filePath, c, 'utf-8');
  console.log('✅ History.tsx processed');
}

// ============================================
// SETTINGS
// ============================================
function processSettings() {
  const filePath = path.join(PAGES_DIR, 'Settings.tsx');
  let c = fs.readFileSync(filePath, 'utf-8');
  c = addImportAndHook(c, 'Settings');

  // DashboardLayout title (2 occurrences - admin check + main)
  c = c.replace(/title="AVI\/AOI Management"/g, 'title={t("settings.title")}');

  // Page header
  c = rTag(c, 'Cài đặt hệ thống', '{t("settings.systemSettings")}');
  c = rTag(c, 'Quản lý nhà máy, nhà xưởng, dây chuyền, công trạm và máy', '{t("settings.systemDescription")}');

  // Access denied
  c = rTag(c, 'Chỉ Admin mới có quyền truy cập', '{t("settings.adminOnlyAccess")}');
  c = rTag(c, 'Liên hệ quản trị viên để được cấp quyền', '{t("settings.contactAdmin")}');

  // Seed buttons (inline text after icon)
  c = rAfterIcon(c, 'Tạo dữ liệu mẫu', '{t("settings.seedData")}');
  c = rAfterIcon(c, 'Tạo 100 inspection', '{t("settings.seed100Inspections")}');

  // ===== SIDEBAR CATEGORY HEADERS (inside <span>) =====
  c = c.replace(/(>)\s*Dashboard Center\s*(<\/span>)/g, '$1{t("settings.cat.dashboardCenter")}$2');
  c = c.replace(/(>)\s*Cơ sở hạ tầng\s*(<\/span>)/g, '$1{t("settings.cat.infrastructure")}$2');
  c = c.replace(/(>)\s*Sản xuất\s*(<\/span>)/g, '$1{t("settings.cat.production")}$2');
  c = c.replace(/(>)\s*Sản phẩm\s*(<\/span>)/g, '$1{t("settings.cat.products")}$2');
  c = c.replace(/(>)\s*Chất lượng\s*(<\/span>)/g, '$1{t("settings.cat.quality")}$2');
  c = c.replace(/(>)\s*Hệ thống\s*(<\/span>)/g, '$1{t("settings.cat.system")}$2');

  // ===== SIDEBAR ITEMS (inline text after icon />)  =====
  // These appear as: <IconName className="h-4 w-4" />\n                      MenuText
  c = rAfterIcon(c, 'Custom Dashboard', '{t("settings.sidebar.customDashboard")}');
  c = rAfterIcon(c, 'Dashboard Templates', '{t("settings.sidebar.dashboardTemplates")}');
  c = rAfterIcon(c, 'Dashboard Marketplace', '{t("settings.sidebar.dashboardMarketplace")}');
  c = rAfterIcon(c, 'Nhà máy', '{t("settings.sidebar.factory")}');
  c = rAfterIcon(c, 'Nhà xưởng', '{t("settings.sidebar.workshop")}');
  c = rAfterIcon(c, 'Dây chuyền', '{t("settings.sidebar.line")}');
  c = rAfterIcon(c, 'Trạm kiểm tra', '{t("settings.sidebar.inspectionStation")}');
  c = rAfterIcon(c, 'Máy kiểm tra', '{t("settings.sidebar.inspectionMachine")}');
  c = rAfterIcon(c, 'Đăng ký & Mapping máy', '{t("settings.sidebar.registerMapping")}');
  c = rAfterIcon(c, 'Công trạm', '{t("settings.sidebar.workstation")}');
  c = rAfterIcon(c, 'Ca làm việc', '{t("settings.sidebar.shift")}');
  c = rAfterIcon(c, 'Công đoạn', '{t("settings.sidebar.stage")}');
  c = rAfterIcon(c, 'Danh mục sản phẩm', '{t("settings.sidebar.productCategory")}');
  c = rAfterIcon(c, 'Mẫu sản phẩm', '{t("settings.sidebar.productModel")}');
  c = rAfterIcon(c, 'Mapping sản phẩm', '{t("settings.sidebar.productMapping")}');
  c = rAfterIcon(c, 'Yield', '{t("settings.sidebar.yield")}');
  c = rAfterIcon(c, 'Cảnh báo', '{t("settings.sidebar.alert")}');
  c = rAfterIcon(c, 'Mẫu báo cáo', '{t("settings.sidebar.reportTemplate")}');
  c = rAfterIcon(c, 'Báo cáo tự động', '{t("settings.sidebar.scheduledReport")}');
  c = rAfterIcon(c, 'Cấu hình SMTP', '{t("settings.sidebar.smtpConfig")}');
  c = rAfterIcon(c, 'Email Template', '{t("settings.sidebar.emailTemplate")}');
  c = rAfterIcon(c, 'Audit Log', '{t("settings.sidebar.auditLog")}');
  c = rAfterIcon(c, 'Cache Statistics', '{t("settings.sidebar.cacheStats")}');
  c = rAfterIcon(c, 'Phân quyền dữ liệu', '{t("settings.sidebar.dataPermission")}');
  c = rAfterIcon(c, 'Phân quyền người dùng', '{t("settings.sidebar.userPermission")}');
  c = rAfterIcon(c, 'Quản lý vai trò', '{t("settings.sidebar.roleManagement")}');
  c = rAfterIcon(c, 'Backup & Restore', '{t("settings.sidebar.backupRestore")}');
  c = rAfterIcon(c, 'Webhook', '{t("settings.sidebar.webhook")}');
  c = rAfterIcon(c, 'Ngôn ngữ', '{t("settings.sidebar.language")}');

  // ===== FACTORY CRUD =====
  c = rTag(c, 'Danh sách nhà máy', '{t("settings.factoryList")}');
  c = rAfterIcon(c, 'Thêm nhà máy', '{t("settings.addFactory")}');
  c = rTag(c, 'Thêm nhà máy mới', '{t("settings.addFactoryNew")}');
  c = rTag(c, 'Chỉnh sửa nhà máy', '{t("settings.editFactory")}');
  c = rLabel(c, 'Mã nhà máy *', '{t("settings.factoryCode")} *');
  c = rLabel(c, 'Mã nhà máy', '{t("settings.factoryCode")}');
  c = rLabel(c, 'Tên nhà máy *', '{t("settings.factoryName")} *');
  c = rLabel(c, 'Tên nhà máy', '{t("settings.factoryName")}');
  c = rLabel(c, 'Địa chỉ', '{t("settings.address")}');
  c = rAttr(c, 'placeholder', 'Địa chỉ nhà máy', 't("settings.addressPlaceholder")');
  c = rTag(c, 'Chưa có nhà máy nào', '{t("settings.noFactory")}');

  // ===== WORKSHOP CRUD =====
  c = rTag(c, 'Danh sách nhà xưởng', '{t("settings.workshopList")}');
  c = rAfterIcon(c, 'Thêm nhà xưởng', '{t("settings.addWorkshop")}');
  c = rTag(c, 'Thêm nhà xưởng mới', '{t("settings.addWorkshopNew")}');
  c = rTag(c, 'Chỉnh sửa nhà xưởng', '{t("settings.editWorkshop")}');
  c = rLabel(c, 'Nhà máy *', '{t("dashboard.factory")} *');
  c = rLabel(c, 'Mã nhà xưởng *', '{t("settings.workshopCode")} *');
  c = rLabel(c, 'Mã nhà xưởng', '{t("settings.workshopCode")}');
  c = rLabel(c, 'Tên nhà xưởng *', '{t("settings.workshopName")} *');
  c = rLabel(c, 'Tên nhà xưởng', '{t("settings.workshopName")}');
  c = rAttr(c, 'placeholder', 'Chọn nhà máy', 't("settings.selectFactory")');
  c = rTag(c, 'Chưa có nhà xưởng nào', '{t("settings.noWorkshop")}');

  // ===== LINE CRUD =====
  c = rTag(c, 'Danh sách dây chuyền', '{t("settings.lineList")}');
  c = rAfterIcon(c, 'Thêm dây chuyền', '{t("settings.addLine")}');
  c = rTag(c, 'Thêm dây chuyền mới', '{t("settings.addLineNew")}');
  c = rTag(c, 'Chỉnh sửa dây chuyền', '{t("settings.editLine")}');
  c = rLabel(c, 'Nhà xưởng *', '{t("dashboard.workshop")} *');
  c = rLabel(c, 'Nhà xưởng', '{t("dashboard.workshop")}');
  c = rLabel(c, 'Mã dây chuyền *', '{t("settings.lineCode")} *');
  c = rLabel(c, 'Mã dây chuyền', '{t("settings.lineCode")}');
  c = rLabel(c, 'Tên dây chuyền *', '{t("settings.lineName")} *');
  c = rLabel(c, 'Tên dây chuyền', '{t("settings.lineName")}');
  c = rAttr(c, 'placeholder', 'Chọn nhà xưởng', 't("settings.selectWorkshop")');
  c = rTag(c, 'Chưa có dây chuyền nào', '{t("settings.noLine")}');

  // ===== STATION CRUD =====
  c = rTag(c, 'Danh sách công trạm', '{t("settings.stationList")}');
  c = rAfterIcon(c, 'Thêm công trạm', '{t("settings.addStation")}');
  c = rTag(c, 'Thêm công trạm mới', '{t("settings.addStationNew")}');
  c = rTag(c, 'Chỉnh sửa công trạm', '{t("settings.editStation")}');
  c = rLabel(c, 'Dây chuyền *', '{t("dashboard.line")} *');
  c = rLabel(c, 'Dây chuyền', '{t("dashboard.line")}');
  c = rLabel(c, 'Mã công trạm *', '{t("settings.stationCode")} *');
  c = rLabel(c, 'Mã công trạm', '{t("settings.stationCode")}');
  c = rLabel(c, 'Tên công trạm *', '{t("settings.stationName")} *');
  c = rLabel(c, 'Tên công trạm', '{t("settings.stationName")}');
  c = rLabel(c, 'Thứ tự', '{t("settings.order")}');
  c = rAttr(c, 'placeholder', 'Chọn dây chuyền', 't("settings.selectLine")');
  c = rTag(c, 'Chưa có công trạm nào', '{t("settings.noStation")}');
  c = c.replace(/Thứ tự:/g, '{t("settings.orderLabel")}');

  // ===== MACHINE CRUD =====
  c = rTag(c, 'Danh sách máy', '{t("settings.machineList")}');
  c = rAfterIcon(c, 'Thêm máy', '{t("settings.addMachine")}');
  c = rTag(c, 'Thêm máy mới', '{t("settings.addMachineNew")}');
  c = rTag(c, 'Sau khi tạo, hệ thống sẽ cấp API Key để máy gửi dữ liệu', '{t("settings.addMachineDesc")}');
  c = rTag(c, 'Chỉnh sửa máy', '{t("settings.editMachine")}');
  c = rLabel(c, 'Công trạm *', '{t("settings.sidebar.workstation")} *');
  c = rLabel(c, 'Công trạm', '{t("settings.sidebar.workstation")}');
  c = rLabel(c, 'Mã máy *', '{t("settings.machineCode")} *');
  c = rLabel(c, 'Mã máy', '{t("settings.machineCode")}');
  c = rLabel(c, 'Tên máy *', '{t("settings.machineName")} *');
  c = rLabel(c, 'Tên máy', '{t("settings.machineName")}');
  c = rLabel(c, 'Loại máy *', '{t("settings.machineType")} *');
  c = rLabel(c, 'Loại máy', '{t("settings.machineType")}');
  c = rLabel(c, 'Model', '{t("settings.model")}');
  c = rLabel(c, 'Nhà sản xuất', '{t("settings.manufacturer")}');
  c = rLabel(c, 'API Key', '{t("settings.apiKey")}');
  c = rAttr(c, 'placeholder', 'Model máy', 't("settings.modelPlaceholder")');
  c = rAttr(c, 'placeholder', 'Chọn công trạm', 't("settings.selectStation")');
  c = rTag(c, 'Chưa có máy nào', '{t("settings.noMachine")}');

  // ===== DELETE CONFIRMATIONS =====
  c = rTag(c, 'Xác nhận xóa', '{t("settings.confirmDelete")}');

  // ===== MACHINE REGISTRATION =====
  c = rTag(c, 'Quản lý đăng ký & Mapping máy', '{t("settings.machineRegistration")}');
  c = rAfterIcon(c, 'Đăng ký thủ công (API)', '{t("settings.manualRegistration")}');
  c = rAfterIcon(c, 'Đăng ký tự động (WebSocket)', '{t("settings.autoRegistration")}');
  c = rTag(c, 'Máy chờ duyệt', '{t("settings.pendingMachines")}');
  c = rTag(c, 'Không có máy nào chờ duyệt', '{t("settings.noPendingMachines")}');
  c = rAfterIcon(c, 'Làm mới', '{t("common.refresh")}');
  c = rAfterIcon(c, 'Duyệt', '{t("settings.approve")}');
  c = rAfterIcon(c, 'Từ chối', '{t("settings.reject")}');

  // Approve & Reject dialogs
  c = rTag(c, 'Duyệt & Mapping máy', '{t("settings.approveMapping")}');
  c = rTag(c, 'Từ chối đăng ký máy', '{t("settings.rejectRegistration")}');
  c = rLabel(c, 'Lý do từ chối (tùy chọn)', '{t("settings.rejectReason")}');
  c = rLabel(c, 'Mã máy (code)', '{t("settings.machineCodeLabel")}');
  c = rLabel(c, 'Tên hiển thị', '{t("settings.displayName")}');
  c = rLabel(c, 'Gán vào Công trạm', '{t("settings.assignStation")}');
  c = rAfterIcon(c, 'Duyệt & Cấp API Key', '{t("settings.approveAndGenerateKey")}');
  c = rAfterIcon(c, 'Xác nhận từ chối', '{t("settings.confirmReject")}');

  // MQTT section
  c = rTag(c, 'Quản lý MQTT Clients', '{t("settings.mqttClientsTitle")}');
  c = rTag(c, 'Đăng ký tự động (WebSocket)', '{t("settings.autoRegistrationWs")}');
  c = c.replace(/Đi đến MQTT Clients →/g, '{t("settings.goToMqttClients")}');
  c = rTag(c, 'Quy trình đăng ký thủ công', '{t("settings.manualProcess")}');
  c = rTag(c, 'Quy trình đăng ký tự động', '{t("settings.autoProcess")}');
  c = c.replace(/Đăng ký lúc:/g, '{t("settings.registeredAt")}');

  // ===== SHIFTS =====
  c = rTag(c, 'Cấu hình ca làm việc', '{t("settings.shiftConfig")}');
  c = rTag(c, 'Quản lý các ca làm việc trong hệ thống', '{t("settings.shiftConfigDesc")}');
  c = rAfterIcon(c, 'Thêm ca', '{t("settings.addShift")}');
  c = rTag(c, 'Thêm ca làm việc mới', '{t("settings.addShiftNew")}');
  c = rTag(c, 'Nhập thông tin ca làm việc', '{t("settings.addShiftDesc")}');
  c = rTag(c, 'Chỉnh sửa ca làm việc', '{t("settings.editShift")}');
  c = rLabelSpan(c, 'Mã ca ', 't("settings.shiftCode")');
  c = rLabelSpan(c, 'Tên ca ', 't("settings.shiftName")');
  c = rLabel(c, 'Mã ca', '{t("settings.shiftCode")}');
  c = rLabel(c, 'Tên ca', '{t("settings.shiftName")}');
  c = rLabel(c, 'Nhà máy (để trống = áp dụng toàn hệ thống)', '{t("settings.factoryOptional")}');
  c = rLabel(c, 'Giờ bắt đầu *', '{t("settings.startTime")} *');
  c = rLabel(c, 'Giờ bắt đầu', '{t("settings.startTime")}');
  c = rLabel(c, 'Giờ kết thúc *', '{t("settings.endTime")} *');
  c = rLabel(c, 'Giờ kết thúc', '{t("settings.endTime")}');
  c = rLabel(c, 'Thứ tự hiển thị', '{t("settings.orderDisplay")}');
  c = rAfterIcon(c, 'Tạo ca', '{t("settings.createShift")}');
  c = rTag(c, 'Hoạt động', '{t("settings.active")}');
  c = rTag(c, 'Tạm dừng', '{t("settings.paused")}');
  c = rTag(c, 'Chưa có ca làm việc nào. Hãy thêm ca mới.', '{t("settings.noShifts")}');

  // Shift table headers
  c = c.replace(/<th className="p-3 text-left font-medium">Mã<\/th>/g, '<th className="p-3 text-left font-medium">{t("settings.tableCode")}</th>');
  c = c.replace(/<th className="p-3 text-left font-medium">Tên ca<\/th>/g, '<th className="p-3 text-left font-medium">{t("settings.tableShiftName")}</th>');
  c = c.replace(/<th className="p-3 text-left font-medium">Nhà máy<\/th>/g, '<th className="p-3 text-left font-medium">{t("settings.tableFactory")}</th>');
  c = c.replace(/<th className="p-3 text-left font-medium">Thời gian<\/th>/g, '<th className="p-3 text-left font-medium">{t("settings.tableTime")}</th>');
  c = c.replace(/<th className="p-3 text-left font-medium">Trạng thái<\/th>/g, '<th className="p-3 text-left font-medium">{t("settings.tableStatus")}</th>');
  c = c.replace(/<th className="p-3 text-right font-medium">Thao tác<\/th>/g, '<th className="p-3 text-right font-medium">{t("settings.tableActions")}</th>');
  c = rTag(c, 'Toàn hệ thống', '{t("settings.entireSystem")}');

  // Dropdown menu items
  c = rAfterIcon(c, 'Chỉnh sửa', '{t("settings.edit")}');
  c = rAfterIcon(c, 'Xóa', '{t("common.delete")}');

  // ===== STAGES =====
  c = rTag(c, 'Công đoạn sản xuất', '{t("settings.productionStages")}');
  c = rAfterIcon(c, 'Thêm công đoạn', '{t("settings.addStage")}');
  c = rTag(c, 'Thêm công đoạn mới', '{t("settings.addStageNew")}');
  c = rTag(c, 'Tạo công đoạn mới cho dây chuyền sản xuất', '{t("settings.addStageDesc")}');
  c = rTag(c, 'Chỉnh sửa công đoạn', '{t("settings.editStage")}');
  c = rLabelSpan(c, 'Dây chuyền ', 't("dashboard.line")');
  c = rLabelSpan(c, 'Mã công đoạn ', 't("settings.stageCode")');
  c = rLabelSpan(c, 'Tên công đoạn ', 't("settings.stageName")');
  c = rLabel(c, 'Mã công đoạn', '{t("settings.stageCode")}');
  c = rLabel(c, 'Tên công đoạn', '{t("settings.stageName")}');
  c = rLabel(c, 'Trạm liên kết', '{t("settings.linkedStation")}');
  c = rAttr(c, 'placeholder', 'Chọn trạm', 't("settings.selectStation2")');
  c = rAttr(c, 'placeholder', 'Mô tả công đoạn', 't("settings.descriptionPlaceholder")');
  c = rAfterIcon(c, 'Tạo công đoạn', '{t("settings.createStage")}');
  c = rTag(c, 'Chưa có công đoạn nào. Hãy thêm công đoạn mới.', '{t("settings.noStages")}');

  // ===== ALERTS =====
  c = rTag(c, 'Cảnh báo ngưỡng chỉ số', '{t("settings.alertThreshold")}');
  c = rTag(c, 'Cấu hình cảnh báo khi FPY, FY hoặc NTFY xuống dưới ngưỡng', '{t("settings.alertThresholdDesc")}');
  c = rAfterIcon(c, 'Thêm cảnh báo', '{t("settings.addAlert")}');
  c = rTag(c, 'Tạo cảnh báo mới', '{t("settings.createAlert")}');
  c = rTag(c, 'Cấu hình cảnh báo khi chỉ số xuống dưới ngưỡng', '{t("settings.createAlertDesc")}');
  c = rTag(c, 'Chỉnh sửa cảnh báo', '{t("settings.editAlert")}');
  c = rLabelSpan(c, 'Tên cảnh báo ', 't("settings.alertName")');
  c = rLabel(c, 'Tên cảnh báo', '{t("settings.alertName")}');
  c = rLabel(c, 'Loại chỉ số *', '{t("settings.metricType")} *');
  c = rLabel(c, 'Điều kiện *', '{t("settings.condition")} *');
  c = rLabelSpan(c, 'Ngưỡng cảnh báo ', 't("settings.alertThresholdLabel")');
  c = rLabel(c, 'Ngưỡng cảnh báo', '{t("settings.alertThresholdLabel")}');
  c = rLabel(c, 'Nhà máy (để trống = tất cả)', '{t("settings.factoryOptionalAll")}');
  c = rLabel(c, 'Máy (để trống = tất cả)', '{t("settings.machineOptionalAll")}');
  c = rLabel(c, 'Thời gian chờ giữa các cảnh báo (phút)', '{t("settings.cooldownMinutes")}');
  c = rLabel(c, 'Thời gian chờ (phút)', '{t("settings.cooldownLabel")}');
  c = rTag(c, 'Gửi Email', '{t("settings.sendEmail")}');
  c = rTag(c, 'Thông báo trong app', '{t("settings.inAppNotification")}');
  c = rAfterIcon(c, 'Tạo cảnh báo', '{t("settings.createAlertBtn")}');
  c = rTag(c, 'Đang bật', '{t("settings.alertEnabled")}');
  c = rTag(c, 'Đã tắt', '{t("settings.alertDisabled")}');
  c = rTag(c, 'Chưa có cảnh báo nào', '{t("settings.noAlerts")}');
  c = rTag(c, 'Tạo cảnh báo để nhận thông báo khi chỉ số xuống dưới ngưỡng', '{t("settings.noAlertsDesc")}');

  // Alert select items
  c = rTag(c, 'FPY/FY/NTFY (%)', '{t("settings.yieldRate")}');
  c = rTag(c, 'Số lượng NG', '{t("settings.ngCount")}');
  c = rTag(c, 'Trạng thái máy', '{t("settings.machineStatus")}');
  c = c.replace(/>Nhỏ hơn \(&lt;\)</g, '>{t("settings.lessThan")}');
  c = c.replace(/>Nhỏ hơn hoặc bằng \(≤\)</g, '>{t("settings.lessOrEqual")}');
  c = c.replace(/>Lớn hơn \(&gt;\)</g, '>{t("settings.greaterThan")}');
  c = c.replace(/>Lớn hơn hoặc bằng \(≥\)</g, '>{t("settings.greaterOrEqual")}');
  c = c.replace(/>Bằng \(=\)</g, '>{t("settings.equalTo")}');

  // ===== PRODUCT MODELS TAB =====
  c = rTag(c, 'Mẫu sản phẩm', '{t("settings.productModels")}');
  c = rTag(c, 'Quản lý các mẫu sản phẩm', '{t("settings.productModelsDesc")}');
  c = rTag(c, 'Quản lý Mẫu sản phẩm', '{t("settings.manageProductModels")}');
  c = rTag(c, 'Quản lý các mẫu sản phẩm và điểm đo', '{t("settings.manageProductModelsDesc")}');
  c = rAfterIcon(c, 'Mở trang Mẫu sản phẩm', '{t("settings.openProductModelsPage")}');

  // Audit Log tab
  c = rTag(c, 'Audit Log', '{t("settings.auditLogTitle")}');
  c = rTag(c, 'Lịch sử thay đổi hệ thống', '{t("settings.auditLogDesc")}');

  // Machine image upload
  c = c.replace(/Ảnh máy \(cho Layout và Dashboard\)/g, '{t("settings.machineImage")}');
  c = rTag(c, 'Ảnh 2D', '{t("settings.image2D")}');
  c = rTag(c, 'Ảnh 3D', '{t("settings.image3D")}');
  c = rTag(c, 'Upload 2D', '{t("settings.upload2D")}');
  c = rTag(c, 'Upload 3D', '{t("settings.upload3D")}');
  c = c.replace(/Ảnh sẽ được hiển thị trong Layout và Dashboard\. Tối đa 5MB\./g, '{t("settings.imageNote")}');

  // Delete confirm dialogs
  c = c.replace(/itemType="ca làm việc"/g, 'itemType={t("settings.sidebar.shift")}');
  c = c.replace(/itemType="công đoạn"/g, 'itemType={t("settings.sidebar.stage")}');
  c = c.replace(/itemType="cảnh báo"/g, 'itemType={t("settings.sidebar.alert")}');
  c = c.replace(/itemType="máy"/g, 'itemType={t("settings.machineCount")}');

  // Common buttons (regex for whitespace across all occurrences)
  c = c.replace(/>\s*Hủy\s*<\/Button>/g, '>{t("common.cancel")}</Button>');
  c = c.replace(/>\s*Lưu\s*<\/Button>/g, '>{t("common.save")}</Button>');
  c = c.replace(/>\s*Xóa\s*<\/AlertDialogAction>/g, '>{t("common.delete")}</AlertDialogAction>');
  c = c.replace(/>\s*Hủy\s*<\/AlertDialogCancel>/g, '>{t("common.cancel")}</AlertDialogCancel>');
  // "Tạo" button text after loader icon
  c = c.replace(/(Loader2[^}]+\}\)}\s*\n\s+)Tạo(\s*\n\s+<\/Button>)/g, '$1{t("settings.create")}$2');

  fs.writeFileSync(filePath, c, 'utf-8');
  console.log('✅ Settings.tsx processed');
}

// ============================================
// UPDATE LOCALE FILES
// ============================================
function readJsonFile(filePath) {
  let raw = fs.readFileSync(filePath, 'utf-8');
  // Strip UTF-8 BOM if present
  if (raw.charCodeAt(0) === 0xFEFF) {
    raw = raw.slice(1);
  }
  return JSON.parse(raw);
}

function updateLocaleFiles() {
  const viPath = path.join(LOCALES_DIR, 'vi.json');
  const viData = readJsonFile(viPath);
  deepMerge(viData, newViKeys);
  fs.writeFileSync(viPath, JSON.stringify(viData, null, 2) + '\n', 'utf-8');
  console.log('✅ vi.json updated');

  const enPath = path.join(LOCALES_DIR, 'en.json');
  const enData = readJsonFile(enPath);
  deepMerge(enData, newEnKeys);
  fs.writeFileSync(enPath, JSON.stringify(enData, null, 2) + '\n', 'utf-8');
  console.log('✅ en.json updated');

  const zhPath = path.join(LOCALES_DIR, 'zh.json');
  if (fs.existsSync(zhPath)) {
    const zhData = readJsonFile(zhPath);
    deepMerge(zhData, newEnKeys);
    fs.writeFileSync(zhPath, JSON.stringify(zhData, null, 2) + '\n', 'utf-8');
    console.log('✅ zh.json updated (English fallback)');
  }
}

// ============================================
// MAIN
// ============================================
console.log('🔄 Starting i18n migration...\n');

try {
  processProductModels();
  processDashboard();
  processHistory();
  processSettings();
  updateLocaleFiles();
  
  console.log('\n✅ Migration completed!');
  console.log('\nManual review needed for:');
  console.log('  - Template literals with complex expressions');
  console.log('  - Dynamic strings with concatenation');
  console.log('  - Tooltip content');
  console.log('  - Placeholder text in forms');
} catch (error) {
  console.error('❌ Error:', error);
  process.exit(1);
}
