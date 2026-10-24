# SCADA R1b-1 · An toàn điều khiển + nợ R1a — Kế hoạch thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đóng các khoảng trống an toàn và đúng đắn còn lại sau R1a:
- người vận hành có lệnh STOP HMI một bước, dùng giá trị ghim;
- "đã kết nối" chỉ hiện khi đã có một lần đọc tốt;
- ingest treo có hạn;
- REST v1 không còn bề mặt lệnh OT;
- nhật ký thử lệnh WORM ghi lý do và không phình vô hạn;
- mã dự phòng không bị dùng hai lần;
- không còn dòng mồ côi;
- giá trị lệnh của interlock luôn khớp dải ghi khi cấu hình đổi.

**Architecture:**
- Không thêm đường ghi mới: mọi lệnh đi qua `dispatch()`.
- **STOP HMI** là một thủ tục mới, một bước:
  - dựng `writes` từ các tag đã ghim `stop_value` của adapter;
  - `commandType "stop"`, tool `hmi.stop`, có dòng `ai_pending_actions` ràng buộc băm.

  Dispatcher đã có sẵn mọi đặc quyền của STOP ghim: vượt policy và interlock, miễn dải, miễn cổng chế độ, định tuyến STOP sang edge. R1b-1 chỉ nối HMI vào đường đó.
- **Một migration 0433:**
  - cột `ly_do` cho `scada_command_attempts`;
  - FK `ON DELETE CASCADE` cho `scada_kenh_che_do` và `scada_khoa_chon`.
- Phần còn lại là sửa tại chỗ, mỗi sửa có test và đột biến.

**Tech Stack:** TypeScript, tRPC, drizzle + Postgres (migration viết tay), React, vitest (+ DB `_test`), OpenPLC bench.

**Spec (thứ tự ưu tiên khi mâu thuẫn):**
1. Báo cáo đã duyệt `docs/superpowers/specs/2026-10-23-scada-thiet-ke-he-sinh-thai.html`: D3 (LOCAL từ chối trừ STOP ghim), D5, D8, D9, §4.5–4.6.
2. Báo cáo nghiệm thu R1a `docs/superpowers/plans/2026-10-24-scada-r1a-bao-cao-nghiem-thu.md`: §6 giới hạn đã biết, §8 Backlog R1b.
3. Quyết định của điều phối ngày 2026-10-24:
   - test nhịp tim deadband làm ĐẦU TIÊN;
   - STOP HMI riêng là ưu tiên CAO THỨ HAI;
   - REST v1 trả 501 cho mọi lệnh OT không phải robot;
   - sửa `ADAPTER_SDK.md` / doc 56 cho khớp.

**Phụ thuộc:** R1b-1 xây trên R1a (`feat/scada-r1a`, đang chờ kiem-dinh). Nhánh `feat/scada-r1b` tạo từ `feat/scada-r1a`. Khi R1a gộp vào main thì merge main vào nhánh này ở điểm dừng. **Không thực thi trước khi điều phối duyệt kế hoạch.**

---

## Đề xuất tách R1b (cần điều phối duyệt)

| Phần | Nội dung | Cổng nghiệm thu |
|---|---|---|
| **R1b-1 · An toàn + nợ** (kế hoạch này, 12 task) | §8 Backlog R1b mục 1, 3, 4, 5, 8, 9, 11, 12, 13, 15, 17, 18, 19. Từ mục 2: "connected = lần đọc tốt đầu tiên", ingest treo + `soLanChong`, `cooldownSeconds` partial, luật `telemetry_tag` line/station chưa đếm, D11 cho `propose_interlock_rule`. Lý do WORM của mục 6 (chỉ phần DB). | STOP HMI dừng được máy ở cả REMOTE lẫn LOCAL trên bench, kể cả khi người khác đang giữ khoá chọn. Mỗi sửa có test và đột biến đỏ. |
| **R1b-2 · Nhật ký + UI + driver** (kế hoạch riêng, viết sau khi R1b-1 được duyệt) | Xem danh sách ngay dưới bảng. | Danh sách hạng mục 1-1, mỗi mục có test hoặc số đo. |

Nội dung R1b-2:
- M9 `/scada/journal` (UI + nợ phạm vi `commandLogRouter`).
- M4 "Điều kiện cho phép" chạy khô.
- M12: tìm kiếm, cảnh báo deadband trước khi lưu, ca biên ô chọn adapter.
- Chip "Truyền thông n/m".
- Lab "thử đọc một địa chỉ".
- `danhSach` lộ endpoint / `lastError`.
- `ketNoiLai`: giới hạn tần suất + audit trong giao dịch.
- Tắt nóng `SCADA_SOCKET`.
- Trần tổng tag / người dùng.
- Nhãn "sim" cho lệnh stub.
- EIP listener `'error'` + `timeout_sp`.
- Định danh callback ghi SLMP.
- Tắt sạch không ghi `disabled`.
- C6 đọc khối Modbus.
- Đo mất / có lại OPC UA.
- Nhịp cho nguồn ngoài OT trung tâm.
- `congOtLuong` dùng mức kênh.
- Audit điều tiết báo đúng cỡ đợt burst.

