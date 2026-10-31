# SCADA R1b-2b-2a · An toàn và đúng đắn của đường STOP — Kế hoạch thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đóng phần an toàn / đúng đắn của đường STOP còn lại sau R1b-2b-1, theo thứ tự điều phối 61 → 66 → 62 → …:
- mọi lượt ghi nền (bắn-rồi-quên) trên đường `dungMay` chịu CÙNG trần ghi treo 8 của T9 — bảng audit chậm không còn cạn được pool (mục 61, task ĐẦU sau Task 0);
- hết hạn yêu cầu của CHÍNH driver ⇒ `timeout` (không rõ kết cục), không bao giờ `failed`; lỗi của lời ghi trong ân hạn B3 luôn ghi rủi ro "lệnh ghi cũ" (mục 66);
- `interlock.resolveEvent` kiểm phạm vi dưới khoá ADAPTER → LUẬT, không gọi pool trong giao dịch; census ghim cả hai luật (mục 62, 63);
- mất liên kết giữa một lô ghi ⇒ nhãn theo TỪNG write: write chưa bao giờ giao cho thư viện là `failed` (mục 69); mục rủi ro "lệnh ghi cũ" có trần nhưng giữ ý định ĐẦU (mục 70);
- so đọc lại tag int có scale lẻ dùng số THÔ thật của driver (mục 64);
- cảnh báo khi `DB_POOL_MAX` làm hụt ngân sách pool của STOP (mục 71); cầu chì Redis ~5 s cho bộ giới hạn (mục 72);
- Task 0 sửa ba điểm yếu của thiết bị đo đồng hồ tường mà đột biến trễ 800 ms tìm ra.

**Architecture:**
- **Không thêm đường ghi, không thêm thủ tục tRPC.** Mọi lệnh tới thiết bị vẫn qua `dispatch()` (`server/services/ot/commandDispatcher.ts`). STOP khớp ghim không bị phần mềm chặn ở bất kỳ task nào; mọi thay đổi chỉ đổi NHÃN kết quả, sổ, log, hoặc thời điểm trả lời.
- **Một bộ đếm ghi treo cho cả tiến trình** (mục 61): bộ đếm + trần chuyển từ `lenhHmi.ts` xuống module thuần lớp OT mới `server/services/ot/ghiTreoCoTran.ts` để cả `lenhHmi.ts` lẫn `commandDispatcher.ts` dùng chung; tên công khai cũ trong `lenhHmi.ts` giữ nguyên (tái xuất).
- **Một trường kết quả cho "không rõ kết cục" theo từng write** (mục 66, 69): `OtCommandResult.ketCucKhongRo?: "mat_lien_ket" | "qua_han_driver"`. Driver trả nó cho write đã giao thư viện mà kết cục không rõ; `executeOtDeviceWrite` ánh xạ nó sang `timeout`; dispatcher cuộn lên `timeout` nếu có ≥ 1 write `timeout`. Nhánh `catch` của lỗi có kiểu ném cả lô GIỮ (driver plugin / phòng thủ).
- **Đọc lại thô không cần phương thức driver mới** (mục 64): mọi driver dựng sẵn đã điền `OtSample.raw` (giá trị trước `scaleXuoi`). Thêm MỘT cờ khả năng tuỳ chọn `OtDriver.thoDocLaiTinDuoc` (sáu driver dựng sẵn khai `true`; stub / plugin không khai ⇒ so mô phỏng như R1b-2b-1 T6).
- **Không migration.** Không task nào cần schema. Dải số ở Global Constraints.

**Tech Stack:** TypeScript, tRPC 11, drizzle + Postgres (`_test`), express-rate-limit 8, ioredis, React 19, vitest (+ jsdom cho `*.dom.test.tsx`), TypeScript compiler API (census AST), modbus-serial 8.0.25, nodes7 0.3.x, mcprotocol 0.1.2, st-ethernet-ip 2.7.5, node-opcua 2.174.

**Spec (thứ tự ưu tiên khi mâu thuẫn):**
1. Kế hoạch R1b-2b-1 `docs/superpowers/plans/2026-10-26-scada-r1b-2b-1-an-toan-va-no.md`: Global Constraints, mục "ĐÃ DUYỆT", "Danh sách R1b-2b-2" mục 61–72 (nguyên văn của điều phối, có ngày).
2. Báo cáo nghiệm thu R1b-2b-1 `docs/superpowers/plans/2026-10-26-scada-r1b-2b-1-bao-cao-nghiem-thu.md` (§giới hạn, §thay đổi hành vi nhìn thấy được).
3. Sổ R1b-2b-1 `.superpowers/sdd/2026-10-26-scada-r1b-2b-1-an-toan-va-no/progress.md` (dòng 104–113: T9 + I1; 187–206: T17 Phương án A, New-1; 219–238: rà soát cuối I-1, kiem-dinh a–d) và `task-17-report.md` (§4 bảng quét driver; "Fix round 2", dòng "Ngoài phạm vi").
4. Báo cáo đột biến trễ `.superpowers/sdd/2026-10-27-scada-r1b-2b-2/delay-mutation-report.md` (Task 0).
5. Báo cáo thiết kế đã duyệt `docs/superpowers/specs/2026-10-23-scada-thiet-ke-he-sinh-thai.html` (D3, D5, D9–D11) — chỉ khi 1–4 im lặng.

**Phụ thuộc:**
- Nhánh `feat/scada-r1b2b2` tạo từ main `2f0a99fc0` (đã có R1b-2b-1 + `doLagBucleSuKien` sửa gốc `b7388c3c0`). Số dòng trong kế hoạch này là của `2f0a99fc0`.
- R1b-2b-2b (nhật ký / UI / tính năng driver / AI / phần còn lại của census) viết kế hoạch riêng sau khi R1b-2b-2a được duyệt — danh sách 1-1 ở cuối tệp.

---

## Global Constraints

- **Nơi làm và nhánh.**
  - Làm trong worktree `D:\SOURCES\_scada_r1a_wt`, nhánh `feat/scada-r1b2b2`.
  - **Không** sửa cây chính `D:\SOURCES\avi-aoi-management`, worktree khác, hay nhánh khác.
  - **Không push.** Gộp main chỉ ở điểm dừng giữa hai task, do bộ điều khiển làm, rồi chạy lại mọi census.
- **Commit.** Commit bằng pathspec: `git add <tệp…>` rồi `git commit -m "…" -- <tệp…>` (hook BG-124 chặn commit trần). Cuối message có một dòng trống rồi `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Không heredoc, không `node -e` có backtick.
- **`AI_OT_CONTROL_ENABLED`.**
  - Cờ GIỮ TẮT. KHÔNG task nào bật nó, kể cả trong cấu hình, giá trị mặc định, tài liệu, script hay `.env.example`.
  - Chỉ đặt trong tiến trình test / bench, luôn `"false"` ở lưới nghiệm thu và bench.
  - Báo cáo nghiệm thu không được viết câu nào ngụ ý "đã sẵn sàng bật".
- **Không sửa / không `source` `.env`.** Đọc giá trị `.env` (nếu cần) bằng node, không bằng shell. Không cờ mới, không biến môi trường mới; trần / hạn mới là hằng có tên trong mã.
- **DB.** Người thực thi chỉ chạy trên `_test`. Truy vấn chỉ đọc trên DEV do bộ điều khiển chạy (`SET default_transaction_read_only = on`). Không docker. Không khoá bảng dùng chung (`LOCK TABLE`, khoá tư vấn toàn cục như `AUDIT_CHAIN_LOCK`) trong test: sổ / audit chậm dựng bằng khoá tư vấn 2-khoá của CHÍNH tệp `(LOP, pid)` — khuôn `chamThu` của `scadaCommandsRouter.dungMay.soCoHan.r1b2b.db.test.ts:41-60`.
- **Không chạm :3000, :8091, GPU.** Không nạp gì xuống thiết bị. Bench chỉ khi điều phối nói "OK chạy ngay" (xem Task 11).
- **Migration — dải 0435–0439.** Kế hoạch này **không cần migration**. Task nào phát hiện cần schema: DỪNG, báo bộ điều khiển TRƯỚC (điều phối xác nhận số), viết tay theo khuôn `scripts/apply-migration-0433.mjs`, idempotent, DDL bằng owner `aoi`, verify bằng `avi_app`; áp TEST (`--test-only`) thoải mái; gửi SQL cho điều phối TRƯỚC khi áp DEV, DEV chỉ sau "áp". 0423–0429 thuộc phiên khác: không bao giờ dùng. Không sửa `drizzle/meta/_journal.json`.
- **Bất biến STOP (mọi task).**
  - STOP khớp ghim KHÔNG BAO GIỜ bị phần mềm chặn (cổng chế độ / khoá chọn / dải / bước / lưới / kiểu / sổ / pool / Redis).
  - Không ack giả: không bao giờ `acked*` khi thiết bị chưa trả lời; không bao giờ `failed` cho write CÓ THỂ đã tới thiết bị (đó là `timeout`).
  - Thứ tự khoá dự án: ADAPTER (FOR SHARE / UPDATE, id tăng) → LUẬT interlock (FOR SHARE / UPDATE, theo id) → TAG (FOR UPDATE, ORDER BY id) → KÊNH CHẾ ĐỘ (`troLaiKenh.ts`). Hàng `interlock_events` (nếu khoá) SAU luật. Khoá chuỗi audit (`AUDIT_CHAIN_LOCK`) SAU mọi khoá hàng.
  - Phạm vi kiểm LẠI dưới khoá; không gọi pool (`getDb()` / helper đọc qua pool) bên trong giao dịch đang giữ khoá hàng.
  - Danh tính luôn từ `ctx.user`, không bao giờ từ input. "Không thấy" và "ngoài phạm vi" trả CÙNG một lỗi NOT_FOUND.
- **Mã lỗi và i18n.** Kế hoạch này không thêm mã `appErrorCodes`. Khoá i18n mới chỉ ở Task 9 (`oversight.posture.poolStopThieu`, vi/en/zh, placeholder khớp); `npm run i18n:check` sạch.
- **Census.** Không thủ tục tRPC mới ⇒ ghim `phamViDocCensus` / `congGiayPhepAiCensus` / `phamViGhiCensus` không đổi (đo lại ở mỗi task chạm router, không đoán). Lỗi mới là lỗi CÓ KIỂU ⇒ ghim `server/_core/rawErrorCensus.test.ts` chỉ được GIẢM; số mới đo và ghi trong commit.
- **Luật chạy test của điều phối.** Trong một task chỉ chạy: test của task + census / gate / guard (`grep -il "census\|gate\|guard"` trên tên tệp, gồm `*Gate*.test.ts`) + thư mục liên quan nêu ở bước "Chạy lại". KHÔNG chạy `luoi-truoc-gop`, KHÔNG chạy cây unit đầy đủ. Toàn bộ lưới CHỈ ở Task 11, sau khi điều phối nói "OK chạy ngay".
- **Test.**
  - Không DB: `npx vitest run <tệp>`. DB: `npx vitest run -c vitest.db.config.ts <tệp>`. DOM: `*.dom.test.tsx` với docblock `// @vitest-environment jsdom`. Người dùng test bằng `taoNguoiDungTest`. Mock module dùng `importOriginal`.
  - Test thời gian thật < 10 s, nếu không thì đồng hồ giả hoặc cờ opt-in.
- **Bài học bắt buộc (sổ R1b-2b-1).**
  - **Cận trên đồng hồ tường** dùng `batDauDoLag` (`server/testing/doLagBucleSuKien.ts`) với trần `dung(tran)` NHỎ HƠN biên lỗi muốn bắt, và mỗi cận phải có HAI đột biến đỏ: vòng lặp bận (chặn đồng bộ) VÀ trễ không chặn (`await new Promise(r => setTimeout(r, N))`) đặt TRONG đường được đo.
  - **Đột biến phải trúng đúng hàm**: ghi tệp:dòng của chỗ đột biến trong commit; đột biến "không làm gì" (đỏ vì lý do khác hoặc xanh vì đặt sai chỗ) bị loại và làm lại.
  - **Driver giả phải làm tròn / giải mã như driver thật**: test nhãn đọc lại dùng driver THẬT (`ModbusDriver` + client giả trong bộ nhớ, khuôn `otDeviceWrite.readback.r1b2b.test.ts`), không dùng driver giả trả giá trị tuỳ ý.
  - **Ngân sách pool cộng dồn qua task**: mọi trần mới giữ kết nối pool phải vào `server/services/scada/nganSachPoolStop.test.ts`.
  - **Redis giả trong tiến trình phụ thuộc tải**: ca "Redis khoẻ" không được dựa vào `commandTimeout` 250 ms thật (khuôn sửa `5f8b78891`: nâng hạn qua seam test, đếm công việc).
- **Mỗi task.** Test đỏ đúng chỗ → mã → xanh → **đột biến ghi trong task làm đỏ ≥ 1 test** (chạy, ghi tệp:dòng + kết quả vào commit, hoàn tác, `git diff` rỗng) → commit. Trước khi bàn giao task cuối: chạy ĐỦ census (grep -i census toàn cây + `server/_core` + routers / services / routes + `client/src` + `shared`).
- **Tệp và màu.** Không xoá tệp. Không đổi tên công khai đang có người gọi (giữ bằng tái xuất). Màu chỉ dùng token sẵn có.

## Review Focus

1. **Người vận hành bấm DỪNG liên tục trong lúc CHỈ bảng audit chậm** (chuỗi băm audit bị giữ, SEC_PLATFORM bật) ⇒ mọi lượt STOP vẫn `acked_verified`; số lượt ghi nền treo (sổ + audit cộng chung) ≤ 8; lượt audit bị bỏ qua có log mang nội dung hàng; STOP của máy khác sau đó vẫn gửi trong hạn. Test ở Task 1.
2. **PLC im lặng với một lệnh STOP** (không trả lời, không đóng socket) và hạn của CHÍNH driver (300 ms) ngắn hơn hạn lệnh (2000 ms) ⇒ `status "timeout"`, câu "outcome unknown", băng E-STOP cứng `khong_ro` ở HMI — không bao giờ `failed`; có tuần tự hoá ⇒ STOP acked kế tiếp có canh chỉ-báo-động. Test ở Task 2.
3. **Lô ghi OPC UA có một write hỏng ép kiểu cục bộ và liên kết rớt giữa lô** ⇒ write hỏng ép kiểu `failed` (chưa bao giờ gửi), các write đã gửi `timeout`. Cùng hình với Modbus nhiều write: write đã acked trước điểm rớt giữ `acked*`, write sau điểm rớt `failed` "not sent". Test ở Task 6.
4. **Tag int scale 0,5 ghi 2,5 mà thiết bị giữ thô 6** ⇒ `acked_unverified` (trước: `acked_verified` vì 6 × 0,5 và 5 × 0,5 cùng làm tròn về 3). Thiết bị giữ thô 5 ⇒ `acked_verified`. Test ở Task 8.
5. **Redis chết, một yêu cầu STOP / đăng nhập đi qua nhiều tầng giới hạn nối tiếp** ⇒ chỉ lượt Redis ĐẦU TIÊN chờ (≤ 250 ms), các tầng sau và mọi yêu cầu trong 5 s kế đi thẳng bộ nhớ; bộ giới hạn đăng nhập vẫn đếm (429 đúng lượt); STOP trả lời < 1 s. Test ở Task 10.

---

### Task 0: Thiết bị đo đồng hồ tường của đường STOP (chỉ test)

**Quyết định (một đoạn):** sửa thiết bị đo, KHÔNG nới ngưỡng sản phẩm. (a) Cận 800 ms cho một thao tác ~7 ms tha thứ một trễ 800 ms ⇒ siết về `300 + dung(150)`. (b) Ca "CÓ ghim < 1700" đo cả thời gian DỰNG RÀO (bão hoà pool + chứng minh bằng `pg_locks`) — phần của thiết bị đo, không phải sản phẩm — nên đỏ khi máy tải nặng; tách thành hai đoạn sản phẩm (trước rào, sau rào) có tổng đúng 1700 ms như cận cũ. (c) Ca reset-treo của `dot4` có ~160 ms dư nhưng hai cận (lag 400 ms và cận thô `within(pStop, … + 700)`) cùng bắt mọi đột biến ≥ 300 ms ⇒ chỉ ghi chú, không sửa mã.

**Files:**
- Modify (test):
  - `server/routers/scadaCommandsRouter.dungMay.hanTruocGui.r1b2.db.test.ts:710-724` (ca "handler nhận hạn tổng ĐÃ cạn");
  - `server/routers/scadaCommandsRouter.dungMay.soCoHan.r1b2b.db.test.ts:179-182` (hằng), `:251-253` (`datBaoHoa` ghi mốc vào rào), `:493-541` (ca "★ máy CÓ ghim");
  - `server/services/ot/commandTimedOutWriteStop.dot4.test.ts:332-341` (chỉ chú thích).
- Test: chính các tệp trên.

**Interfaces:**
- Produces (cục bộ trong `soCoHan.r1b2b.db.test.ts`): `const CAN_TRUOC_RAO_MS = 300`, `const CAN_SAU_RAO_MS = 1_400`; `let lucVaoRao: number | null` (đặt ở dòng đầu `datBaoHoa`, trước `moBaoHoa`); `BaoHoa.lucBaoHoa` có sẵn (`:243`).

- [ ] **Step 1: Đo trước (cổng).** Chạy riêng `soCoHan.r1b2b.db.test.ts` 3 lượt, không đột biến, với `console.info` tạm in ba đoạn của ca "CÓ ghim": `truocRao = lucVaoRao − batDau`, `dungRao = lucBaoHoa − lucVaoRao`, `sauRao = tra − lucBaoHoa`. Mong đợi: phần vượt 1700 ms nằm ở `dungRao`. **Phần vượt nằm ở `truocRao` hoặc `sauRao` ⇒ DỪNG, báo bộ điều khiển kèm số đo** (khi đó là sản phẩm chậm, không phải thiết bị đo).
- [ ] **Step 2: Sửa test.**

```ts
// hanTruocGui.r1b2.db.test.ts — ca "handler nhận hạn tổng ĐÃ cạn" (R1b-2b-2a T0 a, ghi ngày 2026-10-27)
// thao tác thật ~7 ms; trần nới 150 < 300 ⇒ trễ 800 ms (không chặn) và vòng bận 900 ms đều đỏ
expect(troi).toBeLessThan(300 + (await lag.dung(150)));

// soCoHan.r1b2b.db.test.ts — ca "★ máy CÓ ghim" (R1b-2b-2a T0 b): đoạn DỰNG RÀO là thiết bị đo, không tính
expect(CAN_TRUOC_RAO_MS + CAN_SAU_RAO_MS).toBe(CAN_CO_GHIM_MS); // tổng ngưỡng sản phẩm KHÔNG đổi
const tra = Date.now();
const phanNoi = await lag.dung(300);
expect(lucVaoRao, "rào đã vào").not.toBeNull();
const truocRao = lucVaoRao! - batDau;
const sauRao = tra - baoHoa!.lucBaoHoa;
expect(truocRao).toBeLessThan(CAN_TRUOC_RAO_MS + phanNoi);
expect(sauRao).toBeGreaterThanOrEqual(2 * HAN_GHI_SO_STOP_HMI_MS - 10); // HAI lượt sổ thật chạm hạn
expect(sauRao).toBeLessThan(CAN_SAU_RAO_MS + phanNoi);
expect(nhanGhiLoiChot()).toEqual(["hmi_stop_sau_dispatch_qua_han", "attempts_hmi_stop_qua_han"]); // đếm công việc: đúng hai lượt
```

  - Bỏ hai dòng cận cũ `troi >= 2*500-10` / `troi < CAN_CO_GHIM_MS + phanNoi` của ca này; mọi oracle khác giữ nguyên.
  - `dot4.test.ts:341`: thêm chú thích một dòng "dư ~160 ms so với nền ~1 900 ms; đột biến ≥ 300 ms đỏ ở cận này, ≥ 450 ms đỏ trước ở `within(pStop, …+700)` — R1b-2b-2a T0 c, 2026-10-27".
