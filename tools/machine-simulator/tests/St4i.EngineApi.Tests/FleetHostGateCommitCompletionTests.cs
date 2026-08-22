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
/// <c>FleetCore._gate</c>'s banner, which is the canonical list and labels every row with its S-number.</para>
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
/// FleetCore's own enumeration P8.</item>
/// <item>The host log callbacks. <c>FleetCore</c>'s seam is a plain <c>Action&lt;string&gt;</c>/
/// <c>Action&lt;Exception,string&gt;</c>; a delegate that throws is a throw site by construction. In
/// production a host wires them to an <c>ILogger</c> — and
/// <c>Microsoft.Extensions.Logging.Logger.Log</c> collects each provider's exception and rethrows them as an
/// <c>AggregateException</c> rather than swallowing them, so a failing Event Log provider under
/// <c>AddWindowsService</c> throws out of a log call. (That second sentence is READ from the framework's
/// contract, not measured here; nothing in these tests depends on it — they inject the throwing delegate
/// FleetCore actually declares.)</item>
/// <item><c>AdditionalPipelinesForTests</c>, invoked INSIDE <c>StartLocked</c> under <c>_gate</c>. It stands
/// in for FleetCore's enumeration P5 (<c>SimulatorFactory.Create</c> →
/// <c>MachineConfigStore.Ensure</c> → <c>File.WriteAllText</c>/<c>File.Move</c>, which throws
/// <c>InvalidOperationException</c> on a config-kind mismatch and <c>IOException</c> on a full or read-only
/// data root). It is a STAND-IN and is labelled one: a test seam, not the production path.
/// <para>🔴 <b>J-1 did the redesign this sentence used to defer, and the stand-in survives it — with a
/// weaker analogy that is stated rather than left standing.</b> The claim here was "it throws from the same
/// method, under the same lock, at a point between the same two statements", plus "closing P5 itself is a
/// redesign of the restart chokepoint that G-1's brief reserved and G-2's does too". The second half is now
/// simply false: J-1 hoisted the build, so on an uncontended start P5 fires from <c>BuildStartPlan</c> with
/// <c>_gate</c> RELEASED, and the two are no longer the same method or the same side of the lock. The first
/// half survives in the form these tests actually depend on, which is narrower than what it said: this seam
/// throws from inside <c>StartLocked</c>, between a commit made under <c>_gate</c> and a completion owed
/// after it, which is the ONLY property the S-set tests below rest on. P5 is still reachable there too — the
/// install's per-machine reuse-or-build arm builds a simulator for any descriptor the plan does not cover —
/// so the stand-in has not become a stand-in for nothing. It has become a stand-in for a rarer arm of the
/// same path.</para>
/// <para>🔴 The two exception MESSAGES for this stand-in still spell it "item 5", deliberately. The
/// whole-branch re-review's NEW-5 gave that member one canonical name, <c>P5</c>, everywhere it is
/// CROSS-REFERENCED — and a bulk rename swept these two string literals along with the comments, which would
/// have made a comment-only merge pass carry executable change. Instrument 1 caught it and instrument 2
/// confirmed it: the TEST assembly's IL moved, both PRODUCT assemblies did not. Reverted, because nobody
/// resolves a member name out of an exception message — the rename bought nothing here and cost the
/// comment-only property the branch review had verified.</para>
/// <para>🔴 <b>J-2 uses this same seam a SECOND way, and it is not a third seam: the seam itself does not
/// throw there.</b> The two J-2 tests hand it a group with a NULL profile, so the throw comes from
/// <c>StartSlot</c>'s own <c>new EdgePipeline</c> — one statement further on, INSIDE the slot loop, which is
/// the only place a throw can leave slots installed. What that costs in fidelity is stated at those tests
/// and is worth repeating here: in production every argument that constructor null-checks is non-null by
/// construction, so the only production producer inside that loop is an allocation failure at
/// <c>Task.Run</c>. The seam supplies the SHAPE the two fixes are about, not a production
/// frequency.</para></item>
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
    // S3's residual (J-2) — the partial work a StartLocked that throws leaves behind.
    //
    // Both tests below drive the SAME throw site and assert two different consequences of it. The site is
    // StartSlot's `new EdgePipeline`, which the S-set banner names as one of this residual's two reachability
    // points, reached here through the AdditionalPipelinesForTests seam with a null profile.
    //
    // 🔴 WHAT THAT SEAM IS AND IS NOT, because this file's own header sets the standard: in PRODUCTION every
    // argument `new EdgePipeline` null-checks is non-null by construction on every path (the transport and
    // the bus are ctor fields; the driver is guarded; both profiles are constructed two statements earlier),
    // so the only production producer of a throw inside that loop is an allocation failure at `Task.Run`. The
    // seam reproduces the SHAPE — a throw from StartSlot after at least one slot is installed and before
    // `_running = true` — and the shape is what both fixes are about. Stated rather than left for a reader to
    // discover, and recorded in the same words on the banner.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>🔴 S3's residual, consequence (2) — the STUCK STATE, and the only one of the four with a
    /// consequence on the halt path.
    ///
    /// <para>A <c>StartLocked</c> that throws part-way through its slot loop leaves <c>_slots</c> populated
    /// with <c>_running == false</c>. Those slots are LIVE — each run-task is already driving its pipeline —
    /// yet <c>StopLocked</c>'s guard tested <c>!_running</c> ALONE [QUOTED-NOT-LIVE — the verbatim old line
    /// is deliberately not reproduced here or in <c>FleetCore.cs</c>; a grep for the live guard must not
    /// return a hit that looks like live code, and greps do not stop at a file boundary], so <b>both</b> teardown
    /// callers returned without cancelling one of them. A HALT did not halt them, and NO OPERATOR ACTION
    /// could: <c>RegisterMachine</c>/<c>ApplyScenario</c> reach <c>StopLocked</c> only
    /// <c>if (IsRunning)</c>, and a <c>Start()</c> from that state installs more slots rather than clearing
    /// these. (The one release that did exist is not an operator's to trigger: a stranded slot whose driver
    /// later FAULTS removes itself through <c>StartSlot</c>'s catch. One that behaves does not.)</para>
    ///
    /// <para><b>The state is asserted before the remedy, not inferred:</b> <c>IsRunning</c> false while
    /// <c>GetDriverHealth</c> still lists the installed slot is the divergence itself, and it is the surface
    /// an operator meets first (<c>AlarmEvaluator</c> diffs that list).</para>
    ///
    /// <para><b>The symmetric caller (§8.1(h4)):</b> <c>Stop()</c> reaches the identical guard in the
    /// identical way — the fix is in the shared callee and both callers call it unconditionally — so it is
    /// DELIBERATELY not witnessed separately. <c>Estop()</c> is the one asserted because it is the one whose
    /// failure to tear down is a safety-path claim rather than a leak.</para></summary>
    [Fact]
    public void AStartThatThrowsWhileInstallingSlots_LeavesSlotsTheHaltPathCanStillTearDown()
    {
        const string installedLabel = "j2-installed";
        var host = CreateHost();
        var installed = new DisposeCountingDriver(installedLabel);
        var neverReached = new DisposeCountingDriver("j2-never-reached");

        host.AdditionalPipelinesForTests = () => new List<(string, IDeviceDriver, MappingProfile)>
        {
            (installedLabel, installed, ProfileFor(installedLabel)),
            ("j2-throwing", neverReached, null!),
        };

        try
        {
            Assert.Throws<ArgumentNullException>(() => host.Start());

            // The stuck state, as a state: the fleet says it is not running and its own driver-health
            // projection says otherwise, about a slot whose pipeline is genuinely running.
            Assert.False(host.IsRunning);
            Assert.Contains(host.GetDriverHealth(), h => h.SlotLabel == installedLabel);
            Assert.Equal(0, installed.DisposeCount);

            host.Estop();

            // THE ASSERTION: the halt reached them. Before J-2 this was 0 for the life of the process.
            Assert.Equal(1, installed.DisposeCount);
            Assert.Empty(host.GetDriverHealth());
            Assert.True(host.EstopEngaged);
        }
        finally
        {
            host.AdditionalPipelinesForTests = null;
            try { host.Stop(); } catch { /* best-effort */ }
        }
    }

    /// <summary>🔴 S3's residual, consequence (1) — the orphaned connector driver, which is the half of the
    /// residual the banner has named since review I-5.
    ///
    /// <para>A factory that rejects its config while still handing back a live driver is the shape
    /// "review fix round 2" exists for. <c>StartLocked</c> collects that driver and its CALLER disposes it
    /// off <c>_gate</c> — but the list lived in a local of <c>StartLocked</c>, so a throw between the
    /// collection and the return took every orphan out of scope with its socket open, and the caller's
    /// <c>finally</c> reached <c>default(StartOutcome)</c> and did nothing. The list is allocated by the
    /// caller now; nothing else about the mechanism moved.</para>
    ///
    /// <para><b>The second assertion PINS A GAP rather than a guarantee</b>, in the same style as the Burst
    /// test below. <c>j2-later</c>'s driver sits AFTER the throwing group in the same list: it was never
    /// installed, is referenced only by a local, and is never disposed. That is S3's residual (4) — new, on
    /// no previous list, and NOT closed here, because at the FAILING index this method cannot distinguish
    /// "installed" from "not installed" (<c>StartSlot</c> adds the slot before assigning its run-task) and a
    /// hand-over would either leak one driver or double-dispose it against the teardown path the sibling
    /// test just made reachable. If a later task closes it, this assertion is what goes red — which is the
    /// point of pinning it.</para></summary>
    [Fact]
    public void AStartThatThrowsWhileInstallingSlots_StillDisposesTheConnectorDriverItOrphaned()
    {
        var orphan = new DisposeCountingDriver("j2-orphan");
        var registry = new ConnectorRegistry();
        registry.Register(new OrphanLeakingFactory("vendor.j2.orphan", orphan), config: "garbage");

        var host = CreateHost(connectorRegistry: registry);
        var throwingSlot = new DisposeCountingDriver("j2-throwing");
        var later = new DisposeCountingDriver("j2-later");

        host.AdditionalPipelinesForTests = () => new List<(string, IDeviceDriver, MappingProfile)>
        {
            ("j2-throwing", throwingSlot, null!),
            ("j2-later", later, ProfileFor("j2-later")),
        };

        try
        {
            Assert.Throws<ArgumentNullException>(() => host.Start());

            // THE ASSERTION: exactly one — the `finally` must not have traded a lost disposal for a doubled
            // one, the same bar every other disposal count in this file is held to.
            Assert.Equal(1, orphan.DisposeCount);

            // THE PINNED GAP: S3's residual (4), stated as a fact about this tree rather than tolerated.
            Assert.Equal(0, later.DisposeCount);
        }
        finally
        {
            host.AdditionalPipelinesForTests = null;
            try { host.Stop(); } catch { /* best-effort */ }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // S3's residual (3) — T-1, and it is the OWNER'S ruling, not this file's judgement.
    //
    // Owner decision 6 (docs/owner-decisions.md §6) was refused three times on SYMMETRY: the two SIBLING
    // non-installing paths — the HALT-latch refusal inside StartLocked and Start()'s _stopRequests abandon —
    // were each decided silent at their own site, so letting the third path speak was held to be a change to
    // what an operator sees, and therefore not an implementer's to make. The ruling that answered that
    // escalation refused the symmetry on a measurement this repository already carried, in StopLocked's own
    // comment: the two siblings are "nothing happened", while the throw path is "a great deal happened and
    // THEN it broke" — the resolver ran and fell back, a connector was rejected, and slots may already be
    // installed. Silence about what did not happen is right; silence about what did is not.
    //
    // Four tests. One is the ruling's witness; one re-verifies the surviving projection the ruling's own
    // evidence rests on; two pin the siblings' silence, which the ruling must not disturb.
    //
    // 🔴 WHAT IS NOT WITNESSED HERE, because a sibling assertion already holds it: the CHANNEL choice inside
    // the flush (a non-null Error goes to _logError, a null one to _logWarning) is unchanged by T-1 and its
    // Error arm is asserted by Estop_WhenTheHostLoggerThrowsFlushingTheHaltPathLines_TheOldPipelineIsStillDisposed
    // above. T-1 chooses no level: every line below carries the level its PRODUCER chose, and reaches the
    // host through the same routing a SUCCESSFUL start already uses.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>The unique profile name every T-1 test registers. It names no file under
    /// <c>FleetCore.MappingDirectory</c>, which is what makes <c>MappingProfileResolver</c> emit its
    /// fall-back warning; and it is distinctive enough that a count over the host's log lines cannot be
    /// satisfied by some other line the harness produced.</summary>
    private const string MissingProfile = "t1-no-such-profile";

    private static MachineDescriptor T1Machine(string code, string? mappingProfile = null) =>
        new(code, $"SN-{code}", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening",
            DriverKinds.Simulated, "RC-T1", mappingProfile, CycleSeconds: 0.05);

    private static int Lines(RecordingLogger logger, LogLevel level, string fragment) =>
        logger.Entries.Count(e => e.Level == level && e.Message.Contains(fragment, StringComparison.Ordinal));

    /// <summary>🔴 S3's residual (3) — CLOSED (T-1). The lines a failed install used to lose.
    ///
    /// <para><b>What this drives.</b> One start that does real work and then throws: a roster machine whose
    /// <c>mappingProfile</c> names no file (the resolver runs, warns, and falls back — off the lock, in the
    /// plan), a registered connector whose factory rejects its config (the connector loop records the
    /// rejection — under the lock, in the install), and a group whose profile is null so <c>StartSlot</c>'s
    /// <c>new EdgePipeline</c> throws after both. That is the shape residual (3) is about, and the two
    /// buffered lines are produced by two DIFFERENT halves of the start — one before the lock, one inside it
    /// — which is why both are asserted rather than one.</para>
    ///
    /// <para><b>The install failure is asserted FIRST and it is not decoration.</b> The flush now runs with
    /// real entries on a path where it used to iterate nothing, and it invokes a host delegate; a host whose
    /// logger throws would replace the exception that says why the start failed. <c>Assert.Throws</c> is what
    /// keeps "the emission arrived" from ever being bought with "the failure did not".</para>
    ///
    /// <para><b>Exactly one of each, not at-least-one.</b> The list is allocated once per call and consumed
    /// once, in the caller's <c>finally</c>; a doubled emission is the failure mode a retry-then-succeed
    /// sequence would produce and it is the reason the count is pinned rather than the presence.</para>
    ///
    /// <para><b>Level.</b> Both are <c>Warning</c> — and T-1 did not choose that. The mapping fall-back and
    /// the connector rejection are buffered with a null <c>Error</c> at their own producing sites, which is
    /// the same entry a SUCCEEDING start hands to the same flush. What was fixed is reaching the emitter, not
    /// the routing.</para></summary>
    [Fact]
    public void AStartThatThrowsWhileInstallingSlots_StillSaysWhatHappenedBeforeItThrew()
    {
        const string code = "T1-SPEAKS-01";
        const string connectorId = "vendor.t1.orphan";

        var logger = new RecordingLogger();
        var registry = new ConnectorRegistry();
        registry.Register(new OrphanLeakingFactory(connectorId, new DisposeCountingDriver("t1-orphan")), config: "garbage");

        var host = CreateHost(logger, connectorRegistry: registry);
        Assert.True(host.RegisterMachine(T1Machine(code, MissingProfile)));

        host.AdditionalPipelinesForTests = () => new List<(string, IDeviceDriver, MappingProfile)>
        {
            ("t1-throwing", new DisposeCountingDriver("t1-throwing"), null!),
        };

        try
        {
            // The install really did fail, and the failure is what the caller still sees.
            Assert.Throws<ArgumentNullException>(() => host.Start());
            Assert.False(host.IsRunning);

            // THE ASSERTION, half one — the mapping fall-back. This half has no projection anywhere: the
            // resolver's whole output is the profile it returns and the callback it invokes
            // (MappingProfileResolver.ResolveOne), so before T-1 a failed install erased it with no residue.
            Assert.Equal(1, Lines(logger, LogLevel.Warning, MissingProfile));

            // THE ASSERTION, half two — the connector rejection, which is the half that DOES have a
            // projection (see the next test). It is asserted here anyway because the two halves are buffered
            // by different code under different locks, and a fix that reached only one of them would pass a
            // one-sided test.
            Assert.Equal(1, Lines(logger, LogLevel.Warning, connectorId));
        }
        finally
        {
            host.AdditionalPipelinesForTests = null;
            try { host.Stop(); } catch { /* best-effort */ }
        }
    }

    /// <summary>🔴 The projection the ruling's evidence rests on, RE-VERIFIED rather than inherited
    /// (§8.1(h5.1)) — and it is green on both sides of T-1's diff, which is the point of it.
    ///
    /// <para><c>_connectorStartIssues</c> is a FIELD, written one statement after the connector-rejection
    /// line is buffered and in the same loop iteration, so it survives a throw that the line did not. That
    /// asymmetry is what narrowed decision 6: half of what a failed install knew was already pollable at
    /// <c>GET /v1/connectors</c>, and half of it was gone. This test pins the surviving half at the surface
    /// an operator actually reads.</para>
    ///
    /// <para><b>It is deliberately NOT an assertion that the mapping half has no projection.</b> That is a
    /// universal negative and nothing here could refute it. What is checkable, and is stated at the test
    /// above instead, is the closed set: <c>MappingProfileResolver.ResolveOne</c> returns a profile and
    /// invokes one of two callbacks, and writes nothing else anywhere.</para></summary>
    [Fact]
    public void AFailedInstallsRejectedConnector_IsStillReportedByTheProjectionThatOutlivesTheLine()
    {
        const string connectorId = "vendor.t1.projection";

        var registry = new ConnectorRegistry();
        registry.Register(new OrphanLeakingFactory(connectorId, new DisposeCountingDriver("t1-proj-orphan")), config: "garbage");

        var host = CreateHost(connectorRegistry: registry);

        host.AdditionalPipelinesForTests = () => new List<(string, IDeviceDriver, MappingProfile)>
        {
            ("t1-proj-throwing", new DisposeCountingDriver("t1-proj-throwing"), null!),
        };

        try
        {
            Assert.Throws<ArgumentNullException>(() => host.Start());

            // THE ASSERTION: the failed start is over, the fleet is not running, and the connector issue is
            // still there to be read.
            Assert.False(host.IsRunning);
            Assert.Contains(host.GetConfiguredConnectorIssues(), i => i.Id == connectorId);
        }
        finally
        {
            host.AdditionalPipelinesForTests = null;
            try { host.Stop(); } catch { /* best-effort */ }
        }
    }

    /// <summary>🔴 SIBLING PATH 1, which the ruling leaves SILENT: a start abandoned because a
    /// <c>Stop()</c> landed in its off-lock build window.
    ///
    /// <para>The plan has already resolved this machine's mapping profile and already buffered the warning by
    /// the time the abandon check runs — <c>StartBuildObserverForTests</c> fires as the build's last
    /// statement — so the lines exist and are dropped on purpose. Nothing installed, so there is nothing that
    /// happened for the fleet to report; the next start rebuilds the same plan and produces the same
    /// messages. This is the path Start()'s own abandon comment decided, and T-1 does not reopen it.</para>
    ///
    /// <para><b>What makes this falsifiable rather than a green nothing:</b> the same warning is asserted
    /// PRESENT on the throw path two tests above, from the same producer, through the same flush. A fix that
    /// emitted from every non-installing path would turn this test red and that one green together.</para></summary>
    [Fact]
    public void AStartAbandonedByAConcurrentStopRequest_StillSaysNothing()
    {
        var logger = new RecordingLogger();
        var host = CreateHost(logger);
        Assert.True(host.RegisterMachine(T1Machine("T1-ABANDON-01", MissingProfile)));

        var observations = 0;
        var stopped = false;
        host.StartBuildObserverForTests = () =>
        {
            if (Interlocked.Increment(ref observations) > 1) return;
            stopped = Task.Run(() => host.Stop()).Wait(PollTimeout);
        };

        try
        {
            host.Start();

            Assert.Equal(1, Volatile.Read(ref observations));
            Assert.True(stopped, "the mid-build Stop must have completed");
            Assert.False(host.IsRunning);

            // THE ASSERTION: the abandoned start said nothing.
            Assert.Equal(0, Lines(logger, LogLevel.Warning, MissingProfile));
        }
        finally
        {
            host.StartBuildObserverForTests = null;
            try { host.Stop(); } catch { /* best-effort */ }
        }
    }

    /// <summary>🔴 SIBLING PATH 2, which the ruling also leaves SILENT: an install refused by the HALT latch
    /// inside <c>StartLocked</c>.
    ///
    /// <para>Reached the only way it still can be — a roster change on a RUNNING fleet restarts through
    /// <c>RebuildPipelineOffLock</c>, which reads no <c>_stopRequests</c>, so an <c>Estop()</c> landing in
    /// that rebuild's build window meets the latch and nothing else. Same path as
    /// <c>FleetHostStartBuildHoistTests.AnEstopLandingDuringARestartsRebuild_IsRefusedByTheLatchInsideTheLock</c>,
    /// asked a different question.</para>
    ///
    /// <para><b>The mechanism this pins is a STATEMENT ORDER</b>, and it is the one T-1 had to leave alone:
    /// the plan's buffered lines join the caller's list only AFTER the latch has let the install through.
    /// Hoisting that one statement above the latch is what puts new operator-visible output on the halt path,
    /// and it is what turns this test red.</para></summary>
    [Fact]
    public void AnInstallRefusedByTheHaltLatch_StillSaysNothing()
    {
        var logger = new RecordingLogger();
        var host = CreateHost(logger);
        Assert.True(host.RegisterMachine(T1Machine("T1-LATCH-01")));

        host.Start();
        Assert.True(host.IsRunning);

        // Armed only now, so the first start's own build does not consume the one-shot.
        var observations = 0;
        var halted = false;
        host.StartBuildObserverForTests = () =>
        {
            if (Interlocked.Increment(ref observations) > 1) return;
            halted = Task.Run(() => host.Estop()).Wait(PollTimeout);
        };

        try
        {
            // Restarts the running fleet, and the machine it registers is the one carrying the profile that
            // does not exist — so the rebuild's plan holds the warning when the latch refuses it.
            Assert.True(host.RegisterMachine(T1Machine("T1-LATCH-02", MissingProfile)));

            Assert.Equal(1, Volatile.Read(ref observations));
            Assert.True(halted, "the mid-rebuild Estop must have completed");
            Assert.True(host.EstopEngaged);
            Assert.False(host.IsRunning);

            // THE ASSERTION: the refused install said nothing.
            Assert.Equal(0, Lines(logger, LogLevel.Warning, MissingProfile));
        }
        finally
        {
            host.StartBuildObserverForTests = null;
            try { host.Stop(); } catch { /* best-effort */ }
        }
    }

    /// <summary>🔴 T-1 fix round 1 — <b>the guard on the masking T-1 itself invented, and it is the one thing
    /// on this branch that had to be built rather than named.</b>
    ///
    /// <para><b>What review found.</b> Round 1 shipped the emission and justified leaving the window open by
    /// measuring the pre-G-1 tree: those lines were emitted inline, ahead of the slot loop, so a host logger
    /// that threw on them was already the only exception a caller saw. The measurement is true and it proves
    /// something else — pre-G-1 the logger threw <b>ahead of</b> the throw site, so the install never reached
    /// the slot loop and <b>there was no competing diagnostic to lose</b>. The exposure is old; the masking is
    /// new. A task whose purpose is "a failed install must not be silent" cannot ship a reachable "a broken
    /// logger silences the failure".</para>
    ///
    /// <para><b>What this drives.</b> The same three-way failing install as the ruling's witness, plus a host
    /// logger armed to throw on the FIRST line the flush reaches. The assertion is the exception TYPE: the
    /// install's own <c>ArgumentNullException</c>, not the logger's <c>InvalidOperationException</c>. Before
    /// the guard this test gets the logger's.</para>
    ///
    /// <para><b>The other two assertions say what the guard did NOT change.</b> The completion's
    /// <c>finally</c> still disposes the orphan — the guard is around the flush only, so J-2's four-condition
    /// window at the disposal is left exactly as J-2 made it. And the flush still ABORTS at the throwing
    /// line: the connector line behind it never reaches the host, which is unchanged behaviour and is pinned
    /// so nobody reads the guard as "the flush continues".</para>
    ///
    /// <para><b>The success path is not touched, and is witnessed elsewhere:</b>
    /// <c>Start_WhenTheHostLoggerThrowsFlushingDeferredLines_TheOrphanIsDisposedAndTheRunEventRecorded</c>
    /// is a SUCCEEDING start whose host logger throws, and it still expects that throw to reach the caller.
    /// If the guard ever widened past the faulting path, that test goes red.</para></summary>
    [Fact]
    public void AFailedInstallWhoseHostLoggerAlsoThrows_StillReportsWhyTheInstallFailed()
    {
        const string code = "T1-MASK-01";
        const string connectorId = "vendor.t1.mask";

        var logger = new RecordingLogger { ThrowOnFragment = MissingProfile };
        var orphan = new DisposeCountingDriver("t1-mask-orphan");
        var registry = new ConnectorRegistry();
        registry.Register(new OrphanLeakingFactory(connectorId, orphan), config: "garbage");

        var host = CreateHost(logger, connectorRegistry: registry);
        Assert.True(host.RegisterMachine(T1Machine(code, MissingProfile)));

        host.AdditionalPipelinesForTests = () => new List<(string, IDeviceDriver, MappingProfile)>
        {
            ("t1-mask-throwing", new DisposeCountingDriver("t1-mask-throwing"), null!),
        };

        try
        {
            // THE ASSERTION: the caller is told why the INSTALL failed, not that a logger did.
            Assert.Throws<ArgumentNullException>(() => host.Start());

            // The line really was attempted — a green run in which the flush never reached a throwing entry
            // would prove nothing about the guard.
            Assert.Equal(1, Lines(logger, LogLevel.Warning, MissingProfile));

            // Unchanged by the guard, both directions: the disposal in the completion's `finally` still ran…
            Assert.Equal(1, orphan.DisposeCount);

            // …and the flush still stops at the throwing entry rather than resuming past it.
            Assert.Equal(0, Lines(logger, LogLevel.Warning, connectorId));
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
    /// <c>ApplyScenario</c>, whose restart branch is reachable through FleetCore's own enumeration P5 (🔴
    /// since J-1 via <c>RebuildPipelineOffLock</c> → <c>BuildStartPlan</c>, previously via
    /// <c>StartLocked</c> — the reachability is unchanged, the frame is not). A throw there left the fleet at
    /// the burst multiplier with <b>no revert task ever scheduled</b> — indefinitely, until some later
    /// Burst.</para>
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

        // PublishBirth/PublishDeath removed from IUnsPublisher 2026-08-21 (owner's ruling, item 23).

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

        public Task<IReadOnlyList<TelemetrySamplePoint>> QueryTelemetryAsync(string machineCode, string metric, DateTimeOffset from, DateTimeOffset to, CancellationToken ct, bool includeFabricated = false) =>
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
