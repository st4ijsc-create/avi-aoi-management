# THIẾT KẾ "BỘ NÃO AI CỤC BỘ" & KẾ HOẠCH NÂNG CẤP — ST4I Smart Factory
### Local-First AI Brain: thiết kế hệ thống hoàn chỉnh + lộ trình nâng cấp chi tiết
**Ngày lập:** 2026-06-25 · **Phạm vi:** Tầng L6 Intelligence (AI cục bộ) của nền tảng AVI/AOI · **Trạng thái:** ⏳ Đề xuất — chờ phê duyệt

> Tài liệu này nối tiếp [`02_ST4I_ECOSYSTEM_MASTERPLAN_2026-06.md`](./02_ST4I_ECOSYSTEM_MASTERPLAN_2026-06.md) nhưng **đào sâu riêng tầng AI cục bộ**: làm sao khai thác hết năng lực các model local đã có, và nâng nền tảng thành một "bộ não" đủ sức xử lý tình huống **từ dễ đến khó, đúng quy mô**.
>
> Nguyên tắc trình bày: mọi đề xuất đều bám **code/flag/file thực tế** trong repo (không nói chung chung). Phần A = Thiết kế. Phần B = Kế hoạch nâng cấp theo phase.

---

# PHẦN A — THIẾT KẾ HỆ THỐNG

## A1. Hiện trạng: bạn đang có gì (đánh giá thực)

Sau khi rà soát toàn bộ `server/services/ai*`, router, schema và frontend, đây là sự thật:

- **54 service AI**, **100% local** (lớp cloud OpenAI đã bị gỡ trong code — `aiProviderManager` chỉ còn `"gguf" | "offline"`). `.env` vẫn còn `OPENAI_API_KEY`, `AI_PRIMARY_PROVIDER=openai`, `OLLAMA_*` nhưng **code không đọc** → cấu hình rác cần dọn.
- **Engine suy luận**: GGUF in-process (`aiGgufEngine.ts`), ONNX (`aiInferenceEngine.ts`), vision sidecar `llama-server` mtmd (`llamaVisionSidecar.ts`), semaphore chống OOM (`ggufConcurrency.ts`).
- **Lớp điều phối đã có nhưng TẮT**: event bus (`_core/eventBus.ts`), rules engine (`ORCHESTRATION_ENABLED=false`), AI watcher (`AI_ORCHESTRATION_ENABLED=false`), agentic HITL (`AI_AGENTIC_ENABLED`), KB pgvector (`KB_PGVECTOR_ENABLED=false`), anomaly (`ANOMALY_DETECTION_ENABLED=false`).
- **MLOps**: training local (Tier-1 ONNX + Tier-2 sidecar Python), eval harness, A/B canary, calibration, drift, active learning, edge deploy — **đầy đủ khung, phần lớn chưa bật vòng kín**.
- **14 trang UI AI**, ~29 router, 50+ bảng DB (pgvector cho image + KB).

**Kết luận:** Khoảng trống KHÔNG phải thiếu tính năng. Khoảng trống là **(1) chưa có "bộ điều phối thông minh" chọn đúng model cho đúng độ khó**, **(2) hơn nửa năng lực đang tắt sau flag**, **(3) chỉ dùng 2/8 model GGUF**, **(4) cấu hình sai/rác làm chạy dưới mức tối ưu**.

---

## A2. Sự thật phần cứng & ngân sách tài nguyên *(nền tảng của mọi quyết định)*

| Thành phần | Thực tế (đo 2026-06-25) | Hệ quả thiết kế |
|---|---|---|
| **GPU** | **GTX 750 Ti — 2 GB VRAM** (Maxwell 2014, CC 5.0) | ❌ Không đủ chạy LLM/VLM 7B. ✅ Chỉ hợp ONNX nhỏ (DINOv2 88–346MB) qua DirectML. **Comment "RTX 4050 6GB" trong .env là SAI/cũ.** |
| **CPU** | **i7-12700KF — 12 nhân / 20 luồng** | ✅ Đây là engine suy luận chính. Vision 8.9s/ảnh (đã đo) hoàn toàn nhờ CPU. |
| **RAM** | **47.8 GB** | ✅ Tài sản lớn nhất: giữ được **nhiều** model GGUF thường trú cùng lúc + KV cache lớn. |

**Định hướng kiến trúc bắt buộc (giai đoạn hiện tại):** **CPU-first, RAM-rich, GPU chỉ cho ONNX nhỏ.** "Scale" ở đây = (a) chọn model nhỏ cho việc dễ để tăng throughput, (b) tận dụng RAM giữ nhiều model nóng, (c) hàng đợi + ưu tiên thay vì chạy song song nhiều LLM (CPU sẽ nghẽn).

