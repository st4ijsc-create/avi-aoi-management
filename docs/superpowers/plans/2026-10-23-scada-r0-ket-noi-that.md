# SCADA R0 · Kết nối thật — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tầng kết nối nói thật về chất lượng dữ liệu: mất kết nối sinh mẫu xấu, uncertain đi tới màn hình, trạng thái adapter ghi vào DB, có bộ đếm chẩn đoán, có bộ đệm giá trị hiện tại + `scada:subscribe` có kiểm phạm vi, interlock chặn khi thiếu dữ liệu, và màn M10 `/scada/diag`.

**Architecture:** Sửa ở gốc (driver → vòng poll dùng chung → otManager/supervisor) rồi dựng hai thứ mới trên đó: bộ đệm RAM `(adapterId, tagKey) → giá trị + chất lượng + tuổi` nuôi bằng tap `telemetryBus`, và kênh socket theo từng socket (không `join` phòng). Interlock và M10 đọc từ bộ đệm. Mọi hành vi mới sau cờ, mặc định OFF.

**Tech Stack:** Node/TS (ESM), Express + tRPC 11, Socket.IO 4, drizzle + postgres.js, vitest 2, React 19 + react-query, node-opcua, modbus-serial.

**Spec:** `docs/superpowers/specs/2026-10-23-scada-thiet-ke-he-sinh-thai.html` (báo cáo ĐÃ DUYỆT 23/10, D1–D11; mục 1.3 C1–C9, 1.4, 2.3 K3, 3.2, 4.4 M10, "Lộ trình theo gốc" hàng R0) và `docs/superpowers/specs/2026-10-23-scada-phan-tich-chi-tiet.md` (C.3 bộ đệm, C.6 hợp đồng socket). Khi hai tài liệu khác nhau, **báo cáo HTML thắng**.

## Global Constraints

- Làm trong worktree `D:\SOURCES\_scada_wt`, nhánh `feat/scada-r0` (từ `main` 01bdc0cb6). **Không** sửa cây chính `D:\SOURCES\avi-aoi-management`.
- Commit bằng pathspec (hook BG-124 chặn commit trần): `git commit -m "…" -- <tệp…>`. Cuối message: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Migration: dải **0430–0449**. Viết tay `drizzle/0430_*.sql` + `scripts/apply-migration-0430.mjs` theo `scripts/apply-migration-0412.mjs` (`runMigration` của `scripts/apply-migration-dot10-common.mjs`). Áp **TEST** (`--test-only`) thoải mái; áp **DEV** chỉ sau khi phiên điều phối duyệt SQL. Không sửa `drizzle/meta/_journal.json`, không dùng `drizzle-kit generate`.
- Cờ mới (thêm vào `.env.example`, mặc định OFF): `OT_CHAT_LUONG_V2_ENABLED` (C1 phát mẫu xấu + C2 ánh xạ uncertain), `OT_GHI_TRANG_THAI_ADAPTER_ENABLED` (C3), `SCADA_LIVE_CACHE_ENABLED` (bộ đệm), `SCADA_SOCKET_ENABLED` (`scada:subscribe`), `SCADA_LAB_ENABLED` (đặt lỗi stub từ M10). Sửa timeout (C5) và chống chồng tick là sửa lỗi: **không** cờ.
- Socket: **không** thêm `socket.join(` ở tệp mới (census `socketPhongCensus.test.ts:155` chỉ cho 3 tệp); **không** `io.emit`, không phòng `global` (census `socketPhatCensus.test.ts`). Kênh SCADA đẩy bằng `socket.emit` tới đúng socket đã đăng ký.
- Phạm vi: mọi đọc dữ liệu theo máy đi qua `trongPhamVi` / `idsTrongPhamVi` (`server/db/hierarchy.ts:216,277`) hoặc cổng trong `server/_core/socketPhongQuyen.ts`. Mỗi thủ tục tRPC mới phải truyền `ctx`/`phamViCua(ctx)` và **cập nhật GHIM** của `server/routers/phamViDocCensus.test.ts:852` + `server/routers/congGiayPhepAiCensus.test.ts:512` kèm ghi chú có ngày.
- Test DB: người dùng tạo bằng `taoNguoiDungTest` (`server/testing/nguoiDungTest.ts:79`), không `insert(users)`. Test DB chạy: `npx vitest run -c vitest.db.config.ts <tệp>`; test thường: `npx vitest run <tệp>`; kiểu: `npm run check`.
- Mỗi task: test viết trước và đỏ đúng chỗ → mã → xanh → **đột biến ghi trong task phải làm đỏ ít nhất một test** (chạy, ghi kết quả vào message commit, hoàn tác) → commit.
- Không xoá tệp, không đổi tên công khai đang có người gọi.

## Review Focus

1. Adapter **không gắn máy** (`machineId` null): socket/M10 chỉ cho người có phạm vi toàn quyền — test ở Task 8 và Task 10.
2. **Hai adapter cùng `tagKey` trên một máy**: interlock không được chọn bừa — coi là thiếu dữ liệu (chặn) — test ở Task 9.
3. **Chập chờn** (mất rồi có lại trong < 1 chu kỳ): không kẹt ở bad, không phát mẫu xấu lặp mỗi tick — test ở Task 3.
4. **Đăng ký quá giới hạn** (> 500 tag / > 10 đăng ký): từ chối có mã lỗi, không cắt bớt im lặng — test ở Task 8.
5. **Khởi động lại server**: giá trị nạp từ DB phải mang tuổi thật, không hiện như "tốt, mới" — test ở Task 7.

---

## File Structure

| Tệp | Trách nhiệm |
|---|---|
| `server/services/ot/otDriver.ts` (sửa) | thêm `LyDoChatLuong`, `OtSample.reason`, tham số tuỳ chọn thứ 4 của `subscribe` |
| `server/services/ot/chatLuong.ts` (mới) | bảng ánh xạ chất lượng 3 mức cho OPC UA / Modbus / SLMP; sinh mẫu xấu hàng loạt |
| `server/services/ot/vongPoll.ts` (mới) | một vòng poll dùng chung: chống chồng tick, deadline, phát xấu một lần khi mất, hồi phục, sự kiện đếm |
| `server/services/ot/drivers/*.ts` (sửa) | dùng `taoVongPoll`; dùng `chatLuong` |
| `server/services/ot/deviceAdapter.ts` (sửa) | `timeoutMs` từ `connectionOptions` tới driver |
| `server/services/ot/connectionSupervisor.ts` (sửa) | callback `onStateChange` |
| `server/services/ot/trangThaiAdapter.ts` (mới) | trạng thái kết nối trong RAM, phát mẫu xấu khi chuyển "mất", ghi DB có điều tiết |
| `server/services/ot/boDemTruyenThong.ts` (mới) | bộ đếm phiên/request/lỗi/timeout/lệnh + p50/p95, cửa sổ 1 h |
| `server/services/ot/otManager.ts` (sửa) | nối deadline, onTick → bộ đếm, trạng thái → `trangThaiAdapter`, thông tin adapter → bộ đệm |
| `server/services/ot/ingest.ts` (sửa) | giữ `statusCode`, `reason` trong `meta` |
| `server/services/ot/drivers/stubDriver.ts` (sửa) | stub có kịch bản + ghi vào RAM |
| `server/services/scada/boDemHienTai.ts` (mới) | bộ đệm giá trị hiện tại |
| `server/db/otTelemetry.ts` (sửa) | `layMoiNhatTheoThietBi`, `layMauThoTheoThietBi` |
| `server/services/scada/scadaSocket.ts` (mới) | `scada:subscribe/unsubscribe/snapshot/delta` |
| `server/_core/socketPhongQuyen.ts` (sửa) | cổng `duocXemTagScada` |
| `server/services/interlock/*` + `drizzle/schema/interlock.ts` (sửa) | fail-closed, đọc bộ đệm |
| `server/routers/scadaDiagRouter.ts` (mới) | API M10 |
| `client/src/pages/ScadaDiag.tsx`, `client/src/components/scada/*` (mới) | màn M10 |
| `scripts/scada-r0-bench.ts` (mới) | đo nghiệm thu trên OpenPLC bench |

---

### Task 1: Hợp đồng chất lượng + timeout tới driver (C2 nền, C5)

