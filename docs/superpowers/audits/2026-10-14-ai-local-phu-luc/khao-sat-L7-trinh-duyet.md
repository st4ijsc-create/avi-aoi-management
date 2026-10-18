# Khảo sát AI Local · Tầng 7: giao diện lập trình trên trình duyệt (`/ai-coding-workspace`)

Ngày 2026-10-14 · nhánh `feat/ai-local-L7-hang-rao` · chỉ đọc (không sửa repo, không build, không chạm :3000/:8091)

**Ký hiệu nguồn:** **[ĐO]** = quan sát sống bằng Playwright trên http://127.0.0.1:3000 với tài khoản engineer1, khung 1600×1000. **[SUY]** = kết luận từ đọc mã.

Ảnh chụp nằm cùng thư mục:
- `khaosatL7-01-trang-dau.png`: trang mở lần đầu.
- `khaosatL7-02-mo-tep-terminal.png`: đã mở `package.json` và pane "Lệnh & Nhật ký".
- `khaosatL7-03-mo-phien.png`: đã nạp lại một phiên cũ.

---

## 0. Bối cảnh lúc đo (ảnh hưởng tới phạm vi kiểm sống)

- **[ĐO]** :3000 trả HTTP 200. Còn `llama-server :8091` **không trả lời**: `curl /health` cho mã `000`. Trên trang, thanh trạng thái cũng hiện **"máy: ENGINE HỎNG"** (màu đỏ), "VRAM còn 29.7 GiB" và "model: Qwen3.6-35B-A3B-UD-Q4_K_XL". Hai nguồn khớp nhau, nghĩa là thanh trạng thái nói đúng sự thật máy.
- Vì engine đang tắt, tôi **KHÔNG gửi câu hỏi nào**. Gửi một câu thì hoặc nhận lỗi, hoặc khiến server tự bật llama-server, mà việc bật llama-server bị cấm. Vì vậy luồng streaming, thẻ duyệt và vòng tự sửa chỉ được đánh giá **[SUY]**.
- Cấu hình `.env` hiện hành **[ĐO, đọc tệp]**:
  - `AI_CODING_AUTOLOOP=1`, `AI_CODING_TU_TRI_GHI=1`, `AI_CODING_MODEL_TASK=code`
  - `LLAMA_SERVER_SLOTS=1`, `LLAMA_SERVER_CTX_TOTAL=65536`, `LLAMA_SERVER_REASONING_BUDGET=12000`
  - `AI_REPO_SANDBOX_ROOTS` khai 3 dự án env: repo / csharp / react. Lúc đo, giao diện hiện **4 dự án**; dự án thứ tư là "Dự án demo robot", nguồn DB.

## 1. Kiến trúc tầng 7 (tóm tắt)

| Mảnh | Tệp | Vai trò |
|---|---|---|
| Trang | `client/src/pages/AICodingWorkspace.tsx` (3.475 dòng) | Ba khung kéo được (Cây · Trình xem · Hội thoại) và vỏ dưới (Lệnh & Nhật ký · Vấn đề). Có ĐÚNG MỘT điểm gọi `confirmM.mutateAsync`, nằm trong `handleConfirm` (dòng 1892–2043). |
| Route | `client/src/App.tsx:692` | `RouteGuard requirePermission="ai_repo_read" requireModule="MOD_AI"` |
| tRPC | `server/routers/repoWorkspaceRouter.ts` (1.073 dòng) | 22 thủ tục:<br>• đọc: `listFiles` (có `phang`), `readFile`, `grep`<br>• dự án: `listProjects`<br>• cấu hình và đồng hồ: `cauHinhVong`, `tokenLuotCuoi`, `nganSachHopCat`, `modelDangDung`, `danhSachLenhChoPhep`, `trangThaiAiLocal`<br>• đề xuất: `deXuatThayTheLo`, `deXuatSuaTay`<br>• lệnh: `dauRaSong`, `chayKiemChung`<br>• phiên: `danhSachPhien`, `moPhien`, `luuPhien`, `xoaPhien`<br>• admin: `danhSachDayDu`, `duyetThuMuc`, `themDuAn`, `xoaDuAn` |
| Duyệt và ghi | `aiCopilot.confirmAction/cancelAction` | HITL. Server đọc args từ `ai_pending_actions`. |
| SSE | `POST /api/ai/local-kb/stream` (`server/routes/aiLocalKnowledgeApi.ts:508`), hook `client/src/hooks/useKbChatStream.ts` | Sự kiện: text · reasoning · tool_result · tool_loop · pending_action · usage · done. Huỷ bằng `AbortController`; server hủy theo `server/routes/_huyKhiClientBoDi.ts`. |
| Tool của tác nhân | `server/services/aiLocalTools/*` | **Đúng 6 tool:** `list_files`, `read_file`, `grep_repo` (đọc) · `apply_diff`, `apply_diff_batch` (ghi, HITL) · `run_command` (11 khuôn, HITL). **KHÔNG có** xoá / đổi tên tệp, git commit / nhánh, cài gói, chạy dev server. |

