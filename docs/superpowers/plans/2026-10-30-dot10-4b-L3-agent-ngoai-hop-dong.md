# Đợt 10.4b L3 — Agent máy chủ với model NGOÀI: hợp đồng (v2 — đã nhận ý kiến luong-ui + dieu-phoi + kiem-dinh, 2026-10-30)

## 0. Bổ sung v2 (GHI ĐÈ các mục dưới khi khác)

**dieu-phoi:** (Q2) dùng **0419** cho `ai_agent_runs."nguonModel"`, CHECK dùng CHUNG hằng mẫu với 0417 (`RE_NGUON_MODEL`); SQL gửi trước DEV.
(Q3) **L3b tách** ngay sau L3. Thêm: (d1) lượt ngoài KHÔNG có `delegate` (giao việc 11.8) dù `AI_AGENT_GIAO_VIEC` bật; agent con của lượt
cục bộ KHÔNG chọn được `ngoai:` — test cả hai chiều. (d2) lượt ngoài gắn phiên ⇒ máy chủ đặt `coLuotNgoai = true`. (d3) phần chạm
`quanLyLuotChay.ts` viết SAU khi 11.8 lên main; trước đó chỉ phần độc lập. (d4) "không thẻ duyệt" = hai lớp — tool ghi KHÔNG có trong danh
sách quảng bá VÀ bộ thực thi từ chối, đột biến từng lớp.

**luong-ui:** (u1) lỗi ngoài trước SSE trả THÊM `code` (= `ma`) + `muc` / `tranVuot` đúng `LoiTruocSse`; lỗi cũ giữ `{ ma, thongDiep }`.
(u2) `ThongTinModelBatDau` (shared/agentCore/kieu.ts) mở thành union có nhánh `{ nguon: "ngoai", model, muc }`. (u3) `xong.vetNgoai:
VetNgoaiLichSu` (không callId). (u4) `dang-cho-model.phiaTruoc = 0`. (u5) UI web cho L3 do dieu-phoi quyết; thêm ca hồi quy `cheDo:"hoi"` +
`chonModel` cục bộ chạy y như cũ.

**kiem-dinh:** (k1) lưới THEO TỪNG tool: đường đã giải cho tham số, kết quả list/grep lọc theo đường thật, nhị phân, trần byte/tệp cộng dồn;
lớp ánh xạ tên lõi ↔ bộ đọc là bề mặt mới (đột biến ánh xạ nhầm / đường thô ⇒ đỏ). (k2) `delegate` + mọi tool lõi khác không quảng bá, gọi ⇒
không thực thi; định nghĩa agent từ repo (`.thoca/agents`, `tuRepo`) không bao giờ vào thân gửi ra — `tuRepo` + `ngoai:` ⇒ **400**
`NGOAI_CHI_HOI` (không âm thầm bỏ định nghĩa). (k3) lịch sử nạp phía MÁY CHỦ (resume cùng `sessionId`) cũng là van-hanh ⇒ 428 nếu thiếu
xác nhận — mục 1e áp cho MỌI nguồn lịch sử. (k4) khởi động lại / cắt giữa lúc gọi: khoá bay hết theo TTL, giữ chỗ chưa gửi được hoàn, ý định
không mồ côi vĩnh viễn. (k5) census điểm gọi `ghepPhan` / `goiAiNgoai` thêm điểm mới; census import: không có bản sao thứ hai của bộ đọc
ngoài. (k6) sự kiện lượt chạy (kể cả `ket-qua-tool.tomTat` chứa trích nội dung tệp) của người khác không đọc được. (k7) **bề mặt `agent`
KHÔNG vào `BE_MAT_NGOAI_DUOC_DUNG` cho tới khi L3b xong** + test ghim. `search_docs` ⇒ **L3c** riêng.

**do-model:** tập tool quảng bá = `read_file` · `list_dir` · `grep` (+ `todo_write` lõi tự xử lý). **Bỏ `find_files`** — bộ đọc ngoài chung
chưa có tìm theo tên có lọc `duongThuc`; thêm sau cùng lưới k1 nếu cần. Cổng `YeuCauGoiNgoai` không nhận `signal` ⇒ huỷ chặn TRƯỚC mỗi vòng
(không gọi khi đã huỷ); một vòng đang bay chạy hết rồi lõi dừng `huy`.

