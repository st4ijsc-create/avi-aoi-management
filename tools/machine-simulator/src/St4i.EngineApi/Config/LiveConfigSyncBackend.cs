using System.Globalization;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using St4i.EdgeCore.Config;

namespace St4i.EngineApi.Config;

/// <summary>
/// Task C3 — the Live <see cref="IConfigSyncBackend"/>: a raw <see cref="HttpClient"/> client that calls
/// the REAL ST4I server's System B (AOI/AVI points/spec/images, true 2-way, always live) + System A
/// (recipe/device_settings, pull-only, flag-gated) REST endpoints per
/// <c>docs/CONFIG_SYNC_SERVER_CONTRACT.md</c>, mirroring the shape of <see cref="St4i.EdgeCore.Transport.LiveTransport"/>
/// one layer up: one instance == one "calling identity" (serverUrl + machine <c>mk_</c> + machineCode),
/// built via <see cref="ForMachine"/>, rebuilt whenever Settings changes (see
/// <see cref="ConfigSyncCoordinator.RebuildLive"/>), disposed when replaced.
///
/// Every call is auth-guarded up front by <see cref="IsConfigured"/> (empty serverUrl OR empty mk_) —
/// mirrors <see cref="St4i.EdgeCore.Transport.LiveTransport"/>'s own "St4iConfigException, unconfigured"
/// path, but converted to a FRIENDLY per-method result here rather than an exception, since
/// <see cref="IConfigSyncBackend"/>'s methods have no room for one: a GET-shaped call returns its
/// natural "nothing here" value (empty list / null / <c>HasChanges:false</c>), and
/// <see cref="SyncPointsAsync"/> (the guarded push) returns a <c>Success:false</c> result whose per-point
/// outcomes carry the "not configured for Live" message — never an exception, per Task C3's guarded-push
/// requirement.
///
/// Error mapping (401/403/404/409/429/500/503, and a real network failure) is likewise "friendly, not an
/// exception" for every method EXCEPT one documented case: <see cref="SyncPointsAsync"/> throws
/// <see cref="KeyNotFoundException"/> on an HTTP 404 specifically, matching
/// <see cref="IConfigSyncBackend.SyncPointsAsync"/>'s own doc comment ("a machine can push points TO an
/// existing product; it cannot create a brand-new product this way") — <c>ConfigEndpoints</c> already
/// catches that exception and maps it to a friendly HTTP 404, so this keeps Demo/Live behaving IDENTICALLY
/// for "you pushed to a product the ecosystem doesn't know about" without <c>ConfigSyncEngine</c> ever
/// needing to know which backend it's talking to.
///
/// System A's <c>CONFIG_SYNC_GENERIC_ENABLED</c> flag-off state (server returns HTTP 500 non-retryable
/// per the contract) is handled the same "friendly, no throw" way as any other recipe-path error — see
/// <see cref="CheckRecipeAsync"/>/<see cref="GetRecipeAsync"/>.
/// </summary>
public sealed class LiveConfigSyncBackend : IConfigSyncBackend, IDisposable
{
    /// <summary>Sentinel status used internally to mean "never got an HTTP response at all" (DNS
    /// failure/connection refused/timeout) — distinct from any real <see cref="System.Net.HttpStatusCode"/>,
    /// so <see cref="IsOk"/>/error-mapping can treat it uniformly alongside a real non-2xx status.</summary>
    private const int NetworkUnreachable = -1;

    /// <summary>Outbound request bodies use a SEPARATE options instance from <see cref="ConfigJson.Options"/>
    /// (which C3's brief says to use for "serialize/deserialize" generally, and which this class DOES use
    /// for every RESPONSE deserialize below) — this one additionally omits null optional fields
    /// (<see cref="JsonIgnoreCondition.WhenWritingNull"/>) instead of writing them as an explicit JSON
    /// <c>null</c>. This is not a stylistic choice: <see cref="St4i.EdgeCore.Transport.LiveTransport"/>
    /// already hit this exact footgun once for a DIFFERENT endpoint (see its
    /// <c>Inspection_send_with_OK_point_omits_empty_defectSeverity</c> test/remarks) — a real server's
    /// Zod schema field marked <c>.optional()</c> (not <c>.nullable()</c>) accepts the KEY being absent
    /// but REJECTS an explicit <c>null</c>/<c>""</c> value, so a naive "just serialize the DTO" send can
    /// fail validation on fields the contract itself marks optional (<c>lowerLimit?</c>, <c>radius?</c>,
    /// <c>expectedUpdatedAt?</c>, ...). Omitting nulls sidesteps that whole class of bug for the one
    /// direction (outbound) where it actually matters; inbound parsing is unaffected either way.</summary>
    private static readonly JsonSerializerOptions RequestOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly HttpClient _http;
    private readonly string _serverUrl;
    private readonly string _mkKey;
    private readonly string _machineCode;

