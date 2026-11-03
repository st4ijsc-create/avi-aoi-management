# Đợt 10.4b lô E — Extension VSCode 0.6.0: model ngoài + nút kiểm định ở bong bóng trợ lý — HỢP ĐỒNG (do-model 03/11, chờ dieu-phoi + kiem-dinh)

Nguồn: kế hoạch `docs/superpowers/plans/2026-10-27-dot10-4b-sinh-chu-model-ngoai.md` §2 D8, §5 "Extension 0.5.0 (lô E)"; điều kiện dieu-phoi 03/11.
**Đổi phân việc (dieu-phoi 03/11):** kế hoạch §3 giao E cho luong-ui ⇒ nay **do-model**; chỉ trong `vscode-extension/` (+ `shared/` nếu dùng lại
module deny-list — báo trước khi sửa `shared/`). E **chỉ phụ thuộc máy chủ L0–L3** (đã có) + `aiKiemDinh.chay`; KHÔNG chờ L4-bong-bóng web
(luong-ui). Bản: **0.6.0** (đang 0.5.2 — giữ màu trả lời: AI cam, người dùng xanh). Nhánh `feat/ai-do-ext-e` từ main `25a9de749`.
KHÔNG mở bề mặt agent ngoài; KHÔNG dùng phiên chia sẻ extension (2FA); không chạm `client/`, không sửa thư mục của luong-ui.

## 1. ĐÃ CÓ từ 0.5.0 (5283337b1, luong-ui) — chỉ GHIM thêm test + đột biến, KHÔNG viết lại

| Mục điều kiện 3 | Hiện trạng (mã) | Ghim hiện có | Việc E |
|---|---|---|---|
| Modal xác nhận do HOST, không tin webview | `bangChat.ts` `hoiDongY` = `vscode.window.showWarningMessage(…, { modal: true }, "Đồng ý gửi")`; 428 `CAN_XAC_NHAN_VAN_HANH` ⇒ hỏi MỘT lần cho (hội thoại, model); webview không gửi được cờ đồng ý | `hoiNgoai.unit.test.ts` (luồng 428 với `hoiDongY` tiêm) | ghim VĂN BẢN `modal: true` + nút duy nhất + không đọc cờ đồng ý từ thông điệp webview; đột biến: bỏ `modal`, lấy đồng ý từ webview ⇒ đỏ |
| Tool ngoài tập ⇒ host từ chối + vòng dừng | đường ngoài là HỎI, **không có công cụ** (thân tối giản `dungThanNgoai`: câu hỏi + lịch sử + cờ); agent từ chối khi `laChonNgoai`; ô extension không bao giờ có mục ngoài cho agent (`duocDungOExtension` = chỉ `chat`) | `hoiNgoai.noiDay.unit.test.ts` (hoiNgoai không gọi `chayToolCucBo` / MCP / `phienAgent.chay` …) | thêm ca: phản hồi SSE ngoài có `tool_calls` / khối lệnh ⇒ host KHÔNG thực thi gì (không đề xuất ghi, không chạy lệnh), lượt dừng ở chữ; đột biến: nối `xuLyDeXuatCucBo` vào nhánh ngoài ⇒ đỏ |
| `.env` đang mở KHÔNG tự đính kèm | thân ngoài không có ngữ cảnh workspace / tệp mở / đính kèm / @mention | `noiDay` (không `thuThapNguCanh`, không `dungKhoiTepNgoai`) + `modelNgoai.unit.test.ts` `dungThanNgoai` | ca HÀNH VI: mở `.env` + vùng chọn + đính kèm sẵn ⇒ thân gửi đi (đo ở nhà cung cấp giả, §3) không chứa tên / nội dung; đột biến ⇒ đỏ |
| CSP webview chặn ảnh / connect | `htmlBang.ts`: `default-src 'none'; img-src data:; style-src 'nonce-…'; script-src 'nonce-…'` | `htmlBang.agent.unit.test.ts` (chuỗi CSP, không `img-src https:`/`*`) | thêm: không `connect-src`, không `frame-src`; ảnh markdown ngoài trong câu trả lời ngoài KHÔNG thành `<img src=http…>` (bộ render không tin cậy); đột biến: nới CSP / render ảnh ⇒ đỏ |

## 1b. MÁY CHỦ (làm TRƯỚC mã E — dieu-phoi 03/11): nguồn kiểm định `van-ban` — dùng chung cho L4 bong bóng web (luong-ui) và E
- `aiKiemDinh.{xemTruoc, chay}` nhận thêm `nguon: { loai: "van-ban", beMat: "bong-bong" | "extension", cauHoi, traLoi }` (zod `.strict()`: không
  mức / nhà máy / đính kèm / ảnh / trường lạ; `beMat` khác ⇒ BAD_REQUEST). Trần **16 KB = TỔNG byte UTF-8 `cauHoi + traLoi`** ⇒ quá ⇒ 413
  `NGOAI_QUA_LON` (cả `xemTruoc`); `traLoi` rỗng ⇒ BAD_REQUEST như cũ.
- KHÔNG đọc kho (chữ do client gửi) ⇒ mức **LUÔN `van-hanh`** (nhà máy phải `choDuLieuVanHanh`, không ⇒ 403 `NGOAI_DU_LIEU_VAN_HANH`); bề mặt ghi
  `nguonMuc.beMat` = `bong-bong` / `extension` (chỉ nhãn — mức từ phần ghép). Chống lặp 409 / bộ nhớ 120 s / trần chi phí 429 như nguồn khác.
