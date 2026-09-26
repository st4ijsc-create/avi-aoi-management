# AOI Package Examples

Thư mục này chứa các ví dụ về cấu trúc meta.json cho AOI Package upload.

> ⚠ **Hướng sắp tới (đã quyết định, CHƯA triển khai — BG-85):** `meta.json` sẽ được
> hợp nhất thành CÙNG hình dạng với payload kết quả v2.0 (`machineDataContractV2` +
> thêm mảng `images[]`) — xem `docs/UNIFIED_API_STRUCTURE.md` và
> `docs/superpowers/specs/2026-09-01-aoi-chuan-goi-anh.md`. Cấu trúc `measurements`/
> `points` dưới đây vẫn là hợp đồng ĐANG CHẠY hôm nay; bên tích hợp máy nên đọc
> spec trên trước khi đầu tư nhiều vào engine sinh `meta.json`.

## Files

### 1. meta.json.example
Cấu trúc mới - **KHUYẾN NGHỊ** (Unified với submitInspection API)

**Features:**
- ✅ Đầy đủ enterprise hierarchy (companyCode, factoryCode, workshopCode, lineCode, stageCode)
- ✅ Production context (productionOrderCode, operatorId, batchNumber)
- ✅ Measurements array với pointId, pointCode, measuredValue, remark
- ✅ Dễ dàng tra cứu history và truy vết
- ✅ Đồng bộ với submitInspection tRPC API

**Use case:** Client mới, hoặc client cũ muốn upgrade để có thêm features.

### 2. meta-legacy.json.example
Cấu trúc cũ — CHỈ tên trường cũ tương thích ngược, KHÔNG phải toàn bộ cấu trúc

⚠️ **Chỉ tên trường BÊN TRONG là tương thích ngược** (`factory`/`line` thay
`factoryCode`/`lineCode`; `code`/`value` thay `pointId`/`measuredValue` trong từng
điểm đo). Mảng đo lường vẫn PHẢI đặt ở khoá `measurements` — server **bắt buộc**
trường này trên mọi gói (kể cả rỗng `[]`). Một gói chỉ gửi `points[]` mà KHÔNG có
`measurements` sẽ bị server **từ chối** (`invalid_type`) và không bao giờ commit
được, dù retry bao nhiêu lần — đây KHÔNG phải "vẫn hoạt động".

**Features:**
- Factory và Line (không có companyCode, workshopCode, stageCode) — field cũ, vẫn hoạt động
- Measurements array dùng tên trường cũ `code`, `value` (không có pointId, measuredValue, remark)
- Thiếu production context

**Use case:** Client cũ dùng tên trường cũ bên trong measurements, muốn giữ nguyên
naming quen thuộc nhưng vẫn phải gửi mảng ở khoá `measurements` (không phải `points`).

## Usage

### Bước 1: Tạo meta.json
Copy file `meta.json.example` hoặc `meta-legacy.json.example` và điều chỉnh theo dữ liệu thực tế.

### Bước 2: Chuẩn bị images folder
```
my-package/
├── meta.json
└── images/
    ├── image_001.jpg
    ├── image_002.jpg
    └── image_003.jpg
```

**Lưu ý:** 
- File names trong `meta.json` phải khớp với file names trong `images/`
- Mỗi measurement có `fileName` phải có file tương ứng trong `images/`

### Bước 3: Tạo ZIP file
```bash
# Windows
Compress-Archive -Path my-package\* -DestinationPath package.zip

# Linux/Mac
cd my-package && zip -r ../package.zip * && cd ..
```

### Bước 4: Upload qua API

#### 4.1. Presign
```bash
curl -X POST https://your-server.com/api/trpc/aoiPackage.presign \
  -H "Content-Type: application/json" \
  -d '{
    "apiKey": "your-api-key",
    "machineCode": "AOI-LINE1-01",
    "inspectionId": "INS-20240115-001"
  }'
```

Response:
```json
{
  "success": true,
  "packageId": "pkg_abc123",
  "uploadUrl": "https://your-server.com/api/aoi/upload/pkg_abc123"
}
```

#### 4.2. Upload ZIP
```bash
curl -X POST https://your-server.com/api/aoi/upload/pkg_abc123 \
  -F "file=@package.zip"
```

