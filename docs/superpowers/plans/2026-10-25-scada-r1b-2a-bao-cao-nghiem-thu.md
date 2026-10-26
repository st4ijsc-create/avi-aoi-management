# SCADA R1b-2a · An toàn, đúng đắn và nợ R1b-1 — Báo cáo nghiệm thu (Task 15)

Ngày đo: 2026-10-26 · nhánh `feat/scada-r1b2` (worktree `D:\SOURCES\_scada_r1a_wt`), gốc đo `8e6baab06` (T1–T14 + gộp main `134293775`) ·
máy Windows 11, Node 24 · CSDL `aoi_management_test` (PG :5434). Không đụng :3000 / :8091 / GPU / DEV. Không push. Không sửa `.env`.

> **AI_OT_CONTROL_ENABLED vẫn TẮT; R1b-2a là ĐIỀU KIỆN CẦN, việc bật là quyết định của chủ dự án sau kiểm định riêng.**
>
> **R1b-2a là điều kiện cần; bật `AI_OT_CONTROL_ENABLED` là quyết định của chủ dự án sau rà soát độc lập riêng.**

Mọi số dưới đây là **đo thật** (khẳng định của test hoặc dòng in của script). Không ô nào được khai "đạt" mà không có phép đo; không nới ngưỡng nào.
`OT_CONTROL_ENABLED` / `AI_OT_CONTROL_ENABLED` chỉ được đặt trong tiến trình test / bench (D9); `AI_OT_CONTROL_ENABLED` luôn `"false"` ở đó.

## Kết luận ngắn

| Phần | Kết quả đo |
|---|---|
| Ma trận 14 ô của brief (`r1b2aNghiemThu.db.test.ts`, stub + safety PLC mô phỏng + CSDL `_test`) | **14/14 ô đúng mã, đúng số dòng WORM**; **3 lượt tuần tự 14/14** (+ 1 lượt phát triển 14/14); không đặt biến ⇒ skipped |
| Đột biến cấp hệ thống | trả lại lối tắt scale 1 trong `kiemLuoiTho` ⇒ **L1 đỏ** (2,5 `acked` tới driver) + **L3 đỏ** (tập JS từ chối 32 ≠ 33); 12 ô khác xanh; hoàn tác, `git diff` rỗng |
| Bench OpenPLC (`scripts/scada-r1b-bench.ts --r1b2a`) | **bench chờ OK điều phối** (Q10) — script đã viết; chạy khô trên máy chủ Modbus giả: **24/24 bước** (3 lượt × S1, S2-ĐC, S2, X2 ×2, L1 ×3); KHÔNG phải số đo PLC thật (§3) |
| Chạy toàn bộ (Step 5) | 2492 tệp, **34 898 ca: 34 807 qua, 1 đỏ (1 tệp), 90 bỏ qua**; serial 7 tệp 66/66. Tệp đỏ duy nhất **DO R1b-2a (T11)** — `vramPanelStepUp.unit.test.ts` (census client step-up): đã sửa trong commit nghiệm thu, chạy lại xanh (§5). Không đỏ có sẵn / do tải |
| Census (mọi `*census*`) | **69 tệp, 1034 qua, 3 bỏ qua, 0 đỏ** |
| Lưới nghiệm thu opt-in R0 / R1a / R1b-1 / R1b-2a | **56/56** (16 + 10 + 16 + 14), một lượt chung |
| `npx tsc --noEmit` (12 GB) · `npm run i18n:check` | exit 0 · sạch (0 lệch, 0 khoá mới thiếu) |
| Migration | **KHÔNG CÓ** (R1b-2a không thêm migration). Bản build cần 0431–0434 có sẵn (§4) |

**Đánh giá:**
- **LOGIC.** Một luật giá trị cho mọi tag int: AI gửi 2,5 / `"abc"` lên int chưa khai scale 1 ⇒ `OFF_STEP goiY 3` / `TYPE_MISMATCH`, thiết bị 0 lần
  (trước R1b-2a: driver ghi `Math.round(2,5) = 3` và `Math.round(NaN)` im lặng). Đề xuất SPI của AI thị giác ra số NGUYÊN trên int scale 1 và chính
  đề xuất ấy qua cổng kênh + `dispatch()` thật. HMI nhận 2,5 trên int scale 0,5 (số thô 5) như dispatch. Truy vấn trước triển khai báo mọi luật
  hàm JS từ chối (33/33, báo dư 6). STOP HMI: trần 600 / phút / phiên của một người (lượt 601 ⇒ 429 "use the hard E-STOP"), vé thu hồi bị trần
  (không còn vô hạn), cookie rác không in một dòng log nào; DB chậm-mà-sống ⇒ từ chối có mã sau ~2,02 s, `dispatch()` 0 lần. Phạm vi nhà máy kiểm
  LẠI dưới khoá adapter ở 8 thủ tục. Khai mức hàng loạt: một mã TOTP cho 200 tag, tất-cả-hoặc-không, mã không bị tiêu khi lô bị từ chối, nâng mức
  tag ghim ⇒ "gỡ ghim trước". Cột nhịp của tag được bảo vệ cần TOTP. Thiếu 0433 ⇒ `request` fail-closed có mã, STOP vẫn gửi. Tổng kết `DIEU_TIET`
  được xả cho người ngừng hẳn. Mã dự phòng: người thắng không bị khoá (1 true / 9 false / 0 ném / 0 khoá). `/health` nói "đang kiểm" và nhìn
  thấy FK thiếu của 0433.
- **DỮ LIỆU.** Không migration. Truy vấn trước triển khai `TRUY_VAN_TRUOC_TRIEN_KHAI` trên TEST (READ ONLY) = **0 hàng** (§4); DEV = 0 hàng (bộ điều
  khiển đo chỉ đọc ở T2); PRODUCTION chưa đo. `_test` đã dọn rác R1b-1 (T14: 81 hàng, chạy lại 0); hàng WORM ở lại (đúng thiết kế).
- **VẬN HÀNH.** Bench OpenPLC CHỜ OK của điều phối (Q10). Container không bị khởi động. Script sẵn sàng; chạy khô 24/24.

---

## 1. Ma trận ô — `server/services/scada/r1b2aNghiemThu.db.test.ts`

**Chỉ chạy khi gọi tường minh (như R0 / R1a / R1b-1):**
- Bash: `SCADA_R1B2A_NGHIEM_THU=1 npx vitest run -c vitest.db.config.ts server/services/scada/r1b2aNghiemThu.db.test.ts`
- PowerShell: `$env:SCADA_R1B2A_NGHIEM_THU='1'; npx vitest run -c vitest.db.config.ts server/services/scada/r1b2aNghiemThu.db.test.ts`
- Không đặt biến: cả tệp bị bỏ qua (đo được: `Test Files 1 skipped`).

**Đường chạy thật:** router tRPC thật (`scadaCommands.*`, `deviceAdapter.*`, `scadaDiag.tamTat`, `scadaKenh.khaiHangLoat`), người dùng qua
`taoNguoiDungTest`, phạm vi `idsTrongPhamVi` thật, quyền `checkPermission` thật, `dispatch()` thật → StubDriver thật (RAM; ghi lại lô và số thô
`inverseScale`), commissioning bật, preflight safety thật trên safety PLC mô phỏng (`ServerTCP` trong tiến trình, D9), TOTP thật (speakeasy +
`setup2FA` / `enable2FA` + bộ đếm T16), limiter thật trên express (thứ tự `_core/index.ts`), `sdk.signSession` / `createContext` / `user_sessions`
thật, `createHealthHandler` + `kiemSchemaR1a` thật trên `pg_constraint`.

**Chỗ giả (hạ tầng, không phải cổng):** `getActiveDriver` / `getActiveConnectionFingerprint` (stub + vân tay tính từ hàng adapter); `getIO`; `dispatch`
được BỌC để đếm (gọi xuyên mã thật); `raiseCriticalStopAlert` + `sendCentralAdapterStop` ghi lại; ô D1: `loadStopPinsHmi` (callee thật của
`dungMay`, ruling K5) BỌC chờ 3 s rồi gọi bản thật; ô H1: một FK bị lọc khỏi KẾT QUẢ truy vấn `pg_constraint` thật (không đụng schema).

**Đếm WORM theo khoá của tệp** (`_test` dùng chung): attempts theo `user_id` của người dùng tệp, `command_log` theo `adapterId` của adapter tệp.

