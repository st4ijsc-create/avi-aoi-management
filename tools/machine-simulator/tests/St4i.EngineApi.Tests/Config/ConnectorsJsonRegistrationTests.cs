using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Drivers.Modbus;
using St4i.EdgeCore.Drivers.OpcUa;
using St4i.EngineApi.Config;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests.Config;

/// <summary>
/// 🔴 D-1 review, I-3 — the <c>connectors.json</c> → <see cref="ConnectorRegistry"/> dispatch, which had
/// NEVER been covered by any test before or after Task D-1.
///
/// <para><b>How the gap was found, and why it could not be closed where the code used to live.</b> A
/// mutation that made every <c>connectors.json</c> connector register UNBOUND (dropping the
/// <c>machineCode:</c> argument D-1 added) left the entire suite green. The dispatch sat inline in
/// <c>Program.cs</c>'s DI lambda, and <c>Program.cs</c> reads <c>connectors.json</c> from
/// <see cref="AppContext.BaseDirectory"/> — ONE shared artifact in this test assembly's own output
/// directory — so a test that wrote it would race every other test here. The fix was to extract the loop
/// (<see cref="ConnectorsJsonRegistration.RegisterAll"/>) rather than to ship an
/// <c>ST4I_CONNECTORS_CONFIG</c> path override: a new operator-visible configuration knob is a permanent
/// commitment, and adding one purely to serve a test is the wrong trade.</para>
///
/// <para>What is deliberately NOT re-tested here: <see cref="ConnectorsConfig.Load"/> and
/// <see cref="ConnectorsConfig.ResolveEntries"/>, which <c>ConnectorsConfigTests</c> already covers against
/// real temp files. These tests take entries as given and assert only what the dispatch itself does.</para>
/// </summary>
public sealed class ConnectorsJsonRegistrationTests
{
    private static readonly ModbusOptions Modbus = new() { Enabled = true, Host = "127.0.0.1", Port = 15020 };
    private static readonly OpcUaOptions OpcUa = new();
    private static ILogger Logger => NullLogger.Instance;

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

    private static string OpcUaSettings(string machineCode) => $$"""
        {
          "machineCode": "{{machineCode}}",
          "endpointUrl": "opc.tcp://127.0.0.1:4840",
          "pollIntervalMs": 50,
          "nodes": [
            { "nodeId": "ns=2;s=Temperature", "metric": "temperature", "unit": "C" }
          ]
        }
        """;

    [Fact]
    public void AModbusEntry_RegistersUnderItsKind_AndIsBoundToTheMachineItsSettingsDeclare()
    {
        // 🔴 The assertion the surviving mutation exposed. Registering is not enough: an UNBOUND connector
        // looks identical to a working one until somebody writes to it, at which point FleetHost falls back
        // to the pre-D-1 kind rule and a second same-kind machine makes both of them ambiguous.
        var registry = new ConnectorRegistry();

        var registered = ConnectorsJsonRegistration.RegisterAll(
            new[] { new ConnectorConfigEntry("line3-weld", DriverKinds.Modbus, ModbusSettings("CJ-MODBUS-01")) },
            Modbus, OpcUa, registry, Logger);

        Assert.Equal(1, registered);
        Assert.Equal(new[] { DriverKinds.Modbus }, registry.RegisteredIds);
        Assert.True(registry.TryGetInstanceIdForMachine("CJ-MODBUS-01", out var instanceId));
        Assert.Equal(DriverKinds.Modbus, instanceId);
    }

    [Fact]
    public void AnOpcUaEntry_RegistersUnderItsKind_AndIsBoundToTheMachineItsSettingsDeclare()
    {
        // Both dispatch arms, not one plus an inference that the other "is the same code" — that inference
        // is exactly what Đợt B's review round 1 found to be false for the two halves of a symmetric pair.
        var registry = new ConnectorRegistry();

        var registered = ConnectorsJsonRegistration.RegisterAll(
            new[] { new ConnectorConfigEntry("cell-7", DriverKinds.OpcUa, OpcUaSettings("CJ-OPCUA-01")) },
            Modbus, OpcUa, registry, Logger);

        Assert.Equal(1, registered);
        Assert.Equal(new[] { DriverKinds.OpcUa }, registry.RegisteredIds);
        Assert.True(registry.TryGetInstanceIdForMachine("CJ-OPCUA-01", out var instanceId));
        Assert.Equal(DriverKinds.OpcUa, instanceId);
    }

