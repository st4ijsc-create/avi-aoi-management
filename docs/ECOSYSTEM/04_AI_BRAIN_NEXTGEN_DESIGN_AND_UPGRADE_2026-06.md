# THIẾT KẾ "BỘ NÃO AI NHÀ MÁY" THẾ HỆ MỚI & KẾ HOẠCH NÂNG CẤP TOÀN DIỆN
### Local-First AI Brain v2 — tối ưu & hiện đại nhất trên hạ tầng RTX 5090 + Qwen3, phục vụ Kỹ thuật vận hành · Quản lý · Phân tích dữ liệu
**Ngày lập:** 2026-06-27 · **Phạm vi:** Tầng L6 Intelligence của nền tảng AVI/AOI · **Trạng thái:** ⏳ Đề xuất — chờ phê duyệt trước khi giao AI Agent thực thi

> Tài liệu này **kế thừa và thay thế phần lỗi thời** của [`03_AI_LOCAL_BRAIN_DESIGN_AND_UPGRADE_2026-06.md`](./03_AI_LOCAL_BRAIN_DESIGN_AND_UPGRADE_2026-06.md). Doc 03 thiết kế cho hạ tầng **CPU-first / GTX 750 Ti 2GB** — đã không còn đúng. Phần lớn **Phase A0 → A1bis của doc 03 ĐÃ HOÀN TẤT & verified** (xem §0). Doc 04 lấy baseline mới (RTX 5090 32GB + Qwen3) làm điểm xuất phát và vạch lộ trình **khai thác hết "bộ não" cho 3 sứ mệnh nhà máy thông minh**.
>
> Nguyên tắc: mọi đề xuất bám **code/flag/file thực tế** trong repo. Phần 0 = baseline đã có. Phần A = thiết kế đích. Phần B = kế hoạch nâng cấp theo phase.

---

# PHẦN 0 — BASELINE ĐÃ ĐẠT (điểm xuất phát thực, đã verify)

Khác với doc 03, đây là sự thật phần cứng & phần mềm **hôm nay 2026-06-27**:

| Hạng mục | Trạng thái đã verify | Bằng chứng |
|---|---|---|
| **GPU** | ✅ **RTX 5090 32GB** (Blackwell sm_120, driver 591.86, CUDA Toolkit 13.3 đã cài) | vision sidecar báo `CUDA0: RTX 5090` |
| **CPU / RAM** | i7-12700KF 12c/20t · 47.8GB RAM | đo |
| **Text engine GPU** | ✅ node-llama-cpp build CUDA cục bộ cho sm_120; `GGUF_GPU=auto`, `gpuLayers:"max"` | 30B=166 tok/s, 4B=178 tok/s |
| **Vision engine GPU** | ✅ llama.cpp b9814 CUDA sidecar, `LLAMA_VISION_GPU_LAYERS=999`, `--jinja` | 1.2s/ảnh (so 8.9s CPU, ~7×) |
| **Model Router** | ✅ `aiModelRouter.ts` — Cognitive Escalation Ladder Tier 0–4, đã đấu vào `aiChatAssistant` + `intentClassifier`; telemetry `aiGguf.routerStats` | 7/7 test, E2E verified |
| **Embed-at-ingest** | ✅ `aoiImageEmbeddingWorker.ts` — embed DINOv2 384-d ngay khi commit AOI package; `AOI_EMBEDDING_ENABLED=true` | E2E verified |
| **AI Brain dashboard** | ✅ `client/src/pages/AIBrainDashboard.tsx` `/ai-brain` — phân bố tier, VRAM, model resident, queue | live |

### Danh mục Model HIỆN HÀNH (đã nâng lên Qwen3, verify trên 5090)

| Vai trò | Model | Kích thước | Tốc độ | Env |
|---|---|---|---|---|
| 🧠 **Deep / Reasoning** | **Qwen3-30B-A3B-Instruct-2507** UD-Q4_K_XL (MoE, 3B active) | 17.7GB | 166 tok/s | `GGUF_DEFAULT_MODEL` |
| ⚡ **Fast** | **Qwen3-4B-Instruct-2507** UD-Q4_K_XL | 2.5GB | 178 tok/s | `GGUF_FAST_MODEL` |
| 👁️ **Vision** | **Qwen3-VL-8B-Instruct** + mmproj-F16 | 5.1+1.2GB | 1.2s/ảnh | `GGUF_VISION_MODEL` (sidecar) |
| 🔢 **Embedding** | **Qwen3-Embedding-0.6B** f16 (1024-d) | 1.2GB | — | `GGUF_EMBED_MODEL` |
| 📐 **Image vector** | DINOv2-small 384-d (id=3) + DINOv2-base 768-d (id=4) ONNX | 88/346MB | ~150ms | model registry |

