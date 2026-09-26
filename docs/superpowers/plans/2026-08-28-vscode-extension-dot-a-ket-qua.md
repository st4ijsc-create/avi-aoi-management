# Đợt A — extension VSCode "AI Local": kết quả nghiệm thu

Kế hoạch: `docs/superpowers/plans/2026-08-28-vscode-extension-dot-a.md`
Ledger đầy đủ (9 task, mọi ruling): `.superpowers/sdd/2026-08-28-vscode-extension-dot-a/progress.md`

Tệp này ghi lại **sự thật đo được** ở Đợt A, tách rõ phần đã đo với phần chưa đo — không tô hồng
phần chưa đo thành như đã đo.

---

## 1. Đã xác minh được

Mọi con số dưới đây lấy từ output THẬT đã chạy (của các task trước, ghi trong
`task-1-report.md` … `task-8-report.md`, và của chính Task 9 chạy lại lần cuối).

### Cổng lưới/kiểu, chạy lại lần cuối ở Task 9 (2026-08-29)

- `npm run ext:check` → **0 lỗi** (`tsc --noEmit -p .` thoát mã 0, không in gì).
- `npx vitest run vscode-extension/src/` → **68/68 ca xanh**, 10 tệp lưới (`manifest` 5 ·
  `thoatHtml` 3 · `trpc` 3 · `duAn` 4 · `yeuCau` 6 · `khungSse` 7 · `htmlBang` 5 · `nguCanh` 18 ·
  `dangNhap` 13 · `dongSse` 4).
- `grep -rn "writeFile\|applyEdit\|confirmAction" vscode-extension/src/` → **RỖNG** (exit code
  1 — không khớp dòng nào). Cổng cưỡng chế "Đợt A chỉ đọc" đạt.
- `npm run ext:build` → `dist/extension.js` 19.1kb + `.js.map` 43.6kb, "Done in 6ms".
- `npm run ext:package` → sinh `vscode-extension/avi-ai-local-0.1.0.vsix`, **9061 byte** (vsce
  báo 8.85 KB, 4 tệp bên trong: manifest + `package.json` 1.7 KB + `dist/extension.js` 19.08 KB
  nén lại). Chỉ có một WARNING không chặn (`LICENSE, LICENSE.md, or LICENSE.txt not found`) —
  không đòi thêm trường bắt buộc nào trong `package.json` (đã có sẵn `"license": "UNLICENSED"`
  và cờ `--allow-missing-repository` từ Task 1 nên `vsce` không đòi trường `repository`).

### Tiến triển số ca lưới qua từng task (mỗi task tự đo, có ĐỎ→XANH+đột biến)

- Task 1: lưới manifest 5/5 xanh; `ext:build` sinh `extension.js` 2.4kb; `npm ls --depth=0` xác
  nhận 5 gói phụ thuộc phân giải đúng version (`@types/node 20.19.43`, `@types/vscode 1.134.0`,
  `vsce 3.9.2`, `esbuild 0.25.12`, `typescript 5.9.3`).
- Task 2: `tachKhungSse` 7/7 xanh; đột biến (bỏ `phan.pop()`) giết đúng ca "khung cắt ngang
  chunk" — lưới có răng.
- Task 3: `dangNhap` 7/7 → sau vòng sửa 1: **13/13**; trọn bộ 25/25; đột biến giết đúng 1 ca mới.
  **NGHIỆM THU LIVE THẬT đã chạy** (coordinator, mã THẬT qua `tsx` đánh vào server THẬT ở
  `:3000`): sai mật khẩu → HTTP 401 → sau fix `thongDiep` = câu THẬT của server "Tên đăng nhập
  hoặc mật khẩu không đúng" (trước fix là câu dự phòng chung). Ba URL thù địch
  (`file:///C:/x`, `javascript:alert(1)`, `khong-phai-url`) đều bị `kiemTraServerUrl` chặn TRƯỚC
  khi mật khẩu rời máy — xác nhận bằng đo thật, cookie luôn null, không ném.
