# 35 — Audit sâu Hệ sinh thái vs Chuẩn Platform Tự động hóa Chuyên nghiệp: GAP 4 trục & Kế hoạch Thực thi

> **Yêu cầu:** audit lại hệ sinh thái hiện có đối chiếu kế hoạch doc 33, so sánh với một **hệ sinh thái & PLATFORM của công ty tự động hóa chuyên nghiệp**, chỉ rõ GAP theo **(1) luồng dữ liệu, (2) quy trình, (3) các tầng backend + cơ sở dữ liệu, (4) frontend đã khai thác hết sức mạnh backend chưa** — góc nhìn chuyên gia + kỹ sư lâu năm trong ngành, đa chiều nhất.
> **Phương pháp:** 6 agent audit chính (luồng dữ liệu · backend · database · frontend · quy trình MES · đối chiếu doc 33) + **~20 agent nhánh chuyên sâu** (golden sample, PdM/MTTR, ingest, shift, safety/commissioning, program deploy, defect AI, PM/spares, threshold approval, alarm/escalation, SPC/CPK, operator UX, calibration, drivers, quality hold, flags/HITL, reporting, big-pages, user-flows, ECN/audit-trail). Mọi khẳng định kèm `file:line` thật; nguồn sự thật cờ = `.env` (dev) và `.env.example` (ship).
> **Ngày:** 2026-07-05 · **Branch:** `automation-orchestration-r0` @ `febb9ec` · **Trạng thái:** 🟡 *Chờ DUYỆT §9 trước khi gọi agent thực thi.*

---

## 0. TÓM TẮT ĐIỀU HÀNH (đọc trước)

**Bức tranh một câu:** hệ hiện tại là một **sản phẩm AOI/AVI + automation orchestration xuất sắc về chức năng (nhiều mảng L3, AI 8.5/10)** nhưng **chưa phải một platform chuyên nghiệp**: bus dữ liệu ở mức in-process demo (4/10), kiến trúc backend rò rỉ tầng (3.8/10), nền database "đã viết nhưng chưa có hiệu lực" (4/10), frontend mới khai thác **~70%** sức mạnh backend, và tồn tại **1 sự cố bảo mật đang chảy máu dữ liệu** cần xử lý trước mọi thứ khác.

### 5 phát hiện thay đổi bức tranh (so với tri thức doc 33)

1. 🔴 **SỰ CỐ BẢO MẬT ĐANG HOẠT ĐỘNG:** `.env` đang bật `EXTERNAL_MQTT_ENABLED=true` trỏ tới **`broker.hivemq.com` — broker MQTT CÔNG CỘNG, plaintext, không ACL**. NG alert, serial, kết quả đo, summary (retain=true), bulletin đang phát ra internet (`mqttService.ts:483, 1191-1204, 1310-1318`). **Hotfix trước mọi phase.**
2. 🟡 **Kế hoạch doc 33 F1-F8 ĐÃ ĐƯỢC THỰC THI — nhưng trên branch khác chưa merge:** `synapse-foundation` (worktree `D:/SOURCES/avi-aoi-synapse`) có **33 commit / 140 file / +9.790 dòng** từ điểm rẽ `e17d205`: Helm+K3s+CI 2-profile, plugin manifest + sidecar out-of-process, OTel bridge, tamper-evidence audit, reconciliation cron, RL shadow, 14-agent adversarial audit. Branch hiện tại tiến thêm 3 commit doc-34 (AI copilot). **Hai nhánh đã rẽ đôi → cần quyết định tích hợp trước khi chồng thêm code.**
3. 🟢→⚠️ **"Tài sản ngủ" đã thức dậy một nửa:** `.env` dev hiện có **~75 flag `=true`** (FOE, fleet, robot/OT control, Sparkplug, EQ-govern, RLS, AI gần trọn bộ...). Nhưng thức dậy kiểu này lộ ra lớp gap mới: **cờ bật mà chức năng rỗng** (SECS/GEM skeleton), **cờ bật mà hạ tầng thiếu** (RLS bật nhưng app chạy superuser → vô hiệu; TSDB_URL tắt → retention không chạy), và `.env` chứa cấu hình nguy hiểm (`LICENSE_BYPASS=true`, `MACHINE_SHARED_KEY_ALLOWED=true`, SMTP rỗng).
4. 🔴 **Ba "hiệu lực trên giấy" của data platform:** (a) app kết nối DB bằng **superuser `postgres`** → toàn bộ 44 bảng RLS + WORM audit bị bypass vô điều kiện; (b) **TimescaleDB không có trên main DB** → mọi hypertable/compression/retention của migration 0118/0124/0172/0173 là no-op, `ot_telemetry` app-retention=0 → tăng trưởng vô hạn; (c) **quản trị migration gãy** — drizzle journal chết ở 0017/216 file, runner lenient, 2 bộ file trùng số.
5. 🔴 **Vòng lặp nghiệp vụ then chốt đứt ở mắt xích cuối:** ngưỡng được duyệt **không bump `pointsConfigVersion`** → máy AOI delta-sync **âm thầm không bao giờ nhận ngưỡng mới**; đường robot **không qua interlock gate** (đường OT thì có); engine escalation cấu hình được **không bao giờ start lúc boot**; AOI-ZIP import **bypass spec-gate** (trái claim "sealed 5/5" doc 31).

