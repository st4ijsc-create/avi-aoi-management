# Thiết kế: Xưởng Agent chuyên môn (AI Specialist Studio) — Wave 1

**Ngày:** 2026-07-28 · **Nhánh:** `feat/hmi-dep` · **Tiếp nối:** doc 69 (6 giai đoạn) + Wave 0 (kích hoạt, `55928129..f02b4b88`)

**Mục tiêu một câu:** Biến 4 AI Agent chuyên môn từ "nhìn thấy nhưng không gọi được" thành **gọi được, có mắt (đọc mã nguồn thật), và đo được chất lượng** — để sau đó quyết định bằng số liệu có nên đầu tư mức "tự sinh patch" hay không.

---

## 1. Bối cảnh & vấn đề (đã kiểm chứng trên mã nguồn)

Concern #3 của chủ sản phẩm: *"các AI Agent chuyên môn tôi vẫn chưa thể gọi để thực thi nhiệm vụ"*. Khảo sát 3 agent song song (read-only) xác nhận vấn đề **không phải thiếu năng lực lõi, mà thiếu cửa vào + agent bị mù + không có thước đo**.

| Thành phần | Trạng thái thật | Dẫn chứng |
|---|---|---|
| 9 tRPC procedure specialist (`listAgents`, `run`, `runWorkflowChain`, `listSessions`, `getSessionDetail`, `listModuleAuditPresets`, `runModuleAudit`, `proposeRecommendationAsAction`, `getModuleImprovementScore`) | ✅ Xây xong, chạy thật | `server/routers/aiSpecialistAgentRouter.ts:53-437` |
| Client gọi các procedure đó | ❌ **KHÔNG một dòng nào** | `grep -rn "aiSpecialist" client/src` → 0 kết quả |
| 4 agent + LLM local + lưu phiên/bước + token metrics | ✅ Thật | `server/services/aiSpecialistAgentService.ts:71-138`, `:306-343`; bảng `ai_specialist_sessions` / `ai_specialist_session_steps` |
| **Agent đọc mã nguồn** | ❌ **Không có `fs`** — `files[]` chỉ vào prompt dưới dạng *tên file*; code phải **dán tay** vào `codeSnippet` | `aiSpecialistAgentService.ts:233` (`Related files:\n${stringifyList(input.files)}`), `:236` |
| Thước đo chất lượng | ❌ Không tồn tại. Thứ tên `getModuleImprovementStats` **chỉ đo tốc độ** (đếm phiên xong/lỗi, ms/bước, token/giây) | `server/db/aiSpecialist.ts:142-183` |
| Phân quyền | ⚠️ **Lỗ hổng**: cả 9 procedure là `protectedProcedure` ⇒ *mọi user đăng nhập* (kể cả `operator`) gọi chạy model được | `aiSpecialistAgentRouter.ts:53,60,138,224,239,251,257,378,429` |
| Nút gọi ở Agent Command Center | ❌ Drawer ghi thẳng *"Xem nhanh — chưa có hành động khả dụng ở đây."* | `client/src/components/agentCenter/AgentDrillInDrawer.tsx:278` |

Nguyên liệu **đã có sẵn** để vá "mù": KB đã embed mã nguồn của chính repo (chunk `sourceType` = `service` / `router`, nhờ Wave 0 embed 5370 chunk) và `knowledge/code-graph.json` là đồ thị import `{from, to}`.

## 2. Phạm vi

**Thuộc phạm vi (mức A — "cố vấn có cấu trúc"):**
1. Bộ đọc-repo có giới hạn (chỉ-đọc) + RAG + đồ thị phụ thuộc → cho agent "mắt".
2. Chạy nền + theo dõi phiên (thay cho mutation chặn HTTP) + siết RBAC.
3. Trang `/ai-specialist-studio` — giao việc, xem kết quả, lịch sử, audit module.
4. Command Center: drawer specialist có nút **"Giao việc →"**.
5. Thước đo kép: chấm tay trên việc thật + bộ đề chuẩn chấm tự động.

**KHÔNG thuộc phạm vi (mức B — quyết định sau, bằng số liệu ở §8):**
- Agent tự sinh patch/diff cho repo, tự ghi file, tự chạy test, tự tạo nhánh git.
- Đổi bộ 4 agent hiện có sang persona vận hành nhà máy (đã chốt: giữ persona phát triển phần mềm).
- Mở rộng `proposeRecommendationAsAction` (bridge 3 tool nhà máy: `run_rca_analysis`, `request_threshold_review`, `create_maintenance_workorder`) — không liên quan việc phát triển phần mềm.
- Đụng tới OT/điều khiển máy, ghi file vào `PROG_WORKSPACE_DIR`, hay bất kỳ write-tool nào trong 27 tool HITL.