| Ô | Kích thích | Mong đợi (brief) | Đo được (3 lượt giống nhau) |
|---|---|---|---|
| **L1** | dispatch AI 2,5 / `"abc"` / 3 lên int CHƯA khai scale 1 | `OFF_STEP goiY 3` / `TYPE_MISMATCH`, thiết bị 0; rồi driver nhận 3 | 2,5 ⇒ `rejected OFF_STEP`, `appError {SCADA_VALUE_OFF_STEP, step 1, goiY 3}`, errorText `… (goiY=3)`, command_log +1, thiết bị 0. `"abc"` ⇒ `rejected TYPE_MISMATCH` "giá trị không phải số hữu hạn", command_log +1, thiết bị 0. 3 ⇒ `ok`, driver nhận 3, số thô **3** |
| **L2** | đề xuất SPI (xu hướng 7,26 / 12,6 µm, gain 1) trên `printer_offset_x/y` int scale 1 | args nguyên, `congKenhSom` ok | `proposeControlFromVerdict` (bộ nạp lưới MẶC ĐỊNH, adapter `adapterIdForMachine` = id nhỏ nhất của máy) ⇒ args **−7 / −13** (nguyên), rationale không có "chưa đọc được lưới tag"; `congKenhSom` với hàng tag thật ⇒ `ok`; chính args ấy qua `dispatch()` thật ⇒ `ok`, driver nhận −7 / −13 |
| **L3** | bảng giá trị lạ Task 1 (18 giá trị: hex, TAB, NBSP, `[25]`, `["25"]`, `{v:25}`, `"abc"`, `"Infinity"`, `" 25 "`, 25, 2,5, 30, `"30"`, null, true, `""`, `"   "`, `"1e400"`) × tag int chưa khai scale 1, int chưa khai scale 10, float chưa khai = 54 luật bật | JS từ chối ⊆ SQL trước triển khai | JS (`luatLenhLechLuoi`, hàm của cổng dispatch) từ chối **33** luật = ĐÚNG tập mong đợi (i10: 16, i1: 9, f: 8); `TRUY_VAN_TRUOC_TRIEN_KHAI` có **39** hàng; **bỏ sót 0** (báo dư 6 — hex / TAB / NBSP trên i1 và f: JS đọc được 25, SQL `KHONG_PARSE_DUOC`); 30 / `"30"` không ai báo; `i1-2,5` ⇒ `LECH_LUOI`; `f-"abc"` ⇒ `KHONG_PARSE_DUOC` |
| **M1** | HMI `request` `"2.5"` trên int CHƯA khai scale 0,5 (mức 3) | nhận | `request` nhận (preview `requested 2.5`); `confirm` ⇒ `acked_verified`, driver nhận 2,5 `dataType int, scale 0.5` ⇒ số thô **5** |
| **G1** | 200 POST `/api/trpc/scadaCommands.dungMay` với cookie phiên RÁC qua `createHmiStopLimiter` → `createApiLimiter` → `createUnverifiedCredentialIpLimiter` | 0 dòng warn từ đường giới hạn | **0** dòng `[Auth]` / "Session verification" (console.warn + console.error); đối chứng: một `sdk.verifySession` mặc định ⇒ đúng **1** dòng (spy nhìn thấy) |
| **G2** | một người: phiên hợp lệ 601 STOP; vé thu hồi (hàng `isActive=false`, chữ ký + hạn còn) 601 STOP; phiên mới | lượt 601 ⇒ 429; vé thu hồi bị trần, không vô hạn | phiên hợp lệ: 600 × 200, lượt 601 ⇒ **429** `{"error":"Too many STOP requests — use the hard E-STOP"}`. Vé thu hồi: `createContext` ⇒ `user null` (đã kiểm), 600 × 200, lượt 601 ⇒ **429**. Phiên MỚI của cùng người ⇒ **200** (bucket riêng). `TRAN_STOP_HMI_MOI_PHUT` = 600 |
| **D1** | `loadStopPinsHmi` chậm 3 s, `dungMay` qua router | `SCADA_STOP_PRECHECK_TIMEOUT` < 2,4 s, `dispatch` 0 | `SERVICE_UNAVAILABLE / SCADA_STOP_PRECHECK_TIMEOUT {ma STOP_QUA_HAN, pha truoc_gui}` sau **2016 / 2020 / 2021 / 2025 ms** (4 lượt; ≥ 1950 và < 2400); `dispatch` **0**, thiết bị 0; attempts **+1** (`dispatch/rejected/STOP_QUA_HAN`, `adapter_id` NULL, `ly_do` chứa "E-STOP cứng"), command_log 0; lượt đọc bị bỏ rơi chạy nốt KHÔNG gửi gì |
| **S1** | adapter đổi sang máy nhà máy B bằng một giao dịch THẬT commit giữa kiểm-trước và khoá (đo chặn bằng `pg_blocking_pids`), người gọi là kỹ sư nhà máy A | NOT_FOUND, 0 hàng đổi (7 thủ tục) | **8 thủ tục**, mỗi thủ tục đúng NOT_FOUND của nó: `deviceAdapter.update` / `delete` / `tags.create` / `tags.setStopPin` / `scadaDiag.tamTat` / `scadaKenh.khaiHangLoat` ⇒ `ENTITY_NOT_FOUND {adapter}`; `tags.update` / `tags.delete` ⇒ `ENTITY_NOT_FOUND {deviceTag}` (M6). Hàng không đổi (tên, adapter còn, 0 tag tạo, địa chỉ, tag còn, ghim NULL, adapter vẫn bật, mức 5); audit của người gọi +0. Đối chứng dương: đổi sang máy khác CÙNG nhà máy A ⇒ thành công. (7 thủ tục của kế hoạch có `applyImport`; nó là `adminProcedure` — phạm vi luôn toàn quyền, K9 — nên được thay bằng `khaiHangLoat` + `setStopPin`, hai đường không-admin dùng cùng helper) |
| **K1** | 200 tag int mức 5 của một adapter, một mã TOTP thật | 200 đổi + 201 audit; 0 đổi, mã còn dùng được; `STOP_PIN_GO_TRUOC` | lô 200 có #137 ghim 0 + patch `writeMin 5` ⇒ `BAD_REQUEST STOP_PIN_NGOAI_DAI {tagId #137, lyDo OUT_OF_RANGE}`, **0** tag đổi, **0** audit. **Cùng mã** cho lô 200 `actuationLevel 3` ⇒ `soDoi 200` (467–615 ms), mức 200/200 = 3, audit **201** (200 `scada_kenh_cap_nhat` + 1 `scada_kenh_khai_hang_loat {loId, soTag 200, tagIds}`). Tag ghim DỪNG ở mức 1 nâng lên 3 ⇒ **`STOP_PIN_GO_TRUOC {tagId}`**, mức giữ 1 |
| **N1** | `deviceAdapter.tags.update` đổi `samplingMs` của tag ĐÃ khai (mức 3), không mã | `SCADA_CONFIG_TOTP_REQUIRED` | `PRECONDITION_FAILED / SCADA_CONFIG_TOTP_REQUIRED {ma TOTP_CAN}`; `samplingMs` giữ NULL |
| **W1** | trạng thái thiếu 0433 (`__datTrangThaiSchemaR1a`: `thieu0433 = [scada_command_attempts.ly_do]`) | `request` ⇒ `SCADA_SCHEMA_MISSING`; `dungMay` ⇒ gửi | `request` ⇒ `PRECONDITION_FAILED / SCADA_SCHEMA_MISSING {THIEU_MIGRATION, 0433}`, attempts +0, command_log +0. `dungMay` ⇒ `acked_verified`, driver nhận đúng ghim `{dung: 0, stop_cmd: true}` |
| **W2** | 100 `confirm` trên yêu cầu ĐÃ xử lý (`DA_XU_LY`) rồi im 61 s (đồng hồ giả Date + setInterval) | đúng 1 `DIEU_TIET` không cần lần gọi kế | 100 lần client nhận `CONFLICT / SCADA_REQUEST_ALREADY_HANDLED`; attempts **+30**; sau 61 s hẹn giờ xả tự ghi **đúng 1** dòng `confirm/rejected/DIEU_TIET` "70 lần DA_XU_LY bị gộp" (tổng +31), hẹn giờ tự dừng; +5 phút ⇒ vẫn 31 (không tổng kết thứ hai) |
| **B1** | 10 lượt SONG SONG `verifyBackupCode` ĐẦY ĐỦ (bộ đếm T16 + hoàn lượt T10) cùng mã đúng; pool > 1 | 1 true, 9 false, 0 khoá | **1 true / 9 false / 0 ném**, `docKhoa` còn 0 ms (không khoá), đúng 1 mã bị tiêu, mã khác của bộ dùng được ngay (trước T10: 0 / 8 / 2 khoá) |
| **H1** | `/health` khi trạng thái `chua_kiem`; `kiemSchemaR1a` thật với `scada_khoa_chon_adapter_fk` bị lọc khỏi kết quả | `dang_kiem`; `thieu` có "0433" | `chua_kiem` ⇒ `schemaR1a {ok:false, trangThai:"dang_kiem", thieuMigration:null, lyDo:"chua_xong"}`, `status "ok"` (không degraded), HTTP 200. Thiếu FK ⇒ `kiemSchemaR1a` = `{…, thieu0433Fk:["scada_khoa_chon_adapter_fk"]}` ⇒ `trangThai "thieu"`, `thieuMigration ["0433"]`, `lyDo` gọi tên FK, `status "degraded"`. Đủ ⇒ VẮNG khoá |

