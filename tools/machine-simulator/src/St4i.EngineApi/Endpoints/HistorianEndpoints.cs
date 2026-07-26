using System.Globalization;
using St4i.EdgeCore.Historian;
using St4i.EngineApi.Fleet;

namespace St4i.EngineApi.Endpoints;

/// <summary>
/// Task 8 (WS-A) — the historian READ surface: <c>GET /v1/historian/results</c> (filtered/paged),
/// <c>GET /v1/historian/serial/{serial}</c>, <c>GET /v1/historian/telemetry</c>,
/// <c>GET /v1/historian/stats</c>, <c>POST /v1/historian/prune</c>. Thin mapping layer over the frozen
/// <see cref="IHistorianStore"/> contract (WS-A-T1/T2, already registered as a singleton in
/// <c>Program.cs</c> — this file re-registers nothing) — OEE endpoints (Task 9), CSV export (Task 10),
/// and PDF export (Task 11) are later tasks and deliberately absent here.
///
/// Same route/handler shape as <see cref="FleetEndpoints"/>/<see cref="MachineSettingsEndpoints"/>
/// (<c>internal static</c> handler methods bound by method group so tests can call them directly without
/// a TestServer) and the SAME "no St4i.EdgeCore.Config enum in these DTOs, so plain <c>Results.Ok</c> is
/// enough" reasoning <see cref="HistorianDtos"/> documents — no <c>ConfigJson.Options</c> detour needed.
///
/// Intentionally UNAUTHENTICATED — auth is WS-D, a later workstream.
/// </summary>
public static class HistorianEndpoints
{
    public static void MapHistorianEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/historian/results", GetResultsAsync);
        app.MapGet("/v1/historian/serial/{serial}", GetBySerialAsync);
        app.MapGet("/v1/historian/telemetry", GetTelemetryAsync);
        app.MapGet("/v1/historian/stats", GetStatsAsync);
        app.MapPost("/v1/historian/prune", PruneAsync);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/historian/results?machine=&from=&to=&serial=&verdict=&kind=&limit=&offset=
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> GetResultsAsync(
        string? machine, string? from, string? to, string? serial, string? verdict, string? kind,
        int? limit, int? offset, IHistorianStore store, CancellationToken ct)
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

        var query = new HistorianResultQuery(
            MachineCode: machine, From: fromParsed, To: toParsed, SerialNumber: serial,
            Verdict: verdict, ReadingKind: kind, Limit: limit ?? 200, Offset: offset ?? 0);

        var page = await store.QueryResultsAsync(query, ct).ConfigureAwait(false);
        return Results.Ok(ToPageDto(page));
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/historian/serial/{serial}
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> GetBySerialAsync(string serial, IHistorianStore store, CancellationToken ct)
    {
        var rows = await store.QueryBySerialAsync(serial, ct).ConfigureAwait(false);
        return Results.Ok(rows.Select(ToResultDto).ToArray());
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/historian/telemetry?machine=&metric=&from=&to=
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> GetTelemetryAsync(
        string? machine, string? metric, string? from, string? to, IHistorianStore store, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(machine)) return Results.BadRequest(new ApiErrorDto("machine is required."));
        if (string.IsNullOrWhiteSpace(metric)) return Results.BadRequest(new ApiErrorDto("metric is required."));
        if (from is null) return Results.BadRequest(new ApiErrorDto("from is required."));
        if (to is null) return Results.BadRequest(new ApiErrorDto("to is required."));

        if (!TryParseDate(from, out var fromParsed)) return BadDate("from", from);
        if (!TryParseDate(to, out var toParsed)) return BadDate("to", to);

        var points = await store.QueryTelemetryAsync(machine, metric, fromParsed, toParsed, ct).ConfigureAwait(false);
        return Results.Ok(points.Select(p => new TelemetryPointDto(p.At, p.Value)).ToArray());
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/historian/stats
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> GetStatsAsync(IHistorianStore store, CancellationToken ct)
    {
        var stats = await store.GetStatsAsync(ct).ConfigureAwait(false);
        return Results.Ok(new HistorianStatsDto(
            stats.ResultRowCount, stats.TelemetryRowCount, stats.OldestEventTimeUtc, stats.NewestEventTimeUtc, stats.DbSizeBytes));
    }

    // ─────────────────────────────────────────────────────────────────────
    // POST /v1/historian/prune {olderThanDays}
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> PruneAsync(PruneRequest request, IHistorianStore store, CancellationToken ct)
    {
        if (request.OlderThanDays < 0)
        {
            return Results.BadRequest(new ApiErrorDto("olderThanDays must be >= 0."));
        }

        var cutoffUtc = DateTimeOffset.UtcNow.AddDays(-request.OlderThanDays);
        var deleted = await store.PruneOlderThanAsync(cutoffUtc, ct).ConfigureAwait(false);
        return Results.Ok(new PruneResultDto(deleted));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Shared helpers
    // ─────────────────────────────────────────────────────────────────────

    private static HistorianResultsPageDto ToPageDto(HistorianResultsPage page) =>
        new(page.Items.Select(ToResultDto).ToArray(), page.Total, page.Limit, page.Offset);

    private static HistorianResultDto ToResultDto(HistorianResultRow row)
    {
        var r = row.Record;
        return new HistorianResultDto(
            row.Id, r.MachineCode, r.DeviceClass, r.MachineType, r.ReadingKind,
            r.CycleCounter, r.SerialNumber, r.Verdict, r.RecipeCode, r.RecipeVersion,
            r.KeyMetricName, r.KeyMetricValue, r.KeyMetricUnit, r.NgCount, r.PointCount,
            r.AckSuccess, r.AckDuplicate, r.AckQueued, r.EventTimeUtc, r.IngestedAtUtc);
    }

    /// <summary>Invariant, round-trip ("O"-compatible) <see cref="DateTimeOffset"/> parse for the
    /// <c>from</c>/<c>to</c> query params — a raw <c>string?</c> parameter (never a directly-bound
    /// <c>DateTimeOffset?</c> minimal-API parameter) so an unparseable value 400s with a real,
    /// non-empty, actionable body instead of risking the same framework-level "silently empty 400"
    /// gotcha <see cref="MachineSettingsEndpoints.TryParseScope"/>'s doc comment warns about for
    /// directly-bound enum query parameters.</summary>
    private static bool TryParseDate(string raw, out DateTimeOffset value) =>
        DateTimeOffset.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out value);

    private static IResult BadDate(string paramName, string raw) =>
        Results.BadRequest(new ApiErrorDto($"{paramName} is not a valid date/time: \"{raw}\"."));
}
