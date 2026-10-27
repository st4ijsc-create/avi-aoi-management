# SCADA R1b-2b-2a · Báo cáo nghiệm thu (KHUNG — điền dần theo task, hoàn tất ở Task 11)

> Khung tạo ở Task 1 (điều phối 2026-10-27: thay đổi ngữ nghĩa bộ đếm T9 phải ghi vào "thay đổi hành vi nhìn thấy được"). Task 11 điền các mục còn
> trống: ma trận ô, đột biến hệ thống, chạy toàn bộ, bảng số đo, danh sách R1b-2b-2b, câu nguyên văn về `AI_OT_CONTROL_ENABLED`.

## Kết luận ngắn

_(Task 11)_

## 1. Ma trận ô — `server/services/scada/r1b2b2aNghiemThu.db.test.ts`

_(Task 11)_

## Thay đổi hành vi nhìn thấy được

### Task 1 (mục 61) — một trần ghi nền cho đường STOP, kèm hàng chờ có trần (fix round 1)

- **Ngữ nghĩa bộ đếm T9 ĐỔI (kiem-dinh KD-A1, điều phối xác nhận 2026-10-27).**
  - `soGhiSoTreoStopHmi()` / `TRAN_GHI_SO_TREO_STOP_HMI` (cùng hàm `ghiSoCoHan` đã gộp ở R1b-2b-1 T9) nay đếm lượt ghi ĐANG BAY: +1 ngay lúc PHÁT,
    −1 lúc lượt ấy XONG (thành công, lỗi, ném đồng bộ, hoặc lượt đã bỏ rơi sau hạn khi nó xong).
  - Trần 8 áp từ lượt ĐẦU. Trước: chỉ lượt ĐÃ quá 500 ms mới được đếm.
  - Hạn 500 ms nay chỉ quyết định lúc người gọi đang `await` nhận trả lời.
  - Bộ đếm chuyển xuống `server/services/ot/ghiTreoCoTran.ts` (`ghiCoTran`, `soGhiTreoStop`, `trangThaiGhiTreo`); tên cũ trong `lenhHmi.ts` giữ
    bằng tái xuất.
- **Trần chung cho MỌI lượt ghi nền của đường STOP.** Vào cùng 8 với attempts và chốt dòng chờ:
  - audit HMI `scada_hmi_stop` (DA_GUI / CHUA_GHIM_STOP / GHIM_MUC_CAO / QUA_HAN);
  - audit `scada_hmi_stop_buoc_doi_mat_khau`;
  - attempts STOP_QUA_HAN (cả lệnh, và vòng theo adapter);
  - audit `stop_policy_override` / `stop_interlock_override` của dispatcher cho MỌI STOP ghim, mọi nguồn (điều phối Q2).

  Truy vấn chỉ được phát khi trần còn chỗ. Trước, `recordAuditEvent` được gọi trước mọi kiểm tra.
- **Đầy trần ⇒ XẾP HÀNG, không bỏ (fix round 1, điều phối DUYỆT 2026-10-27; thay "bỏ khi đầy" của bản đầu T1).**
  - MỘT FIFO, ≤ 256 mục HOẶC 10 phút (cái nào tới trước), mỗi mục ≤ 16 KB (JSON nội dung). Nội dung giữ cho log / tóm tắt bị cắt.
  - Xả dưới CÙNG trần 8 (kể cả dòng tóm tắt): ngân sách pool 8 + 8 ≤ 25 − 9 không đổi. Lượt mới không vượt lượt đang chờ (không đói).
  - STOP không bao giờ chờ hàng chờ: lượt xếp hàng trả người gọi NGAY.
  - **Giờ SỰ KIỆN được giữ:**
    - attempts: cột `at` (`ghiThuLenh` nhận `at` tuỳ chọn);
    - audit: `after.lucSuKien` + `after.tuHangCho: true`, vì `recordAuditEvent` không nhận giờ; nằm trong phần được băm của chuỗi;
    - chốt dòng chờ: `executedAt` = giờ sự kiện.
  - Log `<nhan>_xep_hang` (warn) khi xếp hàng.
