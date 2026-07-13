# 48 — SYNAPSE: ĐÁNH GIÁ TỔNG THỂ HẬU-NÂNG-CẤP + KẾ HOẠCH LÊN ≥95%
## Audit LIVE 7 chuyên gia (đo production-readiness THẬT, không tin commit log) · 2026-07-13

| | |
|---|---|
| Phương pháp | 7 agent audit READ-ONLY, probe hệ thống ĐANG CHẠY (:3000, DB @5434, container Timescale/NATS/OpenBao/EMQX/Redis) — đo DB thật, cờ .env thật, Playwright live 5 persona, chạy tsc/build/test/benchmark |
| Baseline | doc 44 (L1-L5 = **59/39/40/56/60**) sau khi ĐÃ thực thi W0-W7 + FE-W0-W4 + factory-config + RBAC |
| Trạng thái | **CHỜ DUYỆT** — báo cáo để review; chưa thực thi thay đổi nào. Sau duyệt mới gọi agent execute |

---

## 0. TÓM TẮT ĐIỀU HÀNH

**Một câu:** Hệ sinh thái có **khung (framework) đẳng cấp thế giới (~80-90%)** nhưng **độ sẵn-sàng-sản-xuất chỉ ~⅓-½ (33-55%)** — vì phần lớn năng lực cao cấp đang **TẮT cờ**, **bảng dữ liệu rỗng**, và **quy mô chưa được chứng minh**. Khoảng cách tới ≥95 **KHÔNG phải viết lại** — mà là chiến dịch **KÍCH HOẠT + WIRING + NẠP DỮ LIỆU + CHỨNG MINH BENCHMARK** (+ một trần phần cứng: VRAM / Hermes / FAT).

### Điểm honest hiện tại (7 audit độc lập, thang 100)

| Tầng/Chiều | Điểm | Framework | Production | Baseline doc44 | Nhận định 1 dòng |
|---|---:|---:|---:|---:|---|
| **T1 Kết nối** | **72** | ~83% | ~33% | 59 | Code-đủ nhưng **gateway TẮT cờ** → 0 telemetry/edge/command live |
| **T2 UNS & Dữ liệu** | **60** | (42% dormant) | ~58% | 39 | Stores/semantic/genealogy LIVE thật; **streaming bus 0% wired** |
| **T3 Điều phối** | **60** | ~85% | ~32% | 40 | FSM/Policy/Order **xây thật, ngủ đông** — policy vẫn default-ALLOW live |
| **T4 Trí tuệ** | **63** | ~85% | ~40-45% | 56 | Toán thật, mọi bảng W5 RỖNG; exec/chat chạy nhầm **model embedding** = rác |
| **T5 Ứng dụng** | **68** | ~90% | ~55% | 60 | FE nâng cấp THẬT + honest-null ★; kéo xuống bởi seed cũ + e-SOP rỗng + security cắt-ngang |
| **Cắt ngang (An ninh/Quan sát/Tích hợp/RBAC)** | **46** | ~72% | ~33% | — | Sec 45 · Obs 52 · Integ 28 · RBAC 62 — hầu hết TẮT cờ; audit chưa WORM |
| **Hiệu năng/Quy mô** | **58** | (arch ~72) | — | — | Xây-để-scale nhưng **chứng-minh = 0** (DB rỗng, benchmark chỉ dry-run) |
| **Chính trực dữ liệu** | **85** | — | — | — | honest-null ★ + hash-chain thật; lỗi fork genealogy + RLS off hot-table |
| **Build/Test/DB** | **82** | — | — | — | tsc/build/i18n sạch; 17k assertion 96.3% pass; **mig 0269 chưa áp** |

**Điểm tổng thể có trọng số ≈ 62/100** (5 tầng ~64.6 + cắt-ngang 46 kéo xuống). **Chưa đạt ≥95.**

### Phát hiện quyết định (chủ đề đồng nhất qua CẢ 7 audit)
> **Mọi tầng đều là "framework mạnh sau cờ-TẮT".** doc 44 W0-W7 giao code THẬT, có test, kiến trúc tốt — nhưng môi trường LIVE chạy với hầu hết cờ enforcement/ingest/streaming/security = OFF, bảng dữ liệu rỗng, seed đứng yên ở 07-12, và benchmark quy mô chưa từng chạy thật. **Production-readiness ≈ ⅓ dù framework ≈ ⅘.**

---

## 1. PHÁT HIỆN CHI TIẾT THEO TẦNG (bằng chứng file:line / DB / live)

