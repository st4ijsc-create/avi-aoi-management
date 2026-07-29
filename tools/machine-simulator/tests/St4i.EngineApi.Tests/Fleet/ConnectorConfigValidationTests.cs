using St4i.Connector.Abstractions.Models;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests.Fleet;

/// <summary>
/// SM-5 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-5-brief.md) — unit-level
/// proof of <see cref="ConnectorConfigValidation.TryValidate"/> in isolation, independent of the HTTP layer
/// (covered end-to-end by <c>ConnectorEndpointsTests</c>): kind normalization/rejection, per-kind field
/// requirements, and — the deliverable's own acceptance bullet — that the resulting
/// <see cref="St4i.EdgeCore.Models.MachineDescriptor.DriverKind"/> is never <see cref="DriverKinds.Simulated"/>,
/// i.e. <see cref="DriverKinds.IsFabricated"/> is false for anything this class accepts.
/// </summary>
public sealed class ConnectorConfigValidationTests
{
    private const string ValidModbusMap = """
        {
          "machineCode": "MODBUS-01",
          "unitId": 1,
          "pollIntervalMs": 500,
          "registers": [
            { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "temperature", "unit": "C" }
          ]
        }
        """;

    private const string ValidOpcUaMap = """
        {
          "machineCode": "OPCUA-01",
          "endpointUrl": "opc.tcp://10.0.0.9:4840",
          "pollIntervalMs": 500,
          "nodes": [
            { "nodeId": "ns=2;s=Temperature", "metric": "temperature", "unit": "C" }
          ]
        }
        """;

    [Theory]
    [InlineData("Modbus")]
    [InlineData("modbus")]
    [InlineData("MODBUS")]
    public void Modbus_ValidRequest_Accepted_DriverKindIsCanonical_NeverFabricated(string kindSpelling)
    {
        var ok = ConnectorConfigValidation.TryValidate(
            kindSpelling, host: "10.0.0.5", port: 502, mapJson: ValidModbusMap, pkiDir: null,
            out var result, out var error);

        Assert.True(ok, error);
        Assert.NotNull(result);
        Assert.Equal(DriverKinds.Modbus, result!.Descriptor.DriverKind);
        Assert.Equal("MODBUS-01", result.MachineCode);
        Assert.Equal("10.0.0.5", result.Host);
        Assert.Equal(502, result.Port);
        Assert.False(DriverKinds.IsFabricated(result.Descriptor.DriverKind));
    }

    [Fact]
    public void OpcUa_ValidRequest_Accepted_DriverKindIsCanonical_NeverFabricated_NoHostPortStored()
    {
        var ok = ConnectorConfigValidation.TryValidate(
            "OpcUa", host: null, port: null, mapJson: ValidOpcUaMap, pkiDir: null,
            out var result, out var error);

        Assert.True(ok, error);
        Assert.NotNull(result);
        Assert.Equal(DriverKinds.OpcUa, result!.Descriptor.DriverKind);
        Assert.Equal("OPCUA-01", result.MachineCode);
        Assert.Null(result.Host);
        Assert.Null(result.Port);
        Assert.False(DriverKinds.IsFabricated(result.Descriptor.DriverKind));
    }

    [Fact]
    public void OpcUa_IgnoresExtraneousHostPort_NeverErrors()
    {
        var ok = ConnectorConfigValidation.TryValidate(
            "OpcUa", host: "irrelevant", port: 9999, mapJson: ValidOpcUaMap, pkiDir: null,
            out var result, out var error);

        Assert.True(ok, error);
        Assert.Null(result!.Host);
        Assert.Null(result.Port);
    }

    [Theory]
    [InlineData("Serial")]
    [InlineData("S7")]
    [InlineData("EtherNetIP")]
    [InlineData("SecsGem")]
    [InlineData("totally-made-up")]
    public void UnsupportedKind_Rejected_NeverStubbed(string kind)
    {
        var ok = ConnectorConfigValidation.TryValidate(
            kind, host: "10.0.0.5", port: 502, mapJson: ValidModbusMap, pkiDir: null,
            out var result, out var error);

        Assert.False(ok);
        Assert.Null(result);
        Assert.Contains("Modbus", error);
        Assert.Contains("OpcUa", error);
    }

