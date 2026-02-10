# AOI Package Upload & History Integration - Testing Guide

## Tổng quan các thay đổi

### 🎯 Vấn đề đã được fix
Trước đây, khi upload ảnh qua API `/api/aoi/upload/:packageId`:
- ❌ **KHÔNG** tạo inspection records tự động
- ❌ Ảnh **KHÔNG** hiển thị trong trang `/history`
- ❌ Chỉ lưu trong `inspectionPackages` và `packageImages` table
- ⚠️ Chỉ link với inspection đã có sẵn, không tạo mới

### ✅ Giải pháp đã implement
Bây giờ, khi commit AOI package (sau khi upload):
1. ✅ **Tự động tạo** `productInspection` record nếu chưa có
2. ✅ **Tự động tạo** `measurementResults` cho mỗi ảnh/điểm đo
3. ✅ **ImageUrl** trỏ đến `/api/aoi/image/:packageId/:fileName`
4. ✅ Ảnh **tự động hiển thị** trong trang History
5. ✅ Link với inspection đã có nếu tồn tại (giữ nguyên logic cũ)

---

## 📋 Chi tiết Technical Changes

### 1. Server-side Changes (`server/routers/aoiPackageRouter.ts`)

#### Before:
```typescript
// Chỉ link với inspection đã có
let linkedInspectionId: number | undefined;
if (metaData?.serialNumber) {
  const inspections = await database.select()...
  if (inspections.length > 0) {
    linkedInspectionId = inspections[0].id;
  }
  // Không tạo gì cả nếu không tìm thấy!
}
```

#### After:
```typescript
// Tạo mới nếu không tìm thấy
let linkedInspectionId: number | undefined;
let createdInspection = false;

if (metaData?.serialNumber) {
  // Try to find existing
  const inspections = await database.select()...
  
  if (inspections.length > 0) {
    linkedInspectionId = inspections[0].id;
  } else {
    // ✅ CREATE NEW INSPECTION
    const overallResult = metaData.summary?.ng > 0 ? "NG" : "OK";
    const [newInspection] = await database.insert(productInspections).values({
      machineId: machine.id,
      serialNumber: metaData.serialNumber,
      productModel: metaData.productModel,
      factoryCode: metaData.factory,
      overallResult: overallResult,
      originalResult: overallResult,
      inspectionTime: metaData.startedAt ? new Date(metaData.startedAt) : new Date(),
    }).returning({ id: productInspections.id });
    
    linkedInspectionId = newInspection.id;
    createdInspection = true;
    
    // ✅ CREATE MEASUREMENT RESULTS WITH IMAGE URLs
    const measurementRecords = metaData.points
      .filter(point => point.fileName)
      .map((point, idx) => ({
        inspectionId: linkedInspectionId!,
        pointDefId: 0,
        measuredValue: point.value ? String(point.value) : null,
        result: (point.result || "NTF") as "OK" | "NG" | "NTF",
        imageUrl: `/api/aoi/image/${pkg.packageId}/${point.fileName}`,
        remark: `${point.name || point.code || `Point ${idx + 1}`}`,
      }));
    
    await database.insert(measurementResults).values(measurementRecords);
  }
}
```

### 2. Image URL Format
Ảnh được serve qua endpoint đã có sẵn:
```
/api/aoi/image/:packageId/:fileName
```

**Ví dụ:**
```
/api/aoi/image/INS-20260210-001/image_1.png
/api/aoi/image/INS-20260210-001/image_2.png
```

### 3. Logging Enhancement
```typescript
await logPackageActivity({
  event: "commit_success",
  message: `Package committed — 5 images, 5 points, inspection created`,
  detail: `Serial: SN-123, Model: PCB-V1, Result: NG, Inspection ID: 456 (NEW)`,
  metadata: {
    linkedInspectionId,
    createdInspection: true, // ✅ Track nếu tạo mới
  }
});
```

---

## 🧪 Testing Instructions

### Test Case 1: Upload Package với Serial Number Mới

