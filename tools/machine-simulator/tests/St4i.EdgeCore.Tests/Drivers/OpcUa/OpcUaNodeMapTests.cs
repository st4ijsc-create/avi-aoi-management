using System.Globalization;
using System.Text.Json;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Drivers.OpcUa;
using Xunit;

namespace St4i.EdgeCore.Tests.Drivers.OpcUa;

/// <summary>
/// GĐ3 sub-3 OU-1 — TDD-first coverage for <see cref="OpcUaNodeMap.FromJson"/>, mirroring
/// <c>ModbusRegisterMapTests</c>'s shape exactly (same case-insensitive-JSON / blank-required-field /
/// empty-list-rejection contract). The REAL end-to-end proof through the driver's own code path (a genuine
/// OPC-UA session round-trip) is <c>OpcUaDriverLoopbackTests</c>.
/// </summary>
public class OpcUaNodeMapTests
{
    private const string SampleJson = """
    { "machineCode": "PLC-OPCUA-01", "endpointUrl": "opc.tcp://localhost:4840", "pollIntervalMs": 500,
      "nodes": [
        { "nodeId": "ns=2;s=Temperature", "metric": "temperature", "unit": "C" },
        { "nodeId": "ns=2;s=Status",      "metric": "status" } ] }
    """;

    [Fact]
    public void FromJson_ParsesMachineCodeEndpointPollIntervalAndNodes()
    {
        var map = OpcUaNodeMap.FromJson(SampleJson);

        Assert.Equal("PLC-OPCUA-01", map.MachineCode);
        Assert.Equal("opc.tcp://localhost:4840", map.EndpointUrl);
        Assert.Equal(500, map.PollIntervalMs);
        Assert.Equal(OpcUaSecurityMode.None, map.SecurityMode);
        Assert.Null(map.Username);
        Assert.Null(map.Password);
        Assert.Equal(2, map.Nodes.Count);

        var temperature = map.Nodes[0];
        Assert.Equal("ns=2;s=Temperature", temperature.NodeId);
        Assert.Equal("temperature", temperature.Metric);
        Assert.Equal("C", temperature.Unit);

        var status = map.Nodes[1];
        Assert.Equal("ns=2;s=Status", status.NodeId);
        Assert.Equal("status", status.Metric);
        Assert.Null(status.Unit);
    }

    [Fact]
    public void FromJson_DefaultsPollIntervalMsAndSecurityMode_WhenOmitted()
    {
        const string json = """
        { "machineCode": "PLC-DEFAULTS", "endpointUrl": "opc.tcp://localhost:4840",
          "nodes": [ { "nodeId": "ns=2;s=Rpm", "metric": "rpm" } ] }
        """;

        var map = OpcUaNodeMap.FromJson(json);

        Assert.Equal(1000, map.PollIntervalMs);
        Assert.Equal(OpcUaSecurityMode.None, map.SecurityMode);
        Assert.Single(map.Nodes);
    }