**Lượt chạy:** 1 lượt phát triển + 3 lượt tuần tự `-c vitest.db.config.ts`, mỗi lượt 14/14 (~13–14 s phần test). Số in của L3 / G1 / S1 / B1 giống hệt
qua các lượt (B1: vị trí lượt thắng khác nhau, luôn đúng 1 true). Không đặt biến: skipped.

**Giới hạn của lưới:**
- Thiết bị là stub (RAM); PLC thật cho L1 chờ bench (§3).
- D1 dùng đồng hồ thật (K15: < 10 s); biên 2,4 s là cổng của brief, đo 2016–2025 ms trên máy ít bộ nhớ.
- W2 dời đồng hồ giả Date + setInterval (khuôn T9) thay vì chờ 61 s thật.
- G1 / G2 dùng store BỘ NHỚ (`RATE_LIMIT_REDIS=false`) — đường Redis của limiter có test riêng ở T3 (Redis giả).
- H1 mô phỏng FK thiếu ở tầng kết quả truy vấn (không DROP CONSTRAINT trên `_test` dùng chung).

## 2. Đột biến cấp hệ thống (Step 2) — chạy rồi hoàn tác; sau đó `git diff` rỗng

| Đột biến | Ô đỏ | Số đo |
|---|---|---|
| `kenhScada.kiemLuoiTho`: trả lại lối tắt `if (s === 1 && o === 0) return { ok: true, giaTri: v };` ngay sau `heSoThangDo` | **L1** + L3, 2/14 đỏ | L1: 2,5 ⇒ `{"ok":true,"status":"acked"}` (driver nhận 2,5 ⇒ PLC thật làm tròn thành 3 — đúng lỗ Q-T13 b). L3: tập JS từ chối 32 ≠ 33 (luật `i1-2,5` không còn bị báo — truy vấn SQL vẫn báo nó, tức SQL không phụ thuộc lối tắt). 12 ô khác xanh |

## 3. Bench OpenPLC — `scripts/scada-r1b-bench.ts --r1b2a`

**Trạng thái: bench chờ OK điều phối** (Q10: chỉ chạy khi điều phối OK ngay tại thời điểm đó, sau khi đo commit còn trống). Người thực thi KHÔNG khởi động
container, KHÔNG chạy script ở chế độ docker.

**Script (đã viết, sẵn sàng):** cờ mới `--r1b2a` thêm ô **L1** vào mỗi lượt (sau S1 / S2-ĐC / S2 / X2 của R1b-1 — giữ làm hồi quy trên PLC thật):
- bước 0 cần ≥ 4 thanh ghi holding giữ giá trị (dừng, chế độ, X2, L1);
- tag `sc1cu` int CHƯA khai (mọi cột 0431 NULL), scale 1, trên thanh ghi thứ tư; nằm trong danh sách poll của adapter;
- mỗi lượt: thanh ghi = 0; dispatch AI 2,5 ⇒ mong `rejected OFF_STEP goiY 3`, command_log +1, thanh ghi không đổi; `"abc"` ⇒ `rejected TYPE_MISMATCH`,
  thanh ghi không đổi; 3 ⇒ `ok`, thanh ghi = **3**; đọc lại bằng client Modbus RIÊNG (kết nối mới mỗi lần);
- trước khi chạm: ghi giá trị gốc của mọi thanh ghi 0..17, cuối cùng ghi trả và kiểm "KHỚP gốc"; container trả về đúng trạng thái ban đầu;
- không tải chương trình PLC, không firmware; chỉ ghi / đọc thanh ghi holding.

**Điều kiện khi được phép (R1b-1 §3):** đo commit trống (`Win32_OperatingSystem.FreeVirtualMemory`) ≥ 10 GB; `docker update --memory 1g --memory-swap 1g
avi-openplc-bench`; không chạm :3000 / :8091 / GPU. **Lệnh:** `npx tsx scripts/scada-r1b-bench.ts --lap 3 --r1b2a` (container đang chạy) hoặc thêm
`--start-neu-tat` (container tắt, có cho phép). Mong: 24/24 bước ĐẠT.

**Chạy khô để kiểm mã script (KHÔNG phải số đo OpenPLC):** `npx tsx scripts/scada-r1b-bench.ts --khong-docker --endpoint tcp://127.0.0.1:15602
--lap 3 --r1b2a` trên một máy chủ Modbus giả trong tiến trình (64 thanh ghi holding giữ giá trị; script nháp ngoài repo). Mọi đường sản phẩm khác đều
thật (otManager + ModbusDriver thật, vòng poll thật nuôi kênh chế độ, `dispatch()`, phân loại STOP ghim với vân tay otManager thật). Kết quả:
**24/24 bước đạt** — L1 mỗi lượt: 2,5 ⇒ `rejected OFF_STEP goiY=3 · command_log +1`, thanh ghi 0 → 0 (9–14 ms); `"abc"` ⇒ `rejected TYPE_MISMATCH ·
command_log +1`, 0 → 0; 3 ⇒ `acked ok=true`, 0 → 3 (120–142 ms); S1 / S2 77 → 0, S2-ĐC `MODE_LOCAL (khac_remote)`, X2 25 ⇒ `OFF_STEP goiY=30`, 30 ⇒
thô 3; 18 thanh ghi trả lại "KHỚP gốc". Nó chứng minh script chạy hết đường; nó KHÔNG thay cho bench trên PLC thật.

## 4. Thứ tự triển khai

1. **R1b-2a KHÔNG có migration.** Bản build R1b-2a ĐÒI **0431, 0432, 0433, 0434 đã có sẵn** trên DB đích (và backfill TOFU của 0434 đã chạy) — đúng
   thứ tự của báo cáo R1b-1 §4 mục 1 (`drizzle/0431_scada_kenh_lenh.sql`, `0432_totp_khoa_sai.sql`, `0433_scada_ly_do_fk.sql`,
   `0434_interlock_bam_dinh_nghia_duyet.sql` + `scripts/backfill-approved-def-hash.mjs`). Không migration nào trong dải 0435–0436 được dùng.
   - R1b-2a dựa vào: cột `scada_command_attempts.ly_do` (0433: dòng STOP_QUA_HAN, DIEU_TIET), 3 FK của 0433 (`/health` T12), `totp_khoa_sai.loai`
     (0432: bộ đếm mã dự phòng T10), `interlock_rules."approvedDefHash"` (0434).
   - Máy chủ tự kiểm lúc khởi động (`kiemSchemaR1a`): thiếu cột 0433 ⇒ `request` / `confirm` HMI từ chối `SCADA_SCHEMA_MISSING` (T9), STOP vẫn gửi;
     thiếu FK 0433 ⇒ `/health` `degraded` + "0433" (T12); lần kiểm chưa xong ⇒ `/health` `schemaR1a.trangThai = "dang_kiem"` (không degraded).