**Bước NỐI (`quanLyLuotChay.ts`, sau 11.8) — danh sách BẮT BUỘC trước khi gộp, mỗi mục kèm đột biến:**
(n1) đường vào §1 (a–f) + `code`/`muc`/`tranVuot` (u1) + `tuRepo` ⇒ 400 (k2) + 428 cho lịch sử nạp từ phiên (k3);
(n2) `delegate` hai chiều (d1); (n3) `nguonModel` ghi lúc INSERT (0419) + `coLuotNgoai` phiên (d2); (n4) k4 khởi động lại / TTL;
(n5) k6 sự kiện lượt chạy người khác; (n6) test "agent CHƯA trong `BE_MAT_NGOAI_DUOC_DUNG`" (k7) + ánh xạ bề mặt `agent` (danh sách mở)
⇒ `agent-turn` (nguồn mức ở cổng) đúng một chỗ; (n7) **huỷ khi đang bay**: `YeuCauGoiNgoai` CHƯA có `signal` ⇒ hôm nay bộ chuyển chỉ chặn
TRƯỚC mỗi vòng, một cuộc gọi đang bay chạy hết (tốn phí, khoá bay nhả muộn) — L2 cùng giới hạn. Bước nối: thêm `signal` tới `goiAiNgoai`
(huỷ fetch + nhả khoá bay + `huyGiuChuaGui`) HOẶC ghi rõ giới hạn trong báo cáo nghiệm thu; (n8) hồi quy `cheDo:"hoi"` + model cục bộ y cũ (u5).
Trần vòng: bộ chuyển TỰ giữ `TRAN_VONG_AGENT_NGOAI = 6` (vòng 6 không chạy tool, lần 7 ⇒ `NGOAI_VUOT_TRAN`) — không phụ thuộc `gioiHan` nơi nối.

**Đã làm (độc lập với 11.8):** `server/services/ai/ngoai/congCuDocNgoai.ts` (bộ đọc ngoài tách từ L2, L2 dùng lại) ·
`server/services/ai/ngoai/vongAgentNgoai.ts` (cặp GoiModel + BoThucThi; nguồn gốc theo DANH TÍNH: system lõi bỏ, tool chỉ với id bộ chuyển
đã phát, user chỉ = câu hỏi / lịch sử / câu nhắc tĩnh lõi, sàn mức van-hanh khi có lịch sử) + `vongAgentNgoai.test.ts` (12 ca, 12/12 đột
biến đỏ).

**Bước NỐI — đã làm 2026-10-31 (do-model, feat/ai-do-model, sau khi 11.8 + 11.3-C lên main):** đường vào
`server/services/ai/agent/luotChayNgoai.ts` (§1 a–e, TRƯỚC giữ chỗ) + nối trong `quanLyLuotChay.ts` + `aiAgentApi.ts` (`xacNhanVanHanh` vào;
`muc` / `tranVuot` ra). Lưới `quanLyLuotChay.ngoai.test.ts` (19 ca, lõi + bộ chuyển THẬT, cổng giả trong tiến trình) + 1 ca
`quanLyLuotChay.giaoViec.test.ts` (d1 chiều ngược); đột biến bước nối 17/17 đỏ (L16 "ngữ cảnh dự án ra ngoài" sống ở lần đầu vì lớp 1 che lớp
2 ⇒ thêm ca đối chứng đọc tệp quy ước ⇒ đỏ).

