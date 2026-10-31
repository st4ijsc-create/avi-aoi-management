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
| `scadaDiag.tomTatTruyenThong` + che `endpoint` / `lastError` | C2 | `b5c2cbb63` … `14bc31526` (fix 1–4 + polish) — LÊN main `10c81faff` (2026-11-01); polish kiem-dinh `9a1d26aaa` đi cùng lô C4 | B-T7 |
| `scadaKenh.danhSach[*].canhBaoNguon` | C3 | `e40cdc147` + `34f236452` — LÊN main `10c81faff` | B-T6 |
| `scadaDiag.thuDocDiaChi` | C4 | `fe5a1c2ff` + `4950269df` + fix 1 `40424ec48` (nhánh feat/scada-2bA-hop-dong) | B-T9 |
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

### C2 (KD-2bA 2.1 / 2.2, điều phối 2026-10-27 … 2026-11-01) — che chi tiết kỹ thuật trên MỌI bề mặt, kể cả đường vòng REST

- **Ai bị che:** mọi người KHÔNG phải (`admin` | `engineer`) có `machine_control.canEdit` (`chiTietKyThuatCua`), và MỌI API key (không bao giờ là
  người xem chi tiết; không thêm scope).
- **Che gì:** `endpoint` / `activeEndpoint` / `connectionOptions` ⇒ `null`; `lastError` / văn bản lỗi driver ⇒ MÃ đã làm sạch (`maLoi`:
  `OT_S7_*`, `ADAPTER_OFFLINE`, `TECHNICAL_ERROR`, mã trong `MA_LOI_DA_BIET`; không bao giờ host:port). Khi có nhiều mã, nhóm an toàn thắng:
  FOE_OUTCOME_UNKNOWN / FOE_OUTCOME_PARTIAL / EDGE_OUTCOME_UNKNOWN / MOT_PHAN / TIMEOUT. Mã dự phòng theo LOẠI bước: lệnh ⇒
  DRIVER_WRITE_FAILED / REJECTED / TIMEOUT; precondition ⇒ PRECONDITION_FAILED; wait ⇒ TIMEOUT; khác ⇒ TECHNICAL_ERROR.
- **Ở đâu:** `scadaDiag.danhSach`; `deviceAdapter.list/get/create/update`; `deviceAdapter.testConnection({id})` (không còn khoá `error`, chỉ
  `errorCode`); `systemHealth.connectionSupervisors`; REST `GET /api/observability/health`; `orchestration.getRun` / `listRuns` /
  `edgeRuntime.nodeStatus` + REST `/orchestration/runs/:id` (`run.error`, `steps[*].error` ⇒ mã; `result.detail` theo danh sách trắng giữ
  outcomeUnknown / motPhan đếm / jobId / appError…); fleet status (admin thiếu canEdit cũng bị che); REST `GET /api/v1/assets/:id/health`;
  REST `POST /api/v1/equipment/:id/commands` (`detail` / `error`).
- **Không bao giờ che:** `tamKhoa` (`{ ma: "OT_MC_TAM_KHOA", lyDo }`) — người vận hành phải thấy thiết bị đang tạm khoá.
- **Chốt mất dữ liệu:** người bị che gửi `endpoint` / `connectionOptions` / `protocol` vào `deviceAdapter.update` ⇒ FORBIDDEN
  `OPERATION_FAILED {operation:"deviceAdapterUpdate", reason:"chiTietKyThuatBiChe"}` trước mọi lượt ghi / TOTP; các trường khác vẫn sửa được.
  Hộp sửa adapter ẩn endpoint / cấu hình kết nối / nút kiểm tra và khoá giao thức với hàng bị che.
- **Census:** `server/routers/chiTietKyThuatBeMatCensus.test.ts` — quét REST (`server/api/**`, `server/routes/**`) + tRPC, 6 dạng import động,
  ghim số (sau C4 fix 1: 72 chỗ / 105 lần trúng / 15 che / 57 miễn có lý do), chặn quét rỗng. 10 route edge-node MIỄN (token edge, node sở hữu
  adapter); `POST /edge/node/config` (trả connectionOptions ĐÃ GIẢI MÃ): "requires edge token + the node owns the adapter; if this route ever
  accepts an API key or a user session ⇒ re-decide".
