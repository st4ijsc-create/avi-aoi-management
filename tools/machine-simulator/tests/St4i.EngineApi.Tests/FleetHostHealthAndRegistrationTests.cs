using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// E1 — proves the two things the FleetHost health-truth + dynamic-registration brief called out as
/// missing:
///
///  1. Health-truth: <see cref="FleetHost.Snapshot"/>'s <c>online</c> KPI and every tile's status must
///     reflect whether the fleet pipeline is actually RUNNING right now, not "ever produced a cycle" —
///     the bug being guarded against is a dashboard that stays "N/N online, all green" forever after
///     <see cref="FleetHost.Stop"/> (because <c>MachineState.Cycles</c> never resets).
///
///  2. Dynamic registration: <see cref="FleetHost.RegisterMachine"/> adds a machine to the live roster —
///     visible immediately (idle, 0 cycles) whether the fleet is stopped or running, and actually
///     cycling once (re)started — without regressing the lock-free <c>Snapshot()</c>/<c>MachineDetail()</c>
///     read path this engine was praised for.
/// </summary>
public sealed class FleetHostHealthAndRegistrationTests
{
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(100);

    /// <summary>Same composition FleetHost's own DI wiring in Program.cs uses, minus the ASP.NET host —
    /// default mode is Demo (SwitchableTransport wraps DemoTransport), so no real network call is ever
    /// made by any of these tests. The LiveTransport instance is only there to satisfy
    /// TransportCoordinator's constructor; nothing switches to Live mode in these tests.</summary>
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

    /// <summary>A short CycleSeconds so tests don't have to wait long for a first reading — fleet.json's
    /// own machines cycle as slow as 0.8-2.0s, which would make every poll below needlessly slow.</summary>
    private static MachineDescriptor NewFastMachine(string code) => new(
        code, $"SN-{code}", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening",
        DriverKind.Simulated, "RC-TEST-A", null, CycleSeconds: 0.1);

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
    public async Task Snapshot_WhileRunning_ReportsOnlineAndRealStatus()
    {
        var host = CreateHost();

        host.Start();
        try
        {
            await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "at least one machine online while running");

            var snapshot = host.Snapshot();
            Assert.True(snapshot.IsRunning);
            Assert.True(snapshot.Kpis.Online > 0);
            // Running behavior must be unchanged: a machine that has cycled reports its real verdict
            // text (e.g. "OK"/"WARN"/"FAIL"/"TELEMETRY"), never forced to "Idle" while running.
            Assert.Contains(snapshot.Machines, m => m.Cycles > 0 && m.StatusText != "Idle");
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public async Task Snapshot_AfterStop_OnlineIsZero_TilesReadIdle_CountersStayVisible()
    {
        var host = CreateHost();

        host.Start();
        await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "fleet online before stopping");

        host.Stop();

        var stopped = host.Snapshot();
        Assert.False(stopped.IsRunning);
        Assert.Equal(0, stopped.Kpis.Online);
        Assert.All(stopped.Machines, m => Assert.Equal("Idle", m.StatusText));

        // The bug this guards against isn't just the KPI — every tile must stop reading as
        // online/healthy too, not just the aggregate count.
        Assert.DoesNotContain(stopped.Machines, m => m.StatusText is "OK" or "WARN" or "FAIL" or "TELEMETRY");

        // Last-known counters must still be visible (a machine that ran then stopped isn't wiped back
        // to a blank slate) — only the displayed status changes.
        Assert.Contains(stopped.Machines, m => m.Cycles > 0);
    }

