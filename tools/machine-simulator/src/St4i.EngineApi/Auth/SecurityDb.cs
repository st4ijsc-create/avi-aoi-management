using System.Globalization;
using Microsoft.Data.Sqlite;

namespace St4i.EngineApi.Auth;

/// <summary>
/// WS-D-D1 — shared <c>security.db</c> opener + migration ladder. Same raw-<c>Microsoft.Data.Sqlite</c>,
/// short-lived-connection, <c>PRAGMA user_version</c>-keyed-migration shape as
/// <see cref="St4i.EdgeCore.Historian.SqliteHistorianStore"/> — factored into its OWN type (rather than
/// folded directly into <see cref="SqliteUserStore"/>) because every future D-series security store
/// (audit log, etc.) needs to open the SAME <c>security.db</c> file with the SAME migration ladder, not a
/// hand-copied duplicate of it. Adding a table for a later task means appending one more
/// <c>(version, statements)</c> entry to <see cref="Migrations"/> here — every store's constructor calls
/// <see cref="EnsureSchema"/> (idempotently; only entries newer than the file's current
/// <c>user_version</c> ever run), so whichever store happens to be constructed FIRST after a task adds a
/// migration is the one that actually applies it, and every other store on the same file sees it already
/// applied.
/// </summary>
public sealed class SecurityDb
{
    /// <summary>Directory override — same idiom as <c>ST4I_HISTORIAN_DIR</c>/<c>ST4I_WAL_DIR</c>. Unset
    /// or blank means "use <see cref="DefaultRoot"/>".</summary>
    public const string EnvVarDir = "ST4I_SECURITY_DIR";

    public string DbPath { get; }

    private static readonly string[] OpenPragmas =
    {
        "PRAGMA journal_mode=WAL;",
        "PRAGMA synchronous=NORMAL;",
        "PRAGMA busy_timeout=5000;",
        "PRAGMA foreign_keys=ON;",
    };

    // Ordered migration ladder — future security-db schema changes (audit log, etc.) append a new
    // (Version, Statements) entry here; EnsureSchema applies only the entries newer than the DB's current
    // PRAGMA user_version, each inside its own transaction. No migrator library — this is the whole
    // mechanism (mirrors SqliteHistorianStore's Migrations exactly).
    private static readonly (int Version, string[] Statements)[] Migrations =
    {
        (1, new[]
        {
            """
            CREATE TABLE IF NOT EXISTS users (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              username TEXT NOT NULL UNIQUE COLLATE NOCASE,
              password_hash TEXT NOT NULL,
              role TEXT NOT NULL,
              display_name TEXT NULL,
              disabled INTEGER NOT NULL DEFAULT 0,
              must_change_password INTEGER NOT NULL DEFAULT 0,
              security_stamp TEXT NOT NULL,
              created_at_utc TEXT NOT NULL,
              created_by TEXT NULL,
              last_login_at_utc TEXT NULL);
            """,
        }),

        // WS-D-D3 — the append-only, hash-chained audit log — tamper-EVIDENT against
        // casual/accidental/app-level modification only (see SqliteAuditStore's doc comment for the full
        // threat model, the hash-chain mechanics, and what a local actor with direct security.db write
        // access can still do undetected). `id` doubles as the chain's seq order; `prev_hash`/`row_hash`
        // are 64-hex SHA-256 digests. No FK to `users.id` (actor_role is denormalized — the role the actor
        // held AT THE TIME of the action, which must never change retroactively if the user's role
        // changes later).
        (2, new[]
        {
            """
            CREATE TABLE IF NOT EXISTS audit_log (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              at_utc TEXT NOT NULL,
              actor_username TEXT NOT NULL,
              actor_role TEXT NOT NULL,
              action TEXT NOT NULL,
              target_type TEXT NULL,
              target_id TEXT NULL,
              old_value TEXT NULL,
              new_value TEXT NULL,
              correlation_id TEXT NULL,
              client_ip TEXT NULL,
              prev_hash TEXT NOT NULL,
              row_hash TEXT NOT NULL);
            """,
            "CREATE INDEX IF NOT EXISTS ix_audit_at ON audit_log(at_utc);",
            "CREATE INDEX IF NOT EXISTS ix_audit_actor ON audit_log(actor_username);",
            "CREATE INDEX IF NOT EXISTS ix_audit_action ON audit_log(action);",
        }),
    };

    /// <param name="directory">Explicit directory override (tests), or <see langword="null"/> to resolve
    /// via <see cref="ResolveRoot"/> (env var, then <see cref="DefaultRoot"/>). Creates the directory tree
    /// (WS-C's Critical lesson: plain file I/O does NOT create missing parent directories — see
    /// <see cref="St4i.EdgeCore.Infrastructure.CredentialStore.Save"/> and
    /// <see cref="St4i.EdgeCore.Transport.WalOptions.EnsureDir"/> for the same fix applied elsewhere)
    /// before ever opening the DB file.</param>
    public SecurityDb(string? directory = null)
    {
        var root = ResolveRoot(directory);
        Directory.CreateDirectory(root);
        DbPath = Path.Combine(root, "security.db");
        EnsureSchema();
    }

    /// <summary>The default security root: <c>%ProgramData%\ST4I\sim\security</c> — a SIBLING of
    /// <c>...\sim\historian</c>/<c>...\sim\wal</c>/<c>...\sim\creds</c>, never the same directory.</summary>
    public static string DefaultRoot() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ST4I", "sim", "security");

    /// <summary>Resolves the effective security directory: <paramref name="directory"/> if given, else
    /// <c>ST4I_SECURITY_DIR</c> if set, else <see cref="DefaultRoot"/>. Pure path arithmetic — does not
    /// create anything on disk.</summary>
    public static string ResolveRoot(string? directory = null)
    {
        if (!string.IsNullOrWhiteSpace(directory)) return directory;
        var env = Environment.GetEnvironmentVariable(EnvVarDir);
        return string.IsNullOrWhiteSpace(env) ? DefaultRoot() : env;
    }

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
                // fixed, code-defined migration ladder above (never external/user input), so interpolating
                // it here carries none of the injection risk parameterization guards against.
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

    public SqliteConnection OpenConnection()
    {
        var connection = new SqliteConnection($"Data Source={DbPath}");
        connection.Open();
        ApplyPragmas(connection);
        return connection;
    }

    public async Task<SqliteConnection> OpenConnectionAsync(CancellationToken ct)
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
}
