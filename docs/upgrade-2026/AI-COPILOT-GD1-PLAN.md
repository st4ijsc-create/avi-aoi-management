# Kế hoạch kỹ thuật chi tiết — GĐ1 Quick Wins (AI Copilot 2026)

> Tài liệu KỸ THUẬT để chủ dự án duyệt **trước khi code**. Chưa có dòng code nào được viết.
> Nguồn gốc: `docs/upgrade-2026/AI-COPILOT-PLAN-2026.md` mục 5 — Giai đoạn 1.
> Phạm vi GĐ1: **C3a** (context-aware + mount bubble toàn cục), **C5** (role thật), **C1a** (KB auto-sync incremental theo hash), **zh** (tiếng Trung).
> Ràng buộc cứng: **offline-first** (GGUF, không phụ thuộc daemon), **backward-compatible** (không phá KB/chat hiện có), **đa ngôn ngữ vi/en/zh**, **KHÔNG đụng write-action** (mọi tool vẫn read-only).

---

## 0. Tóm tắt hiện trạng đã kiểm chứng (file:line thật)

| Hạng mục | File:line thật | Ghi chú |
|---|---|---|
| Bubble chat | `client/src/components/AILocalChatBubble.tsx` | role hard-code `:45` (`FIXED_USER_ROLE="engineer"`), gán `:180`, payload gửi `:310` và `:393` (fallback), không có `context` |
| Mount bubble | `client/src/components/DashboardLayout.tsx:421` (`<AILocalChatBubble />`) | CHỈ mount trong DashboardLayout |
| App root | `client/src/App.tsx:272-283` (`App()`), `Router()` `:146` | **Không có layout chung** — mỗi page tự bọc `DashboardLayout`. 112/118 page dùng DashboardLayout; các page AI (lazy, `AIPageWrapper` `:118`) KHÔNG bọc -> thiếu bubble |
| Endpoint stream | `server/routes/aiLocalKnowledgeApi.ts:149-250` | nhận `question/topK/history/userRole` `:156-164`; KHÔNG nhận context. (Lưu ý: file nằm ở `server/routes/`, không phải `server/routers/` như plan tổng ghi) |
| Endpoint ask (fallback) | `server/routes/aiLocalKnowledgeApi.ts:119-144` | cùng input shape |
| parseUserRole | `server/routes/aiLocalKnowledgeApi.ts:41-46` | validate theo `VALID_USER_ROLES` `:20-25` = `worker/engineer/manager/it_admin` |
| Orchestrator | `server/services/aiLocalKnowledgeService.ts` | `retrieveKnowledge` `:1131`, `answerQuestion` `:1222`, `streamAnswer` `:1375` |
| detectLanguage | `aiLocalKnowledgeService.ts:354-362` | trả `"vi" | "en"` |
| Type language | `aiLocalKnowledgeService.ts:47` (`KbRetrieveResult.language`), StreamEvent `:1358/1361` | cần mở rộng cho zh |
| Prompt theo role+ngôn ngữ | `getSystemPromptForRole` `:637-683` | chỉ nhánh vi/en |
| UserRole (AI) | `aiLocalKnowledgeService.ts:145` = `worker/engineer/manager/it_admin` | `rolToUserLevel` `:153-157` |
| UserRole (APP DB) | `server/db/auth.ts:12` = `admin/supervisor/quality_inspector/operator/maintenance/viewer/user`; cùng định nghĩa `server/_core/trpc.ts:65` | **KHÁC** AI UserRole -> cần map |
| useAuth (FE) | `client/src/_core/hooks/useAuth.ts:79-83` trả `user` (từ `trpc.auth.me`) | `user.role` là APP role |
| Tool registry | `server/services/aiLocalTools/toolRegistry.ts` | READ-ONLY (comment `:9`), `Tool` `:37-46` |
| Intent classifier | `server/services/aiLocalTools/intentClassifier.ts:163` (`classifyToolIntent`), `extractArgsForTool` `:107-155`, LLM JSON `:317` | **chỉ nhận `question`** — không nhận context |
| tryExecuteTool | `server/services/aiLocalTools/index.ts:24-54` | gọi classifyToolIntent(question) |
| Pre-fill args điểm vào | `intentClassifier.ts:117-119` (machine onlyOffline), `:140-145` (oee machineCode), `:108-116` (lot orderCode) | nơi context có thể bơm default |
| KB pipeline | `scripts/ai-kb/run-phase1.mjs` (extract->chunk->embed->graph), npm `kb:*` `package.json:19-24` | tuần tự, full |
| Chunk builder | `scripts/ai-kb/build-knowledge-chunks.mjs` | **ID tuần tự** `feature-${id++}` `:200`; **không có hash**; ghi đè full `:205` |
| Embed generator | `scripts/ai-kb/generate-embeddings.mjs` | ghi đè full (`flags:"w"` `:153`); embed `title\ntext` `:159`; GGUF mxbai 1024-dim |
| Embeddings meta | `knowledge/embeddings-meta.json` | 1195 chunk, `elapsedMs~=1.41M` (~23,5 phút full embed) -> động lực mạnh cho incremental |
| GGUF embed helper | `scripts/ai-kb/_gguf-embed.mjs` (`embedTextGguf`, `ggufEmbedModelName`, `disposeGgufEmbed`) | dùng cho incremental |
| i18n FE | `client/src/i18n/index.ts:9-12` (vi/en/zh đã có), `zh.json` tồn tại | UI đã hỗ trợ zh; backend chưa |

