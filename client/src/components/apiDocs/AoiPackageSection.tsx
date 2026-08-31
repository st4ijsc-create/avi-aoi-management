/**
 * doc 48 R4 (tech-debt) — "AOI Image Upload" API-docs section extracted VERBATIM from
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
  Copy,
  Languages,
  Send,
  ShieldCheck,
  UploadCloud,
  ClipboardList,
  Camera,
  FileArchive,
  HardDrive,
  Package,
  Server,
  Image,
  Download,
} from "lucide-react";
import { CodeBlock, glassCard } from "./shared";

interface ApiSectionProps {
  endpointBase: string;
  baseUrl: string;
}

export function AoiPackageSection({ endpointBase, baseUrl }: ApiSectionProps) {
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
  "packageId": "INS-20260207-001",
  // Tuỳ chọn, ĐỘC LẬP với lời khai ở presign — khai thì server băm/đếm lại
  // byte ZIP đã lưu và so; lệch ⇒ từ chối commit.
  "sizeBytes": 15728640,
  "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
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

// meta.json schema — BG-85 (2026-09-02): CHÍNH payload kết quả v2.0
// (machineDataContractV2 — cây surfaces[].positions[].captures[].components[])
// CỘNG THÊM đúng một trường "images[]" (tham chiếu ảnh, captureId là khoá
// join sang captures[] trong cây). "identity"/"productId"/"ntf"/"summary"/
// "surfaces" đều BẮT BUỘC — server từ chối gói thiếu bất kỳ trường nào ở trên:
{
  "identity": {
    "station": "AIC-01", "machine": "AOI-01", "line": "LINE-A",
    "plant": "FAC001", "country": "VN", "solutionName": "PCBA-SOL", "appVersion": "1.0.0"
  },
  "productId": "b3f1c2a0-1111-4a2b-9c3d-000000000001",
  "serialNumber": "SN-20260207-001",
  "productModel": "PCBA-REV3",
  "overallResult": "NG",
  "ntf": false,
  "startedAt": "2026-02-07T10:00:00.000",
  "completedAt": "2026-02-07T10:00:15.000",
  "summary": {
    "surfaces":   { "total": 1, "pass": 0, "ng": 1, "ntf": 0 },
    "positions":  { "total": 1, "pass": 0, "ng": 1, "ntf": 0 },
    "captures":   { "total": 2, "pass": 1, "ng": 1, "ntf": 0 },
    "components": { "total": 2, "pass": 1, "ng": 1, "ntf": 0 }
  },
  "surfaces": [
    {
      "name": "TOP", "result": "NG", "ntf": false,
      "positions": [
        {
          "positionId": "P01", "result": "NG", "ntf": false,
          "captures": [
            {
              "captureId": "cap-P01-001", "captureName": "Connector A", "result": "OK", "ntf": false,
              "components": [{ "componentId": "comp-P01-001", "result": "OK", "ntf": false, "value": 0.25 }]
            },
            {
              "captureId": "cap-P02-001", "captureName": "IC U3", "result": "NG", "ntf": false,
              "components": [{ "componentId": "comp-P02-001", "result": "NG", "ntf": false, "value": 0.52 }]
            }
          ]
        }
      ]
    }
  ],
  "images": [
    { "captureId": "cap-P01-001", "fileName": "P01.jpg" },
    { "captureId": "cap-P02-001", "fileName": "P02.jpg" }
  ]
}

// ⚠ Hợp đồng PHẲNG cũ ("measurements[]"/"points[]", không có "surfaces") KHÔNG
// còn được server chấp nhận — thiếu "surfaces"/"ntf"/"summary"/"identity" bắt
// buộc sẽ bị từ chối (invalid_type). Gói KHÔNG bị khoá vĩnh viễn ('dead') vì
// hình dạng sai — nó ở lại chờ retry, nhưng KHÔNG BAO GIỜ tự commit được cho
// tới khi Agent gửi đúng hình dạng CÂY ở trên. Mỗi "images[].captureId" PHẢI
// khớp đúng một "captureId" có thật trong cây "surfaces[]" — không khớp ⇒ CẢ
// GÓI bị từ chối (không âm thầm bỏ ảnh).`;

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
            // "measurements" — server BẮT BUỘC trường này (dù rỗng). Đặt tên "points"
            // ở đây (tên trường JSON cũ) sẽ khiến server từ chối gói (invalid_type) vì
            // thiếu "measurements" — gói không bao giờ commit được, dù retry.
            measurements = points.Select(p => new
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


  return (
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
                          <li><code>sizeBytes</code> — số byte CHÍNH XÁC của ZIP. Vượt trần (mặc định 200MB, cấu hình <code>AOI_PACKAGE_ZIP_MAX_BYTES</code>) ⇒ từ chối ngay tại presign, trước khi tốn một lượt tải</li>
                          <li><code>sha256</code> — (tuỳ chọn) SHA-256 hex của TOÀN BỘ tệp ZIP, hoa/thường đều được. Máy chủ LƯU lời khai này rồi băm lại byte ZIP thật ở bước upload — lệch ⇒ HTTP 400, gói KHÔNG được lưu. Không gửi ⇒ gói đó không có phép kiểm toàn vẹn nào (chỉ còn đối chiếu <code>sizeBytes</code>)</li>
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
                          <li>Parse <code>meta.json</code> từ ZIP theo hợp đồng CÂY <code>surfaces[].positions[].captures[].components[]</code> + <code>images[]</code> (hình dạng phẳng <code>measurements[]</code> cũ KHÔNG còn parse được)</li>
                          <li>Tạo <code>package_images</code> cho từng phần tử <code>images[]</code> đã thẩm định (<code>pointCode</code> = <code>captureId</code>, <code>result</code> = phán quyết cuộn từ cây)</li>
                          <li>Tạo <code>product_inspections</code> cho MỌI gói có <code>meta.json</code> hợp lệ — kể cả khi <code>serialNumber</code> RỖNG. Hội tụ theo <code>packageId</code> (khoá idempotency <code>aoi-pkg:&lt;packageId&gt;</code>), KHÔNG gộp theo serial trùng</li>
                          <li>Đếm OK/NG và phán quyết <code>overallResult</code> LUÔN cuộn từ CÂY. <code>summary</code> máy khai chỉ được lưu nguyên văn + gắn cờ lệch, KHÔNG BAO GIỜ là nguồn</li>
                          <li><code>images[].captureId</code> không có trong cây, hoặc <code>images[].fileName</code> không có tệp thật trong <code>images/</code> ⇒ TỪ CHỐI CẢ GÓI (không âm thầm bỏ ảnh)</li>
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
                          <li><code>fileName</code> trong <code>measurements</code> phải khớp với tên file thực tế trong ZIP</li>
                          <li>Hỗ trợ định dạng: JPG, JPEG, PNG, BMP, TIFF</li>
                          <li>Nên dùng tên <code>pointCode</code> làm tên file (vd: P01.jpg)</li>
                          <li><code>result</code>: "OK" | "NG" | "NTF" (Not True Failure)</li>
                        </ul>
                      </div>
                      <div className="rounded-2xl border border-dashed border-blue-400/30 bg-blue-500/5 p-4 text-sm text-white/80">
                        <h4 className="font-semibold text-blue-300 mb-2">Hướng sắp tới (đã quyết định, CHƯA triển khai — BG-85)</h4>
                        <p>
                          <code>meta.json</code> sẽ hợp nhất thành CÙNG hình dạng với payload kết quả v2.0
                          (<code>machineDataContractV2</code>: cây surfaces/positions/captures/components) cộng
                          thêm đúng một mảng <code>images[]</code> tham chiếu ảnh (nối bằng <code>captureId</code>).
                          Cấu trúc <code>measurements[]</code>/<code>points[]</code> ở trên sẽ bị thay thế khi
                          BG-85 hoàn tất, theo lộ trình di trú 3 giai đoạn (nhận cả hai hình dạng → đếm được →
                          cắt hình dạng cũ). Bên tích hợp máy nên theo dõi trước khi đầu tư nhiều vào engine
                          sinh <code>meta.json</code> hiện tại, để không phải viết lại hai lần.
                        </p>
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
  );
}
