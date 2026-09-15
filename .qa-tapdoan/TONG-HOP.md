# TỔNG HỢP SỐ — QA lần 11 (nội bộ, để dựng báo cáo)

## Bảng phán quyết theo lô (số từ BANG-*.md, người đọc tự đếm lại được)
| lô | nội dung | ĐẠT | SAI | HỎNG | CHẶN-ĐÚNG | N/A | tổng ô | thô |
|---|---|---|---|---|---|---|---|---|
| A+B | cửa vào · phạm vi UI · toà/tầng | 20 | 16 | 0 | 1 | 1 | 38 | 39 tệp |
| C | kết cục gốc Line 3D / Machine 3D | 7 | 6 | 0 | 3 | 1 | 17 | 32 tệp |
| D+E | ngăn xử lý nghiệp vụ · Studio build | 17 | 6 | 0 | 3 | 0 | 26 | 31 tệp |
| F | tối ưu · nhanh · đẹp · trực quan | 25 | 7 | 1 | 0 | 2 | 35 | 17 tệp |
| **tổng** | | **69** | **35** | **1** | **7** | **4** | **116** | **119** |
Ô không có phán quyết: **0** ở cả 4 lô.

## Tái phân loại của chủ đợt (PH-08, PH-20)
- 14/16 ô SAI của lô A+B là **đo nhầm thước** (brief tôi tự mâu thuẫn về `dem-may`), không phải lỗi sản phẩm ⇒ SAI sản phẩm thực của A+B = **2** (PH-06 nhãn KPI, PH-10 pv=tapdoan).
- 1 ô SAI của lô D+E là **lệch bảng §2 của tôi** (quanly không có canCreate nên ẩn nút là đúng) ⇒ SAI sản phẩm thực của D+E = **5**.
- **SAI sản phẩm thực toàn đợt: 2 + 6 + 5 + 7 = 20 ô**, gộp về **14 khuyết tật riêng biệt** (PH-06, 10, 12, 13, 14, 15, 16, 17, 23, 24, 27, 28, 30, 31, 32 — trừ PH-33 là điểm công bằng).

## Xếp Pareto theo bán kính × mức
| # | khuyết tật | mức | bán kính đo được |
|---|---|---|---|
| 1 | PH-12 `factories[0]` + `toaNha[0]` ở màn Line/Máy | CAO | 77,4–93,1 % line không vẽ đủ (5 vai) |
| 2 | PH-23 `commandCenter.hierarchy` 0 lọc tenant | CAO (bảo mật) | 5/5 vai nhận cùng 450.811 B, kể cả 0 gán |
| 3 | PH-24 48/48 lượt > 2.500 ms | CAO | mọi vai không-admin, mọi màn |
| 4 | PH-14 Studio chỉ tầng 1 toà 1 | CAO | 326/371 máy (88 %) ngoài tầm thiết kế |
| 5 | PH-06+07+32 mẫu số/danh sách không theo phạm vi đang xem | TRUNG BÌNH | mọi tầng ≠ tầng 1 toà 1 |
| 6 | PH-15 Studio gác bằng canEdit, bỏ canCreate | TRUNG BÌNH | mọi vai có E mà không có C |
| 7 | PH-27 mã máy cắt ở 1280 | TRUNG BÌNH | 14 chuỗi/màn, mọi màn nhỏ |
| 8 | PH-30 dải cảnh báo không mang danh tính | TRUNG BÌNH | 15 dòng (quanly) / 55 (giamdoc) |
| 9 | PH-31 KPI che lời khai trung thực | TRUNG BÌNH | 3/3 ảnh giám đốc |
| 10 | PH-13 màn Line không phân biệt ngoài-phạm-vi | THẤP | mọi line ngoài phạm vi |
| 11 | PH-16 nút Mở chức năng cấp nhà máy/line 0 chỗ gọi | THẤP | mất ngữ cảnh, không mất tính năng (PH-33) |
| 12 | PH-17 ghi chú 0 UI | THẤP | 5/5 vai |
| 13 | PH-28 bảng 2D sức khoẻ chưa giao + không đo được vòng màu | THẤP + 1 HỎNG | 1 lớp phủ chưa từng đo |
| 14 | PH-03 `factory.list` 0 cổng quyền | THẤP | rò tên nhà máy được gán |

