using System.Globalization;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using St4i.Hmi.Contracts;

namespace St4i.EngineApi.HmiModel;

/// <summary>
/// WS-HMI-2 Task 1 — <see cref="IHmiScreenStore"/> on raw <c>Microsoft.Data.Sqlite</c> (no ORM), one SQLite
/// file (<c>hmi-screens.db</c>) under the constructor's <paramref name="directory"/> (else
/// <see cref="EnvVarDir"/>, else <see cref="DefaultRoot"/>) with a <c>PRAGMA user_version</c>-tracked
/// migration ladder and short-lived, WAL-mode connections — the SAME shape as
/// <see cref="TagNamespaceStore"/>/<see cref="ComponentModelStore"/> (see those classes' doc comments for
/// the rationale this class does not repeat). The document is stored VERBATIM as JSON, serialized with
/// <see cref="HmiContractJson.Options"/>.
///
/// <b>Two tables, not one — and this is the ONE point this store differs from its two predecessors, which
/// is why it exists as a separate class rather than a third method on either of them.</b>
/// <see cref="TagNamespaceStore"/>/<see cref="ComponentModelStore"/> each keep ONE row per key: a re-PUT
/// overwrites it, last-writer-wins, no history. That is wrong for a screen editor, because spec §7 requires
/// <c>rollback</c> — recovering an OLD version means that version must still exist on disk, not merely have
/// existed. So <c>screens</c> is APPEND-ONLY (primary key is <c>(screen_id, version)</c>, never just
/// <c>screen_id</c>) and a second table, <c>screen_current</c>, holds ONE pointer row per <c>screen_id</c>
/// naming which version is live. <see cref="PutAsync"/> never overwrites a <c>screens</c> row — it inserts a
/// new one and moves the pointer.
///
/// <b><see cref="RollbackAsync"/> is not a delete-forward operation.</b> It does not move the pointer
/// backward and drop what came after — it reads the document AT the target version and calls
/// <see cref="PutAsync"/> with it, which APPENDS that document as a brand-new version and moves the pointer
/// to the new (highest) version number. History before, during and after a rollback is exactly the same set
/// of rows; only the pointer and the row count change. A caller who rolls back to version 1 twice in a row
/// gets TWO new versions (each a copy of version 1's document), not one.
///
/// <b>Same deliberate throw-vs-swallow choice as <see cref="TagNamespaceStore"/>:</b> <see cref="PutAsync"/>
/// throws rather than swallows, both for a disk failure and for <see cref="ContractViolationException"/>,
/// because it only runs from a deliberate action (an engineer saving an edited screen in the builder), never
/// from a startup/registration loop with "must not block the fleet" pressure.
/// </summary>
public sealed class HmiScreenStore : IHmiScreenStore
{
    /// <summary>Directory override — same idiom as <c>ST4I_HMI_MODEL_DIR</c>/<c>ST4I_HMI_TAGS_DIR</c>.
    /// Unset or blank means "use <see cref="DefaultRoot"/>".</summary>
    public const string EnvVarDir = "ST4I_HMI_SCREENS_DIR";

    public string DbPath { get; }

    private static readonly string[] OpenPragmas =
    {
        "PRAGMA journal_mode=WAL;",
        "PRAGMA synchronous=NORMAL;",
        "PRAGMA busy_timeout=5000;",
        "PRAGMA foreign_keys=ON;",
    };

    // Ordered migration ladder — future screen-store schema changes append a new (Version, Statements)
    // entry here; EnsureSchema() applies only the entries newer than the DB's current PRAGMA user_version,
    // each inside its own transaction. No migrator library — mirrors TagNamespaceStore/ComponentModelStore
    // exactly. Two tables at v1: `screens` is the append-only version history (primary key includes
    // `version`, so a re-PUT can never collide with — let alone overwrite — an earlier one), and
    // `screen_current` is the one-row-per-screen pointer PutAsync/RollbackAsync move forward.
    private static readonly (int Version, string[] Statements)[] Migrations =
    {
        (1, new[]
        {
            """
            CREATE TABLE IF NOT EXISTS screens (
              screen_id TEXT NOT NULL,
              version   INTEGER NOT NULL,
              document  TEXT NOT NULL,
              saved_at  TEXT NOT NULL,
              PRIMARY KEY(screen_id, version));
            """,
            """
            CREATE TABLE IF NOT EXISTS screen_current (
              screen_id TEXT PRIMARY KEY,
              version   INTEGER NOT NULL);
            """,
        }),
    };

