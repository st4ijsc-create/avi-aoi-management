using St4i.EdgeCore.Historian;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Metrics;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// WS-A-T14 (capstone) — proves the literal WS-A acceptance criterion: "restart vẫn còn dữ liệu + OEE"
/// (data — and a non-trivial OEE computed from it — survives a process restart). A restarted process just
/// news up a fresh <see cref="SqliteHistorianStore"/> pointed at the same on-disk directory (see
/// <c>Program.cs</c>'s WS-A-T14 <c>ST4I_HISTORIAN_DIR</c> seam), so this test simulates exactly that:
/// <list type="number">
/// <item>Compose #1 — a real <see cref="SqliteHistorianStore"/> + <see cref="HistorianWriter"/> + a real
/// <see cref="FleetHost"/> (same fake-transport composition
/// <see cref="FleetHostHistorianWiringTests.CreateHostWithHistorian"/> already uses), rooted at a fresh temp
/// directory. Start the fleet, let several cycles and an operator Start run-event flow through, Stop, then
/// <c>await writer.DisposeAsync()</c> so every buffered record drains before the process (simulated here by
/// just letting compose #1's objects fall out of scope) "restarts".</item>
/// <item>Compose #2 — a BRAND NEW <see cref="SqliteHistorianStore"/> instance pointed at the SAME directory
/// (no writer, no fleet — this is the "cold read after restart" side). Assert
/// <see cref="IHistorianStore.GetStatsAsync"/> sees rows, and that <see cref="OeeCalculator.Calculate"/> over
/// <see cref="IHistorianStore.AggregateForOeeAsync"/>'s aggregate for that same window yields a non-trivial
/// (TotalCount &gt; 0, RunTime &gt; 0, Oee &gt; 0) result — i.e. both the raw rows AND everything
/// derived from them (the run-event timeline driving Availability) persisted across the "restart", not just
/// an empty/zeroed-out shell.</item>
/// </list>
/// </summary>
public sealed class HistorianRestartSurvivalTests
{
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(50);

    private static async Task WaitUntilAsync(Func<bool> predicate, string because) =>
        await WaitUntilAsync(() => Task.FromResult(predicate()), because);

    private static async Task WaitUntilAsync(Func<Task<bool>> predicate, string because)
    {
        var deadline = DateTime.UtcNow + PollTimeout;
        while (DateTime.UtcNow < deadline)
        {
            if (await predicate()) return;
            await Task.Delay(PollInterval);
        }

        Assert.True(await predicate(), $"timed out after {PollTimeout} waiting for: {because}");
    }

    /// <summary>Same fake-transport composition as
    /// <see cref="FleetHostHistorianWiringTests.CreateHostWithHistorian"/> — Demo mode, no real network —
    /// plus a real <see cref="HistorianWriter"/> over the given (real, on-disk) <paramref name="store"/>.</summary>
    private static (FleetHost Host, HistorianWriter Writer) ComposeFleetOverStore(IHistorianStore store)
    {
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo);
        var eventBus = new EventBus();