- Task 4: `nguCanh` 11/11 → sau vòng sửa 1: **18/18**; trọn bộ 43/43. Đo thật trên
  `.env.example` (2699 dòng): 14 dòng bị che ban đầu → **15 dòng** sau fix (thêm
  `DATABASE_URL=postgresql://user:«đã che»@localhost:5432/...` — trước fix KHÔNG bị che). Đột
  biến (bỏ gọi `cheBiMat`) giết đúng ca "nội dung gửi đi ĐÃ qua che bí mật". Đo tác dụng phụ trên
  40 tệp mã thật (13.299 dòng): luật che đổi 61 dòng (0,46%).
- Task 5: `yeuCau` 6/6 xanh; trọn bộ 49/49; đột biến (ép `codingMode: true` cứng) giết đúng ca
  "LOCAL: codingMode=false".
- Task 6: `dongSse` 3/3 → sau vòng sửa 1: **4/4** (thêm ca UTF-8); trọn bộ 52 → 53. Đột biến
  (`dem = ""`) giết đúng ca "cắt ngang chunk"; đột biến bỏ `{stream:true}` giết đúng ca UTF-8
  (chữ "à" vỡ thành `U+FFFD`). **NGHIỆM THU LIVE THẬT đã chạy hai lần** (server thật `:3000`,
  cookie giả): lần 1 → 401 → "Máy chủ trả 401 — thử đăng nhập lại."; sau fix Finding 2 lần 2 →
  401 → thông điệp mới "phiên đăng nhập không còn hiệu lực, hãy đăng nhập lại." (chỉ 401/403 mới
  nói vậy, các mã khác chỉ khai số).
- Task 7: `thoatHtml`+`htmlBang` 6/6; trọn bộ 59/59 → sau vòng sửa 1 (gộp cả Task 8): **68/68**.
  `ext:build` 15.8kb → 19.1kb. Ba phép đo thay thế cho F5 (Đo A/B/C, chạy bằng `tsx` nạp module
  thật, không mock): CSP có `default-src 'none'`, KHÔNG có `unsafe-inline`, đủ 3 id DOM; luồng SSE
  giả gom đúng "Xin chào" qua trường `token` (khớp tên trường máy chủ thật dùng); ngữ cảnh tệp
  thật (`Calculator.cs`) đứng TRƯỚC câu hỏi trong `question`, `codingMode:false` đúng LOCAL. Vòng
  sửa 1 thêm Đo D (khung lỗi giả `{type:"error",error:"Model hết bộ nhớ VRAM"}` → thông điệp cuối
  đúng bằng chuỗi đó, không còn rơi về "Máy chủ báo lỗi.") và Đo E (nonce `randomBytes(24)` hai
  lần cho ra hai chuỗi khác nhau, dài 32 ký tự).
- Task 8: `trpc` 3/3 + `duAn` 4/4; trọn bộ 68/68. `ext:build` 19.0kb. Ba phép đo thay thế: Đo A
  bóc đúng tầng `result.data.json` của superjson; Đo B **gọi tRPC THẬT** tới
  `http://localhost:3000/api/trpc/repoWorkspace.listProjects` với cookie giả → nhận **401** (không
  phải 404 — xác nhận đường mount và tên thủ tục đúng); Đo C nhãn `"LOCAL · d:/ws/aoi"` /
  `"SERVER · Demo Csharp"` phân biệt được, id có tiền tố không đụng nhau dù trùng tên.

### Review độc lập (không phải tự-đo)

Mỗi task (trừ Task 9) được review bởi một tiến trình review ĐỘC LẬP với implementer, dùng
`review-<sha>..<sha>.diff` lưu trong cùng thư mục. Task 3, 4, 6, 7 có ít nhất 1 vòng sửa xuất phát
từ review đó (chi tiết ở mục 4 "Bài học").

---

## 2. CHƯA xác minh

Ghi thẳng — đây là phần **không** được chạy trong Đợt A, không phải vì quên mà vì nằm ngoài khả
năng của các subagent thực thi (không lái được cửa sổ VSCode, không có tài khoản thử):

- **Chưa có lượt đăng nhập THẬT nào chạy qua chính extension** (qua lệnh
  `AI Local: Đăng nhập` trong VSCode thật). Không có tài khoản thử nghiệm nào dùng được:
  `scripts/seed-admin.mjs` là một bẫy đã tháo có chủ ý (throw ngay khi chạy — xem docblock: cột
  `users.passwordHash` đã bị migration 0315 bỏ, bí mật chuyển sang bảng `user_secrets`, đường tạo
  user đúng là `createLocalUser()`). Task 9 KHÔNG chạy seed nào, vì seed **GHI DB** và có thể ghi
  đè mật khẩu admin thật đang dùng.
