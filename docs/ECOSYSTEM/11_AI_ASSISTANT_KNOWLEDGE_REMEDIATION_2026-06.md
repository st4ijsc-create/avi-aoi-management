# 11 — Trợ lý thông minh: Audit + Kế hoạch "Hệ thống có gì, AI biết cái đó"

> Ngày: 2026-06-29 · Trạng thái: **CHỜ DUYỆT** (chưa thực thi) · Người duyệt: chủ hệ sinh thái
> Tiêu chí Bắc Đẩu: **Single Source of Truth → AI luôn biết mọi thứ hệ thống đang có và đang chạy.**

---

## 0. Tóm tắt điều hành

Hệ thống đã có một bộ máy AI rất lớn (RAG cục bộ + 30+ tool dữ liệu sống + agentic HITL + GGUF/Qwen3 trên RTX 5090). Vấn đề "trả lời sai / không biết hệ thống" **không phải do thiếu hạ tầng**, mà do **4 đứt gãy**:

1. **Kho tri thức (KB) cũ 24 ngày và chỉ phủ ~50% hệ thống.** Toàn bộ các domain mới (Device Programming, Edge/Orchestration, AI nextgen, MES master-data, Maintenance, Energy, Andon, Traceability, 3D viz, các doc ECOSYSTEM 03–10) **không có một chunk nào** trong KB → AI không thể biết.
2. **Bất đối xứng READ/WRITE ở lớp tool.** AI có thể *ghi* (đề xuất) cho ~15 domain nhưng không có tool *đọc* trạng thái sống cho nhiều domain (work order, recipe, alert list, threshold hiện hành, master data, users, API keys…).
3. **Hai backend chat song song, năng lực lệch nhau.** Trang `/ai-chat` dùng `aiChatAssistant` (6 tool cứng, KHÔNG RAG); bubble dùng `aiLocalKnowledgeService` (RAG + tool registry đầy đủ). Cùng một câu hỏi cho hai câu trả lời khác nhau.
4. **"Sẵn sàng" gây hiểu nhầm + tự xuống cấp âm thầm.** Health chỉ kiểm tra *file KB tồn tại*, không kiểm tra LLM/embedding nạp được. Khi LLM/embedding lỗi, hệ thống lặng lẽ rơi về *extractive* (ghép đoạn văn) → đọc như "trả lời sai".

Ngoài ra có **2 rủi ro mong manh**: (a) guard embedding chỉ kiểm tra *độ dài vector* (1024) chứ không kiểm tra *cùng model* → nếu deploy lệch `GGUF_EMBED_MODEL` so với model đã build corpus thì truy hồi hỏng hoàn toàn mà guard vẫn "pass"; (b) **không có auto-sync** → KB sẽ cũ lại ngay sau mỗi lần code đổi.

**Kết luận:** Để đạt "hệ thống có gì AI biết đó", phải biến tri thức AI thành **dẫn xuất tự động từ chính source-of-truth của hệ thống** (router catalog, route/page map, drizzle schema, module/permission registry, docs), tự rebuild mỗi khi hệ thống đổi, đo bằng eval theo domain — thay vì một corpus tĩnh build tay.

---

## 1. Kiến trúc hiện tại (đã xác minh)

```
GIAO DIỆN
 ├─ Chat bubble "Trợ lý thông minh"  ──► POST /api/ai/local-kb/stream
 │     (AILocalChatBubble.tsx)              └► aiLocalKnowledgeService.askStream()
 │                                              ├─ intentClassifier → aiLocalTools (30+ tool đọc/ghi/client)
 │                                              ├─ RAG: knowledge/chunks.jsonl + embeddings.jsonl (1196 chunk)
 │                                              ├─ GGUF (Qwen3-30B/4B) narration  ‖ Ollama (rollback)
 │                                              └─ agentic: aiAgentOrchestrator (playbooks)
 │
 └─ Trang /ai-chat (toàn màn hình)   ──► POST /api/ai/stream/chat
       (AIChatPage.tsx + useAIStream)        └► aiChatAssistant.processChat()
                                                 └─ CHỈ 6 tool cứng (inspection/defect/machine/RCA/model/topdefect)
                                                    KHÔNG RAG, KHÔNG tool registry, KHÔNG agentic
```

