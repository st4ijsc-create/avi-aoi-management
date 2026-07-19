using System.Net.Http;
using System.Text;
using System.Text.Json;
using St4i.DeviceClient;
using St4i.EdgeCore.Infrastructure;

namespace St4i.EngineApi.Fleet;

/// <summary>
/// Task 3 — <c>POST /v1/onboarding/{register|poll|claim|enroll|paste-key}</c>: register a machine →
/// poll for admin approval → claim (mct_ one-time token) or enroll (met_ zero-touch token) → store the
/// resulting mk_ key via <see cref="CredentialStore"/>. The headless-host analogue of the WPF app's
/// <c>OnboardingViewModel</c> — same demo-fabrication contract (default <c>isDemo=true</c> so it works
/// with no live server reachable; Register goes straight to "Pending", PollApproval resolves "Approved"
/// immediately, Claim/Enroll mint a demo mk_ key locally), with Live mode (<c>isDemo=false</c>) doing
/// the real thing over a raw <see cref="HttpClient"/> (register/poll — no SDK method covers the REST
/// bootstrap endpoints) or <see cref="St4iDeviceClient"/> (claim/enroll).
/// </summary>
public sealed class OnboardingService
{
    private readonly HttpClient _http;

    public OnboardingService(HttpClient? http = null)
    {
        _http = http ?? new HttpClient();
    }