- **Chưa bấm F5 / chưa chạy trong cửa sổ VSCode thật với người dùng đã đăng nhập.** Do đó CHƯA
  biết:
  - Bao nhiêu giây tới token đầu tiên; tổng thời gian một lượt hỏi-đáp.
  - Câu trả lời có thật sự nhắc đúng nội dung tệp đang mở hay không (ngữ cảnh có tới nơi trong
    một phiên chạy thật, không phải script giả lập).
  - Ô chọn dự án có hiện đúng danh sách LOCAL/SERVER thật theo `AI_REPO_SANDBOX_ROOTS` cấu hình
    trên máy chủ thật hay không (Đo C ở Task 8 chỉ chứng minh cơ chế gộp nhãn đúng trên dữ liệu
    TỰ DỰNG, không phải danh sách thật từ server).
  - Chế độ SERVER có chạy nổi vòng tool trong trần 20 giây theo spec §7 hay không — chưa đo được
    lượt nào có `codingMode:true` chạy thật với cookie hợp lệ.
  - Extension có cài và khởi động đúng trong một cửa sổ VSCode thật (không phải Extension
    Development Host) hay không — `code --install-extension` chưa được chạy (thuộc phần
    controller làm, ngoài phạm vi Task 9).
- **Chưa có test end-to-end tự động cho extension** (`@vscode/test-electron` hay tương đương) —
  để đợt sau. Toàn bộ 68 ca hiện tại là lưới đơn vị THUẦN (không khởi động VSCode thật), cộng với
  các "phép đo thay thế" chạy bằng `tsx` nạp thẳng module đã build/nguồn — không phải test tự
  động chạy trong tiến trình VSCode thật.

---

## 3. Nợ có tên mang sang đợt sau

Gom từ các dòng `parked` / nợ có tên / deferred trong
`.superpowers/sdd/2026-08-28-vscode-extension-dot-a/progress.md`:

- **Bộ che bí mật client (`cheBiMat`) và `redactSecretsAndPII` phía server là hai bản cài đặt
  khác nhau của cùng một ý** — nên gộp về MỘT nguồn thay vì duy trì song song (rủi ro kinh điển:
  bản lỏng hơn là bản đang chạy). (Task 4)
- **Mật khẩu chứa `@` chưa mã hoá trong URL kết nối** (`postgres://user:p@ss@host`) chỉ bị che
  tới dấu `@` ĐẦU tiên, phần sau vẫn lộ. Cố ý KHÔNG sửa: che tới `@` CUỐI sẽ nuốt nhầm khi một
  dòng có cả URL lẫn địa chỉ email. (Task 4)
- **Luật che "tới hết dòng" (greedy) có thể ăn mất cấu trúc mã** khi chuỗi trông giống bí mật nằm
  trong code không nháy (đo được: 1 ca `it("... api_key= form", () => {` bị cắt cụt trong 61 dòng
  bị đổi / 13.299 dòng mã thật). Giữ nguyên có chủ ý (che thừa an toàn hơn để lọt) — ghi nợ thay
  vì để im. (Task 4)
- **Tiền tố `"server:"` là hằng chuỗi lặp ở hai tệp** (`duAn.ts` dựng, `bangChat.ts` cắt) — chưa
  gộp thành một hằng dùng chung. Nếu hai literal lệch nhau, máy chủ sẽ trả lỗi RÕ RÀNG
  (`PROJECT_NOT_FOUND`), nên đây là hỏng-thấy-được, không phải hỏng im lặng. (Task 8)
- **`CheDoDuAn.nhan` là trường chết** — được dựng ở Task 5 nhưng `dungYeuCauStream` không đọc nó.
  (Task 8)
- **`(e as Error)` ép kiểu giả định lỗi bắt được luôn là đối tượng `Error`** — nếu một chỗ nào đó
  ném primitive (chuỗi, số), `.name`/`.message` sẽ sai. Có sẵn từ trước, ngoài phạm vi diff của
  Task 7, chưa sửa. (Task 7)
