# Báo cáo AI (AI Reports)

## 1. Mục đích
Sinh báo cáo bằng AI/LLM: Daily Summary, RCA Report, Model Performance, Executive Summary — tổng hợp dữ liệu + phân tích nguyên nhân + đưa khuyến nghị bằng ngôn ngữ tự nhiên.

## 2. Vị trí truy cập
- URL: `/ai-reports`
- Menu: AI → AI Reports

## 3. Quyền yêu cầu
- Tính năng AI

## 4. Tiền điều kiện
- Có dữ liệu inspections trong khoảng thời gian
- LLM provider hoạt động

## 5. Các bước thao tác
1. Mở `/ai-reports`, chọn khoảng ngày
2. Chọn tab: Daily Summary / RCA Report / Model Performance / Executive Summary
3. Click `Generate` → API gọi LLM với dữ liệu inspection
4. Đọc narrative + stats + recommendations
5. Click `Export` → tải PDF/DOCX
6. Lưu báo cáo để truy xuất sau

## 6. Kết quả mong đợi
- Narrative tiếng Việt mạch lạc
- Stats khớp dữ liệu thực
- Recommendations cụ thể, actionable

## 7. Lỗi thường gặp & cách xử lý
- Range quá lớn → timeout, thu hẹp ngày
- Không có dữ liệu → "No inspections in this period"
- LLM fail → fallback template với stats only

## 8. API liên quan
- `trpc.aiReport.dailySummary({ startDate, endDate })`
- `trpc.aiReport.rcaReport({ startDate, endDate })`
- `trpc.aiReport.modelPerformance({ startDate, endDate })`
- `trpc.aiReport.executiveSummary({ startDate, endDate })`

## 9. Tính năng liên quan
- [Reports](analytics/reports.md)
- [SPC Analysis](analytics/spc-analysis.md)
- [AI Performance](ai/ai-performance.md)

## 10. Ví dụ thực tế
Manager chọn 2026-05-01 → 2026-05-12, tab Daily Summary → AI sinh: "Yield 94.2%, giảm 0.8% so với tuần trước. Lỗi chính: solder bridges 38%, missing pads 25%. Khuyến nghị: kiểm tra reflow profile". Xuất PDF gửi giám đốc nhà máy.
