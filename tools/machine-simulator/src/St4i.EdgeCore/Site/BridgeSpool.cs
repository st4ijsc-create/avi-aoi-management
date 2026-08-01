using System.Globalization;
using Microsoft.Data.Sqlite;

namespace St4i.EdgeCore.Site;

/// <summary>One spooled northbound MQTT message: the raw topic/payload/retain triple <c>UnsBridge</c>'s
/// forward loop would otherwise drop on a Site outage, plus the monotonic <see cref="Seq"/>
/// <see cref="BridgeSpool"/> assigned it and the UTC instant it was enqueued.</summary>
public sealed record SpooledItem(long Seq, string Topic, byte[] Payload, bool Retain, DateTimeOffset EnqueuedUtc);

/// <summary>A snapshot of <see cref="BridgeSpool"/>'s current state. <see cref="MinSeq"/>/<see cref="MaxSeq"/>
/// and <see cref="OldestUtc"/> are <c>0</c>/<c>null</c> (never garbage) when <see cref="Depth"/> is 0.
/// <see cref="DroppedTotal"/> is the all-time count of rows <see cref="BridgeSpool.TrimAsync"/> has ever
/// dropped — it survives a restart (see that method's doc comment for why this must never reset).</summary>
public sealed record BridgeSpoolStats(long Depth, long MinSeq, long MaxSeq, long DroppedTotal, DateTimeOffset? OldestUtc);

/// <summary>The durable, ordered, bounded, never-throwing northbound spool. See <see cref="BridgeSpool"/>'s
/// own doc comment for the full contract each method must uphold.</summary>
public interface IBridgeSpool
{
    /// <summary>Appends one message, returning its assigned monotonic <see cref="SpooledItem.Seq"/>, or
    /// <c>-1</c> if the write failed (never throws).</summary>
    Task<long> EnqueueAsync(string topic, byte[] payload, bool retain, CancellationToken ct = default);

    /// <summary>Returns up to <paramref name="max"/> pending items in ascending <see cref="SpooledItem.Seq"/>
    /// order (oldest first — FIFO), or an empty list if the read failed (never throws).</summary>
    Task<IReadOnlyList<SpooledItem>> PeekBatchAsync(int max, CancellationToken ct = default);

    /// <summary>Deletes every item with <c>Seq &lt;= seq</c> — the caller's acknowledgment that everything
    /// up to and including that mark was successfully forwarded. A no-op (never throws) for an unknown/
    /// already-past mark.</summary>
    Task AckThroughAsync(long seq, CancellationToken ct = default);

    /// <summary>A point-in-time snapshot of depth/seq range/drop count/oldest-pending-age. Never throws —
    /// returns an all-zero/null snapshot on failure.</summary>
    Task<BridgeSpoolStats> StatsAsync(CancellationToken ct = default);

    /// <summary>Enforces the age and byte caps (drop-OLDEST-first for each), returns the number of rows
    /// actually dropped (0 on failure or when nothing needed trimming — never throws).</summary>
    Task<int> TrimAsync(CancellationToken ct = default);
}

