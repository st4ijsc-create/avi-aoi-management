import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  Activity,
  Copy,
  Languages,
  RefreshCcw,
  Send,
  ShieldCheck,
  UploadCloud,
  Building2,
  Users2,
  ClipboardList,
  BarChart3,
  PanelsTopLeft,
  RadioTower,
  BellRing,
  CalendarClock,
  Camera,
  FileArchive,
  HardDrive,
  Wrench,
  Package,
  Crosshair,
  ListOrdered,
  LayoutDashboard,
  LayoutGrid,
  MapPin,
  UserCog,
  Bell,
  Shield,
  Lock,
  Cpu,
  Monitor,
  Gauge,
  FileText,
  Mail,
  Server,
  Wifi,
  Pencil,
  Brain,
  TrendingUp,
  ScrollText,
  Eye,
} from "lucide-react";
import { toast } from "sonner";

const copyToClipboard = (text: string) => {
  navigator.clipboard.writeText(text).then(() => {
    toast.success("Đã copy vào clipboard");
  });
};

const CodeBlock = ({ code, language = "json" }: { code: string; language?: string }) => (
  <div className="relative">
    <Button
      variant="ghost"
      size="icon"
      className="absolute right-2 top-2 h-8 w-8"
      onClick={() => copyToClipboard(code)}
    >
      <Copy className="h-4 w-4" />
    </Button>
    <pre className="overflow-auto rounded-2xl bg-zinc-900/95 p-4 text-xs text-zinc-100 shadow-inner">
      <code data-language={language}>{code}</code>
    </pre>
  </div>
);

const glassCard = "border border-white/10 bg-white/5 backdrop-blur-xl";

type MenuItem = {
  id: string;
  label: string;
  icon: any;
};

export default function ApiDocs() {
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const endpointBase = `${baseUrl || ""}/api/trpc`;
  const [activeMenu, setActiveMenu] = useState("machine");

  const menuItems: MenuItem[] = [
    { id: "machine", label: "Machine APIs", icon: Activity },
    { id: "auth", label: "Authentication", icon: ShieldCheck },
    { id: "factory", label: "Factory & Assets", icon: Building2 },
    { id: "assignments", label: "User Assignments", icon: Users2 },
    { id: "inspection", label: "Inspection APIs", icon: ClipboardList },
    { id: "stats", label: "Statistics & OEE", icon: BarChart3 },
    { id: "import", label: "Import/Export", icon: PanelsTopLeft },
    { id: "mqtt", label: "MQTT", icon: RadioTower },
    { id: "alerts", label: "Alerts", icon: BellRing },
    { id: "reports", label: "Scheduled Reports", icon: CalendarClock },
    { id: "aoiPackage", label: "AOI Image Upload", icon: Camera },
    { id: "machineSync", label: "Machine Sync", icon: HardDrive },
    { id: "workshop", label: "Workshop/Line/Station", icon: Wrench },
    { id: "productModel", label: "Product Models", icon: Package },
    { id: "measurementPoint", label: "Measurement Points", icon: Crosshair },
    { id: "productionOrder", label: "Production Orders", icon: ListOrdered },
    { id: "dashboardAnalytics", label: "Dashboard Analytics", icon: LayoutDashboard },
    { id: "dashboardWidget", label: "Dashboard Widgets", icon: LayoutGrid },
    { id: "layout", label: "Layout Management", icon: MapPin },
    { id: "userManagement", label: "User Management", icon: UserCog },
    { id: "notification", label: "Notifications", icon: Bell },
    { id: "permissions", label: "Permissions & RBAC", icon: Shield },
    { id: "security", label: "Security (2FA)", icon: Lock },
    { id: "machineStatus", label: "Machine Status", icon: Cpu },
    { id: "workstation", label: "Workstation Analytics", icon: Monitor },
    { id: "processOee", label: "Process & OEE", icon: Gauge },
    { id: "templateBulk", label: "Templates & Bulk", icon: FileText },
    { id: "smtpEmail", label: "SMTP & Email", icon: Mail },
    { id: "systemConfig", label: "System & Config", icon: Server },
    { id: "mqttAdvanced", label: "MQTT Management", icon: Wifi },
    { id: "ngRateThreshold", label: "NG Rate Threshold", icon: Gauge },
    { id: "inspectionImages", label: "Inspection Images", icon: Eye },
    { id: "annotationAI", label: "Annotations & AI", icon: Pencil },
    { id: "spcHeatmap", label: "SPC & Heatmap", icon: TrendingUp },
    { id: "audit", label: "Audit Logs", icon: ScrollText },
  ];

  // ============================================================
  // AOI Image Package examples
  // ============================================================
  const aoiPresignExample = `POST ${endpointBase}/aoiPackage.presign
Headers: X-API-Key: machine-api-key

{
  "apiKey": "MCH-API-xxxx",
  "inspectionId": "INS-20260207-001",
  "sizeBytes": 15728640
}`;

  const aoiPresignResponse = `{
  "success": true,
  "alreadyCommitted": false,
  "packageId": "INS-20260207-001",
  "objectKey": "aoi/AOI-01/2026/02/07/INS-20260207-001.zip",
  "uploadUrl": "/api/aoi/upload/INS-20260207-001",
  "expiresAt": "2026-02-07T10:15:00.000Z"
}`;

  const aoiUploadExample = `PUT /api/aoi/upload/INS-20260207-001
Headers:
  Content-Type: application/octet-stream
  X-API-Key: MCH-API-xxxx
  X-Machine-Code: AOI-01

Body: <raw ZIP binary data>`;

  const aoiUploadResponse = `{
  "success": true,
  "packageId": "INS-20260207-001",
  "storageKey": "aoi/AOI-01/2026/02/07/INS-20260207-001.zip",
  "sizeBytes": 15728640
}`;

  const aoiCommitExample = `POST ${endpointBase}/aoiPackage.commit
Headers: X-API-Key: machine-api-key

{
  "apiKey": "MCH-API-xxxx",
  "packageId": "INS-20260207-001"
}`;

  const aoiCommitResponse = `{
  "success": true,
  "alreadyCommitted": false,
  "packageId": "INS-20260207-001",
  "inspectionId": 98214,
  "imageCount": 12,
  "totalPoints": 12
}`;

  const aoiMetaJsonExample = `// Cấu trúc ZIP Package:
// ├── meta.json
// └── images/
//     ├── P01.jpg
//     ├── P02.jpg
//     └── ...

// meta.json schema:
{
  "serialNumber": "SN-20260207-001",
  "productModel": "PCBA-REV3",
  "factory": "FAC001",
  "line": "LINE-A",
  "machine": "AOI-01",
  "startedAt": "2026-02-07T10:00:00Z",
  "finishedAt": "2026-02-07T10:00:15Z",
  "summary": {
    "totalPoints": 12,
    "ok": 11,
    "ng": 1
  },
  "points": [
    {
      "code": "P01",
      "name": "Connector A",
      "fileName": "P01.jpg",
      "result": "OK",
      "value": 0.25
    },
    {
      "code": "P02",
      "name": "IC U3",
      "fileName": "P02.jpg",
      "result": "NG",
      "value": 0.52
    }
  ]
}`;

  const aoiQueueMetricsExample = `POST ${endpointBase}/aoiPackage.reportQueueMetrics
Headers: X-API-Key: machine-api-key

{
  "apiKey": "MCH-API-xxxx",
  "queuedCount": 5,
  "uploadingCount": 1,
  "failedCount": 0,
  "completedCount": 120,
  "diskUsedBytes": 5368709120,
  "diskFreeBytes": 10737418240,
  "avgUploadLatencyMs": 1250,
  "lastErrorMessage": null
}`;

  const aoiAgentFlowExample = `// === Agent Upload Flow (TypeScript) ===
import fetch from "node-fetch";
import fs from "fs";

const BASE = "${typeof window !== "undefined" ? window.location.origin : ""}/api/trpc";
const API_KEY = process.env.MACHINE_API_KEY!;

async function uploadPackage(zipPath: string, inspectionId: string) {
  // Step 1: Presign
  const presignRes = await fetch(BASE + "/aoiPackage.presign", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
    body: JSON.stringify({
      apiKey: API_KEY,
      inspectionId,
      sizeBytes: fs.statSync(zipPath).size,
    }),
  });
  const { result: { data: presign } } = await presignRes.json();

  if (presign.alreadyCommitted) {
    console.log("Already committed, skipping.");
    return;
  }

  // Step 2: Upload ZIP binary
  const zipBuffer = fs.readFileSync(zipPath);
  const uploadRes = await fetch(
    "${typeof window !== "undefined" ? window.location.origin : ""}" + presign.uploadUrl,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-API-Key": API_KEY,
        "X-Machine-Code": "AOI-01",
      },
      body: zipBuffer,
    }
  );

  // Step 3: Commit
  const commitRes = await fetch(BASE + "/aoiPackage.commit", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
    body: JSON.stringify({
      apiKey: API_KEY,
      packageId: inspectionId,
    }),
  });
  const commit = await commitRes.json();
  console.log("Committed:", commit.result.data);
}`;

  const aoiPythonAgentExample = `import requests, os

BASE = "${typeof window !== "undefined" ? window.location.origin : ""}/api/trpc"
ORIGIN = "${typeof window !== "undefined" ? window.location.origin : ""}"
API_KEY = os.environ["MACHINE_API_KEY"]

def upload_package(zip_path: str, inspection_id: str):
    # Step 1: Presign
    presign = requests.post(
        f"{BASE}/aoiPackage.presign",
        json={"apiKey": API_KEY, "inspectionId": inspection_id,
              "sizeBytes": os.path.getsize(zip_path)},
        headers={"X-API-Key": API_KEY},
    ).json()["result"]["data"]

    if presign.get("alreadyCommitted"):
        print("Already committed"); return

    # Step 2: Upload
    with open(zip_path, "rb") as f:
        requests.put(
            f"{ORIGIN}{presign['uploadUrl']}",
            data=f.read(),
            headers={"Content-Type": "application/octet-stream",
                     "X-API-Key": API_KEY, "X-Machine-Code": "AOI-01"},
        )

    # Step 3: Commit
    commit = requests.post(
        f"{BASE}/aoiPackage.commit",
        json={"apiKey": API_KEY, "packageId": inspection_id},
        headers={"X-API-Key": API_KEY},
    ).json()
    print("Committed:", commit["result"]["data"])`;

  const aoiCSharpWpfExample = `// === C# WPF AOI Agent — Upload qua MinIO-compatible Server ===
// NuGet: System.IO.Compression, System.Net.Http.Json, Newtonsoft.Json

using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;

public class AoiUploadService
{
    private readonly HttpClient _http;
    private readonly string _baseUrl;   // "${typeof window !== "undefined" ? window.location.origin : ""}"
    private readonly string _trpcUrl;   // "${typeof window !== "undefined" ? window.location.origin : ""}/api/trpc"
    private readonly string _apiKey;    // Machine API Key
    private readonly string _machineCode;

    public AoiUploadService(string baseUrl, string apiKey, string machineCode)
    {
        _baseUrl = baseUrl.TrimEnd('/');
        _trpcUrl = $"{_baseUrl}/api/trpc";
        _apiKey = apiKey;
        _machineCode = machineCode;
        _http = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
        _http.DefaultRequestHeaders.Add("X-API-Key", _apiKey);
    }

    // ── Tạo ZIP Package từ thư mục ảnh AOI ──────────────────
    public string CreateZipPackage(
        string imageFolder,
        string serialNumber,
        string productModel,
        string factoryCode,
        List<PointResult> points)
    {
        var zipPath = Path.Combine(
            Path.GetTempPath(),
            $"AOI_{serialNumber}_{DateTime.Now:yyyyMMdd_HHmmss}.zip");

        using var zip = ZipFile.Open(zipPath, ZipArchiveMode.Create);

        // Thêm ảnh vào images/
        foreach (var pt in points)
        {
            var imgPath = Path.Combine(imageFolder, pt.FileName);
            if (File.Exists(imgPath))
                zip.CreateEntryFromFile(imgPath, $"images/{pt.FileName}",
                    CompressionLevel.NoCompression); // STORE mode
        }

        // Tạo meta.json
        var meta = new
        {
            serialNumber,
            productModel,
            factory = factoryCode,
            line = "",
            machine = _machineCode,
            startedAt = DateTime.UtcNow.ToString("o"),
            finishedAt = DateTime.UtcNow.ToString("o"),
            summary = new
            {
                totalPoints = points.Count,
                ok = points.Count(p => p.Result == "OK"),
                ng = points.Count(p => p.Result == "NG")
            },
            points = points.Select(p => new
            {
                code = p.Code,
                name = p.Name,
                fileName = p.FileName,
                result = p.Result,
                value = p.Value
            })
        };

        var metaEntry = zip.CreateEntry("meta.json",
            CompressionLevel.NoCompression);
        using var writer = new StreamWriter(metaEntry.Open());
        writer.Write(JsonSerializer.Serialize(meta,
            new JsonSerializerOptions { WriteIndented = true }));

        return zipPath;
    }

    // ── Upload Flow đầy đủ 3 bước ───────────────────────────
    public async Task<UploadResult> UploadPackageAsync(
        string zipPath, string inspectionId)
    {
        var fileSize = new FileInfo(zipPath).Length;

        // ▸ Step 1: Presign
        var presignPayload = JsonSerializer.Serialize(new
        {
            apiKey = _apiKey,
            inspectionId,
            sizeBytes = fileSize
        });
        var presignRes = await _http.PostAsync(
            $"{_trpcUrl}/aoiPackage.presign",
            new StringContent(presignPayload,
                System.Text.Encoding.UTF8, "application/json"));
        presignRes.EnsureSuccessStatusCode();

        var presignJson = JsonDocument.Parse(
            await presignRes.Content.ReadAsStringAsync());
        var data = presignJson.RootElement
            .GetProperty("result").GetProperty("data");

        if (data.GetProperty("alreadyCommitted").GetBoolean())
            return new UploadResult { AlreadyCommitted = true };

        var uploadUrl = data.GetProperty("uploadUrl").GetString()!;

        // ▸ Step 2: Upload ZIP binary
        using var zipStream = File.OpenRead(zipPath);
        var uploadContent = new StreamContent(zipStream);
        uploadContent.Headers.ContentType =
            new MediaTypeHeaderValue("application/octet-stream");

        var uploadReq = new HttpRequestMessage(
            HttpMethod.Put, $"{_baseUrl}{uploadUrl}");
        uploadReq.Content = uploadContent;
        uploadReq.Headers.Add("X-Machine-Code", _machineCode);

        var uploadRes = await _http.SendAsync(uploadReq);
        uploadRes.EnsureSuccessStatusCode();

        // ▸ Step 3: Commit
        var commitPayload = JsonSerializer.Serialize(new
        {
            apiKey = _apiKey,
            packageId = inspectionId
        });
        var commitRes = await _http.PostAsync(
            $"{_trpcUrl}/aoiPackage.commit",
            new StringContent(commitPayload,
                System.Text.Encoding.UTF8, "application/json"));
        commitRes.EnsureSuccessStatusCode();

        var commitJson = JsonDocument.Parse(
            await commitRes.Content.ReadAsStringAsync());
        var commitData = commitJson.RootElement
            .GetProperty("result").GetProperty("data");

        return new UploadResult
        {
            Success = true,
            PackageId = inspectionId,
            ImageCount = commitData.TryGetProperty(
                "imageCount", out var ic) ? ic.GetInt32() : 0
        };
    }

    // ── Report Queue Metrics (gọi mỗi 30s) ─────────────────
    public async Task ReportQueueMetricsAsync(
        int queued, int uploading, int failed, int completed,
        long diskUsed, long diskFree, int avgLatencyMs)
    {
        var payload = JsonSerializer.Serialize(new
        {
            apiKey = _apiKey,
            queuedCount = queued,
            uploadingCount = uploading,
            failedCount = failed,
            completedCount = completed,
            diskUsedBytes = diskUsed,
            diskFreeBytes = diskFree,
            avgUploadLatencyMs = avgLatencyMs
        });
        await _http.PostAsync(
            $"{_trpcUrl}/aoiPackage.reportQueueMetrics",
            new StringContent(payload,
                System.Text.Encoding.UTF8, "application/json"));
    }
}

public record PointResult(
    string Code, string Name, string FileName,
    string Result, double? Value);

public class UploadResult
{
    public bool Success { get; set; }
    public bool AlreadyCommitted { get; set; }
    public string? PackageId { get; set; }
    public int ImageCount { get; set; }
}`;

  const aoiCSharpWpfUsageExample = `// === Sử dụng trong WPF ViewModel ===========================
// Thêm vào ViewModel của màn hình AOI/AVI inspection

public class InspectionViewModel : INotifyPropertyChanged
{
    private readonly AoiUploadService _uploader;
    private readonly Queue<PendingUpload> _uploadQueue = new();
    private readonly DispatcherTimer _metricsTimer;
    private int _completedCount, _failedCount;

    public InspectionViewModel()
    {
        // Khởi tạo với server URL và API Key từ config
        _uploader = new AoiUploadService(
            baseUrl: ConfigurationManager.AppSettings["ServerUrl"]!,
            apiKey:  ConfigurationManager.AppSettings["MachineApiKey"]!,
            machineCode: ConfigurationManager.AppSettings["MachineCode"]!
        );

        // Timer gửi metrics mỗi 30 giây
        _metricsTimer = new DispatcherTimer
        { Interval = TimeSpan.FromSeconds(30) };
        _metricsTimer.Tick += async (s, e) =>
            await ReportMetricsAsync();
        _metricsTimer.Start();
    }

    // ── Gọi sau khi AOI kiểm tra xong 1 board ──────────────
    public async Task OnInspectionCompleted(
        string serialNumber, string productModel,
        string imageFolder, List<PointResult> points)
    {
        var inspectionId =
            $"INS-{DateTime.Now:yyyyMMdd-HHmmss}-{serialNumber}";

        // Tạo ZIP package
        var zipPath = _uploader.CreateZipPackage(
            imageFolder, serialNumber, productModel,
            "FAC001", points);

        // Thêm vào queue
        _uploadQueue.Enqueue(new PendingUpload
        {
            ZipPath = zipPath,
            InspectionId = inspectionId
        });

        // Upload async (không block UI)
        _ = Task.Run(() => ProcessQueueAsync());
    }

    private async Task ProcessQueueAsync()
    {
        while (_uploadQueue.TryDequeue(out var item))
        {
            try
            {
                var result = await _uploader
                    .UploadPackageAsync(
                        item.ZipPath, item.InspectionId);

                if (result.Success || result.AlreadyCommitted)
                    _completedCount++;

                // Xóa ZIP tạm sau khi upload thành công
                File.Delete(item.ZipPath);
            }
            catch (Exception ex)
            {
                _failedCount++;
                // Retry: thêm lại vào cuối queue
                _uploadQueue.Enqueue(item);
                await Task.Delay(5000); // backoff
                Debug.WriteLine($"Upload failed: {ex.Message}");
            }
        }
    }

    private async Task ReportMetricsAsync()
    {
        var drive = new DriveInfo("C");
        await _uploader.ReportQueueMetricsAsync(
            queued: _uploadQueue.Count,
            uploading: 1,
            failed: _failedCount,
            completed: _completedCount,
            diskUsed: drive.TotalSize - drive.AvailableFreeSpace,
            diskFree: drive.AvailableFreeSpace,
            avgLatencyMs: 1500);
    }
}

record PendingUpload
{
    public string ZipPath { get; init; } = "";
    public string InspectionId { get; init; } = "";
}

// ── App.config ──────────────────────────────────────────────
// <appSettings>
//   <add key="ServerUrl" value="${typeof window !== "undefined" ? window.location.origin : ""}" />
//   <add key="MachineApiKey" value="MCH-API-xxxx" />
//   <add key="MachineCode" value="AOI-01" />
// </appSettings>`;

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
}

