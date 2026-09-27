# Phụ lục BE2 — Tầng Điều khiển & Lập trình: mức sẵn sàng ghi xuống thiết bị THẬT

> Thuộc doc 81. 2026-09-27 · chỉ đọc repo + DB (SELECT, `read_only=on`) + thử nghiệm với **server giả tự viết** chạy mã driver/adapter sản phẩm (T1–T6). Số thô (ngoài repo): scratchpad phiên `B2-control/` (`db*-raw.txt`, `t1-techman-raw.txt` … `t6-mqtt-anon-raw.txt`, `vitest-control.txt`).
> Thang mức: **M0** không có · **M1** khung/stub · **M2** cài thật + test mock · **M3** chạy thật end-to-end với giả lập qua mã sản phẩm · **M4** chứng minh trên thiết bị thật (FAT) · **M5** sẵn sàng sản xuất.

## Kết luận

**Hôm nay KHÔNG có đường nào ghi được xuống PLC / bộ điều khiển chuyển động / robot thật. Toàn tầng ở M1–M2; không thành phần nào đạt M3 qua đường sản phẩm đầy đủ** (cao nhất: driver SLMP đúng với PLC giả ở tầng driver).

Thứ đang giữ an toàn hôm nay chủ yếu là **DỮ LIỆU CHƯA ĐIỀN + môi trường thiếu thiết bị**, không phải hàng rào: 0/42 tag `writable`; không bộ mô phỏng OT nào đang nghe (4840/5020/1102/44818); `koffi` chưa cài. Trong khi đó các cờ đã MỞ: `OT_CONTROL_ENABLED`, `ROBOT_CONTROL_ENABLED`, `DPC_DEPLOY_ENABLED`, `SPARKPLUG_COMMAND_ENABLED` = true; 9 adapter + 3 robot đã "commissioned" bằng bản ghi seed (`SIM-FAT-*`, `FAT-SEED-001`, người ký id 1, không hết hạn).

**264/264 test mock của đường điều khiển (23 tệp) xanh nhưng không bắt được lỗi nào trong 5 lỗi mà thử nghiệm với thiết bị giả lộ ra** (vd test checksum Techman so hàm với chính nó — `techman.test.ts:152-165`; test HIL dùng bộ điều khiển giả trả "đang chạy").

## Số đo DB

| Bảng | Hiện trạng |
|---|---|
| `command_log` | **0** — chuỗi cổng dispatcher chưa từng chạy trên dữ liệu thật |
| `program_deployments` | 3, đều `staging/simulated` (seed); `audit_logs` `programming.deployBuild` thất bại 3/3 |
| `robot_jobs` | 1 `rejected` |
| `ai_pending_actions` | 0 cho tool điều khiển; **594 hàng `executed/confirmed` của công cụ lập trình AI** |
| `orchestration_run_steps` | 11 bước `command` ghi `{"ok":true}` nhưng 0 dòng `command_log` (kết quả do seed) |
| `interlock_rules` | 1 rule action `alert` ⇒ cổng interlock trực tiếp không chặn gì |
| `safety_plc_configs` | 1 config backend `sim` ⇒ kiểm tra an toàn trước khi ghi đọc "OK" từ giả lập |
| `parameter_guardrails` | 0 |

## 1. Tầng × thành phần

### L2 — Đường lệnh