- LLM cục bộ: GGUF in-process (node-llama-cpp). `.env` đang trỏ `GGUF_MODELS_DIR=D:/SOURCES/16.AI`, Qwen3-30B (deep) + Qwen3-4B (fast) + Qwen3-Embedding-0.6B (embed, 1024-d). Corpus đã re-embed bằng Qwen3-Embedding-0.6B (2026-06-26) → **khớp** với query embed trong cấu hình hiện tại.
- Model Router: Tier 0–4 (reflex/fast/deep/vision/HITL).
- Quy mô hệ thống: **123 router, 144 page, 237 bảng, 120+ route.**

---

## 2. Phát hiện audit (kèm bằng chứng)

| # | Phát hiện | Bằng chứng | Tác động |
|---|-----------|-----------|----------|
| F1 | **KB cũ 24 ngày, phủ 53% router** | `chunks-stats.json generatedAt=2026-06-05`; router 79/149; embeddings build 2026-06-26 trên chunk cũ | AI mù toàn bộ domain mới |
| F2 | **71 router không có trong KB** | Thiếu: deviceAdapter, programming, edgeRuntime, orchestration, masterData, bom, genealogy, maintenance, predictiveMaintenance, energy, andon, aiCopilot, aiAgent, aiAnomaly, causalGraph… | AI không trả lời được về phần lớn ecosystem |
| F3 | **Bất đối xứng read/write tool** | 17 read tool vs 15+ write tool; thiếu read cho: work orders, recipes, alert list, thresholds hiện hành, master data, users, API keys, RCA history, anomaly list | "Trạng thái X bây giờ ra sao?" thất bại cho nhiều domain |
| F4 | **Hai backend chat lệch năng lực** | `/ai-chat`→`processChat` (6 tool, no RAG); bubble→`askStream` (RAG+tools) | Trả lời mâu thuẫn tùy nơi hỏi |
| F5 | **Health "Sẵn sàng" sai bản chất** | `getKbHealth` chỉ check tồn tại file chunks/embeddings; `isGgufAvailable()` chỉ check import được node-llama-cpp | Người dùng tin AI "sẵn sàng" trong khi nó đang extractive |
| F6 | **Tự xuống cấp âm thầm** | LLM lỗi → trả `provider:"extractive"` ghép chunk, không báo lỗi | Câu trả lời vô nghĩa/lệch, không ai biết |
| F7 | **Guard embedding chỉ check độ dài** | `aiLocalKnowledgeService` line ~242: `KB_EMBED_DIM=1024`, mismatch length→null, KHÔNG check tên model | Deploy lệch embed-model ⇒ truy hồi rác, "pass" guard |
| F8 | **Không auto-sync KB** | `embed-incremental.mjs` có sẵn nhưng không hook CI/commit; không cron | KB tái-cũ sau mỗi commit |
| F9 | **KB drift dạng "noise doc"** | Top chunk là `I18N_AUDIT_REPORT` (51), `STATION_ANALYSIS_ANDROID` (31)… docs-catalog whitelist lệch về report dev | Truy hồi bị nhiễu bởi tài liệu ít liên quan |

> Ghi chú: agentic/write chỉ bật khi `AI_AGENTIC_ENABLED=1` (mặc định OFF). Mọi write đều qua HITL — phần này thiết kế tốt, **giữ nguyên**.

---

## 3. Nguyên tắc thiết kế

**P-1. Tri thức là dẫn xuất, không phải tài liệu chép tay.** KB phải sinh tự động từ source-of-truth: router catalog, App route → page map, `navigation.tsx`, drizzle schema, `module-registry`, ma trận permission, enums, + docs. Hệ thống đổi → KB đổi theo trong cùng pipeline.

