using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.Sqlite;

namespace St4i.EngineApi.Auth;

/// <summary>
/// WS-D-D3 — <see cref="IAuditStore"/> over <see cref="SecurityDb"/>'s <c>audit_log</c> table (added to
/// the SAME <c>security.db</c>/migration ladder D1 already built for <c>users</c> — this store shares
/// the file, not a second database). Same raw-<c>Microsoft.Data.Sqlite</c>, parameterized-SQL-only,
/// short-lived-connection-per-call shape as <see cref="SqliteUserStore"/>, PLUS one thing neither
/// <see cref="SqliteUserStore"/> nor <c>SqliteHistorianStore</c> need: a hash CHAIN, where each row's
/// <c>row_hash</c> commits to the previous row's <c>row_hash</c> (<c>prev_hash</c>) — so any later
/// tampering with an already-written row (editing a field, or deleting/reordering a row) is detectable
/// by <see cref="VerifyChainAsync"/> without needing a separate, out-of-band copy of the "real" history.
///
/// <b>Why <see cref="AppendAsync"/> needs an in-process lock that <see cref="SqliteUserStore"/>'s plain
/// per-call connections never needed:</b> computing a row's hash requires knowing BOTH its own seq AND
/// the previous row's <c>row_hash</c> — a "read the last row, then decide what to insert" TWO-STEP that
/// SQLite's own transaction isolation does not serialize for us. Two concurrent callers could each read
/// the same "last row" (e.g. id=5, hash=H5), each compute a would-be row 6 chained off H5, and then
/// happily insert two DIFFERENT rows both claiming <c>id=6</c>/<c>prev_hash=H5</c> — a real fork in the
/// chain, not just a duplicate-key error, because nothing about a single `INSERT` statement's own
/// atomicity prevents two SEPARATE statements from racing the read that precedes them. Wrapping the
/// entire read-last → compute-seq/hash → insert sequence in one <see cref="_appendLock"/>
/// (<see cref="SemaphoreSlim"/>, capacity 1) makes the whole operation logically single-threaded — the
/// concurrency test proves this by firing many <see cref="AppendAsync"/> calls at once via
/// <c>Task.WhenAll</c> and asserting every one lands a DISTINCT, CONTIGUOUS seq with no gaps or
/// collisions.
///
/// <b>Seq / explicit-id decision (documented per the task brief):</b> the hash preimage
/// (<see cref="ComputeRowHash"/>) includes the row's own <c>seq</c>, so the seq has to be KNOWN before
/// the hash can be computed — but <c>id INTEGER PRIMARY KEY AUTOINCREMENT</c> normally only assigns the
/// id AT insert time. Rather than "insert first with no id, read back <c>last_insert_rowid()</c>, hope
/// it matches what would've been hashed" (fragile: the hash would then be computed AFTER the row already
/// exists with a placeholder/wrong hash, needing a second UPDATE — exactly the kind of two-step mutation
/// an append-only store should avoid), this store computes the seq explicitly under the lock
/// (<c>lastId + 1</c>, or <c>1</c> for an empty table), computes the hash against THAT seq, then INSERTs
/// with an EXPLICIT <c>id</c> value equal to it. SQLite permits explicitly supplying the
/// <c>INTEGER PRIMARY KEY AUTOINCREMENT</c> column's value on insert (it only requires the value be
/// unique), so this keeps every row's stored <c>id</c> and its hash-committed <c>seq</c> equal BY
/// CONSTRUCTION, in one single-statement INSERT, with no follow-up read or correction step.
///
/// <b>client_ip-in-hash decision:</b> <see cref="AuditEntry.ClientIp"/> is stored but deliberately NOT
/// part of the hash preimage (see <see cref="ComputeRowHash"/>) — it's advisory/diagnostic metadata
/// (useful for "which network did this request come from" triage) rather than part of the tamper-evident
/// record of WHAT changed and WHO/WHAT ROLE did it; a NAT/proxy rewriting an IP in flight (or this store
/// simply not being told one — see <c>AuditRecorder</c>) shouldn't be able to break chain verification on
/// its own. <see cref="VerifyChainAsync"/> recomputes the SAME preimage shape (never includes
/// <c>client_ip</c> either), so Append and Verify stay consistent with each other.
/// </summary>
public sealed class SqliteAuditStore : IAuditStore
{
    private readonly SecurityDb _db;
    private readonly SemaphoreSlim _appendLock = new(1, 1);

