# Khảo sát AI Local — TẦNG 5: Ngữ cảnh & truy xuất + TRÍ NHỚ

Ngày 2026-10-14 · repo `D:\SOURCES\avi-aoi-management` · nhánh `feat/ai-local-L7-hang-rao` · CHỈ ĐỌC.

Ký hiệu: **[ĐO]** = số đo trong phiên này (DB/HTTP/vitest/đếm tệp) · **[MÃ]** = đọc mã, có file:dòng · **[GHI]** = số đo do phiên trước ghi trong mã/memory, không đo lại · **[SUY]** = suy luận chưa kiểm.

---

## 0. Phép đo đã chạy (lệnh + kết quả)

| Phép đo | Kết quả |
|---|---|
| `SELECT count(*) FROM ai_coding_lessons` (node + postgres.js, user lấy từ `.env`) | **0 hàng**, 0 người dùng [ĐO] |
| `ai_coding_sessions` | **43 phiên**, 3 người dùng, 171 lượt tổng, phiên dài nhất 35 lượt, mới nhất 2026-09-25 [ĐO] |
| phiên theo dự án | `repo` 28 · `csharp` 13 · `react` 1 · `demo-project` 1 [ĐO] |
| `ai_repo_du_an` (dự án admin đăng ký qua UI) | 1 hàng (`demo-project`) [ĐO] |
| `kb_chunks` (kho pgvector tri thức hệ thống) | **0 hàng** — `KB_PGVECTOR_ENABLED=false`, kho thật là jsonl [ĐO] |
| `kb_studio_chunks` | 1.129 (csharp-dotnet 964 · st4i-may-aoi 159 · rác thử nghiệm 6) [ĐO] |
| `kb_answer_feedback` | 0 [ĐO] |
| `program_symbols` (bảng symbol duy nhất) | 0 — là symbol PLC (address/dataType), không phải symbol mã nguồn [ĐO] |
| bảng tên `%memory%` | chỉ `ai_anomaly_memory_bank` (thị giác, không liên quan) [ĐO] |
| pgvector extension | có, v0.8.4 [ĐO] |
| `GET :3000/api/ai/local-kb/health` | ready, 7.670 chunk / 7.670 embedding, Qwen3-Embedding-0.6B-f16, kbBuiltAt 2026-10-13T20:00Z, staleDays 0 [ĐO] |
| `knowledge/chunks.jsonl` theo gốc `sourcePath` | server 3.129 · docs 2.707 · knowledge 960 · client 428 · apidocs 200 · drizzle 216 · shared 30 · **sandbox-projects 0** [ĐO] |
| tệp mã khác nhau có chunk (server/client/shared) | 2.858 đường dẫn (gồm cả tệp test) [ĐO] |
| hình dạng chunk mã | TÓM TẮT: `"Service file: …\nExported functions: …\nLocal imports: …"`, trung vị 173 ký tự — KHÔNG có thân hàm [ĐO] |
| `knowledge/programming/manifest.json` | 124.990 chunk (delta 38.430 · mitsubishi 46.052 · omron 21.969 · fanuc 11.908 · zmotion 4.164 · UR 2.467), 2,8 GB trên đĩa, nhúng trong RAM (brute-force) [ĐO] |
| `npx vitest run codingRepoContext.test.ts codingLessonContext.test.ts aiCodingLesson.stream.test.ts` | **3 tệp · 138/138 xanh**, 7,8 s [ĐO] |
| Grep `AGENTS.md|CLAUDE.md|copilot-instructions|.cursorrules` trong server/vscode-extension/client/shared | **0 kết quả** [ĐO] |
| Grep `executeDefinitionProvider|executeWorkspaceSymbolProvider|executeReferenceProvider` trong extension | **0** (không dùng LSP) [ĐO] |
| Grep `tomTat|summariz|compact` trên đường lịch sử | 0 cơ chế tóm tắt/nén lịch sử [ĐO] |

