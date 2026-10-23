# Extension VSCode AI Local — kiểm định độc lập trải nghiệm thật (2026-10-24)

Người kiểm: kiem-dinh · Phạm vi: CHỈ ĐỌC (không sửa mã extension/server) · Nhánh: chore/ai-luoi-do (đã merge main 1ff26cd95).
Công cụ: webview của extension dựng NGOÀI VSCode (xem `scripts/chan-doan/webview-harness/`), đọc mã, chạy test, gọi `:3000` (401 không token — không đăng nhập thiết bị được ở phiên này).

## 0. Tóm tắt (đọc phần này nếu chỉ có 1 phút)

Cả 4 lỗi chủ dự án gặp ĐỀU TÁI HIỆN ĐƯỢC và đều có gốc rõ trong mã — hai lỗi (ảnh, kéo/dán) là TÍNH NĂNG CHƯA CÓ (cố ý chặn theo thiết kế bảo mật Task G2), hai lỗi (markdown thô, hỏi duyệt) là THIẾT KẾ GÂY HIỂU LẦM:

| # | Lỗi | Gốc (một câu) | Mức |
|---|---|---|---|
| 1 | Markdown thô, khối chữ đặc | Khi stream, chữ được nối thô vào một `div` có `white-space: normal` (htmlBang.ts:151, :794-799); markdown chỉ được dựng khi đoạn kết thúc (`ag_md`) — cả đoạn dài hiện như một khối đặc đầy `` ` `` `**` `|` rồi "nhảy" sang bản đã dựng | P1 |
| 2 | Không dán/kéo ảnh hoặc tệp ngoài dự án | Webview KHÔNG có handler `paste`/`drop`/`dragover`; đính kèm chỉ qua nút → QuickPick liệt kê tệp TRONG workspace đã lọc (bangChat.ts:593-610) | P1 |
| 3 | AI từ chối đọc ảnh | Không có đường ảnh đầu–cuối: extension không gửi ảnh; tệp ảnh bị `doc_tep` coi là nhị phân (toolCucBo.ts:181-189); cổng `/v1` làm phẳng `content` mảng chỉ lấy phần `text`, BỎ IM LẶNG `image_url` (openaiGateway.ts:514-528) | P1 |
| 4 | Chọn "Tự ghi trong workspace" vẫn hỏi duyệt | Hai điều khiển độc lập: MỨC QUYỀN và CHẾ ĐỘ; chỉ `Agent — tự động` + `Tự ghi` mới bỏ thẻ (phienAgent.ts:245, boThucThiVscode.ts:529). Chế độ KHÔNG được lưu (luôn quay về "duyệt từng bước" khi mở lại) còn mức quyền thì được lưu; lệnh luôn hỏi; và có "hạ tự trị" khi đọc nội dung đáng ngờ | P1 |

Thêm: cuộn bị giật về đáy mỗi lần stream (P1), không "Duyệt tất cả" cho sửa nhiều tệp (P1), không chọn model/vai trò trong khung (P2), bản cài ≠ bản trong repo mà số phiên bản y hệt (P2). Chi tiết ở §2–§4.

## 1. Bản cài, máy chủ, "đã cài ≠ nhìn thấy" (mục A)

- `code --list-extensions --show-versions` ⇒ **st4i.avi-ai-local@0.2.0** (một bản duy nhất). Máy chủ: cài đặt `aviAiLocal.serverUrl` KHÔNG bị ghi đè trong `settings.json` người dùng ⇒ dùng mặc định **http://localhost:3000** (package.json:229-233; `:3000` đang nghe, `/v1/models` và `/v1/chat/completions` không token ⇒ 401, `/ai-thiet-bi` ⇒ 200).
- **Bản chạy ≠ bản trong repo dù cùng số 0.2.0.** `~/.vscode/extensions/st4i.avi-ai-local-0.2.0/dist/extension.js` (576.392 B, 2026-10-19 07:35) được tìm khớp (build lại từng commit rồi so) ≈ bản dựng ở commit **627ab942f** (576.425 B; chênh 33 B do chú thích đường dẫn/`"use strict"`). Repo HEAD còn có: `b179ba829` (tool tuỳ chọn `compile_st`, 2026-10-21) và các thay đổi `shared/agentCore`/`shared/stNhacSua` ⇒ extension đang chạy KHÔNG có `compile_st`. Về giao diện: từ 627ab942f chỉ đổi đúng một tệp UI (`boThucThiVscode.ts`, +2/−1) ⇒ **các lỗi 1–4 có mặt trên cả bản cài lẫn bản repo**. `vscode-extension/dist/extension.js` trong repo (300 KB, 2026-09-06) là bản cũ hơn nữa (không dùng để cài).
- Hệ quả vận hành (P2): số phiên bản không đổi giữa các lần build ⇒ không có cách nhìn biết đang chạy bản nào. Đề xuất: tăng số hoặc hiển thị mã commit/giờ build trong lệnh "AI Local: …" và trong khung (chân trang).
- Giới hạn của lần kiểm định: tôi KHÔNG điều khiển được cửa sổ VSCode thật (QuickPick, diff native, device flow, stream từ model thật chưa thể mô phỏng). Phần giao diện webview được chạy bằng chính HTML/JS của repo trong Chromium với host giả (bằng chứng ảnh bên dưới); phần host (đính kèm, mức quyền, ghi/duyệt) kiểm bằng đọc mã + 82 tệp/1274 test của extension (xanh: 1274 pass, 3 skip).

## 2. Tái hiện từng lỗi (mục A)

### Lỗi 1 — markdown thô, khối chữ đặc  (P1)
Bước: gửi một câu hỏi để model trả lời dài có tiêu đề, danh sách, bảng, khối mã. Quan sát hai pha:
1. **Đang stream**: mọi mảnh `ag_chu` được nối bằng `textContent +=` vào `div.ag-doan.ag-md` có `white-space: normal` ⇒ xuống dòng bị nuốt, `##`, `` ` ``, `**`, `|---|` hiện nguyên văn thành MỘT khối đặc. Ảnh: `img-2026-10-24-vscode/a1-streaming-tho.png`. Mã: htmlBang.ts:151 (`.ag-md { white-space: normal; }`), :794-799 (`ag_chu`).
2. **Khi đoạn kết thúc** (trước một lượt gọi tool hoặc hết lượt — phienAgent.ts:341, :387-395) host gửi `ag_md` và webview thay toàn bộ bằng bản đã dựng ⇒ nội dung đổi hình đột ngột, cuộn nhảy. Ảnh: `a2-sau-ag_md.png` (list/bảng/khối mã đúng, có nút Chép/Chèn/Áp dụng).
Với model 35B chạy chậm, pha 1 kéo dài hàng chục giây ⇒ đúng "markdown thô, khối chữ đặc" mà chủ dự án thấy.
Lỗi nhìn riêng của bản đã dựng:
- **Thứ bậc tiêu đề bị đảo**: htmlBang.ts:657-658 ánh xạ `#`→`h3`, `##`→`h4`, `###`→`h5`, `####`→`h6` mà KHÔNG có CSS cho `h*` ⇒ đo thật: `##` = 13 px đậm (bằng chữ thường), `###` = **10,8 px — NHỎ HƠN chữ thường**. (P2)
- **Trích dẫn `>`** không có viền/nền: border-left 0, background trong suốt (chỉ thụt lề). (P2)
- Khối mã: `overflow-x: auto` nên cuộn ngang được, nhưng không bọc dòng và không có thanh cuộn hiện sẵn trong ảnh; nút Chép chỉ ở khối mã, KHÔNG có "chép cả câu trả lời". (P2)

