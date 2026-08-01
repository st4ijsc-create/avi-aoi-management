using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Drivers.Modbus;
using Xunit;

namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// GP-4 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-4-brief.md) — unit coverage
/// for <see cref="ModbusConnectorFactory"/>, the <c>IConnectorFactory</c> adapter that lets Modbus register
/// itself into a host's <c>ConnectorRegistry</c>. The two things this class exists to prove: (1) valid
/// register-map JSON produces a real, correctly-<see cref="St4i.Connector.Abstractions.IDeviceDriver.Kind"/>-tagged
/// driver, reusing <see cref="ModbusDriverFactory"/> rather than duplicating its construction logic; (2) a
/// malformed configuration is reported via the non-throwing <c>TryCreate</c> contract, never an exception —
/// the exact "a malformed map file disables Modbus for this run without crashing the host" behavior,
/// now expressed structurally.
/// </summary>
public class ModbusConnectorFactoryTests
{
    private const string ValidRegisterMapJson = """
    { "machineCode": "PLC-01", "unitId": 1, "pollIntervalMs": 1000,
      "registers": [
        { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "temperature", "unit": "C" } ] }
    """;

    [Fact]
    public async Task TryCreate_ValidConfig_BuildsARealModbusDriver()
    {
        var factory = new ModbusConnectorFactory(new ModbusOptions { Host = "127.0.0.1", Port = 15020 });

        var ok = factory.TryCreate(ValidRegisterMapJson, out var driver, out var error);

        Assert.True(ok);
        Assert.NotNull(driver);
        Assert.Null(error);
        Assert.Equal(DriverKinds.Modbus, driver!.Kind);

        await driver.DisposeAsync();
    }

    [Fact]
    public void Kind_ReportsTheModbusBuiltInId()
    {
        var factory = new ModbusConnectorFactory(new ModbusOptions());
        Assert.Equal(DriverKinds.Modbus, factory.Kind);
    }

    [Theory]
    [InlineData("not json at all")]
    [InlineData("{}")] // valid JSON, but missing required fields
    [InlineData("""{ "machineCode": "", "registers": [] }""")] // blank machineCode + empty registers
    public void TryCreate_MalformedConfig_ReturnsFalseWithError_NeverThrows(string badConfig)
    {
        var factory = new ModbusConnectorFactory(new ModbusOptions());

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
        // Mirrors ModbusDriverFactory.Create()'s own "fresh instance every call" contract — a registry
        // calling TryCreate again on a restart must never get back a reused/already-disposed driver.
        var factory = new ModbusConnectorFactory(new ModbusOptions());

        factory.TryCreate(ValidRegisterMapJson, out var first, out _);
        factory.TryCreate(ValidRegisterMapJson, out var second, out _);

        Assert.NotNull(first);
        Assert.NotNull(second);
        Assert.NotSame(first, second);

        await first!.DisposeAsync();
        await second!.DisposeAsync();
    }
}
