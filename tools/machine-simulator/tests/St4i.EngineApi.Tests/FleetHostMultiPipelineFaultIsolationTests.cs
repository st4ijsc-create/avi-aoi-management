using System.Runtime.CompilerServices;
using St4i.Connector.Abstractions;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Mapping;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// G2-5 (WS-H prerequisite, docs/plans/2026-07-27-giaidoan2-synapse-connect-blueprint task 5) — proves
/// <see cref="FleetHost"/> now runs N independent pipeline "slots" (its own run-task + CTS each) with
/// PER-SLOT fault isolation: one slot's driver throwing a non-cancellation exception removes ONLY that
/// slot — the aggregate <see cref="FleetHost.IsRunning"/> stays true and every sibling slot (the
/// simulated fleet, and any other extra slot) keeps producing. This is the load-bearing prerequisite for
/// G2-6's real Modbus driver: a flaky OT link must never be able to tear down the whole fleet the way a
/// single fleet-wide pipeline used to.
///
/// Uses <see cref="FleetHost.AdditionalPipelinesForTests"/> (mirrors the pre-existing
/// <see cref="FleetHost.DriverDecoratorForTests"/> seam — <c>internal</c>, requires
/// <c>InternalsVisibleTo</c>) to inject extra pipeline groups deterministically, since no real second
/// driver kind exists yet (that's G2-6's job) — every roster machine is still simulated here, exactly as
/// today.
/// </summary>
public sealed class FleetHostMultiPipelineFaultIsolationTests
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

    private static MachineDescriptor NewFastMachine(string code) => new(
        code, $"SN-{code}", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening",
        DriverKinds.Simulated, "RC-TEST-A", null, CycleSeconds: 0.1);

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
    public async Task FaultingExtraSlot_FaultsInIsolation_SimAndHealthyExtraSlotsKeepRunning()
    {
        var host = CreateHost();
        var healthy = new HealthyCountingDriver();
        var faulty = new FaultingAfterNDriver(faultAfter: 2);

        host.AdditionalPipelinesForTests = () => new List<(string Label, IDeviceDriver Driver, MappingProfile Profile)>
        {
            ("healthy-extra", healthy, TestProfile("healthy-extra")),
            ("faulty-extra", faulty, TestProfile("faulty-extra")),
        };

        host.Start();
        try
        {
            await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "simulated slot online after Start");
            await WaitUntilAsync(() => healthy.Count > 0, "healthy extra slot producing before the faulty sibling dies");

            // Let the faulty extra slot actually throw, and give FleetHost's per-slot catch a moment to
            // record it.
            await WaitUntilAsync(() => faulty.HasFaulted, "faulty extra slot to reach its simulated fault");
            await WaitUntilAsync(() => host.LastError is not null, "LastError to be set by the faulted extra slot");

            // The load-bearing assertion: a fault in ONE slot must not tear down the fleet.
            Assert.True(host.IsRunning, "a faulted extra slot must not flip the aggregate IsRunning false while sibling slots are alive");

            var healthyCountAfterFault = healthy.Count;
            await WaitUntilAsync(() => healthy.Count > healthyCountAfterFault, "the healthy extra slot to keep producing after its faulty sibling died");
            Assert.True(host.Snapshot().Kpis.Online > 0, "the simulated slot must keep producing after the faulty extra slot died");
        }
        finally
        {
            host.AdditionalPipelinesForTests = null;
            host.Stop();
        }

        Assert.False(host.IsRunning, "Stop() must tear every remaining slot (sim + any still-live extra) down");
    }

    /// <summary>Single-slot regression: with NO extra slots (today's world — exactly the simulated
    /// pipeline), a fault must still behave exactly as before this refactor — the LAST (only) slot
    /// faulting flips the aggregate <see cref="FleetHost.IsRunning"/> false and sets
    /// <see cref="FleetHost.LastError"/>.</summary>
    [Fact]
    public async Task SingleSlotFault_NoExtraSlots_FlipsIsRunningFalse_AndSetsLastError()
    {
        var host = CreateHost();
        host.DriverDecoratorForTests = driver => new ThrowAfterDelayDriver(driver, TimeSpan.FromMilliseconds(500));

        host.Start();
        try
        {
            await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "sim slot online before it faults");
            await WaitUntilAsync(() => !host.IsRunning, "the sole (sim) slot faulting must flip aggregate IsRunning false, same as before this refactor");
            Assert.NotNull(host.LastError);
        }
        finally
        {
            host.DriverDecoratorForTests = null;
            host.Stop(); // no-op: the sole slot already faulted itself out, exactly as StopLocked on an already-stopped fleet always was
        }
    }

    /// <summary>Restart survives extra slots: <see cref="FleetHost.RegisterMachine"/> mid-run rebuilds
    /// ALL slots (StopLocked all → StartLocked all) — the pre-existing sim machine's counters survive,
    /// the newly-registered machine cycles, AND the extra injected slot is rebuilt and keeps producing
    /// after the restart (proving <see cref="FleetHost.AdditionalPipelinesForTests"/> is re-invoked fresh
    /// on every StartLocked, not just the very first one).</summary>
    [Fact]
    public async Task RegisterMachine_WhileRunning_WithExtraSlot_RebuildsAllSlots_ExistingAndExtraSurvive()
    {
        var host = CreateHost();
        var healthy = new HealthyCountingDriver();
        host.AdditionalPipelinesForTests = () => new List<(string Label, IDeviceDriver Driver, MappingProfile Profile)>
        {
            ("healthy-extra", healthy, TestProfile("healthy-extra")),
        };

        host.Start();
        try
        {
            await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "sim slot online before registering mid-run");
            await WaitUntilAsync(() => healthy.Count > 0, "healthy extra slot producing before registering mid-run");

            var preRegisterCycles = host.MachineDetail("SCRW-01")?.Cycles ?? 0;
            var extraCountBeforeRegister = healthy.Count;

            const string code = "G2-5-MULTI-01";
            var added = host.RegisterMachine(NewFastMachine(code));
            Assert.True(added);

            Assert.True(host.IsRunning, "registering mid-run with an extra slot present must leave the fleet running, not stopped");

            await WaitUntilAsync(() => host.MachineDetail(code)?.Cycles > 0, $"{code} to cycle after being registered while running");
            await WaitUntilAsync(() => (host.MachineDetail("SCRW-01")?.Cycles ?? 0) >= preRegisterCycles, "SCRW-01's cycle count to never regress across the restart");
            await WaitUntilAsync(() => healthy.Count > extraCountBeforeRegister, "the extra slot to be rebuilt (same driver instance) and keep producing after the restart");
        }
        finally
        {
            host.AdditionalPipelinesForTests = null;
            host.Stop();
        }
    }

    /// <summary>Test double — an <see cref="IDeviceDriver"/> that yields a Telemetry reading on a short
    /// interval forever (until cancelled), incrementing a thread-safe, externally-visible counter each
    /// time so a test can observe "did this keep producing after some OTHER slot faulted".</summary>
    private sealed class HealthyCountingDriver : IDeviceDriver
    {
        private int _count;

        public int Count => Volatile.Read(ref _count);

        public string Id => "healthy-counting-test-driver";

        public string Kind => DriverKinds.Simulated;

        public DriverHealthState Health => DriverHealthState.Connected;

        public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
        {
            while (true)
            {
                ct.ThrowIfCancellationRequested();
                Interlocked.Increment(ref _count);
                yield return new DeviceReading
                {
                    MachineCode = "HEALTHY-EXTRA",
                    Kind = ReadingKind.Telemetry,
                    SerialNumber = "SN-HEALTHY-EXTRA",
                    Timestamp = DateTimeOffset.UtcNow,
                };
                await Task.Delay(TimeSpan.FromMilliseconds(20), ct).ConfigureAwait(false);
            }
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }

    /// <summary>Test double — an <see cref="IDeviceDriver"/> that yields <paramref name="faultAfter"/>-worth
    /// of Telemetry readings and then throws a plain (non-<see cref="OperationCanceledException"/>)
    /// exception — the shape a real flaky OT driver would produce mid-run, as opposed to
    /// <c>FaultyTeardownDriver</c> in <c>FleetHostHealthAndRegistrationTests</c> which only misbehaves
    /// during teardown.</summary>
    private sealed class FaultingAfterNDriver : IDeviceDriver
    {
        private readonly int _faultAfter;
        private volatile bool _hasFaulted;

        public FaultingAfterNDriver(int faultAfter) => _faultAfter = faultAfter;

        public bool HasFaulted => _hasFaulted;

        public string Id => "faulting-test-driver";

        public string Kind => DriverKinds.Simulated;

        public DriverHealthState Health => DriverHealthState.Connected;

        public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
        {
            for (var i = 0; i < _faultAfter; i++)
            {
                ct.ThrowIfCancellationRequested();
                yield return new DeviceReading
                {
                    MachineCode = "FAULTY-EXTRA",
                    Kind = ReadingKind.Telemetry,
                    SerialNumber = "SN-FAULTY-EXTRA",
                    Timestamp = DateTimeOffset.UtcNow,
                };
                await Task.Delay(TimeSpan.FromMilliseconds(20), ct).ConfigureAwait(false);
            }

            _hasFaulted = true;
            throw new InvalidOperationException("FaultingAfterNDriver: simulated non-cancellation fault (test double)");
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }

    /// <summary>Test double for <see cref="SingleSlotFault_NoExtraSlots_FlipsIsRunningFalse_AndSetsLastError"/>
    /// — wraps the REAL simulated driver <see cref="FleetHost.DriverDecoratorForTests"/> hands it, passes
    /// readings through unchanged for <paramref name="delay"/> (comfortably long enough for at least one
    /// full round of the fleet's sims to cycle, so the test can observe the fleet genuinely online first),
    /// then throws a plain exception (never <see cref="OperationCanceledException"/>) on the next reading
    /// — a real driver bug mid-run, as opposed to <c>FaultyTeardownDriver</c> in
    /// <c>FleetHostHealthAndRegistrationTests</c> which only misbehaves during teardown. Time-based
    /// (rather than counting N readings) so the fault point doesn't have to be tuned against fleet.json's
    /// exact machine count/cadences.</summary>
    private sealed class ThrowAfterDelayDriver : IDeviceDriver
    {
        private readonly IDeviceDriver _inner;
        private readonly TimeSpan _delay;
        private readonly System.Diagnostics.Stopwatch _stopwatch = System.Diagnostics.Stopwatch.StartNew();

        public ThrowAfterDelayDriver(IDeviceDriver inner, TimeSpan delay)
        {
            _inner = inner;
            _delay = delay;
        }

        public string Id => _inner.Id;

        public string Kind => _inner.Kind;

        public DriverHealthState Health => _inner.Health;

        public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
        {
            await foreach (var reading in _inner.ReadAsync(ct).WithCancellation(ct).ConfigureAwait(false))
            {
                if (_stopwatch.Elapsed > _delay)
                {
                    throw new InvalidOperationException("ThrowAfterDelayDriver: simulated fault (test double)");
                }

                yield return reading;
            }
        }

        public ValueTask DisposeAsync() => _inner.DisposeAsync();
    }
}
