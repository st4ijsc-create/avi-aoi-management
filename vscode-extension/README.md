# AI Local (ST4I) — extension VSCode

Trợ lý lập trình AI chạy **nội bộ, offline**, làm việc như một *agent*: bạn giao việc trong khung trò chuyện,
AI tự đọc/tìm mã trong workspace, lập kế hoạch, **sửa nhiều tệp** (sửa · tạo · xoá · đổi tên), chạy lệnh kiểm chứng
(build/test) và đọc kết quả rồi sửa tiếp — mọi lượt ghi đi qua **một điểm ghi duy nhất có kiểm toán** và (mặc định)
qua **thẻ duyệt từng tệp** có diff. Model chạy trên máy chủ AI Local trong mạng nhà máy (mặc định
`http://localhost:3000`), không gửi gì ra Internet.

Từ bản 0.2, extension chạy **lõi agent dùng chung** (`shared/agentCore` — cùng lõi máy chủ chạy cho trình duyệt), gọi
model qua `/v1/chat/completions` (stream + tool-calling gốc) bằng **token theo người dùng** lấy qua *device flow*.

## Đăng nhập — hai thứ, hai việc

| Lệnh | Dùng cho | Cất ở đâu |
|---|---|---|
| **AI Local: Đăng nhập AI Local (device flow)** | Gọi model của agent (`/v1`). Mở trình duyệt tới trang `/ai-thiet-bi` của máy chủ (phiên web đã đăng nhập, **kể cả tài khoản 2FA**), **gõ mã thiết bị đang hiện trong VSCode của bạn** (trang không điền sẵn mã — chống lừa đảo mã), bấm *Cho phép*; extension chờ và nhận token `avgw_…`. | SecretStorage của hệ điều hành (không bao giờ ở settings) |
| **AI Local: Đăng nhập phiên (mật khẩu)** | Sổ kiểm toán ghi tệp (`batDauApDungOClient`/`chotApDungOClient` hiện chỉ nhận cookie phiên) và chế độ **Chat cũ**. Tài khoản 2FA chưa dùng được đường này. | SecretStorage (cookie phiên; mật khẩu không lưu) |
| **AI Local: Đăng xuất** | Xoá cookie phiên **và** token `/v1` khỏi máy này. Token vẫn còn hiệu lực trên máy chủ tới khi hết hạn — thu hồi hẳn ở trang `/ai-thiet-bi`. | — |

Thiếu token ⇒ agent báo lỗi kèm nút đăng nhập; thiếu cookie phiên ⇒ agent vẫn đọc/tìm được nhưng **không ghi** (không
mở được sổ kiểm toán thì không ghi — thà không ghi còn hơn ghi mà không có vết).

## Khung trò chuyện

- Mở bằng biểu tượng **AI Local** ở thanh bên phụ (VSCode cũ ⇒ thanh hoạt động bên trái), hoặc lệnh
  **AI Local: Mở bảng trò chuyện**.
- **Chế độ** (ô chọn trên hàng nhập):
  - **Agent — duyệt từng bước** *(mặc định)*: mọi thay đổi tệp và mọi lệnh hiện thành **thẻ duyệt riêng cho từng
    tệp** — *Xem diff* (diff native của VSCode), *Duyệt*, *Bác* kèm lý do (AI đọc lý do và đổi cách làm).
  - **Agent — tự động**: tự áp thay đổi tệp — **chỉ khi mức quyền là "Tự ghi trong workspace"**; mức khác vẫn hỏi
    từng tệp. Lệnh **luôn** hỏi trước.
  - **Hỏi (chỉ đọc)**: AI chỉ đọc/tìm/giải thích, không có tool ghi.
  - **Chat cũ (máy chủ)**: đường hỏi–đáp cũ qua máy chủ (giữ cho dự án SERVER và thói quen cũ; `Ctrl+Alt+K` luôn đi
    đường này).
- Trả lời hiển thị **markdown** (đóng gói `marked`, chỉ dùng bộ phân tích; webview dựng DOM bằng `textContent`, không
  `innerHTML` nội dung, CSP chặt). Mỗi khối mã có **Chép** · **Chèn** (vào con trỏ, qua điểm ghi) · **Áp dụng**
  (thay vùng chọn — hoặc cả tệp đang mở — dưới dạng đề xuất có thẻ duyệt + diff).
- **Dòng thời gian**: mỗi lời gọi tool một dòng thu gọn (bấm để xem tóm tắt kết quả), **kế hoạch** của AI
  (`todo_write`), phần suy luận của model thu gọn riêng.