## Quyết định cần điều phối xem (đề xuất của tôi)

1. **STOP HMI một bước, không qua request → confirm.**
   - Một lần bấm "DỪNG" (có hộp xác nhận ở client) gọi `scadaCommands.dungMay`.
   - Server tạo dòng chờ `hmi.stop` ở trạng thái `confirmed` cùng `confirmedBy = người bấm` và băm payload. Server gọi `dispatch()` ngay.
   - Không TTL 60 s, không khoá chọn, không 2FA (mức 1, như `machine_stop` trong `BANG_TRA`), không thuộc nhóm giới hạn 2fa.
   - Vai trò: `operator` trở lên + `machine_control.canEdit` + phạm vi máy.
2. **Nguồn giá trị STOP chỉ là `device_tags.stop_value` đã ghim** của MỌI tag đã ghim trên (các) adapter của máy. Không tự đoán tag.
   - Máy chưa có tag ghim nào ⇒ từ chối `CHUA_GHIM_STOP`, kèm hướng dẫn ghim ở M12.
   - Adapter do edge sở hữu ⇒ dispatcher tự định tuyến STOP sang edge như hiện nay.
3. **"connected = lần đọc tốt đầu tiên" nằm sau cờ `OT_CHAT_LUONG_V2_ENABLED`**, cùng cách R0 D1. Cờ tắt ⇒ giữ nghĩa "TCP lên" như cũ.
4. **Bộ điều tiết attempts theo người dùng nằm trong RAM của tiến trình**, không thêm bảng. Lý do: đây là chống phình bảng WORM, không phải biên an toàn.
   - Các mã "ồn" là `DA_XU_LY`, `HET_HAN`, `NOT_FOUND`, `TOTP_CAN`.
   - Một người dùng vượt 30 lần/phút cho các mã này ⇒ vẫn từ chối như cũ, nhưng chỉ ghi MỘT dòng tổng kết/phút (`reason_code = "DIEU_TIET"`, kèm số lần).
   - Mã không ồn luôn ghi từng dòng.
5. **FK `ON DELETE CASCADE`** cho `scada_kenh_che_do.machine_id` → `machines`, `scada_kenh_che_do.adapter_id` → `device_adapters`, `scada_khoa_chon.adapter_id` → `device_adapters`. Trước khi thêm FK, migration xoá dòng mồ côi và ĐẾM số dòng đã xoá; gửi số đếm DEV trước khi áp.
6. **REST v1 `POST /api/v1/equipment/:id/commands`:**
   - Mọi lệnh OT không phải robot ⇒ HTTP 501 `not_implemented`, kèm hướng dẫn dùng HMI.
   - Robot (`abort`, `e_stop` cho `robotStopExempt`) giữ nguyên.
   - Kiểm phạm vi / chủ sở hữu `adapterId` không còn cần cho OT, vì OT không còn tới dispatcher.

## Global Constraints

- **Nơi làm và nhánh.** Làm trong worktree `D:\SOURCES\_scada_wt`, nhánh `feat/scada-r1b`. **Không** sửa cây chính `D:\SOURCES\avi-aoi-management`. **Không push.** Chỉ gộp main ở điểm dừng giữa hai task.
- **Commit.** Commit bằng pathspec, vì hook BG-124 chặn commit trần: `git commit -m "…" -- <tệp…>`. Cuối message: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Migration.**
  - Dải **0433–0449**, viết tay theo khuôn `scripts/apply-migration-0432.mjs`: DDL bằng owner `aoi`, verify bằng `avi_app`, có `has_table_privilege`.
  - Áp TEST thoải mái. **DEV chỉ sau khi điều phối duyệt SQL.**
  - Không sửa `drizzle/meta/_journal.json`.
- **Cờ.**
  - Cờ mới (nếu có) mặc định OFF và thêm vào `.env.example`.
  - `OT_CONTROL_ENABLED` / `AI_OT_CONTROL_ENABLED` chỉ bật trong tiến trình test và bench (D9).
  - **Không sửa `.env`.**
- **Đường ghi.** Không thêm đường ghi mới. Mọi lệnh tới thiết bị đi qua `dispatch()` (`server/services/ot/commandDispatcher.ts`). Mọi từ chối trong dispatch đi qua `writeRejected`.
- **Phạm vi.**
  - Mọi thủ tục nhận `adapterId`/`machineId` từ client phải kiểm `idsTrongPhamVi("machine", phamViCua(ctx), {strict:true})`.
  - "Không thấy" và "ngoài phạm vi" trả cùng một lỗi.
- **Census.** Thủ tục tRPC mới:
  - nâng GHIM `phamViDocCensus` / `congGiayPhepAiCensus` kèm ghi chú có ngày;
  - đăng ký `server/routers.ts` + `moduleAccessMap.ts`;
  - i18n vi/en/zh cho mọi `appError`;
  - xếp đúng nhóm trong census `trpcGioiHanThuTuc` (STOP HMI KHÔNG thuộc nhóm 2fa, có miễn trừ kèm lý do).
