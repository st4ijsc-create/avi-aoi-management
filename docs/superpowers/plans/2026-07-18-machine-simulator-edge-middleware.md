# ST4I Machine Simulator Studio → Edge Middleware — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a professional, exhibition-grade C# WPF (.NET 10) application that simulates ALL internal ST4I machines (automation, IoT, AOI/AVI) talking to the platform over the doc-61 live-proven API, architected as an edge-gateway pipeline (south-side `IDeviceDriver` → `Normalizer` → north-side `ITransport`) so it can evolve into production middleware, with two real proof drivers (Hot-folder AOI doc-28 + MQTT).

**Architecture:** A shared class library `St4i.EdgeCore` holds the whole pipeline (drivers, normalizer, transports, resilience) and links the existing `St4iDeviceClient.cs` SDK for the north side. A WPF app (`St4iMachineSimulator`, MVVM) and a headless service seam (`St4i.EdgeService`) both consume EdgeCore. Transport is dual-mode: `LiveTransport` (real HTTP), `DemoTransport` (offline fabricator), `AutoTransport` (live→demo fallback).

**Tech Stack:** .NET 10 (`net10.0-windows`), WPF, CommunityToolkit.Mvvm, LiveChartsCore.SkiaSharpView.WPF, MQTTnet (+ MQTTnet.Server), xUnit. Reuses `examples/device-client/csharp/St4iDeviceClient.cs` (linked, extended additively).

## Global Constraints

- **Scope = client/edge only.** Do NOT modify `server/`, `client/`, or `drizzle/`. The ONLY change outside `tools/machine-simulator/` is an **additive** method added to `examples/device-client/csharp/St4iDeviceClient.cs` (all existing callers must still compile).
- **TFM:** `net10.0-windows` for all projects (SDK 10.0.300 + WindowsDesktop 10.0.8 installed). `EdgeCore` uses DPAPI `ProtectedData` (Windows-only) → windows TFM required.
- **Contract fidelity (doc 61 §4.8, verified live):** `stationId` is a **number** (string → 400); replay returns `duplicate:true` (NOT `idempotent`); `metrics[].value` is **number-only**; `ts` must carry an explicit UTC offset (or be omitted); unknown top-level fields are stripped; all payload errors collapse to `400 ingest_failed`.
- **Resilience (doc 61 §8):** stable `idempotencyKey` = `<machineCode>:<recipeCode>:<cycleCounter>`; retry ONLY on 429/5xx/network; 4xx (400/401/403/409) are permanent; store-and-forward queue for lost network.
- **Determinism:** NO `DateTime.Now`/`Math.Random`-seeded-by-time in simulation value generation logic — seed `Random` with a fixed per-machine seed so cycles are reproducible. (Timestamps for `ts` DO use `DateTimeOffset.Now` — that is the wire timestamp, not simulation state.)
- **WPF threading (doc 61 §11.4):** drivers/transports/heartbeat run on background `Task`/`PeriodicTimer` + `CancellationToken`; UI updates via `Dispatcher`; never `.Result`/`.Wait()` on the UI thread; one `St4iDeviceClient` instance per machine (singleton), reused.
- **Bilingual:** all user-facing strings via `ResourceDictionary` (vi default, en). No hardcoded UI copy.
- **Endpoints (doc 61 §13):** RESULT `POST /api/v1/ingest/process-result` (201) · TELEMETRY `POST /api/v1/ingest/telemetry` (202) · INSPECTION `POST /api/v1/ingest/inspection` (201) · config-sync `/api/machine/config-sync/{check,get,ack}` · heartbeat `POST /api/machine/heartbeat` (X-API-Key, not Bearer) · onboarding `register`→`config`→`claim`/`enroll`.

---

## File Structure

```
tools/machine-simulator/
  St4iMachineSimulator.sln
  fleet.json                         # default ~10-12 machine fleet
  mapping/                           # MappingProfile presets per machine class
    screwdrive.json  dispensing.json  welder.json  iot-sensor.json  aoi.json  hotfolder-aoi.json  mqtt-iot.json
  README.md                          # vi/en, build+run+publish
  src/
    St4i.EdgeCore/
      St4i.EdgeCore.csproj           # net10.0-windows, links St4iDeviceClient.cs
      Sdk/                           # <Compile Include=..\..\..\examples\device-client\csharp\St4iDeviceClient.cs Link>
      Models/
        Enums.cs                     # ReadingKind, DriverKind, DeviceClass, TransportMode, DriverHealthState, Verdict
        DeviceReading.cs             # raw reading + payload variants
        Envelopes.cs                 # ProcessResultEnvelope, TelemetryBatch, InspectionDocument, CanonicalEnvelope
        TransportAck.cs              # TransportAck, HeartbeatResult, ConfigSyncResult
        MachineDescriptor.cs
      Mapping/
        MappingProfile.cs            # JSON-loadable field/tag mapping
        Normalizer.cs                # DeviceReading -> CanonicalEnvelope
      Transport/
        ITransport.cs
        LiveTransport.cs             # wraps St4iDeviceClient
        DemoTransport.cs             # offline fabricator
        AutoTransport.cs             # live->demo fallback
      Drivers/
        IDeviceDriver.cs
        SimulatedDriver.cs
        Simulators/                  # IMachineSimulator + one per class
          IMachineSimulator.cs  ScrewdriveSim.cs  DispensingSim.cs  WelderSim.cs
          AssemblySim.cs  LeakTestSim.cs  FunctionalTestSim.cs  IotSensorSim.cs  AoiInspectorSim.cs
        HotFolder/
          Doc28Parser.cs             # JSON/CSV/XML per doc 28
          Doc28Writer.cs             # simulated AOI -> real .st4i.json (atomic write)
          HotFolderAoiDriver.cs
        Mqtt/
          MqttDriver.cs
          InProcessBroker.cs         # optional MQTTnet.Server for self-contained demo
      Infrastructure/
        CredentialStore.cs           # DPAPI ProtectedData
        FleetConfig.cs               # fleet.json loader
        ResilienceProbe.cs           # ping /api/v1/openapi.json
        EventBus.cs                  # in-proc pub/sub (Channel)
        ApiTraceEvent.cs             # request/response record for Inspector
      Engine/
        EdgePipeline.cs              # wires driver -> normalizer -> transport, drives cycle loop
    St4iMachineSimulator/            # WPF app (net10.0-windows, UseWPF)
      St4iMachineSimulator.csproj
      App.xaml / App.xaml.cs         # DI composition root
      Themes/  Dark.xaml  Colors.xaml
      i18n/  Strings.vi.xaml  Strings.en.xaml
      Assets/  logo.png  icon.ico  splash
      Views/  ShellView  DashboardView  MachineDetailView  OnboardingView  ApiInspectorView  ScenarioView  SettingsView
      ViewModels/  AppShellViewModel  FleetViewModel  MachineViewModel  KpiViewModel
                   OnboardingViewModel  InspectorViewModel  ScenarioViewModel  SettingsViewModel
      Controls/  StatusLight  BoardView (bbox overlay)  KpiTile
    St4i.EdgeService/
      St4i.EdgeService.csproj        # net10.0-windows, Microsoft.Extensions.Hosting
      Program.cs  EdgeWorker.cs
  tests/
    St4i.EdgeCore.Tests/
      St4i.EdgeCore.Tests.csproj     # xUnit
      NormalizerTests.cs  DemoTransportTests.cs  LiveTransportTests.cs  AutoTransportTests.cs
      Doc28ParserTests.cs  SimulatorTests.cs  HotFolderDriverTests.cs  MqttDriverTests.cs
      CredentialStoreTests.cs  SdkInspectionTests.cs
      Fakes/  CapturingHandler.cs    # HttpMessageHandler stub
```

**Decomposition rationale:** split by responsibility. Each driver is isolated (add a new protocol = new file under `Drivers/`, no pipeline edits). Transports isolated behind `ITransport`. UI ViewModels hold logic (testable) separate from XAML Views (build/smoke). EdgeCore has zero WPF dependency so the Service reuses it.

**Verification note:** EdgeCore logic tasks are TDD (xUnit, using `CapturingHandler` to mock HTTP — the SDK constructor accepts an `HttpMessageHandler`). WPF View tasks are verified by `dotnet build` + a scripted **smoke run in Demo mode** (no server needed); their ViewModels are unit-tested where they carry logic.

---

## Task 1: Solution scaffold + all projects build green

**Files:**
- Create: `tools/machine-simulator/St4iMachineSimulator.sln`
- Create: `tools/machine-simulator/src/St4i.EdgeCore/St4i.EdgeCore.csproj`
- Create: `tools/machine-simulator/src/St4iMachineSimulator/St4iMachineSimulator.csproj` (+ minimal `App.xaml`/`App.xaml.cs`/`MainWindow`)
- Create: `tools/machine-simulator/src/St4i.EdgeService/St4i.EdgeService.csproj` (+ minimal `Program.cs`)
- Create: `tools/machine-simulator/tests/St4i.EdgeCore.Tests/St4i.EdgeCore.Tests.csproj` (+ `SanityTest.cs`)
- Create: `tools/machine-simulator/.gitignore` (`bin/`, `obj/`, `publish/`)

