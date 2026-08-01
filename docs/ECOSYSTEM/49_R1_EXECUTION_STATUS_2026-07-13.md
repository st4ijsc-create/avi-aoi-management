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

## ✅ R2 (Data & Proof) — DONE, commit `5013a0bc` + verify LIVE
| Món | Kết quả LIVE |
|---|---|
| **Rolling-sim daemon** (`npm sim:live`) | Dashboard render LIVE: **warRoom OEE 84.4, output 2755, asOf 2026-07-13** (hết stale 07-12); andon=5; **planVsActual 93.96%** (trước 1557%). ~8265 SIM-LIVE row/tick, rotation 7d, --purge. |
| **e-SOP** (`npm sim:esop`) | 5 SOP thật/31 step + **1 execution end-to-end qua state-machine THẬT** (gate INCOMPLETE + INPUT_MISMATCH → completed). sops/steps/exec **0/0/0→5/31/1**. |
| **AI backfill** (`npm ai:backfill`) | Service THẬT: ai_image_embeddings **0→990** · anomaly_bank **0→49** · ai_models **0→2** · model_versions **0→1 staged** · feature_cache **0→390** · rul→145. **HONEST: 14,730 inspection KHÔNG có ảnh (orphaned từ DB trước) → embed ảnh THẬT có sẵn, KHÔNG bịa.** |
| **POLICY_DEFAULT_DENY** (line/order) | BẬT + app healthy no-break; **transition THẬT idle→ready ok:true qua policy-gate** (9 rule loaded); **line_states/transitions 0/0→1/1** (đóng "LC never executed"). |
| **pg_stat_statements** | CREATE EXTENSION OK (query-perf telemetry). |
| **Benchmark** | Endpoint 200 nhưng /api rate-limit 300/min chặn bulk → **cần ingest-tier riêng (R4)** đo 100k thật. RLS-0125 blocked (Timescale hypertable). |

**2 phát hiện HONEST quan trọng (R2):** (1) 14,730 inspection ảnh **orphaned từ DB trước** — data-provenance gap, không phải chỉ seed cũ. (2) Ingest path dùng chung /api rate-limit 300/min = **nút cổ chai scale** (100 máy vượt dễ) → cần ingest-tier riêng.

## ✅ R3 (Infra HA & Scale) — DONE, commit `a335ec1a` + verify LIVE
| Món | Kết quả LIVE |
|---|---|
| **Ingest tier riêng** | `OT_INGEST_RATE_LIMIT` 300k/min keyed-per-máy; `/api` tier chung **skip** path ingest (browser/tRPC nguyên vẹn). **Phát hiện:** route `/api/ot/ingest` TRƯỚC ĐÂY KHÔNG tồn tại (200 fall-through, 0 persist) → lý do R2 benchmark ot_telemetry=0. Tạo route THẬT (auth máy→map→ingestTelemetry persist). Auth verify: no-key/bad-key→401, valid→200+persist. +7 test. |
| **Bulk-resolve N+1** (phát hiện khi benchmark) | `resolveMachineIds()` gộp mọi deviceId chưa-map của batch vào **1 query** `code IN (...)` thay N await tuần tự (tới 500 round-trip/batch → cạn pool → 4s/query). Giữ nguyên cache+neg-TTL. **errors 500→0.** |
| **Benchmark THẬT** (authed, ingest tier) | **at-capacity 5k target → 4691 pts/s @ ack P95 56ms, 0 err, 101MiB** (khoẻ). **over-drive 100k target → 9742 pts/s** (trần single-node, backpressure KHÔNG mất data, 0 err). **2.9M row synthetic persist THẬT** vào hypertable rồi dọn sạch. Trần = index-maintenance-bound (6 index/2 unique arbiter) → **đường tới 100k = COPY-ingest (R4) + scale-out** (honest, không giả 100k). |
| **Timescale hardening** (0271) | ot_telemetry→hypertable (PK mở rộng (id,ts)); compression bật measurement_results+product_inspections. **7 hypertable đều compression-enabled.** Chạy bằng owner `aoi`. Boot log xác nhận native retention ot_telemetry. |
| **Lake cold-tier** (lakeSink.ts, flag OFF) | NATS JetStream pull consumer bền→NDJSON gzip phân vùng date/hour/aspect (local FS/MinIO/S3). `npm lake:verify` drain 5 sample→file gzip hợp lệ. docker-compose.lake.yml + 11 test. |
| **Tự làm** | read-replica seam `getReadDb` xác nhận tồn tại (DB_POOL_MAX_READ pool riêng); uns-ha compose validate (cần EMQX_CLUSTER_COOKIE deploy); DR pg_dump backup OK (219MB DB). |

**Phát hiện HONEST R3:** (1) route ingest THẬT chưa từng tồn tại → R2 "endpoint 200" là fall-through giả. (2) N+1 resolve = nút cổ chai thật, đã sửa. (3) trần single-node ~10k pts/s (index-bound) — 100k cần COPY+scale, KHÔNG giả số.