**Bước 1: Presign**
```http
POST http://172.16.1.250:3001/api/trpc/aoiPackage.presign
Content-Type: application/json

{
  "apiKey": "avi_2642fa98f019d20aacac728270556d11204ebb7aaca2fdd6",
  "inspectionId": "TEST-NEW-001",
  "sizeBytes": 12345
}
```

**Bước 2: Upload ZIP**
```http
PUT http://172.16.1.250:3001/api/aoi/upload/TEST-NEW-001
Content-Type: application/zip
X-API-Key: avi_2642fa98f019d20aacac728270556d11204ebb7aaca2fdd6

[Binary ZIP file containing meta.json + images]
```

**Bước 3: Commit**
```http
POST http://172.16.1.250:3001/api/trpc/aoiPackage.commit
Content-Type: application/json

{
  "apiKey": "avi_2642fa98f019d20aacac728270556d11204ebb7aaca2fdd6",
  "packageId": "TEST-NEW-001"
}
```

**Expected Response:**
```json
{
  "result": {
    "data": {
      "success": true,
      "alreadyCommitted": false,
      "packageId": "TEST-NEW-001",
      "inspectionId": 123,  // ✅ NEW inspection ID created
      "imageCount": 5,
      "totalPoints": 5
    }
  }
}
```

**Bước 4: Verify trong History**
1. Mở trình duyệt: `http://172.16.1.250:3001/history`
2. Tìm kiếm serial number (ví dụ: `SN-TEST-001`)
3. ✅ **Phải thấy** record mới với:
   - Serial Number: SN-TEST-001
   - Result: OK/NG
   - Time: timestamp
4. Click **"View Details"** hoặc icon **"Eye"**
5. ✅ **Phải thấy** gallery ảnh với các ảnh từ ZIP

**Bước 5: Verify Image Tab**
1. Click tab **"Gallery Hình Ảnh Kiểm Tra"**
2. ✅ **Phải thấy** tất cả ảnh từ các package đã upload
3. Mỗi ảnh có:
   - Thumbnail
   - Title: Serial Number - Điểm X
   - Badge: OK/NG/NTF
   - Description: Point name + value

---

### Test Case 2: Upload Package với Serial Number Đã Tồn Tại

**Scenario:** Đã có inspection record cho serial `SN-EXISTING-001`

**Kết quả mong đợi:**
- ✅ **KHÔNG** tạo inspection mới
- ✅ Link với inspection đã có sẵn
- ⚠️ Measurement results **KHÔNG** được thêm (giữ nguyên logic cũ)

**Log message:**
```
Package committed — inspection linked (EXISTING)
```

---

### Test Case 3: Verify Image Serving

**Direct Image Access:**
```
http://172.16.1.250:3001/api/aoi/image/TEST-NEW-001/image_1.png
```

**Expected:**
- ✅ HTTP 200
- ✅ Content-Type: image/png (hoặc image/jpeg)
- ✅ Binary image data

**If Package Not Found:**
- ❌ HTTP 404
- Response: `{"message": "Package not found"}`

---

## 📊 Database Verification

### Query 1: Check Inspection Created
```sql
SELECT 
  id,
  serialNumber,
  productModel,
  overallResult,
  inspectionTime,
  createdAt
FROM product_inspections
WHERE serialNumber = 'SN-TEST-001'
ORDER BY createdAt DESC
LIMIT 1;
```

### Query 2: Check Measurement Results
```sql
SELECT 
  mr.id,
  mr.inspectionId,
  mr.result,
  mr.imageUrl,
  mr.remark,
  mr.measuredValue
FROM measurement_results mr
JOIN product_inspections pi ON pi.id = mr.inspectionId
WHERE pi.serialNumber = 'SN-TEST-001'
ORDER BY mr.id;
```

**Expected Columns:**
```
| id  | inspectionId | result | imageUrl                                      | remark        | measuredValue |
|-----|--------------|--------|-----------------------------------------------|---------------|---------------|
| 501 | 123          | OK     | /api/aoi/image/TEST-NEW-001/image_1.png      | Point 1 (0.5) | 0.5           |
| 502 | 123          | NG     | /api/aoi/image/TEST-NEW-001/image_2.png      | Point 2 (1.2) | 1.2           |
| 503 | 123          | OK     | /api/aoi/image/TEST-NEW-001/image_3.png      | Point 3 (0.8) | 0.8           |
```

