# Kế hoạch thực thi — Doc 81 · Đợt 1B "P0 trước khi nối thiết bị thật"

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Mỗi task là một brief yêu cầu + nghiệm thu; implementer đọc mã tại chỗ.

**Goal:** Đóng 8 nhóm P0 ở doc 81 §3.1, tức những lỗ khiến việc nối một thiết bị thật đầu tiên có thể làm treo hoặc sập server, làm chuyển động ngoài mọi cổng, mất dữ liệu mà không báo, hoặc cho phép giả mạo thiết bị.

**Architecture:** Chỉ sửa mã, không thêm migration. Mỗi lỗi phải được tái hiện trước bằng **giả lập giao thức thật chạy trong tiến trình test** (server TCP/Modbus/OPC UA/UR giả, cổng cao ngẫu nhiên), chứ không phải mock hàm, vì 264 + 161 test mock hiện có đều xanh mà không bắt được lỗi nào trong số này (doc 81 §2.4). Các chỗ vá ưu tiên fail-closed.

**Tech Stack:** TypeScript, Express, tRPC v11, Drizzle/Postgres, socket.io, aedes, `modbus-serial`, `mcprotocol`, `node-opcua`, vitest.

**Spec:** `docs/ECOSYSTEM/81_ENGINEERING_CONTROL_KHAO_SAT_SAU_FE_BE_2026-09-27.md` §2–§3.1, phụ lục `docs/ECOSYSTEM/81_ENGINEERING_CONTROL_KHAO_SAT_SAU/BE1_…`, `BE2_…`, `BE3_…`. Đọc đúng dòng phụ lục mà task trỏ tới trước khi làm.

> **Chủ dự án duyệt** 2026-09-26: "Tiếp tục" (sau khi đọc doc 81 §5, trong đó khuyến nghị 1 là chèn Đợt 1B ngay sau Task 2 của Đợt 1). Ruling của bộ điều phối: **Task 10 của Đợt 1** (handshake socket máy) được **gộp vào Task 9 ở đây**, vì cùng tệp và cùng lỗ.

## Global Constraints (bắt buộc cho MỌI task)

