using System.Globalization;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using St4i.Hmi.Contracts;

namespace St4i.EngineApi.HmiModel;

/// <summary>
/// WS-HMI-0a Task 3 — <see cref="ITagNamespaceStore"/> on raw <c>Microsoft.Data.Sqlite</c> (no ORM), one
/// SQLite file (<c>tag-namespaces.db</c>) under the constructor's <paramref name="directory"/> (else
/// <see cref="EnvVarDir"/>, else <see cref="DefaultRoot"/>) with a <c>PRAGMA user_version</c>-tracked
/// migration ladder and short-lived, WAL-mode connections — the SAME shape as
/// <see cref="St4i.EngineApi.HmiModel.ComponentModelStore"/> (see that class's doc comment for the
/// rationale this class does not repeat). The document is stored VERBATIM as JSON, serialized with
/// <see cref="HmiContractJson.Options"/>.
///
/// <b>Two tables, not one</b> — the difference from <see cref="ComponentModelStore"/>. Alongside
/// <c>tag_namespaces</c> (document-per-machine, same shape as <c>component_models</c>) there is a flat
/// <c>tag_index</c> table mapping every declared tag <c>path</c> to the machine whose document contains
/// it, so <see cref="FindTagAsync"/> can answer "which document has this path" without deserializing every
/// document in the store. The index carries no other column: it is a POINTER at the document, never a
/// second copy of a tag's fields, so there is exactly one place a tag's data can drift.
///
/// <b>The reason <see cref="PutAsync"/> is a single transaction, not "upsert then insert-or-replace
/// per path":</b> re-declaring a machine's namespace after an engineer deletes a tag must make that tag
/// vanish from the index, not merely leave a stale row a later read would still return. Doing that
/// correctly means the OLD rows for this machine must be gone before the new ones are written, and
/// "gone, then re-populated" has to be atomic with the document upsert — a crash between the delete and
/// the re-insert must never leave the index empty while the document still lists tags, and a crash
/// between the document upsert and the index rebuild must never leave the index pointing at a document
/// version that no longer exists. One transaction is what makes both of those impossible rather than
/// merely unlikely.
///
/// <b>Same deliberate throw-vs-swallow difference from <see cref="AssetRegistry.AssetRegistryStore"/>
/// that <see cref="ComponentModelStore"/> states:</b> <see cref="PutAsync"/> throws rather than swallows,
/// both for a disk failure and for <see cref="ContractViolationException"/>, because it only runs from a
/// deliberate action (an engineer/connector re-declaring a namespace), never from a startup/registration
/// loop with "must not block the fleet" pressure.
/// </summary>
public sealed class TagNamespaceStore : ITagNamespaceStore
{
    /// <summary>Directory override — same idiom as <c>ST4I_HMI_MODEL_DIR</c>/<c>ST4I_ASSETS_DIR</c>.
    /// Unset or blank means "use <see cref="DefaultRoot"/>".</summary>
    public const string EnvVarDir = "ST4I_HMI_TAGS_DIR";

    public string DbPath { get; }

    private static readonly string[] OpenPragmas =
    {
        "PRAGMA journal_mode=WAL;",
        "PRAGMA synchronous=NORMAL;",
        "PRAGMA busy_timeout=5000;",
        "PRAGMA foreign_keys=ON;",
    };

    // Ordered migration ladder — future tag-namespace schema changes append a new (Version, Statements)
    // entry here; EnsureSchema() applies only the entries newer than the DB's current PRAGMA user_version,
    // each inside its own transaction. No migrator library — mirrors ComponentModelStore/AssetRegistryStore
    // exactly. Two tables at v1: the document store, and a flat index keyed on path with a foreign key back
    // to the document so a delete-then-reinsert inside one transaction is what keeps them from disagreeing.
    private static readonly (int Version, string[] Statements)[] Migrations =
    {
        (1, new[]
        {
            """
            CREATE TABLE IF NOT EXISTS tag_namespaces (
              machine_code TEXT PRIMARY KEY,
              document     TEXT NOT NULL,
              updated_at   TEXT NOT NULL);
            """,
            """
            CREATE TABLE IF NOT EXISTS tag_index (
              path         TEXT PRIMARY KEY,
              machine_code TEXT NOT NULL,
              FOREIGN KEY(machine_code) REFERENCES tag_namespaces(machine_code) ON DELETE CASCADE);
            """,
            "CREATE INDEX IF NOT EXISTS ix_tag_index_machine ON tag_index(machine_code);",
        }),
    };

    /// <param name="directory">Explicit directory override (tests), or <see langword="null"/> to resolve
    /// via <see cref="ResolveRoot"/> (env var, then <see cref="DefaultRoot"/>).</param>
    public TagNamespaceStore(string? directory = null)
    {
        var root = ResolveRoot(directory);
        Directory.CreateDirectory(root);
        DbPath = Path.Combine(root, "tag-namespaces.db");
        EnsureSchema();
    }

