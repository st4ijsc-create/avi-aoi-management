# Authentication — Xác thực API

## Phương thức xác thực

Hệ thống AVI-AOI cung cấp 2 phương thức xác thực cho app bên thứ 3:

### 1. API Key

Mỗi máy kiểm tra khi được đăng ký trên hệ thống sẽ được cấp một API Key duy nhất.

```json
{
  "apiKey": "abc123def456..."
}
```

### 2. Machine Code

Sử dụng mã máy đã đăng ký trên hệ thống.

```json
{
  "machineCode": "AOI-MACHINE-01"
}
```

### Quy tắc

- **Bắt buộc** phải cung cấp ít nhất 1 trong 2 trường `apiKey` hoặc `machineCode`
- Nếu cung cấp cả 2, hệ thống ưu tiên `apiKey`
- API Key / Machine Code không hợp lệ → trả về lỗi `UNAUTHORIZED` (HTTP 401)

## Lấy API Key

1. Đăng nhập giao diện admin: `http://<server>:<port>`
2. Vào menu **Thiết bị** → **Máy kiểm tra**
3. Tạo máy mới hoặc chọn máy đã có
4. Sao chép **API Key** và **Machine Code** từ form cấu hình máy

## Ví dụ xác thực

### cURL
```bash
# Sử dụng apiKey
curl "http://localhost:3000/api/trpc/machineApi.heartbeat" \
  -X POST -H "Content-Type: application/json" \
  -d '{"json":{"apiKey":"your-api-key"}}'

# Sử dụng machineCode
curl "http://localhost:3000/api/trpc/machineApi.heartbeat" \
  -X POST -H "Content-Type: application/json" \
  -d '{"json":{"machineCode":"AOI-MACHINE-01"}}'
```

### C# (.NET)
```csharp
using var client = new HttpClient();
client.BaseAddress = new Uri("http://server:3000");

var payload = new {
    json = new {
        apiKey = "your-api-key"
    }
};

var response = await client.PostAsJsonAsync(
    "/api/trpc/machineApi.heartbeat", 
    payload
);
```

### Python
```python
import requests

resp = requests.post(
    "http://server:3000/api/trpc/machineApi.heartbeat",
    json={"json": {"apiKey": "your-api-key"}}
)
print(resp.json())
```

### JavaScript / TypeScript
```typescript
const resp = await fetch("http://server:3000/api/trpc/machineApi.heartbeat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ json: { apiKey: "your-api-key" } }),
});
const data = await resp.json();
```

## AI Model API — Xác thực Session

API quản lý AI model (`aiModel.*`) yêu cầu **đăng nhập session** (cookie-based), không dùng API Key.
Các thao tác admin (create, update, delete, upload) yêu cầu quyền **admin**.

```bash
# Đăng nhập lấy session cookie
curl -c cookies.txt "http://localhost:3000/api/trpc/auth.login" \
  -X POST -H "Content-Type: application/json" \
  -d '{"json":{"username":"admin","password":"your-password"}}'

# Gọi API với session cookie
curl -b cookies.txt "http://localhost:3000/api/trpc/aiModel.list?input=%7B%22json%22%3A%7B%7D%7D"
```

## Lỗi xác thực

| HTTP Status | tRPC Code | Mô tả |
|-------------|-----------|-------|
| 401 | `UNAUTHORIZED` | API Key / Machine Code không hợp lệ |
| 401 | `UNAUTHORIZED` | Session hết hạn (AI Model API) |
| 403 | `FORBIDDEN` | Không đủ quyền (cần admin) |