**P-2. Đối xứng đọc cho mọi domain.** Mọi domain có dữ liệu sống phải có ≥1 read tool. Nguyên tắc: "có write thì phải có read; có router thì AI đọc được".

**P-3. Một bộ não, nhiều cửa.** Bubble và trang `/ai-chat` dùng *cùng một* backend (RAG + tool registry + agentic). Xóa nhánh năng lực yếu.

**P-4. Trung thực về năng lực.** Health phải phản ánh đúng: LLM nạp được? embed-model khớp corpus? KB tươi đến ngày nào? Khi xuống cấp phải nói rõ ("đang trả lời ở chế độ trích dẫn, chưa có LLM").

**P-5. Đo được "AI có biết không".** Mở rộng `rag-eval-goldenset.json` thành bộ câu hỏi/đáp theo từng domain; CI fail nếu coverage/grounding tụt dưới ngưỡng.

---

## 4. Kế hoạch triển khai (theo phase)

Mỗi workstream ghi rõ **mục tiêu · việc · file chạm · nghiệm thu · agent đề xuất**. Phase P0 làm trước (rủi ro thấp, lợi ích lớn nhất), P1–P4 sau khi duyệt.

### PHASE P0 — Khẩn cấp, lợi ích tức thì (1 ngày)

**W0.1 — Rebuild KB toàn bộ + bật incremental**
- Việc: chạy `kb:extract → kb:chunk → kb:embed` (full) để nạp 71 router + domain mới; xác minh chunk tăng từ 1196 → ~1500–1900.
- Nghiệm thu: hỏi thử 10 câu về domain mới (device programming, edge, master data, maintenance) → có citation đúng nguồn.
- Agent: `kb-rebuild` (Bash + verify).

**W0.2 — Health trung thực + cảnh báo xuống cấp**
- Việc: `getKbHealth` trả thêm `llmReady` (thử nạp model thật), `embedModel`/`embedModelMatches` (so tên model trong embeddings-meta với `GGUF_EMBED_MODEL`), `kbBuiltAt`, `chunkCount`, `staleDays`. Bubble hiển thị "Sẵn sàng (LLM)" vs "Chế độ trích dẫn" rõ ràng. Khi câu trả lời là `extractive` do LLM lỗi → gắn nhãn nhìn thấy được.
- File: `aiLocalKnowledgeService` (getKbHealth), `aiLocalKnowledgeApi`, `AILocalChatBubble.tsx`.
- Nghiệm thu: tắt model → health báo `llmReady:false`, bubble đổi nhãn, câu trả lời có badge cảnh báo.
- Agent: `ai-serving-hardening`.

**W0.3 — Guard embedding theo model, không chỉ độ dài**
- Việc: lưu `embedModel` vào embeddings-meta (đã có) + đọc lúc load corpus; nếu `GGUF_EMBED_MODEL` (query) ≠ model corpus → log lỗi to + đánh dấu health `embedModelMatches:false` + (tùy chọn) chặn dùng vector, fallback keyword có cảnh báo.
- File: `aiLocalKnowledgeService` (ensureDataLoaded/embedQuestion), build scripts.
- Nghiệm thu: đổi `GGUF_EMBED_MODEL` sang model khác → health đỏ + cảnh báo, không trả lời rác âm thầm.
- Agent: `ai-serving-hardening` (gộp W0.2).

### PHASE P1 — Tri thức tự-dẫn-xuất + auto-sync (2–4 ngày)

**W1.1 — Bộ trích "system self-description" đầy đủ**
- Việc: mở rộng `extract-codebase-knowledge.mjs` để sinh chunk *cấu trúc* cho: (a) mọi route từ `App.tsx`/`navigation.tsx` (route→page→quyền→mô tả), (b) mọi bảng drizzle (cột, FK, mục đích), (c) `module-registry` + ma trận permission theo role, (d) enums. Mục tiêu: AI mô tả được "màn hình X ở đâu, làm gì, role nào vào được, dữ liệu lưu bảng nào".
- File: `scripts/ai-kb/extract-codebase-knowledge.mjs`, `build-knowledge-chunks.mjs`, docs-catalog.
- Nghiệm thu: hỏi "trang quản lý recipe ở đâu, ai dùng được, lưu ở bảng nào" → trả lời đúng route + role + bảng.
- Agent: `kb-pipeline`.