    public LiveConfigSyncBackend(string? serverUrl, string? mkKey, string? machineCode, HttpClient http)
    {
        ArgumentNullException.ThrowIfNull(http);
        _serverUrl = (serverUrl ?? string.Empty).TrimEnd('/');
        _mkKey = mkKey ?? string.Empty;
        _machineCode = machineCode ?? string.Empty;
        _http = http;
    }

    /// <summary>Builds the wrapped <see cref="HttpClient"/> from raw connection parameters — the normal
    /// entry point, mirrors <see cref="St4i.EdgeCore.Transport.LiveTransport.ForMachine"/>'s own shape
    /// (including the optional <paramref name="handler"/> seam tests use to stub the wire).</summary>
    public static LiveConfigSyncBackend ForMachine(
        string? serverUrl,
        string? mkKey,
        string? machineCode,
        bool verifyTls,
        HttpMessageHandler? handler = null,
        double timeoutSeconds = 10.0)
    {
        var h = handler ?? BuildDefaultHandler(verifyTls);
        var http = new HttpClient(h) { Timeout = TimeSpan.FromSeconds(timeoutSeconds) };
        return new LiveConfigSyncBackend(serverUrl, mkKey, machineCode, http);
    }

    private static HttpMessageHandler BuildDefaultHandler(bool verifyTls)
    {
        var handler = new HttpClientHandler();
        if (!verifyTls)
        {
            // Dev self-signed server in a LAN factory — same tradeoff St4iDeviceClient's own
            // constructor documents for its `verifyTls` parameter.
            handler.ServerCertificateCustomValidationCallback = (_, _, _, _) => true;
        }

        return handler;
    }

    /// <summary>Whether this instance has enough to actually reach a real server — an empty
    /// <c>serverUrl</c> or <c>mk_</c> means every call below short-circuits to a friendly "nothing/not
    /// configured" result without attempting HTTP at all. Also what
    /// <see cref="ConfigSyncCoordinator.ApplyMode"/> reads to decide whether Auto mode resolves to Live
    /// or falls back to Demo.</summary>
    public bool IsConfigured => !string.IsNullOrWhiteSpace(_serverUrl) && !string.IsNullOrWhiteSpace(_mkKey);

    public string Name => "Live";

    public void Dispose() => _http.Dispose();

    // ─────────────────────────────────────────────────────────────────────
    // System B — points (AOI/AVI), always-live, true 2-way.
    // ─────────────────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<ProductVersionDto>> CheckPointsVersionAsync(string? productModelCode, CancellationToken ct)
    {
        if (!IsConfigured) return Array.Empty<ProductVersionDto>();

        var url = _serverUrl + "/api/machine/check-points-version" + BuildQuery(
            ("machineCode", _machineCode), ("productModelCode", productModelCode));
        var (status, body) = await GetAsync(url, ct).ConfigureAwait(false);
        if (!IsOk(status, body)) return Array.Empty<ProductVersionDto>();

        var parsed = Deserialize<CheckPointsVersionWire>(body);
        if (parsed?.ProductModels is null) return Array.Empty<ProductVersionDto>();

        // Task C8: no PointsChecksum here (stays null) — the real check-points-version response per
        // CONFIG_SYNC_SERVER_CONTRACT.md carries version only, never a points-content checksum.
        // ConfigSyncEngine.CheckAsync's drift decision falls back to plain version equality whenever
        // either side's checksum is unavailable, so this is a correct, honest "don't know" rather than
        // fabricating one.
        return parsed.ProductModels
            .Select(p => new ProductVersionDto(p.ProductModelCode, p.PointsConfigVersion, p.ImageWidth, p.ImageHeight))
            .ToList();
    }