> **VRAM budget hiện tại:** ~27.7/32GB khi 30B+4B+embed (in-process ~21.7GB) + VL-8B (sidecar ~6GB) cùng nóng. Còn ~4GB đệm. LRU eviction (`GGUF_MAX_LOADED_MODELS=4`) xử lý áp lực.

### 🔴 Khoảng trống thực sự còn lại (đây là nội dung doc 04)

Foundation đã rất mạnh. Nhưng **giá trị nhà máy chưa được khai thác** vì:

1. **"Bộ não điều phối" vẫn ngủ:** `ORCHESTRATION_ENABLED`, `AI_ORCHESTRATION_ENABLED`, `AI_AGENTIC_ENABLED` = **off**. AI hiện chỉ phản hồi khi người hỏi — **chưa chủ động giám sát & cảnh báo**.
2. **RAG chưa lên production:** `KB_PGVECTOR_ENABLED=off` (đang bruteforce file jsonl 1196 chunk). Chưa có **knowledge graph nhân-quả** cho RCA. Chưa có **reranker**.
3. **Tri giác chưa real-time/anomaly:** `ANOMALY_DETECTION_ENABLED=off`. Vision 1.2s/ảnh đủ inline nhưng chưa nối vào dây chuyền; PatchCore memory-bank chưa build.
4. **Thiếu lớp "Phân tích & Quản lý":** chưa có **NL-to-analytics** (hỏi dữ liệu bằng tiếng Việt/Anh), **dự báo** (PdM, yield, OEE), **báo cáo điều hành tự động** — đây chính là 2/3 sứ mệnh anh/chị nêu.
5. **MLOps chưa khép vòng:** `AI_SELF_LEARNING_ENABLED=off`; chưa drift/calibration/canary tự động.
6. **Quan sát:** `METRICS_ENABLED=true` nhưng **chưa có Grafana "AI Brain"**.

---

# PHẦN A — THIẾT KẾ HỆ THỐNG ĐÍCH (TARGET)

## A1. Triết lý: một "Bộ não" — ba sứ mệnh

Anh/chị cần hệ thống phục vụ **3 đối tượng công việc**. Thiết kế gắn mỗi sứ mệnh với năng lực AI cụ thể:

```
┌──────────────────────────────────────────────────────────────────────┐
│                       BỘ NÃO AI NHÀ MÁY (Local)                        │
│        RTX 5090 32GB · Qwen3 portfolio · Model Router 4 tầng           │
└──────────────────────────────────────────────────────────────────────┘
        │                        │                          │
        ▼                        ▼                          ▼
┌───────────────┐      ┌───────────────────┐     ┌────────────────────┐
│ ① KỸ THUẬT     │     │ ② QUẢN LÝ          │    │ ③ PHÂN TÍCH DỮ LIỆU │
│   VẬN HÀNH     │      │   (Management)     │     │   (Data Analysis)   │
├───────────────┤      ├───────────────────┤     ├────────────────────┤
│ • Vision/AOI   │     │ • NL→analytics    │     │ • Forecasting (PdM, │
│   real-time    │      │   ("hỏi KPI")     │     │   yield, OEE)       │
│ • RCA + SOP    │      │ • Báo cáo điều     │    │ • Anomaly/SPC AI    │
│   copilot      │      │   hành tự động     │    │ • Pattern mining    │
│ • PdM cảnh báo │      │ • Cảnh báo chủ     │    │ • Cohort/Pareto     │
│ • Agentic HITL │      │   động (watcher)   │    │   defect analytics  │
└───────────────┘      └───────────────────┘     └────────────────────┘
        ▲ tất cả chia sẻ: Model Router · RAG/GraphRAG · Event Bus · HITL/Audit
```

## A2. Ngân sách VRAM 32GB & chiến lược phục vụ song song

5090 32GB thay đổi căn bản so với CPU-first: **chạy song song thật**, không còn hàng đợi tuần tự. Đề xuất phân bổ:

| Lớp thường trú (hot) | VRAM | Ghi chú |
|---|---|---|
| Qwen3-30B-A3B (deep, MoE chỉ 3B active) | ~18GB | reasoning/RCA/report |
| Qwen3-4B (fast) | ~2.5GB | intent/extract/chat ngắn |
| Qwen3-Embedding-0.6B | ~1.2GB | RAG/KB |
| Qwen3-VL-8B (sidecar) | ~6GB | vision inline |
| **Tổng hot** | **~27.7GB** | còn ~4GB đệm KV + ONNX |
| DINOv2 ONNX (CPU/GPU) | <1GB | anomaly, image vector |