    [Fact]
    public void FromJson_ParsesUsernamePasswordAuth()
    {
        const string json = """
        { "machineCode": "PLC-AUTH", "endpointUrl": "opc.tcp://localhost:4840",
          "username": "operator", "password": "s3cret",
          "nodes": [ { "nodeId": "ns=2;s=Rpm", "metric": "rpm" } ] }
        """;

        var map = OpcUaNodeMap.FromJson(json);

        Assert.Equal("operator", map.Username);
        Assert.Equal("s3cret", map.Password);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void FromJson_Throws_WhenMachineCodeBlank(string blankCode)
    {
        var json = $$"""
        { "machineCode": "{{blankCode}}", "endpointUrl": "opc.tcp://localhost:4840",
          "nodes": [ { "nodeId": "ns=2;s=Rpm", "metric": "rpm" } ] }
        """;

        Assert.Throws<InvalidOperationException>(() => OpcUaNodeMap.FromJson(json));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void FromJson_Throws_WhenEndpointUrlBlank(string blankEndpoint)
    {
        var json = $$"""
        { "machineCode": "PLC-01", "endpointUrl": "{{blankEndpoint}}",
          "nodes": [ { "nodeId": "ns=2;s=Rpm", "metric": "rpm" } ] }
        """;

        Assert.Throws<InvalidOperationException>(() => OpcUaNodeMap.FromJson(json));
    }

    [Fact]
    public void FromJson_Throws_WhenNodesEmpty()
    {
        const string json = """
        { "machineCode": "PLC-EMPTY", "endpointUrl": "opc.tcp://localhost:4840", "nodes": [] }
        """;

        Assert.Throws<InvalidOperationException>(() => OpcUaNodeMap.FromJson(json));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Task B-3 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-3-brief.md) — writable
    // setpoints: mandatory limits enforced at parse time, numeric value type only.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Writable_DeclaredWithValueTypeAndMinMax_Parses_AppearsInWritablePointNames()
    {
        const string json = """
        { "machineCode": "PLC-WRITE", "endpointUrl": "opc.tcp://localhost:4840",
          "nodes": [ { "nodeId": "ns=2;s=Speed", "metric": "speed",
            "writable": { "valueType": "UInt16", "min": 0, "max": 5000 } } ] }
        """;

        var map = OpcUaNodeMap.FromJson(json);

        var node = Assert.Single(map.Nodes);
        Assert.NotNull(node.Writable);
        Assert.Equal(CommandArgumentType.UInt16, node.Writable!.ValueType);
        Assert.Equal(0, node.Writable.Min);
        Assert.Equal(5000, node.Writable.Max);
        Assert.Equal(new[] { "speed" }, map.WritablePointNames);
    }

    [Fact]
    public void NonWritableNode_WritableIsNull_NotInWritablePointNames_ByteIdenticalToBeforeThisTask()
    {
        var map = OpcUaNodeMap.FromJson(SampleJson);

        Assert.All(map.Nodes, n => Assert.Null(n.Writable));
        Assert.Empty(map.WritablePointNames);
        Assert.Empty(map.Commands);
        Assert.Empty(map.CommandNames);
    }

    [Fact]
    public void Writable_MissingMinAndMax_RejectedAtParseTime_MessageNamesThePoint()
    {
        const string json = """
        { "machineCode": "PLC-NOLIMIT", "endpointUrl": "opc.tcp://localhost:4840",
          "nodes": [ { "nodeId": "ns=2;s=Speed", "metric": "speed", "writable": { "valueType": "UInt16" } } ] }
        """;

        var ex = Assert.Throws<InvalidOperationException>(() => OpcUaNodeMap.FromJson(json));
        Assert.Contains("speed", ex.Message);
        Assert.Contains("min", ex.Message);
    }

    [Fact]
    public void Writable_MinGreaterThanMax_Rejected()
    {
        const string json = """
        { "machineCode": "PLC-BADRANGE", "endpointUrl": "opc.tcp://localhost:4840",
          "nodes": [ { "nodeId": "ns=2;s=Speed", "metric": "speed",
            "writable": { "valueType": "UInt16", "min": 5000, "max": 0 } } ] }
        """;

        var ex = Assert.Throws<InvalidOperationException>(() => OpcUaNodeMap.FromJson(json));
        Assert.Contains("speed", ex.Message);
        Assert.Contains("greater than", ex.Message);
    }

    /// <summary>String remains rejected (unchanged) — see <see cref="OpcUaWritableSetpoint"/>'s own "Fix
    /// round 1" remarks for why Bool moved to the ACCEPTED list below while String did not.</summary>
    [Fact]
    public void Writable_StringValueType_Rejected()
    {
        const string json = """
        { "machineCode": "PLC-BADTYPE", "endpointUrl": "opc.tcp://localhost:4840",
          "nodes": [ { "nodeId": "ns=2;s=Recipe", "metric": "recipe",
            "writable": { "valueType": "String", "min": 0, "max": 1 } } ] }
        """;

        var ex = Assert.Throws<InvalidOperationException>(() => OpcUaNodeMap.FromJson(json));
        Assert.Contains("recipe", ex.Message);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fix round 1 — overruling the original Bool rejection. A boolean's domain {false,true} is exhaustively
    // enumerable, a STRONGER bound than any numeric range, not a missing one — enable/disable, auto/manual,
    // mode-select bits are among the most common real OPC-UA writes, and the two workarounds the original
    // restriction forced (UInt16[0,1], or a command gated at a STRICTER RBAC role) both push an ordinary
    // boolean write into a higher-privilege lane than it needs.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Writable_Bool_WithNoMinMax_Accepted()
    {
        const string json = """
        { "machineCode": "PLC-BOOLWRITE", "endpointUrl": "opc.tcp://localhost:4840",
          "nodes": [ { "nodeId": "ns=2;s=Enable", "metric": "enable", "writable": { "valueType": "Bool" } } ] }
        """;

        var map = OpcUaNodeMap.FromJson(json);
        var node = Assert.Single(map.Nodes);
        Assert.Equal(CommandArgumentType.Bool, node.Writable!.ValueType);
        Assert.Null(node.Writable.Min);
        Assert.Null(node.Writable.Max);
        Assert.Equal(new[] { "enable" }, map.WritablePointNames);
    }

    [Fact]
    public void Writable_Bool_WithMinMaxPresent_Rejected_BoundsAreMeaninglessForAnExhaustiveDomain()
    {
        const string json = """
        { "machineCode": "PLC-BOOLBOUNDS", "endpointUrl": "opc.tcp://localhost:4840",
          "nodes": [ { "nodeId": "ns=2;s=Enable", "metric": "enable",
            "writable": { "valueType": "Bool", "min": 0, "max": 1 } } ] }
        """;

        var ex = Assert.Throws<InvalidOperationException>(() => OpcUaNodeMap.FromJson(json));
        Assert.Contains("enable", ex.Message);
    }

    /// <summary>Fix round 1 — preserving the ONE property the review asked to keep while relaxing Bool: an
    /// OMITTED 'valueType' must still be rejected (never silently defaulting to a live Bool declaration,
    /// which — now that Bool is accepted — could otherwise arm a write that was never actually declared).
    /// <c>ValueType</c> is therefore nullable and mandatory, exactly like <c>min</c>/<c>max</c>.</summary>
    [Fact]
    public void Writable_MissingValueType_Rejected_NeverDefaultsToBool()
    {
        const string json = """
        { "machineCode": "PLC-NOVALUETYPE", "endpointUrl": "opc.tcp://localhost:4840",
          "nodes": [ { "nodeId": "ns=2;s=Speed", "metric": "speed", "writable": { "min": 0, "max": 100 } } ] }
        """;

        var ex = Assert.Throws<InvalidOperationException>(() => OpcUaNodeMap.FromJson(json));
        Assert.Contains("speed", ex.Message);
        Assert.Contains("valueType", ex.Message);
    }

    /// <summary>An omitted 'valueType' with NEITHER min/max given either (the emptiest possible "writable":
    /// {}) must ALSO be rejected — not accepted as a defaulted Bool-with-no-bounds, which would otherwise be
    /// indistinguishable from a genuinely intended, and now legitimately valid, Bool declaration.</summary>
    [Fact]
    public void Writable_EmptyObject_MissingValueType_Rejected_NotSilentlyAcceptedAsBool()
    {
        const string json = """
        { "machineCode": "PLC-EMPTYWRITABLE", "endpointUrl": "opc.tcp://localhost:4840",
          "nodes": [ { "nodeId": "ns=2;s=Speed", "metric": "speed", "writable": {} } ] }
        """;

        Assert.Throws<InvalidOperationException>(() => OpcUaNodeMap.FromJson(json));
    }

    [Fact]
    public void Writable_RangeOverflowsItsOwnValueType_RejectedAtParseTime()
    {
        // UInt16's representable range is 0..65535 — declaring max=70000 can never be written as a UInt16.
        const string json = """
        { "machineCode": "PLC-OVERFLOW", "endpointUrl": "opc.tcp://localhost:4840",
          "nodes": [ { "nodeId": "ns=2;s=Speed", "metric": "speed",
            "writable": { "valueType": "UInt16", "min": 0, "max": 70000 } } ] }
        """;

        var ex = Assert.Throws<InvalidOperationException>(() => OpcUaNodeMap.FromJson(json));
        Assert.Contains("speed", ex.Message);
        Assert.Contains("overflow", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Writable_DuplicateMetricAmongWritableNodes_Rejected()
    {
        const string json = """
        { "machineCode": "PLC-DUP", "endpointUrl": "opc.tcp://localhost:4840",
          "nodes": [
            { "nodeId": "ns=2;s=Speed1", "metric": "speed", "writable": { "valueType": "UInt16", "min": 0, "max": 100 } },
            { "nodeId": "ns=2;s=Speed2", "metric": "speed", "writable": { "valueType": "UInt16", "min": 0, "max": 200 } } ] }
        """;

        var ex = Assert.Throws<InvalidOperationException>(() => OpcUaNodeMap.FromJson(json));
        Assert.Contains("speed", ex.Message);
    }

    // ─────────────────────────────────────────────────────────────────────
    // OpcUaWritableSetpoint.TryNarrowForWrite
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void TryNarrowForWrite_Double_NoRoundingOrTypeChange()
    {
        var setpoint = new OpcUaWritableSetpoint(CommandArgumentType.Double, 0, 100);
        Assert.True(setpoint.TryNarrowForWrite(23.7, out var narrowed, out var error));
        Assert.Null(error);
        Assert.Equal(23.7, narrowed);
    }

    // Fix round 1 — TryNarrowForWrite's signature widened from `double engineeringValue` to `object?
    // rawValue` (to admit Bool, below) — a bare `int` literal like `1200` now boxes directly as `int`,
    // which matches neither the `double` nor `long` arm, so these two pre-existing tests are updated to use
    // `long`/`double` literals — the actual domain a caller (SetpointWriteRequest.Value/ConnectorObjectConverter)
    // would ever hand this method in practice.
    [Fact]
    public void TryNarrowForWrite_UInt16_FromBoxedLong_NarrowsToActualUShort()
    {
        var setpoint = new OpcUaWritableSetpoint(CommandArgumentType.UInt16, 0, 5000);
        Assert.True(setpoint.TryNarrowForWrite(1200L, out var narrowed, out _));
        Assert.IsType<ushort>(narrowed);
        Assert.Equal((ushort)1200, narrowed);
    }

    [Fact]
    public void TryNarrowForWrite_OutsideDeclaredRange_Rejected()
    {
        var setpoint = new OpcUaWritableSetpoint(CommandArgumentType.UInt16, 0, 100);
        Assert.False(setpoint.TryNarrowForWrite(150.0, out var narrowed, out var error));
        Assert.Null(narrowed);
        Assert.NotNull(error);
    }

    [Fact]
    public void TryNarrowForWrite_Bool_MatchingType_Succeeds()
    {
        var setpoint = new OpcUaWritableSetpoint(CommandArgumentType.Bool, null, null);
        Assert.True(setpoint.TryNarrowForWrite(true, out var narrowed, out var error));
        Assert.Null(error);
        Assert.Equal(true, narrowed);
    }

    [Fact]
    public void TryNarrowForWrite_Bool_WrongRuntimeType_Rejected()
    {
        var setpoint = new OpcUaWritableSetpoint(CommandArgumentType.Bool, null, null);
        Assert.False(setpoint.TryNarrowForWrite(1L, out var narrowed, out var error));
        Assert.Null(narrowed);
        Assert.Contains("Bool", error);
    }

    /// <summary>Fix round 1 (Critical #2) — NaN fails every &lt;/&gt; comparison, so the declared-range check
    /// alone let it silently through, and the caller's own numeric conversion would then produce something
    /// (typically a live 0) instead of a rejection. A setpoint whose safe band is [100,400] must never
    /// silently accept NaN as "in range".</summary>
    [Fact]
    public void TryNarrowForWrite_NaN_Rejected_NeverSilentlyPassed()
    {
        var setpoint = new OpcUaWritableSetpoint(CommandArgumentType.UInt16, 100, 400);
        Assert.False(setpoint.TryNarrowForWrite(double.NaN, out var narrowed, out var error));
        Assert.Null(narrowed);
        Assert.Contains("not finite", error);
    }

    [Fact]
    public void TryNarrowForWrite_Double_NaN_Rejected()
    {
        var setpoint = new OpcUaWritableSetpoint(CommandArgumentType.Double, 100, 400);
        Assert.False(setpoint.TryNarrowForWrite(double.NaN, out var narrowed, out _));
        Assert.Null(narrowed);
    }

    [Fact]
    public void TryNarrowForWrite_NullValueType_Rejected_Defensively()
    {
        var setpoint = new OpcUaWritableSetpoint(null, null, null);
        Assert.False(setpoint.TryNarrowForWrite(5.0, out var narrowed, out var error));
        Assert.Null(narrowed);
        Assert.NotNull(error);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Commands (methods).
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Commands_DeclaredWithObjectAndMethodNodeId_Parses_AppearsInCommandNames()
    {
        const string json = """
        { "machineCode": "PLC-CMD", "endpointUrl": "opc.tcp://localhost:4840",
          "nodes": [ { "nodeId": "ns=2;s=Temperature", "metric": "temperature" } ],
          "commands": [ { "name": "Start", "objectNodeId": "ns=2;s=Machine", "methodNodeId": "ns=2;s=Machine.Start" } ] }
        """;

        var map = OpcUaNodeMap.FromJson(json);

        var command = Assert.Single(map.Commands);
        Assert.Equal("Start", command.Name);
        Assert.Equal("ns=2;s=Machine", command.ObjectNodeId);
        Assert.Equal("ns=2;s=Machine.Start", command.MethodNodeId);
        Assert.Equal(new[] { "Start" }, map.CommandNames);
    }

    [Fact]
    public void Commands_WithDeclaredArgument_NarrowsCorrectly_TheExactGapB1Names()
    {
        const string json = """
        { "machineCode": "PLC-CMD-ARGS", "endpointUrl": "opc.tcp://localhost:4840",
          "nodes": [ { "nodeId": "ns=2;s=Temperature", "metric": "temperature" } ],
          "commands": [ { "name": "SetSpeed", "objectNodeId": "ns=2;s=Machine", "methodNodeId": "ns=2;s=Machine.SetSpeed",
            "arguments": [ { "name": "speed", "type": "UInt16", "min": 0, "max": 5000 } ] } ] }
        """;

        var map = OpcUaNodeMap.FromJson(json);

        var command = Assert.Single(map.Commands);
        var argument = Assert.Single(command.Arguments!);
        Assert.Equal("speed", argument.Name);
        Assert.Equal(CommandArgumentType.UInt16, argument.Type);

        // The exact scenario B-1's own doc comment names: a UInt16 argument arrives as a boxed long.
        Assert.True(argument.TryNarrow(3000L, out var narrowed, out _));
        Assert.IsType<ushort>(narrowed);
        Assert.Equal((ushort)3000, narrowed);
    }

    [Fact]
    public void Commands_MissingObjectNodeId_Rejected()
    {
        const string json = """
        { "machineCode": "PLC-NOOBJ", "endpointUrl": "opc.tcp://localhost:4840",
          "nodes": [ { "nodeId": "ns=2;s=Temperature", "metric": "temperature" } ],
          "commands": [ { "name": "Start", "methodNodeId": "ns=2;s=Machine.Start" } ] }
        """;

        var ex = Assert.Throws<InvalidOperationException>(() => OpcUaNodeMap.FromJson(json));
        Assert.Contains("Start", ex.Message);
        Assert.Contains("objectNodeId", ex.Message);
    }

    [Fact]
    public void Commands_MissingMethodNodeId_Rejected()
    {
        const string json = """
        { "machineCode": "PLC-NOMETHOD", "endpointUrl": "opc.tcp://localhost:4840",
          "nodes": [ { "nodeId": "ns=2;s=Temperature", "metric": "temperature" } ],
          "commands": [ { "name": "Start", "objectNodeId": "ns=2;s=Machine" } ] }
        """;

        var ex = Assert.Throws<InvalidOperationException>(() => OpcUaNodeMap.FromJson(json));
        Assert.Contains("Start", ex.Message);
        Assert.Contains("methodNodeId", ex.Message);
    }

    [Fact]
    public void Commands_DuplicateName_Rejected()
    {
        const string json = """
        { "machineCode": "PLC-DUPCMD", "endpointUrl": "opc.tcp://localhost:4840",
          "nodes": [ { "nodeId": "ns=2;s=Temperature", "metric": "temperature" } ],
          "commands": [
            { "name": "Start", "objectNodeId": "ns=2;s=Machine", "methodNodeId": "ns=2;s=Machine.Start1" },
            { "name": "Start", "objectNodeId": "ns=2;s=Machine", "methodNodeId": "ns=2;s=Machine.Start2" } ] }
        """;

        var ex = Assert.Throws<InvalidOperationException>(() => OpcUaNodeMap.FromJson(json));
        Assert.Contains("Start", ex.Message);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fix round 1, I4 — a writable point's own name (Metric) is the write identity per B-1, and its NodeId
    // is what a future driver would actually address a write to; neither may be blank.
    // ─────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Writable_BlankMetric_Rejected(string blankMetric)
    {
        var json = $$"""
        { "machineCode": "PLC-BLANKMETRIC", "endpointUrl": "opc.tcp://localhost:4840",
          "nodes": [ { "nodeId": "ns=2;s=Speed", "metric": "{{blankMetric}}",
            "writable": { "valueType": "UInt16", "min": 0, "max": 100 } } ] }
        """;

        Assert.Throws<InvalidOperationException>(() => OpcUaNodeMap.FromJson(json));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Writable_BlankNodeId_Rejected(string blankNodeId)
    {
        var json = $$"""
        { "machineCode": "PLC-BLANKNODEID", "endpointUrl": "opc.tcp://localhost:4840",
          "nodes": [ { "nodeId": "{{blankNodeId}}", "metric": "speed",
            "writable": { "valueType": "UInt16", "min": 0, "max": 100 } } ] }
        """;

        Assert.Throws<InvalidOperationException>(() => OpcUaNodeMap.FromJson(json));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fix round 1, minor — explicit JSON "commands": null must not throw a bare NullReferenceException.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Commands_ExplicitJsonNull_TreatedSameAsOmitted_NoThrow()
    {
        const string json = """
        { "machineCode": "PLC-NULLCMDS", "endpointUrl": "opc.tcp://localhost:4840",
          "nodes": [ { "nodeId": "ns=2;s=Temperature", "metric": "temperature" } ],
          "commands": null }
        """;

        var map = OpcUaNodeMap.FromJson(json);
        Assert.Empty(map.Commands);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fix round 1, I1 — WritablePointBounds/CommandTargets: the richer accessors the deliberate-save-gate's
    // confirmation fingerprint is built from.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void WritablePointBounds_ReflectsDeclaredMinMaxAndNodeId()
    {
        const string json = """
        { "machineCode": "PLC-BOUNDS", "endpointUrl": "opc.tcp://localhost:4840",
          "nodes": [
            { "nodeId": "ns=2;s=Temperature", "metric": "temperature" },
            { "nodeId": "ns=2;s=Speed", "metric": "speed",
              "writable": { "valueType": "UInt16", "min": 0, "max": 5000 } } ] }
        """;

        var map = OpcUaNodeMap.FromJson(json);
        var bounds = Assert.Single(map.WritablePointBounds);
        Assert.Equal("speed", bounds.Metric);
        Assert.Equal("ns=2;s=Speed", bounds.Target);
        Assert.Equal(0, bounds.Min);
        Assert.Equal(5000, bounds.Max);
    }

    [Fact]
    public void WritablePointBounds_Bool_ReportsNullBounds()
    {
        const string json = """
        { "machineCode": "PLC-BOOLBOUNDS-2", "endpointUrl": "opc.tcp://localhost:4840",
          "nodes": [ { "nodeId": "ns=2;s=Enable", "metric": "enable", "writable": { "valueType": "Bool" } } ] }
        """;

        var map = OpcUaNodeMap.FromJson(json);
        var bounds = Assert.Single(map.WritablePointBounds);
        Assert.Equal("enable", bounds.Metric);
        Assert.Null(bounds.Min);
        Assert.Null(bounds.Max);
    }

    [Fact]
    public void CommandTargets_ReflectsObjectAndMethodNodeId()
    {
        const string json = """
        { "machineCode": "PLC-TARGETS", "endpointUrl": "opc.tcp://localhost:4840",
          "nodes": [ { "nodeId": "ns=2;s=Temperature", "metric": "temperature" } ],
          "commands": [ { "name": "Start", "objectNodeId": "ns=2;s=Machine", "methodNodeId": "ns=2;s=Machine.Start" } ] }
        """;

        var map = OpcUaNodeMap.FromJson(json);
        var target = Assert.Single(map.CommandTargets);
        Assert.Equal("Start", target.Name);
        Assert.Contains("ns=2;s=Machine", target.Target);
        Assert.Contains("ns=2;s=Machine.Start", target.Target);
    }

    /// <summary>Re-pointing a command to a DIFFERENT method produces a DIFFERENT target string.</summary>
    [Fact]
    public void CommandTargets_DifferentMethodNodeId_ProducesDifferentTarget()
    {
        const string jsonA = """
        { "machineCode": "PLC-TA", "endpointUrl": "opc.tcp://localhost:4840",
          "nodes": [ { "nodeId": "ns=2;s=Temperature", "metric": "temperature" } ],
          "commands": [ { "name": "Start", "objectNodeId": "ns=2;s=Machine", "methodNodeId": "ns=2;s=Machine.StartA" } ] }
        """;
        const string jsonB = """
        { "machineCode": "PLC-TB", "endpointUrl": "opc.tcp://localhost:4840",
          "nodes": [ { "nodeId": "ns=2;s=Temperature", "metric": "temperature" } ],
          "commands": [ { "name": "Start", "objectNodeId": "ns=2;s=Machine", "methodNodeId": "ns=2;s=Machine.StartB" } ] }
        """;

        var targetA = Assert.Single(OpcUaNodeMap.FromJson(jsonA).CommandTargets);
        var targetB = Assert.Single(OpcUaNodeMap.FromJson(jsonB).CommandTargets);

        Assert.NotEqual(targetA.Target, targetB.Target);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────────
    // 🔴 docs/owner-decisions.md ITEM 38 — the OPC-UA half. Item 38's title says the two adjacent
    // fields ARE range checked; measured, that is true of ModbusRegisterMap and FALSE here: this map
    // declares no readTimeoutMs and no retries at all, so on this side the fix imports a convention
    // rather than restoring one. The failure shapes are identical because the consumer is identical
    // (OpcUaDriver.ReadAsync hands the value straight to Task.Delay).
    // ─────────────────────────────────────────────────────────────────────────────────────────────

    private static string MapWithPollInterval(string rawJsonValue, string machineCode = "PLC-OPCUA-CADENCE") => $$"""
    { "machineCode": "{{machineCode}}", "endpointUrl": "opc.tcp://localhost:4840",
      "pollIntervalMs": {{rawJsonValue}},
      "nodes": [ { "nodeId": "ns=2;s=V", "metric": "v" } ] }
    """;

    /// <summary>
    /// 🔴 The same three shapes, and the same reason <c>-1</c> is the worst of them: <c>0</c> burns CPU
    /// visibly, <c>≤ -2</c> throws visibly, and <c>-1</c> is <c>Timeout.Infinite</c> — the endpoint is
    /// read once and then stays quiet while looking exactly like a healthy slow one. Item 38's own
    /// paragraph on this member excluded the OPC-UA driver ("Both drivers"); it was corrected to THREE,
    /// and this is the assertion that the correction was about a real consumer.
    /// </summary>
    [Theory]
    [InlineData("0")]
    [InlineData("-1")]
    [InlineData("-2")]
    [InlineData("-2147483648")]
    public void FromJson_RefusesNonPositivePollIntervalMs_WarnsAndFallsBackToTheDefault(string declared)
    {
        var warnings = new List<string>();

        var map = OpcUaNodeMap.FromJson(MapWithPollInterval(declared), logWarning: warnings.Add);

        Assert.Equal(OpcUaNodeMap.DefaultPollIntervalMs, map.PollIntervalMs);
        var warning = Assert.Single(warnings);
        Assert.Contains("pollIntervalMs", warning, StringComparison.Ordinal);
        Assert.Contains(declared, warning, StringComparison.Ordinal);
    }

    [Fact]
    public void FromJson_RefusesPollIntervalMsAboveTheCeiling_WarnsAndFallsBackToTheDefault()
    {
        var warnings = new List<string>();
        var tooLarge = OpcUaNodeMap.MaxPollIntervalMs + 1;

        var map = OpcUaNodeMap.FromJson(MapWithPollInterval(tooLarge.ToString(CultureInfo.InvariantCulture)), logWarning: warnings.Add);

        Assert.Equal(OpcUaNodeMap.DefaultPollIntervalMs, map.PollIntervalMs);
        Assert.Single(warnings);
    }

    /// <summary>The same case-insensitivity regression guarded on the Modbus side. Kept on both maps
    /// rather than on the one where it was caught, because the two parse paths are separate code and a
    /// witness that only covers one of them is a witness for one of them.</summary>
    [Theory]
    [InlineData("pollIntervalMs")]
    [InlineData("PollIntervalMs")]
    [InlineData("pollintervalms")]
    public void FromJson_KeepsAnInDomainPollIntervalMs_UnderEverySpellingTheBinderAccepts(string key)
    {
        var json = $$"""
        { "machineCode": "PLC-OPCUA-SPELLING", "endpointUrl": "opc.tcp://localhost:4840",
          "{{key}}": 250, "nodes": [ { "nodeId": "ns=2;s=V", "metric": "v" } ] }
        """;

        var warnings = new List<string>();
        var map = OpcUaNodeMap.FromJson(json, logWarning: warnings.Add);

        Assert.Equal(250, map.PollIntervalMs);
        Assert.Empty(warnings);
    }

    /// <summary>A refused cadence must not disturb anything else the map declared. This type has no
    /// <c>with</c> expression, so the refusal is applied by RECONSTRUCTING the map — an operation that can
    /// drop a field by omission, silently, exactly once and forever. Every property is asserted here for
    /// that reason.</summary>
    [Fact]
    public void FromJson_RefusingACadence_PreservesEveryOtherDeclaredField()
    {
        const string json = """
        { "machineCode": "PLC-OPCUA-KEEP", "endpointUrl": "opc.tcp://host:4840",
          "securityMode": "None", "username": "u", "password": "p", "pollIntervalMs": -1,
          "nodes": [ { "nodeId": "ns=2;s=V", "metric": "v", "unit": "C" } ] }
        """;

        var map = OpcUaNodeMap.FromJson(json);

        Assert.Equal(OpcUaNodeMap.DefaultPollIntervalMs, map.PollIntervalMs);
        Assert.Equal("PLC-OPCUA-KEEP", map.MachineCode);
        Assert.Equal("opc.tcp://host:4840", map.EndpointUrl);
        Assert.Equal(OpcUaSecurityMode.None, map.SecurityMode);
        Assert.Equal("u", map.Username);
        Assert.Equal("p", map.Password);
        Assert.Empty(map.Commands);
        var node = Assert.Single(map.Nodes);
        Assert.Equal("ns=2;s=V", node.NodeId);
        Assert.Equal("C", node.Unit);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────────
    // 🔴 docs/owner-decisions.md ITEM 39 — the OPC-UA twin. Two cases, measured separately.
    // ─────────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>🔴 <b>Case 1 — explicit <c>null</c>.</b> Satisfies <c>required</c>, binds a genuine null,
    /// and used to leave through <c>OpcUaConnectorFactory.TryCreate</c> as the CLR's own
    /// <c>"Object reference not set to an instance of an object."</c>.</summary>
    [Fact]
    public void FromJson_ExplicitNullNodes_ThrowsNamingTheFieldAndTheMachine_NotABareNullReference()
    {
        const string json = """
        { "machineCode": "PLC-NULLNODES", "endpointUrl": "opc.tcp://localhost:4840", "nodes": null }
        """;

        var ex = Assert.Throws<InvalidOperationException>(() => OpcUaNodeMap.FromJson(json));

        Assert.Contains("nodes", ex.Message, StringComparison.Ordinal);
        Assert.Contains("PLC-NULLNODES", ex.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("Object reference not set", ex.Message, StringComparison.Ordinal);
    }

    /// <summary><b>Case 2 — the key is ABSENT.</b> A different mechanism, already correct before item 39,
    /// asserted so the case-1 fix cannot silently absorb it.</summary>
    [Fact]
    public void FromJson_AbsentNodesKey_StillFailsInTheBinderNamingTheProperty()
    {
        const string json = """
        { "machineCode": "PLC-NONODES", "endpointUrl": "opc.tcp://localhost:4840" }
        """;

        var ex = Assert.Throws<JsonException>(() => OpcUaNodeMap.FromJson(json));

        Assert.Contains("Nodes", ex.Message, StringComparison.Ordinal);
    }
}
