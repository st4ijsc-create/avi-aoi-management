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

    [Theory]
    [InlineData("Bool")]
    [InlineData("String")]
    public void Writable_NonNumericValueType_Rejected(string valueType)
    {
        var json = $$"""
        { "machineCode": "PLC-BADTYPE", "endpointUrl": "opc.tcp://localhost:4840",
          "nodes": [ { "nodeId": "ns=2;s=Enable", "metric": "enable",
            "writable": { "valueType": "{{valueType}}", "min": 0, "max": 1 } } ] }
        """;

        var ex = Assert.Throws<InvalidOperationException>(() => OpcUaNodeMap.FromJson(json));
        Assert.Contains("enable", ex.Message);
        Assert.Contains("numeric", ex.Message, StringComparison.OrdinalIgnoreCase);
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

    [Fact]
    public void TryNarrowForWrite_UInt16_NarrowsToActualUShort()
    {
        var setpoint = new OpcUaWritableSetpoint(CommandArgumentType.UInt16, 0, 5000);
        Assert.True(setpoint.TryNarrowForWrite(1200, out var narrowed, out _));
        Assert.IsType<ushort>(narrowed);
        Assert.Equal((ushort)1200, narrowed);
    }

    [Fact]
    public void TryNarrowForWrite_OutsideDeclaredRange_Rejected()
    {
        var setpoint = new OpcUaWritableSetpoint(CommandArgumentType.UInt16, 0, 100);
        Assert.False(setpoint.TryNarrowForWrite(150, out var narrowed, out var error));
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
}
