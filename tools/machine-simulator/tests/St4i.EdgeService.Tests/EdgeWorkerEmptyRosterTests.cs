using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using St4i.EdgeCore.Config;
using Xunit;

namespace St4i.EdgeService.Tests;

/// <summary>
/// SM-1b (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-1b-brief.md) —
/// <see cref="EdgeWorker.ExecuteAsync"/> with a product-mode empty roster (see
/// <c>EdgeWorkerLoadFleetTests</c> for the <see cref="EdgeWorker.LoadFleet"/>-level coverage that gets
/// EdgeWorker into this state). Two things are pinned here that a plain "does LoadFleet return empty"
/// test cannot reach:
///
/// <list type="bullet">
/// <item>Without a real fix, a <see cref="BackgroundService"/> whose <see cref="EdgeWorker.ExecuteAsync"/>
/// completes on its own (never faults, never awaits anything) does NOT stop the Generic Host by itself —
/// nothing else ever calls <see cref="IHostApplicationLifetime.StopApplication"/> in an empty-roster run,
/// so the real process would hang forever waiting for an external Ctrl-C/service-stop it may never
/// receive. These tests prove <see cref="EdgeWorker.ExecuteAsync"/> calls
/// <see cref="IHostApplicationLifetime.StopApplication"/> itself and completes promptly either way.</item>
/// <item><c>--smoke N</c>'s whole contract is "commit N readings, then exit 0" — with zero machines that
/// can never happen, so this task's chosen answer is a loud, immediate, non-zero exit
/// (<see cref="EdgeWorker.SmokeEmptyRosterExitCode"/>) instead of hanging or reporting a false pass.</item>
/// </list>
///
/// Runs the REAL <see cref="EdgeWorker.ExecuteAsync"/> via the public <see cref="BackgroundService"/>
/// surface (<c>StartAsync</c>/<c>ExecuteTask</c>) rather than calling it directly (it is <c>protected</c>)
/// — the same seam any real <c>IHostedService</c> consumer (the Generic Host itself) uses.
/// </summary>
public sealed class EdgeWorkerEmptyRosterTests
{
    private static readonly TimeSpan NoHangTimeout = TimeSpan.FromSeconds(10);

    private static EdgeWorker NewWorker(int? smokeCount, RecordingHostApplicationLifetime lifetime) =>
        new(NullLogger<EdgeWorker>.Instance, lifetime,
            new EdgeServiceOptions(SmokeCount: smokeCount, FleetPath: null),
            demoModeGate: new DemoModeGate("false")); // explicit product mode, no --fleet ⇒ empty roster

    /// <summary>Runs <paramref name="worker"/> to completion (or fails the test if it hangs past
    /// <see cref="NoHangTimeout"/>) and returns the completed <see cref="BackgroundService.ExecuteTask"/>
    /// so the caller can assert on it (surfacing any exception via <c>await</c>).</summary>
    private static async Task RunToCompletionOrFail(EdgeWorker worker)
    {
        await worker.StartAsync(CancellationToken.None);
        var executeTask = worker.ExecuteTask!;

        // 🔴 backlog-test-deadlines — the assertion below fires exactly when the WhenAny lost, i.e. exactly
        // when `executeTask` is STILL RUNNING, and it used to return from this helper leaving that task
        // running with nothing able to end it. `BackgroundService.StopAsync` is the seam the Generic Host
        // itself uses: it signals ExecuteAsync's own stopping token and then waits for the task. Calling it
        // from a `finally` means the failure path CANCELS and joins instead of abandoning. On the green path
        // `executeTask` has already completed and StopAsync returns immediately, so nothing changes there.
        //
        // The token handed to StopAsync is the SAME `NoHangTimeout` this helper already uses, not a new
        // constant, and it is what stops the teardown becoming the hang it exists to prevent: StopAsync waits
        // via `Task.WhenAny(_executeTask, Task.Delay(Infinite, cancellationToken))`, so passing
        // CancellationToken.None here would wait FOREVER on a worker that ignored its stopping token.
        using var stopDeadline = new CancellationTokenSource(NoHangTimeout);
        try
        {
            var finished = await Task.WhenAny(executeTask, Task.Delay(NoHangTimeout));
            Assert.True(ReferenceEquals(finished, executeTask), "EdgeWorker.ExecuteAsync hung with an empty roster instead of completing.");

            await executeTask; // surface any exception instead of swallowing it
        }
        finally
        {
            try { await worker.StopAsync(stopDeadline.Token); } catch { /* teardown */ }
        }
    }

    [Fact]
    public async Task ExecuteAsync_ProductMode_EmptyRoster_NoSmoke_CompletesCleanly_AndStopsTheHost()
    {
        var lifetime = new RecordingHostApplicationLifetime();
        var worker = NewWorker(smokeCount: null, lifetime);
        var previousExitCode = Environment.ExitCode;
        Environment.ExitCode = 0;
        try
        {
            await RunToCompletionOrFail(worker);

            Assert.Equal(1, lifetime.StopApplicationCallCount);
            // A plain (non-smoke) empty-roster run is a genuine supported state, not a failure.
            Assert.Equal(0, Environment.ExitCode);
        }
        finally
        {
            Environment.ExitCode = previousExitCode;
        }
    }

    [Fact]
    public async Task ExecuteAsync_ProductMode_EmptyRoster_WithSmoke_DoesNotHang_ExitsNonZero_StopsTheHost()
    {
        var lifetime = new RecordingHostApplicationLifetime();
        var worker = NewWorker(smokeCount: 5, lifetime);
        var previousExitCode = Environment.ExitCode;
        Environment.ExitCode = 0;
        try
        {
            await RunToCompletionOrFail(worker);

            Assert.Equal(1, lifetime.StopApplicationCallCount);
            Assert.Equal(EdgeWorker.SmokeEmptyRosterExitCode, Environment.ExitCode);
            Assert.NotEqual(0, Environment.ExitCode); // never a false "smoke passed"
        }
        finally
        {
            Environment.ExitCode = previousExitCode;
        }
    }

    /// <summary>Records every <see cref="StopApplication"/> call instead of doing nothing — the rest of
    /// <see cref="IHostApplicationLifetime"/> is unused by <see cref="EdgeWorker.ExecuteAsync"/>'s
    /// empty-roster path, same as <c>EdgeWorkerLoadFleetTests.NoOpHostApplicationLifetime</c>.</summary>
    private sealed class RecordingHostApplicationLifetime : IHostApplicationLifetime
    {
        public int StopApplicationCallCount { get; private set; }
        public CancellationToken ApplicationStarted => CancellationToken.None;
        public CancellationToken ApplicationStopping => CancellationToken.None;
        public CancellationToken ApplicationStopped => CancellationToken.None;
        public void StopApplication() => StopApplicationCallCount++;
    }
}
