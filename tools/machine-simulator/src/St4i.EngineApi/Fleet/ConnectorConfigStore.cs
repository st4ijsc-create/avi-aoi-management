using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace St4i.EngineApi.Fleet;

/// <summary>
/// Task B-3 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-3-brief.md) — what a parsed map
/// declares it grants, in the ONE shape shared by both protocols (a
/// <see cref="St4i.EdgeCore.Drivers.Modbus.ModbusRegisterMap"/>'s own <c>WritablePointNames</c>/<c>CommandNames</c>,
/// or an <see cref="St4i.EdgeCore.Drivers.OpcUa.OpcUaNodeMap"/>'s own, adapted into this generic shape by
/// <see cref="ConnectorConfigValidation"/> — the same place that already adapts either protocol's own parsed
/// map into the generic <see cref="ConnectorConfigValidation.ConnectorValidationResult"/>).
///
/// <para><b>Why this surfaces as its own <see cref="ConnectorConfigStore"/> COLUMN, not left inside the
/// opaque <see cref="ConnectorConfigRecord.MapJson"/> blob</b> (the brief's own "decide, and justify"
/// question): <see cref="ConnectorConfigStore"/>'s whole design point is that <c>map_json</c> is NEVER even
/// <c>SELECT</c>ed by <see cref="ConnectorConfigStore.ListAsync"/> — it may embed OPC-UA credentials, so the
/// credential-free projection structurally cannot include it. If write-capability info lived only inside that
/// blob, <c>GET /v1/connectors/configured</c> (the one place an operator/engineer can see what is
/// CONFIGURED, credential-free) could never show "this connector can write to a device" at all — the exact
/// visibility the batch's own safety framing calls for ("the map file is the entire safety boundary" argues
/// FOR maximum visibility of what a map grants, not less). Re-parsing the protocol-specific map JSON on every
/// list call is also a non-option: <see cref="ConnectorConfigStore"/> is deliberately protocol-agnostic (it
/// has never referenced <c>St4i.EdgeCore</c>'s Modbus/OPC-UA types, and doing so here would break that
/// layering just to recompute a fact the caller already computed once at save time). So the CALLER
/// (<see cref="ConnectorConfigValidation"/>/the save endpoint) computes this once, from the map it already
/// parsed, and <see cref="ConnectorConfigStore.SaveAsync"/> simply persists what it's told — mirroring exactly
/// how <c>machine_code</c>/<c>host</c>/<c>port</c> already work (also caller-computed facts about the opaque
/// blob, stored as their own columns for exactly this reason).</para>
///
/// <para><b>What a pre-existing row means</b> (the <c>PRAGMA user_version</c> ladder's own required
/// question): <c>write_capability_json</c> is added by migration version 2 as a nullable column with NO
/// default expression — SQLite's own <c>ALTER TABLE ... ADD COLUMN</c> rule for a nullable column with no
/// <c>DEFAULT</c> sets every EXISTING row's new column to <c>NULL</c>. <see langword="null"/> here means
/// exactly "declares no write/command capability" — which is CORRECT, not merely a safe placeholder, for
/// every row written before this task existed: no schema before Task B-3 had any way to declare a writable
/// point or command at all, so every pre-existing persisted map is, in fact, read-only.</para>
/// </summary>
public sealed record ConnectorWriteCapability(IReadOnlyList<string> WritablePoints, IReadOnlyList<string> Commands)
{
    /// <summary>The value every read-only connector (every map before this task, and every map after it that
    /// simply never declares a writable point/command) is stored and reported as — equivalent to, but
    /// distinguishable in code from, a bare <see langword="null"/> reference for callers that want to always
    /// have a non-null instance in hand.</summary>
    public static readonly ConnectorWriteCapability None = new(Array.Empty<string>(), Array.Empty<string>());

    /// <summary><see langword="true"/> if and only if this map declares at least one writable point or
    /// command — the ONE structural (never semantic — no name is ever inspected) check the save gate and the
    /// persisted-column decision both hinge on.</summary>
    public bool GrantsCapability => WritablePoints.Count > 0 || Commands.Count > 0;

