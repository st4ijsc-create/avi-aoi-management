using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;
using System.Runtime.CompilerServices;
using Microsoft.Extensions.Logging;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Engine;
using St4i.EdgeCore.Historian;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Mapping;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EdgeCore.Uns;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// 🔴 Task G-2 (.superpowers/sdd/gate-and-log-channel/task-2-brief.md) — the witnesses for the defect CLASS
/// G-1 found one instance of and explicitly did not sweep for.
///
/// <para><b>The class.</b> State written while <c>FleetCore._gate</c> — the lock <c>Estop()</c> takes — is
/// held, never rolled back, whose correctness depends on a step that runs AFTER the lock is released. Every
/// throw in between loses the completion. G-1 closed one member (the seed-notification queue); an independent
/// sweep found <b>five</b> more, and re-deriving the set added a sixth (S7) that the sweep's
/// single-completion table could not represent — <b>seven members in total</b>. See
/// <c>FleetCore._gate</c>'s banner, which is the canonical list and labels every row with its S-number.
///
/// <para>🔴 This sentence read "found six more" until the whole-branch review. It is the <i>verbatim</i>
/// sentence a task review had already raised as Critical and corrected in <c>FleetCore.cs</c> — and the
/// correction pass was scoped to the file being edited, so this copy stood. "Retracted in one place, left
/// standing in another", for the third time on this branch. Recorded here rather than silently fixed,
/// because the pattern is the finding.</para>
///
/// <para><b>Why these tests exist in this shape, rather than as assertions about where a call sits.</b> Every
/// one of them drives a throw through a HOST SEAM and then asserts the CONSEQUENCE the completion exists to
/// prevent — a driver released, a pipeline rebuilt, a scenario reverted. Blueprint §8.1's fifth rule: measure
/// the effect on the thing the mechanism protects, on the production path. A test that asserted "the
/// disposal is inside a finally" would pass on a `finally` that disposed the wrong thing.</para>
///
/// <para><b>The three seams used, and why each is a legitimate throw site rather than a contrivance.</b>
/// <list type="number">
/// <item><see cref="IUnsPublisher"/>. Its two node-lifecycle methods are called with <c>_gate</c> HELD, on
/// purpose (they serialise NBIRTH/NDEATH ordering with the transition). The field is the INTERFACE, so any
/// host implementation runs there, and the interface's "never throws" is a promise, not a bound — this is
/// FleetCore's own enumeration item 8.</item>
/// <item>The host log callbacks. <c>FleetCore</c>'s seam is a plain <c>Action&lt;string&gt;</c>/
/// <c>Action&lt;Exception,string&gt;</c>; a delegate that throws is a throw site by construction. In
/// production a host wires them to an <c>ILogger</c> — and
/// <c>Microsoft.Extensions.Logging.Logger.Log</c> collects each provider's exception and rethrows them as an
/// <c>AggregateException</c> rather than swallowing them, so a failing Event Log provider under
/// <c>AddWindowsService</c> throws out of a log call. (That second sentence is READ from the framework's
/// contract, not measured here; nothing in these tests depends on it — they inject the throwing delegate
/// FleetCore actually declares.)</item>
/// <item><c>AdditionalPipelinesForTests</c>, invoked INSIDE <c>StartLocked</c> under <c>_gate</c>. It stands
/// in for FleetCore's enumeration item 5 (<c>SimulatorFactory.Create</c> →
/// <c>MachineConfigStore.Ensure</c> → <c>File.WriteAllText</c>/<c>File.Move</c>, which throws
/// <c>InvalidOperationException</c> on a config-kind mismatch and <c>IOException</c> on a full or read-only
/// data root). It throws from the same method, under the same lock, at a point between the same two
/// statements. It is a STAND-IN and is labelled one: a test seam, not the production path — closing item 5
/// itself is a redesign of the restart chokepoint that G-1's brief reserved and G-2's does too.</item>
/// </list></para>
///
/// <para><b>What these tests do NOT prove.</b> That no <b>eighth, ninth or tenth</b> member exists — the set
/// is seven, so those are the next candidates; this said "seventh, eighth or ninth" while the section banner
/// below reads "S3 / S7", i.e. it counted six. That is the enumeration's job, in the report, and an
/// enumeration is not falsifiable by a test. That the framework
/// rethrows provider failures (read, not measured — see above). And nothing at all about S6
/// (<c>UpdateSettings</c>), which is deliberately left OPEN: see that method's own comment for why the
/// uniform remedy is refused there rather than missing.</para>
/// </summary>
public sealed class FleetHostGateCommitCompletionTests
{
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(20);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(100);

    /// <summary>Marker carried by every exception these tests inject, so an assertion can never be satisfied
    /// by some unrelated fault the harness produced.</summary>
    private const string InjectedMarker = "g2-injected";

