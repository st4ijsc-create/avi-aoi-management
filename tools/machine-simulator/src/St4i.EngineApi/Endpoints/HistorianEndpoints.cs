using System.Globalization;
using System.Text;
using MigraDoc.DocumentObjectModel;
using MigraDoc.Rendering;
using St4i.EdgeCore.Config;
using St4i.EdgeCore.Historian;
using St4i.EdgeCore.Metrics;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Fleet;

namespace St4i.EngineApi.Endpoints;

/// <summary>
/// Task 8 (WS-A) — the historian READ surface: <c>GET /v1/historian/results</c> (filtered/paged),
/// <c>GET /v1/historian/serial/{serial}</c>, <c>GET /v1/historian/telemetry</c>,
/// <c>GET /v1/historian/stats</c>, <c>POST /v1/historian/prune</c>. Thin mapping layer over the frozen
/// <see cref="IHistorianStore"/> contract (WS-A-T1/T2, already registered as a singleton in
/// <c>Program.cs</c> — this file re-registers nothing) — OEE endpoints (Task 9), CSV export (Task 10),
/// and PDF export (Task 11) are added below.
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
/// Task 10 (WS-A) — the CSV export surface: <c>GET /v1/historian/results/export.csv</c>, the SAME
/// machine/from/to/serial/verdict/kind filters as <c>GET /v1/historian/results</c> (Task 8) but no
/// limit/offset — it exports the FULL filtered set. <see cref="IHistorianStore.QueryResultsAsync"/> is
/// frozen and paginated, so "the full set" is produced by paging through it internally (a fixed
/// <see cref="ExportPageSize"/>, increasing <c>Offset</c>, until a page comes back short — see
/// <see cref="BuildExportCsvAsync"/>) rather than by ever passing <c>int.MaxValue</c> as one <c>Limit</c>.
/// The CSV itself is hand-rolled RFC-4180 (no CsvHelper/new dependency — see <see cref="AppendCsvRow"/>'s
/// <see cref="EscapeCsvField"/>), and the response is written through <see cref="CsvFileResult"/>, a
/// minimal private <see cref="IResult"/> that sets <c>Content-Type</c>/<c>Content-Disposition</c> and
/// writes the bytes directly — deliberately NOT the built-in <c>Results.File</c> (whose
/// <c>FileContentHttpResult.ExecuteAsync</c> unconditionally resolves an <c>ILoggerFactory</c> off
/// <c>HttpContext.RequestServices</c>, which is null both in this project's hand-built-<c>DefaultHttpContext</c>
/// test convention AND, unlike a full ASP.NET Core pipeline, in no test in this project needing a DI
/// container to exist).
///
/// Same route/handler shape as <see cref="FleetEndpoints"/>/<see cref="MachineSettingsEndpoints"/>
/// (<c>internal static</c> handler methods bound by method group so tests can call them directly without
/// a TestServer) and the SAME "no St4i.EdgeCore.Config enum in these DTOs, so plain <c>Results.Ok</c> is
/// enough" reasoning <see cref="HistorianDtos"/> documents — no <c>ConfigJson.Options</c> detour needed.
///
/// Task 11 (WS-A) — the PDF report surface: <c>GET /v1/historian/report.pdf</c>, a server-side, offline
/// shift/period summary PDF (OEE block + verdict breakdown) for one machine and time range, built with
/// <b>PDFsharp + MigraDoc</b> (package <c>PDFsharp-MigraDoc-GDI</c> 6.2.4 — MIT-style license, no revenue
/// threshold, unlike QuestPDF's Community license; pre-approved per the Task 11 brief). Pure glue, same
/// discipline as Task 9/10: <see cref="ComputeOeeAsync"/> (the SAME helper <c>/oee</c> uses — never a
/// second OEE formula) supplies the OEE block, and <see cref="ComputeVerdictBreakdownAsync"/> pages
/// through the frozen <see cref="IHistorianStore.QueryResultsAsync"/> (same <see cref="ExportPageSize"/>
/// paging convention as Task 10's CSV export) to tally raw verdict counts — deliberately NOT restricted
/// to <c>ReadingKind == "ProcessResult"</c> the way <see cref="IHistorianStore.AggregateForOeeAsync"/>'s
/// OEE counts are, so the breakdown table reflects everything the historian saw in the window (including
/// any <c>Skip</c> rows the OEE's <c>TotalCount</c> itself excludes — the two numbers are allowed, even
/// expected, to differ). <see cref="BuildReportPdf"/> renders the document via MigraDoc's object model
/// (<see cref="Document"/>/<see cref="Section"/>/<c>Table</c>) through a <see cref="PdfDocumentRenderer"/>
/// straight into a <see cref="MemoryStream"/> — never a temp file on disk. Empty-period robustness (the
/// brief's explicit "zero results must still yield a valid PDF, not a 500" requirement): a zero-count
/// verdict breakdown renders a plain "No data in this period." paragraph instead of an empty table, and
/// the OEE block itself renders fine at all-zero (the same OEE calculator/aggregate already tolerate an
/// empty window for <c>/oee</c> and <c>/oee/fleet</c> — the fleet route's own zero-seed test already
/// exercises this).
/// The response is written through <see cref="PdfFileResult"/>, a minimal private <c>IResult</c> — same
/// "never <c>Results.File</c>, whose <c>FileContentHttpResult.ExecuteAsync</c> needs a DI
/// <c>ILoggerFactory</c> this project's hand-built <see cref="DefaultHttpContext"/> test convention never
/// has" reasoning as Task 10's <see cref="CsvFileResult"/>, just with <c>Content-Type: application/pdf</c>
/// and a fixed <c>Content-Disposition</c> filename (per the brief, no dynamic timestamp in the filename
/// itself — only the in-body "generated at" line, which tests deliberately never assert on).
///
/// WS-D-D2 — every GET here (read-only reporting) is Operator; <c>PUT /v1/historian/oee/settings</c>
/// (changes the ideal-cycle override/planned-production ratio the OEE math itself uses) is Engineer;
/// <c>POST /v1/historian/prune</c> (irreversibly deletes historian rows) is Admin.
///
/// Fix 1 (task-7 review, CRITICAL) — every route below used to default <c>includeFabricated</c> to a
/// hardcoded <see langword="false"/> with no way for a caller to ask otherwise: no web route ever sends
/// <c>includeFabricated=true</c>, and this file never resolved <see cref="DemoModeGate"/> at all. On an
/// exhibition/demo install (<see cref="DemoModeGate.Enabled"/>) the ENTIRE roster is <c>Simulated</c>, so
/// <see cref="SqliteHistorianStore"/>'s real-presence gate — which unconditionally excludes
/// <c>is_fabricated = 1</c> — excluded every single row, permanently: a fresh demo <c>historian.db</c>
/// could never produce one default-visible row, so <c>/historian</c>/<c>/reports</c> rendered nothing,
/// the PDF report was empty, and genealogy was empty. See <see cref="ResolveIncludeFabricated"/> for the
/// fix — every route that accepts <c>includeFabricated</c> now resolves it through that one helper
/// instead of the old bare <c>?? false</c>.
/// </summary>
public static class HistorianEndpoints
{
    public static void MapHistorianEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/historian/results", GetResultsAsync).RequireAuthorization(Policies.Operator);
        app.MapGet("/v1/historian/results/export.csv", ExportResultsCsvAsync).RequireAuthorization(Policies.Operator);
        app.MapGet("/v1/historian/serial/{serial}", GetBySerialAsync).RequireAuthorization(Policies.Operator);
        app.MapGet("/v1/historian/telemetry", GetTelemetryAsync).RequireAuthorization(Policies.Operator);
        app.MapGet("/v1/historian/stats", GetStatsAsync).RequireAuthorization(Policies.Operator);
        app.MapPost("/v1/historian/prune", PruneAsync).RequireAuthorization(Policies.Admin);