        var writer = new HistorianWriter(store);
        var host = new FleetHost(switchable, coordinator, eventBus, historianWriter: writer);
        return (host, writer);
    }

    [Fact]
    public async Task DataWrittenBeforeARestart_IsVisible_AndYieldsANonTrivialOee_FromAFreshStoreOnTheSameDirectory()
    {
        var tempDir = Directory.CreateTempSubdirectory("st4i-historian-restart-tests-").FullName;
        const string machineCode = "SCRW-01"; // shipped default roster, CycleSeconds = 0.8 (fast enough to cycle several times in-test)

        var windowStart = DateTimeOffset.UtcNow;

        // ── Compose #1 — "before the restart": real store + writer + a running FleetHost on tempDir.
        var store1 = new SqliteHistorianStore(tempDir);
        var (host, writer) = ComposeFleetOverStore(store1);
        try
        {
            host.Start();

            // Several cycles for SCRW-01 (not just one) — a meaningful amount of production history, not a
            // single vacuous reading.
            await WaitUntilAsync(() => (host.MachineDetail(machineCode)?.Cycles ?? 0) >= 3,
                $"{machineCode} to complete at least 3 cycles while running");

            // The historian actually received result rows for that running machine (proves the writer is
            // draining into store1, not just buffering in RAM).
            await WaitUntilAsync(async () => (await store1.GetStatsAsync(CancellationToken.None)).ResultRowCount > 0,
                "store1 to have received at least one committed result row");

            host.Stop();

            // The operator Start/Stop run-event pair landed too (drives OEE's Availability/RunTime below).
            await WaitUntilAsync(
                async () => (await store1.QueryRunEventsAsync(windowStart, DateTimeOffset.UtcNow, CancellationToken.None))
                    .Any(e => e.EventType == "Stop"),
                "the 'Stop' run event to be recorded");
        }
        finally
        {
            host.Stop();
            // Drains whatever is still buffered in the channel — the "clean shutdown before restart" step
            // the brief calls out. Nothing written after this point.
            await writer.DisposeAsync();
        }

        var windowEndFinal = DateTimeOffset.UtcNow;

        // Sanity check BEFORE simulating the restart, so a later assertion failure can't be blamed on a bad
        // seed: compose #1's own store instance already sees everything it just wrote.
        var preRestartStats = await store1.GetStatsAsync(CancellationToken.None);
        Assert.True(preRestartStats.ResultRowCount > 0, "compose #1's own store should see its own writes before any restart is simulated");

        // ── Compose #2 — "after the restart": a BRAND NEW SqliteHistorianStore instance pointed at the SAME
        // directory. No FleetHost, no writer — purely a cold read, exactly what a freshly-restarted process's
        // DI container would construct (Program.cs's `new SqliteHistorianStore(historianDir)` registration).
        var store2 = new SqliteHistorianStore(tempDir);

        var statsAfterRestart = await store2.GetStatsAsync(CancellationToken.None);
        Assert.True(statsAfterRestart.ResultRowCount > 0, "a fresh store on the same directory should see the rows written before the 'restart'");
        Assert.Equal(preRestartStats.ResultRowCount, statsAfterRestart.ResultRowCount);

        // OEE computed post-"restart" is non-trivial — TotalCount matches what actually ran, RunTime > 0
        // (the Start/Stop run events persisted too), and the composite Oee score is > 0.
        //
        // SM-2 fix round 1 — this test's own SCRW-01 machine is the SHIPPED demo fleet's genuinely
        // Simulated (fabricated) driver, so its rows are now correctly tagged `is_fabricated: true` and
        // excluded from a default (non-opt-in) AggregateForOeeAsync call, same as every other fabricated
        // row on any customer-facing surface — see SqliteHistorianStore.ApplyRealPresenceGateAsync's own
        // doc comment. This test's OWN purpose (WS-A-T14: data + OEE survive a process restart) is
        // orthogonal to SM-2's provenance filtering — it just happens to use the demo fleet as a
        // convenient, already-wired real pipeline — so it opts into `includeFabricated: true` to keep
        // proving restart-survival, not re-litigate provenance filtering.
        //
        // Fix 1 (task-7 review, CRITICAL) — this explicit opt-in was, in hindsight, the demo-carve-out
        // signal in hand a full task early: this is the one pre-existing test combining a REAL FleetHost +
        // REAL store + the demo fleet, and it needed `includeFabricated: true` for exactly the same reason
        // a fresh exhibition install's `/historian`/`/reports` rendered nothing by default — a 100%-
        // Simulated roster has no default-visible rows at all without it. This test calls
        // `IHistorianStore.AggregateForOeeAsync` directly (store layer, bypassing
        // `St4i.EngineApi.Endpoints.HistorianEndpoints` entirely), so it is UNAFFECTED by
        // `HistorianEndpoints.ResolveIncludeFabricated`'s new `DemoModeGate`-keyed default and correctly
        // keeps its own explicit opt-in — the fix that default needed landed one endpoint layer up, not
        // here.
        var aggregate = await store2.AggregateForOeeAsync(machineCode, windowStart, windowEndFinal, CancellationToken.None, includeFabricated: true);
        Assert.True(aggregate.TotalCount > 0, "AggregateForOeeAsync should count the ProcessResult rows written before the restart");
        Assert.True(aggregate.RunTime > TimeSpan.Zero, "AggregateForOeeAsync should reconstruct a non-zero run-time from the persisted Start/Stop run events");

        const double idealCycleSeconds = 0.8; // SCRW-01's fleet.json cycleSeconds — no OeeSettingsStore override in this test
        var oee = OeeCalculator.Calculate(aggregate, plannedProductionTime: aggregate.RunTime, idealCycleSeconds: idealCycleSeconds);

        Assert.Equal(aggregate.TotalCount, oee.TotalCount);
        Assert.True(oee.Oee > 0, "the OEE score computed from a fresh post-restart store should be non-trivial (> 0), not a zeroed-out empty shell");
        Assert.True(oee.Availability > 0, "Availability should reflect the persisted run-time");
        Assert.True(oee.Quality > 0, "Quality should reflect the persisted (mostly-Pass) result rows");
    }
}