**Phát hiện then chốt ảnh hưởng thiết kế:**
1. **Không có store/context toàn cục cho machine/product đang chọn.** Selection là `useState` cục bộ từng page (vd `MachineHealthMonitoring.tsx:182` `selectedMachine: number|null`). -> C3a cần tạo cơ chế chia sẻ context (Context Provider nhẹ) hoặc tối thiểu chỉ gửi `route`.
2. **APP role != AI UserRole.** -> C5 bắt buộc có lớp map `app role -> AI UserRole`.
3. **Chunk không có hash & ID không ổn định** (tuần tự, đánh lại mỗi build). -> C1a phải đổi sang **ID ổn định theo nội dung/đường dẫn** + thêm `hash` thì incremental mới khả thi.
4. **`language` là union `"vi"|"en"`** lan khắp service + StreamEvent + API. -> zh cần mở rộng type ở nhiều điểm (backward-compatible: thêm nhánh, default vi).

---

## Workstream C5 — Role thật (làm TRƯỚC, rủi ro thấp nhất)

### Mục tiêu
Bỏ hard-code role ở client; lấy role thật của người đăng nhập, map sang 1 trong 4 AI UserRole, gửi đúng xuống backend (backend đã hỗ trợ). GĐ1 chỉ đổi **giọng văn/phạm vi prompt** theo role — **KHÔNG** gate write (write chưa tồn tại).

### Hiện trạng (file:line)
- `AILocalChatBubble.tsx:45` `FIXED_USER_ROLE="engineer"`; `:180` `const userRole = FIXED_USER_ROLE`; gửi ở `:310` (stream) và `:393` (fallback ask).
- Backend nhận & validate: `aiLocalKnowledgeApi.ts:41-46` (`parseUserRole`), set `worker/engineer/manager/it_admin`.
- AI UserRole: `aiLocalKnowledgeService.ts:145`; map level: `:153-157`.
- APP role thật: `server/db/auth.ts:12` (7 giá trị); FE đọc qua `useAuth().user.role` (`useAuth.ts:79`).

### Thiết kế
- Tạo **map thuần (pure) ở FE**: `appRole -> AIUserRole`:
  - `admin`, `maintenance` -> `it_admin`
  - `supervisor` -> `manager`
  - `quality_inspector` -> `engineer`
  - `operator` -> `worker`
  - `viewer`, `user` (mặc định) -> `worker`