**Interfaces:**
- Produces: a buildable 4-project solution; `EdgeCore` links the SDK file and exposes namespace `St4i.EdgeCore`; SDK namespace `St4i.DeviceClient` available to all.

- [ ] **Step 1: Create `St4i.EdgeCore.csproj`** (links the SDK, references NuGet)

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0-windows</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <LangVersion>latest</LangVersion>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="..\..\..\..\examples\device-client\csharp\St4iDeviceClient.cs" Link="Sdk\St4iDeviceClient.cs" />
  </ItemGroup>
  <ItemGroup>
    <PackageReference Include="MQTTnet" Version="4.3.7.1207" />
    <PackageReference Include="MQTTnet.Server" Version="4.3.7.1207" />
  </ItemGroup>
</Project>
```
> Note: the SDK links from `tools/machine-simulator/src/St4i.EdgeCore/` up to repo-root `examples/` — that is four `..` segments. Verify the relative path resolves after creating the folder.

- [ ] **Step 2: Create WPF app csproj + minimal shell**

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>net10.0-windows</TargetFramework>
    <UseWPF>true</UseWPF>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <RuntimeIdentifier>win-x64</RuntimeIdentifier>
    <ApplicationIcon>Assets\icon.ico</ApplicationIcon>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="..\St4i.EdgeCore\St4i.EdgeCore.csproj" />
    <PackageReference Include="CommunityToolkit.Mvvm" Version="8.4.0" />
    <PackageReference Include="LiveChartsCore.SkiaSharpView.WPF" Version="2.0.0-rc5.4" />
  </ItemGroup>
</Project>
```
Add a minimal `App.xaml` (Application with `StartupUri="MainWindow.xaml"`) and a `MainWindow.xaml` with a single `TextBlock Text="ST4I Machine Simulator Studio"` so it builds. Provide a placeholder `Assets/icon.ico` (any valid .ico) or remove `<ApplicationIcon>` until Task 19.

- [ ] **Step 3: Create Service + Tests csproj**

Service `St4i.EdgeService.csproj`: `net10.0-windows`, `<OutputType>Exe</OutputType>`, PackageReference `Microsoft.Extensions.Hosting` (9.0.x), ProjectReference EdgeCore, minimal `Program.cs` (`Console.WriteLine("EdgeService seam");`).
Tests `St4i.EdgeCore.Tests.csproj`: `net10.0-windows`, PackageReferences `Microsoft.NET.Test.Sdk` (17.x), `xunit` (2.9.x), `xunit.runner.visualstudio` (2.8.x), ProjectReference EdgeCore. Add `SanityTest.cs`:

```csharp
public class SanityTest { [Xunit.Fact] public void True_is_true() => Xunit.Assert.True(true); }
```

- [ ] **Step 4: Create the solution and add all projects**

Run (from `tools/machine-simulator/`):
```
dotnet new sln -n St4iMachineSimulator
dotnet sln add src/St4i.EdgeCore/St4i.EdgeCore.csproj src/St4iMachineSimulator/St4iMachineSimulator.csproj src/St4i.EdgeService/St4i.EdgeService.csproj tests/St4i.EdgeCore.Tests/St4i.EdgeCore.Tests.csproj
```

- [ ] **Step 5: Build + test to verify green**

Run: `dotnet build tools/machine-simulator/St4iMachineSimulator.sln -c Debug`
Expected: `Build succeeded. 0 Error(s)`.
Run: `dotnet test tools/machine-simulator/tests/St4i.EdgeCore.Tests/St4i.EdgeCore.Tests.csproj`
Expected: `Passed! - 1` test.
> If any NuGet version 404s, run `dotnet add package <name>` to let NuGet pick the latest stable and record the resolved version.

- [ ] **Step 6: Commit**

```
git add tools/machine-simulator
git commit -m "chore(sim): scaffold St4iMachineSimulator solution (EdgeCore+WPF+Service+tests) — build green"
```

---

## Task 2: Extend SDK with `SubmitInspectionAsync` (additive)

**Files:**
- Modify: `examples/device-client/csharp/St4iDeviceClient.cs` (add DTO + method; reuse `SendWithRetryAsync`)
- Test: `tools/machine-simulator/tests/St4i.EdgeCore.Tests/SdkInspectionTests.cs`
- Test helper: `tools/machine-simulator/tests/St4i.EdgeCore.Tests/Fakes/CapturingHandler.cs`

**Interfaces:**
- Consumes: existing `St4iDeviceClient(serverUrl, mkKey, ..., HttpMessageHandler handler)` ctor; private `SendWithRetryAsync(kind, path, payload, ct)`.
- Produces: `class MeasurementPoint { PointCode, MeasuredValue?, Result("OK"/"NG"/"NTF"), DefectCatalogCode?, DefectSeverity?, Unit?, ValueHeight?...ValueZ?, ImageBase64? }`; method `Task<InspectionAck> SubmitInspectionAsync(string serialNumber, string overallResult, IEnumerable<MeasurementPoint> measurements, string? productModel=null, string? variantCode=null, string? idempotencyKey=null, string? ts=null, string? panelId=null, int? boardIndex=null, string? inspectionTime=null, CancellationToken ct=default)`; `class InspectionAck { bool Success; long? InspectionId; bool Duplicate; bool Queued; }`.

- [ ] **Step 1: Write the failing test** (`CapturingHandler.cs` + `SdkInspectionTests.cs`)

`CapturingHandler.cs`:
```csharp
using System.Net;
using System.Net.Http;
namespace St4i.EdgeCore.Tests.Fakes;
public sealed class CapturingHandler : HttpMessageHandler
{
    public HttpRequestMessage? LastRequest; public string? LastBody;
    public Func<HttpRequestMessage,string,(HttpStatusCode,string)> Responder =
        (_, _) => (HttpStatusCode.Created, "{\"ok\":true,\"data\":{\"success\":true,\"inspectionId\":501}}");
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage req, CancellationToken ct)
    {
        LastRequest = req; LastBody = req.Content is null ? null : await req.Content.ReadAsStringAsync(ct);
        var (code, body) = Responder(req, LastBody ?? "");
        return new HttpResponseMessage(code){ Content = new StringContent(body) };
    }
}
```
`SdkInspectionTests.cs`:
```csharp
using St4i.DeviceClient; using St4i.EdgeCore.Tests.Fakes; using Xunit;
public class SdkInspectionTests
{
    [Fact] public async Task SubmitInspection_posts_to_ingest_inspection_and_parses_id()
    {
        var h = new CapturingHandler();
        using var c = new St4iDeviceClient("http://x", mkKey:"mk_test", machineCode:"AOI-01", handler:h);
        var ack = await c.SubmitInspectionAsync("SN-1","NG",
            new[]{ new MeasurementPoint{ PointCode="R12", Result="NG", DefectCatalogCode="INSUFFICIENT_SOLDER" } },
            productModel:"MB-X1-TOP", idempotencyKey:"AOI-01:MB-X1-TOP:000001");
        Assert.True(ack.Success); Assert.Equal(501, ack.InspectionId);
        Assert.EndsWith("/api/v1/ingest/inspection", h.LastRequest!.RequestUri!.ToString());
        Assert.Contains("\"overallResult\":\"NG\"", h.LastBody);
        Assert.Contains("\"pointCode\":\"R12\"", h.LastBody);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tools/machine-simulator/tests/St4i.EdgeCore.Tests --filter SubmitInspection_posts_to_ingest_inspection_and_parses_id`
Expected: FAIL — `MeasurementPoint`/`SubmitInspectionAsync` not defined.

- [ ] **Step 3: Add the DTO + method to `St4iDeviceClient.cs`**

