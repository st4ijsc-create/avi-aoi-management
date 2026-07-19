using System.Collections.ObjectModel;
using System.ComponentModel;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Data;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Win32;
using St4i.EdgeCore.Infrastructure;

namespace St4iMachineSimulator.ViewModels;

/// <summary>
/// Task 17 — the API Inspector's ViewModel (doc 62 §5.10 "API Inspector", the exhibition
/// centerpiece): a live, filterable, pausable stream of every <see cref="ApiTraceEvent"/> the running
/// fleet's <see cref="EdgePipeline"/>s publish through the shared <see cref="EventBus"/>. Subscribes
/// once, at construction, and lives for the whole app session (registered as a DI singleton, same as
/// <c>AppShellViewModel</c>/<c>FleetViewModel</c>) — reopening the nav item just re-shows the same
/// running list rather than losing history.
/// </summary>
public sealed partial class InspectorViewModel : ObservableObject
{
    /// <summary>Ring cap — matches <see cref="EventBus.DefaultCapacity"/> so this screen can show the
    /// EventBus's ENTIRE backlog (see <see cref="EventBus.Recent"/>) without immediately trimming it
    /// on construction, while still bounding memory over a long exhibition run exactly like the
    /// EventBus itself already does.</summary>
    private const int MaxEvents = EventBus.DefaultCapacity;

    /// <summary>Sentinel selected by default in every filter combo — "don't filter on this dimension".
    /// Always present in <see cref="MachineOptions"/>/<see cref="KindOptions"/>/<see cref="StatusOptions"/>,
    /// even right after <see cref="Clear"/> empties the event list.</summary>
    public const string AllOption = "(All)";

    private readonly EventBus _eventBus;

    public InspectorViewModel(EventBus eventBus)
    {
        _eventBus = eventBus ?? throw new ArgumentNullException(nameof(eventBus));

        FilteredEvents = CollectionViewSource.GetDefaultView(Events);
        FilteredEvents.Filter = FilterPredicate;
        // Recomputes ShownCount off the view's OWN CollectionChanged rather than hooking every place
        // that can change what's visible (Events add/remove/Clear, FilteredEvents.Refresh() from a
        // filter-property setter) individually — all of those already surface here for free, because
        // ICollectionView raises Add/Remove when an item enters/leaves the filtered set and Reset on
        // Refresh()/source Clear(). (Fix for a demo-visible bug: the header counter used to bind
        // directly to Events.Count, which never reflected an active filter.)
        FilteredEvents.CollectionChanged += (_, _) => RecomputeShownCount();

        // Late-subscriber catch-up: show whatever the EventBus already buffered (e.g. the fleet was
        // started before the user ever opened this nav item) rather than starting from a blank list.
        // EventBus.Recent returns oldest-first/newest-last; add oldest-first too so the final
        // newest-first insert order below (AddInternal always Inserts at index 0) ends up correct.
        foreach (var e in _eventBus.Recent(MaxEvents))
        {
            AddInternal(e);
        }

        _eventBus.Traced += OnTraced;
    }

    /// <summary>Newest-first, capped at <see cref="MaxEvents"/>. UI-thread-affine — every mutation
    /// (here, and in <see cref="AddInternal"/>/<see cref="Clear"/>) happens on the dispatcher thread,
    /// same rule as every other ViewModel in this app (see <c>MachineViewModel.RunOnUiThread</c>
    /// remarks) — <see cref="EventBus.Traced"/> itself fires on whatever background pipeline thread
    /// produced the reading.</summary>
    public ObservableCollection<ApiTraceEvent> Events { get; } = new();

    /// <summary>The DataGrid's real ItemsSource: <see cref="Events"/> filtered by
    /// <see cref="FilterMachine"/>/<see cref="FilterKind"/>/<see cref="FilterStatus"/>. A view over
    /// <see cref="Events"/> rather than a second materialized collection, so it stays in sync with adds/
    /// Clear for free and Refresh() is the only thing a filter change needs to trigger.</summary>
    public ICollectionView FilteredEvents { get; }

    /// <summary>Distinct <see cref="ApiTraceEvent.MachineCode"/> values observed so far, plus
    /// <see cref="AllOption"/> — what the "Machine" filter ComboBox binds its ItemsSource to.</summary>
    public ObservableCollection<string> MachineOptions { get; } = new() { AllOption };

