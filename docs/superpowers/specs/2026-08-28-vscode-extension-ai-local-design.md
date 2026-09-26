# Extension VSCode cho AI Local — thiết kế

- **Ngày**: 2026-08-28
- **Nhánh**: `feat/hmi-dep` (remote `fresh`)
- **Trạng thái**: thiết kế ĐÃ DUYỆT (5/5 mục), chưa viết dòng mã nào
- **Kế hoạch triển khai**: `docs/superpowers/plans/2026-08-28-vscode-extension-ai-local.md`

## 1. Mục tiêu

Đưa AI Local (Qwen3-30B chạy offline) vào VSCode dưới dạng **extension**, ngang tầm Claude
Code / GitHub Copilot về trải nghiệm: hỏi đáp có ngữ cảnh mã, sửa đoạn chọn (Cmd+K), tác nhân
đa bước, và **mọi lượt ghi đều qua cửa duyệt của người**.

Không có internet ở nhà máy. Extension phải cài và chạy hoàn toàn offline.

## 2. Quyết định đầu vào (do người dùng chốt)

| Câu hỏi | Quyết định |
|---|---|
| Phạm vi v1 | **Native đầy đủ** (chat · Cmd+K · tác nhân đa bước · @-mention) |
| Máy chạy VSCode vs server AI | **Tách riêng** — server AI ở box khác |
| Mã nguồn dev nằm ở đâu | **Trên máy dev** (workspace VSCode) — extension tự sở hữu I/O tệp |
| Ghost-text (gợi ý nội tuyến) | **HOÃN** — model vài phút/lượt, 32 GB VRAM chỉ 1 instance; không hợp gợi-ý-mỗi-nhịp-gõ |
| Nơi lưu dự án | **CẢ HAI** — chọn được: dự án trên SERVER hoặc dự án LOCAL |

## 3. Dữ kiện khảo sát quyết định kiến trúc

Đo trên mã thật, kèm vị trí:

1. **`client_action` KHÔNG phải tiền lệ cho cầu-tool hai chiều.** Một chiều, không có endpoint
   trả kết quả, và còn *kết thúc* vòng lặp (`server/services/aiLocalTools/toolLoop.ts:384-389`,
   `stop = "hanh_dong_client"`).
2. **Server cố ý không nhận đường dẫn từ client.** Mọi gốc dự án là đường tuyệt đối trên máy
   server, có census AST cưỡng chế (`server/services/aiLocalTools/toolRegistry.ts:106-112`;
   `server/services/aiCodingCli/cauNoiCli.ts:37-42`). `projectId` lạ ⇒ từ chối MỀM trong thân
   SSE, HTTP vẫn 200 (`server/services/aiLocalKnowledgeService.ts:3086-3091`).
3. **Chỉ có ĐÚNG HAI nơi trong repo gọi `.handler(`**, có lưới AST canh
   (`server/services/aiLocalTools/index.ts:186-190`). Thêm bộ thực thi tool thứ ba ⇒ lưới đỏ
   *theo thiết kế*.
4. **Vòng tool server có trần 20 giây/lượt** (`toolLoop.ts:160-163`, `maxMs=20_000`,
   `AI_TOOL_LOOP_MAX_MS`) trong khi model chạy **vài phút/lượt**. Vòng mặc định TẮT
   (`AI_TOOL_LOOP_ENABLED=1`).
5. **`pending_action` cho `apply_diff` mang TOÀN VĂN**: `{path, original, modified}` mỗi trường
   ≤ 2 MB (`server/services/aiLocalTools/writeHandlers/applyDiff.ts:266-272`), cộng
   `preview.changes.sha256Before/After` (`:500-506`). Đủ để client dựng diff và tự phát hiện
   xung đột bằng đúng vị từ server dùng (`:399-404`, `BASE_MISMATCH`).
6. **Xác thực = COOKIE phiên** `app_session_id` do `POST /api/auth/login` cấp
   (`server/_core/authService.ts:433`); `httpOnly` **không** cản Node. Tài khoản bật 2FA ⇒ không
   dùng được ở chế độ headless (giống CLI hiện tại).
7. **Enum `aipendingactionstatus` hiện có**: `proposed | confirmed | executed | denied | expired
   | cancelled` (`drizzle/schema/enums.ts:169-176`) — **không giá trị nào** diễn tả "client đã
   áp".