After the `Sample` DTO add:
```csharp
public class MeasurementPoint
{
    [JsonPropertyName("pointCode")] public string PointCode { get; set; }
    [JsonPropertyName("measuredValue")] public double? MeasuredValue { get; set; }
    [JsonPropertyName("result")] public string Result { get; set; }  // OK|NG|NTF
    [JsonPropertyName("unit")] public string Unit { get; set; }
    [JsonPropertyName("defectCatalogCode")] public string DefectCatalogCode { get; set; }
    [JsonPropertyName("defectSeverity")] public string DefectSeverity { get; set; } // critical|major|minor|cosmetic
    [JsonPropertyName("valueHeight")] public double? ValueHeight { get; set; }
    [JsonPropertyName("valueArea")] public double? ValueArea { get; set; }
    [JsonPropertyName("valueVolume")] public double? ValueVolume { get; set; }
    [JsonPropertyName("valueVoidPct")] public double? ValueVoidPct { get; set; }
    [JsonPropertyName("valueCoplanarity")] public double? ValueCoplanarity { get; set; }
    [JsonPropertyName("valueWarpage")] public double? ValueWarpage { get; set; }
    [JsonPropertyName("valueOffsetX")] public double? ValueOffsetX { get; set; }
    [JsonPropertyName("valueOffsetY")] public double? ValueOffsetY { get; set; }
    [JsonPropertyName("valueTilt")] public double? ValueTilt { get; set; }
    [JsonPropertyName("valueThickness")] public double? ValueThickness { get; set; }
    [JsonPropertyName("valueZ")] public double? ValueZ { get; set; }
    [JsonPropertyName("imageBase64")] public string ImageBase64 { get; set; }
}
public class InspectionAck { public bool Success; public long? InspectionId; public bool Duplicate; public bool Queued; }
```
Add the method inside the class (mirrors `SubmitProcessResultAsync`, but INSPECTION endpoint + `overallResult` OK/NG/NTF):
```csharp
public async Task<InspectionAck> SubmitInspectionAsync(
    string serialNumber, string overallResult, IEnumerable<MeasurementPoint> measurements,
    string productModel = null, string variantCode = null, string idempotencyKey = null,
    string ts = null, string panelId = null, int? boardIndex = null, string inspectionTime = null,
    string machineCode = null, CancellationToken ct = default)
{
    overallResult = (overallResult ?? "").Trim().ToUpperInvariant();
    if (overallResult != "OK" && overallResult != "NG" && overallResult != "NTF")
        throw new St4iConfigException($"overallResult phải OK|NG|NTF, nhận '{overallResult}'");
    string mc = machineCode ?? MachineCode;
    var payload = new Dictionary<string, object>
    {
        ["schemaVersion"] = "1.1",
        ["serialNumber"] = serialNumber,
        ["overallResult"] = overallResult,
        ["inspectionTime"] = inspectionTime ?? ts ?? IsoNow(),
        ["measurements"] = measurements.ToList(),
    };
    if (!string.IsNullOrEmpty(mc)) payload["machineCode"] = mc;
    if (!string.IsNullOrEmpty(productModel)) payload["productModel"] = productModel;
    if (!string.IsNullOrEmpty(variantCode)) payload["variantCode"] = variantCode;
    if (!string.IsNullOrEmpty(idempotencyKey)) payload["idempotencyKey"] = idempotencyKey;
    if (!string.IsNullOrEmpty(panelId)) payload["panelId"] = panelId;
    if (boardIndex.HasValue) payload["boardIndex"] = boardIndex.Value;

    var data = await SendWithRetryAsync("inspection", "/api/v1/ingest/inspection", payload, ct).ConfigureAwait(false);
    return new InspectionAck
    {
        Success = GetBool(data, "success"),
        InspectionId = TryGet(data, "inspectionId", out var id) && id.ValueKind == JsonValueKind.Number ? id.GetInt64() : (long?)null,
        Duplicate = GetBool(data, "duplicate"),
        Queued = GetBool(data, "queued"),
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `dotnet test tools/machine-simulator/tests/St4i.EdgeCore.Tests --filter SubmitInspection_posts_to_ingest_inspection_and_parses_id`
Expected: PASS.

- [ ] **Step 5: Verify existing SDK consumers still compile**

Run: `dotnet build examples/device-client/csharp/ExampleScrewdriver.csproj -c Debug`
Expected: `Build succeeded` (additive change, no signature broke).

- [ ] **Step 6: Commit**

```
git add examples/device-client/csharp/St4iDeviceClient.cs tools/machine-simulator/tests
git commit -m "feat(sdk): add SubmitInspectionAsync (AOI/AVI doc28 v1.1) — additive, existing callers unchanged"
```

---

## Task 3: Canonical models (enums, DeviceReading, envelopes, ack, descriptor)

**Files:**
- Create: `src/St4i.EdgeCore/Models/Enums.cs`, `Models/DeviceReading.cs`, `Models/Envelopes.cs`, `Models/TransportAck.cs`, `Models/MachineDescriptor.cs`
- Test: `tests/St4i.EdgeCore.Tests/` (compile-only; no behavior yet — a `[Fact]` constructing each type)

**Interfaces:**
- Produces (exact names later tasks depend on):
  - `enum ReadingKind { ProcessResult, Telemetry, Inspection }`
  - `enum DriverKind { Simulated, HotFolderAoi, Mqtt }`
  - `enum DeviceClass { Automation, Iot, AoiAvi }`
  - `enum TransportMode { Live, Demo, Auto }`
  - `enum DriverHealthState { Connected, Degraded, Down }`
  - `enum Verdict { Pass, Warn, Fail, Skip }`
  - `record MetricSample(string Name, double Value, string? Unit=null, double? Lsl=null, double? Usl=null, double? Nominal=null)`
  - `record WaveformSeries(string Name, string? Unit, double? RateHz, IReadOnlyList<double[]> Samples)`
  - `record MeasurementResult(string PointCode, string Result, double? MeasuredValue=null, string? DefectCatalogCode=null, string? DefectSeverity=null, string? Unit=null, Bbox? Bbox=null, Values3d? Values3d=null)`
  - `record Bbox(int X,int Y,int W,int H)`, `record Values3d(double? HeightUm=null, double? AreaPct=null, double? VolumePct=null, double? VoidPct=null, double? CoplanarityUm=null, double? WarpageUm=null, double? OffsetXUm=null, double? OffsetYUm=null, double? TiltDeg=null, double? ThicknessUm=null, double? ZUm=null)`
  - `class DeviceReading { string MachineCode; ReadingKind Kind; string SerialNumber; string? StepType; Verdict Verdict; string? RecipeCode; string? RecipeVersion; List<MetricSample> Metrics; List<WaveformSeries> Waveforms; List<MeasurementResult> Measurements; List<TelemetrySample> Telemetry; long CycleCounter; DateTimeOffset Timestamp; Dictionary<string,object>? Genealogy; }`
  - `record TelemetrySample(string Metric, object? Value, string? Unit=null, string Quality="good")`
  - `record CanonicalEnvelope(ReadingKind Kind, string MachineCode, string Path, Dictionary<string,object> Payload, string IdempotencyKey)`
  - `record TransportAck(bool Success, long? Id=null, bool Duplicate=false, bool Queued=false, int Accepted=0, int HttpStatus=0, long LatencyMs=0, string? RawBody=null, string? Error=null)`
  - `record HeartbeatResult(bool Success, long? MachineId, string? KeyStatus, int? KeyExpiresInDays)`
  - `record ConfigSyncResult(bool Changed, string? Version, string? DriftState, bool Applied=true)`
  - `record MachineDescriptor(string Code, string SerialSeed, DeviceClass DeviceClass, string MachineType, string? StepType, DriverKind DriverKind, string? RecipeCode, string? MappingProfile, double CycleSeconds)`

- [ ] **Step 1: Write a compile smoke test**

```csharp
using St4i.EdgeCore.Models; using Xunit;
public class ModelsTests {
  [Fact] public void Can_build_a_process_reading() {
    var r = new DeviceReading { MachineCode="SCRW-01", Kind=ReadingKind.ProcessResult,
      SerialNumber="SN1", StepType="screw_tightening", Verdict=Verdict.Pass,
      Metrics=new(){ new MetricSample("torque",12.1,"Nm",10.5,13.5,12.0) }, CycleCounter=1 };
    Assert.Equal(ReadingKind.ProcessResult, r.Kind);
    Assert.Single(r.Metrics);
  }
}
```

- [ ] **Step 2: Run to verify it fails** — `dotnet test ... --filter Can_build_a_process_reading` → FAIL (types missing).
- [ ] **Step 3: Create all five model files** with the exact type definitions from the Interfaces block above (namespace `St4i.EdgeCore.Models`). Initialize collection properties to `new()` so they are never null.
- [ ] **Step 4: Run to verify it passes** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(edgecore): canonical models (readings, envelopes, ack, descriptor)"`

---

## Task 4: MappingProfile + Normalizer (DeviceReading → CanonicalEnvelope)

**Files:**
- Create: `src/St4i.EdgeCore/Mapping/MappingProfile.cs`, `Mapping/Normalizer.cs`
- Test: `tests/St4i.EdgeCore.Tests/NormalizerTests.cs`

**Interfaces:**
- Consumes: Task 3 models.
- Produces:
  - `class MappingProfile { string Name; string DeviceClass; string? DefaultStepType; string? DefaultRecipeCode; Dictionary<string,string> UnitMap; static MappingProfile FromJson(string json); static MappingProfile ForClass(DeviceClass c); }`
  - `static class Normalizer { CanonicalEnvelope Normalize(DeviceReading r, MappingProfile p); static string BuildIdempotencyKey(DeviceReading r); }`