    /// <summary>Distinct <see cref="ApiTraceEvent.Kind"/> values observed so far (as strings), plus
    /// <see cref="AllOption"/>.</summary>
    public ObservableCollection<string> KindOptions { get; } = new() { AllOption };

    /// <summary>Distinct status buckets (see <see cref="StatusBucket"/>) observed so far, plus
    /// <see cref="AllOption"/>.</summary>
    public ObservableCollection<string> StatusOptions { get; } = new() { AllOption };

    [ObservableProperty]
    private string filterMachine = AllOption;

    [ObservableProperty]
    private string filterKind = AllOption;

    [ObservableProperty]
    private string filterStatus = AllOption;

    /// <summary>While true, <see cref="OnTraced"/> drops incoming events instead of adding them — the
    /// "Pause" affordance. Checked ON the UI thread inside the already-marshaled add (not
    /// check-then-marshal from the background thread) so a Pause click racing an in-flight publish
    /// can't sneak one extra row in after the button visibly says "Paused".</summary>
    [ObservableProperty]
    private bool isPaused;

    /// <summary>Cumulative count of every event this ViewModel has ever added (including the initial
    /// EventBus.Recent backlog and anything since evicted by the <see cref="MaxEvents"/> ring cap) —
    /// the "live counter" the view's header shows. Reset by <see cref="Clear"/>, unlike <see cref="Events"/>'s
    /// own Count which is separately capped and also reset by Clear.</summary>
    [ObservableProperty]
    private long totalEventCount;

    /// <summary>Result of the last <see cref="ExportAsync"/> run — "" (hidden) until the first export
    /// attempt, then either a success or failure summary.</summary>
    [ObservableProperty]
    private string exportStatus = string.Empty;

    /// <summary>Row count of <see cref="FilteredEvents"/> RIGHT NOW — i.e. what the grid is actually
    /// showing, not <see cref="Events"/>'s unfiltered total. The header's "N shown" counter binds to
    /// this (see <c>ApiInspectorView.xaml</c>) — previously it bound straight to <c>Events.Count</c>,
    /// which stayed at the full ring size even while a filter was narrowing the grid (e.g. "96 shown"
    /// with the grid displaying 20 filtered rows). Kept up to date by <see cref="RecomputeShownCount"/>,
    /// which only runs when <see cref="FilteredEvents"/> itself actually changes (see the constructor's
    /// <c>CollectionChanged</c> subscription) — O(n) on that change, not on every render.</summary>
    [ObservableProperty]
    private int shownCount;

    [RelayCommand]
    private void Clear()
    {
        Events.Clear();
        TotalEventCount = 0;

        MachineOptions.Clear();
        MachineOptions.Add(AllOption);
        KindOptions.Clear();
        KindOptions.Add(AllOption);
        StatusOptions.Clear();
        StatusOptions.Add(AllOption);

        FilterMachine = AllOption;
        FilterKind = AllOption;
        FilterStatus = AllOption;
    }

    [RelayCommand]
    private void PauseResume() => IsPaused = !IsPaused;