1. **Nhánh dùng chung, có nhiều phiên Claude khác cùng làm trên repo.** Không `git add -A`/`git add .`, không `stash`, `checkout --`, `reset`, `rebase`, `push`. Chỉ commit **đúng các tệp mình sửa**, bằng pathspec: `git add -- <tệp…>` rồi `git commit -m "<msg>" -- <tệp…>`. Chạy `git diff --cached --stat` trước khi commit.
2. **Không restart server :3000, không `npm run build`, KHÔNG `npm install`/`npm ci`/`npx … install`, không chạm `node_modules/` hay `dist/`, không sửa `.env`, không ghi vào DB dev (`aoi@5434/aoi_management`).** Test chạy trên DB `_test` (vitest.setup tự ép).
3. **Không nối tới bất kỳ dịch vụ dùng chung nào**: không EMQX `:1884`, không broker aedes `:1883/:8883` của :3000, không cổng 3000, không IP thiết bị thật. Mọi giả lập đều chạy trong tiến trình test, trên `127.0.0.1` với cổng 0 (hệ điều hành cấp), và phải tắt trong `afterAll`. **Tuyệt đối không chạy mã có thể gọi `process.exit` trong tiến trình :3000.**
4. **TDD bắt buộc:** viết test tái hiện, chạy thấy ĐỎ; vá; chạy thấy XANH; rồi **đột biến** (gỡ đúng dòng vá ⇒ ĐỎ ⇒ hoàn nguyên). Ghi RED/GREEN/MUTATION vào báo cáo. Treo phải được đo bằng hạn giờ trong test (vd `await expect(withTimeout(p, 5000)).resolves…`), không để vitest timeout thay cho khẳng định.
5. **Kiểm kiểu:** `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit`. Chạy lại test sẵn có của mọi tệp mình chạm.
6. **Không migration mới.** Cần tính duy nhất hoặc thứ tự ⇒ dùng `pg_advisory_xact_lock` hoặc `SELECT … FOR UPDATE` trong transaction. Nếu thật sự bắt buộc phải có migration ⇒ báo NEEDS_CONTEXT.
7. **Cờ mới:** mặc định trong mã phải là giá trị **an toàn**, trừ khi task ghi khác. Mỗi cờ mới cần một dòng mô tả trong `.env.example` nếu tệp đó có nhóm tương ứng (không sửa `.env`).
8. **Giữ nguyên byte-identical mọi hành vi ngoài phạm vi task.** Tiến trình đang dùng đường cũ hợp lệ (máy pilot có khoá `mk_` đúng, simulator trong repo gửi đúng khoá) phải chạy như cũ; test nào chứng minh điều đó phải còn xanh.
9. **Lỗi nghiệp vụ dùng `appError(...)`/`TRPCError` có mã.** Khoá `appError` mới phải có mục trong từ điển. Chuỗi UI mới đi qua `t()`, khoá có đủ ở `vi.json`/`en.json`/`zh.json` (đọc lại tệp ngay trước khi sửa).
10. **Commit theo kiểu của repo** (message không dấu, tiền tố `fix(ot)`/`fix(robot)`/`fix(ingest)`…, kèm "(doc 81 dot 1B task N)"), kết thúc bằng `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
11. **Log:** không in secret/apiKey/mật khẩu. Log lặp theo từng thông điệp phải được gộp hoặc giới hạn tần suất.

## Review Focus

1. **Nhánh kia của chỗ vá:** vá đường lỗi mà quên đường thành công, hoặc ngược lại (vd `connect()` có hạn giờ nhưng `disconnect()`/`stop()` vẫn treo; ingest REST đã chặn nhưng MQTT vẫn nhận). Mỗi task phải kiểm đủ các nhánh anh em.
2. **Lớp phòng thủ ngoài che đột biến lớp trong:** gỡ bản vá mà test vẫn xanh nhờ một cổng khác. Đột biến phải nhắm **từng lớp**.
3. **Giả lập "tự so với chính mình":** test mà oracle lấy từ chính mã sản phẩm (vd checksum so hàm với chính nó) thì không chứng minh được gì. Oracle phải độc lập: ví dụ trong tài liệu hãng, byte cố định, hoặc server giả viết theo đặc tả.
4. **Thiết bị hợp lệ bị chặn oan:** mọi task siết cổng phải có test chứng minh đường hợp lệ vẫn đi qua được.
5. **Chế độ nửa vời khi đổi mặc định cờ:** mặc định mới phải được áp ở MỌI điểm đọc cờ (grep toàn repo), không để sót một chỗ còn đọc mặc định cũ.

---

## Task 1: Driver không bao giờ treo hoặc làm sập tiến trình (Modbus, Techman, Mitsubishi MC)

Nguồn: BE1 §0 (1)(2), §1.1, §1.3. Tệp: `server/services/ot/drivers/modbusDriver.ts`, `server/services/robot/drivers/techmanDriver.ts` (chỉ phần connect/close, dòng ~234/244), `server/services/ot/drivers/mitsubishiMcDriver.ts`, supervisor/reconnect của OT (grep `reconnecting` trong `server/services/ot/`), `deviceAdapter.testConnection` (grep router).

Yêu cầu:
- Một helper dùng chung (vd `server/services/ot/drivers/boundedClose.ts`) đóng client có hạn giờ: gọi `close(cb)`; nếu callback không chạy trong `closeTimeoutMs` (mặc định 2000) thì `destroy()` socket nền và trả về. Modbus và Techman dùng helper này ở **cả** nhánh catch của `connect()` **lẫn** `disconnect()`.
- `connect()` phải tôn trọng `timeoutMs` với cổng đóng và với IP không định tuyến được: trả lỗi trong khoảng `timeoutMs + 1s`.
- Sau khi server Modbus bị kill rồi bật lại, supervisor phải nối lại được, số lần thử phải tăng, và `sup.stop()` phải trả về trong vòng 3 s.
- Modbus: ghi giá trị ngoài miền của kiểu (vd 70000 vào int16/uint16) ⇒ `ok:false` kèm lý do, không cắt `& 0xffff` rồi báo thành công.
- Mitsubishi MC (`mcprotocol`): không bao giờ để `ETIMEDOUT`/`ECONNRESET` thành `uncaughtException`. Giữ listener `error` trên socket suốt vòng đời; `dropConnection` có hạn giờ và `destroy()`. `connect`/`disconnect` có hạn giờ. Nếu thư viện không vá được an toàn từ ngoài ⇒ driver từ chối kết nối kèm lỗi rõ "dùng SLMP 3E" (appError), **không** mở socket.
- `testConnection` cho mọi driver: hạn giờ tổng (vd `timeoutMs + 2s`), luôn dọn socket.

Nghiệm thu (giả lập thật trong tiến trình, cổng 0):
- Modbus: `ServerTCP` của `modbus-serial` → đọc được; kill ⇒ supervisor ra `reconnecting` ⇒ bật lại ⇒ có mẫu mới trong vòng 5 s; `stop()` < 3 s; cổng đóng ⇒ `connect` bị từ chối trong `timeoutMs + 1s`; ghi 70000 vào int16 ⇒ `ok:false`.
- Techman: server TCP giả nhận rồi đóng ⇒ `connect`/`disconnect` trả về trong hạn giờ.
- MC: server TCP giả **nhận kết nối rồi im lặng** ⇒ trong 30 s không có `uncaughtException` (gắn `process.on('uncaughtException')` trong test để bắt) và `disconnect` trả về trong hạn giờ.
- Đột biến: gỡ `destroy()` dự phòng ⇒ test treo được hạn giờ bắt ĐỎ.

## Task 2: Bật gateway OT không được làm boot treo

Nguồn: BE1 §0 (3). Tệp: `server/_core/index.ts` (~6299 `await startOt()` trước `server.listen` ~6420), `server/services/ot/otManager.ts` và supervisor HA/legacy.

Yêu cầu:
- `startOt()` không còn chặn `server.listen`: khởi động OT chạy nền sau khi listen (hoặc song song), lỗi của nó được log, không bao giờ reject ra ngoài boot.
- Khởi động từng adapter có hạn giờ riêng (vd `OT_ADAPTER_START_TIMEOUT_MS`, mặc định 10000). Adapter quá hạn ⇒ trạng thái `error`/`reconnecting` rồi đi tiếp adapter kế. Một adapter chết không được chặn các adapter còn lại (khởi động độc lập hoặc có giới hạn song song).
- Nhánh legacy: sau khi server bị kill rồi bật lại, phải có mẫu mới (BE1 ghi "legacy 0 mẫu sau khi bật lại").
Nghiệm thu: test cấp otManager với 3 adapter: #1 Modbus giả sống, #2 trỏ cổng đóng, #3 trỏ server TCP im lặng. `startOt` phải resolve trong ≤ hạn giờ + 2 s, adapter #1 có mẫu, #2 và #3 ở trạng thái lỗi. Test cấp boot (hoặc test hàm tách ra khỏi `index.ts`) chứng minh `listen` được gọi trước khi OT xong. Đột biến: bỏ hạn giờ ⇒ ĐỎ.

## Task 3: Không còn đường vòng URScript + HIL trung thực + canary không coi mô phỏng là đạt

Nguồn: BE2 §L3/L3b (`simTargets.validateUrscript`, `ursimPing`, HIL, Fleet canary), doc 81 §3.1 #2 và #4 (canary). Tệp: `server/routers/simTargetsRouter.ts`, `server/services/robot/ursim/ursimHarness.ts`, `server/services/programming/ir/hilGate.ts`, `server/services/programming/fleetRollout.ts` (~:135).

Yêu cầu:
- `validateUrscript` và `ursimPing` **không nhận host/port tuỳ ý**. Input chỉ còn `targetId` trỏ tới một đích URSim đã đăng ký ở server (cấu hình `URSIM_HOST`/danh sách đích sim đã có sẵn; grep cơ chế đăng ký hiện có). Đích đó phải được đánh dấu là giả lập (không phải robot có trong bảng `robots`/adapter đã commission). Không có đích hợp lệ ⇒ `PRECONDITION_FAILED`.
- `ursimPing` phải được gác bằng cùng cờ `URSIM_ENABLED` và quyền giống `validateUrscript` (hiện chỉ cần quyền xem).
- `power on`/`brake release` chỉ được gửi tới đích sim đã đăng ký ở trên, không bao giờ theo tham số của client.
- HIL: `accepted` chỉ đúng khi script **thực sự chạy**, tức cờ `running`/`Program running: true` quan sát được sau khi gửi, VÀ không có lỗi runtime/`safetystatus` bất thường trong cửa sổ quan sát. Chỉ `robotmode ~ RUNNING` thì chưa đủ. Script hỏng (lỗi cú pháp) ⇒ FAIL.
- Fleet canary: `simulated` **không** tính là đạt để promote sang máy đã commission. Canary không ghi HW ⇒ rollout dừng ở trạng thái "cần canary thật" (trạng thái/lý do rõ ràng, i18n nếu có hiện ra UI).
Nghiệm thu: test router: host tuỳ ý bị Zod từ chối, targetId không tồn tại ⇒ PRECONDITION_FAILED, `ursimPing` khi cờ tắt ⇒ bị từ chối. Test HIL với server UR giả (primary 30002 + dashboard 29999 trên cổng 0) trả `robotmode RUNNING` nhưng `running: false` ⇒ FAIL; script chạy thật ⇒ PASS. Test canary: canary `simulated` ⇒ không promote. Đột biến từng điểm ⇒ ĐỎ.

## Task 4: Techman — checksum đúng, phản hồi được phân loại, "deploy" trung thực, script có danh sách trắng

Nguồn: BE2 §2 (Techman), §L3 `robot-tm`, T1 B/C/D/F/G. Tệp: `server/services/robot/drivers/techmanDriver.ts` (phần TMSCT), `server/services/programming/robot/robotTmAdapter.ts`, `server/services/robot/drivers/techman.test.ts` (test ~152-165 đang so hàm với chính nó ⇒ thay bằng oracle độc lập).

Yêu cầu:
- Checksum Listen Node = XOR mọi byte **giữa `$` và `*`** (không tính hai ký tự đó), viết thành 2 chữ số hex hoa. Oracle độc lập là ví dụ trong tài liệu TM: `$TMSCT,25,1,ChangeBase("RobotBase"),*08`. Thêm thêm ≥2 vector nữa tính tay trong test (ghi phép tính trong comment).
- Phân loại phản hồi: `$TMSCT,…,OK,*CS` ⇒ chấp nhận; `…ERROR…` ⇒ `failed` kèm mã lỗi; `$CPERR,…` ⇒ `failed`; checksum sai ⇒ `failed`; kết nối đóng hoặc hết hạn giờ trước khi có reply ⇒ `failed`/`timeout`, **không bao giờ** là `done`. Reply phải khớp id của lệnh đã gửi.
- `robot-tm` "deploy/program download": không được gửi `ScriptExit()` rồi ghi `deployed`. Adapter chưa hỗ trợ tải chương trình ⇒ trả trạng thái `unsupported`/`failed` kèm lý do rõ ràng (i18n nếu hiện ra UI), không ghi xuống robot.
- `robot.actuate` với `params.script` cho Techman: chỉ nhận lệnh trong danh sách trắng (vd `QueueTag`, `ChangeBase`, … mà repo đã dùng; grep). Script tuỳ ý ⇒ `FORBIDDEN`. Ghi danh sách vào hằng số có test.
Nghiệm thu: vector checksum theo tài liệu; server TCP giả trả lần lượt OK/ERROR/CPERR/đóng/im lặng ⇒ đúng phân loại; deploy robot-tm ⇒ không có byte nào gửi tới server giả và kết quả không phải `deployed`; script ngoài danh sách ⇒ FORBIDDEN. Đột biến checksum (tính cả `$`) ⇒ ĐỎ.

## Task 5: Robot — TcpLineClient không lệch nhịp, timeout thì gửi dừng, sổ ghi fail-closed, kiểm safety trước chuyển động

Nguồn: BE2 §L2 (robotCommandDispatcher), §L3b (TcpLineClient T4), §3 S5/S7. Tệp: `server/services/robot/drivers/tcpLineClient.ts`, `server/services/robot/robotCommandDispatcher.ts` (~:159-162 `record()`, ~:181 manual, ~:319-323 interlock, ~:336-349 timeout).

Yêu cầu:
- TcpLineClient: sau khi một lệnh hết hạn giờ, reply đến muộn **không** được gán cho lệnh kế tiếp. Chọn một trong hai cách: tương quan theo id nếu giao thức có; hoặc, nếu không có, huỷ kết nối và nối lại sau timeout, đồng thời bỏ mọi reply của kết nối cũ. Cách đã chọn ghi vào comment.
- Robot dispatcher: khi lệnh chuyển động hết hạn giờ ⇒ gửi lệnh dừng/abort của driver (mỗi driver có `stop`/`abort`; driver không có ⇒ ghi rõ `abort_unsupported` vào sổ), rồi mới ghi `failed`.
- `record()` không được nuốt lỗi insert: ghi sổ **trước** khi gửi chuyển động thất bại ⇒ không gửi chuyển động (fail-closed).
- `triggerKind:"manual"` không được bỏ qua HITL cho lệnh chuyển động, trừ khi đã qua cổng xác nhận người tương đương (ghi rõ điều kiện).
- Kiểm safety-PLC trước chuyển động, dùng cùng preflight với OT (`adapterFacade`). Kết quả `UNKNOWN` hoặc lỗi ⇒ chặn chuyển động.
- Interlock robot: truyền đúng khoá máy/robot, không dùng `adapterId:-1` nếu cổng interlock cần adapter thật (đọc cổng rồi quyết định; ghi lựa chọn).
Nghiệm thu: server TCP giả trả reply chậm hơn timeout cho lệnh A ⇒ lệnh B nhận đúng reply của B (hoặc lỗi kết nối lại), không nhận reply A. Timeout ⇒ server giả nhận được byte stop/abort. `record` ném lỗi ⇒ server giả không nhận byte chuyển động nào. Safety `UNKNOWN` ⇒ chặn. Đột biến từng điểm ⇒ ĐỎ.

## Task 6: Dispatcher OT — HITL gắn với đúng lệnh, sổ ghi trước thiết bị, UNKNOWN chặn, Sparkplug DCMD bắt buộc actionId

Nguồn: BE2 §L2 (commandDispatcher :463, :472-475, :494-515, :660, :852-881; Sparkplug), BE3 §L5. Tệp: `server/services/ot/commandDispatcher.ts`, `server/services/uns/sparkplugCommand.ts` (~:298-306), cổng xác nhận `ai_pending_actions` (grep nơi tạo và nơi xác nhận).

Yêu cầu:
- **HITL bắt buộc cho mọi lệnh ghi thật** (đường không mô phỏng) khi tag/đích đòi xác nhận. Lệnh không kèm `actionId` ⇒ `PRECONDITION_FAILED` (hiện đang cho qua).
- **Gắn với lệnh:** bản ghi `ai_pending_actions` chỉ hợp lệ khi tool, adapter, tag và giá trị (so qua hash chuẩn hoá của payload lưu lúc tạo) **khớp đúng** lệnh đang thực thi; trạng thái phải là `confirmed` (không phải `executed`); và bản ghi được **tiêu thụ đúng một lần** (CAS `confirmed → executed` trong cùng transaction, dùng `FOR UPDATE`). Các hàng `executed` cũ (594 hàng của công cụ lập trình AI) không dùng lại được.
- **Sổ ghi trước thiết bị (write-ahead):** `command_log` là WORM (chỉ INSERT). Trước khi ghi thiết bị, INSERT một dòng `intent` (idempotency key, người, adapter, tag, giá trị); sau đó INSERT một dòng kết quả gắn với intent. Không insert được intent ⇒ không ghi thiết bị. Idempotency: `pg_advisory_xact_lock(hash(idempotencyKey))` rồi mới SELECT, để hai lượt cùng khoá không cùng ghi (không thêm migration).
- **Safety `UNKNOWN`** ở preflight ⇒ chặn ghi (hiện cho qua, ~:660).
- **Sparkplug DCMD/NCMD:** không có `actionId` hợp lệ theo đúng quy tắc trên ⇒ từ chối và ghi sổ `rejected`. Không đặt `confirmedBy=0`. Việc này đóng đường S1 (client MQTT ẩn danh) ở tầng mã, bất kể `SPARKPLUG_COMMAND_ENABLED`.
Nghiệm thu (DB `_test`, mẫu `*.dot0.db.test.ts`): lệnh không có actionId ⇒ từ chối; actionId của tool khác/tag khác/giá trị khác ⇒ từ chối; actionId `executed` ⇒ từ chối; hai lượt song song cùng actionId ⇒ đúng 1 lượt ghi thiết bị (driver giả đếm số lần gọi); insert intent lỗi ⇒ driver giả không bị gọi; safety UNKNOWN ⇒ chặn; Sparkplug DCMD không actionId ⇒ rejected, driver không bị gọi. Đường hợp lệ (actionId khớp, confirmed) ⇒ ghi đúng 1 lần, sổ có intent + kết quả. Đột biến từng điểm ⇒ ĐỎ.

## Task 7: Ingest OT không mất dữ liệu im lặng, `ts` sai không hỏng WAL

Nguồn: BE3 §L4 (REST `/api/ot/ingest` `index.ts:389-439`, `telemetryBus.ts:260`, `storeForward.ts:166, 171-184`). Tệp: `server/_core/index.ts` (route `/api/ot/ingest`), `server/services/telemetryBus.ts`, `server/services/ot/storeForward.ts`.

Yêu cầu:
- Lô lớn: insert theo khối (vd ≤ 1000 dòng một câu, để không vượt giới hạn tham số bind của Postgres) để lô 7.000–12.000 mẫu được lưu đủ. Lô vượt trần cấu hình (vd `OT_INGEST_MAX_BATCH`, mặc định 20000) ⇒ 413.
- Phản hồi phản ánh đúng số đã lưu: `accepted === received` ⇒ 200; một phần ⇒ 207 kèm danh sách chỉ số mẫu bị loại và lý do; 0 do lỗi DB ⇒ 503. Không bao giờ trả `200 ok:true` với `accepted < received`.
- Mẫu có `ts` không hợp lệ hoặc lệch quá xa (vd > 24 h tương lai, cấu hình được) ⇒ loại riêng mẫu đó (400 nếu cả lô hỏng), không làm hỏng cả lô, không đưa vào WAL.
- WAL store-forward: ghi nguyên tử (tệp tạm + `fsync` + `rename`); mẫu hỏng bị cách ly (không chặn replay các mẫu sau); đọc WAL gặp dòng hỏng ⇒ bỏ dòng đó, đếm, log gộp.
Nghiệm thu: DB `_test`: POST 7.000 và 12.000 mẫu ⇒ số dòng DB đúng bằng số gửi; lô trộn 3 mẫu `ts` sai ⇒ 207, đúng 3 bị loại; DB giả lỗi ⇒ 503; WAL chứa một dòng hỏng ⇒ replay vẫn lưu các dòng tốt; kill giữa lúc ghi WAL (mô phỏng bằng ném lỗi giữa chừng) ⇒ tệp cũ còn nguyên. Đột biến chia khối ⇒ ĐỎ.

## Task 8: Ingest v1 — khoá gắn với thiết bị, đúng tầng giới hạn tần suất, mã lỗi đúng nghĩa

Nguồn: BE3 §L4 (`api/v1/router.ts:149-165, 406-410`, `api/v1/auth.ts:147-162`). Tệp: `server/api/v1/router.ts`, `server/api/v1/auth.ts`, nơi gắn limiter cho `/api/v1/ingest/*` (grep).

Yêu cầu:
- **Ràng buộc khoá ↔ thiết bị:** khoá `mk_` hoặc khoá máy chỉ ghi được cho chính máy của nó, hoặc cho danh sách thiết bị được phép của gateway nếu cơ chế đã có (grep). `deviceId`/`machineId` trong body khác máy của khoá ⇒ 403, không ghi. Áp cho `telemetry`, `inspection`, `process-result`.
- Khoá dùng chung plaintext chỉ được nhận khi `MACHINE_SHARED_KEY_ALLOWED` cho phép (hiện nhận bất kể cờ).
- `/api/v1/ingest/*` không dùng limiter 300/phút dành cho trình duyệt nữa. Chuyển sang tầng rate-limit OT hiện có (grep limiter của `/api/ot/ingest`), tính theo khoá.
- `process-result`: lỗi DB/hạ tầng ⇒ 503, quá tần suất ⇒ 429 kèm `Retry-After`, chỉ lỗi dữ liệu mới là 400 (hiện gộp mọi lỗi thành 400 ⇒ SDK vứt bản ghi).
Nghiệm thu: khoá máy A ghi cho máy B ⇒ 403, DB không có dòng; khoá A ghi cho A ⇒ 200 (máy pilot vẫn chạy); khoá dùng chung khi cờ tắt ⇒ 401; 400 request/phút từ một khoá hợp lệ không nhận 429 của limiter trình duyệt; DB giả lỗi ở process-result ⇒ 503. Đột biến bỏ so khớp máy ⇒ ĐỎ.

## Task 9: Socket máy — không còn vô danh (gộp Task 10 Đợt 1)

Nguồn: BE3 §L4b (`socket.ts:555-600`, bão 1.000 `confirm_mapping`), Đợt 1 Task 10, phụ lục F §10.5 doc 80. Tệp: `server/_core/socket.ts`, `server/_core/socketMachineAuth.ts`, harness socket Đợt 0 (`socketPhongQuyen.test.ts` hoặc tương đương).

Yêu cầu:
- Handshake `clientType:"machine"` đọc `auth.machineCode` + `auth.apiKey` và xác thực bằng CÙNG `verifyMachineSocketAuth`. Nếu hợp lệ thì lưu `socket.data.machineId` đã xác thực.
- **Mặc định `SOCKET_MACHINE_AUTH_MODE` trong mã đổi từ `off` sang `enforce`** (Ruling, xem ledger). `off` vẫn đặt được qua env làm lối thoát. Ở `enforce`: `machine:confirm_mapping`, `sync_started`, `heartbeat` không kèm xác thực hợp lệ ⇒ không vào phòng `machine:*`, không ghi DB, không đánh dấu online, và trả sự kiện lỗi.
- Các sự kiện máy dùng `socket.data.machineId` đã xác thực, không tin id trong payload.
- Giới hạn tần suất cho sự kiện `machine:*` theo socket và theo IP (vd 10/s). Vượt ngưỡng ⇒ bỏ qua và đếm, không ghi DB. Log bị gộp.
- **Trước khi đổi mặc định:** grep mọi client socket máy trong repo (`tools/machine-simulator`, `examples/device-client`, `scripts/sim*`) và ghi vào báo cáo cái nào gửi apiKey, cái nào không. Client trong repo không gửi ⇒ sửa client đó cùng commit nếu nhỏ, nếu không thì liệt kê là CÒN MỞ.
Nghiệm thu: harness socket thật. Vô danh `confirm_mapping` ⇒ không vào phòng (không nhận telemetry phát vào phòng), DB không có dòng mới, máy không online. Khoá đúng ⇒ như cũ. Khoá sai ⇒ bị từ chối. Mode `off` qua env ⇒ hành vi cũ. Bão 1.000 sự kiện từ một socket ⇒ số INSERT ≤ ngưỡng. Đột biến: bỏ kiểm ở `enforce` ⇒ ĐỎ.

## Task 10: MQTT broker — không nhận thiết bị lạ không mật khẩu, không flood log

Nguồn: BE3 §L4 (broker aedes), BE1 §1.2 (MQTT ingest). Tệp: `server/services/mqttService.ts` (hoặc nơi khởi tạo aedes; grep `authenticate`/`PENDING`), `server/db/mqtt.ts`.

Yêu cầu:
- `authenticate`: username lạ, hoặc không có/sai mật khẩu ⇒ từ chối CONNECT (return code 4/5). Tự đăng ký PENDING cho thiết bị lạ chỉ chạy khi cờ mới `MQTT_AUTO_REGISTER_UNKNOWN=true` (mặc định **false**), và kể cả khi đó cũng phải có giới hạn tần suất đăng ký (vd 10/phút/IP) để không INSERT `mqtt_clients` ồ ạt.
- Log WARN "publish ngoài phạm vi" gộp theo client + topic trong cửa sổ thời gian (vd 1 dòng/60 s kèm số lần), không in mỗi message một dòng.
- Client nội bộ hợp lệ của chính server (bridge, publisher UNS) vẫn kết nối được. Grep các nơi server tự nối vào broker nhúng và ghi vào báo cáo.
Nghiệm thu: test broker aedes khởi tạo bằng đúng hàm sản phẩm trên cổng 0. Username lạ không mật khẩu ⇒ CONNACK từ chối, không có dòng `mqtt_clients` mới. Client hợp lệ ⇒ kết nối được. 10.000 publish ngoài phạm vi ⇒ ≤ vài dòng log (đếm qua spy logger). Đột biến bỏ kiểm mật khẩu ⇒ ĐỎ.

## Task 11: `/health`, `/readyz` nói thật; `/metrics` có xác thực

Nguồn: BE3 §L7 (`index.ts:444-451`, `healthProbes.ts:49-57`, `index.ts:352-354`). Tệp: `server/_core/healthProbes.ts`, `server/_core/index.ts` (mount health/metrics), `server/_core/metrics.ts`.

Yêu cầu:
- `/readyz`: chạy `SELECT 1` có hạn giờ (vd 1500 ms). Lỗi hoặc quá hạn ⇒ 503 `{db:"down"}`. `/health` (liveness) giữ nhẹ nhưng không được báo `db:ok` khi chưa ping. Nếu nó hiện trạng thái DB thì phải lấy từ lần ping gần nhất (cache ≤ 5 s), không phải từ `Boolean(getDb())`.
- `/metrics`: yêu cầu `Authorization: Bearer <METRICS_TOKEN>` khi `METRICS_TOKEN` được đặt. Khi không đặt ⇒ chỉ nhận request từ loopback (`127.0.0.1`/`::1`), và **không** tin `X-Forwarded-For` trừ khi `trust proxy` đã cấu hình. Ngoài điều kiện đó ⇒ 401/403.
- Kiểm mọi route health/metrics khác (grep `healthz`, `livez`, `/api/health`, `/api/observability/metrics`) và áp cùng quy tắc, hoặc ghi rõ lý do không áp.
Nghiệm thu: test với `getDb` giả ném lỗi/treo ⇒ `/readyz` 503 trong ≤ 2 s; DB `_test` sống ⇒ 200. `/metrics` từ IP không phải loopback (giả lập `req.socket.remoteAddress`) ⇒ 403; token đúng ⇒ 200; token sai ⇒ 401. Đột biến trả về kiểm `Boolean(getDb())` ⇒ ĐỎ.

## Task 12: OPC UA — bảo mật SignAndEncrypt, ghi đúng kiểu, một địa chỉ sai không làm hỏng cả lô

Nguồn: BE1 §1.1 (OPC UA), doc 81 §3.1 #8. Tệp: `server/services/ot/drivers/opcuaDriver.ts`, kiểu cấu hình endpoint adapter (grep `securityMode`/`endpointUrl`), Euromap 77 nếu dùng lại driver.

Yêu cầu:
- Cấu hình endpoint hỗ trợ `securityMode` (`None`|`Sign`|`SignAndEncrypt`), `securityPolicy` (`None`|`Basic256Sha256`|`Aes128_Sha256_RsaOaep`|`Aes256_Sha256_RsaPss`), xác thực ẩn danh hoặc username/password (mật khẩu đọc qua cơ chế secret sẵn có, không lưu plaintext mới). Có thư mục PKI của client (`OPCUA_PKI_DIR`, mặc định trong thư mục dữ liệu của app) và chính sách tin chứng chỉ server: `trustOnFirstUse` **tắt** theo mặc định; chứng chỉ server phải nằm trong trust-list. Mặc định khi không cấu hình giữ `None` để không đổi hành vi cũ, nhưng log cảnh báo một lần.
- Ghi: đọc `DataType` của node (cache theo nodeId) rồi ép giá trị về đúng kiểu (`Float`, `Int16`, `UInt16`, `UInt32`, `Byte`, `Boolean`, `String`, `Double`, `Int32`), kiểm miền giá trị ⇒ ngoài miền thì `ok:false`.
- Đọc lô: nodeId sai chỉ làm tag đó `bad` với status code của nó, các tag khác vẫn `good`.
- Hỗ trợ `nsu=<uri>;…` (phân giải qua namespace array).
Nghiệm thu: server `node-opcua` trong tiến trình (cổng 0) chỉ mở endpoint SignAndEncrypt/Basic256Sha256 với chứng chỉ tự sinh vào thư mục tạm. Chưa trust ⇒ kết nối bị từ chối có lý do. Đã trust ⇒ đọc/ghi được. Ghi Float/Int16/UInt16/UInt32/Byte đọc lại đúng giá trị. Lô 5 tag có 1 nodeId sai ⇒ 4 good + 1 bad. Đột biến bỏ ép kiểu ⇒ `BadTypeMismatch` ⇒ ĐỎ. (`node-opcua` đã có trong dependencies. Không cài thêm gói; nếu thiếu module server thì báo NEEDS_CONTEXT.)