- [ ] **Step 3: Chạy** mỗi tệp riêng 5 lượt không đột biến (hanTruocGui, soCoHan bằng `-c vitest.db.config.ts`; dot4 bằng `npx vitest run`). Mong đợi: xanh 5/5; ghi số `truocRao` / `sauRao` / `phanNoi` lớn nhất vào commit.
- [ ] **Step 4: Đột biến (mỗi cái chạy 3 lượt, ghi tệp:dòng):**
  - (a) trễ không chặn 800 ms ở đầu khối `try` của `dungMayHmi` (`server/services/scada/lenhHmi.ts:1850`, trước `han(getDb())`) ⇒ ca hanTruocGui ĐỎ 3/3; vòng bận 900 ms cùng chỗ ⇒ ĐỎ;
  - (b) trễ không chặn 800 ms ở `lenhHmi.ts:1731` (đầu `dungMayHmi`) ⇒ ca "CÓ ghim" ĐỎ ở cận `truocRao`; `ghiSoCoHan` bỏ hẹn giờ 500 ms (chờ lượt ghi tới xong) ⇒ ĐỎ ở cận `sauRao`;
  - Hoàn tác, `git diff` rỗng.
- [ ] **Step 5: Commit** `test(scada): siet thiet bi do dong ho tuong duong STOP - han truoc gui 300+dung(150), soCoHan tach doan dung rao khoi nguong san pham (tong 1700 khong doi), ghi chu du dot4 (R1b-2b-2a T0)`.

### Task 1: Một bộ đếm ghi treo cho MỌI lượt ghi nền của đường STOP (mục 61)

**Quyết định (một đoạn):** các lượt ghi bắn-rồi-quên có từ trước đi vào CÙNG bộ đếm `TRAN_GHI_SO_TREO_STOP_HMI` = 8 với `ghiSoCoHan` — trần CHUNG, không phải 8 + 8. Lý do: chúng giữ cùng loại tài nguyên (kết nối pool chính) trong cùng điều kiện (DB chậm), nên ngân sách `nganSachPoolStop` (khảo sát 8 + ghi treo 8 ≤ 25 − 9) giữ NGUYÊN số mà vẫn đúng; tách trần riêng sẽ đòi 8 + 8 + 8 = 24 > 16. Cái giá: khi audit chậm, lượt sổ attempts có thể bị bỏ qua sớm hơn (đã log nội dung, `command_log` của dispatch vẫn có STOP). Cần điều phối xác nhận (Q1, Q2).

**Files:**
- Create: `server/services/ot/ghiTreoCoTran.ts`; `server/services/ot/ghiTreoCoTran.test.ts`; `server/routers/scadaCommandsRouter.dungMay.ghiNenCoTran.r1b2b2.db.test.ts`.
- Modify:
  - `server/services/scada/lenhHmi.ts`: hằng `:1387`, `:1398`, `ghiSoTreo` `:1410-1414`, `ghiSoCoHan` `:1427-1468` (uỷ quyền cho module mới); `ghiAuditBuocDoiMatKhau` `:1753-1776`; `tuChoiQuaHan` `:1783-1842` (attempts `:1799-1810`, audit `:1817-1839`); `ghiAudit` `:1950-1984`; vòng `STOP_QUA_HAN` theo adapter `:2035-2051`;
  - `server/services/ot/commandDispatcher.ts` `auditPinnedStopOverride` `:1941-1969`;
  - `server/services/scada/nganSachPoolStop.test.ts` (ca mới).
- Test: ba tệp mới + `nganSachPoolStop.test.ts`; hồi quy `scadaCommandsRouter.dungMay.soCoHan.r1b2b.db.test.ts`, `scadaCommandsRouter.dungMay.hanTruocGui.r1b2.db.test.ts`, `scadaCommandsRouter.dungMay.db.test.ts`.

**Interfaces:**
- Consumes: `ghiLoiChot(err, requestId, cho)` (`lenhHmi.ts:772`), `ghiNhanStopQuaHanKhongGhiSo(buoc)` (`server/_core/hanStopHmi.ts:136`), `recordAuditEvent` (`server/services/audit/controlAuditService.ts`).
- Produces (`ghiTreoCoTran.ts`, thuần — chỉ phụ thuộc `server/logger`):
  - `export const HAN_GHI_TREO_MS = 500`; `export const TRAN_GHI_TREO_STOP = 8`.
  - `export interface TuyChonGhiCoTran { nhan: string; requestId: string; noiDung?: unknown; khiLoi?: (e: unknown, muon: boolean) => void; khiBoQua?: () => void }`.
  - `export function ghiCoTran(viec: () => Promise<unknown>, o: TuyChonGhiCoTran): Promise<void>` — đúng ngữ nghĩa `ghiSoCoHan` hôm nay (`lenhHmi.ts:1416-1426`): kiểm trần TRƯỚC khi gọi `viec`; đầy ⇒ không gọi, log `<nhan>_bo_qua_day` mức error kèm `noiDung`, gọi `khiBoQua`, trả ngay; xong trong hạn ⇒ trả lúc xong; quá `HAN_GHI_TREO_MS` ⇒ đếm +1, log `<nhan>_qua_han`, trả; lượt bỏ rơi xong ⇒ đếm −1 (log `_muon_xong` / `khiLoi(e, true)`); handler gắn THẲNG lên promise (ném muộn không thành `unhandledRejection`). Không bao giờ reject. Hẹn giờ `unref`.
  - `export function soGhiTreoStop(): number`; `export function _datLaiGhiTreoChoTest(): void`.
- Produces (`lenhHmi.ts`, tên cũ giữ):
  - `export const HAN_GHI_SO_STOP_HMI_MS = HAN_GHI_TREO_MS`; `export const TRAN_GHI_SO_TREO_STOP_HMI = TRAN_GHI_TREO_STOP`; `export function soGhiSoTreoStopHmi(): number` ⇒ `soGhiTreoStop()`.
  - `ghiSoCoHan(viec, nhan, requestId, noiDung?, khiKhongVaoSo?: () => void): Promise<void>` — thêm tham số 5 tuỳ chọn; gọi `ghiCoTran` với `khiLoi` = `ghiLoiChot` (+ `khiKhongVaoSo`), `khiBoQua` = `khiKhongVaoSo`.

Chốt:
- **Mọi lượt ghi nền trên đường `dungMay` là THUNK qua `ghiSoCoHan` / `ghiCoTran`, gọi bằng `void`** (không chờ — câu trả lời STOP không đổi thời điểm):
  - `ghiAuditBuocDoiMatKhau`, audit `QUA_HAN` của `tuChoiQuaHan`, `ghiAudit` (DA_GUI / CHUA_GHIM_STOP / GHIM_MUC_CAO): `recordAuditEvent(...)` KHÔNG còn được gọi sớm (hôm nay `const viec = recordAuditEvent(...)` phát truy vấn trước mọi kiểm); `noiDung = { bang: "control_audit_log", ...<AuditEventInput> }`.
  - attempts của `tuChoiQuaHan` và vòng `STOP_QUA_HAN` theo adapter: `khiKhongVaoSo = () => ghiNhanStopQuaHanKhongGhiSo("ghi_so_loi")` — dòng bỏ qua vì đầy CŨNG đếm vào posture `stopQuaHan24h` (dùng lại nhóm `ghi_so_loi`, tập đóng `BuocKhongGhiSo` không đổi).
  - `voiHanUnref(..., HMI_STOP_AUDIT_DEADLINE_MS)` quanh audit bị thay; hằng `HMI_STOP_AUDIT_DEADLINE_MS` (`:1374`) giữ (có người đọc khác).
- **Dispatcher:** `auditPinnedStopOverride` chạy `work` qua `ghiCoTran(() => work, { nhan: "dispatch_pinned_stop_audit", requestId: <idempotencyKey ?? "-">, noiDung: { action, resultId, adapterId } })` — cho MỌI STOP ghim (một luật cho mọi nguồn STOP), `void`. Lượt `getDb()` + `import()` nằm TRONG thunk.
- **Ngoài phạm vi (ghi giới hạn):** audit nền của B3 / canh STOP (`auditWriteOverlapRisk`, báo động `ot_stop_unverified`) — tối đa một lượt mỗi adapter mỗi sự cố, không lặp theo lần bấm; lượt đọc / chèn dòng chờ TRƯỚC-gửi bị bỏ rơi khi quá hạn (`trongHanStop`) — đó là người dùng phần dự trữ 9; `raiseUnverifiedStopRefusedAlert` (không phải STOP ghim). Ghi vào báo cáo §giới hạn và danh sách R1b-2b-2b.

- [ ] **Step 1: Test đỏ.**

```ts
// ghiTreoCoTran.test.ts (đồng hồ giả)
beforeEach(() => { vi.useFakeTimers(); _datLaiGhiTreoChoTest(); });
afterEach(() => vi.useRealTimers());
const treoMai = () => new Promise<never>(() => {});
it("trần 8 dùng chung: 8 lượt quá 500 ms còn treo ⇒ lượt 9 KHÔNG được phát, khiBoQua 1 lần", async () => {
  for (let i = 0; i < 8; i++) void ghiCoTran(treoMai, { nhan: `so${i}`, requestId: "r" });
  await vi.advanceTimersByTimeAsync(HAN_GHI_TREO_MS + 1);
  expect(soGhiTreoStop()).toBe(8);
  const viec9 = vi.fn(treoMai);
  const boQua = vi.fn();
  await ghiCoTran(viec9, { nhan: "audit_hmi_stop", requestId: "r", noiDung: { bang: "control_audit_log", action: "scada_hmi_stop" }, khiBoQua: boQua });
  expect(viec9).not.toHaveBeenCalled();
  expect(boQua).toHaveBeenCalledTimes(1);
});
it("DB nhanh không bao giờ bị bỏ qua: 100 lượt xong trong 10 ms ⇒ đếm 0, mọi viec được gọi", async () => { /* … */ });
it("lượt bỏ rơi reject ở 800 ms ⇒ đếm về 0, khiLoi(e, true), 0 unhandledRejection (process.on)", async () => { /* … */ });
it("TRAN_GHI_SO_TREO_STOP_HMI của lenhHmi CHÍNH LÀ TRAN_GHI_TREO_STOP (một bộ đếm)", () => {
  expect(TRAN_GHI_SO_TREO_STOP_HMI).toBe(TRAN_GHI_TREO_STOP);
  expect(HAN_GHI_SO_STOP_HMI_MS).toBe(HAN_GHI_TREO_MS);
});
```

  - `nganSachPoolStop.test.ts` — ca mới "★ mọi lượt ghi nền của đường STOP đi qua bộ đếm chung" (AST, khuôn `thuTuKhoaTag.census.test.ts:1-60`): trong `lenhHmi.ts` (thân `dungMayHmi`, `guiStopMotAdapter`, `ghiThuCoHan`) và `commandDispatcher.ts` (thân `auditPinnedStopOverride`), MỌI lời gọi `recordAuditEvent(` / `ghiThuLenh(` / `doiTrangThaiCho(` nằm trong một arrow function là ĐỐI SỐ ĐẦU của lời gọi tên `ghiSoCoHan` / `ghiCoTran`; cầu chì: quét thấy ≥ 9 lời gọi như vậy (đo, ghi số thật trong commit). Ca cũ giữ (số 8 / 8 / 9 không đổi).
  - DB `ghiNenCoTran.r1b2b2.db.test.ts` (Review Focus 1; khuôn `soCoHan.r1b2b.db.test.ts`: `DB_POOL_MAX = "12"` trong `vi.hoisted`, router THẬT → `dungMayHmi` THẬT → `dispatch()` THẬT → StubDriver; `SEC_PLATFORM`, `OT_CONTROL_ENABLED`, `SCADA_COMMANDS_ENABLED` chỉ trong tiến trình):
    - `vi.mock("../services/audit/controlAuditService", importOriginal)` bọc `recordAuditEvent`: khi `H.chamAudit`, chạy trong MỘT giao dịch THẬT chờ `pg_advisory_xact_lock(KHOA_LOP_AUDIT, pid)` (kết nối giữ cầm khoá) rồi gọi bản thật; khuôn `chamThu` cho attempts;
    - CHỈ audit chậm (attempts nhanh): 12 lần bấm `dungMay` máy G liên tiếp ⇒ cả 12 `acked_verified`; mỗi lần lấy mẫu, số backend `NOT granted` trên `(KHOA_LOP_AUDIT, pid)` trong `pg_locks` ≤ 8 và `soGhiSoTreoStopHmi()` ≤ 8; log `audit_hmi_stop_bo_qua_day` ≥ 4 lần, mỗi lần `noiDung.action === "scada_hmi_stop"` và `noiDung.after.ketCuc === "DA_GUI"`;
    - ngay sau đó, máy G2 `dungMay` ⇒ `acked_verified` trong `< 1700 + await lag.dung(300)` ms;
    - audit + attempts cùng chậm: 12 lần bấm ⇒ tổng lượt treo (hai khoá của tệp) ≤ 8;
    - máy chưa ghim + audit chậm + hạn tổng đã cạn ⇒ `STOP_QUA_HAN`, dòng attempts có (attempts nhanh), `demStopQuaHanKhongGhiSo()` không đổi; attempts chậm + đầy trần ⇒ `demStopQuaHanKhongGhiSo().theoBuoc.ghi_so_loi` +1;
    - đối chứng DB nhanh ⇒ đúng 1 audit `scada_hmi_stop` mỗi lần bấm, 0 log `_bo_qua_day`, 0 log `_qua_han`.
- [ ] **Step 2: Chạy.** Mong đợi: đỏ (module chưa có; ca DB: backend chờ > 8).
- [ ] **Step 3: Cài** module, uỷ quyền, thunk hoá năm chỗ ghi nền của `lenhHmi.ts` + `auditPinnedStopOverride`. Sửa chú thích `lenhHmi.ts:1389-1409` và đầu `nganSachPoolStop.test.ts` (một trần cho sổ treo + ghi nền).
- [ ] **Step 4: Chạy lại** ba tệp mới + `nganSachPoolStop.test.ts` + `server/routers/scadaCommands*` (DB) + `server/services/ot/commandDispatcher*` (DB + unit) + `server/_core/hanStopHmi*` + census / gate / guard + R1b-2b-1 opt-in (`SCADA_R1B2B1_NGHIEM_THU=1`, ô L1 / L2). Mong đợi: xanh.
- [ ] **Step 5: Đột biến (ghi tệp:dòng):**
  - `ghiAudit` quay về `const viec = recordAuditEvent(...)` + `void voiHanUnref(viec, …)` ⇒ ca DB "≤ 8 backend" đỏ VÀ ca AST đỏ;
  - `ghiCoTran` kiểm trần SAU khi gọi `viec` ⇒ ca unit "lượt 9 không được phát" đỏ;
  - attempts của `tuChoiQuaHan` bỏ `khiKhongVaoSo` ⇒ ca `ghi_so_loi` +1 đỏ;
  - `auditPinnedStopOverride` bỏ `ghiCoTran` ⇒ ca AST đỏ.
  - Hoàn tác tất cả.
- [ ] **Step 6: Commit** `fix(scada): moi luot ghi nen cua duong STOP (audit, attempts tu choi qua han, vong STOP_QUA_HAN, audit STOP ghim cua dispatcher) chiu CUNG tran ghi treo 8 - bo qua khi day co log noi dung hang (R1b-2b-2a T1, muc 61)`.

### Task 2: Hết hạn của CHÍNH driver ⇒ `timeout` — lõi + Modbus / SLMP / EIP / OPC UA (mục 66, phần 1)

**Quyết định (một đoạn):** "không rõ kết cục" trở thành thuộc tính của TỪNG write (`OtCommandResult.ketCucKhongRo`), không còn chỉ là cờ cả lô. Lý do: hết hạn của thư viện xảy ra theo từng giao dịch (Modbus / SLMP / EIP tuần tự) và một lô có thể trộn write acked với write không rõ. Ánh xạ "không rõ" ⇒ `timeout` dùng lại đúng nhánh nhãn / bỏ đọc lại / ghi rủi ro của T17 — không ngữ nghĩa mới. **Ai thắng cuộc đua 5000 ms:** hạn của dispatcher thắng trong cấu hình mặc định — bộ hẹn DỰ PHÒNG của driver (EIP ở task này; S7 / MC ở Task 3) nâng từ 5000 lên `HAN_DU_PHONG_GHI_DRIVER_MS` = 6500 > 5000 + ân hạn 1000, để B3 (giữ chỗ + đặt lại phiên) luôn chạy khi thư viện còn giữ yêu cầu; hết hạn RIÊNG của thư viện (modbus-serial `setTimeout(cfg.timeoutMs)`, SLMP `cfg.timeoutMs`, st-ethernet-ip `timeout_sp`) vẫn có thể tới trước — khi đó thư viện đã bỏ yêu cầu, nhãn vẫn là `timeout` và rủi ro được ghi (Q4). **Ân hạn B3:** mọi reject của lời ghi trong ân hạn, và mọi kết quả mang `ketCucKhongRo`, đều ghi rủi ro "lệnh ghi cũ" (không đặt lại phiên — thư viện đã thôi giữ yêu cầu); chỉ kết quả trả về KHÔNG mang `ketCucKhongRo` mới là "đã xong" (Q5) — đóng ghi chú "Ngoài phạm vi" của T17 Fix round 2.

**Files:**
- Modify:
  - `server/services/ot/drivers/dangBay.ts` (lỗi có kiểu mới + hằng);
  - `server/services/ot/otDriver.ts` `OtCommandResult` `:135-139`;
  - `server/services/ot/otDeviceWrite.ts`: `holdSlotAfterTimedOutWrite` cuộc đua `:876-891`; `executeOtDeviceWrite` `:1314-1371` (ánh xạ write) và `:1340` (ghi rủi ro);
  - `server/services/ot/commandDispatcher.ts` cuộn trạng thái `:1916-1919`;
  - `server/services/ot/drivers/modbusDriver.ts` `writeOne` catch `:354-362`;
  - `server/services/ot/drivers/slmpDriver.ts` hẹn giờ `transact` `:258-268`, `writeOne` catch `:443-449`;
  - `server/services/ot/drivers/ethernetIpDriver.ts` `withTimeout` `:62-69`, `writeOne` `:325-334`;
  - `server/services/ot/drivers/opcuaDriver.ts` `writeTags` catch `:936-948`.
- Test: mới `server/services/ot/drivers/quaHanDriver.drivers.r1b2b2.test.ts`; mới `server/services/ot/otDeviceWrite.khongRo.r1b2b2.test.ts`; hồi quy `server/services/ot/drivers/dangBay.drivers.r1b2b1.test.ts`, `server/services/ot/drivers/modbusDriver.ghiMoCoi.repro.test.ts`, `server/services/ot/commandTimedOutWriteStop.dot4.test.ts`, `client/src/components/scada/DungMay.dom.test.tsx`.