| Thành phần | Mức | Giữ đúng | KHÔNG giữ |
|---|---|---|---|
| **commandDispatcher (OT)** `server/services/ot/commandDispatcher.ts` | M2 | fail-closed mất DB; tag `writable` (:542); commissioning hạ về simulated (:580); interlock fail-closed (:668-690); mọi nhánh có sổ | **HITL chỉ chạy khi có `actionId`** (:463); **bản ghi HITL không gắn với lệnh** — chỉ kiểm status + `userId===confirmedBy` (:472-475), không kiểm tool/tham số/adapter ⇒ 594 hàng tái dùng được; **idempotency SELECT-rồi-ghi, sổ ghi SAU khi ghi thiết bị** (:494-515, :852-881) ⇒ 2 lượt cùng khoá đều ghi; chết giữa hai bước ⇒ ghi mà không có sổ (đọc mã); an toàn `UNKNOWN` vẫn cho qua (:660) |
| **robotCommandDispatcher** | M2 | commissioning, interlock, cổng chế độ | **không kiểm safety-PLC trước khi chạy**; `triggerKind:"manual"` bỏ qua HITL (:181); `record()` nuốt lỗi insert (:159-162) ⇒ có thể chuyển động không sổ; **timeout ghi `failed` nhưng không gửi abort** (:336-349); interlock dùng `adapterId:-1, machineId=robotId` (:319-323) |
| HITL `ai_pending_actions` | M2 | kiểm chủ sở hữu | FOE tự cấp `confirmed` cho mọi bước (`foeEngine.ts:772-775`) |
| Cổng interlock trực tiếp | M2 | fail-closed khi lỗi | `telemetry_tag` đọc historian, **không kiểm độ tươi**; thiếu dữ liệu ⇒ không vi phạm (:100-121); nguồn là chỉ số chất lượng, không phải điều kiện cho phép (cửa/guard/home); Mitsubishi truyền `machineId: adapterId` (`mitsubishiEngineeringAdapter.ts:167`) |
| Commissioning (`OT_COMMISSIONING_REQUIRED` mặc định BẬT) | M2 | hạ về simulated khi chưa commission | bản ghi **không gắn endpoint/serial/cấu hình** (đổi IP vẫn "commissioned"); một admin tạo được, `fatReference` tuỳ chọn (`commissioningRouter.ts:77-100`); robot commissioning chỉ ghi được bằng SQL |
| `command_log` WORM | M2 | INSERT+SELECT, RLS FORCE | ghi SAU khi ghi thiết bị |
| Step-up 2FA | M2 | `deployProcedure` OTP tươi | `AUTH_2FA_BAT_BUOC=0` ⇒ `require2FA` rỗng (`_core/trpc.ts:421`) ⇒ `robot.actuate` **không 2FA**; dispatcher không kiểm 2FA |
| Đọc lại sau ghi | M2 | có mã | `OT_READBACK_ENABLED` vắng ⇒ tắt; lệch chỉ cảnh báo, `ok` vẫn true |
| Safety-PLC / e-stop | đọc trước: M2 (sim) · trigger e-stop: **M1** | trung thực | đọc **mọi** config, **không theo máy đích** (`adapterFacade.ts:150-175`); Pilz/Sick là khung `isRated=false` |
| Giới hạn tần suất / tuần tự | M1–M2 | — | `OT_CMD_SERIALIZE_ENABLED` tắt; chỉ trong một tiến trình |
| REST `/api/v1/equipment/:id/commands` | M2 | luôn `NOT_CONFIRMED` (fail-closed) | `args.adapterId` người gọi chọn |
| **Sparkplug DCMD** (ĐANG BẬT) | M2 | tag writable + commissioning vẫn áp | **T6: EMQX :1884 cho CONNECT ẩn danh**; HITL không actionId ⇒ cổng 1 cho qua; `confirmedBy=0` |
| Cổng AI `aiControlGate.ts` | M2 | đóng (`AI_OT_CONTROL_ENABLED` vắng), fail-closed | — |
| Audit miền | M1 | — | `control_audit_log` 1 hàng; deploy/duyệt/FOE không ghi |

### L3 — Deploy chương trình

