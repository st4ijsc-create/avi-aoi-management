# SCADA R1b-2b-1 · An toàn, đúng đắn và nợ R1b-2a — Kế hoạch thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đóng phần an toàn / đúng đắn còn lại sau R1b-2a, TRƯỚC phần tính năng R1b-2b-2:
- người đang bị buộc đổi mật khẩu mà có quyền dừng VẪN tới được nút DỪNG MÁY trong giao diện (mục 59 — task ĐẦU TIÊN);
- năm mục thấp của kiem-dinh R1b-2a (G1–G5): ép bool chặt, chuỗi `BAD n` theo kiểu dữ liệu, STOP khi Redis sập có trần, `dungMay` trong batch có hạn, dọn `_test` không cần id viết tay;
- driver nói thật: MC phân biệt "PLC trả lỗi chậm" với "quá hạn gói" bằng mã lỗi của thư viện, phiên mà mọi tag sai cấu hình không báo `connected`, so đọc lại ở không gian thô, EIP / SLMP gắn đúng danh tính, tắt tiến trình không ghi `disabled`;
- STOP HMI không bị sổ chậm giữ lại, không trả giá import lạnh; phạm vi luật interlock kiểm dưới khoá; khai mức hàng loạt không giữ khoá chuỗi băm audit theo từng hàng;
- dọn nhánh client chết `tagForm.id`.

**Architecture:**
- **Không thêm đường ghi.** Mọi lệnh tới thiết bị vẫn qua `dispatch()` (`server/services/ot/commandDispatcher.ts`). STOP khớp ghim không bị phần mềm chặn ở bất kỳ task nào.
- **Một luật bool cho mọi bên.** Module thuần mới `server/services/ot/drivers/boolNghiem.ts` là chủ duy nhất của phép đọc bool: cổng kênh (`kenhScada.ts`), mọi driver ghi, so đọc lại và giải mã đọc đều gọi nó.
- **Mục 59 dùng lại cổng có sẵn.** Cổng client vẫn bọc CHÍNH `<Router/>` (không route nào lách được); khi khoá, trang đổi mật khẩu hiện thêm khối "DỪNG MÁY khẩn cấp" dựng từ `NutDungMay` có sẵn. Danh sách máy đến từ MỘT thủ tục đọc mới, tối thiểu, được thêm vào tập miễn cổng STOP.
- **Không đụng bốn tệp kiem-dinh đang hợp nhất** cho tới khi gộp main có bản hợp nhất (xem Global Constraints). G3, hạn lệnh Redis và G4 là hai task cuối trước nghiệm thu, Step 0 của chúng là gộp main.
- **Không migration.** Mọi việc dùng cột có sẵn. Dải số ở Global Constraints.

**Tech Stack:** TypeScript, tRPC 11, express-rate-limit 8, ioredis, drizzle + Postgres, React 19, vitest (+ jsdom cho `*.dom.test.tsx`, + DB `_test`), mcprotocol 0.1.2, nodes7, st-ethernet-ip, OpenPLC bench (chỉ khi điều phối cho phép).

**Spec (thứ tự ưu tiên khi mâu thuẫn):**
1. Báo cáo đã duyệt `docs/superpowers/specs/2026-10-23-scada-thiet-ke-he-sinh-thai.html`: D3, D5, D9, D10, D11, §4.5–4.6; bản phân tích `docs/superpowers/specs/2026-10-23-scada-phan-tich-chi-tiet.md` C.5.
2. Kế hoạch R1b-2a `docs/superpowers/plans/2026-10-25-scada-r1b-2a-an-toan-va-no-tiep.md`, mục "Danh sách R1b-2b" (1–41).
3. Báo cáo nghiệm thu R1b-2a `docs/superpowers/plans/2026-10-25-scada-r1b-2a-bao-cao-nghiem-thu.md`: §8 giới hạn, §9 checklist, §11 backlog (1–59).
4. Sổ R1b-2a `.superpowers/sdd/2026-10-25-scada-r1b-2a-an-toan-va-no-tiep/progress.md` (dòng 171–177: quyết định điều phối 2026-10-26, kết luận kiem-dinh G1–G5) và các báo cáo rà soát task (`task-4-review.md` M-6, `task-4-rereview.md` N-3 / N-4, `task-5-review.md` m-6, `task-6-review.md` m-1, `task-13-review.md` m4).
5. Báo cáo nghiệm thu R1b-1 `docs/superpowers/plans/2026-10-24-scada-r1b-1-bao-cao-nghiem-thu.md` §10 (mục 21–27 còn mở — xem danh sách R1b-2b-2).
6. Quyết định điều phối 2026-10-26 (mục "ĐÃ DUYỆT" dưới đây).

**Phụ thuộc:**
- Nhánh `feat/scada-r1b2b` tạo từ main `18fb90674` (đã có R1b-2a + oracle giới hạn STOP của kiem-dinh `3d644a681`). Số dòng trong kế hoạch này là của `18fb90674`.
- **kiem-dinh đang hợp nhất trên main** hai bộ giới hạn (tầng STOP + W21) và 4 bộ đọc cookie (`vePhienCookie.docVePhienTuCookie`, `rateLimitConfig.apiKeyGeneratorXacThuc`, `context.extractSessionToken`, phần đọc của `sdk`). Task 14 và 15 chỉ bắt đầu sau khi bản đó vào main; Step 0 của Task 14 gộp main.
- R1b-2b-2 viết kế hoạch riêng sau khi R1b-2b-1 được duyệt.

---

## Tách R1b-2b — quyết định (ĐÃ DUYỆT 2026-10-26)

| Phần | Nội dung | Cổng |
|---|---|---|
| **R1b-2b-1 · An toàn + đúng đắn + nợ** (kế hoạch này, 16 task) | Mục 59 (đầu tiên); G1–G5; driver: MC errCode (58), phiên sai cấu hình toàn bộ (51), đọc lại thô (42), EIP `'error'` + `timeout_sp` (11), danh tính callback SLMP (12), tắt sạch không ghi `disabled` (13); STOP HMI: sổ có hạn (44), import lạnh (46), hạn lệnh Redis (45); interlock phạm vi dưới khoá (47); audit theo lô (48); nhánh chết `tagForm.id` (49). | Ma trận ô opt-in xanh 3 lượt; mỗi sửa có đột biến đỏ. |
| **R1b-2b-2 · Nhật ký + UI + tính năng driver** (kế hoạch riêng) | Xem mục cuối "Danh sách R1b-2b-2". | Danh sách 1-1, mỗi mục có test hoặc số đo. |

Giữ cách tách của điều phối. Ba mục driver 11 / 12 / 13 nằm ở R1b-2b-1 vì chúng là lỗi đúng đắn (một sự kiện `'error'` lúc đang kết nối làm sập tiến trình; một callback ghi muộn làm hỏng giao dịch kế; tắt tiến trình ghi đè trạng thái thật), không phải tính năng. Phần "tính năng driver" (C6 đọc khối, đo OPC UA, năm mục dư T3 / T4) ở R1b-2b-2.

## ĐÃ DUYỆT — điều phối 2026-10-26 (ràng buộc thêm, có hiệu lực như Global Constraints)

- **Mục 59 là task ĐẦU TIÊN.** Trang buộc đổi mật khẩu không được che HMI / nút DỪNG với người có quyền dừng, hoặc trang ấy tự hiện nút DỪNG khẩn cấp. Máy chủ đã miễn RIÊNG `scadaCommands.dungMay` khỏi cổng (R1b-2a final-fix).
- **G1–G5 (kiem-dinh R1b-2a, mức thấp):** G1 ép bool chặt; G2 ghi rõ hoặc phân biệt theo kiểu dữ liệu; G3 quyết một trần dự phòng trong bộ nhớ; G4 từ chối hoặc bọc hạn `dungMay` trong batch; G5 id dọn `_test` tìm được bằng truy vấn chạy khô, hoặc ghi rõ.
- **Mục đã quyết khác:** MC phân biệt bằng mã lỗi thư viện nếu được (58); so đọc lại ở đơn vị thô; hạn lệnh Redis cho bộ giới hạn STOP; ghi sổ từ chối / sau gửi có hạn; import động lạnh; khoá chuỗi băm audit theo lô (chèn nhiều hàng + `UPDATE … FROM VALUES` + test toàn vẹn chuỗi); đọc phạm vi adapter đích của luật interlock dưới khoá; nhánh client chết `tagForm.id` (hoặc form sửa thật); phiên mà mọi tag cấu hình sai vẫn tính là `connected`.
- **Migration:** dải R1b-2b **XÁC NHẬN 0437–0439**. 0435–0436 cũng là của SCADA và dùng được khi cần, nhưng phải báo bộ điều khiển trước. SQL gửi điều phối trước khi áp DEV.
- **Tách R1b-2b-1 / R1b-2b-2: DUYỆT**, mục 59 đầu tiên.
- **Hợp nhất limiter / bộ đọc cookie: GỠ khỏi kế hoạch này** — kiem-dinh làm trên main. Ràng buộc kèm theo ở Global Constraints.
- **Gửi kế hoạch cho điều phối TRƯỚC khi thực thi.** Câu trả lời cho Q1–Q12 (cuối tệp) sẽ ghi bổ sung vào mục này.

### Kế hoạch e703d844a — DUYỆT có 6 điều kiện bắt buộc (điều phối 2026-10-26). Thực thi từ T1, không chờ duyệt lại.

**Trả lời Q1–Q12:**
- **Q1 DUYỆT:** `mayDungKhanCap` là phần tử thứ hai của tập miễn. Điều kiện: test chiều B ghim ĐÚNG 2 phần tử; JSON trả về không có endpoint / lastError / stopValue / giá trị ghim.
- **Q2 CÓ:** tìm thấy hàng ⇒ DỪNG. Gửi điều phối SQL chỉ đọc; điều phối chạy trên DEV (read_only).
- **Q3 DUYỆT**, kèm điều kiện (1).
- **Q4 CHẤP NHẬN**, ghi vào báo cáo §giới hạn.
- **Q5 DUYỆT**, kèm điều kiện (5).
- **Q6 DUYỆT.** Ghi vào "thay đổi hành vi nhìn thấy được": trong cửa sổ từ lúc tắt tới lúc khởi động lại, DB vẫn để `connected`.
- **Q7 DUYỆT**, kèm điều kiện (3).
- **Q8 DUYỆT.**
- **Q9:** trần THEO TIẾN TRÌNH DUYỆT. `commandTimeout` 250 ms dùng chung KHÔNG duyệt như đang viết; xem điều kiện (4).
- **Q10 BỌC HẠN: DUYỆT.**
- **Q11 CÓ**, nhưng hỏi điều phối ngay lúc chạy (commit trống ≥ 10 GB, không chạm :3000 / :8091 / GPU). Với M1, ghi rõ là giới hạn.
- **Q12:** lọc theo CÙNG luật `phanLoaiGhimStopHmi` (một luật STOP cho mọi nguồn), sau khi đã dọn ghim cũ. Để ở R1b-2b-2.

**Điều kiện bắt buộc:**
1. **T2 / Q3 — STOP không được bị driver chặn.** Coil chặt sẽ từ chối giá trị 2. Vì vậy ghim STOP trên tag địa chỉ COIL kiểu int / float có `stop_value ∉ {0, 1, true, false, "0", "1", "true", "false"}` sẽ THẤT BẠI ở driver, tức là một cổng phần mềm đứng trước STOP. Cần:
   - (a) Census Step 1 phủ thêm: ghim STOP trên MỌI tag địa chỉ coil (mọi dataType), và FOE / luật ghi lên coil có giá trị ngoài tập. Có hàng ⇒ dừng như Q2.
   - (b) `validateStopValue` và đường tạo / sửa ghim từ chối ghim như vậy trên coil, để từ nay không sinh hàng mới. Có test và đột biến.
   - (c) Thêm vào ô B1: ghim STOP `1` trên coil kiểu int ⇒ ghi TRUE, acked.
2. **T9 — ca L1 khoá bảng.** Ca `LOCK TABLE scada_command_attempts, ai_pending_actions IN EXCLUSIVE MODE` 5 s trên `_test` dùng chung sẽ làm treo các tệp DB khác chạy song song. Phải chọn một và ghi rõ đã chọn cách nào:
   - đưa tệp soCoHan vào lô serial (thêm vào `vitest.serial.config.ts`, loại khỏi `vitest.db.config.ts`);
   - hoặc để opt-in.
3. **T9 / Q7 — promise sổ bị bỏ rơi.** Promise sổ bị bỏ rơi sau 500 ms mà reject muộn KHÔNG được thành `unhandledRejection` (mặc định Node làm sập tiến trình).
   - Test: p reject ở 800 ms ⇒ 0 `unhandledRejection` (đo bằng `process.on`), có `ghiLoiChot`.
   - Đột biến: bỏ handler gắn lên p ⇒ đỏ.
4. **T14 / Q9 — hạn Redis.** Hạn 250 ms trên client dùng chung sẽ biến một Redis chậm-mà-sống thành fail-open cho bộ giới hạn đăng nhập / OTP. Hôm nay các bộ này chậm nhưng vẫn chặn, nên đây là hồi quy bảo mật. Chọn một trong hai:
   - (a) client Redis RIÊNG cho tầng STOP với `commandTimeout` 250; các tầng khác giữ nguyên;
   - (b) giữ hạn dùng chung, NHƯNG mọi bộ giới hạn trên client ấy đều dùng `StoreDuPhongBoNho` (rơi xuống bộ nhớ, không fail-open).

   Điều phối nghiêng về (b) nếu helper hợp nhất của kiem-dinh cho phép gắn store ở một chỗ; nếu không thì (a). Dù chọn cách nào cũng thêm test: Redis giả chờ 2 s ⇒ limiter đăng nhập vẫn đếm (429 đúng lượt).
5. **T5 / Q5 — `connecting` có lý do.** `connecting` mãi mà không có lý do sẽ thành vòng xoay vô tận trên UI. Khi mọi tag trung tính, đặt `lastError` / lý do phiên dạng mã (vd `moi_tag_sai_cau_hinh`, có i18n). Thêm test.
6. **T1 — danh sách máy bị cắt.** Khi số máy = `TRAN_MAY_DUNG_KHAN_CAP` (200), client hiện một dòng "danh sách có thể chưa đủ — dùng E-STOP cứng". Server có thể trả LIMIT 201 để biết là bị cắt. Có ca DOM.

**Ghi chú:**
- Hợp nhất cookie của kiem-dinh (e0e4caefc) và W22 (ecee38524) đang chạy cổng gộp main. Lệnh đóng băng 4 tệp + `context.ts` CHỈ hết khi điều phối báo đã lên `fresh/main`; lúc đó T14–T15 mới chạy Step 0.
- Không migration. Cần schema thì dùng 0437–0439, gửi SQL trước khi áp DEV.
- Trước khi gửi bàn giao: chạy ĐỦ census (grep -i census toàn cây + server/_core + routers/services/routes + client/src + shared), không chỉ test của task.

