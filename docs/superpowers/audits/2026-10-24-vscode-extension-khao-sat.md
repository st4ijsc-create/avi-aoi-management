# Khảo sát extension VSCode "AI Local" — giao diện, đính kèm, quyền ghi (2026-10-24)

Phạm vi: `vscode-extension/` (v0.2.0), chủ yếu `src/ui/htmlBang.ts` (1253 dòng, webview) và `src/ui/bangChat.ts` (2224 dòng, host). Người làm: luong-ui. Đọc mã + dựng lại webview thật trong trình duyệt (Playwright, VSCode API giả, biến theme Dark+ ở 380 px) để chụp đúng trạng thái người dùng đang thấy. Ảnh: `2026-10-24-vscode-extension-anh/`.

Giới hạn trung thực: tôi KHÔNG điều khiển được cửa sổ VSCode thật bằng tay (không có ảnh chụp của chủ dự án để đối chiếu từng pixel). Phần "đã chạy thật" ở đây là webview thật (`dungHtmlBang`) nhận đúng các tin mà host gửi; phần host (dán/kéo, duyệt) sẽ được nghiệm thu bằng bộ `test-real-host` (VSCode Extension Host thật) khi sửa.

---

## 1. Giao diện "dại" — gốc có thật, tái hiện được

### 1.1 Markdown thô: HAI đường, cả hai hỏng theo cách riêng
| Đường | Mã | Hiện tượng đo được |
|---|---|---|
| Chat cũ / chế độ SERVER (mọi câu hỏi khi dự án đang chọn là SERVER) | `htmlBang.ts:1045-1048` `khoiTraLoi.textContent += m.chu`; `#hoi-thoai { white-space: pre-wrap }` (`:66`) | Câu trả lời KHÔNG BAO GIỜ qua bộ dựng markdown: `###`, `**`, ```` ```bash ````, bảng `\|---\|` hiện nguyên (ảnh `hien-trang-chat-cu-markdown-tho.png`). Đúng ảnh chủ dự án gửi. |
| Agent (LOCAL) | `htmlBang.ts:794-799` `ag_chu` ⇒ `agDoan.textContent += m.chu`, lớp `.ag-md { white-space: normal }` (`:151`) | Trong lúc stream, xuống dòng bị gộp: cả đoạn dính thành MỘT khối đặc chữ kèm ký hiệu markdown (ảnh `hien-trang-agent-dang-stream-dac-chu.png`); chỉ khi host gửi `ag_md` (`:800-807`) mới thay bằng cây đã dựng. Câu trả lời dài + model chậm ⇒ người dùng nhìn khối thô hàng chục giây. |

Bộ dựng markdown an toàn ĐÃ có và tốt (`src/loi/markdownAnToan.ts`: `marked.Lexer` ⇒ cây danh sách trắng ⇒ `createElement/textContent`, chặn `javascript:`/ảnh/HTML thô) nhưng chỉ nối vào đường Agent, và chỉ ở cuối khối. Không cần thư viện mới: nối cùng bộ dựng vào (a) đường SERVER/Chat cũ, (b) stream tăng dần (dựng lại cây mỗi ~80–120 ms hoặc khi gặp dòng trống).

### 1.2 Phân cấp thị giác (đánh giá theo nguyên tắc thiết kế: hierarchy, structure-is-information, interactive-looks-interactive)
- Nhãn vai `.nhan` = 11 px, `opacity .7`, IN HOA (`:83`) ⇒ "BẠN / AI LOCAL" là thứ nhỏ nhất, xám nhất trên màn hình; không có avatar/độ đậm; người ↔ AI chỉ khác nền nhạt + viền trái 3 px.
- Khối lớn đặc chữ: không giới hạn bề rộng dòng, không khoảng thở giữa đoạn/danh sách/bảng ở đường thô; đường Agent đã có `p {margin:4px 0}` nhưng thiếu cỡ/độ đậm cho h3-h6 (`h` cap ép 3..6, không CSS riêng).
- Khối mã chỉ có ở đường Agent (đầu khối "Chép/Chèn/Áp dụng", `:152-157`), không có tên ngôn ngữ nổi bật, không tô cú pháp, không cuộn ngang có chỉ báo.
- Thanh "Lượt hội thoại: 0 · Ký tự lịch sử: 0 · Tệp đính kèm: 0" + "Ngữ cảnh: —" (`:308-313`, `#dong-ho-token`): số liệu của dev, không phải thông tin người dùng cần; chiếm 2 dòng đáy khung, luôn hiện kể cả khi 0.
- Trạng thái rỗng (`#rong-lan-dau`, `:221-225`): 3 dòng chữ mờ; không gợi ý việc nên hỏi (đây là trợ lý cho kỹ sư tự động hoá — có thể gợi ý theo đúng nghề: "giải thích tệp ST đang mở", "tạo FB cho van 2 vị trí", "đọc ảnh màn HMI báo AL.32").
- Nút Gửi + nút Dừng nằm cạnh nhau, Dừng là chữ (không icon) và chỉ hiện khi chạy; ô nhập `rows="2"` cố định, không tự giãn, Enter xuống dòng còn Ctrl+Enter mới gửi (ngược thói quen chat; không báo trước ngoài placeholder).
- Hai ô chọn chính-sách rời nhau, đặt ở HAI chỗ xa nhau: "mức quyền" (góc trên trái, chỉ icon khiên + chữ 11 px) và "chế độ agent" (hàng dưới, 11 px) — người dùng không thể đoán chúng phụ thuộc nhau (xem §3).
- Thẻ duyệt: có hai kiểu thẻ khác nhau về giao diện (`#the-duyet` đường LOCAL/SERVER cũ và `.ag-the` đường Agent), kích thước 12 px, nút cùng một kiểu chữ nhật xanh — "Duyệt" và "Bác/Huỷ" ngang hàng, không có khác biệt thị giác giữa hành động an toàn và hành động phá hoại.
- Dùng đúng biến `--vscode-*` (tốt: tự theo theme sáng/tối); KHÔNG hardcode màu. Cần giữ nguyên nguyên tắc này khi thiết kế lại (hệ thống thiết kế có sẵn = theme VSCode; chỉ thêm token dẫn xuất bằng `color-mix`).

