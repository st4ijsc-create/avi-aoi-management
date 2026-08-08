using System.Collections.Concurrent;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Config;
using St4i.EdgeCore.Drivers.Modbus;
using St4i.EdgeCore.Engine;
using St4i.EdgeCore.Fleet;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Mapping;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Tests.Drivers.Modbus;
using St4i.EdgeCore.Transport;
using Xunit;

namespace St4i.EdgeCore.Tests.Config;

/// <summary>
/// 🔴 <b>Task E-5 — the reason Đợt E existed, joined end to end inside <c>St4i.EdgeCore</c>: one RS-485 bus
/// document becomes N connector instances, N <c>ModbusRtuDriver</c>s sharing ONE open link, N
/// <see cref="EdgeAgentPipelines"/>, and N machines' readings arriving at the transport under their own
/// machine codes.</b>
///
/// <para><b>Why here and not in <c>St4i.EdgeService.Tests</c>.</b> E-3 set the split and it still holds:
/// "this host RESOLVES, PARSES and DISPATCHES the file into that many registered instances" is asserted from
/// the edge host (<c>EdgeWorkerConnectorsTests</c>), and "N instances run N drivers that actually reach the
/// transport" is asserted where the lifecycle and the rig live. This file is the second half for RTU. Both
/// halves exercise the SAME <see cref="ModbusMultidropRegistration"/> — E-5 moved it here precisely so there
/// is only one — so the seam between them is a shared implementation rather than two similar ones.</para>
///
/// <para>🔴 <b>WHAT IS AND IS NOT EXERCISED, said flatly because this is the task that made RS-485 reachable
/// and someone will read a green run as hardware evidence.</b> The rig is D-2's
/// <c>InMemoryBusLinkPair</c>: a REAL in-process NModbus RTU slave network, real CRC, real t3.5 framing, real
/// dispatch by slave address, and real arbitration over one shared link. What it is not is copper. There is
/// no half-duplex collision, no line noise, no torn frame and no baud rate, and <b>no</b>
/// <c>System.IO.Ports</c> anywhere in this test — the serial transport still has not carried a single frame
/// against real hardware, which was true after Đợt D, true after E-1…E-4, and is still true now. The
/// <c>rtu-serial</c> arm that would open a COM port is exercised only as far as
/// <c>ModbusRtuBusPlan.Resolve</c> deciding to build it (<c>EdgeWorkerConnectorsTests</c>); nothing in this
/// repository opens a real RS-485 segment.</para>
///
/// <para>🔴 <b>And a precision the E-5 review insisted on, because the first draft said "a loopback socket":</b>
/// the gateway-arm seam test points at a CLOSED loopback port, so the connect is <b>refused</b> — no socket
/// is ever established and no RTU frame crosses it. What that test observes is that the pipelines were
/// STARTED, which is the property it names. Saying "runs on a loopback socket" would claim a working
/// transport that does not exist.</para>
/// </summary>
public sealed class ModbusMultidropAgentTests
{
    private static readonly TimeSpan Deadline = TimeSpan.FromSeconds(30);

    private const string BusId = "line1-rs485";

    /// <summary>One device element of a bus document. <c>pollIntervalMs</c> is small so the assertion is a
    /// condition rather than a wait, and each device declares ONE holding register at address 0 — which is
    /// the register the harness pre-loads with a value unique to that slave, so attribution is checkable from
    /// the VALUE and not only from the machine code.</summary>
    private static string DeviceJson(string machineCode, int unitId) => $$"""
        {"machineCode":"{{machineCode}}","unitId":{{unitId}},"pollIntervalMs":5,"registers":[{"address":0,"type":"Holding","dataType":"UInt16","scale":1.0,"metric":"speed","unit":"rpm"}]}
        """;

    private static string BusJson(params string[] devices) =>
        "{\"devices\":[" + string.Join(",", devices) + "]}";

    /// <summary>Records what each machine actually sent. Deliberately keyed by machine code AND carrying the
    /// telemetry VALUE off the normalized payload: "N pipelines started" and "N devices answered with their
    /// own data" are different claims, and only the second one is what a multidrop bus can get wrong.
    ///
    /// <para>The value is taken from the envelope's payload rather than from the driver's reading, because
    /// the envelope is what actually leaves the process — the far end of driver → normalize → transport. A
    /// mis-attribution anywhere in that chain shows up here as a foreign number under a machine's
    /// name.</para></summary>
    private sealed class RecordingTransport : ITransport
    {
        public readonly ConcurrentDictionary<string, ConcurrentBag<double>> PerMachine = new(StringComparer.OrdinalIgnoreCase);

        public TransportMode Mode => TransportMode.Demo;

