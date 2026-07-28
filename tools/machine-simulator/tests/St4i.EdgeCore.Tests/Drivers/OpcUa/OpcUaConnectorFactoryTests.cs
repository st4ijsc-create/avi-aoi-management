using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Drivers.OpcUa;
using Xunit;

namespace St4i.EdgeCore.Tests.Drivers.OpcUa;

/// <summary>
/// GP-4 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-4-brief.md) — unit coverage
/// for <see cref="OpcUaConnectorFactory"/>, mirroring <c>ModbusConnectorFactoryTests</c>'s shape exactly:
/// (1) valid node-map JSON produces a real, correctly-tagged driver, reusing
/// <see cref="OpcUaDriverFactory"/> rather than duplicating its construction logic; (2) a malformed
/// configuration is reported via the non-throwing <c>TryCreate</c> contract, never an exception.
/// </summary>
public class OpcUaConnectorFactoryTests
{
    private const string ValidNodeMapJson = """
    { "machineCode": "PLC-OPCUA-01", "endpointUrl": "opc.tcp://localhost:4840", "pollIntervalMs": 500,
      "nodes": [
        { "nodeId": "ns=2;s=Temperature", "metric": "temperature", "unit": "C" } ] }
    """;

    [Fact]
    public async Task TryCreate_ValidConfig_BuildsARealOpcUaDriver()
    {
        var factory = new OpcUaConnectorFactory();

        var ok = factory.TryCreate(ValidNodeMapJson, out var driver, out var error);

        Assert.True(ok);
        Assert.NotNull(driver);
        Assert.Null(error);
        Assert.Equal(DriverKinds.OpcUa, driver!.Kind);

        await driver.DisposeAsync();
    }

    [Fact]
    public void Kind_ReportsTheOpcUaBuiltInId()
    {
        var factory = new OpcUaConnectorFactory();
        Assert.Equal(DriverKinds.OpcUa, factory.Kind);
    }

    [Theory]
    [InlineData("not json at all")]
    [InlineData("{}")] // valid JSON, but missing required fields
    [InlineData("""{ "machineCode": "", "endpointUrl": "opc.tcp://x", "nodes": [] }""")] // blank machineCode + empty nodes
    public void TryCreate_MalformedConfig_ReturnsFalseWithError_NeverThrows(string badConfig)
    {
        var factory = new OpcUaConnectorFactory();

        var exception = Record.Exception(() =>
        {
            var ok = factory.TryCreate(badConfig, out var driver, out var error);
            Assert.False(ok);
            Assert.Null(driver);
            Assert.False(string.IsNullOrWhiteSpace(error));
        });

        Assert.Null(exception);
    }

    [Fact]
    public async Task TryCreate_CalledTwice_BuildsTwoIndependentDriverInstances()
    {
        // Mirrors OpcUaDriverFactory.Create()'s own "fresh instance every call" contract — a registry
        // calling TryCreate again on a restart must never get back a reused/already-disposed driver.
        var factory = new OpcUaConnectorFactory();

        factory.TryCreate(ValidNodeMapJson, out var first, out _);
        factory.TryCreate(ValidNodeMapJson, out var second, out _);

        Assert.NotNull(first);
        Assert.NotNull(second);
        Assert.NotSame(first, second);

        await first!.DisposeAsync();
        await second!.DisposeAsync();
    }
}