**Interfaces:**
- Produces (`dangBay.ts`):
  - `export const MA_QUA_HAN_YEU_CAU_DRIVER = "OT_DRIVER_REQUEST_TIMEOUT"`;
  - `export class LoiQuaHanYeuCauDriver extends Error { readonly code = MA_QUA_HAN_YEU_CAU_DRIVER; constructor(readonly giaoThuc: string, readonly chiTiet: string) }` — message `${giaoThuc} request timed out in the driver (${chiTiet}) — outcome unknown`;
  - `export function laLoiQuaHanYeuCauDriver(err: unknown): err is LoiQuaHanYeuCauDriver` (instanceof hoặc `code`, như `laLoiMatLienKetKhiDangGui`);
  - `export type KetCucKhongRo = "mat_lien_ket" | "qua_han_driver"`;
  - `export function ketCucKhongRoCua(err: unknown): KetCucKhongRo | null` — lỗi mất liên kết có kiểu ⇒ `"mat_lien_ket"`; `LoiQuaHanYeuCauDriver` ⇒ `"qua_han_driver"`; khác ⇒ null;
  - `export const HAN_DU_PHONG_GHI_DRIVER_MS = 6500`.
- Produces (`otDriver.ts`): `OtCommandResult.ketCucKhongRo?: KetCucKhongRo` — chỉ trên write `ok: false` đã giao cho thư viện / thiết bị mà kết cục không rõ.
- Produces (bộ phân loại thư viện, export cho test):
  - `export function laQuaHanModbusSerial(err: unknown): boolean` (`modbusDriver.ts`) ⇔ `name === "TransactionTimedOutError"` hoặc `errno === "ETIMEDOUT"` (modbus-serial `index.js:33-34`, `:65-69`);
  - `export const EIP_TIEN_TO_QUA_HAN_GHI = "TIMEOUT occurred while writing Writing Tag:"` (st-ethernet-ip `dist/controller/index.js:812`, `:855`);
  - `export const OPCUA_TIEN_TO_QUA_HAN = "Transaction has timed out"` (node-opcua-secure-channel `client_secure_channel_layer.js:1147`).

Chốt:
- **Driver:** catch của write: `ketCucKhongRoCua(err) ?? (laQuaHanThuVien(err) ? "qua_han_driver" : null)`; có ⇒ `{ tagKey, ok: false, error: msg, ketCucKhongRo }`. Lỗi mất liên kết có kiểu VẪN ném lên ở task này (T17 không đổi; Task 6 đổi sang theo từng write). SLMP: hẹn giờ `transact` reject `new LoiQuaHanYeuCauDriver("slmp", "transaction timeout after <ms>ms")` (hạ socket như cũ). EIP: `withTimeout` của lời ghi dùng `HAN_DU_PHONG_GHI_DRIVER_MS` và reject `LoiQuaHanYeuCauDriver("ethernet-ip", …)`; chuỗi `EIP_TIEN_TO_QUA_HAN_GHI` ⇒ `"qua_han_driver"`. OPC UA: message bắt đầu `OPCUA_TIEN_TO_QUA_HAN` ⇒ mọi node đã chuẩn bị mang `"qua_han_driver"` (lỗi ép kiểu cục bộ giữ `failed`). Đường ĐỌC không đổi.
- **`executeOtDeviceWrite`:** write có `ketCucKhongRo` ⇒ `{ ok: false, status: "timeout", errorText: "<error> — outcome unknown: the write may have been applied on the device" }`, không đọc lại, đếm `ghiNhanLenh(…, false)`. Có ≥ 1 write như vậy và tuần tự hoá bật ⇒ `ghiRuiRoGhiCu(input, ledger, "cua_so")` (cùng chỗ `:1340`, một lần mỗi lệnh).
- **Ân hạn B3** (`:876-891`): `write.then(v => mangKetCucKhongRo(v) ? "khong_ro" : "settled", () => "khong_ro")`; `"khong_ro"` ⇒ `ghiRuiRoGhiCu(…, "cua_so")`, trả, không đặt lại phiên. (`"huy_mat_lien_ket"` gộp vào `"khong_ro"`.)
- **Dispatcher** `:1918`: `overall = timedOut || outcomes.some((o) => o.status === "timeout") ? "timeout" : "failed"` — không rõ thắng thất bại (chiều an toàn: người vận hành phải đọc lại trước khi gửi lần nữa).
- **Bên tiêu thụ `DispatchStatus`:** liệt kê mọi chỗ so `"failed"` / `"timeout"` của kết quả dispatch (`grep -rn '"failed"\|"timeout"'` trên `server/services/ot`, `server/services/edge`, `server/services/scada`, `server/services/orchestration`, `server/routers`, `client/src/components/scada`, `client/src/lib/scada`) thành một bảng "bên đọc → hành vi với `timeout` → không đổi / an toàn hơn" trong commit. Bên nào coi `timeout` lỏng hơn `failed` (vd thử lại tự động) ⇒ DỪNG, báo bộ điều khiển.
- **HMI:** không đổi mã client — `timeout` theo adapter đã hiện "Không rõ máy đã nhận hay chưa" + băng `BangEstopCung` `khong_ro` (T17 fix round 1, `0069478a6`). Thay đổi nhìn thấy được: STOP mà driver tự hết hạn nay hiện băng `khong_ro` thay vì "không đạt" (Q3).

- [ ] **Step 1: Test đỏ.**

```ts
// quaHanDriver.drivers.r1b2b2.test.ts — driver THẬT, peer giả trong tiến trình (khuôn modbusDriver.ghiMoCoi.repro.test.ts / dangBay.drivers.r1b2b1.test.ts)
it("★ Modbus: peer IM LẶNG, cfg.timeoutMs 300 < hạn lệnh 2000 ⇒ 'timeout' (không 'failed') (Review Focus 2)", async () => {
  const lag = batDauDoLag();
  const t0 = Date.now();
  const o = await ghiQuaExecute({ driver: modbusImLang(300), timeoutMs: 2000, writes: [{ tagKey: "stop_cmd", address: "00001", value: true }] });
  const troi = Date.now() - t0;
  expect(o.outcomes[0]).toMatchObject({ ok: false, status: "timeout" });
  expect(o.outcomes[0].errorText).toMatch(/outcome unknown/);
  expect(troi).toBeGreaterThanOrEqual(290);
  expect(troi).toBeLessThan(800 + (await lag.dung(200)));
});
it("Modbus: peer trả exception 2 ⇒ 'failed' (thiết bị đã trả lời — không đổi)", async () => { /* status "failed" */ });
it("laQuaHanModbusSerial: TransactionTimedOutError thật của thư viện ⇒ true; Error('Port Not Open') ⇒ false", () => { /* … */ });
it("SLMP: giao dịch quá cfg.timeoutMs ⇒ write mang ketCucKhongRo 'qua_han_driver'", async () => { /* … */ });
it("EIP: thư viện reject 'TIMEOUT occurred while writing Writing Tag: x.' ⇒ 'qua_han_driver'; bộ hẹn dự phòng = 6500", async () => { /* … */ });
it("OPC UA: session.write reject 'Transaction has timed out ( timeout = 15000 ms …)' ⇒ node đã gửi 'qua_han_driver', node ép kiểu hỏng 'failed'", async () => { /* … */ });
it("HAN_DU_PHONG_GHI_DRIVER_MS > hạn mặc định + ân hạn B3", () => {
  expect(HAN_DU_PHONG_GHI_DRIVER_MS).toBeGreaterThan(ackTimeoutMacDinhMs() + OT_TIMED_OUT_WRITE_GRACE_MS);
});
```

  - `otDeviceWrite.khongRo.r1b2b2.test.ts` (driver giả trả kết quả theo kịch bản; khuôn `commandTimedOutWriteStop.dot4.test.ts`):
    - lô 2 write: `[{ok:true}, {ok:false, ketCucKhongRo:"qua_han_driver"}]` ⇒ outcomes `acked*` và `timeout`; dispatcher `status "timeout"`;
    - lô `[{ok:false, error:"x"}, {ok:false, ketCucKhongRo:"qua_han_driver"}]` ⇒ cuộn `timeout` (không rõ thắng thất bại);
    - tuần tự hoá bật: write `qua_han_driver` ⇒ `_staleWriteRiskIntentIdsForTests(adapter)` = intent của lệnh; STOP acked kế tiếp ⇒ `_stopWatchCountForTests` = 1;
    - **ân hạn**: tuần tự hoá bật, hạn lệnh 200 ms, driver reject `new Error("bad write quality")` ở 600 ms (TRONG ân hạn 1000) ⇒ `slotHold` xong < 900 ms, rủi ro được ghi, `D.reset.calls === 0`; driver resolve `[{ok:false, ketCucKhongRo:"qua_han_driver"}]` trong ân hạn ⇒ như trên; resolve `[{ok:true}]` trong ân hạn ⇒ KHÔNG rủi ro (đối chứng);
    - tuần tự hoá tắt ⇒ không ghi rủi ro (phạm vi như B3).
  - `DungMay.dom.test.tsx`: ca có sẵn T17 `timeout` theo adapter ⇒ băng `khong_ro` — chạy lại, không sửa (hồi quy nhãn).
- [ ] **Step 2: Chạy.** Mong đợi: đỏ ở mọi ca mới (hôm nay: `failed`; ân hạn: không rủi ro).
- [ ] **Step 3: Cài.** Sửa test ghim hành vi cũ ("quá hạn driver ⇒ failed"), ghi tên trong commit. Đo lại ghim `rawErrorCensus` (chỉ được giảm).
- [ ] **Step 4: Chạy lại** hai tệp mới + `server/services/ot/drivers` + `server/services/ot/otDeviceWrite*` + `server/services/ot/commandTimedOutWriteStop*` + `server/services/ot/commandDispatcher*` (DB) + `server/routers/scadaCommands*` (DB) + `client/src/components/scada` + census / gate / guard + R1b-2b-1 opt-in. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:**
  - `executeOtDeviceWrite` bỏ ánh xạ `ketCucKhongRo` ⇒ ca Modbus im lặng đỏ (`failed`);
  - dispatcher quay về `timedOut ? … : "failed"` ⇒ ca cuộn trạng thái đỏ;
  - ân hạn ánh xạ reject thường về `"settled"` ⇒ ca "bad write quality trong ân hạn" đỏ;
  - `laQuaHanModbusSerial` luôn false ⇒ ca Modbus im lặng đỏ.
  - Hoàn tác tất cả.
- [ ] **Step 6: Commit** `fix(ot): het han cua chinh driver (modbus-serial, SLMP, EIP, OPC UA) => timeout khong ro ket cuc theo tung write, khong bao gio failed; reject trong an han B3 ghi rui ro lenh ghi cu (R1b-2b-2a T2, muc 66)`.

### Task 2B: FOE không gửi lại lệnh `timeout` (không rõ kết cục) cho bước không phải STOP (backlog 78 — dieu-phoi chốt 2026-10-30)

**Quyết định (một đoạn):** vòng thử lại của `foeEngine` (`runStep`, khoảng `:799-811`, có từ `cd98d9655`) gửi lại MỌI kết quả `failed` tới `maxAttempts`. Trong đó có cả lệnh mà dispatcher trả `timeout`, tức là không rõ máy đã nhận hay chưa. Gửi lại một lệnh không idempotent sau kết cục không rõ có thể làm thiết bị chạy hai lần. Theo tiền lệ `outcomeUnknownOf` (lệnh edge không rõ kết cục ⇒ KHÔNG BAO GIỜ gửi lại): bước `command` KHÔNG phải STOP có kết quả dispatch `timeout` ⇒ dừng vòng thử lại ngay ở lượt đó và báo `failed` với mã máy đọc được `FOE_OUTCOME_UNKNOWN`, kèm lời "không gửi lại; kiểm tra thiết bị". Bù trừ (compensation), nếu có, vẫn chạy như mọi lỗi. Bước STOP giữ nguyên: STOP luôn được gửi lại, không bao giờ bị giữ lại vì "không rõ" (R-10-ao N2). `failed` thật, tức thiết bị đã trả lời lỗi, vẫn được thử lại như hôm nay.

**Files:**
- Modify `server/services/orchestration/foe/foeEngine.ts`: vòng thử lại trong `runStep` và nơi `execCommand` biến kết quả dispatch thành `StepOutcome`. Cần mang được "dispatch status = timeout" ra ngoài, ví dụ `StepOutcome` `failed` thêm `outcomeUnknown?: true`. Không đổi hình `StepOutcome` cho các bên tiêu thụ khác.
- Test: mới `server/services/orchestration/foe/foeKhongGuiLaiKhiKhongRo.r1b2b2.test.ts`, theo khuôn engine trong bộ nhớ của các test `foe*.test.ts` hiện có.

Chốt:
- Bước command không-STOP, `maxAttempts: 3`, dispatcher trả `timeout` ⇒ dispatcher bị gọi ĐÚNG 1 lần. Bước `failed` với `error` mang `FOE_OUTCOME_UNKNOWN`; compensation (nếu có) chạy một lần.
- Cùng bước, dispatcher trả `failed` (thiết bị trả lời lỗi) ⇒ thử lại đủ 3 lần (đối chứng, hành vi cũ).
- Bước STOP, dispatcher trả `timeout` ⇒ vẫn thử lại tới `maxAttempts` (hành vi cũ).
- Trước khi cài: liệt kê mọi chỗ trong FOE và `server/services/orchestration` phân biệt kết quả dispatch (`grep -rn '"timeout"\|"failed"' server/services/orchestration`). Bảng "bên đọc → hành vi" đặt trong commit.

- [ ] **Step 1: Test đỏ.** Ba ca trên. Ca thứ nhất đỏ hôm nay (dispatcher bị gọi 3 lần).
- [ ] **Step 2: Cài.**
- [ ] **Step 3: Chạy lại** `server/services/orchestration` + census / gate / guard. Mong đợi: xanh.
- [ ] **Step 4: Đột biến:** bỏ nhánh "timeout ⇒ dừng thử lại" ⇒ ca 1 đỏ; áp nhánh đó cho cả STOP ⇒ ca 3 đỏ. Hoàn tác.
- [ ] **Step 5: Commit** `fix(foe): khong gui lai lenh khong ro ket cuc (dispatch timeout) cho buoc khong phai STOP - theo tien le outcomeUnknownOf; STOP van gui lai (R1b-2b-2a T2B, backlog 78)`. kiem-dinh rà.

### Task 3A: EtherNet/IP — ack MUỘN của lời ghi đã hết hạn không bao giờ được tính cho lời ghi KẾ TIẾP (backlog 79, AN TOÀN — dieu-phoi chốt 2026-10-30, làm TRƯỚC Task 3 phần S7/MC và trước Task 6)

**Phát hiện (rà Task 2):** khi một lời ghi hết hạn, st-ethernet-ip để lại listener "Write Tag" (`node_modules/st-ethernet-ip/dist/controller/index.js:814-831`). Phản hồi MUỘN của lời ghi cũ đó có thể khớp lời ghi kế tiếp, kể cả STOP, và làm nó báo ok = ack GIẢ.

**Bất biến (cứng):** KHÔNG BAO GIỜ báo `ok` từ một ack có thể là của lời ghi cũ. Cách cài do người thực hiện chọn SAU thăm dò.

Hướng gợi ý của dieu-phoi:
- Lời ghi ENIP hết hạn ⇒ phiên bị đánh dấu "nhiễm" ⇒ gỡ listener hoặc huỷ phiên, nối lại trước lời ghi kế.
- Nếu STOP phải đi trên phiên nhiễm (không chờ nối lại): vẫn GỬI, nhưng kết cục = không rõ (`ketCucKhongRo` ⇒ `timeout`, băng E-STOP cứng `khong_ro` như T17), tuyệt đối không ok.
- STOP không bao giờ bị chặn hoặc chờ vô hạn vì nối lại; mọi chờ nối lại đều có trần.

**Files:**
- Modify `server/services/ot/drivers/ethernetIpDriver.ts` (lời ghi, `withTimeout`, vòng đời phiên).
- Test: mới `server/services/ot/drivers/enipAckMuon.thuVienThat.r1b2b2.test.ts`.

- [ ] **Step 0: Thăm dò thư viện thật (cổng).** Dựng thiết bị ENIP giả trong tiến trình, có điều khiển được thời điểm trả ack (theo khuôn của test EIP hiện có, nếu có), dùng st-ethernet-ip THẬT.
  - Tái hiện: lời ghi A hết hạn (thiết bị im), rồi lời ghi B được gửi. Thiết bị trả ack của A MUỘN, rồi ack của B (hoặc không trả B).
  - Ghi lại B được báo thế nào hôm nay, và listener / phiên ở trạng thái nào.
  - Không tái hiện được ⇒ DỪNG, báo bộ điều khiển kèm số đo. Không vá theo phỏng đoán.
- [ ] **Step 1: Test đỏ:**
  - (a) Ack muộn của A tới trước khi B được trả lời ⇒ B KHÔNG `ok`.
  - (b) STOP là B, phiên nhiễm ⇒ STOP vẫn được GỬI, kết cục `ketCucKhongRo` (không ok), có trần thời gian (`batDauDoLag`).
  - (c) Sau khi nối lại sạch, lời ghi C được ack đúng ⇒ `ok` (đối chứng).
  - (d) Không hết hạn ⇒ hành vi không đổi.
- [ ] **Step 2: Cài.**
- [ ] **Step 3: Chạy lại** `server/services/ot/drivers` + `server/services/ot/otDeviceWrite*` + `client/src/components/scada` + census / gate / guard.
- [ ] **Step 4: Đột biến:** bỏ đánh dấu "nhiễm" ⇒ (a) đỏ; cho STOP trên phiên nhiễm báo ok ⇒ (b) đỏ; nối lại không có trần ⇒ (b) đỏ theo trần. Hoàn tác.
- [ ] **Step 5: Commit** `fix(ot): ENIP - ack muon cua loi ghi da het han khong bao gio tinh cho loi ghi ke (phien nhiem => noi lai; STOP tren phien nhiem => khong ro ket cuc, khong ok) - tham do st-ethernet-ip that (R1b-2b-2a T3A, backlog 79)`. kiem-dinh rà.

**Thứ tự chạy 2a sau chốt 2026-10-30:** T2 → T2B → T3A → T3 (S7 / MC) → T4 …

### Task 3B-0: Mitsubishi MC — KHOÁ AN TOÀN (fail-closed) tới khi có 3B (backlog 84 — dieu-phoi chốt 2026-10-30, làm TRƯỚC Task 3)

**Phát hiện (thăm dò T3, mcprotocol 0.1.2 thật qua `MitsubishiMcDriver`, máy chủ 1E giả):**
- Thư viện đọc end code 1E ở byte 9 thay vì byte 1. Vì thế PLC trả ack ĐÚNG 2 byte (`83 00`) ⇒ `ERR_OUT_OF_RANGE` ném trong handler socket ⇒ uncaughtException ⇒ tiến trình trung tâm (`index.ts` handler) và edge gateway THOÁT mã 1. Nghĩa là: MỘT lời ghi MC THÀNH CÔNG làm sập toàn bộ server.
- Phản hồi lỗi ≥ 10 byte ⇒ `{ok:true}`, tức ACK GIẢ.
- 1E không có số thứ tự ⇒ ack muộn có thể hoàn tất lời ghi kế.
- Nhánh "MC write busy" là mã chết.

**Quyết định (dieu-phoi):** MC FAIL-CLOSED. Đây là thay đổi hành vi theo hướng an toàn. 3B đầy đủ (parse 1E đúng, cô lập ngoại lệ, hạ phiên, không ok từ phản hồi lỗi, busy) để ở backlog 84, làm sau T3 / T3A.