    [Fact]
    public void TheEntrysOwnIdIsNotAdoptedAsTheInstanceId_SoItsPipelineSlotLabelAndAlarmTargetAreUnchanged()
    {
        // A deliberate D-1 decision, pinned so it cannot drift silently: `id` in connectors.json is
        // documented as naming-for-warnings only. Adopting it would move every such connector's pipeline
        // slot label — and therefore the TargetId its degraded/down alarms are keyed on — for no gain this
        // task needs. Promoting it is D-7's file-format work; until then this test is what says so.
        var registry = new ConnectorRegistry();

        ConnectorsJsonRegistration.RegisterAll(
            new[] { new ConnectorConfigEntry("line3-weld", DriverKinds.Modbus, ModbusSettings("CJ-ID-01")) },
            Modbus, OpcUa, registry, Logger);

        Assert.Equal(new[] { DriverKinds.Modbus }, registry.RegisteredIds);
        Assert.DoesNotContain("line3-weld", registry.RegisteredIds);
    }

    [Fact]
    public void AnEntryWhoseSettingsWillNotValidate_StillRegisters_ButUnbound()
    {
        // The pre-D-1 behaviour, preserved exactly: a blob this layer cannot parse still registers, and its
        // factory still gets its own chance to accept or reject the same blob at StartLocked. What it does
        // NOT get is a machine binding — there is no machine code to learn — so such a connector keeps
        // resolving under the kind-based rule, ambiguity guard included. Asserting this rather than leaving
        // it implied, because "registers but unbound" is precisely the state the mutation produced and the
        // one that must stay reachable ONLY here.
        var registry = new ConnectorRegistry();

        var registered = ConnectorsJsonRegistration.RegisterAll(
            new[] { new ConnectorConfigEntry("broken", DriverKinds.Modbus, """{"not":"a register map"}""") },
            Modbus, OpcUa, registry, Logger);

        Assert.Equal(1, registered);
        Assert.Equal(new[] { DriverKinds.Modbus }, registry.RegisteredIds);
        Assert.False(registry.IsBoundToAMachine(DriverKinds.Modbus));
    }

    [Fact]
    public void AnUndispatchableThirdPartyKind_IsSkipped_NeverRegistered()
    {
        // There is no in-process plugin loader in this build, so a third-party kind has no factory to
        // construct. It must be skipped visibly (the method logs it) and must never end up in the registry
        // — a phantom entry would get a pipeline slot that can never produce a driver.
        var registry = new ConnectorRegistry();

        var registered = ConnectorsJsonRegistration.RegisterAll(
            new[] { new ConnectorConfigEntry("weld", "vendor.acme.weld", """{"anything":true}""") },
            Modbus, OpcUa, registry, Logger);

        Assert.Equal(0, registered);
        Assert.Empty(registry.RegisteredIds);
    }

    [Fact]
    public void AnEntryClaimingAMachineAnotherInstanceAlreadyServes_IsRefused_AndDoesNotDisplaceTheIncumbent()
    {
        // The claim gate seen from this path: connectors.json is layered on TOP of the env-var registrations,
        // so an entry naming a machine an env-var connector already serves must lose — not silently replace
        // it, and not be registered alongside it, because two connectors driving one machine is the state a
        // write cannot be resolved in.
        const string contested = "CJ-CONTESTED";
        var registry = new ConnectorRegistry();
        Assert.True(registry.Register(
            new ModbusConnectorFactory(Modbus), ModbusSettings(contested),
            instanceId: "env-var-modbus", machineCode: contested));

        var registered = ConnectorsJsonRegistration.RegisterAll(
            new[] { new ConnectorConfigEntry("late", DriverKinds.Modbus, ModbusSettings(contested)) },
            Modbus, OpcUa, registry, Logger);

        Assert.Equal(0, registered);
        Assert.Equal(new[] { "env-var-modbus" }, registry.RegisteredIds);
        Assert.True(registry.TryGetInstanceIdForMachine(contested, out var claimant));
        Assert.Equal("env-var-modbus", claimant);
    }

