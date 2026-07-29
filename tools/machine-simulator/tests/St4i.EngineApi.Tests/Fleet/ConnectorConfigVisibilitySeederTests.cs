using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests.Fleet;

/// <summary>
/// Task B-4 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-4-brief.md) — proves the
/// carried B-3 finding (I2, "hard deadline") is actually closed: <see cref="ConnectorConfigVisibilitySeeder.SeedAsync"/>
/// makes an env-var/connectors.json-configured connector show up in <see cref="ConnectorConfigStore.ListAsync"/>
/// (the backing data for <c>GET /v1/connectors/configured</c>) — including its declared write capability —
/// while NEVER overwriting an operator's own persisted row for the same kind (the insert-only contract this
/// class's own doc comment describes).
/// </summary>
public sealed class ConnectorConfigVisibilitySeederTests
{
    private static string TempDir() => Directory.CreateTempSubdirectory("st4i-connector-visibility-seeder-tests-").FullName;

    private const string WritableModbusMap = """
        {
          "machineCode": "MODBUS-ENV-01",
          "unitId": 1,
          "pollIntervalMs": 500,
          "registers": [
            { "address": 5, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "speed", "unit": "rpm",
              "writable": { "min": 0, "max": 500 } }
          ]
        }
        """;

    private const string ReadOnlyModbusMap = """
        {
          "machineCode": "MODBUS-ENV-02",
          "unitId": 1,
          "pollIntervalMs": 500,
          "registers": [
            { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "temperature", "unit": "C" }
          ]
        }
        """;

    private const string ValidOpcUaMap = """
        {
          "machineCode": "OPCUA-ENV-01",
          "endpointUrl": "opc.tcp://10.0.0.9:4840",
          "pollIntervalMs": 500,
          "nodes": [
            { "nodeId": "ns=2;s=Temperature", "metric": "temperature", "unit": "C" }
          ]
        }
        """;

    [Fact]
    public async Task SeedAsync_NoExistingRow_InsertsRow_WriteCapabilityVisible()
    {
        var store = new ConnectorConfigStore(TempDir());

        await ConnectorConfigVisibilitySeeder.SeedAsync(
            store, "Modbus", host: "10.0.0.5", port: 502, mapJson: WritableModbusMap, pkiDir: null);

        var configured = await store.ListAsync();
        var row = Assert.Single(configured);
        Assert.Equal("Modbus", row.Kind);
        Assert.Equal("MODBUS-ENV-01", row.MachineCode);
        Assert.Equal("10.0.0.5", row.Host);
        Assert.Equal(502, row.Port);

        // The load-bearing assertion — this is the exact gap the task closes: before this task, an
        // env-var-configured connector had NO row here at all, so its write capability could never be seen.
        Assert.NotNull(row.WriteCapability);
        Assert.True(row.WriteCapability!.GrantsWriteCapability);
        var point = Assert.Single(row.WriteCapability.WritablePoints);
        Assert.Equal("speed", point.Name);
        Assert.Equal(0, point.Min);
        Assert.Equal(500, point.Max);
    }

    [Fact]
    public async Task SeedAsync_ReadOnlyMap_InsertsRow_ButWriteCapabilityIsNull()
    {
        var store = new ConnectorConfigStore(TempDir());

        await ConnectorConfigVisibilitySeeder.SeedAsync(
            store, "Modbus", host: "10.0.0.6", port: 502, mapJson: ReadOnlyModbusMap, pkiDir: null);

        var configured = await store.ListAsync();
        var row = Assert.Single(configured);
        Assert.Equal("MODBUS-ENV-02", row.MachineCode);
        Assert.Null(row.WriteCapability);
    }

    [Fact]
    public async Task SeedAsync_OpcUa_HostPortIgnored_MapJsonCarriesEndpoint()
    {
        var store = new ConnectorConfigStore(TempDir());

        await ConnectorConfigVisibilitySeeder.SeedAsync(
            store, "OpcUa", host: null, port: null, mapJson: ValidOpcUaMap, pkiDir: null);

        var configured = await store.ListAsync();
        var row = Assert.Single(configured);
        Assert.Equal("OpcUa", row.Kind);
        Assert.Equal("OPCUA-ENV-01", row.MachineCode);
        Assert.Null(row.Host);
        Assert.Null(row.Port);
    }

    /// <summary>The insert-only contract — the load-bearing safety property this class exists to uphold: an
    /// operator's OWN persisted row (as if saved earlier via <c>POST /v1/connectors</c>) for the SAME kind
    /// must never be silently overwritten by this visibility-only seeding pass, even though the env-var map
    /// declares a DIFFERENT machine code and a DIFFERENT write capability entirely.</summary>
    [Fact]
    public async Task SeedAsync_RowAlreadyExistsForKind_NeverOverwritten()
    {
        var store = new ConnectorConfigStore(TempDir());

        var operatorSaved = await store.SaveAsync(
            "Modbus", "OPERATOR-OWN-MACHINE", "192.168.1.50", 502, """{"machineCode":"OPERATOR-OWN-MACHINE"}""");

        await ConnectorConfigVisibilitySeeder.SeedAsync(
            store, "Modbus", host: "10.0.0.5", port: 502, mapJson: WritableModbusMap, pkiDir: null);

        var configured = await store.ListAsync();
        var row = Assert.Single(configured); // still exactly one row — nothing was appended alongside it.
        Assert.Equal("OPERATOR-OWN-MACHINE", row.MachineCode);
        Assert.Equal("192.168.1.50", row.Host);
        Assert.Null(row.WriteCapability); // the operator's own map declared no write capability — untouched.
        Assert.Equal(operatorSaved.UpdatedAtUtc, row.UpdatedAtUtc); // not merely unchanged data — never even re-written.
    }

    [Fact]
    public async Task SeedAsync_MalformedMap_LogsWarning_NeverThrows_NoRowInserted()
    {
        var store = new ConnectorConfigStore(TempDir());
        var warnings = new List<string>();

        await ConnectorConfigVisibilitySeeder.SeedAsync(
            store, "Modbus", host: "10.0.0.5", port: 502, mapJson: "{ not valid json",
            pkiDir: null, logWarning: warnings.Add);

        Assert.NotEmpty(warnings);
        Assert.Empty(await store.ListAsync());
    }

    [Fact]
    public async Task SeedAsync_UnsupportedKind_LogsWarning_NeverThrows_NoRowInserted()
    {
        var store = new ConnectorConfigStore(TempDir());
        var warnings = new List<string>();

        await ConnectorConfigVisibilitySeeder.SeedAsync(
            store, "Serial", host: "10.0.0.5", port: 502, mapJson: WritableModbusMap,
            pkiDir: null, logWarning: warnings.Add);

        Assert.NotEmpty(warnings);
        Assert.Empty(await store.ListAsync());
    }
}