**Yêu cầu:**
1. **GHI.** Mọi lời ghi MC ⇒ từ chối TRƯỚC khi gửi, bằng mã ổn định `OT_MC_TAM_KHOA`. Có i18n vi/en/zh với lý do "thư viện mcprotocol lỗi phân tích phản hồi — chờ 3B". KHÔNG gửi gói nào. STOP qua adapter MC ⇒ `failed`, hiện băng E-STOP cứng (`khong_dat`), không bao giờ ok.
2. **ĐỌC.** Thăm dò xem đường đọc có chạm cùng đường phân tích / ném trong handler socket không.
   - Có ⇒ đọc cũng khoá: chất lượng bad kèm lý do `OT_MC_TAM_KHOA`.
   - Không ⇒ giữ đọc, nhưng bọc cô lập ngoại lệ để không bao giờ làm sập tiến trình.
   - Bằng chứng thăm dò ghi vào báo cáo.
3. **KẾT NỐI.** Khi khoá: KHÔNG mở socket MC, để handler không thể ném từ dữ liệu không mời. Nếu ở mục 2 đọc được giữ thì kết nối mở cho đọc, và handler phải được cô lập.
4. **UI / posture.** Adapter MC hiện trạng thái "tạm khoá" có lý do, qua health / lastError / posture sẵn có của adapter. Không sửa tệp client cấm của Part B khi chưa báo bộ điều khiển.
5. **Test** (máy chủ 1E giả gửi ack 2 byte):
   - tiến trình test KHÔNG nhận uncaughtException (hôm nay có);
   - lời ghi bị từ chối trước khi gửi (đếm gói = 0);
   - STOP qua MC ⇒ `failed` + `OT_MC_TAM_KHOA`;
   - đọc theo kết luận mục 2.

   Mỗi ca có đột biến đỏ.

- Files: `server/services/ot/drivers/mitsubishiMcDriver.ts` (+ nơi đăng ký mã / i18n / posture nếu cần). Test mới `server/services/ot/drivers/mcTamKhoa.r1b2b2.test.ts`.
- Commit: `fix(ot): MC fail-closed - moi loi ghi MC bi tu choi truoc khi gui (OT_MC_TAM_KHOA), khong mo socket khi khoa; mcprotocol 0.1.2 doc end code 1E sai byte => ack DUNG lam sap tien trinh, phan hoi loi >= 10 byte => ok gia (R1b-2b-2a T3B-0, backlog 84)`. kiem-dinh rà.

**Thứ tự chạy 2a cập nhật 2026-10-30 tối:** … T3A → **T3B-0** → T3 (S7) → T4 … ; 3B đầy đủ = backlog 84.

### Task 3: Hết hạn của CHÍNH driver ⇒ `timeout` — S7 / MC qua thăm dò thư viện thật (mục 66, phần 2)

**Quyết định (một đoạn):** nodes7 và mcprotocol báo hết hạn ghi KHÔNG bằng lỗi mà bằng `writeDoneCallback(anyBadQualities = true)` — y hệt lúc PLC trả lỗi ghi. Phân biệt bằng `errCode` của item (cách T4 R1b-2b-1 làm cho MC đọc), chỉ sau khi thăm dò thư viện thật. Bộ hẹn dự phòng `withTimeout(…, 5000)` của hai driver nâng lên `HAN_DU_PHONG_GHI_DRIVER_MS` (cùng lý do Task 2).

**Files:**
- Modify:
  - `server/services/ot/drivers/s7Driver.ts` `withTimeout` `:69-76`, lời ghi `:419-443`;
  - `server/services/ot/drivers/mitsubishiMcDriver.ts` `withTimeout` `:105`, lời ghi `:622-645`;
  - `server/services/ot/drivers/__s7commSim.ts` `SimFault` `:77-99` (thêm `"hangWrite"`: không trả lời write var).
- Test: mới `server/services/ot/drivers/quaHanGhi.thuVienThat.r1b2b2.test.ts`; `server/services/ot/drivers/quaHanDriver.drivers.r1b2b2.test.ts` (ca S7 / MC).

**Interfaces:**
- Consumes: `LoiQuaHanYeuCauDriver`, `ketCucKhongRoCua`, `HAN_DU_PHONG_GHI_DRIVER_MS` (Task 2).
- Produces:
  - `export const S7_ERRCODE_QUA_HAN_GHI: string` (`s7Driver.ts`) — chuỗi NGUYÊN VĂN thăm dò được; theo mã nguồn `nodeS7.js:1729-1735` là `"We must have timed Out - we have no response to process"`;
  - `export function laQuaHanGhiS7(conn: unknown): boolean` — ≥ 1 item ghi của lần ghi này `valid === false && errCode === S7_ERRCODE_QUA_HAN_GHI`;
  - `export function laQuaHanGhiMc(conn: unknown): boolean` (`mitsubishiMcDriver.ts`) — ≥ 1 item ghi `valid === false` với `errCode` đúng chuỗi thăm dò được cho `theData === undefined` (theo mã nguồn `mcprotocol.js:1339-1352`: `"Malformed Reply MC Packet - Less Than 11 Bytes" + undefined` ở 3E, `"… Less Than 2 Bytes" + undefined` ở 1E); hằng `MC_ERRCODE_QUA_HAN_GHI_3E`, `MC_ERRCODE_QUA_HAN_GHI_1E` = chuỗi thăm dò được.
  - Đọc bằng truy cập phòng thủ (`Array.isArray`, `typeof`), không ném; cấu trúc không đọc được ⇒ false (giữ `failed` như hôm nay).

Chốt:
- `anyBadQualities === true` + `laQuaHanGhi*(conn)` ⇒ mọi write của lô mang `"qua_han_driver"`; `anyBadQualities` mà không phải quá hạn ⇒ `failed` (PLC đã trả lời lỗi). Bộ hẹn dự phòng hết ⇒ `LoiQuaHanYeuCauDriver` ⇒ `"qua_han_driver"`.
- Ghi chú đầu hai hàm: bản thư viện (nodes7 0.3.x, mcprotocol 0.1.2), dòng nguồn, và vì sao không dò thời gian.
- (Rà T2 M-3, 2026-10-30) `HAN_DU_PHONG_GHI_DRIVER_MS` = 6500 là HẰNG: lệnh có hạn riêng > 6500 ms mà thư viện cũng giữ yêu cầu > 6500 ms ⇒ bộ hẹn dự phòng tới TRƯỚC hạn dispatcher ⇒ B3 không chạy. Đo cấu hình hạn lệnh thật; nếu có hạn > 5000 ⇒ bộ hẹn dự phòng = max(6500, hạn lệnh + ân hạn B3 + 500) theo từng lệnh, có test.

- [ ] **Step 1: Thăm dò thư viện thật (cổng).** `quaHanGhi.thuVienThat.r1b2b2.test.ts`:
  - nodes7 thật trỏ `startS7commSim()` với `setFault("hangWrite")`, `timeout` kết nối 300 ms: `writeItems` ⇒ callback `true`; in và ghim cấu trúc item (đường dẫn mảng, `valid`, `errCode`);
  - mcprotocol thật trỏ máy chủ 1E giả của `mcErrCode.thuVienThat.test.ts` (không trả lời khung ghi), `globalTimeout` 300 ms: tương tự; một ca máy chủ trả end code lỗi ⇒ `errCode` KHÁC hằng quá hạn.
  - **Cấu trúc / chuỗi khác mô tả ⇒ DỪNG, báo bộ điều khiển kèm số đo** (không đoán hằng).
- [ ] **Step 2: Test đỏ** (`quaHanDriver.drivers.r1b2b2.test.ts`, conn giả mang đúng hình đã thăm dò): S7 / MC quá hạn ⇒ `timeout` qua `executeOtDeviceWrite`; S7 "Received write error" / MC end code lỗi ⇒ `failed`; item `valid === true` mang `errCode` cũ ⇒ bỏ qua; bộ hẹn dự phòng 6500 (đồng hồ giả) ⇒ `qua_han_driver`.
- [ ] **Step 3: Chạy.** Mong đợi: đỏ.
- [ ] **Step 4: Cài.**
- [ ] **Step 5: Chạy lại** `server/services/ot/drivers` + R0 / R1b-1 opt-in (`SCADA_R0_NGHIEM_THU=1`, `SCADA_R1B_NGHIEM_THU=1`) + census / gate / guard. Mong đợi: xanh.
- [ ] **Step 6: Đột biến:** `laQuaHanGhiS7` luôn false ⇒ ca S7 quá hạn đỏ; `laQuaHanGhiMc` không lọc `valid === false` ⇒ ca `errCode` cũ đỏ. Hoàn tác.
- [ ] **Step 7: Commit** `fix(ot): S7/MC phan biet het han ghi cua thu vien voi PLC tra loi loi bang errCode (tham do nodes7/mcprotocol that) => timeout; bo hen du phong 6500 de han dispatcher thang (R1b-2b-2a T3, muc 66)`.

### Task 3C: S7 — địa chỉ bit ∉ 0..7 không bao giờ tới nodes7; nodes7 không bao giờ phát lại gói cũ (backlog 87, AN TOÀN — dieu-phoi chốt 2026-10-30, làm sáng 31/10 TRƯỚC T4)

**Phát hiện (rà Task 3):**
- `parseS7Address` (`s7Address.ts:54`, `:71`) nhận số bit > 7 (`DB1,X0.9`, `M0.8`).
- nodes7 0.3.18 lặng lẽ BỎ item đó.
- Khi MỌI item bị bỏ: nodes7 trả sớm (`nodeS7.js:675`) trước khi xoá danh sách gói (`:751`) ⇒ GỬI LẠI GÓI GHI TRƯỚC rồi báo thành công.
- Hệ quả: ok GIẢ cho STOP, và lệnh trước (start / setpoint) bị áp LẠI. Tái hiện bằng nodes7 thật + `__s7commSim`: gói giống từng byte lời ghi `DB1,INT2=1234` trước đó.
- DEV: 0 tag S7 có bit ≥ 8.

**Yêu cầu (dieu-phoi):**
1. **Phân tích địa chỉ.** `parseS7Address` từ chối bit ∉ 0..7 bằng mã ổn định, ở CẢ lúc lưu cấu hình tag (router / validator) LẪN lúc ghi. Từ chối ⇒ không gửi gì.
2. **Phòng thủ hai trong driver.** Từ chối khi BẤT KỲ item nào sẽ bị nodes7 bỏ, không chỉ khi bỏ hết, vì ghi một phần cũng là kết cục sai. Kiểm bằng chính bộ phân tích địa chỉ của nodes7 (hoặc đối chiếu số item trước / sau) TRƯỚC `writeItems`. Không bao giờ gọi `writeItems` với danh sách hiệu lực khác danh sách yêu cầu.
3. **Test.** nodes7 thật + `__s7commSim` so gói:
   - 0 gói, không phát lại gói cũ;
   - ghi một phần (một item hỏng trong lô) ⇒ cả lô bị từ chối, 0 gói;
   - đối chứng: địa chỉ hợp lệ vẫn ghi.

   Mỗi ca có đột biến đỏ.
4. **Các đường "gửi lại gói cũ" khác.** Liệt kê từ nguồn nodes7 mọi đường trả sớm mà danh sách gói không bị xoá. Chặn cùng lớp và ghi vào báo cáo.
5. **Khởi động / đọc cấu hình.** Tag S7 đã lưu có bit ∉ 0..7 ⇒ đánh dấu cấu hình lỗi: không ghi được, có lý do rõ ở health / posture / lastError. Không im lặng.

- Files: `server/services/ot/drivers/s7Address.ts`, `s7Driver.ts`, nơi kiểm cấu hình tag (tìm validator địa chỉ theo giao thức), test mới `server/services/ot/drivers/s7BitNgoaiDai.r1b2b2.test.ts`.
- Commit: `fix(ot): S7 - dia chi bit ngoai 0..7 bi tu choi (luu cau hinh + ghi), driver tu choi khi nodes7 se bo BAT KY item nao; nodes7 0.3.18 tra som khong xoa danh sach goi => phat lai goi ghi truoc + bao ok (R1b-2b-2a T3C, backlog 87)`. kiem-dinh rà.

**Thứ tự 2a sáng 31/10:** dieu-phoi gộp T3A + 3B-0 → **T3C** → (kiem-dinh T3 S7) → bàn giao lô T3 + 3B-0 đánh bóng + T3C → T4 …

### Task 3E: Lô ghi áp MỘT PHẦN ⇒ kết cục riêng "một phần", FOE KHÔNG gửi lại (backlog 90, AN TOÀN — dieu-phoi chốt 2026-10-31, làm NGAY SAU T3, TRƯỚC T4)

**Phát hiện (rà T3 vòng 1).** PLC trả một lô ghi S7 trộn: item A `0xff` (đã áp), item B `0x0A` (không áp). Hôm nay driver và dispatcher gộp cả lô thành `failed`. Với lệnh không phải STOP, FOE (T2B) thử lại `failed` ⇒ item A đã áp bị áp LẦN NỮA. Đây là cùng bất biến với T2B: không bao giờ gửi lại lệnh có thể đã áp.

**Thiết kế (dieu-phoi chọn (B) cho 2a; enum riêng (A) để backlog 2b):**
- **Trạng thái DB / enum.** Không đổi. `status` vẫn là `failed`, `commandstatusenum` không thêm giá trị, KHÔNG migration.
- **Lý do máy đọc được** `MOT_PHAN`.
  - Đưa vào `MA_LOI_DA_BIET` (`server/routers/_chiTietKyThuat.ts`), kèm i18n vi/en/zh.
  - Đặt ở `reason` của DispatchResult và ở tiền tố mã của `errorText` hàng command_log, theo đúng quy ước mã hiện có.
- **Trường có kiểu** `motPhan?: { daAp: string[]; khongAp: string[] }` (danh sách tagKey) trên `DispatchResult`.
  - Chỉ có khi lô có ÍT NHẤT một item `ok` VÀ ít nhất một item `ok:false` mà thiết bị đã trả lời. Item có `ketCucKhongRo` ⇒ toàn lô theo luật T2: `timeout`, không phải một phần.
- **LƯU BỀN (điều kiện 1).**
  - `motPhan` phải được ghi vào hàng `command_log`, vào cột jsonb sẵn có (ưu tiên `ackValue`; người thực hiện xác nhận cột hợp lý nhất và nêu lý do). KHÔNG migration.
  - Mọi bên đọc lại SAU khởi động lại hoặc qua edge (`otEdgeDispatch`, FOE dựng lại từ sổ) vẫn thấy "một phần" và không gửi lại, không chỉ dựa vào bộ nhớ.
  - Đường edge: kết quả edge báo về phải mang được `motPhan` (hoặc kết quả theo item để trung tâm suy ra). Edge cũ không mang ⇒ hành vi hôm nay, ghi rõ trong báo cáo.
- **FOE.** Bước command không phải STOP nhận một phần (từ DispatchResult HOẶC từ sổ khi dựng lại) ⇒ KHÔNG gửi lại (như `timeout`).
  - Báo `failed` với mã `FOE_OUTCOME_PARTIAL` (hoặc tái dùng khuôn `FOE_OUTCOME_UNKNOWN`; chọn và nêu lý do), có danh sách item đã áp / không áp.
  - Compensation chạy như mọi lỗi.
  - STOP giữ nguyên: STOP vẫn được gửi lại, vì dừng là idempotent.
- **Driver.**
  - S7 trước: phân biệt theo item từ `writeResponse` (`0xff` = áp; khác = không áp; thiếu / `Malformed` = KHÔNG RÕ ⇒ T3 vòng 2).
  - Driver khác (Modbus / SLMP / EIP / OPC UA / MC):
    - nếu đã trả `ok` theo item đúng nghĩa ⇒ dispatcher tự suy một phần;
    - nếu driver không phân biệt được theo item (ví dụ ghi cả lô một gói, lỗi chung cho cả lô) ⇒ giữ nguyên hành vi.
  - Lập bảng "driver → phân biệt theo item? bằng chứng (file:line)" trong báo cáo.
- **Hiển thị.**
  - Máy chủ: scadaDiag và bộ ghi lần thử HMI mang `MOT_PHAN` + danh sách item, che theo quyền như mã khác (luật C1).
  - Phần client (HMI / DungMay / ketQuaLenh) là Part B ⇒ scada-ui làm nếu cần. Phiên này KHÔNG sửa tệp client; báo hợp đồng dữ liệu cho scada-ui.

**Census quyết định gửi lại (điều kiện 2).**
- Quét theo AST hoặc quét nguồn, KHÔNG viết tay danh sách: liệt kê TOÀN BỘ chỗ trong `server/` đọc status / kết cục `failed` của lệnh rồi rẽ nhánh thử lại hoặc gửi lại. Phạm vi gồm FOE runStep, recipe deploy, changeover, robot, edge redrive, store-and-forward, và mọi chỗ quét được.
- Mỗi chỗ phải xét `motPhan` / `MOT_PHAN`, hoặc nằm trong danh sách miễn có lý do.
- Đột biến bỏ phần xét ở một chỗ ⇒ đỏ, nêu tên chỗ.

**Test** (nodes7 thật + `__s7commSim` nếu được; nếu không thì PLC giả trong tiến trình):
1. Lô 2 item trộn (`0xff` + `0x0A`) ⇒ DispatchResult `failed` + `MOT_PHAN` + `motPhan` đúng.
2. FOE bước không phải STOP, `maxAttempts: 3` ⇒ dispatcher bị gọi ĐÚNG 1 lần (sim đếm gói: không có gói ghi thứ hai). Compensation chạy 1 lần.
3. Dựng lại FOE từ sổ (command_log) sau lệnh một phần ⇒ không gửi lại. Test DB, TEST DB, giao dịch ROLLBACK của chính test, không id tường minh trong bảng WORM.
4. Bước STOP với lô trộn ⇒ vẫn thử lại như cũ (đối chứng).
5. Lô toàn `0x0A` ⇒ `failed` thường, FOE thử lại như cũ (đối chứng). Lô toàn `0xff` ⇒ ok.
6. Đột biến:
   - gộp một phần về `failed` thường ⇒ (2) đỏ;
   - bỏ lưu `motPhan` vào sổ ⇒ (3) đỏ;
   - áp "không gửi lại" cho cả STOP ⇒ (4) đỏ;
   - bỏ xét ở một chỗ census ⇒ census đỏ.

**Liên quan.** Task 6 (mất liên kết giữa lô ⇒ nhãn theo TỪNG write) đọc cùng kết quả theo item. 3E KHÔNG làm Task 6, nhưng không được làm khó Task 6: ghi chú điểm nối trong báo cáo.

**Files:**
- `server/services/ot/commandDispatcher.ts`, `otDeviceWrite.ts`, `otEdgeDispatch.ts`;
- `server/services/ot/drivers/s7Driver.ts`;
- `server/services/orchestration/foe/foeEngine.ts`;
- `server/routers/_chiTietKyThuat.ts`, `scadaDiagRouter.ts`;
- locales;
- test mới `server/services/ot/motPhan.r1b2b2.test.ts` (+ `.db.test.ts` cho dựng lại từ sổ) + census `server/services/ot/guiLaiXetMotPhanCensus.test.ts`.

**Commit:** `fix(ot): lo ghi ap MOT PHAN => ket cuc rieng MOT_PHAN (status failed + motPhan {daAp,khongAp} luu vao command_log), FOE khong gui lai (STOP van gui lai), census moi cho gui lai phai xet motPhan (R1b-2b-2a T3E, backlog 90)`. kiem-dinh rà.

**Thứ tự 2a cập nhật 2026-10-31:** … T3 (vòng 2) → **T3E** → T4 …

### Task 3F: Sau khi dựng lại, `DUPLICATE_IN_FLIGHT` ⇒ KHÔNG RÕ kết cục, FOE KHÔNG gửi lại với attempt key mới (backlog 91, AN TOÀN — dieu-phoi chốt 2026-10-31, làm NGAY SAU T3E, TRƯỚC T4)

