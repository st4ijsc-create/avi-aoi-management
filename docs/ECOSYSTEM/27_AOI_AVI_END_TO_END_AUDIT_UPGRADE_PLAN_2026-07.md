# Doc 27 — Audit toàn trình AOI/AVI & Kế hoạch nâng cấp lên mức chuyên nghiệp hoàn chỉnh

**Ngày:** 2026-07-04 · **Phương pháp:** 10 agent audit song song (read-only, 2 vòng: 7 lớp nghiệp vụ + 3 lớp AI vision), mỗi agent một mảng, mọi phát hiện đều có bằng chứng `file:line`
**Phạm vi:** Master data → luồng tạo máy → kết nối máy thật → realtime/trao đổi dữ liệu → frontend nghiệp vụ → báo cáo/dashboard/KPI → Mobile (FactoryAlertSystem) → backend & database (hiệu suất + trải nghiệm) → **AI phân tích hình ảnh trực tiếp từ máy + chức năng nâng cao AOI/AVI**
**Trạng thái:** ✅ **HOÀN THÀNH 7/7 ĐỢT KẾ HOẠCH + ĐỢT 8 MỞ RỘNG + 2 HẠNG MỤC DỮ LIỆU** (2026-07-04) — nghiệm thu cuối: server tsc 0 + **389 file/4.242 test/0 fail**, app mobile 102 test/tsc 0, **20 migration (0172–0192) applied**, 15/15 FK VALIDATED/0 vi phạm, UNCOMMITTED chờ review. Chi tiết trong các khối "KẾT QUẢ THỰC THI"; việc còn chờ người ở §13.

---

## 0. Tóm tắt điều hành

Hệ thống có **nền tảng rộng và nhiều mảng thực sự tốt** (recipe workflow chuẩn SoD, driver fieldbus production-grade, defect-verify UX xuất sắc, dashboard tùy biến, outbox ERP best-in-class, OTA mobile hoàn chỉnh, RCA Copilot + Threshold Advisor thật). Nhưng để một máy AOI/AVI **thật** chạy sản xuất ổn định lâu dài trên hệ thống này thì đang vướng **11 điểm chặn P0** tập trung vào 4 cụm: (1) **nền dữ liệu không bền vững** — bảng kết quả inspection lõi không partition/không retention, ảnh lỗi không bao giờ dọn; (2) **đường kết nối máy thật chưa đủ** — thiếu file-drop ingestion (cách xuất kết quả phổ biến nhất của máy AOI thương mại), schema vendor chưa kiểm chứng, ingest không có store-forward; (3) **độ đúng của số liệu** — 3 định nghĩa yield khác nhau, FPY sai bản chất, timezone bucket sai, heatmap lỗi là giả lập; (4) **AI vision chưa khép vòng** — không có AI nào chạy tự động khi máy đẩy kết quả, correction của operator không được thu hoạch làm training data, và không có dự đoán NTF/false-call (giá trị AI số 1 cho AVI).

| # | Lớp | Điểm trưởng thành | Nhận định ngắn |
|---|-----|:---:|---|
| 1 | Master data & vòng đời máy | **5.8/10** | Rộng, giàu (defect catalog IPC-A-610, MSA, recipe SoD) nhưng toàn vẹn dữ liệu yếu (gần như không FK), thiếu audit trail |
| 2 | Kết nối máy thật | **5.0/10** | Fieldbus REAL; nhưng đường AOI/AVI ingest push-only, vendor adapter placeholder, không có hot-folder |
| 3 | Realtime & pipeline dữ liệu | **5.3/10** | Socket.IO + outbox tốt; bảng lõi không partition, ảnh không lifecycle, ingest tuần tự nghẽn |
| 4 | Frontend nghiệp vụ AOI/AVI | **7.4/10** | Mảng mạnh nhất; còn nút giả "Bulk Acknowledge", thiếu vòng lặp repair, thiếu Andon TV |
| 5 | Báo cáo / Dashboard / KPI | **5.8/10** | Dashboard 8/10; KPI đúng-sai lẫn lộn (yield/FPY/DPMO/heatmap), timezone P0, export/BI nghèo |
| 6 | Mobile (FactoryAlertSystem) | **5.5/10** | App chính không nằm trong git (P0), foreground service không được gọi, IP hardcode |
| 7 | Backend & DB performance | **6.0/10** | Index tốt, pagination có; monitor chết, retention tắt, N+1, 1 process gánh ~30 scheduler |
| 8 | AI vision & chức năng nâng cao | **4.8/10** | Thuật toán thật + test tốt nhưng "mồ côi" — không nối vào production; advisor/RCA/chat tốt (8/10); vòng lặp học đứt |
| | **Tổng thể** | **≈5.7/10** | Nền rộng, chưa "đóng đinh" được độ bền dữ liệu + độ đúng số liệu + đường máy thật + vòng lặp AI |

**Tổng số phát hiện: 111** — trong đó **11 P0 · 33 P1 · 43 P2 · 24 P3** (danh mục đầy đủ ở §2–§9, kế hoạch xử lý ở §11).

### 11 điểm chặn P0

| ID | Vấn đề | Bằng chứng |
|----|--------|-----------|
| R1 | `product_inspections` + `measurement_results` không partition, không retention → tăng trưởng vô hạn (~500k dòng/ngày ở 10k board × 50 điểm đo) | `drizzle/schema/inspection.ts:5-124`, `dataRetentionService.ts:43-51` |
| R2 | Migration 0118 hypertable là **no-op im lặng** trên DB chính (image pgvector không có TimescaleDB) → 4 bảng telemetry vẫn là bảng thường | `drizzle/0118_timescale_hypertables.sql:22-26`, `0133:5-11` |
| C1 | **Không có file-drop/hot-folder ingestion** — chế độ xuất kết quả chủ đạo của Koh Young/Saki/Omron/Mirtec... (CSV/XML ra thư mục) | grep `chokidar|fs.watch` → chỉ `license/runtime-security.ts` |
| C2 | Schema 5 vendor adapter là **giả định**, chưa đối chiếu file xuất thật của máy nào | `server/services/vision/adapters/kohYoung.ts:5-8` |
| C3 | Ingest kết quả inspection **không có store-forward** — DB sập là mất kết quả + ảnh; WAL hiện chỉ phủ `ot_telemetry` và đang OFF | `machineApiRouters.ts:175`, `ot/storeForward.ts:39` |
| A1 | Cron báo cáo định kỳ **không truyền timezone** — đã từng gây sự cố prod (tồn tại `fix-timezone.sql` vá +7h thủ công) | `reportScheduler.ts:322-324`, `scheduledReportService.ts:234` |
| A2 | Mọi rollup ngày/giờ bucket theo UTC, không theo Asia/Ho_Chi_Minh → biểu đồ ngày lệch nửa ca | `statistics.ts:401,446,1346`, MV `0111:31` |
| MB1 | **FactoryAlertSystem (app production, ~30k LoC) bị gitignore hoàn toàn** — không version control, chỉ commit APK | `.gitignore:112`, `git ls-files` = 0 |
| V1 | **Không có AI inline khi ingest** — engine verdict (quality gate/DL head/anomaly) là thật nhưng chỉ được gọi on-demand từ UI; máy đẩy kết quả thì AI đứng ngoài | `machineApiRouters.ts:82-534`, `aiQualityGateRouter.ts:161` |
| V2 | **Vòng lặp học đứt** — correction OK/NG/NTF của operator chỉ ghi đè result + nhét lý do vào remark; không thành label/training data, không đo agreement | `inspectionRouters.ts:579-620` |
| V3 | **Không có dự đoán NTF/false-call** để pre-sort hàng đợi verify — điểm giảm tải operator lớn nhất của AI cho AVI | grep predictor = 0; `aiActiveLearning.ts` tách rời ingest |

### 7 chủ đề xuyên suốt (root-cause)

- **T1 — "Xây xong nhưng OFF":** store-forward, HA supervisor, retention, materialized-view refresh, vision adapters, live streams... đều có code tốt nhưng flag mặc định OFF và không ai bật → giá trị = 0 trong prod. Cần một "production profile" chuẩn hóa flag.
- **T2 — Tăng trưởng không giới hạn:** bảng lõi + bảng log + ảnh lỗi đều không có retention/partition/lifecycle → hệ thống sẽ chậm dần rồi đầy đĩa, không phải "nếu" mà là "khi nào".
- **T3 — Số liệu chưa đáng tin:** 3 định nghĩa yield, FPY không phải first-pass, DPMO thiếu opportunities, heatmap giả, timezone sai → hai màn hình cùng chỉ số ra hai con số khác nhau.
- **T4 — Toàn vẹn & truy vết yếu:** không FK trên master data, mutations không audit, unique lỏng, nút acknowledge giả → không đạt chuẩn truy xuất nguồn gốc điện tử.
- **T5 — Đường máy thật chưa khép kín:** có API, có adapter registry, có wizard OT — nhưng chưa có luồng trọn vẹn "chọn vendor → validate payload mẫu → cấp key → commissioning → ingest bền vững" cho AOI/AVI.
- **T6 — Vận hành 1 process:** ~30 scheduler + API + socket + AI trong một process, pool 10 kết nối, rate-limit in-memory → chưa sẵn sàng scale ngang.
- **T7 — "Trưởng thành mồ côi" (built-but-unwired):** biến thể nặng hơn của T1 ở lớp AI — sub-pixel registration (test <0.01px), golden-sample service, SPI 3D math, acquisition framework, AISuggestionsPanel... đều là code thật có test nhưng **0 caller trên đường production**; thêm nữa `models/` không chứa file weight nào nên runtime mặc định chạy chế độ degraded. Đầu tư đã bỏ ra, giá trị chưa thu về.

---

## 1. Phương pháp & phạm vi bằng chứng

10 agent Explore độc lập (vòng 1: 7 lớp nghiệp vụ; vòng 2: 3 mảng AI vision — pipeline inference, thuật toán nâng cao, AI hỗ trợ operator), mỗi agent quét một mảng với yêu cầu "chỉ báo cáo có bằng chứng `file:line`, phân loại REAL / FRAMEWORK / STUB". Con số nền: **276 bảng / 958 index** (48 file schema), **190 migration** (journal đến 0171), **171 router / ~1.717 procedure**, **166 trang frontend**, **307 file test** (4 skip), 3 app mobile.

Quy ước ID phát hiện: `M#` master data · `C#` connectivity · `R#` realtime/pipeline · `F#` frontend · `A#` analytics/báo cáo · `MB#` mobile · `B#` backend/DB · `V#` AI vision.

---

## 2. Lớp 1 — Master data & vòng đời máy (5.8/10)

### Hiện trạng
- **Cây phân cấp đầy đủ:** `corporates → factories → workshops → productionLines → stations → machines` (`drizzle/schema/hierarchy.ts:33-200`), 17 loại máy khóa thứ tự có test (`enums.ts:14`, `machineTypeEnum.f2.test.ts`).
- **Luồng tạo máy 2 đường:** admin create (`hierarchyRouters.ts:564`) và máy tự đăng ký chờ duyệt (`register` public, `:416`) + approve/reject/revoke (`server/db/hierarchy.ts:207-338`), soft-delete cascade + restore (`:615-756`).
- **Recipe là mảng tốt nhất:** unique `code+version`, SoD người tạo ≠ người duyệt (`db/machineRecipe.ts:152`), deploy atomic `FOR UPDATE` chặn recipe chưa duyệt (`:266`), rollback (`:287`), genealogy audit đầy đủ.
- **Master đo lường giàu:** `measurementPointDefs` (3D/GD&T/tolerance-v2), lighting profiles, `defectCatalog` chuẩn IPC-A-610 (`product.ts:316`), instrument calibration + MSA (ISO 17025/IATF), sampling plans, BOM/feeder (`mes.ts:338-425`).

### Thiếu sót

