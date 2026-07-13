/**
 * doc 48 R4 (tech-debt) — "Public Product API (Third-Party Integration)" API-docs section extracted VERBATIM from
 * ApiDocs.tsx. PURE RELOCATION: presentational static-docs section. Reads only
 * `endpointBase`/`baseUrl` (threaded as props); no shared mutable state. JSX and the
 * section's example-string constants were moved unchanged — no behavior change.
 */

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Package,
  Crosshair,
  ListOrdered,
  Shield,
  ShoppingBag,
  Image,
  Download,
} from "lucide-react";
import { CodeBlock, glassCard } from "./shared";

interface ApiSectionProps {
  endpointBase: string;
  baseUrl: string;
}

export function ThirdPartySection({ endpointBase, baseUrl }: ApiSectionProps) {
  return (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShoppingBag className="h-5 w-5" />
                    Public Product API
                  </CardTitle>
                  <CardDescription>
                    API công khai cho ứng dụng bên thứ 3 truy xuất thông tin sản phẩm, điểm đo và ảnh mẫu.
                    Xác thực bằng <code>apiKey</code> hoặc <code>machineCode</code>.
                  </CardDescription>
                </CardHeader>
              </Card>

              {/* Authentication */}
              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Authentication
                  </CardTitle>
                  <CardDescription>
                    Mỗi request phải kèm <code>apiKey</code> hoặc <code>machineCode</code> trong body/query.
                    Không cần session hay token JWT.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2 mb-4">
                    <Badge variant="outline">apiKey</Badge>
                    <Badge variant="outline">machineCode</Badge>
                  </div>
                  <CodeBlock
                    code={`// Ví dụ: Sử dụng apiKey
{
  "apiKey": "your-machine-api-key"
}

// Hoặc sử dụng machineCode
{
  "machineCode": "AVI-MACHINE-001"
}`}
                    language="json"
                  />
                </CardContent>
              </Card>

              {/* Base URL */}
              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-lg">Base URL & Protocol</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Tất cả endpoint sử dụng tRPC protocol qua HTTP GET (query) hoặc POST (mutation).
                  </p>
                  <CodeBlock
                    code={`GET  ${endpointBase}/publicProductApi.<procedure>?input={...}
POST ${endpointBase}/publicProductApi.<procedure>
Content-Type: application/json`}
                    language="bash"
                  />
                </CardContent>
              </Card>

              {/* 1. listProducts */}
              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Package className="h-4 w-4" />
                    1. publicProductApi.listProducts
                    <Badge className="ml-2">GET</Badge>
                    <Badge variant="outline">query</Badge>
                  </CardTitle>
                  <CardDescription>
                    Lấy danh sách sản phẩm (có hỗ trợ search, filter theo lifecycleStatus, phân trang).
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm font-semibold mb-2">Input Parameters</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm border border-white/10 rounded">
                        <thead className="bg-white/5">
                          <tr>
                            <th className="text-left p-2 border-b border-white/10">Param</th>
                            <th className="text-left p-2 border-b border-white/10">Type</th>
                            <th className="text-left p-2 border-b border-white/10">Required</th>
                            <th className="text-left p-2 border-b border-white/10">Description</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr><td className="p-2 border-b border-white/10"><code>apiKey</code></td><td className="p-2 border-b border-white/10">string</td><td className="p-2 border-b border-white/10">*</td><td className="p-2 border-b border-white/10">API key của máy</td></tr>
                          <tr><td className="p-2 border-b border-white/10"><code>machineCode</code></td><td className="p-2 border-b border-white/10">string</td><td className="p-2 border-b border-white/10">*</td><td className="p-2 border-b border-white/10">Mã máy (thay thế cho apiKey)</td></tr>
                          <tr><td className="p-2 border-b border-white/10"><code>search</code></td><td className="p-2 border-b border-white/10">string</td><td className="p-2 border-b border-white/10">No</td><td className="p-2 border-b border-white/10">Tìm kiếm theo tên/mã sản phẩm</td></tr>
                          <tr><td className="p-2 border-b border-white/10"><code>lifecycleStatus</code></td><td className="p-2 border-b border-white/10">enum</td><td className="p-2 border-b border-white/10">No</td><td className="p-2 border-b border-white/10">development | active | eol | archived</td></tr>
                          <tr><td className="p-2 border-b border-white/10"><code>limit</code></td><td className="p-2 border-b border-white/10">number</td><td className="p-2 border-b border-white/10">No</td><td className="p-2 border-b border-white/10">Số lượng kết quả (1-100, default: 50)</td></tr>
                          <tr><td className="p-2 border-b border-white/10"><code>offset</code></td><td className="p-2 border-b border-white/10">number</td><td className="p-2 border-b border-white/10">No</td><td className="p-2 border-b border-white/10">Vị trí bắt đầu (default: 0)</td></tr>
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">* Bắt buộc 1 trong 2: apiKey hoặc machineCode</p>
                  </div>
                  <Tabs defaultValue="curl">
                    <TabsList>
                      <TabsTrigger value="curl">cURL</TabsTrigger>
                      <TabsTrigger value="python">Python</TabsTrigger>
                      <TabsTrigger value="csharp">C#</TabsTrigger>
                    </TabsList>
                    <TabsContent value="curl">
                      <CodeBlock
                        code={`# List all products
curl "${endpointBase}/publicProductApi.listProducts?input=%7B%22apiKey%22%3A%22your-api-key%22%7D"

# Search with filter
curl "${endpointBase}/publicProductApi.listProducts?input=%7B%22apiKey%22%3A%22your-api-key%22%2C%22search%22%3A%22PCB%22%2C%22lifecycleStatus%22%3A%22active%22%2C%22limit%22%3A20%7D"`}
                        language="bash"
                      />
                    </TabsContent>
                    <TabsContent value="python">
                      <CodeBlock
                        code={`import requests, json

BASE = "${endpointBase}"

# List products
params = {
    "input": json.dumps({
        "apiKey": "your-api-key",
        "search": "PCB",
        "lifecycleStatus": "active",
        "limit": 20,
        "offset": 0
    })
}
resp = requests.get(f"{BASE}/publicProductApi.listProducts", params=params)
data = resp.json()["result"]["data"]
print(f"Total: {data['total']}, Products: {len(data['data'])}")

for p in data["data"]:
    print(f"  [{p['code']}] {p['name']} - {p['lifecycleStatus']}")`}
                        language="python"
                      />
                    </TabsContent>
                    <TabsContent value="csharp">
                      <CodeBlock
                        code={`using System.Net.Http;
using System.Text.Json;

var client = new HttpClient();
var input = JsonSerializer.Serialize(new {
    apiKey = "your-api-key",
    search = "PCB",
    lifecycleStatus = "active",
    limit = 20
});

var resp = await client.GetStringAsync(
    $"${endpointBase}/publicProductApi.listProducts?input={Uri.EscapeDataString(input)}");
var result = JsonDocument.Parse(resp);
var products = result.RootElement
    .GetProperty("result").GetProperty("data").GetProperty("data");

foreach (var p in products.EnumerateArray())
{
    Console.WriteLine($"[{p.GetProperty("code")}] {p.GetProperty("name")}");
}`}
                        language="csharp"
                      />
                    </TabsContent>
                  </Tabs>
                  <div>
                    <p className="text-sm font-semibold mb-2">Response</p>
                    <CodeBlock
                      code={`{
  "result": {
    "data": {
      "success": true,
      "data": [
        {
          "id": 1,
          "code": "PCB-001",
          "name": "PCB Main Board v2",
          "description": "Main circuit board for product X",
          "category": "electronics",
          "productLine": "LineA",
          "variant": "v2.0",
          "lifecycleStatus": "active",
          "referenceImageUrl": "/uploads/products/pcb-001.jpg",
          "imageWidth": 1920,
          "imageHeight": 1080,
          "targetYieldRate": 98.5,
          "minYieldRate": 95.0
        }
      ],
      "total": 1
    }
  }
}`}
                      language="json"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* 2. getProductByCode */}
              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Package className="h-4 w-4" />
                    2. publicProductApi.getProductByCode
                    <Badge className="ml-2">GET</Badge>
                    <Badge variant="outline">query</Badge>
                  </CardTitle>
                  <CardDescription>
                    Lấy chi tiết sản phẩm theo mã sản phẩm, bao gồm danh sách tất cả điểm đo.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm font-semibold mb-2">Input Parameters</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm border border-white/10 rounded">
                        <thead className="bg-white/5">
                          <tr>
                            <th className="text-left p-2 border-b border-white/10">Param</th>
                            <th className="text-left p-2 border-b border-white/10">Type</th>
                            <th className="text-left p-2 border-b border-white/10">Required</th>
                            <th className="text-left p-2 border-b border-white/10">Description</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr><td className="p-2 border-b border-white/10"><code>apiKey</code></td><td className="p-2 border-b border-white/10">string</td><td className="p-2 border-b border-white/10">*</td><td className="p-2 border-b border-white/10">API key</td></tr>
                          <tr><td className="p-2 border-b border-white/10"><code>machineCode</code></td><td className="p-2 border-b border-white/10">string</td><td className="p-2 border-b border-white/10">*</td><td className="p-2 border-b border-white/10">Machine code</td></tr>
                          <tr><td className="p-2 border-b border-white/10"><code>code</code></td><td className="p-2 border-b border-white/10">string</td><td className="p-2 border-b border-white/10">Yes</td><td className="p-2 border-b border-white/10">Mã sản phẩm (vd: PCB-001)</td></tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <Tabs defaultValue="curl">
                    <TabsList>
                      <TabsTrigger value="curl">cURL</TabsTrigger>
                      <TabsTrigger value="python">Python</TabsTrigger>
                      <TabsTrigger value="csharp">C#</TabsTrigger>
                    </TabsList>
                    <TabsContent value="curl">
                      <CodeBlock
                        code={`curl "${endpointBase}/publicProductApi.getProductByCode?input=%7B%22apiKey%22%3A%22your-api-key%22%2C%22code%22%3A%22PCB-001%22%7D"`}
                        language="bash"
                      />
                    </TabsContent>
                    <TabsContent value="python">
                      <CodeBlock
                        code={`import requests, json

params = {"input": json.dumps({"apiKey": "your-api-key", "code": "PCB-001"})}
resp = requests.get(f"${endpointBase}/publicProductApi.getProductByCode", params=params)
result = resp.json()["result"]["data"]["data"]

product = result["product"]
print(f"Product: {product['name']} ({product['code']})")
print(f"Measurement Points: {len(result['measurementPoints'])}")

for mp in result["measurementPoints"]:
    print(f"  [{mp['code']}] {mp['name']} - Type: {mp['measurementType']}")`}
                        language="python"
                      />
                    </TabsContent>
                    <TabsContent value="csharp">
                      <CodeBlock
                        code={`var input = JsonSerializer.Serialize(new { apiKey = "your-api-key", code = "PCB-001" });
var resp = await client.GetStringAsync(
    $"${endpointBase}/publicProductApi.getProductByCode?input={Uri.EscapeDataString(input)}");
var result = JsonDocument.Parse(resp);
var product = result.RootElement
    .GetProperty("result").GetProperty("data").GetProperty("data").GetProperty("product");
Console.WriteLine($"Product: {product.GetProperty("name")}");`}
                        language="csharp"
                      />
                    </TabsContent>
                  </Tabs>
                  <div>
                    <p className="text-sm font-semibold mb-2">Response</p>
                    <CodeBlock
                      code={`{
  "result": {
    "data": {
      "success": true,
      "data": {
        "product": {
          "id": 1, "code": "PCB-001", "name": "PCB Main Board v2",
          "description": "...", "category": "electronics",
          "lifecycleStatus": "active",
          "referenceImageUrl": "/uploads/products/pcb-001.jpg",
          "imageWidth": 1920, "imageHeight": 1080,
          "targetYieldRate": 98.5, "minYieldRate": 95.0
        },
        "measurementPoints": [
          {
            "id": 1, "code": "MP-001", "name": "Solder Joint A",
            "measurementType": "visual", "unit": "pass/fail",
            "lowerLimit": null, "upperLimit": null,
            "nominalValue": null,
            "positionX": 120, "positionY": 85,
            "radius": 20, "referenceImageUrl": "/uploads/points/mp-001.jpg",
            "cropWidth": 100, "cropHeight": 100,
            "orderIndex": 0
          }
        ]
      }
    }
  }
}`}
                      language="json"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* 3. getProductById */}
              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Package className="h-4 w-4" />
                    3. publicProductApi.getProductById
                    <Badge className="ml-2">GET</Badge>
                    <Badge variant="outline">query</Badge>
                  </CardTitle>
                  <CardDescription>
                    Lấy chi tiết sản phẩm theo ID (tương tự getProductByCode nhưng dùng numeric ID).
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm font-semibold mb-2">Input Parameters</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm border border-white/10 rounded">
                        <thead className="bg-white/5">
                          <tr>
                            <th className="text-left p-2 border-b border-white/10">Param</th>
                            <th className="text-left p-2 border-b border-white/10">Type</th>
                            <th className="text-left p-2 border-b border-white/10">Required</th>
                            <th className="text-left p-2 border-b border-white/10">Description</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr><td className="p-2 border-b border-white/10"><code>apiKey</code></td><td className="p-2 border-b border-white/10">string</td><td className="p-2 border-b border-white/10">*</td><td className="p-2 border-b border-white/10">API key</td></tr>
                          <tr><td className="p-2 border-b border-white/10"><code>machineCode</code></td><td className="p-2 border-b border-white/10">string</td><td className="p-2 border-b border-white/10">*</td><td className="p-2 border-b border-white/10">Machine code</td></tr>
                          <tr><td className="p-2 border-b border-white/10"><code>id</code></td><td className="p-2 border-b border-white/10">number</td><td className="p-2 border-b border-white/10">Yes</td><td className="p-2 border-b border-white/10">ID sản phẩm</td></tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <Tabs defaultValue="curl">
                    <TabsList>
                      <TabsTrigger value="curl">cURL</TabsTrigger>
                      <TabsTrigger value="python">Python</TabsTrigger>
                    </TabsList>
                    <TabsContent value="curl">
                      <CodeBlock
                        code={`curl "${endpointBase}/publicProductApi.getProductById?input=%7B%22apiKey%22%3A%22your-api-key%22%2C%22id%22%3A1%7D"`}
                        language="bash"
                      />
                    </TabsContent>
                    <TabsContent value="python">
                      <CodeBlock
                        code={`import requests, json

params = {"input": json.dumps({"apiKey": "your-api-key", "id": 1})}
resp = requests.get(f"${endpointBase}/publicProductApi.getProductById", params=params)
product = resp.json()["result"]["data"]["data"]["product"]
print(f"Product: {product['name']}")`}
                        language="python"
                      />
                    </TabsContent>
                  </Tabs>
                  <p className="text-sm text-muted-foreground">
                    Response giống hệt <code>getProductByCode</code> — trả về product + measurementPoints.
                  </p>
                </CardContent>
              </Card>

              {/* 4. getMeasurementPoints */}
              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Crosshair className="h-4 w-4" />
                    4. publicProductApi.getMeasurementPoints
                    <Badge className="ml-2">GET</Badge>
                    <Badge variant="outline">query</Badge>
                  </CardTitle>
                  <CardDescription>
                    Lấy danh sách tất cả điểm đo của một sản phẩm (theo mã sản phẩm).
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm font-semibold mb-2">Input Parameters</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm border border-white/10 rounded">
                        <thead className="bg-white/5">
                          <tr>
                            <th className="text-left p-2 border-b border-white/10">Param</th>
                            <th className="text-left p-2 border-b border-white/10">Type</th>
                            <th className="text-left p-2 border-b border-white/10">Required</th>
                            <th className="text-left p-2 border-b border-white/10">Description</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr><td className="p-2 border-b border-white/10"><code>apiKey</code></td><td className="p-2 border-b border-white/10">string</td><td className="p-2 border-b border-white/10">*</td><td className="p-2 border-b border-white/10">API key</td></tr>
                          <tr><td className="p-2 border-b border-white/10"><code>machineCode</code></td><td className="p-2 border-b border-white/10">string</td><td className="p-2 border-b border-white/10">*</td><td className="p-2 border-b border-white/10">Machine code</td></tr>
                          <tr><td className="p-2 border-b border-white/10"><code>productCode</code></td><td className="p-2 border-b border-white/10">string</td><td className="p-2 border-b border-white/10">Yes</td><td className="p-2 border-b border-white/10">Mã sản phẩm</td></tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <Tabs defaultValue="curl">
                    <TabsList>
                      <TabsTrigger value="curl">cURL</TabsTrigger>
                      <TabsTrigger value="python">Python</TabsTrigger>
                      <TabsTrigger value="csharp">C#</TabsTrigger>
                    </TabsList>
                    <TabsContent value="curl">
                      <CodeBlock
                        code={`curl "${endpointBase}/publicProductApi.getMeasurementPoints?input=%7B%22apiKey%22%3A%22your-api-key%22%2C%22productCode%22%3A%22PCB-001%22%7D"`}
                        language="bash"
                      />
                    </TabsContent>
                    <TabsContent value="python">
                      <CodeBlock
                        code={`import requests, json

params = {"input": json.dumps({"apiKey": "your-api-key", "productCode": "PCB-001"})}
resp = requests.get(f"${endpointBase}/publicProductApi.getMeasurementPoints", params=params)
result = resp.json()["result"]["data"]

print(f"Total points: {result['total']}")
for mp in result["data"]:
    print(f"  [{mp['code']}] {mp['name']}")
    print(f"    Type: {mp['measurementType']}, Unit: {mp['unit']}")
    print(f"    Position: ({mp['positionX']}, {mp['positionY']}), Radius: {mp['radius']}")
    if mp.get("lowerLimit") or mp.get("upperLimit"):
        print(f"    Limits: [{mp['lowerLimit']} - {mp['upperLimit']}]")`}
                        language="python"
                      />
                    </TabsContent>
                    <TabsContent value="csharp">
                      <CodeBlock
                        code={`var input = JsonSerializer.Serialize(new {
    apiKey = "your-api-key",
    productCode = "PCB-001"
});
var resp = await client.GetStringAsync(
    $"${endpointBase}/publicProductApi.getMeasurementPoints?input={Uri.EscapeDataString(input)}");
var result = JsonDocument.Parse(resp);
var points = result.RootElement
    .GetProperty("result").GetProperty("data").GetProperty("data");

foreach (var mp in points.EnumerateArray())
{
    Console.WriteLine($"[{mp.GetProperty("code")}] {mp.GetProperty("name")} " +
        $"at ({mp.GetProperty("positionX")},{mp.GetProperty("positionY")})");
}`}
                        language="csharp"
                      />
                    </TabsContent>
                  </Tabs>
                  <div>
                    <p className="text-sm font-semibold mb-2">Response</p>
                    <CodeBlock
                      code={`{
  "result": {
    "data": {
      "success": true,
      "data": [
        {
          "id": 1, "code": "MP-001", "name": "Solder Joint A",
          "description": "Check solder quality",
          "measurementType": "visual", "unit": "pass/fail",
          "lowerLimit": null, "upperLimit": null, "nominalValue": null,
          "positionX": 120, "positionY": 85, "radius": 20,
          "referenceImageUrl": "/uploads/points/mp-001.jpg",
          "cropWidth": 100, "cropHeight": 100, "orderIndex": 0
        }
      ],
      "total": 5
    }
  }
}`}
                      language="json"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* 5. getProductImage */}
              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Image className="h-4 w-4" />
                    5. publicProductApi.getProductImage
                    <Badge className="ml-2">GET</Badge>
                    <Badge variant="outline">query</Badge>
                  </CardTitle>
                  <CardDescription>
                    Lấy URL tải ảnh mẫu (reference image) của sản phẩm. URL có thể là presigned URL từ S3/MinIO.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm font-semibold mb-2">Input Parameters</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm border border-white/10 rounded">
                        <thead className="bg-white/5">
                          <tr>
                            <th className="text-left p-2 border-b border-white/10">Param</th>
                            <th className="text-left p-2 border-b border-white/10">Type</th>
                            <th className="text-left p-2 border-b border-white/10">Required</th>
                            <th className="text-left p-2 border-b border-white/10">Description</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr><td className="p-2 border-b border-white/10"><code>apiKey</code></td><td className="p-2 border-b border-white/10">string</td><td className="p-2 border-b border-white/10">*</td><td className="p-2 border-b border-white/10">API key</td></tr>
                          <tr><td className="p-2 border-b border-white/10"><code>machineCode</code></td><td className="p-2 border-b border-white/10">string</td><td className="p-2 border-b border-white/10">*</td><td className="p-2 border-b border-white/10">Machine code</td></tr>
                          <tr><td className="p-2 border-b border-white/10"><code>productCode</code></td><td className="p-2 border-b border-white/10">string</td><td className="p-2 border-b border-white/10">Yes</td><td className="p-2 border-b border-white/10">Mã sản phẩm</td></tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <Tabs defaultValue="curl">
                    <TabsList>
                      <TabsTrigger value="curl">cURL</TabsTrigger>
                      <TabsTrigger value="python">Python</TabsTrigger>
                    </TabsList>
                    <TabsContent value="curl">
                      <CodeBlock
                        code={`# Get product image URL
curl "${endpointBase}/publicProductApi.getProductImage?input=%7B%22apiKey%22%3A%22your-api-key%22%2C%22productCode%22%3A%22PCB-001%22%7D"

# Then download the image
curl -o product-image.jpg "<imageUrl from response>"`}
                        language="bash"
                      />
                    </TabsContent>
                    <TabsContent value="python">
                      <CodeBlock
                        code={`import requests, json

# Step 1: Get image URL
params = {"input": json.dumps({"apiKey": "your-api-key", "productCode": "PCB-001"})}
resp = requests.get(f"${endpointBase}/publicProductApi.getProductImage", params=params)
image_data = resp.json()["result"]["data"]["data"]

print(f"Product: {image_data['productName']}")
print(f"Size: {image_data['imageWidth']}x{image_data['imageHeight']}")

# Step 2: Download image
img_resp = requests.get(image_data["imageUrl"])
with open("product-reference.jpg", "wb") as f:
    f.write(img_resp.content)
print("Image saved!")`}
                        language="python"
                      />
                    </TabsContent>
                  </Tabs>
                  <div>
                    <p className="text-sm font-semibold mb-2">Response</p>
                    <CodeBlock
                      code={`{
  "result": {
    "data": {
      "success": true,
      "data": {
        "productCode": "PCB-001",
        "productName": "PCB Main Board v2",
        "imageUrl": "https://minio.example.com/bucket/products/pcb-001.jpg?...",
        "imageWidth": 1920,
        "imageHeight": 1080
      }
    }
  }
}`}
                      language="json"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* 6. getPointImage */}
              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Download className="h-4 w-4" />
                    6. publicProductApi.getPointImage
                    <Badge className="ml-2">GET</Badge>
                    <Badge variant="outline">query</Badge>
                  </CardTitle>
                  <CardDescription>
                    Lấy URL tải ảnh mẫu của điểm đo. Có thể dùng pointId trực tiếp hoặc pointCode + productCode.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm font-semibold mb-2">Input Parameters</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm border border-white/10 rounded">
                        <thead className="bg-white/5">
                          <tr>
                            <th className="text-left p-2 border-b border-white/10">Param</th>
                            <th className="text-left p-2 border-b border-white/10">Type</th>
                            <th className="text-left p-2 border-b border-white/10">Required</th>
                            <th className="text-left p-2 border-b border-white/10">Description</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr><td className="p-2 border-b border-white/10"><code>apiKey</code></td><td className="p-2 border-b border-white/10">string</td><td className="p-2 border-b border-white/10">*</td><td className="p-2 border-b border-white/10">API key</td></tr>
                          <tr><td className="p-2 border-b border-white/10"><code>machineCode</code></td><td className="p-2 border-b border-white/10">string</td><td className="p-2 border-b border-white/10">*</td><td className="p-2 border-b border-white/10">Machine code</td></tr>
                          <tr><td className="p-2 border-b border-white/10"><code>pointId</code></td><td className="p-2 border-b border-white/10">number</td><td className="p-2 border-b border-white/10">**</td><td className="p-2 border-b border-white/10">ID điểm đo (cách 1)</td></tr>
                          <tr><td className="p-2 border-b border-white/10"><code>pointCode</code></td><td className="p-2 border-b border-white/10">string</td><td className="p-2 border-b border-white/10">**</td><td className="p-2 border-b border-white/10">Mã điểm đo (cách 2, kèm productCode)</td></tr>
                          <tr><td className="p-2 border-b border-white/10"><code>productCode</code></td><td className="p-2 border-b border-white/10">string</td><td className="p-2 border-b border-white/10">**</td><td className="p-2 border-b border-white/10">Mã sản phẩm (cách 2, kèm pointCode)</td></tr>
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">* Bắt buộc 1 trong 2: apiKey hoặc machineCode</p>
                    <p className="text-xs text-muted-foreground">** Cách 1: dùng pointId. Cách 2: dùng pointCode + productCode</p>
                  </div>
                  <Tabs defaultValue="curl">
                    <TabsList>
                      <TabsTrigger value="curl">cURL</TabsTrigger>
                      <TabsTrigger value="python">Python</TabsTrigger>
                    </TabsList>
                    <TabsContent value="curl">
                      <CodeBlock
                        code={`# By pointId
curl "${endpointBase}/publicProductApi.getPointImage?input=%7B%22apiKey%22%3A%22your-api-key%22%2C%22pointId%22%3A1%7D"

# By pointCode + productCode
curl "${endpointBase}/publicProductApi.getPointImage?input=%7B%22apiKey%22%3A%22your-api-key%22%2C%22pointCode%22%3A%22MP-001%22%2C%22productCode%22%3A%22PCB-001%22%7D"`}
                        language="bash"
                      />
                    </TabsContent>
                    <TabsContent value="python">
                      <CodeBlock
                        code={`import requests, json

# Option 1: By pointId
params = {"input": json.dumps({"apiKey": "your-api-key", "pointId": 1})}

# Option 2: By pointCode + productCode
params = {"input": json.dumps({
    "apiKey": "your-api-key",
    "pointCode": "MP-001",
    "productCode": "PCB-001"
})}

resp = requests.get(f"${endpointBase}/publicProductApi.getPointImage", params=params)
data = resp.json()["result"]["data"]["data"]

print(f"Point: {data['pointName']} ({data['pointCode']})")
print(f"Crop: {data['cropWidth']}x{data['cropHeight']}")

# Download image
img_resp = requests.get(data["imageUrl"])
with open(f"point-{data['pointCode']}.jpg", "wb") as f:
    f.write(img_resp.content)`}
                        language="python"
                      />
                    </TabsContent>
                  </Tabs>
                  <div>
                    <p className="text-sm font-semibold mb-2">Response</p>
                    <CodeBlock
                      code={`{
  "result": {
    "data": {
      "success": true,
      "data": {
        "pointId": 1,
        "pointCode": "MP-001",
        "pointName": "Solder Joint A",
        "imageUrl": "https://minio.example.com/bucket/points/mp-001.jpg?...",
        "cropWidth": 100,
        "cropHeight": 100
      }
    }
  }
}`}
                      language="json"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Summary Table */}
              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <ListOrdered className="h-4 w-4" />
                    API Endpoints Summary
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border border-white/10 rounded">
                      <thead className="bg-white/5">
                        <tr>
                          <th className="text-left p-2 border-b border-white/10">#</th>
                          <th className="text-left p-2 border-b border-white/10">Endpoint</th>
                          <th className="text-left p-2 border-b border-white/10">Method</th>
                          <th className="text-left p-2 border-b border-white/10">Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="p-2 border-b border-white/10">1</td>
                          <td className="p-2 border-b border-white/10"><code>publicProductApi.listProducts</code></td>
                          <td className="p-2 border-b border-white/10">GET</td>
                          <td className="p-2 border-b border-white/10">Danh sách sản phẩm (search, filter, pagination)</td>
                        </tr>
                        <tr>
                          <td className="p-2 border-b border-white/10">2</td>
                          <td className="p-2 border-b border-white/10"><code>publicProductApi.getProductByCode</code></td>
                          <td className="p-2 border-b border-white/10">GET</td>
                          <td className="p-2 border-b border-white/10">Chi tiết sản phẩm + điểm đo (theo code)</td>
                        </tr>
                        <tr>
                          <td className="p-2 border-b border-white/10">3</td>
                          <td className="p-2 border-b border-white/10"><code>publicProductApi.getProductById</code></td>
                          <td className="p-2 border-b border-white/10">GET</td>
                          <td className="p-2 border-b border-white/10">Chi tiết sản phẩm + điểm đo (theo ID)</td>
                        </tr>
                        <tr>
                          <td className="p-2 border-b border-white/10">4</td>
                          <td className="p-2 border-b border-white/10"><code>publicProductApi.getMeasurementPoints</code></td>
                          <td className="p-2 border-b border-white/10">GET</td>
                          <td className="p-2 border-b border-white/10">Danh sách điểm đo của sản phẩm</td>
                        </tr>
                        <tr>
                          <td className="p-2 border-b border-white/10">5</td>
                          <td className="p-2 border-b border-white/10"><code>publicProductApi.getProductImage</code></td>
                          <td className="p-2 border-b border-white/10">GET</td>
                          <td className="p-2 border-b border-white/10">URL tải ảnh mẫu sản phẩm</td>
                        </tr>
                        <tr>
                          <td className="p-2 border-b border-white/10">6</td>
                          <td className="p-2 border-b border-white/10"><code>publicProductApi.getPointImage</code></td>
                          <td className="p-2 border-b border-white/10">GET</td>
                          <td className="p-2 border-b border-white/10">URL tải ảnh mẫu điểm đo</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {/* Error Handling */}
              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Error Codes
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <CodeBlock
                    code={`// 401 UNAUTHORIZED - Invalid apiKey or machineCode
{
  "error": {
    "message": "Invalid API key",
    "code": -32001,
    "data": { "code": "UNAUTHORIZED" }
  }
}

// 404 NOT_FOUND - Product or point not found
{
  "error": {
    "message": "Product not found: INVALID-CODE",
    "code": -32004,
    "data": { "code": "NOT_FOUND" }
  }
}

// 400 BAD_REQUEST - Missing required fields
{
  "error": {
    "message": "Either apiKey or machineCode must be provided",
    "code": -32600,
    "data": { "code": "BAD_REQUEST" }
  }
}`}
                    language="json"
                  />
                </CardContent>
              </Card>

              {/* Full Workflow Example */}
              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <ListOrdered className="h-4 w-4" />
                    Full Workflow Example (Python)
                  </CardTitle>
                  <CardDescription>
                    Một ví dụ hoàn chỉnh: lấy sản phẩm → lấy điểm đo → tải ảnh mẫu.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <CodeBlock
                    code={`import requests, json, os

BASE = "${endpointBase}"
API_KEY = "your-api-key"

def call_api(procedure: str, params: dict):
    """Helper: gọi tRPC query endpoint"""
    params["apiKey"] = API_KEY
    resp = requests.get(
        f"{BASE}/publicProductApi.{procedure}",
        params={"input": json.dumps(params)}
    )
    resp.raise_for_status()
    return resp.json()["result"]["data"]

# Step 1: List all active products
products = call_api("listProducts", {"lifecycleStatus": "active"})
print(f"Found {products['total']} active products")

for p in products["data"]:
    code = p["code"]
    print(f"\\n=== Product: {p['name']} ({code}) ===")

    # Step 2: Get measurement points
    points = call_api("getMeasurementPoints", {"productCode": code})
    print(f"  {points['total']} measurement points")

    for mp in points["data"]:
        print(f"    [{mp['code']}] {mp['name']} ({mp['measurementType']})")

    # Step 3: Download product reference image
    try:
        img = call_api("getProductImage", {"productCode": code})
        img_resp = requests.get(img["data"]["imageUrl"])
        os.makedirs("images", exist_ok=True)
        with open(f"images/{code}.jpg", "wb") as f:
            f.write(img_resp.content)
        print(f"  ✓ Product image saved: images/{code}.jpg")
    except Exception as e:
        print(f"  ✗ No product image: {e}")

    # Step 4: Download point reference images
    for mp in points["data"]:
        try:
            pt_img = call_api("getPointImage", {
                "pointCode": mp["code"],
                "productCode": code
            })
            img_resp = requests.get(pt_img["data"]["imageUrl"])
            with open(f"images/{code}_{mp['code']}.jpg", "wb") as f:
                f.write(img_resp.content)
            print(f"  ✓ Point image saved: {mp['code']}")
        except Exception:
            pass  # Point may not have reference image

print("\\nDone! All product data and images downloaded.")`}
                    language="python"
                  />
                </CardContent>
              </Card>
            </div>
  );
}
