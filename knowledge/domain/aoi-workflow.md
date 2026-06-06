# AOI Workflow & SOP (Quy Trình Vận Hành Chuẩn)

## Quy Trình Tổng Quát

```
Nhận lệnh sản xuất → Setup máy → Chạy thử → Sản xuất → Kết thúc lot → Báo cáo
```

---

## SOP-01: Bắt Đầu Ca Làm Việc

### Checklist đầu ca
- [ ] Kiểm tra máy không có board còn sót trong conveyor
- [ ] Bật máy và chờ warm-up (≥ 15 phút)
- [ ] Chạy reference board → kết quả đạt
- [ ] Kiểm tra mực máy in (nếu tích hợp với SPI)
- [ ] Đăng nhập vào hệ thống quản lý
- [ ] Nhận work order / production schedule

---

## SOP-02: Setup Board và Chương Trình

### 2.1 Điều chỉnh conveyor width
1. Đo chiều rộng bảng PCB.
2. Vào **Setup → Conveyor Width**.
3. Nhập giá trị + clearance 2mm mỗi bên.
4. Chạy thử với bảng dummy.

### 2.2 Chọn chương trình kiểm tra
1. Nhấn **Program → Open**.
2. Tìm tên chương trình theo model sản phẩm (Part Number).
3. Nếu chưa có chương trình → báo kỹ sư để tạo mới.
4. Xác nhận revision của chương trình khớp với BOM.

### 2.3 Thiết lập Board ID / Barcode
1. Vào **Settings → Board ID**.
2. Cấu hình barcode scanner hoặc nhập manual.
3. Kiểm tra format: thường là `[ProductCode]-[SerialNumber]-[DateCode]`.

---

## SOP-03: Chạy Thử (First Article Inspection)

### Quy trình first article
1. Lấy **1 board mẫu đã biết là OK**.
2. Chạy qua máy AOI.
3. Kiểm tra kết quả:
   - Không có lỗi giả (false alarm).
   - Phát hiện đúng tất cả vị trí linh kiện.
4. Nếu có false alarm → điều chỉnh chương trình (báo kỹ sư).
5. Ghi lại kết quả first article vào form.
6. **Chỉ bắt đầu sản xuất khi first article PASS**.

---

## SOP-04: Vận Hành Sản Xuất

### Trong quá trình sản xuất
- Theo dõi màn hình NG rate dashboard.
- Khi bảng bị NG:
  1. Lấy bảng NG ra khỏi conveyor.
  2. Đặt vào khay NG riêng biệt.
  3. Không được để lẫn với bảng OK.
  4. Ghi nhận số serial và mã lỗi.

### Xử lý bảng NG
1. **Review station:** Kỹ sư xem lại ảnh lỗi.
2. **Confirm NG:** Lỗi thật → chuyển khu vực rework.
3. **False Alarm:** Kỹ sư confirm pass → ghi nhận, điều chỉnh program sau.
4. **Rework:** Kỹ thuật viên sửa lỗi.
5. **Re-inspection:** Bảng sau rework phải qua AOI lần nữa.
6. **Kết quả re-inspect:** 
   - Pass → tiếp tục quy trình.
   - Fail sau 2 lần rework → scrap hoặc escalate.

---

## SOP-05: Đăng Ký và Theo Dõi Lot

### Bắt đầu lot mới
1. Vào **Production → New Lot**.
2. Nhập Work Order Number.
3. Chọn model / part number.
4. Nhập số lượng kế hoạch (planned quantity).
5. Nhấn **Start Lot**.

### Kết thúc lot
1. Đảm bảo tất cả bảng đã qua kiểm tra.
2. Vào **Production → Close Lot**.
3. Hệ thống tự tính:
   - Total: tổng số bảng.
   - Pass: số bảng đạt.
   - NG: số bảng lỗi (trước rework).
   - Yield: tỷ lệ đạt.
4. Export báo cáo lot nếu cần.
5. Ghi nhận vào sổ nhật ký sản xuất.

---

## SOP-06: Kết Thúc Ca

### Checklist cuối ca
- [ ] Kết thúc tất cả lot đang mở
- [ ] Export báo cáo ca làm việc
- [ ] Báo cáo các vấn đề phát sinh cho ca sau
- [ ] Vệ sinh máy (lau bụi, kiểm tra conveyor)
- [ ] Đậy nắp máy
- [ ] Đăng xuất khỏi hệ thống
- [ ] Ghi nhật ký ca làm việc

---

## SOP-07: Tạo Chương Trình Mới (Dành Cho Kỹ Sư)

1. Lấy PCB mẫu (golden sample) đã biết là OK.
2. Vào **Program → New → Teach Mode**.
3. **Fiducial Teaching:** Chọn ít nhất 2 fiducial marks.
4. **Component Teaching:**
   - Import từ CAD/BOM file (khuyến nghị).
   - Hoặc teach từng linh kiện thủ công.
5. **Threshold Setup:** Áp dụng threshold chuẩn theo package.
6. **Test Run:** Chạy 5-10 bảng mẫu, điều chỉnh.
7. **Validation:** Chạy 30 bảng → false alarm < 5%, detect rate 100%.
8. **Sign off:** Kỹ sư trưởng phê duyệt chương trình.
9. **Release:** Lưu vào thư mục production programs.

---

## Quy Định An Toàn

- Không đút tay vào máy khi đang chạy.
- Nhấn E-stop ngay khi có sự cố.
- Đeo ESD wrist strap khi cầm bảng.
- Báo cáo mọi sự cố và cận sự cố cho supervisor.
- Không tự ý thay đổi cài đặt máy khi chưa được đào tạo.