| ID | Mức | Vấn đề | Bằng chứng | Hướng xử lý |
|----|:---:|--------|-----------|-------------|
| M1 | P1 | Gần như **không có FK** toàn domain master data (chỉ 9 `.references()` ở license/system/spc/federation); `machines.stationId`, `measurementResults.pointDefId`… đều là soft-ref → nguy cơ orphan | `hierarchy.ts:153`, `inspection.ts:79` | Thêm FK + ON DELETE rõ ràng theo lô; kèm job kiểm orphan định kỳ trong giai đoạn chuyển tiếp |
| M2 | P1 | Máy **không có lifecycle state** tài sản (commissioned/active/maintenance/decommissioned/retired) — chỉ có runtime status + isActive | `enums.ts:36,46`, `hierarchy.ts:173` | Thêm `lifecycleStatus` + máy trạng thái chuyển đổi hợp lệ |
| M3 | P1 | Soft-delete xung đột unique code toàn cục: xóa máy vẫn giữ code vĩnh viễn, đăng ký lại lỗi 500 thô | `hierarchy.ts:154`, `db/hierarchy.ts:289` | Partial unique index `WHERE is_active` hoặc tombstone code |
| M4 | P1 | `register` public **hardcode `stationId: 1`**, không kiểm tồn tại, không rate-limit → orphan/DoS hàng pending | `hierarchyRouters.ts:454,416` | Resolve default station thật + throttle + validate |
| M5 | P1 | **Mutations master data không ghi audit** (0 audit call trong `hierarchyRouters.ts`) — recipe có audit, tài sản lõi thì không | `hierarchyRouters.ts` (grep=0), `system.ts:6` | Bọc mutation bằng `recordAuditEvent` (before/after snapshot) |
| M6 | P2 | Code workshop/line/station **không unique**; `productMachineMappings` không unique cặp → join theo code mơ hồ, mapping trùng | `hierarchy.ts:99,121,142`, `product.ts:635` | `uniqueIndex (parentId, code)` + unique cặp mapping |
| M7 | P2 | Tạo máy không pre-check trùng code → 500 thô thay vì CONFLICT | `hierarchyRouters.ts:564`, `db/hierarchy.ts:207` | Pre-check `getMachineByCode` → TRPCError CONFLICT |
| M8 | P2 | Commissioning governance chỉ **cảnh báo chuỗi**, không chặn, không persist device-type link | `hierarchyRouters.ts:22,579` | Persist link `machines → deviceTypes` + enforce khi `EQ_GOVERN_ENABLED` |
| M9 | P2 | Bộ điểm đo (inspection program) **không có approval/release workflow** — chỉ threshold có duyệt, program tổng thì không | `product.ts:219,30,878` | Workflow draft→approved→released mirror theo `machineRecipe` |
| M10 | P2 | Bất biến "1 golden active" chỉ ở tầng app → concurrent có thể tạo 2 golden active | `goldenSample.ts:33,52` | Partial unique index `WHERE active` |
| M11 | P2 | Defect code là soft-ref/free-text → xóa/đổi catalog làm gãy Pareto + truy vết | `inspection.ts:103`, `mes.ts:182` | FK về `defectCatalog` + validate khi ghi |
| M12 | P3 | Chưa có **component library** (package/footprint/polarity) và **panel/board multi-up** (Nup, offset từng board) — thiết yếu cho AOI mức linh kiện | `masterdata.ts:90`, `mes.ts:367`, `product.ts:8` | Thêm 2 nhóm bảng master mới |
| M13 | P3 | `machines.capabilities` là jsonb tự do, không validate theo device type | `hierarchy.ts:180,10` | Validate theo descriptor `deviceTypes` |
| M14 | P3 | Operator identity lệch kiểu (varchar vs integer), không có operator/badge master | `inspection.ts:15`, `safetyWorkforce.ts:69` | Chuẩn hóa về users.id + bảng badge |

---

## 3. Lớp 2 — Kết nối máy thật (5.0/10)

### Hiện trạng (phân loại REAL / FRAMEWORK / STUB)
- **REAL:** driver Modbus TCP, OPC-UA (kèm monitored-item push + browse), Siemens S7, Mitsubishi MC, EtherNet/IP (`ot/drivers/*`, deps thật trong package.json); MTConnect client; MQTT/Sparkplug; đường ingest chính `machineApi.submitInspection` (apiKey + base64 ảnh + heartbeat, `machineApiRouters.ts:82-157`); ConnectionSupervisor (backoff + dual-endpoint failover, `ot/connectionSupervisor.ts:154-505`); store-forward WAL (`ot/storeForward.ts`); commissioning FAT ledger chặn control write (`ot/commissioningService.ts:43-141`); wizard OT 6 bước + wizard máy 5 bước.
- **FRAMEWORK:** 5 vision adapter (generic-json, koh-young, cognex, keyence, tri — `vision/index.ts:15-19`) với schema giả định; SECS/GEM (HSMS + E30 FSM nhưng thiếu S2F33/35/37, S5 alarm, S7 recipe, spooling — `secsgem/hsmsClient.ts:24-31`); FOCAS, Euromap 63/77/83.
- **STUB / VẮNG:** GenICam/GigE (throw đến khi bind GenTL); **SMEMA không có**; **hot-folder không có**.

### Thiếu sót

| ID | Mức | Vấn đề | Bằng chứng | Hướng xử lý |
|----|:---:|--------|-----------|-------------|
| C1 | **P0** | Không có file-drop/hot-folder ingestion CSV/XML — chế độ xuất chủ đạo của AOI thương mại | grep chokidar/fs.watch = 0 trên đường ingest | Service watch thư mục (chokidar) → parser vendor → `normalize()` → `submitInspection`; cấu hình folder+parser theo máy |
| C2 | **P0** | Schema vendor adapter là placeholder, không có golden-file test với file xuất thật | `adapters/kohYoung.ts:5-8` | Thu file mẫu thật theo model/series, golden-file conformance test, version schema theo firmware |
| C3 | **P0** | Ingest inspection không durability: DB sập → mất kết quả; WAL chỉ phủ ot_telemetry và OFF | `machineApiRouters.ts:175`, `storeForward.ts:39` | Mở rộng WAL/outbox sang đường inspection; bật mặc định ở prod |
| C4 | P1 | Không có wizard onboarding AOI (wizard hiện tại là OT-tag và reachability); `visionAdapter.ingest` không có UI, flag OFF | `DeviceOnboardingWizard.tsx`, `visionAdapterRouter.ts:32-84` | Wizard: chọn vendor → dry-run normalize payload mẫu → cấp/rotate key → commissioning sign-off |
| C5 | P1 | HA + store-forward mặc định OFF và chỉ OT-scoped | `connectionSupervisor.ts:12`, `storeForward.ts:39` | Bật trong production profile; thêm reconnect/buffer cho MQTT AOI bridge |
| C6 | P1 | Phủ vendor mỏng: thiếu Saki, Omron, Mirtec, CyberOptics, ViTrox, Parmi, Pemtron, Yamaha… | `vision/index.ts:15-19` | Ưu tiên theo install base nhà máy; mỗi vendor = 1 adapter + conformance test |
| C7 | P1 | Auth máy yếu: apiKey chung plaintext trên publicProcedure, không mTLS, không rotation, không rate-limit ingest | `machineApiRouters.ts:82,137-148` | Credential per-machine + scoped key + tùy chọn mTLS + rate-limit |
| C8 | P2 | Ảnh lỗi lưu local FS `./uploads`, không object store/CDN/retention | `machineApiRouters.ts:287-296,596` | Blob backend cắm được (S3/MinIO) + signed URL + retention |
| C9 | P2 | SECS/GEM, FOCAS, Euromap framework-only; SMEMA vắng → chưa đạt semiconductor-grade | `hsmsClient.ts:24-31`, `focasAdapter.ts:5-25` | Tích hợp lib SECS đã kiểm chứng hoặc sidecar; ghi rõ "roadmap" trong tài liệu |
| C10 | P3 | GenICam chưa bind — chỉ cần nếu tự xây vision | `genICamImageSource.ts:81-105` | Bind harvesters/aravis sidecar khi cần |

---

## 4. Lớp 3 — Realtime & pipeline dữ liệu (5.3/10)

### Hiện trạng (đường đi dữ liệu)
```
MÁY AOI/AVI
 ├─ Kết quả inspection ── HTTP tRPC submitInspection (KHÔNG qua MQTT)
 │    → 1 insert product_inspections → vòng lặp TUẦN TỰ từng điểm đo
 │      (upload ảnh base64 inline từng điểm) → 1 batched insert measurement_results
 │    → outbox ERP (fire&forget) → NG thì emit socket + MQTT retained + FCM
 ├─ Gói ZIP ảnh ── presign → /api/aoi/upload → storage (forge|local)
 └─ MQTT (Aedes in-process, TCP1883/WS8883/TLS8884)
      inbound chỉ xử lý DEVICE_INFO + CONFIGURE_ACK; mirror UNS/Sparkplug flag-OFF

SERVER: eventBus → Socket.IO rooms (factory/line/machine/twin) · TimescaleDB CHỈ ở
container phụ 5433 (energy, ot_telemetry) · outbox ERP poll 5s (backoff+breaker+DLQ,
flag OFF) · mqttAlertScheduler poll 5' → FCM · /v1 Unified API + OpenAPI + idempotency

FRONTEND: socketManager (alerts/dashboard) + 104 refetchInterval / 40 file (polling là chính)
```
**Điểm mạnh giữ lại:** outbox ERP (backoff + circuit-breaker + dead-letter + idempotency, `erpOutbox.ts:315-405`); NG alert MQTT `retain:true` cho client reconnect (`mqttService.ts:972-990`); `measurement_samples` (SPC) là bảng khối lượng lớn duy nhất đã partition tháng đúng chuẩn (`0092:56`).

### Thiếu sót

| ID | Mức | Vấn đề | Bằng chứng | Hướng xử lý |
|----|:---:|--------|-----------|-------------|
| R1 | **P0** | 2 bảng lõi không partition + không retention → thoái hóa insert/query theo thời gian | `inspection.ts:5-124`, `dataRetentionService.ts:43-51` | Native `PARTITION BY RANGE(inspectionTime)` theo tháng (pattern có sẵn ở 0092) + đưa vào retention/archive |
| R2 | **P0** | 0118 hypertable no-op trên DB chính; "Timescale+native partition" mới thực hiện một nửa | `0118:22-26`, `0133:5-11` | Partition native 4 bảng telemetry trên DB chính, hoặc bắt buộc TSDB_URL routing |
| R3 | P1 | Mọi retention policy native bị comment; app-level retention OFF → **hiện không có gì được prune** | `0118:40-76`, `0124:37`, `dataRetentionService.ts:9-19` | Chọn 1 cơ chế/bảng, bật lên, tôn trọng ghi chú "không double-delete" |
| R4 | P1 | Ingest tuần tự từng điểm + upload ảnh inline chặn request; không queue/backpressure | `machineApiRouters.ts:232-343` | Tách upload ảnh khỏi persist kết quả (presigned/async queue); nhận kết quả trước, ảnh sau |
| R5 | P1 | MQTT inbound không validate schema payload; Aedes buffer RAM không cap | `mqttService.ts:569,610` | Zod-validate + giới hạn payload size ở broker |
| R6 | P1 | Ảnh inspection **không bao giờ được dọn** — prune DB row (R1) sẽ orphan file | `storage.ts:79-100` | Job lifecycle ảnh theo tuổi inspection; xóa object cùng row |
| R7 | P2 | Không thumbnail/resize/CDN; body tRPC cho phép 200MB base64 | `inspection.ts:113-114`, `_core/index.ts:208` | Sinh thumbnail khi commit; multipart thay base64 |
| R8 | P2 | Cooldown notification in-memory → restart là bão alert lặp | `mqttAlertScheduler.ts:36` | Persist `lastNotifiedAt` vào bảng mqtt sẵn có |
| R9 | P2 | Outbox drain không `FOR UPDATE SKIP LOCKED` → double-POST nếu chạy 2 instance | `erpOutbox.ts:321-349` | SKIP LOCKED hoặc lease column trước khi scale ngang |
| R10 | P2 | Realtime chủ yếu là polling; các stream push có sẵn nhưng flag-OFF; OEE là poll-emit 60s | `socket.ts:883-901`, 104 refetchInterval | Bật stream event-driven sẵn có; polling chỉ cho dữ liệu nguội |
| R11 | P3 | Store-forward không phủ inspection path (trùng C3 — xử lý cùng nhau) | `storeForward.ts:2-16` | Gộp vào C3 |
| R12 | P3 | Mật khẩu MQTT device lưu/so sánh plaintext | `mqttService.ts:413-419` | Hash at rest |

---

## 5. Lớp 4 — Frontend nghiệp vụ AOI/AVI (7.4/10 — mạnh nhất)

