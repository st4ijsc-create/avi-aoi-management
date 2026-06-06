# Cài đặt Analytics (Analytics Settings)

## 1. Mục đích
Trung tâm quản trị các cấu hình analytics nâng cao: lịch chạy báo cáo, mẫu PDF, Report Builder, xuất PowerPoint, SPC nâng cao, Correlation, Quality Gates Templates, Annotations, Predictions.

## 2. Vị trí truy cập
- URL: `/analytics-setting`
- Menu: Analytics → Analytics Settings

## 3. Quyền yêu cầu
- Chỉ `admin` (`user?.role === "admin"`)

## 4. Tiền điều kiện
- Đăng nhập bằng tài khoản admin
- Các sub-page (Scheduled Reports, Quality Gate Templates...) đã được build

## 5. Các bước thao tác
1. Vào `/analytics-setting`, sidebar hiển thị các nhóm có thể mở rộng
2. Chọn `Scheduled Reports` → tạo lịch (name, frequency=daily/weekly, time)
3. Chọn `PDF Reports` → cấu hình mẫu PDF
4. Chọn `Report Builder` → tạo báo cáo tuỳ biến với các block
5. Chọn `Quality Gate Templates` → định nghĩa rule (vd: solder bridges < 5%)
6. Lưu thay đổi → áp dụng toàn hệ thống

## 6. Kết quả mong đợi
- Sidebar mở rộng đúng nhóm
- Sub-page lazy load thành công, không lỗi error boundary
- Cấu hình lưu DB và có hiệu lực ngay

## 7. Lỗi thường gặp & cách xử lý
- Non-admin truy cập → hiển thị thông báo từ chối quyền
- Sub-page lỗi tải → error boundary hiển thị fallback, refresh trang
- Scheduled job không chạy → kiểm tra job worker / cron service

## 8. API liên quan
- `trpc.scheduledReports.*`
- `trpc.pdfReports.*`
- `trpc.qualityGateTemplates.*`
- (Các sub-page tự gọi tRPC riêng)

## 9. Tính năng liên quan
- [Reports](analytics/reports.md)
- [AI Quality Gate](ai/ai-quality-gate.md)
- [SPC Analysis](analytics/spc-analysis.md)

## 10. Ví dụ thực tế
Admin tạo lịch `Daily Yield` chạy 06:00 hàng ngày, gửi PDF đến email ban giám đốc. Đồng thời định nghĩa template Quality Gate `PCB Std` với rule `solder bridges < 5%, missing pads < 2%` → áp dụng cho dây chuyền SMT line 1.