/// <summary>
/// GĐ3 closeout WI-2 — <see cref="IBridgeSpool"/> on raw <c>Microsoft.Data.Sqlite</c> (no ORM), its OWN
/// SQLite file (<c>bridge-spool.db</c>) under <paramref name="directory"/> (else
/// <c>ST4I_BRIDGE_SPOOL_DIR</c>, else <see cref="DefaultRoot"/>) with a <c>PRAGMA user_version</c>-tracked
/// migration ladder and short-lived, WAL-mode connections — the SAME shape as
/// <see cref="St4i.EngineApi.Alarms.AlarmStore"/>/<see cref="St4i.EngineApi.AssetRegistry.AssetRegistryStore"/>
/// (see their doc comments for the rationale this class does not repeat). This is the STORE ONLY — it is
/// deliberately not wired into <c>UnsBridge</c> yet (that is WI-3); this task proves it in isolation.
///
/// <b>Why a new store and not the existing WAL</b> (<see cref="St4i.EdgeCore.Transport.WalOptions"/>/
/// <see cref="St4i.EdgeCore.Transport.WalMaintenance"/>): that WAL is bound to the vendored
/// <c>St4iDeviceClient</c> SDK's own <c>.jsonl</c> queue, keyed by machineCode, with its own
/// <c>FlushQueueAsync</c> semantics and text-line-oriented storage — not reusable for raw MQTT
/// topic/payload pairs whose payload is arbitrary Sparkplug B protobuf bytes (see the binary-fidelity
/// remarks below).
///
/// <b>Monotonic <see cref="SpooledItem.Seq"/> across ack + restart:</b> the <c>spool</c> table's primary
/// key is declared <c>INTEGER PRIMARY KEY AUTOINCREMENT</c> — deliberately NOT a plain
/// <c>INTEGER PRIMARY KEY</c> (an ordinary SQLite rowid). A plain rowid is reused: SQLite picks
/// <c>MAX(rowid) + 1</c> at insert time, so once every row is deleted (exactly what
/// <see cref="AckThroughAsync"/> does once the Site catches up) the very next insert would fall back to
/// rowid 1 — silently rewinding the sequence a downstream consumer (WI-3's resync record) relies on being
/// forever-increasing for this DB file's lifetime. <c>AUTOINCREMENT</c> instead tracks the historical high
/// watermark in SQLite's own internal <c>sqlite_sequence</c> table and never reuses a value below it, so
/// <see cref="EnqueueAsync"/>'s next assigned <see cref="SpooledItem.Seq"/> only ever goes up — across an
/// <see cref="AckThroughAsync"/> that empties the table, and across a process restart (a fresh
/// <see cref="BridgeSpool"/> instance opening the same <c>bridge-spool.db</c> file inherits
/// <c>sqlite_sequence</c>'s on-disk state). See <c>BridgeSpoolTests.Seq_NeverReused_EvenAfterTheTableIsFullyDrained</c>
/// for the proof.
///
/// <b>Byte-size measure for the <see cref="MaxBytes"/> cap:</b> <c>SUM(LENGTH(payload))</c> across every
/// row currently in <c>spool</c> — the sum of PAYLOAD bytes only (topic text and per-row overhead are not
/// counted). Deliberately NOT <c>page_count * page_size</c>: that measure includes WAL/freelist/index pages
/// and would drift with each connection's <c>PRAGMA</c>s and vacuum state, none of which is under this
/// class's control or easy to pin down in a test. <c>SUM(LENGTH(payload))</c> is a single, cheap,
/// deterministic aggregate query with no ambiguity about what a test should expect.
///
/// <b>Drop-oldest trim policy</b> (<see cref="TrimAsync"/>), same policy as
/// <see cref="St4i.EdgeCore.Transport.WalMaintenance.TrimDirectory"/>: age-based trim runs first (deletes
/// every row older than <see cref="MaxAgeHours"/>), then byte-based trim runs against whatever remains
/// (walks from the NEWEST row backward, keeping rows while they still fit the budget, so the OLDEST rows
/// are the ones dropped) — mirroring <see cref="St4i.EdgeCore.Transport.WalMaintenance.TrimFileToMaxBytes"/>'s
/// own backward-scan algorithm, including its "always keep at least the single newest row, even alone over
/// budget" guarantee (a huge single record is never annihilated to an empty spool). Both phases run inside
/// ONE transaction together with the <c>dropped_total</c> increment, so a crash mid-trim never leaves the
/// counter out of sync with what was actually deleted.
///
/// <b><c>dropped_total</c> survives a restart</b> because it lives in the <c>meta</c> key/value table
/// (SQLite storage, not an in-memory field) — WI-3 publishes it in a resync record so the Site can tell
/// exactly how much was lost while disconnected; an in-memory counter that reset to 0 on every process
/// restart would silently understate that loss.
///
/// <b>Binary fidelity:</b> <c>payload</c> is a SQLite <c>BLOB</c> column, bound/read as a raw
/// <c>byte[]</c> (<see cref="SqliteDataReader.GetFieldValue{T}"/>) — never routed through any text
/// encoding. This matters because the real payload type is Sparkplug B protobuf: arbitrary binary
/// including <c>0x00</c> bytes and bytes &gt;= 0x80, which would corrupt under any text-oriented storage
/// (e.g. the WAL's own JSONL-line format).
///
/// <b>Never throws:</b> every public method (<see cref="EnqueueAsync"/>/<see cref="PeekBatchAsync"/>/
/// <see cref="AckThroughAsync"/>/<see cref="StatsAsync"/>/<see cref="TrimAsync"/>) is wrapped in a
/// try/catch that reports the failure via <paramref name="logError"/> (usable, e.g., a full disk, a locked
/// file, or the DB directory vanishing out from under an already-open store) and returns its documented
/// safe value — never lets the exception escape to the caller (<c>UnsBridge</c>'s forward loop, in WI-3,
/// must never fail just because the spool hiccuped). Only the constructor is unguarded — same precedent as
/// <see cref="St4i.EngineApi.Alarms.AlarmStore"/>: a root that genuinely cannot be created at startup is a
/// fatal misconfiguration that should surface immediately, not be silently downgraded.
/// </summary>
public sealed class BridgeSpool : IBridgeSpool
{
    /// <summary>Directory override — same constant value as <see cref="BridgeSpoolOptions.EnvVarDir"/>, so
    /// the store can resolve its own root independently of that options bag. Unset or blank means "use
    /// <see cref="DefaultRoot"/>".</summary>
    public const string EnvVarDir = BridgeSpoolOptions.EnvVarDir;