Không có log ứng dụng của :3000 trên đĩa (`logs/` chỉ có log llama-server) ⇒ **không đo được tỉ lệ `lyDo` của `thuThapNguCanhMa` trên lưu lượng thật**.

---

## 1. Dự án MỚI người dùng mở — model nhận được gì?

### 1a. Web `/ai-coding-workspace` (và CLI/MCP, cùng hộp cát server)
- Dự án phải nằm trong **danh sách trắng**: `AI_REPO_SANDBOX_ROOTS` trong `.env` (hiện 3: repo, csharp, react) hoặc admin + 2FA đăng ký qua `repoWorkspace.themDuAn` → bảng `ai_repo_du_an`, trần 20 mục DB (`repoProjects.ts:296`) [MÃ]. Người dùng thường **không tự mở** được dự án bất kỳ.
- Ngữ cảnh TỰ ĐỘNG mỗi lượt:
  1. `nguCanhDuAnChoPrompt` = tên dự án + ≤24 mục thư mục gốc (`aiLocalKnowledgeCoding.ts:933-955`) [MÃ].
  2. `thuThapNguCanhMa` (ngữ cảnh mã thật ≤4.000 token, ≤3 tệp × 12 KB) — **CHỈ cho repo chính**: cổng `chiMucKhopGoc` (`codingRepoContext.ts:303-308, 416`) so gốc dự án với `process.cwd()`; khác gốc ⇒ `"khac-goc"` ⇒ **khối rỗng**. Lý do: `knowledge/chunks.jsonl` chỉ mô tả repo chính (0 chunk sandbox-projects [ĐO]).
  3. Bài học (nếu có hàng — hiện 0) ≤3 bài/lượt.
  4. Lịch sử ≤8 lượt.
- ⇒ Với dự án csharp/react/dự án mới: **không có ngữ cảnh mã tự động nào**, chỉ 24 tên mục gốc. Model chỉ thấy mã nếu (a) người dùng @-mention/nêu đường dẫn ⇒ bộ chọn tất định gọi `read_file`, hoặc (b) vòng tool LLM (≥ vòng 2 chỉ `read_file/grep_repo/list_files`, `aiLocalTools/index.ts:362-471`) tự quyết đi đọc [MÃ].
- [SUY] Đơn sinh mã trên dự án không phải repo chính tương đương cấu hình "ngữ cảnh 0" đã đo 75 % (so 86 % có ngữ cảnh) [GHI `codingRepoContext.ts:162-172`] — chưa đo trực tiếp trên csharp.
- Không có index tự động khi đăng ký dự án: `kb:sync` (`extract-codebase-knowledge.mjs`) chạy với `ROOT = process.cwd()` cố định, cron 03:00 [MÃ `kbSyncScheduler.ts`]. Script có đuôi .cs/.py/.java… nhưng bộ trích router/service/type là regex TS/tRPC [GHI script dòng 12-23].
- Giới hạn kích thước [MÃ `repoSandbox.ts:263-327`]: 64 KB/tệp đọc · **4 MiB / 15 phút / phiên** byte ra khỏi hộp cát · list ≤300 mục, độ sâu ≤12 · grep quét ≤9.000 tệp, ≤80 kết quả. Repo lớn hơn 9.000 tệp ⇒ grep báo "MỘT PHẦN".

### 1b. Extension VSCode
- **Chế độ LOCAL** (workspace bất kỳ trên máy — đây là con đường duy nhất thực sự "dự án bất kỳ"): ngữ cảnh tự động = **tệp đang mở + đoạn đang chọn**, trần 24.000 ký tự (`ui/bangChat.ts:634-663`, `loi/nguCanh.ts:149-207`), che bí mật, chặn tệp nhạy cảm. `dsTep` (danh sách tệp) có trong kiểu nhưng **không nơi gọi nào truyền** [MÃ]. Model tự đọc thêm bằng giao thức `avi-tool` (`doc_tep`/`liet_ke`/`grep`, chạy cục bộ qua `vscode.workspace.findFiles`, 64 KB/tệp, 200 kết quả grep) [MÃ `loi/docCucBo.ts:49-55`]. Không index, không embedding, không LSP.
- **Chế độ SERVER**: chỉ dự án trong danh sách trắng, y như 1a.