- **`mat_phien` là biến snake_case lệch quy ước camelCase** của phần còn lại của tệp (`dongSse.ts`)
  — thẩm mỹ thuần tuý, để review cuối nhánh phân loại. (Task 6)
- **Module `yeuCau.ts` không thu hẹp kiểu `ngonNgu`/`vaiTro` về đúng enum máy chủ chấp nhận** — bên
  gọi hiện đang đúng (khai enum trong `package.json`, hằng `"engineer"` hợp lệ) nên chưa vào vòng
  sửa, nhưng kiểu tĩnh không tự bảo vệ được nếu bên gọi đổi. (Task 5)

---

## 4. Bài học

**Trong Đợt A, không có lỗi nghiêm trọng nào bị lưới đơn vị (unit test) tự viết của chính task đó
bắt được. Toàn bộ lỗi nghiêm trọng bị bắt bởi: (a) đo trên máy chủ thật/dữ liệu thật, hoặc (b)
người đọc mã độc lập (review round) không tin lời khai của implementer.** Lý do có cấu trúc: một
lưới do implementer tự viết chỉ có thể kiểm tra đúng GIẢ ĐỊNH của chính implementer về hình dạng
dữ liệu — nếu giả định sai, lưới xanh mà hành vi vẫn hỏng ("xanh giả").

Ba ví dụ cụ thể, có thật, lấy từ báo cáo:

1. **Task 3 — lỗ rò credential qua `serverUrl`, và trường lỗi sai.** 7 ca lưới ban đầu của Task 3
   đều xanh, `ext:check` sạch. Nhưng review độc lập cộng với nghiệm thu LIVE (mã thật đánh vào
   server thật ở `:3000`) phát hiện: (a) `aviAiLocal.serverUrl` không khai `scope` ⇒ mặc định
   scope "window" ⇒ một workspace lạ có thể ghi đè địa chỉ máy chủ, khiến `dangNhap()` gửi mật
   khẩu tới máy của kẻ tấn công; (b) máy chủ thật trả lỗi ở trường `error`
   (`server/_core/oauth.ts:360`), nhưng mã đọc `message` — lưới xanh vì chính lưới đó cũng tự bịa
   hình dạng `{message:"Sai tài khoản"}`, một hình dạng máy chủ KHÔNG BAO GIỜ gửi. Cả hai chỉ lộ
   ra khi có người đo bằng `curl` + đọc mã máy chủ thật.

2. **Task 4 — chuỗi kết nối CSDL lộ nguyên mật khẩu.** 11 ca lưới ban đầu xanh, implementer tự
   chạy `cheBiMat` trên `.env.example` thật và báo cáo "không che quá tay". Nhưng không ai (kể cả
   implementer) kiểm giả thuyết ngược: dòng nào TRÔNG như bí mật mà KHÔNG bị che? Khi coordinator
   tự kiểm, lộ ra `DATABASE_URL=postgresql://user:password@localhost:5432/avi_aoi` hoàn toàn
   không bị che. Review độc lập sau đó còn tìm thêm 1 Critical khác cùng bản chất (`"password":
   "…"` dạng JSON của `appsettings.json` không bị che) — bằng cách tự chạy `node` tái hiện, không
   phỏng đoán.

3. **Task 7 — lặp lại ĐÚNG lớp lỗi đã cảnh báo, ở một nhánh khác.** Task 7 làm đúng cho trường
   `token` (được brief cảnh báo trước). Nhưng khung LỖI của cùng luồng SSE đó lại đọc
   `sk.message` trong khi máy chủ gửi `{type:"error", error:...}`
   (`server/routes/aiLocalKnowledgeApi.ts:625-628`) — mọi lỗi giữa luồng rơi về câu chung "Máy chủ
   báo lỗi.", mất hết chi tiết chẩn đoán (ví dụ "Model hết bộ nhớ VRAM" sẽ biến mất). Cả ba phép
   đo thay thế (A/B/C) của Task 7 đều đi đường THÀNH CÔNG — không phép đo nào chạm khung lỗi — nên
   lỗi lọt qua toàn bộ Task 7 và chỉ bị bắt ở vòng review độc lập.

