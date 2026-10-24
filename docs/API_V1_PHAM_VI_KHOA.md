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
