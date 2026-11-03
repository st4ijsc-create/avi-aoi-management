# Đợt 12 H3.3 — Adapter AI ngoài lên chuẩn client llama: HỢP ĐỒNG (bản nháp do-model 03/11)

Nguồn: spec `docs/superpowers/specs/2026-10-31-harness-tho-ca-hoc-tu-deepseek.md` §H3.3 (C-P6): "stream, lịch sử tool gốc, phân loại
tràn ngữ cảnh, đọc `retry-after`/`request-id` — bộ che phải phủ tham số/kết quả tool trong khối gốc".

## 0. Đã xong ở H3.1 (main d97f81c99) — KHÔNG làm lại
- Phân loại lỗi ổn định `QUOTA / RATE_LIMIT / TIMEOUT / TRANSPORT / CONTEXT_WINDOW_EXCEEDED / AUTH / SERVER / CLIENT` (`nhaCungCap/chung.ts`
  `phanLoaiHttp`, tràn ngữ cảnh theo mã + chữ của ba họ API).
- `Retry-After` (giây / ngày HTTP) ⇒ `choTruocLanThu` (backoff + jitter, trần 10 s, QUOTA không thử lại).

Còn lại ba phần, tách thành ba lô; mỗi lô có cổng riêng và vào main riêng.

## H3.3a — `request-id` (S, không đổi byte gửi đi)
1. `MangNgoai.goiJson` trả thêm `requestId?: string` đọc từ tiêu đề phản hồi theo thứ tự `request-id` (Anthropic), `x-request-id`
   (OpenAI / tương thích), `x-goog-request-id` (Gemini nếu có). Giá trị là DỮ LIỆU NGOÀI ⇒ chỉ nhận `^[A-Za-z0-9_.:-]{1,128}$`, khác ⇒ bỏ
   (không cắt, không làm sạch — tránh ghi rác / chèn dòng vào sổ, log).
2. `KetQuaNhaCungCap.requestId?` và `LoiNgoai` mang `requestId` (cả nhánh lỗi HTTP: 429/5xx vẫn có request-id — đây là lúc cần nhất).
3. Sổ: cột mới `"requestId" varchar(128) NULL` trên `ai_external_calls` (bảng WORM — chỉ ADD COLUMN bằng owner `aoi`, trigger WORM giữ nguyên;
   ghi ở hàng `ket-qua`, kể cả `ketCuc = 'loi'`). **Cần dieu-phoi cấp số migration** (dải cũ 0405–0409 đã dùng hết; main tới 0450).
4. Không đưa `requestId` ra client (chỉ sổ + log máy chủ) — admin xem qua màn sổ hiện có nếu luong-ui muốn hiện (việc riêng).
- Lưới: mỗi nhà cung cấp giả trả tiêu đề ⇒ hàng sổ có đúng giá trị; giá trị bẩn (`\r\n`, 129 ký tự, unicode) ⇒ NULL; lỗi 429 ⇒ hàng
  `loi` mang request-id. Đột biến: bỏ kiểm ký tự ⇒ đỏ; đọc sai tiêu đề ⇒ đỏ.

## H3.3b — lịch sử tool GỐC (M, ĐỔI byte gửi đi ⇒ sau CỜ `AI_NGOAI_TOOL_GOC`, mặc định TẮT; chủ dự án bật)
Hiện tại (`chung.ts` `lichSuXenKe`, `vongAgentNgoai.ts` `tinGoiTool`): tool call của model thành dòng chữ `[gọi công cụ …]`, kết quả tool
thành tin user "Kết quả công cụ …" ⇒ model ngoài không thấy khối tool gốc (đã ghi là giới hạn ở 10.3).
1. Kiểu: `TinNhanNgoai` thêm `goiTool?: Array<{ id: string; ten: string; thamSo: unknown }>` (chỉ `assistant`) và `idGoiTool?: string`
   (chỉ `tool`). `ghepPhan` mang hai trường này qua (mức của phần `dau-ra-model` / `ma-repo` như hiện nay); `tinNhanSach` (danh sách
   trắng trường của cổng) thêm đúng hai trường, KHÔNG gì khác.