- Lượt CÓ bản lưu máy chủ ⇒ client dùng nguồn theo ID (`chat` …) — `van-ban` chỉ là đường dự phòng (đã trả lời luong-ui §6).
- "BeMatNgoai bong-bong" của dieu-phoi = nhãn `beMat` của nguồn văn bản (bong bóng chọn model bằng danh mục `chat` như hiện nay — không thêm mục
  vào `BE_MAT_NGOAI_DUOC_DUNG`).
- Lưới `aiKiemDinhRouter.test.ts` (+4 ca, sửa ca "van-ban ⇒ BAD_REQUEST" thành 6 dạng sai): đột biến 7/7 ĐỎ (mức ky-thuat, bỏ trần, trần từng
  trường, trần ký tự, đi qua kho, bỏ strict, beMat lỏng).

## 2. MỚI trong 0.6.0

### E1 — nút "Kiểm định bằng AI ngoài" ở BONG BÓNG TRỢ LÝ (extension)
- Hiện trên MỌI bong bóng trợ lý đã xong (không đang stream, có chữ), khi danh mục có model ngoài `duocDungO ∋ "kiem-dinh"`.
- **Nguồn:** câu trả lời model ngoài máy chủ đã lưu (`done.daLuu = { tinNguoiDungId, tinTraLoiId }` của L1 + `conversationId` máy chủ) ⇒ nguồn
  THEO ID `{ loai: "chat", cuocTroChuyenId, tinNhanId: tinTraLoiId }` (máy chủ đọc kho, tự suy mức); câu trả lời model CỤC BỘ (không có bản lưu máy
  chủ) ⇒ nguồn `van-ban` §1b `{ loai: "van-ban", beMat: "extension", cauHoi, traLoi }` — HOST lấy chữ từ bản ghi CỦA HOST (không nhận chữ từ
  webview), cắt ≤ 16 KB theo byte UTF-8 (không chẻ ký tự) + báo "đã cắt".
- Không tự chạy: người dùng bấm ⇒ host chọn model kiểm định (QuickPick các model ngoài có `duocDungO` chứa `kiem-dinh`) ⇒ host gọi
  `aiKiemDinh.xemTruoc` (ước chi phí, mức dữ liệu) ⇒ **modal host** (`showWarningMessage({modal:true})`: model, mức, chi phí ước) ⇒ đồng ý mới gọi
  `chay`. Webview chỉ gửi "bấm nút trên bong bóng i" — host tra id từ bản ghi CỦA HOST (không nhận id / model / tiêu chí từ webview).
- Kết quả **KHÔNG TIN CẬY**: render qua bộ render không tin cậy hiện có (`lamKhongTinCay` / markdown an toàn — liên kết thành chữ + tên miền, không
  ảnh, không HTML), nhãn "AI ngoài — không tin cậy", không nút áp / không chạy lệnh từ kết quả; lỗi theo mã (`NGOAI_DANG_CHAY` 409, `tuBoNho`, trần).
- Lưới + đột biến: nút chỉ ở bong bóng trợ lý có id máy chủ; webview gửi id giả / model lạ ⇒ host bỏ qua; không xác nhận ⇒ không gọi `chay`;
  `xemTruoc` lỗi ⇒ không modal không gọi; kết quả có `<img>`/link/HTML ⇒ render an toàn; đột biến từng điều ⇒ đỏ.

### E2 — harness LIVE (bắt buộc; scratchpad `extlive-*`, không commit dữ liệu chạy)
- VS Code thật (`test-real-host`, test-electron) + máy chủ thử (_test DB, cổng phiên do-model) + **nhà cung cấp GIẢ** sau `datFetchNgoaiChoTest`
  (hoặc tương thích OpenAI giả ở `127.0.0.1` đăng ký `ai_ngoai_host_noi_bo` của nhà máy thử) ⇒ **đo thân gửi đi tại nhà cung cấp**: khoá / mật khẩu
  đã che; `.env` đang mở không có; câu trả lời giả chứa `tool_calls` / `chay_lenh` / ảnh ngoài ⇒ host không thực thi, không tải; nút kiểm định ⇒ modal
  ⇒ `chay` ⇒ kết quả render không tin cậy.
- "Đã cài" ≠ "nhìn thấy": `vsce package` ⇒ cài vào profile thử ⇒ **sha256 `dist/extension.js` bản cài = bản trong .vsix** ⇒ chụp khung + kiểm DOM
  thật (mã build `0.6.0+<commit>` ở đầu khung, nút ở đúng bong bóng, nhãn không tin cậy). Không cài vào hồ sơ VSCode của chủ dự án.

### E3 — phát hành
`package.json` 0.6.0, README / ghi chú phát hành (giới hạn: chỉ Hỏi; kiểm định chỉ câu trả lời đã lưu máy chủ; không agent ngoài). Lưới
`tenHienThi` (Thợ Cả), census extension (`GHI_DUNG_MOT_LAN` trên bundle) xanh.

## 3. Cổng
`vscode-extension` unit + census bundle + `test-real-host`; census toàn cây + `server/services/ai` + `server/testing` (không đổi máy chủ — chỉ để
chắc không vỡ); tsc gốc + check:tests; đột biến mỗi mục §1 và §2; harness LIVE có ảnh chụp + sha256.

## 4. Câu hỏi
- (Q1) ĐÃ GIẢI (dieu-phoi 03/11): câu trả lời cục bộ kiểm định qua nguồn `van-ban` §1b — không cần lưu lượt cục bộ lên máy chủ.
- (Q2) Máy chủ thử cho harness LIVE: cổng 3013 (do-model) với `_test` DB + nhà cung cấp giả — đồng ý?
