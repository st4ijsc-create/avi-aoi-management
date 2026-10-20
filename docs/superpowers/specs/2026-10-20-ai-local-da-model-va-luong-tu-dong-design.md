# Thiết kế: Đa model hoán đổi theo tác vụ + Luồng tự động hoá AI (kiểu n8n) trên AI Local

Ngày: 2026-10-20 · Trạng thái: **ĐÃ DUYỆT (D1–D5, 2026-10-20) · pha 7.0 + 7.1 + 7.2 XONG** · Phạm vi: AI Local (uỷ quyền 2026-10-14)

Đầu vào:
- Hiện trạng repo (khảo sát 2026-10-20 trên `feat/ai-local-L7-hang-rao` và worktree `_ai7_wt` / `feat/ai-local-7-tang`).
- Kế hoạch 7 tầng `docs/superpowers/plans/2026-10-14-ai-local-hoan-thien-7-tang.md` (Q1–Q6 đã trả lời).
- Tiêu chí chủ dự án: **đúng hơn nhanh**; **giữ 1 llama-server × 64k** (Q5); offline là ràng buộc cứng.
- Tham khảo ngoài: n8n, llama.cpp router mode, llama-swap, LiteLLM, semantic-router, LangGraph, Temporal,
  Activepieces, Node-RED, LLM4PLC / Agents4PLC / AutoPLC / SemaPLC (nguồn ở §9).

---

## 0. Tóm tắt điều hành

| Bài toán | Quyết định đề xuất | Lý do chính |
|---|---|---|
| **B1. Nhiều model local, đổi theo tác vụ** | Thêm lớp **Sổ model (Model Registry) + Vai trò (Role) + Bộ định tuyến vai trò + Bộ giám sát model (Model Supervisor)** lên trên `modelResolver` / `aiModelRouter` / `doiModelLlamaServer` sẵn có. Một **khe nặng** hoán đổi (Qwen ↔ DeepSeek ↔ …), các model nhỏ **thường trú**. | 32 GB không chứa nổi hai model 30B‑MoE kèm KV 64k; Q5 đã chốt một server. Hạ tầng đổi model + kiểm `/props` + rollback + watchdog + hàng đợi ưu tiên **đã có** ở nhánh ai7 — thiếu là *sổ* và *chính sách*, không thiếu cơ chế. |
| **B2. Luồng tự động hoá AI kiểu n8n** | Xây **"Luồng AI" (AI Flow) trong nhà**, tái dùng khối thuần của FOE (DAG, biểu thức an toàn, event‑sourcing, cổng HITL, canvas xyflow) + lõi agent `shared/agentCore`. **Không nhúng n8n.** | Giấy phép n8n (Sustainable Use License) cấm phân phối/nhúng thương mại. Activepieces (MIT) nhúng được nhưng mang theo hệ auth/RBAC/audit riêng và không biết hàng rào L‑7. FOE đã có 70 % bộ xương. |
| **Kết hợp** | Mọi node AI của Luồng gọi **vai trò** (`code.plc`, `extract`…) chứ không gọi tên model; Luồng đi qua cùng Cổng AI (`planInference` / `/v1`), cùng hàng rào an toàn, cùng VRAM broker. | Một nơi chọn model, một nơi giữ an toàn, một nơi đo. |

Chọn model cho từng vai trò **là kết quả đo**, không phải giả định. Ví dụ "DeepSeek viết PLC tốt hơn Qwen" **chưa có
nguồn công bố nào kiểm chứng** (§9.4) ⇒ thiết kế bắt buộc có bộ đo PLC (biên dịch + chạy mô phỏng) trước khi gán.

---

## 1. Hiện trạng liên quan (đo 2026-10-20)

### 1.1 Model và phục vụ
| Thành phần | Thực tế |
|---|---|
| Server văn bản | **Một** llama-server :8091, 1 slot × 65536 ctx, `--reasoning-budget 12000`, model `Qwen3.6-35B-A3B-UD-Q4_K_XL`; dựng bởi `scripts/ai/start-llama-server.ps1` (Task Scheduler) |
| Chọn tên model | `server/services/ai/modelResolver.ts` — `resolveTaskModel(fast/default/thinking/code/fim)`, `resolveLogicalModel(...)`; nguồn là khoá `.env` |
| Định tuyến | `server/services/aiModelRouter.ts` `route()` — `TaskKind` cố định (`chat/intent/extract/rca/report/vision/embed/code/fim`) → Tier 1–4; **không có sổ model** |
| Đổi model [ai7] | `doiModelLlamaServer.ts` (admin + 2FA, kiểm trước bằng header GGUF, khởi động lại, kiểm `/props`, sinh thử, rollback); lựa chọn bền ở `%LOCALAPPDATA%\avi-aoi-ai\llama-server-lua-chon.json` phủ 3 khoá `.env` |
| Giám sát [ai7] | `giamSatLlamaServer.ts` (watchdog, phục hồi ~31 s), `hangDoiUuTienLlm.ts` (người > agent > nền) |
| Trong tiến trình | `aiGgufEngine.ts` (node-llama-cpp): Qwen3-4B (fast/planner), FIM 1.5B, embed Qwen3-Embedding-0.6B, reranker bge-m3 |
| Sidecar | thị giác :8081 (Qwen3-VL-8B, tự tắt sau 10 phút rảnh); OCR VietOCR/Paddle (ONNX trong tiến trình) |
| VRAM broker | `server/services/vram/*` — sổ thuê, ưu tiên `production/interactive/background`, preempt. **Lỗ:** :8091 **không** được broker nhận nuôi ⇒ không preempt được |
| Cổng OpenAI | `server/routes/openaiGateway.ts` `/v1/models`, `/chat/completions` (tools, stream), `/completions` (FIM), `/embeddings` — đang bật |
| Gọi LLM | **Nhiều đường**: engine trực tiếp (~17 import tĩnh + ~34 import động), `aiProviderRouter`, `_core/llm.ts invokeLLM`, `aiGateway.planInference/routeInference` |

### 1.2 Tự động hoá
| Thành phần | Thực tế |
|---|---|
| FOE (`orchestration/foe/*`) | Workflow JSON, bước `command/sequence/parallel/branch/wait_state/wait_telemetry/hitl_gate/delay`, biểu thức an toàn (không `eval`), bù trừ, phiên bản, triển khai cần TOTP; canvas `WorkflowGraphCanvas.tsx` (@xyflow/react 12) — **chỉ có bước điều khiển thiết bị**, không có node AI/HTTP/trigger |
| Lịch | 12 bộ lập lịch node-cron, chạy ở app hoặc `ROLE=worker`, **không bầu chủ** (hai tiến trình ⇒ chạy đôi) |
| Hàng đợi | `aiJobQueue.ts` trong bộ nhớ, đồng thời 1 (mất khi khởi động lại) |
| Agent | `shared/agentCore/vongAgent.ts` [ai7] (vòng tool‑calling gốc, duyệt tạm dừng/tiếp tục, checkpoint), `ai_agent_runs` (mig 0390) |
| An toàn | `ot/aiControlGate.ts` (L‑7, theo hướng năng lượng, fail‑closed, `AI_OT_CONTROL_ENABLED` tắt); `aiCopilotActions` propose/confirm + `ai_pending_actions`; `autonomyPolicy`; `aiSafety` (tiêm lệnh, che PII); `audit_logs`, `ai_llm_audit` |
| MCP | `aiCodingCli/mcpServer.ts` (stdio, viết tay); extension có MCP client |

### 1.3 Hệ quả cho thiết kế
1. **Không cần dựng lại cơ chế đổi model** — cần *sổ*, *vai trò*, *chính sách hoán đổi*, và đưa :8091 vào broker.
2. **Không cần engine luồng mới từ số 0** — cần tách lõi thuần của FOE thành thư viện chung, thêm danh mục node, trigger, hàng đợi bền.
3. Gọi LLM đang tản mát ⇒ mọi đường mới **bắt buộc** đi qua Cổng AI; các đường cũ dồn dần (có census).

---

## 2. Kiến trúc tổng thể