### Lỗi 2 — không dán/kéo ảnh hoặc tệp ngoài dự án  (P1)
Tái hiện bằng harness (`run2.cjs`): phát `paste` (ClipboardEvent có `image/png`) và `drop`/`dragover` (tệp `.txt`) vào ô nhập ⇒ `defaultPrevented = false` cả ba, không tin nào gửi tới host, ô nhập và danh sách đính kèm không đổi; tìm trong toàn bộ HTML webview: không có chuỗi `paste`, không có `addEventListener("drop")`.
Con đường duy nhất: nút kẹp giấy `xin_dinh_kem` → `moBoChonDinhKem()` (bangChat.ts:445, :593-610) → QuickPick danh sách tệp TRONG workspace đã qua hàng rào "được phép rời máy". Tệp ngoài workspace: không có đường nào. Đây là CỐ Ý (docblock Task G2: "một đường dữ liệu rời máy duy nhất, không cửa sau") — nhưng chưa có bản thiết kế an toàn tương đương cho tệp ngoài/ảnh dán.
Phụ: QuickPick đưa TOÀN BỘ danh sách tệp đã nạp (`locDanhSachMention(ds, "", ds.length)`) — dự án lớn thì danh sách rất dài, không có "chọn nhiều" (mỗi lần một tệp). (P2)