8. **Lỗ nói dối SẴN CÓ**: `confirmAction` đặt `status='executed'` **bất kể** `apply_diff` có từ
   chối hay không (`server/services/aiCopilotActions.ts:885-888`) — chính vì thế mới phải đẻ ra
   `daBiTuChoiGhi()` (`shared/aiCodingLoop.ts:335-361`).
9. `AGENT_MAX_WRITES_PER_SESSION=3` **không** áp cho đường chat/SSE (chỉ cho
   `aiAgentOrchestrator`). TTL đề xuất 5 phút (`aiCopilotActions.ts:75`).
10. VSCode trên máy dev: **1.134.0**. Chưa có `@types/vscode`, chưa có `@vscode/vsce`.

### Vì sao KHÔNG chọn cầu-tool hai chiều

Dù có cầu, **byte vẫn phải rơi ở máy dev** ⇒ phần "client áp + kiểm toán trung thực" là bắt buộc
ở mọi phương án. Cầu chỉ mua thêm "vòng lặp nghĩ ở server", đổi lại: protocol round-trip mới,
sửa lưới census an toàn, **nhân bản toàn bộ vị từ hộp cát** (`repoSandbox.ts`) sang extension
(đúng cái bẫy "hai bản sao một vị từ, bản lỏng hơn là bản đang chạy"), và phải vừa trần 20 giây.
⇒ Phương án cầu-tool = phương án client **cộng thêm** gánh nặng, không mua thêm an toàn.

## 4. Kiến trúc

```
VSCode (máy dev)                          Server AI (box khác)
├─ Extension host (Node)                  ├─ POST /api/auth/login → cookie app_session_id
│  ├─ Đăng nhập + SecretStorage            ├─ POST /api/ai/local-kb/stream (SSE)
│  ├─ SSE client ─────────────────────────►│
│  ├─ Vòng tác nhân (chế độ LOCAL)         ├─ tRPC aiCopilot.* (duyệt + kiểm toán)
│  ├─ Tool cục bộ: đọc/liệt kê/grep        ├─ tRPC repoWorkspace.* (dự án SERVER)
│  ├─ Cửa duyệt: diff native VSCode        └─ model + RAG + RBAC
│  └─ MỘT điểm ghi đĩa → applyEdit
└─ Webview panel (UI chat)
```

**UI = webview panel riêng, KHÔNG dùng Chat Participant API** — khung Chat của VSCode gắn với
đăng nhập GitHub/Copilot; nhà máy không có internet, không tài khoản GitHub.

**Vị trí mã**: thư mục mới `vscode-extension/` với `package.json` + `tsconfig` riêng. Không
thêm dependency nào vào app chính.

### 4.1 Ranh giới an toàn — điều THAY ĐỔI, nói thẳng

Hôm nay cửa duyệt do **server** cưỡng chế được vì server giữ tệp. Với mã trên máy dev, **server
không với tới tệp** ⇒ **server không cưỡng chế được nữa**. Ở chế độ LOCAL, **nơi cưỡng chế
chuyển vào extension**. Tài liệu này không giả vờ ngược lại.

Bù bằng ba thứ, tất cả **đo được**:

1. **MỘT điểm ghi duy nhất** trong extension (census AST), chỉ tới được sau khi người bấm duyệt.
2. **Vị từ chặn cục bộ**: chỉ ghi trong thư mục workspace đang mở · cấm `.env*` · cấm `..`/
   symlink ra ngoài · **bắt buộc khớp hash gốc** (`sha256(đĩa) === sha256(original)`).
3. **Sổ kiểm toán server** ghi **trước** khi byte rơi, chốt **sau**, kèm đúng chủ thể.

Server vẫn giữ: model + RAG, RBAC/đăng nhập, sổ kiểm toán. Extension không nhận đường dẫn tuyệt
đối từ server, không đụng `AI_REPO_SANDBOX_ROOTS`, không thêm bộ thực thi tool nào ở server (nên
census `.handler(` **không** bị phá).

## 5. Giao thức & luồng dữ liệu

### 5.1 Đăng nhập

Lệnh `AI Local: Đăng nhập` → nhập tài khoản + mật khẩu (`password:true`) → `POST
/api/auth/login` → bắt `Set-Cookie: app_session_id` → cất vào **VSCode SecretStorage** (keychain
OS, **không** phải `settings.json`). `requires2FA:true` ⇒ **từ chối rành mạch** (tài khoản 2FA
không dùng được ở extension). 401 giữa chừng ⇒ xoá cookie, mời đăng nhập lại.