- Bubble đọc `useAuth()`, suy ra `userRole` qua map; nếu chưa đăng nhập/đang load -> fallback `"engineer"` (giữ hành vi cũ, backward-compatible).
- Backend KHÔNG đổi (đã validate sẵn). Ghi chú GĐ2: backend nên tự lấy role từ `sdk.authenticateRequest(req)` thay vì tin payload (stream `:150` đã authenticate user nhưng chưa dùng role của user đó).

### Các bước
1. Tạo helper map `mapAppRoleToAiRole(appRole?)` (đặt cạnh bubble hoặc trong `client/src/lib/`). Pure, có default an toàn.
2. Trong `AILocalChatBubble.tsx`: import `useAuth`, thay `:180` bằng `const userRole = mapAppRoleToAiRole(useAuth().user?.role)`.
3. Xóa/đánh dấu deprecated `FIXED_USER_ROLE` `:45`.
4. (Tùy chọn) đổi badge "Chi tiết" header `:518-524` theo role.
5. (Ghi chú GĐ2, KHÔNG làm) backend lấy role từ session.

### Files thay đổi
- `client/src/components/AILocalChatBubble.tsx` (sửa `:45`, `:180`, import useAuth; tùy chọn header `:518`).
- (Tùy chọn) `client/src/lib/aiRole.ts` (mới) hoặc đặt map ngay trong bubble.

### Tests
- Unit `mapAppRoleToAiRole`: phủ 7 giá trị app + `undefined` -> đúng AI role.
- Manual: operator -> payload `userRole:"worker"`; admin -> `"it_admin"`; supervisor -> `"manager"`.
- Regression: giọng văn prompt đổi theo level (`getSystemPromptForRole` `:665-683`).

### Nghiệm thu
- Bubble gửi đúng AI role suy từ user thật; không còn cố định "engineer".
- Trả lời operator ngắn gọn; manager thiên KPI; engineer chi tiết kỹ thuật.

### Rủi ro
- Map sai kỳ vọng nghiệp vụ -> **cần chủ dự án xác nhận bảng map** trước khi code.
- Role tùy biến từ RoleBuilder (`/role-builder`) có thể ngoài 7 enum -> default an toàn (đã tính).

---

## Workstream zh — Tiếng Trung (làm cùng/ngay sau C5, độc lập)

### Mục tiêu
Hỏi tiếng Trung -> detect đúng `zh`, prompt + fallback bằng zh; KB retrieval vẫn chạy (corpus vi/en) nhưng trả lời zh. UI đã có zh sẵn.

### Hiện trạng (file:line)
- `detectLanguage` `aiLocalKnowledgeService.ts:354-362` chỉ vi/en.
- Type `language: "vi" | "en"`: `:47` (KbRetrieveResult), StreamEvent `:1358/1361`, lan sang `KbAnswerResult` (`extends KbRetrieveResult` `:59`).
- Prompt `getSystemPromptForRole` `:637-683` (nhánh vi/en).
- Fallback/refusal vi/en: `buildExtractiveAnswer` `:581-628`, `buildGracefulFallback` `:631-635`.
- API error language guess `aiLocalKnowledgeApi.ts:244` (regex vi).
- FE i18n có zh: `client/src/i18n/index.ts:12`, `zh.json`. `i18n.language` có thể = `"zh"`.

