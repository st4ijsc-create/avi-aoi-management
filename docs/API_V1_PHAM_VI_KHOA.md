# /api/v1 — phạm vi dữ liệu theo KHOÁ API (cập nhật 2026-10-24)

Khoá API đại diện **một nhà máy** (`api_keys.dataScopeMode`: `factory` + `corporateCode`/`factoryCode`, hoặc `global` tường minh, hoặc **chưa khai**). Từ đợt rà bảo mật 2026-10-24 mọi tuyến `/api/v1` đọc/ghi dữ liệu theo nhà máy đều tôn trọng phạm vi này.

| Loại khoá | Hành vi |
|---|---|
| `global` (kể cả master key) | Không đổi — thấy mọi nhà máy |
| `factory` (A) | Danh sách chỉ chứa mục của nhà máy A; id của nhà máy B ⇒ **404** (cùng hình dạng với id không tồn tại); ghi vào đối tượng của B ⇒ 404, **không** có tác dụng phụ |
| chưa khai | Danh sách rỗng, id ⇒ 404 (fail-closed). Khai phạm vi cho khoá để dùng lại |
| khoá **gắn máy** (`machineId`, máy-principal) | Luôn dùng được **chính máy của nó** (đọc state/telemetry…); ngoài ra theo phạm vi khai báo |

Tuyến đã áp dụng: `equipment*` (kể cả `POST /equipment/:id/commands`), `assets*` (kể cả ghi), `gateways/:id/status`, `state/*`, `orders*` (kể cả ghi), `genealogy*`, `lines*` (kể cả `command`/`recipe`), `events`, `metrics/:metric`, `predict/:task`, `recommend`, `recommendations`, `health/assets/:id`, `predictions`, `safety/events|zones`, `fleet/tasks|zones`, `programs*`, `anomaly/events`, `twin/scene-graph`, `pdm/risk`, `standards/compliance` (chỉ đếm máy trong phạm vi).
Danh mục dùng chung toàn tập đoàn **không** lọc (miễn trừ có chủ ý): `standards/device-types`, `standards/alarm-taxonomy`, `twin/models`.

## Thay đổi hợp đồng cần chú ý — `GET /api/v1/metrics/{metric}`

Khoá **một nhà máy** BẮT BUỘC truyền `scope` (`equipment|machine|line|station|factory`) **và** `scopeId` của một thực thể trong nhà máy của khoá.

```
GET /api/v1/metrics/OEE?scope=line&scopeId=12      # khoá nhà máy A, chuyền 12 thuộc A  → 200
GET /api/v1/metrics/OEE?scope=line&scopeId=99      # chuyền 99 thuộc B                  → 404 not_found
GET /api/v1/metrics/OEE?scope=equipment            # thiếu scopeId (khoá hẹp)           → 400 scope_id_required
```
Khoá toàn cục không đổi (vẫn có thể truy vấn gộp không `scopeId` nếu định nghĩa chỉ số cho phép).

Các thay đổi hợp đồng nhỏ khác cho khoá hẹp: `POST /recommend` (`adjust_param`) bắt buộc `target.machineId`; `GET /recommendations` chỉ trả đề xuất của người dùng được gán nhà máy trong phạm vi khoá.

## /api/external — phạm vi theo NGƯỜI GỌI (cập nhật 2026-10-24)

Cụm `/api/external/*` xác thực bằng `x-master-key` (toàn quyền — không đổi) **hoặc** token người dùng Bearer (`/api/external/auth/login`). Trước đây tài khoản gán nhà máy A đọc/ghi được dữ liệu mọi nhà máy; nay:

- tuyến trả **danh sách** chỉ gồm dữ liệu trong nhà máy được gán và kèm `scopeApplied: true` (master key ⇒ `false`);
- tuyến tra/ghi theo **id** ngoài phạm vi ⇒ **403** `{ code: "external_factory_scope_denied" }` (không phải 404 — bản ghi có tồn tại); admin giữ toàn quyền;
- đã áp dụng: `inspections/images|measurements|events`, `alerts`, `alerts/:alertId` (+ `acknowledge`, `resolve`), `bulletins`, `stations/:id` và các nhánh con, `stations/resolve-topic`, `workstations`, `workstations/:id`, `products`, `products/:id`;
- miễn trừ có chủ ý (đã kiểm bằng test): `/api/edge/download/:deploymentId` (khoá máy, deployment phải của đúng máy), `/api/reports/artifacts/:id/download` (tệp thuộc người tạo).

### Thay đổi hợp đồng cho APP DI ĐỘNG (tài khoản có gán nhà máy)

- **Cảnh báo MQTT cấp hệ thống (`source=mqtt`, id `mqtt-{n}`)**: quy tắc/lịch sử MQTT là cấu hình hạ tầng broker, **không có cột nhà máy** nên không quy được về nhà máy nào. Quyết định (chủ dự án chấp nhận, fail-closed): người dùng bị thu hẹp **không còn thấy** nhóm này (danh sách bỏ qua, tra/ghi theo id ⇒ 403); master key và admin không đổi. Nếu sau này cần, tạo quyền riêng "xem cảnh báo hạ tầng".
- Cảnh báo theo quy tắc không định vị (`alert_settings` không có máy/nhà máy = "toàn bộ") cũng chỉ hiện với phạm vi toàn quyền.
- Sản phẩm (`products`) chưa gắn máy/điểm đo/kiểm tra nào ở nhà máy của người dùng ⇒ ẩn với người dùng hẹp.

## Cổng ảnh `/uploads/**` — MẶC ĐỊNH CƯỠNG CHẾ (2026-10-24)

`ANH_CONG_MO` vắng ⇒ **cưỡng chế** (trước: mở). Chỉ `true`/`1` mới mở; giá trị lạ ⇒ cưỡng chế. Ảnh tải được bằng: vé ký HMAC (`?exp=&pv=anh&sig=`, 15 phút, do các tuyến đã kiểm phạm vi cấp), `x-master-key`, hoặc phiên web (kèm kiểm nhà máy theo đường dẫn).

Rà client (đọc mã, 2026-10-24): trình duyệt `client/` dùng cookie cùng origin ⇒ **không vỡ**. App RN `FactoryAlertSystem/` (mã nguồn hiện tại): `imageService#nguonAnh` gửi `x-master-key` + giữ vé ký ⇒ **không vỡ**; APK **đã phát ra hiện trường trước bản này** nạp ảnh bằng `<Image source={{uri}}>` trần ⇒ **VỠ ẢNH** (các điểm render ảnh trạm/điểm đo/cảnh báo, ≥13 chỗ) cho tới khi cập nhật. Tải trọng cảnh báo qua MQTT mang đường dẫn `/uploads/inspections/…` THÔ — app xử lý bằng `nguonAnh` (header), APK cũ vỡ. Client C# phía máy AOI chỉ **tải LÊN** ảnh (presign/commit), không tải xuống ⇒ không ảnh hưởng. Môi trường còn APK cũ: đặt `ANH_CONG_MO=true` **có chủ ý** (ghi trong `.env`) cho tới khi đội máy cập nhật.