**Files:**
- Modify: `server/services/ot/otDriver.ts:14-61,197-227`
- Create: `server/services/ot/chatLuong.ts`
- Modify: `server/services/ot/deviceAdapter.ts:109-123`
- Test: `server/services/ot/chatLuong.test.ts`, `server/services/ot/deviceAdapter.timeout.test.ts`

**Interfaces:**
- Produces:
  - `export type LyDoChatLuong = "comm_lost" | "device_error" | "config_error" | "out_of_range" | "stale"` (otDriver.ts)
  - `OtSample.reason?: LyDoChatLuong` (otDriver.ts; `statusCode?` đã có — bỏ ghi chú "chỉ cho bad")
  - `export interface TuyChonVongPoll { deadlineMs?: number; onTick?: (e: SuKienDoc) => void }` và `export interface SuKienDoc { ok: boolean; timeout: boolean; ms: number; tags: { tagKey: string; quality: OtQuality }[] }` (otDriver.ts)
  - `OtDriver.subscribe(tags, onSample, intervalMs?, tuyChon?: TuyChonVongPoll)` — tham số 4 tuỳ chọn, mọi driver hiện có vẫn hợp lệ
  - chatLuong.ts: `chatLuongOpcua(scVal: number, moTa: string): { quality: OtQuality; statusCode?: string; reason?: LyDoChatLuong }` · `chatLuongLoiChung(err: unknown): { statusCode: string; reason: LyDoChatLuong }` (timeout ⇒ `"timeout"`/`comm_lost`; `DeviceUnreachableError` ⇒ `"unreachable"`/`comm_lost`; `ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|EHOSTUNREACH` ⇒ mã đó/`comm_lost`; còn lại ⇒ 80 ký tự đầu của message/`device_error`) · `chatLuongLoiModbus(err: unknown): { statusCode: string; reason: LyDoChatLuong }` (mã exception Modbus trước, rồi rơi về `chatLuongLoiChung`) · `chatLuongEndCodeSlmp(endCode: number): { statusCode: string; reason: LyDoChatLuong }` · `mauXauChoMoiTag(tags: OtTagAddress[], statusCode: string, reason: LyDoChatLuong, at: Date): OtSample[]` · `laLoiTimeout(err: unknown): boolean`
  - deviceAdapter.ts: `export function docTimeoutMs(opts: Record<string, unknown> | null | undefined): number | undefined`

- [ ] **Step 1: Viết test đỏ** `chatLuong.test.ts`:
  - `chatLuongOpcua(0, "Good")` ⇒ `{quality:"good"}` (không statusCode)
  - `chatLuongOpcua(0x40920000, "UncertainLastUsableValue (0x40920000)")` ⇒ `quality:"uncertain"`, `reason:"device_error"`, `statusCode` chứa `0x40920000`
  - `chatLuongOpcua(0x80310000, …)` (BadNoCommunication) ⇒ `bad`, `comm_lost`; cùng cho `0x808A0000` (BadNotConnected), `0x800A0000` (BadTimeout), `0x800D0000` (BadServerNotConnected), `0x80050000` (BadCommunicationError)
  - `chatLuongOpcua(0x80340000, …)` (BadNodeIdUnknown) ⇒ `bad`, `config_error`; `0x80330000` (BadNodeIdInvalid) ⇒ `config_error`
  - `chatLuongOpcua(0x80000000, …)` ⇒ `bad`, `device_error`
  - `chatLuongLoiModbus({modbusCode: 2})` ⇒ `{statusCode:"modbus_exc_02", reason:"config_error"}`; mã 1, 3 ⇒ `config_error`; mã 4, 5, 6, 11 ⇒ `device_error`
  - `chatLuongLoiModbus(Object.assign(new Error("Timed out"), {name:"TransactionTimedOutError"}))` ⇒ `{statusCode:"timeout", reason:"comm_lost"}`; lỗi có `code:"ECONNRESET"|"ECONNREFUSED"|"EPIPE"|"ETIMEDOUT"` ⇒ `comm_lost`, statusCode = mã đó
  - `chatLuongLoiChung(new DeviceUnreachableError("s7"))` ⇒ `{statusCode:"unreachable", reason:"comm_lost"}`; `chatLuongLoiChung(new Error("weird"))` ⇒ `{statusCode:"weird", reason:"device_error"}`
  - `chatLuongEndCodeSlmp(0xC059)` ⇒ `{statusCode:"slmp_end_0xC059", reason:"config_error"}`; `0xC056`, `0xC05B` ⇒ `config_error`; `0xC051` ⇒ `device_error`
  - `mauXauChoMoiTag([a,b], "comm_lost", "comm_lost", t)` ⇒ 2 mẫu `quality:"bad"`, `value:null`, `raw:null`, `timestamp:t`, `tsSource:"server"`
  - `deviceAdapter.timeout.test.ts`: `docTimeoutMs({timeoutMs:1500})===1500`; `docTimeoutMs({timeoutMs:"1500"})===1500`; `0`, `-1`, `"abc"`, `60001`, `undefined` ⇒ `undefined`; và `loadEnabledAdapters` (mock DB như `otManager.boot.test.ts:27-41`) với `connectionOptions:{timeoutMs:1500, ha:{secondaryEndpoint:"…"}}` ⇒ `connection.timeoutMs===1500` **và** `backupConnection.timeoutMs===1500`.
- [ ] **Step 2: Chạy** `npx vitest run server/services/ot/chatLuong.test.ts server/services/ot/deviceAdapter.timeout.test.ts` — đỏ vì thiếu module/hàm.
- [ ] **Step 3: Cài.** Mức chất lượng OPC UA lấy từ 2 bit cao `scVal >>> 30` (0 good, 1 uncertain, 2–3 bad). Tập mã `comm_lost`/`config_error` là hằng `Set<number>` ở đầu tệp. `docTimeoutMs`: số nguyên dương ≤ 60000, nhận chuỗi số. `deviceAdapter.ts:118` dùng `docTimeoutMs(connectionOptions)`, truyền vào `parseBackupConnection(connectionOptions, timeoutMs)` (`:123`).
- [ ] **Step 4: Chạy lại** — xanh. Chạy thêm `npx vitest run server/services/ot/drivers` để chắc không vỡ test driver cũ.
- [ ] **Step 5: Đột biến:** đổi điều kiện uncertain thành `>>> 30 === 2` ⇒ test uncertain phải đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `fix(ot): hop dong chat luong 3 muc + timeoutMs toi driver (C2 nen, C5)` -- otDriver.ts chatLuong.ts chatLuong.test.ts deviceAdapter.ts deviceAdapter.timeout.test.ts.

---

### Task 2: Vòng poll dùng chung (chống chồng tick, deadline, mất/hồi phục)

**Files:**
- Create: `server/services/ot/vongPoll.ts`
- Test: `server/services/ot/vongPoll.test.ts`

**Interfaces:**
- Consumes: Task 1 (`SuKienDoc`, `mauXauChoMoiTag`, `laLoiTimeout`, `LyDoChatLuong`).
- Produces: `export function taoVongPoll(o: { tags: OtTagAddress[]; intervalMs: number; deadlineMs?: number; doc: (tags: OtTagAddress[]) => Promise<OtSample[]>; onSample: OnOtSample; onTick?: (e: SuKienDoc) => void; phanLoiLoi: (err: unknown) => { statusCode: string; reason: LyDoChatLuong }; chatLuongV2: boolean; nhan: string }): OtSubscriptionHandle & { soLanChong(): number }`

Hành vi chốt:
- Tick tới khi tick trước chưa xong ⇒ **bỏ qua**, tăng `soLanChong()`.
- Mỗi tick bọc `doc()` bằng deadline `deadlineMs ?? intervalMs` (dùng `withDeadline` sẵn có trong `server/services/ot/*`, cùng hàm driver MC đang dùng).
- `doc()` ném lỗi hoặc quá deadline: `onTick({ok:false, timeout, ms, tags:[]})`; nếu `chatLuongV2` và **lần đầu** của đợt lỗi ⇒ phát `mauXauChoMoiTag(tags, phanLoiLoi(err))` qua `onSample`. Các tick lỗi tiếp theo không phát lại.
- `doc()` thành công: phát từng mẫu như cũ, `onTick({ok:true, timeout:false, ms, tags:[{tagKey, quality}…]})`, đặt lại cờ "đang lỗi".
- Lỗi của `onSample` một mẫu bị nuốt (giữ hành vi cũ, `modbusDriver.ts:258-266`).
- `close()` dừng hẳn, tick đang chạy xong thì không phát gì nữa.

