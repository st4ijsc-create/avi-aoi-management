using System.Windows;
using System.Windows.Threading;
using LiveChartsCore;
using LiveChartsCore.SkiaSharpView;
using LiveChartsCore.SkiaSharpView.WPF;
using Microsoft.Extensions.DependencyInjection;
using St4i.EdgeCore.Drivers;
using St4i.EdgeCore.Engine;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Mapping;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4iMachineSimulator.Services;
using St4iMachineSimulator.ViewModels;
using St4iMachineSimulator.Views;

namespace St4iMachineSimulator;

/// <summary>
/// DI composition root (Task 14). Builds a small <see cref="ServiceProvider"/> wiring EdgeCore's
/// <see cref="EventBus"/> and transports into the shell's <see cref="AppShellViewModel"/>, then shows
/// <see cref="ShellView"/> — unless launched with <c>--selftest</c>, in which case it exercises the
/// resolved ViewModel headlessly and exits before any window is created (see <see cref="RunSelfTest"/>).
/// </summary>
public partial class App : Application
{
    private const string SelfTestArg = "--selftest";

    /// <summary>Placeholder Live server URL. Constructing a <see cref="LiveTransport"/> never makes a
    /// network call by itself (see <c>St4iDeviceClient</c>'s constructor) — nothing here dials out
    /// until the user actually selects Live/Auto mode with a real, reachable server, which Task 19
    /// (Settings) will make configurable. Until then this only needs to be a syntactically valid URL so
    /// the DI graph resolves.</summary>
    private const string PlaceholderServerUrl = "http://localhost:5000";
    private const string PlaceholderMachineCode = "SIM-EDGE-00";

    public IServiceProvider Services { get; private set; } = null!;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        var services = new ServiceCollection();
        ConfigureServices(services);
        Services = services.BuildServiceProvider();

        if (e.Args.Contains(SelfTestArg, StringComparer.OrdinalIgnoreCase))
        {
            RunSelfTest();
            Shutdown(0);
            return;
        }