    public async Task<ProductModel?> GetPointsAsync(string productModelCode, string? variantCode, CancellationToken ct)
    {
        ArgumentException.ThrowIfNullOrEmpty(productModelCode);
        if (!IsConfigured) return null;

        var url = _serverUrl + "/api/machine/get-points" + BuildQuery(
            ("machineCode", _machineCode), ("productModelCode", productModelCode), ("variantCode", variantCode));
        var (status, body) = await GetAsync(url, ct).ConfigureAwait(false);
        if (!IsOk(status, body)) return null;

        var parsed = Deserialize<GetPointsWire>(body);
        var wire = parsed?.ProductModels?.FirstOrDefault(p =>
            string.Equals(p.ProductModelCode, productModelCode, StringComparison.OrdinalIgnoreCase));
        return wire is null ? null : ToProductModel(wire);
    }

    public async Task<PointsDeltaResultDto> DeltaSyncPointsAsync(string productModelCode, int sinceVersion, CancellationToken ct)
    {
        ArgumentException.ThrowIfNullOrEmpty(productModelCode);
        var empty = new PointsDeltaResultDto(false, Array.Empty<MeasurementPoint>(), Array.Empty<string>(), Array.Empty<DeletedPointDto>());
        if (!IsConfigured) return empty;

        var url = _serverUrl + "/api/machine/delta-sync-points" + BuildQuery(
            ("machineCode", _machineCode), ("productModelCode", productModelCode),
            ("sinceVersion", sinceVersion.ToString(CultureInfo.InvariantCulture)));
        var (status, body) = await GetAsync(url, ct).ConfigureAwait(false);
        if (!IsOk(status, body)) return empty;

        var parsed = Deserialize<DeltaSyncWire>(body);
        if (parsed is null) return empty;

        var deletedPoints = (parsed.DeletedPoints ?? Array.Empty<DeletedPointWire>())
            .Select(d => new DeletedPointDto(d.Code, d.DeletedAt, d.DeletedAtVersion))
            .ToList();

        return new PointsDeltaResultDto(
            parsed.HasChanges,
            parsed.Points?.ToList() ?? new List<MeasurementPoint>(),
            parsed.DeletedCodes?.ToList() ?? new List<string>(),
            deletedPoints);
    }

    /// <summary>The guarded push. See the class doc comment for the "throw only on 404" / "friendly
    /// everywhere else, including not-configured" split.</summary>
    public async Task<SyncPointsResultDto> SyncPointsAsync(string productModelCode, SyncPointsRequestDto request, CancellationToken ct)
    {
        ArgumentException.ThrowIfNullOrEmpty(productModelCode);
        ArgumentNullException.ThrowIfNull(request);

        if (!IsConfigured)
        {
            return FailedSyncResult(productModelCode, request,
                "Live chưa được cấu hình (thiếu serverUrl hoặc mk_ key) — not configured for Live.");
        }

        // machineCode is optional in the contract's sync-points body (auth already identifies the
        // caller) — ConfigSyncEngine.PushPointsAsync always sets it from the real MachineDescriptor.Code
        // already, this is just defense-in-depth for a caller that didn't.
        var wireRequest = request.MachineCode is null ? request with { MachineCode = _machineCode } : request;

        var url = _serverUrl + "/api/machine/sync-points";
        var (status, body) = await PostAsync(url, wireRequest, ct).ConfigureAwait(false);

        if (status == 404)
        {
            // Matches IConfigSyncBackend.SyncPointsAsync's own documented contract — ConfigEndpoints
            // already catches this and maps it to a friendly HTTP 404, so Demo and Live behave
            // identically for "pushed to a product the ecosystem doesn't know about".
            throw new KeyNotFoundException($"Product '{productModelCode}' not found in the ecosystem.");
        }

        if (status == NetworkUnreachable)
        {
            return FailedSyncResult(productModelCode, request,
                "Không kết nối được máy chủ (network unreachable) — push chưa được gửi.");
        }

        if (!IsOk(status, body))
        {
            return FailedSyncResult(productModelCode, request, FriendlyHttpError(status, body));
        }

        var parsed = Deserialize<SyncPointsResponseWire>(body);
        if (parsed is null)
        {
            return FailedSyncResult(productModelCode, request, "Phản hồi server không hợp lệ (invalid sync-points response).");
        }

        return new SyncPointsResultDto(
            parsed.Success,
            parsed.ProductModelCode ?? productModelCode,
            parsed.PreviousVersion ?? 0,
            parsed.NewVersion ?? parsed.PreviousVersion ?? 0,
            parsed.PointsCreated,
            parsed.PointsUpdated,
            parsed.PointsFailed,
            parsed.StaleConflicts,
            parsed.BlindOverwrites,
            parsed.LimitChangesBlocked,
            (parsed.Points ?? Array.Empty<SyncPointOutcomeWire>())
                .Select(o => new SyncPointOutcomeDto(o.Code, o.Status, o.LimitBlocked, o.Message))
                .ToList());
    }

