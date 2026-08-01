using System.Runtime.CompilerServices;
using St4i.Connector.Abstractions;
using St4i.EdgeCore.Config;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// SM-2 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-2-brief.md) — the live
/// half of "fabricated data must never silently blend into a number a customer reads": today
/// <c>FleetHost.OnPipelineCommitted</c> increments <c>_totalCycles</c>/<c>_totalJudged</c>/<c>_totalPass</c>
/// for every reading from every slot, with no driver-kind filter. This file proves the three roster shapes
/// the brief's own "Tests" section calls out, with EXACT numeric assertions (never "some data exists"):
///
///  - Demo fleet running plus one real machine ⇒ <see cref="FleetSnapshotDto.Kpis"/> reflects ONLY the
///    real machine.
///  - Pure demo mode ⇒ unchanged from today (the strict exhibition regression guard).
///  - Pure product mode with one real machine ⇒ unaffected by this change.
///
/// Uses the SAME <see cref="FleetHost.AdditionalPipelinesForTests"/> seam
/// <see cref="FleetHostTelemetryHardeningTests"/>/<see cref="FleetHostMultiPipelineFaultIsolationTests"/>
/// already use to inject a REAL (non-Simulated) driver deterministically, and the SAME
/// <see cref="DemoModeGate"/>-driven demo/product roster seam <see cref="FleetHostProductModeRosterTests"/>
/// already established.
/// </summary>
public sealed class FleetHostKpiHonestyTests
{
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(100);

