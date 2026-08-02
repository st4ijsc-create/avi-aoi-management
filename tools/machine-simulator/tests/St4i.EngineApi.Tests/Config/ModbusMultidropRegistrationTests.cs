using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;
using System.Runtime.CompilerServices;
using Microsoft.Extensions.Logging;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Drivers.Modbus;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Mapping;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Config;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests.Config;

/// <summary>
/// 🔴 Task D-4 (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-4-brief.md) — <b>the routing half
/// of multidrop: several machines within reach of ONE physical resource, which is the first genuine test of
/// D-1's invariant.</b>
///
/// <para>Blueprint §7.1 records that one map file has two implementations, indistinguishable in a spec
/// sentence and opposite on safety: the registration path either fans the file out into N connector instances
/// (each one machine), or hands one blob to one factory that produces one driver emitting N machine codes. The
/// second makes <see cref="MachineDriverAvailability.AmbiguousDriver"/> reachable again immediately, because
/// <see cref="SetpointWriteRequest"/> carries no machine code. This suite drives the first and proves it.</para>
///
/// <para><b>Driven, not read</b> — the same discipline that found all six of Đợt B's Criticals. Every test here
/// stands up a real <see cref="ConnectorRegistry"/>, a real <see cref="FleetHost"/>, real pipeline slots built
/// by <c>StartLocked</c>, and real <see cref="FleetHost.TryWriteSetpointAsync"/> calls. The load-bearing
/// assertion is never "B reported Writable"; it is always that B's DEVICE was written and A's and C's were
/// not, because a wrong-machine write is a thing that happens to a device.</para>
///
/// <para><b>And the factory is driven off the config it is HANDED</b>, never off a lookup table this test
/// keeps: <see cref="MapReadingFakeFactory"/> parses the machine code out of whatever configuration string the
/// registry gives it. That is what makes these tests blind to who chose the value — a fan-out that handed
/// every instance the whole bus document, or the wrong device's document, produces the wrong driver here
/// rather than passing on a value the test supplied.</para>
/// </summary>
public sealed class ModbusMultidropRegistrationTests
{
    private const string BusId = "rs485-line1";
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(10);

    private static string DeviceJson(string machineCode, int unitId) =>
        $$"""
        {"machineCode":"{{machineCode}}","unitId":{{unitId}},"pollIntervalMs":1000,"registers":[{"address":0,"type":"Holding","dataType":"UInt16","scale":1.0,"metric":"speed","unit":"rpm"}]}
        """;

    private static string BusJson(params string[] devices) =>
        "{\"devices\":[" + string.Join(",", devices) + "]}";

