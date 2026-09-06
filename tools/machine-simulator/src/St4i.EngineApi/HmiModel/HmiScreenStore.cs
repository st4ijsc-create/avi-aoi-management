using System.Globalization;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using St4i.Hmi.Contracts;
using St4i.EdgeCore.Infrastructure;

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
/// backward and drop what came after — it reads the document AT the target version and APPENDS it as a
/// brand-new version, moving the pointer to the new (highest) version number. History before, during and
/// after a rollback is exactly the same set of rows; only the pointer and the row count change. A caller
/// who rolls back to version 1 twice in a row gets TWO new versions (each a copy of version 1's
/// document), not one.
///
/// <para>🔴 <b>"CALLS <see cref="PutAsync"/> WITH IT" — RETRACTED, WS-HMI-2 Task 2 fix round 2 (review
/// HIGH-1), kept verbatim above ("calls PutAsync with it, which APPENDS...").</b> True through this
/// branch's <c>ff0c3bcf</c>. False once <see cref="ContractInvariants.Validate(HmiScreenDocument)"/>
/// started checking <c>screenId</c>'s pattern (this same round): a document PutAsync had already
/// accepted, under whatever rule applied the day it was written, could fail a rule tightened afterwards —
/// bricking every future rollback of that row. <see cref="RollbackAsync"/> now appends through a private
/// <c>AppendVersionAsync</c> that skips <see cref="ContractInvariants"/> entirely — see that method's own
/// doc comment for the full reasoning. <see cref="PutAsync"/> itself is UNCHANGED for new authorship: it
/// still validates unconditionally, before this or any other line in this class runs.</para>
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
    // Write — see this class's doc comment for why this APPENDS rather than overwrites, and for the
    // throw-vs-swallow choice shared with TagNamespaceStore.
    // ─────────────────────────────────────────────────────────────────────

    public async Task<int> PutAsync(HmiScreenDocument doc, CancellationToken ct = default)
    {
        // §5 door — checked BEFORE any connection is opened, exactly like TagNamespaceStore/
        // ComponentModelStore. A rejected document must not leave a half-open connection behind, and it
        // must not touch the database at all: a subsequent GetAsync/ListVersionsAsync for the same screenId
        // has to come back exactly as it was before this call — no new version, no moved pointer.
        //
        // 🔴 THIS CHECK RUNS FOR NEW AUTHORSHIP ONLY — WS-HMI-2 Task 2 fix round 2 (review HIGH-1). It did
        // NOT used to matter which caller reached this line, because there was only one: an engineer
        // saving an edit. That stopped being true the moment ContractInvariants.Validate(HmiScreenDocument)
        // started checking screenId's pattern (this same round's carried ruling) — RollbackAsync used to
        // call THIS method too, which means a document ACCEPTED before that pattern check existed would
        // fail it on every future restore, forever. Measured red before the fix below: seed a row through
        // this exact door before the pattern check (`ScreenId="MyScreen"` — the schema forbids uppercase,
        // and nothing in this class rejected it until this round), then roll it back — every attempt threw
        // ContractViolationException, disk untouched, no way to recover a version that was legitimately
        // written. See AppendVersionAsync's own doc comment for the fix and RollbackAsync's for how it uses
        // it.
        ContractInvariants.ThrowIfInvalid(doc);

        return await AppendVersionAsync(doc, ct).ConfigureAwait(false);
    }

    /// <summary>The actual write — INSERT a new version row, move the current-version pointer. NO
    /// <see cref="ContractInvariants"/> call here; that is <see cref="PutAsync"/>'s job, run once, before
    /// this method is ever reached.
    ///
    /// <para>🔴 <b>WHY THIS EXISTS AS ITS OWN METHOD — WS-HMI-2 Task 2 fix round 2 (review HIGH-1), NOT a
    /// refactor for its own sake.</b> <see cref="RollbackAsync"/> calls THIS, never
    /// <see cref="PutAsync"/> — the one behavioural change this split makes. The reasoning, stated as the
    /// review gave it: <see cref="ContractInvariants"/> guards a WRITE DOOR against a CLIENT AUTHORING a
    /// document. A rollback is not new authorship — it restores a document THE SYSTEM ALREADY ACCEPTED,
    /// at whatever rule applied the day it was written. Re-running today's rules against yesterday's
    /// accepted content is not a safety check; it is a way to make a validation rule tightened AFTER a row
    /// was written brick every future recovery of that row, forever, with no way back short of hand-editing
    /// SQLite. <b>What this deliberately does NOT do: weaken <see cref="PutAsync"/> for new authorship.</b>
    /// Every NEW document — from an engineer's builder save, or from any future WS-HMI-2 Task 3 endpoint —
    /// still goes through <see cref="PutAsync"/> and is validated against TODAY'S rules, unconditionally,
    /// exactly as before. Only the CONTENT OF AN OLD, ALREADY-ACCEPTED VERSION being copied forward by
    /// <see cref="RollbackAsync"/> skips re-validation, because it is not new content — it is the same
    /// bytes this store already served from <c>screens</c> a moment earlier.</para></summary>
    private async Task<int> AppendVersionAsync(HmiScreenDocument doc, CancellationToken ct)
    {
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
    /// <paramref name="toVersion"/> and appends it as a new version — an ordinary APPEND, not a
    /// pointer-move-backward, so the version this call reads from can never itself be lost even if it is
    /// rolled back to again later.
    ///
    /// <para>🔴 <b>Calls <see cref="AppendVersionAsync"/>, NOT <see cref="PutAsync"/> — WS-HMI-2 Task 2 fix
    /// round 2 (review HIGH-1).</b> This used to call <see cref="PutAsync"/>, which re-validates the
    /// restored document against <see cref="ContractInvariants"/> — CORRECT the day this method was
    /// written (no rule existed that a previously-accepted document could fail), and WRONG from the moment
    /// this round's <c>screenId</c> pattern check landed: a document accepted under yesterday's looser
    /// rule would fail today's on every restore attempt, forever. See <see cref="AppendVersionAsync"/>'s
    /// own doc comment for the full reasoning and for why <see cref="PutAsync"/> itself is UNCHANGED — new
    /// authorship is still validated, unconditionally; only a RESTORE of already-accepted content is
    /// exempt.</para></summary>
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

        return await AppendVersionAsync(target, ct).ConfigureAwait(false);
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
            // No explicit version ⇒ whatever the pointer currently names, which IS ALWAYS MAX(version)
            // for this screenId — both PutAsync and RollbackAsync (via PutAsync) move the pointer to the
            // version they just inserted, and neither ever inserts anything but the next number, so the
            // pointer and "the highest row" can never disagree at any instant a caller can observe.
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
