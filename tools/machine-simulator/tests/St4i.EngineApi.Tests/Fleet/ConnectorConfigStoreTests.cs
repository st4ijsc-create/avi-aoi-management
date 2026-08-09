using Microsoft.Data.Sqlite;
using St4i.Connector.Abstractions.Models;
using St4i.EngineApi.Fleet;
using St4i.EngineApi.Tests.Auth;
using Xunit;

namespace St4i.EngineApi.Tests.Fleet;

/// <summary>
/// SM-5 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-5-brief.md) — unit-level
/// proof of <see cref="ConnectorConfigStore"/> itself, independent of the HTTP layer (covered end-to-end by
/// <c>ConnectorEndpointsTests</c>): upsert-by-kind semantics, restart survival (a fresh store instance
/// pointed at the same directory — the same technique <c>FleetHostSettingsPersistenceTests</c>/
/// <c>MachineConfigStoreTests</c> already use), the credential-free <see cref="ConnectorConfigStore.ListAsync"/>
/// projection, and plain delete-by-kind.
///
/// <para>🔴 <b>Fix round 4 (branch re-review I-2) — this class WRITES the process-wide
/// <c>ST4I_CONNECTOR_CONFIG_DIR</c> and was the only writer of it outside the serialized collection.</b>
/// <c>ResolveRoot_PrefersExplicitDirectory_OverEnvVar_OverDefault</c> below sets it to
/// <c>C:\somewhere-env</c>, then to <c>null</c>, then restores. <b>EIGHTEEN other classes</b> in this
/// suite set the same variable and all eighteen are collected.
/// <para>🔴 <b>That number has now been wrong twice, in opposite directions, and the second time it was
/// wrong because it was INHERITED rather than measured.</b> This comment first said TWENTY-ONE, which I
/// took from a review finding; the next review measured NINETEEN. Re-measured here, with the instrument
/// named: nineteen FILES under <c>tests/St4i.EngineApi.Tests</c> contain a non-<c>///</c>
/// <c>SetEnvironmentVariable</c> of <c>ST4I_CONNECTOR_CONFIG_DIR</c>/<c>ConnectorConfigStore.EnvVarDir</c>,
/// each declaring exactly one test class, and <b>that nineteen includes THIS file</b> — so the sentence's
/// own subject, "other classes", is EIGHTEEN. (The same grep counted by LINES gives 38, because most
/// classes set and restore.) All eighteen carry the attribute; verified by reading the
/// <c>[Collection]</c> line of each.
/// <b>The lesson is §8.1(d), landing on a reviewer:</b> a number that arrives inside a finding is a
/// CLAIM, not a premise, and this one crossed three artefacts before anyone re-measured it.</para> <c>Program.cs</c> reads it at startup and
/// <c>ConnectorConfigStore</c>'s constructor does <c>Directory.CreateDirectory(root)</c> plus a SQLite
/// schema creation — so a host boot sampling this window either creates
/// <c>C:\somewhere-env\connector-config.db</c> on the developer's C: drive, or (on the <c>null</c> leg)
/// falls back to a real install's <c>%ProgramData%\ST4I\sim\connector-config</c>. The reverse race
/// fails this test's own assertion against another class's temp path.</para>
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
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
        Assert.Single(all); // still ONE row — both saves omit an instanceId, so both key on the DERIVED
                             // default ("Modbus"), mirroring ConnectorRegistry.Register's own last-write-wins
                             // semantics for one instance. Task D-1 note: this is no longer a statement about
                             // the KIND — two Modbus rows under two instance ids is now a supported, tested
                             // shape (TwoInstancesOfTheSameKind_AreTwoRows_...); what this pins is that the
                             // default identity did not change, which is what keeps every pre-D-1 caller
                             // writing exactly the row it always did.
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
        var capability = new ConnectorWriteCapability(
            new[] { new ConnectorWritablePointGrant("speed", "address:1", 0, 500) },
            new[] { new ConnectorCommandGrant("StartCycle", "coil:5") });

        var summary = await store.SaveAsync("Modbus", "MODBUS-01", "10.0.0.5", 502, "{}", capability);

        Assert.NotNull(summary.WriteCapability);
        Assert.True(summary.WriteCapability!.GrantsWriteCapability);
        var point = Assert.Single(summary.WriteCapability.WritablePoints);
        Assert.Equal("speed", point.Name);
        Assert.Equal("address:1", point.Target);
        Assert.Equal(0, point.Min);
        Assert.Equal(500, point.Max);
        var command = Assert.Single(summary.WriteCapability.Commands);
        Assert.Equal("StartCycle", command.Name);
        Assert.Equal("coil:5", command.Target);
        Assert.NotNull(summary.WriteCapability.Fingerprint);

        var record = await store.GetAsync("Modbus");
        Assert.NotNull(record!.WriteCapability);
        Assert.Equal("speed", Assert.Single(record.WriteCapability!.WritablePoints).Name);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fix round 1 (Important #1) — ComputeFingerprint must bind to bounds/targets, not just names. This is
    // the EXACT scenario the review reproduced: a map declaring "speed [0,500] + StartCycle@coil:5" and one
    // declaring "speed [0,65535] + StartCycle@coil:99" used to produce the IDENTICAL fingerprint (names-only
    // hash) — an operator's confirmation would have silently covered a widened limit and a re-pointed
    // command.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void ComputeFingerprint_WidenedLimit_ProducesDifferentFingerprint_SameNames()
    {
        var narrow = new ConnectorWriteCapability(
            new[] { new ConnectorWritablePointGrant("speed", "address:1", 0, 500) },
            new[] { new ConnectorCommandGrant("StartCycle", "coil:5") });
        var widened = new ConnectorWriteCapability(
            new[] { new ConnectorWritablePointGrant("speed", "address:1", 0, 65535) },
            new[] { new ConnectorCommandGrant("StartCycle", "coil:5") });

        Assert.NotEqual(narrow.ComputeFingerprint(), widened.ComputeFingerprint());
    }

    [Fact]
    public void ComputeFingerprint_RepointedCommand_ProducesDifferentFingerprint_SameNames()
    {
        var original = new ConnectorWriteCapability(
            new[] { new ConnectorWritablePointGrant("speed", "address:1", 0, 500) },
            new[] { new ConnectorCommandGrant("StartCycle", "coil:5") });
        var repointed = new ConnectorWriteCapability(
            new[] { new ConnectorWritablePointGrant("speed", "address:1", 0, 500) },
            new[] { new ConnectorCommandGrant("StartCycle", "coil:99") });

        Assert.NotEqual(original.ComputeFingerprint(), repointed.ComputeFingerprint());
    }

    [Fact]
    public void ComputeFingerprint_RepointedWritablePoint_ProducesDifferentFingerprint_SameNamesAndBounds()
    {
        var original = new ConnectorWriteCapability(
            new[] { new ConnectorWritablePointGrant("speed", "address:1", 0, 500) },
            Array.Empty<ConnectorCommandGrant>());
        var repointed = new ConnectorWriteCapability(
            new[] { new ConnectorWritablePointGrant("speed", "address:9", 0, 500) },
            Array.Empty<ConnectorCommandGrant>());

        Assert.NotEqual(original.ComputeFingerprint(), repointed.ComputeFingerprint());
    }

    [Fact]
    public void ComputeFingerprint_IdenticalCapability_ProducesTheSameFingerprint_OrderIndependent()
    {
        var a = new ConnectorWriteCapability(
            new[]
            {
                new ConnectorWritablePointGrant("speed", "address:1", 0, 500),
                new ConnectorWritablePointGrant("temp", "address:2", -40, 200),
            },
            new[] { new ConnectorCommandGrant("StartCycle", "coil:5") });
        // Same capability, writable points in a DIFFERENT order — the fingerprint must be order-independent
        // (sorted before hashing) so JSON array order in a re-pasted map never breaks an otherwise-identical
        // confirmation.
        var b = new ConnectorWriteCapability(
            new[]
            {
                new ConnectorWritablePointGrant("temp", "address:2", -40, 200),
                new ConnectorWritablePointGrant("speed", "address:1", 0, 500),
            },
            new[] { new ConnectorCommandGrant("StartCycle", "coil:5") });

        Assert.Equal(a.ComputeFingerprint(), b.ComputeFingerprint());
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

    // ─────────────────────────────────────────────────────────────────────
    // Task B-6 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-6-brief.md) — the `source`
    // column: its own migration (v3), what a pre-existing row means, and round-tripping.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task SaveAsync_NoSourceArgument_DefaultsToOperator_ByteIdenticalToBeforeThisTask()
    {
        var store = new ConnectorConfigStore(TempDir());

        var summary = await store.SaveAsync("Modbus", "MODBUS-01", "10.0.0.5", 502, "{}");
        Assert.Equal(ConnectorConfigSource.Operator, summary.Source);

        var record = await store.GetAsync("Modbus");
        Assert.Equal(ConnectorConfigSource.Operator, record!.Source);
    }

    [Fact]
    public async Task SaveAsync_ExplicitSeededSource_RoundTrips()
    {
        var store = new ConnectorConfigStore(TempDir());

        var summary = await store.SaveAsync(
            "Modbus", "MODBUS-01", "10.0.0.5", 502, "{}", source: ConnectorConfigSource.Seeded);
        Assert.Equal(ConnectorConfigSource.Seeded, summary.Source);

        var record = await store.GetAsync("Modbus");
        Assert.Equal(ConnectorConfigSource.Seeded, record!.Source);

        var listed = await store.ListAsync();
        Assert.Equal(ConnectorConfigSource.Seeded, Assert.Single(listed).Source);
    }

    [Fact]
    public async Task SaveAsync_ReSavingSameKind_UpdatesSource_LastWriteWins()
    {
        var store = new ConnectorConfigStore(TempDir());

        await store.SaveAsync("Modbus", "MODBUS-01", "10.0.0.5", 502, "{}", source: ConnectorConfigSource.Seeded);
        var updated = await store.SaveAsync("Modbus", "MODBUS-02", "10.0.0.6", 503, "{}"); // operator save, default source

        Assert.Equal(ConnectorConfigSource.Operator, updated.Source);
        var record = await store.GetAsync("Modbus");
        Assert.Equal(ConnectorConfigSource.Operator, record!.Source);
    }

    /// <summary>The load-bearing migration-boundary assertion, mirroring
    /// <see cref="AFreshStore_PointedAtTheSameDirectory_MigratesExistingRowsToVersion2_ExistingRowsReadAsNull"/>
    /// exactly: a row written by "version 2" schema logic (no `source` column at all yet) — proven by
    /// constructing the FIRST store instance and saving without ever mentioning source, then re-opening a
    /// fresh store instance pointed at the SAME directory and confirming the read-back is
    /// <see cref="ConnectorConfigSource.Operator"/>, the exact fact this migration's own doc comment
    /// promises for a pre-existing row (SQLite's ADD COLUMN with a literal DEFAULT applies it to every
    /// existing row at migration time).</summary>
    [Fact]
    public async Task AFreshStore_PointedAtTheSameDirectory_MigratesExistingRowsToVersion3_ExistingRowsReadAsOperator()
    {
        var dir = TempDir();
        var store1 = new ConnectorConfigStore(dir);
        await store1.SaveAsync("Modbus", "MODBUS-PRE-B6", "10.0.0.5", 502, "{}");

        var store2 = new ConnectorConfigStore(dir);
        var record = await store2.GetAsync("Modbus");

        Assert.NotNull(record);
        Assert.Equal(ConnectorConfigSource.Operator, record!.Source);

        var summary = Assert.Single(await store2.ListAsync());
        Assert.Equal(ConnectorConfigSource.Operator, summary.Source);
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

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 Task D-1 (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-1-brief.md) — migration v4:
    // `kind TEXT PRIMARY KEY` becomes `instance_id TEXT PRIMARY KEY`, and an installed system's real
    // connector rows must survive it with their behaviour intact.
    //
    // These tests build a GENUINE version-3 database with raw SQL — the pre-D-1 schema, byte for byte,
    // including its own column ORDER — rather than re-opening a store this build already created. That
    // distinction is the whole point: the two pre-existing "migrates existing rows to version N" tests in
    // this file (v2 and v3) construct their "old" database by calling THIS build's own constructor, which
    // runs the ladder to the CURRENT version first, so they can never actually exercise a migration from an
    // older schema. They pin what a fresh install reads back; they cannot see a rung that loses data. A
    // migration that dropped every row would pass both of them.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>The exact pre-D-1 (migration v3) schema, including its own declaration order —
    /// write_capability_json and source were APPENDED by v2/v3's ALTER TABLE, so they sit after the
    /// timestamps, whereas v4's rebuilt table groups them before. That difference is deliberate here: it is
    /// what makes `INSERT INTO ... SELECT *` (positional) produce visibly wrong rows, so this fixture would
    /// catch a rebuild written that way.</summary>
    private static void CreateVersion3Database(string dir)
    {
        Directory.CreateDirectory(dir);
        using var connection = new SqliteConnection($"Data Source={Path.Combine(dir, "connector-config.db")}");
        connection.Open();
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            CREATE TABLE connector_configs (
              kind TEXT PRIMARY KEY,
              machine_code TEXT NOT NULL,
              host TEXT NULL,
              port INTEGER NULL,
              map_json TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              write_capability_json TEXT NULL,
              source TEXT NOT NULL DEFAULT 'Operator');
            PRAGMA user_version = 3;
            """;
        cmd.ExecuteNonQuery();
    }

    private static void InsertVersion3Row(
        string dir, string kind, string machineCode, string? host, int? port, string mapJson,
        string? writeCapabilityJson, string source, string createdAt, string updatedAt)
    {
        using var connection = new SqliteConnection($"Data Source={Path.Combine(dir, "connector-config.db")}");
        connection.Open();
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            INSERT INTO connector_configs (kind, machine_code, host, port, map_json, created_at, updated_at, write_capability_json, source)
            VALUES (@kind, @machine_code, @host, @port, @map_json, @created_at, @updated_at, @write_capability_json, @source);
            """;
        cmd.Parameters.AddWithValue("@kind", kind);
        cmd.Parameters.AddWithValue("@machine_code", machineCode);
        cmd.Parameters.AddWithValue("@host", (object?)host ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@port", (object?)port ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@map_json", mapJson);
        cmd.Parameters.AddWithValue("@created_at", createdAt);
        cmd.Parameters.AddWithValue("@updated_at", updatedAt);
        cmd.Parameters.AddWithValue("@write_capability_json", (object?)writeCapabilityJson ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@source", source);
        cmd.ExecuteNonQuery();
    }

    private static long ReadUserVersion(string dir)
    {
        using var connection = new SqliteConnection($"Data Source={Path.Combine(dir, "connector-config.db")}");
        connection.Open();
        using var cmd = connection.CreateCommand();
        cmd.CommandText = "PRAGMA user_version;";
        return Convert.ToInt64(cmd.ExecuteScalar(), System.Globalization.CultureInfo.InvariantCulture);
    }

    [Fact]
    public async Task MigrationV4_AGenuineVersion3Database_KeepsEveryRow_EveryField_AndGivesEachOneItsKindAsItsInstanceId()
    {
        var dir = TempDir();
        CreateVersion3Database(dir);

        var capability = new ConnectorWriteCapability(
            new[] { new ConnectorWritablePointGrant("speed", "address:40001", 0, 500) },
            new[] { new ConnectorCommandGrant("StartCycle", "coil:5") });

        InsertVersion3Row(
            dir, kind: "Modbus", machineCode: "MB-LEGACY-01", host: "10.0.0.5", port: 502,
            mapJson: """{"machineCode":"MB-LEGACY-01","registers":[]}""",
            writeCapabilityJson: capability.ToJson(), source: "Operator",
            createdAt: "2026-01-02T03:04:05.0000000+00:00", updatedAt: "2026-02-03T04:05:06.0000000+00:00");
        InsertVersion3Row(
            dir, kind: "OpcUa", machineCode: "UA-LEGACY-01", host: null, port: null,
            mapJson: """{"endpointUrl":"opc.tcp://10.0.0.9:4840"}""",
            writeCapabilityJson: null, source: "Seeded",
            createdAt: "2026-03-04T05:06:07.0000000+00:00", updatedAt: "2026-04-05T06:07:08.0000000+00:00");

        // Opening the store is what runs the ladder — the same thing a product upgrade does on first boot.
        var store = new ConnectorConfigStore(dir);

        // 🔴 Task D-7b raised the ladder's top rung 4 -> 5 (bus_instance_id/bus_settings_json). The number is
        // the CURRENT top, not "the rung this test is about": a v3 database opened by this build must land on
        // the newest rung, and an assertion frozen at 4 would go green while the last rung silently never ran.
        Assert.Equal(5, ReadUserVersion(dir));

        var all = await store.ListAsync();
        Assert.Equal(2, all.Count);

        // Addressed by the SAME string an operator/UI/DELETE URL already used before the upgrade.
        var modbus = await store.GetAsync("Modbus");
        Assert.NotNull(modbus);
        Assert.Equal("Modbus", modbus!.EffectiveInstanceId);
        Assert.Equal("Modbus", modbus.InstanceId);
        Assert.Equal("Modbus", modbus.Kind);
        Assert.Equal("MB-LEGACY-01", modbus.MachineCode);
        Assert.Equal("10.0.0.5", modbus.Host);
        Assert.Equal(502, modbus.Port);
        Assert.Equal("""{"machineCode":"MB-LEGACY-01","registers":[]}""", modbus.MapJson);
        Assert.Equal(ConnectorConfigSource.Operator, modbus.Source);
        Assert.Equal(DateTimeOffset.Parse("2026-01-02T03:04:05.0000000+00:00", System.Globalization.CultureInfo.InvariantCulture), modbus.CreatedAtUtc);
        Assert.Equal(DateTimeOffset.Parse("2026-02-03T04:05:06.0000000+00:00", System.Globalization.CultureInfo.InvariantCulture), modbus.UpdatedAtUtc);

        // The write capability survives the rebuild intact — this is the field an operator already
        // deliberately confirmed, so losing or corrupting it would silently change what the product
        // believes it is allowed to command.
        Assert.NotNull(modbus.WriteCapability);
        Assert.Equal(capability.ComputeFingerprint(), modbus.WriteCapability!.ComputeFingerprint());

        var opcUa = await store.GetAsync("OpcUa");
        Assert.NotNull(opcUa);
        Assert.Equal("OpcUa", opcUa!.EffectiveInstanceId);
        Assert.Equal("UA-LEGACY-01", opcUa.MachineCode);
        Assert.Null(opcUa.Host);
        Assert.Null(opcUa.Port);
        Assert.Null(opcUa.WriteCapability);
        // The Source provenance rule Đợt B added (Seeded vs Operator) must cross this rung intact —
        // ConnectorConfigVisibilitySeeder and Program.cs's startup loop both branch on it, so a row that
        // came out the far side mislabelled would either start warning every boot or stop protecting an
        // operator's own row.
        Assert.Equal(ConnectorConfigSource.Seeded, opcUa.Source);
        Assert.Equal("""{"endpointUrl":"opc.tcp://10.0.0.9:4840"}""", opcUa.MapJson);
    }

    [Fact]
    public async Task MigrationV4_AMigratedRow_BehavesIdentically_ASameKindSaveStillUpsertsIt_RatherThanAddingASecond()
    {
        // "Existing rows must survive with their behaviour intact" — not just their bytes. The behaviour a
        // pre-D-1 install depends on is that saving the same kind again UPDATES its one row; that only
        // stays true after the key change because the migrated row's instance id is its kind and SaveAsync
        // defaults the instance id the same way.
        var dir = TempDir();
        CreateVersion3Database(dir);
        InsertVersion3Row(
            dir, "Modbus", "MB-LEGACY-01", "10.0.0.5", 502, "{}", null, "Operator",
            "2026-01-02T03:04:05.0000000+00:00", "2026-01-02T03:04:05.0000000+00:00");

        var store = new ConnectorConfigStore(dir);
        await store.SaveAsync("Modbus", "MB-LEGACY-01", "10.0.0.9", 5020, """{"updated":true}""");

        var all = await store.ListAsync();
        var only = Assert.Single(all);
        Assert.Equal("Modbus", only.EffectiveInstanceId);
        Assert.Equal("10.0.0.9", only.Host);
        Assert.Equal(5020, only.Port);

        var record = await store.GetAsync("Modbus");
        // created_at is preserved across the upsert exactly as it was before D-1 — proof the row was
        // UPDATED in place, not deleted and re-inserted by the migration or by the save.
        Assert.Equal(DateTimeOffset.Parse("2026-01-02T03:04:05.0000000+00:00", System.Globalization.CultureInfo.InvariantCulture), record!.CreatedAtUtc);
    }

    [Fact]
    public async Task MigrationV4_AnEmptyVersion3Database_MigratesCleanly_AndIsImmediatelyUsable()
    {
        // The overwhelmingly common upgrade shape: the store file exists (something constructed it once)
        // but holds no connector at all. A rebuild that assumed at least one row, or that left the renamed
        // table in a half state, would break every install that never configured a connector.
        var dir = TempDir();
        CreateVersion3Database(dir);

        var store = new ConnectorConfigStore(dir);

        // 🔴 Task D-7b — see the sibling test above for why this is the ladder's current top rung, not 4.
        Assert.Equal(5, ReadUserVersion(dir));
        Assert.Empty(await store.ListAsync());

        await store.SaveAsync("Modbus", "MB-AFTER-UPGRADE", "10.0.0.5", 502, "{}");
        Assert.Equal("Modbus", Assert.Single(await store.ListAsync()).EffectiveInstanceId);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 Task D-1 — two connectors of ONE kind, side by side. Before this task the schema itself made this
    // impossible (`kind TEXT PRIMARY KEY`), which is one of the two independent structural blocks on
    // RS-485 multidrop the blueprint names.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task TwoInstancesOfTheSameKind_AreTwoRows_IndependentlyReadable_AndIndependentlyDeletable()
    {
        var store = new ConnectorConfigStore(TempDir());

        var a = await store.SaveAsync("Modbus", "MB-A", "10.0.0.5", 502, """{"a":1}""", instanceId: "modbus-line-a");
        var b = await store.SaveAsync("Modbus", "MB-B", "10.0.0.6", 502, """{"b":1}""", instanceId: "modbus-line-b");

        Assert.Equal("modbus-line-a", a.EffectiveInstanceId);
        Assert.Equal("modbus-line-b", b.EffectiveInstanceId);
        Assert.Equal(2, (await store.ListAsync()).Count);

        var readA = await store.GetAsync("modbus-line-a");
        var readB = await store.GetAsync("modbus-line-b");
        Assert.Equal("MB-A", readA!.MachineCode);
        Assert.Equal("MB-B", readB!.MachineCode);
        Assert.Equal("""{"a":1}""", readA.MapJson);
        Assert.Equal("""{"b":1}""", readB.MapJson);
        // Both are Modbus — identity and protocol are genuinely separate now, not two names for one thing.
        Assert.Equal("Modbus", readA.Kind);
        Assert.Equal("Modbus", readB.Kind);

        // Removing one must never take its sibling with it — the failure a DELETE still keyed on `kind`
        // would produce, and the reason DeleteAsync moved to the primary key.
        Assert.True(await store.DeleteAsync("modbus-line-a"));
        var remaining = Assert.Single(await store.ListAsync());
        Assert.Equal("modbus-line-b", remaining.EffectiveInstanceId);
        Assert.Equal("MB-B", remaining.MachineCode);
    }

    [Fact]
    public async Task SaveAsync_NormalizesTheInstanceIdTheSameWayTheRegistryAndTheDeleteRouteDo()
    {
        // 🔴 D-1 review, m1. ConnectorRegistry.Register and DELETE /v1/connectors/{instanceId} both fold an
        // id through DriverKinds.Normalize; SaveAsync only Trim()med it. A row written with
        // instance_id = "modbus" would therefore be UNDELETABLE — the DELETE route normalizes its segment to
        // "Modbus", GetAsync misses, and the operator gets a 404 for a row they can see in
        // GET /v1/connectors/configured. The store, the registry and the route must all fold identically or
        // the identity has two spellings.
        var store = new ConnectorConfigStore(TempDir());

        var saved = await store.SaveAsync("Modbus", "MB-NORM-01", "10.0.0.5", 502, "{}", instanceId: "modbus");
        Assert.Equal(DriverKinds.Modbus, saved.EffectiveInstanceId);

        // Addressable by the canonical spelling — which is the one the DELETE route will hand GetAsync.
        Assert.NotNull(await store.GetAsync(DriverKinds.Modbus));

        // And a second save under yet another casing is the SAME row, never a second one.
        await store.SaveAsync("Modbus", "MB-NORM-01", "10.0.0.6", 502, "{}", instanceId: "MODBUS");
        var only = Assert.Single(await store.ListAsync());
        Assert.Equal(DriverKinds.Modbus, only.EffectiveInstanceId);
        Assert.Equal("10.0.0.6", only.Host);

        // A third-party id stays case-SENSITIVE, exactly as DriverKinds documents — normalization must not
        // become a blanket lowercase that folds two genuinely different vendor connectors together.
        await store.SaveAsync("Modbus", "MB-NORM-02", "10.0.0.7", 502, "{}", instanceId: "vendor.acme.weld");
        await store.SaveAsync("Modbus", "MB-NORM-03", "10.0.0.8", 502, "{}", instanceId: "Vendor.Acme.Weld");
        Assert.Equal(3, (await store.ListAsync()).Count);
    }

    [Fact]
    public async Task ListAsync_StillNeverSelectsMapJson_EvenNowThatItCarriesAnInstanceId()
    {
        // The credential-free projection is load-bearing (an OPC-UA map may embed a username/password) and
        // its SELECT list was edited by this task — re-pinned here rather than assumed, since a column
        // added to that list by accident is exactly the kind of change that reads as harmless.
        var mapWithSecret = """{"endpointUrl":"opc.tcp://10.0.0.9:4840","username":"admin","password":"hunter2"}""";
        var store = new ConnectorConfigStore(TempDir());
        await store.SaveAsync("OpcUa", "UA-01", null, null, mapWithSecret, instanceId: "opcua-cell-1");

        var summary = Assert.Single(await store.ListAsync());
        Assert.Equal("opcua-cell-1", summary.EffectiveInstanceId);
        Assert.DoesNotContain("hunter2", System.Text.Json.JsonSerializer.Serialize(summary));
    }
}