    public async Task<(bool Found, string? ImageUrl)> GetProductImageAsync(string productModelCode, CancellationToken ct)
    {
        ArgumentException.ThrowIfNullOrEmpty(productModelCode);
        if (!IsConfigured) return (false, null);

        var url = _serverUrl + "/api/machine/product-image" + BuildQuery(
            ("machineCode", _machineCode), ("productModelCode", productModelCode));
        var (status, body) = await GetAsync(url, ct).ConfigureAwait(false);
        if (!IsOk(status, body)) return (false, null);

        var parsed = Deserialize<ImageWire>(body);
        return parsed?.ImageUrl is null ? (false, null) : (true, parsed.ImageUrl);
    }

    public async Task<bool> SyncProductImageAsync(string productModelCode, string? imageBase64, string? imageUrl, string? imageMimeType, CancellationToken ct)
    {
        ArgumentException.ThrowIfNullOrEmpty(productModelCode);
        if (!IsConfigured) return false;

        var url = _serverUrl + "/api/machine/sync-product-image";
        var reqBody = new SyncProductImageWire(productModelCode, imageBase64, imageUrl, imageMimeType, null, null);
        var (status, body) = await PostAsync(url, reqBody, ct).ConfigureAwait(false);
        return IsOk(status, body);
    }

    public async Task<(bool Found, string? ImageUrl)> GetPointImageAsync(string productModelCode, string pointCode, CancellationToken ct)
    {
        ArgumentException.ThrowIfNullOrEmpty(productModelCode);
        ArgumentException.ThrowIfNullOrEmpty(pointCode);
        if (!IsConfigured) return (false, null);

        var url = _serverUrl + "/api/machine/point-image" + BuildQuery(
            ("machineCode", _machineCode), ("productModelCode", productModelCode), ("pointCode", pointCode));
        var (status, body) = await GetAsync(url, ct).ConfigureAwait(false);
        if (!IsOk(status, body)) return (false, null);

        var parsed = Deserialize<ImageWire>(body);
        return parsed?.ImageUrl is null ? (false, null) : (true, parsed.ImageUrl);
    }

    public async Task<bool> SyncPointImageAsync(string productModelCode, string pointCode, string? imageBase64, string? imageUrl, CancellationToken ct)
    {
        ArgumentException.ThrowIfNullOrEmpty(productModelCode);
        ArgumentException.ThrowIfNullOrEmpty(pointCode);
        if (!IsConfigured) return false;

        var url = _serverUrl + "/api/machine/sync-point-image";
        var reqBody = new SyncPointImageWire(productModelCode, pointCode, imageBase64, imageUrl);
        var (status, body) = await PostAsync(url, reqBody, ct).ConfigureAwait(false);
        return IsOk(status, body);
    }

    // ─────────────────────────────────────────────────────────────────────
    // System A — recipe / device_settings, pull-only, flag-gated on a real server.
    // ─────────────────────────────────────────────────────────────────────

    public async Task<RecipeCheckResultDto> CheckRecipeAsync(string? code, string? machineType, CancellationToken ct)
    {
        // machineType is accepted for IConfigSyncBackend shape-parity with SimulatedEcosystem (which
        // uses it to resolve a recipe locally) but has no matching query param on the real contract's
        // config-sync/check — the server resolves "by machineType" itself from the calling machine's OWN
        // identity (mk_/machineCode), reflected back as resolvedBy:"machineType" in the response, not
        // supplied by the caller. See CfgGetAsync's own selector list in St4iDeviceClient for the same
        // shape (no machineType param either).
        var none = new RecipeCheckResultDto(false, null, 0, null, "none");
        if (!IsConfigured) return none;

        var url = _serverUrl + "/api/machine/config-sync/check" + BuildQuery(
            ("configKind", "recipe"), ("machineCode", _machineCode), ("configCode", code));
        var (status, body) = await GetAsync(url, ct).ConfigureAwait(false);

        if (status == 500)
        {
            // CONFIG_SYNC_GENERIC_ENABLED off — the contract's own documented "HTTP 500 non-retryable"
            // flag-off state. Friendly "nothing resolved" result, never a throw.
            return none;
        }

        if (!IsOk(status, body)) return none;

        var parsed = Deserialize<ConfigSyncCheckWire>(body);
        if (parsed is null || !parsed.Success || string.IsNullOrEmpty(parsed.Code)) return none;

        var version = ParseVersion(parsed.Version);
        return new RecipeCheckResultDto(true, parsed.Code, version, parsed.Checksum, parsed.ResolvedBy ?? "none");
    }

