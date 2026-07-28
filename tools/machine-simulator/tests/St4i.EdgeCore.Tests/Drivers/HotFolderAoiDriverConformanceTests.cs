using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.Connector.Conformance;
using St4i.EdgeCore.Drivers.HotFolder;
using Xunit;

namespace St4i.EdgeCore.Tests.Drivers;

/// <summary>
/// GP-6 "Fix round 1" (task-6-report.md — the reviewer's own cheap fold) — runs the shared
/// <see cref="DeviceDriverConformanceSuite"/> against the real <see cref="HotFolderAoiDriver"/>. Unlike
/// the other three real drivers, <see cref="HotFolderAoiDriver"/> populates <see cref="DeviceReading.Genealogy"/>
/// and <see cref="DeviceReading.Measurements"/> (including <see cref="Bbox"/>/<see cref="Values3d"/>) — so
/// this class is what actually exercises <c>DeviceReadingEquality.CompareGenealogy</c>/<c>CompareMeasurement</c>/
/// <c>Values3dEquals</c>/the <see cref="Bbox"/> path with a REAL driver's output; none of
/// <c>SimulatedDriver</c>/<c>ModbusTcpDriver</c>/<c>OpcUaDriver</c> ever populate those fields. All 9 checks
/// pass — no known gap.
///
/// <para><b>Interpretation call, flagged per task-6-report.md's own convention:</b>
/// <see cref="ModelsExternalDeviceConnection"/> is overridden <see langword="false"/> here. Unlike
/// <c>SimulatedDriver</c>, <see cref="HotFolderAoiDriver"/>'s own class doc comment does NOT explicitly state
/// a "no external link to lose" exemption the way <c>IDeviceDriver.Health</c>'s own doc comment now requires
/// (task-6-report.md "Fix round 1" IMPORTANT 4) — its constructor sets <see cref="IDeviceDriver.Health"/> to
/// <see cref="DriverHealthState.Connected"/> UNCONDITIONALLY, even if <c>TryCreateWatcher()</c> returned
/// <see langword="null"/> (a real corner case: a network share that can't support a
/// <see cref="System.IO.FileSystemWatcher"/> still gets a Connected driver — the poll loop covers it, but
/// Health doesn't reflect the degraded watch mode at all). This override is a judgment call BY ANALOGY
/// (Health is, in practice, constant for the whole life of a non-disposed instance, matching the shape the
/// exemption is for), not a literal reading of this driver's own doc comment — which I judge to currently be
/// SILENT on the point, not explicit either way. I did not change <see cref="HotFolderAoiDriver"/>'s
/// behaviour or doc comment to resolve this; see task-6-report.md for the full writeup.</para>
/// </summary>
public sealed class HotFolderAoiDriverConformanceTests : DeviceDriverConformanceSuite
{
    protected override bool ModelsExternalDeviceConnection => false;

    protected override IDeviceDriver CreateDriver()
    {
        var (watch, archive, error, _) = NewTempDirs();
        return new HotFolderAoiDriver(watch, archive, error);
    }

    protected override Task<IReadOnlyList<DeviceReading>> CollectReadingsAsync(
        int count, TimeSpan timeout, Action<DeviceReading>? onYielded = null) =>
        CollectFromHotFolderAsync(count, timeout, onYielded);

    private static async Task<IReadOnlyList<DeviceReading>> CollectFromHotFolderAsync(
        int count, TimeSpan timeout, Action<DeviceReading>? onYielded)
    {
        var (watch, archive, error, root) = NewTempDirs();
        try
        {
            var writer = new Doc28Writer();
            for (var i = 1; i <= count; i++)
            {
                writer.WriteAtomic(watch, BuildReading(i));
            }

            await using var driver = new HotFolderAoiDriver(watch, archive, error);
            return await CollectFromAsync(driver, count, timeout, onYielded).ConfigureAwait(false);
        }
        finally
        {
            try { if (Directory.Exists(root)) Directory.Delete(root, recursive: true); }
            catch { /* best-effort cleanup only */ }
        }
    }

    private static (string Watch, string Archive, string Error, string Root) NewTempDirs()
    {
        var root = Path.Combine(Path.GetTempPath(), "st4i-hf-conf-" + Guid.NewGuid().ToString("N")[..8]);
        var watch = Path.Combine(root, "in");
        var archive = Path.Combine(root, "archive");
        var error = Path.Combine(root, "error");
        Directory.CreateDirectory(watch);
        return (watch, archive, error, root);
    }

    /// <summary>Populates Genealogy (all 5 documented keys — string/int/double), a Measurement with both
    /// Bbox and Values3d, varying per cycle so the no-reuse check's content-drift detection stays
    /// meaningful.</summary>
    private static DeviceReading BuildReading(int cycle) => new()
    {
        MachineCode = "AOI-CONFORMANCE",
        Kind = ReadingKind.Inspection,
        SerialNumber = $"SN-CONF-{cycle:D4}",
        RecipeCode = "RCP-CONFORMANCE",
        RecipeVersion = "1.0.0",
        Verdict = Verdict.Pass,
        Timestamp = DateTimeOffset.UtcNow,
        Measurements = new List<MeasurementResult>
        {
            new(
                "C1", "OK", MeasuredValue: 90.0 + cycle, Unit: "%",
                Bbox: new Bbox(10 + cycle, 20, 30, 40),
                Values3d: new Values3d(HeightUm: 95.0 + cycle, AreaPct: 88.0)),
        },
        Genealogy = new Dictionary<string, object>
        {
            ["lotCode"] = $"LOT-{cycle:D3}",
            ["panelId"] = $"PANEL-{cycle:D3}",
            ["operatorId"] = "OP-1",
            ["boardIndex"] = cycle,
            ["cycleTimeSec"] = 1.5 + cycle,
        },
    };

    [Fact]
    public Task Construction_IsNonBlocking_AndPerformsNoIO() => Check_Construction_IsNonBlocking_AndPerformsNoIO();

    [Fact]
    public Task Id_And_Kind_AreNonEmpty_AndStableAcrossLifetime() => Check_Id_And_Kind_AreNonEmpty_AndStableAcrossLifetime();

    [Fact]
    public Task Health_OnlyTakesDocumentedValues_AndIsSaneWithNoDevice() => Check_Health_OnlyTakesDocumentedValues_AndIsSaneWithNoDevice();

    [Fact]
    public Task ReadAsync_HonoursCancellation_WhenNoDeviceIsReachable() => Check_ReadAsync_HonoursCancellation_WhenNoDeviceIsReachable();

    [Fact]
    public Task DisposeAsync_IsIdempotent_WithoutEverEnumerating() => Check_DisposeAsync_IsIdempotent_WithoutEverEnumerating();

    [Fact]
    public Task DisposeAsync_IsIdempotent_AfterCancellation() => Check_DisposeAsync_IsIdempotent_AfterCancellation();

    [Fact]
    public Task DisposeAsync_IsIdempotent_AfterCompletedEnumeration() => Check_DisposeAsync_IsIdempotent_AfterCompletedEnumeration();

    [Fact]
    public Task ReadAsync_NeverReusesOrMutatesAYieldedReading() => Check_ReadAsync_NeverReusesOrMutatesAYieldedReading();

    [Fact]
    public Task Telemetry_RoundTripsLosslesslyThroughConnectorJson() => Check_Telemetry_RoundTripsLosslesslyThroughConnectorJson();
}