    private static FleetHost CreateHost(ConnectorRegistry registry)
    {
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo);
        return new FleetHost(switchable, coordinator, new EventBus(), connectorRegistry: registry);
    }

    private static MachineDescriptor ModbusMachine(string code) => new(
        code, $"SN-{code}", DeviceClass.Automation, "MODBUS_RTU", null,
        DriverKinds.Modbus, null, null, CycleSeconds: 0.2);

    private static async Task WaitUntilAsync(Func<bool> predicate, string because)
    {
        var deadline = DateTime.UtcNow + PollTimeout;
        while (DateTime.UtcNow < deadline)
        {
            if (predicate()) return;
            await Task.Delay(100);
        }

        Assert.True(predicate(), $"timed out after {PollTimeout} waiting for: {because}");
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 THE NON-NEGOTIABLE.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 Three machines on ONE bus map, fanned out into three connector instances — and a write for the
    /// middle one reaches its device and only its device.
    ///
    /// <para>Under blueprint §7.1's unsafe shape all three machines would resolve to one slot with one driver
    /// and <see cref="MachineDriverAvailability.AmbiguousDriver"/> would be the only honest answer, exactly as
    /// it was in Đợt B. The pair of assertions at the end is the whole test: the other two drivers' write
    /// counts are still zero.</para>
    /// </summary>
    [Fact]
    public async Task AThreeDeviceBusMap_FansOutIntoThreeInstances_AndAWriteForOneReachesOnlyThatDevice()
    {
        const string codeA = "D4-BUS-A";
        const string codeB = "D4-BUS-B";
        const string codeC = "D4-BUS-C";

        var factory = new MapReadingFakeFactory();
        var registry = new ConnectorRegistry();

        var registered = ModbusMultidropRegistration.RegisterAll(
            BusJson(DeviceJson(codeA, 1), DeviceJson(codeB, 2), DeviceJson(codeC, 3)),
            BusId, factory, registry, NullTestLogger.Instance);

        Assert.Equal(3, registered);
        Assert.Equal(3, registry.RegisteredIds.Count);

        var host = CreateHost(registry);
        Assert.True(host.RegisterMachine(ModbusMachine(codeA)));
        Assert.True(host.RegisterMachine(ModbusMachine(codeB)));
        Assert.True(host.RegisterMachine(ModbusMachine(codeC)));

        host.Start();
        try
        {
            await WaitUntilAsync(
                () => host.GetDriverHealth().Count(s => s.SlotLabel.StartsWith(BusId, StringComparison.Ordinal)) == 3,
                "all three devices on the bus to get their own pipeline slot");

            // Three slots, three labels — the shape that could not exist before D-1 and that §7.1's unsafe
            // reading would collapse back into one.
            var labels = host.GetDriverHealth().Select(s => s.SlotLabel).ToList();
            Assert.Contains(ModbusMultidropMap.DeviceInstanceId(BusId, 1), labels);
            Assert.Contains(ModbusMultidropMap.DeviceInstanceId(BusId, 2), labels);
            Assert.Contains(ModbusMultidropMap.DeviceInstanceId(BusId, 3), labels);

            // 🔴 Not one of them is ambiguous. Every machine on the bus resolves to exactly one driver.
            Assert.Equal(MachineDriverAvailability.Writable, host.GetMachineDriverAvailability(codeA));
            Assert.Equal(MachineDriverAvailability.Writable, host.GetMachineDriverAvailability(codeB));
            Assert.Equal(MachineDriverAvailability.Writable, host.GetMachineDriverAvailability(codeC));

            var (availability, result) = await host.TryWriteSetpointAsync(
                codeB, new SetpointWriteRequest("speed", 77.0), CancellationToken.None);

            Assert.Equal(MachineDriverAvailability.Writable, availability);
            Assert.Equal(WriteOutcome.Applied, result!.Outcome);

            // 🔴 THE PAIR. B's device got it; its two bus-mates were never touched.
            Assert.Equal(1, factory.DriverFor(codeB).WriteCallCount);
            Assert.Equal(0, factory.DriverFor(codeA).WriteCallCount);
            Assert.Equal(0, factory.DriverFor(codeC).WriteCallCount);
            Assert.Equal(77.0, factory.DriverFor(codeB).LastSetpoint!.Value);

            // The same for a command, because CommandRequest carries no machine code either — the two write
            // paths share the resolution and a fix to one that missed the other is this project's most
            // repeated defect shape.
            var (commandAvailability, commandResult) = await host.TryInvokeCommandAsync(
                codeC, new CommandRequest("start-cycle", null), CancellationToken.None);

            Assert.Equal(MachineDriverAvailability.Writable, commandAvailability);
            Assert.Equal(WriteOutcome.Applied, commandResult!.Outcome);
            Assert.Equal(1, factory.DriverFor(codeC).CommandCallCount);
            Assert.Equal(0, factory.DriverFor(codeA).CommandCallCount);
            Assert.Equal(0, factory.DriverFor(codeB).CommandCallCount);
        }
        finally
        {
            host.Stop();
        }
    }

    /// <summary>
    /// 🔴 <b>Every instance is handed ITS OWN device's document, not the bus's.</b> Asserted on what reached
    /// the factory — the boundary — rather than on what this test passed in, because "the fan-out produced
    /// three entries" and "each entry carries one device" are different claims and only the second makes
    /// blueprint §7.1's unsafe shape structurally unreachable downstream.
    ///
    /// <para>A fan-out that stored the whole bus document under three ids would satisfy every count in the
    /// test above and fail here — and would then hand D-7's real RTU factory a document declaring three
    /// machines, which is exactly the driver-emitting-N-machine-codes shape.</para>
    /// </summary>
    [Fact]
    public void EachInstanceStoresItsOwnDevicesDocument_NotTheWholeBus()
    {
        const string codeA = "D4-CFG-A";
        const string codeB = "D4-CFG-B";

        var factory = new MapReadingFakeFactory();
        var registry = new ConnectorRegistry();

        Assert.Equal(2, ModbusMultidropRegistration.RegisterAll(
            BusJson(DeviceJson(codeA, 1), DeviceJson(codeB, 2)),
            BusId, factory, registry, NullTestLogger.Instance));

        // Force the registry to hand each stored config back to the factory, which is the only way this layer
        // ever sees it.
        foreach (var id in registry.RegisteredIds)
        {
            Assert.True(registry.TryCreateDriver(id, out _, out _));
        }

        Assert.Equal(2, factory.ConfigsSeen.Count);
        foreach (var config in factory.ConfigsSeen)
        {
            // It parses as an ordinary SINGLE-device map — the same method the Modbus TCP driver's config goes
            // through — and it names exactly one machine.
            var map = ModbusRegisterMap.FromJson(config);
            Assert.Single(ModbusMultidropMap.FanOut(config, "irrelevant"));

            var sibling = map.MachineCode == codeA ? codeB : codeA;
            Assert.DoesNotContain(sibling, config, StringComparison.Ordinal);
        }

        Assert.Equal(
            new[] { codeA, codeB },
            factory.ConfigsSeen.Select(c => ModbusRegisterMap.FromJson(c).MachineCode).OrderBy(c => c, StringComparer.Ordinal));
    }

    /// <summary>
    /// 🔴 Every registered instance holds exactly ONE machine code, and no machine code is held twice —
    /// enumerated over the registry's own snapshot rather than argued. This is D-1's three uniqueness facts
    /// restated against a multidrop bus, which is the first configuration that puts several machines within
    /// reach of one physical resource.
    /// </summary>
    [Fact]
    public void EveryInstanceOnTheBus_HoldsExactlyOneMachineCode_AndNoCodeIsHeldTwice()
    {
        var codes = new[] { "D4-ENUM-A", "D4-ENUM-B", "D4-ENUM-C", "D4-ENUM-D" };
        var registry = new ConnectorRegistry();

        Assert.Equal(4, ModbusMultidropRegistration.RegisterAll(
            BusJson(codes.Select((c, i) => DeviceJson(c, i + 1)).ToArray()),
            BusId, new MapReadingFakeFactory(), registry, NullTestLogger.Instance));

        var bindings = registry.SnapshotBindings();

        Assert.Equal(4, bindings.Count);
        Assert.All(bindings, b => Assert.False(string.IsNullOrWhiteSpace(b.MachineCode)));
        Assert.Equal(4, bindings.Select(b => b.MachineCode!).Distinct(StringComparer.OrdinalIgnoreCase).Count());
        Assert.Equal(4, bindings.Select(b => b.InstanceId).Distinct(StringComparer.Ordinal).Count());

        // And each code resolves BACK to exactly the instance whose unit id declared it — the lookup
        // FleetHost.ResolveWritableDriver routes on.
        for (var i = 0; i < codes.Length; i++)
        {
            Assert.True(registry.TryGetInstanceIdForMachine(codes[i], out var instanceId));
            Assert.Equal(ModbusMultidropMap.DeviceInstanceId(BusId, (byte)(i + 1)), instanceId);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Refusals the registration path itself owns.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// A device whose machine is already served by ANOTHER connector — on a different bus, which is the case
    /// the map's own duplicate check structurally cannot see — is refused by
    /// <see cref="ConnectorRegistry.Register"/>'s claim gate. The point of this test is that the refusal is
    /// (a) partial, so the rest of the bus still comes up, and (b) NAMED, so an operator can act on it.
    ///
    /// <para>Without the incumbent lookup the message says a device is missing without saying what is holding
    /// its machine, which for a bus of eight is a search rather than a fix.</para>
    /// </summary>
    [Fact]
    public void ADeviceWhoseMachineAnotherBusAlreadyClaims_IsSkippedAndNamed_WhileTheRestOfItsBusComesUp()
    {
        const string shared = "D4-CONTESTED";
        var registry = new ConnectorRegistry();
        var log = new CapturingLogger();

        Assert.Equal(1, ModbusMultidropRegistration.RegisterAll(
            DeviceJson(shared, 5), "bus-one", new MapReadingFakeFactory(), registry, NullTestLogger.Instance));

        var registered = ModbusMultidropRegistration.RegisterAll(
            BusJson(DeviceJson("D4-FINE-A", 1), DeviceJson(shared, 2), DeviceJson("D4-FINE-B", 3)),
            "bus-two", new MapReadingFakeFactory(), registry, log);

        // Two of three: the contested device is dropped, its bus-mates are not.
        Assert.Equal(2, registered);
        Assert.True(registry.TryGetInstanceIdForMachine("D4-FINE-A", out _));
        Assert.True(registry.TryGetInstanceIdForMachine("D4-FINE-B", out _));

        // The incumbent keeps the machine — the claim gate never overwrites.
        Assert.True(registry.TryGetInstanceIdForMachine(shared, out var owner));
        Assert.Equal("bus-one", owner);
        Assert.DoesNotContain(ModbusMultidropMap.DeviceInstanceId("bus-two", 2), registry.RegisteredIds);

        // 🔴 And the operator is told WHO holds it.
        var warning = Assert.Single(log.Messages, m => m.Contains(shared, StringComparison.Ordinal));
        Assert.Contains("bus-one", warning, StringComparison.Ordinal);
        Assert.Contains("bus-two", warning, StringComparison.Ordinal);
    }

    /// <summary>A bus map that will not parse disables that connector for the run and registers nothing —
    /// the pre-existing "a malformed map file disables that driver without crashing the host" posture, applied
    /// to a whole bus. It must not throw: this runs inside startup wiring.</summary>
    [Fact]
    public void AMalformedBusMap_RegistersNothing_LogsAnError_AndDoesNotThrow()
    {
        var registry = new ConnectorRegistry();
        var log = new CapturingLogger();

        var registered = ModbusMultidropRegistration.RegisterAll(
            BusJson(DeviceJson("D4-BAD-A", 1), DeviceJson("D4-BAD-B", 1)),   // duplicate slave address
            BusId, new MapReadingFakeFactory(), registry, log);

        Assert.Equal(0, registered);
        Assert.Empty(registry.RegisteredIds);
        Assert.Contains(log.Messages, m => m.Contains(BusId, StringComparison.Ordinal));
    }

    /// <summary>
    /// 🔴 A map that exists TODAY registers under the bus id itself — same instance id, same pipeline slot
    /// label, same alarm <c>TargetId</c> — so a registration path can start calling the fan-out without
    /// forking every existing operator's acknowledged alarms. Pinned end-to-end rather than only at the map,
    /// because the registration path is where the id actually becomes a key.
    /// </summary>
    [Fact]
    public void ALegacySingleDeviceMap_RegistersOneInstance_UnderTheBusIdItself()
    {
        var registry = new ConnectorRegistry();

        Assert.Equal(1, ModbusMultidropRegistration.RegisterAll(
            DeviceJson("D4-LEGACY", 3), DriverKinds.Modbus, new MapReadingFakeFactory(), registry,
            NullTestLogger.Instance));

        Assert.Equal(new[] { DriverKinds.Modbus }, registry.RegisteredIds);
        Assert.True(registry.TryGetInstanceIdForMachine("D4-LEGACY", out var instanceId));
        Assert.Equal(DriverKinds.Modbus, instanceId);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Test doubles
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// A connector factory that builds its driver from the CONFIGURATION IT IS HANDED — it parses the machine
    /// code out of the register map, exactly as a real one would. That is deliberate: a factory driven off a
    /// lookup this test keeps would report the machine the test expects no matter what the registry stored,
    /// which is the "a test that supplies the value it checks" shape D-2 was bitten by.
    /// </summary>
    private sealed class MapReadingFakeFactory : IConnectorFactory
    {
        private readonly ConcurrentDictionary<string, MultidropFakeWritableDriver> _drivers =
            new(StringComparer.OrdinalIgnoreCase);
        private readonly ConcurrentQueue<string> _configs = new();

        public string Kind => DriverKinds.Modbus;

        /// <summary>Every configuration string this factory was handed, in call order.</summary>
        public IReadOnlyList<string> ConfigsSeen => _configs.ToList();

        /// <summary>The one driver serving <paramref name="machineCode"/>. Throws if none was ever built for
        /// it, which is itself the assertion when a fan-out lost a device.</summary>
        public MultidropFakeWritableDriver DriverFor(string machineCode) => _drivers[machineCode];

        public bool TryCreate(string config, [NotNullWhen(true)] out IDeviceDriver? driver, [NotNullWhen(false)] out string? error)
        {
            _configs.Enqueue(config);

            ModbusRegisterMap map;
            try
            {
                map = ModbusRegisterMap.FromJson(config);
            }
            catch (Exception ex)
            {
                driver = null;
                error = ex.Message;
                return false;
            }

            // GetOrAdd, not new: FleetHost builds a fresh driver on every (re)start, and the assertions are
            // about which MACHINE was written to across the whole test, not about one object's lifetime.
            driver = _drivers.GetOrAdd(map.MachineCode, code => new MultidropFakeWritableDriver(code));
            error = null;
            return true;
        }
    }

    /// <summary>A writable driver that knows which machine it serves and counts what it is asked to do — the
    /// assertions in this suite are all about whether the RIGHT one of these was called.</summary>
    internal sealed class MultidropFakeWritableDriver : IWritableDeviceDriver
    {
        private readonly string _machineCode;
        private int _writeCallCount;
        private int _commandCallCount;

        public MultidropFakeWritableDriver(string machineCode) => _machineCode = machineCode;

        public string Id => $"fake-multidrop-{_machineCode}";

        public string Kind => DriverKinds.Modbus;

        public DriverHealthState Health => DriverHealthState.Connected;

        public IReadOnlyList<string> WritablePoints { get; } = new[] { "speed" };

        public IReadOnlyList<string> Commands { get; } = new[] { "start-cycle" };

        public int WriteCallCount => Volatile.Read(ref _writeCallCount);

        public int CommandCallCount => Volatile.Read(ref _commandCallCount);

        public SetpointWriteRequest? LastSetpoint { get; private set; }

        public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
        {
            await Task.Delay(Timeout.Infinite, ct).ConfigureAwait(false);
            yield break; // unreachable — Task.Delay(Infinite, ct) only completes by throwing on cancel
        }

        public Task<SetpointWriteResult> WriteSetpointAsync(SetpointWriteRequest request, CancellationToken ct)
        {
            Interlocked.Increment(ref _writeCallCount);
            LastSetpoint = request;
            return Task.FromResult(new SetpointWriteResult(request.Point, WriteOutcome.Applied));
        }

        public Task<CommandResult> InvokeCommandAsync(CommandRequest request, CancellationToken ct)
        {
            Interlocked.Increment(ref _commandCallCount);
            return Task.FromResult(new CommandResult(request.Command, WriteOutcome.Applied));
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }

    /// <summary>Collects formatted log messages so a test can assert on what an operator is actually told —
    /// used only where the MESSAGE is the deliverable (naming the incumbent that holds a contested
    /// machine).</summary>
    private sealed class CapturingLogger : ILogger
    {
        private readonly List<string> _messages = new();

        public IReadOnlyList<string> Messages { get { lock (_messages) { return _messages.ToList(); } } }

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            lock (_messages)
            {
                _messages.Add(formatter(state, exception));
            }
        }
    }

    /// <summary>A logger that discards everything — for the tests whose deliverable is the registry's state,
    /// not the message.</summary>
    private sealed class NullTestLogger : ILogger
    {
        public static readonly NullTestLogger Instance = new();

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => false;

        public void Log<TState>(
            LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        { }
    }
}