### Hiện trạng
Trang nghiệp vụ chính đều tồn tại và khá sâu: `MachineRegistration` (queue duyệt + API-key), `MachineOnboardingWizard` (5 bước có test connection + deploy model + verify heartbeat), `MachineStatusMonitor`, `FactoryLiveMap3D` (poll 5s), `InspectionDetail` (**verify OK/NG/NTF + phân loại IPC-A-610 + so sánh ref/actual + lightbox — xuất sắc**), `History` (9 tab, export CSV/Excel/PDF), `ThresholdApprovalsPage` (RBAC), `QualityCockpit` (SPC/Pareto/heatmap/gates + realtime breach), `DrillDownDashboard` (corporate→machine), `Reports` + `ScheduledReports`, kiosk mode `?kiosk=1`. State coverage tốt (skeleton/empty/error), realtime socket có `RealtimeBadge`.

### Thiếu sót

| ID | Mức | Vấn đề | Bằng chứng | Hướng xử lý |
|----|:---:|--------|-----------|-------------|
| F1 | P1 | **"Bulk Acknowledge" là nút giả**: `setTimeout(1000)` + toast thành công, không gọi API — operator tưởng đã disposition lỗi | `History.tsx:639-644` | Nối mutation `inspection.acknowledge` thật hoặc gỡ nút |
| F2 | P2 | Vòng lặp repair/rework đứt: màn verify lỗi không tạo/link work-order, không thấy disposition | `InspectionDetail.tsx:852-910` (grep workOrder=0) | Nút "Tạo/Link WO sửa chữa" + trạng thái disposition trên panel NG/NTF |
| F3 | P2 | Wizard onboarding không validate trùng code/định dạng IP trước — lỗi chỉ hiện là toast server ở bước 3 | `Step1MachineInfo.tsx:16-20`, `Step3AssignStation.tsx:25` | Debounced `machine.checkCode` + lỗi inline theo field |
| F4 | P2 | i18n sót chuỗi cứng ("Online"/"Offline"/"Availability") + date-fns locale khóa cứng `vi` | `MachineStatusMonitor.tsx:474-498,58` | Đưa qua `t()`; chọn locale theo `i18n.language` |
| F5 | P2 | Màu hardcode (red-500/emerald-500) phá theming/dark-mode | `MachineStatusMonitor.tsx:63-67,468-493` | Dùng semantic token (`--success/--destructive`) |
| F6 | P2 | Grid cứng `grid-cols-4` không breakpoint → vỡ trên tablet shopfloor | `MachineStatusMonitor.tsx:456,766` | Thêm responsive breakpoints |
| F7 | P2 | Chưa có **bảng Andon/TV chuyên dụng** (kiosk chỉ ẩn chrome, không auto-rotate, font không tối ưu nhìn xa) | `useKioskMode.ts:10-28` | Trang `/andon`: yield/NG theo line-máy, font lớn, auto-cycle |
| F8 | P2/P3 | Golden-sample UI bị chôn trong AdvancedVisionLab, không có trong luồng operator | `AdvancedVisionLabPage.tsx:274,600` | Surface capture/approve golden vào màn station/inspection |
| F9 | P3 | MachineRegistration filter client-side toàn bộ list, không pagination server/bulk-approve | `MachineRegistration.tsx:223-238` | Server-side search/pagination + bulk approve |
| F10 | P3 | 3D map không có badge stale khi poll/socket rớt | `FactoryLiveMap3D.tsx:32` | Thêm freshness timestamp (pattern `RealtimeBadge` sẵn có) |
| F11 | P3 | `window.prompt` để lưu filter — chặn kiosk/tablet, không accessible | `History.tsx:1133` | Thay bằng dialog |
| F12 | P3 | Không có print CSS cho báo cáo ca (chỉ jsPDF) | `Reports.tsx` | `@media print` cho report/dashboard |

---

## 6. Lớp 5 — Báo cáo / Dashboard / KPI (5.8/10)

### Hiện trạng
- **Dashboard 8/10:** widget layout + custom dashboard cá nhân (globalFilters, autoRefresh) + template chia sẻ + marketplace + drag/resize + AI widget + realtime hook (`drizzle/schema/dashboard.ts`, `CustomDashboard.tsx`…).
- **SPC/OEE nền tốt:** Western-Electric + Nelson rules, Cpk/Ppk history, quality gates (`spc.ts`); OEE A×P×Q + downtime + targets (`oee.ts`, `oeeService.ts`).
- **AI analytics thật:** defect trend/Pareto/machine performance/forecast Holt-Winters query dữ liệu thật (`aiInspectionAnalytics.ts:415-825`); report generator có LLM + fallback template offline.
- **Escape-rate có thật** qua `stationTraces` + triangulation (`stationTriangulation.ts:205`).

### Thiếu sót

| ID | Mức | Vấn đề | Bằng chứng | Hướng xử lý |
|----|:---:|--------|-----------|-------------|
| A1 | **P0** | Cron scheduled report không truyền `{timezone}`; `computeNextRun` dùng Date local; exec-report thì CÓ truyền → lệch nhau; đã có sự cố prod (file vá +7h) | `reportScheduler.ts:322-324,464-492`, `check-mr-timezone.sql` | Truyền timezone user/tenant vào mọi `cron.schedule`; tính nextRun theo TZ đó |
| A2 | **P0** | Bucket ngày/giờ theo UTC ở toàn bộ rollup + MV → biểu đồ ngày cắt lúc 7h sáng VN | `statistics.ts:401,446,1346`, `0111:31` | `date_trunc('day', ts AT TIME ZONE 'Asia/Ho_Chi_Minh')` nhất quán |
| A3 | P1 | **FPY sai bản chất + mislabel**: `(ok+ntf)/total` gắn nhãn fpy; external API lại dùng `ok/total`; không lọc lần kiểm đầu | `statistics.ts:229,303,353`, `externalInspectionApi.ts:1875` | Định nghĩa FPY đúng (lần đầu theo serial, loại NTF/retest); tách final yield |
| A4 | P1 | **3 định nghĩa yield** khác nhau giữa các màn hình | `statistics.ts:170,1059`, MV `0111:31` | 1 helper yield canonical; quyết định cách tính NTF một lần |
| A5 | P1 | **Heatmap lỗi là giả**: `gridX = pointDefId % width` — bỏ qua bbox pixel thật; không có heatmap theo tọa độ board/panel/designator | `defectHeatmapRouter.ts:76-79`, `inspection.ts:109-112` | Aggregate theo `defectBboxX/Y` + panelIndex thật |
| A6 | P1 | Pareto theo tên điểm đo, không theo **defect class** (`defectCatalogId` không bao giờ được aggregate) → không có Pareto cầu chì/lệch/thiếu linh kiện | `aiInspectionAnalytics.ts:471-478` | Thêm Pareto + trend group theo defect_catalog |
| A7 | P1 | MV `hourly_yield_cache` **chết**: refresh flag OFF + không có read path nào đọc; dashboard full-scan bảng thô mỗi lần load | `0111`, `materializedViewRefreshService.ts:16` | Route read qua MV/cagg; bật refresh; hoặc cagg TimescaleDB sau R1/R2 |
| A8 | P2 | DPMO thiếu opportunities (thực chất là defective-PPM) → không so sánh được chuẩn ngành | `utils/spc.ts:580` | Thêm opportunity count/board (components × joints) |
| A9 | P2 | False-call ↔ escape không ghép thành KPI đối trọng (trade-off cốt lõi khi tune AOI) | `productionDashboardRouter.ts:197`, `stationTraces` | Tile dashboard ghép + alarm (scaffold có sẵn ở `alerts.ts`) |
| A10 | P2 | Export chỉ Excel/PDF — không CSV/JSON streaming, không Parquet/OData cho Power BI/Tableau | `universalExportService.ts` | CSV/JSON streaming + dataset feed/OData read-only |
| A11 | P2 | Giao báo cáo chỉ email, fail chỉ log, không retry/webhook/in-app | `reportScheduler.ts:275,295` | Kênh giao cắm được + retry/backoff |
| A12 | P3 | Chưa có dashboard mặc định theo **role** (operator/quality/exec) | `dashboardWidgetRouters.ts:48,205` | Binding role → default layout |

---

## 7. Lớp 6 — Mobile: FactoryAlertSystem (5.5/10)

### Hiện trạng
- **App chính thống = FactoryAlertSystem** (RN 0.73, v1.0.15, ~29.6k LoC, 9 màn hình/19 service): MQTT + hierarchy topic, Notifee local push, acknowledge/resolve, floating bubble native, KPI bulletin, dark mode, **trilingual VI/EN/ZH**, export, offline AsyncStorage, login token, **OTA tự cập nhật DB-versioned rất tốt** (`server/_core/index.ts:804-1040`, 12 APK đã phát hành).
- **2 app còn lại là prototype cũ** (android-mqtt-app: native MQTT + background-actions đúng cách; mobile-app: Expo + FCM thử nghiệm) — cùng dừng 2026-05-05, nên archive.
- MQTT layer tốt: health-check 2-failure threshold + circuit breaker + refetch khi reconnect (`mqttService.ts:109-163,1272-1347`).
- **FCM pipeline server là dead code** với app chính (app không chứa Firebase; chỉ mobile-app cũ tham chiếu).

### Thiếu sót

| ID | Mức | Vấn đề | Bằng chứng | Hướng xử lý |
|----|:---:|--------|-----------|-------------|
| MB1 | **P0** | App production **không nằm trong git** (`.gitignore:112`), chỉ commit APK → không lịch sử, không tái lập build, bus-factor | `.gitignore:112`, `git ls-files`=0 | Gỡ ignore, commit source, ngừng commit APK (dùng release storage) |
| MB2 | P1 | `startForegroundService()` có code nhưng **không call site** → app nền/tắt màn hình là rớt MQTT, miss alert (trái với chính tài liệu troubleshooting của app) | `notificationService.ts:433`, `NOTIFICATION_TROUBLESHOOTING.md:48-58` | Start FGS khi AppState→background; port pattern `react-native-background-actions` từ app legacy |
| MB3 | P1 | BootReceiver `startActivity` từ BOOT_COMPLETED — Android 10+ chặn im lặng → không tự khởi động lại | `BootReceiver.kt:25-29` | Đổi sang start foreground service |
| MB4 | P1 | IP LAN một khách hàng (`192.168.8.7:3000`) hardcode làm default ở ≥6 file | `constants.ts:36,115`, `alertApiService.ts:22`… | 1 config constant, default rỗng + onboarding màn hình đầu |
| MB5 | P2 | Acknowledge gửi `'mobile_user'` dù đã login thật; không dùng role client-side | `alertStore.ts:155,202` | Dùng identity từ authService; gate theo role |
| MB6 | P2 | Không có escalation (grep=0) và ack không có comment | `alertStore.ts:121` | Escalation timer + trường lý do khi ack |
| MB7 | P2 | Cleartext HTTP + endpoint tải APK không auth | `AndroidManifest.xml:54`, `_core/index.ts:844` | TLS + signed-URL/token cho download |
| MB8 | P2 | Release signing có điều kiện (thiếu prop → APK unsigned/debug), tên file timestamp → build không tái lập | `build.gradle:86-93,107-112` | Bắt buộc signing props; bỏ timestamp |
| MB9 | P3 | Kotlin package mismatch (`com.factoryalertsystem/` vs `com.foutec.FactoryAlertSystem`) | `MainActivity.kt:1` | Di chuyển thư mục đúng package |
| MB10 | P3 | 3 app chồng lấn, 2 app stale với 3 topic scheme khác nhau | package.json ×3 | Archive/xóa android-mqtt-app + mobile-app |
| MB11 | P3 | God-files: StationDetailScreen 7.488 dòng, stationService 2.987, SettingsScreen 2.855 | các file trên | Tách theo feature |
| MB12 | P3 | Test mỏng: 3 suite; 2 app kia có script test nhưng 0 file test | `__tests__/` | Thêm test reconnect/filter/notification |
| MB13 | P3 | Repo bloat: 15 APK + `avi-aoi-management.7z` **13.5 GB** + thư mục nested trùng tên | repo root | Chuyển release storage/LFS; xóa archive |

---

## 8. Lớp 7 — Backend & Database performance (6.0/10)

### Hiện trạng (con số cứng)
Pool postgres-js **max 10** + statement_timeout 30s (`db/connection.ts:15-23`) · entry monolith **5.049 dòng**, single process, **không clustering**, ~30 scheduler inline (`_core/index.ts:4565-4717`) · **110 refetchInterval / 38 trang** (2s–60s) · rate-limit in-memory 300/min (`rateLimitConfig.ts:10-11`) · retention 7 bảng nhưng **OFF mặc định** (`dataRetentionService.ts:113`) · index nóng tốt: `product_inspections` 13 index composite đúng (`inspection.ts:53-68`) · pagination mặc định limit 50 + cursor (`db/inspection.ts:85,270`) · graceful shutdown chuẩn · 307 file test chỉ 4 skip · dead-weight: `routers.ts.bak` 9.714 dòng, `db.ts.bak` 7.814, migration series `0000-0017` bị **đánh số trùng 2 nhánh**.