### T1 — Kết nối (72 · fw 83% / prod 33%)
- **Gateway TẮT:** `.env:441` `OT_GATEWAY_ENABLED` bị comment → `ot_telemetry`/`edge_nodes`/`command_log`/`uns_tag_mappings` = **0 rows**. Toàn bộ code W2-W7 L1 chưa có bằng chứng runtime.
- **syn/ 6-aspect tree + cmd_ack TẮT** (`UNS_TOPIC_V2_ENABLED` unset) → cây spec-đúng không publish; live vẫn topic legacy `avi/…`.
- **⚠ SAFETY_BLOCKED chưa nối vào đường lệnh** — `getSafetyStatus` tồn tại nhưng KHÔNG được gọi preflight trong `commandDispatcher.dispatchCore` trước write. Lỗ hổng an toàn thật vs invariant #1.
- **Benchmark = 0 published** (chỉ harness dry-run). Edge gateway process THẬT (`dist/edgeGatewayMain.js`) nhưng **chưa từng boot** (edge_nodes=0).
- **Trần phần cứng:** Hermes IPC-9852 = **0 code**; HW-validation ≈ 0 (6 driver/SECS/CFX/safety-PLC chưa FAT).
- ★ Giữ: one-door commandDispatcher (backdoor-proof), honest-degradation, breadth giao thức vượt spec, store-forward WAL.

### T2 — UNS & Dữ liệu (60 · prod-live 58% / dormant 42%)
- **★ Timescale GIỜ LIVE THẬT** — 6 hypertable 130k+ row (robot_telemetry 95,640), CAgg populated + refresh, compression/retention policy. Đây là bước tiến honest lớn nhất vs baseline.
- **Streaming bus 0% wired** — `natsAdapter`/`streamProcessor`/`telemetryStreamTap` code tốt + test, NHƯNG `installTelemetryStreamTap()` **không gọi lúc boot**, mọi cờ OFF (STREAM_BRIDGE_BACKEND=inprocess, NATS_URL unset). Đây là "code≠production" lớn nhất T2.
- **Schema enforce ngủ** (`CONTRACT_VALIDATE_INGEST_MODE=off`, contract_schemas 0 row). Semantic layer **không phải chokepoint** — 5 service tính OEE trực tiếp bỏ qua `computeMetric`.
- **★ Genealogy hash-chain vượt spec** — 27,873 row thật, verifyChain expose. Nhưng **0 cột carton/pallet** (khớp phát hiện factory-config).
- Trần infra: chưa broker cluster (1 EMQX node), chưa lake Parquet, replica chỉ seam.

### T3 — Điều phối (60 · fw 85% / prod 32%)
- **"Xây thật, ngủ đông"** — LC FSM 7-state thật (84 test pass), Policy engine thật, Order lifecycle 8-state thật. NHƯNG DB: `line_states` 0 · transitions 0 · orders lifecycle NULL · policy_definitions 0 · policy_decision_log 0 · qt-templates 0 · orchestration_runs 0.
- **⚠ Policy vẫn default-ALLOW live** — `policyGate.ts:41` SEC_PLATFORM off → short-circuit `{allow:true}` trước khi evaluate. "Một cửa" wired nhưng **không có policy nào cai trị** line/order.
- **2 chốt kích hoạt cụ thể:** (a) chưa ship allow-policy cho `line.command.*`/`order.command.*` → bật default-deny sẽ VỠ FSM; (b) `commandDispatcher.ts:562` truyền action `"device_write"` cứng ≠ namespace `ot.command.*` → bật deny-group không thực sự gate OT write.
- ★ Giữ: transaction race-safe (`WHERE state=from`), audit append-only, fail-safe typed-result, correlation threaded.

### T4 — Trí tuệ (63 · fw 85% / prod 40-45%)
- **Mọi bảng W5 RỖNG** (predictive_alerts/rul_estimates/twin_trust/ml_feature_cache/ai_models = 0); mọi cờ W5 OFF + vắng khỏi .env.
- **⚠ Exec-summary/chat chạy nhầm model EMBEDDING = rác** — `generateNarrative` không pin được `modelId`, boot chỉ warm embedder → 27/34 report lịch sử là gibberish. **RCA/codegen chạy tốt (chúng pin model)** → đây là **1 lỗi wiring**, không phải giới hạn phần cứng.
- **★ RAG mạnh nhất, LIVE** — reranker bge thật, 91,678 chunk manual, precision@k **0.973 đo thật**.
- RUL Weibull thật nhưng dormant (cờ OFF + failure_events=0 → fallback heuristic). Vision/MLOps/feature-store/Advice-contract: code thật, cờ OFF, registry rỗng.
- **Trần phần cứng:** VRAM 32GB không co-resident generative(30B) + embedding + vision → live generative bị cap tới khi thêm VRAM (48-96GB) hoặc persistent llama-server.
- ★ Giữ: **0 fabrication** (mọi path dormant trả honest-degrade có nhãn), toán thật (Weibull MLE/Bayes-risk/FFT), HITL boundary enforced.