- [ ] **Step 1: Test đỏ** (`vi.useFakeTimers()`):
  - `doc` chậm 1500 ms, `intervalMs` 1000 ⇒ sau 3 s chỉ 2 lần gọi `doc` và `soLanChong() >= 1`.
  - `doc` treo mãi, `deadlineMs` 800 ⇒ `onTick` nhận `{ok:false, timeout:true}` ở ~800 ms.
  - `chatLuongV2:true`, `doc` ném 3 tick liên tiếp ⇒ đúng **một** loạt mẫu xấu (mỗi tag 1 mẫu, `reason` từ `phanLoiLoi`); tick 4 thành công ⇒ mẫu tốt; tick 5 ném ⇒ thêm **một** loạt xấu nữa (đợt lỗi mới).
  - `chatLuongV2:false`, `doc` ném ⇒ **không** phát mẫu (hành vi cũ).
  - "chập chờn" (Review Focus 3): ném ở tick 1, tốt ở tick 2 ⇒ cuối cùng mẫu cuối của mỗi tag là `good`.
  - `close()` khi một tick đang chờ ⇒ không còn `onSample` sau đó.
- [ ] **Step 2: Chạy** `npx vitest run server/services/ot/vongPoll.test.ts` — đỏ.
- [ ] **Step 3: Cài** `taoVongPoll` ở `vongPoll.ts`; timer `unref()` như driver hiện tại.
- [ ] **Step 4: Chạy lại** — xanh.
- [ ] **Step 5: Đột biến:** bỏ cờ "đang lỗi" (phát xấu mọi tick lỗi) ⇒ test "đúng một loạt" đỏ; bỏ kiểm `inFlight` ⇒ test chồng tick đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `feat(ot): vong poll dung chung - chong chong tick, deadline, mau xau mot lan khi mat` -- vongPoll.ts vongPoll.test.ts.

---

### Task 3: Driver dùng vòng poll + ánh xạ chất lượng (C1 ở driver, C2)

**Files:**
- Modify: `server/services/ot/drivers/modbusDriver.ts:179-282`, `opcuaDriver.ts:403-515,603-618`, `slmpDriver.ts:252-294`, `s7Driver.ts:204-253`, `mitsubishiMcDriver.ts:350-403`, `ethernetIpDriver.ts:173-210`
- Test: `server/services/ot/drivers/chatLuong.drivers.test.ts`

**Interfaces:**
- Consumes: Task 1, Task 2.
- Produces: mọi driver poll gọi `taoVongPoll({... chatLuongV2: process.env.OT_CHAT_LUONG_V2_ENABLED === "true", deadlineMs: tuyChon?.deadlineMs, onTick: tuyChon?.onTick, phanLoiLoi: <theo driver>, nhan: "<protocol>" })` trong `subscribe`.

Chốt theo driver (chỉ khi `OT_CHAT_LUONG_V2_ENABLED=true`, tắt ⇒ đúng hành vi cũ):
- Modbus `readOne` lỗi: mẫu bad mang `chatLuongLoiModbus(err)`. `phanLoiLoi` = `chatLuongLoiModbus`. Mọi driver khác (và stub ở Task 4): `phanLoiLoi` = `chatLuongLoiChung`.
- OPC UA `readTags` (`:445-461`) và đường monitored (`:603-618`): dùng `chatLuongOpcua(scVal, describeStatus(sc, scVal))`; **uncertain giữ giá trị** (`value` = giá trị chuẩn hoá, không null).
- SLMP `badSample` (`:291`): gắn `chatLuongEndCodeSlmp(endCode)`.
- S7 `readAllItems` (`:222-228`): bọc `withDeadline(…, this.timeoutMs + 1000, "s7 readAllItems")` (**không cờ** — C5). Địa chỉ sai một tag (`parseS7Address` `:213`) ⇒ chỉ tag đó bad `config_error`, các tag khác vẫn đọc (**sau cờ**). MC (`:358`) tương tự.
- EIP: gắn `reason:"device_error"` + statusCode từ `err.code ?? err.message` (cắt 80 ký tự).

- [ ] **Step 1: Test đỏ** `chatLuong.drivers.test.ts` (bật cờ bằng `vi.stubEnv`):
  - Modbus thật trong tiến trình (`ServerTCP` như `otManager.boot.test.ts:94-110`) trả exception 2 cho một thanh ghi ⇒ mẫu tag đó `bad`, `statusCode:"modbus_exc_02"`, `reason:"config_error"`; tag khác `good`.
  - Modbus: đóng server giữa chừng, `subscribe(…, 200, {deadlineMs:150})` ⇒ trong ≤ 2 chu kỳ (≤ 400 ms + 150 ms) mọi tag nhận một mẫu `bad`/`comm_lost`.
  - OPC UA: `readTags` với `MockSession` trả `statusCode.value = 0x40920000` ⇒ `quality:"uncertain"`, `value` khác null.
  - S7: `readAllItems` không bao giờ resolve ⇒ `readTags` reject trong `timeoutMs + 1000` (fake timers).
  - S7 cờ bật, địa chỉ `"XYZ"` cho tag 2 ⇒ tag 1 good, tag 2 bad `config_error`.
  - Cờ **tắt**: OPC UA `0x40920000` ⇒ `bad` (đúng hành vi cũ) — bảo vệ đường lui.
- [ ] **Step 2: Chạy** `npx vitest run server/services/ot/drivers/chatLuong.drivers.test.ts` — đỏ.
- [ ] **Step 3: Cài** theo chốt trên; giữ nguyên chữ ký `readTags`.
- [ ] **Step 4: Chạy** tệp mới + `npx vitest run server/services/ot` (toàn bộ test OT cũ phải xanh).
- [ ] **Step 5: Đột biến:** OPC UA trả `"bad"` cho uncertain dù cờ bật ⇒ đỏ; bỏ `withDeadline` ở S7 ⇒ đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `feat(ot): driver dung vong poll + chat luong 3 muc (C1 driver, C2) sau co OT_CHAT_LUONG_V2_ENABLED` -- <các tệp driver + test>.

---

### Task 4: Stub có kịch bản (C9)

**Files:**
- Modify: `server/services/ot/drivers/stubDriver.ts`
- Test: `server/services/ot/drivers/stubDriver.kichBan.test.ts`

**Interfaces:**
- Produces (stubDriver.ts):
  - `export interface LoiStub { matKetNoi?: boolean; tagXau?: string[]; tagNghiNgo?: string[]; giaTri?: Record<string, number | boolean | string> }`
  - `StubDriver.simDatLoi(l: LoiStub): void` (ghi đè toàn bộ trạng thái lỗi; `{}` = hết lỗi)
  - `export function layStubDangChay(endpoint: string): StubDriver | undefined` (đăng ký lúc `connect`, gỡ lúc `disconnect`)
  - `connectionOptions.simKichBan?: { matKetNoiSauMs?: number; matKetNoiTrongMs?: number }` — tự rớt/có lại theo thời gian (đọc ở `connect`)

Chốt: `matKetNoi` ⇒ `isConnected()` false, `readTags` ném `DeviceUnreachableError("stub")`, `health()` `connected:false`. `tagXau` ⇒ mẫu bad `statusCode:"stub_bad"`, `reason:"device_error"`; `tagNghiNgo` ⇒ uncertain giữ giá trị. `writeTags` ghi vào RAM (`Map<tagKey, value>`), trả `ok:true`; `readTags` trả giá trị đã ghi (ưu tiên `giaTri` > đã ghi > sin). `subscribe` dùng `taoVongPoll` (Task 2).