### Thiết kế
- Mở rộng union `"vi"|"en"` -> `"vi"|"en"|"zh"` ở `:47`, StreamEvent `:1358/1361`, mọi tham số `language:` (TypeScript sẽ liệt kê điểm cần vá; backward-compatible vì chỉ thêm nhánh).
- `detectLanguage`: thêm phát hiện ký tự Hán (CJK `一-鿿`) -> trả `"zh"` (đặt đầu hàm; không trùng dải vi).
- `getSystemPromptForRole`: thêm nhánh `zh` (GUARD/FORMAT/DEF/LIST dịch zh, giữ rubric: cấu trúc, code-fence, chống bịa, cấm nhắc Alibaba/AWS/GCP/Azure).
- Fallback/refusal: thêm nhánh zh `buildExtractiveAnswer` (`:585/:601/:605`) và `buildGracefulFallback` (`:631`).
- `buildFollowUpSuggestions` `:159-179`: thêm map zh (hoặc tạm dùng en cho zh ở GĐ1).
- **Liên kết C3a:** nếu FE gửi `uiLanguage`, backend ưu tiên ngôn ngữ trả lời: (1) ngôn ngữ phát hiện từ câu hỏi nếu rõ ràng; (2) câu mơ hồ/toàn mã -> dùng `uiLanguage`.

### Các bước
1. Mở rộng type union (`:47`, `:1358`, `:1361`, signature helper).
2. `detectLanguage` `:354`: `if (/[一-鿿]/.test(question)) return "zh";`.
3. `getSystemPromptForRole` `:637`: thêm hằng `ZH_*` + nhánh `if (language === "zh")` cho 3 role.
4. Nhánh zh cho `buildExtractiveAnswer` + `buildGracefulFallback`.
5. (Tùy chọn) zh cho `buildFollowUpSuggestions`.
6. API `:244`: thêm zh (nhỏ).
7. Áp dụng `context.uiLanguage` khi detect không chắc (xem C3a).

### Files thay đổi
- `server/services/aiLocalKnowledgeService.ts` (type, detectLanguage, prompt, fallback, followUp).
- (Tùy chọn) `server/routes/aiLocalKnowledgeApi.ts:244`.

### Tests
- Unit `detectLanguage`: tiếng Trung -> `"zh"`; "máy này sao rồi" -> `"vi"`; "machine status" -> `"en"`.
- Manual: UI=zh, hỏi tiếng Trung -> trả lời zh, có citations, không bịa.
- Regression: vi/en cũ không hồi quy.

### Nghiệm thu
- Hỏi tiếng Trung -> trả lời tiếng Trung grounded, có nguồn; vi/en không hồi quy.

### Rủi ro
- Corpus KB chủ yếu vi/en -> trả lời zh có thể "dịch" khái niệm; chấp nhận GĐ1, GUARD vẫn chống bịa.
- Retrieval query zh trên mxbai đa ngữ có thể yếu hơn; theo dõi, không chặn GĐ1.

---

## Workstream C3a — Context-aware + mount bubble toàn cục

### Mục tiêu
(a) Bubble biết **route hiện tại + machine/product đang chọn + ngôn ngữ UI**; (b) backend dùng context để ưu tiên KB theo trang & **pre-fill tham số read-tool**; (c) **mount bubble trên MỌI trang**.

### Hiện trạng (file:line)
- Payload không có context: `AILocalChatBubble.tsx:310` `{ question, topK, history, userRole }`.
- Endpoint không nhận context: `aiLocalKnowledgeApi.ts:156-164`.
- Pipeline không có context: `streamAnswer` `:1375`, `answerQuestion` `:1222`, `retrieveKnowledge` `:1131`.
- Tool classify chỉ theo `question`: `intentClassifier.ts:163`, args `:107-155`; pre-fill: machine `:117-119`, oee `:140-145`, lot `:108-116`.
- Mount `DashboardLayout.tsx:421`. App không có layout chung (`App.tsx:146-269`); page AI dùng `AIPageWrapper` `:118` (không bubble).
- **Không có store toàn cục cho selection** (useState từng page, vd `MachineHealthMonitoring.tsx:182`). Route lấy qua wouter `useLocation` (`DashboardLayout.tsx:147`). UI language qua `useTranslation().i18n.language`.

### Thiết kế

