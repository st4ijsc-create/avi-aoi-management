# SCADA R1b-2a · An toàn, đúng đắn và nợ R1b-1 — Kế hoạch thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đóng những gì phải đóng TRƯỚC khi chủ dự án cân nhắc bật `AI_OT_CONTROL_ENABLED`:
- khai mức tác động hàng loạt: một TOTP tươi cho N ≤ 200 tag, audit từng tag, kiểm nhất quán từng tag;
- `dispatch()` không làm tròn im lặng và không ghi số vô nghĩa (NaN / Infinity / chữ) lên BẤT KỲ tag int nào;
- bộ đề xuất SPI của AI thị giác không tự tạo giá trị lệch lưới;
- STOP HMI có hạn thật trước khi gửi, có trần rộng theo NGƯỜI thay cho miễn tuyệt đối, và bộ giới hạn không bị cookie rác làm ngập log;
- cấu hình tag được bảo vệ: mọi cột ảnh hưởng an toàn đều cần TOTP, phạm vi kiểm dưới khoá, thứ tự khoá một chiều;
- trạng thái "chưa khoẻ" luôn nhìn thấy được: `/health` lúc đang kiểm và khi thiếu FK của 0433; posture `interlockRulesCauHinhHong` trên client;
- dọn phần còn lại của sổ R1b-1 và kiem-dinh.

**Architecture:**
- **Không thêm đường ghi.** Mọi lệnh tới thiết bị vẫn qua `dispatch()` (`server/services/ot/commandDispatcher.ts`).
- **Một luật lưới cho mọi bên.** `kenhScada.ts` là chủ duy nhất của luật ép kiểu, dải, bước, lưới thô:
  - HMI, dispatch, posture, ghim DỪNG và cấu hình interlock đều gọi nó;
  - truy vấn SQL trước triển khai (bản của R1b-1 sau sửa N-1) chỉ được báo DƯ so với nó, không bao giờ báo thiếu.
- **Khai mức hàng loạt là thủ tục mới `scadaKenh.khaiHangLoat`.** Nó dùng chung phép kiểm từng tag với `scadaKenh.capNhat`; phép kiểm được rút ra một module thuần, không đổi hành vi `capNhat`.
- **Không migration.** Mọi việc dùng cột có sẵn (0431/0433). Xem Global Constraints về dải số.
- Phần còn lại là sửa tại chỗ, mỗi sửa có test và đột biến.

**Tech Stack:** TypeScript, tRPC 11, express-rate-limit 8, drizzle + Postgres, React, vitest (+ DB `_test`), OpenPLC bench (chỉ khi điều phối cho phép).

**Spec (thứ tự ưu tiên khi mâu thuẫn):**
1. Báo cáo đã duyệt `docs/superpowers/specs/2026-10-23-scada-thiet-ke-he-sinh-thai.html`: D3, D5 (mức 5 ⇒ TOTP mỗi lần), D8, D9, D11, §4.5–4.6; bản phân tích `2026-10-23-scada-phan-tich-chi-tiet.md` C.5 (thang mức tác động, NULL ⇒ 5).
2. Kế hoạch R1b-1 `docs/superpowers/plans/2026-10-24-scada-r1b-an-toan-va-no.md`, mục "Tách R1b — ĐÃ DUYỆT" (nội dung R1b-2).
3. Báo cáo nghiệm thu R1b-1 `docs/superpowers/plans/2026-10-24-scada-r1b-1-bao-cao-nghiem-thu.md`: §6 giới hạn, §7 checklist (P1-1), §10 backlog R1b-2 mục 1–13.
4. Báo cáo nghiệm thu R1a §8 (mục chưa đóng).
5. Sổ R1b-1 (`D:\SOURCES\_scada_wt\.superpowers\sdd\2026-10-24-scada-r1b-an-toan-va-no\progress.md`), rà soát cuối (`final-review.md`, `final-rereview.md`: N-2, M-1, M-3), và các mục phụ của kiem-dinh (`kiemdinh-minors.md`: M1, M2, M3, M4, M5, M7, bộ giới hạn).
6. Quyết định điều phối 2026-10-25:
   - danh sách bắt buộc;
   - tách R1b-2a / R1b-2b;
   - ràng buộc AI_OT_CONTROL, không nạp chương trình;
   - dải migration;
   - cập nhật sau kiem-dinh: thêm M1/M2/M3/M4/M5/M7 + trần theo người; bỏ N-1, CLI import (I2), M6 vì R1b-1 sửa.

**Phụ thuộc:** nhánh `feat/scada-r1b2` tạo từ `feat/scada-r1b` @ `abcd3ea58` (R1b-1 + main `dba990c69`).
- **Vòng sửa kiem-dinh của R1b-1 đang chạy trên `feat/scada-r1b`.** Merge vòng đó vào `feat/scada-r1b2` TRƯỚC Task 1 (hoặc ở điểm dừng gần nhất nếu chưa xong), rồi chạy lại mọi census. R1b-2a XÂY TRÊN các thay đổi sau của vòng ấy:
  - truy vấn trước triển khai `TRUY_VAN_TRUOC_TRIEN_KHAI` trả hàng "KHÔNG PARSE ĐƯỢC" (N-1);
  - CLI `mappings-import.mjs --apply` từ chối tag được bảo vệ (I2);
  - `tags.update` / `tags.delete` trả cùng một NOT_FOUND cho "không tồn tại" và "ngoài phạm vi" (M6);
  - `setStopPin` đòi vai ≥ engineer + TOTP;
  - `dungMay` chỉ gửi ghim của tag có `actuationLevel ≤ 1`;
  - token duyệt luật interlock gồm băm định nghĩa của tag nguồn / đích (address, kiểu, scale / offset, adapterId, `edgeNodeId` của adapter).
- **Task nào chạm các điểm trên phải đọc mã SAU merge.** Số dòng trong kế hoạch này là của `abcd3ea58`.
- R1b-2a chỉ gộp main SAU KHI R1b-1 đã qua kiem-dinh và đã gộp.

---

## Tách R1b-2 — quyết định

Giữ cách tách điều phối đã duyệt, với một điều chỉnh.

| Phần | Nội dung | Cổng |
|---|---|---|
| **R1b-2a · An toàn + đúng đắn + nợ** (kế hoạch này, 15 task) | Khai mức hàng loạt; Q-T13 (b) + SPI; kiem-dinh M1 / M2 / M3 / M4 / M5 / M7; trần theo người cho STOP HMI (thay miễn tuyệt đối, gộp vé thu hồi) + N-2; posture client; `/health` đang kiểm; hạn STOP HMI (§10 mục 11); wizard TOTP (mục 12); `datStopPin` (m4); HMI ↔ dispatch int scale 0,5 (m5); T8 người thắng bị khoá; T7 canh 0433 + tổng kết `DIEU_TIET`; T3 đọc tốt đường push; dọn `_test`; ScadaDiag hai hộp. | Ma trận ô opt-in xanh 3 lượt; mỗi sửa có đột biến đỏ. Là ĐIỀU KIỆN CẦN cho `AI_OT_CONTROL_ENABLED`, không phải lệnh bật. |
| **R1b-2b · Nhật ký + UI + driver** (kế hoạch riêng) | Xem mục cuối "Danh sách R1b-2b". | Danh sách 1-1, mỗi mục có test hoặc số đo. |

**Điều chỉnh (một đoạn):** trong "phần dư T3/T4", R1b-2a chỉ giữ một mục: đường push đếm "đọc tốt" theo "máy chủ đã trả lời", vì mục này quyết định "connected" có nói thật không. Năm mục còn lại chuyển sang R1b-2b:
- nạp bộ đệm sống khi DB treo;
- thử lại lô mẫu xấu bị bỏ;
- watchdog thừa mẫu cho đường push;
- kế toán mất liên lạc khi reset HA;
- ghi trong lúc phiên chờ đọc tốt đầu tiên.

Lý do:
- năm mục này đều đã fail-closed hôm nay (bộ đệm cũ ⇒ interlock chặn, máy LOCAL), nên chúng là việc tính sẵn sàng, không phải lỗ an toàn;
- chúng cần luồn tham số qua `TuyChonVongPoll` (`otDriver.ts:119`) và cả 7 driver dùng `taoVongPoll`, và cần đo lại trên bench;
- chúng cùng lớp với việc driver của R1b-2b (EIP / SLMP / C6 / OPC UA).

**Đã bỏ khỏi R1b-2a theo điều phối (R1b-1 sửa trong vòng kiem-dinh):** N-1 (truy vấn trước triển khai), I2 (CLI import), M6 (NOT_FOUND đồng nhất).

## ĐÃ DUYỆT — điều phối 2026-10-25 (ràng buộc thêm, có hiệu lực như Global Constraints)

- **Thời điểm thực thi:** chỉ sau khi vòng sửa kiểm định R1b-1 được kiem-dinh kết luận ĐẠT và điều phối đã gộp. Bước 0 giữ nguyên.
- **Câu hỏi:** Q1 có · Q2 duyệt · Q3 duyệt (hằng số trong mã) · Q5 duyệt · Q6 duyệt · Q7 có · Q9 duyệt.
- **T6 `STOP_PIN_GO_TRUOC` khi nâng mức tag đang ghim: DUYỆT.** Một tag đang ghim bị nâng mức mà âm thầm rớt khỏi STOP là lỗi an toàn.
- **Q4 duyệt, kèm điều kiện (Task 4):**
  - Từ chối do hạn chót phải ghi `command_log` và audit với MÃ RIÊNG, và được đếm vào posture.
  - UI hiện thông điệp "dùng E-STOP cứng" NỔI BẬT: hộp hoặc băng đỏ cố định, KHÔNG phải toast thường.
  - Một khi `dispatch()` đã bắt đầu thì không bao giờ trả "từ chối" vì hạn chót. Hạn chót chỉ bọc pha TRƯỚC dispatch.
  - Test cho cả ba điều trên, mỗi điều có đột biến.
- **Q8 duyệt, kèm điều kiện (Task 10):**
  - Chỉ hoàn lượt khi CÙNG `userId` VÀ CÙNG mã đã tiêu trong 10 s. Mọi mã khác vẫn đếm.
  - Test "phát lại mã đã tiêu 20 lần ⇒ không khoá, không ghi".
  - Test "mã sai xen kẽ vẫn khoá".
- **Q10 có:** bench T15 chỉ chạy khi điều phối OK ngay tại thời điểm đó, sau khi đo commit còn trống. Không chạm :8091.
- **T14 dọn `_test` — chốt cứng:**
  - Từ chối nếu `current_database()` không kết thúc bằng `_test`. Test có ca đổi tên DB ⇒ từ chối.
  - Mặc định dry-run.
  - KHÔNG BAO GIỜ chạy trên DEV (bảng WORM).
- **Migration:** R1b-2a không có migration. Giữ 0434 cho vòng sửa R1b-1 nếu cần; SQL gửi điều phối trước khi áp DEV.
- **Bổ sung Task 12 (điều phối 2026-10-25): lọc phạm vi nhà máy cho `oversight.posture`.**
  - Hiện trạng: đây là thủ tục ĐỌC chưa lọc phạm vi; nó có tên trong sổ nợ đọc, nhóm A (`phamViDocBaseline.ts`).
  - Việc phải làm:
    - Lọc mọi số đếm posture theo adapter / máy nằm trong phạm vi của người gọi, dùng `adapterTrongPhamVi` / `idsTrongPhamVi("machine", phamViCua(ctx), { strict: true })`. Danh tính lấy từ `ctx`, không bao giờ từ input. Admin hoặc phạm vi toàn quyền thấy toàn bộ.
    - Áp lọc cho cả số đếm mới `interlockRulesCauHinhHong`, gồm luật lệch lưới.
  - Test DB hai chiều A/B: người dùng nhà máy A không thấy luật / adapter của B; admin thấy cả hai. Mỗi test có đột biến bỏ lọc ⇒ đỏ.
  - Gỡ dòng sổ nợ đọc của `oversight.posture`, rồi đo lại ghim `phamViDocCensus` trên cây hiện tại và ghi lý do có ngày.
  - luong-ui sẽ không đụng thủ tục này.

## Global Constraints

- **Nơi làm và nhánh.**
  - Làm trong worktree `D:\SOURCES\_scada_r1a_wt`, nhánh `feat/scada-r1b2`.
  - **Không** sửa nhánh `feat/scada-r1b`, worktree `D:\SOURCES\_scada_wt`, hay cây chính `D:\SOURCES\avi-aoi-management`.
  - **Không push.** Chỉ merge (vòng sửa kiem-dinh của R1b-1, hoặc main) ở điểm dừng giữa hai task.
