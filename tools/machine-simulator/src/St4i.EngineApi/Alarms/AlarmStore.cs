using System.Globalization;
using Microsoft.Data.Sqlite;

namespace St4i.EngineApi.Alarms;

/// <summary>
/// GĐ3 sub-4 LC-1 — <see cref="IAlarmStore"/> on raw <c>Microsoft.Data.Sqlite</c> (no ORM), its OWN SQLite
/// file (<c>alarms.db</c>) under <paramref name="directory"/> (else <c>ST4I_ALARMS_DIR</c>, else
/// <see cref="DefaultRoot"/>) with a <c>PRAGMA user_version</c>-tracked migration ladder and short-lived,
/// WAL-mode connections — the SAME shape as
/// <see cref="St4i.EngineApi.AssetRegistry.AssetRegistryStore"/>/<see cref="St4i.EngineApi.Auth.SqliteAuditStore"/>
/// (see their doc comments for the rationale this class does not repeat).
///
/// Two tables, two very different write disciplines:
/// <list type="bullet">
/// <item><description><c>active_alarms</c> — the LIVE set. One row per distinct <see cref="AlarmRaise.Key"/>
/// (its TEXT PRIMARY KEY); rows are UPSERTed by <see cref="RaiseAsync"/> and DELETEd by
/// <see cref="ClearAsync"/>/a ClearOnAck <see cref="AckAsync"/> — a Cleared alarm does not linger here with
/// a "Cleared" state, it's simply gone. This table has no declared <c>INTEGER PRIMARY KEY</c>, so every row
/// still gets SQLite's implicit <c>rowid</c> — that rowid IS <see cref="Alarm.Id"/> (stable across an
/// UPSERT's <c>DO UPDATE</c> path, since that's a real SQL UPDATE, not a delete+insert; only re-appears with
/// a NEW rowid if the key was cleared and later re-raised).</description></item>
/// <item><description><c>alarm_history</c> — the APPEND-ONLY event log (raised/cleared/acked), never
/// mutated or deleted — the durable record of "what happened and when" that outlives whatever
/// <c>active_alarms</c> currently contains.</description></item>
/// </list>
///
/// <see cref="RaiseAsync"/>/<see cref="ClearAsync"/> NEVER throw into their caller (see <see cref="IAlarmStore"/>'s
/// doc comment) — every other member is a direct, caller-invoked read/write reachable only from
/// <c>AlarmEndpoints</c>, so a genuine failure there is allowed to surface as an ordinary exception, same as
/// every comparable store in this codebase.
/// </summary>
public sealed class AlarmStore : IAlarmStore
{
    /// <summary>Directory override — same idiom as <c>ST4I_ASSETS_DIR</c>/<c>ST4I_SECURITY_DIR</c>. Unset
    /// or blank means "use <see cref="DefaultRoot"/>".</summary>
    public const string EnvVarDir = "ST4I_ALARMS_DIR";

    public string DbPath { get; }

    private readonly Action<Exception, string>? _logError;

    private static readonly string[] OpenPragmas =
    {
        "PRAGMA journal_mode=WAL;",
        "PRAGMA synchronous=NORMAL;",
        "PRAGMA busy_timeout=5000;",
        "PRAGMA foreign_keys=ON;",
    };

    // Ordered migration ladder — future alarm-schema changes append a new (Version, Statements) entry
    // here; EnsureSchema() applies only the entries newer than the DB's current PRAGMA user_version, each
    // inside its own transaction. No migrator library — mirrors AssetRegistryStore/SqliteAuditStore exactly.
    private static readonly (int Version, string[] Statements)[] Migrations =
    {
        (1, new[]
        {
            """
            CREATE TABLE IF NOT EXISTS active_alarms (
              key TEXT PRIMARY KEY,
              source TEXT NOT NULL,
              code TEXT NOT NULL,
              priority TEXT NOT NULL,
              state TEXT NOT NULL,
              message TEXT NOT NULL,
              runbook TEXT NULL,
              target_id TEXT NULL,
              clear_on_ack INTEGER NOT NULL,
              count INTEGER NOT NULL,
              first_raised_at TEXT NOT NULL,
              last_raised_at TEXT NOT NULL,
              acked_at TEXT NULL,
              acked_by TEXT NULL);
            """,
            "CREATE INDEX IF NOT EXISTS ix_active_alarms_priority ON active_alarms(priority);",
            """
            CREATE TABLE IF NOT EXISTS alarm_history (
              seq INTEGER PRIMARY KEY,
              at TEXT NOT NULL,
              key TEXT NOT NULL,
              event TEXT NOT NULL,
              source TEXT NOT NULL,
              code TEXT NOT NULL,
              priority TEXT NOT NULL,
              message TEXT NOT NULL,
              actor TEXT NULL);
            """,
            "CREATE INDEX IF NOT EXISTS ix_alarm_history_at ON alarm_history(at);",
            "CREATE INDEX IF NOT EXISTS ix_alarm_history_key ON alarm_history(key);",
        }),
    };