initMachine("AOI-SN-2025-0042");`;

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
    <DashboardLayout title="AVI/AOI Management" navItems={navItems} currentPath="/api-docs">
      <div className="flex gap-6">
        {/* Left Sidebar */}
        <aside className="hidden lg:block w-64">
          <div className="sticky top-24 space-y-2">
            <p className="mb-3 px-3 text-xs font-semibold uppercase text-muted-foreground">
              API Categories
            </p>
            {menuItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveMenu(item.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left text-sm transition",
                    activeMenu === item.id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="font-medium">{item.label}</span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Main Content */}
        <div className="flex-1 space-y-6">
          {/* Header */}
          <section className="overflow-hidden rounded-3xl border bg-gradient-to-r from-slate-900 via-indigo-900 to-slate-900 p-8 text-white shadow-2xl">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1 text-sm font-medium">
                <Languages className="h-4 w-4" />
                API Documentation
              </div>
              <h1 className="text-3xl font-semibold leading-tight">
                API Reference cho Hệ thống MES
              </h1>
              <p className="max-w-3xl text-base text-white/80">
                Tài liệu đầy đủ các API endpoint cho tích hợp hệ thống AVI/AOI. Sử dụng endpoint tRPC với xác thực API Key hoặc JWT.
              </p>
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <Card className="border-white/20 bg-white/5 text-white">
                <CardHeader>
                  <CardTitle className="text-sm uppercase tracking-wide text-white/70">Base URL</CardTitle>
                  <CardDescription className="text-white text-base">
                    {endpointBase}
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-white/20 bg-white/5 text-white">
                <CardHeader>
                  <CardTitle className="text-sm uppercase tracking-wide text-white/70">Authentication</CardTitle>
                  <CardDescription className="text-white text-base">
                    Header X-API-Key hoặc JWT Cookie
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-white/20 bg-white/5 text-white">
                <CardHeader>
                  <CardTitle className="text-sm uppercase tracking-wide text-white/70">Content-Type</CardTitle>
                  <CardDescription className="text-white text-base">application/json</CardDescription>
                </CardHeader>
              </Card>
            </div>
          </section>

          {/* Machine APIs */}
          {activeMenu === "machine" && (
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
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="submit" className="gap-2">
                    <Send className="h-4 w-4" />
                    Submit Inspection
                  </TabsTrigger>
                  <TabsTrigger value="upload" className="gap-2">
                    <UploadCloud className="h-4 w-4" />
                    Upload Image
                  </TabsTrigger>
                  <TabsTrigger value="sync" className="gap-2">
                    <RefreshCcw className="h-4 w-4" />
                    Sync Points (2-way)
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
                        <li>Kết hợp cả hai chiều giúp đảm bảo dữ liệu nhất quán giữa máy và hệ thống quản lý.</li>
                      </ul>
                    </div>
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
          )}

          {/* Auth */}
          {activeMenu === "auth" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5" />
                    Authentication & Authorization
                  </CardTitle>
                  <CardDescription>
                    Hệ thống sử dụng Manus OAuth cho authentication và RBAC cho authorization.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">Roles</h4>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                      <li><strong>admin:</strong> Full access to all resources</li>
                      <li><strong>user:</strong> Limited access based on corporate/factory assignments</li>
                    </ul>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <h4 className="mb-2 font-semibold">auth.me - Get Current User</h4>
                      <CodeBlock code={`const { data: user } = trpc.auth.me.useQuery();