    private const long DefaultMaxBytes = 64L * 1024 * 1024;
    private const int DefaultMaxAgeHours = 48;

    public string DbPath { get; }

    private readonly long _maxBytes;
    private readonly TimeSpan _maxAge;
    private readonly Action<Exception, string>? _logError;

    private static readonly string[] OpenPragmas =
    {
        "PRAGMA journal_mode=WAL;",
        "PRAGMA synchronous=NORMAL;",
        "PRAGMA busy_timeout=5000;",
        "PRAGMA foreign_keys=ON;",
    };

    // Ordered migration ladder — future spool-schema changes append a new (Version, Statements) entry
    // here; EnsureSchema() applies only the entries newer than the DB's current PRAGMA user_version, each
    // inside its own transaction. No migrator library — mirrors AlarmStore/AssetRegistryStore exactly.
    private static readonly (int Version, string[] Statements)[] Migrations =
    {
        (1, new[]
        {
            """
            CREATE TABLE IF NOT EXISTS spool (
              seq INTEGER PRIMARY KEY AUTOINCREMENT,
              topic TEXT NOT NULL,
              payload BLOB NOT NULL,
              retain INTEGER NOT NULL,
              enqueued_at TEXT NOT NULL);
            """,
            "CREATE INDEX IF NOT EXISTS ix_spool_enqueued_at ON spool(enqueued_at);",
            """
            CREATE TABLE IF NOT EXISTS meta (
              key TEXT PRIMARY KEY,
              value TEXT);
            """,
        }),
    };

    /// <param name="directory">Explicit directory override (tests), or <see langword="null"/> to resolve
    /// via <see cref="ResolveRoot"/> (env var, then <see cref="DefaultRoot"/>).</param>
    /// <param name="maxBytes">Total payload-byte budget enforced by <see cref="TrimAsync"/>. A non-positive
    /// value falls back to the 64 MiB default rather than disabling the cap.</param>
    /// <param name="maxAgeHours">Maximum item age, in hours, enforced by <see cref="TrimAsync"/>. A
    /// non-positive value falls back to the 48h default.</param>
    /// <param name="logError">Where a swallowed failure is reported. Optional — a <see langword="null"/>
    /// logger just means the failure is silently swallowed (still never thrown).</param>
    public BridgeSpool(
        string? directory = null,
        long maxBytes = DefaultMaxBytes,
        int maxAgeHours = DefaultMaxAgeHours,
        Action<Exception, string>? logError = null)
    {
        _maxBytes = maxBytes > 0 ? maxBytes : DefaultMaxBytes;
        _maxAge = TimeSpan.FromHours(maxAgeHours > 0 ? maxAgeHours : DefaultMaxAgeHours);
        _logError = logError;

        var root = ResolveRoot(directory);
        Directory.CreateDirectory(root);
        DbPath = Path.Combine(root, "bridge-spool.db");
        EnsureSchema();
    }

    /// <summary>The default spool root: <c>%ProgramData%\ST4I\sim\bridge-spool</c> — a SIBLING of
    /// <c>...\sim\sitelink</c>/<c>...\sim\alarms</c>/<c>...\sim\wal</c>, never the same directory.</summary>
    public static string DefaultRoot() => BridgeSpoolOptions.DefaultRoot();

    /// <summary>Resolves the effective spool directory: <paramref name="directory"/> if given, else
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
    // EnqueueAsync — NEVER throws. Returns -1 on failure.
    // ─────────────────────────────────────────────────────────────────────

    public async Task<long> EnqueueAsync(string topic, byte[] payload, bool retain, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(topic) || payload is null) return -1;

        try
        {
            using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);