    public async Task<Recipe?> GetRecipeAsync(string code, CancellationToken ct)
    {
        ArgumentException.ThrowIfNullOrEmpty(code);
        if (!IsConfigured) return null;

        var url = _serverUrl + "/api/machine/config-sync/get" + BuildQuery(
            ("configKind", "recipe"), ("machineCode", _machineCode), ("configCode", code));
        var (status, body) = await GetAsync(url, ct).ConfigureAwait(false);

        if (status == 500)
        {
            // Same CONFIG_SYNC_GENERIC_ENABLED flag-off state as CheckRecipeAsync — null ("nothing
            // available"), never a throw.
            return null;
        }

        if (!IsOk(status, body)) return null;

        var parsed = Deserialize<ConfigSyncGetWire>(body);
        if (parsed is null || !parsed.Success) return null;

        return new Recipe
        {
            Code = parsed.Code ?? code,
            Name = parsed.Name ?? parsed.Code ?? code,
            Version = ParseVersion(parsed.Version),
            Checksum = parsed.Checksum,
            Status = RecipeStatus.Active,
            Payload = ToPayloadDict(parsed.Payload),
        };
    }

    // ─────────────────────────────────────────────────────────────────────
    // HTTP plumbing.
    // ─────────────────────────────────────────────────────────────────────

    private Task<(int Status, JsonElement Body)> GetAsync(string url, CancellationToken ct) =>
        SendAsync<object?>(HttpMethod.Get, url, null, ct);

    private Task<(int Status, JsonElement Body)> PostAsync<TBody>(string url, TBody body, CancellationToken ct) =>
        SendAsync(HttpMethod.Post, url, body, ct);

    private async Task<(int Status, JsonElement Body)> SendAsync<TBody>(HttpMethod method, string url, TBody? body, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(method, url);
        if (body is not null)
        {
            req.Content = new StringContent(JsonSerializer.Serialize(body, RequestOptions), Encoding.UTF8, "application/json");
        }

        ApplyAuth(req);

        try
        {
            using var resp = await _http.SendAsync(req, ct).ConfigureAwait(false);
            var text = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            return ((int)resp.StatusCode, ParseJson(text));
        }
        catch (HttpRequestException)
        {
            return (NetworkUnreachable, default);
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested)
        {
            // HttpClient.Timeout fired, not a caller-requested cancellation — same "couldn't reach it"
            // bucket as a connection failure.
            return (NetworkUnreachable, default);
        }
    }