#### 4.3. Commit
```bash
curl -X POST https://your-server.com/api/trpc/aoiPackage.commit \
  -H "Content-Type: application/json" \
  -d '{
    "apiKey": "your-api-key",
    "packageId": "pkg_abc123"
  }'
```

Response:
```json
{
  "success": true,
  "packageId": "pkg_abc123",
  "inspectionId": 12345,
  "status": "committed",
  "stats": {
    "totalPoints": 5,
    "okCount": 3,
    "ngCount": 1,
    "imageCount": 5
  },
  "imageUrls": [
    "/api/aoi/image/pkg_abc123/image_001.jpg",
    "/api/aoi/image/pkg_abc123/image_002.jpg",
    "/api/aoi/image/pkg_abc123/image_003.jpg",
    "/api/aoi/image/pkg_abc123/image_004.jpg",
    "/api/aoi/image/pkg_abc123/image_005.jpg"
  ]
}
```

## Migration Guide

⚠️ **Lưu ý về "trạng thái xuất phát" của diff dưới đây:** khoá `points` (bên trái,
dấu `-`) chỉ minh hoạ TÊN TRƯỜNG cũ để so sánh — một payload thật với khoá
`points` mà KHÔNG có `measurements` **bị server từ chối ngay hôm nay** (không
phải "cấu trúc cũ đang chạy rồi từ từ nâng cấp"). Nếu client của bạn còn gửi
`points[]` không kèm `measurements`, đó là gói **đang thất bại**, không phải gói
"còn hoạt động ở mức cũ" — ưu tiên đổi khoá `measurements` trước các trường khác.

### Từ legacy → new structure

```diff
{
  "serialNumber": "SN123",
  "productModel": "PCB-V1",
- "factory": "FACTORY-HN",
+ "factoryCode": "FACTORY-HN",
- "line": "LINE-3",
+ "lineCode": "LINE-3",
+ "workshopCode": "WORKSHOP-SMT",
+ "stageCode": "STAGE-AOI",
+ "companyCode": "COMPANY-A",
+ "productionOrderCode": "PO-2024-001",
+ "operatorId": "OP-0023",
+ "batchNumber": "BATCH-2024-001",
  
- "points": [
+ "measurements": [
    {
-     "code": "R1",
+     "pointId": "POINT-001",
+     "pointCode": "R1",
-     "value": 1023.5,
+     "measuredValue": 1023.5,
      "fileName": "image_001.jpg",
-     "result": "OK"
+     "result": "OK",
+     "unit": "Ω",
+     "remark": "In spec"
    }
  ]
}
```

## Field Reference

### Required Fields
- `serialNumber` - Số serial sản phẩm
- `productModel` - Model sản phẩm
- `measurements` - Array các điểm đo — **BẮT BUỘC trên MỌI gói** (có thể là mảng
  rỗng `[]`, nhưng không được vắng mặt). `points` là bí danh CŨ của các TÊN
  TRƯỜNG bên trong mỗi điểm đo, KHÔNG thay thế được khoá `measurements` ở cấp
  cao nhất — xem cảnh báo ở mục `meta-legacy.json.example` phía trên.

### Recommended Fields (NEW)
- `companyCode` - Mã công ty/tập đoàn
- `factoryCode` - Mã nhà máy
- `workshopCode` - Mã nhà xưởng
- `lineCode` - Mã dây chuyền
- `stageCode` - Mã công đoạn
- `productionOrderCode` - Mã lệnh sản xuất
- `operatorId` - Mã công nhân
- `batchNumber` - Số lô

### Measurement Fields
- `pointId` - ID điểm đo (khuyến nghị)
- `pointCode` - Mã điểm đo (fallback)
- `fileName` - Tên file ảnh
- `result` - Kết quả: "OK" | "NG" | "NTF"
- `measuredValue` - Giá trị đo
- `unit` - Đơn vị
- `remark` - Ghi chú

## See Also
- [UNIFIED_API_STRUCTURE.md](../UNIFIED_API_STRUCTURE.md) - Chi tiết về API structure
- [API_REFERENCE.md](../API_REFERENCE.md) - API documentation
