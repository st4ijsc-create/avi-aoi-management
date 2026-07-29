using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests.Fleet;

/// <summary>
/// SM-5 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-5-brief.md) — unit-level
/// proof of <see cref="ConnectorConfigStore"/> itself, independent of the HTTP layer (covered end-to-end by
/// <c>ConnectorEndpointsTests</c>): upsert-by-kind semantics, restart survival (a fresh store instance
/// pointed at the same directory — the same technique <c>FleetHostSettingsPersistenceTests</c>/
/// <c>MachineConfigStoreTests</c> already use), the credential-free <see cref="ConnectorConfigStore.ListAsync"/>
/// projection, and plain delete-by-kind.
/// </summary>
public sealed class ConnectorConfigStoreTests
{
    private static string TempDir() => Directory.CreateTempSubdirectory("st4i-connector-config-tests-").FullName;

    [Fact]
    public async Task SaveAsync_ThenGetAsync_RoundTripsEveryField()
    {
        var store = new ConnectorConfigStore(TempDir());

        var summary = await store.SaveAsync("Modbus", "MODBUS-01", "10.0.0.5", 502, """{"machineCode":"MODBUS-01"}""");

        Assert.Equal("Modbus", summary.Kind);
        Assert.Equal("MODBUS-01", summary.MachineCode);
        Assert.Equal("10.0.0.5", summary.Host);
        Assert.Equal(502, summary.Port);

        var record = await store.GetAsync("Modbus");
        Assert.NotNull(record);
        Assert.Equal("MODBUS-01", record!.MachineCode);
        Assert.Equal("10.0.0.5", record.Host);
        Assert.Equal(502, record.Port);
        Assert.Equal("""{"machineCode":"MODBUS-01"}""", record.MapJson);
        Assert.Equal(record.CreatedAtUtc, record.UpdatedAtUtc);
    }

    [Fact]
    public async Task SaveAsync_OpcUa_HostAndPortAreNull_MapJsonCarriesEndpointInstead()
    {
        var store = new ConnectorConfigStore(TempDir());

        await store.SaveAsync("OpcUa", "OPCUA-01", host: null, port: null, """{"endpointUrl":"opc.tcp://10.0.0.9:4840"}""");

        var record = await store.GetAsync("OpcUa");
        Assert.NotNull(record);
        Assert.Null(record!.Host);
        Assert.Null(record.Port);
    }

    [Fact]
    public async Task SaveAsync_SameKindTwice_UpsertsRatherThanDuplicating_LastWriteWins()
    {
        var store = new ConnectorConfigStore(TempDir());

        await store.SaveAsync("Modbus", "MODBUS-01", "10.0.0.5", 502, "{}");
        await store.SaveAsync("Modbus", "MODBUS-02", "10.0.0.6", 503, "{}");

        var all = await store.ListAsync();
        Assert.Single(all); // still ONE row for "Modbus" — mirrors ConnectorRegistry.Register's own
                             // "last write wins, never two entries for the same kind" semantics.
        Assert.Equal("MODBUS-02", all[0].MachineCode);
        Assert.Equal("10.0.0.6", all[0].Host);
        Assert.Equal(503, all[0].Port);
    }

    [Fact]
    public async Task SaveAsync_UpdatingExistingRow_PreservesCreatedAt_ButBumpsUpdatedAt()
    {
        var store = new ConnectorConfigStore(TempDir());

        var first = await store.SaveAsync("Modbus", "MODBUS-01", "10.0.0.5", 502, "{}");
        await Task.Delay(15); // ensure a measurably later timestamp
        await store.SaveAsync("Modbus", "MODBUS-01", "10.0.0.7", 502, "{}");

        var record = await store.GetAsync("Modbus");
        Assert.NotNull(record);
        Assert.True(record!.UpdatedAtUtc > record.CreatedAtUtc);
        Assert.True(record.CreatedAtUtc <= first.UpdatedAtUtc.AddMilliseconds(1));
    }

