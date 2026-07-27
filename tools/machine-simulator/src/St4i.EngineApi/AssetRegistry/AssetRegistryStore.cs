using System.Globalization;
using Microsoft.Data.Sqlite;
using St4i.EdgeCore.Config;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Uns;

namespace St4i.EngineApi.AssetRegistry;

/// <summary>
/// P2-1 (WS-J Asset Registry) — <see cref="IAssetRegistry"/> on raw <c>Microsoft.Data.Sqlite</c> (no
/// ORM), one SQLite file (<c>assets.db</c>) under <paramref name="directory"/> (else
/// <c>ST4I_ASSETS_DIR</c>, else <see cref="DefaultRoot"/>) with a <c>PRAGMA user_version</c>-tracked
/// migration ladder and short-lived, WAL-mode connections — the SAME shape as
/// <see cref="St4i.EdgeCore.Historian.SqliteHistorianStore"/>/<see cref="St4i.EngineApi.Auth.SecurityDb"/>
/// (see their doc comments for the rationale this class does not repeat).
///
/// <b>The upsert's one load-bearing invariant:</b> <see cref="UpsertAsync"/> is called every time a
/// machine registers — at roster-seed (every process start) AND on every dynamic
/// <c>FleetHost.RegisterMachine</c> call. A naive "REPLACE INTO" would reset <c>lifecycle</c> back to
/// whatever the caller passes on every one of those re-registrations, silently undoing an operator's
/// earlier <c>PUT /v1/assets/{code}/lifecycle</c> transition (e.g. "Maintenance") the next time the
/// process restarts or the machine re-announces itself — that would make the whole lifecycle feature
/// pointless (a value nobody could keep set). The SQL below is a real <c>INSERT ... ON CONFLICT(code) DO
/// UPDATE</c> whose <c>DO UPDATE SET</c> clause deliberately OMITS <c>lifecycle</c> and <c>created_at</c>
/// — SQLite leaves an omitted column exactly as it was on a conflict, so the existing row's lifecycle and
/// original creation time survive untouched no matter how many times the same code re-registers; only a
/// genuinely NEW code gets the fresh-insert defaults (<see cref="AssetLifecycleState.Active"/>,
/// <c>created_at == updated_at == now</c>).
///
/// <see cref="UpsertAsync"/> also NEVER throws into its caller (see <see cref="IAssetRegistry"/>'s doc
/// comment) — registering/starting the simulated fleet must never fail just because <c>assets.db</c>
/// hiccuped (locked file, missing directory, disk full, ...). Every other member
/// (<see cref="GetAsync"/>/<see cref="ListAsync"/>/<see cref="SetLifecycleAsync"/>) is a direct,
/// caller-invoked read/write reachable only from <c>AssetEndpoints</c>, so a genuine failure there is
/// allowed to surface as an ordinary exception (→ the framework's default 500), same as any other store
/// in this codebase.
/// </summary>
public sealed class AssetRegistryStore : IAssetRegistry
{
    /// <summary>Directory override — same idiom as <c>ST4I_HISTORIAN_DIR</c>/<c>ST4I_SECURITY_DIR</c>.
    /// Unset or blank means "use <see cref="DefaultRoot"/>".</summary>
    public const string EnvVarDir = "ST4I_ASSETS_DIR";

    public string DbPath { get; }

    private readonly UnsOptions _unsAddress;
    private readonly Action<Exception, string>? _logError;

    private static readonly string[] OpenPragmas =
    {
        "PRAGMA journal_mode=WAL;",
        "PRAGMA synchronous=NORMAL;",
        "PRAGMA busy_timeout=5000;",
        "PRAGMA foreign_keys=ON;",
    };

    // Ordered migration ladder — future asset-schema changes append a new (Version, Statements) entry
    // here; EnsureSchema() applies only the entries newer than the DB's current PRAGMA user_version, each
    // inside its own transaction. No migrator library — mirrors SqliteHistorianStore/SecurityDb exactly.
    private static readonly (int Version, string[] Statements)[] Migrations =
    {
        (1, new[]
        {
            """
            CREATE TABLE IF NOT EXISTS assets (
              code TEXT PRIMARY KEY,
              urn TEXT NOT NULL,
              device_class TEXT NOT NULL,
              driver_kind TEXT NOT NULL,
              machine_type TEXT NOT NULL,
              lifecycle TEXT NOT NULL,
              config_checksum TEXT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL);
            """,
            "CREATE INDEX IF NOT EXISTS ix_assets_urn ON assets(urn);",
        }),
    };

    /// <param name="unsAddress">The process-wide ISA-95 address (site/area/line/cell) every URN this
    /// store mints is built from — see <see cref="IsaUrnBuilder"/>.</param>
    /// <param name="directory">Explicit directory override (tests), or <see langword="null"/> to resolve
    /// via <see cref="ResolveRoot"/> (env var, then <see cref="DefaultRoot"/>).</param>
    /// <param name="logError">Where <see cref="UpsertAsync"/> reports a swallowed failure. Optional —
    /// a <see langword="null"/> logger just means the failure is silently swallowed (still never thrown).</param>
    public AssetRegistryStore(UnsOptions unsAddress, string? directory = null, Action<Exception, string>? logError = null)
    {
        _unsAddress = unsAddress ?? throw new ArgumentNullException(nameof(unsAddress));
        _logError = logError;

        var root = ResolveRoot(directory);
        Directory.CreateDirectory(root);
        DbPath = Path.Combine(root, "assets.db");
        EnsureSchema();
    }

    /// <summary>The default assets root: <c>%ProgramData%\ST4I\sim\assets</c> — a SIBLING of
    /// <c>...\sim\historian</c>/<c>...\sim\security</c>/<c>...\sim\wal</c>, never the same directory.</summary>
    public static string DefaultRoot() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ST4I", "sim", "assets");