## 3. Kiến trúc tổng thể

```
Studio UI (/ai-specialist-studio)         Command Center drawer
        │  giao việc                              │ "Giao việc →" (deep-link)
        ▼                                         ▼
  aiSpecialistAgentRouter  ── siết RBAC: roleProcedure("admin","engineer") + moduleGate("MOD_AI")
        │
        ├─ run / runWorkflowChain / runModuleAudit
        │     (trả sessionId NGAY) ──────────► chạy nền ──► runSpecialistAgent()
        │                                                        ▲
        │                                          repoContextService ("mắt")
        │                                          ├─ đọc file thật (có giới hạn + redact)
        │                                          ├─ retrieveKnowledge() → mảnh RAG
        │                                          └─ code-graph.json → file phụ thuộc
        │
        ├─ getSessionDetail (poll trạng thái: running → completed/failed)
        └─ submitFeedback / getQualityScoreboard  ──► ai_specialist_feedback (mig mới)

scripts/ai-eval/eval-specialist.mjs (bộ đề chuẩn, chạy CLI, chấm tự động)
```

Nguyên tắc: **không viết lại** thứ đã có. `runSpecialistAgent`, `runSpecialistWorkflowChain`, `runModuleAudit`, bảng phiên/bước, `retrieveKnowledge`, `redactSecretsOnly` đều **tái sử dụng nguyên trạng**.

## 4. Thành phần 1 — Bộ đọc-repo (`repoContextService`)

**File mới:** `server/services/ai/repoContextService.ts` (chỉ-đọc, không đăng ký vào toolRegistry — đây là **service nội bộ** của specialist, không phải tool cho LLM tự gọi).

```ts
export type RepoReadRejectReason =
  | "ABSOLUTE" | "TRAVERSAL" | "NUL" | "ESCAPE"
  | "DENIED_SECRET" | "DENIED_DIR" | "DENIED_EXT"
  | "NOT_FOUND" | "NOT_A_FILE" | "TOO_LARGE" | "BUDGET_EXCEEDED";

export interface RepoFileRead {
  path: string;        // đường dẫn tương đối gốc repo, đã chuẩn hoá dấu /
  content: string;     // đã cắt theo cap + đã redact bí mật
  bytes: number;       // kích thước GỐC trên đĩa
  truncated: boolean;
  redacted: boolean;   // true nếu redactSecretsOnly có thay đổi nội dung
}

export interface RepoContextResult {
  files: RepoFileRead[];
  skipped: Array<{ path: string; reason: RepoReadRejectReason }>;
  dependencies: string[];   // từ code-graph.json: file mà các file đã nêu import
  ragSnippets: Array<{ sourcePath: string; text: string; score: number }>;
  totalBytes: number;       // tổng byte NỘI DUNG đã nạp (sau cắt)
}

export async function gatherRepoContext(input: {
  files?: string[];
  objective?: string;          // dùng làm truy vấn RAG
  includeRag?: boolean;        // mặc định true khi có objective
  includeDependencies?: boolean; // mặc định true khi có files
  maxFileBytes?: number;       // mặc định 65_536
  maxTotalBytes?: number;      // mặc định 262_144
  ragTopK?: number;            // mặc định 5
}): Promise<RepoContextResult>;
```

**Luật chặn (mỗi luật một test):**
- Từ chối đường dẫn tuyệt đối (`ABSOLUTE`), chứa `..` (`TRAVERSAL`), chứa byte NUL (`NUL`).
- Giải đường dẫn theo gốc repo (`process.cwd()`); thoát ra ngoài ⇒ `ESCAPE`.
- **Chặn bí mật** (`DENIED_SECRET`), khớp trên *tên file*: `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.keystore`, `id_rsa*`.
- **Chặn thư mục** (`DENIED_DIR`), khớp tiền tố: `node_modules/`, `.git/`, `dist/`, `uploads/`, `knowledge/embeddings`, `.superpowers/`, `.playwright-mcp/`.
- **Cho phép đuôi** (ngoài danh sách ⇒ `DENIED_EXT`): `.ts .tsx .js .jsx .mjs .cjs .json .sql .md .css .yml .yaml`.
- Vượt `maxFileBytes` ⇒ cắt, `truncated: true` (KHÔNG bỏ file). Vượt `maxTotalBytes` ⇒ các file còn lại vào `skipped` với `BUDGET_EXCEEDED`.
- Nội dung mỗi file đi qua `redactSecretsOnly()` (`server/services/ai/aiSafety.ts:254`) trước khi vào prompt. Dùng bản **chỉ-bí-mật**, KHÔNG dùng `redactSecretsAndPII` (luật PII sẽ băm nát định danh trong mã nguồn).

