# SCADA R1b-1 · An toàn điều khiển + nợ R1a — Báo cáo nghiệm thu (Task 12)

Ngày đo: 2026-10-25 · nhánh `feat/scada-r1b` (worktree `D:\SOURCES\_scada_wt`), gốc đo `39ce0b0cf` · máy Windows 11, Node 24.18.0,
Docker Desktop engine 29.8.2 (linux) · CSDL `aoi_management_test` (PG :5434). Không đụng :3000 / :8091 / GPU. Không push. Không sửa `.env`.

Mọi số dưới đây là **đo thật** (khẳng định của test hoặc dòng in của script). Không ô nào được khai "đạt" mà không có phép đo; không nới
ngưỡng nào. `OT_CONTROL_ENABLED` / `AI_OT_CONTROL_ENABLED` chỉ được đặt trong tiến trình test/bench (D9).

## Kết luận ngắn

| Phần | Kết quả đo |
|---|---|
| Ma trận 10 ô của brief + 3 ô điều phối (`r1bNghiemThu.db.test.ts`, stub + safety PLC mô phỏng + CSDL `_test`) | **13/13 ô đúng mã và đúng số dòng WORM**: 16 test (gồm 1 quan sát B1 và 1 đối chứng C1), **3 lượt tuần tự 16/16**; không đặt biến ⇒ 16 skipped |
| Đột biến cấp hệ thống | `lenhHmi.dungMayHmi` kiểm chế độ trước khi gửi ⇒ **S2 đỏ** (và S5, S6); 13 test còn lại xanh; hoàn tác, `git diff` rỗng |
| Bench OpenPLC (`scripts/scada-r1b-bench.ts`) | **15/15 ĐẠT, 3 lượt, PLC thật** (2026-10-25, điều phối cho phép: giới hạn 1 GiB, commit trống 18,9 → 14,5 GB): STOP HMI REMOTE + LOCAL ⇒ thanh ghi = ghim 0 (đọc lại độc lập), ghi thường ở LOCAL ⇒ MODE_LOCAL, X2 OFF_STEP 25 / 30 ⇒ thô 3; thanh ghi + container trả về gốc (§3) |
| Chạy toàn bộ (lô thường song song + lô DB tuần tự + lô nặng) | 2352 tệp, **33 481 ca: 33 382 qua, 26 đỏ (14 tệp), 73 bỏ qua**; serial 7 tệp 66/66. **0 đỏ do mã R1b-1**; 1 census đỏ do bench mới của T12 (chưa khai trong bản liệt kê VRAM) — đã sửa; còn lại có sẵn trên main / môi trường / tải (§5) |
| Census (mọi tệp `*census*`) | 57 tệp, 963 ca: 960 qua, 3 bỏ qua, **0 đỏ** |
| Lưới nghiệm thu opt-in R0 / R1a / R1b-1 | **42/42** (16 + 10 + 16), một lượt chung |
| `npm run check` (8 GB) · `npm run i18n:check` | rc 0 · sạch |
| **Kiểm định độc lập (2026-10-25) — vòng sửa (§13)** | H1 / I1 / I2 / I3 / N-1 / M6 đã sửa (6 commit) + I4 vào §4 mục 2b; mig **0434** áp TEST, **DEV chờ điều phối**; census 58 tệp 0 đỏ; opt-in 42/42; tsc 0 |

**Đánh giá:**
- **LOGIC.** STOP HMI (`scadaCommands.dungMay`) tới thiết bị bằng đúng giá trị ghim ở REMOTE, ở LOCAL (cả khi cờ cổng chế độ tắt lẫn bật),
  khi người khác giữ khoá chọn kênh dừng, khi người bấm chưa có 2FA; máy edge được định tuyến sang node edge; máy chưa ghim bị từ chối có mã
  và đúng một dòng WORM. "connected" không bao giờ hiện khi TCP lên mà mọi đọc quá hạn (cờ V2), đo trên otManager + ModbusDriver THẬT ở cả
  nhánh legacy lẫn HA, có đối chứng cờ tắt cho thấy phép đo nhìn thấy được `connected`. REST v1 trả 501 cho lệnh OT và không ghi sổ lệnh.
  Bộ điều tiết giữ 100 lần `DA_XU_LY` ở 30 dòng; mã an toàn không bị điều tiết. Mã dự phòng không tiêu được hai lần.
- **DỮ LIỆU.** 0431 / 0432 / 0433 có đủ trên DEV và TEST (kiểm chỉ đọc hôm nay, §4). `_test` sạch sau mỗi lượt (chỉ còn hàng WORM, đúng thiết kế).
- **VẬN HÀNH.** Bench OpenPLC đã chạy 2026-10-25 (điều phối cho phép): 15/15, STOP HMI dừng PLC thật ở cả REMOTE lẫn LOCAL — cổng của kế hoạch ĐÓNG (§3).
  Container `avi-openplc-bench` để lại giới hạn bộ nhớ 1 GiB (đặt theo điều kiện của điều phối), trạng thái `exited` như lúc tìm thấy.

---

## 1. Ma trận ô — `server/services/scada/r1bNghiemThu.db.test.ts`

**Chỉ chạy khi gọi tường minh (như R0 / R1a):**
- Bash: `SCADA_R1B_NGHIEM_THU=1 npx vitest run -c vitest.db.config.ts server/services/scada/r1bNghiemThu.db.test.ts`
- PowerShell: `$env:SCADA_R1B_NGHIEM_THU='1'; npx vitest run -c vitest.db.config.ts server/services/scada/r1bNghiemThu.db.test.ts`
- Không đặt biến: cả tệp bị bỏ qua (đo được: 16 skipped).

**Đường chạy thật:**
- STOP HMI: `scadaCommands.dungMay` qua tRPC caller; người dùng tạo bằng `taoNguoiDungTest`; `ctx.user` dựng từ hàng `users` (cờ 2FA đọc từ
  DB như phiên thật); phạm vi `idsTrongPhamVi` thật; quyền `machine_control` thật.
- `lenhHmi.dungMayHmi` → `dispatch()` thật: binding `requireBoundAction`, cổng kênh 3b, cổng chế độ 3c (luôn chạy cho `hmi.*`), phân loại STOP
  ghim 5a-stop với dấu vân tay kết nối THẬT (`adapterTargetFingerprint` của chính hàng adapter), đặt chỗ ghi trước, đọc lại bắt buộc.
  `OT_COMMISSIONING_REQUIRED=true` (adapter có `commissioning_records` thật), preflight safety thật.
- Safety PLC mô phỏng (D9): hàng `safety_plc_configs` thật backend `modbus`, phạm vi trạm, trỏ `ServerTCP` trong tiến trình; khoá seed độc quyền.
- Edge (S5): `edge_nodes` + `device_adapters.edgeNodeId` thật ⇒ `enqueueEdgeDeviceRequest` thật.
- C1: otManager thật (`startOt`) + ModbusDriver thật trên một máy chủ TCP IM LẶNG trong tiến trình (nhận kết nối, nhận yêu cầu, không bao giờ trả
  lời ⇒ TCP lên, mọi đọc quá hạn 800 ms; poll 1 s). Ghi `device_adapters.status` thật.
- R1: router REST v1 thật (`createV1Router`) trên express, máy `AUTOMATION` thật trong `_test`.
- W1: `scadaCommands.confirm` lặp trên một yêu cầu đã xử lý, qua bộ điều tiết thật (`dieuTietThuLenh`).
- B1: `tieuMaDuPhongNguyenTu` thật trên `backup_codes` (băm bcrypt); pool client test = 4 (> 1, song song thật).
- X1: `deviceAdapter.tags.update` thật, TOTP thật (speakeasy + `setup2FA`/`enable2FA`; `kiemXacThucTheoMuc` + bộ đếm T16 thật).

**Chỗ giả (hạ tầng, không phải cổng):** `getActiveDriver` / `getActiveConnectionFingerprint` (stub + vân tay tính từ hàng adapter); `getIO`;
`dispatch` được BỌC để đếm (gọi xuyên mã thật); `raiseCriticalStopAlert` + `sendCentralAdapterStop` ghi lại (không gửi thông báo / phiên tạm);
`baoTrangThaiAdapter` được BỌC để ghi MỌI trạng thái báo ra (C1, gọi xuyên mã thật); khoá master REST "MASTER" (R1, như
`equipmentCommands.r1a.db.test.ts`).

**Đếm WORM theo khoá của tệp** (`_test` dùng chung): attempts theo `user_id` của người dùng tệp, `command_log` theo `adapterId` của adapter tệp.

| Ô | Kích thích | Mã / kết cục đo được | Dòng WORM tăng thêm (đo) |
|---|---|---|---|
| **S1** | STOP HMI, máy REMOTE (kênh chế độ = 2), operator có 2FA | `acked_verified`, `ok`, `simulated:false`; driver nhận ĐÚNG `{dung: 0, stop_cmd: true}` (một lô); `dispatch` 1 lần; 4 hàng sổ đều `ackValue.pinnedStop = true` | attempts +1 (`dispatch/dispatched`, `ly_do` "STOP: acked_verified") · command_log +4 (intent ×2 `sent`, result ×2 `acked_verified`) |
| **S2** | STOP HMI, máy LOCAL (kênh chế độ = 1), lặp với `SCADA_CONG_CHE_DO_ENABLED` = false rồi = true | **cả hai lần** `acked_verified`, `reason` ≠ `MODE_LOCAL`, driver nhận đúng ghim; không hàng sổ nào `MODE_LOCAL`. Đối chứng trên cùng máy: `request` thường ⇒ `SCADA_MACHINE_NOT_REMOTE {khac_remote}`; `cheDoMay` = LOCAL `khac_remote` | mỗi lần: attempts +1 · command_log +4 |
| **S3** | opB `request` kênh `dung` (giữ khoá chọn), rồi opA bấm STOP | `acked_verified`, driver nhận đúng ghim; khoá của opB giữ nguyên (`user_id`, `request_id` không đổi). Đối chứng: `request` của opA trên `dung` ⇒ `SCADA_TAG_SELECTED_BY_OTHER {DANG_DUOC_CHON, boiUserId = opB}` | attempts +1 · command_log +4 |
| **S4** | operator `two_factor_enabled = false` (đọc từ DB) bấm STOP | `acked_verified`, driver nhận đúng ghim (mức 1, không 2FA) | attempts +1 · command_log +4 |
| **S5** | STOP HMI máy do edge sở hữu (node `online`, vừa kéo lệnh) | `edgeStopRequest: true`, `reason ADAPTER_OWNED_BY_EDGE`, `ok:false` (trung tâm không tự chạy); hàng `robot_motion_lock_requests` `kind stop` cho đúng node; KHÔNG STOP dự phòng trung tâm; không `MODE_LOCAL` | attempts +1 · command_log +1 (`ADAPTER_OWNED_BY_EDGE: … STOP queued for it as request #N`) |
| **S6** | máy có adapter bật nhưng không tag nào ghim | `PRECONDITION_FAILED / SCADA_STOP_NOT_PINNED {CHUA_GHIM_STOP}`; `dispatch` 0 lần | attempts **+1** (`dispatch/rejected/CHUA_GHIM_STOP`, `adapter_id` NULL, `ly_do` chứa "E-STOP") · command_log 0 |
| **C1** | cờ `OT_CHAT_LUONG_V2_ENABLED=true`; TCP lên, mọi đọc quá hạn; cửa sổ 9 s + 6 s xả lần ghi DB hẹn | **legacy:** 4 kết nối TCP, 84 byte yêu cầu tới nơi; RAM báo `connecting → lost → lost → lost → disabled`; DB thấy `connecting, error, disabled` — **không bao giờ `connected`**. **HA:** 4 kết nối, 96 byte; RAM `connecting, connecting, lost ×3, disabled`; DB `disabled, connecting, error` — **không bao giờ `connected`** (log supervisor vẫn in `state=connected` — trạng thái TCP nội bộ, xem §6) | không áp dụng (không lệnh) |
| C1 đối chứng | CÙNG kích thích, cờ V2 **tắt**, legacy | RAM báo `connected` (18 lần gọi trong 9 s), DB ghi `connected`; chỉ 1 kết nối TCP — phiên không bao giờ bị hạ dù mọi đọc quá hạn. Phép đo NHÌN THẤY được `connected` | — |
| **R1** | REST v1 `POST /api/v1/equipment/:id/commands` trên máy `AUTOMATION`: `write_tag`, `set_machine_param`, `stop` có ghim, `stop` trần | cả 4 ⇒ **HTTP 501** `{ok:false, error:{code:"not_implemented"}}`; `dispatch` 0 lần; thiết bị 0 lần | command_log **0** (theo adapter và theo khoá idempotency của 4 lệnh) · attempts 0 |
| **W1** | opA `request`+`confirm` (acked_verified), rồi 100 lần `confirm` cùng `requestId` trong < 1 phút | client nhận `CONFLICT / SCADA_REQUEST_ALREADY_HANDLED` cả 100 lần | attempts **+30** (≤ 31; đều `confirm/DA_XU_LY`) · command_log 0. Đồng hồ +61 s ⇒ lần kế ghi `DIEU_TIET` "70 lần DA_XU_LY bị gộp" rồi `DA_XU_LY`. Đối chứng: 40 lần `MODE_LOCAL` ⇒ **+40** (mã an toàn không bị điều tiết) |
| **B1** | 10 lượt SONG SONG `tieuMaDuPhongNguyenTu` cùng một mã | **đúng 1 `true`, 9 `false`**; đúng 1 mã `isUsed`; dùng lại sau đó ⇒ `false` | không áp dụng |
| B1 quan sát (không phải cổng) | 10 lượt song song qua `verifyBackupCode` ĐẦY ĐỦ (bộ đếm T16, trần 10/giờ) | 3 lượt đo, cả 3 như nhau: `true` 0, `false` 8, ném 2 (`MA_DU_PHONG_TAM_KHOA`), mã đã tiêu **1** — không tiêu hai lần, nhưng người thắng bị khoá (mục backlog T8, §10) | — |
| **X1** | `tags.update` đổi `scale` 1→2 trên tag ĐÃ KHAI, không mã | `PRECONDITION_FAILED / SCADA_CONFIG_TOTP_REQUIRED {TOTP_CAN}`; hàng giữ scale 1 | — |
| X1 | có mã TOTP đúng, tag đã khai đang ghim DỪNG 3, scale 2 làm ghim lệch lưới | `BAD_REQUEST / STOP_PIN_NGOAI_DAI {lyDo OFF_STEP, tagKey dkpin}`; hàng nguyên; **cùng mã** dùng tiếp được cho một lượt hợp lệ ⇒ lượt bị từ chối không tiêu mã | — |
| X1 | tag CHƯA khai đổi scale + address, không mã | qua như cũ (scale 5, address mới) | — |
| **X2** | dispatch AI (`set_machine_param`, dòng chờ đã xác nhận) 25 lên tag int CHƯA khai scale 10 | `rejected OFF_STEP`, `appError {SCADA_VALUE_OFF_STEP, step 10, goiY 30}`, errorText `… (goiY=30)`; thiết bị 0 lần | command_log +1 · attempts 0 |
| X2 | cùng tag, 30 | `ok`, driver nhận NGUYÊN 30 kèm `dataType int, scale 10` ⇒ số thô `inverseScale` = **3** | — |
| **X3** | kênh chế độ REMOTE nhận cách đây 31 s, adapter poll 60 s | bộ đệm: `stale = false` (ngưỡng max(3·60 s)), `ageMs ≥ 31 000`; `cheDoMay` = **LOCAL `cu`** (kẹp min(3·poll, 30 s)); `request` HMI ⇒ `SCADA_MACHINE_NOT_REMOTE {cu}`; dispatch AI với cổng bật ⇒ `rejected MODE_LOCAL: cu`, thiết bị 0. Đối chứng: tuổi 20 s ⇒ REMOTE, `request` được nhận | request: attempts +1 (`MODE_LOCAL`) · dispatch: command_log +1 |