- **Test.**
  - Test DB: `npx vitest run -c vitest.db.config.ts <tệp>`.
  - Người dùng test tạo bằng `taoNguoiDungTest`.
  - Test hai trục thời gian thật phải có cờ opt-in.
- **Mỗi task.** Test đỏ đúng chỗ → mã → xanh → **đột biến ghi trong task làm đỏ ≥ 1 test** (chạy, ghi vào commit, hoàn tác) → commit.
- **Tệp và màu.** Không xoá tệp, không đổi tên công khai đang có người gọi. Màu chỉ dùng token ISA. Trạng thái lệnh không dùng màu cảnh báo.

## Review Focus

1. **STOP HMI ở máy LOCAL, khi người khác đang giữ khoá chọn kênh, khi người bấm chưa có 2FA** ⇒ vẫn gửi được: STOP ghim miễn cổng chế độ, không dùng khoá chọn, mức 1. Test ở Task 2.
2. **STOP HMI trên adapter do edge sở hữu** ⇒ dispatcher định tuyến STOP sang edge (`edgeStopRequest`), không bị từ chối. Test ở Task 2.
3. **Bấm STOP hai lần liên tiếp / hai người bấm cùng lúc** ⇒ cả hai được xử lý như STOP (không `DA_XU_LY` chặn lần hai), không lỗi khoá trùng. Test ở Task 2.
4. **"connected" khi TCP lên nhưng mọi lần đọc đều timeout** ⇒ không bao giờ hiện `connected`; DB không ghi `connected`. Test ở Task 3.
5. **Xoá máy / adapter đang có kênh chế độ hoặc khoá chọn** ⇒ không lỗi FK, dòng phụ bị xoá theo. `cheDoMay` của máy đã xoá ⇒ LOCAL `chua_khai`. Test ở Task 7.

---

### Task 1: Test nhịp tim deadband 60 s (ĐẦU TIÊN)

**Files:**
- Modify: `server/services/ot/otManager.deadband.test.ts` (test hiện có ~:150 chỉ phủ trường hợp ghi đè env 200 ms)
- Test: thêm ca vào tệp trên, và `server/services/scada/boDemHienTai.deadband.r1b.test.ts`

**Interfaces:**
- Consumes: `DEADBAND_HEARTBEAT_MS` / `deadbandHeartbeatMs` và `shouldForwardSample` (`otManager.ts:~574-625`), `NGUONG_DEADBAND_MS = 70_000` (`boDemHienTai.ts`).

- [ ] **Step 1: Viết test** (đồng hồ giả, KHÔNG đặt env):
  - giá trị đứng yên trên tag có deadband ⇒ mẫu được chuyển tiếp lại đúng ở 60 000 ms, và không sớm hơn;
  - ở 59 999 ms ⇒ chưa chuyển tiếp;
  - bộ đệm: mục có deadband, mẫu cuối cách 60 s ⇒ `stale === false`; cách 70 001 ms ⇒ `stale === true`;
  - chứng minh 60 s < 70 s: một chuỗi nhịp tim 60 s giữ mục không bao giờ `stale`.
- [ ] **Step 2: Chạy.** Mong đợi: xanh nếu mã hiện tại đúng. Đây là test ghim hành vi. Nếu đỏ ⇒ ghi số đo và DỪNG báo, không sửa mã.
- [ ] **Step 3: Đột biến:** đặt nhịp tim mặc định 75 000 ⇒ ca "không bao giờ stale" đỏ. Hoàn tác.
- [ ] **Step 4: Commit** `test(ot): ghim nhip tim deadband 60 s < nguong stale 70 s cua bo dem (R1b-1 T1)`.

### Task 2: Lệnh STOP HMI một bước (ưu tiên cao thứ hai)

**Files:**
- Modify: `server/routers/scadaCommandsRouter.ts` (thủ tục mới `dungMay`), `server/services/scada/lenhHmi.ts` (hàm `dungMayHmi`), census (phamViDoc, congGiayPhepAi, `trpcGioiHanThuTuc.census.test.ts` miễn trừ), i18n
- Modify (UI): `client/src/components/scada/Faceplate.tsx` (nút "DỪNG MÁY" luôn hiện, kể cả LOCAL), `client/src/components/scada/BangTruyenThong.tsx` hoặc ngăn M10 (nút dừng theo adapter), `client/src/components/scada/ketQuaLenh.ts` (khoá `goiYStop` đổi lại thành "Dùng nút DỪNG MÁY (STOP đã ghim) hoặc E-STOP cứng")
- Test: `server/routers/scadaCommandsRouter.dungMay.db.test.ts`, `client/src/components/scada/DungMay.dom.test.tsx`

