# Huong Dan Chi Tiet Chuc Nang Synpoint (Sync Point)

Tai lieu nay mo ta day du quy trinh dong bo diem do (Synpoint) giua thiet bi AOI App va server trong he thong AVI-AOI.

## 1. Synpoint la gi?

Synpoint la nhom chuc nang dong bo cau hinh diem do (measurement points), bao gom:

- Day danh sach diem do tu App len server (push): `syncMeasurementPoints`
- Kiem tra version cau hinh diem do: `checkPointsVersion`
- Dong bo phan thay doi (delta): `deltaSyncPoints`
- Tai toan bo diem do tu server: `getPoints`
- Dong bo anh tham chieu cho tung diem: `syncPointImage`

## 2. Endpoint REST tuong ung

- `POST /api/machine/sync-points`
- `GET /api/machine/check-points-version`
- `GET /api/machine/delta-sync-points`
- `GET /api/machine/get-points`
- `POST /api/machine/sync-point-image`

Xac thuc:

- Truyen mot trong hai:
- Header `x-api-key` hoac body/query `apiKey`
- Header/query/body `machineCode`

Neu thieu ca `apiKey` va `machineCode`, server tra loi loi xac thuc.

## 3. Luong dong bo khuyen nghi

### Buoc 1: Kiem tra version truoc khi sync

Goi `check-points-version` de lay `pointsConfigVersion` tren server.

Neu version client bang server:

- Bo qua dong bo diem do.

Neu version client nho hon server:

- Goi `delta-sync-points` voi `sinceVersion = version client`.

### Buoc 2: Dong bo delta

Goi `delta-sync-points`.

- Neu `hasChanges = true`: cap nhat cache diem do theo danh sach tra ve.
- Neu `hasChanges = false`: khong can cap nhat.

### Buoc 3: Dong bo full khi can

Dung `get-points` trong cac truong hop:

- Lan dau app khoi tao (chua co cache)
- Nghi ngo cache hu hong
- Can tai day du tat ca diem do theo `productModelCode`

### Buoc 4: App day diem do len server (nguoc chieu)

Dung `sync-points` (`syncMeasurementPoints`) khi app thay doi toa do/thuoc tinh diem do.

- Server se tao moi hoac cap nhat diem do theo `code`
- Neu co thay doi, server tang `pointsConfigVersion`
- Server co the tu dong transform toa do neu do phan giai anh nguon khac server

### Buoc 5: Dong bo anh tung diem

Dung `sync-point-image` khi chi can cap nhat anh tham chieu cua 1 diem do.

- Co the gui `imageBase64` hoac `imageUrl`
- Neu hash anh khong doi, server bo qua upload (`imageSkipped = true`)

## 4. Quy tac du lieu quan trong

### 4.1 Khoa dinh danh diem do

- Dung `point.code` lam khoa on dinh de update/upsert
- Khong doi `code` tuy y neu muon giu lich su/anh lien ket

### 4.2 Toa do va ty le

Server ho tro 3 cach:

- Gui `normalizedX/Y` (+ `normalizedRadius`) -> uu tien cao nhat
- Gui `positionX/Y` + `sourceImageWidth/Height` -> server tu transform
- Gui truc tiep `positionX/Y` cung do phan giai voi server

Khuyen nghi:

- Luon gui them normalized de tranh sai lech khi doi do phan giai

### 4.3 Versioning

- Moi lan `sync-points` thanh cong co thay doi se tang `pointsConfigVersion`
- Client nen luu local version theo tung `productModelCode`

### 4.4 Workstation

- Co the map diem do theo tram bang `workstationCode`
- Neu khong co, co the bo qua truong nay

## 5. Cac field bat buoc theo API

### sync-points (push)

Bat buoc:

- `productModelCode`
- `points` (mang, toi thieu 1 phan tu)
- Va mot trong hai: `apiKey` hoac `machineCode`

Bat buoc trong moi point:

- `code`
- `name`
- `positionX`
- `positionY`

### delta-sync-points

Bat buoc:

- `productModelCode`
- `sinceVersion` (so nguyen >= 0)
- Va mot trong hai: `apiKey` hoac `machineCode`

### sync-point-image

Bat buoc:

- `productModelCode`
- `pointCode`
- Mot trong hai: `imageBase64` hoac `imageUrl`
- Va mot trong hai: `apiKey` hoac `machineCode`

## 6. Ma loi thuong gap

- `UNAUTHORIZED`: sai `apiKey` hoac `machineCode`
- `NOT_FOUND`: khong tim thay `productModelCode` hoac `pointCode`
- `BAD_REQUEST`: thieu field bat buoc, sai kieu du lieu, `sinceVersion` am

## 7. Best practices trien khai

- Luon goi `check-points-version` truoc, tranh full sync khong can thiet
- Uu tien `delta-sync-points` de tiet kiem bandwidth
- Batch `points` theo product model, khong tron nhieu model trong mot request
- Retry co backoff khi mang yeu
- Log `fromVersion -> toVersion` de truy vet
- Validate schema truoc khi goi API

## 8. File JSON mau

Xem file:

- `apidocs/SYNPOINT_SAMPLE.json`

File nay gom:

- Mau request `sync-points`
- Mau response `sync-points`
- Mau request/response `check-points-version`
- Mau request/response `delta-sync-points`
- Mau request/response `sync-point-image`
