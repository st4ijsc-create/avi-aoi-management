using System.Collections.ObjectModel;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Windows;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Win32;
using St4i.DeviceClient;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;

namespace St4iMachineSimulator.ViewModels;

/// <summary>
/// Task 18's wizard steps, doc 62 §5.10 "Onboarding": <see cref="Idle"/> → <see cref="Pending"/> (raw
/// <c>POST /api/machine/register</c> succeeded, waiting on admin approval) → <see cref="Approved"/>
/// (poll observed <c>isApproved=true</c>) → <see cref="Claimed"/>/<see cref="Enrolled"/> (an mk_ key
/// has been obtained — via a one-time claim token or a zero-touch enrollment token respectively — and
/// persisted to <see cref="CredentialStore"/>).
/// </summary>
public enum OnboardingStep
{
    Idle,
    Pending,
    Approved,
    Claimed,
    Enrolled,
}

/// <summary>
/// Task 18 — the Onboarding wizard's ViewModel: register a machine → poll for admin approval → claim
/// (mct_ one-time token) or enroll (met_ zero-touch token) → store the resulting mk_ key via
/// <see cref="CredentialStore"/>. Plus two fast paths that skip the wizard entirely: pasting an
/// already-issued mk_ key straight in, and loading a whole fleet's roster from a <c>fleet.json</c> via
/// <see cref="FleetConfig"/>.
///
/// <see cref="IsDemo"/> (default true, per the brief: "so it can be demonstrated with no live server")
/// makes Register/PollApproval/Claim/Enroll FABRICATE the entire flow with no network call at all —
/// Register goes straight to <see cref="OnboardingStep.Pending"/>, PollApproval resolves
/// <see cref="OnboardingStep.Approved"/> immediately, and Claim/Enroll mint a demo <c>mk_</c> key
/// locally (see <see cref="FabricateMkKey"/>) rather than exchanging a real token with a server. Live
/// mode (<see cref="IsDemo"/>=false) does the real thing: Register/PollApproval go over a raw
/// <see cref="HttpClient"/> against the REST bootstrap endpoints (there is no SDK method for these —
/// see the SDK's own doc comment: bootstrap only covers enroll/claim, not register/poll), Claim/Enroll
/// go through <see cref="St4iDeviceClient"/>'s tRPC calls.
/// </summary>
public sealed partial class OnboardingViewModel : ObservableObject
{
    private readonly HttpClient _http;

    public OnboardingViewModel() : this(new HttpClient())
    {
    }

