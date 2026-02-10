# Hướng dẫn Upload từ phần mềm C# (AOI/AVI)

## Tổng quan
API hỗ trợ upload ảnh AOI/AVI theo 2 phương thức:
1. **ZIP Package Upload** (khuyến nghị): Upload file ZIP chứa nhiều ảnh + metadata
2. **Single Image Upload**: Upload từng ảnh riêng lẻ

## Phương thức 1: ZIP Package Upload (Khuyến nghị)

### Bước 1: Gọi Presign Endpoint
```http
POST /api/trpc/aoiPackage.presign
Content-Type: application/json

{
  "apiKey": "YOUR_API_KEY",
  "inspectionId": "unique-inspection-id",
  "sizeBytes": 12345678,
  "sha256": "optional-file-hash"
}
```

**Response:**
```json
{
  "result": {
    "data": {
      "success": true,
      "packageId": "unique-inspection-id",
      "uploadUrl": "/api/aoi/upload/unique-inspection-id",
      "expiresAt": "2026-02-10T..."
    }
  }
}
```

### Bước 2: Upload ZIP file
```http
PUT /api/aoi/upload/{packageId}
Content-Type: application/zip
Content-Length: 12345678
x-api-key: YOUR_API_KEY

[BINARY ZIP DATA]
```

**Quan trọng:**
- **Content-Type**: Phải là `application/zip` hoặc `application/octet-stream`
- **Headers bắt buộc**: 
  - `x-api-key` HOẶC `x-machine-code`
  - `Content-Length`
- **Body**: Binary data của file ZIP (không encode base64)
- **Kích thước tối đa**: 200MB

### Bước 3: Commit Package
```http
POST /api/trpc/aoiPackage.commit
Content-Type: application/json

{
  "apiKey": "YOUR_API_KEY",
  "packageId": "unique-inspection-id"
}
```

## Phương thức 2: Single Image Upload

```http
POST /api/machine/upload-image
Content-Type: application/json
x-api-key: YOUR_API_KEY

{
  "image": "base64_encoded_image_data",
  "inspectionId": "unique-inspection-id",
  "imageName": "image1.jpg",
  "machineCode": "optional-machine-code"
}
```

## C# Code Example

### Quan trọng về CORS và Headers

Khi gọi từ C# application (không phải browser), cần:
1. ✅ Set đầy đủ headers (Content-Type, X-API-Key, X-Machine-Code)
2. ✅ Đảm bảo Content-Type là `application/zip` hoặc `application/octet-stream`
3. ✅ Gửi binary data trực tiếp (không encode)
4. ✅ Header names có thể dùng lowercase hoặc PascalCase (server hỗ trợ cả 2)

### Upload ZIP Package
```csharp
using System;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

public class AoiUploadClient
{
    private readonly HttpClient _httpClient;
    private readonly string _apiKey;
    private readonly string _baseUrl;

    public AoiUploadClient(string baseUrl, string apiKey)
    {
        _baseUrl = baseUrl.TrimEnd('/');
        _apiKey = apiKey;
        _httpClient = new HttpClient
        {
            Timeout = TimeSpan.FromMinutes(10)
        };
    }

    public async Task<string> UploadZipPackageAsync(string zipFilePath, string inspectionId)
    {
        try
        {
            // Step 1: Get file info
            var fileInfo = new FileInfo(zipFilePath);
            if (!fileInfo.Exists)
                throw new FileNotFoundException("ZIP file not found", zipFilePath);

            Console.WriteLine($"[Upload] File: {zipFilePath}, Size: {fileInfo.Length} bytes");

            // Step 2: Call presign
            var presignUrl = $"{_baseUrl}/api/trpc/aoiPackage.presign";
            var presignPayload = new
            {
                apiKey = _apiKey,
                inspectionId = inspectionId,
                sizeBytes = fileInfo.Length
            };

            var presignJson = JsonSerializer.Serialize(presignPayload);
            var presignContent = new StringContent(presignJson, Encoding.UTF8, "application/json");

            Console.WriteLine($"[Presign] Calling {presignUrl}...");
            var presignResponse = await _httpClient.PostAsync(presignUrl, presignContent);
            var presignResponseText = await presignResponse.Content.ReadAsStringAsync();
            
            if (!presignResponse.IsSuccessStatusCode)
            {
                throw new Exception($"Presign failed: {presignResponse.StatusCode} - {presignResponseText}");
            }

            Console.WriteLine($"[Presign] Success: {presignResponseText}");

            // Parse presign response
            var presignResult = JsonSerializer.Deserialize<PresignResponse>(presignResponseText);
            var uploadUrl = presignResult?.result?.data?.uploadUrl;
            var packageId = presignResult?.result?.data?.packageId;

            if (string.IsNullOrEmpty(uploadUrl))
                throw new Exception("Upload URL not received from presign");

            // Step 3: Upload ZIP
            var fullUploadUrl = $"{_baseUrl}{uploadUrl}";
            Console.WriteLine($"[Upload] Uploading to {fullUploadUrl}...");

            using (var fileStream = File.OpenRead(zipFilePath))
            using (var request = new HttpRequestMessage(HttpMethod.Put, fullUploadUrl))
            {
                // Set headers (case-insensitive, both x-api-key and X-API-Key work)
                request.Headers.Add("X-API-Key", _apiKey);
                request.Headers.Add("X-Machine-Code", "YOUR-MACHINE-CODE"); // Optional but recommended
                
                // Set content
                var streamContent = new StreamContent(fileStream);
                streamContent.Headers.ContentType = new MediaTypeHeaderValue("application/zip");
                // Alternative: application/octet-stream
                // streamContent.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
                streamContent.Headers.ContentLength = fileInfo.Length;
                request.Content = streamContent;

                // Send request
                var uploadResponse = await _httpClient.SendAsync(request);
                var uploadResponseText = await uploadResponse.Content.ReadAsStringAsync();

                if (!uploadResponse.IsSuccessStatusCode)
                {
                    throw new Exception($"Upload failed: {uploadResponse.StatusCode} - {uploadResponseText}");
                }

                Console.WriteLine($"[Upload] Success: {uploadResponseText}");
            }

            // Step 4: Commit package
            var commitUrl = $"{_baseUrl}/api/trpc/aoiPackage.commit";
            var commitPayload = new
            {
                apiKey = _apiKey,
                packageId = packageId
            };

            var commitJson = JsonSerializer.Serialize(commitPayload);
            var commitContent = new StringContent(commitJson, Encoding.UTF8, "application/json");

            Console.WriteLine($"[Commit] Calling {commitUrl}...");
            var commitResponse = await _httpClient.PostAsync(commitUrl, commitContent);
            var commitResponseText = await commitResponse.Content.ReadAsStringAsync();

            if (!commitResponse.IsSuccessStatusCode)
            {
                throw new Exception($"Commit failed: {commitResponse.StatusCode} - {commitResponseText}");
            }

            Console.WriteLine($"[Commit] Success: {commitResponseText}");
            return packageId;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Error] {ex.Message}");
            Console.WriteLine($"[Error] Stack: {ex.StackTrace}");
            throw;
        }
    }

    // Response models
    private class PresignResponse
    {
        public PresignResult result { get; set; }
    }

    private class PresignResult
    {
        public PresignData data { get; set; }
    }

    private class PresignData
    {
        public bool success { get; set; }
        public string packageId { get; set; }
        public string uploadUrl { get; set; }
        public string expiresAt { get; set; }
    }
}

// Usage
var client = new AoiUploadClient("http://172.16.1.250:3001", "your-api-key-here");
var packageId = await client.UploadZipPackageAsync(@"C:\path\to\inspection.zip", "INS-2026-001");
Console.WriteLine($"Upload complete! Package ID: {packageId}");
```

