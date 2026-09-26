# Thiết kế: Wave 2 — "Giao được hàng" (AI đến đúng nơi kỹ sư làm việc)

**Ngày:** 2026-07-28 · **Nhánh:** `feat/hmi-dep` · **Tiếp nối:** doc 69 → Wave 0 (`f02b4b88`) → Wave 1 (`65dbc2fa`)

**Mục tiêu một câu:** Wave 2 **không thêm AI mới**. Nó sửa **ba đường giao hàng đứt** khiến AI đã có sẵn không tới được tay người dùng.

---

## 1. Bối cảnh: vì sao đổi khung

Yêu cầu ban đầu (concern #1) là *"copilot lập trình phải thực sự mạnh + giao diện training nạp nhiều dữ liệu (PDF/doc/ảnh) cùng lúc + code inline"*. Khảo sát 4 agent song song + **đo dữ liệu thật** cho thấy vấn đề nằm chỗ khác:

**Số liệu đo được trên DB (2026-07-28):**

| Chỉ số | Giá trị |
|---|---|
| Điểm đo | 110 (12 sản phẩm, 9,2 điểm/sp) |
| Lần sửa điểm đo (versions) | 16 |
| **`threshold_approvals`** | **150 — TẤT CẢ `status='requested'`** |
| **Đã duyệt / từ chối** | **0** |
| Recipe versions / deployments | 5 / 3 |
| Program builds / deployments | 3 / 3 |
| `kb_studio_chunks` | **0 dòng** |
| `kb_ingest_jobs` | **0 dòng** |

**Kết luận:** bộ auto-tune đã sinh **150 khuyến nghị ngưỡng** và **không một cái nào từng được quyết định**. Chúng nằm ở `/threshold-approvals` — một trang **khác** với `/products` nơi kỹ sư thực sự chỉnh điểm đo. Thêm AI mạnh hơn mà không sửa khâu giao hàng chỉ tạo ra **đề xuất thứ 151 không ai xem**.

**Ba đường đứt:**

| Đường | Bằng chứng | Hệ quả |
|---|---|---|
| **A.** Đề xuất ngưỡng → kỹ sư | 150 chờ / 0 quyết định; không có dấu hiệu nào trên màn điểm đo | Công sức AI bị vứt bỏ hoàn toàn |
| **B.** Kiến thức nạp → trợ lý | Kho Studio **không có hàm tìm kiếm**; UI **nói sai sự thật** | Nạp tài liệu xong trợ lý vẫn không biết |
| **C.** Ghost-text → nơi viết code | Bật ở **1/4** màn soạn code; ô tra sổ-tay gắn nhầm màn | Kiến thức 91.678 chunk không tới nơi cần |

## 2. Trạng thái đã kiểm chứng (không suy đoán)

**Ba kho kiến thức song song, chỉ một hoạt động:**

| Kho | Dòng | Hàm tìm kiếm | Trợ lý đọc? |
|---|---|---|---|
| `knowledge/*.jsonl` (file) | 5.370 | `retrieveKnowledge()` (`aiLocalKnowledgeService.ts:1576`) | ✅ **kho thật đang chạy** |
| `kb_chunks` (pgvector) | 0 | `searchKb()` (`kbVectorStore.ts:110`) | ❌ chỉ có `kbVectorRouter`, không client nào gọi |
| `kb_studio_chunks` (Studio) | 0 | `searchCorpus()` (`server/services/kbVectorStore.ts:180`) | ❌ **0 caller sản xuất** |

⚠ **CÓ HAI FILE TRÙNG TÊN `kbVectorStore.ts` — đây là bẫy đã làm chính tác giả spec đọc nhầm một lần:**
- `server/services/kb/kbVectorStore.ts` → `searchKb()` (`:110`) đọc bảng **`kb_chunks`** (kho song song, 0 dòng, chỉ có `kbVectorRouter`, không client nào gọi).
- `server/services/kbVectorStore.ts` → `upsertChunks()` (`:93`, **đang được `kbIngestService` dùng để ghi**) và `searchCorpus(corpus, queryEmbedding, k)` (`:180`) đọc bảng **`kb_studio_chunks`**.

Vậy hàm truy hồi cho kho Studio **ĐÃ TỒN TẠI** — vấn đề là **không ai gọi nó** (grep toàn repo: 0 caller sản xuất; chỉ có một comment trong `kbIngestService.ts:212` nhắc tới). Đây là **nối lại**, KHÔNG phải xây mới. Người thi công phải mở đúng file (`server/services/kbVectorStore.ts`, không có `/kb/`).

**Hai điều kiện kỹ thuật đã xác minh, quyết định tính khả thi:**
1. `kb_studio_chunks.embedding_vec` là `vector(1024)`, sinh bởi **cùng** `generateEmbedding()` mà corpus file dùng (Qwen3-Embedding-0.6B) ⇒ **gộp hai nguồn là hợp lệ về toán học**, cosine có nghĩa.
2. **VLM Qwen3-VL-8B + mmproj CÓ SẴN** (`.env:142-143`, boot log `[AIModels] gguf-vision: present`). **OCR CHƯA cấu hình** (`OCR_MODEL_DIR`/`PDFTOPPM_BIN` trống, `models/ocr` không tồn tại) ⇒ đường ảnh phải đi qua **VLM**, không hứa OCR.

**Nền móng lập trình tốt hơn tưởng:** PROG_KB thật (91.678 chunk / 37 sổ tay hãng), đã nối vào prompt copilot + hiện citation; `CodeEditor` là **CodeMirror 6 thật** (`@uiw/react-codemirror` + lint + StreamLanguage), không phải textarea; chuỗi an toàn 19 lớp đã truy vết từng mắt (từ chối-từ-khoá E-stop → lint cứng IR → validate bắt buộc → cổng mô phỏng → 4 mắt → SoD → OTP tươi → verify-after-download).

## 3. Phạm vi

**Thuộc phạm vi:** ba đường A/B/C ở §4-§6.

**KHÔNG thuộc phạm vi (cố ý loại trừ):**
- Model Builder / LoRA fine-tune (tab placeholder, giữ nguyên).
- Gateway `/v1` cho IDE ngoài (đã xây đủ, không có caller trong app — đúng thiết kế).
- Sinh recipe JSON bằng AI cho `/recipes` (màn này hiện **0 AI**; đáng làm nhưng để wave sau).
- Nâng gợi ý remap điểm-đo bằng embedding (hiện là so khớp tất định).
- Hợp nhất/dọn `kb_chunks` + `kbVectorRouter` (kho song song không dùng) — **ghi nhận là nợ, không sửa ở wave này** để tránh phình phạm vi.
- **Không đụng chuỗi an toàn 19 lớp**: không nới `DPC_DEPLOY_ENABLED`, không bỏ 4-mắt/SoD/OTP/cổng-mô-phỏng.
- Ngôn ngữ Tier-B (KAREL/RAPID/MELFA/Delta) — chỉ có RAG, không có compile/sim ⇒ không hứa gì thêm.

---

## 4. Đường A — Đưa 150 đề xuất về đúng màn hình

### Vấn đề
`threshold_approvals` có `pointDefId` trỏ đúng điểm đo (`drizzle/schema/product.ts:1078`), nhưng `/products` (nơi sửa điểm) **không đọc bảng này**. Kỹ sư không biết đề xuất tồn tại.

### Thiết kế

**A1 — Badge "có đề xuất AI" tại chỗ.**
- Endpoint mới trả về số đề xuất `status='requested'` theo `pointDefId` cho tập điểm của một sản phẩm (một truy vấn gộp, không N+1).
- `client/src/pages/ProductModels.tsx`: hiện badge trên hàng điểm đo có đề xuất chờ.
- `client/src/components/productModels/PointDetailsForm.tsx`: hiện khối đề xuất ngay trong form (cạnh nút `AIThresholdSuggestButton` sẵn có ở `:402`).
- Nội dung khối: giá trị hiện tại → giá trị đề xuất (LSL/USL/nominal), **bằng chứng đã có sẵn** trong `suggestion` jsonb (số mẫu, Cpk, nguồn `proposedBy:"ai_autotune"`), và ảnh NG đính kèm nếu có.

**A2 — Duyệt ngay tại chỗ, giữ nguyên SoD.**
- Nút Duyệt/Từ chối gọi đúng mutation `thresholdApproval` sẵn có — **không** tạo đường ghi mới.
- **Bắt buộc giữ**: `decidedBy ≠ requestedBy`. Nếu người xem chính là người đề xuất ⇒ badge **vẫn hiện** nhưng nút duyệt **khoá**, kèm câu giải thích rõ (không im lặng ẩn đi).

**A3 — Đề xuất + duyệt hàng loạt.**
- `ProductModels.tsx` đã có sẵn cơ chế chọn nhiều điểm (`selectedPointIds: Set<number>` `:468`, dùng cho `handleBatchDelete` `:2297` / `handleBatchExport` `:2308`) nhưng **chưa nối vào AI**.
- Thêm "AI đề xuất cho N điểm đã chọn": gọi bộ `aiThresholdAdvisor` sẵn có cho từng điểm, gom kết quả, hiện bảng xem trước, cho phép **chọn từng dòng** trước khi gửi.
- **Điểm mấu chốt về chi phí (đã kiểm chứng):** `aiThresholdAdvisor` **KHÔNG gọi model nào** — nó là **thống kê thuần** (percentile cắt tỉa P0.135/P99.865 ≈ ±3σ + co Bayes về giới hạn hiện có, `server/utils/thresholdSuggestion.ts:6-7,147-161`). Vì vậy batch N điểm = N phép tính thống kê, **không tranh VRAM, không cần xếp hàng, chạy nhanh**. Đây cũng là lý do gọi nó là "AI đề xuất" phải trung thực trong câu chữ UI: nó là **khuyến nghị thống kê từ dữ liệu đo thật**, không phải model sinh chữ.
- Điểm không đủ mẫu (ngưỡng mặc định 300 mẫu, `aiThresholdAdvisor.ts:37-40`) ⇒ hiện **"chưa đủ dữ liệu"** trung thực, KHÔNG bịa số.
- Duyệt hàng loạt tái dùng logic của `/threshold-approvals` (đã có batch-approve), **kể cả kiểm tra SoD từng dòng**.

**A4 — Fail-safe.** Bảng `threshold_approvals` lỗi/thiếu ⇒ badge không hiện, màn điểm đo **hoạt động bình thường** (dùng cause-walker `isMissingTable`). Không bao giờ chặn công việc chính vì tính năng phụ.

### Kiểm thử A
Badge đếm đúng theo `pointDefId`; tự-duyệt bị khoá kèm lý do; batch bỏ qua điểm thiếu mẫu và nói rõ; `isMissingTable` ⇒ suy giảm im lặng đúng chỗ (badge ẩn, màn vẫn chạy).

---

## 5. Đường B — Nối kho Studio vào truy hồi + nạp nhiều file + ảnh

### B1 — Vá lời nói dối TRƯỚC (làm cùng lúc với việc biến nó thành sự thật)
Tab Model Builder hiện ghi *"Today's corpora already power RAG-grounded answers in the AI assistant"* (khoá i18n `kbStudio.modelBuilder.comingSoonDesc`) — **sai sự thật**. Sửa câu chữ ở cả `vi/en/zh` để phản ánh đúng trạng thái tại từng thời điểm của wave này.

### B2 — Nối hàm truy hồi ĐÃ CÓ của kho Studio
`searchCorpus(corpus, queryEmbedding, k)` (`server/services/kbVectorStore.ts:180`) đã tồn tại, đã có 2 tầng (pgvector HNSW khi `queryEmbedding.length === VECTOR_DIM=1024`, brute-force dự phòng) và đã fail-safe (`db` null ⇒ `[]`, corpus rỗng ⇒ `[]`, `k` kẹp 1..50). **Không viết lại.**

Hai việc phải làm để dùng được nó:
1. **Nó nhận embedding ĐÃ TÍNH SẴN, không nhận chuỗi truy vấn.** `retrieveKnowledge()` vốn đã tính `qVec` qua `embedQuestion(question)` — truyền lại chính vector đó, **không nhúng lần hai** (tốn thời gian và có thể lệch).
2. **Nó lọc theo MỘT corpus.** Cần quyết định tìm trong corpus nào: gọi `listCorpora()` (`kbStudioService.ts:89`) rồi tìm trong **tất cả corpus đang có**, gộp kết quả rồi cắt `topK`. Với số corpus nhỏ (thực tế hiện là 0) chi phí không đáng kể; nếu sau này nhiều corpus, đó là lúc thêm bộ lọc do người dùng chọn — **không tối ưu sớm**.
- Bọc thành một hàm mỏng trong `aiLocalKnowledgeService` để `retrieveKnowledge` gọi một chỗ, và để fail-safe tập trung: bất kỳ lỗi nào ⇒ `[]`, **không bao giờ ném**.

### B3 — Trộn vào `retrieveKnowledge()`
- `retrieveKnowledge()` (`aiLocalKnowledgeService.ts:1576`) truy hồi **hai nguồn**: corpus file (như hiện nay) **+** `searchStudioCorpus`.
- Hợp lệ vì cả hai cùng model nhúng, cùng 1024 chiều (đã xác minh §2).
- **Citation phải ghi rõ nguồn**: thêm trường phân biệt "kho hệ thống" vs "tài liệu bạn nạp" vào `KbCitation`. Trường này phải **tuỳ chọn và thuần bổ sung** — mọi nơi đang đọc `KbCitation` hôm nay phải chạy nguyên vẹn khi trường vắng mặt (kiểm bằng grep mọi consumer trước khi sửa kiểu).
- **Fail-safe bắt buộc**: nguồn Studio lỗi ⇒ trợ lý **vẫn trả lời bằng corpus file**, chỉ mất phần bổ sung. Tuyệt đối không để tính năng mới làm hỏng trợ lý đang chạy.
- Giữ nguyên guard `computeEmbedModelMatches` sẵn có (nếu model nhúng lệch ⇒ bỏ vector, dùng keyword).

### B4 — Nạp nhiều file + kéo-thả
- `SourceTab.tsx:149-154`: thêm `multiple` vào input và xử lý **toàn bộ** `e.target.files` (hiện chỉ đọc `[0]`).
- `:132-148`: ô hiện **trông như** vùng thả nhưng **không có `onDrop`** ⇒ thêm `onDrop`/`onDragOver`/`onDragLeave` thật.
- **Mỗi file một job riêng** trong `kb_ingest_jobs` ⇒ một file hỏng không kéo cả lô xuống; tab Jobs đã hiện `error` thật cho từng dòng.
- Hiện tiến độ theo từng file (đang chờ / đang chạy / xong / lỗi + lý do).

### B5 — Nạp ảnh qua VLM (không phải OCR)
- Mở rộng `KbSourceType` (`kbDocParser.ts:36`) thêm `"image"`; nhận `png/jpg/jpeg/webp`.
- Đường xử lý: ảnh → **mô tả bằng Qwen3-VL** (`aiVisionLanguage.ts` / `llamaVisionSidecar.ts`, đã chạy thật ở phân tích lỗi AOI) → văn bản → chunk → nhúng → `kb_studio_chunks`.
- **Ghim model tường minh** cho lời gọi VLM (bài học Wave 1 — không bao giờ để engine tự chọn "model nạp trước").
- **Trung thực**: nếu VLM không sẵn sàng ⇒ job `failed` với lý do rõ ràng ("model thị giác chưa sẵn sàng"), **không** lưu chunk rỗng, **không** giả vờ thành công.
- **Không hứa OCR**: chữ trong ảnh chỉ được đọc ở mức VLM mô tả được. Khi ops cài `PDFTOPPM_BIN` + `models/ocr` thì mới thêm nhánh OCR — ghi rõ trong UI.
- Cập nhật `allowedTypes` (`kbIngestRouter.ts:101`) để `accept` của input phản ánh đúng những gì server thật sự nhận.
- **Chống nhầm định dạng**: hiện tại đổi tên `photo.png` → `photo.txt` sẽ lọt qua và lưu byte nhị phân thành chunk rác. Thêm kiểm tra magic-byte tối thiểu để từ chối trung thực.

### Kiểm thử B
`searchStudioCorpus` trả `[]` khi DB null/thiếu bảng (không ném); trộn hai nguồn cho ra citation có nhãn đúng; nguồn Studio ném ⇒ trợ lý vẫn trả lời bằng corpus file; nhiều file ⇒ nhiều job độc lập, một file hỏng không ảnh hưởng file khác; ảnh không có VLM ⇒ job `failed` với lý do, không có chunk rỗng; file đổi đuôi bị từ chối.

---

## 6. Đường C — Inline đủ 4 màn + sổ tay đúng chỗ

**C1 — Ghost-text đủ 4 màn.** `inlineCopilot` hiện chỉ bật ở `EngineeringWorkspace.tsx:1010`. Bật thêm cho `/ir-editor`, `/pou-studio`, và 2 editor trong `ProgrammingCopilotPanel`. Prop đã có sẵn (`CodeEditor.tsx:53,218,241`) ⇒ thay đổi nhỏ, rủi ro thấp.

**C2 — Đưa ô tra sổ-tay về nơi viết code.** `ManualHelp` (tra 91.678 chunk vendor) đang gắn ở `AndonBoard.tsx:782` và `DeviceAdapterManagement.tsx:362` — **không màn soạn code nào có**. Gắn vào các màn lập trình, mang theo ngôn ngữ/kind hiện tại làm bộ lọc.

**C3 — Ghim model + dùng đúng tầng FIM.** `completeInline` (`aiProgrammingCopilot.ts:763-790`) gọi `generateFim()` **không truyền `modelId`** và **bỏ qua** `aiModelRouter.route({task:"fim"})` (`aiModelRouter.ts:369-374`). Đường FIM hiện *không* dính lỗi embedder (chuỗi `GGUF_FIM_MODEL → FAST → DEFAULT` loại trừ embedder), nhưng đây là call-site duy nhất trong nhánh copilot không theo quy ước "ghim model tường minh" mà mọi chỗ khác đã theo sau Wave 1. Sửa cho nhất quán và để `AI_CODE_ROUTER_ENABLED` thật sự có hiệu lực.

### Kiểm thử C
Ghost-text bật đúng ở cả 4 màn (không rò sang editor chỉ-đọc); `completeInline` gọi với model đã ghim; `ManualHelp` nhận đúng bộ lọc ngôn ngữ theo màn.

---

## 7. An toàn

- **Không nới một lớp nào** trong chuỗi 19 lớp. Đề xuất ngưỡng vẫn **luôn** đi qua `threshold_approvals` với SoD; 7 write-tool ngưỡng/điểm-đo vẫn nằm trong denylist tự-trị (`autonomyPolicy.ts:105-138`) — không bao giờ tự chạy.
- **Mọi lời gọi model mới đều ghim `modelId` tường minh** (bài học Wave 1).
- **Suy giảm trung thực ở mọi nhánh mới**: thiếu bảng/model/cấu hình ⇒ nói rõ, không im lặng trả kết quả rỗng trông như thành công.
- Ảnh nạp vào đi qua cùng đường redact/an-toàn như tài liệu khác.

## 8. Kiểm thử & nghiệm thu

- Mỗi đường có test đơn vị riêng (§4/§5/§6).
- **Bắt buộc đo live cuối wave** — bài học Wave 1: *test xanh + review sạch KHÔNG chứng minh sản phẩm chạy*. Kịch bản nghiệm thu:
  1. Mở `/products` → thấy **badge đề xuất** trên điểm có đề xuất chờ (hiện có 150 dòng thật trong DB để kiểm).
  2. Duyệt một đề xuất tại chỗ → `threshold_approvals.status` đổi trong DB; tự-duyệt bị khoá đúng.
  3. Nạp **nhiều file cùng lúc** + **một ảnh** → mỗi file một job; ảnh ra chunk từ mô tả VLM (hoặc `failed` có lý do nếu VLM bận).
  4. Hỏi trợ lý về nội dung vừa nạp → **trả lời có citation nhãn "tài liệu bạn nạp"**.
  5. Gõ code ở `/ir-editor` và `/pou-studio` → **ghost-text hiện**.
  6. Kiểm `modelId` thật trong DB/log là model chat, **không phải embedder**.

## 9. Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Trộn nguồn làm hỏng trợ lý đang chạy | Nguồn Studio là **bổ sung**, lỗi ⇒ suy giảm về corpus file; guard model-nhúng giữ nguyên |
| VLM chiếm VRAM, tranh với model chat | Ghim model tường minh; ảnh xử lý trong job nền; **32GB VRAM chỉ chạy 1 model sâu** (đo được ở Wave 1) ⇒ ghi rõ giới hạn, job xếp hàng chứ không chạy song song |
| Badge/batch làm chậm màn điểm đo | Một truy vấn gộp theo sản phẩm, không N+1; fail-safe ẩn badge. Batch đề xuất là **thống kê thuần, không gọi model** ⇒ không tranh VRAM |
| Spec to (3 đường, ~8-10 task) dễ đuổi bóng ma như Wave 1 | Kế hoạch thi công phải **đo trạng thái thật trước mỗi đường** và **live-verify từng đường** thay vì dồn tới cuối; thứ tự A→B→C theo sức nặng bằng chứng |
| Duyệt hàng loạt gây sai hàng loạt | Xem trước từng dòng, chọn từng dòng, SoD kiểm từng dòng; điểm thiếu mẫu bị loại và nói rõ |
| Phạm vi phình | §3 liệt kê rõ những gì **không** làm |

## 10. Tài liệu tham chiếu

- `server/services/aiLocalKnowledgeService.ts:1576` — `retrieveKnowledge()`
- `server/services/kbVectorStore.ts:93,180` — `upsertChunks()` (đường ghi Studio đang dùng) + `searchCorpus()` (**hàm truy hồi cần nối**, `VECTOR_DIM=1024`)
- `server/services/kb/kbVectorStore.ts:110` — `searchKb()` — **file KHÁC, bảng KHÁC (`kb_chunks`)**, không dùng cho Wave 2
- `server/services/kbStudioService.ts:89` — `listCorpora()` (để duyệt các corpus khi truy hồi)
- `server/services/aiProviderRouter.ts:391` — `describeImage()` (primitive VLM chung; `describeDefect` ở `aiVisionLanguage.ts:55` là **prompt riêng cho lỗi AOI**, KHÔNG dùng cho ảnh tài liệu)
- `server/services/llamaVisionSidecar.ts:122` — `isVisionSidecarAvailable()` (kiểm trung thực trước khi nhận ảnh)
- `drizzle/schema/product.ts:1076-1102` — `threshold_approvals`
- `client/src/components/AIThresholdSuggestButton.tsx:67`; dùng ở `PointDetailsForm.tsx:402`, `MqttNgRateThreshold.tsx:742`
- `client/src/pages/ProductModels.tsx:468,2297,2308` — batch-select sẵn có
- `client/src/pages/kbStudio/SourceTab.tsx:74,132-154` — input + "dropzone"
- `server/services/kb/kbDocParser.ts:36` — `KbSourceType`
- `server/services/aiVisionLanguage.ts`, `llamaVisionSidecar.ts` — đường VLM
- `client/src/components/engineering/CodeEditor.tsx:53,218,241` — prop `inlineCopilot`
- `server/services/programming/aiProgrammingCopilot.ts:763-790` — `completeInline`
- `server/services/ai/autonomyPolicy.ts:105-138` — denylist tự-trị