**Phát hiện (rà T3E, có từ trước).** Trình tự lỗi:
1. Tiến trình sập GIỮA lúc "đã ghi xuống thiết bị" và lúc "ghi hàng kết quả".
2. FOE dựng lại, phát lại dispatcher ⇒ nhận `rejected` / `DUPLICATE_IN_FLIGHT` (`commandDispatcher.ts:~2226`).
3. FOE coi đó là lỗi thường, thử lại với attempt key MỚI ⇒ lệnh có thể đã áp bị gửi lại THẬT.

Cùng bất biến T2B: không bao giờ gửi lại lệnh có thể đã áp.

**Quyết định (dieu-phoi):**
- Sau khi dựng lại, `DUPLICATE_IN_FLIGHT` và MỌI lý do từ chối mang nghĩa "lệnh trước có thể đang bay hoặc đã bay" ⇒ kết cục KHÔNG RÕ, như `timeout` theo tiền lệ `outcomeUnknownOf` / `FOE_OUTCOME_UNKNOWN`. Khi đó:
  - không gửi lại;
  - compensation chạy;
  - người vận hành thấy rõ "không rõ kết cục — kiểm tra thiết bị".
- Bước không phải STOP: KHÔNG dùng attempt key mới.
- STOP giữ hành vi gửi lại.
- Liệt kê từ mã nguồn mọi lý do từ chối thuộc lớp "có thể đã bay" (ví dụ `DUPLICATE_IN_FLIGHT`, `BUSY` trên cùng ý định / attempt, …). Bảng "lý do → thuộc lớp? bằng chứng file:line" đặt trong báo cáo. Lý do từ chối CHẮC CHẮN chưa gửi gì (PRECONDITION_FAILED, TAG_NOT_WRITABLE, …) giữ nguyên hành vi.
- Census gửi lại của T3E (`guiLaiXetMotPhanCensus`, quét): mở rộng để các chỗ rẽ nhánh thử lại cũng phải xét lớp "có thể đã bay", hoặc thêm census anh em cùng cơ chế quét. Đột biến bỏ phần xét ⇒ đỏ.

**Test:**
1. Giả lập sập giữa "đã ghi thiết bị" và "ghi hàng kết quả". Thiết bị giả hoặc sim đếm gói; dùng chỗ cắt sẵn có của dispatcher nếu có, không thì hook test-only có cổng VITEST. FOE dựng lại từ sổ (TEST DB, ROLLBACK của chính test, không id tường minh trong bảng WORM) ⇒ bước không phải STOP:
   - 0 gói gửi lại (đếm gói);
   - kết cục `failed` + `FOE_OUTCOME_UNKNOWN` (hoặc mã riêng đã nêu lý do);
   - compensation chạy 1 lần.
2. Cùng kịch bản với bước STOP ⇒ vẫn gửi lại (đối chứng).
3. Từ chối "chắc chưa gửi" (ví dụ PRECONDITION_FAILED) ⇒ hành vi cũ (đối chứng).
4. Đột biến:
   - coi `rejected` / `DUPLICATE_IN_FLIGHT` là lỗi thường ⇒ (1) đỏ;
   - áp cho STOP ⇒ (2) đỏ;
   - attempt key mới cho bước không phải STOP ⇒ (1) đỏ.

**Files:**
- `server/services/orchestration/foe/foeEngine.ts` (runStep / execCommand / outcomeUnknownOf);
- `server/services/ot/commandDispatcher.ts` (chỉ nếu cần mang cờ máy đọc được);
- census T3E;
- test mới `server/services/orchestration/foe/foeDuplicateInFlight.r1b2b2.db.test.ts` (+ unit nếu cần).

**Commit:** `fix(foe): sau dung lai DUPLICATE_IN_FLIGHT (va moi tu choi "lenh truoc co the da bay") => khong ro ket cuc, khong gui lai, khong attempt key moi cho buoc khong phai STOP; STOP van gui lai (R1b-2b-2a T3F, backlog 91)`. kiem-dinh rà.

**Thứ tự 2a cập nhật 2026-10-31:** … T3E → **T3F** → T4 …

### Task 4: `interlock.resolveEvent` dưới khoá ADAPTER → LUẬT (mục 62)

**Files:**
- Modify: `server/routers/interlockRouter.ts`: `khoaDichLuatTx` `:179-215` (tham số khoá luật); `resolveEvent` `:877-904`.
- Test: mới `server/routers/interlockRouter.resolveEvent.duoiKhoa.r1b2b2.db.test.ts`.

**Interfaces:**
- Consumes: `layPhamViGhiLuat(ctx)` (`:160`), `luatTrongPhamViDuoiKhoa(r, tap, adapters, idsMay)` (`:140`), `khoaAdapterTx` (`server/services/scada/troLaiKenh.ts:247`).
- Produces: `khoaDichLuatTx(tx, ruleId, adapterIdsMoi, phamVi?, khoaLuat: "update" | "share" = "update")` — mọi người gọi cũ không đổi (mặc định `"update"`).

Chốt:
- `phamVi = await layPhamViGhiLuat(ctx)` TRƯỚC giao dịch (không gọi pool trong giao dịch).
- Trong giao dịch: đọc sự kiện (không khoá) ⇒ vắng ⇒ NOT_FOUND `interlockEvent`; `ruleId` có ⇒ `khoaDichLuatTx(tx, ruleId, [], phamVi, "share")` (adapter FOR SHARE → luật FOR SHARE); NOT_FOUND `interlockRule` của nó ⇒ đổi thành NOT_FOUND `interlockEvent` (cùng lỗi, không lộ luật); CONFLICT `scadaKenhThuLai` đi nguyên; rồi `luatTrongPhamViDuoiKhoa(existing ?? {}, phamVi.tap, adapters, phamVi.idsMay)` ⇒ ngoài phạm vi ⇒ NOT_FOUND `interlockEvent`. `ruleId` NULL ⇒ `luatTrongPhamViDuoiKhoa({}, …)` (cùng kết quả với `luatTrongPhamVi(ctx, {})` hôm nay).
- Sau đó UPDATE sự kiện + `recordAuditEvent(tx, …)` như cũ (hàng sự kiện khoá SAU luật; khoá chuỗi audit sau cùng).
- `luatTrongPhamVi` (đọc qua pool) giữ cho các thủ tục đọc NGOÀI giao dịch (`testEvaluate`, …).

- [ ] **Step 1: Test đỏ (DB, kỹ sư nhà máy A; khuôn S1 của `interlockRouter.phamViDuoiKhoa.r1b2b.db.test.ts`: một giao dịch THẬT giữ adapter FOR UPDATE, đổi máy của adapter đích sang nhà máy B, commit sau khi `resolveEvent` đã bắt đầu; đo chặn bằng `pg_blocking_pids`):**
  - sự kiện của luật nhắm adapter ấy ⇒ `NOT_FOUND {entity:"interlockEvent"}`, sự kiện vẫn `open`, 0 audit `resolve`;
  - đối chứng: đổi sang máy khác CÙNG nhà máy A ⇒ `resolved` + 1 audit;
  - spy `getDb` của `server/db` (bọc bản thật, `importOriginal`): trong khoảng từ lúc mở giao dịch tới lúc commit, `getDb` được gọi 0 lần;
  - `resolveEvent` song song với `update` đổi `targetAdapterId` của cùng luật, 10 vòng ⇒ 0 lỗi 40P01 lọt ra; mỗi vòng một bên thành công, bên kia thành công tuần tự hoặc CONFLICT / NOT_FOUND;
  - sự kiện `ruleId` NULL: kỹ sư có phạm vi ⇒ NOT_FOUND; admin ⇒ `resolved` (như hôm nay).
- [ ] **Step 2: Chạy.** Mong đợi: đỏ ở ca đổi máy và ca đếm `getDb`.
- [ ] **Step 3: Cài.**
- [ ] **Step 4: Chạy lại** `server/routers/interlock*` (DB) + `server/services/scada/thuTuKhoaTag.census.test.ts` + census / gate / guard. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:** `resolveEvent` quay về `luatTrongPhamVi(ctx, luat)` trong giao dịch ⇒ ca đổi máy + ca đếm `getDb` đỏ; khoá luật trước `khoaAdapterTx` trong `khoaDichLuatTx` ⇒ ca 10 vòng đỏ (40P01) hoặc ca đổi máy đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `fix(interlock): resolveEvent kiem pham vi duoi khoa adapter FOR SHARE truoc luat FOR SHARE, khong goi pool trong giao dich (R1b-2b-2a T4, muc 62)`.

### Task 5: Census thứ tự khoá ADAPTER → LUẬT + cấm pool trong giao dịch giữ khoá hàng (mục 63)

**Quyết định (một đoạn):** AST (TypeScript compiler API, khuôn `server/services/scada/thuTuKhoaTag.census.test.ts` + `moiFileDuoi` của `server/routers/deployProcedureScan`), không regex dòng. Hai vị từ đo trên cây thật rồi GHIM bằng tập có tên (ratchet: thêm chỗ mới đỏ, gỡ chỗ cũ phải sửa tập). Vị từ (B) là heuristic có ghi rõ giới hạn: gọi pool trực tiếp + helper đọc-qua-pool đã biết, một bước nội tệp; không phân tích liên tệp đầy đủ.

**Files:**
- Create: `server/services/scada/khoaLuatVaPoolTrongTx.census.test.ts`.
- Test: chính nó.

**Interfaces:**
- Produces (export trong tệp test, cho tệp test khác tái dùng):
  - `export interface ViTriKhoaLuat { viTri: string; dong: number; coKhoaAdapterTruoc: boolean }` — `viTri` = `<đường tương đối>#<hàm bao ngoài gần nhất>`;
  - `export function quetKhoaLuat(goc: string): ViTriKhoaLuat[]`;
  - `export interface ViTriPoolTrongTx { viTri: string; dong: number; ham: string }`;
  - `export function quetPoolTrongTx(goc: string): ViTriPoolTrongTx[]`;
  - `HAM_KHOA_LUAT_CO_HOP_DONG: ReadonlySet<string>`, `NO_POOL_TRONG_TX: ReadonlySet<string>`, `HAM_GOI_POOL: ReadonlySet<string>`.

Chốt:
- **(A) khoá luật:** mọi chuỗi drizzle trong `server/**` (không test) có `.from(interlockRules)` (hoặc join) và `.for("update" | "share", …)` không có `{ of: <bảng khác> }`, cộng SQL thô có `interlock_rules` và `FOR UPDATE` / `FOR SHARE` trong cùng template. `coKhoaAdapterTruoc` ⇔ trong CÙNG hàm, TRƯỚC vị trí ấy (thứ tự nguồn) có lời gọi `khoaAdapterTx(` / `congAdapterTx(` hoặc chuỗi `.from(deviceAdapters)…for(…)`. Mọi chỗ `coKhoaAdapterTruoc === false` phải nằm trong `HAM_KHOA_LUAT_CO_HOP_DONG` (hàm mà MỌI người gọi đã khoá adapter trước — vd `troLaiKenh.ts#khoaLuatNhamCapTx`, người gọi `deviceAdapterRouter.ts:628,712,714,811` đi qua `congAdapterTx`), mỗi phần tử kèm chú thích người gọi + ngày. Đo ở Step 1: 6 tệp có khoá luật hôm nay (`interlockRouter.ts`, `engineeringAssignment/assignmentService.ts`, `interlock/backfillDinhNghiaDuyet.ts`, `ot/commandDispatcher.ts`, `scada/nhatQuanKenh.ts`, `scada/troLaiKenh.ts`).
- **(B) pool trong giao dịch:** phạm vi `server/routers/**`, `server/services/scada/**`, `server/services/ot/**`, `server/services/interlock/**`, `server/services/engineeringAssignment/**`. Mỗi hàm là đối số đầu của `.transaction(` mà thân (kể cả closure lồng) có khoá hàng (`.for(`, lời gọi tên `khoa*Tx` / `congAdapterTx`, SQL thô `FOR UPDATE` / `FOR SHARE`, `.update(` / `.delete(`): cấm lời gọi tên trong `HAM_GOI_POOL` = `{ getDb, getDbRaw, idsTrongPhamVi, idsMayTrongPhamVi, adapterTrongPhamVi, luatTrongPhamVi, layTapPhamViLuat, layPhamViGhiLuat }` ∪ {hàm khai trong CÙNG tệp mà thân gọi một tên trong tập trên — một bước}. Kết quả đo phải BẰNG `NO_POOL_TRONG_TX` (tập nợ, mỗi phần tử kèm ngày + mục backlog); sau Task 4 `interlockRouter.ts#resolveEvent` KHÔNG được có trong tập.
- Cầu chì: (A) quét thấy ≥ 6 chỗ; (B) quét thấy ≥ 20 callback giao dịch có khoá; mỗi tệp đọc được > 500 ký tự.
- Nợ (B) đo được ở tệp ngoài SCADA / OT / interlock ⇒ chỉ ghi trong tập nợ + danh sách R1b-2b-2b, không sửa ở task này.

- [ ] **Step 1: Đo.** Chạy hai hàm quét trên cây, in danh sách; dán bảng `viTri → coKhoaAdapterTruoc` và danh sách (B) vào commit. **Có chỗ (A) khoá luật trước adapter mà không phải hàm có hợp đồng ⇒ DỪNG, báo bộ điều khiển kèm bảng** (lỗi sản phẩm, không ghi vào tập miễn).
- [ ] **Step 2: Test.**

```ts
it("★ (A) mọi khoá interlock_rules có khoá ADAPTER trước trong cùng hàm, hoặc là hàm có hợp đồng ghi rõ", () => {
  const vt = quetKhoaLuat(GOC_REPO);
  expect(vt.length, "cầu chì: ≥ 6 chỗ khoá luật").toBeGreaterThanOrEqual(6);
  expect(vt.filter((v) => !v.coKhoaAdapterTruoc && !HAM_KHOA_LUAT_CO_HOP_DONG.has(v.viTri)).map((v) => v.viTri)).toEqual([]);
});
it("★ (B) lời gọi pool trong giao dịch giữ khoá hàng = đúng tập nợ đã ghim (ratchet)", () => {
  expect(quetPoolTrongTx(GOC_REPO).map((v) => v.viTri).sort()).toEqual([...NO_POOL_TRONG_TX].sort());
  expect(NO_POOL_TRONG_TX.has("server/routers/interlockRouter.ts#resolveEvent")).toBe(false);
});
it("thiết bị đo (A): nguồn tổng hợp khoá luật TRƯỚC adapter ⇒ bị bắt", () => { /* chuỗi nguồn trong bộ nhớ qua hàm quét lõi */ });
it("thiết bị đo (B): nguồn tổng hợp gọi luatTrongPhamVi trong tx có .for('update') ⇒ bị bắt; gọi ngoài tx ⇒ không", () => { /* … */ });
```

- [ ] **Step 3: Chạy.** Mong đợi: xanh trên cây (sau Task 4); hai ca thiết bị đo xanh.
- [ ] **Step 4: Đột biến:** thêm lại `await luatTrongPhamVi(ctx, luat ?? {})` trong giao dịch của `resolveEvent` ⇒ (B) đỏ; đổi thứ tự trong `khoaDichLuatTx` (khoá luật trước `khoaAdapterTx`) ⇒ (A) đỏ. Hoàn tác.
- [ ] **Step 5: Chạy lại** mọi `*census*` + `server/routers/interlock*` (DB). Mong đợi: xanh.
- [ ] **Step 6: Commit** `test(scada): census AST thu tu khoa ADAPTER -> LUAT interlock va cam goi pool trong giao dich giu khoa hang (ratchet no do duoc) (R1b-2b-2a T5, muc 63)`.

### Task 6: Mất liên kết giữa một lô ghi ⇒ nhãn theo TỪNG write, mọi driver (mục 69)

**Quyết định (một đoạn):** mục 69 nêu OPC UA, nhưng cùng một lớp lỗi có ở mọi driver: lỗi mất liên kết có kiểu được NÉM cho cả lô ⇒ write chưa bao giờ giao cho thư viện (hỏng ép kiểu / địa chỉ cục bộ — OPC UA, S7, MC; write SAU điểm rớt — Modbus, EIP, SLMP tuần tự) mang nhãn `timeout`, và write ĐÃ acked trước điểm rớt (tuần tự) cũng thành `timeout`. Sửa ở cả sáu (Q6): driver không ném nữa mà trả kết quả theo từng write bằng trường `ketCucKhongRo` của Task 2. Chiều an toàn giữ: write đã giao ⇒ `timeout`, không bao giờ `failed`.

**Files:**
- Modify:
  - `server/services/ot/drivers/opcuaDriver.ts` `writeTags` `:929-949`;
  - `server/services/ot/drivers/s7Driver.ts` `:439-450`; `server/services/ot/drivers/mitsubishiMcDriver.ts` `:641-652`;
  - `server/services/ot/drivers/modbusDriver.ts` `writeOne` `:354-362`, `writeTags` `:372-384`; `server/services/ot/drivers/ethernetIpDriver.ts` `writeOne` `:328-334`, `writeTags` `:345-356`; `server/services/ot/drivers/slmpDriver.ts` `writeOne` `:443-449`, `writeTags` `:457-463`;
  - `server/services/ot/otDeviceWrite.ts` `:1314-1355` (errorText "link lost" theo từng write; nhánh `catch` ném cả lô GIỮ).
- Test: mới `server/services/ot/drivers/matLienKetTheoWrite.drivers.r1b2b2.test.ts`; hồi quy `dangBay.drivers.r1b2b1.test.ts`, `modbusDriver.ghiMoCoi.repro.test.ts`.

**Interfaces:**
- Consumes: `OtCommandResult.ketCucKhongRo`, `ketCucKhongRoCua` (Task 2).
- Produces: hằng `export const LOI_CHUA_GUI_MAT_LIEN_KET = "not sent: link lost earlier in this batch"` (`dangBay.ts`).

Chốt:
- **Lô một lần gửi (OPC UA, S7, MC):** catch lỗi mất liên kết ⇒ write có lỗi chuẩn bị cục bộ ⇒ `{ ok:false, error:<lỗi chuẩn bị> }` (`failed`); write đã đưa vào lời gọi thư viện ⇒ `{ ok:false, error:msg, ketCucKhongRo:"mat_lien_ket" }`.
- **Tuần tự (Modbus, EIP, SLMP):** write gặp mất liên kết ⇒ `ketCucKhongRo:"mat_lien_ket"`; mọi write SAU nó trong lô KHÔNG gọi thư viện ⇒ `{ ok:false, error: LOI_CHUA_GUI_MAT_LIEN_KET }`; write TRƯỚC nó giữ kết quả thật (`ok:true` ⇒ đọc lại như thường).
- **`executeOtDeviceWrite`:** write `"mat_lien_ket"` ⇒ `timeout` với errorText `link lost while the write was in flight (after <ms>ms) — outcome unknown: …` (đúng câu T17, `ms` tính từ `sentAt`); write `"qua_han_driver"` ⇒ câu của Task 2. Nhánh `catch` của lỗi có kiểu ném cả lô (plugin / phòng thủ) GIỮ y như T17. Ghi rủi ro (tuần tự hoá bật) như Task 2.
- T17 không đổi kết quả thời gian: driver vẫn trả lời ngay khi sổ đang bay huỷ.

- [ ] **Step 1: Test đỏ.**