```
┌─────────────────────────────── BỀ MẶT ────────────────────────────────────────────┐
│ Web (Copilot, Studio, Flow Studio, Trung tâm Model) · VSCode ext · CLI/MCP · App   │
│ cảnh báo di động · Webhook/MQTT/Event bus (trigger)                                │
└───────────────┬───────────────────────────────┬────────────────────────────────────┘
                │                               │
     ┌──────────▼──────────┐         ┌──────────▼───────────────┐
     │ LÕI AGENT           │◄───────►│ ĐỘNG CƠ LUỒNG AI (mới)   │  node "AI Agent" = agentCore
     │ shared/agentCore    │  tool = │ server/services/flow/*   │  agent gọi sub-flow làm tool
     └──────────┬──────────┘ sub-flow└──────────┬───────────────┘
                │      gọi theo VAI TRÒ (role) │
     ┌──────────▼──────────────────────────────▼───────────────┐
     │ CỔNG AI  (aiGateway.planInference · /v1 openaiGateway)  │  hạn mức · che PII · audit · số đo
     └──────────┬──────────────────────────────────────────────┘
     ┌──────────▼──────────────────────────────────────────────┐
     │ BỘ ĐỊNH TUYẾN VAI TRÒ (mới)  role → binding → profile   │  tường minh > dự án > tín hiệu > ngữ nghĩa
     └──────────┬──────────────────────────────────────────────┘
     ┌──────────▼──────────────────────────────────────────────┐
     │ BỘ GIÁM SÁT MODEL (mới, bọc doiModelLlamaServer)        │  khe NẶNG hoán đổi · khe NHỎ thường trú
     │ hàng đợi theo ái lực model · chống đập · /props verify  │
     └──────────┬──────────────────────────────────────────────┘
     ┌──────────▼──────────────────────────────────────────────┐
     │ VRAM BROKER (có sẵn) — nhận nuôi :8091 (vá lỗ)          │
     └───┬───────────────┬──────────────────┬──────────────────┘
   llama-server :8091   node-llama-cpp      sidecar thị giác :8081 · ONNX OCR
   (khe nặng, 1×64k)    (4B, FIM, embed,    
                         reranker)
───────────── XUYÊN SUỐT: An toàn (aiSafety · L‑7 · HITL · RBAC · audit) · Tri thức (pgvector KB) ·
              Đo/Studio (bộ đo theo vai trò, cổng chặn khi tụt) · Quan sát (run timeline, token, model) ─────────
```

Nguyên tắc:
1. **Gọi vai trò, không gọi tên model.** Tên file GGUF chỉ xuất hiện trong Sổ model.
2. **Một chủ vòng đời tiến trình.** Chỉ Bộ giám sát model được khởi động/dừng llama-server (không thêm llama-swap
   song song — tránh lớp lỗi "hai người giữ cổng").
3. **Chữ của model không bao giờ tự thành hành động có tác dụng phụ** (bài học Đợt 1: tool call trong
   `reasoning_content` bị bác 3 lần). Tác dụng phụ đi qua node/tool có kiểu + cổng duyệt.
4. **Đổi gán vai trò = sự kiện có cổng đo**, như đổi mã.

---

## 3. Bài toán 1 — Đa model hoán đổi theo tác vụ

### 3.1 Khái niệm

| Khái niệm | Nghĩa | Ví dụ |
|---|---|---|
| **Artifact** | Một file model trên đĩa + siêu dữ liệu đo được | `Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf`, 35B/3B active, giấy phép Apache‑2.0, VRAM trọng số ước lượng từ header |
| **Hồ sơ phục vụ (Serving profile)** | Artifact + cách chạy | ctx 65536, `-fa on`, KV f16, reasoning budget 12000, sampling, chat template, có/không nghĩ |
| **Vai trò (Role)** | Tên logic của một loại việc | `code.software`, `code.plc`, `chat.ops`, `extract`, `classify`, `summarize`, `vision`, `embed`, `rerank`, `fim` |
| **Gán (Binding)** | Vai trò → hồ sơ, theo phạm vi, kèm chuỗi dự phòng | `code.plc` → `deepseek-coder-v2-lite@ctx32k` (dự án PLC‑A) · mặc định → `qwen3.6-35b@64k` |
| **Lớp khe (Slot class)** | Nơi hồ sơ được nạp | `nang` (llama-server :8091, độc quyền, hoán đổi) · `nho` (trong tiến trình, thường trú) · `sidecar` (thị giác) |

Vai trò cũ ánh xạ thẳng: `fast→extract/classify/chat.ops`, `default→chat`, `code→code.software`, `fim→fim`,
`vision→vision`, `embed→embed`. `TaskKind` của `aiModelRouter` giữ nguyên làm lớp tương thích.

### 3.2 Ngân sách VRAM (RTX 5090, 32 GB) và hệ quả

| Khối | Ước lượng | Ghi chú |
|---|---:|---|
| Khe nặng: model 30–35B MoE Q4 + KV 64k f16 | ~22–28 GB | Qwen3-Coder-30B Q4_K_M ≈ 18,7 GB trọng số (nguồn thứ cấp); **đo lại bằng ước lượng header + `nvidia-smi` thực** |
| Khe nhỏ thường trú: 4B + FIM 1,5B + embed 0,6B + reranker | ~4–6 GB | Đã chạy trong tiến trình |
| Sidecar thị giác Qwen3-VL-8B | ~7,8 GB | Chỉ khi cần; broker preempt được |

⇒ **Hai model 30B‑class không thể cùng thường trú** với KV hữu dụng. Phương án đã cân nhắc:

| Phương án | Đánh giá |
|---|---|
| A. **Một khe nặng hoán đổi theo hàng đợi ái lực** (đề xuất) | Khớp Q5; tận dụng `doiModelLlamaServer`; chi phí ~13–43 s mỗi lần đổi (đo Đợt 6, 2026-10-17) ⇒ cần chính sách chống đập |
| B. Model thứ hai nhỏ (DeepSeek-Coder-V2-Lite 16B/2,4B active ≈ 9–10 GB Q4) thường trú bên cạnh | Phá Q5 (thêm server) và lấy VRAM của KV 64k — chỉ xét lại nếu đo cho thấy đổi khe quá thường xuyên |
| C. llama.cpp **router mode** (`--models-dir`, `--models-max 1`, chọn theo trường `model`) | Hấp dẫn về lâu dài (mỗi model một tiến trình con, chuẩn upstream), nhưng giao diện INI còn đổi và endpoint load/unload chưa kiểm được ⇒ đặt **sau giao diện `BoPhucVu`** để thay được, không phụ thuộc ngay |
| D. llama-swap / LiteLLM / Ollama làm tầng proxy | Thêm một chủ vòng đời tiến trình thứ hai, không biết VRAM broker, không biết ưu tiên người > nền ⇒ **không dùng**; giữ ý tưởng của llama-swap (nhóm, TTL, preload) vào Bộ giám sát |

### 3.3 Sổ model — lược đồ dữ liệu

Dải migration AI Local 0390–0399 gần hết (đã dùng tới 0398) ⇒ **cần thoả thuận dải mới, đề xuất 0400–0419**.