        app.MapGet("/v1/historian/oee", GetOeeAsync).RequireAuthorization(Policies.Operator);
        app.MapGet("/v1/historian/oee/fleet", GetOeeFleetAsync).RequireAuthorization(Policies.Operator);
        app.MapGet("/v1/historian/oee/settings", GetOeeSettings).RequireAuthorization(Policies.Operator);
        app.MapPut("/v1/historian/oee/settings", PutOeeSettingsAsync).RequireAuthorization(Policies.Engineer);

        app.MapGet("/v1/historian/report.pdf", GetReportPdfAsync).RequireAuthorization(Policies.Operator);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/historian/results?machine=&from=&to=&serial=&verdict=&kind=&limit=&offset=
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> GetResultsAsync(
        string? machine, string? from, string? to, string? serial, string? verdict, string? kind,
        int? limit, int? offset, IHistorianStore store, CancellationToken ct, bool? includeFabricated = null,
        DemoModeGate? demoGate = null)
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

        // Clamp BEFORE handing to the store: Limit/Offset are passed straight into a parameterized
        // `LIMIT @limit OFFSET @offset` by SqliteHistorianStore.QueryResultsAsync, and SQLite treats a
        // negative LIMIT as "no limit" (the entire table, unauthenticated) rather than an error — an
        // unclamped negative or absurdly large caller-supplied limit is a minor DoS. The response's
        // Limit/Offset (via ToPageDto) reflect these CLAMPED values, never the raw query-string ones.
        var clampedLimit = Math.Clamp(limit ?? 200, 1, 1000);
        var clampedOffset = Math.Max(offset ?? 0, 0);

