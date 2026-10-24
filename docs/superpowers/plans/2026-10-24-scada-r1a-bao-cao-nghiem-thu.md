# SCADA R1a · Điều khiển lõi — Báo cáo nghiệm thu (Task 15)

Ngày đo: 2026-10-24 · nhánh `feat/scada-r1a` (worktree `D:\SOURCES\_scada_wt`), gốc đo `2b7ff1e2d` · máy Windows 11, Node 24.18.0,
Docker Desktop engine 29.8.2 (linux) · CSDL `aoi_management_test` (PG :5434). Không đụng :3000 / :8091 / GPU. Không push.

Mọi số dưới đây là **đo thật** (khẳng định của test hoặc dòng in của bench). Không ô nào được khai "đạt" mà không có phép đo; không nới
ngưỡng nào. `OT_CONTROL_ENABLED` / `AI_OT_CONTROL_ENABLED` chỉ được đặt trong tiến trình test/bench (D9).

## Kết luận ngắn

| Phần | Kết quả đo |
|---|---|
| Ma trận 8 ô + đọc lại lệch (`r1aNghiemThu.db.test.ts`, stub + safety PLC mô phỏng + CSDL `_test`) | **8/8 ô đúng mã và đúng số dòng WORM**, cộng 2 ô đối chứng: 10/10 test, **4 lượt tuần tự 4/4** |
| Đột biến cấp hệ thống (2) | Cả hai làm đỏ đúng ô mong đợi (ô 2 phần dispatch; ô 7) |
| Bench OpenPLC (`scripts/scada-r1a-bench.ts`, 3 lượt) | **15/15 bước ĐẠT**: đường vui `acked_verified` (đọc lại đúng) 3/3, ô 2 (request + dispatch) 6/6, ô 3 (request + dispatch) 6/6 |
| Chạy toàn bộ (lô SCADA/OT/interlock/_core/client SCADA) | 223 tệp, 3167 test: 3126 qua, 38 bỏ qua, **3 đỏ**: census của `server/_core` trên `trpcGioiHanThuTuc.ts:115`, quy cho commit main `ac5c5cf63` bằng đọc mã, chưa đo trên main (xem §5) |
| Tệp DB của R1a chạy tuần tự | 13 tệp, 225/225 |
| `npm run check` | xanh (rc 0); hai tệp mới (bị tsconfig loại) kiểm riêng bằng tsc: 0 lỗi |

**Đánh giá:** mọi cổng của R1a đều từ chối đúng mã và ghi đúng dòng WORM trên đường sản phẩm thật. Đọc lại lệch tới được người vận hành
(`acked_unverified` + `readBackValue` trong sự kiện `scada:cmd`). Đường vui ghi được và đọc lại đúng trên PLC thật (OpenPLC). Ba census đỏ
được quy (bằng đọc mã, chưa đo trên main) cho dòng đến từ main, không phải mã R1a. Phân xử thuộc điều phối (chủ: luong-ui).

**Sửa sau rà soát cuối (final fix, 2026-10-24):** I-1 `scadaCommands.confirm` ra khỏi nhóm giới hạn 2FA (miễn trừ có lý do trong census) + M5 hiện
429 là "Không gửi — vượt giới hạn tần suất, thử lại sau"; I-2 confirm HMI truyền `queueTtlMs` (chỉ hạn chờ hàng đợi), không truyền `deadlineMs`
(hạn ack/đọc lại = `OT_CONTROL_TIMEOUT_MS`), còn < 3 s ⇒ `HET_HAN`; I-3 đường HMI `write_tag` KHÔNG phải đường STOP (§6, §7, §8); M-3 confirm kiểm
TOTP SAU cổng 3–7. Chi tiết, bằng chứng đỏ/xanh và đột biến: `.superpowers/sdd/2026-10-24-scada-r1a-dieu-khien/final-fix-report.md`.

---

## 1. Ma trận ô — `server/services/scada/r1aNghiemThu.db.test.ts`

**Chỉ chạy khi gọi tường minh (như R0):**
- Bash: `SCADA_R1A_NGHIEM_THU=1 npx vitest run -c vitest.db.config.ts server/services/scada/r1aNghiemThu.db.test.ts`
- PowerShell: `$env:SCADA_R1A_NGHIEM_THU='1'; npx vitest run -c vitest.db.config.ts server/services/scada/r1aNghiemThu.db.test.ts`
- Không đặt biến: cả tệp bị bỏ qua (đo được: 10 skipped).

**Đường chạy thật:**
- `scadaCommands.request/confirm` qua tRPC caller, người dùng tạo bằng `taoNguoiDungTest`. `ctx.user` được dựng từ hàng `users` hiện tại, nên cờ 2FA đọc từ DB như một phiên thật.
- Phạm vi do `idsTrongPhamVi` thật xác định, quyền `machine_control` thật.
- `lenhHmi` gọi `dispatch()` thật. Các cổng chạy thật: binding, kênh sớm 3b, chế độ 3c, commissioning (`OT_COMMISSIONING_REQUIRED=true`, adapter có hàng `commissioning_records` thật), preflight safety, interlock, đặt chỗ ghi trước, đọc lại `docLai:"bat_buoc"`.
- Thiết bị là StubDriver thật (RAM).
- Chế độ máy: `cheDoMay` thật trên bộ đệm thật.

**Safety PLC mô phỏng (D9):**
- Một hàng `safety_plc_configs` thật, backend `modbus`, phạm vi là trạm của máy thử, trỏ tới một PLC giả trong tiến trình (`modbus-serial` `ServerTCP`).
- Facade đọc bằng `ModbusDriver` thật. Không mock `safetyPlcAdapter`.
- Giữ khoá seed độc quyền (`acquireSeedExclusive`).

**Chỉ có ba chỗ giả:**
- `getActiveDriver` / `getActiveConnectionFingerprint`: trả về stub;
- `getIO`: ghi lại mọi emit;
- `dispatch`: được bọc để đếm số lần gọi, vẫn gọi xuyên qua mã thật.