### 1.3 Nút đính kèm
Một icon kẹp giấy 14 px, `padding:4px`, trong suốt, đặt bên TRÁI ô nhập (`:281-285`). Không viền, không chữ, không hint về dán/kéo. Chip tệp đính kèm 12 px ở DƯỚI ô nhập (`#ds-dinh-kem`), tên đường dẫn thô.

---

## 2. Lỗi 2 — không dán được ảnh/tệp từ ngoài dự án

**Gốc (mã):**
1. Webview KHÔNG có bất kỳ trình nghe `paste`, `drop`, `dragover` nào (`grep` toàn `htmlBang.ts`: chỉ có CSS `dropdown`). Ctrl+V chỉ dán chữ vào `<textarea>`; ảnh trong clipboard bị bỏ; kéo tệp vào webview bị trình duyệt xử lý mặc định (mở/không làm gì).
2. Cách đính kèm duy nhất: `xin_dinh_kem` ⇒ `bangChat.ts:596-610 moBoChonDinhKem` ⇒ `showQuickPick` trên `danhSachTepGoiY(dsGocMention())` = danh sách tệp TRONG workspace đã qua hàng rào rời máy. Không có `showOpenDialog`, không có đường cho tệp ngoài workspace. Việc ĐỌC cũng chỉ trong workspace: `hoi()` (`bangChat.ts:1188-1195`) và `phienAgent.dinhKemMention` (`:650`) đọc theo đường dẫn tương đối qua `chayToolCucBo({loai:"doc_tep"})`.
3. Không có kiểu dữ liệu "ảnh" ở bất kỳ tầng nào của extension: `grep -il image src/` chỉ ra `markdownAnToan.ts`.

**Hợp đồng server đã đo (TRƯỚC khi thiết kế):**
- `POST /api/ai-local-knowledge/ask` và `/stream` (`server/routes/aiLocalKnowledgeApi.ts:223-345, 455-475, 570-590`) ĐÃ nhận MỘT ảnh: `image` (data URL hoặc base64) + `imageMimeType`; chấp nhận `image/png|jpeg|webp`; trần `CHAT_VISION_MAX_IMAGE_MB` (mặc định **6 MB**); đọc bằng Qwen3-VL (sidecar) rồi gộp vào câu hỏi; phát sự kiện SSE `vision` (ok/visionText/reason `type|size|decode|unavailable|empty|error`). Fail-safe: lỗi ⇒ trả lời chỉ-chữ + ghi chú. **Extension chưa từng gửi trường này.**
- `/v1/chat/completions` (đường Agent mặc định, `server/routes/openaiGateway.ts:515-530 contentToString`): CHỈ giữ phần `type:"text"` của `content` dạng mảng; phần `image_url` bị VỨT IM LẶNG. Đây là phần của do-model (lỗi 3 "AI từ chối đọc ảnh"): cần hợp đồng để UI gửi ảnh qua `/v1`.

