# Cắm MCP server của repo vào Cursor / Claude Desktop / Claude Code

> Tài liệu này hướng dẫn cắm **MCP server local của chính repo `avi-aoi-management`** vào ba
> client AI ở **máy phát triển tại nhà (có internet)**, dùng **tài khoản của chính bạn**.
>
> Mọi chi tiết dưới đây được rút TRỰC TIẾP từ mã nguồn (có trích `tệp:dòng`). Chỗ nào không suy ra
> được chắc chắn từ mã sẽ ghi **CẦN KIỂM** — đừng coi đó là sự thật cho tới khi nghiệm thu live.

> ### ✅ ĐÃ NGHIỆM THU LIVE (2026-08-24)
> Đã chạy THẬT tiến trình `batDau.ts mcp` và bơm JSON-RPC qua stdio: khởi chạy + nạp `.env` ✓ ·
> `initialize`/`tools/list` (đúng 6 tool) ✓ · xác thực SAI → `[SAI_THONG_TIN]`, xác thực ĐÚNG →
> `avi_list_projects` trả `repo`/`csharp`/`react`/`demo-project` ✓ · **0/8 tài khoản bật 2FA, admin
> dùng được** ✓. Đồng thời **phát hiện + đã vá** một lỗi làm bẩn stdout (§6, §9). Chi tiết ở §9.

---

## 1. Bối cảnh — MCP này là gì, và KHÔNG là gì

- MCP server nằm ở `server/services/aiCodingCli/mcpServer.ts`. Nó **phơi bộ tool của repo (đọc mã,
  grep, đề xuất sửa) ra một ranh giới giao thức MCP** qua **stdio** (JSON-RPC 2.0, mỗi thông điệp
  một dòng). Xem docblock `mcpServer.ts:1-58` và khung stdio `mcpServer.ts:276-407`.
- **Model đang "suy nghĩ" là model TRÊN MẠNG của client** (Claude/Cursor), KHÔNG phải model local
  :8091. Docblock nói thẳng: *"Cắm file này vào Claude Code / Cursor thì model đang suy nghĩ là
  model TRÊN MẠNG. Nhà máy không có internet ⇒ đường này vô dụng ở nhà máy; nó là tiện ích cho máy
  phát triển."* (`mcpServer.ts:6-9`). Vì vậy con đường này chỉ hợp lý ở **máy nhà có internet**.
- **MCP KHÔNG có tool duyệt** (không có `avi_confirm`). Mọi tool GHI chỉ tạo ra một **ĐỀ XUẤT** —
  0 byte chạm đĩa — rồi một **con người** phải duyệt ở web `/ai-coding-workspace` hoặc ở
  `npm run ai:cli`. Đây là bất biến lớn nhất của file (`mcpServer.ts:27-38`).
- **CẢNH BÁO TIN CẬY:** chỉ cắm khi bạn tin máy chủ MCP này. Nó chạy dưới **quyền của tài khoản bạn
  đăng nhập** (RBAC `ai_repo_read` / `ai_repo_exec`), đọc mã nguồn thật trong các gốc đã khai và có
  thể tạo đề xuất sửa/chạy lệnh. Mật khẩu bạn đặt trong tệp cấu hình là **thông tin đăng nhập của
  một tài khoản THẬT** (`mcpServer.ts:47-49`).

---

## 2. Điều kiện tiên quyết THẬT (đọc từ mã, không đoán)