**T1 — M4 rà soát (điều phối 2026-10-26): chọn (b), kèm ràng buộc.**
1. Thêm trường `tongHop: "du" | "mot_phan" | "khong_toi" | "khong_ro"` cho mỗi máy. Dùng `"khong_ro"` khi khảo sát quá hạn hoặc không kiểm được; không bao giờ suy ra `"du"`.
2. Tính `tongHop` từ CHÍNH kết quả `khaoSatKhaNangDungNhieu` mà `khaNangDung` đang dùng, theo cùng luật phân loại với HMI (edge-owned / mất kết nối / sim). Không tạo đường khảo sát thứ hai. Adapter sim tính là KHÔNG tới thiết bị thật.
3. `tongHop` chỉ là gợi ý: KHÔNG BAO GIỜ ẩn hay vô hiệu nút DỪNG. Với `khong_toi`, `mot_phan` hay `khong_ro`, nút vẫn bấm được, kèm một dòng i18n (vi/en/zh) dạng "Có thể không tới mọi thiết bị — dùng thêm E-STOP cứng".
4. Vẫn đúng C16: không mã adapter, tagKey, endpoint, giá trị ghim hay lastError. Test:
   - JSON không có các khoá ấy;
   - một ca DOM cho mỗi giá trị `tongHop`, nút vẫn bấm được;
   - đột biến "khong_toi ⇒ disabled" phải đỏ.

## Global Constraints

- **Nơi làm và nhánh.**
  - Làm trong worktree `D:\SOURCES\_scada_r1a_wt`, nhánh `feat/scada-r1b2b`.
  - **Không** sửa cây chính `D:\SOURCES\avi-aoi-management`, worktree khác, hay nhánh khác.
  - **Không push.** Chỉ gộp main ở điểm dừng giữa hai task (bắt buộc ở Step 0 Task 14).
- **Commit.** Commit bằng pathspec: `git add <tệp…>` rồi `git commit -m "…" -- <tệp…>` (hook BG-124 chặn commit trần). Cuối message có một dòng trống rồi `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Không heredoc, không `node -e` có backtick.
- **`AI_OT_CONTROL_ENABLED`.**
  - Cờ GIỮ TẮT. KHÔNG task nào bật nó, kể cả trong cấu hình, giá trị mặc định, tài liệu, script hay `.env.example`.
  - Chỉ đặt trong tiến trình test / bench, luôn `"false"` ở lưới nghiệm thu và bench (như `r1b2aNghiemThu.db.test.ts`, `scripts/scada-r1b-bench.ts`).
  - Báo cáo nghiệm thu không được viết câu nào ngụ ý "đã sẵn sàng bật".
- **Không nạp gì xuống thiết bị.** Không tải chương trình PLC, không firmware. Bench chỉ đọc / ghi thanh ghi `holding` / `coil` như R1b-2a.
- **Bốn tệp ĐÓNG BĂNG trong lúc kiem-dinh hợp nhất (điều phối 2026-10-26).**
  - KHÔNG sửa `server/_core/rateLimitConfig.ts`, `server/_core/trpcGioiHanThuTuc.ts`, `server/_core/vePhienCookie.ts`, `server/_core/sdk.ts` ở Task 1–13.
  - Gộp main SAU KHI kiem-dinh đưa bản hợp nhất vào main (Step 0 Task 14), rồi chạy lại mọi census.
  - Mọi mục cần bốn tệp này (G3 trần dự phòng, hạn lệnh Redis của bộ giới hạn STOP, G4 batch `dungMay`) nằm ở Task 14–15 và XÂY TRÊN helper hợp nhất (tên đọc từ main sau gộp, không đoán trước).
  - `server/_core/context.ts` chứa một trong bốn bộ đọc cookie ⇒ cũng chỉ sửa ở Task 15 (sau gộp).
- **Migration — dải 0437–0439 (đã xác nhận).**
  - Kế hoạch này **không cần migration**. 0435–0436 dùng được nếu cần, nhưng báo bộ điều khiển trước. 0423–0429 thuộc phiên khác: **không bao giờ dùng**.
  - Nếu một task phát hiện cần schema: viết tay theo khuôn `scripts/apply-migration-0433.mjs`, idempotent (`IF NOT EXISTS` / `duplicate_object`). DDL bằng owner `aoi`, verify bằng `avi_app`, có `has_table_privilege`.
  - Áp TEST (`--test-only`) thoải mái. Gửi SQL cho điều phối TRƯỚC khi áp DEV; DEV chỉ sau khi điều phối trả lời "áp".
  - Không sửa `drizzle/meta/_journal.json`.
- **Cờ và hằng.** Không cờ mới, không biến môi trường mới. Trần / hạn mới là hằng có tên trong mã. **Không sửa `.env`.**
- **Đường ghi.** Mọi lệnh tới thiết bị qua `dispatch()`. Mọi từ chối trong dispatch qua `writeRejected`. STOP khớp ghim KHÔNG BAO GIỜ bị phần mềm chặn ở cổng chế độ / khoá chọn / dải / bước / lưới / kiểu.
- **Danh tính.** Không bao giờ lấy danh tính từ input. Người gọi luôn là `ctx.user`.
- **Phạm vi.** Thủ tục nhận `adapterId` / `machineId` / `tagId` kiểm phạm vi máy (`idsTrongPhamVi("machine", phamViCua(ctx), {strict:true})` / `server/routers/_adapterPhamVi.ts`). Thủ tục có giao dịch kiểm LẠI dưới khoá adapter (`kiemPhamViDuoiKhoa`). "Không thấy" và "ngoài phạm vi" trả CÙNG một lỗi.
- **Thứ tự khoá dự án:** ADAPTER (FOR SHARE / UPDATE, theo id tăng) → LUẬT (FOR SHARE / UPDATE, theo id) → TAG (FOR UPDATE, ORDER BY id) → KÊNH CHẾ ĐỘ (`troLaiKenh.ts`). Không đường mới nào khoá ngược. Khoá tư vấn chuỗi audit (`AUDIT_CHAIN_LOCK`) luôn lấy SAU mọi khoá hàng.
- **Census.** Thủ tục tRPC mới:
  - nâng GHIM (đo, không đoán) ở `server/routers/phamViDocCensus.test.ts` / `server/routers/congGiayPhepAiCensus.test.ts` / `server/routers/phamViGhiCensus.test.ts`, kèm ghi chú có ngày;
  - KHÔNG thêm vào `trpcGioiHanThuTuc.ts` (đóng băng; thủ tục đọc không TOTP không cần nhóm);
  - `server/_core/moduleAccessMap.ts` (tiền tố `scadaCommands` đã có ⇒ không đổi).
- **Mã lỗi và i18n.** Mọi mã / câu từ chối mới:
  - vào `server/_core/appErrorCodes.ts`;
  - có khoá ở `client/src/i18n/locales/{vi,en,zh}.json`, placeholder khớp params (`appErrorCoverage` / `appErrorParamsCoverage` xanh);
  - `npm run i18n:check` sạch.
  - Kế hoạch này dùng lại mã có sẵn (`SCADA_VALUE_TYPE_MISMATCH`, `OPERATION_FAILED` + `reason scadaKenhThuLai`); khoá i18n mới chỉ ở Task 1 (`scada.dungMay.khanCap.*`).
- **Test.**
  - Không DB: `npx vitest run <tệp>`. DB: `npx vitest run -c vitest.db.config.ts <tệp>`. DOM: `*.dom.test.tsx` với docblock `// @vitest-environment jsdom`.
  - Người dùng test tạo bằng `taoNguoiDungTest`. Mock module dùng `importOriginal`.
  - Test thời gian thật phải < 10 s, nếu không thì đồng hồ giả hoặc cờ opt-in.
- **Mỗi task.** Test đỏ đúng chỗ → mã → xanh → **đột biến ghi trong task làm đỏ ≥ 1 test** (chạy, ghi vào commit, hoàn tác, `git diff` rỗng) → commit.
- **Đo DEV.** Người thực thi chỉ chạy trên `_test`. Truy vấn chỉ đọc trên DEV do bộ điều khiển chạy (`SET default_transaction_read_only = on`).
- **Tệp và màu.** Không xoá tệp. Không đổi tên công khai đang có người gọi. Màu chỉ dùng token ISA / token sẵn có. Nút / băng DỪNG dùng token `--packml-abort` (không phải màu cảnh báo).

## Review Focus

1. **Người vận hành có quyền dừng, đang bị buộc đổi mật khẩu, đứng ở trang đổi mật khẩu** ⇒ thấy khối "DỪNG MÁY khẩn cấp" liệt kê máy trong phạm vi, bấm ⇒ STOP đi (`acked_verified`) + đúng một audit `scada_hmi_stop_buoc_doi_mat_khau`. Người `viewer` cùng trạng thái ⇒ không có khối. Người bị buộc đổi gọi `scadaKenh.cheDo.danhSach` ⇒ vẫn `MUST_CHANGE_PASSWORD`. Test ở Task 1.
2. **AI / interlock / FOE gửi `"false"`, `"0"`, `" FALSE "`, `"off"`, `"no"`, `2`, `{}` lên tag bool CHƯA khai trên coil Modbus** ⇒ ba giá trị đầu ghi FALSE (không bao giờ TRUE), bốn giá trị sau `rejected TYPE_MISMATCH`, thiết bị 0 lần. Test ở Task 2.
3. **Tag string của PLC S7 / MC có giá trị thật là `"BAD 12"`** khi thư viện báo mọi item OK ⇒ mẫu tốt `"BAD 12"`, phiên không bị coi mất liên lạc kể cả khi đó là tag duy nhất. Cùng chuỗi khi thư viện báo có item lỗi ⇒ mẫu xấu. Test ở Task 3.
4. **PLC Mitsubishi trả lời lỗi cho cả khối sau 4,3 s** (PLC quá tải, ≥ 90 % hạn gói) ⇒ `device_error`, phiên giữ, STOP ghim ghi được. Quá hạn gói thật (`"Timeout error - zero length packet"`) ⇒ mất liên lạc như cũ. Test ở Task 4.
5. **Ghi tag int scale 0,1 giá trị 2,3 mà đọc lại 2,4; scale 0,5 ghi 2,5 mà đọc lại 3,0** ⇒ `acked_unverified` (trước: `acked_verified` vì làm tròn ở đơn vị kỹ thuật). Test ở Task 6.

---

### Task 1: STOP tới được từ trang buộc đổi mật khẩu (mục 59)

**Quyết định (một đoạn):** chọn phương án **khối DỪNG khẩn cấp trên chính trang đổi mật khẩu**, không mở lại trang HMI. Lý do:
- trang HMI cần ~10 thủ tục đọc (kênh, tag, chế độ, socket…); mở nó cho người bị buộc đổi là miễn cổng cho cả nhóm ấy, đúng lớp lỗi "liệt kê thì có phần tử thứ N+1" mà cổng được dựng để tránh;
- cổng client giữ nguyên bảo đảm theo cấu tạo: khi khoá, `children` (toàn bộ bảng route) vẫn không render;
- khối khẩn cấp chỉ cần MỘT thủ tục đọc tối thiểu (máy trong phạm vi mà người gọi được dừng), dùng lại `NutDungMay` / `HopDungMay` có sẵn (cùng hộp xác nhận một bước, cùng băng đỏ "DÙNG E-STOP CỨNG").
- Cái giá: tập miễn cổng STOP có HAI phần tử (`dungMay` + thủ tục đọc mới). Cần điều phối xác nhận (Q1).

**Files:**
- Create:
  - `server/services/scada/mayDungKhanCap.ts`;
  - `client/src/components/scada/KhoiDungKhanCap.tsx`.
- Modify:
  - `server/routers/scadaCommandsRouter.ts` (thủ tục mới `mayDungKhanCap` trên `thuTucLenh` :34, cạnh `dungMay` :174);
  - `server/_core/trpc.ts` `THU_TUC_STOP_MIEN_CONG_DOI_MAT_KHAU` :169 (+ chú thích có ngày);
  - `server/services/scada/khaNangDung.ts` (nhận `soCoGhim` / `coGhim` chuyển từ `server/routers/scadaKenhRouter.ts:72-80`, export; router import lại);
  - `client/src/components/CongDoiMatKhau.tsx` (nhánh khoá :102-124);
  - `client/src/i18n/locales/{vi,en,zh}.json` (`scada.dungMay.khanCap.tieuDe`, `.moTa`, `.loiTai`);
  - census: `server/routers/phamViDocCensus.test.ts`, `server/routers/congGiayPhepAiCensus.test.ts` (đo lại ghim).
- Test:
  - `server/_core/buocDoiMatKhau.test.ts` §2b;
  - mới `server/routers/scadaCommandsRouter.mayDungKhanCap.r1b2b.db.test.ts`;
  - `client/src/lib/congDoiMatKhau.unit.test.ts` §3 / §4;
  - mới `client/src/components/CongDoiMatKhau.dungKhanCap.dom.test.tsx`.

**Interfaces:**
- Consumes: `kiemCongVaiTro(nguoi, 1)`, `lenhHmiBat()`, `NguoiGoiLenh` (`lenhHmi.ts`); `khaoSatKhaNangDungNhieu(db, ids)` (`khaNangDung.ts:124`); `idsTrongPhamVi("machine", pv, {strict:true})`; `withDeadline` (`server/services/ot/drivers/boundedClose.ts`); `NutDungMay`, `KhaNangDung` (`client/src/components/scada/DungMay.tsx`).
- Produces:
  - `export const HAN_DANH_SACH_DUNG_KHAN_CAP_MS = 3000`; `export const TRAN_MAY_DUNG_KHAN_CAP = 200`.
  - `export type MayDungKhanCap = { machineId: number; code: string; ten: string; soAdapterGhimStop: number | null; coGhimStop: boolean | null; khaNangDung: KhaNangDungMay }`.
  - `export async function mayDungKhanCap(nguoi: NguoiGoiLenh, pv: PhamViNguoiXem): Promise<MayDungKhanCap[]>`.
  - tRPC `scadaCommands.mayDungKhanCap` (query, không input) → `MayDungKhanCap[]`.
  - `export function soCoGhim(k: KhaNangDungMay | undefined): number | null`, `export function coGhim(k: KhaNangDungMay | undefined): boolean | null` (`khaNangDung.ts`, thân giữ nguyên).
  - `THU_TUC_STOP_MIEN_CONG_DOI_MAT_KHAU = ["scadaCommands.dungMay", "scadaCommands.mayDungKhanCap"]`.
  - `export function KhoiDungKhanCap(): JSX.Element | null` (`data-testid="khoi-dung-khan-cap"`).

Chốt:
- **Máy chủ `mayDungKhanCap`:**
  - `lenhHmiBat()` false ⇒ `[]`;
  - `kiemCongVaiTro(nguoi, 1)` không ok (sàn vai mức 1, `machine_control.canEdit`) ⇒ `[]` (không ném: người không có quyền dừng chỉ không thấy khối);
  - máy trong phạm vi có ≥ 1 adapter (cùng vị từ `coNoi` của `cheDo.danhSach`, `scadaKenhRouter.ts:211-214`), `ORDER BY code`, `LIMIT TRAN_MAY_DUNG_KHAN_CAP`;
  - `khaNangDung` / `soAdapterGhimStop` / `coGhimStop` như `cheDo.danhSach` (cùng hàm, không chép);
  - cả thân bọc `withDeadline(…, HAN_DANH_SACH_DUNG_KHAN_CAP_MS, …, { unref: true })`; quá hạn ⇒ ném lỗi (client hiện `loiTai`).
  - Không lộ endpoint, kênh, giá trị ghim, `lastError`.