**Phần 1 — Mount toàn cục (tách khỏi DashboardLayout):**
- Di chuyển `<AILocalChatBubble />` từ `DashboardLayout.tsx:421` lên **App root** (`App.tsx`, cạnh `<Router/>` `:278`) -> phủ cả page AI lazy và mọi route.
- Bubble dùng `useAuth` + i18n + tRPC -> đảm bảo nằm trong các provider. Thêm guard `if (!user) return null` để ẩn ở `/login`.
- **Gỡ mount cũ** `DashboardLayout.tsx:421` để tránh **mount kép**.

**Phần 2 — Thu thập context ở FE (không đại tu store):**
- Tạo **AiCopilotContextProvider** (React Context nhẹ) tại App root: `{ selectedMachineCode?, selectedMachineId?, selectedProductCode?, selectedProductModelId?, selectedLot? }`.
- Hook `useSetCopilotContext()` để **page chủ động đăng ký** selection trong `useEffect`. GĐ1 chỉ tích hợp **2-3 page ưu tiên** (MachineHealthMonitoring, MachineStatusMonitor, ProductModels); page khác vẫn chạy với context rỗng (tiệm tiến, ít rủi ro).
- `route` lấy trong bubble (useLocation); `uiLanguage` từ i18n.
- Payload context: `{ route, uiLanguage, selectedMachineCode?, selectedProductCode?, selectedLot? }` (chỉ field có giá trị).
- Dùng **code** (chuỗi) thay id số vì tool nhận `machineCode`/`orderCode` (`handlers.ts:665/:172`). Page chỉ có id phải map sang code (hoặc set cả hai).

**Phần 3 — Backend nhận & dùng context (backward-compatible):**
- `aiLocalKnowledgeApi.ts`: thêm `parseContext(req.body?.context)` (whitelist field, ép kiểu, bỏ field lạ); thiếu -> `undefined`. Áp cho `/stream` `:156` và `/ask` `:127`.
- Mở rộng signature optional: `streamAnswer(...context?)` `:1375`, `answerQuestion(...context?)` `:1222`, `retrieveKnowledge(question, topK, context?)` `:1131`. Caller cũ vẫn biên dịch.
- **Retrieval boost theo trang:** trong `retrieveKnowledge` nếu có `context.route`, cộng `routeWeight` nhẹ cho chunk khớp feature của route (bảng map route->feature), nhân vào cạnh `typeWeight/langWeight` (`:1162-1167`).
- **Ngôn ngữ (liên kết zh):** detect không chắc -> dùng `context.uiLanguage`.
- **Pre-fill tool args:** truyền context xuống `tryExecuteTool(question, context?)` (`index.ts:24`) -> `classifyToolIntent(question, context?)` (`intentClassifier.ts:163`). Trong `extractArgsForTool`:
  - `get_machine_status`/`get_oee`: thiếu machineCode + `context.selectedMachineCode` -> dùng default (oee `:143`, machine `:117`).
  - `get_lot_status`: thiếu orderCode + `context.selectedLot` -> dùng (`:108-116`), tránh clarify thừa.
  - `get_model_metrics`: `context.selectedProductCode` -> (tùy chọn) lọc theo model.
  - Ưu tiên: **giá trị từ câu hỏi > context default**. Giữ validate zod (`:174/:238`).
- KHÔNG đụng write-action: mọi tool vẫn read-only.

