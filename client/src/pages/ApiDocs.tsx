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
  AlertCircle
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
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="submit" className="gap-2">
              <Send className="h-4 w-4" />
              Gửi kết quả kiểm tra
            </TabsTrigger>
            <TabsTrigger value="upload" className="gap-2">
              <Upload className="h-4 w-4" />
              Upload ảnh
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

          {/* Error Handling */}
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