    /// <param name="directory">Explicit directory override (tests), or <see langword="null"/> to resolve
    /// via <see cref="ResolveRoot"/> (env var, then <see cref="DefaultRoot"/>).</param>
    /// <param name="logError">Where <see cref="RaiseAsync"/>/<see cref="ClearAsync"/> report a swallowed
    /// failure. Optional — a <see langword="null"/> logger just means the failure is silently swallowed
    /// (still never thrown).</param>
    public AlarmStore(string? directory = null, Action<Exception, string>? logError = null)
    {
        _logError = logError;

        var root = ResolveRoot(directory);
        Directory.CreateDirectory(root);
        DbPath = Path.Combine(root, "alarms.db");
        EnsureSchema();
    }

    /// <summary>The default alarms root: <c>%ProgramData%\ST4I\sim\alarms</c> — a SIBLING of
    /// <c>...\sim\assets</c>/<c>...\sim\historian</c>/<c>...\sim\security</c>, never the same directory.</summary>
    public static string DefaultRoot() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ST4I", "sim", "alarms");

    /// <summary>Resolves the effective alarms directory: <paramref name="directory"/> if given, else
    /// <c>ST4I_ALARMS_DIR</c> if set, else <see cref="DefaultRoot"/>. Pure path arithmetic — does not create
    /// anything on disk.</summary>
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
    // RaiseAsync — upsert active_alarms + append "raised" history. NEVER throws.
    // ─────────────────────────────────────────────────────────────────────