### Các bước
1. FE Provider `client/src/contexts/AiCopilotContext.tsx` (Context + hook); bọc tại `App.tsx`.
2. FE mount toàn cục: thêm `<AILocalChatBubble />` vào `App.tsx`; guard `if (!user) return null`; **gỡ** `DashboardLayout.tsx:421`.
3. FE bubble đọc context (route/uiLanguage/selection) -> thêm vào body `:310` và `:393`.
4. FE tích hợp page ưu tiên: `MachineHealthMonitoring.tsx` (+1-2 page) gọi `useSetCopilotContext` theo selection (map id->code nếu cần).
5. BE parse context: `aiLocalKnowledgeApi.ts` `parseContext` + truyền vào `streamAnswer`/`answerQuestion` (`:197`, `:136`).
6. BE signature: mở rộng `streamAnswer` `:1375`, `answerQuestion` `:1222`, `retrieveKnowledge` `:1131` nhận `context?` + type `KbQueryContext`.
7. BE retrieval boost: `routeWeight` quanh `:1162` + bảng map route->feature.
8. BE tool pre-fill: mở rộng `tryExecuteTool` (`index.ts:24`), `classifyToolIntent`+`extractArgsForTool` (`intentClassifier.ts`).
9. BE ngôn ngữ: áp `context.uiLanguage` khi detect không chắc.

### Files thay đổi
- `client/src/contexts/AiCopilotContext.tsx` (mới).
- `client/src/App.tsx` (Provider + mount + guard).
- `client/src/components/AILocalChatBubble.tsx` (đọc context, payload `:310/:393`).
- `client/src/components/DashboardLayout.tsx` (gỡ mount `:421`).
- 2-3 page ưu tiên (vd `client/src/pages/MachineHealthMonitoring.tsx`).
- `server/routes/aiLocalKnowledgeApi.ts` (parseContext + truyền xuống).
- `server/services/aiLocalKnowledgeService.ts` (signature + retrieval boost + ngôn ngữ).
- `server/services/aiLocalTools/index.ts`, `server/services/aiLocalTools/intentClassifier.ts` (pre-fill args).

### Tests
- BE unit: `parseContext` lọc field lạ, ép kiểu, thiếu -> undefined.
- BE unit: `extractArgsForTool("get_machine_status", q, ctx)` — câu không nêu máy + ctx có machineCode -> dùng ctx; câu nêu máy khác -> ưu tiên câu hỏi.
- BE unit: detect + override theo uiLanguage cho câu mơ hồ.
- FE: bubble hiện trên page AI (`/ai-hub`) và page thường; chỉ 1 bubble; ẩn ở `/login`.
- E2E thủ công: `/machine-health` chọn AOI-01, hỏi "máy này sao rồi?" -> tool chạy đúng AOI-01 không cần gõ mã.

### Nghiệm thu
- Bubble phủ mọi trang (kể cả AI lazy), không mount kép, ẩn khi chưa login.
- "máy này sao rồi?"/"OEE máy này?" ở trang máy đang chọn -> đúng máy không cần nêu mã.
- Backward-compatible: payload không context vẫn chạy đúng.

### Rủi ro
- **Mount kép** nếu quên gỡ `:421` -> checklist bắt buộc.
- **Provider/tRPC** ở App root: bubble dùng `trpc.aiLocalKb.health` (`:188`) -> phải trong tRPC provider; xác nhận cây provider trước khi di chuyển.
- **Tin client cho pre-fill:** backend vẫn validate zod + read-only (an toàn, không write); GĐ2 cân nhắc kiểm tra quyền xem máy.
- **Map id->code:** page chỉ giữ id số cần map; giới hạn GĐ1 ở vài page đã kiểm chứng.

---

## Workstream C1a — KB auto-sync incremental theo hash

### Mục tiêu
Code/feature/doc đổi -> chỉ **re-extract + re-chunk + re-embed phần thay đổi** (theo hash), tránh full ~23,5 phút. Offline, GGUF embed. Trigger: npm script incremental + tùy chọn git hook/watch.

### Hiện trạng (file:line)
- Full tuần tự: `run-phase1.mjs`; npm `kb:*` `package.json:19-24`.
- Chunk `build-knowledge-chunks.mjs`: ID **tuần tự** (`feature-${id++}` `:200`, `doc-${id++}` `:169`...), **không hash**, ghi đè full `:205`.
- Embed `generate-embeddings.mjs`: đọc toàn bộ chunks, ghi đè `embeddings.jsonl` (`flags:"w"` `:153`); embed `title\ntext` `:159`; GGUF mxbai 1024-dim qua `_gguf-embed.mjs`.
- Meta `embeddings-meta.json` (1195 chunk, ~1.41M ms).
- Service đọc: `ensureDataLoaded` `:436-456` (map theo id); reload `reloadKbArtifacts` (nút "Làm mới" `AILocalChatBubble.tsx:189`).