**Danh sách trắng `run_command`** (`repoCommandSandbox.ts:418–665`) gồm 11 khuôn:
- `npm run check`, `npm run check:tests`, `npx vitest run <đường>`
- `git status`, `git diff`
- `dotnet build|test|format <đường>`
- `node --test <đường>`
- `python -m pytest|unittest <đường>`

Không có `npm install` / `npm ci` / `npm run dev`. `dotnet` mặc định chạy `--no-restore`; restore chỉ mở khi đặt cờ riêng bằng `"1"`.

**Cờ server liên quan UI (mặc định → giá trị hiện tại):**

| Cờ | Mặc định | Hiện tại | Ghi chú |
|---|---|---|---|
| `AI_CODING_GEN` | bật | bật | |
| `AI_CODING_EDIT` | bật | bật | |
| `AI_CODING_EDIT_HUNKS` | bật | bật | |
| `AI_CODING_TOOL_LOOP` | bật | bật | Vòng tool đọc, mặc định 3 vòng, trần cứng 5, 180 s |
| `AI_CODING_LESSONS` | bật | bật | Bài học xuyên phiên |
| `AI_CODING_AUTOLOOP` | **TẮT** | **1** | Vòng tự chạy test sau duyệt |
| `AI_CODING_TU_TRI_GHI` | **TẮT** | **1** | Tự ghi không duyệt từng lượt; cần CẢ HAI cờ autoloop và tự trị |
| `AI_CODING_MODEL_TASK` | chat | code | |

Nguồn đọc cờ: `aiCodingAgent.ts:81–99`, `aiCodingVerify.ts:93–98`, `aiLocalTools/index.ts:370–391`, `ai/autonomyPolicy.ts:82`, `ai/codingLessonContext.ts:85–88`.

**Quyền (server là hàng rào; client ẩn nút chỉ là lịch sự):**
- `ai_repo_read/canView`: vào route, xem cây, đọc, tìm, phiên. Kiểm qua `congPhien`, `readToolRbac`.
- `ai_repo_exec/canCreate`: chạy lệnh và vòng tự động (trang `:480`).
- Quản lý dự án dùng `adminProcedure` (admin + 2FA) + `moduleGate("MOD_AI")`. Trên trang, nút bánh răng chỉ hiện cho `role === "admin"` (`:2392`).
- **[ĐO]** Với engineer1, không thấy nút bánh răng. Hai huy hiệu "đọc" và "chạy lệnh" đều bật.

**i18n [ĐO bằng script đọc locale]:** 449 khoá `t("…")` trong trang và `components/ai`, `components/aiCoding`. Thiếu **0/449** ở cả vi, en, zh. Khoá động (`repoWs.outline.${loai}`) không nằm trong phép đếm. Server còn chuẩn hoá `lang` theo BCP-47 (`langSchema`, router `:91`).

---

## 2. Danh mục kiểm (có = 1 · một phần = 0,5 · không = 0)

### A. Dự án

