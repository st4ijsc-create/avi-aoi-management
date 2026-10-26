# Kế hoạch Đợt 10.2 — ô chọn model ở mọi bề mặt (luong-ui)

> Người viết: luong-ui · 2026-10-26 · Spec: `docs/superpowers/specs/2026-10-26-ai-local-chon-model-va-kiem-dinh-ngoai-design.md` §4 (A3) · Hợp đồng máy chủ (do-model, đã trên main 84a308ee6): `aiChonModel.danhMuc` ⇒ `MucModel[]`, mã `auto | vai-tro:<id> | ho-so:<profileId> | ngoai:<ncc>:<model>`, trường theo bề mặt: KB `context.chonModel`, agent body `chonModel`, node Luồng `thamSo.chonModel` (chuỗi CỐ ĐỊNH), /v1 `model`.
> Trạng thái: **CHỜ dieu-phoi duyệt** — chưa làm.

## 0. Hiện trạng đã đo (client)

| Bề mặt | Hiện nay | Điểm sửa |
|---|---|---|
| Chat AI `/ai-chat` | không có ô; payload `local-kb/stream` có `context` (AIChatPage.tsx ~325) | thêm `context.chonModel` |
| Bong bóng `AILocalChatBubble` | không có ô; `context: copilotContext` ở 2 chỗ (ask ~584, stream ~734) | thêm `chonModel` vào context |
| AICodingWorkspace | ô `auto|code` (`tangModel`, localStorage `repoWs.tangModel`) ⇒ `context.modelTask` | thay bằng ô mới; `modelTask` cũ thôi gửi |
| Lượt agent | `agentApi.ts` thân POST không có model | thêm `chonModel` + ô ở bảng khởi động lượt |
| Extension VS Code | một cài đặt máy; thân build ở `src/loi/yeuCau.ts` (`context`: route/ngôn ngữ/codingMode) | ô theo tin nhắn trong webview `src/ui/bangChat.ts` |
| Node Luồng | ô chữ tự do `vaiTro` (datalist 6 vai) ở `ai.llm/trich-xuat/phan-loai/tom-tat`; `ai.agent`/`ai.sinh-ma` chỉ JSON | thay bằng dropdown từ danh mục |
| AISettingsPage | (ghi chú dieu-phoi) tạo khoá API | ô nhà máy + hiện khoá inactive thiếu nhà máy |

Máy chủ đã xử lý `chonModel` của node (`giaiChonModelNut` trong `flow/nut/ai.ts`), KB (`kbChonModel`), agent (`quanLyLuotChay`) ⇒ 10.2 chủ yếu là CLIENT + 3 mảnh máy chủ nhỏ (xem §3).

## 1. Thành phần dùng chung (client/src)

- `hooks/useDanhMucModel.ts` — `trpc.aiChonModel.danhMuc.useQuery` (staleTime 60 s; lỗi/FORBIDDEN ⇒ danh mục chỉ có "Tự động", không chặn bề mặt).
- `components/ai/ChonModel.tsx` — `<select>` có nhóm: **Tự động** · **Vai trò** (`vai-tro:*`) · **Hồ sơ Local** (`ho-so:*`) · **Model ngoài** (`ngoai:*`, chỉ khi danh mục có). Nhãn thêm trạng thái: `san-sang` (không chú), `can-doi-khe` ⇒ "cần đổi khe ~N s" (vắng `uocTinhDoiKheGiay` ⇒ "chưa đo"), `tat` ⇒ vô hiệu hoá + lý do. Tooltip = `moTa`. Props: `giaTri`, `onDoi(ma)`, `beMat: "chat"|"lap-trinh"|"agent"|"luong"` (nhóm vai trò hiện cho phù hợp: bề mặt SINH CHỮ ẩn vai embed/rerank/vision/fim — khớp `beMatChu` của máy chủ), `compact`.
- `lib/chonModel.ts` — `CHON_MODEL_RE` (bản sao có test hợp đồng với `server/services/ai/chonModel/kieu.ts` — census so chuỗi nguồn regex hai phía), `docChonDaLuu(beMat)` / `luuChon(beMat, ma)` (localStorage có try/catch), `xacThucChon(ma, danhMuc)` (mã đã lưu mà danh mục không còn ⇒ về `auto` + toast một lần: "Model đã chọn không còn khả dụng — dùng Tự động"). **"auto" không bao giờ tự đổi sang ngoài.**
- Quy ước lưu: **dính theo bề mặt** (`aiChon.chat`, `aiChon.lapTrinh`, `aiChon.agent`) — mặc định `auto`; không dùng chung giữa bề mặt (chat vs lập trình cần model khác nhau).