**Đếm WORM theo khoá của tệp**, vì `_test` dùng chung với phiên khác: attempts theo `user_id` của người dùng tệp, `command_log` theo `adapterId` của adapter tệp.

"Dispatch AI trực tiếp" là `dispatch()` hitl với tool `set_machine_param` và dòng chờ AI đã xác nhận (đúng băm). Nó mô phỏng một bên gọi bỏ qua `request()`.

| Ô | Kích thích | Mã đo được | Dòng WORM tăng thêm (đo) |
|---|---|---|---|
| ĐC-A đối chứng | opA mức 3, `"245"` | `acked_verified`, `readBackValue` 245, thiết bị 1 lần | attempts +3 (request/proposed, confirm/confirmed, dispatch/dispatched) · command_log +2 (intent `sent` + result `acked_verified`) |
| ĐC-B đối chứng | coil e-stop của PLC giả = true | `rejected SAFETY_BLOCKED`, thiết bị 0 lần | attempts +2 · command_log +1 (`SAFETY_BLOCKED…`) |
| 1 kênh vào | `channel_kind='input'` (writable=true để dispatch tới được 3b) | request: `PRECONDITION_FAILED / SCADA_CHANNEL_READ_ONLY`; dispatch AI: `rejected CHANNEL_READ_ONLY`, thiết bị 0 | request: attempts +1 (`CHANNEL_READ_ONLY`), command_log 0 · dispatch: command_log +1 (`CHANNEL_READ_ONLY…`, tag `vao`), attempts 0 |
| 2 ngoài dải | 251, dải 240..250 bước 0.5 | request: `BAD_REQUEST / SCADA_VALUE_OUT_OF_RANGE {min 240, max 250}`; dispatch AI: `rejected OUT_OF_RANGE`, thiết bị 0 | request: attempts +1, command_log 0 · dispatch: command_log +1 (`OUT_OF_RANGE…`), attempts 0 |
| 3 LOCAL | kênh chế độ = 1 (REMOTE = 2) | request: `SCADA_MACHINE_NOT_REMOTE {lyDo khac_remote}`; `SCADA_CONG_CHE_DO_ENABLED=true` thì dispatch AI cho `rejected MODE_LOCAL`; **STOP ghim** (`stop dung=0` = `stop_value`) trên cùng máy LOCAL, cờ bật: `acked`, thiết bị 1 lần | request: attempts +1 · dispatch: command_log +1 (`MODE_LOCAL: khac_remote`) · STOP: command_log +2, không dòng nào `MODE_LOCAL`, attempts 0 |
| 4 người thứ hai | opB request kênh opA đang giữ | `CONFLICT / SCADA_TAG_SELECTED_BY_OTHER {DANG_DUOC_CHON, boiUserId=opA}` | attempts +1 (của opB), command_log 0 |
| 5 hết TTL | confirm sau `expiresAt` (đặt `expiresAt` = now−5 s trong DB) | `PRECONDITION_FAILED / SCADA_REQUEST_EXPIRED {HET_HAN}`, **dispatch 0 lần** | attempts +1 (confirm/expired/HET_HAN), command_log 0 |
| 6 interlock thiếu dữ liệu | luật `telemetry_tag` bật, đã duyệt, `block_downstream`, đích là adapter thử, nguồn không có mẫu | confirm → dispatch: `rejected INTERLOCK_BLOCKED`, errorText `INTERLOCK_BLOCKED: …thieu_du_lieu`, thiết bị 0 | command_log +1 · attempts +2 (confirm/confirmed, dispatch/dispatched kèm `INTERLOCK_BLOCKED`) |
| 7 đọc lại lệch | ghi 200, stub ép đọc lại 245 | `acked_unverified`, `ok:true`, `readBackValue` 245; sự kiện `scada:cmd` cuối tới `user:{opA}` mang `{status:"acked_unverified", readBackValue:245}` | command_log +2 (intent `sent` readBack null, result `acked_unverified` readBack 245) · attempts +2 |
| 8 chưa có 2FA gửi mức 4 | (a) engineer chưa đăng ký 2FA; (b) engineer có 2FA tạo yêu cầu mức 4 (`needsTotp`), rồi `disable2FA`, rồi confirm với mã TOTP đúng | (a) request: `SCADA_TOTP_NOT_ENROLLED {level 4}`; (b) confirm: `SCADA_TOTP_NOT_ENROLLED {TOTP_CHUA_DANG_KY, level 4}`; **dispatch 0 lần** qua cả (a) và (b) | (a) attempts +1 (request/rejected) · (b) attempts +1 (confirm/rejected), command_log 0 |

**Lượt chạy:**
- 4 lượt tuần tự `-c vitest.db.config.ts`, mỗi lượt 10/10 (lượt đầu 5,1 s cho phần test).
- Không đặt biến: 10 skipped.
- Sau mỗi lượt `_test` sạch: `scada_khoa_chon` 0, `scada_kenh_che_do` 0, `safety_plc_configs` còn đúng 3 hàng có sẵn (đều `sim`), 0 adapter/nhà máy/người dùng/dòng chờ/luật interlock/`commissioning_records`/`totp_khoa_sai` của tệp.

**Giới hạn của lưới:**
- Thiết bị là stub (RAM). PLC thật chỉ được đo ở bench (đường vui, ô 2, ô 3). Ô 1/4/5/6/7/8 chỉ đo trên stub/DB.
- Ô 5 dời `expiresAt` trong DB (khuôn Task 9), không chờ 60 s đồng hồ thật.
- Đọc lại lệch trên PLC thật chưa đo: bench không có chương trình PLC ghi đè thanh ghi (xem §3, bước 0).

## 2. Đột biến cấp hệ thống (Step 3) — chạy rồi hoàn tác; sau đó `git diff` rỗng

