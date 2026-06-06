# Phân tích Inspection AI (AI Inspection Analytics)

## 1. Mục đích
Dashboard tích hợp 6 góc nhìn về dữ liệu inspection: Overview, Trend, Machines, SPC, Forecast, Risk — sử dụng batch query để tải song song nhiều phân tích.

## 2. Vị trí truy cập
- URL: `/ai-inspection-analytics`
- Menu: AI → Inspection Analytics

## 3. Quyền yêu cầu
- Tính năng AI Analytics

## 4. Tiền điều kiện
- Có dữ liệu inspections, machines
- Period config có hiệu lực

## 5. Các bước thao tác
1. Mở trang, chọn date range (lưu localStorage `aiInspAnalytics_period`)
2. Tab `Overview` xem stats tổng + biểu đồ
3. Tab `Trend` xem yield/defect theo thời gian
4. Tab `Machines` xem ranked theo yield
5. Tab `SPC` xem Pareto + control chart
6. Tab `Forecast` AI dự báo defect rate 7 ngày
7. Tab `Risk` heatmap rủi ro theo line/machine

## 6. Kết quả mong đợi
- Tabs lazy-load, batch parallel
- Period persist qua reload
- Charts đồng bộ filter

## 7. Lỗi thường gặp & cách xử lý
- Slow batch query → cache 30s, hoặc chia nhỏ tab queries
- Forecast trống → cần ≥ 30 điểm
- Empty state cho từng tab khi không có data

## 8. API liên quan
- Hook `useAnalyticsBatch(period, { overview, trend, machines, spc, forecast, risk })`

## 9. Tính năng liên quan
- [Reports](analytics/reports.md)
- [SPC Analysis](analytics/spc-analysis.md)
- [AI Time Series](ai/ai-time-series.md)

## 10. Ví dụ thực tế
Manager chọn 30 ngày, Overview thấy yield 94.2%. Tab Machines: SMT-03 yield 88% xếp cuối. Tab Risk heatmap: line 2 ca tối đỏ → đề xuất audit ca tối tuần tới.

## 11. Q&A nhanh

**Q: AI Inspection Analytics là gì?**
A: Trang `/ai-inspection-analytics` gồm 6 tab (Overview, Trend, Machines, SPC, Forecast, Risk) hiển thị phân tích dữ liệu inspection bằng batch query song song. Forecast dự báo defect rate 7 ngày; Risk hiển thị heatmap rủi ro theo line/machine/ca.

**Q: Có bao nhiêu tab trong AI Inspection Analytics?**
A: 6 tab: `Overview`, `Trend`, `Machines`, `SPC`, `Forecast`, `Risk`.

**Q: Cần bao nhiêu dữ liệu để có dự báo?**
A: Tối thiểu 30 điểm dữ liệu lịch sử; nếu ít hơn tab Forecast sẽ trống.