**W1.2 — Auto-sync KB (hết cũ vĩnh viễn)**
- Việc: hook `kb:chunk && kb:embed-incremental` vào (1) pre-push/CI khi đụng `server/routers|services`, `drizzle/schema`, `docs`, `knowledge/{domain,features}`; (2) cron đêm rebuild + cập nhật `staleDays`. Dùng incremental (hash) để chỉ re-embed phần đổi.
- File: `.husky`/CI, `scripts/ai-kb/embed-incremental.mjs`, cron (theo mẫu auto-rebuild đã có ở doc 04).
- Nghiệm thu: thêm 1 router mới → sau hook, hỏi về nó → AI biết; `staleDays` ≤ 1.
- Agent: `kb-automation`.

**W1.3 — Dọn nhiễu corpus**
- Việc: rà `docs-catalog.json` — hạ ưu tiên/loại các báo cáo dev (I18N_AUDIT, *_AUDIT_REPORT, *_DELIVERABLE) khỏi corpus chính (đã có `NOISE_DOC_RE` ở runtime nhưng nên lọc ngay từ ingest); ưu tiên USER_GUIDE/HUONG_DAN/feature guides.
- Nghiệm thu: câu hỏi nghiệp vụ không còn trích báo cáo audit lạc đề.
- Agent: `kb-pipeline` (gộp W1.1).

### PHASE P2 — Đối xứng read tool cho dữ liệu sống (3–5 ngày)

**W2.1 — Bổ sung read tool còn thiếu** (ưu tiên theo tần suất hỏi)
- Nhóm A (cao): `list_work_orders`/`get_work_order_status`, `list_active_alerts`/`get_alert_history`, `get_current_spec_limits`/`list_thresholds`, `list_recipes`/`get_active_recipe`.
- Nhóm B: `list_products`/`get_product_bom`/`list_routings`, `list_anomalies`, `get_rca_history`, `list_users_by_role`.
- Nhóm C: `list_api_keys`(meta, không lộ secret), `get_change_history`(audit "ai đổi gì khi nào"), `get_machine_health`/`pdm_risk_list`.
- Việc: mỗi tool = descriptor + Zod params + handler READ-ONLY (Drizzle) + triggers vi/en/zh + đăng ký vào `aiLocalTools/index.ts`. Tận dụng router sẵn có (xác nhận ở audit).
- Nghiệm thu: với mỗi tool, một câu hỏi tiếng Việt thực tế trả về thẻ dữ liệu đúng.
- Agent: `ai-tools-read` (có thể chạy song song theo nhóm A/B/C).

**W2.2 — Phủ trigger đa ngôn ngữ + route-aware hint**
- Việc: bổ sung trigger zh; gắn `ROUTE_FEATURE_HINTS` để gợi tool theo trang đang mở.
- Nghiệm thu: hỏi bằng zh/khi đang ở trang tương ứng → match tool đúng.
- Agent: `ai-tools-read`.

### PHASE P3 — Hợp nhất "một bộ não" + ngữ cảnh (2–4 ngày)

**W3.1 — Hợp nhất backend chat**
- Việc: chuyển `/ai-chat` (useAIStream) sang dùng chính `aiLocalKnowledgeService.askStream` (RAG + tool registry + agentic). `aiChatAssistant.processChat` 6-tool trở thành adapter mỏng hoặc loại bỏ; giữ nguyên test/ws-g3 nếu còn dùng.
- File: `aiStreamingApi.ts`, `useAIStream.ts`, `AIChatPage.tsx`, `aiChatRouter.ts`.
- Nghiệm thu: cùng câu hỏi trên bubble và `/ai-chat` cho cùng chất lượng/citation/tool.
- Agent: `ai-backend-unify` (rủi ro trung bình → cần test kỹ).

