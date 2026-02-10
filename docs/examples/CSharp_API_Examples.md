# C# API Examples - AVI/AOI Management System

Tài liệu này cung cấp các ví dụ C# để tích hợp với hệ thống MES AVI/AOI.

---

## 📋 Table of Contents

1. [Setup & Configuration](#setup--configuration)
2. [Authentication](#authentication)
3. [Submit Inspection (tRPC)](#submit-inspection-trpc)
4. [AOI Package Upload](#aoi-package-upload)
5. [Machine Heartbeat](#machine-heartbeat)
6. [Sync Measurement Points](#sync-measurement-points)
7. [Query Inspection History](#query-inspection-history)
8. [Complete Examples](#complete-examples)

---

## Setup & Configuration

### Install NuGet Packages

```xml
<!-- .csproj -->
<ItemGroup>
  <PackageReference Include="System.Net.Http.Json" Version="8.0.0" />
  <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
</ItemGroup>
```

### Configuration Model

```csharp
using System;

namespace AviAoiClient.Models
{
    public class ApiConfig
    {
        public string BaseUrl { get; set; } = "https://your-server.com";
        public string MachineCode { get; set; } = "AOI-LINE1-01";
        public string ApiKey { get; set; } = "your-api-key-here";
        public int TimeoutSeconds { get; set; } = 30;
    }

    public class InspectionData
    {
        public string SerialNumber { get; set; }
        public string ProductModel { get; set; }
        public string BatchNumber { get; set; }
        public string OverallResult { get; set; } // "OK" or "NG"
        public DateTime InspectionTime { get; set; }
        public double? CycleTime { get; set; }
        
        // Enterprise hierarchy
        public string CompanyCode { get; set; }
        public string FactoryCode { get; set; }
        public string WorkshopCode { get; set; }
        public string LineCode { get; set; }
        public string StageCode { get; set; }
        
        // Production context
        public string ProductionOrderCode { get; set; }
        public string OperatorId { get; set; }
        
        public List<MeasurementData> Measurements { get; set; } = new();
    }

    public class MeasurementData
    {
        public string PointId { get; set; }
        public string PointCode { get; set; }
        public object MeasuredValue { get; set; } // Can be number or string
        public string Result { get; set; } // "OK", "NG", or "NTF"
        public string Remark { get; set; }
        public string ImageBase64 { get; set; }
    }
}
```

---

## Authentication

```csharp
using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading.Tasks;

namespace AviAoiClient
{
    public class ApiClient : IDisposable
    {
        private readonly HttpClient _httpClient;
        private readonly ApiConfig _config;

        public ApiClient(ApiConfig config)
        {
            _config = config;
            _httpClient = new HttpClient
            {
                BaseAddress = new Uri(config.BaseUrl),
                Timeout = TimeSpan.FromSeconds(config.TimeoutSeconds)
            };
            
            // Set default headers
            _httpClient.DefaultRequestHeaders.Accept.Clear();
            _httpClient.DefaultRequestHeaders.Accept.Add(
                new MediaTypeWithQualityHeaderValue("application/json")
            );
        }

        public void Dispose()
        {
            _httpClient?.Dispose();
        }
    }
}
```

---

## Submit Inspection (tRPC)

### Example 1: Basic Inspection Submit

```csharp
using System;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Newtonsoft.Json;

namespace AviAoiClient.Services
{
    public class InspectionService
    {
        private readonly ApiClient _client;
        private readonly ApiConfig _config;

        public InspectionService(ApiClient client, ApiConfig config)
        {
            _client = client;
            _config = config;
        }

        public async Task<InspectionResponse> SubmitInspectionAsync(InspectionData data)
        {
            try
            {
                // Build tRPC request payload
                var payload = new
                {
                    machineCode = _config.MachineCode,
                    apiKey = _config.ApiKey,
                    serialNumber = data.SerialNumber,
                    productModel = data.ProductModel,
                    batchNumber = data.BatchNumber,
                    overallResult = data.OverallResult,
                    inspectionTime = data.InspectionTime.ToString("yyyy-MM-ddTHH:mm:ssZ"),
                    cycleTime = data.CycleTime,
                    
                    // Enterprise hierarchy (NEW - unified structure)
                    companyCode = data.CompanyCode,
                    factoryCode = data.FactoryCode,
                    workshopCode = data.WorkshopCode,
                    lineCode = data.LineCode,
                    stageCode = data.StageCode,
                    
                    // Production context (NEW - unified structure)
                    productionOrderCode = data.ProductionOrderCode,
                    operatorId = data.OperatorId,
                    
                    measurements = data.Measurements.Select(m => new
                    {
                        pointId = m.PointId,
                        pointCode = m.PointCode,
                        measuredValue = m.MeasuredValue,
                        result = m.Result,
                        remark = m.Remark,
                        imageBase64 = m.ImageBase64
                    }).ToArray()
                };

                var json = JsonConvert.SerializeObject(payload);
                var content = new StringContent(json, Encoding.UTF8, "application/json");

                // tRPC endpoint format: /api/trpc/machineApi.submitInspection
                var response = await _client._httpClient.PostAsync(
                    "/api/trpc/machineApi.submitInspection",
                    content
                );

                response.EnsureSuccessStatusCode();

                var responseBody = await response.Content.ReadAsStringAsync();
                var result = JsonConvert.DeserializeObject<TrpcResponse<InspectionResponse>>(responseBody);

                Console.WriteLine($"✅ Inspection submitted successfully. ID: {result.Result.Data.InspectionId}");
                return result.Result.Data;
            }
            catch (HttpRequestException ex)
            {
                Console.WriteLine($"❌ HTTP Error: {ex.Message}");
                throw;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ Error submitting inspection: {ex.Message}");
                throw;
            }
        }
    }

    // Response models
    public class TrpcResponse<T>
    {
        [JsonProperty("result")]
        public TrpcResult<T> Result { get; set; }
    }

    public class TrpcResult<T>
    {
        [JsonProperty("data")]
        public T Data { get; set; }
    }

    public class InspectionResponse
    {
        [JsonProperty("success")]
        public bool Success { get; set; }
        
        [JsonProperty("inspectionId")]
        public int InspectionId { get; set; }
    }
}
```

### Example 2: Submit with Images (Base64)

```csharp
using System;
using System.IO;
using System.Threading.Tasks;

namespace AviAoiClient.Services
{
    public static class ImageHelper
    {
        public static string ConvertImageToBase64(string imagePath)
        {
            try
            {
                byte[] imageBytes = File.ReadAllBytes(imagePath);
                string base64String = Convert.ToBase64String(imageBytes);
                
                // Optionally add data URI prefix
                string mimeType = GetMimeType(imagePath);
                return $"data:{mimeType};base64,{base64String}";
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ Error converting image: {ex.Message}");
                throw;
            }
        }

        private static string GetMimeType(string filePath)
        {
            string extension = Path.GetExtension(filePath).ToLower();
            return extension switch
            {
                ".jpg" or ".jpeg" => "image/jpeg",
                ".png" => "image/png",
                ".bmp" => "image/bmp",
                ".gif" => "image/gif",
                _ => "image/jpeg"
            };
        }
    }

    // Usage example
    public class InspectionWithImagesExample
    {
        public async Task SubmitInspectionWithImages()
        {
            var config = new ApiConfig
            {
                BaseUrl = "https://your-server.com",
                MachineCode = "AOI-LINE1-01",
                ApiKey = "your-api-key"
            };

            using var client = new ApiClient(config);
            var service = new InspectionService(client, config);

            var inspection = new InspectionData
            {
                SerialNumber = "SN-20260210-001",
                ProductModel = "PCB-V2-Standard",
                BatchNumber = "BATCH-2026-002",
                OverallResult = "NG",
                InspectionTime = DateTime.UtcNow,
                CycleTime = 150.5,
                
                // Enterprise hierarchy
                CompanyCode = "COMPANY-A",
                FactoryCode = "FACTORY-HN",
                WorkshopCode = "WORKSHOP-SMT",
                LineCode = "LINE-3",
                StageCode = "STAGE-AOI",
                
                // Production context
                ProductionOrderCode = "PO-2026-0210-001",
                OperatorId = "OP-0023",
                
                Measurements = new List<MeasurementData>
                {
                    new MeasurementData
                    {
                        PointId = "POINT-001",
                        PointCode = "R1-IC1-PIN1",
                        MeasuredValue = 1023.5,
                        Result = "OK",
                        Remark = "In spec",
                        ImageBase64 = ImageHelper.ConvertImageToBase64(@"C:\Images\point_001.jpg")
                    },
                    new MeasurementData
                    {
                        PointId = "POINT-002",
                        PointCode = "R2-IC2-PIN5",
                        MeasuredValue = 0,
                        Result = "NG",
                        Remark = "Short circuit - Replace IC2",
                        ImageBase64 = ImageHelper.ConvertImageToBase64(@"C:\Images\point_002.jpg")
                    }
                }
            };

            var response = await service.SubmitInspectionAsync(inspection);
            Console.WriteLine($"Inspection ID: {response.InspectionId}");
        }
    }
}
```

---

## AOI Package Upload

### Step 1: Create ZIP Package

```csharp
using System;
using System.IO;
using System.IO.Compression;
using System.Text;
using Newtonsoft.Json;

namespace AviAoiClient.Services
{
    public class PackageBuilder
    {
        public string CreateAoiPackage(InspectionData data, string[] imagePaths, string outputPath)
        {
            try
            {
                // Create temp directory
                string tempDir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
                Directory.CreateDirectory(tempDir);
                string imagesDir = Path.Combine(tempDir, "images");
                Directory.CreateDirectory(imagesDir);

                // Create meta.json (UNIFIED STRUCTURE)
                var metaData = new
                {
                    machineCode = data.MachineCode,
                    inspectionId = $"INS-{DateTime.UtcNow:yyyyMMdd-HHmmss}",
                    
                    // Product info
                    serialNumber = data.SerialNumber,
                    productModel = data.ProductModel,
                    batchNumber = data.BatchNumber,
                    
                    // Timing
                    inspectionTime = data.InspectionTime.ToString("yyyy-MM-ddTHH:mm:ssZ"),
                    startedAt = data.InspectionTime.ToString("yyyy-MM-ddTHH:mm:ssZ"),
                    finishedAt = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ"),
                    cycleTime = data.CycleTime,
                    
                    // Enterprise hierarchy (UNIFIED)
                    companyCode = data.CompanyCode,
                    factoryCode = data.FactoryCode,
                    workshopCode = data.WorkshopCode,
                    lineCode = data.LineCode,
                    stageCode = data.StageCode,
                    
                    // Production context (UNIFIED)
                    productionOrderCode = data.ProductionOrderCode,
                    operatorId = data.OperatorId,
                    
                    // Overall result
                    overallResult = data.OverallResult,
                    
                    // Measurements (UNIFIED STRUCTURE)
                    measurements = data.Measurements.Select((m, idx) => new
                    {
                        pointId = m.PointId,
                        pointCode = m.PointCode,
                        name = m.Name ?? m.PointCode,
                        fileName = $"image_{idx + 1:D3}.jpg",
                        result = m.Result,
                        measuredValue = m.MeasuredValue,
                        unit = m.Unit,
                        remark = m.Remark
                    }).ToArray(),
                    
                    // Summary
                    summary = new
                    {
                        totalPoints = data.Measurements.Count,
                        ok = data.Measurements.Count(m => m.Result == "OK"),
                        ng = data.Measurements.Count(m => m.Result == "NG"),
                        ntf = data.Measurements.Count(m => m.Result == "NTF")
                    }
                };

                // Write meta.json
                string metaJson = JsonConvert.SerializeObject(metaData, Formatting.Indented);
                File.WriteAllText(Path.Combine(tempDir, "meta.json"), metaJson, Encoding.UTF8);

                // Copy images
                for (int i = 0; i < imagePaths.Length; i++)
                {
                    if (File.Exists(imagePaths[i]))
                    {
                        string destFileName = $"image_{i + 1:D3}.jpg";
                        File.Copy(imagePaths[i], Path.Combine(imagesDir, destFileName), true);
                    }
                }

                // Create ZIP
                if (File.Exists(outputPath))
                    File.Delete(outputPath);

                ZipFile.CreateFromDirectory(tempDir, outputPath);

                // Cleanup
                Directory.Delete(tempDir, true);

                Console.WriteLine($"✅ Package created: {outputPath}");
                return outputPath;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ Error creating package: {ex.Message}");
                throw;
            }
        }
    }
}
```

### Step 2: Upload Package

```csharp
using System;
using System.Net.Http;
using System.Threading.Tasks;
using Newtonsoft.Json;

namespace AviAoiClient.Services
{
    public class PackageUploadService
    {
        private readonly ApiClient _client;
        private readonly ApiConfig _config;

        public PackageUploadService(ApiClient client, ApiConfig config)
        {
            _client = client;
            _config = config;
        }

        public async Task<string> UploadPackageAsync(string zipFilePath)
        {
            try
            {
                // Step 1: Presign - Get upload URL
                Console.WriteLine("📝 Step 1: Getting presign URL...");
                var presignResponse = await PresignAsync();
                Console.WriteLine($"✅ Package ID: {presignResponse.PackageId}");

                // Step 2: Upload ZIP file
                Console.WriteLine("📤 Step 2: Uploading ZIP file...");
                await UploadZipAsync(presignResponse.UploadUrl, zipFilePath);
                Console.WriteLine("✅ ZIP uploaded successfully");

                // Step 3: Commit package
                Console.WriteLine("✔️ Step 3: Committing package...");
                var commitResponse = await CommitAsync(presignResponse.PackageId);
                Console.WriteLine($"✅ Inspection created. ID: {commitResponse.InspectionId}");

                return presignResponse.PackageId;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ Error uploading package: {ex.Message}");
                throw;
            }
        }

        private async Task<PresignResponse> PresignAsync()
        {
            var payload = new
            {
                apiKey = _config.ApiKey,
                machineCode = _config.MachineCode,
                inspectionId = $"INS-{DateTime.UtcNow:yyyyMMdd-HHmmss}"
            };

            var json = JsonConvert.SerializeObject(payload);
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            var response = await _client._httpClient.PostAsync(
                "/api/trpc/aoiPackage.presign",
                content
            );

            response.EnsureSuccessStatusCode();
            var responseBody = await response.Content.ReadAsStringAsync();
            var result = JsonConvert.DeserializeObject<TrpcResponse<PresignResponse>>(responseBody);

            return result.Result.Data;
        }

        private async Task UploadZipAsync(string uploadUrl, string zipFilePath)
        {
            using var fileStream = File.OpenRead(zipFilePath);
            using var content = new MultipartFormDataContent();
            content.Add(new StreamContent(fileStream), "file", Path.GetFileName(zipFilePath));

            var response = await _client._httpClient.PostAsync(uploadUrl, content);
            response.EnsureSuccessStatusCode();
        }

        private async Task<CommitResponse> CommitAsync(string packageId)
        {
            var payload = new
            {
                apiKey = _config.ApiKey,
                packageId = packageId
            };

            var json = JsonConvert.SerializeObject(payload);
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            var response = await _client._httpClient.PostAsync(
                "/api/trpc/aoiPackage.commit",
                content
            );

            response.EnsureSuccessStatusCode();
            var responseBody = await response.Content.ReadAsStringAsync();
            var result = JsonConvert.DeserializeObject<TrpcResponse<CommitResponse>>(responseBody);

            return result.Result.Data;
        }
    }

    // Response models
    public class PresignResponse
    {
        [JsonProperty("success")]
        public bool Success { get; set; }
        
        [JsonProperty("packageId")]
        public string PackageId { get; set; }
        
        [JsonProperty("uploadUrl")]
        public string UploadUrl { get; set; }
    }

    public class CommitResponse
    {
        [JsonProperty("success")]
        public bool Success { get; set; }
        
        [JsonProperty("packageId")]
        public string PackageId { get; set; }
        
        [JsonProperty("inspectionId")]
        public int InspectionId { get; set; }
        
        [JsonProperty("status")]
        public string Status { get; set; }
    }
}
```

---

## Machine Heartbeat

```csharp
using System;
using System.Threading;
using System.Threading.Tasks;

namespace AviAoiClient.Services
{
    public class HeartbeatService
    {
        private readonly ApiClient _client;
        private readonly ApiConfig _config;
        private Timer _timer;

        public HeartbeatService(ApiClient client, ApiConfig config)
        {
            _client = client;
            _config = config;
        }

        public void StartHeartbeat(int intervalSeconds = 30)
        {
            Console.WriteLine($"💓 Starting heartbeat (interval: {intervalSeconds}s)");
            
            _timer = new Timer(
                async _ => await SendHeartbeatAsync(),
                null,
                TimeSpan.Zero,
                TimeSpan.FromSeconds(intervalSeconds)
            );
        }

        public void StopHeartbeat()
        {
            _timer?.Dispose();
            Console.WriteLine("💓 Heartbeat stopped");
        }

        private async Task SendHeartbeatAsync()
        {
            try
            {
                var payload = new { apiKey = _config.ApiKey };
                var json = JsonConvert.SerializeObject(payload);
                var content = new StringContent(json, Encoding.UTF8, "application/json");

                var response = await _client._httpClient.PostAsync(
                    "/api/trpc/machineApi.heartbeat",
                    content
                );

                if (response.IsSuccessStatusCode)
                {
                    Console.WriteLine($"💚 Heartbeat OK [{DateTime.Now:HH:mm:ss}]");
                }
                else
                {
                    Console.WriteLine($"💔 Heartbeat failed: {response.StatusCode}");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"💔 Heartbeat error: {ex.Message}");
            }
        }
    }
}
```

---

## Sync Measurement Points

```csharp
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace AviAoiClient.Services
{
    public class MeasurementPointService
    {
        private readonly ApiClient _client;
        private readonly ApiConfig _config;

        public MeasurementPointService(ApiClient client, ApiConfig config)
        {
            _client = client;
            _config = config;
        }

        public async Task<SyncResponse> SyncMeasurementPointsAsync(
            string productModelCode,
            List<MeasurementPointDef> points)
        {
            try
            {
                var payload = new
                {
                    apiKey = _config.ApiKey,
                    machineCode = _config.MachineCode,
                    productModelCode = productModelCode,
                    points = points.Select(p => new
                    {
                        code = p.Code,
                        name = p.Name,
                        description = p.Description,
                        measurementType = p.MeasurementType,
                        unit = p.Unit,
                        lowerLimit = p.LowerLimit,
                        upperLimit = p.UpperLimit,
                        nominalValue = p.NominalValue,
                        positionX = p.PositionX,
                        positionY = p.PositionY,
                        radius = p.Radius,
                        cropWidth = p.CropWidth,
                        cropHeight = p.CropHeight,
                        orderIndex = p.OrderIndex,
                        isActive = p.IsActive,
                        imageBase64 = p.ImageBase64
                    }).ToArray()
                };

                var json = JsonConvert.SerializeObject(payload);
                var content = new StringContent(json, Encoding.UTF8, "application/json");

                var response = await _client._httpClient.PostAsync(
                    "/api/trpc/machineApi.syncMeasurementPoints",
                    content
                );

                response.EnsureSuccessStatusCode();
                var responseBody = await response.Content.ReadAsStringAsync();
                var result = JsonConvert.DeserializeObject<TrpcResponse<SyncResponse>>(responseBody);

                Console.WriteLine($"✅ Synced: {result.Result.Data.Created} created, {result.Result.Data.Updated} updated");
                return result.Result.Data;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ Error syncing points: {ex.Message}");
                throw;
            }
        }
    }

    public class MeasurementPointDef
    {
        public string Code { get; set; }
        public string Name { get; set; }
        public string Description { get; set; }
        public string MeasurementType { get; set; } = "VISUAL"; // DIMENSION, VISUAL, ELECTRICAL, etc.
        public string Unit { get; set; }
        public double? LowerLimit { get; set; }
        public double? UpperLimit { get; set; }
        public double? NominalValue { get; set; }
        public int PositionX { get; set; }
        public int PositionY { get; set; }
        public int? Radius { get; set; }
        public int? CropWidth { get; set; }
        public int? CropHeight { get; set; }
        public int? OrderIndex { get; set; }
        public bool IsActive { get; set; } = true;
        public string ImageBase64 { get; set; }
    }

    public class SyncResponse
    {
        [JsonProperty("success")]
        public bool Success { get; set; }
        
        [JsonProperty("created")]
        public int Created { get; set; }
        
        [JsonProperty("updated")]
        public int Updated { get; set; }
        
        [JsonProperty("failed")]
        public int Failed { get; set; }
    }
}
```

---

## Complete Examples

### Example: Full AOI Machine Integration

```csharp
using System;
using System.Threading.Tasks;

namespace AviAoiClient
{
    class Program
    {
        static async Task Main(string[] args)
        {
            // Configuration
            var config = new ApiConfig
            {
                BaseUrl = "https://your-server.com",
                MachineCode = "AOI-LINE1-01",
                ApiKey = "your-api-key-here",
                TimeoutSeconds = 60
            };

            using var client = new ApiClient(config);

            // Services
            var inspectionService = new InspectionService(client, config);
            var heartbeatService = new HeartbeatService(client, config);

            // Start heartbeat
            heartbeatService.StartHeartbeat(30);

            try
            {
                // Simulate inspection cycle
                Console.WriteLine("🔍 Starting inspection cycle...");

                var inspection = new InspectionData
                {
                    SerialNumber = $"SN-{DateTime.Now:yyyyMMdd-HHmmss}",
                    ProductModel = "PCB-V2-Standard",
                    BatchNumber = "BATCH-2026-002",
                    OverallResult = "OK",
                    InspectionTime = DateTime.UtcNow,
                    CycleTime = 150.5,
                    
                    // Enterprise hierarchy (UNIFIED STRUCTURE)
                    CompanyCode = "COMPANY-A",
                    FactoryCode = "FACTORY-HN",
                    WorkshopCode = "WORKSHOP-SMT",
                    LineCode = "LINE-3",
                    StageCode = "STAGE-AOI",
                    
                    // Production context (UNIFIED STRUCTURE)
                    ProductionOrderCode = "PO-2026-0210-001",
                    OperatorId = "OP-0023",
                    
                    Measurements = new List<MeasurementData>
                    {
                        new MeasurementData
                        {
                            PointId = "POINT-001",
                            PointCode = "R1-IC1-PIN1",
                            MeasuredValue = 1023.5,
                            Result = "OK",
                            Remark = "In spec"
                        },
                        new MeasurementData
                        {
                            PointId = "POINT-002",
                            PointCode = "CAP-C15",
                            MeasuredValue = 10.2,
                            Result = "OK",
                            Remark = "Within tolerance"
                        }
                    }
                };

                // Submit inspection
                var response = await inspectionService.SubmitInspectionAsync(inspection);
                Console.WriteLine($"✅ Inspection completed. ID: {response.InspectionId}");

                // Wait for next cycle
                Console.WriteLine("⏳ Waiting for next cycle...");
                await Task.Delay(5000);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ Error: {ex.Message}");
            }
            finally
            {
                heartbeatService.StopHeartbeat();
            }

            Console.WriteLine("Press any key to exit...");
            Console.ReadKey();
        }
    }
}
```

### Example: Batch Upload Using AOI Package

```csharp
using System;
using System.IO;
using System.Threading.Tasks;

namespace AviAoiClient.Examples
{
    public class BatchUploadExample
    {
        public async Task RunBatchUpload()
        {
            var config = new ApiConfig
            {
                BaseUrl = "https://your-server.com",
                MachineCode = "AOI-LINE1-01",
                ApiKey = "your-api-key"
            };

            using var client = new ApiClient(config);
            var packageService = new PackageUploadService(client, config);
            var packageBuilder = new PackageBuilder();

            // Simulate 10 inspections
            for (int i = 1; i <= 10; i++)
            {
                Console.WriteLine($"\n📦 Processing inspection {i}/10...");

                var inspection = new InspectionData
                {
                    SerialNumber = $"SN-2026-{i:D4}",
                    ProductModel = "PCB-V2-Standard",
                    BatchNumber = "BATCH-2026-002",
                    OverallResult = i % 5 == 0 ? "NG" : "OK", // Every 5th is NG
                    InspectionTime = DateTime.UtcNow.AddMinutes(-i),
                    CycleTime = 150.5 + i,
                    
                    CompanyCode = "COMPANY-A",
                    FactoryCode = "FACTORY-HN",
                    WorkshopCode = "WORKSHOP-SMT",
                    LineCode = "LINE-3",
                    StageCode = "STAGE-AOI",
                    
                    ProductionOrderCode = "PO-2026-0210-001",
                    OperatorId = "OP-0023",
                    
                    Measurements = new List<MeasurementData>
                    {
                        new MeasurementData
                        {
                            PointId = $"POINT-{i:D3}-001",
                            PointCode = "R1",
                            MeasuredValue = 1000 + i,
                            Result = "OK"
                        }
                    }
                };

                // Create package
                string[] images = { @"C:\Images\sample.jpg" };
                string packagePath = Path.Combine(Path.GetTempPath(), $"package_{i}.zip");
                
                packageBuilder.CreateAoiPackage(inspection, images, packagePath);

                // Upload
                await packageService.UploadPackageAsync(packagePath);

                // Cleanup
                File.Delete(packagePath);

                Console.WriteLine($"✅ Inspection {i} completed");
                await Task.Delay(1000); // Throttle
            }

            Console.WriteLine("\n🎉 All inspections uploaded successfully!");
        }
    }
}
```

---

## Error Handling

```csharp
using System;
using System.Net;
using System.Net.Http;

namespace AviAoiClient.Helpers
{
    public static class ErrorHandler
    {
        public static void HandleApiError(HttpResponseMessage response)
        {
            switch (response.StatusCode)
            {
                case HttpStatusCode.Unauthorized:
                    throw new Exception("Invalid API key or machine code");
                
                case HttpStatusCode.Forbidden:
                    throw new Exception("Access denied. Check permissions.");
                
                case HttpStatusCode.NotFound:
                    throw new Exception("Resource not found");
                
                case HttpStatusCode.BadRequest:
                    throw new Exception("Invalid request data");
                
                case HttpStatusCode.TooManyRequests:
                    throw new Exception("Rate limit exceeded. Please retry later.");
                
                case HttpStatusCode.InternalServerError:
                    throw new Exception("Server error. Contact support.");
                
                default:
                    throw new Exception($"Unexpected error: {response.StatusCode}");
            }
        }
    }
}
```

---

## Rate Limiting & Best Practices

```csharp
using System;
using System.Threading;
using System.Threading.Tasks;

namespace AviAoiClient.Helpers
{
    public class RateLimiter
    {
        private readonly SemaphoreSlim _semaphore;
        private readonly int _requestsPerMinute;
        private readonly Queue<DateTime> _requestTimestamps = new();

        public RateLimiter(int requestsPerMinute = 1000)
        {
            _requestsPerMinute = requestsPerMinute;
            _semaphore = new SemaphoreSlim(1, 1);
        }

        public async Task WaitAsync()
        {
            await _semaphore.WaitAsync();
            try
            {
                var now = DateTime.UtcNow;
                var cutoff = now.AddMinutes(-1);

                // Remove old timestamps
                while (_requestTimestamps.Count > 0 && _requestTimestamps.Peek() < cutoff)
                {
                    _requestTimestamps.Dequeue();
                }

                // Wait if rate limit exceeded
                if (_requestTimestamps.Count >= _requestsPerMinute)
                {
                    var oldestTimestamp = _requestTimestamps.Peek();
                    var waitTime = oldestTimestamp.AddMinutes(1) - now;
                    if (waitTime > TimeSpan.Zero)
                    {
                        Console.WriteLine($"⏸️ Rate limit reached. Waiting {waitTime.TotalSeconds:F1}s...");
                        await Task.Delay(waitTime);
                    }
                }

                _requestTimestamps.Enqueue(now);
            }
            finally
            {
                _semaphore.Release();
            }
        }
    }
}
```

---

## See Also

- [UNIFIED_API_STRUCTURE.md](../UNIFIED_API_STRUCTURE.md) - API structure details
- [API_REFERENCE.md](../API_REFERENCE.md) - Complete API documentation
- [Python_API_Examples.md](./Python_API_Examples.md) - Python examples
- [JavaScript_API_Examples.md](./JavaScript_API_Examples.md) - JavaScript/TypeScript examples

---

**Last Updated:** February 10, 2026  
**Version:** 2.0 (Unified Structure)