| Yêu cầu | Bắt buộc? | Vì sao (trích mã) |
|---|---|---|
| **Node.js + `tsx`** đã cài | ✅ | Điểm vào chạy bằng `tsx` (`package.json:59` — `ai:mcp` = `tsx server/services/aiCodingCli/batDau.ts mcp`). `tsx` là devDependency `^4.21.0` (`package.json:228`). Phải `pnpm install` (repo dùng `pnpm@10.4.1`, `package.json:236`) để có `node_modules`. |
| **PostgreSQL đang chạy + `DATABASE_URL` hợp lệ** | ✅ | Danh tính đi qua `verifyCredentials` → `db` (`danhTinhCli.ts:56,160`; `authService.ts:185,205`). DB không với tới ⇒ mọi `tools/call` trả lỗi `LOI_HE_THONG` (`danhTinhCli.ts:173-178`). MCP cũng nạp danh sách dự án từ DB lúc khởi động (`mcpServer.ts:405`). |
| **Nạp `.env` qua `batDau.ts`** | ✅ | `.env` (chứa `DATABASE_URL`, `AI_REPO_SANDBOX_ROOTS`) **chỉ** được nạp ở `batDau.ts` (`import "dotenv/config"`, `batDau.ts:31`). `mcpServer.ts` cố ý **KHÔNG** nạp `.env`. ⇒ Phải khởi chạy qua `batDau.ts mcp`, KHÔNG chạy thẳng `mcpServer.ts` (xem §6). |
| **`AI_REPO_SANDBOX_ROOTS`** khai các gốc dự án | ⚪ Tuỳ chọn | Vắng ⇒ chỉ MỘT dự án mặc định id `repo` = thư mục làm việc (`repoProjects.ts:61-65,142-144`; `repoSandbox.ts:109-113`). Repo này đã khai sẵn 3 gốc `repo`, `csharp`, `react` (`.env:980`). |
| **llama-server (:8091)** | ❌ KHÔNG cần | 5 tool MCP chạy thẳng qua `executeDecision` (`mcpServer.ts:248` → `cauNoiCli.ts:168-174`). Nhánh đọc chỉ gọi `tool.handler(...)` (`index.ts:251-263`); nhánh ghi chỉ `proposeAction` (`index.ts:231-244`). **Không nhánh nào gọi model local.** |
| **Web server (:3000)** | ❌ KHÔNG cần để chạy tool | Đọc/grep/list chạy độc lập. **CHỈ** cần web (hoặc `npm run ai:cli`) khi bạn muốn **DUYỆT** một đề xuất ghi (`mcpServer.ts:263`). |

> **CẦN KIỂM — phiên bản Node:** `package.json` không có trường `engines`. Suy từ `@types/node ^24`
> (`package.json:211`) thì Node ≥ 20; khuyến nghị **Node 22 LTS**. Hãy xác nhận Node đang cài khi
> nghiệm thu.

---

## 3. Lấy danh tính (dùng tài khoản của bạn)

**Cơ chế THẬT trong mã — KHÔNG có token riêng.** Danh tính CLI/MCP = **một lượt đăng nhập THẬT**
bằng cặp **tên đăng nhập + mật khẩu**, đi qua đúng hàm mà web dùng (`verifyCredentials`, bcrypt trên
`user_secrets`). Không có bảng token, không có tệp vé, không có biến `--user-id` (`danhTinhCli.ts:18-29`).

Hai biến môi trường (đặt trong khối `env` của cấu hình MCP client):

| Biến | Ý nghĩa | Trích mã |
|---|---|---|
| `AVI_MCP_USER` | Tên đăng nhập | `danhTinhCli.ts:213-216` (`BIEN_NGUOI_DUNG.mcp`), đọc ở `mcpServer.ts:197` |
| `AVI_MCP_PASSWORD` | Mật khẩu | `danhTinhCli.ts:208-211` (`BIEN_MAT_KHAU.mcp`), đọc ở `mcpServer.ts:198` |

**Quyền của MCP = RBAC của tài khoản đó:** `ai_repo_read` (`canView`/`canEdit`) và `ai_repo_exec`
(`canCreate`) (`danhTinhCli.ts:8-9`; `mcpServer.ts:48`).

### ⚠⚠⚠ HAI cạm bẫy phải biết trước khi dùng tài khoản admin