- **Cổng:** tập miễn STOP thêm `scadaCommands.mayDungKhanCap`. Cổng VẪN đọc cờ; có cờ ⇒ `next({ ctx: { stopKhiBuocDoiMatKhau: true } })` như `dungMay`. Mọi thủ tục khác vẫn `MUST_CHANGE_PASSWORD`.
- **Client:**
  - nhánh khoá của `CongDoiMatKhau` render `<KhoiDungKhanCap />` NGAY DƯỚI băng cảnh báo, TRÊN `<ChangePassword />`; nhánh không khoá không render nó;
  - `KhoiDungKhanCap` gọi `trpc.scadaCommands.mayDungKhanCap.useQuery(undefined, { retry: false })`:
    - đang tải ⇒ không hiện gì;
    - lỗi ⇒ một dòng chữ đỏ token DỪNG `scada.dungMay.khanCap.loiTai` ("Không tải được danh sách máy — dùng E-STOP cứng tại máy");
    - `[]` ⇒ `null`;
    - có máy ⇒ tiêu đề `scada.dungMay.khanCap.tieuDe` ("DỪNG MÁY khẩn cấp"), câu `scada.dungMay.khanCap.moTa` ("Bạn vẫn dừng được máy trong khi chưa đổi mật khẩu."), mỗi máy một `NutDungMay` với `machineId`, `tenMay = "${code} · ${ten}"`, `soAdapter`, `coGhimStop`, `khaNang`.
  - Không thêm nút / đường điều hướng nào khác.

- [ ] **Step 1: Test đỏ.**

```ts
// buocDoiMatKhau.test.ts §2b — chiều B (sửa ca cũ, ghi ngày 2026-10-26)
it("★★★ chiều B — tập TỐI THIỂU: dungMay + mayDungKhanCap (mục 59)", () => {
  expect([...THU_TUC_STOP_MIEN_CONG_DOI_MAT_KHAU]).toEqual(["scadaCommands.dungMay", "scadaCommands.mayDungKhanCap"]);
  for (const d of ["scadaCommands.request", "scadaCommands.confirm", "scadaCommands.huy", "scadaCommands.trangThai", "scadaKenh.cheDo.danhSach"])
    expect(THU_TUC_STOP_MIEN_CONG_DOI_MAT_KHAU.includes(d)).toBe(false);
});
it("★★ cổng VẪN đứng đầu chuỗi của mayDungKhanCap", () => {
  expect(chuoiCua("scadaCommands.mayDungKhanCap")[0]).toBe(HAM_CONG);
});
```

  - `scadaCommandsRouter.mayDungKhanCap.r1b2b.db.test.ts` (khuôn cờ buộc đổi của `scadaCommandsRouter.dungMay.hanTruocGui.r1b2.db.test.ts` :729-733; `OT_CONTROL_ENABLED` / `SCADA_COMMANDS_ENABLED` chỉ trong tiến trình; hai nhà máy A / B):
    - operator nhà máy A có `machine_control.canEdit`, cờ buộc đổi BẬT ⇒ `mayDungKhanCap` trả đúng máy của A (có `khaNangDung`), không có máy của B; không khoá `endpoint` / `lastError` / `stopValue` trong JSON;
    - cùng người ⇒ `dungMay` máy A `acked_verified` + đúng 1 audit `scada_hmi_stop_buoc_doi_mat_khau` (hồi quy);
    - cùng người ⇒ `scadaKenh.cheDo.danhSach` ⇒ `FORBIDDEN / MUST_CHANGE_PASSWORD` (Review Focus 1);
    - `viewer` cờ bật ⇒ `[]`; operator thiếu `canEdit` ⇒ `[]`;
    - `SCADA_COMMANDS_ENABLED` tắt ⇒ `[]`;
    - người không cờ ⇒ cùng danh sách (đối chứng).
  - `congDoiMatKhau.unit.test.ts` (tệp `.ts`, không JSX): thêm `vi.mock("@/components/scada/KhoiDungKhanCap", () => ({ KhoiDungKhanCap: () => React.createElement("div", { "data-testid": "khoi-dung-khan-cap" }) }))`; §4 "CÓ CỜ" ⇒ html chứa `khoi-dung-khan-cap`; "ĐỐI CHỨNG DƯƠNG" và "admin có cờ" ⇒ không chứa. §3 giữ nguyên (cổng vẫn bọc `<Router/>`).
  - `CongDoiMatKhau.dungKhanCap.dom.test.tsx` (mock `@/lib/trpc` theo khuôn `DungMay.dom.test.tsx`, bundle vi thật):
    - user `{role:"operator", mustChangePassword:true}`, query trả 2 máy ⇒ thấy tiêu đề + 2 `nut-dung-may`; bấm nút máy 1 ⇒ hộp; Enter ⇒ đúng một `{proc:"dungMay", vars:{machineId:<máy 1>, clientRequestId:<uuid>}}`;
    - query trả `[]` ⇒ không có `khoi-dung-khan-cap`;
    - query lỗi ⇒ dòng `loiTai`;
    - lỗi `SCADA_STOP_PRECHECK_TIMEOUT` từ `dungMay` ⇒ băng E-STOP cứng hiện (hồi quy dùng lại `HopDungMay`);
    - user không cờ ⇒ không gọi `mayDungKhanCap`.
- [ ] **Step 2: Chạy.** Mong đợi: đỏ ở các ca mới.
- [ ] **Step 3: Cài server + cổng + client + i18n + census (GHIM đo, ghi chú có ngày).**
- [ ] **Step 4: Chạy lại** các tệp trên + `server/_core/buocDoiMatKhau*` + `server/routers/scadaCommands*` + `server/routers/scadaKenh*` + `client/src/components/scada` + `client/src/lib/congDoiMatKhau*` + mọi `*census*` + `npm run i18n:check`. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:**
  - gỡ `mayDungKhanCap` khỏi tập miễn ⇒ ca DB "operator cờ bật thấy máy" đỏ;
  - `mayDungKhanCap` bỏ kiểm `kiemCongVaiTro` ⇒ ca `viewer` đỏ;
  - `CongDoiMatKhau` bỏ `<KhoiDungKhanCap />` ⇒ ca §4 "CÓ CỜ" + ca DOM 2 nút đỏ;
  - render khối cả ở nhánh không khoá ⇒ ca "ĐỐI CHỨNG DƯƠNG" đỏ.
  - Hoàn tác tất cả.
- [ ] **Step 6: Commit** `feat(scada): nguoi bi buoc doi mat khau van dung may duoc tu trang doi mat khau - khoi DUNG khan cap + thu tuc doc toi thieu mayDungKhanCap (R1b-2b-1 T1, muc 59)`.

### Task 2: Một luật bool cho mọi bên (G1)

**Files:**
- Create: `server/services/ot/drivers/boolNghiem.ts`.
- Modify:
  - `server/services/scada/kenhScada.ts`: `epBool` :72 gọi `boolTuGiaTri`; `canKiemGiaTriChuaKhai` :229 thêm `"bool"`; `kiemLuoiThoChuaKhai` :277 nhánh bool;
  - driver ghi: `server/services/ot/drivers/modbusDriver.ts` `writeOne` :313 (coil); `modbusDecode.ts` `encodeModbus` :209; `s7Driver.ts` `coerceS7Write` :53; `mitsubishiMcDriver.ts` `coerceMcWrite` :89; `ethernetIpDriver.ts` `coerceEipWrite` :46; `opcuaDriver.ts` `coerce` :934; `slmpDriver.ts` ghi bit :406;
  - giải mã đọc: `s7Address.ts` :106, `mcAddress.ts` :139, `eipTag.ts` :68, `opcuaAddress.ts` :204;
  - `server/services/ot/drivers/readbackCompare.ts` nhánh bool :40;
  - `server/services/scada/lenhInterlockLechLuoi.ts`: `dieuKienUngVienLenhLechLuoi` :35 thêm `"bool"`; hằng mới `TRUY_VAN_TRUOC_TRIEN_KHAI_BOOL` (KHÔNG sửa `TRUY_VAN_TRUOC_TRIEN_KHAI` — hai báo cáo cũ ghim nó từng byte);
  - mới `docs/superpowers/plans/2026-10-26-scada-r1b-2b-1-bao-cao-nghiem-thu.md` (khung, chỉ §4 mục 2b: khối SQL bool nguyên văn; Task 16 điền phần còn lại).
- Test:
  - mới `server/services/ot/drivers/boolNghiem.test.ts`;
  - `server/services/scada/kenhScada.test.ts`;
  - `server/services/ot/drivers/chatLuong.drivers.test.ts` (ghi + đọc);
  - `server/services/ot/drivers/readbackCompare.test.ts`;
  - `server/services/ot/commandDispatcher.kenh.r1a.db.test.ts`;
  - `server/services/scada/lenhInterlockLechLuoi.r1b2.db.test.ts`, `lenhInterlockLechLuoi.baoCao.test.ts`.

**Interfaces:**
- Produces (`boolNghiem.ts`, thuần):
  - `export function boolTuGiaTri(v: unknown): boolean | undefined` — `boolean` ⇒ chính nó; `1` / `0` ⇒ true / false; chuỗi sau `trim().toLowerCase()` là `"1"` / `"true"` ⇒ true, `"0"` / `"false"` ⇒ false; mọi thứ khác (gồm `2`, `-1`, `NaN`, `"on"`, `"yes"`, `""`, mảng, đối tượng, null) ⇒ undefined.
  - `export function boolGhi(v: unknown): boolean` — `boolTuGiaTri(v)`; undefined ⇒ NÉM `Error(\`giá trị bool không hợp lệ: ${JSON.stringify(v)}\`)`.
  - `export function giaiMaBoolDoc(raw: unknown): boolean | undefined` — số hữu hạn ⇒ `raw !== 0` (quy ước thanh ghi: khác 0 là TRUE); `boolean` ⇒ chính nó; chuỗi ⇒ `boolTuGiaTri`; còn lại ⇒ undefined.
  - `export const TRUY_VAN_TRUOC_TRIEN_KHAI_BOOL: string` (`lenhInterlockLechLuoi.ts`).

Chốt:
- **Cổng kênh của `dispatch()` (pass 2, nên STOP khớp ghim không bị ảnh hưởng):** tag bool CHƯA khai, `boolTuGiaTri(v) === undefined` ⇒ `TYPE_MISMATCH` cùng câu với tag đã khai ("Giá trị bool phải là true/false, 1/0, \"1\"/\"0\" hoặc \"true\"/\"false\"."). `ok` vẫn trả giá trị NGUYÊN VẸN (không đổi băm `canonicalOtValue`).
- **Driver ghi:** mọi chỗ `Boolean(x)` trên đường GHI thay bằng `boolGhi(x)`. Lỗi ⇒ write đó `{ ok: false, error }` (không ném cả lô; dùng khối try của từng driver). Coil Modbus nhận `boolGhi(w.value)` bất kể `dataType`.
- **Giải mã đọc:** `Boolean(raw)` ⇒ `giaiMaBoolDoc(raw)`; undefined ⇒ `{ value: null, quality: "bad" }` (cờ V2: lý do qua `MAU_GIA_TRI_HONG` như nhánh NaN của int). `modbusDecode` đọc (`words[0]` là số) không đổi.
- **So đọc lại bool:** `boolTuGiaTri(expected)` và `giaiMaBoolDoc(actual)`; một bên undefined ⇒ false.
- **SQL trước triển khai cho bool** (hằng riêng, chỉ đọc): luật bật, `action <> 'alert'`, đích tag `bool`; `commandValue` NULL / jsonb null (⇒ true) hoặc boolean, hoặc số 0 / 1, hoặc chuỗi mà `lower(btrim(...)) IN ('0','1','true','false')` ⇒ hợp lệ; còn lại ⇒ hàng `ket_luan = 'KHONG_PARSE_DUOC'`. Cột ra: `id, name, "targetAdapterId", "tagKey", "commandValue", ket_luan`.
- `luatLenhLechLuoi` (JS, posture `interlockRulesCauHinhHong`) tự phủ bool qua `dieuKienUngVienLenhLechLuoi`.

- [ ] **Step 1: Census + đo TRƯỚC (cổng dừng).** Trên `_test` (chỉ đọc): luật bật không `alert` nhắm tag bool có `commandValue` ngoài tập hợp lệ; write FOE (`step.args.writes`) lên tag bool như vậy; tag bool có `stop_value` không phải boolean. Bộ điều khiển chạy cùng truy vấn trên DEV. **≥ 1 hàng ở bất kỳ DB nào ⇒ DỪNG, báo bộ điều khiển kèm bảng (Q2).**
- [ ] **Step 2: Test đỏ.**

```ts
// boolNghiem.test.ts
it("boolTuGiaTri chặt", () => {
  for (const [v, k] of [[true, true], [false, false], [1, true], [0, false], ["1", true], [" FALSE ", false], ["true", true]] as const) expect(boolTuGiaTri(v)).toBe(k);
  for (const v of [2, -1, NaN, "on", "off", "yes", "no", "", "  ", [1], {}, null, undefined]) expect(boolTuGiaTri(v)).toBeUndefined();
});
it("giaiMaBoolDoc: số khác 0 là TRUE; chuỗi lạ ⇒ undefined", () => {
  expect(giaiMaBoolDoc(2)).toBe(true);
  expect(giaiMaBoolDoc(0)).toBe(false);
  expect(giaiMaBoolDoc("false")).toBe(false);
  expect(giaiMaBoolDoc("BAD 255")).toBeUndefined();
});
it("boolGhi('off') ném, boolGhi('0') = false", () => {
  expect(() => boolGhi("off")).toThrow(/bool không hợp lệ/);
  expect(boolGhi("0")).toBe(false);
});
// kenhScada.test.ts — R1b-2b-1 T2
it("bool chưa khai: 'off' / 2 / {} ⇒ TYPE_MISMATCH; 'false' ⇒ ok nguyên vẹn", () => {
  const b = { dataType: "bool", scale: null, offset: null } as const;
  expect(canKiemGiaTriChuaKhai(b)).toBe(true);
  for (const v of ["off", "no", 2, {}, ""]) expect(kiemLuoiThoChuaKhai(b, v)).toMatchObject({ ok: false, ma: "TYPE_MISMATCH" });
  expect(kiemLuoiThoChuaKhai(b, "false")).toEqual({ ok: true, giaTri: "false" });
});
// readbackCompare.test.ts
it("bool: 'false' khớp false; 'off' không khớp gì", () => {
  expect(readbackMatches("false", false, "bool")).toBe(true);
  expect(readbackMatches("off", true, "bool")).toBe(false);
});
```

  - `chatLuong.drivers.test.ts`: Modbus coil `writeTags([{dataType:"bool", value:"false"}])` ⇒ client giả nhận `writeCoil(reg, false)`; `value:"off"` ⇒ `{ok:false}` và client 0 lần; S7 / MC / EIP / SLMP / OPC UA (fallback `coerce`) với `"0"` ⇒ thư viện giả nhận `false`, `"on"` ⇒ write đó `ok:false`; giải mã đọc S7 bool `"1"` ⇒ true, `"x"` ⇒ bad.
  - `commandDispatcher.kenh.r1a.db.test.ts` (Review Focus 2): tag bool chưa khai trên coil, stub ghi lại: `"false"`, `"0"`, `" FALSE "` ⇒ `ok`, driver nhận giá trị mà `boolGhi` ra FALSE; `"off"`, `"no"`, `2`, `{}` ⇒ `rejected TYPE_MISMATCH`, `appError SCADA_VALUE_TYPE_MISMATCH {dataType:"bool"}`, thiết bị 0 lần; STOP ghim `false` trên tag ấy ⇒ ok.
  - `lenhInterlockLechLuoi.r1b2.db.test.ts`: luật bật nhắm tag bool chưa khai với `"on"`, `2`, `{"v":1}`, `"false"`, `true`, `null` ⇒ `idsJsTuChoi ⊆ (idsSql ∪ idsSqlBool)`; tường minh `"on"` / `2` / `{"v":1}` có trong cả hai, ba giá trị sau không ai báo.
  - `lenhInterlockLechLuoi.baoCao.test.ts`: ca mới — khối SQL §4 mục 2b của báo cáo R1b-2b-1 bằng `TRUY_VAN_TRUOC_TRIEN_KHAI_BOOL` từng ký tự; hai ca cũ giữ nguyên.