- [ ] **Step 1: Test đỏ:** `simDatLoi({matKetNoi:true})` ⇒ `readTags` reject, `isConnected()===false`; `simDatLoi({})` ⇒ đọc lại được. `tagXau:["t2"]` ⇒ t2 bad, t1 good. `tagNghiNgo:["t1"]` ⇒ t1 uncertain, value số. `writeTags([{tagKey:"sp",value:42,…}])` ⇒ `ok:true`, `readTags` trả 42. `simKichBan:{matKetNoiSauMs:1000, matKetNoiTrongMs:2000}` (fake timers) ⇒ mất từ 1 s tới 3 s. `layStubDangChay("stub://a")` trả đúng instance sau `connect`, `undefined` sau `disconnect`.
- [ ] **Step 2: Chạy** `npx vitest run server/services/ot/drivers/stubDriver.kichBan.test.ts` — đỏ.
- [ ] **Step 3: Cài.** Giữ API checksum cũ (`simLoadProgram`, `simSetProgramReadFault`).
- [ ] **Step 4: Chạy** tệp mới + `stubDriver.test.ts` cũ — xanh (sửa kỳ vọng cũ "write disabled" thành ghi RAM, ghi rõ trong commit).
- [ ] **Step 5: Đột biến:** `isConnected()` luôn true ⇒ đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `feat(ot): stub co kich ban - rot ket noi, tag xau/nghi ngo, ghi RAM (C9)` -- stubDriver.ts stubDriver.kichBan.test.ts stubDriver.test.ts.

---

### Task 5: Trạng thái adapter + ghi DB + phát xấu khi chuyển "mất" (C1 ở supervisor, C3, N11)

**Files:**
- Create: `server/services/ot/trangThaiAdapter.ts`
- Modify: `server/services/ot/connectionSupervisor.ts:119-162,518-537`, `server/services/ot/otManager.ts:185-330,562-619,1018-1059`
- Test: `server/services/ot/trangThaiAdapter.test.ts`, `server/services/ot/trangThaiAdapter.db.test.ts`

**Interfaces:**
- Consumes: Task 1 (`mauXauChoMoiTag`), `ingestSamples(adapter, samples)` (`ingest.ts:89`).
- Produces:
  - `SupervisorOptions.onStateChange?: (prev: SupervisorState, next: SupervisorState, lastError: string | null) => void` — gọi trong `setState` khi đổi trạng thái.
  - `export type TrangThaiKetNoi = "connecting" | "connected" | "lost" | "disabled"`
  - `export function baoTrangThaiAdapter(a: Pick<RuntimeAdapter, "adapterId" | "code" | "machineId" | "protocol" | "tags">, tt: TrangThaiKetNoi, loi: string | null, now?: Date): void`
  - `export function layTrangThaiAdapter(adapterId: number): { tt: TrangThaiKetNoi; tu: Date; loi: string | null; soLanMat: number } | null`
  - `export function __datLaiTrangThaiAdapter(): void`, `export function __datGhiDb(fn: GhiDb | null): void` (test seam)
- Ánh xạ DB (`device_adapters`, enum `disabled|connecting|connected|error`): connecting→`connecting`; connected→`connected` + `lastConnectedAt`; lost→`error` + `lastError` + `lastErrorAt`; disabled→`disabled`.

Chốt:
- Ghi DB khi `OT_GHI_TRANG_THAI_ADAPTER_ENABLED=true`: **ghi ngay** khi đổi trạng thái nếu lần ghi trước của adapter đó đã quá 5 s; nếu chưa, hẹn **một** lần ghi cuối (trailing) đúng lúc tròn 5 s, ghi trạng thái mới nhất. Lỗi ghi DB chỉ log, không ném.
- Chuyển sang `lost` và `OT_CHAT_LUONG_V2_ENABLED=true` ⇒ `ingestSamples(adapter, mauXauChoMoiTag(tags, statusCodeTừLỗi ?? "comm_lost", "comm_lost", now))` **một lần** cho đợt mất.
- otManager: legacy — `attemptLegacyStart` thành công ⇒ `connected`; thất bại/`legacyTick` thấy `!isConnected()` ⇒ `lost`; `detachOtAdapter` hoặc `isEnabled=false` ⇒ `disabled`. HA — `buildSupervisor` (`:595`) truyền `onStateChange`: `connected`→connected, `reconnecting|failed`→lost, `connecting|idle`→connecting, `stopped`→disabled.
- Không đụng adapter do edge sở hữu (trung tâm không chạy chúng).

- [ ] **Step 1: Test đỏ** `trangThaiAdapter.test.ts` (fake timers, `__datGhiDb` ghi vào mảng):
  - connecting → connected → lost trong 1 s ⇒ ghi DB lần 1 ngay (connecting), lần 2 trailing lúc 5 s mang `error` (trạng thái mới nhất), tổng 2 lần.
  - lost (cờ chất lượng bật) ⇒ `ingestSamples` được gọi 1 lần với N mẫu bad `comm_lost`; lost lần nữa liền sau ⇒ **không** gọi thêm; connected rồi lost ⇒ gọi lần 2.
  - cờ ghi DB tắt ⇒ 0 lần ghi; `layTrangThaiAdapter` vẫn đúng.
  - `connectionSupervisor`: `MockDriver` (`connectionSupervisor.test.ts:29-80`) `failNext` ⇒ `onStateChange` nhận chuỗi `connecting→failed`, rồi `connected` khi hết lỗi.
- [ ] **Step 2: Test đỏ** `trangThaiAdapter.db.test.ts`: tạo adapter thật trong DB test (`device_adapters` + 2 `device_tags`, `protocol:"stub"`, endpoint `stub://r0-<ts>`), bật cả hai cờ, `startOt` với `OT_GATEWAY_ENABLED=true`, `pollIntervalMs:500`; sau 1,5 s `status='connected'`; `layStubDangChay(endpoint).simDatLoi({matKetNoi:true})` ⇒ trong ≤ 5 s DB `status='error'`, `lastError` khác null; `simDatLoi({})` ⇒ trong ≤ 5 s `connected`. Dọn dữ liệu trong `afterAll`.
- [ ] **Step 3: Chạy** `npx vitest run server/services/ot/trangThaiAdapter.test.ts` và `npx vitest run -c vitest.db.config.ts server/services/ot/trangThaiAdapter.db.test.ts` — đỏ.
- [ ] **Step 4: Cài** `trangThaiAdapter.ts`, callback supervisor, các điểm gọi trong otManager.
- [ ] **Step 5: Chạy lại hai tệp** + `npx vitest run server/services/ot/otManager* server/services/ot/connectionSupervisor*` — xanh.
- [ ] **Step 6: Đột biến:** bỏ trailing write ⇒ test "trạng thái mới nhất" đỏ; gọi `ingestSamples` mỗi lần `lost` ⇒ test "một lần" đỏ. Hoàn tác.
- [ ] **Step 7: Commit** `feat(ot): trang thai adapter ghi nguoc DB (dieu tiet 5 s) + mau xau khi mat ket noi (C1, C3)` -- <tệp>.

---

### Task 6: Bộ đếm truyền thông (C8) + giữ `statusCode` khi ingest

**Files:**
- Create: `server/services/ot/boDemTruyenThong.ts`
- Modify: `server/services/ot/otManager.ts` (truyền `tuyChon` vào `subscribe`), `server/services/ot/ingest.ts:45-58`, `server/services/ot/otDeviceWrite.ts` (đếm lệnh)
- Test: `server/services/ot/boDemTruyenThong.test.ts`, `server/services/ot/ingest.statusCode.test.ts`

**Interfaces:**
- Consumes: `SuKienDoc` (Task 1), `TuyChonVongPoll`.
- Produces (boDemTruyenThong.ts):
  - `ghiNhanDoc(adapterId: number, e: SuKienDoc, now?: number): void`
  - `ghiNhanPhien(adapterId: number, ok: boolean, now?: number): void`
  - `ghiNhanLenh(adapterId: number, tagKey: string, ok: boolean, now?: number): void`
  - `layBoDem(adapterId: number, cuaSoMs?: number /* mặc định 3_600_000 */, now?: number): BoDemAdapter`
  - `export interface BoDemAdapter { phien: number; phienLoi: number; request: number; loi: number; timeout: number; lenh: number; lenhLoi: number; p50Ms: number | null; p95Ms: number | null; theoTag: Record<string, { request: number; loi: number; good: number; uncertain: number; bad: number; lenh: number; lenhLoi: number }> }`
  - `__datLaiBoDem(): void`
- otManager: `deadlineMs = Math.min(connection.timeoutMs ?? 5000, Math.max(300, Math.floor(pollIntervalMs * 0.8)))`; `onTick = (e) => ghiNhanDoc(adapterId, e)`; mỗi lần connect thử ⇒ `ghiNhanPhien`.
- ingest: `meta` thêm `statusCode` và `reason` khi có (giữ `adapterId`, `tagKey`).