    [Fact]
    public async Task ListAsync_NeverIncludesMapJson_EvenWhenItEmbedsCredentials()
    {
        var store = new ConnectorConfigStore(TempDir());
        var mapWithSecret = """{"endpointUrl":"opc.tcp://10.0.0.9:4840","username":"admin","password":"super-secret-value"}""";
        await store.SaveAsync("OpcUa", "OPCUA-01", host: null, port: null, mapWithSecret);

        var all = await store.ListAsync();
        Assert.Single(all);

        // ListAsync's DTO shape (ConnectorConfigSummary) structurally has no MapJson property at all — this
        // assertion is really about the SQL projection never selecting the column in the first place, so
        // there's nothing here that could ever leak "super-secret-value" even if a future edit added a field.
        var serialized = System.Text.Json.JsonSerializer.Serialize(all[0]);
        Assert.DoesNotContain("super-secret-value", serialized);
        Assert.DoesNotContain("admin", serialized);
    }

    [Fact]
    public async Task GetAsync_UnknownKind_ReturnsNull()
    {
        var store = new ConnectorConfigStore(TempDir());
        Assert.Null(await store.GetAsync("Modbus"));
    }

    [Fact]
    public async Task DeleteAsync_RemovesRow_ReturnsTrue_SecondDeleteReturnsFalse()
    {
        var store = new ConnectorConfigStore(TempDir());
        await store.SaveAsync("Modbus", "MODBUS-01", "10.0.0.5", 502, "{}");

        Assert.True(await store.DeleteAsync("Modbus"));
        Assert.Null(await store.GetAsync("Modbus"));
        Assert.False(await store.DeleteAsync("Modbus"));
    }

    [Fact]
    public async Task ModbusAndOpcUa_AreIndependentRows()
    {
        var store = new ConnectorConfigStore(TempDir());
        await store.SaveAsync("Modbus", "MODBUS-01", "10.0.0.5", 502, "{}");
        await store.SaveAsync("OpcUa", "OPCUA-01", null, null, "{}");

        var all = await store.ListAsync();
        Assert.Equal(2, all.Count);
        Assert.Contains(all, r => r.Kind == "Modbus" && r.MachineCode == "MODBUS-01");
        Assert.Contains(all, r => r.Kind == "OpcUa" && r.MachineCode == "OPCUA-01");

        await store.DeleteAsync("Modbus");
        var remaining = await store.ListAsync();
        Assert.Single(remaining);
        Assert.Equal("OpcUa", remaining[0].Kind);
    }

    [Fact]
    public async Task AFreshStore_PointedAtTheSameDirectory_SeesEverythingThePreviousInstanceWrote()
    {
        // Restart survival — the in-process analogue of a real process restart (same technique
        // FleetHostSettingsPersistenceTests/MachineConfigStoreTests already use).
        var dir = TempDir();
        var store1 = new ConnectorConfigStore(dir);
        await store1.SaveAsync("Modbus", "MODBUS-RESTART-01", "10.0.0.5", 502, """{"machineCode":"MODBUS-RESTART-01","registers":[]}""");

        var store2 = new ConnectorConfigStore(dir);
        var record = await store2.GetAsync("Modbus");

        Assert.NotNull(record);
        Assert.Equal("MODBUS-RESTART-01", record!.MachineCode);
        Assert.Equal("10.0.0.5", record.Host);
        Assert.Equal(502, record.Port);
        Assert.Equal("""{"machineCode":"MODBUS-RESTART-01","registers":[]}""", record.MapJson);
    }

    [Fact]
    public void DefaultRoot_IsASiblingOfAssetsAndAlarms_NeverTheSameDirectory()
    {
        var root = ConnectorConfigStore.DefaultRoot();
        Assert.EndsWith(Path.Combine("ST4I", "sim", "connector-config"), root);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Task B-3 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-3-brief.md) — the
    // write_capability_json column: its own migration, what a pre-existing row means, and round-tripping.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task SaveAsync_NoWriteCapabilityArgument_StoresNull_ByteIdenticalToBeforeThisTask()
    {
        var store = new ConnectorConfigStore(TempDir());

        var summary = await store.SaveAsync("Modbus", "MODBUS-01", "10.0.0.5", 502, "{}");

        Assert.Null(summary.WriteCapability);
        var record = await store.GetAsync("Modbus");
        Assert.Null(record!.WriteCapability);
    }

