# AOI Reports & Analytics (Báo Cáo và Phân Tích)

## Các Loại Báo Cáo Trong Hệ Thống

### 1. Báo Cáo Ca Làm Việc (Shift Report)
**Nội dung:**
- Tổng số bảng đã kiểm tra
- Số bảng Pass / NG
- Yield rate (tỷ lệ đạt)
- Top lỗi theo tần suất
- Danh sách bảng NG với mã lỗi

**Cách xem:**
1. Vào **Reports → Shift Report**
2. Chọn ca và ngày
3. Click **Generate**
4. Export: PDF, Excel, hoặc CSV

---

### 2. Báo Cáo Lot (Lot Report)
**Nội dung:**
- Work Order Number
- Model / Part Number
- Planned vs Actual quantity
- First Pass Yield (FPY)
- Final Yield (sau rework)
- Defect Pareto chart
- Traceability: serial number từng bảng

**Công thức:**
```
FPY = (Pass lần đầu / Tổng bảng kiểm tra) × 100%
Final Yield = ((Pass + Pass after rework) / Tổng bảng) × 100%
```

---

### 3. Báo Cáo Xu Hướng (Trend Report)
**Mục đích:** Theo dõi chất lượng theo thời gian để phát hiện xu hướng xấu sớm.

**Các chỉ số theo dõi:**
- NG rate theo ngày / tuần / tháng
- Tần suất từng loại lỗi
- So sánh giữa các line / máy
- Tỷ lệ false alarm

**Cách đọc:**
- Trend đi lên (NG tăng) → cần điều tra nguyên nhân
- Spike đột ngột → kiểm tra nguyên vật liệu, thay đổi process
- Stable nhưng cao → cần cải thiện process

---

### 4. MR (Measurement Result) Analysis

**MR là gì?**
Kết quả đo lường cụ thể từ mỗi lần kiểm tra, bao gồm:
- Kích thước linh kiện đo được
- Offset so với vị trí lý tưởng
- Solder height
- Wetting angle

**Cách phân tích MR:**
1. Vào **Analysis → MR Data**
2. Chọn component / defect type
3. Xem histogram phân phối
4. Nếu distribution lệch → process drift
5. Nếu spread rộng → process instability

**Cpk (Process Capability Index):**
- Cpk > 1.33: Excellent
- 1.0 < Cpk ≤ 1.33: OK
- Cpk < 1.0: Cần cải thiện ngay

---

### 5. Defect Pareto Analysis

**Nguyên tắc Pareto:** 80% lỗi đến từ 20% nguyên nhân.

**Quy trình:**
1. Export defect data trong khoảng thời gian cần phân tích
2. Phân loại theo defect type và component
3. Vẽ Pareto chart (tần suất từ cao xuống thấp)
4. Tập trung vào top 3 lỗi → điều tra nguyên nhân gốc rễ
5. 5-Why analysis cho từng lỗi top

**Ví dụ:**
```
Defect Type     | Count | %      | Cumulative%
----------------|-------|--------|-------------
Bridging        |  145  | 38.4%  | 38.4%
Missing Part    |   98  | 26.0%  | 64.4%
Misalignment    |   67  | 17.8%  | 82.2%
Others          |   67  | 17.8%  | 100%
```

---

## Chỉ Số KPI Chính

| KPI | Công thức | Target |
|-----|-----------|--------|
| FPY | Pass lần đầu / Total | > 98% |
| Final Yield | (Pass + Rework OK) / Total | > 99.5% |
| NG Rate | NG / Total | < 2% |
| False Alarm Rate | False Alarm / Total Alarm | < 30% |
| Rework Rate | Rework / Total | < 5% |
| Scrap Rate | Scrap / Total | < 0.1% |
| MTBF | Thời gian hoạt động / Số lần hỏng | > 500h |

---

## Export và Tích Hợp Dữ Liệu

### Export thủ công
1. **Vào Reports → Export**
2. Chọn loại báo cáo và khoảng thời gian
3. Chọn format: **PDF** (trình bày), **Excel** (phân tích), **CSV** (import hệ thống khác)
4. Chọn thư mục lưu và nhấn Export

### Tích hợp tự động với MES
- Hệ thống tự động gửi kết quả qua API sau mỗi bảng
- MES nhận dữ liệu real-time
- Cấu hình trong **Settings → Integration → MES**

### API Data Access
Xem tài liệu `apidocs/EXTERNAL_INSPECTION_API.md` để:
- Lấy kết quả kiểm tra theo serial number
- Query NG boards trong khoảng thời gian
- Download defect images
- Submit rework results

---

## Cách Đọc Báo Cáo Kiểm Tra Chi Tiết (Board Detail)

Mỗi board report gồm:

```
Board ID: [Serial Number]
Model: [Part Number]
Inspection Time: [Timestamp]
Result: NG / PASS
─────────────────────────────
Defect List:
  #1  Component: R12
      Defect: Missing Component
      Position: X=45.2mm Y=32.1mm
      Image: [link]
      Status: Confirmed NG
─────────────────────────────
Review by: [Engineer Name]
Rework by: [Technician Name]
Re-inspection: PASS
```

---

## Phân Tích Root Cause (RCA)

### Khi NG rate tăng đột biến:

**Step 1: Thu thập dữ liệu**
- Khi nào bắt đầu tăng?
- Dòng sản phẩm nào?
- Loại lỗi nào tăng?

**Step 2: Kiểm tra 5M1E**
- **Machine:** Có thay đổi cài đặt không? Calibration OK?
- **Material:** Batch nguyên liệu mới? PCB supplier thay đổi?
- **Method:** SOP có thay đổi không?
- **Man:** Operator mới? Ca mới?
- **Measurement:** AOI program có thay đổi không?
- **Environment:** Nhiệt độ, độ ẩm thay đổi?

**Step 3: 5-Why Analysis**
Ví dụ với lỗi Bridging tăng:
1. Why: Bridging tăng → Paste hàn quá nhiều
2. Why: Paste nhiều → Stencil bị mòn
3. Why: Stencil mòn → Chưa kiểm tra định kỳ
4. Why: Không kiểm tra → Chưa có lịch bảo trì
5. Why: Chưa có lịch → Chưa cập nhật PM schedule

**Corrective Action:** Thêm stencil inspection vào PM checklist hàng tuần.