**Interfaces:**
- Consumes: `loadStopPins(db, adapterId)` (`stopPin.ts:166`), `otPayloadHash`, `dispatch()`, `idsTrongPhamVi`, `vaiTroDuocGhi(1)`.
- Produces:
  - `scadaCommands.dungMay` (mutation)
    - input `{ machineId: number; lyDo?: string(0..300); clientRequestId: string(uuid) }`
    - output `{ ketQua: Array<{ adapterId; status; ok; simulated; reason?; edgeStopRequest?: boolean }> }`
  - mã từ chối mới: `CHUA_GHIM_STOP`
  - tool `hmi.stop` (KHÔNG có trong registry AI; lõi `confirmAction` đã từ chối `hmi.*`)

Chốt:
- **Adapter mục tiêu:** mọi adapter **đang bật** của máy, trong phạm vi.
- **Tạo payload:** với mỗi adapter có ≥ 1 tag ghim, dùng `writes = loadStopPins(...).map(p => ({tagKey: p.tagKey, value: p.stopValue}))` và `commandType: "stop"`.
- **Dòng chờ:** một dòng `ai_pending_actions` cho mỗi adapter:
  - `tool "hmi.stop"`, `status "confirmed"`, `userId = confirmedBy = người bấm`;
  - băm `otPayloadHash({tool, adapterId, machineId, commandType:"stop", writes})`;
  - `expiresAt = now + 30 s`;
  - `idempotencyKey = "hmistop:" + userId + ":" + clientRequestId + ":" + adapterId`.
- **Gọi dispatch:** `dispatch({…, triggeredBy:{kind:"hitl", tool:"hmi.stop", actionId, confirmedBy:userId, requestedBy:userId, requireBoundAction:true}, idempotencyKey:"hmistop:"+actionId})`.
- **Không:** khoá chọn, kiểm chế độ ở lenhHmi, 2FA. Mức hiệu lực = 1.
- **Khi nào được miễn chế độ:** dispatcher chỉ miễn cổng chế độ cho STOP khớp ghim. Payload dựng từ CHÍNH các ghim nên luôn khớp. Test phải chứng minh điều này ở máy LOCAL.
- **Máy không có adapter nào có tag ghim** ⇒ `CHUA_GHIM_STOP`, 1 dòng attempts, chữ M5 "Máy chưa ghim giá trị STOP — kỹ sư ghim ở /scada/config/channels; dừng bằng E-STOP cứng".
- **Ghi nhật ký:** mỗi adapter một dòng attempts `stage:"dispatch"` (outcome theo kết quả) có `ly_do` (Task 7).
- **Lỗi 1 adapter không chặn các adapter khác.** Kết quả trả từng adapter.
- **Census giới hạn:** `scadaCommands.dungMay` miễn khỏi nhóm 2fa, kèm lý do "STOP không bao giờ bị phần mềm chặn; không xác minh TOTP".
- **UI:**
  - nút đỏ "DỪNG MÁY" dùng token chế độ dừng của ISA, không phải màu cảnh báo;
  - một hộp xác nhận một bước "Dừng máy X? (gửi STOP đã ghim tới N adapter)";
  - kết quả từng adapter dùng `nhanKetQua` hiện có;
  - nút hiện cả khi LOCAL, vì đó là lúc cần nhất.

- [ ] **Step 1: Test đỏ (DB, stub, `OT_CONTROL_ENABLED` trong tiến trình, safety giả OK):**
  - máy REMOTE ⇒ `acked*`, driver nhận đúng giá trị ghim;
  - máy LOCAL ⇒ vẫn gửi, không bị `MODE_LOCAL`;
  - người khác đang giữ khoá chọn tag đó ⇒ vẫn gửi;
  - người bấm là operator chưa có 2FA ⇒ vẫn gửi;
  - adapter do edge sở hữu ⇒ `edgeStopRequest` (Review Focus 2);
  - bấm hai lần liên tiếp (2 `clientRequestId`) ⇒ cả hai gửi; hai người song song ⇒ cả hai gửi (Review Focus 3);
  - máy không ghim ⇒ `CHUA_GHIM_STOP` + 1 dòng attempts;
  - viewer ngoài phạm vi ⇒ `NOT_FOUND` như máy không tồn tại;
  - `aiCopilot.confirmAction` với dòng `hmi.stop` ⇒ bị từ chối như `hmi.*`.
- [ ] **Step 2: Chạy.** Mong đợi: đỏ.
- [ ] **Step 3: Cài server + UI + census + i18n.**
- [ ] **Step 4: Chạy lại** + `server/services/ot` + census + DOM. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:**
  - lenhHmi kiểm chế độ cho STOP ⇒ ca LOCAL đỏ;
  - dựng payload từ tag tuỳ ý thay vì ghim ⇒ ca LOCAL đỏ (dispatcher không miễn).
  - Hoàn tác cả hai.
- [ ] **Step 6: Commit** `feat(scada): lenh STOP HMI mot buoc tu gia tri ghim - mien che do/khoa chon/2FA qua dispatch (R1b-1 T2)`.

### Task 3: "connected" chỉ sau lần đọc tốt đầu tiên (cờ V2)