---

## 2. Truy xuất mã

| Cơ chế | Có? | Chi tiết |
|---|---|---|
| grep | Có | `grep_repo` server: duyệt JS thuần, regex, hạn giờ, trần 9.000 tệp; `nhanXetChiThayDinhNghia` phân biệt dòng khai báo vs điểm gọi (`repoReadTools.ts:373-392`) [MÃ]. Extension: `grepThuan` cục bộ. |
| tên tệp | Có | `list_files` (đệ quy ≤12), @-mention (web `AICodingWorkspace.tsx:151,1141`; extension `locMention.ts`) — lọc chuỗi con, không fuzzy ngữ nghĩa [MÃ]. |
| embedding | Một phần | Chỉ repo chính; embed **chunk TÓM TẮT** (exports/imports), không embed thân mã; dùng để CHỌN TỆP rồi đọc byte thật (pha A kho mã + pha B mót đường dẫn trong tài liệu, xen kẽ) [MÃ `codingRepoContext.ts:456-489`]. Xếp hạng: hybrid cosine 0,72 + keyword 0,28 + trọng số nguồn + rerank gguf; ngưỡng 0,25 [MÃ]. Lưu `knowledge/embeddings.jsonl` 163 MB nạp vào RAM; pgvector có nhưng tắt [ĐO]. |
| symbol / AST / LSP | **Không** | `code-graph.json` = 9.087 cạnh import (regex), chỉ dùng trong `gatherRepoContext` khi có `files` [ĐO/MÃ]. Không có bảng symbol mã nguồn, không go-to-definition/find-references. |
| cập nhật khi tệp đổi | **Không (theo đêm)** | `kb:sync` incremental lúc 03:00 (lần gần nhất: thêm 64, đổi 54, bỏ 1 trong 12,6 s [ĐO `embeddings-meta.json`]). Tệp viết hôm nay không có trong mục lục tới sáng mai. Nội dung luôn đọc tươi từ đĩa (chỉ mục lục bị cũ). |

Ghi nhận kỹ thuật [GHI trong mã]: điểm câu TRÚNG đề và LẠC đề CHỒNG nhau (0,53–0,79 vs 0,52–0,68) ⇒ ngưỡng không lọc được chủ đề; "cộng hai số" từng kéo `phamViCanh.ts` vào prompt (`codingRepoContext.ts:610-612`). Vẫn giữ vì ablation 0/4k/8k = 75/86/75 %.

Lỗi nhỏ phát hiện [MÃ]: nhánh `khac-goc` (`codingRepoContext.ts:416`) trả rỗng **không ghi log**, trái docblock "LUÔN ghi một dòng log kết cục" (dòng 403-405) ⇒ trên dự án csharp/react, tính năng tắt im lặng.

---

## 3. Trí nhớ

### Ngắn hạn (trong phiên)
- Server đường lập trình: client gửi `history`; tuyến cắt 12 (`aiLocalKnowledgeApi.ts:51`), đường lập trình cắt tiếp **8 lượt × 2.400 ký tự**, che bí mật trước khi cắt, nhường chỗ từ lượt cũ nhất theo ngân sách token đo trên chuỗi thật (`aiCodingAgent.ts:1621-1716`) [MÃ]. **Không tóm tắt/nén** — lượt thứ 9 trở về trước biến mất hẳn [ĐO grep].
- Thứ tự nhường chỗ: lịch sử → ngữ cảnh mã → bài học → (không bao giờ) prompt gốc (`aiLocalKnowledgeCodingSinhMa.ts:155-252`) [MÃ].
- Extension: lịch sử trong bộ nhớ bảng chat, gửi kèm mỗi câu; CLI: mảng trong RAM (`cli.ts:477`), mất khi thoát [MÃ].