**Hệ quả thiết kế:**
- `GGUF_MAX_CONCURRENCY=4` đã đủ chạy fast + deep + embed song song; vision riêng process.
- **Không nạp model thứ 5 hot** trừ khi giảm 30B → nhường chỗ. Mọi đề xuất thêm model (A3) phải có chiến lược nạp/đuổi (LRU) hoặc thay thế.
- **Đệm 4GB là mỏng** → cần `B0` siết KV-cache & đặt ngưỡng cảnh báo VRAM.

## A3. Hiện đại hoá Model Portfolio (đề xuất bổ sung có chọn lọc)

Portfolio Qwen3 đã rất hiện đại. Bổ sung **chỉ những gì tạo giá trị rõ**, tránh phình VRAM:

| Đề xuất | Mục đích | Chi phí | Khuyến nghị |
|---|---|---|---|
| **Reranker** (Qwen3-Reranker-0.6B hoặc bge-reranker-v2-m3) | Tăng precision RAG: embed lấy top-50 → rerank còn top-5 chính xác | ~1GB, nạp theo nhu cầu | ✅ **Nên** (B2) — đòn bẩy chất lượng RAG lớn nhất |
| **Reasoning/thinking tier** (Qwen3-30B-A3B-**Thinking**-2507) | RCA/lập kế hoạch khó cần chuỗi suy luận dài | thay 1 dòng env hoặc nạp thứ 2 | ⚖️ **Đánh giá** (B6) — dùng cho Tier 2+ "hard" qua router, có thể swap |
| **Context dài** (Qwen3 hỗ trợ tới 256K) | Báo cáo dài, đọc nhiều SOP/log cùng lúc | tốn KV-cache VRAM | ⚖️ Bật ctx lớn **theo task** trong router, không mặc định |
| **Time-series/Forecast model** (cổ điển: Holt-Winters/Prophet-like + ONNX) | Dự báo PdM/yield/OEE — Tier 0, không cần LLM | nhẹ, CPU | ✅ **Nên** (B4) |
| Bỏ bớt model cũ Qwen2.5/llava/gemma trên đĩa | Giải phóng đĩa (giữ 1 fallback) | — | 🧹 dọn sau khi Qwen3 ổn định |

> **Lưu ý tương thích (từ A1bis):** in-process text pin ở llama.cpp **b8390** (chạy tốt Qwen3 + qwen3moe). Các kiến trúc hybrid **Qwen3.5/Next 2026** cần build llama.cpp mới hơn → đưa vào B6 như nâng cấp tuỳ chọn, không chặn các phase khác.

## A4. ⭐ Thang Leo Nhận Thức v2 (GPU-parallel)

Giữ khái niệm 5 tầng của doc 03 nhưng **cập nhật cho GPU song song** (không còn "hàng đợi CPU"):

```
TIER 4 — CON NGƯỜI / FEDERATION   HITL phê duyệt · multi-site (tùy chọn)
         Khi: hành động ghi · confidence thấp · ngoài năng lực local
TIER 3 — TRI GIÁC                  Qwen3-VL-8B (1.2s, inline real-time) · DINOv2 · PatchCore anomaly
         Việc: mô tả lỗi · visual QA · OCR · anomaly · similar-image
TIER 2 — SUY LUẬN SÂU              Qwen3-30B-A3B + GraphRAG + reranker + planner (HITL)
         Việc: RCA · báo cáo điều hành · agentic plan · KB QA khó · NL-analytics phức tạp
TIER 1 — NHẬN THỨC NHANH           Qwen3-4B + GBNF JSON + tool-calling
         Việc: intent · trích xuất · tóm tắt · chọn tool · chat · NL→SQL đơn giản
TIER 0 — PHẢN XẠ                    Rule/SQL/heuristic + Forecast (Holt-Winters/EWMA) — KHÔNG LLM
         Việc: SPC · ngưỡng NG · time-series anomaly · dự báo · tool DB-only
         ▲ Định tuyến bởi MODEL ROUTER (đã có) — nay chạy SONG SONG trên 5090
```

**Khác biệt then chốt so với doc 03:** vì 5090 đủ VRAM, **Tier 1/2/3 chạy đồng thời** — ví dụ một request quản lý có thể: Tier 1 phân loại intent (4B) → Tier 2 sinh báo cáo (30B) **trong khi** Tier 3 vision đang xử lý ảnh AOI khác — không tranh chấp.

## A5. Kiến trúc tham chiếu "Bộ não" 6 lớp (cập nhật)