Cấu hình: `aviAiLocal.serverUrl`, `aviAiLocal.uiLanguage`, `aviAiLocal.nganSachNguCanh`.

### 5.2 Kênh model

`POST /api/ai/local-kb/stream` kèm cookie. Chế độ LOCAL dùng **`codingMode:false`** (tool server
sẽ mù vì mã không có trên server). Đọc `response.body` streaming → **bộ tách khung SSE thuần**
`tachKhungSse(đệm) → {sựKiện[], phầnDư}`.

> Lưới bắt buộc: **khung SSE bị cắt đôi giữa hai chunk TCP** — lỗi kinh điển của SSE client viết
> tay.

### 5.3 Giao thức tool bằng VĂN BẢN (chế độ LOCAL)

Đường này không có tool-calling gốc, nên quy ước model phát một khối rào:

    ```avi-tool
    {"tool":"doc_tep","args":{"path":"src/Calculator.cs"}}
    ```

Extension: `phanTichYeuCauTool(text)` (thuần, có lưới) → chạy tool **cục bộ** → nối kết quả làm
lượt kế → lặp. Tool cục bộ: `doc_tep` · `liet_ke` · `grep` · `de_xuat_sua` · `de_xuat_sua_doan`.

Trần: dùng lại `shared/aiCodingLoop.ts` (3 vòng, tối đa 5) + nút Dừng (AbortSignal) + trần byte
mỗi kết quả tool.

**Rủi ro đã biết**: model 30B có thể không tuân giao thức tự chế ổn định. Chống đỡ: parser
nghiêm (sai cú pháp ⇒ **không đoán bừa**), một lần nhắc sửa, rồi **rơi về trả lời văn bản
thuần**. Tỉ lệ tuân thủ phải **đo bằng nghiệm thu live**, không tuyên bố suông.

### 5.4 Dựng ngữ cảnh

Module thuần + lưới, ngân sách byte mặc định ~24k ký tự (cấu hình được): tệp đang mở (ưu tiên
quanh con trỏ) · đoạn chọn · `@tệp` người dùng chỉ định · danh sách tệp rút gọn. **Không gửi cả
repo.**

Trước khi gửi: **bỏ hẳn `.env*`** và che chuỗi giống khoá (`sk-`, `AKIA`, JWT, `password=`).

**Hạn chế đã biết, KHÔNG xử trong đợt này**: LAN nhà máy chạy HTTP ⇒ cookie đi dạng thường
(`secure` chỉ bật khi prod+HTTPS). Muốn bịt cần HTTPS nội bộ — quyết định riêng của chủ dự án.

## 6. Đường GHI

### 6.1 Hai hình dạng đề xuất, một điểm ghi

- `de_xuat_sua_doan {path, dongDau, dongCuoi, thayThe}` — rẻ; extension **tự ghép** thành nội
  dung mới. Dùng cho Cmd+K và sửa cục bộ.
- `de_xuat_sua {path, modified}` — toàn văn, cho tệp nhỏ / tạo tệp mới.

Cả hai quy về **một hình dạng nội bộ** `{path, original(đọc từ đĩa), modified}`.

> Lưới ghép bản vá, ca biên bắt buộc: **giữ nguyên CRLF** (Windows) · dòng ngoài phạm vi · tệp
> không có newline cuối.

### 6.2 Cửa duyệt = diff native VSCode

`TextDocumentContentProvider` scheme `avi-ai-de-xuat:` phục vụ nội dung đề xuất → `vscode.diff`
(trái: tệp thật · phải: đề xuất). Người bấm **Áp dụng / Huỷ**. **Không tồn tại đường nào khác
dẫn tới ghi.**

### 6.3 Chặn xung đột trước khi ghi

Đọc lại tệp từ đĩa, `sha256` so với `original` mà đề xuất dựa trên. Lệch ⇒ **không ghi**, báo
"tệp đã đổi từ lúc đề xuất". Đúng vị từ server dùng.

⚠ `original` do model thấy có thể đã bị `read_file` **che bí mật** hoặc **cắt theo trần byte**
(`server/services/aiLocalTools/repoReadTools.ts:192-198`). Ở chế độ LOCAL, `original` **luôn đọc
lại từ đĩa bởi extension**, không tin bản model gửi.

### 6.4 Ghi

`vscode.workspace.applyEdit(WorkspaceEdit)` rồi `save()` ⇒ **Ctrl+Z hoàn tác được**, editor cập
nhật ngay, hash kiểm toán khớp đúng đĩa.