Kết luận thực dụng cho các đợt sau: một cảnh báo lớp lỗi ("trường X sai tên") áp dụng cho MỘT chỗ
không miễn nhiễm cho các chỗ khác cùng loại (nhánh lỗi, nhánh huỷ, nhánh timeout…) — mỗi nhánh cần
phép đo CHẠM ĐÚNG nhánh đó, không chỉ đường vui (happy path); và lưới đơn vị tự viết cần được đối
chiếu với hình dạng dữ liệu THẬT (đo bằng server sống hoặc dữ liệu sản xuất thật) trước khi được
tin, vì lưới có thể tự thoả bằng chính giả định sai của người viết ra nó.

---

## Cập nhật sau REVIEW TOÀN NHÁNH (2026-08-29)

Tệp trên được viết ở Task 9, **trước** lượt review toàn nhánh. Review đó (chạy trên model mạnh
nhất, đọc cả 13 commit cùng lúc) tìm ra 5 lỗi mà **8 lượt review từng-task không thể thấy** — vì
mỗi lượt chỉ nhìn được một diff, còn các lỗi này nằm ở **khoảng nối giữa các task**.

| Mã | Mức | Lỗi | Hậu quả thật |
|---|---|---|---|
| C1 | **Critical** | `CAM_TEP` chỉ chặn `.env*`, `id_rsa` **đúng tên**, `.pem/.pfx/.p12` ⇒ `server.key`, `tls.key`, `store.jks`, `k.p8`, `id_rsa_work` đều lọt; `cheBiMat` không có luật nào khớp thân PEM | **Mở một tệp khoá riêng trong editor là khoá bay lên máy chủ** — vi phạm thẳng bất biến mà chính module đó sinh ra để giữ |
| I1 | Important | 403 bị gộp chung với 401 | Tài khoản `MUST_CHANGE_PASSWORD`/`ACCOUNT_DISABLED` rơi vào **vòng không lối ra**: đăng nhập lại thành công, request vẫn 403, mãi mãi. **Lần thứ tư** của lớp lỗi "client đọc sai thứ server gửi" |
| I2/I3 | Important | Khung `done` bị bỏ qua; `hong` bị vứt | Luồng **đứt giữa chừng không phân biệt được với đã xong**; câu trả lời cụt vẫn vào lịch sử như câu hoàn chỉnh; cờ `degraded` (phải THAY câu trả lời) bị lờ |
| I4 | Important | Spec §5.1 "401 giữa chừng ⇒ xoá cookie" chưa cài | Cookie chết nằm lại tới khi người dùng tự nghĩ ra việc đăng xuất |
| I5 | Important | Chế độ SERVER vẫn đính kèm tệp LOCAL **không dán nhãn nguồn** | Đúng thứ spec gọi là "tai nạn không cứu được" — ngay trước đợt mở đường ghi |

**Đã vá toàn bộ + thêm cổng census** (commit `7140d3f2`, 13 tệp):

- Lưới **68 → 99 ca** xanh · `ext:check` 0 lỗi · `ext:build` OK.
- **Census tự động** `src/loi/census.unit.test.ts` duyệt **đệ quy** toàn `src/`, khẳng định **0**
  lần xuất hiện của `fs.writeFile`/`writeFileSync`/`appendFile`/`applyEdit`/`WorkspaceEdit`/
  `confirmAction`. Docblock dặn đợt sau: khi thêm điểm ghi ĐẦU TIÊN thì **SỬA** census thành
  "đúng MỘT lần tại đường dẫn X" — **không được xoá**. Đây là thứ giữ bất biến "chỉ một điểm ghi"
  bằng đèn đỏ, thay vì bằng một đoạn README.
- Kiểm chứng độc lập của controller trên đầu vào **đối kháng**: 8/8 đường nguy hiểm bị chặn ·
  **5/5 tệp hợp lệ vẫn gửi được** (`env.ts`, `keyboard.ts`, `monkey.p8s.ts`, `Calculator.cs`,
  `keystore-guide.md` — không chặn nhầm) · thân PEM bị che, giữ dòng BEGIN/END.
