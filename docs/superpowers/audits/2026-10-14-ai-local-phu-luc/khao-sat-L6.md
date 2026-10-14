# Khảo sát tầng 6: Agent / điều phối của AI LẬP TRÌNH (server) + CLI/MCP

Ngày 2026-10-14 · nhánh `feat/ai-local-L7-hang-rao` · chỉ đọc mã, không sửa tệp nào.
Ký hiệu: **[ĐO]** = tôi đọc thấy trong mã hoặc chạy lệnh ra kết quả · **[TL]** = số đo đã ghi trong tài liệu, tôi không đo lại · **[SUY]** = tôi suy luận, chưa kiểm bằng đo sống.

---

## 0. Kết luận một đoạn

Tầng 6 của AI lập trình **không phải một agent kiểu Claude Code**. Nó là một **bộ định tuyến tất định bằng regex** (`streamCodingAnswer`) dẫn câu hỏi tới **6 đường ống cố định**: bài học · sửa một tệp · tạo khung dự án · tự trị sửa-tới-xanh · sửa nhiều tệp (người dùng phải nêu đường dẫn) · vòng ĐỌC ≤3 vòng. Nếu không đường nào khớp thì sinh mã một lượt. Model **không bao giờ tự chọn một tool ghi giữa vòng**. Vòng ≥2 chỉ được dùng 3 tool đọc, và có một tool ghi là vòng dừng.

Phần an toàn **rất chắc**: HITL mọi lượt ghi, hộp cát, TOCTOU băm, rào tệp bẩn git, kill-switch, WORM audit, MCP không có tool duyệt. Phần tự chủ thì **hẹp**:
- Vòng tự trị sửa **một tệp mỗi lượt**. Trần mặc định 3 lượt nên chỉ có **tối đa 2 bản vá**.
- Bài A2 (2 lỗi ở 2 tệp) đạt tỉ lệ thật **≈ 44 %** [TL].
- Không có kế hoạch/todo, xoá/đổi tên tệp, git ghi, hoàn tác, subagent hay web.

**Điểm hoàn thiện so với chuẩn Claude Code/Copilot agent mode: ≈ 50 % (dải 45–56 %).**

---

## 1. Bản đồ tệp (đã kiểm)

| Vai trò | Tệp (dòng) |
|---|---|
| Route SSE | `server/routes/aiLocalKnowledgeApi.ts:508` (`POST /api/ai/local-kb/stream`, `AbortController` :528, huỷ bằng `res.on("close")`) |
| Cửa vào nhánh lập trình | `server/services/aiLocalKnowledgeService.ts:3496 streamAnswer` → `:3510` `streamCodingAnswer` khi `codingMode` |
| **Bộ định tuyến** | `server/services/aiLocalKnowledgeCoding.ts:373 streamCodingAnswer` (973 dòng) |
| Sinh mã | `aiLocalKnowledgeCodingSinhMa.ts:59 streamCodingGenerate` |
| Sửa / tự trị / nhiều tệp | `aiLocalKnowledgeCodingSua.ts:66 streamCodingEdit` · `:436 streamCodingTuTriGhi` · `:524 chuanBiBanSuaMotTep` · `:1066 streamCodingSuaNhieuTep` |
| Tạo khung | `aiLocalKnowledgeCodingTaoKhung.ts:61` + `ai/dotnetNewScaffold.ts` |
| Persona, prompt, bóc khối, gọi model | `aiCodingAgent.ts` (1.775 dòng, thư viện; `streamCodingModel` :308 → `aiGgufEngine.generateTextStream` → llama-server :8091) |
| Vòng tool | `aiLocalTools/index.ts:432 tryExecuteCodingToolLoop` + `aiLocalTools/toolLoop.ts:271 runToolLoop` (hàm thuần) |
| Bộ chọn tool | `aiLocalTools/intentClassifier.ts:1954 classifyCodingToolIntent` (regex) · `:2045 …LLM` (JSON 5 tool) · `:2445 decideNextCodingToolLLM` (3 tool đọc) · `:2205 chanLenhKhiCauHoi` · `ai/phuQuyetTool*.ts` (phủ quyết native) |
| Vòng tự trị ghi | `aiCodingTuTriGhi.ts:401 chayVongTuTriGhi` · `:199 chayLuotTuTriGhi` · `shared/aiCodingLoop.ts:300 quyetDinhTiep` |
| Kiểm chứng (chạy test) | `aiCodingVerify.ts:304 chayKiemChung`, tập `NHAN_KIEM_CHUNG` :115 |
| Hộp cát lệnh | `aiLocalTools/repoCommandSandbox.ts:416 DANH_SACH_TRANG` (11 khuôn) |
| tRPC | `server/routers/repoWorkspaceRouter.ts` (1.072 dòng, 22 thủ tục) |
| CLI / MCP | `server/services/aiCodingCli/{cli,cauNoiCli,mcpServer,danhTinhCli,batDau}.ts` · `npm run ai:cli` · `npm run ai:mcp` |

