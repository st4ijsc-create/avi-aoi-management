# AOI Defect Types (Các Loại Lỗi AOI)

## Tổng quan
AOI (Automated Optical Inspection) phát hiện các lỗi hàn và linh kiện trên bảng mạch PCB sau công đoạn reflow soldering hoặc wave soldering.

---

## Danh sách lỗi phổ biến

### 1. Bridging (Cầu Hàn)
- **Mô tả:** Thiếc hàn kết nối hai hoặc nhiều chân linh kiện không cần kết nối với nhau.
- **Nguyên nhân:** Lượng paste hàn quá nhiều, nhiệt độ reflow không đúng, stencil bị hỏng.
- **Mã lỗi điển hình:** BRG, SB (Solder Bridge)
- **Mức độ:** Critical – lỗi gây ngắn mạch.
- **Khắc phục:** Rework bằng hàn tay, dùng hút thiếc hoặc wick.

### 2. Missing Component (Thiếu Linh Kiện)
- **Mô tả:** Vị trí linh kiện trên bản vẽ thiếu linh kiện.
- **Nguyên nhân:** Feeder hết linh kiện, hút chân không yếu, linh kiện bị thổi bay.
- **Mã lỗi:** MIS, MC (Missing Component)
- **Mức độ:** Critical
- **Khắc phục:** Đặt linh kiện bằng tay, rework bằng máy BGA.

### 3. Tombstone (Linh Kiện Dựng Đứng)
- **Mô tả:** Linh kiện SMD bị kéo lên theo một đầu, dựng thẳng đứng.
- **Nguyên nhân:** Mất cân bằng nhiệt giữa hai đầu pad, paste hàn không đều.
- **Mã lỗi:** TBT, TS (Tombstone)
- **Mức độ:** Critical
- **Ảnh hưởng:** Một đầu không kết nối.

### 4. Excess Solder / Solder Ball (Thiếc Thừa / Hạt Thiếc)
- **Mô tả:** Lượng thiếc quá nhiều hoặc các hạt thiếc nhỏ rải rác trên bảng.
- **Mã lỗi:** EXS, SBL (Solder Ball)
- **Mức độ:** Major – có nguy cơ gây ngắn mạch.

### 5. Insufficient Solder (Thiếc Không Đủ)
- **Mô tả:** Lượng thiếc hàn quá ít, không đủ để kết nối điện.
- **Mã lỗi:** INS, LS (Low Solder)
- **Mức độ:** Major
- **Kiểm tra:** Góc wetting < 45°, chiều cao hàn < 75% chiều cao chân.

### 6. Open Circuit / Lifted Lead (Mạch Hở / Chân Nổi)
- **Mô tả:** Chân linh kiện không tiếp xúc với pad trên bảng.
- **Mã lỗi:** OPN, LL (Lifted Lead)
- **Mức độ:** Critical
- **Nguyên nhân:** Linh kiện biến dạng, thiếc không đủ, pad bị oxy hóa.

### 7. Wrong Component (Sai Linh Kiện)
- **Mô tả:** Linh kiện đặt sai vị trí hoặc sai giá trị (resistor, capacitor).
- **Mã lỗi:** WRG, WC (Wrong Component)
- **Mức độ:** Critical
- **Kiểm tra:** So sánh marking code, package, kích thước.

### 8. Polarity Error (Sai Chiều Cực)
- **Mô tả:** Linh kiện có cực (diode, tụ điện phân cực, IC) bị đặt ngược chiều.
- **Mã lỗi:** POL, PE (Polarity Error)
- **Mức độ:** Critical – gây cháy nổ nếu là tụ phân cực.

### 9. Component Shift / Misalignment (Lệch Vị Trí)
- **Mô tả:** Linh kiện bị lệch so với pad, vượt quá dung sai cho phép.
- **Mã lỗi:** SHF, MIS-ALN
- **Mức độ:** Major (>50% lệch) đến Minor (<25% lệch)
- **Dung sai điển hình:** ±0.1mm cho 0402, ±0.2mm cho 0805.

### 10. Pad Damage (Hỏng Pad)
- **Mô tả:** Pad trên bảng bị bong tróc, ăn mòn hoặc vật liệu lạ bám vào.
- **Mã lỗi:** PAD, PD
- **Mức độ:** Critical – không thể rework tại chỗ.

---

## Bảng phân loại mức độ lỗi

| Mức độ | Ký hiệu | Xử lý |
|--------|---------|-------|
| Critical | CR | Dừng dây chuyền, rework bắt buộc |
| Major | MA | Rework trước khi chuyển tiếp |
| Minor | MI | Ghi nhận, không cần rework ngay |

---

## Quy trình xử lý khi phát hiện lỗi
1. AOI dừng hoặc đánh dấu bảng NG.
2. Operator xem hình ảnh lỗi tại station.
3. Kỹ sư xác nhận lỗi (confirm/reject false alarm).
4. Bảng NG chuyển đến khu vực rework.
5. Sau rework, bảng được kiểm tra lại (re-inspection).
6. Ghi nhận lỗi vào hệ thống để theo dõi xu hướng.

---

## Câu hỏi thường gặp

**Q: Lỗi Bridging xảy ra ở IC pitch nhỏ (0.5mm, 0.4mm), làm sao khắc phục?**
A: Kiểm tra stencil (có thể bị mòn hoặc hở), giảm lượng paste, tăng nhiệt độ pre-heat để paste chảy đều.

**Q: Tombstone thường xảy ra ở component nào?**
A: Thường gặp nhất ở chip 0201, 0402. Cần cân bằng thiết kế pad và kiểm tra lại reflow profile.

**Q: False Alarm (cảnh báo sai) nhiều quá, phải làm gì?**
A: Thực hiện fine-tuning chương trình AOI — điều chỉnh vùng detection, ngưỡng threshold, và lighting condition.
