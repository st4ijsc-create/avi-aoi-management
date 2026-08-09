using System.Collections.Concurrent;
using System.Diagnostics;
using System.Diagnostics.CodeAnalysis;
using System.Runtime.CompilerServices;
using Microsoft.Extensions.Logging;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Mapping;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// 🔴 Task G-1 (.superpowers/sdd/gate-and-log-channel/task-1-brief.md, part 2) — the witness for the third
/// log channel.
///
/// <para><b>What E-2 changed, and what it actually cost.</b> <c>St4i.EdgeCore</c>'s logging convention had
/// exactly two channels, so E-2's move collapsed ten exception-carrying <c>_logger?.</c> sites onto
/// <c>LogError</c>. Recounted from the pre-E-2 source rather than from the note recording it: the ten were
/// five <c>LogWarning</c> + two <c>LogError</c> + three <c>LogDebug</c>, and there is no fourth
/// <c>LogDebug</c> site. The five <c>LogWarning</c> ones drifted in SEVERITY only —
/// <c>AddEventLog</c>'s default filter already admits Warning, so their Event Log presence did not change.
/// The three <c>LogDebug</c> ones are different in kind: <c>St4i.EngineApi</c> ships no
/// <c>appsettings.json</c>, so the framework default applied and they emitted NOTHING. They did not go from
/// Debug to Error in an operator's eyes — they went from <b>SILENT</b> to Error, and under
/// <c>AddWindowsService</c> to a synchronous Windows Event Log write on a best-effort teardown path.
///
/// <para><b>What this suite pins.</b> Two of the three sites are reachable deterministically and are
/// exercised here end to end through the real <c>FleetHost</c> — an orphaned connector driver whose
/// <c>DisposeAsync</c> throws, and a live pipeline slot's driver whose <c>DisposeAsync</c> throws on Stop.
/// Each asserts BOTH halves: the line still reaches an operator (Debug), and it no longer arrives as Error.
/// The negative is the half that matters, because "no Error on this path" is the operator-facing claim.
///
/// <para><b>What it does NOT pin, said out loud.</b> The third site
/// (<c>"old pipeline slot teardown wait observed a faulted task"</c>) is documented at its own call site as
/// defensive-only — a slot's run-task body catches everything it can throw — so nothing in this codebase
/// can make it fire. It shares the same <c>_logDebug</c> field by construction, which is a READING and not
/// a measurement; it is recorded as an untested line rather than claimed as a covered one.
///
/// <para>🔴 <b>The third test here belongs to part 1, not part 2, and it is in this file because it is
/// about the same channel.</b> A log callback is host-supplied code, and under <c>AddWindowsService</c> a
/// host wires it to a provider that writes the Windows Event Log SYNCHRONOUSLY — so blueprint §10.3(a)'s
/// four log calls made while <c>_gate</c> was held were I/O on the lock <c>Estop()</c> takes, not
/// bookkeeping. G-1 buffers them and flushes off-lock, and
/// <see cref="WhileAConnectorWarningIsBeingLogged_AReaderOfTheHaltLatchIsNotBlocked_Measured"/> is that
/// mechanism's own measurement — same instrument as the seed-callback one in
/// <c>FleetHostSeedNotificationOffGateTests</c>: time a reader of the halt latch while the host's callback
/// is deliberately slow. Without it, the log-deferral half of this task would rest on reading alone.
/// </summary>
public sealed class FleetHostTeardownLogChannelTests
{
    private const string OrphanDisposeMessage = "FleetCore orphaned connector driver dispose observed a fault";
    private const string SlotDisposeMessage = "FleetCore old pipeline slot driver dispose observed a fault";

    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(100);

    /// <summary>How long the fake logger holds the calling thread for the one nominated message. Same
    /// reasoning as the seed-callback measurement's own bound: wide enough that a lock held across the call
    /// is unmistakable, short enough that the mutant fails rather than looking like a hang.</summary>
    private static readonly TimeSpan LogCallbackBlockFor = TimeSpan.FromSeconds(2);

    /// <summary>Budget for one <c>EstopEngaged</c> read taken while the log callback above is blocking.</summary>
    private static readonly TimeSpan ReaderBudget = TimeSpan.FromMilliseconds(500);