- Re-review độc lập còn kiểm thêm hai thứ ngoài lưới: tệp có **hai** khối PEM (che đúng cả hai),
  và **răng của census** (chỉ chính tệp census chứa các tên API bị cấm ⇒ nó xanh vì lý do thật).

### Vẫn CHƯA xác minh (không tô hồng)

- **Chưa có lượt đăng nhập THẬT nào chạy qua extension.** Tài khoản người dùng cấp
  (`testadmin`) **không tồn tại trong DB** — máy chủ trả 401 đúng, không phải lỗi extension.
  Truy vấn chỉ đọc cho thấy các tài khoản đang có: `admin`, `operator1`, `supervisor1`, `maint1`,
  `engineer1`, `audit_agent`, `p1_audit_op`, `p1_audit_admin`. Không tự tạo tài khoản (ghi DB +
  nhạy cảm an ninh).
- Do đó vẫn chưa đo được: **độ trễ tới token đầu tiên** · câu trả lời có **thật sự nhắc đúng nội
  dung tệp đang mở** không · ô chọn dự án có hiện đúng `AI_REPO_SANDBOX_ROOTS` thật không · chế
  độ SERVER có chạy nổi trong **trần 20 giây** của vòng tool máy chủ không.
- `.vsix` đã **cài thật** vào VSCode (`st4i.avi-ai-local`), nhưng chưa mở bảng chat trong cửa sổ
  VSCode thật với một phiên đăng nhập hợp lệ.

---

## ★★★ NGHIỆM THU LIVE ĐÃ ĐẠT (2026-08-29) — tài khoản `engineer1`

Chạy qua **chính mã của extension** (`dangNhap` → `dungNguCanh` → `dungYeuCauStream` →
`moDongSse` → `goiTruyVanTrpc`), không mô phỏng.

### Chế độ LOCAL

| Đo | Kết quả THẬT |
|---|---|
| Đăng nhập | **ok**, cookie 252 ký tự nhận và đọc đúng |
| Dự án SERVER (qua tRPC) | **4 dự án thật**: `repo` (Repo chinh) · `csharp` (Demo Csharp) · `react` (Demo React + Postgres) · `demo-project` (Dự án demo robot); mặc định `repo` |
| Ngữ cảnh gửi đi | 430 ký tự, chứa hằng số mồi |
| Khung SSE hỏng | `[]` |
| **Token đầu tiên** | **5,0 giây** (tổng lượt 5,0s) |
| Sự kiện nhận được | `tool_loop` · `meta` · `token` · **`done`** ⇒ khung `done` có thật, bản vá I3 xử lý đúng |
| **Ngữ cảnh có tới não model không** | **CÓ** — model trả về đúng `4271`, hằng số **tự bịa** chỉ tồn tại trong tệp mồi ở scratchpad. Model **không thể đoán** ⇒ đây là bằng chứng mà không lưới đơn vị nào thay thế được |

### Chế độ SERVER — rủi ro "trần 20 giây" (spec §7) KHÔNG xảy ra

`codingMode:true` + `projectId:"csharp"` gửi đúng. Vòng tool máy chủ chạy **3 lượt gọi, xong
trong dưới 1 giây** (`list_files` vòng 1: 0→5 ms; vòng 2: 426→431 ms) — cách trần 20 s rất xa.
Trả lời liệt kê **đúng tệp thật của hộp cát máy chủ** (`CalculatorDemo.sln`, `src/Calculator.cs`
1134 B, `src/StringUtils.cs`) và đọc được nội dung thật.

**Giới hạn của phép đo này, nói thẳng:** tổng 0,6 s và **chỉ 1** sự kiện `token`, nội dung trả về
chính là kết quả tool đã định dạng — tức đây là đường **TOOL**, chưa chứng minh một lượt **sinh
văn bản dài** của model. Câu hỏi nặng (sinh mã) vẫn có thể chạm trần. **Chưa đo ⇒ chưa kết luận.**

### Còn lại chưa xác minh

- Chưa mở bảng chat trong **cửa sổ VSCode thật** với phiên đăng nhập (đường ống đã được đo qua
  bundle đã build với `vscode` giả, nhưng đó không phải cùng một thứ).
- Chưa đo một lượt **sinh mã dài** (xem giới hạn ở trên).
- Chưa có test e2e tự động (`@vscode/test-electron`).