### Lỗi 3 — AI từ chối đọc ảnh  (P1)
Ba chỗ cùng làm ảnh không bao giờ tới model:
1. Extension: không có mã ảnh nào (không `image_url`, không đọc `.png` làm đính kèm).
2. Nếu người dùng đính kèm một tệp ảnh có trong workspace: `docVanBan` coi tệp có NUL trong 8 KB đầu là nhị phân và TRẢ `undefined` (toolCucBo.ts:181-189) ⇒ model nhận "không đọc được" ⇒ trả lời "tôi không xem được ảnh".
3. Máy chủ: `contentToString` của cổng `/v1/chat/completions` (openaiGateway.ts:514-528; dùng ở :556) giữ phần `type:"text"` và trả `""` cho mọi phần khác ⇒ `image_url` bị BỎ IM LẶNG (không báo lỗi 4xx, không cảnh báo) — kể cả khi sau này extension có gửi ảnh. Khả năng nhìn ảnh của hệ thống tồn tại ở nơi KHÁC (sidecar Qwen3-VL-8B + mmproj, `aiVisionLanguage`/`llamaVisionSidecar`) chưa nối vào `/v1`. (do-model đang lo — ghi lại để hai bên khớp.)
Không gọi được `/v1` thật (cần token thiết bị) nên chưa quan sát câu từ chối nguyên văn của model.

### Lỗi 4 — chọn "Tự ghi trong workspace" mà vẫn hỏi duyệt  (P1)
Điều kiện bỏ thẻ duyệt tệp = **chế độ "Agent — tự động" VÀ mức quyền "Tự ghi trong workspace" VÀ chưa bị hạ tự trị** (boThucThiVscode.ts:529 `canDuyet = !(conTuTri && mucQuyen === "tu_ghi")`; phienAgent.ts:245). Những chỗ người dùng vẫn bị hỏi dù đã chọn "Tự ghi":
- **(a) Mặc định chế độ là "Agent — duyệt từng bước"** (`o-che-do`, htmlBang.ts:262-266). Chỉ đổi mức quyền thì KHÔNG đổi gì. Thông báo giải thích chỉ xuất hiện theo chiều ngược lại (tự động + mức khác `tu_ghi`, phienAgent.ts:245-250); chiều "mức Tự ghi + chế độ duyệt từng bước" im lặng.
- **(b) Chế độ KHÔNG được lưu**: htmlBang.ts không có `setState/getState`, host chỉ gửi lại `muc_quyen` lúc `san_sang` (bangChat.ts:380-381) mà không gửi chế độ ⇒ mở lại cửa sổ: mức quyền còn "Tự ghi" (lưu `workspaceState`), chế độ quay về "duyệt từng bước" ⇒ hỏi duyệt trở lại — đúng triệu chứng.
- **(c) Lệnh LUÔN hỏi**, kể cả tự động + tự ghi (boThucThiVscode.ts:637-645; bangChat.ts:1878-1885 nói rõ "không có nhánh tự động chạy").
- **(d) "Hạ tự trị"**: đọc nội dung đáng ngờ trong lượt (ví dụ tệp chứa câu dạng mệnh lệnh) ⇒ mọi ghi/lệnh sau đó cần duyệt (phienAgent.ts "ha-tu-tri"); thông báo có, nhưng dễ lẫn.
- **(e) Hai đường khác nhau**: ở "Chat cũ"/đề xuất cục bộ, mức "Tự ghi" ALONE bỏ thẻ (bangChat.ts:1799 `boQuaBuocHoi`); ở các chế độ Agent thì cần thêm "tự động" ⇒ cùng một mức quyền, hai nghĩa.
Đề xuất (cho luong-ui): một điều khiển duy nhất hoặc đồng bộ hai điều khiển (chọn "Tự ghi" ⇒ tự đặt chế độ "tự động" và ngược lại, hoặc cảnh báo rõ khi lệch); lưu chế độ theo workspace; nói rõ trong thẻ "vì sao hỏi" (chế độ/lệnh/hạ tự trị).