**Hợp đồng đề xuất phía client (cần do-model xác nhận):** user message `content` = `[{type:"text",text}, {type:"image_url", image_url:{url:"data:image/png;base64,…"}}]` (chuẩn OpenAI); server tự đọc ảnh (VL) rồi gộp như đường KB. Trần: ảnh ≤ 6 MB/ảnh (khớp server), tối đa 4 ảnh/lượt; tệp văn bản ngoài workspace ≤ 200 KB/tệp, tối đa 5 tệp; hiện rõ chip (tên, loại, kích thước, ảnh thu nhỏ) trong chat và trong lịch sử.

**Ranh giới an toàn giữ nguyên:** chỉ đọc cái NGƯỜI DÙNG chủ động dán/kéo/chọn; không thêm quyền đọc tuỳ ý cho agent (tệp ngoài workspace vào chat dưới dạng ngữ cảnh người dùng đưa, KHÔNG phải đường dẫn agent tự mở; công cụ `read_file` của agent vẫn khoá trong workspace). Tên tệp nhạy cảm (`.env*`, `id_rsa`, `*.pem`, `*.key`, `*.pfx`…) bị từ chối với thông báo rõ dù người dùng kéo vào (cùng bộ vị từ `duocPhepRoiMay` đang dùng cho @-mention).

---

## 3. Lỗi 4 — chọn "Tự ghi trong workspace" mà vẫn hỏi duyệt

**Chế độ lưu/đọc:** `workspaceState["aviAiLocal.mucQuyen"]` (`loi/mucQuyen.ts:84 KHOA_MUC_QUYEN`) ⇒ `bangChat.ts:877 napMucQuyen` / `:889 datMucQuyen` ⇒ `mucQuyenHienTai` (`:286`), chuyển xuống bằng `mucQuyen: () => this.mucQuyenHienTai` (`:310`). Việc LƯU và ĐỌC đúng (không phải gốc).

**Ba nơi ra quyết định "có hỏi không" — và chỉ MỘT trong ba tôn trọng "Tự ghi" một mình:**
| Đường | Mã quyết định | Kết quả khi mức = Tự ghi |
|---|---|---|
| Chat cũ, dự án LOCAL | `bangChat.ts:1799` `if (boQuaBuocHoi(mucQuyen)) await apDungCucBo()` | Tự áp, không thẻ. ĐÚNG. |
| **Agent LOCAL (mặc định, ô "Agent — duyệt từng bước")** | `ui/boThucThiVscode.ts:162-163` `conTuTri = ctx.cheDo === "tu-dong" && …` và `:529` `canDuyet = !(conTuTri && mucQuyen === "tu_ghi")` | **LUÔN hỏi** vì `cheDo` mặc định là `sua` (`htmlBang.ts:263`, option đầu tiên). Muốn bỏ hỏi phải chọn THÊM ô thứ hai "Agent — tự động" (`:265`). Hai khoá độc lập, ô chế độ nằm ở hàng khác, nhãn mức quyền không nói gì về nó. |
| Dự án SERVER | `bangChat.ts:407` (agent bị tắt khi `loai==="server"`) + `:1608-1640 xuLyDeXuat` luôn dựng `the_duyet`; không đọc `mucQuyenHienTai` | **LUÔN hỏi, theo thiết kế**: server không có khái niệm tự-duyệt (`grep autoApprove\|tuDongDuyet server/` = 0; `confirmAction` bắt buộc). Giao diện không nói điều này; chọn "Tự ghi" ở dự án SERVER im lặng không có tác dụng. |

