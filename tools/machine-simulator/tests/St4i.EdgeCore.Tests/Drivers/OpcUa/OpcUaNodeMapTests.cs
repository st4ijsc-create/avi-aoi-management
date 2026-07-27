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
}