        public Task<TransportAck> SendAsync(CanonicalEnvelope env, CancellationToken ct)
        {
            var values = PerMachine.GetOrAdd(env.MachineCode, _ => new ConcurrentBag<double>());

            // The canonical telemetry payload is { "samples": [ { deviceId, metric, value, … } ] } — see
            // Normalizer.NormalizeTelemetry. Read through it rather than around it: `deviceId` is carried
            // per SAMPLE, so a reading attributed to the wrong machine INSIDE an envelope addressed to the
            // right one would be invisible to an assertion that only looked at env.MachineCode.
            if (env.Payload.TryGetValue("samples", out var raw) && raw is IEnumerable<object> samples)
            {
                foreach (var sample in samples.OfType<IDictionary<string, object?>>())
                {
                    if (sample.TryGetValue("deviceId", out var device) && device is string d
                        && !string.Equals(d, env.MachineCode, StringComparison.OrdinalIgnoreCase))
                    {
                        values.Add(double.NaN); // a sample addressed to a machine other than its envelope's
                        continue;
                    }

                    if (sample.TryGetValue("value", out var v) && v is not null) values.Add(Convert.ToDouble(v));
                }
            }

            return Task.FromResult(new TransportAck(Success: true, Id: 1));
        }

        public Task<HeartbeatResult> HeartbeatAsync(string machineCode, CancellationToken ct) =>
            Task.FromResult(new HeartbeatResult(true, 1, "active", 365));

        public Task<ConfigSyncResult> SyncConfigAsync(
            string machineCode, string configKind, string? cachedVersion, CancellationToken ct) =>
            Task.FromResult(new ConfigSyncResult(false, null, null));
    }