**Files:**
- Modify: `server/services/ot/otManager.ts` (legacy: báo `connected` ở ~:328 và ~:409 → chuyển thành "chờ đọc tốt"; HA: `onStateChange` `case "connected"` ~:793; `tuyChonPollCua` `onTick` ~:344 báo `connected` ở tick tốt đầu tiên của phiên)
- Test: `server/services/ot/otManager.ketNoiDocTot.r1b.test.ts`

Chốt:
- **Cờ bật** (`chatLuongV2Bat()`, đọc lúc subscribe): `connected` (RAM + DB) chỉ được báo ở tick đầu tiên của phiên có `e.ok === true`.
  - Trước đó trạng thái giữ `connecting`.
  - Phiên mới (reconnect) ⇒ lại chờ.
  - Dùng định danh phiên hiện có (`phienHoatDong`, `demPhien`) để tick của phiên cũ không báo thay.
- **Cờ tắt:** y như cũ. Viết test hồi quy.
- Presence (`connectionSupervisor.ts:~576`) giữ nguyên. Ghi rõ trong comment.

- [ ] **Step 1: Test đỏ:**
  - legacy và HA, cờ bật: TCP lên + mọi tick timeout ⇒ không bao giờ `connected`, DB không ghi `connected` (Review Focus 4);
  - tick tốt đầu tiên ⇒ `connected`;
  - phiên mới ⇒ chờ lại;
  - tick tốt của phiên cũ đến muộn ⇒ không báo.
  - Cờ tắt ⇒ như cũ.
- [ ] **Step 2–4:** cài, chạy lại, rồi `server/services/ot` + bench nghiệm thu R0 (`SCADA_R0_NGHIEM_THU=1`) vẫn xanh.
- [ ] **Step 5: Đột biến:** báo `connected` ngay khi TCP lên ⇒ đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `fix(ot): connected chi sau lan doc tot dau tien cua phien (co V2) (R1b-1 T3)`.

### Task 4: Ingest treo có hạn + `soLanChong` vào bộ đếm

**Files:**
- Modify: `server/services/ot/vongPoll.ts` (vòng `await o.onSample(s)` ~:133-140, mẫu xấu ~:119-126, mẫu muộn ~:98-105), `server/services/ot/boDemTruyenThong.ts` (`ghiNhanDoc` ~:102, `BoDemAdapter` ~:52), `server/services/ot/otManager.ts` (`makeIngestSink` ~:719)
- Test: `server/services/ot/vongPoll.ingestTreo.r1b.test.ts`

Chốt:
- **Hạn và hằng:** hạn cho toàn bộ lượt phát mẫu của một tick là `max(2 × intervalMs, 5000)` ms (hằng `HAN_PHAT_MAU_MS_TOI_THIEU = 5000`).
- **Quá hạn:**
  - bỏ các mẫu còn lại của tick đó;
  - báo `SuKienDoc {ok:false, timeout:true, lyDo:"ingest_treo"}`;
  - nhả chốt.
  - **Giữ thứ tự:** một lượt phát quá hạn mà vẫn chạy nền thì KHÔNG được phát thêm mẫu sau khi nhả chốt. Dùng token lượt, cùng cách chốt sở hữu của R1a.
- **`soLanChong`** đi qua `onTick` vào `boDemTruyenThong` (trường mới `chong` trong `BoDemAdapter`). M10 `danhSach.boDem1h` hiện được giá trị này (R1b-2 làm UI).
- **D1 / K=2 KHÔNG đếm `ingest_treo` là tick hỏng.** Lý do: DB chậm không phải thiết bị mất; nếu đếm thì gây reconnect oan (ruling R1a residual).

- [ ] **Step 1: Test đỏ:**
  - `onSample` không bao giờ resolve ⇒ tick sau vẫn chạy sau hạn;
  - không mẫu cũ nào được phát sau khi nhả chốt;
  - `soLanChong` tăng và tới bộ đếm;
  - D1 không hạ phiên vì `ingest_treo`.
- [ ] **Step 2–4:** cài, chạy lại, rồi `server/services/ot`.
- [ ] **Step 5: Đột biến:** bỏ token lượt ⇒ ca "không phát mẫu cũ" đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `fix(ot): han cho ingest treo + so lan chong vao bo dem, khong ha phien vi DB cham (R1b-1 T4)`.

### Task 5: REST v1 lệnh OT ⇒ 501 (D8)

**Files:**
- Modify: `server/api/v1/router.ts` (~:328-382), `docs/ECOSYSTEM/ADAPTER_SDK.md` (~:133, ~:221), `docs/ECOSYSTEM/56_*` (doc 56: đúng tệp đang mô tả route/sự kiện)
- Test: `server/api/v1/equipmentCommands.r1a.db.test.ts` (sửa kỳ vọng), thêm ca 501

Chốt:
- `command` thuộc nhóm OT (không phải robot) ⇒ trả `501 {error:"not_implemented", message:"…dùng HMI SCADA…"}` TRƯỚC `buildCommand`. Không tới dispatcher, không ghi `command_log`.
- Robot `abort` / `e_stop` giữ nguyên (`robotStopExempt.dot1c`, `robotAbortNeverOrder.dot1c` phải xanh).
- Sự kiện `equipment.command.executed` không còn phát cho OT.