### Query 3: Check Package Link
```sql
SELECT 
  ip.packageId,
  ip.serialNumber,
  ip.inspectionId,
  ip.status,
  ip.overallResult,
  pi.id as linked_inspection_id
FROM inspection_packages ip
LEFT JOIN product_inspections pi ON pi.id = ip.inspectionId
WHERE ip.packageId = 'TEST-NEW-001';
```

---

## 🐛 Troubleshooting

### Issue 1: Ảnh không hiển thị trong History

**Kiểm tra:**
1. Inspection record có được tạo không?
   ```sql
   SELECT * FROM product_inspections WHERE serialNumber = 'YOUR-SERIAL';
   ```

2. Measurement results có imageUrl không?
   ```sql
   SELECT imageUrl FROM measurement_results WHERE inspectionId = YOUR_ID;
   ```

3. Image endpoint có trả về ảnh không?
   ```bash
   curl http://172.16.1.250:3001/api/aoi/image/TEST-001/image_1.png
   ```

**Nguyên nhân có thể:**
- Package chưa commit (status != 'committed')
- meta.json không có serialNumber
- meta.json không có points array
- ZIP file corrupt hoặc không có images/

### Issue 2: Inspection không được tạo

**Kiểm tra:**
1. Check meta.json có serialNumber không:
   ```json
   {
     "inspectionId": "TEST-001",
     "serialNumber": "SN-123",  // ← Required!
     "productModel": "PCB-V1"
   }
   ```

2. Check server logs:
   ```
   [AOI] Package committed — inspection created
   ```

3. Check package activity logs:
   ```sql
   SELECT event, message, detail 
   FROM package_activity_logs 
   WHERE packageId = 'TEST-001' 
   ORDER BY createdAt DESC;
   ```

### Issue 3: CORS lỗi khi load ảnh

**Giải pháp:** CORS headers đã được config cho `/api/aoi/image/*`:
```typescript
res.setHeader("Access-Control-Allow-Origin", "*");
res.setHeader("Access-Control-Allow-Methods", "GET");
```

Nếu vẫn lỗi, check browser console:
```
Access to image at 'http://...' from origin 'http://...' has been blocked by CORS
```

---

## 📝 Testing Checklist

### Before Testing:
- [ ] Build thành công: `pnpm build`
- [ ] Server đang chạy: `pnpm dev` hoặc `pnpm start`
- [ ] Database connection OK
- [ ] Có API key hợp lệ

### Upload Flow:
- [ ] Presign success (200 OK)
- [ ] Upload ZIP success (200 OK)
- [ ] Commit success (200 OK)
- [ ] Log: "inspection created" (hoặc "EXISTING")

### History Page:
- [ ] Serial number có trong danh sách
- [ ] Result (OK/NG) hiển thị đúng
- [ ] Time hiển thị chính xác
- [ ] Click "View Details" mở chi tiết
- [ ] Tab "Gallery" có ảnh
- [ ] Ảnh load được (không broken)
- [ ] Click ảnh mở lightbox/full view

### Database:
- [ ] `product_inspections` có record mới
- [ ] `measurement_results` có records với imageUrl
- [ ] `inspection_packages.inspectionId` không null
- [ ] `package_activity_logs` có "commit_success"

---

## 🎉 Summary

**Bây giờ luồng hoàn chỉnh:**
1. Machine AOI upload ZIP → Server
2. Server commit package → **Tự động tạo inspection** + measurement results
3. Ảnh serve qua `/api/aoi/image/:packageId/:fileName`
4. History page → Query inspections → Hiển thị ảnh từ measurement results
5. User xem được ảnh trong History ✅

**Không cần:**
- ❌ Tạo inspection manually
- ❌ Upload ảnh riêng lẻ
- ❌ Config thêm gì
- ❌ Migration database

**Chỉ cần:**
- ✅ Upload ZIP với meta.json đúng format
- ✅ Commit package
- ✅ Mở History và xem ảnh!