    /// <summary>The default tag-namespace root: <c>%ProgramData%\ST4I\sim\hmi-tags</c> — a SIBLING of
    /// <c>...\sim\hmi-model</c>/<c>...\sim\assets</c>/<c>...\sim\historian</c>, never the same directory.</summary>
    public static string DefaultRoot() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ST4I", "sim", "hmi-tags");

    /// <summary>Resolves the effective tag-namespace directory: <paramref name="directory"/> if given,
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
    // Write — see this class's doc comment for the throw-vs-swallow difference from AssetRegistryStore,
    // and for why the delete-then-reinsert of the index has to share one transaction with the document
    // upsert.
    // ─────────────────────────────────────────────────────────────────────

    public async Task PutAsync(TagNamespaceDocument doc, CancellationToken ct = default)
    {
        // §5 door — checked BEFORE any connection is opened. A rejected document must not leave a
        // half-open connection behind, and it must not touch the database at all (a subsequent GetAsync /
        // FindTagAsync for the same machine has to come back exactly as it was before this call).
        ContractInvariants.ThrowIfInvalid(doc);

        var json = JsonSerializer.Serialize(doc, HmiContractJson.Options);
        var nowIso = ToIso(DateTimeOffset.UtcNow);

        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
        using var transaction = connection.BeginTransaction();

        using (var upsert = connection.CreateCommand())
        {
            upsert.Transaction = transaction;
            upsert.CommandText = """
                INSERT INTO tag_namespaces (machine_code, document, updated_at)
                VALUES (@machine_code, @document, @now)
                ON CONFLICT(machine_code) DO UPDATE SET
                    document = excluded.document,
                    updated_at = excluded.updated_at;
                """;
            upsert.Parameters.AddWithValue("@machine_code", doc.MachineCode);
            upsert.Parameters.AddWithValue("@document", json);
            upsert.Parameters.AddWithValue("@now", nowIso);
            await upsert.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }

        // 🔴 THE TEST THIS METHOD EXISTS FOR: a tag no longer in the new document must not survive in the
        // index. DELETE every row this machine owns, then re-insert only the paths the new document
        // declares — an INSERT OR REPLACE per path would leave a retired tag's row behind, because it
        // never touches paths absent from the new document.
        using (var delete = connection.CreateCommand())
        {
            delete.Transaction = transaction;
            delete.CommandText = "DELETE FROM tag_index WHERE machine_code = @machine_code;";
            delete.Parameters.AddWithValue("@machine_code", doc.MachineCode);
            await delete.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }

        foreach (var tag in doc.Tags)
        {
            using var insert = connection.CreateCommand();
            insert.Transaction = transaction;
            insert.CommandText = """
                INSERT INTO tag_index (path, machine_code)
                VALUES (@path, @machine_code);
                """;
            insert.Parameters.AddWithValue("@path", tag.Path);
            insert.Parameters.AddWithValue("@machine_code", doc.MachineCode);
            await insert.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }

        transaction.Commit();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Read
    // ─────────────────────────────────────────────────────────────────────

    public async Task<TagNamespaceDocument?> GetAsync(string machineCode, CancellationToken ct = default)
    {
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = "SELECT document FROM tag_namespaces WHERE machine_code = @machine_code;";
        cmd.Parameters.AddWithValue("@machine_code", machineCode);

        var result = await cmd.ExecuteScalarAsync(ct).ConfigureAwait(false);
        // A machine with no declared tag namespace is a VALID product state, not an error — return null,
        // same convention as ComponentModelStore.GetAsync.
        if (result is not string json) return null;

        return JsonSerializer.Deserialize<TagNamespaceDocument>(json, HmiContractJson.Options);
    }

    public async Task<TagDescriptor?> FindTagAsync(string path, CancellationToken ct = default)
    {
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();
        // The index answers "which document contains this path" — it is deliberately NOT the source of
        // any tag field. The join reads the document JSON and this method deserializes it and returns the
        // matching TagDescriptor FROM THAT DOCUMENT, so the index can never itself go stale relative to a
        // tag's data (it has none to go stale).
        cmd.CommandText = """
            SELECT n.document
            FROM tag_index i
            JOIN tag_namespaces n ON n.machine_code = i.machine_code
            WHERE i.path = @path;
            """;
        cmd.Parameters.AddWithValue("@path", path);

        var result = await cmd.ExecuteScalarAsync(ct).ConfigureAwait(false);
        if (result is not string json) return null;

        var doc = JsonSerializer.Deserialize<TagNamespaceDocument>(json, HmiContractJson.Options);
        return doc?.Tags.FirstOrDefault(t => t.Path == path);
    }

    private static string ToIso(DateTimeOffset value) => value.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);
}