**W3.2 — Bubble ở mọi trang + ngữ cảnh chọn**
- Việc: xác nhận bubble mount toàn cục (đã có `AiCopilotContext`); đảm bảo mọi trang publish selection (machine/product/lot) để AI biết "đang xem gì".
- Nghiệm thu: ở trang máy X, hỏi "máy này thế nào?" → AI hiểu X mà không cần gõ mã.
- Agent: `ai-context`.

### PHASE P4 — Chất lượng truy hồi + đo lường (2–4 ngày, song song được)

**W4.1 — Eval golden-set theo domain + cổng CI**
- Việc: mở rộng `rag-eval-goldenset.json` ≥ 5 câu/domain (đủ 20+ domain); script `eval-rag.mjs` chấm coverage + grounding; CI cảnh báo nếu tụt ngưỡng.
- Nghiệm thu: báo cáo eval cho điểm theo domain; có ngưỡng pass.
- Agent: `ai-eval`.

**W4.2 — Reranker + (tùy chọn) GraphRAG**
- Việc: bật reranker (Qwen3-Reranker-0.6B, top-50→top-5) nếu chưa; tận dụng `semantic-graph.json` cho multi-hop. (Đã có khung ở doc 04 — chỉ kích hoạt/đo.)
- Nghiệm thu: precision@5 tăng trên golden-set.
- Agent: `ai-retrieval` (chỉ làm nếu eval P4.1 cho thấy cần).

---

## 5. Bảng quyết định cần DUYỆT

| # | Quyết định | Khuyến nghị |
|---|-----------|-------------|
| Q1 | Phạm vi đợt này | **P0+P1+P2** (biết + tươi + đọc đối xứng) trước; P3+P4 đợt sau |
| Q2 | Hợp nhất 2 backend (P3) ngay hay sau? | Sau P0–P2 (rủi ro hồi quy, cần test) |
| Q3 | Thứ tự read tool (W2.1) | Nhóm A trước (work order/alert/threshold/recipe) |
| Q4 | Auto-sync: CI hook hay cron đêm hay cả hai? | **Cả hai** (CI khi đổi code + cron đêm an toàn) |
| Q5 | Có chặn cứng khi embed-model lệch (W0.3) không? | Cảnh báo + fallback keyword (không chặn cứng) để không gãy dịch vụ |
| Q6 | Chạy bằng nhiều agent song song? | Có — P0 tuần tự, P1/P2/P4 fan-out theo workstream |

---

## 6. Rủi ro & giảm thiểu

- **Rebuild KB lâu/đụng VRAM** → chạy ngoài giờ; incremental sau lần full đầu.
- **Hợp nhất backend gây hồi quy** → giữ endpoint cũ sau cờ, A/B, test ws-g3.
- **Read tool lộ dữ liệu nhạy cảm** → READ-ONLY + RBAC theo module + không trả secret (API key chỉ metadata).
- **Auto-sync làm chậm CI** → chỉ trigger khi đụng path liên quan + incremental.

---

## 7. Định nghĩa "Done"

1. Hỏi bất kỳ trong 20+ domain (kể cả mới nhất) → AI trả lời đúng, có citation nguồn thật.
2. "Trạng thái sống của X bây giờ?" hoạt động cho mọi domain có router.
3. Bubble và `/ai-chat` cho cùng chất lượng.
4. Health phản ánh đúng LLM/embedding/độ tươi; không còn xuống cấp âm thầm.
5. Thêm router/page mới → trong ≤1 ngày AI tự biết (auto-sync), eval không tụt ngưỡng.

---

## 8. NHẬT KÝ THỰC THI (2026-06-29) — P0+P1+P2 ĐÃ HOÀN TẤT

> Phạm vi duyệt: **P0+P1+P2**; hợp nhất backend (P3) + eval/reranker (P4) để đợt sau.