Chốt: thùng theo phút, giữ 60 thùng; p50/p95 tính từ tối đa 600 mẫu thời gian gần nhất mỗi adapter; một tick = 1 request cấp adapter và 1 request cho mỗi tag trong tick.

- [ ] **Step 1: Test đỏ:** 10 tick ok (ms 10..100), 2 tick lỗi (1 timeout) ⇒ `request:12, loi:2, timeout:1`, `p50Ms` 50–60, `p95Ms` ≥ 90; `theoTag.t1.good===10`. Sự kiện 61 phút trước bị loại khỏi cửa sổ 1 h. `ingest.statusCode.test.ts`: `sampleToCanonical(adapter, {…, quality:"bad", statusCode:"modbus_exc_02", reason:"config_error"})` ⇒ `meta` có đủ 4 khoá.
- [ ] **Step 2: Chạy** hai tệp — đỏ.
- [ ] **Step 3: Cài.**
- [ ] **Step 4: Chạy** hai tệp + `npx vitest run server/services/ot/otManager*` — xanh.
- [ ] **Step 5: Đột biến:** không loại thùng cũ ⇒ test cửa sổ đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `feat(ot): bo dem truyen thong theo adapter/tag + giu statusCode trong meta (C8)` -- <tệp>.

---

### Task 7: Bộ đệm giá trị hiện tại

**Files:**
- Create: `server/services/scada/boDemHienTai.ts`
- Modify: `server/db/otTelemetry.ts` (thêm 2 hàm), `server/services/ot/otManager.ts` (`startOt`/`attachOtAdapter` gọi `datThongTinAdapter`), `server/_core/index.ts` (khởi động sau cờ)
- Test: `server/services/scada/boDemHienTai.test.ts`, `server/db/otTelemetry.theoThietBi.db.test.ts`

**Interfaces:**
- Consumes: `registerTelemetryTap` (`telemetryBus.ts:113`, nhận `InsertOtTelemetry[]` có `meta.adapterId`, `meta.tagKey`, `meta.statusCode`, `meta.reason`, `ingestedAt`).
- Produces (boDemHienTai.ts):
  - `export interface GiaTriHienTai { adapterId: number; tagKey: string; machineId: number | null; v: number | string | boolean | null; q: OtQuality; statusCode: string | null; reason: LyDoChatLuong | null; ts: number; tsSource: "device" | "server" | null; rx: number; lichSu: number[] /* ≤ 50 giá trị số gần nhất, cũ → mới */ }`
  - `export interface GiaTriCoTuoi extends GiaTriHienTai { ageMs: number; stale: boolean }`
  - `datThongTinAdapter(adapterId: number, t: { pollMs: number; coDeadband: boolean; machineId: number | null; code: string }): void`
  - `napTuTap(rows: InsertOtTelemetry[], now?: number): string[]` (trả khoá `"${adapterId}:${tagKey}"` vừa đổi; bỏ hàng không có `meta.adapterId`)
  - `layGiaTri(adapterId: number, tagKey: string, now?: number): GiaTriCoTuoi | null`
  - `timTheoMayVaTag(machineId: number, tagKey: string, now?: number): GiaTriCoTuoi[]`
  - `thongTinAdapter(adapterId: number): { pollMs: number; coDeadband: boolean; machineId: number | null; code: string } | null`
  - `dangKyThayDoi(cb: (keys: string[]) => void): () => void`
  - `khoiDongBoDemHienTai(): Promise<void>` (đăng ký tap; nạp từ DB các adapter đã `datThongTinAdapter`; idempotent)
  - `__datLaiBoDemHienTai(): void`
- otTelemetry.ts:
  - `layMoiNhatTheoThietBi(deviceCodes: string[], sinceMs: number): Promise<Array<{ deviceId: string; metric: string; numValue: number | null; textValue: string | null; boolValue: boolean | null; quality: string; ts: Date; ingestedAt: Date; meta: Record<string, unknown> | null }>>` — `SELECT DISTINCT ON ("deviceId","metric") … WHERE "deviceId" = ANY(…) AND ts >= … ORDER BY "deviceId","metric", ts DESC` (dùng `inArray`, không `ANY` thô — xem ghi nhớ drizzle).
  - `layMauThoTheoThietBi(deviceCode: string, metric: string, limit: number): Promise<…cùng kiểu…>`

Chốt: `stale = now - rx > max(3 * pollMs, coDeadband ? 70_000 : 0)`; adapter chưa có thông tin ⇒ `pollMs = 5000`. Khi nạp từ DB, `rx = ingestedAt` của hàng (không phải giờ khởi động). Bad/uncertain vẫn lưu (giữ giá trị cuối cho uncertain; bad giữ `v` của hàng = null). Chỉ chạy trong tiến trình API (nơi ingest), không trong `worker.ts`.

- [ ] **Step 1: Test đỏ** `boDemHienTai.test.ts`:
  - `napTuTap` 1 hàng `numValue:3.5, quality:"good", meta:{adapterId:7, tagKey:"t"}` ⇒ `layGiaTri(7,"t").v===3.5`, `q:"good"`.
  - `pollMs:1000, coDeadband:false`: `now = rx + 2999` ⇒ `stale:false`; `rx + 3001` ⇒ `stale:true`. `coDeadband:true` ⇒ còn tươi ở `rx + 60_000`, cũ ở `rx + 70_001`.
  - 60 hàng số liên tiếp ⇒ `lichSu.length===50`, phần tử cuối là giá trị mới nhất.
  - hàng không có `meta.adapterId` ⇒ bỏ qua, không ném.
  - `timTheoMayVaTag` trả 2 phần tử khi 2 adapter cùng máy cùng `tagKey`.
  - Review Focus 5: giả lập nạp DB với `ingestedAt` cách đây 10 phút ⇒ `stale:true` ngay sau khởi động.
  - `dangKyThayDoi` nhận đúng khoá đã đổi; hàm huỷ gỡ được.
- [ ] **Step 2: Test đỏ** `otTelemetry.theoThietBi.db.test.ts`: chèn 3 hàng cùng `(deviceId, metric)` khác `ts` + 1 hàng khác metric ⇒ `layMoiNhatTheoThietBi` trả 2 hàng, đúng hàng mới nhất; `layMauThoTheoThietBi(…, 2)` trả 2 hàng mới nhất giảm dần.
- [ ] **Step 3: Chạy** cả hai — đỏ.
- [ ] **Step 4: Cài.** `index.ts`: nếu `SCADA_LIVE_CACHE_ENABLED==="true"` ⇒ `await khoiDongBoDemHienTai()` sau `startOt`.
- [ ] **Step 5: Chạy lại** — xanh; `npm run check` sạch.
- [ ] **Step 6: Đột biến:** dùng giờ khởi động làm `rx` khi nạp DB ⇒ test Review Focus 5 đỏ; bỏ nhánh deadband ⇒ test 60 s đỏ. Hoàn tác.
- [ ] **Step 7: Commit** `feat(scada): bo dem gia tri hien tai nuoi bang tap telemetryBus + nap tu DB` -- <tệp>.

---

### Task 8: `scada:subscribe` có kiểm phạm vi (C.6)

**Files:**
- Create: `server/services/scada/scadaSocket.ts`
- Modify: `server/_core/socketPhongQuyen.ts` (thêm cổng), `server/_core/socket.ts:330-1350` (đăng ký handler sau cờ)
- Test: `server/services/scada/scadaSocket.test.ts`, `server/services/scada/scadaSocket.db.test.ts`

**Interfaces:**
- Consumes: Task 7 (`layGiaTri`, `thongTinAdapter`, `dangKyThayDoi`); `duocVaoPhongPhamVi`, `coPhamViToanQuyen`, `laSocketNguoiDung`, `QUYEN_XEM_ENGINEERING` (socketPhongQuyen.ts).
- Produces:
  - socketPhongQuyen.ts: `export async function duocXemTagScada(data: DuLieuSocket, machineId: number | null): Promise<boolean>` = `laSocketNguoiDung(data)` ∧ `checkPermission(… "machine_monitoring", "canView")` ∧ (`machineId != null ? duocVaoPhongPhamVi(data, "machine", machineId) : coPhamViToanQuyen(data)`); lỗi ⇒ false.
  - scadaSocket.ts: `export function registerScadaHandlers(socket: SocketScada): void`; `export const GIOI_HAN = { tagMoiDangKy: 500, dangKyMoiSocket: 10, chuKyDeltaMs: 250 } as const`; `export function __datLaiScadaSocket(): void`.