| Đột biến | Ô đỏ | Số đo |
|---|---|---|
| Tắt cổng dải trong `dispatch` (`congKenhSom` lượt 2: `if (!kq.ok && false) return tuChoi(…)`) | **ô 2 (phần dispatch)**, 1/10 đỏ | 251 tới thiết bị: `{"ok":true,"status":"acked","results":[{"tagKey":"sp_dai",…,"status":"acked"}]}`. Phần request vẫn `OUT_OF_RANGE` (cổng của `request()` độc lập), 9 test khác xanh |
| Bỏ `docLai:"bat_buoc"` ở `confirm` (`lenhHmi.ts:940`), `OT_READBACK_ENABLED=false` | **ô 7** + đối chứng A, 2/10 đỏ | ô 7: `{"status":"acked",…}`, không đọc lại nên **lệch bị giấu** khỏi người vận hành. ĐC-A: `acked` thay cho `acked_verified` |

## 3. Bench OpenPLC — `scripts/scada-r1a-bench.ts`

**Lệnh:** `npx tsx scripts/scada-r1a-bench.ts --lap 3`. Mặc định: `--endpoint tcp://127.0.0.1:15502 --container avi-openplc-bench
--web http://127.0.0.1:18080 --poll 1000 --timeout 800`.

**Bench:**
- Container `avi-openplc-bench`, ảnh `avi-openplc-bench:v3` (`sha256:180893084146519c837b7c54bfdf8a1b6b1174ba739390eac9256b0678ebf2df`, tạo 2026-10-14T05:51:00Z), Docker engine 29.8.2.
- Trạng thái ban đầu **exited**. Script `docker start`, đăng nhập web `openplc/openplc` và bấm Start, sau đó Modbus trả lời.
- Cuối cùng script `docker stop`: **trả về exited** (đo bằng `docker inspect` trước và sau).

**Cách đo (trong tiến trình, CSDL `_test`, không .env ngoài `DATABASE_URL`):**
- otManager thật (`startOt`, nhánh legacy) qua seam `setAdapterSource` trên ModbusDriver thật. Adapter cùng `id` với hàng `device_adapters` thật.
- Vòng poll thật nuôi bộ đệm, nên **kênh chế độ là tag poll trung tâm đọc từ PLC**: ô 3 ghi 1 vào thanh ghi chế độ bằng client riêng và chờ bộ đệm thấy giá trị đó.
- `scadaCommands.request/confirm` qua tRPC caller. Người dùng là admin tạo bằng `taoNguoiDungTest` (một resolve hook thay `vitest` bằng shim `afterAll` rỗng, vì helper nhập `afterAll`; dọn bằng `donNguoiDungTest()`).
- `dispatch()` trực tiếp như tool AI cho phần dispatch của ô 2/ô 3.
- Safety PLC giả trong tiến trình (khuôn `selfServer` của `scripts/safety-plc-bench.ts`) với hàng `safety_plc_configs` thật theo trạm.
- Adapter có `commissioning_records` thật. Các cờ in ở đầu lượt, gồm `OT_CONTROL_ENABLED=true` chỉ trong tiến trình và `OT_READBACK_ENABLED=false`.
- **Oracle độc lập:** một client Modbus riêng (kết nối mới) đọc thanh ghi trước và sau mỗi bước.

### 3.0 Bước 0: thanh ghi có giữ giá trị không (bắt buộc trước khi tin bench)

Phép thử: ghi FC06 một giá trị lạ, đọc lại ở +200 / +1000 / +2500 ms, rồi trả giá trị gốc.

| Thanh ghi (0-based) | Tag sản phẩm (1-based) | Ghi | Đọc @200/1000/2500 ms | Kết luận |
|---|---|---|---|---|
| 0..17 (`%QW0..17`) | `holding:1..18` | 12000+N | 12000+N ×3 ở cả 18 thanh ghi | **GIỮ** 18/18 |
| 1024..1027 (`%MW0..3`) | `holding:1025..1028` | 13024..13027 | bằng giá trị ghi ×3 | **GIỮ** 4/4 |

Runtime OpenPLC (chương trình `benchL2` không khai `%QW`/`%MW`) **không ghi đè** thanh ghi holding mỗi chu kỳ quét. Bench dùng
`holding:1` (reg 0) làm điểm đặt `sp` (int, dải 240..250, bước 1, mức 3) và `holding:2` (reg 1) làm kênh chế độ `che_do` (input, REMOTE = 2).

### 3.1 Kết quả (3 lượt)