### 6.5 Kiểm toán — ghi TRƯỚC, chốt SAU

| Bước | Trạng thái hàng `ai_pending_actions` |
|---|---|
| trước khi ghi byte | `dang_ap_client` (+ audit bắt đầu) |
| ghi xong | `da_ap_client` (+ `AI_ACTION_EXECUTED`, metadata `executedBy:"vscode_extension"`, path, hash trước/sau) |
| ghi hỏng | `ap_client_that_bai` + lý do |
| **sập giữa chừng** | **đứng ở `dang_ap_client` = "chưa rõ" TRUNG THỰC** |

Cần **migration `ALTER TYPE aipendingactionstatus ADD VALUE`** ×4 — ba giá trị trên cộng
`bi_tu_choi_ghi` của §6.6.
⚠ Postgres không cho `ADD VALUE` trong transaction ở một số cấu hình ⇒ migration **đứng riêng**.

**Không lưu toàn văn `modified` lên server**: chỉ hash + tóm tắt + số dòng thêm/bớt (mã đã ở máy
dev). Cờ `aviAiLocal.luuToanVanKiemToan` mặc định **TẮT**.

### 6.6 Vá lỗ nói dối sẵn có (trong phạm vi đợt này)

`aiCopilotActions.ts:885-888` đặt `status='executed'` kể cả khi `apply_diff` từ chối. Sửa: đặt
status **theo kết quả thật** — byte thật sự rơi ⇒ `executed`; bị từ chối ghi (vị từ
`daBiTuChoiGhi()` của `shared/aiCodingLoop.ts:335-361`) ⇒ **`bi_tu_choi_ghi`** (giá trị enum
mới, KHÔNG dùng `denied` vì `denied` mang nghĩa RBAC từ chối). Lưới chứng minh hành vi cũ SAI
(đỏ trước, xanh sau).

Bắt buộc vì đợt này thêm **người ghi thứ hai** vào đúng cột đó — không vá thì có **hai** nguồn
nói dối trong một cột.

Cần kiểm ở bước lập kế hoạch: nơi nào query theo `status='executed'` (báo cáo/đếm) có bị ảnh
hưởng không.

## 7. Chế độ KÉP: dự án SERVER ↔ dự án LOCAL

Một ô chọn: `Dự án: [Workspace hiện tại (LOCAL)] | [Demo Csharp (SERVER)] | …`

| | **Chế độ SERVER** | **Chế độ LOCAL** |
|---|---|---|
| Vòng tác nhân | Vòng tool **sẵn có** của server (`codingMode:true` + `projectId`) | Vòng ở client (§5.3) |
| Đọc/grep | Tool server (hộp cát sẵn có) | Tool cục bộ qua API VSCode |
| Đề xuất ghi | `pending_action` từ SSE | `de_xuat_sua*` từ vòng client |
| Cửa duyệt | Diff native VSCode (hai bên tài liệu ảo) | Diff native VSCode (trái = tệp thật) |
| **Ai ghi byte** | **SERVER** qua `aiCopilot.confirmAction` — **cưỡng chế server NGUYÊN VẸN** | Extension, một điểm ghi |
| Kiểm toán | Đường sẵn có | `dang_ap_client → da_ap_client` |
| Duyệt theo khối | Có sẵn (`selectedHunkIds`) | Đợt sau |

Chế độ SERVER phần lớn là **dùng lại** luồng web hiện tại (đọc tệp/grep qua `repoWorkspace.*`),
**rẻ hơn và an toàn hơn** chế độ LOCAL.

**Hai bất biến, mỗi cái đúng MỘT chỗ** (census AST riêng):
- đúng **một** nơi ghi đĩa local (`applyEdit`) — chỉ chế độ LOCAL chạm;
- đúng **một** nơi gọi `confirmAction` — chỉ chế độ SERVER chạm.

Không đường chéo: chế độ SERVER **không bao giờ** ghi workspace; chế độ LOCAL **không bao giờ**
gọi `confirmAction`.

**Chống nhầm lẫn chết người** (dev tưởng tệp local đổi mà thật ra sửa trên box AI): tiêu đề tab
diff và thẻ duyệt **luôn dán nhãn nguồn** — `SERVER · Demo Csharp` vs `LOCAL · d:\SOURCES\…`,
khác màu, nút ghi rõ "Ghi trên SERVER" / "Ghi vào workspace". Census soi-văn-bản bắt buộc nhãn
có mặt ở cả hai thẻ.