---

## 2. (a) Luồng xử lý

### 2.1 Yêu cầu SINH MÃ, ví dụ "viết code C# chat LAN dùng socket"

1. `aiLocalKnowledgeApi.ts:508` dựng `execCtx` có `signal`, rồi gọi `streamAnswer` (:610).
2. `aiLocalKnowledgeService.ts:3510` chuyển sang `streamCodingAnswer` (`aiLocalKnowledgeCoding.ts:373`).
3. `phanGiaiGoc(projectId)` (`repoProjects`) đổi projectId thành thư mục gốc theo danh sách trắng. Id lạ thì từ chối.
4. Bài học: `bocYDinhBaiHoc` → `layKhoiBaiHocChoLuot` (bài học được bọc như dữ liệu không tin cậy).
5. Câu được thử lần lượt qua các cửa tất định: `codingEditPath` → `trichDuongSuaTatDinh` → `laYDinhTaoDuAn` → `laYDinhTuTri` → `classifyCodingToolIntent`. Câu ví dụ không khớp cửa nào.
6. `tryExecuteCodingToolLoop` (`index.ts:432`):
   - Vòng 1 = `chonToolLapTrinh` (:145): heuristic → LLM JSON → `chanLenhKhiCauHoi` → phủ quyết native.
   - Kết quả thường là không có tool.