```sql
-- 0400_ai_model_registry.sql  (hàm/trigger nếu có: SET search_path = pg_catalog, public, pg_temp)
CREATE TABLE public.ai_model_artifacts (
  id              text PRIMARY KEY,            -- 'qwen3.6-35b-a3b-q4kxl'
  file_path       text NOT NULL,               -- tương đối GGUF_MODELS_DIR
  sha256          text,                        -- kiểm toàn vẹn khi nạp
  family          text NOT NULL,               -- qwen3.6 | deepseek-coder-v2 | ...
  params_total_b  numeric, params_active_b numeric,
  quant           text, ctx_native int,
  license         text NOT NULL,               -- bắt buộc; 'unknown' ⇒ cấm gán production
  vram_weights_mb int,                         -- từ header GGUF
  modalities      text[] NOT NULL DEFAULT '{text}',
  status          text NOT NULL DEFAULT 'available',  -- available|missing|quarantined
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ai_serving_profiles (
  id            text PRIMARY KEY,              -- 'qwen3.6-35b@64k-think12k'
  artifact_id   text NOT NULL REFERENCES public.ai_model_artifacts(id),
  slot_class    text NOT NULL CHECK (slot_class IN ('nang','nho','sidecar')),
  ctx           int  NOT NULL,
  server_args   jsonb NOT NULL DEFAULT '{}',   -- danh sách TRẮNG cờ: fa, ctk, ctv, reasoning_budget, n_cpu_moe, draft
  sampling      jsonb NOT NULL DEFAULT '{}',   -- temperature, top_p, top_k, min_p, presence_penalty
  thinking      text NOT NULL DEFAULT 'auto',  -- on|off|auto
  vram_est_mb   int,                           -- trọng số + KV(ctx) + dự phòng
  enabled       boolean NOT NULL DEFAULT true
);

CREATE TABLE public.ai_roles (
  id          text PRIMARY KEY,                -- 'code.plc'
  description text NOT NULL,
  eval_suite  text,                            -- bộ đo bắt buộc khi đổi gán (vd 'plc-st-v1')
  examples    text[] NOT NULL DEFAULT '{}'     -- câu mẫu cho bộ phân loại ngữ nghĩa
);

CREATE TABLE public.ai_model_bindings (
  id           bigserial PRIMARY KEY,
  role_id      text NOT NULL REFERENCES public.ai_roles(id),
  scope_kind   text NOT NULL CHECK (scope_kind IN ('global','tenant','project','flow')),
  scope_id     text,                           -- NULL khi global
  profile_id   text NOT NULL REFERENCES public.ai_serving_profiles(id),
  fallback     text[] NOT NULL DEFAULT '{}',   -- chuỗi profile dự phòng, theo thứ tự
  eval_run_id  bigint,                         -- kết quả đo cho phép gán (NULL ⇒ chỉ ở chế độ 'thu')
  mode         text NOT NULL DEFAULT 'active' CHECK (mode IN ('active','shadow','thu')),
  created_by   text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role_id, scope_kind, scope_id, mode)
);

CREATE TABLE public.ai_model_eval_runs (        -- mỗi lượt đo một profile trên một bộ đo
  id bigserial PRIMARY KEY, profile_id text NOT NULL, suite text NOT NULL,
  n_tasks int, n_pass int, n_runs int, p50_ms int, p90_ms int,
  detail jsonb, git_sha text, created_at timestamptz NOT NULL DEFAULT now()
);
-- Lịch sử gán: ghi vào audit_logs (action 'ai.binding.change') + giữ bản ghi cũ (không UPDATE tại chỗ).
```

**Hiện thực 7.0 khác bản phác trên ở hai điểm (mig `drizzle/0400_ai_model_registry.sql`):** (1) gán trỏ **đúng một
trong** `profileId` | `envKey` — gán seed là *theo-env* (đi theo khoá `.env` + lựa chọn quản trị của
`luaChonModelLlamaServer`), nên đổi model qua `doiModelLlamaServer` không làm sổ lệch; (2) lịch sử gán bằng `retiredAt`
(không sửa tại chỗ), UNIQUE một phần `(roleId, scopeKind, COALESCE(scopeId,''), mode) WHERE retiredAt IS NULL`.

Khởi tạo: tác vụ `dongBoSoModel` quét `GGUF_MODELS_DIR`, đọc header GGUF (đã có trong `doiModelLlamaServer`), tạo
artifact; seed vai trò + gán **khớp đúng `.env` hiện tại** ⇒ ngày đầu hành vi không đổi (bất biến kiểm bằng lưới:
`resolve(role)` mới = `resolveTaskModel(tier)` cũ cho mọi tier).

### 3.4 Bộ định tuyến vai trò

Thứ tự quyết định (dừng ở tầng đầu tiên có kết quả):

1. **Tường minh** — người chọn ở UI / node Luồng ghi `role` / tham số `model` của `/v1` là tên vai trò hoặc bí danh.
2. **Phạm vi** — gán `flow` > `project` > `tenant` > `global`.
3. **Tín hiệu tất định** — loại dự án (`plc`, `dotnet`, `web`), đuôi tệp đang mở (`.st .scl .awl .il .xml(PLCopen)` ⇒
   `code.plc`), ngôn ngữ trong khối mã. Rẻ, giải thích được, kiểm được bằng lưới.
4. **Phân loại ngữ nghĩa** (kiểu *semantic-router*) — nhúng câu bằng Qwen3-Embedding đã thường trú, so với
   `ai_roles.examples`, **ngưỡng tin cậy**; dưới ngưỡng ⇒ vai trò mặc định của bề mặt. **Không dùng LLM để chọn LLM**
   trên đường nóng.
5. Kết quả kèm **lý do** (`{role, tang: 'tin-hieu', bang_chung: 'duoi .st'}`) ghi vào `ai_llm_audit` và hiện ở UI
   ("Đang dùng: DeepSeek‑Coder · vì dự án PLC").

Bổ sung vào hợp đồng hiện có (không phá):

```ts
// shared/aiRoles.ts
export type VaiTro = 'chat' | 'chat.ops' | 'code.software' | 'code.plc' | 'extract' | 'classify'
  | 'summarize' | 'vision' | 'embed' | 'rerank' | 'fim' | (string & {});
export interface YeuCauDinhTuyen {
  vaiTro?: VaiTro;                 // tầng 1
  phamVi?: { tenantId?: string; projectId?: string; flowId?: string };
  tinHieu?: { loaiDuAn?: string; duoiTep?: string; ngonNgu?: string };
  cauHoi?: string;                 // cho tầng 4
  uuTien: 'interactive' | 'agent' | 'background';
}
export interface KetQuaDinhTuyen {
  vaiTro: VaiTro; profileId: string; slotClass: 'nang' | 'nho' | 'sidecar';
  duPhong: string[]; lyDo: { tang: 1|2|3|4|5; bangChung: string };
  canDoiKhe: boolean;              // true ⇒ khe nặng phải nạp profile khác
}
```

`/v1/models` liệt kê **vai trò + bí danh** (vd `code.plc`, `qwen-coder`, `deepseek-plc`) để extension VSCode, CLI và
công cụ ngoài chọn theo tên ổn định.

### 3.5 Bộ giám sát model (Model Supervisor)

Bọc `doiModelLlamaServer` + `giamSatLlamaServer` + `hangDoiUuTienLlm`, thêm:

**a) Giao diện thay được**
```ts
interface BoPhucVu {             // hiện thực 1: PowerShell start-llama-server (có sẵn)
  napProfile(p: ServingProfile, signal: AbortSignal): Promise<void>;   // hiện thực 2 (sau): llama.cpp router mode
  profileDangNap(): Promise<string | null>;                            // đọc /props, không tin sổ
  sucKhoe(): Promise<'ok' | 'loading' | 'down'>;
}
```

**b) Hàng đợi theo ái lực** — mỗi yêu cầu khe nặng mang `profileId`. Bộ lập lịch:
- phục vụ hết yêu cầu khớp profile đang nạp trước (trong giới hạn công bằng);
- chỉ đổi khe khi: hàng đợi profile khác có yêu cầu **interactive**, hoặc yêu cầu nền chờ quá `T_cho_toi_da`
  (mặc định 10 phút), hoặc profile hiện tại rảnh quá `T_ranh` (mặc định 2 phút);
- **thời gian lưu trú tối thiểu** `T_luu_tru` (mặc định 60 s) sau mỗi lần đổi — chống đập;
- yêu cầu interactive phải chờ đổi khe ⇒ UI hiện trạng thái thật ("Đang nạp DeepSeek‑Coder ~30 s, xếp thứ 1"),
  không im lặng.
- Luồng nền khai báo `affinity` ⇒ có thể **gom theo lô** (vd chạy mọi bước `code.plc` của lô đêm liên tiếp).

**c) Nhận nuôi :8091 vào VRAM broker** (vá lỗ đã biết): lease `external-process`, ưu tiên `interactive`, ước lượng từ
`vram_est_mb`; trước khi nạp profile lớn hơn ⇒ `reserve()` → broker preempt sidecar thị giác/khe nhỏ rảnh theo luật
đang có.

**d) Kiểm sau nạp**: `/props` khớp artifact + ctx; sinh thử 1 câu cố định; sai ⇒ rollback về profile trước (cơ chế
có sẵn). Lựa chọn bền tiếp tục ở tệp `%LOCALAPPDATA%` (dùng chung worktree) nhưng **nguồn sự thật là DB**, tệp chỉ là
bộ đệm khởi động khi DB chưa lên.

**e) Dự phòng**: profile chính không nạp được / OOM ⇒ thử `fallback[]`; hết ⇒ **fail-closed có thông báo** (không lùi
im lặng về in‑process — luật Đợt 0).

