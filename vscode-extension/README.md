# AI Local (ST4I) — extension VSCode

Trợ lý lập trình AI chạy **nội bộ, offline**: hỏi trong một khung trò chuyện ngay trong VSCode,
extension gửi câu hỏi (kèm ngữ cảnh mã của tệp đang mở / tệp bạn `@` nhắc tới, đã che bí mật) tới
máy chủ AI Local trong mạng nhà máy (mặc định `http://localhost:3000`) và nhận câu trả lời chảy về
theo từng token qua SSE. Model chạy trên máy chủ, không gửi gì ra Internet.

**Mọi lượt ghi tệp và mọi lệnh chạy đều đi qua cửa duyệt** — mức quyền (dưới đây) chỉ quyết định
có hỏi bạn trước khi ghi hay không, không tắt hàng rào nào.

## Khung trò chuyện

- Mở bằng biểu tượng **AI Local** ở thanh bên phụ (VSCode cũ không có thanh bên phụ ⇒ thanh hoạt
  động bên trái), hoặc lệnh **AI Local: Mở bảng trò chuyện**.
- Gõ `@` để chèn một tệp trong workspace vào ngữ cảnh. Tệp nhạy cảm (`.env*`, khoá riêng, `.pem`,
  `.key`…) không bao giờ được gửi đi.
- Ô chọn dự án quyết định **chế độ**:
  - **LOCAL** — sửa tệp trên chính máy bạn (workspace đang mở). Extension là nơi cưỡng chế: chỉ ghi
    trong thư mục workspace, cấm `.env*`/khoá riêng, cấm `.git/…`, `.vscode/tasks.json`,
    `.vscode/launch.json`; có ĐÚNG MỘT điểm ghi và kiểm toán trước–sau mỗi lượt.
  - **SERVER** — sửa dự án trong hộp cát của máy chủ; máy chủ đề xuất, bạn duyệt trên thẻ diff,
    máy chủ ghi (RBAC + hộp cát phía máy chủ).
- Nút **Chat mới** / **Lịch sử** ở đầu khung; hội thoại lưu theo từng workspace.

## Mức quyền (góc khung trò chuyện, lưu theo từng workspace)

| Mức | Ghi tệp | Chạy lệnh |
|---|---|---|
| **Chỉ đọc** | Bị chặn tại điểm ghi (không chỉ ẩn nút) | Bị chặn |
| **Hỏi trước khi ghi** *(mặc định)* | Hiện thẻ diff, chỉ ghi khi bạn bấm duyệt | Hỏi trước khi chạy |
| **Tự ghi trong workspace** | Tự áp bản vá, vẫn qua đủ các hàng rào ghi | **Vẫn hỏi** trước khi chạy |

Workspace mới hoặc giá trị lưu hỏng luôn rơi về **Hỏi trước khi ghi**, không bao giờ về Tự ghi.

## Chạy lệnh trên máy bạn

AI có thể đề xuất chạy lệnh để kiểm chứng. Chỉ các lệnh trong danh sách trắng cố định được chạy:
`git status`, `git diff`, `npm run check`, `npx vitest run <tệp>`, `dotnet build <dự án>`,
`dotnet test <dự án>`. Lệnh chạy không qua shell (không ghép `;`/`|`/`&&` được), có trần thời gian
và trần 2 MB đầu ra, bí mật trong đầu ra được che trước khi hiện.

## Mười lệnh

Mở **Command Palette** (`Ctrl+Shift+P`), gõ "AI Local":