- Hợp đồng (C.6, bổ sung phần tử 8 `reason`):
  - vào `scada:subscribe` `{ subId?: string; tags: { adapterId: number; tagKey: string }[] }`
  - ra `scada:snapshot` `{ subId: string; values: GiaTriGoi[]; denied: { adapterId: number; tagKey: string }[] }`
  - ra `scada:delta` `{ subId: string; values: GiaTriGoi[] }` — mỗi đăng ký tối đa 1 khung / 250 ms, giữ bản **mới nhất** mỗi tag, không bỏ
  - vào `scada:unsubscribe` `{ subId?: string }` (bỏ trống = tất cả)
  - ra `scada:error` `{ code: "BAD_REQUEST" | "TOO_MANY_TAGS" | "TOO_MANY_SUBS" | "DISABLED" }`
  - `type GiaTriGoi = [adapterId: number, tagKey: string, v: number | string | boolean | null, q: "good" | "uncertain" | "bad", ts: number, ageMs: number, stale: boolean, reason: string | null]`

Chốt: **không** `socket.join`; trạng thái đăng ký nằm trong `socket.data.__scada`; vòng đẩy là một `setInterval(250)` duy nhất (unref) đi qua các socket có đăng ký và `socket.emit`. Quyền kiểm **từng tag** lúc đăng ký (cache theo `machineId` trong đời đăng ký); tag bị từ chối vào `denied`, không gửi giá trị. Tag chưa có trong bộ đệm nhưng được phép ⇒ có mặt trong snapshot với `v:null, q:"bad", reason:"stale"`. Socket ngắt ⇒ xoá đăng ký. Đăng ký khi `SCADA_SOCKET_ENABLED` hoặc `SCADA_LIVE_CACHE_ENABLED` tắt ⇒ `scada:error {code:"DISABLED"}`.

- [ ] **Step 1: Test đỏ** `scadaSocket.test.ts` (socket giả: `{ data, emit: vi.fn(), on }`, `__datCongPhamViChoTest` của `socketPhongQuyen.ts:153`):
  - 501 tag ⇒ `scada:error TOO_MANY_TAGS`, **không** snapshot (Review Focus 4); 11 đăng ký ⇒ đăng ký 11 bị `TOO_MANY_SUBS`.
  - người không phạm vi máy 5: tag của adapter gắn máy 5 vào `denied`; tag máy 6 được giá trị.
  - adapter `machineId:null`: chỉ được khi `idsTrongPhamVi` trả `null` (Review Focus 1).
  - 20 lần `napTuTap` cho cùng tag trong 250 ms ⇒ đúng 1 `scada:delta` mang giá trị **cuối**.
  - socket không phải người dùng (`clientType:"machine"`) ⇒ mọi tag bị từ chối.
  - tag stale hiện `stale:true` và `ageMs` > ngưỡng.
- [ ] **Step 2: Test đỏ** `scadaSocket.db.test.ts` theo khuôn `server/_core/socketPhamViPhong.db.test.ts:80-163`, người dùng tạo bằng `taoNguoiDungTest` + `user_factory_assignments`: client socket.io thật đăng ký tag của 2 nhà máy ⇒ chỉ nhận giá trị nhà máy được gán.
- [ ] **Step 3: Chạy** `npx vitest run server/services/scada/scadaSocket.test.ts` và `npx vitest run -c vitest.db.config.ts server/services/scada/scadaSocket.db.test.ts` — đỏ.
- [ ] **Step 4: Cài.** `socket.ts`: trong `io.on("connection")`, nếu `SCADA_SOCKET_ENABLED==="true"` ⇒ `registerScadaHandlers(socket)` (khuôn `registerUnsStreamHandlers` `:1348`).
- [ ] **Step 5: Chạy lại** + census: `npx vitest run server/_core/socketPhongCensus.test.ts server/_core/socketPhatCensus.test.ts` — xanh **không sửa census** (không có `join` mới, không `io.emit`).
- [ ] **Step 6: Đột biến:** bỏ kiểm `duocXemTagScada` (luôn true) ⇒ test phạm vi đỏ; gửi delta mỗi lần thay đổi (không gộp) ⇒ test "đúng 1 delta" đỏ. Hoàn tác.
- [ ] **Step 7: Commit** `feat(scada): scada:subscribe/snapshot/delta theo socket, kiem pham vi tung tag (C.6)` -- <tệp>.

---

### Task 9: Interlock chặn khi thiếu dữ liệu + đọc giá trị sống (K3, D2, D11)

**Files:**
- Create: `drizzle/0430_scada_interlock_thieu_du_lieu.sql`, `scripts/apply-migration-0430.mjs`
- Modify: `drizzle/schema/interlock.ts:31-63`, `server/services/interlock/interlockGate.ts:48-130,202+`, `server/services/interlock/interlockEngine.ts:136+`, `server/services/interlock/ruleEvaluator.ts`
- Test: `server/services/interlock/thieuDuLieu.test.ts`, `server/services/interlock/thieuDuLieu.db.test.ts`

**Interfaces:**
- Consumes: Task 7 (`timTheoMayVaTag`).
- Produces:
  - SQL: `ALTER TABLE interlock_rules ADD COLUMN "khiThieuDuLieu" varchar(8) NOT NULL DEFAULT 'chan' CHECK ("khiThieuDuLieu" IN ('chan','cho_qua'));` (camelCase giống các cột interlock hiện có)
  - schema: `khiThieuDuLieu: varchar("khiThieuDuLieu", { length: 8 }).default("chan").notNull()`
  - ruleEvaluator.ts: `export interface KetQuaDanhGia { dung: boolean; thieuDuLieu: boolean; lyDo?: "khong_co_mau" | "chat_luong_xau" | "cu" | "mo_ho" }`
  - interlockGate.ts: `export async function danhGiaLuat(rule: InterlockRule, now?: number): Promise<KetQuaDanhGia>` (thay chỗ gọi `evaluateRuleCondition` trong gate và engine; `evaluateRuleCondition` giữ, trả `danhGiaLuat(...).dung`)
  - `InterlockGateResult.violations[]` thêm `lyDo?: "thieu_du_lieu"`

Chốt:
- `telemetry_tag` + `SCADA_LIVE_CACHE_ENABLED` ⇒ đọc `timTheoMayVaTag(rule.machineId, rule.sourceKey)`: 0 phần tử ⇒ `khong_co_mau`; > 1 ⇒ `mo_ho`; `q !== "good"` ⇒ `chat_luong_xau`; `stale` ⇒ `cu`; ngược lại `series = lichSu`, `scalar = v`. `rule.machineId` null ⇒ `mo_ho`.
- Cờ bộ đệm tắt ⇒ đường DB cũ, nhưng không có hàng / `scalar` null ⇒ `thieuDuLieu:true, lyDo:"khong_co_mau"`.
- Gate: `thieuDuLieu` ∧ `khiThieuDuLieu === "chan"` ⇒ vi phạm (`lyDo:"thieu_du_lieu"`), `blocked:true`. `cho_qua` ⇒ bỏ qua luật đó.
- Engine *(quyết định trong kế hoạch, báo phiên điều phối)*: `thieuDuLieu` ⇒ **không** tự phát hành động (không dispatch, không andon), ghi log một lần mỗi đợt; cảnh báo truyền thông gộp theo adapter là việc của R2.

- [ ] **Step 1: Test đỏ** `thieuDuLieu.test.ts` (mock bộ đệm):
  - không có mẫu ⇒ gate `blocked:true`, violation `lyDo:"thieu_du_lieu"`.
  - mẫu `q:"bad"` ⇒ chặn; `q:"uncertain"` ⇒ chặn; `stale` ⇒ chặn.
  - 2 adapter cùng `tagKey` trên máy ⇒ chặn (`mo_ho`) (Review Focus 2).
  - `khiThieuDuLieu:"cho_qua"` + không có mẫu ⇒ luật đó không chặn.
  - mẫu tốt vượt ngưỡng ⇒ chặn như cũ; mẫu tốt trong ngưỡng ⇒ không chặn.
  - `consecutiveCount:3` đọc đúng 3 phần tử cuối của `lichSu`.
  - engine: `thieuDuLieu` ⇒ không gọi `dispatch` và không gọi `raiseAndon`.
