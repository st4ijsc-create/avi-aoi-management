using System.Globalization;
using St4i.EngineApi.Alarms;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Fleet;

namespace St4i.EngineApi.Endpoints;

/// <summary>
/// GĐ3 sub-4 LC-1 — the alarm HTTP surface: <c>GET /v1/alarms</c> (the live/active set, Operator),
/// <c>GET /v1/alarms/history</c> (the paged/filtered append-only event log, Operator), and
/// <c>POST /v1/alarms/{id}/ack</c> (Operator, audited <c>alarm.ack</c> — same "mutate THEN record" ordering
/// as <c>AssetEndpoints.SetLifecycleAsync</c>, so a 404 (unknown/already-cleared id) writes no audit row).
/// Same <c>internal static</c>, method-group-bound handler shape as every other <c>Map*Endpoints</c> file in
/// this project.
/// </summary>
public static class AlarmEndpoints
{
    public static void MapAlarmEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/alarms", ListActiveAsync).RequireAuthorization(Policies.Operator);
        app.MapGet("/v1/alarms/history", GetHistoryAsync).RequireAuthorization(Policies.Operator);
        app.MapPost("/v1/alarms/{id}/ack", AckAsync).RequireAuthorization(Policies.Operator);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/alarms
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> ListActiveAsync(IAlarmStore store, CancellationToken ct)
    {
        var alarms = await store.ListActiveAsync(ct).ConfigureAwait(false);
        return Results.Ok(alarms);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/alarms/history?source=&priority=&from=&to=&limit=(200)&offset=(0)
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> GetHistoryAsync(
        string? source, string? priority, string? from, string? to, int? limit, int? offset,
        IAlarmStore store, CancellationToken ct)
    {
        AlarmSource? sourceParsed = null;
        if (source is not null)
        {
            if (!Enum.TryParse<AlarmSource>(source, ignoreCase: true, out var parsed) || !Enum.IsDefined(parsed))
            {
                return Results.BadRequest(new ApiErrorDto($"'{source}' is not a valid alarm source."));
            }
            sourceParsed = parsed;
        }

        AlarmPriority? priorityParsed = null;
        if (priority is not null)
        {
            if (!Enum.TryParse<AlarmPriority>(priority, ignoreCase: true, out var parsed) || !Enum.IsDefined(parsed))
            {
                return Results.BadRequest(new ApiErrorDto($"'{priority}' is not a valid alarm priority."));
            }
            priorityParsed = parsed;
        }

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

        // Same clamp-before-store reasoning as AuditEndpoints.GetAuditAsync — an unclamped
        // negative/absurd caller-supplied limit would otherwise reach a parameterized `LIMIT`/`OFFSET`
        // unchecked.
        var clampedLimit = Math.Clamp(limit ?? 200, 1, 1000);
        var clampedOffset = Math.Max(offset ?? 0, 0);

        var page = await store.QueryHistoryAsync(
                new AlarmHistoryFilter(sourceParsed, priorityParsed, fromParsed, toParsed, clampedLimit, clampedOffset), ct)
            .ConfigureAwait(false);
        return Results.Ok(page);
    }

    // ─────────────────────────────────────────────────────────────────────
    // POST /v1/alarms/{id}/ack
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> AckAsync(
        long id, HttpContext context, IAlarmStore store, AuditRecorder recorder, CancellationToken ct)
    {
        var actor = context.User.Identity?.Name ?? "(anonymous)";

        var updated = await store.AckAsync(id, actor, ct).ConfigureAwait(false);
        if (updated is null)
        {
            return Results.NotFound(new ApiErrorDto($"Alarm '{id}' not found (or already cleared)."));
        }

        await recorder.RecordAsync(context, "alarm.ack", "alarm", updated.Key, null, new { updated.State }, ct)
            .ConfigureAwait(false);

        return Results.Ok(updated);
    }

    /// <summary>Same invariant, round-trip date parse as <c>AuditEndpoints.TryParseDate</c>.</summary>
    private static bool TryParseDate(string raw, out DateTimeOffset value) =>
        DateTimeOffset.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out value);

    private static IResult BadDate(string paramName, string raw) =>
        Results.BadRequest(new ApiErrorDto($"{paramName} is not a valid date/time: \"{raw}\"."));
}
