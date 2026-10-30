# SCADA R1b-2b-2a · Báo cáo nghiệm thu (KHUNG — điền dần theo task, hoàn tất ở Task 11)

> Khung tạo ở Task 1 (điều phối 2026-10-27: thay đổi ngữ nghĩa bộ đếm T9 phải ghi vào "thay đổi hành vi nhìn thấy được"). Task 11 điền các mục còn
> trống: ma trận ô, đột biến hệ thống, chạy toàn bộ, bảng số đo, danh sách R1b-2b-2b, câu nguyên văn về `AI_OT_CONTROL_ENABLED`.

## Kết luận ngắn

_(Task 11)_

**Mốc gộp:** T0 + T1 đã lên main ở `3ab258eb4` (cổng dieu-phoi xanh, trừ `opcuaDriver.secure.sim` đỏ do Node 26 và flake `fetchModels`). Phần Node 26 do scada-ui vá ở `4dd3013f4` (main `c96e4c3dc`); nhánh nhận main ở `fdb4ac727` trước T2.

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
  - Mục QUÁ 16 KB (fix round 2, sửa ở fix round 3): audit được CẮT cho vừa — CHỈ `before` / `after`; ĐỊNH DANH (`entityType`, `entityId`, `action`,
    `actorId`, `reason`) chép NGUYÊN VĂN. Mọi hàng cắt mang DẤU CẮT trong `after` (phần được băm): `daCat: true` + `catGoc.<before|after>` =
    `doDaiGocByteUtf8` (số BYTE UTF-8) + `sha256Goc` của `canonicalize(bản gốc)` (JSON khoá sắp xếp — `services/security/auditChain.ts`) cho MỖI
    trường thực sự bị cắt ⇒ chuỗi băm chứng nhận đúng thứ được lưu, không trình hàng cắt như hàng đủ; ai có bản gốc kiểm lại được. Chỗ cho dấu cắt
    được dành trước. Riêng định danh (+ dấu cắt) quá trần ⇒ TỪ CHỐI hàng (KHÔNG cắt định danh), lý do riêng `dinh_danh_qua_lon` trong tóm tắt.
    Ghi bằng người ghi từ nội dung dựng ở phạm vi riêng (không giữ tải gốc). Attempts / chốt dòng chờ quá lớn và mục cắt rồi vẫn không vừa ⇒ bỏ
    (`qua_lon`). Đường nhanh ghi nguyên.
  - Xả dưới CÙNG trần 8 (kể cả dòng tóm tắt): ngân sách pool 8 + 8 ≤ 25 − 9 không đổi. Lượt mới không vượt lượt đang chờ (không đói).
  - STOP không bao giờ chờ hàng chờ: lượt xếp hàng trả người gọi NGAY.
  - **Giờ SỰ KIỆN được giữ:**
    - attempts: cột `at` (`ghiThuLenh` nhận `at` tuỳ chọn);
    - audit: `after.lucSuKien` + `after.tuHangCho: true`, vì `recordAuditEvent` không nhận giờ; nằm trong phần được băm của chuỗi;
    - chốt dòng chờ: `executedAt` = giờ sự kiện.
  - Log `<nhan>_xep_hang` (warn) khi xếp hàng.
- **Chỉ tràn / quá tuổi / quá lớn (không cắt được) / tắt máy mới BỎ; audit ghi HỎNG (fix round 2, `loi_ghi`) cũng vào tóm tắt.**
  - Log error `<nhan>_bo_<lyDo>` mang nội dung hàng (cắt), gọi `khiBoQua`.
  - Đếm 24 h `demGhiBoQuaDay()` theo bảng đích (KD-A3). Attempts STOP_QUA_HAN bị bỏ còn đếm vào `stopQuaHan24h.khongGhiSo.theoBuoc.ghi_so_loi` (Q2).
  - Gộp vào **MỘT dòng tóm tắt** `control_audit_log` `ot_stop_ghi_nen_bo_roi` (mã `ma` + `maDaGop`, số lượng, theo lý do / nhãn / bảng, khoảng giờ sự
    kiện, ≤ 32 requestId, `khongRoDaGhi`),
    nằm TRONG chuỗi băm khi SEC_PLATFORM bật.
  - Dòng tóm tắt không bao giờ bị bỏ: nó đi trước hàng chờ khi có chỗ; ghi hỏng ⇒ giữ lại, gộp lượt bỏ mới, thử lại sau 2 s và ở lần xả kế tiếp.