1. **2FA bật ⇒ MCP TỪ CHỐI (fail-closed).** Nếu tài khoản bật xác thực hai lớp, `xacThucCli` trả mã
   `CAN_2FA` và **mọi** `tools/call` thất bại (`danhTinhCli.ts:34-39,179`). CLI/MCP lượt này **chưa
   có** đường nhập mã TOTP. Tài khoản admin **thường bật 2FA** (nhiều mutation admin trong repo đòi
   `adminProcedure + 2FA`, ví dụ `repoProjects.ts:16`).
   → **Đã đo (2026-08-24):** trên máy này **0/8 tài khoản** bật 2FA; tài khoản admin (`admin`, id 1)
   **không** bật 2FA ⇒ dùng được ngay. Nếu về sau bạn bật 2FA cho tài khoản dùng MCP thì phải **tắt
   2FA cho tài khoản đó**, hoặc dùng một **tài khoản riêng không bật 2FA**.

2. **Mã khuyến nghị KHÔNG dùng admin cho MCP.** Docblock nói: *"Dùng một tài khoản riêng cho MCP,
   đừng dùng tài khoản admin của bạn."* (`mcpServer.ts:48-49`) — vì mật khẩu nằm trong tệp cấu hình
   và toàn bộ quyền admin đi kèm. Bạn đã chọn dùng tài khoản của mình; nếu muốn giảm rủi ro, cân
   nhắc một tài khoản chỉ có `ai_repo_read`.

### Giữ bí mật ở đâu

- Mật khẩu = **quyền của tài khoản**. Đặt nó trong **tệp cấu hình MCP nằm ở thư mục home của máy cá
  nhân** (ví dụ `%USERPROFILE%\.cursor\mcp.json`, `%APPDATA%\Claude\...`), **KHÔNG** commit, **KHÔNG**
  đưa vào repo.
- Nếu dùng file cấu hình theo dự án (`<repo>\.cursor\mcp.json` hoặc `<repo>\.mcp.json`), hãy chắc nó
  nằm trong `.gitignore` và **không** điền mật khẩu thật vào bản sẽ commit — chỉ để placeholder.

---

## 4. Ba mục cắm (khối config sao-là-chạy)

Đường dẫn repo trên máy này: **`D:\SOURCES\avi-aoi-management`**.
Lệnh khởi chạy (đọc từ `package.json:59`): `tsx server/services/aiCodingCli/batDau.ts mcp`, đóng gói
qua `npx` để chắc chắn tìm được `tsx` trong `node_modules`.

> Thay `<TEN_DANG_NHAP_ADMIN>` và `<MAT_KHAU_ADMIN>` bằng thông tin đăng nhập THẬT của bạn.

### 4.1. Cursor

- **Global (khuyến nghị cho máy cá nhân):** `%USERPROFILE%\.cursor\mcp.json`
- **Theo dự án:** `D:\SOURCES\avi-aoi-management\.cursor\mcp.json`

```json
{
  "mcpServers": {
    "avi-coding-repo": {
      "command": "npx",
      "args": ["tsx", "server/services/aiCodingCli/batDau.ts", "mcp"],
      "cwd": "D:\\SOURCES\\avi-aoi-management",
      "env": {
        "AVI_MCP_USER": "<TEN_DANG_NHAP_ADMIN>",
        "AVI_MCP_PASSWORD": "<MAT_KHAU_ADMIN>"
      }
    }
  }
}
```

### 4.2. Claude Desktop

Tệp: `%APPDATA%\Claude\claude_desktop_config.json`
(mở nhanh: dán `%APPDATA%\Claude` vào thanh địa chỉ `explorer`).

Claude Desktop trên Windows hay kén PATH nên bọc thêm `cmd /c`:

```json
{
  "mcpServers": {
    "avi-coding-repo": {
      "command": "cmd",
      "args": ["/c", "npx", "tsx", "server/services/aiCodingCli/batDau.ts", "mcp"],
      "cwd": "D:\\SOURCES\\avi-aoi-management",
      "env": {
        "AVI_MCP_USER": "<TEN_DANG_NHAP_ADMIN>",
        "AVI_MCP_PASSWORD": "<MAT_KHAU_ADMIN>"
      }
    }
  }
}
```

### 4.3. Claude Code