| # | Mục | Mức | Bằng chứng |
|---|---|---|---|
| A1 | Mở thư mục / dự án bất kỳ | **một phần** | Chỉ admin (2FA) đăng ký được một gốc qua dialog `QuanLyDuAnRepo` (`duyetThuMuc` + `themDuAn`, router `:994–1041`). Kỹ sư chỉ chọn trong danh sách trắng (`listProjects`, `:336`). [ĐO] engineer1 không có nút bánh răng. |
| A2 | Tạo dự án mới từ mô tả (scaffold) | **một phần** | Câu chat khớp `laYDinhTaoDuAn` (`intentClassifier.ts:2297`) thì đi `streamCodingTaoKhung`: C# dùng `dotnet new`, loại khác thì model dựng manifest. Kết quả là **một thẻ duyệt lô, trần 8 tệp** (`TRAN_TEP_MOI_LO`, `applyDiffBatch.ts:113`). Tệp được ghi **vào gốc của dự án ĐANG chọn**, nên phải có sẵn một gốc trống do admin đăng ký. Dự án mới không tự thành một mục "dự án". Không có nút hay wizard; phải biết đúng cụm từ khởi phát. |
| A3 | Nhập (git clone / tải zip) | **không** | Không có tool hay thủ tục nào. |
| A4 | Nhiều dự án, chuyển dự án | **có** | `<select id="repows-project">` (`:2394`). `changeProject` đặt lại cây, tab, chat, vòng và phiên (`:1743`). Bàn làm việc nhớ theo user×dự án qua localStorage (`:776–798`). [ĐO] Có 4 dự án trong danh sách. |
| A5 | Cài đặt theo dự án | **không** | Không có màn cấu hình dự án: lệnh kiểm chứng, ngôn ngữ, quy ước. Gợi ý theo dự án là bảng **viết cứng** (`goiYTheoDuAn`, `@/lib/goiYDuAn`); dự án lạ rơi về `MAC_DINH_KHAM_PHA`. |
| A6 | Quản lý công việc (task / todo / kế hoạch / tiến độ) | **không** | Không có bảng kế hoạch hay todo. Chỉ có thẻ "Vòng tự động — lượt i/N" (`VongTuDongCard`, `:359`) và "Vòng đọc mã — lượt n/N" (`:3208`). |

### B. Cây tệp và trình soạn

| # | Mục | Mức | Bằng chứng |
|---|---|---|---|
| B1 | Cây tệp | **có** | `FolderChildren` / `FolderRow` nạp lười từng cấp (`:203–292`). Lọc nhiễu "Hiện tệp khác (n)". Ô Ctrl+P mở nhanh trên chỉ mục phẳng (`phang:true`, trần 12.000 tệp / 3 s). [ĐO] Cây hiện đủ; "Hiện tệp khác (99)". |
| B2 | Sửa và lưu tay | **một phần** | Nút ✎ mở CodeMirror (`:2996`), rồi "Tạo đề xuất" gọi `deXuatSuaTay`, rồi **thẻ duyệt diff**. Không có "lưu" trực tiếp và không có Ctrl+S. Tệp bị cắt (> `TRAN_BYTE_MOI_TEP` = 64 KiB) thì **khoá sửa** (`:2742`). |
| B3 | Nhiều tab | **có** | `openTabs` + `moTab` / `dongTab` (`:2703`). Alt+W, Alt+[ / ]. Tối đa 12 tab, khôi phục qua F5. [ĐO] Tab `package.json ×`. |
| B4 | Tìm trong tệp / toàn repo | **có** | Tìm trong tệp: Ctrl+F (`:2815`). Tìm toàn repo: Ctrl+Shift+F, có Aa, `.*`, trong thư mục, trừ thư mục (`:1264`, `:2453–2512`). Thay thế hàng loạt thành một thẻ duyệt lô (`:1382`). Có outline, breadcrumb, Ctrl+G. [ĐO] Tìm "chayKiemChung" ở repo chính ra **46 kết quả kèm "⚠ BẢN CẮT vì hết giờ: mới quét 5465 tệp"**: trên repo lớn, tìm không phủ hết, nhưng giao diện **nói ra** điều đó. |
| B5 | Tạo tệp | **một phần** | Không có nút "Tệp mới". Chỉ tạo được qua chat ("tạo file mới src/x.ts" khớp `laYDinhTaoTep`, `aiLocalKnowledgeCoding.ts:911`), dẫn tới `apply_diff` với `original:""` rồi duyệt. |
| B6 | Xoá / đổi tên tệp | **không** | Không có tool, nút hay thủ tục nào. |

### C. Chat AI

