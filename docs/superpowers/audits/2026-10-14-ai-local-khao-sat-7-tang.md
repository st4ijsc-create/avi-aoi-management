# Khảo sát AI Local theo 7 tầng — độ hoàn thiện so với mục tiêu (2026-10-14)

Nhánh `feat/ai-local-L7-hang-rao` @ `8be43f65a`. Khảo sát chỉ-đọc, 6 nhánh song song + kiểm chéo bằng tay các
khẳng định P0. Báo cáo gốc của từng nhánh (chưa biên tập, có file:line đầy đủ) ở `2026-10-14-ai-local-phu-luc/`.
Kế hoạch hoàn thiện: `docs/superpowers/plans/2026-10-14-ai-local-hoan-thien-7-tang.md`.

Nhãn bằng chứng: **[ĐO]** quan sát sống hôm nay · **[MÃ]** đọc mã · **[GHI]** số đo cũ trong repo, chưa đo lại ·
**[SUY]** suy luận chưa kiểm.

## 1. Mục tiêu dùng để chấm

1. **AI Local trên trình duyệt** tự sinh code được, quản lý được dự án, có đủ công cụ để thông minh hơn, có trí nhớ.
2. **Extension VSCode** hoạt động như Claude Code / GitHub Copilot và sửa trực tiếp dự án trong VSCode.

## 2. Kết luận

- **Phần an toàn và đo lường rất chắc; phần tự chủ thì hẹp.** Mọi lượt ghi qua người duyệt, hộp cát, rào tệp bẩn,
  sổ kiểm toán WORM, bộ đo hai trục M/H. Nhưng **không có vòng agent tổng quát**: server chia câu hỏi bằng regex vào
  6 đường ống cố định; extension chỉ có vòng đọc 3 lượt. Một yêu cầu như *"thêm tính năng X qua 3 tệp, build, sửa
  tới khi xanh"* hiện không có đường nào làm trọn — ở cả trình duyệt lẫn VSCode.
- **Chất lượng sinh mã của model đã tốt** (trục H 83–86 % bộ khó [GHI]); thứ thiếu nằm ở tầng 5–7: ngữ cảnh cho dự án
  ngoài repo chính, công cụ, vòng lặp, trí nhớ tự động, và giao diện cho vòng đời dự án.
- **Hạ tầng đang KHÔNG phục vụ** [ĐO]: llama-server :8091 không chạy, không có gì tự khởi động lại, app lùi im lặng
  sang nạp in-process (`/api/health/ai` = `down`). Từ 2026-09-24 không có commit AI nào; số đo nền đã 3 tuần tuổi.

| Mục tiêu | Mức hiện tại | Nút thắt chính |
|---|---|---|
| 1. Trình duyệt | **≈ 50 %** | Không có vòng agent; dự án do admin tạo; không cài phụ thuộc/chạy/preview/commit; trí nhớ 0 hàng |
| 2. VSCode | **≈ 33 % độ phủ** (khả năng sửa dự án thực tế ≈ 15–25 % [SUY]) | Chat không sửa được tệp; 1 tệp/lượt, không tạo tệp; kết quả lệnh không về model; không ghost-text |

## 3. Điểm theo tầng