## Điểm MẠNH có bằng chứng
- PH-02 phạm vi tenant **7/7 vai** khớp kỳ vọng DB độc lập; gán cấp tập đoàn sống (§15 #26 lần đầu đo được đường này).
- PH-05 hợp đồng trạng thái API↔DB **5/5 rổ** trên 409 máy, gồm luật suy offline từ heartbeat.
- PH-26 TỐI ƯU biên **25–33×**: 68 máy = 5 draw calls · 15.026 tam giác · 6 nhãn · 1 canvas; khung 16,1 ms ≈ cảnh 12 máy; FPS GPU p50 62,1; idle 46,7 s cuối 0 khung.
- ĐẸP: 0 cặp chồng lấn / 0 px², lệch lớp (0,0,0,0) 10/10, 0 tràn ngang — ở mật độ cao nhất từng đo.
- Cảnh 3D vẽ đúng tầng **13/13 tầng**; bộ chọn 4 toà × 7 tầng đúng 3/3 công ty (đóng nợ #10 §14q.33).
- C3 bấm tâm khối máy **5/5** đúng id; D3 ack cảnh báo chạy thật với ablation 3 mốc; E5 vẽ→lưu→xoá vùng an toàn qua UI (DB 341→342→341).
- 7 lời gọi API ngoài phạm vi đều NOT_FOUND/[]/null ⇒ **0 rò dữ liệu máy**; E7 `sinhTuDong` 403 với kỹ thuật.
- Cổng nền tại HEAD: `check` **0 lỗi** · `i18n:check` **0/0/0** · `vitest phamVi` **17 tệp/437 ca xanh** · `twin3d` **109/2.539 xanh**.

## Lỗi của chủ đợt (tôi) — agent bác đúng, ghi để không lặp
- PH-08 brief tự mâu thuẫn về `dem-may` (A3 vs B2/B3/B6) ⇒ 14 ô SAI oan.
- PH-09 nhịp làm tươi 120 s > `NGUONG_TUOI_MS` 60 s ⇒ nửa chu kỳ mọi máy "cũ"; đã hạ 45 s.
- PH-20 bảng §2 ghi quanly "ẩn tạm: có" nhưng không cấp `machine_control.canCreate`.
- Không nói trước giao diện tài khoản QATD là `en` ⇒ thước lọc chữ Việt cho SAI oan (agent tự vá).
- PH-25 (agent phát hiện, ảnh hưởng cả dự án): mọi lưới e2e đang đo **SwiftShader CPU**, không phải GPU.

## ABLATION đã chạy
| ID | phép | kết quả |
|---|---|---|
| AB-1 | đổi vai để lật `factory.list[0]` | congnhan mở được máy 4977; giamdoc/admin (quyền rộng hơn) bị chặn ⇒ loại trừ quyền/phạm vi/dữ liệu (PH-12) |
| AB-2 | API vs UI cùng cookie | `machineDetail(4977)` CÓ DỮ LIỆU + `createWorkOrder(4568)` HTTP 200 trong khi UI từ chối ⇒ lỗi client (PH-12/19) |
| AB-3 | andon raised dựng tay, 3 mốc | trước 0 → có badge → xoá mất (D3) |
| AB-4 | md5 `hierarchy` theo 5 vai | 1 md5 duy nhất, đối chứng `factory.list`/`overview` CÓ lọc ⇒ PH-23 |
| AB-5 | 0 máy vs 1.150 máy cho `hierarchy` | 1.646 vs 1.664 ms (không tỉ lệ) + đối chứng `overview` 8→55 ms (có tỉ lệ) ⇒ PH-24 |
| AB-6 | SwiftShader vs GPU | 26,1 → 62,1 FPS cùng cảnh ⇒ PH-25 |