## TroubleshX-API-Key` header có đúng không (cả lowercase và PascalCase đều được)
- Đảm bảo API key có quyền upload
- Header name: `x-api-key`, `X-API-Key`, `X-Api-Key` đều OK

### Lỗi 400 Empty request body
- **Nguyên nhân**: Content-Type không đúng hoặc body không có data
- **Giải pháp**: 
  - Đặt `Content-Type: application/zip` HOẶC `application/octet-stream`
  - Không dùng `multipart/form-data` hoặc `application/json`
  - Gửi binary data trực tiếp trong body (không encode base64)
  - Kiểm tra file có tồn tại và có dữ liệu không

### Lỗi CORS (từ browser)
- **Chú ý**: C# applications **KHÔNG** bị ảnh hưởng bởi CORS
- CORS chỉ áp dụng cho browser-based requests
- Nếu test từ browser (HTML/JavaScript):
  - Server đã cấu hình CORS cho phép tất cả origins
  - Preflight OPTIONS request được xử lý tự động
  - Headers: Content-Type, X-API-Key, X-Machine-Code đều được phép

### Lỗi từ C# HttpClient
- **Connection refused**: Kiểm tra server có đang chạy không
- **Timeout**: Tăng `HttpClient.Timeout` cho file lớn
  ```csharp
  _httpClient.Timeout = TimeSpan.FromMinutes(10);
  ```
- **SSL/TLS error**: Nếu dùng HTTPS tự ký, có thể cần:
  ```csharp
  var handler = new HttpClientHandler
  {
      ServerCertificateCustomValidationCallback = (message, cert, chain, errors) => true
  };
  _httpClient = new HttpClient(handler);
  ```
  - URL có đúng không (http vs https)
  - Port có đúng không
  - OPTIONS preflight request có thành công không

### Lỗi Timeout
- File lớn có thể mất thời gian upload
- Tăng timeout của HttpClient:
  ```csharp
  _httpClient.Timeout = TimeSpan.FromMinutes(10);
  ```

### Lỗi 413 Payload Too Large
- Kích thước file vượt quá 200MB
- Giải pháp: Nén file hoặc chia nhỏ ra

## Kiểm tra Logs
Server sẽ ghi logs chi tiết:
```
[AOI-Upload] Request for {packageId}: Content-Type=..., Content-Length=..., API-Key=..., Machine-Code=...
[AOI-Upload] Body received: {size} bytes for {packageId}
[AOI] ZIP uploaded: {packageId} ({size}MB) from machine {code} in {time}ms
```

Nếu gặp lỗi, kiểm tra logs server để xem chi tiết.

## Liên hệ
Nếu vẫn gặp lỗi, cung cấp:
1. Status code của response
2. Response body (error message)
3. Request headers (đã gửi)
4. Logs từ server (nếu có access)
