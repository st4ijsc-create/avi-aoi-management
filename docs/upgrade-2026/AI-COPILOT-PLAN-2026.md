# Kế hoạch nâng cấp AI Copilot cho nhân viên nhà máy — 2026

> Tài liệu đánh giá hiện trạng + lộ trình. **CHƯA code.** Chủ dự án review trước khi thực hiện.
> Phạm vi: trợ lý/copilot AI **100% LOCAL** (GGUF qua node-llama-cpp + ONNX/DirectML; KB RAG local; vision sidecar).
> Mục tiêu nghiệp vụ: biến AI local thành **copilot cho nhân viên** — hỗ trợ từ hỏi-đáp/điều hướng cơ bản đến cài máy, cấu hình điểm đo, chạy phân tích, lập báo cáo, chẩn đoán lỗi; học liên tục; theo vai trò.

---

## 1. Tóm tắt điều hành

Hệ thống **đã có nền RAG copilot tốt** và chạy **offline-first thật** (GGUF là đường mặc định, Ollama chỉ còn là fallback rollback). Cụ thể đã làm được:

- **KB RAG chất lượng cao**: 1.195 chunk, hybrid keyword + embedding (mxbai 1024-dim), intent classifier, role-aware prompt, citations, chống bịa (grounding guard), đa ngôn ngữ vi/en, streaming SSE, cache, follow-up suggestions, feedback thumbs up/down. KB phủ **~79 trang/feature + 12 how-to/SOP + domain AOI**.
- **Tool execution có thật nhưng CHỈ ĐỌC**: 9 tool truy vấn DB thời gian thực (today_stats, lot_status, machine_status, defect_trend, top_defects, factory_stats, ng_compare, oee, model_metrics) — phân loại bằng heuristic + LLM fallback grammar-constrained JSON, validate bằng zod. Đây là điểm mạnh thật.

**Khoảng cách lớn nhất so với copilot enterprise** (cần đầu tư):

1. **Không có "agentic write-action"** — AI **không thể thực thi tác vụ** (tạo máy/điểm đo, set spec, chạy SPC/train, tạo báo cáo). Toàn bộ tool là read-only. Đây là gap chính so với mục tiêu nghiệp vụ.
2. **Không context-aware** — chat bubble không biết trang hiện tại, máy/sản phẩm đang chọn. Stream endpoint chỉ nhận `question/topK/history/userRole`.
3. **Role-aware bị tắt ở UI** — client hard-code `FIXED_USER_ROLE = "engineer"`; backend hỗ trợ 4 role nhưng UI luôn gửi engineer.
4. **Không có SOP/Playbook walkthrough** — how-to nằm dưới dạng văn bản RAG, AI không "dẫn dắt từng bước tương tác".
5. **KB không auto-sync** — build pipeline là script thủ công (`kb:extract/chunk/embed/graph`), không watcher/git-hook; KB dễ lệch khi code đổi.
6. **Feedback loop hở** — có ghi `feedback.jsonl` nhưng **không có vòng curation** đưa phản hồi/câu hỏi-không-trả-lời-được trở lại cải thiện KB.
7. **Bubble chỉ ở DashboardLayout** — chưa phủ mọi trang.

Kết luận trung thực: **nền tảng "trợ lý hỏi-đáp + tra cứu dữ liệu" đã ~75-80% hoàn thiện**; nhưng phần **"copilot thực thi tác vụ" gần như 0%**. Lộ trình dưới đây ưu tiên quick win (context + role + auto-sync) rồi mới đến agentic write-action (đầu tư lớn, cần permission/confirm).

---

## 2. Bảng hiện trạng (mảng / backend / trạng thái / % / file:line)

