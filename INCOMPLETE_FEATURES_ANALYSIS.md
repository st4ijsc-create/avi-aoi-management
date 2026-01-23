# AVI/AOI Management System - Phân Tích Chức Năng Chưa Hoàn Thiện

**Ngày phân tích:** 23/01/2026

**Tổng quan:**
- Tổng số task đã hoàn thành: **1,127**
- Tổng số task chưa hoàn thành: **322**
- Tỷ lệ hoàn thành: **77.8%**

---

## Phân Loại Theo Priority

### 🔴 CRITICAL - Cần hoàn thiện ngay (Bảo mật & Core Business)

| # | Chức năng | Mô tả | Phase |
|---|-----------|-------|-------|
| 1 | 2FA Login Flow | Thêm bước xác thực OTP khi đăng nhập nếu đã bật 2FA | Phase 50 |
| 2 | 2FA Profile UI | Cập nhật trang Profile với giao diện bật/tắt 2FA | Phase 50 |
| 3 | Backup Codes UI | UI hiển thị và tải xuống backup codes | Phase 51 |
| 4 | Session Management | API list, revoke sessions và UI quản lý phiên đăng nhập | Phase 51 |
| 5 | Audit Logs | Tạo bảng audit_logs và ghi log các thao tác quan trọng | Phase 49 |
| 6 | Access Control Testing | Test access control với non-admin user | Phase 91 |

### 🟠 HIGH - Quan trọng cho nghiệp vụ (SPC/MMS/IoT)

| # | Chức năng | Mô tả | Phase |
|---|-----------|-------|-------|
| 1 | AI Analysis | AI-powered trend prediction, anomaly detection, root cause analysis | Phase 19 |
| 2 | Top NG Measurement Points | Phân tích top điểm đo có lỗi cao nhất | Phase 16 |
| 3 | Workstation Analysis | Thêm trường công trạm vào measurement_point_defs, biểu đồ phân bố lỗi | Phase 52 |
| 4 | Production Order Gantt | Timeline các lệnh sản xuất theo dây chuyền | Phase 25 |
| 5 | Process/Stage Management | CRUD cho công đoạn với drag-drop sắp xếp | Phase 25 |
| 6 | Barcode Scanner | Tích hợp camera scanner trong History page | Phase 25 |
| 7 | Multi-tenant Access Control | User assignment cho corporate/factory | Phase 88-91 |
| 8 | Dashboard Drill-down | Click vào chart để xem chi tiết factory/machine | Phase 91-92 |

### 🟡 MEDIUM - Cải thiện UX và Reporting

| # | Chức năng | Mô tả | Phase |
|---|-----------|-------|-------|
| 1 | History Comparison Mode | So sánh 2 time periods | Phase 22 |
| 2 | Batch Operations | Xử lý hàng loạt (bulk export, bulk acknowledge) | Phase 22 |
| 3 | Inspection Image Gallery | Xem gallery ảnh inspection | Phase 22 |
| 4 | Defect Classification | Phân loại lỗi chi tiết | Phase 22 |
| 5 | PDF Export với Charts | Export History và Reports sang PDF | Phase 22 |
| 6 | Report Templates | Daily, Weekly, Monthly templates | Phase 22 |
| 7 | Trend Analysis Report | Weekly/monthly/quarterly trends | Phase 22 |
| 8 | Quality Cost Analysis | Phân tích chi phí chất lượng | Phase 22 |
| 9 | Pareto Analysis | Pareto chart theo defect type | Phase 22 |
| 10 | Scheduled Report Generation | Tự động generate reports | Phase 22 |
| 11 | Layout Drag-drop | Drag-drop sắp xếp máy trong layout | Phase 25 |
| 12 | Layout Fullscreen | Chế độ xem fullscreen cho Layout | Phase 40 |
| 13 | Machine Status Filter | Filter Online/Offline trong Layout | Phase 40 |
| 14 | Products Search & Filter | Search, filter, sort cho Products page | Phase 72 |
| 15 | Machine 2D Image Upload | Upload ảnh 2D cho máy trong Settings | Phase 72 |