**Hiện thực 7.1 (2026-10-20) — ba điều chỉnh có lý do** (kế hoạch `docs/superpowers/plans/2026-10-20-ai-local-dot7-pha1-khe-nang.md`):
1. **Không nhận nuôi :8091 làm hộ preempt được.** Giấy phép preempt cho :8091 nghĩa là broker có đường GIẾT chính model
   đang phục vụ để lấy chỗ cho một lượt nạp in-process — đúng thứ G1-D cấm (lưới `aiLlamaServerClient.napTrung.test.ts`
   giữ nguyên "không có đường giết :8091"). Thay bằng: lượt đổi thiếu VRAM ⇒ `DieuPhoiDoiModel` nhờ broker
   `preempt("interactive", phần thiếu)` thu hồi hộ KHÁC (sidecar thị giác, model nhỏ rảnh) rồi kiểm lại một lần.
2. **Đổi TẠM** (`batDau(…, { ben:false })`): không ghi lựa chọn bền, không phủ env ⇒ model "nhà" giữ nguyên nghĩa; quay
   về / khởi động lại / bộ giám sát dựng lại đều về nhà.
3. **Chỉ tiến trình API tự đổi khe** (`batTuDoiKheNang()` ở `server/_core/index.ts`): `giuCong` chỉ thấy cổng của chính
   tiến trình — đổi từ worker có thể giết lượt đang chạy của API. Worker xin model khác ⇒ `KHE_NANG_TAT` nói thật.
Tập khe nặng H = {nhà} ∪ {artifact hồ sơ `nang` bật + có tệp} (`soModel/tapKheNang.ts`); `laModelServerDangGiu(M)` =
M ∈ H — MỘT vị từ cho đường đi qua server và đường cấm nạp trong tiến trình. Sổ không có hồ sơ `nang` ⇒ đi tắt.

### 3.6 Đổi gán vai trò có cổng đo

```
Đề xuất gán mới (mode 'thu') ──► chạy bộ đo vai trò (≥3 lượt, H & M) ──► so với gán hiện tại
        │                                                               │
        │      không kém hơn ngoài nhiễu (±3 bài)  ◄────────────────────┘
        ▼
  'shadow' (tuỳ chọn: chạy song song trên lưu lượng thật, không trả kết quả) ──► 'active' (admin + 2FA, audit)
```

Bộ đo theo vai trò (tái dùng `scripts/ai-eval/*`):

| Vai trò | Bộ đo | Chấm |
|---|---|---|
| `code.software` | H 12×3, ngẫu nhiên 72 bài, F nhiều tệp | biên dịch + test do máy chạy |
| `code.plc` | **mới `plc-st-v1`** (§3.7) | biên dịch ST + chạy mô phỏng theo vector + (tuỳ) kiểm mô hình |
| `extract` / `classify` | bộ vàng KB 111 câu, tập nhãn thật | khớp schema + khớp nhãn |
| `chat.ops` | 79 câu có tài liệu + 32 ngoài lề | đúng/sai + từ chối đúng |
| `vision` | ảnh lỗi AOI có nhãn | khớp lớp lỗi |

Bảng kết quả **xếp theo độ đúng trước, tốc độ sau** (tiêu chí chủ dự án); model chậm không bị loại vì chậm.

### 3.7 Vai trò `code.plc` — làm cho đúng, không chỉ đổi model

Nghiên cứu (§9.4) nhất quán ở một điểm: **vòng kiểm bên ngoài quan trọng hơn chọn model**. LLM4PLC 47→72 % nhờ vòng
biên dịch + model checking; SemaPLC cho thấy kiểm tĩnh là tín hiệu yếu (các phương pháp chênh < 10 điểm), chạy
thật trên runtime mới phân biệt được.

Thiết kế vai trò `code.plc` = **model + bộ công cụ kiểm**:
1. Sinh ST (IEC 61131‑3) theo phương ngữ đích (CODESYS / Siemens SCL / OpenPLC) — phương ngữ là tham số dự án.
2. **Biên dịch**: MATIEC (`iec2c`, nền của OpenPLC/Beremiz) và/hoặc RuSTy (LLVM). Lỗi có cấu trúc → quay về model.
3. **Chạy mô phỏng**: nạp vào OpenPLC runtime trên bench (dự án đã chọn OpenPLC bench đầu), chạy vector vào/ra,
   so vết với logic tham chiếu.
4. (Tuỳ, Đợt sau) kiểm mô hình nuXmv cho thuộc tính an toàn (interlock không bao giờ cùng bật…).
5. Tri thức: corpus Studio miền PLC (thư viện OSCAT, tài liệu thiết bị) qua tool `tra_tai_lieu`.
6. **Không bao giờ nạp xuống PLC thật từ Luồng/agent** — đầu ra là tệp + báo cáo kiểm; tải xuống thiết bị đi qua đường
   kỹ thuật hiện có có duyệt người (L‑7 mức ≥ 4).

Ứng viên đo cho `code.plc` (chọn bằng số, không bằng danh tiếng): Qwen3.6-35B-A3B (đang chạy), Qwen3-Coder-30B (đã
trên đĩa), DeepSeek-Coder-V2-Lite-Instruct (16B/2,4B active, 128k — **kiểm điều khoản DeepSeek License cho dùng
thương mại trước khi gán active**), các bản distill suy luận nếu nạp được. Bộ `plc-st-v1` tối thiểu 24 bài (dễ/vừa/khó
theo kiểu Agents4PLC) viết **trước** khi đo, có 6 bài giữ lại không ai nhìn khi chỉnh lời nhắc.

### 3.8 Giao diện "Trung tâm Model"

Mở rộng `DoiModelLlamaServerCard` thành một màn:
- **Kho**: artifact (kích thước, giấy phép, VRAM ước lượng, trạng thái tệp, băm).
- **Hồ sơ**: tạo/sửa profile (cờ theo danh sách trắng), nút "Nạp thử".
- **Vai trò × Phạm vi**: ma trận gán, chế độ thu/shadow/active, chuỗi dự phòng, lý do định tuyến gần nhất.
- **Khe**: profile đang nạp (đọc `/props`), hàng đợi theo ái lực, số lần đổi khe/giờ, thời gian chờ p50/p90.
- **Đo**: kết quả `ai_model_eval_runs` theo vai trò, xếp theo độ đúng.
Quyền: xem = kỹ sư; đổi gán active / nạp profile = admin + 2FA (như `doiModelLlamaServer`).

---

## 4. Bài toán 2 — Động cơ Luồng AI (kiểu n8n)

### 4.1 Xây hay dùng sẵn

| Ứng viên | Giấy phép | Kết luận |
|---|---|---|
| n8n | Sustainable Use License — chỉ dùng nội bộ/phi thương mại; nhúng/bán cần giấy phép Embed | **Chỉ tham khảo thiết kế** |
| Activepieces | MIT (CE) | Nhúng được, nhưng là một ứng dụng riêng (auth, RBAC, Postgres+Redis riêng); phải nối lại audit, L‑7, VRAM, tenant ⇒ chi phí tích hợp ≥ chi phí mở rộng FOE |
| Node-RED | Apache‑2.0 | Mạnh ở OT (OPC UA, MQTT, Modbus) nhưng yếu ở luồng bền dài hạn/AI; có thể là **nguồn trigger** ngoài qua webhook/MQTT |
| Temporal | MIT | Bền tuyệt vời nhưng vận hành nặng cho một máy trạm; ý tưởng *durable execution* được mượn, không mượn hạ tầng |
| Windmill | AGPLv3 + EE | Không hợp cho phân phối |
| Dify / Flowise / Langflow | điều kiện riêng / có phần thương mại | Thiên về chatbot/RAG, không biết OT |
| **Trong nhà trên FOE + agentCore** | — | **Chọn.** Khớp RBAC/audit/L‑7/VRAM/tenant, offline, tái dùng canvas + DAG + biểu thức + event‑sourcing |

### 4.2 Bố cục mã

```
shared/flow/                    ← mới: kiểu dùng chung client/server
  model.ts                      ← FlowDefinition, NodeInstance, Connection, PortType (zod)
  bieuThuc.ts                   ← chuyển từ FOE: bộ đánh giá biểu thức an toàn (không eval)
  dag.ts                        ← chuyển từ FOE: Kahn, phát hiện chu trình
server/services/flow/
  dongCo.ts                     ← bộ thực thi: lập lịch node, items, lỗi, thử lại
  hangDoi.ts                    ← hàng đợi bền Postgres (SKIP LOCKED) + lease + heartbeat
  kichHoat/                     ← trigger: thucong, lich, webhook, suKien, mqtt, canhBao, tep, chat
  nut/                          ← danh mục node, mỗi node một tệp + khai báo
  thongTinBiMat.ts              ← kho credential mã hoá
  luuTru.ts                     ← run, step, sự kiện, dữ liệu nhị phân, cắt tỉa
  congAnToan.ts                 ← phân hạng tác dụng phụ, kiểm khi kích hoạt & khi chạy
server/routers/flowRouter.ts
client/src/pages/FlowStudio.tsx ← tái dùng WorkflowGraphCanvas (xyflow)
```

