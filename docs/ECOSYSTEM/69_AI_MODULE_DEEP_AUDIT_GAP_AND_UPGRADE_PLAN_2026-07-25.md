# Doc 69 — Audit sâu, GAP & Kế hoạch nâng cấp hoàn thiện MODULE "AI"

> **Trạng thái: ★ ĐÃ DUYỆT + THỰC THI TOÀN BỘ 6 GIAI ĐOẠN + PUSHED (cập nhật 2026-07-27).** Xem "TRẠNG THÁI THỰC THI" ngay dưới.
> _(Bản audit gốc 2026-07-25 là READ-ONLY — không sửa code; toàn bộ code nâng cấp được thực thi sau khi duyệt, dưới đây.)_
>
> Ngày: 2026-07-25 · Nhánh: `feat/hmi-dep` · Người lập: audit 6-agent song song + tổng hợp.
> Trọng điểm theo yêu cầu: **4 AI** — (#1) phân tích dữ liệu kiểm tra + báo cáo · (#2) trợ lý hỏi-đáp
> hệ sinh thái · (#3) copilot lập trình nhúng trong editor · (#4) agents làm tác vụ hệ thống thay người.
> Cộng 2 phân hệ nền: **nền tảng model dùng chung** và **engine thị giác/ML + MLOps**.
>
> Định hướng đã chốt với chủ đầu tư (25/07/2026): **(1) cân bằng nền tảng + năng lực**;
> **(2) cả 4 AI đều dẫn dắt các wave**; **(3) AI #4 tiến tới agent loop thật (observe→replan)**.
> Bám bối cảnh thương mại hoá doc 66 (Machine/Line/Site Edition, AI là dòng doanh thu, local-first air-gapped).
>
> **CẬP NHẬT (25/07/2026 — vòng 2, mở rộng phạm vi thành "HỆ AI LOCAL HOÀN CHỈNH"):** chủ đầu tư bổ sung 6 yêu cầu
> trải-nghiệm: (1) UX gắn kết, hết "chức năng một nơi AI một nẻo"; (2) **trợ lý vận hành** (hiểu tường tận *cách vận hành*
> chức năng, chỉ trong phạm vi hệ sinh thái — không phải bách khoa toàn thư); (3) training local + **sinh model chuyên dụng**;
> (4) **giao diện trực quan cho AI Agents** (tham chiếu Tencent *Marvis*: "văn phòng" agent + đồng hồ token/tiết-kiệm-local);
> (5) **studio training AI local từ tài liệu/video/web**; (6) tái cấu trúc IA các trang AI (tách trang, đưa vào menu trái,
> hết chật chội). Đã khảo sát bằng **3 agent bổ sung**. Kế hoạch mở rộng nằm ở **PHẦN B** (cuối doc); Phần A giữ nguyên.

---

## ★ TRẠNG THÁI THỰC THI (cập nhật 2026-07-27)

**TOÀN BỘ lộ trình 6 giai đoạn (§B6) ĐÃ THỰC THI + PUSHED lên `feat/hmi-dep` (HEAD `3bd8f6be`).** Thực thi bằng
subagent-driven-development: mỗi task = implementer → adversarial-review → fix → re-review; UI được kiểm chứng LIVE
(Playwright). ~35 chu kỳ SDD. Whole-branch `tsc` sạch. Final cross-task review Wave-5 = CLEAN, không blocker.

| GĐ | Nội dung | Trạng thái | Commit mốc |
|---|---|---|---|
| 1 | Wave 0 (correctness/security) + Wave E1 (IA/UX) | ✅ DONE | `11a9e8d3→36ffe3d9` |
| 2 | Wave 1 (choke-point/AI-safety/quota/audit/model-resolver/persistent-server) + Wave E4 (trợ lý vận hành) | ✅ DONE | `→b91f298f` |
| 3 | Wave 2 (AI#1 analytics: machineType/robot, RCA hội tụ, gợi-ý→hành-động, model-perf thật) + Wave 6 (MLOps: bootstrap-classifier, drift→retrain, seg/detect eval + ROC calibration + lineage) | ✅ DONE | `→47e7cea7` |
| 4 | Wave 3 (AI#4 agent-loop THẬT observe→replan + branch; bounded-autonomy + kill-switch; governance model-cards; housekeeping/bridge/Ops-UI) + Wave E2 (Agent Command Center — **LIVE-verified**) | ✅ DONE | `→ccd0d907`, `→b4bb831b` |
| 5 | Wave 4 (AI#3 inline copilot: ghost-text FIM, persistent-FIM-server, KB-grounding, semantic safety-linter 6-vendor) + Wave E3 (Training Studio: doc/URL/video/OCR ingest + LoRA sidecar; Studio-UI **LIVE-verified**) | ✅ DONE | `→8ff6c969` |
| 6 | Wave 5 (AI#2: KB-autosync answer-eval-gate; hợp-nhất 1 chat-engine **LIVE-verified**; feedback→DB→re-rank + citation-deeplink; GraphRAG eval + i18n) | ✅ DONE | `→3bd8f6be` |

**★ Kiểm chứng LIVE (option-A) bắt 3 bug thật mà unit-test + code-review bỏ sót:** (E2-3) card-truncation; (E3-2)
42P01 fail-safe hỏng vì DrizzleQueryError bọc code vào `.cause` → thêm `dbErrors.isMissingTable` cause-walker; (E3-3)
CRITICAL SSRF DNS-pin hỏng trên Node thật → thêm unmocked loopback test.

**★ MIGRATIONS: ĐÃ CHẠY (owner `aoi`, 2026-07-27) — 0298…0306 (9 file, additive, tracked trong `__applied_migrations`):**
0298 ai_gateway_quota · 0299 ai_llm_audit · 0300 ai_anomaly_calibration (calibratedThreshold/Target) · 0301
training_datasets.contentHash · 0302 ai_agent_sessions.replanCount · 0303 ai_model_cards · 0304 kb_studio_chunks
(pgvector) · 0305 kb_studio_registry (kb_corpora/kb_ingest_jobs) · 0306 kb_answer_feedback. *(4 migration cũ không
thuộc doc69 — 0057/0066/0125/0234 — CỐ Ý để pending, không chạy.)*

**★ CÒN LẠI (ops, không phải code):** `npm run kb:sync` (kích hoạt operational-card grounding + citation-deeplink +
làm tươi corpus). Mọi cờ tính-năng mới **default-OFF/safe** → nhánh inert cho tới khi ops chủ động bật.

**★ FAST-FOLLOW TRƯỚC-KHI-BẬT-CỜ (đã ghi nhận, sửa trước khi bật cờ tương ứng):** E3-6 `startFinetune` đồng-bộ
→ background-job (mirror `aiTrainingPipeline.createTrainingJob`) trước khi bật `LLM_FINETUNE_CMD`; B3 feedback-citations
derive server-side + rate-limit trước khi bật `KB_FEEDBACK_RERANK_ENABLED`; B1 restore-atomicity (best-effort, off-peak
self-heal — cân nhắc staging+rename nếu bật `KB_AUTOSYNC_ENABLED`).

**Ledger chi tiết từng task (SHA/GOTCHA/fast-follow):** `.superpowers/sdd/progress-ai-module-doc69.md`.

---

## 0. Tóm tắt điều hành

Module AI của hệ sinh thái **trưởng thành và trung thực hơn nhiều so với kỳ vọng** cho một sản phẩm ở
giai đoạn này: chạy **100% local/on-prem bằng GGUF (họ Qwen3) qua node-llama-cpp**, không phụ thuộc cloud
(nhánh OpenAI đã bị gỡ ở WS-G3), và **"suy giảm trung thực" (honest degradation)** ở gần như mọi service —
không bịa số, không giả model. Đây là nền tảng lý tưởng để thương mại hoá (Machine Edition air-gapped).

**Nhưng** phần "thông minh" phần lớn là **thống kê xuất sắc + lớp LLM mỏng + embedding thị giác ONNX thật**,
và có **nghịch lý giá trị**: các năng lực mạnh nhất ship **TẮT mặc định**, vài năng lực yếu/hỏng lại **BẬT**.
Kèm theo là một chùm lỗi đúng-đắn/bảo mật cụ thể cần vá trước khi bán.

### Bảng điểm trưởng thành

| # | Phân hệ | Maturity | Một câu bản chất |
|---|---|---|---|
| 1 | **AI phân tích kiểm tra + báo cáo** | **~62%** | Lõi thống kê (SPC/Cpk/forecast/Pareto/correlation) chuẩn production; "AI" mỏng; robot/OT ngoài lõi; **bug SQL ghi âm thầm** |
| 2 | **AI hỏi-đáp hệ sinh thái** | **~80%** | RAG offline thật (2.186 chunk, ~67 tool-call, SSE, tri-lingual); **KB cũ 26 ngày + auto-sync TẮT**; 3 UI chat phân mảnh |
| 3 | **Copilot lập trình nhúng** | **~65-70%** | Thật, corpus 91.678 chunk/6 hãng; **ship TẮT**; **chưa có inline completion trong app**; **chưa có model coder chuyên** |
| 4 | **Agents làm tác vụ** | **~65%** | HITL propose→confirm→execute chuẩn production (80%); nhưng **plan-execute, chưa observe→replan**; autonomy ~50% |
| 5 | **Nền tảng model dùng chung** | **~55%** | Local GGUF **thật & hardened**; **không có 1 choke-point**; **không có lớp AI-safety**; rate-limit fail-open |
| 6 | **Engine thị giác/ML + MLOps** | **~65%** | ML thật (DINOv2 ONNX, PatchCore, thống kê đúng); vòng self-learning **đóng nhưng nguội — chưa có classifier lỗi trên đĩa** |

**Kết luận:** không cần "làm lại". Cần **hoàn thiện có kỷ luật**: vá lỗi + bịt bảo mật, gom nền tảng
(choke-point + safety + quota + edition-aware), rồi nâng từng AI trọng điểm và **bootstrap model phân loại
đầu tiên** để "động cơ MLOps" hết rỗng.

---

## 1. Phạm vi & phương pháp

- **Bề mặt module AI:** ~176 file server (`server/services/ai*`, `server/routers/ai*`, `server/db/ai*`,
  `server/services/ai/*`, `server/services/aiLocalTools/*`, `server/services/orchestration/*`,
  `server/services/programming/*`), ~40 trang/thành phần FE (`client/src/pages/AI*`, `client/src/components/AI*`,
  `client/src/components/ai/*`, `client/src/contexts/Ai*`), ~30 doc kế hoạch (`docs/AI_*`, `docs/upgrade-2026/*`,
  `docs/ECOSYSTEM/03,04,05,06,11,34,66`).
- **Phương pháp:** 6 agent audit song song, mỗi agent 1 phân hệ, đọc code + đối chứng doc + kiểm tra
  flag/env/wiring/test, **dẫn chứng `file:line`**, phân loại maturity: **LIVE / PARTIAL / STUB-MOCK / FLAG-OFF / MISSING**
  và **"AI thật?"** (LLM/ML thật vs thống kê/heuristic). Toàn bộ READ-ONLY.
- **Đối chứng doc kế hoạch cũ:** `docs/AI_UPGRADE_PLAN.md` (03/2026) đánh dấu 12 tính năng "đã xong" nhưng
  thiên OpenAI-cloud; thực tế hiện tại đã chuyển local-GGUF (doc 03/04/34) và nhiều tuyên bố "done" chỉ đúng
  một phần — chi tiết ở §3.

---

## 2. Phát hiện xuyên suốt (cross-cutting)

### 2.1 Điểm mạnh nền (giữ, đừng phá)

- **G-A. Local-first thật & hardened.** `aiGgufEngine.ts` (~1.900 dòng) quản GPU offload + OOM auto-recovery,
  LRU + VRAM guard (`nvidia-smi`), semaphore đồng thời, KV-cache theo task, GBNF constrained decode, native FIM,
  streaming, magic-header validator. Máy tham chiếu (`GGUF_MODELS_DIR=D:/SOURCES/16.AI`) đủ họ Qwen3:
  30B-A3B-Instruct (deep), 4B (fast), VL-8B+mmproj (vision), Embedding-0.6B, Coder-30B-A3B, Coder-1.5B (FIM), reranker.
- **G-B. Honest degradation khắp nơi.** cpk=null khi thiếu spec; từ chối output của embedder; forecast confidence
  bám lỗi thật; FE từ chối bịa P/R/F1; provider/health labels; `VISION_NOT_AVAILABLE` thay vì bịa. Rất đáng tin.
- **G-C. Lớp hành động HITL chuẩn production** (`aiCopilotActions.ts`): propose→confirm→execute, args đọc từ
  DB (không từ client), idempotency at-most-once, RBAC ×2, audit append-only, TTL 5', + khung "advice-contract"
  (guardrail + requires[policy/twin/human]) đã có sẵn dữ liệu, sẵn sàng cấp cho autonomy.
- **G-D. Thống kê & RAG đúng bài.** SPC 12-rule + Cpk/Box-Cox; PSI + KS (p-value Kolmogorov) cho drift; chi-squared A/B;
  ECE/MCE/Brier + temperature scaling; RAG hybrid semantic+keyword + reranker + streaming.

### 2.2 GAP xuyên suốt (xếp theo mức nghiêm trọng)

- **X1 — Nghịch lý giá trị (value inversion).** Mạnh-nhưng-TẮT: RCA Copilot (#9 của AI#1), quantitative correlation,
  orchestration watcher, GraphRAG, inline-gate, autonomy contract. Yếu/hỏng-nhưng-BẬT: batch RCA nông + bug SQL,
  `predictiveAlert.generatePredictions` heuristic gán nhãn sai `modelUsed:'Linear Regression'`.
- **X2 — Chùm lỗi đúng-đắn (correctness):**
  - **X2a. Bug quoting SQL camelCase** ở RCA/alert **mặc-định-BẬT** — INSERT/UPDATE dùng cột camelCase không
    trích dẫn (`aiBatchRcaScheduler.ts:149-157`; `aiRouters.ts:172-176,449-468,566-591`) vs cột vật lý quoted →
    Postgres hạ lowercase → `column "analysistype" does not exist`; per-machine try/catch **nuốt lỗi** → tính năng
    "chạy như thật mà không lưu gì". `predictiveAlert` còn tham chiếu cột không tồn tại `i.result` (đúng là `overallResult`).
  - **X2b. `activateVersion` bỏ qua eval-gate** (`aiModelRouter.ts:158`, adminProcedure) → ép deploy model chưa/không đạt.
  - **X2c.** Today-briefing anomaly là **dead-code** (`aiTodayBriefing.ts:243-245`); model-perf report hardcode
    accuracy/latency/drift = 0 (`aiReportGenerator.ts:342-368`); FE Image-Search còn chữ "ONNX đã bỏ" sai thực tế.
- **X3 — Không có 1 choke-point model + không có lớp AI-safety.** Gateway (`aiGateway.planInference`) chỉ có **1**
  consumer (`aiChatAssistant`); ~19 điểm gọi model còn lại đi thẳng `aiProviderRouter`/`route()`/engine → rate-limit,
  metering, A/B chỉ phủ ~5% lưu lượng. **Không có** phòng vệ prompt-injection, **không có** redaction PII/secret,
  không kiểm duyệt output — text người dùng + JSON tool-result nối thẳng vào prompt.
- **X4 — Bảo mật đa-tenant/edition chưa đủ để bán.** Truy vấn analytics nhận `machineId/factoryCode` do client
  cấp **không scope theo `ctx.user`** (bất kỳ user nào trong canary xem được factory khác); `aiApiKeys` lưu **base64
  (không mã hoá)** + test giả; `LICENSE_MODULE_GATE_ENABLED` TẮT → chưa gate theo Edition/license.
- **X5 — Cold-start ML.** Vòng self-learning đóng đủ mắt xích nhưng **chỉ có `models/dinov2.onnx` (feature extractor),
  chưa có classifier lỗi nào trên đĩa**; `AOI_DL_HEAD_ENABLED=false` → toàn bộ quality-gate/A-B/active-learning/calibration
  là "động cơ rỗng" cho đến khi bootstrap model đầu tiên.
- **X6 — Audit LLM-call & governance còn thiếu.** `ml_inference_audit` chỉ phủ ONNX; prompt/response chat/RCA không
  lưu. Model cards + inference-audit trong `PHASE4_AI_GOVERNANCE.md` mới là "khuyến nghị", chưa ship.
- **X7 — Phân mảnh & nợ hợp nhất.** 3 UI chat (bubble / AIChatPage / AILocalKnowledgeBase) + 4th showcase; 2 bản
  executive-summary; model-name resolution nhân 3 bản (router/engine/openaiGateway); proxy HTTP-localhost thừa.

---

## 3. Hiện trạng chi tiết theo phân hệ (đánh giá + GAP)

> Mỗi phân hệ: bản chất → điểm mạnh → GAP xếp hạng (kèm `file:line`). Bảng capability đầy đủ nằm trong
> báo cáo agent; phần dưới cô đọng những gì cần cho quyết định + thực thi.

### 3.1 AI #1 — Phân tích dữ liệu kiểm tra + báo cáo (~62%)

**Bản chất.** Lõi số học chuẩn production, offline, trung thực: Inspection Analytics (trend/Pareto theo điểm &
theo defect-class/machine/shift/heatmap/correlation/risk), **SPC 12-rule + Cpk/Cpu/Cpl (Box-Cox)**, yield forecast
3-tier (Holt-Winters/EWMA/linear), correlation Pearson + p-value, PatchCore anomaly (ảnh), threshold/setup advisor,
"Today" briefing, executive report v2 + **đẩy quản lý** (in-app + email) + export **PDF/XLSX/HTML**. LLM chỉ chạm vào
**văn xuôi báo cáo** + **1 lời gọi RCA-JSON**; tất cả degrade về template/rule khi thiếu model.

**Mạnh.** Số liệu thật trên DB thật; không bịa; report là sản phẩm thật (export + đẩy quản lý); wiring backend đủ.

**GAP (xếp hạng).**
- **A-S1.** "AI" chủ yếu là thống kê; **robot/OT bị loại khỏi lõi** yield/Pareto/SPC (robot có path riêng #15 TẮT).
  Không có phân tích theo `machineType`. → lời hứa "tất cả loại máy" chỉ đúng nghĩa yếu "máy nào ghi vào bảng inspection".
- **A-S2 (HIGH, correctness).** Bug quoting SQL ở batch RCA (mặc-định-BẬT) + rootCause/predictiveAlert (X2a).
- **A-S3.** Nghịch lý giá trị: RCA Copilot evidence-rich (`aiRcaCopilot.ts`, đa nguồn: Pareto+SPC+anomaly+**VL-vision**+audit+GraphRAG+correlation, HITL zod-gated) **TẮT**; quantitative correlation (`ai/defectCorrelationService.ts`, IRLS logistic) **TẮT**; predictive-alert heuristic gán nhãn sai đang **BẬT**.
- **A-S4 (security).** Truy vấn analytics **không scope factory/tenant** + không rate-limit theo user (`aiInspectionAnalyticsRouter.ts`).
- **A-S5.** Model-Performance report là **stub** (hardcode 0) dù tín hiệu thật có ở `ai_gateway_metrics`/`aiDriftMonitor`.
- **A-S6.** Time-Series Engine **không test + Isolation-Forest dùng `Math.random` không seed** (bất định) + nhãn EWMA↔Holt-Winters sai (`aiTimeSeriesEngine.ts:292,301,363`).
- **A-S7.** LLM value-add vô hình mặc định (không surface `narrativeMetadata.generatedBy`); Today anomaly dead-code; 2 bản executive-summary trùng.

### 3.2 AI #2 — Trợ lý hỏi-đáp hệ sinh thái (~80%, cao nhất)

**Bản chất.** RAG copilot offline-first thật: `aiLocalKnowledgeService.ts` → tool → retrieval hybrid
(semantic 0.72 + keyword 0.28) → GGUF Qwen3 generate → extractive fallback, trên corpus **2.186 chunk / 48MB
1024-d** (embed Qwen3-Embedding-0.6B khớp corpus). **SSE streaming**, tri-lingual (vi/en/zh) ở backend, **~67 tool-call**
(đọc live-data + HITL write + navigate/prefill), reranker BẬT, auto-ingest RCA/insight BẬT. Wiring đủ; `/ai-chat` + bubble live.

**Mạnh.** Bề rộng tool-calling + an toàn HITL; RAG kỹ; thực sự "biết hệ sinh thái" (173+ how-to + catalog route/nav/schema).

**GAP (xếp hạng).**
- **B-1.** **KB cũ ~26 ngày**, `kbSyncScheduler` có nhưng `KB_AUTOSYNC_ENABLED` không set → corpus lệch sau mỗi thay đổi code/doc.
- **B-2.** **Không có eval chất-lượng-trả-lời trên corpus đang ship** (điểm 82%/86.2% đo trên corpus mxbai 998-chunk cũ; hiện chỉ có recall@5=1.0 = độ phủ, không phải chất lượng).
- **B-3.** **3 UI chat phân mảnh** (bubble/AIChatPage/AILocalKnowledgeBase) + `/ai-local-kb` "Smart Support" yếu nhất (không stream/tool/history/i18n) và **không có trong nav**.
- **B-4.** Feedback loop teo tóp (`feedback.jsonl` 1 dòng, không vào DB, không tái sử dụng); dead-code `processChat` + footer "6 tools" sai.
- **B-5.** Proxy HTTP-localhost thừa (`aiLocalKbRouter`→`KB_API_BASE`); citations không click được; GraphRAG TẮT; i18n FE còn hardcode VN.

### 3.3 AI #3 — Copilot lập trình nhúng (~65-70%)

**Bản chất.** THẬT, đã ship nhiều (doc 34 P0–P4): `programming/aiProgrammingCopilot.ts` generate/complete/translate/
review/explain, **validate-before-return qua chính `programmingAdapter.validate()/compile()`** + self-repair loop,
**DISPLAY-ONLY** (test khẳng định không import deploy), deploy tách pipeline four-eyes + 2FA. Corpus manual 6 hãng
**91.678 chunk / ~2GB** (Qwen3-Embedding) + golden few-shot. In-app: CodeMirror 6 + `ProgrammingCopilotPanel` +
`ProgrammingCopilotDock` (rail "Claude-in-VS-Code" bám editor). `/v1` gateway OpenAI-compatible + native FIM.

**GAP (xếp hạng).**
- **C-1.** **Chưa có inline/ghost-text completion trong app** — chỉ có qua VS Code + Continue ngoài app (mặc định TẮT, cần setup tay). CodeMirror `basicSetup` không có extension inline.
- **C-2.** **Chưa có model coder chuyên** — `GGUF_CODE_MODEL/GGUF_FIM_MODEL` không set → codegen dùng 30B-**Instruct** (validPass ~60% theo eval của chính doc 34); Qwen3-Coder-30B đã có trên đĩa nhưng chưa wire.
- **C-3.** **Ship default-OFF hoàn toàn** + không có bằng chứng PROVEN-LIVE trong repo; **RAG grounding TẮT mặc định** → codegen chạy không grounding (citations rỗng).
- **C-4.** Latency chưa hợp inline (30B ~6s cold, KV cap 8192, persistent llama-server/prefix-cache chưa làm); safety guard chỉ keyword (không semantic); golden coverage lệch (KAREL/RAPID/MELFA/Delta chỉ stub).

### 3.4 AI #4 — Agents làm tác vụ thay người (~65%; HITL 80% / autonomy 50%)

**Bản chất.** Lõi hành động HITL chuẩn production (G-C). Trên đó: **orchestrator đa-bước** (`aiAgentOrchestrator.ts` +
`aiAgentPlanner.ts`) — LLM GGUF phát **plan JSON grammar-constrained, validate theo tool registry**; read/navigate
auto-chạy nhưng **DỪNG ở mọi write** chờ confirm. Playbook engine (SOP YAML). Auto-proposer (event + quét 30') **chỉ đề xuất**
vào inbox, không tự confirm. OT actuation qua `commandDispatcher.ts` xếp 8+ cổng, mặc định DRY-RUN.

**GAP (xếp hạng).**
- **D-1.** **Chưa phải agent loop thật** — orchestrator là **plan-once-then-execute**; kết quả read **không** hồi tiếp để replan; `branch` là no-op. (← chính là hướng bạn chọn nâng.)
- **D-2.** Không có bậc bounded-autonomy: hành động rủi ro-thấp/idempotent vẫn cần bấm tay (dù khung advice-contract đã đủ để cấp phép auto-execute — đang wired vào không gì).
- **D-3.** Governance chưa ship: chưa có `ai_model_cards` gate + `ml_inference_audit` cho quyết định AI.
- **D-4.** Repertoire hẹp (4 mapping trigger→tool); specialist-agents (data-analyst/backend/frontend/qa) tách rời, chỉ sinh text, không tạo action.
- **D-5.** Không có cron dọn `ai_pending_actions`/`ai_agent_sessions` cũ (chỉ lazy); "human_approval" thoả bằng đúng 1 click (chưa four-eyes trong copilot); `.env` dev đang BẬT `OT_CONTROL_ENABLED=true` (an toàn nhờ commissioning-gate, nhưng lệch với intent OFF).

### 3.5 Nền tảng model dùng chung (~55%)

**Bản chất.** Local inference thật & hardened (G-A) + **model router 5-tier thật** (`aiModelRouter.route`, heuristic độ khó,
latency-budget pin, escalation thinking/code/fim có kiểm file trên đĩa). Streaming SSE thật. Health/availability trung thực.

**GAP (xếp hạng).** X3 (không choke-point + không AI-safety), X6 (audit LLM thiếu), + rate-limit in-process fail-open
gateway-only; không có quota/tenant; model-resolution nhân 3 (`aiModelRouter`/`aiGgufEngine`/`openaiGateway.resolveModelId`);
`aiApiKeys` base64; config drift (`AI_THINKING_TIER_ENABLED=true` nhưng `GGUF_THINKING_MODEL` không set; `LLAMA_SERVER_ENABLED`
OFF → deep model tranh VRAM với embedder); copilot chính (`aiChatAssistant`) **chưa stream** dù hạ tầng có sẵn.

### 3.6 Engine thị giác/ML + MLOps (~65%)

**Bản chất.** ML thật: DINOv2 ONNX (88MB) → embedding/similarity/clustering/PatchCore anomaly; metrology & SPI-3D là
toán thật; thống kê MLOps đúng (PSI/KS/chi-sq/ECE/temperature). **Vòng self-learning đóng đủ mắt xích** (collect→uncertainty→
label queue→dataset khoá split→train Tier-1→eval→gate→activate→drift→retrigger), giữ người ở 2 mắt nguy hiểm (label + promote;
`AI_AUTO_PROMOTE_ENABLED=false`).

**GAP (xếp hạng).**
- **F-G1 (X5).** **Chưa có classifier lỗi trên đĩa** → hạ tầng gate/A-B/active-learning rỗng; `AOI_DL_HEAD_ENABLED=false` (head.json đã seed nhưng chưa phục vụ).
- **F-G2 (X2b).** `activateVersion` bỏ qua eval-gate.
- **F-G3.** Tier-2 Python trainer (`tools/trainer/train.py`) mới scaffold; Tier-1 chỉ train head tuyến tính.
- **F-G4.** YOLOv8-seg decode tự đánh dấu `experimental`, chưa validate .onnx thật; eval harness **chỉ classification** (chưa mAP/IoU/Dice).
- **F-G5.** Drift chỉ advisory, **không nối retrain**; chưa có scheduler materialize performance snapshot; anomaly threshold cố định p99 (chưa ROC theo NG-nhãn); thiếu dataset lineage/experiment tracking; label-queue chưa SLA.

---

## 4. Kế hoạch nâng cấp (waves) — cân bằng, phủ 4 AI, agent-loop

> Nguyên tắc: **Wave 0 là tiền đề (làm trước, rẻ)**. Vì chọn "cân bằng", các wave sau **đan xen** một hạng-mục
> nền-tảng với một mũi-nhọn-năng-lực. Mọi tính năng mới **default-OFF**, bật sau khi có **live self-check + PROVEN-LIVE**.
> DDL chạy bằng owner `aoi` (tránh 42501). Sau sửa server phải **restart process** (esbuild bundle). `tsc` cần heap 8GB.

### Wave 0 — Correctness & Security (cross-cutting, tiền đề) — *rủi ro thấp, giá trị cao*
- **W0-1** Vá bug quoting SQL: chuyển INSERT/UPDATE RCA/alert sang **drizzle builder** + test **chạm PG thật** (không mock). Files: `aiBatchRcaScheduler.ts`, `aiRouters.ts` (rootCause+predictiveAlert). *(sửa X2a)*
- **W0-2** Bắt buộc **eval-gate ở mọi activate**: `activateModelVersion` yêu cầu `evalReport.gate.pass` hoặc override có ký + audit. Files: `aiTrainingPipeline.ts:332`, `aiModelRouter.ts:158`. *(sửa X2b)*
- **W0-3** **Scope factory/tenant** theo `ctx.user` + **rate-limit theo user** cho mọi truy vấn analytics/report. Files: `aiInspectionAnalyticsRouter.ts`, `aiReportRouter.ts`. *(sửa X4-a)*
- **W0-4** Gỡ hoặc **mã hoá thật** `aiApiKeys` (libsodium/KMS) + bỏ test giả. Files: `aiSettingsRouter.ts`. *(sửa X4-b)*
- **W0-5** Dọn dead-code/stub: Today anomaly (`aiTodayBriefing.ts`), model-perf zeros→tín hiệu thật (`aiReportGenerator.ts`), FE "ONNX removed" copy (`AIImageSearchPage.tsx`), footer "6 tools" (`aiChatRouter.ts`), comment/test còn "openai/gpt-4o-mini". *(sửa X2c, X7)*

### Wave 1 — Nền tảng model dùng chung (platform) — *đan xen, làm sớm vì mọi AI hưởng lợi*
- **W1-1** **1 choke-point:** đưa mọi text/json/vision qua `routeInference()` (bọc `aiProviderRouter` + `_core/llm` + migrate direct `route()` callers + `openaiGateway`). Files: `aiProviderRouter.ts`, `_core/llm.ts`, `openaiGateway.ts`, 8 caller. *(sửa X3-a)*
- **W1-2** **Lớp AI-safety** `server/services/ai/aiSafety.ts`: heuristic prompt-injection + redaction PII/secret (in/out) + kiểm output, gọi trong `planInference`. *(sửa X3-b)*
- **W1-3** **Rate-limit bền + quota theo user/role/tenant + edition/license-aware** (bảng `ai_gateway_quota`, bật `LICENSE_MODULE_GATE` theo Edition doc 66). Files: `aiGateway.ts`, `drizzle/schema/ai.ts`. *(sửa X4-c)*
- **W1-4** **Audit LLM-call** (`ai_llm_audit`: hashed prompt/response, user, tier, model, outcome) + **hợp nhất model-resolution** (`ai/modelResolver.ts`). *(sửa X6, X7)*
- **W1-5** Bật **persistent llama-server** cho deep model (hết tranh VRAM) + sửa thinking-tier drift + **stream copilot chính** (`aiChatAssistant`).

### Wave 2 — AI #1 Phân tích + báo cáo *(mũi nhọn 1)*
- **A1** `machineType` là **chiều hạng nhất** (join `machines.machineType`, groupBy) + đưa robot/OT KPI vào comprehensive report. *(sửa A-S1)*
- **A2** Hội tụ **một engine RCA** = `aiRcaCopilot` (nghỉ hưu batch heuristic + predictive-alert giả), thay predictive bằng `predictiveMaintenanceService`/`defectCorrelationService`. *(sửa A-S3)*
- **A3** **Đóng vòng "gợi ý→hành động 1-chạm"**: nối recommendation của RCA insight vào HITL `ai_pending_actions` (như threshold/setup advisor). *(giá trị "hỗ trợ giải quyết")*
- **A4** Wire Model-Perf report vào tín hiệu thật; surface **badge provenance/model-live**; **de-random + test** Time-Series. *(sửa A-S5,A-S6,A-S7)*

### Wave 3 — AI #4 Agents → **agent loop thật** *(mũi nhọn 2, theo lựa chọn của bạn)*
- **D1** **observe→replan loop** + resolve `branch` thật: hồi tiếp kết quả read vào planner để sinh bước kế thích ứng. Files: `aiAgentOrchestrator.ts`, `aiAgentPlanner.ts` (thêm `replanFromObservations`), schema `AgentPlanStep`.
- **D2** **Bounded-autonomy tier** làm bậc đệm an toàn: auto-confirm allowlist rủi ro-thấp/idempotent khi guardrail+policy PASS, có kill-switch + audit. Files: `aiCopilotActions.ts`, `ai/autonomyPolicy.ts`.
- **D3** **Governance**: `ai_model_cards` + activation gate + `ml_inference_audit`. *(sửa D-3, khớp PHASE4)*
- **D4** Cron dọn stale actions/sessions; **cầu specialist-agents → action layer**; **Agent Ops UI** (`AIBrainDashboard`); widen trigger→tool.

### Wave 4 — AI #3 Copilot lập trình *(mũi nhọn 3)*
- **C1** **Inline completion trong app**: nguồn inline CodeMirror (`CodeEditor.tsx`) ↔ tRPC `programming.copilotComplete` (debounced) → `generateFim` (tier FIM đã có). *(sửa C-1, bỏ phụ thuộc Continue)*
- **C2** Wire **Qwen3-Coder-30B** + **FIM nhỏ** + **persistent server/prefix-cache** cho FIM sub-giây; chạy lại `eval-codegen.mjs` đo lift. *(sửa C-2,C-4)*
- **C3** **Bật `PROG_KB_ENABLED` mặc định** (grounding) sau **live smoke** + ghi PROVEN-LIVE; giữ `AI_PROGRAMMING_COPILOT_ENABLED` là công tắc chủ ý. *(sửa C-3)*
- **C4** Safety-linter semantic (motion-envelope/unbounded-loop/thiếu interlock) trong `validate()`; bù golden KAREL/RAPID/MELFA/Delta.

### Wave 5 — AI #2 Trợ lý hỏi-đáp *(mũi nhọn 4)*
- **B1** Bật `KB_AUTOSYNC_ENABLED` + surface `staleDays` ở health badge + eval chất-lượng-trả-lời gate `kb:sync`. *(sửa B-1,B-2)*
- **B2** **Hợp nhất 1 engine chat** (`useKbChatStream` + react-markdown) — retire/redirect `/ai-local-kb`, xoá `processChat`, footer từ `listTools()`. *(sửa B-3,B-4)*
- **B3** **Đóng vòng feedback** vào DB → re-ranking/curation + auto-ingest; citations click được; bỏ proxy HTTP-localhost; onboarding "walk me through X". *(sửa B-4,B-5)*
- **B4** Bật GraphRAG sau eval; hoàn thiện i18n FE.

### Wave 6 — MLOps cold-start & đóng vòng *(song song, nền cho A#1 + F)*
- **F1** **Bootstrap classifier đầu tiên**: validate & bật DINOv2 head, hoặc few-shot(≥5/class)→eval→gate→register; **health banner "chưa có classifier active"**. *(sửa F-G1/X5)*
- **F2** Đóng vòng **drift→retrain (HITL)**: HIGH/CRITICAL drift → tạo training job *đề xuất*; scheduler gọi `collectPerformanceSnapshot`. *(sửa F-G5)*
- **F3** Eval detection/seg (IoU/Dice/mAP) + validate YOLO-seg .onnx thật (bỏ `experimental`); calibrate anomaly threshold theo ROC; dataset lineage + experiment tracking; label-queue SLA; hoàn thiện Tier-2 trainer. *(sửa F-G3,F-G4,F-G5)*

---

## 5. Backlog nhiệm vụ ưu tiên (để agent thực thi bám vào)

> Effort: S(≤0.5 ngày) · M(1-2 ngày) · L(≥3 ngày). Risk: rủi ro hồi quy. Tất cả default-OFF khi áp dụng được.

> **★ TRẠNG THÁI (2026-07-27): TẤT CẢ nhiệm vụ dưới đây ĐÃ THỰC THI + review + PUSHED** (`feat/hmi-dep`, HEAD `3bd8f6be`).
> Wave 0: W0-1..W0-5 ✅ (T1-T5) · Wave 1: W1-1..W1-5 ✅ (G2-1..G2-6) · Wave 2 (AI#1): A1-A4 ✅ · Wave 3 (AI#4): D1-D4 ✅
> · Wave 4 (AI#3): C1-C4 ✅ · Wave 5 (AI#2): B1-B4 ✅ · Wave 6 (MLOps): F1-F3 ✅. Migrations 0298-0306 **đã chạy** (owner
> `aoi`). Chi tiết SHA/GOTCHA từng task: ledger `.superpowers/sdd/progress-ai-module-doc69.md`. (Cột "Nghiệm thu" là tiêu
> chí gốc — tất cả đã đạt qua adversarial-review + fix; UI kiểm chứng LIVE.)

| ID | Wave | Nhiệm vụ | File chính | Effort | Risk | Nghiệm thu |
|---|---|---|---|---|---|---|
| W0-1 | 0 | Vá quoting SQL RCA/alert → drizzle + test PG thật | `aiBatchRcaScheduler.ts`, `aiRouters.ts` | M | Thấp | Insert/list/update RCA & alert lưu/đọc đúng trên PG live; test đỏ nếu regress |
| W0-2 | 0 | Bắt buộc eval-gate mọi activate | `aiTrainingPipeline.ts`, `aiModelRouter.ts` | S | Thấp | Không thể activate version thiếu `evalReport.gate.pass` (trừ override ký+audit) |
| W0-3 | 0 | Scope factory/tenant + rate-limit/user | `aiInspectionAnalyticsRouter.ts`, `aiReportRouter.ts` | M | TB | User A không truy vấn được factory ngoài phạm vi; vượt ngưỡng → 429 |
| W0-4 | 0 | Mã hoá/gỡ `aiApiKeys` | `aiSettingsRouter.ts` | S | Thấp | Không còn secret base64; test thật hoặc endpoint bị gỡ |
| W0-5 | 0 | Dọn dead-code/stub | `aiTodayBriefing.ts`, `aiReportGenerator.ts`, `AIImageSearchPage.tsx`, `aiChatRouter.ts` | M | Thấp | Today hiện anomaly thật; model-perf ≠ 0; FE copy đúng; footer = số tool thật |
| W1-1 | 1 | Gom choke-point qua `routeInference` | `aiProviderRouter.ts`, `_core/llm.ts`, `openaiGateway.ts` +8 | L | TB | ≥95% lưu lượng model đi qua gateway (metering đủ); dashboard hết under-report |
| W1-2 | 1 | Lớp AI-safety (injection + PII/secret redaction) | `ai/aiSafety.ts` (mới) | M | TB | Prompt tấn công bị chặn/log; secret/PII bị che in&out; có bản ghi redaction |
| W1-3 | 1 | Quota + edition/license-aware | `aiGateway.ts`, `drizzle/schema/ai.ts` | L | TB | Quota/tenant enforce; license-gate theo Edition bật được |
| W1-4 | 1 | Audit LLM-call + hợp nhất model-resolution | `ai/modelResolver.ts` (mới), `aiGateway.ts` | M | Thấp | RCA/report/quality calls có bản ghi audit; 1 nguồn resolve model |
| W1-5 | 1 | Persistent llama-server + stream copilot | `aiLlamaServerClient.ts`, `aiChatAssistant.ts` | M | TB | Deep model hết tranh VRAM; `/ai-chat` stream token |
| A1 | 2 | `machineType` chiều hạng nhất + robot/OT vào report | `aiInspectionAnalytics.ts` | L | TB | Report tách AOI/AVI/SPI + mục robot; test số liệu theo type |
| A2 | 2 | Hội tụ 1 engine RCA + thay predictive giả | `aiRcaCopilot.ts`, `aiRouters.ts` | L | TB | 1 đường RCA; predictive dùng service thật; nhãn model đúng |
| A3 | 2 | Đóng vòng gợi ý→hành động 1-chạm | `aiInsightsService.ts`, `aiRouters.ts` | M | TB | Từ report bấm 1 chạm tạo `ai_pending_actions` (HITL) |
| A4 | 2 | Model-perf thật + badge provenance + test Time-Series | `aiReportGenerator.ts`, `aiTimeSeriesEngine.ts`, FE | M | Thấp | Model-perf có số thật; badge hiện gguf/offline; Time-Series seeded + có test |
| D1 | 3 | observe→replan + branch thật | `aiAgentOrchestrator.ts`, `aiAgentPlanner.ts` | L | Cao | Agent điều chỉnh bước sau theo kết quả read; branch rẽ đúng; test kịch bản |
| D2 | 3 | Bounded-autonomy tier | `aiCopilotActions.ts`, `ai/autonomyPolicy.ts` (mới) | M | Cao | Chỉ allowlist auto-execute khi guardrail PASS; kill-switch + audit đủ |
| D3 | 3 | Governance model cards + inference audit | `drizzle/schema/ai.ts`, model-mgmt router | M | TB | Activate cần model-card; quyết định AI ghi `ml_inference_audit` |
| D4 | 3 | Cron dọn + cầu specialist→action + Agent Ops UI | `backgroundJobs.ts`, `aiSpecialistAgentService.ts`, `AIBrainDashboard.tsx` | M | Thấp | Stale rows dọn theo cron; xem/steer session agent trên UI |
| C1 | 4 | Inline completion trong app | `CodeEditor.tsx`, `programmingRouter.ts`, `aiProgrammingCopilot.ts` | L | TB | Ghost-text tab-accept trong editor, không cần Continue; latency chấp nhận |
| C2 | 4 | Wire Qwen3-Coder + persistent FIM server | `aiModelRouter.ts`, `aiGgufEngine.ts`, `openaiGateway.ts` | M | TB | codegen dùng model coder; eval-codegen lift đo được; FIM sub-giây |
| C3 | 4 | Bật KB grounding + live smoke + PROVEN-LIVE | `.env`, `aiProgrammingKnowledgeService.ts`, smoke script | S | Thấp | codegen có citations; artifact PROVEN-LIVE ghi lại |
| C4 | 4 | Safety-linter semantic + golden coverage | adapters `programming/*`, `knowledge/golden-code/*` | M | TB | Chương trình unsafe không-keyword bị cờ; golden đủ 6 hãng |
| B1 | 5 | KB autosync + staleDays + answer-eval gate | `.env`, `kbSyncScheduler.ts`, `scripts/ai-kb/eval-rag.mjs` | M | Thấp | Corpus tự tươi; badge staleDays; regress answer-quality chặn `kb:sync` |
| B2 | 5 | Hợp nhất 1 engine chat | `useKbChatStream.ts`, `AIChatPage.tsx`, `AILocalKnowledgeBase.tsx` | L | TB | 3 UI về 1 engine/renderer; `/ai-local-kb` redirect/nav; xoá `processChat` |
| B3 | 5 | Đóng vòng feedback + citations click + onboarding | `AIChatPage.tsx`, `aiLocalKnowledgeApi.ts`, `aiReranker.ts` | M | Thấp | Feedback vào DB & feed re-rank; citation deep-link; "walk me through X" |
| B4 | 5 | GraphRAG sau eval + i18n FE | `.env`, `aiSemanticGraph.ts`, locales | S | Thấp | GraphRAG bật khi eval tăng precision; en/zh sạch hardcode |
| F1 | 6 | Bootstrap classifier đầu tiên + health banner | `ai/embeddingHead.ts`, `aiLocalTraining.ts`, `AIModelManagementPage.tsx` | L | TB | Có ≥1 classifier ACTIVE qua gate; banner khi vắng classifier |
| F2 | 6 | drift→retrain (HITL) + snapshot scheduler | `aiSelfLearningScheduler.ts`, `aiMonitoring.ts` | M | TB | Drift cao → training job đề xuất; snapshot hiệu năng được materialize |
| F3 | 6 | Eval seg/detection + anomaly ROC + lineage + Tier-2 | `aiEvalHarness.ts`, `aiAnomalyDetection.ts`, `tools/trainer/train.py` | L | TB | Có gate mAP/IoU/Dice; threshold theo ROC; dataset có hash lineage |

---

## 6. Kỷ luật rollout & rủi ro

- **Flag mặc định OFF**; bật theo `.env` sau khi **live self-check** (tự chạy, tự chụp, tự đọc — không tin subagent tự nghiệm thu; đo, đừng tin mắt). Ghi **PROVEN-LIVE** cho các tính năng bật (đặc biệt C3, F1).
- **DDL bằng owner `aoi`** (tránh `42501`); esbuild server riêng → **RESTART process** sau sửa; `tsc` heap 8GB.
- **Rủi ro cao nhất:** D1 (agent loop — dễ vòng lặp/hồi quy an toàn), D2 (autonomy — phải kill-switch + audit + giữ commissioning gate), W1-1 (đổi đường model của ~19 caller — làm theo lô + test hồi quy từng service), A2 (đổi engine RCA — chạy song song rồi cắt).
- **Bảo mật là điều kiện bán:** W0-3/W0-4/W1-2/W1-3 nên xong trước khi mở Edition ra khách.
- **Giữ triết lý honest-degradation & HITL** khi thêm autonomy — không đánh đổi độ tin để lấy "tự động".

## 7. Tiêu chí nghiệm thu tổng thể

1. **Correctness:** không còn bug quoting SQL; không activate model bỏ gate; Today/model-perf/FE copy đúng.
2. **Security/commercial:** analytics scope tenant; không secret base64; quota+license-gate theo Edition bật được; có lớp AI-safety + audit LLM.
3. **Nền tảng:** ≥95% lưu lượng model qua 1 choke-point (metering/rate-limit/A-B phủ thật).
4. **4 AI trọng điểm:** #1 phân tích theo machineType + đóng vòng hành động; #2 KB tươi + 1 engine + feedback-loop + answer-eval; #3 inline completion trong app + model coder + grounding PROVEN-LIVE; #4 agent loop observe→replan chạy + bounded-autonomy có kill-switch.
5. **MLOps:** có ≥1 classifier ACTIVE qua gate; drift→retrain (HITL) nối; eval seg/detection có gate.
6. **Chất lượng:** test xanh (EngineApi/e2e/axe theo lệ), self-check live cho mọi flag bật.

## 8. Phụ lục — bản đồ bằng chứng

- **AI#1:** `aiInspectionAnalytics.ts`, `utils/spc.ts`, `aiReportGenerator.ts`, `aiExecutiveReport.ts`, `aiInsightsService.ts`, `aiRcaCopilot.ts`, `ai/defectCorrelationService.ts`, `aiRouters.ts`, `aiBatchRcaScheduler.ts`, `aiTimeSeriesEngine.ts`, `aiTodayBriefing.ts`.
- **AI#2:** `aiLocalKnowledgeService.ts`, `aiLocalKnowledgeApi.ts`, `aiChatRouter.ts`, `aiReranker.ts`, `aiSemanticGraph.ts`, `aiLocalTools/*`, `kbSyncScheduler.ts`, corpus `knowledge/{chunks,embeddings}.jsonl`.
- **AI#3:** `programming/aiProgrammingCopilot.ts`, `aiProgrammingKnowledgeService.ts`, `aiModelRouter.ts`, `ai/generationGuard.ts`, `openaiGateway.ts`, FE `programming/ProgrammingCopilotPanel.tsx`+`Dock`+`CodeEditor.tsx`, corpus `knowledge/programming/manifest.json`, doc 34.
- **AI#4:** `aiCopilotActions.ts`, `aiAgentOrchestrator.ts`, `aiAgentPlanner.ts`, `aiPlaybookEngine.ts`, `aiAutoProposer.ts`, `aiActionInbox.ts`, `ot/commandDispatcher.ts`, `aiSpecialistAgentService.ts`, `PHASE4_AI_GOVERNANCE.md`.
- **Nền tảng:** `aiGgufEngine.ts`, `aiModelRouter.ts`, `aiGateway.ts`, `aiProviderRouter.ts`, `_core/llm.ts`, `aiLlamaServerClient.ts`, `aiStreamingApi.ts`, `aiModelAvailability.ts`, `aiSettingsRouter.ts`.
- **Thị giác/MLOps:** `aiImageEmbedding.ts`, `aiInferenceEngine.ts`, `aiAnomalyDetection.ts`, `aiSegmentation.ts`, `aiMetrology.ts`, `aiSpi3d.ts`, `aiEvalHarness.ts`, `aiDriftMonitor.ts`, `aiCalibration.ts`, `aiABTesting.ts`, `aiLocalTraining.ts`, `aiDatasetBuilder.ts`, `aiActiveLearning*.ts`, `aiSelfLearningScheduler.ts`, `models/dinov2.onnx`.

---

---
---

# PHẦN B — Trải nghiệm "HỆ AI LOCAL HOÀN CHỈNH" (mở rộng vòng 2)

> Phần A trả lời "AI đúng & đủ chắc để bán chưa?". Phần B trả lời "AI có **gắn kết, dễ dùng, trực quan, tự lớn được**
> không?" — theo 6 yêu cầu trải nghiệm của chủ đầu tư. Khảo sát bằng 3 agent (IA/UX · Training Studio · Agent Command Center).
> Nguyên tắc: **tái dùng primitive sẵn có** (WorkspaceShell/TabbedHub/ContextDrawer/HubLauncher, MachineAISummary,
> ProgrammingCopilotDock, AgentPlanCard, Socket.IO/SSE, pgvector, kb pipeline) — hạn chế hạ tầng mới.

## B0. Bản đồ 6 yêu cầu → mục xử lý

| # | Yêu cầu chủ đầu tư | Mục |
|---|---|---|
| 1 | UX gắn kết, không rời rạc ("chức năng 1 nơi, AI 1 nẻo") | **B1** IA/UX cohesion |
| 6 | Trang AI thân thiện, tách tab/page, thêm vào menu trái | **B1** (cùng gói với 1) |
| 2 | Trợ lý *vận hành*, phạm vi hệ sinh thái (không bách khoa) | **B2** Operational grounding |
| 3 | Training local + sinh model chuyên dụng | **B3** Training Studio |
| 5 | Studio training từ tài liệu/video/web | **B3** (cùng gói với 3) |
| 4 | Giao diện trực quan cho AI Agents (kiểu Marvis) | **B4** Agent Command Center |

### Quyết định chốt (25/07/2026 — vòng 2)
1. **Model chuyên dụng:** **BUILD LoRA/QLoRA LLM local NGAY** (song song RAG-grounding) — không hoãn. RAG vẫn là bậc mặc định/nhanh; LoRA là subsystem operator-managed đi cùng đợt (xem B3.3c + E3-6, nâng từ "tuỳ chọn" → cam kết).
2. **Nguồn nạp Studio:** **doc + web + video LÀM SONG SONG NGAY** (không phân pha) — chấp nhận build STT local (whisper+ffmpeg) + fetcher URL (SSRF-guard) cùng đợt E3.
3. **Agent Command Center:** **dashboard chuyên nghiệp trước, "floor 3D" kiểu Marvis làm sau** (chế-độ tuỳ chọn, tái dùng twin canvas — E2-5).

---

## B1. Tái cấu trúc IA/UX — gắn kết, hết rời rạc (yêu cầu 1 & 6)

### B1.1 Vấn đề gốc: cùng ~20 trang AI bị đánh chỉ mục **3 lần**
Đây chính là gốc của cảm giác "chức năng một nơi, AI một nẻo":
1. **Nhóm nav "AI"** (`navigation.tsx` id:"ai", ~1293-1519): 21 hàng / 4 mục, **cả nhóm `tier:'advanced'`** → ẩn ở Simple mode (kể cả Chat/Inbox).
2. **AIHub** (`/ai-hub`, read-open): tường **20 tile** / 4 nhóm.
3. **AIStudioHub** (`/ai-studio`, admin): **20 tool** / 5 nhóm.
→ 16 hàng nav bị ẩn qua `COLLAPSED_INTO_HUB` trỏ về AIStudio. **3 route mồ côi** (không có trong nav): `/ai-inspection-analytics`,
`/ai-gguf-models`, `/ai-local-kb`. `/ai-local-kb` **đặt tên sai** — thực chất là chatbot, không phải "kho tri thức".
**Chật chội:** AIPerformanceDashboard **8 tab** (trộn monitoring + experiments + MLOps history), AIInspectionAnalytics 6 tab,
AISettings 5 tab (1 tab trùng `/ai-monitoring`), AIDataProcessing 4 tab (trộn "dataset" là tài sản với pipeline).

### B1.2 Cây menu trái mới — **1 taxonomy duy nhất** (rail = taxonomy, hub → 1 trang Home)
```
AI  (Trợ lý AI)                                  ← 1 nhóm cha; Assistant hiện cả Simple mode; sâu hơn thì role-gate
├─ ● AI Home            /ai-home                 ← MỚI: gộp AIHub + AIStudioHub. Kiểu Marvis: chat nhanh + bảng agent + rail token/task
├─ TRỢ LÝ (read-open)   Chat /ai-chat · Action Inbox /inbox · Management Insight /management-insight
├─ AGENT OPERATIONS     AI Brain /ai-brain · Monitoring /ai-monitoring · Active Learning · Batch Jobs · Processing
├─ ANALYTICS & REPORTS  Inspection Analytics /ai-inspection-analytics(fix mồ côi) · Performance · Experiments(MỚI) · Time Series · Reports
├─ VISION LAB           Quality Gate · Image Search · Advanced Vision Lab · Anomaly Banks · Mask Annotation · Causal Graph
├─ KNOWLEDGE & TRAINING Knowledge Base(RAG docs, MỚI /ai-knowledge) · Datasets(MỚI /ai-datasets) · Training Studio(MỚI, xem B3)
├─ MODELS               Model Mgmt · Model Versions · GGUF Models(fix mồ côi) · Robot Model Health
└─ SETTINGS             AI Settings (bỏ tab monitoring → gộp vào /ai-monitoring)
```
Copilot lập trình & kỹ thuật viên **giữ ở nhóm ngữ cảnh** (Engineering/Devices) nhưng thêm **hàng cross-link** dưới Trợ lý.

### B1.3 Nhúng theo ngữ cảnh — "AI ở nơi làm việc" (tái dùng `ContextDrawer`+summary và `Dock`+context)
| Màn vận hành | Nhúng | Mẫu tái dùng |
|---|---|---|
| **Repair Station** (0 AI hôm nay) | Drawer: tìm ảnh lỗi tương tự + hướng dẫn sửa + "Hỏi AI về serial này" | ContextDrawer + `RepairAISummary` (nhái MachineAISummary) |
| **Quality Cockpit** (0 AI hôm nay) | Thẻ insight/anomaly theo lỗi + "Giải thích excursion SPC này" | MachineAISummary-style + prefill `/ai-chat` |
| **Root Cause Analysis** | Nhúng Causal-Graph thành panel của chính RCA | dời `/causal-graph` vào drawer/tab |
| **Inspection/AOI detail** | "Tìm tương tự" + "Gate kết quả" inline (thay trang standalone) | widget gọi cùng tRPC |
| **CMMS / Work Orders** | Technician-Copilot **dock** trong ngữ cảnh | mẫu ProgrammingCopilotDock |

### B1.4 Di trú route (rút gọn)
RETIRE→MERGE: `/ai-hub` + `/ai-studio` → `/ai-home`. KEEP: chat/insight/brain/monitoring/models/vision/reports.
SPLIT: `/ai-performance`→tách `/ai-experiments`; `/ai-data-processing`→tách `/ai-datasets`; `/ai-settings`→bỏ tab monitoring.
FIX-MỒ-CÔI (thêm hàng nav): `/ai-inspection-analytics`, `/ai-gguf-models`, `/inbox`. REPURPOSE: `/ai-local-kb`(chatbot)→Chat-mode;
`/ai-knowledge`(MỚI)=kho RAG thật. EMBED: quality-gate/image-search/causal-graph/technician-copilot vào màn vận hành.
*File:* `navigation.tsx` (viết lại nhóm "ai" + bỏ AI khỏi `COLLAPSED_INTO_HUB` + xét lại `tier:'advanced'`), `App.tsx` (4 route mới + redirect), gộp `AIHub.tsx`+`AIStudioHub.tsx`→`AIHome`.

---

## B2. Trợ lý vận hành — hiểu *cách vận hành*, phạm vi hệ sinh thái (yêu cầu 2)

Chủ đầu tư: "không cần bách khoa toàn thư; cần trợ lý hiểu tường tận **chức năng & cách vận hành**, giải đáp thắc mắc **chỉ trong
phạm vi hệ sinh thái**." Hiện trạng (từ báo cáo AI#2): corpus có **173+ how-to + catalog route/nav/schema**, có **off-topic refusal**
(từ chối ngoài phạm vi) + prompt chống bịa — tức **đã scope hệ sinh thái**. Điểm cần nâng để đúng "trợ lý vận hành":
- **B2-1. Grounding theo trục *feature → cách vận hành → tool/màn thật*.** Mỗi tính năng có 1 "operational card" (mở màn nào, bấm gì,
  điều kiện/RBAC, lỗi thường gặp) + **liên kết tới đúng route/tool live** để trả lời "làm thế nào để X" bằng **dẫn đường + prefill**
  (đã có client-tool navigate/prefill). Sinh operational-card **tự động từ catalog** (route/nav/RBAC) + how-to đã viết → giảm nợ thủ công.
- **B2-2. Chống lệch phạm vi mạnh hơn:** ưu tiên tool/answer từ KB hệ sinh thái; câu hỏi ngoài phạm vi → từ chối lịch sự + gợi ý phạm vi.
- **B2-3. Làm tươi tri thức vận hành** (nối B1 & Wave 5): bật `KB_AUTOSYNC` để operational-card không lệch sau mỗi thay đổi UI/route.
- **B2-4. Đóng vòng "hỏi → làm":** từ câu trả lời "cách làm", đưa nút **1-chạm dẫn tới màn + điền sẵn** (tái dùng `AIGuidedActionCards`).

*Gộp vào Wave 5 (B-tasks) + Wave 6 KB freshness.* *File:* `aiLocalKnowledgeService.ts` (operational-card grounding), `scripts/ai-kb/*` (sinh card từ catalog), `aiLocalTools/writeHandlers/client.ts`.

---

## B3. Knowledge & Training Studio — nạp tài liệu / video / web (yêu cầu 3 & 5)

### B3.1 Hiện trạng ingest
- **Có (build-time):** pipeline `scripts/ai-kb/*` (`kb:sync`) → 2 corpus: ops-KB 2.186 chunk + **programming 91.678 chunk/6 hãng** (PDF-only). Embed Qwen3-0.6B 1024-d, có guard đổi-model.
- **Có (runtime, hẹp):** `ingestKnowledgeRecord()` chỉ nạp **1 record text đã trích sẵn** (RCA/insight), không phải file/URL/video. pgvector `kb_chunks` (mig 0121) là substrate mở rộng.
- **Thiếu:** **endpoint upload file** (không có multer/busboy); parser DOCX/PPTX; **STT local cho video** (chỉ có 1 stub Whisper *cloud* chưa nối — vi phạm luật no-cloud); **fetcher URL trong sản phẩm** (puppeteer chỉ dev/PDF; mặc định "không HTTP ra ngoài"); OCR có hạ tầng (RapidOCR) nhưng TẮT & chưa nối.

### B3.2 Khả thi từng nguồn
| Nguồn | Có? | Thiếu | Effort | Local? |
|---|---|---|---|---|
| PDF text | Có (build-time) | endpoint upload + service ingest tổng quát + namespace + job/progress | S–M | ✅ |
| DOCX/PPTX/MD/TXT | MD/TXT dễ; **thiếu DOCX/PPTX** | thêm `mammoth` + dispatch parser | S | ✅ |
| PDF scan (OCR) | Bị **skip**; OCR có nhưng TẮT | nối RapidOCR ONNX vào ingest | M | ✅ |
| **VIDEO** | **Không có STT local** | **whisper.cpp/GGUF (hoặc Python sidecar) + ffmpeg** → transcript có timestamp → chunk | **L** | ✅ (build mới lớn nhất) |
| **WEB/URL** | **Không có fetcher** | fetch→readable-text (cheerio/readability)→chunk + **guard SSRF** (chặn IP nội bộ/metadata, cờ `WEB_INGEST_ENABLED`, audit) | M | ✅ (phải opt-in vì mặc định no-egress) |
| RAG grounding | Có (ops/prog) | **abstraction multi-corpus/namespace** (product/machine/tenant) + filter khi query, đẩy hết qua pgvector | M | ✅ |

### B3.3 Bậc "model chuyên dụng" — reality check trung thực
- **(a) RAG-grounding — SẴN SÀNG, mặc định "chuyên dụng".** Copilot lập trình đã chứng minh: Qwen3 local + `searchProgrammingKb` + **bắt buộc citation**. **~90%** nhu cầu "train theo tài liệu của tôi" thoả bằng **ingest + grounding** — rẻ, an toàn, cập nhật tức thì, không cần train GPU, không quên thảm hoạ. **Ship trước, gọi là "Specialists".**
- **(b) Train head thị giác — SẴN CÓ** (Tier-1 `aiLocalTraining`; Tier-2 sidecar `train.py` cần hoàn thiện) — cho **classifier/segmenter lỗi**, không phải LLM.
- **(c) LoRA/QLoRA của LLM GGUF — CHƯA CÓ → CHỦ ĐẦU TƯ CHỐT BUILD NGAY.** *Khả thi* offline trên RTX-5090 cho Qwen3 ≤4–8B qua Python PEFT/Unsloth sidecar + `convert_lora_to_gguf`. **Lưu ý kỹ thuật (giữ để đặt kỳ vọng đúng):** fine-tune dạy *văn phong/định dạng/hành vi*, **không** dạy *sự thật* — sự thật vẫn thuộc RAG; nên **kết hợp** LoRA (phong cách/đặc thù miền) + RAG (dữ kiện). Là subsystem **operator-managed, gated, có eval→gate→register→activate như model khác**. Ứng dụng đầu: model coder đặc thù ngành/phong cách ST-ladder + model trợ lý đặc thù hệ sinh thái. Effort **L** (E3-6).
- **(d) Full fine-tune — ngoài phạm vi.**

### B3.4 Thiết kế Studio (1 trang role-gated "AI Knowledge & Training Studio")
5 khối: **Source Manager** (thêm doc/video/URL/folder) → **Ingestion Job Queue** (tiến độ theo pha parse→OCR?→transcribe?→chunk→embed→index, log skip/low-yield, retry/cancel) → **Corpus/Namespace Manager** (scope: ecosystem-general / programming-vendor / product / machine / tenant; badge khớp-embed-model; staleness; bật/tắt corpus) → **Eval & Preview** ("Hỏi corpus này": retrieval + generate có citation; golden-set eval tái dùng `eval-rag.mjs`) → **Specialized-Model Builder** (chọn bậc: ground-only / head-train / LoRA → eval → gate → register → activate, tái dùng `activateVersion` + quality gate + model card).
*Backend mới (tái dùng trước):* `kbIngestService`, `kbDocParser`(mammoth/pdf/ocr), `kbVideoTranscriber`(ffmpeg+whisper), `kbWebFetcher`(SSRF-guard), `kbCorpusRegistry` + bảng `kb_corpora`/`kb_ingest_jobs` + cột `kb_chunks.namespace`, router `kbStudioRouter`, endpoint upload multipart (multer); *(tuỳ chọn)* `aiLlmFinetuneSidecar` + `tools/trainer/finetune_lora.py`. *Ưu tiên copilot lập trình:* ingest doc chung → nạp thêm manual/tài liệu hãng vào corpus programming = nâng thẳng use-case quan trọng nhất.

---

## B4. AI Agent Command Center — trực quan kiểu Marvis (yêu cầu 4)

### B4.1 Dữ liệu sẵn có vs thiếu
- **Có:** orchestrator sessions (`ai_agent_sessions`: status/stepResults/cursor); **4 specialist agents** (`ai_specialist_session_steps` có **token/step gốc**); HITL actions (`ai_pending_actions` status/audit); insights; token telemetry (`ai_gateway_metrics`, theo user/task). Real-time khả thi: **Socket.IO** (rooms) + **SSE** đã có.
- **Thiếu:** **roster agent thống nhất**; list session **xuyên-người** cho ops (nay `getSession` owner-only); token **theo session/agent** (nay chỉ theo user); **đồng hồ "tiết kiệm vs cloud"** (grep=0 → phải *dẫn xuất*); kênh event agent (phải thêm emit); và **chính trang Command Center** (AIBrainDashboard chỉ là engine).

### B4.2 Roster 9-persona (mỗi persona ↔ 1 nguồn status cụ thể)
1 **Operations Agent** (orchestrator) · 2–5 **Data Insight / Backend Refactor / Frontend UX / QA Strategist** (specialists) · 6 **RCA Watcher** · 7 **Proactive Agent** (auto-proposer) · 8 **Orchestration Advisor** · 9 **Copilot Chat** · (+ **Scheduled Agents**: batch-RCA/self-learning/anomaly-bank/threshold-tune).
Vốn từ trạng thái: `working` · `idle/standby` ("zzz") · `blocked/awaiting-approval` · `disabled`(cờ tắt) · `error`.

### B4.3 Thiết kế Command Center (professional B2B, không cartoon)
**Agent Floor** (lưới thẻ agent: danh tính + status pill + task hiện tại + progress x/n + token hôm nay; đang-làm nổi lên, idle mờ "standby") + **Right rail token/tiết-kiệm** + **Live task feed** dưới (chip in-progress/completed/awaiting-approval + token/task + timestamp) + **drill-in** ContextDrawer **tái dùng `AgentPlanCard`** cho orchestrator, renderer step cho specialist. Nút approve/steer nối `aiAgent.confirmStep`/`aiInbox`/`aiCopilot.confirmAction` (**HITL giữ nguyên — center không tự thực thi**). Real-time: room `ai:agents` (hoặc SSE `ai-agents`), fallback poll 5s như AIBrainDashboard. **Chốt: ship dashboard chuyên nghiệp trước (E2-1..E2-4); "floor 3D" kiểu Marvis là chế-độ tuỳ chọn làm SAU** (E2-5, tái dùng twin canvas đã có — cùng dữ liệu roster, chỉ khác cách bày).

### B4.4 Đồng hồ "token tiết kiệm nhờ local" (câu chuyện ROI — hợp doc 66)
`aiCostModel.ts`: `estimateCloudEquivalent(tokensIn,out,model)` theo bảng giá cloud cấu hình (`AI_CLOUD_PRICE_*`). Vì chi phí biên local ≈ $0, **tiết kiệm = toàn bộ chi phí cloud-tương-đương**. Tổng hợp hôm-nay/tháng + "% tải giữ on-prem" — trung thực khi chưa có dữ liệu. *(Tuỳ chọn) cột `agent`/`sessionId` cho `ai_gateway_metrics` để quy token chính xác theo agent.*
*Backend mới:* `aiAgentCenterService` (read-model), `aiAgentCenterRouter` (`moduleProcedure("MOD_AI")`), `aiCostModel`; sửa `aiAgentOrchestrator`(list ops-scoped + emit), `aiSpecialistAgentRouter`/`aiCopilotActions`(emit), `socket.ts`(room+bridge). *Client:* `AIAgentCommandCenter.tsx` + AgentFloor/AgentCard/TokenSavingsRail/LiveTaskFeed (tái dùng AgentPlanCard).

---

## B5. Waves bổ sung (E-track) + backlog

> E-track = "lớp trải nghiệm", **đan xen** với Phần A (xem lộ trình hợp nhất B6). Tất cả default-OFF khi phù hợp; DDL owner `aoi`.

- **Wave E1 — IA/UX cohesion:** gộp `/ai-home`, rail = taxonomy (bỏ AI khỏi COLLAPSED_INTO_HUB), fix 3 mồ côi, tách trang chật (experiments/datasets/monitoring), rescue Assistant khỏi `tier:advanced`, nhúng ngữ cảnh Repair/Quality/RCA. *(Nền cho mọi thứ — làm sớm cạnh Wave 0/1.)*
- **Wave E2 — AI Home + Agent Command Center:** roster + status normalizer + read-model + savings meter + task feed + drill-in + kênh real-time. *(Cặp với Wave 3 agent-loop — agent loop tạo ra "việc" để Center hiển thị.)*
- **Wave E3 — Knowledge & Training Studio:** namespace/multi-corpus trên pgvector + **ingest doc + web + video SONG SONG** (upload endpoint + job queue; doc pdf/docx/md/txt · URL SSRF-guard · video whisper+ffmpeg) + OCR → Studio UI + eval → **LoRA/QLoRA sidecar (build ngay)** → GGUF → register/activate. *(Cặp với Wave 4 copilot + Wave 5 assistant + Wave 6 MLOps. Đợt lớn nhất — tách sub-lô để review từng phần.)*
- **Wave E4 — Trợ lý vận hành:** operational-card grounding + scope-guard mạnh + "hỏi→làm" 1-chạm. *(Gộp Wave 5.)*

### Backlog E-track

> **★ TRẠNG THÁI (2026-07-27): TẤT CẢ E-track ĐÃ THỰC THI + PUSHED** (`feat/hmi-dep`, HEAD `3bd8f6be`).
> E1-1..E1-4 ✅ (GĐ1) · E4-1/E4-2 ✅ (GĐ2, G2-7) · E2-1..E2-4 ✅ (GĐ4, Command Center — **LIVE-verified**; E2-5 floor-3D
> hoãn theo thiết kế) · E3-1..E3-6 ✅ (GĐ5, Training Studio: doc/URL/video/OCR ingest + LoRA sidecar; Studio-UI
> **LIVE-verified**). Migrations 0304/0305/0306 (E3) đã chạy. Fast-follow trước-khi-bật-cờ: E3-6 startFinetune
> sync→background-job trước khi bật `LLM_FINETUNE_CMD` (xem "TRẠNG THÁI THỰC THI" đầu doc).

| ID | Wave | Nhiệm vụ | File chính | Effort | Risk |
|---|---|---|---|---|---|
| E1-1 | E1 | Gộp AIHub+AIStudioHub → `/ai-home`; rail = taxonomy | `navigation.tsx`, `App.tsx`, `AIHome.tsx` | L | TB |
| E1-2 | E1 | Fix 3 route mồ côi + rescue Assistant khỏi tier:advanced | `navigation.tsx` | S | Thấp |
| E1-3 | E1 | Tách trang chật: `/ai-experiments`, `/ai-datasets`, bỏ tab monitoring của Settings | `AIPerformanceDashboard.tsx`, `AIDataProcessingPage.tsx`, `AISettingsPage.tsx` | M | TB |
| E1-4 | E1 | Nhúng AI ngữ cảnh: Repair/Quality/RCA (+CMMS technician dock) | `RepairStation.tsx`, `QualityCockpit.tsx`, `RootCauseAnalysisPage.tsx` | L | TB |
| E2-1 | E2 | Roster registry + status normalizer + read-model + list session ops-scoped | `aiAgentCenterService.ts` (mới), `aiAgentOrchestrator.ts` | M | TB |
| E2-2 | E2 | Savings estimator + token summary | `aiCostModel.ts` (mới), `aiAgentCenterRouter.ts` (mới) | M | Thấp |
| E2-3 | E2 | Trang Command Center (Agent Floor + rail + task feed + drill-in) | `AIAgentCommandCenter.tsx` (+4 component) | L | TB |
| E2-4 | E2 | Kênh real-time `ai:agents` (bus→socket bridge, emit ở choke points) | `socket.ts`, `aiAgentOrchestrator.ts`, `aiCopilotActions.ts` | M | TB |
| E2-5 | E2 (sau) | Chế-độ "floor 3D" kiểu Marvis (tuỳ chọn, tái dùng twin canvas) | `AgentFloor3D.tsx` (mới), twin canvas | M | Thấp |
| E3-1 | E3 | Namespace/multi-corpus trên pgvector + generic doc ingest (pdf/docx/md/txt) + upload endpoint | `kbIngestService.ts`+`kbDocParser.ts` (mới), `kbVectorStore.ts`, multer | L | TB |
| E3-2 | E3 | Studio UI (Source/Jobs/Corpus/Eval/Model-Builder) + `kbStudioRouter` + bảng `kb_corpora`/`kb_ingest_jobs` | `KbStudioPage.tsx`, `kbStudioRouter.ts` (mới) | L | TB |
| E3-3 | E3 | URL ingester SSRF-guard (`WEB_INGEST_ENABLED`) — **song song** | `kbWebFetcher.ts` (mới) | M | Cao |
| E3-4 | E3 | Video transcription local (whisper.cpp/sidecar + ffmpeg) — **song song** | `kbVideoTranscriber.ts` (mới) | L | TB |
| E3-5 | E3 | OCR scanned-PDF (nối RapidOCR) | `kbDocParser.ts`, OCR engine | M | TB |
| E3-6 | E3 | **LoRA/QLoRA sidecar → GGUF → register (build ngay, gated, eval→gate→activate)** | `aiLlmFinetuneSidecar.ts`, `tools/trainer/finetune_lora.py` (mới) | L | Cao |
| E4-1 | E4/W5 | Operational-card grounding (feature→cách vận hành→tool) sinh từ catalog | `aiLocalKnowledgeService.ts`, `scripts/ai-kb/*` | M | TB |
| E4-2 | E4/W5 | "Hỏi→làm" 1-chạm (navigate+prefill) từ câu trả lời how-to | `AIGuidedActionCards.tsx`, `aiLocalTools/writeHandlers/client.ts` | S | Thấp |

---

## B6. Lộ trình hợp nhất (Phần A + Phần B, "cân bằng")

> **★ CẢ 6 GIAI ĐOẠN DƯỚI ĐÂY ĐÃ THỰC THI + PUSHED (2026-07-27, HEAD `3bd8f6be`)** — xem bảng chi tiết + commit mốc ở
> mục "★ TRẠNG THÁI THỰC THI" đầu doc.

| Giai đoạn | Nội dung | Mục tiêu |
|---|---|---|
| **1** | **Wave 0** (correctness+security) **+ Wave E1** (IA/UX cohesion) | Hết lỗi/hở bảo mật + hết rời rạc: 1 taxonomy, hết chật, AI nhúng đúng chỗ |
| **2** | **Wave 1** (choke-point/safety/quota/edition) **+ Wave E4** (trợ lý vận hành) | Nền tảng an toàn để bán + trợ lý hiểu cách vận hành |
| **3** | **Wave 2** (AI#1) **+ Wave 6** (MLOps cold-start: bootstrap classifier) | Phân tích theo machine-type + động cơ ML hết rỗng |
| **4** | **Wave 3** (AI#4 agent-loop) **+ Wave E2** (Agent Command Center) | Agent lý luận thật + **hiển thị trực quan** việc agent + ROI local |
| **5** | **Wave 4** (AI#3 inline copilot) **+ Wave E3** (Training Studio) | Copilot inline + **studio nạp doc/video/web** nuôi copilot |
| **6** | **Wave 5** (AI#2 hợp nhất chat + freshness + feedback) | Trợ lý 1 engine, tươi, có vòng phản hồi |

## B7. Nghiệm thu bổ sung (Phần B)
1. **Gắn kết:** 1 taxonomy AI ở menu trái; **0 route mồ côi**; không trang AI nào >5 tab; AI hiện diện trong Repair/Quality/RCA.
2. **Trợ lý vận hành:** trả lời "làm thế nào để X" bằng **dẫn đường + prefill** đúng màn/tool; từ chối ngoài phạm vi hệ sinh thái.
3. **Studio:** nạp được **tài liệu** (pdf/docx/md/txt) → hỏi-đáp có citation ngay; **URL** (có SSRF-guard) và **video** (STT local) nạp được; corpus có namespace/scope; copilot lập trình nạp thêm tài liệu → grounding tốt hơn (đo bằng eval).
4. **Sinh model chuyên dụng:** **RAG-Specialist** (ground-only) tạo/kích hoạt được qua Studio; head-train thị giác chạy qua gate; **LoRA/QLoRA sidecar chạy được end-to-end** (dataset → fine-tune → convert GGUF → eval → gate → register → activate), default-OFF, có model chuyên dụng đầu tiên (coder/trợ lý) demo LIVE.
5. **Agent Command Center:** roster 9-persona hiện status live; task feed in-progress/completed; **đồng hồ token + tiết kiệm-local**; drill-in step trail; approve/steer giữ HITL.

---

> **Bước tiếp theo:** chờ chủ đầu tư **review + phê duyệt** (Phần A + Phần B) và chốt **lộ trình hợp nhất B6** (hoặc điều chỉnh
> thứ tự). Sau khi duyệt, các AI Agent thực thi triển khai **theo từng giai đoạn** (bắt đầu Giai đoạn 1 = Wave 0 + Wave E1),
> mỗi hạng mục có **live self-check + PROVEN-LIVE + review đối kháng** trước khi merge. Mọi tính năng mới **default-OFF**;
> DDL bằng owner `aoi`; restart process sau sửa server; giữ triết lý **honest-degradation + HITL**.