### Điểm tổng hợp theo 4 trục (chuẩn = platform automation chuyên nghiệp lớp Opcenter/Ignition/Tulip)

| Trục | Điểm | Điểm mạnh nhất | Gap nặng nhất |
|---|---|---|---|
| **1. Luồng dữ liệu** | **6.3/10** (ingestion 7.5 · bus 4 · persistence 6 · AI 8.5 · action 6.5 · outbound 5.5) | 1 phễu telemetry + 1 sink inspection chuẩn, AI realtime hooks, HITL chiều điều khiển | Bus in-process không schema-version/replay/DLQ; UNS không phải SSOT; leak HiveMQ; OT-WAL không restore |
| **2. Quy trình nghiệp vụ** | **L3 lõi / L1-L0 rìa** | Inspection→disposition→SPC (L3), maintenance PdM (L3−), orchestration HITL (L3), shift handover ký HMAC (hiếm) | ERP 2 chiều tắt; **ECN/doc-control = L0**; kho vật tư line (kitting/MSD/paste/feeder-verify) = L1; FAI/golden không gate |
| **3. Backend + Database** | **3.8/10 + 4/10** | commandDispatcher gate mẫu mực, ERP outbox chuẩn sách, 428 test file, schema 293 bảng kỷ luật additive | Không domain layer (106/220 router chạm Drizzle); 1 process ôm broker+LLM+physics; transaction 14 file/933 mutation; superuser; Timescale vắng; migration ledger gãy |
| **4. Frontend khai thác backend** | **~70%** (coverage 7.5 · độ sâu 6.5 · UX 6.5 · prod-ready 8) | 9/11 trang lớn REAL data + socket trung thực; luồng b/c/d hoàn chỉnh; mock ≈ 0 | **30 router (~150+ proc) mồ côi**; 16 trang zombie; twin thiếu replay/physics client; >100 trang không gate write theo role; zh thiếu 20% |

**Trả lời thẳng câu hỏi của chủ sở hữu:** *frontend đã hoàn thiện thực sự chưa và khai thác hết backend chưa?* → **Lõi vận hành đã production-thật (không còn demo-ware trừ 1 dòng), nhưng CHƯA khai thác hết: ~30% procedure backend không người dùng nào chạm được, và những năng lực đắt nhất (twin replay/physics, MSA nâng cao, report aggregators mới, AI analysis hub) đang là "cơ bắp thừa" phía server.**

---

## 1. MÔ HÌNH CHUẨN — Hệ sinh thái & Platform của một công ty tự động hóa chuyên nghiệp

Thước đo dùng để chấm (tổng hợp từ ISA-95/88, Sparkplug/UNS, ISA-18.2, IEC 62443, 21 CFR Part 11, GAMP 5, và thực tiễn Siemens Opcenter / Ignition / Tulip / Critical Manufacturing):

### 1.1 Luồng dữ liệu chuẩn
```
L0 Thiết bị ──▶ L1 Edge connector (driver + store-forward 2 chiều, X.509)
   ──▶ L2 UNS/Broker = SINGLE SOURCE OF TRUTH (topic ISA-95, schema-registry versioned,
        QoS/replay/DLQ, mọi producer/consumer đều qua đây)
   ──▶ L3 MES/Platform (1 write-gate/domain, event-sourced cho lệnh, outbox cho side-effect)
   ──▶ Timeseries partition + retention native · dim/fact mart cho BI
   ──▶ L4 ERP/analytics 2 chiều (contract-first, idempotent, reconciliation)
   ◀── Chiều điều khiển: policy-gate → HITL → interlock fail-closed → commissioning gate
        → ledger append-only → readback — ÁP DỤNG CHO MỌI LOẠI THIẾT BỊ (PLC + robot + AGV)
```
### 1.2 Quy trình chuẩn (mức cần cho nhà máy tự động hóa ≥ L3)
Kế hoạch↔ERP tự động · routing master · dispatch tự động · WIP mọi trạm · quality với hold/MRB/NCR có hiệu lực vật lý · FAI/golden GATE sản xuất · traceability khép kín tới component-lot (feed từ mounter, không nhập tay) · maintenance PM+PdM+spares+calibration khép vòng · **ECN/ECO + document control có effectivity** · shift handover + SLA breach · kho vật tư line (kitting, MSD clock, paste, stencil, feeder-verify).
### 1.3 Nền platform bán được
Editions/collapsible deploy · plugin out-of-process ký số · licensing "không bao giờ dừng sản xuất" · security (least-privilege DB, X.509 device, policy-as-code, WORM thật, SBOM) · observability (OTel, decision-trace, SLO) · OpenAPI/AsyncAPI publish · installer/update/backup-restore có drill. *(= đúng 6 trụ doc 33 — không nhắc lại chi tiết.)*

---

## 2. GAP TRỤC 1 — LUỒNG DỮ LIỆU (điểm 6.3/10)

### 2.1 Sơ đồ luồng thực tế (🟢 sống · 🟡 code-xong-cờ-tắt/dormant · 🔴 đứt/stub)