### Trung hạn (lưu phiên, mở lại)
- Web: bảng `ai_coding_sessions` (mig 0333), chỉ chủ phiên đọc được, `turns` chỉ `{role,content}`, trần 400 KB/phiên; UI `BoChonPhien` + `danhSachPhien/moPhien/luuPhien/xoaPhien` (`repoWorkspaceRouter.ts:866-935`) — **43 phiên thật** [ĐO] ⇒ dùng thật.
- Mở lại phiên = nạp lại `turns` lên client; lượt kế chỉ gửi 8 lượt cuối ⇒ phiên 35 lượt mất ngữ cảnh đầu [SUY từ mã].
- Thẻ tool không lưu; chân nguồn "tệp đã nạp" nhét vào `content` để sống qua reload (`codingRepoContext.ts:575-579`) [MÃ].
- Extension: `workspaceState` khoá `aviAiLocal.hoiThoai`, 50 hội thoại, 500 k ký tự (`khoHoiThoai.ts:56-68`) [MÃ].
- CLI/MCP: **không lưu phiên** [MÃ].

### Dài hạn
- **Bài học server** (`ai_coding_lessons`, mig 0336): ghi CHỈ khi người dùng gõ `nhớ giùm:`/`remember:`; làm sạch qua `aiSafety`; 200 bài/(người×dự án); ≤3 bài/lượt chọn tất định không embedding; nối vào MỌI nhánh lập trình (sinh mã, sửa, sửa lô, tạo khung, tự trị) (`aiLocalKnowledgeCoding.ts:455-469, 494-815`) [MÃ]; lưới 138/138 [ĐO]. **0 hàng trong DB** [ĐO]; 0 phiên có cụm "nhớ giùm" [ĐO] ⇒ tính năng có dây nhưng **chưa ai dùng, không có cửa tự động**.
- **Bộ nhớ extension** (`khoBoNho.ts`): `workspaceState`, 200 mục; nguồn chỉ "người dùng bảo nhớ" hoặc "AI đề xuất + duyệt"; chỉ chèn ở chế độ LOCAL và **chỉ khi đã có ≥1 mục** (`dayBoNhoDoc.ts`, `yeuCau.ts:131-134`) [MÃ]. Đề xuất `de_xuat_nho` của model đo **0/5** [GHI memory extension F/G/H] ⇒ cửa AI-đề-xuất trên thực tế chết.
- **Hai kho nhớ tách rời**: bài học server (DB, theo user×projectId) và bộ nhớ extension (workspaceState, theo máy×workspace) không đồng bộ; extension chế độ SERVER không nhận bộ nhớ cục bộ; web không thấy bộ nhớ extension [MÃ].
- **Tệp quy ước dự án** (CLAUDE.md / AGENTS.md / copilot-instructions.md / .cursorrules): **không có cơ chế nạp** [ĐO grep 0].
- **Sở thích người dùng xuyên dự án**: không có (bài học khoá theo dự án, bộ nhớ extension theo workspace) [MÃ].
- **Tự trích bài học** từ lượt sửa thất bại / thẻ duyệt bị từ chối / lỗi build: không có [MÃ — cửa ghi duy nhất là `bocYDinhBaiHoc`].

---

## 4. RAG tài liệu có phục vụ sinh mã không?

