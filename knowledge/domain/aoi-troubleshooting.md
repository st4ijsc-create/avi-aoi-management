# AOI Troubleshooting Guide (Hướng Dẫn Xử Lý Sự Cố)

## Mã Lỗi Máy AOI

### E001 – E020: Lỗi Camera / Hình Ảnh
| Mã | Mô tả | Xử lý |
|----|-------|-------|
| E001 | Camera không phản hồi | Restart camera service, kiểm tra cáp kết nối |
| E002 | Hình ảnh mờ / blur | Vệ sinh lens, kiểm tra focus |
| E003 | Ánh sáng không đủ | Kiểm tra LED ring, thay bóng nếu cần |
| E004 | Image capture timeout | Kiểm tra triggering signal, giảm tốc độ conveyor |
| E005 | Camera calibration fail | Chạy lại calibration sequence |
| E010 | Color balance error | Thực hiện white balance calibration |
| E011 | FOV (Field of View) mismatch | Kiểm tra độ cao camera, re-calibrate |
| E015 | Multiple exposure error | Kiểm tra lighting controller |
| E020 | Image buffer overflow | Giảm độ phân giải hoặc tăng RAM |

### E021 – E040: Lỗi Transport / Conveyor
| Mã | Mô tả | Xử lý |
|----|-------|-------|
| E021 | Board jam (kẹt bảng) | Dừng máy, lấy bảng thủ công, kiểm tra conveyor belt |
| E022 | Board not detected | Kiểm tra sensor phát hiện bảng (entry sensor) |
| E023 | Conveyor speed error | Kiểm tra motor drive, encoder |
| E024 | Width adjustment fail | Kiểm tra motor điều chỉnh độ rộng conveyor |
| E025 | Board exit timeout | Kiểm tra exit sensor, downstream machine |
| E030 | Support pin error | Kiểm tra pin position, có thể bị kẹt hoặc hỏng |
| E031 | Clamp error | Kiểm tra clamp mechanism, air pressure |

### E041 – E060: Lỗi Communication / Software
| Mã | Mô tả | Xử lý |
|----|-------|-------|
| E041 | Network connection lost | Kiểm tra cáp mạng, switch, IP configuration |
| E042 | Database connection fail | Kiểm tra SQL Server service, firewall |
| E043 | MES/ERP connection error | Kiểm tra MES server, API endpoint |
| E044 | Barcode reader error | Kiểm tra USB connection, thay barcode reader |
| E045 | Program load fail | Kiểm tra file path, quyền truy cập thư mục |
| E050 | License error | Kiểm tra dongle, gia hạn license |
| E051 | Memory insufficient | Đóng bớt ứng dụng, restart máy |
| E055 | Configuration file corrupt | Restore từ backup |

### E061 – E080: Lỗi Inspection / Algorithm
| Mã | Mô tả | Xử lý |
|----|-------|-------|
| E061 | Fiducial mark not found | Kiểm tra chương trình, làm sạch fiducial |
| E062 | Alignment fail | Kiểm tra fiducial quality, re-teach fiducial |
| E063 | Component database error | Update component library |
| E065 | Too many false alarms | Điều chỉnh threshold, xem xét lighting |
| E070 | Inspection timeout | Kiểm tra CPU load, giảm số lượng inspection region |
| E075 | NG rate threshold exceeded | Dừng line, báo cáo kỹ sư ngay |

### E081 – E099: Lỗi Hệ Thống
| Mã | Mô tả | Xử lý |
|----|-------|-------|
| E081 | Emergency stop activated | Kiểm tra E-stop button, reset sau khi an toàn |
| E082 | Air pressure low | Kiểm tra máy nén khí, van điều áp |
| E083 | Temperature alarm | Kiểm tra nhiệt độ phòng, quạt làm mát |
| E090 | Hard disk space low | Xóa log file cũ, archive dữ liệu |
| E091 | Backup fail | Kiểm tra backup path, dung lượng |
| E099 | System crash | Restart máy, báo cáo IT |

---

## Quy Trình Khởi Động Máy (Startup Procedure)

1. **Bật nguồn** theo thứ tự: UPS → Server → Monitor → Máy AOI
2. **Warm-up:** Chờ ít nhất 15 phút sau khi bật
3. **Self-test:** Chạy routine tự kiểm tra của máy
4. **Calibration check:** Chạy reference board
5. **Load program:** Chọn chương trình cho sản phẩm
6. **First board verify:** Kiểm tra board đầu tiên bằng tay

---

## Quy Trình Tắt Máy (Shutdown Procedure)

1. Hoàn thành batch hiện tại
2. Lưu dữ liệu sản xuất
3. Tắt chương trình theo menu
4. Đóng tất cả ứng dụng
5. Shutdown Windows
6. Tắt nguồn máy AOI
7. **Không** ngắt điện đột ngột (có thể hỏng database)

---

## Xử Lý Board Kẹt (Board Jam)

**Khi bảng bị kẹt trong máy:**
1. Nhấn **Emergency Stop** ngay lập tức
2. Đợi tất cả chuyển động dừng hoàn toàn
3. Mở nắp an toàn theo đúng quy trình
4. Lấy bảng ra nhẹ nhàng bằng tay
5. Kiểm tra bảng có bị hỏng không
6. Kiểm tra nguyên nhân kẹt (bụi, mảnh linh kiện, warped board)
7. Reset E-stop, chạy lại machine

---

## False Alarm Investigation

**Khi false alarm rate > 30%:**
1. Xuất báo cáo false alarm từ phần mềm
2. Phân loại: loại lỗi nào bị false alarm nhiều nhất
3. Xem ảnh của false alarm → tìm pattern chung
4. Nguyên nhân phổ biến:
   - Bóng đổ (shadow) từ linh kiện cao
   - Marking trên PCB bị nhận nhầm
   - Biến thể màu sắc pad (oxidation)
   - Chương trình threshold quá chặt
5. Điều chỉnh từng component type một, verify sau mỗi thay đổi

---

## Recovery sau sự cố mất điện

1. Kiểm tra xem có board nào đang trong máy không
2. Chạy lại startup procedure đầy đủ
3. Kiểm tra database integrity
4. Xem xét board cuối cùng đã qua trước mất điện → re-inspect nếu cần
5. Báo cáo IT về sự cố

---

## Liên hệ hỗ trợ

| Vấn đề | Liên hệ |
|--------|---------|
| Lỗi phần cứng | Kỹ thuật viên bảo trì nội bộ |
| Lỗi phần mềm | IT Department hoặc nhà cung cấp AOI |
| Lỗi chương trình | Kỹ sư AOI |
| Lỗi mạng / database | IT Department |
| Lỗi liên quan factory alert | Team quản lý sản xuất |