```
┌─────────────────────────────────────────────────────────────────────┐
│ GOVERNANCE & OBSERVABILITY  model card · audit suy luận · drift · Grafana │ ← xuyên suốt
├─────────────────────────────────────────────────────────────────────┤
│ (5) ACTION & AUTONOMY   agentic planner · HITL propose/confirm ·       │
│                         rulesEngine · aiWatcher (event-driven)  ← BẬT  │
├─────────────────────────────────────────────────────────────────────┤
│ (4) REASONING & ANALYTICS  Model Router(✅) → Tier 1/2 · GBNF JSON ·    │
│                         tools · NL→analytics · forecasting   ← MỞ RỘNG │
├─────────────────────────────────────────────────────────────────────┤
│ (3) RETRIEVAL / MEMORY  GraphRAG (pgvector + KG nhân-quả) ·            │
│                         reranker · image embeddings · feedback ← NÂNG  │
├─────────────────────────────────────────────────────────────────────┤
│ (2) PERCEPTION          Qwen3-VL-8B(✅GPU) · DINOv2 · PatchCore  ← BẬT │
├─────────────────────────────────────────────────────────────────────┤
│ (1) FOUNDATION          aiGgufEngine(✅GPU) · router(✅) · job queue ·  │
│                         model registry · GGUF/ONNX/CUDA runtime   ✅   │
└─────────────────────────────────────────────────────────────────────┘
         ▲ tất cả ăn dữ liệu từ EVENT BUS (_core/eventBus.ts)
```

**Lớp (1) Foundation và Router lớp (4) đã XONG.** Doc 04 tập trung: **bật lớp (5) + lớp (2), nâng lớp (3), mở rộng lớp (4) sang Analytics, hoàn thiện Governance.**

## A6. Thiết kế 3 "Sản phẩm giá trị" (đáp ứng trực tiếp yêu cầu của anh/chị)

### ① Operation Engineering Copilot (Kỹ thuật vận hành)
- **Vision/AOI real-time:** ảnh AOI commit → embed-at-ingest (✅ có) → anomaly score (PatchCore) → nếu nghi ngờ, Qwen3-VL mô tả lỗi inline (1.2s) → gợi ý phân loại.
- **RCA + SOP copilot:** kỹ sư hỏi "lỗi X máy Y do đâu?" → GraphRAG (vector + knowledge graph nhân-quả) viện dẫn SOP/sự cố quá khứ → 30B tổng hợp giả thuyết + bước xử lý.
- **PdM cảnh báo:** Tier 0 forecast (rung/nhiệt/dòng) vượt ngưỡng → watcher tạo `ai_insight` → đề xuất work-order (HITL).
- **Agentic HITL:** với role kỹ thuật, AI **đề xuất** điều chỉnh ngưỡng/tạo lệnh — luôn qua `proposeAction → confirmAction`.

### ② Management Copilot (Quản lý)
- **NL→analytics:** quản lý gõ "OEE dây chuyền 2 tuần này so tuần trước?" → Tier 1 NL→SQL/tool → Tier 0 truy vấn → Tier 2 diễn giải + biểu đồ.
- **Báo cáo điều hành tự động:** cron sinh executive summary (ca/ngày/tuần) bằng 30B từ KPI thật (`aiReportGenerator`), kèm cảnh báo & khuyến nghị.
- **Cảnh báo chủ động:** watcher phát hiện bất thường KPI → thông báo (kèm giải thích `aiExplainability`).

### ③ Data Analysis Brain (Phân tích dữ liệu)
- **Forecasting:** PdM, dự báo yield/throughput, OEE trend — Tier 0 (cổ điển) + LLM diễn giải.
- **Defect analytics:** Pareto lỗi, cohort theo máy/ca/lô/sản phẩm, tương quan thông số ↔ NG.
- **Anomaly mining:** quét time-series + image vector tìm cụm bất thường, surface cho người.
- **Pattern → tri thức:** mỗi phát hiện → auto-ingest vào KB → vòng học tự làm giàu.

---

# PHẦN B — KẾ HOẠCH NÂNG CẤP THEO PHASE

> Triết lý: **siết & đo nền (B0) → bật bộ não (B1) → nâng trí nhớ (B2) → tri giác production (B3) → lớp giá trị Quản lý/Phân tích (B4) → khép vòng MLOps & Governance (B5) → hiện đại hoá model (B6).** Mỗi phase: mục tiêu · việc (file/flag) · Done · rủi ro. Tất cả **additive + flag-gated**, an toàn HITL **không nới lỏng**.