```ts
// matLienKetTheoWrite.drivers.r1b2b2.test.ts — qua executeOtDeviceWrite, driver THẬT + thư viện giả (khuôn dangBay.drivers.r1b2b1.test.ts)
it("★ OPC UA: write 1 ép kiểu hỏng cục bộ + liên kết rớt khi session.write đang bay ⇒ write 1 'failed', write 2-3 'timeout' (Review Focus 3)", async () => {
  const o = await ghiOpcuaLoRotGiua([{ tagKey: "a", value: "x", dataType: "int" }, { tagKey: "b", value: 1 }, { tagKey: "c", value: 2 }]);
  expect(o.outcomes.map((x) => x.status)).toEqual(["failed", "timeout", "timeout"]);
  expect(o.outcomes[0].errorText).not.toMatch(/outcome unknown/);
  expect(o.outcomes[1].errorText).toMatch(/link lost while the write was in flight/);
});
it("★ Modbus 3 write: write 1 acked, socket đóng khi write 2 đang bay ⇒ ['acked_verified'|'acked', 'timeout', 'failed'], thư viện nhận đúng 2 lời ghi", async () => { /* … */ });
it("S7 / MC: địa chỉ sai cục bộ + rớt giữa writeItems ⇒ địa chỉ sai 'failed', còn lại 'timeout'", async () => { /* … */ });
it("EIP / SLMP: như Modbus (write sau điểm rớt LOI_CHUA_GUI_MAT_LIEN_KET)", async () => { /* … */ });
it("dispatcher: lô ['acked','timeout','failed'] ⇒ status 'timeout', ok false", async () => { /* … */ });
```

- [ ] **Step 2: Chạy.** Mong đợi: đỏ (hôm nay cả lô `timeout`).
- [ ] **Step 3: Cài.** Sửa các test T17 ghim "`writeTags` reject với `LoiMatLienKetKhiDangGui`" sang ghim kết quả theo từng write; ghi tên từng ca trong commit. Mỗi ca T17 "`timeout` < 300 ms" GIỮ nguyên số.
- [ ] **Step 4: Chạy lại** `server/services/ot/drivers` + `server/services/ot/otDeviceWrite*` + `server/services/ot/commandTimedOutWriteStop*` + `server/services/ot/commandDispatcher*` (DB) + `server/routers/scadaCommands*` (DB) + census / gate / guard. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:** OPC UA gắn `ketCucKhongRo` cho MỌI write (cả write lỗi chuẩn bị) ⇒ ca Review Focus 3 đỏ; Modbus vẫn gọi thư viện cho write sau điểm rớt ⇒ ca "đúng 2 lời ghi" đỏ; Modbus quay về ném cả lô ⇒ ca write 1 acked đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `fix(ot): mat lien ket giua lo ghi => nhan theo tung write o moi driver (chua giao thu vien = failed, da giao = timeout, da acked giu acked) (R1b-2b-2a T6, muc 69)`.

### Task 7: Mục rủi ro "lệnh ghi cũ" có trần, giữ ý định ĐẦU (mục 70)

**Files:**
- Modify: `server/services/ot/otDeviceWrite.ts`: kiểu `StaleWrite` `:160-176`, `intentCuaRuiRo` `:177-179`, `ghiRuiRoGhiCu` `:192-219`, `nhaGiuRuiRo` `:226-249`, seam test `:251-270`.
- Test: mới `server/services/ot/otDeviceWrite.ruiRoTran.r1b2b2.test.ts`; hồi quy `server/services/ot/commandTimedOutWriteStop.dot4.test.ts`, `modbusDriver.ghiMoCoi.repro.test.ts`.

**Interfaces:**
- Produces:
  - `export const TRAN_LENH_BO_TRONG_RUI_RO = 16`; `export const TRAN_WRITES_RUI_RO = 64`;
  - `StaleWrite.soLenhBoDaGop: number` (số lệnh bỏ đã bị cắt khỏi `nguonIntent`);
  - `export function _staleWriteRiskSoLieuForTests(adapterId: number): { soNguon: number; soWrites: number; soLenhBoDaGop: number; intentDau: number[] | null } | null`;
  - `export function _ghiRuiRoGhiCuForTests(input: DispatchInput, ledger: { intentIds: number[]; confirmedBy: number }, kieu: "giu" | "cua_so"): void`.

Chốt:
- `nguonIntent`: phần tử [0] (của lệnh bỏ ĐẦU — `intentIds[0]` là `entityId` của audit / báo động) KHÔNG BAO GIỜ bị cắt và giữ ĐÚNG tham chiếu (R-11-n nối intent của STOP vào mảng đang ghi); vượt `TRAN_LENH_BO_TRONG_RUI_RO` ⇒ bỏ phần tử [1] (cũ nhất sau phần tử đầu), `soLenhBoDaGop += 1`.
- `writes`: khử trùng theo `tagKey` + `JSON.stringify(value)` trước khi nối (lệnh lặp lại khi liên kết chập chờn không làm mục lớn thêm); vượt `TRAN_WRITES_RUI_RO` ⇒ giữ phần tử đầu, bỏ phần tử [1], cùng luật.
- Hạn (`untilHuuHan`, `soGiu`) không đổi: mỗi lần bỏ mới vẫn nới cửa sổ (đúng nghĩa — kết cục không rõ mới). Không bao giờ làm yếu mục (T17 fix round 1).
- Canh STOP (`startStopWatch`, `abandonedValueLanded` `:1006`) đọc `writes` đã khử trùng — kết quả nhận diện không đổi với mọi giá trị còn giữ.

- [ ] **Step 1: Test đỏ.**

```ts
it("100 lần bỏ (mỗi lần intent mới, cùng write) ⇒ ≤ 16 nguồn, nguồn ĐẦU giữ nguyên tham chiếu, writes = 1, đã gộp 84", () => {
  const dau = [1001];
  _ghiRuiRoGhiCuForTests(lenh(7, [{ tagKey: "spd", value: 50 }]), { intentIds: dau, confirmedBy: 1 }, "cua_so");
  for (let i = 1; i < 100; i++) _ghiRuiRoGhiCuForTests(lenh(7, [{ tagKey: "spd", value: 50 }]), { intentIds: [1001 + i], confirmedBy: 1 }, "cua_so");
  expect(_staleWriteRiskSoLieuForTests(7)).toEqual({ soNguon: 16, soWrites: 1, soLenhBoDaGop: 84, intentDau: [1001] });
  expect(_staleWriteRiskIntentIdsForTests(7)?.[0]).toBe(1001);
});
it("200 giá trị khác nhau ⇒ writes = 64, phần tử đầu là giá trị đầu", () => { /* … */ });
it("STOP acked sau 100 lần bỏ ⇒ báo động ot_stop_unverified liên kết intent 1001 (entityId không đổi)", async () => { /* qua executeOtDeviceWrite, tuần tự hoá bật */ });
```

- [ ] **Step 2: Chạy.** Mong đợi: đỏ (hôm nay 100 nguồn, 100 writes).
- [ ] **Step 3: Cài.**
- [ ] **Step 4: Chạy lại** `server/services/ot/otDeviceWrite*` + `server/services/ot/commandTimedOutWriteStop*` + `server/services/ot/drivers/modbusDriver.ghiMoCoi*` + `server/services/ot/stopEpochQueue*` + census / gate / guard. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:** cắt phần tử [0] thay cho [1] ⇒ ca "intent 1001" đỏ; bỏ khử trùng writes ⇒ ca `soWrites: 1` đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `fix(ot): muc rui ro lenh ghi cu co tran (16 lenh bo, 64 write khu trung), giu y dinh DAU cho bao dong/audit (R1b-2b-2a T7, muc 70)`.

### Task 8: So đọc lại tag int có scale lẻ bằng số THÔ thật của driver (mục 64)

**Quyết định (một đoạn):** KHÔNG thêm phương thức driver. Sáu driver dựng sẵn đã điền `OtSample.raw` = giá trị đã giải mã TRƯỚC `scaleXuoi` (Modbus `modbusDriver.ts:217`, SLMP `:310`, S7 `:320`, MC `:527`, EIP `:214`, OPC UA `opcuaDriver.ts` biến `raw` trước `normalizeOpcuaValue`). Chỉ thêm MỘT cờ khả năng `OtDriver.thoDocLaiTinDuoc` vì plugin sidecar đặt `raw: s.raw ?? s.value` (`pluginDriverBridge.ts:144`) và có thể tự khai `protocol` là `"modbus"` (`:196`) ⇒ không tin được theo tên giao thức. Số thô chỉ dùng cho NHÃN xác minh (`acked_verified` / `acked_unverified`), chỉ cho tag int có (scale, offset) khác (1, 0); float giữ so mô phỏng (không có bài toán làm tròn) (Q7, Q8).

**Files:**
- Modify:
  - `server/services/ot/otDriver.ts` `OtDriver` `:254-258` (`readonly thoDocLaiTinDuoc?: boolean`);
  - sáu driver: thêm `readonly thoDocLaiTinDuoc = true` cạnh `readonly protocol` (`modbusDriver.ts:77`, `s7Driver.ts:92`, `mitsubishiMcDriver.ts:301`, `ethernetIpDriver.ts:84`, `opcuaDriver.ts:172`, `slmpDriver.ts:82`);
  - `server/services/ot/drivers/readbackCompare.ts` `readbackMatches` `:31-72` (tham số 6 đổi kiểu);
  - `server/services/ot/otDeviceWrite.ts` `:1428-1431` (xác minh lệnh ghi) và `:1003`, `:1006` (canh STOP).
- Test: mới `server/services/ot/drivers/docLaiTho.drivers.r1b2b2.test.ts`; `server/services/ot/drivers/readbackCompare.test.ts`; `server/services/ot/otDeviceWrite.readback.r1b2b.test.ts:179-185` (LẬT có chủ ý).

**Interfaces:**
- Produces:
  - `export interface TuyChonSoDocLai { lopBit?: boolean; dungGhim?: boolean; thoTinDuoc?: boolean; thoDoc?: unknown }` (`readbackCompare.ts`);
  - `readbackMatches(expected: unknown, actual: unknown, dataType: OtDataType, tolerance = 1e-6, thangDo?: { scale?: number | string | null; offset?: number | string | null }, tuyChon?: TuyChonSoDocLai): boolean` — hai trường cũ `lopBit` / `dungGhim` giữ nguyên chỗ và nghĩa (người gọi cũ biên dịch không đổi).

Chốt:
- Nhánh bit-class và bool: không đổi.
- `dataType === "int"`, `(s, o)` sau `chuanHoaThangDo` khác (1, 0), `tuyChon.thoTinDuoc === true` ⇒ khớp ⇔ `typeof thoDoc === "number" && Number.isFinite(thoDoc) && thoDoc === inverseScale(e, "int", s, o)`. `thoDoc` không phải số hữu hạn ⇒ lệch (nhãn fail-closed; errorText `readback raw unavailable`).
- Mọi trường hợp khác ⇒ so mô phỏng của R1b-2b-1 T6 (y nguyên).
- `otDeviceWrite` truyền `thoTinDuoc: driver.thoDocLaiTinDuoc === true, thoDoc: s.raw` ở cả ba chỗ; errorText khi lệch có thêm `raw expected=<r> actual=<a>`.
- Driver nào ở Step 1 cho `raw` KHÔNG phải số thô trước scale ⇒ KHÔNG khai cờ (rơi về so mô phỏng), ghi giới hạn.

- [ ] **Step 1: Thăm dò từng driver (cổng).** `docLaiTho.drivers.r1b2b2.test.ts`: với mỗi driver (thư viện giả giữ thô 6 cho tag int scale 0,5 offset 0) ⇒ `readTags` trả `raw === 6` và `value === 3`; `StubDriver` và cầu plugin ⇒ `thoDocLaiTinDuoc` vắng. Driver lệch ⇒ ghi lại, không khai cờ, báo bộ điều khiển.
- [ ] **Step 2: Test đỏ.**

```ts
// readbackCompare.test.ts — R1b-2b-2a T8 (mục 64)
const tho = (v: unknown): TuyChonSoDocLai => ({ thoTinDuoc: true, thoDoc: v });
it("int scale 0,5: có số thô tin được ⇒ so đúng số thô (thô 6 ≠ 5 ⇒ lệch)", () => {
  expect(readbackMatches(2.5, 3, "int", 1e-6, { scale: 0.5 }, tho(6))).toBe(false);
  expect(readbackMatches(2.5, 3, "int", 1e-6, { scale: 0.5 }, tho(5))).toBe(true);
  expect(readbackMatches(2.3, 2, "int", 1e-6, { scale: 0.1 }, tho(23))).toBe(true);
  expect(readbackMatches(2.5, 3, "int", 1e-6, { scale: 0.5 }, tho("6"))).toBe(false);
  expect(readbackMatches(2.5, 3, "int", 1e-6, { scale: 0.5 }, { thoTinDuoc: false, thoDoc: 6 })).toBe(true); // không khai ⇒ so mô phỏng (T6)
  expect(readbackMatches(3, 3, "int", 1e-6, {}, tho(999))).toBe(true); // scale 1 / offset 0 ⇒ số thô không dùng
});
// ca cũ :108-111 GIỮ, đổi tên: "không có số thô tin được ⇒ giới hạn làm tròn của T6 vẫn còn (plugin / stub)"

// otDeviceWrite.readback.r1b2b.test.ts:179 — LẬT có chủ ý (R1b-2b-2a T8, ghi ngày 2026-10-27)
it("★ scale 0,5 ghi 2,5, thiết bị giữ thô 6 ⇒ đọc 3 nhưng thô 6 ≠ 5 ⇒ acked_unverified (Review Focus 4; trước: acked_verified)", async () => {
  const tb = thietBiModbus();
  tb.epTho(9, 6);
  const o = await ghi({ address: "holding:10", dataType: "int", value: 2.5, scale: 0.5, driver: tb.driver });
  expect(o.readBackValue).toBe(3);
  expect(o.status).toBe("acked_unverified");
  expect(o.errorText).toMatch(/raw expected=5 actual=6/);
});
```

  - thêm ca đối chứng cùng tệp: thiết bị giữ thô 5 ⇒ `acked_verified`; canh STOP (`startStopWatch`) với thô sai ⇒ `drift` có tag.
- [ ] **Step 3: Chạy.** Mong đợi: đỏ.
- [ ] **Step 4: Cài.**
- [ ] **Step 5: Chạy lại** `server/services/ot` + `server/services/scada/r1b2b1NghiemThu.db.test.ts` (opt-in, ô R1 thô 7) + `r1b2aNghiemThu` (opt-in, ô M1) + census / gate / guard (gồm `server/services/ot/lamTronScaleCensus.test.ts`). Mong đợi: xanh.
- [ ] **Step 6: Đột biến:** `otDeviceWrite :1428` không truyền `thoDoc` ⇒ ca thô 6 đỏ; `readbackMatches` dùng số thô cả khi `thoTinDuoc` false ⇒ ca "không khai" đỏ; Modbus bỏ cờ khả năng ⇒ ca thô 6 đỏ. Hoàn tác.
- [ ] **Step 7: Commit** `fix(ot): so doc lai tag int scale le bang so tho that cua driver (OtSample.raw + co thoDocLaiTinDuoc o 6 driver dung san; plugin/stub giu so mo phong) - tho 6 @0,5 nay acked_unverified (R1b-2b-2a T8, muc 64)`.

### Task 9: Cảnh báo khởi động + posture khi `DB_POOL_MAX` làm hụt ngân sách pool STOP (mục 71)

**Files:**
- Create: `server/services/scada/nganSachPoolStop.ts`.
- Modify:
  - `server/_core/index.ts:4431-4436` (gọi cảnh báo cạnh `kiemCauHinhLenhHmi`, trong cùng `try`);
  - `server/routers/oversightRouter.ts` `posture` `:742-786` (trường mới);
  - `client/src/pages/EngineeringHub.tsx:341-352` (một dòng posture);
  - `client/src/i18n/locales/{vi,en,zh}.json` (`oversight.posture.poolStopThieu`, cạnh `stopQuaHan` vi.json:17038).
- Test: `server/services/scada/nganSachPoolStop.test.ts` (ca mới); `server/routers/oversightRouter.test.ts`; `client/src/pages/EngineeringHub.dom.test.tsx`.

**Interfaces:**
- Consumes: `resolvePoolMax()` (`server/db/connection.ts:14`), `DONG_THOI_KHAO_SAT_DUNG_KHAN_CAP` (`mayDungKhanCap.ts:52`), `TRAN_GHI_TREO_STOP` (Task 1), `DU_TRU_POOL_CHO_DUNG_MAY` (`lenhHmi.ts:1409`).
- Produces:
  - `export interface NganSachPoolStop { poolMax: number; canToiThieu: number; du: boolean }`;
  - `export function kiemNganSachPoolStop(poolMax: number = resolvePoolMax()): NganSachPoolStop` — `canToiThieu = DONG_THOI_KHAO_SAT_DUNG_KHAN_CAP + TRAN_GHI_TREO_STOP + DU_TRU_POOL_CHO_DUNG_MAY` (= 25 hôm nay, KHÔNG viết cứng 25), `du = poolMax >= canToiThieu`;
  - `export function canhBaoNganSachPoolStopKhiKhoiDong(): void` — MỘT lần mỗi tiến trình; `!du` ⇒ `logger.warn({ poolMax, canToiThieu }, "[SCADA] DB_POOL_MAX … < … — ngân sách pool của STOP HMI hụt: khi DB chậm, lượt đọc trước-gửi của DỪNG MÁY có thể thiếu kết nối")`; không ném, không chặn khởi động, không đổi pool;
  - posture: `nganSachPoolStop: NganSachPoolStop` (không theo phạm vi — cấu hình tiến trình);
  - i18n `oversight.posture.poolStopThieu` = "Ngân sách pool STOP HMI hụt: DB_POOL_MAX {{poolMax}} < {{canToiThieu}}" (en / zh dịch, cùng placeholder). Dòng chỉ hiện khi `du === false`, màu token cảnh báo sẵn có của posture.

- [ ] **Step 1: Test đỏ.**

```ts
// nganSachPoolStop.test.ts — R1b-2b-2a T9 (mục 71)
it("pool 25 ⇒ đủ; 20 ⇒ hụt; 40 ⇒ đủ; cần tối thiểu = tổng trần + dự trữ = 25", () => {
  expect(kiemNganSachPoolStop(25)).toEqual({ poolMax: 25, canToiThieu: 25, du: true });
  expect(kiemNganSachPoolStop(20)).toEqual({ poolMax: 20, canToiThieu: 25, du: false });
  expect(kiemNganSachPoolStop(40).du).toBe(true);
});
it("cảnh báo khởi động MỘT lần khi hụt (DB_POOL_MAX=20), 0 lần khi đủ (DB_POOL_MAX rỗng ⇒ 25)", () => { /* vi.stubEnv + spy logger.warn, gọi 2 lần */ });
```

  - `oversightRouter.test.ts`: posture có `nganSachPoolStop` đúng hình; `DB_POOL_MAX=20` (stubEnv) ⇒ `du: false`.
  - `EngineeringHub.dom.test.tsx`: `du:false` ⇒ thấy câu vi "Ngân sách pool STOP HMI hụt: DB_POOL_MAX 20 < 25"; `du:true` ⇒ không có.