- **Tắt tiến trình** (`stopOt({ tatTienTrinh: true })` → `xaHangChoKhiTat`; `server.close` chờ cùng promise trước `process.exit`):
  - xả tối đa 2 s, chờ CẢ hàng chờ, tóm tắt VÀ lượt đang bay (fix round 2, re-review N-1);
  - hàng chờ còn lại ⇒ MỘT dòng log `ot_stop_ghi_nen_tat_may_con_lai`, các lượt ấy bị bỏ (lyDo `tat_may`);
  - lượt VẪN ĐANG BAY ở hạn ⇒ MỘT dòng log `ot_stop_ghi_nen_tat_may_dang_bay` LIỆT KÊ chúng (≤ 32: nhãn, requestId, bảng, giờ sự kiện; `ketCuc: khong_ro`)
    và vào tóm tắt (lyDo `dang_bay_khi_tat`, `khongRoDaGhi` — có thể đã hoặc chưa commit);
  - thôi chờ ở hạn − 500 ms (`HAN_DU_TRU_TOM_TAT_KHI_TAT_MS`, fix round 3): ≥ 500 ms cuối DÀNH cho lượt ghi tóm tắt (trước: còn 1 ms ⇒ không bao
    giờ commit); sau đó `xa` không phát lại tóm tắt (chống ghi đôi).
  - ⚠ Không bảo đảm commit: dưới SEC_PLATFORM, nếu chính các lượt treo đang GIỮ khoá chuỗi băm (hoặc DB treo), dòng tóm tắt vẫn có thể không commit
    trong 500 ms — khi đó dấu vết duy nhất là các dòng log (`ot_stop_ghi_nen_tat_may_dang_bay`, `ot_stop_ghi_nen_tat_may_tom_tat_loi` mang nội dung
    tóm tắt).
- **Van xả chỗ rò** (fix round 3, kiem-dinh): lượt ghi nền đang bay quá `HAN_GIAI_PHONG_SLOT_MS` = 120 s (> statement_timeout 30 s + dư) coi như RÒ —
  log error `<nhan>_giai_phong_slot`, trả chỗ của nó MỘT lần, posture `slotGiaiPhong`; lượt thật xong sau không trừ lần hai. Trong lúc ấy kết nối có
  thể vẫn bị giữ (trần 8 không còn là chặn trên số kết nối thật).
- **Posture** `oversight.posture.ghiNenStopBoQua24h` (chỉ toàn quyền; chỉ trường máy chủ — dòng giao diện ở Task 9):
  - `count` / `theoBang`: lượt bị bỏ trong 24 h;
  - tín hiệu sống: `dangBay` / `tran`, `dayTu` (lúc trần đầy), `hangCho` / `hangChoTheoBang` / `tranHangCho`, `tomTatCho`, `slotGiaiPhong`.
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

### Task 3A (backlog 79) — EtherNet/IP: ack muộn không bao giờ tính cho lời ghi kế; kiểu CIP từ danh sách tag (fix round 1: băng `khong_dat`)