- [ ] **Step 3: Chạy.** Mong đợi: đỏ.
- [ ] **Step 4: Cài** + khung báo cáo (§4 mục 2b). Sửa test ghim hành vi cũ (`Boolean("false") === true` trên đường ghi), ghi tên trong commit.
- [ ] **Step 5: Chạy lại** + `server/services/ot` + `server/services/scada` + `server/routers/interlock*` + `server/routers/oversight*`. Mong đợi: xanh.
- [ ] **Step 6: Đột biến:**
  - `boolTuGiaTri` nhận `"on"` ⇒ ca boolNghiem + ca dispatch đỏ;
  - Modbus coil quay về `Boolean(w.value)` ⇒ ca `"false"` đỏ;
  - `canKiemGiaTriChuaKhai` bỏ `"bool"` ⇒ ca `kenhScada` + ca dispatch `"off"` đỏ;
  - hằng SQL bool bỏ nhánh chuỗi ⇒ ca `"on"` của subset đỏ.
  - Hoàn tác tất cả.
- [ ] **Step 7: Commit** `fix(ot): mot luat bool cho cong kenh, moi driver ghi, giai ma doc va so doc lai - "false" khong bao gio thanh TRUE, gia tri la bi tu choi (R1b-2b-1 T2, kiem-dinh G1)`.

### Task 3: Chuỗi `BAD n` của thư viện phân biệt theo kiểu dữ liệu (G2)

**Files:**
- Modify:
  - `server/services/ot/chatLuong.ts` `laGiaTriBadThuVien` :153 (chữ ký giữ; thêm hàm mới cạnh);
  - `server/services/ot/drivers/s7Address.ts` `coerceS7Value` :100; `server/services/ot/drivers/mcAddress.ts` `coerceMcValue` :133;
  - `server/services/ot/drivers/s7Driver.ts` readAllItems :268-290 (truyền `anythingBad`; điều kiện "mọi item BAD" :284);
  - `server/services/ot/drivers/mitsubishiMcDriver.ts` readAllItems :414-460 (dùng `anythingBad`; điều kiện :433).
- Test: `server/services/ot/chatLuong.test.ts`, `server/services/ot/drivers/chatLuong.drivers.test.ts`.

**Interfaces:**
- Produces:
  - `export function laMauBadThuVien(raw: unknown, dataType: OtDataType, thuVienBaoLoi: boolean): boolean` (`chatLuong.ts`) ⇔ `laGiaTriBadThuVien(raw) && (thuVienBaoLoi || (dataType !== "string" && dataType !== "json"))`.
  - `coerceS7Value(raw: unknown, dataType: OtDataType, tuyChon?: { thuVienBaoLoi?: boolean }): CoercedS7Value` và `coerceMcValue(raw, dataType, tuyChon?)` — mặc định `thuVienBaoLoi: true` (fail-closed cho người gọi cũ).

Chốt:
- `anythingBad` của callback `readAllItems(cb(anythingBad, values))` là cờ của thư viện: false ⇔ không item nào bị thay giá trị bằng chuỗi chất lượng.
- **Tag string / json:** chuỗi khớp `^BAD \d{1,3}$` là giá trị THẬT khi `anythingBad === false`; là mẫu xấu khi `anythingBad === true` (fail-closed).
- **Tag bool / int / float:** chuỗi `BAD n` luôn là mẫu xấu (không bao giờ là giá trị hợp lệ của các kiểu này).
- **Điều kiện "mọi item BAD ⇒ xét mất liên lạc"** ở S7 / MC chỉ áp khi `anythingBad === true`; dùng `laMauBadThuVien(values[k], tag.dataType, anythingBad)`.
- **Giới hạn ghi rõ (vào báo cáo):** tag string có giá trị thật `"BAD n"` trong CÙNG lần đọc với một item lỗi khác ⇒ bị coi là xấu (Q4).

- [ ] **Step 1: Test đỏ.**

```ts
// chatLuong.test.ts — R1b-2b-1 T3
it("laMauBadThuVien theo kiểu dữ liệu + cờ thư viện", () => {
  expect(laMauBadThuVien("BAD 12", "string", false)).toBe(false);
  expect(laMauBadThuVien("BAD 12", "string", true)).toBe(true);
  expect(laMauBadThuVien("BAD 12", "json", false)).toBe(false);
  expect(laMauBadThuVien("BAD 255", "bool", false)).toBe(true);
  expect(laMauBadThuVien("BAD PART", "string", true)).toBe(false);
});
```

  - `chatLuong.drivers.test.ts` (hình dạng trả về thật của nodes7 / mcprotocol như T13 R1b-2a; Review Focus 3):
    - S7 cờ V2 bật, một tag string duy nhất, `readAllItems` gọi lại `(false, { t: "BAD 12" })` ⇒ mẫu `good` `"BAD 12"`, tick là đọc tốt, phiên `connected`;
    - cùng giá trị với `(true, …)` ⇒ mẫu `bad`;
    - MC tương tự; MC hai tag string đều `"BAD 1"` với `anythingBad=false` sau 4,4 s ⇒ KHÔNG ném `McReadTimeoutError`;
    - tag bool `"BAD 255"` với `anythingBad=false` (thư viện giả bất thường) ⇒ vẫn `bad`.
- [ ] **Step 2: Chạy.** Mong đợi: đỏ.
- [ ] **Step 3: Cài.**
- [ ] **Step 4: Chạy lại** `server/services/ot` + census `server/services/ot/staleKhongVaoPhien.census.test.ts`. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:**
  - `laMauBadThuVien` bỏ vế `thuVienBaoLoi` ⇒ ca string `false` đỏ;
  - MC bỏ điều kiện `anythingBad` khỏi "mọi item BAD" ⇒ ca MC 4,4 s đỏ.
  - Hoàn tác cả hai.
- [ ] **Step 6: Commit** `fix(ot): chuoi "BAD n" cua thu vien chi la mau xau khi thu vien bao loi (tag string/json) - tag string that "BAD 12" khong lam roi phien (R1b-2b-1 T3, kiem-dinh G2)`.

### Task 4: MC — phân biệt "PLC trả lỗi" với "quá hạn gói" bằng mã lỗi của thư viện (mục 58)

**Files:**
- Modify: `server/services/ot/drivers/mitsubishiMcDriver.ts` (cạnh `laDocMcQuaHanGoi` :118; nhánh "mọi item BAD" :433-450).
- Test: `server/services/ot/drivers/chatLuong.drivers.test.ts`; mới `server/services/ot/drivers/mcErrCode.thuVienThat.test.ts`.

**Interfaces:**
- Produces:
  - `export const MC_ERRCODE_QUA_HAN_GOI = "Timeout error - zero length packet"` (chuỗi nguyên văn `mcprotocol.js` 0.1.2 :1263).
  - `export type LoaiLoiDocMc = "qua_han_goi" | "plc_tra_loi_loi" | "khong_ro"`.
  - `export function phanLoaiLoiDocMc(conn: unknown): LoaiLoiDocMc`.

Chốt:
- **Nguồn:** `conn.readPacketArray[*].itemList[*]` — `processMBPacket` (`mcprotocol.js` :1241) đặt `valid = false` + `errCode` cho item lỗi, `valid = true` cho item tốt; `errCode` KHÔNG được xoá khi thành công ⇒ chỉ xét item `valid === false` của lần đọc này.
  - không đọc được cấu trúc (thư viện khác bản, mảng rỗng, không item nào `valid === false`) ⇒ `"khong_ro"`;
  - MỌI item `valid === false` có `errCode === MC_ERRCODE_QUA_HAN_GOI` ⇒ `"qua_han_goi"`;
  - còn lại (≥ 1 item lỗi có `errCode` khác: "MC Error Response …", "Invalid Response Length …", "Invalid MC …", "Malformed …") ⇒ `"plc_tra_loi_loi"`: ít nhất một gói được PLC trả lời ⇒ PLC còn sống.
  - Đọc bằng truy cập phòng thủ (`Array.isArray`, `typeof`), không ném.
- **Luật mới khi cờ V2 bật và mọi item BAD (sau Task 3):**
  - `libRoi` (`isoConnectionState ≠ 4`) ⇒ mất liên lạc (như cũ);
  - `"qua_han_goi"` ⇒ mất liên lạc (`McReadTimeoutError`);
  - `"plc_tra_loi_loi"` ⇒ `device_error` từng item, phiên GIỮ, BẤT KỂ thời gian đọc;
  - `"khong_ro"` ⇒ luật thời gian cũ (`laDocMcQuaHanGoi`).
- Ghi chú đầu hàm nêu bản thư viện (0.1.2) và lý do không xoá luật thời gian (dự phòng khi cấu trúc nội bộ đổi).

- [ ] **Step 1: Thăm dò thư viện thật (cổng).** `mcErrCode.thuVienThat.test.ts`: dựng `mcprotocol` thật trỏ máy chủ TCP giả trong tiến trình (khung 1E nhị phân):
  - (a) máy chủ không trả lời ⇒ sau `globalTimeout` mọi `readPacketArray[*].itemList[*]` có `valid === false`, `errCode === MC_ERRCODE_QUA_HAN_GOI`;
  - (b) máy chủ trả khung `0x81 0x5B …` (end code lỗi) ⇒ `errCode` bắt đầu `"MC Error Response"`.
  - Đổi `globalTimeout` của instance xuống 300 ms để test < 10 s. **Cấu trúc khác với mô tả ⇒ DỪNG, báo bộ điều khiển kèm số đo.**
- [ ] **Step 2: Test đỏ** (`chatLuong.drivers.test.ts`, conn giả mang `readPacketArray` theo đúng hình đã thăm dò; Review Focus 4):
  - mọi item BAD, đọc 4300 ms, item `{valid:false, errCode:"MC Error Response - Second Byte is 91 …"}` ⇒ mẫu `bad / device_error`, KHÔNG ném, tick đọc tốt, sau đó `writeTags` ghim tới thư viện ok;
  - mọi item BAD, đọc 4600 ms, `errCode = MC_ERRCODE_QUA_HAN_GOI` ⇒ ném `McReadTimeoutError`;
  - hai gói: một quá hạn, một "MC Error Response" ⇒ `device_error` (PLC sống);
  - `readPacketArray` vắng ⇒ luật thời gian: 4600 ms ⇒ ném, 200 ms ⇒ `device_error`;
  - item `valid === true` mang `errCode` cũ quá hạn ⇒ bị bỏ qua.
- [ ] **Step 3: Chạy.** Mong đợi: đỏ ở ca 4300 ms và ca hai gói.
- [ ] **Step 4: Cài.**
- [ ] **Step 5: Chạy lại** `server/services/ot/drivers` + R0 / R1b-1 opt-in (`SCADA_R0_NGHIEM_THU=1`, `SCADA_R1B_NGHIEM_THU=1`). Mong đợi: xanh.
- [ ] **Step 6: Đột biến:**
  - `phanLoaiLoiDocMc` luôn `"khong_ro"` ⇒ ca 4300 ms đỏ;
  - không lọc `valid === false` ⇒ ca `errCode` cũ đỏ;
  - `"plc_tra_loi_loi"` đòi MỌI item là lỗi PLC ⇒ ca hai gói đỏ.
  - Hoàn tác tất cả.
- [ ] **Step 7: Commit** `fix(ot): MC phan biet PLC tra loi loi (cham) voi qua han goi bang errCode cua mcprotocol - STOP ghim van ghi duoc khi PLC qua tai (R1b-2b-1 T4, muc 58)`.

### Task 5: Phiên mà mọi tag sai cấu hình không báo `connected` (mục 51, T13 m4)

**Files:**
- Modify:
  - `server/services/ot/otDriver.ts` `SuKienDoc.tags` :100 (thêm `statusCode?: string`);
  - `server/services/ot/vongPoll.ts` :210 (chép `statusCode` của mẫu vào tag của tick);
  - `server/services/ot/reconnectNhanh.ts`: `moiTagMatLienLac` :72, `laTickHong` :80, `laDocTot` :94, `taoBatDocTot.quaMau` :116-133.
- Test: mới `server/services/ot/reconnectNhanh.cauHinhSai.r1b2b.test.ts`; `server/services/ot/otManager.ketNoiDocTot.r1b.test.ts`.

**Interfaces:**
- Produces:
  - `export const MA_CAU_HINH_KHONG_GUI: ReadonlySet<string> = new Set(["invalid_address", "BadNodeIdInvalid (0x80330000)"])` — mã mà driver tự đặt khi KHÔNG gửi yêu cầu nào cho tag (S7 / MC `invalid_address`; OPC UA cú pháp sai `STATUS_BAD_NODEID_INVALID`, `opcuaDriver.ts:66`).
  - `export function laMauTrungTinh(s: { quality: OtQuality; reason?: LyDoChatLuong; statusCode?: string }): boolean` ⇔ `quality === "bad" && reason === "config_error" && statusCode ∈ MA_CAU_HINH_KHONG_GUI`.

Chốt:
- **Mẫu trung tính** không nói gì về liên lạc: không là "đã trả lời", không là "chưa trả lời".
- `moiTagMatLienLac(e)` xét trên tag KHÔNG trung tính: rỗng ⇒ false.
- `laDocTot(e)` thêm vế: `e.tags.length === 0 || e.tags.some((t) => !laMauTrungTinh(t))`. Tick mà MỌI tag trung tính ⇒ không đọc tốt, không hỏng ⇒ phiên ở `connecting`, D1 không hạ transport (không vòng nối lại).
- `taoBatDocTot.quaMau`: mẫu trung tính không đánh dấu đọc tốt.
- Lỗi cấu hình mà THIẾT BỊ trả (Modbus exception 2, SLMP end code địa chỉ) KHÔNG trung tính (máy chủ đã trả lời — K13 giữ).

- [ ] **Step 1: Test đỏ.**

```ts
// reconnectNhanh.cauHinhSai.r1b2b.test.ts
const tt = (k: string) => ({ tagKey: k, quality: "bad" as const, reason: "config_error" as const, statusCode: "invalid_address" });
it("mọi tag sai địa chỉ cục bộ ⇒ không đọc tốt, không hỏng", () => {
  const e = { ok: true, timeout: false, ms: 1, tags: [tt("a"), tt("b")] };
  expect(laDocTot(e)).toBe(false);
  expect(laTickHong(e)).toBe(false);
});
it("một tag tốt + một sai cục bộ ⇒ đọc tốt; một comm_lost + một sai cục bộ ⇒ hỏng", () => {
  expect(laDocTot({ ok: true, timeout: false, ms: 1, tags: [tt("a"), { tagKey: "b", quality: "good" as const }] })).toBe(true);
  expect(laTickHong({ ok: true, timeout: false, ms: 1, tags: [tt("a"), { tagKey: "b", quality: "bad" as const, reason: "comm_lost" as const }] })).toBe(true);
});
it("config_error do thiết bị trả (slmp_end_0xC051) vẫn là đã trả lời", () => {
  expect(laDocTot({ ok: true, timeout: false, ms: 1, tags: [{ tagKey: "a", quality: "bad", reason: "config_error", statusCode: "slmp_end_0xc051" }] })).toBe(true);
});
```

  - `otManager.ketNoiDocTot.r1b.test.ts`: phiên S7 giả, mọi địa chỉ sai (cờ V2 bật) ⇒ sau 3 tick vẫn `connecting`, không `lost`, driver không bị nối lại; push OPC UA mọi item `BadNodeIdInvalid` ⇒ `connecting`.
