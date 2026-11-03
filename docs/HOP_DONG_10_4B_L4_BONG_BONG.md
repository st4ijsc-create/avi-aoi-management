# Hợp đồng ngắn — Đợt 10.4b L4: bong bóng trợ lý WEB + nút kiểm định ở bong bóng

Người viết: luong-ui · 2026-11-03 · gốc: main `25a9de749` · kế hoạch: `docs/superpowers/plans/2026-10-27-dot10-4b-sinh-chu-model-ngoai.md` §4 (L4), §5, D6, D7.
Trạng thái: **CHƯA VIẾT MÃ** — chờ kiem-dinh + dieu-phoi duyệt, và do-model trả lời 3 câu ở §6.

## 0. Hiện trạng đã đo (đọc mã main, chưa chạy)

1. Bong bóng ([AILocalChatBubble.tsx:1699](../client/src/components/AILocalChatBubble.tsx)) đã có `<ChonModel beMat="chat">` và đã gửi `context.chonModel` tới `/api/ai/local-kb/stream` (dòng 563, 580).
2. Tuyến đó với `ngoai:…` (kbNgoai.ts, L1) **đòi `context.conversationId` (số) + hội thoại của chính người gọi** (⇒ 400/404). Bong bóng **không có** `conversationId` ⇒ chọn model ngoài ở bong bóng hiện **gãy** (chưa ai đo bằng e2e).
3. Bong bóng **không** dùng `NoiDungTraLoiNgoai` / `HuyHieuNgoai` / hộp đồng ý (`HopDongYNgoai`, `dongYNgoai`) — AIChatPage đã dùng.
4. `NutKiemDinhNgoai` nhận `NguonKiemDinh` = chat|agent|coding (ID lượt ĐÃ LƯU). Máy chủ `aiKiemDinh` **chưa có** nguồn `van-ban`; test hiện ghim "nguồn van-ban ⇒ BAD_REQUEST" ([aiKiemDinhRouter.test.ts:64](../server/routers/aiKiemDinhRouter.test.ts)). `BeMatNgoai` chưa có `bong-bong`.

## 1. Phạm vi

