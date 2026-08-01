using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4iMachineSimulator.Infrastructure;
using St4iMachineSimulator.Services;

namespace St4iMachineSimulator.ViewModels;

/// <summary>
/// Task 19a — the Settings screen's ViewModel: the live-server connection (ServerUrl/VerifyTls/which
/// stored credential to use), the Live/Demo/Auto <see cref="Mode"/> selector (bound straight through to
/// <see cref="TransportCoordinator"/> — the same source of truth <c>AppShellViewModel</c>'s top-bar
/// combo uses, see <see cref="TransportCoordinator"/>'s class remarks for why the two ViewModels don't
/// depend on each other directly), a "Kiểm cờ / Check server" probe
/// (<see cref="St4i.EdgeCore.Infrastructure.ResilienceProbe"/>), the stored-credentials view, a "Paste
/// mk_" fast path, and — wired for real as of Task 20 — Kiosk/Attract/Language.
/// </summary>
public sealed partial class SettingsViewModel : ObservableObject
{
    /// <summary>Same placeholder connection this app already boots with (<c>App.PlaceholderServerUrl</c>/
    /// <c>PlaceholderMachineCode</c>) — kept in sync here so Settings starts out describing exactly what
    /// <see cref="TransportCoordinator"/> was actually constructed with, not a different default.</summary>
    public const string DefaultServerUrl = "http://localhost:5000";

    public const string DefaultMachineCode = "SIM-EDGE-00";

    private readonly TransportCoordinator _transportCoordinator;
    private readonly AttractModeService _attractModeService;
    private readonly ResilienceProbe _probe = new();