    public async Task RaiseAsync(AlarmRaise raise, CancellationToken ct = default)
    {
        if (raise is null) return;

        try
        {
            var key = raise.Key;
            var nowIso = ToIso(DateTimeOffset.UtcNow);

            using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);

            using (var cmd = connection.CreateCommand())
            {
                // ON CONFLICT(key) DO UPDATE deliberately OMITS first_raised_at/state/acked_at/acked_by —
                // SQLite leaves an omitted column exactly as it was on conflict, so a re-raise of an
                // already-Acked (ClearOnAck=false) alarm stays Acked rather than silently reverting to
                // Active — see Alarm's own doc comment.
                cmd.CommandText = """
                    INSERT INTO active_alarms
                        (key, source, code, priority, state, message, runbook, target_id, clear_on_ack,
                         count, first_raised_at, last_raised_at, acked_at, acked_by)
                    VALUES
                        (@key, @source, @code, @priority, @state, @message, @runbook, @target_id, @clear_on_ack,
                         1, @now, @now, NULL, NULL)
                    ON CONFLICT(key) DO UPDATE SET
                        last_raised_at = excluded.last_raised_at,
                        count = count + 1,
                        message = excluded.message,
                        priority = excluded.priority;
                    """;
                cmd.Parameters.AddWithValue("@key", key);
                cmd.Parameters.AddWithValue("@source", raise.Source.ToString());
                cmd.Parameters.AddWithValue("@code", raise.Code);
                cmd.Parameters.AddWithValue("@priority", raise.Priority.ToString());
                cmd.Parameters.AddWithValue("@state", nameof(AlarmState.Active));
                cmd.Parameters.AddWithValue("@message", raise.Message);
                cmd.Parameters.AddWithValue("@runbook", (object?)raise.Runbook ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@target_id", (object?)raise.TargetId ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@clear_on_ack", raise.ClearOnAck ? 1 : 0);
                cmd.Parameters.AddWithValue("@now", nowIso);
                await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
            }

            await AppendHistoryAsync(connection, key, "raised", raise.Source, raise.Code, raise.Priority, raise.Message, actor: null, ct)
                .ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            // Deliberately swallowed — see IAlarmStore's doc comment: a Policy DENY handler (or LC-2's
            // periodic evaluator) must never fail just because alarms.db hiccuped.
            _logError?.Invoke(ex, $"Alarm raise failed for key '{raise?.Key}' — this alarm was not recorded.");
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // ClearAsync — delete from active_alarms + append "cleared" history. No-op if absent. NEVER throws.
    // ─────────────────────────────────────────────────────────────────────

    public async Task ClearAsync(string key, CancellationToken ct = default)
    {
        try
        {
            using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);

            var existing = await ReadActiveByKeyAsync(connection, key, ct).ConfigureAwait(false);
            if (existing is null) return; // no-op — nothing active carries this key.

            using (var delCmd = connection.CreateCommand())
            {
                delCmd.CommandText = "DELETE FROM active_alarms WHERE key = @key;";
                delCmd.Parameters.AddWithValue("@key", key);
                await delCmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
            }

            await AppendHistoryAsync(connection, key, "cleared", existing.Source, existing.Code, existing.Priority, existing.Message, actor: null, ct)
                .ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logError?.Invoke(ex, $"Alarm clear failed for key '{key}'.");
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // AckAsync — ClearOnAck=true clears (delete + "cleared" history, no separate "acked" row);
    // ClearOnAck=false acks in place ("acked" history). Returns null if unknown/already cleared.
    // ─────────────────────────────────────────────────────────────────────

    public async Task<Alarm?> AckAsync(long id, string by, CancellationToken ct = default)
    {
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);

        var current = await ReadByRowIdAsync(connection, id, ct).ConfigureAwait(false);
        if (current is null) return null;

        var nowIso = ToIso(DateTimeOffset.UtcNow);
        var ackedAtUtc = ParseIso(nowIso);

        if (current.ClearOnAck)
        {
            using (var delCmd = connection.CreateCommand())
            {
                delCmd.CommandText = "DELETE FROM active_alarms WHERE rowid = @id;";
                delCmd.Parameters.AddWithValue("@id", id);
                await delCmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
            }

            await AppendHistoryAsync(connection, current.Key, "cleared", current.Source, current.Code, current.Priority, current.Message, actor: by, ct)
                .ConfigureAwait(false);

            return current with { State = AlarmState.Cleared, AckedUtc = ackedAtUtc, AckedBy = by };
        }
        else
        {
            using (var updCmd = connection.CreateCommand())
            {
                updCmd.CommandText = "UPDATE active_alarms SET state = @state, acked_at = @now, acked_by = @by WHERE rowid = @id;";
                updCmd.Parameters.AddWithValue("@state", nameof(AlarmState.Acked));
                updCmd.Parameters.AddWithValue("@now", nowIso);
                updCmd.Parameters.AddWithValue("@by", by);
                updCmd.Parameters.AddWithValue("@id", id);
                await updCmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
            }

            await AppendHistoryAsync(connection, current.Key, "acked", current.Source, current.Code, current.Priority, current.Message, actor: by, ct)
                .ConfigureAwait(false);

            return current with { State = AlarmState.Acked, AckedUtc = ackedAtUtc, AckedBy = by };
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // ListActiveAsync — everything currently live, priority-severity desc then last-raised desc.
    // ─────────────────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<Alarm>> ListActiveAsync(CancellationToken ct = default)
    {
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = $"""
            SELECT rowid AS id, {Columns}
            FROM active_alarms
            ORDER BY
                CASE priority
                    WHEN 'Critical' THEN 0
                    WHEN 'High' THEN 1
                    WHEN 'Medium' THEN 2
                    WHEN 'Low' THEN 3
                    ELSE 4
                END ASC,
                last_raised_at DESC;
            """;

        var results = new List<Alarm>();
        using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        while (await reader.ReadAsync(ct).ConfigureAwait(false))
        {
            results.Add(ReadAlarm(reader));
        }
        return results;
    }

    // ─────────────────────────────────────────────────────────────────────
    // QueryHistoryAsync — filtered/paged read of the append-only alarm_history log, newest-first.
    // ─────────────────────────────────────────────────────────────────────

    public async Task<AlarmHistoryPage> QueryHistoryAsync(AlarmHistoryFilter filter, CancellationToken ct = default)
    {
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);

        var whereClauses = new List<string>();
        var parameters = new List<(string Name, object Value)>();

        if (filter.Source is not null)
        {
            whereClauses.Add("source = @source");
            parameters.Add(("@source", filter.Source.Value.ToString()));
        }
        if (filter.Priority is not null)
        {
            whereClauses.Add("priority = @priority");
            parameters.Add(("@priority", filter.Priority.Value.ToString()));
        }
        if (filter.From is not null)
        {
            whereClauses.Add("at >= @from");
            parameters.Add(("@from", ToIso(filter.From.Value)));
        }
        if (filter.To is not null)
        {
            whereClauses.Add("at <= @to");
            parameters.Add(("@to", ToIso(filter.To.Value)));
        }

        var whereSql = whereClauses.Count > 0 ? " WHERE " + string.Join(" AND ", whereClauses) : string.Empty;

        int total;
        using (var countCmd = connection.CreateCommand())
        {
            countCmd.CommandText = $"SELECT COUNT(*) FROM alarm_history{whereSql};";
            foreach (var (name, value) in parameters) countCmd.Parameters.AddWithValue(name, value);
            total = Convert.ToInt32((long)(await countCmd.ExecuteScalarAsync(ct).ConfigureAwait(false))!, CultureInfo.InvariantCulture);
        }

        var items = new List<AlarmHistoryEntry>();
        using (var selectCmd = connection.CreateCommand())
        {
            selectCmd.CommandText = $"""
                SELECT seq, at, key, event, source, code, priority, message, actor
                FROM alarm_history{whereSql}
                ORDER BY seq DESC
                LIMIT @limit OFFSET @offset;
                """;
            foreach (var (name, value) in parameters) selectCmd.Parameters.AddWithValue(name, value);
            selectCmd.Parameters.AddWithValue("@limit", filter.Limit);
            selectCmd.Parameters.AddWithValue("@offset", filter.Offset);

            using var reader = await selectCmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
            while (await reader.ReadAsync(ct).ConfigureAwait(false))
            {
                items.Add(new AlarmHistoryEntry(
                    Seq: reader.GetInt64(0),
                    AtUtc: ParseIso(reader.GetString(1)),
                    Key: reader.GetString(2),
                    Event: reader.GetString(3),
                    Source: Enum.Parse<AlarmSource>(reader.GetString(4)),
                    Code: reader.GetString(5),
                    Priority: Enum.Parse<AlarmPriority>(reader.GetString(6)),
                    Message: reader.GetString(7),
                    Actor: reader.IsDBNull(8) ? null : reader.GetString(8)));
            }
        }

        return new AlarmHistoryPage(items, total, filter.Limit, filter.Offset);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Shared helpers
    // ─────────────────────────────────────────────────────────────────────

    private const string Columns =
        "key, source, code, priority, state, message, runbook, target_id, clear_on_ack, count, first_raised_at, last_raised_at, acked_at, acked_by";

    private static async Task<Alarm?> ReadActiveByKeyAsync(SqliteConnection connection, string key, CancellationToken ct)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = $"SELECT rowid AS id, {Columns} FROM active_alarms WHERE key = @key;";
        cmd.Parameters.AddWithValue("@key", key);

        using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        if (!await reader.ReadAsync(ct).ConfigureAwait(false)) return null;
        return ReadAlarm(reader);
    }

    private static async Task<Alarm?> ReadByRowIdAsync(SqliteConnection connection, long id, CancellationToken ct)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = $"SELECT rowid AS id, {Columns} FROM active_alarms WHERE rowid = @id;";
        cmd.Parameters.AddWithValue("@id", id);

        using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        if (!await reader.ReadAsync(ct).ConfigureAwait(false)) return null;
        return ReadAlarm(reader);
    }

    private static async Task AppendHistoryAsync(
        SqliteConnection connection, string key, string eventName, AlarmSource source, string code,
        AlarmPriority priority, string message, string? actor, CancellationToken ct)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            INSERT INTO alarm_history (at, key, event, source, code, priority, message, actor)
            VALUES (@at, @key, @event, @source, @code, @priority, @message, @actor);
            """;
        cmd.Parameters.AddWithValue("@at", ToIso(DateTimeOffset.UtcNow));
        cmd.Parameters.AddWithValue("@key", key);
        cmd.Parameters.AddWithValue("@event", eventName);
        cmd.Parameters.AddWithValue("@source", source.ToString());
        cmd.Parameters.AddWithValue("@code", code);
        cmd.Parameters.AddWithValue("@priority", priority.ToString());
        cmd.Parameters.AddWithValue("@message", message);
        cmd.Parameters.AddWithValue("@actor", (object?)actor ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
    }

    private static Alarm ReadAlarm(SqliteDataReader reader) => new(
        Id: reader.GetInt64(reader.GetOrdinal("id")),
        Key: reader.GetString(reader.GetOrdinal("key")),
        Source: Enum.Parse<AlarmSource>(reader.GetString(reader.GetOrdinal("source"))),
        Code: reader.GetString(reader.GetOrdinal("code")),
        Priority: Enum.Parse<AlarmPriority>(reader.GetString(reader.GetOrdinal("priority"))),
        State: Enum.Parse<AlarmState>(reader.GetString(reader.GetOrdinal("state"))),
        Message: reader.GetString(reader.GetOrdinal("message")),
        Runbook: GetNullableString(reader, "runbook"),
        TargetId: GetNullableString(reader, "target_id"),
        ClearOnAck: reader.GetInt64(reader.GetOrdinal("clear_on_ack")) != 0,
        Count: Convert.ToInt32(reader.GetInt64(reader.GetOrdinal("count")), CultureInfo.InvariantCulture),
        FirstRaisedUtc: ParseIso(reader.GetString(reader.GetOrdinal("first_raised_at"))),
        LastRaisedUtc: ParseIso(reader.GetString(reader.GetOrdinal("last_raised_at"))),
        AckedUtc: GetNullableString(reader, "acked_at") is { } ackedAt ? ParseIso(ackedAt) : null,
        AckedBy: GetNullableString(reader, "acked_by"));

    private static string? GetNullableString(SqliteDataReader reader, string column)
    {
        var ordinal = reader.GetOrdinal(column);
        return reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);
    }

    private static string ToIso(DateTimeOffset value) => value.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);

    private static DateTimeOffset ParseIso(string value) =>
        DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
}