// Returns: { id, openId, email, name, role, createdAt }`} />
                    </div>

                    <div>
                      <h4 className="mb-2 font-semibold">auth.localLogin - Login với Username/Password</h4>
                      <CodeBlock code={`const loginMutation = trpc.auth.localLogin.useMutation();
await loginMutation.mutateAsync({
  username: "admin",
  password: "password",
  totpCode: "123456" // Optional 2FA
});`} />
                    </div>

                    <div>
                      <h4 className="mb-2 font-semibold">auth.logout - Đăng xuất</h4>
                      <CodeBlock code={`const logoutMutation = trpc.auth.logout.useMutation();
await logoutMutation.mutateAsync();`} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Factory Management */}
          {activeMenu === "factory" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="h-5 w-5" />
                    Factory & Asset Management
                  </CardTitle>
                  <CardDescription>
                    Quản lý factory/workshop/line/station/machine kèm API Key.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">factory.list - Danh sách nhà máy</h4>
                    <CodeBlock code={`const { data: factories } = trpc.factory.list.useQuery();`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">factory.create - Tạo nhà máy mới (Admin)</h4>
                    <CodeBlock code={`const createMutation = trpc.factory.create.useMutation();
await createMutation.mutateAsync({
  code: "FAC001",
  name: "Factory Bắc Ninh",
  address: "VSIP"
});`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">machine.regenerateApiKey - Tạo lại API Key (Admin)</h4>
                    <CodeBlock code={`const regenerateMutation = trpc.machine.regenerateApiKey.useMutation();
const { apiKey } = await regenerateMutation.mutateAsync({ id: 5 });
// Response: { apiKey: "MCH-API-..." }`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* User Assignments */}
          {activeMenu === "assignments" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users2 className="h-5 w-5" />
                    User Assignments & Access Control
                  </CardTitle>
                  <CardDescription>
                    Giới hạn phạm vi nhìn thấy dữ liệu theo corporate/factory assignment.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">userAssignment.getMyAssignments</h4>
                    <CodeBlock code={`const { data } = trpc.userAssignment.getMyAssignments.useQuery();
// Returns: { corporateAssignments: [...], factoryAssignments: [...] }`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">userAssignment.assignCorporate (Admin)</h4>
                    <CodeBlock code={`const assignMutation = trpc.userAssignment.assignCorporate.useMutation();
await assignMutation.mutateAsync({
  userId: 42,
  corporateCode: "CORP001"
});`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">userAssignment.assignFactory (Admin)</h4>
                    <CodeBlock code={`const assignMutation = trpc.userAssignment.assignFactory.useMutation();
await assignMutation.mutateAsync({
  userId: 42,
  factoryCode: "FAC001"
});`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Inspection APIs */}
          {activeMenu === "inspection" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ClipboardList className="h-5 w-5" />
                    Inspection APIs
                  </CardTitle>
                  <CardDescription>
                    Tra cứu và thao tác inspection record, hỗ trợ filter đa chiều.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">inspection.list - Danh sách inspection</h4>
                    <CodeBlock code={`const { data } = trpc.inspection.list.useQuery({
  machineId: 5,
  result: "NG",
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-01-31'),
  limit: 50,
  offset: 0
});`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">inspection.getById - Chi tiết inspection</h4>
                    <CodeBlock code={`const { data } = trpc.inspection.getById.useQuery({ id: 123 });`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">inspection.search - Search nâng cao</h4>
                    <CodeBlock code={`const { data } = trpc.inspection.search.useQuery({
  factoryCode: "FAC001",
  serialNumber: "SN",
  productModel: "MODEL-A",
  result: "NG"
});`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">inspection.updateNTF - Đánh dấu NTF (false positive)</h4>
                    <CodeBlock code={`const updateMutation = trpc.inspection.updateNTF.useMutation();
await updateMutation.mutateAsync({
  id: 123,
  isNTF: true,
  ntfReason: "Defect không ảnh hưởng chức năng"
});`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Statistics */}
          {activeMenu === "stats" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" />
                    Statistics & OEE
                  </CardTitle>
                  <CardDescription>
                    Dashboard tổng quan, yield trend, throughput đa tầng.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">corporateFactoryStats.yieldRateByCorporate</h4>
                    <CodeBlock code={`const { data } = trpc.corporateFactoryStats.yieldRateByCorporate.useQuery({
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-01-31')
});
// Returns: Array<{ corporateCode, totalInspections, okCount, ngCount, yieldRate }>`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">corporateFactoryStats.yieldRateByFactory</h4>
                    <CodeBlock code={`const { data } = trpc.corporateFactoryStats.yieldRateByFactory.useQuery({
  corporateCode: "CORP001",
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-01-31')
});`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">dashboard.stats - Thống kê tổng quan</h4>
                    <CodeBlock code={`const { data } = trpc.dashboard.stats.useQuery({
  factoryId: 1,
  startDate: new Date('2026-02-01'),
  endDate: new Date('2026-02-05')
});
// Returns: { totalOutput, okCount, ngCount, fpy, yieldRate }`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Import/Export */}
          {activeMenu === "import" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <PanelsTopLeft className="h-5 w-5" />
                    Import / Export Pipelines
                  </CardTitle>
                  <CardDescription>
                    Bulk onboarding dữ liệu nền tảng bằng Excel/CSV.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">import.importFactories (Admin)</h4>
                    <CodeBlock code={`const importMutation = trpc.import.importFactories.useMutation();
const result = await importMutation.mutateAsync({ data: excelData });
// Response: { success: number, failed: number, errors: string[] }`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">export.exportInspections (Admin)</h4>
                    <CodeBlock code={`const exportMutation = trpc.export.exportInspections.useMutation();
const result = await exportMutation.mutateAsync({
  corporateCode: "CORP001",
  factoryCode: "FAC001",
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-01-31')
});
// Returns: { fileUrl: "https://s3.../inspections.xlsx", recordCount: 1240 }`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* MQTT */}
          {activeMenu === "mqtt" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <RadioTower className="h-5 w-5" />
                    MQTT Connectivity
                  </CardTitle>
                  <CardDescription>
                    Giám sát broker, approve client, realtime throughput.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">mqttClient.status - Trạng thái broker</h4>
                    <CodeBlock code={`const { data } = trpc.mqttClient.status.useQuery();
// Returns: { connected, brokerUrl, clientsOnline, messagesPerMinute }`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">mqttClient.dashboardStats</h4>
                    <CodeBlock code={`const { data } = trpc.mqttClient.dashboardStats.useQuery();
// Returns: { totalMessages, messagesSent, messagesFailed, ngAlerts }`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">mqttClient.approve (Admin)</h4>
                    <CodeBlock code={`const approveMutation = trpc.mqttClient.approve.useMutation();
await approveMutation.mutateAsync({ id: 5 });`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Alerts */}
          {activeMenu === "alerts" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BellRing className="h-5 w-5" />
                    Alerts & Notifications
                  </CardTitle>
                  <CardDescription>
                    Pipeline cảnh báo yield/máy offline với acknowledge flow.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">alert.list - Danh sách alerts</h4>
                    <CodeBlock code={`const { data } = trpc.alert.list.useQuery({
  severity: "HIGH",
  acknowledged: false
});`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">alert.acknowledge - Đánh dấu đã đọc</h4>
                    <CodeBlock code={`const acknowledgeMutation = trpc.alert.acknowledge.useMutation();
await acknowledgeMutation.mutateAsync({ id: 123 });`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">alert.create (Admin)</h4>
                    <CodeBlock code={`const createMutation = trpc.alert.create.useMutation();
await createMutation.mutateAsync({
  name: "High NG Rate Alert",
  alertType: "ng_count",
  threshold: "10",
  comparisonOperator: "gt",
  machineId: 5,
  notifyEmail: true,
  cooldownMinutes: 60
});`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* AOI Image Upload */}
          {activeMenu === "aoiPackage" && (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Camera className="h-5 w-5" />
                    AOI Image Package Upload APIs
                  </CardTitle>
                  <CardDescription>
                    Upload ảnh kiểm tra AOI/AVI theo phương thức ZIP Package + Async Upload.
                    Hỗ trợ Presign → Upload → Commit flow với idempotency.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded-2xl border border-dashed border-amber-500/40 bg-amber-500/5 p-4 text-sm space-y-2">
                    <h4 className="font-semibold text-amber-400 flex items-center gap-2">
                      <FileArchive className="h-4 w-4" />
                      Upload Flow (3 bước)
                    </h4>
                    <ol className="list-decimal pl-5 space-y-1 text-muted-foreground">
                      <li><strong>Presign</strong> — Agent gọi <code>aoiPackage.presign</code> để tạo bản ghi và lấy upload URL</li>
                      <li><strong>Upload</strong> — Agent PUT binary ZIP lên <code>/api/aoi/upload/:packageId</code> (max 200MB)</li>
                      <li><strong>Commit</strong> — Agent gọi <code>aoiPackage.commit</code> để parse meta.json, liên kết inspection, cập nhật trạng thái</li>
                    </ol>
                    <p className="text-xs text-muted-foreground mt-2">
                      Tất cả endpoint đều idempotent — retry an toàn khi gặp lỗi mạng.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Tabs defaultValue="presign" className="space-y-6">
                <TabsList className="grid w-full grid-cols-5">
                  <TabsTrigger value="presign" className="gap-1 text-xs">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    1. Presign
                  </TabsTrigger>
                  <TabsTrigger value="upload" className="gap-1 text-xs">
                    <UploadCloud className="h-3.5 w-3.5" />
                    2. Upload ZIP
                  </TabsTrigger>
                  <TabsTrigger value="commit" className="gap-1 text-xs">
                    <Send className="h-3.5 w-3.5" />
                    3. Commit
                  </TabsTrigger>
                  <TabsTrigger value="meta" className="gap-1 text-xs">
                    <FileArchive className="h-3.5 w-3.5" />
                    ZIP Format
                  </TabsTrigger>
                  <TabsTrigger value="queue" className="gap-1 text-xs">
                    <HardDrive className="h-3.5 w-3.5" />
                    Queue Metrics
                  </TabsTrigger>
                </TabsList>

                {/* Presign */}
                <TabsContent value="presign">
                  <Card className={glassCard}>
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <Badge className="bg-success text-success-foreground">POST</Badge>
                        <code className="text-sm text-white">aoiPackage.presign</code>
                      </div>
                      <CardDescription>
                        Tạo bản ghi package và lấy upload URL. Agent gọi trước khi upload.
                        Nếu package đã commit, trả về <code>alreadyCommitted: true</code> (idempotent).
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div>
                        <h4 className="mb-3 font-semibold text-white">Request</h4>
                        <CodeBlock code={aoiPresignExample} language="typescript" />
                      </div>
                      <div>
                        <h4 className="mb-3 font-semibold text-white">Response</h4>
                        <CodeBlock code={aoiPresignResponse} />
                      </div>
                      <div className="rounded-2xl border border-dashed border-white/20 bg-white/5 p-4 text-sm text-white/80">
                        <h4 className="font-semibold mb-2">Parameters</h4>
                        <ul className="list-disc space-y-1 pl-5">
                          <li><code>apiKey</code> hoặc <code>machineCode</code> — xác thực máy (ít nhất 1 trong 2)</li>
                          <li><code>inspectionId</code> — ID duy nhất cho package (từ Agent)</li>
                          <li><code>sizeBytes</code> — kích thước ZIP dự kiến (bytes)</li>
                          <li><code>sha256</code> — (optional) hash SHA-256 cho integrity check</li>
                        </ul>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Upload ZIP */}
                <TabsContent value="upload">
                  <Card className={glassCard}>
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <Badge className="bg-blue-600 text-white">PUT</Badge>
                        <code className="text-sm text-white">/api/aoi/upload/:packageId</code>
                      </div>
                      <CardDescription>
                        Upload binary ZIP trực tiếp. Đây là REST endpoint (không phải tRPC).
                        Kích thước tối đa 200MB.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div>
                        <h4 className="mb-3 font-semibold text-white">Request</h4>
                        <CodeBlock code={aoiUploadExample} language="typescript" />
                      </div>
                      <div>
                        <h4 className="mb-3 font-semibold text-white">Response</h4>
                        <CodeBlock code={aoiUploadResponse} />
                      </div>
                      <div className="rounded-2xl border border-dashed border-white/20 bg-white/5 p-4 text-sm text-white/80">
                        <h4 className="font-semibold mb-2">Lưu ý quan trọng</h4>
                        <ul className="list-disc space-y-1 pl-5">
                          <li>Content-Type phải là <code>application/octet-stream</code></li>
                          <li>Headers bắt buộc: <code>X-API-Key</code> + <code>X-Machine-Code</code></li>
                          <li>Package phải được presign trước (status: pending)</li>
                          <li>ZIP sử dụng STORE mode (không nén) để tối ưu tốc độ</li>
                          <li>Retry an toàn — file sẽ bị ghi đè nếu upload lại</li>
                        </ul>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Commit */}
                <TabsContent value="commit">
                  <Card className={glassCard}>
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <Badge className="bg-success text-success-foreground">POST</Badge>
                        <code className="text-sm text-white">aoiPackage.commit</code>
                      </div>
                      <CardDescription>
                        Xác nhận upload xong. Server parse meta.json, extract danh sách ảnh,
                        liên kết inspection record, cập nhật trạng thái thành "committed".
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div>
                        <h4 className="mb-3 font-semibold text-white">Request</h4>
                        <CodeBlock code={aoiCommitExample} language="typescript" />
                      </div>
                      <div>
                        <h4 className="mb-3 font-semibold text-white">Response</h4>
                        <CodeBlock code={aoiCommitResponse} />
                      </div>
                      <div className="rounded-2xl border border-dashed border-white/20 bg-white/5 p-4 text-sm text-white/80">
                        <h4 className="font-semibold mb-2">Xử lý khi commit</h4>
                        <ul className="list-disc space-y-1 pl-5">
                          <li>Parse <code>meta.json</code> từ ZIP để lấy serialNumber, productModel, points</li>
                          <li>Tự động tạo <code>package_images</code> records cho từng điểm đo</li>
                          <li>Link tới <code>product_inspections</code> nếu trùng serialNumber + machineId</li>
                          <li>Đếm OK/NG từ summary hoặc danh sách points</li>
                          <li>Nếu lỗi parse → status = "failed" với errorMessage</li>
                        </ul>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* ZIP Format */}
                <TabsContent value="meta">
                  <Card className={glassCard}>
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className="text-white border-white/40">FORMAT</Badge>
                        <code className="text-sm text-white">ZIP Package Structure & meta.json</code>
                      </div>
                      <CardDescription>
                        Cấu trúc file ZIP mà Agent cần tạo trước khi upload.
                        Sử dụng STORE mode (không nén) để tối ưu I/O.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div>
                        <h4 className="mb-3 font-semibold text-white">Cấu trúc ZIP & meta.json Schema</h4>
                        <CodeBlock code={aoiMetaJsonExample} language="json" />
                      </div>
                      <div className="rounded-2xl border border-dashed border-white/20 bg-white/5 p-4 text-sm text-white/80">
                        <h4 className="font-semibold mb-2">Quy tắc đặt tên file ảnh</h4>
                        <ul className="list-disc space-y-1 pl-5">
                          <li>Tất cả ảnh nằm trong thư mục <code>images/</code></li>
                          <li><code>fileName</code> trong points phải khớp với tên file thực tế trong ZIP</li>
                          <li>Hỗ trợ định dạng: JPG, JPEG, PNG, BMP, TIFF</li>
                          <li>Nên dùng tên <code>pointCode</code> làm tên file (vd: P01.jpg)</li>
                          <li><code>result</code>: "OK" | "NG" | "NTF" (Not True Failure)</li>
                        </ul>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Queue Metrics */}
                <TabsContent value="queue">
                  <Card className={glassCard}>
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <Badge className="bg-success text-success-foreground">POST</Badge>
                        <code className="text-sm text-white">aoiPackage.reportQueueMetrics</code>
                      </div>
                      <CardDescription>
                        Agent gửi metrics hàng đợi upload định kỳ (mỗi 30s-60s) để giám sát.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div>
                        <h4 className="mb-3 font-semibold text-white">Request</h4>
                        <CodeBlock code={aoiQueueMetricsExample} language="typescript" />
                      </div>
                      <div className="rounded-2xl border border-dashed border-white/20 bg-white/5 p-4 text-sm text-white/80">
                        <h4 className="font-semibold mb-2">Các trường metrics</h4>
                        <ul className="list-disc space-y-1 pl-5">
                          <li><code>queuedCount</code> — số package đang đợi trong hàng đợi</li>
                          <li><code>uploadingCount</code> — số package đang upload</li>
                          <li><code>completedCount</code> — tổng số đã upload thành công</li>
                          <li><code>failedCount</code> — tổng số lỗi</li>
                          <li><code>diskUsedBytes</code> / <code>diskFreeBytes</code> — dung lượng ổ đĩa SSD cache</li>
                          <li><code>avgUploadLatencyMs</code> — latency trung bình (ms)</li>
                          <li><code>lastErrorMessage</code> — thông báo lỗi gần nhất</li>
                        </ul>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>

              {/* REST Endpoints */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Activity className="h-5 w-5" />
                    REST Endpoints (Image Serving)
                  </CardTitle>
                  <CardDescription>
                    Các endpoint REST phục vụ ảnh trực tiếp cho thẻ &lt;img&gt; và download ZIP audit.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-center gap-3 mb-2">
                        <Badge className="bg-emerald-600 text-white">GET</Badge>
                        <code className="text-sm">/api/aoi/image/:packageId/:fileName</code>
                      </div>
                      <p className="text-sm text-muted-foreground mb-2">
                        Lấy ảnh điểm đo — tự động extract từ ZIP, cache trên SSD (7 ngày), thêm watermark.
                      </p>
                      <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-1">
                        <li>Trả về <code>image/jpeg</code> trực tiếp (dùng được trong <code>&lt;img src=&quot;...&quot;&gt;</code>)</li>
                        <li>Header <code>X-Cache: HIT|MISS</code> cho biết từ cache hay extract mới</li>
                        <li>Cache TTL: 7 ngày (configurable qua <code>AOI_CACHE_TTL_DAYS</code>)</li>
                      </ul>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-center gap-3 mb-2">
                        <Badge className="bg-emerald-600 text-white">GET</Badge>
                        <code className="text-sm">/api/aoi/download/:packageId</code>
                      </div>
                      <p className="text-sm text-muted-foreground mb-2">
                        Download ZIP gốc cho purposes audit/traceability. Không qua cache/watermark.
                      </p>
                      <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-1">
                        <li>Local storage: trả file trực tiếp qua <code>sendFile</code></li>
                        <li>Forge storage: redirect tới URL từ S3-compatible storage</li>
                        <li>Filename: <code>{`{packageId}.zip`}</code></li>
                      </ul>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Query APIs */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <ClipboardList className="h-5 w-5" />
                    tRPC Query Endpoints (Web UI)
                  </CardTitle>
                  <CardDescription>
                    Các endpoint tra cứu package, ảnh, thống kê — yêu cầu đăng nhập (protectedProcedure).
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">aoiPackage.listPackages — Danh sách packages</h4>
                    <CodeBlock code={`const { data } = trpc.aoiPackage.listPackages.useQuery({
  page: 1,
  pageSize: 20,
  serialNumber: "SN-2026",     // optional filter
  machineCode: "AOI-01",       // optional filter
  status: "committed",          // "pending" | "uploading" | "uploaded" | "committed" | "failed"
  overallResult: "NG",         // "OK" | "NG" | "NTF"
  dateFrom: "2026-02-01",
  dateTo: "2026-02-07",
});
// Returns: { data: Package[], total, totalPages, page, pageSize }`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">aoiPackage.getPackage — Chi tiết package</h4>
                    <CodeBlock code={`const { data } = trpc.aoiPackage.getPackage.useQuery({
  packageId: "INS-20260207-001",
});
// Returns: Package với images[], machine info`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">aoiPackage.getImage — Lấy ảnh (base64 qua tRPC)</h4>
                    <CodeBlock code={`const { data } = trpc.aoiPackage.getImage.useQuery({
  packageId: "INS-20260207-001",
  pointCode: "P01",      // hoặc fileName
  fileName: "P01.jpg",   // hoặc pointCode
});
// Returns: { imageBase64, mimeType, fileName, fromCache }
// Ảnh có watermark: SN, Machine, Time, User`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">aoiPackage.getUploadStats — Thống kê upload</h4>
                    <CodeBlock code={`const { data } = trpc.aoiPackage.getUploadStats.useQuery({});
// Returns: {
//   summary: { total, committed, failed, pending, totalImages, totalSize, ngPackages },
//   perMachine: [{ machineCode, machineId, total, committed, failed }]
// }`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">aoiPackage.getQueueStatus — Trạng thái queue</h4>
                    <CodeBlock code={`const { data } = trpc.aoiPackage.getQueueStatus.useQuery({});
// Returns: Array metrics mới nhất theo máy`} />
                  </div>
                </CardContent>
              </Card>

              {/* Agent Code Samples */}
              <section className="space-y-4">
                <div>
                  <h2 className="text-xl font-semibold text-foreground">Agent Integration Code</h2>
                  <p className="text-sm text-muted-foreground">
                    Mã nguồn mẫu cho AOI Agent — upload flow đầy đủ 3 bước.
                  </p>
                </div>
                <div className="grid gap-4 lg:grid-cols-1">
                  {/* C# WPF — full width vì code dài */}
                  <Card className="border border-white/10 bg-slate-900 text-white">
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <div className="inline-flex items-center gap-2 rounded-full bg-blue-500/20 px-3 py-1 text-xs uppercase tracking-wide text-blue-300">
                          <Languages className="h-3 w-3" />
                          C# WPF — AOI/AVI Agent (MinIO-compatible)
                        </div>
                        <Badge variant="outline" className="text-xs border-amber-400/50 text-amber-300">Recommended</Badge>
                      </div>
                      <p className="text-xs text-white/60 mt-2">
                        Dành cho máy AOI/AVI chạy Windows + WPF. Hỗ trợ tạo ZIP, upload 3 bước, queue nội bộ, retry tự động, report metrics.
                        Tương thích MinIO (S3-compatible) qua REST endpoint.
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div>
                        <h4 className="mb-3 font-semibold text-white text-sm">AoiUploadService — Service class đầy đủ</h4>
                        <CodeBlock code={aoiCSharpWpfExample} language="csharp" />
                      </div>
                      <div>
                        <h4 className="mb-3 font-semibold text-white text-sm">WPF ViewModel — Tích hợp vào màn hình kiểm tra</h4>
                        <CodeBlock code={aoiCSharpWpfUsageExample} language="csharp" />
                      </div>
                      <div className="rounded-2xl border border-dashed border-blue-400/30 bg-blue-500/5 p-4 text-sm text-white/80">
                        <h4 className="font-semibold text-blue-300 mb-2">Hướng dẫn tích hợp cho máy AOI/AVI hiện tại</h4>
                        <ol className="list-decimal pl-5 space-y-1">
                          <li>Thêm NuGet package: <code>System.IO.Compression</code> (có sẵn trong .NET Framework 4.6.2+)</li>
                          <li>Copy class <code>AoiUploadService</code> vào project WPF</li>
                          <li>Cấu hình <code>App.config</code> với ServerUrl, MachineApiKey, MachineCode</li>
                          <li>Gọi <code>OnInspectionCompleted()</code> sau khi AOI kiểm tra xong mỗi board</li>
                          <li>Upload chạy async — không block giao diện kiểm tra</li>
                          <li>Retry tự động khi mất mạng (backoff 5s)</li>
                          <li>Queue metrics được gửi mỗi 30s để giám sát trên Web UI</li>
                        </ol>
                      </div>
                      <div className="rounded-2xl border border-dashed border-amber-400/30 bg-amber-500/5 p-4 text-sm text-white/80">
                        <h4 className="font-semibold text-amber-300 mb-2">Lưu ý khi migrate từ MinIO trực tiếp</h4>
                        <ul className="list-disc pl-5 space-y-1">
                          <li>Thay thế <code>MinioClient.PutObjectAsync()</code> bằng <code>AoiUploadService.UploadPackageAsync()</code></li>
                          <li>Không cần cài MinIO SDK — upload qua HTTP REST thuần</li>
                          <li>ZIP STORE mode (NoCompression) giống MinIO — tốc độ tương đương</li>
                          <li>Server tự lưu vào storage backend (local hoặc S3-compatible)</li>
                          <li>Ảnh tự được watermark + cache khi user xem trên Web UI</li>
                          <li>Presign URL hết hạn sau 15 phút — Agent cần gọi lại nếu timeout</li>
                        </ul>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* TypeScript & Python — 2 cột */}
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card className="border border-white/10 bg-slate-900 text-white">
                    <CardHeader>
                      <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs uppercase tracking-wide">
                        <Languages className="h-3 w-3" />
                        TypeScript / Node.js Agent
                      </div>
                    </CardHeader>
                    <CardContent>
                      <CodeBlock code={aoiAgentFlowExample} language="typescript" />
                    </CardContent>
                  </Card>
                  <Card className="border border-white/10 bg-slate-900 text-white">
                    <CardHeader>
                      <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs uppercase tracking-wide">
                        <Languages className="h-3 w-3" />
                        Python Agent
                      </div>
                    </CardHeader>
                    <CardContent>
                      <CodeBlock code={aoiPythonAgentExample} language="python" />
                    </CardContent>
                  </Card>
                </div>
              </section>

              {/* Environment Variables */}
              <Card className={glassCard}>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="text-white border-white/40">CONFIG</Badge>
                    <CardTitle>Environment Variables</CardTitle>
                  </div>
                  <CardDescription>Các biến environment liên quan đến AOI Image Upload</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border border-white/20 p-4">
                      <h4 className="font-semibold text-white">AOI_CACHE_DIR</h4>
                      <p className="text-sm text-white/80">Thư mục cache ảnh SSD. Default: <code>uploads/aoi-cache</code></p>
                    </div>
                    <div className="rounded-2xl border border-white/20 p-4">
                      <h4 className="font-semibold text-white">AOI_CACHE_TTL_DAYS</h4>
                      <p className="text-sm text-white/80">Thời gian cache ảnh (ngày). Default: <code>7</code></p>
                    </div>
                    <div className="rounded-2xl border border-white/20 p-4">
                      <h4 className="font-semibold text-white">AOI_PRESIGN_TTL_MINUTES</h4>
                      <p className="text-sm text-white/80">Thời gian hiệu lực presign URL. Default: <code>15</code></p>
                    </div>
                    <div className="rounded-2xl border border-white/20 p-4">
                      <h4 className="font-semibold text-white">STORAGE_MODE</h4>
                      <p className="text-sm text-white/80">"local" hoặc "forge" (S3-compatible). Default: <code>forge</code></p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Machine Sync / Registration */}
          {activeMenu === "machineSync" && (
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
          )}

          {/* Scheduled Reports */}
          {activeMenu === "reports" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CalendarClock className="h-5 w-5" />
                    Scheduled Reports
                  </CardTitle>
                  <CardDescription>
                    Lập lịch gửi báo cáo PDF/Excel qua email tự động.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">scheduledReport.list</h4>
                    <CodeBlock code={`const { data } = trpc.scheduledReport.list.useQuery();`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">scheduledReport.create (Admin)</h4>
                    <CodeBlock code={`const createMutation = trpc.scheduledReport.create.useMutation();
await createMutation.mutateAsync({
  name: "Daily Yield Report",
  reportType: "yield",
  schedule: "DAILY",
  scheduleTime: "07:30",
  recipients: ["qa@corp.com", "manager@corp.com"]
});`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">scheduledReport.trigger (Admin) - Chạy ngay lập tức</h4>
                    <CodeBlock code={`const triggerMutation = trpc.scheduledReport.trigger.useMutation();
await triggerMutation.mutateAsync({ id: 5 });`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Workshop / Line / Station */}
          {/* ============================================================ */}
          {activeMenu === "workshop" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Wrench className="h-5 w-5" />
                    Workshop / Line / Station APIs
                  </CardTitle>
                  <CardDescription>
                    CRUD quản lý cấu trúc nhà máy: Workshop → Line → Station. Mỗi Factory có nhiều Workshop, mỗi Workshop có nhiều Line, mỗi Line có nhiều Station.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Workshop</CardTitle>
                  <CardDescription>Quản lý phân xưởng trong nhà máy</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">workshop.list — Danh sách workshop</h4>
                    <CodeBlock code={`// Query - lọc theo factoryCode
const { data } = trpc.workshop.list.useQuery({ factoryCode: "FAC-001" });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">workshop.listByFactory — Workshop theo nhà máy</h4>
                    <CodeBlock code={`const { data } = trpc.workshop.listByFactory.useQuery({ factoryCode: "FAC-001" });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">workshop.create — Tạo workshop mới</h4>
                    <CodeBlock code={`const mutation = trpc.workshop.create.useMutation();
await mutation.mutateAsync({
  code: "WS-01",
  name: "Phân xưởng SMT",
  factoryCode: "FAC-001",
  description: "Phân xưởng gắn linh kiện bề mặt"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">workshop.update / workshop.delete</h4>
                    <CodeBlock code={`// Update
await trpc.workshop.update.mutate({ id: 1, name: "Phân xưởng SMT-A" });
// Delete
await trpc.workshop.delete.mutate({ id: 1 });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Line</CardTitle>
                  <CardDescription>Quản lý dây chuyền sản xuất trong workshop</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">line.list / line.listByWorkshop</h4>
                    <CodeBlock code={`const { data } = trpc.line.list.useQuery({ workshopId: 1 });
const { data: byWorkshop } = trpc.line.listByWorkshop.useQuery({ workshopId: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">line.create — Tạo dây chuyền</h4>
                    <CodeBlock code={`await trpc.line.create.mutate({
  code: "LINE-01",
  name: "Dây chuyền 1",
  workshopId: 1,
  description: "Dây chuyền lắp ráp chính"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">line.update / line.delete</h4>
                    <CodeBlock code={`await trpc.line.update.mutate({ id: 1, name: "Line A" });
await trpc.line.delete.mutate({ id: 1 });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Station</CardTitle>
                  <CardDescription>Quản lý trạm (station) trong dây chuyền</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">station.list / station.listByLine</h4>
                    <CodeBlock code={`const { data } = trpc.station.list.useQuery({ lineId: 1 });
const { data: byLine } = trpc.station.listByLine.useQuery({ lineId: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">station.create — Tạo station</h4>
                    <CodeBlock code={`await trpc.station.create.mutate({
  code: "ST-01",
  name: "Station AOI 1",
  lineId: 1,
  description: "Trạm kiểm tra AOI",
  orderIndex: 1
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">station.update / station.delete</h4>
                    <CodeBlock code={`await trpc.station.update.mutate({ id: 1, name: "Station AOI-A", orderIndex: 2 });
await trpc.station.delete.mutate({ id: 1 });`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Product Models */}
          {/* ============================================================ */}
          {activeMenu === "productModel" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Package className="h-5 w-5" />
                    Product Model APIs
                  </CardTitle>
                  <CardDescription>
                    Quản lý mã sản phẩm (Product Model), danh mục sản phẩm (Product Category), và mapping sản phẩm-máy.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Product Model CRUD</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">productModel.list — Danh sách sản phẩm</h4>
                    <CodeBlock code={`const { data } = trpc.productModel.list.useQuery({
  factoryCode: "FAC-001",
  search: "PCB",
  categoryId: 3
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">productModel.getById / getByCode</h4>
                    <CodeBlock code={`const { data } = trpc.productModel.getById.useQuery({ id: 1 });
const { data: byCode } = trpc.productModel.getByCode.useQuery({ code: "PCB-A01" });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">productModel.create — Tạo sản phẩm</h4>
                    <CodeBlock code={`await trpc.productModel.create.mutate({
  code: "PCB-A01",
  name: "Main Board A01",
  description: "Bo mạch chính phiên bản A01",
  factoryCode: "FAC-001",
  categoryId: 3,
  image: "data:image/png;base64,..." // Optional
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">productModel.update / productModel.delete</h4>
                    <CodeBlock code={`await trpc.productModel.update.mutate({ id: 1, name: "Main Board A02" });
await trpc.productModel.delete.mutate({ id: 1 });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Product Category</CardTitle>
                  <CardDescription>Danh mục sản phẩm dạng cây (tree)</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">productCategory.list / getTree</h4>
                    <CodeBlock code={`const { data } = trpc.productCategory.list.useQuery({ parentId: null });
const { data: tree } = trpc.productCategory.getTree.useQuery();`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">productCategory.create — Tạo danh mục</h4>
                    <CodeBlock code={`await trpc.productCategory.create.mutate({
  code: "CAT-PCB",
  name: "PCB Boards",
  parentId: null,
  description: "Các loại bo mạch",
  icon: "circuit-board",
  color: "#3b82f6"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">productCategory.reorder — Sắp xếp lại</h4>
                    <CodeBlock code={`await trpc.productCategory.reorder.mutate({
  parentId: null,
  orderedIds: [3, 1, 2, 5, 4]
});`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Product-Machine Mapping</CardTitle>
                  <CardDescription>Ánh xạ sản phẩm với máy kiểm tra</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">productMachineMapping.list / byMachine / byProduct</h4>
                    <CodeBlock code={`const { data } = trpc.productMachineMapping.list.useQuery({ factoryCode: "FAC-001" });
const { data: byMachine } = trpc.productMachineMapping.byMachine.useQuery({ machineId: 1 });
const { data: byProduct } = trpc.productMachineMapping.byProduct.useQuery({ productModelId: 5 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">productMachineMapping.create / delete</h4>
                    <CodeBlock code={`await trpc.productMachineMapping.create.mutate({ machineId: 1, productModelId: 5 });
await trpc.productMachineMapping.delete.mutate({ id: 1 });`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Measurement Points */}
          {/* ============================================================ */}
          {activeMenu === "measurementPoint" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Crosshair className="h-5 w-5" />
                    Measurement Point & Result APIs
                  </CardTitle>
                  <CardDescription>
                    Quản lý điểm đo (Measurement Point) trên sản phẩm và kết quả đo (Measurement Result) từ máy AOI/AVI.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Measurement Point</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">measurementPoint.listByProductModel — Điểm đo theo sản phẩm</h4>
                    <CodeBlock code={`const { data } = trpc.measurementPoint.listByProductModel.useQuery({ productModelId: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">measurementPoint.listByMachine — Điểm đo theo máy</h4>
                    <CodeBlock code={`const { data } = trpc.measurementPoint.listByMachine.useQuery({ machineId: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">measurementPoint.create — Tạo điểm đo</h4>
                    <CodeBlock code={`await trpc.measurementPoint.create.mutate({
  name: "IC U1 Solder Joint",
  code: "MP-IC-U1",
  productModelId: 1,
  pointType: "COMPONENT",
  xCoordinate: 120.5,
  yCoordinate: 85.3,
  width: 10,
  height: 10,
  upperLimit: 1.2,
  lowerLimit: 0.8,
  nominalValue: 1.0,
  unit: "mm",
  description: "Mối hàn IC U1"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">measurementPoint.uploadCroppedImage — Upload ảnh crop</h4>
                    <CodeBlock code={`await trpc.measurementPoint.uploadCroppedImage.mutate({
  id: 1,
  image: "data:image/png;base64,..."
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">measurementPoint.update / delete</h4>
                    <CodeBlock code={`await trpc.measurementPoint.update.mutate({ id: 1, upperLimit: 1.5 });
await trpc.measurementPoint.delete.mutate({ id: 1 });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Measurement Result</CardTitle>
                  <CardDescription>Kết quả đo từ máy AOI/AVI</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">measurementResult.getByInspection — Kết quả theo lần kiểm</h4>
                    <CodeBlock code={`const { data } = trpc.measurementResult.getByInspection.useQuery({
  inspectionId: 100,
  page: 1,
  limit: 50
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">measurementResult.updateRemark — Cập nhật ghi chú</h4>
                    <CodeBlock code={`await trpc.measurementResult.updateRemark.mutate({ id: 1, remark: "Cần kiểm tra lại" });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">measurementResult.analyzeWithAI — Phân tích bằng AI</h4>
                    <CodeBlock code={`await trpc.measurementResult.analyzeWithAI.mutate({ id: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">measurementResult.correctResult — Sửa kết quả</h4>
                    <CodeBlock code={`await trpc.measurementResult.correctResult.mutate({
  id: 1,
  correctedResult: "OK",
  reason: "False positive - mối hàn đạt chuẩn"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">Batch Operations — Xử lý hàng loạt</h4>
                    <CodeBlock code={`// Batch acknowledge
await trpc.measurementResult.batchAcknowledge.mutate({ ids: [1, 2, 3] });
// Batch add note
await trpc.measurementResult.batchAddNote.mutate({ ids: [1, 2], note: "Reviewed OK" });
// Batch add tag
await trpc.measurementResult.batchAddTag.mutate({ ids: [1, 2, 3], tag: "critical" });
// Batch archive
await trpc.measurementResult.batchArchive.mutate({ ids: [4, 5, 6] });`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Production Orders */}
          {/* ============================================================ */}
          {activeMenu === "productionOrder" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ListOrdered className="h-5 w-5" />
                    Production Order APIs
                  </CardTitle>
                  <CardDescription>
                    Quản lý đơn sản xuất, lịch trình, WIP tracking, và tối ưu hóa lịch sản xuất.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Production Order CRUD</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">productionOrder.list — Danh sách đơn sản xuất</h4>
                    <CodeBlock code={`const { data } = trpc.productionOrder.list.useQuery({
  factoryCode: "FAC-001",
  lineId: 1,
  status: "IN_PROGRESS",
  startDate: "2025-01-01",
  endDate: "2025-01-31",
  page: 1,
  limit: 20
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">productionOrder.create — Tạo đơn sản xuất</h4>
                    <CodeBlock code={`await trpc.productionOrder.create.mutate({
  code: "PO-2025-001",
  productModelId: 1,
  lineId: 1,
  quantity: 5000,
  startDate: "2025-02-01",
  endDate: "2025-02-15",
  priority: "HIGH",
  notes: "Đơn hàng khách VIP"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">productionOrder.reschedule — Dời lịch</h4>
                    <CodeBlock code={`await trpc.productionOrder.reschedule.mutate({
  id: 1,
  startDate: "2025-02-05",
  endDate: "2025-02-20"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">productionOrder.checkScheduleOverlap — Kiểm tra xung đột lịch</h4>
                    <CodeBlock code={`const { data } = trpc.productionOrder.checkScheduleOverlap.useQuery({
  lineId: 1,
  startDate: "2025-02-01",
  endDate: "2025-02-15",
  excludeId: 5 // Optional: loại trừ PO đang edit
});`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">WIP & Schedule Optimization</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">productionOrder.getWIPStatus — Trạng thái WIP</h4>
                    <CodeBlock code={`const { data } = trpc.productionOrder.getWIPStatus.useQuery({ factoryCode: "FAC-001" });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">productionOrder.getWIPByLine — WIP theo dây chuyền</h4>
                    <CodeBlock code={`const { data } = trpc.productionOrder.getWIPByLine.useQuery({ lineId: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">productionOrder.optimizeSchedule — Tối ưu lịch (AI)</h4>
                    <CodeBlock code={`const result = await trpc.productionOrder.optimizeSchedule.mutate({
  lineId: 1,
  startDate: "2025-02-01",
  endDate: "2025-02-28"
});
// Trả về danh sách suggestions`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">productionOrder.applyScheduleSuggestion — Áp dụng gợi ý</h4>
                    <CodeBlock code={`await trpc.productionOrder.applyScheduleSuggestion.mutate({
  suggestions: [{ orderId: 1, newStartDate: "2025-02-05", newEndDate: "2025-02-18" }]
});`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Production Order Templates</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">productionOrder.listTemplates / createTemplate</h4>
                    <CodeBlock code={`const { data } = trpc.productionOrder.listTemplates.useQuery({ lineId: 1 });
await trpc.productionOrder.createTemplate.mutate({
  name: "Standard PCB Run",
  productModelId: 1,
  lineId: 1,
  quantity: 5000,
  priority: "MEDIUM"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">productionOrder.createFromTemplate — Tạo từ template</h4>
                    <CodeBlock code={`await trpc.productionOrder.createFromTemplate.mutate({
  templateId: 1,
  startDate: "2025-03-01",
  endDate: "2025-03-15",
  code: "PO-2025-010"
});`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Line Stage & Line-Product Assignment</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">lineStage.list / create / reorder</h4>
                    <CodeBlock code={`const { data } = trpc.lineStage.list.useQuery({ lineId: 1 });
await trpc.lineStage.create.mutate({
  name: "AOI Inspection",
  lineId: 1,
  description: "Kiểm tra AOI",
  orderIndex: 3
});
await trpc.lineStage.reorder.mutate({ lineId: 1, orderedIds: [3, 1, 2] });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">lineProductAssignment.list / create / delete</h4>
                    <CodeBlock code={`const { data } = trpc.lineProductAssignment.list.useQuery({ lineId: 1 });
await trpc.lineProductAssignment.create.mutate({ lineId: 1, productModelId: 5 });
await trpc.lineProductAssignment.delete.mutate({ id: 1 });`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Dashboard Analytics */}
          {/* ============================================================ */}
          {activeMenu === "dashboardAnalytics" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <LayoutDashboard className="h-5 w-5" />
                    Dashboard Analytics APIs
                  </CardTitle>
                  <CardDescription>
                    API thống kê dashboard: tổng quan, xu hướng, so sánh ca, top/bottom máy, và drill-down analysis.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Dashboard Stats</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">dashboard.getStats — Thống kê tổng quan</h4>
                    <CodeBlock code={`const { data } = trpc.dashboard.getStats.useQuery({
  factoryCode: "FAC-001",
  startDate: "2025-01-01",
  endDate: "2025-01-31"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">dashboard.getMachineStats — Thống kê theo máy</h4>
                    <CodeBlock code={`const { data } = trpc.dashboard.getMachineStats.useQuery({
  machineId: 1,
  startDate: "2025-01-01",
  endDate: "2025-01-31"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">dashboard.getDailyStats — Thống kê theo ngày</h4>
                    <CodeBlock code={`const { data } = trpc.dashboard.getDailyStats.useQuery({
  factoryCode: "FAC-001",
  days: 7
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">dashboard.getStatsWithComparison — So sánh kỳ</h4>
                    <CodeBlock code={`const { data } = trpc.dashboard.getStatsWithComparison.useQuery({
  factoryCode: "FAC-001",
  startDate: "2025-01-01",
  endDate: "2025-01-31"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">dashboard.getShiftStats — Thống kê theo ca</h4>
                    <CodeBlock code={`const { data } = trpc.dashboard.getShiftStats.useQuery({
  factoryCode: "FAC-001",
  date: "2025-01-15"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">dashboard.getTopBottomMachines — Top/Bottom máy</h4>
                    <CodeBlock code={`const { data } = trpc.dashboard.getTopBottomMachines.useQuery({
  factoryCode: "FAC-001",
  limit: 5,
  startDate: "2025-01-01",
  endDate: "2025-01-31"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">dashboard.getHourlyStats — Thống kê theo giờ</h4>
                    <CodeBlock code={`const { data } = trpc.dashboard.getHourlyStats.useQuery({
  factoryCode: "FAC-001",
  date: "2025-01-15"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">dashboard.getActiveAlertsCount — Số cảnh báo active</h4>
                    <CodeBlock code={`const { data } = trpc.dashboard.getActiveAlertsCount.useQuery({ factoryCode: "FAC-001" });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Dashboard Templates</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">dashboard.listTemplates / getTemplate</h4>
                    <CodeBlock code={`const { data } = trpc.dashboard.listTemplates.useQuery({ category: "quality" });
const { data: tpl } = trpc.dashboard.getTemplate.useQuery({ id: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">dashboard.createTemplate / applyTemplate</h4>
                    <CodeBlock code={`await trpc.dashboard.createTemplate.mutate({
  name: "Quality Overview",
  category: "quality",
  description: "Template tổng quan chất lượng",
  config: { widgets: [...], layout: {...} }
});
await trpc.dashboard.applyTemplate.mutate({ id: 1 });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Drill-Down Analysis</CardTitle>
                  <CardDescription>Phân tích chi tiết từ Corporate → Factory → Line → Machine</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">drillDown.corporateStats — Tổng quan corporate</h4>
                    <CodeBlock code={`const { data } = trpc.drillDown.corporateStats.useQuery({
  startDate: "2025-01-01",
  endDate: "2025-01-31"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">drillDown.factoriesByCorporate → linesByFactory → machinesByLine</h4>
                    <CodeBlock code={`// Level 1: Factories
const { data: factories } = trpc.drillDown.factoriesByCorporate.useQuery({ startDate, endDate });
// Level 2: Lines by factory
const { data: lines } = trpc.drillDown.linesByFactory.useQuery({ factoryCode: "FAC-001", startDate, endDate });
// Level 3: Machines by line
const { data: machines } = trpc.drillDown.machinesByLine.useQuery({ lineId: 1, startDate, endDate });`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Dashboard Widgets */}
          {/* ============================================================ */}
          {activeMenu === "dashboardWidget" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <LayoutGrid className="h-5 w-5" />
                    Dashboard Widget APIs
                  </CardTitle>
                  <CardDescription>
                    Quản lý layout widget dashboard, shared templates, style presets, và custom dashboards.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Widget Layout</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">dashboardWidget.getLayout — Lấy layout hiện tại</h4>
                    <CodeBlock code={`const { data } = trpc.dashboardWidget.getLayout.useQuery({ dashboardId: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">dashboardWidget.saveLayout — Lưu layout</h4>
                    <CodeBlock code={`await trpc.dashboardWidget.saveLayout.mutate({
  dashboardId: 1,
  widgets: [
    { id: "w1", type: "yield-chart", x: 0, y: 0, w: 6, h: 4, config: {} },
    { id: "w2", type: "machine-status", x: 6, y: 0, w: 6, h: 4, config: {} }
  ]
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">dashboardWidget.resetLayout — Reset về mặc định</h4>
                    <CodeBlock code={`await trpc.dashboardWidget.resetLayout.mutate({ dashboardId: 1 });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Shared Templates</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">dashboardWidget.getSharedTemplates — Danh sách template chia sẻ</h4>
                    <CodeBlock code={`const { data } = trpc.dashboardWidget.getSharedTemplates.useQuery({
  category: "quality",
  search: "yield"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">dashboardWidget.createSharedTemplate / applySharedTemplate</h4>
                    <CodeBlock code={`// Create template từ config hiện tại
await trpc.dashboardWidget.createSharedTemplate.mutate({
  name: "Quality Dashboard v2",
  category: "quality",
  description: "Template chất lượng phiên bản 2",
  config: { widgets: [...] }
});
// Apply template
await trpc.dashboardWidget.applySharedTemplate.mutate({ id: 1, dashboardId: 2 });
// Save current layout as shared template
await trpc.dashboardWidget.saveAsSharedTemplate.mutate({
  name: "My Layout",
  category: "custom",
  dashboardId: 1
});`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Layout Management */}
          {/* ============================================================ */}
          {activeMenu === "layout" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MapPin className="h-5 w-5" />
                    Layout Management APIs
                  </CardTitle>
                  <CardDescription>
                    Quản lý layout mặt bằng nhà máy, vị trí máy trên layout (dùng cho Factory Map view).
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardContent className="space-y-4 pt-6">
                  <div>
                    <h4 className="mb-2 font-semibold">layout.listByWorkshop — Layout theo workshop</h4>
                    <CodeBlock code={`const { data } = trpc.layout.listByWorkshop.useQuery({ workshopId: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">layout.create — Tạo layout</h4>
                    <CodeBlock code={`await trpc.layout.create.mutate({
  name: "Workshop A Floor Plan",
  workshopId: 1,
  width: 1200,
  height: 800,
  backgroundImage: "data:image/png;base64,..." // Optional floor plan image
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">layout.addMachinePosition — Đặt vị trí máy</h4>
                    <CodeBlock code={`await trpc.layout.addMachinePosition.mutate({
  layoutId: 1,
  machineId: 5,
  x: 150,
  y: 200,
  width: 60,
  height: 40,
  rotation: 0
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">layout.updateMachinePosition / removeMachinePosition</h4>
                    <CodeBlock code={`await trpc.layout.updateMachinePosition.mutate({ id: 1, x: 180, y: 220, rotation: 90 });
await trpc.layout.removeMachinePosition.mutate({ id: 1 });`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* User Management */}
          {/* ============================================================ */}
          {activeMenu === "userManagement" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <UserCog className="h-5 w-5" />
                    User Management APIs
                  </CardTitle>
                  <CardDescription>
                    Quản lý người dùng: CRUD, phân quyền, đổi mật khẩu, profile, và cài đặt cá nhân.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">User CRUD (Admin)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">user.list — Danh sách user</h4>
                    <CodeBlock code={`const { data } = trpc.user.list.useQuery({
  search: "nguyen",
  role: "OPERATOR",
  factoryCode: "FAC-001"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">user.create — Tạo user mới (Admin)</h4>
                    <CodeBlock code={`await trpc.user.create.mutate({
  username: "operator01",
  password: "SecurePass@123",
  fullName: "Nguyễn Văn A",
  email: "a@factory.com",
  role: "OPERATOR",
  factoryCode: "FAC-001"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">user.update / updateRole / updatePassword / delete</h4>
                    <CodeBlock code={`await trpc.user.update.mutate({ id: 1, fullName: "Nguyễn Văn B" });
await trpc.user.updateRole.mutate({ id: 1, role: "QC_MANAGER" });
await trpc.user.updatePassword.mutate({ id: 1, password: "NewPass@456" });
await trpc.user.delete.mutate({ id: 1 });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Profile & Settings (Self)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">user.updateProfile — Cập nhật profile cá nhân</h4>
                    <CodeBlock code={`await trpc.user.updateProfile.mutate({
  fullName: "Nguyễn Văn C",
  email: "c@factory.com",
  avatar: "data:image/png;base64,..."
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">user.changePassword — Đổi mật khẩu</h4>
                    <CodeBlock code={`await trpc.user.changePassword.mutate({
  currentPassword: "OldPass@123",
  newPassword: "NewPass@789"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">userSettings.get / update — Cài đặt cá nhân</h4>
                    <CodeBlock code={`const { data } = trpc.userSettings.get.useQuery();
await trpc.userSettings.update.mutate({
  language: "vi",
  theme: "dark",
  timezone: "Asia/Ho_Chi_Minh",
  dateFormat: "DD/MM/YYYY",
  notifications: { email: true, push: false, inApp: true }
});`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Notifications */}
          {/* ============================================================ */}
          {activeMenu === "notification" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Bell className="h-5 w-5" />
                    Notification APIs
                  </CardTitle>
                  <CardDescription>
                    Quản lý thông báo: danh sách, đánh dấu đã đọc, cài đặt preferences, gửi thông báo.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardContent className="space-y-4 pt-6">
                  <div>
                    <h4 className="mb-2 font-semibold">notification.list — Danh sách thông báo</h4>
                    <CodeBlock code={`const { data } = trpc.notification.list.useQuery({
  page: 1,
  limit: 20,
  unreadOnly: true
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">notification.unreadCount — Số thông báo chưa đọc</h4>
                    <CodeBlock code={`const { data } = trpc.notification.unreadCount.useQuery();`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">notification.markAsRead / markAllAsRead</h4>
                    <CodeBlock code={`await trpc.notification.markAsRead.mutate({ id: 1 });
await trpc.notification.markAllAsRead.mutate();`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">notification.delete / deleteOld</h4>
                    <CodeBlock code={`await trpc.notification.delete.mutate({ id: 1 });
await trpc.notification.deleteOld.mutate({ days: 30 }); // Xóa thông báo > 30 ngày`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">notification.getPreferences / updatePreferences</h4>
                    <CodeBlock code={`const { data } = trpc.notification.getPreferences.useQuery();
await trpc.notification.updatePreferences.mutate({
  email: true,
  push: true,
  inApp: true,
  types: ["alert", "report", "system"]
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">notification.sendToUser / broadcast (Admin)</h4>
                    <CodeBlock code={`// Send to specific user
await trpc.notification.sendToUser.mutate({
  userId: 5,
  title: "Cập nhật hệ thống",
  content: "Hệ thống sẽ bảo trì lúc 22:00",
  type: "system"
});
// Broadcast to all users (or by factory)
await trpc.notification.broadcast.mutate({
  title: "Thông báo chung",
  content: "Phiên bản mới đã được cập nhật",
  type: "system",
  factoryCode: "FAC-001" // Optional: chỉ gửi cho factory cụ thể
});`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Permissions & RBAC */}
          {/* ============================================================ */}
          {activeMenu === "permissions" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="h-5 w-5" />
                    Permissions & RBAC APIs
                  </CardTitle>
                  <CardDescription>
                    Hệ thống phân quyền chi tiết: Role-Based Access Control, module-level permissions, custom roles.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Role Management (Admin)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">permissions.listRoles / listRoleTypes</h4>
                    <CodeBlock code={`const { data: roles } = trpc.permissions.listRoles.useQuery();
const { data: roleTypes } = trpc.permissions.listRoleTypes.useQuery();`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">permissions.createRole — Tạo custom role</h4>
                    <CodeBlock code={`await trpc.permissions.createRole.mutate({
  name: "QC_SUPERVISOR",
  description: "Quản lý QC cấp trung",
  permissions: [
    { category: "quality", moduleName: "inspection", canView: true, canEdit: true },
    { category: "quality", moduleName: "annotation", canView: true, canCreate: true }
  ]
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">permissions.updateRole / deleteRole</h4>
                    <CodeBlock code={`await trpc.permissions.updateRole.mutate({ id: 1, name: "QC_LEAD", permissions: [...] });
await trpc.permissions.deleteRole.mutate({ id: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">permissions.getRoleStatistics — Thống kê role</h4>
                    <CodeBlock code={`const { data } = trpc.permissions.getRoleStatistics.useQuery();`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">User Permissions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">permissions.getMyPermissions — Quyền của mình</h4>
                    <CodeBlock code={`const { data } = trpc.permissions.getMyPermissions.useQuery();`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">permissions.getUserPermissions — Quyền user cụ thể</h4>
                    <CodeBlock code={`const { data } = trpc.permissions.getUserPermissions.useQuery({ userId: 5 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">permissions.upsertPermission — Set quyền chi tiết (Admin)</h4>
                    <CodeBlock code={`await trpc.permissions.upsertPermission.mutate({
  userId: 5,
  category: "production",
  moduleName: "productionOrder",
  canView: true,
  canCreate: true,
  canEdit: true,
  canDelete: false,
  canExport: true
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">permissions.batchUpdateUserPermissions — Cập nhật hàng loạt (Admin)</h4>
                    <CodeBlock code={`await trpc.permissions.batchUpdateUserPermissions.mutate({
  userId: 5,
  permissions: [
    { category: "quality", moduleName: "inspection", canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: "quality", moduleName: "annotation", canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false }
  ]
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">permissions.applyRolePermissions — Áp dụng quyền mặc định từ role</h4>
                    <CodeBlock code={`await trpc.permissions.applyRolePermissions.mutate({ userId: 5, role: "QC_MANAGER" });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">permissions.getAvailableModules — Danh sách modules</h4>
                    <CodeBlock code={`const { data } = trpc.permissions.getAvailableModules.useQuery();`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Security (2FA / Sessions) */}
          {/* ============================================================ */}
          {activeMenu === "security" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Lock className="h-5 w-5" />
                    Security APIs (2FA & Sessions)
                  </CardTitle>
                  <CardDescription>
                    Xác thực 2 yếu tố (TOTP), quản lý phiên đăng nhập, backup codes.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Two-Factor Authentication (TOTP)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">twoFactor.getStatus — Kiểm tra trạng thái 2FA</h4>
                    <CodeBlock code={`const { data } = trpc.twoFactor.getStatus.useQuery();
// { enabled: false, hasBackupCodes: false }`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">twoFactor.generateSecret — Tạo secret key (QR code)</h4>
                    <CodeBlock code={`const result = await trpc.twoFactor.generateSecret.mutate();
// { secret: "JBSWY3DPEHPK3PXP", otpauthUrl: "otpauth://totp/...", qrCode: "data:image/png;base64,..." }`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">twoFactor.enable — Bật 2FA (xác nhận bằng mã TOTP)</h4>
                    <CodeBlock code={`await trpc.twoFactor.enable.mutate({ code: "123456" }); // Mã 6 số từ authenticator app`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">twoFactor.verify — Xác thực mã TOTP khi đăng nhập</h4>
                    <CodeBlock code={`await trpc.twoFactor.verify.mutate({ code: "654321" });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">twoFactor.disable — Tắt 2FA</h4>
                    <CodeBlock code={`await trpc.twoFactor.disable.mutate({ code: "123456" });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">twoFactor.regenerateBackupCodes — Tạo lại backup codes</h4>
                    <CodeBlock code={`const result = await trpc.twoFactor.regenerateBackupCodes.mutate({ code: "123456" });
// { backupCodes: ["abc12345", "def67890", ...] }`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Session Management</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">session.list — Danh sách phiên đăng nhập</h4>
                    <CodeBlock code={`const { data } = trpc.session.list.useQuery();
// [{ id, deviceInfo, ipAddress, lastActive, isCurrent }]`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">session.count — Số phiên active</h4>
                    <CodeBlock code={`const { data } = trpc.session.count.useQuery();`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">session.revoke / revokeAll — Thu hồi phiên</h4>
                    <CodeBlock code={`await trpc.session.revoke.mutate({ sessionId: "sess_abc123" });
await trpc.session.revokeAll.mutate(); // Đăng xuất tất cả thiết bị`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Machine Status */}
          {/* ============================================================ */}
          {activeMenu === "machineStatus" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Cpu className="h-5 w-5" />
                    Machine Status APIs
                  </CardTitle>
                  <CardDescription>
                    Giám sát trạng thái máy real-time, lịch sử uptime, cấu hình cảnh báo offline, và manual mapping.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Machine Status & Uptime</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">machineStatus.listWithStatus — DS máy kèm trạng thái</h4>
                    <CodeBlock code={`const { data } = trpc.machineStatus.listWithStatus.useQuery({ factoryCode: "FAC-001" });
// [{ id, name, status: "online"|"offline", lastHeartbeat, uptimePercent }]`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">machineStatus.getLogs / getHeartbeats — Lịch sử</h4>
                    <CodeBlock code={`const { data: logs } = trpc.machineStatus.getLogs.useQuery({ machineId: 1, limit: 50 });
const { data: heartbeats } = trpc.machineStatus.getHeartbeats.useQuery({ machineId: 1, limit: 100 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">machineStatus.getUptimeStats — Thống kê uptime</h4>
                    <CodeBlock code={`const { data } = trpc.machineStatus.getUptimeStats.useQuery({ machineId: 1, days: 30 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">machineStatus.getUptimeTimeline — Timeline uptime</h4>
                    <CodeBlock code={`const { data } = trpc.machineStatus.getUptimeTimeline.useQuery({
  machineId: 1,
  startDate: "2025-01-01",
  endDate: "2025-01-31"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">machineStatus.getReport — Báo cáo trạng thái</h4>
                    <CodeBlock code={`const { data } = trpc.machineStatus.getReport.useQuery({
  factoryCode: "FAC-001",
  startDate: "2025-01-01",
  endDate: "2025-01-31"
});`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Alert Config & Offline Detection</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">machineStatus.getAlertConfig / updateAlertConfig</h4>
                    <CodeBlock code={`const { data } = trpc.machineStatus.getAlertConfig.useQuery({ machineId: 1 });
await trpc.machineStatus.updateAlertConfig.mutate({
  machineId: 1,
  offlineThresholdMinutes: 15,
  notifyEmail: true,
  notifyPush: true
});`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Manual Mapping</CardTitle>
                  <CardDescription>Cấu hình kết nối thủ công cho máy (FTP, SMB, HTTP)</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">manualMapping.create — Tạo mapping thủ công</h4>
                    <CodeBlock code={`await trpc.manualMapping.create.mutate({
  machineId: 1,
  connectionType: "FTP",
  host: "192.168.1.100",
  port: 21,
  path: "/aoi/results",
  description: "AOI-01 FTP Export"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">manualMapping.testConnection — Test kết nối</h4>
                    <CodeBlock code={`const result = await trpc.manualMapping.testConnection.mutate({ id: 1 });
// { success: true, latencyMs: 45 }`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">manualMapping.updateStatus — Cập nhật trạng thái</h4>
                    <CodeBlock code={`await trpc.manualMapping.updateStatus.mutate({ id: 1, status: "active" });`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Workstation Analytics */}
          {/* ============================================================ */}
          {activeMenu === "workstation" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Monitor className="h-5 w-5" />
                    Workstation Analytics APIs
                  </CardTitle>
                  <CardDescription>
                    Quản lý workstation, phân tích lỗi, xu hướng NG, top measurement points lỗi cao.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardContent className="space-y-4 pt-6">
                  <div>
                    <h4 className="mb-2 font-semibold">workstation.list — Danh sách workstation</h4>
                    <CodeBlock code={`const { data } = trpc.workstation.list.useQuery({ machineId: 1, lineId: 2 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">workstation.create — Tạo workstation</h4>
                    <CodeBlock code={`await trpc.workstation.create.mutate({
  name: "Workstation A1",
  code: "WS-A1",
  machineId: 1,
  lineId: 2,
  description: "Trạm kiểm tra component bên trái"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">workstation.summary — Tổng hợp phân tích</h4>
                    <CodeBlock code={`const { data } = trpc.workstation.summary.useQuery({
  machineId: 1,
  startDate: "2025-01-01",
  endDate: "2025-01-31"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">workstation.defectsByWorkstation — Lỗi theo workstation</h4>
                    <CodeBlock code={`const { data } = trpc.workstation.defectsByWorkstation.useQuery({
  workstationId: 1,
  startDate: "2025-01-01",
  endDate: "2025-01-31"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">workstation.topNGMeasurementPoints — Top điểm lỗi</h4>
                    <CodeBlock code={`const { data } = trpc.workstation.topNGMeasurementPoints.useQuery({
  workstationId: 1,
  limit: 10
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">workstation.ngTrend — Xu hướng NG theo ngày</h4>
                    <CodeBlock code={`const { data } = trpc.workstation.ngTrend.useQuery({ workstationId: 1, days: 14 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">workstation.ngComparison — So sánh NG giữa workstations</h4>
                    <CodeBlock code={`const { data } = trpc.workstation.ngComparison.useQuery({
  machineId: 1,
  startDate: "2025-01-01",
  endDate: "2025-01-31"
});`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Process & OEE */}
          {/* ============================================================ */}
          {activeMenu === "processOee" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Gauge className="h-5 w-5" />
                    Process, OEE & Shift Config APIs
                  </CardTitle>
                  <CardDescription>
                    Quản lý quy trình sản xuất, OEE targets, cấu hình ca làm việc, và ngưỡng yield.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Process Management</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">process.list — Danh sách quy trình</h4>
                    <CodeBlock code={`const { data } = trpc.process.list.useQuery({
  processType: "SMT", // SMT | DIP | ASSEMBLY | TESTING | PACKAGING | INSPECTION | OTHER
  isActive: true
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">process.create — Tạo quy trình (Admin)</h4>
                    <CodeBlock code={`await trpc.process.create.mutate({
  code: "PROC-SMT-01",
  name: "SMT Placement",
  description: "Gắn linh kiện bề mặt",
  processType: "SMT",
  cycleTimeTarget: 30,
  orderIndex: 1,
  color: "#3b82f6",
  icon: "cpu"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">process.reorder — Sắp xếp lại thứ tự</h4>
                    <CodeBlock code={`await trpc.process.reorder.mutate({ orderedIds: [3, 1, 2, 4] });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Line-Process Assignment</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">process.getLineAssignments — Quy trình gán cho line</h4>
                    <CodeBlock code={`const { data } = trpc.process.getLineAssignments.useQuery({ lineId: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">process.createLineAssignment — Gán quy trình cho line</h4>
                    <CodeBlock code={`await trpc.process.createLineAssignment.mutate({
  lineId: 1,
  processId: 3,
  orderIndex: 2,
  cycleTimeTarget: 45,
  stationId: 5
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">process.reorderLineAssignments</h4>
                    <CodeBlock code={`await trpc.process.reorderLineAssignments.mutate({ lineId: 1, orderedIds: [2, 3, 1] });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">OEE Targets</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">oee.listTargets — DS mục tiêu OEE</h4>
                    <CodeBlock code={`const { data } = trpc.oee.listTargets.useQuery({ factoryCode: "FAC-001" });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">oee.createTarget — Set mục tiêu OEE cho máy</h4>
                    <CodeBlock code={`await trpc.oee.createTarget.mutate({
  machineId: 1,
  availability: 95,  // %
  performance: 90,   // %
  quality: 99        // %
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">oee.updateTarget / deleteTarget</h4>
                    <CodeBlock code={`await trpc.oee.updateTarget.mutate({ id: 1, quality: 99.5 });
await trpc.oee.deleteTarget.mutate({ id: 1 });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Yield Threshold</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">yieldThreshold.list / getEnabled — DS ngưỡng yield</h4>
                    <CodeBlock code={`const { data } = trpc.yieldThreshold.list.useQuery({ type: "FACTORY" });
const { data: enabled } = trpc.yieldThreshold.getEnabled.useQuery();`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">yieldThreshold.updateWithHistory — Cập nhật có lịch sử</h4>
                    <CodeBlock code={`await trpc.yieldThreshold.updateWithHistory.mutate({
  id: 1,
  warningThreshold: 95,
  criticalThreshold: 90,
  isEnabled: true,
  reason: "Nâng ngưỡng theo KPI Q1 2025"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">yieldThreshold.getHistory — Lịch sử thay đổi</h4>
                    <CodeBlock code={`const { data } = trpc.yieldThreshold.getHistory.useQuery({ limit: 20, offset: 0 });
const { data: byType } = trpc.yieldThreshold.getHistoryByType.useQuery({ type: "MACHINE", limit: 10 });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Shift Config</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">shiftConfig.list / defaults</h4>
                    <CodeBlock code={`const { data } = trpc.shiftConfig.list.useQuery({ factoryCode: "FAC-001" });
const { data: defaults } = trpc.shiftConfig.defaults.useQuery();`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">shiftConfig.create — Tạo ca làm việc</h4>
                    <CodeBlock code={`await trpc.shiftConfig.create.mutate({
  name: "Ca sáng",
  startTime: "06:00",
  endTime: "14:00",
  factoryCode: "FAC-001",
  isDefault: false
});`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Templates & Bulk Import */}
          {/* ============================================================ */}
          {activeMenu === "templateBulk" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Templates, Bulk Import & Export APIs
                  </CardTitle>
                  <CardDescription>
                    Quản lý template cấu hình, import/export dữ liệu hàng loạt.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Template CRUD</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">template.list / getById / getByCategory</h4>
                    <CodeBlock code={`const { data } = trpc.template.list.useQuery({ category: "dashboard" });
const { data: tpl } = trpc.template.getById.useQuery({ id: 1 });
const { data: byCategory } = trpc.template.getByCategory.useQuery({ category: "report" });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">template.create — Tạo template</h4>
                    <CodeBlock code={`await trpc.template.create.mutate({
  name: "Default Dashboard",
  category: "dashboard",
  description: "Template dashboard mặc định",
  config: { widgets: [...], layout: {...} }
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">template.clone — Nhân bản template</h4>
                    <CodeBlock code={`await trpc.template.clone.mutate({ id: 1, newName: "Dashboard v2" });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Bulk Import</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">bulkImport.measurementPoints — Import điểm đo hàng loạt</h4>
                    <CodeBlock code={`await trpc.bulkImport.measurementPoints.mutate({
  productModelId: 1,
  points: [
    { name: "IC U1", code: "MP-01", pointType: "COMPONENT", xCoordinate: 100, yCoordinate: 50 },
    { name: "IC U2", code: "MP-02", pointType: "COMPONENT", xCoordinate: 200, yCoordinate: 80 },
    // ... more points
  ]
});`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Export APIs</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">export.exportInspections — Xuất dữ liệu inspection</h4>
                    <CodeBlock code={`await trpc.export.exportInspections.mutate({
  factoryCode: "FAC-001",
  machineId: 1,
  startDate: "2025-01-01",
  endDate: "2025-01-31",
  format: "xlsx" // csv | xlsx | json
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">export.exportStatistics / exportDashboardStats</h4>
                    <CodeBlock code={`await trpc.export.exportStatistics.mutate({ factoryCode: "FAC-001", format: "xlsx" });
await trpc.export.exportDashboardStats.mutate({ factoryCode: "FAC-001", format: "csv" });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">Các export khác</h4>
                    <CodeBlock code={`await trpc.export.exportProducts.mutate({ factoryCode: "FAC-001", format: "json" });
await trpc.export.exportMachines.mutate({ factoryCode: "FAC-001", format: "xlsx" });
await trpc.export.exportMeasurementPoints.mutate({ productModelId: 1, format: "csv" });
await trpc.export.exportFactories.mutate({ format: "xlsx" });
await trpc.export.exportWorkshops.mutate({ factoryCode: "FAC-001", format: "json" });`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* SMTP & Email */}
          {/* ============================================================ */}
          {activeMenu === "smtpEmail" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Mail className="h-5 w-5" />
                    SMTP & Email APIs
                  </CardTitle>
                  <CardDescription>
                    Cấu hình SMTP server, quản lý email templates, test gửi mail.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">SMTP Configuration</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">smtp.getConfig — Lấy cấu hình SMTP</h4>
                    <CodeBlock code={`const { data } = trpc.smtp.getConfig.useQuery();`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">smtp.updateConfig — Cập nhật cấu hình SMTP</h4>
                    <CodeBlock code={`await trpc.smtp.updateConfig.mutate({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  user: "noreply@company.com",
  password: "app-password",
  fromEmail: "noreply@company.com",
  fromName: "AVI AOI System"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">smtp.testConnection — Test gửi mail</h4>
                    <CodeBlock code={`await trpc.smtp.testConnection.mutate({ toEmail: "test@company.com" });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Email Templates</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">smtp.getEmailTemplates — DS template email</h4>
                    <CodeBlock code={`const { data } = trpc.smtp.getEmailTemplates.useQuery();`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">smtp.createEmailTemplate — Tạo template</h4>
                    <CodeBlock code={`await trpc.smtp.createEmailTemplate.mutate({
  name: "Alert Notification",
  type: "alert",
  subject: "[ALERT] {{machineName}} - {{alertType}}",
  body: "<h1>Cảnh báo từ máy {{machineName}}</h1><p>{{alertContent}}</p>",
  isDefault: true
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">smtp.setDefaultEmailTemplate — Set template mặc định</h4>
                    <CodeBlock code={`await trpc.smtp.setDefaultEmailTemplate.mutate({ id: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">smtp.getDefaultEmailTemplate — Lấy template mặc định theo loại</h4>
                    <CodeBlock code={`const { data } = trpc.smtp.getDefaultEmailTemplate.useQuery({ type: "alert" });`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* System & Config */}
          {/* ============================================================ */}
          {activeMenu === "systemConfig" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Server className="h-5 w-5" />
                    System & Configuration APIs
                  </CardTitle>
                  <CardDescription>
                    Health check, query monitoring, backup/restore, scheduled backups, marketplace, và system config.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">System Health & Config</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">system.health — Health check (Public)</h4>
                    <CodeBlock code={`const { data } = trpc.system.health.useQuery({ timestamp: Date.now() });
// { status: "ok", uptime, database: "connected", version }`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">systemConfig.list / getByKey — Cấu hình hệ thống</h4>
                    <CodeBlock code={`const { data } = trpc.systemConfig.list.useQuery({ category: "general" });
const { data: val } = trpc.systemConfig.getByKey.useQuery({ key: "maintenance_mode" });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">systemConfig.create / update — CRUD config</h4>
                    <CodeBlock code={`await trpc.systemConfig.create.mutate({
  key: "max_upload_size_mb",
  value: "100",
  category: "upload",
  description: "Max upload file size in MB"
});
await trpc.systemConfig.update.mutate({ key: "max_upload_size_mb", value: "200" });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Backup & Restore (Admin)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">system.exportConfig — Export cấu hình</h4>
                    <CodeBlock code={`const { data } = trpc.system.exportConfig.useQuery({
  categories: ["factories", "machines", "users", "templates"]
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">system.importConfig — Import cấu hình</h4>
                    <CodeBlock code={`await trpc.system.importConfig.mutate({
  data: exportedData,
  categories: ["factories", "machines"],
  overwrite: false
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">system.backupLogs.list — Lịch sử backup</h4>
                    <CodeBlock code={`const { data } = trpc.system.backupLogs.list.useQuery({
  action: "export",
  status: "success",
  limit: 50
});`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Scheduled Backups (Admin)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">system.scheduledBackups.list / create</h4>
                    <CodeBlock code={`const { data } = trpc.system.scheduledBackups.list.useQuery({ enabledOnly: true });
await trpc.system.scheduledBackups.create.mutate({
  name: "Daily Full Backup",
  description: "Backup toàn bộ dữ liệu hàng ngày",
  categories: ["factories", "machines", "inspections", "templates"],
  schedule: "daily",
  scheduleTime: "02:00",
  retentionCount: 7,
  storageType: "s3",
  createdBy: 1
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">system.scheduledBackups.toggle — Bật/tắt lịch backup</h4>
                    <CodeBlock code={`await trpc.system.scheduledBackups.toggle.mutate({ id: 1, isEnabled: true });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Query Monitoring (Admin)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">system.queryMonitoring.getSlowQueries — Queries chậm</h4>
                    <CodeBlock code={`const { data } = trpc.system.queryMonitoring.getSlowQueries.useQuery({ limit: 50 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">system.queryMonitoring.getStats / analyzePatterns</h4>
                    <CodeBlock code={`const { data: stats } = trpc.system.queryMonitoring.getStats.useQuery();
const { data: patterns } = trpc.system.queryMonitoring.analyzePatterns.useQuery({ limit: 20 });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Marketplace</CardTitle>
                  <CardDescription>Template marketplace cho chia sẻ cộng đồng</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">system.marketplace.list — Duyệt marketplace</h4>
                    <CodeBlock code={`const { data } = trpc.system.marketplace.list.useQuery({
  category: "dashboard",
  search: "quality",
  sortBy: "rating", // rating | downloads | newest
  limit: 20
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">system.marketplace.publish — Publish template (Admin)</h4>
                    <CodeBlock code={`await trpc.system.marketplace.publish.mutate({
  templateId: 1,
  publisherId: "company-name",
  title: "Quality Dashboard Pro",
  description: "Professional quality monitoring dashboard",
  category: "dashboard",
  tags: ["quality", "monitoring", "yield"]
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">system.marketplace.download — Tải template</h4>
                    <CodeBlock code={`await trpc.system.marketplace.download.mutate({ id: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">system.marketplace.reviews.list / create — Đánh giá</h4>
                    <CodeBlock code={`const { data } = trpc.system.marketplace.reviews.list.useQuery({ marketplaceId: 1 });
await trpc.system.marketplace.reviews.create.mutate({
  marketplaceId: 1,
  userId: 5,
  rating: 5,
  comment: "Excellent template!"
});`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* MQTT Advanced Management */}
          {/* ============================================================ */}
          {activeMenu === "mqttAdvanced" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Wifi className="h-5 w-5" />
                    MQTT Management APIs
                  </CardTitle>
                  <CardDescription>
                    Quản lý MQTT client nâng cao: profiles, assignments, connection monitoring, alerts, bulletin scheduling, và reconnect analytics.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">MQTT Client Profiles</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">mqttClientManagement.listProfiles — DS profiles</h4>
                    <CodeBlock code={`const { data } = trpc.mqttClientManagement.listProfiles.useQuery();`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">mqttClientManagement.createProfile — Tạo profile (Admin)</h4>
                    <CodeBlock code={`await trpc.mqttClientManagement.createProfile.mutate({
  name: "Production MQTT",
  brokerUrl: "mqtt://broker.local:1883",
  username: "prod-user",
  password: "secret",
  keepAlive: 60,
  cleanSession: true
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">mqttClientManagement.duplicateProfile — Nhân bản</h4>
                    <CodeBlock code={`await trpc.mqttClientManagement.duplicateProfile.mutate({ id: 1 });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Profile Assignments</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">mqttClientManagement.assignProfile — Gán profile cho target</h4>
                    <CodeBlock code={`await trpc.mqttClientManagement.assignProfile.mutate({
  profileId: 1,
  targetType: "MACHINE",
  targetId: 5
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">mqttClientManagement.bulkAssignProfile — Gán hàng loạt</h4>
                    <CodeBlock code={`await trpc.mqttClientManagement.bulkAssignProfile.mutate({
  profileId: 1,
  targets: [
    { targetType: "MACHINE", targetId: 1 },
    { targetType: "MACHINE", targetId: 2 },
    { targetType: "LINE", targetId: 3 }
  ]
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">mqttClientManagement.getAvailableTargets — DS targets Available</h4>
                    <CodeBlock code={`const { data } = trpc.mqttClientManagement.getAvailableTargets.useQuery({ targetType: "MACHINE" });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Connection Monitoring</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">mqttClientManagement.getConnectionStatus — Trạng thái kết nối</h4>
                    <CodeBlock code={`const { data } = trpc.mqttClientManagement.getConnectionStatus.useQuery({
  targetType: "MACHINE",
  targetId: 1
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">mqttClientManagement.getConnectionHealth — Sức khỏe kết nối</h4>
                    <CodeBlock code={`const { data } = trpc.mqttClientManagement.getConnectionHealth.useQuery();`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">mqttClientManagement.getConnectionStatusSummary — Tổng hợp</h4>
                    <CodeBlock code={`const { data } = trpc.mqttClientManagement.getConnectionStatusSummary.useQuery();`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Reconnect Analytics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">mqttClientManagement.getReconnectStats — Thống kê reconnect</h4>
                    <CodeBlock code={`const { data } = trpc.mqttClientManagement.getReconnectStats.useQuery({ profileId: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">mqttClientManagement.getReconnectHeatmap — Heatmap reconnect</h4>
                    <CodeBlock code={`const { data } = trpc.mqttClientManagement.getReconnectHeatmap.useQuery({
  startDate: "2025-01-01",
  endDate: "2025-01-31"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">mqttClientManagement.getReconnectTrend / getTopReconnectProfiles</h4>
                    <CodeBlock code={`const { data: trend } = trpc.mqttClientManagement.getReconnectTrend.useQuery({ days: 30 });
const { data: top } = trpc.mqttClientManagement.getTopReconnectProfiles.useQuery({ limit: 10 });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">MQTT Alerts</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">mqttAlert.list / create — Cảnh báo MQTT</h4>
                    <CodeBlock code={`const { data } = trpc.mqttAlert.list.useQuery({ factoryCode: "FAC-001" });
await trpc.mqttAlert.create.mutate({
  name: "Machine Offline Alert",
  type: "offline",
  condition: "GREATER_THAN",
  threshold: 5,
  machineId: 1,
  actions: [{ type: "email", target: "admin@company.com" }]
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">mqttAlert.toggle / resolve — Bật/tắt & giải quyết</h4>
                    <CodeBlock code={`await trpc.mqttAlert.toggle.mutate({ id: 1, enabled: false });
await trpc.mqttAlert.resolve.mutate({ id: 5, resolution: "Fixed network issue" });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">mqttAlert.history / unresolved</h4>
                    <CodeBlock code={`const { data: history } = trpc.mqttAlert.history.useQuery({ alertId: 1, limit: 50 });
const { data: unresolved } = trpc.mqttAlert.unresolved.useQuery({ factoryCode: "FAC-001" });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">MQTT Bulletin</CardTitle>
                  <CardDescription>Lập lịch gửi bulletin tự động qua MQTT cho từng station</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">mqttBulletin.listSettings / upsertSetting</h4>
                    <CodeBlock code={`const { data } = trpc.mqttBulletin.listSettings.useQuery({ enabledOnly: true });
await trpc.mqttBulletin.upsertSetting.mutate({
  stationId: 1,
  enabled: true,
  intervalMinutes: 60,
  scheduleType: "INTERVAL",
  startHour: 6,
  endHour: 22,
  includeImages: true,
  maxFailPoints: 10,
  sendToExternal: true,
  sendFcm: false
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">mqttBulletin.triggerNow — Gửi bulletin ngay lập tức</h4>
                    <CodeBlock code={`await trpc.mqttBulletin.triggerNow.mutate({ stationId: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">mqttBulletin.quickSetup — Setup nhanh nhiều station</h4>
                    <CodeBlock code={`await trpc.mqttBulletin.quickSetup.mutate({
  stationIds: [1, 2, 3],
  intervalMinutes: 30,
  scheduleType: "INTERVAL"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">mqttBulletin.getHistory / getDashboardStats / getSchedulerStatus</h4>
                    <CodeBlock code={`const { data: history } = trpc.mqttBulletin.getHistory.useQuery({ stationId: 1, limit: 50 });
const { data: stats } = trpc.mqttBulletin.getDashboardStats.useQuery({ days: 7 });
const { data: scheduler } = trpc.mqttBulletin.getSchedulerStatus.useQuery();`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">mqttBulletin.sendTestBulletin — Gửi test</h4>
                    <CodeBlock code={`await trpc.mqttBulletin.sendTestBulletin.mutate({
  stationId: 1,
  sendToExternal: true,
  sendFcm: false
});`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Import/Export & Templates</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">mqttClientManagement.exportProfiles / importProfiles</h4>
                    <CodeBlock code={`const { data: exported } = trpc.mqttClientManagement.exportProfiles.useQuery({ profileIds: [1, 2] });
await trpc.mqttClientManagement.importProfiles.mutate({ data: exported });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">mqttClientManagement.getDashboardStats — Dashboard MQTT</h4>
                    <CodeBlock code={`const { data } = trpc.mqttClientManagement.getDashboardStats.useQuery();`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* NG Rate Threshold */}
          {/* ============================================================ */}
          {activeMenu === "ngRateThreshold" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Gauge className="h-5 w-5" />
                    NG Rate Threshold APIs
                  </CardTitle>
                  <CardDescription>
                    Cấu hình ngưỡng tỉ lệ NG theo điểm đo. Khi NG rate trong ngày vượt ngưỡng → tự động gửi MQTT alert.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Threshold CRUD</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">ngRateThreshold.list — Danh sách ngưỡng (filter by station/machine)</h4>
                    <CodeBlock code={`const { data } = trpc.ngRateThreshold.list.useQuery({
  stationId: 1,      // optional
  machineId: 5,      // optional
  isEnabled: true,   // optional
});
// Returns: [{ id, stationId, stationName, machineId, machineName,
//   measurementPointId, pointCode, pointName, productModelId, productModelName,
//   name, description, warningThreshold, criticalThreshold,
//   minSampleSize, cooldownMinutes, sendMqttLocal, sendMqttExternal,
//   sendFcm, isEnabled, createdAt, updatedAt }]`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">ngRateThreshold.getById — Chi tiết 1 ngưỡng</h4>
                    <CodeBlock code={`const { data } = trpc.ngRateThreshold.getById.useQuery({ id: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">ngRateThreshold.create — Tạo ngưỡng mới</h4>
                    <CodeBlock code={`await trpc.ngRateThreshold.create.mutate({
  stationId: 1,                       // required
  machineId: 5,                       // optional (null = tất cả máy)
  measurementPointId: 12,             // optional (null = tổng thể)
  productModelId: 3,                  // optional (null = tất cả model)
  name: "NG rate MP001 > 5%",         // required
  description: "Cảnh báo khi...",     // optional
  warningThreshold: 5.0,              // % NG rate → warning
  criticalThreshold: 10.0,            // % NG rate → critical
  minSampleSize: 10,                  // tránh false alarm khi ít mẫu
  cooldownMinutes: 30,                // chờ giữa 2 lần alert
  sendMqttLocal: true,                // gửi qua broker nội bộ
  sendMqttExternal: true,             // gửi qua broker bên ngoài
  sendFcm: true,                      // push notification
  isEnabled: true,
});
// Returns: { success: true, id: 1 }`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">ngRateThreshold.update — Cập nhật ngưỡng</h4>
                    <CodeBlock code={`await trpc.ngRateThreshold.update.mutate({
  id: 1,
  warningThreshold: 3.0,
  criticalThreshold: 8.0,
  cooldownMinutes: 15,
  isEnabled: true,
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">ngRateThreshold.delete / toggle</h4>
                    <CodeBlock code={`// Xóa ngưỡng
await trpc.ngRateThreshold.delete.mutate({ id: 1 });

// Bật/tắt ngưỡng
await trpc.ngRateThreshold.toggle.mutate({ id: 1, isEnabled: false });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Alert History & Resolution</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">ngRateThreshold.alertHistory — Lịch sử cảnh báo</h4>
                    <CodeBlock code={`const { data } = trpc.ngRateThreshold.alertHistory.useQuery({
  stationId: 1,          // optional
  thresholdId: 5,        // optional
  severity: "critical",  // optional: "warning" | "critical"
  isResolved: false,     // optional
  limit: 50,
  offset: 0,
});
// Returns: { data: [...alerts], total: 123 }`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">ngRateThreshold.resolveAlert — Đánh dấu đã xử lý</h4>
                    <CodeBlock code={`await trpc.ngRateThreshold.resolveAlert.mutate({
  id: 42,
  resolutionNote: "Đã điều chỉnh máy, NG rate giảm về bình thường",
});`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Realtime & Testing</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">ngRateThreshold.currentNgRates — NG rate hiện tại (hôm nay)</h4>
                    <CodeBlock code={`const { data } = trpc.ngRateThreshold.currentNgRates.useQuery({ stationId: 1 });
// Returns: { stationId, stationName, totalInspections, ngCount, ngRate,
//   byPoint: [{ pointDefId, pointCode, pointName, total, ng, rate }] }`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">ngRateThreshold.testCheck — Test kiểm tra NG rate (Admin)</h4>
                    <CodeBlock code={`await trpc.ngRateThreshold.testCheck.mutate({
  stationId: 1,
  machineId: 5,
  inspectionId: 0,        // default 0
  productModelId: 3,       // optional
});
// Triggers NG rate check manually for debugging`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">MQTT NG Rate Alert Payload</CardTitle>
                  <CardDescription>Bản tin tự động gửi khi NG rate vượt ngưỡng</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">Topic</h4>
                    <CodeBlock code={`avi/factory/{factoryId}/workshop/{workshopId}/station/{stationId}/ng-rate-alert`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">Payload</h4>
                    <CodeBlock code={`{
  "type": "NG_RATE_ALERT",
  "severity": "warning",          // "warning" | "critical"
  "thresholdId": 1,
  "thresholdName": "NG rate MP001 > 5%",
  "stationId": 1,
  "stationName": "Station AOI-01",
  "machineId": 5,
  "machineName": "AOI Machine #5",
  "measurementPointId": 12,       // null nếu check tổng thể
  "pointCode": "MP001",           // null nếu check tổng thể
  "pointName": "Solder Joint 1",
  "referenceImageUrl": "/uploads/measurement-points/3/MP001-crop-abc123.png",  // ảnh mẫu (nếu có)
  "productModelId": 3,            // null nếu tất cả model
  "currentNgRate": 7.5,
  "threshold": 5.0,
  "totalInspections": 200,
  "ngCount": 15,
  "message": "NG rate 7.50% vượt ngưỡng cảnh báo 5.00% ...",
  "timestamp": "2025-01-15T10:30:00Z"
}`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">Subscribe</h4>
                    <CodeBlock code={`// Nhận NG rate alert cho 1 station cụ thể:
avi/factory/1/workshop/2/station/3/ng-rate-alert

// Nhận NG rate alert cho tất cả station trong 1 workshop:
avi/factory/1/workshop/2/station/+/ng-rate-alert

// Nhận NG rate alert toàn bộ nhà máy:
avi/factory/1/workshop/+/station/+/ng-rate-alert`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Inspection Images On-Demand */}
          {/* ============================================================ */}
          {activeMenu === "inspectionImages" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Eye className="h-5 w-5" />
                    Inspection Images API
                  </CardTitle>
                  <CardDescription>
                    REST API lấy ảnh kiểm tra on-demand. Thay vì gửi ảnh trực tiếp qua MQTT (quá nặng),
                    client nhận inspectionId rồi gọi API này khi cần xem ảnh.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">GET /api/inspection/:id/images</CardTitle>
                  <CardDescription>Lấy danh sách ảnh của 1 lần kiểm tra theo inspectionId</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">Request</h4>
                    <CodeBlock code={`GET /api/inspection/1234/images

// Không cần authentication header
// inspectionId lấy từ MQTT payload (ngAlert hoặc bulletin)`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">Response (200 OK)</h4>
                    <CodeBlock code={`{
  "success": true,
  "inspectionId": 1234,
  "serialNumber": "SN-2025-001",
  "overallResult": "NG",
  "inspectionTime": "2025-01-15T10:30:00Z",
  "totalPoints": 12,
  "pointsWithImages": [
    {
      "pointDefId": 5,
      "pointCode": "MP001",
      "pointName": "Solder Joint 1",
      "result": "NG",
      "measuredValue": "0.85",
      "imageUrl": "/uploads/inspections/1234/MP001-abc123.jpg",
      "referenceImageUrl": "/uploads/measurement-points/3/MP001-crop-abc123.png"
    },
    {
      "pointDefId": 8,
      "pointCode": "MP004",
      "pointName": "Component Alignment",
      "result": "NG",
      "measuredValue": "1.20",
      "imageUrl": "/uploads/inspections/1234/MP004-def456.jpg",
      "referenceImageUrl": null
    }
  ]
}`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">Error Responses</h4>
                    <CodeBlock code={`// 400 - Invalid ID
{ "success": false, "message": "Invalid inspection ID" }

// 404 - Not found
{ "success": false, "message": "Inspection not found" }

// 500 - Server error
{ "success": false, "message": "Failed to get images" }`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">MQTT NG Alert Payload (Updated)</CardTitle>
                  <CardDescription>
                    Bản tin NG alert đã tối ưu — không gửi ảnh trực tiếp, chỉ gửi URL + inspectionId
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">Topic</h4>
                    <CodeBlock code={`avi/factory/{factoryId}/workshop/{workshopId}/station/{stationId}/errors`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">Payload</h4>
                    <CodeBlock code={`{
  "type": "ngAlert",
  "inspectionId": 1234,
  "serialNumber": "SN-2025-001",
  "productModel": "Model-A",
  "machineName": "AOI Machine #5",
  "stationName": "Station AOI-01",
  "timestamp": "2025-01-15T10:30:00Z",
  "overallResult": "NG",
  "totalPoints": 12,
  "ngPoints": [
    {
      "code": "MP001",
      "name": "Solder Joint 1",
      "result": "NG",
      "measuredValue": "0.85",
      "imageUrl": "/uploads/inspections/1234/MP001-abc123.jpg",
      "referenceImageUrl": "/uploads/measurement-points/3/MP001-crop-abc123.png"
    }
  ],
  "summary": "NG: 2/12 points failed"
}

// ⚠ imageUrl là đường dẫn tương đối trên server
// Client xem ảnh: GET {serverUrl}{imageUrl}
// Hoặc dùng API: GET {serverUrl}/api/inspection/1234/images`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">MQTT Bulletin Payload (Updated)</CardTitle>
                  <CardDescription>
                    Bulletin định kỳ — imageUrl bây giờ là URL thật thay vì base64 bị cắt
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">Topic</h4>
                    <CodeBlock code={`avi/factory/{factoryId}/workshop/{workshopId}/station/{stationId}/bulletin/periodic`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">Payload (trích)</h4>
                    <CodeBlock code={`{
  "type": "periodic_bulletin",
  "stationId": 1,
  "stationName": "Station AOI-01",
  "period": { "from": "...", "to": "..." },
  "summary": {
    "totalInspections": 150,
    "passCount": 140,
    "ngCount": 10,
    "passRate": "93.33%"
  },
  "topFailPoints": [
    {
      "code": "MP001",
      "name": "Solder Joint 1",
      "ngCount": 5,
      "ngRate": "3.33%",
      "latestImageUrl": "/uploads/inspections/1234/MP001-abc123.jpg",
      "referenceImageUrl": "/uploads/measurement-points/3/MP001-crop-abc123.png"
    }
  ]
}

// ✅ latestImageUrl giờ là URL thật → client có thể tải ảnh khi cần
// Trước đây: "data:image/jpeg;base64,/9j/4AAQ..." (bị cắt 100 ký tự)`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Subscribe Topics Reference</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">Tổng hợp MQTT Topics</h4>
                    <CodeBlock code={`// 1. NG Alert (lỗi từng lần kiểm tra)
avi/factory/{fId}/workshop/{wId}/station/{sId}/errors

// 2. NG Rate Threshold Alert (tỉ lệ NG vượt ngưỡng)
avi/factory/{fId}/workshop/{wId}/station/{sId}/ng-rate-alert

// 3. Bulletin (báo cáo định kỳ)
avi/factory/{fId}/workshop/{wId}/station/{sId}/bulletin/periodic

// Wildcards:
// + = 1 level    → station/+/errors   (tất cả station)
// # = multi level → avi/factory/1/#   (mọi topic của factory 1)`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">Flow: On-Demand Image Loading</h4>
                    <CodeBlock code={`// 1. Machine gửi kết quả kiểm tra (có ảnh base64)
POST /api/trpc/machineApi.submitInspection
→ Server tự upload ảnh → lưu URL vào DB

// 2. Server gửi MQTT alert (chỉ gửi URL, không gửi ảnh)
Topic: .../errors
Payload: { inspectionId: 1234, ngPoints: [{ imageUrl: "..." }] }

// 3. Android app nhận alert, hiển thị thông tin cơ bản

// 4. User tap "Xem ảnh" → App gọi REST API
GET /api/inspection/1234/images
→ Trả về danh sách ảnh có URL đầy đủ

// 5. App hiển thị ảnh từ URL
Image source: {serverUrl}/uploads/inspections/1234/MP001-abc123.jpg

// 6. So sánh với ảnh mẫu (Reference Image Comparison)
// referenceImageUrl có trong cả 3 loại payload MQTT
// Android app hiển thị side-by-side: ảnh mẫu (trái) vs ảnh thực tế (phải)
// Fullscreen mode: toggle swap giữa ảnh mẫu ↔ ảnh thực tế`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">GET /api/measurement-point/:id/reference-image</CardTitle>
                  <CardDescription>
                    Lấy ảnh mẫu (reference image) của 1 điểm đo cụ thể, bao gồm vị trí crop trên ảnh product model
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">Request</h4>
                    <CodeBlock code={`GET /api/measurement-point/5/reference-image`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">Response (200 OK)</h4>
                    <CodeBlock code={`{
  "success": true,
  "pointId": 5,
  "pointCode": "MP001",
  "pointName": "Solder Joint 1",
  "referenceImageUrl": "/uploads/measurement-points/3/MP001-crop-abc123.png",
  "position": {
    "x": 150,
    "y": 200,
    "radius": 20,
    "cropWidth": 100,
    "cropHeight": 100
  },
  "productModel": {
    "id": 3,
    "name": "PCBA-REV3",
    "referenceImageUrl": "/uploads/ref/PCBA-REV3/full-board.png"
  }
}`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">Error Responses</h4>
                    <CodeBlock code={`// 404 - Point not found or no reference image
{ "success": false, "message": "Measurement point not found" }
{ "success": false, "message": "No reference image for this point" }`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">GET /api/product-model/:id/reference-images</CardTitle>
                  <CardDescription>
                    Lấy tất cả ảnh mẫu (reference images) của các điểm đo trong 1 product model
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">Request</h4>
                    <CodeBlock code={`GET /api/product-model/3/reference-images`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">Response (200 OK)</h4>
                    <CodeBlock code={`{
  "success": true,
  "productModelId": 3,
  "productModelName": "PCBA-REV3",
  "productReferenceImage": "/uploads/ref/PCBA-REV3/full-board.png",
  "totalPoints": 12,
  "pointsWithRefImage": 8,
  "points": [
    {
      "id": 5,
      "code": "MP001",
      "name": "Solder Joint 1",
      "referenceImageUrl": "/uploads/measurement-points/3/MP001-crop-abc123.png",
      "position": { "x": 150, "y": 200, "radius": 20 }
    },
    {
      "id": 8,
      "code": "MP004",
      "name": "Component Alignment",
      "referenceImageUrl": null,
      "position": { "x": 300, "y": 100, "radius": 25 }
    }
  ]
}`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Annotations & AI */}
          {/* ============================================================ */}
          {activeMenu === "annotationAI" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Pencil className="h-5 w-5" />
                    Annotations & AI APIs
                  </CardTitle>
                  <CardDescription>
                    Ghi chú/đánh dấu trên ảnh inspection, AI analysis, template annotation, so sánh, và AI feedback/training.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Annotation CRUD</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">annotation.save — Lưu annotations lên ảnh</h4>
                    <CodeBlock code={`await trpc.annotation.save.mutate({
  imageUrl: "/uploads/inspection/img001.jpg",
  inspectionId: 100,
  annotations: [
    { type: "rect", x: 100, y: 50, width: 30, height: 20, label: "Solder defect", color: "#ff0000" },
    { type: "circle", cx: 200, cy: 100, radius: 15, label: "Missing component", color: "#ff8800" }
  ],
  metadata: { reviewer: "QC-01", notes: "Need rework" }
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">annotation.getByImage / getByInspection</h4>
                    <CodeBlock code={`const { data } = trpc.annotation.getByImage.useQuery({ imageUrl: "/uploads/inspection/img001.jpg" });
const { data: byInspection } = trpc.annotation.getByInspection.useQuery({ inspectionId: 100 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">annotation.search — Tìm kiếm annotation</h4>
                    <CodeBlock code={`const { data } = trpc.annotation.search.useQuery({
  type: "rect",
  label: "solder",
  startDate: "2025-01-01",
  endDate: "2025-01-31",
  page: 1,
  limit: 20
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">annotation.statistics — Thống kê annotation</h4>
                    <CodeBlock code={`const { data } = trpc.annotation.statistics.useQuery({ startDate: "2025-01-01", endDate: "2025-01-31" });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">annotation.analyzeImage — AI phân tích ảnh</h4>
                    <CodeBlock code={`const result = await trpc.annotation.analyzeImage.mutate({ imageUrl: "/uploads/inspection/img001.jpg" });
// AI suggest annotations tự động`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">annotation.copyAnnotations — Copy annotations giữa ảnh</h4>
                    <CodeBlock code={`await trpc.annotation.copyAnnotations.mutate({
  sourceImageUrl: "/uploads/inspection/img001.jpg",
  targetImageUrl: "/uploads/inspection/img002.jpg"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">annotation.export / import — Xuất/nhập annotations</h4>
                    <CodeBlock code={`await trpc.annotation.export.mutate({ inspectionId: 100, format: "json" });
await trpc.annotation.import.mutate({ data: importedAnnotations });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Annotation Templates</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">annotationTemplate.list / create / delete</h4>
                    <CodeBlock code={`const { data } = trpc.annotationTemplate.list.useQuery();
await trpc.annotationTemplate.create.mutate({
  name: "Common PCB Defects",
  annotations: [
    { type: "rect", label: "Solder bridge", color: "#ff0000" },
    { type: "circle", label: "Missing component", color: "#ff8800" }
  ]
});
await trpc.annotationTemplate.delete.mutate({ id: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">annotation.bulkApplyTemplate — Áp dụng template hàng loạt</h4>
                    <CodeBlock code={`await trpc.annotation.bulkApplyTemplate.mutate({
  templateId: 1,
  imageUrls: ["/uploads/img001.jpg", "/uploads/img002.jpg", "/uploads/img003.jpg"]
});`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Annotation History & Root Cause</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">annotationHistory.list — Lịch sử chỉnh sửa</h4>
                    <CodeBlock code={`const { data } = trpc.annotationHistory.list.useQuery({ annotationId: 1, limit: 20 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">annotationHistory.compare — So sánh 2 phiên bản</h4>
                    <CodeBlock code={`const { data } = trpc.annotationHistory.compare.useQuery({ historyId1: 1, historyId2: 5 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">annotationHistory.rollback — Rollback về phiên bản cũ</h4>
                    <CodeBlock code={`await trpc.annotationHistory.rollback.mutate({ historyId: 3 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">rootCause.analyze — Phân tích nguyên nhân gốc</h4>
                    <CodeBlock code={`const result = await trpc.rootCause.analyze.mutate({
  measurementPointId: 1,
  startDate: "2025-01-01",
  endDate: "2025-01-31"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">rootCause.list / get</h4>
                    <CodeBlock code={`const { data } = trpc.rootCause.list.useQuery({ measurementPointId: 1, status: "OPEN" });
const { data: detail } = trpc.rootCause.get.useQuery({ id: 1 });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">
                    <div className="flex items-center gap-2">
                      <Brain className="h-5 w-5" />
                      AI Feedback & Training
                    </div>
                  </CardTitle>
                  <CardDescription>Thu thập feedback từ người dùng để cải thiện model AI</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">aiFeedback.createSuggestion — AI đề xuất</h4>
                    <CodeBlock code={`await trpc.aiFeedback.createSuggestion.mutate({
  inspectionId: 100,
  measurementResultId: 50,
  suggestionType: "DEFECT_CLASSIFICATION",
  suggestion: "Solder bridge detected",
  confidence: 0.92,
  reasoning: "Pattern matches known solder bridge defect",
  modelVersion: "v2.1",
  modelName: "defect-classifier"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">aiFeedback.submitFeedback — Phản hồi từ QC</h4>
                    <CodeBlock code={`await trpc.aiFeedback.submitFeedback.mutate({
  suggestionId: 1,
  feedbackType: "CORRECT", // CORRECT | INCORRECT | PARTIAL | UNSURE
  accuracy: 95,
  correctedValue: null,
  correctionNotes: "Đúng, là solder bridge"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">aiFeedback.getModelMetrics — Metrics model AI</h4>
                    <CodeBlock code={`const { data } = trpc.aiFeedback.getModelMetrics.useQuery({
  modelName: "defect-classifier",
  modelVersion: "v2.1",
  startDate: "2025-01-01",
  endDate: "2025-01-31"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">aiFeedback.createTrainingBatch — Tạo batch training data</h4>
                    <CodeBlock code={`await trpc.aiFeedback.createTrainingBatch.mutate({
  name: "Training Batch Q1-2025",
  description: "Data from January feedback",
  feedbackType: "CORRECT",
  exportFormat: "JSONL",
  targetModelName: "defect-classifier",
  targetModelVersion: "v3.0"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">aiFeedback.exportTrainingBatch — Xuất training data</h4>
                    <CodeBlock code={`await trpc.aiFeedback.exportTrainingBatch.mutate({ batchId: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">aiFeedback.getDashboardStats — Dashboard AI</h4>
                    <CodeBlock code={`const { data } = trpc.aiFeedback.getDashboardStats.useQuery();`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Training Batch Comments & Tags</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">trainingBatchComments.addComment — Thêm comment</h4>
                    <CodeBlock code={`await trpc.trainingBatchComments.addComment.mutate({
  batchId: 1,
  content: "This batch needs more negative samples",
  parentId: null // reply to another comment
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">trainingBatchComments.listComments</h4>
                    <CodeBlock code={`const { data } = trpc.trainingBatchComments.listComments.useQuery({ batchId: 1, limit: 50 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">trainingBatchComments.createTag / assignTag / getBatchTags</h4>
                    <CodeBlock code={`// Create tag
await trpc.trainingBatchComments.createTag.mutate({
  name: "high-priority",
  color: "#ef4444",
  description: "Ưu tiên xử lý trước"
});
// Assign tag to batch
await trpc.trainingBatchComments.assignTag.mutate({ batchId: 1, tagId: 3 });
// Get batch tags
const { data } = trpc.trainingBatchComments.getBatchTags.useQuery({ batchId: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">Predictive Alerts</h4>
                    <CodeBlock code={`// List predictive alerts
const { data } = trpc.predictiveAlert.list.useQuery({
  machineId: 1,
  status: "ACTIVE",
  severity: "HIGH",
  page: 1,
  limit: 20
});
// Generate predictions for machine
await trpc.predictiveAlert.generatePredictions.mutate({ machineId: 1 });
// Acknowledge / Resolve / Dismiss
await trpc.predictiveAlert.acknowledge.mutate({ id: 1 });
await trpc.predictiveAlert.resolve.mutate({ id: 1, resolution: "Replaced worn component" });
await trpc.predictiveAlert.dismiss.mutate({ id: 1, reason: "False positive" });
// Stats
const { data: stats } = trpc.predictiveAlert.stats.useQuery({ machineId: 1 });`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* SPC & Heatmap */}
          {/* ============================================================ */}
          {activeMenu === "spcHeatmap" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    SPC Analysis & Defect Heatmap APIs
                  </CardTitle>
                  <CardDescription>
                    Statistical Process Control (SPC), phát hiện bất thường, heatmap lỗi, so sánh inspection, và phân tích xu hướng.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">SPC Analysis</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">spcAnalysis.topNGPoints — Top điểm NG</h4>
                    <CodeBlock code={`const { data } = trpc.spcAnalysis.topNGPoints.useQuery({
  startDate: "2025-01-01",
  endDate: "2025-01-31",
  machineId: 1,
  factoryCode: "FAC-001",
  productModelId: 5,
  limit: 10
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">spcAnalysis.yieldTrend — Xu hướng yield</h4>
                    <CodeBlock code={`const { data } = trpc.spcAnalysis.yieldTrend.useQuery({
  startDate: "2025-01-01",
  endDate: "2025-01-31",
  machineId: 1,
  interval: "day", // hour | day | week | month
  predictDays: 7
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">spcAnalysis.detectAnomalies — Phát hiện bất thường</h4>
                    <CodeBlock code={`const { data } = trpc.spcAnalysis.detectAnomalies.useQuery({
  machineId: 1,
  factoryCode: "FAC-001",
  days: 30,
  zScoreThreshold: 2
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">spcAnalysis.rootCauseSuggestions — Gợi ý nguyên nhân</h4>
                    <CodeBlock code={`const { data } = trpc.spcAnalysis.rootCauseSuggestions.useQuery({
  startDate: "2025-01-01",
  endDate: "2025-01-31",
  machineId: 1
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">spcAnalysis.workstationAnalysis / ngByWorkstation</h4>
                    <CodeBlock code={`const { data } = trpc.spcAnalysis.workstationAnalysis.useQuery({
  startDate: "2025-01-01",
  endDate: "2025-01-31",
  machineId: 1
});
const { data: ngByWS } = trpc.spcAnalysis.ngByWorkstation.useQuery({
  startDate: "2025-01-01",
  endDate: "2025-01-31",
  limit: 20
});`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Defect Heatmap</CardTitle>
                  <CardDescription>Bản đồ nhiệt phân bố lỗi trên board/panel</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">defectHeatmap.generate — Tạo heatmap</h4>
                    <CodeBlock code={`await trpc.defectHeatmap.generate.mutate({
  machineId: 1,
  productModelId: 5,
  periodType: "DAILY", // HOURLY | DAILY | WEEKLY | MONTHLY
  startDate: "2025-01-01",
  endDate: "2025-01-31",
  gridWidth: 100,
  gridHeight: 100
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">defectHeatmap.list / getLatest</h4>
                    <CodeBlock code={`const { data } = trpc.defectHeatmap.list.useQuery({
  machineId: 1,
  productModelId: 5,
  periodType: "DAILY",
  limit: 10
});
const { data: latest } = trpc.defectHeatmap.getLatest.useQuery({
  machineId: 1,
  periodType: "DAILY"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">defectHeatmap.getMachineOverlay — Overlay lên layout máy</h4>
                    <CodeBlock code={`const { data } = trpc.defectHeatmap.getMachineOverlay.useQuery({
  startDate: "2025-01-01",
  endDate: "2025-01-31"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">defectHeatmap.getRealTimeHotspots — Hotspot real-time</h4>
                    <CodeBlock code={`const { data } = trpc.defectHeatmap.getRealTimeHotspots.useQuery({
  machineId: 1,
  hours: 1 // 1-24 hours
});`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Annotation Comparison</CardTitle>
                  <CardDescription>So sánh annotations giữa các lần inspection</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">annotationComparison.createSession — Tạo phiên so sánh</h4>
                    <CodeBlock code={`await trpc.annotationComparison.createSession.mutate({
  name: "Weekly Review W4",
  description: "So sánh inspection tuần 4",
  productModelId: 5,
  machineId: 1,
  inspectionIds: [100, 101, 102, 103]
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">annotationComparison.compareTwo — So sánh 2 inspection</h4>
                    <CodeBlock code={`const { data } = trpc.annotationComparison.compareTwo.useQuery({
  inspectionId1: 100,
  inspectionId2: 101
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">annotationComparison.detectPatterns — Phát hiện patterns</h4>
                    <CodeBlock code={`await trpc.annotationComparison.detectPatterns.mutate({ sessionId: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">annotationComparison.generatePdfReport — Xuất báo cáo PDF</h4>
                    <CodeBlock code={`await trpc.annotationComparison.generatePdfReport.mutate({
  inspectionId1: 100,
  inspectionId2: 101,
  includeImages: true,
  includePatterns: true
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">annotationComparison.getTrendData — Xu hướng</h4>
                    <CodeBlock code={`const { data } = trpc.annotationComparison.getTrendData.useQuery({
  machineId: 1,
  productModelId: 5,
  dateFrom: "2025-01-01",
  dateTo: "2025-01-31",
  groupBy: "day" // day | week | month
});`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Audit Logs */}
          {/* ============================================================ */}
          {activeMenu === "audit" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ScrollText className="h-5 w-5" />
                    Audit Log APIs
                  </CardTitle>
                  <CardDescription>
                    Theo dõi lịch sử thao tác của người dùng trong hệ thống.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardContent className="space-y-4 pt-6">
                  <div>
                    <h4 className="mb-2 font-semibold">audit.list — Danh sách audit logs</h4>
                    <CodeBlock code={`const { data } = trpc.audit.list.useQuery({
  userId: 5,
  action: "CREATE",
  resourceType: "inspection",
  startDate: "2025-01-01",
  endDate: "2025-01-31",
  page: 1,
  limit: 50
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">audit.stats — Thống kê audit</h4>
                    <CodeBlock code={`const { data } = trpc.audit.stats.useQuery({
  startDate: "2025-01-01",
  endDate: "2025-01-31"
});
// { totalActions, byUser, byAction, byResource, dailyBreakdown }`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
