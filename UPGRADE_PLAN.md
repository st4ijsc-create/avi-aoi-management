# AVI/AOI Management System - Kế Hoạch Hoàn Thiện

**Ngày lập kế hoạch:** 23/01/2026  
**Tác giả:** Manus AI  
**Phiên bản:** 1.0

---

## Tổng Quan Dự Án

Hệ thống AVI/AOI Factory Management System hiện đã hoàn thành **77.8%** với 1,127 task đã hoàn thành và 322 task còn lại. Tài liệu này trình bày kế hoạch chi tiết để hoàn thiện các chức năng còn thiếu, được phân loại theo thứ tự ưu tiên dựa trên yêu cầu nghiệp vụ.

### Nguyên Tắc Ưu Tiên

Theo phương pháp ưu tiên đã được xác định, các task được sắp xếp theo thứ tự sau:

1. **Bug fixes** - Sửa lỗi hiện có
2. **Core Business/Functional** - Chức năng nghiệp vụ cốt lõi (SPC → MMS → IoT → Production Line)
3. **Reporting & Statistics** - Báo cáo và thống kê
4. **Documentation & Training** - Tài liệu và đào tạo

---

## Phase 104: Security & Authentication Enhancement

**Thời gian ước tính:** 2-3 ngày  
**Độ ưu tiên:** 🔴 CRITICAL

### Mục Tiêu

Hoàn thiện các tính năng bảo mật quan trọng để đảm bảo hệ thống an toàn cho môi trường sản xuất.

### Danh Sách Task

| # | Task | Mô tả | Ước tính |
|---|------|-------|----------|
| 1 | 2FA Login Flow | Thêm bước xác thực OTP khi đăng nhập nếu user đã bật 2FA | 4h |
| 2 | 2FA Profile UI | Cập nhật trang Profile với giao diện bật/tắt 2FA, hiển thị QR code | 3h |
| 3 | Backup Codes | UI hiển thị và tải xuống backup codes khi bật 2FA | 2h |
| 4 | Session Management API | API list sessions, revoke session, revoke all sessions | 3h |
| 5 | Session Management UI | UI quản lý phiên đăng nhập trong Profile | 2h |
| 6 | Audit Logs Table | Tạo bảng audit_logs trong database | 1h |
| 7 | Audit Logging | Ghi log đăng nhập, CRUD operations quan trọng | 3h |
| 8 | Audit Logs UI | Tạo UI xem audit log trong Settings (admin only) | 2h |

### Deliverables

- 2FA hoàn chỉnh với TOTP và backup codes
- Session management với khả năng revoke từ xa
- Audit trail cho các thao tác quan trọng

---

## Phase 105: SPC/CPK Enhancement & AI Analysis

**Thời gian ước tính:** 3-4 ngày  
**Độ ưu tiên:** 🟠 HIGH

### Mục Tiêu

Nâng cao khả năng phân tích SPC và tích hợp AI để dự đoán xu hướng chất lượng.

### Danh Sách Task

| # | Task | Mô tả | Ước tính |
|---|------|-------|----------|
| 1 | Top NG Analysis | Phân tích top điểm đo có lỗi cao nhất với Pareto chart | 4h |
| 2 | Trend Prediction | AI-powered trend prediction sử dụng statistical methods | 6h |
| 3 | Anomaly Detection | Phát hiện bất thường với z-score và moving average | 4h |
| 4 | Root Cause Suggestions | Đề xuất nguyên nhân gốc rễ dựa trên pattern analysis | 4h |
| 5 | Quality Recommendations | Đề xuất cải thiện chất lượng dựa trên dữ liệu | 3h |
| 6 | Correlation Analysis | Phân tích tương quan giữa các điểm đo | 3h |
| 7 | Workstation Analysis | Thêm trường công trạm vào measurement_point_defs | 2h |
| 8 | Workstation Stats | Biểu đồ phân bố lỗi theo công trạm | 3h |

### Deliverables

- Dashboard phân tích SPC nâng cao
- AI-powered insights và recommendations
- Workstation-level analysis

---

## Phase 106: Production Management

**Thời gian ước tính:** 3-4 ngày  
**Độ ưu tiên:** 🟠 HIGH

### Mục Tiêu

Hoàn thiện module quản lý sản xuất với Gantt chart và quản lý công đoạn.

### Danh Sách Task