2. **BẮT BUỘC, TRƯỚC bản build, trên MỌI DB: truy vấn trước triển khai = 0 hàng** (bản R1b-1 §4 mục 2 + mở rộng Task 1 / Task 2). R1b-2a làm
   `dispatch()` từ chối mọi giá trị lệch lưới thô trên MỌI tag int chưa khai (kể cả scale 1 — 2,5 nay là `OFF_STEP`), mọi giá trị không phải số hữu hạn
   trên tag int / float chưa khai (`TYPE_MISMATCH`); một luật interlock ĐÃ BẬT từ trước với `commandValue` như vậy sẽ bị từ chối đúng lúc hành động bảo vệ
   cần chạy. Chạy trên từng DB đích trong phiên `SET default_transaction_read_only = on`. Chuỗi dưới là bản NGUYÊN VĂN của hằng
   `TRUY_VAN_TRUOC_TRIEN_KHAI` (`server/services/scada/lenhInterlockLechLuoi.ts`) — test `lenhInterlockLechLuoi.baoCao.test.ts` so khối này với hằng
   từng byte (cùng khối của báo cáo R1b-1), và script nháp `t15-truyvan-test.mjs` so lại một lần nữa + chạy trên TEST:

```sql
-- R1b-2a §4 mục 2 — luật interlock ĐANG BẬT có lệnh bảo vệ mà dispatch() sẽ TỪ CHỐI (CHỈ ĐỌC). ≥ 1 hàng ⇒ DỪNG triển khai.
WITH ung_vien AS (
  SELECT r.id, r.name, r."commandValue" AS cv, r."targetAdapterId", t."tagKey", t."dataType"::text AS kieu,
         COALESCE(NULLIF(t.scale, 0), 1)::numeric AS s, COALESCE(t."offset", 0)::numeric AS o
  FROM interlock_rules r
  JOIN device_tags t ON t."adapterId" = r."targetAdapterId" AND t."tagKey" = r."commandTag"
  WHERE r.enabled AND r.action::text <> 'alert' AND t."dataType"::text IN ('int', 'float')
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
  SELECT g.*, round(g.v - g.o, 30) / g.s AS n,
         CASE WHEN g.kieu = 'int' THEN 4503599627370496 ELSE 1e308 END AS tran
  FROM gia_tri g
)
SELECT id, name, "targetAdapterId", "tagKey", cv AS "commandValue", s AS scale, o AS "offset", v AS gia_tri_gui,
       CASE WHEN v IS NULL OR kieu <> 'int' OR abs(n) >= tran THEN NULL ELSE o + floor(n + 0.5) * s END AS diem_luoi_gan_nhat,
       CASE WHEN v IS NULL THEN 'KHONG_PARSE_DUOC' WHEN abs(n) >= tran OR abs(v) >= 1e308 THEN 'VUOT_MIEN_AN_TOAN' ELSE 'LECH_LUOI' END AS ket_luan
FROM tho
WHERE v IS NULL OR abs(n) >= tran OR abs(v) >= 1e308 OR (kieu = 'int' AND abs(n - round(n)) > 1e-9)
ORDER BY id
```

   - **Mọi hàng, mọi `ket_luan`, đều CHẶN** (`LECH_LUOI` ⇒ sửa `commandValue` về `diem_luoi_gan_nhat` qua `interlockRouter.update` + duyệt / bật lại (MOC),
     hoặc tắt luật; `KHONG_PARSE_DUOC` ⇒ người triển khai xem tay, đổi thành SỐ đúng lưới; `VUOT_MIEN_AN_TOAN` ⇒ số thô ≥ 2^52 (int) / ≥ 1e308 (float),
     không thanh ghi nào nhận chính xác). Chạy lại tới khi 0 hàng.
   - **Phạm vi (K2):** câu này phủ lưới thô + giá trị không parse được; với tag int / float CHƯA khai, mọi luật hàm JS từ chối đều có hàng (chỉ báo DƯ —
     đo lại ở ô L3: 33/33, dư 6); với tag ĐÃ khai, dải / bước / kiểu / loại kênh cưỡng chế lúc cấu hình (`nhatQuanKenh`) và đếm ở posture
     `interlockRulesCauHinhHong` (nay lọc theo phạm vi nhà máy của người xem — T12; admin thấy toàn bộ).
   - **Đo:** TEST `aoi_management_test` (giao dịch READ ONLY, 2026-10-26, script nháp đọc hằng NGUYÊN VĂN từ mã): `device_tags` 335 hàng, **0 hàng** (khối báo cáo == hằng:
     `true`, 1662 / 1662 ký tự). DEV: **0 hàng** (bộ điều khiển chạy chỉ đọc bản mở rộng float ở
     T2, sổ "Task 2: … new TRUY_VAN_TRUOC_TRIEN_KHAI (float-extended) on DEV 0 rows"). **PRODUCTION CHƯA ĐO.**
   - Census dữ liệu khác của R1b-2a (chỉ đọc; bộ điều khiển đã chạy trên DEV, đều 0 — sổ T1 / T2): luật / write FOE / ghim DỪNG có số không nguyên hoặc
     không phải số trên tag int (T1, Q1 — DEV 0 / 0 / 0, TEST 0 / 0 / 0); luật float hỏng, FOE lên float chưa khai, ghim lệch lưới trên int chưa khai, ghim
     trên int đã khai có scale / offset ≠ (1, 0) (T2 — DEV 0 / 0 / 0 / 0). Câu SQL ở `task-1-report.md` §1 và `task-2-report.md` §4 (sổ SDD).
3. **Các điều kiện R1b-1 §4 vẫn bắt buộc:** mục 2b (I4, census OFF_STEP trên PRODUCTION — R1b-2a MỞ RỘNG đối tượng: mọi tag int, kể cả scale 1 —
   xem backlog R1b-2b mục 35), mục 2c (rà / gỡ ghim DỪNG cũ trên tag mức ≥ 2 / chưa khai mức), mục 6 (2FA cho kỹ sư — R1b-2a thêm: cột nhịp `samplingMs` /
   `deadband` / `unit` của tag được bảo vệ cũng cần TOTP; khai mức hàng loạt cần TOTP mỗi lô có thay đổi).
4. **Thay đổi hành vi nhìn thấy được sau bản build** (báo người vận hành / tích hợp):
   - mọi người gọi (HMI, AI, interlock, FOE, REST) bị `OFF_STEP` khi gửi số lẻ lên tag int chưa khai scale 1 (trước: driver làm tròn im lặng) và
     `TYPE_MISMATCH` khi gửi chữ / mảng / đối tượng / NaN / Infinity lên tag int hoặc float chưa khai;
   - HMI nay nhận giá trị kỹ thuật lẻ trên int scale lẻ (2,5 trên scale 0,5) như dispatch;
   - STOP HMI: DB chậm ⇒ từ chối `SCADA_STOP_PRECHECK_TIMEOUT` (HTTP 503) trong ≤ 2,5 s kèm băng đỏ "DÙNG E-STOP CỨNG TẠI MÁY" (không phải toast);
     trên 600 STOP / phút / phiên ⇒ 429 + cùng băng đỏ;
   - ghim DỪNG lệch lưới thô trên tag chưa khai bị `setStopPin` từ chối (`STOP_PIN_NGOAI_DAI` kèm `goiY`);
   - `/health` có khoá `schemaR1a` `dang_kiem` ngay sau khởi động (bộ giám sát: CÓ MẶT khoá = chưa khoẻ về schema);
   - posture (`oversight.posture`) lọc theo phạm vi nhà máy; thêm số đếm "luật bật nhưng hỏng cấu hình" và "STOP HMI quá hạn 24 h".
5. Sau khởi động: `GET /health` không có `schemaR1a`; log khởi động không có khối "LUẬT INTERLOCK ĐANG BẬT … dispatch() sẽ TỪ CHỐI".

## 5. Chạy toàn bộ (Step 5)

**Cách chạy (một lệnh nặng một lúc — máy ít bộ nhớ):** `node scripts/luoi-truoc-gop.mjs --nang server shared client/src scripts vscode-extension/src`
(lô thường song song loại `*.db.test.ts` → lô DB tuần tự `vitest.db.config.ts` → lô nặng tuần tự → chạy LẠI RIÊNG từng tệp đỏ), trên cây `8e6baab06` +
tệp T15. Sau đó, riêng: `vitest.serial.config.ts`, mọi census, bốn lưới nghiệm thu opt-in, `tsc` (12 GB), `npm run i18n:check`. Phán theo `Test Files … failed`.