    /// <summary>Resolves the effective assets directory: <paramref name="directory"/> if given, else
    /// <c>ST4I_ASSETS_DIR</c> if set, else <see cref="DefaultRoot"/>. Pure path arithmetic — does not
    /// create anything on disk.</summary>
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
                // PRAGMA user_version does not support bind parameters. `version` always comes from this
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
    // Upsert — see this class's doc comment for the lifecycle/created_at-preserved invariant.
    // ─────────────────────────────────────────────────────────────────────

    public async Task UpsertAsync(MachineDescriptor descriptor, CancellationToken ct = default)
    {
        if (descriptor is null || string.IsNullOrWhiteSpace(descriptor.Code)) return;

        try
        {
            var urn = IsaUrnBuilder.Build(_unsAddress.Site, _unsAddress.Area, _unsAddress.Line, _unsAddress.Cell, descriptor.Code);
            var checksum = ConfigChecksum.Compute(descriptor);
            var nowIso = ToIso(DateTimeOffset.UtcNow);

            using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
            using var cmd = connection.CreateCommand();
            cmd.CommandText = """
                INSERT INTO assets (code, urn, device_class, driver_kind, machine_type, lifecycle, config_checksum, created_at, updated_at)
                VALUES (@code, @urn, @device_class, @driver_kind, @machine_type, @lifecycle, @config_checksum, @now, @now)
                ON CONFLICT(code) DO UPDATE SET
                    urn = excluded.urn,
                    device_class = excluded.device_class,
                    driver_kind = excluded.driver_kind,
                    machine_type = excluded.machine_type,
                    config_checksum = excluded.config_checksum,
                    updated_at = excluded.updated_at;
                """;
            cmd.Parameters.AddWithValue("@code", descriptor.Code);
            cmd.Parameters.AddWithValue("@urn", urn);
            cmd.Parameters.AddWithValue("@device_class", descriptor.DeviceClass.ToString());
            cmd.Parameters.AddWithValue("@driver_kind", descriptor.DriverKind.ToString());
            cmd.Parameters.AddWithValue("@machine_type", descriptor.MachineType);
            // Only takes effect on a FRESH insert — see the ON CONFLICT clause above, which never touches
            // `lifecycle` on an existing row.
            cmd.Parameters.AddWithValue("@lifecycle", nameof(AssetLifecycleState.Active));
            cmd.Parameters.AddWithValue("@config_checksum", (object?)checksum ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@now", nowIso);

            await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            // Deliberately swallowed — see this class's + IAssetRegistry's doc comments: registering a
            // machine must never fail because assets.db hiccuped.
            _logError?.Invoke(ex, $"Asset upsert failed for machine '{descriptor.Code}' — this asset's registry row was not updated.");
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Read
    // ─────────────────────────────────────────────────────────────────────

    public async Task<AssetRecord?> GetAsync(string code, CancellationToken ct = default)
    {
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = $"SELECT {Columns} FROM assets WHERE code = @code;";
        cmd.Parameters.AddWithValue("@code", code);

        using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        if (!await reader.ReadAsync(ct).ConfigureAwait(false)) return null;
        return ReadRecord(reader);
    }

    public async Task<IReadOnlyList<AssetRecord>> ListAsync(CancellationToken ct = default)
    {
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = $"SELECT {Columns} FROM assets ORDER BY code;";

        var results = new List<AssetRecord>();
        using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        while (await reader.ReadAsync(ct).ConfigureAwait(false))
        {
            results.Add(ReadRecord(reader));
        }
        return results;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Lifecycle transition
    // ─────────────────────────────────────────────────────────────────────

    public async Task<AssetRecord?> SetLifecycleAsync(string code, AssetLifecycleState state, CancellationToken ct = default)
    {
        using (var connection = await OpenConnectionAsync(ct).ConfigureAwait(false))
        using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = "UPDATE assets SET lifecycle = @lifecycle, updated_at = @now WHERE code = @code;";
            cmd.Parameters.AddWithValue("@lifecycle", state.ToString());
            cmd.Parameters.AddWithValue("@now", ToIso(DateTimeOffset.UtcNow));
            cmd.Parameters.AddWithValue("@code", code);

            var rows = await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
            if (rows == 0) return null;
        }

        return await GetAsync(code, ct).ConfigureAwait(false);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Row mapping / ISO-8601 helpers
    // ─────────────────────────────────────────────────────────────────────

    private const string Columns = "code, urn, device_class, driver_kind, machine_type, lifecycle, config_checksum, created_at, updated_at";

    private static AssetRecord ReadRecord(SqliteDataReader reader) => new(
        Urn: reader.GetString(reader.GetOrdinal("urn")),
        Code: reader.GetString(reader.GetOrdinal("code")),
        DeviceClass: reader.GetString(reader.GetOrdinal("device_class")),
        DriverKind: reader.GetString(reader.GetOrdinal("driver_kind")),
        MachineType: reader.GetString(reader.GetOrdinal("machine_type")),
        Lifecycle: Enum.Parse<AssetLifecycleState>(reader.GetString(reader.GetOrdinal("lifecycle"))),
        ConfigChecksum: GetNullableString(reader, "config_checksum"),
        CreatedAtUtc: ParseIso(reader.GetString(reader.GetOrdinal("created_at"))),
        UpdatedAtUtc: ParseIso(reader.GetString(reader.GetOrdinal("updated_at"))));

    private static string? GetNullableString(SqliteDataReader reader, string column)
    {
        var ordinal = reader.GetOrdinal(column);
        return reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);
    }

    private static string ToIso(DateTimeOffset value) => value.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);

    private static DateTimeOffset ParseIso(string value) =>
        DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
}