    private static async Task RunUntil(EdgeAgentPipelines agent, ConnectorRegistry registry, Func<bool> until)
    {
        using var cts = new CancellationTokenSource();
        var run = agent.RunAsync(simulators: null, connectors: registry, cts.Token);
        var deadline = DateTime.UtcNow + Deadline;

        while (!until() && DateTime.UtcNow < deadline && !run.IsCompleted)
        {
            await Task.Delay(20).ConfigureAwait(false);
        }

        await cts.CancelAsync();
        try { await run.ConfigureAwait(false); } catch (OperationCanceledException) { }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 THE HEADLINE OF THE WHOLE BATCH.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>Three devices on ONE wire, declared as ONE bus, each reading ITS OWN machine — through the
    /// registration path an edge host now calls.</b>
    ///
    /// <para>Three assertions, and each one is a different claim:</para>
    /// <list type="number">
    /// <item><b>Three instances, one per device, keyed <c>{bus}:unit{n}</c>.</b> The fan-out, not a count of
    /// entries.</item>
    /// <item><b>Each machine's readings carry that device's OWN register value</b> — measured at the
    /// transport, which is the far end of the whole stack. The unsafe shape blueprint §7.1 names (one
    /// registration for the whole bus) cannot produce this: it yields one driver emitting one machine
    /// code.</item>
    /// <item><b>The link was opened EXACTLY ONCE for three drivers.</b> That is the property that makes this
    /// a bus rather than three connectors, and it is the one an RS-485 segment physically requires — three
    /// opens of one COM port is two failures on real hardware. Counted at the opener, so a regression that
    /// re-opened per driver is caught by arithmetic rather than by reading
    /// <see cref="ModbusBusRegistry"/>'s own bookkeeping (D-7c's lesson: read the thing being protected, not
    /// the ledger about it).</item>
    /// </list>
    /// </summary>
    [Fact]
    public async Task AnRs485BusDocument_BecomesNDrivers_EachReachingTheTransportWithItsOwnDevicesData()
    {
        await using var rig = ModbusRtuLoopbackHarness.Start(
            ((byte)1, new ushort[] { 111 }),
            ((byte)2, new ushort[] { 222 }),
            ((byte)3, new ushort[] { 333 }));

        var expected = new[] { ("E5-BUS-A", 1, 111.0), ("E5-BUS-B", 2, 222.0), ("E5-BUS-C", 3, 333.0) };
        var opens = 0;

        var registry = new ConnectorRegistry();
        var registered = ModbusMultidropRegistration.RegisterAll(
            BusJson(expected.Select(e => DeviceJson(e.Item1, e.Item2)).ToArray()),
            BusId,
            _ => new ModbusRtuConnectorFactory(
                busKey: rig.BusKey,
                openLink: _ =>
                {
                    Interlocked.Increment(ref opens);
                    return Task.FromResult<IModbusBusLink>(rig.Links.Master);
                },
                busRegistry: rig.Registry),
            registry);

        Assert.Equal(3, registered);
        Assert.Equal(
            new[] { "line1-rs485:unit1", "line1-rs485:unit2", "line1-rs485:unit3" },
            registry.RegisteredIds.Select(DriverKinds.Normalize).OrderBy(x => x, StringComparer.Ordinal).ToArray());

        var transport = new RecordingTransport();
        var agent = new EdgeAgentPipelines(transport, new EventBus(), MappingProfile.ForClass(DeviceClass.Automation));

        await RunUntil(agent, registry,
            until: () => expected.All(e => transport.PerMachine.TryGetValue(e.Item1, out var v) && !v.IsEmpty));

        Assert.Equal(3, agent.StartedLabels.Count);
        Assert.Empty(agent.StartIssues);

        // 🔴 Attribution, at the transport. Every value a machine ever sent must be that machine's own — a
        // single crossed frame adds a foreign value here.
        foreach (var (code, _, value) in expected)
        {
            Assert.True(transport.PerMachine.TryGetValue(code, out var values) && !values.IsEmpty,
                $"{code} never reached the transport; observed: {string.Join(", ", transport.PerMachine.Keys)}");
            Assert.Equal(new[] { value }, values!.Distinct().ToArray());
        }

        // Nothing but the three declared machines ever spoke.
        Assert.Equal(
            expected.Select(e => e.Item1).OrderBy(c => c, StringComparer.Ordinal).ToArray(),
            transport.PerMachine.Keys.OrderBy(c => c, StringComparer.Ordinal).ToArray());

        Assert.Equal(1, opens);
    }

    /// <summary>
    /// 🔴 <b>The ghost sweep still runs when NOBODY IS WATCHING — D-7a's defect class, checked at the one
    /// place in this file where a log call sits next to a registry MUTATION.</b>
    ///
    /// <para>E-5 turned this path's <c>ILogger</c> into two optional callbacks, and <c>?.</c> short-circuits
    /// an <b>entire argument list</b>: any state computed inside one stops existing for every caller that
    /// passes none. That is exactly how D-7a's read backoff came to exist only for drivers someone happened
    /// to be watching. <c>SweepGhosts</c> calls <see cref="ConnectorRegistry.Unregister"/> — a mutation —
    /// immediately before reporting it, so this test drives the whole re-registration with
    /// <b>both callbacks absent</b> and asserts the sweep happened anyway.</para>
    ///
    /// <para>Stated as the mutation it kills, and <b>enumerated rather than asserted, because the first draft
    /// of this paragraph claimed "every other test of the sweep — all of which supply a logger — stays green"
    /// and that was FALSE.</b> Run: fold the <c>Unregister</c> call into the warning's argument list. Killed —
    /// this test, plus <c>ModbusMultidropRegistrationTests.TheGhostSweep_NeverTouchesAnotherBusOrAnOrdinary
    /// Connector</c> and <c>…AReAddressedDevice_MovesToItsNewInstanceId_…</c>, which E-5's own signature
    /// change turned into nobody-is-watching callers too. Survived: <c>…ADeviceRemovedFromTheBusMap_Is
    /// Unregistered_…</c>, the one sweep test that does pass a warning callback — which is exactly the
    /// asymmetry D-7a is about, and the reason this test is worth having even though it is no longer the only
    /// witness. <i>The universal was wrong in the direction that flatters the test; the enumeration took two
    /// minutes.</i></para>
    /// </summary>
    [Fact]
    public void TheGhostSweep_RunsWithNoLogCallbacksAtAll_AndFreesTheDroppedDevicesMachine()
    {
        var registry = new ConnectorRegistry();

        // A real factory over a real (never-opened) link: this test registers and unregisters without ever
        // starting a driver, so no transaction begins and the opener is never invoked. A production-shaped
        // factory rather than a stub, so the sweep is asked the same question it is asked in the field.
        var factory = new ModbusRtuConnectorFactory(
            busKey: "modbus-rtu-inmemory:sweep",
            openLink: _ => Task.FromResult<IModbusBusLink>(InMemoryBusLinkPair.Create().Master),
            busRegistry: new ModbusBusRegistry());

        Assert.Equal(3, ModbusMultidropRegistration.RegisterAll(
            BusJson(DeviceJson("E5-GHOST-A", 1), DeviceJson("E5-GHOST-B", 2), DeviceJson("E5-GHOST-C", 3)),
            BusId, factory, registry));

        // The re-run drops unit 2. No logWarning, no logError — the nobody-is-watching composition.
        Assert.Equal(2, ModbusMultidropRegistration.RegisterAll(
            BusJson(DeviceJson("E5-GHOST-A", 1), DeviceJson("E5-GHOST-C", 3)),
            BusId, factory, registry));

        Assert.Equal(
            new[] { "line1-rs485:unit1", "line1-rs485:unit3" },
            registry.RegisteredIds.Select(DriverKinds.Normalize).OrderBy(x => x, StringComparer.Ordinal).ToArray());

        // The dropped device's machine is free for another connector to serve — the whole point of the sweep,
        // and the thing that silently stops happening if the mutation above is made.
        Assert.False(registry.TryGetInstanceIdForMachine("E5-GHOST-B", out _));
    }
}
