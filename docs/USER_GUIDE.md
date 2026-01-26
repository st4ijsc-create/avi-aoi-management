# Hướng Dẫn Sử Dụng Hệ Thống MES AVI/AOI

**Phiên bản:** 1.0.0  
**Ngày cập nhật:** 26/01/2026  
**Tác giả:** Manus AI

---

## Mục Lục

1. [Giới Thiệu](#1-giới-thiệu)
2. [Đăng Nhập và Bảo Mật](#2-đăng-nhập-và-bảo-mật)
3. [Dashboard Chính](#3-dashboard-chính)
4. [Quản Lý Tập Đoàn](#4-quản-lý-tập-đoàn)
5. [Giám Sát Máy](#5-giám-sát-máy)
6. [Lịch Sử Kiểm Tra](#6-lịch-sử-kiểm-tra)
7. [Phân Tích Chất Lượng](#7-phân-tích-chất-lượng)
8. [Báo Cáo](#8-báo-cáo)
9. [Cài Đặt Hệ Thống](#9-cài-đặt-hệ-thống)
10. [FAQ](#10-faq)

---

## 1. Giới Thiệu

Hệ thống Manufacturing Execution System (MES) cho quản lý máy AVI/AOI được thiết kế để giám sát và quản lý quy trình kiểm tra chất lượng trong nhà máy sản xuất. Hệ thống hỗ trợ quản lý đa cấp từ tập đoàn đến từng máy kiểm tra.

### 1.1 Các Tính Năng Chính

Hệ thống cung cấp các tính năng quan trọng cho việc quản lý sản xuất và kiểm tra chất lượng. Dashboard real-time hiển thị các chỉ số KPI quan trọng như Total Output, FPY (First Pass Yield), tỷ lệ OK/NG/NTF và Yield Rate. Người dùng có thể theo dõi trạng thái kết nối của tất cả máy AVI/AOI trong nhà máy, xem lịch sử kiểm tra chi tiết với hình ảnh và kết quả đo lường, cũng như nhận cảnh báo khi các chỉ số vượt ngưỡng cho phép.

### 1.2 Cấu Trúc Menu

Hệ thống được tổ chức thành 9 nhóm chức năng chính:

| Nhóm | Mô tả |
|------|-------|
| Dashboard | Tổng quan, Custom Dashboard, OEE |
| Giám sát | MQTT Monitor, Trạng thái máy, Layout |
| Cảnh báo | Cảnh báo hệ thống, Predictive Alerts |
| Sản xuất | Lệnh sản xuất, Sản phẩm, Công đoạn |
| Phân tích | Defect Heatmap, Root Cause, SPC |
| Dữ liệu | Lịch sử, Import/Export, Backup |
| Quy trình | Workstation, Process Management |
| Cài đặt | Cấu hình hệ thống, Ngưỡng cảnh báo |
| Quản trị | Users, Audit Logs, Sessions |

---

## 2. Đăng Nhập và Bảo Mật

### 2.1 Đăng Nhập

Để truy cập hệ thống, người dùng cần nhập tên đăng nhập và mật khẩu đã được cấp. Nếu tài khoản đã bật xác thực hai yếu tố (2FA), hệ thống sẽ yêu cầu nhập mã OTP từ ứng dụng authenticator.

### 2.2 Bật Xác Thực Hai Yếu Tố (2FA)

Để tăng cường bảo mật, người dùng nên bật 2FA theo các bước sau. Đầu tiên, vào **Profile** từ menu góc phải trên. Tiếp theo, chọn tab **Bảo mật** và nhấn **Bật 2FA**. Sau đó, quét mã QR bằng ứng dụng Google Authenticator hoặc Authy. Cuối cùng, nhập mã OTP để xác nhận.

### 2.3 Đổi Mật Khẩu

Người dùng có thể đổi mật khẩu bất cứ lúc nào bằng cách vào **Profile → Đổi mật khẩu**. Mật khẩu mới phải có ít nhất 8 ký tự và nên bao gồm chữ hoa, chữ thường, số và ký tự đặc biệt.

---

## 3. Dashboard Chính

### 3.1 KPI Cards

Dashboard chính hiển thị 6 KPI cards quan trọng ở phần trên cùng:

| KPI | Mô tả | Cách tính |
|-----|-------|-----------|
| Total Output | Tổng sản lượng | Tổng số sản phẩm đã kiểm tra |
| OK Count | Số lượng OK | Sản phẩm đạt chất lượng |
| NG Count | Số lượng NG | Sản phẩm không đạt |
| NTF Count | Số lượng NTF | False positive (lỗi giả) |
| FPY | First Pass Yield | OK / (OK + NG) × 100% |
| Yield Rate | Tỷ lệ đạt | (OK + NTF) / Total × 100% |

### 3.2 Cảnh Báo Yield

Phần **Cảnh báo Yield** hiển thị các máy có tỷ lệ yield thấp hơn ngưỡng cảnh báo. Mỗi cảnh báo hiển thị tên máy, tỷ lệ yield hiện tại và mức độ nghiêm trọng (Warning hoặc Critical).

### 3.3 Trạng Thái Kết Nối Máy

Phần này hiển thị tổng quan về trạng thái kết nối của tất cả máy trong hệ thống. Các trạng thái bao gồm Online (đang hoạt động), Offline (không kết nối), và Error (có lỗi).

### 3.4 Tabs Bổ Sung

Dashboard có 3 tabs bổ sung. Tab **Tổng quan** hiển thị biểu đồ xu hướng yield theo thời gian. Tab **NG Visual** hiển thị phân bố lỗi theo loại và vị trí. Tab **Layout Dây chuyền** hiển thị sơ đồ bố trí máy trên dây chuyền.

---

## 4. Quản Lý Tập Đoàn

### 4.1 Corporate Dashboard

Corporate Dashboard được thiết kế cho quản lý cấp cao, cung cấp cái nhìn tổng quan về hiệu suất của toàn tập đoàn. Dashboard hiển thị dữ liệu theo 3 cấp độ: Tập đoàn, Công ty và Nhà máy.

### 4.2 So Sánh Hiệu Suất

Người dùng có thể so sánh hiệu suất giữa các nhà máy thông qua biểu đồ so sánh. Các chỉ số so sánh bao gồm Output, Yield Rate, OEE và Downtime.

### 4.3 Drill-Down

Từ Corporate Dashboard, người dùng có thể drill-down xuống từng cấp độ để xem chi tiết. Click vào một công ty để xem danh sách nhà máy, click vào nhà máy để xem danh sách dây chuyền, và tiếp tục drill-down đến từng máy.

---

## 5. Giám Sát Máy

### 5.1 MQTT Monitor

MQTT Monitor cho phép theo dõi real-time các message từ máy AVI/AOI. Giao diện có 3 tabs chính:

**Live Stream** hiển thị các message đang được gửi từ máy theo thời gian thực. Người dùng có thể bật/tắt WebSocket để chọn giữa real-time updates hoặc polling.

**History** cho phép xem lại lịch sử các message đã gửi. Người dùng có thể filter theo thời gian, topic hoặc loại message.

**Auto-Discovery** hiển thị các máy mới kết nối vào hệ thống đang chờ phê duyệt.

### 5.2 Trạng Thái Máy

Trang **Trạng thái máy** hiển thị danh sách tất cả máy với thông tin chi tiết. Mỗi máy hiển thị trạng thái kết nối, thời gian heartbeat gần nhất, và các thông số như CPU, Memory, Temperature (nếu có).

### 5.3 Layout 2D/3D

Trang **Layout** hiển thị sơ đồ bố trí máy trong nhà xưởng. Người dùng có thể xem vị trí của từng máy trên layout và click vào máy để xem thông tin chi tiết.

---

## 6. Lịch Sử Kiểm Tra

### 6.1 Tìm Kiếm

Trang **Lịch sử** cho phép tìm kiếm các bản ghi kiểm tra với nhiều bộ lọc. Người dùng có thể filter theo Serial Number, Product Model, Machine, Result (OK/NG/NTF), và khoảng thời gian.

### 6.2 Xem Chi Tiết

Click vào một bản ghi để xem chi tiết inspection. Trang chi tiết hiển thị hình ảnh sản phẩm, kết quả đo lường từng điểm, và annotations (nếu có).

### 6.3 Bulk Operations

Hệ thống hỗ trợ các thao tác hàng loạt. Người dùng có thể chọn nhiều bản ghi bằng checkbox, sau đó thực hiện **Bulk Export** để xuất ra CSV/Excel hoặc **Bulk Acknowledge** để xác nhận hàng loạt.

### 6.4 NTF Confirmation

Khi phát hiện false positive (máy báo NG nhưng thực tế sản phẩm OK), người dùng có thể đánh dấu bản ghi là NTF. Vào chi tiết inspection, nhấn **Đánh dấu NTF**, nhập lý do và xác nhận.

---

## 7. Phân Tích Chất Lượng

### 7.1 Defect Heatmap

**Defect Heatmap** hiển thị phân bố lỗi trên layout nhà máy. Các vùng có nhiều lỗi sẽ được tô màu đỏ đậm, giúp nhanh chóng xác định các điểm nóng cần chú ý.

### 7.2 Defect Prediction

**Defect Prediction** sử dụng AI để dự đoán xu hướng lỗi trong tương lai. Hệ thống phân tích dữ liệu lịch sử và đưa ra dự báo với độ tin cậy.

### 7.3 Root Cause Analysis

**Root Cause Analysis** giúp xác định nguyên nhân gốc rễ của các vấn đề chất lượng. Hệ thống sử dụng phân tích Pareto và AI để đề xuất các nguyên nhân và giải pháp.

### 7.4 SPC Analysis

**SPC Analysis** (Statistical Process Control) cung cấp các biểu đồ kiểm soát quá trình. Người dùng có thể xem Control Charts, Capability Analysis và Process Performance.

---

## 8. Báo Cáo

### 8.1 Báo Cáo Tức Thì

Trang **Reports** cho phép tạo báo cáo tức thì với nhiều loại. Các loại báo cáo bao gồm Production Summary, Quality Analysis, Machine Performance và OEE Report.

### 8.2 Báo Cáo Tự Động

**Scheduled Reports** cho phép lên lịch gửi báo cáo tự động. Người dùng có thể cấu hình tần suất (Daily, Weekly, Monthly), danh sách người nhận email, và các bộ lọc dữ liệu.

### 8.3 Export Scheduling

**History Export Scheduling** cho phép lên lịch xuất dữ liệu lịch sử tự động. Dữ liệu có thể xuất ra CSV, Excel hoặc JSON và gửi qua email.

---

## 9. Cài Đặt Hệ Thống

### 9.1 Cấu Hình Hệ Thống

**System Configuration** cho phép admin cấu hình các thông số hệ thống. Các cấu hình bao gồm tên hệ thống, timezone, ngôn ngữ mặc định và các thông số kỹ thuật.

### 9.2 Ngưỡng Cảnh Báo

**Yield Alert Thresholds** cho phép thiết lập ngưỡng cảnh báo cho các chỉ số. Mỗi chỉ số có 2 ngưỡng: Warning (cảnh báo) và Critical (nghiêm trọng).

| Chỉ số | Warning | Critical |
|--------|---------|----------|
| FPY | < 95% | < 90% |
| Yield Rate | < 98% | < 95% |
| UPH | < 80% target | < 70% target |

### 9.3 Ca Làm Việc

**Shift Configuration** cho phép cấu hình các ca làm việc. Mỗi ca có thời gian bắt đầu và kết thúc, và có thể áp dụng cho toàn hệ thống hoặc từng nhà máy.

### 9.4 OEE Targets

**OEE Target Settings** cho phép thiết lập mục tiêu OEE. Các mục tiêu bao gồm Availability, Performance, Quality và Overall OEE.

---

## 10. FAQ

### Q: Làm sao để thêm máy mới vào hệ thống?

A: Vào **Cài đặt → Setup → Machines**, nhấn **Thêm máy mới**, điền thông tin và lưu. Hệ thống sẽ tạo API Key cho máy. Cấu hình API Key này trên máy AVI/AOI để bắt đầu gửi dữ liệu.

### Q: Tại sao tỷ lệ Yield khác với FPY?

A: FPY (First Pass Yield) chỉ tính OK/(OK+NG), không bao gồm NTF. Yield Rate tính (OK+NTF)/Total, bao gồm cả các trường hợp false positive đã được xác nhận.

### Q: Làm sao để xuất dữ liệu ra Excel?

A: Vào **Lịch sử**, sử dụng bộ lọc để chọn dữ liệu cần xuất, sau đó nhấn nút **Export** và chọn định dạng Excel.

### Q: WebSocket và Polling khác nhau như thế nào?

A: WebSocket cung cấp cập nhật real-time ngay lập tức, nhưng tiêu tốn nhiều tài nguyên hơn. Polling cập nhật theo chu kỳ (mặc định 30 giây), tiết kiệm tài nguyên hơn. Chọn WebSocket khi cần theo dõi real-time, chọn Polling khi chỉ cần xem tổng quan.

### Q: Làm sao để backup dữ liệu?

A: Vào **Dữ liệu → Backup & Restore**, chọn các danh mục cần backup và nhấn **Tạo Backup**. Có thể lên lịch backup tự động trong phần **Scheduled Backups**.

---

*Tài liệu này được tạo bởi Manus AI. Phiên bản: 1.0.0*