| Lệnh | Việc |
|---|---|
| **AI Local: Mở bảng trò chuyện** | Mở khung hỏi đáp. |
| **AI Local: Đăng nhập** | Hỏi tài khoản/mật khẩu, gọi `/api/auth/login`, cất cookie phiên vào SecretStorage của hệ điều hành (không lưu mật khẩu). |
| **AI Local: Đăng xuất** | Xoá cookie phiên và tên tài khoản đã cất. |
| **AI Local: Sửa đoạn đang chọn (hỏi AI)** — `Ctrl+Alt+K` | Bôi đen một đoạn trong editor, mô tả cần sửa gì; kết quả về dạng đề xuất phải duyệt. |
| **AI Local: Chat mới** | Bắt đầu hội thoại mới (nút `+` ở đầu khung). |
| **AI Local: Lịch sử** | Mở lại hội thoại cũ của workspace này. |
| **AI Local: Quản lý MCP server ngoài** | Xem, bật/tắt từng MCP server ngoài mà AI được phép gọi. |
| **AI Local: Nhớ điều này** | Lưu một ghi chú vào bộ nhớ dài hạn (bí mật được che trước khi lưu). |
| **AI Local: Bộ nhớ dài hạn** | Xem và xoá từng mục nhớ. |
| **AI Local: Đổi địa chỉ máy chủ** | Mở Settings lọc sẵn ô `aviAiLocal.serverUrl`. |

## MCP server ngoài

Khai trong `aviAiLocal.mcpServers` (User Settings, phạm vi **Máy**) theo khuôn `mcpServers` quen
thuộc: mỗi khoá là tên server, giá trị mang `command` / `args` / `cwd` / `env`. Lần đầu AI muốn gọi
một server, VSCode hỏi bạn có cho chạy tiến trình đó không; quyết định được nhớ theo máy và **hỏi
lại** khi `command`/`args`/`cwd` (hoặc tên các biến `env`) đổi. Đổi giá trị một biến `env` (xoay
token) không hỏi lại.

## Bộ nhớ dài hạn

Chỉ hai nguồn: bạn chủ động bảo nhớ (**Nhớ điều này**), hoặc AI đề xuất và bạn duyệt. Lưu trong
`workspaceState` của VSCode (không ghi tệp vào repo), xem/xoá được bằng **Bộ nhớ dài hạn**.

## Cấu hình

`Ctrl+,` rồi tìm "AI Local", hoặc sửa `settings.json` của User:

| Khoá | Mặc định | Ý nghĩa |
|---|---|---|
| `aviAiLocal.serverUrl` | `http://localhost:3000` | Địa chỉ máy chủ AI Local. Phạm vi **Máy**. |
| `aviAiLocal.uiLanguage` | `vi` | Ngôn ngữ trả lời (`vi` / `en` / `zh`). |
| `aviAiLocal.nganSachNguCanh` | `24000` | Trần số ký tự mã gửi kèm mỗi lượt hỏi; vượt trần thì cắt và khai rõ đã cắt. |
| `aviAiLocal.mcpServers` | `{}` | MCP server ngoài (xem trên). Phạm vi **Máy**. |

**Vì sao `serverUrl` và `mcpServers` có phạm vi Máy:** một `.vscode/settings.json` trong repo lạ
không thể ghi đè chúng — nếu không, mở một repo thù địch là đủ để chuyển cookie phiên sang máy chủ
khác hoặc chạy một tiến trình tuỳ ý. Giá trị đặt ở một cửa sổ áp cho mọi workspace trên máy đó.

## Tài khoản bật 2FA không dùng được

Extension chạy headless (không có bước nhập mã hai lớp). Tài khoản bật 2FA bị máy chủ từ chối rành
mạch khi đăng nhập — dùng tài khoản không bật 2FA cho extension.

## Cài đặt offline

```
code --install-extension avi-ai-local-0.1.0.vsix
```

Đóng gói từ gốc repo:

```
npm run ext:build
npm run ext:package
```

Lệnh sinh `vscode-extension/avi-ai-local-0.1.0.vsix` (không commit vào git).

## Giới hạn đã biết

- **Cookie đi dạng thường qua HTTP** trên LAN nhà máy (chưa có TLS nội bộ). Chỉ dùng trong mạng nội
  bộ tin cậy; không trỏ `serverUrl` ra Internet.
- Mức **Tự ghi** không áp cho chạy lệnh — lệnh luôn hỏi trước.
- Danh sách lệnh chạy được là cố định; muốn thêm lệnh phải sửa extension.