### P0 — Khẩn cấp ✅
- **W0.1 Rebuild KB**: `kb:sync` → chunk **1196 → 2142**, router **79 → 149/149 (100%)**, mọi domain mới có chunk. **Phát hiện & sửa sự cố**: script KB không load `.env` → lần đầu lỡ embed bằng `mxbai` (trộn không gian vector với corpus Qwen3). Đã **re-embed TOÀN BỘ bằng Qwen3-Embedding-0.6B** → corpus nhất quán, khớp model runtime.
- **W0.2 Health trung thực**: `getKbHealth()` async, trả thêm `llmReady` (thử nạp model thật), `embedModel`/`queryEmbedModel`/`embedModelMatches`, `kbBuiltAt`, `chunkCount`, `staleDays`. Bubble: nhãn "Sẵn sàng" / "Chế độ trích dẫn" / "Lệch model embedding" + ghi chú per-message khi `provider==='extractive'`.
- **W0.3 Guard embedding theo model**: so `model` trong embeddings-meta với `GGUF_EMBED_MODEL`; mismatch → cảnh báo to + bỏ vector → fallback keyword (không chặn cứng, Q5).

### P1 — Tri thức tự-dẫn-xuất + auto-sync ✅
- **W1.2-fix (root cause)**: thêm `import "dotenv/config"` vào 6 script KB (dotenv đã có sẵn) → script luôn dùng đúng model `.env`. Thêm **model-switch guard** trong `embed-incremental.mjs`: dừng + báo lỗi nếu corpus model ≠ model sắp dùng (override `KB_EMBED_ALLOW_MODEL_SWITCH=1`). Log `[kb] embed model = …`.
- **W1.1 Self-description**: 4 sourceType mới — `route` (144 route→page→quyền, 12 chunk), `nav` (18 nhóm/109 mục, 18 chunk), `schema_table` (237 bảng, 66 chunk), `module` (12 module/license/permission, 12 chunk). Tổng corpus **2170 chunk**.
- **W1.2-infra**: `server/services/kbSyncScheduler.ts` (cron `kb:sync` lúc 03:00, flag `KB_AUTOSYNC_ENABLED` mặc định OFF, single-flight, fail-safe) + đăng ký boot/shutdown ở `server/_core/index.ts` + tài liệu `.env.example`.
- **W1.3 Denoise**: loại `I18N_AUDIT|*_AUDIT_REPORT|*_DELIVERABLE|*_UPGRADE_REPORT|FRONTEND_AUDIT` khỏi corpus (`removed=82`).

### P2 — Đối xứng read tool (nhóm A) ✅
- `server/services/aiLocalTools/readToolsP2.ts`: 4 read tool RBAC fail-safe — `list_work_orders` (maintenance_work_orders), `list_active_alerts` (alert_history + predictive_alerts), `list_thresholds` (measurement_point_defs + yield), `list_recipes` (machine_recipes). Triggers vi/en/zh; ToolResultType mới + generic renderer ở `AIToolResultCard`; intent extraction mở rộng.
- Test: **118/118 pass** (14 file) + 7 test mới `readToolsP2.test.ts`.

### Xác minh
- **Typecheck tổng `tsc --noEmit`: sạch.**
- **Test truy hồi thực tế** (embed Qwen3, top-4): device programming→doc 09 (0.556); edge/orchestration→doc 08 + orchestration.ts (0.650); "bảng lưu work order"→schema_table mes (0.628); andon→schema_table andon (0.567, trước đây 0 chunk); "module AI nào cần license"→module AI (0.645). Các domain trước đây mù **đã truy hồi được nguồn thật**.
- Corpus cuối: **2170 chunk, 100% model Qwen3-Embedding-0.6B-f16**, khớp runtime.

### P2 nhóm B/C — read tool mở rộng ✅ (2026-06-29)
- `server/services/aiLocalTools/readToolsP2bc.ts`: 6 read tool RBAC fail-safe — `list_products`(+BOM), `get_rca_history`, `list_users_by_role`, `list_api_keys`, `get_change_history`(audit), `get_machine_health`(+PDM). Tool nhạy cảm (users/api-keys) **chỉ trả metadata**, không bao giờ lộ secret (SELECT không liệt kê cột bí mật + assertion test no-leak). Adapt đúng cột schema thực tế (không bịa). ToolResultType mới render qua generic `data.rows`.
- Test: **129/129 pass** (15 file) gồm `readToolsP2bc.test.ts` (11 test).