- **Key rules:** `BuildIdempotencyKey` = `$"{r.MachineCode}:{r.RecipeCode ?? r.StepType ?? "cycle"}:{r.CycleCounter:D6}"` (≥8 chars guaranteed). ProcessResult → path `/api/v1/ingest/process-result`, payload uses `result` lowercased, `ts` = `r.Timestamp.ToString("yyyy-MM-dd'T'HH:mm:ss.fffzzz")`, `metrics[].value` numeric, `stationId` (if present in Genealogy) coerced to number. Telemetry → `/api/v1/ingest/telemetry`, `{samples:[{deviceId=MachineCode, metric, value, unit, quality, ts}]}`. Inspection → `/api/v1/ingest/inspection`, `overallResult` UPPER, measurements mapped to `pointCode/measuredValue/result/defectCatalogCode/valueHeight...`.

- [ ] **Step 1: Write failing tests**

```csharp
using St4i.EdgeCore.Models; using St4i.EdgeCore.Mapping; using Xunit;
public class NormalizerTests {
  [Fact] public void IdempotencyKey_is_stable_and_min_8() {
    var r = new DeviceReading{ MachineCode="SCRW-01", RecipeCode="RC1", CycleCounter=1, Kind=ReadingKind.ProcessResult, SerialNumber="SN1", StepType="screw_tightening" };
    var k = Normalizer.BuildIdempotencyKey(r);
    Assert.Equal("SCRW-01:RC1:000001", k);
    Assert.True(k.Length >= 8);
  }
  [Fact] public void Process_reading_maps_to_process_result_path_with_numeric_value() {
    var r = new DeviceReading{ MachineCode="SCRW-01", Kind=ReadingKind.ProcessResult, SerialNumber="SN1",
      StepType="screw_tightening", Verdict=Verdict.Pass, RecipeCode="RC1", CycleCounter=2,
      Timestamp=DateTimeOffset.Parse("2026-07-18T10:00:00+07:00"),
      Metrics=new(){ new MetricSample("torque",12.1,"Nm",10.5,13.5,12.0) } };
    var env = Normalizer.Normalize(r, MappingProfile.ForClass(DeviceClass.Automation));
    Assert.Equal("/api/v1/ingest/process-result", env.Path);
    Assert.Equal(ReadingKind.ProcessResult, env.Kind);
    Assert.Equal("pass", env.Payload["result"]);
    var metrics = (System.Collections.IEnumerable)env.Payload["metrics"];
    Assert.NotNull(metrics);
  }
  [Fact] public void Inspection_reading_uppercases_overallResult() {
    var r = new DeviceReading{ MachineCode="AOI-01", Kind=ReadingKind.Inspection, SerialNumber="SN1",
      Verdict=Verdict.Fail, CycleCounter=1, Timestamp=DateTimeOffset.Parse("2026-07-18T10:00:00+07:00"),
      Measurements=new(){ new MeasurementResult("R12","NG",DefectCatalogCode:"BRIDGING") } };
    var env = Normalizer.Normalize(r, MappingProfile.ForClass(DeviceClass.AoiAvi));
    Assert.Equal("/api/v1/ingest/inspection", env.Path);
    Assert.Equal("NG", env.Payload["overallResult"]);
  }
}
```

- [ ] **Step 2: Run to verify they fail** → FAIL (types missing).
- [ ] **Step 3: Implement `MappingProfile` + `Normalizer`** per the Key rules above. `MappingProfile.ForClass` returns a sane default profile per class (Automation/Iot/AoiAvi). Verdict→string map: Pass→"pass", Warn→"warn", Fail→"fail", Skip→"skip".
- [ ] **Step 4: Run to verify they pass** → 3 PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(edgecore): MappingProfile + Normalizer (stable idempotency, contract-correct payloads)"`

---

## Task 5: `ITransport` + `DemoTransport` (offline fabricator)

**Files:**
- Create: `src/St4i.EdgeCore/Transport/ITransport.cs`, `Transport/DemoTransport.cs`
- Test: `tests/St4i.EdgeCore.Tests/DemoTransportTests.cs`

**Interfaces:**
- Consumes: Task 3/4 (`CanonicalEnvelope`, `TransportAck`, `HeartbeatResult`, `ConfigSyncResult`).
- Produces:
  - `interface ITransport { TransportMode Mode { get; } Task<TransportAck> SendAsync(CanonicalEnvelope env, CancellationToken ct); Task<HeartbeatResult> HeartbeatAsync(string machineCode, CancellationToken ct); Task<ConfigSyncResult> SyncConfigAsync(string machineCode, string configKind, string? cachedVersion, CancellationToken ct); }`
  - `class DemoTransport : ITransport` with ctor `(double latencyMs=40, double fakeErrorRate=0.0)`.
- **Behavior:** ProcessResult → `Success, Id=<incrementing>`; if `(machineCode, idempotencyKey)` already seen → same Id + `Duplicate=true`. Telemetry → `Accepted=received count` (parse `samples`), `HttpStatus=202`. Inspection → `Id=<incrementing inspectionId>`, dedup by idempotencyKey. Honors `fakeErrorRate` by returning `Queued=true, Success=true` (simulates store-and-forward) deterministically by hashing the idempotencyKey (NOT random-by-time).

- [ ] **Step 1: Write failing tests**

```csharp
using St4i.EdgeCore.Models; using St4i.EdgeCore.Transport; using St4i.EdgeCore.Mapping; using Xunit;
public class DemoTransportTests {
  static CanonicalEnvelope Proc(string key)=> new(ReadingKind.ProcessResult,"SCRW-01","/api/v1/ingest/process-result",
     new(){["result"]="pass",["idempotencyKey"]=key}, key);
  [Fact] public async Task First_send_gets_id_replay_is_duplicate() {
    var t = new DemoTransport(latencyMs:0);
    var a = await t.SendAsync(Proc("SCRW-01:RC1:000001"), default);
    var b = await t.SendAsync(Proc("SCRW-01:RC1:000001"), default);
    Assert.True(a.Success); Assert.NotNull(a.Id);
    Assert.Equal(a.Id, b.Id); Assert.True(b.Duplicate);
  }
  [Fact] public async Task Telemetry_accepts_all_samples() {
    var t = new DemoTransport(latencyMs:0);
    var env = new CanonicalEnvelope(ReadingKind.Telemetry,"ESP-01","/api/v1/ingest/telemetry",
       new(){["samples"]=new List<object>{ new{}, new{} }}, "ESP-01:t:1");
    var a = await t.SendAsync(env, default);
    Assert.Equal(2, a.Accepted); Assert.Equal(202, a.HttpStatus);
  }
}
```

- [ ] **Step 2: Run to verify fail** → FAIL.
- [ ] **Step 3: Implement `ITransport` + `DemoTransport`** (in-memory `Dictionary<string,long>` for dedup; `Interlocked`-incremented counters; `await Task.Delay((int)latencyMs, ct)` when >0).
- [ ] **Step 4: Run to verify pass** → 2 PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(edgecore): ITransport + DemoTransport (offline fabricator, dedup, queued sim)"`

---

## Task 6: `LiveTransport` (wraps St4iDeviceClient, mock-HTTP tested)

**Files:**
- Create: `src/St4i.EdgeCore/Transport/LiveTransport.cs`
- Test: `tests/St4i.EdgeCore.Tests/LiveTransportTests.cs`

**Interfaces:**
- Consumes: `St4i.DeviceClient.St4iDeviceClient` (ctor accepts `HttpMessageHandler`), Task 5 `ITransport`.
- Produces: `class LiveTransport : ITransport` ctor `(St4iDeviceClient client)` and a factory `static LiveTransport ForMachine(string serverUrl, string mkKey, string machineCode, string? queuePath, bool verifyTls, HttpMessageHandler? handler=null)`. `SendAsync` dispatches by `env.Kind` to `SubmitProcessResultAsync`/`SubmitTelemetryAsync`/`SubmitInspectionAsync`, translating the SDK ack → `TransportAck`, measuring latency with a `Stopwatch`. Network/API exceptions → `TransportAck(Success:false, Queued:true/false, Error:e.Message)` (Queued true for `St4iNetworkException`).

- [ ] **Step 1: Write failing test** (uses `CapturingHandler` returning 201 with processResultId)

```csharp
using St4i.DeviceClient; using St4i.EdgeCore.Models; using St4i.EdgeCore.Transport; using St4i.EdgeCore.Tests.Fakes; using Xunit;
public class LiveTransportTests {
  [Fact] public async Task Process_send_hits_process_result_and_maps_id() {
    var h = new CapturingHandler{ Responder=(_,__)=>(System.Net.HttpStatusCode.Created,
       "{\"ok\":true,\"data\":{\"success\":true,\"processResultId\":27817}}") };
    var live = LiveTransport.ForMachine("http://x","mk_test","SCRW-01",null,true,h);
    var env = new CanonicalEnvelope(ReadingKind.ProcessResult,"SCRW-01","/api/v1/ingest/process-result",
       new(){["serialNumber"]="SN1",["stepType"]="screw_tightening",["result"]="pass",
             ["idempotencyKey"]="SCRW-01:RC1:000001",
             ["metrics"]=new List<object>{ new Dictionary<string,object>{["name"]="torque",["value"]=12.1}}}, "SCRW-01:RC1:000001");
    var ack = await live.SendAsync(env, default);
    Assert.True(ack.Success); Assert.Equal(27817, ack.Id);
    Assert.Contains("/api/v1/ingest/process-result", h.LastRequest!.RequestUri!.ToString());
  }
}
```