    [Fact]
    public void Modbus_MissingHost_Rejected()
    {
        var ok = ConnectorConfigValidation.TryValidate(
            "Modbus", host: null, port: 502, mapJson: ValidModbusMap, pkiDir: null,
            out var result, out var error);

        Assert.False(ok);
        Assert.Null(result);
        Assert.Contains("host", error, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(65536)]
    public void Modbus_PortOutOfRange_Rejected(int badPort)
    {
        var ok = ConnectorConfigValidation.TryValidate(
            "Modbus", host: "10.0.0.5", port: badPort, mapJson: ValidModbusMap, pkiDir: null,
            out var result, out var error);

        Assert.False(ok);
        Assert.Null(result);
        Assert.Contains("port", error, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Modbus_MissingPort_Rejected()
    {
        var ok = ConnectorConfigValidation.TryValidate(
            "Modbus", host: "10.0.0.5", port: null, mapJson: ValidModbusMap, pkiDir: null,
            out var result, out var error);

        Assert.False(ok);
        Assert.Null(result);
    }

    [Fact]
    public void Modbus_MalformedMapJson_Rejected_WithParserMessage()
    {
        var ok = ConnectorConfigValidation.TryValidate(
            "Modbus", host: "10.0.0.5", port: 502, mapJson: "{ not valid json", pkiDir: null,
            out var result, out var error);

        Assert.False(ok);
        Assert.Null(result);
        Assert.NotNull(error);
    }

    [Fact]
    public void Modbus_MapMissingMachineCode_Rejected()
    {
        const string mapMissingCode = """
            { "registers": [ { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "t" } ] }
            """;

        var ok = ConnectorConfigValidation.TryValidate(
            "Modbus", host: "10.0.0.5", port: 502, mapJson: mapMissingCode, pkiDir: null,
            out var result, out var error);

        Assert.False(ok);
        Assert.Null(result);
    }

    [Fact]
    public void Modbus_MapWithEmptyRegisters_Rejected()
    {
        const string mapNoRegisters = """{ "machineCode": "M1", "registers": [] }""";

        var ok = ConnectorConfigValidation.TryValidate(
            "Modbus", host: "10.0.0.5", port: 502, mapJson: mapNoRegisters, pkiDir: null,
            out var result, out var error);

        Assert.False(ok);
        Assert.Null(result);
    }

    [Fact]
    public void OpcUa_MalformedMapJson_Rejected()
    {
        var ok = ConnectorConfigValidation.TryValidate(
            "OpcUa", host: null, port: null, mapJson: "not json at all", pkiDir: null,
            out var result, out var error);

        Assert.False(ok);
        Assert.Null(result);
        Assert.NotNull(error);
    }

    [Fact]
    public void OpcUa_MapMissingEndpointUrl_Rejected()
    {
        const string mapNoEndpoint = """
            { "machineCode": "O1", "nodes": [ { "nodeId": "ns=2;s=X", "metric": "t" } ] }
            """;

        var ok = ConnectorConfigValidation.TryValidate(
            "OpcUa", host: null, port: null, mapJson: mapNoEndpoint, pkiDir: null,
            out var result, out var error);

        Assert.False(ok);
        Assert.Null(result);
    }

    [Fact]
    public void MissingMapJson_Rejected()
    {
        var ok = ConnectorConfigValidation.TryValidate(
            "Modbus", host: "10.0.0.5", port: 502, mapJson: "  ", pkiDir: null,
            out var result, out var error);

        Assert.False(ok);
        Assert.Null(result);
        Assert.Contains("mapJson", error);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Task B-3 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-3-brief.md) — WriteCapability
    // adapted from whichever protocol's own parsed map.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Modbus_PlainReadOnlyMap_WriteCapability_GrantsNothing()
    {
        var ok = ConnectorConfigValidation.TryValidate(
            "Modbus", host: "10.0.0.5", port: 502, mapJson: ValidModbusMap, pkiDir: null,
            out var result, out _);

        Assert.True(ok);
        Assert.False(result!.WriteCapability.GrantsCapability);
        Assert.Empty(result.WriteCapability.WritablePoints);
        Assert.Empty(result.WriteCapability.Commands);
    }

    [Fact]
    public void Modbus_MapWithWritableRegisterAndCommand_WriteCapability_ReflectsBoth()
    {
        const string mapWithWrite = """
            {
              "machineCode": "MODBUS-WRITE",
              "unitId": 1,
              "registers": [
                { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "temperature" },
                { "address": 1, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "speed",
                  "writable": { "min": 0, "max": 5000 } } ],
              "commands": [ { "name": "StartCycle", "coilAddress": 5 } ]
            }
            """;

        var ok = ConnectorConfigValidation.TryValidate(
            "Modbus", host: "10.0.0.5", port: 502, mapJson: mapWithWrite, pkiDir: null,
            out var result, out var error);

        Assert.True(ok, error);
        Assert.True(result!.WriteCapability.GrantsCapability);
        var point = Assert.Single(result.WriteCapability.WritablePoints);
        Assert.Equal("speed", point.Name);
        Assert.Equal("address:1", point.Target);
        Assert.Equal(0, point.Min);
        Assert.Equal(5000, point.Max);
        var command = Assert.Single(result.WriteCapability.Commands);
        Assert.Equal("StartCycle", command.Name);
        Assert.Equal("coil:5", command.Target);
    }

    [Fact]
    public void OpcUa_PlainReadOnlyMap_WriteCapability_GrantsNothing()
    {
        var ok = ConnectorConfigValidation.TryValidate(
            "OpcUa", host: null, port: null, mapJson: ValidOpcUaMap, pkiDir: null,
            out var result, out _);

        Assert.True(ok);
        Assert.False(result!.WriteCapability.GrantsCapability);
    }

    [Fact]
    public void OpcUa_MapWithWritableNodeAndCommand_WriteCapability_ReflectsBoth()
    {
        const string mapWithWrite = """
            {
              "machineCode": "OPCUA-WRITE",
              "endpointUrl": "opc.tcp://10.0.0.9:4840",
              "nodes": [
                { "nodeId": "ns=2;s=Temperature", "metric": "temperature" },
                { "nodeId": "ns=2;s=Speed", "metric": "speed",
                  "writable": { "valueType": "UInt16", "min": 0, "max": 5000 } } ],
              "commands": [ { "name": "Start", "objectNodeId": "ns=2;s=Machine", "methodNodeId": "ns=2;s=Machine.Start" } ]
            }
            """;

        var ok = ConnectorConfigValidation.TryValidate(
            "OpcUa", host: null, port: null, mapJson: mapWithWrite, pkiDir: null,
            out var result, out var error);

        Assert.True(ok, error);
        Assert.True(result!.WriteCapability.GrantsCapability);
        var point = Assert.Single(result.WriteCapability.WritablePoints);
        Assert.Equal("speed", point.Name);
        Assert.Equal("ns=2;s=Speed", point.Target);
        Assert.Equal(0, point.Min);
        Assert.Equal(5000, point.Max);
        var command = Assert.Single(result.WriteCapability.Commands);
        Assert.Equal("Start", command.Name);
        Assert.Contains("ns=2;s=Machine", command.Target);
    }

    [Fact]
    public void MissingKind_Rejected()
    {
        var ok = ConnectorConfigValidation.TryValidate(
            "  ", host: "10.0.0.5", port: 502, mapJson: ValidModbusMap, pkiDir: null,
            out var result, out var error);

        Assert.False(ok);
        Assert.Null(result);
        Assert.Contains("kind", error);
    }
}
