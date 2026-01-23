import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { 
  Copy,
  Code,
  Send,
  Upload,
  CheckCircle2,
  AlertCircle,
  Wifi,
  Database,
  FileDown,
  BarChart3,
  Mail
} from "lucide-react";
import { navItems } from "@/lib/navigation";



const copyToClipboard = (text: string) => {
  navigator.clipboard.writeText(text);
  toast.success("Đã copy vào clipboard");
};

const CodeBlock = ({ code, language = "json" }: { code: string; language?: string }) => (
  <div className="relative">
    <Button
      variant="ghost"
      size="icon"
      className="absolute top-2 right-2 h-8 w-8"
      onClick={() => copyToClipboard(code)}
    >
      <Copy className="h-4 w-4" />
    </Button>
    <pre className="bg-secondary/50 rounded-lg p-4 overflow-x-auto text-sm">
      <code className="text-foreground">{code}</code>
    </pre>
  </div>
);

export default function ApiDocs() {
  const baseUrl = window.location.origin;

  const submitInspectionExample = `{
  "machineCode": "AVI001",
  "serialNumber": "SN123456789",
  "productModel": "MODEL-A",
  "batchNumber": "BATCH001",
  "cycleTime": 5.2,
  "overallResult": "OK",
  "measurements": [
    {
      "pointId": "POINT001",
      "measuredValue": "12.5mm",
      "result": "OK",
      "remark": "Điểm đo 1 - Kích thước",
      "imageBase64": "data:image/jpeg;base64,/9j/4AAQ..."
    },
    {
      "pointId": "POINT002",
      "measuredValue": "PASS",
      "result": "OK",
      "remark": "Điểm đo 2 - Màu sắc"
    }
  ]
}`;

  const submitInspectionResponse = `{
  "success": true,
  "data": {
    "inspectionId": 123,
    "serialNumber": "SN123456789",
    "overallResult": "OK",
    "measurementCount": 2,
    "createdAt": "2025-01-13T10:30:00.000Z"
  }
}`;

  const uploadImageExample = `curl -X POST "${baseUrl}/api/machine/upload-image" \\
  -H "X-API-Key: your-machine-api-key" \\
  -H "Content-Type: multipart/form-data" \\
  -F "image=@/path/to/image.jpg" \\
  -F "inspectionId=123" \\
  -F "pointId=POINT001"`;

  const uploadImageResponse = `{
  "success": true,
  "data": {
    "imageUrl": "https://storage.example.com/images/abc123.jpg"
  }
}`;

  const errorResponse = `{
  "success": false,
  "error": {
    "code": "INVALID_API_KEY",
    "message": "API Key không hợp lệ hoặc đã bị vô hiệu hóa"
  }
}`;

  return (
    <DashboardLayout 
      title="AVI/AOI Management" 
      navItems={navItems}
      currentPath="/api-docs"
    >
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">API Documentation</h1>
          <p className="text-muted-foreground">Hướng dẫn tích hợp API cho máy AVI/AOI gửi dữ liệu kiểm tra</p>
        </div>

        {/* Overview */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Code className="h-5 w-5 text-primary" />
              Tổng quan
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              Hệ thống cung cấp REST API để các máy AVI, AOI và thiết bị tự động hóa gửi dữ liệu kiểm tra.
              Mỗi máy được cấp một API Key riêng để xác thực.
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-lg bg-secondary/50">
                <h4 className="font-medium text-foreground mb-2">Base URL</h4>
                <code className="text-sm text-primary">{baseUrl}/api/machine</code>
              </div>
              <div className="p-4 rounded-lg bg-secondary/50">
                <h4 className="font-medium text-foreground mb-2">Authentication</h4>
                <code className="text-sm text-primary">Header: X-API-Key</code>
              </div>
              <div className="p-4 rounded-lg bg-secondary/50">
                <h4 className="font-medium text-foreground mb-2">Content-Type</h4>
                <code className="text-sm text-primary">application/json</code>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* API Endpoints */}
        <Tabs defaultValue="submit">
          <TabsList className="grid w-full grid-cols-7">
            <TabsTrigger value="submit" className="gap-2">
              <Send className="h-4 w-4" />
              Gửi kết quả
            </TabsTrigger>
            <TabsTrigger value="upload" className="gap-2">
              <Upload className="h-4 w-4" />
              Upload ảnh
            </TabsTrigger>
            <TabsTrigger value="websocket" className="gap-2">
              <Wifi className="h-4 w-4" />
              WebSocket
            </TabsTrigger>
            <TabsTrigger value="statistics" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              Thống kê
            </TabsTrigger>
            <TabsTrigger value="export" className="gap-2">
              <FileDown className="h-4 w-4" />
              Export
            </TabsTrigger>
            <TabsTrigger value="reports" className="gap-2">
              <Mail className="h-4 w-4" />
              Báo cáo
            </TabsTrigger>
            <TabsTrigger value="errors" className="gap-2">
              <AlertCircle className="h-4 w-4" />
              Xử lý lỗi
            </TabsTrigger>
          </TabsList>

          {/* Submit Inspection */}
          <TabsContent value="submit">
            <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Badge className="bg-success text-success-foreground">POST</Badge>
                  <code className="text-foreground">/api/machine/submit-inspection</code>
                </div>
                <CardDescription>
                  Gửi kết quả kiểm tra của một sản phẩm bao gồm tất cả các điểm đo
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <h4 className="font-medium text-foreground mb-3">Headers</h4>
                  <div className="bg-secondary/50 rounded-lg p-4">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2 text-muted-foreground">Header</th>
                          <th className="text-left py-2 text-muted-foreground">Giá trị</th>
                          <th className="text-left py-2 text-muted-foreground">Mô tả</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-border/50">
                          <td className="py-2"><code>X-API-Key</code></td>
                          <td className="py-2"><code>your-machine-api-key</code></td>
                          <td className="py-2 text-muted-foreground">API Key của máy (bắt buộc)</td>
                        </tr>
                        <tr>
                          <td className="py-2"><code>Content-Type</code></td>
                          <td className="py-2"><code>application/json</code></td>
                          <td className="py-2 text-muted-foreground">Định dạng dữ liệu</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <h4 className="font-medium text-foreground mb-3">Request Body</h4>
                  <CodeBlock code={submitInspectionExample} />
                </div>

                <div>
                  <h4 className="font-medium text-foreground mb-3">Mô tả các trường</h4>
                  <div className="bg-secondary/50 rounded-lg p-4">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2 text-muted-foreground">Trường</th>
                          <th className="text-left py-2 text-muted-foreground">Kiểu</th>
                          <th className="text-left py-2 text-muted-foreground">Bắt buộc</th>
                          <th className="text-left py-2 text-muted-foreground">Mô tả</th>
                        </tr>
                      </thead>
                      <tbody className="text-foreground">
                        <tr className="border-b border-border/50">
                          <td className="py-2"><code>machineCode</code></td>
                          <td className="py-2">string</td>
                          <td className="py-2"><CheckCircle2 className="h-4 w-4 text-success" /></td>
                          <td className="py-2 text-muted-foreground">Mã máy (phải khớp với API Key)</td>
                        </tr>
                        <tr className="border-b border-border/50">
                          <td className="py-2"><code>serialNumber</code></td>
                          <td className="py-2">string</td>
                          <td className="py-2"><CheckCircle2 className="h-4 w-4 text-success" /></td>
                          <td className="py-2 text-muted-foreground">Số serial sản phẩm</td>
                        </tr>
                        <tr className="border-b border-border/50">
                          <td className="py-2"><code>productModel</code></td>
                          <td className="py-2">string</td>
                          <td className="py-2">-</td>
                          <td className="py-2 text-muted-foreground">Model sản phẩm</td>
                        </tr>
                        <tr className="border-b border-border/50">
                          <td className="py-2"><code>batchNumber</code></td>
                          <td className="py-2">string</td>
                          <td className="py-2">-</td>
                          <td className="py-2 text-muted-foreground">Số lô sản xuất</td>
                        </tr>
                        <tr className="border-b border-border/50">
                          <td className="py-2"><code>cycleTime</code></td>
                          <td className="py-2">number</td>
                          <td className="py-2">-</td>
                          <td className="py-2 text-muted-foreground">Thời gian kiểm tra (giây)</td>
                        </tr>
                        <tr className="border-b border-border/50">
                          <td className="py-2"><code>overallResult</code></td>
                          <td className="py-2">string</td>
                          <td className="py-2"><CheckCircle2 className="h-4 w-4 text-success" /></td>
                          <td className="py-2 text-muted-foreground">"OK" hoặc "NG"</td>
                        </tr>
                        <tr>
                          <td className="py-2"><code>measurements</code></td>
                          <td className="py-2">array</td>
                          <td className="py-2"><CheckCircle2 className="h-4 w-4 text-success" /></td>
                          <td className="py-2 text-muted-foreground">Danh sách các điểm đo</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <h4 className="font-medium text-foreground mb-3">Cấu trúc measurement</h4>
                  <div className="bg-secondary/50 rounded-lg p-4">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2 text-muted-foreground">Trường</th>
                          <th className="text-left py-2 text-muted-foreground">Kiểu</th>
                          <th className="text-left py-2 text-muted-foreground">Mô tả</th>
                        </tr>
                      </thead>
                      <tbody className="text-foreground">
                        <tr className="border-b border-border/50">
                          <td className="py-2"><code>pointId</code></td>
                          <td className="py-2">string</td>
                          <td className="py-2 text-muted-foreground">ID điểm đo (bắt buộc)</td>
                        </tr>
                        <tr className="border-b border-border/50">
                          <td className="py-2"><code>measuredValue</code></td>
                          <td className="py-2">string</td>
                          <td className="py-2 text-muted-foreground">Giá trị đo được</td>
                        </tr>
                        <tr className="border-b border-border/50">
                          <td className="py-2"><code>result</code></td>
                          <td className="py-2">string</td>
                          <td className="py-2 text-muted-foreground">"OK" hoặc "NG" (bắt buộc)</td>
                        </tr>
                        <tr className="border-b border-border/50">
                          <td className="py-2"><code>remark</code></td>
                          <td className="py-2">string</td>
                          <td className="py-2 text-muted-foreground">Ghi chú cho điểm đo</td>
                        </tr>
                        <tr>
                          <td className="py-2"><code>imageBase64</code></td>
                          <td className="py-2">string</td>
                          <td className="py-2 text-muted-foreground">Ảnh điểm đo (base64 encoded)</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <h4 className="font-medium text-foreground mb-3">Response thành công</h4>
                  <CodeBlock code={submitInspectionResponse} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Upload Image */}
          <TabsContent value="upload">
            <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Badge className="bg-success text-success-foreground">POST</Badge>
                  <code className="text-foreground">/api/machine/upload-image</code>
                </div>
                <CardDescription>
                  Upload ảnh điểm đo riêng biệt (thay thế cho imageBase64 trong submit-inspection)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <h4 className="font-medium text-foreground mb-3">cURL Example</h4>
                  <CodeBlock code={uploadImageExample} language="bash" />
                </div>

                <div>
                  <h4 className="font-medium text-foreground mb-3">Form Data</h4>
                  <div className="bg-secondary/50 rounded-lg p-4">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2 text-muted-foreground">Field</th>
                          <th className="text-left py-2 text-muted-foreground">Kiểu</th>
                          <th className="text-left py-2 text-muted-foreground">Mô tả</th>
                        </tr>
                      </thead>
                      <tbody className="text-foreground">
                        <tr className="border-b border-border/50">
                          <td className="py-2"><code>image</code></td>
                          <td className="py-2">file</td>
                          <td className="py-2 text-muted-foreground">File ảnh (JPEG, PNG)</td>
                        </tr>
                        <tr className="border-b border-border/50">
                          <td className="py-2"><code>inspectionId</code></td>
                          <td className="py-2">number</td>
                          <td className="py-2 text-muted-foreground">ID kết quả kiểm tra</td>
                        </tr>
                        <tr>
                          <td className="py-2"><code>pointId</code></td>
                          <td className="py-2">string</td>
                          <td className="py-2 text-muted-foreground">ID điểm đo</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <h4 className="font-medium text-foreground mb-3">Response</h4>
                  <CodeBlock code={uploadImageResponse} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

           {/* WebSocket Mapping */}
          <TabsContent value="websocket">
            <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Badge className="bg-primary text-primary-foreground">WebSocket</Badge>
                  <code className="text-foreground">ws://{'{host}'}/api/socket.io</code>
                </div>
                <CardDescription>
                  Kết nối WebSocket để đăng ký máy và gửi dữ liệu realtime
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <h4 className="font-medium text-foreground mb-3">1. Kết nối WebSocket</h4>
                  <CodeBlock code={`// Sử dụng Socket.IO client
import { io } from "socket.io-client";

const socket = io("${baseUrl}", {
  path: "/api/socket.io",
  transports: ["websocket", "polling"],
});

socket.on("connect", () => {
  console.log("Connected to server");
});`} language="javascript" />
                </div>

                <div>
                  <h4 className="font-medium text-foreground mb-3">2. Đăng ký máy (Tự động)</h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    Máy gửi yêu cầu đăng ký, Admin phê duyệt trên giao diện Settings {'>'} Machine Mapping
                  </p>
                  <CodeBlock code={`// Gửi yêu cầu đăng ký
socket.emit("machine:register", {
  code: "AVI001",           // Mã máy (bắt buộc)
  name: "Máy AVI 001",      // Tên máy (bắt buộc)
  type: "AVI",              // Loại: "AVI" | "AOI" (bắt buộc)
  serialNumber: "SN123",    // Số serial (tùy chọn)
  manufacturer: "ABC Corp", // Nhà sản xuất (tùy chọn)
  model: "Model X",         // Model (tùy chọn)
  firmwareVersion: "1.0.0"  // Phiên bản firmware (tùy chọn)
});

// Nhận xác nhận yêu cầu đã được nhận
socket.on("machine:register_ack", (data) => {
  console.log("Registration status:", data.status);
  // status: "pending" - Đang chờ Admin phê duyệt
});

// Nhận thông báo được phê duyệt
socket.on("machine:registration_approved", (data) => {
  console.log("Approved! Machine ID:", data.machineId);
  console.log("API Key:", data.apiKey);
  // Lưu machineId và apiKey để sử dụng
});

// Nhận thông báo bị từ chối
socket.on("machine:registration_rejected", (data) => {
  console.log("Rejected:", data.reason);
});`} language="javascript" />
                </div>

                <div>
                  <h4 className="font-medium text-foreground mb-3">3. Xác nhận kết nối sau khi được phê duyệt</h4>
                  <CodeBlock code={`// Sau khi được phê duyệt, xác nhận kết nối
socket.emit("machine:confirm_mapping", {
  machineId: 123,           // ID máy từ server
  machineCode: "AVI001",    // Mã máy
  apiKey: "your-api-key"    // API Key từ server
});

// Gửi heartbeat định kỳ (đề xuất mỗi 30 giây)
setInterval(() => {
  socket.emit("machine:heartbeat", {
    machineId: 123,
    status: "running",
    metrics: {
      cpuUsage: 45.2,
      memoryUsage: 60.5,
      temperature: 42.0
    }
  });
}, 30000);`} language="javascript" />
                </div>

                <div>
                  <h4 className="font-medium text-foreground mb-3">4. Kết nối thủ công (Manual Mapping)</h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    Admin cấu hình kết nối đến máy qua IP:Port trong Settings {'>'} Machine Mapping {'>'} Kết nối thủ công
                  </p>
                  <div className="bg-secondary/50 rounded-lg p-4">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2 text-muted-foreground">Trường</th>
                          <th className="text-left py-2 text-muted-foreground">Kiểu</th>
                          <th className="text-left py-2 text-muted-foreground">Mô tả</th>
                        </tr>
                      </thead>
                      <tbody className="text-foreground">
                        <tr className="border-b border-border/50">
                          <td className="py-2"><code>machineId</code></td>
                          <td className="py-2">number</td>
                          <td className="py-2 text-muted-foreground">ID máy trong hệ thống</td>
                        </tr>
                        <tr className="border-b border-border/50">
                          <td className="py-2"><code>ipAddress</code></td>
                          <td className="py-2">string</td>
                          <td className="py-2 text-muted-foreground">Địa chỉ IP của máy (IPv4/IPv6)</td>
                        </tr>
                        <tr className="border-b border-border/50">
                          <td className="py-2"><code>port</code></td>
                          <td className="py-2">number</td>
                          <td className="py-2 text-muted-foreground">Cổng kết nối (mặc định: 8080)</td>
                        </tr>
                        <tr className="border-b border-border/50">
                          <td className="py-2"><code>protocol</code></td>
                          <td className="py-2">enum</td>
                          <td className="py-2 text-muted-foreground">"websocket" | "tcp" | "http"</td>
                        </tr>
                        <tr className="border-b border-border/50">
                          <td className="py-2"><code>isEnabled</code></td>
                          <td className="py-2">boolean</td>
                          <td className="py-2 text-muted-foreground">Bật/tắt kết nối</td>
                        </tr>
                        <tr className="border-b border-border/50">
                          <td className="py-2"><code>maxRetries</code></td>
                          <td className="py-2">number</td>
                          <td className="py-2 text-muted-foreground">Số lần thử lại tối đa</td>
                        </tr>
                        <tr>
                          <td className="py-2"><code>retryIntervalSeconds</code></td>
                          <td className="py-2">number</td>
                          <td className="py-2 text-muted-foreground">Khoảng cách giữa các lần thử (giây)</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <h4 className="font-medium text-foreground mb-3">5. Yêu cầu máy hỗ trợ (Manual Mapping)</h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    Để hệ thống kết nối được, máy cần:
                  </p>
                  <CodeBlock code={`// 1. Với protocol "http":
// Máy cần có endpoint GET /health trả về status 200
GET http://{ip}:{port}/health
Response: 200 OK

// 2. Với protocol "websocket":
// Máy cần chấp nhận kết nối WebSocket
ws://{ip}:{port}

// 3. Với protocol "tcp":
// Máy cần lắng nghe trên port TCP
tcp://{ip}:{port}`} language="text" />
                </div>

                <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
                  <h4 className="font-medium text-primary mb-2">Lưu ý</h4>
                  <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                    <li>Mỗi máy chỉ có thể có một cấu hình kết nối thủ công</li>
                    <li>Hệ thống sẽ tự động thử lại kết nối khi mất kết nối</li>
                    <li>Timeout mặc định cho test kết nối: 5 giây</li>
                    <li>Nên sử dụng WebSocket để có hiệu suất tốt nhất</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Statistics APIs */}
          <TabsContent value="statistics">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-primary" />
                  Statistics APIs
                </CardTitle>
                <CardDescription>
                  APIs thống kê với caching tự động (TTL: 5 phút)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <h4 className="font-medium text-foreground mb-3">1. Yield Rate theo Công ty</h4>
                  <div className="flex items-center gap-3 mb-2">
                    <Badge className="bg-blue-500 text-white">GET</Badge>
                    <code className="text-foreground">/api/trpc/corporateFactoryStats.yieldByCorporate</code>
                  </div>
                  <CodeBlock code={`// Query params
{
  "startDate": "2025-01-01T00:00:00Z",
  "endDate": "2025-01-31T23:59:59Z"
}

// Response
[
  {
    "corporateCode": "CORP001",
    "totalInspections": 15000,
    "okCount": 14250,
    "ngCount": 500,
    "ntfCount": 250,
    "yieldRate": "95.00"
  }
]`} />
                </div>

                <div>
                  <h4 className="font-medium text-foreground mb-3">2. Yield Rate theo Nhà máy</h4>
                  <div className="flex items-center gap-3 mb-2">
                    <Badge className="bg-blue-500 text-white">GET</Badge>
                    <code className="text-foreground">/api/trpc/corporateFactoryStats.yieldByFactory</code>
                  </div>
                  <CodeBlock code={`// Query params
{
  "corporateCode": "CORP001",  // Optional
  "startDate": "2025-01-01T00:00:00Z",
  "endDate": "2025-01-31T23:59:59Z"
}

// Response
[
  {
    "factoryCode": "FAC001",
    "corporateCode": "CORP001",
    "totalInspections": 5000,
    "okCount": 4750,
    "ngCount": 200,
    "ntfCount": 50,
    "yieldRate": "95.00"
  }
]`} />
                </div>

                <div>
                  <h4 className="font-medium text-foreground mb-3">3. Throughput theo Công ty</h4>
                  <div className="flex items-center gap-3 mb-2">
                    <Badge className="bg-blue-500 text-white">GET</Badge>
                    <code className="text-foreground">/api/trpc/corporateFactoryStats.throughputByCorporate</code>
                  </div>
                  <CodeBlock code={`// Query params
{
  "startDate": "2025-01-01T00:00:00Z",
  "endDate": "2025-01-31T23:59:59Z",
  "interval": "day"  // "hour" | "day" | "week"
}

// Response
[
  {
    "date": "2025-01-15",
    "corporateCode": "CORP001",
    "count": 500
  }
]`} />
                </div>

                <div>
                  <h4 className="font-medium text-foreground mb-3">4. Cache Statistics (Admin)</h4>
                  <div className="flex items-center gap-3 mb-2">
                    <Badge className="bg-blue-500 text-white">GET</Badge>
                    <code className="text-foreground">/api/trpc/corporateFactoryStats.cacheStats</code>
                  </div>
                  <CodeBlock code={`// Response
{
  "hits": 1250,
  "misses": 150,
  "size": 45,
  "memoryUsage": 524288,
  "isRedisConnected": true,
  "lastError": null,
  "uptime": 86400000
}`} />
                </div>

                <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
                  <h4 className="font-medium text-primary mb-2">Lưu ý về Caching</h4>
                  <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                    <li>Tất cả statistics APIs được cache với TTL 5 phút</li>
                    <li>Cache tự động invalidate khi có inspection mới</li>
                    <li>Hỗ trợ Redis với fallback về in-memory cache</li>
                    <li>Admin có thể xem cache stats và clear cache thủ công</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Export APIs */}
          <TabsContent value="export">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileDown className="h-5 w-5 text-primary" />
                  Export APIs
                </CardTitle>
                <CardDescription>
                  APIs xuất dữ liệu ra Excel và PDF
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <h4 className="font-medium text-foreground mb-3">1. Export Inspections</h4>
                  <div className="flex items-center gap-3 mb-2">
                    <Badge className="bg-green-500 text-white">POST</Badge>
                    <code className="text-foreground">/api/trpc/export.exportInspections</code>
                  </div>
                  <CodeBlock code={`// Request body
{
  "startDate": "2025-01-01T00:00:00Z",
  "endDate": "2025-01-31T23:59:59Z",
  "format": "excel",  // "excel" | "csv"
  "machineId": 1,     // Optional
  "result": "NG"      // Optional: "OK" | "NG" | "NTF"
}

// Response
{
  "url": "https://storage.example.com/exports/inspections_2025-01-31.xlsx",
  "filename": "inspections_2025-01-31.xlsx"
}`} />
                </div>

                <div>
                  <h4 className="font-medium text-foreground mb-3">2. Export Dashboard Statistics</h4>
                  <div className="flex items-center gap-3 mb-2">
                    <Badge className="bg-green-500 text-white">POST</Badge>
                    <code className="text-foreground">/api/trpc/export.exportDashboardStats</code>
                  </div>
                  <CodeBlock code={`// Request body
{
  "startDate": "2025-01-01T00:00:00Z",
  "endDate": "2025-01-31T23:59:59Z",
  "format": "excel",  // "excel" | "pdf"
  "corporateCode": "CORP001"  // Optional
}

// Response
{
  "url": "https://storage.example.com/exports/dashboard_stats_2025-01-31.xlsx",
  "filename": "dashboard_stats_2025-01-31.xlsx"
}

// Excel file includes 4 sheets:
// - Summary: Tổng quan thống kê
// - Corporate Stats: Thống kê theo công ty
// - Factory Stats: Thống kê theo nhà máy
// - Daily Throughput: Sản lượng theo ngày`} />
                </div>

                <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
                  <h4 className="font-medium text-primary mb-2">Lưu ý về Export</h4>
                  <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                    <li>File export được lưu trên S3 và có URL tạm thời</li>
                    <li>Access control: User chỉ export được data của corporates/factories được assign</li>
                    <li>Giới hạn: Tối đa 100,000 records mỗi lần export</li>
                    <li>Format PDF sẽ tạo HTML report có thể in ấn</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Scheduled Reports APIs */}
          <TabsContent value="reports">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Mail className="h-5 w-5 text-primary" />
                  Scheduled Reports APIs
                </CardTitle>
                <CardDescription>
                  APIs quản lý báo cáo tự động gửi qua email
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <h4 className="font-medium text-foreground mb-3">1. Preview Statistics Report</h4>
                  <div className="flex items-center gap-3 mb-2">
                    <Badge className="bg-blue-500 text-white">GET</Badge>
                    <code className="text-foreground">/api/trpc/scheduledReport.previewStatisticsReport</code>
                  </div>
                  <CodeBlock code={`// Query params
{
  "frequency": "weekly",  // "daily" | "weekly" | "monthly"
  "corporateCode": "CORP001",  // Optional
  "factoryCode": "FAC001"      // Optional
}

// Response
{
  "content": {
    "title": "Báo cáo Hàng tuần - Preview Report",
    "period": { "start": "...", "end": "..." },
    "summary": {
      "totalInspections": 5000,
      "okCount": 4750,
      "ngCount": 200,
      "ntfCount": 50,
      "yieldRate": "95.00"
    },
    "corporateStats": [...],
    "factoryStats": [...],
    "topNGMachines": [...]
  },
  "html": "<html>...</html>"
}`} />
                </div>

                <div>
                  <h4 className="font-medium text-foreground mb-3">2. Send Statistics Report</h4>
                  <div className="flex items-center gap-3 mb-2">
                    <Badge className="bg-green-500 text-white">POST</Badge>
                    <code className="text-foreground">/api/trpc/scheduledReport.sendStatisticsReport</code>
                  </div>
                  <CodeBlock code={`// Request body
{
  "name": "Báo cáo tuần",
  "frequency": "weekly",
  "recipients": ["manager@company.com", "qa@company.com"],
  "corporateCode": "CORP001",  // Optional
  "factoryCode": "FAC001"      // Optional
}

// Response
{
  "success": true,
  "message": "Report sent to 2 recipients",
  "summary": {
    "totalInspections": 5000,
    "yieldRate": "95.00"
  }
}`} />
                </div>

                <div>
                  <h4 className="font-medium text-foreground mb-3">3. CRUD Scheduled Reports</h4>
                  <div className="bg-secondary/50 rounded-lg p-4">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2 text-muted-foreground">Method</th>
                          <th className="text-left py-2 text-muted-foreground">Endpoint</th>
                          <th className="text-left py-2 text-muted-foreground">Mô tả</th>
                        </tr>
                      </thead>
                      <tbody className="text-foreground">
                        <tr className="border-b border-border/50">
                          <td className="py-2"><Badge className="bg-blue-500 text-white">GET</Badge></td>
                          <td className="py-2"><code>scheduledReport.list</code></td>
                          <td className="py-2 text-muted-foreground">Danh sách báo cáo đã lên lịch</td>
                        </tr>
                        <tr className="border-b border-border/50">
                          <td className="py-2"><Badge className="bg-green-500 text-white">POST</Badge></td>
                          <td className="py-2"><code>scheduledReport.create</code></td>
                          <td className="py-2 text-muted-foreground">Tạo báo cáo tự động mới</td>
                        </tr>
                        <tr className="border-b border-border/50">
                          <td className="py-2"><Badge className="bg-yellow-500 text-white">PUT</Badge></td>
                          <td className="py-2"><code>scheduledReport.update</code></td>
                          <td className="py-2 text-muted-foreground">Cập nhật cấu hình báo cáo</td>
                        </tr>
                        <tr className="border-b border-border/50">
                          <td className="py-2"><Badge variant="destructive">DELETE</Badge></td>
                          <td className="py-2"><code>scheduledReport.delete</code></td>
                          <td className="py-2 text-muted-foreground">Xóa báo cáo</td>
                        </tr>
                        <tr>
                          <td className="py-2"><Badge className="bg-green-500 text-white">POST</Badge></td>
                          <td className="py-2"><code>scheduledReport.sendTest</code></td>
                          <td className="py-2 text-muted-foreground">Gửi email test</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
                  <h4 className="font-medium text-primary mb-2">Lưu ý về Scheduled Reports</h4>
                  <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                    <li>Cần cấu hình SMTP trước khi sử dụng (Settings &gt; Cấu hình SMTP)</li>
                    <li>Hỗ trợ 3 tần suất: Hàng ngày, Hàng tuần, Hàng tháng</li>
                    <li>Email template bao gồm: Summary, Corporate Stats, Factory Stats, Top NG</li>
                    <li>Có thể preview trước khi gửi</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Errors */}
          <TabsContent value="errors">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-lg">Xử lý lỗi</CardTitle>
                <CardDescription>
                  Các mã lỗi và cách xử lý khi gọi API
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <h4 className="font-medium text-foreground mb-3">Response lỗi</h4>
                  <CodeBlock code={errorResponse} />
                </div>

                <div>
                  <h4 className="font-medium text-foreground mb-3">Danh sách mã lỗi</h4>
                  <div className="bg-secondary/50 rounded-lg p-4">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2 text-muted-foreground">HTTP Code</th>
                          <th className="text-left py-2 text-muted-foreground">Error Code</th>
                          <th className="text-left py-2 text-muted-foreground">Mô tả</th>
                        </tr>
                      </thead>
                      <tbody className="text-foreground">
                        <tr className="border-b border-border/50">
                          <td className="py-2"><Badge variant="destructive">401</Badge></td>
                          <td className="py-2"><code>INVALID_API_KEY</code></td>
                          <td className="py-2 text-muted-foreground">API Key không hợp lệ hoặc đã bị vô hiệu hóa</td>
                        </tr>
                        <tr className="border-b border-border/50">
                          <td className="py-2"><Badge variant="destructive">400</Badge></td>
                          <td className="py-2"><code>INVALID_REQUEST</code></td>
                          <td className="py-2 text-muted-foreground">Dữ liệu request không hợp lệ</td>
                        </tr>
                        <tr className="border-b border-border/50">
                          <td className="py-2"><Badge variant="destructive">400</Badge></td>
                          <td className="py-2"><code>MACHINE_CODE_MISMATCH</code></td>
                          <td className="py-2 text-muted-foreground">Mã máy không khớp với API Key</td>
                        </tr>
                        <tr className="border-b border-border/50">
                          <td className="py-2"><Badge variant="destructive">404</Badge></td>
                          <td className="py-2"><code>INSPECTION_NOT_FOUND</code></td>
                          <td className="py-2 text-muted-foreground">Không tìm thấy kết quả kiểm tra</td>
                        </tr>
                        <tr>
                          <td className="py-2"><Badge variant="destructive">500</Badge></td>
                          <td className="py-2"><code>INTERNAL_ERROR</code></td>
                          <td className="py-2 text-muted-foreground">Lỗi hệ thống, vui lòng thử lại</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
                  <h4 className="font-medium text-primary mb-2">Lưu ý quan trọng</h4>
                  <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                    <li>API Key được cấp khi tạo máy mới trong Settings</li>
                    <li>Mỗi máy có một API Key riêng, không chia sẻ giữa các máy</li>
                    <li>Nếu API Key bị lộ, liên hệ Admin để tạo lại</li>
                    <li>Ảnh nên được nén trước khi gửi để tối ưu băng thông</li>
                    <li>Kích thước ảnh tối đa: 10MB</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