| # | Task | Mô tả | Ước tính |
|---|------|-------|----------|
| 1 | Process/Stage Table | Tạo bảng processes trong database | 1h |
| 2 | Process CRUD | CRUD cho công đoạn (tên, mã, thứ tự, mô tả) | 4h |
| 3 | Process Drag-drop | Drag-drop để sắp xếp thứ tự công đoạn | 3h |
| 4 | Process-Line Link | Liên kết công đoạn với dây chuyền | 2h |
| 5 | Gantt Tab | Thêm tab Gantt trong Production Orders page | 2h |
| 6 | Gantt Timeline | Hiển thị timeline các lệnh sản xuất theo dây chuyền | 6h |
| 7 | Gantt Zoom | Zoom in/out timeline (ngày/tuần/tháng) | 2h |
| 8 | Barcode Scanner | Tích hợp camera scanner trong History page | 4h |
| 9 | Manual SN Input | Hỗ trợ nhập thủ công nếu không quét được | 1h |

### Deliverables

- Module quản lý công đoạn sản xuất
- Gantt chart cho production orders
- Barcode scanner integration

---

## Phase 107: Reporting & Export Enhancement

**Thời gian ước tính:** 2-3 ngày  
**Độ ưu tiên:** 🟡 MEDIUM

### Mục Tiêu

Nâng cao khả năng báo cáo và export với templates và scheduled reports.

### Danh Sách Task

| # | Task | Mô tả | Ước tính |
|---|------|-------|----------|
| 1 | PDF Export Charts | Export History và Reports sang PDF với charts | 4h |
| 2 | Report Templates | Tạo templates cho Daily, Weekly, Monthly reports | 4h |
| 3 | Scheduled Reports | Tự động generate reports theo lịch | 4h |
| 4 | Trend Analysis | Weekly/monthly/quarterly trend reports | 3h |
| 5 | Quality Cost | Phân tích chi phí chất lượng | 3h |
| 6 | Pareto by Defect | Pareto chart theo defect type | 2h |
| 7 | Export Branding | Thêm logo và branding vào exports | 2h |

### Deliverables

- PDF export với charts và branding
- Report templates system
- Scheduled report generation

---

## Phase 108: UX Improvements

**Thời gian ước tính:** 2 ngày  
**Độ ưu tiên:** 🟡 MEDIUM

### Mục Tiêu

Cải thiện trải nghiệm người dùng với các tính năng tiện ích.

### Danh Sách Task

| # | Task | Mô tả | Ước tính |
|---|------|-------|----------|
| 1 | History Comparison | So sánh 2 time periods trong History | 4h |
| 2 | Batch Operations | Bulk export, bulk acknowledge | 3h |
| 3 | Inspection Gallery | Xem gallery ảnh inspection | 2h |
| 4 | Defect Classification | Phân loại lỗi chi tiết | 3h |
| 5 | Layout Drag-drop | Drag-drop sắp xếp máy trong layout | 3h |
| 6 | Layout Fullscreen | Chế độ xem fullscreen cho Layout | 1h |
| 7 | Machine Status Filter | Filter Online/Offline trong Layout | 1h |
| 8 | Products Search | Search, filter, sort cho Products page | 2h |

### Deliverables

- History comparison mode
- Batch operations support
- Layout enhancements

---

## Phase 109: Multi-tenant & Access Control

**Thời gian ước tính:** 3 ngày  
**Độ ưu tiên:** 🟠 HIGH

### Mục Tiêu

Hoàn thiện hệ thống phân quyền multi-tenant cho corporate/factory.

### Danh Sách Task

| # | Task | Mô tả | Ước tính |
|---|------|-------|----------|
| 1 | User Assignment API | CRUD endpoints cho user assignments | 4h |
| 2 | User Assignment UI | UI quản lý phân quyền user | 4h |
| 3 | Access Control Middleware | Middleware checkCorporateAccess, checkFactoryAccess | 3h |
| 4 | Endpoint Updates | Cập nhật tất cả endpoints với access control | 4h |
| 5 | Dashboard Drill-down | Click vào chart để xem chi tiết factory/machine | 4h |
| 6 | Breadcrumb Navigation | Navigation cho drill-down views | 2h |
| 7 | Access Control Testing | Test với non-admin user | 2h |

### Deliverables

- Complete multi-tenant access control
- User assignment management
- Dashboard drill-down navigation

---

## Phase 110: Import/Export & Data Management

