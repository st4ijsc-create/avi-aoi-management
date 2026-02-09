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
  "productModelId": 33,
  "created": 1,
  "updated": 7,
  "failed": 0,
  "errors": []
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
                    Sync Points
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
                  <Card className={glassCard}>
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <Badge className="bg-success text-success-foreground">POST</Badge>
                        <code className="text-sm text-white">
                          machineApi.syncMeasurementPoints
                        </code>
                      </div>
                      <CardDescription>Đồng bộ tọa độ, dung sai, ảnh tham chiếu từ máy.</CardDescription>
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
                        </ul>
                      </div>
                    </CardContent>
                  </Card>
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
        </div>
      </div>
    </DashboardLayout>
  );
}