| Lượt | Ô | Bước | Mong đợi | Đo được | ms | Thanh ghi (client riêng) | Kết quả |
|---|---|---|---|---|---|---|---|
| 1 | vui | request 245 (93 ms) + confirm | acked_verified, readBack = gửi, thanh ghi = gửi | acked_verified readBack=245 | 284 | 0 → 245 | ĐẠT |
| 1 | 2 | request 251 | OUT_OF_RANGE, thanh ghi không đổi | OUT_OF_RANGE | 25 | 245 → 245 | ĐẠT |
| 1 | 2 | dispatch AI 251 | rejected OUT_OF_RANGE, command_log +1, thanh ghi không đổi | rejected OUT_OF_RANGE · command_log +1 | 24 | 245 → 245 | ĐẠT |
| 1 | 3 | request 244 (chế độ=1 thấy sau 31 ms) | MODE_LOCAL, thanh ghi không đổi | MODE_LOCAL (khac_remote) | 21 | 245 → 245 | ĐẠT |
| 1 | 3 | dispatch AI 244, SCADA_CONG_CHE_DO_ENABLED | rejected MODE_LOCAL, command_log +1, thanh ghi không đổi | rejected MODE_LOCAL · command_log +1 | 13 | 245 → 245 | ĐẠT |
| 2 | vui | request 246 (43 ms) + confirm | acked_verified, readBack = gửi, thanh ghi = gửi | acked_verified readBack=246 | 130 | 0 → 246 | ĐẠT |
| 2 | 2 | request 251 | OUT_OF_RANGE, thanh ghi không đổi | OUT_OF_RANGE | 16 | 246 → 246 | ĐẠT |
| 2 | 2 | dispatch AI 251 | rejected OUT_OF_RANGE, command_log +1, thanh ghi không đổi | rejected OUT_OF_RANGE · command_log +1 | 11 | 246 → 246 | ĐẠT |
| 2 | 3 | request 244 (chế độ=1 thấy sau 343 ms) | MODE_LOCAL, thanh ghi không đổi | MODE_LOCAL (khac_remote) | 24 | 246 → 246 | ĐẠT |
| 2 | 3 | dispatch AI 244, SCADA_CONG_CHE_DO_ENABLED | rejected MODE_LOCAL, command_log +1, thanh ghi không đổi | rejected MODE_LOCAL · command_log +1 | 14 | 246 → 246 | ĐẠT |
| 3 | vui | request 245 (33 ms) + confirm | acked_verified, readBack = gửi, thanh ghi = gửi | acked_verified readBack=245 | 134 | 0 → 245 | ĐẠT |
| 3 | 2 | request 251 | OUT_OF_RANGE, thanh ghi không đổi | OUT_OF_RANGE | 17 | 245 → 245 | ĐẠT |
| 3 | 2 | dispatch AI 251 | rejected OUT_OF_RANGE, command_log +1, thanh ghi không đổi | rejected OUT_OF_RANGE · command_log +1 | 12 | 245 → 245 | ĐẠT |
| 3 | 3 | request 244 (chế độ=1 thấy sau 379 ms) | MODE_LOCAL, thanh ghi không đổi | MODE_LOCAL (khac_remote) | 17 | 245 → 245 | ĐẠT |
| 3 | 3 | dispatch AI 244, SCADA_CONG_CHE_DO_ENABLED | rejected MODE_LOCAL, command_log +1, thanh ghi không đổi | rejected MODE_LOCAL · command_log +1 | 12 | 245 → 245 | ĐẠT |

**Tổng: 15/15 bước ĐẠT.**
- Cột "ms" của đường vui là thời gian confirm, gồm dispatch, ghi FC06, đọc lại và ghi sổ: 284 / 130 / 134 ms.
- Request mất 93 / 43 / 33 ms.
- Có 14 hàng telemetry qua bus (seam đếm, không ghi DB).
- `acked_verified` trên PLC thật đồng thời chứng minh hai cổng đã thông: commissioning (không có thì `simulated`) và preflight safety qua PLC mô phỏng (không có PLC thật nào thì `SAFETY_SIM_ONLY`). Ô đối chứng ĐC-B ở §1 chứng minh trực tiếp rằng safety PLC giả nằm trong vòng.

**Giới hạn của bench:**
- Safety PLC là PLC giả trong tiến trình (D9), không phải safety PLC thật.
- Bench không đếm lệnh ghi ở phía thiết bị. Oracle là giá trị thanh ghi đọc bằng client riêng.
- Ô 1/4–8 không chạy trên bench.

## 4. Thứ tự triển khai (điều phối 2026-10-24)

1. **Migration 0431** (`drizzle/0431_scada_kenh_lenh.sql`): 7 cột `device_tags` + `scada_kenh_che_do` / `scada_khoa_chon` / `scada_command_attempts`.
   - Áp TEST ở Task 1 và DEV ngày **2026-10-24**, sau khi điều phối "ÁP"; kiểm (a)(b)(c) đều xanh.
   - **Thiếu 0431 thì TOÀN BỘ OT hỏng, không chỉ R1a.** Drizzle liệt kê đủ **24 cột** của `device_tags` (gồm 7 cột 0431) trong MỌI `select()`,
     `insert()` và `returning()` (kể cả `update(...).returning()`); chỉ `select({ cột })` chọn cột mới thoát. Vì vậy câu SQL lỗi "column does not
     exist" ở: khởi động OT (`deviceAdapter.ts:~98`, `select().from(deviceTags)` cho từng adapter), CRUD adapter và tag (`deviceAdapterRouter`),
     nhập mapping (`mappingAsCode`), telemetry (`telemetryBus`), cấu hình edge (`edgeConfigCentral`), `scadaDiag`, và bước 3 của `dispatch()`.
   - Đo không cần DB (lặp lại phép thử của người rà soát: drizzle `mock()` + `toSQL()`, schema thật của nhánh):
     ```
     SELECT liet ke 24 cot: select "id", "adapterId", "tagKey", "address", "dataType", "unit", "scale", "offset", "writable", "isEnabled", "deadband", "samplingMs", "cr ...
     INSERT liet ke 24 cot (cot vang => default): insert into "device_tags" ("id", "adapterId", "tagKey", "address", "dataType", "unit", "scale", "offset", "writable", "i ...
     select().from(deviceTags): cot moi 0431 trong SQL = 7/7 [channel_kind,display_name,display_format,write_min,write_max,write_step,actuation_level]
     insert(deviceTags).values({..toi thieu}): cot moi 0431 trong SQL = 7/7 [...]
     insert(...).returning(): cot moi 0431 trong SQL = 7/7 [...]
     update(...).set({unit}).returning(): cot moi 0431 trong SQL = 7/7 [...]
     select({tagKey}) (chon cot): cot moi 0431 trong SQL = 0/7 []
     ```
2. **Migration 0432** (`drizzle/0432_totp_khoa_sai.sql`, PK `(user_id, loai)`, `loai` ∈ {totp, backup}):
   - **PHẢI có trên MỌI DB TRƯỚC khi chạy bản build chứa T16.** `verifyTotpOnce` mới **FAIL-CLOSED** khi không đọc/ghi được `totp_khoa_sai`.
     Thiếu bảng thì **mọi người dùng có 2FA bị khoá ngoài**: đăng nhập trả 503, mọi step-up và mọi `twoFactor.*` thất bại, không đăng ký 2FA
     mới được, và admin có 2FA cũng không tự cứu được.
   - Áp TEST ở Task 16 và DEV ngày **2026-10-24** (ranh giới T14, sau "ÁP"; kiểm (a)(b)(c) đều xanh).