**Lượt chạy:**
- 3 lượt tuần tự `-c vitest.db.config.ts`, mỗi lượt 16/16 (lượt đầu 89 s cho phần test; 45 s là ba cửa sổ C1). Số in của C1 và B1 giống hệt ở cả 3 lượt.
- Không đặt biến: 16 skipped.
- Sau lượt: `_test` không còn adapter / nhà máy / máy / người dùng / node edge / `safety_plc_configs` / dòng chờ mang tiền tố `r1bnt`;
  `scada_khoa_chon` 0, `scada_kenh_che_do` 0, `safety_plc_configs` còn đúng 3 hàng có sẵn (kiểm chỉ đọc).

**Giới hạn của lưới:**
- Thiết bị S1–S4 / X2 trong lưới là stub (RAM); PLC thật đo ở bench (§3: S1, S2, X2 — 15/15). S3/S4/S5/S6, C1, R1, W1, B1, X1, X3 chỉ có số đo trên lưới.
- W1 dời đồng hồ `Date` +61 s (khuôn T7) thay vì chờ 61 s thật.
- X1 dùng người dùng admin (bỏ qua `requirePermission`); phạm vi IDOR của `tags.*` do luong-ui đo ở main (§9).

## 2. Đột biến cấp hệ thống (Step 2) — chạy rồi hoàn tác; sau đó `git diff` rỗng

| Đột biến | Ô đỏ | Số đo |
|---|---|---|
| `lenhHmi.dungMayHmi` kiểm chế độ cho STOP: ngay sau cổng vai, `const d = await kiemCongCheDo(may.id); if (!d.ok) return tuChoiMay(d.tuChoi);` | **S2** + S5 + S6, 3/16 đỏ | S2: `TRPCError: Máy không ở REMOTE (khac_remote).` (STOP bị chặn ở LOCAL — đúng nguy cơ D3 muốn tránh). S5: máy edge không khai kênh chế độ ⇒ LOCAL `chua_khai` ⇒ STOP bị chặn. S6: trả `MODE_LOCAL` thay cho `CHUA_GHIM_STOP`. S1/S3/S4 (máy REMOTE) và 10 ô khác xanh |

## 3. Bench OpenPLC — `scripts/scada-r1b-bench.ts`

**Trạng thái: ĐÃ CHẠY 2026-10-25 — 15/15 bước ĐẠT (3 lượt), thanh ghi trả về gốc, container trả về `exited`.**

Điều kiện của điều phối (2026-10-25) và cách đã làm:
1. Trước khi start: `docker update --memory 1g --memory-swap 1g avi-openplc-bench` (trước đó: không giới hạn, `Memory=0`). Giới hạn 1 GiB ĐỂ LẠI trên container. `avi-openplc-bench` chạy với `--memory 1g` (điều phối 2026-10-25: GIỮ — máy dùng chung với llama-server, container từng bị giết vì áp lực bộ nhớ); gỡ bằng `docker update --memory 0 --memory-swap -1 avi-openplc-bench` nếu cần.
2. Commit trống (Win32_OperatingSystem.FreeVirtualMemory) ngay trước start: **18,9 GB** (≥ 10 GB). Sau khi chạy + dừng container: **14,5 GB**. (Lần đo đầu 11,3 GB < ngưỡng 15 GB cũ ⇒ không chạy, báo điều phối; điều phối drop_caches trong docker-desktop + hạ ngưỡng còn 10 GB.)
3. Lệnh: `npx tsx scripts/scada-r1b-bench.ts --lap 3 --start-neu-tat` — start container, bấm Start, bước 0 kiểm 18 thanh ghi giữ giá trị (ghi 12000+i, đọc lại @200/1000/2500 ms ⇒ GIỮ), chạy 3 lượt, trả thanh ghi `holding 0..17` = 0 ⇒ KHỚP gốc, trả container về `exited` (ban đầu `exited`). CSDL = `aoi_management_test`. Không chạm :3000 / :8091 / GPU.

Dùng: dừng (ghim 0) = reg 0 (`holding:1`), chế độ = reg 1 (`holding:2`, poll THẬT của otManager: good = 2 REMOTE), X2 int scale 10 = reg 2 (`holding:3`). Đọc lại bằng client Modbus RIÊNG.

| Lượt | Ô | Bước | Mong đợi | Đo được | ms | Thanh ghi (client riêng) | Kết quả |
|---|---|---|---|---|---|---|---|
| 1 | S1 | STOP HMI, máy REMOTE (chế độ = 2) | acked_verified, thanh ghi dừng = ghim 0 | acked_verified ok=true · 1 adapter · command_log +2 | 158 | 77 → 0 | ĐẠT |
| 1 | S2-ĐC | request dung=50 ở LOCAL (chế độ=1 thấy sau 428 ms) | MODE_LOCAL, thanh ghi không đổi | MODE_LOCAL (khac_remote) | 64 | 77 → 77 | ĐẠT |
| 1 | S2 | STOP HMI, máy LOCAL (chế độ = 1) | acked_verified, thanh ghi dừng = ghim 0 | acked_verified ok=true · 1 adapter · command_log +2 | 156 | 77 → 0 | ĐẠT |
| 1 | X2 | dispatch AI sc10cu=25 (int chưa khai, scale 10) | rejected OFF_STEP goiY 30, thanh ghi không đổi | rejected OFF_STEP goiY=30 · command_log +1 | 30 | 0 → 0 | ĐẠT |
| 1 | X2 | dispatch AI sc10cu=30 | gửi, thanh ghi = số thô 3 | acked ok=true | 114 | 0 → 3 | ĐẠT |
| 2 | S1 | STOP HMI, máy REMOTE | acked_verified, ghim 0 | acked_verified ok=true · command_log +2 | 93 | 77 → 0 | ĐẠT |
| 2 | S2-ĐC | request ở LOCAL (thấy sau 241 ms) | MODE_LOCAL | MODE_LOCAL (khac_remote) | 102 | 77 → 77 | ĐẠT |
| 2 | S2 | STOP HMI, máy LOCAL | acked_verified, ghim 0 | acked_verified ok=true · command_log +2 | 120 | 77 → 0 | ĐẠT |
| 2 | X2 | AI 25 lên int scale 10 | OFF_STEP goiY 30 | rejected OFF_STEP goiY=30 | 21 | 0 → 0 | ĐẠT |
| 2 | X2 | AI 30 | thô 3 | acked ok=true | 108 | 0 → 3 | ĐẠT |
| 3 | S1 | STOP HMI, máy REMOTE | acked_verified, ghim 0 | acked_verified ok=true · command_log +2 | 89 | 77 → 0 | ĐẠT |
| 3 | S2-ĐC | request ở LOCAL (thấy sau 204 ms) | MODE_LOCAL | MODE_LOCAL (khac_remote) | 32 | 77 → 77 | ĐẠT |
| 3 | S2 | STOP HMI, máy LOCAL | acked_verified, ghim 0 | acked_verified ok=true · command_log +2 | 86 | 77 → 0 | ĐẠT |
| 3 | X2 | AI 25 lên int scale 10 | OFF_STEP goiY 30 | rejected OFF_STEP goiY=30 | 49 | 0 → 0 | ĐẠT |
| 3 | X2 | AI 30 | thô 3 | acked ok=true | 172 | 0 → 3 | ĐẠT |

Kết luận bench: STOP HMI dừng được PLC thật ở CẢ REMOTE lẫn LOCAL (giá trị ghim tới thanh ghi, đọc lại độc lập), trong khi lệnh ghi thường ở LOCAL bị từ chối `MODE_LOCAL` và thanh ghi không đổi; OFF_STEP chặn 25 trên tag int scale 10 và 30 ⇒ thô 3 trên PLC thật. Cổng "STOP HMI trên bench" của kế hoạch: **ĐÓNG**.

Lịch sử (giữ nguyên để đối chiếu): lần gọi đầu 2026-10-25 không có `--start-neu-tat` ⇒ "bench not run — container unavailable" (container `exited` mã 137); bằng chứng lần đó ở dưới.


Bằng chứng (đo 2026-10-25, trước khi chạm bất cứ gì):
```
docker ps -a --filter name=avi-openplc-bench   ⇒ avi-openplc-bench Exited (137) 8 hours ago
docker inspect -f "{{.State.Status}}"           ⇒ exited
[bench] container avi-openplc-bench: trạng thái ban đầu=exited; avi-openplc-bench:v3
        sha256:180893084146519c837b7c54bfdf8a1b6b1174ba739390eac9256b0678ebf2df created=2026-10-14T05:51:00.670703593Z
        exit=137 finished=2026-10-24T09:14:54.216341111Z; Docker engine 29.8.2
[bench] bench not run — container unavailable (trạng thái "exited", không --start-neu-tat: container dùng chung, không khởi động)
exit=3
```
Sau lần gọi: container vẫn `exited` (không đổi gì). Theo luật của điều phối (container dùng chung; không chạy ⇒ không khởi động hạ tầng), bench
KHÔNG được chạy. Mã thoát 137 (SIGKILL) ở 09:14Z hôm trước — không rõ ai dừng; không điều tra thêm.

**Script (đã viết, sẵn sàng):** khuôn `scripts/scada-r1a-bench.ts`.
- Mặc định KHÔNG khởi động container: không `running` hoặc Modbus không trả lời ⇒ in "bench not run — container unavailable" + bằng chứng, thoát 3.
- `--start-neu-tat`: hành vi R1a (start / unpause, bấm Start qua web, cuối cùng trả đúng trạng thái ban đầu) — chỉ khi điều phối cho phép.
- Trước khi chạm: đọc và GHI giá trị gốc của MỌI thanh ghi `holding:1..18` (reg 0..17); cuối cùng ghi trả lại và đọc kiểm "KHỚP gốc".
- Bước 0 (giữ giá trị) trên reg 0..17; cần ≥ 3 thanh ghi giữ: dừng (`dung`, int mức 1, dải 0..100, `stop_value` 0), kênh chế độ (REMOTE = 2),
  và một tag int CHƯA khai scale 10 (X2).
- otManager thật (legacy, cờ V2 bật) qua seam `setAdapterSource` + ModbusDriver thật ⇒ kênh chế độ là tag poll trung tâm đọc từ PLC.
- Mỗi lượt (mặc định 3): S1 STOP HMI ở REMOTE (thanh ghi dừng đặt 77 trước, mong 0 sau); đối chứng `request` thường ở LOCAL ⇒ `MODE_LOCAL`, thanh
  ghi không đổi; S2 STOP HMI ở LOCAL (77 → 0); X2 dispatch AI 25 ⇒ `OFF_STEP goiY 30`, thanh ghi không đổi; 30 ⇒ thanh ghi = **3**.
- Oracle độc lập: client Modbus RIÊNG (kết nối mới) đọc thanh ghi trước/sau mỗi bước.
- Safety PLC giả trong tiến trình + hàng `safety_plc_configs` thật; `commissioning_records` thật; `_test` dọn sạch.

**Lệnh khi được phép:** `npx tsx scripts/scada-r1b-bench.ts --lap 3` (container đang chạy) hoặc thêm `--start-neu-tat` (container tắt, có cho phép).

**Chạy khô để kiểm mã script (KHÔNG phải số đo OpenPLC):** `--khong-docker --endpoint tcp://127.0.0.1:15602` trên một máy chủ Modbus giả trong
tiến trình (18 thanh ghi giữ giá trị, script nháp ngoài repo). Mọi đường sản phẩm khác đều thật (otManager, ModbusDriver, dispatch, phân loại STOP
ghim với vân tay của otManager thật). Kết quả 3 lượt: **15/15 bước đạt** — S1 77 → 0 (86–109 ms), S2-ĐC `MODE_LOCAL (khac_remote)` 77 → 77, S2
77 → 0 (80–115 ms), X2 25 ⇒ `OFF_STEP goiY=30` 0 → 0, X2 30 ⇒ 0 → 3; giá trị gốc 18 thanh ghi trả lại "KHỚP gốc"; `_test` sạch tiền tố
`r1bbench`. Phép chạy khô chứng minh script chạy hết đường và đường STOP ghim nhận đúng vân tay của otManager THẬT (`acked_verified`, không bị
hạ về STOP không ghim) — nó KHÔNG thay cho bench trên PLC thật.

## 4. Thứ tự triển khai

1. **Migration 0431, 0432, 0433, 0434 trên MỌI DB, SAU ĐÓ mới chạy bản build.**
   - **0431** (`drizzle/0431_scada_kenh_lenh.sql`): thiếu ⇒ toàn bộ OT hỏng (R1a §4 mục 1). Máy chủ BỎ QUA `startOt`, `/health` `degraded`.
   - **0432** (`drizzle/0432_totp_khoa_sai.sql`): thiếu ⇒ mọi người dùng có 2FA bị khoá ngoài (R1a §4 mục 2).
   - **0433** (`drizzle/0433_scada_ly_do_fk.sql`, `scripts/apply-migration-0433.mjs`, R1b-1 T6): cột `scada_command_attempts.ly_do varchar(300)` +
     3 FK `ON DELETE CASCADE` (`scada_kenh_che_do.machine_id → machines`, `scada_kenh_che_do.adapter_id → device_adapters`,
     `scada_khoa_chon.adapter_id → device_adapters`); trước FK xoá và ĐẾM dòng mồ côi (DEV 0 / TEST 0 khi đếm).
     - Áp TEST ở T6; **DEV 2026-10-24** sau điều phối "ÁP" (`--dev-only`; verify xanh: 13 cột, 3 FK CASCADE, `avi_app` chỉ INSERT trên attempts,
       cascade thử trong giao dịch hoàn tác, sổ migration 1 dòng).
     - Thiếu 0433 với bản build R1b-1: mọi lần ghi attempts (có `ly_do`) lỗi ⇒ `request`/`confirm` HMI fail-closed; `dungMay` (STOP) VẪN gửi vì
       mọi lần ghi attempts của nó bắt lỗi.
     - ⚠ Không chạy lại verify của 0431 trên DB đã có 0433 bằng bản cũ (đếm đúng 12 cột) — bản trên nhánh đã sửa (T6 I2: tập cột bao trùm).
   - **0434** (`drizzle/0434_interlock_bam_dinh_nghia_duyet.sql`, `scripts/apply-migration-0434.mjs`, kiem-dinh I1 a): cột
     `interlock_rules."approvedDefHash" varchar(80) NULL` (bám định nghĩa tag nguồn / đích chụp lúc duyệt), không backfill, không đổi quyền.
     - Áp TEST 2026-10-25 (hai lần — idempotent; verify: cột, quyền `avi_app` SELECT/INSERT/UPDATE + UPDATE cột, giá trị 81 ký tự ⇒ 22001,
       probe hoàn tác, sổ 1 dòng). **DEV CHƯA ÁP** — SQL gửi điều phối duyệt trước.
     - **0434 là ĐIỀU KIỆN CỨNG (kiem-dinh I-C, fix round 2).** Thiếu 0434 với bản build này ⇒ MỌI truy vấn `interlock_rules` của drizzle
       (`select()` có cột mới) lỗi "column does not exist": cổng interlock inline ném TRƯỚC khi lọc luật liên quan ⇒ fail-closed **CHẶN MỌI lệnh ghi
       HITL thật trên MỌI adapter** (HMI, AI, commissioning — không chỉ thiết bị có luật); engine không đánh giá được; trang interlock hỏng. STOP ghim
       vẫn đi (miễn interlock). Máy chủ nay TỰ KIỂM lúc khởi động (`kiemSchemaR1a`, khuôn 0433): thiếu cột ⇒ `/health` `status:"degraded"` +
       `schemaR1a.thieuMigration` có "0434", khối `console.error` gọi tên `scripts/apply-migration-0434.mjs` + script TOFU, nhắc mỗi 5 phút.
     - **THỨ TỰ TRIỂN KHAI (fix round 2, phương án B — TOFU, điều phối 2026-10-25):** (1) áp 0434 → (2) `npx tsx scripts/backfill-approved-def-hash.mjs
       --dev-only` (hoặc đích tương ứng) CHẠY KHÔ, rà bảng (ruleId, tên, trạng thái duyệt, bám) + danh sách KHÔNG đóng dấu → (3) chạy lại với
       `--ghi --actor <id|email>` (MỘT giao dịch; MỘT dòng audit `approve_def_hash_tofu` mỗi luật, lý do "TOFU 0434"; chạy lại ⇒ 0 hàng) → (4) build /
       khởi động lại. Script dùng ĐÚNG hàm bám của ứng dụng (import, không chép), chỉ đóng dấu luật `approvedBy` khác NULL VÀ `approvedDefHash` NULL;
       luật thiếu tag đích / adapter đích / tag nguồn hoặc không đọc được định nghĩa ⇒ KHÔNG đóng dấu, liệt kê riêng, giữ "Cần duyệt lại" (fail-closed)
       — admin duyệt lại các luật đó bằng tay. Đo trên TEST (chạy khô 2026-10-25): 38 ứng viên — 32 đóng dấu được, 6 không (adapter đích vắng, rác lưới).
     - **GIỚI HẠN TOFU:** một thay đổi định nghĩa xảy ra GIỮA lần duyệt gốc và lúc chạy backfill KHÔNG phát hiện được — đó là status quo trước R1b-1
       (khi đó không có bám nào). **Khuyến nghị: admin RÀ LẠI các luật bảo vệ (không-alert, đang bật hoặc đã duyệt) trong TUẦN ĐẦU sau triển khai**
       — xem định nghĩa tag nguồn / đích hiện tại có đúng điều đã duyệt không; nghi ngờ ⇒ sửa / duyệt lại.
     - Không chạy backfill (hoặc luật không đóng dấu được) ⇒ luật đã duyệt trước 0434 có `approvedDefHash` NULL ⇒ **CHƯA DUYỆT LẠI**: không bật được,
       engine không tự chặn, dispatcher từ chối lệnh interlock; cổng inline vẫn chặn theo điều kiện. Đếm TRƯỚC triển khai (chỉ đọc):
       `SELECT count(*) FILTER (WHERE "approvedBy" IS NOT NULL) AS da_duyet, count(*) FILTER (WHERE "approvedBy" IS NOT NULL AND enabled) AS dang_bat FROM interlock_rules;`
       — TEST 2026-10-25: 38 đã duyệt / 20 đang bật (rác lưới). Duyệt lại sau lệch bám không còn bị SoD chặn với người duyệt / bật cũ (fix round 2
       I-B). Với `INTERLOCK_AUTO_BLOCK_ENABLED` bật, tự chặn của luật chưa đóng dấu NGỪNG cho tới khi duyệt lại.
