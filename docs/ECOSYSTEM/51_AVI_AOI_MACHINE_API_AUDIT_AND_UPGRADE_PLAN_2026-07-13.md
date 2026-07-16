# Doc 51 — Audit toàn diện API máy AVI/AOI + Kế hoạch nâng cấp hoàn thiện

**Ngày:** 2026-07-13
**Nhánh:** `automation-orchestration-r0`
**Phạm vi:** Toàn bộ luồng máy AVI/AOI kết nối để **upload inspection + ảnh**, xuyên suốt:
`Setup máy mới → Đồng bộ → Sync điểm đo (SYNPOINT) → Kết nối MQTT/Realtime → Cập nhật inspection result → Dashboard & quản lý dữ liệu` + các tính năng xuyên suốt (auth/RBAC/rate-limit/idempotency/observability).
**Trạng thái:** ✅ **USER ĐÃ DUYỆT 8/8 quyết định (2026-07-13)** — xem **§8**. Đang thực thi **P0** (+ **P1-DOC** song song).
**Cập nhật (2026-07-13):** bổ sung **§9 — Rà soát drift Tài liệu API ↔ Code backend** (doc_health 54/100 · 143 endpoint/field thiếu doc). **§10 — P0 THỰC THI XONG** (idempotency + bịt rò credential + MQTT ACL, mig 0272-0273, verify DB thật). **§11 — P1 + P1-DOC THỰC THI XONG** (version propagation + clock-skew + version pinning + gate-by-snapshot + image atomic + rate-limit NAT + benchmark, mig 0274-0276, tsc 0 lỗi + 311 test xanh). **Chưa commit** — chờ review.

---

## 0. Phương pháp & mức độ tin cậy

| Hạng mục | Chi tiết |
|---|---|
| **Cách làm** | Workflow đa-agent: **6 agent audit** theo từng chặng của luồng → **12 agent kiểm chứng** các case thực tế khó (mỗi agent trace code thật, bám `file:line`) → **1 agent tổng hợp** chấm điểm + lộ trình. Tổng **19 agent**, ~1.62M token, 347 tool-call, ~16 phút. |
| **Kết quả agent** | 18/19 thành công. 1 agent (chặng *Dashboard*) fail schema-retry → chương này do tôi **tự đọc code trám lại**. |
| **Kiểm chứng độc lập** | Tôi đã **tự đọc code xác minh** 4 claim P0/P1 quan trọng nhất (đánh dấu ✔ **TỰ KIỂM CHỨNG** bên dưới), không tin mù kết quả agent. |
| **Nguyên tắc** | Phân biệt rõ **framework** (có khung/route) vs **production-ready** (chạy được, xử lý lỗi, idempotent, có test). Mọi finding kèm bằng chứng `file:line`. |