| Lô | Tệp | Ca | Qua | Đỏ | Bỏ qua |
|---|---|---|---|---|---|
| Thường (song song, không DB; gồm `client/src`, `vscode-extension/src`) | 2145 (1 đỏ) | 31 029 | 30 996 | 1 | 32 |
| DB (tuần tự, `_test`) | 344 (0 đỏ; 5 tệp toàn bỏ qua = 4 lưới opt-in + 1) | 3 787 | 3 729 | 0 | 58 |
| Nặng (tuần tự) | 3 | 82 | 82 | 0 | 0 |
| **Tổng lưới** | **2492** | **34 898** | **34 807** | **1** | **90** |
| Serial (`vitest.serial.config.ts`) | 7 | 66 | 66 | 0 | 0 |
| Census (`git ls-files` `census[^/]*\.test\.tsx?$`: 68 tệp một lượt + `vscode-extension/src/loi/census.unit.test.ts` riêng) | 69 | 1 037 | 1 034 | 0 | 3 |
| Opt-in R0 + R1a + R1b-1 + R1b-2a (`SCADA_R0/R1A/R1B/R1B2A_NGHIEM_THU=1`, một lượt) | 4 | 56 | 56 | 0 | 0 |
| `NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit` | — | — | exit 0 (chạy lại sau sửa client: exit 0) | — | — |
| `npm run i18n:check` | — | — | 0 lệch · 0 khoá mới thiếu · 0 baseline cũ · 0 vi phạm | — | — |

**Phân loại mọi tệp đỏ:**

| Tệp | Lô / riêng | Phân loại | Nguyên nhân + xử lý |
|---|---|---|---|
| `client/src/lib/vramPanelStepUp.unit.test.ts` (1 ca: vế CHIỀU NGƯỢC) | đỏ / **đỏ riêng** | **DO R1b-2a (T11)** — ĐÃ SỬA | T11 (`8c52f4fd3`) cho `ScadaDiag.tsx` gửi `totpCode` tới `scadaDiag.tamTat` (máy chủ tự kiểm mã mức 5 ở handler) mà không khai khoá vào `KHOA_TOTP_TRONG_HANDLER` (Global Constraints bắt buộc). Lưới merge `8e6baab06` chỉ chạy không-DB `server/*` nên không thấy. Sửa: khai `scadaDiag.tamTat` (ghi chú có ngày) + gộp HAI điểm gọi `tamTat.mutate` của ScadaDiag thành MỘT (`totpCode: canMa ? ma : undefined` — hành vi không đổi; luật P1-2 đòi MỌI điểm gọi mang `totpCode`). Bằng chứng hai chiều: thiếu khoá ⇒ đỏ "CHIỀU NGƯỢC"; còn hai điểm gọi ⇒ đỏ "P1-2 không gửi totpCode". Sau sửa: `vramPanelStepUp` 26/26, `ScadaDiag.dom` 33/33, `scadaDiagRouter.db` 18/18, tsc 0 |

Không tệp nào đỏ có sẵn trên main, không tệp nào đỏ do tải ở lượt này (lô DB 0 đỏ — Postgres :5434 đã nâng `max_locks_per_transaction` 64 → 256).

## 6. Lỗi có sẵn đã vá (điều phối yêu cầu ghi riêng cho kiem-dinh)

| # | Lỗi có sẵn (trước R1b-2a) | Hậu quả | Sửa | Commit |
|---|---|---|---|---|
| 1 | `s7Address` / `mcAddress`: sentinel lỗi `"BAD 255"` của thư viện được giải mã thành GIÁ TRỊ TỐT cho `bool` / `string` / `json` (bool ⇒ TRUE) — ở CẢ HAI trạng thái cờ `OT_CHAT_LUONG_V2_ENABLED`; mock trả `null` che lỗi này | Mất liên lạc với PLC S7 / Mitsubishi MC ⇒ tag bool đọc ra TRUE "good": interlock / chế độ / hiển thị tin một giá trị bịa (fail-open trong driver SCADA) | sentinel `BAD 255` / sentinel BAD của thư viện KHÔNG BAO GIỜ thành giá trị tốt: thành mẫu xấu có lý do (cờ V2 bật) / mẫu xấu trần (cờ tắt — ruling T13 r2, hình dạng nhất quán với cờ tắt); test dùng HÌNH DẠNG TRẢ VỀ THẬT của thư viện (thăm dò thư viện thật xác nhận) | `a9eda95c6` (commit riêng, điều phối duyệt) |
| 2 | S7 / MC: PLC IM LẶNG (TCP còn lên) ⇒ đọc quá hạn trả mọi tag "BAD 255" ⇒ nhãn mới `device_error` (T13 fix round 1) bị đếm là "máy chủ đã trả lời" ⇒ phiên báo `connected` giả, D1 (mất liên lạc) không bao giờ nổ | "connected" nói dối khi PLC treo (MC rủi ro cao) | S7: trạng thái kết nối ≠ 4 ⇒ lỗi liên lạc; MC: MỌI item BAD sau timeout thư viện ⇒ lỗi liên lạc (cái giá: vòng nối lại — §8 mục 13); test với hình dạng trả về thật | `b4a2d38e2` |
| 3 | `scadaSocket.db.test.ts` khẳng định "payload JSON không chứa chuỗi X" bằng so CHUỖI CON trên JSON có dấu thời gian ms ⇒ đỏ khi dấu thời gian tình cờ chứa chuỗi đó (đo được: `'333'`) | test chập chờn theo đồng hồ (không phải lỗi sản phẩm) | so theo TRƯỜNG, không theo chuỗi con của JSON | `c6d501b59` (điều phối cherry-pick vào main `291ff5288` + push) |
| 4 | (phụ, T14) `scripts/apply-migration-dot10-common.mjs` `testDbUrl` thêm `_test` hai lần khi URL đã là `_test` | script áp migration dot10 trỏ sai DB khi chạy từ môi trường test | không thêm hậu tố lần hai | `b76e6034c` |

Ngoài bảng (không phải lỗi có sẵn trên main — phát hiện và sửa TRONG nhánh): T10 vòng 0 đọc "mã vừa tiêu" và "mã chưa dùng" bằng HAI câu SELECT ⇒ lượt
thua đua bị phân loại sai `khong_khop` (có thể khoá người thắng ở lượt thứ 10) — sửa bằng MỘT ảnh chụp SELECT + test cưỡng thời điểm (`1a97579b3`).

## 7. Ràng buộc K13 + census

- **Ràng buộc (điều phối 2026-10-25, ruling K13 + T13 r2):** đường push (OPC UA monitored items) đếm "đọc tốt" theo ĐÚNG luật của đường poll — chỉ
  `comm_lost` (và mẫu xấu KHÔNG có lý do — fail-closed, ruling T13 c2) là "chưa trả lời"; `stale` được đếm là "đã trả lời". Helper dùng chung
  `taoBatDocTot` (theo phiên) + `mauMayChuDaTraLoi`. Hôm nay KHÔNG có nơi nào sinh `stale` đi tới quyết định `connected` của phiên.
- **Census `server/services/ot/staleKhongVaoPhien.census.test.ts`** (T13 fix round 2 + 3, `b4a2d38e2`, `e504eec98`): mọi chuỗi `"stale"` dùng như GIÁ TRỊ
  dưới `server/services/ot/**` (bỏ qua kiểu, phép so sánh, nhãn `case`) ⇒ ĐỎ, trừ danh sách cho phép có lý do + ngày (một mục:
  `otStopEpochSync.ts` `reject("stale")` — miền khác, đồng bộ epoch STOP). Tự kiểm ba dạng từng lọt (`mauXauChoMoiTag(tags, sc, "stale", at)`, gián tiếp
  qua hằng, hàm phân loại trả `"stale"`); đột biến từng dạng ⇒ đỏ. Ai thêm một nguồn `stale` thật (phản hồi thiết bị) phải khai vào danh sách cho phép,
  và kiem-dinh xét lại K13 (sổ T13 m1 ⇒ ghi chú điều phối).

## 8. Giới hạn đã biết

### LOGIC

**Giá trị lệnh (T1, T2)**
1. Tag float ĐÃ khai: bộ đề xuất SPI không xét dải / bước (T2 m4) — `dispatch()` vẫn từ chối; backlog.
2. So đọc lại (`readbackCompare`) trên int scale lẻ so `Math.round` ở không gian kỹ thuật ⇒ nhãn `acked_verified` có thể sai (chỉ nhãn xác minh, không
   điều khiển; T2 m3) — R1b-2b.
