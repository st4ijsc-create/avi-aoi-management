# SCADA R1b-2b-2a · Báo cáo nghiệm thu (KHUNG — điền dần theo task, hoàn tất ở Task 11)

> Khung tạo ở Task 1 (điều phối 2026-10-27: thay đổi ngữ nghĩa bộ đếm T9 phải ghi vào "thay đổi hành vi nhìn thấy được"). Task 11 điền các mục còn
> trống: ma trận ô, đột biến hệ thống, chạy toàn bộ, bảng số đo, danh sách R1b-2b-2b, câu nguyên văn về `AI_OT_CONTROL_ENABLED`.

## Kết luận ngắn

_(Task 11)_

## 1. Ma trận ô — `server/services/scada/r1b2b2aNghiemThu.db.test.ts`

_(Task 11)_

## Thay đổi hành vi nhìn thấy được

### Task 1 (mục 61) — một trần ghi nền cho đường STOP

- **Ngữ nghĩa bộ đếm T9 ĐỔI (kiem-dinh KD-A1, điều phối xác nhận 2026-10-27).** `soGhiSoTreoStopHmi()` / `TRAN_GHI_SO_TREO_STOP_HMI` (cùng hàm
  `ghiSoCoHan` đã gộp ở R1b-2b-1 T9) nay đếm lượt ghi ĐANG BAY: +1 ngay lúc PHÁT, −1 lúc lượt ấy XONG (thành công, lỗi, ném đồng bộ, hoặc lượt đã
  bỏ rơi sau hạn khi nó xong). Trần 8 áp từ lượt ĐẦU. Trước: chỉ lượt ĐÃ quá 500 ms mới được đếm. Hạn 500 ms nay chỉ quyết định lúc người gọi
  đang `await` nhận trả lời. Bộ đếm chuyển xuống `server/services/ot/ghiTreoCoTran.ts` (`ghiCoTran`, `soGhiTreoStop`); tên cũ trong `lenhHmi.ts`
  giữ bằng tái xuất.
- **Trần chung cho MỌI lượt ghi nền của đường STOP.** Vào cùng 8 với attempts và chốt dòng chờ:
  - audit HMI `scada_hmi_stop` (DA_GUI / CHUA_GHIM_STOP / GHIM_MUC_CAO / QUA_HAN);
  - audit `scada_hmi_stop_buoc_doi_mat_khau`;
  - attempts STOP_QUA_HAN (cả lệnh, và vòng theo adapter);
  - audit `stop_policy_override` / `stop_interlock_override` của dispatcher cho MỌI STOP ghim, mọi nguồn (điều phối Q2).

  Truy vấn chỉ được phát khi trần còn chỗ. Trước, `recordAuditEvent` được gọi trước mọi kiểm tra.
- **Đầy trần ⇒ lượt ghi KHÔNG được phát.**
  - Log mức error `<nhan>_bo_qua_day` mang nội dung hàng (`noiDung`, có `bang`).
  - Lượt bị bỏ qua được ĐẾM vào bộ đếm 24 h `demGhiBoQuaDay()` theo bảng đích (KD-A3). Posture `oversight.posture.ghiNenStopBoQua24h`
    `{ count, theoBang, batDauLuc }` chỉ hiện cho người toàn quyền; người khác nhận `null`.
  - Dòng attempts STOP_QUA_HAN bị bỏ qua còn đếm vào `stopQuaHan24h.khongGhiSo.theoBuoc.ghi_so_loi` (Q2).
  - Kết quả STOP không đổi.
- **Cái giá khi audit chậm.** Các lượt ghi nhanh (attempts, chốt dòng chờ) dùng chung 8 chỗ. Nếu audit treo chiếm hết 8 chỗ, các lượt ấy bị bỏ qua
  SỚM hơn trước (đã log nội dung). Dòng chờ vẫn được dispatcher chuyển `executed` trong lúc đặt chỗ.
- **Log mới / đổi.**
  - Audit của `dungMay` quá 500 ms ⇒ `audit_hmi_stop_qua_han` (trước: một dòng "ghi audit lỗi hoặc quá hạn" sau 10 s).
  - Xong muộn ⇒ `<nhan>_muon_xong` (info) hoặc `<nhan>_muon` (lỗi).
  - Dispatcher: `dispatch_pinned_stop_audit_qua_han` / `_bo_qua_day`.
  - Nhãn lỗi của attempts STOP_QUA_HAN giữ: `attempts_hmi_stop_qua_han`, `attempts_hmi_stop_qua_han_adapter`.
- Không khoá i18n mới. Posture chưa có dòng giao diện cho `ghiNenStopBoQua24h` (để R1b-2b-2b).

## 6. Giới hạn đã biết

### LOGIC

- (T1) **Audit bị bỏ qua vì đầy trần không có dòng `control_audit_log`.** Nó chỉ có log nội dung và bộ đếm posture. STOP vẫn có dòng `command_log`
  của dispatch (KD-A3).
- (T1) **Trần theo TIẾN TRÌNH.** N bản API cho N × 8.
- (T1) **"DB nhanh không chạm trần" giả định các lượt ghi xong trong vài ms.** Hơn 8 lượt ghi nền trùng nhau trong cùng vài ms (vd. nhiều lần bấm
  song song trên DB khoẻ) vẫn có thể làm lượt thứ 9 trở đi bị bỏ qua. Đã log và đếm, kết quả STOP không đổi.
- (T1) **Ngoài bộ đếm (mục 73 / 74 của danh sách R1b-2b-2b):**
  - audit nền của B3 / canh STOP (`auditWriteOverlapRisk`, báo động `ot_stop_unverified`);
  - `raiseUnverifiedStopRefusedAlert`;
  - lượt đọc / chèn dòng chờ trước-gửi bị bỏ rơi khi quá hạn (`trongHanStop`).
- (T1) **Giới hạn của census AST** (`nganSachPoolStop.test.ts`):
  - phép gán `x = f()` không `await` không bị vị từ ngược xét;
  - tên hàm so theo chữ, không theo kiểu;
  - lời gọi ghi sổ qua bí danh không bị vị từ thuận thấy (vị từ ngược vẫn bắt nếu nó nổi).

### DỮ LIỆU

_(Task 11)_

### VẬN HÀNH

- (T1) Bộ đếm `demGhiBoQuaDay` mất khi khởi động lại tiến trình. `batDauLuc` cho biết nó đếm từ khi nào.

## 7. Bảng số đo

_(Task 11)_

## 8. Đột biến theo task

_(Task 11 — chi tiết từng task ở `.superpowers/sdd/2026-10-27-scada-r1b-2b-2a-an-toan-duong-stop/task-N-report.md`)_

## 9. Danh sách R1b-2b-2b

_(Task 11)_