- **Chỉ tràn / quá tuổi / quá lớn / tắt máy mới BỎ.**
  - Log error `<nhan>_bo_<lyDo>` mang nội dung hàng (cắt), gọi `khiBoQua`.
  - Đếm 24 h `demGhiBoQuaDay()` theo bảng đích (KD-A3). Attempts STOP_QUA_HAN bị bỏ còn đếm vào `stopQuaHan24h.khongGhiSo.theoBuoc.ghi_so_loi` (Q2).
  - Gộp vào **MỘT dòng tóm tắt** `control_audit_log` `ot_stop_ghi_nen_bo_roi` (số lượng, theo lý do / nhãn / bảng, khoảng giờ sự kiện, ≤ 32 requestId),
    nằm TRONG chuỗi băm khi SEC_PLATFORM bật.
  - Dòng tóm tắt không bao giờ bị bỏ: nó đi trước hàng chờ khi có chỗ; ghi hỏng ⇒ giữ lại, gộp lượt bỏ mới, thử lại sau 2 s và ở lần xả kế tiếp.
- **Tắt tiến trình** (`stopOt({ tatTienTrinh: true })` → `xaHangChoKhiTat`; `server.close` chờ cùng promise trước `process.exit`):
  - xả tối đa 2 s;
  - còn lại ⇒ MỘT dòng log `ot_stop_ghi_nen_tat_may_con_lai`, các lượt còn lại bị bỏ (lyDo `tat_may`), và thử ghi dòng tóm tắt trong phần hạn còn lại.
- **Posture** `oversight.posture.ghiNenStopBoQua24h` (chỉ toàn quyền; chỉ trường máy chủ — dòng giao diện ở Task 9):
  - `count` / `theoBang`: lượt bị bỏ trong 24 h;
  - tín hiệu sống: `dangBay` / `tran`, `dayTu` (lúc trần đầy), `hangCho` / `hangChoTheoBang` / `tranHangCho`, `tomTatCho`.
  - **Đếm đôi có chủ ý:** một attempts STOP_QUA_HAN bị bỏ có mặt ở cả `ghi_so_loi` lẫn `theoBang.scada_command_attempts` — giao diện không cộng hai số này.
- **Log mới / đổi.**
  - Audit của `dungMay` quá 500 ms ⇒ `audit_hmi_stop_qua_han` ở mức **warn** (trước: một dòng error "ghi audit lỗi hoặc quá hạn" sau 10 s). Sổ trên
    đường trả lời giữ mức error.
  - Xong muộn ⇒ `<nhan>_muon_xong` (info) hoặc `<nhan>_muon` (lỗi).
  - Dispatcher: `dispatch_pinned_stop_audit_*`.
  - Không còn nhãn `_bo_qua_day`.
- **Đo (fix round 1, review I-1):** bản bỏ-khi-đầy, trên DB KHOẺ với 5 adapter có override, SEC_PLATFORM bật và bấm đúp, MẤT 18 lượt ghi nền
  (6 audit override + 6 chốt dòng chờ + 6 attempts) ở 3/3 lượt chạy. Bản hàng chờ: 0 lượt bị bỏ, đủ mọi dòng.
- Không khoá i18n mới.

## 6. Giới hạn đã biết

### LOGIC

- (T1) **Hàng chờ ghi nền nằm TRONG BỘ NHỚ.** Lượt đang xếp hàng mất khi tiến trình sập hoặc bị giết (tắt êm thì xả ≤ 2 s, rồi bỏ có tóm tắt). Spool bền
  (JSONL append-only, fsync, phát lại khi khởi động) để R1b-2b-2b. Cho tới khi có spool, audit an ninh `stop_*_override` và
  `scada_hmi_stop_buoc_doi_mat_khau` CÓ THỂ mất trong trường hợp sập.