- [ ] **Step 2: Run to verify fail** → FAIL.
- [ ] **Step 3: Implement `LiveTransport`.** Map `env.Payload` fields into the SDK typed calls: build `Metric[]`/`Waveform`/`Recipe`/`MeasurementPoint[]` from the payload dictionary (helper `ReadMetrics(env)` etc.). Wrap each in try/catch for `St4iApiException`/`St4iNetworkException`.
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(edgecore): LiveTransport wrapping St4iDeviceClient (mock-HTTP tested)"`

---

## Task 7: `AutoTransport` (live → demo fallback with flag)

**Files:**
- Create: `src/St4i.EdgeCore/Transport/AutoTransport.cs`
- Test: `tests/St4i.EdgeCore.Tests/AutoTransportTests.cs`

**Interfaces:**
- Consumes: Task 5/6 (`ITransport`, `LiveTransport`, `DemoTransport`).
- Produces: `class AutoTransport : ITransport` ctor `(ITransport live, ITransport demo)`; property `bool IsFallingBack { get; }`; event `Action<bool>? FallbackChanged`. `SendAsync` tries `live`; on `TransportAck.Success==false && Queued && Error!=null` (network) OR thrown network exception → routes to `demo`, sets `IsFallingBack=true`, fires event; periodically (every N calls) retries live to recover.

- [ ] **Step 1: Write failing test** (a stub `ITransport` that always network-fails as "live")

```csharp
using St4i.EdgeCore.Models; using St4i.EdgeCore.Transport; using Xunit;
public class AutoTransportTests {
  sealed class DownTransport: ITransport { public TransportMode Mode=>TransportMode.Live;
    public Task<TransportAck> SendAsync(CanonicalEnvelope e,CancellationToken c)=>Task.FromResult(new TransportAck(false,Queued:true,Error:"network down"));
    public Task<HeartbeatResult> HeartbeatAsync(string m,CancellationToken c)=>Task.FromResult(new HeartbeatResult(false,null,null,null));
    public Task<ConfigSyncResult> SyncConfigAsync(string m,string k,string? v,CancellationToken c)=>Task.FromResult(new ConfigSyncResult(false,null,null)); }
  [Fact] public async Task Falls_back_to_demo_when_live_network_fails() {
    var auto = new AutoTransport(new DownTransport(), new DemoTransport(latencyMs:0));
    bool fired=false; auto.FallbackChanged += _=>fired=true;
    var env = new CanonicalEnvelope(ReadingKind.ProcessResult,"SCRW-01","/api/v1/ingest/process-result",
       new(){["idempotencyKey"]="SCRW-01:RC1:000001"}, "SCRW-01:RC1:000001");
    var ack = await auto.SendAsync(env, default);
    Assert.True(ack.Success);            // demo succeeded
    Assert.True(auto.IsFallingBack); Assert.True(fired);
  }
}
```

- [ ] **Step 2: Run to verify fail** → FAIL.
- [ ] **Step 3: Implement `AutoTransport`.**
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(edgecore): AutoTransport live→demo fallback with flag/event"`

---

## Task 8: Infrastructure — EventBus, CredentialStore (DPAPI), ResilienceProbe, FleetConfig

**Files:**
- Create: `src/St4i.EdgeCore/Infrastructure/EventBus.cs`, `ApiTraceEvent.cs`, `CredentialStore.cs`, `ResilienceProbe.cs`, `FleetConfig.cs`
- Test: `tests/St4i.EdgeCore.Tests/CredentialStoreTests.cs`

**Interfaces:**
- Produces:
  - `record ApiTraceEvent(DateTimeOffset At, string MachineCode, ReadingKind Kind, string Method, string Path, int Status, long LatencyMs, TransportMode Mode, bool Duplicate, string? Error)`
  - `class EventBus { void Publish(ApiTraceEvent e); IObservable<ApiTraceEvent>? … } ` — implement as a simple `event Action<ApiTraceEvent>? Traced;` plus a bounded ring buffer `IReadOnlyList<ApiTraceEvent> Recent(int n)`.
  - `static class CredentialStore { void Save(string machineCode, string mkKey); string? Load(string machineCode); }` — DPAPI `ProtectedData.Protect(..., DataProtectionScope.CurrentUser)`, persisted under `%ProgramData%\ST4I\sim\creds\<machineCode>.bin`.
  - `class ResilienceProbe { Task<ProbeResult> ProbeAsync(string serverUrl, CancellationToken ct); }` → GET `/api/v1/openapi.json`, returns `record ProbeResult(bool Reachable, int Status, IReadOnlyList<string> Paths)`.
  - `class FleetConfig { static IReadOnlyList<MachineDescriptor> Load(string path); }` (parses `fleet.json`).

- [ ] **Step 1: Write failing test** (DPAPI round-trip)

```csharp
using St4i.EdgeCore.Infrastructure; using Xunit;
public class CredentialStoreTests {
  [Fact] public void Save_then_load_roundtrips() {
    var code = "TEST-"+System.Guid.NewGuid().ToString("N").Substring(0,8);
    CredentialStore.Save(code, "mk_secret_value");
    Assert.Equal("mk_secret_value", CredentialStore.Load(code));
  }
  [Fact] public void Load_missing_returns_null() => Assert.Null(CredentialStore.Load("NOPE-"+System.Guid.NewGuid().ToString("N")));
}
```

- [ ] **Step 2: Run to verify fail** → FAIL.
- [ ] **Step 3: Implement all five infra files.** (EventBus + FleetConfig + ResilienceProbe compile-covered; CredentialStore test-covered.)
- [ ] **Step 4: Run to verify pass** → 2 PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(edgecore): infra — EventBus, DPAPI CredentialStore, ResilienceProbe, FleetConfig"`

---

## Task 9: doc-28 parser (JSON/CSV/XML) with strict validation

**Files:**
- Create: `src/St4i.EdgeCore/Drivers/HotFolder/Doc28Parser.cs`
- Test: `tests/St4i.EdgeCore.Tests/Doc28ParserTests.cs`

**Interfaces:**
- Produces: `static class Doc28Parser { DeviceReading Parse(string content, string fileName); }` — auto-detects format (JSON `{`, CSV `#ST4I-INSPECTION`, XML `<`). Throws `Doc28ValidationException` on: missing/blank `serial_number`/`machine_code`/`program_name`; offset-less timestamp; result token not OK/NG/NTF; `header.result==OK` with any measurement NG; XML DOCTYPE present. Maps to `DeviceReading{ Kind=Inspection, SerialNumber, MachineCode, Verdict(from result), Measurements[], Timestamp=finished_at }`.

- [ ] **Step 1: Write failing tests** (JSON happy path + 3 rejects)

```csharp
using St4i.EdgeCore.Models; using St4i.EdgeCore.Drivers.HotFolder; using Xunit;
public class Doc28ParserTests {
  const string OkJson = @"{""spec_version"":1,""header"":{""machine_code"":""AOI-01"",""serial_number"":""SN-1"",""program_name"":""MB-X1"",""started_at"":""2026-07-18T08:30:00+07:00"",""finished_at"":""2026-07-18T08:30:12+07:00"",""result"":""NG""},""measurements"":[{""point_name"":""R12"",""result"":""NG"",""defect_code"":""BRIDGING""}]}";
  [Fact] public void Parses_valid_json() {
    var r = Doc28Parser.Parse(OkJson, "AOI-01__SN-1__x.st4i.json");
    Assert.Equal(ReadingKind.Inspection, r.Kind);
    Assert.Equal("SN-1", r.SerialNumber); Assert.Equal(Verdict.Fail, r.Verdict);
    Assert.Single(r.Measurements);
  }
  [Fact] public void Rejects_offsetless_timestamp() {
    var bad = OkJson.Replace("2026-07-18T08:30:12+07:00","2026-07-18T08:30:12");
    Assert.Throws<Doc28ValidationException>(()=>Doc28Parser.Parse(bad,"x.st4i.json"));
  }
  [Fact] public void Rejects_ok_header_with_ng_point() {
    var bad = OkJson.Replace("\"result\":\"NG\"},\"measurements\"","\"result\":\"OK\"},\"measurements\"");
    Assert.Throws<Doc28ValidationException>(()=>Doc28Parser.Parse(bad,"x.st4i.json"));
  }
  [Fact] public void Rejects_xml_with_doctype() {
    var xml = "<?xml version=\"1.0\"?><!DOCTYPE x><st4i_inspection><spec_version>1</spec_version></st4i_inspection>";
    Assert.Throws<Doc28ValidationException>(()=>Doc28Parser.Parse(xml,"x.st4i.xml"));
  }
}
```