    private static FleetHost CreateHost(DemoModeGate? demoModeGate = null)
    {
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo);
        var eventBus = new EventBus();
        return new FleetHost(switchable, coordinator, eventBus, demoModeGate: demoModeGate);
    }

    private static MachineDescriptor NewRealDescriptor(string code) => new(
        Code: code,
        SerialSeed: $"SN-{code}",
        DeviceClass: DeviceClass.Automation,
        MachineType: "MODBUS_TCP",
        StepType: null,
        DriverKind: DriverKinds.Modbus,
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

    // ─────────────────────────────────────────────────────────────────────
    // Demo fleet + one real machine ⇒ Kpis reflect ONLY the real machine.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task DemoFleetPlusOneRealMachine_LiveKpis_ReflectOnlyTheRealMachine_ExactNumbers()
    {
        var host = CreateHost(demoModeGate: new DemoModeGate("true")); // pure demo default: 11 fabricated machines
        const string realCode = "REAL-01";
        Assert.True(host.RegisterMachine(NewRealDescriptor(realCode)));

        // Exactly 2 Pass + 1 Fail, then the fake driver idles forever — a stable, known-exact number.
        var fakeDriver = new FixedSequenceDriver(realCode, new[] { Verdict.Pass, Verdict.Pass, Verdict.Fail });
        host.AdditionalPipelinesForTests = () => new List<(string Label, IDeviceDriver Driver, St4i.EdgeCore.Mapping.MappingProfile Profile)>
        {
            ("real-fixed", fakeDriver, new St4i.EdgeCore.Mapping.MappingProfile { Name = "test", DeviceClass = "Test" }),
        };

        host.Start();
        try
        {
            // Prove the demo fleet is genuinely running and accumulating cycles alongside the real
            // machine — if blending still happened, TotalCycles would be far larger than 3.
            await WaitUntilAsync(
                () => host.Snapshot().Machines.Where(m => m.Code != realCode).Sum(m => m.Cycles) > 5,
                "the demo fleet to accumulate cycles alongside the real machine");

            await WaitUntilAsync(() => (host.MachineDetail(realCode)?.Cycles ?? 0) >= 3, $"{realCode} to reach its fixed 3 cycles");
            await Task.Delay(150); // the fake driver idles after 3 — let any race settle, number stays 3

            var kpis = host.Snapshot().Kpis;

            Assert.Equal(3, kpis.TotalCycles);
            Assert.Equal(2.0 / 3.0, kpis.Fpy);
            Assert.True(kpis.HasMixedProvenance, "a demo fleet running alongside a real machine must surface as mixed provenance");

            // Fix round 1 (review CRITICAL) — GetKpiCounters() is FleetHost's OTHER customer-facing KPI
            // surface: AlarmEvaluatorService feeds it straight into AlarmEvaluator.EvaluateNgRateAsync,
            // which raises a customer-facing "Fleet NG-rate X% ... exceeds the Y% limit" alarm. Before this
            // fix it returned the raw blended (_totalPass, _totalJudged) unconditionally — the demo fleet's
            // stream could mask or falsely trip a real quality alarm. Must match Snapshot().Kpis exactly:
            // (2 pass, 3 judged), never blended with the demo fleet's own (much larger) counts.
            Assert.Equal((2L, 3L), host.GetKpiCounters());
        }
        finally
        {
            host.AdditionalPipelinesForTests = null;
            host.Stop();
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Pure demo mode ⇒ unchanged from today (strict regression, not "some data exists").
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task PureDemoMode_LiveKpis_ExactlyMatchTheBlendedTotals_UnchangedFromToday()
    {
        var host = CreateHost(demoModeGate: new DemoModeGate("true"));

        host.Start();
        try
        {
            await WaitUntilAsync(() => host.Snapshot().Machines.All(m => m.Cycles > 0), "all 11 demo machines to cycle at least once");
            await Task.Delay(300); // let a few more cycles land across the fleet

            host.Stop(); // freeze every counter (Cycles/totals no longer mutate once stopped)

            var snapshot = host.Snapshot();
            var (totalPass, totalJudged) = host.GetKpiCounters(); // the pre-existing, still-blended accessor
            var expectedFpy = totalJudged == 0 ? 0.0 : (double)totalPass / totalJudged;
            var expectedCycles = snapshot.Machines.Sum(m => m.Cycles);

            Assert.Equal(expectedCycles, snapshot.Kpis.TotalCycles);
            Assert.Equal(expectedFpy, snapshot.Kpis.Fpy);
            Assert.False(snapshot.Kpis.HasMixedProvenance, "a pure demo roster has nothing real to mix with");
        }
        finally
        {
            host.Stop();
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Pure product mode with one real machine ⇒ unaffected by this change.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task PureProductMode_OneRealMachine_LiveKpis_ReflectThatMachine_Unaffected()
    {
        var host = CreateHost(demoModeGate: new DemoModeGate("")); // product mode: empty roster by default
        const string realCode = "REAL-ONLY-01";
        Assert.True(host.RegisterMachine(NewRealDescriptor(realCode)));

        var fakeDriver = new FixedSequenceDriver(realCode, new[] { Verdict.Pass, Verdict.Fail, Verdict.Pass, Verdict.Pass });
        host.AdditionalPipelinesForTests = () => new List<(string Label, IDeviceDriver Driver, St4i.EdgeCore.Mapping.MappingProfile Profile)>
        {
            ("real-fixed", fakeDriver, new St4i.EdgeCore.Mapping.MappingProfile { Name = "test", DeviceClass = "Test" }),
        };

        host.Start();
        try
        {
            await WaitUntilAsync(() => (host.MachineDetail(realCode)?.Cycles ?? 0) >= 4, $"{realCode} to reach its fixed 4 cycles");
            await Task.Delay(150);

            var kpis = host.Snapshot().Kpis;

            Assert.Equal(4, kpis.TotalCycles);
            Assert.Equal(3.0 / 4.0, kpis.Fpy);
            Assert.False(kpis.HasMixedProvenance, "no fabricated machine exists in a product-mode roster");

            // Fix round 1 (review CRITICAL) — GetKpiCounters() must agree with Snapshot().Kpis here too:
            // nothing fabricated exists in this roster, so real-only and blended are the SAME numbers,
            // but the accessor must not have quietly diverged from Snapshot()'s own computation.
            Assert.Equal((3L, 4L), host.GetKpiCounters());
        }
        finally
        {
            host.AdditionalPipelinesForTests = null;
            host.Stop();
        }
    }

    /// <summary>Test double — yields EXACTLY the given verdict sequence for <paramref name="machineCode"/>
    /// (one <see cref="ReadingKind.ProcessResult"/> reading per verdict) then idles forever, never yielding
    /// another reading — giving a test a stable, known-exact cycle count/verdict mix to assert on instead
    /// of racing a live, continuously-cycling driver.</summary>
    private sealed class FixedSequenceDriver : IDeviceDriver
    {
        private readonly string _machineCode;
        private readonly Verdict[] _verdicts;
        private long _counter;

        public FixedSequenceDriver(string machineCode, Verdict[] verdicts)
        {
            _machineCode = machineCode;
            _verdicts = verdicts;
        }

        public string Id => $"fake-fixed-sequence-{_machineCode}";

        public string Kind => DriverKinds.Modbus;

        public DriverHealthState Health => DriverHealthState.Connected;

        public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
        {
            foreach (var verdict in _verdicts)
            {
                ct.ThrowIfCancellationRequested();
                yield return new DeviceReading
                {
                    MachineCode = _machineCode,
                    Kind = ReadingKind.ProcessResult,
                    SerialNumber = $"SN-{_machineCode}-{Interlocked.Increment(ref _counter)}",
                    Verdict = verdict,
                    CycleCounter = _counter,
                    Timestamp = DateTimeOffset.UtcNow,
                };
                await Task.Delay(20, ct).ConfigureAwait(false);
            }

            while (!ct.IsCancellationRequested)
            {
                await Task.Delay(50, ct).ConfigureAwait(false);
            }
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
