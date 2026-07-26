namespace St4i.EngineApi.Auth;

/// <summary>WS-D-D3 — one row of the hash-chained <c>audit_log</c> table — tamper-EVIDENT against
/// casual/accidental/app-level modification only (see <see cref="SqliteAuditStore"/>'s doc comment for
/// the full, honest threat model — it is NOT resistant to a local actor with direct write access to
/// <c>security.db</c>). See <see cref="SecurityDb"/>'s migration ladder for the exact DDL. <see cref="Seq"/> IS the table's
/// <c>id</c> column — the hash chain's canonical order — never a separately-maintained counter (see
/// <see cref="SqliteAuditStore"/>'s doc comment for why the stored <c>id</c> and the hash-chain
/// <c>seq</c> baked into <see cref="RowHash"/> are guaranteed to be the SAME number). <see cref="PrevHash"/>
/// is the PREVIOUS row's <see cref="RowHash"/> (64×<c>'0'</c> for the very first row) and
/// <see cref="RowHash"/> is this row's own SHA-256 digest over its fields — see
/// <see cref="SqliteAuditStore.ComputeRowHash"/> for the exact preimage. <see cref="ClientIp"/> is
/// deliberately NOT part of that preimage (advisory metadata only — see that method's doc comment for
/// why).</summary>
public sealed record AuditEntry(
    long Seq,
    DateTimeOffset AtUtc,
    string ActorUsername,
    string ActorRole,
    string Action,
    string? TargetType,
    string? TargetId,
    string? OldValueJson,
    string? NewValueJson,
    string? CorrelationId,
    string? ClientIp,
    string PrevHash,
    string RowHash);

/// <summary>Everything a caller supplies to append one audit row — deliberately excludes
/// <see cref="AuditEntry.Seq"/>/<see cref="AuditEntry.PrevHash"/>/<see cref="AuditEntry.RowHash"/>
/// (those are computed by <see cref="IAuditStore.AppendAsync"/> itself, under its lock, never supplied
/// by the caller).</summary>
public sealed record AuditAppend(
    string ActorUsername,
    string ActorRole,
    string Action,
    string? TargetType,
    string? TargetId,
    string? OldValueJson,
    string? NewValueJson,
    string? CorrelationId,
    string? ClientIp,
    DateTimeOffset AtUtc);

/// <summary>A page of <see cref="AuditEntry"/> rows — same shape/paging discipline as
/// <c>HistorianResultsPage</c> (WS-A Task 8): <see cref="Total"/> is the FULL filtered count (ignoring
/// <see cref="Limit"/>/<see cref="Offset"/>), so a caller can page through the whole filtered set.</summary>
public sealed record AuditPage(IReadOnlyList<AuditEntry> Items, int Total, int Limit, int Offset);

/// <summary><see cref="Ok"/> is <see langword="false"/> the moment ANY row's stored <c>row_hash</c>
/// doesn't match what its own fields recompute to, OR any row's stored <c>prev_hash</c> doesn't equal
/// the previous row's <c>row_hash</c> (a deleted/reordered row breaks the link even if every remaining
/// row's OWN hash still recomputes fine). <see cref="FirstBrokenSeq"/> is the <see cref="AuditEntry.Seq"/>
/// of the FIRST row (walking ascending by id) where either check fails — <see langword="null"/> only
/// when <see cref="Ok"/> is <see langword="true"/>.</summary>
public sealed record AuditVerifyResult(bool Ok, long? FirstBrokenSeq, string Detail);

/// <summary>WS-D-D3 — append-only, hash-chained audit log over <c>security.db</c>'s <c>audit_log</c>
/// table (added to <see cref="SecurityDb"/>'s migration ladder). Deliberately exposes NO update/delete
/// method — <see cref="AppendAsync"/> is the only write path this interface offers, by design (an
/// append-only log that can still be mutated through its own store interface would defeat even the
/// modest, casual/accidental/app-level tamper-evidence this store aims for — see
/// <see cref="SqliteAuditStore"/>'s doc comment for what that tamper-evidence does and does NOT cover).
/// <see cref="SqliteAuditStore"/> is the sole implementation.</summary>
public interface IAuditStore
{
    /// <summary>Appends one row under an in-process lock covering the WHOLE read-last-row →
    /// compute-seq/hash → insert sequence (see <see cref="SqliteAuditStore"/>'s doc comment for why
    /// SQLite's own transaction/locking isn't enough on its own here). Returns the fully-populated
    /// <see cref="AuditEntry"/> (including the <see cref="AuditEntry.Seq"/>/<see cref="AuditEntry.PrevHash"/>/
    /// <see cref="AuditEntry.RowHash"/> the store computed) so a caller never has to re-query to learn
    /// its own just-appended row's seq.</summary>
    Task<AuditEntry> AppendAsync(AuditAppend e, CancellationToken ct);

    /// <summary>Filtered/paged read — <paramref name="target"/> matches <c>target_id</c> (see
    /// <see cref="SqliteAuditStore.QueryAsync"/>'s doc comment for why that column, not <c>target_type</c>,
    /// is what a caller filters "target" on). Returns rows newest-first (<c>ORDER BY id DESC</c>) — same
    /// order <c>HistorianEndpoints</c>' <c>QueryResultsAsync</c> already uses for its own results page.</summary>
    Task<AuditPage> QueryAsync(
        DateTimeOffset? from, DateTimeOffset? to, string? actor, string? action, string? target,
        int limit, int offset, CancellationToken ct);

    /// <summary>Walks every row ascending by <c>id</c>, recomputing each row's hash from its OWN stored
    /// fields and checking the chain link to the previous row — see <see cref="AuditVerifyResult"/>'s
    /// doc comment for exactly what "broken" means here.</summary>
    Task<AuditVerifyResult> VerifyChainAsync(CancellationToken ct);
}