3. **Thứ tự bắt buộc: 0431 và 0432 trên MỌI DB, SAU ĐÓ mới chạy bản build.**
4. **Kiểm lại hôm nay (2026-10-24, chỉ đọc):** cả `aoi_management` (DEV) lẫn `aoi_management_test` đều có bốn bảng `scada_command_attempts`, `scada_kenh_che_do`, `scada_khoa_chon`, `totp_khoa_sai`; 7/7 cột R1a trên `device_tags`; PK `totp_khoa_sai` = `user_id,loai`.

## 5. Chạy toàn bộ (Step 6)

**Lô chính:** `npx vitest run server/services/ot server/services/scada server/services/interlock server/routers/scada* server/_core client/src/components/scada client/src/pages/Scada*`, cấu hình mặc định, chạy song song.
- **223 tệp** (218 qua, 3 đỏ, 2 bỏ qua là hai lưới nghiệm thu R0/R1a không đặt biến) · **3167 test** (3126 qua, 3 đỏ, 38 bỏ qua) · 122 s.
- **3 đỏ:**
  - `server/_core/buocDoiMatKhauMoiBeMat.test.ts`, `taiKhoanBiTatMoiBeMat.test.ts`, `thuHoiPhienMoiBeMat.test.ts`. Cả ba là census ∀ điểm xác thực và cùng báo `server/_core/trpcGioiHanThuTuc.ts:115 [phien]` (`sdk.verifySession(...)` dùng để lấy khoá giới hạn tốc độ theo người dùng, không kiểm cờ buộc-đổi-mật-khẩu, `isActive` hay sổ phiên).
  - Dòng đó được quy cho commit **main `ac5c5cf63`** (luong-ui, đã gộp vào nhánh ở `3d1df0573`) **bằng đọc mã, chưa đo trên main**; không phải mã R1a.
  - **Tất định**, không phải do tải: chạy riêng 3 tệp vẫn 3 đỏ / 49 qua.
  - Không sửa ở R1a (ngoài phạm vi). Báo điều phối, chủ: luong-ui.
- Không có đỏ do tải DB trong lượt này.

**Tệp DB của R1a**, chạy tuần tự `-c vitest.db.config.ts`: `totpKhoaSai.db` 36, `equipmentCommands.r1a.db` 26, `aiCopilotRouter.confirm.r1a.db` 11,
`interlockRouter.kenhDai.r1a.db` 6, `scadaCommandsRouter.request.db` 20, `scadaCommandsRouter.confirm.db` 28, `scadaKenhRouter.db` 24,
`commandDispatcher.cheDo.edge.r1a.db` 2, `commandDispatcher.cheDo.r1a.db` 28, `commandDispatcher.hanHangDoi.r1a.db` 9,
`commandDispatcher.kenh.edge.r1a.db` 3, `commandDispatcher.kenh.r1a.db` 25, `stopPin.dai.r1a.db` 7. Tổng **13 tệp, 225/225**.

**Tệp DB mới:** `r1aNghiemThu.db.test.ts`, chạy riêng 4 lượt, mỗi lượt 10/10.

**Kiểu:** `npm run check` xanh. `tsconfig` loại `*.test.ts`, còn `scripts/` không nằm trong `include`, nên hai tệp mới được kiểm riêng bằng một tsconfig tạm (đã xoá sau khi kiểm): 0 lỗi.

## 6. Giới hạn đã biết

**Phạm vi và đường lệnh**
1. **Phạm vi control = phạm vi xem (strict) + `machine_control.canEdit`, tới khi có C.8** (ruling R-3, điều phối đồng ý 2026-10-24). Không có phạm vi điều khiển riêng: ai xem được máy (theo cây) và có `machine_control.canEdit` thì ra lệnh được.
2. **Không có công thức ra:** `afterFormula` = giá trị yêu cầu. Bản xem trước M5 hiện cùng một số.
3. **Máy do edge sở hữu: `EDGE_CHUA_HO_TRO` tới R1c.**
   - Kênh chế độ trên adapter do edge sở hữu luôn `chua_co_mau`, nên máy luôn LOCAL.
   - `docLai` không đi theo đường edge.
4. Lệnh tới adapter stub ghi THÀNH CÔNG vào RAM (R0 mục 10). Lệnh DEV tới stub báo `acked_verified` dù không có thiết bị nào nhận.
4a. **Đường HMI `write_tag` KHÔNG phải đường STOP trong R1a** (không miễn LOCAL / khoá chọn / mức kênh dừng chưa khai = 5). Đường STOP ghim hiện
    có: AI `machine_stop` (ghim), route STOP của edge, hành động bảo vệ của interlock, E-STOP cứng. Gợi ý ở M5 nói đúng điều này (final I-3).

**T16 (bộ đếm TOTP sai)**

5. **Burst ở biên cửa sổ** TOTP / mã dự phòng (cửa sổ cố định 5 lần / 5 phút; mã dự phòng 10 lần / 60 phút).
6. **DoS khoá 2FA 5 phút** bởi người biết mật khẩu: cố ý nhập sai để khoá nạn nhân. Admin mở khoá được nhưng không tự mở cho mình.
7. **Dùng song song cùng một mã dự phòng** (double-spend, có từ trước): backlog R1b.
8. Nhật ký audit bị điều tiết (≤ 1 dòng / người / phút) nên báo thiếu cỡ của một đợt burst.
9. `verifyFreshTotp` gọi song song ≥ 6 lần cùng mã sẽ tự khoá. Hiện không có bên gọi nào làm vậy.
10. Vé đăng nhập bỏ qua ngân sách ở lượt gây khoá (chỉ ảnh hưởng hiển thị).