- **Miễn audit (2026-11-01, điều phối):** `scadaDiag.tamTat` ghi `endpoint` vào `before` của `control_audit_log` — GIỮ (điều tra cần). Bằng chứng:
  không thủ tục / route / export / socket / công cụ AI nào trả `beforeJson` / `afterJson` ra ngoài; chỉ bản pg_dump toàn DB của admin có hàng thô.
  Census bất biến `server/routers/controlAuditLogDocCensus.test.ts`: bên đọc mới ⇒ đỏ.
  - **MCP local dev tool — known reader, outside app permissions:** vai `mcp_chi_doc` (127.0.0.1, bearer, công cụ phát triển trên máy) đọc được
    `control_audit_log.beforeJson` và `device_adapters.endpoint` / `lastError`; bí mật trong connectionOptions đã niêm (`sealConnectionOptionSecrets`).
    Quyết lại nếu MCP mở ra ngoài loopback.
- **Ngoại lệ tệp Phần B (2026-10-31, điều phối cho phép):** `client/src/components/scada/BangTruyenThong.tsx:187` đổi ĐÚNG một dòng
  `title={h.endpoint ?? undefined}` — chỉ về kiểu, hiển thị không đổi. Lý do: 2.1 làm `endpoint` nullable ⇒ tsc đỏ; bằng chứng: tsc trước exit 2
  (`BangTruyenThong.tsx(187,87)`, `DeviceAdapterManagement.tsx(720,65)` TS2322) / sau exit 0.

### C3 — cảnh báo nguồn cho tag ứng viên

- `scadaKenh.danhSach({adapterId})[*].canhBaoNguon` ∈ deadband | edge | bao_khi_doi | poll_cham | null — cùng luật `canhBaoCua` với kênh chế độ
  hiện có; quyền / phạm vi / NOT_FOUND không đổi.

### C4 — Lab "thử đọc một địa chỉ" (`scadaDiag.thuDocDiaChi`)

- admin | engineer + `machine_control.canEdit` + `MOD_OT_CONTROL`, KHÔNG đòi 2FA (Q1). Audit Ý ĐỊNH trước khi đọc (hỏng ⇒ không đọc), audit KẾT QUẢ
  sau qua bộ ghi nền có trần, hai dòng nối bằng `maLuot`. 10 lượt / phút / người, 1 lượt đang bay / adapter (`scadaLabDangBan`).
- Đường đọc riêng `docLab` (không ghi `lastOkAt` / `lastError` / `lastLatencyMs`), không bao giờ `writeTags` / `connect` / reset phiên.
- `GIAO_THUC_THU_DOC = {stub, modbus (TCP), opcua}` — chứng minh bằng thư viện thật (đảo thứ tự trả lời 0 sai; STOP khi Lab treo 5–16 ms).
  LOẠI: EtherNet/IP (đọc xếp hàng ⇒ poll hỏng + hạ phiên), SLMP (STOP chờ ~1 s, không ack), S7 / MC (Q1).
- Từ chối phiên cũ: adapter TẮT trong DB ⇒ `adapterNotRunning` dù driver còn chạy; dấu vân tay phiên ≠ hàng DB (endpoint sửa chưa khởi động lại
  OT) ⇒ CONFLICT `scadaLabPhienCu` — không bao giờ trả dữ liệu cũ như "good".

## 6. Giới hạn đã biết

### LOGIC

- C1 — `commandLog.list` / `get` VẪN trả (quyết định hiển thị 2026-10-30): `address` (tag / thanh ghi / nodeId từ cấu hình tag, KHÔNG phải endpoint —
  người vận hành cần nó), `readBackValue` (giá trị quá trình, cũng hiện trên HMI), `correlationId` / `idempotencyKey` / `deadlineMs` (nội bộ, vô hại).
  `endpoint` / `lastError` được che ở C2.

- C1 — kết quả dispatch (`reason` = `errorText`) vẫn trả cho NGƯỜI RA LỆNH đã qua `machine_control.canEdit` kể cả vai operator (đường ghi
  `commandDispatcher` / `lenhHmi`, ngoài phạm vi C1 — xem báo cáo task C1 "lo ngại").
- C1 — văn bản driver còn được CHÉP lúc ghi sang `scada_command_attempts` (lenhHmi bước 9, đường thử lại idempotent) và sang cảnh báo STOP
  quét của edge (`edgeReportsCentral.ts` `applySweepStop` ⇒ `raiseCriticalStopAlert` tới admin + người chạy). `nhatKy` che phía ĐỌC; sửa phía ghi
  thuộc A2 (lenhHmi là tệp của 2a).