- **Dừng** ngắt lượt đang chạy ngay (cả lúc chờ model lẫn lúc chờ duyệt). **Hoàn tác lượt chạy** đưa mọi tệp lượt vừa
  chạy đã chạm về bản gốc (checkpoint trong bộ nhớ extension, khôi phục qua đúng điểm ghi); tệp nào đã bị sửa tiếp sau
  AI ⇒ **xung đột**, cả lượt hoàn tác bị từ chối, không tệp nào bị đụng.
- **Đồng hồ ngữ cảnh**: số token ngữ cảnh gửi model ở lượt gần nhất (dấu `~` = ước lượng 2,8 ký tự/token vì cổng
  `/v1` chưa trả `usage` khi stream) và % ngân sách 64k.
- Nút **Chat mới** / **Lịch sử** ở đầu khung; hội thoại lưu theo từng workspace.

### Ngữ cảnh tự đính

- Tệp đang mở + vùng chọn (nếu có) tự đi kèm câu hỏi.
- Gõ `@` để chèn tệp hoặc thư mục; `@folder:<đường>` cho một thư mục; `@problems` (lỗi/cảnh báo VSCode đang báo);
  `@git` (`git diff` của workspace).
- Tệp quy ước của dự án — `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md` — vào khối ngữ cảnh dự án
  (là DỮ LIỆU của dự án, không đổi quy tắc an toàn). **Bộ nhớ dài hạn** đã duyệt cũng vào ngữ cảnh.
- Tệp nhạy cảm (`.env*`, khoá riêng, `.pem`, `.key`, `.git/…`) không bao giờ được đọc hay gửi; bí mật trong nội dung
  được che trước khi rời máy.

### Lệnh gạch

| Lệnh | Việc |
|---|---|
| `/fix` | Sửa các lỗi VSCode đang báo cho tệp đang mở, rồi tự kiểm lại bằng `get_diagnostics`. |
| `/test` | Viết test cho vùng chọn (hoặc tệp đang mở) theo quy ước test sẵn có của dự án, rồi chạy. |
| `/explain` | Giải thích vùng chọn/tệp (chế độ chỉ đọc). |
| `/commit` | Sinh thông điệp commit từ `git diff --staged`. **Extension không bao giờ tự commit.** |

### Tool của agent trong VSCode

Đọc: `read_file` · `list_dir` · `find_files` · `grep` (regex trên tệp workspace) · `find_symbol` (language server sẵn
có: định nghĩa + tham chiếu) · `get_diagnostics` (lỗi VSCode đang báo). Ghi: `edit_file` · `write_file` ·
`delete_file` · `rename_file`. Lệnh: `run_command` (danh sách trắng dưới đây; **đầu ra + exit code trả về AI** để nó
lặp tới khi xanh). Nhớ: `remember` chỉ là **đề xuất** — chỉ ghi khi bạn bấm *Nhớ*. `search_code`/`search_docs` (chỉ mục
ngữ nghĩa, kho tài liệu) chỉ có ở phía máy chủ, không bày trong extension.

## Mức quyền (góc khung trò chuyện, lưu theo từng workspace)

| Mức | Ghi tệp | Chạy lệnh |
|---|---|---|
| **Chỉ đọc** | Bị chặn tại điểm ghi (không chỉ ẩn nút) | Bị chặn |
| **Hỏi trước khi ghi** *(mặc định)* | Thẻ duyệt từng tệp, chỉ ghi khi bạn bấm duyệt | Hỏi trước khi chạy |
| **Tự ghi trong workspace** | Agent tự động áp; vẫn qua đủ các hàng rào ghi | **Vẫn hỏi** trước khi chạy |

Workspace mới hoặc giá trị lưu hỏng luôn rơi về **Hỏi trước khi ghi**, không bao giờ về Tự ghi.

## Hàng rào ghi (một điểm ghi duy nhất)

Mọi lượt ghi — của agent, của nút Chèn/Áp dụng, của hoàn tác, của Cmd+K — đi qua đúng một hàm: giải đường thật (chặn
symlink ra ngoài) · chỉ trong thư mục workspace · cấm `.env*`/khoá riêng/`.git/…`/`.vscode/tasks.json`/`launch.json` ·
chống xung đột bằng băm + bộ đệm chưa lưu · từ chối tệp EOL lẫn lộn · **từ chối nội dung đưa dấu che MỚI
(`[REDACTED_…]`, `«đã che»`) vào tệp** · sổ kiểm toán máy chủ **mở trước khi ghi, chốt sau khi đọc lại đĩa** · chỉ khai
"đã ghi" khi đọc lại đĩa khớp. Ghi qua API chỉnh sửa của VSCode nên `Ctrl+Z` hoàn tác được.