## 2. Từng bề mặt

1. **Chat AI + bong bóng** — ô đặt cạnh nút gửi (compact); `chonModel` ≠ auto ⇒ vào `context.chonModel` của `/api/ai/local-kb/{ask,stream}` (hook `useKbChatStream` + `AILocalChatBubble`); `auto` ⇒ KHÔNG gửi trường (không đổi một byte so với nay). Lỗi 400 `chonModelKhongHopLe`/404 ngoài phạm vi ⇒ toast mapTrpcError + trả ô về auto. Hiện chip "model: <nhãn>" trên câu trả lời khi đã chọn tường minh. Khi `can-doi-khe`: câu "cần đổi khe ~N s" hiện TRƯỚC khi gửi (không chặn) — đúng spec A2 (tương tác: báo, không tự đổi khi khoá khe).
2. **AICodingWorkspace** — thay `auto|code` bằng `<ChonModel beMat="lap-trinh">`. Di trú giá trị cũ trong `repoWs.tangModel`: `"code"` ⇒ `vai-tro:code.software`; `"auto"` ⇒ `auto`. `context.modelTask` thôi gửi khi có `chonModel` tường minh (CÂU HỎI cho do-model/dieu-phoi: máy chủ giữ `modelTask` để tương thích hay có thể gỡ? mặc định tôi giữ nhận, thôi gửi). Test hiện có về `data-chon-tang-model` cập nhật.
3. **Lượt agent** — `agentApi.ts`: `chonModel?` vào thân POST khi ≠ auto; ô ở form khởi động lượt agent (cùng `<ChonModel beMat="agent">`); thẻ lượt hiện model thực chạy (đã có `modelBatDau` — dùng lại, thêm nhãn "chọn tường minh").
4. **Extension VS Code** — webview `bangChat.ts`: ô theo tin nhắn, mặc định = lựa chọn lần trước của máy (globalState), khởi từ cài đặt hiện có (không đổi hành vi nếu không đụng ô). `yeuCau.ts` đặt `context.chonModel`. **Cần danh mục qua xác thực của extension (token), không phải phiên tRPC** ⇒ cần một tuyến REST chỉ-đọc `GET /api/ai/chon-model/danh-muc` (cùng xác thực với `/api/ai/local-kb/*`, cùng hàm `layDanhMucModel`) — **mảnh máy chủ #1**. Gói lại `.vsix` (0.3.x ⇒ 0.4.0), cài + xác minh mã build theo quy trình đã có (bài học "đã cài ≠ nhìn thấy").
5. **Node Luồng** — `components/aiFlow/OChonModel.tsx`: dropdown thay ô chữ `vaiTro` ở 4 node `ai.*` có form + khối "Model" phía trên JSON của `ai.agent` / `ai.sinh-ma`. **Tương thích ngược:** giá trị hiển thị = `chonModel` nếu có, không thì `vai-tro:${vaiTro}`; chọn `vai-tro:X` ⇒ đặt `vaiTro=X` và XOÁ `chonModel` (đường cũ, không đổi hành vi); chọn `ho-so:*`/`ngoai:*` ⇒ đặt `chonModel` (chuỗi cố định, KHÔNG biểu thức — ô không nhận `{{ }}`) và giữ `vaiTro` (vết / loại tác vụ); `auto` ⇒ xoá `chonModel`. Luồng cũ mở lên thấy đúng vai cũ đã chọn. Bề mặt `luong` ẩn mục `ngoai:*` cho tới 10.4 (node kiểm định ngoài); sau 10.4 hiện theo danh mục (máy chủ vẫn là nơi chặn thật: luồng toàn cục ⇒ từ chối ngoài).
6. **AISettingsPage** (ghi chú dieu-phoi, phụ thuộc 10.3 Task 7) — ô chọn nhà máy theo phạm vi người dùng khi tạo khoá; hiển thị `kichHoat:false, lyDo:"can-nha-may"` thành badge "Chưa kích hoạt — chọn nhà máy"; khoá chính thức dùng `aiNgoai.taoKhoa` (10.4, không làm ở đây).