### T5 — Ứng dụng (68 · fw 90% / prod 55%)
- **★ FE nâng cấp THẬT** — mọi màn mới render + backend-wired + honest: Control Tower, ISA-18.2 Alarm KPI, FSM Line View, Metric Catalog @v1, SLA Cockpit, Comparison Studio, Exec PWA, drill 6-tầng. **0 console error / 0 5xx** qua 30+ page-load × 5 persona. app-shell hoist ON. i18n 99.85% parity (14k key×3).
- **Kéo xuống bởi:** (1) **seed cũ 07-12** → demo live đọc ~60% rỗng dù FE wired đủ (cần sim cuộn-tiếp); (2) **e-SOP 0 content** (sops/executions=0 — vòng start/confirm/finish chưa chạy); (3) **virtualization ~0 adoption** (chỉ 1 demo); (4) **ZH export tofu** — `fontAssets.ts` chỉ nhúng font VN, **thiếu font CJK** → báo cáo tiếng Trung lỗi ký tự; (5) **RBAC khóa persona** — engineer→Digital Twin = Access Denied, 36 hardgate client `role==='admin'`; (6) **39 monolith >1000 dòng** (ApiDocs 7251, ProductModels 5085 — tăng); rubric cắt-ngang security/obs/enterprise chưa đụng.

### Cắt ngang — An ninh/Quan sát/Tích hợp/RBAC (46)
- **⚠ Audit chưa WORM-enforced** — app chạy role `aoi` (DELETE/UPDATE được audit_logs); role append-only `avi_app` xây rồi nhưng **0 connection**. Kiểm soát quan trọng nhất SL2 (non-repudiation) chưa bật.
- OpenBao **standup-only** (2 call-site, cờ OFF); mTLS/PKI/SIEM/DORA/SAML/WMS-PLM-CMMS đều cờ-OFF/stub. **LICENSE_BYPASS=true + MACHINE_SHARED_KEY_ALLOWED=true** = posture bypass đang bật.
- **★ correlation_id GIỜ end-to-end** (lỗi doc44 "không chảy L5→L1" đã sửa kiến trúc) · /metrics live · 2FA ON cho privileged · four-eyes schema-enforced · SAST/gitleaks CI thật.
- **RBAC:** fix engineer settings_factory THẬT (matrix↔server↔client↔DB đồng bộ), NHƯNG **~40 procedure server vẫn role-hardgate** (bỏ qua matrix) + **admin = god** (bỏ qua matrix + RLS cross-tenant). Split-brain còn.
- Obs: OTel no-op (SDK chưa cài), structured-log ~2% adoption (1872 console.* vs 39 logger.*) → correlation_id không tới log.

### Phi chức năng — Hiệu năng/Chính trực/Build (58/85/82)
- **Scale chứng-minh = 0** — mọi bảng metric 0 row, `aoi_management_sim` chưa tạo, benchmark chỉ **dry harness** (92k pts/s single-thread, không chạm DB/broker). SLO 100k msg/s encode-thành-gate nhưng chưa đo.
- **⚠ Lỗi fork genealogy** — `getLastGenealogyHash`→`insertGenealogyChainRow` KHÔNG transaction/lock (`product.ts:2595`) → 2 append đồng thời đọc cùng prevHash → chain tự hỏng dưới tải factory bình thường.
- `ot_telemetry` **không phải hypertable**; worker **không leader-election** (cron double-fire nếu scale >1); LLM serialized 1 GPU; RLS OFF hot-table (0125 fail); **mig 0269 chưa áp** (DB ở 0268); 16 lỗi AlertEvaluator nuốt-lặng.
- ★ Giữ: build discipline (tsc/build/i18n 0), honest-degradation ★, scale seams thật (Redis cache/adapter, read-replica seam, batched idempotent ingest, WAL), 17k assertion.

---

## 2. PHÂN LOẠI KHOẢNG CÁCH (chìa khóa cho kế hoạch)

Khoảng cách tới ≥95 chia làm **6 loại** — quan trọng vì đa số là PHẦN MỀM nhanh:

| Loại | Bản chất | Ví dụ | Chi phí |
|---|---|---|---|
| **A. Kích hoạt (cờ)** | Code xong, chỉ bật cờ .env theo thứ tự an toàn | OT_GATEWAY, syn-tree, streaming tap, W5 AI flags, SEC_PLATFORM+policy, SECRET_MANAGER, SIEM, RLS | **Rẻ/nhanh — đòn bẩy cao nhất** |
| **B. Wiring cụ thể** | Vài sửa code chính xác | pin modelId (T4), safety-gate preflight (T1), commandDispatcher namespace (T3), installTelemetryStreamTap boot-call, DATABASE_URL→avi_app | Rẻ, chính xác |
| **C. Dữ liệu & Chứng minh** | Nạp data + chạy/publish benchmark | rolling sim daemon, seed e-SOP/scale, chạy 100k msg/s + soak 24h + dispatch P95, backfill AI embeddings/banks | Trung bình |
| **D. Infra & HA** | Dựng hạ tầng thật | EMQX 3-node, PG replica, lake Parquet/MinIO, OpenBao wired, mTLS ingress | Trung bình-cao |
| **E. Sửa đúng-đắn/nợ** | Bug + hardening + nợ kiến trúc | fork genealogy, worker leader-election, COPY ingest, RBAC ~40 procedure→hasPermission, scoped-admin, CJK font, tách monolith | Trung bình |
| **F. Trần phần cứng** | Cần thiết bị/GPU/nhà máy | VRAM 48-96GB hoặc persistent llama-server; Hermes adapter; FAT thiết bị thật | **Cao — owner quyết** |

**Ước lượng đòn bẩy:** Phase A+B (phần mềm thuần) đưa production ~⅓ → ~⅔ across layers. A+B+C → ~85-90. +D+E → ~92-95. Riêng ≥95 của T1/T4 chạm trần F (phần cứng).

---

## 3. KẾ HOẠCH NÂNG CẤP → ≥95 (đề xuất, chờ duyệt)

### Đợt R1 — KÍCH HOẠT AN TOÀN + WIRING (loại A+B · phần mềm · đòn bẩy cao nhất)
*Mục tiêu: production ⅓→⅔; verify LIVE mỗi bật cờ; staged, có rollback.*
- **T1:** bật `OT_GATEWAY_ENABLED` + `UNS_TOPIC_V2_ENABLED` + cmd_ack + deadband (staging) → assert telemetry chảy; **wire SAFETY_BLOCKED preflight** vào dispatchCore + seed ≥1 safety_plc_config; dual-publish syn/ + avi/.
- **T2:** boot-call `installTelemetryStreamTap` + `STREAM_BRIDGE_BACKEND=nats` + NATS_URL → durable replay; bật schema `off→log→quarantine`; route 5 consumer OEE qua `computeMetric`.
- **T3:** ship allow-policy `line.command.*`/`order.command.*` + `POLICY_STORE_ENABLED` + `SEC_PLATFORM` + default-deny group; **sửa commandDispatcher truyền `ot.command.<verb>`**; bật LINE_CONTROLLER/ORDER_LIFECYCLE/QT_TEMPLATES; verify 1 transition denied ghi policy_decision_log.
- **T4:** **thêm `modelId` vào generateNarrative + warm deep-model trước embedder** (khôi phục exec/chat generation); bật W5 flags theo thứ tự advisory-trước (RUL/feature-store/twin-fidelity/advice-contract).
- **Security:** **chuyển DATABASE_URL→avi_app** (bật WORM audit); bật SECRET_MANAGER + migrate secret vào OpenBao; đăng ký cron SIEM; tắt LICENSE_BYPASS + MACHINE_SHARED_KEY.

### Đợt R2 — DỮ LIỆU & CHỨNG MINH (loại C)
- **Rolling sim daemon** (cuộn sim:factory tới "now" liên tục) → dashboard default render live (chuyển ~60% "rỗng" thành có-số, không đụng FE).
- **Seed nội dung:** 3-5 e-SOP + chạy 1 execution end-to-end; backfill ai_image_embeddings (14,730 inspection) → anomaly bank → train+register model đầu tiên (kích hoạt DL-head/stage-pipeline/drift/feature-store).
- **Benchmark PUBLISHED:** `bench-ingest --mode http --rate 100000 --duration 30` + soak 24h + chaos + dispatch-P95 + 60-robot campaign; commit bảng kết quả + block hardware/config.
- Backfill mig 0269; áp lại `0125` (RLS hot-table); enable pg_stat_statements + Prometheus/Grafana.