| Mục | Trạng thái |
|---|---|
| n1 | a 404 `CHON_MODEL_KHONG_CO` · b 400 `NGOAI_CHI_HOI` · c 404 `NGOAI_KHONG_TON_TAI` (nhà máy ≠ 1, ngoài danh mục, phiên người khác / khác dự án) · d mã cổng + `tranVuot` · e 428 + `muc`, sàn mức PHIÊN đã có lượt (k3: khai `van-hanh` với cổng dù client không gửi lịch sử) · f 409. `tuRepo` (k2): yêu cầu tạo lượt KHÔNG có trường chọn agent, định nghĩa repo chỉ vào qua `delegate` mà lượt ngoài không có ⇒ không có đường 400 nào để trả; lưới ghim "không delegate". |
| n2 | lượt ngoài: công cụ quảng bá đúng `read_file · list_dir · grep · todo_write` dù cờ giao việc BẬT; chiều ngược: định nghĩa con xin `ngoai:` ⇒ `AGENT_KHONG_CO` (bộ đọc định nghĩa loại), không hàng sổ con, không chạm phụ thuộc ngoài |
| n3 | `nguonModel` ghi lúc INSERT (`taoHangLuotChay` kiểm `RE_NGUON_MODEL`, sai ⇒ không tạo hàng) + trả ở danh sách / chi tiết; `coLuotNgoai` đặt (lọc userId) TRƯỚC hàng sổ — hỏng ⇒ 503 `NGOAI_SO_HONG`, nhả chỗ |
| n4 (k4) | không mã mới: khoá bay TTL (`luotBay`), `huyGiuChuaGui` khi chưa gửi, đối soát ý định `khong-ro` (cổng chung L1/L2, lưới `luotBay.db` / `tranChiPhi.db`); boot ⇒ hàng `dang-chay` thành `gian-doan` (sẵn có) |
| n5 (k6) | người khác: `nghe` / `layLuotChay` / `chiTiet` / `huy` đều từ chối (lưới) |
| n6 (k7) | `"agent"` CHƯA trong `BE_MAT_NGOAI_DUOC_DUNG` (lưới ghim) ⇒ hôm nay mọi lượt ngoài = 404 như trước; ánh xạ bề mặt `agent` ⇒ `agent-turn` = MỘT hằng `NGUON_MUC_LUOT_AGENT` (`chonModel/kieu.ts`), census chữ `"agent-turn"` ghim số theo tệp |
| n7 | GHI GIỚI HẠN (không thêm `signal`): huỷ chặn TRƯỚC mỗi vòng; cuộc gọi đang bay chạy hết (tính phí, khoá bay nhả ở `finally` cổng) rồi lượt dừng `huy` — lưới "không có vòng gọi tiếp". kiem-dinh chấp nhận; KHI MỞ bề mặt (L3b) phải ghi vào hướng dẫn người dùng: "Dừng" không dừng được cuộc gọi đang bay tới model ngoài (dữ liệu đã rời máy, phí vòng đó vẫn tính) |
| n8 | `hoi` + cục bộ (vắng / `auto`): không chạm phụ thuộc ngoài, `nguonModel` null, `bat-dau.model` không phải nhánh ngoài |
| u2/u3 | `ThongTinModelBatDau` = `ThongTinModelCucBo \| ThongTinModelNgoai` (`{ nguon:"ngoai", model, muc }`, `vaiTro?/bangChung?: undefined` để UI cũ biên dịch); `xong.vetNgoai` (không callId) do host gắn |