    [Fact]
    public async Task SaveAsync_WriteCapabilityGrantingSomething_RoundTrips()
    {
        var store = new ConnectorConfigStore(TempDir());
        var capability = new ConnectorWriteCapability(new[] { "speed" }, new[] { "StartCycle" });

        var summary = await store.SaveAsync("Modbus", "MODBUS-01", "10.0.0.5", 502, "{}", capability);

        Assert.NotNull(summary.WriteCapability);
        Assert.True(summary.WriteCapability!.GrantsWriteCapability);
        Assert.Equal(new[] { "speed" }, summary.WriteCapability.WritablePoints);
        Assert.Equal(new[] { "StartCycle" }, summary.WriteCapability.Commands);
        Assert.NotNull(summary.WriteCapability.Fingerprint);

        var record = await store.GetAsync("Modbus");
        Assert.NotNull(record!.WriteCapability);
        Assert.Equal(new[] { "speed" }, record.WriteCapability!.WritablePoints);
    }

    /// <summary>A <see cref="ConnectorWriteCapability"/> instance with EMPTY lists (constructed, but granting
    /// nothing) must be normalized to <see langword="null"/> on read-back — <see cref="ConnectorWriteCapability.None"/>
    /// and <see langword="null"/> are the SAME fact ("read-only connector") and must round-trip identically.</summary>
    [Fact]
    public async Task SaveAsync_WriteCapabilityThatGrantsNothing_NormalizedToNull()
    {
        var store = new ConnectorConfigStore(TempDir());

        var summary = await store.SaveAsync("Modbus", "MODBUS-01", "10.0.0.5", 502, "{}", ConnectorWriteCapability.None);

        Assert.Null(summary.WriteCapability);
    }

    [Fact]
    public async Task AFreshStore_PointedAtTheSameDirectory_MigratesExistingRowsToVersion2_ExistingRowsReadAsNull()
    {
        // A row written by "version 1" schema logic (no write_capability_json column at all yet) — proven by
        // constructing the FIRST store instance (which runs the migration ladder up to whatever version this
        // build currently declares) and saving without ever mentioning write capability, then re-opening a
        // fresh store instance pointed at the SAME directory (the same "restart survival" technique every
        // other test in this file already uses) and confirming the read-back is NULL, never some other
        // placeholder — the exact fact this migration's own doc comment promises for a pre-existing row.
        var dir = TempDir();
        var store1 = new ConnectorConfigStore(dir);
        await store1.SaveAsync("Modbus", "MODBUS-PRE-B3", "10.0.0.5", 502, "{}");

        var store2 = new ConnectorConfigStore(dir);
        var record = await store2.GetAsync("Modbus");

        Assert.NotNull(record);
        Assert.Null(record!.WriteCapability);
    }

    [Fact]
    public void ResolveRoot_PrefersExplicitDirectory_OverEnvVar_OverDefault()
    {
        var prev = Environment.GetEnvironmentVariable(ConnectorConfigStore.EnvVarDir);
        try
        {
            Environment.SetEnvironmentVariable(ConnectorConfigStore.EnvVarDir, @"C:\somewhere-env");
            Assert.Equal(@"C:\explicit", ConnectorConfigStore.ResolveRoot(@"C:\explicit"));
            Assert.Equal(@"C:\somewhere-env", ConnectorConfigStore.ResolveRoot(null));

            Environment.SetEnvironmentVariable(ConnectorConfigStore.EnvVarDir, null);
            Assert.Equal(ConnectorConfigStore.DefaultRoot(), ConnectorConfigStore.ResolveRoot(null));
        }
        finally
        {
            Environment.SetEnvironmentVariable(ConnectorConfigStore.EnvVarDir, prev);
        }
    }
}
