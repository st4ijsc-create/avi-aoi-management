# Kế hoạch chi tiết GĐ3 — Agentic Execution + Playbook (AI Copilot)

> Tạo 2026-06-06. Tài liệu kỹ thuật để chủ dự án duyệt **trước khi code**. Mọi write VẪN dùng khung GĐ2 (HITL propose→confirm→execute + RBAC 2 lần + audit append-only; args chốt server-side; idempotency; offline-first; i18n vi/en/zh). GĐ3 = mở loạt write-tool **tái dùng endpoint sẵn** + vòng agentic nhiều bước + playbook SOP. KHÔNG viết lại nghiệp vụ.

## 0. Hiện trạng GĐ2 (đã kiểm chứng) — nền để cắm GĐ3
`toolRegistry.ts:77-114` descriptor read/write + isWriteTool/assertExecutable · `writeHandlers.ts:107-140` MẪU set_spec_limits (KHUÔN) · `index.ts:60-79` nhánh write→proposeAction · `aiCopilotActions.ts` propose/confirm/cancel + RBAC#1/#2 + idempotency + audit · `aiCopilotRouter.ts` · `drizzle/0114 ai_pending_actions` · `accessControl.ts:96 checkPermission` · `auditTrailService.ts:104 AI_ACTION_*` · `aiGgufEngine.ts withGgufSlot + generateJSON:594` · FE `AILocalChatBubble.tsx` confirm card · `AiCopilotContext.tsx` selection.

**4 phát hiện then chốt:**
1. Khung HITL chỉ 1 write/lượt → GĐ3b cần lớp **session/plan** ĐỨNG TRÊN, không sửa lõi.
2. Write-tool KHÔNG match trigger chung (`intentClassifier.ts:119`) → với 10+ tool cần **LLM planner (generateJSON grammar)** chọn tool+args thay regex tay.
3. KHÔNG có permission module `ai_*` (74 module cố định) → map vào module sẵn (`annotation_ai`, `analytics_*`, `reports_create`...), không tạo module mới.
4. Nhiều endpoint giá trị cao là **adminProcedure + 2FA** (edge deploy, eval/anomaly buildDataset/startPipeline) → write-tool bọc chúng phải gate permission admin-equiv hoặc cờ `requiresAdmin`, xếp rủi ro cao/ưu tiên sau.

---

## Mục 1 — GĐ3a: Catalog write-tool (tái dùng endpoint, từng tool qua HITL)
KHUÔN mỗi tool (theo `set_spec_limits`): zod strict + summarize(lang) + preview(dry-run diff, KHÔNG đổi DB) + execute(gọi db/service sẵn, `changedBy:ctx.user.id`) + requiredPermission.

**Bảng catalog (tool | permission | endpoint tái dùng | rủi ro | ưu tiên):**

| Nhóm | Tool | requiredPermission | Endpoint/db | Rủi ro | Ưu tiên |
|---|---|---|---|---|---|
| A | `acknowledge_alert` | mqtt_alerts/canEdit | `db.acknowledgeAlert` alertRouters:120 | Thấp | 1 |
| A | `acknowledge/resolve_predictive_alert` | analytics_predictive_alerts/canEdit | predictive alert router | Thấp | 1 |
| B | `set_spec_limits` (ĐÃ CÓ) | settings_measurement_points/canEdit | updateMeasurementPointDef | Vừa | (xong) |
| B | `create_measurement_point` | settings_measurement_points/canCreate | createMeasurementPointDef productRouters:527 | Vừa | 2 |
| B | `update_measurement_point` | settings_measurement_points/canEdit | updateMeasurementPointDef:710 | Vừa | 2 |
| B | `set_yield_threshold` | settings_yield_thresholds/canEdit | yieldThresholdRouter:179/235 | Vừa | 3 |
| C | `run_full_spc_analysis` | analytics_spc/canExport | spcAnalysisRouter.fullAnalysis | TB (nặng, không ghi cấu hình) | 4 |
| C | `generate_pdf_report` | reports_create/canCreate | pdfReportRouter/reportBuilder | TB | 4 |
| C | `open/close_production_session` | production_orders/canCreate-Edit | productionSessionRouter:114/154 | Cao | 4 |
| C | `build_dataset`/`build_anomaly_bank`/`start_train_pipeline` | annotation_ai/canCreate (admin-equiv) | aiEvalRouter:25/124, aiAnomalyRouter:95 | Cao | 5 |
| C | `deploy_edge_model` | admin-equiv | edgeDeploymentRouter:56 | Rất cao | 6 |
| client | `navigate`, `prefill_form` | (quyền xem) | — KHÔNG ghi DB | — | 1 |

**Files:** `writeHandlers.ts` (hoặc tách `writeHandlers/{alerts,measurementPoint,session,train,report}.ts`) + `index.ts` import; read helper getById nếu thiếu. **Migration:** KHÔNG. **Test:** preview không đổi DB; execute gọi đúng db + changedBy; thiếu quyền→denied+audit; zod strict.

---

## Mục 2 — GĐ3b: Multi-step agentic (plan-execute)
Lớp `aiAgentOrchestrator` ĐỨNG TRÊN HITL (không sửa lõi):
1. **Planner** `generateJSON` (grammar) sinh `{goal, steps:[{kind:read|write|guidance, tool?, args?, rationale}], maxSteps}` từ `listTools()` + ngữ cảnh (route/selection), temperature 0.
2. **Trạng thái phiên** bảng `ai_agent_sessions` (sessionId, userId, goal, planJson, cursor, status(planning|awaiting_confirm|running|paused|done|aborted|failed), stepResults, linkedActionIds[]→ai_pending_actions, maxSteps, TTL).
3. **Vòng lặp:** planning→user duyệt plan→running; read-step chạy luôn; **write-step → proposeAction (lõi GĐ2) → confirm RIÊNG** → advance; guidance→hiện text. Lỗi/denied→paused, hỏi user.
4. **An toàn:** `AGENT_MAX_STEPS`(6), `AGENT_MAX_WRITES_PER_SESSION`(3); mỗi write confirm riêng (không auto-chain); KHÔNG rollback tự động → lỗi giữa chừng dừng + liệt kê bước đã/chưa làm; TTL + idempotency GĐ2.
5. StreamEvent mới `agent_plan`/`agent_step`; agentic mode mặc định TẮT, bật theo role (manager/it_admin trước).