- [ ] **Step 2: Chạy.** Mong đợi: đỏ.
- [ ] **Step 3: Cài** + i18n.
- [ ] **Step 4: Chạy lại** `server/services/scada/nganSachPoolStop*` + `server/routers/oversight*` (unit + DB) + `client/src/pages/EngineeringHub*` + `npm run i18n:check` + census / gate / guard (gồm `appErrorCoverage`, `appErrorParamsCoverage`). Mong đợi: xanh.
- [ ] **Step 5: Đột biến:** `du` dùng `>` thay `>=` ⇒ ca pool 25 đỏ; viết cứng `canToiThieu = 25` rồi nâng `DU_TRU_POOL_CHO_DUNG_MAY` lên 10 trong test (seam) ⇒ ca tổng đỏ — nếu không dựng được seam, đột biến thay bằng "bỏ lời gọi trong `index.ts`" ⇒ không ca nào đỏ ⇒ thêm ca quét nguồn `index.ts` có `canhBaoNganSachPoolStopKhiKhoiDong` (khuôn `hanStopHmi.lamAm.test.ts`). Hoàn tác.
- [ ] **Step 6: Commit** `feat(scada): canh bao khoi dong + posture khi DB_POOL_MAX lam hut ngan sach pool cua STOP HMI (can toi thieu = tran khao sat + ghi treo + du tru) (R1b-2b-2a T9, muc 71)`.

### Task 10: Cầu chì Redis cho bộ giới hạn (mục 72; phần sản phẩm của mục 68)

**Quyết định (một đoạn):** MỘT cầu chì toàn tiến trình, dùng chung bởi mọi `StoreDuPhongBoNho` của client Redis giới hạn (cùng điểm gắn `storeOption`, `rateLimitConfig.ts:531-535`). Lỗi đầu tiên của Redis (ném, `-ERR`, quá `HAN_LENH_REDIS_GIOI_HAN_MS`) ⇒ cầu chì mở `HAN_CAU_CHI_REDIS_GIOI_HAN_MS` = 5000 ms: mọi tầng / mọi yêu cầu đi thẳng bộ nhớ, không gọi Redis. Hết 5 s ⇒ lượt kế tiếp thử Redis; ổn ⇒ đóng, lỗi ⇒ mở lại 5 s. Không thăm dò đơn lẻ (lượt đồng thời lúc vừa hết hạn có thể cùng thử — mỗi lượt tối đa 250 ms một lần). Hệ quả cho mục 68: dưới tải vòng lặp sự kiện, một Redis KHOẺ trả > 250 ms làm cầu chì mở 5 s ⇒ đếm tách đôi tối đa một trần thêm mỗi tiến trình mỗi cửa sổ (đã chấp nhận ở M-8), không bao giờ fail-open, và không còn trả 250 ms ở MỖI tầng (Q11).

**Files:**
- Modify:
  - `server/_core/rateLimitConfig.ts`: hằng cạnh `HAN_LENH_REDIS_GIOI_HAN_MS` `:399`; `StoreDuPhongBoNho` `:415-489`; `storeOption` `:531-535`;
  - `server/_core/hanStopHmi.ts:14-18` (đoạn "Bộ giới hạn" trong chú thích đầu).
- Test: mới `server/_core/rateLimitConfig.cauChi.r1b2b2.test.ts`; `server/_core/rateLimitConfig.duPhongBoNho.test.ts` (đặt lại cầu chì trong `beforeEach`).

**Interfaces:**
- Produces:
  - `export const HAN_CAU_CHI_REDIS_GIOI_HAN_MS = 5000`;
  - `export class CauChiRedisGioiHan { constructor(hanMoMs?: number, now?: () => number); dangMo(): boolean; baoLoi(e: unknown): void; baoTot(): void; _datLai(): void }` — `baoLoi` log tối đa một dòng / 60 s lúc mở;
  - `export const cauChiRedisGioiHan: CauChiRedisGioiHan` (đơn thể của tiến trình);
  - `StoreDuPhongBoNho` constructor thêm tham số 3 tuỳ chọn `cauChi?: CauChiRedisGioiHan`; `storeOption` truyền đơn thể.

Chốt:
- `increment` / `decrement`: `cauChi?.dangMo()` ⇒ chỉ `duPhong` (đánh dấu `dangDuPhong` để log hồi phục vẫn đúng); `chinh` ném ⇒ `cauChi.baoLoi(e)` rồi `duPhong` như hôm nay; `chinh` ổn ⇒ `cauChi.baoTot()`.
- `resetKey`: `duPhong` luôn; `chinh` chỉ khi cầu chì đóng (đang mở ⇒ bỏ, ghi giới hạn: khoá Redis có thể giữ đếm cũ tới hết cửa sổ — chặt hơn, không lỏng hơn).
- Không đổi trần, khoá, `skip`, message, `passOnStoreError`, kịch bản Lua của mọi tầng.

- [ ] **Step 1: Test đỏ.**

```ts
// rateLimitConfig.cauChi.r1b2b2.test.ts
it("★ Redis ném: 3 store dùng chung cầu chì ⇒ chỉ lượt ĐẦU gọi Redis; trong 5 s 0 lượt; sau 5001 ms đúng 1 lượt thử", async () => {
  let t = 0;
  const cc = new CauChiRedisGioiHan(5000, () => t);
  const redis = redisGiaNem();
  const s = [1, 2, 3].map(() => new StoreDuPhongBoNho(new RedisRateLimitStore({ prefix: "x:", client: redis }), new MemoryStore(), cc));
  for (const st of s) await st.increment("k");
  expect(redis.soLenh).toBe(1);
  t = 4999;
  await s[0].increment("k");
  expect(redis.soLenh).toBe(1);
  t = 5001;
  await s[1].increment("k");
  expect(redis.soLenh).toBe(2);
});
it("Redis chậm 2000 ms (commandTimeout 250): yêu cầu qua 3 tầng < 250 + 250 + lag thay vì ~750 (Review Focus 5)", async () => { /* lag helper, trần dung(200) */ });
it("cầu chì mở: limiter đăng nhập vẫn đếm trong bộ nhớ ⇒ 429 đúng ở lượt trần + 1", async () => { /* … */ });
it("STOP ký hợp lệ khi Redis chết: trả lời < 1000 ms + lag", async () => { /* khuôn duPhongBoNho (2) */ });
it("Redis khoẻ (hạn lệnh nâng qua seam như 5f8b78891): cầu chì không bao giờ mở; 600 INCR ở Redis, bộ nhớ 0", async () => { /* … */ });
it("hồi phục: Redis ổn lại sau khi mở ⇒ lượt thử sau 5 s ổn ⇒ đóng, lượt kế đếm ở Redis; khoá có TTL", async () => { /* … */ });
```

- [ ] **Step 2: Chạy.** Mong đợi: đỏ.
- [ ] **Step 3: Cài** + chú thích `hanStopHmi.ts`.
- [ ] **Step 4: Chạy lại** `server/_core/rateLimitConfig*` (gồm `.hmiStop.db.test.ts` bằng `-c vitest.db.config.ts`) + `server/_core/trpcGioiHanThuTuc*` + `server/_core/hanStopHmi*` + census / gate / guard + R1b-2b-1 opt-in (ô G3) + R1b-2a opt-in (ô G1 / G2). Chạy `duPhongBoNho.test.ts` riêng 3 lượt ở tải hiện có của máy. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:** cầu chì không bao giờ mở ⇒ ca "chỉ lượt ĐẦU" đỏ; cầu chì không bao giờ đóng ⇒ ca "sau 5001 ms" + ca hồi phục đỏ; `dangMo()` mà vẫn gọi Redis ⇒ ca 3 tầng (thời gian) đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `fix(auth): cau chi Redis 5 s cho moi tang gioi han - loi dau tien dua moi tang ve bo nho, khong tra 250 ms o moi tang noi tiep; Redis khoe cham duoi tai chi lam dem tach doi trong 5 s, khong fail-open (R1b-2b-2a T10, muc 72, 68)`.

### Task 11: Nghiệm thu R1b-2b-2a

**Files:**
- Create:
  - `server/services/scada/r1b2b2aNghiemThu.db.test.ts` (opt-in `SCADA_R1B2B2A_NGHIEM_THU=1`; `OT_CONTROL_ENABLED="true"`, `AI_OT_CONTROL_ENABLED="false"` chỉ trong tiến trình; khuôn `r1b2b1NghiemThu.db.test.ts:38-50`);
  - `docs/superpowers/plans/2026-10-27-scada-r1b-2b-2a-bao-cao-nghiem-thu.md`.

Cổng:

| Ô | Kích thích | Mong đợi |
|---|---|---|
| T0 | ba ca thiết bị đo của Task 0 chạy trong ô (gọi lại cùng hàm đo) | xanh; số `truocRao` / `sauRao` ghi báo cáo |
| P1 | CHỈ audit chậm; 12 lần bấm máy G; rồi máy G2 | 12 × `acked_verified`; lượt treo ≤ 8; ≥ 4 `_bo_qua_day` có nội dung; G2 `acked_verified` < 1700 ms + lag |
| P2 | audit + attempts chậm; hạn tổng cạn; máy chưa ghim | `STOP_QUA_HAN`; lượt treo ≤ 8; `ghi_so_loi` +1 khi đầy |
| D1 | Modbus thật, peer im lặng, `timeoutMs` 300, hạn lệnh 2000; tuần tự hoá bật; rồi STOP acked | `timeout` (không `failed`) < 800 ms + lag; rủi ro ghi; STOP sau có canh 1 |
| D2 | S7 / MC quá hạn ghi (cấu trúc thăm dò ở Task 3) / PLC trả lỗi ghi | `timeout` / `failed` |
| D3 | reject thường trong ân hạn B3 | rủi ro ghi, không đặt lại phiên |
| I1 | `resolveEvent` khi adapter đích đổi sang nhà máy B giữa chừng | NOT_FOUND `interlockEvent`, sự kiện `open`, 0 audit |
| C1 | hai hàm quét của Task 5 trên cây | (A) 0 vi phạm; (B) = tập nợ |
| O1 | OPC UA lô [ép kiểu hỏng, a, b] rớt giữa lô; Modbus 3 write rớt ở write 2 | `failed, timeout, timeout`; `acked*, timeout, failed` |
| R1 | 100 lần bỏ trên một adapter | ≤ 16 nguồn, ≤ 64 write, intent đầu giữ |
| H1 | Modbus thật int scale 0,5 ghi 2,5, thiết bị thô 6 / 5 | `acked_unverified` / `acked_verified` |
| K1 | `DB_POOL_MAX` 20 / rỗng | posture `du:false` + 1 cảnh báo / `du:true` + 0 |
| Z1 | Redis ném; yêu cầu qua 3 tầng; 601 STOP một phiên | 1 lượt Redis trong 5 s; lượt 601 ⇒ 429; STOP < 1 s |

- [ ] **Step 1:** viết test opt-in; chạy 3 lượt tuần tự; xanh. Đỏ ⇒ về task sở hữu, không nới ngưỡng. Không đặt biến ⇒ skipped.
- [ ] **Step 2: Đột biến hệ thống:** `executeOtDeviceWrite` bỏ ánh xạ `ketCucKhongRo` ⇒ D1 + O1 đỏ. Ghi lại. Hoàn tác.
- [ ] **Step 3: Bench — TUỲ CHỌN, chỉ khi điều phối cho phép ngay lúc đó.** Đề xuất một ô cho mục 66: OpenPLC bench qua proxy `--cat-lien-ket` ở chế độ GIỮ phản hồi FC5 (không cắt) với `timeoutMs` 800 ⇒ STOP `timeout` ~800 ms, coil đọc lại bằng client riêng, 3 lượt; ô đối chứng proxy thông suốt TRƯỚC (luật điều phối 2026-10-27: đối chứng đỏ ⇒ hàng cắt không được nhận). Commit trống ≥ 10 GB; không chạm :3000 / :8091 / GPU; trả coil + container về gốc. Không được phép ⇒ ghi "bench not run" + lý do; bằng chứng sản phẩm là test trong tiến trình với driver thật + thư viện thật.
- [ ] **Step 4: Báo cáo.** Bảng số đo, đột biến (tệp:dòng), giới hạn đã biết, rồi:
  - thay đổi hành vi nhìn thấy được: STOP / lệnh mà driver tự hết hạn nay `timeout` + băng `khong_ro`; lô rớt liên kết có nhãn theo từng write; tag int scale lẻ sai thô nay `acked_unverified`; posture có dòng ngân sách pool; bộ giới hạn mở cầu chì 5 s;
  - giới hạn: audit nền của B3 / canh STOP và lượt đọc trước-gửi bị bỏ rơi ngoài bộ đếm; trần theo TIẾN TRÌNH (N bản API ⇒ N × 8); `resetKey` bỏ Redis khi cầu chì mở; driver không khai `thoDocLaiTinDuoc` vẫn có giới hạn làm tròn; ghi chú dư ~160 ms của `dot4`;
  - **câu nguyên văn: "R1b-2b-2a là điều kiện cần; bật `AI_OT_CONTROL_ENABLED` là quyết định của chủ dự án sau rà soát độc lập riêng"**;
  - danh sách R1b-2b-2b;
  - ghi tách LOGIC · DỮ LIỆU · VẬN HÀNH.
- [ ] **Step 5: Chạy toàn bộ — CHỈ sau khi điều phối nói "OK chạy ngay"** (báo "sẵn sàng" trước):
  - `node scripts/luoi-truoc-gop.mjs --nang server shared client/src scripts vscode-extension/src`;
  - lô serial (`vitest.serial.config.ts`);
  - mọi `*census*`;
  - opt-in R0 + R1a + R1b-1 + R1b-2a + R1b-2b-1 + R1b-2b-2a;
  - `npm run check` (12 GB); `npm run i18n:check`.
  - Phân loại mọi tệp đỏ (lô / tải / có sẵn); tải ⇒ chạy riêng tệp đó, không bao giờ nới ngưỡng.
- [ ] **Step 6: Commit** `test(scada): nghiem thu R1b-2b-2a - ghi nen co tran chung, het han driver = timeout, resolveEvent duoi khoa, census khoa/pool, nhan theo tung write, rui ro co tran, doc lai tho, ngan sach pool, cau chi Redis`.

---

## Bàn giao sau R1b-2b-2a

- Báo điều phối để giao kiem-dinh. **Không push.**
- Không migration. Nếu phát sinh: 0435–0439 (báo bộ điều khiển trước), gửi SQL, chờ "áp" mới áp DEV.
- Không đổi `AI_OT_CONTROL_ENABLED` ở bất cứ đâu.
- Viết kế hoạch R1b-2b-2b sau khi R1b-2b-2a được duyệt.

## Bảng xung đột giữa các task (kiểu preflight — mọi cặp dùng chung tệp)

| Cặp | Tệp chung | Rủi ro | Cách giải |
|---|---|---|---|
| T0 – T1 | `scadaCommandsRouter.dungMay.soCoHan.r1b2b.db.test.ts`, `…hanTruocGui.r1b2.db.test.ts` (T0 sửa; T1 chạy lại); `lenhHmi.ts` (T1 sửa `ghiSoCoHan` mà soCoHan đo) | T1 làm đổi đường được đo của T0 | T0 trước; T1 Step 4 chạy lại cả hai tệp; tên `soGhiSoTreoStopHmi` / `HAN_GHI_SO_STOP_HMI_MS` giữ bằng tái xuất |
| T1 – T2 | `commandDispatcher.ts` (T1 `auditPinnedStopOverride` :1941; T2 cuộn trạng thái :1918) | khác hàm | tuần tự T1 → T2 |
| T1 – T9 | `nganSachPoolStop.test.ts` (T1 ca AST bộ đếm chung; T9 ca `kiemNganSachPoolStop`); hằng `lenhHmi.ts` / `ghiTreoCoTran.ts` | T9 đọc hằng T1 đặt | T9 import `TRAN_GHI_TREO_STOP` từ module T1; ca cũ 8/8/9 giữ |
| T2 – T3 | `dangBay.ts` (T2 tạo `LoiQuaHanYeuCauDriver`, `HAN_DU_PHONG_GHI_DRIVER_MS`; T3 dùng); `quaHanDriver.drivers.r1b2b2.test.ts` (T3 thêm ca S7 / MC) | tên | Interfaces T2 → T3 |
| T2 – T6 | `otDriver.ts` `OtCommandResult`; sáu tệp driver (catch ghi); `otDeviceWrite.ts` :1314-1371; `dangBay.ts` | T6 đổi chính catch mà T2 vừa sửa | T6 sau T2, xây trên `ketCucKhongRo`; T2 KHÔNG đổi chuyện ném lỗi mất liên kết |
| T3 – T6 | `s7Driver.ts`, `mitsubishiMcDriver.ts` (cùng khối catch ghi) | sửa chồng | tuần tự T3 → T6; T6 đọc lại khối sau T3 |
| T2 – T7 | `otDeviceWrite.ts` (T2 thêm chỗ gọi `ghiRuiRoGhiCu` + nhánh ân hạn; T7 đổi thân `ghiRuiRoGhiCu`) | ca T7 phải phủ cả chỗ gọi mới | T7 Step 4 chạy `otDeviceWrite.khongRo.r1b2b2.test.ts` |
| T6 – T7 | `otDeviceWrite.ts` (:1340 ghi rủi ro theo write) | như trên | như trên |
| T2 / T6 – T8 | sáu tệp driver (T8 thêm cờ cạnh `protocol`); `otDriver.ts` (T8 thêm cờ vào `OtDriver` :254); `otDeviceWrite.ts` (T8 đọc lại :1381-1444, :1003-1006) | khác khối | tuần tự; T8 sau T6 |
| T4 – T5 | `interlockRouter.ts` (T4 sửa; T5 quét + ghim `resolveEvent` KHÔNG ở tập nợ) | T5 đỏ nếu T4 chưa xong | T5 sau T4 |
| T1 – T10 | `server/_core/hanStopHmi.ts` (T1 chỉ gọi `ghiNhanStopQuaHanKhongGhiSo`; T10 sửa chú thích đầu) | không | — |
| T9 – (khác) | `server/_core/index.ts`, `oversightRouter.ts`, `EngineeringHub.tsx`, i18n | chỉ T9 | — |
| T11 – mọi task | mọi tệp | — | chạy cuối |

## Danh sách R1b-2b-2b (chỉ liệt kê — kế hoạch riêng)

Số giữ theo danh sách R1b-2b-2 của kế hoạch R1b-2b-1 để đối chiếu 1-1.

**Nhật ký, chạy khô, UI:** 1 (M9 `/scada/journal` + nợ phạm vi `commandLogRouter`), 2 (M4 chạy khô "Điều kiện cho phép"), 3 (M12 tìm kiếm bảng, deadband trước lưu, ô chọn adapter mặc định), 4 (chip "Truyền thông n/m"), 5 (lab "thử đọc một địa chỉ"), 6 (`danhSach` lộ endpoint / `lastError`), 7 (`ketNoiLai` giới hạn tần suất + audit trong giao dịch), 8 (tắt nóng `SCADA_SOCKET`), 9 (trần tổng tag / người dùng), 10 (nhãn "sim" trong sổ lệnh), 49b (form sửa tag thật có TOTP).

**Tính năng driver và phần dư T3 / T4:** 14 (C6 đọc khối Modbus), 15 (đo mất / có lại liên lạc OPC UA), 16 (nhịp nguồn ngoài OT trung tâm), 19 (`napTuOt` khi DB treo), 20 (thử lại lô mẫu xấu bị bỏ), 21 (watchdog thừa mẫu đường push), 22 (kế toán mất liên lạc khi reset HA), 23 (ghi trong lúc chờ lần đọc tốt đầu), 24 (thứ tự canh `sinkPhien`), 52 (K13 "`stale` = đã trả lời"), 60 (OPC UA cuộc đua tin cậy chứng chỉ).

**AI và cổng mức:** 17, 18, 30, 31, 43, 57.

**Census, posture, vận hành:** 25 (điểm mù census còn lại), 26, 27, 28, 29, 32, 33 (khảo sát `cheDo.danhSach` mỗi 5 s — gồm câu hỏi gộp khe khảo sát vào ngân sách chung, Q1), 34, 35, 36, 37, 38, 39, 40, 41, 50, 54, 55, 56.