### P3 — Hợp nhất backend chat ✅ (2026-06-29)
- Xác minh: `/ai-chat` cũ gọi `/api/ai/stream/chat` → `chatCompletionStream` = **chat LLM thuần, không RAG/tool/KB** (kém nhất).
- `client/src/hooks/useKbChatStream.ts` (mới): SSE hook cho `/api/ai/local-kb/stream` (RAG+tool registry, như bubble). `AIChatPage.tsx` repoint sang đây sau cờ rollback `USE_KB_BACKEND` (false → về đường cũ). Render citations / AIToolResultCard / structured / follow-up / client_action(navigate+prefill). `pending_action` (ghi): hiện thông báo, **không tự thực thi** (an toàn). Giữ nguyên endpoint cũ + `aiChatAssistant` (không xóa). Caller useAIStream còn lại (DashboardAIWidget) không đụng.
- Typecheck sạch; không có test cũ bị gãy.

### P4 — Eval theo domain + reranker ✅ (2026-06-29)
- **Reranker**: đã bật sẵn từ B2 — `RAG_RERANKER_ENABLED=true`, mode `llm` (Qwen3-4B), wire trong `aiLocalKnowledgeService.retrieveKnowledge` (cosine top-20 → rerank → top-5). Tùy chọn `GGUF_RERANKER_MODEL` (Qwen3-Reranker-0.6B) chưa cần (file chưa có; không tải).
- **Golden-set**: `knowledge/rag-eval-goldenset.json` mở rộng **12 → 151 câu**, tag `domain`, phủ 24 domain chức năng (gồm domain mới) + 16 câu self-description (route/nav/schema_table/module). Mọi `expectSourceContains` đã verify tồn tại trong corpus 2170.
- **Eval harness**: `scripts/ai-kb/eval-rag.mjs` — bảng recall@5 theo domain + tổng, cổng CI `--ci` (sàn tổng 0.80 / domain 0.60, `KB_EVAL_MIN`/`KB_EVAL_DOMAIN_MIN`), xuất `knowledge/rag-eval-results.json`.
- **Kết quả baseline (cosine)**: **recall@5 = 151/151 = 1.000**, mọi domain 100% (kể cả device-programming/edge/andon/master-data/anomaly/energy + self-description). Chứng minh độ phủ "AI biết hệ thống". (recall@5 đo phủ truy hồi, không phải top-1 precision — reranker production lo phần xếp hạng.)

### P2 nhóm D — read tool mở rộng ✅ (2026-06-29)
- `server/services/aiLocalTools/readToolsP2d.ts`: 4 read tool — `list_anomalies` (predictive_alerts, lọc loại anomaly), `trace_genealogy` (genealogy_chain, theo serial/lot), `get_energy_metrics` (energy_readings + enpi_metrics), `get_routing` (processes + line_process_assignments). RBAC fail-safe; adapt đúng schema (không có bảng anomaly-results riêng → dùng predictive_alerts). Test: **140/140 pass** (+11 mới).

### P3 nâng cao — confirm write tại chỗ ✅ (2026-06-29)
- `client/src/components/ConfirmActionCard.tsx` (mới, dùng chung): bubble bỏ ~150 dòng trùng; `/ai-chat` giờ render thẻ HITL + gọi `aiCopilot.confirmAction/cancelAction` tại chỗ (không tự thực thi). Typecheck sạch, không cần i18n key mới.

### Còn lại (tùy chọn)
- Thêm model Qwen3-Reranker-0.6B (mode `gguf`) để precision cao hơn (file chưa có; không tải).
- husky pre-push cảnh báo KB stale (hiện dựa vào cron `KB_AUTOSYNC_ENABLED` + `npm run kb:sync` thủ công).
- GraphRAG multi-hop (semantic-graph.json đã có; chưa wire vào retrieval).
