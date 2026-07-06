# Doc 34 — Trợ lý AI Local cho Lập trình Tự động hóa
## Thiết kế chi tiết & Kế hoạch nâng cấp toàn bộ AI Local (đối chiếu báo cáo `AI-LOCAL-SDD-001`)

| | |
|---|---|
| **Mã tài liệu** | ECOSYSTEM-34 |
| **Ngày** | 2026-07-05 |
| **Trạng thái** | 🟢 **P0–P4 XONG & VALIDATED** 2026-07-05 (5 commit: a75bc8f/ff0a97f/febb9ec/c6d38c4/+P4). RAG precision 0.97, codegen validPass 60% (text ~85%, JSON-struct 0%→cần GBNF/Coder), safety 4/4, engineer role live. Chờ bạn: Qwen3-Coder vs GBNF, 2FA. Xem §Nhật ký thực thi. |
| **Nguồn đối chiếu** | `D:\SOURCES\AI Local\AI_Local_Lap_trinh_Tu_dong_hoa.docx` (bản `AI-LOCAL-SDD-001 v1.0`, 04/07/2026) |
| **Phương pháp** | 6 agent khảo sát song song mã nguồn hiện tại (engine, RAG, code-authoring, agent/tools, UX/IDE, MLOps) + đối chiếu từng lớp với báo cáo |
| **Kế thừa** | doc 03 (AI brain design), doc 04 (AI nextgen), doc 06 (Technician Copilot), doc 09 (Device Programming), doc 16 (Automation Orchestration), doc 24 (Advanced Capabilities), doc 25 (Machine Control Tier) |
| **Nguyên tắc an toàn (bất biến)** | AI **trợ giúp** — kỹ sư **quyết định & kiểm thử**. Mọi mã PLC/robot/Zmotion do AI sinh PHẢI qua validate → sim → HIL → duyệt người (HITL) trước khi chạy trên thiết bị thật. AI **từ chối** sinh mã chức năng an toàn (E-stop/interlock/SIL). Không tự động nạp mã xuống thiết bị vận hành. |

---

## 0. TL;DR — Kết luận chiến lược

> **Báo cáo `AI-LOCAL-SDD-001` mô tả một "Trợ lý lập trình AI local" (viết mã PLC/robot/Zmotion, đọc sơ đồ, tích hợp IDE). Đối chiếu với hệ thống hiện tại cho thấy chúng ta KHÔNG bắt đầu từ số 0 — mà đã có sẵn ~40–50% nền tảng, cộng thêm MỘT tài sản mà báo cáo không hề biết là có: một hạ tầng lập trình thiết bị an toàn (validate → transpile → mô phỏng động học → HIL URSim → duyệt-2-mắt) đã chạy thật.**

Ba sự thật cốt lõi từ khảo sát:

1. **"Giai đoạn 0" của báo cáo (CUDA · engine · model Qwen3 · RTX 5090) — ĐÃ XONG.** Máy chủ đã chạy đúng bộ model báo cáo giả định (Qwen3-30B-A3B, 4B, VL-8B, Embedding-0.6B), đã tăng tốc GPU Blackwell. Đây không phải việc phải làm; nó là điểm xuất phát.

2. **Nhưng AI hiện tại là "bộ não VẬN HÀNH nhà máy" — KHÔNG phải "trợ lý LẬP TRÌNH".** Toàn bộ 25+ surface AI, 65 tool, KB 2.186 chunk, eval-harness... đều hướng về chất lượng/OEE/RCA/vision-khuyết-tật. **Không có một dòng LLM nào sinh mã tự động hóa; không có tri thức lập trình trong RAG; không có tích hợp IDE; không có API tương thích OpenAI.** Đây chính là khoảng trống báo cáo nhắm tới.

3. **Điểm khác biệt lớn nhất so với "cài Continue + llama-server" thuần túy:** chúng ta đã có `programmingAdapter` (8 loại chương trình: ST/LD/POU/IR/Zmotion-Basic/MELSEC/Techman/URScript+ROS2) với **safety-linter (ISO/TS 15066) → sim-gate động học → Rapier physics → HIL URSim thật → deploy gated HITL**. Nếu để AI sinh mã **chảy vào** hạ tầng này (thay vì xuất text thô), mọi output tự động thừa hưởng chuỗi an toàn đó — điều một bản Continue tiêu chuẩn không có.

**Khuyến nghị chiến lược = "HYBRID hội tụ", KHÔNG dựng stack song song:**
- Thêm **một keystone còn thiếu — cổng API tương thích OpenAI** — để mở khóa *cả* copilot trong app *lẫn* IDE ngoài (VS Code + Continue) chỉ với một lớp phục vụ.
- **Tái sử dụng** engine/router/RAG/HITL/chat-UX/i18n/observability sẵn có, thay vì dựng Qdrant/Open WebUI/agent framework song song.
- **Nối AI codegen vào `programmingAdapter`** để thừa hưởng chuỗi an toàn — đây là giá trị cốt lõi, không phải một trợ lý chat generic.

Phần còn lại của tài liệu chứng minh kết luận này bằng bằng chứng khảo sát (Phần I–II), thiết kế đích (Phần III), kế hoạch 5 giai đoạn P0–P4 (Phần IV), ngân sách VRAM + an toàn + rủi ro (Phần V), và **10 quyết định cần bạn duyệt** (Phần VI).

---

## PHẦN I — Báo cáo yêu cầu gì vs. Hệ thống đã có gì

Ánh xạ trực tiếp từng trụ cột của `AI-LOCAL-SDD-001` sang trạng thái thực tế (bằng chứng file:line trong Phần II).

| # | Trụ cột báo cáo | Trạng thái hiện tại | Đánh giá |
|---|---|---|---|
| 1 | **Phần cứng + CUDA Blackwell sm_120** | RTX 5090 32GB · CUDA đã build · GPU offload active | ✅ **XONG** |
| 2 | **Bộ model GGUF** (Qwen3-30B-A3B/4B/VL-8B/Embedding-0.6B) | Đúng bộ đó, đã có trên đĩa `D:/SOURCES/16.AI`, đã tăng tốc GPU | ✅ **XONG** |
| 3 | **Định tuyến model theo tác vụ** | `aiModelRouter.ts` — Cognitive Escalation Ladder Tier 0–4 | ✅ Có (nhưng **thiếu tier `code`/FIM**) |
| 4 | **Engine suy luận API chuẩn OpenAI** | node-llama-cpp **in-process** (text/embed) + llama-server sidecar (chỉ vision) | ⚠️ **KHÔNG có endpoint `/v1/*`** — keystone thiếu |
| 5 | **RAG tri thức miền** | RAG bruteforce file-jsonl 2.186 chunk, có rerank/graph/causal (tắt), có trích dẫn nguồn | ⚠️ Engine tốt nhưng **0% tri thức lập trình** |
| 6 | **Golden examples (mã chuẩn theo ngôn ngữ)** | Không có kho mã chuẩn nào | ❌ **THIẾU** |
| 7 | **Ingestion PDF/manual + OCR + metadata hãng** | Chỉ ingest source-code + markdown nội bộ; không PDF/OCR/metadata hãng | ❌ **THIẾU** |
| 8 | **Sinh/hoàn thiện/dịch/rà soát mã bằng LLM** | `aiProgrammingCopilot.ts` = template tĩnh, flag-off, chưa nối UI, chưa nối GGUF | ❌ **THIẾU (greenfield)** |
| 9 | **Năng lực thị giác đọc sơ đồ/HMI/datasheet** | Qwen3-VL chạy được (defect/OCR) nhưng **chat không có ô nhập ảnh** | ⚠️ Model có, **UX chat thiếu** |
| 10 | **Tích hợp IDE (VS Code + Continue, autocomplete, chat/edit)** | Không Monaco/CodeMirror, không extension, editor là `<textarea>` trần | ❌ **THIẾU hoàn toàn** |
| 11 | **Agent/tool-calling (retrieval, syntax-check, file r/w, MCP)** | 65 tool ops (intent-routing, không function-calling), HITL mạnh; **không** tool lập trình/file/compile; **không MCP** | ⚠️ Framework HITL tái dùng được; tool lập trình thiếu |
| 12 | **Bộ đánh giá (eval) chất lượng mã** | eval-harness chỉ chấm **vision ONNX**; RAG chỉ recall@5 goldenset nhỏ | ❌ **THIẾU eval code** |
| 13 | **Fine-tuning LoRA/QLoRA (Unsloth) → xuất GGUF** | Không có bất kỳ đường LLM-finetune nào ("Unsloth" chỉ là nhãn tải GGUF; "fine-tune" là transfer-learning ONNX vision) | ❌ **THIẾU** |
| 14 | **Vận hành: đa người dùng, giám sát, sao lưu** | Có semaphore/queue, Prometheus+Grafana "AI Brain", backup service | ✅ Nền tốt (cần mở rộng cho coding) |
| 15 | **HẠ TẦNG LẬP TRÌNH AN TOÀN (báo cáo không biết có)** | `programmingAdapter` 8-kind + safety-linter + sim-gate + Rapier + **HIL URSim thật** + deploy HITL | 🎁 **TÀI SẢN VƯỢT NGOÀI báo cáo** |

