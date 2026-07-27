using System.Runtime.CompilerServices;
using St4i.EdgeCore.Drivers;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// GĐ3 sub-3 OU-2 PART A (docs/plans/2026-07-27-giaidoan3-opcua-driver-blueprint.md task 2) — the
/// REQUIRED gate OU-1's review flagged: <c>OpcUaDriver.BoxValue</c> passes a non-numeric string
/// telemetry value through as-is (e.g. a "status" node → "RUNNING"), and before this task, THREE numeric
/// aggregation sites (<c>HistorianResultRecord.From</c>, <c>MachineState.ApplyReading</c>'s per-metric
/// telemetry series, <c>MachineState.SparkValue</c>) tested only <c>value is IConvertible</c> then
/// unconditionally called <c>ToDouble(null)</c> — but <see cref="string"/> IS <see cref="IConvertible"/>,
/// so <c>Convert.ToDouble("RUNNING")</c> throws a <see cref="FormatException"/> straight out of
/// <see cref="FleetHost.OnPipelineCommitted"/>, which (being wired to <c>EdgePipeline.Committed</c>, an
/// inline, synchronous event invoked from inside the pipeline's own run-task) would propagate up through
/// <c>EdgePipeline.RunAsync</c> and be caught by <c>FleetHost.StartSlot</c>'s per-slot fault catch — i.e.
/// a string OPC-UA/telemetry tag would silently KILL the whole slot on its very first poll.
///
/// This test reproduces exactly that shape — a Verdict.Skip <see cref="DeviceReading"/> carrying BOTH a
/// numeric tag ("temp"=23.5) and a non-numeric string tag ("status"="RUNNING") — routed through the REAL
/// <see cref="FleetHost"/> pipeline (via the <see cref="FleetHost.AdditionalPipelinesForTests"/> seam,
/// same idiom <c>FleetHostMultiPipelineFaultIsolationTests</c> already uses) for a machine that HAS a
/// <see cref="MachineState"/> (registered via <see cref="FleetHost.RegisterMachine"/>, mirroring the
/// P2-3/OU-2 roster contract) — and asserts it never throws/faults the slot, the numeric tag's
/// series/spark are recorded, and the string tag is simply skipped.
/// </summary>
public sealed class FleetHostTelemetryHardeningTests
{
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(100);

    private const string MachineCode = "TELEMETRY-HARDEN-01";

    private static FleetHost CreateHost()
    {
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo);
        var eventBus = new EventBus();
        return new FleetHost(switchable, coordinator, eventBus);
    }

    /// <summary>DriverKind.Modbus — already excluded from <c>FleetHost.StartLocked</c>'s simulated group
    /// pre-existing this task (P2-3) — so registering this descriptor never double-drives it with a
    /// simulator; the ONLY driver that ever produces a reading for it is the fake one wired below via
    /// <see cref="FleetHost.AdditionalPipelinesForTests"/>.</summary>
    private static MachineDescriptor NewDescriptor() => new(
        Code: MachineCode,
        SerialSeed: $"SN-{MachineCode}",
        DeviceClass: DeviceClass.Automation,
        MachineType: "OPC_UA",
        StepType: null,
        DriverKind: DriverKind.Modbus,
        RecipeCode: null,
        MappingProfile: null,
        CycleSeconds: 1.0);

    private static async Task WaitUntilAsync(Func<bool> predicate, string because)
    {
        var deadline = DateTime.UtcNow + PollTimeout;
        while (DateTime.UtcNow < deadline)
        {
            if (predicate()) return;
            await Task.Delay(PollInterval);
        }

        Assert.True(predicate(), $"timed out after {PollTimeout} waiting for: {because}");
    }

    [Fact]
    public async Task StringAndNumericTelemetry_RoutedThroughPipeline_NeverThrows_RecordsNumeric_SkipsString()
    {
        var host = CreateHost();
        var added = host.RegisterMachine(NewDescriptor());
        Assert.True(added);

        var fakeDriver = new StringAndNumericTelemetryDriver();
        host.AdditionalPipelinesForTests = () => new List<(string Label, IDeviceDriver Driver, St4i.EdgeCore.Mapping.MappingProfile Profile)>
        {
            ("string-tag-hardening", fakeDriver, new St4i.EdgeCore.Mapping.MappingProfile { Name = "test", DeviceClass = "Test" }),
        };

        host.Start();
        try
        {
            // The load-bearing wait: several cycles' worth of BOTH tags together, every poll, must keep
            // climbing rather than the slot dying after the first (pre-fix) FormatException.
            await WaitUntilAsync(() => (host.MachineDetail(MachineCode)?.Cycles ?? 0) >= 3,
                "the machine to accumulate multiple cycles despite every reading carrying a non-numeric string tag");

            // Never faulted: pre-fix, the very first string-tag reading would have thrown out of
            // OnPipelineCommitted, been caught by StartSlot's per-slot catch, and set LastError.
            Assert.Null(host.LastError);

            // The rest of the fleet (the ordinary simulated roster) is completely unaffected.
            await WaitUntilAsync(() => (host.MachineDetail("SCRW-01")?.Cycles ?? 0) > 0, "SCRW-01 (simulated) to cycle normally alongside this test");

            var detail = host.MachineDetail(MachineCode);
            Assert.NotNull(detail);

            // The numeric tag's series was recorded, untouched by the fix.
            var tempSeries = Assert.Single(detail!.Telemetry, t => t.Metric == "temp");
            Assert.Contains(23.5, tempSeries.Values);

            // The non-numeric string tag was silently skipped — no series for it at all.
            Assert.DoesNotContain(detail.Telemetry, t => t.Metric == "status");

            // Spark line reflects the numeric telemetry sample (SparkValue's IOT-class fallback: first
            // telemetry sample, which is "temp" in every reading this fake driver yields).
            var tile = Assert.Single(host.Snapshot().Machines, m => m.Code == MachineCode);
            Assert.Contains(23.5, tile.Spark);
        }
        finally
        {
            host.AdditionalPipelinesForTests = null;
            host.Stop();
        }
    }

    /// <summary>Test double — yields a Telemetry (Verdict.Skip) reading forever (until cancelled) whose
    /// telemetry ALWAYS carries a genuinely-numeric tag ("temp") FIRST (so <c>MachineState.SparkValue</c>'s
    /// "first telemetry sample" fallback picks the numeric one) and a non-numeric string status tag
    /// SECOND — the exact shape a configured OPC-UA machine polling a numeric process-value node
    /// alongside a string status node would produce every single poll.</summary>
    private sealed class StringAndNumericTelemetryDriver : IDeviceDriver
    {
        private long _counter;

        public string Id => "fake-string-and-numeric-telemetry-test-driver";

        public DriverKind Kind => DriverKind.Modbus;

        public DriverHealthState Health => DriverHealthState.Connected;

        public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
        {
            while (true)
            {
                ct.ThrowIfCancellationRequested();
                yield return new DeviceReading
                {
                    MachineCode = MachineCode,
                    Kind = ReadingKind.Telemetry,
                    SerialNumber = $"SN-{MachineCode}",
                    Verdict = Verdict.Skip,
                    CycleCounter = Interlocked.Increment(ref _counter),
                    Timestamp = DateTimeOffset.UtcNow,
                    Telemetry = new List<TelemetrySample>
                    {
                        new("temp", 23.5, "C", "good"),
                        new("status", "RUNNING", null, "good"),
                    },
                };
                await Task.Delay(TimeSpan.FromMilliseconds(20), ct).ConfigureAwait(false);
            }
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
