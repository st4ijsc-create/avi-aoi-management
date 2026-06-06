# AOI Thresholds & Calibration (Ngưỡng và Hiệu Chỉnh AOI)

## Ngưỡng NG Rate (Tỷ Lệ Lỗi)

### Phân cấp cảnh báo tiêu chuẩn

| Level | Ngưỡng NG Rate | Hành động |
|-------|---------------|-----------|
| Normal | < 0.5% | Sản xuất bình thường |
| Warning | 0.5% – 1.0% | Cảnh báo vàng, theo dõi tăng cường |
| Alert | 1.0% – 2.0% | Cảnh báo đỏ, báo cáo kỹ sư |
| Critical | > 2.0% | Dừng line, điều tra nguyên nhân gốc rễ |

**Lưu ý:** Ngưỡng có thể khác nhau theo loại sản phẩm và yêu cầu khách hàng (IPC-A-610 Class 2 vs Class 3).

---

## Ngưỡng Confidence Score (Độ Tin Cậy AOI)

Mỗi phán đoán của máy AOI có confidence score:

| Score | Ý nghĩa | Hành động |
|-------|---------|-----------|
| > 90% | Tin cậy cao | Tự động pass/fail |
| 70% – 90% | Cần xem xét | Chờ operator confirm |
| < 70% | Không chắc | Kỹ sư xem xét thủ công |

---

## Calibration (Hiệu Chỉnh Máy)

### Lịch bảo trì và hiệu chỉnh

| Loại | Tần suất | Người thực hiện |
|------|---------|----------------|
| Daily warm-up | Mỗi ca | Operator |
| Reference board check | Hàng ngày | Operator |
| Camera calibration | Hàng tuần | Technician |
| Full calibration | Hàng tháng | Kỹ sư AOI |
| Lighting check | Hàng tuần | Technician |

### Quy trình hiệu chỉnh reference board
1. Lấy reference board từ kho bảo quản.
2. Chạy reference board qua máy AOI theo chương trình chuẩn.
3. Kiểm tra kết quả so với golden standard:
   - Tất cả lỗi đã biết phải được phát hiện (0 miss).
   - False alarm ≤ 2 trên toàn bộ board.
4. Nếu không đạt → dừng sản xuất, gọi kỹ sư.
5. Ghi nhận kết quả vào log hiệu chỉnh.

### Lighting Calibration
- Kiểm tra độ đồng đều ánh sáng bằng white calibration board.
- Sai lệch cho phép: ±5% so với giá trị chuẩn.
- Nếu lệch > 5%: vệ sinh lens, kiểm tra LED ring.

---

## Ngưỡng Kích Thước Linh Kiện (Component Size Tolerance)

### Chip Resistor / Capacitor
| Package | X-shift | Y-shift | Rotation |
|---------|---------|---------|----------|
| 0201 | ±0.05mm | ±0.05mm | ±5° |
| 0402 | ±0.10mm | ±0.10mm | ±7° |
| 0603 | ±0.15mm | ±0.15mm | ±10° |
| 0805 | ±0.20mm | ±0.20mm | ±10° |
| 1206 | ±0.25mm | ±0.25mm | ±10° |

### IC QFP/QFN
| Pitch | Lead offset tối đa | Rotation max |
|-------|-------------------|-------------|
| 0.4mm | ±0.04mm | ±1° |
| 0.5mm | ±0.05mm | ±1.5° |
| 0.65mm | ±0.08mm | ±2° |

---

## Ngưỡng Solder Quality

| Thông số | Min | Max | Đơn vị |
|---------|-----|-----|--------|
| Solder height | 50% | 150% | % of lead height |
| Wetting angle | 30° | 75° | degrees |
| Fillet width | 80% | 200% | % of pad width |
| Void (BGA) | 0% | 25% | % of pad area |

---

## Điều chỉnh Threshold trong chương trình AOI

Khi false alarm rate cao:
1. Vào **Program Edit** → chọn component.
2. Tăng tolerance cho kích thước hoặc offset.
3. Chỉnh **Brightness threshold** nếu lỗi do ánh sáng.
4. Thêm vùng loại trừ (exclusion zone) cho marking đặc biệt.
5. **Không được** tăng threshold quá mức gây miss lỗi thực.
6. Sau điều chỉnh → verify lại bằng board mẫu.

---

## Factory Alert Thresholds (Cảnh Báo Nhà Máy)

Hệ thống `FactoryAlertSystem` tự động gửi cảnh báo khi:

| Điều kiện | Cấp độ |
|-----------|--------|
| NG rate > 1% trong 30 phút | Warning |
| NG rate > 2% trong 15 phút | Critical |
| Liên tiếp 5 bảng NG cùng loại lỗi | Major |
| False alarm rate > 30% | Info |
| Machine offline > 10 phút | Alert |

Người nhận cảnh báo được cấu hình trong `Settings → Notifications → Factory Alerts`.