- [ ] **Step 2: Chạy.** Mong đợi: đỏ.
- [ ] **Step 3: Cài.**
- [ ] **Step 4: Chạy lại** `server/services/ot` + R0 opt-in. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:**
  - `laMauTrungTinh` luôn false ⇒ ca "mọi tag sai cục bộ" đỏ;
  - coi mẫu trung tính là "chưa trả lời" ⇒ ca "không hỏng" đỏ.
  - Hoàn tác cả hai.
- [ ] **Step 6: Commit** `fix(ot): phien ma moi tag sai cau hinh cuc bo khong bao connected va khong vong noi lai (R1b-2b-1 T5, muc 51)`.

### Task 6: So đọc lại ở không gian thô cho int có tỉ lệ (mục 42, T2 m3)

**Files:**
- Modify:
  - `server/services/ot/drivers/readbackCompare.ts` `readbackMatches` :18 (nhánh int :34);
  - `server/services/ot/otDeviceWrite.ts` :910-912 (canh STOP) và :1315 (xác minh lệnh ghi) truyền thang đo.
- Test: `server/services/ot/drivers/readbackCompare.test.ts`; `server/services/ot/otDeviceWrite.readback.r1b2b.test.ts` (mới).

**Interfaces:**
- Produces: `readbackMatches(expected: unknown, actual: unknown, dataType: OtDataType, tolerance = 1e-6, thangDo?: { scale?: number | string | null; offset?: number | string | null }): boolean`.

Chốt:
- int: `s` / `o` chuẩn hoá như `heSoThangDo` (`kenhScada.ts`; NULL / 0 ⇒ 1, NULL ⇒ 0); khớp ⇔ `Math.round((e − o)/s) === Math.round((a − o)/s)`. Vắng `thangDo` ⇒ (1, 0) ⇒ đúng hành vi cũ.
- float / string / json không đổi; bool theo Task 2.
- Người gọi: `:1315` truyền `{ scale: r.scale, offset: r.offset }` (`resolved[i]`, kiểu tại :1103-1109); `:910-912` truyền `{ scale: t.scale, offset: t.offset }` của `OtTagAddress`.
- Chỉ đổi nhãn xác minh (`acked_verified` / `acked_unverified`), không đổi điều khiển.

- [ ] **Step 1: Test đỏ.**

```ts
it("int scale 0.1 / 0.5: so ở số thô (Review Focus 5)", () => {
  expect(readbackMatches(2.3, 2.4, "int", 1e-6, { scale: 0.1 })).toBe(false);
  expect(readbackMatches(2.5, 3.0, "int", 1e-6, { scale: "0.5", offset: null })).toBe(false);
  expect(readbackMatches(2.5, 2.5, "int", 1e-6, { scale: 0.5 })).toBe(true);
  expect(readbackMatches(30, 30, "int", 1e-6, { scale: 10, offset: 0 })).toBe(true);
  expect(readbackMatches(3, 3.4, "int")).toBe(true); // không thang đo ⇒ như cũ
});
```

  - `otDeviceWrite.readback.r1b2b.test.ts`: driver giả ghi int scale 0,5 giá trị 2,5, đọc lại 3,0 `good` ⇒ `status "acked_unverified"`; đọc lại 2,5 ⇒ `acked_verified`.
- [ ] **Step 2: Chạy.** Mong đợi: đỏ.
- [ ] **Step 3: Cài.**
- [ ] **Step 4: Chạy lại** `server/services/ot` + `server/services/scada/r1b2aNghiemThu.db.test.ts` (opt-in, ô M1: số thô 5). Mong đợi: xanh.
- [ ] **Step 5: Đột biến:** `otDeviceWrite` không truyền `thangDo` ở :1315 ⇒ ca 3,0 đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `fix(ot): so doc lai tag int o khong gian tho (scale le khong con acked_verified gia) (R1b-2b-1 T6, muc 42)`.

### Task 7: EIP và SLMP gắn đúng danh tính (mục 11, 12)

**Files:**
- Modify:
  - `server/services/ot/drivers/ethernetIpDriver.ts` `connect` :112-131 (`timeout_sp`, gắn listener TRƯỚC `connect`);
  - `server/services/ot/drivers/slmpDriver.ts` `onData` :210-223, `transact` :236-260, mọi chỗ gọi `transact` (truyền serial từ `cfgFor()`).
- Test: `server/services/ot/drivers/ethernetIpDriver.test.ts`; `server/services/ot/drivers/slmpDriver.test.ts`.

**Interfaces:**
- Produces: `private transact(request: Buffer, serialMongDoi?: number): Promise<Buffer>` (SLMP).

Chốt:
- **EIP:**
  - ngay sau `new Controller()`: `if (typeof timeoutMs === "number") plc.timeout_sp = timeoutMs` (setter của st-ethernet-ip `dist/controller/index.js:98` đòi số);
  - gọi `this.attachLinkLossHandlers(plc)` TRƯỚC `await withTimeout(plc.connect(...))`. Listener đã có canh `this.plc === plc` ⇒ sự kiện lúc đang kết nối không lật phiên mới, nhưng `'error'` không còn là EventEmitter không người nghe (làm sập tiến trình);
  - lỗi lúc kết nối ⇒ `lastError` như nhánh catch hiện có.
- **SLMP:**
  - `transact` giữ tham chiếu `const p = { resolve, reject, timer }`; callback `socket.write(request, (err) => { if (err && this.pending === p && this.socket === socket) this.failPending(err); })`. Callback ghi muộn KHÔNG BAO GIỜ đánh hỏng giao dịch kế;
  - khung 4E: `onData` đọc serial phản hồi (`parseResponse(...).serial`, `slmpEncoder.ts:270`); khác `serialMongDoi` ⇒ bỏ khung (log một dòng), giao dịch tiếp tục chờ tới hạn. 3E (không serial) không đổi.

- [ ] **Step 1: Test đỏ.**
  - EIP (Controller giả = EventEmitter có setter `timeout_sp`): `connect({timeoutMs: 1500})` ⇒ `plc.timeout_sp === 1500`; Controller phát `'error'` TRONG `connect` (trước khi promise xong) ⇒ không có `uncaughtException` / `unhandledRejection` (bắt bằng `process.on` trong test), `connect` reject hoặc hết hạn, `lastError` có chuỗi lỗi.
  - SLMP (socket giả): giao dịch A hết hạn; giao dịch B đang chờ; callback ghi của A gọi muộn với `err` ⇒ B KHÔNG bị reject; khung 4E serial 7 tới khi chờ serial 8 ⇒ bị bỏ, khung serial 8 sau đó giải quyết B.
- [ ] **Step 2: Chạy.** Mong đợi: đỏ.
- [ ] **Step 3: Cài.**
- [ ] **Step 4: Chạy lại** `server/services/ot/drivers`. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:**
  - EIP gắn listener lại SAU `connect` ⇒ ca `'error'` lúc kết nối đỏ;
  - SLMP bỏ canh `this.pending === p` ⇒ ca callback muộn đỏ;
  - bỏ so serial ⇒ ca 4E đỏ.
  - Hoàn tác tất cả.
- [ ] **Step 6: Commit** `fix(ot): EIP timeout_sp = timeoutMs + nghe 'error' truoc khi ket noi; SLMP callback ghi va khung 4E gan dung giao dich (R1b-2b-1 T7, muc 11, 12)`.

### Task 8: Tắt tiến trình không ghi `disabled` vào DB (mục 13)

**Files:**
- Modify:
  - `server/services/ot/trangThaiAdapter.ts` (cờ module mới; `baoTrangThaiAdapter` nhánh ghi DB);
  - `server/services/ot/otManager.ts` `stopOt` :1064-1095;
  - `server/_core/index.ts` :4542 (đường tắt tiến trình gọi `stopOt({ tatTienTrinh: true })`).
- Test: mới `server/services/ot/trangThaiAdapter.tatTienTrinh.r1b2b.db.test.ts`.

**Interfaces:**
- Produces:
  - `export function datCheDoTatTienTrinh(bat: boolean): void` (`trangThaiAdapter.ts`). Bật ⇒ báo `disabled` chỉ cập nhật RAM, KHÔNG ghi `device_adapters.status`.
  - `stopOt(tuyChon?: { tatTienTrinh?: boolean }): Promise<void>`. `tatTienTrinh` ⇒ `datCheDoTatTienTrinh(true)` TRƯỚC mọi báo `disabled`.

Chốt:
- Chỉ đường tắt tiến trình (`index.ts:4542`) truyền cờ. `stopOt()` của `assets.ts:596` (khởi động lại khung OT) và `edgeGatewayRuntime.ts:1097` (gateway tắt thật) giữ ghi `disabled`.
- `detachOtAdapter` không đổi (adapter thật sự rời trung tâm).
- `startOt` gọi `datCheDoTatTienTrinh(false)` (test / khởi động lại trong cùng tiến trình).
- Lý do ghi ở đầu `trangThaiAdapter.ts`: tắt tiến trình không phải "adapter bị tắt"; ghi `disabled` làm UI và bản API khác đọc sai tới lần khởi động kế.

- [ ] **Step 1: Test đỏ (DB, `OT_GHI_TRANG_THAI_ADAPTER_ENABLED=true` trong tiến trình):**
  - adapter bật, `status 'connected'` trong DB, phiên stub chạy; `stopOt({ tatTienTrinh: true })` ⇒ chờ hết lượt ghi hẹn ⇒ DB vẫn `'connected'`;
  - đối chứng `stopOt()` ⇒ DB `'disabled'`;
  - `startOt()` sau `tatTienTrinh` ⇒ báo `connecting` rồi ghi DB như thường.
- [ ] **Step 2: Chạy.** Mong đợi: đỏ ở ca đầu.
- [ ] **Step 3: Cài.**
- [ ] **Step 4: Chạy lại** `server/services/ot/trangThaiAdapter*` + `server/services/ot/otManager*` + R0 opt-in. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:** bỏ nhánh RAM-only ⇒ ca đầu đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `fix(ot): tat tien trinh khong ghi 'disabled' vao device_adapters (gateway tat that van ghi) (R1b-2b-1 T8, muc 13)`.

### Task 9: STOP HMI — sổ có hạn và không trả giá import lạnh (mục 44, 46)

**Files:**
- Modify:
  - `server/services/scada/lenhHmi.ts`:
    - `guiStopMotAdapter` (lượt `doiTrangThaiCho` sau dispatch :1584-1594, `thu(...)` :1597 và hai nhánh lỗi :1540, :1559-1564);
    - `dungMayHmi`: `tuChoiMay` :1755-1757, `GHIM_LOI_DOC` :1811, `GHIM_MUC_CAO` :1884, `CHUA_GHIM_STOP` :1904;
  - `server/_core/hanStopHmi.ts` (danh sách module + hàm làm ấm);
  - `server/_core/index.ts` (gọi làm ấm sau khi lắng nghe, `void`, có log).
- Test:
  - mới `server/routers/scadaCommandsRouter.dungMay.soCoHan.r1b2b.db.test.ts`;
  - mới `server/_core/hanStopHmi.lamAm.test.ts`.

**Interfaces:**
- Produces:
  - `export const HAN_GHI_SO_STOP_HMI_MS = 500` (`lenhHmi.ts`).
  - `async function ghiSoCoHan(p: Promise<unknown>, nhan: string, requestId: string): Promise<void>` (cục bộ `lenhHmi.ts`): `await voiHanUnref(p, HAN_GHI_SO_STOP_HMI_MS, nhan).catch((e) => ghiLoiChot(e, requestId, nhan))`.
  - `export const MODULE_DUONG_STOP_HMI: ReadonlyArray<readonly [string, () => Promise<unknown>]>` (`hanStopHmi.ts`) = `[["../db", …], ["../db/tenantContext", …], ["./accessControl", …], ["../license/license-service", …], ["../services/robot/robotStopAuthMemo", …], ["../services/auditTrailService", …]]`.
  - `export async function lamAmDuongStopHmi(): Promise<{ ok: number; loi: string[] }>` — gọi mọi loader, không ném.

Chốt:
- **Sổ có hạn:** mọi lượt `await` ghi sổ (attempts / dòng chờ) trên đường trả lời của `dungMay` — trước dispatch (từ chối) và sau dispatch (chốt dòng chờ, attempts) — đi qua `ghiSoCoHan`. DB chậm ⇒ câu trả lời trễ tối đa `HAN_GHI_SO_STOP_HMI_MS` mỗi lượt; lượt ghi bị bỏ rơi vẫn chạy nền (không huỷ được); DB nhanh ⇒ thứ tự và nội dung sổ không đổi (test cũ không cần đổi).
- **Không đổi kết quả STOP:** quá hạn ghi sổ không bao giờ đổi `status` / `ok` của adapter.
- **Import lạnh:** mọi `import("<spec>")` trong `server/_core/trpc.ts`, `server/_core/moduleGate.ts`, `server/_core/context.ts` phải có trong `MODULE_DUONG_STOP_HMI` (cùng chuỗi spec — ba tệp cùng thư mục). `index.ts` gọi `void lamAmDuongStopHmi().then(…log…)` ngay sau `listen`. Không sửa `context.ts` ở task này (chỉ quét).

- [ ] **Step 1: Test đỏ.**
  - DB (sổ chậm THẬT, không mock hàm nội bộ của `lenhHmi.ts`: một kết nối riêng giữ `LOCK TABLE scada_command_attempts, ai_pending_actions IN EXCLUSIVE MODE` trong 5000 ms — chặn INSERT / UPDATE, không chặn SELECT; dòng chờ của máy có ghim chèn TRƯỚC khi khoá được lấy bằng một rào trong test):
    - máy chưa ghim ⇒ `dungMay` trả `CHUA_GHIM_STOP` trong < 1200 ms;
    - máy có ghim ⇒ `acked_verified` trong < 1700 ms (hai lượt sổ × 500 ms + dispatch stub), `dispatch` 1 lần;
    - sau 6 s ⇒ dòng attempts có trong sổ (lượt nền chạy xong);
    - đối chứng không chậm ⇒ thời gian và số dòng như `scadaCommandsRouter.dungMay.db.test.ts`.
  - `hanStopHmi.lamAm.test.ts`:
    - quét ba tệp, mọi `import\("([^"]+)"\)` ⇒ spec ∈ `MODULE_DUONG_STOP_HMI` (cầu chì: mỗi tệp đọc được > 500 ký tự; quét bỏ chú thích);
    - `lamAmDuongStopHmi()` ⇒ `ok === MODULE_DUONG_STOP_HMI.length`, `loi` rỗng;
    - một loader ném ⇒ `loi` có tên nó, hàm không ném.
- [ ] **Step 2: Chạy.** Mong đợi: đỏ.
- [ ] **Step 3: Cài.**
- [ ] **Step 4: Chạy lại** `server/routers/scadaCommands*` (DB) + `server/_core/hanStopHmi*` + `server/_core/context*` + R1b-2a opt-in (`SCADA_R1B2A_NGHIEM_THU=1`). Mong đợi: xanh.
- [ ] **Step 5: Đột biến:**
  - nhánh `CHUA_GHIM_STOP` quay về `await ghiThuLenh(...)` không hạn ⇒ ca chưa ghim đỏ (thời gian);
  - `guiStopMotAdapter` bỏ `ghiSoCoHan` quanh `thu(...)` sau dispatch ⇒ ca có ghim đỏ (thời gian);
  - bỏ `"../db/tenantContext"` khỏi danh sách ⇒ ca quét đỏ.
  - Hoàn tác cả hai.