- **Theo dự án:** `D:\SOURCES\avi-aoi-management\.mcp.json`
- (Hoặc cấu hình người dùng `~/.claude.json` nếu muốn dùng ở mọi nơi.)

```json
{
  "mcpServers": {
    "avi-coding-repo": {
      "command": "npx",
      "args": ["tsx", "server/services/aiCodingCli/batDau.ts", "mcp"],
      "cwd": "D:\\SOURCES\\avi-aoi-management",
      "env": {
        "AVI_MCP_USER": "<TEN_DANG_NHAP_ADMIN>",
        "AVI_MCP_PASSWORD": "<MAT_KHAU_ADMIN>"
      }
    }
  }
}
```

> **Vì sao khối `env` chỉ có danh tính, không có `DATABASE_URL`?** Vì khởi chạy qua `batDau.ts` tự
> nạp `.env` của repo (`batDau.ts:31`), nên `DATABASE_URL` và `AI_REPO_SANDBOX_ROOTS` đã có sẵn. Nếu
> bạn muốn tách khỏi `.env`, có thể thêm chúng vào khối `env` — nhưng như vậy `DATABASE_URL` (kèm mật
> khẩu DB) sẽ nằm trong tệp cấu hình client. `dotenv` **không** ghi đè biến đã có trong môi trường
> tiến trình, nên biến trong khối `env` luôn thắng giá trị trong `.env`.

---

## 5. Các tool MCP phơi ra (tên THẬT)

Đăng ký tại `SO_TOOL_MCP` (`mcpServer.ts:95-183`); liệt kê qua `tools/list` (`mcpServer.ts:321-328`).

| Tool | Loại | Mô tả | Tool thật (`toolThat`) |
|---|---|---|---|
| `avi_list_projects` | đọc (cục bộ) | Liệt kê các dự án đã khai trong `AI_REPO_SANDBOX_ROOTS`. **Gọi đầu tiên để lấy ID.** | — (`mcpServer.ts:96-101`) |
| `avi_read_file` | đọc | Đọc nội dung THẬT một tệp (đường **tương đối** theo gốc dự án). Chặn `.env*`/khoá/chứng thư, `node_modules`/`.git`/`dist`. CHỈ ĐỌC. | `read_file` (`mcpServer.ts:102-118`) |
| `avi_list_files` | đọc | Liệt kê tệp/thư mục trong hộp cát của dự án (`depth` 1..3). | `list_files` (`mcpServer.ts:119-133`) |
| `avi_grep_repo` | đọc | Tìm một regex trong mã nguồn; trả đường dẫn + số dòng + dòng khớp. | `grep_repo` (`mcpServer.ts:134-150`) |
| `avi_propose_edit` | ghi (đề xuất) | **ĐỀ XUẤT** sửa một tệp — KHÔNG GHI. Trả `actionId`; người duyệt ở web/CLI. `original` phải là byte hiện tại (neo chống TOCTOU). | `apply_diff` (`mcpServer.ts:151-169`) |
| `avi_propose_command` | ghi (đề xuất) | **ĐỀ XUẤT** chạy một lệnh trong danh sách trắng (`npm run check`, `vitest run <đường>`, `git status`, `dotnet test`, …) — KHÔNG CHẠY. | `run_command` (`mcpServer.ts:170-182`) |

Mọi tham số dự án là **`projectId`** (một ID trong danh sách trắng), **không bao giờ là đường dẫn
gốc** (`mcpServer.ts:86-94`; `cauNoiCli.ts:37-42`).

---

## 6. Mẹo Windows

