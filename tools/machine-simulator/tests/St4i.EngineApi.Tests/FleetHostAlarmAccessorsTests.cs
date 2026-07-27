using System.Runtime.CompilerServices;
using St4i.EdgeCore.Drivers;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Mapping;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// GĐ3 sub-4 LC-2 — <see cref="FleetHost.GetDriverHealth"/>/<see cref="FleetHost.GetKpiCounters"/>: the two
/// new read-only accessors <see cref="St4i.EngineApi.Alarms.AlarmEvaluator"/> polls. Both are pure reads
/// (no mutation), so these tests only need <see cref="FleetHost.Start"/>/<see cref="FleetHost.Stop"/> and
/// <see cref="FleetHost.AdditionalPipelinesForTests"/> — the same multi-slot fake-driver harness
/// <c>FleetHostMultiPipelineFaultIsolationTests</c> already established — never a real Modbus/OPC-UA
/// dependency.
/// </summary>
public sealed class FleetHostAlarmAccessorsTests
{
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(100);

    /// <summary>Same composition as <c>FleetHostHealthAndRegistrationTests.CreateHost</c> — default Demo
    /// mode, no real network call ever made by any of these tests.</summary>
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

    private static MappingProfile TestProfile(string name) => new() { Name = name, DeviceClass = "Test" };

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
    // GetDriverHealth
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void GetDriverHealth_FleetStopped_ReturnsEmpty()
    {
        var host = CreateHost();
        Assert.Empty(host.GetDriverHealth());
    }

    [Fact]
    public void GetDriverHealth_OneSnapshotPerSlot_ReflectingItsDriversKindAndHealth()
    {
        var host = CreateHost();
        var degraded = new FixedHealthDriver(DriverKind.Modbus, DriverHealthState.Degraded);
        var down = new FixedHealthDriver(DriverKind.OpcUa, DriverHealthState.Down);

        host.AdditionalPipelinesForTests = () => new List<(string Label, IDeviceDriver Driver, MappingProfile Profile)>
        {
            ("degraded-extra", degraded, TestProfile("degraded-extra")),
            ("down-extra", down, TestProfile("down-extra")),
        };

        host.Start();
        try
        {
            // StartLocked builds every slot (including these two extra ones) synchronously before Start()
            // returns — no need to wait for an actual cycle to observe them here.
            var health = host.GetDriverHealth();

            Assert.Contains(health, s => s.SlotLabel == "degraded-extra" && s.Kind == DriverKind.Modbus && s.Health == DriverHealthState.Degraded);
            Assert.Contains(health, s => s.SlotLabel == "down-extra" && s.Kind == DriverKind.OpcUa && s.Health == DriverHealthState.Down);

            // Plus the always-present simulated slot — 3 total.
            Assert.Equal(3, health.Count);
        }
        finally
        {
            host.AdditionalPipelinesForTests = null;
            host.Stop();
        }

        Assert.Empty(host.GetDriverHealth());
    }

    // ─────────────────────────────────────────────────────────────────────
    // GetKpiCounters
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void GetKpiCounters_FleetNeverRun_ReturnsZeroZero()
    {
        var host = CreateHost();
        Assert.Equal((0L, 0L), host.GetKpiCounters());
    }

    [Fact]
    public async Task GetKpiCounters_ReflectsCommittedPassAndJudgedCounts()
    {
        var host = CreateHost();
        var verdictDriver = new VerdictCyclingDriver();

        host.AdditionalPipelinesForTests = () => new List<(string Label, IDeviceDriver Driver, MappingProfile Profile)>
        {
            ("verdict-extra", verdictDriver, TestProfile("verdict-extra")),
        };

        host.Start();
        try
        {
            // 3 Pass + 1 Fail = 4 judged, 3 pass — wait for the driver to emit all 4, then for FleetHost
            // to actually commit that many cycles (OnPipelineCommitted increments the KPI counters).
            await WaitUntilAsync(() => verdictDriver.Emitted >= 4, "the verdict driver to emit its 4 fixed readings");
            await WaitUntilAsync(() => host.GetKpiCounters().TotalJudged >= 4, "FleetHost to commit at least 4 judged cycles");

            var (totalPass, totalJudged) = host.GetKpiCounters();
            Assert.True(totalJudged >= 4, $"expected TotalJudged >= 4, was {totalJudged}");
            // Exactly 3 of every 4 committed cycles from this driver are Pass; the simulated slot may
            // ALSO be contributing its own (unrelated) Pass/Fail cycles concurrently, so this only
            // asserts the invariant that must hold regardless: pass can never exceed judged.
            Assert.True(totalPass <= totalJudged, $"TotalPass ({totalPass}) must never exceed TotalJudged ({totalJudged})");
            Assert.True(totalPass > 0, "at least the verdict driver's 3 Pass readings must have been counted");
        }
        finally
        {
            host.AdditionalPipelinesForTests = null;
            host.Stop();
        }
    }

    /// <summary>Test double — reports a fixed <see cref="DriverKind"/>/<see cref="DriverHealthState"/> and
    /// never actually yields a reading (an idle, permanently-Degraded/Down driver is exactly the shape
    /// <see cref="St4i.EngineApi.Alarms.AlarmEvaluator"/>'s DriverHealth source needs to see) — it just
    /// awaits cancellation forever so its slot stays alive without ever completing/faulting.</summary>
    private sealed class FixedHealthDriver : IDeviceDriver
    {
        public FixedHealthDriver(DriverKind kind, DriverHealthState health)
        {
            Kind = kind;
            Health = health;
        }

        public string Id => "fixed-health-test-driver";

        public DriverKind Kind { get; }

        public DriverHealthState Health { get; }

        public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
        {
            var tcs = new TaskCompletionSource();
            await using var registration = ct.Register(() => tcs.TrySetResult());
            await tcs.Task.ConfigureAwait(false);
            yield break;
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }

    /// <summary>Test double — yields exactly 4 fixed-verdict Telemetry readings (3 Pass, 1 Fail) then idles
    /// forever (never faults, never re-emits) so <see cref="FleetHost.GetKpiCounters"/> settles on a known,
    /// stable (TotalPass, TotalJudged) contribution from this slot.</summary>
    private sealed class VerdictCyclingDriver : IDeviceDriver
    {
        private static readonly Verdict[] Verdicts = { Verdict.Pass, Verdict.Pass, Verdict.Pass, Verdict.Fail };
        private int _emitted;

        public int Emitted => Volatile.Read(ref _emitted);

        public string Id => "verdict-cycling-test-driver";

        public DriverKind Kind => DriverKind.Simulated;

        public DriverHealthState Health => DriverHealthState.Connected;

        public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
        {
            foreach (var verdict in Verdicts)
            {
                ct.ThrowIfCancellationRequested();
                yield return new DeviceReading
                {
                    MachineCode = "VERDICT-EXTRA",
                    Kind = ReadingKind.Telemetry,
                    SerialNumber = "SN-VERDICT-EXTRA",
                    Verdict = verdict,
                    Timestamp = DateTimeOffset.UtcNow,
                };
                Interlocked.Increment(ref _emitted);
                await Task.Delay(TimeSpan.FromMilliseconds(10), ct).ConfigureAwait(false);
            }

            // Idle forever after the fixed 4 — never fault, never re-emit, so the KPI contribution from
            // this slot settles and stays put for the test's final assertions.
            var tcs = new TaskCompletionSource();
            await using var registration = ct.Register(() => tcs.TrySetResult());
            await tcs.Task.ConfigureAwait(false);
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