- [ ] **Step 1: Test đỏ:**
  - OT write / start / stop qua REST ⇒ 501, 0 dòng `command_log`, 0 lần ghi driver;
  - robot abort ⇒ như cũ.
- [ ] **Step 2–4:** cài, chạy lại, rồi `server/api/v1` + 2 tệp robot dot1c.
- [ ] **Step 5: Đột biến:** bỏ nhánh 501 ⇒ đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `fix(api): REST v1 lenh OT khong phai robot tra 501, giu duong robot; sua ADAPTER_SDK/doc 56 (R1b-1 T5, D8)`.

### Task 6: Migration 0433 — `ly_do` WORM + FK dọn mồ côi

**Files:**
- Create: `drizzle/0433_scada_ly_do_fk.sql`, `scripts/apply-migration-0433.mjs`
- Modify: `drizzle/schema/ot.ts`

SQL (idempotent):

```sql
ALTER TABLE scada_command_attempts ADD COLUMN IF NOT EXISTS ly_do varchar(300);
-- dọn mồ côi rồi thêm FK (DO $$ … đếm số dòng xoá, RAISE NOTICE …)
DELETE FROM scada_kenh_che_do k WHERE NOT EXISTS (SELECT 1 FROM machines m WHERE m.id = k.machine_id)
  OR NOT EXISTS (SELECT 1 FROM device_adapters a WHERE a.id = k.adapter_id);
DELETE FROM scada_khoa_chon c WHERE NOT EXISTS (SELECT 1 FROM device_adapters a WHERE a.id = c.adapter_id);
-- FK ON DELETE CASCADE (guarded duplicate_object):
--   scada_kenh_che_do(machine_id) → machines(id); scada_kenh_che_do(adapter_id) → device_adapters(id);
--   scada_khoa_chon(adapter_id) → device_adapters(id)
```

Lưu ý: `scada_command_attempts` là WORM (REVOKE + trigger). `ALTER ADD COLUMN` bằng owner `aoi` không bị trigger chặn. Verify vẫn kiểm `avi_app` UPDATE/DELETE = false.

- [ ] **Step 1: Viết SQL + verify:**
  - (a) cột `ly_do`, 3 FK, ON DELETE CASCADE;
  - (b) quyền `avi_app` trên attempts không đổi (INSERT true, UPDATE/DELETE false); xoá `device_adapters` trong giao dịch hoàn tác ⇒ dòng `scada_khoa_chon` theo bị xoá;
  - (c) sổ migration.
- [ ] **Step 2: Chạy** `--test-only`. Đột biến verify. **Không áp DEV.** Gửi điều phối số đếm DEV dự kiến (số dòng mồ côi hiện có) qua phiên điều phối.
- [ ] **Step 3: Commit** `feat(scada): mig 0433 ly_do cho nhat ky thu lenh + FK cascade kenh che do/khoa chon (R1b-1 T6)`.

### Task 7: Ghi `ly_do` + bộ điều tiết attempts

**Files:**
- Modify: `server/services/scada/lenhHmi.ts` (`ghiThuLenh`: ghi `ly_do` cho mọi dòng có lý do — `request`, `confirm`, `dispatch`, `huy`, `dungMay`), `server/services/scada/dieuTietThuLenh.ts` (mới)
- Test: `server/services/scada/dieuTietThuLenh.test.ts`, mở rộng `scadaCommandsRouter.request.db.test.ts` / `confirm.db.test.ts`

**Interfaces:**
- Produces:
  - `export function nenGhiThuLenh(userId: number, reasonCode: string, now?: number): { ghi: true } | { ghi: false } | { ghi: "tong_ket"; soLan: number }`
  - hằng `MA_ON = ["DA_XU_LY","HET_HAN","NOT_FOUND","TOTP_CAN"]`, `TRAN_MOI_PHUT = 30`

Chốt:
- **Mã ngoài `MA_ON` ⇒ luôn ghi.**
- **Mã trong `MA_ON`:**
  - 30 dòng đầu trong cửa sổ 60 s của người dùng ⇒ ghi;
  - sau đó ⇒ không ghi từng dòng;
  - khi cửa sổ kết thúc, lần gọi kế tiếp ghi MỘT dòng `reason_code:"DIEU_TIET"` với `ly_do` "N lần {mã} bị gộp".
- **Từ chối vẫn trả đúng mã cho client.**
- **Lưu trữ:** RAM theo tiến trình (quyết định 4). Dọn khoá cũ theo cửa sổ.
- **Hậu quả đã ghi (Review Focus 5):** xoá máy/adapter (FK cascade) không đụng attempts, vì attempts không có FK.

- [ ] **Step 1: Test đỏ:**
  - `ly_do` có trên dòng `proposed` / `dispatched` / `rejected` / `huy` / `dungMay`;
  - 100 lần `DA_XU_LY` trong 1 phút ⇒ ≤ 31 dòng (30 + 1 tổng kết);
  - mã không ồn ⇒ mỗi lần một dòng.