2. **BẮT BUỘC, TRƯỚC bản build, trên MỌI DB (rà soát cuối I-1): truy vấn CHỈ ĐỌC luật interlock lệch lưới thô.** T13 làm `dispatch()` từ chối
   `OFF_STEP` một giá trị lệch lưới thô trên tag int chưa khai có `scale ≠ 1` / `offset ≠ 0` (trước đó driver làm tròn im lặng: scale 10, lệnh 25 ⇒
   thô 3 = 30). Kiểm lúc cấu hình của T13 chỉ chạy khi create / update / approve / enable ⇒ một luật **đã bật** từ trước với `commandValue` lệch
   lưới sẽ bị từ chối **đúng lúc hành động bảo vệ cần chạy**. Chỉ DEV / TEST đã đo (0 luật). Chạy trên từng DB đích, trong phiên
   `SET default_transaction_read_only = on`:

   ```sql
   -- R1b-1 §4 mục 2 — luật interlock ĐANG BẬT có lệnh bảo vệ lệch lưới thô (CHỈ ĐỌC). ≥ 1 hàng ⇒ DỪNG triển khai.
   WITH ung_vien AS (
     SELECT r.id, r.name, r."commandValue" AS cv, r."targetAdapterId", t."tagKey",
            COALESCE(NULLIF(t.scale, 0), 1)::numeric AS s, COALESCE(t."offset", 0)::numeric AS o
     FROM interlock_rules r
     JOIN device_tags t ON t."adapterId" = r."targetAdapterId" AND t."tagKey" = r."commandTag"
     WHERE r.enabled AND r.action::text <> 'alert' AND t."dataType"::text = 'int'
   ), gia_tri AS (
     SELECT u.*,
       CASE
         WHEN u.cv IS NULL OR jsonb_typeof(u.cv) = 'null' THEN 1::numeric
         WHEN jsonb_typeof(u.cv) = 'number' THEN (u.cv #>> '{}')::numeric
         WHEN jsonb_typeof(u.cv) = 'boolean' THEN CASE WHEN (u.cv #>> '{}')::boolean THEN 1::numeric ELSE 0::numeric END
         WHEN jsonb_typeof(u.cv) = 'string' AND char_length(btrim(u.cv #>> '{}')) <= 100
           AND btrim(u.cv #>> '{}') ~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]{1,4})?$'
           THEN btrim(u.cv #>> '{}')::numeric
         ELSE NULL
       END AS v
     FROM ung_vien u
   ), tho AS (
     SELECT g.*, round(g.v - g.o, 30) / g.s AS n
     FROM gia_tri g
   )
   SELECT id, name, "targetAdapterId", "tagKey", cv AS "commandValue", s AS scale, o AS "offset", v AS gia_tri_gui,
          CASE WHEN v IS NULL OR abs(n) >= 4503599627370496 THEN NULL ELSE o + floor(n + 0.5) * s END AS diem_luoi_gan_nhat,
          CASE WHEN v IS NULL THEN 'KHONG_PARSE_DUOC' WHEN abs(n) >= 4503599627370496 THEN 'VUOT_MIEN_AN_TOAN' ELSE 'LECH_LUOI' END AS ket_luan
   FROM tho
   WHERE v IS NULL OR abs(n) >= 4503599627370496 OR abs(n - round(n)) > 1e-9
   ORDER BY id
   ```

   - **R1b-2a T1 (2026-10-25) — khối SQL trên đã được THAY bằng bản đi theo luật mới của `dispatch()`** (Q-T13 b, kiem-dinh M1 / M2): ứng viên là
     MỌI luật bật, không `alert`, nhắm tag int (kể cả scale 1 / offset 0 — 2.5 trên tag scale 1 nay là `LECH_LUOI`); phép so ở không gian thô
     (`n = round(v − o, 30) / s`, lệch ⇔ `|n − round(n)| > 1e-9`); `|n| ≥ 2^52` ⇒ hàng `VUOT_MIEN_AN_TOAN` (biên dư: JS từ chối từ 2^53 tính
     bằng double — n numeric = 2^53 − 1 có thể bị JS làm tròn lên 2^53); chuỗi rỗng / chỉ khoảng trắng, chuỗi dài > 100 ký tự hoặc số mũ > 4
     chữ số nay là `KHONG_PARSE_DUOC` (trước: rỗng đọc là 0; "1e200000" làm tràn `::numeric` và hỏng cả câu); `diem_luoi_gan_nhat` làm tròn
     hoà .5 về phía +∞ (`floor(n + 0.5)`, như goiY của JS). Mọi hàng, mọi `ket_luan`, đều CHẶN. **Phạm vi (phán quyết K2):** câu này chỉ phủ lưới thô + giá trị không
     parse được. Với tag int CHƯA khai, mọi luật hàm JS từ chối đều có hàng (chỉ báo DƯ); với tag ĐÃ khai, dải / bước / kiểu / loại kênh được cưỡng
     chế lúc cấu hình (`nhatQuanKenh`) và đếm ở posture, câu này không lặp lại chúng. Cột ra không đổi. Các đoạn mô tả bên dưới là của bản R1b-1;
     chỗ nào khác với ghi chú này thì ghi chú này đúng.

   - **Kết quả ≠ 0 hàng ⇒ CHẶN triển khai** — MỌI hàng đều chặn, cả `ket_luan = 'LECH_LUOI'` lẫn `ket_luan = 'KHONG_PARSE_DUOC'`:
     - `LECH_LUOI`: sửa `commandValue` về một điểm lưới (`diem_luoi_gan_nhat` là ĐÚNG giá trị driver cũ đã ghi) qua `interlockRouter.update`
       rồi duyệt + bật lại (luồng MOC), hoặc tắt luật có chủ đích;
     - `KHONG_PARSE_DUOC` (kiem-dinh N-1): `commandValue` không phải số / boolean / null / chuỗi số thập phân sạch — chuỗi hex / `0b` / `0o`,
       chuỗi có TAB / xuống dòng / NBSP, chuỗi chữ, mảng, đối tượng. SQL KHÔNG đoán giá trị (JS đọc được một số trong đó: `"0x19"` = 25,
       `"\t25"` = 25, `[25]` = 25 ⇒ dispatch từ chối). Người triển khai xem tay từng hàng và đổi `commandValue` thành một SỐ đúng lưới (MOC như trên)
       hoặc tắt luật.
     Chạy lại tới khi 0 hàng.
   - Giá trị gửi tính như engine + driver: `commandValue` NULL ⇒ `true` ⇒ 1; boolean ⇒ 1 / 0; chuỗi số thập phân sạch (cắt dấu cách đầu/cuối) ⇒
     số; mọi giá trị khác ⇒ hàng `KHONG_PARSE_DUOC`. Chuỗi SQL này là bản NGUYÊN VĂN của hằng `TRUY_VAN_TRUOC_TRIEN_KHAI`
     (`server/services/scada/lenhInterlockLechLuoi.ts`; test `lenhInterlockLechLuoi.baoCao.test.ts` so khối SQL của báo cáo với hằng, từng ký tự);
     lưới `interlockRouter.r1b.db.test.ts` §5 chạy chính chuỗi ấy trên `_test` và so với hàm JS dùng chung của cổng dispatch (25 / NULL / "25" /
     " 25 " ⇒ `LECH_LUOI`; `"0x19"` / `"\t25"` / NBSP / `[25]` / đối tượng ⇒ `KHONG_PARSE_DUOC`; 30 / tắt / alert / scale 1 ⇒ không có hàng; mọi luật
     JS đếm đều có hàng). Khác bản JS CHỈ theo chiều báo DƯ: `|v/s| ≥ 2^53`, và hàng `KHONG_PARSE_DUOC` cho giá trị JS bỏ qua (đối tượng) hoặc
     đọc ra số đúng lưới (NBSP + 30). Trước kiem-dinh N-1 SQL BỎ SÓT các chuỗi hex / TAB / NBSP — đã sửa.
   - Đo lại với bản SQL mới (kiem-dinh N-1, 2026-10-25) trên `aoi_management_test` (giao dịch `READ ONLY`): 323 tag, 0 tag int có scale /
     offset khác mặc định, ứng viên 0, **0 hàng** (không `LECH_LUOI`, không `KHONG_PARSE_DUOC`). DEV không chạy ở vòng sửa này (luật cứng).
   - Đo 2026-10-25 trên `aoi_management_test` (chỉ đọc, `default_transaction_read_only = on`): ứng viên 0, lệch lưới **0 hàng**. DEV KHÔNG chạy
     ở rà soát này (luật cứng); T13 đã đo DEV chỉ đọc: 0 luật nhắm tag int có scale (§6 mục 30) — vẫn phải chạy lại câu trên ngay trước khi triển khai.
   - Sau khi chạy bản build, cùng điều kiện được **đếm vào posture** `interlockRulesCauHinhHong` (`oversightRouter.fetchInterlockCauHinhHong`,
     phán bằng CHÍNH hàm cổng dispatch dùng — tập posture ⊇ tập câu trên: tag đã khai còn được kiểm dải / bước / kiểu) và một **khối
     `console.error` lúc khởi động** liệt kê id / tên / mã (`canhBaoLuatLenhLechLuoiKhiKhoiDong`, chỉ log, không chặn khởi động).
2b. **BẮT BUỘC, TRƯỚC bản build, trên PRODUCTION (kiem-dinh I4): census OFF_STEP của T13 (task-13-report §1.3).** Hành vi mới của T13: MỌI
   người gọi (HMI, AI, interlock, FOE, REST) bị `OFF_STEP` trên tag int CHƯA khai có `scale ≠ 1` hoặc `offset ≠ 0` — ví dụ lệnh bool
   start / stop / reset ghi vào tag int scale 10 từng bị driver làm tròn im lặng, nay bị TỪ CHỐI. Mục 2 chỉ bắt luật interlock; câu dưới bắt cả
   TAG (mọi người gọi). Chạy chỉ đọc trên từng DB đích (nguyên văn task-13-report §1.3):

   ```sql
   -- tag int có lưới thô khác số nguyên
   SELECT t.id, t."adapterId", t."tagKey", t.scale, t."offset", t.writable, t.stop_value,
          (t.channel_kind IS NOT NULL OR t.write_min IS NOT NULL OR t.write_max IS NOT NULL OR t.write_step IS NOT NULL) AS da_khai
   FROM device_tags t
   WHERE t."dataType" = 'int' AND (COALESCE(NULLIF(t.scale, 0), 1) <> 1 OR COALESCE(t."offset", 0) <> 0);
   -- luật interlock nhắm các tag đó: so commandValue (null ⇒ true ⇒ 1) với lưới offset + k·scale
   SELECT r.id, r.name, r.enabled, r."commandValue", t.scale, t."offset"
   FROM interlock_rules r JOIN device_tags t ON t."adapterId" = r."targetAdapterId" AND t."tagKey" = r."commandTag"
   WHERE r.action::text <> 'alert' AND t."dataType" = 'int' AND (COALESCE(NULLIF(t.scale, 0), 1) <> 1 OR COALESCE(t."offset", 0) <> 0);
   ```

   - Số đo đã có: DEV `device_tags` 42 hàng, TEST 323 hàng — **0 tag thuộc diện** ở cả hai (kiem-dinh đo; TEST đo lại 2026-10-25 trong giao dịch
     READ ONLY: 323 tag, 0 tag int scale / offset khác mặc định). **PRODUCTION CHƯA ĐO.**
   - Có hàng ⇒ trước bản build: với từng tag, xác định ai ghi vào nó (HMI / AI / interlock / tích hợp) và giá trị họ gửi; giá trị lệch lưới sẽ bị
     từ chối sau triển khai ⇒ sửa bên gọi gửi điểm lưới, hoặc khai mô hình ghi cho tag (M12), hoặc chấp nhận có văn bản. Edge
     (`otEdgeDispatch`) không đi qua cổng này (tài liệu R1c).