    /// <summary>The 64×<c>'0'</c> sentinel <c>prev_hash</c> for the very first row in the chain — there
    /// is no real previous row to point at.</summary>
    private static readonly string GenesisPrevHash = new('0', 64);

    /// <summary>Test/diagnostic seam — the on-disk path this instance actually opened (mirrors
    /// <see cref="SqliteUserStore.DbPath"/>; tests use this to open a SECOND, raw connection to the same
    /// file for the tamper/chain-link-break scenarios <see cref="VerifyChainAsync"/> is meant to catch).</summary>
    public string DbPath => _db.DbPath;

    /// <param name="directory">Explicit directory override (tests); <see langword="null"/> resolves via
    /// <see cref="SecurityDb.ResolveRoot"/> (env var, then the default security root) — same convention
    /// as <see cref="SqliteUserStore"/>.</param>
    public SqliteAuditStore(string? directory = null)
    {
        _db = new SecurityDb(directory);
    }

    private const string Columns = """
        id, at_utc, actor_username, actor_role, action, target_type, target_id,
        old_value, new_value, correlation_id, client_ip, prev_hash, row_hash
        """;

    public async Task<AuditEntry> AppendAsync(AuditAppend e, CancellationToken ct)
    {
        await _appendLock.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            using var connection = await _db.OpenConnectionAsync(ct).ConfigureAwait(false);

            long lastId = 0;
            var prevHash = GenesisPrevHash;
            using (var lastCmd = connection.CreateCommand())
            {
                lastCmd.CommandText = "SELECT id, row_hash FROM audit_log ORDER BY id DESC LIMIT 1;";
                using var reader = await lastCmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
                if (await reader.ReadAsync(ct).ConfigureAwait(false))
                {
                    lastId = reader.GetInt64(0);
                    prevHash = reader.GetString(1);
                }
            }

            var seq = lastId + 1;
            var atUtcIso = ToIso(e.AtUtc);
            var rowHash = ComputeRowHash(
                seq, atUtcIso, e.ActorUsername, e.ActorRole, e.Action,
                e.TargetType, e.TargetId, e.OldValueJson, e.NewValueJson, e.CorrelationId, prevHash);

            using (var insertCmd = connection.CreateCommand())
            {
                // Explicit @id (== seq) — see this class's doc comment for why the seq has to be decided
                // BEFORE the insert (the hash preimage needs it) rather than read back afterward.
                insertCmd.CommandText = """
                    INSERT INTO audit_log
                        (id, at_utc, actor_username, actor_role, action, target_type, target_id,
                         old_value, new_value, correlation_id, client_ip, prev_hash, row_hash)
                    VALUES
                        (@id, @at_utc, @actor_username, @actor_role, @action, @target_type, @target_id,
                         @old_value, @new_value, @correlation_id, @client_ip, @prev_hash, @row_hash);
                    """;
                insertCmd.Parameters.AddWithValue("@id", seq);
                insertCmd.Parameters.AddWithValue("@at_utc", atUtcIso);
                insertCmd.Parameters.AddWithValue("@actor_username", e.ActorUsername);
                insertCmd.Parameters.AddWithValue("@actor_role", e.ActorRole);
                insertCmd.Parameters.AddWithValue("@action", e.Action);
                insertCmd.Parameters.AddWithValue("@target_type", (object?)e.TargetType ?? DBNull.Value);
                insertCmd.Parameters.AddWithValue("@target_id", (object?)e.TargetId ?? DBNull.Value);
                insertCmd.Parameters.AddWithValue("@old_value", (object?)e.OldValueJson ?? DBNull.Value);
                insertCmd.Parameters.AddWithValue("@new_value", (object?)e.NewValueJson ?? DBNull.Value);
                insertCmd.Parameters.AddWithValue("@correlation_id", (object?)e.CorrelationId ?? DBNull.Value);
                insertCmd.Parameters.AddWithValue("@client_ip", (object?)e.ClientIp ?? DBNull.Value);
                insertCmd.Parameters.AddWithValue("@prev_hash", prevHash);
                insertCmd.Parameters.AddWithValue("@row_hash", rowHash);
                await insertCmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
            }

            return new AuditEntry(
                seq, ParseIso(atUtcIso), e.ActorUsername, e.ActorRole, e.Action,
                e.TargetType, e.TargetId, e.OldValueJson, e.NewValueJson, e.CorrelationId, e.ClientIp,
                prevHash, rowHash);
        }
        finally
        {
            _appendLock.Release();
        }
    }

    /// <summary><paramref name="target"/> filters on <c>target_id</c> — the specific record identifier
    /// (e.g. a machine code, a username, a recipe code), the same role <c>serial</c> plays for
    /// <c>HistorianEndpoints.GetResultsAsync</c> — rather than <c>target_type</c> (the coarser "kind of
    /// thing" column), which a caller wanting that broader grouping can still get by pairing this with
    /// <paramref name="action"/> (actions are already namespaced per target type, e.g.
    /// <c>"recipe.update"</c>) or by paging the unfiltered set. Rows come back newest-first
    /// (<c>ORDER BY id DESC</c>) — same order/paging shape (COUNT(*) for <see cref="AuditPage.Total"/>,
    /// then a separate LIMIT/OFFSET SELECT) as <c>SqliteHistorianStore.QueryResultsAsync</c>.</summary>
    public async Task<AuditPage> QueryAsync(
        DateTimeOffset? from, DateTimeOffset? to, string? actor, string? action, string? target,
        int limit, int offset, CancellationToken ct)
    {
        using var connection = await _db.OpenConnectionAsync(ct).ConfigureAwait(false);

        var whereClauses = new List<string>();
        var parameters = new List<(string Name, object Value)>();

        if (from is not null)
        {
            whereClauses.Add("at_utc >= @from");
            parameters.Add(("@from", ToIso(from.Value)));
        }
        if (to is not null)
        {
            whereClauses.Add("at_utc <= @to");
            parameters.Add(("@to", ToIso(to.Value)));
        }
        if (actor is not null)
        {
            whereClauses.Add("actor_username = @actor");
            parameters.Add(("@actor", actor));
        }
        if (action is not null)
        {
            whereClauses.Add("action = @action");
            parameters.Add(("@action", action));
        }
        if (target is not null)
        {
            whereClauses.Add("target_id = @target");
            parameters.Add(("@target", target));
        }

        var whereSql = whereClauses.Count > 0 ? " WHERE " + string.Join(" AND ", whereClauses) : string.Empty;

        int total;
        using (var countCmd = connection.CreateCommand())
        {
            countCmd.CommandText = $"SELECT COUNT(*) FROM audit_log{whereSql};";
            foreach (var (name, value) in parameters) countCmd.Parameters.AddWithValue(name, value);
            total = Convert.ToInt32((long)(await countCmd.ExecuteScalarAsync(ct).ConfigureAwait(false))!, CultureInfo.InvariantCulture);
        }

        var items = new List<AuditEntry>();
        using (var selectCmd = connection.CreateCommand())
        {
            selectCmd.CommandText = $"""
                SELECT {Columns}
                FROM audit_log{whereSql}
                ORDER BY id DESC
                LIMIT @limit OFFSET @offset;
                """;
            foreach (var (name, value) in parameters) selectCmd.Parameters.AddWithValue(name, value);
            selectCmd.Parameters.AddWithValue("@limit", limit);
            selectCmd.Parameters.AddWithValue("@offset", offset);

            using var reader = await selectCmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
            while (await reader.ReadAsync(ct).ConfigureAwait(false))
            {
                items.Add(ReadRow(reader));
            }
        }

        return new AuditPage(items, total, limit, offset);
    }

    /// <summary>Walks every row ASCENDING by <c>id</c> (chain order), recomputing each row's hash from
    /// its OWN currently-stored fields (never from a cached/previously-trusted value) and checking two
    /// independent things per row: (1) its stored <c>prev_hash</c> equals the PREVIOUS row's <c>row_hash</c>
    /// (catches a deleted/reordered row — the next surviving row's link no longer matches anything), and
    /// (2) its stored <c>row_hash</c> equals what its own fields recompute to (catches an in-place edit of
    /// any hashed column). Returns on the FIRST row where either check fails — a tampered/broken chain
    /// only ever needs ONE counter-example, and reporting the first is more actionable than a full list.</summary>
    public async Task<AuditVerifyResult> VerifyChainAsync(CancellationToken ct)
    {
        using var connection = await _db.OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = $"SELECT {Columns} FROM audit_log ORDER BY id ASC;";

        var expectedPrevHash = GenesisPrevHash;
        using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        while (await reader.ReadAsync(ct).ConfigureAwait(false))
        {
            var row = ReadRow(reader);

            if (!string.Equals(row.PrevHash, expectedPrevHash, StringComparison.Ordinal))
            {
                return new AuditVerifyResult(
                    false, row.Seq,
                    $"Chain link broken at seq {row.Seq}: stored prev_hash does not match the previous row's row_hash (a row was deleted, reordered, or its prev_hash was edited).");
            }

            var recomputed = ComputeRowHash(
                row.Seq, ToIso(row.AtUtc), row.ActorUsername, row.ActorRole, row.Action,
                row.TargetType, row.TargetId, row.OldValueJson, row.NewValueJson, row.CorrelationId, row.PrevHash);

            if (!string.Equals(recomputed, row.RowHash, StringComparison.Ordinal))
            {
                return new AuditVerifyResult(
                    false, row.Seq,
                    $"Row hash mismatch at seq {row.Seq}: recomputing the hash from this row's currently-stored fields does not match its stored row_hash (the row was tampered with after being written).");
            }

            expectedPrevHash = row.RowHash;
        }

        return new AuditVerifyResult(true, null, "Chain verified OK.");
    }

    /// <summary>The exact hash preimage the task brief specifies: SHA-256 over the row's fields joined
    /// with <c>\x01</c> (a byte that can't appear in any of these UTF-8 string fields under normal use,
    /// so no field-boundary ambiguity), in this fixed order: seq, at_utc ("O"), actor_username,
    /// actor_role, action, target_type, target_id, old_value, new_value, correlation_id, prev_hash.
    /// <c>client_ip</c> is deliberately excluded — see this class's doc comment. Null string fields
    /// contribute an EMPTY string to the join (never the literal text "null"), so a null-vs-empty-string
    /// distinction on those columns is NOT part of what this hash protects (an accepted, documented
    /// simplification — the brief's own preimage spec does the same via <c>??""</c>). Returns lowercase
    /// hex, 64 characters (SHA-256's 32 bytes × 2).</summary>
    internal static string ComputeRowHash(
        long seq, string atUtcIso, string actorUsername, string actorRole, string action,
        string? targetType, string? targetId, string? oldValueJson, string? newValueJson,
        string? correlationId, string prevHash)
    {
        var preimage = string.Join(
            '\x01',
            seq.ToString(CultureInfo.InvariantCulture),
            atUtcIso,
            actorUsername,
            actorRole,
            action,
            targetType ?? string.Empty,
            targetId ?? string.Empty,
            oldValueJson ?? string.Empty,
            newValueJson ?? string.Empty,
            correlationId ?? string.Empty,
            prevHash);

        var hashBytes = SHA256.HashData(Encoding.UTF8.GetBytes(preimage));
        return Convert.ToHexString(hashBytes).ToLowerInvariant();
    }

    private static AuditEntry ReadRow(SqliteDataReader reader) => new(
        Seq: reader.GetInt64(reader.GetOrdinal("id")),
        AtUtc: ParseIso(reader.GetString(reader.GetOrdinal("at_utc"))),
        ActorUsername: reader.GetString(reader.GetOrdinal("actor_username")),
        ActorRole: reader.GetString(reader.GetOrdinal("actor_role")),
        Action: reader.GetString(reader.GetOrdinal("action")),
        TargetType: GetNullableString(reader, "target_type"),
        TargetId: GetNullableString(reader, "target_id"),
        OldValueJson: GetNullableString(reader, "old_value"),
        NewValueJson: GetNullableString(reader, "new_value"),
        CorrelationId: GetNullableString(reader, "correlation_id"),
        ClientIp: GetNullableString(reader, "client_ip"),
        PrevHash: reader.GetString(reader.GetOrdinal("prev_hash")),
        RowHash: reader.GetString(reader.GetOrdinal("row_hash")));

    private static string? GetNullableString(SqliteDataReader reader, string column)
    {
        var ordinal = reader.GetOrdinal(column);
        return reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);
    }

    private static string ToIso(DateTimeOffset value) => value.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);

    private static DateTimeOffset ParseIso(string value) =>
        DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
}