**Gốc người dùng gặp:** Khi người dùng mở panel ở LOCAL và hỏi mặc định (Agent duyệt từng bước), "Tự ghi" bị bỏ qua vì ô thứ hai; thông báo giải thích chỉ có CHIỀU NGƯỢC (`phienAgent.ts:244-251`: tu-dong + mức khác tu_ghi ⇒ báo) — chiều "mức = tu_ghi + chế độ = sua" im lặng.

**Phát hiện thêm (luật hiện có SAI so với giả định của yêu cầu):** ở `tu-dong + tu_ghi`, `canDuyet` (`boThucThiVscode.ts:529`) áp cho MỌI `thaoTac` — kể cả `xoa` (xoá tệp) và `doi-ten` — tức xoá tệp cũng KHÔNG hỏi. Yêu cầu nói "xoá vẫn hỏi theo luật hiện có": luật hiện có KHÔNG làm vậy. (Có checkpoint "Hoàn tác lượt chạy", nhưng đó là lưới đỡ, không phải cửa duyệt.) Đề xuất: xoá LUÔN hỏi, kể cả tự ghi.

**Sửa đề xuất (nhỏ, rõ):**
1. Vị từ thuần mới trong `loi/mucQuyen.ts`: `canDuyetGhiAgent({mucQuyen, cheDo, haTuTri, coNguonDangNgo, thaoTac})` — KHÔNG hỏi chỉ khi `mucQuyen==="tu_ghi"` ∧ `cheDo ≠ "hoi"` ∧ `!haTuTri` ∧ `!coNguonDangNgo` ∧ `thaoTac ∈ {sua, tao, doi-ten}`; `xoa` luôn hỏi. `boThucThiVscode.ghi` gọi vị từ này (một nguồn sự thật, có bảng test + đột biến).
2. `run_command` vẫn LUÔN hỏi (không đổi); ghi ngoài workspace vẫn bị `apBanVa` chặn (không đổi); hạ tự trị khi nội dung đáng ngờ giữ nguyên.
3. Giao diện nói thật: ở dự án SERVER, ô "Mức quyền" hiện chú thích "SERVER: ghi luôn cần duyệt trên máy chủ"; tooltip mức "Tự ghi" nói rõ "sửa/tạo tệp trong workspace không hỏi; xoá và chạy lệnh vẫn hỏi".

---

## 4. Danh sách MỌI điểm bất tiện khác
1. Enter không gửi (Ctrl+Enter mới gửi), ô nhập 2 dòng cố định, không tự giãn, không giữ nháp theo hội thoại.
2. Không có nút Chép trên câu trả lời (đường thô) và không có "Chép toàn bộ"/"Hỏi lại"/"Tạo lại".
3. Khối mã ở đường SERVER không có nút chép/chèn/áp dụng; không tên ngôn ngữ; không tô cú pháp.
4. Tool-call hiện thành dòng `⋯ moTa` 12 px monospace mờ; chi tiết chỉ mở khi bấm (không có chỉ báo bấm được).
5. "Suy luận của model" nằm trong `<details>` mờ 11 px — không phân biệt rõ với câu trả lời khi mở.
6. Hai thẻ duyệt có hai thiết kế khác nhau; "Duyệt" và "Bác" cùng cấp thị giác; thẻ lệnh dùng `code` thô.
7. 👍/👎 là hai nút 12 px opacity .7 dưới mỗi lượt, ô lý do ẩn/hiện bất ngờ.
8. Thanh trạng thái ngữ cảnh (lượt/ký tự/tệp) và đồng hồ token: số liệu dev, hiện luôn.
9. Nút "Đăng nhập AI Local" (token device flow) tách khỏi icon tài khoản (cookie) — hai loại đăng nhập, hai chỗ; thông báo thiếu token chỉ hiện sau khi AI đã làm việc (`CHUA_CO_TOKEN_GHI_SO`).
10. Ô dự án `#o-du-an` ẩn khi chỉ có LOCAL và chiếm cả hàng khi có SERVER — chuyển LOCAL↔SERVER làm thay đổi hành vi duyệt/ghi (§3) mà không có dấu hiệu nào rõ.
11. Trạng thái rỗng không gợi ý hành động; không có ví dụ theo nghề.
12. Không có chỉ báo "đã đính kèm gì" ngoài tên đường dẫn; không xem trước nội dung/ảnh; không giới hạn/cảnh báo kích thước.
13. Lỗi hiện thành bong bóng "HỆ THỐNG" cùng kiểu với trả lời; chỉ lỗi mạng có nút "Mở Settings".
14. `#hoi-thoai` cuộn: `scrollTop = scrollHeight` mỗi tin Agent (không dừng khi người dùng cuộn lên đọc).
15. Panel hẹp (~290–380 px): hàng "mức quyền + tài khoản", hàng "chế độ + token + hoàn tác", hàng nhập, hàng đính kèm, hàng thống kê = 5 hàng điều khiển trên một màn hình nhỏ.
16. Không hỗ trợ dán nhiều dòng mã với giữ định dạng đặc biệt (dán chữ thường OK).
17. Không có phím tắt (Esc dừng, ↑ nhắc lại câu trước) và không phát hiện IME (gõ tiếng Việt Telex: Enter xác nhận gõ có thể gửi nhầm khi sau này đổi sang Enter-gửi — cần kiểm `isComposing`).