    public Task<OnboardingStepResult> RegisterAsync(OnboardingRegisterRequest req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.SerialNumber))
            return Task.FromResult(new OnboardingStepResult("Idle", null, null, false, "serialNumber is required."));

        if (req.IsDemo)
        {
            return Task.FromResult(new OnboardingStepResult("Pending", null, null, false,
                $"[DEMO] Registered {req.SerialNumber} (\"{req.Name}\", {req.MachineType}) — registrationStatus=pending"));
        }

        return LiveRegisterAsync(req, ct);
    }

    public Task<OnboardingStepResult> PollAsync(OnboardingPollRequest req, CancellationToken ct)
    {
        if (req.IsDemo)
        {
            return Task.FromResult(new OnboardingStepResult("Approved", null, null, true,
                "[DEMO] Poll approval — isApproved=true (instant simulated approval)"));
        }

        return LivePollAsync(req, ct);
    }

    public Task<OnboardingStepResult> ClaimAsync(OnboardingClaimRequest req, CancellationToken ct)
    {
        if (req.IsDemo)
        {
            var code = string.IsNullOrWhiteSpace(req.SerialNumber) ? "SIM-DEMO" : req.SerialNumber;
            var key = FabricateMkKey();
            CredentialStore.Save(code, key);
            return Task.FromResult(new OnboardingStepResult("Claimed", code, key, false, $"[DEMO] Claimed — mk_ key fabricated + stored for {code}"));
        }

        return LiveClaimAsync(req, ct);
    }

    public Task<OnboardingStepResult> EnrollAsync(OnboardingEnrollRequest req, CancellationToken ct)
    {
        if (req.IsDemo)
        {
            var code = string.IsNullOrWhiteSpace(req.SerialNumber) ? "SIM-DEMO" : req.SerialNumber;
            var key = FabricateMkKey();
            CredentialStore.Save(code, key);
            return Task.FromResult(new OnboardingStepResult("Enrolled", code, key, false, $"[DEMO] Enrolled — mk_ key fabricated + stored for {code}"));
        }

        return LiveEnrollAsync(req, ct);
    }

    public OnboardingStepResult PasteKey(OnboardingPasteKeyRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.MachineCode) || string.IsNullOrWhiteSpace(req.MkKey))
            return new OnboardingStepResult("Idle", null, null, false, "Both machineCode and mkKey are required.");

        CredentialStore.Save(req.MachineCode, req.MkKey);
        return new OnboardingStepResult("Claimed", req.MachineCode, req.MkKey, false, $"Pasted mk_ key stored for {req.MachineCode}");
    }

    // ─────────────────────────────────────────────────────────────────────
    // LIVE PATHS
    // ─────────────────────────────────────────────────────────────────────
    private async Task<OnboardingStepResult> LiveRegisterAsync(OnboardingRegisterRequest req, CancellationToken ct)
    {
        try
        {
            var serverUrl = RequireServerUrl(req.ServerUrl);
            var body = new Dictionary<string, object?> { ["serialNumber"] = req.SerialNumber, ["name"] = req.Name, ["machineType"] = req.MachineType };
            var json = await PostJsonAsync(serverUrl, "/api/machine/register", body, ct).ConfigureAwait(false);
            var status = GetString(json, "registrationStatus") ?? "pending";
            return new OnboardingStepResult("Pending", null, null, false, $"Registered {req.SerialNumber} — registrationStatus={status}");
        }
        catch (Exception ex)
        {
            return new OnboardingStepResult("Idle", null, null, false, $"Register failed: {ex.Message}");
        }
    }

    private async Task<OnboardingStepResult> LivePollAsync(OnboardingPollRequest req, CancellationToken ct)
    {
        try
        {
            var serverUrl = RequireServerUrl(req.ServerUrl);
            var url = $"/api/machine/config?serialNumber={Uri.EscapeDataString(req.SerialNumber)}";
            var json = await GetJsonAsync(serverUrl, url, ct).ConfigureAwait(false);
            var isApproved = GetBool(json, "isApproved");
            var requiresClaim = GetBool(json, "requiresClaim");
            return isApproved
                ? new OnboardingStepResult("Approved", null, null, true, $"Poll approval: approved (requiresClaim={requiresClaim})")
                : new OnboardingStepResult("Pending", null, null, false, "Poll approval: still pending — try again shortly.");
        }
        catch (Exception ex)
        {
            return new OnboardingStepResult("Idle", null, null, false, $"Poll approval failed: {ex.Message}");
        }
    }

    private async Task<OnboardingStepResult> LiveClaimAsync(OnboardingClaimRequest req, CancellationToken ct)
    {
        try
        {
            var serverUrl = RequireServerUrl(req.ServerUrl);
            var client = new St4iDeviceClient(serverUrl: serverUrl, serialNumber: req.SerialNumber);
            var cred = await client.ClaimAsync(req.ClaimToken ?? string.Empty, req.SerialNumber, ct).ConfigureAwait(false);
            return AbsorbCredential(cred, "Claimed", req.SerialNumber);
        }
        catch (Exception ex)
        {
            return new OnboardingStepResult("Idle", null, null, false, $"Claim failed: {ex.Message}");
        }
    }

    private async Task<OnboardingStepResult> LiveEnrollAsync(OnboardingEnrollRequest req, CancellationToken ct)
    {
        try
        {
            var serverUrl = RequireServerUrl(req.ServerUrl);
            var client = new St4iDeviceClient(serverUrl: serverUrl, serialNumber: req.SerialNumber);
            var machineInfo = new Dictionary<string, object> { ["name"] = req.Name ?? req.SerialNumber, ["machineType"] = req.MachineType ?? "" };
            var cred = await client.EnrollAsync(req.EnrollToken ?? string.Empty, req.SerialNumber, machineInfo, ct).ConfigureAwait(false);
            return AbsorbCredential(cred, "Enrolled", req.SerialNumber);
        }
        catch (Exception ex)
        {
            return new OnboardingStepResult("Idle", null, null, false, $"Enroll failed: {ex.Message}");
        }
    }

    private static OnboardingStepResult AbsorbCredential(Credential cred, string verb, string serialNumber)
    {
        if (string.IsNullOrEmpty(cred.ApiKey))
            return new OnboardingStepResult("Idle", null, null, false, $"{verb} returned no apiKey.");

        var code = cred.Code ?? serialNumber;
        CredentialStore.Save(code, cred.ApiKey);
        return new OnboardingStepResult(verb, code, cred.ApiKey, false, $"{verb} — mk_ key stored for {code}");
    }

    private static string RequireServerUrl(string? serverUrl)
    {
        if (string.IsNullOrWhiteSpace(serverUrl))
            throw new InvalidOperationException("serverUrl is required for live (non-demo) onboarding.");
        return serverUrl;
    }

    /// <summary>Mints a demo-only <c>mk_</c> credential — same shape as the WPF app's
    /// <c>OnboardingViewModel.FabricateMkKey</c>: <c>"mk_"</c> + 48 lowercase hex chars, never used for
    /// anything security-sensitive.</summary>
    private static string FabricateMkKey()
    {
        var hex = (Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N"))[..48];
        return "mk_" + hex;
    }

    private async Task<JsonElement> PostJsonAsync(string serverUrl, string relativePath, object body, CancellationToken ct)
    {
        var url = $"{serverUrl.TrimEnd('/')}{relativePath}";
        var json = JsonSerializer.Serialize(body);
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        using var resp = await _http.PostAsync(url, content, ct).ConfigureAwait(false);
        return await ReadJsonAsync(resp, ct).ConfigureAwait(false);
    }

    private async Task<JsonElement> GetJsonAsync(string serverUrl, string relativePath, CancellationToken ct)
    {
        var url = $"{serverUrl.TrimEnd('/')}{relativePath}";
        using var resp = await _http.GetAsync(url, ct).ConfigureAwait(false);
        return await ReadJsonAsync(resp, ct).ConfigureAwait(false);
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage resp, CancellationToken ct)
    {
        var text = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (!resp.IsSuccessStatusCode)
            throw new InvalidOperationException($"HTTP {(int)resp.StatusCode}: {text}");
        if (string.IsNullOrWhiteSpace(text))
            return default;
        using var doc = JsonDocument.Parse(text);
        return doc.RootElement.Clone();
    }

    private static bool GetBool(JsonElement o, string name) =>
        o.ValueKind == JsonValueKind.Object && o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    private static string? GetString(JsonElement o, string name) =>
        o.ValueKind == JsonValueKind.Object && o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;
}
