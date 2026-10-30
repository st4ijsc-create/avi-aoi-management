# Đợt 10.4b L3 — Agent máy chủ với model NGOÀI: hợp đồng (DỰ THẢO, chờ luong-ui + dieu-phoi + kiem-dinh)

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