| Đường | Kho tài liệu dùng | Bằng chứng |
|---|---|---|
| Web `/ai-coding-workspace` (codingMode) | **Không dùng** kho hãng hay Studio. `streamAnswer` rẽ sang `streamCodingAnswer` TRƯỚC `retrieveKnowledge` (`aiLocalKnowledgeService.ts:3505-3511`). Pha B có gọi `retrieveKnowledge` nhưng VỨT văn bản, chỉ mót đường dẫn. Vòng tool lập trình chỉ có 3 tool đọc repo. | [MÃ] |
| Extension LOCAL (route `vscode`) | Có: `retrieveProgrammingKnowledgeForVscode` → `searchProgrammingKb` (125k chunk 6 hãng PLC/robot, lọc theo hãng nêu tên) + gộp Studio (`aiLocalKnowledgeService.ts:2687, 2822`) | [MÃ] |
| Copilot PLC/robot (`aiProgrammingCopilot.ts:1111`, tool `retrieve_programming_kb`) | Có, trích trang tài liệu | [MÃ] |
| Corpus `csharp-dotnet` (964 đoạn API .NET) | Chỉ trả lời hỏi đáp; **R2B "nối truy hồi API vào sinh mã" CHƯA làm** — đo trước đó: truy hồi theo câu hỏi trả 0/12 đoạn System.Data đúng cho ca D1 | [ĐO đếm] + [GHI memory R1] |

⇒ RAG tài liệu phục vụ **hỏi đáp lập trình PLC/robot** và extension LOCAL; **không** phục vụ đường sinh mã web cho C#/TS/React.

---

## 5. Bảng tính năng

Cột: Mã = có mã · Dây = nối vào đường sản phẩm thật · Lưới = có test · Sống = đã đo trên hệ chạy thật.

| Tính năng | Mã | Dây | Lưới | Sống | Bằng chứng |
|---|---|---|---|---|---|
| Ngữ cảnh mã tự động (repo chính) | ✔ | ✔ | ✔ 54 ca | ✔ [GHI 86 % vs 75 %] | `codingRepoContext.ts:407-567`, `aiLocalKnowledgeCodingSinhMa.ts:140-153`, `…CodingSua.ts:629` |
| Ngữ cảnh mã tự động (dự án khác) | ✘ (cố ý fail-closed) | — | ✔ (ca khac-goc) | — | `codingRepoContext.ts:303-308,416` |
| Ngữ cảnh dự án tối thiểu (24 mục gốc) | ✔ | ✔ | ? | ✔ suy từ 13 phiên csharp | `aiLocalKnowledgeCoding.ts:933` |
| Index embedding mã | một phần (tóm tắt, repo chính) | ✔ | ✔ | ✔ health 7.670 [ĐO] | `knowledge/chunks.jsonl`, `repoContextService.ts:590` |
| Index symbol/AST/LSP | ✘ | ✘ | ✘ | ✘ | grep 0 |
| Cập nhật index khi tệp đổi | ✘ (cron đêm) | ✔ cron | ✔ | ✔ build 2026-10-13T20:00Z [ĐO] | `kbSyncScheduler.ts` |
| grep / list / read hộp cát | ✔ | ✔ | ✔ | ✔ [GHI] | `repoReadTools.ts`, `repoSandbox.ts` |
| Tool cục bộ extension (doc/liet_ke/grep) | ✔ | ✔ | ✔ | ✔ [GHI 10/11] | `mang/toolCucBo.ts`, `loi/docCucBo.ts` |
| Tệp đang mở + đoạn chọn (extension) | ✔ | ✔ | ✔ | ✔ | `bangChat.ts:634` |
| @-mention tệp | ✔ | ✔ | ✔ | ✔ [GHI] | `AICodingWorkspace.tsx:1141`, `locMention.ts` |
| Lịch sử ngắn hạn (8 lượt, cắt theo ngân sách) | ✔ | ✔ | ✔ | ✔ | `aiCodingAgent.ts:1688` |
| Tóm tắt/nén lịch sử dài | ✘ | ✘ | ✘ | ✘ | grep 0 |
| Lưu phiên + mở lại (web) | ✔ | ✔ | ✔ DB thật | ✔ 43 phiên [ĐO] | `aiCodingSession.ts`, `repoWorkspaceRouter.ts:866-935` |
| Lưu hội thoại (extension) | ✔ | ✔ | ✔ | chưa đo | `khoHoiThoai.ts` |
| Lưu phiên CLI/MCP | ✘ | ✘ | ✘ | ✘ | `cli.ts:477` |
| Bài học dài hạn server (thủ công) | ✔ | ✔ mọi nhánh | ✔ 84 ca | **0 hàng** [ĐO] | `codingLessonContext.ts`, `aiLocalKnowledgeCoding.ts:455-469` |
| Tự trích bài học | ✘ | ✘ | ✘ | ✘ | — |
| Bộ nhớ extension (thủ công + AI đề xuất) | ✔ | ✔ (LOCAL) | ✔ | đề xuất 0/5 [GHI] | `khoBoNho.ts`, `dayBoNhoDoc.ts` |
| Tệp quy ước dự án (AGENTS.md…) | ✘ | ✘ | ✘ | ✘ | grep 0 |
| RAG tài liệu hãng (PLC/robot) | ✔ | ✔ (vscode LOCAL, copilot PLC) | ✔ | ✔ [GHI 73/79 · 32/32 bộ vàng] | `aiProgrammingKnowledgeService.ts:504` |
| RAG tài liệu API (.NET) vào sinh mã | corpus có | ✘ | ✘ | ✘ | memory R1: R2B chưa làm |