### Thiết kế

**Nền bắt buộc — ID ổn định + hash:**
- Sửa `makeChunk` (`build-knowledge-chunks.mjs:87`):
  - `id` ổn định = hàm của `sourcePath` + part (vd `feature:knowledge/features/x.md#3`) thay số tăng dần -> thêm/sửa 1 file không xê dịch id file khác.
  - thêm `hash` = sha256 của `title\ntext` (khớp đúng chuỗi đem embed).
- Tương thích ngược: service chỉ dùng id/sourcePath/title/text/keywords -> đổi format id không phá đọc; nhưng **lần đầu phải chạy full 1 lần** (one-time migration) để tái tạo id mới.

**Incremental embed:**
- Script mới `scripts/ai-kb/embed-incremental.mjs`:
  1. Đọc `chunks.jsonl` mới (có hash, id ổn định).
  2. Đọc `embeddings.jsonl` cũ -> map `id -> { hash, embedding }` (embeddings.jsonl cần lưu thêm `hash`).
  3. Chunk id tồn tại + hash khớp -> **tái dùng embedding** (không gọi GGUF). Mới/đổi hash -> embed lại. Biến mất -> bỏ.
  4. Ghi lại `embeddings.jsonl` đầy đủ theo thứ tự chunks; cập nhật meta `{ reused, reembedded, removed }`.

**Incremental extract/chunk:**
- Extract + chunk hiện rẻ (vài giây) -> GĐ1 chạy full extract+chunk mỗi lần, chỉ embed incremental (đơn giản, an toàn, tất định). Watch/extract-incremental để GĐ sau.

**Trigger (đơn giản -> mạnh):**
1. **npm** `kb:sync` = extract -> chunk -> embed-incremental (khuyến nghị); thêm `kb:embed:incremental`.
2. **git pre-push (tùy chọn)** chạy `kb:sync` khi đổi `knowledge/**`, `docs/**`, `apidocs/**`, router/service extract. Bật khi chủ dự án đồng ý.
3. **watch dev (tùy chọn)** `kb:watch` theo dõi `knowledge/**`+`docs/**`, debounce -> `kb:sync`.
- Tất cả offline GGUF (`USE_LEGACY_OLLAMA=false` mặc định `generate-embeddings.mjs:16`).

### Các bước
1. Chunk: sửa `build-knowledge-chunks.mjs` — id ổn định `sourcePath#part`, thêm `hash` (sha256 `title\ntext`). Đổi chính `makeChunk` (`:87`) là đủ cho mọi caller (`:119/130/141/153/169/184/200`).
2. Embed full: sửa `generate-embeddings.mjs` ghi kèm `hash` (`:170-179`) — phục vụ incremental & rollback.
3. Script `scripts/ai-kb/embed-incremental.mjs` (reuse-by-hash).
4. npm scripts `package.json:18-24`: `kb:embed:incremental`, `kb:sync`, tùy chọn `kb:watch`.
5. One-time migration: chạy `kb:phase1` (full) 1 lần để tái tạo id+hash. Ghi runbook.
6. (Tùy chọn) git hook `pre-push` gọi `kb:sync` có điều kiện.
7. Tài liệu vận hành ngắn (runbook/README scripts).

### Files thay đổi
- `scripts/ai-kb/build-knowledge-chunks.mjs` (id ổn định + hash).
- `scripts/ai-kb/generate-embeddings.mjs` (ghi kèm hash).
- `scripts/ai-kb/embed-incremental.mjs` (mới).
- `package.json` (script).
- (Tùy chọn) git hook hoặc `scripts/ai-kb/kb-watch.mjs` (mới).