FOE giữ nguyên làm **miền OT** (điều khiển thiết bị có bù trừ, TOTP). Luồng AI gọi FOE qua node `ot.deXuatLuong`
(§4.6), không gọi `commandDispatcher` trực tiếp. Hai bên dùng chung `shared/flow/{bieuThuc,dag}` — FOE import lại
từ chỗ mới (một lần chuyển, lưới FOE phải xanh nguyên).

### 4.3 Mô hình dữ liệu Luồng

Học từ n8n nhưng sửa hai điểm yếu đã biết: nối theo **id** (n8n nối theo *tên* node ⇒ đổi tên vỡ nối), và **khai báo
tác dụng phụ** trên mỗi node.

```ts
// shared/flow/model.ts (rút gọn)
export interface FlowDefinition {
  id: string; name: string; version: number;      // bất biến theo phiên bản
  nodes: NodeInstance[];
  connections: Connection[];                      // {from:{node,port,index}, to:{node,port,index}}
  settings: {
    errorFlowId?: string;                         // luồng xử lý lỗi (kiểu Error Trigger của n8n)
    timeoutS?: number; maxConcurrentRuns?: number;
    uuTien: 'interactive' | 'agent' | 'background';
    affinity?: string[];                          // vai trò model muốn gom lô
    luuDuLieu: 'day-du' | 'chi-loi' | 'khong';    // giữ input/output từng node
  };
  pinData?: Record<string, Item[]>;               // dữ liệu ghim để thử, không dùng khi chạy thật
}
export interface NodeInstance {
  id: string; type: string; typeVersion: number;  // 'ai.llm' v1
  name: string; position: [number, number];
  parameters: Record<string, unknown>;            // giá trị có thể là biểu thức {{ ... }}
  credentialRef?: string;                         // chỉ id, không bao giờ giá trị
  retry?: { max: number; backoffMs: number }; khiLoi?: 'dung' | 'tiep-tuc' | 'nhanh-loi';
  disabled?: boolean;
}
export type PortType = 'main' | 'ai.model' | 'ai.tool' | 'ai.memory' | 'ai.retriever';
export interface Item { json: Record<string, unknown>; binary?: Record<string, BinaryRef> }
```

- **Items**: như n8n, mỗi node nhận/trả mảng item; biểu thức đánh giá theo từng item (`$json`, `$node("id").json`,
  `$input.all()`, `$env` **chỉ** biến trong danh sách trắng, `$run`).
- **Cổng cụm** (cluster): node `ai.agent` nhận model qua cổng `ai.model` (chứa *vai trò*), tool qua `ai.tool`, trí
  nhớ qua `ai.memory` — giống AI Agent node của n8n, nhưng tool là node/sub‑flow có phân hạng tác dụng phụ.
- Bảng:

```sql
-- 0401_ai_flows.sql
ai_flows(id, tenant_id, name, active_version, owner, risk_class, created_at, ...)
ai_flow_versions(flow_id, version, definition jsonb, risk_class, created_by, approved_by, created_at)  -- bất biến
ai_flow_triggers(id, flow_id, version, kind, config jsonb, next_fire_at, enabled)
ai_flow_runs(id, flow_id, version, trigger_kind, status, started_at, finished_at, error jsonb,
             parent_run_id, retry_of, idempotency_key UNIQUE, uu_tien)
ai_flow_steps(run_id, node_id, attempt, status, input_ref, output_ref, model_profile, role,
              tokens_in, tokens_out, ms, error jsonb, started_at, finished_at)
ai_flow_events(run_id, seq, kind, payload jsonb, at)    -- event-sourcing, phát lại được (tái dùng mẫu FOE)
ai_flow_queue(id, run_id, node_id, available_at, lease_owner, lease_until, attempts)
ai_flow_credentials(id, tenant_id, kind, name, ciphertext bytea, iv, tag, key_version, created_by)
ai_flow_waits(run_id, node_id, kind, token_hash, expires_at)   -- chờ duyệt / chờ webhook / chờ thời gian
```

### 4.4 Thực thi bền (durable) không cần Temporal

- **Điểm lưu theo node**: mỗi node xong ⇒ ghi `ai_flow_steps` + sự kiện trong cùng giao dịch; tiến trình chết ⇒
  worker khác thấy lease hết hạn, chạy tiếp từ node chưa xong (không chạy lại node đã xong).
- **Hàng đợi Postgres**: `SELECT … FROM ai_flow_queue WHERE available_at <= now() AND (lease_until IS NULL OR
  lease_until < now()) ORDER BY uu_tien, available_at FOR UPDATE SKIP LOCKED LIMIT n`. Không thêm Redis/BullMQ (ít
  thành phần hơn, offline, đã có Postgres).