**Trong:** (a) bong bóng gọi model ngoài đúng hợp đồng L1 (có hội thoại thật, nhãn + huy hiệu, render D6, hộp đồng ý D4); (b) nút kiểm định ở mỗi câu trả lời trợ lý trong bong bóng.
**Ngoài:** extension (do-model, 0.6.0); mở thêm `duocDungO` (bong bóng dùng `chat`, không thêm); máy chủ `van-ban`/migration (do-model, L0a'); agent trong bong bóng (bong bóng không có agent).

## 2. Thiết kế client

**2.1 Hội thoại cho bong bóng.** Chọn model `ngoai:` ⇒ bong bóng tạo/dùng một cuộc trò chuyện thật qua thủ tục hiện có của AIChatPage (cùng cách AIChatPage lấy `conversationId`), lưu id theo phiên bong bóng (`useState`, KHÔNG localStorage), gửi `context.conversationId`. Đổi sang `auto`/model cục bộ ⇒ giữ nguyên đường cũ (không đụng). Đổi nhà cung cấp/model ⇒ hỏi đồng ý lại (D4 / đột biến 16).
**2.2 Đồng ý (D4).** Dùng lại `HopDongYNgoai` + `lib/dongYNgoai` (sessionStorage theo khoá `ncc:model`; `CAN_XAC_NHAN_VAN_HANH` ⇒ hộp một lần/hội thoại). Không viết hộp thứ hai.
**2.3 Render (D6).** Lượt trả lời ngoài trong bong bóng đi qua `NoiDungTraLoiNgoai` (liên kết không bấm, ảnh tắt) + `HuyHieuNgoai` từ `vet`; lỗi theo `MaLoiNgoai`. Bong bóng hiện render markdown riêng ⇒ chỉ nhánh `ngoai` đổi, nhánh cục bộ giữ.
**2.4 Nút kiểm định.** Dưới mỗi câu trả lời trợ lý **đã có nội dung, không đang stream**:
- Nếu lượt đó đã lưu và biết `tinNhanId` + `conversationId` (đường 2.1 hoặc lượt cục bộ có id trả về) ⇒ dùng nguồn `chat` sẵn có (không cần `van-ban`, mức dữ liệu do máy chủ suy từ dấu nguồn).
- Ngược lại ⇒ nguồn `van-ban`: host gọi `aiKiemDinh.chay {chonModel, nguon:{loai:"van-ban", beMat:"bong-bong", cauHoi, traLoi}}`. Client chỉ gửi **văn bản** + `beMat` cố định; KHÔNG gửi mức/nhà máy/đính kèm/ảnh; cắt ở 16 KB TRƯỚC khi gửi (và báo "đã cắt"); nút khoá khi đang chạy, không có trả lời rỗng.
- Hiển thị kết quả qua `HienThiKetQuaNgoai` (như hiện nay). Chỉ hiện khi danh mục có model `ngoai` với `duocDungO ∋ "kiem-dinh"` (đã đúng ở `NutKiemDinhNgoai`).
**2.5 i18n** vi/en/zh cho nhãn mới (khoá dưới `bongBong.ngoai.*`, tái dùng `kiemDinhNgoai.*` nếu có); `npm run i18n:check`.

## 3. Tệp (dự kiến)

Sửa: `client/src/components/AILocalChatBubble.tsx`, `client/src/components/ai/NutKiemDinhNgoai.tsx` (thêm biến thể nguồn `van-ban`), `client/src/lib/*` (nếu cần hàm tạo hội thoại dùng chung), `client/src/i18n/locales/{vi,en,zh}`.
Mới: `client/src/components/ai/bongBongNgoai.ts` (hàm thuần: cắt 16 KB, chọn nguồn chat|van-ban, dựng input) + test.
Không đụng: `server/**`, `shared/**`, `vscode-extension/**`.

## 4. Test + đột biến (đều chạy thật, ghi số đột biến bị bắt)

| # | Test | Đột biến phải đỏ |
|---|---|---|
| T1 | `bongBongNgoai.unit`: input van-ban chỉ có {loai,beMat:"bong-bong",cauHoi,traLoi}; không có mucDuLieu/nhaMay/dinhKem/anh | thêm `mucDuLieu` vào input ⇒ đỏ |
| T2 | cắt ≤ 16 KB theo BYTE UTF-8 (tiếng Việt/emoji, không cắt giữa ký tự) + cờ "đã cắt" | bỏ cắt / cắt theo ký tự ⇒ đỏ |
| T3 | DOM bong bóng: chọn `ngoai:` ⇒ gửi `conversationId` số; không có ⇒ không gọi mạng | bỏ `conversationId` ⇒ đỏ |
| T4 | DOM: lượt ngoài render qua `NoiDungTraLoiNgoai` — chạy lại ≥ 12 payload D6 trên bong bóng (không `<a href>`, không `<img>`, 0 fetch/Image) | đổi sang bộ render cũ ⇒ đỏ |
| T5 | DOM: chưa đồng ý ⇒ không gọi `/local-kb/stream`; đổi model ⇒ hỏi lại; `CAN_XAC_NHAN_VAN_HANH` một lần/hội thoại | bỏ kiểm đồng ý ⇒ đỏ |
| T6 | DOM nút: hiện khi có trả lời xong + có model kiem-dinh; ẩn khi đang stream/trả lời rỗng/không có model; bấm đúp gọi `chay` MỘT lần | bỏ khoá đang-chạy ⇒ đỏ |
| T7 | census AST: mọi `trpc.aiKiemDinh.chay` ở client chỉ trong `NutKiemDinhNgoai`; mọi `fetch("/api/ai/local-kb/stream")` ở bong bóng có nhánh `ngoai` qua `bongBongNgoai` | thêm gọi `chay` ngoài nút ⇒ đỏ |
| T8 | e2e Playwright (nhà cung cấp GIẢ như 10.4, `e2e/flow-studio/fixtures.ts`): bong bóng ngoài → nhãn + huy hiệu; thân tới nhà cung cấp giả đã che, không `tools`/`nguCanh`; bấm kiểm định → hộp xác nhận → kết quả | bỏ dòng che / thêm `nguCanh` ⇒ đỏ |

Cổng: `tsc` heap 12 GB, `check:tests` (không tăng), `i18n:check`, census client đầy đủ (dieu-phoi chạy bản đủ).

## 5. Phụ thuộc / thứ tự

Client không viết xong trước server: mọi nhánh `van-ban` đứng sau **cờ ẩn** cho tới khi do-model đẩy nguồn `van-ban` + `bong-bong` lên main (hợp đồng input: §2.4). Phần 2.1–2.3 (hội thoại, đồng ý, render) **không phụ thuộc** `van-ban` ⇒ làm được ngay.

## 6. Câu hỏi cho do-model (chặn mã van-ban, không chặn 2.1–2.3)

1. Hình dạng input `van-ban` đúng như §2.4 chứ (`nguon:{loai:"van-ban", beMat:"bong-bong", cauHoi, traLoi}`; trần 16 KB tính trên `cauHoi+traLoi` hay từng trường)?
2. Mã lỗi vượt cỡ/tốc độ: 413/429 trả qua `MaLoiNgoai` nào để UI nói đúng?
3. Bong bóng + model ngoài: máy chủ giữ yêu cầu `conversationId` (như L1) hay muốn bề mặt bong bóng riêng? Client đề xuất **giữ L1** (tạo hội thoại thật) để lịch sử/dấu nguồn/UNTRUSTED dùng một đường.

## 7. Quyết định + điều kiện của dieu-phoi (2026-11-03) — đã duyệt phía dieu-phoi; kiem-dinh còn chờ

Chốt: **GIỮ đường `conversationId` của L1** cho bong bóng (một đường đã kiểm, không thêm bề mặt máy chủ). Điều kiện:
1. **TRƯỚC khi sửa**: e2e (nhà cung cấp giả) tái hiện lỗi hiện tại — chọn model ngoài ở bong bóng ⇒ 400/404 — GHI mã lỗi quan sát được vào báo cáo; sau sửa cùng ca đó xanh (T3/T8).
2. Hội thoại tạo từ bong bóng là hội thoại THẬT (hiện trong lịch sử chat). Chọn model cục bộ/`auto` ⇒ KHÔNG tạo hội thoại (giữ hành vi cũ); test ghim.
3. Nhánh `van-ban` ẩn sau cờ / không render cho tới khi máy chủ có nguồn `van-ban` + `BeMatNgoai "bong-bong"` trên main. Test ghim: "nút chỉ hiện nhánh `chat` khi chưa có `van-ban`" (lượt chưa lưu ⇒ không hiện nút).
4. Cắt ≤ 16 KB theo byte UTF-8, không cắt giữa ký tự nhiều byte; test emoji/tiếng Việt ở biên (T2).
Bắt đầu viết mã phần không phụ thuộc `van-ban` **khi kiem-dinh đồng ý**.

## 8. Trả lời của do-model (2026-11-03) cho §6

1. Input `van-ban` ĐÚNG §2.4: `nguon:{loai:"van-ban", beMat:"bong-bong"|"extension", cauHoi, traLoi}`, zod `.strict()`. **Trần 16 KB = TỔNG byte UTF-8 của `cauHoi`+`traLoi`** (một trần, không từng trường) ⇒ client cắt theo TỔNG (ưu tiên giữ `traLoi`, cắt `cauHoi` trước — client chọn, ghi trong test T2). `traLoi` rỗng sau trim ⇒ BAD_REQUEST. Mức luôn `van-hanh` ⇒ nhà máy phải cho dữ liệu vận hành, không thì 403 `NGOAI_DU_LIEU_VAN_HANH`.
2. Mã lỗi (reason = `MaLoiNgoai`): vượt 16 KB ⇒ 413 `NGOAI_QUA_LON`; trần chi phí/tốc độ ⇒ 429 `NGOAI_VUOT_TRAN`; bấm đúp ⇒ 409 `NGOAI_DANG_CHAY`; xong < 120 s ⇒ `tuBoNho:true`; nhà cung cấp lỗi ⇒ 502 `NGOAI_NHA_CUNG_CAP_LOI` + `phanLoai`. Các mã này `NutKiemDinhNgoai` đã nói đúng cho nguồn khác — chỉ cần ca test cho 413/403 ở nhánh bong bóng.
3. Giữ L1 (hội thoại thật + `conversationId`); lượt đã lưu (`daLuu.tinTraLoiId` + `conversationId`) ⇒ nguồn `chat` theo ID; `van-ban` chỉ cho lượt không có bản lưu máy chủ.
Hợp đồng máy chủ chung với extension E: `docs/superpowers/plans/2026-11-03-ext-e-060-model-ngoai-hop-dong.md` (nhánh `feat/ai-do-ext-e`, do-model báo hash khi xong).