3. `validateStopValue` vẫn đòi số nguyên cho ghim trên int ⇒ không ghim được 2,5 trên int scale 0,5 (R1b-2b mục 32).
4. Chuỗi `"0x19"` / `"1e3"` được nhận như driver (`Number()`) trên tag chưa khai; SQL báo dư chúng là `KHONG_PARSE_DUOC`.
5. M1 (thô ≥ 2,8·10^14 trong dung sai) không với tới được trên thanh ghi 16 / 32 bit — chấp nhận (T1 M1).

**STOP HMI (T3, T4)**
6. **Tầng Express trước tRPC NẰM NGOÀI hạn 2,5 s:** vòng Redis của bộ giới hạn STOP (`passOnStoreError`) và lượt đọc thân yêu cầu; Redis chậm-mà-sống
   cộng thêm độ trễ của nó (R1b-2b: hạn lệnh cho client Redis của limiter, T4 N-3). Import động lạnh sau khởi động cũng ngoài hạn (T4 N-4).
7. Truy vấn DB bị bỏ rơi khi quá hạn vẫn chạy tới khi DB trả lời (postgres.js không huỷ được) — không bao giờ dẫn tới gửi.
8. Từ chối ở pha xác thực (`xac_thuc`) và ở middleware (cổng đổi mật khẩu, giấy phép, phạm vi tenant) KHÔNG có dòng WORM (chưa biết danh tính) — chỉ bộ đếm
   RAM `demStopQuaHanKhongGhiSo` (theo tiến trình, mất khi khởi động lại; posture chỉ hiện cho phạm vi toàn quyền).
9. Trần 600 / phút tính theo PHIÊN của một người ⇒ tổng của một người = 600 × số phiên sống (bị chặn bởi authLimiter 30 lần đăng nhập / 15 phút / IP).
   Redis sập ⇒ STOP không giới hạn (fail-open như mọi limiter — chấp nhận, T3 c4).
10. Hai bộ đọc cookie / hai helper "phần đã ký" / hai độ dài băm giữa tầng STOP (R1b-2a) và tầng chung W21 (main) — cùng ngữ nghĩa, chưa hợp nhất
    (luật điều phối: tách tới khi R1b-2a gộp; điều phối giao việc hợp nhất). Lượt kiểm W21 nay IM LẶNG với cookie rác (nhất quán N-2).

**Cấu hình được bảo vệ (T5, T6, T8)**
11. Một lô khai mức 200 tag giữ khoá adapter + luật + tag trong 0,5–4,4 s (đo 467–615 ms ở lưới; 4,4 s ở T6 với TOTP thật); với `SEC_PLATFORM=true` khoá
    chuỗi băm audit toàn cục cũng bị giữ suốt lô (T6 m-1, đo 709 ⇒ 1710 ms cho 200 tag) — không đường STOP nào bị chặn; R1b-2b (chèn nhiều hàng).
12. Mã TOTP có thể vẫn bị tiêu sau khi quá hạn 3 s (lượt kiểm bị bỏ rơi chạy nốt — D10); người dùng chờ mã kế, không ghi cấu hình. Sửa `unit` chỉ khoảng
    trắng đi không mã / không audit (nhãn hiển thị — chấp nhận T8). Client chưa có form sửa cột nhịp (nhánh `tagForm.id` chết — R1b-2b).

**Kết nối (T13)**
13. **MC: mọi item lỗi ⇒ coi là mất liên lạc ⇒ vòng nối lại** — cái giá fail-closed được chấp nhận (ruling T13 r2): một cấu hình MC mà MỌI địa chỉ sai sẽ
    nối lại liên tục thay vì báo "connected"; chỉ ảnh hưởng `connected` / D1.
14. Phiên mà MỌI tag cấu hình sai vẫn có thể báo `connected` (T13 m4) — R1b-2b. Cờ V2 tắt: `BAD 255` sửa xong phát mẫu xấu TRẦN (không lý do).
15. Đường push: mẫu xấu không lý do = chưa trả lời (fail-closed); lỗi driver quên gắn lý do làm chậm `connected` (chiều an toàn).

**Mã dự phòng (T10)**
16. > 10 lượt song song cùng một mã vừa tiêu: lượt thứ 11 trở đi bị `TAM_KHOA` trước khi kiểm và không được hoàn (đếm dư, K16). Khoá do mã SAI đặt giữa
    cuộc đua giữ nguyên. Người thắng trả `true` dù khoá do lượt khác đặt (Q8).
17. Lượt THUA của đăng nhập REST (vé + OTP) vẫn tiêu ngân sách OTP của vé (T10 M5 — thông tin, backlog).

**Kế thừa từ R1b-1 (vẫn đúng)**
18. **TOFU 0434:** một thay đổi định nghĩa xảy ra GIỮA lần duyệt gốc và lúc chạy backfill KHÔNG phát hiện được (status quo trước R1b-1). Khuyến nghị: admin
    rà lại các luật bảo vệ trong TUẦN ĐẦU sau triển khai.
19. **Băm định nghĩa duyệt (`approvedDefHash`) KHÔNG phủ:** nguồn `ot_telemetry` (luật `telemetry_tag` không có tag thiết bị); host / port / giao thức /
    tuỳ chọn kết nối của adapter (chỉ phủ `edgeNodeId`); `writable` / `actuationLevel` của tag đích.
20. STOP do HỆ THỐNG khởi phát (chuyển chủ thiết bị, edge nhả) vẫn ghi MỌI ghim (R1b-1 §6 mục 2; R1b-1 §4 mục 2c bao ghim cũ). Edge `otEdgeDispatch`
    không qua cổng kênh (R1c).
21. Census có điểm mù đã biết (`import * as t`, helper khác tệp, FOR SHARE / SQL thô / bí danh import) — R1b-2b mục 25.

### DỮ LIỆU

22. `_test`: rác R1b-1 đã dọn (T14, 81 hàng; chạy lại 0). Còn lại có chủ ý: hàng WORM (`command_log`, `scada_command_attempts`, `control_audit_log`) của
    mọi lưới + 6 dòng STOP_QUA_HAN mỗi lượt của `oversightPosturePhamVi.r1b2.db.test.ts`; người dùng 130871 + mồ côi WORM (không xoá được — T14).
23. Luật không vị trí chỉ đếm cho phạm vi toàn quyền ở posture (đồng nghĩa với trang interlock — D11).
24. PRODUCTION chưa đo: truy vấn §4 mục 2, census I4 (mọi tag int — R1b-2b mục 35), ghim cũ §4 mục 2c của R1b-1.

### VẬN HÀNH

25. **Bench OpenPLC cho L1 chờ OK điều phối** — L1 hôm nay chỉ có số đo lưới (stub) + chạy khô trên Modbus giả.
26. Safety PLC trong lưới / bench là PLC giả (D9).
27. `.env` của cây chính và worktree vẫn `OT_CONTROL_ENABLED=true` (có từ trước, R1b-1 §6 mục 33) — không sửa (luật); điều phối / chủ dự án quyết.
28. Posture trên EngineeringHub cache 30 s (đổi phạm vi người dùng ⇒ số cũ tới 30 s).

## 9. Checklist bật cờ

R1b-1 §7 vẫn áp dụng nguyên văn. R1b-2a đóng / thêm các mục sau:

- [ ] **P1-1 — khai mức hàng loạt ĐÃ CÓ** (`scadaKenh.khaiHangLoat`, trang Kênh & giới hạn M12: chọn ≤ 200 tag của MỘT adapter, một mã TOTP, tất-cả-hoặc-
      không, audit từng tag + một dòng tổng). Trước khi bật `AI_OT_CONTROL_ENABLED` trên một DB đã có tag ghi được: khai mức tác động cho MỌI kênh AI cần
      ghi (tag chưa khai mức = mức 5 ⇒ AI bị từ chối, fail-closed).
- [ ] **Tag ghim DỪNG phải ở mức 1.** STOP HMI chỉ gửi ghim của tag `actuationLevel ≤ 1`; khai mức hàng loạt / `capNhat` TỪ CHỐI nâng mức một tag đang
      ghim từ ≤ 1 lên > 1 (`STOP_PIN_GO_TRUOC` — gỡ ghim trước). Đếm trước (chỉ đọc): `SELECT count(*) FROM device_tags WHERE stop_value IS NOT NULL AND
      "isEnabled" AND writable AND (actuation_level IS NULL OR actuation_level > 1);` — mỗi hàng là một ghim STOP HMI sẽ KHÔNG gửi.