    private void ApplyAuth(HttpRequestMessage req)
    {
        if (string.IsNullOrEmpty(_mkKey)) return;

        // Both forms — mirrors St4iDeviceClient.HttpSendAsync's own dual Bearer + X-API-Key send (the
        // contract accepts either), and the brief's explicit "Send X-API-Key: <mk_>" instruction.
        req.Headers.TryAddWithoutValidation("X-API-Key", _mkKey);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _mkKey);
    }

    private static bool IsOk(int status, JsonElement body)
    {
        if (status is < 200 or >= 300) return false;
        if (body.ValueKind == JsonValueKind.Object &&
            body.TryGetProperty("success", out var successProp) &&
            successProp.ValueKind == JsonValueKind.False)
        {
            return false;
        }

        return true;
    }

    /// <summary>Deserializes with <see cref="ConfigJson.Options"/> — the exact options the brief
    /// specifies, and what keeps every EdgeCore.Config enum landing with its contract-exact casing on the
    /// way IN (see <see cref="RequestOptions"/>'s doc comment for why outbound bodies use a different,
    /// narrowly-scoped instance).</summary>
    private static T? Deserialize<T>(JsonElement body) where T : class =>
        body.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null
            ? null
            : JsonSerializer.Deserialize<T>(body.GetRawText(), ConfigJson.Options);

    private static JsonElement ParseJson(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return default;
        try
        {
            using var doc = JsonDocument.Parse(text);
            return doc.RootElement.Clone();
        }
        catch (JsonException)
        {
            return default;
        }
    }

    private static string BuildQuery(params (string Key, string? Value)[] parts)
    {
        var pairs = parts
            .Where(p => !string.IsNullOrEmpty(p.Value))
            .Select(p => $"{p.Key}={Uri.EscapeDataString(p.Value!)}")
            .ToList();
        return pairs.Count == 0 ? "" : "?" + string.Join("&", pairs);
    }

    private static int ParseVersion(string? raw) =>
        int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) ? v : 0;

    private static string FriendlyHttpError(int status, JsonElement body)
    {
        string? message = null;
        if (body.ValueKind == JsonValueKind.Object)
        {
            if (body.TryGetProperty("message", out var m) && m.ValueKind == JsonValueKind.String)
            {
                message = m.GetString();
            }
            else if (body.TryGetProperty("error", out var e))
            {
                message = e.ValueKind == JsonValueKind.String
                    ? e.GetString()
                    : e.ValueKind == JsonValueKind.Object && e.TryGetProperty("message", out var em) && em.ValueKind == JsonValueKind.String
                        ? em.GetString()
                        : null;
            }
        }

        var suffix = message is null ? "" : $": {message}";
        return status switch
        {
            NetworkUnreachable => $"Không kết nối được máy chủ (network unreachable){suffix}",
            401 or 403 => $"Không được phép (HTTP {status}) — kiểm tra mk_ key{suffix}",
            404 => $"Không tìm thấy trên máy chủ (HTTP 404){suffix}",
            409 => $"Xung đột phiên bản (HTTP 409){suffix}",
            429 => $"Máy chủ đang giới hạn tốc độ (HTTP 429), thử lại sau{suffix}",
            500 => $"Lỗi máy chủ (HTTP 500){suffix}",
            503 => $"Máy chủ tạm thời không khả dụng (HTTP 503){suffix}",
            _ => $"HTTP {status}{suffix}",
        };
    }

    private static SyncPointsResultDto FailedSyncResult(string productModelCode, SyncPointsRequestDto request, string reason) => new(
        Success: false,
        ProductModelCode: productModelCode,
        PreviousVersion: 0,
        NewVersion: 0,
        PointsCreated: 0,
        PointsUpdated: 0,
        PointsFailed: request.Points.Count,
        StaleConflicts: 0,
        BlindOverwrites: 0,
        LimitChangesBlocked: false,
        Points: request.Points.Select(p => new SyncPointOutcomeDto(p.Code, "failed", false, reason)).ToList());

    private static ProductModel ToProductModel(GetPointsProductWire w) => new()
    {
        Code = w.ProductModelCode,
        Name = w.ProductModelName,
        ReferenceImageUrl = w.ReferenceImageUrl,
        ImageWidth = w.ImageWidth,
        ImageHeight = w.ImageHeight,
        CoordinateMode = w.CoordinateMode,
        PointsConfigVersion = w.PointsConfigVersion,
        Fiducials = w.Fiducials?.ToList() ?? new List<Fiducial>(),
        Points = w.Points?.ToList() ?? new List<MeasurementPoint>(),
        // get-points' own contract shape carries no lifecycleStatus (that's a product_models column the
        // System B pull surface simply doesn't expose to a machine) — stays at ProductModel's own
        // default (Development). Purely descriptive locally either way: threshold governance for a Live
        // push is enforced SERVER-SIDE and its outcome (limitBlocked) comes back on the sync-points
        // response, not computed from this field.
    };

    /// <summary>Flattens a parsed <see cref="JsonElement"/> object into a plain
    /// <c>Dictionary&lt;string, object?&gt;</c> — what <see cref="Recipe.Payload"/> expects. Nested
    /// objects/arrays are kept as <see cref="JsonElement"/> (still perfectly JSON-serializable later,
    /// e.g. by <see cref="ConfigChecksum.Compute(object?)"/>) rather than recursively unwrapped — the
    /// payload shapes this project deals with (torque/speed settings, IoT device_settings) are flat in
    /// practice, so this only needs to handle the top level correctly.</summary>
    private static Dictionary<string, object?> ToPayloadDict(JsonElement? payload)
    {
        var dict = new Dictionary<string, object?>();
        if (payload is not { ValueKind: JsonValueKind.Object } el) return dict;

        foreach (var prop in el.EnumerateObject())
        {
            dict[prop.Name] = ToPlainValue(prop.Value);
        }

        return dict;
    }

    private static object? ToPlainValue(JsonElement el) => el.ValueKind switch
    {
        JsonValueKind.String => el.GetString(),
        JsonValueKind.Number => el.TryGetInt64(out var l) ? l : el.GetDouble(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Null or JsonValueKind.Undefined => null,
        _ => el.Clone(),
    };
}
