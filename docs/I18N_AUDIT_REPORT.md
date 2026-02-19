# i18n Audit Report — Hardcoded Strings

> Auto-generated audit of all hardcoded Vietnamese and English UI text strings across 28 page and component files.
> Each entry: `"Hardcoded string"` → suggested `translation.key`

---

## Table of Contents

1. [Login.tsx](#1-logintsx)
2. [Home.tsx](#2-hometsx)
3. [ChangePassword.tsx](#3-changepasswordtsx)
4. [SessionManagement.tsx](#4-sessionmanagementtsx)
5. [NotFound.tsx](#5-notfoundtsx)
6. [Dashboard.tsx](#6-dashboardtsx)
7. [History.tsx](#7-historytsx)
8. [Settings.tsx](#8-settingstsx)
9. [ProductModels.tsx](#9-productmodelstsx)
10. [Reports.tsx](#10-reportstsx)
11. [Layout.tsx](#11-layouttsx)
12. [MqttDashboard.tsx](#12-mqttdashboardtsx)
13. [Users.tsx](#13-userstsx)
14. [Alerts.tsx](#14-alertstsx)
15. [Profile.tsx](#15-profiletsx)
16. [AuditLogs.tsx](#16-auditlogstsx)
17. [CorporateDashboard.tsx](#17-corporatedashboardtsx)
18. [ProductionOrders.tsx](#18-productionorderstsx)
19. [InspectionDetail.tsx](#19-inspectiondetailtsx)
20. [ProcessManagement.tsx](#20-processmanagementtsx)
21. [RoleManagement.tsx](#21-rolemanagementtsx)
22. [PermissionsManagement.tsx](#22-permissionsmanagementtsx)
23. [SMTPConfig.tsx](#23-smtpconfigtsx)
24. [DashboardLayout.tsx](#24-dashboardlayouttsx)
25. [navigation.tsx](#25-navigationtsx)
26. [NotificationCenter.tsx](#26-notificationcentertsx)
27. [ConfirmDialog.tsx](#27-confirmdialogtsx)
28. [ErrorBoundary.tsx](#28-errorboundarytsx)

---

## 1. Login.tsx

| Hardcoded String | Suggested Key |
|---|---|
| `"Đăng nhập vào hệ thống"` | `login.title` |
| `"Vui lòng nhập tên đăng nhập và mật khẩu"` | `login.subtitle` |
| `"Tên đăng nhập"` | `login.username.label` |
| `"Nhập tên đăng nhập"` | `login.username.placeholder` |
| `"Mật khẩu"` | `login.password.label` |
| `"Nhập mật khẩu"` | `login.password.placeholder` |
| `"Ghi nhớ đăng nhập"` | `login.rememberMe` |
| `"Quên mật khẩu?"` | `login.forgotPassword` |
| `"Đăng nhập"` | `login.submit` |
| `"Đang đăng nhập..."` | `login.loading` |
| `"Hoặc đăng nhập bằng"` | `login.oauthDivider` |
| `"Google"` | `login.oauth.google` |
| `"GitHub"` | `login.oauth.github` |
| `"Chưa có tài khoản? Đăng ký"` | `login.registerLink` |
| `"Xác thực 2 bước"` | `login.twoFactor.title` |
| `"Nhập mã xác thực từ ứng dụng Authenticator"` | `login.twoFactor.subtitle` |
| `"Mã xác thực (6 số)"` | `login.twoFactor.codeLabel` |
| `"Nhập mã 6 số"` | `login.twoFactor.codePlaceholder` |
| `"Xác nhận"` | `login.twoFactor.confirm` |
| `"Đang xác thực..."` | `login.twoFactor.verifying` |
| `"Hoặc sử dụng mã backup"` | `login.twoFactor.useBackupCode` |
| `"Nhập mã backup"` | `login.twoFactor.backupPlaceholder` |
| `"Quay lại đăng nhập"` | `login.twoFactor.backToLogin` |
| `"Đăng nhập thành công"` | `login.toast.success` |
| `"Lỗi đăng nhập"` | `login.toast.error` |
| `"Xác thực 2FA thành công"` | `login.toast.twoFactorSuccess` |
| `"Mã xác thực không đúng"` | `login.toast.twoFactorError` |
| `"Hệ thống Quản lý AVI/AOI"` | `login.systemName` |
| `"Quản lý chất lượng sản xuất"` | `login.systemDescription` |

---

## 2. Home.tsx

| Hardcoded String | Suggested Key |
|---|---|
| `"Hệ thống quản lý chất lượng thông minh"` | `home.title` |
| `"Giám sát và phân tích chất lượng sản xuất theo thời gian thực"` | `home.subtitle` |
| `"Truy cập Dashboard"` | `home.ctaDashboard` |
| `"Tính năng nổi bật"` | `home.featuresTitle` |
| `"Giám sát thời gian thực"` | `home.feature.realtime.title` |
| `"Theo dõi trạng thái máy và kết quả kiểm tra liên tục"` | `home.feature.realtime.desc` |
| `"Phân tích AI"` | `home.feature.ai.title` |
| `"Dự đoán xu hướng và phát hiện bất thường"` | `home.feature.ai.desc` |
| `"Báo cáo tự động"` | `home.feature.reports.title` |
| `"Tạo báo cáo định kỳ PDF/Excel"` | `home.feature.reports.desc` |
| `"Quản lý sản phẩm"` | `home.feature.products.title` |
| `"Quản lý mẫu sản phẩm và điểm đo"` | `home.feature.products.desc` |
| `"Tổng sản phẩm"` | `home.stats.totalProducts` |
| `"Máy đang hoạt động"` | `home.stats.activeMachines` |
| `"Đã đăng nhập"` | `home.loggedIn` |
| `"Chào mừng"` | `home.welcome` |

---

## 3. ChangePassword.tsx

| Hardcoded String | Suggested Key |
|---|---|
| `"Đổi mật khẩu"` | `changePassword.title` |
| `"Thay đổi mật khẩu tài khoản"` | `changePassword.subtitle` |
| `"Mật khẩu hiện tại"` | `changePassword.currentPassword` |
| `"Mật khẩu mới"` | `changePassword.newPassword` |
| `"Xác nhận mật khẩu mới"` | `changePassword.confirmPassword` |
| `"Cập nhật mật khẩu"` | `changePassword.submit` |
| `"Đổi mật khẩu thành công!"` | `changePassword.toast.success` |
| `"Mật khẩu mới không khớp"` | `changePassword.toast.mismatch` |
| `"Mật khẩu phải có ít nhất 6 ký tự"` | `changePassword.toast.tooShort` |

---

## 4. SessionManagement.tsx

| Hardcoded String | Suggested Key |
|---|---|
| `"Quản lý phiên đăng nhập"` | `session.title` |
| `"Quản lý các phiên đăng nhập đang hoạt động"` | `session.subtitle` |
| `"Phiên hiện tại"` | `session.current` |
| `"Đăng xuất tất cả"` | `session.logoutAll` |
| `"Đăng xuất"` | `session.logout` |
| `"Thiết bị:"` | `session.device` |
| `"IP:"` | `session.ip` |
| `"Đăng nhập lúc:"` | `session.loginAt` |
| `"Hoạt động cuối:"` | `session.lastActive` |
| `"Đã đăng xuất phiên"` | `session.toast.loggedOut` |
| `"Đã đăng xuất tất cả phiên"` | `session.toast.loggedOutAll` |

---

## 5. NotFound.tsx

| Hardcoded String | Suggested Key |
|---|---|
| `"404"` | `notFound.code` |
| `"Page Not Found"` | `notFound.title` |
| `"The page you're looking for doesn't exist or has been moved."` | `notFound.description` |
| `"Go Home"` | `notFound.goHome` |

---

## 6. Dashboard.tsx

### Page & Filters
| Hardcoded String | Suggested Key |
|---|---|
| `"Production Dashboard"` | `dashboard.title` |
| `"Tất cả nhà máy"` | `dashboard.filter.allFactories` |
| `"Tất cả xưởng"` | `dashboard.filter.allWorkshops` |
| `"Tất cả dây chuyền"` | `dashboard.filter.allLines` |
| `"Tất cả máy"` | `dashboard.filter.allMachines` |
| `"Hôm nay"` | `dashboard.filter.today` |
| `"7 ngày"` | `dashboard.filter.sevenDays` |
| `"30 ngày"` | `dashboard.filter.thirtyDays` |
| `"Tùy chọn"` | `dashboard.filter.custom` |
| `"Từ ngày"` | `dashboard.filter.fromDate` |
| `"Đến ngày"` | `dashboard.filter.toDate` |
| `"Ca"` | `dashboard.filter.shift` |
| `"Tất cả ca"` | `dashboard.filter.allShifts` |

### Stats Cards
| Hardcoded String | Suggested Key |
|---|---|
| `"Tổng kiểm tra"` | `dashboard.stats.totalInspections` |
| `"OK"` | `dashboard.stats.ok` |
| `"NG"` | `dashboard.stats.ng` |
| `"NTF"` | `dashboard.stats.ntf` |
| `"Yield Rate"` | `dashboard.stats.yieldRate` |
| `"so với hôm qua"` | `dashboard.stats.vsYesterday` |

### Yield Alerts
| Hardcoded String | Suggested Key |
|---|---|
| `"Cảnh báo Yield"` | `dashboard.yieldAlert.title` |
| `"Yield dưới ngưỡng"` | `dashboard.yieldAlert.belowThreshold` |
| `"NG cao bất thường"` | `dashboard.yieldAlert.highNG` |

### Machine Status
| Hardcoded String | Suggested Key |
|---|---|
| `"Trạng thái máy"` | `dashboard.machineStatus.title` |
| `"Online"` | `dashboard.machineStatus.online` |
| `"Offline"` | `dashboard.machineStatus.offline` |
| `"Cảnh báo"` | `dashboard.machineStatus.warning` |
| `"Lỗi"` | `dashboard.machineStatus.error` |
| `"Bảo trì"` | `dashboard.machineStatus.maintenance` |
| `"Đang kiểm tra"` | `dashboard.machineStatus.inspecting` |
| `"Chờ"` | `dashboard.machineStatus.idle` |

### Tabs
| Hardcoded String | Suggested Key |
|---|---|
| `"Tổng quan"` | `dashboard.tab.overview` |
| `"Xu hướng"` | `dashboard.tab.trend` |
| `"Shift"` | `dashboard.tab.shift` |
| `"Layout"` | `dashboard.tab.layout` |

### Shift Stats
| Hardcoded String | Suggested Key |
|---|---|
| `"Thống kê theo ca"` | `dashboard.shift.title` |
| `"Ca sáng"` | `dashboard.shift.morning` |
| `"Ca chiều"` | `dashboard.shift.afternoon` |
| `"Ca đêm"` | `dashboard.shift.night` |
| `"Sản lượng"` | `dashboard.shift.production` |

### Rankings
| Hardcoded String | Suggested Key |
|---|---|
| `"Top Yield cao nhất"` | `dashboard.ranking.topYield` |
| `"Top NG nhiều nhất"` | `dashboard.ranking.topNG` |

### Trend Charts
| Hardcoded String | Suggested Key |
|---|---|
| `"Xu hướng Yield Rate"` | `dashboard.trend.yieldRate` |
| `"Phân bố kết quả"` | `dashboard.trend.distribution` |
| `"Xu hướng theo giờ"` | `dashboard.trend.hourly` |

### NG Visual
| Hardcoded String | Suggested Key |
|---|---|
| `"Phân tích NG trực quan"` | `dashboard.ngVisual.title` |
| `"Hiển thị phân bố lỗi NG trên Layout sản phẩm"` | `dashboard.ngVisual.subtitle` |
| `"Chọn sản phẩm"` | `dashboard.ngVisual.selectProduct` |
| `"Heatmap NG"` | `dashboard.ngVisual.heatmap` |
| `"Top Lỗi"` | `dashboard.ngVisual.topDefects` |
| `"Chưa có sản phẩm"` | `dashboard.ngVisual.noProducts` |
| `"Chưa có dữ liệu NG"` | `dashboard.ngVisual.noData` |

### Layout Tab
| Hardcoded String | Suggested Key |
|---|---|
| `"Sơ đồ nhà máy"` | `dashboard.layout.factoryMap` |
| `"Chọn layout"` | `dashboard.layout.selectLayout` |
| `"Chưa có layout"` | `dashboard.layout.noLayout` |
| `"Chưa có sơ đồ nhà máy nào."` | `dashboard.layout.noLayoutDesc` |

### Machine Detail Modal
| Hardcoded String | Suggested Key |
|---|---|
| `"Chi tiết máy"` | `dashboard.machineDetail.title` |
| `"Thông tin máy"` | `dashboard.machineDetail.info` |
| `"Mã máy:"` | `dashboard.machineDetail.code` |
| `"Loại:"` | `dashboard.machineDetail.type` |
| `"Model:"` | `dashboard.machineDetail.model` |
| `"Trạng thái:"` | `dashboard.machineDetail.status` |
| `"Sản phẩm đã xử lý"` | `dashboard.machineDetail.processedProducts` |
| `"Tỉ lệ OK"` | `dashboard.machineDetail.okRate` |
| `"Tỉ lệ NG"` | `dashboard.machineDetail.ngRate` |
| `"Hoạt động gần đây"` | `dashboard.machineDetail.recentActivity` |

### Metrics Settings Dialog
| Hardcoded String | Suggested Key |
|---|---|
| `"Tùy chỉnh chỉ số hiển thị"` | `dashboard.metricsSettings.title` |
| `"Chọn các chỉ số muốn hiển thị trên Dashboard"` | `dashboard.metricsSettings.subtitle` |
| `"Hiển thị trên Dashboard"` | `dashboard.metricsSettings.showOnDashboard` |
| `"Áp dụng"` | `dashboard.metricsSettings.apply` |

### Workstation Drilldown
| Hardcoded String | Suggested Key |
|---|---|
| `"Phân tích theo công trạm"` | `dashboard.workstation.title` |
| `"Chi tiết"` | `dashboard.workstation.detail` |
| `"Sản lượng"` | `dashboard.workstation.production` |

### MQTT Alert Widget
| Hardcoded String | Suggested Key |
|---|---|
| `"MQTT Alert Widget"` | `dashboard.mqttAlert.title` |
| `"Real-time Machine Alerts"` | `dashboard.mqttAlert.subtitle` |
| `"Connected"` | `dashboard.mqttAlert.connected` |
| `"Disconnected"` | `dashboard.mqttAlert.disconnected` |
| `"Connecting..."` | `dashboard.mqttAlert.connecting` |
| `"No alerts received yet"` | `dashboard.mqttAlert.noAlerts` |
| `"Waiting for MQTT messages..."` | `dashboard.mqttAlert.waiting` |

---

## 7. History.tsx

### Page Title & Actions
| Hardcoded String | Suggested Key |
|---|---|
| `"Lịch sử kiểm tra"` | `history.title` |
| `"Xuất Excel"` | `history.exportExcel` |
| `"Xuất PDF"` | `history.exportPdf` |
| `"In"` | `history.print` |
| `"Quét Barcode"` | `history.scanBarcode` |
| `"Đã tìm kiếm:"` | `history.searched` |

### Filters
| Hardcoded String | Suggested Key |
|---|---|
| `"Tìm theo serial, model..."` | `history.filter.searchPlaceholder` |
| `"Tất cả kết quả"` | `history.filter.allResults` |
| `"Tất cả máy"` | `history.filter.allMachines` |
| `"Tất cả loại"` | `history.filter.allTypes` |
| `"Tất cả"` | `history.filter.all` |

### Tabs
| Hardcoded String | Suggested Key |
|---|---|
| `"Danh sách"` | `history.tab.list` |
| `"Phân tích"` | `history.tab.analysis` |
| `"Workstation"` | `history.tab.workstation` |
| `"SPC"` | `history.tab.spc` |
| `"AI"` | `history.tab.ai` |
| `"Yield Stats"` | `history.tab.yieldStats` |
| `"So sánh"` | `history.tab.compare` |
| `"Gallery"` | `history.tab.gallery` |

### List Tab — Column Settings
| Hardcoded String | Suggested Key |
|---|---|
| `"Cài đặt cột hiển thị"` | `history.list.columnSettings` |
| `"Chọn các cột muốn hiển thị trong bảng"` | `history.list.columnSettingsDesc` |
| `"Serial Number"` | `history.list.col.serialNumber` |
| `"Ngày kiểm tra"` | `history.list.col.inspectionDate` |
| `"Kết quả"` | `history.list.col.result` |
| `"Máy kiểm tra"` | `history.list.col.machine` |
| `"Model sản phẩm"` | `history.list.col.productModel` |
| `"Loại kiểm tra"` | `history.list.col.inspectionType` |
| `"Công đoạn"` | `history.list.col.stage` |
| `"Dây chuyền"` | `history.list.col.line` |
| `"Ca sản xuất"` | `history.list.col.shift` |
| `"Thời gian (ms)"` | `history.list.col.duration` |
| `"Ghi chú"` | `history.list.col.remark` |
| `"Chi tiết"` | `history.list.detail` |

### List Tab — Pagination
| Hardcoded String | Suggested Key |
|---|---|
| `"Trang"` | `history.list.page` |
| `"Hiển thị"` | `history.list.showing` |
| `"kết quả"` | `history.list.results` |
| `"mục/trang"` | `history.list.perPage` |

### List Tab — Empty
| Hardcoded String | Suggested Key |
|---|---|
| `"Không tìm thấy kết quả"` | `history.list.noResults` |
| `"Thử thay đổi bộ lọc để xem kết quả khác"` | `history.list.noResultsHint` |

### PDF Export Headers
| Hardcoded String | Suggested Key |
|---|---|
| `"BÁO CÁO LỊCH SỬ KIỂM TRA"` | `history.pdf.title` |
| `"Ngày xuất:"` | `history.pdf.exportDate` |
| `"Bộ lọc áp dụng:"` | `history.pdf.filtersApplied` |
| `"STT"` | `history.pdf.col.no` |
| `"Ngày"` | `history.pdf.col.date` |
| `"Tóm tắt"` | `history.pdf.summary` |
| `"Tổng số bản ghi:"` | `history.pdf.totalRecords` |
| `"Tổng OK:"` | `history.pdf.totalOk` |
| `"Tổng NG:"` | `history.pdf.totalNg` |
| `"Tỷ lệ Yield:"` | `history.pdf.yieldRate` |

### Analysis Tab
| Hardcoded String | Suggested Key |
|---|---|
| `"Tổng sản phẩm"` | `history.analysis.totalProducts` |
| `"Phân bố kết quả"` | `history.analysis.distribution` |
| `"Xu hướng theo ngày"` | `history.analysis.dailyTrend` |
| `"Thống kê theo máy"` | `history.analysis.byMachine` |
| `"Máy"` | `history.analysis.machine` |
| `"Tổng"` | `history.analysis.total` |
| `"Yield Rate"` | `history.analysis.yieldRate` |
| `"Tải thêm dữ liệu"` | `history.analysis.loadMore` |
| `"Top Điểm Đo Lỗi Nhiều Nhất"` | `history.analysis.topDefectPoints` |
| `"Những điểm đo có tỷ lệ NG cao nhất cần ưu tiên cải thiện"` | `history.analysis.topDefectPointsDesc` |
| `"Thống kê theo sản phẩm"` | `history.analysis.byProduct` |
| `"Model sản phẩm"` | `history.analysis.productModel` |
| `"Không có dữ liệu để phân tích"` | `history.analysis.noData` |
| `"Thử tìm kiếm với bộ lọc khác"` | `history.analysis.noDataHint` |

### Workstation Tab
| Hardcoded String | Suggested Key |
|---|---|
| `"Phân tích theo Công trạm"` | `history.workstation.title` |
| `"Thống kê lỗi theo công trạm sản xuất và điểm đo để xác định nguyên nhân lỗi"` | `history.workstation.subtitle` |
| `"Bộ lọc theo thời gian"` | `history.workstation.timeFilter` |
| `"Xuất báo cáo"` | `history.workstation.exportReport` |
| `"Tất cả"` | `history.workstation.all` |
| `"Hôm nay"` | `history.workstation.today` |
| `"Tuần này"` | `history.workstation.thisWeek` |
| `"Tháng này"` | `history.workstation.thisMonth` |
| `"Từ ngày"` | `history.workstation.fromDate` |
| `"Đến ngày"` | `history.workstation.toDate` |
| `"Tóm tắt theo Công trạm"` | `history.workstation.summary` |
| `"Danh sách các công trạm sản xuất và thống kê lỗi"` | `history.workstation.summaryDesc` |
| `"Mã:"` | `history.workstation.code` |
| `"Yield"` | `history.workstation.yield` |
| `"Lỗi theo Công trạm"` | `history.workstation.defectsByStation` |
| `"Top 10 Điểm đo có lỗi cao nhất"` | `history.workstation.topDefectPoints` |
| `"Các điểm đo cần ưu tiên cải thiện"` | `history.workstation.topDefectPointsDesc` |
| `"Chưa có dữ liệu điểm đo"` | `history.workstation.noPointData` |
| `"Dữ liệu sẽ hiển thị khi có kết quả kiểm tra từ các điểm đo"` | `history.workstation.noPointDataDesc` |
| `"Điểm đo theo Công trạm"` | `history.workstation.pointsByStation` |
| `"Công trạm"` | `history.workstation.station` |
| `"Mã"` | `history.workstation.pointCode` |
| `"Số điểm đo"` | `history.workstation.pointCount` |
| `"Chưa có dữ liệu công trạm"` | `history.workstation.noStationData` |
| `"Dữ liệu sẽ hiển thị khi có kết quả kiểm tra từ các điểm đo được gán công trạm"` | `history.workstation.noStationDataDesc` |

### SPC Tab
| Hardcoded String | Suggested Key |
|---|---|
| `"Statistical Process Control (SPC)"` | `history.spc.title` |
| `"Phân tích thống kê quá trình sản xuất - Control Charts, Histogram, Pareto"` | `history.spc.subtitle` |
| `"Control Chart - Yield Rate"` | `history.spc.controlChart.title` |
| `"Biểu đồ kiểm soát Yield Rate theo ngày với UCL, CL, LCL"` | `history.spc.controlChart.desc` |
| `"UCL (Upper Control Limit)"` | `history.spc.ucl` |
| `"CL (Center Line)"` | `history.spc.cl` |
| `"LCL (Lower Control Limit)"` | `history.spc.lcl` |
| `"Histogram - Phân bố kết quả"` | `history.spc.histogram.title` |
| `"Số lượng"` | `history.spc.histogram.count` |
| `"Pareto Chart - Top lỗi"` | `history.spc.pareto.title` |
| `"Số lỗi NG"` | `history.spc.pareto.ngCount` |
| `"Tích lũy %"` | `history.spc.pareto.cumulative` |
| `"Process Capability - Cp/Cpk"` | `history.spc.capability.title` |
| `"Đánh giá năng lực quá trình sản xuất"` | `history.spc.capability.desc` |
| `"Mean (μ)"` | `history.spc.capability.mean` |
| `"Std Dev (σ)"` | `history.spc.capability.stdDev` |
| `"Excellent"` | `history.spc.capability.excellent` |
| `"Capable"` | `history.spc.capability.capable` |
| `"Not Capable"` | `history.spc.capability.notCapable` |
| `"Giải thích: Cp đo lường khả năng tiềm năng của quá trình..."` | `history.spc.capability.explanation` |
| `"Heatmap - Phân bố NG theo điểm đo"` | `history.spc.heatmap.title` |
| `"Biểu đồ nhiệt thể hiện mật độ lỗi theo từng điểm đo"` | `history.spc.heatmap.desc` |
| `"Ít NG"` | `history.spc.heatmap.low` |
| `"Nhiều NG"` | `history.spc.heatmap.high` |
| `"Tổng hợp: Hiển thị top X điểm đo..."` | `history.spc.heatmap.summary` |
| `"Western Electric Rules - Cảnh báo"` | `history.spc.westernElectric.title` |
| `"Phát hiện các điểm ngoài tầm kiểm soát"` | `history.spc.westernElectric.desc` |
| `"X điểm vượt quá 3σ - Cần kiểm tra ngay"` | `history.spc.westernElectric.rule1` |
| `"2 trong 3 điểm liên tiếp vượt 2σ"` | `history.spc.westernElectric.rule2` |
| `"4 trong 5 điểm liên tiếp vượt 1σ"` | `history.spc.westernElectric.rule3` |
| `"8 điểm liên tiếp cùng phía với đường tâm"` | `history.spc.westernElectric.rule4` |
| `"Quá trình ổn định"` | `history.spc.westernElectric.stable` |
| `"Không phát hiện vi phạm quy tắc Western Electric"` | `history.spc.westernElectric.stableDesc` |
| `"Không có dữ liệu để phân tích SPC"` | `history.spc.noData` |
| `"Thử tìm kiếm với bộ lọc khác"` | `history.spc.noDataHint` |

### AI Analysis Tab
| Hardcoded String | Suggested Key |
|---|---|
| `"Phân tích AI"` | `history.ai.title` |
| `"Dự đoán xu hướng và phát hiện bất thường bằng machine learning"` | `history.ai.subtitle` |
| `"Trung bình"` | `history.ai.mean` |
| `"Độ lệch chuẩn"` | `history.ai.stdDev` |
| `"Thấp nhất"` | `history.ai.min` |
| `"Cao nhất"` | `history.ai.max` |
| `"Hiện tại"` | `history.ai.current` |
| `"Dự đoán xu hướng"` | `history.ai.trendPrediction` |
| `"Tăng"` | `history.ai.trend.up` |
| `"Giảm"` | `history.ai.trend.down` |
| `"Ổn định"` | `history.ai.trend.stable` |
| `"Dự đoán Yield Rate cho 7 ngày tới (Linear Regression, độ tin cậy: X%)"` | `history.ai.trendDesc` |
| `"Dự đoán Yield"` | `history.ai.predictedYield` |
| `"Phát hiện bất thường"` | `history.ai.anomalyDetection` |
| `"Các ngày có Yield Rate bất thường (vượt 2σ)"` | `history.ai.anomalyDesc` |
| `"so với TB"` | `history.ai.vsAvg` |
| `"Nghiêm trọng"` | `history.ai.critical` |
| `"Cảnh báo"` | `history.ai.warning` |
| `"Khuyến nghị cải thiện"` | `history.ai.recommendations` |
| `"Không có dữ liệu để phân tích AI"` | `history.ai.noData` |
| `"Cần tối thiểu 3 ngày dữ liệu để dự đoán xu hướng"` | `history.ai.noDataHint` |

### Yield Stats Tab
| Hardcoded String | Suggested Key |
|---|---|
| `"Thống kê Yield - FPY, FY, NTF, UPH"` | `history.yieldStats.title` |
| `"Biểu đồ và chỉ số hiệu suất sản xuất theo thời gian"` | `history.yieldStats.subtitle` |
| `"Xuất báo cáo"` | `history.yieldStats.exportReport` |
| `"Xuất PDF"` | `history.yieldStats.exportPdf` |
| `"Xuất Excel"` | `history.yieldStats.exportExcel` |
| `"Xuất CSV"` | `history.yieldStats.exportCsv` |
| `"Current First Pass Yield"` | `history.yieldStats.kpi.fpy` |
| `"Daily Fail Yield"` | `history.yieldStats.kpi.fy` |
| `"Avg NTF Yield"` | `history.yieldStats.kpi.ntf` |
| `"Avg UPH"` | `history.yieldStats.kpi.uph` |
| `"Target: >98.50%"` | `history.yieldStats.kpi.fpyTarget` |
| `"Threshold: < 1.50%"` | `history.yieldStats.kpi.fyThreshold` |
| `"Target: < 1.00%"` | `history.yieldStats.kpi.ntfTarget` |
| `"Capacity: 1,500/hr"` | `history.yieldStats.kpi.uphCapacity` |
| `"NTF (No Trouble Found) Yield"` | `history.yieldStats.ntfChart.title` |
| `"Re-test pass rates (Scale: 0.5% - 2.0%)"` | `history.yieldStats.ntfChart.desc` |
| `"UPH (Units Per Hour) Trend"` | `history.yieldStats.uphChart.title` |
| `"Hourly throughput volume per day"` | `history.yieldStats.uphChart.desc` |
| `"Fail Rate"` | `history.yieldStats.failRate` |
| `"NTF Rate"` | `history.yieldStats.ntfRate` |
| `"Bảng tổng hợp Yield theo ngày"` | `history.yieldStats.table.title` |
| `"Ngày"` | `history.yieldStats.table.date` |
| `"Tổng"` | `history.yieldStats.table.total` |
| `"FPY"` | `history.yieldStats.table.fpy` |
| `"Không có dữ liệu để thống kê Yield"` | `history.yieldStats.noData` |
| `"Thử tìm kiếm với bộ lọc khác"` | `history.yieldStats.noDataHint` |

### Gallery Tab
| Hardcoded String | Suggested Key |
|---|---|
| `"Gallery Hình Ảnh Kiểm Tra"` | `history.gallery.title` |
| `"Xem tất cả hình ảnh từ các điểm đo trong kết quả kiểm tra"` | `history.gallery.subtitle` |
| `"Điểm"` | `history.gallery.point` |
| `"Điểm đo"` | `history.gallery.measurementPoint` |
| `"Hình ảnh điểm đo"` | `history.gallery.imageTitle` |
| `"Chưa có hình ảnh"` | `history.gallery.noImages` |
| `"Không có hình ảnh nào trong kết quả tìm kiếm hiện tại"` | `history.gallery.noImagesDesc` |

---

## 8. Settings.tsx

### Page & Sidebar
| Hardcoded String | Suggested Key |
|---|---|
| `"Cài đặt hệ thống"` | `settings.title` |
| `"Cơ sở hạ tầng"` | `settings.category.infrastructure` |
| `"Nhà máy"` | `settings.sidebar.factories` |
| `"Nhà xưởng"` | `settings.sidebar.workshops` |
| `"Dây chuyền"` | `settings.sidebar.lines` |
| `"Trạm kiểm tra"` | `settings.sidebar.stations` |
| `"Máy kiểm tra"` | `settings.sidebar.machines` |
| `"Đăng ký & Mapping máy"` | `settings.sidebar.machineRegistration` |
| `"Công trạm"` | `settings.sidebar.workstations` |
| `"Sản xuất"` | `settings.category.production` |
| `"Ca làm việc"` | `settings.sidebar.shifts` |
| `"Công đoạn"` | `settings.sidebar.stages` |
| `"Sản phẩm"` | `settings.category.products` |
| `"Danh mục sản phẩm"` | `settings.sidebar.productCategories` |
| `"Mẫu sản phẩm"` | `settings.sidebar.productModels` |
| `"Mapping sản phẩm"` | `settings.sidebar.productMapping` |
| `"Chất lượng"` | `settings.category.quality` |
| `"Yield"` | `settings.sidebar.yield` |
| `"Cảnh báo"` | `settings.sidebar.alerts` |
| `"Hệ thống"` | `settings.category.system` |
| `"Mẫu báo cáo"` | `settings.sidebar.reportTemplates` |
| `"Báo cáo tự động"` | `settings.sidebar.scheduledReports` |
| `"Cấu hình SMTP"` | `settings.sidebar.smtpConfig` |
| `"Email Template"` | `settings.sidebar.emailTemplate` |
| `"Audit Log"` | `settings.sidebar.auditLog` |
| `"Cache Statistics"` | `settings.sidebar.cacheStats` |
| `"Phân quyền dữ liệu"` | `settings.sidebar.userAssignments` |
| `"Phân quyền người dùng"` | `settings.sidebar.permissions` |
| `"Quản lý vai trò"` | `settings.sidebar.roles` |
| `"Backup & Restore"` | `settings.sidebar.backupRestore` |
| `"Webhook"` | `settings.sidebar.webhook` |
| `"Ngôn ngữ"` | `settings.sidebar.language` |

### Factories Tab
| Hardcoded String | Suggested Key |
|---|---|
| `"Danh sách nhà máy"` | `settings.factory.title` |
| `"Thêm nhà máy"` | `settings.factory.add` |
| `"Thêm nhà máy mới"` | `settings.factory.addTitle` |
| `"Mã nhà máy *"` | `settings.factory.code` |
| `"VD: FAC001"` | `settings.factory.codePlaceholder` |
| `"Tên nhà máy *"` | `settings.factory.name` |
| `"VD: Nhà máy Bắc Ninh"` | `settings.factory.namePlaceholder` |
| `"Địa chỉ"` | `settings.factory.address` |
| `"Địa chỉ nhà máy"` | `settings.factory.addressPlaceholder` |
| `"Hủy"` | `common.cancel` |
| `"Tạo"` | `common.create` |
| `"Xác nhận xóa"` | `common.deleteConfirm` |
| `"Bạn có chắc muốn xóa nhà máy"` | `settings.factory.deleteConfirmMsg` |
| `"Xóa"` | `common.delete` |
| `"Chưa có nhà máy nào"` | `settings.factory.empty` |
| `"Chỉnh sửa nhà máy"` | `settings.factory.editTitle` |

### Workshops Tab
| Hardcoded String | Suggested Key |
|---|---|
| `"Danh sách nhà xưởng"` | `settings.workshop.title` |
| `"Thêm nhà xưởng"` | `settings.workshop.add` |
| `"Thêm nhà xưởng mới"` | `settings.workshop.addTitle` |
| `"Nhà máy *"` | `settings.workshop.factory` |
| `"Chọn nhà máy"` | `settings.workshop.factoryPlaceholder` |
| `"Mã nhà xưởng *"` | `settings.workshop.code` |
| `"VD: WS001"` | `settings.workshop.codePlaceholder` |
| `"Tên nhà xưởng *"` | `settings.workshop.name` |
| `"VD: Xưởng lắp ráp A"` | `settings.workshop.namePlaceholder` |
| `"Bạn có chắc muốn xóa nhà xưởng"` | `settings.workshop.deleteConfirmMsg` |
| `"Chưa có nhà xưởng nào"` | `settings.workshop.empty` |
| `"Chỉnh sửa nhà xưởng"` | `settings.workshop.editTitle` |

### Lines Tab
| Hardcoded String | Suggested Key |
|---|---|
| `"Danh sách dây chuyền"` | `settings.line.title` |
| `"Thêm dây chuyền"` | `settings.line.add` |
| `"Thêm dây chuyền mới"` | `settings.line.addTitle` |
| `"Nhà xưởng *"` | `settings.line.workshop` |
| `"Chọn nhà xưởng"` | `settings.line.workshopPlaceholder` |
| `"Mã dây chuyền *"` | `settings.line.code` |
| `"VD: LINE001"` | `settings.line.codePlaceholder` |
| `"Tên dây chuyền *"` | `settings.line.name` |
| `"VD: Dây chuyền SMT 1"` | `settings.line.namePlaceholder` |
| `"Bạn có chắc muốn xóa dây chuyền"` | `settings.line.deleteConfirmMsg` |
| `"Chưa có dây chuyền nào"` | `settings.line.empty` |
| `"Chỉnh sửa dây chuyền"` | `settings.line.editTitle` |

### Stations Tab
| Hardcoded String | Suggested Key |
|---|---|
| `"Danh sách công trạm"` | `settings.station.title` |
| `"Thêm công trạm"` | `settings.station.add` |
| `"Thêm công trạm mới"` | `settings.station.addTitle` |
| `"Dây chuyền *"` | `settings.station.line` |
| `"Chọn dây chuyền"` | `settings.station.linePlaceholder` |
| `"Mã công trạm *"` | `settings.station.code` |
| `"VD: ST001"` | `settings.station.codePlaceholder` |
| `"Tên công trạm *"` | `settings.station.name` |
| `"VD: Trạm kiểm tra AOI"` | `settings.station.namePlaceholder` |
| `"Thứ tự"` | `settings.station.orderIndex` |
| `"Bạn có chắc muốn xóa công trạm"` | `settings.station.deleteConfirmMsg` |
| `"Chưa có công trạm nào"` | `settings.station.empty` |
| `"Thứ tự:"` | `settings.station.order` |
| `"Chỉnh sửa công trạm"` | `settings.station.editTitle` |

### Machines Tab
| Hardcoded String | Suggested Key |
|---|---|
| `"Danh sách máy"` | `settings.machine.title` |
| `"Thêm máy"` | `settings.machine.add` |
| `"Thêm máy mới"` | `settings.machine.addTitle` |
| `"Sau khi tạo, hệ thống sẽ cấp API Key để máy gửi dữ liệu"` | `settings.machine.addDesc` |
| `"Công trạm *"` | `settings.machine.station` |
| `"Chọn công trạm"` | `settings.machine.stationPlaceholder` |
| `"Mã máy *"` | `settings.machine.code` |
| `"VD: AVI001"` | `settings.machine.codePlaceholder` |
| `"Tên máy *"` | `settings.machine.name` |
| `"VD: Máy AVI kiểm tra PCB"` | `settings.machine.namePlaceholder` |
| `"Loại máy *"` | `settings.machine.type` |
| `"Model"` | `settings.machine.model` |
| `"Model máy"` | `settings.machine.modelPlaceholder` |
| `"Nhà sản xuất"` | `settings.machine.manufacturer` |
| `"Copy API Key"` | `settings.machine.copyApiKey` |
| `"Chưa có máy nào"` | `settings.machine.empty` |
| `"Chỉnh sửa máy"` | `settings.machine.editTitle` |
| `"API Key"` | `settings.machine.apiKey` |
| `"Ảnh máy (cho Layout và Dashboard)"` | `settings.machine.imageLabel` |
| `"Ảnh 2D"` | `settings.machine.image2d` |
| `"Ảnh 3D"` | `settings.machine.image3d` |
| `"Upload 2D"` | `settings.machine.upload2d` |
| `"Upload 3D"` | `settings.machine.upload3d` |
| `"Ảnh sẽ được hiển thị trong Layout và Dashboard. Tối đa 5MB."` | `settings.machine.imageNote` |

### Machine Registration Tab
| Hardcoded String | Suggested Key |
|---|---|
| `"Quản lý đăng ký & Mapping máy"` | `settings.machineReg.title` |
| `"Đăng ký thủ công (API)"` | `settings.machineReg.manualTab` |
| `"Đăng ký tự động (WebSocket)"` | `settings.machineReg.autoTab` |
| `"Máy chờ duyệt"` | `settings.machineReg.pending` |
| `"X máy đang chờ phê duyệt — Các máy AOI/AVI tự đăng ký qua API sẽ hiển thị ở đây"` | `settings.machineReg.pendingDesc` |
| `"Làm mới"` | `settings.machineReg.refresh` |
| `"Duyệt"` | `settings.machineReg.approve` |
| `"Từ chối"` | `settings.machineReg.reject` |
| `"Không có máy nào chờ duyệt"` | `settings.machineReg.noPending` |
| `"Khi máy AOI/AVI gọi API machine.register, chúng sẽ xuất hiện tại đây"` | `settings.machineReg.noPendingDesc` |
| `"Quy trình đăng ký thủ công"` | `settings.machineReg.manualProcess` |
| `"Quy trình đăng ký tự động"` | `settings.machineReg.autoProcess` |
| `"Đăng ký lúc:"` | `settings.machineReg.registeredAt` |
| `"Quản lý MQTT Clients"` | `settings.machineReg.mqttClients` |
| `"Phê duyệt, quản lý MQTT clients..."` | `settings.machineReg.mqttClientsDesc` |
| `"Đi đến MQTT Clients →"` | `settings.machineReg.goToMqttClients` |
| `"Máy tự động gửi yêu cầu đăng ký qua WebSocket..."` | `settings.machineReg.autoDesc` |

### Approve Dialog
| Hardcoded String | Suggested Key |
|---|---|
| `"Duyệt & Mapping máy"` | `settings.machineReg.approveTitle` |
| `"Đặt mã chuẩn, tên hiển thị, và gán vào công trạm/line..."` | `settings.machineReg.approveDesc` |
| `"Serial Number:"` | `settings.machineReg.serialNumber` |
| `"Loại máy:"` | `settings.machineReg.machineType` |
| `"Model:"` | `settings.machineReg.model` |
| `"Hãng:"` | `settings.machineReg.brand` |
| `"Firmware:"` | `settings.machineReg.firmware` |
| `"Mã máy (code)"` | `settings.machineReg.machineCode` |
| `"VD: AOI-03"` | `settings.machineReg.machineCodePlaceholder` |
| `"Để trống sẽ giữ nguyên mã tự sinh"` | `settings.machineReg.machineCodeHint` |
| `"Tên hiển thị"` | `settings.machineReg.displayName` |
| `"VD: AOI Line A #3"` | `settings.machineReg.displayNamePlaceholder` |
| `"Gán vào Công trạm"` | `settings.machineReg.assignStation` |
| `"Chọn công trạm"` | `settings.machineReg.selectStation` |
| `"Duyệt & Cấp API Key"` | `settings.machineReg.approveAndIssueKey` |

### Reject Dialog
| Hardcoded String | Suggested Key |
|---|---|
| `"Từ chối đăng ký máy"` | `settings.machineReg.rejectTitle` |
| `"Lý do từ chối (tùy chọn)"` | `settings.machineReg.rejectReason` |
| `"VD: Máy trùng lặp, không thuộc nhà máy này..."` | `settings.machineReg.rejectReasonPlaceholder` |
| `"Xác nhận từ chối"` | `settings.machineReg.confirmReject` |

### Shifts Tab
| Hardcoded String | Suggested Key |
|---|---|
| `"Cấu hình ca làm việc"` | `settings.shift.title` |
| `"Quản lý các ca làm việc trong hệ thống"` | `settings.shift.subtitle` |
| `"Thêm ca"` | `settings.shift.add` |
| `"Thêm ca làm việc mới"` | `settings.shift.addTitle` |
| `"Nhập thông tin ca làm việc"` | `settings.shift.addDesc` |
| `"Mã ca *"` | `settings.shift.code` |
| `"VD: SHIFT_1"` | `settings.shift.codePlaceholder` |
| `"Tên ca *"` | `settings.shift.name` |
| `"VD: Ca sáng"` | `settings.shift.namePlaceholder` |
| `"Nhà máy (để trống = áp dụng toàn hệ thống)"` | `settings.shift.factory` |
| `"Tất cả nhà máy"` | `settings.shift.allFactories` |
| `"Giờ bắt đầu *"` | `settings.shift.startTime` |
| `"Giờ"` | `settings.shift.hour` |
| `"Phút"` | `settings.shift.minute` |
| `"Giờ kết thúc *"` | `settings.shift.endTime` |
| `"Thứ tự hiển thị"` | `settings.shift.orderIndex` |
| `"Tạo ca"` | `settings.shift.create` |
| `"Mã"` | `settings.shift.tableCode` |
| `"Tên ca"` | `settings.shift.tableName` |
| `"Nhà máy"` | `settings.shift.tableFactory` |
| `"Thời gian"` | `settings.shift.tableTime` |
| `"Trạng thái"` | `settings.shift.tableStatus` |
| `"Thao tác"` | `settings.shift.tableActions` |
| `"Toàn hệ thống"` | `settings.shift.allSystem` |
| `"Hoạt động"` | `settings.shift.active` |
| `"Tạm dừng"` | `settings.shift.paused` |
| `"Chỉnh sửa"` | `common.edit` |
| `"Xóa"` | `common.delete` |
| `"Chưa có ca làm việc nào. Hãy thêm ca mới."` | `settings.shift.empty` |
| `"Chỉnh sửa ca làm việc"` | `settings.shift.editTitle` |
| `"Giờ bắt đầu"` | `settings.shift.editStartTime` |
| `"Giờ kết thúc"` | `settings.shift.editEndTime` |

### Stages Tab
| Hardcoded String | Suggested Key |
|---|---|
| `"Công đoạn sản xuất"` | `settings.stage.title` |
| `"Thêm công đoạn"` | `settings.stage.add` |
| `"Thêm công đoạn mới"` | `settings.stage.addTitle` |
| `"Tạo công đoạn mới cho dây chuyền sản xuất"` | `settings.stage.addDesc` |
| `"Dây chuyền"` | `settings.stage.line` |
| `"Chọn dây chuyền"` | `settings.stage.linePlaceholder` |
| `"Mã công đoạn *"` | `settings.stage.code` |
| `"VD: A, B, C..."` | `settings.stage.codePlaceholder` |
| `"Tên công đoạn *"` | `settings.stage.name` |
| `"VD: Lắp ráp, Kiểm tra..."` | `settings.stage.namePlaceholder` |
| `"Thứ tự"` | `settings.stage.orderIndex` |
| `"Trạm liên kết"` | `settings.stage.linkedStation` |
| `"Chọn trạm"` | `settings.stage.selectStation` |
| `"Không liên kết"` | `settings.stage.noLink` |
| `"Mô tả"` | `settings.stage.description` |
| `"Mô tả công đoạn"` | `settings.stage.descriptionPlaceholder` |
| `"Tạo công đoạn"` | `settings.stage.create` |
| `"công đoạn"` | `settings.stage.stageCount` |
| `"Chỉnh sửa"` | `common.edit` |
| `"Chưa có công đoạn nào. Hãy thêm công đoạn mới."` | `settings.stage.empty` |
| `"Chỉnh sửa công đoạn"` | `settings.stage.editTitle` |
| `"Mã công đoạn"` | `settings.stage.editCode` |
| `"Tên công đoạn"` | `settings.stage.editName` |

### Alerts Tab
| Hardcoded String | Suggested Key |
|---|---|
| `"Cảnh báo ngưỡng chỉ số"` | `settings.alert.title` |
| `"Cấu hình cảnh báo khi FPY, FY hoặc NTFY xuống dưới ngưỡng"` | `settings.alert.subtitle` |
| `"Thêm cảnh báo"` | `settings.alert.add` |
| `"Tạo cảnh báo mới"` | `settings.alert.addTitle` |
| `"Cấu hình cảnh báo khi chỉ số xuống dưới ngưỡng"` | `settings.alert.addDesc` |
| `"Tên cảnh báo"` | `settings.alert.name` |
| `"VD: Cảnh báo FPY thấp"` | `settings.alert.namePlaceholder` |
| `"Loại chỉ số *"` | `settings.alert.type` |
| `"FPY/FY/NTFY (%)"` | `settings.alert.typeYield` |
| `"Số lượng NG"` | `settings.alert.typeNgCount` |
| `"Trạng thái máy"` | `settings.alert.typeMachineStatus` |
| `"Điều kiện *"` | `settings.alert.condition` |
| `"Nhỏ hơn (<)"` | `settings.alert.condLt` |
| `"Nhỏ hơn hoặc bằng (≤)"` | `settings.alert.condLte` |
| `"Lớn hơn (>)"` | `settings.alert.condGt` |
| `"Lớn hơn hoặc bằng (≥)"` | `settings.alert.condGte` |
| `"Bằng (=)"` | `settings.alert.condEq` |
| `"Ngưỡng cảnh báo"` | `settings.alert.threshold` |
| `"sản phẩm"` | `settings.alert.unitProducts` |
| `"VD: FPY < 90% sẽ gửi cảnh báo"` | `settings.alert.thresholdHint` |
| `"Nhà máy (để trống = tất cả)"` | `settings.alert.factory` |
| `"Tất cả nhà máy"` | `settings.alert.allFactories` |
| `"Máy (để trống = tất cả)"` | `settings.alert.machine` |
| `"Tất cả máy"` | `settings.alert.allMachines` |
| `"Thời gian chờ giữa các cảnh báo (phút)"` | `settings.alert.cooldown` |
| `"Gửi Email"` | `settings.alert.notifyEmail` |
| `"Thông báo trong app"` | `settings.alert.notifyInApp` |
| `"Tạo cảnh báo"` | `settings.alert.create` |
| `"Đang bật"` | `settings.alert.active` |
| `"Đã tắt"` | `settings.alert.inactive` |
| `"Chưa có cảnh báo nào"` | `settings.alert.empty` |
| `"Tạo cảnh báo để nhận thông báo khi chỉ số xuống dưới ngưỡng"` | `settings.alert.emptyDesc` |
| `"Chỉnh sửa cảnh báo"` | `settings.alert.editTitle` |
| `"Thời gian chờ (phút)"` | `settings.alert.editCooldown` |

### Product Models Tab (in Settings)
| Hardcoded String | Suggested Key |
|---|---|
| `"Mẫu sản phẩm"` | `settings.productModels.title` |
| `"Quản lý các mẫu sản phẩm"` | `settings.productModels.subtitle` |
| `"Quản lý Mẫu sản phẩm"` | `settings.productModels.heading` |
| `"Quản lý các mẫu sản phẩm và điểm đo"` | `settings.productModels.desc` |
| `"Mở trang Mẫu sản phẩm"` | `settings.productModels.openPage` |

### Audit Log Tab (in Settings)
| Hardcoded String | Suggested Key |
|---|---|
| `"Audit Log"` | `settings.auditLog.title` |
| `"Lịch sử thay đổi hệ thống"` | `settings.auditLog.subtitle` |

### Common (repeated across Settings)
| Hardcoded String | Suggested Key |
|---|---|
| `"Lưu"` | `common.save` |
| `"Hủy"` | `common.cancel` |
| `"Xóa"` | `common.delete` |
| `"Chỉnh sửa"` | `common.edit` |
| `"Mô tả"` | `common.description` |

### Delete Confirm Dialogs (via DeleteConfirmDialog)
| Hardcoded String | Suggested Key |
|---|---|
| `"ca làm việc"` | `settings.deleteType.shift` |
| `"công đoạn"` | `settings.deleteType.stage` |
| `"cảnh báo"` | `settings.deleteType.alert` |
| `"máy"` | `settings.deleteType.machine` |

### Toast Messages (Mutations)
| Hardcoded String | Suggested Key |
|---|---|
| `"Tạo nhà máy thành công"` | `settings.toast.factoryCreated` |
| `"Cập nhật nhà máy thành công"` | `settings.toast.factoryUpdated` |
| `"Xóa nhà máy thành công"` | `settings.toast.factoryDeleted` |
| `"Tạo nhà xưởng thành công"` | `settings.toast.workshopCreated` |
| `"Cập nhật nhà xưởng thành công"` | `settings.toast.workshopUpdated` |
| `"Xóa nhà xưởng thành công"` | `settings.toast.workshopDeleted` |
| `"Tạo dây chuyền thành công"` | `settings.toast.lineCreated` |
| `"Cập nhật dây chuyền thành công"` | `settings.toast.lineUpdated` |
| `"Xóa dây chuyền thành công"` | `settings.toast.lineDeleted` |
| `"Tạo công trạm thành công"` | `settings.toast.stationCreated` |
| `"Cập nhật công trạm thành công"` | `settings.toast.stationUpdated` |
| `"Xóa công trạm thành công"` | `settings.toast.stationDeleted` |
| `"Tạo máy thành công"` | `settings.toast.machineCreated` |
| `"Cập nhật máy thành công"` | `settings.toast.machineUpdated` |
| `"Xóa máy thành công"` | `settings.toast.machineDeleted` |
| `"Duyệt máy thành công"` | `settings.toast.machineApproved` |
| `"Từ chối máy thành công"` | `settings.toast.machineRejected` |
| `"Tạo ca làm việc thành công"` | `settings.toast.shiftCreated` |
| `"Cập nhật ca thành công"` | `settings.toast.shiftUpdated` |
| `"Xóa ca thành công"` | `settings.toast.shiftDeleted` |
| `"Tạo công đoạn thành công"` | `settings.toast.stageCreated` |
| `"Cập nhật công đoạn thành công"` | `settings.toast.stageUpdated` |
| `"Xóa công đoạn thành công"` | `settings.toast.stageDeleted` |
| `"Đã sắp xếp lại công đoạn"` | `settings.toast.stagesReordered` |
| `"Tạo cảnh báo thành công"` | `settings.toast.alertCreated` |
| `"Cập nhật cảnh báo thành công"` | `settings.toast.alertUpdated` |
| `"Xóa cảnh báo thành công"` | `settings.toast.alertDeleted` |

---

## 9. ProductModels.tsx

### Page & Header
| Hardcoded String | Suggested Key |
|---|---|
| `"Quản lý sản phẩm"` | `products.title` |
| `"Danh sách sản phẩm"` | `products.list.title` |
| `"Chọn sản phẩm để quản lý điểm đo"` | `products.list.subtitle` |
| `"Thêm"` | `products.list.add` |

### Create Product Dialog
| Hardcoded String | Suggested Key |
|---|---|
| `"Tạo sản phẩm mới"` | `products.create.title` |
| `"Thêm mẫu sản phẩm mới với ảnh tham chiếu"` | `products.create.subtitle` |
| `"Mã sản phẩm"` | `products.create.code` |
| `"VD: PCB-001"` | `products.create.codePlaceholder` |
| `"Tên sản phẩm"` | `products.create.name` |
| `"VD: Main Board v1.0"` | `products.create.namePlaceholder` |
| `"Mô tả"` | `products.create.description` |
| `"Mô tả sản phẩm..."` | `products.create.descPlaceholder` |
| `"Ảnh tham chiếu"` | `products.create.referenceImage` |
| `"Tạo sản phẩm"` | `products.create.submit` |
| `"Đang tạo..."` | `products.create.loading` |

### Edit Product Dialog
| Hardcoded String | Suggested Key |
|---|---|
| `"Chỉnh sửa sản phẩm"` | `products.edit.title` |
| `"Cập nhật thông tin sản phẩm"` | `products.edit.subtitle` |
| `"Danh mục"` | `products.edit.category` |
| `"VD: Điện tử"` | `products.edit.categoryPlaceholder` |
| `"Dòng sản phẩm"` | `products.edit.productLine` |
| `"VD: Premium"` | `products.edit.productLinePlaceholder` |
| `"Biến thể"` | `products.edit.variant` |
| `"VD: Color"` | `products.edit.variantPlaceholder` |
| `"Trạng thái"` | `products.edit.lifecycle` |
| `"Phát triển"` | `products.edit.lifecycleDevelopment` |
| `"Hoạt động"` | `products.edit.lifecycleActive` |
| `"Kết thúc vòng đời"` | `products.edit.lifecycleEol` |
| `"Lưu trữ"` | `products.edit.lifecycleArchived` |
| `"Mục tiêu Yield (%)"` | `products.edit.targetYield` |
| `"Yield tối thiểu (%)"` | `products.edit.minYield` |
| `"Ảnh tham chiếu mới (tùy chọn)"` | `products.edit.newImage` |
| `"Ảnh hiện tại:"` | `products.edit.currentImage` |
| `"Lưu thay đổi"` | `products.edit.save` |
| `"Đang lưu..."` | `products.edit.saving` |

### Product List
| Hardcoded String | Suggested Key |
|---|---|
| `"Tìm theo mã hoặc tên sản phẩm..."` | `products.search.placeholder` |
| `"Trạng thái"` | `products.filter.status` |
| `"Tất cả"` | `products.filter.all` |
| `"Phát triển"` | `products.filter.development` |
| `"Đang dùng"` | `products.filter.active` |
| `"EOL"` | `products.filter.eol` |
| `"Lưu trữ"` | `products.filter.archived` |
| `"Sắp xếp"` | `products.sort.label` |
| `"Mới nhất"` | `products.sort.newest` |
| `"Cũ nhất"` | `products.sort.oldest` |
| `"Tên A-Z"` | `products.sort.nameAsc` |
| `"Tên Z-A"` | `products.sort.nameDesc` |
| `"Mã A-Z"` | `products.sort.codeAsc` |
| `"Mã Z-A"` | `products.sort.codeDesc` |
| `"Đã lọc"` | `products.filter.filtered` |
| `"Xóa bộ lọc"` | `products.filter.clear` |
| `"Chỉnh sửa"` | `common.edit` |
| `"Xóa"` | `common.delete` |
| `"Chưa có sản phẩm nào"` | `products.list.empty` |
| `"Nhấn "Thêm" để tạo sản phẩm mới"` | `products.list.emptyHint` |

### Measurement Point Editor
| Hardcoded String | Suggested Key |
|---|---|
| `"Chọn sản phẩm"` | `products.editor.selectProduct` |
| `"điểm đo đã định nghĩa"` | `products.editor.pointsDefined` |
| `"Chọn một sản phẩm từ danh sách bên trái"` | `products.editor.selectHint` |
| `"Đang vẽ..."` | `products.editor.drawing` |
| `"Thêm điểm"` | `products.editor.addPoint` |
| `"Đóng"` | `products.editor.close` |
| `"Import"` | `products.editor.import` |
| `"Templates"` | `products.editor.templates` |
| `"Thoát"` | `products.editor.exitBatch` |
| `"Chọn"` | `products.editor.selectBatch` |
| `"Sửa"` | `products.editor.edit` |

### Batch Operations
| Hardcoded String | Suggested Key |
|---|---|
| `"Đã chọn: X điểm đo"` | `products.batch.selected` |
| `"Chọn tất cả"` | `products.batch.selectAll` |
| `"Bỏ chọn"` | `products.batch.deselectAll` |
| `"Xuất CSV"` | `products.batch.exportCsv` |

### Point Search & Filter
| Hardcoded String | Suggested Key |
|---|---|
| `"Tim kiem"` | `products.pointSearch.label` |
| `"Tim theo ma hoac ten..."` | `products.pointSearch.placeholder` |
| `"Loai"` | `products.pointFilter.label` |
| `"Tat ca"` | `products.pointFilter.all` |
| `"Kich thuoc"` | `products.pointFilter.dimension` |
| `"Hinh anh"` | `products.pointFilter.visual` |
| `"Dien"` | `products.pointFilter.electrical` |
| `"Vi tri"` | `products.pointFilter.position` |
| `"Mau sac"` | `products.pointFilter.color` |
| `"Be mat"` | `products.pointFilter.surface` |
| `"Khac"` | `products.pointFilter.other` |

### Canvas & Interaction
| Hardcoded String | Suggested Key |
|---|---|
| `"Bán kính:"` | `products.canvas.radius` |
| `"Chưa có ảnh tham chiếu"` | `products.canvas.noImage` |
| `"Cập nhật ảnh trong phần chỉnh sửa sản phẩm"` | `products.canvas.noImageHint` |
| `"Click để đặt điểm đo"` | `products.canvas.clickToPlace` |
| `"Đang di chuyển điểm"` | `products.canvas.moving` |
| `"Danh sách điểm đo"` | `products.canvas.pointList` |

### Point Details Form
| Hardcoded String | Suggested Key |
|---|---|
| `"Chi tiết điểm đo"` | `products.point.detail` |
| `"Mã điểm đo"` | `products.point.code` |
| `"Tên điểm đo"` | `products.point.name` |
| `"Loại đo"` | `products.point.type` |
| `"Kiểm tra hình ảnh"` | `products.point.typeVisual` |
| `"Kích thước"` | `products.point.typeDimension` |
| `"Vị trí"` | `products.point.typePosition` |
| `"Màu sắc"` | `products.point.typeColor` |
| `"Bề mặt"` | `products.point.typeSurface` |
| `"Điện"` | `products.point.typeElectrical` |
| `"Khác"` | `products.point.typeOther` |
| `"Giới hạn dưới"` | `products.point.lowerLimit` |
| `"Giới hạn trên"` | `products.point.upperLimit` |
| `"Giá trị danh nghĩa"` | `products.point.nominalValue` |
| `"Đơn vị"` | `products.point.unit` |
| `"Ảnh mẫu điểm đo"` | `products.point.referenceImage` |
| `"Chưa có ảnh mẫu"` | `products.point.noImage` |
| `"Công trạm (tùy chọn)"` | `products.point.workstation` |
| `"Chọn công trạm"` | `products.point.workstationPlaceholder` |
| `"Vị trí:"` | `products.point.position` |
| `"Bán kính:"` | `products.point.radius` |
| `"Vùng cắt ảnh mẫu (tâm là điểm đo)"` | `products.point.cropArea` |
| `"Rộng (px)"` | `products.point.cropWidth` |
| `"Cao (px)"` | `products.point.cropHeight` |
| `"Tự động cắt"` | `products.point.autoCrop` |
| `"Upload ảnh"` | `products.point.uploadImage` |
| `"Hệ thống sẽ tự động cắt ảnh mẫu từ ảnh sản phẩm với tâm là vị trí điểm đo."` | `products.point.autoCropDesc` |
| `"Upload ảnh mẫu riêng cho điểm đo này."` | `products.point.uploadImageDesc` |
| `"Upload ảnh mẫu"` | `products.point.uploadLabel` |
| `"Đang lưu..."` | `products.point.saving` |
| `"Lưu"` | `common.save` |
| `"Chọn một điểm đo để xem chi tiết"` | `products.point.selectHint` |
| `"Hoặc click "Thêm điểm" rồi click trên ảnh"` | `products.point.selectHintEdit` |

### Template Dialog
| Hardcoded String | Suggested Key |
|---|---|
| `"Quản lý Templates"` | `products.template.title` |
| `"Lưu hoặc áp dụng template điểm đo cho sản phẩm"` | `products.template.subtitle` |
| `"Lưu thành Template mới"` | `products.template.saveNew` |
| `"Tên template *"` | `products.template.name` |
| `"VD: Template điện tử cơ bản"` | `products.template.namePlaceholder` |
| `"Danh mục"` | `products.template.category` |
| `"Chọn danh mục"` | `products.template.categoryPlaceholder` |
| `"Điện tử"` | `products.template.catElectronics` |
| `"Cơ khí"` | `products.template.catMechanical` |
| `"Lắp ráp"` | `products.template.catAssembly` |
| `"Chung"` | `products.template.catGeneral` |
| `"Mô tả"` | `products.template.description` |
| `"Mô tả template..."` | `products.template.descPlaceholder` |
| `"Lưu X điểm đo thành template"` | `products.template.savePoints` |
| `"Áp dụng Template có sẵn"` | `products.template.applyExisting` |
| `"Không có mô tả"` | `products.template.noDesc` |
| `"Áp dụng"` | `products.template.apply` |
| `"Chưa có template nào"` | `products.template.empty` |
| `"Đóng"` | `common.close` |

### Toast Messages
| Hardcoded String | Suggested Key |
|---|---|
| `"Tạo mẫu sản phẩm thành công"` | `products.toast.created` |
| `"Cập nhật thành công"` | `products.toast.updated` |
| `"Xóa sản phẩm thành công"` | `products.toast.deleted` |
| `"Xóa điểm đo thành công"` | `products.toast.pointDeleted` |
| `"Đã lưu ảnh mẫu vùng cắt thành công"` | `products.toast.cropSaved` |
| `"Lỗi upload ảnh:"` | `products.toast.uploadError` |
| `"Đã sao chép điểm đo"` | `products.toast.pointDuplicated` |
| `"Vui lòng nhập tên template"` | `products.toast.templateNameRequired` |
| `"Không có điểm đo nào để lưu"` | `products.toast.noPointsToSave` |
| `"Đã áp dụng template"` | `products.toast.templateApplied` |
| `"Lỗi khi áp dụng template"` | `products.toast.templateApplyError` |
| `"Vui lòng chọn ít nhất một điểm đo"` | `products.toast.selectAtLeastOne` |
| `"Đã xóa X điểm đo"` | `products.toast.batchDeleted` |
| `"Đã xuất X điểm đo"` | `products.toast.batchExported` |
| `"Điểm đo X"` (auto-generated) | `products.toast.autoPointName` |
| `"Vui lòng kiểm tra lại thông tin nhập"` | `products.toast.validationError` |
| `"Vui lòng nhập mã và tên sản phẩm"` | `products.toast.codeNameRequired` |
| `"Vui lòng lưu điểm đo trước khi upload ảnh"` | `products.toast.savePointFirst` |
| `"Chon mot san pham de quan ly diem do"` | `products.noProductSelected` |

### Validation Messages
| Hardcoded String | Suggested Key |
|---|---|
| `"Mã điểm đo là bắt buộc"` | `products.validation.codeRequired` |
| `"Tên điểm đo là bắt buộc"` | `products.validation.nameRequired` |
| `"Mã điểm đo đã tồn tại"` | `products.validation.codeDuplicate` |
| `"Giới hạn dưới phải nhỏ hơn giới hạn trên"` | `products.validation.limitRange` |

### CSV Export Headers
| Hardcoded String | Suggested Key |
|---|---|
| `"Mã,Tên,Loại,Đơn vị,Giới hạn dưới,Giới hạn trên,Giá trị danh định"` | `products.csv.headers` |

---

## 10. Reports.tsx

### Page
| Hardcoded String | Suggested Key |
|---|---|
| `"Báo cáo"` | `reports.title` |
| `"Xuất PDF"` | `reports.exportPdf` |
| `"In"` | `reports.print` |

### Filter Bar
| Hardcoded String | Suggested Key |
|---|---|
| `"Tất cả nhà máy"` | `reports.filter.allFactories` |
| `"Tất cả máy"` | `reports.filter.allMachines` |
| `"7 ngày"` | `reports.filter.sevenDays` |
| `"30 ngày"` | `reports.filter.thirtyDays` |
| `"90 ngày"` | `reports.filter.ninetyDays` |

### Summary Cards
| Hardcoded String | Suggested Key |
|---|---|
| `"Tổng kiểm tra"` | `reports.summary.totalInspections` |
| `"Sản phẩm OK"` | `reports.summary.okProducts` |
| `"Sản phẩm NG"` | `reports.summary.ngProducts` |
| `"Yield Rate"` | `reports.summary.yieldRate` |

### Tabs
| Hardcoded String | Suggested Key |
|---|---|
| `"Executive Summary"` | `reports.tab.executive` |
| `"Machine Performance"` | `reports.tab.machinePerformance` |
| `"Recommendations"` | `reports.tab.recommendations` |
| `"Trend"` | `reports.tab.trend` |
| `"Factories"` | `reports.tab.factories` |

### Executive Summary Tab
| Hardcoded String | Suggested Key |
|---|---|
| `"Tóm tắt điều hành"` | `reports.executive.title` |
| `"Phân bố kết quả kiểm tra"` | `reports.executive.distribution` |
| `"Xu hướng Yield Rate theo ngày"` | `reports.executive.yieldTrend` |
| `"Sản phẩm"` | `reports.executive.products` |

### Machine Performance Tab
| Hardcoded String | Suggested Key |
|---|---|
| `"Hiệu suất theo máy"` | `reports.machine.title` |
| `"So sánh hiệu suất giữa các máy"` | `reports.machine.subtitle` |
| `"Máy"` | `reports.machine.machine` |
| `"Tổng"` | `reports.machine.total` |
| `"Yield"` | `reports.machine.yield` |

### Recommendations Tab
| Hardcoded String | Suggested Key |
|---|---|
| `"Khuyến nghị"` | `reports.recommendations.title` |
| `"Dựa trên phân tích dữ liệu"` | `reports.recommendations.subtitle` |
| `"Khuyến nghị ưu tiên"` | `reports.recommendations.priority` |
| `"Cần chú ý"` | `reports.recommendations.attention` |

### Trend Tab
| Hardcoded String | Suggested Key |
|---|---|
| `"Xu hướng sản xuất"` | `reports.trend.title` |
| `"Biểu đồ xu hướng"` | `reports.trend.chart` |

### Factories Tab
| Hardcoded String | Suggested Key |
|---|---|
| `"So sánh nhà máy"` | `reports.factories.title` |
| `"Thống kê theo nhà máy"` | `reports.factories.subtitle` |

### PDF Export
| Hardcoded String | Suggested Key |
|---|---|
| `"BÁO CÁO TỔNG HỢP CHẤT LƯỢNG"` | `reports.pdf.title` |
| `"Ngày xuất:"` | `reports.pdf.exportDate` |
| `"Tóm tắt"` | `reports.pdf.summary` |
| `"Hiệu suất theo máy"` | `reports.pdf.machinePerformance` |
| `"Khuyến nghị"` | `reports.pdf.recommendations` |

---

## 11. Layout.tsx

| Hardcoded String | Suggested Key |
|---|---|
| `"Layout nhà máy"` | `layout.title` |
| `"Quản lý sơ đồ bố trí nhà xưởng"` | `layout.subtitle` |
| `"Xuất ảnh"` | `layout.exportImage` |
| `"Thêm Layout"` | `layout.addLayout` |
| `"Tạo Layout mới"` | `layout.createTitle` |
| `"Tạo sơ đồ bố trí mới cho nhà xưởng"` | `layout.createSubtitle` |
| `"Tên Layout *"` | `layout.nameLabel` |
| `"VD: Sơ đồ xưởng SMT"` | `layout.namePlaceholder` |
| `"Nhà máy *"` | `layout.factoryLabel` |
| `"Chọn nhà máy"` | `layout.factoryPlaceholder` |
| `"Nhà xưởng"` | `layout.workshopLabel` |
| `"Chọn nhà xưởng (tùy chọn)"` | `layout.workshopPlaceholder` |
| `"Mô tả"` | `layout.descriptionLabel` |
| `"Tạo"` | `layout.create` |
| `"Hủy"` | `layout.cancel` |
| `"Xem"` | `layout.viewTab` |
| `"Chỉnh sửa"` | `layout.editTab` |
| `"Không tìm thấy layout"` | `layout.notFound` |
| `"Hãy tạo layout mới để bắt đầu"` | `layout.notFoundHint` |
| `"Chưa có layout nào"` | `layout.empty` |
| `"Tạo layout mới để quản lý sơ đồ bố trí nhà xưởng"` | `layout.emptyHint` |
| `"Thêm máy"` | `layout.addMachine` |
| `"Lưu vị trí"` | `layout.savePosition` |
| `"Phóng to"` | `layout.zoomIn` |
| `"Thu nhỏ"` | `layout.zoomOut` |
| `"Reset zoom"` | `layout.resetZoom` |
| `"Toggle grid"` | `layout.toggleGrid` |
| `"Kéo thả máy để sắp xếp vị trí trên sơ đồ"` | `layout.dragHint` |
| `"Lưu thành công"` | `layout.toast.saved` |
| `"Tạo layout thành công"` | `layout.toast.created` |
| `"Xóa layout thành công"` | `layout.toast.deleted` |

---

## 12. MqttDashboard.tsx

### Page
| Hardcoded String | Suggested Key |
|---|---|
| `"MQTT Monitoring"` | `mqtt.title` |
| `"Giám sát MQTT real-time"` | `mqtt.subtitle` |

### Stats Cards
| Hardcoded String | Suggested Key |
|---|---|
| `"Clients"` | `mqtt.stats.clients` |
| `"Active"` | `mqtt.stats.active` |
| `"Messages/s"` | `mqtt.stats.messagesPerSec` |
| `"Topics"` | `mqtt.stats.topics` |
| `"Avg Latency"` | `mqtt.stats.avgLatency` |

### Realtime Cards
| Hardcoded String | Suggested Key |
|---|---|
| `"Tin nhắn gần đây"` | `mqtt.recentMessages` |
| `"Kết nối MQTT"` | `mqtt.connections` |
| `"Biểu đồ messages"` | `mqtt.messageChart` |
| `"Subscriptions"` | `mqtt.subscriptions` |

### Client Table
| Hardcoded String | Suggested Key |
|---|---|
| `"Client ID"` | `mqtt.clientTable.clientId` |
| `"Trạng thái"` | `mqtt.clientTable.status` |
| `"Kết nối lúc"` | `mqtt.clientTable.connectedAt` |
| `"IP"` | `mqtt.clientTable.ip` |

### Message Table
| Hardcoded String | Suggested Key |
|---|---|
| `"Topic"` | `mqtt.messageTable.topic` |
| `"Payload"` | `mqtt.messageTable.payload` |
| `"QoS"` | `mqtt.messageTable.qos` |
| `"Thời gian"` | `mqtt.messageTable.time` |

### MQTT Alert Widget (English-only)
| Hardcoded String | Suggested Key |
|---|---|
| `"Machine Alerts via MQTT"` | `mqtt.alerts.title` |
| `"Real-time alerts from machine topics"` | `mqtt.alerts.subtitle` |
| `"Connected"` | `mqtt.alerts.connected` |
| `"Disconnected"` | `mqtt.alerts.disconnected` |
| `"Resume"` | `mqtt.alerts.resume` |
| `"Pause"` | `mqtt.alerts.pause` |
| `"Clear"` | `mqtt.alerts.clear` |
| `"No alerts yet"` | `mqtt.alerts.empty` |
| `"Listening to MQTT topics for machine alerts..."` | `mqtt.alerts.listening` |

---

## 13. Users.tsx

### Page
| Hardcoded String | Suggested Key |
|---|---|
| `"Quản lý người dùng"` | `users.title` |
| `"Thêm người dùng"` | `users.add` |

### Stats Cards
| Hardcoded String | Suggested Key |
|---|---|
| `"Tổng người dùng"` | `users.stats.total` |
| `"Đang hoạt động"` | `users.stats.active` |
| `"Admin"` | `users.stats.admin` |
| `"Bị khóa"` | `users.stats.locked` |

### Table Headers
| Hardcoded String | Suggested Key |
|---|---|
| `"Người dùng"` | `users.table.user` |
| `"Vai trò"` | `users.table.role` |
| `"Trạng thái"` | `users.table.status` |
| `"Ngày tạo"` | `users.table.createdAt` |
| `"Thao tác"` | `users.table.actions` |
| `"Hoạt động"` | `users.table.active` |
| `"Bị khóa"` | `users.table.locked` |

### Actions
| Hardcoded String | Suggested Key |
|---|---|
| `"Chỉnh sửa"` | `common.edit` |
| `"Đặt lại mật khẩu"` | `users.action.resetPassword` |
| `"Khóa tài khoản"` | `users.action.lockAccount` |
| `"Mở khóa"` | `users.action.unlockAccount` |
| `"Xóa"` | `common.delete` |

### Create User Dialog
| Hardcoded String | Suggested Key |
|---|---|
| `"Thêm người dùng mới"` | `users.create.title` |
| `"Tạo tài khoản người dùng mới"` | `users.create.subtitle` |
| `"Tên đăng nhập *"` | `users.create.username` |
| `"Tên hiển thị *"` | `users.create.displayName` |
| `"Email"` | `users.create.email` |
| `"Mật khẩu *"` | `users.create.password` |
| `"Vai trò"` | `users.create.role` |
| `"Tạo tài khoản"` | `users.create.submit` |

### Edit User Dialog
| Hardcoded String | Suggested Key |
|---|---|
| `"Chỉnh sửa người dùng"` | `users.edit.title` |
| `"Tên hiển thị"` | `users.edit.displayName` |
| `"Email"` | `users.edit.email` |
| `"Vai trò"` | `users.edit.role` |

### Toast Messages
| Hardcoded String | Suggested Key |
|---|---|
| `"Tạo người dùng thành công"` | `users.toast.created` |
| `"Cập nhật người dùng thành công"` | `users.toast.updated` |
| `"Xóa người dùng thành công"` | `users.toast.deleted` |
| `"Đặt lại mật khẩu thành công"` | `users.toast.passwordReset` |
| `"Khóa tài khoản thành công"` | `users.toast.locked` |
| `"Mở khóa tài khoản thành công"` | `users.toast.unlocked` |
| `"Chưa có người dùng nào"` | `users.empty` |

---

## 14. Alerts.tsx

### Alert Type Labels (map)
| Hardcoded String | Suggested Key |
|---|---|
| `"Yield thấp"` | `alerts.type.lowYield` |
| `"NG cao"` | `alerts.type.highNg` |
| `"Máy offline"` | `alerts.type.machineOffline` |
| `"Máy lỗi"` | `alerts.type.machineError` |
| `"Bảo trì"` | `alerts.type.maintenance` |

### Tabs
| Hardcoded String | Suggested Key |
|---|---|
| `"Cài đặt"` | `alerts.tab.settings` |
| `"Lịch sử"` | `alerts.tab.history` |

### Alert Cards
| Hardcoded String | Suggested Key |
|---|---|
| `"Đang bật"` | `alerts.status.active` |
| `"Tạm dừng"` | `alerts.status.paused` |
| `"Ngưỡng:"` | `alerts.threshold` |
| `"Email"` | `alerts.channel.email` |
| `"Webhook"` | `alerts.channel.webhook` |
| `"Chưa có cảnh báo nào"` | `alerts.empty` |

### Alert History
| Hardcoded String | Suggested Key |
|---|---|
| `"Thời gian"` | `alerts.history.time` |
| `"Loại"` | `alerts.history.type` |
| `"Nội dung"` | `alerts.history.content` |
| `"Trạng thái"` | `alerts.history.status` |
| `"Đã gửi"` | `alerts.history.sent` |
| `"Chưa có lịch sử cảnh báo"` | `alerts.history.empty` |

---

## 15. Profile.tsx

### Page
| Hardcoded String | Suggested Key |
|---|---|
| `"Hồ sơ cá nhân"` | `profile.title` |
| `"Thông tin cá nhân"` | `profile.personalInfo` |
| `"Bảo mật"` | `profile.security` |

### Personal Info
| Hardcoded String | Suggested Key |
|---|---|
| `"Tên đăng nhập"` | `profile.username` |
| `"Tên hiển thị"` | `profile.displayName` |
| `"Email"` | `profile.email` |
| `"Vai trò"` | `profile.role` |
| `"Ngày tạo"` | `profile.createdAt` |
| `"Cập nhật"` | `profile.update` |

### 2FA Section
| Hardcoded String | Suggested Key |
|---|---|
| `"Xác thực 2 bước (2FA)"` | `profile.twoFactor.title` |
| `"Đã bật"` | `profile.twoFactor.enabled` |
| `"Chưa bật"` | `profile.twoFactor.disabled` |
| `"Thiết lập 2FA"` | `profile.twoFactor.setup` |
| `"Tắt 2FA"` | `profile.twoFactor.disable` |
| `"Quét mã QR bằng ứng dụng Authenticator"` | `profile.twoFactor.scanQr` |
| `"Hoặc nhập mã thủ công:"` | `profile.twoFactor.manualEntry` |
| `"Nhập mã xác thực từ ứng dụng"` | `profile.twoFactor.enterCode` |
| `"Xác nhận"` | `profile.twoFactor.confirm` |
| `"Đang xác nhận..."` | `profile.twoFactor.confirming` |
| `"Thiết lập 2FA thành công"` | `profile.twoFactor.setupSuccess` |
| `"Đã tắt 2FA"` | `profile.twoFactor.disableSuccess` |

### Backup Codes
| Hardcoded String | Suggested Key |
|---|---|
| `"Mã backup khẩn cấp"` | `profile.backupCodes.title` |
| `"Lưu lại các mã này ở nơi an toàn"` | `profile.backupCodes.saveWarning` |
| `"Mỗi mã chỉ dùng được một lần"` | `profile.backupCodes.oneTimeUse` |
| `"Sao chép tất cả"` | `profile.backupCodes.copyAll` |
| `"Đã sao chép mã backup"` | `profile.backupCodes.copied` |

### Sessions
| Hardcoded String | Suggested Key |
|---|---|
| `"Phiên đăng nhập"` | `profile.sessions.title` |
| `"Quản lý phiên"` | `profile.sessions.manage` |

---

## 16. AuditLogs.tsx

### Action Labels (map)
| Hardcoded String | Suggested Key |
|---|---|
| `"Đăng nhập"` | `auditLogs.action.login` |
| `"Đăng xuất"` | `auditLogs.action.logout` |
| `"Tạo mới"` | `auditLogs.action.create` |
| `"Cập nhật"` | `auditLogs.action.update` |
| `"Xóa"` | `auditLogs.action.delete` |
| `"Xuất dữ liệu"` | `auditLogs.action.export` |
| `"Nhập dữ liệu"` | `auditLogs.action.import` |
| `"Đổi mật khẩu"` | `auditLogs.action.changePassword` |
| `"Đặt lại mật khẩu"` | `auditLogs.action.resetPassword` |

### Entity Labels (map)
| Hardcoded String | Suggested Key |
|---|---|
| `"Người dùng"` | `auditLogs.entity.user` |
| `"Máy"` | `auditLogs.entity.machine` |
| `"Sản phẩm"` | `auditLogs.entity.product` |
| `"Kiểm tra"` | `auditLogs.entity.inspection` |
| `"Cài đặt"` | `auditLogs.entity.settings` |
| `"Báo cáo"` | `auditLogs.entity.report` |
| `"Cảnh báo"` | `auditLogs.entity.alert` |

### Page
| Hardcoded String | Suggested Key |
|---|---|
| `"Audit Log"` | `auditLogs.title` |
| `"Lịch sử hoạt động hệ thống"` | `auditLogs.subtitle` |

### Tabs
| Hardcoded String | Suggested Key |
|---|---|
| `"Tất cả"` | `auditLogs.tab.all` |
| `"Đăng nhập"` | `auditLogs.tab.login` |
| `"Thay đổi"` | `auditLogs.tab.changes` |

### Table Headers
| Hardcoded String | Suggested Key |
|---|---|
| `"Thời gian"` | `auditLogs.table.time` |
| `"Người dùng"` | `auditLogs.table.user` |
| `"Hành động"` | `auditLogs.table.action` |
| `"Đối tượng"` | `auditLogs.table.entity` |
| `"Chi tiết"` | `auditLogs.table.detail` |
| `"IP"` | `auditLogs.table.ip` |

### Filters
| Hardcoded String | Suggested Key |
|---|---|
| `"Tìm kiếm..."` | `auditLogs.filter.search` |
| `"Tất cả hành động"` | `auditLogs.filter.allActions` |
| `"Tất cả đối tượng"` | `auditLogs.filter.allEntities` |

---

## 17. CorporateDashboard.tsx

| Hardcoded String | Suggested Key |
|---|---|
| `"Dashboard Tập đoàn"` | `corporate.title` |
| `"Tổng quan hiệu suất toàn hệ thống"` | `corporate.subtitle` |
| `"Tổng sản lượng"` | `corporate.stats.totalProduction` |
| `"Yield trung bình"` | `corporate.stats.avgYield` |
| `"Nhà máy hoạt động"` | `corporate.stats.activeFactories` |
| `"Máy online"` | `corporate.stats.machinesOnline` |
| `"Hôm nay"` | `corporate.period.today` |
| `"Tuần này"` | `corporate.period.thisWeek` |
| `"Tháng này"` | `corporate.period.thisMonth` |
| `"Quý này"` | `corporate.period.thisQuarter` |
| `"So sánh yield giữa các nhà máy"` | `corporate.chart.yieldComparison` |
| `"Xu hướng sản lượng"` | `corporate.chart.productionTrend` |
| `"Chưa có dữ liệu nhà máy"` | `corporate.noData` |

---

## 18. ProductionOrders.tsx

| Hardcoded String | Suggested Key |
|---|---|
| `"Lệnh sản xuất"` | `productionOrders.title` |
| `"Quản lý lệnh sản xuất"` | `productionOrders.subtitle` |
| `"Thêm lệnh"` | `productionOrders.add` |
| `"Tổng lệnh"` | `productionOrders.stats.total` |
| `"Đang sản xuất"` | `productionOrders.stats.inProgress` |
| `"Hoàn thành"` | `productionOrders.stats.completed` |
| `"Tạm dừng"` | `productionOrders.stats.paused` |
| `"Mã lệnh"` | `productionOrders.table.code` |
| `"Sản phẩm"` | `productionOrders.table.product` |
| `"Số lượng"` | `productionOrders.table.quantity` |
| `"Tiến độ"` | `productionOrders.table.progress` |
| `"Trạng thái"` | `productionOrders.table.status` |
| `"Ngày bắt đầu"` | `productionOrders.table.startDate` |
| `"Ngày kết thúc"` | `productionOrders.table.endDate` |
| `"Thao tác"` | `productionOrders.table.actions` |
| `"Chỉnh sửa lệnh sản xuất"` | `productionOrders.edit.title` |
| `"Ngày hoàn thành"` | `productionOrders.edit.completionDate` |
| `"Ghi chú"` | `productionOrders.edit.notes` |
| `"Chưa có lệnh sản xuất"` | `productionOrders.empty` |
| `"Tạo lệnh sản xuất thành công"` | `productionOrders.toast.created` |
| `"Cập nhật thành công"` | `productionOrders.toast.updated` |
| `"Xóa thành công"` | `productionOrders.toast.deleted` |

---

## 19. InspectionDetail.tsx

| Hardcoded String | Suggested Key |
|---|---|
| `"Chi tiết kiểm tra"` | `inspectionDetail.title` |
| `"Serial Number"` | `inspectionDetail.serialNumber` |
| `"Kết quả"` | `inspectionDetail.result` |
| `"Thời gian"` | `inspectionDetail.time` |
| `"Máy kiểm tra"` | `inspectionDetail.machine` |
| `"Sản phẩm"` | `inspectionDetail.product` |
| `"Loại kiểm tra"` | `inspectionDetail.type` |
| `"Thời gian kiểm tra"` | `inspectionDetail.duration` |
| `"Điểm đo"` | `inspectionDetail.measurementPoints` |
| `"Vị trí"` | `inspectionDetail.position` |
| `"Giá trị đo"` | `inspectionDetail.measuredValue` |
| `"Giới hạn"` | `inspectionDetail.limits` |
| `"Ảnh kiểm tra"` | `inspectionDetail.inspectionImage` |
| `"Ảnh tham chiếu"` | `inspectionDetail.referenceImage` |
| `"So sánh ảnh"` | `inspectionDetail.imageCompare` |
| `"Ghi chú"` | `inspectionDetail.remark` |
| `"Sửa kết quả"` | `inspectionDetail.correctResult` |
| `"Kết quả mới"` | `inspectionDetail.newResult` |
| `"Lý do sửa"` | `inspectionDetail.correctionReason` |
| `"Xác nhận sửa"` | `inspectionDetail.confirmCorrection` |
| `"Quay lại"` | `inspectionDetail.goBack` |
| `"Chưa có dữ liệu"` | `inspectionDetail.noData` |
| `"Sửa kết quả thành công"` | `inspectionDetail.toast.corrected` |
| `"Đã cập nhật ghi chú"` | `inspectionDetail.toast.remarkUpdated` |
| `"Không tìm thấy kết quả kiểm tra"` | `inspectionDetail.notFound` |
| `"Side by Side"` | `inspectionDetail.sideBySide` |
| `"Overlay"` | `inspectionDetail.overlay` |
| `"Slider"` | `inspectionDetail.slider` |

---

## 20. ProcessManagement.tsx

> **Note:** This file is mostly English. Only one Vietnamese string found.

| Hardcoded String | Suggested Key |
|---|---|
| `"Kéo thả để sắp xếp thứ tự công đoạn"` | `process.dragDropHint` |
| `"Process Management"` | `process.title` |
| `"Manage manufacturing processes and stages"` | `process.subtitle` |
| `"Add Process"` | `process.addProcess` |
| `"Stages"` | `process.stages` |
| `"Add Stage"` | `process.addStage` |
| `"Process Name"` | `process.name` |
| `"Description"` | `process.description` |
| `"Stage Name"` | `process.stageName` |
| `"Order"` | `process.order` |
| `"No processes yet"` | `process.empty` |

---

## 21. RoleManagement.tsx

> **Note:** Mostly English strings.

| Hardcoded String | Suggested Key |
|---|---|
| `"Role Management"` | `roles.title` |
| `"Manage user roles and permissions"` | `roles.subtitle` |
| `"Add Role"` | `roles.add` |
| `"Role Name"` | `roles.name` |
| `"Description"` | `roles.description` |
| `"Permissions"` | `roles.permissions` |
| `"Users"` | `roles.users` |
| `"Actions"` | `roles.actions` |
| `"Edit"` | `roles.edit` |
| `"Delete"` | `roles.delete` |
| `"Create Role"` | `roles.create` |
| `"Update Role"` | `roles.update` |
| `"No roles found"` | `roles.empty` |
| `"Are you sure?"` | `roles.deleteConfirm` |
| `"Role created successfully"` | `roles.toast.created` |
| `"Role updated successfully"` | `roles.toast.updated` |
| `"Role deleted successfully"` | `roles.toast.deleted` |

---

## 22. PermissionsManagement.tsx

### Category Names (CATEGORY_META map)
| Hardcoded String | Suggested Key |
|---|---|
| `"Bảng điều khiển"` | `permissions.category.dashboard` |
| `"Quản lý máy"` | `permissions.category.machines` |
| `"Sản phẩm"` | `permissions.category.products` |
| `"Kiểm tra"` | `permissions.category.inspections` |
| `"Báo cáo"` | `permissions.category.reports` |
| `"Người dùng"` | `permissions.category.users` |
| `"Cài đặt"` | `permissions.category.settings` |
| `"Hệ thống"` | `permissions.category.system` |

### Permission Fields (PERMISSION_FIELDS)
| Hardcoded String | Suggested Key |
|---|---|
| `"Xem"` | `permissions.field.canView` |
| `"Tạo"` | `permissions.field.canCreate` |
| `"Sửa"` | `permissions.field.canEdit` |
| `"Xóa"` | `permissions.field.canDelete` |
| `"Xuất"` | `permissions.field.canExport` |

### Page
| Hardcoded String | Suggested Key |
|---|---|
| `"Phân quyền"` | `permissions.title` |
| `"Quản lý quyền truy cập cho từng vai trò"` | `permissions.subtitle` |
| `"Chọn vai trò"` | `permissions.selectRole` |
| `"Lưu quyền"` | `permissions.savePermissions` |
| `"Đã lưu quyền thành công"` | `permissions.toast.saved` |

---

## 23. SMTPConfig.tsx

| Hardcoded String | Suggested Key |
|---|---|
| `"Cấu hình SMTP"` | `smtp.title` |
| `"Cấu hình máy chủ email để gửi thông báo"` | `smtp.subtitle` |
| `"SMTP Host"` | `smtp.host` |
| `"SMTP Port"` | `smtp.port` |
| `"Username"` | `smtp.username` |
| `"Password"` | `smtp.password` |
| `"Sender Email"` | `smtp.senderEmail` |
| `"Sender Name"` | `smtp.senderName` |
| `"SSL/TLS"` | `smtp.ssl` |
| `"Bật mã hóa SSL/TLS"` | `smtp.sslEnabled` |
| `"Lưu cấu hình"` | `smtp.save` |
| `"Gửi test email"` | `smtp.testEmail` |
| `"Đã lưu cấu hình SMTP"` | `smtp.toast.saved` |
| `"Đã gửi test email"` | `smtp.toast.testSent` |

---

## 24. DashboardLayout.tsx

| Hardcoded String | Suggested Key |
|---|---|
| `"AVI AOI System"` | `layout.systemName` |
| `"Hệ thống quản lý"` | `layout.systemLabel` |
| `"Tìm kiếm..."` | `layout.searchPlaceholder` |
| `"Thông báo"` | `layout.notifications` |
| `"Hồ sơ"` | `layout.profile` |
| `"Đổi mật khẩu"` | `layout.changePassword` |
| `"Quản lý phiên"` | `layout.sessionManagement` |
| `"Đăng xuất"` | `layout.logout` |
| `"Vui lòng đăng nhập"` | `layout.loginPrompt` |
| `"Đăng nhập"` | `layout.loginButton` |

---

## 25. navigation.tsx

### Navigation Group Labels
| Hardcoded String | Suggested Key |
|---|---|
| `"Dashboard"` | `nav.group.dashboard` |
| `"Quản lý Tập đoàn"` | `nav.group.corporate` |
| `"Giám sát"` | `nav.group.monitoring` |
| `"Cảnh báo"` | `nav.group.alerts` |
| `"Sản xuất"` | `nav.group.production` |
| `"Phân tích"` | `nav.group.analysis` |
| `"Dữ liệu"` | `nav.group.data` |
| `"Quy trình"` | `nav.group.process` |
| `"Cài đặt"` | `nav.group.settings` |
| `"Quản trị"` | `nav.group.admin` |

### Navigation Group Descriptions
| Hardcoded String | Suggested Key |
|---|---|
| `"Bảng điều khiển và tổng quan"` | `nav.desc.dashboard` |
| `"Quản lý tập đoàn đa nhà máy"` | `nav.desc.corporate` |
| `"Theo dõi trạng thái máy và MQTT"` | `nav.desc.monitoring` |
| `"Quản lý cảnh báo hệ thống"` | `nav.desc.alerts` |
| `"Quản lý lệnh sản xuất và kiểm tra"` | `nav.desc.production` |
| `"Báo cáo và phân tích dữ liệu"` | `nav.desc.analysis` |
| `"Quản lý sản phẩm và layout"` | `nav.desc.data` |
| `"Quản lý quy trình sản xuất"` | `nav.desc.process` |
| `"Cấu hình hệ thống"` | `nav.desc.settings` |
| `"Quản trị hệ thống"` | `nav.desc.admin` |

### Navigation Item Labels (60+ items)
| Hardcoded String | Suggested Key |
|---|---|
| `"Tổng quan"` | `nav.item.overview` |
| `"Drill-Down"` | `nav.item.drillDown` |
| `"Dashboard Tập đoàn"` | `nav.item.corporateDashboard` |
| `"Cấu trúc Tập đoàn"` | `nav.item.corporateStructure` |
| `"Trạng thái máy"` | `nav.item.machineStatus` |
| `"MQTT Monitor"` | `nav.item.mqttMonitor` |
| `"MQTT Clients"` | `nav.item.mqttClients` |
| `"Topics & Messages"` | `nav.item.mqttTopics` |
| `"MQTT Replay"` | `nav.item.mqttReplay` |
| `"MQTT Profiles"` | `nav.item.mqttProfiles` |
| `"Bản tin MQTT"` | `nav.item.mqttBulletin` |
| `"OEE Dashboard"` | `nav.item.oeeDashboard` |
| `"Machine Health"` | `nav.item.machineHealth` |
| `"Danh sách cảnh báo"` | `nav.item.alertList` |
| `"Quy tắc cảnh báo"` | `nav.item.alertRules` |
| `"Cảnh báo Dự đoán"` | `nav.item.predictiveAlerts` |
| `"Mục tiêu OEE"` | `nav.item.oeeTargets` |
| `"Lệnh sản xuất"` | `nav.item.productionOrders` |
| `"Lịch sử kiểm tra"` | `nav.item.inspectionHistory` |
| `"AOI Image Packages"` | `nav.item.aoiImagePackages` |
| `"Lịch xuất báo cáo"` | `nav.item.reportSchedule` |
| `"Báo cáo"` | `nav.item.reports` |
| `"Báo cáo định kỳ"` | `nav.item.scheduledReports` |
| `"Phân tích Category"` | `nav.item.categoryAnalysis` |
| `"SPC / AI Analysis"` | `nav.item.spcAiAnalysis` |
| `"SPC Advanced"` | `nav.item.spcAdvanced` |
| `"Correlation Analysis"` | `nav.item.correlationAnalysis` |
| `"Quality Gates"` | `nav.item.qualityGates` |
| `"Thống kê Annotation"` | `nav.item.annotationStats` |
| `"So sánh Annotation"` | `nav.item.annotationComparison` |
| `"Bản đồ nhiệt Defects"` | `nav.item.defectHeatmap` |
| `"Dự đoán Defects"` | `nav.item.defectPrediction` |
| `"Phân tích Nguyên nhân"` | `nav.item.rootCauseAnalysis` |
| `"PDF Reports"` | `nav.item.pdfReports` |
| `"So sánh dữ liệu"` | `nav.item.dataComparison` |
| `"Report Builder"` | `nav.item.reportBuilder` |
| `"Xuất PowerPoint"` | `nav.item.exportPowerPoint` |
| `"Báo cáo định kỳ"` (duplicate) | `nav.item.scheduledReportsPlus` |
| `"Sản phẩm"` | `nav.item.products` |
| `"Gán sản phẩm"` | `nav.item.productAssignment` |
| `"Layout nhà máy"` | `nav.item.factoryLayout` |
| `"Công đoạn"` | `nav.item.stages` |
| `"Công trạm"` | `nav.item.workstations` |
| `"Cài đặt chung"` | `nav.item.generalSettings` |
| `"Âm thanh thông báo"` | `nav.item.notificationSounds` |
| `"Cấu hình hệ thống"` | `nav.item.systemConfig` |
| `"Backup & Restore"` | `nav.item.backupRestore` |
| `"Import/Export"` | `nav.item.importExport` |
| `"Người dùng"` | `nav.item.users` |
| `"Phân quyền"` | `nav.item.permissions` |
| `"Role Builder"` | `nav.item.roleBuilder` |
| `"Audit Trail+"` | `nav.item.auditTrail` |
| `"API Docs"` | `nav.item.apiDocs` |
| `"Hướng dẫn"` | `nav.item.guide` |

### Navigation Item Descriptions
| Hardcoded String | Suggested Key |
|---|---|
| `"Bảng điều khiển sản xuất"` | `nav.itemDesc.overview` |
| `"Phân tích chi tiết từ KPI"` | `nav.itemDesc.drillDown` |
| `"Tổng quan đa nhà máy"` | `nav.itemDesc.corporateDashboard` |
| `"Quản lý cấu trúc tập đoàn"` | `nav.itemDesc.corporateStructure` |
| `"Real-time machine monitoring"` | `nav.itemDesc.machineStatus` |
| `"MQTT protocol monitoring"` | `nav.itemDesc.mqttMonitor` |
| `"Quản lý MQTT connections"` | `nav.itemDesc.mqttClients` |
| `"MQTT Topics & Messages"` | `nav.itemDesc.mqttTopics` |
| `"Phát lại tin nhắn MQTT"` | `nav.itemDesc.mqttReplay` |
| `"Cấu hình MQTT profiles"` | `nav.itemDesc.mqttProfiles` |
| `"Quản lý bản tin MQTT"` | `nav.itemDesc.mqttBulletin` |
| `"Overall Equipment Effectiveness"` | `nav.itemDesc.oeeDashboard` |
| `"Machine health analytics"` | `nav.itemDesc.machineHealth` |
| `"Xem danh sách cảnh báo"` | `nav.itemDesc.alertList` |
| `"Cấu hình quy tắc cảnh báo"` | `nav.itemDesc.alertRules` |
| `"AI-powered predictive alerts"` | `nav.itemDesc.predictiveAlerts` |
| `"Thiết lập mục tiêu OEE"` | `nav.itemDesc.oeeTargets` |
| `"Quản lý đơn hàng sản xuất"` | `nav.itemDesc.productionOrders` |
| `"Xem lịch sử kiểm tra"` | `nav.itemDesc.inspectionHistory` |
| `"Quản lý gói ảnh AOI"` | `nav.itemDesc.aoiImagePackages` |
| `"Lịch xuất báo cáo tự động"` | `nav.itemDesc.reportSchedule` |
| `"Xem và tạo báo cáo"` | `nav.itemDesc.reports` |
| `"Báo cáo tự động định kỳ"` | `nav.itemDesc.scheduledReports` |
| `"Phân tích theo loại lỗi"` | `nav.itemDesc.categoryAnalysis` |
| `"SPC & AI phân tích chất lượng"` | `nav.itemDesc.spcAiAnalysis` |
| *(many more — similar pattern)* | *(follow pattern `nav.itemDesc.*`)* |

---

## 26. NotificationCenter.tsx

| Hardcoded String | Suggested Key |
|---|---|
| `"Thông báo"` | `notification.title` |
| `"Xóa tất cả"` | `notification.clearAll` |
| `"Không có thông báo"` | `notification.empty` |
| `"Đánh dấu đã đọc"` | `notification.markRead` |

---

## 27. ConfirmDialog.tsx

| Hardcoded String | Suggested Key |
|---|---|
| `"Xác nhận"` | `confirm.title` |
| `"Hủy"` | `confirm.cancel` |
| `"Xác nhận xóa"` (DeleteConfirmDialog) | `confirm.deleteTitle` |
| `"Bạn có chắc muốn xóa"` | `confirm.deleteMessage` |
| `"Hành động này không thể hoàn tác"` | `confirm.deleteWarning` |
| `"Xóa"` | `confirm.delete` |
| `"Đang xóa..."` | `confirm.deleting` |

---

## 28. ErrorBoundary.tsx

| Hardcoded String | Suggested Key |
|---|---|
| `"Đã xảy ra lỗi"` | `error.title` |
| `"Đã xảy ra lỗi không mong muốn"` | `error.subtitle` |
| `"Thử lại"` | `error.retry` |
| `"Quay lại trang chủ"` | `error.goHome` |
| `"Something went wrong"` | `error.fallbackTitle` |
| `"An unexpected error occurred"` | `error.fallbackSubtitle` |
| `"Retry"` | `error.fallbackRetry` |

---

## Common Keys (shared across multiple files)

These strings appear repeatedly and should use shared translation keys:

| Common String | Suggested Key | Found In |
|---|---|---|
| `"Hủy"` | `common.cancel` | Settings, ProductModels, Layout, ConfirmDialog |
| `"Xóa"` | `common.delete` | Settings, Users, ProductModels |
| `"Tạo"` | `common.create` | Settings, ProductModels |
| `"Lưu"` | `common.save` | Settings, ProductModels, Profile |
| `"Chỉnh sửa"` | `common.edit` | Settings, Users, ProductModels |
| `"Mô tả"` | `common.description` | Settings, ProductModels, Layout |
| `"Đóng"` | `common.close` | ProductModels |
| `"Tất cả"` | `common.all` | Dashboard, History, Settings |
| `"Trạng thái"` | `common.status` | Multiple files |
| `"Thao tác"` | `common.actions` | Users, Settings, ProductionOrders |
| `"OK"` | `common.ok` | Dashboard, History |
| `"NG"` | `common.ng` | Dashboard, History |
| `"NTF"` | `common.ntf` | Dashboard, History |
| `"Yield"` | `common.yield` | Dashboard, History, Reports |
| `"Tổng"` | `common.total` | History, Reports |
| `"Máy"` | `common.machine` | History, Reports |
| `"Nhà máy"` | `common.factory` | Settings, Dashboard |
| `"Đang tải..."` | `common.loading` | Multiple files |
| `"Không có dữ liệu"` | `common.noData` | Multiple files |

---

## Summary Statistics

| Metric | Count |
|---|---|
| **Total files audited** | 28 |
| **Estimated unique hardcoded strings** | ~800+ |
| **Primary language** | Vietnamese |
| **Secondary language** | English (mixed) |
| **Files with mostly English strings** | NotFound, RoleManagement, ProcessManagement |
| **Largest files** | Settings.tsx (3528 lines), History.tsx (3037 lines), Dashboard.tsx (2699 lines), ProductModels.tsx (2102 lines) |

---

## Recommended Next Steps

1. **Set up i18n framework** (e.g., `react-i18next` or `next-intl`)
2. **Create translation files**: `vi.json` (Vietnamese) and `en.json` (English)
3. **Start with common keys** to maximize reuse
4. **Prioritize by file size**: Settings.tsx, History.tsx, Dashboard.tsx, ProductModels.tsx
5. **Extract toast messages** as a separate namespace (e.g., `toast.*`)
6. **Handle dynamic strings** (template literals with variables) using interpolation: `t('key', { var })`