## Kế tiếp
*(đã thực thi — xem dưới)*

## ✅ R4 (Correctness + RBAC + Nợ) — DONE, 6 commit, MỖI cái PROVEN LIVE
| Món | Commit | Verify LIVE |
|---|---|---|
| **Genealogy fork-fix** | `96042ef8` | Chuỗi hash tamper-evident forkable (read-tail+insert 2 lệnh). Nay `appendGenealogyChainRow` = tx + `pg_advisory_xact_lock` (mirror control-audit). **A/B DB thật: OLD 40 append đồng thời→1 FORK; NEW→0 FORK.** 3 call-site. |
| **Worker leader-election** | `77f18831` | Đóng "SINGLE-WORKER no leader election". Advisory-lock session trên reserve() conn + heartbeat pg_locks + fail-stop chống split-brain. Cờ `WORKER_LEADER_ELECTION_ENABLED` OFF. **2 tiến-trình thật: đúng 1 leader + standby failover.** |
| **Scoped-admin** | `0ffd4ab4` | "admin=god" → cờ `RBAC_SCOPED_ADMIN` OFF-default; ON: admin chịu restriction row tường minh (no-row/expired/db-down→vẫn pass, KHÔNG lockout). **6/6 check DB thật; non-admin byte-identical.** |
| **RBAC 19 procedure** | `66963230` | 19 business-CRUD `_shared.adminProcedure`(no-2FA)→`requirePermission` (production_orders/settings_products/settings_measurement_points/reports_templates). **RỚT 0 guard 2FA; module đều tồn tại.** Live: supervisor1(grant)→PASS, operator1→DENY, admin→PASS. **Part B ~55 + allowlist CHỜ DUYỆT (doc 50).** |
| **CJK font** | `4b3fc774` | Export PDF nhúng chỉ Be Vietnam Pro (0 CJK)→zh tofu. Nay lazy Noto Sans SC khi có CJK (vi/en byte-identical). Verify round-trip pdfjs ToUnicode + CID-subset. 14/14 test. |
| **Tách monolith** | `419abd75` | ApiDocs 7251→3556 (−51%), ProductModels 5085→3496 (−31%), pure relocation. tsc/build/i18n 0. |

## ✅ R5 (llama-server) — DONE, commit `c14e0e07`
Deep model load in-process tranh VRAM embedder→degrade offline. Nay opt-in chạy
deep model trong llama-server BỀN (OpenAI-compat, tự giữ VRAM) — API chỉ giữ
embedder, forward text-gen qua HTTP. Cờ `LLAMA_SERVER_ENABLED` OFF. **PROVEN 10/10
(mock server): routing model-scoped, generateText/JSON via server, STRICT honest-
degrade, flag-off bypass.** Runbook `scripts/ai/llama-server.md` (build CUDA, VRAM
32GB co-reside, wire). GPU-gen thật = runtime operator.

## ✅ Bonus scale (R4/R3) — ingest COPY, commit `530255a0`
persistRows INSERT tham-số CHẠM TRẦN 65534 param ở batch dày ~5957 hàng→THROW→
KHÔNG persist (chặn cứng 100k). Nay COPY→temp→INSERT-SELECT-ON-CONFLICT (cờ
`OT_INGEST_COPY_ENABLED` OFF, giữ dedup/return/throw). **PROVEN DB thật: 7000 hàng
dày INSERT persist 0/7000 (tràn), COPY 7000/7000, replay dedup giữ 7000.**

## Tồn đọng CHỜ USER
- **RBAC Part B** (~55 candidate) + allowlist CI-lint (doc 50) — cần quyết per-cụm; cụm 2FA `(T)` phải gắn lại 2FA nếu migrate.
- **Bật cờ ở staging:** RBAC_SCOPED_ADMIN, WORKER_LEADER_ELECTION (khi >1 worker), OT_INGEST_COPY, LLAMA_SERVER (khi có llama-server), LAKE_SINK.
- **HOÃN staging (không đổi):** OT_GATEWAY (adapter thật), tắt LICENSE_BYPASS/MACHINE_SHARED_KEY (license/xoay-khoá), default-deny ot.command.* (chờ gateway), EMQX-3node deploy (cần cluster cookie), benchmark 100k HTTP end-to-end (sau bật COPY).

**Verify artifacts** (re-run bất kỳ lúc nào): `scripts/verify/genealogy-fork-proof.ts`, `worker-leader-proof.run.mjs`, `scoped-admin-proof.ts`, `rbac-migration-proof.ts`, `llama-server-proof.mts`, `ingest-copy-proof.ts`.

**Backup:** `.env` gốc lưu tại scratchpad `.env.pre-r1-activation.bak` (rollback nếu cần). avi_app password dev: `avi_app_worm_2026` (dev-only, đổi ở production).