## 3. Mảnh máy chủ nhỏ (tôi làm, hỏi trước nếu bạn muốn do-model làm)

- #1 REST `GET /api/ai/chon-model/danh-muc` cho extension (xác thực token như KB API; phạm vi nhà máy như `aiChonModel.danhMuc`; không lộ đường dẫn/khoá). Census route + test.
- #2 `kiemThamSoNut`: `thamSo.chonModel` (mọi node `ai.*`) phải là chuỗi khớp `CHON_MODEL_RE`, không chứa `{{` — lỗi **lúc lưu** (hiện chỉ lỗi lúc chạy).
- #3 Xuất/nhập luồng: `chonModel` dạng `ngoai:*` bị đưa về `auto` + ghi `ViecPhaiDien` (nhà máy đích có thể chưa bật nhà cung cấp); `ho-so:*` giữ (id hồ sơ là toàn hệ thống) nhưng nhập vào nơi không có hồ sơ ⇒ cảnh báo lúc nhập. Cập nhật sổ `phamViNut` (chonModel không phải id nhà máy; không mang bí mật).

## 4. Test và cổng (mỗi mục có đột biến)

- DOM: `ChonModel` (nhóm, trạng thái, vô hiệu `tat`, "chưa đo", ẩn vai không sinh chữ theo bề mặt, mã lưu hết hiệu lực ⇒ auto + toast một lần) · mỗi bề mặt: `auto` ⇒ KHÔNG có trường trong thân; ≠ auto ⇒ có đúng mã (chat/bubble/coding/agent) · `OChonModel` node (chọn vai ⇒ `vaiTro`, chọn hồ sơ ⇒ `chonModel`, luồng cũ hiện đúng vai) · AISettings.
- Hợp đồng/census: `CHON_MODEL_RE` client ≡ server; mã trong dropdown ∈ tập kiểm tĩnh `kiemThamSoNut`; sổ route mới.
- Extension: unit `bangChat`/`yeuCau` (có/không `chonModel`); test host thật (`test-real-host`) cho gói mới.
- e2e production ×3 (instance 3049): (a) Chat AI — chọn "Vai trò: code.software" ⇒ chặn mạng thấy thân có `context.chonModel`; auto ⇒ không có; (b) node Luồng — chọn hồ sơ ⇒ lưu ⇒ CSDL `parameters.chonModel` đúng; chọn vai ⇒ `vaiTro`; mở luồng cũ ⇒ dropdown đúng; (c) biểu thức `{{ }}` trong JSON thô ⇒ lưu bị 400 (#2).
- Cổng lô: test của lô + census + tsc 0 + `i18n:check` (không full suite — theo luật lô).

## 5. Thứ tự đề xuất (mỗi bước một commit, gộp từng bước được)

1. Thành phần dùng chung + #2 (kiểm lúc lưu) + #3 (xuất/nhập).
2. Node Luồng (item 5) — rủi ro thấp nhất, khép vòng với server đã có.
3. Chat AI + bong bóng + AICodingWorkspace (items 1–2).
4. Agent (item 3).
5. #1 REST + Extension (item 4) + .vsix.
6. AISettingsPage (item 6) — sau khi do-model xong 10.3 Task 7.
7. e2e production ×3.

## 6. Câu hỏi cần quyết

1. Extension: tôi làm tuyến REST #1 hay do-model? (xác thực token của KB API nằm ở `aiLocalKnowledgeApi.ts` — gần mã do-model vừa sửa.)
2. `modelTask` cũ: máy chủ tiếp tục nhận (tôi thôi gửi) — đồng ý?
3. Di trú `repoWs.tangModel="code"` ⇒ `vai-tro:code.software` (không phải `code.plc`) — đồng ý?
4. Mặc định mọi bề mặt = `auto`, dính theo bề mặt trong localStorage (extension: globalState) — đồng ý? (Spec không nói; "auto không bao giờ chọn ngoài" luôn đúng.)
5. Bề mặt `luong` giấu `ngoai:*` cho tới 10.4 — đồng ý?