### Đợt R3 — INFRA & HA (loại D)
- EMQX 3-node cluster; PG streaming replica sau `getReadDb`; lake Parquet/MinIO cold-tier fed by bus; make `ot_telemetry` hypertable + compression `measurement_results`/`product_inspections`; mTLS enforce tại ingress; DR backup/restore test (RPO/RTO).

### Đợt R4 — ĐÚNG-ĐẮN & NỢ (loại E)
- **Sửa fork genealogy** (advisory-lock/FOR-UPDATE + HMAC-signature + cron verifyChain); worker **leader-election** (Redis lock); ingest `INSERT→COPY`; Redis `KEYS→SCAN`; de-dup 3 alert timer + root-cause 16 AlertEvaluator fail.
- **RBAC pass:** migrate ~40 procedure `role==='admin'`→`requirePermission`; **scoped-admin/break-glass** (admin hết god cross-tenant); grant engineer twin/simulation; convert 36 client hardgate; CI lint cấm role-hardgate ngoài allowlist; enforce 2FA server-side actuation.
- **CJK font** (Noto Sans SC/TC) cho ZH export; wire `virtualized` vào 3 bảng lớn nhất; **tách ApiDocs(7251)/ProductModels(5085)**.

### Đợt R5 — TRẦN PHẦN CỨNG (loại F · OWNER quyết)
- VRAM 48-96GB **hoặc** persistent llama-server (deep-model có budget riêng) → live generative co-run với RAG-embed.
- **Hermes IPC-9852 adapter** (observe-only trước); FAT thiết bị thật (6 driver/SECS/CFX/IO-Link/safety-PLC).

**Dự phóng điểm sau các đợt:** R1+R2 → T1~85·T2~82·T3~85·T4~80·T5~85·Sec~75 · R3+R4 → hầu hết 90-95 · R5 → T1/T4 chạm ≥95.

---

## 4. ❓ CẦN BẠN QUYẾT (trước khi execute)
- **D1 — Phạm vi đợt đầu:** chỉ R1 (kích hoạt+wiring, an toàn, thấy kết quả nhanh) trước, review, rồi R2+? Hay R1+R2 gộp?
- **D2 — Bật cờ trên môi trường nào:** staging riêng hay chính DB dev hiện tại? (kích hoạt gateway/policy/streaming thay đổi hành vi runtime)
- **D3 — RBAC (loại E):** có làm scoped-admin + migrate ~40 procedure không? (đổi mô hình quyền — trước đây D3 "giữ RBAC"; nay cắt-ngang SL2 đòi hỏi)
- **D4 — Security posture:** duyệt chuyển DATABASE_URL→avi_app (WORM) + tắt LICENSE_BYPASS/MACHINE_SHARED_KEY ngay ở R1? (tăng an ninh nhưng có thể lộ chỗ dựa bypass cũ)
- **D5 — Phần cứng (F):** xác nhận hướng VRAM/llama-server + có Hermes/FAT trong lộ trình không (quyết trần ≥95 của T1/T4)?
- **D6 — Benchmark target:** chốt số công bố (100k msg/s? P95 ingest→query? dispatch P95? soak 24h?) để R2 đo đúng KPI đấu thầu.

---

## 5. ★ ĐIỂM MẠNH GIỮ NGUYÊN (tài sản thật, đừng phá)
- **Chính trực dữ liệu tuyệt đối** — 0 fabrication tìm thấy qua 7 audit; mọi path dormant trả honest-degrade CÓ NHÃN. Tài sản #1 với auditor Foxconn/Samsung.
- **Toán/kỹ thuật thật** — Weibull MLE censoring, Bayes-risk, FFT, hash-chain SHA-256, race-safe transaction, one-door dispatcher backdoor-proof, store-forward WAL idempotent.
- **RAG production-real** (precision@k 0.97, 91,678 chunk) · **correlation_id end-to-end** · **Timescale live** (130k row) · **i18n 99.85% parity** · **FE honest + 0 console-error** · **four-eyes/2FA/SAST thật**.
- **Kiến trúc "gập-vào" sạch** — mọi seam TẮT refuse sạch (NATS_NOT_AVAILABLE, flag-gated no-op), không giả durability/data. Khoảng cách là **wiring+cờ+data+infra**, KHÔNG phải correctness.

---

*Báo cáo từ 7 agent audit LIVE (probe DB/cờ/Playwright/benchmark), 2026-07-13. Read-only — tree sạch. Điểm & bằng chứng đo thật, không dựa commit log. **CHỜ DUYỆT D1-D6 trước khi gọi agent chuyên môn thực thi R1-R5.***