2c. **BẮT BUỘC, TRƯỚC bản build, trên MỌI DB (kiem-dinh I-A, fix round 2): rà ghim DỪNG CŨ trên tag mức ≥ 2 hoặc chưa khai mức.** Trước H1 a,
   một người chỉ có `machine_control.canEdit` (operator) đặt được ghim trên BẤT KỲ tag ghi được. Sau bản build: STOP HMI và AI `machine_stop` BỎ QUA
   các ghim đó (cùng luật mức ≤ 1), nhưng các STOP do hệ thống khởi phát (chuyển chủ thiết bị, nhả edge) vẫn ghi MỌI ghim (§6 mục 2). Liệt kê (chỉ
   đọc) rồi kỹ sư XÁC NHẬN LẠI (khai mức 1 nếu tag thật sự là tag dừng — M12, có TOTP) hoặc GỠ từng ghim (`setStopPin` null — kỹ sư + TOTP):

   ```sql
   -- R1b-1 §4 mục 2c — ghim DỪNG trên tag mức >= 2 hoặc chưa khai mức (đặt trước bản sửa H1 a): rà + xác nhận lại / gỡ.
   SELECT t.id, t."adapterId", a.code AS adapter, a."machineId", t."tagKey", t."dataType", t.actuation_level, t.stop_value,
          t.stop_pinned_by, u.role AS vai_nguoi_ghim, t.stop_pinned_at, t.writable, t."isEnabled"
   FROM device_tags t
   JOIN device_adapters a ON a.id = t."adapterId"
   LEFT JOIN users u ON u.id::text = t.stop_pinned_by
   WHERE t.stop_value IS NOT NULL AND (t.actuation_level IS NULL OR t.actuation_level >= 2)
   ORDER BY a."machineId", t."adapterId", t."tagKey";
   ```

   Ưu tiên rà hàng có `vai_nguoi_ghim` = `operator` (hoặc NULL — người ghim không còn / ghim bằng CLI cũ). Đo TEST 2026-10-25 (giao dịch READ
   ONLY): 66 hàng (rác lưới; chủ yếu `stop_cmd` bool chưa khai mức). DEV / PRODUCTION chưa đo.
3. **Kiểm lại hôm nay (2026-10-25, CHỈ ĐỌC, `default_transaction_read_only = on`):** cả `aoi_management` (DEV) lẫn `aoi_management_test`: 4 bảng
   (`scada_command_attempts`, `scada_kenh_che_do`, `scada_khoa_chon`, `totp_khoa_sai`), 7/7 cột 0431 trên `device_tags`, `ly_do` có mặt
   (attempts 13 cột), 3 FK `ON DELETE CASCADE` đúng như trên.
4. **Máy chủ tự kiểm lúc khởi động (`server/_core/kiemSchemaR1a.ts`), TRƯỚC `startOt()`:**
   - `/health` khoá `schemaR1a` có MỘT hình dạng (rà soát cuối M-7): VẮNG = đủ; CÓ MẶT ⇒ luôn `{ ok: false, trangThai, thieuMigration, lyDo }`;
   - thiếu 0431 ⇒ bỏ `startOt`, `/health` `status:"degraded"` + `schemaR1a {trangThai:"thieu", thieuMigration:["0431", …]}`;
   - thiếu 0432 ⇒ OT vẫn chạy, nhắc mỗi 5 phút, `/health` `degraded`;
   - **thiếu 0433 ⇒ `/health` `degraded`** (`schemaR1a.thieuMigration` có "0433", khối `console.error` gọi tên `scripts/apply-migration-0433.mjs`,
     nhắc mỗi 5 phút); `startOt` VẪN chạy (OT không đọc `ly_do`) — T7;
   - **không đọc được `information_schema`** ⇒ `/health` hiện `schemaR1a {trangThai:"chua_kiem_duoc", thieuMigration:null, lyDo:<lớp lỗi ngắn>}`
     (`ket_noi_tu_choi` / `het_thoi_gian` / `quyen` / `khong_co_ket_noi_db` / `khac`, không lộ host/port/user), `status` vẫn `"ok"`, kiểm lại mỗi
     5 phút tới khi kiểm được; khởi động fail-open như cũ — T10a. Bộ giám sát: coi CÓ MẶT `schemaR1a` (hay `schemaR1a.ok === false`) là chưa khoẻ.
   - `/health` vẫn trả 200 (liveness). ⚠ `/api/health` không phải route — kiểm `/health`.
5. Sau khi khởi động: `GET /health` không được có `schemaR1a`; log khởi động không có khối "LUẬT INTERLOCK ĐANG BẬT có lệnh bảo vệ mà dispatch()
   sẽ TỪ CHỐI" (mục 2).
6. **2FA cho kỹ sư bảo trì thiết bị (T9, rà soát cuối M-3) — làm TRƯỚC khi triển khai, không phụ thuộc cờ nào.** Mọi thay đổi chạm một tag
   ĐƯỢC BẢO VỆ (đã khai mức / loại kênh / dải, là kênh chế độ, hoặc là đích / nguồn telemetry của luật interlock không-alert đang bật HOẶC đã
   duyệt) hay một khoá mồ côi đòi TOTP tươi mức 5 (`kiemTotpCauHinh`: vai ACTUATION + **đã đăng ký 2FA** + mã mỗi lượt): `deviceAdapter.tags.create /
   update / delete`, `deviceAdapter.update` (đổi đích / tắt / đổi máy), `deviceAdapter.delete`, `scadaDiag.tamTat`, `mappingAsCode.applyImport`,
   M12 `scadaKenh.capNhat / cheDo.*`; kiem-dinh R1b-1 thêm: **`deviceAdapter.tags.setStopPin`** (MỌI lượt đặt / gỡ ghim DỪNG, sàn vai
   admin / supervisor / engineer — H1 a) và **`interlock.update` / `interlock.delete`** của luật ghi lệnh đang bật hoặc đã duyệt có đích / nguồn
   tag (I1 b). Kỹ sư chưa đăng ký 2FA nhận `SCADA_CONFIG_TOTP_NOT_ENROLLED` dù MỌI cờ SCADA tắt (2FA không phải tiên quyết
   của dự án ⇒ đây là thay đổi hành vi thấy được). Việc phải làm: mọi người sửa tag đã khai / kênh chế độ / đích luật interlock **đăng ký 2FA**;
   đếm trước trên từng DB số tag được bảo vệ, ví dụ (chỉ đọc):
   `SELECT count(*) FROM device_tags t WHERE t.actuation_level IS NOT NULL OR t.channel_kind IS NOT NULL OR t.write_min IS NOT NULL OR
   t.write_max IS NOT NULL OR t.write_step IS NOT NULL OR EXISTS (SELECT 1 FROM scada_kenh_che_do k WHERE k.adapter_id = t."adapterId" AND
   k.tag_key = t."tagKey") OR EXISTS (SELECT 1 FROM interlock_rules r WHERE r.action::text <> 'alert' AND (r.enabled OR r."approvedBy" IS NOT NULL)
   AND r."targetAdapterId" = t."adapterId" AND r."commandTag" = t."tagKey")` (đếm thô; nguồn telemetry của luật xem `troLaiKenh.duocBaoVe`).
   ⚠ `DeviceOnboardingWizard` không có ô nhập TOTP ⇒ tạo tag lên khoá mồ côi qua wizard nhận `SCADA_CONFIG_TOTP_REQUIRED` không sửa được tại chỗ —
   dùng trang Device Adapter (R1b-2, §10).

## 5. Chạy toàn bộ (Step 5)

**Cách chạy:** `node scripts/luoi-truoc-gop.mjs --nang server shared client/src scripts vscode-extension/src` (= mọi `include` của
`vitest.config.ts`) trên gốc `39ce0b0cf`: lô thường song song (loại `*.db.test.ts`, 10 fork) → lô DB tuần tự (`vitest.db.config.ts`) → lô nặng tuần tự
→ chạy LẠI RIÊNG từng tệp đỏ để tách đỏ thật / đỏ do tải. Sau đó, riêng: lô serial (`vitest.serial.config.ts`), mọi census, ba lưới nghiệm thu opt-in,
`npm run check`, `npm run i18n:check`. Không chạy song song hai lô nặng (tránh cạn bộ nhớ ảo / kết nối PG).

| Lô | Tệp | Ca | Qua | Đỏ | Bỏ qua |
|---|---|---|---|---|---|
| Thường (song song) | 2086 | 30 410 | 30 356 | 23 (13 tệp) | 31 |
| DB (tuần tự) | 263 | 2 989 | 2 944 | 3 (1 tệp) | 42 |
| Nặng (tuần tự) | 3 | 82 | 82 | 0 | 0 |
| **Tổng lưới** | **2352** | **33 481** | **33 382** | **26 (14 tệp)** | **73** |
| Serial (`vitest.serial.config.ts`, E2E edge) | 7 | 66 | 66 | 0 | 0 |
| **Census** (mọi tệp `*census*` `.test.ts(x)` trong git) | 57 | 963 | 960 | **0** | 3 |
| **Opt-in** R0 + R1a + R1b-1 (`SCADA_R0/R1A/R1B_NGHIEM_THU=1`, một lượt chung) | 3 | 42 | 42 | **0** | 0 |

R0 trong lượt chung (ms, ngưỡng G1/G4 ≤ 2000, G2/G3 ≤ 5000): legacy/từ chối 400 / 475 / 436·2038 / 1262; HA/từ chối 907 / 960 / 994·1946 / 278;
legacy/treo 1894 / 2846 / 2856·2059 / 139; HA/treo 1852 / 2826 / 2826·2089 / 136 — đều đạt.

**`npm run check`** (tsc, 8 GB): rc 0. Hai tệp mới (bị `tsconfig` loại: `*.test.ts`, `scripts/`) kiểm riêng bằng tsconfig tạm ngoài repo: **0 lỗi** ở hai
tệp; 5 lỗi ở `server/services/twin/pipeline/stepToGltf.ts` chỉ do tsconfig tạm thiếu khai báo kiểu cục bộ của repo (không có trong `npm run check`).
**`npm run i18n:check`**: sạch (0 lệch placeholder, 0 khoá mới thiếu; 332 + 20 nợ đóng băng có từ trước).

**Phân loại 14 tệp đỏ** (so với main bằng đọc mã — không checkout main; gốc gộp main gần nhất `58ee02c5e`):

| Tệp | Chạy riêng | Phân loại | Bằng chứng |
|---|---|---|---|
| `server/services/vram/vramAllocationSites.test.ts` (2 ca) | xanh sau sửa | **DO NHÁNH (T12) + có sẵn trên main — ĐÃ SỬA** | Chưa khai: `scripts/scada-r1b-bench.ts` (execFileSync ×4 + child_process, mới ở T12) VÀ `scripts/scada-r1a-bench.ts` (×4 + 1; R1a đã gộp main mà chưa khai — `git show main:…vramAllocationSites.ts` không có dòng nào). Đã khai 10 dòng (docker CPU, chạy tay, không GPU), `KNOWN_ALLOCATION_SITE_ROW_COUNT` 291 → 301; tệp 12/12 xanh |
| `server/routers/appErrorCoverage.test.ts` (2) | đỏ | có sẵn trên main | `throw new Error` ở `server/routers/_adapterPhamVi.ts:171` — tệp của luong-ui (main `7388c6bcd`), giống hệt trên main; nhánh không sửa tệp |
| `server/routers/appErrorParamsCoverage.test.ts` (1) | đỏ | có sẵn trên main | `genealogyRouter.ts` `action="verifyChainAcrossFactories"` thiếu khoá `errors.action.*` ở vi/en/zh; main có cùng dòng (`dbe57b130`) và locale main cũng thiếu khoá; nhánh không đụng `genealogyRouter` |
| `server/services/ai/thinkingSurfaces.quantifier.test.ts` (1) | đỏ | có sẵn trên main | điểm gọi `server/routes/aiLocalKnowledgeApi.ts::docBangModelChinh::chatCompletion` chưa phân loại — tệp có trên main y hệt, nhánh không đụng |
| `server/auth.setupAdmin.test.ts` (3) | đỏ | có sẵn (trạng thái `_test`) | "Admin already exists" — `_test` dùng chung đã có admin; nhánh không đụng auth setup |
| `server/crud-operations.test.ts` (suite) | đỏ | có sẵn (quyền DB) | `permission denied for table product_inspections` (vai `avi_app`); nhánh không đụng |
| `server/machineTypeEnum.f2.test.ts` (1) | đỏ | có sẵn trên main | test ghim 21 giá trị, enum có 24; test và enum không nằm trong diff của nhánh |
| `server/mqtt.test.ts` (2) | đỏ | có sẵn trên main | `Required role: admin or supervisor or quality_inspector`; nhánh không đụng |
| `server/componentInstallationService.g2_4.test.ts` (2), `server/processResultService.f2.test.ts` (1) | đỏ | có sẵn trên main | spy chuỗi genealogy 0 lần; main `013612d7f` (nhánh khác) đã sửa đúng ca `processResultService.f2` (mock `appendGenealogyChainRow`) — chưa gộp vào nhánh này |
| `server/routers/machineConfigSync.test.ts` (2) | đỏ | có sẵn trên main | mock `../_core/accessControl` thiếu `resolveDataScope` (export mới từ các lô phạm vi của main); nhánh không đụng |
| `server/services/ai/doiModelLlamaServer.test.ts` (5) | đỏ | có sẵn (môi trường) | chạy THẬT `start-llama-server.ps1`, nhận chuỗi rỗng; vùng AI, nhánh không đụng |
| `server/services/cpkSnapshotScheduler.test.ts` (1) | xanh | đỏ do tải | quá hạn 180 s chỉ trong lô song song |
| `server/services/flow/ot/otMoPhong.db.test.ts` (3) | xanh | đỏ do trạng thái `_test` dùng chung | "đang có 100 lượt chạy (trần maxConcurrentRuns=100)"; chạy riêng xanh |

**Kết luận:** 0 tệp đỏ do mã R1b-1. Một census đỏ do tệp của chính T12 (bench mới chưa khai trong bản liệt kê VRAM) — đã sửa trong commit báo cáo,
kèm khai muộn bench R1a (đỏ có sẵn trên main). Mọi đỏ còn lại không nằm trong 125 tệp nhánh đổi so với `58ee02c5e` và có cùng nguyên nhân trên main.

## 6. Giới hạn đã biết

### LOGIC

**STOP HMI (T2)**
1. `dungMay` tuân cờ chủ `SCADA_COMMANDS_ENABLED` (ruling T2): cờ tắt ⇒ không có STOP HMI, người vận hành dùng E-STOP cứng.
2. STOP HMI chỉ gửi giá trị ĐÃ GHIM (`device_tags.stop_value`) tới adapter BẬT của máy; không tự đoán tag. Máy chưa ghim ⇒ `CHUA_GHIM_STOP`.
   kiem-dinh H1 b: CHỈ ghim của tag `actuationLevel ≤ 1`; tag mức 3 / 4 / 5 và tag CHƯA KHAI mức (NULL ⇒ 5) bị BỎ QUA từng tag (kết quả `boQua`,
   audit `ghimBoQua`, M4 / M10 / M12 "không tới bằng STOP HMI"); có ghim mà mọi ghim mức cao ⇒ `GHIM_MUC_CAO`. ⇒ Sau triển khai, máy có ghim trên
   tag chưa khai mức sẽ KHÔNG còn nhận STOP HMI cho tới khi khai mức 1 (§7). **Fix round 2 (kiem-dinh I-A) — sửa câu SAI cũ** ("AI từ chối mức ≥ 4"
   KHÔNG đúng với lệnh dừng ghim: cổng AI cố ý dùng mức TOOL cho dừng ghim, không lấy mức kênh). Nay CÙNG MỘT luật (`phanLoaiGhimStopHmi`) cho STOP
   HMI, khảo sát khả năng dừng VÀ đường dừng AI: tool `machine_stop` chỉ gửi ghim đủ điều kiện (bỏ qua + báo các ghim khác; không ghim nào đủ ⇒ từ
   chối), và `mucKenhChoAi` chỉ coi là "dừng ghim" khi mọi write khớp ghim ĐỦ ĐIỀU KIỆN — ghim trên tag mức > 1 / chưa khai ⇒ mức kênh (5 ⇒ AI
   từ chối). Đường miễn STOP-ghim trong `dispatch()` (5a-stop, chỉ lệnh loại `stop` / `e_stop`) vẫn xét MỌI ghim. Bên gọi lệnh loại dừng còn gửi
   MỌI ghim (kể cả tag mức cao): các STOP DO HỆ THỐNG khởi phát — STOP khi chuyển chủ thiết bị (`deviceOwnershipService`, owner-transfer), STOP
   nhả của edge (`edgeGatewayRuntime`, `edgeExecutionAgent`); không người dùng nào chọn giá trị ở đó, nhưng một ghim CŨ sai vẫn sẽ được ghi — lý do
   §4 mục 2c bắt buộc rà và gỡ ghim cũ trên tag mức > 1 / chưa khai (backlog R1b-2a §10 mục 22: lọc cùng luật ở các đường đó). HMI `write_tag` không
   phải lệnh loại dừng; REST v1 OT 501.