- [ ] **Step 2: Run to verify fail** → FAIL.
- [ ] **Step 3: Implement `Doc28Parser` + `Doc28ValidationException`.** JSON via `JsonDocument`; CSV via a small line parser (magic line + `H,`/`M,` rows, fixed 27-col §4.2); XML via `XmlReader` with `DtdProcessing.Prohibit` + `XmlResolver=null` (XXE hardening → DOCTYPE throws). Timestamp regex `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$`.
- [ ] **Step 4: Run to verify pass** → 4 PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(edgecore): doc28 inspection parser (JSON/CSV/XML, strict validation §8)"`

---

## Task 10: SimulatedDriver + per-machine simulators (deterministic)

**Files:**
- Create: `src/St4i.EdgeCore/Drivers/IDeviceDriver.cs`, `Drivers/SimulatedDriver.cs`, `Drivers/Simulators/IMachineSimulator.cs` + 8 sim files.
- Test: `tests/St4i.EdgeCore.Tests/SimulatorTests.cs`

**Interfaces:**
- Produces:
  - `interface IDeviceDriver : IAsyncDisposable { string Id { get; } DriverKind Kind { get; } DriverHealthState Health { get; } IAsyncEnumerable<DeviceReading> ReadAsync(CancellationToken ct); }`
  - `interface IMachineSimulator { MachineDescriptor Descriptor { get; } DeviceReading NextCycle(long cycle); }`
  - `ScrewdriveSim, DispensingSim, WelderSim, AssemblySim, LeakTestSim, FunctionalTestSim, IotSensorSim, AoiInspectorSim` — each ctor takes `(MachineDescriptor d, int seed)`, uses a fixed-seed `Random`. Verdict logic per doc-62 §6. `AoiInspectorSim` injects IPC-A-610 defects with `Bbox`/`Values3d` at a configurable NG-rate.
  - `class SimulatedDriver : IDeviceDriver` ctor `(IReadOnlyList<IMachineSimulator> sims)` — round-robins cycles at each sim's `Descriptor.CycleSeconds`, yields readings.

- [ ] **Step 1: Write failing tests**

```csharp
using St4i.EdgeCore.Models; using St4i.EdgeCore.Drivers.Simulators; using Xunit;
public class SimulatorTests {
  static MachineDescriptor D(string t)=> new("SCRW-01","SN",DeviceClass.Automation,t,"screw_tightening",DriverKind.Simulated,"RC1",null,1.0);
  [Fact] public void Screwdrive_is_deterministic_for_same_seed() {
    var a=new ScrewdriveSim(D("SCREWDRIVE"),seed:42).NextCycle(1);
    var b=new ScrewdriveSim(D("SCREWDRIVE"),seed:42).NextCycle(1);
    Assert.Equal(a.Metrics[0].Value, b.Metrics[0].Value);
    Assert.Equal(ReadingKind.ProcessResult, a.Kind);
  }
  [Fact] public void Aoi_produces_inspection_with_measurements() {
    var d=new MachineDescriptor("AOI-01","SN",DeviceClass.AoiAvi,"AOI",null,DriverKind.Simulated,null,null,2.0);
    var r=new AoiInspectorSim(d,seed:7).NextCycle(1);
    Assert.Equal(ReadingKind.Inspection, r.Kind);
    Assert.NotEmpty(r.Measurements);
  }
}
```

- [ ] **Step 2: Run to verify fail** → FAIL.
- [ ] **Step 3: Implement `IDeviceDriver`, `IMachineSimulator`, the 8 sims, and `SimulatedDriver`.** Each sim sets `CycleCounter=cycle`, `Timestamp=DateTimeOffset.Now`, stable `RecipeCode`. Value generators use the seeded `Random` (reproducible).
- [ ] **Step 4: Run to verify pass** → 2 PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(edgecore): SimulatedDriver + 8 physics simulators (deterministic)"`

---

## Task 11: HotFolderAoiDriver + Doc28Writer (closed-loop demo)

**Files:**
- Create: `src/St4i.EdgeCore/Drivers/HotFolder/HotFolderAoiDriver.cs`, `Drivers/HotFolder/Doc28Writer.cs`
- Test: `tests/St4i.EdgeCore.Tests/HotFolderDriverTests.cs`

**Interfaces:**
- Consumes: Task 9 `Doc28Parser`, Task 10 `IDeviceDriver`, `AoiInspectorSim`.
- Produces:
  - `class Doc28Writer { string WriteAtomic(string dir, DeviceReading inspection); }` — writes `<machine>__<serial>__<compactTs>.st4i.json.tmp` then renames (atomic §6.3).
  - `class HotFolderAoiDriver : IDeviceDriver` ctor `(string watchDir, string archiveDir, string errorDir)` — watches for non-`.tmp` files, parses, yields reading, moves file to archive (OK) / error (invalid, never deletes).

- [ ] **Step 1: Write failing tests** (write via Doc28Writer → driver picks it up; bad file → error dir)

```csharp
using St4i.EdgeCore.Models; using St4i.EdgeCore.Drivers.HotFolder; using Xunit;
public class HotFolderDriverTests {
  [Fact] public async Task Picks_up_written_file_and_archives() {
    var root=Path.Combine(Path.GetTempPath(),"st4i-hf-"+Guid.NewGuid().ToString("N"));
    var watch=Path.Combine(root,"in"); var arch=Path.Combine(root,"archive"); var err=Path.Combine(root,"error");
    Directory.CreateDirectory(watch);
    var reading=new DeviceReading{ MachineCode="AOI-01", Kind=ReadingKind.Inspection, SerialNumber="SN-1", Verdict=Verdict.Pass,
      Timestamp=DateTimeOffset.Now, Measurements=new(){ new MeasurementResult("R1","OK") } };
    new Doc28Writer().WriteAtomic(watch, reading);
    await using var drv=new HotFolderAoiDriver(watch,arch,err);
    using var cts=new CancellationTokenSource(TimeSpan.FromSeconds(5));
    DeviceReading? got=null; await foreach(var r in drv.ReadAsync(cts.Token)){ got=r; break; }
    Assert.NotNull(got); Assert.Equal("SN-1", got!.SerialNumber);
    Assert.True(Directory.GetFiles(arch).Length==1);
  }
}
```

- [ ] **Step 2: Run to verify fail** → FAIL.
- [ ] **Step 3: Implement `Doc28Writer` + `HotFolderAoiDriver`** (FileSystemWatcher + startup scan of existing files + poll fallback; skip `*.tmp`).
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(edgecore): HotFolderAoiDriver + Doc28Writer (doc28 closed-loop, atomic write)"`

---

## Task 12: MqttDriver + in-process broker

**Files:**
- Create: `src/St4i.EdgeCore/Drivers/Mqtt/MqttDriver.cs`, `Drivers/Mqtt/InProcessBroker.cs`
- Test: `tests/St4i.EdgeCore.Tests/MqttDriverTests.cs`

**Interfaces:**
- Produces:
  - `class InProcessBroker : IAsyncDisposable { Task StartAsync(int port=1883); }` (MQTTnet.Server).
  - `class MqttDriver : IDeviceDriver` ctor `(string host, int port, string[] topics, Func<string,string,DeviceReading?> map)` — subscribes, maps `(topic,payloadJson)`→`DeviceReading(Telemetry)`; health Degraded on disconnect.

- [ ] **Step 1: Write failing integration test** (broker + publish + driver receives)

```csharp
using St4i.EdgeCore.Models; using St4i.EdgeCore.Drivers.Mqtt; using MQTTnet; using Xunit;
public class MqttDriverTests {
  [Fact] public async Task Broker_publish_reaches_driver() {
    int port=18830;
    await using var broker=new InProcessBroker(); await broker.StartAsync(port);
    await using var drv=new MqttDriver("localhost",port,new[]{"st4i/+/telemetry"},
      (topic,payload)=> new DeviceReading{ MachineCode="ESP-01", Kind=ReadingKind.Telemetry, SerialNumber="ESP-01",
        Telemetry=new(){ new TelemetrySample("temperature", 31.4, "C") } });
    using var cts=new CancellationTokenSource(TimeSpan.FromSeconds(8));
    var readTask = Task.Run(async ()=>{ await foreach(var r in drv.ReadAsync(cts.Token)) return r; return (DeviceReading?)null; });
    await Task.Delay(500);
    var pub=new MqttClientFactory().CreateMqttClient();
    await pub.ConnectAsync(new MqttClientOptionsBuilder().WithTcpServer("localhost",port).Build());
    await pub.PublishStringAsync("st4i/ESP-01/telemetry","{\"temperature\":31.4}");
    var got=await readTask;
    Assert.NotNull(got); Assert.Equal(ReadingKind.Telemetry, got!.Kind);
  }
}
```
> If MQTTnet v4 API names differ (`MqttClientFactory`/`MqttFactory`), adjust to the installed package's factory type; keep the test intent.