**Đọc bảng:** báo cáo hình dung một dự án greenfield "dựng nền → chat → RAG → chuyên biệt → vận hành". Thực tế của ta là **"tiêm một miền lập trình vào một bộ não đang chạy"** — với nền engine/model đã xong và một substrate lập trình an toàn để codegen chảy vào. Điều này thay đổi thứ tự ưu tiên: không phải GĐ0 (đã xong), mà là **API keystone → tri thức lập trình → LLM-codegen nối substrate → IDE → eval/finetune**.

---

## PHẦN II — Phân tích khoảng trống theo từng lớp (bằng chứng khảo sát)

### 2.1 Lớp Engine & API phục vụ — *keystone thiếu*

- Text/embed/rerank: **node-llama-cpp in-process** (`aiGgufEngine.ts`, bản llama.cpp `b8770`, CUDA, `gpuLayers:"max"`). Mỗi request mở **`LlamaChatSession` mới** → **không tái dùng prefix/KV-cache** giữa các request (`aiGgufEngine.ts:730`) — xấu cho độ trễ coding tương tác.
- Vision: **llama-server sidecar** riêng (port 8081, CUDA13 `b8770`, `--mmproj --jinja`), **nạp theo nhu cầu, kill sau 10' nhàn** (`llamaVisionSidecar.ts`). Đây là server `/v1/chat/completions` **duy nhất** trong hệ — nhưng chỉ có model vision, không ổn định để làm endpoint code.
- **KHÔNG có API tương thích OpenAI cho text**: grep `/v1/chat/completions|/v1/completions|/v1/embeddings` trên app server = 0 route. Có SSE tùy biến `/api/ai/stream/*` (không đúng schema OpenAI) và `invokeLLM` (hàm JS, không phải HTTP). → **Continue/Open WebUI/aider không có gì để nối.**
- **Không có coder model, không FIM/infill, không speculative decoding, không prefix-cache.** Semaphore inference **toàn cục** dùng chung với job nền (RCA/report/embed) → coding tương tác sẽ tranh hàng đợi.
- Router thiếu **tier `code`**; `GGUF_THINKING_MODEL` bật flag nhưng chưa set model (fallback 30B).

**Kết luận:** 4 thứ một coding-assistant cần mà nay chưa có: (1) endpoint OpenAI, (2) coder model + FIM, (3) prefix-cache/slot riêng, (4) tier code trong router.

### 2.2 Lớp Model — thiếu model code

Trên đĩa: Qwen3-30B-A3B (17.7GB), 4B (2.55GB), VL-8B+mmproj (6.3GB), Embedding-0.6B (1.2GB), bge-reranker-v2-m3 (636MB), mxbai cũ (670MB). **Không có Qwen3-Coder / Qwen2.5-Coder / model FIM.** Báo cáo tự gợi ý bổ sung **Qwen3-Coder-30B-A3B** cho tác vụ code nặng (§3.2) — khớp.

### 2.3 Lớp RAG & Tri thức — engine tốt, sai miền

- Lưu trữ: **bruteforce cosine file-jsonl** (`aiLocalKnowledgeService.ts`), 2.186 chunk, Qwen3-Embedding 1024-d, hybrid semantic+keyword, trích dẫn nguồn `[1][2]`, đa ngữ VN/EN/ZH. GraphRAG/reranker/causal-graph **mặc định TẮT**.
- **pgvector tồn tại nhưng bất hoạt**: `kb/kbVectorStore.ts` + bảng `kb_chunks` (HNSW, migration 0121) — nhưng `KB_PGVECTOR_ENABLED` off và **không nối vào đường trả lời**.
- **Miền phủ = ~60% tự-mô-tả-codebase + ~40% ops/chất-lượng. 0% tri thức lập trình.** Grep "IEC 61131 / Modbus / EtherCAT" chỉ trúng **metadata tên file** của chính repo (vd `service:...iec61131Adapter.ts → "Exported classes:..."`), **không phải nội dung**. Không có: cú pháp ladder/ST, ngôn ngữ robot (KAREL/RAPID/KRL/MELFA/TMflow), lệnh Zmotion ZBasic/ZMC, chuẩn IEC 61131-3, fieldbus, **bảng mã lỗi servo/drive**.
- **Không có golden-examples/code-template.** "golden" trong hệ = eval-set RAG + ảnh PCB tham chiếu vision.
- Ingestion (`scripts/ai-kb/*`): chỉ đi source + markdown, **chủ động loại** doc audit/report; **không PDF/OCR, không metadata hãng/model/phiên bản/trang, không collection theo hãng**.

**Kết luận:** cần net-new: pipeline ingestion PDF/OCR + chunking theo cấu trúc + metadata giàu + collection theo hãng/ngôn ngữ; kho golden-code; và (khuyến nghị) kích hoạt pgvector cho corpus lập trình để lọc metadata.

### 2.4 Lớp Sinh mã — greenfield LLM trên substrate mạnh

- **Substrate lập trình (đã có, THẬT):** `programmingAdapter.ts` hợp đồng `validate→compile→simulate→deploy→upload`, 8 kind:
  `stub`, `zmotion-basic` (lint+motion-sim thật), `mitsubishi-engineering` (bảng device/recipe MELSEC), `robot-tm` (job-verb Techman), `iec61131-st`, `iec61131-ld` (sim 1-scan boolean thật), `iec61131-pou` (LAD/FBD/SFC → ST + PLCopen TC6 XML round-trip), `ir-flow` (IR AST → **URScript** + **ROS2 MoveIt Python**).
  - IR có **safety-linter** (trần tốc độ/lực/blend ISO/TS 15066, AABB workspace, PID sanity, đệ quy) — lỗi `error` **chặn codegen**; **sim-gate động học** (`kinematicSimGate`), **Rapier physics**, và **HIL URSim thật** (`ursimHarness.validateUrscriptOnUrsim` gửi URScript vào controller UR ảo qua 30001/29999). Mọi dòng sinh ra mang marker `# [IR <type> #id]` để review đối chiếu.
- **AI codegen = KHÔNG có.** Surface lập trình-AI duy nhất `aiProgrammingCopilot.ts` là **template tĩnh** (`skeleton()` hardcode), **flag-off**, **chưa nối frontend** (grep `copilotSuggest` ở client = 0), **chưa gọi GGUF engine**. `explainProgram()` chỉ đếm dòng bằng regex.
- Agent-layer ops **không với tới** substrate lập trình (không file `aiLocalTools/` nào import `programmingAdapter`).
- Ngôn ngữ robot teach thật (**KAREL/RAPID/KRL/MELFA**) = **greenfield hoàn toàn** (driver Fanuc/ABB/KUKA là scaffold telemetry, không phải authoring ngôn ngữ).

**Kết luận:** đây là phần giá trị nhất và cũng greenfield nhất. Chiến lược: LLM sinh mã **vào IR/POU model** (thừa hưởng chuỗi an toàn) khi có thể; với ngôn ngữ text (ST/KAREL/...) thì **bắt buộc chạy qua `programmingAdapter.validate/compile/simulate` trước khi hiển thị**.

### 2.5 Lớp Agent/Tool — framework HITL tái dùng được, tool lập trình thiếu