3. Ghim lệch lưới thô (ví dụ `stop_value` 25 trên tag int chưa khai scale 10) vẫn được gửi (miễn cả lệnh) và driver làm tròn ⇒ phát hiện CẤU HÌNH,
   không phải từ chối (T13). `datStopPin` chưa từ chối ghim lệch lưới trên tag chưa khai có scale (R1b-2).
4. Một authenticated `canEdit` có thể spam STOP (miễn `apiLimiter` cho POST `dungMay` KHÔNG batch, ruling T2 I1) — hướng an toàn; dòng
   `dispatched` không bị điều tiết. Batch có `dungMay` vẫn bị đếm.
5. Hai STOP ghim giống hệt khi `OT_CMD_SERIALIZE_ENABLED` bật dùng chung một lần ghi thiết bị (R-11-o có sẵn); lần bấm thứ hai có thể báo kết
   quả dùng chung. Lưới chạy với cờ tắt.
6. Audit `scada_hmi_stop` fire-and-forget có hạn 10 s: sổ hỏng/treo không che kết quả STOP, nhưng có thể thiếu dòng audit (chỉ log).
7. Máy edge: kết quả `ok:false` + `edgeStopRequest` (trung tâm không tự chạy); node không tới được ⇒ STOP dự phòng trung tâm trên phiên tạm +
   cảnh báo `stop_undelivered`.

**Kết nối / ingest (T3, T4)**
8. Cờ V2 bật: ghi qua dispatcher KHÔNG bị chặn trong lúc phiên chờ lần đọc tốt đầu tiên (ruling T3 c2; dispatcher có cổng driver/ADAPTER_OFFLINE riêng).
9. Presence (và log supervisor HA `state=connected`) vẫn theo TCP: máy có thể "online" trong khi adapter `connecting`/`lost` (đo lại ở C1 HA).
10. Cờ V2 TẮT: TCP lên + mọi đọc quá hạn ⇒ `connected` mãi, phiên không bao giờ bị hạ (đo ở đối chứng C1: 1 kết nối, 18 lần báo `connected`
    trong 9 s). Đây là hành vi cờ tắt có chủ ý — xem checklist §7.
11. Reset phiên legacy khi cờ V2 bật hiện `connected → connecting → connected` trong khoảng một lần đọc.
12. Đường push (OPC UA monitored items) đếm "đọc tốt" chỉ khi quality `good`; poll đếm mọi tick `ok` (kể cả uncertain / lỗi cấu hình) — lệch
    nhẹ (R1b-2). Push không có watchdog thừa mẫu (có từ trước).
13. DB treo: back-pressure bỏ qua `ingestSample` ⇒ bộ đệm hiện tại cũ cho mọi tag (fail-closed: interlock chặn, máy LOCAL); lô mẫu xấu bị bỏ không
    thử lại (bộ đệm hiện `stale` thay vì `bad`). Cờ V2 tắt: một lần đọc khoẻ nhưng chậm vắt qua một tick nay hạ phiên (ruling T4 c2).

**Chế độ máy (T10b N5)**
14. Cổng chế độ tin mẫu kênh chế độ tối đa **min(3·poll, 30 s)**: poll ≥ 10 s, hoặc kênh chế độ có deadband (nhịp tim 60 s), ⇒ máy LOCAL `cu`
    giữa hai mẫu (fail-closed; đo ở X3). M12 cảnh báo `poll_cham` (> 10 s) và `deadband`.

**Cấu hình được bảo vệ (T9, T10b)**
15. "Tag được bảo vệ" = đã khai (mức | loại kênh | dải) HOẶC kênh chế độ HOẶC đích / nguồn telemetry của luật interlock (không alert) đang BẬT
    hoặc ĐÃ DUYỆT. Trỏ lại / xoá / tắt / tạo lên khoá mồ côi ⇒ TOTP tươi + kiểm nhất quán; ghim DỪNG đang có ⇒ "gỡ ghim trước"
    (`STOP_PIN_GO_TRUOC`) kể cả có mã. Đổi IP PLC có tag đã khai đang ghim ⇒ gỡ ghim + ghim lại (ruling T9 r2; hiếm, có chủ ý).
16. `tags.create/update/delete`, `deviceAdapter.update` miễn nhóm giới hạn "2fa" (ruling T9 a/r2, lý do NAT nhà máy; khoá TOTP theo tài khoản
    T16 chặn dò mã). Mỗi lần lưu thay đổi được bảo vệ cần một mã MỚI.
17. ~~CLI `scripts/mappings-import.mjs` vẫn trỏ lại tag được bảo vệ không TOTP~~ — kiem-dinh I2: `--apply` TỪ CHỐI lô đụng tag được bảo vệ (cùng
    định nghĩa T9, truy vấn `scripts/lib/tagBaoVeCli.mjs` so với hàm TS); ngoại lệ tường minh `--cho-phep-tag-bao-ve` cho người có quyền host +
    DB (ghi vào metadata audit). Người có quyền DB vẫn ghi thẳng bảng được — bám định nghĩa lúc duyệt (I1 a) làm duyệt cũ hết hiệu lực.
18. `interlock.approve` không chạy kiểm tồn tại đích/nguồn (chỉ `enable`); luật đã duyệt mà đích chết vô hại khi còn tắt. Nhãn nút hộp mã đổi
    "Xác nhận và lưu" → "Xác nhận" (chấp nhận, T10b).
18a. **Bám định nghĩa lúc duyệt (kiem-dinh I1 a / I3):** phủ address, dataType, scale / offset (chuẩn hoá như đường đọc), adapterId và
    `edgeNodeId` của adapter cho tag ĐÍCH và mọi tag NGUỒN telemetry của máy. KHÔNG phủ endpoint / protocol / connectionOptions / máy của adapter
    (đổi đích kiểu này của adapter có tag được bảo vệ đã cần TOTP ở `congAdapterTx`, nhưng KHÔNG bỏ duyệt luật) — ứng viên R1b-2a. Bám chỉ áp ở
    `enable`, engine (tự chặn) và dispatcher (xác minh lệnh interlock); CỐ Ý KHÔNG áp ở cổng inline `interlockGate` (luật bật vẫn CHẶN) và
    `troLaiKenh.luatBaoVe` (luật đã duyệt, dù lệch bám, vẫn bảo vệ tag) — ở hai chỗ đó "coi là chưa duyệt" là nới an toàn (fail-open).
    `oversight` (đếm chờ duyệt, posture) vẫn theo `approvedBy` thô: luật "cần duyệt lại" không vào hàng chờ duyệt của EngineeringHub (R1b-2a).
    UI duyệt chưa hiện bản thân định nghĩa tag (chỉ huy hiệu "Cần duyệt lại" + token CONFLICT khi định nghĩa đổi giữa lúc xem và lúc bấm).
18b. `setStopPin` (H1 a) miễn nhóm giới hạn "2fa" (khuôn tags.*: khoá TOTP theo tài khoản T16); mỗi lượt đặt / gỡ một mã mới. `interlock.update /
    delete` chỉ đòi mã với luật ghi lệnh đang bật / đã duyệt có đích hoặc nguồn tag; luật nháp / alert không đòi.

**Giá trị lệnh (T13)**
19. Tag int CHƯA khai với scale = 1 / offset = 0 vẫn làm tròn giá trị không nguyên (điều phối Q-T13 (a), R1b-1); R1b-2 (b): `OFF_STEP` cho MỌI tag
    int + bộ đề xuất SPI làm tròn theo lưới tag, cùng một task.
20. HMI từ chối 2,5 trên tag int scale 0,5 là `TYPE_MISMATCH` trong khi dispatch nhận (có từ trước; R1b-2).
21. Đường FOE thật tới số thô chỉ đo tới cổng (cần cả chuỗi duyệt; R1b-2).

**Nhật ký WORM (T7)**
22. Bộ điều tiết RAM theo tiến trình: nhiều tiến trình ⇒ trần thực tế 30 × số tiến trình; tổng kết `DIEU_TIET` chỉ ghi khi chính khoá (người, mã)
    được gọi lại — người ngừng hẳn / khởi động lại ⇒ số bị gộp có thể không bao giờ được tổng kết.
23. Dòng `rejected` ở `request` mang lý do NGƯỜI DÙNG; câu từ chối hệ thống nằm ở `reason_code`. STOP không bao giờ bị từ chối vì chữ lý do
    (NUL / > 2000 ký tự ⇒ lọc + cắt 300).

**Mã dự phòng (T8)**
24. ≥ 10 lượt song song cùng một mã qua đường đầy đủ: không tiêu hai lần, nhưng người thắng có thể bị `MA_DU_PHONG_TAM_KHOA` dù mã đã tiêu (đo ở
    B1 quan sát: true 0 / false 8 / khoá 2 / tiêu 1). Có từ T16; R1b-2.

**Hợp đồng**
25. `copilot.confirmAction` mức ≥ 4 nay NÉM `FORBIDDEN SCADA_AI_LEVEL_TOO_HIGH` thay vì trả `{ok:false, reason:"MUC_QUA_CAO"}` (T10a; 6 bề mặt web +
    extension đã đóng thẻ ở `denied`). Gọi trực tiếp `confirmAction()` (CLI/MCP/REST) vẫn nhận đối tượng kết quả.
26. REST v1: mọi lệnh không phải robot (OT, vision AOI/AVI, mtconnect/CMM) ⇒ 501, kể cả loại trước đây trả 200 "telemetry-only" (ruling T5).
    Robot-ness lấy từ hồ sơ mặc định của `machineType`, KHÔNG từ `capabilities.adapterKind`.

**Census**
27. Điểm mù đã biết: `import * as t`, helper khác tệp (T10a M-2); kiểm (B) thời chạy của `otWriteBinding` chưa theo helper.

### DỮ LIỆU

28. `_test` còn rác của hai lượt chạy sớm nhất T2: 4 adapter `r1b2…` (id 26336/26337/26342/26343) + tag + máy + 2 node edge — STOP edge chưa ack
    với `ownerEpoch` đã đổi; cần vai owner hoặc `edge_stop_resolve` của admin để dọn (không làm ở đây: luật không ghi DEV, và dọn `_test` cần
    owner). Lưới nghiệm thu này ack STOP edge TRƯỚC khi gỡ `edgeNodeId` (đã sạch).
29. Hàng WORM của lưới / bench ở lại `_test` (đúng thiết kế).
30. DEV đo chỉ đọc (T13): 42 tag / 21 int, 0 tag scale/offset khác mặc định, 0 luật interlock nhắm tag int có scale ⇒ đổi T13 không làm vỡ dữ liệu DEV.

### VẬN HÀNH

31. Bench OpenPLC chỉ phủ S1 / S2 / X2 trên PLC thật (§3); các ô khác chỉ có số đo lưới.
32. Safety PLC trong lưới / bench là PLC giả (D9), không phải safety PLC thật.
33. `.env` của cây chính và worktree vẫn `OT_CONTROL_ENABLED=true` (dòng 586, có từ trước) — trái checklist D9; không sửa (luật), điều phối / chủ dự
    án quyết.

## 7. Checklist bật cờ (trước khi bật điều khiển trên một hệ)

- [ ] **HMI là đường STOP PHẦN MỀM** qua `scadaCommands.dungMay` (nút DỪNG MÁY ở faceplate M4 và đầu máy M10): một bước, giá trị ĐÃ GHIM, miễn
      chế độ LOCAL / khoá chọn / 2FA / `apiLimiter` (POST không batch, phiên có chữ ký JWT hợp lệ — rà soát cuối I-2). STOP HMI **tới thiết bị**
      chỉ khi ĐỦ cả năm điều kiện (rà soát cuối M-2):
      1. `SCADA_COMMANDS_ENABLED=true`;
      2. `SCADA_LIVE_CACHE_ENABLED=true`;
      3. máy đã ghim `stop_value` **trên tag khai `actuationLevel = 1`** (kiem-dinh H1 b — ghim của tag mức cao / chưa khai mức bị bỏ qua);
      4. **`OT_CONTROL_ENABLED=true`** — tắt ⇒ dispatcher bước 5 trả `simulated`, KHÔNG ghi gì (UI báo `mo_phong`);
      5. **adapter đã nghiệm thu** (`commissioning_records`) khi `OT_COMMISSIONING_REQUIRED` bật (mặc định) — chưa ⇒ bước 5a trả `simulated`.

      ⚠ Mục D9 dưới giữ `OT_CONTROL_ENABLED` OFF tới khi có safety PLC thật ⇒ **cho tới khi D9 được gỡ, STOP HMI chỉ là MÔ PHỎNG; E-STOP cứng là
      đường dừng THẬT DUY NHẤT.** Hai mục không mâu thuẫn: mục này nói điều kiện để STOP HMI tới máy, D9 nói khi nào được phép thoả điều kiện 4.
      Bench §3 thoả điều kiện 4 + 5 chỉ trong tiến trình bench (`OT_CONTROL_ENABLED=true` ở đó theo D9; adapter có `commissioning_records` thật). STOP HMI KHÔNG có hạn tổng cho xác thực + đọc trước khi gửi (DB chậm-mà-sống ⇒ chờ
      theo DB; chỉ có hộp 10 s "dùng E-STOP cứng" của client) — R1b-2 (§10).
- [ ] **MỌI máy cần dừng từ xa phải ghim `stop_value`** cho tag dừng (M12). Máy chưa ghim ⇒ `CHUA_GHIM_STOP` (M4/M10 hiện cảnh báo
      `CanhBaoChuaGhimStop` / khảo sát khả năng dừng `chua_ghim`, `mat_ket_noi`, `qua_edge`, `khong_kiem_duoc`).
