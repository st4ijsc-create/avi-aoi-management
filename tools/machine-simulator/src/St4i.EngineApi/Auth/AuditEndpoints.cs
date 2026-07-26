using System.Globalization;
using St4i.EngineApi.Fleet;

namespace St4i.EngineApi.Auth;

/// <summary>
/// WS-D-D3 — the audit-log READ surface: <c>GET /v1/audit</c> (filtered/paged, mirrors
/// <c>HistorianEndpoints.GetResultsAsync</c>'s paging + date-parse-to-400 idiom exactly) and
/// <c>GET /v1/audit/verify</c> (runs <see cref="IAuditStore.VerifyChainAsync"/> and reports the result).
/// Both Admin-only (<see cref="Policies.Admin"/>) — an audit trail that any Operator/Engineer could read
/// would leak every other user's actions, and a verify endpoint is itself a sensitive "is anything
/// tampered with" signal. Writing to the audit log (via <see cref="AuditRecorder"/>, wired into each
/// mutating handler) is D4 — this task only lands the read/verify surface + the store/recorder it reads
/// from.
/// </summary>
public static class AuditEndpoints
{
    public static void MapAuditEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/audit", GetAuditAsync).RequireAuthorization(Policies.Admin);
        app.MapGet("/v1/audit/verify", GetVerifyAsync).RequireAuthorization(Policies.Admin);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/audit?from=&to=&actor=&action=&target=&limit=(200)&offset=(0)
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> GetAuditAsync(
        string? from, string? to, string? actor, string? action, string? target,
        int? limit, int? offset, IAuditStore store, CancellationToken ct)
    {
        DateTimeOffset? fromParsed = null;
        if (from is not null)
        {
            if (!TryParseDate(from, out var parsed)) return BadDate("from", from);
            fromParsed = parsed;
        }

        DateTimeOffset? toParsed = null;
        if (to is not null)
        {
            if (!TryParseDate(to, out var parsed)) return BadDate("to", to);
            toParsed = parsed;
        }

        // Same clamp-before-store reasoning as HistorianEndpoints.GetResultsAsync — an unclamped
        // negative/absurd caller-supplied limit would otherwise reach a parameterized `LIMIT`/`OFFSET`
        // unchecked.
        var clampedLimit = Math.Clamp(limit ?? 200, 1, 1000);
        var clampedOffset = Math.Max(offset ?? 0, 0);

        var page = await store.QueryAsync(fromParsed, toParsed, actor, action, target, clampedLimit, clampedOffset, ct)
            .ConfigureAwait(false);
        return Results.Ok(ToPageDto(page));
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/audit/verify
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> GetVerifyAsync(IAuditStore store, CancellationToken ct)
    {
        var result = await store.VerifyChainAsync(ct).ConfigureAwait(false);
        return Results.Ok(new AuditVerifyResultDto(result.Ok, result.FirstBrokenSeq, result.Detail));
    }

    private static AuditPageDto ToPageDto(AuditPage page) =>
        new(page.Items.Select(ToEntryDto).ToArray(), page.Total, page.Limit, page.Offset);

    private static AuditEntryDto ToEntryDto(AuditEntry e) => new(
        e.Seq, e.AtUtc, e.ActorUsername, e.ActorRole, e.Action, e.TargetType, e.TargetId,
        e.OldValueJson, e.NewValueJson, e.CorrelationId, e.ClientIp, e.PrevHash, e.RowHash);

    /// <summary>Same invariant, round-trip date parse as <c>HistorianEndpoints.TryParseDate</c> — a raw
    /// <c>string?</c> query parameter (never a directly-bound <c>DateTimeOffset?</c>) so an unparseable
    /// value 400s with a real body instead of a silently-empty framework-level 400.</summary>
    private static bool TryParseDate(string raw, out DateTimeOffset value) =>
        DateTimeOffset.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out value);

    private static IResult BadDate(string paramName, string raw) =>
        Results.BadRequest(new ApiErrorDto($"{paramName} is not a valid date/time: \"{raw}\"."));
}
