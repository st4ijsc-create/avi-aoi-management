using System.Globalization;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using St4i.Hmi.Contracts;
using St4i.EdgeCore.Infrastructure;

namespace St4i.EngineApi.HmiModel;

/// <summary>
/// WS-HMI-0a Task 2 — <see cref="IComponentModelStore"/> on raw <c>Microsoft.Data.Sqlite</c> (no ORM), one
/// SQLite file (<c>hmi-model.db</c>) under the constructor's <paramref name="directory"/> (else
/// <see cref="EnvVarDir"/>, else <see cref="DefaultRoot"/>) with a <c>PRAGMA user_version</c>-tracked
/// migration ladder and short-lived, WAL-mode connections — the SAME shape as
/// <see cref="St4i.EngineApi.AssetRegistry.AssetRegistryStore"/> (see that class's doc comment for the
/// rationale this class does not repeat). The document is stored VERBATIM as JSON (the frozen contract IS
/// the shape; re-normalizing it into columns would be a second copy free to drift — see the blueprint's
/// "Quyết định thiết kế" section), serialized with <see cref="HmiContractJson.Options"/> like every other
/// HMI contract producer/consumer in this codebase.
///
/// <b>One deliberate difference from <see cref="AssetRegistry.AssetRegistryStore.UpsertAsync"/>, which never
/// throws:</b> that method sits on the machine-registration path, where a disk hiccup must not be allowed
/// to stop a fleet from starting, so it catches and swallows. <see cref="PutAsync"/> here does the opposite
/// — it throws ordinarily, both for a disk failure AND for <see cref="ContractViolationException"/>. It runs
/// only from a deliberate user action (an engineer re-declaring a machine's component tree), never from a
/// startup/registration loop, so there is no "must not block the fleet" pressure to swallow against. The
/// opposite failure mode is the one that matters here: if this method swallowed an error, the caller would
/// walk away believing a save had happened when it had not — worse than a visible exception.
/// </summary>
public sealed class ComponentModelStore : IComponentModelStore
{
    /// <summary>Directory override — same idiom as <c>ST4I_ASSETS_DIR</c>/<c>ST4I_HISTORIAN_DIR</c>.
    /// Unset or blank means "use <see cref="DefaultRoot"/>".</summary>
    public const string EnvVarDir = "ST4I_HMI_MODEL_DIR";

    public string DbPath { get; }

    private static readonly string[] OpenPragmas =
    {
        "PRAGMA journal_mode=WAL;",
        "PRAGMA synchronous=NORMAL;",
        "PRAGMA busy_timeout=5000;",
        "PRAGMA foreign_keys=ON;",
    };

    // Ordered migration ladder — future component-model schema changes append a new (Version, Statements)
    // entry here; EnsureSchema() applies only the entries newer than the DB's current PRAGMA user_version,
    // each inside its own transaction. No migrator library — mirrors AssetRegistryStore exactly.
    private static readonly (int Version, string[] Statements)[] Migrations =
    {
        (1, new[]
        {
            """
            CREATE TABLE IF NOT EXISTS component_models (
              machine_code TEXT PRIMARY KEY,
              document     TEXT NOT NULL,
              updated_at   TEXT NOT NULL);
            """,
        }),
    };

    /// <param name="directory">Explicit directory override (tests), or <see langword="null"/> to resolve
    /// via <see cref="ResolveRoot"/> (env var, then <see cref="DefaultRoot"/>).</param>
    public ComponentModelStore(string? directory = null)
    {
        var root = ResolveRoot(directory);
        Directory.CreateDirectory(root);
        DbPath = Path.Combine(root, "hmi-model.db");
        EnsureSchema();
    }

    /// <summary>The default component-model root: <c>%ProgramData%\ST4I\sim\hmi-model</c> — a SIBLING of
    /// <c>...\sim\assets</c>/<c>...\sim\historian</c>/<c>...\sim\security</c>, never the same directory.</summary>
    public static string DefaultRoot() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ST4I", "sim", "hmi-model");

    /// <summary>Resolves the effective component-model directory: <paramref name="directory"/> if given,
    /// else <see cref="EnvVarDir"/> if set, else <see cref="DefaultRoot"/>. Pure path arithmetic — does not
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

    /// <summary>🔴 WS-F4 Task 1 — the highest migration rung this build understands, DERIVED from
    /// <see cref="Migrations"/> rather than restated, so a new rung cannot leave the ceiling behind.
    /// A database above this was written by a newer build; see
    /// <see cref="SchemaFromTheFutureException"/> for why that must be a refusal and not a skip.</summary>
    private static long HighestKnownSchemaVersion => Migrations[^1].Version;

    private void EnsureSchema()
    {
        using var connection = OpenConnection();

        // 🔴 WS-F4 Task 1 — THE SCHEMA CEILING. Refuse a database written by a NEWER build before the
        // ladder below is allowed to skip it silently. This call must stay ABOVE the loop: the loop's own
        // `continue` skips every rung when the file is ahead, so a guard placed inside it could never fire
        // on the one input that matters. HighestKnownSchemaVersion is derived from Migrations, so adding a
        // rung raises the ceiling automatically and the two can never drift apart.
        SchemaFromTheFutureException.ThrowIfDatabaseIsNewerThanThisBuild(
            connection, DbPath, HighestKnownSchemaVersion);

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
    // Write — see this class's doc comment for the throw-vs-swallow difference from AssetRegistryStore.
    // ─────────────────────────────────────────────────────────────────────

    public async Task PutAsync(ComponentModelDocument doc, CancellationToken ct = default)
    {
        // §5 door — checked BEFORE any connection is opened. A rejected document must not leave a
        // half-open connection behind, and it must not touch the database at all (a subsequent GetAsync
        // for the same machine has to come back exactly as it was before this call).
        ContractInvariants.ThrowIfInvalid(doc);

        var json = JsonSerializer.Serialize(doc, HmiContractJson.Options);
        var nowIso = ToIso(DateTimeOffset.UtcNow);

        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            INSERT INTO component_models (machine_code, document, updated_at)
            VALUES (@machine_code, @document, @now)
            ON CONFLICT(machine_code) DO UPDATE SET
                document = excluded.document,
                updated_at = excluded.updated_at;
            """;
        cmd.Parameters.AddWithValue("@machine_code", doc.MachineCode);
        cmd.Parameters.AddWithValue("@document", json);
        cmd.Parameters.AddWithValue("@now", nowIso);

        await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Read
    // ─────────────────────────────────────────────────────────────────────

    public async Task<ComponentModelDocument?> GetAsync(string machineCode, CancellationToken ct = default)
    {
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = "SELECT document FROM component_models WHERE machine_code = @machine_code;";
        cmd.Parameters.AddWithValue("@machine_code", machineCode);

        var result = await cmd.ExecuteScalarAsync(ct).ConfigureAwait(false);
        // A machine with no declared component tree is a VALID product state (§5-bis), not an error —
        // return null, let the API layer (a later workstream) decide what an empty document looks like.
        if (result is not string json) return null;

        return JsonSerializer.Deserialize<ComponentModelDocument>(json, HmiContractJson.Options);
    }

    public async Task<IReadOnlyList<string>> ListMachineCodesAsync(CancellationToken ct = default)
    {
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = "SELECT machine_code FROM component_models ORDER BY machine_code;";

        var results = new List<string>();
        using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        while (await reader.ReadAsync(ct).ConfigureAwait(false))
        {
            results.Add(reader.GetString(0));
        }
        return results;
    }

    private static string ToIso(DateTimeOffset value) => value.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);
}