    private static FleetHost CreateHost(RecordingLogger logger, ConnectorRegistry? connectorRegistry = null)
    {
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo);
        var eventBus = new EventBus();
        return new FleetHost(switchable, coordinator, eventBus, logger: logger, connectorRegistry: connectorRegistry);
    }

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
    public async Task OrphanedConnectorDriverDisposeFault_ReachesDebug_AndNeverError()
    {
        var logger = new RecordingLogger();
        var registry = new ConnectorRegistry();
        registry.Register(new OrphanLeakingFactory("vendor.acme.orphan"), config: "garbage");
        var host = CreateHost(logger, registry);

        host.Start();
        try
        {
            await WaitUntilAsync(
                () => logger.Has(LogLevel.Debug, OrphanDisposeMessage),
                "the orphaned-driver dispose fault to arrive on the Debug channel");

            // The operator-facing claim: this best-effort teardown line no longer writes an Error, which
            // under AddWindowsService is what put it in the Windows Event Log.
            Assert.False(
                logger.Has(LogLevel.Error, OrphanDisposeMessage),
                "a best-effort teardown fault must not arrive as Error — that is the Event Log entry this task removed");

            // And the channels have genuinely not all been collapsed onto one: the connector's own
            // could-not-be-started line is still a Warning, from the same host, in the same run.
            Assert.True(
                logger.Has(LogLevel.Warning, "vendor.acme.orphan"),
                "the connector-rejection warning must still arrive on the Warning channel");
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public void OldPipelineSlotDriverDisposeFault_ReachesDebug_AndNeverError()
    {
        var logger = new RecordingLogger();
        var host = CreateHost(logger);

        host.AdditionalPipelinesForTests = () => new List<(string Label, IDeviceDriver Driver, MappingProfile Profile)>
        {
            ("g1-dispose-throws",
             new DisposeThrowingDriver(),
             new MappingProfile { Name = "g1-dispose-throws", DeviceClass = "Automation" }),
        };

        try
        {
            host.Start();
            Assert.True(host.IsRunning);

            // Stop() is what runs WaitAndDisposeOldPipeline, off _gate, over every slot's driver.
            host.Stop();

            Assert.True(
                logger.Has(LogLevel.Debug, SlotDisposeMessage),
                "the slot-driver dispose fault should have arrived on the Debug channel");
            Assert.False(
                logger.Has(LogLevel.Error, SlotDisposeMessage),
                "a best-effort teardown fault must not arrive as Error — that is the Event Log entry this task removed");
        }
        finally
        {
            host.AdditionalPipelinesForTests = null;
            try { host.Stop(); } catch { /* best-effort */ }
        }
    }

    /// <summary>Runs <paramref name="work"/> on a DEDICATED thread rather than <see cref="Task.Run"/>.
    ///
    /// <para>🔴 Not style. The measurement below deliberately consumes its calling thread for seconds; on a
    /// thread-pool thread that is <b>thread-pool starvation injected into a 1,300-test suite whose classes
    /// xUnit runs in parallel</b> — a side effect of the harness, not of anything under test, and exactly
    /// the kind that surfaces later as some unrelated suite's intermittent failure. A dedicated thread
    /// blocks nothing but itself, and the assertion is identical either way.</para></summary>
    private static Thread RunOnItsOwnThread(Action work, string name)
    {
        var thread = new Thread(() => work()) { IsBackground = true, Name = name };
        thread.Start();
        return thread;
    }

    [Fact]
    public void WhileAConnectorWarningIsBeingLogged_AReaderOfTheHaltLatchIsNotBlocked_Measured()
    {
        const string slowId = "vendor.acme.slowlog";

        // A logger that consumes the calling thread for exactly one message — the honest model of a
        // synchronous Event Log write under AddWindowsService, which is what a host's ILogger becomes there.
        var logger = new RecordingLogger { BlockOnFragment = slowId, BlockFor = LogCallbackBlockFor };
        var registry = new ConnectorRegistry();
        registry.Register(new RejectingOnlyFactory(slowId), config: "garbage");
        var host = CreateHost(logger, registry);

        Exception? startFault = null;
        var worker = RunOnItsOwnThread(
            () => { try { host.Start(); } catch (Exception ex) { startFault = ex; } },
            "g1-slowlog-start");
        try
        {
            Assert.True(
                logger.BlockEntered.Wait(TimeSpan.FromSeconds(10)),
                "the connector-rejection warning should have reached the logger");

            // THE MEASUREMENT — the same reader blueprint §9.2 timed, against a different mechanism.
            var stopwatch = Stopwatch.StartNew();
            var latched = host.EstopEngaged;
            stopwatch.Stop();

            Assert.True(worker.Join(TimeSpan.FromSeconds(30)), "the starting thread should have finished");
            Assert.Null(startFault);
            Assert.False(latched);
            Assert.True(
                logger.Has(LogLevel.Warning, slowId),
                "a fast read while nothing was ever logged would prove nothing");

            Assert.True(
                stopwatch.Elapsed < ReaderBudget,
                $"a reader of the HALT latch waited {stopwatch.Elapsed.TotalMilliseconds:F1} ms while a " +
                $"connector warning was being logged; budget is {ReaderBudget.TotalMilliseconds:F0} ms and " +
                $"the log callback blocks for {LogCallbackBlockFor.TotalMilliseconds:F0} ms — the log call " +
                "is being made with _gate held again");
        }
        finally
        {
            logger.BlockOnFragment = null;
            worker.Join(TimeSpan.FromSeconds(30));
            host.Stop();
        }
    }

    /// <summary>Minimal <see cref="ILogger{TCategoryName}"/> recorder — keeps the LEVEL beside the rendered
    /// message, because the level IS the assertion here. Everything is enabled: a fake that filtered would
    /// answer a question about a filter rather than about which channel the call site chose.
    ///
    /// <para>It can also BLOCK on one nominated message, which is what makes the "off which lock" question
    /// measurable rather than readable.</para></summary>
    private sealed class RecordingLogger : ILogger<FleetHost>
    {
        private int _blocked;

        public ConcurrentQueue<(LogLevel Level, string Message)> Entries { get; } = new();

        /// <summary>Null (the default) means never block. Set to a message fragment to make the FIRST
        /// matching call consume its calling thread for <see cref="BlockFor"/>.</summary>
        public string? BlockOnFragment { get; set; }

        public TimeSpan BlockFor { get; set; }

        public ManualResetEventSlim BlockEntered { get; } = new(false);

        public bool Has(LogLevel level, string fragment) =>
            Entries.Any(e => e.Level == level && e.Message.Contains(fragment, StringComparison.Ordinal));

        IDisposable? ILogger.BeginScope<TState>(TState state) => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            var message = formatter(state, exception);
            Entries.Enqueue((logLevel, message));

            var fragment = BlockOnFragment;
            if (fragment is not null
                && message.Contains(fragment, StringComparison.Ordinal)
                && Interlocked.Exchange(ref _blocked, 1) == 0)
            {
                BlockEntered.Set();
                Thread.Sleep(BlockFor);
            }
        }
    }

    /// <summary>Rejects with no driver at all — isolates the connector-rejection WARNING from the orphan
    /// disposal path, so the measurement above times one mechanism and not two.</summary>
    private sealed class RejectingOnlyFactory : IConnectorFactory
    {
        public RejectingOnlyFactory(string kind) => Kind = kind;

        public string Kind { get; }

        public bool TryCreate(string config, [NotNullWhen(true)] out IDeviceDriver? driver, [NotNullWhen(false)] out string? error)
        {
            driver = null;
            error = "bad config: this factory always rejects";
            return false;
        }
    }

    /// <summary>A contract-violating factory of exactly the shape <c>StartLocked</c>'s orphan collection
    /// exists for: it reports failure yet still hands back a live driver, and that driver's
    /// <c>DisposeAsync</c> throws. <see cref="ConnectorRegistry.TryCreateDriver"/> forwards an
    /// <c>out</c> driver assigned before a false return, which is what makes this reachable.</summary>
    private sealed class OrphanLeakingFactory : IConnectorFactory
    {
        public OrphanLeakingFactory(string kind) => Kind = kind;

        public string Kind { get; }

        public bool TryCreate(string config, [NotNullWhen(true)] out IDeviceDriver? driver, [NotNullWhen(false)] out string? error)
        {
            driver = new DisposeThrowingDriver();
            error = "bad config: this factory always rejects, and leaks its driver anyway";
            return false;
        }
    }

    /// <summary>Yields nothing and throws from <c>DisposeAsync</c> — the misbehaving-driver case both
    /// teardown paths are written to absorb.</summary>
    private sealed class DisposeThrowingDriver : IDeviceDriver
    {
        public string Id => "g1-dispose-throwing-driver";

        public string Kind => "vendor.acme.orphan";

        public DriverHealthState Health => DriverHealthState.Connected;

        public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
        {
            while (true)
            {
                ct.ThrowIfCancellationRequested();
                await Task.Delay(TimeSpan.FromMilliseconds(50), ct).ConfigureAwait(false);
            }

#pragma warning disable CS0162 // unreachable: this method is an iterator with no yield on its live path
            yield break;
#pragma warning restore CS0162
        }

        public ValueTask DisposeAsync() =>
            throw new InvalidOperationException("g1: this driver's DisposeAsync always faults");
    }
}