    /// <summary>
    /// Task B-3 — the value a caller must echo back to <c>POST /v1/connectors</c> to confirm a write/command
    /// grant, mirroring <c>POST /v1/site/identity/rotate</c>'s own echo-back pattern
    /// (<see cref="St4i.EngineApi.Endpoints.SiteEndpoints.RotateIdentityAsync"/>): deterministic (the SAME
    /// capability always produces the SAME fingerprint, order-independent — <see cref="WritablePoints"/>/
    /// <see cref="Commands"/> are sorted ordinally before hashing, so JSON array order in the pasted map
    /// never changes the required confirmation value), and a SHA-256 hex digest (uppercase, via
    /// <see cref="Convert.ToHexString(byte[])"/>) of "what would be granted" rather than the granted names
    /// themselves — the same "opaque token that can only be obtained by having just seen the real thing"
    /// shape a fingerprint already is elsewhere in this codebase (<c>DeviceIdentity.Fingerprint</c>,
    /// <c>SiteEndpoints.PemFingerprint</c>).
    /// </summary>
    public string ComputeFingerprint()
    {
        var sortedPoints = new List<string>(WritablePoints);
        sortedPoints.Sort(StringComparer.Ordinal);
        var sortedCommands = new List<string>(Commands);
        sortedCommands.Sort(StringComparer.Ordinal);

        var material = "points:" + string.Join(",", sortedPoints) + "|commands:" + string.Join(",", sortedCommands);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(material)));
    }

    /// <summary>The exact JSON this type is persisted as in <c>write_capability_json</c> — deliberately a
    /// plain <see cref="JsonSerializer.Serialize{TValue}(TValue, System.Text.Json.JsonSerializerOptions)"/> of
    /// this record (point/command names are never credentials, so no redaction concern applies here the way
    /// it does for <see cref="ConnectorConfigRecord.MapJson"/>).</summary>
    public string ToJson() => JsonSerializer.Serialize(this);

    public static ConnectorWriteCapability FromJson(string json) =>
        JsonSerializer.Deserialize<ConnectorWriteCapability>(json)
        ?? throw new InvalidOperationException("ConnectorWriteCapability.FromJson: JSON deserialized to null.");
}