**Files:** tạo `aiAgentOrchestrator.ts`, `aiAgentRouter.ts`; sửa `drizzle/schema/ai.ts`(+aiAgentSessions)+migration `0115`, `aiLocalKnowledgeService.ts`(StreamEvent), FE bubble (render plan + Bắt đầu/Tiếp/Dừng). **Test:** planner JSON hợp lệ; write-step chỉ advance sau confirm; giới hạn bước/writes; lỗi→paused sạch.

---

## Mục 3 — GĐ3c: Playbook/SOP tương tác
- **Định dạng khai báo** `knowledge/workflows/<slug>.playbook.yaml`: `steps:[{type:guidance|navigate|prefill|tool|confirm|branch, text{vi,en,zh}, tool?, argsTemplate?, route?, branch?}]` + requiredPermission. Playbook = **plan TĨNH do người soạn** (an toàn/tất định hơn LLM plan), chạy trên cùng engine GĐ3b; step type=tool đi qua HITL.
- Nguồn: chuyển 4-5 SOP `howto-*.md` giá trị cao → playbook: "Tạo điểm đo + spec", "Xử lý NG tăng/điều tra", "Đổi ca", "Cài máy AOI mới", "Train model defect".
- Lưu tiến trình: tái dùng `ai_agent_sessions` (+ cột `playbookId` nullable). UI card playbook + tiến trình bước.

**Files:** `knowledge/workflows/*.playbook.yaml` (4-5), `aiPlaybookEngine.ts`+`aiPlaybookLoader.ts` (hoặc mở rộng orchestrator), (tùy) `aiPlaybookRouter.ts`, ALTER thêm `playbookId`, FE. **Test:** validator schema; step tool→proposeAction; navigate/prefill không ghi DB; branch đúng nhánh.

---

## Mục 4 — Hợp nhất chat service (hoãn từ GĐ2 mục 5)
`processChat` (`aiChatAssistant.ts`) ủy quyền sang `tryExecuteTool` registry chuẩn; giữ chữ ký ChatRequest/ChatResponse → `aiChatRouter` không đổi. aiChatAssistant chỉ còn narration + offline. **Test:** aiChatRouter cùng shape; hết trùng tool.

## Mục 5 — Navigation/Prefill assist (KHÔNG ghi DB)
2 tool client-side: `navigate{route: enum whitelist từ App.tsx}` + `prefill_form{route, values}`. Backend trả directive qua StreamEvent `client_action`; FE thực thi (wouter setLocation + bơm giá trị qua AiCopilotContext). KHÔNG mutate DB → không cần HITL-write (chỉ quyền xem). **Test:** route lạ từ chối; prefill không gọi DB.

## Mục 6 — An toàn xuyên suốt
Mọi write qua HITL+RBAC+audit GĐ2; multi-step hiện plan trước + confirm từng write + giới hạn; navigate/prefill whitelist không ghi; nhóm C admin-equiv; offline GGUF queue; i18n vi/en/zh.

---

## Thứ tự triển khai
1. GĐ3a Nhóm A (ack) + Mục 5 navigate (quick win, rủi ro thấp).
2. GĐ3a Nhóm B (điểm đo/spec/yield — versioning sẵn).
3. GĐ3b multi-step (orchestrator + ai_agent_sessions; LLM planner thay regex).
4. GĐ3c playbook (4-5 playbook nối GĐ3a, tái dùng engine GĐ3b).
5. GĐ3a Nhóm C (session/train/edge — rủi ro cao, sau khi agent ổn).
6. Mục 4 hợp nhất chat (dọn nợ, song song).

## Nghiệm thu tổng
Catalog A+B qua HITL (propose→confirm→execute→audit, DB đổi sau confirm, thiếu quyền denied) · multi-step 2-3 bước trọn (plan trước, confirm từng write, giới hạn hiệu lực, lỗi dừng sạch) · ≥1 playbook trọn · navigate/prefill không ghi DB · 1 registry chat backward-compat · offline + i18n + read-tool GĐ1/write MẪU GĐ2 không hồi quy.

## ⚠️ 8 quyết định cần chủ dự án CHỐT
1. Bộ tool GĐ3a ưu tiên: Nhóm A+B trước, Nhóm C hoãn? 
2. Map permission AI/train (không có `ai_*`): `annotation_ai`/canCreate cho train/dataset/anomaly; `reports_create`; `analytics_spc`?
3. Tool bọc adminProcedure (Nhóm C): permission admin-equiv (`admin_system`) hay cờ `requiresAdmin` (+2FA?)
4. Bật multi-step (GĐ3b) ngay hay sau GĐ3a? Bật role nào trước (manager/it_admin)?
5. Giới hạn agent: AGENT_MAX_STEPS=6, MAX_WRITES_PER_SESSION=3 — chốt số?
6. Playbook: YAML hay JSON? 4-5 playbook ưu tiên?
7. Dùng LLM planner (generateJSON) chọn tool+args thay regex từng tool — đồng ý?
8. Bảng mới `ai_agent_sessions` (migration 0115) — duyệt?