- **Bầu chủ cho trigger**: `pg_try_advisory_lock` ⇒ chỉ một tiến trình bắn lịch/poll (sửa luôn lỗ "12 cron không bầu
  chủ" bằng cách cho dần các scheduler cũ dùng cùng khoá).
- **Idempotency**: node có tác dụng phụ ngoài nhận `idempotencyKey = runId:nodeId:attempt-group`; HTTP/email gửi kèm
  header khi đích hỗ trợ; node không đảm bảo được ⇒ khai `atMostOnce` và không tự thử lại.
- **Chờ dài**: `ai.cho` / `nguoi.duyet` / `webhook.cho` không giữ tiến trình — ghi `ai_flow_waits`, giải phóng worker,
  đánh thức bằng sự kiện (mẫu `interrupt()` / `Command(resume)` của LangGraph).
- **Chạy lại từ node** (kiểu `workflow reset`): tạo run mới phát lại output đã lưu tới node X rồi chạy tiếp — dùng để
  sửa lời nhắc một bước mà không gọi lại cả luồng.
- **Phát lại xác định**: node AI lưu nguyên request (vai trò, profile, seed, prompt đã che) + response ⇒ debug được
  dù model đã đổi.

### 4.5 Danh mục node (phiên bản 1)

| Nhóm | Node | Hạng tác dụng phụ |
|---|---|---|
| **Kích hoạt** | thủ công · lịch (cron) · webhook (token theo luồng, HMAC tuỳ chọn) · sự kiện nội bộ (event bus: cảnh báo, lỗi AOI, đổi ca) · MQTT subscribe · tệp mới trong thư mục quản lý · chat (từ Copilot/app di động) · luồng lỗi | — |
| **Logic** | if · switch · merge · lặp / chia lô · chờ · gọi sub‑flow · dừng có lỗi · gom (aggregate) | thuần |
| **Dữ liệu** | đặt/đổi trường · lọc · sắp xếp · CSV/Excel/JSON/PDF đọc‑ghi · **mã JS/Python** chạy trong runner cách ly (tiến trình con, không mạng, giới hạn CPU/RAM/thời gian, FS chỉ thư mục tạm) | thuần / đọc |
| **AI** | `ai.llm` (vai trò, lời nhắc, schema đầu ra) · `ai.trichXuat` (JSON schema, kiểm zod, thử lại khi sai schema) · `ai.phanLoai` · `ai.tomTat` · `ai.nhung` · `ai.traTriThuc` (KB pgvector + rerank) · `ai.thiGiac` / OCR · `ai.sinhMa` (vai trò `code.*` + vòng kiểm biên dịch/test) · **`ai.agent`** (agentCore, cổng tool/memory) · `ai.giamKhao` (LLM chấm theo tiêu chí, có ngưỡng) | thuần (gọi model) |
| **Tích hợp** | HTTP (danh sách trắng host khi offline) · SQL **chỉ đọc** (vai trò DB chỉ đọc riêng) · email SMTP nội bộ · app cảnh báo nhà máy · Telegram/Zalo (khi có mạng) · tạo phiếu/việc trong hệ thống · MCP client (gọi tool của MCP server) | ngoài‑ghi |
| **Con người** | `nguoi.duyet` (duyệt/bác + lý do, qua web/app, hết hạn) · `nguoi.bieuMau` (form điền) · thông báo | chờ |
| **OT** | `ot.docTag` (đọc telemetry) · `ot.deXuatLenh` (đi `aiControlGate` + `proposeAction`) · `ot.deXuatLuong` (đề xuất chạy một FOE workflow đã duyệt) | OT (§4.6) |

Mỗi node là một tệp khai báo: `type`, `typeVersion`, schema tham số (zod), cổng vào/ra, **hạng tác dụng phụ**,
quyền cần, `idempotent`/`atMostOnce`, hàm `chay(ctx, items)`. Thêm node mới không sửa động cơ (registry). Lưới census:
mọi node trong registry phải khai đủ trường (bất biến, không phải danh sách).

### 4.6 An toàn của Luồng

**Phân hạng tác dụng phụ** (thứ tự tăng): `thuan` < `doc` < `ngoai-ghi` < `ot`. Hạng của luồng = hạng cao nhất của
node trong nó (kể cả tool mà `ai.agent` có thể gọi và sub‑flow).

| Hạng luồng | Ai được kích hoạt | Điều kiện thêm |
|---|---|---|
| thuần / đọc | kỹ sư (quyền `flow.activate`) | — |
| ngoài‑ghi | trưởng nhóm / admin | danh sách đích (host, email, kênh) cố định trong phiên bản |
| ot | admin + TOTP mới (như `deployProcedure`) | **mọi** lệnh vẫn qua `aiControlGate` (fail‑closed, theo hướng năng lượng) + `nguoi.duyet` cho mức ≥ 3; mức 4–5 chặn cứng như hiện tại; `AI_OT_CONTROL_ENABLED` tắt ⇒ node OT chỉ chạy ở chế độ *mô phỏng* |

Luật bổ sung:
1. **Dữ liệu vào từ trigger là không tin cậy** (email, webhook, OCR, MQTT payload). Node AI nhận chúng trong khối dữ
   liệu có đánh dấu; phát hiện "mệnh lệnh trong dữ liệu" ⇒ **cảnh báo + hạ tự trị** của lượt (cần duyệt), không dừng
   cả luồng (bài học "bẫy an toàn giết tính năng").
2. **Đầu ra model không tự thành tham số của node có tác dụng phụ** trừ khi qua `ai.trichXuat` có schema chặt
   (enum/dải số) **và** node đích kiểm lại; với hạng OT luôn qua người.
3. **Bí mật**: AES‑256‑GCM, khoá từ `FLOW_CREDENTIAL_KEY` (bảo vệ bằng DPAPI trên Windows), có `key_version` để xoay
   khoá; giá trị bí mật **không bao giờ** đi vào prompt, log, `ai_flow_steps`; lưới bất biến "không giá trị bí mật nào
   xuất hiện nguyên văn trong bảng step/event".
4. **Kích hoạt = phiên bản bất biến đã duyệt**; sửa luồng đang chạy tạo phiên bản mới, không đổi run đang chạy.
5. Audit: tạo/sửa/kích hoạt/tắt luồng, mọi lần duyệt, mọi node ngoài‑ghi/ot ⇒ `audit_logs`.
6. Hạn mức: số run đồng thời/luồng, token/ngày/luồng, thời gian tối đa; vượt ⇒ dừng có lý do.

### 4.7 Lịch và model — Luồng gặp Bộ giám sát

- Node AI gửi `YeuCauDinhTuyen{ vaiTro, phamVi:{flowId}, uuTien: settings.uuTien }`. Luồng nền mặc định
  `background` ⇒ không bao giờ chen trước người đang thao tác (`hangDoiUuTienLlm`).
- Luồng khai `affinity: ['code.plc']` ⇒ bộ lập lịch Luồng **gom** các bước cùng vai trò của nhiều run trước khi nhả
  khe; Bộ giám sát thấy hàng đợi lớn cùng profile ⇒ đổi khe một lần thay vì đập qua lại.
- Khung giờ: luồng nặng (sinh mã lô, tóm tắt báo cáo tuần) có thể đặt `cuaSo: '22:00-06:00'`.
- Gán theo phạm vi `flow` cho phép một luồng dùng model khác mặc định (vd luồng phân loại email dùng 4B thường trú —
  không cần đổi khe).

### 4.8 Quan sát và thử

- **Dòng thời gian run**: mỗi node — input/output (theo `luuDuLieu`), thời gian, vai trò + profile model thật đã
  dùng, token, lần thử, lý do định tuyến.
- **Ghim dữ liệu** (pinData) để chạy thử từng node không gọi trigger thật.
- **Bộ thử luồng**: tệp kịch bản (đầu vào + kỳ vọng/hàm chấm) chạy trong CI cục bộ; node AI chấm bằng schema hoặc
  `ai.giamKhao` đã kiểm định với nhãn người.
- **Cắt tỉa**: mặc định giữ 14 ngày hoặc 10.000 run (như n8n), nhị phân cắt cùng run; cấu hình theo tenant.
- Số đo xuất vào `ai_gateway_metrics` sẵn có + bảng tổng hợp luồng (tỉ lệ thành công, p50/p90, token, số lần đổi khe
  do luồng gây ra).

### 4.9 Flow Studio (giao diện)

- Canvas xyflow (tái dùng `WorkflowGraphCanvas`), bảng node có tìm kiếm, cấu hình node bằng form sinh từ schema
  zod, trình soạn biểu thức có gợi ý `$json`.
- Huy hiệu hạng tác dụng phụ trên node + trên luồng; nút "Kích hoạt" đổi yêu cầu quyền theo hạng.
- Chạy thử một node / tới node; xem item vào/ra; so sánh hai run.
- **Mô tả → luồng**: người mô tả bằng tiếng Việt, `ai.agent` sinh `FlowDefinition` JSON, **kiểm schema + tính hạng**,
  hiện bản nháp trên canvas để người sửa/duyệt — không bao giờ tự kích hoạt.
- Thư viện mẫu (§5.3).

### 4.10 MCP

- **Luồng thành tool**: luồng có trigger "MCP" được công bố qua `aiCodingCli/mcpServer.ts` (và sau này Streamable
  HTTP) ⇒ VSCode extension, CLI, agent khác gọi được. Hạng tác dụng phụ đi theo.
- **Node MCP client**: gọi tool của MCP server nội bộ/được phép (danh sách trắng), kết quả coi là dữ liệu không tin
  cậy.
- Theo spec MCP 2025‑11‑25 (structured tool output, elicitation) khi chuyển từ bản viết tay sang SDK.

---

## 5. Kết hợp thành hệ AI Local hoàn chỉnh

### 5.1 Ai dùng gì

| Bề mặt | Gọi | Vai trò điển hình |
|---|---|---|
| Copilot web (Hỏi) | Cổng AI → định tuyến | `chat`, `chat.ops`, `summarize` |
| Agent lập trình web/VSCode/CLI | agentCore → `/v1` | `code.software` hoặc `code.plc` theo dự án; `fim` cho ghost-text |
| Training Studio | Cổng AI | `embed`, `rerank`, `extract`; trang **Đo** dùng chung `ai_model_eval_runs` |
| Luồng AI | Động cơ Luồng → Cổng AI | bất kỳ, theo node; nền |
| AOI / cảnh báo | Luồng (trigger sự kiện) | `vision`, `classify`, `summarize` |
| Kỹ thuật / điều khiển | Luồng → `ot.deXuat*` → L‑7 → FOE | chỉ đề xuất, người duyệt |

### 5.2 Dồn đường gọi LLM

Hiện ~50 điểm import engine. Lộ trình: (1) Cổng AI nhận `vaiTro`; (2) census AST "điểm gọi engine ngoài Cổng" —
bất biến *số điểm chỉ giảm*; (3) chuyển theo cụm (copilot, KB, specialist, report) kèm lưới hành vi; (4) cuối cùng
engine chỉ được import từ Cổng + Bộ giám sát.

### 5.3 Mẫu luồng khởi đầu (giá trị thật cho nhà máy)

1. **Cảnh báo AOI → phân tích nguyên nhân**: sự kiện lỗi AOI lặp ≥ N/giờ → `ai.thiGiac` mô tả ảnh → `ai.traTriThuc`
   (SOP, lịch sử sửa) → `ai.llm` (`chat`) viết RCA nháp → `nguoi.duyet` trưởng ca → tạo phiếu + gửi app cảnh báo.
2. **Tài liệu mới → tri thức**: tệp vào thư mục quản lý → OCR (VietOCR) → `ai.trichXuat` siêu dữ liệu → nạp KB
   Studio → thông báo người duyệt thẻ.
3. **Yêu cầu PLC → mã ST đã kiểm**: form kỹ sư (mô tả I/O, phương ngữ) → `ai.sinhMa` (`code.plc`) với vòng MATIEC +
   mô phỏng OpenPLC → báo cáo kiểm + tệp → `nguoi.duyet`. Không tải xuống thiết bị.
4. **Báo cáo ca/tuần**: lịch 06:00 → SQL chỉ đọc (OEE, lỗi, dừng máy) → `ai.tomTat` → PDF → email nội bộ.
5. **Email/phiếu bảo trì → phân loại**: trigger hộp thư nội bộ → `ai.phanLoai` (4B thường trú) → tạo việc đúng nhóm.
6. **Đêm: đo lại model**: lịch 01:00 → chạy bộ đo vai trò cho các gán `thu` → ghi `ai_model_eval_runs` → báo nếu
   gán active tụt ngoài nhiễu.

### 5.4 Quan hệ với kế hoạch 7 tầng

Thiết kế này **mở rộng, không thay** kế hoạch 7 tầng: dùng lõi agent Đợt 1, ngữ cảnh Đợt 2, đổi model Đợt 6, giữ Q5.
Đề xuất ghi thành **Đợt 7 (Đa model)** và **Đợt 8 (Luồng AI)**. Mục "server nhỏ thứ hai" trong Đợt 6 đã bị Q5 loại;
thiết kế này không mở lại.

---

## 6. Lộ trình và cổng ra (cổng viết trước khi làm, đo ≥ 3 lượt)

| Pha | Nội dung | Cổng ra (số) |
|---|---|---|
| **7.0** | Sổ model + vai trò + gán seed khớp `.env`; định tuyến tầng 1–3; `/v1/models` liệt kê vai trò | Lưới tương đương: mọi tier cũ → cùng model (100 %); H không tụt ngoài ±3 |
| ↳ **kết quả 7.0 (2026-10-20)** | ĐẠT | Bất biến tương đương 5 bộ env × mọi vai trò sinh chữ = `resolveTaskModel` (ảnh seed và ảnh rỗng); tên logic cũ + passthrough tên tệp không đổi (59 + 11 + 9 ca cũ xanh); H 12×3 **không chạy** — đường sinh chữ cũ không đổi byte, chỉ thêm nhánh cho tên vai trò. Sống trên :3012: `/v1/models` bày 6 vai trò sinh chữ; `model:"code.plc"` trả lời qua :8091 trong 15,7 s, engine từ chối nạp bản 35B thứ hai trong tiến trình. Kho GGUF: +12 artifact. Mig 0400 áp test + dev, nghiệm thu avi_app đạt. |
| **7.1** | Bộ giám sát: hàng đợi ái lực, lưu trú tối thiểu, nhận nuôi :8091 vào broker, fail‑closed có thông báo | Kịch bản xen kẽ 2 vai trò ×30 yêu cầu: số lần đổi khe ≤ số "đợt" thật + 1; interactive không chờ sau nền; giết server giữa đổi ⇒ phục hồi ≤ 90 s; broker `snapshot` có lease :8091 |
| ↳ **kết quả 7.1 (2026-10-20)** | ĐẠT | Đồng hồ giả: 3 đợt A×10·B×10·A×10 ⇒ đổi đúng 2 lần (≤ 4); 30 yêu cầu xen kẽ mỗi 3 s ⇒ 1 lần sang B + 1 lần về nhà; tương tác A mỗi 5 s trong 12 phút ⇒ 100 % lượt A trước mốc 10 phút được nhận ngay, B nền đi sau đúng 10 phút; lưu trú 60 s; hỏng ⇒ nghỉ 60 s; huỷ khi chờ; về nhà sau 15 phút rảnh. **Thước nhạy:** đột biến "luôn đổi ngay" làm đỏ 3/10 ca. Sống trên :3012 (lưu trú 10 s cho phép đo nhanh): Qwen3.6 → Qwen3-Coder-30B 15 s gồm đổi khe (lần đầu 48 s khi tệp chưa vào bộ đệm đĩa), lượt Coder thứ hai 0 s đổi, `chat` về Qwen3.6 16 s; trả lời đúng ("Q := IN AND NOT RESET;", "Hà Nội"); 0 lượt nạp model nặng trong tiến trình; `/props` khớp từng bước. *Bẫy đo:* chuỗi tiếng Việt truyền qua tham số curl trên Git Bash bị hỏng mã ⇒ model trả lạc đề — gửi bằng tệp JSON UTF-8. "Giết server giữa lúc đổi" được lưới `DieuPhoiDoiModel` canh (quay về nhà) + `KheNang` đọc lại `/props`; chưa đo sống ca này. |
| **7.2** | Bộ đo `plc-st-v1` (24 + 6 giữ lại) + toolchain MATIEC/RuSTy + mô phỏng OpenPLC | Thước tự kiểm: lời giải tham chiếu 30/30 qua; lời giải đột biến bị bắt ≥ 90 % (đo thước trước khi đo model) |
| ↳ **kết quả 7.2 (2026-10-20)** | ĐẠT | `plc-st-v1` = ngôn ngữ `st` trong bộ NGẪU NHIÊN (không bộ riêng): 30 bài (24 đo + 6 giữ lại `giuLai`), RuSTy 1.0.7 trong Docker (`st-rusty:1.0.7`, `--network none`, ~0,5 s/lượt), đồng hồ GIẢ `G_NOW` + TON/TOF/TP tất định. Kiểm thước độc lập `kt-st-30`: mẫu 30/30 · khung trượt 30/30 · đột biến bị bắt **30/30** (và đều lọt test hiển thị ⇒ test ẩn chặt hơn) · sửa test bị bắt 30/30 · tệp `.st` mới ngoài `src/` bị bắt 30/30 · prompt sạch 30/30; đường (a) chế độ mẫu 30/30. Bài do 3 agent viết theo luật kho, tôi chạy lại kiểm thước độc lập. Giới hạn: chỉ phương ngữ CODESYS (Siemens SCL v2); agent (đường b/c) chưa có lệnh test ST; MATIEC dựng được nhưng chưa nối. |
| **7.3** | Đo ứng viên `code.plc`, gán qua quy trình thu → active; định tuyến tầng 4 (ngữ nghĩa) | Gán được chọn ≥ gán cũ ngoài nhiễu trên `plc-st-v1`; tầng 4 đúng vai trò ≥ 90 % trên 100 câu nhãn tay, câu dưới ngưỡng rơi về mặc định |
| **7.4** | Trung tâm Model (UI) | Hành trình đổi gán bằng tài khoản admin e2e Playwright ×3 |
| **8.0** | Tách `shared/flow` khỏi FOE; mô hình dữ liệu; hàng đợi Postgres; bầu chủ trigger | Lưới FOE xanh nguyên; giết worker giữa run ⇒ run hoàn tất, 0 node chạy lại hai lần (đếm tác dụng phụ trên đích giả) |
| **8.1** | Node lõi: trigger thủ công/lịch/webhook/sự kiện, logic, dữ liệu, HTTP, AI (`llm`, `trichXuat`, `phanLoai`, `tomTat`, `traTriThuc`), `nguoi.duyet` | 3 mẫu luồng (§5.3 #1, #2, #4) chạy đầu‑cuối ×3; census node khai đủ trường |
| **8.2** | Phân hạng tác dụng phụ + quyền kích hoạt + bí mật mã hoá + runner mã cách ly | Bộ tấn công: luồng hạng thấp không gọi được node hạng cao qua agent/sub‑flow (0 lọt); bất biến không rò bí mật; runner không mở được socket |
| **8.3** | Flow Studio (canvas, chạy thử node, dòng thời gian, so sánh run) | Hành trình 8 bước bằng kỹ sư không admin, Playwright ×3 |
| **8.4** | `ai.agent` + `ai.sinhMa` + MCP (luồng thành tool, node MCP client) + mô tả → luồng | Mẫu #3 (PLC) đầu‑cuối; mô tả → luồng: ≥ 70 % bản nháp hợp lệ schema trên 20 mô tả, 0 bản nháp tự kích hoạt |
| **8.5** | Node OT (`ot.docTag`, `ot.deXuatLenh`, `ot.deXuatLuong`) chế độ mô phỏng | Mọi lệnh đi qua `aiControlGate` (census điểm gọi = 1 hàm bao); mức 4–5 bị chặn 100 % trên bộ đột biến |

Phụ thuộc: 7.0 → 7.1 → (7.2 ∥ 8.0) → 7.3 · 8.1 → 8.2 → 8.3 → 8.4 → 8.5. 7.4 sau 7.3.

---

## 7. Rủi ro và cách giảm

| Rủi ro | Giảm |
|---|---|
| Đổi khe quá thường xuyên ⇒ độ trễ người dùng tăng mạnh | Hàng đợi ái lực + lưu trú tối thiểu + gom lô luồng nền; đo "số lần đổi khe/giờ" trên lưu lượng thật; nếu vẫn cao mới xét phương án B (§3.2), phải hỏi lại chủ dự án vì đụng Q5 |
| Model "chuyên PLC" không tốt hơn thật | Bộ đo trước, gán sau; có thể kết luận "giữ một model" — đó cũng là kết quả đúng |
| Thước đo PLC tự sinh giả (lớp lỗi đã gặp nhiều lần) | Đo thước trước bằng lời giải tham chiếu + đột biến (pha 7.2) |
| Luồng thành cửa sau tới thiết bị | Hạng `ot` + một hàm bao duy nhất + fail‑closed + `AI_OT_CONTROL_ENABLED` tắt ⇒ chỉ mô phỏng |
| Tiêm lệnh qua dữ liệu trigger | Đánh dấu dữ liệu không tin cậy; đầu ra model qua schema chặt; hạ tự trị thay vì dừng |
| Giấy phép model (DeepSeek License…) | Trường `license` bắt buộc; `unknown` ⇒ cấm active |
| Engine luồng phình to như FOE (4.378 dòng) | Registry node + lõi nhỏ; giới hạn kích thước tệp; lõi không biết node cụ thể |
| Hai tiến trình chạy đôi trigger | Advisory lock + idempotency key |

---

## 8. Quyết định của chủ dự án (2026-10-20)

| # | Câu hỏi | Trả lời |
|---|---|---|
| D1 | Thêm Đợt 7 (Đa model) + Đợt 8 (Luồng AI) vào kế hoạch 7 tầng | **Đồng ý** |
| D2 | Xây Luồng AI trong nhà trên FOE | **Đồng ý** |
| D3 | Dải migration AI Local mới | **0400–0419** |
| D4 | Luồng chạm OT bản đầu | **Chỉ đọc + đề xuất ở chế độ mô phỏng** |
| D5 | Model cho `code.plc` | **Được tải về đo, hoặc chọn model khác mạnh về tự động hoá theo khuyến nghị** |

### 8.1 Khuyến nghị D5 — danh sách ứng viên đo cho `code.plc` (thứ tự đo)

Không có benchmark công bố nào so các model mở trên ST trên cùng một bộ đo (§9.4). Một nghiên cứu về kỹ thuật prompt
(LLM‑PLC‑AS, 21 kỹ thuật trên ST/IL) ghi DeepSeek là bộ sinh "đáng tin nhất" — nhưng đó là model DeepSeek bản lớn qua API,
không phải bản chạy được trên 32 GB. Vì vậy chọn theo bộ đo `plc-st-v1`, với ứng viên:

| # | Model | Vì sao đưa vào | Trạng thái |
|---|---|---|---|
| 1 | **Qwen3.6-35B-A3B** (đang chạy) | Nền so sánh; đã đạt H 86 % ở phần mềm | trên đĩa |
| 2 | **Qwen3.6-27B (dense), nghĩ BẬT** | Đúng nhất trong số đã đo ở dự án này (92 % bộ khó 2026-09-22, chậm 82 s/bài — chậm không phải lý do loại) | **đã xoá 2026-10-17 ⇒ tải lại** |
| 3 | **Devstral Small 2 (24B dense)** | Model lập trình mở mạnh nhất ngoài họ Qwen năm 2026 theo các bảng tổng hợp (SWE-bench Verified 68 % do hãng khai) — đối chứng khác họ | tải; kiểm giấy phép |
| 4 | **DeepSeek-Coder-V2-Lite-Instruct (16B/2,4B active)** | Đại diện DeepSeek chạy được cục bộ; đã cũ (2024) — giữ làm đối chứng theo yêu cầu ban đầu | tải; **kiểm DeepSeek License thương mại** |
| 5 | Qwen3-Coder-30B-A3B | Có sẵn; số đo ngẫu nhiên 11 % ⇒ chỉ chạy nếu thời gian cho phép | trên đĩa |

Khuyến nghị thực chất: **giá trị lớn nhất cho `code.plc` nằm ở vòng kiểm (MATIEC/RuSTy + mô phỏng OpenPLC), không ở tên
model** — LLM4PLC tăng 47→72 % nhờ vòng kiểm; SemaPLC +17 điểm nhờ hoàn thành có cổng. Tải model ở pha 7.3, sau khi
thước `plc-st-v1` tự kiểm xong (7.2) — đo model trên thước chưa kiểm là lớp lỗi dự án đã gặp nhiều lần.

## 9. Nguồn tham khảo

### 9.1 n8n
- Queue mode (main/worker/Redis): https://docs.n8n.io/hosting/scaling/queue-mode/
- Task runner cho Code node: https://docs.n8n.io/deploy/host-n8n/configure-n8n/set-up-task-runners/
- Khoá mã hoá credential: https://docs.n8n.io/deploy/host-n8n/configure-n8n/basic-configuration/configuration-examples/set-a-custom-encryption-key
- Error Trigger / xử lý lỗi: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.errortrigger/
- AI tools / cluster nodes: https://docs.n8n.io/build/integrate-ai/understand-ai-components/how-tools-work/
- Cắt tỉa dữ liệu chạy: https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/manage-execution-data
- Giấy phép: https://github.com/n8n-io/n8n/blob/master/LICENSE.md
- MCP Server Trigger: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.mcpTrigger/

### 9.2 Phục vụ và định tuyến model
- llama.cpp server (router mode `--models-dir/--models-max`, draft, KV quant): https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
- llama-swap (nhóm, TTL, preload): https://github.com/mostlygeek/llama-swap
- LiteLLM fallback/router: https://docs.litellm.ai/docs/proxy/reliability.md
- Ollama keep_alive / số model nạp: https://docs.ollama.com/faq
- semantic-router: https://github.com/aurelio-labs/semantic-router
- RouteLLM: https://lmsys.org/blog/2024-07-01-routellm/
- Qwen3.6-35B-A3B: https://recipes.vllm.ai/Qwen/Qwen3.6-35B-A3B
- DeepSeek-Coder-V2: https://github.com/deepseek-ai/DeepSeek-Coder-V2

### 9.3 Động cơ luồng và agent
- LangGraph human‑in‑the‑loop / persistence: https://docs.langchain.com/oss/python/langgraph/human-in-the-loop · https://docs.langchain.com/oss/python/langgraph/persistence
- Temporal: https://github.com/temporalio/temporal
- Activepieces: https://github.com/activepieces/activepieces
- Windmill: https://github.com/windmill-labs/windmill
- Node-RED OPC UA → MQTT: https://flowfuse.com/blog/2024/08/opc-ua-to-mqtt-with-node-red/
- MCP spec 2025‑11‑25: https://modelcontextprotocol.io/docs/2025-11-25/learn/versioning

### 9.4 LLM sinh mã PLC (IEC 61131‑3)
- LLM4PLC (vòng MATIEC + nuXmv, 47→72 %): https://arxiv.org/html/2401.05443v1
- Agents4PLC (đa agent, kiểm hình thức, 23 bài): https://arxiv.org/html/2410.14209v1
- AutoPLC (SCL/CODESYS, > 90 % biên dịch): https://arxiv.org/html/2412.02410v2
- SemaPLC (hoàn thành có cổng kiểm, chạy runtime thật): https://arxiv.org/abs/2608.18565
- Siemens, tinh chỉnh theo phản hồi trình biên dịch: https://arxiv.org/html/2410.22159v3
- RuSTy: https://github.com/PLC-lang/rusty

Chưa kiểm được: endpoint load/unload của router mode llama.cpp; điều khoản thương mại DeepSeek License; giấy phép
RuSTy; **không có benchmark công bố nào so Qwen3.x với DeepSeek trên ST** ⇒ phải tự đo (§3.7).