**Chế độ máy và hàng đợi**

11. **HMI cần `SCADA_LIVE_CACHE_ENABLED`.** Bộ đệm tắt thì mọi máy LOCAL (`bo_dem_tat`), nghĩa là mọi lệnh HMI bị chặn (fail-closed theo D3).
12. Tag chế độ trên adapter có deadband sẽ cũ sau 70 s, chuyển sang LOCAL `cu`. M12 có cảnh báo.
13. Kiểm chéo bộ đệm↔máy có thể cho LOCAL giả cho tới khi đăng ký adapter bắt kịp (hướng an toàn).
14. Adapter không gắn máy: khi cổng chế độ bật thì LOCAL `chua_khai`, tức người gọi qua adapter không gắn máy bị từ chối.
15. Khi cổng bật, `stop` / `e_stop` KHÔNG ghim bị từ chối ở LOCAL (D3). Chỉ STOP ghim và đường edge đi qua.
16. Mọi lệnh kiểu stop được miễn TTL hàng đợi, nên một stop không ghim đến muộn vẫn có thể chạy sau 60 s.
17. Job hết hạn vẫn giữ chỗ trong hàng tới lượt (có thể gây `BUSY`). TTL hàng đợi dùng đồng hồ tường (hướng hỏng an toàn): backlog R1b là đồng hồ đơn điệu.
18. `QUEUE_EXPIRED` nghĩa là không gửi. Dòng chờ chuyển `bi_tu_choi_ghi`; gửi lại cần yêu cầu mới.
18a. Confirm HMI (final I-2): hạn chờ hàng đợi = thời gian còn lại tới `expiresAt`, tính từ lúc CAS (đồng hồ đọc lại; T9 tính `conLai` từ đầu
     lượt gọi — nay chỉ còn dùng cho cửa sổ khoá). Hạn ack + đọc lại = `OT_CONTROL_TIMEOUT_MS` (HMI không truyền `deadlineMs`, nên
     `OT_CONTROL_TIMEOUT_MAX_MS` không áp cho HMI). Còn < 3 s ⇒ `HET_HAN`.
18b. tRPC `maxBatchSize`: giao luong-ui (main `ac5c5cf63`, batch ≤ 25 — đã xác nhận có trên nhánh).
18c. Chạy lại T1 (0431): `DROP CONSTRAINT` + `ADD CONSTRAINT` CHECK sẽ quét lại toàn bảng `device_tags`.
18d. T2 `laJsonThuan`: chi phí duyệt đồ thị (DAG) của giá trị JSON — chấp nhận, giá trị lệnh nhỏ.
18e. T8: kiểm chủ sở hữu edge của lenhHmi lặp với `adapterOwnedByEdgeInTx` của dispatcher (hai nơi, cùng kết luận).
18f. T12: kênh chế độ trên adapter do edge sở hữu chỉ được CẢNH BÁO (`canhBaoNguon`), không chặn.

**Xác thực theo mức**

19. Từ chối 2FA (`TOTP_CAN` / `TOTP_SAI` / `TOTP_CHUA_DANG_KY`) giữ khoá chọn tới ≤ 60 s. Chủ yêu cầu có thể `huy`.
20. Cache 2FA mức 4 dùng chung với `requireFreshTotp` của deploy (D5: "bước 2FA của phiên").
21. AI không bao giờ hành động ở mức ≥ 4 (`MUC_QUA_CAO` từ chối sớm). Thông điệp `MUC_QUA_CAO` ở confirm mới chỉ có tiếng Việt.
22. AI `machine_stop` trên máy chưa có tag STOP ghim: kênh dừng chưa khai mức được tính là mức 5, nên AI bị từ chối. Kỹ thuật phải đặt mức kênh dừng ở M12.
22a. T10 c1: một lệnh STOP ghim (kiểu stop + giá trị khớp `stop_value`) dùng mức của TOOL, không lấy max với mức 5 của kênh chưa khai.
23. `congOtLuong` (luồng AI) không có `adapterId`, nên chỉ dùng mức tool.

**Sổ và kiểu giá trị**

24. Lý do (`lyDo`) của yêu cầu bị TỪ CHỐI không được lưu (attempts chưa có cột `ly_do`): backlog R1b M9.
25. Dòng attempts `NOT_FOUND` do dò không có trần: backlog R1b.
26. `laTrungKhoa` coi mọi lỗi 23505 là gửi lại (fail-closed). Gửi lại có thể trả về yêu cầu mà khoá đã dời (UX).
27. Sparkplug Int64 (Long) trên kênh int đã khai bị `TYPE_MISMATCH` (fail-closed) tới R1b.
28. Stop của edge nêu tag thiếu hoặc không ghi được vẫn bị từ chối ở bước 3 (có từ trước R1a). Lỗi đọc chủ sở hữu trên stop bị từ chối nay ra `rejected` ở 3b thay vì `failed ADAPTER_OFFLINE` (cảnh báo vẫn phát).

**REST v1**

29. STOP ghim qua REST bị từ chối `NOT_CONFIRMED` (có từ trước; REST không phải đường an toàn).
30. Route REST nhận `adapterId` của client mà không kiểm phạm vi. Hiện an toàn chỉ vì HITL từ chối trước.
31. `ADAPTER_SDK.md` / doc 56 vẫn liệt kê route và sự kiện đó.

**Cấu hình**