## 3. Vòng kịch bản dùng thật (mục B)

Đánh giá = bất tiện, mức, bằng chứng. Ảnh `b1-agent-nhieu-tep.png` là một lượt agent mô phỏng (đọc tệp, kế hoạch, câu trả lời, 4 thẻ sửa tệp, 1 thẻ lệnh, lỗi kết nối).

| Kịch bản | Bất tiện quan sát | Mức | Bằng chứng / mã |
|---|---|---|---|
| Hỏi đáp | Chữ thô đặc khi stream rồi nhảy (lỗi 1); tiêu đề đảo cỡ; không "chép cả câu trả lời" | P1/P2 | a1, a2; htmlBang.ts:151, :657-658, :646 |
| Đính kèm tệp TRONG dự án | Chỉ qua QuickPick, mỗi lần một tệp, danh sách toàn bộ tệp; không thấy ảnh/binary (bị bỏ lặng lẽ) | P2 | bangChat.ts:593-610; toolCucBo.ts:185 |
| Đính kèm tệp NGOÀI dự án / kéo-thả / dán | Không hỗ trợ (lỗi 2) | P1 | run2.cjs |
| `@` chèn tệp | Có menu gợi ý (lọc theo chữ), Tab chọn mục đầu, Esc đóng; chỉ tệp trong workspace | OK/P2 | htmlBang.ts:928-936; locMention.ts |
| Agent sửa nhiều tệp + duyệt diff | MỖI tệp một thẻ ~110 px (4 tệp ≈ 440 px), KHÔNG có "Duyệt tất cả"/"Xem tất cả diff"; nút "Bác" cùng độ nổi với "Duyệt"; ô "lý do bác" luôn hiện ở mọi thẻ | P1 (sửa nhiều tệp) | b1; htmlBang.ts `agTheDuyet` |
| Chạy lệnh | Luôn hỏi dù ở tự động + tự ghi; thẻ nêu tệp lượt này đã ghi (tốt, chống đánh tráo); cách hiển thị KẾT QUẢ lệnh cho người dùng chưa kiểm được (không chạy host thật); dòng kết quả tool trong webview chỉ ✓/✗ + tóm tắt khi bấm | P2 | boThucThiVscode.ts:637-645; htmlBang.ts `ag_ket_qua_tool` |
| Đổi chế độ quyền | Hai điều khiển lệch nhau, chế độ không lưu (lỗi 4); mức quyền lưu theo workspace | P1 | htmlBang.ts:262-266; bangChat.ts:380 |
| Lịch sử hội thoại | Lệnh "AI Local: Lịch sử" (QuickPick) giữ tối đa 50 hội thoại / 500k ký tự rồi cắt cũ nhất; không tìm kiếm trong khung | P2 | khoHoiThoai.ts:59, :68 |
| Đổi model/vai trò | KHÔNG có ô chọn trong khung; chỉ cài đặt `aviAiLocal.agentModel` (mặc định "chat") và `agentMaxTokens` ⇒ phải sửa settings.json | P2 | phienAgent.ts:308; package.json:256-266 |
| Mất kết nối máy chủ | Một dòng lỗi "Lỗi: Không kết nối được …ECONNREFUSED" — KHÔNG nút "Thử lại", KHÔNG gợi ý (máy chủ chạy chưa? đổi `serverUrl`? lệnh "Đổi máy chủ"); lỗi token có nút đăng nhập (tốt) | P2 | b1; htmlBang.ts `ag_loi`/`MA_CAN_TOKEN` |
| Hội thoại dài | (1) mỗi tin `ag_*` ép `scrollTop = scrollHeight` ⇒ người dùng cuộn lên đọc bị GIẬT về đáy mỗi mảnh stream — đo: cuộn lên 0, thêm một mảnh ⇒ nhảy tới 1729/1729; (2) ngân sách ngữ cảnh 65.536 token, nén lịch sử ở 70 % mà KHÔNG báo người dùng (`nenLichSu(...).tinNhan` bỏ `soNen`); (3) chỉ báo "Ngữ cảnh: 21,4k token (33%)" có ích | P1 (cuộn) / P2 (nén im lặng) | htmlBang.ts:391, :1039, :1244; vongAgent.ts:424; kieu.ts:217 |
| Dừng lượt | Có nút Dừng (hiện khi gửi; ẩn khi xong), ngắt cả lúc chờ model/duyệt (README); KHÔNG phím tắt Esc cho Dừng | P2 | htmlBang.ts:600; README |
| Trạng thái đang nghĩ | Ba chấm nhấp nháy + thông báo hàng đợi model ("Đang xếp hàng chờ model (N lượt phía trước)"); "Suy luận của model" là `<details>` thu gọn | OK | phienAgent.ts:360; htmlBang.ts `ag_nghi` |
| Đăng nhập | Hai thứ khác nhau (device flow `/v1` + cookie phiên cho sổ kiểm toán) — thiếu cookie ⇒ agent đọc được nhưng không ghi | P2 | README "Đăng nhập — hai thứ, hai việc" |
| Khuôn khổ khung hẹp | Hàng dưới cùng nhồi: chế độ (chữ nhỏ), "Ngữ cảnh", hộp nhập, nút gửi, rồi hàng thống kê `Lượt hội thoại · Ký tự lịch sử · Tệp đính kèm` — tin kỹ thuật chiếm chỗ | P2 | b1 |

