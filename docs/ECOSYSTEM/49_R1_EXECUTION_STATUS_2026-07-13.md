# 49 — R1 THỰC THI: WIRING + ACTIVATION (doc 48 R1) · 2026-07-13

User duyệt D1-D6: **R1-R4 · dev-DB · WORM+bypass+RBAC · llama-server**. Đây là trạng thái R1 (đợt kích-hoạt + wiring, đòn bẩy cao nhất). Wiring committed; activation = runtime config (dev .env — gitignored) + DB role, verify LIVE.

## ✅ R1 WIRING — committed `fea31483` (flag-gated, green: tsc 0 · build OK · 55 test)
- **T4** exec-summary/chat hết chạy nhầm model EMBEDDING: `NarrativeRequest.modelId` thread xuống engine + forward `decision.modelId` (exec-report/ops-chat/RCA) + warm deep-model TRƯỚC embedder. Guard honest-degrade giữ nguyên.
- **T1** SAFETY_BLOCKED preflight vào `commandDispatcher.dispatchCore` (BLOCKED→từ chối; UNKNOWN→allow honest) + seed `0270` safety_plc sim + 7 test. Cờ `OT_SAFETY_PREFLIGHT_ENABLED`.
- **T3** action `device_write`→`ot.command.<verb>` (khớp deny-group) + 2 allow-policy as-code `line.command.*`/`order.command.*` (PERMIT khi actor) → bật default-deny KHÔNG vỡ FSM.
- **T2** `installTelemetryStreamTap()` boot-call (server/_core/index.ts, đúng process ingest), cờ `STREAM_TELEMETRY_TAP_ENABLED`, honest 3-trạng-thái.

## ✅ R1 ACTIVATION trên DEV — verify LIVE
| Món | Cờ/thao tác | Verify LIVE | Trạng thái |
|---|---|---|---|
| **T2 Streaming bus** | STREAM_BRIDGE_BACKEND=nats · NATS_URL · STREAM_TELEMETRY_TAP_ENABLED | boot: `installed → backend=nats (durable=true, transport ready)` | ✅ **LIVE** (0%→wired) |
| **WORM audit** | GRANT-lại avi_app full-DML + REVOKE UPD/DEL/TRUNC audit + ALTER ROLE LOGIN · DATABASE_URL→avi_app | app boot+CRUD OK; **avi_app DELETE audit_logs → "permission denied"**; INSERT=t/DELETE=f | ✅ **ENFORCED** (kiểm soát #1 SL2) |
| **T4 W5 advisory** | TWIN_FIDELITY · RUL_WEIBULL · FEATURE_STORE · ADVICE_CONTRACT · PARAM_GUARDRAIL | app healthy, honest-empty (chưa data) | ✅ ON |
| **T4 AI model-pin** | (code, không cờ) | exec/chat pin deep-model; VRAM fail→offline honest | ✅ active (live-gen chờ R5 llama-server) |
| **T1 Safety adapter** | SAFETY_PLC_ADAPTER_ENABLED + seed 0270 | config all-clear → OK (thay UNKNOWN) | ✅ ON |
| **T2 UNS v2 + schema** | UNS_TOPIC_V2_ENABLED · CONTRACT_VALIDATE_INGEST_MODE=log | dual-publish syn/; schema log-mode | ✅ ON |
| **T3 Orchestration** | SEC_PLATFORM · POLICY_STORE_ENABLED · LINE_CONTROLLER · ORDER_LIFECYCLE · QT_TEMPLATES | **policy_definitions 0→9 auto-load**; lineController 200; app healthy, 0 boot-error | ✅ loaded+enabled (runtime-evidence chờ trigger) |
| **Migrations** | db:push 0269 (RBAC backfill) + 0270 (safety seed) | applied OK | ✅ |

## ⏳ CÒN LẠI R1 — HOÃN sang staging/R2 (có lý do, KHÔNG force trên dev)
- **POLICY_DEFAULT_DENY** (line/order/ot.command.*): allow-policy + namespace-fix đã sẵn → an toàn BẬT, nhưng verify "transition PERMIT" cần trigger FSM (admin/2FA hoặc sim R2). Bật khi R2 có trigger để chứng minh, tránh bật-mù.
- **OT_GATEWAY_ENABLED**: cần OT adapter/endpoint thật → **staging** (trên dev không thiết bị = chỉ noise ECONNREFUSED). OT_CONTROL_ENABLED=true đã sẵn.
- **Tắt LICENSE_BYPASS**: cần license server (192.168.8.6:3001) + license.lic hợp lệ → **staging/production** (trên dev tắt = khoá module). Không phải lỗ hổng auth — là license-enforcement.
- **Tắt MACHINE_SHARED_KEY_ALLOWED**: cần xoay khoá mọi máy sang per-device → **staging** (trên dev tắt = rớt auth máy sim).
- **SECRET_MANAGER/SIEM**: cần OpenBao nạp secret + SIEM endpoint → R1-tiếp/R3.

## Kế tiếp
R2 (rolling-sim + seed e-SOP/AI + benchmark) → sẽ có trigger để bật+chứng minh POLICY_DEFAULT_DENY + FSM runtime evidence. R3 infra. R4 correctness+RBAC. R5 llama-server.

**Backup:** `.env` gốc lưu tại scratchpad `.env.pre-r1-activation.bak` (rollback nếu cần). avi_app password dev: `avi_app_worm_2026` (dev-only, đổi ở production).
