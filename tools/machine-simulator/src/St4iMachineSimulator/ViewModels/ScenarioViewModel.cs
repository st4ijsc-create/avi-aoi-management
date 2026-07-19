using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using St4iMachineSimulator.Infrastructure;
using St4iMachineSimulator.Services;

namespace St4iMachineSimulator.ViewModels;

/// <summary>One button on the Scenario screen's preset row. <see cref="TriggersHotFolderDemo"/> marks
/// the one preset that is a ONE-SHOT action (write+ingest a doc-28 file) rather than a persistent
/// <see cref="ScenarioConfig"/> to hold — see <see cref="ScenarioViewModel.ApplyPresetAsync"/>.</summary>
public sealed record ScenarioPreset(string Name, string Description, ScenarioConfig Config, bool TriggersHotFolderDemo = false);

/// <summary>
/// Task 19b — the Scenario control screen's ViewModel (doc 62 §5.10 "Scenario"): three sliders
/// (CycleRate/DefectRate/FaultRate) plus a NetworkOutage toggle that apply LIVE to the running fleet as
/// soon as they change (this is the one screen in the app where a slider drag has an immediate, visible
/// effect on the exhibit — see the OnXChanged hooks below), a one-shot Burst action, 5 named presets
/// (normal / high-defect / sensor-drift / network-outage / hot-folder-AOI), and a status line describing
/// what's active right now.
///
/// Mirrors <see cref="FleetService.Scenario"/> back onto its own sliders via
/// <see cref="FleetService.ScenarioChanged"/> — same "single source of truth + echo" pattern
/// <c>AppShellViewModel</c>/<c>SettingsViewModel</c> already use for <c>TransportCoordinator.Mode</c> —
/// required so <see cref="FleetService.Burst"/>'s automatic revert (fired from a background timer, not
/// this screen) visibly snaps CycleRate back down on its own.
/// </summary>
public sealed partial class ScenarioViewModel : ObservableObject
{
    private const string CustomPresetName = "Tùy chỉnh";

    private readonly FleetService _fleetService;

    /// <summary>Set while <see cref="LoadFrom"/> is assigning the slider properties from a preset or an
    /// echoed <see cref="FleetService.ScenarioChanged"/> value, so the OnXChanged hooks below don't
    /// re-call <see cref="ApplyLiveIfNotSuppressed"/> for each of the 4 properties it sets (which would
    /// both re-apply redundantly and stomp <see cref="ActivePresetName"/> back to "Tùy chỉnh").</summary>
    private bool _suppressLiveApply;

    public ScenarioViewModel(FleetService fleetService)
    {
        _fleetService = fleetService ?? throw new ArgumentNullException(nameof(fleetService));
        _fleetService.ScenarioChanged += OnFleetScenarioChanged;

        Presets = new ObservableCollection<ScenarioPreset>(BuildPresets());

        // Reflect whatever FleetService already has — Normal unless a preset/slider was already
        // applied before this screen was ever opened (Scenario state survives independent of
        // navigation and of Start/Stop — see FleetService.Scenario's own remarks).
        LoadFrom(_fleetService.Scenario, presetName: "Ca bình thường");
        RefreshStatusLine();
    }

    [ObservableProperty]
    private double cycleRate = 1.0;

    [ObservableProperty]
    private double defectRate;

    [ObservableProperty]
    private double faultRate;

    [ObservableProperty]
    private bool networkOutage;

    [ObservableProperty]
    private string activePresetName = "Ca bình thường";

    [ObservableProperty]
    private string statusLine = string.Empty;

    /// <summary>Result of the last "Hot-folder AOI" preset run (empty until it's been clicked once this
    /// session) — surfaced separately from <see cref="StatusLine"/> since it describes a one-shot event,
    /// not the currently-active scenario.</summary>
    [ObservableProperty]
    private string hotFolderStatus = string.Empty;

    public ObservableCollection<ScenarioPreset> Presets { get; }

    partial void OnCycleRateChanged(double value) => ApplyLiveIfNotSuppressed();

    partial void OnDefectRateChanged(double value) => ApplyLiveIfNotSuppressed();

    partial void OnFaultRateChanged(double value) => ApplyLiveIfNotSuppressed();

    partial void OnNetworkOutageChanged(bool value) => ApplyLiveIfNotSuppressed();

    /// <summary>
    /// Task 19b — the one place that turns a slider/checkbox EDIT into a live
    /// <see cref="FleetService.ApplyScenario"/> call: a manual edit no longer matches whichever preset
    /// (if any) was last applied, so it also relabels <see cref="ActivePresetName"/> to "Tùy chỉnh"
    /// ("Custom") rather than leaving a stale preset name displayed next to values that no longer match
    /// it.
    /// </summary>
    private void ApplyLiveIfNotSuppressed()
    {
        if (_suppressLiveApply) return;

        ActivePresetName = CustomPresetName;
        _fleetService.ApplyScenario(CurrentConfig());
        RefreshStatusLine();
    }

    private ScenarioConfig CurrentConfig() => new(CycleRate, DefectRate, FaultRate, NetworkOutage);