- [ ] Truy vấn trước triển khai §4 mục 2 = **0 hàng** trên DB đích TRƯỚC bản build; census I4 trên PRODUCTION (mọi tag int).
- [ ] Kỹ sư bảo trì đã đăng ký 2FA (khai mức hàng loạt, cột nhịp của tag được bảo vệ, wizard onboarding nay có ô mã — T11).
- [ ] Bộ giám sát đọc `/health`: CÓ MẶT `schemaR1a` (kể cả `dang_kiem`) = chưa khoẻ về schema.
- [ ] Người vận hành biết băng đỏ "DÙNG E-STOP CỨNG TẠI MÁY" (DB chậm hoặc quá 600 STOP / phút) — E-STOP cứng là đường dừng THẬT duy nhất khi
      `OT_CONTROL_ENABLED` còn tắt (D9).
- [ ] **`AI_OT_CONTROL_ENABLED` GIỮ TẮT.** R1b-2a là ĐIỀU KIỆN CẦN. Bật cờ là quyết định của chủ dự án sau một rà soát / kiểm định độc lập riêng;
      báo cáo này KHÔNG nói "đã sẵn sàng bật".

## 10. Quyết định của bộ điều khiển và điều phối (sổ R1b-2a)

**Điều phối 2026-10-25 (kế hoạch DUYỆT, có hiệu lực như Global Constraints):** thực thi sau khi R1b-1 qua kiem-dinh và đã gộp (bước 0 `3143a9698`);
Q1 có · Q2 duyệt (|thô| ≥ 2^53 ⇒ `OUT_OF_RANGE`) · Q3 duyệt (600 hằng trong mã) · Q4 duyệt kèm điều kiện (từ chối do hạn ghi attempts + audit mã riêng,
đếm vào posture; băng đỏ cố định, không toast; đã gọi `dispatch()` thì không bao giờ từ chối vì hạn; test + đột biến cho cả ba) · Q5 duyệt (bộ đếm TOTP
kết nối riêng + hạn 3 s) · Q6 duyệt (một lô = một adapter; `STOP_PIN_GO_TRUOC` khi nâng mức tag ghim, cả `capNhat`) · Q7 có (`unit` cũng cần TOTP) · Q8
duyệt kèm điều kiện (chỉ hoàn lượt cùng `userId` + cùng mã đã tiêu ≤ 10 s; test 20 lần phát lại; mã sai xen kẽ vẫn khoá) · Q9 duyệt (năm mục dư T3 / T4
sang R1b-2b) · **Q10 có — bench chỉ khi điều phối OK ngay lúc đó**. Bổ sung T12: lọc phạm vi nhà máy cho `oversight.posture` (gỡ dòng sổ nợ đọc). Không
migration; T14 chốt cứng (`current_database()` kết thúc `_test`, mặc định chạy khô, không bao giờ DEV).

**Điều phối trong lúc thực thi:** T3 khoá theo PHIÊN được duyệt; lỗ limiter chung giao kiem-dinh W21 (đã gộp main); hai hàm limiter tách tới khi R1b-2a
gộp rồi hợp nhất (điều phối giao); Postgres :5434 khởi động lại (`max_locks_per_transaction` 64 → 256 — gốc của nhiều "đỏ do tải"); T13: vá BAD 255 và
timeout S7 / MC được duyệt, ghi vào báo cáo này (§6); K13 thành ràng buộc + census (§7); dynamic i18n key ⇒ kiem-dinh W23; T4 M-7 ⇒ kiem-dinh.

**Phán quyết của bộ điều khiển (preflight K1–K19, ràng buộc như kế hoạch):** K1 sửa khối SQL báo cáo R1b-1 cùng commit · K2 SQL chỉ phủ lưới thô +
không parse được · K3 mảng / đối tượng / Symbol / "" / khoảng trắng ⇒ `TYPE_MISMATCH` (lệch brief `[25]` ⇒ 25) · K4 cả hai nơi gọi ép kiểu nhận scale /
offset, test chẵn lẻ cổng 1 ↔ pass 1 · K5 `loadStopPinsHmi` · K6 MỘT ngân sách cho pha trước-gửi, dispatch ngoài · K7 dòng attempts + audit + băng đỏ +
posture · K8 ORDER BY id ở `deviceAdapterRouter` + `stopPin` · K9 test phạm vi bằng fixture DB thật, không mock helper · K10 `loiGoGhimTruoc` thêm
`tagId` · K11 posture lọc theo tập id · K12 cập nhật test `kiemSchemaR1a`, "0433" một lần · K13 push "đã trả lời" = poll · K14 cầu chì `_test` trên đúng
kết nối ghi + id tường minh · K15 đồng hồ giả, thật < 10 s · K16 20 lần phát lại TUẦN TỰ, "không ghi" = không hàng khoá + bộ đếm ròng không đổi · K17
mọi nơi phát `STOP_PIN_NGOAI_DAI` truyền `goiY` · K18 sửa chú thích "STOP không bao giờ bị phần mềm chặn" cũ · K19 0434 thuộc R1b-1; dải 0435–0436.

**Phán quyết theo task:** T1 c3 float chưa khai ⇒ `TYPE_MISMATCH` (vào T2) · T1 c8 `adapterIdForMachine` ORDER BY (vào T5) · T1 sửa bảo mật SPI (điểm lưới
gần nhất TRONG trần ±50 µm, không có ⇒ không đề xuất) · T1 M1 chấp nhận, M7 ⇒ T2 · T2 m3 ⇒ R1b-2b, m4 ⇒ backlog báo cáo này · T3 c1 khoá theo openId + băm
`header.payload` của vé (per session), c2 bỏ mount `/trpc` chết, c3 băng đỏ cho 429 (vào T4), c4 fail-open chấp nhận; r2 băm phần đã ký; r3 một bộ đọc
cookie chung với auth · T4 r1 MỘT hạn toàn yêu cầu 2,5 s từ `createContext` (xác thực min(1,5 s, còn lại), middleware DB bị chặn bởi phần còn lại),
503 thay 408, M-1…M-5; M-6 ⇒ R1b-2b; M-7 ⇒ điều phối · T5 r1 `FOR SHARE` adapter trong `datStopPinTx` + ORDER BY ở `machineControl`; m-2 ⇒ T6; m-4 ⇒ T14;
m-6 ⇒ R1b-2b · T6 polish m-2…m-5 + nới biên `scadaKenhTotpHan` (5000 ms); m-1 ⇒ R1b-2b · T7 c1 theo BRIEF (ô mã có sẵn trong hộp lô), c5 nhắc ghim đúng
luật máy chủ; polish 4 mục · T8 c3 / c4 chấp nhận (trim, CLI chặt hơn), c5 ⇒ R1b-2b · T9 polish (typo, xếp lại một lần khi chèn tổng kết lỗi) · T10 r1 I1
(lượt phát lại tự đặt khoá ⇒ audit `phat_lai` + `TAM_KHOA`), M1–M4; M5 ⇒ backlog báo cáo này; lỗi hai-SELECT tự phát hiện + sửa · T11 polish · T12 polish
M-1…M-5 · T13 c2 mẫu xấu không lý do = chưa trả lời; r2 vá I1 / I2 (commit riêng cho I2), cờ tắt phát mẫu xấu trần (chấp nhận), vòng nối lại MC (chấp nhận,
ghi giới hạn); r3 census `stale` mở rộng · T14 fix: ghim host:port = `DATABASE_URL`, test STOP chưa ack.

**Lệch kế hoạch đã ghi (có lý do):** `hoanLuotThu` có tham số thứ tư `cuaSo` (T10 — chặn hoàn lượt ăn vào đếm của mã SAI); T4 đường ống theo từng adapter
(adapter khoẻ không chờ adapter chậm); `trpcLinks` biến mọi 429 của `dungMay` thành lỗi tRPC `httpStatus 429`; T7 ô mã có sẵn trong hộp lô; S1 của báo cáo
này đo 8 thủ tục thay cho 7 (thay `applyImport` admin-only bằng `khaiHangLoat` + `setStopPin`); TDD đảo thứ tự ở T6 / T7 / T8 / T11 / T12 (đột biến thay cho
bước đỏ); vài lần dùng heredoc trái luật ở T1 / T7 / T9 / T10 / T12 (nội dung được test xác nhận; ghi ở từng báo cáo task).