## PHASE B0 — Siết VRAM, Observability & Health *(1–2 ngày · rủi ro thấp · QUICK WIN)*
**Mục tiêu:** Chạy ổn định ở mép 32GB, nhìn thấy mọi thứ.

| # | Việc | Chi tiết |
|---|---|---|
| B0.1 | **Ngưỡng VRAM & cảnh báo** | Đệm chỉ ~4GB → thêm guard: nếu VRAM>90% giảm `GGUF_MAX_LOADED_MODELS` động hoặc trì hoãn nạp model thứ 4. Log vào health. |
| B0.2 | **Siết KV-cache theo task** | Router đặt `n_ctx` theo độ dài thực (không mặc định ctx khổng lồ). Vision giữ `LLAMA_VISION_CTX` hợp lý. |
| B0.3 | **Grafana "AI Brain"** | `METRICS_ENABLED=true` đã có → export tier/model/latency/queue/VRAM ra Prometheus + dashboard Grafana. Nối với `AIBrainDashboard.tsx`. |
| B0.4 | **Bench lại & cập nhật policy** | Đo p50/p95 latency 4B/30B/VL/embed → cập nhật bảng policy router theo số thật. |
| B0.5 | **Dọn model cũ trên đĩa** | Giữ 1 fallback, gỡ Qwen2.5/llava/gemma thừa để giải phóng đĩa. |

**✅ Done:** Không OOM khi 4 model nóng; Grafana live; policy router theo số đo thật.

## PHASE B1 — BẬT "Bộ não điều phối" (Autonomy có HITL) *(3–5 ngày · cẩn trọng)*
**Mục tiêu:** AI **chủ động** giám sát & đề xuất xuyên module — mọi hành động ghi qua HITL.

| # | Việc | Flag/File |
|---|---|---|
| B1.1 | Bật event bus + rules engine | `ORCHESTRATION_ENABLED=true`; cấu hình `ORCH_NG_THRESHOLD`, `ORCH_NOTIFY_USER_IDS`; verify NG-burst/SPC-critical phát `orchestration.triggered` |
| B1.2 | Bật AI watcher | `AI_ORCHESTRATION_ENABLED=true`, `AI_WATCHER_MIN_INTERVAL_MS=60000` → `aiWatcher.ts` sinh giả thuyết RCA + next-step → `ai_insights` (advisory-only) |
| B1.3 | Bật agentic HITL (role manager/admin) | `AI_AGENTIC_ENABLED=1`; verify `startSession→approvePlan→advance→confirmStep`; giữ `AGENT_MAX_WRITES_PER_SESSION=3` |
| B1.4 | Mở rộng tool registry | Thêm read-tool (OEE/năng lượng/tồn kho) + write-tool (work-order PdM, chỉnh ngưỡng) — tất cả propose/confirm |
| B1.5 | Playbook SOP | `knowledge/workflows/*.playbook.yaml` chạy deterministic qua `aiPlaybookEngine` (vd "NG burst → kiểm tra → đề xuất rework") |

**✅ Done:** ≥3 workflow event-driven E2E có HITL+audit; watcher throttle đúng; **không đường nào bypass HITL** (kiểm thử an toàn).
**Rủi ro:** spam insight → đặt throttle/dedup; sai ngữ cảnh → giữ advisory-only ở giai đoạn này.

## PHASE B2 — GraphRAG Production (Trí nhớ + RCA nhân-quả) *(4–6 ngày)*
**Mục tiêu:** Bộ não "nhớ" tri thức nhà máy chính xác & có nhân-quả.

| # | Việc | Chi tiết |
|---|---|---|
| B2.1 | **Quyết pgvector** | Local PG 5433 **không cài được** pgvector. 2 lựa chọn: (a) giữ **bruteforce file jsonl** (đang chạy tốt 1196 chunk) cho tới khi scale; (b) chuyển KB sang **Docker PG 5432 (pgvector pg16)**. → Quyết theo quy mô KB (xem câu hỏi §B9). |
| B2.2 | **Reranker** | Thêm Qwen3-Reranker-0.6B / bge-reranker: embed top-50 → rerank top-5. Đòn bẩy precision lớn nhất cho RAG. |
| B2.3 | **Knowledge graph nhân-quả** | Mở rộng `knowledge/semantic-graph.json` thành máy↔lỗi↔nguyên nhân↔hành động; RCA = hybrid (vector + graph). |
| B2.4 | **Auto-ingest sự cố** | Mỗi `root_cause_analysis`/`ai_insight` mới → chunk + embed (Qwen3-Embedding) vào KB → vòng tự làm giàu. |
| B2.5 | **Eval RAG** | Bộ câu hỏi vàng + recall@k + accuracy + latency (mở rộng `aiEvalHarness`). |

