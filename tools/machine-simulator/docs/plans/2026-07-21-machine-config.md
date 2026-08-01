# Kế hoạch thi công — Cấu hình vận hành theo máy

**Thiết kế:** `docs/MACHINE_CONFIG_DESIGN.md` (đã duyệt). **Nhánh:** `feat/machine-simulator`, worktree `D:/SOURCES/avi-aoi-sim`. Base: `f7835ef6`.

**Mục tiêu:** cấu hình từ server là khuyến nghị; cấu hình tại máy điều chỉnh được và là chuẩn cho máy đó; gắn theo cặp (máy × sản phẩm) với lớp *theo máy* dùng chung.

## Ràng buộc toàn cục

- Chỉ sửa `tools/machine-simulator/` trừ Task 6 (repo chính, **không commit nếu chưa hỏi**).
- KHÔNG chạy git branch/checkout. Commit qua `git -C D:/SOURCES/avi-aoi-sim`.
- App chạy **offline hoàn toàn** — không thêm bất kỳ request ra ngoài.
- TOKENS ONLY, không hex thô. Radius 0, viền hairline, tabular-nums, nhãn song ngữ (gloss EN **ngoài** phần tử `<label>`).
- **Màu trạng thái chỉ mang nghĩa trạng thái** (spec §2). "Có điều chỉnh tại máy" là trạng thái **bình thường**, không tô đỏ.
- Trang không cuộn; panel cuộn trong. **Nút an toàn không bao giờ cuộn, không đổi chỗ** (spec §8, có test `12-hmi-safety-rail.spec.ts`).
- Ngưỡng thị giác `0.00002` — không nới, không mở rộng mask.
- Mỗi task: `npx tsc --noEmit` + `npm run build` sạch, `npm run test:e2e` xanh trên engine mới, axe AA sáng+tối 0 serious/critical.

---

## Task 1 — EdgeCore: schema tham số + kho cấu hình 3 lớp

**Tệp:** `src/St4i.EdgeCore/Config/MachineParameterSchema.cs`, `MachineConfigStore.cs`, `MachineConfigModels.cs` (mới); test trong `tests/St4i.EdgeCore.Tests/`.

- `ParameterDef`: `Key`, `LabelVi`, `LabelEn`, `Unit`, `Kind` (number|enum|bool), `Min`, `Max`, `Step`, `Decimals`, `ConfigKind`.
- Vựng từ theo `configKind`, **bám đúng tên trường server** (`server/services/recipes/recipeSchemas.ts`): `screw_program` (`torqueTarget`, `torqueTolerance`, `angleTarget`, `speedRpm`, `clampTimeMs`), `dispense_program`, `weld_profile`, `iot_settings` (`sampleRateHz`, `reportIntervalSec`, `thresholds`), **`aoi_inspection` (mới)**: `exposureUs`, `gain`, `lightIntensity`, `conveyorSpeed`, `fiducialTolerance`, `matchThreshold`.
- `MachineConfigStore`: khóa `(machineCode, productCode?)`; `productCode = null` ⇒ lớp *theo máy*. Ghi JSON nguyên tử như `ProductConfigStore`.
- `Resolve(machineCode, productCode)` → `EffectiveConfig { value, source: baseline|machine|machineProduct, def }` cho từng khóa.
- **Chặn cứng min/max khi ghi** — ngoài dải phải bị từ chối, không phải cắt xén im lặng.
- Checksum ổn định cho cả `adjustments` (tái dùng lối `ConfigChecksum`).

**Test:** phân giải 3 lớp đúng thứ tự; lớp *theo máy* áp cho mọi sản phẩm; lớp *máy×sản phẩm* thắng; kéo baseline mới **không** xóa điều chỉnh; ghi ngoài dải bị từ chối; máy IoT không có chiều sản phẩm; ghi/đọc lại bền qua restart.

**Commit:** `feat(edge): machine parameter schema + 3-layer config store (machine × product)`

## Task 2 — EngineApi: endpoint + phân giải

**Tệp:** `src/St4i.EngineApi/Config/MachineSettingsEndpoints.cs` (mới), nối vào `Program.cs`.

- `GET /v1/machines/{code}/settings?product=` → `{ schema[], baseline, adjustments{machine,product}, effective[], drift }`
- `PUT /v1/machines/{code}/settings/{key}` body `{ value, scope: "machine"|"product", product?, note? }`
- `DELETE /v1/machines/{code}/settings/{key}?scope=&product=` → về lớp dưới
- `POST /v1/machines/{code}/settings/pull` → làm mới baseline (giữ nguyên adjustments)
- `POST /v1/machines/{code}/settings/push` → báo cáo cấu hình **thực tế** lên server
- `GET /v1/machines/{code}/settings/history`