/// <summary>
/// SM-5 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-5-brief.md) — the WRITE
/// path <c>connectors.json</c> never had: a persisted, operator-addable connector configuration for the two
/// protocols this build can actually drive (Modbus TCP, OPC-UA), surviving a restart, applied without
/// hand-editing a file.
///
/// <para><b>Why SQLite, not a JSON file (the brief's own required decision):</b> <c>connectors.json</c> is
/// explicitly documented (<see cref="St4i.EngineApi.Config.ConnectorsConfig"/>) as the HAND-EDITED,
/// read-at-startup-only config source — its whole design point is "a loose file next to the exe an operator
/// can hand-edit," which is precisely the deployment-script experience this task exists to replace. A
/// second hand-editable JSON file would just be a second connectors.json with extra steps. This class
/// instead reuses the SAME never-throws-on-the-hot-path, <c>PRAGMA user_version</c>-migration-ladder SQLite
/// shape every other DURABLE, API-WRITABLE store in this codebase already uses —
/// <see cref="St4i.EngineApi.AssetRegistry.AssetRegistryStore"/> (own file, own migration ladder, short-lived
/// WAL-mode connections) is the closest analogue and this class mirrors its shape line-for-line rather than
/// inventing a third persistence pattern (the brief's own instruction: "pick one of these and say why").
/// <see cref="St4i.EngineApi.Alarms.AlarmStore"/>/<see cref="St4i.EdgeCore.Site.SiteLinkStore"/>/
/// <see cref="St4i.EdgeCore.Site.BridgeSpool"/> are the other three precedents named in the brief; a plain
/// JSON file (like <see cref="St4i.EdgeCore.Infrastructure.FleetSettingsStore"/> for a handful of scalar
/// settings) would have been a defensible alternative for something this small, but SQLite was chosen
/// specifically so a FUTURE task that needs to support more than one connector per kind (see this class's
/// own "one row per kind" note below) or richer querying never has to migrate storage formats — the
/// migration ladder already exists from day one.</para>
///
/// <para><b>Primary key is the connector KIND, not a free-form per-machine id.</b> This is not a
/// simplification this class invented — it is how <see cref="ConnectorRegistry"/> ALREADY works:
/// <see cref="ConnectorRegistry.Register"/> keys purely on <c>IConnectorFactory.Kind</c> (normalized via
/// <see cref="St4i.Connector.Abstractions.Models.DriverKinds.Normalize"/>), so this build can only ever run
/// ONE live Modbus connector and ONE live OPC-UA connector at a time no matter how many rows a store held —
/// a second registration for the same kind silently replaces the first (see <c>ConnectorRegistry.Register</c>'s
/// own doc comment, "last write wins"). Persisting more than one row per kind would let an operator believe
/// two Modbus machines are configured when only the most-recently-applied one could ever actually run — a
/// dishonesty this whole batch exists to remove. <c>kind</c> is therefore this table's PRIMARY KEY: at most
/// one persisted row per protocol, exactly mirroring the single real machine this task's own brief opens
/// with ("an operator with ONE Modbus or OPC-UA machine").</para>
///
/// <para><b>Never-throws is NOT this class's contract</b> (unlike <see cref="AssetRegistryStore.UpsertAsync"/>,
/// which sits on FleetHost's hot registration path and must never fail a live registration over a database
/// hiccup). Every method here is reached ONLY from an explicit, caller-invoked HTTP mutation
/// (<c>POST</c>/<c>DELETE /v1/connectors</c>) or from startup config-loading (wrapped in its own try/catch at
/// the Program.cs call site, the same "never crash startup over a bad config source" posture every other
/// startup config load in this file already has) — a genuine SQLite failure here is allowed to surface as an
/// ordinary exception (→ the framework's default 500 for the HTTP paths), same as
/// <see cref="AssetRegistryStore.SetLifecycleAsync"/>/<see cref="St4i.EngineApi.Alarms.AlarmStore"/>'s own
/// explicit-mutation members already do.</para>
///
/// <para><b>Credentials never leave this class un-redacted.</b> <see cref="MapJson"/> — the opaque
/// register-map/node-map JSON text forwarded verbatim to <see cref="St4i.Connector.Abstractions.IConnectorFactory.TryCreate"/>
/// — MAY embed an OPC-UA username/password (<see cref="St4i.EdgeCore.Drivers.OpcUa.OpcUaNodeMap.Username"/>/
/// <see cref="St4i.EdgeCore.Drivers.OpcUa.OpcUaNodeMap.Password"/> are part of that same JSON shape). Every
/// PUBLIC read (<see cref="ListAsync"/>) uses a projection that never selects <c>map_json</c> at all — the
/// exact same discipline <c>GET /v1/connectors</c> already established (that endpoint's own doc comment:
/// "a factory's error message is operator-visible and settings may contain credentials"). Only
/// <see cref="LoadAllAsync"/> — the STARTUP wiring path, never exposed over HTTP — reads the full row
/// including <see cref="ConnectorConfigRecord.MapJson"/>.</para>
/// </summary>
public sealed record ConnectorConfigRecord(
    string Kind,
    string MachineCode,
    string? Host,
    int? Port,
    string MapJson,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc,
    ConnectorWriteCapability? WriteCapability = null);

/// <summary>The credential-free projection every caller OUTSIDE startup wiring gets — see
/// <see cref="ConnectorConfigStore"/>'s own doc comment for why <c>MapJson</c> (which may embed OPC-UA
/// credentials) is never part of this shape at all, not merely omitted at the DTO layer.
///
/// <para><see cref="WriteCapability"/> is safe to include here, unlike <c>MapJson</c> — a point/command
/// NAME is never a credential — see <see cref="ConnectorWriteCapability"/>'s own doc comment for why this is
/// its own column rather than staying locked inside the opaque map blob.</para></summary>
/// <param name="WriteCapability"><see cref="ConnectorWriteCapabilityDto"/> — deliberately the SAME shape
/// <c>POST /v1/connectors</c>'s own response uses (see that DTO's own doc comment), rather than the raw
/// <see cref="ConnectorWriteCapability"/> persistence record, so a caller reads one consistent capability
/// shape regardless of which endpoint it came from. <see langword="null"/> for a read-only connector — every
/// connector this build accepted before this task, and any map that simply declares neither.</param>
public sealed record ConnectorConfigSummary(
    string Kind,
    string MachineCode,
    string? Host,
    int? Port,
    DateTimeOffset UpdatedAtUtc,
    ConnectorWriteCapabilityDto? WriteCapability = null);