    /// <summary>
    /// A preset button: sets all 4 sliders/checkbox from <see cref="ScenarioPreset.Config"/> in one
    /// batch (suppressing the live-apply hooks above so this makes exactly ONE
    /// <see cref="FleetService.ApplyScenario"/> call, not up to 4), then — for the one preset that marks
    /// <see cref="ScenarioPreset.TriggersHotFolderDemo"/> — runs the doc-28 write+ingest demo and
    /// surfaces its result in <see cref="HotFolderStatus"/>.
    /// </summary>
    [RelayCommand]
    private async Task ApplyPresetAsync(ScenarioPreset? preset)
    {
        if (preset is null) return;

        LoadFrom(preset.Config, preset.Name);
        _fleetService.ApplyScenario(preset.Config);
        RefreshStatusLine();

        if (!preset.TriggersHotFolderDemo) return;

        HotFolderStatus = "Đang ghi doc28 + chờ HotFolderAoiDriver đọc lại...";
        try
        {
            HotFolderStatus = await _fleetService.RunHotFolderAoiDemoAsync(CancellationToken.None).ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            HotFolderStatus = $"Lỗi hot-folder demo: {ex.Message}";
        }
    }

    /// <summary>"Burst" button — fire-and-forget, see <see cref="FleetService.Burst"/>'s own remarks for
    /// why this command itself does nothing more than kick it off; the eventual auto-revert echoes back
    /// through <see cref="OnFleetScenarioChanged"/> like any other scenario change.</summary>
    [RelayCommand]
    private void Burst() => _fleetService.Burst();

    private void LoadFrom(ScenarioConfig config, string? presetName = null)
    {
        _suppressLiveApply = true;
        try
        {
            CycleRate = config.CycleRateMultiplier;
            DefectRate = config.ExtraDefectRate;
            FaultRate = config.FaultRate;
            NetworkOutage = config.NetworkOutage;
        }
        finally
        {
            _suppressLiveApply = false;
        }

        if (presetName is not null) ActivePresetName = presetName;
    }

    /// <summary><see cref="FleetService.ScenarioChanged"/> handler — fires on the UI thread for this
    /// screen's own preset/slider commands, but on FleetService's background burst-revert
    /// <see cref="Task.Delay"/> continuation for an AUTOMATIC Burst reversion; marshal defensively
    /// either way, same rule <c>AppShellViewModel.HandleFallbackChanged</c> already follows for
    /// <c>TransportCoordinator.FallbackChanged</c>.</summary>
    private void OnFleetScenarioChanged(ScenarioConfig config) => DispatcherHelper.RunOnUiThread(() =>
    {
        // A manual local edit already relabeled ActivePresetName to "Tùy chỉnh" itself (see
        // ApplyLiveIfNotSuppressed) before this echo arrives — LoadFrom without a presetName leaves
        // whatever label is already showing untouched, so this doesn't fight that.
        LoadFrom(config);
        RefreshStatusLine();
    });

    private void RefreshStatusLine()
    {
        var outageText = NetworkOutage ? "MẤT MẠNG (ack sẽ queued/lỗi)" : "mạng bình thường";
        StatusLine = $"{ActivePresetName} — CycleRate={CycleRate:0.00}x, Defect={DefectRate:P0}, Fault={FaultRate:P0}, {outageText}.";
    }

    private static IReadOnlyList<ScenarioPreset> BuildPresets() =>
    [
        new("Ca bình thường",
            "Tốc độ/tỷ lệ lỗi mặc định của dây chuyền — trạng thái nền cho mọi demo khác.",
            ScenarioConfig.Normal),

        new("Lô lỗi cao",
            "Tăng mạnh tỷ lệ lỗi tiêm thêm (bất kể vật lý mô phỏng riêng của từng máy) để trình diễn andon/alert.",
            new ScenarioConfig(CycleRateMultiplier: 1.0, ExtraDefectRate: 0.35, FaultRate: 0.05, NetworkOutage: false)),

        new("Sensor drift",
            "Tăng tốc chu kỳ để lộ sự kiện trôi hiệu chuẩn định kỳ có sẵn của IOT_SENSOR (mỗi 200 cycle) trong thời gian demo ngắn.",
            new ScenarioConfig(CycleRateMultiplier: 5.0, ExtraDefectRate: 0.03, FaultRate: 0.05, NetworkOutage: false)),

        new("Mất mạng demo",
            "Chuyển transport đang chạy sang store-and-forward lỗi cao (~90%) — API Inspector sẽ hiện các dòng queued/lỗi trong khi fleet vẫn chạy bình thường.",
            new ScenarioConfig(CycleRateMultiplier: 1.0, ExtraDefectRate: 0.0, FaultRate: 0.0, NetworkOutage: true)),

        new("Hot-folder AOI",
            "Ghi một file doc28 mẫu (Doc28Writer) vào thư mục theo dõi rồi để HotFolderAoiDriver đọc lại thật — chứng minh closed-loop doc28.",
            ScenarioConfig.Normal, TriggersHotFolderDemo: true),
    ];
}