| # | Mục | Mức | Bằng chứng |
|---|---|---|---|
| C1 | Streaming | **có** [SUY] | `useKbChatStream`. `Streamdown mode="streaming"` (`:3203`). Đồng hồ giây chờ (`:1010`). Dấu vết đa tool (`:2141`). Không đo sống vì engine tắt. |
| C2 | @-mention tệp | **có** | `capNhatGoiYTep` + `GoiYTep` + `chenMention` (`:1141–1175`, `:3330`). Nguồn là chỉ mục phẳng toàn cây. |
| C3 | Dán lỗi / stack trace | **có** | Textarea nhiều dòng. `phanTichLoiViTri` biến `tệp:dòng` trong tin nhắn (cả hai vai) thành nút nhảy (`:3141`). |
| C4 | Dán ảnh / chụp màn hình | **không** | Không có `onPaste` hay `clipboardData` hay ảnh trong trang. Model lập trình chỉ nhận chữ. |
| C5 | Chọn chế độ hỏi / sửa / agent | **một phần** | Không có bộ chọn chế độ. Ý định được **suy bằng regex** từ câu: `classifyCodingToolIntent`, `laYDinhTaoTep`, `laYDinhTaoDuAn`, `laYDinhTuTri`. Người dùng phải biết "câu thần chú", ví dụ "sửa X:", "tạo dự án", "tự sửa cho test xanh". Chỉ có bộ chọn **chế độ nghĩ** (cân bằng / nhanh, `:2259`). |
| C6 | Chọn model | **một phần** | `<select>` có "model: tự động" và "model: Qwen3.6-35B-A3B" (tầng mã), gửi qua `context.modelTask` (`:2235`). Không chọn được model tuỳ ý; đây là thiết kế có chủ đích (router `:396–409`). [ĐO] Đang chọn tầng mã; huy hiệu "model: T2". |
| C7 | Bảng "đang nghĩ" | **có** | `BangDangNghi` sống và pill sau lượt (`:3201`, `:3224`). Lý do model được chụp vào thẻ duyệt (`LyDoDuyet`, `:2943`). |
| C8 | Huỷ giữa chừng | **có** | Nút Stop đỏ (`:3374`) và Esc (`phanGiaiPhimTatKhung`). Server cắt khi client bỏ đi (`_huyKhiClientBoDi.ts`). |

### D. Sinh mã đổ thẳng thành tệp và duyệt

| # | Mục | Mức | Bằng chứng |
|---|---|---|---|
| D1 | Sinh mã thành tệp mới | **có** [SUY] | Một tệp qua `laYDinhTaoTep` → `apply_diff(original:"")`. Khung dự án qua lô (A2). |
| D2 | Sửa nhiều tệp | **một phần** | Lô `apply_diff_batch` có, nhưng đường sửa nhiều tệp đòi **≥ 2 đường dẫn do NGƯỜI gõ** (`trichMoiDuongDanRepo`; model không được tự chọn tệp để ghi) và trần 8 tệp / lô. |
| D3 | Duyệt theo hunk | **có** (một tệp) | `TheDuyetDiff`: chọn khối, gửi `selectedHunkIds` (`TheDuyetDiff.tsx:116`, `:305`). Thẻ hiện ở **khung giữa** kiểu Cursor (`:2934`). |
| D4 | Duyệt theo tệp / lô | **một phần** | `TheDuyetDiffLo`: mỗi tệp một tab, nhưng **duyệt cả lô hoặc huỷ cả lô**, không chọn được từng tệp hay từng khối (docblock dòng 32–40, cố ý). |
| D5 | Hoàn tác / checkpoint | **một phần** | Nút ↶ chỉ hoàn tác **lượt áp cuối của MỘT tệp, khi áp trọn** (`lanApCuoi`, `:591`, `:1589`), và hoàn tác cũng thành một đề xuất ngược phải duyệt. Không có checkpoint hay timeline, không hoàn tác lô, không khôi phục về trạng thái trước phiên. |

### E. Chạy