    private static FleetHost CreateHost(
        RecordingLogger? logger = null,
        IUnsPublisher? unsPublisher = null,
        HistorianWriter? historianWriter = null,
        ConnectorRegistry? connectorRegistry = null)
    {
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo);
        var eventBus = new EventBus();
        return new FleetHost(
            switchable,
            coordinator,
            eventBus,
            logger: logger,
            historianWriter: historianWriter,
            unsPublisher: unsPublisher,
            connectorRegistry: connectorRegistry);
    }

    private static MappingProfile ProfileFor(string label) =>
        new() { Name = label, DeviceClass = "Automation" };

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
    // S2 — Stop/Estop -> WaitAndDisposeOldPipeline. The halt path, and the most serious member.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>🔴 S2, throw site 1: the <see cref="IUnsPublisher"/> seam, called with <c>_gate</c> held.
    ///
    /// <para><c>StopLocked</c> has already committed — <c>_running = false</c>, every slot cancelled,
    /// <c>_slots</c> cleared — and the ONLY remaining reference to those slots is the
    /// <c>PipelineHandle</c> local in <c>Estop</c>. Before G-2 a throw from this seam took that local out of
    /// scope with the drivers still open: one leaked live connection per slot, during HALT, with the caller
    /// told the halt failed on a fleet that had in fact latched.</para>
    ///
    /// <para>The disposal count is asserted as EXACTLY one, not "at least one" — the `finally` must not have
    /// traded a lost teardown for a doubled one.</para></summary>
    [Fact]
    public void Estop_WhenTheUnsSeamThrowsUnderTheGate_TheOldPipelineIsStillDisposed()
    {
        var publisher = new NodeDeathThrowingUnsPublisher();
        var host = CreateHost(unsPublisher: publisher);
        var driver = new DisposeCountingDriver("g2-estop-uns");

        host.AdditionalPipelinesForTests = () => new List<(string, IDeviceDriver, MappingProfile)>
        {
            ("g2-estop-uns", driver, ProfileFor("g2-estop-uns")),
        };

        try
        {
            host.Start();
            Assert.True(host.IsRunning);

            var thrown = Assert.Throws<InvalidOperationException>(() => host.Estop());
            Assert.Contains(InjectedMarker, thrown.Message, StringComparison.Ordinal);

            // The latch is set BEFORE the publish call, inside the same lock — unchanged by G-2, and asserted
            // so a future reordering of Estop's in-lock statements cannot pass silently.
            Assert.True(host.EstopEngaged);
            Assert.False(host.IsRunning);

            Assert.Equal(1, driver.DisposeCount);
        }
        finally
        {
            host.AdditionalPipelinesForTests = null;
            publisher.Armed = false;
            try { host.Stop(); } catch { /* best-effort */ }
        }
    }

    /// <summary>🔴 S2, throw site 2 — and this one is a REGRESSION G-1 INTRODUCED, in the very routine that
    /// exists to release the pipeline.
    ///
    /// <para>G-1 moved <c>StopLocked</c>'s halt-path log lines off the lock by buffering them and flushing
    /// them in <c>WaitAndDisposeOldPipeline</c> — as its FIRST statement, ahead of every disposal. The flush
    /// invokes a host-supplied delegate. A host that throws there therefore skipped the entire disposal loop
    /// below it. Before G-1 there was no host code in front of those disposals at all.</para>
    ///
    /// <para>The only producer of a halt-path deferred line is a driver whose cancellation registration
    /// throws — which is not a contrivance: <c>ModbusTcpDriver.PollOnceAsync</c>'s
    /// <c>ct.Register(DisposeConnection)</c> is the repo's first registration on a slot token, and
    /// <c>StopLocked</c>'s per-slot catch was written for exactly a third-party driver mirroring it badly.
    /// So the fixture reproduces the documented hazard rather than inventing one.</para></summary>
    [Fact]
    public async Task Estop_WhenTheHostLoggerThrowsFlushingTheHaltPathLines_TheOldPipelineIsStillDisposed()
    {
        const string label = "g2-estop-flush";
        var logger = new RecordingLogger { ThrowOnFragment = "cancellation-registration callback" };
        var host = CreateHost(logger);
        var driver = new CancelRegistrationThrowingDriver(label);

        host.AdditionalPipelinesForTests = () => new List<(string, IDeviceDriver, MappingProfile)>
        {
            (label, driver, ProfileFor(label)),
        };

        try
        {
            host.Start();
            await WaitUntilAsync(
                () => driver.Registered.IsSet,
                "the driver's cancellation callback to be registered on its slot token");

            var thrown = Assert.Throws<InvalidOperationException>(() => host.Estop());
            Assert.Contains(InjectedMarker, thrown.Message, StringComparison.Ordinal);

            // The line DID reach the logger — a green run in which nothing was ever flushed would prove
            // nothing about the ordering this test is here for.
            Assert.True(
                logger.Has(LogLevel.Error, "cancellation-registration callback"),
                "the deferred halt-path line should have reached the host logger");

            Assert.Equal(1, driver.DisposeCount);
            Assert.True(host.EstopEngaged);
        }
        finally
        {
            host.AdditionalPipelinesForTests = null;
            logger.ThrowOnFragment = null;
            try { host.Stop(); } catch { /* best-effort */ }
        }
    }

    /// <summary>🔴 S2's SECOND completion — review C-1. Round 1 of G-2 guaranteed the teardown and left this
    /// one exposed to the same throw site the test above injects.
    ///
    /// <para><b>Why this is not decoration.</b> <c>SqliteHistorianStore</c>'s OEE query opens a run interval
    /// on <c>"Start"</c> (<c>activeStart ??= at</c>) and closes it only on <c>"Stop"</c>/<c>"Estop"</c>; a
    /// missing halt event leaves the interval open and the trailing clause accrues run time to the end of the
    /// window. Availability is <b>inflated</b> — the same corruption S7 exists to prevent, sign reversed, in
    /// the number a plant manager reads.</para>
    ///
    /// <para><b>And the fix is not the mechanical one <c>Start</c> got.</b> An unconditional <c>finally</c>
    /// would record a halt on a path where <c>StopLocked</c> threw — trading "lost" for "spurious". The flag
    /// is what makes the event truthful, so this test also pins that a fleet which never ran still records
    /// its Estop (the pre-G-2 behaviour) while nothing invents a Stop for it.</para></summary>
    [Fact]
    public async Task Estop_WhenTheUnsSeamThrowsUnderTheGate_TheHaltRunEventIsStillRecorded()
    {
        var publisher = new NodeDeathThrowingUnsPublisher();
        var store = new RunEventRecordingHistorianStore();
        var writer = new HistorianWriter(store);
        var host = CreateHost(unsPublisher: publisher, historianWriter: writer);

        try
        {
            host.Start();
            Assert.True(host.IsRunning);

            var thrown = Assert.Throws<InvalidOperationException>(() => host.Estop());
            Assert.Contains(InjectedMarker, thrown.Message, StringComparison.Ordinal);

            await WaitUntilAsync(
                () => store.RunEventTypes().Contains("Estop", StringComparer.Ordinal),
                "the historian to record the Estop run event despite the UNS seam throwing under the lock");

            // The latch really did engage, so the event it records is truthful rather than merely present.
            Assert.True(host.EstopEngaged);
        }
        finally
        {
            publisher.Armed = false;
            try { host.Stop(); } catch { /* best-effort */ }
            await writer.DisposeAsync();
        }
    }

    /// <summary>🔴 The <c>Stop()</c> half of review C-1 — same window, same seam, its own code path. Unlike
    /// <c>Estop</c>, this method already had the latched flag the fix needs (<c>stopped</c>, computed before
    /// the publish call), so only the placement changed.</summary>
    [Fact]
    public async Task Stop_WhenTheUnsSeamThrowsUnderTheGate_TheStopRunEventIsStillRecorded()
    {
        var publisher = new NodeDeathThrowingUnsPublisher();
        var store = new RunEventRecordingHistorianStore();
        var writer = new HistorianWriter(store);
        var host = CreateHost(unsPublisher: publisher, historianWriter: writer);

        try
        {
            host.Start();
            Assert.True(host.IsRunning);

            var thrown = Assert.Throws<InvalidOperationException>(() => host.Stop());
            Assert.Contains(InjectedMarker, thrown.Message, StringComparison.Ordinal);

            await WaitUntilAsync(
                () => store.RunEventTypes().Contains("Stop", StringComparer.Ordinal),
                "the historian to record the Stop run event despite the UNS seam throwing under the lock");
        }
        finally
        {
            publisher.Armed = false;
            try { host.Stop(); } catch { /* best-effort */ }
            await writer.DisposeAsync();
        }
    }

    /// <summary>🔴 Review I-3 — the host seam that sits BETWEEN slot disposals, not in front of them.
    ///
    /// <para><c>DisposeOldSlots</c> called <see cref="Microsoft.Extensions.Logging.ILogger"/>-backed
    /// <c>_logDebug</c> from inside each per-slot <c>catch</c> — the handler that runs exactly when a driver
    /// has actually misbehaved. A throwing host logger there aborted the loop, so <b>every remaining slot's
    /// driver and CTS went undisposed</b>, on the halt path. Round 1's own comment at <c>Estop</c> asserted
    /// the deferred-log flush was the only remaining throw site in that routine; it was not.</para>
    ///
    /// <para>Two slots, in order: the first faults on <c>DisposeAsync</c> (producing the debug line) and the
    /// logger throws on it; the second must still be released. That second disposal is the assertion.</para></summary>
    [Fact]
    public void Estop_WhenTheHostDebugLoggerThrowsOnOneSlot_EverySubsequentSlotIsStillDisposed()
    {
        var logger = new RecordingLogger { ThrowOnFragment = "slot driver dispose observed a fault" };
        var host = CreateHost(logger);
        var faulting = new DisposeThrowingCountingDriver("g2-i3-faulting");
        var later = new DisposeCountingDriver("g2-i3-later");

        host.AdditionalPipelinesForTests = () => new List<(string, IDeviceDriver, MappingProfile)>
        {
            ("g2-i3-faulting", faulting, ProfileFor("g2-i3-faulting")),
            ("g2-i3-later", later, ProfileFor("g2-i3-later")),
        };

        try
        {
            host.Start();
            Assert.True(host.IsRunning);

            var thrown = Assert.Throws<InvalidOperationException>(() => host.Estop());
            Assert.Contains(InjectedMarker, thrown.Message, StringComparison.Ordinal);

            // The faulting slot really did reach the debug channel — a green run in which nothing was ever
            // logged would prove nothing about ordering.
            Assert.True(
                logger.Has(LogLevel.Debug, "slot driver dispose observed a fault"),
                "the faulting slot's teardown line should have reached the host logger");

            // THE ASSERTION: the slot AFTER the one whose log call threw was still released, exactly once.
            Assert.Equal(1, later.DisposeCount);
        }
        finally
        {
            host.AdditionalPipelinesForTests = null;
            logger.ThrowOnFragment = null;
            try { host.Stop(); } catch { /* best-effort */ }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // S3 / S7 — Start -> CompleteStartOffLock, and the run event that follows it.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>🔴 S3, throw site 1: <c>PublishNodeBirth</c>, called with <c>_gate</c> held, after
    /// <c>StartLocked</c> has returned the orphaned connector drivers it could not dispose under the lock.
    ///
    /// <para>Losing that hand-off re-opens exactly the orphaned-connector-driver leak "review fix round 2"
    /// exists to prevent: a factory that reports failure while still handing back a live driver (the shape
    /// that fix was written for) leaves that driver's socket open for the life of the process.</para></summary>
    [Fact]
    public void Start_WhenTheUnsSeamThrowsUnderTheGate_TheOrphanedConnectorDriverIsStillDisposed()
    {
        var publisher = new NodeBirthThrowingUnsPublisher();
        var orphan = new DisposeCountingDriver("g2-start-uns-orphan");
        var registry = new ConnectorRegistry();
        registry.Register(new OrphanLeakingFactory("vendor.g2.startuns", orphan), config: "garbage");
        var host = CreateHost(unsPublisher: publisher, connectorRegistry: registry);

        try
        {
            var thrown = Assert.Throws<InvalidOperationException>(() => host.Start());
            Assert.Contains(InjectedMarker, thrown.Message, StringComparison.Ordinal);

            Assert.Equal(1, orphan.DisposeCount);
        }
        finally
        {
            publisher.Armed = false;
            try { host.Stop(); } catch { /* best-effort */ }
        }
    }

    /// <summary>🔴 S3's second half AND S7, in one run — both are what the <c>finally</c> in <c>Start</c> and
    /// the <c>try</c>/<c>finally</c> inside <c>CompleteStartOffLock</c> guarantee, and both are lost to the
    /// same single throw.
    ///
    /// <para>The throw is a host logger failing on the connector-rejection warning that <c>StartLocked</c>
    /// deferred. Before G-2 it (a) skipped <c>DisposeOrphanedConnectorDrivers</c>, which is the second half of
    /// <c>CompleteStartOffLock</c> — the same flush-in-front-of-a-disposal shape as the halt path — and
    /// (b) skipped the historian's <b>"Start"</b> run event, which sits after that call. That run event is
    /// what makes OEE Availability a Start→Stop pair, and a MISSING Start corrupts that timeline exactly as
    /// the spurious pair this call site was moved out of <c>StartLocked</c> to avoid would.</para>
    ///
    /// <para>Two assertions for one mutation is deliberate here and is not a claim of independence: they are
    /// two distinct completions owed by the same commit, and the report's mutation table records which of
    /// them each mutation actually kills rather than asserting a 1:1 map.</para></summary>
    [Fact]
    public async Task Start_WhenTheHostLoggerThrowsFlushingDeferredLines_TheOrphanIsDisposedAndTheRunEventRecorded()
    {
        const string connectorId = "vendor.g2.startflush";
        var logger = new RecordingLogger { ThrowOnFragment = connectorId };
        var orphan = new DisposeCountingDriver("g2-start-flush-orphan");
        var registry = new ConnectorRegistry();
        registry.Register(new OrphanLeakingFactory(connectorId, orphan), config: "garbage");

        var store = new RunEventRecordingHistorianStore();
        var writer = new HistorianWriter(store);
        var host = CreateHost(logger, historianWriter: writer, connectorRegistry: registry);

        try
        {
            var thrown = Assert.Throws<InvalidOperationException>(() => host.Start());
            Assert.Contains(InjectedMarker, thrown.Message, StringComparison.Ordinal);

            Assert.True(
                logger.Has(LogLevel.Warning, connectorId),
                "the deferred connector-rejection warning should have reached the host logger");

            // S3's half.
            Assert.Equal(1, orphan.DisposeCount);

            // S7's half — the run event is fire-and-forget, so it is awaited by polling rather than assumed.
            await WaitUntilAsync(
                () => store.RunEventTypes().Contains("Start", StringComparer.Ordinal),
                "the historian to record the Start run event");
        }
        finally
        {
            logger.ThrowOnFragment = null;
            try { host.Stop(); } catch { /* best-effort */ }
            await writer.DisposeAsync();
        }
    }

    /// <summary>🔴 The SIBLING of review I-3, found by grepping for the shape rather than by being told, and
    /// witnessed here so the fix is not the one thing in this file that rests on reading.
    ///
    /// <para><c>DisposeOrphanedConnectorDrivers</c> had the identical defect to <c>DisposeOldSlots</c>: a host
    /// <c>_logDebug</c> call inside the per-orphan <c>catch</c>, i.e. INTERLEAVED with the disposals. A
    /// throwing host logger on orphan N left orphans N+1..M open, each holding whatever live socket its
    /// factory built. The review named only the halt-path copy.</para>
    ///
    /// <para><b>Both orphans fault on dispose, and both counts are asserted</b> — deliberately, so the test
    /// does not depend on <c>ConnectorRegistry.RegisteredIds</c> enumeration order. Whichever runs first, the
    /// other one's disposal is the property under test.</para></summary>
    [Fact]
    public void Start_WhenTheHostDebugLoggerThrowsOnOneOrphan_EveryOtherOrphanIsStillDisposed()
    {
        var logger = new RecordingLogger { ThrowOnFragment = "orphaned connector driver dispose observed a fault" };
        var firstOrphan = new DisposeThrowingCountingDriver("g2-i3-orphan-a");
        var secondOrphan = new DisposeThrowingCountingDriver("g2-i3-orphan-b");

        var registry = new ConnectorRegistry();
        registry.Register(new OrphanLeakingFactory("vendor.g2.orphana", firstOrphan), config: "garbage");
        registry.Register(new OrphanLeakingFactory("vendor.g2.orphanb", secondOrphan), config: "garbage");

        var host = CreateHost(logger, connectorRegistry: registry);

        try
        {
            var thrown = Assert.Throws<InvalidOperationException>(() => host.Start());
            Assert.Contains(InjectedMarker, thrown.Message, StringComparison.Ordinal);

            Assert.True(
                logger.Has(LogLevel.Debug, "orphaned connector driver dispose observed a fault"),
                "an orphan's dispose fault should have reached the host logger");

            // THE ASSERTION: neither orphan was skipped because the other one's log call threw.
            Assert.Equal(1, firstOrphan.DisposeCount);
            Assert.Equal(1, secondOrphan.DisposeCount);
        }
        finally
        {
            logger.ThrowOnFragment = null;
            try { host.Stop(); } catch { /* best-effort */ }
        }
    }

    /// <summary>🔴 The THIRD instance of the I-3 shape (re-review NEW-1), and the one two rounds of my own
    /// sibling sweeps could not reach.
    ///
    /// <para><c>StartSlot</c>'s per-slot fault handler called the host <c>_logError</c> as its FIRST
    /// statement, ahead of the under-<c>_gate</c> slot removal and the guarded disposal. A throwing host
    /// logger abandoned the whole handler, and the sharpest casualty is not a leak: <b><c>LastError</c> is
    /// never set, so <c>GET /v1/health</c> reports HEALTHY on a faulted fleet</b> — permanently, because
    /// nothing else writes that field. The slot also stays in <c>_slots</c>, so the fleet keeps reporting a
    /// dead slot as live, and the exception escapes into <c>Task.Run</c> where nothing observes it.</para>
    ///
    /// <para><b>Why the previous sweeps missed it, since that is the transferable part:</b> both keyed on
    /// <c>_logDebug</c> inside a per-item <c>catch</c> in a disposal LOOP. This is <c>_logError</c>, in a
    /// per-slot FAULT handler, with no loop. Same shape, no shared vocabulary — a grep keys on the words an
    /// author happened to pick, and a shape has none.</para>
    ///
    /// <para><b>It is NOT an S-set member</b> and this test does not claim it is: the seam runs BEFORE the
    /// under-<c>_gate</c> commit, so nothing is committed-then-stranded. It is the same hazard reached from
    /// the other side.</para></summary>
    [Fact]
    public async Task WhenAFaultingSlotsOwnErrorLogThrows_TheFaultIsStillRecordedInLastError()
    {
        const string label = "g2-slotfault";
        var logger = new RecordingLogger { ThrowOnFragment = "faulted" };
        var host = CreateHost(logger);
        var driver = new ReadThrowingDriver(label);

        host.AdditionalPipelinesForTests = () => new List<(string, IDeviceDriver, MappingProfile)>
        {
            (label, driver, ProfileFor(label)),
        };

        try
        {
            host.Start();

            // THE ASSERTION: the fault reached the field GET /v1/health reads. Before the fix the host's
            // logger threw first and this stayed null forever.
            await WaitUntilAsync(
                () => host.LastError is not null,
                "the slot fault to reach LastError despite the host's own error log throwing");

            Assert.Contains(InjectedMarker, host.LastError!.Message, StringComparison.Ordinal);

            // …and the slot was genuinely torn down rather than left in _slots holding its driver.
            await WaitUntilAsync(
                () => driver.DisposeCount == 1,
                "the faulted slot's driver to be released");
        }
        finally
        {
            host.AdditionalPipelinesForTests = null;
            logger.ThrowOnFragment = null;
            try { host.Stop(); } catch { /* best-effort */ }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // S4 (first half) — the restart chokepoint's rebuild.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>🔴 S4's first half: <c>ApplyScenario</c>'s teardown throws, and the rebuild it owes must still
    /// happen.
    ///
    /// <para><c>StopLocked</c> commits under <c>_gate</c> and the scenario write beside it is never rolled
    /// back, so from the moment the lock is released the fleet owes a pipeline built from the new scenario.
    /// The off-lock teardown between them can throw — its deferred-log flush is a host seam — and before
    /// G-2 that throw left the fleet <b>stopped</b>, with the scenario already applied and nothing to bring
    /// the pipeline back.</para>
    ///
    /// <para><b>What this does NOT close, asserted here so the gap is visible rather than implied:</b> if
    /// <c>StartLocked</c> ITSELF throws, no <c>finally</c> can start a fleet that failed to start. That is
    /// S4's second half and it is reported open. See the Burst test below, which drives exactly that case and
    /// asserts the fleet is left stopped.</para></summary>
    [Fact]
    public async Task ARestartWhoseTeardownThrows_StillRebuildsThePipeline_RatherThanLeavingTheFleetStopped()
    {
        const string label = "g2-restart-teardown";
        var logger = new RecordingLogger { ThrowOnFragment = "cancellation-registration callback" };
        var host = CreateHost(logger);
        var drivers = new ConcurrentBag<CancelRegistrationThrowingDriver>();
        var latest = new CancelRegistrationThrowingDriver(label);
        drivers.Add(latest);

        host.AdditionalPipelinesForTests = () =>
        {
            var driver = new CancelRegistrationThrowingDriver(label);
            drivers.Add(driver);
            latest = driver;
            return new List<(string, IDeviceDriver, MappingProfile)> { (label, driver, ProfileFor(label)) };
        };

        try
        {
            host.Start();
            var started = latest;
            await WaitUntilAsync(
                () => started.Registered.IsSet,
                "the first slot's cancellation callback to be registered");
            Assert.True(host.IsRunning);

            // A cycle-rate change is what makes ApplyScenario tear down and rebuild.
            var thrown = Assert.Throws<InvalidOperationException>(
                () => host.ApplyScenario(new ScenarioConfig(CycleRateMultiplier: 2.0), presetName: "g2-restart"));
            Assert.Contains(InjectedMarker, thrown.Message, StringComparison.Ordinal);

            // THE ASSERTION: the fleet is running again. Without the rebuild in a `finally`, the teardown's
            // throw is the last thing that happened and this is false.
            Assert.True(
                host.IsRunning,
                "the restart's teardown threw and the rebuild never ran — the fleet is stopped with the new " +
                "scenario already committed");

            // …and it is a genuinely NEW pipeline, not the old one still standing: the seam was asked for a
            // second set of groups.
            Assert.True(drivers.Count >= 3, $"expected a second StartLocked build; seam produced {drivers.Count - 1}");
            Assert.Equal(1, started.DisposeCount);
        }
        finally
        {
            host.AdditionalPipelinesForTests = null;
            logger.ThrowOnFragment = null;
            try { host.Stop(); } catch { /* best-effort */ }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // S5 — Burst -> RevertBurstAfterDelayAsync.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>🔴 S5: <c>_burstRevertCts = cts</c> is committed under <c>_gate</c>, and the task that
    /// discharges it is started after the lock is released — with <c>ApplyScenario</c> in between.
    ///
    /// <para>Review M-5 named only the <c>previousCts?.Cancel()</c> half of that window. The larger half is
    /// <c>ApplyScenario</c>, which reaches <c>StartLocked</c> and is therefore reachable through FleetCore's
    /// own enumeration item 5. A throw there left the fleet at the burst multiplier with <b>no revert task
    /// ever scheduled</b> — indefinitely, until some later Burst.</para>
    ///
    /// <para>This test also pins S4's SECOND half as an open gap rather than a surprise: the fleet IS left
    /// stopped by the throw, and stays stopped. That is asserted, not merely tolerated.</para></summary>
    [Fact]
    public async Task Burst_WhenApplyingTheBurstThrows_TheRevertIsStillScheduled()
    {
        var host = CreateHost();
        var throwOnBuild = false;

        host.AdditionalPipelinesForTests = () => throwOnBuild
            ? throw new InvalidOperationException($"{InjectedMarker}: StartLocked stand-in for enumeration item 5")
            : new List<(string, IDeviceDriver, MappingProfile)>();

        try
        {
            host.Start();
            Assert.True(host.IsRunning);
            var baseline = host.CurrentScenario.CycleRateMultiplier;

            throwOnBuild = true;
            var thrown = Assert.Throws<InvalidOperationException>(() => host.Burst());
            Assert.Contains(InjectedMarker, thrown.Message, StringComparison.Ordinal);

            // The burst multiplier IS live — ApplyScenario commits `_scenario` inside the lock, before the
            // restart it triggers can throw. So a revert is genuinely owed, not merely tidy.
            Assert.True(host.CurrentScenario.CycleRateMultiplier > baseline);

            // S4's second half, asserted as the known gap it is: the rebuild threw, so the fleet is stopped.
            Assert.False(host.IsRunning);

            throwOnBuild = false;
            await WaitUntilAsync(
                () => Math.Abs(host.CurrentScenario.CycleRateMultiplier - baseline) < 1e-9,
                "the scheduled burst revert to restore the baseline cycle-rate multiplier");
        }
        finally
        {
            throwOnBuild = false;
            host.AdditionalPipelinesForTests = null;
            try { host.Stop(); } catch { /* best-effort */ }
        }
    }

    /// <summary>🔴 The one genuinely SILENT instance of S4, and it is on the revert path.
    ///
    /// <para><c>ApplyScenario</c>'s restart can throw on all three of its entry paths. On two of them
    /// (<c>RegisterMachine</c>, the scenario endpoint) the throw reaches an operator as an HTTP 500. On this
    /// one it does not: <c>Burst</c> starts the revert as <c>_ = RevertBurstAfterDelayAsync(...)</c>, so the
    /// Task is never observed, and nothing in this tree subscribes to
    /// <c>TaskScheduler.UnobservedTaskException</c> — the fault was collected by the finalizer and dropped.
    /// A fleet stuck at six times its cycle rate, with no record anywhere of why.</para>
    ///
    /// <para>G-2 converts that silence into one line on the channel a host reads. It deliberately does not
    /// retry or roll back — what state a failed restart leaves the fleet in is S4's open half.</para></summary>
    [Fact]
    public async Task Burst_WhenTheScheduledRevertItselfThrows_ItIsReported_NotDroppedOnAnUnobservedTask()
    {
        var logger = new RecordingLogger();
        var host = CreateHost(logger);
        var throwOnBuild = false;

        host.AdditionalPipelinesForTests = () => throwOnBuild
            ? throw new InvalidOperationException($"{InjectedMarker}: StartLocked stand-in for enumeration item 5")
            : new List<(string, IDeviceDriver, MappingProfile)>();

        try
        {
            host.Start();
            Assert.True(host.IsRunning);

            // A clean burst: the fleet restarts at the burst multiplier and the revert is scheduled.
            host.Burst();
            Assert.True(host.IsRunning);

            // Now arm the failure so it is the REVERT's own restart that throws, on the unobserved task.
            throwOnBuild = true;

            await WaitUntilAsync(
                () => logger.Has(LogLevel.Error, "burst revert failed"),
                "the failed burst revert to report itself on the error channel");
        }
        finally
        {
            throwOnBuild = false;
            host.AdditionalPipelinesForTests = null;
            try { host.Stop(); } catch { /* best-effort */ }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fixtures
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Records level + rendered message, and can THROW on one nominated fragment — the seam under
    /// test. It enqueues BEFORE throwing, so a test can assert both that the line was produced and that the
    /// throw did not eat the completion behind it.</summary>
    private sealed class RecordingLogger : ILogger<FleetHost>
    {
        public ConcurrentQueue<(LogLevel Level, string Message)> Entries { get; } = new();

        /// <summary>Null (the default) means never throw.</summary>
        public string? ThrowOnFragment { get; set; }

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

            var fragment = ThrowOnFragment;
            if (fragment is not null && message.Contains(fragment, StringComparison.Ordinal))
            {
                throw new InvalidOperationException($"{InjectedMarker}: this host's log provider failed");
            }
        }
    }

    /// <summary>Base for the two publisher fakes — everything except the one nominated node-lifecycle call is
    /// an inert no-op, so a test times one seam and not two.</summary>
    private abstract class InertUnsPublisher : IUnsPublisher
    {
        /// <summary>Set false during cleanup so a test's own <c>Stop()</c> can complete.</summary>
        public bool Armed { get; set; } = true;

        public void PublishReading(DeviceReading reading, CanonicalEnvelope envelope) { }

        public void PublishBirth(string equipmentCode) { }

        public void PublishDeath(string equipmentCode) { }

        public virtual void PublishNodeBirth() { }

        public virtual void PublishNodeDeath() { }

        public void PublishLineState(string state) { }
    }

    private sealed class NodeDeathThrowingUnsPublisher : InertUnsPublisher
    {
        public override void PublishNodeDeath()
        {
            if (Armed) throw new InvalidOperationException($"{InjectedMarker}: this host's UNS publisher threw on NDEATH");
        }
    }

    private sealed class NodeBirthThrowingUnsPublisher : InertUnsPublisher
    {
        public override void PublishNodeBirth()
        {
            if (Armed) throw new InvalidOperationException($"{InjectedMarker}: this host's UNS publisher threw on NBIRTH");
        }
    }

    /// <summary>A driver that yields nothing and counts its own disposals. The COUNT is the point: these
    /// tests assert exactly one, so a `finally` that traded a lost teardown for a doubled one fails.</summary>
    private class DisposeCountingDriver : IDeviceDriver
    {
        private int _disposeCount;

        public DisposeCountingDriver(string id) => Id = id;

        public string Id { get; }

        public string Kind => "g2.dispose-counting";

        public DriverHealthState Health => DriverHealthState.Connected;

        public int DisposeCount => Volatile.Read(ref _disposeCount);

        public virtual async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
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

        public virtual ValueTask DisposeAsync()
        {
            Interlocked.Increment(ref _disposeCount);
            return ValueTask.CompletedTask;
        }
    }

    /// <summary>Faults out of <c>ReadAsync</c> with something that is NOT an
    /// <see cref="OperationCanceledException"/> — the only way to reach <c>StartSlot</c>'s general per-slot
    /// fault handler, which is where re-review NEW-1 lives.</summary>
    private sealed class ReadThrowingDriver : DisposeCountingDriver
    {
        public ReadThrowingDriver(string id) : base(id) { }

        public override async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
        {
            await Task.Yield();
            ct.ThrowIfCancellationRequested();
            throw new InvalidOperationException($"{InjectedMarker}: this driver's read loop faulted");

#pragma warning disable CS0162 // unreachable: this method is an iterator with no yield on its live path
            yield break;
#pragma warning restore CS0162
        }
    }

    /// <summary>Faults on <c>DisposeAsync</c> — the misbehaving-driver case <c>DisposeOldSlots</c>' per-slot
    /// catch exists for, and therefore the only way to reach the <c>_logDebug</c> call inside it. Still counts
    /// the attempt, so a test can tell "was not disposed" from "disposal was attempted and threw".</summary>
    private sealed class DisposeThrowingCountingDriver : DisposeCountingDriver
    {
        public DisposeThrowingCountingDriver(string id) : base(id) { }

        public override ValueTask DisposeAsync()
        {
            base.DisposeAsync();
            throw new InvalidOperationException($"{InjectedMarker}: this driver's DisposeAsync always faults");
        }
    }

    /// <summary>The documented hazard, reproduced: a driver that registers a THROWING callback on its slot's
    /// cancellation token. <c>StopLocked</c>'s <c>slot.Cts.Cancel()</c> runs it synchronously on the halting
    /// thread, catches it per-slot, and buffers an error line — which is the only producer of a halt-path
    /// deferred log entry, and therefore the only way to reach the flush this fixture exists to test.
    ///
    /// <para><see cref="Registered"/> is what makes the test deterministic: the registration happens on the
    /// slot's own run-task, so a test must wait for it rather than assume it.</para></summary>
    private sealed class CancelRegistrationThrowingDriver : DisposeCountingDriver
    {
        public CancelRegistrationThrowingDriver(string id) : base(id) { }

        public ManualResetEventSlim Registered { get; } = new(false);

        public override async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
        {
            using var registration = ct.Register(
                () => throw new InvalidOperationException($"{InjectedMarker}: this driver's cancellation callback threw"));
            Registered.Set();

            while (true)
            {
                ct.ThrowIfCancellationRequested();
                await Task.Delay(TimeSpan.FromMilliseconds(50), ct).ConfigureAwait(false);
            }

#pragma warning disable CS0162 // unreachable: this method is an iterator with no yield on its live path
            yield break;
#pragma warning restore CS0162
        }
    }

    /// <summary>A contract-violating factory of exactly the shape <c>StartLocked</c>'s orphan collection
    /// exists for: it reports failure yet still hands back a live driver. Takes the driver instance so a test
    /// can count its disposals.</summary>
    private sealed class OrphanLeakingFactory : IConnectorFactory
    {
        private readonly IDeviceDriver _orphan;

        public OrphanLeakingFactory(string kind, IDeviceDriver orphan)
        {
            Kind = kind;
            _orphan = orphan;
        }

        public string Kind { get; }

        public bool TryCreate(string config, [NotNullWhen(true)] out IDeviceDriver? driver, [NotNullWhen(false)] out string? error)
        {
            driver = _orphan;
            error = "bad config: this factory always rejects, and leaks its driver anyway";
            return false;
        }
    }

    /// <summary>Only the two members <see cref="HistorianWriter"/> calls are implemented; everything else
    /// throws, same shape as the sibling fake in <c>FleetHostHistorianWiringTests</c>.</summary>
    private sealed class RunEventRecordingHistorianStore : IHistorianStore
    {
        private readonly object _lock = new();
        private readonly List<string> _runEventTypes = new();

        public IReadOnlyList<string> RunEventTypes()
        {
            lock (_lock) return _runEventTypes.ToList();
        }

        public Task AppendResultsAsync(IReadOnlyList<HistorianResultRecord> records, CancellationToken ct) =>
            Task.CompletedTask;

        public Task AppendRunEventAsync(HistorianRunEvent runEvent, CancellationToken ct)
        {
            lock (_lock) _runEventTypes.Add(runEvent.EventType);
            return Task.CompletedTask;
        }

        public Task<HistorianResultsPage> QueryResultsAsync(HistorianResultQuery query, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<HistorianResultRow>> QueryBySerialAsync(string serialNumber, CancellationToken ct, bool includeFabricated = false) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<TelemetrySamplePoint>> QueryTelemetryAsync(string machineCode, string metric, DateTimeOffset from, DateTimeOffset to, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<OeeInputAggregate> AggregateForOeeAsync(string machineCode, DateTimeOffset from, DateTimeOffset to, CancellationToken ct, bool includeFabricated = false) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<HistorianRunEvent>> QueryRunEventsAsync(DateTimeOffset from, DateTimeOffset to, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<int> PruneOlderThanAsync(DateTimeOffset cutoffUtc, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<HistorianStats> GetStatsAsync(CancellationToken ct) =>
            throw new NotSupportedException();
    }
}