**Thời gian ước tính:** 2 ngày  
**Độ ưu tiên:** 🟢 LOW

### Mục Tiêu

Tạo khả năng import/export dữ liệu hàng loạt.

### Danh Sách Task

| # | Task | Mô tả | Ước tính |
|---|------|-------|----------|
| 1 | Import Router | Endpoints: importFactories, importWorkshops, importMachines | 4h |
| 2 | Export Router | Endpoints: exportInspections, exportStatistics | 3h |
| 3 | Import Validation | Validation và error handling cho import | 2h |
| 4 | Import/Export UI | UI với file upload và download templates | 3h |
| 5 | Progress Indicator | Progress bar cho bulk operations | 1h |
| 6 | Product Import/Export | Import/Export product definitions (Excel/JSON) | 3h |

### Deliverables

- Bulk import/export functionality
- Excel templates
- Progress tracking

---

## Timeline Tổng Hợp

| Phase | Tên | Thời gian | Ngày bắt đầu | Ngày kết thúc |
|-------|-----|-----------|--------------|---------------|
| 104 | Security & Authentication | 3 ngày | 24/01/2026 | 26/01/2026 |
| 105 | SPC/CPK & AI Analysis | 4 ngày | 27/01/2026 | 30/01/2026 |
| 106 | Production Management | 4 ngày | 31/01/2026 | 03/02/2026 |
| 107 | Reporting & Export | 3 ngày | 04/02/2026 | 06/02/2026 |
| 108 | UX Improvements | 2 ngày | 07/02/2026 | 08/02/2026 |
| 109 | Multi-tenant Access Control | 3 ngày | 09/02/2026 | 11/02/2026 |
| 110 | Import/Export | 2 ngày | 12/02/2026 | 13/02/2026 |

**Tổng thời gian:** 21 ngày làm việc (khoảng 1 tháng)

---

## Các Task Có Thể Bỏ Qua

Các task sau được đánh giá là nice-to-have và có thể bỏ qua hoặc làm sau:

1. **Product Comparison View** - So sánh 2 sản phẩm (ít sử dụng)
2. **Product Documentation Attachments** - Đính kèm tài liệu (có thể dùng external tools)
3. **Measurement Point Templates** - Templates cho các loại sản phẩm (có thể clone)
4. **Corporate Map Capacity** - Visualization công suất (advanced feature)
5. **Alert Summary by Region** - Tổng hợp cảnh báo theo vùng (có thể dùng filters)
6. **Search History** - Lưu lịch sử tìm kiếm (browser handles this)

---

## Các Task Trùng Lặp Cần Loại Bỏ

Nhiều task trong todo.md đã được hoàn thành nhưng vẫn còn trong danh sách chưa hoàn thành ở các phase cũ. Các task sau cần được đánh dấu là đã hoàn thành:

1. **CRUD Operations** (Phase 87) - Đã hoàn thành trong Phase 14-15
2. **Dashboard Statistics** (Phase 87) - Đã hoàn thành trong Phase 88
3. **Server-side Caching** (Phase 92) - Đã hoàn thành trong Phase 93-94

---

## Ghi Chú Kỹ Thuật

### Database Considerations

Hệ thống hiện đang sử dụng MySQL/TiDB. Theo yêu cầu về large-scale deployment, nên xem xét migration sang PostgreSQL trong tương lai để có performance và scalability tốt hơn.

### Socket Configuration

Tính năng WebSocket/MQTT đã được implement với toggle on/off và default là off. Khi deploy production, cần enable và configure phù hợp với infrastructure.

### Multi-language Support

Hệ thống đã hỗ trợ đa ngôn ngữ (i18n). Khi thêm tính năng mới, cần đảm bảo thêm translations cho tất cả các ngôn ngữ được hỗ trợ.

---

## Kết Luận

Kế hoạch này đề xuất hoàn thiện hệ thống trong khoảng 21 ngày làm việc, tập trung vào các chức năng quan trọng nhất theo thứ tự ưu tiên. Các task được phân loại rõ ràng theo mức độ ưu tiên và có thể điều chỉnh linh hoạt dựa trên yêu cầu thực tế của dự án.

**Tổng số task cần hoàn thiện:** 40 task chính (từ 322 task ban đầu sau khi loại bỏ trùng lặp và nice-to-have)

**Tỷ lệ hoàn thành dự kiến sau kế hoạch:** 95%+