```
PLC (Modbus/S7/OPC-UA/MC/EIP)🟢─┐
MTConnect🟢  ROS2🟡  SECS/GEM🔴──┼▶ ingestTelemetry() ─🟢▶ ot_telemetry (plain PG!⚠️)
Sensor MQTT🟢  Robot/VDA5050🟢──┘    ├🟢 socket  ├🟡 twin/device tap (cờ tắt)
                                      ├🟢 OT-WAL buffer ─🔴 restore() mồ côi sau restart
                                      └🔴 KHÔNG feed UNS (OT_INGEST_TO_UNS thiếu)
AOI REST/submitInspection🟢 + WAL🟢+DLQ🟢 ─▶ product_inspections/measurement_results
AOI ZIP🟢 ──🔴 BYPASS spec-gate + không 3D fields (tự insert riêng)
Hot-folder 9 vendor adapters🟢 ─▶ (như trên)
   ├🟢 AI inline gate (setImmediate sau ACK, circuit-breaker)
   ├🟢 DINOv2 embed → PatchCore anomaly realtime
   ├🟢 cron: batch-RCA 02:00 · bank rebuild 03:00 · threshold tune 04:00
   └🟡 ERP outbox producers bắn vào worker ĐANG TẮT
ALERT: NG → socket🟢 aedes🟢 FCM🟢 webhook🟢 + ⚠️HiveMQ PUBLIC🟢 (SỰ CỐ)
ANDON: raise→ack(MTTA)→resolve(MTTR) DB thật🟢 · escalation engine cấu hình được: DORMANT🔴
CONTROL: vision→control🟡(tắt) → HITL → commandDispatcher🟢 (4 gate, ledger, readback)
         NHƯNG robotCommandDispatcher KHÔNG interlock-gate🔴
```

### 2.2 TOP GAP luồng dữ liệu (P0/P1/P2, đã hợp nhất từ agent 1 + nhánh)

| # | Mức | Gap | Bằng chứng |
|---|---|---|---|
| D1 | **P0** | **Dữ liệu sản xuất publish plaintext lên broker công cộng HiveMQ** | `mqttService.ts:483,1191-1204,1310-1318,1413-1416`; `.env:72-76` |
| D2 | **P0** | **AOI-ZIP commit bypass `evaluatePointResult` + không persist 3D fields** — NG có thể lọt thành OK trên đường import; trái claim doc 31 "sealed 5/5" | `aoiPackageRouter.ts:617,698-759` vs `machineApiRouters.ts:520-527` |
| D3 | **P0** | **`ot_telemetry` không retention nào hoạt động** (app=0 ngày, TSDB native nằm ở instance tắt, hypertable main-DB không có extension) → tăng trưởng vô hạn | `.env RETENTION_OT_TELEMETRY_DAYS=0`; `dataRetentionService.ts:149`; probe DB: extension chỉ `plpgsql` |
| D4 | **P0** | **Threshold approve → máy không nhận:** apply chỉ ghi DB, không bump `pointsConfigVersion` → delta-sync client âm thầm bỏ lỡ; đồng thời apply bypass ledger `measurement_point_versions` | `thresholdApprovalRouter.ts:94-104`; `machineApiRouters.ts:1895` |
| D5 | P1 | OT store-forward WAL không `restore()` lúc boot (inspection WAL thì có) | `ot/storeForward.ts:187` vs `_core/index.ts:4858` |
| D6 | P1 | UNS không phải SSOT: telemetryBus không feed UNS; 2 đường normalize topic song song; cờ đọc lúc module-load | `ot/ingest.ts:59-72`; `unsBridge.ts:14` |
| D7 | P1 | SECS/GEM "dishonest flag": `SECS_GEM_ENABLED=true` nhưng skeleton connect/test, không poller, không S6F11→DB, mapper không caller | `secsgem/hsmsClient.ts:1-32`; `gemModel.ts:231` |
| D8 | P1 | Bus không schema-version/replay/exactly-once/DLQ; Redis fanout tắt → single-instance | `_core/eventBus.ts:40`; `busFanout.ts:64-66` |
| D9 | P2 | ERP outbox (breaker/DLQ/idempotency/B2MML) đủ end-to-end nhưng dormant — 4 producer đang no-op | `erpOutbox.ts:63-65`; `ERP_OUTBOX_ENABLED` thiếu |
| D10 | P2 | Live NG alert (ALT-*/NGRATE-*) ephemeral không DB row → không audit/MTTA; app ack local-only by-design | `machineApiRouters.ts:602`; `externalInspectionApi.ts:2763` |
| D11 | P2 | Dữ liệu ingest xong bỏ phí: `machine_sensor_readings` không được PdM đọc (đọc heartbeats); SSE 0 producer; robot-anomaly wired nhưng cờ tắt | `predictiveMaintenanceService.ts:207`; `_core/sse.ts:81` |
| D12 | P2 | MQTT/SECS/OPC-UA không phải đường ingest kết quả inspection (chỉ telemetry) — vendor thiếu: Omron/CyberOptics/ViTrox/Parmi/Pemtron; 7 adapter hiện có PENDING validation file thật | `vision/index.ts:6,13-15` |

---

## 3. GAP TRỤC 2 — QUY TRÌNH NGHIỆP VỤ (ma trận L0-L4)