### 🔜 Lộ trình GPU đã xác nhận (thay đổi lớn về quy mô)
Anh/chị **sẽ nâng GPU**: tối thiểu **RTX 5060 Ti 16GB**, dự kiến **RTX 5090 32GB**. Điều này mở khóa một nhánh kiến trúc **GPU-accelerated** hoàn toàn khác:

| Năng lực | CPU hiện tại (GTX 750 Ti 2GB) | RTX 5060 Ti 16GB | RTX 5090 32GB |
|---|---|---|---|
| Qwen2.5-7B text trên GPU | ❌ CPU (~7s) | ✅ toàn bộ layer (<1s) | ✅ + ctx lớn |
| Qwen2.5-VL vision | ❌ CPU (8.9s/ảnh) | ✅ GPU (sub-giây) | ✅ GPU nhanh nhất |
| Chạy đồng thời text + vision trên GPU | ❌ | ⚠️ chật (16GB) | ✅ **cả 7B text + 7B VL cùng lúc** |
| Fast-tier + reasoning + vision đồng thời | ❌ | một phần | ✅ **cả 3 tầng nóng trên GPU** |
| `GGUF_GPU` | `false` (ép CPU) | `auto` | `auto` |
| `LLAMA_VISION_GPU_LAYERS` | `0` | `999` | `999` |
| llama.cpp build | CPU (b8770) | **cần build CUDA** | **cần build CUDA** |

**Hệ quả thiết kế khi có GPU (đặc biệt 5090 32GB):**
- Model Router (A5) đổi từ "hàng đợi tuần tự CPU" → **chạy song song thật trên GPU** (`GGUF_MAX_CONCURRENCY` tăng 2–4).
- Vision chuyển từ batch/queue → **real-time inline** (đủ cho kiểm tra theo nhịp dây chuyền).
- Có thể nạp đồng thời: 3B fast + 7B reasoning + Qwen2.5-VL → cả 3 tầng nóng, không tranh chấp.
- **Việc cần làm khi GPU về:** thay `llama.cpp` build CPU bằng **build CUDA**, đổi `GGUF_GPU=auto` + `LLAMA_VISION_GPU_LAYERS=999`, build lại `node-llama-cpp` với CUDA, tăng concurrency. Xem Phase A1bis (B-phần).

> ⚠️ Hai cấu hình tách biệt: thiết kế dưới đây giữ **đường CPU-first an toàn cho hiện tại**, đồng thời mọi flag đều có ghi chú "🔜 sau nâng GPU" để chuyển đổi 1 dòng.

### Ngân sách bộ nhớ đề xuất (47GB RAM)
| Hạng mục | Ước tính | Ghi chú |
|---|---|---|
| Qwen2.5-7B Q4 (text, thường trú) | ~4.7 GB | `GGUF_DEFAULT_MODEL` |
| mxbai-embed-large (embed, thường trú) | ~0.7 GB | `GGUF_EMBED_MODEL` |
| Model nhỏ "fast tier" (3B, đề xuất tải) | ~2–3 GB | việc dễ/phân loại — xem A3 |
| Vision sidecar Qwen2.5-VL + mmproj | ~5 GB model + **KV cache** | KV ở ctx 128k = **7GB** ⚠️ — phải giảm ctx (xem B0) |
| OS + Node + Postgres + còn lại | ~10–15 GB | |
| **Tổng đỉnh an toàn** | **~30–35 GB** | Còn dư → có thể nâng `GGUF_MAX_LOADED_MODELS` lên 3–4 |

> 🔴 **Lỗ hổng đang lãng phí RAM & tốc độ:** vision sidecar chạy `n_ctx=128000` → cấp phát **7GB KV cache** vô ích cho việc mô tả 1 ảnh. Giảm `--ctx-size` xuống 8192 sẽ tiết kiệm ~6.5GB và khởi động nhanh hơn.

---

## A3. Danh mục Model (Model Portfolio) — dùng gì cho việc gì

Bạn có **8 file GGUF + 2 ONNX** trong `D:/SOURCES/16.AI`. Hiện chỉ 2 được dùng. Phân vai chuẩn:

| Model | Kích thước | Vai trò đề xuất | Trạng thái |
|---|---|---|---|
| **qwen2.5-7b-instruct Q4_K_M** | 4.7 GB | 🧠 **Reasoning tier** — RCA, report, planner, KB QA chất lượng cao | ✅ Đang dùng (`GGUF_DEFAULT_MODEL`) |
| **mxbai-embed-large-v1 F16** | 0.7 GB | 🔢 **Embedding 1024-d** — RAG, KB, image-as-text | ✅ Đang dùng (`GGUF_EMBED_MODEL`) |
| **Qwen2.5-VL-7B Q3_K_XL** + **mmproj-F16** | 4 GB + 1.35 GB | 👁️ **Perception tier** — mô tả lỗi, visual QA, OCR, so ảnh | ✅ Vừa nối (sidecar verified 8.9s/ảnh) |
| **model.onnx (DINOv2-small, 384-d)** | 88 MB | 📐 **Image embedding/anomaly** nhanh trên GPU/CPU | ✅ Vừa đăng ký (modelId=3) |
| **DINOv2-base.onnx (768-d)** | 346 MB | 📐 Image embedding **độ chính xác cao hơn** (tier 2 anomaly) | ⚪ Chưa dùng — nên đăng ký làm biến thể "accurate" |
| **gemma-4-E2B-it BF16** | 9.3 GB | ⚡ Ứng viên **multimodal/độ chính xác cao** HOẶC loại bỏ (BF16 nặng, chậm trên CPU) | ⚪ Chưa dùng — **đánh giá rồi quyết** (xem B1) |
| **llava-1.6-mistral-7b Q8** + **mmproj-model-f16** | 7.7 GB + 624 MB | 👁️ Vision **dự phòng** (English-mạnh). Có thể giữ làm fallback hoặc bỏ | ⚪ Chưa dùng |
| ❌ `uploads/gguf-models/llava-v1.6-mistral-7b-q4_k_m.gguf` | 73 MB | **File hỏng** (placeholder, code đã cảnh báo) | 🗑️ **Nên xóa** |

**Khuyến nghị bổ sung 1 model nhỏ "Fast tier"** (tải mới, ~2–3GB): `Qwen2.5-3B-Instruct Q4_K_M`. Lý do: việc dễ (phân loại intent, trích xuất có cấu trúc, tóm tắt ngắn) không cần 7B → 3B nhanh gấp ~2–3× trên CPU, giải phóng 7B cho việc khó. Đây là chìa khóa "đúng quy mô".

---

## A4. ⭐ Thang Leo Nhận Thức (Cognitive Escalation Ladder) — trái tim của "dễ → khó"

Đây là khái niệm trung tâm trả lời câu hỏi của anh/chị. Mỗi yêu cầu được **định tuyến tới tầng rẻ nhất đủ giải quyết nó**; chỉ leo thang khi cần. Tầng càng thấp càng nhanh/rẻ.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ TIER 4 — CON NGƯỜI / FEDERATION   HITL phê duyệt · cloud đa-nhà-máy (tùy chọn) │
│  Khi nào: hành động ghi nguy hiểm · độ tin cậy thấp · ngoài năng lực local   │
├──────────────────────────────────────────────────────────────────────────┤
│ TIER 3 — TRI GIÁC (Perception)    Qwen2.5-VL sidecar · DINOv2 ONNX           │
│  Việc: mô tả lỗi ảnh · visual QA · OCR · anomaly · similar-image search      │
├──────────────────────────────────────────────────────────────────────────┤
│ TIER 2 — SUY LUẬN SÂU (Deep)      Qwen2.5-7B + RAG + planner đa bước (HITL)  │
│  Việc: RCA · báo cáo · agentic plan · KB QA khó · executive summary          │
├──────────────────────────────────────────────────────────────────────────┤
│ TIER 1 — NHẬN THỨC NHANH (Fast)   Model 3B + GBNF JSON + tool-calling        │
│  Việc: phân loại intent · trích xuất cấu trúc · tóm tắt · chọn tool · chat    │
├──────────────────────────────────────────────────────────────────────────┤
│ TIER 0 — PHẢN XẠ (Reflex)         Rule/heuristic/SQL — KHÔNG LLM, tức thì     │
│  Việc: SPC rule · ngưỡng NG · time-series (EWMA/Holt-Winters) · tool DB-only │
└──────────────────────────────────────────────────────────────────────────┘
        ▲ Định tuyến bởi MODEL ROUTER (A5): phân loại độ khó → chọn tầng
