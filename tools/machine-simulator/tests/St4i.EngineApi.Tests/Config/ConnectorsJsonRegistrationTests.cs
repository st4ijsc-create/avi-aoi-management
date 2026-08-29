using System.IO.Ports;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Drivers.Modbus;
using St4i.EdgeCore.Drivers.OpcUa;
using St4i.EngineApi.Config;
using St4i.EngineApi.Fleet;
using Xunit;
using St4i.EdgeCore.Config;  // E-3: ConnectorsConfig/ConnectorConfigEntry moved down (one parser, both hosts).

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
    public void AModbusEntry_RegistersUnderItsOwnId_AndIsBoundToTheMachineItsSettingsDeclare()
    {
        // 🔴 The assertion the surviving mutation exposed. Registering is not enough: an UNBOUND connector
        // looks identical to a working one until somebody writes to it, at which point FleetHost falls back
        // to the pre-D-1 kind rule and a second same-kind machine makes both of them ambiguous.
        // 🔴 OWNER ITEM 65, DIRECTION A, 2026-08-25 — this test's NAME and its two key assertions changed.
        // It read `RegistersUnderItsKind` and asserted `RegisteredIds == [DriverKinds.Modbus]`; the entry
        // carries the explicit id "line3-weld" and now registers under it. The MACHINE BINDING half is
        // untouched and is why the rest of the test is unchanged.
        var registry = new ConnectorRegistry();

        var registered = ConnectorsJsonRegistration.RegisterAll(
            new[] { new ConnectorConfigEntry("line3-weld", DriverKinds.Modbus, ModbusSettings("CJ-MODBUS-01")) },
            Modbus, OpcUa, registry, Logger);

        Assert.Equal(1, registered);
        Assert.Equal(new[] { "line3-weld" }, registry.RegisteredIds);
        Assert.True(registry.TryGetInstanceIdForMachine("CJ-MODBUS-01", out var instanceId));
        Assert.Equal("line3-weld", instanceId);
    }

    [Fact]
    public void AnOpcUaEntry_RegistersUnderItsOwnId_AndIsBoundToTheMachineItsSettingsDeclare()
    {
        // Both dispatch arms, not one plus an inference that the other "is the same code" — that inference
        // is exactly what Đợt B's review round 1 found to be false for the two halves of a symmetric pair.
        // 🔴 Renamed and re-pinned by owner item 65 direction A, 2026-08-25; see the Modbus twin above.
        var registry = new ConnectorRegistry();

        var registered = ConnectorsJsonRegistration.RegisterAll(
            new[] { new ConnectorConfigEntry("cell-7", DriverKinds.OpcUa, OpcUaSettings("CJ-OPCUA-01")) },
            Modbus, OpcUa, registry, Logger);

        Assert.Equal(1, registered);
        Assert.Equal(new[] { "cell-7" }, registry.RegisteredIds);
        Assert.True(registry.TryGetInstanceIdForMachine("CJ-OPCUA-01", out var instanceId));
        Assert.Equal("cell-7", instanceId);
    }

    /// <summary>🔴 <b>WITNESS for owner item 65, DIRECTION A — owner's ruling of 2026-08-25. This test is the
    /// INVERSION of the one that pinned the opposite answer for eleven months, and the old one's text is kept
    /// here verbatim because it is the record of what was bought.</b>
    ///
    /// <para><b>The test that stood here, word for word, including its name:</b>
    /// <c>TheEntrysOwnIdIsNotAdoptedAsTheInstanceId_SoItsPipelineSlotLabelAndAlarmTargetAreUnchanged</c> —
    /// <i>"A deliberate D-1 decision, pinned so it cannot drift silently: `id` in connectors.json is
    /// documented as naming-for-warnings only. Adopting it would move every such connector's pipeline slot
    /// label — and therefore the TargetId its degraded/down alarms are keyed on — for no gain this task
    /// needs. Promoting it is D-7's file-format work; until then this test is what says so."</i> — asserting
    /// <c>RegisteredIds == [DriverKinds.Modbus]</c> and <c>DoesNotContain("line3-weld")</c>.</para>
    ///
    /// <para><b>Every word of that was true, and the owner has now bought the thing it priced.</b> The gain
    /// it says does not exist is item 65's subject: one <c>connectors.json</c> answering differently on two
    /// hosts. This test asserts the new answer AND, in its last line, the cost — the instance id an install's
    /// alarms are keyed on is now the operator's own string. 🔴 It reddens by restoring the branch in
    /// <c>ConnectorsJsonRegistration.RegistrationKeyOf</c>, which is the control this pair was measured
    /// with.</para>
    ///
    /// <para>🔴 <b>What it does not measure:</b> it does not read a <c>SqliteAuditStore</c> row or a
    /// <c>WebhookNotification</c>. It asserts the id at the registry, which is the input
    /// <c>FleetCore.ResolveConnectorSlotLabel</c> and then <c>AlarmEvaluator</c> derive that
    /// <c>TargetId</c> from. Nothing here proves what a persisted history row from before this change
    /// contains — item 65 §65.4's point is precisely that it will not match, and no test in this repository
    /// can see a customer's audit database.</para></summary>
    [Fact]
    public void TheEntrysOwnIdIsNowAdoptedAsTheInstanceId_SoItsPipelineSlotLabelAndAlarmTargetMove_Item65DirectionA()
    {
        var registry = new ConnectorRegistry();

        ConnectorsJsonRegistration.RegisterAll(
            new[] { new ConnectorConfigEntry("line3-weld", DriverKinds.Modbus, ModbusSettings("CJ-ID-01")) },
            Modbus, OpcUa, registry, Logger);

        Assert.Equal(new[] { "line3-weld" }, registry.RegisteredIds);
        Assert.DoesNotContain(DriverKinds.Modbus, registry.RegisteredIds);
    }

    /// <summary>🔴 <b>The other half of owner item 65 direction A: the two hosts now give ONE answer, and
    /// this is the closest a test in this assembly can get to saying so.</b>
    ///
    /// <para>🔴 <b>What it does not measure, and the limit is structural rather than an oversight.</b>
    /// <c>St4i.EdgeService.EdgeConnectors.RegistrationKeyOf</c> is <c>internal</c> to an assembly this test
    /// project does not reference (<c>St4i.EngineApi.Tests</c> → <c>St4i.EngineApi</c> only), so this
    /// compares EngineApi's answer against a RESTATEMENT of EdgeService's body —
    /// <c>DriverKinds.Normalize(entry.Id.Trim())</c> — and not against the compiled method. The other side is
    /// pinned by <c>EdgeWorkerConnectorsTests.ADuplicateId_IsSkippedWithAWarningNamingTheIdThatCollided_NotTheKind</c>,
    /// which did NOT move for this ruling and is the control that makes this one mean something. If someone
    /// changes EdgeService's rule without changing this restatement, nothing here goes red.</para></summary>
    [Fact]
    public void TheRegistrationKey_IsNowTheEntrysOwnId_TheSameRuleStatedByTheOtherHost_Item65DirectionA()
    {
        ConnectorConfigEntry[] everyShape =
        [
            new(DriverKinds.Modbus, DriverKinds.Modbus, ModbusSettings("CJ-KEY-1")),   // id defaulted to the kind
            new("line3-weld", DriverKinds.Modbus, ModbusSettings("CJ-KEY-2")),          // TCP with an explicit id
            new("cell-7", DriverKinds.OpcUa, OpcUaSettings("CJ-KEY-3")),                // OPC-UA with an explicit id
            new("weld", "vendor.acme.weld", """{"x":1}"""),                             // a third-party kind
            new("rs485-line1", DriverKinds.Modbus, RtuBusSettings("gw", 4001, ("CJ-KEY-4", 1))), // an RTU bus
        ];

        foreach (var entry in everyShape)
        {
            Assert.Equal(DriverKinds.Normalize(entry.Id.Trim()), ConnectorsJsonRegistration.RegistrationKeyOf(entry));
        }

        // 🔴 THE ONE THAT MUST NOT MOVE, and it is why the precedence rule survives this change: an entry
        // whose `id` was DEFAULTED to its kind by ConnectorsConfig.Load still answers the KIND, because
        // normalising the kind returns the kind. So an install that never named its connectors keeps the key
        // ST4I_MODBUS_MAP precedence has always compared against, and keeps its slot label too.
        Assert.Equal(DriverKinds.Modbus, ConnectorsJsonRegistration.RegistrationKeyOf(
            new ConnectorConfigEntry(DriverKinds.Modbus, DriverKinds.Modbus, ModbusSettings("CJ-KEY-5"))));
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

        // 🔴 Re-pinned by owner item 65 direction A, 2026-08-25: this entry carries the explicit id
        // "broken", so it now registers under that rather than under DriverKinds.Modbus. The state this
        // test exists for — "registers but UNBOUND" — is unchanged, which is the point.
        Assert.Equal(1, registered);
        Assert.Equal(new[] { "broken" }, registry.RegisteredIds);
        Assert.False(registry.IsBoundToAMachine("broken"));
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
    // 🔴 THE TEST THAT STOOD HERE IS RETIRED BY OWNER ITEM 65 DIRECTION A, 2026-08-25, and its assertions
    // are kept VERBATIM in this comment rather than deleted, because it is the record of the rule that was
    // replaced. It was named
    // `TheRegistrationKey_IsTheKindForEveryPreD7aEntry_AndTheBusIdOnlyForAnRtuBus` and read:
    //
    //     // Pre-D-7a shapes — including one carrying an explicit id, which is precisely the case that must
    //     // NOT move (its pipeline slot label, and therefore its alarm TargetId, would fork).
    //     Assert.Equal(DriverKinds.Modbus, RegistrationKeyOf(new(DriverKinds.Modbus, DriverKinds.Modbus, …)));
    //     Assert.Equal(DriverKinds.Modbus, RegistrationKeyOf(new("line3-weld",      DriverKinds.Modbus, …)));
    //     Assert.Equal(DriverKinds.OpcUa,  RegistrationKeyOf(new("cell-7",          DriverKinds.OpcUa,  …)));
    //     Assert.Equal("vendor.acme.weld", RegistrationKeyOf(new("weld", "vendor.acme.weld", …)));
    //     // 🔴 …and only a Modbus entry that DECLARES A TRANSPORT answers with its own id.
    //     Assert.Equal("rs485-line1",      RegistrationKeyOf(new("rs485-line1",     DriverKinds.Modbus, RtuBus…)));
    //
    // The case it calls out as "must NOT move" is exactly the case the owner moved. Its replacement is
    // TheRegistrationKey_IsNowTheEntrysOwnId_TheSameRuleStatedByTheOtherHost_Item65DirectionA above, which
    // covers all five shapes and additionally pins the one that genuinely does not move — the entry whose id
    // was defaulted to its kind, which is what keeps the ST4I_MODBUS_MAP precedence rule intact.

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
    /// 🔴 <b>What a partial failure does, at the BUS level.</b> A bus whose settings will not parse disables
    /// that whole bus and nothing else. Every other connector in the file, including a second RTU bus, still
    /// registers. Stated in <see cref="ModbusRtuBusSettings"/>'s own doc comment as one of three levels; this
    /// is the middle one.
    ///
    /// <para>🔴 <b>Task D-7c changed the unparseable specimen, and the reason is worth recording.</b> D-7a used
    /// <c>{"transport":"rtu-serial", …}</c> here, because the serial transport was refused by this build. It
    /// ships now, so that document parses — the test would have kept passing (an empty <c>devices</c> array
    /// still fails the fan-out) while silently testing a completely different level of the three. The specimen
    /// is now a serial bus with a GATEWAY field on it, which is a genuine bus-SETTINGS refusal.</para>
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
                    SerialBusSettings(""" "portName":"COM3","port":4001, """, ("CJ-SERIAL", 1))),
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

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 Task D-7c — the SERIAL arm. THE deliverable of Đợt D: a directly-attached RS-485 bus, declared in a
    // configuration file, reachable from a host that ships.
    // ─────────────────────────────────────────────────────────────────────

    private static string SerialBusSettings(string busFields, params (string MachineCode, int UnitId)[] devices) =>
        $$"""
        {
          "transport": "rtu-serial",{{busFields}}
          "devices": [ {{string.Join(",", devices.Select(d => $$"""
            {"machineCode":"{{d.MachineCode}}","unitId":{{d.UnitId}},"pollIntervalMs":1000,"readTimeoutMs":300,
             "registers":[{"address":0,"type":"Holding","dataType":"UInt16","scale":1.0,"metric":"speed","unit":"rpm"}]}
            """))}} ]
        }
        """;

    /// <summary>
    /// 🔴 <b>THE deliverable of D-7c, in one test: a <c>connectors.json</c> entry naming a COM port produces N
    /// registered instances on ONE serial bus, each bound to its own machine code.</b>
    ///
    /// <para>Nothing in this product could open a directly-attached COM port before this task. D-3 built the
    /// link and D-7a made an RTU bus declarable — but only over a TCP gateway. This is the entry that reaches
    /// the wire.</para>
    ///
    /// <para><b>The literal bus key is the load-bearing assertion.</b> Comparing against
    /// <c>SerialPortBusLink.CreateBusKey(new SerialLineSettings("COM7"))</c> would pass for a switch that read
    /// no serial settings at all, because both sides would come from the same constructor defaults. The literal
    /// is the value that reached the boundary: it fails if the transport switch picked the gateway parser
    /// (a completely different key shape), if any line parameter was dropped, or if the document's defaults
    /// were taken from <see cref="System.IO.Ports.SerialPort"/> (9600-8-N-1) instead of the MODBUS
    /// specification's (19200-8-E-1).</para>
    /// </summary>
    [Fact]
    public async Task ASerialRtuBusEntry_FansOutToNInstances_AllSharingOneSerialBusBuiltFromItsLineParameters()
    {
        var registry = new ConnectorRegistry();
        await using var buses = new ModbusBusRegistry();

        var registered = ConnectorsJsonRegistration.RegisterAll(
            new[]
            {
                new ConnectorConfigEntry(
                    "rs485-line1", DriverKinds.Modbus,
                    SerialBusSettings(""" "portName":"com7", """, ("CJ-SER-A", 1), ("CJ-SER-B", 2), ("CJ-SER-C", 3))),
            },
            Modbus, OpcUa, registry, Logger, buses);

        Assert.Equal(3, registered);
        Assert.Equal(3, registry.RegisteredIds.Count);

        foreach (var (code, unit) in new[] { ("CJ-SER-A", 1), ("CJ-SER-B", 2), ("CJ-SER-C", 3) })
        {
            Assert.True(registry.TryGetInstanceIdForMachine(code, out var instanceId), $"{code} should be claimed");
            Assert.Equal(ModbusMultidropMap.DeviceInstanceId("rs485-line1", (byte)unit), instanceId);
            Assert.Equal(DriverKinds.Modbus, registry.KindOf(instanceId));
        }

        var drivers = new List<IDeviceDriver>();
        foreach (var id in registry.RegisteredIds)
        {
            Assert.True(registry.TryCreateDriver(id, out var driver, out var error), error);
            drivers.Add(driver!);
        }

        // 🔴 ONE serial bus, three leases — the "one open for N leases" arithmetic, on the SERIAL key, from a
        // document that named nothing but its port. This is the assertion that would go red for every
        // interesting way the transport switch could be wrong.
        Assert.Equal(3, buses.LeaseCount(SerialBusKey));
        Assert.True(buses.HasBus(SerialBusKey));

        // …and it is the key those three drivers actually hold, read off the drivers rather than off the
        // registry's bookkeeping: ModbusRtuDriver.Id is "modbus-rtu:{busKey}:unit{n}:{machine}".
        foreach (var driver in drivers)
        {
            Assert.StartsWith($"modbus-rtu:{SerialBusKey}:", driver.Id, StringComparison.Ordinal);
        }

        // 🔴 Each driver serves exactly ONE machine — blueprint §7.1's invariant, and the reason
        // AmbiguousDriver stays unreachable: SetpointWriteRequest carries no machine code, so a driver that
        // emitted N of them could not resolve a write. Checked by enumerating the drivers' own ids.
        Assert.Equal(3, drivers.Select(d => d.Id).Distinct().Count());
        foreach (var code in new[] { "CJ-SER-A", "CJ-SER-B", "CJ-SER-C" })
        {
            Assert.Single(drivers, d => d.Id.EndsWith(":" + code, StringComparison.Ordinal));
        }

        // 🔴 The routing proof D-7a met, on the serial transport: the instance that serves B is NOT the one
        // that serves A, and the registry resolves each machine to its own instance — so a write for B can
        // never be handed to A's driver.
        Assert.True(registry.TryGetInstanceIdForMachine("CJ-SER-A", out var aId));
        Assert.True(registry.TryGetInstanceIdForMachine("CJ-SER-B", out var bId));
        Assert.NotEqual(aId, bId);

        foreach (var driver in drivers) await driver.DisposeAsync();
    }

    /// <summary>The literal key a bus naming only <c>com7</c> must produce — MODBUS's 19200-8-E-1 defaults,
    /// upper-cased port. Stated once, beside the tests that depend on it, so the two of them cannot drift
    /// apart while both stay green.</summary>
    private const string SerialBusKey = "modbus-rtu-serial:COM7:19200:8:E:1";

    /// <summary>
    /// 🔴 <b>One open for N leases, and the LAST release disposes — through the SERIAL opener.</b>
    ///
    /// <para><b>What this proves and what it does not.</b> It proves the reference-count arithmetic
    /// <b>end-to-end from a configuration file</b>: three devices on one declared line take three leases on ONE
    /// <c>ModbusBus</c>, two releases leave it alive, and the third disposes it. That is this test's job — the
    /// path from `connectors.json` to the shared bus — and it is why it lives here.</para>
    ///
    /// <para>🔴 <b>Fix round 1, review I-3 — what it does NOT do is OBSERVE the port, and D-7c's report wrongly
    /// claimed no observation was available.</b> Both assertions here read <c>ModbusBusRegistry</c>'s own
    /// bookkeeping (<c>LeaseCount</c>, and <c>HasBus</c> for the final check — <b>the same witness one field
    /// over</b>), while the thing the mechanism protects is a COM port not held open to process exit. §8.1
    /// principle 5's rule is to measure the consequence on the thing protected, and it IS measurable with no
    /// hardware: <c>St4i.EdgeCore.Tests.…SerialPortBusLinkTests.OneOpenForNLeases_ObservedThroughTheSerialLink_AndTheLastReleaseClosesThePort</c>
    /// counts the openings, pins <c>ModbusBus.LinkGeneration</c>, and asserts the port handle's own
    /// <c>IsOpen</c> after each release. It lives there because <c>SerialPortBusLink.AdoptHandle</c> is
    /// <c>internal</c> behind D-3's <c>InternalsVisibleTo("St4i.EdgeCore.Tests")</c>.</para>
    ///
    /// <para>Still true, and still worth stating: <b>no <c>System.IO.Ports.SerialPort</c> is ever opened
    /// successfully anywhere in these suites.</b> The only thing exercised on the PHYSICAL opener is the failure
    /// path — <see cref="ASerialBusWhoseAdapterIsNotThere_DegradesAndTellsTheOperatorWhichPort"/>.</para>
    /// </summary>
    [Fact]
    public async Task OneOpenForNLeases_AndTheLastReleaseDisposes_ThroughTheSerialOpener()
    {
        var registry = new ConnectorRegistry();
        await using var buses = new ModbusBusRegistry();

        ConnectorsJsonRegistration.RegisterAll(
            new[]
            {
                new ConnectorConfigEntry(
                    "rs485-line1", DriverKinds.Modbus,
                    SerialBusSettings(""" "portName":"COM7", """, ("CJ-LEASE-A", 1), ("CJ-LEASE-B", 2), ("CJ-LEASE-C", 3))),
            },
            Modbus, OpcUa, registry, Logger, buses);

        var drivers = new List<IDeviceDriver>();
        foreach (var id in registry.RegisteredIds)
        {
            Assert.True(registry.TryCreateDriver(id, out var driver, out var error), error);
            drivers.Add(driver!);
        }

        Assert.Equal(3, buses.LeaseCount(SerialBusKey));

        await drivers[0].DisposeAsync();
        Assert.Equal(2, buses.LeaseCount(SerialBusKey));
        Assert.True(buses.HasBus(SerialBusKey), "two devices are still on this line — the port must stay open");

        await drivers[1].DisposeAsync();
        Assert.Equal(1, buses.LeaseCount(SerialBusKey));
        Assert.True(buses.HasBus(SerialBusKey));

        await drivers[2].DisposeAsync();
        Assert.Equal(0, buses.LeaseCount(SerialBusKey));
        // 🔴 HasBus, not LeaseCount — LeaseCount answers 0 for a key with no bus at all, so it cannot tell
        // "the last release disposed it" from "it was never created". ModbusBusRegistry's own doc comment makes
        // exactly that distinction, and on serial the difference is a COM port left open until process exit.
        Assert.False(buses.HasBus(SerialBusKey), "the last release must dispose the bus, and with it the port");
    }

    /// <summary>
    /// 🔴 <b>A serial bus and a gateway bus in ONE file are two buses on two transports</b> — the switch is
    /// per-entry, not per-process, and neither arm disturbs the other. The two keys are asserted literally
    /// because that is the only thing that would catch a switch which took the right branch and then built the
    /// wrong key.
    /// </summary>
    [Fact]
    public async Task ASerialBusAndAGatewayBusInOneFile_AreTwoBusesOnTwoTransports()
    {
        var registry = new ConnectorRegistry();
        await using var buses = new ModbusBusRegistry();

        var entries = new[]
        {
            new ConnectorConfigEntry("rs485-line1", DriverKinds.Modbus,
                SerialBusSettings(""" "portName":"COM7", """, ("CJ-MIX-SER", 1))),
            new ConnectorConfigEntry("gw-line", DriverKinds.Modbus,
                RtuBusSettings("gw.example", 4001, ("CJ-MIX-GW", 1))),
        };

        var resolved = ConnectorsConfig.ResolveEntries(
            entries, new HashSet<string>(StringComparer.Ordinal),
            registrationKeyOf: ConnectorsJsonRegistration.RegistrationKeyOf);
        Assert.Equal(2, resolved.Count);

        Assert.Equal(2, ConnectorsJsonRegistration.RegisterAll(resolved, Modbus, OpcUa, registry, Logger, buses));

        Assert.True(registry.TryGetInstanceIdForMachine("CJ-MIX-SER", out var serialId));
        Assert.True(registry.TryGetInstanceIdForMachine("CJ-MIX-GW", out var gatewayId));
        Assert.True(registry.TryCreateDriver(serialId, out var serialDriver, out var e1), e1);
        Assert.True(registry.TryCreateDriver(gatewayId, out var gatewayDriver, out var e2), e2);

        Assert.Equal(1, buses.LeaseCount(SerialBusKey));
        Assert.Equal(1, buses.LeaseCount(GatewayTcpBusLink.CreateBusKey("gw.example", 4001)));

        await serialDriver!.DisposeAsync();
        await gatewayDriver!.DisposeAsync();
    }

    /// <summary>
    /// 🔴 <b>Two serial buses naming ONE port with different framing are two buses, from configuration.</b>
    /// That is <c>SerialPortBusLink.CreateBusKey</c>'s rule (every line parameter is in the key) carried all
    /// the way up to a file an operator writes — and it is the misconfiguration whose runtime symptom is the
    /// held-port message, because the second bus tries to open a port the first one already has.
    ///
    /// <para>This is the case that made the held-port message name TWO holders instead of one: an operator
    /// told to go find "another application" would hunt a process that does not exist, while the answer is in
    /// the file in front of them.</para>
    /// </summary>
    [Fact]
    public async Task TwoSerialBusesNamingOnePortWithDifferentFraming_AreTwoBuses_NotOneSharedLine()
    {
        var registry = new ConnectorRegistry();
        await using var buses = new ModbusBusRegistry();

        var entries = new[]
        {
            new ConnectorConfigEntry("line-fast", DriverKinds.Modbus,
                SerialBusSettings(""" "portName":"COM7", """, ("CJ-FRAME-A", 1))),
            new ConnectorConfigEntry("line-slow", DriverKinds.Modbus,
                SerialBusSettings(""" "portName":"COM7","baudRate":9600,"parity":"none","stopBits":2, """,
                    ("CJ-FRAME-B", 1))),
        };

        Assert.Equal(2, ConnectorsJsonRegistration.RegisterAll(entries, Modbus, OpcUa, registry, Logger, buses));

        Assert.True(registry.TryGetInstanceIdForMachine("CJ-FRAME-A", out var aId));
        Assert.True(registry.TryGetInstanceIdForMachine("CJ-FRAME-B", out var bId));
        Assert.True(registry.TryCreateDriver(aId, out var a, out _));
        Assert.True(registry.TryCreateDriver(bId, out var b, out _));

        Assert.Equal(1, buses.LeaseCount(SerialBusKey));
        Assert.Equal(1, buses.LeaseCount("modbus-rtu-serial:COM7:9600:8:N:2"));

        await a!.DisposeAsync();
        await b!.DisposeAsync();
    }

    /// <summary>
    /// 🔴 <b>The DECISION about a port that is not on this machine, asserted end to end through the production
    /// path: it is a START-UP issue, not a parse-time refusal.</b>
    ///
    /// <para>The bus registers, its devices register, its drivers build — and the failure arrives at the first
    /// POLL, as a degraded driver and a log line naming the port. That is what lets one <c>connectors.json</c>
    /// be deployed to a site whose adapter is not plugged in yet and recover when it is, with no restart.</para>
    ///
    /// <para><b>Why this test is also the proof that the SERIAL opener is what the factory got.</b> Everything
    /// else in this section observes the bus KEY, which a switch could conceivably compute correctly while
    /// handing over the wrong opener — key and opener are two arguments. Driving one real poll is what makes
    /// the opener itself run: the message an operator reads comes out of <c>SerialPortBusLink.OpenAsync</c>,
    /// through <c>ModbusBus</c>, through <c>ModbusRtuDriver</c>'s poll catch, to the <c>ILogger</c> the
    /// composition root wired — no observer that the mechanism does not itself need, which is blueprint
    /// §8.1's fifth principle applied to the wiring rather than to the arithmetic.</para>
    ///
    /// <para>The port name is DERIVED from this machine rather than hardcoded, for the same reason
    /// <c>SerialPortBusLinkTests.AbsentPortName</c> derives it: a hardcoded "COM99" is a guess about someone
    /// else's machine, and a wrong guess opens a stranger's device.</para>
    /// </summary>
    [Fact]
    public async Task ASerialBusWhoseAdapterIsNotThere_DegradesAndTellsTheOperatorWhichPort()
    {
        var absent = AbsentPortName();
        var registry = new ConnectorRegistry();
        await using var buses = new ModbusBusRegistry();
        var logger = new CapturingLogger();

        Assert.Equal(1, ConnectorsJsonRegistration.RegisterAll(
            new[]
            {
                new ConnectorConfigEntry("rs485-absent", DriverKinds.Modbus,
                    SerialBusSettings($$""" "portName":"{{absent}}", """, ("CJ-ABSENT", 1))),
            },
            Modbus, OpcUa, registry, logger, buses));

        Assert.True(registry.TryGetInstanceIdForMachine("CJ-ABSENT", out var instanceId));
        Assert.True(registry.TryCreateDriver(instanceId, out var driver, out var error), error);

        // One poll. The enumerator yields nothing (the poll fails), so the read is bounded by the driver's own
        // failure rather than by a timeout here: MoveNextAsync returns only after the failed attempt has been
        // logged and the backoff delay has been entered, which the cancellation below ends.
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        await using (var reading = driver!.ReadAsync(cts.Token).GetAsyncEnumerator(cts.Token))
        {
            var pumped = Task.Run(async () => { try { await reading.MoveNextAsync(); } catch (OperationCanceledException) { } });

            // 🔴 Waited on the FAILED-POLL line specifically, not merely on "a message naming the port". The
            // first draft waited on the port name and passed instantly — off the §9 hardware-limit notice
            // logged at REGISTRATION, which also names the port — so the assertions below ran before the poll
            // had happened at all and read Health as its initial Down. A wait whose condition is satisfied by
            // an earlier, unrelated message is a wait that measures nothing.
            await WaitUntilAsync(
                () => logger.Messages.Any(m => m.Contains("Modbus RTU poll failed", StringComparison.Ordinal)),
                cts.Token);
            await cts.CancelAsync();
            await pumped;
        }

        Assert.Equal(DriverHealthState.Degraded, driver.Health);

        // 🔴 What the operator reads. The failed-poll line names the machine, the unit and the BUS — and the
        // bus key on this transport is the line itself, so the log says which COM port and which framing.
        var failedPoll = Assert.Single(
            logger.Messages, m => m.Contains("Modbus RTU poll failed", StringComparison.Ordinal));
        Assert.Contains("CJ-ABSENT", failedPoll, StringComparison.Ordinal);
        Assert.Contains($"modbus-rtu-serial:{absent}:19200:8:E:1", failedPoll, StringComparison.Ordinal);

        // 🔴 …and the CAUSE, discriminated. The exception carried alongside is the serial link's own, and it
        // says the port is not present rather than offering three possibilities. Asserted on the exception the
        // logger received, because that is what an operator's log actually renders.
        var openFailure = Assert.Single(
            logger.Exceptions, e => e is not null && e.Message.Contains("NOT PRESENT", StringComparison.Ordinal));
        Assert.Contains(absent, openFailure!.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("already held", openFailure.Message, StringComparison.Ordinal);

        await driver.DisposeAsync();
    }

    /// <summary>
    /// 🔴 <b>Blueprint §9's hardware limit is said WHERE AN OPERATOR CONFIGURING A PORT WILL SEE IT</b> — once
    /// per serial bus, at startup, in the same log they are already watching for their connector to come up.
    ///
    /// <para>A limit that lives only in a plan document is a limit the customer finds on a bench, and this one
    /// fails SILENTLY: a manual-DE adapter does not throw, it simply never transmits, which is
    /// indistinguishable at every layer above from a wiring fault or a wrong unit id.</para>
    ///
    /// <para>The three negative halves are the discriminating ones: it must NOT fire for a gateway bus (whose
    /// line is the device server's problem, not ours), must NOT fire for a serial bus that registered nothing
    /// (a hardware caveat about a line that will never be driven is noise on top of an error), and must fire
    /// exactly ONCE for a bus of three devices, because the limit is a property of the SEGMENT.</para>
    /// </summary>
    [Fact]
    public async Task TheAutoDirectionControlLimit_IsLoggedOncePerSerialBus_AndNeverForAGatewayOrADeadBus()
    {
        var registry = new ConnectorRegistry();
        await using var buses = new ModbusBusRegistry();
        var logger = new CapturingLogger();

        ConnectorsJsonRegistration.RegisterAll(
            new[]
            {
                new ConnectorConfigEntry("rs485-line1", DriverKinds.Modbus,
                    SerialBusSettings(""" "portName":"COM7", """, ("CJ-LIM-A", 1), ("CJ-LIM-B", 2), ("CJ-LIM-C", 3))),
                new ConnectorConfigEntry("gw-line", DriverKinds.Modbus,
                    RtuBusSettings("gw.example", 4001, ("CJ-LIM-GW", 1))),
                // A serial bus that registers NOTHING: its one device claims a machine the first bus already
                // has, so the fan-out registers 0 and no line is ever driven.
                new ConnectorConfigEntry("rs485-doomed", DriverKinds.Modbus,
                    SerialBusSettings(""" "portName":"COM9", """, ("CJ-LIM-A", 1))),
            },
            Modbus, OpcUa, registry, logger, buses);

        var notices = logger.Messages
            .Where(m => m.Contains("AUTOMATIC direction control", StringComparison.Ordinal)).ToList();

        var only = Assert.Single(notices);
        Assert.Contains("COM7 19200-8-E-1", only, StringComparison.Ordinal);
        Assert.Contains("rs485-line1", only, StringComparison.Ordinal);
        Assert.DoesNotContain("COM9", only, StringComparison.Ordinal);
        Assert.DoesNotContain("gw.example", only, StringComparison.Ordinal);
    }

    /// <summary>
    /// 🔴 <b>Task F-1 — the ONE-HOST-PER-SEGMENT deployment constraint, said where an operator configuring a
    /// GATEWAY will see it. The exact mirror of the test above, and the mirroring is the argument.</b>
    ///
    /// <para>E-5 gave the serial transport its statement of this rule — <c>DescribeOpenFailure</c>'s held-port
    /// arm, which names the sibling host first — and left the gateway transport with nothing, because on a
    /// gateway there is no failure to hang a message on: two hosts dial the same device server and BOTH
    /// connections succeed. Registration is therefore the only moment at which this can be said, which is why
    /// it lands beside the hardware limit rather than beside an exception.</para>
    ///
    /// <para>The three negative halves are the discriminating ones, and they are the reverse of the DE limit's:
    /// it must NOT fire for a SERIAL bus (whose operator meets the rule at the OS's refusal instead), must NOT
    /// fire for a gateway bus that registered nothing, and must fire exactly ONCE for a bus of three devices,
    /// because a segment is not a device.</para>
    /// </summary>
    [Fact]
    public async Task TheOneHostPerSegmentConstraint_IsLoggedOncePerGatewayBus_AndNeverForASerialOrADeadBus()
    {
        var registry = new ConnectorRegistry();
        await using var buses = new ModbusBusRegistry();
        var logger = new CapturingLogger();

        ConnectorsJsonRegistration.RegisterAll(
            new[]
            {
                new ConnectorConfigEntry("gw-line1", DriverKinds.Modbus,
                    RtuBusSettings("gw.example", 4001, ("CJ-SEG-A", 1), ("CJ-SEG-B", 2), ("CJ-SEG-C", 3))),
                new ConnectorConfigEntry("rs485-line1", DriverKinds.Modbus,
                    SerialBusSettings(""" "portName":"COM7", """, ("CJ-SEG-SER", 1))),
                // A gateway bus that registers NOTHING: its one device claims a machine the first bus already
                // has, so the fan-out registers 0 and this host never puts a frame on that segment.
                new ConnectorConfigEntry("gw-doomed", DriverKinds.Modbus,
                    RtuBusSettings("other-gw.example", 4002, ("CJ-SEG-A", 1))),
            },
            Modbus, OpcUa, registry, logger, buses);

        var notices = logger.Messages
            .Where(m => m.Contains("ONE HOST PER SEGMENT", StringComparison.Ordinal)).ToList();

        var only = Assert.Single(notices);
        Assert.Contains("gw.example:4001", only, StringComparison.Ordinal);
        Assert.Contains("gw-line1", only, StringComparison.Ordinal);
        Assert.DoesNotContain("other-gw.example", only, StringComparison.Ordinal);
        Assert.DoesNotContain("COM7", only, StringComparison.Ordinal);

        // 🔴 And the load-bearing half of the wording, asserted here rather than only at the string's own
        // unit test: what reaches this log must say that nothing enforces the rule. A notice an operator
        // reads as "the product handles this" is worse than no notice, because it stops them checking the
        // one thing that actually decides it.
        Assert.Contains("NOTHING enforces it", only, StringComparison.Ordinal);
        Assert.Contains("NOBODY HAS MEASURED", only, StringComparison.Ordinal);
    }

    /// <summary>
    /// 🔴 <b>The half of the "all three hosts" ruling that <c>SerialDependencyScopingTests</c> cannot make: the
    /// ENGINE's own IL references the serial assembly.</b>
    ///
    /// <para>That distinguishes "this deployment carries <c>System.IO.Ports.dll</c>" — true of all three hosts,
    /// and true of any project that merely inherits a copied package asset — from "this host can open a COM
    /// port", which needs its own code to name the types. The C# compiler emits an <c>AssemblyRef</c> only for
    /// an assembly whose types a project's IL actually uses, which is the same instrument
    /// <c>SerialDependencyScopingTests.TheRtuFramingLayersOwnAssembly_…</c> uses in the opposite direction.
    /// It lives here rather than there because <c>St4i.EdgeCore.Tests</c> does not reference
    /// <c>St4i.EngineApi</c> and therefore cannot load it.</para>
    ///
    /// <para>🔴 <b>And it is deliberately asserted for the ENGINE ONLY.</b> Measured: <c>St4i.EdgeService</c>
    /// and <c>St4iMachineSimulator</c> reference <c>St4i.EdgeCore.Serial</c> and ship the DLL on the owner's
    /// ruling, but neither has a <c>ConnectorRegistry</c>, an <c>IConnectorFactory</c> or a
    /// <c>connectors.json</c> reader — those are <c>St4i.EngineApi</c> types, and <b>neither host csproj even
    /// references <c>St4i.EngineApi</c></b>, so those names are not merely unused there, they are not
    /// reachable. Neither host has IL that could reference the serial assembly, and asserting that it does
    /// would be asserting something false.</para>
    ///
    /// <para>🔴 <b>Fix round 1, review M-1 — THE OBLIGATION, stated at this end too.</b> This test is what makes
    /// <c>St4i.EdgeCore.Tests.…SerialDependencyScopingTests.EngineApiDeployment_CarriesSystemIoPorts_BecauseItCanOpenAComPortDirectly</c>
    /// deserve the second half of its name. Measured by the reviewer: delete the serial arm from
    /// <see cref="ConnectorsJsonRegistration"/> and keep the ProjectReference, and all seven of that class's
    /// tests stay green while THIS one goes red. <b>The two move together</b> — renaming, weakening or deleting
    /// either without the other leaves a test name asserting a capability that nothing checks.</para>
    /// </summary>
    [Fact]
    public void TheEngineApisOwnIl_ReferencesTheSerialAssembly_WhichIsWhatMakesAComPortReachableAtAll()
    {
        var referenced = typeof(ConnectorsJsonRegistration).Assembly
            .GetReferencedAssemblies()
            .Select(a => a.Name)
            .ToList();

        Assert.Contains("St4i.EdgeCore.Serial", referenced);

        // The positive control for the instrument: this host's IL obviously references St4i.EdgeCore, so
        // "contains St4i.EdgeCore.Serial" is a fact about the reference rather than about
        // GetReferencedAssemblies returning something unexpected.
        Assert.Contains("St4i.EdgeCore", referenced);
    }

    /// <summary>A COM name genuinely absent from this machine — derived, never hardcoded, the same reflex as
    /// <c>SerialPortBusLinkTests.AbsentPortName</c>: a hardcoded "COM99" is a guess about someone else's
    /// machine, and a wrong guess opens a stranger's device. Duplicated rather than shared because the two test
    /// assemblies have no common project; the derivation is four lines and the alternative is a new shared
    /// file for one helper.</summary>
    private static string AbsentPortName()
    {
        var present = new HashSet<string>(SerialPort.GetPortNames(), StringComparer.OrdinalIgnoreCase);
        for (var i = 90; i <= 250; i++)
        {
            if (!present.Contains($"COM{i}")) return $"COM{i}";
        }

        throw new InvalidOperationException(
            "COM90..COM250 are all present on this machine, which cannot be right — refusing to guess.");
    }

    private static async Task WaitUntilAsync(Func<bool> condition, CancellationToken ct)
    {
        while (!condition())
        {
            ct.ThrowIfCancellationRequested();
            await Task.Delay(10, ct);
        }
    }

    /// <summary>Collects both the formatted message and the exception, because on this path the two carry
    /// different halves of what an operator reads: the message says WHICH device and WHICH bus, the exception
    /// says WHY the port would not open.</summary>
    private sealed class CapturingLogger : ILogger
    {
        private readonly List<string> _messages = new();
        private readonly List<Exception?> _exceptions = new();

        public IReadOnlyList<string> Messages { get { lock (_messages) { return _messages.ToList(); } } }

        public IReadOnlyList<Exception?> Exceptions { get { lock (_messages) { return _exceptions.ToList(); } } }

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            lock (_messages)
            {
                _messages.Add(formatter(state, exception));
                _exceptions.Add(exception);
            }
        }
    }
}
