# Integration Examples — Ví dụ tích hợp đa ngôn ngữ

Tài liệu này cung cấp ví dụ tích hợp hoàn chỉnh cho các ngôn ngữ phổ biến.

---

## Mục lục

1. [Python — Full Integration](#python--full-integration)
2. [C# (.NET) — Full Integration](#c-net--full-integration)
3. [JavaScript / Node.js](#javascript--nodejs)
4. [cURL — Quick Reference](#curl--quick-reference)
5. [Workflow Patterns](#workflow-patterns)

---

## Python — Full Integration

### Cài đặt

```bash
pip install requests
```

### Client Class

```python
import requests
import base64
import json
from urllib.parse import quote
from typing import Optional

class AviAoiClient:
    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.session = requests.Session()

    def _query(self, path: str, input_data: dict) -> dict:
        """Gọi tRPC query (GET)."""
        input_data["apiKey"] = self.api_key
        encoded = quote(json.dumps({"json": input_data}))
        url = f"{self.base_url}/api/trpc/{path}?input={encoded}"
        resp = self.session.get(url, timeout=30)
        resp.raise_for_status()
        return resp.json()["result"]["data"]["json"]

    def _mutate(self, path: str, input_data: dict) -> dict:
        """Gọi tRPC mutation (POST)."""
        input_data["apiKey"] = self.api_key
        url = f"{self.base_url}/api/trpc/{path}"
        resp = self.session.post(url, json={"json": input_data}, timeout=60)
        resp.raise_for_status()
        return resp.json()["result"]["data"]["json"]

    # ─── Machine API ───────────────────────────────────────
    def heartbeat(self, machine_code: str) -> dict:
        return self._mutate("machineApi.heartbeat", {
            "machineCode": machine_code
        })

    def check_points_version(self, product_code: str) -> dict:
        return self._query("machineApi.checkPointsVersion", {
            "productCode": product_code
        })

    def get_points(self, product_code: str) -> dict:
        return self._query("machineApi.getPoints", {
            "productCode": product_code
        })

    def submit_inspection(self, product_code: str, measurements: list,
                          lot_number: str = None, serial_number: str = None,
                          operator_name: str = None) -> dict:
        data = {
            "productCode": product_code,
            "measurements": measurements,
        }
        if lot_number: data["lotNumber"] = lot_number
        if serial_number: data["serialNumber"] = serial_number
        if operator_name: data["operatorName"] = operator_name
        return self._mutate("machineApi.submitInspection", data)

    def upload_image(self, inspection_id: int, image_path: str,
                     measurement_result_id: int = None,
                     image_type: str = "inspection") -> dict:
        with open(image_path, "rb") as f:
            image_b64 = base64.b64encode(f.read()).decode()
        data = {
            "inspectionId": inspection_id,
            "imageBase64": image_b64,
            "imageType": image_type,
        }
        if measurement_result_id:
            data["measurementResultId"] = measurement_result_id
        return self._mutate("machineApi.uploadImage", data)

    def sync_measurement_points(self, product_code: str, points: list,
                                 image_width: int = None,
                                 image_height: int = None) -> dict:
        data = {
            "productCode": product_code,
            "points": points,
        }
        if image_width: data["imageWidth"] = image_width
        if image_height: data["imageHeight"] = image_height
        return self._mutate("machineApi.syncMeasurementPoints", data)

    def delta_sync_points(self, product_code: str, last_version: int) -> dict:
        return self._query("machineApi.deltaSyncPoints", {
            "productCode": product_code,
            "lastVersion": last_version,
        })

    # ─── Product API ──────────────────────────────────────
    def list_products(self, search: str = None, limit: int = 50) -> dict:
        data = {}
        if search: data["search"] = search
        data["limit"] = limit
        return self._query("publicProductApi.listProducts", data)

    def get_product(self, code: str) -> dict:
        return self._query("publicProductApi.getProductByCode", {
            "code": code
        })

    def get_product_image(self, product_code: str) -> dict:
        return self._query("publicProductApi.getProductImage", {
            "productCode": product_code
        })

    def get_point_image(self, point_code: str, product_code: str) -> dict:
        return self._query("publicProductApi.getPointImage", {
            "pointCode": point_code,
            "productCode": product_code,
        })


# ─── Sử dụng ─────────────────────────────────────────────
if __name__ == "__main__":
    client = AviAoiClient(
        base_url="http://192.168.1.100:3000",
        api_key="your-machine-api-key"
    )

    # 1. Heartbeat
    client.heartbeat("MACHINE-001")

    # 2. Lấy danh sách sản phẩm
    products = client.list_products()
    print(f"Có {products['total']} sản phẩm")

    # 3. Lấy điểm đo
    product_code = "PROD-A"
    version_info = client.check_points_version(product_code)
    points = client.get_points(product_code)
    print(f"Product {product_code} có {len(points['data'])} điểm đo")

    # 4. Submit inspection
    result = client.submit_inspection(
        product_code=product_code,
        lot_number="LOT-2024-001",
        serial_number="SN-00001",
        measurements=[
            {
                "pointId": 101,
                "numericValue": 5.02,
            },
            {
                "pointCode": "VISUAL-01",
                "textValue": "OK",
            },
            {
                "pointId": 102,
                "numericValue": 3.8,
                "imageBase64": base64.b64encode(
                    open("check_102.jpg", "rb").read()
                ).decode()
            }
        ]
    )
    print(f"Inspection #{result['inspectionId']}: {result['overallResult']}")
```

---

## C# (.NET) — Full Integration

### NuGet Packages

```xml
<PackageReference Include="System.Net.Http.Json" Version="8.0.*" />
<PackageReference Include="System.Text.Json" Version="8.0.*" />
```

### Client Class

```csharp
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Web;

public class AviAoiClient : IDisposable
{
    private readonly HttpClient _http;
    private readonly string _baseUrl;
    private readonly string _apiKey;
    private readonly JsonSerializerOptions _jsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public AviAoiClient(string baseUrl, string apiKey)
    {
        _baseUrl = baseUrl.TrimEnd('/');
        _apiKey = apiKey;
        _http = new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
    }

    private async Task<JsonElement> QueryAsync(string path, object input)
    {
        var inputDict = JsonSerializer.SerializeToElement(input, _jsonOpts);
        var wrapper = new { json = MergeApiKey(inputDict) };
        var encoded = HttpUtility.UrlEncode(JsonSerializer.Serialize(wrapper, _jsonOpts));
        var url = $"{_baseUrl}/api/trpc/{path}?input={encoded}";

        var response = await _http.GetAsync(url);
        response.EnsureSuccessStatusCode();
        var doc = await response.Content.ReadFromJsonAsync<JsonElement>();
        return doc.GetProperty("result").GetProperty("data").GetProperty("json");
    }

    private async Task<JsonElement> MutateAsync(string path, object input)
    {
        var inputDict = JsonSerializer.SerializeToElement(input, _jsonOpts);
        var wrapper = new { json = MergeApiKey(inputDict) };
        var url = $"{_baseUrl}/api/trpc/{path}";

        var response = await _http.PostAsJsonAsync(url, wrapper, _jsonOpts);
        response.EnsureSuccessStatusCode();
        var doc = await response.Content.ReadFromJsonAsync<JsonElement>();
        return doc.GetProperty("result").GetProperty("data").GetProperty("json");
    }

    private JsonElement MergeApiKey(JsonElement input)
    {
        var dict = JsonSerializer.Deserialize<Dictionary<string, object>>(input);
        dict!["apiKey"] = _apiKey;
        return JsonSerializer.SerializeToElement(dict, _jsonOpts);
    }

    // ─── Machine API ────────────────────────────────────
    public Task<JsonElement> HeartbeatAsync(string machineCode)
        => MutateAsync("machineApi.heartbeat", new { machineCode });

    public Task<JsonElement> CheckPointsVersionAsync(string productCode)
        => QueryAsync("machineApi.checkPointsVersion", new { productCode });

    public Task<JsonElement> GetPointsAsync(string productCode)
        => QueryAsync("machineApi.getPoints", new { productCode });

    public async Task<JsonElement> SubmitInspectionAsync(
        string productCode,
        object[] measurements,
        string? lotNumber = null,
        string? serialNumber = null)
    {
        var data = new Dictionary<string, object>
        {
            ["productCode"] = productCode,
            ["measurements"] = measurements,
        };
        if (lotNumber != null) data["lotNumber"] = lotNumber;
        if (serialNumber != null) data["serialNumber"] = serialNumber;
        return await MutateAsync("machineApi.submitInspection", data);
    }

    public async Task<JsonElement> UploadImageAsync(
        int inspectionId,
        string imagePath,
        int? measurementResultId = null)
    {
        var imageBytes = await File.ReadAllBytesAsync(imagePath);
        var imageBase64 = Convert.ToBase64String(imageBytes);
        var data = new Dictionary<string, object>
        {
            ["inspectionId"] = inspectionId,
            ["imageBase64"] = imageBase64,
            ["imageType"] = "inspection",
        };
        if (measurementResultId.HasValue)
            data["measurementResultId"] = measurementResultId.Value;
        return await MutateAsync("machineApi.uploadImage", data);
    }

    // ─── Product API ────────────────────────────────────
    public Task<JsonElement> ListProductsAsync(string? search = null, int limit = 50)
        => QueryAsync("publicProductApi.listProducts", new { search, limit });

    public Task<JsonElement> GetProductAsync(string code)
        => QueryAsync("publicProductApi.getProductByCode", new { code });

    public void Dispose() => _http.Dispose();
}

// ─── Sử dụng ────────────────────────────────────────────
// using var client = new AviAoiClient("http://192.168.1.100:3000", "your-api-key");
// var result = await client.SubmitInspectionAsync(
//     "PROD-A",
//     new object[]
//     {
//         new { pointId = 101, numericValue = 5.02 },
//         new { pointCode = "VISUAL-01", textValue = "OK" },
//     },
//     lotNumber: "LOT-2024-001"
// );
```

---

## JavaScript / Node.js

```javascript
const BASE_URL = "http://192.168.1.100:3000";
const API_KEY = "your-machine-api-key";

// ─── Query helper (GET) ──────────────────────────────────
async function trpcQuery(path, input) {
  input.apiKey = API_KEY;
  const encoded = encodeURIComponent(JSON.stringify({ json: input }));
  const url = `${BASE_URL}/api/trpc/${path}?input=${encoded}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.result.data.json;
}

// ─── Mutation helper (POST) ──────────────────────────────
async function trpcMutate(path, input) {
  input.apiKey = API_KEY;
  const url = `${BASE_URL}/api/trpc/${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json: input }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.result.data.json;
}

// ─── Sử dụng ─────────────────────────────────────────────
async function main() {
  // Heartbeat
  await trpcMutate("machineApi.heartbeat", { machineCode: "MACHINE-001" });

  // Lấy sản phẩm
  const products = await trpcQuery("publicProductApi.listProducts", {
    search: "PROD",
    limit: 10,
  });
  console.log(`Tìm thấy ${products.total} sản phẩm`);

  // Submit inspection
  const result = await trpcMutate("machineApi.submitInspection", {
    productCode: "PROD-A",
    lotNumber: "LOT-2024-001",
    measurements: [
      { pointId: 101, numericValue: 5.02 },
      { pointCode: "VISUAL-01", textValue: "OK" },
    ],
  });
  console.log(`Kết quả: ${result.overallResult}`);

  // Upload ảnh (Node.js with fs)
  const fs = require("fs");
  const imageBase64 = fs.readFileSync("check.jpg").toString("base64");
  await trpcMutate("machineApi.uploadImage", {
    inspectionId: result.inspectionId,
    imageBase64,
    imageType: "inspection",
  });
}

main().catch(console.error);
```

---

## cURL — Quick Reference

### Query (GET)

```bash
# Lấy danh sách sản phẩm
INPUT='{"json":{"apiKey":"your-key","search":"PROD","limit":10}}'
curl "http://localhost:3000/api/trpc/publicProductApi.listProducts?input=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$INPUT'))")"

# Kiểm tra version điểm đo
INPUT='{"json":{"apiKey":"your-key","productCode":"PROD-A"}}'
curl "http://localhost:3000/api/trpc/machineApi.checkPointsVersion?input=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$INPUT'))")"
```

### Mutation (POST)

```bash
# Heartbeat
curl -X POST http://localhost:3000/api/trpc/machineApi.heartbeat \
  -H "Content-Type: application/json" \
  -d '{"json":{"apiKey":"your-key","machineCode":"MACHINE-001"}}'

# Submit inspection
curl -X POST http://localhost:3000/api/trpc/machineApi.submitInspection \
  -H "Content-Type: application/json" \
  -d '{
    "json": {
      "apiKey": "your-key",
      "productCode": "PROD-A",
      "lotNumber": "LOT-001",
      "measurements": [
        {"pointId": 101, "numericValue": 5.02},
        {"pointCode": "VISUAL-01", "textValue": "OK"}
      ]
    }
  }'
```

---

## Workflow Patterns

### Pattern 1: Khởi động máy

```
1. heartbeat(machineCode)           → Đăng ký máy online
2. listProducts()                    → Lấy danh sách sản phẩm
3. getPoints(productCode)           → Tải điểm đo
4. getProductImage(productCode)     → Tải ảnh tham chiếu
5. Cho từng point có ảnh:
   getPointImage(pointCode, productCode) → Tải ảnh tham chiếu điểm
```

### Pattern 2: Vòng lặp kiểm tra

```
Repeat:
  1. submitInspection(productCode, measurements)
     → Nhận inspectionId, overallResult
  2. Nếu có ảnh cần upload:
     uploadImage(inspectionId, imageBase64)
  3. Kiểm tra overallResult:
     - "OK"  → tiếp tục
     - "NG"  → xử lý cảnh báo, có thể dừng line
```

### Pattern 3: Đồng bộ định kỳ

```
Lưu lastVersion local.

Mỗi 5 phút:
  1. checkPointsVersion(productCode)
     → So sánh version với lastVersion
  2. Nếu version mới hơn:
     deltaSyncPoints(productCode, lastVersion)
     → Chỉ nhận points đã thay đổi
     → Cập nhật lastVersion = currentVersion
```

### Pattern 4: AI Inference tích hợp

```
1. getActiveForProduct(productModelId)   → Lấy model đang active
2. Cho mỗi ảnh kiểm tra:
   runInference(modelId, imageBase64)
   → predictions: [{label, confidence}]
3. Dựa theo confidence threshold:
   - confidence >= 0.7 → tự động phân loại
   - confidence < 0.7  → cần kiểm tra thủ công
```

---

## Lưu ý quan trọng

1. **Rate Limiting**: Tối đa 1000 requests / 15 phút. Implement retry logic cho 429.
2. **Body Size**: Tối đa 50MB. Ảnh base64 sẽ lớn hơn ~33% so với file gốc.
3. **Encoding**: Tất cả string phải là UTF-8.
4. **Base64**: Sử dụng standard base64 (không phải URL-safe base64).
5. **Timeout**: Khuyến nghị timeout 30s cho query, 60s cho mutation (đặc biệt upload ảnh).
6. **Connection Reuse**: Sử dụng connection pooling / session để tái sử dụng TCP connection.
