# SCADA R1b-2b-2b · Phần A · Báo cáo nghiệm thu (KHUNG — điền dần theo task, hoàn tất ở Task 16)

> Khung tạo ở C1 (điều phối 2026-10-27, KD-2bA 1.1: che `ackValue` / `errorText` ở `commandLog.list/get` là thay đổi hành vi nhìn thấy được, phải
> ghi ở đây). Task 16 điền các mục còn trống: ma trận ô (`server/services/scada/r1b2b2bANghiemThu.db.test.ts`), đột biến hệ thống, chạy toàn bộ,
> bảng số đo, câu nguyên văn về `AI_OT_CONTROL_ENABLED`.

## Kết luận ngắn

_(Task 16)_

## 1. Hợp đồng đã giao (Phần B dựa vào)

| Hợp đồng | Task | Commit | Bên tiêu thụ |
|---|---|---|---|
| `commandLog.nhatKy` + route `/scada/journal` + che chi tiết kỹ thuật ở `commandLog.list/get` | C1 | _(commit C1 trên feat/scada-r1b2b2 — điều phối ghi hash khi gộp)_ | B-T8 |
| `scadaDiag.tomTatTruyenThong` + che `endpoint` / `lastError` | C2 | _(C2)_ | B-T7 |
| `scadaKenh.danhSach[*].canhBaoNguon` | C3 | _(C3)_ | B-T6 |
| `scadaDiag.thuDocDiaChi` | C4 | _(C4)_ | B-T9 |
| `scadaCommands.dieuKienChoPhep` | C5 | _(C5)_ | B-T11 |

Đặc tả nguyên văn của từng hợp đồng: báo cáo task (`.superpowers/sdd/2026-10-27-scada-r1b-2b-2b-A/task-C<n>-report.md`).

## 2. Ma trận ô — `server/services/scada/r1b2b2bANghiemThu.db.test.ts`

_(Task 16)_

## Thay đổi hành vi nhìn thấy được

### C1 (KD-2bA 1.1, điều phối 2026-10-27) — sổ lệnh che chi tiết kỹ thuật với người không phải kỹ sư

- **Trước:** `commandLog.list` / `commandLog.get` trả NGUYÊN hàng `command_log` cho mọi người có `machine_control.canView` — kể cả `errorText`
  (văn bản THÔ của driver / edge — đúng chữ dispatcher ghi cho kết cục thiết bị, KHÔNG có tiền tố mã: vd `connect ECONNREFUSED 127.0.0.1:502`,
  `write timeout after 2000ms — outcome unknown: the write may have been applied on the device`, `edge reported status "aborted"`,
  `readback mismatch: expected=1 actual=0`; chỉ từ chối ở cổng mới có dạng `<MÃ>: <chi tiết>`) và `ackValue` (ledger nội bộ intent / result,
  payload ack thiết bị).