| Mảng | Backend thật | Trạng thái | % | Bằng chứng (file:line) |
|---|---|---|---|---|
| RAG retrieval (hybrid keyword+semantic) | Có | Tốt | 90% | `server/services/aiLocalKnowledgeService.ts:1131` (retrieveKnowledge), cosine+keyword scoring `:1143-1167` |
| Intent classify (how_to/troubleshoot/def/list…) | Có | Tốt | 85% | `aiLocalKnowledgeService.ts:370` classifyIntent |
| Citations + grounding (chống bịa) | Có | Tốt | 85% | guard `:593-608`; prompt rule `:889-894` |
| Role-aware prompt (worker/engineer/manager) | Có (backend) | **UI tắt** | 50% | prompt `:637-683`; **client hard-code** `client/src/components/AILocalChatBubble.tsx:45` (`FIXED_USER_ROLE="engineer"`) |
| Đa ngôn ngữ vi/en | Có | Tốt | 80% (thiếu zh) | detectLanguage `:354`; prompt vi/en `:665-683` |
| Streaming SSE token | Có | Tốt | 90% | `streamAnswer :1375`; endpoint `server/routes/aiLocalKnowledgeApi.ts` |
| Tool execution — **READ-ONLY** (9 tool) | Có | Tốt (chỉ đọc) | 80% | `server/services/aiLocalTools/handlers.ts:79-810`; registry `toolRegistry.ts:50` |
| Tool intent (heuristic + LLM JSON) | Có | Tốt | 80% | `aiLocalTools/intentClassifier.ts:163` + `:317` (GGUF grammar JSON) |
| Tool **WRITE-ACTION** (tạo/sửa/chạy) | **Không** | Thiếu | 0% | toolRegistry chỉ READ-ONLY (comment `toolRegistry.ts:9`) |
| Context-aware (trang/máy/SP đang chọn) | **Không** | Thiếu | 0% | endpoint chỉ nhận question/topK/history/userRole `aiLocalKnowledgeApi.ts:156-164` |
| SOP/Playbook walkthrough tương tác | **Không** (chỉ text RAG) | Thiếu | 15% | how-to dạng md `knowledge/domain/howto-*.md` (12 file) |
| KB coverage (feature/route/how-to) | Có | Khá | 70% | features 79 md, domain 12 how-to, chunks-stats `knowledge/chunks-stats.json` |
| KB auto-sync khi code đổi | **Không** | Thiếu | 0% | script thủ công `package.json` (`kb:extract/chunk/embed`) |
| Feedback thu thập | Có | Cơ bản | 40% | `aiLocalKbRouter.ts:177`; ghi `knowledge/feedback.jsonl` (`aiLocalKnowledgeApi.ts:18`) |
| Feedback → cải thiện KB (curation loop) | **Không** | Thiếu | 0% | chỉ append jsonl, không re-ingest |
| chat-assistant phụ (Phase 4.3) | Có | Trùng lặp | 60% | `server/services/aiChatAssistant.ts` (6 tool read-only riêng — **trùng** với aiLocalTools) |
| Specialist agent (dev copilot) | Có | Lệch mục tiêu | n/a | `aiSpecialistAgentService.ts` — code agent cho DEV (data-analyst/backend/frontend/qa), **không phải copilot nhân viên**, chỉ sinh text plan |
| GGUF engine (text/stream/JSON/embed/chat) | Có | Tốt | 90% | `aiGgufEngine.ts:466/522/584/1180/1111` |
| Confirm trước write-action (HITL) | **Không** | Thiếu | 0% | — (chưa có write-action) |
| Bubble phủ mọi trang | Một phần | Thiếu | 30% | mount chỉ `client/src/components/DashboardLayout.tsx` |

> Lưu ý kỹ thuật quan trọng: `aiLocalKbRouter.ts:59` gọi KB **qua HTTP localhost** (`fetchKbApi` → `/api/ai/local-kb/*`) chứ không gọi thẳng service. Còn chat bubble gọi trực tiếp `fetch('/api/ai/local-kb/stream')`. Có **2 đường vào song song** + **2 bộ tool read-only** (`aiLocalTools` vs `aiChatAssistant`) → cần hợp nhất.

---

## 3. Bảng GAP so với copilot/agentic enterprise chuẩn