## 4. So với Claude Code / Cursor (mục C)

| Điểm cơ bản | AI Local (bản cài 0.2.0) | Claude Code / Cursor (tham chiếu chung) | Khoảng cách |
|---|---|---|---|
| Dán ảnh | Không | Dán ảnh từ clipboard vào ô nhập (hiện thumbnail, gỡ được) | Thiếu hoàn toàn (P1) |
| Kéo tệp | Không (`drop` không xử lý) | Kéo tệp/thư mục/ảnh từ Explorer hoặc ngoài hệ thống vào khung; chèn như tệp đính kèm | Thiếu (P1) |
| Đính kèm | Nút + QuickPick workspace, mỗi lần một tệp, chỉ văn bản | Chọn nhiều, ngoài workspace, ảnh/PDF | Hạn chế |
| Markdown | Chỉ dựng khi đoạn kết thúc; trước đó thô | Dựng tăng dần theo từng mảnh stream | Cần dựng tăng dần (P1) |
| Khối mã | Chép · Chèn · Áp dụng (tốt, có sẵn) | Copy, áp dụng/chèn | Ngang |
| Diff | Mỗi tệp một thẻ + "Xem diff" mở diff native VSCode; không duyệt hàng loạt, không xem tất cả | Diff nội tuyến, duyệt/bác từng hunk, "Chấp nhận tất cả" | Thiếu "chấp nhận tất cả"/hunk (P1) |
| Dừng lượt | Nút Dừng (tốt) | Dừng + Esc | Thiếu phím tắt |
| Trạng thái đang nghĩ | Ba chấm + hàng đợi + "Suy luận" thu gọn | Chỉ báo + thời gian + token | Ngang/khá |
| Cuộn khi stream | Ép về đáy | Chỉ theo đáy khi người dùng đang ở đáy | Lỗi (P1) |
| Chế độ quyền | 3 mức + 4 chế độ, hai điều khiển lệch, không lưu chế độ | Một chọn lựa rõ (plan / hỏi / tự động), nhớ | Cần gộp (P1) |
| Chọn model | Chỉ trong settings | Ô chọn trong khung | Thiếu (P2) |
| Lỗi/Thử lại | Một dòng lỗi | Nút thử lại + gợi ý | Thiếu (P2) |
| Lịch sử | Lệnh QuickPick, 50 hội thoại | Danh sách + tìm kiếm | Hạn chế |
| Điểm mạnh riêng | Sổ kiểm toán mọi lượt ghi, hàng rào "không rời máy", hạ tự trị khi nội dung đáng ngờ, hoàn tác cả lượt, @/ngữ cảnh dự án offline | — | Giữ khi cải tiến |