- **Lời ghi EIP nay THẬT SỰ tới PLC.** Trước (đo bằng thiết bị ENIP giả + st-ethernet-ip 2.7.5 thật): `newTag` không mang kiểu CIP ⇒ thư viện ném
  "Tag … has not been initialized" TRƯỚC khi gửi ⇒ MỌI lời ghi EIP, kể cả STOP, `failed` tại chỗ, 0 gói. Nay kiểu CIP lấy từ danh sách tag thư viện nạp
  lúc connect (`state.tagList`) ⇒ gói Write Tag ra dây. ⚠ **Lời ghi EIP thật đầu tiên trên một bộ điều khiển cần kiểm tra chạy thử (commissioning)**
  — trước đây không lời ghi EIP nào từng tới thiết bị (DEV: 3 adapter ethernet-ip là SIM, tắt, chưa từng nối).
- Tag không có trong danh sách / không có kiểu nguyên tử (thành viên UDT, ghi cả mảng, chỉ số trên tag không phải mảng, kiểu cấu trúc) ⇒ `failed` mã
  `EIP_TAG_TYPE_UNKNOWN`, KHÔNG gửi gì, không bao giờ đoán kiểu.
- **Phiên nhiễm.** Bất kỳ hết hạn của thư viện (đọc / ghi) ⇒ phiên bị hạ và mở phiên MỚI; ack / trả lời muộn của yêu cầu cũ không bao giờ thành `ok`
  của lời ghi kế (STOP) hay mẫu `good` của lần đọc kế (trước: STOP báo ok từ ack của lời ghi cũ; đọc TagB "good" mang giá trị TagA). Lời ghi đang bay
  trên phiên bị hạ ⇒ `timeout` không rõ (băng `khong_ro`).
- **STOP quá trần chờ phiên mới (2000 ms) ⇒ KHÔNG gửi, `failed`** (`ethernet-ip: not connected — no fresh session within 2000ms after a contaminated
  session — nothing sent`).
- **Băng E-STOP CỨNG cho STOP `failed` / `rejected`** (HMI, `DungMay.tsx`): `loai: "khong_dat"`, khoá i18n mới `scada.dungMay.bangEstop.khongDat`
  (vi/en/zh — "STOP HMI KHÔNG tới được adapter {{list}} — dùng E-STOP cứng tại máy"; KHÔNG dùng chữ `khong_ro`: "không tới" ≠ "không rõ"). Trước:
  STOP `failed` chỉ có dòng đỏ trong hàng, không băng cố định. Ưu tiên khi trộn: `qua_han_mot_phan` > `khong_dat` > `khong_ro`, mỗi danh sách giữ.
  Hàng edge / trung tâm dự phòng không tính. STOP thành công trọn vẹn sau đó vẫn gỡ băng (M-1).
- **Fix round 2 (kiem-dinh M1/M2/M4/M5/M6 + dự phòng 6500):**
  - trần chờ phiên mới tính THEO TỪNG lời ghi (≤ 2000 ms và ≤ phần còn lại của `OT_CONTROL_TIMEOUT_MS` từ đầu lời gọi) — lời ghi thứ hai của STOP nhiều
    tag không còn `failed` ngay khi lời ghi đầu hết hạn > 2000 ms;
  - tên tag so KHÔNG phân biệt hoa thường (như Logix), ghi bằng tên CHUẨN của PLC (`stop` ⇒ `Stop`); hai tag chỉ khác hoa thường ⇒ `failed`
    `EIP_TAG_NAME_AMBIGUOUS`, 0 gói;
  - phần tử mảng BOOL (CIP BIT_STRING 0xD3) ⇒ `failed` `EIP_BIT_ARRAY_UNSUPPORTED`, 0 gói (trước: chuỗi giá trị có thể ghi đè 32 BOOL);
  - phiên nhiễm bị hạ NGAY: xả hàng đợi task-easy của thư viện + huỷ socket (không forwardClose chờ `timeout_sp`) ⇒ lời ghi đang xếp hàng không bao
    giờ ra socket cũ; nhãn không đổi (`timeout` không rõ);
  - bộ hẹn DỰ PHÒNG 6500 (hạn lệnh / `deadlineMs` > ~5,5 s) cũng làm phiên nhiễm ⇒ hạ ngay ⇒ thư viện không còn giữ / gửi lệnh cũ; STOP kế chạy trên phiên
    mới, không chồng (đo: lệnh cũ đúng 1 gói trên kết nối 1, STOP chỉ trên kết nối 2);
  - thông điệp `failed` nói ĐÚNG lý do: quá trần (`within the Nms wait bound`), mở lại hỏng (kèm nguyên nhân), bị thay (connect/disconnect — người chờ
    được giải NGAY).

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
- (T1) **"Hố đen mạng"** (không có `statement_timeout` nào bắn): lượt treo giữ chỗ tới van xả (120 s) rồi chỗ được trả — hàng chờ xả 8 lượt / 120 s
  khi mọi lượt đều treo, mục cuối có thể quá tuổi (10 phút) và bị bỏ (có tóm tắt). Kết nối thật của lượt "rò" có thể vẫn bị giữ ⇒ số kết nối pool
  thật có thể vượt 8 trong lúc ấy; posture `slotGiaiPhong` / `dayTu` là tín hiệu.