### 🟢 LOW - Nice to have (Enhancement)

| # | Chức năng | Mô tả | Phase |
|---|-----------|-------|-------|
| 1 | Product Comparison View | So sánh 2 sản phẩm | Phase 22 |
| 2 | Product Documentation | Đính kèm tài liệu cho sản phẩm | Phase 22 |
| 3 | Import/Export Product Definitions | Excel/JSON import/export | Phase 22 |
| 4 | Measurement Point Templates | Templates cho các loại sản phẩm | Phase 22 |
| 5 | Bulk Import Measurement Points | Upload Excel file | Phase 22 |
| 6 | Corporate Map Capacity | Visualization công suất | Phase 22 |
| 7 | Alert Summary by Region | Tổng hợp cảnh báo theo vùng | Phase 22 |
| 8 | Search History | Lưu lịch sử tìm kiếm | Phase 22 |
| 9 | Settings Form Validation | Validation cho các form trong Settings | Phase 64 |
| 10 | Undo Delete | Tích hợp undo vào các hành động xóa | Phase 66 |
| 11 | NG Trend Chart | Biểu đồ xu hướng lỗi theo thời gian | Phase 68 |

---

## Các Task Trùng Lặp (Cần Loại Bỏ)

Nhiều task trong todo.md bị trùng lặp giữa các phase khác nhau. Các task sau đã được hoàn thành nhưng vẫn còn trong danh sách chưa hoàn thành ở các phase cũ:

1. **CRUD Operations** (Phase 87): Đã hoàn thành trong Phase 14-15
2. **Dashboard Statistics** (Phase 87): Đã hoàn thành trong Phase 88
3. **Import/Export** (Phase 88): Đã hoàn thành trong Phase 89
4. **Server-side Caching** (Phase 92): Đã hoàn thành trong Phase 93-94
5. **Dashboard Drill-down** (Phase 91-92): Đã hoàn thành trong Phase 92-93

---

## Kế Hoạch Hoàn Thiện Đề Xuất

### Phase 104: Security & Authentication (1-2 ngày)
1. ✅ 2FA Login Flow - Thêm OTP verification khi login
2. ✅ 2FA Profile UI - Giao diện bật/tắt 2FA
3. ✅ Backup Codes UI - Hiển thị và download backup codes
4. ✅ Session Management - List và revoke sessions
5. ✅ Audit Logs - Ghi log các thao tác quan trọng

### Phase 105: AI Analysis & SPC Enhancement (2-3 ngày)
1. AI-powered trend prediction
2. Anomaly detection với statistical methods
3. Root cause analysis suggestions
4. Quality improvement recommendations
5. Top NG measurement points analysis

### Phase 106: Production Management (2-3 ngày)
1. Process/Stage Management CRUD
2. Production Order Gantt Chart
3. Workstation Analysis Enhancement
4. Barcode Scanner Integration

### Phase 107: Reporting & Export (1-2 ngày)
1. PDF Export với Charts
2. Report Templates (Daily/Weekly/Monthly)
3. Scheduled Report Generation
4. Trend Analysis Report

### Phase 108: UX Improvements (1-2 ngày)
1. History Comparison Mode
2. Batch Operations
3. Layout Drag-drop Enhancement
4. Products Search & Filter

### Phase 109: Multi-tenant & Access Control (2-3 ngày)
1. User Assignment UI
2. Access Control Testing
3. Dashboard Drill-down Enhancement
4. Corporate/Factory Filter

---

## Tổng Kết

**Ưu tiên cao nhất:**
1. Security features (2FA, Session Management, Audit Logs)
2. AI Analysis & SPC Enhancement
3. Production Management features

**Có thể bỏ qua hoặc làm sau:**
1. Các task trùng lặp đã hoàn thành
2. Nice-to-have features (Product Comparison, Documentation attachments)
3. Advanced features chưa có yêu cầu cụ thể từ user

**Thời gian ước tính:** 10-15 ngày làm việc để hoàn thiện tất cả các chức năng quan trọng.