**Fail-safe:** không bao giờ ném lỗi ra ngoài. Mọi lỗi đọc/parse (kể cả `code-graph.json` hỏng hoặc thiếu, `retrieveKnowledge` lỗi) ⇒ phần đó trả rỗng, các phần khác vẫn chạy. Agent mù một phần vẫn tốt hơn phiên chết.

**Nối vào prompt:** `runSpecialistAgent` nhận thêm trường tuỳ chọn `repoContext?: RepoContextResult`; `buildUserPrompt` chèn thêm khối **"Nội dung file thật"** (thay vì chỉ tên), khối **"File phụ thuộc"**, khối **"Ngữ cảnh liên quan (RAG)"**. Khi `repoContext` vắng mặt ⇒ prompt **y hệt hiện tại** (không đổi hành vi cũ).

## 5. Thành phần 2 — Chạy nền + siết quyền

**Vì sao chạy nền:** chuỗi 3 agent trên model 30B mất **vài phút**; một tRPC mutation chặn sẽ timeout/đứt kết nối và để lại phiên treo ở `running`.

- **Chuyển tại chỗ** `run` / `runWorkflowChain` / `runModuleAudit` sang chạy nền: tạo hàng phiên (`status: "running"`), **trả `sessionId` ngay**, rồi chạy tiếp ở tiến trình nền (fire-and-forget, có `.catch`). *Không* tạo bản `start*` song song: 3 procedure này hiện **không có caller nào** (đã kiểm: 0 kết quả ngoài chính file router; router có đăng ký ở `server/routers.ts:660`), nên không có hợp đồng nào bị phá và một bản đồng bộ giữ lại sẽ là mã chết.
- Khi xong ⇒ `completeAiSpecialistSession(..., "completed")`; khi lỗi ⇒ `"failed"` + `summary` là thông điệp lỗi trung thực (cơ chế này **đã có sẵn** trong router hiện tại).
- FE poll `getSessionDetail` (2s/lần khi `running`, dừng poll khi `completed`/`failed`).
- **Chống phiên treo:** phiên `running` quá `AI_SPECIALIST_RUN_TIMEOUT_MS` (mặc định 900_000 = 15 phút) bị housekeeping đánh dấu `failed` (bám khuôn `aiAgentHousekeepingScheduler` đã có).
**Siết RBAC (vá lỗ hổng):** **toàn bộ** procedure của `aiSpecialistAgentRouter` — 9 cái hiện có **và** 2 cái thêm mới ở §7 (`submitFeedback`, `getQualityScoreboard`) — đổi từ `protectedProcedure` sang `roleProcedure("admin","engineer")` + `moduleGate("MOD_AI")`, khớp đúng khuôn `aiAgentCenterRouter.ts:22-46`. Tổng sau Wave 1: **11 procedure**, không còn cái nào để `protectedProcedure`.

## 6. Thành phần 3 & 4 — Mặt tiền

**Trang mới:** `client/src/pages/AISpecialistStudio.tsx`, route `/ai-specialist-studio`, mục nav nhóm **AI → Agent Operations**, `requiredRole: ['admin','engineer']` (đúng khuôn 6 màn đã mở ở Wave 0), bọc `RouteGuard navHref`.

4 thẻ:

1. **Giao việc** — chọn 1 trong 4 agent (`data-analyst` · `backend-engineer` · `frontend-engineer` · `qa-optimizer`) **hoặc** *chế độ chuỗi* (`includeBackend`/`includeFrontend`/`includeQa`). Form: **Mục tiêu** (bắt buộc, 10-8000 ký tự) · **Module** · **File liên quan** (nhập nhiều, kèm nút *"thêm file phụ thuộc"* lấy từ `code-graph.json`) · nhóm **Nâng cao** thu gọn (`currentBehavior`, `desiredBehavior`, `techStack`, `constraints`, `acceptanceCriteria`, `errorLogs`, `codeSnippet`). Có công tắc **"Cho agent đọc mã nguồn"** (mặc định BẬT) để đối chứng chất lượng có/không có mắt.
2. **Kết quả & Lịch sử** — hiện đủ 7 khối đúng hợp đồng đầu ra (`summary`, `diagnosis`, `actionPlan`, `patchHints`, `testPlan`, `optimizationIdeas`, `risks`) + model/token/thời gian + nút sao chép; danh sách phiên cũ (`listSessions` → `getSessionDetail`). Trong lúc `running`: hiện tiến trình theo bước, không giả lập phần trăm.
3. **Audit module** — 5 preset sẵn (`listModuleAuditPresets`), chạy 1 chạm (`startModuleAudit`).
4. **Chất lượng** — bảng điểm ở §7.