public sealed class ConnectorConfigStore
{
    /// <summary>Directory override — same idiom as <c>ST4I_ASSETS_DIR</c>/<c>ST4I_ALARMS_DIR</c>.</summary>
    public const string EnvVarDir = "ST4I_CONNECTOR_CONFIG_DIR";

    public string DbPath { get; }

    private static readonly string[] OpenPragmas =
    {
        "PRAGMA journal_mode=WAL;",
        "PRAGMA synchronous=NORMAL;",
        "PRAGMA busy_timeout=5000;",
        "PRAGMA foreign_keys=ON;",
    };

    private static readonly (int Version, string[] Statements)[] Migrations =
    {
        (1, new[]
        {
            """
            CREATE TABLE IF NOT EXISTS connector_configs (
              kind TEXT PRIMARY KEY,
              machine_code TEXT NOT NULL,
              host TEXT NULL,
              port INTEGER NULL,
              map_json TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL);
            """,
        }),
        // Task B-3 — see ConnectorWriteCapability's own doc comment for why this is its own column (never
        // folded into the opaque map_json blob) and what a pre-existing (pre-migration) row's NULL means:
        // SQLite's ADD COLUMN with no DEFAULT sets every existing row's new column to NULL, which is the
        // CORRECT value for a row written before this task — no schema before it could ever declare a
        // writable point or command, so every such row is, in fact, read-only.
        (2, new[]
        {
            "ALTER TABLE connector_configs ADD COLUMN write_capability_json TEXT NULL;",
        }),
    };

    public ConnectorConfigStore(string? directory = null)
    {
        var root = ResolveRoot(directory);
        Directory.CreateDirectory(root);
        DbPath = Path.Combine(root, "connector-config.db");
        EnsureSchema();
    }

    /// <summary>The default root: <c>%ProgramData%\ST4I\sim\connector-config</c> — a SIBLING of
    /// <c>...\sim\assets</c>/<c>...\sim\alarms</c>/<c>...\sim\wal</c>, never the same directory.</summary>
    public static string DefaultRoot() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ST4I", "sim", "connector-config");