- [ ] **Step 2: Run to verify fail** → FAIL.
- [ ] **Step 3: Implement `InProcessBroker` + `MqttDriver`.**
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(edgecore): MqttDriver + in-process broker (MQTTnet, self-contained demo)"`

---

## Task 13: EdgePipeline (wire driver → normalizer → transport + heartbeat loop)

**Files:**
- Create: `src/St4i.EdgeCore/Engine/EdgePipeline.cs`
- Test: `tests/St4i.EdgeCore.Tests/EdgePipelineTests.cs`

**Interfaces:**
- Consumes: `IDeviceDriver`, `Normalizer`, `ITransport`, `EventBus`.
- Produces: `class EdgePipeline { EdgePipeline(IDeviceDriver driver, MappingProfile profile, ITransport transport, EventBus bus); Task RunAsync(CancellationToken ct); event Action<DeviceReading, TransportAck>? Committed; }` — reads each `DeviceReading`, normalizes, sends, publishes `ApiTraceEvent`, raises `Committed`.

- [ ] **Step 1: Write failing test** (SimulatedDriver with 1 machine + DemoTransport → ≥1 committed)

```csharp
using St4i.EdgeCore.Models; using St4i.EdgeCore.Mapping; using St4i.EdgeCore.Transport; using St4i.EdgeCore.Drivers; using St4i.EdgeCore.Drivers.Simulators; using St4i.EdgeCore.Engine; using St4i.EdgeCore.Infrastructure; using Xunit;
public class EdgePipelineTests {
  [Fact] public async Task Pipeline_commits_readings_via_demo() {
    var d=new MachineDescriptor("SCRW-01","SN",DeviceClass.Automation,"SCREWDRIVE","screw_tightening",DriverKind.Simulated,"RC1",null,0.05);
    var drv=new SimulatedDriver(new[]{ (IMachineSimulator)new ScrewdriveSim(d,42) });
    int committed=0;
    var pipe=new EdgePipeline(drv, MappingProfile.ForClass(DeviceClass.Automation), new DemoTransport(latencyMs:0), new EventBus());
    pipe.Committed += (_,__)=>Interlocked.Increment(ref committed);
    using var cts=new CancellationTokenSource(TimeSpan.FromSeconds(2));
    try { await pipe.RunAsync(cts.Token); } catch (OperationCanceledException) {}
    Assert.True(committed>=1);
  }
}
```

- [ ] **Step 2: Run to verify fail** → FAIL.
- [ ] **Step 3: Implement `EdgePipeline`.**
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(edgecore): EdgePipeline (driver→normalizer→transport, trace events)"`

---

## Task 14: WPF composition root + Shell (nav, mode toggle, DI)

**Files:**
- Create: `src/St4iMachineSimulator/App.xaml(.cs)`, `Views/ShellView.xaml(.cs)`, `ViewModels/AppShellViewModel.cs`, `Themes/Colors.xaml`, `Themes/Dark.xaml`, `Controls/StatusLight.xaml`
- Modify: csproj to include theme dictionaries in `App.xaml` merged resources.

**Interfaces:**
- Consumes: EdgeCore (`AutoTransport`, `LiveTransport`, `DemoTransport`, `EdgePipeline`, `FleetConfig`, `EventBus`).
- Produces: `AppShellViewModel { TransportMode Mode; ObservableObject CurrentView; RelayCommand StartFleet/StopFleet; string ServerStatus; bool IsFallingBack; ObservableCollection<NavItem> Nav; }`.

- [ ] **Step 1: Build the Shell + ViewModel** (no unit test; verified by build + smoke). Shell = left sidebar `ItemsControl` bound to `Nav`, a top bar with `ComboBox` (Live/Demo/Auto), Start/Stop buttons, `StatusLight` bound to server status and a `DEMO FALLBACK` badge bound to `IsFallingBack`, and a `ContentControl Content="{Binding CurrentView}"`. Wire DI in `App.xaml.cs` (plain constructor injection; a small `ServiceProvider` from `Microsoft.Extensions.DependencyInjection`, or manual composition).
- [ ] **Step 2: Build** — `dotnet build src/St4iMachineSimulator` → succeeded.
- [ ] **Step 3: Smoke run (Demo mode)** — add a launch arg `--demo` and run `dotnet run --project src/St4iMachineSimulator -- --demo` for ~5s; confirm window shows shell (screenshot). Kill after.
- [ ] **Step 4: Commit** — `git commit -m "feat(sim-ui): app shell — sidebar nav, mode toggle, dark theme, DI root"`

---

## Task 15: Dashboard (fleet tiles + KPIs)

**Files:**
- Create: `Views/DashboardView.xaml(.cs)`, `ViewModels/FleetViewModel.cs`, `ViewModels/MachineViewModel.cs`, `ViewModels/KpiViewModel.cs`, `Controls/KpiTile.xaml`
- Test: `tests/St4i.EdgeCore.Tests/` — none (UI); optional VM logic test if extracted to EdgeCore. KEEP VM logic thin.

**Interfaces:**
- Consumes: `EdgePipeline.Committed`, `EventBus`, `MachineDescriptor`.
- Produces: `FleetViewModel { ObservableCollection<MachineViewModel> Machines; int OnlineCount; long TotalCycles; double Fpy; }`; `MachineViewModel { string Code; DriverKind DriverKind; DeviceClass Class; string StatusText; double PassRate; long Cycles; string LastCycleSummary; ISeries[] Spark; }`. Subscribe to `Committed` on the Dispatcher; update tiles.

- [ ] **Step 1: Build Dashboard + VMs.** Tiles = `ItemsControl` with `UniformGrid`; each tile shows StatusLight, code, driver-kind chip, pass-rate, throughput sparkline (LiveCharts `CartesianChart`). Top KPI row = ONLINE / total cycles / FPY via `KpiTile`.
- [ ] **Step 2: Build** → succeeded.
- [ ] **Step 3: Smoke run (Demo)** — run `--demo`, confirm tiles animate and KPIs increment (screenshot). Kill.
- [ ] **Step 4: Commit** — `git commit -m "feat(sim-ui): dashboard — fleet tiles + KPIs (live via pipeline)"`

---

## Task 16: Machine detail (charts + config-sync panel + cycle log)

**Files:**
- Create: `Views/MachineDetailView.xaml(.cs)`, `Controls/BoardView.xaml(.cs)` (bbox overlay). Extend `MachineViewModel` with detail series + config-sync commands + cycle log.

**Interfaces:**
- Consumes: `ITransport.SyncConfigAsync`, machine readings.
- Produces: `MachineViewModel` additions: `ISeries[] SpcSeries` (I-MR for automation), `ISeries[] TelemetrySeries` (IoT), `ObservableCollection<MeasurementResult> BoardPoints` (AOI), `RelayCommand SyncConfig`, `ObservableCollection<CycleLogRow> CycleLog`.

- [ ] **Step 1: Build detail view.** Automation → histogram + SPC I-MR chart of the last N metric values. IoT → line chart of telemetry. AOI → `BoardView` drawing measurement `Bbox` rectangles (red=NG, green=OK) over a board canvas. Config-sync panel: buttons check→get→apply→ack calling `SyncConfigAsync`, show `driftState`. Cycle log = `DataGrid` bound to `CycleLog`.
- [ ] **Step 2: Build** → succeeded.
- [ ] **Step 3: Smoke run (Demo)** — open one automation + one AOI machine, confirm charts + board bbox render (screenshots). Kill.
- [ ] **Step 4: Commit** — `git commit -m "feat(sim-ui): machine detail — SPC/telemetry charts, AOI board bbox, config-sync panel"`

---

## Task 17: API Inspector (live request/response stream)

**Files:**
- Create: `Views/ApiInspectorView.xaml(.cs)`, `ViewModels/InspectorViewModel.cs`

**Interfaces:**
- Consumes: `EventBus.Traced` (`ApiTraceEvent`).
- Produces: `InspectorViewModel { ObservableCollection<ApiTraceEvent> Events; RelayCommand Clear/PauseResume/Export; string? FilterMachine; string? FilterKind; }`. Subscribe on Dispatcher; cap to last 500 with a ring; color rows by status (2xx green / 4xx red / queued amber) and Live vs Demo mode chip.

