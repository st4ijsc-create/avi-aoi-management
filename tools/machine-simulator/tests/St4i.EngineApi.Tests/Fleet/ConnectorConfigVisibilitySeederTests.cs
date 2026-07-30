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
    /// declares a DIFFERENT machine code and a DIFFERENT write capability entirely.
    ///
    /// <para>Fix round 1 (review, Important #2) — ALSO proves the skip is no longer SILENT: this is exactly
    /// the "operator's read-only row shadowed by a now-active writable env-var map" scenario the review
    /// flagged as the safety-relevant direction of this gap — GET /v1/connectors/configured would report
    /// read-only for a connector that can actually write. A loud, specific warning is the accepted minimum
    /// fix (a full provenance column is out of this task's scope) — asserted here by CONTENT, not just
    /// non-empty, so a future regression that keeps warning but loses the actionable detail would still be
    /// caught.</para></summary>
    [Fact]
    public async Task SeedAsync_RowAlreadyExistsForKind_NeverOverwritten_ButWarnsLoudly()
    {
        var store = new ConnectorConfigStore(TempDir());
        var warnings = new List<string>();

        var operatorSaved = await store.SaveAsync(
            "Modbus", "OPERATOR-OWN-MACHINE", "192.168.1.50", 502, """{"machineCode":"OPERATOR-OWN-MACHINE"}""");

        await ConnectorConfigVisibilitySeeder.SeedAsync(
            store, "Modbus", host: "10.0.0.5", port: 502, mapJson: WritableModbusMap, pkiDir: null,
            logWarning: warnings.Add);

        var configured = await store.ListAsync();
        var row = Assert.Single(configured); // still exactly one row — nothing was appended alongside it.
        Assert.Equal("OPERATOR-OWN-MACHINE", row.MachineCode);
        Assert.Equal("192.168.1.50", row.Host);
        Assert.Null(row.WriteCapability); // the operator's own map declared no write capability — untouched.
        Assert.Equal(operatorSaved.UpdatedAtUtc, row.UpdatedAtUtc); // not merely unchanged data — never even re-written.

        // The load-bearing assertion (Fix round 1, Important #2): the skip is no longer silent, and the
        // warning names the exact endpoint/kind/hazard, not a generic "something happened" message.
        var warning = Assert.Single(warnings);
        Assert.Contains("GET /v1/connectors/configured", warning, StringComparison.Ordinal);
        Assert.Contains("Modbus", warning, StringComparison.Ordinal);
        Assert.Contains("may NOT reflect", warning, StringComparison.Ordinal);
    }

    /// <summary>Task B-6 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-6-brief.md) — closes
    /// the carried B-4 finding (fix round 1, Important #3): before this task, EVERY existing row (seeded or
    /// operator) triggered the loud warning above and was left untouched. Now that a row's own
    /// <see cref="ConnectorConfigSource"/> is known, a row this SAME mechanism seeded on an earlier boot is
    /// safely refreshed in place — no warning (nothing is wrong), and the row picks up whatever the CURRENT
    /// map declares (here: a widened writable range), closing B-4's own documented "accepted residual
    /// staleness gap" as a side effect.</summary>
    [Fact]
    public async Task SeedAsync_SecondBootOfTheSameSeededKind_UpsertsFreshMap_NoWarning_ClosesTheStalenessGap()
    {
        var store = new ConnectorConfigStore(TempDir());
        var warnings = new List<string>();

        // Boot 1 — the map as it was originally declared (max=500, see WritableModbusMap).
        await ConnectorConfigVisibilitySeeder.SeedAsync(
            store, "Modbus", host: "10.0.0.5", port: 502, mapJson: WritableModbusMap, pkiDir: null, logWarning: warnings.Add);
        var afterBoot1 = Assert.Single(await store.ListAsync());
        Assert.Equal(ConnectorConfigSource.Seeded, afterBoot1.Source);
        Assert.Equal(500, afterBoot1.WriteCapability!.WritablePoints.Single().Max);
        Assert.Empty(warnings); // no existing row yet on the very first boot — nothing to warn about either.

        // Boot 2 — SAME env-var-driven kind, but the underlying map was hand-edited (widened to max=65535).
        // B-4's "accepted residual gap": before this task, this second call would have been a silent SKIP
        // (insert-only), leaving GET /v1/connectors/configured showing the STALE max=500 forever until an
        // operator manually DELETEd and restarted. It is now an UPSERT.
        const string widenedWritableModbusMap = """
            {
              "machineCode": "MODBUS-ENV-01",
              "unitId": 1,
              "pollIntervalMs": 500,
              "registers": [
                { "address": 5, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "speed", "unit": "rpm",
                  "writable": { "min": 0, "max": 65535 } }
              ]
            }
            """;
        await ConnectorConfigVisibilitySeeder.SeedAsync(
            store, "Modbus", host: "10.0.0.5", port: 502, mapJson: widenedWritableModbusMap, pkiDir: null, logWarning: warnings.Add);

        var afterBoot2 = Assert.Single(await store.ListAsync()); // still exactly one row — an upsert, not a second row.
        Assert.Equal(ConnectorConfigSource.Seeded, afterBoot2.Source);
        Assert.Equal(65535, afterBoot2.WriteCapability!.WritablePoints.Single().Max); // refreshed, not stale.
        Assert.Empty(warnings); // the load-bearing assertion: refreshing the seeder's own prior row never warns.
    }

    /// <summary>The other half proven directly: an existing OPERATOR row (not this mechanism's own artifact)
    /// still gets the pre-existing protect-and-warn treatment, unchanged — this is exactly
    /// <see cref="SeedAsync_RowAlreadyExistsForKind_NeverOverwritten_ButWarnsLoudly"/> above, restated here
    /// only to make the CONTRAST with the Seeded-row test explicit in one place.</summary>
    [Fact]
    public async Task SeedAsync_RowAlreadyExistsAndIsAnOperatorRow_NeverRefreshed_StillWarnsLoudly()
    {
        var store = new ConnectorConfigStore(TempDir());
        var warnings = new List<string>();

        var operatorSaved = await store.SaveAsync(
            "Modbus", "OPERATOR-OWN-MACHINE", "192.168.1.50", 502, """{"machineCode":"OPERATOR-OWN-MACHINE"}""");
        Assert.Equal(ConnectorConfigSource.Operator, operatorSaved.Source);

        await ConnectorConfigVisibilitySeeder.SeedAsync(
            store, "Modbus", host: "10.0.0.5", port: 502, mapJson: WritableModbusMap, pkiDir: null,
            logWarning: warnings.Add);

        var row = Assert.Single(await store.ListAsync());
        Assert.Equal("OPERATOR-OWN-MACHINE", row.MachineCode); // untouched.
        Assert.Equal(ConnectorConfigSource.Operator, row.Source); // never flipped to Seeded.
        Assert.Single(warnings); // still warns, exactly as before this task.
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
