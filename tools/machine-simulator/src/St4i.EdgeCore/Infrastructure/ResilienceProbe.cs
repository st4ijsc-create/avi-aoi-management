using System.Text.Json;

namespace St4i.EdgeCore.Infrastructure;

/// <summary>Result of a single <see cref="ResilienceProbe.ProbeAsync"/> call: whether the server
/// answered at all, its HTTP status, and (if the body parsed as the OpenAPI document we expect) the
/// set of documented path keys — used by the WPF app's "server health" panel to show something more
/// useful than a bare up/down bit.</summary>
public record ProbeResult(bool Reachable, int Status, IReadOnlyList<string> Paths);

/// <summary>
/// Cheap connectivity/contract check against the live server: GETs its published
/// <c>/api/v1/openapi.json</c> and reports whether it answered and what paths it documents.
/// Never throws on network failure — a probe is inherently "maybe the server is down," so any
/// connectivity problem (DNS, refused, timeout, TLS) is reported as <c>Reachable:false</c> rather
/// than propagated as an exception the caller has to remember to catch.
/// </summary>
public sealed class ResilienceProbe
{
    private static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(5);

    private readonly HttpClient _http;

    public ResilienceProbe(HttpClient? http = null)
    {
        _http = http ?? new HttpClient { Timeout = DefaultTimeout };
    }

    public async Task<ProbeResult> ProbeAsync(string serverUrl, CancellationToken ct)
    {
        ArgumentException.ThrowIfNullOrEmpty(serverUrl);

        var url = serverUrl.TrimEnd('/') + "/api/v1/openapi.json";
        try
        {
            using var response = await _http.GetAsync(url, ct).ConfigureAwait(false);
            var status = (int)response.StatusCode;

            if (!response.IsSuccessStatusCode)
            {
                return new ProbeResult(Reachable: true, Status: status, Paths: Array.Empty<string>());
            }

            var body = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            return new ProbeResult(Reachable: true, Status: status, Paths: ExtractPaths(body));
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or OperationCanceledException && !ct.IsCancellationRequested)
        {
            // Network-level failure (refused/DNS/timeout) or the HttpClient's own timeout firing —
            // NOT a caller-requested cancellation (that's allowed to propagate normally).
            return new ProbeResult(Reachable: false, Status: 0, Paths: Array.Empty<string>());
        }
    }

    /// <summary>Best-effort extraction of the OpenAPI document's top-level <c>paths</c> object keys.
    /// Returns an empty list for anything that isn't parseable JSON or doesn't have that shape —
    /// this is a diagnostic aid, not a strict OpenAPI parser.</summary>
    private static IReadOnlyList<string> ExtractPaths(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return Array.Empty<string>();
            if (!doc.RootElement.TryGetProperty("paths", out var paths)) return Array.Empty<string>();
            if (paths.ValueKind != JsonValueKind.Object) return Array.Empty<string>();

            var keys = new List<string>();
            foreach (var prop in paths.EnumerateObject()) keys.Add(prop.Name);
            return keys;
        }
        catch (JsonException)
        {
            return Array.Empty<string>();
        }
    }
}