- [ ] **Step 6: Commit** `fix(scada): STOP HMI - ghi so tu choi/sau gui co han 500 ms, lam am import dong cua duong STOP luc khoi dong (R1b-2b-1 T9, muc 44, 46)`.

### Task 10: Phạm vi adapter đích của luật interlock kiểm dưới khoá (mục 47, T5 m-6)

**Files:**
- Modify: `server/routers/interlockRouter.ts`: `luatTrongPhamVi` :106-131 (biến thể dưới khoá); `create` :494-524, `update` :526-600, `delete` :603-620, `enable` :684-728, `disable` :730-750.
- Test: mới `server/routers/interlockRouter.phamViDuoiKhoa.r1b2b.db.test.ts`.

**Interfaces:**
- Consumes: `khoaAdapterTx(tx, ids)` (`troLaiKenh.ts:246`), `kiemPhamViDuoiKhoa(machineId, idsMay, loi)` (`_adapterPhamVi.ts:53`), `idsMayTrongPhamVi(ctx)` (`_adapterPhamVi.ts:30`).
- Produces:
  - `async function khoaDichLuatTx(tx: DbHoacTx, ruleId: number | null, adapterIdsMoi: ReadonlyArray<number | null | undefined>): Promise<{ existing: InterlockRule | null; adapters: Map<number, { machineId: number | null }> }>` (cục bộ router).
  - `function luatTrongPhamViDuoiKhoa(r: …như luatTrongPhamVi, tap: TapPhamViLuat, adapters: Map<number, { machineId: number | null }>, idsMay: number[] | null): void` — như `luatTrongPhamVi` nhưng vế `targetAdapterId` dùng `kiemPhamViDuoiKhoa(adapters.get(id)?.machineId, idsMay, ngoai)` thay cho lượt đọc không khoá `adapterTrongPhamVi`.

Chốt:
- **Thứ tự khoá ADAPTER → LUẬT** (không đảo):
  1. `ruleId` có ⇒ đọc `targetAdapterId` hiện tại KHÔNG khoá;
  2. `khoaAdapterTx(tx, [cũ, ...mới].filter(non-null))` (FOR SHARE, id tăng);
  3. luật `FOR UPDATE`; `targetAdapterId` khác giá trị đọc ở bước 1 ⇒ `appError("CONFLICT","OPERATION_FAILED",{ operation: "interlockRule", reason: "scadaKenhThuLai" })`;
  4. `luatTrongPhamViDuoiKhoa` cho luật hiện có và (ở `update`) cho luật sau vá.
- `tap` (phạm vi dòng / trạm / máy) và `idsMay` tính TRƯỚC giao dịch (không gọi pool trong giao dịch).
- Kiểm trước giao dịch hiện có giữ nguyên (đường nhanh, cùng lỗi NOT_FOUND `interlockRule`).
- `approve` là `adminProcedure` (phạm vi toàn quyền) ⇒ không đổi.

- [ ] **Step 1: Test đỏ (DB, kỹ sư nhà máy A, khuôn S1 của `r1b2aNghiemThu.db.test.ts`: một giao dịch THẬT commit đổi adapter đích sang máy nhà máy B giữa kiểm-trước và khoá, đo chặn bằng `pg_blocking_pids`):**
  - `create` luật nhắm adapter ấy ⇒ `NOT_FOUND {entity:"interlockRule"}`, 0 luật tạo, 0 audit;
  - `update` / `delete` / `enable` / `disable` luật đang nhắm adapter ấy ⇒ cùng NOT_FOUND, hàng không đổi;
  - đối chứng dương: đổi sang máy khác CÙNG nhà máy A ⇒ thành công;
  - `update` đổi `targetAdapterId` song song với một `update` khác đổi `targetAdapterId` của cùng luật ⇒ một bên thành công, bên kia `CONFLICT scadaKenhThuLai` hoặc thành công tuần tự; 0 lỗi 40P01 lọt ra (10 vòng).
- [ ] **Step 2: Chạy.** Mong đợi: đỏ ở ca đổi máy.
- [ ] **Step 3: Cài.**
- [ ] **Step 4: Chạy lại** `server/routers/interlock*` (DB) + `server/services/scada/thuTuKhoaTag.census.test.ts` + mọi `*census*`. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:**
  - `update` quay về `luatTrongPhamVi` (đọc không khoá) ⇒ ca `update` đổi máy đỏ;
  - khoá luật TRƯỚC adapter ⇒ ca đua 10 vòng đỏ (40P01) hoặc ca đổi máy đỏ.
  - Hoàn tác cả hai.
- [ ] **Step 6: Commit** `fix(interlock): kiem pham vi adapter dich cua luat duoi khoa adapter FOR SHARE truoc luat FOR UPDATE (R1b-2b-1 T10, muc 47)`.

### Task 11: Audit theo lô cho khai mức hàng loạt (mục 48, T6 m-1)

**Files:**
- Modify:
  - `server/services/audit/controlAuditService.ts` (hàm mới cạnh `recordAuditEvent` :72);
  - `server/routers/scadaKenhRouter.ts` `khaiHangLoat` :599-627 (vòng `update` + `recordAuditEvent` từng tag).
- Test: `server/services/audit/controlAudit.test.ts`; mới `server/routers/scadaKenhRouter.khaiHangLoat.auditLo.r1b2b.db.test.ts`; hồi quy `server/routers/scadaKenhRouter.khaiHangLoat.r1b2.db.test.ts`.

**Interfaces:**
- Produces:
  - `export function xauChuoiAudit(prevHash: string, es: ReadonlyArray<AuditEventInput>, hashTs: number): Array<{ prevHash: string; hash: string }>` — thuần; phần tử i dùng `hash` của phần tử i−1 (phần tử 0 dùng `prevHash`), `computeAuditHash` như `recordAuditEvent`.
  - `export async function recordAuditEvents(db: DbOrTx, es: ReadonlyArray<AuditEventInput>): Promise<ControlAuditLog[]>`:
    - `es` rỗng ⇒ `[]`, không chạm DB;
    - SEC_PLATFORM tắt ⇒ MỘT `INSERT … VALUES (…),(…)` `RETURNING`;
    - bật ⇒ MỘT giao dịch con: `pg_advisory_xact_lock(AUDIT_CHAIN_LOCK)`, đọc `hash` mới nhất MỘT lần, `xauChuoiAudit`, MỘT `INSERT` nhiều hàng; trả hàng theo `id` tăng.
- Hằng: `export const TRAN_HANG_AUDIT_MOT_LO = 500`. Vượt ⇒ ném `Error` (lập trình sai).

Chốt:
- **`khaiHangLoat`:**
  - các tag đổi ghi bằng MỘT `UPDATE device_tags AS t SET "channelKind" = v.ck, "displayName" = v.dn, "displayFormat" = v.df, "writeMin" = v.wmin, "writeMax" = v.wmax, "writeStep" = v.ws, actuation_level = v.al, "updatedAt" = $now FROM (VALUES …) AS v(id, ck, dn, df, wmin, wmax, ws, al) WHERE t.id = v.id` — giá trị là `sau` ĐẦY ĐỦ của `kiemPatchKenh` (mọi cột `COT_KENH`), có ép kiểu SQL tường minh (`::numeric`, `::int`, enum `channelKind`). Tên cột thật lấy từ schema drizzle (`deviceTags`), không đoán;
  - audit: MỘT `recordAuditEvents(tx, [...200 dòng scada_kenh_cap_nhat, 1 dòng scada_kenh_khai_hang_loat])`, nội dung từng dòng như hôm nay;
  - thứ tự: kiểm hết → TOTP → UPDATE → audit (khoá chuỗi audit lấy SAU mọi khoá hàng — Global Constraints).
- **`capNhat` và mọi bên gọi `recordAuditEvent` khác không đổi.**

- [ ] **Step 1: Test đỏ.**

```ts
// controlAudit.test.ts — R1b-2b-1 T11
it("xauChuoiAudit nối đúng chuỗi và verifyAuditRows xác nhận", () => {
  const es = Array.from({ length: 5 }, (_, i) => ({ entityType: "device_tag", entityId: i, action: "x", actorId: 1, before: null, after: { i }, reason: "r" }));
  const c = xauChuoiAudit(GENESIS_HASH, es, 1700000000000);
  expect(c[0].prevHash).toBe(GENESIS_HASH);
  for (let i = 1; i < 5; i++) expect(c[i].prevHash).toBe(c[i - 1].hash);
  const rows = es.map((e, i) => ({ id: i + 1, entityType: e.entityType, entityId: String(e.entityId), action: e.action, actorId: 1, beforeJson: null, afterJson: e.after, reason: "r", prevHash: c[i].prevHash, hash: c[i].hash, hashTs: 1700000000000 }));
  expect(verifyAuditRows(rows).ok).toBe(true);
});
```

  - DB (`SEC_PLATFORM=true` chỉ trong tiến trình; TOTP thật như T6 R1b-2a):
    - lô 200 tag ⇒ `soDoi 200`, audit +201, mức 200/200 = 3 (hồi quy);
    - SONG SONG với lô: 20 lượt `recordAuditEvent` đơn lẻ từ kết nối khác ⇒ mọi hàng `hash IS NOT NULL` có id trong `[id nhỏ nhất của lô, id lớn nhất]` tạo đoạn liên tục: `row[i].prevHash === row[i−1].hash` và `hash` tính lại khớp `computeAuditHash` (hàm kiểm đoạn viết trong test);
    - `khaiHangLoat` gọi `recordAuditEvents` đúng 1 lần với 201 phần tử và `recordAuditEvent` 0 lần (spy bọc bản thật bằng `importOriginal`); thời gian lô 200 khi SEC_PLATFORM bật chỉ ĐO và ghi vào commit (số trước: 1710 ms), không khẳng định ngưỡng;
    - SEC_PLATFORM tắt ⇒ audit +201, `hash` NULL.
  - `scadaKenhRouter.khaiHangLoat.r1b2.db.test.ts` xanh không sửa.
- [ ] **Step 2: Chạy.** Mong đợi: đỏ (hàm chưa có; `recordAuditEvent` bị gọi 201 lần).
- [ ] **Step 3: Cài.**
- [ ] **Step 4: Chạy lại** `server/services/audit` + `server/routers/scadaKenh*` (DB) + `server/routers/interlock*` (người gọi audit khác) + mọi `*census*`. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:**
  - `xauChuoiAudit` dùng `prevHash` gốc cho mọi phần tử ⇒ ca thuần + ca đoạn liên tục đỏ;
  - `recordAuditEvents` bỏ khoá tư vấn ⇒ ca song song đỏ (đoạn rẽ nhánh) — chạy 5 lượt, ghi số lượt đỏ;
  - `UPDATE … FROM VALUES` bỏ cột `actuation_level` ⇒ ca mức 3 đỏ.
  - Hoàn tác tất cả.
- [ ] **Step 6: Commit** `perf(scada): khai muc hang loat - mot UPDATE FROM VALUES + mot INSERT audit nhieu hang dung chuoi bam (giam giu khoa chuoi audit) (R1b-2b-1 T11, muc 48)`.

### Task 12: Gỡ nhánh client chết `tagForm.id` (mục 49, T8 c5)

**Quyết định:** gỡ nhánh chết; form sửa tag thật (cột nhịp có TOTP) chuyển sang R1b-2b-2 (YAGNI ở phần an toàn).

**Files:**
- Modify: `client/src/pages/DeviceAdapterManagement.tsx`: `interface TagForm` :91 bỏ `id?`; `submitTag` :663-680 bỏ nhánh `if (tagForm.id != null)`; bỏ `tagEditGuard` :662 và `{tagEditGuard.dialog}` :984. GIỮ `useStopPinRemovalGuard` và biến thể `"edit"` (export, có test `DeviceAdapterManagement.stopPin.dom.test.tsx:222`, dùng lại cho form sửa ở R1b-2b-2).
- Test: mới `client/src/pages/DeviceAdapterManagement.taoTag.r1b2b.dom.test.tsx`.

- [ ] **Step 1: Test đỏ (DOM, mock `@/lib/trpc` theo khuôn `DeviceAdapterManagement.troLaiTotp.dom.test.tsx`):** mở sheet tag của adapter 7, điền `tagKey` / `address`, bấm lưu ⇒ đúng một `{proc:"tags.create", vars:{adapterId:7, tagKey, address, …}}`, 0 lần `tags.update`. Ca "sửa" không thể dựng (không có lối vào) ⇒ ghi trong test là chủ ý.
- [ ] **Step 2: Chạy.** Mong đợi: xanh ngay (hành vi không đổi) — ca này là lưới hồi quy cho việc gỡ; bước đỏ thay bằng đột biến (Step 5).
- [ ] **Step 3: Gỡ nhánh.** `npx tsc --noEmit` (12 GB) không lỗi.
- [ ] **Step 4: Chạy lại** `client/src/pages/DeviceAdapterManagement*`. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:** `submitTag` gọi `updateTag.mutate({ id: 0, ...base })` ⇒ ca mới đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `refactor(ui): go nhanh chet tagForm.id cua submitTag (form sua tag that sang R1b-2b-2) (R1b-2b-1 T12, muc 49)`.

### Task 13: Dọn `_test` tìm mục tiêu bằng truy vấn, không id viết tay (G5)

**Files:**
- Modify: `scripts/don-rac-test-r1b2.mjs` (`MUC_TIEU` :31-41, `MAU_MA_TEST` :43, `chay` :181-270).
- Test: `scripts/don-rac-test-r1b2.unit.test.ts`, `scripts/don-rac-test-r1b2.db.test.ts`.

**Interfaces:**
- Produces:
  - `export const MAU_MA_TEST_SQL = "^(r1b2|pvk|tth)"`; `MAU_MA_TEST = new RegExp(MAU_MA_TEST_SQL, "i")` (một nguồn).
  - `export async function timMucTieu(tx, mauMaSql = MAU_MA_TEST_SQL): Promise<MucTieu>` — với mỗi `[bang, khoa]` của `BANG_MA` :84: `SELECT id FROM <bang> WHERE code ~* $mauMaSql ORDER BY id`.
  - `export function kiemMoCoi(muc: MucTieu, hangAdapter: Array<{ id: number; machineId: number | null }>): void` — adapter tìm được mà `machineId` không NULL và không thuộc `muc.machines` ⇒ `TuChoi` (không xoá adapter gắn máy thật).
  - `MUC_TIEU` hằng bị bỏ; `o.muc` của `chay` vẫn nhận tập cố định (cho test).

Chốt:
- Chạy khô (mặc định) IN tập tìm được dạng JSON một khối `MUC_TIEU tìm được:` trước bảng đếm ⇒ ai cũng thấy chính xác id sẽ xoá.
- `--ghi` xoá ĐÚNG tập tìm được trong CÙNG giao dịch (không có cửa sổ giữa tìm và xoá).
- Mọi chốt cũ giữ: `--test-only` bắt buộc, `laDbTest` trên URL ghi, ghim host:port = `DATABASE_URL`, `current_database()` kết thúc `_test` trong giao dịch, `kiemTenMa`, WORM giữ.
- Ghi ở đầu script: không chạy song song với lưới (fixture `pvk` / `tth` đang sống của lưới khác khớp mẫu).