- [ ] **Step 2: Test đỏ** `thieuDuLieu.db.test.ts`: áp migration 0430 lên DB test (`node scripts/apply-migration-0430.mjs --test-only`), chèn luật đã duyệt chưa có cột ⇒ đọc ra `khiThieuDuLieu==="chan"`.
- [ ] **Step 3: Chạy** hai tệp — đỏ.
- [ ] **Step 4: Cài** migration + script (khuôn `apply-migration-0412.mjs`, `verify` kiểm cột tồn tại và DEFAULT `'chan'`) + schema + logic.
- [ ] **Step 5: Chạy lại** + toàn bộ `npx vitest run server/services/interlock server/services/ot/commandDispatcher.interlock.test.ts server/services/ot/commandDispatcher.inlineInterlock.test.ts` và `npx vitest run -c vitest.db.config.ts server/services/interlock/interlockGate.ilk04.db.test.ts` — xanh. Test cũ nào mặc nhiên "không dữ liệu ⇒ cho qua" phải được sửa kỳ vọng và ghi lý do D2 trong commit.
- [ ] **Step 6: Đột biến:** đổi mặc định thành `cho_qua` ⇒ test đầu đỏ; bỏ nhánh `mo_ho` ⇒ test Review Focus 2 đỏ. Hoàn tác.
- [ ] **Step 7: Commit** `feat(interlock): chan khi thieu du lieu (D2) + doc bo dem gia tri song (K3, D11), mig 0430` -- <tệp>. **Không** áp DEV — gửi SQL cho phiên điều phối duyệt.

---

### Task 10: API M10 (`scadaDiag`)

**Files:**
- Create: `server/routers/scadaDiagRouter.ts`
- Modify: `server/routers.ts:147,554` (đăng ký `scadaDiag`), `server/_core/moduleAccessMap.ts:56+` (`scadaDiag: MOD.OT_CONTROL`), `server/routers/phamViDocCensus.test.ts:852`, `server/routers/congGiayPhepAiCensus.test.ts:512,521`, `server/services/ot/drivers/stubDriver.ts` (không — chỉ dùng `layStubDangChay`)
- Test: `server/routers/scadaDiagRouter.db.test.ts`

**Interfaces:**
- Consumes: Task 5 (`layTrangThaiAdapter`), Task 6 (`layBoDem`), Task 7 (`layGiaTri`, `layMauThoTheoThietBi`), Task 4 (`layStubDangChay`), `resetAdapterSession` (`otManager.ts:889`), `detachOtAdapter` (`:1018`), `getOtAdapterStatus` (`:979`).
- Produces (`protectedProcedure = moduleProcedure("MOD_OT_CONTROL")` như `interlockRouter.ts:37-44`):
  - `danhSach` (query, `machine_monitoring.canView`) → `Array<{ adapterId; code; ten; protocol; endpoint; machineId: number | null; soHuu: { loai: "trung_tam" } | { loai: "edge"; edgeNodeId: number }; trangThai: "connecting" | "connected" | "lost" | "disabled" | "khong_ro"; tu: string | null; loi: string | null; soLanMat: number; pollMs: number; p95Ms: number | null; boDem1h: { request; loi; timeout; lenh; lenhLoi }; tag: { tot: number; nghiNgo: number; xau: number } }>` — lọc theo `idsTrongPhamVi("machine", phamViCua(ctx))`; adapter `machineId` null chỉ hiện khi phạm vi `null`.
  - `tagCuaAdapter({ adapterId })` (query) → `Array<{ tagKey; address; v; q; statusCode; reason; ageMs; stale; boDem: {request; loi; good; uncertain; bad} }>`
  - `mauTho({ adapterId, tagKey })` (query) → 100 hàng gần nhất `{ ts; giaTri; quality; statusCode; tsSource }`
  - `ketNoiLai({ adapterId, lyDo: string(5..300) })` (mutation; vai `engineer|admin` + `machine_control.canEdit`; adapter trong phạm vi; không phải edge) → `resetAdapterSession(adapterId, "scada_diag")`; ghi `control_audit_log`
  - `tamTat({ adapterId, lyDo })` (mutation; cùng quyền) → `update device_adapters set isEnabled=false` + `detachOtAdapter` + `baoTrangThaiAdapter(…,"disabled")`; ghi audit
  - `datLoiStub({ adapterId, loi: LoiStub })` (mutation; chỉ khi `SCADA_LAB_ENABLED`, `protocol==="stub"`, vai `engineer|admin`) → `layStubDangChay(endpoint)?.simDatLoi(loi)`; ghi audit

Chốt: trạng thái lấy từ RAM (`layTrangThaiAdapter`) trước, DB sau (`khong_ro` khi cả hai trống); adapter của edge hiện chủ sở hữu, trạng thái `khong_ro` (C4 chưa trong R0). "Thử đọc một địa chỉ (Lab)" và chỉ báo "Truyền thông n/m" trên thanh trên **để R1** (ghi rõ trong commit).

- [ ] **Step 1: Test đỏ** `scadaDiagRouter.db.test.ts` (người dùng bằng `taoNguoiDungTest`; 2 nhà máy, mỗi nơi 1 adapter stub; 1 adapter không gắn máy):
  - viewer nhà máy A ⇒ `danhSach` chỉ có adapter A (không có adapter không gắn máy).
  - admin ⇒ thấy cả 3.
  - operator gọi `ketNoiLai` ⇒ `FORBIDDEN`; engineer nhà máy A gọi `ketNoiLai` adapter B ⇒ `FORBIDDEN`/`NOT_FOUND`; engineer A cho adapter A ⇒ thành công + 1 dòng audit.
  - `datLoiStub` khi cờ Lab tắt ⇒ lỗi; bật ⇒ stub mất kết nối và trong ≤ 5 s `danhSach` trả `trangThai:"lost"`.
  - `mauTho` trả ≤ 100 hàng, mới nhất trước.
- [ ] **Step 2: Chạy** `npx vitest run -c vitest.db.config.ts server/routers/scadaDiagRouter.db.test.ts` — đỏ.
- [ ] **Step 3: Cài** router; đăng ký `routers.ts`; `moduleAccessMap.ts`.
- [ ] **Step 4: Census:** chạy `npx vitest run server/routers/phamViDocCensus.test.ts server/routers/congGiayPhepAiCensus.test.ts` — đỏ đúng do +6 thủ tục; cập nhật `GHIM` (lớp S cho cả 6 vì đều truyền `phamViCua(ctx)`), `GHIM.tong`, `GHIM_MODULE_KHAC.MOD_OT_CONTROL`, kèm ghi chú `2026-10-2x · R0 scadaDiag +6 (S)`. Chạy lại — xanh.
- [ ] **Step 5: Chạy lại** test router — xanh.
- [ ] **Step 6: Đột biến:** bỏ lọc phạm vi ở `danhSach` ⇒ test viewer đỏ; bỏ kiểm vai ở `ketNoiLai` ⇒ test operator đỏ. Hoàn tác.
- [ ] **Step 7: Commit** `feat(scada): API M10 chan doan truyen thong (danhSach, tag, mau tho, ket noi lai, tam tat, lab stub)` -- <tệp>.

---

### Task 11: Màn M10 `/scada/diag`

**Files:**
- Create: `client/src/pages/ScadaDiag.tsx`, `client/src/components/scada/BangTruyenThong.tsx`, `client/src/components/scada/NganTagAdapter.tsx`, `client/src/components/scada/chatLuongHienThi.ts`
- Modify: `client/src/App.tsx:138,579` (lazy + route `/scada/diag` trong `RouteGuard navHref="/scada/diag"`), `client/src/lib/navigation.tsx:909+` (mục `nav.scadaDiag`, `section:"connect"`, `requiredPermission:"machine_status"`, `engineerOriented:true`), `shared/module-registry.ts:195` (thêm `/scada/diag` vào module chứa `/device-adapters`), `client/src/i18n/locales/{vi,en,zh}.json` (khoá `scada.diag.*`, `nav.scadaDiag*`)
- Test: `client/src/components/scada/chatLuongHienThi.unit.test.ts`, `client/src/pages/ScadaDiag.dom.test.tsx`