```

**Ánh xạ tầng ↔ service đã có:**

| Tier | Việc điển hình | Service hiện hữu | Bật chưa? |
|---|---|---|---|
| 0 Reflex | Ngưỡng NG, SPC, time-series anomaly, tool DB | `rulesEngine`, `aiTimeSeriesEngine`, `aiLocalTools/handlers*` | ⚠️ tools ✅; rulesEngine ❌ off |
| 1 Fast | Intent, JSON cấu trúc, chat ngắn, chọn tool | `intentClassifier`, `aiChatAssistant`, `generateJSON` (GBNF) | ✅ có (dùng 7B — nên hạ xuống 3B) |
| 2 Deep | RCA, report, agentic plan, KB QA | `aiInsightsService`, `aiReportGenerator`, `aiAgentPlanner/Orchestrator`, `aiLocalKnowledgeService` | ⚠️ agentic/RCA-scheduler một phần off |
| 3 Perception | Mô tả lỗi, visual QA, anomaly, image search | `aiVisionLanguage`, `aiAdvancedVision`, `aiAnomalyDetection`, `aiImageEmbedding` | ⚠️ vision ✅; anomaly ❌ off |
| 4 Human/Fed | HITL confirm, federation | `aiCopilotActions` (propose→confirm), `aiPendingActions` | ✅ HITL có; federation ❌ chưa |

**Quy tắc leo thang (escalation policy)** — triển khai trong Model Router:
1. Mọi yêu cầu thử **Tier 0** trước (rule/heuristic match) → nếu khớp, trả ngay.
2. Không khớp → **Tier 1** phân loại độ khó + intent (model 3B, GBNF, <1s).
3. Nếu intent cần dữ liệu → gọi **tool (Tier 0 DB)**; cần suy luận → **Tier 2** (7B + RAG).
4. Nếu có ảnh trong ngữ cảnh → **Tier 3** (sidecar VL).
5. Nếu **độ tin cậy < ngưỡng** HOẶC là **hành động ghi** → **Tier 4** (HITL) bắt buộc.
6. Mọi tầng đều **degrade trung thực**: thiếu model → báo rõ, không bịa (đã là invariant trong code).

---

## A5. Thiết kế Model Router (lớp còn thiếu — cần xây)

Hiện `aiProviderRouter.ts` chỉ "gguf vs offline". Cần nâng thành **Tiered Model Router** quyết định *model nào + tầng nào* theo:

```
Input: { task, hasImage, payloadSize, requiredQuality, latencyBudget, userRole }
        │
        ▼
 [1] Difficulty classifier  ─ heuristic trước (độ dài, có ảnh?, là write?), 
     LLM-3B fallback nếu mơ hồ  ──►  difficulty ∈ {trivial, easy, medium, hard}
        │
        ▼
 [2] Policy table  (difficulty × task) → chọn tier + modelId + maxTokens + temp
        │
        ▼
 [3] Load-aware gate  ─ đọc getGgufQueueStats(): nếu hàng đợi đầy → hạ tier 
     hoặc enqueue (aiJobQueue) thay vì block
        │
        ▼
 [4] Execute  + telemetry (tier, model, latency, tokens, fallbackUsed)
```

**Bảng policy mẫu** (`config/aiRouterPolicy.ts` đề xuất — code, version-controlled):

| Task | trivial | easy | medium | hard |
|---|---|---|---|---|
| chat | tool/template | 3B | 7B | 7B + RAG |
| intent classify | regex | 3B GBNF | 3B GBNF | — |
| extract JSON | regex | 3B GBNF | 7B GBNF | 7B GBNF |
| RCA / report | — | template | 7B | 7B + RAG + retry |
| vision describe | — | — | VL sidecar | VL + ROI crop |
| anomaly | heuristic grid | DINOv2-small | DINOv2-small | DINOv2-base |

**Lợi ích:** việc dễ rời 7B → throughput tăng nhiều lần; việc khó vẫn full power; CPU không bị tranh chấp.

---

## A6. Kiến trúc tham chiếu "Bộ não AI" (5 lớp nhận thức)

```
┌─────────────────────────────────────────────────────────────────────┐
│ GOVERNANCE & OBSERVABILITY  model card · audit suy luận · drift · KPI  │ ← xuyên suốt
├─────────────────────────────────────────────────────────────────────┤
│ (5) ACTION & AUTONOMY    agentic planner · HITL propose/confirm ·      │
│                          rulesEngine · aiWatcher (event-driven)        │
├─────────────────────────────────────────────────────────────────────┤
│ (4) REASONING            Model Router → Tier 1/2 · GBNF JSON · tools   │
├─────────────────────────────────────────────────────────────────────┤
│ (3) RETRIEVAL/MEMORY     RAG (KB pgvector) · image embeddings ·        │
│                          knowledge graph · feedback store              │
├─────────────────────────────────────────────────────────────────────┤
│ (2) PERCEPTION           Qwen2.5-VL sidecar · DINOv2 ONNX · OCR        │
├─────────────────────────────────────────────────────────────────────┤
│ (1) FOUNDATION           aiGgufEngine · ggufConcurrency · job queue ·  │
│                          model registry · GGUF/ONNX runtime            │
└─────────────────────────────────────────────────────────────────────┘
         ▲ tất cả ăn dữ liệu từ EVENT BUS (_core/eventBus.ts)