- (T1) **Trần theo TIẾN TRÌNH.** N bản API cho N × 8 kết nối và N hàng chờ.
- (T1) **Chặn đầu hàng (head-of-line):** dưới tranh chấp khoá chuỗi băm, sổ (attempts, chốt dòng chờ) xếp sau audit chậm trong MỘT FIFO — cái giá của
  luật "không đói" của điều phối.
- (T1) **Hai đồng hồ:** `at` của attempts xếp hàng là đồng hồ ỨNG DỤNG; attempts đường nhanh dùng `now()` của DB.
- (T1) **Tóm tắt ghi đôi (hiếm):** COMMIT mơ hồ (kết nối rớt sau COMMIT) có thể ghi một tóm tắt hai lần — CÙNG `ma` nên phát hiện được; luôn thừa,
  không bao giờ thiếu. Đua lúc tắt đã chặn bằng cờ.
- (T1) **`stopQuaHan24h` đếm thiếu tạm thời** dòng STOP_QUA_HAN đang xếp hàng (tới khi xả, ≤ 10 phút); `hangChoTheoBang` cho thấy chúng.
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

- (T3A) **Trần chờ phiên MỚI sau phiên nhiễm EIP = 2000 ms** (`HAN_CHO_PHIEN_MOI_SAU_NHIEM_MS`), tính từ đầu lời gọi `writeTags` / `readTags`
  (một trần cho cả lô). Vì sao: hạn lệnh của dispatcher (`OT_CONTROL_TIMEOUT_MS`, mặc định 5000) đua từ lúc gọi `writeTags` ⇒ 2000 còn ≥ 3000 ms cho
  chính lời ghi STOP trên phiên mới; nối lại = TCP + RegisterSession + ForwardOpen + identity + danh sách tag (~5–10 vòng CIP, vài chục ms trên LAN). Đo:
  STOP quá trần trả lời ở 2001–2012 ms, độ trễ vòng lặp 70–82 ms. Nếu `OT_CONTROL_TIMEOUT_MS` bị đặt ≤ 2000, hạn của dispatcher thắng (`timeout`).
- (T3A) **`OtWrite.dataType` không được đối chiếu với kiểu CIP của PLC.** Kiểu của PLC thắng (D1); thư viện tự ép: bool ⇒ DINT 1, 5 ⇒ BOOL 1,
  **1.5 ⇒ DINT 1 (cắt im lặng)**, **"abc" ⇒ DINT 0 (im lặng)**, bool ⇒ STRING ⇒ lỗi tại chỗ (không gửi). OPC UA (tiền lệ) ép về kiểu THIẾT BỊ có kiểm
  (`coerceOpcuaWriteValue`: chuỗi không phải số / số lẻ cho kiểu nguyên / ngoài miền ⇒ từ chối) — EIP chưa có bộ ép tương đương (danh sách R1b-2b-2b).

### DỮ LIỆU

_(Task 11)_

### VẬN HÀNH