### 4 claim tôi đã tự kiểm chứng trên đĩa (✔)
1. ✔ **Rò credential:** `machineRouter.config` là `publicProcedure`, chỉ cần `serialNumber` là **trả `machine.apiKey` plaintext** khi máy đã approved — [hierarchyRouters.ts:706-722](../../server/routers/hierarchyRouters.ts#L706-L722).
2. ✔ **Không idempotent:** `product_inspections` **không có unique constraint** nào (grep `.unique()` trong schema chỉ khớp `packageId` của bảng khác) — [inspection.ts](../../drizzle/schema/inspection.ts).
3. ✔ **MQTT không ACL:** `grep authorizePublish|authorizeSubscribe` toàn `server/` = **0 match**.
4. ✔ **Propagation bug:** `pointsConfigVersion` chỉ được bump ở CAD applyJob ([productRouters.ts:3528-3533](../../server/routers/productRouters.ts#L3528-L3533)); `measurementPoint.update/delete` qua UI **không** bump.

---

## 1. Tóm tắt điều hành

> **Chủ đề:** *Framework đẳng cấp ~85% nhưng production ~½. Hệ **BỀN khi DB sập** (nếu bật cờ) nhưng **KHÔNG bền trước retry-trùng**, **thủng danh tính máy**, và **mù thời gian/đơn vị/version**. Khoảng cách là **kích-hoạt + siết + wiring**, KHÔNG phải viết lại.*

Luồng máy AVI/AOI được thiết kế tốt và giàu tính năng. Nó nổi trội ở những chỗ ít hệ làm tới: WAL store-and-forward có **5 test durability xanh**, auto-provision chống `pointDefId=0`, chuẩn hoá toạ độ 3-case, dedup ảnh theo hash, geometry đa dạng (circle/rect/polygon/mask/array + fiducial), và một lớp `/api/v1` hiện đại (scoped hashed key + envelope + OpenAPI).

Nhưng khoảng cách tới production nằm đúng ở những chỗ nhà máy thật sẽ vấp — và **ma trận 12 case khó cho kết quả rõ ràng: 0 PASS trọn vẹn, 8 PARTIAL, 4 GAP.**

**Điểm trưởng thành (0-100):**

| Chặng | Điểm | Khung / Prod |
|---|:--:|:--:|
| Setup máy mới + Commissioning + Danh tính | **57** | 85 / 52 |
| Đồng bộ điểm đo (SYNPOINT) | **55** | 88 / 52 |
| Kết nối MQTT + Realtime | **48** | 85 / 48 |
| Cập nhật inspection + Upload ảnh (xương sống) | **55** | 85 / 55 |
| Dashboard & quản lý dữ liệu *(tự trám)* | **~58** | 80 / 55 |
| Xuyên suốt (auth/versioning/rate-limit/idempotency) | **50** | 85 / 50 |
| **Độ bền case khó (12 case)** | **42** | — |

**Kết luận đầu tư:** Ước tính **P0 (~2-3 tuần-người) + P1 (~4-5 tuần-người)** đưa luồng từ ~52% lên **~80% production** cho triển khai **1 nhà máy**. P2/P3 cho multi-site + hoàn thiện.

---

## 2. Bản đồ hiện trạng luồng (thực tế trên code)

```
                    ┌─────────────────────────── MÁY AVI/AOI ───────────────────────────┐
                    │  Auth = apiKey (mk_ hash | mach_ plaintext) HOẶC machineCode        │
                    └───────────────────────────────┬────────────────────────────────────┘
                                                     │
   (1) SETUP/ONBOARD           (2) SYNC ĐIỂM ĐO       (3) INSPECTION + ẢNH        (4) REALTIME
   register→approve→key    syncMeasurementPoints    submitInspection/uploadImage   MQTT (aedes) +
   aoiOnboarding wizard    checkPointsVersion        → product_inspections         Socket.io fanout
   commissioning ledger    getPoints/deltaSync       → measurement_results         NG alert/summary
   machineAuthService      pointsConfigVersion       → storagePut (ảnh)            (1 chiều)
   (issue/rotate/revoke)   imageHash dedup           WAL store-forward (cờ OFF)
        │                       │                         │                            │
        └───────────────────────┴────────────┬────────────┴────────────────────────────┘
                                              ▼
   (5) DASHBOARD & DATA MGMT: statsCache 30s + materialized views (getHourlyStatsViaMV)
       + emitDashboardUpdate (socket push) → productionDashboard/stationAnalysis/realtimeReport
```

**Bề mặt API thực tế (3 lớp song song):**
- **tRPC `machineApi`** — đường máy **THỰC DÙNG** ([machineApiRouters.ts](../../server/routers/machineApiRouters.ts), 2373 dòng): `submitInspection`, `uploadImage`, `syncMeasurementPoints`, `syncProductImage`, `syncPointImage`, `heartbeat`, `checkPointsVersion`, `getPoints`, `getProductImage`, `getPointImage`, `deltaSyncPoints`, `getSyncHistory`.
- **REST proxy** `/api/machine/*`, `/api/public/*`, `/api/external/*` — cho client C#/Python/firmware.
- **`/api/v1/*`** — lớp hiện đại (scoped hashed key + envelope + OpenAPI), **nhưng KHÔNG phải** đường máy thực dùng.

---

## 3. Điểm mạnh (giữ nguyên, đừng đụng)

1. **WAL store-and-forward là hàng production thật** — JSONL + mirror RAM, bounds đếm/cảnh báo, dead-letter, exponential backoff, restore khi khởi động, dedup 2 tầng, **5 test durability xanh** ([inspectionStoreForward.ts](../../server/services/inspection/inspectionStoreForward.ts) + `machineApiDurability.test.ts`).
2. **Chống P0 data-integrity thật** — auto-provision `pointDef` để **KHÔNG BAO GIỜ** ghi `pointDefId=0` (`assertValidPointDefId`), transaction bọc measurement rows, tách image I/O ra ngoài tx đúng cách.
3. **Tính linh hoạt/đa dạng CAO** — nhiều `machineType` (AOI/AVI/SPI/AXI), geometry P1 phong phú + fiducial + expand array→cells, adapter vendor động qua vision registry, máy mới **không bị chặn** khi chưa có product/recipe.
4. **Lớp `/api/v1` gần production** — scoped API-key hash SHA-256 at-rest, scope least-privilege, envelope `{ok,data,error}`, `wrap()` fail-safe, license-guard never-stop-production, key lifecycle mint/rotate/revoke plaintext-once.
5. **Xử lý conflict machineCode chắc + CÓ TEST** — partial-unique `uq_machines_code_active`, retry suffix, chặn serial retired, TOCTOU race → CONFLICT; lifecycle transition có ma trận hợp lệ + dual-audit.
6. **Nền version điểm đo tốt** — `pointsConfigVersion` + `measurementPointVersions` snapshot per-point + delta-sync + optimistic lock (đã xây cho đường UI) → **đủ hạ tầng để vá các gap còn lại mà không phải xây mới**.
7. **Observability nền vững** — correlation-id ALS, Prometheus `/metrics`, `/api/observability/*`, SLO.

---

## 4. Top rủi ro (xếp theo mức nghiêm trọng)

| # | Rủi ro | Bằng chứng | Trạng thái |
|:--:|---|---|:--:|
| R1 | **Rò credential máy tầm thường** — `config` public trả apiKey plaintext chỉ cần serialNumber + machineCode-only không secret + shared-key plaintext mặc định BẬT → bất kỳ ai trong LAN giả mạo máy, bơm inspection/NG giả | hierarchyRouters.ts:722; machineAuthService.ts:237-248 | ✔ **XÁC MINH** |
| R2 | **Đếm trùng sản phẩm** — `product_inspections` không unique + live không idempotent → retry sau mất-ACK khi DB khỏe ghi 2 hàng → yield/OEE/completedQuantity sai, ERP outbox + NG alert bắn 2 lần. Kịch bản mạng-chập-chờn **cực phổ biến** | inspection.ts (no unique); machineApiRouters.ts:334,896-943 | ✔ **XÁC MINH** |
| R3 | **Broker MQTT không có ACL topic nào** → tablet lỗi/độc publish giả lệnh `configure`/`software-update`/`errors` cho thiết bị khác hoặc nghe lén topic trạm khác | grep ACL = 0 | ✔ **XÁC MINH** |
| R4 | **Propagation bug** — sửa/xoá điểm đo qua UI KHÔNG bump `pointsConfigVersion` → máy poll không bao giờ thấy → kiểm theo cấu hình lỗi thời, escape lỗi điểm mới, tái kiểm điểm đã khai tử | productRouters.ts:1368 (no bump) | ✔ **XÁC MINH** |
| R5 | **Mù thời gian/đơn vị/version âm thầm** — clock-skew sai ca/ngày không cảnh báo; mil↔mm không quy đổi → spec-gate hạ OK→NG hàng loạt; kết quả không pin version → không trả lời được "board này chấm theo ngưỡng nào" | CASE #3/#11/#12 | GAP |
| R6 | **Mất dữ liệu do rate-limit NAT** — máy gửi apiKey trong BODY → limiter fallback IP → 100 máy sau 1 NAT chung 1 bucket 300/min → 429 phát TRƯỚC tRPC nên WAL không đệm | rateLimitConfig.ts:207-223 | PARTIAL |
| R7 | **Lưới an toàn tồn tại nhưng TẮT** — `INSPECTION_STORE_FORWARD_ENABLED` mặc định OFF (mất dữ liệu khi DB sập); streaming NATS/StreamProcessor chưa vận hành | inspectionStoreForward.ts:69-77 | — |
| R8 | **Ảnh mồ côi + không atomic** — header inspection commit rời khỏi tx measurement; storage fail giữa chừng để lại ảnh rác (forge/S3 không có orphan-reaper) hoặc defect NG không có ảnh bằng chứng | CASE #5 | GAP |

---

## 5. Findings theo chặng (đã lược, xếp hạng)

> Ký hiệu severity: **P0** chặn production · **P1** nghiêm trọng · **P2** cần vá · **P3** hoàn thiện.

### 5.1 — Setup / Commissioning / Danh tính  (khung 85 / prod 52)

| Sev | Loại | Finding | Bằng chứng |
|:--:|---|---|---|
| **P1** | security | `config` public trả apiKey plaintext chỉ cần serialNumber | hierarchyRouters.ts:706-722 ✔ |
| **P1** | security | Đường xác thực machineCode-only không có bí mật | machineAuthService.ts:237-248 |
| **P1** | robustness | Retire/decommission **không** thu hồi apiKey → máy "đã loại" vẫn ingest | hierarchy.ts:555-557 vs machineAuthService.ts:212 |
| **P2** | contract | Wizard onboarding vẫn dùng key plaintext cũ thay vì `mk_` hashed (2 hệ credential song song) | aoiOnboardingRouter.ts:30-32; hierarchyRouters.ts:928-941 |
| **P2** | gap | Hai hệ "commissioning" trùng tên nhưng rời rạc (OT-actuation vs AOI-ingest) | commissioningRouter.ts vs aoiOnboardingRouter.ts |
| **P2** | gap | `machineCode`/URN unique **GLOBAL** — không namespace theo site/factory | hierarchy.ts:321 |
| **P2** | missing | Capability không nằm trong luồng commissioning; sign-off không kiểm capability | hierarchyRouters.ts:964-991 |
| **P3** | gap | Self-service vẫn phải admin duyệt để có key (nghẽn single-admin) | hierarchyRouters.ts:589,749 |
| **P3** | robustness | `heartbeat` không áp rate-limit ingest | machineApiRouters.ts:1399-1410 |

### 5.2 — Đồng bộ điểm đo (SYNPOINT)  (khung 88 / prod 52 — **chín nhất về API**)

| Sev | Loại | Finding | Bằng chứng |
|:--:|---|---|---|
| **P1** | bug | CRUD điểm đo qua UI **không bump** `pointsConfigVersion` → máy không bao giờ thấy sửa/xoá | productRouters.ts:1224,1368 ✔ |
| **P1** | contract | `deltaSyncPoints` **không phải delta thật** (full-nếu-đổi) + **không có tombstone** cho điểm đã xoá | product.ts:1899-1907 |
| **P2** | robustness | Máy-push bỏ qua optimistic lock → last-write-wins ngầm khi 2 máy/máy+admin ghi cùng điểm | machineApiRouters.ts:1279 |
| **P2** | robustness | Upsert theo code **không atomic** — thiếu unique `(productModelId,code)`, batch ngoài transaction | machineApiRouters.ts:1166; product.ts:390-394 |
| **P2** | contract | `getPoints` (full pull) thiếu shape/geometry/fiducials mà chỉ `deltaSync` có | machineApiRouters.ts:1511-1533 |
| **P3** | missing | Không hỗ trợ product-variant trong toàn bộ hợp đồng sync | grep `variant` = 0 |
| **P3** | gap | Không có rollback `pointsConfigVersion` về trạng thái trước | version chỉ tăng đơn điệu |
| **P3** | robustness | Normalized↔absolute dùng `Math.round` → trôi toạ độ khi round-trip lặp | machineApiRouters.ts:1133-1139 |

### 5.3 — MQTT + Realtime  (khung 85 / prod 48 — **thấp nhất**)

Broker = **Aedes EMBED trong tiến trình Node** (TCP 1883 / WS 8883 / TLS 8884). **MQTT KHÔNG phải đường ingest inspection** — inspection đi qua tRPC HTTP; MQTT inbound chỉ xử lý `DEVICE_INFO` + `CONFIGURE_ACK`, còn lại là **fanout 1 chiều** (NG alert/summary/bulletin/command). Socket.io **LUÔN BẬT**.

| Sev | Loại | Finding | Bằng chứng |
|:--:|---|---|---|
| **P0** | security | Broker **không có `authorizePublish/authorizeSubscribe`** → mọi client đọc/ghi mọi topic kể cả topic lệnh | grep = 0 ✔ |
| **P1** | security | Admission gate hình thức — thiết bị lạ tự đăng ký PENDING **vẫn được connect** | mqttService.ts:804-888 |
| **P2** | gap | Streaming NATS/JetStream mới là **seam chưa vận hành**; `StreamProcessor` là code mồ côi (chỉ test gọi) | streamBridge.ts:137-139; grep StreamProcessor |
| **P2** | robustness | Presence máy Socket.io lưu **Map in-memory** — không đa-instance dù có Redis adapter | socket.ts:38-41 |
| **P2** | perf | Backpressure: aedes đệm RAM không kiểm soát; NG `retain=true` phát bản NG cũ cho subscriber mới | mqttService.ts:1475-1488 |
| **P3** | robustness | External client + server không đặt Last-Will (LWT) | mqttService.ts:673-688 |
| **P3** | contract | Hai hệ "trạng thái kết nối" song song dễ lệch (Socket.io in-mem vs MQTT DB) | socket.ts:39 vs mqttService.ts:918-949 |

### 5.4 — Inspection + Upload ảnh (xương sống)  (khung 85 / prod 55)

| Sev | Loại | Finding | Bằng chứng |
|:--:|---|---|---|
| **P1** | robustness | Đường LIVE **không idempotent** — retry lúc DB khỏe ghi trùng inspection | machineApiRouters.ts:896-943; inspection.ts (no unique) ✔ |
| **P1** | gap | Store-and-forward offline **mặc định TẮT** — mất dữ liệu khi DB sập trên cấu hình mặc định | inspectionStoreForward.ts:69-77 |
| **P2** | perf | Ảnh: không validate size/format, không presigned direct-to-storage (giải mã base64 trong RAM ở nút nóng nhất) | machineApiRouters.ts:459-494 |
| **P2** | gap | `serialNumber` không có min-length — chấp nhận chuỗi rỗng | machineApiRouters.ts:120 |
| **P2** | missing | Multi-panel N-board: 1 submission/board, **không atomic toàn panel** | machineApiRouters.ts:144-145 |
| **P2** | contract | REST proxy `/api/machine/*` gộp mọi lỗi thành HTTP 400 + log full payload base64 | index.ts:559-582 |
| **P3** | robustness | `uploadImage` bắt buộc apiKey trong body + để lại object mồ côi khi retry | machineApiRouters.ts:992,1054-1062 |
| **P3** | bug | `measuredValue`: ép kiểu số quá rộng (`Number(' ')→0`, `'1e3'`...) | machineApiRouters.ts:540-547 |

### 5.5 — Dashboard & quản lý dữ liệu  *(chương tự trám — agent fail)*

Lớp dashboard **được xây hợp lý**: query `protectedProcedure` + `statsCache` TTL 30s + **materialized views** (`getHourlyStatsViaMV`, `materializedViewRefreshService`) + **realtime push** qua `emitDashboardUpdate` (socket) bắn từ `submitInspection`. Nghĩa là có **cả đường realtime lẫn đường cache/MV**.

**Vấn đề cốt lõi:** dashboard **phản chiếu trung thực** mọi lỗi toàn-vẹn ở thượng nguồn — nên các bug ingest biến thành **sai số hiển thị âm thầm**:
- **Đếm trùng (R2)** → yield/OEE/sản lượng bị thổi phồng trên mọi widget.
- **`productModelId=NULL` (CASE #6)** → board bị **loại lặng** khỏi mọi báo cáo theo model (analytics keyed theo `productModelId`).
- **Clock-skew (CASE #3)** → sai quy kết ca/ngày trên Andon board + báo cáo ca.
- **Panel-yield thiếu (CASE #7)** → chỉ có yield board, không có yield panel.
- **Presence in-memory (5.3)** → bảng "máy online" sai ở ≥2 instance.
- **Staleness:** cache 30s + nhịp refresh MV → dashboard KHÔNG tức thời cho query path (realtime chỉ qua socket push).

> **Kết luận chương:** dashboard **không phải nguồn lỗi**; sửa thượng nguồn (P0/P1) sẽ tự khoẻ. Việc cần làm riêng: **panel-yield aggregation** + **reconciliation `productModelId`** + **presence unification** (đã nằm trong lộ trình).

### 5.6 — Xuyên suốt (auth/versioning/rate-limit/idempotency/observability)  (khung 85 / prod 50)

| Sev | Loại | Finding | Bằng chứng |
|:--:|---|---|---|
| **P1** | security | machineCode-only auth vẫn hoạt động + là phương thức tài liệu-hoá chính, bỏ qua scope | machineAuthService.ts:238-248 |
| **P1** | security | Legacy shared apiKey lưu **PLAINTEXT** at-rest, mặc định cho phép, bỏ qua scope | machineAuthService.ts:53-55,219-231 |
| **P1** | robustness | Không có idempotency key trên đường ingest LIVE (stamp `inspectionTime=now()` mỗi request) | machineApiRouters.ts:898-943 |
| **P1** | robustness | Rate-limit `/api` 300/min gộp theo IP cho máy auth bằng body apiKey → mất dữ liệu sau NAT | rateLimitConfig.ts:207-223 |
| **P2** | contract | Error contract phân mảnh 3 kiểu + proxy gộp mọi lỗi thành 400 (lossy 401/429/500→400) | envelope.ts; router.ts:328-332; index.ts:580 |
| **P2** | gap | Audit ingest **không WORM** và chỉ có ở `/api/v1`; đường máy chính không audit request-level | guard.ts:103-141 |
| **P2** | doc-drift | Đường máy chính `/api/machine` + tRPC **không versioned** và không có trong OpenAPI | router.ts:578-586 |
| **P2** | doc-drift | `AUTHENTICATION.md`/`ERROR_CODES.md` drift so code (auth model + rate-limit 1000/15min vs thực 300/60s) | apidocs/* vs rateLimitConfig.ts:49-55 |
| **P2** | security | Weak-auth path bỏ qua least-privilege scope hoàn toàn | machineAuthService.ts:200-205 |
| **P3** | security | Key máy tĩnh dài hạn, không request-signing/nonce, mTLS mặc định no-op, `expiresAt` tuỳ chọn | auth.ts:107; router.ts:143-145 |
| **P3** | perf | Proxy `/api/machine/submit-inspection` log toàn bộ measurement mỗi request | index.ts:569-573 |

---

## 6. Ma trận 12 case kiểm chứng thực tế (đa chiều)

> **0 HANDLED trọn vẹn · 8 PARTIAL · 4 GAP.** Đây là chiều yếu nhất và là bằng chứng rõ nhất cho khoảng cách production.

| # | Case | Phán quyết | Điều gì hỏng ở nhà máy |
|:--:|---|:--:|---|
| 1 | **Idempotency** — retry sau timeout | 🟡 PARTIAL | Retry lúc DB khỏe → 2 hàng cùng serial → yield/OEE/order-count đôi, ERP outbox + NG alert bắn 2 lần. Dedup chỉ có ở WAL-replay. |
| 2 | **Offline drain** — mất mạng 2h, 5000 bản | 🟡 PARTIAL | Server nhận ~600/phút rồi 429 (không Retry-After, WAL không đệm 429). Client ngây thơ → mất ~4400 bản. WIP out-of-order last-write-wins. |
| 3 | **Clock-skew** — đồng hồ máy lệch/naive | 🔴 **GAP** | Không phòng vệ lệch giờ ở ingest. Máy lệch 6h → sai ca/ngày **âm thầm**. Naive timestamp → lệch đúng offset nhà máy. |
| 4 | **Schema-drift** — model đổi, máy gửi bản cũ | 🟡 PARTIAL | Điểm đã xoá **tái sinh** thành def auto (không limit → lọt spec-gate); 3 điểm mới **không bao giờ được kiểm** (escape). |
| 5 | **Image atomicity** — ảnh 40MB / upload-vs-DB fail | 🔴 **GAP** | Header commit rời tx; storage OK + DB fail → **ảnh mồ côi** (forge/S3 không reaper); DB OK + storage fail → NG **không có ảnh bằng chứng**, âm thầm. |
| 6 | **Ordering-dependency** — chưa có product/recipe | 🟡 PARTIAL | Không chối/không crash (tốt) NHƯNG `productModelId=NULL` vĩnh viễn → **board biến mất** khỏi báo cáo theo model; không job reconciliation. |
| 7 | **Multi-panel** — 1 panel 8 board, 2 NG | 🟡 PARTIAL | Truy vết per-board OK; NHƯNG **không có panel-yield** (chỉ board-yield); máy chỉ xuất 1 report/panel → mất quy kết per-board. |
| 8 | **Serial-collision** — trùng/rỗng serial | 🟡 PARTIAL | Nhận cả hai không cảnh báo; `station_traces` key thuần serial → **ghi đè phả hệ**; serial `""` được chấp nhận hàng loạt. |
| 9 | **Backpressure** — 100 máy × 1/s + ảnh | 🟡 PARTIAL | Ghi DB **đồng bộ** (không queue), pool mặc định 25; NAT → chung bucket 300/min → ~95% request 429 → rớt nếu client không buffer. |
| 10 | **Auth-rotation** — revoke/rotate giữa chừng | 🟡 PARTIAL | Revoke hiệu lực tức thì (tốt) NHƯNG **không key-handoff tự động** (401 đột ngột, phải ra máy nhập tay); **machineCode-path bypass** revoke; key mặc định vĩnh viễn. |
| 11 | **Unit-coordinate** — mil vs mm / lệch gốc | 🔴 **GAP** | Không quy đổi đơn vị → spec-gate so raw-vs-raw → **hạ OK→NG hàng loạt** (false-reject) hoặc bỏ lọt NG; fiducial chỉ đọc-ra, server không tự căn. |
| 12 | **Config-race** — đổi ngưỡng khi máy đang gửi | 🔴 **GAP** | Kết quả **không pin version** → không trả lời được "chấm theo ngưỡng nào"; spec-gate LIVE → split-brain; bump version read-modify-write **không atomic**. |

*(Chi tiết trace từng case + `file:line` đầy đủ trong output workflow — có thể xuất kèm nếu cần.)*

---

## 7. Lộ trình nâng cấp hoàn thiện (CHỜ DUYỆT)

### P0 — Bịt thủng bảo mật + chống đếm-trùng  ·  ~2-3 tuần-người  ·  **BLOCKER**
> *Đóng lỗ credential giả-mạo-máy và ngăn ghi trùng inspection — 2 rủi ro phá toàn vẹn nghiêm trọng nhất, đều đã xác minh trên đĩa.*

- [ ] **Idempotency LIVE:** partial `uniqueIndex product_inspections(machineId, serialNumber, inspectionTime) WHERE serialNumber<>''` + `createProductInspection` → `onConflictDoNothing().returning`, trả `inspectionId` cũ khi trùng. *(R2, CASE #1)*
- [ ] **Bịt `config` public:** không trả apiKey qua endpoint public; thay bằng one-time claim-token hết hạn ngắn / lấy key qua wizard admin. *(R1 ✔)*
- [ ] **Cờ tắt weak-auth cho ghi:** `MACHINE_CODE_ONLY` + `MACHINE_SHARED_KEY_ALLOWED` mặc định **FALSE** ở production cho mọi mutation ingest; buộc `mk_` scoped key. *(R1)*
- [ ] **MQTT topic ACL:** thêm `aedes.authorizePublish/authorizeSubscribe` — client chỉ pub `avi/client/{chính-deviceId}/*` + sub topic station được map; chỉ server-clientId mới pub nhánh `errors`/`configure`. *(R3 ✔)*
- [ ] **Siết `serialNumber`:** `z.string().trim().min(1).max(100)`. *(CASE #8)*
- [ ] **Bật `INSPECTION_STORE_FORWARD_ENABLED`** trong profile production + smoke-test replay. *(R7)*
- [ ] **Retire → revoke key:** `setLifecycleStatus` sang retired/decommissioned → revoke toàn bộ `api_keys` theo machineId + clear `machines.apiKey` trong cùng transaction.

**Exit:** 2 submit live cùng payload → 1 row + cùng `inspectionId`; `config` không còn trả apiKey; MQTT client giả không sub/pub ngoài phạm vi; máy retired nhận 401; DB sập giữa chừng → replay đủ. Không còn P0/P1 security hở trên đường máy chính.

### P1 — Toàn vẹn dữ liệu chất lượng: version pinning, propagation, thời gian, ảnh atomic  ·  ~4-5 tuần-người
> *Đảm bảo kết quả kiểm phản ánh đúng cấu hình/thời gian máy thật sự dùng, và thay đổi cấu hình lan tới máy.*

- [ ] **Bump version cho MỌI mutation điểm đo:** helper `bumpPointsConfigVersion(productModelId)` + `publishPointsConfigChanged` ở `measurementPoint.create/update/delete`. *(R4 ✔, CASE #4)*
- [ ] **Version pinning kết quả:** thêm cột `pointsConfigVersion` (+ optional `recipeVersion`) vào `product_inspections`; máy gửi kèm version đang dùng; tag `stale_config` nếu < current. *(CASE #12/#4)*
- [ ] **Delta thật + tombstone:** `deltaSync` trả mảng `deletedCodes`; chặn hồi sinh điểm tombstoned trong resolver. *(CASE #4)*
- [ ] **Phòng vệ clock-skew:** `inspectionTime → z.string().datetime({offset:true})`; luôn stamp `serverReceivedAt`; skew > 5 phút → cột cờ + cảnh báo ops; loại "fake-UTC shift" phụ thuộc TZ, ép `TZ=UTC`. *(CASE #3)*
- [ ] **Image atomicity:** bọc `createProductInspection` + insert measurement vào **cùng tx**; compensation `storageDelete` khi tx fail sau upload; không nuốt lỗi upload NG (`imageUploadPending` + retry); `.max()` cho `imageBase64`. *(CASE #5)*
- [ ] **Rate-limit NAT fix:** buộc credential qua header `x-api-key` (hoặc đọc `body.apiKey` vào keyGenerator); tách `submitInspection` sang ingest-tier riêng như `/api/ot/ingest`; 429 kèm `Retry-After`. *(R6, CASE #2/#9)*
- [ ] **Upsert điểm đo atomic:** unique `(productModelId,code) WHERE deletedAt IS NULL` + `ON CONFLICT DO UPDATE`, batch trong 1 tx.

**Exit:** sửa điểm đo qua UI → máy re-fetch; xoá điểm → `deletedCodes` trong delta; row inspection mang version trả lời được "chấm theo version nào"; máy lệch 6h → gắn cờ + đúng ca; DB fail giữa chừng → không còn ảnh mồ côi; burst 100 máy sau NAT không mất dữ liệu.

### P2 — Hợp đồng cứng, quy đổi đơn vị, siết đường phụ  ·  ~4-6 tuần-người
- [ ] **Quy đổi đơn vị:** field `unit` (+ `unitScaleToCanonical`) vào schema measurement; convert về canonical **TRƯỚC** `evaluatePointResult`; unit-mismatch không convert được → không gate + telemetry. *(CASE #11)*
- [ ] **Optimistic lock đường máy-push** (`expectedUpdatedAt` vào `syncMeasurementPoints`).
- [ ] **Hợp nhất error contract:** map `TRPCError.code → HTTP status` thật; 1 envelope + bảng error-code idempotent-safe; gỡ log base64 hot-path.
- [ ] **Audit đường máy chính:** ghi audit best-effort request-level trong `processInspectionSubmission`; cân nhắc WORM/hash-chain.
- [ ] **Version hoá `/api/machine` + OpenAPI** + sửa doc-drift + contract test.
- [ ] **Panel-yield/FPY:** `GROUP BY panelSerial` trong statistics + completeness-check nUp + unique `(machineId,panelSerial,boardIndex)`. *(CASE #7)*
- [ ] **MQTT admission thật:** `approvalStatus≠APPROVED` → chỉ topic pairing.
- [ ] **Reconciliation `productModelId`:** backfill khi model được tạo + fk-soft-orphan check. *(CASE #6)*
- [ ] **`getPoints` geometry parity** + **WIP out-of-order guard** + **serial-collision soft-detect**.

### P3 — Chiến lược: streaming, đa nhà máy, zero-touch, vận hành  ·  ~5-8 tuần-người
- [ ] Streaming: **QĐ** activate NATS/JetStream + wiring `StreamProcessor`, HOẶC tài liệu-hoá "chưa kích hoạt".
- [ ] Presence unification (Redis/DB) đa-instance.
- [ ] Zero-touch onboarding (enrollment token/allowlist) — gỡ nghẽn single-admin.
- [ ] Key expiry mặc định + kênh `keyRotationPending` → rotate zero-downtime. *(CASE #10)*
- [ ] Batch-ingest endpoint (reconnect-drain). *(CASE #2/#9)*
- [ ] Product-variant / Multi-factory namespace (theo QĐ topo).
- [ ] Hợp nhất 2 hệ commissioning + capability step; server-side fiducial registration; orphan-reaper DB-diff; version rollback API.

---

## 8. Quyết định — ✅ **USER ĐÃ DUYỆT (2026-07-13)**

| # | Quyết định | ✅ Chốt | Hệ quả kế hoạch |
|:--:|---|---|---|
| 1 | Siết auth máy (tắt machineCode-only + shared-key plaintext) | **Chấp nhận migration CÓ KIỂM SOÁT** | Giữ cờ, **default FALSE chỉ ở profile production**; cần **cửa sổ rotation** sang `mk_` + tooling + phối hợp vendor. KHÔNG flip tắt đột ngột. |
| 2 | Split-brain pass/fail (CASE #12) | **Chấm theo SNAPSHOT đúng version máy khai** | ⬆️ **Tăng việc**: spec-gate phải đọc limit theo version từ `measurementPointVersions`, không đọc LIVE. **Phụ thuộc version-pinning (P1)** → gate-by-snapshot phải làm SAU khi pin version. |
| 3 | Serial-collision (CASE #8) | **Nhận-và-gắn-cờ `suspected_duplicate`** (không mất dữ liệu) | Không từ chối cứng. Thêm cột/cờ + cảnh báo, vẫn lưu. Scope lại `station_traces` để không ghi đè phả hệ. |
| 4 | Topo đa nhà máy | **Tiếp tục federation DB-tách-rời** | ⬇️ **Giảm việc**: **BỎ** hạng mục đưa `siteId` vào unique key máy. Thay bằng **tài liệu-hoá ràng buộc** "1 DB = 1 nhà máy". |
| 5 | Streaming (P3) | **Đầu tư kích hoạt NATS/JetStream THẬT** | `npm i nats` + `STREAM_BRIDGE_BACKEND=nats` + `NATS_URL` + bật tap + **wiring `StreamProcessor` vào consumer thật** (hiện mồ côi). |
| 6 | `INSPECTION_STORE_FORWARD_ENABLED` | **DUYỆT — bắt buộc khi go-live** | Vào P0 + smoke-test replay + đưa vào runbook go-live. |
| 7 | Ngân sách & thứ tự | **DUYỆT P0 → P1** + **CẦN benchmark thật** | **Benchmark 100 máy × 1/s + ảnh là DELIVERABLE BẮT BUỘC** trước khi cam kết SLA (doc 48 mới dry-run). Đưa vào exit-criteria P1. |
| 8 | Hợp đồng đơn vị (CASE #11) | **Thêm field `unit`** | Xem ghi chú diễn giải ⬇️ |

> **⚠️ Ghi chú diễn giải QĐ #8** — bạn chốt "thêm field `unit`" nhưng chưa nói *bắt buộc* hay *tuỳ chọn*. Để nhất quán với **QĐ #1 (migration có kiểm soát)**, tôi triển khai theo hướng **không phá vendor ngay**:
> `unit` **optional** → khi vắng thì **suy luận từ point-def** + phát telemetry `unit-mismatch` → **bắt buộc khai** ở cuối cửa sổ migration (cùng nhịp với rotation key của QĐ #1).
> *Nếu bạn muốn bắt buộc ngay từ đầu, báo tôi — đây là điểm duy nhất tôi tự diễn giải.*

### 8.1 — Delta kế hoạch sau khi chốt (so với §7 gốc)

- **➕ Thêm vào P1:** gate-by-snapshot theo version (QĐ #2) — phụ thuộc version-pinning; **benchmark 100 máy × 1/s** (QĐ #7).
- **➕ Thêm vào P0:** tooling + runbook **rotation key có kiểm soát** (QĐ #1) — không chỉ là flip cờ.
- **➖ Bỏ khỏi P2/P3:** `siteId` vào unique key máy (QĐ #4) → thay bằng tài liệu-hoá ràng buộc federation.
- **🔒 Xác nhận P3:** kích hoạt NATS/JetStream thật + wiring `StreamProcessor` (QĐ #5).
- **🔀 Song song:** **P1-DOC** (§9.5) chạy song song P0 — đụng file rời nhau (chỉ `apidocs/`), gỡ rủi ro tích hợp bên thứ 3 ngay.

---

## 8bis. Quyết định cần bạn duyệt *(bản gốc — lưu vết)*

<details>
<summary>Xem 8 câu hỏi gốc trước khi chốt</summary>

1. **DUYỆT siết auth máy** (P0): tắt machineCode-only + shared-key plaintext cho ghi ingest ở production. ⚠️ **BREAKING** → cần cửa sổ rotation sang `mk_` key + phối hợp vendor. → *Chấp nhận migration có kiểm soát hay giữ tương thích ngược lâu hơn?*
2. **Split-brain pass/fail** (CASE #12): server chấm lại theo limit **LIVE** hay theo **snapshot đúng version máy khai**?
3. **Serial-collision** (CASE #8): **nhận-và-gắn-cờ** hay **từ chối cứng**?
4. **Topo đa nhà máy**: **cùng-DB** (cần `siteId` vào unique key) hay **federation DB-tách-rời**?
5. **Streaming** (P3): kích hoạt NATS/JetStream thật hay in-process + tài liệu-hoá?
6. **DUYỆT bật `INSPECTION_STORE_FORWARD_ENABLED`** khi go-live.
7. **DUYỆT ngân sách & thứ tự** P0+P1. → *Có cần benchmark scale thật không?*
8. **Hợp đồng đơn vị** (CASE #11): bắt buộc khai `unit` hay suy luận + cảnh báo?

</details>

---

## 9. Rà soát DRIFT: Tài liệu API (`apidocs/`) ↔ Code backend  *(bổ sung theo yêu cầu)*

> Rà soát **2 chiều** giữa `apidocs/*.md` và code thực (workflow **9 agent**, mỗi agent liệt kê mọi endpoint code rồi diff với tài liệu). Tôi **tự kiểm chứng trên đĩa** các claim nặng nhất (đánh dấu ✔).

### 9.1 — Kết luận: **Tài liệu LỆCH có hệ thống theo đúng một chiều — DOC CŨ HƠN CODE**

**Điểm sức khoẻ tài liệu: `54/100`.** Không có endpoint doc-only/đã-gỡ nào (khung tài liệu vẫn trung thực về cái đã viết), nhưng backend vừa nâng cấp nhiều mảng lớn mà tài liệu **chưa phản ánh**: **tổng 143 endpoint/field có trong code nhưng thiếu tài liệu**, 93 drift. → **Nghi ngờ của bạn ĐÚNG:** lõi sync/CRUD REST còn chính xác (~85-90%) nhưng mọi tính năng backend mới đều **vô hình hoặc mô tả sai**.

### 9.2 — Độ phủ tài liệu (đối chiếu 2 chiều)

| Tài liệu | Code có / doc thiếu | Doc-only (không có code) | Mức lệch |
|---|:--:|:--:|:--:|
| `MACHINE_API.md` | **9** (12/21 procedure — ẩn ~43%) | 0 | 🔴 nặng |
| `SYNC_API.md` | **60** | 0 | 🔴 nặng |
| `EXTERNAL_INSPECTION_API.md` | **20** | 0 | 🟠 |
| `PRODUCT_API.md` | 3 | 0 | 🟢 nhẹ |
| `AUTHENTICATION.md` + `ERROR_CODES.md` | **9** + facts sai-cứng | 0 | 🔴 nặng |
| `SYNPOINT_GUIDE.md` + `measurement-geometry-and-fiducials.md` + `SYNPOINT_SAMPLE.json` | **22** | **8** (tên field sai) | 🔴 nặng nhất |
| `AI_MODEL_API.md` | 2 (MLOps stage) | 0 | 🟢 nhẹ |
| Android guides + `EXAMPLES.md` | **18** | 8 (endpoint/field sai) | 🟠 |

### 9.3 — Drift khiến integrator TÍCH HỢP HỎNG (P1)

1. **Toàn bộ luồng Edge Model Deploy / OTA không tài liệu ở BẤT KỲ file nào** ✔ — `machineApi.checkModelVersion` (:2168), `getModelPackage` (:2212), `confirmDeployment` (:2261), `edgeHeartbeat` (:2291), `syncEdgeResults` (:2320), scope `edge:sync`. Đội edge không xây được client OTA → deployment kẹt `DOWNLOADING`, inference offline mất.
2. **Auth per-machine qua HTTP header không được nêu** ✔ — code đọc `Authorization: Bearer` HOẶC `X-API-Key` ở **mọi** procedure ([machineApiRouters.ts:176-191](../../server/routers/machineApiRouters.ts#L176-L191)), nhưng mọi doc chỉ dạy nhét key vào **body** (đường đã DEPRECATED). Client theo doc sẽ **401 đồng loạt** khi bật `MACHINE_SHARED_KEY_ALLOWED=false`, và lộ key trong body/log.
3. **`submitInspection` enum `OK|NG|NTF`** ✔ (không phải chỉ `OK|NG`) — [machineApiRouters.ts:126,153](../../server/routers/machineApiRouters.ts#L126). Client validate enum theo doc sẽ **reject `NTF` hợp lệ**. Đồng thời thiếu **11 field metrology 3D** (`valueZ/Height/Area/Volume/VoidPct/Coplanarity/Warpage/OffsetX/OffsetY/Tilt/Thickness`) + `panelId/boardIndex` + `defectCatalogCode/defectSeverity` ✔ → máy SPI/AXI/3D **mất toàn bộ dữ liệu 3D/SPC**.
4. **Cổng B.6 âm thầm STRIP limit** ✔ — `syncMeasurementPoints` khi `gate.decision="requires_approval" && enforced` sẽ `delete lowerLimit/upperLimit/nominalValue` rồi vẫn trả `success` ([machineApiRouters.ts:1252-1257](../../server/routers/machineApiRouters.ts#L1252-L1257)). Integrator push LSL/USL/nominal, nhận OK nhưng **limit KHÔNG lưu** → ngưỡng máy vs server phân kỳ. Chỉ báo qua field `limitBlocked` mà doc không nhắc.
5. **Geometry payload đúng-theo-doc bị zod REJECT** ✔ — `shape` code là `'rect'` không phải `'rectangle'`; circle `{x,y,radius}` không phải `{cx,cy,r}`; polygon `points:[{x,y}]` không phải tuple; mask/array schema hoàn toàn khác ([measurementGeometry.ts:11-96](../../server/lib/measurementGeometry.ts#L11-L96)). Điểm đo hình học nâng cao **không sync được**.
6. **`deltaSyncPoints` (kênh sync chính) trả ~30 field/point** (limit 3D + `lighting[]` multi-shot + `fiducials[]` + `coordinateMode` + shape/geometry/cells) nhưng doc chỉ liệt kê ~8 → integrator không parse được cấu hình đo 3D/chiếu sáng/căn chỉnh.
7. **Rate-limit sai-cứng** ✔ — doc ghi `1000 req/15 phút`; thực tế **`300 req/60s`** ([rateLimitConfig.ts:49](../../server/_core/rateLimitConfig.ts#L49)) + ingest per-key 600/min + OT tier. Sizing batch/backoff theo doc → 429 bất ngờ.
8. **`EXAMPLES.md` (lớp tRPC) FAIL validation ngay** — thiếu field bắt buộc mới (`serialNumber`/`overallResult`/`measurements[].result`), dùng tên field cũ (`productCode`/`lotNumber`/`numericValue`), đọc `result['overallResult']` không tồn tại (code trả `{success,inspectionId}`).
9. **Contract `/api/v1/*` không được `EXTERNAL_INSPECTION_API.md` nhắc** — envelope `{ok,data,error}` khác `{success,message}`, auth theo scope, có `/openapi.json` riêng → integrator tưởng `/api/external` là toàn bộ API, parse sai envelope.

### 9.4 — Tính năng backend MỚI chưa có tài liệu (bạn vừa thêm)

- **Edge Model Deploy / OTA** (5 procedure, scope `edge:sync`).
- **Vòng đời khoá máy per-machine** — `listKeys/issueKey/rotateKey/revokeKey` (:950-987) + hệ khoá `mk_` băm SHA-256 + scope vocabulary (`ingest:write`/`equipment:read`/`edge:sync`) + transport qua header.
- **Metrology 3D + panel multi-up + defect catalog** trên `submitInspection`.
- **MLOps stage pipeline** — `aiModel.listStages/promoteStage` (staging→shadow→canary→production→retired, gate 2-người-ký) + enum format `GGUF`.
- **External analytics/SPC/OEE tier (~40 route)** — alerts/reports/bulletins/dashboard/federation feeds/stations analytics.
- **Contract REST versioned `/api/v1/*`** (equipment/ingest/orchestration/edge/state/timeseries/events/metrics/genealogy/policy/lines/orders/oauth) + `/api/v1/openapi.json`.
- **Store-forward response** `{queued:true, submissionId, inspectionId:null}` + `/api/ot/ingest` 503 retry-able.
- **`syncPointImage` dedup theo `imageHash`** + endpoint stream ảnh binary + **fiducialMark CRUD** (searchWindow default **80px** không phải 64).

### 9.5 — Kế hoạch sửa tài liệu (thêm hạng mục **P1-DOC** vào lộ trình §7)

> Đây là **nợ tài liệu**, tách khỏi nợ code P0-P3. Nên làm **song song** — nhiều mục chỉ là viết lại tài liệu theo zod hiện có (rẻ, nhanh, gỡ rủi ro tích hợp bên thứ 3 ngay).

**P1-DOC (ưu tiên cao — integrator đang tích hợp hỏng):**
- [ ] Sửa CỨNG 2 facts sai: rate-limit `300/60s` (+ tier ingest 600/min, OT), 3 loại error envelope + mã 503. → `ERROR_CODES.md` + `README.md`
- [ ] **Viết lại hoàn toàn** `measurement-geometry-and-fiducials.md` + `SYNPOINT_SAMPLE.json` theo zod thực (`rect`, `{x,y,radius}`, mask/array schema…).
- [ ] Đại tu `AUTHENTICATION.md`: hệ khoá `mk_` hashed + header Bearer/X-API-Key + scope + issue/rotate/revoke; **đánh dấu rõ apiKey/machineCode body là DEPRECATED**.
- [ ] Thêm mục **Edge Model Deploy** (5 procedure OTA) vào `MACHINE_API.md` (+ tham chiếu `AI_MODEL_API.md`).
- [ ] Cập nhật `submitInspection` (enum `NTF`, 11 field metrology 3D, panel, defect catalog, response `{queued}`, hành vi spec-gate downgrade) + output đầy đủ `deltaSyncPoints` + cảnh báo cổng B.6.
- [ ] Viết lại `EXAMPLES.md` lớp tRPC theo tên field hiện tại.

**P2-DOC:** mở rộng §9 External (~40 route thật) + đính chính auth `?masterKey=` deprecated; thêm contract `/api/v1/*` (envelope/scope/openapi.json); thêm MLOps stage vào `AI_MODEL_API.md`.
**P3-DOC:** sửa Android guides (control-chart cần `stationId` không `pointDefId`; thống nhất base URL 3000 vs 3001).

> **Khuyến nghị chốt:** đưa `/api/machine` + external vào **OpenAPI sinh-từ-code** (như `/api/v1` đã có) + **contract test** để tài liệu không drift lại. Trùng với hạng mục *"Version hoá `/api/machine` + OpenAPI"* ở **P2 §7**.

---

## 10. TRẠNG THÁI THỰC THI — P0  ✅ **CODE XONG, ĐÃ KIỂM CHỨNG THẬT** (chưa commit)

> Thực thi bởi 4 agent (vùng file rời nhau) + điều phối viên vá lỗ REST & verify độc lập. **Chưa commit** — chờ bạn review.

### 10.1 — Đã làm & bằng chứng kiểm chứng ĐỘC LẬP (không tin self-report của agent)

| Hạng mục P0 | Trạng thái | Bằng chứng KIỂM CHỨNG THẬT |
|---|:--:|---|
| **Idempotency LIVE** (R2) | ✅ | Migration `0272` **đã áp DB dev** → index `uq_inspections_machine_serial_time` **tồn tại**. **Proof trên DB thật:** cùng natural key → insert#1 `id 85974`, insert#2 (retry) → **0 row = BỊ CHẶN**, tổng **1 row**. |
| **Chặn side-effect khi trùng** | ✅ | Tôi tự đọc diff: short-circuit đặt **ngay sau insert header, TRƯỚC** ERP outbox / production-order qty / measurements / NG alert. Trả `inspectionId` gốc + `duplicate:true`, vẫn giữ `markSubmissionApplied` + WAL. |
| **Siết `serialNumber`** | ✅ | `z.string().trim().min(1).max(100)`. Phòng thủ 2 lớp (zod chặn rỗng; partial index miễn serial rỗng cho dữ liệu cũ). |
| **Bịt rò apiKey** (R1) | ✅ | `config` trả `apiKey:null` + `requiresClaim`. Claim token 256-bit `mct_`, SHA-256 hash-at-rest, TTL 15', **dùng-một-lần**, burn+read cùng transaction (2 claim đồng thời → 1 thắng). Audit mọi lần claim (chỉ ghi prefix). Migration `0273` **đã áp** → bảng `machine_claim_tokens` tồn tại. |
| **Retire → revoke key** | ✅ | `retired`/`decommissioned` → revoke `api_keys` (isActive+revokedAt) + clear `machines.apiKey` + đốt claim token, **cùng transaction**. |
| **MQTT topic ACL** (R3) | ✅ | `authorizePublish`/`authorizeSubscribe`, xử lý cả `avi/`↔`synapse/`. Cờ `MQTT_TOPIC_ACL_ENABLED` **default TRUE** (secure-by-default) + `MQTT_TOPIC_ACL_WARN_ONLY` để rollout. |
| **Cờ weak-auth + telemetry** (QĐ#1) | ✅ | Tri-state policy + **telemetry đếm máy nào còn dùng đường yếu** (điều kiện tiên quyết để flip cờ an toàn) + `scripts/machine-key-rotation-report.mjs` + **runbook doc 52**. |
| **Store-forward** (QĐ#6) | ✅ | `.env` thực **đã có** `INSPECTION_STORE_FORWARD_ENABLED=true`. `.env.example` + runbook §6 ghi rõ bắt buộc go-live + smoke-test replay. |
| **Lỗ REST proxy** *(điều phối viên vá)* | ✅ | Agent phát hiện `GET /api/machine/config` có nhưng **thiếu** `claimKey` proxy → máy REST mất đường lấy key. Tôi thêm `POST /api/machine/claim` + map mã lỗi thật (400/404/429/500). |

**Verify tổng:** `tsc --noEmit` toàn repo = **0 lỗi** · **12/12 file test xanh, 196 pass / 7 skip** (gồm hồi quy `machineApiDurability` WAL, `machineLifecycle`, `machineCodeConflict`, `machineSyncGate`, `mqtt`, `inspection.corporate`) · test DB đã dựng lại (`aoi_management_test`).

### 10.2 — ⚠️ RỦI RO & VIỆC CÒN LẠI (phải xử lý trước go-live)

| # | Vấn đề | Mức | Hành động |
|:--:|---|:--:|---|
| 1 | **MQTT ACL sẽ CƯỠNG CHẾ ngay khi restart** — `.env` chưa đặt cờ → dùng default `WARN_ONLY=false`. Trái tinh thần QĐ#1, có thể **làm chết tablet FactoryAlertSystem**. | 🔴 | **Đặt `MQTT_TOPIC_ACL_WARN_ONLY=true` vào `.env`** → quan sát log ≥1 tuần tới khi sạch → mới siết. *(Tôi không tự sửa `.env` của bạn.)* |
| 2 | **Migration prod phải chạy bằng role `aoi` (owner)** — `DATABASE_URL` trong `.env` là `avi_app` (dòng cuối thắng) → migrate sẽ ghi `'partial'` và **KHÔNG tạo index** ⇒ chống-trùng **inert**. | 🔴 | Chạy `0272` bằng role owner ở prod (tôi đã làm vậy cho dev). |
| 3 | **`CREATE UNIQUE INDEX` giữ lock SHARE → chặn ghi** trên bảng nóng nhất; không dùng `CONCURRENTLY` được (khối `DO` + hypertable). Chunk **nén** (0271) có thể fail. | 🟠 | Chạy **off-peak**. Nếu fail → guard ghi `'partial'`, app **thoái lui về hành vi cũ, không hồi quy** (nhưng cũng không được bảo vệ) → decompress rồi re-apply. |
| 4 | **Duplicate tồn sẵn ở prod** — migration **cố ý KHÔNG tự xoá** (có `measurement_results` FK CASCADE + ý nghĩa audit). Dev = 0 dup. | 🟠 | Migration đếm + in sẵn SQL soi/dọn → **ops quyết định** trước khi index tạo được. |
| 5 | **Lỗ `inspectionTime` còn lại** — máy **không gửi** `inspectionTime` → server stamp `now()` mỗi lần ⇒ retry có key khác ⇒ **index KHÔNG bắt**. Chỉ bịt được máy CÓ gửi (phổ biến). | 🟠 | → **P1 `idempotencyKey`** (đã có trong lộ trình). Không đổi hợp đồng máy ở P0. |
| 6 | **Đánh đổi mới:** submit#1 ghi header rồi **crash trước khi ghi measurement** → retry short-circuit ⇒ header **không có measurement** (trước đây tạo row thứ 2 = đếm trùng, *tệ hơn*). | 🟡 | → P1: thêm **cờ hoàn tất (completion flag)** cho inspection. |
| 7 | `db:push` giờ sẽ cố tạo unique index (schema đã khai) → **fail nếu prod còn duplicate**. Đường chuẩn vẫn là `0272` (có guard). | 🟡 | Dùng `0272`, không dùng `db:push` ở prod. |
| 8 | `machineClaimTokens` pgTable khai trong `server/db/hierarchy.ts` thay vì `drizzle/schema/` (thư mục ngoài vùng agent). An toàn hiện tại vì migrate chạy SQL thuần. | 🟡 | Dọn: chuyển về `drizzle/schema/hierarchy.ts`. |

### 10.3 — Chưa làm (thuộc P1, không thuộc P0)
Version pinning + gate-by-snapshot (QĐ#2) · clock-skew · image atomicity · rate-limit NAT · bump-version mọi mutation · **benchmark 100 máy × 1/s (QĐ#7)**.

---

## 11. TRẠNG THÁI THỰC THI — P1 + P1-DOC  ✅ **CODE XONG, ĐÃ KIỂM CHỨNG THẬT** (chưa commit)

> 6 agent (2 phase tuần tự cho `machineApiRouters.ts` + 3 song song file-rời + 1 doc) + điều phối viên tự verify độc lập & sửa 9 test regression. **Chưa commit.**

### 11.1 — Đã làm & bằng chứng ĐỘC LẬP

| Hạng mục P1 | Trạng thái | Bằng chứng KIỂM CHỨNG THẬT |
|---|:--:|---|
| **R4 — bug lan-toả version** | ✅ | Helper `bumpPointsConfigVersion` **1 câu SQL atomic** (`+1 RETURNING`, hết race read-modify-write) wire vào **7 đường** mutation điểm đo + CAD. Mutation-test: RMW thay atomic → version tới **3 thay vì 21** (mất 18 bump). |
| **Tombstone** (CASE #4) | ✅ | Cột `deletedAtVersion` (mig 0274) → `deltaSyncPoints` trả thêm `deletedCodes`/`deletedPoints` (additive). Xử lý đúng ca "xoá rồi tạo lại" (không để máy xoá nhầm điểm vừa cài). |
| **Atomic upsert điểm đo** | ✅ | Partial unique `(productModelId,code) WHERE deletedAt IS NULL` (mig 0274) + `ON CONFLICT DO NOTHING`. `create` giờ idempotent → trả `{id,duplicate}`. |
| **idempotencyKey** (bịt lỗ P0) | ✅ | ⚠️ Agent **override kế hoạch đúng đắn**: partial-unique trên hypertable Timescale **BẤT KHẢ THI** (buộc chứa cột phân mảnh `inspectionTime`) → dùng **ledger riêng** `inspection_idempotency_keys` (mig 0275). **Proof live: 3 request đồng thời cùng key → 1 winner, 1 row, `duplicate:true`.** |
| **Clock-skew** (CASE #3) | ✅ | Cột `serverReceivedAt` + `timeSkewSeconds` + `clockSkewFlagged` + `timeSource` (mig 0275). Naive timestamp → nhận + gắn cờ (cờ `INGEST_REQUIRE_TIME_OFFSET` default OFF). Skew > ngưỡng → alert (cooldown 15'/máy). |
| **Version pinning** (CASE #12) | ✅ | Cột `pointsConfigVersion` — máy khai version đang dùng, server stamp verbatim; tag `stale_config` khi < current. |
| **QĐ#2 gate-by-snapshot** | 🟡 | ⚠️ Agent **override có giải thích**: `measurement_point_versions` chỉ có version **per-point**, KHÔNG map tới `pointsConfigVersion` sản phẩm → chấm theo **instant `serverReceivedAt`** (không version-exact), sau cờ `SPEC_GATE_SNAPSHOT_ENABLED` (default OFF), **skip-khi-thiếu-snapshot** (thà không gate còn hơn gate sai). `gateConfigVersion` (mig 0276) ghi vết. **Đóng được ca nguy hiểm nhất** (limit siết SAU khi đo → retro-fail board tốt). |
| **Image atomicity** (CASE #5) | 🟡 | ✅ **Compensation** (tx measurement fail → `storageDelete` mọi ảnh mồ côi — đã đọc code xác nhận [machineApiRouters.ts:1196-1229](../../server/routers/machineApiRouters.ts#L1196-L1229)) + ✅ **không nuốt lỗi** (`[IMG_UPLOAD_FAILED]` sentinel) + ✅ **`.max()` 20MB/ảnh**. ❌ **(a) gộp header+measurement 1 tx CHƯA làm** (xem 11.2). |
| **Rate-limit NAT** (R6) | ✅ | keyGenerator theo **credential (hash SHA-256)** thay vì IP (đọc cả header/body/query/machineCode) → 2 máy cùng IP = 2 bucket. **Tier ingest riêng** + `429 Retry-After`. Body-parser xác nhận mount TRƯỚC limiter. 16 test. |
| **Benchmark** (QĐ#7) | ✅ | Harness `scripts/bench/` chạy được (`--help` đầy đủ, lib testable): mô phỏng N máy, đo p50/p95/p99 + lỗi theo mã + đếm row THỰC vào DB (dò mất dữ liệu) + dò idempotency (`--dup-pct`) + kịch bản NAT (`--auth=body`). Doc **53**. |
| **P1-DOC** | ✅ | 8 file `apidocs/` viết lại theo trạng thái CUỐI P0+P1: geometry đúng zod (`rect`), auth mk_+header+claim-token, 9 procedure thiếu, submitInspection (NTF/metrology/idempotencyKey/pointsConfigVersion), cổng B.6, deltaSync deletedCodes, rate-limit đúng. |
| **9 test regression** *(điều phối viên sửa)* | ✅ | Mock `../db` thiếu `bumpPointsConfigVersion` + đổi shape return `create`/`delete`. Tôi sửa 3 file test + cập nhật assertion theo hợp đồng mới. |

**Verify tổng:** `tsc --noEmit` toàn repo (heap 8GB) = **0 lỗi** · **sweep 23 file test = 311 pass / 7 skip** (gồm toàn bộ P0 + P1 + hồi quy lifecycle/mqtt/syncGate/pointSpecGate) · mig **0272-0276 áp dev + test DB** (role `aoi`).

### 11.2 — ⚠️ RESIDUAL & VIỆC CÒN LẠI (trung thực, không tô hồng)

| # | Vấn đề | Mức | Kế hoạch |
|:--:|---|:--:|---|
| 1 | **Image atomicity (a) chưa làm** — header inspection vẫn commit RỜI khỏi tx measurement (`createProductInspection` thuộc ledger P0, agent không được đụng). Residual: submit#1 ghi header rồi measurement-tx fail → retry short-circuit ⇒ **header rỗng tồn tại**. | 🟠 | **P2**: luồn measurement vào tx của `createProductInspection` (header+measurement+overall atomic). |
| 2 | **QĐ#2 chưa version-exact** — chấm theo instant, không theo version máy khai. Máy trễ nhiều edit mà edit xảy ra TRƯỚC instant board → reconstruction "missing" → skip (an toàn nhưng không re-grade). | 🟠 | **P2**: ghi `pointsConfigVersion` sản phẩm lên mỗi row `measurement_point_versions` → chấm theo version thật. |
| 3 | **Lỗ idempotency cuối** — máy KHÔNG gửi CẢ `idempotencyKey` LẪN `inspectionTime` → vẫn ghi 2 row (2 HTTP request độc lập, server không có danh tính chung). Agent viết hẳn test khẳng định giới hạn này. | 🟠 | Hợp đồng: **khuyến nghị mạnh** máy gửi `idempotencyKey` (đã vào P1-DOC). |
| 4 | **"fake-UTC shift" giữ nguyên** — bug tiềm ẩn: server chạy UTC+7, ingest lưu giờ tường HN, read-layer giả định UTC → sẽ lệch +7h/sai ca **ngay khi máy thật đẩy dữ liệu**. Dev chưa nổ (0 row ingest thật). Không dám sửa vì đổi ý nghĩa dữ liệu lịch sử. | 🔴 | **P2 cutover có kiểm soát**: dùng `serverReceivedAt`/`timeSource` (0275) đếm row mang shift ở prod → migration viết lại + set `FACTORY_DB_STORAGE_TZ` nguyên tử. |
| 5 | **Các đường ghi điểm khác chưa bump** (cùng bug R4, ngoài vùng agent): `statusTemplateRouters.ts:334`, `dataRouters.ts:310`, `aiLocalTools/.../measurementPoint.ts:123`; race version-bump còn ở `machineApiRouters.ts:1375` + `centroidImportService.ts:482`. | 🟠 | **P2**: wire nốt qua `bumpPointsConfigVersion` atomic. |
| 6 | **Ledger `inspection_idempotency_keys` chưa có retention** (mọc ~1 row/submission có key). Owner `dataRetentionService` ngoài vùng. | 🟡 | **P2**: thêm job cắt tỉa. |
| 7 | **Chưa CHẶN hồi sinh điểm tombstoned trong resolver** (doc §240) — `measurementPointResolver` ngoài vùng. | 🟡 | **P2**. |
| 8 | **`.env` cần cờ ACL** (từ P0) + benchmark 100 máy **CHƯA CHẠY THẬT** (cần server live) — harness sẵn sàng, chưa có số. | 🔴 | Chạy `npm run bench:ingest -- --machines=100 --rate=1 --image-kb=200` khi server chạy, TRƯỚC khi cam kết SLA (QĐ#7). |

### 11.3 — Migration mới (P0+P1): `0272`–`0276` (đã áp dev + test DB, guarded)
`0272` idempotency index · `0273` claim token · `0274` measurement-point integrity + tombstone · `0275` inspection provenance (skew/version/idempotency-ledger) · `0276` gate config version. **Prod phải chạy bằng role owner `aoi`, off-peak** (§10.2).

---

## 12. Bước tiếp theo

Sau khi bạn review & duyệt (đặc biệt **§8 các quyết định**), tôi sẽ gọi các **AI Agent chuyên môn** thực thi theo đúng thứ tự **P0 → P1 → P2 → P3**, mỗi đợt kèm migration + test tích hợp + verify LIVE, commit xanh theo convention hiện có.

> **Ghi chú:** Báo cáo này audit **luồng máy AVI/AOI**, bổ sung — không thay thế — doc 48 (đánh giá tổng thể SYNAPSE). Nhiều rủi ro ở đây (weak-auth, WAL cờ-OFF, audit chưa WORM, scale dry-run) **giao thoa** với doc 48; nên đồng bộ khi lập lịch thực thi.