2. **Bộ che** (`cheYeuCau`): che `goiTool[].thamSo` bằng `cheGiaTri` (đệ quy, như kết quả tool) và đếm vào `soTruongDaChe`; `id` / `ten`
   KHÔNG che nhưng `id` phải khớp `ID_GOI_TOOL_NGOAI` = `^ngoai-[0-9A-Za-z_-]{1,8}-\d{1,4}$` (do chính bộ chuyển phát; cũng là khuôn id Anthropic) và `ten` phải thuộc tập tool đã cấp ⇒ khác ⇒
   `NGOAI_KHONG_QUA_BO_GHEP` (không gửi). Lưới che: bí mật / PII đặt trong tham số tool và trong kết quả tool ⇒ không còn trong thân HTTP
   của CẢ ba họ API (đọc thân thật từ `datFetchNgoaiChoTest`).
3. Ánh xạ từng họ (chỉ khi cờ BẬT; TẮT ⇒ đường `lichSuXenKe` cũ, thân HTTP TRÙNG TỪNG BYTE — lưới ghim bằng ảnh chụp thân):
   - OpenAI / tương thích: `assistant.tool_calls[{id, type:"function", function:{name, arguments: JSON}}]` + `{role:"tool", tool_call_id, content}`.
   - Anthropic: khối `tool_use{id,name,input}` trong `assistant`, `tool_result{tool_use_id, content}` trong `user` NGAY SAU; nhiều kết quả
     liền nhau gộp một tin user; system tách riêng như nay.
   - Gemini: **GIỮ ĐƯỜNG CHỮ** cả khi cờ bật (quyết lúc làm 03/11): lịch sử `functionCall` của Gemini đời mới đòi `thought_signature` của
     chính lượt trước — ta không lưu ⇒ 400. Lời gọi thành dòng `[gọi công cụ …]` (tham số ĐÃ CHE), kết quả tool như cũ.
   - Lịch sử client (`lich-su-client`) KHÔNG có id do bộ chuyển phát ⇒ luôn đi dạng chữ như nay (không nâng cấp tin cũ thành khối gốc).
4. `vongAgentNgoai.ts`: khi cờ BẬT, assistant mang `goiTool` thay cho dòng `[gọi công cụ …]`; tool mang `idGoiTool`. Kiểm `idDaPhat` giữ nguyên.
5. Census `duongVong` / `phanLoaiNut` cập nhật nếu đổi điểm (ghim lại, báo số).
- Đo: không có GPU (model ngoài). Trước khi chủ dự án bật: 6 bài agent-f chế độ hỏi qua MỘT nhà cung cấp chủ dự án chọn, cờ tắt/bật, so
  số vòng + đúng/sai (chi phí thật — chủ dự án duyệt ngân sách). Không có đo ⇒ cờ TẮT.

## H3.3c — stream (M–L, đề xuất HOÃN, cần quyết)
Lý do hoãn: (1) kiểm đầu ra của cổng (trần 256 KB, toolCalls theo tập đã cấp, băm câu trả lời WORM cho dấu nguồn) chạy trên câu trả lời
ĐỦ — stream đưa chữ ra trước khi kiểm, không rút lại được; (2) `MangNgoai` hiện đọc thân ≤ 4 MB một lần qua `fetchGhim` — SSE cần bộ đọc
luồng có trần + hạn không hoạt động, ba bộ phân tích SSE; (3) bề mặt agent không cần (lõi nhận chữ khi xong vòng); chỉ chat / coding Hỏi
được lợi — việc giao diện của luong-ui.
Nếu làm: chỉ bề mặt `chat` / `coding`, chỉ CHỮ (tool call chỉ phát khi xong), trần byte cộng dồn cắt luồng giữa chừng ⇒ `NGOAI_PHAN_HOI_QUA_LON`
và tin đã hiện bị đánh dấu hỏng ở client; băm + sổ ở cuối như nay.

## Thứ tự & cổng
H3.3a → kiem-dinh → gộp; H3.3b → kiem-dinh (che là trọng tâm) → gộp (cờ TẮT); H3.3c chờ quyết. Cổng mỗi lô: lưới lô + census toàn cây +
`server/services/ai` + `server/testing` + tsc + check:tests; đột biến bắt buộc cho kiểm ký tự request-id, che tham số tool, ghim byte cờ TẮT.

## Cần dieu-phoi / chủ dự án quyết
1. Số migration cho cột `requestId` (H3.3a).
2. Đồng ý H3.3b sau cờ `AI_NGOAI_TOOL_GOC` mặc định TẮT; ai duyệt ngân sách đo khi muốn bật.
3. H3.3c: hoãn (đề xuất) hay làm sau H3.3b cùng luong-ui.