### Tests
- Unit hash + id ổn định (cùng nội dung -> cùng id+hash; đổi 1 ký tự -> đổi hash, id giữ).
- Tích hợp `kb:sync`: lần 2 không đổi -> `reembedded=0`; sửa 1 feature -> chỉ chunk đó re-embed; count đúng.
- Đối chiếu vector chunk không đổi khớp full (`verify-embedding-cosine.mjs`).
- Service: sau sync, `reloadKbArtifacts` nạp được; bubble trả lời nội dung mới.

### Nghiệm thu
- Sửa 1 feature md -> `kb:sync` nhanh (chỉ re-embed phần đổi), embeddings đồng bộ, KB phản ánh sau reload.
- Không đổi -> 0 re-embed.
- Retrieval không hồi quy (cosine khớp full).

### Rủi ro
- Đổi format id -> cần 1 lần full migration; quên -> incremental coi tất cả "mới" (vẫn đúng, chỉ chậm).
- `embeddings.jsonl` cũ chưa có hash -> lần đầu không reuse (one-time).
- Hash phải đúng chuỗi embed thực (`title\ntext`, `:159`) nếu không reuse sai.
- Chunk dài bị co khi embed (`embedWithRetry` `:103-133`): hash trên text gốc vẫn ổn định để quyết định re-embed (cùng input -> cùng output).

---

## Thứ tự triển khai đề xuất (GĐ1)

1. **C5 (role thật)** — nhỏ, rủi ro thấp nhất, không phụ thuộc. Cần chốt **bảng map app role -> AI role** trước.
2. **zh** — độc lập backend, song song/ngay sau C5. UI đã sẵn zh.
3. **C3a** — lớn nhất; tách 2 phần: (3a) mount toàn cục + gửi `route`/`uiLanguage` (làm trước); (3b) selection context + pre-fill tool (tích hợp dần vài page). Hưởng lợi `uiLanguage` từ zh.
4. **C1a** — độc lập (scripts + package.json), song song bất kỳ lúc nào; cần 1 lần full migration.

Lý do: rủi ro tăng dần; zh nên xong trước phần ngôn-ngữ của C3a; C1a cô lập khỏi runtime chat.

---

## Nghiệm thu tổng GĐ1

- [ ] **C5:** bubble gửi AI role suy từ user thật; giọng văn đổi theo role; fallback an toàn.
- [ ] **zh:** hỏi tiếng Trung -> trả lời zh grounded; vi/en không hồi quy.
- [ ] **C3a:** bubble phủ mọi trang (không kép, ẩn khi chưa login); "máy này sao rồi?" ở trang máy đang chọn -> đúng máy không cần nêu mã; payload không-context vẫn chạy.
- [ ] **C1a:** `kb:sync` incremental — sửa 1 file chỉ re-embed phần đổi; không đổi -> 0 re-embed; retrieval khớp full.
- [ ] **Ràng buộc:** offline-first (GGUF, không daemon); backward-compatible; KHÔNG thêm write-action; mọi tool vẫn read-only.

---

## Phụ lục — Quyết định cần chủ dự án chốt trước khi code

1. **Bảng map app role -> AI UserRole** (C5) — xác nhận quality_inspector=engineer, maintenance=it_admin đúng nghiệp vụ?
2. **Phạm vi page tích hợp selection context GĐ1** (C3a 3b) — đề xuất: MachineHealthMonitoring, MachineStatusMonitor, ProductModels. Thêm page nào?
3. **Trigger KB auto-sync** (C1a) — chỉ npm `kb:sync` thủ công, hay bật thêm git pre-push hook / watch dev?
4. **Chấp nhận one-time full migration** cho đổi format chunk id (C1a) — xác nhận lịch chạy (~23,5 phút).
