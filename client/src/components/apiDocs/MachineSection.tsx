/**
 * doc 48 R4 (tech-debt) — "Machine APIs" API-docs section extracted VERBATIM from
 * ApiDocs.tsx. PURE RELOCATION: presentational static-docs section. Reads only
 * `endpointBase`/`baseUrl` (threaded as props); no shared mutable state. JSX and the
 * section's example-string constants were moved unchanged — no behavior change.
 */

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Activity,
  Languages,
  RefreshCcw,
  Send,
  UploadCloud,
  Server,
  Image,
  Download,
} from "lucide-react";
import { CodeBlock, glassCard } from "./shared";

interface ApiSectionProps {
  endpointBase: string;
  baseUrl: string;
}

export function MachineSection({ endpointBase, baseUrl }: ApiSectionProps) {
  const submitInspectionExample = `POST ${endpointBase}/machineApi.submitInspection
Headers: X-API-Key: machine-api-key

{
  "machineCode": "AOI-01",
  "serialNumber": "SN123456",
  "productModel": "PCBA-REV3",
  "overallResult": "NG",
  "inspectionTime": "2026-02-05T02:01:00Z",
  "companyCode": "CORP001",
  "factoryCode": "FAC001",
  "productionOrderCode": "WO-20260205-01",
  "measurements": [
    {
      "pointId": "P01",
      "pointCode": "Connector-A",
      "measuredValue": 0.42,
      "result": "NG",
      "remark": "Bent pin",
      "imageBase64": "data:image/png;base64,iVBORw0..."
    }
  ]
}`;

  const submitInspectionResponse = `{
  "success": true,
  "inspectionId": 98214
}`;

  const uploadImageExample = `POST ${endpointBase}/machineApi.uploadImage
Headers: X-API-Key: machine-api-key

{
  "inspectionId": 98214,
  "pointCode": "Connector-A",
  "imageBase64": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
  "mimeType": "image/jpeg"
}`;

  const uploadImageResponse = `{
  "success": true,
  "imageUrl": "https://files.manus.im/inspections/98214/connector-a.jpg"
}`;

  const syncPointsExample = `POST ${endpointBase}/machineApi.syncMeasurementPoints
Headers: X-API-Key: machine-api-key

{
  "machineCode": "AOI-01",
  "productModelCode": "PCBA-REV3",
  "points": [
    {
      "code": "P01",
      "name": "Connector A",
      "measurementType": "VISUAL",
      "unit": "px",
      "lowerLimit": 0.1,
      "upperLimit": 0.3,
      "positionX": 540,
      "positionY": 410,
      "radius": 25,
      "cropWidth": 120,
      "cropHeight": 120,
      "workstationCode": "WS-AOI",
      "imageBase64": "data:image/png;base64,iVBORw0..."
    }
  ]
}`;

  const syncPointsResponse = `{
  "success": true,
  "machineId": 12,
  "productModelId": 33,
  "productModelCode": "PCBA-REV3",
  "total": 8,
  "created": 1,
  "updated": 7,
  "failed": 0,
  "points": [
    { "code": "P01", "id": 201, "action": "updated" },
    { "code": "P08", "id": 208, "action": "created" }
  ],
  "errors": []
}`;

  // ── Product Reference Image: Server → AOI ──
  const getProductImageExample = `GET ${endpointBase}/machineApi.getProductImage?input={"machineCode":"AOI-01","productModelCode":"PCBA-REV3"}
Headers: X-API-Key: machine-api-key

// REST proxy:
// GET ${baseUrl}/api/machine/product-image?productModelCode=PCBA-REV3&apiKey=MCH-API-xxxx`;

  const getProductImageResponse = `{
  "success": true,
  "data": {
    "productModelId": 33,
    "productModelCode": "PCBA-REV3",
    "productModelName": "Main Board Rev3",
    "imageUrl": "https://server.local/uploads/product-models/33/ref-1710576000000-abc123.png",
    "imageWidth": 1920,
    "imageHeight": 1080
  }
}`;

  // ── Product Reference Image: AOI → Server ──
  const syncProductImageExample = `POST ${endpointBase}/machineApi.syncProductImage
Headers: X-API-Key: machine-api-key

{
  "machineCode": "AOI-01",
  "productModelCode": "PCBA-REV3",
  "imageBase64": "data:image/png;base64,iVBORw0KGgo...",
  "imageMimeType": "image/png",
  "imageWidth": 1920,
  "imageHeight": 1080
}

// REST proxy:
// POST ${baseUrl}/api/machine/sync-product-image
// Body: { productModelCode, imageBase64, imageMimeType?, imageWidth?, imageHeight?, apiKey }`;

  const syncProductImageResponse = `{
  "success": true,
  "machineId": 12,
  "productModelId": 33,
  "productModelCode": "PCBA-REV3",
  "imageUrl": "https://server.local/uploads/product-models/33/ref-1710576000000-abc123.png",
  "imageKey": "product-models/33/ref-1710576000000-abc123.png"
}`;

  // ── Point Reference Image: AOI → Server (upload single point image) ──
  const syncPointImageExample = `POST ${endpointBase}/machineApi.syncPointImage
Headers: X-API-Key: machine-api-key

{
  "machineCode": "AOI-01",
  "productModelCode": "PCBA-REV3",
  "pointCode": "P01",
  "imageBase64": "data:image/png;base64,iVBORw0KGgo...",
  "imageMimeType": "image/png"
}

// REST proxy:
// POST ${baseUrl}/api/machine/sync-point-image
// Body: { productModelCode, pointCode, imageBase64, imageMimeType?, apiKey }`;

  const syncPointImageResponse = `{
  "success": true,
  "machineId": 12,
  "productModelId": 33,
  "productModelCode": "PCBA-REV3",
  "pointId": 201,
  "pointCode": "P01",
  "referenceImageUrl": "/uploads/measurement-points/33/P01-1710576000000-abc123.png",
  "referenceImageKey": "measurement-points/33/P01-1710576000000-abc123.png"
}`;

  // ── Point Reference Image: Server → AOI (download single point image by code) ──
  const getPointImageExample = `GET ${endpointBase}/machineApi.getPointImage?input={"machineCode":"AOI-01","productModelCode":"PCBA-REV3","pointCode":"P01"}
Headers: X-API-Key: machine-api-key

// REST proxy:
// GET ${baseUrl}/api/machine/point-image?productModelCode=PCBA-REV3&pointCode=P01&apiKey=MCH-API-xxxx`;

  const getPointImageResponse = `{
  "success": true,
  "machineId": 12,
  "productModelId": 33,
  "productModelCode": "PCBA-REV3",
  "pointId": 201,
  "pointCode": "P01",
  "pointName": "Connector A",
  "referenceImageUrl": "/uploads/measurement-points/33/P01-1710576000000-abc123.png",
  "position": {
    "x": 540,
    "y": 410,
    "radius": 25,
    "cropWidth": 120,
    "cropHeight": 120
  },
  "productReferenceImageUrl": "/uploads/product-models/33/ref-1710576000.png"
}`;

  // ── BG-116 Lô 8 Mục 3 — ảnh TEMPLATE của cây dạy: presign → PUT → commit (tùy chọn) ──
  const templateImageFlowExample = `// 1) Đẩy cây dạy — KHÔNG đổi, làm như hôm nay
POST ${endpointBase}/machineApi.submitMachineTemplate
Headers: X-API-Key: machine-api-key
{ "productModelCode": "PCBA-REV3", "template": { "surfaces": [...] } }

// 2) Presign — khai captureExtId (+ componentExtId nếu muốn ảnh RIÊNG của linh kiện).
//    productModelCode NÊN LUÔN gửi: captureExtId là GUID do MÁY cấp, không đảm bảo
//    duy nhất trên toàn hệ (cây clone cho hai sản phẩm) — thiếu nó mà bị trùng ⇒ 400.
POST ${endpointBase}/machineApi.presignTemplateImage
Headers: X-API-Key: machine-api-key
{
  "captureExtId": "a1b2c3d4-0000-4000-8000-000000001011",
  "componentExtId": "a1b2c3d4-0000-4000-8000-000000010111",
  "productModelCode": "PCBA-REV3",
  "contentHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "sizeBytes": 245678,
  "ext": "jpg"
}
// Response: { "success": true, "objectKey": "product-models/33/template-e3b0c4...jpg",
//             "uploadUrl": "/api/machine-template-image/upload/product-models/33/template-e3b0c4...jpg",
//             "cap": "component" }

// 3) PUT byte ảnh thật lên uploadUrl — body nhị phân, CÙNG header xác thực.
//    Server kiểm THÊM: máy này đã dạy cây cho product model trong uploadUrl chưa
//    (không chỉ "apiKey hợp lệ") — khác sản phẩm/máy ⇒ 403, byte KHÔNG được ghi.
PUT {uploadUrl}
Headers: X-API-Key: machine-api-key
Content-Type: image/jpeg
[BINARY JPG DATA]

// 4) Commit — khai LẠI đúng khoá + contentHash (+ sizeBytes tuỳ chọn, đối chiếu
//    THẬT với byte đã đọc từ đĩa), server ghi URL vào cây dạy
POST ${endpointBase}/machineApi.commitTemplateImage
Headers: X-API-Key: machine-api-key
{
  "captureExtId": "a1b2c3d4-0000-4000-8000-000000001011",
  "componentExtId": "a1b2c3d4-0000-4000-8000-000000010111",
  "productModelCode": "PCBA-REV3",
  "contentHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "sizeBytes": 245678,
  "ext": "jpg"
}
// Response: { "success": true, "cap": "component",
//             "url": "/uploads/product-models/33/template-e3b0c4...jpg", "daDoi": true }`;

  // ── Direction 2: Server → Client (getPoints) ──
  const getPointsExample = `GET ${endpointBase}/machineApi.getPoints?input={"machineCode":"AOI-01","productModelCode":"PCBA-REV3"}
Headers: X-API-Key: machine-api-key`;

  const getPointsAllExample = `GET ${endpointBase}/machineApi.getPoints?input={"apiKey":"MCH-API-xxxx"}
Headers: X-API-Key: machine-api-key

// Không truyền productModelCode → trả về tất cả product models
// được mapping với máy này`;

  const getPointsResponse = `{
  "success": true,
  "machineId": 12,
  "machineCode": "AOI-01",
  "productModels": [
    {
      "productModelId": 33,
      "productModelCode": "PCBA-REV3",
      "productModelName": "Main Board Rev3",
      "referenceImageUrl": "/uploads/product-models/33/ref-1710576000.png",
      "imageWidth": 1920,
      "imageHeight": 1080,
      "totalPoints": 12,
      "points": [
        {
          "id": 201,
          "code": "P01",
          "name": "Connector A",
          "measurementType": "VISUAL",
          "unit": "px",
          "lowerLimit": "0.1",
          "upperLimit": "0.3",
          "nominalValue": null,
          "positionX": 540,
          "positionY": 410,
          "radius": 25,
          "cropWidth": 120,
          "cropHeight": 120,
          "orderIndex": 0,
          "referenceImageUrl": "/uploads/ref/PCBA-REV3/P01.png",
          "isActive": true,
          "workstationId": 5
        }
      ]
    }
  ]
}`;

  const heartbeatExample = `POST ${endpointBase}/machineApi.heartbeat
Headers: X-API-Key: machine-api-key

{}`;

  const errorResponse = `{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid API key"
  }
}`;

  const languageGuides = [
    {
      name: "TypeScript / Node.js",
      code: `import fetch from "node-fetch";

const res = await fetch("${endpointBase}/machineApi.submitInspection", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-API-Key": process.env.MACHINE_KEY!
  },
  body: JSON.stringify(payload)
});
console.log(await res.json());`,
    },
    {
      name: "Python",
      code: `import requests

BASE_URL = "${endpointBase}"
headers = {"X-API-Key": "machine-api-key"}
response = requests.post(
    f"{BASE_URL}/machineApi.submitInspection",
    json=payload,
    headers=headers,
    timeout=10
)
print(response.json())`,
    },
    {
      name: "Java",
      code: `HttpClient client = HttpClient.newHttpClient();
HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("${endpointBase}/machineApi.submitInspection"))
    .header("Content-Type", "application/json")
    .header("X-API-Key", apiKey)
    .POST(HttpRequest.BodyPublishers.ofString(payload))
    .build();
HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());`,
    },
    {
      name: "C#",
      code: `using var client = new HttpClient();
client.DefaultRequestHeaders.Add("X-API-Key", apiKey);
var res = await client.PostAsync(
  "${endpointBase}/machineApi.submitInspection",
  new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json"));
var body = await res.Content.ReadAsStringAsync();`,
    },
    {
      name: "Go",
      code: `payloadBytes, _ := json.Marshal(payload)
req, _ := http.NewRequest(
  http.MethodPost,
  "${endpointBase}/machineApi.submitInspection",
  bytes.NewBuffer(payloadBytes),
)
req.Header.Set("Content-Type", "application/json")
req.Header.Set("X-API-Key", apiKey)
res, err := http.DefaultClient.Do(req)
defer res.Body.Close()`,
    },
  ];

  return (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5" />
                    Machine Integration APIs
                  </CardTitle>
                  <CardDescription>
                    Các API dành cho máy AVI/AOI gửi dữ liệu inspection và đồng bộ điểm đo.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Tabs defaultValue="submit" className="space-y-6">
                <TabsList className="grid w-full grid-cols-6">
                  <TabsTrigger value="submit" className="gap-2">
                    <Send className="h-4 w-4" />
                    Submit
                  </TabsTrigger>
                  <TabsTrigger value="upload" className="gap-2">
                    <UploadCloud className="h-4 w-4" />
                    Upload
                  </TabsTrigger>
                  <TabsTrigger value="sync" className="gap-2">
                    <RefreshCcw className="h-4 w-4" />
                    Sync Points
                  </TabsTrigger>
                  <TabsTrigger value="productImage" className="gap-2">
                    <Image className="h-4 w-4" />
                    Product Image
                  </TabsTrigger>
                  <TabsTrigger value="pointImage" className="gap-2">
                    <Image className="h-4 w-4" />
                    Point Image
                  </TabsTrigger>
                  <TabsTrigger value="heartbeat" className="gap-2">
                    <Activity className="h-4 w-4" />
                    Heartbeat
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="submit">
                  <Card className={glassCard}>
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <Badge className="bg-success text-success-foreground">POST</Badge>
                        <code className="text-sm text-white">machineApi.submitInspection</code>
                      </div>
                      <CardDescription>
                        Đẩy kết quả inspection kèm toàn bộ measurement và thông tin sản xuất.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div>
                        <h4 className="mb-3 font-semibold text-white">Request</h4>
                        <CodeBlock code={submitInspectionExample} language="typescript" />
                      </div>
                      <div>
                        <h4 className="mb-3 font-semibold text-white">Response</h4>
                        <CodeBlock code={submitInspectionResponse} />
                      </div>
                      <div className="rounded-2xl border border-dashed border-white/20 bg-white/5 p-4 text-sm text-white/80">
                        <ul className="list-disc space-y-1 pl-5">
                          <li>Tự động liên kết productModelId từ productModel code</li>
                          <li>Hỗ trợ pointId hoặc pointCode (ưu tiên pointId)</li>
                          <li>Ảnh tự động upload lên Forge hoặc thư mục uploads/</li>
                          <li>Tự động emit MQTT notification cho kết quả NG</li>
                        </ul>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="upload">
                  <Card className={glassCard}>
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <Badge className="bg-success text-success-foreground">POST</Badge>
                        <code className="text-sm text-white">machineApi.uploadImage</code>
                      </div>
                      <CardDescription>Upload lại ảnh điểm đo khi cần thay thế.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div>
                        <h4 className="mb-3 font-semibold text-white">Request</h4>
                        <CodeBlock code={uploadImageExample} language="typescript" />
                      </div>
                      <div>
                        <h4 className="mb-3 font-semibold text-white">Response</h4>
                        <CodeBlock code={uploadImageResponse} />
                      </div>
                      <div className="rounded-2xl border border-dashed border-white/20 bg-white/5 p-4 text-sm text-white/80">
                        <ul className="list-disc space-y-1 pl-5">
                          <li>Kích thước ảnh tối đa 10MB</li>
                          <li>Tự động parse mimeType khi dùng data URL</li>
                          <li>Hỗ trợ cả base64 thuần và data URL format</li>
                        </ul>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="sync">
                  <div className="space-y-6">
                    {/* Direction 1: Client → Server (Push) */}
                    <Card className={glassCard}>
                      <CardHeader>
                        <div className="flex items-center gap-3">
                          <Badge className="bg-success text-success-foreground">POST</Badge>
                          <code className="text-sm text-white">
                            machineApi.syncMeasurementPoints
                          </code>
                          <Badge variant="outline" className="text-xs border-blue-400/50 text-blue-300">
                            Client → Server
                          </Badge>
                        </div>
                        <CardDescription>
                          Đẩy tọa độ, dung sai, ảnh tham chiếu từ máy lên server. Trùng code thì update, mới thì tạo.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-6">
                        <div>
                          <h4 className="mb-3 font-semibold text-white">Request</h4>
                          <CodeBlock code={syncPointsExample} language="typescript" />
                        </div>
                        <div>
                          <h4 className="mb-3 font-semibold text-white">Response</h4>
                          <CodeBlock code={syncPointsResponse} />
                        </div>
                        <div className="rounded-2xl bg-white/5 p-4 text-sm text-white/80">
                          <ul className="list-disc space-y-1 pl-5">
                            <li>Trùng productModelId + code → update, còn lại tạo mới</li>
                            <li>workstationCode tự map sang ID nếu tồn tại</li>
                            <li>Nên gọi khi thay đổi recipe hoặc setup mới</li>
                            <li>Response trả về chi tiết từng point (id, action: created/updated)</li>
                          </ul>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Direction 2: Server → Client (Pull) */}
                    <Card className={glassCard}>
                      <CardHeader>
                        <div className="flex items-center gap-3">
                          <Badge className="bg-blue-600 text-white">GET</Badge>
                          <code className="text-sm text-white">
                            machineApi.getPoints
                          </code>
                          <Badge variant="outline" className="text-xs border-emerald-400/50 text-emerald-300">
                            Server → Client
                          </Badge>
                        </div>
                        <CardDescription>
                          Máy tải về danh sách measurement points đã được cấu hình trên server. Hỗ trợ lấy theo product model hoặc lấy tất cả.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-6">
                        <div>
                          <h4 className="mb-3 font-semibold text-white">Request — theo Product Model</h4>
                          <CodeBlock code={getPointsExample} language="typescript" />
                        </div>
                        <div>
                          <h4 className="mb-3 font-semibold text-white">Request — lấy tất cả Product Models</h4>
                          <CodeBlock code={getPointsAllExample} language="typescript" />
                        </div>
                        <div>
                          <h4 className="mb-3 font-semibold text-white">Response</h4>
                          <CodeBlock code={getPointsResponse} />
                        </div>
                        <div className="rounded-2xl bg-white/5 p-4 text-sm text-white/80">
                          <ul className="list-disc space-y-1 pl-5">
                            <li>Truyền <code className="text-white">productModelCode</code> → chỉ lấy points của model đó</li>
                            <li>Không truyền → trả về tất cả models đang mapping với máy</li>
                            <li>Response bao gồm <code className="text-white">referenceImageUrl</code>, <code className="text-white">imageWidth</code>, <code className="text-white">imageHeight</code> của mỗi product model</li>
                            <li>Dùng để đồng bộ recipe/setup từ server xuống máy khi khởi động</li>
                            <li>Tự động cập nhật heartbeat khi gọi</li>
                            <li>Xác thực bằng <code className="text-white">apiKey</code> hoặc <code className="text-white">machineCode</code></li>
                          </ul>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Bidirectional Sync Summary */}
                    <div className="rounded-2xl border border-dashed border-yellow-400/30 bg-yellow-500/5 p-5 text-sm text-white/90">
                      <h4 className="mb-2 font-semibold text-yellow-300">🔄 Luồng đồng bộ hai chiều</h4>
                      <ul className="list-disc space-y-1 pl-5">
                        <li><strong>Push (Client → Server):</strong> Máy AOI đẩy measurement points lên server khi thay đổi recipe/setup.</li>
                        <li><strong>Pull (Server → Client):</strong> Máy AOI tải config từ server khi khởi động hoặc khi cần đồng bộ lại.</li>
                        <li><strong>Ảnh mẫu sản phẩm:</strong> Dùng tab <em>Product Image</em> để sync ảnh reference giữa máy ↔ server.</li>
                        <li>Kết hợp cả hai chiều giúp đảm bảo dữ liệu nhất quán giữa máy và hệ thống quản lý.</li>
                      </ul>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="productImage">
                  <div className="space-y-6">
                    {/* Direction: Server → AOI (Download product image) */}
                    <Card className={glassCard}>
                      <CardHeader>
                        <div className="flex items-center gap-3">
                          <Badge className="bg-blue-600 text-white">GET</Badge>
                          <code className="text-sm text-white">machineApi.getProductImage</code>
                          <Badge variant="outline" className="text-xs border-emerald-400/50 text-emerald-300">
                            Server → AOI
                          </Badge>
                        </div>
                        <CardDescription>
                          Máy AOI tải ảnh mẫu sản phẩm (reference image) từ server. Trả về URL tải ảnh, kích thước ảnh gốc.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-6">
                        <div>
                          <h4 className="mb-3 font-semibold text-white">Request</h4>
                          <CodeBlock code={getProductImageExample} language="typescript" />
                        </div>
                        <div>
                          <h4 className="mb-3 font-semibold text-white">Response</h4>
                          <CodeBlock code={getProductImageResponse} />
                        </div>
                        <div className="rounded-2xl bg-white/5 p-4 text-sm text-white/80">
                          <ul className="list-disc space-y-1 pl-5">
                            <li>Trả về <code className="text-white">imageUrl</code> là URL tải ảnh (local hoặc Forge signed URL)</li>
                            <li><code className="text-white">imageWidth</code> / <code className="text-white">imageHeight</code> — kích thước gốc của ảnh (số nguyên pixel)</li>
                            <li>Nếu sản phẩm chưa có ảnh mẫu → trả 404 NOT_FOUND</li>
                            <li>Xác thực bằng <code className="text-white">apiKey</code> hoặc <code className="text-white">machineCode</code></li>
                            <li>REST: <code className="text-white">GET /api/machine/product-image?productModelCode=...&apiKey=...</code></li>
                          </ul>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Direction: AOI → Server (Upload product image) */}
                    <Card className={glassCard}>
                      <CardHeader>
                        <div className="flex items-center gap-3">
                          <Badge className="bg-success text-success-foreground">POST</Badge>
                          <code className="text-sm text-white">machineApi.syncProductImage</code>
                          <Badge variant="outline" className="text-xs border-blue-400/50 text-blue-300">
                            AOI → Server
                          </Badge>
                        </div>
                        <CardDescription>
                          Máy AOI đẩy ảnh mẫu sản phẩm lên server. Hỗ trợ base64 inline hoặc URL ảnh.
                          Tự động lưu vào storage và cập nhật product model.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-6">
                        <div>
                          <h4 className="mb-3 font-semibold text-white">Request</h4>
                          <CodeBlock code={syncProductImageExample} language="typescript" />
                        </div>
                        <div>
                          <h4 className="mb-3 font-semibold text-white">Response</h4>
                          <CodeBlock code={syncProductImageResponse} />
                        </div>
                        <div className="rounded-2xl bg-white/5 p-4 text-sm text-white/80">
                          <h4 className="mb-2 font-semibold text-white">Input Schema</h4>
                          <ul className="list-disc space-y-1 pl-5">
                            <li><code className="text-white">productModelCode</code> (string, bắt buộc) — Mã sản phẩm</li>
                            <li><code className="text-white">imageBase64</code> (string) — Ảnh dạng base64 hoặc data URL</li>
                            <li><code className="text-white">imageMimeType</code> (string, optional) — MIME type (mặc định image/png)</li>
                            <li><code className="text-white">imageUrl</code> (string, optional) — URL ảnh thay cho base64</li>
                            <li><code className="text-white">imageWidth</code> (number, optional) — Chiều rộng pixel</li>
                            <li><code className="text-white">imageHeight</code> (number, optional) — Chiều cao pixel</li>
                          </ul>
                          <p className="mt-2 text-white/60">Phải truyền <code>imageBase64</code> hoặc <code>imageUrl</code> (ít nhất 1 trong 2).</p>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Product Image Sync Summary */}
                    <div className="rounded-2xl border border-dashed border-yellow-400/30 bg-yellow-500/5 p-5 text-sm text-white/90">
                      <h4 className="mb-2 font-semibold text-yellow-300">🖼️ Đồng bộ ảnh mẫu sản phẩm</h4>
                      <ul className="list-disc space-y-1 pl-5">
                        <li><strong>Download (Server → AOI):</strong> <code>getProductImage</code> — máy tải ảnh mẫu sản phẩm từ server khi khởi động hoặc đổi recipe.</li>
                        <li><strong>Upload (AOI → Server):</strong> <code>syncProductImage</code> — máy đẩy ảnh mẫu mới lên server khi thay đổi setup/chuẩn hóa ảnh.</li>
                        <li><strong>getPoints:</strong> Response đã bao gồm <code>referenceImageUrl</code> + <code>imageWidth</code>/<code>imageHeight</code> của product model → không cần gọi riêng.</li>
                        <li>Hỗ trợ cả local storage và Forge cloud storage.</li>
                      </ul>
                    </div>
                  </div>
                </TabsContent>

                {/* ── Point Reference Image Tab ── */}
                <TabsContent value="pointImage">
                  <Card className={glassCard}>
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <Badge className="bg-success text-success-foreground">POST</Badge>
                        <code className="text-sm text-white">machineApi.syncPointImage</code>
                      </div>
                      <CardDescription className="text-muted-foreground">
                        Upload ảnh mẫu cho một điểm đo cụ thể (không cần re-sync toàn bộ points)
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <h4 className="mb-2 font-semibold text-primary">Request</h4>
                          <CodeBlock code={syncPointImageExample} language="typescript" />
                        </div>
                        <div>
                          <h4 className="mb-2 font-semibold text-green-400">Response</h4>
                          <CodeBlock code={syncPointImageResponse} />
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className={`${glassCard} mt-4`}>
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <Badge className="bg-blue-500 text-white">GET</Badge>
                        <code className="text-sm text-white">machineApi.getPointImage</code>
                      </div>
                      <CardDescription className="text-muted-foreground">
                        Download ảnh mẫu điểm đo theo code (không cần biết ID số)
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <h4 className="mb-2 font-semibold text-primary">Request</h4>
                          <CodeBlock code={getPointImageExample} language="typescript" />
                        </div>
                        <div>
                          <h4 className="mb-2 font-semibold text-green-400">Response</h4>
                          <CodeBlock code={getPointImageResponse} />
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <div className={`mt-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4`}>
                    <h4 className="mb-2 font-semibold text-yellow-300">📌 Khi nào dùng Point Image API?</h4>
                    <ul className="list-disc space-y-1 pl-5">
                      <li><strong>syncPointImage:</strong> Khi cần cập nhật ảnh mẫu cho MỘT điểm đo mà không muốn re-sync toàn bộ thông số.</li>
                      <li><strong>getPointImage:</strong> Khi App cần tải ảnh mẫu điểm đo theo <code>pointCode</code> + <code>productModelCode</code> (không cần numeric ID).</li>
                      <li><strong>Lưu ý:</strong> <code>syncMeasurementPoints</code> vẫn hỗ trợ <code>imageBase64</code> cho mỗi điểm — dùng khi sync batch nhiều điểm cùng lúc.</li>
                      <li><strong>getPoints:</strong> Response đã bao gồm <code>referenceImageUrl</code> cho mỗi point — dùng khi cần tải tất cả.</li>
                    </ul>
                  </div>

                  {/* BG-116 Lô 8 Mục 3 — ảnh TEMPLATE của cây dạy (khác "Point Image" ở trên:
                      đây là ảnh capture/component của CÂY DẠY submitMachineTemplate, không phải
                      điểm đo phẳng v1.x). Tuỳ chọn — máy chưa nâng cấp không bị ảnh hưởng. */}
                  <div className="mt-4 rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-4">
                    <h4 className="mb-2 font-semibold text-cyan-300">🖼️ Ảnh template của cây dạy (BG-116, tùy chọn)</h4>
                    <p className="mb-2 text-white/80">
                      Sau khi đẩy cây dạy qua <code className="text-white">submitMachineTemplate</code>, cột
                      {" "}<code className="text-white">templateImagePath</code> trong payload chỉ mang đường dẫn HỆ TỆP
                      của máy (vd <code className="text-white">D:/InspectProAOI/...jpg</code>) — server KHÔNG fetch được
                      đường dẫn đó. Máy có thể (tùy chọn) tải chính byte ảnh lên server bằng ba bước:
                    </p>
                    <ol className="list-decimal space-y-1 pl-5 text-white/80">
                      <li><code className="text-white">submitMachineTemplate</code> — đẩy cây (surface/position/capture/component) như hôm nay, không đổi.</li>
                      <li><code className="text-white">machineApi.presignTemplateImage</code> — khai <code>captureExtId</code> (ảnh mặt/lượt chụp) hoặc thêm <code>componentExtId</code> (ảnh riêng của linh kiện), NÊN LUÔN khai <code>productModelCode</code> (xem cảnh báo dưới), <code>contentHash</code> (sha256 hex), <code>sizeBytes</code>, <code>ext</code> (jpg/png). Trả về <code>objectKey</code> + <code>uploadUrl</code>.</li>
                      <li><code className="text-white">PUT {"{uploadUrl}"}</code> — tải byte ảnh THẬT (body nhị phân, cùng header <code>x-api-key</code>/<code>x-machine-code</code> như upload ZIP).</li>
                      <li><code className="text-white">machineApi.commitTemplateImage</code> — khai lại đúng <code>captureExtId</code>/<code>componentExtId</code>/<code>productModelCode</code>/<code>contentHash</code>/<code>ext</code>; server đối chiếu sha256 với byte đã nhận rồi ghi URL vào đúng hàng cây.</li>
                    </ol>
                    <p className="mt-2 text-white/80">Ví dụ:</p>
                    <CodeBlock code={templateImageFlowExample} language="typescript" />
                    <ul className="mt-3 list-disc space-y-1 pl-5 text-white/70">
                      <li><strong>productModelCode:</strong> tùy chọn nhưng NÊN LUÔN gửi — <code>captureExtId</code> là GUID do máy cấp, không đảm bảo duy nhất trên toàn hệ (một máy dạy cây CLONE cho hai sản phẩm khác nhau có thể mang cùng bộ GUID). Không gửi mà server thấy captureExtId khớp NHIỀU sản phẩm của cùng máy ⇒ 400, không đoán bừa sản phẩm nào.</li>
                      <li><strong>Mã lỗi:</strong> <code className="text-white">NOT_FOUND</code> — <code>captureExtId</code> lạ, hoặc <code>componentExtId</code> không thuộc đúng capture đã khai. <code className="text-white">FORBIDDEN</code> — capture thuộc máy khác (ở bước presign/commit), HOẶC ở bước PUT máy chưa dạy cây cho product model trong <code>uploadUrl</code>. <code className="text-white">BAD_REQUEST</code> — <code>contentHash</code>/<code>sizeBytes</code> khai không khớp byte thật đã tải lên (PUT lại rồi commit lại), HOẶC thiếu <code>productModelCode</code> khi captureExtId nhập nhằng nhiều sản phẩm.</li>
                      <li><strong>Idempotent:</strong> commit lặp lại với CÙNG nội dung ảnh (cùng sha256) là AN TOÀN — không tạo hàng mới, không lỗi.</li>
                      <li><strong>Tùy chọn — máy chưa nâng cấp không ảnh hưởng ingest:</strong> đây là BƯỚC RIÊNG, SAU đẩy cây. Máy không gọi hai cửa mới này vẫn <code>submitMachineTemplate</code> bình thường; canvas dạy giới hạn trên hệ chỉ hiện thông điệp "ảnh chưa được tải lên hệ" thay vì lỗi.</li>
                    </ul>
                  </div>
                </TabsContent>

                <TabsContent value="heartbeat">
                  <Card className={glassCard}>
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <Badge className="bg-success text-success-foreground">POST</Badge>
                        <code className="text-sm text-white">machineApi.heartbeat</code>
                      </div>
                      <CardDescription>Duy trì trạng thái online cho máy.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div>
                        <h4 className="mb-3 font-semibold text-white">Request</h4>
                        <CodeBlock code={heartbeatExample} language="typescript" />
                      </div>
                      <div className="rounded-2xl border border-dashed border-white/20 bg-white/5 p-4 text-sm text-white/80">
                        <ul className="list-disc space-y-1 pl-5">
                          <li>Gọi mỗi 30 giây để tránh offline</li>
                          <li>Submit inspection cũng refresh heartbeat tự động</li>
                          <li>Response: {`{success: true, machineId: number}`}</li>
                        </ul>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>

              <section className="space-y-4">
                <div>
                  <h2 className="text-xl font-semibold text-foreground">Multi-language Quickstart</h2>
                  <p className="text-sm text-muted-foreground">
                    Mẫu mã nguồn thực tế cho TypeScript, Python, Java, C#, Go.
                  </p>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  {languageGuides.map((guide) => (
                    <Card key={guide.name} className="border border-white/10 bg-slate-900 text-white">
                      <CardHeader>
                        <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs uppercase tracking-wide">
                          <Languages className="h-3 w-3" />
                          {guide.name}
                        </div>
                      </CardHeader>
                      <CardContent>
                        <CodeBlock code={guide.code} language="javascript" />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>

              <Card className={glassCard}>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <Badge variant="destructive">Errors</Badge>
                    <CardTitle>Xử lý lỗi & resiliency</CardTitle>
                  </div>
                  <CardDescription>Các mã lỗi chính từ machineApi</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <CodeBlock code={errorResponse} />
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border border-white/20 p-4">
                      <h4 className="font-semibold text-white">HTTP 401 · UNAUTHORIZED</h4>
                      <p className="text-sm text-white/80">Sai hoặc thiếu API Key.</p>
                    </div>
                    <div className="rounded-2xl border border-white/20 p-4">
                      <h4 className="font-semibold text-white">HTTP 400 · BAD_REQUEST</h4>
                      <p className="text-sm text-white/80">Payload thiếu trường bắt buộc hoặc sai schema.</p>
                    </div>
                    <div className="rounded-2xl border border-white/20 p-4">
                      <h4 className="font-semibold text-white">HTTP 404 · NOT_FOUND</h4>
                      <p className="text-sm text-white/80">Không tìm thấy inspection / measurement.</p>
                    </div>
                    <div className="rounded-2xl border border-white/20 p-4">
                      <h4 className="font-semibold text-white">HTTP 500 · INTERNAL_ERROR</h4>
                      <p className="text-sm text-white/80">Retry với exponential backoff, log diagnostics.</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
  );
}