| Tầng | Điểm | Mạnh | Khoảng trống quyết định |
|---|---:|---|---|
| 1 Phần cứng | ~70 % | RTX 5090 32 GB, i9, 64 GB RAM, VRAM broker 30 tệp/51 test | 1 GPU đã kín VRAM ⇒ không song song; model trên SATA (nạp nguội 51 s); C: còn 3,9 GB |
| 2 Mô hình | ~70 % | Qwen3.6-35B-A3B (H 86 %), 4B fast, embed/rerank/VL | Không model code/agent riêng; FIM dùng bản **Instruct** 1,5B, chưa đo độ đúng; đường lùi Ollama trỏ model không tồn tại |
| 3 Engine | ~60 % | llama.cpp b9814, 64k, ngân sách nghĩ, tool-call gốc, prefix cache | **P0: server chết không ai dựng lại**, lùi in-process im lặng (TTFT 71 → 5.304 ms [GHI]); 1 slot FIFO; lệch `node-llama-cpp` 3.19.0 vs gói CUDA 3.18.1 |
| 4 API/cổng | ~65 % | **`/v1` tương thích OpenAI có thật** (chat stream + tools + reasoning, completions + FIM, embeddings), 221/221 test [ĐO] | Không ưu tiên hàng đợi; đổi model = sửa 3 khoá `.env` + restart; một khoá dùng chung, CORS `*`; extension không dùng `/v1` |
| 5 Ngữ cảnh & trí nhớ | ~40 % | Ngữ cảnh mã 4k cho repo chính (86 % vs 75 %); phiên lưu DB (43 phiên) | **Dự án khác repo chính nhận 0 ngữ cảnh mã** (`codingRepoContext.ts:416` `khac-goc`); index chỉ cron đêm; không symbol/LSP; **bài học 0 hàng**; không đọc AGENTS.md/CLAUDE.md; không tóm tắt lịch sử |
| 6 Agent | ~50 % | Tool đọc/ghi có HITL, 11 khuôn lệnh, vòng tự trị có kill-switch, MCP server, CLI | **Định tuyến regex, không vòng model-gọi-tool**; ghi kết thúc vòng; không xoá/đổi tên, không git commit/nhánh, không kế hoạch/todo, không checkpoint; A2 ≈ 44 % [GHI] |
| 7a Trình duyệt | ~50 % | Cây tệp, tab, tìm/thay, chat stream, duyệt diff hunk, thanh trạng thái 9 ô, i18n 449/449 | Kỹ sư không tạo/mở được dự án; không `npm install`/chạy app/preview; không git commit; không bộ chọn chế độ; không màn trí nhớ |
| 7b Training Studio | ~42 % | Nạp pdf/docx/md/ảnh/URL, OCR Việt 0,979, eval thật 43 lượt, hồ sơ model | **Corpus không tới đường sinh mã** (web + extension SERVER); 0 phản hồi 👍👎; eval chỉ đo truy hồi, không đo mã; LoRA trơ; job đồng bộ, không huỷ |
| 7c Extension VSCode | ~33 % | Quyền 3 mức chặn tại điểm ghi duy nhất, MCP client, 965/965 test [ĐO], bản cài khớp mã nguồn [ĐO] | Xem §6 |

Cách tính từng điểm ở phụ lục tương ứng (trọng số × độ phủ; bậc có mã 0,25 → nối dây 0,5 → có lưới 0,75 → đo sống 1,0).

## 4. Phát hiện chéo tầng (cùng một gốc xuất hiện ở nhiều nơi)