| Năng lực copilot chuẩn | Hiện trạng dự án | GAP | Mức |
|---|---|---|---|
| Grounded RAG + citations | ✅ Có | Nhỏ — chỉ thiếu zh, thiếu re-rank | Thấp |
| Function calling / tool-use ĐỌC | ✅ 9 tool | Nhỏ | Thấp |
| **Agentic WRITE action** (điền form, trigger flow, tạo bản ghi) | ❌ Không | **Rất lớn** — cốt lõi mục tiêu nghiệp vụ | **Cao** |
| **Human-in-the-loop confirm** trước write | ❌ Không | Lớn — bắt buộc nếu mở write | **Cao** |
| **Permission/role-aware** thực thi | ⚠️ Role chỉ đổi giọng văn, UI tắt | Lớn — chưa gắn license/permission vào tool | **Cao** |
| Context-aware (trang/selection hiện tại) | ❌ Không | Lớn — copilot "đoán ý" theo ngữ cảnh | Cao |
| Plan-execute / ReAct nhiều bước | ❌ 1 tool/lượt | TB-Lớn | TB |
| **SOP/Playbook guided walkthrough** | ❌ Chỉ text | Lớn | Cao |
| Learning/feedback loop khép kín | ⚠️ Thu nhưng không dùng | Lớn | TB |
| In-app navigation (mở đúng trang) | ⚠️ Gợi ý đường dẫn text, không tự điều hướng | TB | TB |
| Đa ngôn ngữ vi/en/zh | ⚠️ vi/en | Nhỏ (thêm zh) | Thấp |
| Hiệu năng trên GPU nhỏ (4050 6GB) | ⚠️ GGUF ok, chưa có queue/limit rõ | TB | TB |

---

## 4. Kế hoạch theo workstream (C1–C8)

Quy ước: **[Tái dùng]** = mở rộng cái đã có; **[Làm mới]** = phải xây.

### C1 — KB phủ toàn diện + auto-sync (Ưu tiên: **Cao**)
- **Mục tiêu**: KB không lệch khi code/feature đổi; phủ đủ how-to/SOP từng chức năng; retrieval tốt hơn.
- **Việc**:
  - [Làm mới] Hook auto-sync: chạy `kb:extract → chunk → embed` **incremental** qua git pre-push hook hoặc CI step; chỉ re-embed chunk thay đổi (hash so sánh). File: `scripts/ai-kb/`, thêm `kb:sync-incremental.mjs`.
  - [Tái dùng] Mở rộng `extract-codebase-knowledge.mjs` để tự sinh stub how-to cho route mới chưa có doc (so route catalog vs `knowledge/features/`).
  - [Tái dùng] Thêm re-rank nhẹ (cross-encoder GGUF nhỏ hoặc rule) sau top-K để tăng precision.
  - [Làm mới] Coverage report: route nào / tool nào **chưa có** doc/SOP.
- **Nghiệm thu**: thay 1 feature → KB cập nhật tự động trong build kế tiếp; coverage ≥ 95% route có doc; retrieval top-1 hit cải thiện trên bộ eval hiện có (`aiEvalHarness.ts`).
- **Phụ thuộc**: không.

### C2 — Agentic tool EXECUTION (đọc + ghi có xác nhận) (Ưu tiên: **Cao**, đầu tư lớn)
- **Mục tiêu**: AI thực thi task: tạo máy/điểm đo, set spec/ngưỡng, chạy SPC/analysis, tạo báo cáo, build dataset/train, onboarding máy.
- **Việc**:
  - [Làm mới] Mở rộng `toolRegistry` thêm loại **write-tool** với cờ `mutates: true` + `requiredPermission` + `confirmTemplate`. File: `server/services/aiLocalTools/toolRegistry.ts`, handlers mới `aiLocalTools/writeHandlers.ts`.
  - [Làm mới] Mọi write-tool: trả về **"đề xuất hành động"** (preview/diff) → UI yêu cầu **người dùng bấm Xác nhận** → mới execute (HITL). Liên kết C7.
  - [Tái dùng] Gọi lại các service/router đã có (tạo machine, productModel, measurement-point, chạy SPC/report) thay vì viết lại logic — chỉ bọc thành tool.
  - [Tái dùng] Tận dụng `generateJSON` grammar-constrained của `aiGgufEngine.ts:584` để trích tham số write an toàn.
  - [Làm mới] Audit trail mọi write-action (đã có `auditTrailService.ts` — gắn vào).
- **Nghiệm thu**: AI tạo được 1 điểm đo + set USL/LSL qua hội thoại, có bước confirm, ghi audit, tôn trọng permission; từ chối khi thiếu quyền.
- **Phụ thuộc**: C5 (permission), C7 (confirm).