Dùng `ConfigJson.Options` cho **cả request lẫn response** (GOTCHA đã biết: `JsonStringEnumConverter` toàn cục phá casing snake_case). Ngoài dải → 400 kèm thông báo nêu rõ dải cho phép.

**Test:** mỗi endpoint; 400 khi ngoài dải; pull giữ adjustments; push không đổi baseline.

**Commit:** `feat(engine): machine settings endpoints with scoped adjustments`

## Task 3 — Cấu hình phải lái mô phỏng thật

**Tệp:** `src/St4i.EdgeCore/` (đường sinh dữ liệu của driver mô phỏng).

Cấu hình hiệu lực phải đổi hành vi thật, nếu không đây là form chết:
- `speedRpm`/`clampTimeMs` → nhịp chu kỳ
- `torqueTarget`/`torqueTolerance` → tâm & độ tản của mô-men sinh ra; siết dung sai ⇒ tỷ lệ NG tăng
- `sampleRateHz`/`reportIntervalSec` → nhịp phát telemetry IoT
- `matchThreshold`/`exposureUs`/`lightIntensity` → tỷ lệ lỗi giả AOI

**Test:** siết `torqueTolerance` ⇒ tỷ lệ NG tăng có ý nghĩa thống kê; đổi `speedRpm` ⇒ nhịp chu kỳ đổi theo; đặt lại về baseline ⇒ hành vi trở lại. Test phải **tất định** (seed cố định).

**Commit:** `feat(edge): effective config drives simulated behaviour`

## Task 4 — Màn HMI: thanh tab + tab CÀI ĐẶT

**Tệp:** `web/src/routes/Hmi.tsx`, `components/hmi/TabRail.tsx` (mới), `components/hmi/SettingsTab.tsx` (mới).

- Dựng **thanh tab** mà spec §8 đã yêu cầu từ đầu nhưng chưa có: `VẬN HÀNH / OPERATION` · `CÀI ĐẶT / SETTINGS`.
- Tab CÀI ĐẶT: mỗi dòng = nhãn song ngữ · **giá trị hiệu lực** (to, tabular) · đơn vị · dải cho phép · khuyến nghị từ server · **chỉ dấu nguồn** (khuyến nghị / theo máy / cho sản phẩm này) · nút *về mặc định*.
- Chọn phạm vi khi sửa: *cho máy này* hay *chỉ cho sản phẩm đang chạy*.
- Máy IoT: ẩn chiều sản phẩm.
- Ngoài dải: chặn ngay tại ô nhập, nêu rõ dải.
- **Không được phá** bất biến an toàn: nút dừng khẩn vẫn không cuộn, không đổi chỗ, kể cả khi ở tab CÀI ĐẶT.

**Commit:** `feat(hmi): tab rail + machine settings tab with scoped adjustments`

## Task 5 — Màn chi tiết máy

**Tệp:** `web/src/routes/MachineDetail.tsx`, `components/MachineSettingsPanel.tsx` (mới).

Cùng nguồn dữ liệu, cho người xem từ xa. Trạng thái đồng bộ dùng thang trạng thái sẵn có.

**Commit:** `feat(web): machine settings panel on machine detail`

## Task 6 — Server (repo chính) — **KHÔNG COMMIT NẾU CHƯA HỎI**

**Tệp:** `drizzle/schema/`, migration mới, `server/routers/machineApiRouters.ts`, `server/api/v1/openapi.ts`, `.env.example`.

1. Bảng `machine_operating_config`: `machineId`, `configKind`, `productModelId?`, `scope`, `baselineVersion`, `adjustments` jsonb, `effective` jsonb, `checksum`, `reportedBy`, `reportedAt`. Migration theo đúng lối hiện có (**DDL bằng owner `aoi`** — `avi_app` sẽ 42501).
2. `POST /api/machine/config-sync/report-settings` — máy xác thực bằng `mk_` key như các endpoint máy khác; ghi bảng trên; **không** đụng `machine_recipes`.
3. Bật `CONFIG_SYNC_GENERIC_ENABLED` (đang tắt nên `check`/`get` trả 500).

**Commit:** để riêng, **chờ duyệt**.

## Task 7 — Nối Live + kiểm chứng đầu-cuối

`LiveConfigSyncBackend` gọi endpoint mới ở Task 6; Demo dùng `SimulatedEcosystem`. Kiểm chứng chuỗi: kéo khuyến nghị → chỉnh tại máy → thấy mô phỏng đổi → đẩy lên → server thấy cấu hình thực tế → baseline **không đổi**.

**Commit:** `feat(config): live backend for machine settings + end-to-end verification`
