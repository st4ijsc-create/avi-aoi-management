using System.Collections.Concurrent;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Config;
using St4i.EdgeCore.Drivers.Modbus;
using Xunit;

namespace St4i.EdgeService.Tests;

/// <summary>
/// 🔴 Task E-3 — the <c>connectors.json</c> read path in <see cref="EdgeWorker"/>, and
/// <b>the most important regression check in the task: a deployment with no <c>connectors.json</c> behaves
/// exactly as it does today.</b>
///
/// <para><b>What is asserted where, stated so neither half is over-read.</b> "N devices yield N drivers,
/// each pushing to the transport" is asserted in <c>St4i.EdgeCore.Tests.Engine.EdgeAgentPipelinesTests</c>,
/// against a real transport — that is where the lifecycle lives and where the readings can be counted. What
/// is asserted HERE is the other half: that this host RESOLVES, PARSES and DISPATCHES the file into that
/// many registered instances, and that the simulated run is untouched when there is no file. Splitting them
/// is deliberate: making a Modbus TCP driver actually emit readings needs a live slave, and a test that
/// stands one up would be measuring NModbus, not this host's config path.</para>
/// </summary>
public sealed class EdgeWorkerConnectorsTests
{
    private static readonly TimeSpan NoHangTimeout = TimeSpan.FromSeconds(60);

    /// <summary>Enough commits that every one of the eight default-roster machines has certainly cycled at
    /// least once, so <see cref="AssertEveryRosterMachineRan"/> can be a COVERAGE check rather than a
    /// membership one. Derived, not guessed: the slowest machine in that roster cycles at 0.5 s, the demo
    /// transport serialises one pipeline's sends at its default 40 ms, so the run commits ~25/s and 60
    /// commits is ~2.4 s — roughly four full cycles of the slowest machine. Deliberately a large margin: the
    /// cost is ~2 s of test time and the alternative is a coverage assertion that is flaky by
    /// construction.</summary>
    private const int SmokeForFullCoverage = 60;

    private static string ModbusSettings(string machineCode) => $$"""
        {
          "machineCode": "{{machineCode}}",
          "unitId": 1,
          "pollIntervalMs": 50,
          "registers": [
            { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "temperature", "unit": "C" }
          ]
        }
        """;