7. Rơi xuống `streamCodingGenerate` (`aiLocalKnowledgeCoding.ts:815` → `SinhMa.ts:59`):
   - `nguCanhDuAnChoPrompt`: chạy `list_files` depth 1.
   - `thuThapNguCanhMa` (`ai/codingRepoContext.ts:407`): đọc mục lục, rồi đọc mã thật qua `read_file`, khoảng 4k token.
   - Ghép prompt: `personaSinhMa` + `promptSinhMa` + lịch sử (≤8 lượt × 2.400 ký tự).
   - Gọi model: `streamCodingModel` → `rutChuCoCanh` (cắt suy luận, che bí mật, canh thoái hoá).
   - Hậu xử lý: `boSungUsingChoCauTraLoi` (`SinhMa.ts:419`, C#), rồi phát `done`.
8. **Không có byte nào được ghi.** Muốn có tệp, người dùng phải gõ tiếp kiểu "tạo tệp X…". Khi đó `laYDinhTaoTep` → `streamCodingEdit` (`original:""`) → `apply_diff` → thẻ duyệt.

### 2.2 Yêu cầu SỬA LỖI: ba đường

**(b1) Có người duyệt.** Ví dụ "sửa src/Calc.cs: chia cho 0".
1. `trichDuongSuaTatDinh` (`intentClassifier.ts:2259`) → `streamCodingEdit` (`Sua.ts:66`).
2. `chuanBiBanSuaMotTep` (:524):
   - `read_file` (:548).
   - `motLuotModel` (:804) sinh khối SEARCH/REPLACE (`apDungKhoiSua`, `aiCodingAgent.ts:1073`), hoặc chép cả tệp nếu tệp nhỏ. Trần tệp sửa là 60.000 ký tự.
3. `executeDecision({tool:"apply_diff"})` (`Sua.ts:104` → `index.ts:208`) → `proposeAction` (`aiCopilotActions.ts:263`).
4. Phát `pending_action`. Người bấm duyệt thì `aiCopilotRouter.confirmAction` → `aiCopilotActions.ts:740`. Các rào khi ghi: hộp cát, băm TOCTOU, `git status --porcelain -- <tệp>`, cho chọn từng khối.
5. Nếu `AI_CODING_AUTOLOOP=1`: client gọi `repoWorkspace.chayKiemChung` (`repoWorkspaceRouter.ts:820` → `aiCodingVerify.ts:304`).
6. Đầu ra test quay lại ở lượt sau qua `context.dauRaKhongTinCay` → `bocDauRaMayChoLichSu` (`aiLocalKnowledgeCoding.ts:359`). Model đề xuất bản vá mới, và **người lại phải duyệt**. Trần mặc định 3 lượt, cứng 5 (`tranVongLap`).

**(b2) Tự trị.** Ví dụ "tự sửa cho test xanh".
1. `laYDinhTuTri` (`intentClassifier.ts:2341`) → `streamCodingTuTriGhi` (`Sua.ts:436`) → `chayVongTuTriGhi` (`aiCodingTuTriGhi.ts:401`).
2. Mỗi lượt chạy theo thứ tự:
   - `isKillSwitchTripped`.
   - `chayKiemChung`: chỉ dùng tập lệnh hẹp; phép suy chỉ được chọn `npx vitest`, `dotnet test`… (`NHAN_SUY_DUOC`).
   - `quyetDinhTiep` (`shared/aiCodingLoop.ts:300`): xanh → dừng; số ca đỏ không giảm hoặc đầu ra lặp → dừng `khong_tien_bo`; `luot ≥ tran` → dừng.
   - `sinhBanVa` = `taoSinhBanVaTuTri` (`Sua.ts:274`):
     - `cayTepNguon`: `thuMucTuLoi` + `list_files` depth 3, ≤400 mục.
     - `chonTepTuTri`: model chọn **MỘT** tệp, 512 token.
     - `chuanBiBanSuaMotTep`; nếu kết quả là `khong_doi` thì thử tệp khác, tối đa 3 lần.
   - `chayLuotTuTriGhi` (:199): `executeDecision(apply_diff)` → `confirmAction(reason:"AI_CODING_TU_TRI_GHI")`, tức **tự duyệt theo chính sách**.
   - `ghiAuditLuotTuTri` (WORM: băm trước/sau, lệnh, kết quả, cờ `sua_tep_test`).
3. Bật bằng **hai cờ**: `AI_CODING_AUTOLOOP=1` + `AI_CODING_TU_TRI_GHI=1`. Trần `AI_CODING_TU_TRI_GHI_MAX`, kẹp 1..10, **mặc định 3**.

**(b0) Vòng đọc**, ví dụ "hàm X được gọi ở đâu".
1. Vòng 1 là `grep_repo` hoặc `list_files`. Chỉ hai tool này cho đi tiếp (`MO_DUONG_VONG_SAU`, `index.ts:399`). `NO_MATCH` thì dừng.
2. Vòng ≥2: `decideNextCodingToolLLM`, chỉ với `read_file`/`list_files`/`grep_repo`.
3. Trần ≤3 vòng (cứng 5), 180 s.
4. Kết quả được dump ra, hoặc đưa vào `streamCodingGenerate` dưới dạng khối không tin cậy để trả lời câu cần suy luận.

---

## 3. (b) Công cụ của agent lập trình

| Tool | Đọc/Ghi | HITL? | Bằng chứng |
|---|---|---|---|
| `read_file` | Đọc | Không (RBAC `ai_repo_read`, hộp cát, che bí mật, 64 KB/tệp, 4 MB/15 phút) | `repoReadTools.ts:186`, `repoSandbox.ts:263,301` |
| `list_files` | Đọc | Không (≤300 mục, độ sâu ≤12) | `repoReadTools.ts:271`, `repoSandbox.ts:305` |
| `grep_repo` | Đọc | Không (≤80 kết quả, 4 s, ≤9.000 tệp) | `repoReadTools.ts:423`, `repoSandbox.ts:313-325` |
| `run_command` | Ghi (`kind:"write"`) | **Có**. Tự trị chỉ chạy tập con `NHAN_KIEM_CHUNG` | `writeHandlers/repoCommand.ts:442,465` |
| `apply_diff` (1 tệp, tạo mới được, chọn khối) | Ghi | **Có**. Ở chế độ tự trị thì tự duyệt theo cờ + WORM | `writeHandlers/applyDiff.ts:571` |
| `apply_diff_batch` (≤8 tệp, không nguyên tử, báo `BATCH_PARTIAL`) | Ghi | **Có** (áp tất cả, không chọn khối) | `applyDiffBatch.ts:113,352` |
| Tạo khung `dotnet new` (server chạy trong thư mục tạm, rồi đưa qua `apply_diff_batch`) | Ghi | **Có** | `ai/dotnetNewScaffold.ts`; `TaoKhung.ts:84` trần 8 tệp |
| Bài học xuyên phiên (`nhớ giùm:`, liệt kê, quên) | Ghi DB | Người tự gõ | `aiLocalKnowledgeCoding.ts:150` |
| tRPC `deXuatThayTheLo` (tìm/thay ≤8 tệp) · `deXuatSuaTay` | Ghi | **Có** | `repoWorkspaceRouter.ts:702,772` |
| MCP `avi_list_projects`, `avi_read_file`, `avi_list_files`, `avi_grep_repo` | Đọc | Không | `aiCodingCli/mcpServer.ts:97-135` |
| MCP `avi_propose_edit`, `avi_propose_command` | Chỉ đề xuất | **Có** (duyệt ở web hoặc `ai:cli --duyet`; MCP không có tool duyệt) | `mcpServer.ts:152,171` |

Danh sách trắng `run_command` gồm **11 khuôn** [ĐO] (`repoCommandSandbox.ts:416-667`): `npm run check` · `npm run check:tests` · `npx vitest run <p>` · `git status` · `git diff` · `dotnet build <p>` · `dotnet test <p>` · `dotnet format <p>` · `node --test <p>` · `python -m pytest <p>` · `python -m unittest <p>`. Hạn giờ 20–240 s mỗi lệnh, trần cứng 300 s, đầu ra 32 KB.

Không tồn tại: `delete_file`, `rename_file`, `git commit/branch/checkout/log`, web/fetch, todo, subagent. Grep toàn `server/services` chỉ ra một ca test khẳng định `git commit` **bị từ chối** (`repoCommand.census.test.ts:461`) [ĐO].

---

## 4. (c) So với chuẩn Claude Code / Copilot agent mode

| Năng lực | Mức | Điểm | Bằng chứng |
|---|---|---|---|
| Vòng nhiều bước **do model quyết** (đọc → tìm → sửa nhiều tệp → chạy → sửa tới xanh) | Một phần | 0,5 | Định tuyến regex `aiLocalKnowledgeCoding.ts:373-821`. Vòng đọc chỉ có 3 tool đọc (`intentClassifier.ts:2387`). Vòng tự trị là đường ống cố định: 1 tệp/lượt, tối đa 2 bản vá ở trần 3 |
| Đọc tệp | Có | 1 | `read_file` |
| Tìm / liệt kê | Có | 1 | `grep_repo`, `list_files` |
| Sửa 1 tệp, xem diff, chọn khối | Có | 1 | `apply_diff` + SEARCH/REPLACE |
| Sửa nhiều tệp một lượt | Một phần | 0,5 | Người dùng phải nêu 2–6 đường (`TRAN_TEP_MOT_LUOT_SUA=6`); agent không tự tìm tệp cần sửa |
| Tạo tệp mới | Có | 1 | `apply_diff original:""`; khung ≤8 tệp |
| Xoá / đổi tên tệp | Không | 0 | Không có tool |
| Chạy terminal | Một phần | 0,5 | 11 khuôn, có HITL; không có `npm install`, `npm run build`, `dotnet run`, `python x.py`, `tsc` cho dự án khác |
| Đọc diagnostics / lỗi build để sửa | Một phần | 0,5 | Chỉ qua đầu ra test/build (`catLoiChoPrompt` 4.000 ký tự); không có LSP/diagnostics |
| Git | Rất hạn chế | 0,25 | Chỉ `status`/`diff` để đọc + rào tệp bẩn; không commit/branch |
| Web / docs lookup | Không | 0 | Cố ý vì nhà máy offline; chỉ có ngữ cảnh repo (mục lục chunk) |
| MCP | Một phần | 0,5 | Có **MCP server** stdio (6 tool, chỉ đề xuất). **Không có MCP client** phía server (extension tự gọi `mcp_goi` phía client, thuộc tầng 7) |
| Subagent | Không | 0 | — |
| Kế hoạch / todo hiển thị | Không | 0 | `StreamEvent` chỉ có `meta/token/tool/tool_loop/pending_action/client_action/reasoning/usage/done`. Agent **vận hành** (`aiAgentOrchestrator`) có plan/replan nhưng không dùng cho lập trình |
| Checkpoint / hoàn tác | Rất hạn chế | 0,25 | Có băm trước/sau, WORM, chọn khối. Không có nút hoàn tác; `applyDiff.ts:333-347` tự nói "không có lưới hoàn tác" khi thiếu git |
| Chế độ quyền (HITL) | Gần đủ | 0,75 | HITL mỗi lượt ghi; tự trị bật bằng cờ env toàn server + kill-switch; không có chế độ theo phiên (ask / accept-edits / plan) |
| Giới hạn vòng / thời gian | Có | 1 | Vòng đọc 3/5 vòng, 180 s; tự trị 3 (≤10) lượt; lệnh ≤300 s. ⚠ Vòng tự trị **không có trần đồng hồ tổng** [ĐO: không có `Date.now`/`maxMs` trong `aiCodingTuTriGhi.ts`, `aiCodingVerify.ts`] |
| Huỷ giữa chừng | Phần lớn | 0,75 | `signal` chuyển xuống model (Sua :244/675/749, SinhMa :317). `aiCodingTuTriGhi.ts`, `aiCodingVerify.ts`, `toolLoop.ts` **không đọc `signal`** ⇒ lệnh test đang chạy vẫn chạy tới xong [ĐO đếm bằng grep, hệ quả là SUY] |
| Trí nhớ | Phần lớn | 0,75 | Lịch sử 8 lượt × 2.400 ký tự; phiên lưu/mở/xoá theo dự án (`repoWorkspaceRouter.ts:866-930`); bài học tự khai theo dự án. Không tự rút bài học (cố ý) |
| Quản lý dự án | Một phần | 0,5 | Nhiều dự án (env + DB ≤20; `themDuAn` cần admin + 2FA, thư mục **phải có sẵn**). `duyetThuMuc` chỉ liệt kê. Không tạo được thư mục dự án mới từ trình duyệt; không có task/issue |
| Sinh mã một lượt (chất lượng) | Có | 1 | H 86 % / ba dự án 20/21 [TL] |
| **Tổng** | | **11,75/21 = 56 %** | |

---

## 5. (d) Khoảng trống

### P0: chặn trực tiếp mục tiêu "tự chủ như Claude Code"

**P0-1. Không có vòng tác nhân tổng quát do model điều khiển.** Mọi hành vi ghi phụ thuộc người dùng gõ đúng khuôn regex ("sửa X:", "tạo tệp…", "tự sửa cho test xanh", nêu ≥2 đường dẫn).
- Một yêu cầu kiểu "thêm tính năng xuất CSV cho module Y" (tìm → đọc → sửa 3 tệp → build → sửa) **không có đường nào thực hiện được**. Nó rơi vào "sinh mã một lượt" và in ra văn bản.
- Hạ tầng cho một vòng thật **đã có sẵn**: tool-calling gốc đã đo chạy được trên b9814 (`ai/nativeToolCalls.ts` header), `runToolLoop` thuần, `executeDecision` một cửa, HITL/hộp cát/WORM. Còn thiếu một vòng ReAct kiểu "model gọi tool → quan sát → gọi tiếp", trong đó lượt ghi **tạm dừng chờ duyệt rồi đi tiếp**, chứ không kết thúc vòng.
- Bằng chứng: `index.ts:353-367` (tool ghi kết thúc vòng; vòng ≥2 chỉ đọc), `aiLocalKnowledgeCoding.ts:373-821`.

**P0-2. Ngân sách vòng tự trị đủ cho đúng một chiến thắng không sai bước.**
- Mỗi lượt sửa **một** tệp (`sinhBanVa` trả một `path`). Với `tran=3`, lượt 3 chỉ chạy test rồi dừng, nên **tối đa 2 bản vá**.
- `khong_tien_bo` dừng ngay khi số ca đỏ không giảm. Một bản vá đúng một phần, hoặc sửa nhầm tệp, sẽ cắt vòng.
- A2 cần đúng 2 bản vá ở 2 tệp, tức không có dư địa nào. Tỉ lệ đo được **≈ 12/27 = 44 %** [TL]. Kiểu hỏng ổn định: "sửa lần 1 → đỏ → sửa lần 2 → vẫn đỏ → hết lượt" [TL, audit dòng 1078].
- Kết luận của Phụ lục 4 ("trần 3 vòng chưa bao giờ bó") chỉ dựa trên các lượt **thắng** buổi sáng. Kiểu hỏng về sau cho thấy trần **có** bó [SUY từ hai nguồn TL + mã].
- Đề xuất đo: A2 ×12 với `AI_CODING_TU_TRI_GHI_MAX=5`, và một bản cho phép bản vá nhiều tệp mỗi lượt qua `apply_diff_batch`.

**P0-3 (đính chính điểm xuất phát).** Câu "vòng giữ 3 vòng / 20 s" lẫn hai vòng khác nhau:
- 20 s là `AI_TOOL_LOOP_MAX_MS` của **đường vận hành** (.env).
- Vòng đọc lập trình là **180 s** (`CODING_LOOP_DEFAULT_MS`, `index.ts:378`).
- Vòng tự trị **không có trần thời gian tổng**. Trường hợp xấu nhất ≈ 3 × (≤240 s test + vài phút model) [ĐO mã].

### P1: thiếu năng lực chuẩn, làm agent kém thông minh hoặc kém an toàn khi dùng thật

1. **Không có kế hoạch/todo hiển thị** cho lập trình. `aiAgentOrchestrator` (vận hành) đã có plan, các bước, replan, HITL từng bước ghi: có thể dùng lại khuôn ấy.
2. **Không xoá/đổi tên tệp.** Refactor và dọn dự án đều cần.
3. **Git chỉ đọc.** Không commit/branch/checkpoint, cũng không có nút **hoàn tác** cho lượt ghi (đã có băm trước/sau nhưng không lưu bản trước để khôi phục).
4. **Danh sách lệnh hẹp.** Không cài gói, không `npm run build`/`tsc -p`/`dotnet run`, không `go`/`cargo`/`mvn`. Lệnh kiểm chứng phạm vi repo `npm run check` chỉ hợp với repo chính.
5. **Huỷ không xuống vòng tự trị và lệnh.** `toolLoop`, `aiCodingVerify`, `aiCodingTuTriGhi` không đọc `signal`.
6. **Sửa nhiều tệp đòi người dùng nêu tên tệp.** Agent không tự suy ra tập tệp cần đổi.
7. **Tạo dự án mới** cần admin + 2FA + thư mục có sẵn trên đĩa. Khung chỉ ≤8 tệp mỗi lượt, nên dự án thật cần nhiều lượt và nhiều thẻ duyệt.
8. **Cờ tự trị là cờ env toàn server.** Không bật/tắt được theo phiên hay theo dự án.
   - [ĐO .env] `AI_CODING_AUTOLOOP=1`, `AI_CODING_TU_TRI_GHI=1` đang BẬT.
   - `AI_REPO_SANDBOX_ROOTS` gồm cả repo chính `D:\SOURCES\avi-aoi-management`, nghĩa là vòng tự ghi chạy được trên repo chính. Rào tệp bẩn giúp được phần nào, nhưng đó là rào duy nhất ngăn ghi lên mã đã commit.
9. Không có diagnostics/LSP: lỗi chỉ đến từ đầu ra lệnh, cắt còn 4.000 ký tự.

### P2: nên có, không chặn ngay

- Subagent (tìm song song, xem xét lại).
- MCP **client** phía server, để agent web dùng tool ngoài; hiện chỉ extension có, phía client.
- Tra tài liệu offline (bộ docs SDK/ngôn ngữ đóng gói cục bộ, thay cho web vì nhà máy offline).
- Task/issue cho dự án.
- Chế độ quyền theo phiên (chỉ hỏi / tự chấp nhận sửa / chế độ kế hoạch).
- `apply_diff_batch` chưa chọn được khối.
- Tài liệu CLI còn ghi model `Qwen3-30B-A3B-Instruct` (`cli.ts:10`), cũ so với mặc định Qwen3.6-35B-A3B.

### Ghi chú về trợ lý vận hành (ngoài trọng tâm)

`aiAgentOrchestrator.ts` + `aiAgentPlanner.ts`: kế hoạch nhiều bước có xác thực, `advance()` dừng ở mỗi bước ghi, `MAX_WRITES_PER_SESSION`, replan, không tự confirm. Đường chat vận hành còn có `tryExecuteToolLoop` (G2-C) với cờ `AI_TOOL_LOOP_ENABLED=1`, 3 vòng / 20 s. Con số 54 tool nhà máy lấy theo đề bài, **tôi chưa đếm lại**. Đây là chỗ duy nhất trong server có "kế hoạch" thật, và **nhánh lập trình không dùng nó**.

---

## 6. CLI và MCP (doc 83)

- **Chạy:** `npm run ai:cli -- --du-an repo` (REPL), `--lenh "<câu>"` (một lượt), `--liet-ke-du-an`, `--danh-sach-de-xuat`, `--duyet <id>`, `--nguoi-dung`. Lệnh trong REPL: `/thoat` `/quit` `/exit` `/duan`. Mật khẩu chỉ nhập qua dấu nhắc ẩn hoặc biến môi trường (`danhTinhCli.ts`), không qua cờ.
- **Bản chất:** CLI chỉ là một màn hình. `cauNoiCli.chayLuot` (:153) gọi đúng `streamAnswer(codingMode:true)`, nên có **cùng năng lực và cùng giới hạn** với web. HITL ở terminal là thật: không có cờ `--yes`, có census AST. `hoiTuoi` vứt các phím gõ sớm ở dấu nhắc duyệt. Ctrl+C không có xử lý riêng (không có `SIGINT` trong `cli.ts`), Node mặc định giết tiến trình.
- **MCP:** `npm run ai:mcp` là JSON-RPC stdio tự viết, 0 gói mới, protocol `2025-06-18`. Có 6 tool như bảng ở mục 3. Danh tính lấy từ `AVI_MCP_USER`/`AVI_MCP_PASSWORD`. **Không có tool duyệt**, tool ghi chỉ tạo đề xuất. Mục đích: cắm Claude Code/Cursor **trên máy phát triển**. Tự tài liệu nói rõ nó vô dụng ở nhà máy vì không có internet.
- [ĐO] `npx vitest run server/services/aiLocalTools/codingToolLoop.test.ts server/services/aiCodingCli/mcpGiaoThuc.test.ts server/services/aiCodingTuTriGhi.test.ts` → **3 tệp, 53/53 xanh**, 11,7 s (2026-10-14 22:04).

---

## 7. (e) Điểm hoàn thiện

- **Phủ năng lực**, 21 mục ở bảng mục 4, chấm 0 / 0,25 / 0,5 / 0,75 / 1, trọng số bằng nhau: **11,75/21 = 56 %**.
- **Có trọng số**, nhân trọng số cho các năng lực lõi agentic: vòng tự chủ ×3, sửa nhiều tệp ×2, terminal ×2, diagnostics ×1,5. Kết quả **14,0/25,5 = 55 %**.
- **Hiệu chỉnh theo kết quả:** bài agentic nhiều tệp duy nhất có số đo (A2) đạt ≈ 44 %. Các tác vụ kiểu "tính năng nhiều tệp" thì không có đường đi, nên coi như ≈ 0 % theo cấu tạo.
- ⇒ **≈ 50 %** (dải 45–56 %). Nền an toàn và sinh mã một lượt đạt mức sản phẩm. Phần "tự chủ" mới khoảng một nửa.

Theo mục tiêu sản phẩm:
- **(1) Trình duyệt:**
  - Tự sinh code: **mạnh** [TL: H 86 %, 20/21].
  - Quản lý dự án: **một phần** (danh sách trắng + phiên + bài học; không tạo được dự án mới, không có task).
  - Đủ công cụ: **thiếu** (5 tool lập trình, không xoá/đổi tên/git ghi/kế hoạch).
  - Trí nhớ: **khá** (phiên + 8 lượt + bài học tự khai).
- **(2) Extension VSCode:** vòng agent của extension chạy phía client, thuộc tầng 7. Server cấp `/v1/chat/completions` có tool gốc (`openaiGateway.ts`) và MCP server. Tầng 6 server **không** cấp vòng agent cho extension: `route:"vscode"` cố ý bỏ qua vòng tool vận hành (`aiLocalKnowledgeVongTool.ts`).

---

## 8. (f) Số đo sống đã có trong tài liệu [TL]

| Số đo | Giá trị | Nguồn |
|---|---|---|
| Trục H (đường sản phẩm), bộ khó 12×3, Qwen3.6-35B-A3B, ctx 64k | **31/36 = 86 %**, 28,3 s/bài; lần sau 30/36 = 83 % | `docs/superpowers/audits/2026-09-21-ai-local-lap-trinh-audit.md` dòng 902-908, 1068 |
| Trục M (model thuần) cùng model, nghĩ bật 16k | 30/36 = 83 %, 0 cụt | `scripts/ai-eval/codegen-chay-duoc/README.md` |
| Ba dự án thật | **20/21 hiện vật**, 0/14 thực thể thiếu, 23–34 s/dự án | audit dòng 784; plan 2026-09-22 dòng 24 |
| Agentic G6 ban đầu | A1 3/3 (~2,9 s), A2 3/3 (~11,6 s), dừng ở lượt 2/3 | audit Phụ lục 4, dòng 472-484 |
| **A2 tỉ lệ thật** | **≈ 12/27 = 44 %**; cần ≥12 lượt mới làm cổng được | audit dòng 1076; `reports/2026-09-23-bao-cao-tien-do-ai-local-toan-dot.md:75`; `reports/2026-09-24-xu-ly-viec-con-mo-ai-local.md:117` |
| B4 `--reasoning-budget 12000` | G5-D 3/6 → 0/12; agentic 5/6 ×2 | plan 2026-09-22 dòng 123-136 |
| B6 phủ quyết tool | Từ chối đúng 0,5 → 1,0 (held-out); model được hỏi 7/38 ca; ~0,7 s/lần; agentic 6/6 khi bật, 5/6 khi tắt | `ai/phuQuyetToolNative.ts` header; plan dòng 169, 198 |
| Vòng đọc: câu "đọc server/routers.ts" | 0 lượt model thêm (cổng mở đường) | `index.ts:393-399` (lời khai trong mã, lưới `codingToolLoop.test.ts` §6) |

**Tôi đo được** trong lượt này [ĐO]:
- vitest 53/53 xanh (mục 6).
- Cờ trong `.env` (mục 5 P1-8).
- Danh sách trắng 11 khuôn.
- Không có tool xoá/đổi tên/git ghi/web/todo/subagent.
- Vòng tự trị không đọc `signal` và không có trần đồng hồ.

Tôi **không** chạy đo sống trên :3000/:8091, đúng theo ràng buộc.