    /// <param name="directory">Explicit directory override (tests), or <see langword="null"/> to resolve
    /// via <see cref="ResolveRoot"/> (env var, then <see cref="DefaultRoot"/>).</param>
    public HmiScreenStore(string? directory = null)
    {
        var root = ResolveRoot(directory);
        Directory.CreateDirectory(root);
        DbPath = Path.Combine(root, "hmi-screens.db");
        EnsureSchema();
    }

    /// <summary>The default screen-store root: <c>%ProgramData%\ST4I\sim\hmi-screens</c> — a SIBLING of
    /// <c>...\sim\hmi-model</c>/<c>...\sim\hmi-tags</c>, never the same directory.</summary>
    public static string DefaultRoot() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ST4I", "sim", "hmi-screens");

    /// <summary>Resolves the effective screen-store directory: <paramref name="directory"/> if given, else
    /// <see cref="EnvVarDir"/> if set, else <see cref="DefaultRoot"/>. Pure path arithmetic — does not
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
    // Write — see this class's doc comment for why this APPENDS rather than overwrites, and for the
    // throw-vs-swallow choice shared with TagNamespaceStore.
    // ─────────────────────────────────────────────────────────────────────

    public async Task<int> PutAsync(HmiScreenDocument doc, CancellationToken ct = default)
    {
        // §5 door — checked BEFORE any connection is opened, exactly like TagNamespaceStore/
        // ComponentModelStore. A rejected document must not leave a half-open connection behind, and it
        // must not touch the database at all: a subsequent GetAsync/ListVersionsAsync for the same screenId
        // has to come back exactly as it was before this call — no new version, no moved pointer.
        ContractInvariants.ThrowIfInvalid(doc);

        var json = JsonSerializer.Serialize(doc, HmiContractJson.Options);
        var nowIso = ToIso(DateTimeOffset.UtcNow);

        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
        using var transaction = connection.BeginTransaction();

        // The next version number is one past whatever `screens` already holds for this screenId — 1 for a
        // screenId that has never been PUT. Reading MAX(version) and the INSERT below share one transaction
        // so the read-then-write is atomic against this connection's own writes.
        int nextVersion;
        using (var maxCmd = connection.CreateCommand())
        {
            maxCmd.Transaction = transaction;
            maxCmd.CommandText = "SELECT MAX(version) FROM screens WHERE screen_id = @screen_id;";
            maxCmd.Parameters.AddWithValue("@screen_id", doc.ScreenId);
            var result = await maxCmd.ExecuteScalarAsync(ct).ConfigureAwait(false);
            nextVersion = result is null or DBNull ? 1 : Convert.ToInt32(result, CultureInfo.InvariantCulture) + 1;
        }

        using (var insert = connection.CreateCommand())
        {
            insert.Transaction = transaction;
            // Plain INSERT, never INSERT OR REPLACE / ON CONFLICT — `(screen_id, version)` is the primary
            // key and `nextVersion` was just computed to be one past the highest existing row, so a
            // collision here would mean a concurrency bug, not a case this store's contract asks it to
            // paper over silently.
            insert.CommandText = """
                INSERT INTO screens (screen_id, version, document, saved_at)
                VALUES (@screen_id, @version, @document, @saved_at);
                """;
            insert.Parameters.AddWithValue("@screen_id", doc.ScreenId);
            insert.Parameters.AddWithValue("@version", nextVersion);
            insert.Parameters.AddWithValue("@document", json);
            insert.Parameters.AddWithValue("@saved_at", nowIso);
            await insert.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }

        using (var upsertCurrent = connection.CreateCommand())
        {
            upsertCurrent.Transaction = transaction;
            upsertCurrent.CommandText = """
                INSERT INTO screen_current (screen_id, version)
                VALUES (@screen_id, @version)
                ON CONFLICT(screen_id) DO UPDATE SET version = excluded.version;
                """;
            upsertCurrent.Parameters.AddWithValue("@screen_id", doc.ScreenId);
            upsertCurrent.Parameters.AddWithValue("@version", nextVersion);
            await upsertCurrent.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }

        transaction.Commit();
        return nextVersion;
    }