- [ ] **Step 2–4:** cài, chạy lại.
- [ ] **Step 5: Đột biến:** bỏ điều tiết ⇒ ca 100 lần đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `feat(scada): ghi ly_do WORM cho moi lan thu lenh + dieu tiet ma on theo nguoi dung (R1b-1 T7)`.

### Task 8: Mã dự phòng không dùng hai lần (double-spend)

**Files:**
- Modify: `server/db/auth.ts` (`verifyBackupCode` ~:632), `server/routers/twoFactorRouter.ts` (đường đối chiếu mã dự phòng)
- Test: `server/db/auth.backupDoubleSpend.r1b.db.test.ts`

Chốt:
- Tiêu thụ mã bằng MỘT câu nguyên tử: `UPDATE … SET used_at = now() WHERE user_id = $1 AND <mã khớp> AND used_at IS NULL RETURNING`, hoặc khuôn tương đương của bảng thật.
- Đọc tệp để biết mã được lưu thế nào: băm bcrypt?
  - Nếu so bcrypt bắt buộc phải đọc trước ⇒ khoá hàng `FOR UPDATE` trong giao dịch, rồi đánh dấu.
  - 0 hàng ⇒ thất bại.
- Giữ bộ đếm T16 (charge-before-verify) như cũ.

- [ ] **Step 1: Test đỏ:** 10 lần dùng song song cùng một mã ⇒ đúng 1 thành công.
- [ ] **Step 2–4:** cài, chạy lại, rồi bộ 2FA/đăng nhập (`server/_core/totpKhoaSai.db`, `server/routers/twoFactor*`).
- [ ] **Step 5: Đột biến:** bỏ khoá / điều kiện `used_at IS NULL` ⇒ đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `fix(auth): ma du phong tieu thu nguyen tu - khong dung song song hai lan (R1b-1 T8)`.

### Task 9: Interlock — kiểm lại khi tag đổi + nợ R0.1

**Files:**
- Modify:
  - `server/routers/deviceAdapterRouter.ts` (`tags.update` ~:506, đổi `dataType` / `writable`)
  - `server/routers/mappingAsCodeRouter.ts` (import)
  - `server/routers/interlockRouter.ts` (`ruleInput.partial()` + `cooldownSeconds.default(300)` ~:88-97)
  - `server/routers/oversightRouter.ts` (`fetchInterlockCauHinhHong` ~:424-439)
  - `server/services/aiLocalTools/writeHandlers/interlock.ts` (`propose_interlock_rule` ~:107-111)
- Test: `server/routers/interlockRouter.r1b.db.test.ts`

Chốt:
- **`tags.update` / import làm một luật interlock đang bật mất hợp lệ** (giá trị gửi thực, `giaTriLenhInterlock`) ⇒ từ chối `INTERLOCK_NGOAI_DAI`. Dùng chung `assertLenhTrongDaiKenh` / `kiemNhatQuanKenh` của R1a.
- **`cooldownSeconds`:** update một phần không được đặt lại về 300. Bỏ `.default()` khỏi schema gốc, chỉ áp mặc định trong create.
- **Posture:** đếm luật `telemetry_tag` có `scope <> 'machine'` trong `interlockRulesCauHinhHong`.
- **`propose_interlock_rule`:** kiểm D11 (`telemetry_tag` ⇒ scope machine) trước khi chèn. Xuất helper kiểm D11 dùng chung với `interlockRouter`.

- [ ] **Step 1: Test đỏ:** mỗi mục một ca.
- [ ] **Step 2–4:** cài, chạy lại, rồi `server/routers/interlock*` + `server/services/interlock` + `server/routers/deviceAdapter*`.
- [ ] **Step 5: Đột biến:**
  - bỏ kiểm ở `tags.update` ⇒ đỏ;
  - trả lại `.default(300)` ⇒ ca update một phần đỏ.
  - Hoàn tác cả hai.
- [ ] **Step 6: Commit** `fix(interlock): kiem lai gia tri lenh khi tag doi/import, cooldown khong reset, posture dem telemetry_tag ngoai may, D11 cho propose (R1b-1 T9)`.

### Task 10: Gói nhỏ — đồng hồ đơn điệu, Sparkplug Long, i18n, census, khoá phạm vi, gộp kiểm edge

**Files** (mỗi mục một commit hoặc gộp, tuỳ người làm):
- `server/services/ot/otDeviceWrite.ts`: `enqueuedAt` / `waitedMs` dùng `performance.now()`; test đồng hồ giả có `toFake: ["performance"]`.
- `server/services/scada/kenhScada.ts` (`epInt` / `epFloat`): nhận đối tượng kiểu Long (`{low, high, unsigned}` có `toNumber()`) khi giá trị nằm trong miền an toàn; ngoài miền ⇒ `TYPE_MISMATCH`.
- `server/services/aiCopilotActions.ts` / `aiCopilotRouter.ts`: `MUC_QUA_CAO` ở confirm có khoá i18n vi/en/zh.
- `server/_core/xacThucTheoMuc.importCensus.test.ts`: bắt re-export `export *` của `ghiStepUpPhien`.
- `server/services/aiLocalTools/otWriteBinding.census.test.ts`: bắt `runDispatch` gọi qua helper trung gian (theo đồ thị gọi trong tệp).
- `server/routers/scadaKenhRouter.ts` `capNhat`: đọc `adapter.machineId` để kiểm phạm vi KHI đã khoá hàng adapter (`FOR SHARE`).
- `server/services/scada/lenhHmi.ts`: thay truy vấn edge riêng bằng `adapterOwnedByEdgeInTx` (mở rộng helper để trả mã edge).
- Test: mỗi mục một ca. Đột biến: mỗi mục một lần đỏ, ghi vào commit.