(Các cột tham chiếu chỉ nêu hành vi cơ bản đã biết của hai công cụ, không kiểm lại bản mới nhất.)

## 5. Đề xuất ưu tiên (để dieu-phoi chia việc)

1. **luong-ui — UI (không đụng hàng rào bảo mật)**: dựng markdown tăng dần khi stream (hoặc ít nhất `white-space: pre-wrap` cho đoạn chưa dựng); sửa cỡ tiêu đề (h3≥h4≥…>chữ thường) + viền cho `>`; chỉ tự cuộn khi đang ở đáy; "Duyệt tất cả / Xem tất cả diff"; hợp nhất mức quyền ↔ chế độ (và LƯU chế độ theo workspace); nút Thử lại + gợi ý khi mất kết nối; ô chọn model/vai trò; phím Esc = Dừng; hiện mã build.
2. **Thiết kế ảnh/tệp ngoài (do-model + luong-ui, cần chủ dự án duyệt hàng rào)**: ba nơi cùng phải đổi — webview (paste/drop → báo ý định cho host, host giữ quyền quyết), host (đọc ảnh/tệp ngoài workspace qua cửa duyệt rõ ràng, giới hạn kích thước/loại), cổng `/v1` (KHÔNG bỏ im lặng `image_url`: hoặc chuyển vào đường vision hoặc trả lỗi 4xx rõ ràng). Cho tới lúc đó nên hiện thông báo rõ khi đính kèm ảnh thay vì bỏ lặng lẽ.
3. **Quy trình**: số phiên bản/ghi mã build để "đã cài = đang chạy bản nào" kiểm được bằng mắt; thêm cờ trong báo cáo nghiệm thu của extension.

## 6. Việc đã làm / không làm

Đã: tra phiên bản cài và tìm commit khớp; dựng webview thật ngoài VSCode (3 kịch bản, 3 ảnh); đọc mã `htmlBang.ts`, `bangChat.ts`, `phienAgent.ts`, `boThucThiVscode.ts`, `toolCucBo.ts`, `mucQuyen.ts`, `openaiGateway.ts`, `vongAgent.ts`; chạy `vitest run vscode-extension/src` (82 tệp, 1274 pass, 3 skip); gọi `:3000` (401). Không: điều khiển VSCode thật; đăng nhập device flow; gọi model/`/v1` có token; chạm `:8091`/GPU; sửa mã; cài/gỡ extension.