1. **Thiếu một lõi agent dùng chung.** Trình duyệt (6 đường regex), extension (vòng đọc văn bản 3 lượt, giao thức
   ```` ```avi-tool ```` tự chế), CLI (gọi lại hàm của web) — ba bề mặt, không bề mặt nào có vòng *model gọi tool →
   quan sát → gọi tiếp*. Nền móng thì đã có: tool-calling gốc đo chạy được (B6), `/v1` có `tools`, cửa thực thi tool
   duy nhất, rào duyệt, audit. Đây là việc có đòn bẩy lớn nhất của cả bản kế hoạch.
2. **Ba kho trí nhớ rời nhau, cả ba gần rỗng.** Bài học server (0 hàng, chỉ ghi khi gõ "nhớ giùm:"), bộ nhớ extension
   (`workspaceState`, AI đề xuất nhớ 0/5 [GHI]), CLI không nhớ. Không nạp tệp quy ước dự án. "Có trí nhớ" hiện bằng 0
   trên thực tế.
3. **Tri thức nạp vào không tới chỗ cần.** Corpus Studio (csharp-dotnet 964 đoạn), tài liệu hãng 125k đoạn — đường
   sinh mã rẽ đi trước `retrieveKnowledge` (`aiLocalKnowledgeService.ts:3508`). Cách nối "top‑K theo câu hỏi" đã bị số
   bác (0/12 [GHI]); cần tra theo ký hiệu trong mã nháp hoặc một tool tra tài liệu trong vòng agent.
4. **"Dự án bất kỳ" chưa có thật.** Ngữ cảnh mã chỉ cho repo chính; dự án mới chỉ nhận ≤24 tên mục gốc. Tạo dự án
   cần admin + 2FA + thư mục có sẵn; scaffold ghi vào gốc của dự án *đang chọn* (dễ đổ nhầm vào repo chính).
5. **Không có điểm quay về trong khi tự ghi đang bật** [ĐO `.env`]: `AI_CODING_TU_TRI_GHI=1`, `AI_CODING_AUTOLOOP=1`,
   danh sách dự án gồm cả repo chính. Hoàn tác chỉ có lượt áp cuối của một tệp; không checkpoint, không commit.
6. **Vận hành một máy một slot.** Server model chết không tự dựng lại; một lượt agent dài chặn trợ lý vận hành
   20–24 s [GHI]; đổi model đòi restart hai tiến trình. Một vòng agent nhiều lượt sẽ làm điều này nặng thêm.

## 5. Trình duyệt — hành trình "từ mô tả → dự án chạy được"

| Bước | Trạng thái |
|---|---|
| 1 Có chỗ chứa dự án | ⚠ chỉ admin + 2FA, thư mục phải có sẵn |
| 2 Scaffold | ⚠ phải gõ đúng cụm từ, ≤ 8 tệp |
| 3 Duyệt ghi | ✅ cả lô |
| 4 Cài phụ thuộc | ❌ không có `npm install`/`pip install`; `dotnet restore` tắt |
| 5 Build/test | ⚠ chỉ khi bước 4 làm ngoài trình duyệt |
| 6 Tự sửa tới khi xanh | ✅ một tệp/lượt, trần 3 lượt |
| 7 Chạy app / preview | ❌ |
| 8 Commit / nhánh | ❌ |

Hai lỗi hiển thị [ĐO]: khối đầu ra lệnh bị gắn nhãn "Mã do model viết"; cột số dòng hiện "1" ở mọi dòng.
Tìm toàn repo chính bị cắt vì hết giờ ("mới quét 5465 tệp") — agent dùng cùng cơ chế nên có thể "không thấy" mã có thật.

## 6. Extension VSCode — so với Copilot / Claude Code

| Năng lực | Copilot | Claude Code | AI Local |
|---|---|---|---|
| Ghost-text | Có | — | **Không** (server đã có FIM `/v1/completions`) |
| Sửa nhiều tệp / tạo / xoá / đổi tên | Có | Có | **Không** — 1 tệp đã có/lượt (`apBanVa.ts:86`) |
| Chat đề xuất sửa | Có | Có | **Không** ở chế độ LOCAL: lời dạy chỉ có 3 tool đọc (`dayGiaoThucDoc.ts:95-125`) |
| Chạy lệnh → đọc kết quả → lặp | Có | Có | Chạy được, **kết quả chỉ hiện cho người** (`bangChat.ts:1960-1978`) |
| Diagnostics / @symbol / @workspace / git diff | Có | Có | Không |
| Duyệt theo hunk / checkpoint | Có | Có | Không — diff toàn tệp, tab riêng |
| Markdown, nút áp dụng khối mã | Có | Có | Không — text thuần |
| Tệp chỉ dẫn dự án / slash | Có | Có | Không |
| Chế độ quyền | Có | Có | **Có, chặt hơn** |
| Offline on-prem + sổ kiểm toán server | Không | Không | **Có — lợi thế riêng** |

Kênh model sai [ĐO]: chế độ LOCAL đi đường hỏi-đáp tri thức (`codingMode:false`) — prompt "chỉ trả lời dựa trên ngữ
cảnh", trần **900 token**, tắt nghĩ, giao thức văn bản thay vì tool-calling gốc ⇒ [SUY] không viết lại được tệp dài
hơn ~2,5k ký tự. Rủi ro [SUY, cần kiểm]: server che bí mật trong câu hỏi (`password: '…'` → `[REDACTED_SECRET]`); Cmd+K
trên đoạn chứa chuỗi ấy có thể đề xuất ghi lại bản đã che xuống tệp thật — chỉ người duyệt diff đỡ.
Extension đứng yên từ 2026-09-06; số đầu-cuối 6/11 [GHI 09-04] đã cũ so với server hiện tại.

## 7. Training Studio — có làm AI lập trình thông minh hơn không?

Rất ít, và chỉ qua một cửa (extension chế độ LOCAL, truy hồi csharp-dotnet 9/10 [GHI], chưa đo mã có tốt hơn).
- Đường sinh mã trên trình duyệt và extension SERVER **không đọc corpus** [MÃ].
- Cải tiến lập trình duy nhất có số (bổ sung `using` C#, 21 → 34/35 [GHI]) không đến từ Studio.
- 0 phản hồi, 0 bài học, diff duyệt/bác (594 / 15 [ĐO]) không thành dữ liệu ⇒ không có vòng học từ dùng thật.
- Eval Studio chỉ đo truy hồi; từ chối đúng câu ngoài corpus **12/32 = 37,5 %** [ĐO lượt #43]; nhiễu cùng miền lọt
  ngưỡng 0,44 ở 20/32 câu.
- LoRA trơ (không `LLM_FINETUNE_CMD`, không `peft`, llama-server không `--lora`); kết luận G9 "chưa làm LoRA" vẫn đúng.

Chấm như một ống nạp tri thức cho hỏi đáp vận hành thì Studio ~70 %; điểm 42 % là so với mục tiêu lập trình.

## 8. Tài sản nên giữ và dùng lại

- Bộ đo `scripts/ai-eval/codegen-chay-duoc/` (bộ khó 12×3, `agentic.mjs`, `duan.mjs`, hai trục M/H) — mọi đợt
  của kế hoạch dùng nó làm cổng ra.
- `/v1` tương thích OpenAI (tools, reasoning, FIM) — nền cho ghost-text và cho agent phía extension.
- Hàng rào ghi: `apBanVa` (extension, điểm ghi duy nhất), `confirmAction` + audit (server), mức quyền, allowlist argv.
- Hạ tầng nạp: OCR Việt, kiểm sau nạp, eval chỉ-ghi-thêm, bộ vàng 111 câu.

## 9. Đo được hôm nay (để đối chiếu sau)

| Mục | Giá trị |
|---|---|
| llama-server :8091 | không chạy; VRAM 2.054/32.607 MiB |
| `/api/health/ai` | `down`, `textGeneration: degraded … in-process` |
| Test extension | 64 tệp, 965/965 · `tsc` sạch |
| Test gateway/resolver | 13 tệp, 221/221 |
| Test L5 / L6 / Studio | 138/138 · 53/53 · 108/108 |
| `ai_coding_lessons` · `kb_answer_feedback` | 0 · 0 |
| `ai_coding_sessions` | 43 phiên, 3 người, dài nhất 35 lượt |
| `kb_chunks` (pgvector) | 0 — `KB_PGVECTOR_ENABLED=false` |
| Kho truy hồi hệ thống | 7.670 chunk, dựng 2026-10-13 20:00Z (cron) |
| i18n trang lập trình | 449 khoá, thiếu 0 |

## 10. Giới hạn của khảo sát

- Không đo sống được đường sinh mã/agent vì llama-server chết; phần ấy dựa trên mã + số đo cũ.
- Không thử tài khoản admin; không cài/chạy extension trong VSCode thật (luật repo: `test-that` mở cửa sổ thật).
- Máy không cài Copilot — cột Copilot dựa trên kiến thức sản phẩm.
- Điểm % là đánh giá có trọng số [SUY]; số đầu vào là [ĐO] hoặc [GHI].