### Thiếu sót

| ID | Mức | Vấn đề | Bằng chứng | Hướng xử lý |
|----|:---:|--------|-----------|-------------|
| B1 | P1 | **Query monitor/validator là dead code** — không nối vào đường query nào → prod không track slow query | `queryMonitor.ts`, `queryValidationMiddleware.ts` (self-referenced) | Nối drizzle logger/postgres-js debug → `logQueryMetrics` |
| B2 | P1 | Retention OFF + bảng log không giới hạn: `audit_logs`, `notifications`, `mqtt_*_history/logs`, `package_activity_logs` không bao giờ prune | `dataRetentionService.ts:113`, `system.ts:6,189` | Bật retention prod; prune/partition bảng log (trừ command_log compliance) |
| B3 | P1 | N+1 dashboard stats: 4 round-trip tuần tự (workshop→line→station→machine) mỗi lần filter | `db/statistics.ts:126-146` | 1 join/correlated subquery — 4 RT → 1 |
| B4 | P1 | Auth tra DB mỗi request (verifySession + getUserByOpenId), không cache — nhân với 110 endpoint polling | `_core/sdk.ts:277-289`, `_core/trpc.ts:120-123` | Cache user-by-session TTL 30–60s (Redis sẵn có) → giảm ~90% read auth |
| B5 | P2 | Pool max 10 chia cho API + socket + ~30 scheduler → pool-wait khi dashboard đồng thời | `db/connection.ts:16` | Nâng 20–30 theo max_connections; pool riêng cho background job |
| B6 | P2 | Rate-limit in-memory + key theo IP → sai với NAT nhà máy, không multi-instance | `rateLimitConfig.ts` | Redis store (ioredis sẵn) + key theo API-key/user |
| B7 | P2 | Single process: job AI/report nặng block event loop toàn API | `_core/index.ts:4565-4717` | Tách scheduler ra worker process / cluster + leader election |
| B8 | P2 | 2 tầng cache (Map in-memory + Redis) invalidation không đồng bộ → dashboard stale sau inspection mới | `cacheService.ts`, `cachedStatistics.ts:215` | Hợp nhất về Redis; invalidate cả hai tầng |
| B9 | P2 | Đọc full 30+ cột `measurement_results` cho list/detail; nhiều endpoint không projection | `inspectionRouters.ts:56` | Projection cột cần thiết trên hot path |
| B10 | P3 | Migration đánh số trùng `0000-0017` (2 nhánh merge) → rủi ro thứ tự khi provision DB mới | `drizzle/0000_*.sql` ×2 | Verify `_journal.json`; renumber/document |
| B11 | P3 | Dead weight: 3 file `.bak` ~21k dòng + script scratch ở root → nhiễu grep/typecheck | `routers.ts.bak`… | Xóa |
| B12 | P3 | Trang poll 2–5s (BatchInference, AIBrain, FactoryLiveMap3D) không gate theo tab-visibility | `BatchInferencePage.tsx:57-72` | Gate visibility / chuyển socket-push |

---

## 9. Lớp 8 — AI phân tích hình ảnh & chức năng nâng cao AOI/AVI (4.8/10)

### Hiện trạng
Ba mảng được audit: (a) pipeline AI inference từ ảnh máy đến verdict, (b) thuật toán vision nâng cao (doc 24), (c) AI hỗ trợ operator/engineer (doc 05/06). Trạng thái triển khai hiện tại: flags lớp **advisor/copilot đang ON** trong `.env` (RCA, Threshold Advisor, Setup Advisor, auto-tune, sidecar Qwen3-VL-8B), nhưng flags lớp **inference/DL head/anomaly OFF** theo code-default và **`models/` không có file weight nào** (DINOv2 ONNX, GGUF) → runtime mặc định là chế độ degraded (text-of-image / heuristic), không phải đường ONNX.

**REAL và đang hoạt động:**
- Nút "AI analyze" trong InspectionDetail là **VLM thật nhìn ảnh lỗi** (`inspectionRouters.ts:378-469` → llama sidecar mtmd Qwen3-VL, fallback trung thực khi sidecar down).
- **RCA Copilot 8/10:** tổng hợp Pareto + SPC/Cpk + anomaly + mô tả ảnh nghi vấn qua VLM + causal graph, HITL propose-only, honest-degrade (`aiRcaCopilot.ts:120-641`).
- **Threshold Advisor + auto-tune 8/10:** thống kê percentile/±3σ/Cpk (không LLM — đúng cho bài toán này), cron 04:00 đề xuất vào `thresholdApprovals` HITL, UI evidence current-vs-proposed đầy đủ (`aiThresholdAdvisor.ts:126-432`, `aiThresholdTuneScheduler.ts`).
- **AI chat đọc dữ liệu thật** (yield/Pareto/SPC tools + KB domain AOI — doc 11 đã vá): hỏi "vì sao line 2 tụt yield" ra câu trả lời số liệu thật (`analyticsTools.ts:326-633`).
- **Hạ tầng inference thật:** ONNX runtime (TensorRT/CUDA/DirectML EP, YOLO+NMS, `aiInferenceEngine.ts:168`), batch engine, PatchCore anomaly bank trên ảnh AOI + cron auto-rebuild, A/B canary (hash routing + chi-square + guardrail auto-pause), drift monitor PSI, auto-rollback, edge model packaging — schema/logic hoàn chỉnh.
- **Thuật toán chất lượng cao:** sub-pixel registration LK/ECC Gauss-Newton, test độ chính xác <0.01px (`imageRegistration.ts:449`); toán SPI 3D volume/coplanarity/warpage chuẩn IPC-7527 (`aiSpi3d.ts:539`).

**Vấn đề cấu trúc — "trưởng thành mồ côi":** verdict engine, registration, golden-sample service, SPI enrichment, acquisition framework, AISuggestionsPanel — đều là code thật, có test, nhưng **0 caller trên đường production**. Khi máy đẩy kết quả qua `submitInspection`, các post-hook chỉ là rule-based (NG-rate check, SPC gate) — **không một dòng AI nào chạy**. Đồng thời correction quý giá của operator (OK/NG/NTF) bị vứt đi thay vì thành training data.

### Thiếu sót