- [ ] **kiem-dinh H1 b — muốn STOP HMI tới tag nào thì khai `actuationLevel = 1` cho tag đó** (trang Kênh & giới hạn, M12; cần TOTP). STOP HMI
      chỉ gửi ghim của tag mức ≤ 1; tag mức 3 / 4 / 5 hoặc CHƯA khai mức (NULL ⇒ 5, fail-closed) bị bỏ qua (khảo sát `ghim_muc_cao` / "bỏ qua ghim
      của tag mức > 1"; máy mà mọi ghim mức cao ⇒ `GHIM_MUC_CAO` + "dùng E-STOP cứng"). Đếm trước trên từng DB (chỉ đọc):
      `SELECT count(*) FROM device_tags WHERE stop_value IS NOT NULL AND "isEnabled" AND writable AND (actuation_level IS NULL OR actuation_level > 1);`
      — mỗi hàng là một ghim sẽ KHÔNG được STOP HMI gửi sau triển khai.
- [ ] **kiem-dinh H1 a — ghim DỪNG chỉ kỹ sư trở lên (admin / supervisor / engineer) ĐÃ ĐĂNG KÝ 2FA, mỗi lượt một mã TOTP tươi** (`setStopPin`, cả
      đặt lẫn gỡ). Operator có `machine_control.canEdit` không còn ghim / gỡ ghim được (`SCADA_ROLE_FLOOR`).
- [ ] **kiem-dinh I1 — 0434 → backfill TOFU (chạy khô, rà, `--ghi`) → build** (§4 mục 1); luật KHÔNG đóng dấu được (thiếu tag) ⇒ admin DUYỆT
      LẠI bằng tay (huy hiệu "Cần duyệt lại"): tới lúc đó luật không bật được, không tự chặn, dispatcher từ chối lệnh interlock của nó (cổng inline vẫn
      chặn theo điều kiện). Mọi lần đổi định nghĩa tag nguồn / đích (UI có TOTP, CLI có `--cho-phep-tag-bao-ve`, đổi chủ edge của adapter) cũng đưa
      luật về "Cần duyệt lại"; người duyệt / bật trước đó duyệt lại được (fix round 2 I-B), người SỬA NỘI DUNG luật thì không. **Tuần đầu: admin
      rà lại các luật bảo vệ** (giới hạn TOFU, §4 mục 1).
- [ ] **kiem-dinh I-A — rà ghim DỪNG cũ trên tag mức ≥ 2 / chưa khai (§4 mục 2c) trước bản build.** AI `machine_stop` giờ cùng luật STOP HMI
      (chỉ ghim tag mức ≤ 1).
- [ ] **Commissioning (m-5):** mỗi lượt ghim / gỡ ghim DỪNG tốn MỘT mã TOTP mới (~30 s chờ mã kế) ⇒ ghim 20 tag ≈ 10 phút — xếp lịch cho đội
      commissioning.
- [ ] `SCADA_COMMANDS_ENABLED=true` BẮT BUỘC đi kèm `SCADA_LIVE_CACHE_ENABLED=true` (không có bộ đệm ⇒ mọi máy LOCAL `bo_dem_tat`, mọi lệnh ghi thường bị
      chặn; STOP ghim được miễn cổng chế độ theo dữ liệu nên vẫn đi — suy từ mã + S2, chưa đo riêng với bộ đệm tắt).
- [ ] **Kênh chế độ:** tag poll trung tâm, **poll ≤ 10 s, không deadband** (cổng chế độ kẹp tuổi mẫu min(3·poll, 30 s) — chậm hơn ⇒ máy LOCAL `cu`,
      fail-closed). M12 cảnh báo `poll_cham` / `deadband` / `edge` / `bao_khi_doi`. Trên edge thì luôn `chua_co_mau`.
- [ ] **`OT_CHAT_LUONG_V2_ENABLED=true`** để "connected" nghĩa là "đã đọc được" (C1). Cờ tắt: TCP lên mà thiết bị không trả lời vẫn hiện
      `connected` mãi (đo ở đối chứng C1).
- [ ] **`OT_CONTROL_ENABLED` / `AI_OT_CONTROL_ENABLED` giữ OFF tới khi có safety PLC thật** (D9). Hệ quả: STOP HMI là mô phỏng (mục đầu,
      điều kiện 4) — người vận hành dùng E-STOP cứng. ⚠ `.env` hiện có `OT_CONTROL_ENABLED=true` (§6 mục 33).
- [ ] MỌI kênh dừng phải khai mức 1 (R1a; kiem-dinh H1 b: nay BẮT BUỘC cả cho STOP HMI — ghim trên tag chưa khai mức / mức > 1 bị bỏ qua). Kênh
      dừng chưa khai mức là mức 5 ⇒ AI không dừng được, người cần TOTP (đường `write_tag`), STOP HMI không gửi ghim của nó.
- [ ] **Tích hợp dùng REST v1 `POST /equipment/:id/commands` cho máy OT phải chuyển sang HMI SCADA** (nay 501). Robot `abort` / `e_stop` giữ nguyên.
- [ ] Đặt `OT_CONTROL_TIMEOUT_MAX_MS` (R1a ruling T9) cho bên gọi có `deadlineMs`.
- [ ] `OT_COMMISSIONING_REQUIRED` giữ mặc định BẬT (adapter cần `commissioning_records`, nếu không lệnh chỉ `simulated`).
- [ ] Thứ tự migration theo §4: **0431, 0432, 0433, 0434** trên mọi DB trước bản build, rồi backfill TOFU 0434 (§4 mục 1; thiếu 0434 ⇒ `/health` degraded "0434"); sau khởi động `GET /health` không có `schemaR1a` (không
      `trangThai:"thieu"`, không `trangThai:"chua_kiem_duoc"`).
- [ ] Đổi IP / endpoint / protocol / máy của adapter có tag được bảo vệ cần TOTP tươi; còn tag đã khai đang ghim ⇒ gỡ ghim trước rồi ghim lại.
- [ ] **Kỹ sư bảo trì thiết bị đã đăng ký 2FA TRƯỚC triển khai** (T9, rà soát cuối M-3; chi tiết + câu đếm ở §4 mục 6): sửa / tạo / xoá / tắt tag
      được bảo vệ (đã khai, kênh chế độ, đích / nguồn telemetry luật interlock bật hoặc đã duyệt), sửa / xoá / tạm tắt adapter có tag ấy, và
      import mapping đụng tag ấy đều đòi TOTP mức 5 — kể cả khi mọi cờ SCADA tắt; chưa đăng ký ⇒ `SCADA_CONFIG_TOTP_NOT_ENROLLED`. Wizard
      onboarding không nhập được TOTP (dùng trang Device Adapter; R1b-2).
- [ ] **Truy vấn luật interlock lệch lưới thô (§4 mục 2) = 0 hàng trên DB đích** trước bản build; sau khởi động `interlockRulesCauHinhHong`
      của posture không tăng vì luật mới lệch lưới và log không có khối "LUẬT INTERLOCK ĐANG BẬT … dispatch() sẽ TỪ CHỐI" (rà soát cuối I-1).
- [ ] **P1-1 — Trước khi bật `AI_OT_CONTROL_ENABLED` trên một DB đã có tag ghi được: khai mức tác động hàng loạt (M12) cho mọi kênh AI cần ghi**
      (khai hàng loạt một TOTP cho N ≤ 200 tag là việc R1b-2). Tag chưa khai mức = mức 5 ⇒ AI bị từ chối (fail-closed).
- [ ] P1-7: "Trước khi bật OT_CMD_SERIALIZE_ENABLED: rà các bên gọi qua adapterFacade (UNS/edge) có deadline_ms ngắn; lệnh thường chờ hàng đợi quá hạn sẽ QUEUE_EXPIRED; STOP ghim không hết hạn."
- [ ] P1-8: "Trước khi bật SCADA_CONG_CHE_DO_ENABLED: mọi máy nhận lệnh từ xa phải khai kênh chế độ; máy LOCAL/chưa khai sẽ từ chối cả STOP không ghim và hành động bảo vệ của interlock (chỉ STOP ghim đi qua) — ghim stop_value cho máy cần dừng từ xa."
      (R1b-1: STOP HMI là STOP ghim nên đi qua; cổng chế độ luôn chạy cho `hmi.*` bất kể cờ — đo ở S2.)

## 8. Quyết định của bộ điều khiển và điều phối (sổ R1b-1)

**Điều phối (2026-10-24 / 25)**
- Kế hoạch duyệt (quyết định 1–6, bổ sung: hộp xác nhận STOP mặc định "Dừng máy", audit từng adapter, cảnh báo máy chưa ghim, đếm mồ côi trước,
  không điều tiết mã từ chối thật).
- (1) dispatch làm tròn im lặng trên tag int chưa khai scale ≠ 1 ⇒ census người gọi + đo; không ai dựa vào ⇒ `OFF_STEP`, không cờ (Task 13).
  Q-T13: R1b-1 giữ làm tròn cho int scale = 1 / offset = 0 chưa khai; R1b-2 `OFF_STEP` mọi int + SPI theo lưới; `datStopPin` lệch lưới ⇒ R1b-2.
- (2) Trỏ lại không TOTP gộp vào T9 (TOTP tươi + kiểm nhất quán cho tag đã khai / kênh chế độ; tag chưa khai giữ nguyên).
- (3) Khai mức hàng loạt (một TOTP cho N ≤ 200, audit từng tag) ⇒ R1b-2.
- (4) `/health` hiện "chưa kiểm được" ⇒ T10.
- R1a gộp main `1c743a38a` (265 tệp 3789 xanh, DB 29 tệp 363, tsc 0); merge vào R1b ở ranh giới T2/T3 (`482037684`).
- 0433 "ÁP" DEV (verify xanh). 0433 vào checklist triển khai (§4).
- 5 thủ tục IDOR do luong-ui sửa NGOÀI nhánh (§9); merge main (`60b074f02`) ở điểm dừng T9: dòng phạm vi đặt TRƯỚC cổng TOTP/nhất quán T9; giữ
  GHIM đo được của luong-ui.
- Miễn trừ "2fa" của T9 đồng ý; luong-ui tiếp tục sửa phạm vi `/api/external` (giữ ghim của họ khi gộp).

**Bộ điều khiển (ruling, theo task)**
- R-1: `dungMay` (T2) dùng `ghiThuLenh` như cũ; T7 thêm `ly_do` cho mọi đường. R-2: T11 (chữ `goiYStop`) gộp vào T2.
- T2: I1 miễn `apiLimiter` cho POST `dungMay` không batch + client gửi không batch + census ghim; I2 audit fire-and-forget có hạn; I3 nút DỪNG MÁY ở
  M10; minor: STOP qua edge ⇒ dòng chờ `executed`; `.catch` trên attempts nhánh từ chối; hộp đóng được sau 10 s "kết quả chưa rõ — dùng E-STOP
  cứng"; đọc ghim song song. Khảo sát khả năng dừng (`khaoSatKhaNangDung`) với `mat_ket_noi`, `qua_edge`, `khong_kiem_duoc`; hạn 1 s đọc node edge.
- T3: c1 `ok:true` mà MỌI tag `bad/comm_lost` không là đọc tốt (khớp D1); lỗi cấu hình vẫn tính; c2 ghi trong lúc chờ không chặn (R1b-2 ứng viên).
- T4: c2 đọc treo quá hạn ⇒ tick bị chặn báo tick hỏng (D1 K=2 hạ phiên); `ingest_treo` của lần đọc chính tính là đọc tốt.
- T5: vision / mtconnect cũng 501 (nhất quán "không phải robot ⇒ 501"); robot-ness từ `machineType`.
- T6: không gỡ `.references()` để census xanh; 5 thủ tục lộ phạm vi ghi SỔ NỢ + GHIM (nay đã sửa ở main, §9); verify 0431 chạy lại được.
- T7: khoá cửa sổ (userId, reasonCode); tổng kết ghi `DIEU_TIET` + dòng hiện tại; `kiemSchemaR1a` thêm `thieu0433`; STOP không bao giờ bị từ chối vì
  chữ lý do (zod `max(2000)`, service lọc + cắt).
- T9: a miễn "2fa" cho `tags.update` (+ create/delete, `deviceAdapter.update`); b tag đã khai đang ghim ⇒ "gỡ ghim trước"; C1/I2/I3/I5/I6/I7 sửa
  ngay (định nghĩa tag được bảo vệ, xoá/prune/tạo lên khoá mồ côi, import trong tx, tắt đích interlock, đổi đích adapter cần TOTP); I1 so sánh
  theo đường đọc (null ⇒ 1, 0 giữ 0); r3 mở rộng tag được bảo vệ (nguồn telemetry, luật đã duyệt), một cổng adapter chung, một thứ tự khoá
  adapter → luật → tag → kênh chế độ; N5 chuyển sang T10.
- T10 tách T10a (gói brief) / T10b (dư T9 + N5 + JSDoc T8). T10a: giữ NÉM `MUC_QUA_CAO`, sửa thẻ client; `/health` chỉ lộ lớp lỗi ngắn; kiểm edge
  trước dùng bản không khoá; `epLong` đối chiếu low/high.
- T10b: I-1 cho phép nguồn không tag thiết bị nào khai (đường `ot_telemetry`); `poll_cham`; `INTERLOCK_NGUON_MO_HO`.
- T13: vòng đánh bóng m1 + m3; m2 / m4 / m5 ⇒ backlog / điều phối.
- **Rà soát cuối cả nhánh (final review `58ee02c5e..d5ea4cfdf`, ruling final):** một lượt sửa —
  - I-1 (a) truy vấn chỉ đọc BẮT BUỘC trước triển khai (§4 mục 2) + (b) posture `interlockRulesCauHinhHong` đếm luật bật lệch lưới (CHÍNH hàm
    cổng dispatch, `services/scada/lenhInterlockLechLuoi.ts`; luật vừa hỏng cấu trúc vừa lệch chỉ đếm một lần) + khối log lúc khởi động;
  - I-2 `apiLimiter` chỉ miễn STOP HMI khi phiên có chữ ký JWT hợp lệ (`rateLimitConfig.laStopHmiCoPhienKy` → `trpcGioiHanThuTuc.phienKyHopLe`,
    cùng `sdk.verifySession` bước 1 của robotStopAuth, một chủ); vô danh / cookie rác / sai chữ ký / hết hạn ⇒ đếm. Giới hạn còn lại: vé đã
    thu hồi nhưng còn hạn vẫn được miễn (stateless — createContext vẫn từ chối); mỗi cookie rác in một dòng `[Auth] Session verification failed`
    (như đường createContext sẵn có);
  - M-2 / M-3 chữ báo cáo (§4 mục 6, §7); wizard ⇒ backlog; M-4 xoá `biet0433Thieu`; M-5 `withDeadline(…, { unref })` thay hai bản sao
    `voiHanUnref`; M-6 sửa chú thích (totpCauHinh, đầu deviceAdapter / mappingAsCode, tên test consoleStop) + thụt lề `nhacCaHai`; M-7 `/health`
    `schemaR1a` một hình dạng; M-1 sửa chú thích client, hạn thật ⇒ R1b-2 (§10 mục 11).

## 9. Năm thủ tục IDOR — đã sửa ở main và đã gộp

T6 làm lộ (qua `.references()` của 0433, census `phamViDoc` chuyển 5 thủ tục C → A) năm thủ tục đọc theo `adapterId` không lọc phạm vi nhà máy.
Ghi SỔ NỢ + GHIM ngày 2026-10-24; điều phối giao luong-ui sửa NGOÀI nhánh:
1. `commissioning.list`
2. `commissioning.status`
3. `deviceAdapter.tags.listByAdapter`
4. `unsMapping.get`
5. `unsMapping.list`

Sửa ở main **`7388c6bcd`** (luong-ui): bộ phân giải chung `server/routers/_adapterPhamVi.ts` (`adapterCuaTag` / `adapterTrongPhamVi`) cho
commissioning (list/status/create/revoke), deviceAdapter (list/get/create/update/delete/testConnection/tags.*), unsMapping (list/get/create/update/
delete), mappingAsCode (list/exportOne/preview/applyImport); ngoài phạm vi = `NOT_FOUND`, danh sách chỉ trả mục trong phạm vi, admin giữ nguyên.
Gộp vào nhánh ở **`60b074f02`** (merge main `58ee02c5e`): `deviceAdapterRouter.ts` giữ dòng phạm vi TRƯỚC cổng T9; `phamViDocBaseline.ts` theo main
(5 dòng nợ T6 gỡ); GHIM `phamViDocCensus` đo lại A314 B8 C488 D1199 S394 tổng 2403. Kiểm hôm nay: `git merge-base --is-ancestor 7388c6bcd HEAD`
đúng. (Kéo theo: concern T9 "`tags.update` không có kiểm phạm vi" đã đóng bởi cùng commit.)

## 10. Backlog R1b-2

**Từ kế hoạch R1b-2 (đã duyệt tách):** M9 `/scada/journal` (UI + nợ phạm vi `commandLogRouter`); M4 "Điều kiện cho phép" chạy khô; M12 tìm kiếm,
cảnh báo deadband trước khi lưu, ca biên ô chọn adapter; chip "Truyền thông n/m"; Lab "thử đọc một địa chỉ"; `danhSach` lộ endpoint / `lastError`;
`ketNoiLai` giới hạn tần suất + audit trong giao dịch; tắt nóng `SCADA_SOCKET`; trần tổng tag / người dùng; nhãn "sim" cho lệnh stub; EIP listener
`'error'` + `timeout_sp`; định danh callback ghi SLMP; tắt sạch không ghi `disabled`; C6 đọc khối Modbus; đo mất / có lại OPC UA; nhịp cho nguồn
ngoài OT trung tâm; `congOtLuong` dùng mức kênh; audit điều tiết báo đúng cỡ đợt burst; **khai mức hàng loạt** (một TOTP cho N ≤ 200, audit từng
tag, kiểm nhất quán từng tag — cần trước `AI_OT_CONTROL_ENABLED`).

**Phát sinh trong R1b-1 (sổ):**
1. ~~Bench OpenPLC R1b-1~~ — ĐÃ CHẠY 2026-10-25, 15/15 (§3). `avi-openplc-bench` chạy với `--memory 1g` (điều phối 2026-10-25: GIỮ — máy dùng chung với llama-server, container từng bị giết vì áp lực bộ nhớ); gỡ bằng `docker update --memory 0 --memory-swap -1 avi-openplc-bench` nếu cần.
2. T3: ghi trong lúc phiên chờ lần đọc tốt đầu tiên (c2); push đếm đọc tốt theo "máy chủ đã trả lời" (good | uncertain | bad không phải comm);
   reset HA tính là mất còn legacy thì không; push không có watchdog thừa mẫu; thứ tự canh `sinkPhien` legacy.
3. T4: khi DB treo vẫn nạp `napTuOt` (bộ đệm không cũ theo DB); thử lại lô mẫu xấu bị bỏ.
4. T7: không có canh 0433 ở đầu `request`/`confirm` (M-3/M-4); tổng kết `DIEU_TIET` cho người ngừng hẳn.
5. T8: người thắng bị `MA_DU_PHONG_TAM_KHOA` dưới ≥ 10 lượt song song (đo lại ở B1 quan sát).
6. ~~T9: CLI `mappings-import.mjs --apply` từ chối tag được bảo vệ.~~ — ĐÃ LÀM ở vòng sửa kiem-dinh (I2, §13).
7. T10a: M-2 điểm mù census (`import * as t`, helper khác tệp); M-3 dispatcher join `edge_nodes`; M-4 leo thang `chua_kiem_duoc`; M-5
   `performance.now` khi máy ngủ; loại tệp test khỏi hai ca census `confirmAction` kèm lý do có ngày; DOM test I-2 cho mọi hộp (nay chỉ Guided).
8. T13: m2 đường FOE thật tới số thô; m4 `datStopPin` lệch lưới trên tag chưa khai có scale; m5 HMI `TYPE_MISMATCH` trên int scale 0,5 trong khi
   dispatch nhận; Q-T13 (b) `OFF_STEP` mọi tag int + bộ đề xuất SPI theo lưới tag (cùng task, có test).
9. Dọn rác `_test` của T2 (4 adapter `r1b2…`, 2 node edge) bằng vai owner / `edge_stop_resolve` (§6 mục 28).
10. Hai hộp chồng nhau ở ScadaDiag (lý do + mã TOTP) — gộp ở một vòng UX.
11. **Rà soát cuối M-1 — hạn THẬT cho STOP HMI trước khi gửi.** `dungMayHmi` (`server/services/scada/lenhHmi.ts`): `idsTrongPhamVi`, đọc máy,
    `kiemCongVaiTro`, đọc adapter, `loadStopPins`, chèn dòng chờ đều KHÔNG có hạn; `context.ts` `isStopOnlyCall` chỉ phủ `robot.consoleStop` ⇒
    `dungMay` đi `authenticateRequest` đầy đủ, không hạn. DB chậm-mà-sống ⇒ STOP chờ theo DB; cận duy nhất là hộp 10 s "dùng E-STOP cứng" của
    client. Việc: bọc pha trước-dispatch trong MỘT hạn (~2 s) trả mã từ chối có câu "dùng E-STOP cứng", và/hoặc mở rộng xác thực có hạn R-10-bb
    cho `dungMay`. (Chú thích sai ở `client/src/lib/trpcLinks.ts` đã sửa ở rà soát cuối.)
12. **Rà soát cuối M-3 — `DeviceOnboardingWizard` không nhập được TOTP.** Tạo tag lên khoá mồ côi qua wizard (`tags.create`) nhận
    `SCADA_CONFIG_TOTP_REQUIRED` mà không có ô mã: định tuyến lỗi qua `useHopMaTotpTroLai` hoặc hiện câu "dùng trang Device Adapter".
13. Rà soát cuối I-1 — posture `interlockRulesCauHinhHong` (nay gồm luật lệch lưới thô) CHƯA được client nào hiển thị (đo: không tệp
    `client/src` nào đọc trường này); đưa lên EngineeringHub / trang interlock cạnh "độ phủ interlock".

**R1b-2a — hoãn từ kiểm định độc lập R1b-1 (quyết định điều phối 2026-10-25, KHÔNG làm ở vòng sửa §13):**
14. Limiter `dungMay`: đổi miễn tuyệt đối → trần theo NGƯỜI rộng (~600 / phút). Lý do kiem-dinh: vé đã thu hồi nhưng còn hạn vẫn được miễn
    (kiểm stateless) ⇒ người có vé ký hợp lệ gửi `dungMay` không giới hạn; mỗi lượt vẫn qua `createContext` (áp lực pool DB).
15. kiem-dinh M1 — dung sai lưới tuyệt đối 1e-9·max(1,|s|) nuốt phần lệch khi |scale| ≲ 2e-9 và |raw| ≥ 2^53 (lý thuyết; 1200 giá trị đối chiếu
    `inverseScale` thật: 0 từ chối nhầm).
16. kiem-dinh M2 — NaN / Infinity / "abc" trên tag int có scale chưa khai vẫn đi qua (hành vi cũ).
17. kiem-dinh M3 — `kiemSchemaR1a` không kiểm 3 FK của 0433 (script áp có verify `confdeltype` / `convalidated`). (Kiểm cột 0434 lúc khởi động
    ĐÃ LÀM ở fix round 2 — I-C.)
18. kiem-dinh M4 — `samplingMs` / `deadband` / `unit` sửa được trên tag được bảo vệ không TOTP (nguồn luật trễ tối đa 60 s khi
    `OT_TAG_DEADBAND_ENABLED` bật, mặc định tắt). CLI mappings-import cũng không coi ba cột này là chạm bảo vệ (cùng luật UI).
19. kiem-dinh M5 — phạm vi nhà máy chỉ kiểm TRƯỚC giao dịch, không kiểm lại dưới khoá adapter (chỉ `scadaKenh.capNhat` làm đúng; cần hai thao tác
    đồng thời đổi `machineId`).
20. kiem-dinh M7 — import `mappingAsCode` khoá tag không ORDER BY (≈:720) ⇒ có thể 40P01; `kiemTotpCauHinh` chiếm thêm 1 kết nối pool trong giao
    dịch (nay cả `setStopPin` và `interlock.update / delete`).
21. Phát sinh ở vòng sửa §13: bám định nghĩa phủ thêm endpoint / protocol / connectionOptions / máy của adapter đích (§6 mục 18a); luật "Cần duyệt
    lại" vào hàng chờ duyệt của oversight / EngineeringHub; hộp duyệt hiện định nghĩa tag nguồn / đích đang được duyệt.
22. Fix round 2 (I-A): STOP do hệ thống khởi phát (`deviceOwnershipService` owner-transfer, `edgeGatewayRuntime` / `edgeExecutionAgent` nhả edge) vẫn
    ghi MỌI ghim — lọc cùng luật `phanLoaiGhimStopHmi` (hoặc chứng minh không cần) sau khi §4 mục 2c đã dọn ghim cũ.
23. m-2 — duyệt lại không hiện định nghĩa và không có SoD với người ĐỔI ĐỊNH NGHĨA tag (X đổi address có TOTP rồi tự duyệt lại luật): SoD theo audit `device_tag` kể từ lần duyệt.
24. m-3 — luật "Cần duyệt lại" không vào hàng chờ duyệt (`assignmentService.ts:44` `isNull(approvedBy)`, oversight cũng vậy) — sau 0434 có thể hàng chục luật vô hình.
25. m-4 — lệch bám làm tự chặn của luật đang bật NGỪNG mà không báo chủ động (chỉ khi luật bắn mới có 'skipped' + Andon) — posture / `/health` đếm `enabled AND canDuyetLai`.
26. m-5 — ghim theo lô lúc commissioning tốn một mã TOTP mới mỗi tag (~30 s / ghim) — chấp nhận, ghi ở §7; cân nhắc một mã cho N ghim trong một lượt.
27. m-6 — hằng SQL N-1: chuỗi số mũ cực lớn (`"1e1000000"`) làm cả truy vấn lỗi `numeric overflow` (lỗi ồn, không bỏ sót) — bọc ép kiểu an toàn hoặc ghi một dòng ở §4.

**Từ backlog R1b của R1a (§8) chưa thuộc R1b-1:** mục 2 (phần còn lại, đã vào danh sách R1b-2 trên), 6 (UI M9), 7 (M4 chạy khô), 10
(`congOtLuong`), 14 (audit điều tiết đúng cỡ), 16 (M12), 21 (khoá TOTP leo thang / cảnh báo `tam_khoa` lặp), 22 (màn admin mở khoá TOTP), 23
(`NganTagAdapter` đòi `machine_control.canView`), 24 (i18n `TRPC_GIOI_HAN_THU_TUC`), 25 (P2 còn lại của kiem-dinh — chờ danh sách của điều phối).

## 11. Commit R1b-1

Nhánh `feat/scada-r1b`, gốc `feat/scada-r1a` `9c7b8054d`. Gộp main hai lần: `482037684` (R1a đã gộp, ranh giới T2/T3) và `60b074f02` (main
`58ee02c5e`, điểm dừng T9 — IDOR `7388c6bcd`).

- **Kế hoạch:** `cc5c1f5b2`, `1a4780b67`, `94d486bb7`.
- **T1** nhịp tim deadband: `f5f8f40d9`.
- **T2** STOP HMI (+ T11 gộp): `3fea3af45`, `21fbb862e`, `e339cf249`, `1c939424f`.
- **T3** connected = đọc tốt: `6b4f66499`, `9367833d8`.
- **T4** ingest treo: `44e9875fe`, `f89d53738`.
- **T5** REST v1 501: `eeddf1adc`, `403ca87ac`.
- **T6** mig 0433: `2fbdc93a2`, `181896881`.
- **T7** `ly_do` + điều tiết: `7587aec92`, `760d6d0f8`, `99033ce83`.
- **T8** mã dự phòng: `f2238233d`.
- **T9** trỏ lại cần TOTP + interlock: `8d1f065b9`, `8957285db`, `b46cecc9e`, `8a430ef1f`, `607b890e8`; sau gộp `ec4120a80`.
- **T10a:** `e18225ceb`, `cdd8329f6`, `e6e7b1bdc`, `5a1390b0a`, `3ea92b425`, `917acadfb`, `cd830fcf8`, `045334512`, `e1d57fa03`, `dcb8bbcea`,
  `f3230206f`, `6efd9e39d`, `4536ed037`, `eab0464f9`.
- **T10b:** `b0de45175`, `ae67c389f`, `abaa9220a`, `40bd580b2`.
- **T13:** `60f7304e7`, `9bd9a5354`.
- **T12:** `39ce0b0cf` (lưới + bench) và commit chứa báo cáo này (kèm khai hai bench SCADA trong `server/services/vram/vramAllocationSites.ts`).
- **Rà soát cuối cả nhánh:** `09ed8c41e` (mã: I-1 posture + log, I-2, M-1, M-4..M-7) và commit chữ báo cáo kế tiếp (I-1 §4 mục 2, M-2 / M-3 §4 mục 6
  + §7, backlog §10 mục 11–13). Đo sau sửa: census 57 tệp 960 qua / 3 bỏ qua / 0 đỏ; lô không-DB `server/_core` + `services/scada` + `services/ot` +
  router scadaCommands / oversight / interlock + `trpcLinks` 187 tệp 2575 qua / 13 bỏ qua; lô DB tuần tự cùng phạm vi 43 tệp (3 bỏ qua) 633 qua /
  42 bỏ qua; `npm run check` rc 0; `npm run i18n:check` sạch.

- **Kiểm định độc lập — sửa (§13):** `3256c6808` (M6), `75c150213` (N-1), `80ac53ce5` (H1 a), `fb05faa25` (H1 b), `ebac0dcd6` (I1 + I3, mig 0434),
  `085824598` (I2), `a0cb862ea` (chữ báo cáo); fix round 2: `b8d541286` (I-A + m-1), `2ca1f1e34` (I-B), `5d2e22458` (I-C), `126f96a87` (TOFU) và
  commit chữ báo cáo kế tiếp.

**Migration:** 0433 (`scripts/apply-migration-0433.mjs`): TEST ở T6; DEV 2026-10-24 sau "ÁP". 0431 / 0432 như R1a. Cả ba kiểm lại có mặt trên DEV
và TEST hôm nay (§4). **0434** (`scripts/apply-migration-0434.mjs`, kiem-dinh I1 a): TEST 2026-10-25; **DEV chưa áp** (chờ điều phối duyệt SQL).

## 12. Bàn giao

- Không push. Không cờ mới (`.env.example` không đổi bởi R1b-1).
- Container bench: chạy theo cho phép của điều phối rồi trả về **exited** như lúc tìm thấy (giới hạn 1 GiB để lại). `_test` sạch, chỉ còn hàng WORM của lưới + bench, đúng thiết kế.
- Việc tiếp: rà soát cuối cả nhánh → kiem-dinh → gộp.
- 2026-10-25: kiem-dinh trên `abcd3ea58` — "KHÔNG ĐẠT có điều kiện"; vòng sửa + fix round 2 ở §13 (SQL 0434 đã DUYỆT; điều phối tự áp DEV lúc gộp, rồi backfill TOFU). Việc tiếp: gộp main mới
  nhất (`f15291ed6`) → đo lại GHIM census trên cây đã gộp → lưới đầy đủ → kiem-dinh lại.

## 13. Kiểm định độc lập R1b-1 — sửa

Kiem-dinh trên `abcd3ea58`: **KHÔNG ĐẠT có điều kiện**. Quyết định điều phối 2026-10-25 (brief `kiemdinh-fix-brief.md`): sửa H1, I1, I2, I3, N-1, M6
trước gộp; I4 vào điều kiện triển khai; limiter `dungMay` + M1/M2/M3/M4/M5/M7 sang R1b-2a (§10 mục 14–21).

| Mục | Lỗi kiem-dinh | Sửa | Commit |
|---|---|---|---|
| **H1** (Cao) | `setStopPin` chỉ cần `machine_control.canEdit`, nhận mọi tag writable + giá trị bất kỳ; `dungMay` gửi ghim một bước (mức 1, miễn chế độ / dải / policy / interlock) ⇒ operator ghim tag mức 4/5 giá trị X rồi bấm DỪNG = thiết bị nhận X (vượt TOTP, sàn vai, LOCAL) | (a) `setStopPin`: sàn vai admin / supervisor / engineer TRƯỚC mọi đọc (`SCADA_ROLE_FLOOR`), kiểm hợp lệ, rồi TOTP tươi mức 5 (`kiemTotpCauHinh`) CUỐI trong giao dịch, cả đặt lẫn gỡ; census `kiemXacThucTheoMuc` (miễn "2fa" có lý do ghi ngày); UI hộp mã 6 số dùng chung + ghi chú tag mức > 1. (b) `dungMay` chỉ gửi ghim của tag `actuationLevel ≤ 1` (NULL ⇒ 5); ghim mức cao BỎ QUA từng tag + `boQua` trong kết quả + audit; không bao giờ chặn ghim hợp lệ khác; mọi ghim mức cao ⇒ `GHIM_MUC_CAO` ("dùng E-STOP cứng"); khảo sát `khaNangDung` + M4/M10/M12 cùng luật (`ghim_muc_cao`, `ghimBoQua`) | `80ac53ce5` (a), `fb05faa25` (b) |
| **I1** | sửa / xoá luật interlock tự bỏ duyệt KHÔNG đòi TOTP ⇒ tag hết được bảo vệ ⇒ đổi address / kiểu không cần mã ⇒ admin duyệt lại mà không thấy định nghĩa đã đổi | (a) bám định nghĩa tag nguồn / đích (address, dataType, scale / offset, adapterId, `edgeNodeId` của adapter) chụp vào `approvedDefHash` lúc `approve` (mig **0434**) VÀ nằm trong `versionToken` v2; duyệt chỉ còn hiệu lực khi bám khớp — `enable` từ chối (`interlockDefinitionChanged`), engine không tự chặn, dispatcher `INTERLOCK_NOT_APPROVED`; cố ý KHÔNG áp ở cổng inline và `luatBaoVe` (fail-open ở đó); UI huy hiệu "Cần duyệt lại". (b) `kiemTotpCauHinh` khi sửa / xoá luật ghi lệnh đang bật hoặc đã duyệt có đích / nguồn tag, kiểm hợp lệ TRƯỚC, mã CUỐI; UI hộp mã | `ebac0dcd6` |
| **I2** | `scripts/mappings-import.mjs` ghi SQL thẳng vào `device_tags`, né T9 | mặc định TỪ CHỐI lô đụng tag được bảo vệ (cùng định nghĩa `troLaiKenh`, SQL `scripts/lib/tagBaoVeCli.mjs` có test so với hàm TS), kiểm cả trước và trong giao dịch; ngoại lệ tường minh `--cho-phep-tag-bao-ve` (quyền host + DB, ghi vào metadata audit); tài liệu `contracts/mappings/README.md`; nhờ I1 a, duyệt cũ tự mất hiệu lực | `085824598` |
| **I3** | `changeDeviceOwner` đổi `edgeNodeId` = đổi đích | `edgeNodeId` nằm trong bám I1 a ⇒ luật đã duyệt nhắm (đích) hoặc đọc (nguồn) adapter đó trở về chưa duyệt; không thêm TOTP ở đường robot. Test với `changeDeviceOwner` THẬT (đích, nguồn, cả hai) | `ebac0dcd6` |
| **N-1** | SQL trước triển khai trả NULL (bỏ sót) cho chuỗi hex / TAB / NBSP mà JS đọc được | mọi `commandValue` không phải số / boolean / null / chuỗi số thập phân sạch ⇒ hàng `ket_luan = 'KHONG_PARSE_DUOC'` (đếm là chặn); khối SQL §4 mục 2 = hằng `TRUY_VAN_TRUOC_TRIEN_KHAI` nguyên văn (test so từng ký tự) | `75c150213` |
| **M6** | `tags.update` / `tags.delete` trả `NOT_FOUND{deviceTag}` (không tồn tại) khác `NOT_FOUND{adapter}` (ngoài phạm vi) ⇒ lộ id tag nhà máy khác | `adapterCuaTag` đổi lỗi phạm vi về đúng `NOT_FOUND {entity:"deviceTag"}`; test: ngoài phạm vi ≡ không tồn tại (code + appCode + params) | `3256c6808` |
| **I4** | census OFF_STEP T13 chưa đo trên PRODUCTION | §4 mục 2b: chạy task-13-report §1.3 trên PRODUCTION trước triển khai (DEV 42 tag / TEST 323 tag — 0 thuộc diện) | commit chứa báo cáo này |

**Migration 0434** (cấp dải 0434–0436 cho vòng này; chỉ dùng 0434): cần thật — `versionToken` không được lưu và các cột duyệt hiện có
(`approvedBy`, `approvedAt`) không chứa được bám. Áp TEST (`node scripts/apply-migration-0434.mjs --test-only`, hai lần). **DEV CHƯA ÁP — SQL
`drizzle/0434_interlock_bam_dinh_nghia_duyet.sql` gửi điều phối.**

**Test + đột biến (mỗi cổng đỏ rồi hoàn tác):**
- H1 a — `deviceAdapterRouter.stopPinTotp.r1b.db.test.ts` (operator ghim tag mức 4 ⇒ từ chối, cả gỡ / tag chỉ đọc / tag không tồn tại;
  engineer không mã ⇒ TOTP_CAN; mã sai / chưa 2FA; kiểm hợp lệ trước mã — mã không bị tiêu; gỡ cũng cần mã) + DOM. Đột biến: bỏ sàn vai ⇒ đỏ 1;
  bỏ TOTP ⇒ đỏ 3.
- H1 b — `scadaCommandsRouter.dungMay.db.test.ts` (ghim mức 4 + ghim chưa khai mức gieo thẳng ⇒ thiết bị chỉ nhận ghim mức 1, kết quả + audit liệt
  kê 2 tag; máy chỉ ghim mức cao ⇒ `GHIM_MUC_CAO`, 0 dispatch; khảo sát + `coGhimStop` cùng luật), `stopPin.mucHmi.test.ts`, DOM 5 ca. Đột biến:
  gửi mọi mức ⇒ đỏ 3; NULL ⇒ 1 ⇒ đỏ 1.
- I1 / I3 — `interlockRouter.kiemDinh.r1b.db.test.ts` (13 ca), `dinhNghiaDuyet.test.ts`, engine + dispatcher (ca lệch bám), DOM. Đột biến: approve
  không chụp bám ⇒ đỏ 4; `enable` bỏ kiểm bám ⇒ đỏ 3; update bỏ TOTP ⇒ đỏ 1; delete bỏ TOTP ⇒ đỏ 1; bám bỏ `edgeNodeId` đích ⇒ đỏ 1; bỏ
  `edgeNodeId` nguồn ⇒ đỏ 1; token bỏ bám ⇒ đỏ 1; dispatcher bỏ kiểm ⇒ đỏ 1; engine bỏ kiểm ⇒ đỏ 1.
- I2 — `scripts/mappings-import.tagBaoVe.db.test.ts` (CLI THẬT; tương đương SQL ↔ TS). Đột biến: CLI luôn cho phép ⇒ đỏ 3; SQL bỏ điều kiện
  `approvedBy` ⇒ đỏ 3.
- N-1 — `interlockRouter.r1b.db.test.ts` §5 ("0x19", TAB, NBSP, `[25]`, " 25 "), `lenhInterlockLechLuoi.baoCao.test.ts`. Đột biến: WHERE về
  `v IS NOT NULL AND` ⇒ đỏ 2.
- M6 — `adapterPhamVi.db.test.ts`. Đột biến: bản cũ ⇒ đỏ 1.
- Fixture (không đổi assertion): luật "đã duyệt" gieo thẳng ⇒ `server/testing/dauDuyetInterlock.ts` chụp bám (như approve); tệp chỉ kiểm ngữ nghĩa
  ghim / MOC / token bằng người gọi id giả ⇒ mock `kiemTotpCauHinh`; tag CÓ ghim trong `dungMay.db` mặc định khai mức 1; unit dispatcher / engine
  mock `luatDuyetConHieuLuc` (FakeDb không có raw SQL).

**Đo sau sửa (2026-10-25, trên `085824598` + báo cáo; CHƯA gộp main mới — GHIM census đo lại khi gộp):**

| Lô | Kết quả |
|---|---|
| Không-DB: `server/_core`, `services/scada`, `services/ot`, `services/interlock`, router interlock* / deviceAdapter* / scadaCommands* / scadaDiag* / scadaKenh*, `client` scada + DeviceAdapterManagement + InterlockRuleManagement + ScadaDiag, `scripts/lib` | 205 tệp, 2911 qua / 13 bỏ qua / **0 đỏ** |
| DB tuần tự (`vitest.db.config.ts`) cùng phạm vi + adapterPhamVi, commissioningRouter, engineeringAssignment, oversight, edgeAuthorize | 59 tệp (3 bỏ qua = lưới opt-in), 889 qua / 42 bỏ qua / **2 đỏ** — cả hai ở `engineeringAssignment.db.test.ts` (§8 fix 1, §10 M-5), **có sẵn**: chạy lại với `interlockRouter.ts` của `abcd3ea58` ⇒ cùng 2 đỏ (`luatTrongPhamVi` NOT_FOUND cho luật không vị trí + kỹ sư có phạm vi — lô phạm vi W8 của main, không thuộc vòng này) |
| CLI DB (`scripts/mappings-import.*.db.test.ts` + `scripts/lib`, cấu hình mặc định) | 4 tệp 20/20 |
| Census (mọi `*census*.test.ts(x)` trong git) | 58 tệp, 978 qua / 3 bỏ qua / **0 đỏ** |
| Opt-in R0 + R1a + R1b-1 (`SCADA_R0/R1A/R1B_NGHIEM_THU=1`, một lượt) | **42/42** (S1–S6 không cần đổi fixture: tag dừng đã khai mức 1) |
| `npx tsc --noEmit` (12 GB) · `npm run i18n:check` | 0 lỗi · sạch |

**Quyết định của người sửa cần điều phối xem:** (1) bám lệch KHÔNG làm luật "chưa duyệt" ở `interlockGate` và `troLaiKenh.luatBaoVe` (ở hai chỗ đó
coi là chưa duyệt = gỡ chặn / tag mất bảo vệ — chiều fail-open), khác chữ "engine / gate / luatBaoVe" của brief; (2) đối tượng / mảng
`commandValue` cũng thành hàng `KHONG_PARSE_DUOC` (JS đọc được `[25]`); (3) `setStopPin` miễn nhóm "2fa" (ghim thành loạt lúc commissioning).

### Fix round 2 (review `kiemdinh-fix-review.md`, điều phối 2026-10-25 — 0434 DUYỆT, điều phối tự áp DEV lúc gộp; phương án B: TOFU)

| Mục | Sửa | Commit |
|---|---|---|
| **TOFU** (1)(2)(4) | `scripts/backfill-approved-def-hash.mjs` (`npx tsx`, bắt buộc `--test-only` / `--dev-only`, chạy khô mặc định, `--ghi` + `--actor`) gọi `server/services/interlock/backfillDinhNghiaDuyet.ts`, IMPORT hàm bám của ứng dụng; chỉ luật `approvedBy` khác NULL + `approvedDefHash` NULL; thiếu tag / không đọc được ⇒ không đóng dấu, liệt kê riêng; một giao dịch, một dòng audit `approve_def_hash_tofu` / luật ("TOFU 0434"); idempotent. Chỉ chạy trên TEST. | `126f96a87` |
| **(3)** §4 | thứ tự 0434 → backfill (chạy khô, rà, `--ghi`) → build; giới hạn TOFU (status quo trước R1b-1) + rà luật bảo vệ tuần đầu | commit chữ báo cáo này |
| **I-A** | AI `machine_stop` + cổng mức AI `mucKenhChoAi` dùng CÙNG luật STOP HMI (`phanLoaiGhimStopHmi`, một helper cho `dungMay` / AI / `khaNangDung`): bỏ qua + báo ghim tag mức > 1 / chưa khai, từ chối khi không ghim nào đủ điều kiện; câu SAI ở §6 mục 2 sửa; §4 mục 2c truy vấn rà ghim cũ (TEST 66 hàng rác lưới) | `b8d541286` |
| **I-B** | approve / enable / disable thôi ghi đè `updatedBy`; SoD so với người sửa NỘI DUNG cuối (audit create/update; không audit ⇒ `updatedBy`); không migration | `2ca1f1e34` |
| **I-C / (5)** | `kiemSchemaR1a` kiểm cột 0434 (khuôn 0433): `/health` degraded + "0434", khối lỗi, nhắc 5 phút; §4 mục 1 sửa hậu quả (chặn MỌI lệnh ghi HITL trên MỌI adapter) | `5d2e22458` |
| **m-1** | `datStopPin.kiemCuoi` bắt buộc (thiếu ⇒ lỗi biên dịch) | `b8d541286` |
| **m-2..m-6** | backlog R1b-2a §10 mục 23–27 (+ mục 22: STOP do hệ thống khởi phát vẫn ghi mọi ghim) | commit chữ báo cáo này |

**Đột biến (đỏ rồi hoàn tác):** TOFU — chạy khô vẫn ghi ⇒ đỏ 1, không bỏ qua tag vắng ⇒ đỏ 3, bỏ canh `IS NULL` ⇒ đỏ 1; I-A — tool gửi mọi ghim ⇒ đỏ 2, cổng
mức dùng mọi ghim ⇒ đỏ 1; I-B — approve ghi lại `updatedBy` ⇒ đỏ 1, SoD dùng `updatedBy` thô ⇒ đỏ 1; I-C — `thieu0434` luôn rỗng ⇒ đỏ 1.

**Đo (2026-10-25, trên `126f96a87`):** không-DB (`server/_core`, `services/scada|ot|interlock|aiLocalTools`, `aiCopilotActions`, router interlock* /
deviceAdapter* / scadaCommands* / scadaDiag* / scadaKenh* / aiCopilot*, client scada + DeviceAdapterManagement + InterlockRuleManagement, `scripts/lib`)
284 tệp 4322 qua / 13 bỏ qua / 0 đỏ · DB tuần tự (interlock*, stopPin, scadaCommands*, deviceAdapter*, aiCopilot*, aiLocalTools, kiemSchemaR1a,
commissioningRouter.recheck, commandDispatcher, safetySimOnly, scadaKenh, adapterPhamVi, engineeringAssignment) 35 tệp 640 qua / 4 đỏ ⇒ chạy lại
riêng: 2 đỏ có sẵn `engineeringAssignment.db` (§13 trên), `stopPin.contention.dot5` + `engineeringAssignment §12` xanh (đỏ do tải — lô chạy cùng
census) · census 58 tệp 978 qua / 3 bỏ qua / 0 đỏ · tsc (12 GB) 0 lỗi · i18n sạch.

## 14. Kết luận kiểm định lại (kiem-dinh, 2026-10-25, tip f811ba2c9): ĐẠT — không lỗi chặn gộp

**Bốn điều kiện triển khai** (bắt buộc, theo thứ tự):
1. Áp 0434 → backfill TOFU (dry-run, rà bảng, rồi `--ghi --actor`) → build / restart (§4 mục 1).
2. Đo TRƯỚC khi bật:
   - §4 mục 2b (I4): census OFF_STEP trên tag int, chạy trên PRODUCTION;
   - §4 mục 2c: rà / gỡ ghim STOP cũ trên tag mức > 1 hoặc chưa khai mức.
3. Sau backfill, các luật có nguồn `ot_telemetry` hoặc có tag nguồn / đích vắng sẽ ở trạng thái "Cần duyệt lại" ⇒ đưa vào danh sách việc triển khai; admin duyệt lại từng luật.
4. Tuần đầu sau triển khai: admin rà lại các luật bảo vệ.

**Giới hạn đã biết** (backlog R1b-2a). Băm định nghĩa duyệt (`approvedDefHash`) KHÔNG phủ:
- nguồn `ot_telemetry` (luật `telemetry_tag` không có tag thiết bị);
- host / port / giao thức / tuỳ chọn kết nối của adapter (chỉ phủ `edgeNodeId`);
- `writable` / `actuationLevel` của tag đích.

Lọc ghim cho STOP do HỆ THỐNG kích (chuyển chủ, edge nhả) = R1b-2a §10 mục 22. Hiện các STOP này vẫn gửi mọi ghim; §4 mục 2c bao phần ghim cũ.