| Quy trình | Hiện tại | Cần | Đứt ở đâu (bằng chứng chọn lọc) |
|---|---|---|---|
| Kế hoạch → sản xuất | **L2+** | L3+ | ERP intake/outbox built-nhưng-OFF (`erpIntake.ts:38`); **không routing master** (tự nhận `erpIntake.ts:23-25`); dispatch chỉ gợi ý xếp hạng, không start tự động; báo công chỉ tự động tại trạm inspection |
| Chất lượng inspection | **L3** | L3+ | Mạnh nhất hệ. Còn: quality hold là bản ghi không hiệu lực (WIP `on_hold` vẫn dispatch được — `wipRouter.ts:155` không loại; enum mismatch `"on_hold"` vs `"hold"`); **MRB/NCR = 0**; SPC OOC không vào alert/Andon trung tâm (sink riêng); AQL engine thật nhưng không chạy ở ingest |
| Truy vết | **L2** | **L4** (EMS bắt buộc) | `componentCode` **0/119 điểm đo**; reel→board chỉ mutation tay, không feed mounter/CFX; chỉ AOI tự ghi genealogy (SPI/reflow/FCT không writer); không route enforcement; không as-built export; điểm sáng: hash-chain `genealogy_chain` thật |
| Bảo trì | **L3−** | L3 | PdM risk→WO closed-loop có (cờ ON); NHƯNG **`maintenance_schedules` mồ côi** (không gì đọc `nextDueAt` sinh PM-WO — trigger `SCHEDULE` không bao giờ dùng); **`spare_parts_inventory` mồ côi** (0 router/UI, không trừ theo WO); **MTTR/MTBF 2 bộ tính từ 2 bảng khác nhau lệch số** (`predictiveMaintenanceService.ts:128` vs `pdmWorkOrderService.ts:111`); không PM checklist/e-sign; **alarm máy → WO tự động = 0** |
| Kỹ thuật/thay đổi | **L3 recipe / L1 change** | L3+ | Sim-gate deploy ĐÃ ENFORCE (P0 doc 22 đóng — `programmingService.ts:244-272`, không bypass); golden sample SoD chuẩn NHƯNG **không enforce** (diff chỉ on-demand 2 endpoint, không gate release/commissioning); **FAI = schema-stub không gate**; **ECN/ECO + document control + effectivity = KHÔNG TỒN TẠI** (grep = 0) |
| Điều phối tự động hóa | **L3 phần mềm** | L3+ | FOE hitl_gate thật (pause→approve/reject→resume); TOCTOU reservation ĐÃ VÁ (`FOR UPDATE`); NHƯNG **robot path không interlock-gate** (`robotCommandDispatcher.ts:107-203`); e-stop = Null scaffold; safety zones advisory; driver 6 hãng real-transport nhưng **chưa validate máy thật** |
| Andon/điều hành ca | **L3−** | L3 | Andon MTTA/MTTR closed-loop thật; shift entity DB thật + handover ký HMAC; NHƯNG **handover không UI nào gọi** (`productionSessionRouter.handover` 0 client caller); shift chỉ là chuỗi derive lúc đọc, không FK dim; **escalation config engine không start lúc boot** (`mqttClientManagementRouter.ts:1982` là caller duy nhất); `escalateAndon` dead code; không SLA-breach detection; operator terminal = console báo cáo, **chưa chạy được trọn ca** (không clock-in/start-stop job/reel change); `productionSession.*` mutations **không requirePermission** |
| Kho/vật tư line | **L1** | L3 | **Vùng trắng lớn nhất:** kitting=0, MSD floor-life clock=0 (chỉ cột msl tĩnh), paste lifecycle=0, stencil chỉ counter tay, **feeder-setup verification=0 (rủi ro gắn nhầm part — lỗi chết người SMT)**, inventory không ledger giao dịch |

**Quy trình L0 hoàn toàn thiếu:** ECN/ECO · kitting/staging · MSD clock · paste lifecycle · label print+verify · LPA · complaint/RMA/8D/CAPA · routing master · calibration máy sản xuất (dụng cụ đo thì có backend nhưng **0 UI + 0 cron nhắc hạn**) · training-gate theo skill (schema có, không gate).

---

## 4. GAP TRỤC 3 — CÁC TẦNG BACKEND & CƠ SỞ DỮ LIỆU

### 4.1 Backend (3.8/10 vs chuẩn platform)

