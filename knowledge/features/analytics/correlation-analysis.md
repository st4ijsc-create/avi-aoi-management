# Phân tích Tương quan (Correlation Analysis)

## Mục đích
Tính hệ số tương quan (Pearson, Spearman) giữa các biến quá trình (sensor, throughput, NG rate, temperature, humidity) để khám phá mối quan hệ ẩn.

## Vị trí truy cập
- Menu: `Analytics` › `Correlation`
- URL: `/analytics/correlation`
- Vai trò: admin, engineer, data-analyst

## Quyền yêu cầu
- Resource: `analytics_spc`
- Actions: `view`
- Middleware: `requirePermission('analytics_spc')`

## Tiền điều kiện
- Có ≥ 2 biến số liên tục trong cùng dataset.
- Đủ samples (n ≥ 100 khuyến nghị).

## Các bước thao tác
1. **Chọn dataset** — Inspection data, sensor data, hoặc combined.
2. **Chọn biến** — Multi-select: NG Rate, Cycle Time, Temp, Humidity, Voltage, Operator Score...
3. **Chọn method** — Pearson (linear), Spearman (rank), Kendall.
4. **Run** — Nút `Compute`.
5. **Xem ma trận** — Heatmap correlation -1..+1, click cell → scatter plot 2 biến.
6. **Lọc significance** — Toggle hiện p-value < 0.05.
7. **Export** — CSV ma trận.

## Kết quả mong đợi
- Heatmap màu: đỏ = âm mạnh, xanh = dương mạnh.
- Scatter có regression line + R².
- Kết quả lưu `correlation_analyses`.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Tương quan không có ý nghĩa | Sample nhỏ | Mở rộng date range |
| NaN trong matrix | Variance = 0 | Bỏ biến không đổi |
| Spurious correlation | Biến confounding | Dùng RCA để check causality |

## API liên quan
- `tRPC: correlation.compute` — input `{ dataset, variables[], method }`.
- `tRPC: correlation.scatter` — chi tiết 2 biến.

## Tính năng liên quan
- [SPC Analysis](../analytics/spc-analysis.md).
- [Root Cause Analysis](../analytics/root-cause-analysis.md).

## Ví dụ thực tế
Tình huống: "Nghi NG rate tăng theo nhiệt độ phòng".
Bước: Variables = NG Rate + Room Temp + Humidity, Pearson. Run → NG vs Temp: r=+0.62 (p<0.001). Scatter rõ trend tăng > 28°C. Đề xuất kiểm soát HVAC.