- **Sau:** cùng hai thủ tục, cùng tên cột, nhưng `errorText` / `ackValue` = `null` với mọi người KHÔNG phải (`admin` | `engineer`) có
  `machine_control.canEdit` (`duocXemChiTietKyThuat`, `server/routers/_chiTietKyThuat.ts`). Operator CÓ `canEdit` cũng bị che (luật theo vai + quyền).
  Mỗi hàng thêm bốn trường suy ra cho MỌI người xem: `ledger` (`ackValue.ledger`), `intentId` (`ackValue.intentId` khi là SỐ), `maLoi`,
  `loiBiChe` (true ⇔ có `errorText` nhưng bị che). `maLoi` (fix round 1, review I1) = tiền tố `MA:` nếu có, ngược lại mã DỰ PHÒNG theo
  status / hình văn bản: `TIMEOUT` (status timeout hoặc "outcome unknown … may have been applied" — gợi ý an toàn "không rõ máy đã nhận, đọc
  lại trước khi gửi lần nữa" sống qua lớp che), `DRIVER_WRITE_FAILED` (failed, văn bản thô), `EDGE_REPORTED`, `READBACK_UNAVAILABLE`,
  `READBACK_MISMATCH`, `TECHNICAL_ERROR` — không bao giờ `null` khi có `errorText`.
- **Giao diện:** trang "Nhật ký kiểm toán lệnh" (`/command-audit` và tab Lệnh của `/audit-logs`, `client/src/pages/CommandAuditLog.tsx`) — cột
  "Sổ ghi" đọc `ledger` / `intentId` (không còn đọc `ackValue`; nhãn intent / kết quả KHÔNG đổi với mọi người); cột "Lỗi" với người bị che hiện
  `<chữ của maLoi> · Chi tiết kỹ thuật bị ẩn (cần quyền kỹ sư)` — chữ của mã qua bảng có sẵn `scada.lenh.cong.<MÃ>` (vd `TIMEOUT` ⇒ "Không rõ
  máy đã nhận hay chưa — đọc lại giá trị trước khi gửi lần nữa"), mã dự phòng qua `commandAudit.maLoi.<MÃ>`, mã lạ ⇒ mã thô (khoá
  `commandAudit.loiBiChe` + `commandAudit.maLoi.*`, vi / en / zh), không bao giờ ô trống im lặng. Kỹ sư / admin có `canEdit` thấy y như trước.
- **Không đổi:** `commandLog.stats` / `avgDurations` (không trả hai cột); phạm vi nhà máy của `list` / `get` (2026-10-24); `scadaCommands.trangThai`
  (đã chỉ trả `ma` / `ledger` từ R1a).
- **Census:** `server/routers/chiTietKyThuatCommandLogCensus.test.ts` (đảo chiều ở fix round 1) — MỌI tham chiếu tới bảng `commandLog` (kể cả
  bí danh / import đổi tên / namespace / join / getTableColumns / `db.query`) và MỌI SQL thô có `command_log` trong `server/` có phân loại; thủ tục
  tRPC chạm hàm rủi ro qua đồ thị gọi được ghim; thủ tục canView trả hàng phải đi qua bộ che. `server/testing/wormIdTuongMinhCensus.test.ts`: test
  không chèn `id` tường minh vào bảng WORM / không-xoá-được (nguyên nhân sự cố `_test` 2026-10-30).
- **Thủ tục mới** `commandLog.nhatKy` (nhật ký `/scada/journal`, sau `MOD_OT_CONTROL`): `loi` (errorText) chỉ cho kỹ sư / admin `canEdit`,
  `ackValue` không bao giờ ra; người ra lệnh ngoài phạm vi người xem hiện "quản trị" với `nguoi.id = null` (`nguoi.ngoaiPhamVi`); lần thử
  `stage = 'dispatch'` (có thể mang văn bản driver chép lúc ghi) ⇒ với người bị che: `reasonCode` về MÃ, `lyDo` null (+ `loiBiChe`); `den` bao
  gồm trọn mili-giây cuối (+ 999 µs).

## 6. Giới hạn đã biết

### LOGIC

- C1 — kết quả dispatch (`reason` = `errorText`) vẫn trả cho NGƯỜI RA LỆNH đã qua `machine_control.canEdit` kể cả vai operator (đường ghi
  `commandDispatcher` / `lenhHmi`, ngoài phạm vi C1 — xem báo cáo task C1 "lo ngại").
- C1 — văn bản driver còn được CHÉP lúc ghi sang `scada_command_attempts` (lenhHmi bước 9, đường thử lại idempotent) và sang cảnh báo STOP
  quét của edge (`edgeReportsCentral.ts` `applySweepStop` ⇒ `raiseCriticalStopAlert` tới admin + người chạy). `nhatKy` che phía ĐỌC; sửa phía ghi
  thuộc A2 (lenhHmi là tệp của 2a).
- C1 — đồ thị gọi của census §3 theo TÊN (≤ 5 bậc): chỉ đi thủ tục tRPC dưới `server/routers/`; bỏ sót REST (`server/routes/*`, `server/api/**`),
  registry tool AI, import động và hàm là thuộc tính object (`export const svc = { doc: async () => … }`); xấp xỉ trên khi trùng tên. Tham chiếu
  TRỰC TIẾP tới bảng ở mọi tệp `server/` vẫn bị §1 bắt (kể cả `schema.commandLog` qua import động — fix round 2).

### DỮ LIỆU

- C1 — `command_log.createdAt` là cột KHÔNG múi giờ: `nhatKy` coi nó là UTC (như drizzle typed) khi gộp với `scada_command_attempts.at`
  (timestamptz). Đúng khi `TimeZone` của phiên Postgres ghi hàng là UTC (`_test` đo `Etc/UTC`, có ca khẳng định); máy chủ khác UTC ⇒ thứ tự
  gộp lệch đúng độ lệch múi.
- C1 — chưa có chỉ mục `(at, id)` trên `scada_command_attempts` cho phân trang nhật ký (hoãn: dải mig 0435–0439 sau khi đo).
- C1 — mỗi lượt test DB để lại ~70 hàng `command_log` + ~70 hàng `scada_command_attempts` trong `_test` (vai test không xoá được) — cô lập bằng
  adapter / người dùng mới mỗi lượt; KHÔNG BAO GIỜ id tường minh (census I4).

### VẬN HÀNH

_(Task 16)_

## 7. Bảng số đo

_(Task 16)_

## 8. Đột biến theo task

- C1 — 12 đột biến trên `commandLogRouter.ts` + 3 đột biến trong bộ nhớ trên nguồn `lenhHmi.ts` (KD-2bA 1.3), mỗi cái làm đỏ ≥ 1 ca; chi tiết ở
  báo cáo task C1.