- C1 — đồ thị gọi của census §3 theo TÊN (≤ 5 bậc): chỉ đi thủ tục tRPC dưới `server/routers/`; bỏ sót REST (`server/routes/*`, `server/api/**`),
  registry tool AI, import động và hàm là thuộc tính object (`export const svc = { doc: async () => … }`); xấp xỉ trên khi trùng tên. Tham chiếu
  TRỰC TIẾP tới bảng ở mọi tệp `server/` vẫn bị §1 bắt (kể cả `schema.commandLog` qua import động — fix round 2).
- C2 — census bề mặt theo dõi dịch vụ MỘT bậc, không quét socket; miễn phân loại tay. Chưa thấy (backlog A2): `Promise.all([import(…)])`,
  re-export không `from`, SQL thô có tên bảng nằm trong biến / nối chuỗi.
- C2 — câu i18n `TIMEOUT` ("không chắc thiết bị đã nhận") sai nghĩa cho `wait_state` hết hạn (không gửi gì); nhận diện precondition chỉ ở ĐẦU chuỗi
  bên trong lỗi Parallel; `outcomeUnknown` có trong danh sách trắng nhưng chưa nơi nào đặt (giữ + ghim để không bị lột im lặng). Backlog A2.
- C2 — `UnifiedDeviceMonitor.tsx:247 / :372` (toast "unknown", dòng phụ rỗng khi endpoint null) và `OrchestrationStudio.tsx:3102 / :3121` (đọc
  chuỗi lỗi, nay là mã) — việc client của scada-ui.
- C4 — Modbus TCP→RTU gateway / thiết bị một giao dịch có thể bỏ yêu cầu Lab đồng thời (trần 1 / adapter giới hạn ở một yêu cầu thừa);
  modbus-serial dùng lại transaction id sau 256 (có sẵn).

### DỮ LIỆU

- C1 — `command_log.createdAt` là cột KHÔNG múi giờ: `nhatKy` coi nó là UTC (như drizzle typed) khi gộp với `scada_command_attempts.at`
  (timestamptz). Đúng khi `TimeZone` của phiên Postgres ghi hàng là UTC (`_test` đo `Etc/UTC`, có ca khẳng định); máy chủ khác UTC ⇒ thứ tự
  gộp lệch đúng độ lệch múi.
- C1 — chưa có chỉ mục `(at, id)` trên `scada_command_attempts` cho phân trang nhật ký (hoãn: dải mig 0435–0439 sau khi đo).
- C1 — mỗi lượt test DB để lại ~70 hàng `command_log` + ~70 hàng `scada_command_attempts` trong `_test` (vai test không xoá được) — cô lập bằng
  adapter / người dùng mới mỗi lượt; KHÔNG BAO GIỜ id tường minh (census I4).

### VẬN HÀNH

- C1 — TimeZone của Postgres PHẢI là `Etc/UTC` (cột naive `command_log.createdAt` được đọc như UTC khi gộp với `scada_command_attempts.at`);
  mới chỉ khẳng định trong phiên `_test` (ca DB của C1) — kiểm lúc khởi động máy chủ là việc tồn (backlog).
- C2 — runbook `/api/observability/health` (45_W0, 52_P0) đã ghi: route có cổng phiên; `activeEndpoint` / `lastError` bị che khi người gọi thiếu
  engineer | admin + `machine_control.canEdit`. Tích hợp ngoài dùng API key chỉ nhận MÃ — cần văn bản thô thì là quyết định riêng sau.
- C4 — Lab đọc qua phiên ĐANG chạy; sửa endpoint ⇒ khởi động lại / nối lại OT trước khi dùng Lab (nếu không: `scadaLabPhienCu`).
- _(Task 16 — các mục khác)_

## 7. Bảng số đo

_(Task 16)_

## 8. Đột biến theo task

- C1 — 12 đột biến trên `commandLogRouter.ts` + 3 đột biến trong bộ nhớ trên nguồn `lenhHmi.ts` (KD-2bA 1.3), mỗi cái làm đỏ ≥ 1 ca; chi tiết ở
  báo cáo task C1.