| # | Mục | Mức | Bằng chứng |
|---|---|---|---|
| E1 | Chạy lệnh / test / build | **một phần** | 11 khuôn. Mỗi lượt qua thẻ "Xác nhận CHẠY lệnh" (`:3301`). Không chạy được cài gói, dev server hay script tuỳ ý. |
| E2 | Terminal | **một phần** | [ĐO] Pane "Lệnh & Nhật ký" có ô gõ "$ vd: dotnet test CalculatorDemo.sln — Enter để gửi đi duyệt", nút "Gửi duyệt", liên kết "xem 11 lệnh gõ được". Thực chất lệnh gõ **đi vòng qua model**: `onGoLenh` → `handleSend("chạy {{lệnh}}")` (`:3455`), nghĩa là tốn một lượt model 30–120 s mới có thẻ duyệt. Có đuôi sống realtime (`dauRaSong`, poll 800 ms). Không phải shell. |
| E3 | Problems / diagnostics | **một phần** | `BangProblems` parse đầu ra lệnh **đã chạy** (`phanTichLoiViTri`), tích luỹ theo lệnh, có công tắc cảnh báo (`:2083`). Không có LSP hay tsc chạy nền; không gạch đỏ trong trình xem. |
| E4 | Vòng tự sửa tới khi xanh | **có** | `chayLuotVong` (`:1629`) dùng `chayKiemChung` và `quyetDinhTiep` (trần, không tiến bộ, lặp bản sửa). Mỗi lượt ghi vẫn phải duyệt, trừ khi chạy chế độ tự trị (`AI_CODING_TU_TRI_GHI=1`, đang **bật** ở `.env` này). Thẻ nói lý do dừng (9 lý do, `:370`). Chỉ hoạt động cho **một tệp** (không cho lô) và khi dự án có lệnh kiểm chứng suy được. |

### F. Git

| # | Mục | Mức | Bằng chứng |
|---|---|---|---|
| F1 | Trạng thái / diff | **một phần** | Chỉ qua `run_command` `git status` / `git diff` (duyệt từng lần). [ĐO] Phiên cũ "Chạy git status" hiển thị đầu ra. Không có panel Source Control và không đánh dấu tệp bẩn trên cây. |
| F2 | Commit | **không** | Không có. |
| F3 | Nhánh | **không** | Không có. |

### G. Phiên và trí nhớ

| # | Mục | Mức | Bằng chứng |
|---|---|---|---|
| G1 | Lịch sử và resume | **có** | `BoChonPhien` (popover đồng hồ, có ô tìm), `moPhien` / `chonPhien` (`:1819`). Lưu tự động (`luuTranscript`, `:1780`) theo **chủ sở hữu × dự án** (mig 0333). [ĐO] Mở được phiên 51 ngày tuổi; hiện "3 lượt · 18:40 24-08". Resume **không** khôi phục lịch sử pane Terminal / Vấn đề, tab hay thẻ duyệt (cố ý vì an toàn). |
| G2 | Đặt tên | **không** | Nhãn do server suy từ câu đầu; client không gửi nhãn (router `:891`). [ĐO] 6 phiên, trong đó 4 phiên **trùng tên** "Chạy git status" và 2 trùng "Chạy npm run check:tests"; không phân biệt được. |
| G3 | Xoá phiên | **có** | `xoaPhienNay` có `window.confirm` (`:1865`). |
| G4 | Trí nhớ dài hạn | **một phần** | Bài học xuyên phiên (doc 82) theo user×dự án, tự chèn vào `prompt` (không vào `systemPrompt`), quét tiêm khi ghi và khi đọc (`ai/codingLessonContext.ts`, `db/aiCodingLessons.ts`). **Chỉ thao tác bằng câu chat**: "nhớ rằng: …", "liệt kê bài học", "quên bài học N" (`shared/aiCodingLesson.ts:201–219`). Không đọc quy ước repo (AGENTS.md / CLAUDE.md / README). Ngữ cảnh dự án chỉ là tên và 24 mục gốc (`nguCanhDuAnChoPrompt`, `aiLocalKnowledgeCoding.ts:933`). |
| G5 | Màn quản lý trí nhớ | **không** | Không có UI để xem, sửa hay xoá bài học. |

### H. Thanh trạng thái và preview

| # | Mục | Mức | Bằng chứng |
|---|---|---|---|
| H1 | Máy / model / VRAM / token | **có** | `ThanhTrangThaiAiLocal` gồm 9 ô: máy · model · VRAM còn · lượt cuối · tok/s · ngân sách đọc · nghĩ/sinh · ctx% · phiên, kèm nút chép JSON. Nguồn VRAM là đầu dò thiết bị (router `:548–700`). [ĐO] "ENGINE HỎNG" khớp với `curl :8091` chết; "ngân sách đọc" 0 % → 1 % sau khi mở tệp và tìm. |
| H2 | Preview web app đang chạy | **không** | Không có iframe, cổng dev hay `npm run dev`; danh sách trắng không cho chạy app. |

**Tổng: 22,0 / 39 mục = 56 %.**