**Mục tạm gác (parked):** bench OpenPLC L1 (chờ OK — §3); hợp nhất hai limiter (điều phối giao sau gộp); kế hoạch R1b-2b (viết sau khi R1b-2a được duyệt).

## 11. Backlog R1b-2b

**Từ kế hoạch R1b-2a (danh sách R1b-2b, 41 mục — giữ nguyên số):**
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
19. T4: nạp bộ đệm sống (`napTuOt`) khi DB treo — `onMauBoQua` qua `TuyChonVongPoll` và 7 driver.
20. T4: thử lại lô mẫu xấu bị bỏ.
21. T3: watchdog thừa mẫu cho đường push.
22. T3: kế toán mất liên lạc khi reset HA.
23. T3 c2: ghi trong lúc phiên chờ lần đọc tốt đầu tiên.
24. T3: thứ tự canh `sinkPhien` legacy (nit).
25. T10a M-2: điểm mù census (`import * as t`, helper khác tệp; kiểm B thời chạy của `otWriteBinding`) — thêm từ T5 m-3: FOR SHARE / SQL thô / bí danh import.
26. T10a M-3: dispatcher join `edge_nodes`.
27. T10a M-4: leo thang `chua_kiem_duoc`.
28. T10a M-5: `performance.now` khi máy ngủ.
29. Loại tệp test khỏi hai ca census `confirmAction`, kèm lý do có ngày.
30. DOM test I-2 cho mọi hộp `SCADA_AI_LEVEL_TOO_HIGH`.
31. T13 m2 (R1b-1): đường FOE thật tới số thô.
32. `validateStopValue` đòi số nguyên cho ghim trên int (ghim 2,5 trên int scale 0,5).
33. Hiệu năng khảo sát khả năng dừng ở mỗi lần poll 5 s của `cheDo.danhSach` (chưa đo).
34. Posture đếm cả luật bật chưa duyệt (đếm dư có chủ ý — xem lại ở R2).
35. Kiem-dinh I4: đo PRODUCTION số tag int chưa khai có scale / offset (DEV 0, TEST 0) trước triển khai — R1b-2a mở rộng sang MỌI tag int (scale 1 cũng bị
    `OFF_STEP` với số lẻ); việc vận hành, nằm trong checklist.
36. Edge `otEdgeDispatch` không qua cổng kênh — thuộc R1c.
37. R1a §8 mục 21: khoá TOTP leo thang / cảnh báo `tam_khoa` lặp.
38. R1a §8 mục 22: màn admin mở khoá TOTP.
39. R1a §8 mục 23: `NganTagAdapter` đòi `machine_control.canView`.
40. R1a §8 mục 24: i18n `TRPC_GIOI_HAN_THU_TUC`.
41. R1a §8 mục 25: các mục P2 còn lại của kiem-dinh — chờ danh sách của điều phối.

**Thêm từ sổ R1b-2a (rà soát / người thực thi / điều phối):**
42. T2 m3: so đọc lại (`readbackCompare`) ở không gian THÔ cho int scale lẻ.
43. T2 m4: bộ đề xuất SPI trên tag float ĐÃ khai xét dải / bước.
44. T4 M-6: lượt ghi log từ chối / sau gửi không có hạn (có sẵn) — bọc hạn.
45. T4 N-3: hạn lệnh (command timeout) cho client Redis của bộ giới hạn STOP (phần dư ngoài 2,5 s).
46. T4 N-4: import động lạnh sau khởi động nằm ngoài hạn STOP — làm ấm lúc khởi động.
47. T5 m-6: đọc phạm vi adapter ĐÍCH của luật interlock không khoá.
48. T6 m-1: khai mức hàng loạt — chèn audit nhiều hàng + `UPDATE … FROM VALUES` + test toàn vẹn chuỗi băm (giảm thời gian giữ khoá chuỗi băm với
    `SEC_PLATFORM=true`).
49. T8 c5: client — xoá nhánh chết `tagForm.id` của `submitTag` hoặc làm form sửa tag thật (cột nhịp).
50. T10 M5: lượt thua của đăng nhập REST tiêu ngân sách OTP của vé.
51. T13 m4: phiên mà mọi tag cấu hình sai vẫn báo `connected`.
52. T13 m1 (ghi chú điều phối): `stale` = đã trả lời chưa có nơi sinh — xem lại K13 khi có nguồn `stale` thật.
53. Hợp nhất hai bộ giới hạn (STOP tier R1b-2a + W21 main): một bộ đọc cookie, một helper phần đã ký, một độ dài băm (điều phối giao sau gộp).
54. T12: posture `theoBuoc` chưa hiển thị; i18n tên bước; vô hiệu cache posture khi phạm vi người dùng đổi (30 s).
55. Census: bộ lọc văn bản của census tuyến (`phamViTuyenCensus`) mong manh (T3 tư vấn ⇒ chủ census qua điều phối); `i18n:check` không thấy khoá động
    (kiem-dinh W23).
56. T4 M-7: `robotStopDegradedAuth.dot10.db` NF5-1 hết giờ 30 s khi chạy trong lô (có sẵn, xanh khi riêng) — kiem-dinh.
57. T1 c7: hậu tố tiếng Việt "(chưa đọc được lưới tag)" trong `rationale` tiếng Anh.

## 12. Commit R1b-2a

| Task | Commit |
|---|---|
| Bước 0 (gộp main `9b56e5743`, R1b-1) | `3143a9698` |
| T1 một luật giá trị int + SPI | `66d72f9bd`, `1b3fd2ff3`, `88f7123d7` |
| T2 lưới thô nhất quán (m5, m4) + float chưa khai | `42e357ef1`, `1f706408c` |
| Gộp main `b2144f584` + sửa test chập chờn scadaSocket | `2b689b2b2`, `c6d501b59` |
| T3 trần STOP theo phiên + kiểm im lặng (N-2) | `2431f0796`, `a94167ebd`, `43a525d55`, `994b9abf6` |
| T4 hạn trước-gửi STOP HMI | `6c1794aab`, `9e53832c5` |
| T5 phạm vi dưới khoá + ORDER BY id + hạn TOTP | `2355371df`, `4395bfd11` |
| T6 khai mức hàng loạt (máy chủ) | `42f00175a`, `49f8088cf` |
| T7 khai mức hàng loạt (giao diện) | `90f6807b5`, `8c4c9a032`, `c9c90e8a7` |
| T8 cột nhịp cần TOTP | `2d41e9140` |
| T9 canh 0433 + xả DIEU_TIET | `332da77b1`, `dfa700f4c` |
| T10 mã dự phòng — người thắng không bị khoá | `bec61259b`, `1a97579b3` |
| T11 wizard TOTP + ScadaDiag một hộp | `8c52f4fd3`, `003fd94b8` |
| T12 `/health` đang kiểm + FK 0433 + posture phạm vi | `554b572cc`, `5b6ec2a94` |
| T13 đường push "đã trả lời" + vá S7 / MC | `dcb4300a9`, `35b9b4a7a`, `a9eda95c6`, `b4a2d38e2`, `e504eec98` |
| T14 dọn `_test` | `b76e6034c`, `bcd806ef9` |
| Gộp main `134293775` | `8e6baab06` |
| T15 nghiệm thu (lưới `r1b2aNghiemThu.db.test.ts` + bench `--r1b2a` + báo cáo + test SQL báo cáo; sửa đỏ do T11: `KHOA_TOTP_TRONG_HANDLER` + một điểm gọi `tamTat` ở `ScadaDiag.tsx`) | commit chứa báo cáo này |

## 13. Bàn giao

- Báo điều phối để giao kiem-dinh. Gộp chỉ sau khi R1b-1 đã gộp (đã gộp: `9b56e5743`). **Không push.**
- Không migration. Không đổi `AI_OT_CONTROL_ENABLED` ở bất cứ đâu.
- Bench OpenPLC L1: chờ OK của điều phối (§3), rồi điền bảng số đo vào §3.
- Viết kế hoạch R1b-2b sau khi R1b-2a được duyệt (§11).