| Thành phần | Mức | Ghi chú |
|---|---|---|
| programmingService `computeDeploy` | M2 | rollback trung thực, giữ chỗ, CAS (Đợt 0). **WS-02 vẫn mở** (`:410-418`, adapter mất `meta`) ⇒ T3; **FLOW-02 vẫn mở** (`confirmedBy`/`actionId` do client, `programmingRouter.ts:457-488`); `staging` không SoD mà vẫn ghi thật |
| verify-after-download | thực chất **M1** | không adapter nào đọc lại được ⇒ `verified` không bao giờ đạt |
| **zmotion-basic** | validate M2 · deploy **M1** | `zauxFfi.ts` có binding; DLL x64 ở `D:\SOURCES\AI Local\Manual\Zmotion\Zmotion DLL\` (ngoài repo); `koffi` chưa cài; `ZAUXDLL_PATH`/`ZMC_ENDPOINT` chưa đặt. **T3**: qua service luôn "No compiled .bas file path". **Đi vòng dispatcher/interlock/commissioning**; FFI đồng bộ chặn event loop, không timeout |
| **mitsubishi-engineering** | đẩy tham số M2 (luôn fail vì WS-02) · tải chương trình **M0** | không wrap GX Works3/MX Component |
| **robot-tm** | **M1 — nói sai** | **T1-F: job "program download" gửi đúng `ScriptExit()` rồi ghi `deployed`** |
| iec61131 → OpenPLC | deploy **M0** | luôn `failed`; không có client HTTP OpenPLC |
| ir-flow + HIL | deploy luôn `simulated`; HIL M2 **có lỗi** | **T2: HIL PASS cho URScript hỏng** (`running=false`) — `accepted = running OR robotmode~RUNNING` (`ursimHarness.ts`, `hilGate.ts`), sau power on + brake release robotmode luôn RUNNING |
| gcode | M0 | — |
| Rollback | M2 | Đợt 0 |
| Fleet canary `fleetRollout.ts` | M2 | **`simulated` tính là ĐẠT** (`:137`) ⇒ canary chưa commission "đạt" ⇒ promote sang máy đã commission, **ghi thật** |

### L3b — Giám sát, recipe, điều phối

- **Watch** M1 — nguồn mặc định `[]` (`engineeringStream.ts:110-120`). **Force** M0.
- **Đẩy recipe** M2 — mô hình pull (shadow + MQTT retained `synapse/v1/machine/{code}/config/recipe`, `machineRecipeRouter.ts:115-140`); `CONFIG_SYNC_GENERIC` tắt ⇒ deploy chỉ lật DB.
- **FOE dispatch** M2 — tự cấp HITL; bước seed "ok" không có sổ.
- **VDA 5050** M2 — 0 AMR; "done" = PUBACK của broker; order có thể publish 2 lần (`vda5050Adapter.ts:272-305` + `vda5050Driver.ts:165-190`, đọc mã); `robot_jobs` ghi `done` trước khi publish thất bại.
- **UR bridge** M2 — `done` ngay khi ghi TCP xong.
- **`simTargets.validateUrscript` — ĐƯỜNG VÒNG NGUY HIỂM:** `host` do người gọi tự điền (`simTargetsRouter.ts:29-34`); sản phẩm tự gửi `power on` + `brake release` rồi script; chỉ cần `machine_control/canCreate` + `URSIM_ENABLED`, **không qua dispatcher/interlock/commissioning/HITL/sổ**. `ursimPing` (quyền XEM, không gác cờ) mở TCP tới host:port bất kỳ.
- **TcpLineClient** (MELFA/Delta) M2 **có lỗi** — **T4: sau một lần timeout mọi reply lệch một nhịp vĩnh viễn** (`B:MOVE` nhận reply của `A:STOP`).

## 2. Theo loại thiết bị — hôm nay ghi được không?

| Thiết bị | Ghi tag/lệnh | Tải chương trình | Việc tối thiểu tới M4 |
|---|---|---|---|
| **Mitsubishi** FX5U/iQ-R/Q | **Chỉ giả lập, tầng driver** — SLMP tự viết (`node:net`), **T5 frame 3E đúng đặc tả**, xử lý end-code 0xC051, từ chối ghi X0 | **KHÔNG** | vá WS-02; tag writable + guardrail; commissioning gắn endpoint; readback; bench FX5U; FAT. Chỉ đẩy tham số, **không tự tải ladder** |
| **Siemens** S7-1200/1500 | **KHÔNG** (`nodes7` 0.3.18 chưa chạy) | **KHÔNG** (không TIA Openness) | ưu tiên OPC UA server của S7-1500 + PLCSIM Advanced |
| **Omron** NJ/NX | **KHÔNG** (`st-ethernet-ip` hướng Logix, chưa kiểm); CJ/CP FINS M0 | KHÔNG | CIP tag trên NX1P thật hoặc OPC UA của NX |
| **Zmotion ZMC** | không có đường tag | **KHÔNG** (T3) | vá WS-02; đưa deploy qua cổng ghi chung; FFI trong worker có timeout; lệnh đọc lại/CRC; ZDevelop ảo → ZMC thật |
| **Techman** | **KHÔNG an toàn để thử** — checksum TMSCT **sai** (ví dụ tài liệu `…*08`, mã sản phẩm ra `7E`); **mọi** reply kể cả `$CPERR`/`ERROR`/đóng kết nối ⇒ `done` (T1 B/C/D); bảng Modbus giả định | **KHÔNG** — gửi `ScriptExit()` | sửa checksum; parser TMSTA/ACK; định nghĩa lại "deploy"; danh sách trắng script (`robot.actuate` cho `params.script` tuỳ ý — T1-G); FAT tốc độ giảm |
| **UR** | chỉ giả lập (URSim không chạy) | IR→URScript luôn `simulated` | sửa `accepted`; đọc `safetystatus`; khoá `validateUrscript` về host URSim đã đăng ký; URSim ⇒ M3 |
| **OpenPLC** | Modbus (driver sẵn) | **M0** | client webserver (login/upload/compile/start) + docker ⇒ **đích nhanh nhất để chứng minh deploy chương trình end-to-end** |
| **AMR VDA 5050** | chỉ giả lập | — | ACK qua topic `state`; `cancelOrder`; broker có xác thực; AGV simulator ⇒ M3 |

## 3. Hồ sơ an toàn

**Chuỗi lớp (đường OT):** (1) procedure tRPC — sàn vai + quyền, 2FA tắt ngoài `deployProcedure` → (2) cổng AI (đóng) → (3) service chương trình: đã duyệt → build ok → SoD (chỉ production) → Simulation Gate → adapter → (4) dispatcher: HITL (nếu có actionId) → idempotency → tag writable → driver kết nối → `OT_CONTROL_ENABLED` → commissioning → policy → safety-PLC đọc trước (`UNKNOWN` cho qua) → interlock → ghi (timeout 5 s) → [readback tắt] → (5) thiết bị: RUN/PROG, khoá, **mạch an toàn cứng trên safety PLC có chứng nhận — lớp DUY NHẤT có SIL/PL**. Robot: không có bước safety-PLC. Zmotion: **bỏ hết bước 4**.

**Chỗ một lỗi đơn lẻ vẫn có thể làm chuyển động:**

| # | Kịch bản | Lớp còn chặn hôm nay |
|---|---|---|
| S1 | Client MQTT ẩn danh vào EMQX :1884 publish DCMD tên tag ghi được | chỉ dữ liệu (0 tag writable) — **một câu `UPDATE device_tags` là mở** |
| S2 | Bật `URSIM_ENABLED`, trỏ `validateUrscript` tới IP UR thật | **KHÔNG CÓ** — power on + nhả phanh + script tuỳ ý |
| S3 | Cài koffi + đặt `ZAUXDLL_PATH`/`ZMC_ENDPOINT` (+ vá WS-02) | chỉ DPC + `confirmedBy` client gửi |
| S4 | Tái dùng actionId `executed` của mình + `confirmedBy`=mình + `staging` | chỉ OTP tươi |
| S5 | Robot timeout | ghi `failed`, robot vẫn chạy, **không gửi stop** |
| S6 | Techman/UR báo `done` trên NACK | người vận hành tin đã chạy |
| S7 | MELFA/Delta sau 1 timeout | ACK gán nhầm lệnh |
| S8 | Commissioning seed không hết hạn, không gắn endpoint | đổi IP vẫn "đã FAT" |
| S9 | Safety-PLC đọc sim "OK" | cổng an toàn qua nhờ dữ liệu giả |

**Tiêu chuẩn đòi thêm (IEC 61508/62061, ISA-84/IEC 61511, IEC 62443, ISO 10218/TS 15066, ISO 3691-4):** phần mềm này là **BPCS, không SIL**; chức năng an toàn nằm trên safety PLC có chứng nhận, e-stop nối cứng (IEC 60204-1, ISO 13849 Cat 3/4), hồ sơ chứng minh độc lập không dựa vào phần mềm này; HAZOP/LOPA, SRS, tách BPCS–SIS; quản lý bypass có hạn; MOC gắn ECN (ECN chưa nối xuống deploy); phân loại công cụ (bộ sinh mã/transpiler T2/T3); V&V độc lập; IEC 62443 zone/conduit, xác thực broker, danh sách trắng lệnh; robot: tốc độ giảm, safety-rated monitored stop, enabling device; tải chương trình từ xa: khoá RUN/PROG phía thiết bị, phê duyệt hai người gắn **nội dung** đã xem.

## 4. Kế hoạch HW-FAT đường điều khiển

Điều kiện: bàn thử mạng cách ly; safety PLC nối cứng; e-stop kiểm được; LOTO; người quan sát; pcap tại cổng thiết bị; commissioning gắn endpoint + serial.

| Nhóm | Ca thử | Tiêu chí đạt |
|---|---|---|
| F0 Cấu hình | đổi endpoint sau commissioning; bản ghi hết hạn; người ký = người yêu cầu | tự hạ simulated; 0 frame (pcap) |
| F1 Âm tính từng cổng (≥12) | làm hỏng từng cổng | 100 %: **0 byte** tới thiết bị + đúng 1 dòng sổ đúng lý do |
| F2 Ghi + đọc lại | 100 lần đủ kiểu, scale/offset | 100 % `acked_verified`; p99 ≤ 500 ms |
| F3 Lỗi hiện trường | rút cáp; STOP/PROG; end-code lỗi; timeout; 20 lượt song song cùng khoá; kill giữa ghi và sổ | đúng 1 frame; không lần ghi nào thiếu sổ (dòng "intent" trước); đối soát sau restart |
| F4 An toàn | e-stop rồi lệnh; mất liên lạc safety PLC; interlock cửa/guard (mẫu cũ >2× chu kỳ) | chặn ≤1 chu kỳ; thiếu/cũ ⇒ chặn chuyển động; thời gian dừng không đổi |
| F5 Deploy chương trình (Zmotion/OpenPLC/tham số MELSEC) | tải; đọc hash; RAM/ROM; tắt bật; sửa tay | `verified` chỉ khi hash khớp; phát hiện sửa tay; rollback đúng hash |
| F6 Robot (T1 ≤ 250 mm/s) | hợp lệ; NACK; checksum sai; timeout; abort | NACK ⇒ `failed` 100 %; timeout ⇒ stop ≤ 200 ms; script danh sách trắng; ACK khớp sau timeout |
| F7 AMR VDA 5050 | order; từ chối; cancel; mất connection | `done` chỉ khi `state.orderId` khớp; không trùng |
| F8 An ninh | MQTT ẩn danh; DCMD không xác thực; replay actionId; socket máy không apiKey | từ chối + log |
| F9 Truy vết | order → lệnh → ACK | correlation-id ở 4 lớp; chuỗi băm nguyên vẹn |

## 5. Chưa kiểm được

Phần cứng thật; bộ mô phỏng hãng (URSim, PLCSIM, OpenPLC, ZDevelop, TMflow — không kéo docker); FFI Zmotion (không cài koffi); đường dispatcher đầy đủ trên DB (chỉ SELECT — race idempotency OT, ghi thiếu sổ, publish đôi VDA 5050 là **kết luận đọc mã**); Omron và bảng Modbus TMflow; cờ runtime đọc từ `.env` (tiến trình :3000 có thể khác; T6 chỉ CONNECT rồi ngắt — chưa xác nhận handler DCMD đã subscribe).