        var shell = Services.GetRequiredService<ShellView>();
        shell.Show();
    }

    private static void ConfigureServices(IServiceCollection services)
    {
        services.AddSingleton<EventBus>();

        // Live-first, Demo-fallback transport (doc 62 §7). LiveTransport wraps the reference SDK
        // client; DemoTransport is the offline fabricator used both as the live-fallback target and
        // (later, via the Mode combo) as a directly-selectable transport in its own right.
        services.AddSingleton(_ =>
        {
            var live = LiveTransport.ForMachine(
                serverUrl: PlaceholderServerUrl,
                mkKey: string.Empty,
                machineCode: PlaceholderMachineCode,
                queuePath: null,
                verifyTls: true);
            var demo = new DemoTransport();
            return new AutoTransport(live, demo);
        });
        // Alias so anything asking for the ITransport seam (e.g. FleetService) resolves the same
        // singleton AutoTransport instance, without every consumer having to depend on the concrete
        // type.
        services.AddSingleton<ITransport>(sp => sp.GetRequiredService<AutoTransport>());

        // Task 15 — fleet/dashboard. FleetService owns the pipeline; FleetViewModel/DashboardView are
        // singletons too so Start Fleet (top bar) and the Dashboard nav item are always looking at the
        // same live state, however the shell got constructed.
        services.AddSingleton(sp => new FleetService(sp.GetRequiredService<ITransport>(), sp.GetRequiredService<EventBus>()));
        services.AddSingleton(sp => new FleetViewModel(sp.GetRequiredService<FleetService>()));
        services.AddSingleton(sp => new DashboardView(sp.GetRequiredService<FleetViewModel>()));

        // Task 17 — API Inspector. Singleton (like DashboardView/FleetViewModel above) so the trace
        // history survives navigating away and back, rather than resubscribing to EventBus.Traced
        // (and losing everything captured so far) on every nav click.
        services.AddSingleton(sp => new InspectorViewModel(sp.GetRequiredService<EventBus>()));
        services.AddSingleton(sp => new ApiInspectorView(sp.GetRequiredService<InspectorViewModel>()));

        services.AddSingleton(sp =>
        {
            var vm = new AppShellViewModel(
                sp.GetRequiredService<EventBus>(),
                sp.GetRequiredService<FleetService>(),
                sp.GetRequiredService<DashboardView>(),
                sp.GetRequiredService<FleetViewModel>(),
                sp.GetRequiredService<ApiInspectorView>());
            var auto = sp.GetRequiredService<AutoTransport>();
            // Background-thread event -> UI-thread property write; AppShellViewModel.HandleFallbackChanged
            // does the dispatcher marshaling itself so this subscription is safe from any thread.
            auto.FallbackChanged += vm.HandleFallbackChanged;
            return vm;
        });

        services.AddTransient<ShellView>();
    }

    /// <summary>
    /// Headless smoke test for the DI graph + shell ViewModel, run when launched with <c>--selftest</c>
    /// (no window is ever created). Exercises exactly what the task brief asks for: Mode toggles
    /// through Live/Demo/Auto, Nav is populated, and Start/StopFleet run without throwing. Throws on
    /// any unmet assertion — App.OnStartup's caller (the WPF host) surfaces that as a non-zero exit.
    /// </summary>
    private void RunSelfTest()
    {
        ProbeLiveCharts();

        var vm = Services.GetRequiredService<AppShellViewModel>();

        vm.Mode = TransportMode.Live;
        if (vm.Mode != TransportMode.Live)
            throw new InvalidOperationException("selftest: Mode did not change to Live");

        vm.Mode = TransportMode.Demo;
        if (vm.Mode != TransportMode.Demo)
            throw new InvalidOperationException("selftest: Mode did not change to Demo");

        vm.Mode = TransportMode.Auto;
        if (vm.Mode != TransportMode.Auto)
            throw new InvalidOperationException("selftest: Mode did not change to Auto");

        if (vm.Nav.Count == 0)
            throw new InvalidOperationException("selftest: Nav is empty");

        // ── Task 15: fleet -> EdgePipeline -> FleetViewModel wiring ─────────────────────────────
        // Committed fires on the pipeline's background Task and FleetViewModel/MachineViewModel
        // marshal onto the WPF Dispatcher before touching any bound property (see their RunOnUiThread
        // helpers) — but OnStartup runs BEFORE WPF's own message loop (Application.Run) starts, so a
        // plain Thread.Sleep here would leave nothing pumping the dispatcher and those Invoke calls
        // would never get to run. PumpDispatcherFor below runs a short nested Dispatcher.PushFrame
        // loop instead, which actively processes queued Invoke/BeginInvoke calls for its duration —
        // the standard WPF technique for "wait AND keep dispatching" from inside a synchronous method.
        var fleetVm = Services.GetRequiredService<FleetViewModel>();
        var initialMachineCount = fleetVm.Machines.Count;
        if (initialMachineCount == 0)
            throw new InvalidOperationException("selftest: FleetViewModel.Machines was empty before StartFleet — fleet roster did not build");

        vm.StartFleetCommand.Execute(null);
        if (!vm.IsFleetRunning)
            throw new InvalidOperationException("selftest: StartFleet did not set IsFleetRunning");

        // Split the wait into two pumps (still 3s total) so we can snapshot FpyKpi.SubText's "X/Y
        // judged" count twice and prove it's still advancing at t=3s — regression check for the
        // post-review fix: OnFpyChanged (a CommunityToolkit.Mvvm value-change hook) stops firing
        // during an all-Pass/all-Warn streak because n/n is the bit-exact same double every cycle, so
        // relying on it alone froze this subtext even as the underlying judged count kept climbing.
        PumpDispatcherFor(TimeSpan.FromSeconds(1));
        var judgedAt1s = ParseJudgedCount(fleetVm.FpyKpi.SubText)
            ?? throw new InvalidOperationException($"selftest: FpyKpi.SubText had no parseable \"X/Y judged\" count after 1s (was \"{fleetVm.FpyKpi.SubText}\")");

        PumpDispatcherFor(TimeSpan.FromSeconds(2));
        var judgedAt3s = ParseJudgedCount(fleetVm.FpyKpi.SubText)
            ?? throw new InvalidOperationException($"selftest: FpyKpi.SubText had no parseable \"X/Y judged\" count after 3s (was \"{fleetVm.FpyKpi.SubText}\")");

        if (judgedAt3s <= judgedAt1s)
            throw new InvalidOperationException(
                $"selftest: FpyKpi.SubText's judged count did not advance between t=1s ({judgedAt1s}) and t=3s ({judgedAt3s}) — " +
                "looks frozen (the FPY-subtext-freeze-on-pass-streak bug)");
        if (judgedAt3s > fleetVm.TotalCycles)
            throw new InvalidOperationException($"selftest: FpyKpi.SubText's judged count ({judgedAt3s}) exceeds TotalCycles ({fleetVm.TotalCycles})");

        var reportingMachines = fleetVm.Machines.Count(m => m.Cycles > 0);
        if (reportingMachines == 0)
            throw new InvalidOperationException("selftest: no MachineViewModel tile's Cycles incremented after running the fleet for 3s");
        if (fleetVm.TotalCycles <= reportingMachines)
            throw new InvalidOperationException($"selftest: FleetViewModel.TotalCycles ({fleetVm.TotalCycles}) did not grow beyond the fleet's initial round-robin burst ({reportingMachines}) — pipeline does not appear to be running repeated cycles");

        Console.WriteLine(
            $"SELFTEST fleet: {reportingMachines}/{fleetVm.Machines.Count} machine tiles reported >=1 cycle, " +
            $"TotalCycles={fleetVm.TotalCycles}, OnlineCount={fleetVm.OnlineCount}, Fpy={fleetVm.Fpy:P1}, " +
            $"FpyKpi.SubText judged count {judgedAt1s}(t=1s) -> {judgedAt3s}(t=3s) [\"{fleetVm.FpyKpi.SubText}\"]");

        // ── Task 16: Machine Detail — per-class detail state + config-sync ─────────────────────
        // The fleet has been running for 3s at this point (all 10 machines' first cycle fires
        // near-simultaneously at t=0 — see SimulatedDriver's initial _nextDueAt seeding — so every
        // DeviceClass should already have reported at least once), so this reuses that run rather
        // than starting a second one.
        RunMachineDetailSelfTest(fleetVm);

        vm.StopFleetCommand.Execute(null);
        if (vm.IsFleetRunning)
            throw new InvalidOperationException("selftest: StopFleet did not clear IsFleetRunning");

        // ── Task 17: API Inspector ──────────────────────────────────────────────────────────
        RunInspectorSelfTest();

        Console.WriteLine("SELFTEST OK");
    }

    /// <summary>
    /// Task 17 headless check for the API Inspector. Deliberately does NOT reuse the fleet run above
    /// (which drives readings through <see cref="AutoTransport"/> over an unconfigured
    /// <see cref="LiveTransport"/> — see this task's brief note: early sends before the live→demo
    /// fallback trips can show error/status-0 rows) — instead builds its own small
    /// <see cref="EdgePipeline"/> directly over a fresh <see cref="SimulatedDriver"/> and a brand-new
    /// <see cref="DemoTransport"/> (no <see cref="AutoTransport"/> involved at all), sharing only the
    /// DI-resolved <see cref="EventBus"/> singleton the already-constructed <see cref="InspectorViewModel"/>
    /// is listening to. That guarantees every event this method produces is a clean 201/202 success (see
    /// <see cref="DemoTransport.AckProcessResult"/>/<see cref="DemoTransport.AckInspection"/>/
    /// <see cref="DemoTransport.AckTelemetry"/>), which is what makes the assertions below deterministic
    /// rather than dependent on the earlier fleet phase's AutoTransport fallback timing.
    /// </summary>
    private void RunInspectorSelfTest()
    {
        const int MinCapturedEvents = 10;

        var eventBus = Services.GetRequiredService<EventBus>();
        // Forces construction (and EventBus.Traced subscription) right now if nothing else has
        // resolved it yet — InspectorViewModel is a DI singleton, built lazily on first resolution.
        var inspectorVm = Services.GetRequiredService<InspectorViewModel>();

        // Distinct MachineType per machine (Screwdrive->ProcessResult->201, AOI->Inspection->201,
        // IotSensor->Telemetry->202 — see Drivers/Simulators' NewReading(cycle, ReadingKind.*, ...)
        // calls) so the 201-vs-202 status split used by the filter check below is real, not contrived.
        // "INSPECT-" prefixed codes so this batch is trivially distinguishable from the fleet's own
        // "SCRW-01"-style roster, even though both share the same EventBus.
        MachineDescriptor[] descriptors =
        [
            new("INSPECT-SCRW", "SN-ISCRW", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening", DriverKind.Simulated, "RC-ISCRW", null, 0.12),
            new("INSPECT-AOI", "SN-IAOI", DeviceClass.AoiAvi, "AOI", "inspection", DriverKind.Simulated, "RC-IAOI", null, 0.15),
            new("INSPECT-IOT", "SN-IIOT", DeviceClass.Iot, "IOT_SENSOR", "telemetry", DriverKind.Simulated, null, null, 0.10),
        ];
        var sims = descriptors.Select((d, i) => FleetService.BuildSimulator(d, seed: 5000 + i)).ToList();
        var driver = new SimulatedDriver(sims);
        var profile = new MappingProfile { Name = "inspector-selftest", DeviceClass = "Mixed" };
        var demoTransport = new DemoTransport(latencyMs: 5); // direct — no AutoTransport/live in this path
        var pipeline = new EdgePipeline(driver, profile, demoTransport, eventBus);

        var cts = new CancellationTokenSource();
        _ = Task.Run(async () =>
        {
            try { await pipeline.RunAsync(cts.Token).ConfigureAwait(false); }
            catch (OperationCanceledException) { /* expected once cts.Cancel() below fires */ }
        });

        // ── capture + "real 201/202 successes" ──────────────────────────────────────────────
        PumpDispatcherFor(TimeSpan.FromSeconds(2));

        var ourCodes = descriptors.Select(d => d.Code).ToHashSet();
        var ourEvents = inspectorVm.Events.Where(e => ourCodes.Contains(e.MachineCode)).ToList();
        if (ourEvents.Count < MinCapturedEvents)
            throw new InvalidOperationException($"selftest inspector: only captured {ourEvents.Count} event(s) from the dedicated selftest pipeline in 2s (wanted >= {MinCapturedEvents})");
        var unclean = ourEvents.Where(e => e.Error is not null || e.Status is not (201 or 202)).ToList();
        if (unclean.Count > 0)
            throw new InvalidOperationException($"selftest inspector: expected only clean 201/202 successes, got [{string.Join(", ", unclean.Select(e => $"{e.MachineCode}:{e.Status}{(e.Error is null ? "" : ":" + e.Error)}"))}]");
        if (!ourEvents.Any(e => e.Status == 202))
            throw new InvalidOperationException("selftest inspector: no 202 (Telemetry) event captured — cannot verify the status-filter narrowing below is non-trivial");

        Console.WriteLine($"SELFTEST inspector capture: {ourEvents.Count} event(s) from the dedicated pipeline, InspectorViewModel.Events.Count={inspectorVm.Events.Count}");

        // ── a status filter narrows the list, and ShownCount tracks the FILTERED count ──────────
        // Regression check for a demo-visible bug: the header's "N shown" counter used to bind
        // straight to Events.Count, so it kept reading the full unfiltered ring size (e.g. "96 shown")
        // even while the grid itself was narrowed to 20 rows by the status filter below. ShownCount is
        // now recomputed off FilteredEvents itself (see InspectorViewModel's constructor), so it must
        // track FilteredEvents' count exactly, both with no filter active and after one narrows it.
        var totalBeforeFilter = inspectorVm.FilteredEvents.Cast<object>().Count();
        if (totalBeforeFilter != inspectorVm.Events.Count)
            throw new InvalidOperationException($"selftest inspector: with no filter active, FilteredEvents ({totalBeforeFilter}) should equal Events.Count ({inspectorVm.Events.Count})");
        if (inspectorVm.ShownCount != inspectorVm.Events.Count)
            throw new InvalidOperationException($"selftest inspector: with no filter active, ShownCount ({inspectorVm.ShownCount}) should equal Events.Count ({inspectorVm.Events.Count})");

        inspectorVm.FilterStatus = "202"; // Telemetry-only — see the ourEvents.Any(202) check above
        var filteredCount = inspectorVm.FilteredEvents.Cast<object>().Count();
        if (filteredCount == 0)
            throw new InvalidOperationException("selftest inspector: status filter \"202\" matched 0 rows");
        if (filteredCount >= totalBeforeFilter)
            throw new InvalidOperationException($"selftest inspector: status filter did not narrow the list ({filteredCount} filtered vs {totalBeforeFilter} unfiltered)");
        if (inspectorVm.ShownCount != filteredCount)
            throw new InvalidOperationException($"selftest inspector: ShownCount ({inspectorVm.ShownCount}) did not track the filtered count ({filteredCount}) after applying the status filter — this is exactly the \"N shown\" header bug this pass fixed");
        Console.WriteLine($"SELFTEST inspector filter: status=\"202\" narrowed {totalBeforeFilter} -> {filteredCount} row(s), ShownCount={inspectorVm.ShownCount}");

        inspectorVm.FilterStatus = InspectorViewModel.AllOption;
        if (inspectorVm.ShownCount != inspectorVm.Events.Count)
            throw new InvalidOperationException($"selftest inspector: after clearing the filter, ShownCount ({inspectorVm.ShownCount}) should equal Events.Count ({inspectorVm.Events.Count}) again");

        // ── Pause stops new rows from being added ────────────────────────────────────────────
        inspectorVm.PauseResumeCommand.Execute(null);
        if (!inspectorVm.IsPaused)
            throw new InvalidOperationException("selftest inspector: PauseResumeCommand did not set IsPaused");
        var countAtPause = inspectorVm.Events.Count;
        PumpDispatcherFor(TimeSpan.FromSeconds(1)); // pipeline (still running) keeps publishing throughout
        if (inspectorVm.Events.Count != countAtPause)
            throw new InvalidOperationException($"selftest inspector: Events grew while IsPaused=true ({countAtPause} -> {inspectorVm.Events.Count})");
        Console.WriteLine($"SELFTEST inspector pause: Events.Count held at {countAtPause} for 1s while paused");
        inspectorVm.PauseResumeCommand.Execute(null);
        if (inspectorVm.IsPaused)
            throw new InvalidOperationException("selftest inspector: PauseResumeCommand did not clear IsPaused");

        cts.Cancel();
    }

    /// <summary>
    /// Task 16 headless check: verifies each <see cref="DeviceClass"/>'s Machine Detail state actually
    /// populated from the fleet run <see cref="RunSelfTest"/> already did (SpcValues for an automation
    /// machine, TelemetryValues for an IoT machine, BoardPoints for an AOI machine, CycleLog for at
    /// least one machine), then exercises <see cref="MachineViewModel.SyncConfigCommand"/> end to end
    /// against the DI-resolved <see cref="ITransport"/> (Auto → falls back to <see cref="DemoTransport"/>
    /// with no live server reachable, same as the rest of this build) and asserts it completed without
    /// faulting and actually changed <see cref="MachineViewModel.DriftState"/>.
    /// </summary>
    private static void RunMachineDetailSelfTest(FleetViewModel fleetVm)
    {
        var automationMachine = fleetVm.Machines.FirstOrDefault(m => m.Class == DeviceClass.Automation && m.Cycles > 0)
            ?? throw new InvalidOperationException("selftest: no Automation machine tile reported a cycle — cannot verify SpcSeries/SpcValues");
        if (automationMachine.SpcValues.Count == 0)
            throw new InvalidOperationException($"selftest: {automationMachine.Code}'s SpcValues is empty after {automationMachine.Cycles} cycles — SPC series did not populate");
        if (automationMachine.SpcSeries.Length != 4)
            throw new InvalidOperationException($"selftest: {automationMachine.Code}'s SpcSeries did not have the expected 4 series (value/mean/UCL/LCL), had {automationMachine.SpcSeries.Length}");

        var iotMachine = fleetVm.Machines.FirstOrDefault(m => m.Class == DeviceClass.Iot && m.Cycles > 0)
            ?? throw new InvalidOperationException("selftest: no Iot machine tile reported a cycle — cannot verify TelemetrySeries/TelemetryValues");
        if (iotMachine.TelemetryValues.Count == 0)
            throw new InvalidOperationException($"selftest: {iotMachine.Code}'s TelemetryValues is empty after {iotMachine.Cycles} cycles — telemetry series did not populate");

        var aoiMachine = fleetVm.Machines.FirstOrDefault(m => m.Class == DeviceClass.AoiAvi && m.Cycles > 0)
            ?? throw new InvalidOperationException("selftest: no AOI machine tile reported a cycle — cannot verify BoardPoints");
        if (aoiMachine.BoardPoints.Count == 0)
            throw new InvalidOperationException($"selftest: {aoiMachine.Code}'s BoardPoints is empty after {aoiMachine.Cycles} cycles — board points did not populate");

        var cycleLoggedMachine = fleetVm.Machines.FirstOrDefault(m => m.CycleLog.Count > 0)
            ?? throw new InvalidOperationException("selftest: no MachineViewModel's CycleLog grew — cycle log did not populate");

        Console.WriteLine(
            $"SELFTEST detail state: SPC[{automationMachine.Code}]={automationMachine.SpcValues.Count}pt(s), " +
            $"Telemetry[{iotMachine.Code}]={iotMachine.TelemetryValues.Count}pt(s), " +
            $"BoardPoints[{aoiMachine.Code}]={aoiMachine.BoardPoints.Count}pt(s), " +
            $"CycleLog[{cycleLoggedMachine.Code}]={cycleLoggedMachine.CycleLog.Count} row(s)");

        // SyncConfig: fire-and-forget by design (AsyncRelayCommand.Execute doesn't await), so pump the
        // dispatcher briefly afterward and then poll IsRunning/ExecutionTask rather than blocking
        // synchronously on the command's own task — this runs from OnStartup, before Application.Run()
        // has installed WPF's DispatcherSynchronizationContext, so a raw .GetAwaiter().GetResult() here
        // would risk deadlocking on whatever SynchronizationContext DemoTransport's internal await
        // happens to capture; polling after a pump is safe regardless of which context (if any) is
        // active.
        var syncTarget = automationMachine;
        var driftStateBeforeSync = syncTarget.DriftState;
        syncTarget.SyncConfigCommand.Execute(null);
        PumpDispatcherFor(TimeSpan.FromMilliseconds(500));

        if (syncTarget.SyncConfigCommand.IsRunning)
            throw new InvalidOperationException($"selftest: {syncTarget.Code}'s SyncConfigCommand was still running 500ms after Execute — DemoTransport.SyncConfigAsync did not complete in time");
        if (syncTarget.SyncConfigCommand.ExecutionTask is { IsFaulted: true } faultedTask)
            throw new InvalidOperationException($"selftest: {syncTarget.Code}'s SyncConfigCommand faulted: {faultedTask.Exception}");
        if (string.IsNullOrEmpty(syncTarget.DriftState) || syncTarget.DriftState == driftStateBeforeSync)
            throw new InvalidOperationException($"selftest: {syncTarget.Code}'s DriftState did not change after SyncConfig ran (was \"{driftStateBeforeSync}\", still \"{syncTarget.DriftState}\")");

        Console.WriteLine($"SELFTEST config-sync: {syncTarget.Code} DriftState=\"{syncTarget.DriftState}\" (was \"{driftStateBeforeSync}\")");
    }

    /// <summary>
    /// Runs a short nested Dispatcher message loop (<see cref="Dispatcher.PushFrame"/>) for
    /// <paramref name="duration"/>, on whatever thread calls this. Unlike <see cref="Thread.Sleep"/>,
    /// this actively pumps the calling thread's Dispatcher queue while waiting — required in
    /// <see cref="RunSelfTest"/> because <see cref="OnStartup"/> runs before WPF's own top-level
    /// message loop (<c>Application.Run</c>) has started, so background-thread
    /// <c>Dispatcher.Invoke</c> calls (fired here by the fleet pipeline's <c>Committed</c> handlers)
    /// would otherwise never get processed.
    /// </summary>
    private static void PumpDispatcherFor(TimeSpan duration)
    {
        var frame = new DispatcherFrame();
        var timer = new DispatcherTimer(DispatcherPriority.Background) { Interval = duration };
        timer.Tick += (_, _) =>
        {
            timer.Stop();
            frame.Continue = false;
        };
        timer.Start();
        Dispatcher.PushFrame(frame);
    }

    /// <summary>Parses the judged count ("Y" in FleetViewModel.FpyKpi's "X/Y judged" SubText) back
    /// out for the regression check in <see cref="RunSelfTest"/>. Returns null for "no data yet" (no
    /// judged readings committed yet) or anything unparseable.</summary>
    private static long? ParseJudgedCount(string? subText)
    {
        if (string.IsNullOrEmpty(subText)) return null;
        var slash = subText.IndexOf('/');
        if (slash < 0) return null;
        var space = subText.IndexOf(' ', slash + 1);
        if (space < 0) return null;
        return long.TryParse(subText.AsSpan(slash + 1, space - slash - 1), out var judged) ? judged : null;
    }

    /// <summary>
    /// Task 15 de-risk step, run BEFORE anything else in <see cref="RunSelfTest"/>: the project
    /// references <c>LiveChartsCore.SkiaSharpView.WPF 2.0.0-rc5.4</c> (prerelease; its transitive
    /// deps OpenTK/OpenTK.GLWpfControl/SkiaSharp.Views.WPF restore under NU1701 as
    /// .NETFramework-only, per Task 1's note) and had never been runtime-verified. This constructs
    /// the exact shapes the Task 15 dashboard needs — an <see cref="ISeries"/> array holding a
    /// <see cref="LineSeries{TModel}"/> and a real <see cref="CartesianChart"/> WPF control — so any
    /// TypeLoadException/FileNotFoundException/MissingMethodException from the NU1701-flagged
    /// dependencies surfaces here, headlessly, instead of only when a user opens the Dashboard.
    /// Deliberately does NOT catch: letting it throw is what makes a real failure visible as a
    /// non-zero --selftest exit rather than a silently-swallowed warning.
    /// </summary>
    private static void ProbeLiveCharts()
    {
        Console.WriteLine("LiveCharts probe: constructing ISeries<LineSeries<double>>...");
        ISeries[] series = { new LineSeries<double> { Values = new double[] { 1, 2, 3, 2, 4 } } };
        if (series.Length != 1)
            throw new InvalidOperationException("selftest: LiveCharts ISeries array did not construct as expected");

        Console.WriteLine("LiveCharts probe: constructing CartesianChart WPF control...");
        var chart = new CartesianChart { Series = series };
        if (chart.Series != series)
            throw new InvalidOperationException("selftest: CartesianChart.Series did not round-trip");

        Console.WriteLine("LiveCharts probe OK — CartesianChart + LineSeries<double> constructed without error.");
    }
}