**✅ Done:** KB QA đạt KPI recall/accuracy; RCA viện dẫn được SOP/sự cố quá khứ + chuỗi nhân-quả; reranker giảm hallucination.

## PHASE B3 — Tri giác Real-time & Anomaly *(4–6 ngày)*
**Mục tiêu:** Vision/anomaly chạy đúng nhịp sản xuất (GPU đã đủ nhanh).

| # | Việc | Chi tiết |
|---|---|---|
| B3.1 | **Bật anomaly** | `ANOMALY_DETECTION_ENABLED=true`; build PatchCore memory-bank per product/machine (DINOv2 small→base theo độ khó); threshold percentile. |
| B3.2 | **Vision inline** | Vì 1.2s/ảnh GPU → bỏ batch-only, mô tả lỗi inline cho ảnh nghi ngờ; UI hiển thị ngay. |
| B3.3 | **ROI crop trước VL** | Ảnh lớn → `autoDetectRoi` crop ROI → đưa VL → nhanh & chính xác hơn, ít token. |
| B3.4 | **Image search vector thật** | Đảm bảo embed-at-ingest (✅) phủ commit mới; tuỳ chọn backfill khi có ZIP. |
| B3.5 | **Batch triage ngoài giờ** | `batchTriage` cho lô lớn ban đêm. |

**✅ Done:** Anomaly score production; throughput vision đo được (ảnh/phút); image search trả ảnh tương tự thật.

## PHASE B4 — Lớp Quản lý & Phân tích Dữ liệu *(5–7 ngày · giá trị cao nhất cho yêu cầu của anh/chị)*
**Mục tiêu:** Biến dữ liệu MES/Quality thành insight bằng ngôn ngữ tự nhiên + dự báo.

| # | Việc | Chi tiết |
|---|---|---|
| B4.1 | **NL→analytics (Text-to-SQL an toàn)** | Tool whitelisted: Tier 1 (4B) sinh truy vấn có ràng buộc schema → chạy read-only → Tier 2 diễn giải. RBAC theo role. **Không** cho LLM chạy SQL tự do — qua tool tham số hoá. |
| B4.2 | **Forecasting tier** | Module Tier 0: Holt-Winters/EWMA (đã có `aiTimeSeriesEngine`) + dự báo yield/OEE/PdM; LLM chỉ diễn giải kết quả. |
| B4.3 | **Báo cáo điều hành tự động** | Cron ca/ngày/tuần → `aiReportGenerator` (30B) tổng hợp KPI + cảnh báo + khuyến nghị; xuất PDF/dashboard. |
| B4.4 | **Defect analytics** | Pareto/cohort/correlation lỗi theo máy/ca/lô; surface "top driver" của NG. |
| B4.5 | **Management dashboard AI** | Trang UI "Insight" cho quản lý: hỏi đáp + báo cáo + cảnh báo, đa ngôn ngữ (vi/en/zh đã có i18n). |

**✅ Done:** Quản lý hỏi KPI bằng tiếng Việt nhận trả lời đúng + nguồn; báo cáo điều hành tự sinh; dự báo PdM/yield chạy có đo độ chính xác.

## PHASE B5 — MLOps khép vòng & Governance & Observability *(3–5 ngày)*
**Mục tiêu:** Tự cải thiện + minh bạch + tuân thủ.

| # | Việc | Chi tiết |
|---|---|---|
| B5.1 | **Active-learning vòng kín** | `AI_SELF_LEARNING_ENABLED=true` (cron 03:00): quét uncertainty → enqueue label → (tuỳ chọn) auto-retrain Tier-1 ONNX. |
| B5.2 | **Closed-loop retrain** | feedback → `aiDatasetBuilder` → train → eval → A/B canary → activate. |
| B5.3 | **Calibration & drift** | ECE/temperature + drift monitor; alert khi vượt ngưỡng. |
| B5.4 | **Governance** | Model card chuẩn per model (`ai_models.metadata`); audit đầy đủ mọi suy luận; báo cáo tuân thủ (EU AI Act) qua `aiExplainability`/`aiReportGenerator`. |
| B5.5 | **Runbook vận hành** | Bật/tắt flag an toàn, ngân sách VRAM, xử lý sự cố model, rollback. |

**✅ Done:** ≥1 chu kỳ retrain tự động + canary promote; mỗi model có card + audit; runbook bàn giao.

## PHASE B6 — Hiện đại hoá Model & Hạ tầng inference *(tuỳ chọn · 3–5 ngày)*
**Mục tiêu:** Bám công nghệ mới nhất khi có lợi ích rõ.