    [Fact]
    public void EveryEntryIsAttempted_OneUndispatchableEntryNeverStopsTheNextOne()
    {
        // The GP-3 "one bad entry must never destroy the file" lesson, at the dispatch layer rather than the
        // parse layer: a skipped entry must not abort the loop and take a perfectly good sibling with it.
        var registry = new ConnectorRegistry();

        var registered = ConnectorsJsonRegistration.RegisterAll(
            new[]
            {
                new ConnectorConfigEntry("weld", "vendor.acme.weld", """{"x":1}"""),
                new ConnectorConfigEntry("plc", DriverKinds.Modbus, ModbusSettings("CJ-SURVIVOR-01")),
            },
            Modbus, OpcUa, registry, Logger);

        Assert.Equal(1, registered);
        Assert.True(registry.TryGetInstanceIdForMachine("CJ-SURVIVOR-01", out _));
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 Task D-7a — the RTU arm. THE deliverable: a multidrop bus declared in a configuration file.
    // ─────────────────────────────────────────────────────────────────────

    private static string RtuBusSettings(string host, int port, params (string MachineCode, int UnitId)[] devices) =>
        $$"""
        {
          "transport": "rtu-gateway",
          "host": "{{host}}",
          "port": {{port}},
          "devices": [ {{string.Join(",", devices.Select(d => $$"""
            {"machineCode":"{{d.MachineCode}}","unitId":{{d.UnitId}},"pollIntervalMs":1000,"readTimeoutMs":300,
             "registers":[{"address":0,"type":"Holding","dataType":"UInt16","scale":1.0,"metric":"speed","unit":"rpm"}]}
            """))}} ]
        }
        """;

    /// <summary>
    /// 🔴 <b>THE deliverable of D-7a, in one test: a multidrop <c>connectors.json</c> entry produces N
    /// registered instances, each bound to its own machine code.</b>
    ///
    /// <para>Everything RTU built in D-2…D-6 was unreachable from any configuration an operator can write.
    /// This is the entry that reaches it. The bus's own <c>id</c> becomes the instance id — the promotion
    /// <see cref="ConnectorsJsonRegistration"/>'s own D-1 comment deferred to "D-7's configuration work" — and
    /// each device derives <c>{bus}:unit{n}</c> from it.</para>
    /// </summary>
    [Fact]
    public async Task AMultidropRtuBusEntry_ProducesOneRegisteredInstancePerDevice_EachBoundToItsOwnMachine()
    {
        var registry = new ConnectorRegistry();
        await using var buses = new ModbusBusRegistry();

        var registered = ConnectorsJsonRegistration.RegisterAll(
            new[]
            {
                new ConnectorConfigEntry(
                    "rs485-line1", DriverKinds.Modbus,
                    RtuBusSettings("gw.example", 4001, ("CJ-RTU-A", 1), ("CJ-RTU-B", 2), ("CJ-RTU-C", 3))),
            },
            Modbus, OpcUa, registry, Logger, buses);

        Assert.Equal(3, registered);
        Assert.Equal(3, registry.RegisteredIds.Count);

        foreach (var (code, unit) in new[] { ("CJ-RTU-A", 1), ("CJ-RTU-B", 2), ("CJ-RTU-C", 3) })
        {
            Assert.True(registry.TryGetInstanceIdForMachine(code, out var instanceId), $"{code} should be claimed");
            Assert.Equal(ModbusMultidropMap.DeviceInstanceId("rs485-line1", (byte)unit), instanceId);
            Assert.Equal(DriverKinds.Modbus, registry.KindOf(instanceId));
        }

        // 🔴 Every instance builds a REAL ModbusRtuDriver, and they all lease the SAME bus — the "one open for
        // N leases" property, asserted through the registry that enforces it rather than through three
        // drivers that merely happen to work.
        var drivers = new List<IDeviceDriver>();
        foreach (var id in registry.RegisteredIds)
        {
            Assert.True(registry.TryCreateDriver(id, out var driver, out var error), error);
            drivers.Add(driver!);
        }

        Assert.Equal(3, buses.LeaseCount(GatewayTcpBusLink.CreateBusKey("gw.example", 4001)));

        // 🔴 And each driver serves exactly ONE machine — the property blueprint §7.1 forbids the other
        // registration shape for, checked by enumeration over the drivers' own ids rather than by trusting the
        // registry's bookkeeping.
        Assert.Equal(3, drivers.Select(d => d.Id).Distinct().Count());
        foreach (var code in new[] { "CJ-RTU-A", "CJ-RTU-B", "CJ-RTU-C" })
        {
            Assert.Single(drivers, d => d.Id.EndsWith(":" + code, StringComparison.Ordinal));
        }

        foreach (var driver in drivers) await driver.DisposeAsync();
    }

    /// <summary>
    /// 🔴 <b>Two RS-485 lines in one file — the shape that could not be expressed before D-7a for a reason
    /// nothing to do with RTU.</b> <see cref="ConnectorsConfig.ResolveEntries"/> de-duplicates to one entry per
    /// REGISTRATION KEY, and both buses are <c>kind: "Modbus"</c>; keyed on the kind, the second bus was called
    /// a duplicate of the first. See <see cref="ConnectorsJsonRegistration.RegistrationKeyOf"/>.
    /// </summary>
    [Fact]
    public async Task TwoRtuBusesInOneFile_AreTwoBuses_NotADuplicate()
    {
        var registry = new ConnectorRegistry();
        await using var buses = new ModbusBusRegistry();

        var entries = new[]
        {
            new ConnectorConfigEntry("line1", DriverKinds.Modbus, RtuBusSettings("gw.example", 4001, ("CJ-L1-A", 1))),
            new ConnectorConfigEntry("line2", DriverKinds.Modbus, RtuBusSettings("gw.example", 4002, ("CJ-L2-A", 1))),
        };

        // The resolver has to survive resolution first — that is where the de-duplication lives.
        var resolved = ConnectorsConfig.ResolveEntries(
            entries, new HashSet<string>(StringComparer.Ordinal),
            registrationKeyOf: ConnectorsJsonRegistration.RegistrationKeyOf);
        Assert.Equal(2, resolved.Count);

        Assert.Equal(2, ConnectorsJsonRegistration.RegisterAll(resolved, Modbus, OpcUa, registry, Logger, buses));

        Assert.True(registry.TryGetInstanceIdForMachine("CJ-L1-A", out var l1));
        Assert.True(registry.TryGetInstanceIdForMachine("CJ-L2-A", out var l2));
        Assert.NotEqual(l1, l2);

        // 🔴 Two GATEWAYS, two bus keys, two leases — one per line. A single shared bus here would mean two
        // physically separate RS-485 segments arbitrating against one lock, which is the "a caller invents its
        // own key" hazard ModbusBusRegistry's doc comment names.
        Assert.True(registry.TryCreateDriver(l1, out var d1, out _));
        Assert.True(registry.TryCreateDriver(l2, out var d2, out _));
        Assert.Equal(1, buses.LeaseCount(GatewayTcpBusLink.CreateBusKey("gw.example", 4001)));
        Assert.Equal(1, buses.LeaseCount(GatewayTcpBusLink.CreateBusKey("gw.example", 4002)));

        await d1!.DisposeAsync();
        await d2!.DisposeAsync();
    }

    /// <summary>
    /// 🔴 <b>The compatibility rule, as a discriminating pair rather than an argument.</b> The registration key
    /// is what both of <see cref="ConnectorsConfig.ResolveEntries"/>'s rules compare on, and every entry that
    /// could have existed before D-7a must still answer with its KIND — otherwise an install with
    /// <c>ST4I_MODBUS_MAP</c> set would stop suppressing its <c>connectors.json</c> Modbus entry, which is the
    /// one behaviour the whole precedence rule exists to guarantee.
    /// </summary>
    [Fact]
    public void TheRegistrationKey_IsTheKindForEveryPreD7aEntry_AndTheBusIdOnlyForAnRtuBus()
    {
        // Pre-D-7a shapes — including one carrying an explicit id, which is precisely the case that must NOT
        // move (its pipeline slot label, and therefore its alarm TargetId, would fork).
        Assert.Equal(DriverKinds.Modbus, ConnectorsJsonRegistration.RegistrationKeyOf(
            new ConnectorConfigEntry(DriverKinds.Modbus, DriverKinds.Modbus, ModbusSettings("CJ-KEY-1"))));
        Assert.Equal(DriverKinds.Modbus, ConnectorsJsonRegistration.RegistrationKeyOf(
            new ConnectorConfigEntry("line3-weld", DriverKinds.Modbus, ModbusSettings("CJ-KEY-2"))));
        Assert.Equal(DriverKinds.OpcUa, ConnectorsJsonRegistration.RegistrationKeyOf(
            new ConnectorConfigEntry("cell-7", DriverKinds.OpcUa, OpcUaSettings("CJ-KEY-3"))));
        Assert.Equal("vendor.acme.weld", ConnectorsJsonRegistration.RegistrationKeyOf(
            new ConnectorConfigEntry("weld", "vendor.acme.weld", """{"x":1}""")));

        // 🔴 …and only a Modbus entry that DECLARES A TRANSPORT answers with its own id.
        Assert.Equal("rs485-line1", ConnectorsJsonRegistration.RegistrationKeyOf(
            new ConnectorConfigEntry("rs485-line1", DriverKinds.Modbus, RtuBusSettings("gw", 4001, ("CJ-KEY-4", 1)))));
    }

    /// <summary>An RTU bus in a host that was composed without a Modbus bus registry is skipped with a named
    /// warning, never dispatched into a path that cannot work. The parameter is optional so every pre-D-7a
    /// caller compiles unchanged, which makes "the host forgot" a reachable state rather than a
    /// hypothetical.</summary>
    [Fact]
    public void AnRtuBus_InAHostWithNoBusRegistry_IsSkippedRatherThanHalfWired()
    {
        var registry = new ConnectorRegistry();

        var registered = ConnectorsJsonRegistration.RegisterAll(
            new[]
            {
                new ConnectorConfigEntry("rs485-line1", DriverKinds.Modbus, RtuBusSettings("gw", 4001, ("CJ-NOBUS", 1))),
                new ConnectorConfigEntry("plc", DriverKinds.Modbus, ModbusSettings("CJ-NOBUS-TCP")),
            },
            Modbus, OpcUa, registry, Logger, modbusBusRegistry: null);

        // The RTU bus registered nothing; the ordinary TCP entry beside it is unaffected.
        Assert.Equal(1, registered);
        Assert.False(registry.TryGetInstanceIdForMachine("CJ-NOBUS", out _));
        Assert.True(registry.TryGetInstanceIdForMachine("CJ-NOBUS-TCP", out _));
    }

    /// <summary>
    /// 🔴 <b>What a partial failure does, at the BUS level.</b> A bus whose settings will not parse — here a
    /// transport this build cannot open — disables that whole bus and nothing else. Every other connector in
    /// the file, including a second RTU bus, still registers. Stated in
    /// <see cref="ModbusRtuBusSettings"/>'s own doc comment as one of three levels; this is the middle one.
    /// </summary>
    [Fact]
    public async Task ABusThatWillNotParse_DisablesThatBusAlone()
    {
        var registry = new ConnectorRegistry();
        await using var buses = new ModbusBusRegistry();

        var registered = ConnectorsJsonRegistration.RegisterAll(
            new[]
            {
                new ConnectorConfigEntry(
                    "com3-line", DriverKinds.Modbus,
                    """{"transport":"rtu-serial","portName":"COM3","devices":[]}"""),
                new ConnectorConfigEntry(
                    "gw-line", DriverKinds.Modbus, RtuBusSettings("gw", 4001, ("CJ-PARTIAL-A", 1), ("CJ-PARTIAL-B", 2))),
            },
            Modbus, OpcUa, registry, Logger, buses);

        Assert.Equal(2, registered);
        Assert.False(registry.TryGetInstanceIdForMachine("CJ-SERIAL", out _));
        Assert.True(registry.TryGetInstanceIdForMachine("CJ-PARTIAL-A", out _));
        Assert.True(registry.TryGetInstanceIdForMachine("CJ-PARTIAL-B", out _));
    }

    /// <summary>
    /// 🔴 <b>An RTU bus whose device count SHRANK re-registers cleanly.</b> The end-to-end form of D-4 review
    /// m6, through the dispatch an operator's edit actually goes through: re-running startup after deleting a
    /// device from the file leaves no ghost holding that machine.
    /// </summary>
    [Fact]
    public async Task ReRunningRegistrationAfterADeviceIsDeletedFromTheFile_LeavesNoGhost()
    {
        var registry = new ConnectorRegistry();
        await using var buses = new ModbusBusRegistry();

        Assert.Equal(2, ConnectorsJsonRegistration.RegisterAll(
            new[]
            {
                new ConnectorConfigEntry(
                    "rs485-line1", DriverKinds.Modbus,
                    RtuBusSettings("gw", 4001, ("CJ-SHRINK-A", 1), ("CJ-SHRINK-B", 2))),
            },
            Modbus, OpcUa, registry, Logger, buses));

        Assert.Equal(1, ConnectorsJsonRegistration.RegisterAll(
            new[]
            {
                new ConnectorConfigEntry(
                    "rs485-line1", DriverKinds.Modbus, RtuBusSettings("gw", 4001, ("CJ-SHRINK-A", 1))),
            },
            Modbus, OpcUa, registry, Logger, buses));

        Assert.Single(registry.RegisteredIds);
        Assert.False(registry.TryGetInstanceIdForMachine("CJ-SHRINK-B", out _));
    }
}