32. `tags.update` (đổi `dataType` / `writable`) hoặc `mappingAsCode.import` có thể làm giá trị lệnh của luật interlock đang bật mất hiệu lực mà không ai kiểm.
33. `capNhat` đọc `adapter.machineId` để xét phạm vi mà không khoá (có từ trước).
34. M12: chưa có tìm kiếm bảng, chưa có cảnh báo deadband trước khi lưu cho tag ứng viên mới, còn ca biên ở ô chọn adapter mặc định. Kênh vào hiện mức 5 (chỉ ảnh hưởng hiển thị).
35. M5 / M4:
    - đồng hồ đếm ngược có thể chạy dài hơn một chút (máy chủ `HET_HAN` là biên thật);
    - faceplate vẫn hiện khi `SCADA_COMMANDS` tắt (chữ `FEATURE_DISABLED`);
    - `canHuyRef` không được gắn lại nếu instance M5 bị dùng lại (hôm nay không xảy ra);
    - `getAction` trả dòng `hmi.*` cho chủ (T10 vẫn từ chối cứng).

**Census và interlock**

36. Census còn lọt hai trường hợp: re-export `export *` của `ghiStepUpPhien`, và `runDispatch` gọi qua helper.
37. `aiCopilot.confirmAction` và `scadaCommands.confirm` cố ý nằm ngoài nhóm giới hạn 2FA (census ghi lý do). `aiCopilot.confirmAction`: sau
    T10 c2 nó không bao giờ kiểm TOTP. `scadaCommands.confirm` (final I-1, đảo ruling sau gộp): dò TOTP đã bị khoá T16 trong `verifyTotpOnce`
    chặn theo tài khoản (5 lần / 5 phút, tính lượt TRƯỚC khi xác minh nên batch không lách được); nhóm 20 / 15 phút chung theo IP và người với
    deploy / `twoFactor` sẽ bóp các lệnh đổi giá trị đặt HMI mức 1/3 thường ngày. M5 hiện 429 là "vượt giới hạn tần suất", không phải "không rõ".
38. Interlock trên nguồn báo-theo-sự-kiện (MQTT, deadband không heartbeat, edge…) đi đường DB với sàn tươi 15 s (R0 mục 8): giữa hai lần gửi, luật `cu` nên lệnh bị chặn `INTERLOCK_BLOCKED` (fail-closed).

## 7. Checklist bật cờ (trước khi bật điều khiển trên một hệ)

- [ ] **`SCADA_COMMANDS_ENABLED=true` BẮT BUỘC đi kèm `SCADA_LIVE_CACHE_ENABLED=true`.** Không có bộ đệm thì mọi máy LOCAL `bo_dem_tat` (máy chủ in WARN lúc khởi động — T8).
- [ ] **Kênh chế độ** của mỗi máy nên là **tag poll trung tâm**, không đặt trên nguồn deadband / edge / report-on-change (M12 cảnh báo nguồn). Nếu không, tag cũ sau 70 s và máy thành LOCAL `cu`; trên edge thì luôn `chua_co_mau`.
- [ ] **MỌI kênh dừng phải có mức 1 hoặc `stop_value` ghim** (điều phối 2026-10-24; M12 gắn cờ `canhBaoKenhDung`). Kênh dừng chưa khai mức là mức 5, khi đó AI không dừng được và người cần TOTP.
- [ ] **`OT_CONTROL_ENABLED` / `AI_OT_CONTROL_ENABLED` giữ OFF tới khi có safety PLC thật** (D9). ⚠ Đo hôm nay: `.env` của cây chính và của worktree đều có `OT_CONTROL_ENABLED=true` (dòng 586, có từ trước, kèm chú thích "none here"). Trái với dòng này. Task 15 không sửa `.env`; điều phối / chủ dự án quyết định.
- [ ] **Đặt `OT_CONTROL_TIMEOUT_MAX_MS`** (ruling T9) để chặn thời gian chờ ack của thiết bị im lặng cho bên gọi có `deadlineMs`. `.env.example` hiện để dòng này dạng chú thích. Đường HMI (final I-2) dùng `OT_CONTROL_TIMEOUT_MS` cho ack + đọc lại.
- [ ] **HMI chưa phải đường STOP tới R1b; dừng máy bằng E-STOP cứng / tủ máy / đường STOP ghim của AI-edge.**
- [ ] **Trước khi bật `SCADA_CONG_CHE_DO_ENABLED`:** rà mọi bên gọi `dispatch()` đang bật cờ (Sparkplug, interlock, tool AI…). Adapter không gắn máy hoặc máy chưa khai kênh chế độ sẽ bị từ chối `MODE_LOCAL` (`chua_khai`).
- [ ] `OT_COMMISSIONING_REQUIRED` giữ mặc định BẬT. Adapter cần hàng `commissioning_records` hiệu lực, nếu không lệnh chỉ `simulated`.
- [ ] Thứ tự migration theo §4: 0431, 0432 trên mọi DB trước bản build.

## 8. Backlog R1b

1. **ĐẦU TIÊN — test heartbeat deadband 60 s** (R0 mục 8).
2. Các mục còn mở từ backlog R0 (báo cáo nghiệm thu R0 "Backlog R1" + kế hoạch R1a "Nội dung R1b"):
   - `onSample` treo giữ `dangChay`; hạn cho ingest treo, đưa `soLanChong` vào bộ đếm;
   - callback ghi SLMP không kiểm danh tính;
   - EIP: Controller thiếu listener `'error'`; `timeout_sp` = `timeoutMs` (R0 giới hạn 7);
   - `danhSach` lộ endpoint / `lastError` cho `machine_status.canView`;
   - `ketNoiLai` không giới hạn tần suất, audit ngoài transaction;
   - tắt nóng `SCADA_SOCKET` không dập đăng ký;
   - chưa có trần tổng tag / người dùng;
   - nhãn "sim" cho lệnh stub trong sổ lệnh;
   - `ruleInput.partial()` đặt lại `cooldownSeconds` (zod 4);
   - luật `telemetry_tag` cũ ở phạm vi line / station vẫn chạy và chưa được đếm;
   - D11 cho `propose_interlock_rule` lúc `execute`;
   - "connected" chỉ sau lần đọc tốt đầu tiên (R0 giới hạn 2);
   - tắt sạch không ghi `disabled`;
   - Lab "thử đọc một địa chỉ";
   - chip "Truyền thông n/m";
   - C6 đọc khối Modbus;
   - heartbeat / nhịp cho nguồn ngoài OT trung tâm (R0 giới hạn 8);
   - đo mất / có lại liên lạc OPC UA (R0 giới hạn 9).