## Chạy lệnh trên máy bạn

Chỉ các lệnh trong danh sách trắng cố định được chạy: `git status`, `git diff`, `git diff --staged`, `npm run check`,
`npx vitest run <tệp>`, `dotnet build <dự án>`, `dotnet test <dự án>`. Lệnh chạy không qua shell (không ghép
`;`/`|`/`&&` được), có trần thời gian và trần 2 MB đầu ra, bí mật trong đầu ra được che.

## Các lệnh

Mở **Command Palette** (`Ctrl+Shift+P`), gõ "AI Local":

| Lệnh | Việc |
|---|---|
| **AI Local: Mở bảng trò chuyện** | Mở khung trò chuyện / agent. |
| **AI Local: Đăng nhập AI Local (device flow)** | Device flow lấy token `/v1` cho agent (xem *Đăng nhập*). |
| **AI Local: Đăng nhập phiên (mật khẩu)** | Cookie phiên cho sổ kiểm toán ghi tệp và Chat cũ. |
| **AI Local: Đăng xuất** | Xoá cookie phiên, tên tài khoản và token `/v1` cục bộ. |
| **AI Local: Sửa đoạn đang chọn (hỏi AI)** — `Ctrl+Alt+K` | Bôi đen một đoạn, mô tả cần sửa gì; kết quả về dạng đề xuất phải duyệt (đường Chat cũ). |
| **AI Local: Chat mới** | Bắt đầu hội thoại mới (nút `+` ở đầu khung). |
| **AI Local: Lịch sử** | Mở lại hội thoại cũ của workspace này. |
| **AI Local: Hoàn tác lượt chạy agent** | Đưa các tệp lượt agent gần nhất đã chạm về bản gốc (từ chối nếu có xung đột). |
| **AI Local: Quản lý MCP server ngoài** | Xem, bật/tắt từng MCP server ngoài mà AI được phép gọi (Chat cũ). |
| **AI Local: Nhớ điều này** | Lưu một ghi chú vào bộ nhớ dài hạn (bí mật được che trước khi lưu). |
| **AI Local: Bộ nhớ dài hạn** | Xem và xoá từng mục nhớ. |
| **AI Local: Đổi địa chỉ máy chủ** | Mở Settings lọc sẵn ô `aviAiLocal.serverUrl`. |
| **AI Local: Bật/tắt gợi ý chữ mờ (ghost-text)** | Bật/tắt gợi ý mã khi gõ (cũng là nút `AI gợi ý` ở thanh trạng thái). |

## Gợi ý chữ mờ khi gõ (ghost-text)