- [ ] **Step 1: Build inspector.** `DataGrid` columns: time, machine, kind, method, path, status, latency, mode, dup/error. Filter combos; Pause toggle; Export to JSON (SaveFileDialog).
- [ ] **Step 2: Build** → succeeded.
- [ ] **Step 3: Smoke run (Demo)** — confirm rows stream live as fleet runs (screenshot). Kill.
- [ ] **Step 4: Commit** — `git commit -m "feat(sim-ui): API Inspector — live request/response stream (exhibition centerpiece)"`

---

## Task 18: Onboarding wizard (register→claim/enroll + paste mk_ + fleet load)

**Files:**
- Create: `Views/OnboardingView.xaml(.cs)`, `ViewModels/OnboardingViewModel.cs`

**Interfaces:**
- Consumes: `St4iDeviceClient` (register via HTTP, `ClaimAsync`, `EnrollAsync`), `CredentialStore`.
- Produces: `OnboardingViewModel { string SerialNumber/Name/MachineType; RelayCommand Register/PollApproval/Claim/Enroll/PasteKey/LoadFleet; string Step; string? MkKey; string StatusLog; }`. On success, `CredentialStore.Save`. Register uses `POST /api/machine/register`; poll `GET /api/machine/config?serialNumber=`; claim/enroll via SDK.

- [ ] **Step 1: Build wizard.** Stepper UI: (1) Register → (2) Poll approval → (3) Claim (mct_) OR Enroll (met_) → (4) key stored. A "Paste mk_" tab and a "Load fleet.json" button. In Demo mode, the wizard simulates approval instantly.
- [ ] **Step 2: Build** → succeeded.
- [ ] **Step 3: Smoke run (Demo)** — walk the wizard end-to-end in Demo, confirm each step advances (screenshot). Kill.
- [ ] **Step 4: Commit** — `git commit -m "feat(sim-ui): onboarding wizard — register→claim/enroll, paste mk_, fleet load"`

---

## Task 19: Scenario control + Settings + i18n (vi/en) + branding

**Files:**
- Create: `Views/ScenarioView.xaml(.cs)`, `ViewModels/ScenarioViewModel.cs`, `Views/SettingsView.xaml(.cs)`, `ViewModels/SettingsViewModel.cs`, `i18n/Strings.vi.xaml`, `i18n/Strings.en.xaml`, `Assets/logo.png`, `Assets/icon.ico`, splash.

**Interfaces:**
- Produces: `ScenarioViewModel { double CycleRate/DefectRate/FaultRate; RelayCommand Burst; ObservableCollection<Preset> Presets; RelayCommand Apply; }`; `SettingsViewModel { string ServerUrl; bool VerifyTls; RelayCommand ProbeFlags; string Language; bool Kiosk; bool Attract; }`. Presets: "Ca bình thường", "Lô lỗi cao", "Sensor drift", "Mất mạng demo", "Hot-folder AOI".

- [ ] **Step 1: Build scenario + settings + i18n.** Scenario sliders push values into the running simulators (defect/fault/cycle-rate). Settings: server URL, verify TLS, "Kiểm cờ" runs `ResilienceProbe`, language switch swaps merged `Strings.*.xaml`, kiosk/attract toggles. Replace all literal UI strings with `{DynamicResource Str_*}`.
- [ ] **Step 2: Build** → succeeded.
- [ ] **Step 3: Smoke run (Demo)** — switch vi↔en, apply "Lô lỗi cao" preset and confirm NG-rate rises in Inspector (screenshot). Kill.
- [ ] **Step 4: Commit** — `git commit -m "feat(sim-ui): scenario presets, settings+flag-probe, vi/en i18n, branding"`

---

## Task 20: Attract mode + kiosk polish

**Files:**
- Modify: `AppShellViewModel`, `ShellView` (fullscreen/kiosk), add `Services/AttractModeService.cs`.

- [ ] **Step 1: Implement attract mode** — after N idle seconds, auto-cycle through Dashboard → a machine detail → Inspector on a timer; any input exits. Kiosk = borderless maximized (`WindowStyle=None`, `WindowState=Maximized`), F11 toggles.
- [ ] **Step 2: Build** → succeeded.
- [ ] **Step 3: Smoke run (Demo)** — enable kiosk+attract, confirm auto-tour runs and input exits (screenshot). Kill.
- [ ] **Step 4: Commit** — `git commit -m "feat(sim-ui): attract mode + kiosk fullscreen polish"`

---

## Task 21: EdgeService headless seam

**Files:**
- Create/replace: `src/St4i.EdgeService/Program.cs`, `EdgeWorker.cs`

**Interfaces:**
- Consumes: `FleetConfig`, `SimulatedDriver`, `DemoTransport`/`AutoTransport`, `EdgePipeline`.

- [ ] **Step 1: Implement worker** — `Microsoft.Extensions.Hosting` `BackgroundService` that loads `fleet.json`, builds a `SimulatedDriver` + `DemoTransport`, runs `EdgePipeline`, logs each commit. Add a `--smoke N` arg that exits after N commits.
- [ ] **Step 2: Build** → succeeded.
- [ ] **Step 3: Smoke** — `dotnet run --project src/St4i.EdgeService -- --smoke 10` → prints 10 commits then exits 0.
- [ ] **Step 4: Commit** — `git commit -m "feat(edge-service): headless BackgroundService seam reusing EdgeCore (smoke: 10 commits)"`

---

## Task 22: fleet.json + mapping presets + README + self-contained publish

**Files:**
- Create: `tools/machine-simulator/fleet.json`, `mapping/*.json`, `README.md`

- [ ] **Step 1: Author `fleet.json`** — the ~10-12 machine default fleet (2 SCREWDRIVE, 1 DISPENSING, 1 WELDER, 1 ASSEMBLY, 1 leak, 1 functional, 2 IOT_SENSOR, 2 AOI) with codes, classes, driver kinds, cycle seconds, mapping profile refs. Author `mapping/*.json` presets.
- [ ] **Step 2: Author `README.md` (vi/en)** — build, run (`--demo`), Live setup (server flags from doc 61 §12, mk_ provisioning), hot-folder demo steps, MQTT demo steps, publish command, roadmap pointer to doc 62 §11.
- [ ] **Step 3: Publish self-contained single-file EXE**

Run: `dotnet publish src/St4iMachineSimulator -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o publish`
Expected: `publish/St4iMachineSimulator.exe` produced.

- [ ] **Step 4: Verify the published EXE runs (Demo)** — launch `publish/St4iMachineSimulator.exe --demo` for ~5s on this machine; confirm it opens with no runtime error (screenshot). Kill.
- [ ] **Step 5: Commit** — `git commit -m "feat(sim): default fleet.json, mapping presets, README (vi/en), self-contained publish"`

---

## Task 23: Full-suite green gate + final verification

- [ ] **Step 1: Run the whole test suite** — `dotnet test tools/machine-simulator/tests/St4i.EdgeCore.Tests` → all green; record count.
- [ ] **Step 2: Build the whole solution Release** — `dotnet build tools/machine-simulator/St4iMachineSimulator.sln -c Release` → 0 errors.
- [ ] **Step 3: (If a dev server with flags is reachable) Live smoke** — set `ST4I_SERVER`/`mk_`, switch app to Live, run one cycle per feed, confirm `processResultId`/`accepted`/`inspectionId` per doc 61 §14; drop one `.st4i.json` into the hot-folder and confirm inspection posts; publish one MQTT sample and confirm telemetry. If no server, note it and rely on Demo verification. (Do NOT block completion on server availability.)
- [ ] **Step 4: Verify DoD** — walk doc 62 §15 items 1-10; check each.
- [ ] **Step 5: Commit** — `git commit -m "test(sim): full-suite green + DoD verification (doc62 §15)"`

---

## Self-Review (author checklist — completed)

**Spec coverage (doc 62):** §2.1 items 1-9 → Tasks: simulator(10) · pipeline(3-4,13) · dual transport(5-7) · two proof drivers(11,12) · onboarding(18) · UI screens(14-17,19-20) · service seam(21) · SDK inspection(2) · packaging(22). §5 components each map to a task. §6 sims→Task 10. §8 onboarding→18. §11 roadmap = docs only (README/§in doc62). §13 tests→testable tasks. §15 DoD→Task 23. No gaps found.

**Placeholder scan:** No "TBD/handle edge cases/similar to Task N" — each code step has concrete code or a concrete build/smoke gate. UI tasks intentionally use build+smoke (not xUnit) — stated explicitly, not a placeholder.

**Type consistency:** `ITransport.SendAsync(CanonicalEnvelope,CancellationToken)` used identically in Tasks 5,6,7,13. `DeviceReading`/`MeasurementResult`/`MetricSample`/`TransportAck` names consistent Tasks 3→13. `SubmitInspectionAsync`/`MeasurementPoint`/`InspectionAck` consistent Task 2↔6. `IDeviceDriver.ReadAsync` consistent Tasks 10,11,12,13,21.

**Note on NuGet versions:** exact versions above are best-known-good; if any 404s, `dotnet add package` to resolve latest stable and record it (Task 1 Step 5 note).