| Chiều | Điểm | Thực trạng chính |
|---|---|---|
| Layered discipline | 3.0 | Không domain layer; **106/220 router import Drizzle trực tiếp**; god-file `_core/index.ts` **5.233 dòng ôm ~90 REST endpoint**; `productRouters.ts` 3.428 dòng |
| Dependency direction | 3.5 | **331 lazy `await import()`** dán cycles; service→router (`alertEvaluatorScheduler.ts:24`); hub `ot/` 20 import chéo |
| Cross-cutting | — | **P0: `/api/v1` mount TRƯỚC license/audit/RBAC guard** (`index.ts:4622` vs `:4728`) → ERP intake/equipment REST bypass toàn bộ; `MASTER_API_KEY` = `*`; **public mutations `aiLocalKbRouter.ask/reload/feedback` không auth** (`aiLocalKbRouter.ts:122-190`) |
| Transaction | — | **14 file dùng `.transaction()` / 933 mutation**; cascade delete hierarchy 19-write/0-tx (`hierarchyRouters.ts:222-507`) |
| Runtime topology | — | **1 process duy nhất** ôm HTTP + Socket.IO + aedes broker + node-llama-cpp CUDA + Rapier WASM + DES sync; `dist/worker.js` build xong **không deployment nào dùng**; không leader-election |
| Jobs | — | Không BullMQ/pg-boss; 16 node-cron + 50 setInterval; queue in-memory mất khi restart; outbox chỉ ERP |
| Flags | — | **~554 env var / 128 toggle `*_ENABLED`** đọc ad-hoc 364 file; `env.ts` chỉ 30 biến; entitlement license và env flag **không reconcile** (split-brain) |
| Secrets | 3.5 | AI key base64 "obfuscation" (`aiSettingsRouter.ts:95`), TOTP secret + MQTT password plaintext trong DB |
| Testability | 6.0 | 428 test file server + test-DB isolation thật; nhưng E2E 4 spec/14 test, load-test = 0 |

**Điểm mạnh cần generalize thay vì xây mới:** commandDispatcher gate (4 lớp + ledger + readback), ERP outbox pattern, test-DB harness.

### 4.2 Database (4/10 vs chuẩn data platform manufacturing)

| # | Mức | Gap | Bằng chứng |
|---|---|---|---|
| B1 | **P0** | **App kết nối bằng SUPERUSER `postgres`** → 44 bảng RLS + WORM `audit_logs` bị bypass vô điều kiện; không `FORCE ROW LEVEL SECURITY`; migration 0102 tự yêu cầu role riêng mà chưa làm | probe: `usesuper=true`; `.env` |
| B2 | **P0** | **TimescaleDB vắng mặt main DB** — extension chỉ `plpgsql`; `db_feature_status: timescaledb_hypertables=missing`; toàn bộ 293 bảng là bảng thường; retention thực tế = DELETE batch app-level (0173 no-op) | probe + `drizzle/0172:60-75` |
| B3 | **P0** | **Quản trị migration gãy:** drizzle journal 18/216 entry (chết ở 0017); 2 bộ file trùng số 0000-0017 (+0077/0091/0100/0111); ~30 runner ad-hoc; runner mặc định lenient (lỗi chỉ log) | `drizzle/meta/_journal.json`; `scripts/migrate-standalone.mjs` |
| B4 | P1 | **Traceability đứt bằng text-join:** chỉ 1 "đảo FK" quanh inspection; 25 FK/293 bảng; serial không unique; không unit/serial master, không lot chuẩn hóa; rework derive bằng so khớp text | `inspection.ts:34`; `defectDisposition.ts` |
| B5 | P1 | Bật `TENANT_RLS_ENABLED` = no-op: `runWithTenantScope` **0 call site** data layer; coverage 44/308 bảng; policy hot-table dùng hàm per-row (điểm nóng hiệu năng) | `db/tenantContext.ts` |
| B6 | P1 | ~70 bảng log/time-series là bảng thường ngoài mọi kế hoạch hypertable (`machine_status_logs`, `mqtt_message_history`, `alert_history`, `command_log`...) | §1 báo cáo DB |
| B7 | P1 | N+1 fan-out per-machine trong aggregation/OEE/line-balance (1.500 round-trip/backfill); COUNT(*) mỗi request trên bảng lớn nhất; JSONB lạm dụng đường nóng (`process_results.metrics` filter+cast trong JSONB; dual-write `measurementData` trùng bảng chuẩn hóa; `product_models` 10MB/4 dòng) | `aggregationService.ts:243-301`; `process.ts:26` |
| B8 | P2 | **0 bảng dim/fact** cho reporting (khớp doc 32); 2 matview; shift không phải dimension | grep `dim_|fact_`=0 |
| B9 | P2 | updatedAt 57% không trigger; soft-delete 2 pattern; CHECK 49/308; thiếu composite index `machine_heartbeats`/`machine_status_logs`; PK toàn `serial` int (đụng nhau khi federation multi-site) | §2 báo cáo DB |
| B10 | P2 | Backup có service+cron nhưng không PITR/WAL-archiving, không restore-drill, chạy trong app process | `backupService.ts` |

---

## 5. GAP TRỤC 4 — FRONTEND vs SỨC MẠNH BACKEND (~70%)

**Số đo:** 209 router namespace / ~1.894 procedure server; **179/209 router (85,6%) có UI**, **~70% procedure được gọi**; **0** lệnh gọi procedure ma (typed AppRouter).

