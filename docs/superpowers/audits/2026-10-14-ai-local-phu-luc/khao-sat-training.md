# Khảo sát AI Local — ứng dụng TRAINING (`/ai-training-studio`) · 2026-10-14

Phạm vi: Training Studio (client + server), sidecar fine-tune, `tools/trainer`, `scripts/ai-kb`, `scripts/ai-eval`.
Đánh giá theo tầng 5 (ngữ cảnh/truy hồi), tầng 7 (giao diện) và vai trò với tầng 2 (mô hình: LoRA/fine-tune).
Chế độ: CHỈ ĐỌC. Không nạp, không chạy job/eval, không build, không restart.

Ký hiệu: **[ĐO]** = tôi tự quan sát hôm nay (SELECT, curl, vitest, Playwright). **[ĐỌC]** = đọc mã (file:dòng).
**[KHAI]** = số do báo cáo/commit cũ ghi, tôi chưa đo lại. **[SUY]** = suy luận của tôi.

---

## 0. Kết luận một đoạn

Training Studio hiện là một **ống nạp tài liệu → truy hồi** chạy thật, có thiết bị đo truy hồi tốt (eval vàng, kiểm sau nạp, lưu lượt chỉ-ghi-thêm).
Nó **không** làm mô hình học thêm gì: LoRA trơ (`LLM_FINETUNE_CMD` chưa khai, `peft` chưa cài, không có đường nạp adapter vào llama-server).
Đóng góp cho **AI lập trình** chỉ đi qua **một** cửa: trợ lý VSCode chế độ LOCAL (route `vscode`, `codingMode:false`).
Hai đường sinh mã chính đều **không bao giờ đọc kho Studio**: không gian lập trình trên trình duyệt và extension chế độ SERVER (`codingMode:true`).
Cải tiến lập trình duy nhất đã đo bằng số (bổ sung `using` C#, 21 → 34/35 khối biên dịch được) lấy dữ liệu từ `knowledge/api-ref/dotnet-using.json`.
Tệp đó do script sinh ra, **không đi qua corpus Studio**. Khi đo sống, cơ chế này kích hoạt 0/36 lượt.
Phản hồi từ phiên dùng thật **không được thu**: `kb_answer_feedback` = 0 hàng, `ai_coding_lessons` = 0 hàng, coding không có 👍/👎.
Diff được duyệt hoặc bác thì có lưu (594 executed / 15 bị từ chối ghi), nhưng không có đường xuất ra thành dữ liệu huấn luyện.
**Điểm hoàn thiện theo mục tiêu "AI lập trình thông minh hơn nhờ training": ≈ 42 %** (cách tính ở §5).

---

## 1. Trạng thái sống hôm nay [ĐO]

| Quan sát | Giá trị | Cách đo |
|---|---|---|
| :3000 | HTTP 200 | `curl` |
| llama-server :8091 | **không trả lời** (`/health` → 000) | `curl -m 5` |
| Tab "Hồ sơ model" sống | "Không liên lạc được llama-server (fetch)"; sổ đo 24 giờ: **5 lượt · 5 lỗi**, 0/5 có token nghĩ | Playwright (đã đăng nhập sẵn là kỹ sư "Anh Minh"); ảnh `ks-training-tab5-hoso.png` |
| Corpus (`kb_corpora`) | 5: `st4i-may-aoi` (159 đoạn/10 nguồn), `csharp-dotnet` (964/26), `so-tay-bao-tri-w2` (3), `task-v8-probe` (1), `task-v9-probe` (2, **0 job — "Chưa từng" nạp**) | SELECT + tab Corpus |
| `kb_ingest_jobs` | 86 (85 succeeded, 1 failed); 10/86 có `ketQuaMay`; job cuối **2026-09-24** | SELECT |
| `kb_eval_runs` | 43 lượt (#2–#44), lượt cuối **2026-09-24** | SELECT |
| Lượt eval mới nhất `st4i-may-aoi` #43 (111 câu: 79 trong / 32 ngoài) | trúng nguồn @5 **94,9 %** · MRR 0,869 · qua ngưỡng 0,44 **94,9 %** · đáp án trong ngữ cảnh 91,1 % · đường ống (tới trợ lý web) **64,6 %** · **từ chối đúng câu ngoài corpus chỉ 37,5 % (12/32)** | SELECT `tongHop` |
| Lượt eval mới nhất `csharp-dotnet` #26 (12 câu) | trúng nguồn 90 % · qua ngưỡng 90 % · đường ống 90 % · từ chối 2/2 | SELECT |
| `fake-bad` (corpus rỗng) #19/#27 | 0 % ở mọi ô của corpus (ô "mọi kho" 70–90 % là của kho hệ thống) | SELECT |
| `kb_answer_feedback` (👍/👎) | **0 hàng** (dù `.env` bật `KB_FEEDBACK_RERANK_ENABLED=true`) | SELECT |
| `ai_coding_lessons` (bộ nhớ xuyên phiên, doc 82) | **0 hàng** | SELECT |
| `ai_coding_sessions` | 43 | SELECT |
| `ai_pending_actions` | executed 594 · da_ap_client 39 · bi_tu_choi_ghi 15 · expired 39 · cancelled 9 | SELECT |
| `model_versions` có LoRA hoặc gguf | **0** | SELECT |
| `knowledge/chunks.jsonl`, `embeddings.jsonl`, `code-graph.json` | mtime **2026-10-14 03:00**: cron autosync có chạy hôm nay | `ls` |
| Python `peft` | **chưa cài** (`ModuleNotFoundError`) | `python -c import peft` |
| Commit chạm Studio sau 09-24 | 1 tính năng (`3cf50cedf` 09-25: Markdown có đoạn bổ sung) + 1 sửa script mig | `git log` |
| vitest mục tiêu | **12 tệp / 108 ca xanh** (lệnh dưới) | — |

Lệnh vitest (chỉ đọc, 2,2 s):
`npx vitest run server/services/kbStudioEvalCham.test.ts server/services/kbStudioGoldenTraLoi.test.ts server/services/aiLlmFinetuneSidecar.test.ts server/services/aiLocalKnowledge.studioMerge.test.ts client/src/components/kbStudio/`
Kết quả: `Test Files 12 passed (12) · Tests 108 passed (108)`.
Log có dòng: `[vram] "sidecar:llm-finetune" KHÔNG CÓ CĂN CỨ NÀO để ước lượng … Ước lượng = 0`, tức VRAM broker không có ngân sách cho fine-tune.

Ghi chú vận hành: Playwright MCP chỉ cho ghi ảnh vào `.playwright-mcp/` (thư mục này nằm trong `.gitignore:196`, các phiên khác dùng chung).
Tôi đã chuyển 3 ảnh của mình sang scratchpad: `ks-training-tab1-nguon.png`, `ks-training-tab4-eval.png`, `ks-training-tab5-hoso.png`.
Trình duyệt dùng chung đã có phiên đăng nhập sẵn, nên tôi chỉ bấm chuyển tab, không bấm nạp hay chạy.

---

## 2. Bảng từng tab / tính năng

Thang trạng thái: **có mã → nối dây → có lưới → đã đo sống**.

| # | Mục | Trạng thái | Bằng chứng |
|---|---|---|---|
| T1 | **Nguồn dữ liệu**: pdf/docx/md/txt + ảnh png/jpg/jpeg/webp | đo sống | `kbIngestRouter.ts:124` (`allowedTypes`); `kbDocParser.ts` `normalizeSourceType`; 85 job succeeded [ĐO] |
| T1a | URL (một trang, chặn SSRF) | đo sống | `kbStudioRouter.ts:330` `ingestUrlJob`; `WEB_INGEST_ENABLED=true`; **không crawl/sitemap** (grep `crawl\|depth\|sitemap` trong `kbWebFetcher.ts` = 0) |
| T1b | PDF quét → OCR trang (DET→REC + VietOCR) | đo sống [KHAI] | `kbPdfOcr.ts`; `PDFTOPPM_BIN` có khai; `models/ocr/{det,rec}.onnx + vietocr` có mặt [ĐO]; Việt 0,850→0,979 [KHAI, báo cáo 09-23 §R4] |
| T1c | Ảnh → mô tả bằng VLM | nối dây | `kbImageDescriber.ts:63` cần `isVisionSidecarAvailable()`; hôm nay không đo được |
| T1d | Video (whisper + ffmpeg) | có mã + lưới, **không UI, không cấu hình** | `kbIngestRouter.ts:270` `ingestVideo`; `WHISPER_BIN/FFMPEG_BIN` bị comment trong `.env:887-889`; `SourceTab.tsx:104-111` tự ghi "video KHÔNG nhận" |
| T1e | **Repo mã / tệp mã (.ts .cs .py), Excel/CSV, pptx, html** | **không có** | `normalizeSourceType` ném `KbUnsupportedTypeError` cho mọi đuôi khác |
| T2 | **Corpus**: tạo, liệt kê, xoá (chỉ admin, gõ lại tên) | đo sống | `kbStudioRouter.ts:192-255`; `CorpusTab.tsx` |
| T2a | Corpus **theo miền / theo dự án** | **chỉ là quy ước đặt tên** | `kb_corpora` không có cột miền/dự án [ĐO cột]; `gatherStudioHits` quét **MỌI** corpus (`aiLocalKnowledgeStudio.ts:33-55`), nên 3 corpus thử nghiệm cũng vào truy hồi |
| T2b | Xoá **một tài liệu** khỏi corpus | **không có** (chỉ xoá cả corpus; nạp lại cùng `sourceRef` thì ghi đè) | `kbVectorStore.ts:93-124` |
| T3 | **Job**: ghi hàng running → succeeded/failed, tab Tác vụ poll 5 s | đo sống | `kbStudioService.ts:310-370`; `JobsTab.tsx:38` |
| T3a | Job **nền thật** + **huỷ** + **tiến độ %** | **không** — mutation `await` toàn bộ parse→embed trong request; không có huỷ, không có % | `kbStudioRouter.ts:277-327`; `startFinetune` cũng chạy đồng bộ (`kbStudioRouter.ts:452-462`, docblock tự nhận) |
| T4 | **Kiểm sau nạp** (huy hiệu đỏ/vàng có lý do, NULL ≠ ổn) | đo sống | `kbKiemSauNap.ts`; `HuyHieuKiemMay.tsx`; mig 0360; 10 job có `ketQuaMay` [ĐO] |
| T5 | **Checklist 4 bước** đọc từ dữ liệu thật, gắn "CŨ" khi nạp sau eval | có lưới | `ChecklistCorpus.tsx`, `checklistCorpus.unit.test.ts` |
| T6 | **Eval**: bộ vàng × truy hồi thật × chấm regex, lưu theo lượt chỉ-ghi-thêm, biểu đồ trước/sau, cờ "đổi đề / đổi dữ liệu" | đo sống | `kbStudioEval.ts:120-200`; `evalTabLogic.ts:56-70`; 43 lượt [ĐO] |
| T6a | Soạn **bộ vàng từ UI** | **không** — chỉ đọc tệp `knowledge/studio-golden/*.jsonl` (có 2 bộ: 12 + 111 câu) | `kbStudioEval.ts:89-103`; router chỉ có `listGoldenSets` |
| T6b | Eval **chất lượng câu trả lời / mã sinh ra** | **không** — chỉ truy hồi; tầng B gọi `retrieveKnowledge` nhánh **web**, không phải route `vscode`, cũng không phải đường sinh mã | `kbStudioEval.ts:157` (`retrieveKnowledge(cau, 5, {callerRole})`, không có `route`) |
| T6c | Cổng chặn tự động khi eval tụt | **không** cho Studio (chỉ kho hệ thống có cổng eval-rag trong autosync) | `kbSyncScheduler.ts:20-40` |
| T7 | **Corpus → trợ lý web** (chat vận hành) | đo sống [KHAI 20→40 %; ĐO #43 64,6 %] | `aiLocalKnowledgeService.ts:2939-2975` (xếp hạng chung, hybrid) |
| T7a | **Corpus → VSCode LOCAL** (route `vscode`, ngưỡng 0,44) | nối dây + lưới + đo sống N nhỏ [KHAI: 6 câu, task-v8] | `aiLocalKnowledgeService.ts:2762-2791`; `vscode-extension/src/loi/yeuCau.ts` gửi `codingMode:false` khi LOCAL |
| T7b | **Corpus → sinh mã trên trình duyệt** (`/ai-coding-workspace`) | **KHÔNG** | `aiLocalKnowledgeService.ts:3508-3511`: `codingMode` rẽ nhánh TRƯỚC `retrieveKnowledge`; `codingRepoContext.ts:423-460` pha A lọc `sourcePathPrefixes`, nên `khoHepLai` ⇒ bỏ Studio (`:2939`); pha B vứt `block`/`text` |
| T7c | **Corpus → extension chế độ SERVER** | **KHÔNG** (cùng nhánh `codingMode:true`) | như trên |
| T8 | **Hồ sơ model** (/props, .env, router, sổ B7, báo cáo đo) | đo sống | `ModelBuilderTab.tsx`, `hoSoModelStudio.ts`; Playwright [ĐO] |
| T9 | **LoRA/fine-tune**: sidecar dựng dữ liệu → spawn → GGUF → `model_versions` VALIDATING → eval held-out → READY, không tự kích hoạt | có mã + lưới (28 ca xanh) — **chưa nối UI, chưa chạy lần nào** | `aiLlmFinetuneSidecar.ts`; `kbStudioRouter.ts:467`; client không gọi `startFinetune` (grep = 0); `.env:879` bị comment; `peft` thiếu; `model_versions` LoRA = 0 |
| T9a | Dữ liệu fine-tune | đoạn thô của corpus (văn bản để tiếp nối), **không phải cặp chỉ dẫn/mã** | `aiLlmFinetuneSidecar.ts:59-66` |
| T9b | Eval fine-tune | trùng từ (word-overlap) qua `aiGgufEngine` in-process 200 tok, **không chấm tính đúng của mã** | `aiLlmFinetuneSidecar.ts:547-613` |
| T9c | Triển khai / rollback adapter | **không có** — grep `--lora`/`/lora-adapters` trong `server/` = 0; kích hoạt `model_versions` là registry của thị giác, không đổi thứ llama-server phục vụ | [ĐỌC] |
| T10 | **Thu dữ liệu từ phiên thật**: 👍/👎 | chỉ có ở bong bóng chat vận hành (`AILocalChatBubble.tsx`); **0 hàng**; coding workspace + extension **không có** | grep `ThumbsUp`; grep `feedback` trong `vscode-extension/src` = 0 |
| T10a | Diff được duyệt/bác → dữ liệu huấn luyện | **không** — lưu trong `ai_pending_actions` nhưng không có bộ xuất nào | grep `aiCodingSessions` chỉ ra router/db, không có exporter |
| T11 | **Lịch đồng bộ** kho HỆ THỐNG (03:00 + cổng eval + rollback) | đo sống | `kbSyncScheduler.ts`; mtime 10-14 03:00 [ĐO] |
| T11a | Đồng bộ lại nguồn **Studio** (URL đổi nội dung, tệp cập nhật) | **không** | `kbSyncScheduler.ts` không nhắc Studio (grep = 0) |
| — | `embeddingHead*`, `aiLocalTraining.ts` | **ngoài miền lập trình**: head phân loại lỗi AOI trên DINOv2, transfer learning ONNX cho ảnh | header các tệp |

---

## 3. Câu hỏi trung tâm — Training Studio làm AI lập trình thông minh hơn tới mức nào?

**Trả lời: ít, và chỉ ở một cửa.**

1. **Đường sinh mã chính không đọc Studio [ĐỌC, chắc chắn].**
   `streamAnswer` gặp `codingMode === true` thì gọi `streamCodingAnswer` và return ngay (`aiLocalKnowledgeService.ts:3508-3511`), trước mọi `retrieveKnowledge`.
   Ngữ cảnh của đường sinh mã là mã repo thật (`codingRepoContext.ts`) cộng bài học lượt.
   Pha A truyền `sourcePathPrefixes`, mà `khoHepLai` thì bỏ Studio (`:2939`). Pha B chỉ mót đường dẫn, vứt văn bản.
   Kế hoạch 09-22 §R2 tự ghi: "Đường sinh mã `/ai-coding-workspace` hôm nay KHÔNG truy hồi kho Studio".
   Mã nối truy hồi API vào prompt sinh mã "được CẤT ngoài cây" vì đo ngoại tuyến cho thấy **0/12 đoạn đúng namespace**: thứ model thiếu nằm trong mã nó sắp viết, không nằm trong câu hỏi.
2. **Cửa duy nhất là VSCode LOCAL [ĐỌC + KHAI].**
   Extension LOCAL gửi `codingMode:false` + `route:"vscode"`. Câu hỏi đi qua `retrieveProgrammingKnowledgeForVscode`, trộn Studio với ngưỡng 0,44.
   Số đo truy hồi: `csharp-dotnet` 9/10 [ĐO #26]. Không có phép đo nào cho thấy **mã hay câu trả lời** tốt hơn nhờ đó: eval chỉ đo truy hồi (T6b).
3. **Nhiễu cùng miền chưa được chặn [ĐO].**
   Lượt #43: 20/32 câu ngoài corpus vẫn có đoạn Studio ≥ 0,44 (từ chối đúng 37,5 %).
   Báo cáo 09-23 đính chính đã thấy 3/12 lọt; bộ 111 câu cho thấy tỷ lệ lọt còn lớn hơn ở tầng corpus.
   (Tầng câu trả lời có "cổng lạc đề" riêng, `bf42ae799` [KHAI] — tôi không đo lại.)
   **[SUY]** Ở route vscode, đoạn lạc đề qua ngưỡng có thể vào prompt lập trình. Chưa có lượt eval nào đo route vscode end-to-end.
4. **Cải tiến lập trình duy nhất có số không đến từ Studio.**
   R2B bổ sung `using` C#: 21 → 34/35 [KHAI], 0/228 báo oan [KHAI]. Dữ liệu: `knowledge/api-ref/dotnet-using.json` do `scripts/ai-kb/tao-tham-chieu-api-dotnet.mjs` sinh, không phải truy hồi corpus.
   Sống: 0 kích hoạt / 36 bài H [KHAI].
   Câu hướng dẫn trên UI "Tài liệu THAM CHIẾU API … có ích thật" (vi.json `source.guidance.step1WebWarning`) vì thế **dễ hiểu sai**: nạp tài liệu API vào Studio **không** đến được không gian lập trình trên trình duyệt.
   Gợi ý `eval.metric.overThresholdHint` ("ngưỡng của trợ lý lập trình — thật sự được đưa vào prompt") cũng chỉ đúng cho VSCode LOCAL.
5. **Tầng 2 (mô hình) không đổi gì [ĐO + ĐỌC].**
   LoRA trơ; G9 đã bác bằng số rằng lỗi còn lại là suy luận [KHAI, có lý].
   Nhưng hạ tầng hiện có cũng **không thể** phục vụ một adapter: không có `--lora`, eval không chấm mã, dữ liệu không phải cặp chỉ dẫn.
6. **Không có vòng học từ dùng thật [ĐO].**
   0 phản hồi, 0 bài học. 594 hành động đã thi hành và 15 lần bác ghi nằm yên trong DB.

**Ước lượng [SUY]:** với người dùng không gian lập trình trên trình duyệt, đóng góp của Training Studio ≈ 0. Với VSCode LOCAL: có tra cứu tài liệu nạp, chất lượng truy hồi tốt trên 2 corpus, hiệu quả lên mã chưa đo.
Thứ Studio làm tốt thật là **trợ lý vận hành / hỏi đáp tài liệu** (64,6 % đường ống tới trợ lý web trên bộ 111 câu).

---

## 4. Khoảng trống

### P0 (chặn mục tiêu "AI lập trình thông minh hơn nhờ training")
1. **Đường sinh mã (trình duyệt + extension SERVER) không truy hồi Studio.** Tài liệu dự án, chuẩn mã và tham chiếu API người dùng nạp không bao giờ tới lượt sinh mã. Đây là chỗ cần nó nhất.
   Đã đo: nối "top‑K theo câu hỏi" là sai cơ chế (0/12). Cần cơ chế khác, ví dụ truy hồi theo ký hiệu xuất hiện trong bản nháp mã (tổng quát hoá R2B), hoặc tool `tra_tai_lieu` cho vòng agent. Phải đo A/B M/H.
2. **Không có vòng phản hồi từ dùng thật.** Không 👍/👎 ở coding và extension; 0 bài học; diff duyệt/bác không thành dữ liệu.
   Không có dữ liệu thì không thể huấn luyện, xếp hạng lại hay chọn ví dụ mẫu. Đây là điều kiện tiên quyết cho mọi "thông minh hơn theo thời gian".
3. **Eval không đo cái mục tiêu cần.** Chỉ đo truy hồi, chỉ nhánh web; không có bộ vàng lập trình kiểu "câu hỏi → mã → biên dịch/chạy test" gắn với corpus.
   Hệ quả: không chứng minh được một lần nạp có làm mã tốt hơn hay tệ đi.

### P1
4. **Corpus không gắn miền/dự án**; truy hồi gộp mọi corpus kể cả 3 corpus thử nghiệm.
   UI dặn "chọn corpus theo ĐÚNG miền" nhưng hệ thống không dùng thông tin đó. Nhiễu cùng miền lọt 62,5 % ở #43.
5. **Không nạp được mã nguồn/repo, CSV/Excel, pptx, html; URL không crawl.** Với AI lập trình, nguồn quý nhất (repo mẫu, chuẩn mã nội bộ, tài liệu site nhiều trang) không vào được.
6. **Job đồng bộ trong request, không huỷ, không %.** Nạp lô lớn (74 job csharp) chặn request. Fine-tune cũng được thiết kế đồng bộ, chưa thể bật ở prod.
7. **Bộ vàng chỉ soạn bằng tệp**; người vận hành không thể tự dựng thước đo cho corpus mới từ UI. Studio không có cổng eval tự động hay rollback khi nạp làm tụt điểm.
8. **Lời trên UI hứa quá** (T3 mục 4): hướng dẫn ngụ ý nạp tham chiếu API giúp lập trình, nhưng đường sinh mã chính không đọc Studio.

### P2
9. LoRA: nếu mở lại thì phải đổi dữ liệu (cặp chỉ dẫn/mã từ T10a), eval (biên dịch/test), phục vụ (`--lora` hoặc hot-swap adapter llama-server), rollback, ngân sách VRAM (hiện ước lượng = 0) và job nền.
10. Không xoá được một tài liệu lẻ; không đồng bộ lại nguồn Studio theo lịch.
11. Video: có mã nhưng không UI, không cấu hình whisper/ffmpeg.
12. Dữ liệu bẩn: `task-v9-probe` có 2 đoạn mà 0 job; các corpus probe/w2 vẫn còn (theo nguyên tắc chủ dự án "seed sai thì xoá": báo trước, chưa xoá).
13. `kb_eval_runs` chỉ ghi thêm là tốt, nhưng các lượt #2–#27 thuộc phiên bản corpus `st4i-may-aoi` cũ (corpus được tạo lại 09-24, id 115). Biểu đồ đã có cờ "đổi dữ liệu", nhưng cần lưu ý khi so.

---

## 5. Điểm hoàn thiện ≈ 42 %

Cách tính: mỗi mục có trọng số theo tầm quan trọng với mục tiêu "AI lập trình thông minh hơn nhờ training" (tổng 100).
Điểm mục 0–1 theo thang: có mã 0,25 · nối dây 0,5 · có lưới 0,75 · đo sống 1,0, sau đó trừ phần thiếu.

| Mục | Trọng số | Điểm | Đóng góp | Lý do |
|---|---|---|---|---|
| Nguồn nạp | 10 | 0,6 | 6,0 | 5 định dạng + URL + OCR sống; thiếu mã/repo/CSV/crawl/video UI |
| Corpus theo miền | 8 | 0,4 | 3,2 | CRUD sống; miền chỉ là tên, truy hồi gộp tất cả |
| Job + huỷ + tiến độ | 6 | 0,35 | 2,1 | có trạng thái/poll; không nền, không huỷ, không % |
| Kiểm sau nạp | 6 | 0,85 | 5,1 | sống, có lý do; chỉ job mới có |
| Eval | 14 | 0,6 | 8,4 | sống, 43 lượt, chỉ-ghi-thêm; chỉ truy hồi, nhánh web, bộ vàng bằng tệp |
| Corpus → trợ lý lập trình | 20 | 0,3 | 6,0 | VSCode LOCAL có; trình duyệt + SERVER không |
| Fine-tune/LoRA | 12 | 0,15 | 1,8 | mã + 28 lưới; không UI, không chạy, không phục vụ |
| Hồ sơ model | 6 | 0,9 | 5,4 | sống, trung thực (hôm nay báo đúng là llama-server không liên lạc được) |
| Dữ liệu từ phiên thật | 12 | 0,1 | 1,2 | 👍/👎 chỉ ở chat vận hành, 0 hàng; không exporter |
| Lịch đồng bộ | 6 | 0,5 | 3,0 | kho hệ thống sống; Studio không |
| **Tổng** | **100** | | **≈ 42** | |

Nếu chấm theo mục tiêu hẹp hơn, "Studio như ống nạp tri thức cho hỏi đáp", điểm sẽ cao hơn nhiều (~70 %, [SUY]). Phần tụt chủ yếu vì cầu nối tới **sinh mã** và **học từ dùng thật** gần như trống.

---

## 6. Phân biệt ĐO / SUY

- **ĐO hôm nay:**
  - Số đếm DB.
  - `tongHop` các lượt eval.
  - Trạng thái :3000/:8091.
  - mtime kho hệ thống.
  - `peft` vắng.
  - 108/108 lưới xanh.
  - Nội dung tab Hồ sơ model và Corpus (Playwright).
- **ĐỌC mã (chắc chắn về cấu trúc):**
  - Đường sinh mã bỏ qua Studio.
  - VSCode LOCAL đi route `vscode` có Studio.
  - Eval tầng B là nhánh web.
  - Không có `--lora`.
  - Không exporter.
- **KHAI (chưa đo lại):** 20→40 %, OCR Việt 0,979, R2B 21→34/35 và 0/36 kích hoạt, đo sống Studio→vscode 6 câu, cổng lạc đề tầng trả lời.
- **SUY:**
  - Đóng góp ≈ 0 cho người dùng trình duyệt.
  - Đoạn lạc đề ≥ 0,44 có thể vào prompt VSCode.
  - Điểm ~70 % nếu chấm theo mục tiêu hỏi đáp.
