# Đợt 7 · Pha 7.2 — Bộ đo `plc-st-v1` (sinh mã IEC 61131-3 ST, chấm bằng BIÊN DỊCH + CHẠY) · Kế hoạch thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một bộ đo chấm mã ST do model sinh ra bằng MÁY (biên dịch + chạy theo vector, tất định), kiểm thước trước khi đo
model, để chọn model cho vai trò `code.plc` theo số (spec §3.7, §8.1).

**Architecture:** KHÔNG dựng bộ đo riêng — thêm ngôn ngữ `st` vào bộ NGẪU NHIÊN có sẵn (`scripts/ai-eval/ngau-nhien/`:
kho bài + vân tay + kiểm thước + đường (a) một lượt + đường (b) agent). Kiểu chấm mới `st` gọi toolchain ngoài repo
(`D:\SOURCES\16.AI\toolchains\st\`, dựng bởi tác vụ toolchain) — biên dịch tệp lời giải + tệp test (ST), chạy, đếm dòng
`DAT <tên>` / `TRUOT <tên>`. Bộ định thời chuẩn (TON/TOF/TP) do HARNESS cung cấp, chạy theo ĐỒNG HỒ GIẢ `G_NOW` ⇒ test
không phụ thuộc thời gian thật.

**Spec:** `docs/superpowers/specs/2026-10-20-ai-local-da-model-va-luong-tu-dong-design.md` §3.7, §6 (7.2), §8.1.

## Global Constraints
- Luật kho của `ngau-nhien/README.md` áp nguyên: kỳ vọng suy TỪ ĐẶC TẢ (tính tay), không chép đầu ra của mẫu; không sửa bài
  sau khi đã đo (trừ lỗi đặc tả, ghi `kho/SUA-LOI.md`); báo cáo ghi seed + vân tay.
- Phương ngữ v1: **IEC 61131-3 ST kiểu CODESYS** (khối `FUNCTION_BLOCK … VAR_INPUT … END_VAR … END_FUNCTION_BLOCK`). Siemens
  SCL để v2 (khác cú pháp `#biến`, `REGION`).
- Tất định: mọi thời gian qua `G_NOW` (harness tăng mỗi chu kỳ); không `TIME()`/đồng hồ thật; không ngẫu nhiên.
- Một bài < 10 s chạy (chưa tính biên dịch).
- 30 bài = 24 bài đo + 6 bài GIỮ LẠI (`"giuLai": true` — không ai nhìn khi chỉnh lời nhắc `code.plc`).
- Toolchain thiếu ⇒ trình chấm exit 2 (không thành "model trượt") — như các ngôn ngữ khác.

## Review Focus
1. Lời giải đúng nhưng viết hoa/thường khác (ST không phân biệt hoa thường) ⇒ vẫn ĐẠT; trình chấm không so chuỗi mã.
2. Lời giải tự khai `TON`/`R_TRIG` riêng (trùng tên khối harness) ⇒ lỗi biên dịch "trùng định nghĩa" phải được báo rõ là lỗi của LỜI GIẢI, đề bài phải nói "dùng TON/TOF/TP/R_TRIG/F_TRIG/CTU/CTD/SR/RS có sẵn, không tự định nghĩa".
3. Lời giải treo (vòng lặp vô hạn trong một chu kỳ) ⇒ `het-gio`, TRƯỢT, không treo cả lượt đo.
4. Model trả mã kèm giải thích / nhiều khối ⇒ bộ trích tệp chọn đúng khối (dòng `// tệp:` hoặc `(* tệp: *)` — ST dùng chú thích `(* *)` và `//`).
5. Model thêm `PROGRAM main` riêng ⇒ trùng với harness ⇒ đề bài cấm; trình chấm báo `TEP_THUA_MAIN`.

## Danh mục bài (`kho/st-*`)

Mức theo khuôn bộ ngẫu nhiên: `tt` = logic/thuật toán một POU · `tv` = dùng khối chuẩn IEC (định thời, đếm, sườn, chốt) ·
`ud` = ứng dụng nhiều POU / máy trạng thái.

| # | id | tóm tắt (đặc tả đầy đủ trong `bai.json`) |
|---|---|---|
| 1 | st-tt1-bo-phieu-2oo3 | FB bỏ phiếu 2/3 cảm biến an toàn: `Q`, cờ `LECH` khi một kênh khác hai kênh kia |
| 2 | st-tt2-co-gian-tuong-tu | FUNCTION đổi thô INT 0..27648 → REAL thang kỹ thuật, kẹp biên, cờ ngoài dải (dưới −5 %/trên 117,6 %) |
| 3 | st-tt3-tre-tru | FB trễ (hysteresis) quanh điểm đặt với dải chết |
| 4 | st-tt4-trung-binh-truot | FB trung bình trượt 8 mẫu (bộ đệm vòng), `HOP_LE` sau đủ 8 mẫu |
| 5 | st-tt5-crc16-modbus | FUNCTION CRC-16/MODBUS trên `ARRAY[0..63] OF BYTE` với độ dài |
| 6 | st-tt6-chon-bom-chinh | chọn bơm chính theo giờ chạy ít nhất trong 4 bơm sẵn sàng, hoà ⇒ chỉ số nhỏ nhất |
| 7 | st-tt7-bcd | đổi BCD ↔ INT, cờ lỗi khi nibble > 9 / ngoài 0..9999 |
| 8 | st-tt8-doc-tang-giam | FB giới hạn tốc độ thay đổi (ramp) theo đơn vị/giây với `G_NOW` |
| 9 | st-tv1-chong-doi | FB chống dội hai chiều bằng TON (bật sau `T_BAT`, tắt sau `T_TAT`) |
| 10 | st-tv2-dem-san-pham | đếm sản phẩm bằng R_TRIG + CTU, đủ lô ⇒ `XONG_LO`, reset |
| 11 | st-tv3-nhap-nhay | đèn nháy với thời gian bật/tắt tham số, dừng ⇒ tắt ngay |
| 12 | st-tv4-tre-tat-quat | quạt chạy thêm `T` sau khi tắt lệnh (TOF), dừng khẩn ⇒ tắt ngay |
| 13 | st-tv5-giam-sat-phan-hoi | lệnh chạy mà không có phản hồi sau `T` ⇒ báo động CHỐT tới khi reset |
| 14 | st-tv6-dem-gio-chay | cộng dồn thời gian chạy theo `G_NOW` thành giờ + phút (UDINT), không trôi |
| 15 | st-tv7-canh-bao-xac-nhan | máy trạng thái cảnh báo ISA-18.2: bình thường / chưa xác nhận / đã xác nhận / hết nhưng chưa xác nhận |
| 16 | st-tv8-xung-khoi-dong | xung TP độ dài cố định trên sườn lên, kích lại trong xung bị bỏ qua |
| 17 | st-ud1-bom-luan-phien | hai bơm chính/dự phòng theo phao mức, luân phiên mỗi lần khởi động, lỗi phản hồi ⇒ chuyển bơm |
| 18 | st-ud2-den-giao-thong | máy trạng thái đèn giao thông có nút người đi bộ |
| 19 | st-ud3-bang-tai-tuan-tu | 3 băng tải khởi động ngược dòng có trễ, dừng xuôi dòng, dừng khẩn tắt tất cả ngay |
| 20 | st-ud4-may-tron-me | mẻ trộn: cấp A tới mức, cấp B, trộn `T`, xả; dừng ⇒ đóng mọi van |
| 21 | st-ud5-sao-tam-giac | khởi động sao–tam giác, khoá liên động không bao giờ cùng sao+tam giác, khe chuyển 50 ms |
| 22 | st-ud6-nhiet-on-off | điều khiển nhiệt on/off có trễ + ngắt cao-cao chốt |
| 23 | st-ud7-van-hai-cuon | van mở/đóng có phản hồi hai đầu, báo động quá thời gian hành trình |
| 24 | st-ud8-pi-chong-bao-hoa | bộ PI rời rạc chu kỳ cố định, kẹp đầu ra, chống bão hoà tích phân |
| 25 | st-tt9-dong-goi-bit (GIỮ LẠI) | đóng/mở gói 16 BOOL ↔ WORD |
| 26 | st-tt10-noi-suy-bang (GIỮ LẠI) | nội suy tuyến tính theo bảng 8 điểm, ngoài bảng ⇒ kẹp |
| 27 | st-tv9-dem-xuong (GIỮ LẠI) | CTD đếm xuống từ tồn kho, cảnh báo sắp hết |
| 28 | st-tv10-chot-uu-tien (GIỮ LẠI) | SR/RS: ưu tiên đặt vs ưu tiên xoá đúng chuẩn |
| 29 | st-ud9-ghi-dich-loai-bo (GIỮ LẠI) | thanh ghi dịch theo xung encoder: sản phẩm lỗi AOI được gạt ở vị trí N |
| 30 | st-ud10-thang-nang-2-tang (GIỮ LẠI) | thang nâng hai tầng: gọi tầng, cửa, khoá liên động di chuyển khi cửa mở |

## Tác vụ

### Task 1: Toolchain ST (agent, ngoài repo) — `D:\SOURCES\16.AI\toolchains\st\chay-st.*`
Đầu ra JSON `{ok, giaiDoan, chanDoan[], stdout, maThoat, ms}`; 4 mẫu (đúng · sai-chạy-được · lỗi cú pháp · TON giả). Ghi
cách cài + phiên bản vào README bộ ngẫu nhiên (bảng toolchain).

### Task 2: Kiểu chấm `st` + khuôn `mau-khung/st/` + bộ trích tệp nhận chú thích ST
**Files:** `scripts/ai-eval/ngau-nhien/lib/cham.mjs` (thêm `st`), `lib/moiTruong.mjs` (`AI_EVAL_ST_TOOLCHAIN`),
`lib/trichTep.mjs` (+ `(* tệp: … *)`), `mau-khung/st/` (`src/<POU>.st` khung, `tests/hien_thi.st`, `tests/an.st`,
`tests/kt.st` = harness: `G_NOW`, TON/TOF/TP/R_TRIG/F_TRIG/CTU/CTD/SR/RS, thủ tục `KT_BANG_*` in `DAT`/`TRUOT`).
- [ ] `node --test lib/trichTep.test.mjs` thêm ca ST; kiểm thước một bài ST mẫu: mẫu ĐẠT đủ `soTest`, khung trượt, đột biến trượt, sửa test bị bắt.

### Task 3: 30 bài (song song, agent viết — tôi duyệt + kiểm thước)
Mỗi bài: `bai.json` (deBai đủ để làm đúng; cấm tự định nghĩa khối chuẩn; cấm `PROGRAM`), `khung/`, `an/`, `mau/`, `sai`.
- [ ] `node scripts/ai-eval/ngau-nhien/kiem-thuoc.mjs --only st --label kt-st-1` ⇒ 30/30 đạt mọi kiểm.

### Task 4: Cổng 7.2 (spec §6)
- [ ] Mẫu 30/30 ĐẠT; đột biến bị bắt ≥ 90 % (mục tiêu 100 %); khung 0/30; sửa test bị bắt 30/30; prompt sạch.
- [ ] Ghi kết quả + phiên bản toolchain vào spec §6 (7.2). Commit.