3. **Sparkplug Int64 (Long)** trên kênh int đã khai: nhận kiểu Long qua `toNumber` an toàn.
4. **FK `ON DELETE CASCADE` hoặc dọn mồ côi** cho `scada_kenh_che_do` / `scada_khoa_chon` khi xoá `machines` / `device_adapters`.
5. **REST v1:** trả **501 cho mọi lệnh OT không phải robot**, kiểm phạm vi / chủ sở hữu `adapterId`, và sửa `ADAPTER_SDK.md` / doc 56 cho khớp.
6. **M9 nhật ký `/scada/journal`**, gồm nợ phạm vi của `commandLogRouter` và **cột `ly_do` WORM của `scada_command_attempts` cho CẢ yêu cầu bị
   từ chối LẪN lệnh đã gửi** (hôm nay lý do của lệnh HMI ĐƯỢC chấp nhận chỉ nằm trong `ai_pending_actions.previewJson`, bảng sửa được).
7. **M4 "Điều kiện cho phép"** chạy khô (dry-run).
8. **`tags.update` / `mappingAsCode.import`** kiểm lại giá trị lệnh của luật interlock đang bật.
9. **i18n `MUC_QUA_CAO`** (vi/en/zh) ở confirm.
10. **`congOtLuong`** dùng mức kênh (cần `adapterId` trong luồng AI).
11. **Giới hạn tần suất các dòng attempts `NOT_FOUND`** do dò.
12. **Đồng hồ đơn điệu** cho TTL hàng đợi lệnh.
13. Chặn **dùng song song cùng một mã dự phòng** (double-spend).
14. Audit khi bị điều tiết phải báo đúng cỡ đợt burst.
15. Census: bắt re-export `export *` của `ghiStepUpPhien`, và `runDispatch` gọi qua helper.
16. M12: cảnh báo deadband trước khi lưu cho tag ứng viên mới; tìm kiếm bảng; ca biên ô chọn adapter mặc định.
17. Kiểm phạm vi `capNhat` có khoá (`adapter.machineId`).
18. **Lệnh STOP HMI riêng** (kiểu stop, giá trị ghim, mức công cụ, ngoài khoá chọn và bộ giới hạn) — final I-3.
19. Gộp hai kiểm chủ sở hữu edge (T8 lenhHmi và `adapterOwnedByEdgeInTx`) về một nơi.

## 9. Backlog R4

- **Control scope tách khỏi view scope** (C.8): phạm vi điều khiển riêng, không suy từ phạm vi xem + `machine_control.canEdit`.

## 10. Commit R1a

Nhánh `feat/scada-r1a`, gốc là main `da520b932`. Gộp main một lần ở ranh giới T14/T15: `3d1df0573` (main `ac5c5cf63`, sạch).

- **Kế hoạch / điều phối:** `b0bb45448`, `0b9a09873`, `9129fe353`, `68dd371b3`, `82b7a638d`, `034b6b215`, `ee2e36df6`, `c549b0061`, `e95958076`, `0668e2f1c`, `81d954363`.
- **T1** mig 0431: `9fb60d185`, `211d2d606`.
- **T2** kenhScada: `648fd75d4`, `562c2b553`.
- **T3** cổng kênh / dải trong dispatch: `468dcea93`, `d7b888d2b`, `8df8111a4`.
- **T4** chế độ máy + cổng 3c: `0960b3ab6`, `85425f13a`.
- **T5** đọc lại bắt buộc + TTL hàng đợi: `cd4c92243`, `f77b67dc5`.
- **T6** khoá chọn: `7e8a83c30`.
- **T7** xác thực theo mức: `80b5fbaa6`, `4d149497e`.
- **T8** request: `dc4422e7e`.
- **T9** confirm / huy / trangThai: `5fbec6395`, `3276e9ab2`, `b69c5a447`.
- **T10** AI confirmAction: `c5d9d3404`, `7bafa4093`.
- **T11** REST v1: `91e7f94aa`, `a65445567`.
- **T12** router M12: `991b8d533`, `721852ea4`.
- **T13** màn M12: `21c584ac8`, `c6e2422e7`.
- **T16** bộ đếm TOTP (mig 0432): `252e1e171`, `142513898`.
- **T14** M4 / M5: `a188a4f2f`, `e4cce1d7d`.
- **Sau gộp:** `2b7ff1e2d` (`scadaCommands.confirm` vào nhóm giới hạn 2FA + census).
- **T15:** commit chứa báo cáo này (`test(scada): nghiem thu R1a - ma tran 8 o, bench OpenPLC + safety PLC mo phong, bao cao`).
- **Final fix (sau rà soát cuối):** `e3bde8aee` (I-1), `913269e54` (I-2), `eb98815a2` (M-3), và commit I-3 / M-1 / M-2 / T15-minor chứa bản sửa báo cáo này.

**Migration:**
- **0431** (`scripts/apply-migration-0431.mjs`): TEST ở T1; **DEV 2026-10-24**, sau điều phối "ÁP".
- **0432** (`scripts/apply-migration-0432.mjs`, PK đã sửa ở fix round T16): TEST ở T16; **DEV 2026-10-24**, ranh giới T14.
- Cả hai đã kiểm lại có mặt trên DEV và TEST hôm nay (§4).

## 11. Bàn giao

- Không push. `.env.example` đã có đủ `SCADA_COMMANDS_ENABLED` và `SCADA_CONG_CHE_DO_ENABLED` (mỗi cờ một dòng mô tả), nên không sửa.
- Container bench trả về **exited** như lúc tìm thấy. `_test` sạch, chỉ còn các hàng WORM (`command_log`, `scada_command_attempts`) của lưới và bench, đúng thiết kế.