- [ ] **Step 1: Test đỏ.**
  - unit: `MAU_MA_TEST.source === MAU_MA_TEST_SQL`; `kiemMoCoi({machines:[1]}, [{id:9, machineId:2}])` ném `TuChoi`; `machineId: null` và `machineId: 1` ⇒ không ném.
  - DB (`_test`): tạo máy `r1b2zz…` + adapter của nó + adapter `r1b2yy…` gắn một máy KHÔNG khớp mẫu; chạy khô ⇒ `TuChoi` (mồ côi), 0 xoá; gỡ adapter thứ hai ⇒ chạy khô in JSON chứa đúng id máy / adapter tạo ra; `--ghi` ⇒ xoá, chạy khô lại ⇒ 0.
- [ ] **Step 2: Chạy.** Mong đợi: đỏ.
- [ ] **Step 3: Cài.** Chạy khô trên `_test`, dán khối JSON + số đếm vào commit.
- [ ] **Step 4: Chạy lại** hai tệp test + `scripts/apply-migration-0433.mjs --test-only` vẫn xanh. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:** `kiemMoCoi` không ném ⇒ ca mồ côi đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `chore(scripts): don _test tim muc tieu bang truy van ma test (in JSON khi chay kho), tu choi adapter gan may that (R1b-2b-1 T13, kiem-dinh G5)`.

### Task 14: Bộ giới hạn STOP — trần dự phòng trong bộ nhớ khi Redis sập + hạn lệnh Redis (G3, mục 45) — SAU gộp hợp nhất

**Files (tên chính xác đọc lại sau Step 0):**
- Modify: `server/_core/rateLimitConfig.ts` (client Redis của bộ giới hạn ~:393; `createHmiStopLimiter` ~:738 — hoặc nơi helper hợp nhất của kiem-dinh đặt chúng).
- Test: `server/_core/rateLimitConfig.hmiStop.test.ts` (hoặc tệp test hợp nhất tương ứng).

**Interfaces:**
- Produces:
  - `export const HAN_LENH_REDIS_GIOI_HAN_MS = 250` — `commandTimeout` của client ioredis dùng chung cho mọi bộ giới hạn.
  - `export class StoreDuPhongBoNho implements Store` — `constructor(chinh: Store | undefined, duPhong: Store /* MemoryStore của express-rate-limit */)`: `increment` / `decrement` / `resetKey` gọi `chinh`; `chinh` ném (gồm quá hạn lệnh) ⇒ gọi `duPhong` với CÙNG khoá, log tối đa một dòng / 60 s. `chinh` vắng (chế độ bộ nhớ) ⇒ chỉ `duPhong`.
  - Tầng STOP dùng `store: new StoreDuPhongBoNho(<store Redis của tầng STOP>, new MemoryStore())`; trần, khoá, `skip`, message không đổi.

Chốt:
- **G3:** Redis sập ⇒ STOP có vé ký hợp lệ vẫn bị trần `TRAN_STOP_HMI_MOI_PHUT` (600 / phút / phiên) THEO TIẾN TRÌNH (N bản API ⇒ N × 600). `passOnStoreError: true` giữ (chỉ còn có tác dụng nếu cả bộ nhớ ném).
- **Hạn lệnh:** Redis chậm-mà-sống (mỗi lệnh 2 s) ⇒ lệnh quá 250 ms ném ⇒ tầng STOP rơi sang bộ nhớ; tầng khác fail-open như hôm nay. Độ trễ thêm trước tRPC ≤ ~3 × 250 ms (INCR + PTTL + PEXPIRE).
- Không đổi mọi tầng khác ngoài `commandTimeout` dùng chung.

- [ ] **Step 0: Gộp main có bản hợp nhất của kiem-dinh** (điều phối báo đã vào main). Đo: `git log --oneline main -- server/_core/rateLimitConfig.ts server/_core/vePhienCookie.ts` có commit hợp nhất. Gộp, giải xung đột, chạy lại mọi `*census*` + `server/_core/rateLimitConfig*` + `server/_core/trpcGioiHanThuTuc*` + `server/_core/sdk*` + R1b-2a opt-in. Đọc helper hợp nhất; cập nhật tên ở mục Files / Interfaces của Task 14–15 trong commit gộp nếu khác.
- [ ] **Step 1: Test đỏ** (Redis giả `MinimalRedisClient`, khuôn Redis giả của T3 R1b-2a):
  - Redis giả ném ở mọi lệnh ⇒ một phiên: 600 POST `dungMay` ký hợp lệ ⇒ không 429; lượt 601 ⇒ 429 `{"error":"Too many STOP requests — use the hard E-STOP"}`; phiên khác ⇒ không 429;
  - Redis giả chờ 2000 ms mỗi lệnh ⇒ mỗi yêu cầu STOP qua tầng giới hạn < 1000 ms; lượt 601 vẫn 429 (bộ nhớ đếm);
  - Redis khoẻ ⇒ đếm ở Redis (giả đếm 600 INCR), bộ nhớ không tăng;
  - client Redis thật dựng với `commandTimeout === HAN_LENH_REDIS_GIOI_HAN_MS` (đọc `client.options`).
- [ ] **Step 2: Chạy.** Mong đợi: đỏ.
- [ ] **Step 3: Cài + sửa JSDoc "Fail-open, ACCEPTED (c4)" của tầng STOP thành câu mới (trần theo tiến trình khi Redis sập).**
- [ ] **Step 4: Chạy lại** `server/_core/rateLimitConfig*` + `server/_core/trpcGioiHanThuTuc*` + `server/_core/index*` + oracle kiem-dinh tầng STOP (`3d644a681`) + R1b-2a opt-in (ô G1 / G2). Mong đợi: xanh.
- [ ] **Step 5: Đột biến:**
  - `StoreDuPhongBoNho` nuốt lỗi và trả `totalHits 0` ⇒ ca lượt 601 đỏ;
  - bỏ `commandTimeout` ⇒ ca Redis chậm đỏ (thời gian).
  - Hoàn tác cả hai.
- [ ] **Step 6: Commit** `fix(auth): tang STOP HMI co tran du phong trong bo nho khi Redis sap + han lenh Redis 250 ms cho client gioi han (R1b-2b-1 T14, kiem-dinh G3, muc 45)`.

### Task 15: `dungMay` trong batch có hạn như request STOP đơn (G4) — SAU gộp hợp nhất

**Quyết định:** BỌC HẠN, không từ chối. Từ chối một STOP vì hình dạng request là một cổng phần mềm đứng trước STOP; client chuẩn không gửi batch này (trpcLinks tách riêng), nên bọc hạn có cùng chi phí mà giữ bất biến.

**Files:**
- Modify: `server/_core/hanStopHmi.ts` (cạnh `laGoiChiDungMay` :37); `server/_core/context.ts` :81.
- Test: `server/_core/context.dungMayHan.test.ts`.

**Interfaces:**
- Consumes: Task 14 Step 0 (main đã gộp).
- Produces: `export function laGoiCoDungMay(info: unknown): boolean` ⇔ `info.calls` là mảng và có ≥ 1 phần tử `path === DUONG_DUNG_MAY_HMI`.

Chốt:
- `createContext`: `hanChotStopHmi = laGoiCoDungMay(opts.info) ? Date.now() + HAN_TONG_STOP_HMI_MS : undefined`. Cả request (mọi lượt gọi trong batch) dùng chung hạn tổng: xác thực `min(1,5 s, còn lại)`, cổng đổi mật khẩu / giấy phép / tenant bị chặn bởi phần còn lại, pha trước-gửi của `dungMay` như R1b-2a.
- Lượt gọi khác trong cùng batch có thể nhận `SCADA_STOP_PRECHECK_TIMEOUT` khi DB chậm — chấp nhận (chỉ client không chuẩn gửi được hình này).
- `laGoiChiDungMay` giữ (tầng giới hạn và log dùng nó). Tầng giới hạn STOP không đổi (batch vẫn do `apiLimiter` đếm).

- [ ] **Step 1: Test đỏ:** `authenticateRequest` giả chờ 5 s + `info.calls = [{path:"auth.me"},{path:"scadaCommands.dungMay"}]` ⇒ reject `SERVICE_UNAVAILABLE / SCADA_STOP_PRECHECK_TIMEOUT {pha:"xac_thuc"}` trong < 1700 ms; batch không có `dungMay` ⇒ không hạn (chờ đủ 5 s giả bằng đồng hồ giả); `laGoiCoDungMay` bảng chân trị (rỗng, vắng, một, trộn).
- [ ] **Step 2: Chạy.** Mong đợi: đỏ.
- [ ] **Step 3: Cài.**
- [ ] **Step 4: Chạy lại** `server/_core/context*` + `server/_core/hanStopHmi*` + `server/routers/scadaCommands*` (DB) + R1b-2a opt-in (ô D1). Mong đợi: xanh.
- [ ] **Step 5: Đột biến:** `createContext` quay về `laGoiChiDungMay` ⇒ ca batch trộn đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `fix(scada): dungMay trong batch tRPC cung chiu han tong 2,5 s cua STOP HMI (boc han, khong tu choi) (R1b-2b-1 T15, kiem-dinh G4)`.

### Task 16: Nghiệm thu R1b-2b-1

**Files:**
- Create: `server/services/scada/r1b2b1NghiemThu.db.test.ts` (opt-in `SCADA_R1B2B1_NGHIEM_THU=1`; `OT_CONTROL_ENABLED="true"`, `AI_OT_CONTROL_ENABLED="false"` chỉ trong tiến trình).
- Modify: `docs/superpowers/plans/2026-10-26-scada-r1b-2b-1-bao-cao-nghiem-thu.md` (khung từ Task 2); chỉ khi được phép chạy bench: `scripts/scada-r1b-bench.ts` (cờ `--r1b2b1`, bước B1 trên một coil).

Cổng:

| Ô | Kích thích | Mong đợi |
|---|---|---|
| P1 | operator có quyền dừng, cờ buộc đổi bật: `mayDungKhanCap` rồi `dungMay`; `viewer` cùng cờ; `scadaKenh.cheDo.danhSach` | máy trong phạm vi + `acked_verified` + 1 audit buộc đổi; `[]`; `MUST_CHANGE_PASSWORD` |
| B1 | dispatch AI `"false"` / `"0"` / `"off"` / `2` lên tag bool chưa khai | FALSE, FALSE, `TYPE_MISMATCH`, `TYPE_MISMATCH`; thiết bị 0 cho hai ca sau |
| B2 | luật bool `"on"` | JS từ chối ⊆ SQL ∪ SQL bool |
| Q1 | S7 tag string `"BAD 12"`, `anythingBad=false` / `true` | mẫu tốt + `connected` / mẫu xấu |
| M1 | MC mọi item BAD 4300 ms `MC Error Response` / quá hạn gói | `device_error`, STOP ghim ghi được / mất liên lạc |
| C1 | S7 mọi địa chỉ sai | `connecting`, không `lost`, không nối lại |
| R1 | int scale 0,5 ghi 2,5 đọc lại 3,0 | `acked_unverified` |
| E1 | EIP `'error'` lúc kết nối; SLMP callback ghi muộn | không sập tiến trình; giao dịch kế không bị hỏng |
| T1 | `stopOt({tatTienTrinh:true})` | DB `status` giữ nguyên |
| L1 | sổ chậm 5 s, máy chưa ghim | `CHUA_GHIM_STOP` < 1,2 s |
| I1 | đổi máy adapter đích giữa kiểm và khoá (5 thủ tục interlock) | NOT_FOUND, 0 hàng đổi |
| A1 | khai mức 200 tag, SEC_PLATFORM bật, 20 audit song song | đoạn chuỗi liên tục; một lượt `recordAuditEvents`; thời gian ghi số đo |
| G3 | Redis ném mọi lệnh; 601 STOP một phiên | lượt 601 ⇒ 429 |
| G4 | batch `[auth.me, dungMay]`, xác thực chậm 5 s | `SCADA_STOP_PRECHECK_TIMEOUT` < 1,7 s |

- [ ] **Step 1:** viết test opt-in; chạy 3 lượt tuần tự; xanh. Đỏ ⇒ về task sở hữu, không nới ngưỡng. Không đặt biến ⇒ skipped. (D1 dọn `_test` của Task 13 đo bằng chạy khô thật, ghi trong báo cáo, không ở lưới.)
- [ ] **Step 2: Đột biến hệ thống:** Modbus coil quay về `Boolean(w.value)` ⇒ B1 đỏ. Ghi lại. Hoàn tác.
- [ ] **Step 3: Bench OpenPLC — CHỈ khi điều phối cho phép ngay lúc đó** (commit trống ≥ 10 GB; `docker update --memory 1g --memory-swap 1g avi-openplc-bench`; không chạm :3000 / :8091 / GPU): B1 trên một coil (`"false"` ⇒ coil 0, `"off"` ⇒ từ chối, coil không đổi), 3 lượt, đọc lại bằng client riêng, trả coil + container về gốc. Không tải chương trình PLC. Không được phép ⇒ ghi "bench not run" + lý do. MC (M1) không có PLC thật ⇒ ghi giới hạn.
- [ ] **Step 4: Báo cáo.** Bảng số đo, đột biến, giới hạn đã biết, rồi:
  - thứ tự triển khai: `TRUY_VAN_TRUOC_TRIEN_KHAI` (R1b-2a) VÀ `TRUY_VAN_TRUOC_TRIEN_KHAI_BOOL` = 0 hàng trên DB đích TRƯỚC bản build (khối §4 mục 2b ghim từng byte);
  - thay đổi hành vi nhìn thấy được: bool lạ bị từ chối; trang đổi mật khẩu có khối DỪNG; phiên sai cấu hình toàn bộ ở `connecting`; tắt tiến trình không ghi `disabled`;
  - **câu nguyên văn: "R1b-2b-1 là điều kiện cần; bật `AI_OT_CONTROL_ENABLED` là quyết định của chủ dự án sau rà soát độc lập riêng"**;
  - danh sách R1b-2b-2;
  - ghi tách LOGIC · DỮ LIỆU · VẬN HÀNH.
- [ ] **Step 5: Chạy toàn bộ:**
  - `node scripts/luoi-truoc-gop.mjs --nang server shared client/src scripts vscode-extension/src`;
  - lô serial (`vitest.serial.config.ts`);
  - mọi `*census*`;
  - opt-in R0 + R1a + R1b-1 + R1b-2a + R1b-2b-1;
  - `npm run check` (12 GB);
  - `npm run i18n:check`.
  - Phân loại mọi tệp đỏ.
- [ ] **Step 6: Commit** `test(scada): nghiem thu R1b-2b-1 - STOP tu trang doi mat khau, bool chat, BAD theo kieu, MC errCode, doc lai tho, pham vi interlock duoi khoa, audit theo lo, tran STOP khi Redis sap`.

---

## Bàn giao sau R1b-2b-1

- Báo điều phối để giao kiem-dinh. **Không push.**
- Không migration. Nếu phát sinh: 0437–0439 (0435–0436 khi đã báo bộ điều khiển), gửi SQL, chờ "áp" mới áp DEV.
- Không đổi `AI_OT_CONTROL_ENABLED` ở bất cứ đâu.
- Viết kế hoạch R1b-2b-2 sau khi R1b-2b-1 được duyệt.

## Danh sách R1b-2b-2 (chỉ liệt kê — kế hoạch riêng)