    public static string ResolveRoot(string? directory = null)
    {
        if (!string.IsNullOrWhiteSpace(directory)) return directory;
        var env = Environment.GetEnvironmentVariable(EnvVarDir);
        return string.IsNullOrWhiteSpace(env) ? DefaultRoot() : env;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Schema
    // ─────────────────────────────────────────────────────────────────────

    private void EnsureSchema()
    {
        using var connection = OpenConnection();
        var currentVersion = GetUserVersion(connection);

        foreach (var (version, statements) in Migrations)
        {
            if (version <= currentVersion) continue;

            using var transaction = connection.BeginTransaction();
            foreach (var statement in statements)
            {
                using var cmd = connection.CreateCommand();
                cmd.Transaction = transaction;
                cmd.CommandText = statement;
                cmd.ExecuteNonQuery();
            }

            using (var pragmaCmd = connection.CreateCommand())
            {
                pragmaCmd.Transaction = transaction;
                // PRAGMA user_version does not support bind parameters; `version` always comes from this
                // fixed, code-defined migration ladder above (never external/user input).
                pragmaCmd.CommandText = $"PRAGMA user_version = {version};";
                pragmaCmd.ExecuteNonQuery();
            }

            transaction.Commit();
            currentVersion = version;
        }
    }

    private static long GetUserVersion(SqliteConnection connection)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = "PRAGMA user_version;";
        var result = cmd.ExecuteScalar();
        return result is null ? 0 : Convert.ToInt64(result, CultureInfo.InvariantCulture);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Connections
    // ─────────────────────────────────────────────────────────────────────

    private SqliteConnection OpenConnection()
    {
        var connection = new SqliteConnection($"Data Source={DbPath}");
        connection.Open();
        ApplyPragmas(connection);
        return connection;
    }

    private async Task<SqliteConnection> OpenConnectionAsync(CancellationToken ct)
    {
        var connection = new SqliteConnection($"Data Source={DbPath}");
        await connection.OpenAsync(ct).ConfigureAwait(false);
        await ApplyPragmasAsync(connection, ct).ConfigureAwait(false);
        return connection;
    }

    private static void ApplyPragmas(SqliteConnection connection)
    {
        foreach (var pragma in OpenPragmas)
        {
            using var cmd = connection.CreateCommand();
            cmd.CommandText = pragma;
            cmd.ExecuteNonQuery();
        }
    }

    private static async Task ApplyPragmasAsync(SqliteConnection connection, CancellationToken ct)
    {
        foreach (var pragma in OpenPragmas)
        {
            using var cmd = connection.CreateCommand();
            cmd.CommandText = pragma;
            await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Write — upsert by kind (last write wins, mirroring ConnectorRegistry.Register's own semantics).
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Inserts or replaces the ONE persisted row for <paramref name="kind"/> (already normalized by
    /// the caller — see <see cref="St4i.Connector.Abstractions.Models.DriverKinds.Normalize"/>). Returns the
    /// credential-free summary of what was just saved.</summary>
    /// <param name="writeCapability">Task B-3 — what the map being saved declares (already computed by the
    /// caller, which already parsed the map — see <see cref="ConnectorWriteCapability"/>'s own doc comment for
    /// why this store never derives it itself). <see langword="null"/> (the default) is stored and reported
    /// identically to <see cref="ConnectorWriteCapability.None"/> — every call site that predates this task
    /// (and every test of this method that never passes it) keeps saving a plain read-only connector, byte
    /// for byte.</param>
    public async Task<ConnectorConfigSummary> SaveAsync(
        string kind, string machineCode, string? host, int? port, string mapJson,
        ConnectorWriteCapability? writeCapability = null, CancellationToken ct = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(kind);
        ArgumentException.ThrowIfNullOrWhiteSpace(machineCode);
        ArgumentNullException.ThrowIfNull(mapJson);

        var nowIso = ToIso(DateTimeOffset.UtcNow);
        var normalizedCapability = (writeCapability is not null && writeCapability.GrantsCapability) ? writeCapability : null;
        var writeCapabilityJson = normalizedCapability?.ToJson();

        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            INSERT INTO connector_configs (kind, machine_code, host, port, map_json, write_capability_json, created_at, updated_at)
            VALUES (@kind, @machine_code, @host, @port, @map_json, @write_capability_json, @now, @now)
            ON CONFLICT(kind) DO UPDATE SET
                machine_code = excluded.machine_code,
                host = excluded.host,
                port = excluded.port,
                map_json = excluded.map_json,
                write_capability_json = excluded.write_capability_json,
                updated_at = excluded.updated_at;
            """;
        cmd.Parameters.AddWithValue("@kind", kind);
        cmd.Parameters.AddWithValue("@machine_code", machineCode);
        cmd.Parameters.AddWithValue("@host", (object?)host ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@port", (object?)port ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@map_json", mapJson);
        cmd.Parameters.AddWithValue("@write_capability_json", (object?)writeCapabilityJson ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@now", nowIso);

        await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);

        return new ConnectorConfigSummary(
            kind, machineCode, host, port, ParseIso(nowIso),
            normalizedCapability is null ? null : ConnectorWriteCapabilityDto.From(normalizedCapability));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Read
    // ─────────────────────────────────────────────────────────────────────

    private const string FullColumns = "kind, machine_code, host, port, map_json, created_at, updated_at, write_capability_json";
    private const string SummaryColumns = "kind, machine_code, host, port, updated_at, write_capability_json";

    /// <summary>The FULL row (including <see cref="ConnectorConfigRecord.MapJson"/>, which may embed OPC-UA
    /// credentials) for one kind — engine-internal use only (validating an update targets the same machine,
    /// or re-registering a live factory). Never routed to an HTTP response.</summary>
    public async Task<ConnectorConfigRecord?> GetAsync(string kind, CancellationToken ct = default)
    {
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = $"SELECT {FullColumns} FROM connector_configs WHERE kind = @kind;";
        cmd.Parameters.AddWithValue("@kind", kind);

        using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        if (!await reader.ReadAsync(ct).ConfigureAwait(false)) return null;
        return ReadFullRecord(reader);
    }

    /// <summary>Every persisted connector config, FULL rows — the startup-wiring path (Program.cs), never
    /// exposed over HTTP. See <see cref="ListAsync"/> for the credential-free public projection.</summary>
    public async Task<IReadOnlyList<ConnectorConfigRecord>> LoadAllAsync(CancellationToken ct = default)
    {
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = $"SELECT {FullColumns} FROM connector_configs ORDER BY kind;";

        var results = new List<ConnectorConfigRecord>();
        using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        while (await reader.ReadAsync(ct).ConfigureAwait(false))
        {
            results.Add(ReadFullRecord(reader));
        }
        return results;
    }

    /// <summary>The <c>GET /v1/connectors/configured</c> projection: every persisted connector config
    /// WITHOUT <c>map_json</c> — the column simply is never in the SELECT list, so there is no redaction
    /// step to forget (see this class's own doc comment).</summary>
    public async Task<IReadOnlyList<ConnectorConfigSummary>> ListAsync(CancellationToken ct = default)
    {
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = $"SELECT {SummaryColumns} FROM connector_configs ORDER BY kind;";

        var results = new List<ConnectorConfigSummary>();
        using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        while (await reader.ReadAsync(ct).ConfigureAwait(false))
        {
            results.Add(ReadSummary(reader));
        }
        return results;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Remove — see ConnectorEndpoints.DeleteConnectorAsync's own doc comment for exactly what removal
    // means (a persisted-config-only deletion; the live roster/ConnectorRegistry are untouched until the
    // next process restart — FleetHost.RegisterMachine has no unregister, and this class does not invent
    // one).
    // ─────────────────────────────────────────────────────────────────────

    public async Task<bool> DeleteAsync(string kind, CancellationToken ct = default)
    {
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = "DELETE FROM connector_configs WHERE kind = @kind;";
        cmd.Parameters.AddWithValue("@kind", kind);

        var rows = await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        return rows > 0;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Row mapping / ISO-8601 helpers
    // ─────────────────────────────────────────────────────────────────────

    private static ConnectorConfigRecord ReadFullRecord(SqliteDataReader reader) => new(
        Kind: reader.GetString(reader.GetOrdinal("kind")),
        MachineCode: reader.GetString(reader.GetOrdinal("machine_code")),
        Host: GetNullableString(reader, "host"),
        Port: GetNullableInt(reader, "port"),
        MapJson: reader.GetString(reader.GetOrdinal("map_json")),
        CreatedAtUtc: ParseIso(reader.GetString(reader.GetOrdinal("created_at"))),
        UpdatedAtUtc: ParseIso(reader.GetString(reader.GetOrdinal("updated_at"))),
        WriteCapability: GetWriteCapability(reader));

    private static ConnectorConfigSummary ReadSummary(SqliteDataReader reader)
    {
        var rawCapability = GetWriteCapability(reader);
        return new ConnectorConfigSummary(
            Kind: reader.GetString(reader.GetOrdinal("kind")),
            MachineCode: reader.GetString(reader.GetOrdinal("machine_code")),
            Host: GetNullableString(reader, "host"),
            Port: GetNullableInt(reader, "port"),
            UpdatedAtUtc: ParseIso(reader.GetString(reader.GetOrdinal("updated_at"))),
            WriteCapability: rawCapability is null ? null : ConnectorWriteCapabilityDto.From(rawCapability));
    }

    /// <summary>Task B-3 — <see langword="null"/> (a pre-existing row, or a map that declares no write/command
    /// capability — see <see cref="ConnectorWriteCapability"/>'s own doc comment for why the two are stored
    /// identically) reads back as <see langword="null"/>, never as <see cref="ConnectorWriteCapability.None"/>
    /// — a caller that wants a non-null instance can fall back to that constant itself; this store reports
    /// exactly what is persisted.</summary>
    private static ConnectorWriteCapability? GetWriteCapability(SqliteDataReader reader)
    {
        var ordinal = reader.GetOrdinal("write_capability_json");
        return reader.IsDBNull(ordinal) ? null : ConnectorWriteCapability.FromJson(reader.GetString(ordinal));
    }

    private static string? GetNullableString(SqliteDataReader reader, string column)
    {
        var ordinal = reader.GetOrdinal(column);
        return reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);
    }

    private static int? GetNullableInt(SqliteDataReader reader, string column)
    {
        var ordinal = reader.GetOrdinal(column);
        return reader.IsDBNull(ordinal) ? null : reader.GetInt32(ordinal);
    }

    private static string ToIso(DateTimeOffset value) => value.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);

    private static DateTimeOffset ParseIso(string value) =>
        DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
}