- **Commit.** Commit bằng pathspec: `git add <tệp…>` rồi `git commit -m "…" -- <tệp…>` (hook BG-124 chặn commit trần). Cuối message có một dòng trống rồi `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **`AI_OT_CONTROL_ENABLED` (điều phối 2026-10-25).**
  - Cờ GIỮ TẮT. KHÔNG task nào bật nó, kể cả trong cấu hình, giá trị mặc định, tài liệu, script hay `.env.example`.
  - Chỉ được đặt trong tiến trình test (vitest) như trước (D9). Lưới nghiệm thu và bench đặt nó `"false"` như `r1bNghiemThu.db.test.ts:364` / `scripts/scada-r1b-bench.ts:312`.
  - R1b-2a là ĐIỀU KIỆN CẦN. Bật cờ là quyết định của chủ dự án sau một rà soát độc lập riêng. Báo cáo nghiệm thu không được viết câu nào ngụ ý "đã sẵn sàng bật".
- **Không nạp gì xuống thiết bị (điều phối 2026-10-25).** Không tải chương trình PLC, không firmware. Bench chỉ đọc / ghi thanh ghi `holding` như R1b-1.
- **Migration — dải cấp 0434–0436.**
  - **0434 GIỮ cho vòng sửa kiem-dinh của R1b-1** nếu vòng đó cần một cột. R1b-2a đánh số từ **0435** (rồi 0436).
  - 0437–0439 giữ cho R1b-2b / R1c. 0423–0429 thuộc phiên khác: **không bao giờ dùng**.
  - Kế hoạch này **không cần migration**. Nếu một task phát hiện cần schema: viết tay theo khuôn `scripts/apply-migration-0433.mjs`, idempotent (`IF NOT EXISTS` / `duplicate_object`). DDL bằng owner `aoi`, verify bằng `avi_app`, có `has_table_privilege`.
  - Task có migration PHẢI có bước: gửi SQL cho điều phối duyệt TRƯỚC khi áp DEV. Áp TEST (`--test-only`) thoải mái. DEV chỉ sau khi điều phối trả lời "áp".
  - Cần hơn 2 migration ⇒ dừng, báo điều phối.
  - Không sửa `drizzle/meta/_journal.json`.
- **Cờ và hằng.**
  - Không cờ mới và không biến môi trường mới. Trần / hạn mới là hằng có tên trong mã.
  - `OT_CONTROL_ENABLED` chỉ bật trong tiến trình test / bench (D9).
  - **Không sửa `.env`.**
- **Đường ghi.** Mọi lệnh tới thiết bị qua `dispatch()`. Mọi từ chối trong dispatch qua `writeRejected`. STOP khớp ghim KHÔNG BAO GIỜ bị phần mềm chặn ở cổng chế độ / khoá chọn / dải / bước / lưới.
- **Danh tính.** Không bao giờ lấy danh tính từ input. Người gọi luôn là `ctx.user`.
- **Phạm vi.**
  - Thủ tục nhận `adapterId` / `machineId` / `tagId` kiểm phạm vi máy (`idsTrongPhamVi("machine", phamViCua(ctx), {strict:true})` / `_adapterPhamVi.ts`).
  - Thủ tục có giao dịch kiểm LẠI dưới khoá adapter (Task 5).
  - "Không thấy" và "ngoài phạm vi" trả CÙNG một lỗi.
- **Thứ tự khoá dự án:**
  - ADAPTER (FOR SHARE / UPDATE) → LUẬT (FOR SHARE, theo id) → TAG (FOR UPDATE, **ORDER BY id** — Task 5 thống nhất) → KÊNH CHẾ ĐỘ (`troLaiKenh.ts`).
  - Không đường mới nào được khoá ngược.
  - Không đường mới nào được gọi DB qua pool trong giao dịch, trừ bộ đếm TOTP có hạn (Task 5).
- **TOTP cấu hình.**
  - Mức 5 qua `kiemTotpCauHinh(ctx, totpCode)` (`server/services/scada/totpCauHinh.ts:33`).
  - Đặt CUỐI, ngay trước lượt ghi, sau mọi kiểm hợp lệ / nhất quán, để một lượt bị từ chối không tiêu mã.
  - `totpCode` bị tách khỏi patch / audit trước khi ghi.
- **Census.** Thủ tục tRPC mới:
  - nâng GHIM (đo, không đoán) ở `phamViDocCensus` / `congGiayPhepAiCensus` / `phamViGhiCensus`, kèm ghi chú có ngày;
  - xếp đúng nhóm `trpcGioiHanThuTuc` (+ census);
  - client có ô mã ⇒ `client/src/lib/vramPanelStepUp.unit.test.ts` `KHOA_TOTP_TRONG_HANDLER`;
  - `moduleAccessMap.ts`.
- **Mã lỗi.** Mọi mã từ chối mới:
  - vào `server/_core/appErrorCodes.ts`;
  - có `errors.<CODE>` ở `client/src/i18n/locales/{vi,en,zh}.json`, placeholder khớp params (`appErrorCoverage` / `appErrorParamsCoverage` xanh);
  - `npm run i18n:check` sạch.
- **Test.**
  - Test DB: `npx vitest run -c vitest.db.config.ts <tệp>`.
  - Người dùng test tạo bằng `taoNguoiDungTest`.
  - Mock module dùng `importOriginal`.
  - Test hai trục thời gian thật phải có cờ opt-in.
- **Mỗi task.** Test đỏ đúng chỗ → mã → xanh → **đột biến ghi trong task làm đỏ ≥ 1 test** (chạy, ghi vào commit, hoàn tác, `git diff` rỗng) → commit.
- **Đo DEV.** Người thực thi chỉ chạy trên `_test`. Truy vấn chỉ đọc trên DEV do bộ điều khiển chạy (`SET default_transaction_read_only = on`).
- **Tệp và màu.** Không xoá tệp. Không đổi tên công khai đang có người gọi. Màu chỉ dùng token ISA / token sẵn có của trang. Trạng thái lệnh không dùng màu cảnh báo.

## Review Focus

1. **Một tag hỏng trong lô 200 của khai mức hàng loạt** ⇒ cả lô bị từ chối, không hàng nào đổi, mã TOTP KHÔNG bị tiêu, lỗi nêu đúng `tagId`. Lô nâng mức một tag đang ghim DỪNG từ 1 lên 3 (tag sẽ rơi khỏi STOP HMI) ⇒ từ chối "gỡ ghim trước". Test ở Task 6.
2. **Người vận hành đăng nhập hợp lệ bấm STOP liên tục** ⇒ không bao giờ 429 dưới 600 lần / phút. Vé đã thu hồi nhưng còn hạn ⇒ bị chặn ở 600 / phút theo người, không còn vô hạn. Cookie rác ⇒ đếm như mọi `/api`, không in một dòng log nào mỗi yêu cầu. Test ở Task 3.
3. **`commandValue` hoặc lệnh AI là `"abc"`, `NaN`, `Infinity`, `{}`, `[25]`, `2.5` trên tag int chưa khai (scale 1 hay 10)** ⇒ `dispatch()` từ chối có mã. Truy vấn trước triển khai liệt kê mọi luật mà hàm JS từ chối (báo dư được, thiếu thì không). Test ở Task 1.
4. **AI thị giác đề xuất hiệu chỉnh SPI cho tag int µm (scale 1) với giá trị tính ra −7,26** ⇒ đề xuất mang −7, và chính đề xuất ấy qua cổng kênh của `dispatch()` không bị `OFF_STEP`. Hiệu chỉnh làm tròn về 0 trên cả hai trục ⇒ không đề xuất. Test ở Task 1.
5. **DB chậm-mà-sống khi người vận hành bấm DỪNG MÁY** ⇒ trong ≤ 2,5 s nhận từ chối có mã với câu "dùng E-STOP cứng", `dispatch()` không được gọi. DB nhanh ⇒ STOP đi như R1b-1. Test ở Task 4.

---

### Task 1: Một luật cho giá trị ghi lên tag int — Q-T13 (b) + kiem-dinh M1 + M2 + bộ đề xuất SPI theo lưới tag

Điều phối 2026-10-25: Q-T13 (b) và SPI cùng một task. M1 / M2 sửa CHÍNH hàm này nên gộp vào.

**Files:**
- Modify:
  - `server/services/scada/kenhScada.ts`: `kiemLuoiTho` :169-195 (bỏ lối tắt `s === 1 && o === 0`; dung sai ở KHÔNG GIAN THÔ; |thô| ≥ 2^53 ⇒ từ chối); `canKiemLuoiThoChuaKhai` :210-214; `kiemLuoiThoChuaKhai` :222-232 (không hữu hạn ⇒ `TYPE_MISMATCH`).
  - `server/services/ot/commandDispatcher.ts`: chỉ JSDoc `congKenhSom` :883-910.
  - `server/services/scada/lenhInterlockLechLuoi.ts` (bản SAU merge vòng sửa R1b-1):
    - `dieuKienUngVienLenhLechLuoi` :31-38 bỏ vế scale / offset;
    - `TRUY_VAN_TRUOC_TRIEN_KHAI`: ứng viên mọi đích int; phép so ở không gian thô; |thô| ≥ 2^53 ⇒ báo; mọi giá trị JS từ chối mà SQL không tính được ⇒ hàng "KHÔNG PARSE ĐƯỢC";
    - header.
  - `server/services/qualityControlProposer.ts`: `SpiOffsetOptions` :111-121, `computeSpiPrinterOffset` :160-210, `BuildProposalsInput` :216-231, `buildControlProposals` :312-345, `proposeControlFromVerdict` :402-460.
  - `server/services/aiLocalTools/writeHandlers/visionControl.ts`: thêm `export` cho `adapterIdForMachine` :134 và `SPI_OFFSET_X_TAG` / `SPI_OFFSET_Y_TAG` :302-303.
- Test:
  - `server/services/scada/kenhScada.test.ts` (khối R1b-2a T1);
  - `server/services/ot/commandDispatcher.kenh.r1a.db.test.ts`;
  - mới `server/services/scada/lenhInterlockLechLuoi.r1b2.db.test.ts`;
  - `server/services/qualityControlProposer.test.ts`;
  - mới `server/services/qualityControlProposer.luoi.r1b2.db.test.ts`;
  - `server/routers/interlockRouter.r1b.db.test.ts` §5.

**Interfaces:**
- Consumes: `congKenhSom`, `luatLenhLechLuoi(d, them?)`, `kiemLenhInterlockTx` (tự hưởng luật mới), `TRUY_VAN_TRUOC_TRIEN_KHAI` sau R1b-1 N-1.
- Produces:
  - `canKiemLuoiThoChuaKhai(tag)` ⇔ `tag.dataType === "int"` (chữ ký giữ nguyên).
  - `export type LuoiGhiTag = { dataType: string; scale: number | string | null; offset: number | string | null; writeStep?: number | null; writeMin?: number | null }` (`qualityControlProposer.ts`).
  - `export function lamTronTheoLuoiTag(v: number, luoi: LuoiGhiTag | null, roundDp: number, tranTuyetDoi?: number): number`.
  - `BuildProposalsInput.spiLuoi?: { x: LuoiGhiTag | null; y: LuoiGhiTag | null }`.
  - `ProposeControlDeps.layLuoiTagSpi?: (machineId: number) => Promise<{ x: LuoiGhiTag | null; y: LuoiGhiTag | null }>`.

Chốt — luật giá trị cho tag int:
- **Mọi tag int CHƯA khai** (kể cả scale 1 / offset 0) đi pass 2 của `congKenhSom`.
  - `x = Number(v)` không hữu hạn (`"abc"`, `NaN`, `Infinity`, đối tượng, `Symbol`) ⇒ `TYPE_MISMATCH` "giá trị không phải số hữu hạn — tag int không ghi được" (M2; trước đây driver ghi `Math.round(NaN)`).
  - `true` / `false` ⇒ 1 / 0. `[25]` ⇒ 25 (đúng như `Number`).
  - Kiểm ở pass 2 ⇒ STOP khớp ghim (miễn cả lệnh) không bị ảnh hưởng.
- **Lưới thô (`kiemLuoiTho`), mọi tag int có tỉ lệ:**
  - `n = (v − o)/s`;
  - `!Number.isFinite(n) || |n| ≥ 2^53` ⇒ `OUT_OF_RANGE` "số thô vượt miền an toàn" (M1: trước đây coi là ok);
  - `k = Math.round(n)`;
  - lệch ⇔ `|n − k| > 1e-9 + 4·EPSILON·(|n| + (|v| + |o|)/|s|)`, tức so trong không gian thô. Hết lỗ dung sai tuyệt đối khi |scale| rất nhỏ (M1).
  - Scale 1 / offset 0: `goiY = Math.round(x)`, `buoc 1`, `gocLuoi 0`.
  - Tag đã khai: epInt đã chặn số lẻ khi (s, o) = (1, 0); nhánh scale lẻ ở Task 2.
- **Cấu hình interlock / `tags.update` / posture tự áp luật mới** qua `kiemLenhInterlockTrenKenh`.
- **SQL đi theo JS (cùng task — vì ứng viên và lớp giá trị đổi):**
  - ứng viên = mọi luật bật, không `alert`, đích tag int;
  - lệch ⇔ `abs((v − o)/s − round((v − o)/s)) > 1e-9` (numeric chính xác, không gian thô) HOẶC `abs((v − o)/s) >= 2^53`;
  - mọi `commandValue` mà SQL không tính được thành số (chuỗi không thập phân, mảng, đối tượng) ⇒ hàng "KHÔNG PARSE ĐƯỢC";
  - giữ nguyên mọi cột ra mà R1b-1 đã chốt.

Chốt — bộ đề xuất SPI:
- **`lamTronTheoLuoiTag`:**
  - `luoi` int ⇒ `o + Math.round((v − o)/s)·s`, s/o chuẩn hoá như `heSoThangDo` (NULL / 0 ⇒ 1, NULL ⇒ 0), làm sạch bằng `Number(x.toPrecision(15))`;
  - float có `writeStep > 0` ⇒ `base + Math.round((v − base)/step)·step`, `base = writeMin ?? 0`;
  - còn lại, hoặc `luoi === null` ⇒ `roundTo(v, roundDp)` như cũ;
  - `tranTuyetDoi` có mặt và `|kết quả| > tranTuyetDoi` ⇒ lùi MỘT bước lưới về phía 0;
  - −0 ⇒ 0.
- **`computeSpiPrinterOffset`:**
  - nhận thêm `opts.luoiX?` / `opts.luoiY?: LuoiGhiTag | null`;
  - `offsetXUm = lamTronTheoLuoiTag(clX, luoiX ?? null, roundDp, maxStepUm)` (Y tương tự);
  - `mean*` vẫn `roundTo`.
- **`buildControlProposals`:** truyền `input.spiLuoi`. Sau làm tròn mà cả hai trục = 0 ⇒ KHÔNG đề xuất `spi_printer_offset`.
- **`proposeControlFromVerdict`:** có `spiTrend` mà không có `spiLuoi` ⇒ `deps.layLuoiTagSpi ?? layLuoiTagSpiMacDinh`.
  - Mặc định: `adapterIdForMachine(machineId)` (import động, ĐÚNG adapter mà `planSpiPrinterOffset` sẽ ghi), rồi đọc `device_tags` (`dataType, scale, offset, writeStep, writeMin`) của `printer_offset_x` / `printer_offset_y`.
  - Lỗi / không có ⇒ `null` cho trục đó ⇒ `roundDp`; `rationale` thêm "(chưa đọc được lưới tag)". `dispatch()` vẫn là trọng tài cuối.

- [ ] **Step 0: Merge vòng sửa kiem-dinh R1b-1** (xem Phụ thuộc). Đọc `TRUY_VAN_TRUOC_TRIEN_KHAI` mới trước khi sửa.
- [ ] **Step 1: Census + đo TRƯỚC (cổng dừng).**
  - Bên gọi `dispatch()` có thể gửi số không nguyên / không phải số lên tag int scale 1 chưa khai: AI `set_machine_param`, SPI (sửa ở đây), FOE `step.args.writes`, interlock `commandValue`, Sparkplug DCMD (Int64 ⇒ nguyên), adapterFacade (không người gọi), HMI (epInt đã chặn).
  - Đo trên `_test` (chỉ đọc):
    - luật bật, không `alert`, nhắm tag int, `commandValue` không phải số nguyên hữu hạn;
    - write FOE như vậy trên tag int;
    - ghim `stop_value` không nguyên trên tag int.
  - Bộ điều khiển chạy cùng truy vấn trên DEV (chỉ đọc).
  - **Có ≥ 1 hàng ở bất kỳ DB nào ⇒ DỪNG, báo bộ điều khiển kèm bảng; bộ điều khiển báo điều phối trước khi sửa.**
- [ ] **Step 2: Test đỏ.**

```ts
// kenhScada.test.ts — R1b-2a T1
const int1 = { dataType: "int", scale: null, offset: null } as const;
it("int chưa khai scale 1: 2.5 ⇒ OFF_STEP buoc 1 goiY 3; -2.5 ⇒ goiY -2; 3 / true / '7' / [7] ⇒ nguyên vẹn", () => {
  expect(canKiemLuoiThoChuaKhai(int1)).toBe(true);
  expect(kiemLuoiThoChuaKhai(int1, 2.5)).toMatchObject({ ok: false, ma: "OFF_STEP", buoc: 1, gocLuoi: 0, goiY: 3 });
  expect(kiemLuoiThoChuaKhai(int1, -2.5)).toMatchObject({ ok: false, goiY: -2 });
  for (const v of [3, true, "7", [7]]) expect(kiemLuoiThoChuaKhai(int1, v)).toEqual({ ok: true, giaTri: v });
});
it("M2 — không hữu hạn ⇒ TYPE_MISMATCH trên mọi int chưa khai", () => {
  for (const tag of [int1, { dataType: "int", scale: "10", offset: null }])
    for (const v of ["abc", NaN, Infinity, -Infinity, {}, "Infinity"]) expect(kiemLuoiThoChuaKhai(tag, v)).toMatchObject({ ok: false, ma: "TYPE_MISMATCH" });
});
it("M1 — scale rất nhỏ: so ở không gian thô; |thô| ≥ 2^53 ⇒ OUT_OF_RANGE", () => {
  const nho = { dataType: "int", scale: 1e-10, offset: null } as const;
  expect(kiemLuoiThoChuaKhai(nho, 1.5e-10)).toMatchObject({ ok: false, ma: "OFF_STEP" }); // n = 1.5 (bản cũ: ok)
  expect(kiemLuoiThoChuaKhai(nho, 2e-10)).toEqual({ ok: true, giaTri: 2e-10 });
  expect(kiemLuoiThoChuaKhai({ dataType: "int", scale: 1e-9, offset: null }, 1e8)).toMatchObject({ ok: false, ma: "OUT_OF_RANGE" });
});
// qualityControlProposer.test.ts — R1b-2a T1
it("lamTronTheoLuoiTag theo lưới tag", () => {
  expect(lamTronTheoLuoiTag(-7.26, { dataType: "int", scale: 1, offset: 0 }, 1)).toBe(-7);
  expect(lamTronTheoLuoiTag(-7.3, { dataType: "int", scale: "0.5", offset: null }, 1)).toBe(-7.5);
  expect(lamTronTheoLuoiTag(23, { dataType: "int", scale: "10.000000", offset: "0" }, 1)).toBe(20);
  expect(lamTronTheoLuoiTag(-7.26, { dataType: "float", scale: 1, offset: 0, writeStep: 0.5, writeMin: null }, 1)).toBe(-7.5);
  expect(lamTronTheoLuoiTag(-7.26, null, 1)).toBe(-7.3);
  expect(lamTronTheoLuoiTag(50, { dataType: "int", scale: 20, offset: 0 }, 1, 50)).toBe(40);
});
it("hiệu chỉnh tròn về 0 trên cả hai trục ⇒ không đề xuất spi (Review Focus 4)", () => {
  const ps = buildControlProposals({ ...VERDICT_NG, machineId: 7, inspectionId: 1,
    spiTrend: Array(5).fill({ offsetXUm: 6, offsetYUm: 6 }),
    spiLuoi: { x: { dataType: "int", scale: 10, offset: 0 }, y: { dataType: "int", scale: 10, offset: 0 } } });
  expect(ps.map((p) => p.kind)).toEqual(["reject_divert"]);
});
```

  - `commandDispatcher.kenh.r1a.db.test.ts` (dòng chờ AI đã xác nhận như X2 R1b-1; `AI_OT_CONTROL_ENABLED` không đọc ở dispatch):
    - 2,5 lên int chưa khai scale 1 ⇒ `rejected OFF_STEP`, `appError {SCADA_VALUE_OFF_STEP, step 1, goiY 3}`, thiết bị 0 lần;
    - `"abc"` ⇒ `rejected TYPE_MISMATCH`, thiết bị 0;
    - 3 ⇒ driver nhận 3;
    - STOP ghim 2 trên tag ấy ⇒ ok.
  - `lenhInterlockLechLuoi.r1b2.db.test.ts` (Review Focus 3): mỗi giá trị là một luật bật nhắm tag int chưa khai scale 10 VÀ một luật nhắm tag int scale 1.
    - Giá trị: `"0x19"`, `"\t25"`, `"25\u00a0"`, `[25]`, `["25"]`, `{"v":25}`, `"abc"`, `"Infinity"`, `" 25 "`, `25`, `2.5`, `30`, `"30"`, `null`, `true`.
    - Thuộc tính: `idsJsTuChoi ⊆ idsSql`, với `idsJsTuChoi = (await luatLenhLechLuoi(db, them)).map(r => r.id)` và `idsSql` = id từ `sql.unsafe(TRUY_VAN_TRUOC_TRIEN_KHAI)` lọc tiền tố.
    - Tường minh: `{"v":25}` / `"abc"` nay CÓ trong cả hai (M2); `2.5` trên scale 1 có trong cả hai; `30` / `"30"` không ai.
    - Luật scale 1e-10 với `commandValue 1.5e-10` có trong cả hai (M1).
  - `interlockRouter.r1b.db.test.ts` §5: luật bật `commandValue 2.5` nhắm int scale 1 chưa khai ⇒ trong posture; `interlock.enable` ⇒ `INTERLOCK_NGOAI_DAI` (`lyDo OFF_STEP`, `step 1`, `goiY 3`).
  - `qualityControlProposer.luoi.r1b2.db.test.ts`: máy + adapter + `printer_offset_x` (int, scale 1) + `printer_offset_y` (int, scale 10) thật trong `_test`; `VISION_CONTROL_ENABLED=true` chỉ trong tiến trình; `deps.propose` ghi lại.
    - Xu hướng cho −7,26 / −12,6 ⇒ args `offsetXUm === -7`, `offsetYUm === -10`.
    - `congKenhSom("spi_printer_offset", [{tagKey:"printer_offset_x",value:-7},{tagKey:"printer_offset_y",value:-10}], <hàng tag thật>)` ⇒ `ok: true`.
    - Không có tag ⇒ args theo `roundDp` (−7,3) và `rationale` chứa "chưa đọc được lưới tag".
- [ ] **Step 3: Chạy.** Mong đợi: đỏ ở các ca mới.
- [ ] **Step 4: Cài.** Sửa các test ghim hành vi cũ ("scale 1 làm tròn", "'abc' đi nguyên trên int có scale") thành hành vi mới, ghi tên trong commit.
- [ ] **Step 5: Chạy lại** các tệp trên, rồi:
  - `server/services/scada`, `server/services/ot`, `server/routers/interlock*`, `server/routers/oversight*`;
  - `server/services/qualityControlProposer*`, `server/services/adviceContract.proposers.test.ts`, `server/services/aiLocalTools`.
  - Mong đợi: xanh.
- [ ] **Step 6: Đột biến:**
  - trả lại lối tắt `s === 1 && o === 0` ⇒ ca 2,5 đỏ;
  - trả lại dung sai tuyệt đối `1e-9·max(1,|s|)` ⇒ ca 1,5e-10 đỏ;
  - `kiemLuoiThoChuaKhai` cho qua giá trị không hữu hạn ⇒ ca M2 đỏ;
  - SQL bỏ nhánh "KHÔNG PARSE ĐƯỢC" cho đối tượng ⇒ ca `{"v":25}` đỏ;
  - `computeSpiPrinterOffset` bỏ `luoiX` ⇒ ca −7 đỏ.
  - Hoàn tác tất cả.
- [ ] **Step 7: Commit** `fix(ot): mot luat cho gia tri ghi len tag int - OFF_STEP ca scale 1, khong ghi NaN/chu, dung sai o khong gian tho, SQL truoc trien khai theo JS, de xuat SPI theo luoi tag (R1b-2a T1, Q-T13 b, kiem-dinh M1 M2)`.

### Task 2: Lưới thô nhất quán — HMI trên int scale lẻ (m5) và ghim DỪNG trên tag chưa khai (m4)

**Files:**
- Modify:
  - `server/services/scada/kenhScada.ts`: hàm mới `epKieuGiaTri`; `kiemGiaTriGhi` :247-300 dùng nó.
  - `server/services/ot/commandDispatcher.ts`: `epKieuKenh` :878-881 nhận `scale` / `offset`, gọi `epKieuGiaTri`; chỗ gọi :937.
  - `server/services/ot/stopPin.ts` (bản sau merge R1b-1 — `setStopPin` nay cần vai ≥ engineer + TOTP): `datStopPin` :371 dùng `kiemLenhInterlockTrenKenh`; `StopPinLoi("ngoai_dai")` mang `buoc` / `goiY`.
  - `server/routers/deviceAdapterRouter.ts` :115-131 (`step: buoc ?? writeStep`, thêm `goiY`).
  - `client/src/i18n/locales/{vi,en,zh}.json` `errors.STOP_PIN_NGOAI_DAI` (thêm `{{goiY}}` nếu câu cần; giữ placeholder cũ).
- Test:
  - `server/services/scada/kenhScada.test.ts`;
  - `server/services/ot/stopPin.dai.r1a.db.test.ts`;
  - `server/routers/scadaCommandsRouter.request.db.test.ts`.

**Interfaces:**
- Produces: `export function epKieuGiaTri(tag: Pick<KenhGhiThuan, "dataType" | "scale" | "offset">, giaTri: unknown): KetQuaGiaTri`. CHỈ ép kiểu (không dải / bước / lưới):
  - int với (s, o) = (1, 0) ⇒ `epInt` như cũ;
  - int với (s, o) ≠ (1, 0) ⇒ số hữu hạn (`epFloat`), vì giá trị KỸ THUẬT của thanh ghi int scale 0,5 là 2,5;
  - float / bool / string / json như cũ.

Chốt:
- `kiemGiaTriGhi` = `epKieuGiaTri` → dải → bước → `kiemLuoiTho` (luật Task 1). Với int (s, o) ≠ (1, 0), `goiYPhaiNguyen = false`.
- `congKenhSom` pass 1 dùng `epKieuGiaTri` (không kiểm lưới ở pass 1, vì kiểm ở đó sẽ chặn STOP khớp ghim TRƯỚC miễn trừ cả lệnh). Pass 2 không đổi.
- `datStopPin`: `kiemLenhInterlockTrenKenh(tag, v.value)` (đã khai ⇒ `kiemNhatQuanKenh`; chưa khai ⇒ lưới thô Task 1). Chỉ từ chối CẤU HÌNH, không bao giờ một STOP.
- **Giới hạn ghi rõ (R1b-2b):** `validateStopValue` vẫn đòi số nguyên cho ghim trên tag int ⇒ không ghim được 2,5 trên int scale 0,5.

- [ ] **Step 1: Test đỏ.**

```ts
it("int scale 0.5 (đã khai) nhận 2.5; 2.6 ⇒ OFF_STEP buoc 0.5 goiY 2.5; scale 1 vẫn TYPE_MISMATCH", () => {
  const tag = { dataType: "int", writeMin: 0, writeMax: 10, writeStep: null, scale: "0.5", offset: "0" } as const;
  expect(kiemGiaTriGhi(tag, 2.5)).toEqual({ ok: true, giaTri: 2.5 });
  expect(kiemGiaTriGhi(tag, 2.6)).toMatchObject({ ok: false, ma: "OFF_STEP", buoc: 0.5, goiY: 2.5 });
  expect(kiemGiaTriGhi({ ...tag, scale: null, offset: null }, 2.5)).toMatchObject({ ok: false, ma: "TYPE_MISMATCH" });
  expect(epKieuGiaTri(tag, "2.5")).toEqual({ ok: true, giaTri: 2.5 });
});
```

  - `request` 2,5 trên tag int scale 0,5 chưa khai ⇒ được nhận (trước: `SCADA_VALUE_TYPE_MISMATCH`).
  - Dispatch:
    - int scale 0,5 ĐÃ khai, 2,5 ⇒ ok;
    - STOP ghim 3 trên int scale 10 chưa khai ⇒ ok (không bị pass 1 chặn).
  - `datStopPin` (có TOTP như R1b-1 đòi):
    - 25 trên int scale 10 chưa khai ⇒ `StopPinLoi("ngoai_dai")` `{lyDo:"OFF_STEP", buoc:10, goiY:30}`, hàng không đổi;
    - 30 ⇒ ok;
    - qua router ⇒ `STOP_PIN_NGOAI_DAI {step:10, goiY:30}`.
- [ ] **Step 2: Chạy.** Mong đợi: đỏ.
- [ ] **Step 3: Cài.**
- [ ] **Step 4: Chạy lại** + `server/services/ot` + `server/services/scada` + `server/routers/deviceAdapter*` + `server/routers/scadaKenh*` + `client/src/components/scada`. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:**
  - `epKieuGiaTri` trả `epInt` cho mọi int ⇒ ca 2,5 đỏ;
  - `datStopPin` quay về `kiemNhatQuanKenh` ⇒ ca 25 đỏ;
  - `epKieuKenh` dùng `kiemGiaTriGhi` có scale ⇒ ca STOP ghim đỏ.
  - Hoàn tác cả ba.
- [ ] **Step 6: Commit** `fix(scada): HMI va dispatch cung luat cho int scale le (m5) + datStopPin tu choi ghim lech luoi tren tag chua khai (m4) (R1b-2a T2)`.

### Task 3: Bộ giới hạn STOP HMI — trần rộng theo NGƯỜI thay cho miễn tuyệt đối (gộp vé thu hồi) + kiểm chữ ký im lặng (N-2)

Kiem-dinh: vé đã thu hồi nhưng còn hạn vẫn được miễn (kiểm stateless) ⇒ `dungMay` vô hạn, mỗi lượt vẫn qua `createContext` (áp lực pool). Khuyến nghị: trần theo người ~600/phút. Trần theo người giải luôn mục vé thu hồi ⇒ một task, không có tập vé thu hồi.

**Files:**
- Modify:
  - `server/_core/rateLimitConfig.ts`: `laStopHmiCoPhienKy` :248-275, `createApiLimiter` skip :613, factory mới `createHmiStopLimiter`.
  - `server/_core/index.ts` :360-383 (gắn limiter mới TRƯỚC `apiLimiter`, trên `/api/` và `/trpc/`).
  - `server/_core/trpcGioiHanThuTuc.ts` `phienKyHopLe` :132-146.
  - `server/_core/sdk.ts` `verifySession` :423-456.
  - `client/src/lib/trpcLinks.ts` (chú thích).
  - Chú thích + `vi_sao` ở `server/_core/{thuHoiPhien,taiKhoanBiTat,buocDoiMatKhau}MoiBeMat.test.ts` nếu census đòi.
- Test: `server/_core/rateLimitConfig.hmiStop.test.ts`; `server/_core/trpcGioiHanThuTuc.test.ts`.

**Interfaces:**
- Produces:
  - `export const TRAN_STOP_HMI_MOI_PHUT = 600` (hằng, không env).
  - `export function createHmiStopLimiter(): RequestHandler`:
    - `windowMs 60_000`, `max TRAN_STOP_HMI_MOI_PHUT`;
    - `keyGenerator` async ⇒ `"hmistop:u:" + openId` từ `phienKyHopLe`;
    - `skip: async (req) => !(await laStopHmiCoPhienKy(req))`;
    - `passOnStoreError: true`;
    - `storeOption("rl:hmistop:")`;
    - message `{ error: "Too many STOP requests — use the hard E-STOP" }`.
  - `phienKyHopLe(req)` không đổi chữ ký. Nay gọi `sdk.verifySession(token, { imLang: true })`.
  - `sdk.verifySession(cookieValue: string | undefined | null, tuyChon?: { imLang?: boolean }): Promise<{ openId; appId; name } | null>`. `imLang` ⇒ không `console.warn` ở cả hai nhánh lỗi; mặc định như cũ.

Chốt:
- **Mỗi yêu cầu bị ĐÚNG MỘT limiter đếm:**
  - POST `dungMay` không batch + vé ký hợp lệ ⇒ chỉ `hmiStopLimiter` (theo người, 600/phút); `apiLimiter` vẫn `skip` đúng điều kiện này;
  - còn lại (vô danh, cookie rác, sai chữ ký, hết hạn, batch, GET) ⇒ chỉ `apiLimiter` (300/phút theo khoá cũ).
- **Vé thu hồi nhưng còn hạn** ⇒ bị trần 600/phút của CHÍNH người đó (không còn vô hạn). `createContext` vẫn từ chối nó.
- **Một người không bao giờ chạm 600 STOP/phút bằng tay.** Bất biến "STOP của người đăng nhập không bị 429 khi dùng bình thường" giữ.
- **Không tra DB trên đường giới hạn.**
- **Đường `createContext` → `authenticateRequest`** vẫn log như cũ (không `imLang`).

- [ ] **Step 1: Test đỏ.**

```ts
// rateLimitConfig.hmiStop.test.ts — R1b-2a T3
it("200 POST dungMay cookie rác ⇒ 0 dòng 'Session verification failed' từ đường giới hạn (N-2)", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  for (let i = 0; i < 200; i++) await laStopHmiCoPhienKy(reqDungMay(`app_session_id=rac${i}`));
  expect(warn.mock.calls.filter((c) => String(c[0]).includes("Session verification failed"))).toHaveLength(0);
});
it("vé ký hợp lệ: 600 STOP/phút qua, lượt 601 ⇒ 429; người khác cùng IP không bị ảnh hưởng (Review Focus 2)", async () => {
  const app = appVoiHaiLimiter(); // createHmiStopLimiter + createApiLimiter như index.ts, store bộ nhớ
  const a = cookie(await signSession(OPEN_A)), b = cookie(await signSession(OPEN_B));
  expect((await guiNLan(app, a, 600)).every((s) => s !== 429)).toBe(true);
  expect((await guiNLan(app, a, 1))[0]).toBe(429);
  expect((await guiNLan(app, b, 1))[0]).not.toBe(429);
});
it("mỗi yêu cầu bị đúng một limiter đếm", async () => { /* dungMay ký hợp lệ ⇒ bộ đếm rl:api: không tăng; cookie rác ⇒ rl:hmistop: không tăng */ });
```

  - Vé ĐÃ THU HỒI (ký hợp lệ, hàng `user_sessions.isActive=false`) ⇒ vẫn bị trần 600 (không vô hạn).
  - `createContext` với cookie rác vẫn in đúng một dòng warn (hồi quy).
- [ ] **Step 2: Chạy.** Mong đợi: đỏ.
- [ ] **Step 3: Cài + gắn ở `index.ts`.**
- [ ] **Step 4: Chạy lại** + 5 tệp `rateLimitConfig*`, `trpcGioiHanThuTuc*`, ba census `*MoiBeMat`, `server/_core/sdk*`, `trpcLinks*`. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:**
  - `hmiStopLimiter` dùng khoá IP ⇒ ca "người khác cùng IP" đỏ;
  - bỏ `{ imLang: true }` ⇒ ca 200 cookie rác đỏ;
  - `apiLimiter` thôi skip ⇒ ca "đúng một limiter" đỏ.
  - Hoàn tác tất cả.
- [ ] **Step 6: Commit** `fix(auth): STOP HMI tran 600/phut theo nguoi thay cho mien tuyet doi (ve thu hoi khong con vo han) + kiem chu ky im lang (R1b-2a T3, kiem-dinh limiter, N-2)`.

### Task 4: Hạn thật cho pha trước-gửi của STOP HMI (§10 mục 11, M-1)

**Files:**
- Modify:
  - `server/services/scada/lenhHmi.ts`: `dungMayHmi` :1462-1590, `guiStopMotAdapter` :1333-1420 (lượt chèn dòng chờ :1377), union `TuChoiYeuCau` :128-139.
  - `server/_core/context.ts` `createContext` :49-95.
  - `server/routers/scadaCommandsRouter.ts` `loiTuChoiLenh` :58-120.
  - `server/_core/appErrorCodes.ts`, i18n `errors.SCADA_STOP_PRECHECK_TIMEOUT`.
  - `client/src/lib/trpcLinks.ts` (chú thích :48-56).
- Test:
  - mới `server/routers/scadaCommandsRouter.dungMay.hanTruocGui.r1b2.db.test.ts`;
  - mới `server/_core/context.dungMayHan.test.ts`;
  - `client/src/components/scada/DungMay.dom.test.tsx`.

**Interfaces:**
- Produces:
  - `export const HAN_TRUOC_GUI_STOP_HMI_MS = 2000` (`lenhHmi.ts`).
  - `export const HAN_XAC_THUC_STOP_HMI_MS = 1500` (`context.ts`).
  - `export function laGoiChiDungMay(info: unknown): boolean` (`context.ts`, cùng hình `isStopOnlyCall`, path `"scadaCommands.dungMay"`).
  - mã từ chối `{ ma: "STOP_QUA_HAN"; chiTiet: string; pha: "truoc_gui" | "xac_thuc" }`.
  - appCode `SCADA_STOP_PRECHECK_TIMEOUT`, params `{ ma, pha }`, tRPC `TIMEOUT`. Câu vi: "Máy chủ chậm — STOP HMI CHƯA được gửi. Dùng E-STOP cứng tại máy."

Chốt:
- **Ngân sách đo từ đầu `dungMayHmi`** (sau kiểm cờ), phủ: `idsTrongPhamVi`, đọc máy, `kiemCongVaiTro`, đọc adapter, `loadStopPins` (mọi adapter; bản R1b-1 lọc `actuationLevel ≤ 1`), và lượt chèn dòng chờ của từng adapter.
  - Mỗi lượt chờ bọc `withDeadline(p, Math.max(1, conLai), "HMI STOP precheck", { unref: true })`.
- **Hết hạn TRƯỚC khi có adapter nào được gửi** ⇒ `STOP_QUA_HAN pha "truoc_gui"`, một dòng attempts (`.catch`), audit fire-and-forget `ketCuc "QUA_HAN"`. `dispatch()` 0 lần.
- **Hết hạn ở lượt chèn dòng chờ của MỘT adapter** ⇒ adapter đó `{status:"failed", reason:"STOP_QUA_HAN"}`, adapter khác vẫn gửi. Dòng chờ chèn muộn tự hết hạn sau 30 s.
- **`dispatch()` KHÔNG nằm trong ngân sách** (có hạn riêng).
- **`createContext`:** lượt gọi CHỈ gồm `scadaCommands.dungMay` bọc `sdk.authenticateRequest` trong `withDeadline(…, HAN_XAC_THUC_STOP_HMI_MS)`.
  - Quá hạn ⇒ NÉM `appError("TIMEOUT","SCADA_STOP_PRECHECK_TIMEOUT",{ ma:"STOP_QUA_HAN", pha:"xac_thuc" }, …)`. tRPC 11 trả nguyên `TRPCError` của createContext.
  - Lỗi xác thực khác ⇒ như cũ (`user = null`).
  - `robot.consoleStop` không đổi.
- **Truy vấn DB bị bỏ rơi vẫn chạy nền** (không huỷ được). Ghi trong chú thích.

- [ ] **Step 1: Test đỏ.**
  - DB (`OT_CONTROL_ENABLED` trong tiến trình, safety giả OK, máy REMOTE có ghim mức 1; `vi.mock` `../services/ot/stopPin` bằng `importOriginal`, `loadStopPins` chờ 3000 ms):
    - `dungMay` ⇒ `code "TIMEOUT"`, `appCode SCADA_STOP_PRECHECK_TIMEOUT`, `pha "truoc_gui"`;
    - thời gian < 2400 ms;
    - spy `dispatch` 0;
    - attempts +1 `reason_code "STOP_QUA_HAN"` (Review Focus 5).
  - Đối chứng không chậm ⇒ `acked_verified`. Dispatch giả chờ 2,5 s ⇒ vẫn `acked` (không trong ngân sách).
  - Hai adapter, lượt chèn dòng chờ của A chậm 3 s ⇒ A `failed STOP_QUA_HAN`, B `acked_verified`.
  - `context.dungMayHan.test.ts`: `authenticateRequest` giả chờ 5 s + `info.calls=[{path:"scadaCommands.dungMay"}]` ⇒ reject `TIMEOUT` < 1700 ms; `scadaCommands.confirm` ⇒ không bị hạn; batch trộn ⇒ `laGoiChiDungMay` false.
  - DOM: `SCADA_STOP_PRECHECK_TIMEOUT` ⇒ hộp DỪNG hiện câu có "E-STOP cứng" + dòng đỏ token dừng.
- [ ] **Step 2: Chạy.** Mong đợi: đỏ.
- [ ] **Step 3: Cài server + context + i18n + chú thích.**
- [ ] **Step 4: Chạy lại** + `scadaCommandsRouter.dungMay.db.test.ts` + `server/_core/context*` + `trpcLinks*` + `client/src/components/scada`. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:**
  - bỏ bọc hạn quanh `loadStopPins` ⇒ ca 3 s đỏ;
  - đưa `dispatch` vào ngân sách ⇒ ca dispatch 2,5 s đỏ.
  - Hoàn tác cả hai.
- [ ] **Step 6: Commit** `fix(scada): STOP HMI co han that 2 s truoc khi gui + 1,5 s xac thuc - tu choi co ma 'dung E-STOP cung' (R1b-2a T4, M-1)`.

### Task 5: Khoá và phạm vi trong giao dịch cấu hình — kiem-dinh M5 + M7

**Files:**
- Modify:
  - `server/routers/_adapterPhamVi.ts` (hàm mới cạnh `adapterNhinThay` :33).
  - `server/routers/deviceAdapterRouter.ts` (bản sau merge R1b-1 M6): `update` :316-430, `delete` :441-460, `tags.create` :588-650, `tags.update` :655-755, `tags.delete` :760-790.
  - `server/routers/scadaDiagRouter.ts` `tamTat` :346-380.
  - `server/services/ot/mappingAsCode.ts`: `ImportOptions` :635-660; giao dịch :742-760 (khoá tag + uns `ORDER BY id`, kiểm phạm vi dưới khoá).
  - `server/routers/mappingAsCodeRouter.ts` :143-160 (truyền callback phạm vi).
  - `server/services/scada/troLaiKenh.ts` `congAdapterTx` :287-301 (`orderBy(deviceTags.id)` thay cho `tagKey`).
  - `server/services/scada/totpCauHinh.ts` :28-50.
- Test:
  - mới `server/routers/phamViDuoiKhoa.r1b2.db.test.ts`;
  - mới `server/services/scada/thuTuKhoaTag.census.test.ts`;
  - `server/services/scada/totpCauHinh.test.ts` (mới nếu chưa có).

**Interfaces:**
- Produces:
  - `export function kiemPhamViDuoiKhoa(machineIdDaKhoa: number | null | undefined, idsMay: number[] | null, loi: () => TRPCError): void`. Không nhìn thấy (`!adapterNhinThay`) ⇒ ném `loi()`.
    - `idsMay` tính TRƯỚC giao dịch bằng `idsMayTrongPhamVi(ctx)`: không gọi pool trong giao dịch.
    - `loi` = CHÍNH lỗi mà kiểm trước giao dịch của thủ tục đó trả (sau M6 của R1b-1).
  - `ImportOptions.kiemPhamViDuoiKhoa?: (machineIdDaKhoa: number | null) => void`.
  - `export const HAN_TOTP_CAU_HINH_MS = 3000`.
  - `kiemTotpCauHinh(ctx: CtxXacThuc, totpCode: string | undefined, tuyChon?: { hanMs?: number }): Promise<void>`. Quá hạn ⇒ `appError("CONFLICT","OPERATION_FAILED",{ operation:"scadaTotpCauHinh", reason:"scadaKenhThuLai" })` (khoá i18n có sẵn).

Chốt:
- **M5:** mỗi thủ tục trên, NGAY sau khi khoá hàng adapter trong giao dịch (`khoaAdapterTx` hoặc `FOR UPDATE` của chính thủ tục), gọi `kiemPhamViDuoiKhoa(machineIdDaKhoa, idsMay, loi)`. `tags.update` kiểm CẢ adapter cũ lẫn adapter mới.
  - Kiểm trước giao dịch giữ nguyên (đường nhanh, không đổi mã lỗi).
  - `scadaKenh.capNhat` đã đúng (:528-529). `khaiHangLoat` (Task 6) dùng chung hàm này.
- **M7 — thứ tự khoá tag:** mọi lượt khoá NHIỀU hàng `device_tags` `FOR UPDATE` đều `ORDER BY id`: import (`hangKhoa`, và `unsTagMappings` theo id), `congAdapterTx` (đổi từ `tagKey`), `khaiHangLoat` (Task 6). Hai thứ tự khác nhau (id / tagKey) trên cùng tập hàng là đường dẫn tới 40P01.
- **M7 — kết nối thêm của TOTP trong giao dịch:**
  - bộ đếm sai / sổ mã đã dùng CỐ Ý ghi trên kết nối riêng (phải commit kể cả khi giao dịch cấu hình rollback, nếu không đếm sai mất ⇒ dò mã không giới hạn) ⇒ KHÔNG chuyển vào `tx`;
  - thay vào đó bọc `withDeadline(kiemXacThucTheoMuc(...), hanMs ?? HAN_TOTP_CAU_HINH_MS)`. Pool cạn ⇒ CONFLICT "thử lại" trong ≤ 3 s, giao dịch rollback, không treo.
  - Ghi lý do ở đầu `totpCauHinh.ts`.

- [ ] **Step 1: Test đỏ.**
  - `phamViDuoiKhoa.r1b2.db.test.ts`, khuôn chung: kỹ sư phạm vi nhà máy A; adapter thuộc máy A. `vi.mock` hàm kiểm trước giao dịch (`adapterTrongPhamVi` / `adapterCuaTag` / `kiemPhamViYaml`) bằng `importOriginal`: gọi bản thật rồi `UPDATE device_adapters SET "machineId" = <máy nhà máy B>`, mô phỏng đổi máy đồng thời đã commit giữa kiểm và khoá.
  - Rồi gọi `tags.update` / `tags.create` / `tags.delete` / `deviceAdapter.update` / `deviceAdapter.delete` / `scadaDiag.tamTat` / `mappingAsCode.applyImport` ⇒ mỗi thủ tục trả ĐÚNG lỗi NOT_FOUND của nó; hàng không đổi; không audit.
  - `thuTuKhoaTag.census.test.ts`: quét `server/**/*.ts` (không test), mọi chuỗi `.from(deviceTags)` … `.for("update")` không lọc theo một `id` duy nhất phải có `.orderBy(deviceTags.id)`; bản liệt kê vị trí GHIM có ngày.
  - Stress DB: 10 vòng song song `applyImport` + `scadaDiag.tamTat` trên cùng adapter có tag được bảo vệ ⇒ 0 lỗi 40P01 lọt ra (CONFLICT / thành công được phép).
  - `totpCauHinh`: `kiemXacThucTheoMuc` giả treo ⇒ `capNhat` trả CONFLICT `scadaKenhThuLai` trong < 3500 ms, hàng không đổi.
- [ ] **Step 2: Chạy.** Mong đợi: đỏ.
- [ ] **Step 3: Cài.**
- [ ] **Step 4: Chạy lại** + mọi `*census*` + `server/routers/deviceAdapter*` + `server/routers/scadaDiag*` + `server/routers/mappingAsCode*` + `server/services/ot/mappingAsCode*` + `server/routers/scadaKenh*` + `server/_core/totpKhoaSai*`. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:**
  - bỏ `kiemPhamViDuoiKhoa` ở `tags.update` ⇒ ca tương ứng đỏ;
  - `congAdapterTx` quay về `orderBy(tagKey)` ⇒ census đỏ;
  - bỏ hạn TOTP ⇒ ca treo đỏ (quá thời gian).
  - Hoàn tác tất cả.
- [ ] **Step 6: Commit** `fix(scada): kiem pham vi lai duoi khoa adapter, khoa tag ORDER BY id moi noi, han cho TOTP trong giao dich (R1b-2a T5, kiem-dinh M5 M7)`.

### Task 6: Khai mức hàng loạt — máy chủ (`scadaKenh.khaiHangLoat`)

**Files:**
- Create: `server/services/scada/khaiKenh.ts`.
- Modify:
  - `server/routers/scadaKenhRouter.ts`: rút `COT_KENH` :89, `KhaiKenh` / `khaiCua` :91-105, `COT_CONG_KENH`, `patchInput` :118-128 và thân kiểm của `capNhat` :535-616 sang `khaiKenh.ts`; `capNhat` gọi lại; thủ tục mới `khaiHangLoat`.
  - `server/_core/trpcGioiHanThuTuc.ts` :55-63 (`chinhXac` + `"scadaKenh.khaiHangLoat"`).
  - Census: `server/_core/trpcGioiHanThuTuc.census.test.ts`, `server/routers/phamViDocCensus.test.ts`, `server/routers/congGiayPhepAiCensus.test.ts`, `server/routers/phamViGhiCensus.test.ts`, `moduleAccessMap.ts`.
- Test: `server/routers/scadaKenhRouter.db.test.ts` (lưới hồi quy của phần rút); mới `server/routers/scadaKenhRouter.khaiHangLoat.r1b2.db.test.ts`.

**Interfaces:**
- Consumes:
  - `khoaAdapterTx`, `khoaLuatNhamAdapterTx`, `luatCuaTag`, `viPhamInterlock`, `kiemNhatQuanKenh`, `validateStopValue`, `thamSoNgoaiDaiInterlock`;
  - `kiemPhamViDuoiKhoa` (Task 5), `kiemTotpCauHinh` (Task 5), `recordAuditEvent`;
  - `TRAN_KENH_DA_KHAI_MOT_LO = 200` và `loiQuaNhieuKenhDaKhai(n)` (`troLaiKenh.ts:64, :399`), `loiGoGhimTruoc` (`troLaiKenh.ts:370`, mã `STOP_PIN_GO_TRUOC` — hôm nay chưa export: thêm `export`, không đổi thân), `mucTacDongKenh`.
- Produces (`khaiKenh.ts`):
  - `export const COT_KENH`, `export type CotKenh`, `export type KhaiKenh`, `export const COT_CONG_KENH`, `export function khaiCua(t: KhaiKenh): KhaiKenh`, `export const patchKenhInput` (= `patchInput` hiện tại).
  - `export function kiemPatchKenh(tag: DeviceTag, luatNham: ReadonlyArray<LuatNhamTag>, patch: Partial<KhaiKenh>): { truoc: KhaiKenh; sau: KhaiKenh; doi: boolean }`.
    - Ném ĐÚNG các `appError` của `capNhat` hôm nay (`INVALID_VALUE` ×3, `STOP_PIN_NGOAI_DAI`, `INTERLOCK_NGOAI_DAI`), params thêm `tagId`.
    - MỚI: tag đang ghim DỪNG mà `actuationLevel` hiệu lực đi từ ≤ 1 lên > 1 (hoặc NULL) ⇒ `STOP_PIN_GO_TRUOC`. Lý do: R1b-1 `dungMay` chỉ gửi ghim của tag mức ≤ 1, nên đổi mức như vậy sẽ lặng lẽ gỡ tag khỏi STOP HMI; mất STOP phải là thao tác riêng (phán quyết T9 b).
- Produces (router): `scadaKenh.khaiHangLoat` (mutation, `kySuProcedure` + `requirePermission("machine_control","canEdit")`):
  - input `{ adapterId: number; items: Array<{ tagId: number; patch: PatchKenh }> (min 1, max 500); lyDo: string(5..300, trim); totpCode?: string(max 16) }`;
  - output `{ loId: string; soDoi: number; soGiuNguyen: number; ketQua: Array<{ tagId: number; changed: boolean; mucHieuLuc: 1 | 3 | 4 | 5 }> }`.

Chốt:
- **Thứ tự:** kiểm rẻ trước (không DB, không mã):
  - `items.length > 200` ⇒ `loiQuaNhieuKenhDaKhai(n)`;
  - `tagId` trùng ⇒ `INVALID_VALUE {field:"items", reason:"scadaKenhTagTrung", tagId}`;
  - patch rỗng ⇒ `FIELD_REQUIRED {field:"patch", tagId}`.
- **`idsMay` tính trước giao dịch. Một giao dịch:**
  - `khoaAdapterTx(tx,[adapterId])` + `kiemPhamViDuoiKhoa` (không có / ngoài phạm vi ⇒ NOT_FOUND adapter);
  - `khoaLuatNhamAdapterTx(tx, adapterId)`;
  - tag `WHERE id IN (...) ORDER BY id FOR UPDATE`; thiếu, hoặc thuộc adapter khác ⇒ NOT_FOUND deviceTag cho cả lô.
- **Từng tag theo id:** `kiemPatchKenh(tag, luatCuaTag(luat, tag.tagKey), patch)`. Lỗi đầu tiên ⇒ ném (tất-cả-hoặc-không).
- **≥ 1 tag `doi`** ⇒ `kiemTotpCauHinh` MỘT lần, sau mọi kiểm. Rồi mỗi tag đổi: `UPDATE` + audit `scada_kenh_cap_nhat` (`after.loId`). Cộng MỘT audit `scada_kenh_khai_hang_loat` (`entityType "device_adapter"`, `after {loId, soTag, tagIds}`).
- **Không tag nào đổi** ⇒ không mã, không audit.
- **Lỗi khoá:** 40P01 ⇒ `thuLai()`.
- **Không chạm cột trong băm định nghĩa của token duyệt interlock** (address / kiểu / scale / offset / adapterId), nên khai mức không làm mất duyệt luật.

- [ ] **Step 1: Test đỏ (DB, TOTP thật như X1 R1b-1).**
  - 200 tag mức 5 → 3, một mã ⇒ `soDoi 200`; audit +201 (200 cùng `loId` + 1 tổng); `mucHieuLuc 3`.
  - 201 tag ⇒ `QUA_NHIEU_KENH_DA_KHAI`, 0 đổi, mã chưa tiêu.
  - Review Focus 1:
    - lô 200 có #137 đang ghim DỪNG 0 + patch `writeMin: 5` ⇒ `STOP_PIN_NGOAI_DAI {tagId: #137}`; 0 đổi; 0 audit; cùng mã dùng được cho lượt hợp lệ kế tiếp;
    - lô có #42 đang ghim, mức 1 → 3 ⇒ `STOP_PIN_GO_TRUOC {tagId: #42}`; 0 đổi;
    - `capNhat` cùng patch trên #42 ⇒ cùng mã (hàm chung).
  - Luật bật nhắm tag X `commandValue 50`, patch `writeMax: 10` ⇒ `INTERLOCK_NGOAI_DAI {ruleId, tagId}`.
  - Thiếu mã ⇒ `SCADA_CONFIG_TOTP_REQUIRED`. Chưa 2FA ⇒ `SCADA_CONFIG_TOTP_NOT_ENROLLED`.
  - Tag adapter khác ⇒ NOT_FOUND. Ngoài phạm vi ⇒ NOT_FOUND như adapter không tồn tại.
  - Lô không đổi gì ⇒ không đòi mã.
  - Đua: `deviceAdapter.tags.update` trỏ lại #5 song song với lô chứa #5, 10 lượt ⇒ không 40P01 lọt ra.
  - Luật đã duyệt nhắm tag trong lô vẫn còn duyệt sau khai mức (token không đổi).
  - `scadaKenhRouter.db.test.ts` xanh không sửa.
- [ ] **Step 2: Chạy.** Mong đợi: đỏ.
- [ ] **Step 3: Cài + census (GHIM đo) + `moduleAccessMap`.**
- [ ] **Step 4: Chạy lại** + mọi `*census*` + `server/routers/scadaKenh*` + `server/routers/deviceAdapter*` + `server/_core/trpcGioiHanThuTuc*` + `server/routers/interlock*`. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:**
  - gọi `kiemTotpCauHinh` TRƯỚC vòng kiểm ⇒ ca "mã chưa tiêu" đỏ;
  - ghi từng tag ngay trong vòng kiểm ⇒ ca #137 đỏ;
  - bỏ kiểm mức ≤ 1 → > 1 trên tag ghim ⇒ ca #42 đỏ.
  - Hoàn tác tất cả.
- [ ] **Step 6: Commit** `feat(scada): khai muc hang loat - mot TOTP cho <= 200 tag, kiem nhat quan + audit tung tag, tat-ca-hoac-khong, khong lang le go tag khoi STOP HMI (R1b-2a T6, P1-1)`.

### Task 7: Khai mức hàng loạt — giao diện M12

**Files:**
- Create: `client/src/components/scada/HopKhaiHangLoat.tsx`.
- Modify:
  - `client/src/components/scada/BangKenh.tsx` (cột chọn + thanh hành động; `BangKenh` :224);
  - `client/src/pages/ScadaKenh.tsx`;
  - `client/src/i18n/locales/{vi,en,zh}.json` (`scada.kenh.hangLoat.*`);
  - `client/src/lib/vramPanelStepUp.unit.test.ts` :550 (+ `"scadaKenh.khaiHangLoat"`).
- Test: `client/src/pages/ScadaKenh.dom.test.tsx`.

**Interfaces:**
- Consumes: `trpc.scadaKenh.khaiHangLoat` (Task 6), `TruongTotp` / `laLoiMaTotp` / `maTotpDu` (`TruongLyDo.tsx`), `kenhGhiDuoc(h)` (`BangKenh.tsx:222`).
- Produces: `export function HopKhaiHangLoat(props: { adapterId: number; hang: HangKenh[]; onDong: () => void }): JSX.Element`.

Chốt:
- **Cột chọn:** chỉ khi `canAct`, chỉ hàng `kenhGhiDuoc`. Quá 200 ⇒ khoá chọn thêm + chữ `scada.kenh.hangLoat.tran`.
- **Nút** "Khai mức hàng loạt ({{n}})".
- **Hộp:**
  - mức 1 / 3 / 4 / 5 / "Bỏ khai (⇒ 5)", lý do ≥ 5 ký tự, ô mã 6 số hiện sẵn như `HopSuaKenh`;
  - gửi `items = hang.map(h => ({ tagId: h.tagId, patch: { actuationLevel } }))`;
  - chọn mức > 1 khi có hàng đang ghim DỪNG ⇒ dòng nhắc `scada.kenh.hangLoat.ghimNhac` ("Tag đang ghim DỪNG phải ở mức 1 — gỡ ghim trước") trước khi gửi; máy chủ vẫn là trọng tài.
- **Lỗi có `params.tagId`** ⇒ hộp nêu `tagKey` của hàng đó cùng câu i18n. Lỗi mã ⇒ xoá ô mã, giữ hộp.
- **Thành công** ⇒ toast `scada.kenh.hangLoat.daKhai {soDoi, soGiuNguyen}`, bỏ chọn, invalidate `scadaKenh.danhSach`.

- [ ] **Step 1: Test đỏ (DOM).**
  - Chọn 3 hàng, mức 3, lý do, mã ⇒ đúng một `{proc:"khaiHangLoat", vars:{adapterId, items:[3 mục actuationLevel 3], lyDo, totpCode}}`.
  - Hàng chỉ đọc không có ô chọn. Ô thứ 201 bị khoá.
  - Có hàng ghim + mức 3 ⇒ dòng nhắc hiện.
  - Lỗi `STOP_PIN_GO_TRUOC {tagId:102}` ⇒ hộp hiện `speed_sp`.
  - Lỗi `SCADA_CONFIG_TOTP_INVALID` ⇒ ô mã rỗng, hộp còn mở.
- [ ] **Step 2: Chạy.** Mong đợi: đỏ.
- [ ] **Step 3: Cài + i18n.**
- [ ] **Step 4: Chạy lại** + `client/src/components/scada` + `client/src/lib/vramPanelStepUp.unit.test.ts` + `npm run i18n:check`. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:** gửi `items` thiếu hàng cuối ⇒ ca 3 mục đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `feat(scada): M12 khai muc hang loat - chon kenh, mot hop ma TOTP (R1b-2a T7)`.

### Task 8: Cột nhịp của tag được bảo vệ cần TOTP — kiem-dinh M4

Kiem-dinh: `samplingMs` / `deadband` / `unit` sửa được trên tag bảo vệ mà không cần TOTP; nguồn luật trễ tối đa 60 s khi `OT_TAG_DEADBAND_ENABLED` bật.

**Files:**
- Modify:
  - `server/services/scada/troLaiKenh.ts`: `HangTagTroLai` :66-85 thêm `samplingMs` / `deadband` / `unit`; `kiemSuaTag` :496-539; `anhTroLai` :587-597.
  - Bộ nạp hàng của `deviceAdapter.tags.update` (`deviceAdapterRouter.ts` :663-700) và import (`mappingAsCode.ts` :752) chọn thêm ba cột.
- Test: `server/routers/deviceAdapterRouter.troLaiKenh.r1b.db.test.ts`; `server/services/ot/mappingAsCode.stopPin.dot1d.db.test.ts` (hoặc tệp import tương ứng).

**Interfaces:**
- Produces:
  - `export const COT_NHIP_BAO_VE = ["samplingMs", "deadband", "unit"] as const`; `export type CotNhip = (typeof COT_NHIP_BAO_VE)[number]`.
  - `export function cotNhipDoi(cu: Pick<DeviceTag, CotNhip>, patch: Record<string, unknown>): CotNhip[]`. So như đường đọc: NULL ≡ vắng; số so theo `Number`.
  - `KetQuaKiemSua` thêm `doiNhip: CotNhip[]`; `canTotp` thêm vế `baoVe && doiNhip.length > 0`.

Chốt:
- **Không kiểm nhất quán cho cột nhịp** (không ảnh hưởng lưới / ghim / giá trị lệnh). Chỉ thêm TOTP + audit.
- **Audit `AUDIT_TRO_LAI`** mang `nhip: { truoc, sau }` khi `doiNhip` không rỗng.
- **Tag chưa được bảo vệ:** như cũ (không mã).
- **Cột nhịp không thuộc băm định nghĩa của token duyệt interlock** (R1b-1), nên không làm mất duyệt.

- [ ] **Step 1: Test đỏ (DB, TOTP thật):**
  - tag đã khai đổi CHỈ `samplingMs` không mã ⇒ `SCADA_CONFIG_TOTP_REQUIRED`, hàng nguyên;
  - có mã ⇒ ok, audit có `nhip.truoc.samplingMs` / `nhip.sau.samplingMs`;
  - nguồn telemetry của luật đã duyệt đổi `deadband` ⇒ cần mã;
  - kênh chế độ đổi `unit` ⇒ cần mã;
  - tag thường đổi `samplingMs` ⇒ không mã;
  - `samplingMs: null` trên hàng đang NULL ⇒ không đổi, không mã;
  - import đổi `deadband` của tag đã khai không mã ⇒ `SCADA_CONFIG_TOTP_REQUIRED`.
- [ ] **Step 2: Chạy.** Mong đợi: đỏ.
- [ ] **Step 3: Cài.**
- [ ] **Step 4: Chạy lại** + `server/routers/deviceAdapter*` + `server/services/ot/mappingAsCode*` + `server/routers/mappingAsCode*` + `server/services/scada`. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:** bỏ vế `doiNhip` khỏi `canTotp` ⇒ ca `samplingMs` đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `fix(scada): samplingMs/deadband/unit cua tag duoc bao ve can TOTP + audit (R1b-2a T8, kiem-dinh M4)`.

### Task 9: Nhật ký thử lệnh — canh 0433 đầu request / confirm + xả tổng kết `DIEU_TIET` cho người ngừng hẳn

**Files:**
- Modify:
  - `server/_core/kiemSchemaR1a.ts` (thêm `biet0433Thieu()` cạnh `biet0432Thieu` :104);
  - `server/services/scada/lenhHmi.ts`: `yeuCauGhiTag` :526, `xacNhanGhiTag` :829 sau kiểm cờ; `ghiThuLenh` :237-290;
  - `server/services/scada/dieuTietThuLenh.ts` :64-120;
  - `server/routers/scadaCommandsRouter.ts` `loiTuChoiLenh`;
  - `server/_core/appErrorCodes.ts`, i18n `errors.SCADA_SCHEMA_MISSING`.
- Test: `server/services/scada/dieuTietThuLenh.test.ts`; `server/routers/scadaCommandsRouter.request.db.test.ts`, `.confirm.db.test.ts`, `.dungMay.db.test.ts`.

**Interfaces:**
- Produces:
  - `export function biet0433Thieu(): boolean` ⇔ `trangThai.kieu === "da_kiem" && thieu0433.length > 0` (CỘT `ly_do`; FK của Task 12 không tính).
  - mã từ chối `{ ma: "THIEU_MIGRATION"; chiTiet: string; migration: "0433" }` ⇒ `appError("PRECONDITION_FAILED","SCADA_SCHEMA_MISSING",{ ma, migration })`.
  - `nenGhiThuLenh(userId: number, reasonCode: string, now?: number, stage?: "request" | "confirm" | "dispatch" | "huy"): KetQuaDieuTiet`. Tham số 4 mới, mặc định `"request"`; nhớ `stage` của dòng bị gộp cuối.
  - `export function layTongKetHetHan(now?: number): Array<{ userId: number; reasonCode: string; stage: string; soLan: number }>`. Lấy và XOÁ cửa sổ đã hết có `biGop > 0`.
  - `export function batXaTongKet(ghi: (d: { userId; reasonCode; stage; soLan }) => Promise<void>, chuKyMs?: number): void`. Hẹn giờ `unref`, bật lười ở lần `{ghi:false}` đầu, tự dừng khi hết cửa sổ treo, idempotent.

Chốt:
- **Canh 0433:**
  - CHỈ `yeuCauGhiTag` / `xacNhanGhiTag`, không ghi attempts;
  - **KHÔNG BAO GIỜ ở `dungMayHmi`**;
  - `chua_kiem` / `khong_kiem_duoc` ⇒ không canh.
- **Xả tổng kết:** dòng `reason_code "DIEU_TIET"`, `ly_do "N lần {mã} bị gộp"`, `stage` đã nhớ; lỗi chỉ log. Lần gọi kế sau khi đã xả ⇒ không tổng kết thứ hai.

- [ ] **Step 1: Test đỏ.**
  - Đơn vị (đồng hồ giả):
    - 100 `DA_XU_LY` rồi im ⇒ sau 61 000 ms `ghi` đúng một lần `{soLan:70, reasonCode:"DA_XU_LY", stage:"confirm"}`;
    - người đó quay lại ⇒ `{ghi:true}`;
    - hẹn giờ đã dừng.
  - DB:
    - trạng thái thiếu 0433 ⇒ `request` / `confirm` ném `SCADA_SCHEMA_MISSING`, khoá chọn KHÔNG bị lấy, attempts không tăng;
    - `dungMay` cùng trạng thái ⇒ `acked_verified`;
    - confirm `TOTP_CAN` × 40 ⇒ 30 dòng + 1 `DIEU_TIET` sau 61 s không cần lần gọi kế.
- [ ] **Step 2: Chạy.** Mong đợi: đỏ.
- [ ] **Step 3: Cài + i18n.**
- [ ] **Step 4: Chạy lại** + `server/services/scada` + `server/_core/kiemSchemaR1a*` + ba tệp DB scadaCommands. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:**
  - canh 0433 trong `dungMayHmi` ⇒ ca STOP đỏ;
  - `layTongKetHetHan` không xoá cửa sổ ⇒ ca "không tổng kết thứ hai" đỏ.
  - Hoàn tác cả hai.
- [ ] **Step 6: Commit** `fix(scada): canh 0433 dau request/confirm (khong cham STOP) + xa tong ket DIEU_TIET cho nguoi ngung han (R1b-2a T9)`.

### Task 10: Mã dự phòng — người thắng không bị khoá dưới ≥ 10 lượt song song (T8 dư)

**Files:**
- Modify:
  - `server/db/auth.ts`: `verifyBackupCode` :632-645, `tieuMaDuPhongNguyenTu` :663-697 (giữ chữ ký boolean);
  - `server/_core/totpKhoaSai.ts`: `kiemMaDuPhongCoBoDem` :433-463; hàm mới `hoanLuotThu`.
- Test: `server/db/auth.backupDoubleSpend.r1b.db.test.ts`; `server/_core/totpKhoaSai.db.test.ts`.

**Interfaces:**
- Produces:
  - `export const CUA_SO_THUA_DUA_MS = 10_000` (`auth.ts`).
  - `export async function tieuMaDuPhongPhanLoai(userId: number, code: string): Promise<"tieu" | "khong_khop" | "thua_dua">`.
  - `tieuMaDuPhongNguyenTu(userId, code)` = `(await tieuMaDuPhongPhanLoai(userId, code)) === "tieu"`.
  - `export async function hoanLuotThu(userId: number, loai: LoaiBoDem, luotThu: string): Promise<void>`. Một câu: `so_lan_sai = greatest(so_lan_sai − 1, 0)`; `khoa_boi = luotThu` ⇒ xoá `khoa_den` / `khoa_boi`.
  - `kiemMaDuPhongCoBoDem(userId: number, kiem: () => Promise<boolean | "thua_dua">): Promise<boolean>`.

Chốt:
- **`thua_dua`** = khớp hàng chưa dùng mà `UPDATE … RETURNING` 0 hàng, HOẶC không khớp hàng chưa dùng nhưng khớp hàng `isUsed = true` có `usedAt > now() − 10 s`. Đây là phát lại mã vừa tiêu, không phải đoán ⇒ `hoanLuotThu`, trả `false`, không audit khoá.
- **Người thắng** (mã đã tiêu): khoá do lượt khác đặt ⇒ VẪN trả `true` (log warn). Người thắng nằm trong N lượt được kiểm; ném lúc này đốt mã của người dùng.
- **Mã sai thật** ⇒ không đổi.

- [ ] **Step 1: Test đỏ (DB).**

```ts
it("10 lượt SONG SONG verifyBackupCode ĐẦY ĐỦ cùng mã đúng ⇒ 1 true, 9 false, 0 ném, không khoá", async () => {
  const kq = await Promise.allSettled(Array.from({ length: 10 }, () => verifyBackupCode(uid, MA)));
  expect(kq.filter((r) => r.status === "fulfilled" && r.value === true)).toHaveLength(1);
  expect(kq.filter((r) => r.status === "fulfilled" && r.value === false)).toHaveLength(9);
  expect(kq.filter((r) => r.status === "rejected")).toHaveLength(0);
  expect((await docKhoa(uid, "backup")).conLaiMs).toBe(0);
  expect(await soMaDaTieu(uid)).toBe(1);
});
it("10 lượt song song mã SAI ⇒ vẫn khoá (MA_DU_PHONG_TAM_KHOA)", async () => { /* ≥ 1 rejected MA_DU_PHONG_TAM_KHOA; docKhoa > 0 */ });
```

  - Phát lại mã đã tiêu sau 11 s ⇒ `khong_khop` (bị đếm).
- [ ] **Step 2: Chạy.** Mong đợi: đỏ (đo hiện nay: true 0 / false 8 / ném 2).
- [ ] **Step 3: Cài.**
- [ ] **Step 4: Chạy lại** + `server/_core/totpKhoaSai*` + `server/routers/twoFactor*` + B1 `r1bNghiemThu` (opt-in). Mong đợi: xanh.
- [ ] **Step 5: Đột biến:**
  - bỏ `hoanLuotThu` ⇒ ca mã đúng đỏ;
  - coi mọi `false` là `thua_dua` ⇒ ca mã sai đỏ.
  - Hoàn tác cả hai.
- [ ] **Step 6: Commit** `fix(auth): ma du phong - luot thua dua duoc hoan, nguoi thang khong bi khoa duoi >= 10 luot song song (R1b-2a T10)`.

### Task 11: Client — wizard nhập được TOTP (§10 mục 12, M-3) + ScadaDiag một hộp

**Files:**
- Modify:
  - `client/src/components/DeviceOnboardingWizard.tsx` (`createTag` :135-142, gọi :204-214);
  - `client/src/pages/ScadaDiag.tsx` (:87-110, hộp :193-230; bỏ `useHopMaTotpTroLai` khỏi trang này);
  - i18n nếu cần (`scada.diag.dialog.maTotp`).
- Test: mới `client/src/components/DeviceOnboardingWizard.totp.dom.test.tsx`; `client/src/pages/ScadaDiag.dom.test.tsx`.

**Interfaces:**
- Consumes: `useHopMaTotpTroLai<V>(guiLai, dangGui)` → `{ xuLyLoi(e, bien): boolean; daXong(): void; hop: ReactNode }` (`HopMaTotpTroLai.tsx:21`), `laLoiCanMaTotp`, `TruongTotp`, `laLoiMaTotp`, `maTotpDu`.

Chốt:
- **Wizard:**
  - `createTag` onError ⇒ `hopTag.xuLyLoi(e, bien)`; onSuccess ⇒ `hopTag.daXong()`; `bien` = object đã gửi (không `totpCode`);
  - `SCADA_CONFIG_TOTP_NOT_ENROLLED` ⇒ toast i18n như cũ;
  - `enableAdapter` không qua cổng TOTP ⇒ không đổi.
- **ScadaDiag:**
  - MỘT hộp lý do. `tamTat` trả `SCADA_CONFIG_TOTP_REQUIRED` ⇒ cùng hộp hiện `TruongTotp`, giữ lý do;
  - gửi lại `{adapterId, lyDo, totpCode}`;
  - mã sai ⇒ xoá ô mã + toast, hộp còn mở;
  - xong / đóng ⇒ xoá mã khỏi state.

- [ ] **Step 1: Test đỏ (DOM).**
  - Wizard: `tags.create` lần 1 ném `SCADA_CONFIG_TOTP_REQUIRED` ⇒ hộp mã; nhập 6 số ⇒ lần 2 gửi `{…cùng biến, totpCode}`; thành công ⇒ bước 3.
  - ScadaDiag: `tamTat` ném `SCADA_CONFIG_TOTP_REQUIRED` ⇒ `screen.getAllByRole("dialog")` dài **1**, ô mã trong hộp đó, lý do giữ chữ; gửi ⇒ `{adapterId, lyDo:"bảo trì PLC", totpCode:"123456"}`; `SCADA_CONFIG_TOTP_INVALID` ⇒ ô mã rỗng, vẫn 1 hộp.
- [ ] **Step 2: Chạy.** Mong đợi: đỏ.
- [ ] **Step 3: Cài.**
- [ ] **Step 4: Chạy lại** + `client/src/pages/ScadaDiag*` + `client/src/pages/DeviceAdapterManagement*` + `client/src/components/scada` + `npm run i18n:check`. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:**
  - ScadaDiag quay lại hộp mã riêng ⇒ ca "1 dialog" đỏ;
  - wizard bỏ `xuLyLoi` ⇒ ca gửi lại đỏ.
  - Hoàn tác cả hai.
- [ ] **Step 6: Commit** `fix(ui): wizard onboarding nhap duoc TOTP khi tao tag len khoa bao ve + ScadaDiag mot hop ly do/ma (R1b-2a T11)`.

### Task 12: Tín hiệu "chưa khoẻ" — `/health` đang kiểm + FK của 0433 (kiem-dinh M3) + posture `interlockRulesCauHinhHong` trên client

**Files:**
- Modify:
  - `server/_core/kiemSchemaR1a.ts` (`KetQuaSchemaR1a` :50-57, `kiemSchemaR1a` :109-133, `SchemaR1aHealth` :143-145, `lyDoSchemaR1a` :148-164, hàm mới cạnh `lyDoChuaKiemDuocR1a` :172);
  - `server/_core/healthProbes.ts` (:315-321 deps, :355-363);
  - `client/src/pages/EngineeringHub.tsx` (`PostureSection` :313-350);
  - `client/src/pages/InterlockRuleManagement.tsx` (`PostureData` :594-600, chip :621-640, `NoticeStack`);
  - i18n `oversight.posture.cauHinhHong`, `oversight.posture.cauHinhHongCanhBao`, `interlockRules.posture.cauHinhHong`, `interlockRules.posture.cauHinhHongSource`, `interlockRules.posture.cauHinhHongChip`.
- Test: `server/_core/kiemSchemaR1a.test.ts`, `server/_core/kiemSchemaR1a.db.test.ts`, `server/_core/healthProbes.test.ts`, `client/src/pages/EngineeringHub.dom.test.tsx`, `client/src/pages/InterlockRuleManagement.layout.dom.test.tsx`.

**Interfaces:**
- Produces:
  - `export const FK_0433 = Object.freeze(["scada_kenh_che_do_machine_fk", "scada_kenh_che_do_adapter_fk", "scada_khoa_chon_adapter_fk"] as const)`.
  - `KetQuaSchemaR1a.thieu0433Fk: string[]`. Tên FK vắng, hoặc có mà `confdeltype <> 'c'` hoặc `convalidated = false`.
  - `SchemaR1aHealth` thêm `{ ok: false; trangThai: "dang_kiem"; thieuMigration: null; lyDo: "chua_xong" }`.
  - `export function lyDoDangKiemR1a(t?: TrangThaiSchemaR1a): Extract<SchemaR1aHealth, { trangThai: "dang_kiem" }> | null` ⇔ `t.kieu === "chua_kiem"`.
  - `ProbeHandlerDeps.schemaR1aDangKiem?: () => … | null`.

Chốt:
- **M3:**
  - `kiemSchemaR1a` đọc `pg_constraint` (chỉ đọc, cùng truy vấn hình của verify 0433: `conname`, `confdeltype`, `convalidated` trên `scada_kenh_che_do` / `scada_khoa_chon`);
  - `thieu0433Fk` không rỗng ⇒ `lyDoSchemaR1a` liệt kê "0433" (`degraded`, như thiếu cột) + khối `console.error` gọi tên `scripts/apply-migration-0433.mjs`, nhắc mỗi 5 phút;
  - `startOt` vẫn chạy;
  - `biet0433Thieu` (Task 9) KHÔNG tính FK (FK không làm hỏng INSERT).
- **`/health`:**
  - `schemaR1a = thieu ?? chuaKiemDuoc ?? dangKiem`, một khoá, một hình dạng;
  - `status` chỉ `degraded` cho `thieu`; liveness vẫn 200;
  - bộ giám sát coi CÓ MẶT `schemaR1a` là chưa khoẻ.
- **EngineeringHub:**
  - dưới dòng độ phủ thêm `oversight.posture.cauHinhHong` "Luật bật nhưng hỏng cấu hình: {{count}}";
  - `count > 0` ⇒ khối cảnh báo cùng kiểu `writesOnEngineOff` (`border-warning/40 bg-warning/10`), chữ `cauHinhHongCanhBao` + liên kết `/interlock-rules`;
  - degraded ⇒ không hiện số.
- **InterlockRuleManagement:**
  - chip ghim `cauHinhHong` cạnh "Độ phủ": `value = d?.interlockRulesCauHinhHong`, `tone: count > 0 ? "warning" : "default"`, degraded ⇒ `state "error"`;
  - `count > 0` ⇒ một mục `NoticeStack` `kind "error"`.

- [ ] **Step 1: Test đỏ.**
  - `kiemSchemaR1a.test.ts`: `chay` giả trả 2 / 3 FK ⇒ `thieu0433Fk = ["scada_khoa_chon_adapter_fk"]`; FK `confdeltype 'a'` ⇒ cũng thiếu; `lyDoSchemaR1a()` có `thieuMigration` chứa "0433"; `biet0433Thieu()` false khi chỉ thiếu FK.
  - `kiemSchemaR1a.db.test.ts`: trên `_test` thật ⇒ `thieu0433Fk` rỗng.
  - `healthProbes`: `chua_kiem` ⇒ `schemaR1a {ok:false, trangThai:"dang_kiem", thieuMigration:null, lyDo:"chua_xong"}`, `status "ok"`, HTTP 200; đã kiểm đủ ⇒ không khoá; cùng tập khoá với hai nhánh kia.
  - DOM Hub: `interlockRulesCauHinhHong: 2` ⇒ "2" + liên kết `/interlock-rules`; 0 ⇒ không khối; degraded ⇒ không số.
  - DOM Interlock: chip `cauHinhHong` giá trị 2, tông warning; NoticeStack có mục.
- [ ] **Step 2: Chạy.** Mong đợi: đỏ.
- [ ] **Step 3: Cài + i18n.**
- [ ] **Step 4: Chạy lại** + `server/_core/health*` + `server/_core/kiemSchemaR1a*` + hai tệp DOM + `npm run i18n:check`. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:**
  - `lyDoDangKiemR1a` trả null ⇒ ca `dang_kiem` đỏ;
  - bỏ kiểm `confdeltype` ⇒ ca FK `'a'` đỏ;
  - Hub đọc `interlockRulesEnabledWithTarget` ⇒ ca "2" đỏ.
  - Hoàn tác tất cả.
- [ ] **Step 6: Commit** `feat(scada): /health 'dang_kiem' truoc lan kiem dau + kiem 3 FK cua 0433 + posture luat hong cau hinh len EngineeringHub/Interlock (R1b-2a T12, kiem-dinh M3)`.

### Task 13: Đường push đếm "đọc tốt" theo "máy chủ đã trả lời" (T3 dư)

**Files:**
- Modify:
  - `server/services/ot/reconnectNhanh.ts` (cạnh `laDocTot` :80);
  - `server/services/ot/otManager.ts` :266-270;
  - `server/services/ot/connectionSupervisor.ts` :863.
- Test: `server/services/ot/otManager.ketNoiDocTot.r1b.test.ts`.

**Interfaces:**
- Produces: `export function mauMayChuDaTraLoi(s: Pick<OtSample, "quality" | "reason">): boolean` ⇔ `s.quality !== "bad" || (s.reason !== "comm_lost" && s.reason !== "stale")`.

Chốt:
- **Hai chỗ `s.quality === "good"`** (legacy `sinkPhien`, HA `danhDauDocTot`) đổi thành `mauMayChuDaTraLoi(s)`, cùng nghĩa với đường poll (T3 c1).
- **Cờ V2 tắt:** không đổi.

- [ ] **Step 1: Test đỏ:**
  - push cờ V2 bật, mẫu đầu `uncertain` ⇒ `connected`;
  - `bad` + `config_error` ⇒ `connected`;
  - `bad` + `comm_lost` ⇒ vẫn `connecting`;
  - legacy và HA.
- [ ] **Step 2: Chạy.** Mong đợi: đỏ.
- [ ] **Step 3: Cài.**
- [ ] **Step 4: Chạy lại** `server/services/ot` + R0 opt-in (`SCADA_R0_NGHIEM_THU=1`). Mong đợi: xanh.
- [ ] **Step 5: Đột biến:** trả true cho `comm_lost` ⇒ ca `comm_lost` đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `fix(ot): duong push dem doc tot theo 'may chu da tra loi' nhu duong poll (R1b-2a T13)`.

### Task 14: Dọn rác `_test` của R1b-1 T2 (vai owner)

**Files:**
- Create: `scripts/don-rac-test-r1b2.mjs`.
- Modify: `scripts/apply-migration-dot10-common.mjs` (export `asOwner` :41 và hàm mới `testDbUrl()` rút từ :170-180, `runMigration` dùng lại).
- Test: mới `scripts/don-rac-test-r1b2.unit.test.ts`.

**Interfaces:**
- Produces:
  - `export function asOwner(url: string): string`.
  - `export function testDbUrl(): string`. Ném khi pathname không chứa `test`.
  - `export function laDbTest(url: string): boolean` (trong script).

Chốt:
- **Chỉ `_test`, không cờ chọn DEV.** `laDbTest` sai ⇒ thoát 2 trước khi mở kết nối.
- **Mặc định chạy khô:** đếm + liệt kê adapter `code LIKE 'r1b2%'` (§6 mục 28 R1b-1: 26336 / 26337 / 26342 / 26343), tag, máy, node edge, `robot_motion_lock_requests` STOP chưa ack.
- **`--apply`:** một giao dịch bằng owner:
  - `SELECT public.edge_stop_resolve(q.id, <admin id>, 'R1b-2a T14 don _test')` cho STOP chưa ack;
  - xoá theo thứ tự khuôn `__edgeE2eHarness.dot10.ts:731-760`;
  - `admin id` = admin có id bé nhất;
  - đếm lại ⇒ 0.
- **Hàng WORM khác giữ nguyên.**

- [ ] **Step 1: Test đỏ:** `laDbTest("postgres://x@h/aoi_management")` ⇒ false; `…_test` ⇒ true; `TEST_DATABASE_URL` trỏ DEV ⇒ thoát 2, seam `postgres` giả đếm 0 lần kết nối.
- [ ] **Step 2: Chạy.** Mong đợi: đỏ.
- [ ] **Step 3: Cài.** Chạy khô trên `_test`, dán số đếm vào commit.
- [ ] **Step 4: `--apply` trên `_test`**, chạy khô lại ⇒ 0. `scripts/apply-migration-0433.mjs --test-only` vẫn xanh.
- [ ] **Step 5: Đột biến:** `laDbTest` luôn true ⇒ ca DEV đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `chore(scripts): don rac _test cua R1b-1 T2 bang vai owner, chi _test, mac dinh chay kho (R1b-2a T14)`.

### Task 15: Nghiệm thu R1b-2a

**Files:**
- Create:
  - `server/services/scada/r1b2aNghiemThu.db.test.ts` (opt-in `SCADA_R1B2A_NGHIEM_THU=1`; `OT_CONTROL_ENABLED="true"`, `AI_OT_CONTROL_ENABLED="false"` chỉ trong tiến trình);
  - `docs/superpowers/plans/2026-10-25-scada-r1b-2a-bao-cao-nghiem-thu.md`.
- Modify (chỉ khi được phép chạy bench): `scripts/scada-r1b-bench.ts` (bước L1, cờ `--r1b2a`).

Cổng:

| Ô | Kích thích | Mong đợi |
|---|---|---|
| L1 | dispatch AI 2,5 / `"abc"` / 3 lên int chưa khai scale 1 | `OFF_STEP goiY 3` / `TYPE_MISMATCH`, thiết bị 0; rồi driver nhận 3 |
| L2 | đề xuất SPI trên `printer_offset_x` int scale 1 | args nguyên, `congKenhSom` ok |
| L3 | bảng giá trị lạ (Task 1) | JS từ chối ⊆ SQL trước triển khai |
| M1 | HMI `request` 2,5 trên int scale 0,5 | nhận |
| G1 | 200 POST `dungMay` cookie rác | 0 dòng warn từ đường giới hạn |
| G2 | một người 601 STOP / phút; vé thu hồi | lượt 601 ⇒ 429; vé thu hồi bị trần, không vô hạn |
| D1 | `loadStopPins` chậm 3 s | `SCADA_STOP_PRECHECK_TIMEOUT` < 2,4 s, `dispatch` 0 |
| S1 | đổi máy đồng thời giữa kiểm và khoá | NOT_FOUND, 0 hàng đổi (7 thủ tục) |
| K1 | khai 200 tag một mã; lô có 1 tag hỏng; nâng mức tag ghim | 200 đổi + 201 audit; 0 đổi, mã còn dùng được; `STOP_PIN_GO_TRUOC` |
| N1 | đổi `samplingMs` tag đã khai không mã | `SCADA_CONFIG_TOTP_REQUIRED` |
| W1 | thiếu 0433 | `request` ⇒ `SCADA_SCHEMA_MISSING`; `dungMay` ⇒ gửi |
| W2 | 100 `DA_XU_LY` rồi im 61 s | đúng 1 `DIEU_TIET` không cần lần gọi kế |
| B1 | 10 lượt song song mã đúng (đường đầy đủ) | 1 true, 9 false, 0 khoá |
| H1 | `/health` trước lần kiểm đầu; thiếu 1 FK 0433 | `dang_kiem`; `thieu` có "0433" |

- [ ] **Step 1:** viết test opt-in; chạy 3 lượt tuần tự; xanh. Đỏ ⇒ về task sở hữu, không nới ngưỡng. Không đặt biến ⇒ skipped.
- [ ] **Step 2: Đột biến hệ thống:** trả lại lối tắt scale 1 trong `kiemLuoiTho` ⇒ L1 đỏ. Ghi lại. Hoàn tác.
- [ ] **Step 3: Bench OpenPLC — CHỈ khi điều phối cho phép và đủ điều kiện R1b-1** (commit trống ≥ 10 GB; `docker update --memory 1g --memory-swap 1g avi-openplc-bench`; không chạm :3000 / :8091 / GPU):
  - L1 trên một thanh ghi int chưa khai scale 1;
  - 3 lượt, đọc lại bằng client riêng, trả thanh ghi + container về gốc;
  - không tải chương trình PLC.
  - Không được phép ⇒ ghi "bench not run" + lý do.
- [ ] **Step 4: Báo cáo.** Bảng số đo, đột biến, giới hạn đã biết, rồi:
  - thứ tự triển khai: truy vấn trước triển khai (bản R1b-1 + mở rộng Task 1) = 0 hàng trên DB đích TRƯỚC bản build. Một script node so chuỗi trong báo cáo với hằng `TRUY_VAN_TRUOC_TRIEN_KHAI` (bằng nhau từng byte);
  - checklist bật cờ: khai mức hàng loạt đã có (P1-1); tag ghim DỪNG phải ở mức 1;
  - **câu nguyên văn: "R1b-2a là điều kiện cần; bật `AI_OT_CONTROL_ENABLED` là quyết định của chủ dự án sau rà soát độc lập riêng"**;
  - backlog R1b-2b.
  - Ghi tách LOGIC · DỮ LIỆU · VẬN HÀNH.
- [ ] **Step 5: Chạy toàn bộ:**
  - `node scripts/luoi-truoc-gop.mjs --nang server shared client/src scripts vscode-extension/src`;
  - lô serial;
  - mọi `*census*`;
  - opt-in R0 + R1a + R1b-1 + R1b-2a;
  - `npm run check` (12 GB);
  - `npm run i18n:check`.
  - Phân loại mọi tệp đỏ.
- [ ] **Step 6: Commit** `test(scada): nghiem thu R1b-2a - mot luat gia tri int + SPI, tran STOP theo nguoi, han truoc gui, pham vi duoi khoa, khai muc hang loat, ma du phong`.

---

## Bàn giao sau R1b-2a

- Báo điều phối để giao kiem-dinh. Gộp chỉ sau khi R1b-1 đã gộp. **Không push.**
- Không migration. Nếu phát sinh: dùng 0435 / 0436 (0434 giữ cho R1b-1), gửi SQL, chờ "áp" mới áp DEV.
- Không đổi `AI_OT_CONTROL_ENABLED` ở bất cứ đâu.
- Viết kế hoạch R1b-2b sau khi R1b-2a được duyệt.

## Danh sách R1b-2b (chỉ liệt kê — kế hoạch riêng)

**Từ nội dung R1b-2 đã duyệt (kế hoạch R1b-1):**
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
11. EIP: listener `'error'` của Controller + `timeout_sp` = `timeoutMs`.
12. Định danh callback ghi SLMP.
13. Tắt sạch không ghi `disabled`.
14. C6 đọc khối Modbus.
15. Đo mất / có lại liên lạc OPC UA.
16. Nhịp cho nguồn ngoài OT trung tâm.
17. `congOtLuong` dùng mức kênh (cần `adapterId` trong luồng AI).
18. Audit điều tiết báo đúng cỡ đợt burst (R1a §8 mục 14).

**Chuyển từ phần dư T3/T4 (điều chỉnh tách ở đầu kế hoạch):**

19. T4: nạp bộ đệm sống (`napTuOt`) khi DB treo — tham số `onMauBoQua` qua `TuyChonVongPoll` (`otDriver.ts:119`) và 7 driver.
20. T4: thử lại lô mẫu xấu bị bỏ.
21. T3: watchdog thừa mẫu cho đường push.
22. T3: kế toán mất liên lạc khi reset HA.
23. T3 c2: ghi trong lúc phiên chờ lần đọc tốt đầu tiên.
24. T3: thứ tự canh `sinkPhien` legacy (nit).

**Từ sổ R1b-1, rà soát và kiem-dinh:**

25. T10a M-2: điểm mù census (`import * as t`, helper khác tệp; kiểm B thời chạy của `otWriteBinding`).
26. T10a M-3: dispatcher join `edge_nodes`.
27. T10a M-4: leo thang `chua_kiem_duoc`.
28. T10a M-5: `performance.now` khi máy ngủ.
29. Loại tệp test khỏi hai ca census `confirmAction`, kèm lý do có ngày.
30. DOM test I-2 cho mọi hộp `SCADA_AI_LEVEL_TOO_HIGH`.
31. T13 m2: đường FOE thật tới số thô.
32. `validateStopValue` đòi số nguyên cho ghim trên int (phát sinh ở Task 2).
33. Hiệu năng khảo sát khả năng dừng ở mỗi lần poll 5 s của `cheDo.danhSach` (chưa đo).
34. Posture đếm cả luật bật chưa duyệt (đếm dư có chủ ý — xem lại ở R2).
35. Kiem-dinh I4: đo PRODUCTION số tag int chưa khai có scale / offset (DEV 0, TEST 0) trước triển khai — việc vận hành, đưa vào checklist.
36. Edge `otEdgeDispatch` không qua cổng kênh — thuộc R1c.

**Từ backlog R1a §8 chưa đóng:**

37. Mục 21: khoá TOTP leo thang / cảnh báo `tam_khoa` lặp.
38. Mục 22: màn admin mở khoá TOTP.
39. Mục 23: `NganTagAdapter` đòi `machine_control.canView`.
40. Mục 24: i18n `TRPC_GIOI_HAN_THU_TUC`.
41. Mục 25: các mục P2 còn lại của kiem-dinh — chờ danh sách của điều phối.

## Tự rà soát (đã chạy)

1. **Phủ yêu cầu.** Từng mục bắt buộc của điều phối có task:
   - Q-T13 (b) + SPI → T1;
   - M1 / M2 → T1;
   - m5 / m4 → T2;
   - trần theo người + vé thu hồi + N-2 → T3;
   - hạn STOP → T4;
   - M5 / M7 → T5;
   - khai mức hàng loạt → T6 + T7;
   - M4 → T8;
   - T7 → T9;
   - T8 → T10;
   - wizard + ScadaDiag → T11;
   - `/health` + M3 + posture → T12;
   - T3 dư → T13 (phần còn lại sang R1b-2b, có lý do);
   - `_test` → T14.

   N-1, I2, M6 đã bỏ (R1b-1 sửa). Các thay đổi R1b-1 mà R1b-2a xây trên được ghi ở Phụ thuộc và dùng ở T1 (SQL), T2 (`setStopPin` + TOTP), T4 (ghim mức ≤ 1), T6 (mức trên tag ghim; token duyệt không đổi), T8 (cột nhịp ngoài băm định nghĩa).
2. **Quét bước.** Mỗi bước code có chữ ký, tệp và giá trị. Không có thân hàm. SQL không chép lại, vì bản chính thuộc R1b-1; T1 nêu chính xác ba thay đổi.
3. **Nhất quán kiểu.** Những tên dùng chung được định nghĩa một lần và dùng lại đúng tên:
   - `kiemLuoiThoChuaKhai` / `canKiemLuoiThoChuaKhai` (T1, T2);
   - `epKieuGiaTri` (T2);
   - `kiemPhamViDuoiKhoa`, `HAN_TOTP_CAU_HINH_MS` (T5 → T6);
   - `kiemPatchKenh` / `patchKenhInput` (T6, T7);
   - `TRAN_KENH_DA_KHAI_MOT_LO` (T6);
   - `biet0433Thieu` (T9; FK tách ở T12 `thieu0433Fk`);
   - `SchemaR1aHealth` (T12);
   - `TRAN_STOP_HMI_MOI_PHUT` (T3);
   - `HAN_TRUOC_GUI_STOP_HMI_MS` (T4, T15).

   Thứ tự khoá tag `ORDER BY id` (T5) được T6 dùng.
4. **Review Focus.** Năm dòng, mỗi dòng có test trong task sở hữu: T6 (#137, #42), T3 (600 / người, vé thu hồi, cookie rác), T1 (bảng giá trị lạ + SQL), T1 (SPI −7,26 + 0/0), T4 (3 s).
5. **Tỷ lệ.** Kế hoạch nêu quyết định và test. Khối code chỉ là test.

**Câu hỏi chỉ điều phối trả lời được — kèm khuyến nghị:**
- **Q1 (T1, cổng dừng).** Census tìm thấy luật / FOE / ghim có số không nguyên hoặc không phải số trên tag int ⇒ sửa dữ liệu trước hay vẫn bật luật mới? *Khuyến nghị:* dừng; sửa từng hàng về `goiY`, rồi mới gộp.
- **Q2 (T1, M1).** |thô| ≥ 2^53 nay là `OUT_OF_RANGE` thay vì "coi là trên lưới". *Khuyến nghị:* duyệt; không thanh ghi nào nhận được số đó chính xác.
- **Q3 (T3).** Trần 600 STOP / phút / người là hằng, không env. *Khuyến nghị:* duyệt 600.
- **Q4 (T4).** Đổi STOP ở DB chậm từ "chờ tới khi DB trả lời" sang "từ chối có mã sau 1,5 s xác thực / 2 s trước-gửi kèm 'dùng E-STOP cứng'". *Khuyến nghị:* duyệt, vì `dispatch()` không bị hạn này.
- **Q5 (T5, M7).** Bộ đếm TOTP giữ kết nối riêng (an ninh) và chỉ được bọc hạn 3 s, thay vì chuyển vào giao dịch. *Khuyến nghị:* duyệt.
- **Q6 (T6).** Một lô = MỘT adapter, patch đầy đủ; thêm từ chối nâng mức tag đang ghim từ ≤ 1 lên > 1 (cả ở `capNhat`). *Khuyến nghị:* duyệt cả hai.
- **Q7 (T8, M4).** `unit` cũng cần TOTP trên tag được bảo vệ (ngoài `samplingMs` / `deadband`). *Khuyến nghị:* có, theo kiem-dinh.
- **Q8 (T10).** Người thắng trả `true` dù khoá do lượt song song đặt; phát lại mã vừa tiêu (≤ 10 s) được hoàn lượt. *Khuyến nghị:* duyệt.
- **Q9 (tách).** Năm mục dư T3/T4 sang R1b-2b. *Khuyến nghị:* duyệt.
- **Q10 (T15).** Chạy bench L1 trên OpenPLC? *Khuyến nghị:* có, sau khi đo commit trống.