            using (var cmd = connection.CreateCommand())
            {
                cmd.CommandText = """
                    INSERT INTO spool (topic, payload, retain, enqueued_at)
                    VALUES (@topic, @payload, @retain, @enqueued_at);
                    """;
                cmd.Parameters.AddWithValue("@topic", topic);
                cmd.Parameters.AddWithValue("@payload", payload);
                cmd.Parameters.AddWithValue("@retain", retain ? 1 : 0);
                cmd.Parameters.AddWithValue("@enqueued_at", ToIso(DateTimeOffset.UtcNow));
                await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
            }

            using (var idCmd = connection.CreateCommand())
            {
                idCmd.CommandText = "SELECT last_insert_rowid();";
                var result = await idCmd.ExecuteScalarAsync(ct).ConfigureAwait(false);
                return Convert.ToInt64(result, CultureInfo.InvariantCulture);
            }
        }
        catch (Exception ex)
        {
            // Deliberately swallowed — see this class's doc comment: UnsBridge's forward loop must never
            // fail just because bridge-spool.db hiccuped. The message is simply lost, same as today's
            // silent drop, but the drop is now surfaced via logError instead of being invisible.
            _logError?.Invoke(ex, $"BridgeSpool enqueue failed for topic '{topic}' — this message was not spooled.");
            return -1;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // PeekBatchAsync — ascending seq (FIFO). NEVER throws. Empty list on failure.
    // ─────────────────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<SpooledItem>> PeekBatchAsync(int max, CancellationToken ct = default)
    {
        if (max <= 0) return Array.Empty<SpooledItem>();

        try
        {
            using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
            using var cmd = connection.CreateCommand();
            cmd.CommandText = "SELECT seq, topic, payload, retain, enqueued_at FROM spool ORDER BY seq ASC LIMIT @max;";
            cmd.Parameters.AddWithValue("@max", max);

            var results = new List<SpooledItem>();
            using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
            while (await reader.ReadAsync(ct).ConfigureAwait(false))
            {
                results.Add(new SpooledItem(
                    Seq: reader.GetInt64(0),
                    Topic: reader.GetString(1),
                    Payload: reader.GetFieldValue<byte[]>(2),
                    Retain: reader.GetInt64(3) != 0,
                    EnqueuedUtc: ParseIso(reader.GetString(4))));
            }
            return results;
        }
        catch (Exception ex)
        {
            _logError?.Invoke(ex, "BridgeSpool PeekBatchAsync failed.");
            return Array.Empty<SpooledItem>();
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // AckThroughAsync — delete the prefix seq <= mark. NEVER throws.
    // ─────────────────────────────────────────────────────────────────────

    public async Task AckThroughAsync(long seq, CancellationToken ct = default)
    {
        try
        {
            using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
            using var cmd = connection.CreateCommand();
            cmd.CommandText = "DELETE FROM spool WHERE seq <= @seq;";
            cmd.Parameters.AddWithValue("@seq", seq);
            await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logError?.Invoke(ex, $"BridgeSpool AckThroughAsync failed for seq {seq}.");
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // StatsAsync — NEVER throws. All-zero/null snapshot on failure.
    // ─────────────────────────────────────────────────────────────────────

    public async Task<BridgeSpoolStats> StatsAsync(CancellationToken ct = default)
    {
        try
        {
            using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);

            long depth = 0, minSeq = 0, maxSeq = 0;
            DateTimeOffset? oldest = null;
            using (var cmd = connection.CreateCommand())
            {
                cmd.CommandText = "SELECT COUNT(*), MIN(seq), MAX(seq), MIN(enqueued_at) FROM spool;";
                using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
                if (await reader.ReadAsync(ct).ConfigureAwait(false))
                {
                    depth = reader.GetInt64(0);
                    minSeq = reader.IsDBNull(1) ? 0 : reader.GetInt64(1);
                    maxSeq = reader.IsDBNull(2) ? 0 : reader.GetInt64(2);
                    oldest = reader.IsDBNull(3) ? null : ParseIso(reader.GetString(3));
                }
            }

            var droppedTotal = await ReadDroppedTotalAsync(connection, ct).ConfigureAwait(false);
            return new BridgeSpoolStats(depth, minSeq, maxSeq, droppedTotal, oldest);
        }
        catch (Exception ex)
        {
            _logError?.Invoke(ex, "BridgeSpool StatsAsync failed.");
            return new BridgeSpoolStats(0, 0, 0, 0, null);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // TrimAsync — drop-oldest by age then by bytes, in one transaction with the dropped_total increment.
    // NEVER throws. Returns 0 on failure or when nothing needed trimming.
    // ─────────────────────────────────────────────────────────────────────

    public async Task<int> TrimAsync(CancellationToken ct = default)
    {
        try
        {
            using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
            using var transaction = connection.BeginTransaction();

            var ageDropped = await TrimByAgeAsync(connection, transaction, ct).ConfigureAwait(false);
            var bytesDropped = await TrimByBytesAsync(connection, transaction, ct).ConfigureAwait(false);
            var totalDropped = ageDropped + bytesDropped;

            if (totalDropped > 0)
            {
                await IncrementDroppedTotalAsync(connection, transaction, totalDropped, ct).ConfigureAwait(false);
            }

            transaction.Commit();
            return totalDropped;
        }
        catch (Exception ex)
        {
            _logError?.Invoke(ex, "BridgeSpool TrimAsync failed.");
            return 0;
        }
    }

    private async Task<int> TrimByAgeAsync(SqliteConnection connection, SqliteTransaction transaction, CancellationToken ct)
    {
        var cutoff = ToIso(DateTimeOffset.UtcNow - _maxAge);
        using var cmd = connection.CreateCommand();
        cmd.Transaction = transaction;
        cmd.CommandText = "DELETE FROM spool WHERE enqueued_at < @cutoff;";
        cmd.Parameters.AddWithValue("@cutoff", cutoff);
        return await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
    }

    private async Task<int> TrimByBytesAsync(SqliteConnection connection, SqliteTransaction transaction, CancellationToken ct)
    {
        // Load (seq, payload length) ascending (oldest first) — same "read the whole set, decide in
        // memory" approach as WalMaintenance.TrimFileToMaxBytes, and cheap at this store's bounded scale.
        var rows = new List<(long Seq, long Len)>();
        using (var cmd = connection.CreateCommand())
        {
            cmd.Transaction = transaction;
            cmd.CommandText = "SELECT seq, LENGTH(payload) FROM spool ORDER BY seq ASC;";
            using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
            while (await reader.ReadAsync(ct).ConfigureAwait(false))
            {
                rows.Add((reader.GetInt64(0), reader.GetInt64(1)));
            }
        }

        if (rows.Count == 0) return 0;

        var totalBytes = rows.Sum(r => r.Len);
        if (totalBytes <= _maxBytes) return 0;

        // Walk from the newest (last) row backward, counting how many trailing rows fit the budget. The
        // `keepCount > 0` guard guarantees at least the single newest row always survives, even alone over
        // budget — same guarantee as WalMaintenance.TrimFileToMaxBytes.
        var keepCount = 0;
        var keptBytes = 0L;
        for (var i = rows.Count - 1; i >= 0; i--)
        {
            var len = rows[i].Len;
            if (keepCount > 0 && keptBytes + len > _maxBytes) break;
            keepCount++;
            keptBytes += len;
        }

        var dropCount = rows.Count - keepCount;
        if (dropCount <= 0) return 0;

        // The oldest `dropCount` rows are exactly those with the smallest seqs (seq is assigned in
        // insertion order) — delete everything at or below the largest seq among them.
        var cutoffSeq = rows[dropCount - 1].Seq;

        using var delCmd = connection.CreateCommand();
        delCmd.Transaction = transaction;
        delCmd.CommandText = "DELETE FROM spool WHERE seq <= @cutoffSeq;";
        delCmd.Parameters.AddWithValue("@cutoffSeq", cutoffSeq);
        return await delCmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
    }

    private static async Task IncrementDroppedTotalAsync(
        SqliteConnection connection, SqliteTransaction transaction, int delta, CancellationToken ct)
    {
        using var cmd = connection.CreateCommand();
        cmd.Transaction = transaction;
        cmd.CommandText = """
            INSERT INTO meta (key, value) VALUES ('dropped_total', @delta)
            ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + @delta AS TEXT);
            """;
        cmd.Parameters.AddWithValue("@delta", delta);
        await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
    }

    private static async Task<long> ReadDroppedTotalAsync(SqliteConnection connection, CancellationToken ct)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = "SELECT value FROM meta WHERE key = 'dropped_total';";
        var result = await cmd.ExecuteScalarAsync(ct).ConfigureAwait(false);
        if (result is null || result is DBNull) return 0;
        return long.TryParse(Convert.ToString(result, CultureInfo.InvariantCulture), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : 0;
    }

    // ─────────────────────────────────────────────────────────────────────
    // ISO-8601 helpers
    // ─────────────────────────────────────────────────────────────────────

    private static string ToIso(DateTimeOffset value) => value.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);

    private static DateTimeOffset ParseIso(string value) =>
        DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
}