---

## 6. Khoảng trống so với mục tiêu

### P0 — chặn trực tiếp mục tiêu
1. **Không có ngữ cảnh mã tự động cho dự án nào ngoài repo chính.** Vì sao chặn: mục tiêu "AI biết mã của BẤT KỲ dự án người dùng mở"; hiện csharp/react/dự án mới chỉ có 24 tên mục gốc, rơi về cấu hình đã đo kém hơn 11 điểm. Cần: index theo TỪNG dự án (gốc → chỉ mục riêng, khoá theo projectId), không theo `process.cwd()`.
2. **Không có index tự động khi mở/đăng ký dự án + không cập nhật khi tệp đổi.** Vì sao chặn: AI quản lý dự án phải thấy mã người dùng/AI vừa viết; hiện mục lục trễ tới 24 h và chỉ dựng bằng `kb:sync` toàn repo chính. Cần: indexer gia tăng theo băm tệp (cơ chế `embed-incremental` đã có) kích hoạt khi đăng ký dự án, sau mỗi `apply_diff`, và theo watcher/mtime.
3. **Trí nhớ dài hạn không tự động — 0 bài học sau 43 phiên.** Vì sao chặn: "có trí nhớ" thực tế = không; cửa duy nhất là câu thần chú người dùng phải biết; đề xuất của model 0/5. Cần: (a) nạp tự động tệp quy ước dự án (AGENTS.md / CLAUDE.md / .github/copilot-instructions.md) qua `read_file`; (b) cửa đề xuất bài học có duyệt, kích hoạt bằng SỰ KIỆN (thẻ duyệt bị từ chối kèm lý do, lỗi build lặp lại, người dùng sửa lại diff) chứ không trông vào model tự nhớ.