Điểm theo nhóm: Dự án 2/6 (33 %) · Editor 4/6 (67 %) · Chat 6/8 (75 %) · Sinh mã và duyệt 3,5/5 (70 %) · Chạy 2,5/4 (63 %) · Git 0,5/3 (17 %) · Phiên và trí nhớ 2,5/5 (50 %) · Trạng thái và preview 1/2 (50 %). Trung bình nhóm 53 %.

---

## 3. Hành trình "từ mô tả → dự án chạy được"

| Bước | Có làm được trên trình duyệt không? | Ghi chú |
|---|---|---|
| 1. Có chỗ chứa dự án mới | ⚠ Chỉ admin + 2FA | Admin mở dialog bánh răng, chọn thư mục máy chủ, đăng ký id. Kỹ sư thường **tắc ngay tại đây**. Thư mục phải tồn tại sẵn; UI không tạo thư mục. |
| 2. Mô tả → khung dự án | ⚠ Được nếu biết cụm từ | Ví dụ "tạo dự án React…". Model dựng manifest **≤ 8 tệp** (C# thì `dotnet new`), rồi thẻ duyệt lô. Không có wizard hay kế hoạch; quá 8 tệp thì bị từ chối cả lô. |
| 3. Duyệt và ghi | ✅ | Duyệt cả lô, không chọn từng tệp. |
| 4. Cài phụ thuộc | ❌ **TẮC** | `npm install` / `npm ci` / `pip install` không có trong 11 khuôn. `dotnet` chạy `--no-restore` mặc định, nên dự án mới có package NuGet sẽ không build được trừ khi bật cờ restore. |
| 5. Build / test | ⚠ | `npm run check`, vitest, `dotnet build/test`, pytest đều có, nhưng chạy được chỉ khi bước 4 đã xong ngoài trình duyệt. |
| 6. Vòng tự sửa tới khi xanh | ✅ (một tệp, cờ đang bật) | Không áp cho lô và cần lệnh kiểm chứng suy được. |
| 7. Chạy app và xem trước | ❌ **TẮC** | Không có dev server hay preview. |
| 8. Commit / nhánh | ❌ | Không có. |

**Kết luận [SUY]:** người dùng đi được tới **bước 3** (có mã trên đĩa). Từ bước 4 trở đi phải rời trình duyệt để cài gói, chạy và commit. Với dự án C# chỉ dùng thư viện chuẩn (khung `dotnet new` không cần package lạ) thì đi được tới bước 5–6. Phép đo sống không xác nhận được vì engine đang tắt.

---

## 4. Khoảng trống ưu tiên

### P0 — chặn trực tiếp mục tiêu sản phẩm

1. **Không cài phụ thuộc, không chạy app, không preview** (E1, H2). Mục tiêu "dự án chạy được" không khép vòng trong trình duyệt: hành trình gãy ngay sau scaffold. Hướng xử lý: thêm khuôn `npm ci` / `npm install` / `pip install -r` / `dotnet restore` có hàng rào riêng (offline feed, HITL), cộng một khuôn "chạy dev server có cổng" với iframe preview.
2. **Kỹ sư không tự tạo hay mở được dự án** (A1, A2). "Quản lý được dự án" hiện là việc của admin + 2FA và cần một thư mục có sẵn. Scaffold lại đổ vào gốc đang chọn, nên rất dễ đổ nhầm vào repo chính hoặc một dự án demo. Cần luồng "Dự án mới" (tên + mô tả → server tạo thư mục con trong vùng cho phép → đăng ký → scaffold).
3. **Không có git commit / nhánh / checkpoint** (F2, F3, D5). Khi vòng tự trị đang bật (`AI_CODING_TU_TRI_GHI=1`), chỉ có hoàn tác MỘT lượt cuối của MỘT tệp. Model ghi nhiều lượt rồi hỏng thì không có điểm quay về. Đây vừa là thiếu công cụ vừa là rủi ro an toàn.

### P1 — làm tác nhân "kém thông minh" hoặc khó dùng

4. **Chế độ suy từ regex, không có bộ chọn hỏi / sửa / agent** (C5). Người dùng phải biết "câu thần chú"; câu tự nhiên dễ rơi về đường "in mã ra chat". Bộ công cụ mạnh nhưng người dùng không thấy và không gọi chủ động được.
5. **Thiếu công cụ tệp: xoá, đổi tên, nút tạo tệp; sửa nhiều tệp bắt người gõ ≥ 2 đường** (B5, B6, D2). Không làm được refactor thật, vì refactor cần đổi tên, tách hay xoá tệp.
6. **Trí nhớ ẩn** (G4, G5). Bài học chỉ quản bằng câu chat; không đọc quy ước repo (AGENTS.md / README); ngữ cảnh dự án chỉ có 24 mục gốc. Cần màn "Trí nhớ dự án" (xem / sửa / xoá bài học, ghim tệp quy ước).
7. **Không có kế hoạch / todo cho tác vụ nhiều bước** (A6). Agent mode kiểu Cursor/Claude Code dựa vào một kế hoạch nhìn thấy được; ở đây chỉ có "lượt i/N".
8. **Terminal gõ lệnh đi vòng qua model** (E2). Một lệnh `git status` tốn một lượt suy luận (30–120 s ở chế độ cân bằng) chỉ để dựng thẻ duyệt. Nên dựng thẻ duyệt `run_command` trực tiếp, bỏ qua model.
9. **Tìm toàn repo bị cắt trên repo lớn** [ĐO]: hết giờ sau 5.465 tệp. Có cảnh báo, nhưng tác nhân `grep_repo` cũng chịu cùng trần, nên nó có thể "không thấy" mã tồn tại.

### P2 — hoàn thiện

10. **Không đặt tên phiên** [ĐO]: tên trùng nhau. Resume cũng không khôi phục Terminal / Vấn đề.
11. **Không dán ảnh** (C4).
12. **Problems chỉ từ đầu ra lệnh**, không có diagnostics nền.
13. **Duyệt lô không chọn từng tệp** (D4).
14. **Hiển thị [ĐO]** (ảnh 03):
    - Khối đầu ra lệnh trong chat mang nhãn nguồn gốc **"Mã do model viết — có thể khác tệp trên đĩa"**, trong khi đó là đầu ra máy. Nhãn sai nguồn.
    - Cột số dòng của khối mã Streamdown hiện **"1" ở mọi dòng**: các span `before:[counter-increment:line]` không có `counter-reset` ở cha, nên đọc thành "1$ git status", "10n branch…".
15. **Sửa tay bị khoá với tệp > 64 KiB**; không có lưu trực tiếp (theo thiết kế HITL).

---

## 5. Điểm hoàn thiện

- **Theo danh mục kiểm:** 22,0 / 39 = **56 %**. Trung bình theo 8 nhóm là 53 %.
- **Theo hành trình mục tiêu** "mô tả → dự án chạy được" (8 bước, ✅ = 1, ⚠ = 0,5, ❌ = 0):
  - Bước 1: 0,5 · Bước 2: 0,5 · Bước 3: 1 · Bước 4: 0 · Bước 5: 0,5 · Bước 6: 1 · Bước 7: 0 · Bước 8: 0
  - Tổng 3,5 / 8 = **44 %**.
- **Điểm chung đề xuất ≈ 50 %**, là trung bình hai cách trên.

Mảnh đọc / duyệt / chạy test của một repo đã có được làm kỹ, nhiều chỗ ngang Cursor: tab, Ctrl+P, Ctrl+F, Ctrl+Shift+F, diff khung giữa theo hunk, đồng hồ, bảng nghĩ, thanh trạng thái thật. Còn hai đầu của vòng đời dự án gần như vắng: **khởi tạo** (tạo hay mở dự án, cài gói) và **khép lại** (chạy app, preview, commit, checkpoint).

## 6. Giới hạn của khảo sát này

- Không đo sống luồng streaming, thẻ duyệt hay vòng tự sửa vì `llama-server :8091` tắt. Mọi nhận định về chúng là **[SUY]** từ mã.
- Không đo trên tài khoản admin (bánh răng quản lý dự án) và không thử một tài khoản thiếu `ai_repo_exec`.
- Playwright MCP chỉ cho ghi ảnh vào `.playwright-mcp/` của repo (thư mục đã `.gitignore`). Ba ảnh đã được chuyển sang scratchpad. Các tệp snapshot `.yml` và log do MCP tự sinh lúc 15:03–15:05 vẫn nằm ở `.playwright-mcp/`, cũng đã được gitignore.
- Ở trình duyệt, tôi chỉ bấm các nút chỉ đọc: mở tệp, mở tab Terminal, mở lịch sử phiên, nạp một phiên, tìm repo. Không gửi câu hỏi, không duyệt, không xoá.
