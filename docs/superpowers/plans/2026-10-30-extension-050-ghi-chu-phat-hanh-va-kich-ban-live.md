# Extension 0.5.0 — ghi chú phát hành (nháp) + kịch bản chạy LIVE

Nhánh: `feat/luong-ui-ext050` (tip khi soạn: `2a5a4cb28`). Chưa đóng gói. Đóng gói sau khi: live đạt · kiem-dinh rà 10.4b-E ĐẠT · 11.7 (đổi tên Thợ Cả) ĐẠT và gộp cùng một cổng.

## 1. Ghi chú phát hành (nháp, tiếng Việt)

**Thợ Cả 0.5.0**

Mới
- **Workspace Trust**: thư mục chưa tin cậy (chế độ hạn chế của VSCode) ⇒ Thợ Cả chỉ ĐỌC — không chạy lệnh, không ghi tệp; tool ghi/lệnh của agent bị ẩn.
- **Thanh trạng thái**: model · % ngữ cảnh (dấu `~` khi mới là ước lượng; đổi màu từ 85 %) · tok/s hiệu dụng (gồm thời gian chờ khe model).
- **Huy hiệu chờ duyệt**: số thẻ duyệt đang chờ trên icon khung chat và trên thanh trạng thái (cộng mọi khung đang mở).
- **Terminal chỉ đọc "Thợ Cả (chỉ đọc)"**: hiện các lệnh agent đã chạy (đầu ra đã che bí mật, bỏ mã điều khiển); lệnh `Thợ Cả: Mở terminal chỉ đọc`.
- **Sửa trực tiếp có linter**: sau khi áp một đề xuất, báo riêng các lỗi (Problems) do chính lần sửa đặt thêm.
- **Model ngoài ở Hỏi đáp** (chỉ khi máy chủ mở cho extension): chọn `ngoai:…` ở ô model ⇒ chỉ Hỏi đáp (không agent / Cmd+K / @mention / đính kèm); hỏi đồng ý MỘT lần mỗi cuộc trò chuyện + model; huy hiệu nguồn «Model ngoài · nhà cung cấp/model»; liên kết hiển thị thành chữ + tên miền.
- Đổi tên hiển thị **Thợ Cả** (mã định danh giữ nguyên) — từ nhánh 11.7.

Không đổi / giới hạn
- Agent KHÔNG dùng model ngoài trong extension (chưa có bằng chứng live trên host).
- MCP server vẫn do cấu hình mức máy + duyệt lần đầu; không bị chặn bởi Workspace Trust (cấu hình `scope: machine`).

## 2. Kịch bản LIVE (làm sáng mai, SAU khi dieu-phoi báo hết cửa sổ GPU và đã gộp SCADA + build :3000)

Nguyên tắc: không khoá thật; không bật `AI_NGOAI_ENABLED` trên :3000 — dùng **:3049 bản production riêng** với cấu hình test + nhà cung cấp GIẢ như lần L2. Mọi bước ghi PASS/FAIL kèm bằng chứng (ảnh chụp host / log). Không `rm -rf` junction `node_modules` (dùng `rmdir`).

Chuẩn bị
1. Build bản ext từ `feat/luong-ui-ext050` (+ merge 11.7 nếu đã ĐẠT): `node build.mjs`; xác minh mã build `0.x+<commit>` khớp `git rev-parse --short HEAD`.
2. Khởi động :3049 (production, DB test như L2) + nhà cung cấp GIẢ (openai_compat) trả văn bản có: liên kết `[x](https://evil.example/p)`, ảnh `![i](http://t.example/a.png)`, HTML thô `<img src=x onerror=1>`, ký tự U+202E. Cấu hình admin: nhà máy test **bật** "cho gửi dữ liệu vận hành"; `duocDungO` chứa `chat` + `agent`.
3. Harness `test-real-host` (VSCode thật qua test-electron) trỏ `aviAiLocal.serverUrl` = :3049; đăng nhập bằng tài khoản test (cookie phiên; token device flow nếu cần cho agent).