    public SettingsViewModel(TransportCoordinator transportCoordinator, AttractModeService attractModeService)
    {
        _transportCoordinator = transportCoordinator ?? throw new ArgumentNullException(nameof(transportCoordinator));
        _attractModeService = attractModeService ?? throw new ArgumentNullException(nameof(attractModeService));
        _transportCoordinator.ModeChanged += OnCoordinatorModeChanged;
        Mode = _transportCoordinator.Mode;

        // Task 20 — mirror THIS ViewModel's own defaults into the services that actually implement them,
        // rather than relying on those services happening to default the same way independently.
        _attractModeService.Enabled = Attract;
        LocalizationService.SetLanguage(Language);

        RefreshCredentials();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Connection — ServerUrl/VerifyTls/MachineCode drive TransportCoordinator.RebuildLive whenever any
    // of them changes (see the OnXChanged hooks below).
    // ─────────────────────────────────────────────────────────────────────
    [ObservableProperty]
    private string serverUrl = DefaultServerUrl;

    [ObservableProperty]
    private bool verifyTls = true;

    /// <summary>Which stored credential (see <see cref="StoredMachineCodes"/>) the rebuilt
    /// <see cref="St4i.EdgeCore.Transport.LiveTransport"/> authenticates as — looked up via
    /// <see cref="CredentialStore.Load"/> each time this changes, not cached, so pasting a fresh mk_ for
    /// the same code (see <see cref="PasteMk"/>) picks it up on the next rebuild without requiring the
    /// user to also retype the machine code.</summary>
    [ObservableProperty]
    private string machineCode = DefaultMachineCode;

    /// <summary>Bound straight through to <see cref="TransportCoordinator.Mode"/> — see this class's own
    /// remarks and <see cref="TransportCoordinator"/>'s for why Settings doesn't just read
    /// <c>AppShellViewModel.Mode</c> directly.</summary>
    [ObservableProperty]
    private TransportMode mode = TransportMode.Demo;

    public IReadOnlyList<TransportMode> AvailableModes { get; } = Enum.GetValues<TransportMode>();

    partial void OnServerUrlChanged(string value) => RebuildLive();

    partial void OnVerifyTlsChanged(bool value) => RebuildLive();

    partial void OnMachineCodeChanged(string value) => RebuildLive();

    partial void OnModeChanged(TransportMode value) => _transportCoordinator.ApplyMode(value);

    /// <summary>Mirrors <see cref="TransportCoordinator.Mode"/> changes made from elsewhere (the
    /// shell's own top-bar combo) onto this VM's <see cref="Mode"/> — same loop-safe pattern as
    /// <c>AppShellViewModel.OnCoordinatorModeChanged</c> (the generated property setter no-ops when the
    /// value doesn't actually change, so this never re-triggers <see cref="OnModeChanged"/>).</summary>
    private void OnCoordinatorModeChanged(TransportMode newMode) => DispatcherHelper.RunOnUiThread(() =>
    {
        if (Mode != newMode) Mode = newMode;
    });

    private void RebuildLive()
    {
        if (string.IsNullOrWhiteSpace(ServerUrl) || string.IsNullOrWhiteSpace(MachineCode)) return;

        var mkKey = CredentialStore.Load(MachineCode);
        _transportCoordinator.RebuildLive(ServerUrl, MachineCode, mkKey, VerifyTls);
    }

    // ─────────────────────────────────────────────────────────────────────
    // "Kiểm cờ / Check server" probe — GETs {ServerUrl}/api/v1/openapi.json (doc61) and reports whether
    // it answered, its HTTP status, and how many paths it documents.
    // ─────────────────────────────────────────────────────────────────────
    [ObservableProperty]
    private bool probeRan;

    [ObservableProperty]
    private bool probeReachable;

    [ObservableProperty]
    private int probeStatus;

    [ObservableProperty]
    private int probePathCount;

    [ObservableProperty]
    private string probeSummary = "Chưa kiểm tra — bấm \"Kiểm cờ\" để kiểm tra kết nối server.";

    [RelayCommand]
    private async Task CheckFlagsAsync()
    {
        DispatcherHelper.RunOnUiThread(() => ProbeSummary = "Đang kiểm tra...");

        ProbeResult result;
        try
        {
            result = await _probe.ProbeAsync(ServerUrl, CancellationToken.None);
        }
        catch (Exception ex)
        {
            // ResilienceProbe.ProbeAsync itself already swallows ordinary connectivity failures into
            // Reachable=false (see its own remarks) — this only catches something unexpected (e.g. a
            // malformed ServerUrl throwing ArgumentException) so the button never leaves the VM in a
            // stuck "Đang kiểm tra..." state.
            DispatcherHelper.RunOnUiThread(() => ProbeSummary = $"Lỗi kiểm tra: {ex.Message}");
            return;
        }

        DispatcherHelper.RunOnUiThread(() =>
        {
            ProbeRan = true;
            ProbeReachable = result.Reachable;
            ProbeStatus = result.Status;
            ProbePathCount = result.Paths.Count;
            ProbeSummary = result.Reachable
                ? $"OK — HTTP {result.Status}, {result.Paths.Count} path(s) trong OpenAPI"
                : "Không kết nối được server (Reachable=false)";
        });
    }

    // ─────────────────────────────────────────────────────────────────────
    // Stored credentials — Task 19a: list machine codes that have a saved mk_ (enumerates the DPAPI
    // creds dir via CredentialStore.ListMachineCodes), plus a "check machineCode" lookup.
    // ─────────────────────────────────────────────────────────────────────
    public ObservableCollection<string> StoredMachineCodes { get; } = new();

    [RelayCommand]
    private void RefreshCredentials()
    {
        StoredMachineCodes.Clear();
        foreach (var code in CredentialStore.ListMachineCodes())
        {
            StoredMachineCodes.Add(code);
        }
    }

    [ObservableProperty]
    private string checkMachineCode = string.Empty;

    [ObservableProperty]
    private string checkResult = string.Empty;

    [RelayCommand]
    private void CheckCredential()
    {
        if (string.IsNullOrWhiteSpace(CheckMachineCode))
        {
            CheckResult = "Nhập machine code để kiểm tra.";
            return;
        }

        var key = CredentialStore.Load(CheckMachineCode);
        CheckResult = key is null
            ? $"Không có mk_ cho \"{CheckMachineCode}\"."
            : $"Có mk_ cho \"{CheckMachineCode}\" ({key.Length} ký tự, {key[..Math.Min(6, key.Length)]}...).";
    }

    // ─────────────────────────────────────────────────────────────────────
    // "Paste mk_" fast path — same idea as OnboardingViewModel's own PasteKey, exposed here too since
    // Settings is where an operator is most likely to be fixing up a machine's credential mid-session.
    // ─────────────────────────────────────────────────────────────────────
    [ObservableProperty]
    private string pasteMachineCode = string.Empty;

    [ObservableProperty]
    private string pasteMkKey = string.Empty;

    [ObservableProperty]
    private string pasteStatus = string.Empty;

    [RelayCommand]
    private void PasteMk()
    {
        if (string.IsNullOrWhiteSpace(PasteMachineCode) || string.IsNullOrWhiteSpace(PasteMkKey))
        {
            PasteStatus = "Cần nhập cả machine code lẫn mk_ key.";
            return;
        }

        CredentialStore.Save(PasteMachineCode, PasteMkKey);
        PasteStatus = $"Đã lưu mk_ cho {PasteMachineCode}.";
        RefreshCredentials();

        // If this is the credential the live connection is currently configured to use, rebuild right
        // away rather than waiting for MachineCode to be re-typed (it hasn't changed).
        if (string.Equals(PasteMachineCode, MachineCode, StringComparison.OrdinalIgnoreCase))
        {
            RebuildLive();
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Task 20 — Kiosk / Attract / Language, wired for real. Kiosk mirrors AppShellViewModel.IsKiosk (see
    // that class's remarks for why the actual window-property flipping lives in ShellView's code-behind,
    // not here); Attract enables/disables AttractModeService directly (this ViewModel already depends on
    // it — no mirroring needed, unlike Kiosk); Language drives LocalizationService.SetLanguage.
    // ─────────────────────────────────────────────────────────────────────
    [ObservableProperty]
    private bool kiosk;

    [ObservableProperty]
    private bool attract;

    /// <summary>"vi" or "en" — bound to a ComboBox (not free-typed) in SettingsView.xaml so this can
    /// never hold a value LocalizationService.SetLanguage would silently normalize away from what the
    /// UI is showing.</summary>
    [ObservableProperty]
    private string language = LocalizationService.DefaultLanguage;

    public IReadOnlyList<string> AvailableLanguages { get; } = ["vi", "en"];

    partial void OnAttractChanged(bool value) => _attractModeService.Enabled = value;

    partial void OnLanguageChanged(string value) => LocalizationService.SetLanguage(value);
}
