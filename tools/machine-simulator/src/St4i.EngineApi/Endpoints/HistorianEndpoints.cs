using System.Globalization;
using St4i.EdgeCore.Historian;
using St4i.EdgeCore.Metrics;
using St4i.EdgeCore.Models;
using St4i.EngineApi.Fleet;

namespace St4i.EngineApi.Endpoints;

/// <summary>
/// Task 8 (WS-A) — the historian READ surface: <c>GET /v1/historian/results</c> (filtered/paged),
/// <c>GET /v1/historian/serial/{serial}</c>, <c>GET /v1/historian/telemetry</c>,
/// <c>GET /v1/historian/stats</c>, <c>POST /v1/historian/prune</c>. Thin mapping layer over the frozen
/// <see cref="IHistorianStore"/> contract (WS-A-T1/T2, already registered as a singleton in
/// <c>Program.cs</c> — this file re-registers nothing) — OEE endpoints (Task 9, added below), CSV export
/// (Task 10), and PDF export (Task 11) are later tasks; the latter two are deliberately absent here.
///
/// Task 9 (WS-A) — the OEE surface: <c>GET /v1/historian/oee</c> (single machine), <c>GET
/// /v1/historian/oee/fleet</c> (one <see cref="OeeResultDto"/> per roster machine), <c>GET</c>/<c>PUT
/// /v1/historian/oee/settings</c>. Pure glue over already-frozen components — no new math, no new
/// storage: <see cref="OeeCalculator.Calculate"/> (WS-A-T4) does the A×P×Q + loss-bucket math,
/// <see cref="IHistorianStore.AggregateForOeeAsync"/> (WS-A-T2) supplies the counts/run-time, and
/// <see cref="OeeSettingsStore"/> (WS-A-T5) supplies the per-machine ideal-cycle override + planned-
/// production ratio. The one new piece is resolving "which machines exist and what's each one's default
/// ideal cycle time" — <see cref="FleetHost.Fleet"/> (an <c>IReadOnlyList{MachineDescriptor}</c> point-in-
/// time snapshot of the live roster, already used the same way by <see cref="MachineSettingsEndpoints"/>'s
/// own <c>FindMachine</c>) is that source; <see cref="MachineDescriptor.CycleSeconds"/> is the ideal-cycle
/// fallback whenever <see cref="OeeSettingsStore"/> has no override on file for a machine.
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

        app.MapGet("/v1/historian/oee", GetOeeAsync);
        app.MapGet("/v1/historian/oee/fleet", GetOeeFleetAsync);
        app.MapGet("/v1/historian/oee/settings", GetOeeSettings);
        app.MapPut("/v1/historian/oee/settings", PutOeeSettings);
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
    // GET /v1/historian/oee?machine=&from=&to=
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> GetOeeAsync(
        string? machine, string? from, string? to,
        IHistorianStore store, OeeSettingsStore settingsStore, FleetHost fleetHost, CancellationToken ct)
    {
        var descriptor = FindMachine(fleetHost, machine);
        if (descriptor is null) return MachineNotFound(machine);

        if (!TryResolveRange(from, to, out var fromParsed, out var toParsed, out var rangeError)) return rangeError!;

        var dto = await ComputeOeeAsync(descriptor, fromParsed, toParsed, store, settingsStore, ct).ConfigureAwait(false);
        return Results.Ok(dto);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/historian/oee/fleet?from=&to=
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> GetOeeFleetAsync(
        string? from, string? to, IHistorianStore store, OeeSettingsStore settingsStore, FleetHost fleetHost, CancellationToken ct)
    {
        if (!TryResolveRange(from, to, out var fromParsed, out var toParsed, out var rangeError)) return rangeError!;

        var results = new List<OeeResultDto>();
        foreach (var descriptor in fleetHost.Fleet)
        {
            results.Add(await ComputeOeeAsync(descriptor, fromParsed, toParsed, store, settingsStore, ct).ConfigureAwait(false));
        }

        return Results.Ok(results.ToArray());
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/historian/oee/settings?machine=
    // ─────────────────────────────────────────────────────────────────────
    internal static IResult GetOeeSettings(string? machine, OeeSettingsStore settingsStore, FleetHost fleetHost)
    {
        var descriptor = FindMachine(fleetHost, machine);
        if (descriptor is null) return MachineNotFound(machine);

        var settings = settingsStore.Resolve(descriptor.Code, descriptor.CycleSeconds);
        return Results.Ok(ToSettingsDto(descriptor, settings));
    }

    // ─────────────────────────────────────────────────────────────────────
    // PUT /v1/historian/oee/settings?machine= {idealCycleSecondsOverride?, plannedProductionRatio?}
    // ─────────────────────────────────────────────────────────────────────
    internal static IResult PutOeeSettings(
        string? machine, OeeSettingsUpdateRequest request, OeeSettingsStore settingsStore, FleetHost fleetHost)
    {
        var descriptor = FindMachine(fleetHost, machine);
        if (descriptor is null) return MachineNotFound(machine);

        try
        {
            var updated = settingsStore.Set(descriptor.Code, request.IdealCycleSecondsOverride, request.PlannedProductionRatio);
            return Results.Ok(ToSettingsDto(descriptor, updated));
        }
        catch (ArgumentOutOfRangeException ex)
        {
            return Results.BadRequest(new ApiErrorDto(ex.Message));
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // OEE helpers
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>The exact glue sequence the Task 9 brief spells out: resolve this machine's settings →
    /// the effective ideal cycle (override, else the roster's own <see cref="MachineDescriptor.CycleSeconds"/>)
    /// → planned production time (the requested window scaled by the settings' ratio) → the aggregate
    /// counts/run-time from the historian → <see cref="OeeCalculator.Calculate"/>.</summary>
    private static async Task<OeeResultDto> ComputeOeeAsync(
        MachineDescriptor descriptor, DateTimeOffset from, DateTimeOffset to,
        IHistorianStore store, OeeSettingsStore settingsStore, CancellationToken ct)
    {
        var settings = settingsStore.Resolve(descriptor.Code, descriptor.CycleSeconds);
        var idealCycle = settings.IdealCycleSecondsOverride ?? descriptor.CycleSeconds;
        var planned = TimeSpan.FromSeconds((to - from).TotalSeconds * settings.PlannedProductionRatio);

        var agg = await store.AggregateForOeeAsync(descriptor.Code, from, to, ct).ConfigureAwait(false);
        var result = OeeCalculator.Calculate(agg, planned, idealCycle);
        return ToResultDto(result);
    }

    private static OeeResultDto ToResultDto(OeeResult r) => new(
        r.MachineCode, r.From, r.To,
        r.Availability, r.Performance, r.Quality, r.Oee,
        r.PlannedProductionTime.TotalSeconds, r.RunTime.TotalSeconds,
        r.DowntimeLossTime.TotalSeconds, r.SpeedLossTime.TotalSeconds, r.QualityLossTime.TotalSeconds,
        r.TotalCount, r.GoodCount, r.IdealCycleSeconds);

    private static OeeSettingsDto ToSettingsDto(MachineDescriptor descriptor, OeeMachineSettings settings) => new(
        descriptor.Code,
        settings.IdealCycleSecondsOverride ?? descriptor.CycleSeconds,
        settings.IdealCycleSecondsOverride is not null,
        settings.PlannedProductionRatio);

    private static MachineDescriptor? FindMachine(FleetHost fleetHost, string? code) =>
        code is null ? null : fleetHost.Fleet.FirstOrDefault(d => string.Equals(d.Code, code, StringComparison.OrdinalIgnoreCase));

    private static IResult MachineNotFound(string? machine) =>
        Results.NotFound(new ApiErrorDto($"machine \"{machine}\" not found in the fleet roster."));

    /// <summary>Shared <c>from</c>/<c>to</c> window resolution for both OEE GET routes (brief: "same
    /// from?/to?" for <c>/oee</c> and <c>/oee/fleet</c>) — default <c>to</c> = now, default <c>from</c> =
    /// <c>to - 24h</c>, each independently overridable, both going through the SAME <see cref="TryParseDate"/>
    /// used everywhere else in this file so a bad value 400s identically.</summary>
    private static bool TryResolveRange(
        string? from, string? to, out DateTimeOffset fromParsed, out DateTimeOffset toParsed, out IResult? error)
    {
        error = null;
        toParsed = DateTimeOffset.UtcNow;
        if (to is not null)
        {
            if (!TryParseDate(to, out var parsedTo))
            {
                fromParsed = default;
                error = BadDate("to", to);
                return false;
            }

            toParsed = parsedTo;
        }

        fromParsed = toParsed - TimeSpan.FromHours(24);
        if (from is not null)
        {
            if (!TryParseDate(from, out var parsedFrom))
            {
                error = BadDate("from", from);
                return false;
            }

            fromParsed = parsedFrom;
        }

        return true;
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