Mục / kiểm
| # | Mục | Cách kiểm trên host | PASS khi |
|---|---|---|---|
| 1 | Workspace Trust | mở workspace ở chế độ hạn chế (không tin cậy) | `run_command`/ghi bị chặn với câu giải thích; tool ghi/lệnh không có trong danh sách tool; đọc/grep vẫn chạy; cấp tin cậy giữa chừng ⇒ có hiệu lực ngay lượt sau |
| 2 | Thanh trạng thái | chạy một lượt agent (model nội bộ nhỏ hoặc stub) | chữ có model · % ngữ cảnh · tok/s; `~` trước khi có usage thật; ≥ 85 % đổi nền cảnh báo |
| 3 | Huy hiệu chờ duyệt | agent ở chế độ duyệt, để 2 thẻ chờ, mở 2 khung (bảng nổi + thanh bên) | badge icon + thanh trạng thái = tổng; duyệt/bác ⇒ giảm; hết ⇒ biến mất |
| 4 | Terminal chỉ đọc | agent chạy `npm run check`/lệnh trong allowlist, mở lệnh `moTerminalDoc` | terminal hiện `$ lệnh`, đầu ra, `[exit n]`; gõ phím không có tác dụng; đầu ra chứa ESC/CSI không đổi giao diện terminal |
| 5 | Linter | Cmd+K/đề xuất cục bộ cố ý sinh lỗi kiểu (TS) rồi duyệt | tin kết quả ghi hiện NGAY; tin thứ hai liệt kê lỗi mới (≤ 5, chữ thuần); lỗi cũ không bị báo lại; sửa sạch ⇒ không có tin thứ hai |
| 6 | 10.4b-E: tạo hội thoại máy chủ | chọn model `ngoai:` ở ô model, hỏi câu đầu | tRPC POST `aiChat.createConversation` thành công (HTTP 200, có `id` số); lượt đi tới `/api/ai/local-kb/stream` với `context.conversationId` đúng |
| 7 | 10.4b-E: 428 | lượt đầu của (hội thoại, model) | hộp thoại modal hiện ĐÚNG MỘT lần; từ chối ⇒ không có lượt thứ hai tới nhà cung cấp giả (đếm ở nhà cung cấp giả = 0); đồng ý ⇒ gửi lại và có trả lời; lượt kế KHÔNG hỏi lại; đổi model ⇒ hỏi lại |
| 8 | 10.4b-E: thân gửi đi | bắt thân yêu cầu ở :3049 / nhà cung cấp giả khi đang mở `.env`, có vùng chọn, có @mention | thân KHÔNG chứa nội dung `.env`, vùng chọn, tệp, định nghĩa tool; chỉ câu hỏi + lịch sử của lượt NGOÀI |
| 9 | 10.4b-E: chỉ Hỏi | chọn model ngoài rồi chạy Sửa/Tự động, Cmd+K, thêm đính kèm | không agent nào chạy; có thông báo; ô chọn → agent nhận "auto" |
| 10 | 10.4b-E: nguồn + render | trả lời giả chứa liên kết/ảnh/HTML/U+202E | huy hiệu «Model ngoài · ncc/model · ~token · ~$»; không phần tử `a`/`img` bấm được; HTML thô là chữ; U+202E bị bỏ; **0 yêu cầu mạng từ webview** (CSP); đóng/mở lại VSCode ⇒ lượt khôi phục vẫn có huy hiệu + render an toàn |
| 11 | 10.4b-E: lỗi | tắt model ngoài / vượt trần ở nhà cung cấp giả | câu thân thiện theo mã (`NGOAI_TAT`, `NGOAI_VUOT_TRAN` + loại trần); không treo nút Dừng |
| 12 | Máy chủ tự lưu | sau lượt ngoài mở `/ai-chat` bản web | hội thoại hiện lượt với dấu nguồn; extension KHÔNG gọi `saveStreamedMessage` |

Sau live
- Dán output PASS/FAIL (và log harness) vào báo cáo; mục nào FAIL ⇒ sửa trên ext050 rồi chạy lại đúng mục + hồi quy.
- Gói `npm run package` ⇒ `avi-ai-local-0.5.0.vsix` (tên gói có thể đổi theo 11.7); cài; xác minh mã build trên host đã cài trùng commit; gửi dieu-phoi mã commit SAU khi lệnh in ra.
- Dọn: `rmdir` junction `vscode-extension/node_modules` ở worktree `_ai9_ui` nếu không còn dùng; tắt :3049.