| # | Mức | Gap | Chi tiết |
|---|---|---|---|
| F1 | **P0** | **30 router mồ côi (~150+ proc)** — backend xây xong không ai chạm | Cụm chất lượng: `msaAdvanced`, `spcAlerts`, `measurementSamples`, `mpDefectStats`, `instrumentCalibration`+`instrumentMsaRecord` (calibration backend đầy đủ, **0 UI + 0 cron nhắc hạn**), `ipcAcceptance`, `stationTriangulation`; AI: `aiAnalysisHub` (13), `aiSpecialistAgent` (8), `aiSmartAlertRouting` (7); **`reportAggregators` (doc 32 R1 vừa xây: defect-Pareto/yield-by-product/weekly-trend) 0 UI**; `erpAdmin` (8), `simTargets` (6), `genealogy` (4)... |
| F2 | **P0** | **16 trang zombie** không đường điều hướng (không nav/palette/link): `/root-cause-analysis`, `/spc-advanced`, `/ai-analytics`, `/predictive-alerts`, `/enhanced-audit`, `/template-marketplace`... | code sống, user không bao giờ tới |
| F3 | **P0** | Role-based UX: chỉ **55/179 trang** gate write-action; viewer thấy nút → 403; RBAC chủ yếu = ẩn menu | doc 10 U-findings chưa đóng |
| F4 | P1 | Twin khai thác ~50%: `twin.replay`/`usdExport`/`pipeline` không UI; physics chỉ server; FactoryLiveMap3D polling không socket | |
| F5 | P1 | Reporting ~65%: artifact store dùng 1/5 proc (không có "kho báo cáo"); `universalExportService` (engine i18n tốt nhất) vẫn chưa nối vào ReportBuilder | *lưu ý: external/mobile report endpoint doc 32 nói STUB — trên branch này ĐÃ THẬT (`externalReportService.ts:599` + mig 0202)* |
| F6 | P1 | i18n: vi=en=12.934 key hoàn hảo; **zh thiếu 2.631 key (20%)**; 45 trang còn chữ Việt hardcode | |
| F7 | P1 | 47 trang không xử lý error; EmptyState 30/179; không query-wrapper chuẩn; không UX "tính năng chưa bật" cho flag-OFF | |
| F8 | P1 | Luồng (a) operator alert→defect thiếu deep-link (Andon board không link tới inspection/repair-station — phải tự scan lại); luồng (e) OT config: SECS/GEM, MTConnect sources, VDA5050, simTargets = sửa `.env`/API tay | `AndonBoard.tsx:285` |
| F9 | P2 | `History.tsx:2508` `Math.random()` trộn biến thiên giả vào trang thật; mount key `userSettingsRouter` sai làm ApiDocs dạy API không tồn tại; AndonBoard nghe 3 event server không bao giờ emit | |
| F10 | P2 | Realtime chỉ 13/179 trang socket-thật (đúng chỗ trọng yếu — chấp nhận được, nhưng LiveMap/CommandCenter vẫn polling) | |

**Trang lớn:** CommandCenter/MESControlTower/AndonBoard/OEEDashboard/RobotControl/DigitalTwin/IrEditor/OrchestrationStudio/AI-chat/Onboarding = **REAL**; CellTwinPlayer = predictor by-design; RfTestCellSim = demo-ware tự khai báo duy nhất.

---

## 6. ĐỐI CHIẾU KẾ HOẠCH DOC 33 — trạng thái thật

| Hạng mục doc 33 | Trạng thái 2026-07-05 |
|---|---|
| F1-F8 trên branch hiện tại | **0/8 chạm code** (8 cờ không tồn tại trong repo này) |
| F1-F8 trên `synapse-foundation` | **ĐÃ THỰC THI PHẦN LỚN** — 33 commit: editions/Helm/K3s/CI-2-profile (F1), plugin manifest `shared/plugin/manifest.ts` (F2), sidecar out-of-process stdio (F3 dạng stdio thay gRPC), OTel bridge (F6), reconciliation + API-spec endpoint (F7), tamper-evidence per-row hash (F5 một phần), RL shadow (H6 một phần) + 14-agent adversarial audit + 6 fix. **CHƯA MERGE** |
| Licensing grace | **Vẫn HALT** trên branch này: `license-guard.ts:520-541` readonly→locked chặn mutation; `LOCK_DAYS_AFTER_EXPIRY=15`. (Cần kiểm tra branch synapse có sửa chưa khi merge) |
| 6 trụ chiến lược | Con số doc 33 (25/70/60/30/5/10%) **vẫn đúng cho branch này**; cộng điểm mới: OpenAI /v1 gateway = proof "expose theo chuẩn có sẵn" (nhưng `.env` đang `OPENAI_GATEWAY_ENABLED=false` + key rỗng — doc 34 nói "live" là lỗi thời) |
| Ràng buộc git-hygiene 572 file | **ĐÃ GIẢI QUYẾT** — working tree sạch; doc 34 P2+P3 đã commit |
| Migration tiếp theo | **0204** (0202 report_artifacts + 0203 add_engineer_role đã dùng — doc 33 ghi 0202 đã lỗi thời) |

---

## 7. GÓC NHÌN CHUYÊN GIA ĐA CHIỀU (persona synthesis)