### P1 — hạ chất lượng rõ
4. **Index mã là TÓM TẮT exports/imports, không có symbol/định nghĩa/tham chiếu.** Model không hỏi được "hàm X định nghĩa ở đâu / ai gọi X" ngoài grep regex. Cần: bảng symbol (tree-sitter hoặc TS compiler API; với extension: `executeWorkspaceSymbolProvider`/`executeReferenceProvider` của VSCode — miễn phí cho mọi ngôn ngữ có LSP) + embedding theo hàm/khối thân mã.
5. **Lịch sử chỉ 8 lượt, không tóm tắt.** Phiên dài (đã có phiên 35 lượt) mất ý định ban đầu. Cần: tóm tắt cuộn (rolling summary) lưu cùng phiên.
6. **Hai kho nhớ tách rời + extension SERVER không nhận bộ nhớ + CLI không lưu phiên.** Cùng một người, cùng dự án, ba bề mặt nhớ ba thứ khác nhau. Cần: một kho nhớ server theo (user × dự án) mà web, extension (cả hai chế độ) và CLI cùng đọc/ghi.
7. **RAG tài liệu không vào đường sinh mã web** (corpus csharp-dotnet 964 đoạn nằm im cho sinh mã; R2B chưa làm). Đo trước đó chỉ ra truy hồi theo CÂU HỎI trượt; cần truy hồi theo KÝ HIỆU xuất hiện trong mã nháp (sinh → trích API dùng → tra → sửa).

### P2 — vệ sinh / quan sát
8. Nhánh `khac-goc` trả rỗng không log (`codingRepoContext.ts:416`) ⇒ tắt im lặng trên mọi dự án không phải repo chính.
9. Kho embedding nạp toàn bộ vào RAM (163 MB hệ thống + nhúng hãng đọc Buffer vì >512 MB/hãng); pgvector có sẵn (v0.8.4) nhưng `kb_chunks` = 0, `PROG_KB_PGVECTOR` "NOT implemented". Mở rộng ra nhiều dự án sẽ cần kho vector thật.
10. Ngưỡng 0,25 cho đoạn không liên quan vào prompt (đã ghi: "cộng hai số" ⇒ `phamViCanh.ts`); chấp nhận được vì có số đo, nhưng sẽ xấu đi khi index đa dự án.
11. Không có bằng chứng đo sống cho lưu hội thoại extension và cho tỉ lệ `lyDo` của ngữ cảnh mã (không có log ứng dụng trên đĩa).

---

## 7. Điểm hoàn thiện tầng 5 ≈ **40 %**

Cách tính: chia tầng 5 thành 6 năng lực, trọng số theo mức chúng quyết định mục tiêu (1)+(2); mỗi năng lực chấm theo mức "có mã → nối dây → có lưới → đo sống" và phạm vi (repo chính hay mọi dự án).

| Năng lực | Trọng số | Điểm | Lý do |
|---|---|---|---|
| A. Ngữ cảnh mã tự động cho dự án bất kỳ | 25 % | 35 % | Repo chính: đầy đủ + đo sống (86 %). Dự án khác: 0 tự động; extension LOCAL chỉ tệp đang mở. |
| B. Truy xuất mã (grep/tên/embedding/symbol, xếp hạng, độ tươi) | 20 % | 35 % | grep/list/read chắc; embedding chỉ tóm tắt + một repo; không symbol/LSP; cập nhật theo đêm. |
| C. Nhớ ngắn hạn | 10 % | 60 % | 8 lượt, cân ngân sách chuẩn, che bí mật; không tóm tắt. |
| D. Nhớ trung hạn (lưu/mở lại phiên) | 10 % | 75 % | Web DB thật 43 phiên; extension workspaceState; CLI không có. |
| E. Nhớ dài hạn (bài học, quy ước, sở thích) | 20 % | 25 % | Mã + dây + lưới tốt nhưng chỉ thủ công, 0 hàng; đề xuất 0/5; không tệp quy ước; hai kho rời. |
| F. RAG tài liệu phục vụ sinh mã | 15 % | 35 % | Phục vụ PLC/robot + extension LOCAL; không vào sinh mã web; corpus .NET chưa nối. |

Tổng = 0,25×35 + 0,20×35 + 0,10×60 + 0,10×75 + 0,20×25 + 0,15×35 = 8,75 + 7 + 6 + 7,5 + 5 + 5,25 = **39,5 ≈ 40 %**.

Điểm số là đánh giá có trọng số [SUY], các con số đầu vào ghi rõ [ĐO]/[GHI] ở các mục trên.