### C3 — Context-aware copilot (Ưu tiên: **Cao**, quick-win một phần)
- **Mục tiêu**: AI biết trang hiện tại + máy/sản phẩm đang chọn → gợi ý theo ngữ cảnh; bubble trên mọi trang.
- **Việc**:
  - [Làm mới] Thêm `context` vào payload stream (`{ route, selectedMachineCode?, selectedProductCode?, selectedLot? }`). File client: `AILocalChatBubble.tsx:307-312`; backend: `aiLocalKnowledgeApi.ts:156-164`, ký lại `streamAnswer/answerQuestion` (`aiLocalKnowledgeService.ts:1222/1375`) để nhận context và bơm vào prompt + tham số tool mặc định.
  - [Tái dùng] Dùng context để pre-fill tool args (vd đang ở trang máy AOI-01 → `get_machine_status` mặc định AOI-01).
  - [Làm mới] Mount `AILocalChatBubble` ở layout gốc để phủ mọi trang (hiện chỉ `DashboardLayout.tsx`).
- **Nghiệm thu**: hỏi "máy này sao rồi?" ở trang máy → trả lời đúng máy đang xem mà không cần nêu mã.
- **Phụ thuộc**: nhẹ.

### C4 — SOP/Playbook guidance tương tác (Ưu tiên: **TB-Cao**)
- **Mục tiêu**: AI dẫn dắt từng bước ("cài máy AOI mới", "tạo điểm đo + spec", "điều tra NG tăng").
- **Việc**:
  - [Làm mới] Định dạng playbook có cấu trúc (steps + action gắn tool C2 + checkpoint). Đặt trong `knowledge/workflows/` (hiện chỉ có README).
  - [Làm mới] State machine hội thoại theo bước (lưu tiến trình playbook trong session).
  - [Tái dùng] 12 how-to hiện có làm nội dung gốc chuyển thành playbook.
- **Nghiệm thu**: chạy trọn 1 playbook "tạo điểm đo + spec" với confirm mỗi bước.
- **Phụ thuộc**: C2, C3.

### C5 — Role-aware thực chất (Ưu tiên: **Cao**, quick-win)
- **Mục tiêu**: operator/engineer/manager khác nhau **phạm vi + ngôn từ + quyền thực thi**.
- **Việc**:
  - [Tái dùng] Bỏ hard-code `FIXED_USER_ROLE` ở `AILocalChatBubble.tsx:45`, lấy role thật từ auth context (đã có `ctx.user`).
  - [Làm mới] Gắn role → giới hạn tool/write-action được phép (map sang permission C2).
- **Nghiệm thu**: operator không gọi được write-tool dành cho engineer; giọng văn đổi theo role.
- **Phụ thuộc**: C2 (cho phần giới hạn write).

### C6 — Learning / feedback loop khép kín (Ưu tiên: **TB**, offline)
- **Mục tiêu**: phản hồi 👎 + câu hỏi không trả lời được → cải thiện KB.
- **Việc**:
  - [Tái dùng] `feedback.jsonl` đã có; [Làm mới] tool curation: gom câu 👎/low-confidence/"không tìm thấy" → báo cáo gap → gợi ý doc cần bổ sung.
  - [Làm mới] Trang admin review feedback (đã có `AILocalKnowledgeBasePage.tsx` để mở rộng).
- **Nghiệm thu**: dashboard liệt kê top câu hỏi fail tuần qua + đề xuất doc.
- **Phụ thuộc**: C1.

### C7 — An toàn + tin cậy (Ưu tiên: **Cao**, gắn với C2)
- **Mục tiêu**: confirm trước write, trích dẫn, grounded, giới hạn theo license/permission, thêm zh.
- **Việc**:
  - [Làm mới] HITL confirm UI cho mọi write (preview → xác nhận).
  - [Tái dùng] Grounding guard `:593-608` giữ nguyên; [Làm mới] gắn license-service (`server/license/license-service.ts`) chặn tool theo gói.
  - [Làm mới] Thêm tiếng Trung (zh) vào detectLanguage + prompt.
- **Nghiệm thu**: write luôn cần confirm; tool bị chặn khi license/permission không đủ; hỏi tiếng Trung trả lời zh.
- **Phụ thuộc**: C2, C5.

### C8 — Hiệu năng phần cứng (RTX 4050 6GB → 4090) (Ưu tiên: **TB**)
- **Mục tiêu**: chọn model phù hợp, streaming, hàng đợi tránh OOM.
- **Việc**:
  - [Tái dùng] GGUF engine + keep-alive đã có; [Làm mới] hàng đợi request (1 generate/lúc trên 6GB) + chọn model theo VRAM (quant nhỏ cho 4050, lớn cho 4090).
  - [Tái dùng] `aiJobQueue.ts` đã tồn tại — gắn cho luồng chat.