| ID | Mức | Vấn đề | Bằng chứng | Hướng xử lý |
|----|:---:|--------|-----------|-------------|
| V1 | **P0** | **Không có AI inline khi ingest**: `submitInspection` + `aoiPackageRouter.commit` không gọi `runInference`/`processQualityGate`; verdict engine chỉ on-demand từ UI | `machineApiRouters.ts:82-534`, `aoiPackageRouter.ts:829-847`, `aiQualityGateRouter.ts:161` | Hook flag-gated fire-and-forget `processQualityGate`/DL-head cạnh các post-hook sẵn có, config theo máy+sản phẩm |
| V2 | **P0** | **Vòng lặp học đứt**: correction operator chỉ ghi đè `result` + nhét lý do vào `remark` — không bảng corrections, không audit, không label queue, không đo agreement; export training chỉ lấy từ pipeline `aiSuggestions` mồ côi | `inspectionRouters.ts:579-620`, `aiFeedbackRouter.ts:428` | Bảng `measurement_corrections` (gốc/sửa/người/lý do/máy/điểm) → feed `ai_label_queue` + false-call trend + training export |
| V3 | **P0** | **Không có dự đoán NTF/false-call** pre-sort hàng đợi verify của operator — ROI AI cao nhất cho AVI (giảm tải verify) | grep predictor = 0; `aiActiveLearning.ts:31-169` là label queue CNN tách rời | Classifier false-call khi ingest (heuristic Cpk/repeat-offender → model khi đủ label từ V2), sort queue + badge "khả năng báo giả" |
| V4 | P1 | Toàn bộ stack AI nâng cao **flag OFF theo code-default + `models/` rỗng** (không DINOv2/GGUF) → mặc định degraded; chuỗi governance trơ | `embeddingHead.ts:188-203`, glob `models/**` = rỗng | Ship model đã validate + production profile flags + runbook enablement |
| V5 | P1 | Canary/A-B **đói dữ liệu**: chỉ chạy trong gate on-demand → `ab_test_results` gần rỗng, guardrail auto-pause không có gì để đo | `aiQualityGate.ts:365`, `aiABTesting.ts:330` | Gắn canary vào hook inline V1 |
| V6 | P1 | Không GPU micro-batching: tensor `[1,C,H,W]` từng ảnh, batch engine chỉ song song session, LRU-5 chung mọi model, không backpressure/circuit-breaker | `aiInferenceEngine.ts:217,10`, `aiBatchEngine.ts:110-121` | Queue micro-batch gộp N ảnh/1 `session.run` + cap concurrent GPU |
| V7 | P1 | Sub-pixel registration **không bao giờ chạy production** — `ALIGN_BEFORE_DIFF` OFF, caller duy nhất là Lab router | `aiAdvancedVision.ts:24,181` | Gọi `registerToReference` trong pipeline golden-diff, bật per-recipe |
| V8 | P1 | Golden-sample service **mồ côi**: `getReferenceGray` 0 caller, không router, không UI capture — Lab phải upload 2 ảnh thủ công | `goldenSampleService.ts:119` | Router + capture UI + resolve golden active theo (product, recipe, station, roi) |
| V9 | P1 | AISuggestionsPanel **không có producer**: `aiSuggestions` chỉ được ghi bởi endpoint không ai gọi; kết quả VLM analyze không đổ vào panel/feedback/training | `aiFeedbackRouter.ts:21-60`, `AISuggestionsPanel.tsx:88` | `analyzeWithAI` emit suggestion → panel + feedback + training loop có dữ liệu |
| V10 | P1 | Thiếu chức năng AOI nâng cao chuẩn ngành: tích hợp verdict repair-station, tối ưu program/recipe từ dữ liệu lịch sử | grep repair-station/program-optim = 0 | Repair-verdict interface + recipe optimizer (sau khi có V2) |
| V11 | P2 | Golden không có approval workflow (`active` không cần duyệt — cùng họ M10) | `goldenSample.ts:22` | Cột status/approvedBy + gate active theo duyệt |
| V12 | P2 | "IR depth" **chưa có nguồn height-map nào** (chỉ rasterize điểm được cung cấp) — 3D hiện 100% vendor pass-through | `aiSpi3d.ts:706`, `kohYoung.ts:122` | Chốt phạm vi (quyết định #7): giữ vendor hay đầu tư structured-light/point-cloud |
| V13 | P2 | SPI enrichment mồ côi + flag OFF — server không tự tính height/volume/coplanarity | `aiSpi3d.ts:762,60` | Nối vào submitInspection khi có height-map |
| V14 | P2 | Acquisition framework 0 runtime consumer; GenICam là stub throw | `vision/acquisition/index.ts:34`, `genICamImageSource.ts:85` | Worker grab→inspect→submit (mock/file trước) hoặc de-scope chính thức |
| V15 | P2 | Không lighting normalization / lens correction → golden-diff không bền với trôi ánh sáng | `aiAdvancedVision.ts:299` (chỉ có quality metrics) | Flat-field + calibration/undistort trước registration |
| V16 | P2 | Vision→control loop demo-gated (đúng posture an toàn) nhưng thiếu dashboard vận hành/enable UI — proposal chỉ hiện trong action inbox | `qualityControlProposer.ts:53,244` | Ops dashboard + pilot SPI run-to-run offset trên máy đã commissioned |
| V17 | P2 | Không có bộ validation ảnh PCB thật (chỉ synthetic warp test), không Gage R&R cho metrology | `imageRegistration.test.ts:100` | Corpus labeled + báo cáo accuracy/repeatability định kỳ |
| V18 | P2 | Chưa có chính sách fallback khi AI down cho đường inline tương lai (pattern NEEDS_REVIEW đã có ở DL head — tái dùng) | `embeddingHead.ts:548` | Circuit-breaker/health-gate → route review, không throw error |
| V19 | P2 | Edge model deploy chỉ đóng gói `.bin`, không xác nhận giao nhận end-to-end; đóng gói phụ thuộc file model tồn tại mà không verify trước | `aiEdgeDeployment.ts:49-62` | Verify artifact pre-package + deploy-verification ở Step 5 wizard |
| V20 | P2 | Advisor bỏ qua bằng chứng ảnh (trừ RCA): threshold/auto-tune thuần số; output VLM không được tái dùng | `aiThresholdAdvisor.ts:126-432` | Persist mô tả VLM per-NG + thumbnail vào approval/inbox item |
| V21 | P2 | Auto-proposer chỉ phủ NG-burst; yield-drop / false-call-spike / machine-drift không được đề xuất chủ động | `aiAutoProposer.ts:141-148` | Thêm draft an toàn cho 3 trigger còn lại |
| V22 | P3 | Segmentation YOLOv8-seg tự gắn nhãn experimental (smoke-test tensor giả) | `aiInferenceEngine.ts:558-563` | Giữ gate ngoài quyết định đo lường; validate trước khi dùng |
| V23 | P3 | AdvancedVisionLab thiếu công cụ kỹ sư: annotate/measure/golden-capture/SPI tab | `AdvancedVisionLabPage.tsx:737` | Bổ sung tab tương ứng |
| V24 | P3 | VLM analyze lỗi cứng INTERNAL_SERVER_ERROR (dù provider degrade trung thực) + không re-run được (nút ẩn sau khi có kết quả) | `inspectionRouters.ts:465-467,855` | Hiện fallback text + cho phép phân tích lại |
| V25 | P3 | Auto-tune ghi `requestedBy: 0` sentinel làm mờ provenance khi join `users` | `aiThresholdTuneScheduler.ts:307` | Cột `source='ai_autotune'` tường minh |

---

## 10. Đối chiếu chéo — các phát hiện củng cố lẫn nhau

- **R1 + R6 + C8 + B2** cùng một gốc: không có chiến lược vòng đời dữ liệu (row + ảnh + log). Phải xử lý như MỘT hạng mục thiết kế chung (partition + retention + blob lifecycle), không vá lẻ.
- **A7 + B3 + B4 + B8** cộng hưởng: dashboard vừa full-scan bảng thô, vừa N+1, vừa auth-per-request, vừa cache stale → trải nghiệm chậm mà số vẫn có thể sai. Fix theo thứ tự: partition (R1) → cagg/MV (A7) → cache hợp nhất (B8).
- **C1 + C2 + C3 + C4** là một chuỗi: có hot-folder mà schema sai thì vô nghĩa; có schema đúng mà không durability thì mất dữ liệu; đủ cả ba mà không có wizard thì không vận hành được ở nhà máy. Phải giao cùng một đợt.
- **M5 + F1** cùng vi phạm nguyên tắc truy vết: hành động quan trọng (sửa master data, acknowledge lỗi) không để lại dấu vết thật.
- **A1 + A2** giải thích lẫn nhau: file vá `+7h` ở root là hệ quả của cả cron TZ lẫn bucket TZ — phải sửa cả hai, xóa file vá.
- **V1 + V2 + V3 + V5 + V9** là MỘT vòng lặp đứt tại nhiều khớp: AI không chạy khi ingest (V1) → không có verdict để so với operator; operator sửa thì không được ghi lại (V2) → không có label; không label → không train được NTF predictor (V3); không traffic inline → canary đói (V5); kết quả VLM không đổ vào suggestions (V9) → panel rỗng. Phải thiết kế như một chuỗi khép kín trong cùng một đợt, không vá lẻ.
- **V2 + F2 + M5** cùng bản chất: hành động của con người (correction, repair, sửa master data) không để lại dấu vết có cấu trúc — mất cả giá trị truy vết lẫn giá trị dữ liệu huấn luyện.
- **V8 + V7 + V15 + M10/V11** hợp thành luồng golden-diff hoàn chỉnh: golden có duyệt → normalize ánh sáng → registration sub-pixel → diff. Thiếu một khâu là các khâu còn lại vô dụng.

---

## 11. KẾ HOẠCH HOÀN THIỆN — 7 Đợt (chờ duyệt)

> Nguyên tắc: (1) độ bền + độ đúng dữ liệu trước, tính năng sau; (2) mỗi đợt xanh (tsc 0 + full test + migration verify) rồi mới sang đợt kế; (3) **cấm subagent thao tác git trong wave song song** (bài học doc 24); (4) mỗi hạng mục ghi rõ Gap ID để truy vết.

### Đợt 1 — Nền dữ liệu & độ đúng số liệu (P0, ~5 agent)
| Hạng mục | Gap | Sản phẩm |
|---|---|---|
| 1.1 TimescaleDB trên DB chính (quyết định #1): compose/image `timescaledb-ha` (kèm pgvector), hypertable hóa `product_inspections`, `measurement_results` + 4 bảng telemetry của 0118, migration fail-loudly, backfill script | R1, R2 | Migration mới + hướng dẫn đổi image + script chuyển dữ liệu an toàn + test |
| 1.2 Bật retention: chọn cơ chế mỗi bảng, thêm bảng log (B2), job lifecycle **ảnh** đồng bộ với prune row | R3, R6, B2, C8 (phần retention) | `DATA_RETENTION_ENABLED` prod profile + job blob cleanup |
| 1.3 Timezone: `{timezone}` cho mọi cron + `computeNextRun` theo TZ + bucket `AT TIME ZONE` toàn bộ rollup/MV; xóa `fix-timezone.sql` sau verify | A1, A2 | Helper TZ tập trung + test chốt biên ngày VN |
| 1.4 KPI canonical: 1 helper yield duy nhất, FPY đúng first-pass theo serial, DPMO có opportunities; migration đối chiếu số cũ/mới | A3, A4, A8 | `server/utils/kpi.ts` + bảng đối chiếu chênh lệch |
| 1.5 Gỡ nút giả Bulk Acknowledge → mutation thật + audit | F1 | API + UI + test |
| **Tiêu chí nghiệm thu** | | EXPLAIN cho dashboard query dùng partition pruning; 0 bảng nóng thiếu retention; report 6:00 sáng VN đúng ngày; 2 màn hình bất kỳ cùng chỉ số ra cùng con số |

> **KẾT QUẢ THỰC THI ĐỢT 1 (2026-07-04, 4 agent):** ✅ Hoàn thành xanh — tsc 0 lỗi, full suite 3509 pass/8 skip/0 fail, migration 0172–0174 applied.
> - **1.1 PATH B:** probe thực tế cho thấy dev DB là PostgreSQL **17.6 native Windows** (ghi chú PG18 trong .env sai), không có timescaledb/pgvector khả dụng → migration 0172/0173 hai nhánh (tự hypertable-hóa + retention khi extension có mặt — đã smoke-test thật trong container Timescale: 6 hypertable, chunk tháng, dữ liệu bảo toàn; WARNING to + ghi `db_feature_status` khi vắng), docker-compose đổi sang `timescale/timescaledb-ha:pg17`, runbook `scripts/migrate-to-timescaledb.md`, banner khởi động khi DB chưa đạt quyết định #1. ⚠️ Tiêu chí "partition pruning trên dev" chưa đạt tại chỗ do PG Windows — cần chuyển dev DB sang Docker theo runbook §C hoặc chấp nhận banner.
> - **1.2:** retention 12 tháng phủ +9 bảng (loại trừ `command_log` compliance), không double-delete với policy native; **imageLifecycleService** mới: xóa object cùng nhịp prune row + giám sát đĩa 80%/32TB; `DATA_RETENTION_ENABLED=true`.
> - **1.3:** mọi `cron.schedule` nhận `{timezone}` (helper `factoryTime.ts`, FACTORY_TZ mặc định Asia/Ho_Chi_Minh); `computeNextRun` tính theo TZ nhà máy; sửa kèm 2 bug thật (runReport hardcode 08:00, tràn ngày 31 lịch tháng); file vá fix-timezone.sql giữ lại để đối chiếu.
> - **1.4:** `server/utils/kpi.ts` canonical (final yield NTF=pass; FPY thật theo first-inspection-per-serial; DPMO có opportunities=số điểm đo; sigma capped 6σ); sửa toàn bộ call site trong statistics/aiInspectionAnalytics/externalInspectionApi/spc; MV 0174 viết lại với TZ bucket; **sửa kèm 6 hàm analytics vốn crash trên DB thật** (enum `IN ('OK','PASS')` invalid); không đổi wire-name. Tồn đọng: `Dashboard.tsx:1139` client tự tính fpy kiểu cũ (chuyển Đợt 5), range-filter edges với dữ liệu legacy mixed-TZ (chuyển Đợt 2 write-side).
> - **1.5:** Bulk Acknowledge thật (idempotent, audit log, count trung thực, badge UI, i18n en/vi/zh) + gia cố endpoint legacy `batchAcknowledge`; migration không cần — cột acknowledge đã tồn tại từ 0000.

### Đợt 2 — Đường máy thật khép kín (P0/P1, ~5 agent)
| Hạng mục | Gap | Sản phẩm |
|---|---|---|
| 2.1 Hot-folder ingestion service (chokidar): folder+parser config theo máy, xử lý file lock/partial-write, archive/error folder | C1 | Service + config UI + test với file mẫu |
| 2.2 Golden-file conformance cho vendor adapters (thu file xuất thật: ưu tiên vendor đang có ở nhà máy), version schema theo firmware | C2, C6 | Bộ golden fixtures + test + 2–3 vendor mới |
| 2.3 Durability ingest: WAL/outbox cho đường inspection (HTTP + MQTT bridge), bật `OT_STORE_FORWARD_ENABLED`, `OT_CONN_HA_ENABLED` trong prod profile | C3, C5, R11 | Buffer bền + backfill + test kill-DB |
| 2.4 AOI Onboarding Wizard: vendor → dry-run normalize payload mẫu → cấp/rotate scoped key → commissioning sign-off chặn ingest production | C4, C7 (key), M8 | Wizard mới + API + RBAC |
| 2.5 Auth máy: credential per-machine, rate-limit ingest, hash MQTT password | C7, R12, M4 (throttle register) | Migration + middleware |
| **Tiêu chí nghiệm thu** | | Demo: 1 máy AOI mô phỏng xuất CSV vào folder → kết quả + ảnh lên UI < 5s; kill DB 60s không mất bản ghi; onboard máy mới ≤ 10 phút không sửa code |

> **KẾT QUẢ THỰC THI ĐỢT 2 (2026-07-04, 4 agent):** ✅ Hoàn thành xanh — tsc 0, full suite 3681 pass/8 skip/0 fail, migration 0176–0178 applied.
> - **2.1 Hot-folder** (`hotFolderService` + trang `/hot-folders`): chokidar per-config, chống partial-write (awaitWriteFinish), retry file-lock, **idempotency = machine+sha256(content)+filename** (ledger `hot_folder_files`, unique index — không thể double-insert kể cả restart), archive/error + sidecar lý do, catch-up khởi động, polling fallback cho SMB, dọn archive theo `deleteAfterDays`; dry-run endpoint cho wizard. Chưa test trên SMB share thật — cần kiểm khi nghiệm thu tại nhà máy.
> - **2.2 Vendor adapters + doc 28** "ST4I Standard Inspection Feed Spec" (JSON/CSV/XML, timestamp bắt buộc offset, atomic-write protocol, tóm tắt tiếng Việt): registry 9 adapter — `st4i-standard` chuẩn tắc (zod strict, 3 encoding tương đương có test), `ict-aoi`/`saki-aoi`/`mirtec` representative với FIELD_MAP/DEFECT_MAP gom 1 chỗ (IPC-aligned); 15 golden fixtures + README quy trình thả file xuất thật vào để đối chiếu.
> - **2.3 Durability + auth**: WAL inspection `inspection-store-forward.jsonl` (bound 20k/512MiB/72h, dead-letter, alert depth≥500), ACK `queued:true` khi DB sập, replay exactly-once (applied-key ledger + existence check); key per-machine `mk_*` hash-at-rest tái dùng bảng `api_keys` 0126 (+machineId+revokedAt), 17 endpoint máy chuyển auth mới, shared key legacy sau flag `MACHINE_SHARED_KEY_ALLOWED` (deprecation warning); rate-limit ingest per-key; register throttle 20/h/IP + pending cap 200 + `getDefaultStation()` thật (hết hardcode stationId:1); MQTT password: phát hiện cột password **chưa từng tồn tại** (check cũ không enforce được) → 0178 thêm passwordHash bcrypt + upgrade-in-place. Prod flags bật: `OT_STORE_FORWARD_ENABLED`, `OT_CONN_HA_ENABLED`, `INSPECTION_STORE_FORWARD_ENABLED`.
> - **2.4 Wizard `/aoi-onboarding`** 5 bước (máy/vendor động từ registry → nguồn dữ liệu → dry-run bắt buộc pass, admin override có lý do → cấp key show-once+QR qua `machineApi.issueKey` mới → commissioning sign-off audit bất biến); bảng `aoi_commissioning_records` (0177); **gate MỀM fail-open**: máy chưa commissioned vẫn nhận kết quả, chỉ tag `product_inspections.ingestMode='commissioning'` — không bao giờ reject.
> - Khớp nối chéo đã xác minh khi nghiệm thu: hot-folder → `processInspectionSubmission` (đi qua WAL), CSV envelope `{rows}` ↔ adapters, wizard Step 4 → `machineApi.issueKey`. Tồn đọng chuyển đợt sau: WAL status lên systemHealth UI (Đợt 4), rate-limit Redis (Đợt 4/B6), write-side TZ normalization dữ liệu legacy (theo dõi riêng).

### Đợt 3 — Toàn vẹn & quản trị master data (P1, ~4 agent)
| Hạng mục | Gap | Sản phẩm |
|---|---|---|
| 3.1 FK + unique theo lô (kèm orphan-scan trước khi enforce): machines/stations, measurement→pointDef/defectCatalog, mapping pairs, hierarchy codes | M1, M6, M11 | Migrations có guard + báo cáo orphan |
| 3.2 Audit trail mọi mutation master data (before/after snapshot) | M5 | Middleware + test |
| 3.3 Machine lifecycle state + sửa soft-delete/unique-code + pre-check trùng + fix register hardcode station | M2, M3, M7, M4 | Migration + state machine + UI badge |
| 3.4 Approval workflow cho inspection program (mirror machineRecipe SoD) + partial unique golden active | M9, M10 | Workflow + migration |
| 3.5 Component library + panel/board multi-up master (thiết kế trước, làm sau nếu quá lớn) | M12, M13, M14 | Schema design + migration đợt đầu |
| **Tiêu chí nghiệm thu** | | 0 orphan trên bảng đã enforce; mọi thay đổi master data thấy được trong audit log; không tạo được 2 golden active bằng concurrent request |

> **KẾT QUẢ THỰC THI ĐỢT 3 (2026-07-04, 3 agent):** ✅ Hoàn thành xanh — tsc 0, full suite 329 file/3771 test pass/0 fail, migration 0179–0182 applied (dev + test DB).
> - **3.1 Toàn vẹn hai pha (W3-A):** 0179 quét orphan (19 quan hệ, bảng `integrity_scan_results`) → 0180 enforce có điều kiện (ADD NOT VALID → VALIDATE nếu sạch). **14/15 FK đã VALIDATE** trên dev; unique lines/stations (partial `WHERE isActive`) + cặp mapping đã enforce. Scanner tuần (Chủ nhật 03:30) + router admin `integrity` + `scripts/repair-orphans.mjs`. Caveat hypertable xử lý đúng (skip FK mr→pi khi là hypertable, ghi `db_feature_status`). ⚠️ **2 hạng mục dữ liệu chờ NGƯỜI quyết:** (a) 53.280 dòng `measurement_results` mồ côi point-def đã bị hard-delete — cần tạo placeholder `__UNMAPPED__` rồi re-run validate; (b) 7 nhóm workshop trùng code active (vd `FAC-HN-SMT` ×3) — cần merge thủ công.
> - **3.2+3.3 Quản trị máy (W3-B):** lifecycle 5 trạng thái + ma trận chuyển đổi hợp lệ (endpoint `machine.setLifecycleStatus`, lý do bắt buộc khi decommission/retire, ghi cả `control_audit_log`); soft-delete hết chiếm code vĩnh viễn (partial unique `WHERE isActive` — xóa xong đăng ký lại được, restore đụng code bị chiếm → CONFLICT nêu tên máy giữ); pre-check trùng code ở create/approve/register (SN sinh tự động retry hậu tố -2…-5); **audit trail phủ toàn bộ ~25 mutation master data** trong hierarchyRouters (diff-only, apiKey redacted có test chứng minh). Ghi chú: `corporates` không có mutation router nào — không có gì để audit.
> - **3.4 Program approval + golden (W3-C):** `inspection_program_releases` — snapshot bất biến + checksum, SoD creator≠approver (FORBIDDEN), release atomic FOR UPDATE + partial unique "1 released/scope", diff viewer 2 phiên bản trong panel "Phát hành chương trình" tại `/products`; bất biến 1-golden-active enforce tầng DB (xác minh 23505 trên dev, 0 duplicate phải dọn). **Doc 29** thiết kế component library / panel multi-up / operator badge / capabilities validation (thi công Đợt 5 + 1 migration hypertable Đợt 7).
> - Nghiệm thu bổ sung bởi wave-lead: thêm 31 key `programRelease.*` vào zh.json; sửa fixture `dataRetentionService.test` (dùng sentinel mồ côi 999999 — giờ bị chính FK Đợt 3 chặn, đổi sang resolve id thật); deflake `explainScheduleWithAI` bằng timeout cứng 3s (`SCHEDULE_AI_EXPLAIN_TIMEOUT_MS`) — LLM treo dưới tải làm test what-if quá hạn 5s, sửa đúng contract "non-blocking" của hàm.
> - Tồn đọng chuyển đợt: stamping `programReleaseId` + cột lifecycle-flag trên inspection rows (hypertable — Đợt 7 migration); cảnh báo lifecycle ở đường ingest per-machine-key (Đợt 4).

### Đợt 4 — Hiệu suất backend & vận hành (P1/P2, ~4 agent)
| Hạng mục | Gap | Sản phẩm |
|---|---|---|
| 4.1 Nối query monitor vào drizzle; dashboard slow-query cho admin | B1 | Logger + ngưỡng cảnh báo |
| 4.2 Cache session-auth TTL ngắn; hợp nhất cache về Redis, invalidate xuyên tầng | B4, B8 | Middleware + test invalidation |
| 4.3 Diệt N+1 statistics + projection cột hot path | B3, B9 | Refactor + benchmark trước/sau |
| 4.4 Pool 20–30 + pool riêng background; tách scheduler ra worker process; Redis rate-limit key theo user/API-key | B5, B7, B6 | Cấu hình + worker entry + healthcheck |
| 4.5 Bật read qua MV/cagg cho dashboard (`hourly_yield_cache` hoặc cagg mới trên nền partition Đợt 1) | A7 | Read path + refresh schedule |
| 4.6 Dọn repo: xóa `.bak`, script scratch, chuẩn hóa journal migration, gate polling theo tab-visibility | B10, B11, B12, R10 | Cleanup + docs |
| **Tiêu chí nghiệm thu** | | p95 dashboard chính < 500ms với 12 tháng dữ liệu mô phỏng; steady-state DB read giảm ≥ 50%; slow query hiện trên admin UI |

> **KẾT QUẢ THỰC THI ĐỢT 4 (2026-07-04, 4 agent):** ✅ Hoàn thành xanh — tsc 0, full suite 343 file pass/0 fail.
> - **4.1 Query monitor (W4-A):** đo thật mọi query qua patch `client.unsafe` (logger chuẩn của drizzle/postgres-js không có duration — đã kiểm chứng), chuẩn hóa SQL không lưu param/PII, ring 200 + LRU 500 pattern, kill-switch `QUERY_MONITOR_ENABLED`; xóa 2 file validator dead-code; endpoint `systemHealth.dbIngestHealth` + card "DB & Ingest health" trên `/system-health` (slow queries + WAL badge + trạng thái Timescale + auth-cache stats).
> - **4.2 Cache (W4-B):** cache session-auth TTL 45s (key sha256 cookie, strip secret) — đo được **15→3 DB call/5 request** (bỏ 3 round-trip/request); invalidation phủ logout/ban/đổi role/revoke + Redis broadcast xuyên instance; hợp nhất 2 tầng cache thành `TieredCacheService` (L1 LRU bounded + L2 Redis, invalidate xuyên tầng — đóng gap dashboard stale); MV read-path: `dashboardRouter.getHourlyStats` đọc `hourly_yield_cache` (refresh 5 phút, luật freshness <10 phút, stale → live query). Chưa gộp: `_core/cache.ts` statsCache, `distributedCache.ts` (ghi nhận).
> - **4.3 N+1 + projection + polling (W4-C):** hierarchy filter 4–6 round-trip → 1 subquery (kèm 2 sửa đúng: `workshopId` trước đây bị **bỏ qua lặng lẽ** giờ lọc thật; filter cấp rỗng hết rơi về số toàn cục); projection 19/37 cột cho 3 list endpoint (client + mobile đã grep-verify không dùng cột cắt); hook `usePollingInterval` tạm dừng khi tab ẩn + refetch khi focus, áp cho 8 trang poll ≤5s; stale badge cho FactoryLiveMap3D (đóng F10).
> - **4.4 Pool/worker/cleanup (W4-D):** pool 25 (`DB_POOL_MAX`) + jobs-pool 8 riêng (retention/integrity/matview); tách 22 scheduler ra `server/worker.ts` với `ROLE` api/worker/unset-giữ-nguyên (đã boot thử thật); rate-limit Redis fixed-window fail-open key theo API-key/session/IP (limiter ingest per-machine giữ in-memory — không pluggable, ghi nhận); **B10:** `_journal.json` là di tích — runner sort tên file + track `__applied_migrations`, trùng số an toàn, luật đánh số ghi ở `drizzle/README.md` mới; xóa 17 file rác grep-verified (gồm 2 file vá TZ lịch sử — comment code trỏ về §6 A1).
> - Tồn đọng chuyển tiếp: cảnh báo lifecycle trên đường ingest per-machine-key (ghi ở W3-B) chưa làm — gộp Đợt 7 khi đụng machineApiRouters; `aiAnomalyBankScheduler` chưa chuyển jobs-pool (tầng db dùng chung, không mechanical).

### Đợt 5 — Phân tích chuyên nghiệp & trải nghiệm QC (P1/P2, ~4 agent)
| Hạng mục | Gap | Sản phẩm |
|---|---|---|
| 5.1 Heatmap lỗi THẬT theo bbox/board-XY/panelIndex + drill theo designator | A5 | Router + UI mới |
| 5.2 Pareto theo defect class (defectCatalog) + trend; KPI ghép false-call ↔ escape + alarm | A6, A9 | API + tile dashboard |
| 5.3 Vòng lặp repair: tạo/link WO từ InspectionDetail, disposition status, feedback về dashboard chất lượng | F2 | Luồng khép kín + test |
| 5.4 Andon TV board `/andon` (font lớn, auto-cycle, socket-push) + golden-sample surface vào luồng operator | F7, F8 | 1 trang mới + tích hợp |
| 5.5 Export CSV/JSON streaming + dataset feed cho BI; kênh giao báo cáo cắm được (webhook/in-app) + retry | A10, A11 | Service + UI |
| 5.6 Polish frontend: i18n sót, semantic tokens, responsive grid, dialog thay prompt, print CSS, stale badge 3D map, pagination MachineRegistration, role default dashboard | F3–F6, F9–F12, A12 | Sweep có checklist |
| **Tiêu chí nghiệm thu** | | Heatmap khớp tọa độ bbox thực; Pareto phân loại theo IPC defect class; NG → WO → repair → re-inspect truy vết được một mạch |

> **KẾT QUẢ THỰC THI ĐỢT 5 (2026-07-04, 5 agent):** ✅ Hoàn thành xanh — tsc 0, full suite 357 file pass/0 fail, migration 0183–0185 applied.
> - **5.1 Heatmap thật (W5-A):** bbox pixel thật thay hash `pointDefId % width`; thang tọa độ trung thực (product_image → observed_extent → logical fallback có nhãn), `excludedNoBbox` không giấu; Pareto theo **loại lỗi IPC** (bucket UNCLASSIFIED trung thực) toggle với Pareto điểm đo; cặp KPI **false-call ↔ escape** + tuning hint (alarm visual-only — enum alert chưa có loại false-call, ghi rõ). ⚠️ Dữ liệu dev hiện 0 dòng bbox/defectCatalogId — giá trị hiện thực hóa khi máy thật đổ qua adapter Đợt 2. **Phát hiện drift:** `station_traces` bị thiếu trên dev/test DB dù ledger ghi đã apply (di chứng chuyển DB) — re-apply 0094 idempotent, đã xác minh.
> - **5.2 Vòng lặp repair (W5-B):** `defect_dispositions` (0183) 5 trạng thái + audit; chip "Đã kiểm lại OK/NG/NTF" theo serial khép mạch NG→disposition→sửa→kiểm lại; WO **link-only** tới maintenance WO (auto-tạo sẽ làm sai MTTR/MTBF — quyết định có căn cứ, ghi trong code); golden hiển thị trung thực trong compare dialog (router read-only mới; diff-vs-golden + capture + approval → Đợt 7.4).
> - **5.3 Andon TV (W5-C):** `/andon` full-screen (KPI canonical + tile máy/line + ticker andon, socket-first + poll 15s fallback, reload-on-stale safeguard, URL params kiosk/cycle/lines/factory/theme/warn/crit); **role default dashboard** (0184): cá nhân > role binding > mặc định, landingPath override cổng "/", admin UI tại /dashboard-templates.
> - **5.4 Export/BI/delivery (W5-D):** `/api/export/inspections|measurements.csv|.json` streaming (khung ngày bắt buộc ≤92d, scope `export:read`, audit đầy đủ); `/api/bi/datasets` 3 dataset + nextToken (**doc 30** kèm recipe Power BI); kênh giao báo cáo email/webhook-HMAC/in-app + retry backoff + dead-letter (`report_deliveries` 0185), đường email mặc định **không đổi byte-for-byte** (test chứng minh); UI kênh + drawer lịch sử giao.
> - **5.5 Polish 9/9 (W5-E):** pre-check trùng code debounce ở wizard; i18n + date-fns locale + semantic tokens + responsive grid (MachineStatusMonitor); `machine.listPaged` + search + bulk-approve (MachineRegistration); dialog thay `window.prompt`; print CSS toàn cục + nút In; **tile "FPY" ở Dashboard trước hiển thị final-yield tính client — giờ FPY thật từ server**; vá zh nits.
> - Nghiệm thu wave-lead: bổ sung **128 key zh** (khối W5-B/W5-D en/vi-only + 58 key backlog cũ của `reports`); deflake `reportScheduler.delivery.test` (vi.waitFor 1s default < 739ms baseline → 15s).
> - Tồn đọng: repair-station interface chuyên dụng (Đợt 7.6), diff-vs-golden wiring (7.4), BI endpoints không audit từng page (chủ đích — refresh Power BI sẽ spam audit_logs).

### Đợt 6 — Mobile chuyên nghiệp hóa (P0/P1/P2, ~3 agent)
| Hạng mục | Gap | Sản phẩm |
|---|---|---|
| 6.1 Đưa FactoryAlertSystem vào git (gỡ ignore, commit source, gỡ APK khỏi repo, xóa 7z 13.5GB), archive 2 app legacy | MB1, MB10, MB13 | Repo sạch + README định vị app chính |
| 6.2 Reliability nền: gọi FGS khi background (port pattern từ app legacy), sửa BootReceiver → foreground service | MB2, MB3 | Test doze/reboot trên thiết bị |
| 6.3 Config onboarding (bỏ IP hardcode), identity thật khi ack/resolve + role gating | MB4, MB5 | Màn hình first-run + auth wiring |
| 6.4 Escalation + ack-comment; TLS + auth cho download APK; signing bắt buộc, artifact tái lập | MB6, MB7, MB8 | Tính năng + hardening |
| 6.5 Tách god-files chính (StationDetailScreen…) + bổ sung test reconnect/notification | MB11, MB12, MB9 | Refactor + test |
| **Tiêu chí nghiệm thu** | | Build APK tái lập từ git sạch; tắt màn hình 30 phút vẫn nhận alert; reboot tự khởi động; ack ghi đúng user |

> **KẾT QUẢ THỰC THI ĐỢT 6 (2026-07-04, 3 agent):** ✅ Hoàn thành xanh — server tsc 0 + 359 file test/0 fail; app mobile jest 6 suite/102 test + tsc 0; migration 0186 applied.
> - **6.1 Source control (W6-A):** gỡ ignore — **132 file source track được** (grep-verify 0 APK/keystore/node_modules lọt); phát hiện + xử lý **nested `.git` 0-commit 172MB** (di dời scratchpad); **CRITICAL: mật khẩu ký release plaintext trong `gradle.properties`** — đã ignore, xác minh chưa từng commit → ⚠️ bạn cần backup keystore+mật khẩu ra secret manager; xóa 2 app prototype (git history giữ) + 7z 13,5GB (xác minh là self-archive) + APK rải → **giải phóng ~14,8GB**; README-REPO.md định vị. **2 việc tay khi commit:** chuyển `_deploy/FactoryAlertSystem-v1.0.13–15-release.apk` vào OTA store (bản duy nhất) + `git rm --cached uploads/mqtt-releases/*.apk`.
> - **6.2 Native reliability + build (W6-B):** FGS được gọi thật (AppState→background, gắn lifecycle MQTT, health-check sống dưới FGS, notifee dataSync type cho API 34); BootReceiver → HeadlessJsTaskService (Android 10+); NSC thay cleartext blanket (trung thực: NSC không hỗ trợ IP range — cleartext giữ cho LAN, TLS end-to-end sẵn sàng); token HMAC 15' cho download APK (fleet cũ qua `FACTORY_ALERT_DOWNLOAD_OPEN`, siết sau khi fleet ≥1.0.16); build release fail-loud nếu thiếu signing + artifact `FactoryAlertSystem-v1.0.16-release.apk` tái lập; 8 file Kotlin về đúng package. **Sửa kèm:** OTA client gọi `checkForUpdates()` không tồn tại (che bởi require untyped) — đã hiện thực; hạ tầng jest/tsc của app vốn hỏng — đã sửa.
> - **6.3 Config/identity/escalation (W6-C):** IP `192.168.8.7` + master key baked-in bị diệt (config null → onboarding first-run có test-connection, không bao giờ rơi về IP người lạ); ack/resolve gửi danh tính thật + viewer bị chặn (parity với web); ack-comment qua endpoint v2 additive + fallback 404 về legacy; **escalation engine**: rule theo severity/type + sweep 5' + **chống re-storm bằng atomic claim** (`UPDATE...WHERE escalatedAt IS NULL RETURNING`), fan-out MQTT retained + in-app + FCM, badge đỏ đậm + tab filter trên app (0186).
> - Tồn đọng: kiểm trên thiết bị thật (doze/reboot/FGS/gradle build — ngoài khả năng môi trường này); nút battery-optimization exemption chưa đặt vào Settings (helper đã export); web admin UI cho escalation rules (API-only); decompose StationDetailScreen 7.4k dòng (ghi chú 5 seam để lại).

### Đợt 7 — AI Vision khép kín vòng lặp (P0/P1, ~5 agent — bắt đầu sau Đợt 2, chạy song song được với Đợt 4–6)
| Hạng mục | Gap | Sản phẩm |
|---|---|---|
| 7.1 AI inline khi ingest: hook flag-gated `processQualityGate`/DL-head vào `submitInspection` + `aoiPackage.commit`; fallback NEEDS_REVIEW + circuit-breaker khi AI down; gắn canary/A-B vào chính đường này | V1, V5, V18 | Hook + config per máy/sản phẩm + test kill-AI-service |
| 7.2 Thu hoạch correction: bảng `measurement_corrections` (gốc/sửa/người/lý do) + feed `ai_label_queue` + dashboard agreement-rate/false-call trend theo máy + training export | V2 (+ cộng hưởng F2, M5) | Migration + API + mini-dashboard |
| 7.3 NTF/false-call predictor: chấm điểm khi ingest (heuristic Cpk/repeat-offender trước, model khi đủ label từ 7.2), sort hàng đợi verify + badge "khả năng báo giả" | V3, V10 (phần false-call) | Service + UI queue ưu tiên |
| 7.4 Luồng golden-diff production hoàn chỉnh: golden router + capture UI + approval workflow, lighting normalization, align-before-diff per-recipe, SuggestionsPanel có producer | V7, V8, V9, V11, V15 | Chuỗi golden→normalize→register→diff chạy thật |
| 7.5 Hạ tầng model: ship DINOv2 ONNX + GGUF đã validate, production profile flags, GPU micro-batching + backpressure, edge deploy verification (Step 5) | V4, V6, V19 | Runbook enablement + benchmark GPU RTX 5090 |
| 7.6 Nâng cao theo quyết định #7: SPI enrichment wiring hoặc giữ vendor pass-through, acquisition worker hoặc de-scope, validation corpus + Gage R&R, VLM re-run + đổ evidence ảnh vào advisor/inbox, auto-proposer 3 trigger mới, repair-station interface, Lab tools, dọn V22/V25 | V12–V17, V20–V25, V10 | Theo phạm vi được duyệt |
| **Tiêu chí nghiệm thu** | | Máy đẩy NG → verdict AI + điểm NTF tự động < 2s/board; correction của operator xuất hiện trong bảng corrections và feed label queue; golden-diff chạy với golden đã duyệt + ảnh đã normalize; `ab_test_results` có dữ liệu thật từ traffic inline; tắt AI service → kết quả route về NEEDS_REVIEW, không lỗi |

> **KẾT QUẢ THỰC THI ĐỢT 7 (2026-07-04, 5 agent):** ✅ Hoàn thành xanh — tsc 0, full suite 379 file pass/0 fail, migration 0187–0189 applied (0190 không cần).
> - **7.1 AI inline (W7-A):** hook async `setImmediate` sau ACK (test chứng minh ACK trả trước khi gate xong), write shape giống hệt đường on-demand, WAL replay cũng được gate; **circuit-breaker** 5-lỗi/60s → OPEN 2' → half-open probe, khi OPEN inspection nhận `NEEDS_REVIEW + {skipped:'ai_unavailable'}` trung thực; **canary tự có traffic thật** (test: seed experiment → dòng `ab_test_results` từ đường máy); `programReleaseId` stamping (0187 — đóng hạng mục hoãn Đợt 3); breaker state đã wire vào card health.
> - **7.2+7.3 Corrections + NTF (W7-B):** ledger `measurement_corrections` append-only (provenance source, snapshot ảnh) hứng từ correctResult + confirmNTF (hành vi cũ giữ nguyên có test) → feed `ai_label_queue` + training export thêm nguồn corrections; **NTF predictor heuristic v1 trung thực** (repeat-offender Laplace + biên dung sai + trend máy, all-null → NULL không bịa) → cột `ntfScore` (0188), sort hàng đợi + badge "Nghi báo giả %" (chỉ gợi ý); card agreement/false-call từ ledger; script backfill. Model train thật chờ ledger tích lũy label (hàng trăm cặp/loại máy).
> - **7.4 Golden-diff chain (W7-C):** capture (upload + từ điểm OK của inspection) → **duyệt SoD** (0189, grandfather bản cũ) → normalize flat-field → align `registerToReference` (per-golden toggle) → diff heatmap → hiển thị tại `/golden-samples` + InspectionDetail "So với golden"; **AISuggestionsPanel có producer** (analyzeWithAI ghi suggestion row — panel hết rỗng vĩnh viễn); VLM lỗi trả degraded thay 500 + cho phân tích lại. **Bonus fix:** sharp 0.34 âm thầm promote 1-channel→3-channel làm méo hình học heatmap/registration từ trước — pin `b-w`, chứng minh synthetic (gradient sáng: diff 0.39→~0.00 sau normalize).
> - **7.5 Model infra (W7-D):** **DINOv2 đã tải thật + validate trên model thật** (88,5MB, hash pin lock-file TOFU, weight gitignore; batch N=3 chạy đúng trên model thật); manifest 7 model (5 GGUF external presence-check); trạng thái model lên `db_feature_status` → card health; flag profile phased theo quyết định #6 (bắt được `AI_AUTO_PROMOTE_ENABLED` bật trái comment — đã tắt); GPU micro-batching + semaphore (**trung thực: CPU benchmark không nhanh hơn — lợi ích là hiệu ứng GPU-EP, chưa test trên 5090**); edge deploy fail-loud + verify sha256 + trạng thái verified ở Step 5.
> - **7.6 Giỏ nâng cao (W7-E):** seam `HeightMapSource` (vendor-passthrough + file-sidecar PNG16/CSV **thật hôm nay**, device stub chờ camera theo quyết định #7) + SPI enrichment wire vào visionAdapter/hot-folder; acquisition worker (grab→quality→ledger→submit NTF, admin start/stop); bộ **validation + Gage R&R AIAG average-and-range** chạy trên estimator thật (%GRR registration 0.7%, SPI 0.2% trên corpus synthetic — README hướng dẫn thả corpus PCB thật); evidence ảnh + mô tả VLM vào threshold approval + RCA đọc corrections; auto-proposer thêm 3 trigger (yield-drop→RCA, false-call-spike→review threshold, drift→maintenance WO) propose-only + cooldown 24h; V25 badge "Đề xuất bởi AI auto-tune".

---

## 13. TỔNG KẾT THỰC THI TOÀN KẾ HOẠCH (2026-07-04)

**7/7 đợt hoàn thành trong một phiên**, mỗi đợt nghiệm thu xanh trước khi sang đợt kế. Tổng cộng: **28 agent thực thi + 10 agent audit**, **18 migration mới (0172–0189, tất cả đã apply dev + test)**, test suite server tăng **308 → 379 file (0 fail)**, app mobile từ hạ tầng test hỏng → 102 test xanh + vào git, 4 doc mới (27/28/29/30), giải phóng ~14,8GB repo.

**11/11 điểm chặn P0 của audit đã đóng.** Các sửa lỗi thật phát hiện trong quá trình thực thi (ngoài phạm vi audit): 6 hàm analytics crash trên DB thật, `station_traces` thiếu dù ledger ghi applied, OTA client gọi hàm không tồn tại, sharp 1→3 channel làm méo registration, cột password MQTT chưa từng tồn tại, tham số `workshopId` bị bỏ qua lặng lẽ, MTTR/MTBF suýt bị làm sai bởi thiết kế WO ngây thơ.

### Việc còn chờ NGƯỜI (không chặn, theo thứ tự ưu tiên)
| # | Việc | Nguồn |
|---|---|---|
| 1 | **Backup keystore + mật khẩu ký** (`FactoryAlertSystem/android/gradle.properties` + `factory-alert-release.keystore`) ra secret manager — bản duy nhất, đã gitignore | Đợt 6 CRITICAL |
| 2 | **Review + commit** toàn bộ working tree (7 đợt chưa commit); khi commit: chuyển `_deploy/FactoryAlertSystem-v1.0.13–15-release.apk` vào `uploads/factory-alert-releases/` + `git rm --cached uploads/mqtt-releases/*.apk` | Đợt 6 |
| 3 | ~~Quyết định dữ liệu~~ ✅ **ĐÃ XỬ LÝ (2026-07-04, sau khi phân tích an toàn):** (a) 80 placeholder point-def tạo dưới model `__UNMAPPED__` (inactive) → 53.280 orphan = 0; (b) 7 nhóm workshop trùng đều là **clone seed rỗng** (0 máy/0 inspection, chỉ bản id nhỏ nhất có dữ liệu) → soft-deactivate 12 workshop + 24 line + 72 station clone (reversible); re-run 0180: **15/15 FK VALIDATED + 4/4 unique index built, 0 vi phạm** | Đợt 3 |
| 4 | Prod cutover TimescaleDB theo `scripts/migrate-to-timescaledb.md` (dev PG-Windows không host được — banner đang cảnh báo; hypertable đã smoke-test trong container) | Đợt 1 |
| 5 | Kiểm thiết bị thật: doze/reboot/FGS/gradle build APK v1.0.16; đặt nút battery-optimization vào Settings (helper đã export) | Đợt 6 |
| 6 | Kiểm hiện trường: hot-folder trên SMB share thật; thu **file xuất thật** I.C.T/Saki/Mirtec thả vào `vision/adapters/__fixtures__/`; corpus PCB thật cho Gage R&R; benchmark GPU-EP trên RTX 5090; tune ngưỡng golden-diff (25/0.6) | Đợt 2/7 |
| 7 | Chọn camera structured-light cho height-map native (seam sẵn, bind qua `registerHeightMapSource`) | Quyết định #7 |
| 8 | ~~Phạm vi kế tiếp~~ ✅ **ĐỢT 8 ĐÃ THỰC THI (2026-07-04, 3 agent + W8-D, xanh):** thi công toàn bộ doc 29 + các UI tồn đọng + **decompose StationDetailScreen 7.499 → 1.013 dòng** (refactor thuần di chuyển theo 5 seam, dep-array hiệu ứng giữ byte-identical, app jest 6→10 suite / 102→143 test, tsc 0 cả app lẫn repo). **KHÔNG còn hạng mục dev nào từ audit/doc 29.** | Doc 29 |

> **KẾT QUẢ THỰC THI ĐỢT 8 — MỞ RỘNG (2026-07-04, 3 agent):** ✅ tsc 0 (web + mobile), server 389 file/4.242 test/0 fail, app 102 test, migration 0191–0192 applied.
> - **8.1 Component library + capabilities (W8-A, doc 29 §a+§d):** `component_packages`/`component_footprints` + **44 package SMT chuẩn IPC-7351 seed** (kèm polarity + ghi chú inspection); link `materials.packageId` + backfill; `measurement_point_defs.componentCode/refDesignator`; trang `/component-library`; **Pareto toggle thứ 3 "Theo package linh kiện"** (bucket UNLINKED + phân tích lý do); validation capabilities 2 tầng mềm theo deviceTypes (máy chưa khai = skip trung thực, enforce sau flag) + drift scan tuần + badge MachineCockpit.
> - **8.2 Panel multi-up + operator badge (W8-B, doc 29 §b+§c):** `product_panel_defs/boards` + transform panel→board (rotation/mirror test hand-computed); heatmap mode `panelBoard` (Pareto per-board + unassigned trung thực); cột hypertable hoãn từ doc 29: `boardIndex/operatorUserId/panelSerial` (0192); `operator_badges` resolve theo cửa sổ thời gian (re-issue đóng cửa sổ cũ — quá khứ resolve đúng người cũ), ingest stamp fail-open + auto-ghi badge lạ; dialog Panel N-up tại /products + trang `/operator-badges`; adapter st4i emit panelId/boardIndex end-to-end.
> - **8.3 Repair-station + UI tồn đọng (W8-C):** trang **`/repair-station`** chuyên dụng (scan serial → lỗi + ảnh + IPC + mô tả VLM → chuyển trạng thái 1 chạm, 4 lane FIFO, stats strip repaired/avg-time/backlog, RBAC maintenance/operator, kiosk); **web UI escalation rules** (tab trên /mqtt-alerts: CRUD + activity ledger); mobile: mục "Chạy nền & pin" trong Settings (keep-alive toggle + miễn trừ pin — đóng tồn đọng W6-B); panel Acquisition workers trên EquipmentIntegration (đóng tồn đọng W7-E). Không cần migration 0193.
> - Nghiệm thu wave-lead: 3 test timeout-flake vá (statistics.kpi, worker.smoke, vda5050 — suite phình 308→390 file làm test ~5s vượt ngưỡng mặc định dưới tải; nới 20s có comment).

### Tổng hợp lộ trình

| Đợt | Trọng tâm | Gap xử lý | Ước lượng |
|:---:|---|---|---|
| 1 | Nền dữ liệu + số liệu đúng | R1–R3, A1–A4, A8, F1, B2… | ~5 agent, 1 phiên |
| 2 | Máy thật khép kín | C1–C7 chuỗi hoàn chỉnh | ~5 agent, 1 phiên |
| 3 | Toàn vẹn + quản trị | M1–M14 phần lớn | ~4 agent, 1 phiên |
| 4 | Hiệu suất + vận hành | B1–B12, A7, R10 | ~4 agent, 1 phiên |
| 5 | Phân tích pro + QC loop | A5–A12, F2–F12 | ~4 agent, 1 phiên |
| 6 | Mobile pro | MB1–MB13 | ~3 agent, 1 phiên |
| 7 | AI vision khép vòng lặp | V1–V25 (3 P0 tại 7.1–7.3) | ~5 agent, 1–2 phiên |

Phân bổ 11 P0: Đợt 1 đóng R1/R2/A1/A2 + F1; Đợt 2 đóng C1/C2/C3; Đợt 6 đóng MB1 (có thể kéo lên Đợt 1 — chỉ là thao tác git); Đợt 7 đóng V1/V2/V3. Đợt 7 phụ thuộc Đợt 2 (đường ingest ổn định) nhưng 7.2 (bảng corrections) có thể làm ngay từ Đợt 3 nếu muốn tích lũy label sớm.

### Quyết định — ĐÃ CHỐT 2026-07-04

| # | Quyết định | Giá trị đã chốt | Ghi chú triển khai |
|---|---|---|---|
| 1 | Chiến lược partition | **Bắt buộc TimescaleDB cho cả inspection** | ⚠️ Lưu ý kiến trúc: KHÔNG tách `product_inspections`/`measurement_results` sang container 5433 riêng — mọi query phân tích join với master data (machines, point defs, defect catalog) sẽ gãy vì Postgres không join xuyên server. Triển khai đúng ý định: **đưa extension `timescaledb` vào DB chính** (image `timescale/timescaledb-ha` có sẵn cả pgvector) → hypertable + join sống chung một DB, migration 0118 hết no-op. Migration mới sẽ **fail loudly** nếu extension vắng mặt (không guard-im-lặng như 0118). Container 5433 giữ vai trò hiện tại (energy/ot_telemetry) đến khi hợp nhất. |
| 2 | Retention mặc định | **12 tháng cho tất cả** (raw inspection, ảnh, log) | `DATA_RETENTION_ENABLED=true` prod profile; Timescale `add_retention_policy` 12 tháng; job lifecycle ảnh xóa object cùng nhịp prune row |
| 3 | Vendor ưu tiên Đợt 2.2 | **I.C.T AOI, Saki AOI, Mirtec PCB** + máy Trung Quốc custom | Máy custom theo hướng: **công bố "ST4I Standard Inspection Feed Spec"** (CSV/XML/JSON chuẩn hệ thống) để vendor custom xuất theo — dựa trên generic-json adapter + tài liệu hóa; 3 vendor kia cần thu file xuất thật để làm golden-file test |
| 4 | NTF trong yield | **NTF = pass ở final yield, loại khỏi FPY** (chuẩn SMT) | Helper KPI canonical áp cho mọi màn hình/API/MV |
| 5 | Blob storage | **Local FS + lifecycle (32TB local)** | Không MinIO/S3; cần lifecycle job + monitoring dung lượng + cảnh báo ngưỡng 80% |
| 6 | AI inline + GPU | **RTX 5090 local** phục vụ inference | Bật đủ 3 gói theo lộ trình Đợt 7: quality-gate verdict → NTF predictor → anomaly; micro-batching sizing theo 5090 32GB |
| 7 | 3D/IR depth | **Đầu tư nguồn height-map native** (structured-light/point-cloud) | V12/V13 nâng từ "tùy chọn" → cam kết trong Đợt 7.6; cần chọn phần cứng camera (structured-light) — hạng mục có phụ thuộc phần cứng, thiết kế seam `ImageSource`/height-map trước, bind thiết bị sau |

---

## 12. Những gì KHÔNG cần làm (đã tốt, giữ nguyên)
- Recipe workflow (SoD + atomic deploy + genealogy) — mẫu chuẩn để nhân bản sang program approval (Đợt 3.4).
- Driver fieldbus OT + MTConnect + Sparkplug — production-grade.
- Outbox ERP (chỉ cần SKIP LOCKED khi scale ngang — R9, gộp Đợt 4).
- InspectionDetail defect-verify UX, DrillDownDashboard, custom dashboard engine.
- OTA mobile DB-versioned + MQTT push update.
- Index composite trên bảng nóng + cursor pagination + graceful shutdown.
- **RCA Copilot** (đa nguồn evidence + VLM + causal graph + HITL) và **Threshold Advisor/auto-tune** (thống kê đúng bài, propose-only) — chỉ cần bổ sung evidence ảnh (V20), không cần làm lại.
- AI chat read-tools trên dữ liệu inspection thật + KB domain AOI (doc 11 đã vá).
- Thuật toán sub-pixel registration + bộ test chính xác, toán SPI 3D IPC-7527, PatchCore anomaly bank — chất lượng code tốt, chỉ cần **nối dây** (Đợt 7), không cần viết lại.
- Posture an toàn của vision→control loop (HITL propose-only, chặn khi chưa commissioned) — giữ nguyên nguyên tắc khi mở rộng.

---

*Doc 27 · Tạo bởi audit 10-agent (7 lớp nghiệp vụ + 3 mảng AI vision) 2026-07-04 · ĐÃ DUYỆT cùng ngày với 7/7 quyết định chốt ở §11 · Đợt 1 bắt đầu thực thi 2026-07-04.*