Số giữ theo báo cáo R1b-2a §11 để đối chiếu 1-1.

**Nhật ký, chạy khô, UI (từ R1b-2 đã duyệt):**
1. M9 `/scada/journal` (UI) + nợ phạm vi `commandLogRouter`.
2. M4 "Điều kiện cho phép" chạy khô (dry-run `request()` không tạo bản ghi chờ).
3. M12: tìm kiếm bảng, cảnh báo deadband trước khi lưu cho tag ứng viên mới, ca biên ô chọn adapter mặc định.
4. Chip "Truyền thông n/m".
5. Lab "thử đọc một địa chỉ" (không ghi, có audit).
6. `danhSach` lộ endpoint / `lastError` cho `machine_status.canView`.
7. `ketNoiLai`: giới hạn tần suất + audit trong giao dịch.
8. Tắt nóng `SCADA_SOCKET` dập đăng ký.
9. Trần tổng tag / người dùng.
10. Nhãn "sim" cho lệnh stub trong sổ lệnh.
49b. Form sửa tag thật (cột nhịp `samplingMs` / `deadband` / `unit` có TOTP, dùng `useStopPinRemovalGuard("edit")`) — phần còn lại của mục 49 sau Task 12.

**Tính năng driver và phần dư T3 / T4:**
14. C6 đọc khối Modbus.
15. Đo mất / có lại liên lạc OPC UA.
16. Nhịp cho nguồn ngoài OT trung tâm.
19. T4: nạp bộ đệm sống (`napTuOt`) khi DB treo — `onMauBoQua` qua `TuyChonVongPoll` và 7 driver.
20. T4: thử lại lô mẫu xấu bị bỏ.
21. T3: watchdog thừa mẫu cho đường push (phải phát `comm_lost`, không `stale` — census `staleKhongVaoPhien`).
22. T3: kế toán mất liên lạc khi reset HA.
23. T3 c2: ghi trong lúc phiên chờ lần đọc tốt đầu tiên.
24. T3: thứ tự canh `sinkPhien` legacy (nit).
52. K13: xem lại "`stale` = đã trả lời" khi có nguồn `stale` thật.
60. OPC UA: cuộc đua tin cậy chứng chỉ (kiem-dinh đo được ở SẢN PHẨM, điều phối 2026-10-26). Danh sách tin cậy của node-opcua-pki nằm trong bộ nhớ, chỉ cập nhật khi watcher thấy tệp mới ở `trusted/`; nếu vòng nối lại của `opcuaDriver` rơi giữa lúc người vận hành chuyển chứng chỉ `rejected/`→`trusted/` và lúc watcher cập nhật ⇒ nối thất bại và node-opcua-pki DỜI chứng chỉ NGƯỢC về `rejected/`. Hướng sửa: nạp lại danh sách tin cậy từ đĩa trước mỗi lượt nối lại (hoặc không tự dời ngược chứng chỉ vừa được chuyển trong N giây); test đua 6 bản song song dưới tải. Cơ chế: `opcuaDriver.secure.sim.test.ts` bản sửa của kiem-dinh trên `chore/ai-luoi-do`; kiem-dinh chỉ sửa comment hướng dẫn đầu `opcuaSecurity.ts`.
61. **(ƯU TIÊN ĐẦU R1b-2b-2 — điều phối 2026-10-26: đụng pool của đường STOP)** STOP HMI: các lượt ghi bắn-rồi-quên CÓ TỪ TRƯỚC trên đường `dungMay` (attempts + audit của `tuChoiQuaHan`, vòng `STOP_QUA_HAN` theo adapter, mọi `recordAuditEvent`) chưa chịu trần ghi treo của T9 (`TRAN_GHI_SO_TREO_STOP_HMI` = 8, R1b-2b-1 T9 `960e42f01`) — bảng audit chậm vẫn có thể cạn pool như lỗi I1 của T9. Đưa chúng vào CÙNG bộ đếm; bỏ qua audit khi đầy phải log nội dung hàng. Kèm: trần là THEO TIẾN TRÌNH (N bản API ⇒ N × 8).
62. Interlock `resolveEvent`: đọc luật không khoá và kiểm phạm vi adapter qua pool TRONG giao dịch (R1b-2b-1 T10 review) — đưa vào `khoaDichLuatTx` (adapter FOR SHARE → luật) như các đường sửa luật.
63. Census thứ tự khoá ADAPTER → LUẬT interlock + cấm gọi pool (`getDb()`) bên trong giao dịch đang giữ khoá hàng (R1b-2b-1 T10 review: lượt đọc pool trong tx là kết nối thứ hai — treo khi pool cạn).

**AI và cổng mức:**
17. `congOtLuong` dùng mức kênh (cần `adapterId` trong luồng AI).
18. Audit điều tiết báo đúng cỡ đợt burst (R1a §8 mục 14).
30. DOM test I-2 cho mọi hộp `SCADA_AI_LEVEL_TOO_HIGH`.
31. T13 m2 (R1b-1): đường FOE thật tới số thô.
43. Bộ đề xuất SPI trên tag float ĐÃ khai xét dải / bước.
57. Hậu tố tiếng Việt "(chưa đọc được lưới tag)" trong `rationale` tiếng Anh.

**Census, posture, vận hành:**
25. Điểm mù census (`import * as t`, helper khác tệp, FOR SHARE / SQL thô / bí danh import; kiểm B thời chạy của `otWriteBinding`).
26. Dispatcher join `edge_nodes`.
27. Leo thang `chua_kiem_duoc`.
28. `performance.now` khi máy ngủ.
29. Loại tệp test khỏi hai ca census `confirmAction`, kèm lý do có ngày.
32. `validateStopValue` đòi số nguyên cho ghim trên int (ghim 2,5 trên int scale 0,5).
33. Hiệu năng khảo sát khả năng dừng ở mỗi lần poll 5 s của `cheDo.danhSach` (nay thêm người gọi `mayDungKhanCap`).
34. Posture đếm cả luật bật chưa duyệt (xem lại ở R2).
35. Kiem-dinh I4: đo PRODUCTION mọi tag int chưa khai (việc vận hành, checklist).
36. Edge `otEdgeDispatch` không qua cổng kênh — thuộc R1c.
37. Khoá TOTP leo thang / cảnh báo `tam_khoa` lặp.
38. Màn admin mở khoá TOTP.
39. `NganTagAdapter` đòi `machine_control.canView`.
40. i18n `TRPC_GIOI_HAN_THU_TUC`.
41. Các mục P2 còn lại của kiem-dinh — chờ danh sách của điều phối.
50. Lượt thua của đăng nhập REST tiêu ngân sách OTP của vé.
54. Posture `theoBuoc` chưa hiển thị; i18n tên bước; vô hiệu cache posture khi phạm vi người dùng đổi.
55. Bộ lọc văn bản của `phamViTuyenCensus` mong manh; `i18n:check` không thấy khoá động (kiem-dinh W23).
56. `robotStopDegradedAuth.dot10.db` NF5-1 hết giờ 30 s trong lô (kiem-dinh).

**Còn mở từ báo cáo R1b-1 §10 (chưa có ở danh sách R1b-2a):**
- R1b-1 §10 mục 21: băm định nghĩa duyệt phủ endpoint / protocol / connectionOptions / máy của adapter đích; luật "Cần duyệt lại" vào hàng chờ duyệt; hộp duyệt hiện định nghĩa đang được duyệt.
- R1b-1 §10 mục 22: STOP do hệ thống khởi phát (chuyển chủ, edge nhả) vẫn ghi MỌI ghim — lọc cùng luật `phanLoaiGhimStopHmi` hoặc chứng minh không cần (cần quyết định sản phẩm — Q12).
- R1b-1 §10 mục 23: SoD với người ĐỔI ĐỊNH NGHĨA tag khi duyệt lại luật.
- R1b-1 §10 mục 24: luật "Cần duyệt lại" vô hình ở hàng chờ duyệt (`assignmentService.ts:44`).
- R1b-1 §10 mục 25: luật đang bật tự chặn vì lệch băm không được báo chủ động (posture / `/health` đếm `enabled AND canDuyetLai`).
- R1b-1 §10 mục 26: ghim theo lô lúc commissioning — một mã cho N ghim.

**Đã làm ở R1b-2b-1 (đối chiếu):** 11, 12, 13 (T7, T8), 42 (T6), 44, 46 (T9), 45 (T14), 47 (T10), 48 (T11), 49 phần gỡ (T12), 51 (T5), 58 (T4), 59 (T1), G1–G5 (T2, T3, T14, T15, T13). Mục 53 (hợp nhất limiter / bộ đọc cookie) do kiem-dinh làm trên main — gỡ khỏi SCADA theo điều phối 2026-10-26.

## Tự rà soát (đã chạy)

1. **Phủ yêu cầu.** Mọi mục bắt buộc của điều phối có task:
   - mục 59 → T1 (đầu tiên);
   - G1 → T2; G2 → T3; G3 → T14; G4 → T15; G5 → T13;
   - MC errCode (58) → T4; đọc lại thô (42) → T6; hạn lệnh Redis (45) → T14; sổ có hạn (44) → T9; import lạnh (46) → T9; khoá chuỗi audit theo lô (48) → T11; phạm vi interlock dưới khoá (47) → T10; `tagForm.id` (49) → T12; phiên sai cấu hình toàn bộ (51) → T5;
   - driver đúng đắn 11 / 12 / 13 → T7 / T8;
   - hợp nhất limiter / cookie: gỡ theo điều phối; ràng buộc bốn tệp đóng băng ở Global Constraints; T14–T15 có Step 0 gộp main.
   Mục còn lại của 1–59 và R1b-1 §10 21–27 nằm trong danh sách R1b-2b-2 (đối chiếu 1-1 theo số).
2. **Quét bước.** Mỗi bước code có chữ ký, tệp và giá trị (hằng: `HAN_DANH_SACH_DUNG_KHAN_CAP_MS` 3000, `TRAN_MAY_DUNG_KHAN_CAP` 200, `MC_ERRCODE_QUA_HAN_GOI`, `HAN_GHI_SO_STOP_HMI_MS` 500, `TRAN_HANG_AUDIT_MOT_LO` 500, `HAN_LENH_REDIS_GIOI_HAN_MS` 250). Không có thân hàm ngoài test. SQL bool mô tả bằng luật (hằng chính viết ở T2, báo cáo ghim từng byte). Tên ở T14–T15 đọc lại sau gộp (ghi rõ ở Step 0), không phải chỗ trống.
3. **Nhất quán kiểu.** Tên dùng chung định nghĩa một lần, dùng lại đúng tên: `boolTuGiaTri` / `boolGhi` / `giaiMaBoolDoc` (T2 → T3 qua giải mã đọc, T6 qua so đọc lại bool); `laMauBadThuVien` (T3 → T4); `phanLoaiLoiDocMc` (T4); `laMauTrungTinh`, `MA_CAU_HINH_KHONG_GUI` (T5); `readbackMatches(..., thangDo)` (T6); `datCheDoTatTienTrinh`, `stopOt({ tatTienTrinh })` (T8); `MODULE_DUONG_STOP_HMI`, `lamAmDuongStopHmi` (T9 — quét `context.ts` chỉ đọc; T15 sửa `context.ts` sau gộp); `khoaDichLuatTx` (T10); `xauChuoiAudit`, `recordAuditEvents` (T11); `MAU_MA_TEST_SQL`, `timMucTieu`, `kiemMoCoi` (T13); `StoreDuPhongBoNho` (T14); `laGoiCoDungMay` (T15); `MayDungKhanCap`, `mayDungKhanCap`, `KhoiDungKhanCap` (T1).
4. **Review Focus.** Năm dòng, mỗi dòng có test trong task sở hữu: T1 (operator / viewer / `cheDo.danhSach`), T2 (bảy giá trị trên coil), T3 (`"BAD 12"` hai cờ), T4 (4300 ms hai mã), T6 (scale 0,1 và 0,5).
5. **Tỷ lệ.** Kế hoạch nêu quyết định, chữ ký, giá trị và test; khối code chỉ là test.

**Câu hỏi chỉ điều phối trả lời được — kèm khuyến nghị:**
- **Q1 (T1).** Tập miễn cổng STOP thêm phần tử thứ hai `scadaCommands.mayDungKhanCap` (query đọc tối thiểu: máy trong phạm vi mà người gọi được dừng; không endpoint, không giá trị). Không có nó thì trang đổi mật khẩu không biết hiện nút cho máy nào. *Khuyến nghị:* duyệt.
- **Q2 (T2, cổng dừng).** Census tìm thấy luật / FOE / ghim bool có giá trị lạ ⇒ sửa dữ liệu trước hay vẫn bật luật mới? *Khuyến nghị:* dừng, sửa từng hàng về `true` / `false`, rồi mới gộp.
- **Q3 (T2).** Driver ghi chặt cả cho coil Modbus mang tag kiểu int: giá trị `2` lên coil nay bị từ chối (trước: ghi TRUE). *Khuyến nghị:* duyệt (một coil chỉ có 0 / 1).
- **Q4 (T3).** Còn sót: tag string có giá trị thật `"BAD n"` trong cùng lần đọc với một item lỗi khác vẫn bị coi là xấu (fail-closed). *Khuyến nghị:* chấp nhận, ghi giới hạn.
- **Q5 (T5).** Phiên mà mọi tag sai cấu hình CỤC BỘ ở `connecting` mãi (không `connected`, không `lost`, không vòng nối lại). *Khuyến nghị:* duyệt.
- **Q6 (T8).** Tắt tiến trình không ghi `disabled` ⇒ DB giữ trạng thái cuối (có thể `connected`) tới khi tiến trình mới khởi động và báo `connecting`. *Khuyến nghị:* duyệt (trạng thái `disabled` dành cho adapter bị tắt thật).
- **Q7 (T9).** Ghi sổ trên đường trả lời của STOP bị bọc hạn 500 ms bằng `await` có hạn (không fire-and-forget): DB nhanh ⇒ không đổi gì; DB chậm ⇒ câu trả lời trễ ≤ 500 ms mỗi lượt, lượt ghi vẫn chạy nền. *Khuyến nghị:* duyệt.
- **Q8 (T11).** Khai mức hàng loạt chuyển sang một `UPDATE … FROM VALUES` + một `INSERT` audit nhiều hàng; nội dung audit không đổi. *Khuyến nghị:* duyệt.
- **Q9 (T14).** Trần dự phòng khi Redis sập tính THEO TIẾN TRÌNH (N bản API ⇒ N × 600 / phút / phiên); `commandTimeout` 250 ms áp cho client Redis dùng chung của MỌI bộ giới hạn. *Khuyến nghị:* duyệt cả hai.
- **Q10 (T15).** G4: bọc hạn (không từ chối) — cả batch có `dungMay` chịu hạn tổng 2,5 s. *Khuyến nghị:* bọc hạn (STOP không bao giờ bị chặn vì hình dạng request).
- **Q11 (T16).** Chạy bench B1 trên một coil OpenPLC? *Khuyến nghị:* có, sau khi đo commit trống, chỉ khi điều phối OK ngay lúc đó.
- **Q12 (R1b-2b-2).** R1b-1 §10 mục 22 (STOP do hệ thống khởi phát ghi mọi ghim) cần quyết định sản phẩm trước khi lập task: lọc theo luật `phanLoaiGhimStopHmi` hay giữ ghi mọi ghim? *Khuyến nghị:* lọc theo cùng luật (một luật STOP cho mọi nguồn), sau khi §4 mục 2c R1b-1 đã dọn ghim cũ.