- **Nghiệm thu**: không OOM khi 3 user hỏi đồng thời trên 4050; TTFT ổn định.
- **Phụ thuộc**: không.

### C0 — Hợp nhất kiến trúc (Ưu tiên: **TB**, nợ kỹ thuật)
- Hợp nhất `aiChatAssistant.ts` (6 tool) vào `aiLocalTools` (9 tool) để hết trùng lặp; bỏ đường HTTP localhost trong `aiLocalKbRouter.ts` nếu không cần. Làm trước/song song C2 để tránh phình.

---

## 5. Lộ trình theo giai đoạn

**Giai đoạn 1 — Quick win (1-2 tuần)**: C3 (context + mount bubble mọi trang) + C5 (bật role thật) + C1 (auto-sync incremental) + zh (C7 phần ngôn ngữ). → cảm nhận "copilot thông minh hơn" ngay, rủi ro thấp, không đụng write.

**Giai đoạn 2 — Nền tảng an toàn write (2-3 tuần)**: C7 (HITL confirm + permission/license gate) + C0 (hợp nhất tool) + C8 (queue). → dọn nền để mở write an toàn.

**Giai đoạn 3 — Agentic execution (3-5 tuần)**: C2 (write-tool theo từng nhóm: điểm đo/spec trước, rồi máy, rồi report/train) + C4 (playbook trên các write-tool). → đạt mục tiêu copilot thực thi.

**Giai đoạn 4 — Học liên tục (song song)**: C6 (curation loop) + mở rộng C1 coverage.

---

## 6. Rủi ro

- **Write-action sai gây hỏng dữ liệu sản xuất** → bắt buộc HITL confirm + audit + permission + có thể "dry-run/preview" trước (C2/C7).
- **LLM trích sai tham số write** (vd USL/LSL nhầm) → grammar-constrained JSON + validate zod + người xác nhận; không auto-execute.
- **KB lệch code** → C1 auto-sync; nếu không làm, copilot dẫn sai đường UI.
- **Quá tải GPU 6GB** → queue + chọn model nhỏ (C8); tránh chạy vision sidecar + chat đồng thời.
- **Phình kiến trúc** (2 chat service, 2 đường vào) → C0 hợp nhất sớm.
- **Quyền/license bị bỏ qua** → gate tập trung trong tool layer, không rải rác.

---

## 7. Phần cứng

- **Hiện tại RTX 4050 6GB**: đủ cho 1 luồng QA GGUF quant (7B-instruct Q4) + embed mxbai; **cần queue** để không OOM khi nhiều người dùng + không chạy đồng thời với vision sidecar. Streaming đã giúp TTFT.
- **Sắp lên 4090 (24GB)**: cho phép model QA lớn hơn (14B), giữ nhiều model nóng (QA + embed + classifier), tăng concurrency. Nên có config chọn model theo VRAM (C8).

---

## Phụ lục — Bằng chứng đọc code chính

- RAG/orchestration: `server/services/aiLocalKnowledgeService.ts` (retrieve `:1131`, answerQuestion `:1222`, streamAnswer `:1375`, prompt role `:637`, grounding guard `:593`).
- Tool read-only: `server/services/aiLocalTools/handlers.ts:79-810` (9 tool), `toolRegistry.ts` (READ-ONLY), `intentClassifier.ts:163/317`, `index.ts:24` (tryExecuteTool).
- Chat phụ trùng lặp: `server/services/aiChatAssistant.ts` (6 tool read-only riêng).
- Dev code agent (không phải copilot nhân viên): `server/services/aiSpecialistAgentService.ts`.
- API/route: `server/routes/aiLocalKnowledgeApi.ts` (stream/ask/feedback), `server/routers/aiLocalKbRouter.ts` (proxy HTTP).
- Client: `client/src/components/AILocalChatBubble.tsx` (role hard-code `:45`, payload `:307`), mount `DashboardLayout.tsx`.
- KB pipeline (thủ công): `scripts/ai-kb/*` + `package.json` (`kb:*`).
- KB nội dung: `knowledge/features/` (79 md), `knowledge/domain/howto-*.md` (12), `chunks-stats.json` (1.195 chunk), `embeddings-meta.json` (gguf mxbai 1024-dim).
- GGUF engine: `server/services/aiGgufEngine.ts` (`generateText/chatCompletion/generateJSON/generateEmbedding/isGgufAvailable`).