```

Toàn bộ 6 lớp **đã có service tương ứng** — việc cần làm là **nối Model Router (lớp 4) + bật lớp 5 + nâng cấp lớp 3 (RAG)**, không phải viết lại.

---

## A7. Kiến trúc Dữ liệu & Trí nhớ (RAG production)

- **KB pgvector**: bảng `kb_chunks` + `kbVectorStore.ts` đã có nhưng `KB_PGVECTOR_ENABLED=false` (đang dùng jsonl file). → Bật + ingest SOP/sự cố/tài liệu.
- **Image embeddings**: `ai_image_embeddings` (pgvector HNSW 1024-d) + DINOv2 384-d. → Re-embed lịch sử bằng DINOv2 để image search/anomaly dùng vector thật.
- **Knowledge Graph (mới)**: thêm quan hệ máy↔lỗi↔nguyên nhân↔hành động để RCA có ngữ cảnh nhân-quả, không chỉ similarity. `knowledge/semantic-graph.json` đã có mầm mống.
- **Feedback loop**: `ai_feedback`, `ai_label_queue`, `ai_training_batches` → khép vòng active-learning → auto-retrain (Tier-1 local).

---

## A8. An toàn, Quản trị & Quan sát AI

- **Safety invariant (giữ nguyên, đã tốt):** mọi hành động ghi đi qua `proposeAction → confirmAction` (HITL, RBAC, TTL 5'); orchestrator/watcher **không bao giờ** tự execute. Đây là lớp Tier-4 — không được nới lỏng.
- **Governance (cần hoàn thiện):** model card per model (đã có bảng `ai_models.metadata`), audit mọi lần suy luận (`inference_results`, `ai_insights`), tuân thủ EU AI Act (logging quyết định, quyền giải thích → đã có `aiExplainability`).
- **Observability (bật lên):** `METRICS_ENABLED=true` đã có → export tier/model/latency/queue ra Prometheus; thêm dashboard Grafana "AI Brain" (throughput theo tier, p95 latency, fallback rate, drift).

---

# PHẦN B — KẾ HOẠCH NÂNG CẤP CHI TIẾT

> Triết lý: **dọn cấu hình & tối ưu tài nguyên trước (rủi ro ~0, lợi ích ngay) → xây Model Router → nâng RAG → bật bộ não → mở rộng tri giác & MLOps.** Mỗi phase: mục tiêu · việc cụ thể (file/flag) · Done · rủi ro.

Mỗi phase độc lập tương đối; có thể duyệt & chạy từng phase.

---

## PHASE A0 — Cấu hình "sự thật" & Tối ưu tài nguyên *(1–2 ngày · rủi ro thấp · QUICK WIN)*

**Mục tiêu:** Hệ thống chạy đúng năng lực phần cứng thật, bỏ cấu hình rác gây hiểu nhầm.

| # | Việc | Chi tiết |
|---|---|---|
| A0.1 | **Dọn .env rác** | Bỏ/comment `OPENAI_API_KEY`, `AI_PRIMARY_PROVIDER=openai`, `AI_*_CLOUD_MODEL`, toàn bộ `OLLAMA_*` (code không đọc, `USE_LEGACY_OLLAMA=false`). Tránh hiểu nhầm "đang gọi cloud". |
| A0.2 | **Sửa nhãn GPU sai** | Cập nhật comment `.env` (Tier-3): GPU thật = GTX 750 Ti 2GB. Đặt `GGUF_GPU=false` (ép CPU cho LLM — 2GB không offload nổi 7B, "auto" có thể gây lỗi/chậm). Giữ `ENABLE_GPU` cho ONNX DML (DINOv2 nhỏ chạy được trên 2GB). |
| A0.3 | **Giảm ctx vision sidecar** | Thêm `--ctx-size 8192` (hoặc env mới `LLAMA_VISION_CTX`) vào args trong `llamaVisionSidecar.ts`. Tiết kiệm ~6.5GB RAM KV-cache, khởi động nhanh hơn. |
| A0.4 | **Tinh chỉnh concurrency CPU** | `GGUF_MAX_LOADED_MODELS=3` (RAM dư), giữ `GGUF_MAX_CONCURRENCY=1` (CPU: chạy 2 LLM song song sẽ chậm cả hai). Đặt `GGUF_INFER_TIMEOUT_MS` hợp lý cho CPU (vd 180000). |
| A0.5 | **Xóa file model hỏng** | Xóa `uploads/gguf-models/llava-v1.6-mistral-7b-q4_k_m.gguf` (73MB placeholder). |
| A0.6 | **Thống nhất thư mục model** | Cân nhắc `GGUF_MODELS_DIR=D:/SOURCES/16.AI` để 1 nguồn sự thật duy nhất (tránh trùng 6GB ở `uploads/gguf-models`). |

**✅ Done:** `.env` không còn key cloud/ollama; sidecar khởi động <60s và RAM KV <1GB; `tsc` xanh; vision + text + embed + DINOv2 đều chạy (đã verify hôm nay).

---

## PHASE A1 — Model Portfolio & Tiered Model Router *(3–5 ngày)*

**Mục tiêu:** Việc dễ chạy model nhỏ, việc khó chạy 7B — "đúng quy mô".

| # | Việc | Chi tiết |
|---|---|---|
| A1.1 | **Tải Fast-tier 3B** | `Qwen2.5-3B-Instruct-Q4_K_M.gguf` vào model dir. Thêm env `GGUF_FAST_MODEL`. |
| A1.2 | **Đăng ký DINOv2-base** | Chạy `register-dinov2.mjs` với `DINOV2_MODEL_PATH=D:/SOURCES/16.AI/DINOv2-base.onnx DINOV2_MODEL_CODE=dinov2-base DINOV2_EMBED_DIM=768` → biến thể anomaly "accurate". |
| A1.3 | **Đánh giá gemma-4-E2B & llava-1.6** | Benchmark tốc độ/chất lượng trên CPU. Quyết: giữ làm tier "accurate"/fallback hay loại bỏ để tiết kiệm đĩa. |
| A1.4 | **Xây `aiModelRouter` (tiered)** | Module mới `server/services/aiModelRouter.ts`: difficulty classifier + bảng policy (`config/aiRouterPolicy.ts`) + load-aware gate (đọc `getGgufQueueStats`). Wrap quanh `aiProviderRouter`. |
| A1.5 | **Đấu router vào call-site nóng** | `aiChatAssistant`, `intentClassifier`, `aiInsightsService`, `aiReportGenerator` gọi qua router thay vì hard-code model. |
| A1.6 | **Telemetry tier** | Ghi {tier, model, latency, tokens, fallbackUsed} vào metrics + bảng audit. |

**✅ Done:** Chat/intent dùng 3B (đo nhanh hơn ≥2×); RCA/report vẫn 7B; dashboard thấy phân bố tier; không regression chất lượng (eval harness).

---

## PHASE A1bis — GPU Bring-up *(chạy NGAY khi GPU RTX 5060 Ti/5090 về · 1–2 ngày)*

**Mục tiêu:** Chuyển từ CPU-first sang GPU-accelerated, mở khóa real-time.

| # | Việc | Chi tiết |
|---|---|---|
| A1b.1 | **Build llama.cpp CUDA** | Thay `llama-b8770-bin-win-cpu-x64` bằng build CUDA (hoặc tải bản `-bin-win-cuda-x64`). Cập nhật `LLAMA_SERVER_BIN`. |
| A1b.2 | **Rebuild node-llama-cpp CUDA** | `npx node-llama-cpp download --cuda` (hoặc tương đương) để engine in-process dùng GPU. |
| A1b.3 | **Bật GPU flag** | `GGUF_GPU=auto`, `LLAMA_VISION_GPU_LAYERS=999`, `ENABLE_CUDA=true`, `AI_INFER_EP=cuda` (ONNX). |
| A1b.4 | **Tăng concurrency** | `GGUF_MAX_CONCURRENCY=2–4` (5090), `GGUF_MAX_LOADED_MODELS=4–5`. Router (A5) chuyển sang chạy song song thật. |
| A1b.5 | **Vision real-time** | Bỏ hàng đợi batch cho vision; mô tả ảnh inline (<1s). Tăng `LLAMA_VISION_CTX` nếu cần ngữ cảnh dài. |
| A1b.6 | **Benchmark lại** | Đo latency text/vision/embed trước-sau; cập nhật bảng policy router theo tốc độ mới. |

**✅ Done:** 7B text + Qwen2.5-VL chạy GPU sub-giây; chạy song song ≥2 inference không nghẽn; vision inline real-time; KPI latency p95 giảm mạnh.

---

## PHASE A2 — RAG Production & Trí nhớ *(4–6 ngày)*

**Mục tiêu:** Bộ não "nhớ" tri thức nhà máy đúng nghĩa (đóng nợ 🔴 upgrade-before-Q3 trong masterplan).

| # | Việc | Chi tiết |
|---|---|---|
| A2.1 | **Bật KB pgvector** | `KB_PGVECTOR_ENABLED=true`; chạy ingest `kb_chunks` từ `knowledge/**` + SOP. Verify search HNSW (đã có `kbVectorStore.searchKbChunks`). |
| A2.2 | **Re-embed ảnh bằng DINOv2** | `node scripts/ai-kb/reembed-images-onnx.mjs` → image search/anomaly dùng vector ONNX thật thay text-of-image. |
| A2.3 | **Knowledge graph nhân-quả** | Mở rộng `semantic-graph.json` thành quan hệ máy↔lỗi↔nguyên nhân↔hành động; RCA truy vấn graph + vector (hybrid retrieval). |
| A2.4 | **Auto-ingest sự cố** | Mỗi `root_cause_analysis`/`ai_insights` mới → chunk + embed vào KB → vòng học tự làm giàu. |
| A2.5 | **Eval RAG** | Bộ câu hỏi vàng + đo recall@k, độ chính xác câu trả lời, latency (mở rộng `aiEvalHarness`). |

**✅ Done:** KB QA đạt KPI recall/accuracy mục tiêu; image search trả ảnh tương tự thật; RCA viện dẫn được SOP/sự cố quá khứ.

---

## PHASE A3 — Bật "Bộ não điều phối" (Autonomy) *(3–5 ngày · cẩn trọng, có HITL)*

**Mục tiêu:** AI chủ động giám sát & đề xuất xuyên module — nhưng **mọi hành động qua HITL**.

| # | Việc | Chi tiết |
|---|---|---|
| A3.1 | **Bật event bus + rules engine** | `ORCHESTRATION_ENABLED=true`, cấu hình `ORCH_NG_THRESHOLD`, `ORCH_NOTIFY_USER_IDS`. Verify NG-burst & SPC-critical phát `orchestration.triggered`. |
| A3.2 | **Bật AI watcher** | `AI_ORCHESTRATION_ENABLED=true`, `AI_WATCHER_MIN_INTERVAL_MS=60000`. Watcher → 7B sinh giả thuyết RCA + bước kế tiếp → ghi `ai_insights` (advisory-only). |
| A3.3 | **Bật agentic HITL** | `AI_AGENTIC_ENABLED=1` cho role manager/admin; verify luồng `startSession → approvePlan → advance → confirmStep`. Giữ `AGENT_MAX_WRITES_PER_SESSION=3`. |
| A3.4 | **Mở rộng tool registry** | Bổ sung read-tool (OEE, năng lượng, tồn kho) + write-tool (tạo work-order PdM, điều chỉnh ngưỡng) — tất cả qua propose/confirm. |
| A3.5 | **Playbook SOP** | Soạn `knowledge/workflows/*.playbook.yaml` (vd: "NG burst → kiểm tra → đề xuất rework") chạy deterministic qua `aiPlaybookEngine`. |

**✅ Done:** ≥3 workflow event-driven chạy E2E với HITL+audit; watcher sinh insight đúng ngữ cảnh, throttle hoạt động; không có đường nào bypass HITL (kiểm thử an toàn).

---

## PHASE A4 — Mở rộng Tri giác & Throughput *(4–6 ngày)*

**Mục tiêu:** Vision/anomaly chạy đúng quy mô sản xuất trên CPU.

| # | Việc | Chi tiết |
|---|---|---|
| A4.1 | **Bật anomaly detection** | `ANOMALY_DETECTION_ENABLED=true`; build memory bank PatchCore per product/machine (DINOv2 small→base theo độ khó); set threshold percentile. |
| A4.2 | **Hàng đợi vision** | Đưa mô tả ảnh qua `aiJobQueue` (async, concurrency=1) để không block; UI poll trạng thái. Tránh nghẽn khi nhiều ảnh. |
| A4.3 | **ROI crop trước VL** | Với ảnh lớn, crop ROI (đã có `autoDetectRoi`) rồi mới đưa vào VL → nhanh & chính xác hơn, giảm token. |
| A4.4 | **Active learning vòng kín** | `AI_SELF_LEARNING_ENABLED=true` (cron 03:00): quét uncertainty → enqueue label → (tùy chọn) auto-retrain Tier-1. |
| A4.5 | **Batch triage** | Dùng `batchTriage` + batch inference cho lô ảnh lớn ngoài giờ. |

**✅ Done:** Anomaly score chạy production; throughput vision đo được (ảnh/phút); vòng active-learning sinh dataset; CPU không quá tải (queue ổn định).

---

## PHASE A5 — MLOps khép vòng & Governance & Observability *(3–5 ngày)*

**Mục tiêu:** Hệ thống tự cải thiện + minh bạch + đo được.

| # | Việc | Chi tiết |
|---|---|---|
| A5.1 | **Closed-loop retrain** | feedback → dataset (`aiDatasetBuilder`) → train Tier-1 (hoặc Tier-2 sidecar nếu bật `LOCAL_TRAINER_CMD`) → eval → A/B canary → activate. |
| A5.2 | **Calibration & drift** | Bật calibration (ECE/temperature) + drift monitor; alert khi drift vượt ngưỡng. |
| A5.3 | **Governance** | Model card chuẩn per model; audit suy luận đầy đủ; báo cáo tuân thủ (EU AI Act) qua `aiReportGenerator`. |
| A5.4 | **Dashboard "AI Brain"** | Grafana: throughput/tier, p95 latency, fallback rate, queue depth, drift, RAM/model resident. |
| A5.5 | **Runbook vận hành** | Tài liệu: bật/tắt flag an toàn, ngân sách RAM, xử lý sự cố model, rollback. |

**✅ Done:** ≥1 chu kỳ retrain tự động hoàn tất + canary promote; Grafana live; mỗi model có card + audit; runbook bàn giao.

---

## B6. Phụ thuộc & Ưu tiên

```
A0 Config/Resource ──► A1 Model Router ──► A2 RAG ──┬─► A3 Autonomy (cần A1+A2)
   (quick win)                                       ├─► A4 Perception (cần A1)
                                                      └─► A5 MLOps (cần A1+A4)
```
- **Bắt buộc trước:** A0 (nền tài nguyên) → A1 (router). A0 nên làm ngay tuần này.
- **Song song được:** A4 (perception) // A3 (autonomy) sau khi A1 xong.
- A2 (RAG) tăng chất lượng A3 nên ưu tiên trước hoặc cùng A3.

## B7. KPI đo lường thành công

| Chỉ số | Hiện tại | Mục tiêu |
|---|---|---|
| Model GGUF được khai thác | 2/8 | ≥5/8 có vai trò rõ |
| Định tuyến theo độ khó | Không (1 model) | Tiered router 4 tầng |
| Tỉ lệ việc dễ chạy model nhỏ | 0% | ≥60% request ở Tier 0/1 |
| Latency chat p95 | ~7s (7B) | ≤3s (3B fast tier) |
| RAM KV vision lãng phí | 7 GB | <1 GB |
| Tính năng AI bật production | ~40% | ≥85% (flag on + verified) |
| RAG (KB pgvector) | Off (jsonl) | On + recall@5 ≥ mục tiêu |
| Vòng active-learning/retrain | Thủ công | Tự động (cron + canary) |
| Quan sát AI | Flag-off | Grafana "AI Brain" live |

## B8. Việc "làm ngay tuần này" (không cần phê duyệt lớn)

1. **A0.1–A0.6** — dọn `.env`, sửa nhãn GPU, giảm ctx sidecar, xóa file hỏng. *(rủi ro ~0)*
2. **A1.2** — đăng ký DINOv2-base (1 lệnh).
3. **A2.2** — re-embed ảnh bằng DINOv2 (bật image search vector thật).
4. **A2.1** — bật `KB_PGVECTOR_ENABLED` + ingest (bật RAG thật).

---

## B9. Câu hỏi cần anh/chị quyết (trước khi chạy phase lớn)

1. **Mục tiêu quy mô:** số ảnh/yêu cầu AI mỗi giờ ở giờ cao điểm? (định cỡ queue & concurrency)
2. **Có thể nâng GPU không?** 1 GPU 12–16GB VRAM (RTX 4060Ti 16GB / 4070) sẽ mở khóa vision GPU (sub-giây) + chạy 7B trên GPU. Nếu không, thiết kế CPU-first ở trên là tối ưu.
3. **Fast-tier 3B:** đồng ý tải `Qwen2.5-3B` để làm tầng nhanh? (hay giữ chỉ 7B)
4. **Bật autonomy (A3) tới mức nào?** chỉ advisory (watcher) hay cả agentic write có HITL?
5. **Bắt đầu từ phase nào?** Khuyến nghị **A0 ngay** + chọn 1–2 phase tiếp theo.

---

*(Tài liệu thiết kế & kế hoạch — chưa thực thi thay đổi mã nguồn ngoài các sửa cấu hình đã làm trước đó. Chờ phê duyệt/điều chỉnh để triển khai theo phase.)*