| # | Việc | Chi tiết |
|---|---|---|
| B6.1 | **Nâng llama.cpp in-process** | Hiện pin b8390. Khi cần Qwen3.5/Next/hybrid 2026 → build llama.cpp mới hơn cho sm_120 (giống cách vision sidecar đã làm b9814). |
| B6.2 | **Reasoning tier** | Đánh giá Qwen3-30B-A3B-**Thinking** cho Tier 2 "hard"; router swap theo độ khó. |
| B6.3 | **Context dài theo task** | Bật ctx tới 128–256K cho báo cáo dài/đọc nhiều SOP — chỉ khi task cần (KV-cache tốn VRAM). |
| B6.4 | **Vision nâng cấp** | Theo dõi Qwen3-VL bản lớn hơn / model OCR chuyên dụng nếu OCR là nút thắt. |
| B6.5 | **Speculative decoding / batching** | 4B làm draft cho 30B (nếu llama.cpp hỗ trợ) → tăng tok/s; batch inference cho throughput. |

**✅ Done:** Nâng cấp có A/B chứng minh cải thiện; không phá vỡ tương thích các phase đang chạy.

---

## B7. Phụ thuộc & Ưu tiên

```
B0 Siết nền/Observability ──► B1 Autonomy ──┬─► B2 GraphRAG ──► B4 Quản lý/Phân tích
   (quick win)                              ├─► B3 Tri giác (song song B2)
                                            └─► B5 MLOps (cần B2/B3) ──► B6 (tuỳ chọn)
```
- **Làm ngay:** B0 (rủi ro ~0, mở khoá quan sát). 
- **Giá trị cao nhất cho yêu cầu của anh/chị:** B4 (Quản lý + Phân tích) — nhưng cần B1 (watcher) + B2 (RAG) làm nền.
- **Song song được:** B2 (RAG) // B3 (tri giác) sau khi B1 xong.

## B8. KPI đo lường thành công

| Chỉ số | Hiện tại | Mục tiêu |
|---|---|---|
| Năng lực AI bật production | ~Foundation (router/GPU) | ≥85% (autonomy+RAG+analytics on) |
| AI chủ động (watcher/insight) | Off | On, throttle, audit |
| RAG | bruteforce jsonl | GraphRAG + reranker, recall@5 đạt mục tiêu |
| Anomaly vision | Off | On, score production, đo ảnh/phút |
| NL→analytics cho quản lý | Không | Có, hỏi KPI tiếng Việt → trả lời + nguồn |
| Dự báo (PdM/yield/OEE) | Không | Có, đo độ chính xác |
| Báo cáo điều hành | Thủ công | Tự sinh (cron) |
| Active-learning/retrain | Thủ công | Tự động (cron + canary) |
| Quan sát AI | Dashboard app | + Grafana "AI Brain" live |

## B8bis. ✅ QUYẾT ĐỊNH ĐÃ CHỐT (2026-06-27) — đầu vào cho AI Agent

| # | Quyết định | Hệ quả vào kế hoạch |
|---|---|---|
| 1 | **Ưu tiên: cân bằng cả 3 sứ mệnh** | Sau B0+B1 → chạy **B2 (RAG) // B3 (vision) song song** → rồi **B4 (Quản lý/Phân tích)**. Phủ đều, chấp nhận timeline dài hơn. |
| 2 | **Tự chủ: AGENTIC-WRITE có HITL NGAY** | B1.3 vào phạm vi ngay: `AI_AGENTIC_ENABLED=1` cho role admin/manager; mọi write qua `proposeAction→confirmAction`, giữ `AGENT_MAX_WRITES_PER_SESSION=3`. **Bắt buộc bộ kiểm thử an toàn "không bypass HITL" trước khi bật.** |
| 3 | **KB/RAG: GIỮ bruteforce file jsonl** | B2.1 chốt: **không** chuyển Docker pgvector lúc này; `KB_PGVECTOR_ENABLED` vẫn off. RAG tối ưu trên file (1196 chunk) + **reranker** bù precision. Pgvector hoãn tới khi KB lớn. |
| 4 | **Bổ sung model: Reranker + Thinking tier** | B2.2 tải **reranker** (Qwen3-Reranker-0.6B/bge) — nạp theo nhu cầu. B6.2 đánh giá **Qwen3-30B-A3B-Thinking** cho Tier 2 "hard", swap qua router. Lưu ý VRAM mỏng (~4GB đệm) → nạp/đuổi LRU, không giữ hot đồng thời với 30B-Instruct. |
| 5 | **NL→SQL: ĐỒNG Ý tool tham số hoá read-only + RBAC** | B4.1 chốt: LLM **không** chạy SQL tự do; chỉ gọi tool whitelisted có ràng buộc schema + RBAC theo role. |
| 6 | **Tải: 20.000 ảnh / ca 8 tiếng** | = **2.500 ảnh/h ≈ 41,7 ảnh/phút ≈ 0,69 ảnh/giây** (trung bình ca). Định cỡ ở §B8ter. |
| 7 | **Agentic-write: role KỸ THUẬT** | Bắt đầu với role phục vụ kỹ thuật: **cài đặt · điều chỉnh · cấu hình · thêm mới** (ngưỡng NG/AOI, tham số kiểm tra, cấu hình máy/sản phẩm, tạo bản ghi cấu hình). Mọi write vẫn qua HITL propose→confirm. |