- **Kiến trúc sư MES 20 năm:** "Đây là hệ có golden-thread thật và AI vượt chuẩn ngành, nhưng nó là monolith-of-features chứ chưa phải platform. Trước khi thêm bất kỳ tính năng nào: tách `/api/v1` khỏi lỗ hổng guard, áp transaction, và quyết định số phận nhánh synapse — đừng để 2 nhánh rẽ xa thêm."
- **Kỹ sư OT/Controls:** "Chiều điều khiển OT là phần đáng tin nhất (4 gate + ledger + readback). Nhưng robot path không interlock và e-stop là scaffold — chưa được phép nói 'safety tier' với khách. SECS/GEM cờ bật mà rỗng là kiểu lỗi làm mất uy tín khi FAT."
- **Quality manager EMS:** "Inspection→SPC→disposition ngang sản phẩm thương mại. Nhưng tôi không thể audit khách hàng với: threshold duyệt xong máy không nhận, ZIP import né gate, FAI không gate, MRB/NCR/ECN không có, componentCode rỗng. Traceability L2 là điểm loại trong RFQ EMS."
- **Trưởng ca sản xuất:** "Operator terminal đẹp nhưng tôi vẫn chạy ca trên giấy: không clock-in, không start job, không đổi liệu, handover có backend mà không có nút bấm, escalation rule tôi cấu hình không bao giờ bắn."
- **DBA/Data engineer:** "Ba trụ an toàn dữ liệu đều 'trên giấy': superuser, không Timescale, ledger migration gãy. Sửa 3 cái này trước khi tăng tải hoặc bật multi-tenant — sau đó mới nói đến mart/BI."
- **Giám đốc sản phẩm platform:** "Giá trị thương mại lớn nhất đang bị khóa ở 2 chỗ: nhánh synapse chưa merge (9.790 dòng platformization đã trả tiền làm rồi) và 30 router mồ côi (giá trị đã xây mà khách không thấy). Khai thác cái đã có rẻ hơn nhiều so với xây mới."

---

## 8. KẾ HOẠCH THỰC THI ĐỀ XUẤT (chờ duyệt)

> Convention: mỗi wave = N agent chuyên môn · flag OFF mặc định (trừ hotfix) · migration từ **0204** · `npm run check` + `vite build` + smoke mỗi wave · wave-lead commit, **cấm subagent git** · cập nhật module-registry/navigation/i18n vi-en-zh.

### WAVE 0 — HOTFIX AN NINH (ngay, ≤1 ngày, không chờ các wave khác)
| # | Việc | File |
|---|---|---|
| 0.1 | Tắt/chuyển `EXTERNAL_MQTT_ENABLED` khỏi HiveMQ public (broker riêng + TLS + ACL, hoặc OFF) | `.env`, `mqttService.ts` |
| 0.2 | Tạo role `avi_app` least-privilege + đổi DATABASE_URL khỏi superuser; `FORCE RLS` bảng audit | migration 0204 + `.env` |
| 0.3 | Mount license/audit/RBAC guard trước `/api/v1`; siết `MASTER_API_KEY`; auth cho `aiLocalKbRouter` mutations; `requirePermission` cho `productionSession.*` | `_core/index.ts:4622-4728` |
| 0.4 | Gỡ `LICENSE_BYPASS=true`, `MACHINE_SHARED_KEY_ALLOWED=true` khỏi `.env` dev (hoặc ghi rõ lý do giữ) | `.env` |

### WAVE 1 — HỢP NHẤT NHÁNH (quyết định kiến trúc, trước khi chồng code)
Merge/rebase `synapse-foundation` (33 commit, +9.790 dòng) vào `automation-orchestration-r0`: audit diff → resolve conflict với doc 31/32/34 → chạy lại adversarial checks → **1 nhánh duy nhất** làm nền cho mọi wave sau. Đồng thời sửa **license grace HALT** (F4 doc 33) nếu nhánh synapse chưa sửa.

### WAVE 2 — DATA INTEGRITY & VÒNG LẶP ĐỨT (P0 nghiệp vụ)
| # | Việc | Gap đóng |
|---|---|---|
| 2.1 | AOI-ZIP commit gọi `processInspectionSubmission` (hoặc áp spec-gate + 3D fields) | D2 |
| 2.2 | Threshold apply: bump `pointsConfigVersion` + ghi `measurement_point_versions` (dùng `updateMeasurementPointDef`) | D4 |
| 2.3 | Retention `ot_telemetry`: bật app-retention 90d ngay + kế hoạch Timescale cutover (đường đã có `scripts/migrate-to-timescaledb.md`) | D3, B2 |
| 2.4 | `robotCommandDispatcher` gọi `evaluateInterlockGate` trước `driver.runJob` | quy trình 6 |
| 2.5 | Start escalation sweep lúc boot (flag-gated) + nối `escalateAndon` hoặc xóa; SLA-breach detector tối thiểu | quy trình 7 |
| 2.6 | OT-WAL `restore()` trong `startOt()`; hạ cờ SECS/GEM hoặc xây SV-poll thật (honest health) | D5, D7 |
| 2.7 | Migration governance: chốt `__applied_migrations` + `MIGRATE_STRICT=1` + quarantine file trùng số + regenerate drizzle baseline | B3 |
| 2.8 | Transaction cho cascade delete hierarchy + mqtt management + ingest multi-write | backend P0 |

### WAVE 3 — KHAI THÁC BACKEND ĐÃ CÓ (frontend, ROI cao nhất)
3.1 Nối cụm chất lượng mồ côi (MSA/SPC-alerts/IPC/calibration+cron nhắc hạn) vào QualityCockpit/ProductDetail · 3.2 `reportAggregators` 3 widget + universalExport vào ReportBuilder + trang "kho báo cáo" artifact · 3.3 Xử lý 16 trang zombie (nav hoặc xóa+redirect) · 3.4 Hook `useCanEdit` chuẩn + roll >100 trang · 3.5 Twin replay timeline + USD export UI · 3.6 Deep-link Andon→inspection/repair · 3.7 i18n zh + 45 trang hardcode · 3.8 Quyết định số phận AI hub mồ côi (nối hoặc deprecate).