Nguồn: kế hoạch `2026-10-27-dot10-4b-sinh-chu-model-ngoai.md` D1 (L3 = "Agent máy chủ, `sua`/`tu-dong` khoá với model ngoài; thẻ duyệt
không xuất hiện"), D9 (dấu nguồn), Q-B (`ai_agent_runs.nguonModel`), dòng 69 (hạ tự trị sau lượt ngoài). L2 (`codingNgoai.ts`) đã chứng
minh vòng tool đọc + deny-list `duongThuc` + trần run; L3 dùng lại ĐÚNG bộ đó, không viết bộ thứ hai.

## 1. Đường vào — `POST /api/ai/agent/runs` (không thêm route)

`chonModel: "ngoai:<ncc>:<model>"` (hôm nay trả 404 `CHON_MODEL_KHONG_CO` "model ngoài chưa được cài đặt"). Thứ tự kiểm, TẤT CẢ trước khi
giữ chỗ lượt chạy / tạo hàng sổ / gọi mạng — lỗi = JSON như hôm nay (`{ ma, thongDiep }` + HTTP), KHÔNG SSE:

| # | Điều kiện | Lỗi |
|---|---|---|
| a | `BE_MAT_NGOAI_DUOC_DUNG` chứa `"agent"` | 404 `CHON_MODEL_KHONG_CO` (như hôm nay) |
| b | `cheDo === "hoi"` | 400 `NGOAI_CHI_HOI` (`sua` / `tu-dong` khoá với model ngoài) |
| c | `projectId` danh sách trắng · đúng MỘT nhà máy · model có trong danh mục · `sessionId` (nếu có) là phiên của chính người gọi | 404 |
| d | `kiemTruocNgoai` (cổng tắt / trần ngày / trần run / khoá bay) | theo `HTTP_LOI_TRUOC_SSE` (403/429/409…) |
| e | mức dữ liệu: KHÔNG `lichSu` và phiên chưa có lượt nào ⇒ `ky-thuat`; có `lichSu` ⇒ `van-hanh` ⇒ đòi `xacNhanVanHanh === true` | 428 `CAN_XAC_NHAN_VAN_HANH` |
| f | `DANG_CO_LUOT_CHAY` (một lượt/người, đã có) | 409 |

Thành công: như hôm nay `201 { runId }`, sự kiện qua luồng SSE lượt chạy sẵn có. Lượt ngoài KHÔNG đi qua `chuanBiLuotChayTheoVaiTro`
(không cần khe GPU, không `planInference` cục bộ).

## 2. Vòng — `chayVongAgent` sẵn có + HAI bộ chuyển (adapter)

- `cheDo: "hoi"`, `gioiHan.soLuotToiDa = TRAN_VONG_HOI_NGOAI (6)`; trần cổng theo `runId` của lượt agent (khoá `luot:<runId>`: `soLan` +
  USD giữ chỗ NGUYÊN TỬ) — một lượt agent = một run.
- **GoiModel ngoài** (`taoGoiModelNgoai`, `server/services/ai/ngoai/`): mỗi vòng dựng lại TOÀN BỘ danh sách qua `ghepPhan` (⇒ mức = MAX
  trên mọi tin, mọi vòng), gọi `goiAiNgoai` một khối (không stream), đổi kết quả sang `ManhModel` (chữ + `tool_calls` + usage). `signal`
  của lượt ⇒ huỷ đi tới cổng (khoá bay nhả trong `finally`, giữ chỗ chưa gửi ⇒ `huyGiuChuaGui`).
- **Nguồn gốc từng tin — fail-closed** (bộ chuyển KHÔNG tin hình dạng `TinNhan`):
  - `system` của lõi BỊ BỎ, thay bằng MỘT chuỗi tĩnh (`huong-dan-tinh`). `nguCanhDuAn` = `""` với lượt ngoài: tệp quy ước dự án, bài
    học dự án, trí nhớ, chỉ mục KHÔNG gửi (như L2).
  - `cauHoi` ⇒ `cau-go-lap-trinh`; `lichSu` client ⇒ `lich-su-client` (van-hanh); assistant ⇒ `dau-ra-model`.
  - `tool` ⇒ `ma-repo` CHỈ KHI `tool_call_id` do bộ thực thi đọc ngoài của CHÍNH run này đăng ký (Map runId → id, kèm `duongThuc`); tin
    tool không đăng ký ⇒ ném `NGOAI_KHONG_QUA_BO_GHEP`, lượt dừng `loi`.
- **Bộ thực thi ngoài**: tách bộ tool đọc của L2 (`TOOL_DOC_NGOAI` + thực thi) ra `server/services/ai/ngoai/congCuDocNgoai.ts`, L2 và L3
  dùng CHUNG. Quảng bá cho model ngoài ĐÚNG tập: `read_file` · `list_dir` · `find_files` · `grep` (tên lõi agent, ánh xạ vào bộ đọc
  ngoài: deny-list `shared/aiNgoaiDenyList` trên đường ĐÃ GIẢI `duongThuc` RỒI hộp cát; kết quả lọc theo đường thật; nhị phân từ chối;
  trần byte/số tệp theo run) + `todo_write` (chỉ lập kế hoạch cục bộ).
  KHÔNG quảng bá: `find_symbol`, `search_code`, `search_docs`, `lookup_api`, `compile_st`, `remember`, mọi tool ghi/lệnh. Model gọi tool
  ngoài tập ⇒ KHÔNG thực thi, kết quả lỗi `NGOAI_TOOL_KHONG_CAP`, sự kiện `ket-qua-tool` ok=false.
  ⇒ lượt ngoài KHÔNG BAO GIỜ phát `can-duyet` / `de-xuat-nho` / `checkpoint`.

## 3. Dấu nguồn — migration **0419** (dải còn trống của do-model; SQL gửi dieu-phoi trước DEV)

- `ai_agent_runs."nguonModel" varchar(140)` CHECK `^ngoai:[a-z0-9_-]{1,32}:[A-Za-z0-9._:/@-]{1,96}$` (NULL = cục bộ) — MÁY CHỦ ghi lúc tạo
  hàng sổ; không có đường client nào đặt / sửa.
- Lượt mang `sessionId` ⇒ máy chủ đặt `ai_coding_sessions."coLuotNgoai" = true` (như L2), lọc `userId`.
- Đọc lượt chạy (danh sách / chi tiết) trả `nguonModel` + `vetNgoai` cộng dồn (từ sổ `ai_external_calls` theo `runId`, lọc userId +
  bộ phân giải nhà máy; KHÔNG lộ callId).

## 4. Sự kiện cho client (thêm trường, không thêm loại)

- `bat-dau.thongTinModel`: `{ nguon: "ngoai", model: "ngoai:<ncc>:<model>", muc: "ky-thuat" | "van-hanh" }`.
- `usage` mỗi vòng giữ như cũ (+ `chiPhiUocUsd?`).
- `xong.vetNgoai?: VetNgoai` (cộng dồn mọi vòng) — kiểu trong `shared/ai/sinhChuNgoai.ts`.
- Nhịp sống: luồng lượt chạy đã có keep-alive; một vòng ngoài một khối có thể im ≥ 15 s ⇒ phát `dang-cho-model` trước mỗi vòng (đã có).

## 5. Hạ tự trị sau lượt ngoài (dòng 69 kế hoạch) — đề xuất TÁCH khỏi L3

Lượt CỤC BỘ có tool trong phiên `coLuotNgoai = true` ⇒ `ha-tu-tri` (mọi ghi/lệnh cần người duyệt, `tu-dong` bị hạ về `sua`). Chạm đường
cục bộ (rủi ro hồi quy cao hơn L3) ⇒ đề xuất L3b riêng ngay sau L3, cùng cổng gộp. Trong lúc chưa có L3b: `lichSu` client chứa lượt ngoài
vẫn đi vào lượt cục bộ như văn bản người dùng (hiện trạng) — ghi rõ trong báo cáo.

## 6. Lưới (điều kiện kiem-dinh đã nêu + đột biến)

1. Mọi tool đọc dùng `duongThuc` (đột biến: tool đọc đường thô ⇒ đỏ; tệp `.env` / thư mục bí mật qua symlink/junction ⇒ từ chối).
2. Trần run nguyên tử: hai vòng song song cùng `runId` không vượt `tranVongLuot` / USD (đột biến bỏ khoá ⇒ đỏ).
3. Mức MAX mọi vòng: có `lichSu` ⇒ MỌI vòng `van-hanh` (đột biến tính mức chỉ vòng đầu ⇒ đỏ).
4. `nguCanhDuAn` không ra ngoài: AGENTS.md / bài học chứa chuỗi canh ⇒ không có trong thân yêu cầu máy chủ giả.
5. `cheDo` `sua` / `tu-dong` ⇒ 400 TRƯỚC giữ chỗ: không hàng sổ, không egress, không phí.
6. Tool ngoài tập ⇒ không thực thi (bộ thực thi gián điệp 0 lần gọi), không `can-duyet`.
7. Tin tool không đăng ký ⇒ `NGOAI_KHONG_QUA_BO_GHEP`.
8. Huỷ giữa vòng ⇒ khoá bay nhả, `soLan` trả lại cho vòng chưa gửi.
9. `nguonModel` không đặt được từ client; đọc lượt chạy của người khác ⇒ không thấy vết.
Mọi test: máy chủ giả trong tiến trình, KHÔNG gọi nhà cung cấp thật, không khoá thật.

## 7. Câu hỏi

- **luong-ui:** (Q1) màn agent: chọn `ngoai:` ⇒ khoá ô chế độ về "Hỏi" + hộp xác nhận van-hanh khi có lịch sử (428 ⇒ hỏi rồi gửi lại
  `xacNhanVanHanh: true`) — đồng ý hình dạng §4?
- **dieu-phoi:** (Q2) dùng 0419 cho `ai_agent_runs.nguonModel`? (Q3) tách hạ tự trị thành L3b (§5)?
- **kiem-dinh:** (Q4) §6 đủ chưa; có muốn thêm `search_docs` (lọc `laTaiLieuSanPham` như L1) vào L3 hay để sau?