    [Fact]
    public async Task RegisterMachine_WhileStopped_AppearsIdleImmediately_ThenCyclesAfterStart()
    {
        var host = CreateHost();
        const string code = "E1-NEW-01";

        Assert.False(host.IsRunning);
        var added = host.RegisterMachine(NewFastMachine(code));
        Assert.True(added);

        // Visible immediately — idle, 0 cycles — with no Start() at all.
        var beforeStart = host.Snapshot();
        var tile = Assert.Single(beforeStart.Machines, m => m.Code == code);
        Assert.Equal("Idle", tile.StatusText);
        Assert.Equal(0, tile.Cycles);
        Assert.NotNull(host.MachineDetail(code));

        host.Start();
        try
        {
            await WaitUntilAsync(() => host.MachineDetail(code)?.Cycles > 0, $"{code} to produce a cycle after Start");

            var running = host.Snapshot();
            Assert.True(running.Kpis.Online > 0);
            Assert.Contains(running.Machines, m => m.Code == code && m.Cycles > 0);
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public async Task RegisterMachine_WhileRunning_RestartsPipeline_NewMachineStartsCycling_ExistingMachinesSurvive()
    {
        var host = CreateHost();

        host.Start();
        try
        {
            await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "fleet online before registering mid-run");
            var preRegisterCycles = host.MachineDetail("SCRW-01")?.Cycles ?? 0;

            const string code = "E1-NEW-02";
            var added = host.RegisterMachine(NewFastMachine(code));
            Assert.True(added);

            // The restart (StopLocked+StartLocked under the same call) must leave the fleet RUNNING,
            // not stopped — RegisterMachine's contract is "add and keep going", not "add and halt".
            Assert.True(host.IsRunning, "registering mid-run must leave the pipeline running, not stopped");

            await WaitUntilAsync(() => host.MachineDetail(code)?.Cycles > 0, $"{code} to cycle after being registered while running");

            // A pre-existing machine keeps accumulating (possibly via the I-1 cycle-offset across the
            // restart) rather than losing its history — MachineState objects are never replaced.
            await WaitUntilAsync(() => (host.MachineDetail("SCRW-01")?.Cycles ?? 0) >= preRegisterCycles, "SCRW-01's cycle count to never regress across the restart");
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public void RegisterMachine_DuplicateCodeCaseInsensitive_RejectedWithoutCrashOrDuplicateTile()
    {
        var host = CreateHost();
        const string code = "E1-DUP-01";

        Assert.True(host.RegisterMachine(NewFastMachine(code)));
        var countAfterFirst = host.Snapshot().Machines.Count(m => string.Equals(m.Code, code, StringComparison.OrdinalIgnoreCase));
        Assert.Equal(1, countAfterFirst);

        Assert.False(host.RegisterMachine(NewFastMachine(code))); // exact-case duplicate
        Assert.False(host.RegisterMachine(NewFastMachine(code.ToLowerInvariant()))); // case-insensitive duplicate
        Assert.False(host.RegisterMachine(NewFastMachine(code.Replace("DUP", "dup")))); // mixed-case duplicate

        var countAfterDuplicates = host.Snapshot().Machines.Count(m => string.Equals(m.Code, code, StringComparison.OrdinalIgnoreCase));
        Assert.Equal(1, countAfterDuplicates);
    }

    [Fact]
    public async Task Snapshot_And_MachineDetail_ConcurrentWithRegisterMachine_NeverThrowOrTear()
    {
        var host = CreateHost();
        host.Start();

        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2.5));
            var readerExceptions = new List<Exception>();
            var readerTask = Task.Run(() =>
            {
                while (!cts.IsCancellationRequested)
                {
                    try
                    {
                        _ = host.Snapshot();
                        _ = host.MachineDetail("SCRW-01");
                        _ = host.Fleet.Count;
                    }
                    catch (Exception ex)
                    {
                        readerExceptions.Add(ex);
                        break;
                    }
                }
            });

            for (var i = 0; i < 15 && !cts.IsCancellationRequested; i++)
            {
                host.RegisterMachine(NewFastMachine($"E1-CONC-{i:00}"));
                await Task.Delay(30);
            }

            cts.Cancel();
            await readerTask;

            Assert.Empty(readerExceptions);
        }
        finally
        {
            host.Stop();
        }
    }
}
