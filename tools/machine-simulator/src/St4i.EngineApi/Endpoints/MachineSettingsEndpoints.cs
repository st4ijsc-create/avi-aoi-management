using System.Text.Json;
using System.Text.RegularExpressions;
using St4i.EdgeCore.Config;
using St4i.EdgeCore.Models;
using St4i.EngineApi.Config;
using St4i.EngineApi.Fleet;

namespace St4i.EngineApi.Endpoints;

/// <summary>
/// Task 2 (docs/plans/2026-07-21-machine-config.md) — the machine operating-configuration REST surface,
/// under <c>/v1/machines/{code}/settings*</c>. Thin wrapper over <see cref="MachineConfigStore"/>
/// (Task 1), resolving <c>{code}</c> to a <see cref="MachineDescriptor"/> via <see cref="FleetHost.Fleet"/>
/// first — same lookup pattern <see cref="ConfigEndpoints"/> already uses for
/// <c>/v1/machines/{code}/config/*</c> — and its <c>MachineType</c> to a <c>configKind</c> via
/// <see cref="MachineParameterSchema.ConfigKindForMachineType"/>.
///
/// Six endpoints per the plan: <c>GET settings</c>, <c>PUT/DELETE settings/{key}</c>, <c>POST
/// settings/pull</c>, <c>POST settings/push</c>, <c>GET settings/history</c>.
///
/// Same JSON-casing discipline <see cref="ConfigEndpoints"/> already established (and the GOTCHA this
/// whole project has hit twice — see <see cref="ConfigJson"/>'s doc comment): every response that can
/// carry an <c>St4i.EdgeCore.Config</c> enum (<see cref="ParameterValueKind"/>/<see cref="AdjustmentScope"/>/
/// <see cref="ConfigProvenance"/>) goes through <see cref="Json{T}"/> (<see cref="ConfigJson.Options"/>),
/// and every body-bound endpoint reads its DTO via <see cref="ReadBodyAsync{T}"/> on that SAME options
/// instance — never a direct minimal-API parameter, which would silently fall back to <c>Program.cs</c>'s
/// global <c>JsonStringEnumConverter()</c> and reject the request's own snake_case <c>scope</c> value.
///
/// Errors: <see cref="KeyNotFoundException"/> (unknown machine/parameter key) → 404;
/// <see cref="ArgumentOutOfRangeException"/> (out-of-range write — message already names the allowed
/// range, see <see cref="MachineParameterSchema.ValidateRange"/>) / <see cref="InvalidOperationException"/>
/// (e.g. a product-scoped write on an IoT machine) / <see cref="ArgumentException"/> (missing required
/// productCode) → 400. Nothing here should ever 500 on an expected state.
/// </summary>
public static class MachineSettingsEndpoints
{
    public static void MapMachineSettingsEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/machines/{code}/settings", GetSettings);
        app.MapPut("/v1/machines/{code}/settings/{key}", UpdateSettingAsync);
        app.MapDelete("/v1/machines/{code}/settings/{key}", DeleteSetting);
        app.MapPost("/v1/machines/{code}/settings/pull", PullSettingsAsync);
        app.MapPost("/v1/machines/{code}/settings/push", PushSettingsAsync);
        app.MapGet("/v1/machines/{code}/settings/history", GetHistory);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/machines/{code}/settings?product=
    // ─────────────────────────────────────────────────────────────────────
    internal static IResult GetSettings(string code, string? product, FleetHost fleetHost, MachineConfigStore store)
    {
        var machine = FindMachine(fleetHost, code);
        if (machine is null) return ApiNotFound($"machine \"{code}\" not found");

        var configKind = MachineParameterSchema.ConfigKindForMachineType(machine.MachineType);
        if (configKind is null) return ApiUnsupportedMachineType(machine);

        try
        {
            var cfg = store.Ensure(machine.Code, configKind);
            return Json(BuildResponse(machine, configKind, cfg, product, store));
        }
        catch (InvalidOperationException ex)
        {
            return Results.BadRequest(new ApiErrorDto(ex.Message));
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // PUT /v1/machines/{code}/settings/{key}
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> UpdateSettingAsync(
        HttpContext context, string code, string key, FleetHost fleetHost, MachineConfigStore store, CancellationToken ct)
    {
        var machine = FindMachine(fleetHost, code);
        if (machine is null) return ApiNotFound($"machine \"{code}\" not found");

        var configKind = MachineParameterSchema.ConfigKindForMachineType(machine.MachineType);
        if (configKind is null) return ApiUnsupportedMachineType(machine);

        var (body, error) = await ReadBodyAsync<UpdateSettingRequestDto>(context, required: true, ct).ConfigureAwait(false);
        if (error is not null) return error;

        try
        {
            store.Ensure(machine.Code, configKind);
            var updated = store.SetAdjustment(machine.Code, key, body!.Value, body.Scope, body.Product, body.By, body.Note);
            var responseProduct = body.Scope == AdjustmentScope.Product ? body.Product : null;
            return Json(BuildResponse(machine, configKind, updated, responseProduct, store));
        }
        catch (KeyNotFoundException ex)
        {
            return ApiNotFound(ex.Message);
        }
        catch (Exception ex) when (ex is ArgumentOutOfRangeException or InvalidOperationException or ArgumentException)
        {
            return Results.BadRequest(new ApiErrorDto(CleanMessage(ex)));
        }
    }

    /// <summary>M-6 (mc-feature-review.md) — <see cref="ArgumentOutOfRangeException"/> (thrown by
    /// <see cref="MachineParameterSchema.ValidateRange"/> with the allowed range already baked into the
    /// custom message) leaks .NET's own boilerplate verbatim into the REST error body an operator/HMI
    /// reads: <c>.Message</c> for a <c>(paramName, actualValue, message)</c> exception comes back as
    /// <c>"{message} (Parameter 'value')\r\nActual value was 99999."</c> — the "(Parameter '...')" suffix
    /// glued onto the SAME line as the custom text (not a separate line), then a genuinely separate
    /// "Actual value was ..." line. Two strips, in order: (1) keep only the text before the first
    /// newline (drops the "Actual value was ..." line entirely — also harmless no-op for
    /// <see cref="ArgumentException"/>'s own "productCode is required..." (paramName) case above, which
    /// has no second line), (2) trim a trailing <c>" (Parameter '...')"</c> off whatever remains. The
    /// developer-authored custom message always precedes both, so nothing actionable is lost.</summary>
    private static readonly Regex ParameterSuffixPattern = new(@"\s*\(Parameter '[^']*'\)\s*$", RegexOptions.Compiled);

    private static string CleanMessage(Exception ex)
    {
        var firstLine = ex.Message.Split('\r', '\n')[0].TrimEnd();
        return ParameterSuffixPattern.Replace(firstLine, "").TrimEnd();
    }

    // ─────────────────────────────────────────────────────────────────────
    // DELETE /v1/machines/{code}/settings/{key}?scope=&product=
    // ─────────────────────────────────────────────────────────────────────
    internal static IResult DeleteSetting(
        string code, string key, string? scope, string? product, FleetHost fleetHost, MachineConfigStore store)
    {
        var machine = FindMachine(fleetHost, code);
        if (machine is null) return ApiNotFound($"machine \"{code}\" not found");

        var configKind = MachineParameterSchema.ConfigKindForMachineType(machine.MachineType);
        if (configKind is null) return ApiUnsupportedMachineType(machine);

        if (!TryParseScope(scope, out var parsedScope))
        {
            return Results.BadRequest(new ApiErrorDto($"scope must be \"machine\" or \"product\" (got \"{scope}\")."));
        }

        try
        {
            store.Ensure(machine.Code, configKind);
            var updated = store.RemoveAdjustment(machine.Code, key, parsedScope, product, by: null);
            var responseProduct = parsedScope == AdjustmentScope.Product ? product : null;
            return Json(BuildResponse(machine, configKind, updated, responseProduct, store));
        }
        catch (KeyNotFoundException ex)
        {
            return ApiNotFound(ex.Message);
        }
        catch (InvalidOperationException ex)
        {
            return Results.BadRequest(new ApiErrorDto(ex.Message));
        }
    }

    /// <summary>Parses the DELETE endpoint's <c>scope</c> query value against the SAME lower-case wire
    /// vocabulary (<c>machine</c>/<c>product</c>) every other machine-settings request/response already
    /// uses (<see cref="AdjustmentScope"/>'s own <c>SnakeLowerEnumConverter</c>) — bound here as a plain
    /// <c>string?</c> rather than <see cref="AdjustmentScope"/> directly, because ASP.NET Core's built-in
    /// query-string enum binder turned out to be case-SENSITIVE to the C# member name
    /// (<c>Machine</c>/<c>Product</c>), a real gotcha reproduced live building Task 4's web UI:
    /// <c>?scope=machine</c> (the casing every other part of this feature's contract uses, including this
    /// SAME enum's JSON wire form) 400'd with a completely EMPTY response body — a framework-level
    /// model-binding rejection that never even reached this handler — while <c>?scope=Machine</c> silently
    /// worked. Parsing it ourselves keeps the query-string contract consistent with the JSON one.</summary>
    private static bool TryParseScope(string? raw, out AdjustmentScope scope)
    {
        if (string.Equals(raw, "machine", StringComparison.OrdinalIgnoreCase))
        {
            scope = AdjustmentScope.Machine;
            return true;
        }
        if (string.Equals(raw, "product", StringComparison.OrdinalIgnoreCase))
        {
            scope = AdjustmentScope.Product;
            return true;
        }
        scope = default;
        return false;
    }

    // ─────────────────────────────────────────────────────────────────────
    // POST /v1/machines/{code}/settings/pull
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> PullSettingsAsync(
        HttpContext context, string code, FleetHost fleetHost, MachineConfigStore store, IConfigSyncBackend backend, CancellationToken ct)
    {
        var machine = FindMachine(fleetHost, code);
        if (machine is null) return ApiNotFound($"machine \"{code}\" not found");

        var configKind = MachineParameterSchema.ConfigKindForMachineType(machine.MachineType);
        if (configKind is null) return ApiUnsupportedMachineType(machine);

        var (body, error) = await ReadBodyAsync<PullSettingsRequestDto>(context, required: false, ct).ConfigureAwait(false);
        if (error is not null) return error;

        try
        {
            // Task 7 — asks the CURRENTLY-ACTIVE backend (Demo's SimulatedEcosystem or Live's real
            // server, whichever ConfigSyncCoordinator/SwitchableConfigSyncBackend currently points at)
            // for a recommendation via the SAME config-sync/check+get pull already used for
            // recipe/device_settings sync — never a fabricated success, see TryFetchServerBaselineAsync.
            var (newValues, source) = await TryFetchServerBaselineAsync(backend, machine, configKind, ct).ConfigureAwait(false);
            var updated = store.PullBaseline(machine.Code, configKind, newValues, by: body?.By);
            return Json(BuildResponse(machine, configKind, updated, body?.Product, store, baselineSource: source));
        }
        catch (InvalidOperationException ex)
        {
            return Results.BadRequest(new ApiErrorDto(ex.Message));
        }
    }

    /// <summary>Task 7 — the honest "where did this baseline come from" resolution: asks <paramref
    /// name="backend"/> (Demo or Live, whichever is currently active) for a recipe/device_settings via
    /// the SAME <see cref="IConfigSyncBackend.CheckRecipeAsync"/>/<see cref="IConfigSyncBackend.GetRecipeAsync"/>
    /// pair the general config-sync flow already uses (<see cref="ConfigSyncEngine.PullAsync"/>), then
    /// strips the payload down to only the numeric fields this machine's operating-configuration schema
    /// actually knows about (an unrecognized field — e.g. a recipe's <c>notes</c>/<c>torqueUnit</c> — is
    /// silently ignored, never a failure). Returns <c>(null, "...")</c> whenever nothing usable resolved
    /// (backend not configured, server has no recipe assigned, the flag-off friendly-empty state, or a
    /// resolved payload with zero matching keys) — <see cref="MachineConfigStore.PullBaseline"/> then
    /// falls back to the schema's own defaults exactly as it always has, never a fabricated value.</summary>
    private static async Task<(IReadOnlyDictionary<string, double>? Values, string Source)> TryFetchServerBaselineAsync(
        IConfigSyncBackend backend, MachineDescriptor machine, string configKind, CancellationToken ct)
    {
        var wireKind = ResolveWireConfigKind(machine.DeviceClass);
        var check = await backend.CheckRecipeAsync(null, machine.MachineType, wireKind, ct).ConfigureAwait(false);
        if (!check.Success || check.Code is null)
        {
            return (null, $"{backend.Name}: không có khuyến nghị từ máy chủ cho loại máy \"{machine.MachineType}\" — dùng mặc định của schema (no server recommendation, schema defaults).");
        }

        var recipe = await backend.GetRecipeAsync(check.Code, wireKind, ct).ConfigureAwait(false);
        var numeric = ExtractNumericPayload(recipe?.Payload, MachineParameterSchema.ParametersFor(configKind));
        if (numeric is null)
        {
            return (null, $"{backend.Name}: tìm thấy \"{check.Code}\" v{check.Version} nhưng không có trường nào khớp — dùng mặc định của schema (no matching parameter fields, schema defaults).");
        }

        return (numeric, $"{backend.Name}: khuyến nghị từ \"{check.Code}\" v{check.Version} trên máy chủ (server recipe, resolvedBy={check.ResolvedBy}).");
    }

    /// <summary>The contract's own <c>recipe</c>/<c>device_settings</c> distinction (System A) — same
    /// mapping <see cref="ConfigSyncEngine"/>'s own (private) <c>ResolveConfigKind</c> uses for the
    /// existing product/points config-sync flow, duplicated here (2 lines) rather than exposed publicly
    /// from that class purely for this one caller.</summary>
    private static string ResolveWireConfigKind(DeviceClass deviceClass) => deviceClass switch
    {
        DeviceClass.Iot => "device_settings",
        _ => "recipe",
    };

    /// <summary>Strips an ecosystem recipe payload down to just the numeric fields this <paramref
    /// name="schema"/> defines (docs/MACHINE_CONFIG_DESIGN.md's established "trường lạ STRIP" convention
    /// — an unknown/non-numeric field is dropped, never rejected). Returns null (not an empty dictionary)
    /// when nothing matched, so the caller's "did we get anything usable" check is a single null test.</summary>
    private static IReadOnlyDictionary<string, double>? ExtractNumericPayload(
        IReadOnlyDictionary<string, object?>? payload, IReadOnlyList<ParameterDef> schema)
    {
        if (payload is null || payload.Count == 0) return null;

        var result = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
        foreach (var def in schema)
        {
            if (payload.TryGetValue(def.Key, out var raw) && TryToDouble(raw, out var value))
            {
                result[def.Key] = value;
            }
        }

        return result.Count > 0 ? result : null;
    }

    private static bool TryToDouble(object? raw, out double value)
    {
        switch (raw)
        {
            case double d: value = d; return true;
            case float f: value = f; return true;
            case long l: value = l; return true;
            case int i: value = i; return true;
            case decimal m: value = (double)m; return true;
            case JsonElement je when je.ValueKind == JsonValueKind.Number: value = je.GetDouble(); return true;
            default: value = 0; return false;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // POST /v1/machines/{code}/settings/push
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> PushSettingsAsync(
        HttpContext context, string code, FleetHost fleetHost, MachineConfigStore store, IConfigSyncBackend backend, CancellationToken ct)
    {
        var machine = FindMachine(fleetHost, code);
        if (machine is null) return ApiNotFound($"machine \"{code}\" not found");

        var configKind = MachineParameterSchema.ConfigKindForMachineType(machine.MachineType);
        if (configKind is null) return ApiUnsupportedMachineType(machine);

        var (body, error) = await ReadBodyAsync<PushSettingsRequestDto>(context, required: false, ct).ConfigureAwait(false);
        if (error is not null) return error;

        try
        {
            var cfg = store.Ensure(machine.Code, configKind);
            var effective = store.Resolve(machine.Code, body?.Product);
            var checksum = store.ComputeAdjustmentsChecksum(machine.Code);
            var message = BuildPushMessage(effective, checksum);

            // Reporting only — RecordPush never touches Baseline/MachineAdjustments/ProductAdjustments
            // (see MachineConfigStore.RecordPush's own doc comment); cfg.Baseline.Version below is read
            // BEFORE this call anyway, so a test can assert it is unchanged across the push. This LOCAL
            // mirror always happens, in every mode — Demo's ENTIRE push is this line, nothing else.
            store.RecordPush(machine.Code, effective.ProductCode, body?.By, message);

            // Task 7 — ALSO report to the currently-active backend (SwitchableConfigSyncBackend picks
            // Demo/SimulatedEcosystem or Live/LiveConfigSyncBackend by the app's transport mode). The
            // adjustments sent are scoped to exactly what was resolved above — the one product's map when
            // this push is product-scoped, the machine-wide map otherwise — matching the server's own
            // single "adjustments at this scope" field (see MachineSettingsReportRequestDto's doc
            // comment). Never throws (every IConfigSyncBackend implementation is "friendly" here); a
            // failed/not-configured/flag-off Live report does not fail the push overall — the local
            // mirror above already succeeded — it is surfaced honestly via LiveReport instead.
            var scopedAdjustments = ResolveScopedAdjustments(cfg, effective.ProductCode);
            var report = await backend.ReportSettingsAsync(
                new MachineSettingsReportRequestDto(
                    configKind, effective.ProductCode, cfg.Baseline.Version, scopedAdjustments, effective.Parameters, checksum, body?.By,
                    CallingMachineCode: machine.Code),
                ct).ConfigureAwait(false);

            return Json(new MachineSettingsPushResultDto(
                machine.Code, configKind, effective.ProductCode, effective.Parameters, checksum, cfg.Baseline.Version, message, report));
        }
        catch (KeyNotFoundException ex)
        {
            return ApiNotFound(ex.Message);
        }
    }

    /// <summary>The adjustments map at exactly the scope <paramref name="productCode"/> resolved to —
    /// <see cref="MachineOperatingConfig.ProductAdjustments"/>[productCode] when this push is
    /// product-scoped, <see cref="MachineOperatingConfig.MachineAdjustments"/> otherwise. Never both
    /// combined — see <see cref="MachineSettingsReportRequestDto"/>'s doc comment.</summary>
    private static IReadOnlyDictionary<string, ParameterAdjustment> ResolveScopedAdjustments(MachineOperatingConfig cfg, string? productCode) =>
        productCode is not null && cfg.ProductAdjustments.TryGetValue(productCode, out var byKey)
            ? byKey
            : productCode is not null
                ? new Dictionary<string, ParameterAdjustment>()
                : cfg.MachineAdjustments;

    private static string BuildPushMessage(EffectiveConfig effective, string checksum)
    {
        var productPart = effective.ProductCode is not null ? $" for product \"{effective.ProductCode}\"" : "";
        var shortChecksum = checksum.Length > 12 ? checksum[..12] : checksum;
        return $"Reported {effective.Parameters.Count} parameter(s) as this machine's actual configuration{productPart} (checksum {shortChecksum}...).";
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/machines/{code}/settings/history
    // ─────────────────────────────────────────────────────────────────────
    internal static IResult GetHistory(string code, FleetHost fleetHost, MachineConfigStore store)
    {
        var machine = FindMachine(fleetHost, code);
        return machine is null ? ApiNotFound($"machine \"{code}\" not found") : Json(store.History(machine.Code));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Shared helpers
    // ─────────────────────────────────────────────────────────────────────

    private static MachineSettingsResponseDto BuildResponse(
        MachineDescriptor machine, string configKind, MachineOperatingConfig cfg, string? productCode, MachineConfigStore store,
        string? baselineSource = null)
    {
        var supportsProduct = MachineParameterSchema.SupportsProductScope(configKind);
        var scopedProduct = supportsProduct ? productCode : null;
        var effective = store.Resolve(machine.Code, scopedProduct);

        IReadOnlyDictionary<string, ParameterAdjustment> productAdjustments =
            scopedProduct is not null && cfg.ProductAdjustments.TryGetValue(scopedProduct, out var byKey)
                ? byKey
                : new Dictionary<string, ParameterAdjustment>();

        var driftedKeys = effective.Parameters
            .Where(p => Math.Abs(p.Value - p.BaselineValue) > 1e-9)
            .Select(p => p.Def.Key)
            .ToList();

        return new MachineSettingsResponseDto(
            machine.Code,
            configKind,
            supportsProduct,
            scopedProduct,
            MachineParameterSchema.ParametersFor(configKind),
            cfg.Baseline,
            cfg.MachineAdjustments,
            productAdjustments,
            effective.Parameters,
            store.ComputeAdjustmentsChecksum(machine.Code),
            driftedKeys,
            baselineSource);
    }

    private static MachineDescriptor? FindMachine(FleetHost fleetHost, string code) =>
        fleetHost.Fleet.FirstOrDefault(d => string.Equals(d.Code, code, StringComparison.OrdinalIgnoreCase));

    private static IResult ApiNotFound(string message) => Results.NotFound(new ApiErrorDto(message));

    private static IResult ApiUnsupportedMachineType(MachineDescriptor machine) => Results.BadRequest(new ApiErrorDto(
        $"machine type \"{machine.MachineType}\" has no operating-configuration parameter set."));

    /// <summary>200 OK using <see cref="ConfigJson.Options"/> — see this class's own doc comment / this
    /// method's twin in <see cref="ConfigEndpoints"/> for why every response carrying an
    /// <c>St4i.EdgeCore.Config</c> enum needs this instead of a plain <c>Results.Ok(value)</c>.</summary>
    private static IResult Json<T>(T value) => Results.Json(value, ConfigJson.Options);

    /// <summary>Request-side twin of <see cref="Json{T}"/> — see <see cref="ConfigEndpoints.ReadBodyAsync{T}"/>'s
    /// doc comment for the full converter-precedence explanation this mirrors exactly.</summary>
    private static async Task<(T? Value, IResult? Error)> ReadBodyAsync<T>(HttpContext context, bool required, CancellationToken ct)
        where T : class
    {
        if (context.Request.ContentLength is null or 0)
        {
            return required
                ? (null, Results.BadRequest(new ApiErrorDto("Request body is required.")))
                : (null, null);
        }

        try
        {
            var value = await context.Request.ReadFromJsonAsync<T>(ConfigJson.Options, ct).ConfigureAwait(false);
            if (value is null && required)
            {
                return (null, Results.BadRequest(new ApiErrorDto("Request body is required.")));
            }

            return (value, null);
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or NotSupportedException)
        {
            return (null, Results.BadRequest(new ApiErrorDto("Malformed JSON request body.")));
        }
    }
}
