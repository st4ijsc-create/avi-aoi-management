/**
 * doc 48 R4 (tech-debt) — "Machine Sync / Registration" API-docs section extracted VERBATIM from
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
  ShieldCheck,
  ClipboardList,
  Camera,
  HardDrive,
  Image,
} from "lucide-react";
import { CodeBlock, glassCard } from "./shared";

interface ApiSectionProps {
  endpointBase: string;
  baseUrl: string;
}

export function MachineSyncSection({ endpointBase, baseUrl }: ApiSectionProps) {
  // ============================================================
  // Machine Sync / Registration examples
  // ============================================================
  const machineRegisterExample = `POST ${baseUrl}/api/machine/register
Content-Type: application/json
// Không cần API Key — public REST endpoint

{
  "serialNumber": "AOI-SN-2025-0042",
  "name": "AOI Line A - Unit 3",
  "machineType": "AOI",
  "model": "SPI-3000",
  "manufacturer": "Koh Young",
  "firmwareVersion": "3.2.1",
  "syncMode": "online"
}`;

  const machineRegisterResponse = `// Máy mới → tạo pending
{
  "success": true,
  "id": 15,
  "registrationStatus": "pending",
  "message": "Machine registered, awaiting admin approval"
}

// Máy đã tồn tại → cập nhật thông tin, reset về pending
{
  "success": true,
  "id": 15,
  "registrationStatus": "pending",
  "message": "Machine info updated, awaiting approval"
}`;

  const machineConfigExample = `GET ${baseUrl}/api/machine/config?serialNumber=AOI-SN-2025-0042
// Không cần API Key — public REST endpoint`;

  const machineConfigResponsePending = `// Máy chưa được duyệt → KHÔNG có apiKey
{
  "success": true,
  "machineId": 15,
  "name": "AOI Line A - Unit 3",
  "code": "SN-AOI-SN-2025-0042",
  "serialNumber": "AOI-SN-2025-0042",
  "apiKey": null,
  "machineType": "AOI",
  "model": "SPI-3000",
  "manufacturer": "Koh Young",
  "firmwareVersion": "3.2.1",
  "registrationStatus": "pending",
  "syncMode": "online",
  "stationId": 1,
  "isApproved": false,
  "mapping": {
    "station": { "id": 1, "code": "ST-DEFAULT", "name": "Default Station" },
    "line": { "id": 1, "code": "LINE-A", "name": "Production Line A" }
  }
}`;

  const machineConfigResponseApproved = `// Máy đã duyệt → có apiKey để dùng cho các API khác
{
  "success": true,
  "machineId": 15,
  "name": "AOI Line A - Unit 3",
  "code": "AOI-03",
  "serialNumber": "AOI-SN-2025-0042",
  "apiKey": "mach_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456",
  "machineType": "AOI",
  "registrationStatus": "approved",
  "syncMode": "online",
  "stationId": 5,
  "isApproved": true,
  "mapping": {
    "station": { "id": 5, "code": "ST-A03", "name": "Station A-03" },
    "line": { "id": 2, "code": "LINE-A", "name": "Production Line A" }
  }
}`;

  const machineListPendingExample = `GET ${endpointBase}/machine.listPending
Headers:
  Cookie: auth-session=<admin-jwt>
// Yêu cầu quyền Admin`;

  const machineListPendingResponse = `{
  "result": {
    "data": [
      {
        "id": 15,
        "code": "SN-AOI-SN-2025-0042",
        "name": "AOI Line A - Unit 3",
        "machineType": "AOI",
        "serialNumber": "AOI-SN-2025-0042",
        "firmwareVersion": "3.2.1",
        "registrationStatus": "pending",
        "syncMode": "online",
        "createdAt": "2025-07-14T08:30:00.000Z"
      },
      {
        "id": 16,
        "code": "SN-AVI-2025-0010",
        "name": "AVI Camera Module 2",
        "machineType": "AVI",
        "serialNumber": "AVI-2025-0010",
        "firmwareVersion": "1.0.5",
        "registrationStatus": "pending",
        "syncMode": "offline",
        "createdAt": "2025-07-14T09:15:00.000Z"
      }
    ]
  }
}`;

  const machineApproveExample = `POST ${endpointBase}/machine.approve
Headers:
  Content-Type: application/json
  Cookie: auth-session=<admin-jwt>

{
  "id": 15,
  "code": "AOI-03",
  "name": "AOI Line A #3",
  "stationId": 5
}`;

  const machineApproveResponse = `{
  "result": {
    "data": {
      "success": true,
      "apiKey": "mach_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456",
      "message": "Machine approved and mapped"
    }
  }
}`;

  const machineRejectExample = `POST ${endpointBase}/machine.reject
Headers:
  Content-Type: application/json
  Cookie: auth-session=<admin-jwt>

{
  "id": 16,
  "reason": "Duplicate registration - already exists as AVI-02"
}`;

  const machineRejectResponse = `{
  "result": {
    "data": {
      "success": true,
      "message": "Machine registration rejected"
    }
  }
}`;

  const machineSyncFlowExample = `// === Machine Auto-Registration Flow (TypeScript) ===
// Máy AOI/AVI tự động đăng ký và lấy config khi khởi động
// Dùng REST endpoints (plain JSON) — không cần tRPC client

const BASE = "${typeof window !== "undefined" ? window.location.origin : ""}/api/machine";

async function initMachine(serialNumber: string) {
  // Step 1: Register (POST /api/machine/register — public, không cần API Key)
  const regRes = await fetch(BASE + "/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      serialNumber,
      name: "AOI Unit " + serialNumber,
      machineType: "AOI",
      model: "SPI-3000",
      firmwareVersion: "3.2.1",
      syncMode: "online",
    }),
  });
  const regData = await regRes.json();
  console.log("Registered:", regData.id, regData.registrationStatus);

  // Step 2: Poll config cho đến khi được duyệt
  // GET /api/machine/config?serialNumber=...
  const pollConfig = async (): Promise<any> => {
    const res = await fetch(
      BASE + "/config?serialNumber=" + encodeURIComponent(serialNumber)
    );
    const config = await res.json();

    if (config.isApproved && config.apiKey) {
      console.log("✅ Approved! API Key:", config.apiKey);
      return config;
    }
    console.log("⏳ Waiting for admin approval...");
    await new Promise(r => setTimeout(r, 10000)); // Retry sau 10s
    return pollConfig();
  };

  const config = await pollConfig();

  // Step 3: Heartbeat (POST /api/machine/heartbeat)
  await fetch(BASE + "/heartbeat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": config.apiKey,
    },
    body: JSON.stringify({ apiKey: config.apiKey }),
  });

  // Step 4: Dùng apiKey cho submit-inspection, sync-points, get-points
  // POST /api/machine/submit-inspection
  // POST /api/machine/sync-points
  // GET  /api/machine/get-points?apiKey=...

  // Step 5: Sync ảnh mẫu sản phẩm (Product Reference Image)
  // GET  /api/machine/product-image?productModelCode=...&apiKey=...
  // POST /api/machine/sync-product-image  (upload ảnh từ máy lên server)
}

initMachine("AOI-SN-2025-0042");`;


  return (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <HardDrive className="h-5 w-5" />
                    Machine Sync & Registration APIs
                  </CardTitle>
                  <CardDescription>
                    API đăng ký tự động máy AOI/AVI, lấy cấu hình, và quản lý duyệt máy từ Admin.
                    Cho phép máy tự đăng ký khi khởi động mà không cần API Key — Admin duyệt sau.
                  </CardDescription>
                </CardHeader>
              </Card>

              {/* Workflow Overview */}
              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Quy trình đăng ký máy</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="rounded-2xl border border-dashed border-white/20 bg-white/5 p-4 text-sm text-white/80">
                    <ol className="list-decimal space-y-2 pl-5">
                      <li><strong>Máy khởi động</strong> → gọi <code>machine.register</code> gửi serialNumber, tên, loại máy, firmware</li>
                      <li><strong>Máy poll</strong> <code>machine.config</code> mỗi 10s để kiểm tra trạng thái duyệt</li>
                      <li><strong>Admin mở Settings</strong> → thấy máy pending → duyệt hoặc từ chối</li>
                      <li><strong>Admin duyệt</strong> <code>machine.approve</code> → mapping station/line, sinh API Key</li>
                      <li><strong>Máy nhận config</strong> → lấy được apiKey → bắt đầu gọi heartbeat, submitInspection</li>
                    </ol>
                  </div>
                </CardContent>
              </Card>

              <Tabs defaultValue="register" className="space-y-6">
                <TabsList className="grid w-full grid-cols-5">
                  <TabsTrigger value="register" className="gap-2 text-xs">
                    <Send className="h-4 w-4" />
                    Register
                  </TabsTrigger>
                  <TabsTrigger value="config" className="gap-2 text-xs">
                    <RefreshCcw className="h-4 w-4" />
                    Config
                  </TabsTrigger>
                  <TabsTrigger value="listPending" className="gap-2 text-xs">
                    <ClipboardList className="h-4 w-4" />
                    List Pending
                  </TabsTrigger>
                  <TabsTrigger value="approve" className="gap-2 text-xs">
                    <ShieldCheck className="h-4 w-4" />
                    Approve
                  </TabsTrigger>
                  <TabsTrigger value="reject" className="gap-2 text-xs">
                    <Activity className="h-4 w-4" />
                    Reject
                  </TabsTrigger>
                </TabsList>

                {/* Register */}
                <TabsContent value="register">
                  <Card className={glassCard}>
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <Badge className="bg-success text-success-foreground">POST</Badge>
                        <code className="text-sm text-white">machine.register</code>
                        <Badge variant="outline" className="border-green-500 text-green-400">Public</Badge>
                      </div>
                      <CardDescription>
                        Máy AOI/AVI gọi khi khởi động để đăng ký vào hệ thống. Không cần API Key.
                        Nếu serialNumber đã tồn tại, cập nhật thông tin và reset về trạng thái pending.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div>
                        <h4 className="mb-3 font-semibold text-white">Request</h4>
                        <CodeBlock code={machineRegisterExample} language="typescript" />
                      </div>
                      <div>
                        <h4 className="mb-3 font-semibold text-white">Response</h4>
                        <CodeBlock code={machineRegisterResponse} />
                      </div>
                      <div className="rounded-2xl border border-dashed border-white/20 bg-white/5 p-4 text-sm text-white/80">
                        <h4 className="mb-2 font-semibold text-white">Input Schema</h4>
                        <ul className="list-disc space-y-1 pl-5">
                          <li><code>serialNumber</code> (string, bắt buộc) — Số serial duy nhất của máy</li>
                          <li><code>name</code> (string, bắt buộc) — Tên hiển thị</li>
                          <li><code>machineType</code> (enum: "AOI" | "AVI" | "AUTOMATION", bắt buộc)</li>
                          <li><code>model</code> (string, optional) — Model máy</li>
                          <li><code>manufacturer</code> (string, optional) — Hãng sản xuất</li>
                          <li><code>firmwareVersion</code> (string, optional) — Phiên bản firmware</li>
                          <li><code>syncMode</code> (enum: "online" | "offline", default: "online")</li>
                        </ul>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Config */}
                <TabsContent value="config">
                  <Card className={glassCard}>
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <Badge className="bg-blue-600 text-white">GET</Badge>
                        <code className="text-sm text-white">machine.config</code>
                        <Badge variant="outline" className="border-green-500 text-green-400">Public</Badge>
                      </div>
                      <CardDescription>
                        Trả về toàn bộ cấu hình, trạng thái duyệt, mapping station/line.
                        API Key chỉ trả về khi registrationStatus = "approved".
                        Máy nên poll endpoint này mỗi 10 giây cho đến khi nhận được apiKey.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div>
                        <h4 className="mb-3 font-semibold text-white">Request</h4>
                        <CodeBlock code={machineConfigExample} language="typescript" />
                      </div>
                      <div>
                        <h4 className="mb-3 font-semibold text-white">Response (Pending — chưa duyệt)</h4>
                        <CodeBlock code={machineConfigResponsePending} />
                      </div>
                      <div>
                        <h4 className="mb-3 font-semibold text-white">Response (Approved — đã duyệt)</h4>
                        <CodeBlock code={machineConfigResponseApproved} />
                      </div>
                      <div className="rounded-2xl border border-dashed border-white/20 bg-white/5 p-4 text-sm text-white/80">
                        <h4 className="mb-2 font-semibold text-white">Lưu ý quan trọng</h4>
                        <ul className="list-disc space-y-1 pl-5">
                          <li><code>apiKey</code> = null nếu máy chưa được duyệt</li>
                          <li><code>isApproved</code> = true khi registrationStatus = "approved"</li>
                          <li><code>mapping</code> chứa thông tin station và line đã mapping</li>
                          <li>Nếu máy chưa đăng ký → trả về 404 NOT_FOUND</li>
                        </ul>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* List Pending */}
                <TabsContent value="listPending">
                  <Card className={glassCard}>
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <Badge className="bg-blue-600 text-white">GET</Badge>
                        <code className="text-sm text-white">machine.listPending</code>
                        <Badge variant="outline" className="border-yellow-500 text-yellow-400">Admin</Badge>
                      </div>
                      <CardDescription>
                        Lấy danh sách máy đang chờ duyệt. Chỉ Admin truy cập được.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div>
                        <h4 className="mb-3 font-semibold text-white">Request</h4>
                        <CodeBlock code={machineListPendingExample} language="typescript" />
                      </div>
                      <div>
                        <h4 className="mb-3 font-semibold text-white">Response</h4>
                        <CodeBlock code={machineListPendingResponse} />
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Approve */}
                <TabsContent value="approve">
                  <Card className={glassCard}>
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <Badge className="bg-success text-success-foreground">POST</Badge>
                        <code className="text-sm text-white">machine.approve</code>
                        <Badge variant="outline" className="border-yellow-500 text-yellow-400">Admin</Badge>
                      </div>
                      <CardDescription>
                        Admin duyệt máy — đổi code/tên, mapping vào station, tự sinh API Key.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div>
                        <h4 className="mb-3 font-semibold text-white">Request</h4>
                        <CodeBlock code={machineApproveExample} language="typescript" />
                      </div>
                      <div>
                        <h4 className="mb-3 font-semibold text-white">Response</h4>
                        <CodeBlock code={machineApproveResponse} />
                      </div>
                      <div className="rounded-2xl border border-dashed border-white/20 bg-white/5 p-4 text-sm text-white/80">
                        <h4 className="mb-2 font-semibold text-white">Input Schema</h4>
                        <ul className="list-disc space-y-1 pl-5">
                          <li><code>id</code> (number, bắt buộc) — ID máy cần duyệt</li>
                          <li><code>code</code> (string, optional) — Mã máy chuẩn hóa (VD: "AOI-03")</li>
                          <li><code>name</code> (string, optional) — Đổi tên hiển thị</li>
                          <li><code>stationId</code> (number, optional) — Gán vào station/line cụ thể</li>
                        </ul>
                        <p className="mt-2 text-white/60">
                          Nếu máy chưa có API Key, hệ thống tự sinh <code>mach_*</code> key.
                          API Key được trả về trong response để Admin copy cho máy (hoặc máy tự lấy qua config).
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Reject */}
                <TabsContent value="reject">
                  <Card className={glassCard}>
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <Badge className="bg-destructive text-destructive-foreground">POST</Badge>
                        <code className="text-sm text-white">machine.reject</code>
                        <Badge variant="outline" className="border-yellow-500 text-yellow-400">Admin</Badge>
                      </div>
                      <CardDescription>
                        Admin từ chối đăng ký máy với lý do tùy chọn.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div>
                        <h4 className="mb-3 font-semibold text-white">Request</h4>
                        <CodeBlock code={machineRejectExample} language="typescript" />
                      </div>
                      <div>
                        <h4 className="mb-3 font-semibold text-white">Response</h4>
                        <CodeBlock code={machineRejectResponse} />
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>

              {/* Full Flow Example */}
              <Card className="border border-white/10 bg-slate-900 text-white">
                <CardHeader>
                  <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs uppercase tracking-wide">
                    <Languages className="h-3 w-3" />
                    TypeScript — Auto Registration Flow
                  </div>
                  <CardDescription className="text-white/70">
                    Ví dụ đầy đủ: máy khởi động → đăng ký → poll config → nhận API Key → bắt đầu hoạt động.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <CodeBlock code={machineSyncFlowExample} language="typescript" />
                </CardContent>
              </Card>
            </div>
  );
}