    private static string TempFile(string name, string content)
    {
        var dir = Path.Combine(Path.GetTempPath(), "st4i-e3-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, name);
        File.WriteAllText(path, content);
        return path;
    }

    /// <summary>Captures the formatted message of every log line, so the commit stream
    /// <see cref="EdgeWorker.ExecuteAsync"/> emits can be read back. Deliberately reading the SAME line an
    /// operator sees rather than adding a test-only counter to the worker.</summary>
    private sealed class CapturingLogger<T> : ILogger<T>, IDisposable
    {
        public readonly ConcurrentQueue<string> Lines = new();

        public IDisposable BeginScope<TState>(TState state) where TState : notnull => this;

        public void Dispose() { }

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
            Lines.Enqueue(formatter(state, exception));
    }

    private sealed class StoppingLifetime : IHostApplicationLifetime
    {
        public int StopApplicationCallCount { get; private set; }
        public CancellationToken ApplicationStarted => CancellationToken.None;
        public CancellationToken ApplicationStopping => CancellationToken.None;
        public CancellationToken ApplicationStopped => CancellationToken.None;
        public void StopApplication() => StopApplicationCallCount++;
    }

    /// <summary>🔴 <b>SET EQUALITY, not membership, and the difference is a mutation the E-3 review found.</b>
    /// The first cut asserted <c>Assert.All(commits, c =&gt; Assert.Contains(c, roster))</c> with
    /// <c>smoke: 3</c> — pure membership over ~3 observations. The reviewer collapsed all eight simulators
    /// onto machine #1 (<c>SimulatorFactory.Create(fleet[0], …)</c>), <b>seven of eight machines vanished from
    /// the run</b>, and the test stayed green: a run producing one machine code satisfied membership exactly
    /// as happily as one producing eight.
    ///
    /// <para>So the old assertion was sensitive to WHERE THE ROSTER COMES FROM and blind to WHAT IT PRODUCES
    /// — and E-3's own stated limit for that ("blind to the data being read") understated it: it was blind to
    /// which machines ran at all, which is a change an operator notices immediately. Set equality in both
    /// directions closes it: no machine may go missing, and no machine may appear that the roster does not
    /// name.</para>
    ///
    /// <para><see cref="SmokeForFullCoverage"/> is what makes the "no machine missing" half reachable — with
    /// three commits it is unsatisfiable no matter how correct the code is, and an unsatisfiable assertion is
    /// how a test becomes the thing it exists to catch.</para></summary>
    private static void AssertEveryRosterMachineRan(IReadOnlyList<string> commits)
    {
        var roster = EdgeWorker.BuildDefaultFleet().Select(d => d.Code).OrderBy(c => c, StringComparer.Ordinal).ToArray();
        var observed = commits.Distinct(StringComparer.Ordinal).OrderBy(c => c, StringComparer.Ordinal).ToArray();

        Assert.Equal(roster, observed);
    }

    private static IReadOnlyList<string> CommittedMachineCodes(CapturingLogger<EdgeWorker> logger) =>
        logger.Lines
            .Where(l => l.StartsWith("commit #", StringComparison.Ordinal))
            .Select(l => Regex.Match(l, @"machine=(\S+)").Groups[1].Value)
            .ToList();

    /// <summary>🔴 Deliberately does NOT touch <see cref="Environment.ExitCode"/>, and the first cut of this
    /// helper did. <c>Environment.ExitCode</c> is PROCESS-global, xUnit runs test classes in parallel by
    /// default, and <c>EdgeWorkerEmptyRosterTests</c> asserts on it — so saving/restoring it here made that
    /// pre-existing test fail intermittently the moment these tests were added. Caught by running the suite,
    /// not by reading it. The "the empty-roster branch was not taken" property these tests actually need is
    /// asserted from the commit stream and from the absence of that branch's own log line instead, which is
    /// a stronger statement anyway: it names WHICH branch ran.</summary>
    private static async Task<(IReadOnlyList<string> Commits, CapturingLogger<EdgeWorker> Log)> RunSmoke(
        int smoke, string? connectorsPath)
    {
        var lifetime = new StoppingLifetime();
        var logger = new CapturingLogger<EdgeWorker>();
        var worker = new EdgeWorker(
            logger, lifetime,
            new EdgeServiceOptions(SmokeCount: smoke, FleetPath: null, ConnectorsPath: connectorsPath),
            demoModeGate: new DemoModeGate("true")); // demo: the in-code 8-machine roster + DemoTransport

        await worker.StartAsync(CancellationToken.None);
        var executeTask = worker.ExecuteTask!;
        using var stopDeadline = new CancellationTokenSource(NoHangTimeout);
        try
        {
            var finished = await Task.WhenAny(executeTask, Task.Delay(NoHangTimeout));
            Assert.True(ReferenceEquals(finished, executeTask), "EdgeWorker.ExecuteAsync hung instead of completing its smoke run.");
            await executeTask;
        }
        finally
        {
            try { await worker.StopAsync(stopDeadline.Token); } catch { /* teardown */ }
        }

        Assert.True(lifetime.StopApplicationCallCount > 0, "the smoke run never asked the host to stop.");

        // The empty-roster branch (EdgeWorker.SmokeEmptyRosterExitCode) never ran: it is the only path that
        // logs this, and it is the only path that would have set a non-zero process exit code.
        Assert.DoesNotContain(logger.Lines, l => l.Contains("requires at least one machine", StringComparison.Ordinal));

        return (CommittedMachineCodes(logger), logger);
    }

    // ─────────────────────────────────────────────────────────────────────
    // THE REGRESSION: no connectors.json ⇒ the run this host always did.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task NoConnectorsJson_IsExactlyTheSimulatedRunThisHostAlwaysDid()
    {
        var absent = Path.Combine(Path.GetTempPath(), "st4i-e3-absent-" + Guid.NewGuid().ToString("N"), "connectors.json");

        var (commits, log) = await RunSmoke(smoke: SmokeForFullCoverage, connectorsPath: absent);

        Assert.True(commits.Count >= SmokeForFullCoverage / 2, $"expected the smoke run to commit, got {commits.Count}");

        AssertEveryRosterMachineRan(commits);

        // And it says WHERE it looked — blueprint §9.4's "no exception, no warning naming the cause" is the
        // defect class this line exists to close.
        Assert.Contains(log.Lines, l => l.Contains("No connectors configured", StringComparison.Ordinal) && l.Contains(absent, StringComparison.Ordinal));
    }

    [Fact]
    public async Task AMalformedConnectorsJson_DisablesConnectorsLoudly_AndLeavesTheSimulatedRunAlone()
    {
        var path = TempFile("connectors.json", "{ this is not valid json");

        var (commits, log) = await RunSmoke(smoke: SmokeForFullCoverage, connectorsPath: path);

        Assert.True(commits.Count >= SmokeForFullCoverage / 2, $"a malformed connectors.json took the simulated run down: {commits.Count} commits");
        AssertEveryRosterMachineRan(commits);
        Assert.Contains(log.Lines, l => l.Contains("could not be read", StringComparison.Ordinal));
    }

    [Fact]
    public async Task AConnectorsJsonEntry_ActuallyBecomesARunningPipelineInsideEdgeWorker()
    {
        // 🔴 The seam that joins this task's two halves. EdgeWorkerConnectorsTests proves the file parses
        // into N registered instances; EdgeAgentPipelinesTests proves N instances run N drivers that reach
        // the transport. Neither one proves that THIS method hands the registry it built to the agent it
        // runs — a mutation passing `connectors: null` there left every other test in the task green.
        //
        // The Modbus entry points at a port nothing is listening on, deliberately: what is asserted is that
        // a PIPELINE WAS STARTED for it alongside the simulated group, not that a device answered. Standing
        // up a live slave here would be measuring NModbus, and the driver's own read behaviour is covered in
        // St4i.EdgeCore.Tests.
        var json = $$"""
            [ { "id": "gw:unit9", "kind": "Modbus", "settings": {{ModbusSettings("EDGE-WIRED")}} } ]
            """;
        var path = TempFile("connectors.json", json);

        var (commits, log) = await RunSmoke(smoke: SmokeForFullCoverage, connectorsPath: path);

        Assert.True(commits.Count >= 3, "the simulated group stopped running once a connector joined it.");
        var line = Assert.Single(log.Lines, l => l.StartsWith("EdgeWorker running ", StringComparison.Ordinal));
        Assert.Contains("gw:unit9", line, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("simulated", line, StringComparison.Ordinal);
    }

    // ─────────────────────────────────────────────────────────────────────
    // THE READ PATH: resolution, parse, dispatch.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void ResolvePath_DefaultsBesideTheExe_AndHonoursTheFlag()
    {
        Assert.Equal(
            Path.Combine(AppContext.BaseDirectory, EdgeConnectors.ConnectorsFileName),
            EdgeConnectors.ResolvePath(null));
        Assert.Equal(
            Path.Combine(AppContext.BaseDirectory, EdgeConnectors.ConnectorsFileName),
            EdgeConnectors.ResolvePath("   "));
        Assert.Equal(@"C:\somewhere\else.json", EdgeConnectors.ResolvePath(@"C:\somewhere\else.json"));
    }

    [Fact]
    public void NEntries_YieldNRegisteredInstances_EachKeyedByItsOwnId()
    {
        // 🔴 The divergence from EngineApi, pinned: EngineApi keys a TCP entry on its KIND (so N Modbus
        // entries collapse to one); this host keys on the entry's own id, because it has no legacy slot
        // labels or alarm TargetIds to move. Without that decision, "N devices from connectors.json" is
        // not expressible here at all.
        var json = $$"""
            [
              { "id": "gw:unit1", "kind": "Modbus", "settings": {{ModbusSettings("EDGE-M1")}} },
              { "id": "gw:unit2", "kind": "Modbus", "settings": {{ModbusSettings("EDGE-M2")}} },
              { "id": "gw:unit3", "kind": "Modbus", "settings": {{ModbusSettings("EDGE-M3")}} }
            ]
            """;

        var registry = EdgeConnectors.Build(TempFile("connectors.json", json), new CapturingLogger<EdgeWorker>());

        Assert.NotNull(registry);
        Assert.Equal(
            new[] { "gw:unit1", "gw:unit2", "gw:unit3" },
            registry!.RegisteredIds.Select(DriverKinds.Normalize).OrderBy(x => x, StringComparer.Ordinal).ToArray());
    }

    [Fact]
    public void ADuplicateId_IsSkippedWithAWarningNamingBoth_NeverSilentlyLastWriteWins()
    {
        var json = $$"""
            [
              { "id": "gw:unit1", "kind": "Modbus", "settings": {{ModbusSettings("EDGE-A")}} },
              { "id": "gw:unit1", "kind": "Modbus", "settings": {{ModbusSettings("EDGE-B")}} }
            ]
            """;
        var log = new CapturingLogger<EdgeWorker>();

        var registry = EdgeConnectors.Build(TempFile("connectors.json", json), log);

        Assert.NotNull(registry);
        Assert.Single(registry!.RegisteredIds);
        Assert.Contains(log.Lines, l => l.Contains("already configures this same kind earlier in the file", StringComparison.Ordinal));
    }

    [Fact]
    public void AnOpcUaEntry_IsRefusedByName_BecauseItWouldMakeThisHostANewWriterToAMachineWideStore()
    {
        // 🔴 E-3's brief: "no new writer to any machine-wide store". OpcUaConnectorFactory is right here in
        // EdgeCore and would compile — what stops it is the shared %ProgramData%\ST4I\sim\opcua-pki root an
        // OpcUaDriver writes its app-instance certificate into, which has no per-process key. This test is
        // what keeps that a decision rather than an omission somebody "fixes" by adding the switch arm.
        var json = """
            [
              { "id": "plc-1", "kind": "OpcUa", "settings": { "machineCode": "EDGE-OPC", "endpointUrl": "opc.tcp://127.0.0.1:4840", "nodes": [] } }
            ]
            """;
        var log = new CapturingLogger<EdgeWorker>();

        var registry = EdgeConnectors.Build(TempFile("connectors.json", json), log);

        Assert.Null(registry);
        Assert.Contains(log.Lines, l => l.Contains("opcua-pki", StringComparison.Ordinal));
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 TASK E-5 — RS-485. The refusal these three replace is named in each of them, deliberately: E-3's
    // AnRtuBusEntry_IsRefusedByName_RatherThanSilentlyBuildingASecondFanOut pinned a DECISION, and a decision
    // that is reversed has to be reversed in the open rather than by a test quietly going red and being
    // "fixed". What it refused — a second fan-out written here — is still refused; what changed is that the
    // ONE fan-out moved down to St4i.EdgeCore, so this host calls it instead of re-implementing it.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>One device element of a bus document, spelled here rather than shared with EngineApi's tests
    /// on purpose: this file's subject is what THIS host does with the operator's file.</summary>
    private static string RtuDeviceJson(string machineCode, int unitId) => $$"""
        {"machineCode":"{{machineCode}}","unitId":{{unitId}},"pollIntervalMs":1000,"registers":[{"address":0,"type":"Holding","dataType":"UInt16","scale":1.0,"metric":"speed","unit":"rpm"}]}
        """;

    private static string RtuSerialBusEntry(string id, params string[] devices) => $$"""
        [ { "id": "{{id}}", "kind": "Modbus", "settings": { "transport": "rtu-serial", "portName": "COM3",
            "devices": [ {{string.Join(",", devices)}} ] } } ]
        """;

    /// <summary>
    /// 🔴 <b>THE DELIVERABLE OF TASK E-5, AND OF ĐỢT E: an RS-485 bus declared in THIS host's
    /// <c>connectors.json</c> becomes N connector instances, one per device, each claiming exactly one
    /// machine.</b>
    ///
    /// <para>No hardware and no COM port is touched: <c>ModbusRtuConnectorFactory.TryCreate</c> performs no
    /// I/O and the link is opened lazily inside the first transaction, so a bus whose adapter is absent
    /// registers here and degrades honestly at poll time — the same property
    /// <c>ModbusConnectorFactory</c> has for an unplugged TCP device, and the reason
    /// <c>"COM3"</c> is a safe literal in a test on a machine that has no COM3.</para>
    ///
    /// <para>The assertion is the derived id SET, not a count: a fan-out that registered N instances under
    /// one id, or one instance for N machines — blueprint §7.1's unsafe shape — satisfies a count and fails
    /// this. The machine-code claims are asserted separately because the id set alone does not say which
    /// device serves which machine.</para>
    /// </summary>
    [Fact]
    public void AnRtuBusEntry_FansOutIntoOneInstancePerDevice_EachClaimingItsOwnMachine()
    {
        var json = RtuSerialBusEntry(
            "line1", RtuDeviceJson("EDGE-RS-A", 1), RtuDeviceJson("EDGE-RS-B", 2), RtuDeviceJson("EDGE-RS-C", 3));
        var log = new CapturingLogger<EdgeWorker>();

        var registry = EdgeConnectors.Build(
            TempFile("connectors.json", json), log, new ModbusBusRegistry());

        Assert.NotNull(registry);
        Assert.Equal(
            new[] { "line1:unit1", "line1:unit2", "line1:unit3" },
            registry!.RegisteredIds.Select(DriverKinds.Normalize).OrderBy(x => x, StringComparer.Ordinal).ToArray());

        foreach (var (machine, instance) in new[]
                 {
                     ("EDGE-RS-A", "line1:unit1"), ("EDGE-RS-B", "line1:unit2"), ("EDGE-RS-C", "line1:unit3"),
                 })
        {
            Assert.True(registry.TryGetInstanceIdForMachine(machine, out var id), $"{machine} claimed nothing");
            Assert.Equal(instance, id);
        }

        // One entry, three devices — so the summary must count DEVICES. A line saying "1 connector instance"
        // would be a true statement about entries and a false one about what is running.
        Assert.Contains(log.Lines, l => l.Contains("3 connector instance(s) registered", StringComparison.Ordinal));
    }

    /// <summary>
    /// 🔴 <b>Blueprint §9's automatic-direction-control limit, said where the operator plugging the adapter
    /// in will meet it — and this host is the one running on that machine.</b>
    ///
    /// <para>It is a WARNING and not information because the failure it describes is SILENT: an RS-485
    /// adapter that needs its transmit-enable line toggled by software does not throw, it simply never
    /// transmits, and that is indistinguishable at every layer above from a wiring fault or a wrong unit id.
    /// EngineApi has said this since D-7c; until E-5 this host had no path that could.</para>
    /// </summary>
    [Fact]
    public void ASerialBus_WarnsAboutTheAutomaticDirectionControlLimit_OnceForTheSegment()
    {
        var json = RtuSerialBusEntry("line1", RtuDeviceJson("EDGE-DE-A", 1), RtuDeviceJson("EDGE-DE-B", 2));
        var log = new CapturingLogger<EdgeWorker>();

        Assert.NotNull(EdgeConnectors.Build(TempFile("connectors.json", json), log, new ModbusBusRegistry()));

        // Once per SEGMENT, not once per device — the limit is a property of the wire.
        Assert.Single(log.Lines, l => l.Contains("automatic", StringComparison.OrdinalIgnoreCase)
                                      && l.Contains("COM3", StringComparison.Ordinal));
    }

    /// <summary>
    /// A run composed without a bus registry offers no RTU transport at all, and says so by name rather than
    /// dispatching into a path that cannot work. The same arm <c>ConnectorsJsonRegistration</c> has had since
    /// D-7a, and the reason <c>Build</c>'s parameter is optional: the physical line's lifetime is the
    /// process's, so the host owns the registry and this method never constructs one.
    /// </summary>
    [Fact]
    public void AnRtuBusEntry_IsSkippedByName_WhenTheRunOffersNoRtuTransport()
    {
        var json = RtuSerialBusEntry("line1", RtuDeviceJson("EDGE-NOBUS", 1));
        var log = new CapturingLogger<EdgeWorker>();

        Assert.Null(EdgeConnectors.Build(TempFile("connectors.json", json), log));
        Assert.Contains(log.Lines, l => l.Contains("composed without a Modbus bus registry", StringComparison.Ordinal));
    }

    /// <summary>
    /// 🔴 <b>The seam, and E-3's own lesson applied to E-5: nothing else asserts that
    /// <see cref="EdgeWorker"/> hands a REAL bus registry to the dispatch.</b> A mutation passing
    /// <see langword="null"/> there leaves every other test in this task green — the dispatch tests build
    /// their own registry, and the EdgeCore tests never see <c>EdgeWorker</c> — while every RS-485 bus in
    /// production is silently skipped. E-3 found exactly this shape with <c>connectors: null</c>.
    ///
    /// <para>The bus is a GATEWAY here, not a COM port: it points at a CLOSED loopback port, so the connect
    /// is refused, <b>no socket is ever established</b>, the drivers still construct (a
    /// <c>ModbusRtuConnectorFactory</c> performs no I/O and the link opens lazily inside the first
    /// transaction), the pipelines start, and the reads fail honestly. What is asserted is the pipeline
    /// LABELS, which is the observable that says the registry reached the agent — not that anything answered.
    /// 🔴 The E-5 review corrected "a loopback socket" to this: a refused connect is not a socket, and
    /// describing it as one claims a working transport the test does not have.</para>
    /// </summary>
    [Fact]
    public async Task AnRtuBusInConnectorsJson_ActuallyBecomesNRunningPipelinesInsideEdgeWorker()
    {
        var json = $$"""
            [ { "id": "line1", "kind": "Modbus", "settings": { "transport": "rtu-gateway",
                "host": "127.0.0.1", "port": 1,
                "devices": [ {{RtuDeviceJson("EDGE-GW-A", 1)}}, {{RtuDeviceJson("EDGE-GW-B", 2)}} ] } } ]
            """;

        var (_, log) = await RunSmoke(smoke: SmokeForFullCoverage, connectorsPath: TempFile("connectors.json", json));

        var line = Assert.Single(log.Lines, l => l.StartsWith("EdgeWorker running ", StringComparison.Ordinal));
        Assert.Contains("line1:unit1", line, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("line1:unit2", line, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("simulated", line, StringComparison.Ordinal);
    }

    [Fact]
    public void AnUndispatchableKind_IsSkippedByName_AndTheWholeFileStillYieldsNoConnectors()
    {
        var json = """
            [ { "id": "vendor-x", "kind": "SomeThirdParty", "settings": { "anything": true } } ]
            """;
        var log = new CapturingLogger<EdgeWorker>();

        Assert.Null(EdgeConnectors.Build(TempFile("connectors.json", json), log));
        Assert.Contains(log.Lines, l => l.Contains("no in-process factory constructor is available", StringComparison.Ordinal));
    }

    // ─────────────────────────────────────────────────────────────────────
    // THE TWO ROSTER READERS (blueprint §9.4(1)), decided and pinned.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void TheOnlyRosterReaderInThisProcess_IsEdgeWorkersOwn_AndTheDecisionIsStructural()
    {
        // Blueprint §9.4(1): EdgeWorker.LoadFleet/BuildDefaultFleet (8 machines) and FleetCore's own
        // resolver (10 machines) read the SAME `--fleet` flag from the SAME Environment.GetCommandLineArgs(),
        // and E-3 was the task that would have put both in one process.
        //
        // The decision: EdgeWorker's reader wins, and it wins STRUCTURALLY rather than by policy — the other
        // reader is a private method on FleetCore, and FleetCore is not exported from St4i.EdgeCore, so no
        // code in this process can construct the thing that would run it. EdgeAgentPipelines takes a roster
        // it is GIVEN and has no resolver of its own.
        Assert.Equal(8, EdgeWorker.BuildDefaultFleet().Count);
        Assert.Null(typeof(St4i.EdgeCore.Engine.EdgeAgentPipelines).Assembly
            .GetExportedTypes().SingleOrDefault(t => t.Name == "FleetCore"));

        // And EdgeAgentPipelines' public surface carries no roster resolver of its own — the enumeration,
        // not a lookup of one name.
        var resolvers = typeof(St4i.EdgeCore.Engine.EdgeAgentPipelines)
            .GetMethods(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.DeclaredOnly)
            .Where(m => m.Name.Contains("Fleet", StringComparison.Ordinal) || m.Name.Contains("Roster", StringComparison.Ordinal))
            .Select(m => m.Name)
            .ToList();
        Assert.Empty(resolvers);
    }
}
