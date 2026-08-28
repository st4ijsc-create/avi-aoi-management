# AI Local (ST4I) — extension VSCode

Trợ lý lập trình AI chạy **nội bộ, offline**: gõ câu hỏi trong một bảng trò chuyện ngay trong
VSCode, extension gửi câu hỏi (kèm ngữ cảnh mã nguồn của tệp đang mở, nếu bạn cho phép) tới máy
chủ AI Local đang chạy trong mạng nhà máy (mặc định `http://localhost:3000`) và nhận câu trả lời
chảy về theo từng token qua SSE (Server-Sent Events).

## Đợt A — CHỈ ĐỌC, chưa có đường ghi tệp nào

**Đây là giới hạn quan trọng nhất của bản này.** Ở Đợt A, extension:

- **Đọc** tệp đang mở, vùng bôi đen, danh sách dự án — để dựng ngữ cảnh gửi kèm câu hỏi.
- **Đọc** câu trả lời từ máy chủ và hiển thị trong bảng trò chuyện.
- **KHÔNG** ghi bất kỳ tệp nào trên đĩa, **KHÔNG** áp dụng patch/diff, **KHÔNG** có cửa duyệt
  ("apply"/"confirm") cho bất kỳ hành động ghi nào.

Đây không phải là thiếu sót tạm thời mà là **ràng buộc có chủ ý** của đợt này — được cưỡng chế
bằng một cổng đo được: `grep -rn "writeFile\|applyEdit\|confirmAction" vscode-extension/src/`
phải luôn trả về rỗng. Đường ghi tệp (áp dụng diff có cửa duyệt) thuộc phạm vi các đợt sau.

## Cấu hình

Mở **Settings** (`Ctrl+,`) và tìm "AI Local", hoặc sửa trực tiếp trong
`settings.json` (User/máy — xem lưu ý về `scope` bên dưới):

| Khoá | Mặc định | Ý nghĩa |
|---|---|---|
| `aviAiLocal.serverUrl` | `http://localhost:3000` | Địa chỉ máy chủ AI Local (box chạy model). |
| `aviAiLocal.uiLanguage` | `vi` | Ngôn ngữ trả lời (`vi` / `en` / `zh`). |
| `aviAiLocal.nganSachNguCanh` | `24000` | Trần số ký tự mã nguồn gửi kèm mỗi lượt hỏi. Vượt trần thì phần dư bị cắt và extension khai rõ đã cắt — không âm thầm bỏ. |

**Vì sao `aviAiLocal.serverUrl` có `scope: "machine"`:** khoá này KHÔNG thể bị một
`.vscode/settings.json` của workspace ghi đè. Đây là hàng rào có chủ ý chống rò mật khẩu/cookie
phiên sang một máy chủ lạ — nếu mở một repo không tin cậy có sẵn `.vscode/settings.json` trỏ
`serverUrl` sang máy của kẻ tấn công, extension vẫn dùng địa chỉ máy chủ do BẠN (người dùng/máy)
đặt, không phải địa chỉ mà workspace âm thầm chèn vào. Vì scope là "machine", giá trị đặt trong
một cửa sổ VSCode sẽ áp dụng cho mọi workspace mở trên máy đó.

## Ba lệnh

Mở **Command Palette** (`Ctrl+Shift+P`), gõ "AI Local":

- **AI Local: Đăng nhập** — hỏi tài khoản/mật khẩu, gọi `/api/auth/login` trên máy chủ, cất
  cookie phiên vào SecretStorage của hệ điều hành (không phải tệp cấu hình thường, không phải
  mật khẩu — chỉ cookie phiên).
- **AI Local: Đăng xuất** — xoá cookie phiên đã cất.
- **AI Local: Mở bảng trò chuyện** — mở webview để hỏi đáp.

## Tài khoản bật 2FA KHÔNG dùng được

Extension chạy **headless** (không có bước nhập mã xác thực hai lớp). Nếu tài khoản của bạn bật
2FA, đăng nhập sẽ bị máy chủ từ chối rành mạch (không rơi vào trạng thái "đăng nhập thành công"
giả) — dùng một tài khoản không bật 2FA, hoặc đăng nhập qua trình duyệt web của hệ thống chính.

## Cài đặt offline (không qua Marketplace)

```
code --install-extension avi-ai-local-0.1.0.vsix
```

Đóng gói tệp `.vsix` từ gốc repo bằng:

```
npm run ext:build
npm run ext:package
```

Lệnh trên sinh `vscode-extension/avi-ai-local-0.1.0.vsix` — tệp này **không** commit vào git
(xem `.gitignore` gốc), đóng gói lại mỗi khi cần cài.

## Giới hạn đã biết

- **Cookie đi dạng thường qua HTTP.** LAN nhà máy chạy HTTP (không có TLS nội bộ), nên cookie
  phiên đi trên mạng dạng không mã hoá giữa máy trạm và máy chủ AI Local. Chỉ dùng trong mạng
  nội bộ tin cậy; không trỏ `serverUrl` ra Internet công cộng.
- Chưa có test end-to-end tự động cho extension (`@vscode/test-electron`) — để đợt sau.
- Chưa có đường ghi tệp/áp dụng diff nào (xem mục "Đợt A" ở trên) — để đợt sau.
