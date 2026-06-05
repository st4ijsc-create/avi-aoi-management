# Kế hoạch chi tiết GĐ2 — Nền an toàn cho write-action (AI Copilot)

> Tạo 2026-06-05. Chốt: write-action LUÔN human-in-the-loop confirm + theo RBAC quyền user. GĐ2 = FRAMEWORK an toàn (chưa mở loạt write-tool; có 1 write-tool MẪU chứng minh luồng). KHÔNG code cho tới khi chủ dự án duyệt + chốt 6 quyết định cuối.

## Hiện trạng đã kiểm chứng (file:line) — 4 phát hiện then chốt
1. **API tin payload `userRole`** (`server/routes/aiLocalKnowledgeApi.ts:43-48 parseUserRole`) thay vì session → phải đổi sang `user.role/user.id` thật từ `sdk.authenticateRequest(req)` (`:180/:150`) cho MỌI quyết định write.
2. **`tryExecuteTool` (`aiLocalTools/index.ts:48`) chạy `tool.handler(args)` ngay** → điểm DUY NHẤT chèn nhánh read(chạy luôn)/write(trả pendingAction).
3. **GGUF KHÔNG có hàng đợi toàn cục** — mỗi lệnh tự `getSequence()` (`aiGgufEngine.ts:482/544/610/761/860`), `GGUF_SEQUENCES=4`. Cần semaphore.
4. **Audit đã đủ + append-only** (`auditTrailService.ts` → `audit_logs` `drizzle/0102_audit_log_rls_append_only.sql`) → tái dùng, chỉ thêm action constants. CHỈ cần bảng mới cho pendingAction (nếu chọn DB).

Tham chiếu chính: `aiLocalTools/{toolRegistry.ts:37-46, index.ts:24-54, handlers.ts, intentClassifier.ts:179/333}`, `aiChatAssistant.ts` (6 tool trùng), `aiLocalKnowledgeService.ts` (answerQuestion:1222 / streamAnswer:1489 / KbAnswerResult:76 / StreamEvent:1470), RBAC `_core/accessControl.ts:96-146` + `permissionsRouter.ts`, ctx.user `_core/trpc.ts:23-38`, write mẫu `spcAnalysisRouter.ts:660 saveSpecLimits`→`db.updateMeasurementPointDef product.ts:792` (versioning), `alertRouters.ts:120 acknowledge`.

---

## Mục 1 — Tool descriptor read vs write
Mở rộng `Tool` (`toolRegistry.ts:37`, field mới OPTIONAL, default `kind:'read'` → read-tool GĐ1 không đổi):
`kind:'read'|'write'` · `requiredPermission:{module,action}` · `summarize(args,lang)` (mô tả confirm, vi/en/zh) · `preview(args,ctx)→ActionPreview` (dry-run KHÔNG đổi DB: before/after/changes/warnings) · `execute(args,ctx)` (chỉ chạy sau confirm; ctx.user.id cho audit/changedBy). `handler` (read) giữ nguyên. `ActionPreview.changes` tái dùng `AuditChangeField` + `computeChanges` (`auditTrailService.ts:27/134`).
**Files:** sửa toolRegistry.ts (+ `isWriteTool`/`assertExecutable`); tạo writeHandlers.ts. **Test:** read-tool cũ vẫn read; write-tool MẪU đủ field.