**Rủi ro cần ĐO, không hứa trước**: chế độ SERVER dùng vòng tool có trần 20 giây/lượt trong khi
model chạy vài phút ⇒ vòng đa bước phía server **có thể hết giờ**. Phải đo bằng nghiệm thu live
rồi mới kết luận (`AI_TOOL_LOOP_MAX_MS` chỉnh được, nhưng **đo trước, khai sau**).

## 8. Đóng gói

`vscode-extension/` có `package.json` + `tsconfig` riêng (`@types/vscode`, `@vscode/vsce`,
bundle bằng esbuild). Cài dep **trên máy dev có internet**, build ra **`.vsix`**; nhà máy chỉ
cần `code --install-extension avi-ai-local-0.1.0.vsix` — **không cần mạng**.

⚠ Bài học cũ: `npm` **đi ngược lên cây thư mục** ⇒ mọi lệnh npm phải có `--prefix` rõ ràng và
**kiểm chứng nó chạy đúng thư mục con**.

Repo mẹ **loại trừ** `vscode-extension/` khỏi tsconfig, nhưng extension có `npm run check`
**riêng** nối vào script gốc — để không lặp lại lỗi cũ "loại trừ khỏi tsconfig = đẻ lưới giả".

## 9. Kiểm thử

**Tầng 1 — lưới thuần (vitest repo mẹ)**, mọi module không đụng API VSCode: tách khung SSE (ca
**cắt đôi chunk**) · parser yêu cầu tool · ghép bản vá (**CRLF**) · vị từ đường dẫn · dựng ngữ
cảnh theo ngân sách · che bí mật · máy trạng thái kiểm toán.

**Tầng 2 — census AST**: đúng MỘT nơi ghi đĩa · đúng MỘT nơi gọi `confirmAction` · nhãn
`SERVER`/`LOCAL` có mặt ở cả hai thẻ duyệt.

**Tầng 3 — nghiệm thu LIVE bắt buộc** (*tĩnh xanh ≠ mắt xanh*): chạy Extension Development Host,
workspace thử **trong scratchpad** — **không đụng `sandbox-projects/`** (đề thi). **Đo HẬU QUẢ,
không đo cơ chế**: nội dung tệp trên đĩa · hàng `ai_pending_actions` trong DB (đúng trạng thái,
đúng chủ thể) · Ctrl+Z hoàn tác thật · sửa tệp trước khi duyệt ⇒ **bị chặn vì xung đột**.

⚠ **Giới hạn phép đo, nói trước**: Playwright không lái được cửa sổ VSCode. Live-verify là chạy
kịch bản tay + đo hậu quả trên đĩa/DB. Test tự động end-to-end (`@vscode/test-electron`) để
**đợt sau** — không khai "đã tự động hoá" khi chưa có.

## 10. Phân đợt

| Đợt | Nội dung | Vì sao thứ tự này |
|---|---|---|
| **A** | Xương sống **CHỈ ĐỌC**: scaffold · đăng nhập/cookie · SSE client · panel chat · ngữ cảnh (tệp mở/đoạn chọn) · ô chọn dự án | Không có đường ghi ⇒ rủi ro bằng 0 |
| **B** | **Chế độ SERVER** trọn vẹn: `pending_action` → diff native → `confirmAction` · nhãn nguồn · **vá lỗ `executed`** | Rẻ nhất (dùng lại), an toàn nhất |
| **C** | **Chế độ LOCAL ghi được**: đề xuất → diff → chặn xung đột → MỘT điểm ghi → kiểm toán mới (migration enum) · **Cmd+K** | Đường ghi mới ⇒ sau khi khung vững |
| **D** | **Tác nhân đa bước ở client**: vòng lặp · tool cục bộ · @-mention · nút Dừng | Rủi ro model tuân giao thức — cô lập ở cuối |

Ghost-text: **hoãn** (§2).

## 11. Ngoài phạm vi

- Ghost-text / gợi ý nội tuyến mỗi nhịp gõ.
- Cầu tool hai chiều server→client (§3).
- HTTPS nội bộ cho LAN nhà máy (§5.4).
- Test end-to-end tự động cho extension (§9).
- Duyệt theo khối (hunk) ở chế độ LOCAL (§7).
- Hỗ trợ tài khoản bật 2FA (§5.1).