---

## 5. Kế hoạch (đã gửi dieu-phoi để DUYỆT phần thiết kế lại lớn)
- **Ngay (C), không chờ thiết kế:** lỗi 2 (dán/kéo/chọn ngoài workspace, ảnh + tệp, trần, chip rõ ràng, host kiểm tra) và lỗi 4 (vị từ `canDuyetGhiAgent` + chú thích SERVER + xoá luôn hỏi). Có test + đột biến; nghiệm thu bằng webview thật (Playwright) và `test-real-host`.
- **Chờ duyệt (B):** thiết kế lại giao diện — (1) markdown dựng trên MỌI đường, stream tăng dần; (2) hàng nhãn vai đậm hơn, tên "Bạn"/"AI Local", cỡ 12–13 px, không in hoa; (3) khung nhập kiểu chat: tự giãn, Enter gửi (Shift+Enter xuống dòng, kiểm IME), nút đính kèm có chữ "Đính kèm" + menu {tệp trong workspace · tệp từ máy · dán ảnh}, vùng thả tệp có viền khi kéo; (4) gộp "mức quyền" và "chế độ" thành MỘT điều khiển trạng thái rõ (Hỏi · Agent duyệt · Agent tự ghi) cạnh ô nhập; (5) thẻ duyệt thống nhất, hành động phá hoại tách khỏi hành động an toàn; (6) trạng thái rỗng có 4 gợi ý theo nghề; (7) bỏ thanh thống kê dev (đưa vào tooltip). Mockup HTML tĩnh: `tmp/` → xuất ra tệp trong `docs/superpowers/audits/2026-10-24-vscode-extension-anh/` khi duyệt.

---

## 6. Cập nhật sau kiểm định độc lập + việc đã làm (2026-10-24)

Kiểm định độc lập (`2026-10-24-vscode-extension-kiem-dinh.md`) xác nhận cả 4 lỗi và BỔ SUNG: (a) chế độ agent KHÔNG được lưu (gốc thứ hai của lỗi 4); (b) cỡ tiêu đề markdown bị đảo (`###` nhỏ hơn chữ thường, htmlBang.ts:657-658) và `>` không viền; (c) cuộn bị ép về đáy mỗi tin `ag_*`; (d) sửa nhiều tệp: mỗi tệp một thẻ, không "Duyệt tất cả"; (e) P2: chọn model/vai trò, Thử lại, Esc = Dừng, chép cả câu trả lời, thông báo nén lịch sử, mã build; (f) bản cài đang cũ (0.2.0, dist 19/10 ≈ 627ab942f).

Đã sửa (commit trên feat/ai-flow-studio): lỗi 4 `5d3cfad65` (+ lưu chế độ `4b89579e5`), lỗi 2 phần đường Chat `67eec4f12`. Chưa làm (chờ duyệt thiết kế): mọi điểm giao diện còn lại — mockup: `2026-10-24-vscode-extension-anh/mockup-giao-dien-moi.html` (7 trạng thái × 2 theme; ảnh xem trước `mockup-xem-truoc-sang.png`, `mockup-xem-truoc-toi.png`).

Bước nghiệm thu cuối (bắt buộc theo luật "đã cài ≠ nhìn thấy"): tăng version 0.3.0, nhúng mã build/commit vào UI, `npm run package` (.vsix), cài lại, xác minh `dist` đang chạy = bản repo, chạy `test-real-host`.
