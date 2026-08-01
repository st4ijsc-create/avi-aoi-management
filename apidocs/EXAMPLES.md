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
        self.api_key = api_key          # khóa mk_... (khuyến nghị)
        self.session = requests.Session()
        # KHUYẾN NGHỊ: gửi khóa qua header (được ưu tiên hơn body apiKey).
        # Các procedure có ràng buộc apiKey||machineCode vẫn cần apiKey trong body
        # để qua kiểm tra input, nên _query/_mutate dưới đây vẫn gắn apiKey vào body.
        self.session.headers.update({"Authorization": f"Bearer {api_key}"})

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

    def check_points_version(self, product_model_code: str) -> dict:
        return self._query("machineApi.checkPointsVersion", {
            "productModelCode": product_model_code
        })

    def get_points(self, product_model_code: str) -> dict:
        return self._query("machineApi.getPoints", {
            "productModelCode": product_model_code
        })

    def submit_inspection(self, serial_number: str, overall_result: str,
                          measurements: list, product_model: str = None,
                          batch_number: str = None, idempotency_key: str = None,
                          points_config_version: int = None,
                          inspection_time: str = None) -> dict:
        # BẮT BUỘC: serial_number, overall_result ("OK"|"NG"|"NTF"),
        #           và mỗi measurement phải có "result".
        data = {
            "serialNumber": serial_number,       # BẮT BUỘC
            "overallResult": overall_result,     # BẮT BUỘC — "OK"|"NG"|"NTF"
            "measurements": measurements,
        }
        if product_model: data["productModel"] = product_model
        if batch_number: data["batchNumber"] = batch_number
        if inspection_time: data["inspectionTime"] = inspection_time  # ISO, NÊN kèm offset
        if idempotency_key: data["idempotencyKey"] = idempotency_key  # ổn định qua retry
        if points_config_version is not None:
            data["pointsConfigVersion"] = points_config_version
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

    def sync_measurement_points(self, product_model_code: str, points: list,
                                 source_image_width: int = None,
                                 source_image_height: int = None) -> dict:
        data = {
            "productModelCode": product_model_code,
            "points": points,
        }
        if source_image_width: data["sourceImageWidth"] = source_image_width
        if source_image_height: data["sourceImageHeight"] = source_image_height
        return self._mutate("machineApi.syncMeasurementPoints", data)

    def delta_sync_points(self, product_model_code: str, since_version: int) -> dict:
        return self._query("machineApi.deltaSyncPoints", {
            "productModelCode": product_model_code,
            "sinceVersion": since_version,
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
    product_model_code = "PROD-A"
    version_info = client.check_points_version(product_model_code)
    points = client.get_points(product_model_code)

    # 4. Submit inspection — serialNumber + overallResult BẮT BUỘC;
    #    mỗi measurement PHẢI có "result".
    import uuid
    result = client.submit_inspection(
        serial_number="SN-00001",
        overall_result="OK",                 # "OK" | "NG" | "NTF"
        product_model=product_model_code,
        batch_number="LOT-2024-001",
        idempotency_key=str(uuid.uuid4()),   # tái dùng cho mọi lần retry của board này
        inspection_time="2026-07-16T08:00:00+07:00",
        measurements=[
            { "pointCode": "CHECK-01", "measuredValue": 5.02, "result": "OK" },
            { "pointCode": "VISUAL-01", "measuredValue": "OK", "result": "OK" },
            {
                "pointCode": "CHECK-02",
                "measuredValue": 3.8,
                "result": "OK",
                "valueHeight": 0.21,
                "imageBase64": base64.b64encode(
                    open("check_102.jpg", "rb").read()
                ).decode()
            }
        ]
    )
    # Response: {success, inspectionId} — có thể kèm duplicate:true (retry đã nhận)
    # hoặc queued:true + inspectionId:null (store-forward khi DB tạm sập).
    if result.get("queued"):
        print(f"Đã đệm store-forward: submissionId={result['submissionId']}")
    elif result.get("duplicate"):
        print(f"Trùng (đã ghi trước đó): inspectionId={result['inspectionId']}")
    else:
        print(f"Inspection #{result['inspectionId']}: success={result['success']}")
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
        // Khóa mk_ qua header (ưu tiên hơn body). MergeApiKey vẫn gắn apiKey vào
        // body vì các procedure có ràng buộc apiKey||machineCode.
        _http.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", apiKey);
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

    public Task<JsonElement> CheckPointsVersionAsync(string productModelCode)
        => QueryAsync("machineApi.checkPointsVersion", new { productModelCode });

    public Task<JsonElement> GetPointsAsync(string productModelCode)
        => QueryAsync("machineApi.getPoints", new { productModelCode });

    public async Task<JsonElement> SubmitInspectionAsync(
        string serialNumber,           // BẮT BUỘC
        string overallResult,          // BẮT BUỘC — "OK"|"NG"|"NTF"
        object[] measurements,         // mỗi phần tử phải có "result"
        string? productModel = null,
        string? batchNumber = null,
        string? idempotencyKey = null,
        int? pointsConfigVersion = null,
        string? inspectionTime = null)
    {
        var data = new Dictionary<string, object>
        {
            ["serialNumber"] = serialNumber,
            ["overallResult"] = overallResult,
            ["measurements"] = measurements,
        };
        if (productModel != null) data["productModel"] = productModel;
        if (batchNumber != null) data["batchNumber"] = batchNumber;
        if (idempotencyKey != null) data["idempotencyKey"] = idempotencyKey;
        if (inspectionTime != null) data["inspectionTime"] = inspectionTime;
        if (pointsConfigVersion.HasValue) data["pointsConfigVersion"] = pointsConfigVersion.Value;
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
// using var client = new AviAoiClient("http://192.168.1.100:3000", "mk_your-machine-key");
// var result = await client.SubmitInspectionAsync(
//     serialNumber: "SN-00001",
//     overallResult: "OK",
//     measurements: new object[]
//     {
//         new { pointCode = "CHECK-01", measuredValue = 5.02, result = "OK" },
//         new { pointCode = "VISUAL-01", measuredValue = "OK", result = "OK" },
//     },
//     productModel: "PROD-A",
//     batchNumber: "LOT-2024-001",
//     idempotencyKey: Guid.NewGuid().ToString()
// );
```

---

## JavaScript / Node.js

```javascript
const BASE_URL = "http://192.168.1.100:3000";
const API_KEY = "mk_your-machine-key";
const AUTH_HEADERS = { "Authorization": `Bearer ${API_KEY}` }; // ưu tiên hơn body apiKey

// ─── Query helper (GET) ──────────────────────────────────
async function trpcQuery(path, input) {
  input.apiKey = API_KEY; // vẫn cần trong body cho procedure có ràng buộc
  const encoded = encodeURIComponent(JSON.stringify({ json: input }));
  const url = `${BASE_URL}/api/trpc/${path}?input=${encoded}`;
  const res = await fetch(url, { headers: AUTH_HEADERS });
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
    headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
    body: JSON.stringify({ json: input }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.result.data.json;
}

// ─── Sử dụng ─────────────────────────────────────────────
async function main() {
  // Heartbeat
  await trpcMutate("machineApi.heartbeat", { apiKey: API_KEY });

  // Submit inspection — serialNumber + overallResult BẮT BUỘC; mỗi measurement có "result".
  const result = await trpcMutate("machineApi.submitInspection", {
    serialNumber: "SN-00001",
    overallResult: "OK",              // "OK" | "NG" | "NTF"
    productModel: "PROD-A",
    batchNumber: "LOT-2024-001",
    idempotencyKey: crypto.randomUUID(),
    inspectionTime: new Date().toISOString(),
    measurements: [
      { pointCode: "CHECK-01", measuredValue: 5.02, result: "OK" },
      { pointCode: "VISUAL-01", measuredValue: "OK", result: "OK" },
    ],
  });
  // { success, inspectionId } — hoặc { duplicate:true } / { queued:true, inspectionId:null }
  console.log(result.queued ? `Queued ${result.submissionId}` : `Inspection #${result.inspectionId}`);

  // Upload ảnh bổ sung cho 1 điểm (Node.js with fs)
  const fs = require("fs");
  const imageBase64 = fs.readFileSync("check.jpg").toString("base64");
  if (result.inspectionId) {
    await trpcMutate("machineApi.uploadImage", {
      apiKey: API_KEY,
      inspectionId: result.inspectionId,
      pointCode: "CHECK-01",
      imageBase64,
    });
  }
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
INPUT='{"json":{"apiKey":"mk_your-key","productModelCode":"PROD-A"}}'
curl "http://localhost:3000/api/trpc/machineApi.checkPointsVersion?input=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$INPUT'))")"
```

### Mutation (POST)

```bash
# Heartbeat (khóa mk_ qua header Bearer + body)
curl -X POST http://localhost:3000/api/trpc/machineApi.heartbeat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mk_your-key" \
  -d '{"json":{"apiKey":"mk_your-key"}}'

# Submit inspection — serialNumber + overallResult BẮT BUỘC; mỗi measurement có "result".
curl -X POST http://localhost:3000/api/trpc/machineApi.submitInspection \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mk_your-key" \
  -d '{
    "json": {
      "apiKey": "mk_your-key",
      "serialNumber": "SN-00001",
      "overallResult": "OK",
      "productModel": "PROD-A",
      "batchNumber": "LOT-001",
      "idempotencyKey": "3f9c1a7e-8b2d-4e11-9c33-aa0011223344",
      "measurements": [
        {"pointCode": "CHECK-01", "measuredValue": 5.02, "result": "OK"},
        {"pointCode": "VISUAL-01", "measuredValue": "OK", "result": "OK"}
      ]
    }
  }'
```

---

## Workflow Patterns

### Pattern 1: Khởi động máy

```
1. heartbeat(apiKey)                        → Đăng ký máy online
2. getPoints(productModelCode)              → Tải điểm đo (machineApi.getPoints)
3. getProductImage(productModelCode)        → Tải ảnh tham chiếu (machineApi.getProductImage)
4. Cho từng point có ảnh:
   getPointImage(productModelCode, pointCode) → Tải ảnh tham chiếu điểm
```

### Pattern 2: Vòng lặp kiểm tra

```
Repeat:
  1. submitInspection(serialNumber, overallResult, measurements[, productModel, idempotencyKey])
     → Nhận { success, inspectionId } (hoặc duplicate:true / queued:true)
  2. Nếu cần upload thêm ảnh cho 1 điểm:
     uploadImage(inspectionId, pointCode, imageBase64)
  3. Xử lý theo overallResult ĐÃ GỬI:
     - "OK"  → tiếp tục
     - "NG"  → xử lý cảnh báo, có thể dừng line
  Lưu ý: kết quả OK/NG do MÁY quyết định trong request; response KHÔNG trả lại overallResult.
```

### Pattern 3: Đồng bộ định kỳ

```
Lưu lastVersion local theo productModelCode.

Mỗi 5 phút:
  1. checkPointsVersion(productModelCode)
     → So sánh pointsConfigVersion với lastVersion
  2. Nếu version server mới hơn:
     deltaSyncPoints(productModelCode, sinceVersion = lastVersion)
     → Nhận points đã thay đổi + deletedCodes (điểm phải NGỪNG kiểm)
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

1. **Rate Limiting**: KHÔNG phải "1000/15 phút" (số cũ SAI). Ingest inspection mặc định **600
   request/phút/máy** (tầng ứng dụng) dưới trần HTTP 60 000/phút/máy; login 30/15 phút. Vượt → `429`
   kèm `Retry-After`. Xem [ERROR_CODES.md §Rate Limiting](ERROR_CODES.md#rate-limiting). Retry `429`, `503` (DB tạm sập), `500`.
2. **Idempotency**: gửi `idempotencyKey` ỔN ĐỊNH qua mọi lần retry của cùng board để chống ghi trùng.
   Response có thể là `{duplicate:true}` (đã ghi) hoặc `{queued:true, inspectionId:null}` (đã đệm store-forward).
3. **Body Size**: `/api/trpc/*` & `/api/machine/*` tối đa **200MB**; đường khác 25MB. Từng ảnh base64 ≤
   `MACHINE_INGEST_MAX_IMAGE_B64` (~15MB giải mã). Ảnh base64 lớn hơn ~33% file gốc.
4. **Tên field (tRPC)**: `productModel`/`productModelCode` (KHÔNG `productCode`), `batchNumber` (KHÔNG
   `lotNumber`), `measuredValue` (KHÔNG `numericValue`/`textValue`). `serialNumber`, `overallResult`,
   và mỗi `measurements[].result` là BẮT BUỘC.
5. **Encoding**: UTF-8. **Base64**: standard (không URL-safe).
6. **Timeout**: khuyến nghị 30s cho query, 60s cho mutation (nhất là upload ảnh).
7. **Connection Reuse**: dùng connection pooling / session.