- 65 tool (38 read + 25 write + 2 client), cơ chế = **intent-classifier + GBNF-JSON**, **không native function-calling** (model không phát `tool_calls`).
- **HITL write mạnh & tái dùng được:** `aiCopilotActions.ts` propose→confirm, 2 lần gate RBAC, zod bounds, TTL 5', idempotency, audit append-only, args đọc từ DB (không từ client). Planner/orchestrator có bound (`AGENT_MAX_STEPS`, `AGENT_MAX_WRITES_PER_SESSION`), **dừng ở mọi write** chờ người.
- **Thiếu:** MCP (0 tham chiếu), tool đọc/ghi file workspace, tool syntax-check/compile/sandbox (dù pipeline tồn tại — chưa nối), tool tra mã lỗi, tool tính toán, RAG-as-tool. Read-tool RBAC hiện **chỉ khai báo, chưa enforce** ở đường read.

**Kết luận:** tái dùng registry + HITL propose→confirm + planner; **build mới**: tool file (giới hạn thư mục + HITL), tool compile/lint/sim (bọc `programmingAdapter`), tool tra mã lỗi, tool calc, RAG-tool; tùy chọn MCP server.

### 2.6 Lớp UX / IDE — spine chat tốt, IDE trống

- Spine chat trưởng thành: SSE streaming, voice (Web Speech vi-VN), quét QR máy, thẻ HITL confirm, playbook agentic, i18n 3 ngữ (~14k dòng/ngữ; zh trễ ~3k dòng).
- **Editor code = `<textarea>` trần** (`CodeEditor.tsx` "dependency-free", tự ghi chú "Monaco có thể drop-in sau"), `LadderEditor` = lưới `<Input>`. **0 AI-in-editor** (không autocomplete, không ghost-text, không chat/edit). IR/POU chỉ có pane transpile read-only + linter server.
- **VS Code/Continue/Monaco/CodeMirror/LSP = KHÔNG có** (package.json không có dep; chỉ xuất hiện trong comment "tương lai").
- Chat **không có ô nhập ảnh** (chỉ text/voice/QR) → không dùng được Qwen3-VL trong luồng hỏi-đáp.
- **Không có role `engineer` cấp app** (`roleEnum`: admin/supervisor/quality_inspector/operator/maintenance/viewer/user). "engineer" chỉ là persona AI (map từ quality_inspector/maintenance), **không cấp quyền**.

**Kết luận:** hai "nhà" cho copilot lập trình: (1) **trong app** — nâng CodeEditor → Monaco + inline-suggest + panel chat/edit, nhúng vào EngineeringWorkspace/IrEditor/PouStudio; (2) **IDE ngoài** — VS Code + Continue trỏ cổng OpenAI. Cả hai đều net-new nhưng dùng chung một serving layer.

### 2.7 Lớp Eval / Fine-tune / Ops — MLOps chỉ có nhánh vision

- eval-harness (`aiEvalHarness.ts`) **chỉ chấm ONNX vision** (confusion matrix). RAG eval (`scripts/ai-kb/eval-rag.mjs`) chỉ **recall@5** trên goldenset 12 câu (đã bão hòa). **Không đo:** tỉ lệ đúng cú pháp, compile/transpile-pass, sim-pass, độ chính xác câu trả lời, độ trễ code.
- **LoRA/QLoRA/Unsloth/GGUF-export = 0.** "fine-tune" trong hệ = transfer-learning lớp cuối ONNX vision; sidecar Python (`localSidecarTrainer.ts` `LOCAL_TRAINER_CMD`) chỉ xuất `model.onnx`. Hệ **tiêu thụ** GGUF, **không sản xuất** GGUF.
- Registry `ai_models`/`model_versions` **hình dạng ONNX-vision** — không cột adapter/quant/base-model/GGUF-artifact/lineage cho LLM.
- Benchmark: chỉ tok/s đo live, **không harness prefill/decode/VRAM sweep**; số trong model-card là hardcode.
- Drift chỉ theo `confidence` vision. Observability Prometheus+Grafana "AI Brain" tốt (tier/latency/queue/VRAM) nhưng **không export tok/s, không gauge eval/recall**.
- Ops tái dùng được: semaphore/queue đa người dùng, backup service, scheduler+flag scaffolding.

**Kết luận:** build mới: harness eval code (dùng `programmingAdapter`/IR-transpiler làm oracle compile-pass), nhánh LoRA/QLoRA→GGUF (mở rộng seam `LOCAL_TRAINER_CMD` sang `task:"llm-sft"`), registry LLM-aware, benchmark harness, drift code-answer.

---

## PHẦN III — Thiết kế đích: "Automation Programming Copilot" hội tụ

### 3.1 Quyết định kiến trúc: Hybrid hội tụ (không dựng stack song song)

Ba lựa chọn, khuyến nghị **B (Hybrid)**:

| Phương án | Mô tả | Ưu | Nhược |
|---|---|---|---|
| A. Nhúng-only | Chỉ copilot trong app, không IDE ngoài | Tái dùng tối đa; an toàn nhất | Kỹ sư quen VS Code không có công cụ ở IDE |
| **B. Hybrid (KHUYẾN NGHỊ)** | **Một cổng OpenAI** phục vụ *cả* copilot in-app *lẫn* VS Code+Continue; codegen nối `programmingAdapter` | Mở khóa cả 2 đường với 1 serving; giữ chuỗi an toàn; tái dùng RAG/HITL/UX | Cần dựng cổng OpenAI + Continue config (vừa sức) |
| C. Standalone (báo cáo nguyên văn) | Dựng llama-server+Continue+Open WebUI+Qdrant riêng | Đúng báo cáo từng chữ | Nhân đôi hạ tầng; **bỏ qua substrate an toàn**; 2 stack phải nuôi |

**Vì sao Hybrid:** cổng OpenAI là "khớp nối vạn năng" — một endpoint duy nhất phục vụ được Continue (IDE ngoài) *và* Monaco in-app *và* các agent nội bộ. Ta giữ được thứ báo cáo không có (substrate an toàn + RAG ops + HITL), đồng thời có được thứ báo cáo mô tả (IDE coding). Không nhân đôi Qdrant/Open WebUI/agent-framework.

### 3.2 Sơ đồ khối đích

