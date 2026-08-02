using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
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
}