- **JSON cần `\\`:** trong tệp `.json`, đường Windows phải escape dấu `\` thành `\\`
  (ví dụ `"cwd": "D:\\SOURCES\\avi-aoi-management"`). Trong `args`, có thể dùng dấu `/` cho đường
  tương đối (`server/services/aiCodingCli/batDau.ts`) — `tsx` chấp nhận.
- **KHÔNG chạy thẳng `mcpServer.ts`.** Ví dụ ở docblock `mcpServer.ts:54-57`
  (`args: ["tsx", "server/services/aiCodingCli/mcpServer.ts"]`) sẽ **bỏ qua `.env`** (file đó không
  nạp `dotenv`), khiến `DATABASE_URL`/`AI_REPO_SANDBOX_ROOTS` trống. Luôn dùng **`batDau.ts mcp`**.
- **KHÔNG dùng `npm run ai:mcp` trần làm `command`.** `npm run` in banner (`> synapse-platform@...`)
  lên **stdout**, mà stdout là **đường ống giao thức** của MCP (`mcpServer.ts:51`) ⇒ hỏng khung
  JSON-RPC, client ngắt. Nếu buộc dùng npm thì phải `npm run --silent ai:mcp`.
- **Log hạ tầng của app KHÔNG còn làm bẩn stdout.** Trước đây `[OAuth]`/`[Database]`/`[Redis]` in
  bằng `console.log`/`info` → rơi vào stdout (đo LIVE 2026-08-24). Đã vá: `mcpStdoutSach.ts` (import
  đầu tiên trong `batDau.ts`) chuyển `console.log/info/debug` → **stderr** CHỈ khi chạy `mcp`; đáp
  JSON-RPC vẫn đi qua `process.stdout.write` trực tiếp nên stdout thuần. Rủi ro stdout còn lại DUY
  NHẤT là trình khởi chạy (banner `npm`) — đã tránh bằng cách gọi `tsx batDau.ts mcp` trực tiếp.
- **Nếu client báo `ENOENT`/không tìm thấy `npx`:** đổi `command` sang `"cmd"` với
  `args: ["/c", "npx", "tsx", "server/services/aiCodingCli/batDau.ts", "mcp"]` (như mục Claude
  Desktop), hoặc trỏ đường tuyệt đối tới `node_modules\.bin\tsx.cmd`.
- **Mở nhanh thư mục cấu hình:** dán `%APPDATA%\Claude` hoặc `%USERPROFILE%\.cursor` vào thanh địa
  chỉ của `explorer`.

---

## 7. Kiểm thử nhanh sau khi cắm

1. Mở client, kiểm tra MCP `avi-coding-repo` ở trạng thái "connected"/đã nạp tool.
2. Bảo AI gọi **`avi_list_projects`**. Thành công ⇒ trả bảng `ID  Tên` với `repo`, `csharp`, `react`
   (theo `.env:980`). Đây là phép thử tốt nhất vì nó chạm cả xác thực lẫn danh sách dự án.
3. Gọi **`avi_read_file`** với `projectId: "repo"`, `path: "package.json"` ⇒ trả nội dung tệp.
4. (Tuỳ chọn) Gọi **`avi_propose_edit`** ⇒ phải trả một `actionId` kèm câu *"ĐỀ XUẤT ĐÃ TẠO — CHƯA
   GHI/CHƯA CHẠY MỘT BYTE NÀO"* (`mcpServer.ts:251-266`). Không có tệp nào bị đổi — đúng như thiết kế.

### Xử lý lỗi thường gặp

| Triệu chứng | Nguyên nhân gốc | Cách xử lý |
|---|---|---|
| Mọi tool trả `[CAN_2FA] …` | Tài khoản bật 2FA ⇒ fail-closed (`danhTinhCli.ts:179`) | Tắt 2FA cho tài khoản đó, hoặc dùng tài khoản không 2FA |
| Mọi tool trả `[SAI_THONG_TIN]` | Sai `AVI_MCP_USER`/`AVI_MCP_PASSWORD` | Kiểm lại tên/mật khẩu trong khối `env` |
| Mọi tool trả `[LOI_HE_THONG]` | DB không với tới / `DATABASE_URL` sai | Bật PostgreSQL, kiểm `.env` `DATABASE_URL` |
| `avi_list_projects` chỉ thấy `repo` | `.env` không được nạp (chạy thẳng `mcpServer.ts`) hoặc `AI_REPO_SANDBOX_ROOTS` trống | Dùng `batDau.ts mcp` với `cwd` đúng repo |
| Client báo `ENOENT`/không chạy được | Không tìm thấy `npx`/`tsx`, hoặc `cwd` sai | Dùng `cmd /c npx …`; đảm bảo đã `pnpm install`; kiểm `cwd` |
| Client ngắt ngay sau khi kết nối | Có gì đó in ra **stdout** làm bẩn JSON-RPC | Đừng dùng `npm run` trần; dùng `npx tsx batDau.ts mcp` |

---

## 8. Hạn chế hiện tại (từ mã — KHÔNG sửa trong lượt này)

- **Không có tool duyệt trong MCP.** Đề xuất từ `avi_propose_edit`/`avi_propose_command` phải được
  một con người duyệt ở web `/ai-coding-workspace` (cần server :3000) hoặc ở
  `npm run ai:cli -- --du-an <id>` (`mcpServer.ts:27-38,263`). Đây là thiết kế có chủ đích, không
  phải thiếu sót.
- **Không có đường nhập mã 2FA** ở CLI/MCP ⇒ tài khoản bật 2FA không dùng được (`danhTinhCli.ts:34-39`).
- **Dự án thêm qua UI web khi phiên MCP đang chạy sẽ không hiện** cho tới khi khởi động lại phiên
  MCP (ảnh chụp DB nạp một lần lúc khởi động — `repoProjects.ts:26-35`).
- **Model suy luận là của client (trên mạng)** — MCP không cung cấp model; ở môi trường offline
  (nhà máy) con đường này không dùng được (`mcpServer.ts:6-9`).

---

## 9. Kết quả nghiệm thu live (2026-08-24)

Đã chạy THẬT tiến trình `batDau.ts mcp` (spawn `node tsx/dist/cli.mjs batDau.ts mcp`, cwd = repo) và
bơm JSON-RPC qua stdio:

1. **Khởi chạy + `.env`:** server lên, PostgreSQL + Redis Connected, `initialize` trả
   `serverInfo = avi-coding-repo v0.1.0` (protocol `2024-11-05`). ✅
2. **`tools/list`:** trả đúng **6 tool** (`avi_list_projects`, `avi_read_file`, `avi_list_files`,
   `avi_grep_repo`, `avi_propose_edit`, `avi_propose_command`). ✅
3. **Trọn tuyến xác thực:** creds SAI ⇒ `[SAI_THONG_TIN]` (chạm đúng cổng, KHÔNG đụng bộ đếm khoá của
   tài khoản thật vì dùng username giả); creds ĐÚNG (một tài khoản tạm không-2FA, đã xoá sau khi đo)
   ⇒ `avi_list_projects` trả bảng `repo` / `csharp` / `react` / `demo-project`, `isError=false`.
   ✅ Trọn tuyến auth → phiên → danh sách dự án.
4. **2FA:** đo DB — **0/8 tài khoản** bật 2FA; admin (`admin`, id 1) **không** 2FA ⇒ dùng được ngay,
   KHÔNG bị `CAN_2FA`. ✅
5. **STDOUT thuần JSON-RPC:** đo lần đầu thấy `[OAuth]`/`[Database]`/`[Redis]` **rơi vào stdout** (do
   `console.log`/`info` của hạ tầng) — sẽ làm bẩn khung với client nghiêm. **Đã vá** bằng
   `mcpStdoutSach.ts`; đo lại stdout **thuần**, log dời hết sang stderr. ✅ (lưới `mcpStdoutSach.test.ts`,
   5/5 xanh; typecheck toàn dự án exit 0)

Còn phụ thuộc máy đích (xác nhận khi bạn cắm ở nhà):
- **Phiên bản Node** — repo không khai `engines`; smoke chạy trên Node 24. Khuyến nghị ≥ 20.
- **Client tìm thấy `npx`/`tsx`:** nếu `ENOENT`, dùng `cmd /c npx …` (như §4.2) hoặc trỏ
  `node_modules\.bin\tsx.cmd`.