```
┌──────────────────────────────────────────────────────────────────────────┐
│  NGƯỜI DÙNG                                                                │
│   • VS Code + Continue (autocomplete FIM · chat/edit · index code)         │
│   • Copilot in-app: Monaco trong EngineeringWorkspace/IrEditor/PouStudio   │
│   • Web chat (spine SSE hiện có) + ô nhập ẢNH (Qwen3-VL) [mới]             │
├──────────────────────────────────────────────────────────────────────────┤
│  LỚP AGENT LẬP TRÌNH  (mở rộng aiLocalTools + planner/HITL hiện có)        │
│   Tools: retrieve_prog_kb · syntax_check · compile · simulate · run_HIL    │
│          lookup_error_code · calc · read_file · write_file(HITL)           │
│          translate_code · explain_code   [+ tùy chọn MCP server expose]    │
├───────────────┬───────────────────────┬──────────────────────────────────┤
│  RAG LẬP TRÌNH│  THỊ GIÁC (VL)        │  ROUTER (+tier CODE mới)          │
│  pgvector     │  Qwen3-VL-8B+mmproj   │  chat→30B · code→Coder · fast→4B  │
│  collection   │  đọc ladder/HMI/      │  fim→Coder-FIM · vision→VL        │
│  theo hãng    │  datasheet/ảnh lỗi    │  embed→0.6B                       │
│  + golden-code│                       │                                   │
├───────────────┴───────────────────────┴──────────────────────────────────┤
│  🔒 SUBSTRATE AN TOÀN (đã có) — mọi mã AI CHẢY VÀO ĐÂY                     │
│   programmingAdapter: validate → safety-linter → sim-gate → Rapier →      │
│                       HIL URSim → deploy GATED (HITL 2-mắt)                │
├──────────────────────────────────────────────────────────────────────────┤
│  CỔNG API TƯƠNG THÍCH OPENAI  [KEYSTONE MỚI]                              │
│   /v1/chat/completions · /v1/completions(FIM) · /v1/embeddings · /v1/models│
│   → llama-server bền cho Coder (prefix-cache, FIM, slot riêng)            │
│   → shim in-app cho embed/vision (tái dùng aiGgufEngine)                  │
├──────────────────────────────────────────────────────────────────────────┤
│  ENGINE  node-llama-cpp (in-process) + llama-server (coder/vision)         │
│  PHẦN CỨNG  RTX 5090 32GB · i7-12700 · 80GB RAM  (đã tăng tốc GPU)         │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Thiết kế theo lớp

**(a) Serving & Router.** Thêm cổng OpenAI 2 nhánh: (1) **llama-server bền** cho coder model (bật `-fa`, prefix-cache, FIM, `--api-key`, port riêng, slot budget riêng → không tranh với job nền); (2) **shim in-app** (`/v1/*` map `aiGgufEngine`/`invokeLLM`) cho embeddings/vision + auth thống nhất. Router thêm **tier `code`** và **`fim`**; giữ nguyên đường ops. Vì coder-30B là **30B thứ hai**, dùng **hoán đổi (llama-swap/Ollama) hoặc nạp-theo-nhu-cầu**, không giữ đồng thời 2×30B (xem §5.1 VRAM).

**(b) Model code.** Khuyến nghị **Qwen3-Coder-30B-A3B-Instruct** (MoE cùng cỡ, tối ưu code, báo cáo đề xuất) + một model FIM nhỏ cho autocomplete (Qwen2.5-Coder-1.5B/3B hoặc dùng 4B hiện có). Cân nhắc phương án tiết kiệm: **tái dùng Qwen3-30B-A3B-Instruct** đang có (không tải thêm) cho chat/edit, chỉ tải model FIM nhỏ cho autocomplete — quyết định ở Phần VI.

**(c) RAG lập trình.** Corpus riêng trên **pgvector** (kích hoạt path bất hoạt), collection theo hãng/ngôn ngữ, metadata {vendor, model, firmware, page, lang}. Ingestion PDF/manual + **OCR bằng Qwen3-VL** cho trang scan, chunking theo cấu trúc (mục/lệnh/bảng, giữ nguyên khối mã). Bật **reranker** (bge-reranker đã có trên đĩa) cho độ chính xác. Trích dẫn nguồn bắt buộc (chống "bịa" — điểm sống-còn của miền hiếm như Zmotion/KAREL). KB ops giữ nguyên bruteforce.

**(d) Golden-code library.** Kho `knowledge/golden-code/<lang>/*.{st,krl,rapid,...}` versioned Git, mỗi mẫu {đề bài → mã đúng + chú thích + quy ước nội bộ}, gắn retrieval để tự chọn few-shot. Ưu tiên ngôn ngữ theo hãng thực dùng trong nhà máy.

**(e) LLM codegen nối substrate.** Nâng cấp `aiProgrammingCopilot.ts`: template tĩnh → LLM coder tier. Luồng: *prompt hệ thống theo vai trò + golden few-shot + RAG có trích dẫn → sinh mã → **validate qua programmingAdapter** → nếu IR/POU thì vào safety-linter/sim/HIL → hiển thị kèm cảnh báo + nguồn → HITL*. Hỗ trợ: sinh / hoàn thiện / **dịch giữa ngôn ngữ** / rà soát / giải thích. **Hard-refuse** mã an toàn (E-stop/interlock/SIL) — giữ & tăng cường guard hiện có.

**(f) Agent/tool lập trình.** Đăng ký tool mới vào registry, tái dùng HITL propose→confirm cho `write_file`. Tùy chọn: thêm **vòng native function-calling** cho agent coding (Qwen3 hỗ trợ tốt) song song đường intent-classifier ops. Enforce RBAC read-tool trước khi lộ nội dung repo/spec.

**(g) UX/IDE.** In-app: Monaco + ghost-text (FIM) + panel chat/edit + apply-diff, nhúng 3 editor; surface "Programming Copilot" role-gated; thêm **ô nhập ảnh vào chat** (VL). Ngoài: `.continue` config trỏ cổng (autocomplete=coder-FIM, chat=coder-30B, embed=0.6B, index code). Cân nhắc extension ST4I mỏng sau.

**(h) Eval/Fine-tune/Ops.** Harness eval code (syntax/compile/sim-pass + accuracy + latency, dùng `programmingAdapter`/IR-transpiler làm oracle); RAG precision@k/nDCG/MRR + goldenset lập trình lớn. Nhánh QLoRA (Unsloth) → merge → **xuất GGUF** → registry LLM-aware → promote qua eval-gate — **chỉ khi prompt+RAG tới hạn** (thứ tự báo cáo §11.2). Observability +tok/s/prefill/decode/eval-score; panel Grafana "Programming"; slot riêng đa người dùng; backup + golden-code + adapter.

---

## PHẦN IV — Kế hoạch nâng cấp 5 giai đoạn (P0–P4)

> Thứ tự tối ưu cho *thực tế của ta* (không phải greenfield): **API keystone → tri thức → codegen-nối-substrate → IDE → eval/finetune**. Mỗi giai đoạn cho ra năng lực dùng được. Cờ mặc định OFF; bật sau kiểm thử.

### P0 — Serving keystone + coder model + benchmark  *(~3–5 ngày)*
**Mục tiêu:** có endpoint OpenAI + tier code + số benchmark chuẩn.
1. Tải/đăng ký coder model (Qwen3-Coder-30B-A3B **hoặc** tái dùng 30B-A3B) + model FIM nhỏ; thêm env `GGUF_CODE_MODEL`, `GGUF_FIM_MODEL`.
2. Router: thêm tier `code`/`fim` (`aiModelRouter.ts`), fail-safe fallback về 30B nếu thiếu model.
3. Cổng OpenAI: (a) llama-server bền cho coder (`-fa`, prefix-cache, FIM, `--api-key`, port riêng); (b) shim in-app `/v1/chat/completions|/v1/completions|/v1/embeddings|/v1/models` map `aiGgufEngine`/`invokeLLM`; auth thống nhất; slot budget riêng.
4. Benchmark harness (`scripts/ai-bench`): tok/s prefill/decode + VRAM cho code/chat/fim; ghi baseline; export metric.
5. Ngân sách VRAM re-plan (hoán đổi 2×30B).

**Exit:** Continue/`curl` gọi được `/v1/chat/completions` (coder) + `/v1/completions` (FIM) + `/v1/embeddings`; benchmark ghi lại; không lỗi kernel; job ops không bị coding chiếm hàng đợi.

### P1 — Cơ sở tri thức lập trình (RAG miền + golden-code)  *(~1–2 tuần)*
**Mục tiêu:** trợ lý "biết" tài liệu hãng + mã nội bộ, có trích dẫn.
1. Kích hoạt pgvector cho corpus lập trình (`KB_PGVECTOR_ENABLED`, collection theo hãng/ngôn ngữ, metadata giàu); KB ops giữ bruteforce.
2. Pipeline ingestion mới: PDF/manual + **OCR (Qwen3-VL)** + chunking theo cấu trúc + metadata {vendor/model/firmware/page/lang}.
3. Seed tri thức các hãng **thực dùng** (Mitsubishi/Fanuc/Techman/Zmotion/UR + IEC 61131-3 + fieldbus + bảng mã lỗi servo/drive).
4. Golden-code library (versioned Git) + retrieval few-shot.
5. Bật reranker cho corpus lập trình; eval recall/precision goldenset lập trình.

**Exit:** ≥ vài chục câu hỏi thực trả lời bám tài liệu + trích dẫn đúng trang; golden-code truy hồi được; precision@k đạt ngưỡng.

### P2 — LLM codegen nối substrate an toàn *(giá trị cốt lõi)*  *(~2–4 tuần)*
**Mục tiêu:** sinh/hoàn thiện/dịch/rà soát/giải thích mã, mọi output qua chuỗi an toàn.
1. Nâng `aiProgrammingCopilot.ts`: template → LLM coder; prompt vai trò + golden few-shot + RAG trích dẫn.
2. **Nối substrate:** sinh vào IR/POU model khi được (thừa hưởng linter→sim→HIL); ngôn ngữ text chạy `programmingAdapter.validate/compile/simulate` trước khi hiển thị.
3. Tool lập trình vào registry: `retrieve_prog_kb`, `syntax_check`, `compile`, `simulate`, `run_hil`, `lookup_error_code`, `calc`, `read_file`, `write_file`(HITL), `translate_code`, `explain_code`.
4. Guard an toàn: hard-refuse mã safety; mọi output validate trước hiển thị; không auto-deploy. (Tùy chọn) vòng native function-calling cho agent coding.

**Exit:** UC sinh ST/dịch sang Zmotion/giải thích ladder chạy được; mã sai cú pháp bị chặn bởi validate; refuse mã safety hoạt động; nhành động file/deploy đều HITL.

### P3 — Trải nghiệm IDE (in-app Monaco + VS Code/Continue)  *(~2–3 tuần)*
**Mục tiêu:** trợ lý hữu ích hằng ngày trong editor.
1. In-app: CodeEditor → **Monaco** + ghost-text autocomplete (FIM) + panel chat/edit + apply-diff; nhúng EngineeringWorkspace/IrEditor/PouStudio; surface "Programming Copilot" role-gated.
2. **Ô nhập ảnh vào chat** (VL đọc ladder/HMI/datasheet/ảnh lỗi → RAG → tổng hợp).
3. Ngoài: `.continue` config + hướng dẫn; index code project; (tùy chọn) extension ST4I mỏng.
4. Quyết định role `engineer` (thêm cấp app hay giữ persona).

**Exit:** kỹ sư dùng autocomplete + chat/edit trong app **và** VS Code; dán ảnh sơ đồ nhận giải thích; i18n vi/en/zh đủ.

### P4 — Eval, fine-tune (tùy chọn), vận hành cứng  *(liên tục)*
**Mục tiêu:** đo được, cải tiến có kiểm soát, ổn định đa người dùng.
1. Harness eval code (syntax/compile/sim-pass + accuracy + latency, per-language, oracle = programmingAdapter/IR-transpiler); RAG precision@k/nDCG/MRR.
2. (Tùy chọn, chỉ khi prompt+RAG tới hạn) nhánh **QLoRA Unsloth** → merge → **xuất GGUF** → registry LLM-aware → promote qua eval-gate; hard-refuse catastrophic-forgetting (eval trước/sau).
3. Observability: +tok/s/prefill/decode/eval-score/recall; panel Grafana "Programming"; slot/fairness đa người dùng.
4. Backup mở rộng (KB lập trình + golden-code + adapter); quy trình cập nhật engine/model có eval hồi quy + lùi bản.
5. (Tùy chọn) speculative decoding (4B draft cho 30B), KV-quant, llama.cpp mới cho Qwen3.5/Next.

**Exit:** đạt ngưỡng eval đặt ra; giám sát+backup+quy trình cập nhật; vòng cải tiến (phản hồi→golden/KB→eval) thiết lập.

### Bản đồ nỗ lực (định hướng)
| GĐ | Trọng tâm | Thời lượng* | Rủi ro | Giá trị |
|---|---|---|---|---|
| P0 | API + coder + bench | 3–5 ngày | Thấp (nền đã xong) | Mở khóa mọi thứ |
| P1 | Tri thức lập trình | 1–2 tuần | TB (thu thập tài liệu) | Cao (chống bịa) |
| P2 | Codegen nối substrate | 2–4 tuần | TB-cao | **Cao nhất** |
| P3 | IDE/UX | 2–3 tuần | TB (Monaco) | Cao (dùng hằng ngày) |
| P4 | Eval/finetune/ops | Liên tục | Thấp-TB | Bền vững |

*Ước cho 1–2 kỹ sư chính + agent chuyên môn.

---

## PHẦN V — VRAM, An toàn, Non-goals, Rủi ro

### 5.1 Ngân sách VRAM (32GB) khi thêm coder
Thường trú ops hiện tại: 30B-A3B (~17.5) + 4B (~2.5) + embed (~1.2) + reranker (~0.6) ≈ **~22GB** + KV. **Không thể** giữ đồng thời 2×30B (coder + instruct) trên 32GB.
- **Chiến lược:** coder-30B qua **hoán đổi/nạp-theo-nhu-cầu** (llama-swap/Ollama) — chỉ nạp khi có phiên coding; giải phóng khi nhàn. FIM model nhỏ (~2GB) có thể thường trú. Vision vẫn sidecar nạp-theo-nhu-cầu.
- **Phương án tiết kiệm:** không tải coder riêng — dùng 30B-A3B-Instruct hiện có cho chat/edit (đủ tốt theo báo cáo §3.2), chỉ tải FIM nhỏ. Bỏ hẳn áp lực VRAM. (Quyết định D2.)
- Bật `-fa` + KV q8_0 khi context dài; context mặc định 32K, mở 128K chỉ khi đọc repo/manual lớn.

### 5.2 An toàn (bất biến — điểm mạnh sẵn có)
Substrate hiện tại **đã** thực thi mô hình an toàn báo cáo đòi hỏi: validate→sim→HIL→deploy-gated-HITL. Thiết kế này **giữ nguyên và mở rộng**: (1) AI **chỉ đề xuất**, người duyệt; (2) mọi mã qua validate trước hiển thị; (3) **refuse** mã chức năng an toàn; (4) file-write giới hạn thư mục + HITL; (5) không auto-nạp thiết bị; (6) audit append-only mọi hành động. Đây là lợi thế quyết định so với Continue-thuần.

### 5.3 Non-goals
- Không thay thế kỹ sư; không sinh chức năng an toàn (safety-PLC/E-stop/interlock/SIL).
- Không tự động nạp/chạy mã trên thiết bị vận hành.
- Không viết lại bộ não ops hiện có; không dựng stack AI song song.
- Không cloud; giữ air-gap được.

### 5.4 Rủi ro & giảm thiểu
| Rủi ro | Giảm thiểu |
|---|---|
| VRAM chật khi thêm coder-30B | Hoán đổi/nạp-theo-nhu-cầu; hoặc tái dùng 30B-instruct (D2) |
| Model "bịa" cú pháp hãng hiếm (Zmotion/KAREL) | RAG bắt buộc + trích dẫn + golden few-shot + validate qua adapter |
| Coding tranh hàng đợi với job ops | Slot budget riêng cho cổng coder (P0) |
| KAREL/RAPID/KRL/MELFA không có substrate authoring | Ưu tiên ngôn ngữ có substrate trước; robot-teach text-only + validate hãng sau (D7) |
| node-llama-cpp không FIM/multimodal | Dùng llama-server bền cho coder+FIM (đã có build b8770 trên đĩa) |
| Fine-tune làm thoái hóa năng lực | Chỉ khi prompt+RAG tới hạn; eval trước/sau; giữ bản gốc lùi được |

---

## PHẦN VI — 10 QUYẾT ĐỊNH CẦN BẠN DUYỆT

Trả lời để chốt trước khi gọi agent chuyên môn thực thi.

| # | Quyết định | Khuyến nghị |
|---|---|---|
| **D1** | **Chiến lược:** Hybrid hội tụ / Nhúng-only / Standalone-Continue? | **Hybrid** (§3.1) |
| **D2** | **Coder model:** Tải Qwen3-Coder-30B-A3B riêng / Tái dùng 30B-A3B-Instruct hiện có + chỉ tải FIM nhỏ? | **Tái dùng 30B-instruct + FIM nhỏ** trước (tiết kiệm VRAM), tải Coder-30B ở P4 nếu eval cho thấy cần |
| **D3** | **Cổng OpenAI:** llama-server bền (coder) + shim in-app (embed/vision)? | **Có, cả hai** (keystone P0) |
| **D4** | **KB lập trình:** Kích hoạt pgvector cho corpus code / mở rộng file-based collections? | **pgvector** cho code (lọc metadata); ops giữ bruteforce |
| **D5** | **Đường IDE:** Làm in-app Monaco trước hay VS Code+Continue trước (hay cả hai P3)? | **Continue trước** (nhanh, dùng ngay cổng P0), Monaco in-app song song |
| **D6** | **Role `engineer`:** Thêm role cấp app thật / giữ persona map? | Quyết định ở P3; nghiêng **thêm role thật** để RBAC rõ ràng |
| **D7** | **Ưu tiên ngôn ngữ codegen/golden:** danh sách + thứ tự? | **Có substrate trước** (ST, LD, POU, IR→URScript/ROS2, Zmotion-Basic, MELSEC, Techman); KAREL/RAPID/KRL/MELFA sau — **theo hãng thực dùng trong nhà máy của bạn** (cần bạn cho biết) |
| **D8** | **Ô nhập ảnh vào chat (VL đọc ladder/HMI/datasheet):** có ở P3? | **Có** (rẻ, VL đã chạy) |
| **D9** | **Fine-tune LoRA/QLoRA:** trong phạm vi P4 hay hoãn tới khi prompt+RAG chứng minh không đủ? | **Hoãn/tùy chọn** (đúng thứ tự báo cáo §11.2) |
| **D10** | **Native function-calling cho agent coding** hay giữ intent-classifier + GBNF? | Thêm **function-calling** cho nhánh coding; giữ intent-routing cho ops |

**Ngoài ra cần bạn cung cấp (để P1 chính xác):** danh sách hãng/thiết bị **thực tế** trong nhà máy (PLC hãng nào, robot hãng nào, có Zmotion ZMC4xx không, có UR không) + có sẵn PDF manual/tài liệu hãng để ingest không.

---

## §VI-bis — QUYẾT ĐỊNH ĐÃ CHỐT (2026-07-05)

| # | Chốt |
|---|---|
| D1 | ✅ **Hybrid hội tụ** |
| D2 | ✅ **Tái dùng Qwen3-30B-A3B-Instruct hiện có + chỉ tải model FIM nhỏ** cho autocomplete. Coder-30B riêng chỉ tải ở P4 nếu eval cho thấy cần. |
| D3 | ✅ Cổng OpenAI 2 nhánh (llama-server bền cho coder/FIM + shim in-app cho embed/vision) |
| D4 | ✅ pgvector cho corpus lập trình; KB ops giữ bruteforce |
| D5 | ✅ **VS Code + Continue trước** (dùng ngay cổng P0), Monaco in-app làm song song |
| D6 | ✅ Thêm role `engineer` cấp app (chốt chi tiết ở P3) |
| D7 | ✅ Danh sách hãng thực tế — xem bảng ánh xạ + thứ tự ưu tiên bên dưới |
| D8 | ✅ Ô nhập ảnh vào chat (Qwen3-VL) ở P3 |
| D9 | ✅ Hoãn LoRA/QLoRA (chỉ khi prompt+RAG tới hạn) |
| D10 | ✅ Native function-calling cho agent coding; giữ intent-routing cho ops |

### D7 — Ánh xạ hãng → ngôn ngữ → trạng thái substrate (quyết định thứ tự làm)

| Loại | Hãng | Ngôn ngữ đích | Substrate authoring hiện có? | Xếp tier |
|---|---|---|---|---|
| PLC | **Mitsubishi** | MELSEC (ST/LD/SFC) + bảng device/recipe | ✅ IEC-61131 ST/LD/POU + `mitsubishi-engineering` | **A** |
| PLC | **Delta** | DVP/AS (ST/LD, IEC-61131) | ⚠️ IEC-61131 chung có; lệnh riêng Delta cần RAG | **A/B** |
| PLC | **Omron** | Sysmac NX/NJ (ST/LD, IEC-61131) | ⚠️ IEC-61131 chung có; FB/lệnh Omron cần RAG | **A/B** |
| Motion | **Zmotion ZMC** | ZBasic/RTBasic | ✅ `zmotion-basic` (lint + motion-sim THẬT) | **A** |
| Robot | **Universal Robots** | URScript | ✅ IR→URScript + **HIL URSim THẬT** (mạnh nhất) | **A** |
| Robot | **Fanuc** | KAREL / TP | ❌ **Greenfield** (driver chỉ telemetry) | **B** |
| Robot | **Mitsubishi** | MELFA-BASIC V/VI | ❌ **Greenfield** (MELFA ≠ `mitsubishi-engineering` PLC) | **B** |
| Robot | **Delta** | Delta robot (DRAS/DIAStudio) | ❌ **Greenfield** | **B** |

- **Tier A (có substrate → codegen + validate/sim ngay ở P2):** UR/URScript, Zmotion ZBasic, IEC-61131 ST/LD/POU (phủ MELSEC + Delta + Omron ở mức ngôn ngữ chuẩn), Mitsubishi device-recipe, Techman.
- **Tier B (RAG-first: sinh text + kiểm qua manual hãng, chưa có sim substrate → làm sau A):** Fanuc KAREL/TP, Mitsubishi MELFA, Delta robot, lệnh riêng Delta/Omron PLC.
- **Hệ quả kế hoạch:** P2 làm **Tier A trước** (giá trị nhanh, an toàn nhờ substrate). Tier B robot-teach (KAREL/MELFA/Delta) là hạng mục lớn nhất — dựa RAG manual + golden-code + validate cú pháp; sim/HIL cho các robot này là hạng mục hạ tầng tách riêng (ngoài phạm vi copilot, thuộc doc device-programming).

### Manual hãng cho P1 — nguồn tải
Tôi **không có nguồn tải nội bộ** các PDF manual hãng (và hệ air-gap nên bạn tự tải từ cổng chính hãng là đúng quy trình). Bạn tải về, đặt vào `D:\SOURCES\AI Local\manuals\<hãng>\` — pipeline ingestion P1 sẽ xử lý mọi thứ trong thư mục đó (PDF + OCR trang scan + chunk + metadata). **Danh sách cần (ưu tiên):**
- **Mitsubishi:** MELSEC iQ-R/FX programming (lệnh), GX Works3, MELSERVO error codes, MELFA (RT ToolBox / MELFA-BASIC VI).
- **Delta:** DVP/AS programming, ASDA servo error codes, Delta robot (DIAStudio).
- **Omron:** Sysmac NX/NJ Instructions Reference (W502), servo (1S/G5) error codes.
- **Fanuc:** KAREL Reference, TP Programming, R-30iB alarm/error code list.
- **Zmotion:** ZBasic/RTBasic programming, ZMC4xx controller + command reference, PC DLL.
- **UR:** URScript manual, UR error codes (URScript thường đã đủ tài liệu công khai).
- **Chuẩn công khai:** IEC 61131-3, fieldbus (EtherCAT/PROFINET/Modbus/CANopen/OPC UA) — tôi có thể hỗ trợ gom phần công khai.

---

## §Nhật ký thực thi (2026-07-05)

> Thực thi bằng 6 agent chuyên môn (2 wave, file rời nhau, cấm git, tự type-check). Toàn bộ **tsc union = exit 0**. Flag mặc định OFF (`.env`/`.env.example` đã thêm khối doc-34). CHƯA commit.

### P0 — Serving keystone (BUILT & GREEN)
- **Router code/fim tier** (`server/services/aiModelRouter.ts`, `aiGgufEngine.ts`): thêm task `code`/`fim` + resolver `codeModelBasename()`/`fimModelBasename()` + `generateFim()` (FIM template khi model hỗ trợ, else prefix-completion fallback). Flag `AI_CODE_ROUTER_ENABLED` OFF → byte-identical. Test 8/8 + regression 13/13.
- **Cổng OpenAI** (`server/routes/openaiGateway.ts`, đăng ký trong `server/_core/index.ts`): `GET /v1/models`, `POST /v1/chat/completions` (+SSE), `POST /v1/completions` (FIM prefix/suffix), `POST /v1/embeddings`. Bearer-auth `timingSafeEqual`, fail-closed, gated `OPENAI_GATEWAY_ENABLED`. Test 13/13.
- **Benchmark harness** (`scripts/ai-bench/bench.mjs` + README, npm `ai:bench`): tok/s prefill/decode + load + VRAM; selfcheck PASS (RTX 5090, node-llama-cpp 3.19.0, CUDA 13.3).

### P1 — Tri thức lập trình (BUILT & GREEN + DATA)
- **Ingestion** (`scripts/ai-kb/ingest-manuals.mjs`): pdf-parse v2 (per-page thật) + chunk theo cấu trúc + metadata {vendor/docTitle/page/lang/section}. **Đã chạy full: 37 manual → 91.678 chunk** (delta 29.440, mitsubishi 26.361, omron 17.511, fanuc 11.735, zmotion 4.164, universal-robots 2.467) → `knowledge/programming/<vendor>/chunks.jsonl` + manifest.
- **Retrieval service** (`server/services/aiProgrammingKnowledgeService.ts` + `server/routers/aiProgrammingKbRouter.ts`): brute-force cosine+keyword, lọc vendor/lang, rerank (bge), citation kèm **trang**; gated `PROG_KB_ENABLED`; degrade keyword-only khi thiếu embeddings. Test 8/8. (pgvector để seam `PROG_KB_PGVECTOR`, chưa bật.)
- **Golden-code** (`knowledge/golden-code/`, 28 file): 11 ví dụ Tier-A **validate thật qua `programmingAdapter.validate()` 10/10 pass, 0 warning**; IR flow compile→URScript. Tier-B (KAREL/RAPID/MELFA/Delta-robot) = stub RAG-first.
- **Embedding** (`scripts/ai-kb/embed-programming.mjs`, GPU-forced `gpuLayers:"max"`): **XONG 91.678/91.678 (100% khớp mỗi vendor), 30,6' @ 49,9 chunk/s** → `knowledge/programming/<vendor>/embeddings.jsonl` (Qwen3-Embedding 1024-d, ~1,9GB).

### Validation runtime (2026-07-05)
- **Retrieval smoke-test PASS 5/5** (`scripts/ai-kb/smoke-prog-kb.ts`): mọi truy vấn trúng đúng manual + **số trang** — URScript `movel` (UR p.46), MELSERVO alarms (Mitsubishi J4 p.64, lọc vendor), Zmotion MOVEABS (RTBasic p.204), Omron ST timers (W502 p.693), **KAREL bằng truy vấn TIẾNG VIỆT** → Fanuc KAREL Ref p.602 (đa ngữ OK). Reranker bge-gguf active. Citation kèm vendor/docTitle/page/score.
- **Benchmark baseline** (`scripts/ai-bench/baselines/baseline-2026-07-05.json`): deep 30B-A3B decode **212–246 tok/s** (prefill 3.3–7.4k), fast 4B decode **264–276 tok/s** (prefill 6.9–12.9k), embed load 1,2s. RTX 5090.

### Runtime còn lại (tùy chọn, KHÔNG chặn)
- Gateway **live** smoke (bật `OPENAI_GATEWAY_ENABLED`+key, curl `/v1/*`) — hiện đã unit-test 13/13; chạy khi bật app.
- Tải model FIM nhỏ (Qwen2.5-Coder-1.5B) để autocomplete FIM chuẩn hơn — nay fim→4B fallback đã hoạt động.
- Minor: 1 truy vấn (MELSERVO, có vendor-filter) trả `semanticUsed=false` (rơi keyword+rerank) nhưng kết quả vẫn đúng tuyệt đối — soi lại cờ semanticUsed khi rảnh.

### P2 — LLM codegen nối substrate an toàn (BUILT & GREEN + E2E, committed sau P0/P1)
- **Copilot LLM** (`server/services/programming/aiProgrammingCopilot.ts`): template tĩnh → `generateProgram()` — prompt vai trò + golden few-shot (`goldenExamples.ts`) + PROG_KB RAG có trích dẫn → code-tier LLM (route task:"code") → **validate qua `programmingAdapter` TRƯỚC khi trả** (diagnostics lộ ra, không giấu). Modes: generate/complete/translate/review/explain. `programmingRouter.copilotGenerate`. Test 15/15.
- **Safety (paramount):** hard-refuse mã an toàn (E-stop/interlock/SIL, đa ngữ vi/en/CJK) TRƯỚC khi gọi model; display-only (không deploy/run); citations luôn kèm. Verified live.
- **9 agent-tool lập trình** (`aiLocalTools/readToolsProgramming.ts` + `writeHandlers/programmingFile.ts`): retrieve_programming_kb, lookup_error_code, syntax_check_program, compile_program, simulate_program, generate_program, calc (parser an toàn, không eval), read_project_file (giới hạn workspace), **write_project_file (HITL + confined)**. Registry auto-NL-route. Test 28/28.
- **Load-order VRAM fix (runtime, quan trọng):** node-llama-cpp phân mảnh VRAM khi model LỚN (30B 16.7GB) nạp SAU model nhỏ (embed RAG) → `warmCodeModel()` nạp 30B TRƯỚC RAG + cap `GGUF_CODE_CTX=8192`. Đây là fix cho cả app thật (RCA/chat cũng RAG-rồi-30B).
- **E2E codegen smoke 5/5** (`scripts/ai-kb/smoke-codegen.ts`, .env mặc định): Zmotion (VN) → ZBasic hợp lệ **validation.ok=TRUE** cite RTBasic p.243; ST moving-average/debounce + IR pick-place → sinh code + validate (diagnostics lộ đúng — substrate bắt lỗi first-pass, đúng thiết kế); SAFETY refuse OK. Đa ngữ VN→code.
- **Flags ON** (.env): AI_PROGRAMMING_COPILOT_ENABLED=true, PROG_KB_ENABLED=true, AI_CODE_ROUTER_ENABLED=true, PROG_CODEGEN_VALIDATE_REQUIRED=true. Gateway vẫn OFF (chờ live smoke).
- **Ghi chú chất lượng:** một số ST/IR validation.ok=false (30B-Instruct chung, chưa phải coder-model chuyên) — substrate bắt được, an toàn. Tải Qwen3-Coder-30B (D2, P4) sẽ tăng tỉ lệ hợp-lệ-first-pass.

### P3 — Trải nghiệm IDE (BUILT & GREEN, committed sau P2)
- **Gateway LIVE 5/5** (`scripts/ai-bench/smoke-gateway.ts`): /v1/models, /v1/chat/completions ("PONG"), /v1/completions (FIM), /v1/embeddings (dim=1024), 401-no-bearer. **Bắt 2 bug thật** mà unit-test (mock engine) không thấy: double `.gguf` trong `resolveModelId` + đường embeddings default → fix trong `openaiGateway.ts`. → Continue/VS Code nối thật được.
- **VS Code + Continue (D5)**: `.continue/config.json` (trỏ gateway :3000, model code/fast/fim/embed + system-prompt an toàn) + `docs/ECOSYSTEM/CONTINUE_VSCODE_SETUP.md`. Autocomplete=fim (nay fallback 4B; tải FIM model để chuẩn hơn).
- **In-app Programming Copilot**: `ProgrammingCopilotPanel.tsx` + page `/programming-copilot` + nhúng `EngineeringWorkspace` (Apply→chèn code, contextCode từ editor). Gọi `programming.copilotGenerate` → code + badge validation + citations (vendor/doc/trang) + refusal an toàn. AIHub card + nav + i18n vi/en/zh. Dependency-free (không Monaco — inline-autocomplete để Continue lo).
- **Ảnh vào chat (D8)**: attach/paste ảnh (ladder/HMI/datasheet/màn lỗi) → backend `aiLocalKnowledgeApi` gọi `describeImage` (Qwen3-VL) → augment câu hỏi → RAG/answer; SSE "🖼️ Ảnh đã đọc (VL)"; degrade text-only nếu VL offline. Cap 6MB png/jpg/webp.
- tsc union 0; locale vi/en/zh valid.

### P3b — Role `engineer` (D6) — XONG (bạn duyệt 2026-07-05, migration đã áp)
- Thêm `engineer` vào `roleEnum` (migration `0203_add_engineer_role.sql` = `ALTER TYPE roleenum ADD VALUE IF NOT EXISTS`, áp dev+test, verified 8 giá trị). 6 MUST + 9 SHOULD edit (2 `UserRole` union, 3 zod enum, `DEFAULT_ROLE_PERMISSIONS.engineer` 17 quyền: machine_monitoring/machine_control/settings_* CVE + view analytics/history/reports/andon/interlock/mes_bom, `listRoleTypes` card, RoleManagement icon/màu crash-guard, aiRole+aiChat persona map, AGENTIC_ROLES, escalation ×2, roleLanding→/engineering-home, i18n roles.engineer vi/en/zh). tsc 0, permissions test 10/10, auth smoke pass.
- **Quyết định auth để mở (khuyến nghị bạn chốt):** engineer có `machine_control` (execute OT qua HITL) nhưng **KHÔNG** nằm trong `PRIVILEGED_ROLES` (chưa bắt buộc 2FA — như maintenance). Nếu muốn siết theo IEC 62443, thêm `engineer` vào `PRIVILEGED_ROLES` (server/_core/trpc.ts). canExport/canDelete=false (least-privilege).

### P4 — Eval + hardening (BUILT & GREEN, baseline đo được)
- **Eval harness** (`scripts/ai-eval/`): codegen 29 case (7 kind Tier-A + 4 safety) qua oracle `programmingAdapter.validate` + RAG 15 case precision@k. Report JSON `scripts/ai-eval/reports/{codegen,rag}-baseline-2026-07-05.json`.
- **RAG baseline (xuất sắc):** OVERALL **hit@k 15/15, precision@k 0.97, semantic 100%, cites 5.0/query**, mọi vendor trúng manual+trang. delta 2/2 + mitsubishi 2/2 sem=true (sau khi vá bug JSONL).
- **Codegen baseline (30B-Instruct):** codeProduced **100%**, validPass **60%**, safety-refuse **4/4**, false-refuse **0/25**, ~65s/case. **Lưỡng cực:** text/tabular cao (Zmotion 4/4, Techman 3/3, MELSEC 3/4, LD 3/4, ST ~2-3/4) nhưng **JSON có cấu trúc = 0%** (POU 0/3, IR 0/3 — LLM sinh JSON lệch schema, **substrate bắt 100%, không lọt cái sai nào**).
- **BUG P1 vá (harness phát hiện):** `aiProgrammingKnowledgeService.parseJsonlLines` dùng `readFileSync(utf8)` → **throw >512MB** → delta(639MB)+mitsubishi(573MB) âm thầm rơi keyword-only dù có embeddings. Sửa: đọc Buffer + cắt theo dòng (an toàn UTF-8, ≤~2GB). → semantic 2 corpus lớn nhất khôi phục (verified sem=true).
- **Engine load-order hardening:** thêm primitive tái dùng `aiGgufEngine.warmModel()` (vá tổng quát fragmentation nạp-model-lớn-sau-nhỏ, ảnh cả ops-AI); copilot refactor dùng nó. tsc 0, copilot test 15/15.

### P4b — Đã duyệt & thực thi 2026-07-05 (4 mục)
- **(1b) GBNF cho POU/IR** (`codegenSchemas.ts` + `generateJSON` trong copilot, schema mirror zod thật, fallback free-text): **IR-flow 0/3 → 3/3 ✅** (hết trailing-text, JSON sạch valid). **POU vẫn 0/3** — node-llama-cpp GBNF **không enforce `minItems`** nên LLM ra `"pous":[]` rỗng + nhét nội dung ra top-level. **Chấp nhận được:** POU (LAD/FBD/SFC đồ họa) vốn soạn ở **PouStudio** chứ không viết tay JSON; copilot mạnh ở text-lang + IR. Substrate bắt POU sai đúng như thiết kế. **Overall validPass 60% → 68%**, safety 4/4.
- **(2) engineer + 2FA:** thêm `engineer` vào `PRIVILEGED_ROLES` (trpc.ts) — IEC 62443 CL2, engineer giữ machine_control nên bắt buộc 2FA.
- **(3) FIM model + native infill (XONG):** tải **Qwen2.5-Coder-1.5B-Instruct-Q4_K_M** (986MB) → `GGUF_FIM_MODEL` set. `generateFim` viết lại dùng **native infill** (`LlamaCompletion.generateInfillCompletion`, KHÔNG chat template) + fallback chat-wrap khi lỗi. **Verified:** output là **code infill sạch** (`rolling_sum := rolling_sum + sample;` …) chứ không phải chat → autocomplete Continue chuẩn thật.
- **(F3) Ops-path warmModel (một phần):** áp `warmModel(deep)` vào **RCA copilot** (`aiRcaCopilot.runRca` — warm 30B TRƯỚC gatherEvidence/RAG) để né cold-start load-order OOM. RCA test 9/9. Ops **chat** hoãn (nhạy latency, cần warm theo-route; bug chỉ cắn cold-start-30B-first, hiếm + degrade an toàn).
- **(4) Gateway go-live:** `OPENAI_GATEWAY_ENABLED=true` + `OPENAI_GATEWAY_API_KEY` set → VS Code+Continue nối được ngay. **Ops-path warmModel HOÃN** (sửa ops chat/RCA cần test app chạy; primitive `warmModel` đã sẵn).

### Còn lại (tùy chọn)
- **POU JSON validity:** nếu muốn copilot sinh POU tốt (ngoài PouStudio) → (a) tải Qwen3-Coder-30B (~17GB) hoặc (b) đổi schema POU sang "single-POU + wrap trong code" (né giới hạn minItems của GBNF). Khuyến nghị: để POU cho PouStudio, không cần thêm.
- **QLoRA** (D9 hoãn). **Ops-path warmModel** (cần app test). **Verify FIM model load** trên engine (fallback 4B nếu lỗi).

### CHƯA làm (chờ duyệt)
- **QLoRA→GGUF** (D9 = HOÃN tới khi prompt+RAG tới hạn; baseline cho thấy RAG+prompt đã tốt cho text, structured cần GBNF trước LoRA).
- **FIM model** (Qwen2.5-Coder-1.5B) cho autocomplete Continue chuẩn hơn (nay fallback 4B).
- **engineer ∈ PRIVILEGED_ROLES (2FA)** — quyết định auth (§P3b).
- **Ops-path warmModel:** áp `warmModel()` vào ops chat/RCA (RAG-rồi-30B) — cần test app chạy.
- Gateway go-live: bật `OPENAI_GATEWAY_ENABLED`+key.

---

## Phụ lục A — Model & flag đề xuất thêm

**Model ứng viên:** Qwen3-Coder-30B-A3B-Instruct (Q4_K_XL, MoE ~17GB, chạy trên b8770), Qwen2.5-Coder-1.5B/3B-FIM (autocomplete ~1–2GB). bge-reranker-v2-m3 (đã có) bật cho corpus code.

**Flag mới (mặc định OFF):** `GGUF_CODE_MODEL`, `GGUF_FIM_MODEL`, `AI_CODE_ROUTER_ENABLED`, `OPENAI_GATEWAY_ENABLED`, `OPENAI_GATEWAY_PORT`, `OPENAI_GATEWAY_API_KEY`, `LLAMA_CODER_BIN/PORT/CTX`, `KB_PGVECTOR_ENABLED`(=true cho corpus code), `PROG_KB_COLLECTIONS`, `AI_PROGRAMMING_COPILOT_ENABLED`(=true khi P2 xong), `PROG_CODEGEN_VALIDATE_REQUIRED`(=true), `AI_CODE_FUNCTION_CALLING_ENABLED`, `AI_LLM_FINETUNE_ENABLED`(=false).

## Phụ lục B — File touchpoint chính (để agent thực thi định vị)
- Engine/Router/Gateway: `server/services/aiGgufEngine.ts`, `aiModelRouter.ts`, `llamaVisionSidecar.ts`, mới `server/routes/openaiGateway.ts`, mới `scripts/ai-bench/*`.
- RAG: `server/services/aiLocalKnowledgeService.ts`, `kb/kbVectorStore.ts`, `aiReranker.ts`, mới `scripts/ai-kb/ingest-manuals.mjs`, `knowledge/golden-code/*`.
- Codegen/substrate: `server/services/programming/aiProgrammingCopilot.ts`, `programmingAdapter.ts`, `ir/*`, `iec61131/*`, `server/routers/programmingRouter.ts`, `irRouter.ts`.
- Agent/tools: `server/services/aiLocalTools/*` (tool mới), `aiCopilotActions.ts` (tái dùng HITL).
- UX/IDE: `client/src/components/engineering/CodeEditor.tsx`(→Monaco), `pages/{EngineeringWorkspace,IrEditor,PouStudio}.tsx`, `components/AILocalChatBubble.tsx`(ảnh), `.continue/*`, `client/src/lib/aiRole.ts`, `drizzle/schema/enums.ts`(role).
- Eval/MLOps: mới `aiCodeEvalHarness.ts`, `localSidecarTrainer.ts`(+task llm-sft), registry `drizzle/schema/ai.ts`(cột LLM), `aiMetrics.ts`, `docs/observability/*`.

---

*— Hết doc 34. Chờ duyệt §VI trước khi dispatch agent thực thi. —*