**Interfaces:**
- Consumes: Task 10 (`trpc.scadaDiag.*`).
- Produces: `chatLuongHienThi.ts`: `export function nhanTrangThai(tt: "connecting" | "connected" | "lost" | "disabled" | "khong_ro", tuMs: number | null, now: number): { nhan: string /* khoá i18n */; thoiGian: string | null; tone: "ok" | "warn" | "bad" | "muted" }` · `export function hienChatLuong(q: "good" | "uncertain" | "bad", stale: boolean): { kieu: "tot" | "nghi_ngo" | "xau" | "cu"; vien: "none" | "dotted-grey" | "purple-strike" }` (D10: uncertain = viền chấm xám; bad/stale = gạch tím).

Chốt giao diện (báo cáo 4.4):
- Bảng cột: Adapter · Giao thức·endpoint · Sở hữu · Trạng thái (kèm "Mất kết nối 3 ph") · Poll / p95 · Request·lỗi·timeout (1 h) · Tag tốt / ? / xấu · Lỗi gần nhất. Lọc "chỉ lỗi". Làm mới `refetchInterval: 2000` (đạt "M10 hiện mất kết nối ≤ 5 s").
- Bấm một hàng ⇒ `NganTagAdapter`: danh sách tag với giá trị, chất lượng, tuổi, statusCode; nút "100 mẫu thô".
- Nút "Kết nối lại", "Tạm tắt" chỉ hiện cho engineer/admin; mỗi nút mở hộp xác nhận nhập lý do (≥ 5 ký tự). Khối "Lab: đặt lỗi stub" chỉ hiện với adapter `stub` khi API trả có Lab.
- Màu theo token ISA có sẵn (`--isa-*`, `--alarm-*`, `--stale-scrim`), không màu cứng; chế độ xám sáng phòng điều khiển (D6) dùng token có sẵn.

- [ ] **Step 1: Test đỏ:** `nhanTrangThai("lost", now-180000, now)` ⇒ `tone:"bad"`, `thoiGian:"3 ph"`; `hienChatLuong("uncertain", false).vien==="dotted-grey"`; `hienChatLuong("good", true).kieu==="cu"`. `ScadaDiag.dom.test.tsx` (mock trpc như `CommandAuditLog` test): render 3 hàng, hàng `lost` có chữ khoá `scada.diag.matKetNoi`; vai `operator` không thấy nút "Kết nối lại"; bấm "Kết nối lại" mở hộp thoại, lý do 3 ký tự ⇒ nút gửi bị khoá.
- [ ] **Step 2: Chạy** `npx vitest run client/src/components/scada client/src/pages/ScadaDiag.dom.test.tsx` — đỏ.
- [ ] **Step 3: Cài** trang + nav + route + module registry + i18n 3 ngôn ngữ.
- [ ] **Step 4: Chạy lại** + census client: `npx vitest run client/src/lib/navRouteGuardRoles.unit.test.ts client/src/lib/navLicenseFieldsCensus.unit.test.ts client/src/lib/engineeringNavRouteGuardParity.unit.test.ts` và `npm run i18n:check` — xanh (sửa census nếu đỏ do mục mới, ghi chú ngày).
- [ ] **Step 5: Đột biến:** `hienChatLuong("uncertain")` trả `purple-strike` ⇒ test đỏ; hiện nút cho mọi vai ⇒ test operator đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `feat(scada): man M10 /scada/diag - chan doan truyen thong` -- <tệp>.

---

### Task 12: Nghiệm thu R0 (stub có kịch bản + OpenPLC bench + OPC UA uncertain)

**Files:**
- Create: `server/services/scada/r0NghiemThu.db.test.ts`, `server/services/scada/r0OpcuaUncertain.test.ts`, `scripts/scada-r0-bench.ts`, `docs/superpowers/plans/2026-10-23-scada-r0-bao-cao-nghiem-thu.md` (điền khi chạy)
- Modify: `.env.example` (5 cờ mới, mô tả 1 dòng mỗi cờ)

**Interfaces:**
- Consumes: mọi task trước.

Cổng nghiệm thu (đúng hàng R0 của báo cáo):
1. Rút cáp ⇒ **mọi tag thành bad trong ≤ 2 chu kỳ poll** (đo ở bộ đệm hiện tại).
2. **M10 hiện "mất kết nối" trong ≤ 5 s** (đo ở `scadaDiag.danhSach`).
3. **`device_adapters.status` trong DB khớp** (`error` khi mất, `connected` khi có lại; đo trong ≤ 5 s).
4. Cắm lại ⇒ **về tốt trong ≤ 2 chu kỳ**.
5. **Uncertain của OPC UA tới được màn** (driver → ingest → bộ đệm → `scada:snapshot` mang `q:"uncertain"`).

- [ ] **Step 1: Viết** `r0NghiemThu.db.test.ts`: bật cả 5 cờ R0 (trừ Lab không cần), adapter stub `pollIntervalMs:1000`, 18 tag; đo bằng đồng hồ thật, mỗi cổng một `it` với ngưỡng đúng như trên; `simDatLoi({matKetNoi:true})` là "rút cáp".
- [ ] **Step 2: Viết** `r0OpcuaUncertain.test.ts`: `OPCUAServer` của node-opcua trong tiến trình (cổng do hệ điều hành cấp), biến có `statusCode = StatusCodes.UncertainLastUsableValue`; adapter OPC UA → `ingestSamples` (mock DB ghi) → `napTuTap` → socket giả đăng ký ⇒ snapshot `q:"uncertain"`, `v` khác null.
- [ ] **Step 3: Chạy** hai tệp — phải **xanh** (mọi task trước đã xong). Đỏ ⇒ quay về task sở hữu, không nới ngưỡng.
- [ ] **Step 4: Đột biến cấp hệ thống:** tắt `OT_CHAT_LUONG_V2_ENABLED` ⇒ cổng 1 đỏ; tắt `OT_GHI_TRANG_THAI_ADAPTER_ENABLED` ⇒ cổng 3 đỏ. Ghi kết quả.
- [ ] **Step 5: Viết** `scripts/scada-r0-bench.ts` (chạy tay, không vào CI): `pnpm tsx scripts/scada-r0-bench.ts --endpoint tcp://127.0.0.1:15502 --poll 1000 --tags 18 --container avi-openplc-bench`. Dùng `ModbusDriver` + `taoVongPoll` + `trangThaiAdapter` trong tiến trình (không cần DB); "rút cáp" = `docker pause <container>`, "cắm lại" = `docker unpause`; in bảng thời gian 4 cổng đầu. Bench đề xuất: container `avi-openplc-bench` (ảnh `avi-openplc-bench:v3`, Modbus `127.0.0.1:15502`, web `127.0.0.1:18080`) — đang dừng, bật bằng `docker start avi-openplc-bench`; nếu runtime OpenPLC chưa chạy chương trình thì đăng nhập web `openplc/openplc` bấm Start (theo `scripts/safety-plc-bench.ts:54-74`). Địa chỉ đọc: `holding:0..17` (`%QW0..`). Ghi rõ: bản đồ địa chỉ phải xác nhận trên bench trước khi tin.
- [ ] **Step 6: Chạy bench** (cần Docker), dán bảng kết quả + phiên bản container vào `2026-10-23-scada-r0-bao-cao-nghiem-thu.md`. Không có Docker ⇒ ghi "chưa chạy bench" và lý do, **không** khai đạt.
- [ ] **Step 7: Chạy toàn bộ** `npx vitest run server/services/ot server/services/scada server/services/interlock server/_core/socket*` + `npm run check` — xanh; ghi số tệp/test.
- [ ] **Step 8: Commit** `test(scada): nghiem thu R0 - stub kich ban, OPC UA uncertain, bench OpenPLC + .env.example` -- <tệp>.

---

## Bàn giao sau R0 (không làm trong kế hoạch này)
- Áp migration 0430 lên **DEV**: gửi SQL cho phiên điều phối, chờ duyệt.
- Bật cờ ở `.env` dev, build + restart :3000: thuộc phiên điều phối.
- Để R1: Lab "thử đọc một địa chỉ", chỉ báo "Truyền thông n/m" ở thanh trên, C4 (edge), C6 (đọc khối Modbus), C7 (WAL tạm thời).