**Còn mở từ báo cáo R1b-1 §10:** mục 21, 22 (Q12 R1b-2b-1), 23, 24, 25, 26.

**Ngoài R1b-2b-2a / R1b-2b-2b:**
- 65 thử lại STOP một lần — quyết định chủ dự án (Q12 dưới đây);
- 67 bench cắt liên kết ổn định — ngoài lát này;
- 68: phần thiết bị đo đã sửa ở `5f8b78891` (R1b-2b-1); phần sản phẩm ở Task 10.

**Phát sinh từ R1b-2b-2a (mới):**
- 73. Audit nền của B3 / canh STOP (`auditWriteOverlapRisk`, báo động `ot_stop_unverified`) và `raiseUnverifiedStopRefusedAlert` chưa chịu bộ đếm ghi treo (Task 1 §ngoài phạm vi).
- 74. Lượt đọc / chèn dòng chờ trước-gửi của `dungMay` bị bỏ rơi khi quá hạn (`trongHanStop`) không có trần — người dùng phần dự trữ 9.
- 75. Nợ "pool trong giao dịch" đo được ở Task 5 (tập `NO_POOL_TRONG_TX`) — sửa từng phần tử, mỗi phần tử gỡ khỏi tập.
- 76. OPC UA `BadTimeout` theo node (máy chủ tự hết hạn) giữ `failed` — xem lại có nên là `timeout`.

**Đã làm ở R1b-2b-2a (đối chiếu):** 61 (T1), 62 (T4), 63 (T5), 64 (T8), 66 (T2, T3), 69 (T6), 70 (T7), 71 (T9), 72 (T10), 68 phần sản phẩm (T10); ba điểm thiết bị đo của báo cáo đột biến trễ (T0).

## Tự rà soát (đã chạy)

1. **Phủ yêu cầu.** Task 0 (a) → T0 Step 2 dòng hanTruocGui + đột biến 800 không chặn / 900 bận; (b) → T0 Step 1 đo nguyên nhân + tách đoạn, tổng 1700 không đổi; (c) → T0 chú thích + báo cáo §giới hạn. 61 → T1 (attempts + audit của `tuChoiQuaHan`, vòng `STOP_QUA_HAN`, mọi `recordAuditEvent` của đường `dungMay` + `auditPinnedStopOverride`; bỏ qua khi đầy có log nội dung; ngân sách pool giữ 8 + 8 ≤ 25 − 9, quyết định "chung 8" + Q1). 66 → T2 (Modbus / SLMP / EIP / OPC UA, ân hạn B3, cuộn trạng thái, ai thắng cuộc đua 5000 ms) + T3 (S7 / MC qua thăm dò). 62 → T4. 63 → T5. 64 → T8 (driver nào hỗ trợ: sáu driver dựng sẵn qua `OtSample.raw`; plugin / stub không; ghim `readbackCompare` / `otDeviceWrite.readback` thô 6 lật có chủ ý). 69 → T6. 70 → T7. 71 → T9. 72 → T10 (+ 68 phần sản phẩm). Nghiệm thu → T11 (lưới opt-in 3 lượt, đột biến hệ thống, báo cáo, toàn bộ chỉ sau OK, bench tuỳ chọn có duyệt). Ngoài phạm vi: 65 (Q12), 67, phần còn lại → danh sách R1b-2b-2b 1-1.
2. **Quét bước.** Mỗi bước code có tệp:dòng, chữ ký và giá trị (`HAN_GHI_TREO_MS` 500, `TRAN_GHI_TREO_STOP` 8, `HAN_DU_PHONG_GHI_DRIVER_MS` 6500, `TRAN_LENH_BO_TRONG_RUI_RO` 16, `TRAN_WRITES_RUI_RO` 64, `HAN_CAU_CHI_REDIS_GIOI_HAN_MS` 5000, `CAN_TRUOC_RAO_MS` 300 + `CAN_SAU_RAO_MS` 1400 = 1700). Hằng thư viện của T3 (`S7_ERRCODE_QUA_HAN_GHI`, `MC_ERRCODE_QUA_HAN_GHI_*`) lấy từ bước thăm dò có cổng DỪNG — không phải chỗ trống: mã nguồn thư viện đã cho chuỗi dự kiến (dòng nguồn ghi ở Interfaces). Tập ghim của T5 (`NO_POOL_TRONG_TX`, `HAM_KHOA_LUAT_CO_HOP_DONG`) đo ở Step 1, có cổng DỪNG cho vi phạm (A). Không thân hàm ngoài test.
3. **Nhất quán kiểu.** `ghiCoTran` / `TuyChonGhiCoTran` / `soGhiTreoStop` / `TRAN_GHI_TREO_STOP` / `HAN_GHI_TREO_MS` (T1 → T9); `ghiSoCoHan(…, khiKhongVaoSo?)` (T1); `LoiQuaHanYeuCauDriver`, `ketCucKhongRoCua`, `KetCucKhongRo`, `HAN_DU_PHONG_GHI_DRIVER_MS`, `OtCommandResult.ketCucKhongRo` (T2 → T3, T6); `LOI_CHUA_GUI_MAT_LIEN_KET` (T6); `khoaDichLuatTx(…, khoaLuat)` (T4 → T5 đột biến); `quetKhoaLuat` / `quetPoolTrongTx` (T5 → T11 ô C1); `_ghiRuiRoGhiCuForTests`, `_staleWriteRiskSoLieuForTests` (T7 → T11 ô R1); `TuyChonSoDocLai`, `OtDriver.thoDocLaiTinDuoc` (T8); `kiemNganSachPoolStop`, `NganSachPoolStop` (T9 → T11 ô K1); `CauChiRedisGioiHan`, `cauChiRedisGioiHan` (T10 → T11 ô Z1). Tên công khai cũ (`TRAN_GHI_SO_TREO_STOP_HMI`, `HAN_GHI_SO_STOP_HMI_MS`, `soGhiSoTreoStopHmi`, `readbackMatches` 6 tham số, `khoaDichLuatTx` 4 tham số) giữ.
4. **Review Focus.** Năm dòng, mỗi dòng có test trong task sở hữu: T1 (12 lần bấm, CHỈ audit chậm), T2 (Modbus im lặng 300 / 2000), T6 (OPC UA lô trộn + Modbus 3 write), T8 (thô 6 / 5), T10 (3 tầng, Redis chết).
5. **Tỷ lệ.** Kế hoạch nêu quyết định, chữ ký, giá trị và test; khối code chỉ là test. Task 2 và 3 tách theo ranh giới mà người rà soát có thể bác riêng (lõi + thư viện ném lỗi / thư viện báo bằng callback cần thăm dò).

## Câu hỏi chỉ điều phối trả lời được — kèm khuyến nghị

- **Q1 (T1).** Lượt ghi nền có từ trước dùng CHUNG trần 8 với `ghiSoCoHan` (không phải trần riêng)? Ngân sách giữ 8 (khảo sát) + 8 (ghi treo) ≤ 25 − 9. Có gộp luôn khe khảo sát của khối DỪNG khẩn cấp (và khảo sát `cheDo.danhSach`, mục 33) vào MỘT ngân sách 16 như câu chữ mục 61 không? *Khuyến nghị:* chung 8 cho sổ + ghi nền ở lát này; khe khảo sát giữ trần riêng 8 với bất đẳng thức đã ghim; việc gộp một ngân sách để R1b-2b-2b cùng mục 33.
- **Q2 (T1).** `auditPinnedStopOverride` của dispatcher chịu bộ đếm cho MỌI STOP ghim (không chỉ HMI); dòng attempts bị bỏ qua vì đầy được đếm vào posture qua nhóm có sẵn `ghi_so_loi` (không thêm giá trị vào tập đóng `BuocKhongGhiSo`). *Khuyến nghị:* duyệt cả hai.
- **Q3 (T2).** Thay đổi nhìn thấy được: STOP / lệnh mà driver tự hết hạn đổi `failed` → `timeout` ⇒ HMI hiện "Không rõ máy đã nhận hay chưa" + băng E-STOP cứng `khong_ro` (thay "không đạt" + dòng E-STOP); sổ lệnh / posture đếm `timeout`; không khoá i18n mới. *Khuyến nghị:* duyệt (đúng chiều an toàn: lệnh có thể đã tới thiết bị).
- **Q4 (T2, T3).** Cuộc đua 5000 ms: nâng bộ hẹn DỰ PHÒNG của S7 / MC / EIP lên 6500 để hạn dispatcher (5000 + ân hạn 1000) thắng trong cấu hình mặc định ⇒ B3 giữ chỗ + đặt lại phiên luôn chạy khi thư viện còn giữ yêu cầu; hết hạn RIÊNG của thư viện (nodes7 `globalTimeout` = `timeoutMs`, mcprotocol 4500, modbus-serial, `timeout_sp`) vẫn có thể tới trước — nhãn như nhau (`timeout`), rủi ro được ghi. *Khuyến nghị:* duyệt.
- **Q5 (T2).** Mọi reject của lời ghi trong ân hạn B3 (không chỉ lỗi mất liên kết có kiểu) và mọi kết quả mang `ketCucKhongRo` đều ghi rủi ro "lệnh ghi cũ" ⇒ STOP acked kế tiếp có canh chỉ-báo-động. Cái giá: thêm canh đọc (không ghi) trong trường hợp lỗi thực ra đã biết kết cục. *Khuyến nghị:* duyệt (fail-safe).
- **Q6 (T6).** Mở mục 69 từ OPC UA sang cả sáu driver (cùng lớp lỗi): write chưa giao thư viện ⇒ `failed`, đã giao ⇒ `timeout`, write tuần tự đã acked trước điểm rớt giữ `acked*`. *Khuyến nghị:* duyệt.
- **Q7 (T8).** Đọc lại thô KHÔNG cần phương thức driver mới: dùng `OtSample.raw` có sẵn + một cờ khả năng tuỳ chọn `thoDocLaiTinDuoc` trên sáu driver dựng sẵn; plugin / stub rơi về so mô phỏng. *Khuyến nghị:* duyệt.
- **Q8 (T8).** Số thô chỉ dùng cho tag int có (scale, offset) ≠ (1, 0); float giữ so mô phỏng trong dung sai; số thô vắng / không phải số hữu hạn với driver đã khai ⇒ `acked_unverified`. *Khuyến nghị:* duyệt.
- **Q9 (T7).** Trần mục rủi ro: 16 lệnh bỏ, 64 write khử trùng, giữ lệnh ĐẦU + các lệnh mới nhất, đếm số đã gộp. *Khuyến nghị:* duyệt.
- **Q10 (T9).** Ngân sách pool hụt chỉ CẢNH BÁO (log khởi động một lần + một dòng posture ở EngineeringHub), không từ chối khởi động, không tự nâng pool. *Khuyến nghị:* duyệt.
- **Q11 (T10).** Tham số cầu chì: mở 5000 ms sau lỗi ĐẦU TIÊN, dùng chung mọi tầng của tiến trình, không thăm dò đơn lẻ, `resetKey` lên Redis bị bỏ khi đang mở (chặt hơn). Dưới tải, một Redis khoẻ chậm > 250 ms làm cầu chì mở 5 s (đếm tách đôi, không fail-open). *Khuyến nghị:* duyệt như viết; nếu điều phối muốn ít đếm tách đôi hơn, đổi ngưỡng mở thành 2 lỗi liên tiếp trong 1 s (một hằng).
- **Q12 (mục 65).** Thử lại STOP MỘT lần trên kết nối mới trong hạn tổng 2,5 s — quyết định của chủ dự án; sau Task 2–3, mọi kết cục không rõ đều là `timeout` có băng E-STOP, nên thử lại tự động sẽ gửi STOP lần hai khi có thể đã tới. *Khuyến nghị:* KHÔNG làm ở R1b-2b-2a; hỏi chủ dự án kèm số đo của ô D1 / O1.
- **Q13 (T5).** Phạm vi census (B) "pool trong giao dịch" giới hạn ở bề mặt SCADA / OT / interlock / engineeringAssignment, nợ đo được ghim bằng ratchet, không sửa ở lát này. *Khuyến nghị:* duyệt; mở rộng toàn `server/**` ở R1b-2b-2b mục 75.
- **Q14 (T11).** Chạy ô bench tuỳ chọn cho mục 66 (OpenPLC qua proxy giữ phản hồi FC5, đối chứng thông suốt trước)? *Khuyến nghị:* không chạy trừ khi điều phối muốn số đo trên thiết bị thật; bằng chứng tất định là driver thật + thư viện thật trong tiến trình (mục 67 vẫn mở).

## ĐÃ DUYỆT — điều phối 2026-10-27 (có hiệu lực như Global Constraints)

Kế hoạch c75bf354e DUYỆT. Trả lời:
- **Q1** hoãn sang 2b. **Q2** đồng ý; bản ghi bị bỏ qua ⇒ đếm vào `ghi_so_loi`, có test. **Q3** đồng ý (nhất quán T17: chưa rõ ⇒ "không rõ" + băng E-STOP; ghi vào "thay đổi hành vi nhìn thấy được").
- **Q4** đồng ý: dự phòng driver 6500 ms > 5000 ms của dispatcher; test đua khẳng định dispatcher thắng. **Q5** đồng ý.
- **Q6 CÓ** — cả 6 driver; viết lại các test T17 ghim "writeTags reject" sang kết quả từng ghi, mỗi test viết lại phải giữ đột biến đỏ.
- **Q7** đồng ý. **Q8** đồng ý (float giữ sai số tương đối). **Q9** đồng ý (16 / 64, giữ ý định đầu; vượt trần ⇒ đếm + log, không mất ý định đầu). **Q10** đồng ý (chỉ cảnh báo log + posture).
- **Q11** đồng ý (mở 5 s chung, không thăm dò đơn; ghi rõ cái giá: mọi tầng rơi bộ nhớ 5 s). **Q12** KHÔNG ở lát này — chờ chủ dự án. **Q13** đồng ý (ratchet theo nợ đo được). **Q14** KHÔNG chạy bench (đối chứng proxy đã đỏ — công cụ chưa tin được).
- **T5 Step 1:** thấy luật bị khoá TRƯỚC adapter ở bất kỳ đường nào ⇒ DỪNG, báo điều phối + kiem-dinh ngay.
- Quy trình: kiem-dinh rà kế hoạch song song; T0 (chỉ test) bắt đầu ngay. Hợp đồng máy chủ cho phần giao diện ở kế hoạch riêng 2b-A (scada-master); giao diện ở 2b-B (phiên scada-ui).

## Rà soát kiem-dinh 2026-10-27 (KD-2a) — RÀNG BUỘC, thắng chữ của task khi mâu thuẫn

kiem-dinh rà c75bf354e: ĐẠT CÓ ĐIỀU KIỆN — A1 phải sửa TRƯỚC khi viết mã T1; còn lại chỉnh trong lúc làm task sở hữu.

- **KD-A1 (T1, QUAN TRỌNG) — đếm IN-FLIGHT.** `ghiCoTran` / `ghiSoCoHan` đếm +1 NGAY lúc PHÁT lượt ghi, −1 lúc lượt ấy xong (kể cả lượt bỏ rơi); trần `TRAN_GHI_SO_TREO_STOP_HMI` = 8 áp ngay từ lượt đầu. Hạn 500 ms chỉ quyết định khi nào trả lời người gọi đang `await` (vô nghĩa với `void`). Lý do: đếm "chỉ khi đã quá 500 ms" cho phép 3N truy vấn cùng treo trong 500 ms đầu khi các lượt ghi chuyển sang `void`. DB nhanh vẫn không chạm 8 (lượt xong < vài ms). Test DB Review Focus 1: 12 lần bấm SONG SONG trong < 500 ms (`Promise.all`) ⇒ số backend chờ khoá (NOT granted) ≤ 8 NGAY; đột biến "đếm chỉ khi quá hạn" ⇒ ĐỎ. Đổi này áp cả cho bộ đếm T9 đã gộp (cùng hàm) — ghi vào "thay đổi hành vi nhìn thấy được".
- **KD-A2 (T1) — census theo vị từ NGƯỢC.** Trong thân `dungMayHmi` / `guiStopMotAdapter` / `ghiThuCoHan` / `auditPinnedStopOverride`: MỌI lời gọi không `await` / `return` (câu `void f(...)`, promise nổi) mà không phải đối số / được bọc bởi `ghiCoTran | ghiSoCoHan` hoặc `logger.*` ⇒ ĐỎ; kèm cầu chì đếm; thiết bị đo: nguồn tổng hợp có `void db.insert(...)` ⇒ bắt.
- **KD-A3 (T1) — audit bị bỏ qua phải ĐẾM**, không chỉ log: thêm nhóm trong tập đóng (hoặc bộ đếm riêng cùng posture) như attempts → `ghi_so_loi`; ghi vào §giới hạn: STOP vẫn có `command_log`.
- **KD-B1 (T2/T3) — mặc định về phía AN TOÀN.** S7 / MC: chỉ gán `failed` khi NHẬN DIỆN DƯƠNG phản hồi lỗi của PLC (errCode thuộc tập đã thăm dò) hoặc lỗi cục bộ CHẮC CHẮN chưa gửi; mọi `anyBadQualities` khác và cấu trúc item không đọc được ⇒ `timeout`. Ghim phiên bản thư viện bằng test (nodes7 / mcprotocol / modbus-serial / st-ethernet-ip / node-opcua khớp bản đã thăm dò; nâng bản ⇒ đỏ, buộc thăm dò lại).
- **KD-B2 (T2) — đua hạn khi `ackTimeoutMs` cấu hình lớn.** Dự phòng driver = hạn lệnh + ân hạn + biên (truyền hạn lệnh xuống driver), HOẶC test với ack 10 000 khẳng định nhãn vẫn `timeout` + rủi ro ghi được ghi; chọn một, ghi rõ.
- **KD-B3 (T2) — `laQuaHanModbusSerial`** (ETIMEDOUT) không được bắt lỗi KẾT NỐI trước khi gửi: ca "Port Not Open / connect timeout ⇒ `failed`".
- **KD-C1 (T4) — test tất định** thay / bổ sung ca xác suất "10 vòng không 40P01": hai giao dịch giữ chéo bằng bắt tay advisory / `pg_blocking_pids`; thêm ca "luật bị xoá / đổi adapter giữa lần đọc không khoá và lúc khoá" ⇒ NOT_FOUND / CONFLICT đúng.
- **KD-C2 (T5) — census pool-trong-giao-dịch theo ĐIỂM BẤT ĐỘNG xuyên tệp** (tên export → thân có `getDb` / `getDbRaw` hoặc gọi hàm trong tập), cấm gọi chúng trong callback giao dịch có khoá; mơ hồ tên ⇒ về phía bảo thủ. Phần (A) `coKhoaAdapterTruoc` theo thứ tự nguồn không bắt khoá có điều kiện (`if (x) khoaAdapterTx`) — thêm thiết bị đo cho dạng đó hoặc ghi giới hạn.
- **KD-D1 (T10).** Ghi giới hạn: cầu chì mở ⇒ bộ đếm nhớ có thể "quên" lượt đã bị Redis chặn (fail-open một phần ≤ 5 s mỗi lần mở) + đa tiến trình ⇒ N× trần; test "Redis khoẻ" dùng seam hạn lệnh (như 5f8b78891) và ĐẾM công việc thay vì đo thời gian.
- Q1–Q14: kiem-dinh đồng ý khuyến nghị, trừ Q1 (thay bằng KD-A1) và Q4 / Q8 (bổ sung bởi KD-B1 / KD-B2).