- [ ] **Step 1–5:** test đỏ → cài → xanh → đột biến từng mục.
- [ ] **Step 6: Commit(s)** `chore(scada): goi no R1a - dong ho don dieu, Sparkplug Long, i18n MUC_QUA_CAO, census, khoa pham vi capNhat, gop kiem edge (R1b-1 T10)`.

### Task 11: Chữ hướng dẫn STOP + checklist

**Files:** `client/src/i18n/locales/{vi,en,zh}.json` (khoá `scada.lenh.loi.goiYStop`), `docs/superpowers/plans/2026-10-24-scada-r1a-bao-cao-nghiem-thu.md` (chỉ thêm ghi chú "đã đóng ở R1b-1" nếu điều phối muốn; mặc định ghi vào báo cáo R1b-1)

Chốt:
- Sau Task 2, gợi ý `MODE_LOCAL` đổi thành: "Cần dừng máy? Dùng nút DỪNG MÁY (gửi STOP đã ghim) hoặc E-STOP cứng tại máy".
- Máy chưa ghim ⇒ giữ chữ E-STOP cứng.
- Gộp vào Task 2 nếu người làm thấy hợp.

- [ ] Test DOM chữ mới. Đột biến: chữ cũ ⇒ đỏ. Commit.

### Task 12: Nghiệm thu R1b-1

**Files:**
- Create:
  - `server/services/scada/r1bNghiemThu.db.test.ts` (opt-in `SCADA_R1B_NGHIEM_THU=1`)
  - `scripts/scada-r1b-bench.ts`
  - `docs/superpowers/plans/2026-10-24-scada-r1b-1-bao-cao-nghiem-thu.md`

Cổng:

| Ô | Kích thích | Mong đợi |
|---|---|---|
| S1 | STOP HMI, máy REMOTE | `acked_verified`, thiết bị nhận giá trị ghim |
| S2 | STOP HMI, máy LOCAL | vẫn gửi (không `MODE_LOCAL`) |
| S3 | STOP HMI khi người khác giữ khoá chọn | vẫn gửi |
| S4 | STOP HMI bởi operator chưa 2FA | vẫn gửi |
| S5 | STOP HMI máy edge | `edgeStopRequest` |
| S6 | máy chưa ghim | `CHUA_GHIM_STOP` + 1 dòng WORM |
| C1 | TCP lên, mọi đọc timeout (cờ V2) | không bao giờ `connected` |
| R1 | REST v1 lệnh OT | 501, 0 `command_log` |
| W1 | 100 `DA_XU_LY`/phút | ≤ 31 dòng attempts |
| B1 | 10 lần song song cùng mã dự phòng | đúng 1 thành công |

- [ ] **Step 1:** viết test opt-in; chạy; xanh. Đỏ ⇒ về task sở hữu, không nới.
- [ ] **Step 2: Đột biến hệ thống:** lenhHmi kiểm chế độ cho STOP ⇒ S2 đỏ. Ghi.
- [ ] **Step 3: Bench OpenPLC** (`avi-openplc-bench`, `holding:1..18`, safety PLC giả trong tiến trình):
  - ghim `stop_value` cho 1 thanh ghi;
  - STOP HMI ở REMOTE và ở LOCAL;
  - kênh chế độ trên 1 thanh ghi khác;
  - 3 vòng, đọc lại độc lập;
  - trả container về trạng thái cũ.
- [ ] **Step 4: Báo cáo:** bảng số đo, giới hạn đã biết, checklist bật cờ (cập nhật: HMI ĐÃ là đường STOP qua `dungMay`), thứ tự triển khai (0433 trước build), backlog R1b-2.
- [ ] **Step 5: Chạy toàn bộ** (như R1a T15) + `npm run check`.
- [ ] **Step 6: Commit** `test(scada): nghiem thu R1b-1 - STOP HMI LOCAL/REMOTE/edge, connected doc tot, REST 501, dieu tiet attempts, ma du phong`.

---

## Bàn giao sau R1b-1

- Báo điều phối để giao kiem-dinh rồi gộp. **Không push.**
- 0433 lên DEV: gửi SQL + số dòng mồ côi DEV, chờ "áp".
- Viết kế hoạch R1b-2 sau khi R1b-1 được duyệt. R1c (edge, Q1 = a2) lập kế hoạch sau khi R1a gộp, như điều phối đã quyết.