## Mục 2 — Luồng HITL 2 pha (đề xuất → xác nhận → thực thi)
- **pendingAction store server-side** (quyết định: DB `ai_pending_actions` [khuyến nghị] vs in-memory TTL). Lưu: actionId(uuid), tool, **argsJson chốt server**, userId/role, requiredPermission, summary, previewJson, status(proposed|confirmed|executed|denied|expired|cancelled), idempotencyKey, expiresAt, resultJson.
- **Pha 1 (đề xuất):** write-tool → KHÔNG execute; gọi `preview`, tạo bản ghi `proposed`, trả `pendingAction{actionId, token, tool, args, summary, preview, expiresAt}` qua StreamEvent mới `pending_action` (stream) + field `pendingAction` trong `KbAnswerResult` (non-stream).
- **Pha 2 (xác nhận):** router mới `copilot.confirmAction({actionId, token})` (protectedProcedure): verify status/expiry/userId/token → **kiểm lại RBAC** → idempotency (đã executed → trả result cũ) → `execute(argsJson_từ_DB, ctx)` (KHÔNG nhận args client) → status=executed + audit. `cancelAction` → cancelled. Hết hạn → expired.
- **Token:** uuid + ràng userId + TTL (đề xuất 5'); tùy chọn HMAC.
**Files:** tạo `aiCopilotActions.ts`, `routers/aiCopilotRouter.ts`; sửa `aiLocalTools/index.ts`, `aiLocalKnowledgeService.ts`, `aiLocalKnowledgeApi.ts`, root router. **Migration (nếu DB):** `ai_pending_actions`. **Test:** propose không đổi DB; confirm sai user/expiry → chặn; double-confirm idempotent = 1 execute; cancel chặn.

## Mục 3 — RBAC gate (trước ĐỀ XUẤT và trước EXECUTE)
- Đổi nguồn role: API dùng `user.role/id` THẬT từ session; `parseUserRole(body)` chỉ còn ảnh hưởng giọng văn.
- Gate 2 lần qua `checkPermission(userId, role, module, action)` (`accessControl.ts:96`, admin pass): trước proposeAction + trước execute. Thiếu quyền → KHÔNG đề xuất + giải thích đa ngôn ngữ + audit `denied`.
- **Map write-tool→permission (cần chốt):** `set_spec_limits → settings_measurement_points/canEdit`; `acknowledge_alert → mqtt_alerts/canEdit`.
**Files:** sửa aiLocalKnowledgeApi.ts, aiLocalKnowledgeService.ts (truyền ctx), index.ts, aiCopilotActions.ts, writeHandlers.ts. **Test:** operator hỏi set spec → từ chối + audit; admin → đề xuất; đổi quyền giữa 2 pha → confirm chặn.

## Mục 4 — Queue/concurrency GGUF (bảo vệ VRAM 6GB)
Semaphore async toàn cục trong `aiGgufEngine.ts`: `GGUF_MAX_CONCURRENCY` (default **1** cho 4050) + hàng đợi FIFO + `GGUF_QUEUE_MAX` (backpressure) + `GGUF_INFER_TIMEOUT_MS`. Bọc `withGgufSlot` quanh 6 điểm inference (generateText/chatCompletion/generateJSON/generateTextStream/chatCompletionStream/generateEmbedding); stream giữ slot tới hết generator, release ở `finally`. Health phơi queueDepth/running.
**Files:** sửa aiGgufEngine.ts (+ tùy `ggufConcurrency.ts`), .env.example. **Test:** 5 lệnh đồng thời → tối đa 1 chạy; vượt queue → backpressure; timeout release slot; stream abort release đúng. **Nghiệm thu:** 3 user đồng thời không OOM trên 4050.

## Mục 5 — Hợp nhất 2 chat service
`aiLocalTools` là registry chuẩn DUY NHẤT. Viết lại RUỘT `processChat` (`aiChatAssistant.ts:161`) ủy quyền sang `classifyToolIntent`/`tryExecuteTool` — giữ NGUYÊN chữ ký `ChatRequest/ChatResponse` → `aiChatRouter` không đổi. Tool độc nhất (`run_root_cause_analysis`/`get_model_performance`) → cần chốt chuyển GĐ2 hay GĐ3. Mục tiêu: aiChatAssistant chỉ còn adapter mỏng (narration + offline). **Test:** aiChatRouter trả cùng shape; tool trùng cùng kết quả; offline giữ.

## Mục 6 — Audit log AI-action
Thêm `AUDIT_ACTIONS.AI_ACTION_{PROPOSED,CONFIRMED,EXECUTED,DENIED,CANCELLED}` + `ENTITY_TYPES.AI_ACTION` (`auditTrailService.ts:58/104`). Mỗi mốc gọi `logCrudOperation(createAuditContext({user,req}),{...})` ghi actionId/tool/permission/args(sanitize)/preview.changes/denyReason vào `details`. Execute thành công → thêm `logUpdate` thực thể đích (before/after). Tái dùng `audit_logs` (append-only) — KHÔNG migration. **Test:** mỗi mốc 1 log đúng; args nhạy cảm redact.

## Mục 7 — Write-tool MẪU
Chọn `set_spec_limits` (đã có versioning) làm MẪU chính (alert `acknowledge` dự phòng rủi-ro-thấp-hơn):
- descriptor: kind write, requiredPermission settings_measurement_points/canEdit, zod {measurementPointDefId, usl, lsl, target} (giống saveSpecLimits.input), summarize vi/en/zh, preview (đọc giá trị hiện tại + cảnh báo USL<LSL), execute → `db.updateMeasurementPointDef(...,{changedBy:ctx.user.id,changeReason:'AI Copilot'})`.
- intentClassifier: nhận diện "đặt spec/USL/LSL điểm đo" + trích args + zod + clarify nếu thiếu.
KHÔNG thêm write-tool khác (GĐ3). **Test:** preview không đổi DB; execute đổi measurement_point_defs + tạo version; thiếu quyền từ chối; USL<LSL warning.

## Mục 8 — An toàn (xuyên suốt)
Confirm bắt buộc (không auto-execute) · args chốt server-side · idempotencyKey unique · token+TTL+ràng userId · RBAC 2 lần + role từ session · offline-first · i18n vi/en/zh · audit append-only.

---

## Thứ tự triển khai
Mục 4 (queue, độc lập) → Mục 1 (descriptor) → Mục 6 (audit constants) → Mục 2+3 (HITL+RBAC, lõi) → Mục 7 (write-tool MẪU) → FE confirm card (`AILocalChatBubble.tsx:332-410`) → Mục 5 (hợp nhất, dọn nợ).

## Nghiệm thu tổng
Write MẪU: đề xuất→confirm→execute→audit, DB chỉ đổi sau confirm · thiếu quyền không đề xuất + audit denied · args server-side · idempotent + expiry/cancel · GGUF 3 user không OOM + backpressure · 1 registry, aiChatRouter backward-compat, read-tool GĐ1 không hồi quy · audit đủ mốc · i18n vi/en/zh · offline.

## ⚠️ 6 quyết định cần chủ dự án CHỐT trước khi code
1. **Nơi lưu pendingAction:** DB `ai_pending_actions` (khuyến nghị, cần migration) hay in-memory TTL (mất khi restart)?
2. **TTL + token:** TTL (đề xuất 5'); chỉ uuid+userId+TTL hay thêm HMAC?
3. **Map tool→permission:** xác nhận set_spec_limits→settings_measurement_points/canEdit; acknowledge_alert→đúng module?
4. **Write-tool MẪU:** `set_spec_limits` (đủ nhất, versioning) hay `acknowledge_alert` (rủi ro thấp nhất)?
5. **Phạm vi hợp nhất:** chuyển RCA/model_performance sang registry ngay GĐ2 hay GĐ3?
6. **GGUF concurrency:** mặc định 1 cho 4050; nâng khi lên 4090?