- (T1) Bộ đếm `demGhiBoQuaDay`, hàng chờ ghi nền và tóm tắt chưa ghi đều mất khi khởi động lại tiến trình. `batDauLuc` cho biết bộ đếm đếm từ khi nào.
- (T1) Tắt êm: `server.close` chờ lượt xả (≤ 2 s); hạn ép thoát 5 s của `gracefulShutdown` vẫn đứng trên cùng.
- (T3A) **Bộ điều khiển không liệt kê tag thì không điều khiển EIP được.** Get Instance Attribute List lỗi ⇒ `connect()` hỏng (như trước); danh sách
  rỗng / thiếu tag ⇒ mọi lời ghi tag đó `failed EIP_TAG_TYPE_UNKNOWN`, 0 gói. Thực tế: chỉ họ Logix.
- (T3A) **`isConnected()` giữ `true` trong lúc mở phiên mới sau phiên nhiễm** (≤ `cfg.timeoutMs`) — có chủ ý để STOP được chờ có trần thay vì
  `ADAPTER_OFFLINE`; `health().lastError` ghi "session contaminated …". Mở phiên mới hỏng ⇒ `connected=false`, supervisor lo.
- (T3A) **`disconnect()` lúc đang mở phiên mới**: lần nối đó vẫn chạy xong rồi bị hạ ngay (chốt thế hệ) ⇒ PLC thấy MỘT kết nối thừa ngắn (≤ `cfg.timeoutMs`).
- (T3A) **M3 — thời gian nối lại (danh sách tag + định nghĩa struct) phải được ĐO lúc commissioning so với trần chờ STOP 2000 ms.**
- (T3A) **Danh mục commissioning EIP:** lời ghi EIP đầu tiên THẬT SỰ tới một PLC thật; thời gian nối lại so với trần chờ STOP 2000 ms; ngân sách kết nối mồ côi (kết nối thừa ngắn khi disconnect trong lúc mở phiên mới / phiên bị hạ chưa kịp forwardClose).
- (T3A, rà lại N2) Mỗi lần phiên ENIP bị đánh dấu nhiễm, socket bị huỷ NGAY (không forwardClose lịch sự) ⇒ PLC có thể giữ MỘT kết nối mồ côi ~15 s. Ngân sách kết nối CompactLogix nhỏ ⇒ nhiều lần nhiễm liên tiếp có thể làm cạn; theo dõi lúc commissioning.
- (T3A, rà lại N1) STOP đang XẾP HÀNG trong thư viện bị xả khi phiên nhiễm thì CHƯA được gửi nhưng vẫn mang nhãn "không rõ" (băng E-STOP cứng khong_ro), không phải "không tới", và không được gửi lại trên phiên mới — backlog 83 (xét ở Task 6 nhãn theo từng write).
- (T3A, M5 phần dư) Hết hạn của CHÍNH thư viện: task-easy chạy lời ghi xếp hàng kế (C) ĐỒNG BỘ trong cùng lượt hết hạn, TRƯỚC khi driver kịp hạ phiên ⇒ C
  có thể ra socket cũ; nhãn của C là `timeout` không rõ (đúng: có thể đã áp), không bao giờ `ok`. Phiên bị hạ vì lý do khác (đọc hết hạn, dự phòng
  6500): hàng đợi được xả ⇒ C không ra dây.
- (T3A) Trần theo ngân sách lệnh dùng `OT_CONTROL_TIMEOUT_MS` toàn cục; `deadlineMs` riêng của một lệnh driver không biết (lệnh có `deadlineMs` ngắn hơn
  ⇒ hạn của dispatcher thắng ⇒ `timeout`).

## 7. Bảng số đo

_(Task 11)_

## 8. Đột biến theo task

_(Task 11 — chi tiết từng task ở `.superpowers/sdd/2026-10-27-scada-r1b-2b-2a-an-toan-duong-stop/task-N-report.md`)_

## 9. Danh sách R1b-2b-2b

_(Task 11)_