> **Lộ trình thực thi đã chốt:** `B0 → B1(gồm agentic-write+HITL) → [B2//B3] → B4 → B5 → B6(thinking)`. Reranker (B2.2) làm sớm trong B2.

## B8ter. 📐 ĐỊNH CỠ THROUGHPUT — 20.000 ảnh/ca 8 tiếng

**Tải mục tiêu:** 2.500 ảnh/h ≈ **41,7 ảnh/phút ≈ 0,69 ảnh/giây** (trung bình). Giả định cao điểm gấp đôi → ~1,4 ảnh/giây.

| Khâu | Chi phí/ảnh | Tải ở 41,7 ảnh/phút | Đánh giá |
|---|---|---|---|
| **Embed-at-ingest** (DINOv2-small ONNX) | ~150ms | ~6,3s xử lý mỗi 60s → **~10% công suất 1 worker** | ✅ Thoải mái. Hàng đợi in-memory (`aoiImageEmbeddingWorker`) hấp thụ burst. |
| **Anomaly score** (DINOv2 + PatchCore) | ~150–250ms | tương tự, Tier 0 nhanh | ✅ Chạy mọi ảnh được. |
| **Vision VL** (Qwen3-VL 1.2s/ảnh) | 1,2s | NẾU chạy 100% ảnh = 50s/60s → **gần nghẽn 1 luồng** | ⚠️ **KHÔNG đưa mọi ảnh vào VL.** |

**🔑 Kết luận định cỡ (đưa vào thiết kế):**
1. **Cổng chặn VL bằng Tier 0 anomaly:** chỉ ảnh **NG/nghi ngờ** (thường 2–10%) mới leo lên Qwen3-VL. Ở 5% → ~2 ảnh/phút → ~2,5s/phút → **trivial**. Đây chính là giá trị Thang Leo Nhận Thức: tầng rẻ lọc, tầng đắt chỉ xử lý phần khó.
2. **Embed/anomaly chạy 100% ảnh** vẫn rất nhẹ (~10–20% công suất) → tăng concurrency worker embed lên 2–3 để chịu burst cao điểm.
3. **Hàng đợi + back-pressure:** giữ `aiJobQueue`/in-memory queue cho cả embed lẫn VL; nếu burst > công suất → xếp hàng, không chặn commit AOI (đã là fire-and-forget).
4. **Concurrency 5090:** `GGUF_MAX_CONCURRENCY=4` hiện tại **đủ** cho tải này (VL gated + text/embed song song). Đo p95 thật ở **B0.4** rồi chốt; nếu cao điểm dồn → cân nhắc batch VL.
5. **Cảnh báo công suất:** thêm KPI "ảnh/phút thực vs công suất" + alert khi queue depth tăng bền (B0.3 Grafana).

> **Hệ quả:** tải 20k/ca **nằm trong năng lực 5090** với điều kiện **VL bị gate bởi anomaly Tier 0**. Nếu sau này tỉ lệ NG cao bất thường (vd >20%) hoặc cần VL mọi ảnh → mới tính tới batch VL / model VL nhỏ hơn cho triage (B6.4).

## B9. Câu hỏi CÒN LẠI cần anh/chị quyết

> Tất cả câu hỏi mở đã được trả lời (§B8bis + §B8ter). Còn 1 điểm cần làm rõ khi triển khai B1:
- **Danh sách write-tool kỹ thuật cụ thể** (chốt ở đầu B1.4): liệt kê chính xác từng hành động cài đặt/điều chỉnh/cấu hình/thêm-mới được phép, kèm ràng buộc giá trị (min/max ngưỡng) để HITL kiểm soát an toàn.

---

*(Tài liệu thiết kế & kế hoạch — CHƯA thực thi thay đổi mã nguồn. Chờ anh/chị review/điều chỉnh để giao các AI Agent chuyên môn triển khai theo từng phase.)*
