# Nhóm C — Khảo sát backlog "CHỜ DUYỆT" của 7 tài liệu audit (2026-06 → 2026-07-17)

**Ngày đo:** 2026-08-12/13 · **Nhánh:** `feat/hmi-dep` · **HEAD:** `d784618d`
**Loại lượt:** CHỈ ĐO — không sửa mã, không DDL, không migration, không đổi cờ/quyền/dữ liệu.
**Máy chủ sống:** PID **15052** (nhận diện theo cổng: `Get-NetTCPConnection -LocalPort 3000 -State Listen` → `OwningProcess=15052`), khởi động **2026-08-13 10:17:11**, chạy `dist/index.js` build lúc **10:02** cùng ngày ⇒ **bản build đang chạy MỚI hơn mọi thay đổi mã của chín pha**.

---

## 0. Kết luận một dòng

> **Danh sách tám tuần tuổi đã lệch nặng — nhưng lệch theo hướng NGƯỢC với dự đoán.**
> **5/5 P0** (4 của doc 51 + 1 của doc 42) **ĐÃ ĐƯỢC VÁ HẾT**, phần lớn bởi chính các đợt thực thi được ghi ngay trong các tài liệu đó mà **chỉ mục ghi nhớ không cập nhật**. Cái còn thật **không phải lỗ hổng**, mà là **ba lớp khác**: (a) **tính năng đã xây xong nhưng cờ vẫn TẮT**, (b) **quyết định RBAC còn treo ở chủ dự án**, (c) **việc phần cứng / tài khoản ngoài tầm phần mềm**.

**Cảnh báo phân loại quan trọng nhất:** doc 51, doc 42, doc 55, doc 32, doc 16 đều **TỰ KHAI ĐÃ THỰC THI XONG ngay trong thân tài liệu** (§10/§11 của 51, "Đợt 0 ✅ 2 P0" của 42, "§0-bis/§0-ter ĐÃ THỰC THI" của 55, "✅ HOÀN THÀNH TOÀN BỘ R0–R5" của 32, "ⓘ CẬP NHẬT TRẠNG THÁI THỰC THI 2026-07-01" của 16). **Backlog "CHỜ DUYỆT" trong chỉ mục ghi nhớ được chép từ phần TÓM TẮT ĐẦU tài liệu, không phải từ phần trạng thái.** Tôi vẫn đo độc lập từng mục thay vì tin lời tự khai — kết quả bên dưới là **phép đo**, không phải trích dẫn tài liệu.

---

## 1. BẢNG PHÂN LOẠI ĐẦY ĐỦ

Ký hiệu ô: **CÒN THẬT** · **ĐÃ VÁ** · **KHÔNG CÒN NGHĨA** · **KHÔNG ĐO ĐƯỢC**
Khối lượng: **nhỏ** (một lượt agent) · **vừa** (một pha) · **lớn** (nhiều pha, kế hoạch riêng)

### 1.1 — DOC 51 · 4 P0 (ưu tiên cao nhất)