        var query = new HistorianResultQuery(
            MachineCode: machine, From: fromParsed, To: toParsed, SerialNumber: serial,
            Verdict: verdict, ReadingKind: kind, Limit: clampedLimit, Offset: clampedOffset,
            IncludeFabricated: ResolveIncludeFabricated(includeFabricated, demoGate));

        var page = await store.QueryResultsAsync(query, ct).ConfigureAwait(false);
        return Results.Ok(ToPageDto(page));
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/historian/results/export.csv?machine=&from=&to=&serial=&verdict=&kind=
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> ExportResultsCsvAsync(
        string? machine, string? from, string? to, string? serial, string? verdict, string? kind,
        IHistorianStore store, CancellationToken ct, bool? includeFabricated = null, DemoModeGate? demoGate = null)
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

        var csvBytes = await BuildExportCsvAsync(machine, fromParsed, toParsed, serial, verdict, kind, store, ct, ResolveIncludeFabricated(includeFabricated, demoGate))
            .ConfigureAwait(false);
        return new CsvFileResult(csvBytes, "historian-results.csv");
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/historian/serial/{serial}
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> GetBySerialAsync(
        string serial, IHistorianStore store, CancellationToken ct, bool? includeFabricated = null, DemoModeGate? demoGate = null)
    {
        var rows = await store.QueryBySerialAsync(serial, ct, ResolveIncludeFabricated(includeFabricated, demoGate)).ConfigureAwait(false);
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
    internal static async Task<IResult> PruneAsync(
        PruneRequest request, IHistorianStore store, CancellationToken ct, HttpContext? context = null, AuditRecorder? recorder = null)
    {
        if (request.OlderThanDays < 0)
        {
            // Rejected mutation (400) — per the WS-D-D4 ordering rule, no audit row is written here.
            return Results.BadRequest(new ApiErrorDto("olderThanDays must be >= 0."));
        }

        var cutoffUtc = DateTimeOffset.UtcNow.AddDays(-request.OlderThanDays);
        var deleted = await store.PruneOlderThanAsync(cutoffUtc, ct).ConfigureAwait(false);

        if (recorder is not null && context is not null)
        {
            await recorder.RecordAsync(context, "historian.prune", null, null, null, new { cutoffUtc, deletedCount = deleted }, ct)
                .ConfigureAwait(false);
        }

        return Results.Ok(new PruneResultDto(deleted));
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/historian/oee?machine=&from=&to=
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> GetOeeAsync(
        string? machine, string? from, string? to,
        IHistorianStore store, OeeSettingsStore settingsStore, FleetHost fleetHost, CancellationToken ct,
        bool? includeFabricated = null, DemoModeGate? demoGate = null)
    {
        var descriptor = FindMachine(fleetHost, machine);
        if (descriptor is null) return MachineNotFound(machine);

        if (!TryResolveRange(from, to, out var fromParsed, out var toParsed, out var rangeError)) return rangeError!;

        var dto = await ComputeOeeAsync(descriptor, fromParsed, toParsed, store, settingsStore, ct, ResolveIncludeFabricated(includeFabricated, demoGate)).ConfigureAwait(false);
        return Results.Ok(dto);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/historian/oee/fleet?from=&to=
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> GetOeeFleetAsync(
        string? from, string? to, IHistorianStore store, OeeSettingsStore settingsStore, FleetHost fleetHost, CancellationToken ct,
        bool? includeFabricated = null, DemoModeGate? demoGate = null)
    {
        if (!TryResolveRange(from, to, out var fromParsed, out var toParsed, out var rangeError)) return rangeError!;

        var effectiveIncludeFabricated = ResolveIncludeFabricated(includeFabricated, demoGate);
        var results = new List<OeeResultDto>();
        foreach (var descriptor in fleetHost.Fleet)
        {
            results.Add(await ComputeOeeAsync(descriptor, fromParsed, toParsed, store, settingsStore, ct, effectiveIncludeFabricated).ConfigureAwait(false));
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
    internal static async Task<IResult> PutOeeSettingsAsync(
        string? machine, OeeSettingsUpdateRequest request, OeeSettingsStore settingsStore, FleetHost fleetHost,
        CancellationToken ct = default, HttpContext? context = null, AuditRecorder? recorder = null)
    {
        var descriptor = FindMachine(fleetHost, machine);
        if (descriptor is null) return MachineNotFound(machine);

        try
        {
            // "old" read BEFORE the mutation — the currently-effective settings for this machine.
            var before = settingsStore.Resolve(descriptor.Code, descriptor.CycleSeconds);
            var updated = settingsStore.Set(descriptor.Code, request.IdealCycleSecondsOverride, request.PlannedProductionRatio);

            if (recorder is not null && context is not null)
            {
                await recorder.RecordAsync(context, "historian.oee_settings.update", "machineCode", descriptor.Code, before, updated, ct)
                    .ConfigureAwait(false);
            }

            return Results.Ok(ToSettingsDto(descriptor, updated));
        }
        catch (ArgumentOutOfRangeException ex)
        {
            // Rejected mutation (400) — per the WS-D-D4 ordering rule, no audit row is written here.
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
        IHistorianStore store, OeeSettingsStore settingsStore, CancellationToken ct, bool includeFabricated = false)
    {
        var settings = settingsStore.Resolve(descriptor.Code, descriptor.CycleSeconds);
        var idealCycle = settings.IdealCycleSecondsOverride ?? descriptor.CycleSeconds;
        var planned = TimeSpan.FromSeconds((to - from).TotalSeconds * settings.PlannedProductionRatio);

        var agg = await store.AggregateForOeeAsync(descriptor.Code, from, to, ct, includeFabricated).ConfigureAwait(false);
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

    /// <summary>Fix 1 (task-7 review, CRITICAL) — the one place every route above decides what
    /// <c>includeFabricated</c> actually means when a caller doesn't pass one explicitly. An explicit
    /// <paramref name="explicitValue"/> (the web-API escape hatch — no shipped web route sends one today,
    /// but a direct API caller can) always wins outright. Absent that, the default is
    /// <see cref="DemoModeGate.Enabled"/>: <see langword="false"/> (the default for every product/customer
    /// deployment — see <see cref="DemoModeGate"/>'s own doc comment) reproduces this file's entire
    /// pre-fix behavior byte-for-byte, so nothing changes for a real customer's box.
    /// <see langword="true"/> (an exhibition/demo-flagged deployment) flips the default to bypass
    /// <see cref="SqliteHistorianStore"/>'s real-presence gate — the ONLY way a 100%-<c>Simulated</c> demo
    /// roster can ever produce a single default-visible historian/OEE/report/genealogy row, since an
    /// explicitly-fabricated row is otherwise excluded unconditionally (see
    /// <c>SqliteHistorianStore.ApplyRealPresenceGateAsync</c>'s own doc comment).
    ///
    /// <para>Chosen over the alternative (defaulting on whether <see cref="FleetHost.Fleet"/> currently
    /// contains zero real machines) for two reasons: it reuses the ONE flag <c>Program.cs</c>/
    /// <c>ModeEndpoints</c>/<c>CapabilitiesEndpoints</c> already treat as "is Demo even possible on this
    /// deployment" rather than inventing a second "is this fleet fabricated enough" rule; and it keeps
    /// every pre-existing test in <c>HistorianEndpointsProvenanceTests</c>/<c>HistorianEndpointsReadTests</c>/
    /// <c>HistorianEndpointsExportTests</c>/<c>HistorianEndpointsOeeTests</c> — several of which construct a
    /// FleetHost seeded with the fully-<c>Simulated</c> demo roster (<c>BuildDefaultFleet</c>) purely as a
    /// descriptor source, with NO <see cref="DemoModeGate"/> in the picture at all — compiling and passing
    /// completely unchanged (they never pass one, so <paramref name="demoGate"/> defaults <see langword="null"/>
    /// exactly like every other optional trailing DI-service parameter in this file, e.g. <c>AuditRecorder?</c>
    /// on <see cref="PruneAsync"/>).</para>
    ///
    /// <para><b>Known residual (accepted, written down rather than fixed):</b> <see cref="DemoModeGate.Enabled"/>
    /// is a process-lifetime flag read once at startup from an env var beside the packaged <c>.exe</c> — it
    /// does NOT track whether the CURRENT roster still contains any fabricated machine, nor whether the
    /// current <c>TransportMode</c> is actually Demo right now. An exhibition-flagged build that an operator
    /// later switches to Live and onboards a real machine into (SM-5's own onboarding feature) would still
    /// default to showing any fabricated rows recorded earlier under that same env-flagged process. Accepted
    /// because <see cref="DemoModeGate.EnvVarName"/> is never set on a real customer's product install (see
    /// that class's own doc comment and README §20.1) — this default only ever fires on an exhibition/demo
    /// packaging line that no paying customer's "one real machine" deployment uses.</para></summary>
    private static bool ResolveIncludeFabricated(bool? explicitValue, DemoModeGate? demoGate) =>
        explicitValue ?? (demoGate?.Enabled ?? false);

    // ─────────────────────────────────────────────────────────────────────
    // CSV export helpers (Task 10)
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>The brief's page size ("e.g. Limit=5000") for paging through the frozen, paginated
    /// <see cref="IHistorianStore.QueryResultsAsync"/> while building the export — never <c>int.MaxValue</c>
    /// as a single <c>Limit</c>.</summary>
    private const int ExportPageSize = 5000;

    private static readonly string[] CsvHeaderColumns =
    {
        "id", "machineCode", "deviceClass", "machineType", "readingKind", "cycleCounter", "serialNumber",
        "verdict", "recipeCode", "recipeVersion", "keyMetricName", "keyMetricValue", "keyMetricUnit",
        "ngCount", "pointCount", "ackSuccess", "ackDuplicate", "ackQueued", "eventTimeUtc", "ingestedAtUtc",
    };

    /// <summary>Pages through <see cref="IHistorianStore.QueryResultsAsync"/> (fixed <see cref="ExportPageSize"/>,
    /// increasing <c>Offset</c>, stopping the first time a page comes back shorter than the page size) so
    /// the FULL filtered set is exported without ever requesting one unbounded page. WS-A scale note: the
    /// resulting CSV text is still accumulated in one in-memory <see cref="StringBuilder"/> across every
    /// page before being UTF-8-encoded and returned as a single byte array — acceptable for WS-A's
    /// historian sizes (this is what the brief calls out as an allowed tradeoff when "streaming is
    /// awkward in this minimal-API setup"); the scale path, if export sizes ever grow enough to matter, is
    /// writing each page's rows straight to the HTTP response stream as they arrive (e.g. via
    /// <c>Results.Stream</c>) instead of building the whole CSV before the first byte is sent.</summary>
    private static async Task<byte[]> BuildExportCsvAsync(
        string? machine, DateTimeOffset? from, DateTimeOffset? to, string? serial, string? verdict, string? kind,
        IHistorianStore store, CancellationToken ct, bool includeFabricated = false)
    {
        var sb = new StringBuilder();
        sb.Append(string.Join(',', CsvHeaderColumns)).Append("\r\n");

        var offset = 0;
        while (true)
        {
            var query = new HistorianResultQuery(
                MachineCode: machine, From: from, To: to, SerialNumber: serial,
                Verdict: verdict, ReadingKind: kind, Limit: ExportPageSize, Offset: offset,
                IncludeFabricated: includeFabricated);

            var page = await store.QueryResultsAsync(query, ct).ConfigureAwait(false);
            foreach (var row in page.Items)
            {
                AppendCsvRow(sb, row);
            }

            if (page.Items.Count < ExportPageSize) break;
            offset += ExportPageSize;
        }

        // No BOM: RFC-4180 doesn't require one, and this keeps the bytes a plain ASCII/UTF-8 reader
        // (or a byte-for-byte test assertion) can compare without stripping a leading marker.
        return new UTF8Encoding(encoderShouldEmitUTF8Identifier: false).GetBytes(sb.ToString());
    }

    /// <summary>One RFC-4180 row: <see cref="HistorianResultDto"/>'s scalar columns, in the SAME order as
    /// <see cref="CsvHeaderColumns"/> — nulls render empty, booleans render <c>true</c>/<c>false</c>,
    /// numbers use invariant culture, and dates use the round-trip ("O") format, per the brief.</summary>
    private static void AppendCsvRow(StringBuilder sb, HistorianResultRow row)
    {
        var r = row.Record;
        var fields = new[]
        {
            row.Id.ToString(CultureInfo.InvariantCulture),
            r.MachineCode,
            r.DeviceClass,
            r.MachineType,
            r.ReadingKind,
            r.CycleCounter.ToString(CultureInfo.InvariantCulture),
            r.SerialNumber,
            r.Verdict,
            r.RecipeCode,
            r.RecipeVersion,
            r.KeyMetricName,
            r.KeyMetricValue?.ToString(CultureInfo.InvariantCulture),
            r.KeyMetricUnit,
            r.NgCount.ToString(CultureInfo.InvariantCulture),
            r.PointCount.ToString(CultureInfo.InvariantCulture),
            r.AckSuccess ? "true" : "false",
            r.AckDuplicate ? "true" : "false",
            r.AckQueued ? "true" : "false",
            r.EventTimeUtc.ToString("O", CultureInfo.InvariantCulture),
            r.IngestedAtUtc.ToString("O", CultureInfo.InvariantCulture),
        };

        for (var i = 0; i < fields.Length; i++)
        {
            if (i > 0) sb.Append(',');
            sb.Append(EscapeCsvField(fields[i]));
        }

        sb.Append("\r\n");
    }

    private static readonly char[] CsvSpecialChars = { ',', '"', '\r', '\n' };

    /// <summary>RFC-4180 field escaping: null → empty; a field containing a comma, double-quote, CR, or
    /// LF is wrapped in double-quotes with every embedded double-quote doubled; anything else passes
    /// through unquoted.</summary>
    private static string EscapeCsvField(string? field)
    {
        if (field is null) return string.Empty;
        if (field.IndexOfAny(CsvSpecialChars) < 0) return field;
        return "\"" + field.Replace("\"", "\"\"") + "\"";
    }

    /// <summary>Minimal hand-rolled <see cref="IResult"/> for the CSV export response — see this class's
    /// doc comment for why NOT the built-in <c>Results.File</c>. Sets <c>Content-Type</c> (with the
    /// <c>charset=utf-8</c> the brief calls for) and <c>Content-Disposition: attachment; filename="..."</c>
    /// itself, then writes the already-built bytes straight to <see cref="HttpResponse.Body"/>.</summary>
    private sealed class CsvFileResult : IResult
    {
        private readonly byte[] _bytes;
        private readonly string _fileName;

        public CsvFileResult(byte[] bytes, string fileName)
        {
            _bytes = bytes;
            _fileName = fileName;
        }

        public Task ExecuteAsync(HttpContext httpContext)
        {
            httpContext.Response.ContentType = "text/csv; charset=utf-8";
            httpContext.Response.Headers.ContentDisposition = $"attachment; filename=\"{_fileName}\"";
            httpContext.Response.ContentLength = _bytes.Length;
            return httpContext.Response.Body.WriteAsync(_bytes, httpContext.RequestAborted).AsTask();
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // PDF report export (Task 11)
    // ─────────────────────────────────────────────────────────────────────

    // GET /v1/historian/report.pdf?machine=&from=&to=
    internal static async Task<IResult> GetReportPdfAsync(
        string? machine, string? from, string? to,
        IHistorianStore store, OeeSettingsStore settingsStore, FleetHost fleetHost, CancellationToken ct,
        bool? includeFabricated = null, DemoModeGate? demoGate = null)
    {
        var descriptor = FindMachine(fleetHost, machine);
        if (descriptor is null) return MachineNotFound(machine);

        if (!TryResolveRange(from, to, out var fromParsed, out var toParsed, out var rangeError)) return rangeError!;

        var effectiveIncludeFabricated = ResolveIncludeFabricated(includeFabricated, demoGate);
        var oee = await ComputeOeeAsync(descriptor, fromParsed, toParsed, store, settingsStore, ct, effectiveIncludeFabricated).ConfigureAwait(false);
        var verdictCounts = await ComputeVerdictBreakdownAsync(descriptor.Code, fromParsed, toParsed, store, ct, effectiveIncludeFabricated).ConfigureAwait(false);

        var pdfBytes = BuildReportPdf(descriptor, fromParsed, toParsed, oee, verdictCounts);
        return new PdfFileResult(pdfBytes, "historian-report.pdf");
    }

    /// <summary>Pages through <see cref="IHistorianStore.QueryResultsAsync"/> (same fixed
    /// <see cref="ExportPageSize"/>/increasing-<c>Offset</c>/"stop on a short page" convention Task 10's
    /// <see cref="BuildExportCsvAsync"/> already established) for <paramref name="machineCode"/>'s full
    /// <paramref name="from"/>/<paramref name="to"/> window, tallying a raw count per
    /// <see cref="HistorianResultRecord.Verdict"/> string — deliberately no <c>ReadingKind</c> filter (see
    /// this class's doc comment for why that's a real, intended difference from the OEE aggregate's own
    /// <c>ProcessResult</c>-only counts). A machine/range with zero rows simply returns an empty
    /// dictionary — never a throw — which <see cref="BuildReportPdf"/> renders as an explicit
    /// "no data in this period" empty state.</summary>
    private static async Task<IReadOnlyDictionary<string, long>> ComputeVerdictBreakdownAsync(
        string machineCode, DateTimeOffset from, DateTimeOffset to, IHistorianStore store, CancellationToken ct,
        bool includeFabricated = false)
    {
        var counts = new Dictionary<string, long>(StringComparer.Ordinal);

        var offset = 0;
        while (true)
        {
            var query = new HistorianResultQuery(
                MachineCode: machineCode, From: from, To: to, Limit: ExportPageSize, Offset: offset,
                IncludeFabricated: includeFabricated);

            var page = await store.QueryResultsAsync(query, ct).ConfigureAwait(false);
            foreach (var row in page.Items)
            {
                var verdict = row.Record.Verdict;
                counts[verdict] = counts.GetValueOrDefault(verdict) + 1;
            }

            if (page.Items.Count < ExportPageSize) break;
            offset += ExportPageSize;
        }

        return counts;
    }

    /// <summary>Builds the whole report as a MigraDoc <see cref="Document"/> (title/machine/period, the
    /// OEE block reusing the exact <see cref="OeeResultDto"/> the frozen <see cref="ComputeOeeAsync"/>
    /// glue produced, then the verdict-breakdown table) and renders it through a
    /// <see cref="PdfDocumentRenderer"/> straight into a <see cref="MemoryStream"/> (never a temp file).
    /// A zero-count breakdown (the brief's "zero results in the period" robustness case) renders a plain
    /// "No data in this period." paragraph instead of an empty table — the OEE block itself always renders
    /// (its numbers are simply all-zero in that case, exactly like <c>/oee</c>'s own empty-window
    /// behavior), so the returned PDF is never a bare/empty document even at zero rows.</summary>
    private static byte[] BuildReportPdf(
        MachineDescriptor descriptor, DateTimeOffset from, DateTimeOffset to,
        OeeResultDto oee, IReadOnlyDictionary<string, long> verdictCounts)
    {
        var document = new Document();
        document.Styles[StyleNames.Normal]!.Font.Name = "Arial";

        var section = document.AddSection();

        var title = section.AddParagraph("St4i Historian Report");
        title.Format.Font.Size = 18;
        title.Format.Font.Bold = true;

        var subtitle = section.AddParagraph($"Machine: {descriptor.Code}");
        subtitle.Format.Font.Size = 12;
        subtitle.Format.SpaceBefore = Unit.FromPoint(4);

        var period = section.AddParagraph(
            $"Period: {from.ToString("O", CultureInfo.InvariantCulture)} -> {to.ToString("O", CultureInfo.InvariantCulture)}");
        period.Format.SpaceAfter = Unit.FromPoint(12);

        var oeeHeading = section.AddParagraph("OEE Summary");
        oeeHeading.Format.Font.Bold = true;
        oeeHeading.Format.Font.Size = 14;
        oeeHeading.Format.SpaceBefore = Unit.FromPoint(8);

        var oeeTable = section.AddTable();
        oeeTable.Borders.Visible = true;
        oeeTable.AddColumn(Unit.FromCentimeter(6));
        oeeTable.AddColumn(Unit.FromCentimeter(6));

        AddLabelValueRow(oeeTable, "Availability", oee.Availability.ToString("P1", CultureInfo.InvariantCulture));
        AddLabelValueRow(oeeTable, "Performance", oee.Performance.ToString("P1", CultureInfo.InvariantCulture));
        AddLabelValueRow(oeeTable, "Quality", oee.Quality.ToString("P1", CultureInfo.InvariantCulture));
        AddLabelValueRow(oeeTable, "OEE", oee.Oee.ToString("P1", CultureInfo.InvariantCulture));
        AddLabelValueRow(oeeTable, "Total Count", oee.TotalCount.ToString(CultureInfo.InvariantCulture));
        AddLabelValueRow(oeeTable, "Good Count", oee.GoodCount.ToString(CultureInfo.InvariantCulture));
        AddLabelValueRow(oeeTable, "Ideal Cycle (s)", oee.IdealCycleSeconds.ToString("0.###", CultureInfo.InvariantCulture));

        var verdictHeading = section.AddParagraph("Verdict Breakdown");
        verdictHeading.Format.Font.Bold = true;
        verdictHeading.Format.Font.Size = 14;
        verdictHeading.Format.SpaceBefore = Unit.FromPoint(12);

        if (verdictCounts.Count == 0)
        {
            section.AddParagraph("No data in this period.");
        }
        else
        {
            var verdictTable = section.AddTable();
            verdictTable.Borders.Visible = true;
            verdictTable.AddColumn(Unit.FromCentimeter(6));
            verdictTable.AddColumn(Unit.FromCentimeter(6));

            var headerRow = verdictTable.AddRow();
            headerRow.HeadingFormat = true;
            headerRow.Cells[0].AddParagraph("Verdict");
            headerRow.Cells[1].AddParagraph("Count");

            foreach (var (verdict, count) in verdictCounts.OrderBy(kv => kv.Key, StringComparer.Ordinal))
            {
                var row = verdictTable.AddRow();
                row.Cells[0].AddParagraph(verdict);
                row.Cells[1].AddParagraph(count.ToString(CultureInfo.InvariantCulture));
            }
        }

        // Content only, deliberately never asserted on by any test (the brief: "if you print a
        // 'generated at' timestamp, that's fine for content but don't assert on it in tests").
        var generatedAt = section.AddParagraph($"Generated at {DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture)}");
        generatedAt.Format.Font.Size = 8;
        generatedAt.Format.SpaceBefore = Unit.FromPoint(16);

        var renderer = new PdfDocumentRenderer { Document = document };
        renderer.RenderDocument();

        using var ms = new MemoryStream();
        renderer.PdfDocument.Save(ms, closeStream: false);
        return ms.ToArray();
    }

    private static void AddLabelValueRow(MigraDoc.DocumentObjectModel.Tables.Table table, string label, string value)
    {
        var row = table.AddRow();
        row.Cells[0].AddParagraph(label);
        row.Cells[1].AddParagraph(value);
    }

    /// <summary>Minimal hand-rolled <see cref="IResult"/> for the PDF report response — same "never
    /// <c>Results.File</c>" reasoning as Task 10's <see cref="CsvFileResult"/> (this class's doc comment
    /// explains why). Sets <c>Content-Type: application/pdf</c> and a fixed
    /// <c>Content-Disposition: attachment; filename="historian-report.pdf"</c> (per the brief — no
    /// dynamic timestamp in the filename itself), then writes the already-rendered bytes straight to
    /// <see cref="HttpResponse.Body"/>.</summary>
    private sealed class PdfFileResult : IResult
    {
        private readonly byte[] _bytes;
        private readonly string _fileName;

        public PdfFileResult(byte[] bytes, string fileName)
        {
            _bytes = bytes;
            _fileName = fileName;
        }

        public Task ExecuteAsync(HttpContext httpContext)
        {
            httpContext.Response.ContentType = "application/pdf";
            httpContext.Response.Headers.ContentDisposition = $"attachment; filename=\"{_fileName}\"";
            httpContext.Response.ContentLength = _bytes.Length;
            return httpContext.Response.Body.WriteAsync(_bytes, httpContext.RequestAborted).AsTask();
        }
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
            r.AckSuccess, r.AckDuplicate, r.AckQueued, r.EventTimeUtc, r.IngestedAtUtc, r.IsFabricated);
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