### WAVE 4 — QUY TRÌNH NHÀ MÁY (đóng L-gap)
4.1 Bật pilot ERP inbound/outbox + routing master tối thiểu · 4.2 PM scheduler đọc `nextDueAt` sinh WO + spare parts consumption theo WO + hợp nhất MTTR/MTBF về 1 nguồn · 4.3 Feeder-setup verification (scan-verify chống gắn nhầm) + MSD clock + stencil counter · 4.4 ECN-lite (change request → impact → duyệt → effectivity, tái dùng pattern threshold_approvals) + document control revision · 4.5 Quality hold có hiệu lực (WIP on_hold chặn dispatch + sửa enum mismatch) + NCR/MRB tối thiểu · 4.6 FAI gate + golden-diff enforce sau program/threshold change · 4.7 Shift handover UI + clock-in/start-stop job cho operator terminal · 4.8 componentCode backfill từ BOM thật (tool sẵn) — *human item*.

### WAVE 5 — PLATFORM HARDENING (tiếp doc 33 sau merge)
Hoàn tất phần F1-F8 còn thiếu sau merge (đối chiếu lại) · SPC OOC → alert trung tâm · bus schema-version + DLQ + Redis fanout · dim/fact mart (R1 doc 32) · N+1/JSONB hot-path · worker split + leader election · E2E golden-thread + load test.

**Phụ thuộc:** W0 độc lập chạy ngay → W1 trước W2-W5 (tránh conflict) → W2 trước W4 (integrity trước quy trình) → W3 song song W2 (frontend ít đụng server) → W5 cuối.

---

## 9. QUYẾT ĐỊNH CẦN CHỦ SỞ HỮU DUYỆT

1. **Hotfix W0 (an ninh):** duyệt cho thực thi NGAY cả 4 mục? (0.1 HiveMQ là đang-chảy-máu; 0.2-0.4 đổi hành vi runtime dev)
2. **Chiến lược nhánh (W1):** (A) merge `synapse-foundation` vào `automation-orchestration-r0` ngay (khuyến nghị — 9.790 dòng platformization đã làm xong, để lâu conflict càng nặng) · (B) cherry-pick từng phần · (C) tiếp tục 2 nhánh song song (không khuyến nghị)?
3. **Thứ tự wave:** đồng ý W0→W1→W2→(W3∥W2)→W4→W5? Hay ưu tiên W3 (khai thác frontend) trước W2?
4. **Phạm vi W4:** làm đủ 8 mục quy trình hay chọn lọc (ví dụ hoãn ECN/kho vật tư nếu nhà máy chưa cần)?
5. **Timescale cutover (2.3):** làm trong đợt này (cần downtime off-peak + backup) hay chỉ bật app-retention rồi hoãn cutover?
6. **AI mồ côi (3.8):** nối UI hay deprecate `aiAnalysisHub`/`aiSpecialistAgent`/`aiSmartAlertRouting` để giảm bề mặt bảo trì?

> Sau khi anh chọn (1)-(6), tôi chốt danh sách agent thực thi từng wave (backend + migration + frontend + i18n + test), chạy flag-OFF → smoke → báo cáo "KẾT QUẢ THỰC THI" cập nhật vào doc này theo convention doc 24/27/31.

---

## 10. PHỤ LỤC — Bảng P0 hợp nhất (12 mục, xếp theo rủi ro)

| # | P0 | Trục | Wave |
|---|---|---|---|
| 1 | Dữ liệu sản xuất publish plaintext lên HiveMQ public | Data/Security | W0.1 |
| 2 | DB superuser → RLS/WORM vô hiệu (+ LICENSE_BYPASS, SHARED_KEY trong .env) | DB/Security | W0.2/0.4 |
| 3 | `/api/v1` bypass license+audit+RBAC; public mutations không auth; productionSession không permission | Backend/Security | W0.3 |
| 4 | AOI-ZIP bypass spec-gate + mất 3D fields | Data/Quality | W2.1 |
| 5 | Threshold duyệt xong máy delta-sync không nhận (no version bump) + apply né version-ledger | Quy trình/Quality | W2.2 |
| 6 | `ot_telemetry` không retention + TimescaleDB vắng mặt | DB | W2.3 |
| 7 | Robot dispatch không interlock gate; e-stop scaffold | Safety | W2.4 |
| 8 | Escalation config engine không start lúc boot; escalateAndon dead; no SLA-breach | Quy trình | W2.5 |
| 9 | Migration governance gãy (journal 0017, lenient, trùng số) | DB | W2.7 |
| 10 | Transaction vắng mặt ở cascade delete/multi-write | Backend | W2.8 |
| 11 | 2 nhánh rẽ đôi — 9.790 dòng platformization chưa merge | Chiến lược | W1 |
| 12 | License grace HALT (trái nguyên tắc "không dừng sản xuất") | Thương mại | W1 |

---
*Tài liệu 35 · deep audit 6+20 agent · kế thừa doc 16/22/24/27/31/32/33/34 · mọi số liệu có file:line trong báo cáo agent gốc · chờ phê duyệt §9.*