    /// <summary>See <see cref="IHmiScreenStore.RollbackAsync"/>. Reads the document AT
    /// <paramref name="toVersion"/> and calls <see cref="PutAsync"/> with it — an ordinary APPEND, not a
    /// pointer-move-backward, so the version this call reads from can never itself be lost even if it is
    /// rolled back to again later.</summary>
    public async Task<int> RollbackAsync(string screenId, int toVersion, CancellationToken ct = default)
    {
        var target = await GetAsync(screenId, toVersion, ct).ConfigureAwait(false);
        if (target is null)
        {
            var versions = await ListVersionsAsync(screenId, ct).ConfigureAwait(false);
            var available = versions.Count == 0
                ? "không có phiên bản nào"
                : string.Join(", ", versions.Select(v => v.Version));
            throw new ArgumentOutOfRangeException(
                nameof(toVersion), toVersion,
                $"Màn hình '{screenId}' không có phiên bản {toVersion}. Phiên bản có thật: {available}.");
        }

        return await PutAsync(target, ct).ConfigureAwait(false);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Read
    // ─────────────────────────────────────────────────────────────────────

    public async Task<HmiScreenDocument?> GetAsync(string screenId, int? version = null, CancellationToken ct = default)
    {
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();

        if (version is null)
        {
            // No explicit version ⇒ whatever the pointer currently names, NOT necessarily MAX(version) —
            // RollbackAsync can leave the pointer on a version that is not the highest row for this
            // screenId only in the sense that a later PutAsync could still append past it; at any given
            // instant the pointer IS the highest row, because both PutAsync and RollbackAsync (via
            // PutAsync) always move it to the version they just inserted.
            cmd.CommandText = """
                SELECT s.document
                FROM screens s
                JOIN screen_current c ON c.screen_id = s.screen_id AND c.version = s.version
                WHERE s.screen_id = @screen_id;
                """;
            cmd.Parameters.AddWithValue("@screen_id", screenId);
        }
        else
        {
            cmd.CommandText = "SELECT document FROM screens WHERE screen_id = @screen_id AND version = @version;";
            cmd.Parameters.AddWithValue("@screen_id", screenId);
            cmd.Parameters.AddWithValue("@version", version.Value);
        }

        var result = await cmd.ExecuteScalarAsync(ct).ConfigureAwait(false);
        // A screen nobody declared (or a version nobody wrote) is a VALID product state, not an error —
        // return null, same convention as TagNamespaceStore.GetAsync/ComponentModelStore.GetAsync.
        if (result is not string json) return null;

        return JsonSerializer.Deserialize<HmiScreenDocument>(json, HmiContractJson.Options);
    }

    public async Task<IReadOnlyList<string>> ListScreenIdsAsync(CancellationToken ct = default)
    {
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();
        // screen_current has exactly one row per screenId ever PUT — reading it rather than
        // `SELECT DISTINCT screen_id FROM screens` says the same thing without a DISTINCT over what can
        // grow to be a much larger table.
        cmd.CommandText = "SELECT screen_id FROM screen_current ORDER BY screen_id;";

        var ids = new List<string>();
        using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        while (await reader.ReadAsync(ct).ConfigureAwait(false))
        {
            ids.Add(reader.GetString(0));
        }
        return ids;
    }

    public async Task<IReadOnlyList<ScreenVersionInfo>> ListVersionsAsync(string screenId, CancellationToken ct = default)
    {
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            SELECT s.version, s.saved_at, c.version
            FROM screens s
            LEFT JOIN screen_current c ON c.screen_id = s.screen_id
            WHERE s.screen_id = @screen_id
            ORDER BY s.version;
            """;
        cmd.Parameters.AddWithValue("@screen_id", screenId);

        var versions = new List<ScreenVersionInfo>();
        using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        while (await reader.ReadAsync(ct).ConfigureAwait(false))
        {
            var version = reader.GetInt32(0);
            var savedAt = reader.GetString(1);
            var currentVersion = reader.IsDBNull(2) ? (int?)null : reader.GetInt32(2);
            versions.Add(new ScreenVersionInfo(version, savedAt, currentVersion == version));
        }
        return versions;
    }

    private static string ToIso(DateTimeOffset value) => value.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);
}