    /// <summary>
    /// "Export" button: prompts for a destination via <see cref="SaveFileDialog"/> (must run on the UI
    /// thread — WPF dialogs are UI-thread-affine) then serializes a snapshot of <see cref="Events"/> to
    /// JSON on a background <see cref="Task"/>, so exporting the full 500-row buffer never blocks the
    /// UI/dispatcher. The snapshot (<c>Events.ToArray()</c>) is taken on the UI thread, before handing
    /// off to <see cref="Task.Run"/>, since <see cref="Events"/> itself is not thread-safe to enumerate
    /// concurrently with a dispatcher-thread mutation.
    /// </summary>
    [RelayCommand]
    private async Task ExportAsync()
    {
        var dialog = new SaveFileDialog
        {
            Filter = "JSON files (*.json)|*.json|All files (*.*)|*.*",
            FileName = $"api-trace-{DateTime.Now:yyyyMMdd-HHmmss}.json",
        };
        if (dialog.ShowDialog() != true) return;

        var snapshot = Events.ToArray();
        var path = dialog.FileName;
        try
        {
            await Task.Run(() =>
            {
                var json = JsonSerializer.Serialize(snapshot, new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(path, json);
            });
            ExportStatus = $"Exported {snapshot.Length} event(s) to {Path.GetFileName(path)}";
        }
        catch (Exception ex)
        {
            ExportStatus = $"Export failed: {ex.Message}";
        }
    }

    /// <summary><see cref="EventBus.Traced"/> handler — fires on whatever background thread published
    /// the event (a pipeline's <see cref="EdgePipeline"/> loop, never the UI thread). Marshals to the
    /// UI thread before touching <see cref="Events"/>, per the shell's threading rule (see
    /// <c>MachineViewModel.RunOnUiThread</c> remarks) — a direct off-thread <c>ObservableCollection</c>
    /// add here would be a bug (WPF collections raise CollectionChanged synchronously, and bound
    /// controls require that to happen on the dispatcher thread).</summary>
    private void OnTraced(ApiTraceEvent e) => RunOnUiThread(() =>
    {
        if (IsPaused) return;
        AddInternal(e);
    });

    private void AddInternal(ApiTraceEvent e)
    {
        Events.Insert(0, e);
        while (Events.Count > MaxEvents) Events.RemoveAt(Events.Count - 1);
        TotalEventCount++;

        AddOptionIfMissing(MachineOptions, e.MachineCode);
        AddOptionIfMissing(KindOptions, e.Kind.ToString());
        AddOptionIfMissing(StatusOptions, StatusBucket(e));
    }

    private static void AddOptionIfMissing(ObservableCollection<string> options, string value)
    {
        if (!string.IsNullOrEmpty(value) && !options.Contains(value)) options.Add(value);
    }

    /// <summary>Recomputes <see cref="ShownCount"/> from <see cref="FilteredEvents"/>'s current
    /// contents. Only ever called from the <c>FilteredEvents.CollectionChanged</c> subscription set up
    /// in the constructor — never per-render.</summary>
    private void RecomputeShownCount() => ShownCount = FilteredEvents.Cast<object>().Count();

    partial void OnFilterMachineChanged(string value) => FilteredEvents.Refresh();

    partial void OnFilterKindChanged(string value) => FilteredEvents.Refresh();

    partial void OnFilterStatusChanged(string value) => FilteredEvents.Refresh();

    private bool FilterPredicate(object obj)
    {
        if (obj is not ApiTraceEvent e) return false;

        if (FilterMachine != AllOption && !string.Equals(e.MachineCode, FilterMachine, StringComparison.OrdinalIgnoreCase))
            return false;
        if (FilterKind != AllOption && !string.Equals(e.Kind.ToString(), FilterKind, StringComparison.OrdinalIgnoreCase))
            return false;
        if (FilterStatus != AllOption && !string.Equals(StatusBucket(e), FilterStatus, StringComparison.OrdinalIgnoreCase))
            return false;

        return true;
    }

    /// <summary>Status filter bucket: exact HTTP status code (so e.g. a 201 ProcessResult/Inspection ack
    /// and a 202 Telemetry ack — see <c>DemoTransport.AckProcessResult</c>/<c>AckInspection</c>/
    /// <c>AckTelemetry</c> — land in different, individually selectable buckets), except a non-null/
    /// empty <see cref="ApiTraceEvent.Error"/> which wins regardless of HTTP status (mirrors
    /// <c>MachineViewModel.BuildSummary</c>'s ack:ERR priority) and HttpStatus 0 with no error, which is
    /// the store-and-forward "queued, no round-trip yet" case (see <c>DemoTransport.SendAsync</c>).
    /// Row COLORING (<c>Converters/ApiTraceRowBrushConverter</c>) intentionally uses its own coarser
    /// 2xx/4xx+/queued/error grouping rather than this exact-code bucket — a color swatch per distinct
    /// status code would be unreadable, but the filter combo benefits from the extra precision.</summary>
    internal static string StatusBucket(ApiTraceEvent e)
    {
        if (!string.IsNullOrEmpty(e.Error)) return "Error";
        if (e.Status == 0) return "Queued/0";
        return e.Status.ToString(System.Globalization.CultureInfo.InvariantCulture);
    }

    /// <summary>Same dispatcher-marshaling pattern as <c>MachineViewModel.RunOnUiThread</c>/
    /// <c>FleetViewModel.RunOnUiThread</c>: inline if already on the UI thread, dispatched otherwise,
    /// inline if there is no <see cref="Application.Current"/> yet.</summary>
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