- (T1) **Lượt bị bỏ (tràn 256 / quá tuổi 10 phút / quá lớn 16 KB / tắt máy) không có hàng riêng.** Chúng chỉ có log nội dung (cắt), bộ đếm posture
  và MỘT dòng tóm tắt `ot_stop_ghi_nen_bo_roi` (requestId ≤ 32 mỗi tóm tắt). STOP vẫn có dòng `command_log` (KD-A3).
- (T1) **Hàng audit được ghi từ hàng chờ:**
  - `createdAt` / `hashTs` là giờ GHI; giờ sự kiện nằm trong `after.lucSuKien`;
  - thứ tự id của chuỗi băm theo thứ tự GHI, không theo thứ tự sự kiện;
  - dòng tóm tắt có thể nằm giữa các dòng của cùng một đợt.
- (T1) **"Hố đen mạng"** (không có `statement_timeout` nào bắn): 8 lượt treo giữ trần mãi ⇒ hàng chờ không xả, các mục quá tuổi bị bỏ sau 10 phút.
  Posture `dayTu` cho thấy trần đã đầy từ khi nào.
- (T1) **Trần theo TIẾN TRÌNH.** N bản API cho N × 8 kết nối và N hàng chờ.
- (T1) **Số adapter mỗi máy — mã KHÔNG giới hạn** (`lenhHmi.ts` đọc adapter không `limit`). ĐO 2026-10-27, chỉ đọc:
  - DEV `aoi_management`: 15 adapter / 15 máy, mỗi máy ĐÚNG 1 adapter, 0 máy có ghim STOP;
  - `_test` (dữ liệu test để lại): tối đa 9 adapter bật / máy (2 máy), tối đa 3 adapter có ghim / máy.

  Test I-1 dùng K = 5 có override và K = 9 không override.
- (T1) **Ngoài bộ đếm (mục 73 / 74 của danh sách R1b-2b-2b):**
  - audit nền của B3 / canh STOP (`auditWriteOverlapRisk`, báo động `ot_stop_unverified`);
  - `raiseUnverifiedStopRefusedAlert`;
  - lượt đọc / chèn dòng chờ trước-gửi bị bỏ rơi khi quá hạn (`trongHanStop`).
- (T1) **Giới hạn của census AST** (`nganSachPoolStop.test.ts`):
  - phép gán `x = f()` không `await` không bị vị từ ngược xét;
  - tên hàm so theo chữ, không theo kiểu;
  - lời gọi ghi sổ qua bí danh không bị vị từ thuận thấy (vị từ ngược vẫn bắt nếu nó nổi);
  - fix round 1 đã phủ thêm: thân gọn của arrow bị bỏ kết quả (`(): void => …`, `() => void …`, đối số `forEach`) và thunk trả một promise phát TRƯỚC
    (định danh từ ngoài thunk); vẫn hở: promise phát trước rồi truyền qua nhiều lớp biến / hàm trung gian.

### DỮ LIỆU

_(Task 11)_

### VẬN HÀNH

- (T1) Bộ đếm `demGhiBoQuaDay`, hàng chờ ghi nền và tóm tắt chưa ghi đều mất khi khởi động lại tiến trình. `batDauLuc` cho biết bộ đếm đếm từ khi nào.
- (T1) Tắt êm: `server.close` chờ lượt xả (≤ 2 s); hạn ép thoát 5 s của `gracefulShutdown` vẫn đứng trên cùng.

## 7. Bảng số đo

_(Task 11)_

## 8. Đột biến theo task

_(Task 11 — chi tiết từng task ở `.superpowers/sdd/2026-10-27-scada-r1b-2b-2a-an-toan-duong-stop/task-N-report.md`)_

## 9. Danh sách R1b-2b-2b

_(Task 11)_