| # | Mục | Ô | Bằng chứng đo được | K.lượng |
|---|---|---|---|---|
| 51-P0-1 | **`config` public trả apiKey plaintext** (R1) | **ĐÃ VÁ** | **Nghiệm thu SỐNG** trên PID 15052: `GET /api/trpc/machine.config?input={"json":{"serialNumber":"SIM-0001"}}` (máy #247, `registrationStatus=approved`) → **HTTP 200**, thân trả `"apiKey":null,"requiresClaim":true`. Mã: `server/routers/hierarchyRouters.ts:884-886` (`apiKey: legacyExposure ? machine.apiKey : null`), cửa hậu `machineConfigExposesApiKey()` `:654` đọc `MACHINE_CONFIG_EXPOSE_APIKEY === "true"`; cờ **VẮNG khỏi `.env`** ⇒ OFF. | — |
| 51-P0-2 | **`product_inspections` không unique** (R2) | **ĐÃ VÁ** | `psql … -c "SELECT indexname,indexdef FROM pg_indexes WHERE tablename='product_inspections'"` → **`uq_inspections_machine_serial_time` UNIQUE INDEX ON (machineId, serialNumber, inspectionTime) WHERE serialNumber::text <> ''::text`** — **trùng khít** đơn thuốc doc 51 §12.1. (22 index tổng, `.unique()` không còn 0 match.) | — |
| 51-P0-3 | **MQTT không ACL** (R3) | **ĐÃ VÁ** | `server/services/mqttService.ts:1459` `aedes.authorizePublish = …`, `:1474` `aedes.authorizeSubscribe = …` (**dòng mã thật, không phải bình luận** — 4 match còn lại ở `:4/:28/:560/:590` ĐÚNG là bình luận, đã loại). Cờ: `mqttTopicAclEnabled()` `:629-632` **mặc định TRUE**, `mqttTopicAclWarnOnly()` `:635-638` mặc định FALSE; cả hai **vắng khỏi `.env`** ⇒ **ĐANG CƯỠNG CHẾ THẬT**. Lưới độc lập: `npx vitest run server/mqttTopicAcl.test.ts` → **1 file passed / 60 tests passed / 0 fail** (PIPESTATUS=0, **có số ca thật, không phải "no tests"**). | — |
| 51-P0-4 | **Điểm-đo không bump `pointsConfigVersion`** (R4) | **ĐÃ VÁ** | `bumpAndNotifyPointsConfig` (`server/routers/productRouters.ts:89`) gọi tại **6 chỗ**: `:1197` (trong `create` 1024-1226), `:1459` (trong `update` 1226-1529), `:1540` (`backfillComponentCodesFromBom`), `:1641` (`uploadCroppedImage`), `:1725` (`remapUnmapped`), `:3851` (CAD applyJob). **`delete` (1564-1609)** bump ở **tầng DB trong cùng transaction** — `db.deleteMeasurementPointDef` → `server/db/product.ts:2107` `bumpPointsConfigVersion(productModelId, tx)`, cùng nơi đóng dấu `deletedAtVersion` (bình luận `:1568-1571` nêu rõ "hai cái không được phép lệch nhau"). ⇒ **create/update/delete đều bump**. | — |

**Dư lượng đo được của doc 51 (KHÔNG phải P0, nhưng phát sinh từ chính phép đo trên):**

| # | Mục | Ô | Bằng chứng | K.lượng |
|---|---|---|---|---|
| 51-r1 | **16/41 máy còn giữ apiKey PLAINTEXT at-rest** | **CÒN THẬT** (vệ sinh, KHÔNG phải lỗ xác thực) | `SELECT count(*) FILTER (WHERE "apiKey" IS NOT NULL) FROM machines` → **16/41**; mẫu: `machines.apiKey` = `sim-sim-l1…` (đọc được nguyên văn). **NHƯNG** `.env:652 MACHINE_SHARED_KEY_ALLOWED=false` → `parseWeakAuthPolicy` (`machineAuthService.ts:129`) ánh xạ `"false"` → **`"deny"`** ⇒ **khoá yếu này KHÔNG xác thực được nữa**. Bước cuối của runbook doc 52 ("finally clear `machines.apiKey`") **chưa chạy**. | **nhỏ** |
| 51-r2 | **MQTT admission gate còn ở chế độ CHỈ-CẢNH-BÁO** (doc 51 P1 §5.3) | **CÒN THẬT** (cố ý, chờ chủ dự án bật) | `mqttAdmissionEnforce()` `mqttService.ts:663-666` **mặc định FALSE**; `MQTT_ADMISSION_ENFORCE` **vắng khỏi `.env`** ⇒ thiết bị `approvalStatus≠APPROVED` **vẫn vào được luồng dữ liệu nghiệp vụ**, chỉ bị gắn cờ + ghi log. Bình luận `:650-653` khai đúng đây là lựa chọn QĐ#1. | **nhỏ** |
| 51-r3 | `machines` **không có** partial-unique `uq_machines_code_active` như doc 51 §4 khoe | **CÒN THẬT** (lời khai của tài liệu sai, không phải mã sai) | `\d machines` → chỉ có `idx_machines_code` **btree THƯỜNG** (không unique) + `machines_apiKey_unique`. **Không tồn tại** `uq_machines_code_active`. Doc 51 §4 mục 5 tự nhận là "điểm mạnh đã có". | **nhỏ** (chỉ cần đính chính tài liệu, hoặc thêm index nếu muốn hành vi đó) |

> ⚠ **Ghi chú lệch schema phát hiện lúc đo:** doc 51 nhắc `machineCode` / `approvalStatus` trên bảng `machines`; DB thật dùng **`code`** và **`registrationStatus`** (`\d machines`). Mọi câu truy vấn chép từ doc 51 sẽ **lỗi cột** ngay.

### 1.2 — DOC 42 · P0

| # | Mục | Ô | Bằng chứng đo được | K.lượng |
|---|---|---|---|---|
| 42-P0-2 | **`UPDATE` hỏng 10 tab — `EntityDialog` null vs zod** | **ĐÃ VÁ** | **Phía client** `client/src/pages/MasterDataManagement.tsx:242-265` — `submit()` nay **chỉ gom key khai trong `fields[]`** (`for (const f of fields)`), **`if (val === null \|\| val === "") val = undefined;`**, ép `Number` cho `type==="number"`, và **khoá ô `code` khi edit** (`isLocked`, `:240`). Đúng nguyên văn đơn thuốc A1/0.1 của doc 42. **Phía server** `server/routers/masterDataRouter.ts` — **51 lần `.nullish()`**, phân bố đúng trên các *update schema* (`:309, :474, :563, :667, :732, :815, :856`…) trong khi *create schema* giữ `.optional()` (`:260, :287, :376, :450`…). | — |
| 42-P0-1 | **Nút "Thêm" `/products` no-op (PermissionGate nuốt props Radix `asChild`)** *(đo kèm — cùng mức P0)* | **ĐÃ VÁ** | `client/src/components/PermissionGate.tsx` — hàm **`mergeSlotProps(childProps, slotProps)`** hợp nhất handler `on[A-Z]` (gọi child rồi slot), `className`, `style`; khối chú thích ngay trên **gọi đích danh "(doc 42 P0-1)"**. | — |

> **KHÔNG ĐO ĐƯỢC phần sống của 42-P0-2:** muốn bấm Lưu thật trên `/master-data` phải có phiên `engineer1`. `engineer1` (#51) có `users.two_factor_enabled = t`; hạt giống nằm ở **`user_secrets."twoFactorSecret"`** (bảng riêng — `users` **không còn** cột 2FA nào ngoài `two_factor_enabled`), và **tôi không có giá trị 10 mã dự phòng**. ⇒ Bằng chứng ở trên là **mã + schema**, không phải một lượt PATCH sống. Xem §4.

### 1.3 — DOC 55 · 3 mục + 14 quyết định

| # | Mục | Ô | Bằng chứng đo được | K.lượng |
|---|---|---|---|---|
| 55-QĐ | **14 quyết định "chờ duyệt"** | **KHÔNG CÒN NGHĨA** | Câu hỏi đúng là *"còn là việc cần làm không?"* — **Không.** §6 của chính doc 55 đã **đóng dấu từng quyết định** (`§6 — Chốt quyết định (user duyệt)`, mỗi mục có ✔ hoặc giá trị chốt: PA-A ✔, ép similarity kể cả ≥3 ⚠, ngưỡng 5.0px ✔, fan-out bump ✔, deprecate nhãn cũ ✔, variantCode vào MQTT ACL ✔…). §0-bis/§0-ter liệt kê **10 commit** đã thực thi theo đúng các chốt đó. | — |
| 55-1 | **Image single-tx** | **ĐÃ VÁ (đã xây) — nhưng CÒN THẬT ở chỗ CHƯA BẬT** | Mã có: `server/routers/machineApiRouters.ts:1456` `const singleTxOn = envTrue(process.env.INSPECTION_SINGLE_TX_ENABLED)`. Cờ **`INSPECTION_SINGLE_TX_ENABLED` VẮNG khỏi `.env`** ⇒ **OFF** ⇒ đường chạy thật **vẫn là `createProductInspection` cũ**, khe crash "header rỗng" **chưa đóng trong sản xuất**. | **vừa** |
| 55-2 | **Fiducial affine registration** | **ĐÃ VÁ (đã xây) — CHƯA BẬT** | `machineApiRouters.ts:326` `envTrue(process.env.MACHINE_FIDUCIAL_REGISTRATION)`. Cờ **vắng khỏi `.env`** ⇒ OFF ⇒ `resolveCoordinates` vẫn chỉ scale theo độ phân giải (CASE #11 **vẫn hở trong sản xuất**). | **vừa** |
| 55-3 | **Product-variant** | **ĐÃ VÁ (đã xây, có DDL) — CHƯA BẬT** | DDL **đã chạy thật**: `information_schema.tables` có **`product_variants`** và **`variant_point_overrides`**. Mã: `machineApiRouters.ts:361` + `productRouters.ts:129` đọc `PRODUCT_VARIANT_ENABLED`; cờ **vắng khỏi `.env`** ⇒ OFF. | **vừa** |
| 55-4 | Hoãn nhỏ đã ghi trong doc: fiducial Phase P3 (runtime defect-bbox) · UI "thêm điểm riêng cho variant" · snapshot-gate × variant-override không track lịch sử override | **CÒN THẬT** (tài liệu tự khai, tôi không đo phủ định được) | doc 55 §0-ter "CÒN HOÃN (nhỏ, ghi rõ)". Cả ba nằm **sau cờ OFF** ⇒ chưa chạm sản xuất. | **nhỏ**–**vừa** |

### 1.4 — DOC 40 · Wave 4–6

| # | Mục | Ô | Bằng chứng đo được | K.lượng |
|---|---|---|---|---|
| 40-W4a | Module devices (OEE thành tab DeviceHub, MachineCockpit tab Bảo trì…) | **ĐÃ VÁ** | `client/src/pages/DeviceHub.tsx:36` — chú thích **"doc 40 DEV-10 — OEE & Downtime là tab thứ 4 (trước là /oee-dashboard riêng; nay redirect vào ?tab=oee)"**, `:29-30` lazy-import `OEEDashboardContent`. `client/src/pages/MachineCockpit.tsx:487-491` — khối **"MAINTENANCE — the per-machine maintenance MEMORY (doc 40 §5-6, persona Hùng)"** nối `maintenance.listWorkOrders` / `listPartsForWorkOrder`. | — |
| 40-W4b | Module engineering — CodeMirror 6 | **ĐÃ VÁ** | `package.json:59-61` `@codemirror/legacy-modes ^6.5.3`, `@codemirror/state ^6.7.1`, `@codemirror/view ^6.43.6`; `:105` `@uiw/react-codemirror ^4.25.11`. Khớp QĐ **D4** của doc 40 ("CodeMirror 6 trước"). | — |
| 40-W4c | Persona features — **OEE theo LINE** + **CMMS mini hub** | **ĐÃ VÁ** | OEE-theo-LINE: `server/services/warRoomService.ts:139` `const lineOee = await getLineOEE({factoryId, from, to})` + `client/src/components/controlTower/panels.tsx:478` panel `controlTower.lineOee.title` ("OEE by line"). CMMS: bảng thật trong DB — **`maintenance_schedules`, `maintenance_work_orders`, `spare_parts_inventory`, `work_order_parts`, `pm_effectiveness_metrics`** + router `server/routers/maintenanceScheduleRouter.ts`. | — |
| 40-W5 | Mở rộng độ phủ thiết bị: **SLMP · CFX · IO-Link · SCPI** | **ĐÃ VÁ** | SLMP (ưu tiên 1): `server/services/ot/drivers/mitsubishiMcDriver.ts` + `mcAddress.ts`. CFX: `server/services/cfx/cfxClient.ts` (+ `.test.ts`). IO-Link: `server/services/iolink/index.ts` (+ `ioLinkProfile.test.ts`). SCPI: `server/services/instruments/scpiAdapter.ts` (+ `.test.ts`). | — |
| 40-W5b | **Hermes board-flow** | **CÒN THẬT** | Quét `server/services/` + `server/drivers/` cho `hermes` → **0 file**. Nhưng chính doc 40 QĐ **D5** đã chốt *"Hermes chờ line thật"* ⇒ **owner-gated, không phải nợ kỹ thuật**. | **vừa** (khi có line thật) |
| 40-W6a | **Timescale cutover** ("điểm nghẽn ghi số 1") | **CÒN THẬT** | `.env:278` ghi thẳng: *"Disabled: no `tsdb` role / `avi_aoi_ts` DB / timescaledb extension on this PG"*; `:281` *"this main PG has NO timescaledb extension"*; `:284` *"DURABLE follow-up: install timescaledb + re-apply migrations 0172/0173 to convert"*. | **lớn** |
| 40-W6b | **FIREBASE_\* cho FCM push** | **CÒN THẬT** | `grep FIREBASE .env` → **0 dòng**. | **nhỏ** |
| 40-W6c | **Tắt `LICENSE_BYPASS` sau khi cấu hình SKU thật** | **CÒN THẬT** | `.env:111` **`LICENSE_BYPASS=true`** — vẫn đang bật trên môi trường chạy. | **nhỏ** |
| 40-W6d | **Zmotion: `npm i koffi` + `zauxdll.dll` + `ZAUXDLL_PATH`** | **CÒN THẬT** | `grep '"koffi"' package.json` → **0**; `grep ZAUXDLL_PATH .env` → **0**. | **nhỏ**–**vừa** |
| 40-W6e | **Commit `FactoryAlertSystem` vào git** | **ĐÃ VÁ** | `git ls-files FactoryAlertSystem \| wc -l` → **167 file được theo dõi**; commit gần nhất chạm thư mục: `6b1dc5db` (2026-07-12). | — |
| 40-W6f | **HW-FAT bench (1 PLC mỗi họ, rút cáp/reboot/DB-down/failover)** · **Safety PLC (Pilz/Sick)** · **app-server HA** | **KHÔNG ĐO ĐƯỢC** | Cần **phần cứng vật lý** (PLC thật, Safety PLC, cặp máy chủ standby) — không tồn tại trên máy này. Xem §4. | **lớn** |

### 1.5 — DOC 32 · 5 wave

| # | Mục | Ô | Bằng chứng đo được | K.lượng |
|---|---|---|---|---|
| 32-a | **`POST /api/external/reports/generate` là STUB** | **ĐÃ VÁ** | `server/_core/index.ts:2689` chú thích *"build a REAL report file, returns downloadUrl"*, `:2698` `app.post("/api/external/reports/generate", validateExternalAuth, …)`, `:2704` `await import("../services/externalReportService")`. Dịch vụ **có thật, không rỗng**: `server/services/externalReportService.ts:601` `generateExternalReport()` — validate `reportType` (7 loại + alias cũ), **tôn trọng `format` pdf/xlsx/csv** (`:612-615`), `locale`, cửa sổ thời gian, rồi `buildReportData(...)` `:625`. Lưu trữ bền: bảng **`report_artifacts` tồn tại trong DB**. | — |
| 32-b | **`universalExportService` là mã chết (không wire)** | **ĐÃ VÁ** | **6 nơi import thật** (đã loại `.test.`): `server/api/export/exportRouter.ts:44` · `server/routers/annotationComparisonRouter.ts:18` · `server/routers/dataRouters.ts:600` (`await import`) · `server/services/externalReportService.ts:33` · `server/services/masterDataIO.ts:21` · `client/src/lib/serverReportExport.ts:4`. | — |
| 32-c | **Rủi ro font tiếng Việt** | **CÒN THẬT** — nhưng **CHỈ Ở ĐƯỜNG TRIỂN KHAI**, không phải trên máy này | Đo 4 nhánh: ① `server/assets/fonts/` **CÓ** `BeVietnamPro-Regular.ttf` (132.948 B) + `-Bold.ttf` + `NotoSansSC-*`. ② **Build KHÔNG chép font**: `package.json:10` `"build"` chỉ `vite build` + 3 lệnh `esbuild` + `copyFileSync('server/license/sdk/index.cjs','dist/index.cjs')` + `mkdirSync('uploads/mqtt-releases')` — **không có bước nào chạm `server/assets/fonts`**. ③ `find dist -iname "*.ttf"` → **chỉ ra font KaTeX của client** (`dist/public/assets/KaTeX_*`), **0 file BeVietnamPro**. ④ `FONT_ASSETS_DIR` **vắng khỏi `.env`**. **Vì sao vẫn chạy được ở đây:** `server/services/fontAssets.ts` `fontDirCandidates()` có nhánh dự phòng `join(process.cwd(), "server", "assets", "fonts")`; tiến trình 15052 chạy `node dist/index.js` bằng **đường dẫn TƯƠNG ĐỐI** ⇒ `process.cwd()` bắt buộc là thư mục chứa `dist/` = gốc repo ⇒ cây nguồn có mặt ⇒ tìm thấy font. **Một triển khai chỉ-ship-`dist` sẽ KHÔNG có nhánh dự phòng nào** và `fontAssets` được thiết kế **FAIL LOUD** (chú thích `:19-21`) ⇒ **báo cáo PDF chết hẳn, không mojibake âm thầm**. | **nhỏ** |
| 32-d | Việc-chờ-người còn lại của doc 32: **bật `OEE_SNAPSHOT_ENABLED=true`** | **CÒN THẬT** | `grep OEE_SNAPSHOT .env` → **exit 1, 0 dòng**. Mã có đủ họ cờ (`OEE_SNAPSHOT_ENABLED`, `_HOURLY_CRON`, `_DAILY_CRON`, `_TZ`, `_MAX_MACHINES`) nhưng **không cờ nào được đặt** ⇒ OEE report thiếu dữ liệu liên tục. | **nhỏ** |
| 32-e | Việc-chờ-người: verify thị giác PDF/HTML trên browser thật · đặt logo/branding công ty | **KHÔNG ĐO ĐƯỢC** | Cần **mắt người chấm** bản PDF in ra (dấu tiếng Việt, phân trang, rasterize recharts) + **tài sản thương hiệu của chủ dự án**. | **nhỏ** |

### 1.6 — DOC 16 · 12 pha

| # | Mục | Ô | Bằng chứng đo được | K.lượng |
|---|---|---|---|---|
| 16-sw | **12 pha (R0·G1·G2·S1·S2·T1·T2·D1·E1·I1·X1·F1) như một backlog "chờ duyệt"** | **KHÔNG CÒN NGHĨA** | Câu hỏi đúng: *"còn là việc cần làm không?"* — **Không, phần mềm đã làm.** Đối chứng độc lập (không dựa lời tự khai của doc): **bảng thật trong DB** — `tasks` (G1), `zones` (G1), `safety_events` (S1), `operator_assignments` (S1), `skills` (G2), `device_types` (E1), `program_symbols` (D1), `machine_sensor_readings` (R0), `oee_metrics`, `production_sessions`, `shift_configs`. **Cờ BẬT THẬT trong `.env`**: `:558 FOE_ENABLED=true` · `:585 PDM_SENSOR_INGEST_ENABLED=true` · `:586 WORKFORCE_ENABLED=true` · `:587 SAFETY_AUDIT_ENABLED=true` · `:589 EQ_GOVERN_ENABLED=true` · `:592 EQ_INTEG_ENABLED=true` · `:596 FLEET_ORCH_ENABLED=true` · `:603 DPC_IR_V2_ENABLED=true` · `:719 TWIN_LIVE_ENABLED=true`. | — |
| 16-off | **4 pha có mã nhưng cờ TẮT**: `SAFETY_ZONE` · `SIM_PHYSICS` · `FIELD_V2` · `ERP_INBOUND` | **CÒN THẬT** (chưa kích hoạt) | Mã tồn tại: `server/routers/safetyRouter.ts` · `server/services/programming/ir/irAdapter.ts` · `server/routers/fieldRouter.ts` · `server/api/v1/erpIntake.ts`. **Cả 4 cờ đều 0 dòng trong `.env`** ⇒ OFF. (`SAFETY_ZONE` vốn **cần phần cứng** theo chính bảng §15 của doc 16.) | **vừa** (3 cờ phần mềm) |
| 16-hw | **S2 rated-stop SIL + UWB/LiDAR · FOCAS Fwlib32 · EtherCAT real-time · export YOLO `.onnx` · hiệu chuẩn camera · commissioning** | **KHÔNG ĐO ĐƯỢC** | Cần **phần cứng + thư viện vendor có bản quyền + hiện trường**. Chính doc 16 (2026-07-01) đã tự khoanh: *"Chỉ còn phần cứng bất khả-thay-bằng-phần-mềm"*. | **lớn** |

### 1.7 — DOC 50 · RBAC Part-B

| # | Mục | Ô | Bằng chứng đo được | K.lượng |
|---|---|---|---|---|
| 50-B | **~55 candidate Part-B chờ chủ dự án duyệt** | **CÒN THẬT — đã trả một phần** | Đo đích danh từng thủ tục (đọc **dòng khai gate**, không đếm từ khoá): <br>**ĐÃ MIGRATE (ngoài Part A):** `dataRouters` **8 thủ tục import** — `importFactories/Workshops/Machines/Lines/Stations/Workstations` → `requirePermission("settings_factory","canCreate")`, `importProducts` → `settings_products`, `importMeasurementPoints` → `settings_measurement_points`; `productRouters.importList` → `requirePermission("settings_products","canCreate")`. <br>**CÒN NGUYÊN `adminProcedure`:** `productionRouters`: `applyScheduleRun` · `generateScheduleRun` · `generateApsScheduleRun` · `dismissScheduleRun` — `dataRouters.exportStatistics` — `productRouters`: `backfillImageDimensions` · `backfillComponentCodesFromBom` · `remapUnmapped` · `uploadCroppedImage` · `fiducialMarkRouter.create` (`:2126`) · `.update` (`:2172`) — `notificationRouters`: `sendToUser` · `broadcast` — `enhancedAuditRouter`: `list` · `stats` · `exportCsv`. <br>**Tổng còn lại theo router:** `productRouters` **47** `adminProcedure`, `mqttClientManagementRouter` **19**, `enhancedAuditRouter` **8**, `notificationRouters` **3**, `dataRouters` **3**. | **vừa** |
| 50-B2 | Bước kế tiếp #2 — **CI lint cấm `adminProcedure` mới ngoài allowlist** | **CÒN THẬT** | Quét `scripts/`, `.github/`, `eslint.config*` cho `adminProcedure` + (lint\|allowlist\|forbid) → **0 match**. | **nhỏ** |
| 50-B3 | Bước kế tiếp #3 — **`RBAC_SCOPED_ADMIN=true` ở staging** | **CÒN THẬT** | `grep RBAC_SCOPED_ADMIN .env` → **0 dòng** ⇒ chưa bật; admin vẫn god cross-tenant trên môi trường này. | **nhỏ** |

### 1.8 — Ngoài tài liệu · APK smoke (Factory Alert, React Native)

| # | Mục | Ô | Bằng chứng đo được | K.lượng |
|---|---|---|---|---|
| APK | **Chạy smoke APK trên thiết bị** | **KHÔNG ĐO ĐƯỢC** | `adb.exe devices` (`%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`, daemon khởi động OK) → **"List of devices attached"** rồi **rỗng** ⇒ **không thiết bị, không emulator**. <br>**Thêm một phát hiện làm mục này nặng hơn nó tự khai:** artifact có sẵn `FactoryAlertSystem-v1.0.16-release-{arm64-v8a,armeabi-v7a}.apk` đóng lúc **2026-07-07 14:48**, trong khi commit chạm `FactoryAlertSystem/` gần nhất là **`6b1dc5db` (2026-07-12)** và `FactoryAlertSystem/package.json:3` khai **`"version": "1.0.15"`** (lệch cả với tên file 1.0.16) ⇒ **APK hiện có ĐÃ CŨ hơn mã nguồn**; smoke nó cũng **không chứng minh được mã hôm nay**. | **nhỏ** (sau khi có thiết bị) |

---

## 2. DANH SÁCH "CÒN THẬT" — XẾP THEO RỦI RO ĐO ĐƯỢC

Xếp theo **hậu quả đo được nếu để nguyên**, không theo thứ tự tài liệu.

| # | Mục | Vì sao xếp ở đây (rủi ro ĐO ĐƯỢC) | K.lượng | Chủ dự án phải quyết? |
|:--:|---|---|:--:|:--:|
| **1** | **55-1 — `INSPECTION_SINGLE_TX_ENABLED` còn TẮT** | Đây là **lỗ toàn-vẹn dữ liệu duy nhất còn hở trong sản xuất**. Mã vá đã có và đã test, nhưng cờ tắt ⇒ đường chạy thật vẫn là `createProductInspection` cũ ⇒ **crash đúng khe header-commit..compensation vẫn đẻ ra header rỗng, và retry short-circuit vào nó ⇒ board vĩnh viễn 0 measurement**. Khác mọi mục còn lại: **đã trả tiền xây, chưa thu được lợi**. | **vừa** | ✅ **CÓ** — đổi hành vi đường ingest |
| **2** | **40-W6a — Timescale cutover** | `.env` tự khai *"điểm nghẽn ghi số 1"* và mig 0172/0173 **đã viết nhưng không convert được** vì PG này không có extension. Càng để lâu, khối dữ liệu phải backfill càng lớn (đã 22.995+ `product_inspections` ở thời điểm doc 55). | **lớn** | ✅ **CÓ** — DDL + cutover đường đọc |
| **3** | **50-B — RBAC Part-B (~45 thủ tục còn `adminProcedure`)** | Đo được: role non-admin **có grant đúng vẫn bị chặn** ở 4 thủ tục APS, `exportStatistics`, 4 bulk-maintenance của `productRouters`, `fiducialMark` create/update, audit list/stats/exportCsv. Đây là **cửa đóng nhầm**, không phải cửa mở nhầm ⇒ rủi ro vận hành (nghẽn single-admin), không phải rủi ro an ninh. **Nhóm `(T)` migrate sẽ RỚT 2FA** — đó là chỗ có thể biến nó thành rủi ro an ninh nếu làm ẩu. | **vừa** | ✅ **CÓ** — chọn module cho từng cụm + cách gắn lại 2FA cho cụm `(T)` |
| **4** | **32-c — font VN không vào `dist`** | **Không hỏng trên máy này** (cwd = gốc repo ⇒ nhánh dự phòng cứu). Nhưng nó là **quả mìn hẹn giờ đúng lúc bàn giao**: build không chép font, `FONT_ASSETS_DIR` chưa đặt, và `fontAssets` cố ý **fail loud** ⇒ báo cáo PDF **chết hẳn ngay lần deploy đầu tiên không có cây nguồn**. Rẻ nhất trong nhóm: thêm 1 bước copy vào `package.json:10`. | **nhỏ** | ❌ không |
| **5** | **55-2 — `MACHINE_FIDUCIAL_REGISTRATION` còn TẮT** | CASE #11 (`normalizedX/Y` ghi sai vị trí khi board đặt lệch) **vẫn hở trong sản xuất**; lib toán + wiring + 51 test đã có. Xếp sau #1 vì hậu quả là **sai vị trí**, không phải **mất dữ liệu**. | **vừa** | ✅ **CÓ** — đổi hành vi write-path + chốt ngưỡng residual |
| **6** | **51-r2 — MQTT admission gate chỉ cảnh báo** | Thiết bị `PENDING` **vẫn vào luồng nghiệp vụ**. Nhẹ hơn nhiều so với trước khi có P0 ACL (topic ACL **đang cưỡng chế thật**, đã đo), nên đây là lớp phòng vệ **thứ hai** chưa bật, không phải lớp thứ nhất còn hở. | **nhỏ** | ✅ **CÓ** — bật cờ = có thể cắt thiết bị đang chạy |
| **7** | **32-d — `OEE_SNAPSHOT_ENABLED` chưa bật** | Đo được: 0 dòng trong `.env` ⇒ OEE report **thiếu dữ liệu liên tục**. Doc 32 khai đúng đây là việc-chờ-người, không chặn. | **nhỏ** | ❌ không (chỉ cân nhắc single-worker) |
| **8** | **16-off — 3 cờ phần mềm còn tắt** (`SIM_PHYSICS`, `FIELD_V2`, `ERP_INBOUND`) | Mã có, cờ tắt. Không có hậu quả **đang diễn ra** — chỉ là năng lực chưa dùng. | **vừa** | ✅ **CÓ** — `ERP_INBOUND` đổi hợp đồng API vào |
| **9** | **40-W6c — `LICENSE_BYPASS=true`** | Đang bật trên môi trường chạy ⇒ mọi cổng license vô hiệu. Rủi ro **thương mại**, không phải kỹ thuật. | **nhỏ** | ✅ **CÓ** — cần SKU thật |
| **10** | **51-r1 — 16 máy còn apiKey plaintext at-rest** | **Không còn xác thực được** (`MACHINE_SHARED_KEY_ALLOWED=false` → `deny`, đã đo). Chỉ là **rác nhạy cảm nằm trong DB**. Bước cuối runbook doc 52. | **nhỏ** | ✅ **CÓ** — đổi dữ liệu (`UPDATE machines SET apiKey=NULL`) |
| **11** | **40-W6b/W6d — `FIREBASE_*` · `koffi`+`ZAUXDLL_PATH`** | Tính năng chưa có (push FCM, Zmotion). Không hỏng gì đang chạy. | **nhỏ** | ✅ **CÓ** — cần tài khoản Firebase / phần cứng Zmotion |
| **12** | **50-B2/B3 — CI lint + `RBAC_SCOPED_ADMIN`** | Cả hai là **chống hồi quy**, không sửa lỗi đang có. B2 nên làm **SAU** khi Part-B chốt (không thì lint sẽ khoá cứng tập sai). | **nhỏ** | ⚠ B3 có (bật ở staging trước) |
| **13** | **51-r3 — thiếu `uq_machines_code_active`** | Doc 51 khoe là "điểm mạnh đã có" nhưng **không tồn tại**. Hậu quả thật: trùng `machines.code` giữa các máy active **không bị DB chặn** (chỉ chặn ở tầng ứng dụng, `hierarchyRouters.ts:941-948`). | **nhỏ** | ✅ **CÓ** — DDL |
| **14** | **40-W5b — Hermes board-flow** | 0 file. Nhưng doc 40 QĐ D5 **đã chốt hoãn tới khi có line thật**. | **vừa** | ✅ **CÓ** — nhu cầu kinh doanh |
| **15** | **55-4 — 3 mục hoãn nhỏ của doc 55** | Đều **sau cờ OFF** ⇒ chưa chạm sản xuất. | **nhỏ**–**vừa** | ❌ không |

---

## 3. MỤC CẦN CHỦ DỰ ÁN QUYẾT TRƯỚC KHI ĐỘNG

Nhóm theo **loại quyết định**, vì đó mới là thứ quyết định ai phải trả lời.

### 3.1 — Đổi HÀNH VI đường chạy thật (bật cờ đã xây xong)
> Rủi ro chung: các cờ này **đã được chứng minh bằng test, chưa được chứng minh dưới tải thật**. Doc 55 §6.0 vốn đã chốt mô hình 2 bước "OFF → ON ở doc sau **sau khi PROVEN**" — nay chính là "doc sau".

| Cờ | Ảnh hưởng | Cần chốt gì |
|---|---|---|
| `INSPECTION_SINGLE_TX_ENABLED` | Đường ghi inspection đổi sang 1 transaction thật | Chấp nhận **sequence gap** + **ảnh orphan** (đánh đổi có chủ đích, doc 55 §2.4) |
| `MACHINE_FIDUCIAL_REGISTRATION` | Toạ độ điểm đo được căn affine ở write-path | Chốt lại **`MACHINE_FIDUCIAL_MAX_RESIDUAL_PX = 5.0`** sau khi có telemetry residual thật |
| `PRODUCT_VARIANT_ENABLED` | Sync/ingest thành variant-aware | Dev có **0 variant thật** ⇒ bật để làm gì, và ai tạo variant đầu tiên |
| `MQTT_ADMISSION_ENFORCE` | Thiết bị PENDING bị **cắt** khỏi luồng nghiệp vụ | **Có thể cắt tablet đang chạy** ⇒ nên chạy warn-only trọn 1 ca rồi đọc log trước |
| `OEE_SNAPSHOT_ENABLED` | Cron chụp OEE liên tục | Cân nhắc **single-worker** để không chụp trùng |
| `ERP_INBOUND` | Mở đường **API vào** cho order/BOM | **Đổi hợp đồng API** với hệ ERP đối tác |
| `LICENSE_BYPASS` → `false` | Bật cưỡng chế license | Phải có **SKU thật** cấu hình trước, nếu không **chặn chính mình** |
| `RBAC_SCOPED_ADMIN=true` | Admin hết god cross-tenant | Bật **staging trước**, chuẩn bị đường lùi |

### 3.2 — Đổi DDL / dữ liệu
| Việc | Vì sao cần quyết |
|---|---|
| **Timescale cutover** (cài extension + re-apply 0172/0173 + backfill + swap read-path + tắt matview) | Đây là **lớn nhất trong toàn khảo sát**; đụng đường đọc của mọi dashboard. Cần cửa sổ bảo trì. |
| `UPDATE machines SET "apiKey"=NULL` cho 16 hàng | **Đổi dữ liệu**; phải xác nhận cả 16 máy đã rotate sang khoá `mk_` (chạy `scripts/machine-key-rotation-report.mjs` trước) |
| Thêm `uq_machines_code_active` (partial unique) | **DDL**; nếu dữ liệu hiện có đã trùng thì phải guarded theo khuôn 0274 |

### 3.3 — Đổi HỢP ĐỒNG RBAC (doc 50 Part-B)
Phải quyết **từng cụm**, hai câu hỏi mỗi cụm:
1. **Module nào?** — cụm `defectCatalog/msaWizard/instrumentCalibration` **không có module sạch**; doc 50 cảnh báo đúng: **bịa module = deny mọi người**.
2. **Cụm `(T)` gắn lại 2FA thế nào?** — `mqttClientManagementRouter` (19 `adminProcedure`, config-to-device), `enhancedAuditRouter` (8, đọc audit-trail nhạy cảm), `ngRateThresholdRouter`, `executiveReportRouter`, `productPackageRouter`. Migrate mù = **rớt 2FA im lặng**.

### 3.4 — Đầu tư / tài khoản / phần cứng
HW-FAT bench (1 PLC mỗi họ) · Safety PLC Pilz/Sick · app-server HA · thiết bị Android cho APK smoke · tài khoản Firebase (FCM) · phần cứng Zmotion + `zauxdll.dll` · line SMT thật (Hermes) · UWB/LiDAR + Safety PLC (doc 16 S2) · FOCAS Fwlib32 (license vendor).

---

## 4. MỤC "KHÔNG ĐO ĐƯỢC" — VÀ CẦN GÌ ĐỂ ĐO

| Mục | Vì sao không đo được | Cần chính xác cái gì |
|---|---|---|
| **APK smoke (Factory Alert)** | `adb devices` trả về **danh sách rỗng** — không thiết bị, không emulator | **Một máy Android thật (bật USB debugging) HOẶC một AVD emulator.** Kèm theo: **build lại APK** — bản 1.0.16 (2026-07-07) đã cũ hơn commit `6b1dc5db` (2026-07-12), và `package.json` khai 1.0.15 ⇒ smoke bản cũ **không chứng minh được mã hôm nay** |
| **Doc 42 P0 — nghiệm thu SỐNG một lượt UPDATE** | `engineer1` (#51) có `two_factor_enabled=t`; hạt giống ở **`user_secrets."twoFactorSecret"`**, tôi **không có giá trị 10 mã dự phòng** | **Một mã dự phòng dùng-một-lần của `engineer1`, HOẶC một mã TOTP 6 số tại thời điểm đo.** (Bằng chứng mã + schema đã rất mạnh, nhưng đây vẫn là "tôi ĐỌC", không phải "tôi BẤM".) |
| **Doc 40 W6f — HW-FAT bench, Safety PLC, app-server HA** | Cần **phần cứng vật lý** | 1 PLC mỗi họ (Mitsubishi/Siemens/…) + Safety PLC Pilz hoặc Sick + cặp máy chủ standby + hiện trường để rút cáp / reboot / cắt DB |
| **Doc 16 — S2 rated-stop SIL, FOCAS Fwlib32, EtherCAT real-time, hiệu chuẩn camera, export YOLO `.onnx`** | Phần cứng + thư viện vendor có bản quyền + hiện trường | UWB/LiDAR tracker + Safety PLC đạt SIL 2/3 · license Fwlib32 của Fanuc · NIC hỗ trợ EtherCAT + kernel real-time · bàn hiệu chuẩn camera |
| **Doc 32 §8 #1/#4 — verify thị giác PDF/HTML + branding** | Cần **mắt người** chấm bản in và **tài sản thương hiệu** | Chủ dự án mở thử 1 PDF + 1 HTML mỗi trang `/production-dashboard` và `/station-analysis`, chấm dấu tiếng Việt / phân trang / rasterize chart; và cấp logo + tên + màu công ty |
| **Doc 40 W5b — Hermes** | Không phải "không đo được" về kỹ thuật (đã đo: **0 file**) — mà **không đo được có CẦN hay không** | Một **line SMT thật** của khách hàng cụ thể (QĐ D5 của doc 40) |

---

## 5. KỶ LUẬT ĐO — GHI CHÉP

**Thiết bị đo đã bị nghi ngờ và hiệu chuẩn ở các điểm sau:**

1. **`grep` đọc bình luận thành mã** — với MQTT ACL, 7 match của `authorizePublish|authorizeSubscribe` gồm **5 bình luận** (`mqttTopicAcl.test.ts:4`, `mqttService.ts:28/560/590/1451`) và **2 dòng gán thật** (`:1459`, `:1474`). Tôi **đọc nguyên khối 1440-1500** để phân biệt, không đếm match.
2. **Cờ "đã xây" ≠ "đang chạy"** — với **cả 3 mục doc 55**, nếu chỉ tìm thấy hàm rồi kết luận "ĐÃ VÁ" thì **cả ba sẽ biến mất khỏi mọi danh sách trong khi lỗ vẫn hở trong sản xuất**. Tôi đối chiếu **mã ⨯ hàm đọc cờ ⨯ `.env` thật** cho từng cờ. Lớp lỗi này bắt được **6 mục** (55-1/2/3, 51-r2, 32-d, 16-off).
3. **`P0-4` suýt bị xếp nhầm thành CÒN THẬT** — 5 chỗ gọi `bumpAndNotifyPointsConfig` nằm trong `create/update/backfill/uploadCroppedImage/remapUnmapped`, **`delete` KHÔNG có chỗ gọi nào**. Nếu dừng ở đó, kết luận là "delete không bump ⇒ P0 còn một nửa". Đọc tiếp `delete` (1564-1609) mới thấy bump nằm **ở tầng DB trong cùng transaction** (`product.ts:2107`) — cố ý, vì phải khớp với `deletedAtVersion`. **Ánh xạ dòng-gọi → tên-thủ-tục bằng biên router thật** (`measurementPointRouter` = 1000-1800), không bằng ước lượng khoảng cách dòng.
4. **Mã trạng thái là thước hỏng** — `machine.config` trả **HTTP 200** ở cả hai phía (có leak / không leak). Tôi đo bằng thứ **phân biệt được**: giá trị `"apiKey":null` + `"requiresClaim":true` trong thân.
5. **"1 failed + no tests" không phải xanh** — lượt vitest được đọc **cả số file lẫn số ca**: `1 passed (1)` / `60 passed (60)` / `PIPESTATUS=0`. Có ca thật, không phải glob rỗng.
6. **`PIPESTATUS` thay `$?`** sau mọi đường ống (`grep | head`, `vitest | tail`).
7. **Schema là bảng snake_case, cột camelCase** — hai truy vấn đầu **lỗi cột** (`serialnumber`, `machineCode`). Tôi chuyển sang **truyền SQL bằng file `-f`** (thoát dấu nháy kép của PowerShell 5.1 làm hỏng định danh có phân biệt hoa-thường) và **`\d machines` trước, viết truy vấn sau**. Phát hiện phụ: doc 51 nhắc `machineCode`/`approvalStatus`, DB thật là `code`/`registrationStatus`.
8. **Nhận diện tiến trình theo CỔNG, không theo chính tả dòng lệnh** — `Get-NetTCPConnection -LocalPort 3000 -State Listen` → `OwningProcess=15052`. (Ghi nhận: `Win32_Process.CommandLine` in ra `node dist/index.js` với **một** dấu cách, khác lời khai "hai dấu cách" — thêm một lý do để **không** nhận diện theo chuỗi.)
9. **Suy luận được đánh dấu là suy luận** — với mục font (32-c), tôi **không** chạy được một lượt render PDF sống (cần khoá scope `export:read`). Cái tôi ĐO: font có trong nguồn · build không chép · `dist` không có · `FONT_ASSETS_DIR` trống · mã có nhánh dự phòng theo `process.cwd()`. Cái tôi SUY RA (và ghi rõ là suy ra): `process.cwd()` = gốc repo, **vì** `node dist/index.js` dùng đường dẫn tương đối nên chỉ khởi động được từ thư mục chứa `dist/`.

**Hai lời khai cũ KHÔNG lặp lại:** `postgres` không lệch 7 giờ · `REDIS_URL` không phải nợ. *(Dòng `[Redis] REDIS_URL not configured, using in-memory cache fallback` xuất hiện trong lượt vitest là của **môi trường test**, không phải tiến trình 15052 — không kết luận gì từ nó.)*

---

## 6. ĐỀ NGHỊ CHO LƯỢT SAU

**Không nên** mở một pha "trả nợ 7 tài liệu" — vì **5/5 P0 đã hết**, và cái còn lại **không cùng loại việc**:

- **Lượt A (một lượt agent, không cần chủ dự án):** 32-c (thêm bước copy font vào `package.json:10`) + 50-B2 (viết CI lint, **để ở chế độ cảnh báo** cho tới khi Part-B chốt). Rẻ nhất, rủi ro thấp nhất.
- **Lượt B (một pha, CẦN chủ dự án chốt trước):** bật tuần tự `INSPECTION_SINGLE_TX_ENABLED` → `MACHINE_FIDUCIAL_REGISTRATION`, **mỗi cờ một nghiệm thu sống dưới tải** — đây là chỗ **đã trả tiền xây mà chưa thu được lợi**, và là **lỗ toàn-vẹn duy nhất còn hở trong sản xuất**.
- **Lượt C (một pha, CẦN chủ dự án duyệt từng cụm):** doc 50 Part-B. **Không** động cụm `(T)` cho tới khi có phương án gắn lại 2FA.
- **Kế hoạch riêng (nhiều pha):** Timescale cutover.
- **Đưa ra khỏi mọi danh sách backlog:** doc 16 (12 pha) · doc 55 (14 quyết định) — **KHÔNG CÒN NGHĨA**.
- **Việc của chủ dự án, không phải của agent:** §3.4.

---

*Lượt khảo sát Nhóm C · 2026-08-12/13 · CHỈ ĐO, 0 dòng mã sản phẩm bị sửa · HEAD `d784618d` · máy chủ sống PID 15052.*