    /// <summary>Test/DI seam — lets a caller (e.g. a future integration test) hand in an
    /// <see cref="HttpClient"/> built over a fake <see cref="HttpMessageHandler"/> instead of one that
    /// actually dials out. <c>--selftest</c> doesn't need this: it only ever runs the Demo path, which
    /// never touches <see cref="_http"/>.</summary>
    public OnboardingViewModel(HttpClient httpClient)
    {
        _http = httpClient ?? throw new ArgumentNullException(nameof(httpClient));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Wizard inputs
    // ─────────────────────────────────────────────────────────────────────
    [ObservableProperty]
    private string serialNumber = "SIM-0001";

    [ObservableProperty]
    private string name = "Simulated Machine";

    [ObservableProperty]
    private string machineType = "SCREWDRIVE";

    /// <summary>Placeholder Live server URL — same role as <c>App.PlaceholderServerUrl</c>, made
    /// editable here rather than hardcoded, since Onboarding is the one screen that dials out on its
    /// own (outside the fleet's shared <c>AutoTransport</c>). Real configurability lands in Task 19
    /// (Settings); Demo mode ignores this entirely.</summary>
    [ObservableProperty]
    private string serverUrl = "https://factory.local:5000";

    /// <summary>Default TRUE per the brief — the exhibition booth's normal path (no live server
    /// reachable). Toggling this off switches Register/PollApproval/Claim/Enroll to the real
    /// HTTP/SDK calls below.</summary>
    [ObservableProperty]
    private bool isDemo = true;

    [ObservableProperty]
    private OnboardingStep step = OnboardingStep.Idle;

    /// <summary>The machine identifier Claim/Enroll's resulting mk_ key is stored under (the SDK's
    /// <see cref="Credential.Code"/> in Live mode, falling back to <see cref="SerialNumber"/> if the
    /// server didn't echo one back — same fallback the Demo path always takes, since it never talks to
    /// a server at all).</summary>
    [ObservableProperty]
    private string? machineCode;

    /// <summary>The mk_ key most recently obtained by Claim/Enroll/PasteKey — never persisted here
    /// itself (that's <see cref="CredentialStore"/>'s job), just kept around so the wizard can show it
    /// once and so <c>--selftest</c> can assert against it.</summary>
    [ObservableProperty]
    private string? mkKey;

    /// <summary>Append-only, newest-last human-readable log of every step this wizard has taken this
    /// session — the scrollable text area at the bottom of <c>OnboardingView</c>.</summary>
    [ObservableProperty]
    private string statusLog = string.Empty;

    /// <summary>One-time claim token (mct_) — required in Live mode, ignored in Demo (per the brief).</summary>
    [ObservableProperty]
    private string claimToken = string.Empty;

    /// <summary>Zero-touch enrollment token (met_) — required in Live mode, ignored in Demo.</summary>
    [ObservableProperty]
    private string enrollToken = string.Empty;

    // ─────────────────────────────────────────────────────────────────────
    // "Paste mk_" fast path
    // ─────────────────────────────────────────────────────────────────────
    [ObservableProperty]
    private string pasteMkKey = string.Empty;

    [ObservableProperty]
    private string pasteMachineCode = string.Empty;

    // ─────────────────────────────────────────────────────────────────────
    // "Load fleet.json" fast path
    // ─────────────────────────────────────────────────────────────────────
    [ObservableProperty]
    private string fleetPath = string.Empty;

    [ObservableProperty]
    private int loadedMachineCount;

    public ObservableCollection<MachineDescriptor> LoadedMachines { get; } = new();

    // ─────────────────────────────────────────────────────────────────────
    // Register → Poll → Claim/Enroll
    // ─────────────────────────────────────────────────────────────────────

    /// <summary><c>POST {ServerUrl}/api/machine/register</c> — no SDK method covers this (bootstrap is
    /// enroll/claim only), so Live mode goes over a raw <see cref="HttpClient"/> call directly.</summary>
    [RelayCommand]
    private async Task RegisterAsync()
    {
        if (string.IsNullOrWhiteSpace(SerialNumber))
        {
            Log("Register: SerialNumber is required.");
            return;
        }

        if (IsDemo)
        {
            Step = OnboardingStep.Pending;
            Log($"[DEMO] Registered {SerialNumber} (\"{Name}\", {MachineType}) — registrationStatus=pending");
            return;
        }

        try
        {
            var body = new Dictionary<string, object?>
            {
                ["serialNumber"] = SerialNumber,
                ["name"] = Name,
                ["machineType"] = MachineType,
            };
            var json = await PostJsonAsync("/api/machine/register", body, CancellationToken.None).ConfigureAwait(true);
            RunOnUiThread(() =>
            {
                var status = GetString(json, "registrationStatus") ?? "pending";
                Step = OnboardingStep.Pending;
                Log($"Registered {SerialNumber} — registrationStatus={status}");
            });
        }
        catch (Exception ex)
        {
            RunOnUiThread(() => Log($"Register failed: {ex.Message}"));
        }
    }

    /// <summary><c>GET {ServerUrl}/api/machine/config?serialNumber=...</c> — same "no SDK method"
    /// reasoning as <see cref="RegisterAsync"/>.</summary>
    [RelayCommand]
    private async Task PollApprovalAsync()
    {
        if (IsDemo)
        {
            Step = OnboardingStep.Approved;
            Log("[DEMO] Poll approval — isApproved=true (instant simulated approval)");
            return;
        }

        try
        {
            var url = $"/api/machine/config?serialNumber={Uri.EscapeDataString(SerialNumber)}";
            var json = await GetJsonAsync(url, CancellationToken.None).ConfigureAwait(true);
            RunOnUiThread(() =>
            {
                var isApproved = GetBool(json, "isApproved");
                var requiresClaim = GetBool(json, "requiresClaim");
                if (isApproved)
                {
                    Step = OnboardingStep.Approved;
                    Log($"Poll approval: approved (requiresClaim={requiresClaim})");
                }
                else
                {
                    Log("Poll approval: still pending — try again shortly.");
                }
            });
        }
        catch (Exception ex)
        {
            RunOnUiThread(() => Log($"Poll approval failed: {ex.Message}"));
        }
    }

    /// <summary>Redeems a one-time claim token (mct_) for an mk_ key. Demo mode fabricates the whole
    /// exchange locally (see class remarks); Live mode goes through <see cref="St4iDeviceClient.ClaimAsync"/>.</summary>
    [RelayCommand]
    private async Task ClaimAsync()
    {
        if (IsDemo)
        {
            var code = string.IsNullOrWhiteSpace(SerialNumber) ? "SIM-DEMO" : SerialNumber;
            var key = FabricateMkKey();
            CredentialStore.Save(code, key);
            MachineCode = code;
            MkKey = key;
            Step = OnboardingStep.Claimed;
            Log($"[DEMO] Claimed — mk_ key fabricated + stored for {code}");
            return;
        }

        try
        {
            var client = new St4iDeviceClient(serverUrl: ServerUrl, serialNumber: SerialNumber);
            var cred = await client.ClaimAsync(ClaimToken, SerialNumber, CancellationToken.None).ConfigureAwait(true);
            RunOnUiThread(() => AbsorbCredential(cred, OnboardingStep.Claimed, "Claimed"));
        }
        catch (Exception ex)
        {
            RunOnUiThread(() => Log($"Claim failed: {ex.Message}"));
        }
    }

    /// <summary>Redeems a zero-touch enrollment token (met_) for an mk_ key. Demo mode fabricates
    /// locally (see class remarks); Live mode goes through <see cref="St4iDeviceClient.EnrollAsync"/>.</summary>
    [RelayCommand]
    private async Task EnrollAsync()
    {
        if (IsDemo)
        {
            var code = string.IsNullOrWhiteSpace(SerialNumber) ? "SIM-DEMO" : SerialNumber;
            var key = FabricateMkKey();
            CredentialStore.Save(code, key);
            MachineCode = code;
            MkKey = key;
            Step = OnboardingStep.Enrolled;
            Log($"[DEMO] Enrolled — mk_ key fabricated + stored for {code}");
            return;
        }

        try
        {
            var client = new St4iDeviceClient(serverUrl: ServerUrl, serialNumber: SerialNumber);
            var machineInfo = new Dictionary<string, object> { ["name"] = Name, ["machineType"] = MachineType };
            var cred = await client.EnrollAsync(EnrollToken, SerialNumber, machineInfo, CancellationToken.None).ConfigureAwait(true);
            RunOnUiThread(() => AbsorbCredential(cred, OnboardingStep.Enrolled, "Enrolled"));
        }
        catch (Exception ex)
        {
            RunOnUiThread(() => Log($"Enroll failed: {ex.Message}"));
        }
    }

    /// <summary>Shared Claim/Enroll success path (Live mode only — Demo inlines its own fabricated
    /// version above since it has no <see cref="Credential"/> DTO to absorb). MUST run on the UI thread
    /// (touches bound properties) — see the two callers' <c>RunOnUiThread</c> wrapping.</summary>
    private void AbsorbCredential(Credential cred, OnboardingStep succeededStep, string verb)
    {
        if (string.IsNullOrEmpty(cred.ApiKey))
        {
            Log($"{verb} returned no apiKey.");
            return;
        }

        var code = cred.Code ?? SerialNumber;
        CredentialStore.Save(code, cred.ApiKey);
        MachineCode = code;
        MkKey = cred.ApiKey;
        Step = succeededStep;
        Log($"{verb} — mk_ key stored for {code}");
    }

    // ─────────────────────────────────────────────────────────────────────
    // "Paste mk_" fast path
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Skips the whole register→poll→claim dance for a key an operator already has in hand
    /// (e.g. copied from another tool, or issued out-of-band) — just persists it via
    /// <see cref="CredentialStore"/> under the given machine code.</summary>
    [RelayCommand]
    private void PasteKey()
    {
        if (string.IsNullOrWhiteSpace(PasteMkKey) || string.IsNullOrWhiteSpace(PasteMachineCode))
        {
            Log("Paste mk_: both the key and the machine code are required.");
            return;
        }

        CredentialStore.Save(PasteMachineCode, PasteMkKey);
        MachineCode = PasteMachineCode;
        MkKey = PasteMkKey;
        Log($"Pasted mk_ key stored for {PasteMachineCode}");
    }

    // ─────────────────────────────────────────────────────────────────────
    // "Load fleet.json" fast path
    // ─────────────────────────────────────────────────────────────────────

    [RelayCommand]
    private void BrowseFleetFile()
    {
        var dialog = new OpenFileDialog
        {
            Filter = "fleet.json (*.json)|*.json|All files (*.*)|*.*",
            FileName = "fleet.json",
        };
        if (dialog.ShowDialog() == true)
        {
            FleetPath = dialog.FileName;
        }
    }

    /// <summary>Loads a whole simulated fleet's roster via <see cref="FleetConfig.Load"/> — the same
    /// parser <c>FleetService</c> would use, exposed here so an operator can preview/validate a
    /// fleet.json (machine count, no exception) before wiring it into an actual run.</summary>
    [RelayCommand]
    private void LoadFleet()
    {
        if (string.IsNullOrWhiteSpace(FleetPath))
        {
            Log("Load fleet.json: a path is required.");
            return;
        }

        try
        {
            var machines = FleetConfig.Load(FleetPath);
            LoadedMachines.Clear();
            foreach (var m in machines) LoadedMachines.Add(m);
            LoadedMachineCount = LoadedMachines.Count;
            Log($"Loaded fleet.json: {LoadedMachineCount} machine(s) from {FleetPath}");
        }
        catch (FleetConfigException ex)
        {
            Log($"Load fleet.json failed: {ex.Message}");
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────

    private void Log(string message)
    {
        var line = $"[{DateTime.Now:HH:mm:ss}] {message}";
        StatusLog = string.IsNullOrEmpty(StatusLog) ? line : $"{StatusLog}{Environment.NewLine}{line}";
    }

    /// <summary>Mints a demo-only <c>mk_</c> credential: <c>"mk_"</c> + 48 lowercase hex chars, derived
    /// from two concatenated GUIDs (128 bits of randomness truncated to 48 chars) — plenty unique
    /// across a single exhibition session without needing a real key-issuance authority. Never used for
    /// anything security-sensitive; Live mode always gets its key from the actual server.</summary>
    private static string FabricateMkKey()
    {
        var hex = (Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N"))[..48];
        return "mk_" + hex;
    }

    private async Task<JsonElement> PostJsonAsync(string relativePath, object body, CancellationToken ct)
    {
        var url = $"{ServerUrl.TrimEnd('/')}{relativePath}";
        var json = JsonSerializer.Serialize(body);
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        using var resp = await _http.PostAsync(url, content, ct).ConfigureAwait(true);
        return await ReadJsonAsync(resp, ct).ConfigureAwait(true);
    }

    private async Task<JsonElement> GetJsonAsync(string relativePath, CancellationToken ct)
    {
        var url = $"{ServerUrl.TrimEnd('/')}{relativePath}";
        using var resp = await _http.GetAsync(url, ct).ConfigureAwait(true);
        return await ReadJsonAsync(resp, ct).ConfigureAwait(true);
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage resp, CancellationToken ct)
    {
        var text = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(true);
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

    /// <summary>Same dispatcher-marshaling pattern as <c>MachineViewModel.RunOnUiThread</c>/
    /// <c>InspectorViewModel.RunOnUiThread</c>: inline if already on the UI thread, dispatched
    /// otherwise, inline if there is no <see cref="Application.Current"/> yet (e.g. <c>--selftest</c>,
    /// which runs before <c>Application.Run</c> starts WPF's own message loop). Needed here because the
    /// Live-mode HTTP/SDK awaits above have no <c>ConfigureAwait(false)</c> anywhere in their call
    /// chain but that alone does NOT guarantee the continuation resumes on the UI thread (it resumes on
    /// whatever <see cref="SynchronizationContext"/>, if any, was captured at the await point) — so
    /// every bound-property write after one of those awaits goes through this helper rather than
    /// assuming the thread.</summary>
    private static void RunOnUiThread(Action action)
    {
        var dispatcher = Application.Current?.Dispatcher;
        if (dispatcher is null || dispatcher.CheckAccess())
        {
            action();
        }
        else
        {
            dispatcher.Invoke(action);
        }
    }
}