Gõ mã trong một tệp của workspace ⇒ sau ~250 ms ngừng gõ, AI Local gợi ý phần tiếp theo dạng chữ mờ; **Tab** để nhận,
gõ tiếp để bỏ (`Alt+\` gọi gợi ý ngay). Giữa một dòng đã có chữ ⇒ gợi ý tới hết dòng; trên một dòng trống ⇒ có thể gợi
ý cả khối (tối đa 8 dòng).

- **Mặc định TẮT** — bật bằng nút `AI gợi ý` ở thanh trạng thái hoặc `aviAiLocal.ghostText.enabled`.
- Cần **token `/v1`** (lệnh *Đăng nhập AI Local (device flow)*, phạm vi `fim`). Gọi `POST /v1/completions` với model
  logic `fim` (model nhỏ chạy trong tiến trình máy chủ, không chiếm slot của model chính).
- Chỉ gửi ~2.000 ký tự trước và ~800 ký tự sau con trỏ, **đã che bí mật**. Không gợi ý (không gửi byte nào) cho
  `.env`, khoá riêng, `.git/`, tệp ngoài workspace, tệp không phải trên đĩa, tệp quá 1 triệu ký tự.
- Gợi ý chứa dấu che (model chỉ thấy bản đã che) bị bỏ — không chèn rác vào mã thật.
- Lỗi **không bao giờ bật hộp thoại**: chỉ ghi vào kênh Output **"AI Local — Ghost text"** (kèm độ trễ từng lượt, không
  ghi mã) và đổi biểu tượng thanh trạng thái; lỗi mạng ⇒ nghỉ 30 s, token hỏng ⇒ nghỉ tới khi đăng nhập lại.
- Nhận gợi ý là VSCode chèn vào bộ đệm (Ctrl+Z hoàn tác) — không phải một đường ghi đĩa của extension.

## MCP server ngoài

Khai trong `aviAiLocal.mcpServers` (User Settings, phạm vi **Máy**) theo khuôn `mcpServers` quen thuộc: mỗi khoá là tên
server, giá trị mang `command` / `args` / `cwd` / `env`. Lần đầu AI muốn gọi một server, VSCode hỏi bạn có cho chạy
tiến trình đó không; quyết định được nhớ theo máy và **hỏi lại** khi `command`/`args`/`cwd` (hoặc tên các biến `env`)
đổi. Hiện dùng ở chế độ Chat cũ.

## Bộ nhớ dài hạn

Chỉ hai nguồn: bạn chủ động bảo nhớ (**Nhớ điều này**), hoặc AI đề xuất (`remember`) và bạn bấm *Nhớ*. Lưu trong
`workspaceState` của VSCode (không ghi tệp vào repo), xem/xoá được bằng **Bộ nhớ dài hạn**, và được đưa vào ngữ cảnh
của agent.

## Cấu hình

`Ctrl+,` rồi tìm "AI Local", hoặc sửa `settings.json` của User:

| Khoá | Mặc định | Ý nghĩa |
|---|---|---|
| `aviAiLocal.serverUrl` | `http://localhost:3000` | Địa chỉ máy chủ AI Local. Phạm vi **Máy**. |
| `aviAiLocal.uiLanguage` | `vi` | Ngôn ngữ trả lời (`vi` / `en` / `zh`). |
| `aviAiLocal.anhChoTroLy` | `false` | Cho phép đính ảnh (dán/kéo/chọn) khi hỏi Trợ lý. Mặc định TẮT vì máy chủ phải nạp model thị giác (tốn VRAM, thêm độ trễ); chỉ bật khi quản trị đã bật đọc ảnh. |
| `aviAiLocal.nganSachNguCanh` | `24000` | Trần số ký tự mã gửi kèm mỗi lượt hỏi ở Chat cũ. |
| `aviAiLocal.mcpServers` | `{}` | MCP server ngoài (xem trên). Phạm vi **Máy**. |
| `aviAiLocal.agentModel` | `chat` | Model logic của cổng `/v1` cho agent (`chat` / `code`). Phạm vi **Máy**. |
| `aviAiLocal.agentMaxTokens` | `16000` | Trần token sinh của một lượt model (gồm suy luận). Phạm vi **Máy**. |
| `aviAiLocal.ghostText.enabled` | `false` | Bật gợi ý chữ mờ khi gõ (ghost-text). Phạm vi **Máy**. |
| `aviAiLocal.ghostText.doTreMs` | `250` | Thời gian ngừng gõ (ms) trước khi xin gợi ý (50–2000). Phạm vi **Máy**. |

**Vì sao các khoá trên có phạm vi Máy:** một `.vscode/settings.json` trong repo lạ không thể ghi đè chúng — nếu không,
mở một repo thù địch là đủ để chuyển cookie/token sang máy chủ khác hoặc chạy một tiến trình tuỳ ý.

## Cài đặt offline

```
code --install-extension avi-ai-local-0.2.0.vsix
```

Đóng gói từ gốc repo:

```
npm run ext:build
npm run ext:package
```

Lệnh sinh `vscode-extension/avi-ai-local-0.2.0.vsix` (không commit vào git).

## Giới hạn đã biết

- **Cookie và token đi dạng thường qua HTTP** trên LAN nhà máy (chưa có TLS nội bộ). Chỉ dùng trong mạng nội bộ tin
  cậy; không trỏ `serverUrl` ra Internet.
- Ghi tệp vẫn cần **cookie phiên** (sổ kiểm toán chưa nhận token `/v1`) ⇒ tài khoản 2FA dùng agent đọc được nhưng
  chưa ghi được cho tới khi máy chủ mở sổ kiểm toán cho token.
- Khi model phát lời gọi tool bên trong phần suy luận, extension hỏi lại lượt đó một lần với yêu cầu tắt nghĩ; cổng
  `/v1` hiện chưa chuyển tiếp yêu cầu tắt nghĩ xuống engine.
- Ghost-text dùng một yêu cầu không stream mỗi lần ngừng gõ; máy chủ chưa có bộ đệm tiền tố cho FIM trong tiến trình,
  nên mỗi gợi ý tính lại toàn bộ ngữ cảnh (~0,1–0,25 s trên model 1,5B).
- Mức **Tự ghi** không áp cho chạy lệnh — lệnh luôn hỏi trước. Danh sách lệnh chạy được là cố định.