**Command Center:** trong `AgentDrillInDrawer.tsx`, nhánh `SimpleAgentDetail` cho agent kind `specialist` thay dòng *"chưa có hành động khả dụng"* bằng nút **"Giao việc →"** điều hướng `/ai-specialist-studio?agent=<id>` (Studio đọc query param để chọn sẵn agent). Các kind khác giữ nguyên.

**i18n:** mọi chuỗi qua `t(...)` với mặc định tiếng Việt; bổ sung khoá vào `vi.json` / `en.json` / `zh.json`.

## 7. Thành phần 5 — Thước đo kép

### (a) Chấm tay trên việc thật

Sau mỗi phiên `completed`, thanh chấm gọn ngay dưới kết quả:
- **Mức hữu ích** (bắt buộc, 1 trong 3): `useful` (Dùng được) · `partial` (Dùng được một phần) · `useless` (Vô dụng).
- **Lý do** (tuỳ chọn, ≤500 ký tự).
- **Khối nào hữu ích** (tuỳ chọn, nhiều lựa chọn): `diagnosis` · `actionPlan` · `patchHints` · `testPlan` · `optimizationIdeas` · `risks`.

**Bảng mới `ai_specialist_feedback`** (1 migration):

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | serial PK | |
| `sessionId` | integer NOT NULL | FK → `ai_specialist_sessions.id` |
| `userId` | integer NOT NULL | người chấm |
| `agentId` | varchar(64) NOT NULL | chép lại để truy vấn nhanh theo agent |
| `moduleName` | varchar(255) | chép lại |
| `rating` | varchar(16) NOT NULL | `useful` \| `partial` \| `useless` |
| `usefulSections` | json | mảng khoá khối |
| `reason` | text | |
| `repoContextUsed` | boolean NOT NULL default false | **có bật "mắt" hay không** — để đo mắt có giúp thật không |
| `createdAt` | timestamp default now() | |

Ràng buộc: **duy nhất theo `(sessionId, userId)`** — chấm lại thì ghi đè (UPSERT), không đếm trùng.

Procedure mới: `submitFeedback` (mutation) và `getQualityScoreboard` (query) → bảng điểm nhóm theo **agent × module**, mỗi dòng: tổng lượt, %`useful`, %`partial`, %`useless`, và **so sánh có-mắt / không-mắt**.

### (b) Bộ đề chuẩn chấm tự động

**File:** `scripts/ai-eval/eval-specialist.mjs` + bộ đề `scripts/ai-eval/specialist-cases/*.json`; lệnh `npm run eval:specialist`.

- **Đúng 8 bài, lấy từ bug THẬT đã sửa trong repo** (git history chính là đáp án). Ví dụ chốt sẵn 2 bài từ Wave 0: (i) `aiActionInbox` import một hàm không tồn tại nên nhánh anomaly luôn trả rỗng; (ii) mô tả VLM chỉ ghi vào `ai_image_embeddings.metadata` nên màn Sửa chữa không bao giờ hiển thị.
- Mỗi bài: `{ id, title, agentId, objective, files[], expected: { rootCauseKeywords[], mustMentionFiles[], fixDirectionKeywords[] }, notes }`.
- **Chấm:** 3 tiêu chí, mỗi tiêu chí 0-1, điểm bài = trung bình:
  1. *Đúng nguyên nhân* — đầu ra chứa đủ tỉ lệ `rootCauseKeywords` (ngưỡng ≥60% số từ khoá).
  2. *Đúng chỗ* — có nêu ít nhất một file trong `mustMentionFiles`.
  3. *Đúng hướng sửa* — chứa ≥1 từ khoá trong `fixDirectionKeywords`.
- Kết quả in bảng + ghi `knowledge/eval/specialist-<ISO>.json` để so sánh giữa các lần chạy/model.
- Chạy **thủ công** (không vào CI): mỗi lượt gọi model 30B tốn phút, không hợp cho CI.

## 8. Luật quyết định mức B (chốt trước để tránh tự huyễn hoặc)

Sau **≥20 lượt việc thật đã chấm** *và* **≥1 lần chạy bộ đề chuẩn**:

- Đầu tư mức B (tự sinh patch) **chỉ khi** tỉ lệ `useful` (toàn phần) **≥ 50%** *và* điểm bộ đề **≥ 60%**.
- Dưới ngưỡng ⇒ **không** làm B; tiền đổ vào cải thiện *mắt* (nạp thêm ngữ cảnh) và *prompt*, hoặc đổi model.
- Ghi nhận riêng: nếu chênh lệch **có-mắt vs không-mắt** dưới 10 điểm phần trăm ⇒ bộ đọc-repo chưa phát huy, phải sửa cách nạp ngữ cảnh trước khi bàn tới B.

## 9. An toàn

- **Mã nguồn không rời máy:** model GGUF chạy local ⇒ nội dung file không gửi ra dịch vụ ngoài.
- Bộ đọc-repo **chỉ-đọc**: không có bất kỳ đường ghi nào; không đăng ký vào `toolRegistry` nên LLM không thể tự gọi với tham số tuỳ ý — chỉ service gọi với danh sách file do **người dùng nhập**.
- Bí mật bị chặn hai lớp: chặn theo tên file, và `redactSecretsOnly()` trên nội dung.
- RBAC siết còn `admin` + `engineer`; đây là vá lỗ hổng đang tồn tại.
- Không migration phá huỷ: đúng **1 bảng mới**, không sửa/xoá cột cũ.

## 10. Kiểm thử

| Vùng | Kiểm thử bắt buộc |
|---|---|
| `repoContextService` | Mỗi luật chặn 1 test: tuyệt đối · `..` · NUL · thoát gốc · `.env` · `*.pem` · `node_modules/` · `.git/` · đuôi lạ · cắt theo `maxFileBytes` · `BUDGET_EXCEEDED` khi vượt tổng · redact có tác dụng · `code-graph.json` thiếu/hỏng ⇒ `dependencies: []` không ném · `retrieveKnowledge` ném ⇒ `ragSnippets: []` không ném |
| Chạy nền | `startRun` trả `sessionId` ngay và KHÔNG chờ model · lỗi trong tiến trình nền ⇒ phiên `failed` (không treo `running`) · phiên quá hạn bị housekeeping đánh `failed` |
| RBAC | `operator` gọi 9 procedure ⇒ bị từ chối · `engineer` và `admin` ⇒ qua |
| Feedback | UPSERT theo `(sessionId, userId)` không tạo dòng trùng · bảng điểm tính đúng % theo agent × module · tách đúng có-mắt/không-mắt |
| Prompt | Có `repoContext` ⇒ prompt chứa nội dung file thật; vắng ⇒ prompt **byte-identical** với hiện tại |
| Bộ đề | Chấm đúng trên 1 ca giả lập biết trước điểm |

Kiểm chứng trực tiếp (controller, sau khi xong): đăng nhập `engineer1`, chạy 1 việc thật có bật mắt trên một module có sẵn, xác nhận kết quả 7 khối + chấm điểm lưu được + bảng điểm lên số.

## 11. Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Model local quá yếu ⇒ lời khuyên chung chung, vô dụng | Đó chính là lý do có §7-§8: đo trước, quyết sau. Nếu số liệu xấu, **không** làm B — đây là kết quả hợp lệ, không phải thất bại. |
| Nạp file lớn làm tràn ngữ cảnh model | Cap 64KB/file + 256KB/lượt; cắt có báo `truncated`, hiện rõ trên UI |
| Phiên nền chạy mãi | Timeout 15 phút + housekeeping đánh `failed` |
| Người dùng tưởng agent đã sửa code | Chữ trên UI phải nói rõ đây là **khuyến nghị**, không có thay đổi nào được áp dụng |
| Lộ bí mật vào prompt | Chặn theo tên file + `redactSecretsOnly()`; model chạy local |

## 12. Tài liệu tham chiếu

- Hợp đồng đầu ra 4 agent: `server/services/aiSpecialistAgentService.ts:71-138`
- Router hiện tại: `server/routers/aiSpecialistAgentRouter.ts`
- Bảng phiên/bước: `drizzle/schema/ai.ts:1435-1480`
- Redactor: `server/services/ai/aiSafety.ts:254` (`redactSecretsOnly`)
- Truy hồi RAG: `server/services/aiLocalKnowledgeService.ts:1576` (`retrieveKnowledge`)
- Khuôn RBAC tham chiếu: `server/routers/aiAgentCenterRouter.ts:22-46`
- Khuôn housekeeping: `server/services/aiAgentHousekeepingScheduler.ts`
