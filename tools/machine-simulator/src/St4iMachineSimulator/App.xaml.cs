using System.IO;
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

    /// <summary>Startup Live server URL/machine code, before Settings (Task 19a) has changed anything.
    /// Constructing a <see cref="LiveTransport"/> never makes a network call by itself (see
    /// <c>St4iDeviceClient</c>'s constructor) — nothing here dials out until the user actually selects
    /// Live/Auto mode AND that call fires; even then, with the placeholder's empty mkKey, LiveTransport
    /// itself now catches the resulting <c>St4iConfigException</c> and reports a graceful failure rather
    /// than throwing (see LiveTransport's own remarks) — Settings' ServerUrl/VerifyTls/MachineCode
    /// fields (backed by <see cref="St4iMachineSimulator.Services.TransportCoordinator.RebuildLive"/>)
    /// are what actually make this configurable at runtime.</summary>
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

        // Task 19a — Live/Demo/Auto transport-MODE system (doc 62 §7 + this task's brief). Each of
        // Demo/Live/Auto is its own resolvable singleton (Settings rebuilds Live/Auto from user-entered
        // connection settings — see TransportCoordinator.RebuildLive — and needs the concrete types, not
        // just the ITransport seam); TransportCoordinator is the only thing that actually re-points the
        // DI ITransport (SwitchableTransport, below) at whichever one matches the current Mode.
        //
        // DEFAULT MODE IS DEMO (TransportMode.Demo passed to TransportCoordinator's ctor here, mirrored
        // by AppShellViewModel.Mode's own Demo field initializer) — the out-of-box exhibition run needs
        // no server at all and produces only clean 201/202 successes, never an error/status-0 row (the
        // bug this task fixes: the OLD default was Auto over an unconfigured Live, whose
        // St4iConfigException used to escape LiveTransport uncaught — see LiveTransport's own remarks).
        services.AddSingleton<DemoTransport>();
        services.AddSingleton(_ => LiveTransport.ForMachine(
            serverUrl: PlaceholderServerUrl,
            mkKey: string.Empty,
            machineCode: PlaceholderMachineCode,
            queuePath: null,
            verifyTls: true));
        services.AddSingleton(sp => new AutoTransport(sp.GetRequiredService<LiveTransport>(), sp.GetRequiredService<DemoTransport>()));
        services.AddSingleton(sp => new SwitchableTransport(sp.GetRequiredService<DemoTransport>()));
        // Alias so anything asking for the ITransport seam (e.g. FleetService, every MachineViewModel's
        // config-sync) resolves the same singleton SwitchableTransport instance — the one whose Inner
        // TransportCoordinator swaps on every Mode change, without any consumer needing to know that.
        services.AddSingleton<ITransport>(sp => sp.GetRequiredService<SwitchableTransport>());
        services.AddSingleton(sp => new TransportCoordinator(
            sp.GetRequiredService<SwitchableTransport>(),
            sp.GetRequiredService<DemoTransport>(),
            sp.GetRequiredService<LiveTransport>(),
            sp.GetRequiredService<AutoTransport>(),
            TransportMode.Demo));

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

        // Task 18 — Onboarding wizard. Singleton (same lifetime pattern as every other nav screen's
        // ViewModel) so the wizard's step/mk_ key/log state survives navigating away and back rather
        // than resetting. OnboardingViewModel's parameterless ctor builds its own HttpClient — never
        // actually used unless the user flips IsDemo off and clicks Register/PollApproval/Claim/Enroll,
        // same "constructing never dials out" property LiveTransport's client has (see
        // PlaceholderServerUrl's remarks above).
        services.AddSingleton<OnboardingViewModel>();
        services.AddSingleton(sp => new OnboardingView(sp.GetRequiredService<OnboardingViewModel>()));

        // Task 19a — Settings. Depends only on TransportCoordinator (NOT AppShellViewModel — see
        // TransportCoordinator's class remarks for why: AppShellViewModel needs SettingsView for its own
        // nav, so SettingsViewModel depending back on AppShellViewModel would be circular).
        services.AddSingleton(sp => new SettingsViewModel(sp.GetRequiredService<TransportCoordinator>()));
        services.AddSingleton(sp => new SettingsView(sp.GetRequiredService<SettingsViewModel>()));

        services.AddSingleton(sp => new AppShellViewModel(
            sp.GetRequiredService<EventBus>(),
            sp.GetRequiredService<FleetService>(),
            sp.GetRequiredService<DashboardView>(),
            sp.GetRequiredService<FleetViewModel>(),
            sp.GetRequiredService<ApiInspectorView>(),
            sp.GetRequiredService<OnboardingView>(),
            sp.GetRequiredService<SettingsView>(),
            sp.GetRequiredService<TransportCoordinator>()));

        services.AddTransient<ShellView>();
    }

    /// <summary>
    /// Headless smoke test for the DI graph + shell ViewModel, run when launched with <c>--selftest</c>
    /// (no window is ever created). Exercises exactly what the task brief asks for: default Mode is
    /// Demo, Mode toggles through Live/Demo/Auto, Nav is populated, Start/StopFleet run without
    /// throwing, the fleet's Demo-mode run produces ONLY clean 201/202 trace successes, switching to
    /// Auto with an unconfigured live STILL produces clean successes (AutoTransport falls back to demo
    /// — Task 19a's fix), and <see cref="ResilienceProbe"/> against a dead port reports
    /// <c>Reachable=false</c> without throwing. Throws on any unmet assertion — App.OnStartup's caller
    /// (the WPF host) surfaces that as a non-zero exit.
    /// </summary>
    private void RunSelfTest()
    {
        ProbeLiveCharts();

        var vm = Services.GetRequiredService<AppShellViewModel>();
        var eventBus = Services.GetRequiredService<EventBus>();

        // ── Task 19a: default Mode is Demo — the "bulletproof, no server needed" out-of-box state ──
        if (vm.Mode != TransportMode.Demo)
            throw new InvalidOperationException($"selftest: default Mode was {vm.Mode}, expected Demo (Task 19a default — was Auto before this task)");

        vm.Mode = TransportMode.Live;
        if (vm.Mode != TransportMode.Live)
            throw new InvalidOperationException("selftest: Mode did not change to Live");

        vm.Mode = TransportMode.Demo;
        if (vm.Mode != TransportMode.Demo)
            throw new InvalidOperationException("selftest: Mode did not change to Demo");

        vm.Mode = TransportMode.Auto;
        if (vm.Mode != TransportMode.Auto)
            throw new InvalidOperationException("selftest: Mode did not change to Auto");

        vm.Mode = TransportMode.Demo; // restore the default before the fleet run below
        if (vm.Mode != TransportMode.Demo)
            throw new InvalidOperationException("selftest: Mode did not restore to Demo");

        if (vm.Nav.Count == 0)
            throw new InvalidOperationException("selftest: Nav is empty");

        // ── Task 15: fleet -> EdgePipeline -> FleetViewModel wiring ─────────────────────────────
        // Committed fires on the pipeline's background Task and FleetViewModel/MachineViewModel
        // marshal onto the WPF Dispatcher before touching any bound property (see their
        // DispatcherHelper.RunOnUiThread calls) — but OnStartup runs BEFORE WPF's own message loop
        // (Application.Run) starts, so a plain Thread.Sleep here would leave nothing pumping the
        // dispatcher and those Invoke calls would never get to run. PumpDispatcherFor below runs a
        // short nested Dispatcher.PushFrame loop instead, which actively processes queued Invoke/
        // BeginInvoke calls for its duration — the standard WPF technique for "wait AND keep
        // dispatching" from inside a synchronous method.
        var fleetVm = Services.GetRequiredService<FleetViewModel>();
        var initialMachineCount = fleetVm.Machines.Count;
        if (initialMachineCount == 0)
            throw new InvalidOperationException("selftest: FleetViewModel.Machines was empty before StartFleet — fleet roster did not build");

        // Task 19a: capture every trace event the fleet's OWN machine codes produce from here on, so
        // the Demo-mode-clean-successes assertion below only looks at readings driven through THIS run
        // (not, e.g., a later dedicated pipeline's events sharing the same EventBus). The pipeline
        // publishes sequentially on its own single background Task (see EdgePipeline.RunAsync's
        // await-foreach loop) so a plain List add from this handler is safe with no extra locking.
        var fleetCodes = fleetVm.Machines.Select(m => m.Code).ToHashSet();
        var demoPhaseEvents = new List<ApiTraceEvent>();
        void CaptureDemoPhase(ApiTraceEvent e) { if (fleetCodes.Contains(e.MachineCode)) demoPhaseEvents.Add(e); }
        eventBus.Traced += CaptureDemoPhase;

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

        eventBus.Traced -= CaptureDemoPhase;
        AssertCleanTraceEvents(demoPhaseEvents, "default-Demo");
        Console.WriteLine($"SELFTEST demo-mode clean: {demoPhaseEvents.Count} fleet event(s) (default Mode=Demo), all clean 201/202, no error/status-0 rows");

        // ── Task 19a: switch to Auto with an UNCONFIGURED live — must STILL be clean (demo fallback) ──
        // Before this task's LiveTransport fix, this exact scenario (Auto over a live side with no mk_)
        // is what made the API Inspector show error/status-0 rows: LiveTransport let St4iConfigException
        // escape uncaught, so AutoTransport's "failed ack with Queued -> fall back to demo" logic never
        // got a chance to trigger (it never received an ack at all). Now LiveTransport converts that
        // exception into a Queued:true/Error-not-null ack itself, so AutoTransport's EXISTING fallback
        // logic kicks in automatically and every one of these events should be just as clean as the
        // Demo-mode ones above.
        var autoPhaseEvents = new List<ApiTraceEvent>();
        void CaptureAutoPhase(ApiTraceEvent e) { if (fleetCodes.Contains(e.MachineCode)) autoPhaseEvents.Add(e); }
        eventBus.Traced += CaptureAutoPhase;

        vm.Mode = TransportMode.Auto;
        if (vm.Mode != TransportMode.Auto)
            throw new InvalidOperationException("selftest: Mode did not switch to Auto for the fallback check");

        PumpDispatcherFor(TimeSpan.FromSeconds(2));
        eventBus.Traced -= CaptureAutoPhase;

        AssertCleanTraceEvents(autoPhaseEvents, "Auto (unconfigured live, demo fallback)");
        Console.WriteLine($"SELFTEST auto-fallback clean: {autoPhaseEvents.Count} fleet event(s) (Mode=Auto, unconfigured live), all clean 201/202 via demo fallback — no error/status-0 rows");

        vm.Mode = TransportMode.Demo; // restore the default for the remainder of this run
        if (vm.Mode != TransportMode.Demo)
            throw new InvalidOperationException("selftest: Mode did not restore to Demo after the Auto-fallback check");

        // ── Task 16: Machine Detail — per-class detail state + config-sync ─────────────────────
        // The fleet has been running for several seconds at this point (all 10 machines' first cycle
        // fires near-simultaneously at t=0 — see SimulatedDriver's initial _nextDueAt seeding — so
        // every DeviceClass should already have reported at least once), so this reuses that run
        // rather than starting a second one.
        RunMachineDetailSelfTest(fleetVm);

        vm.StopFleetCommand.Execute(null);
        if (vm.IsFleetRunning)
            throw new InvalidOperationException("selftest: StopFleet did not clear IsFleetRunning");

        // ── Task 17: API Inspector ──────────────────────────────────────────────────────────
        RunInspectorSelfTest();

        // ── Task 18: Onboarding wizard ──────────────────────────────────────────────────────
        RunOnboardingSelfTest();

        // ── Task 19a: ResilienceProbe against a dead port must report Reachable=false, never throw ──
        RunResilienceProbeSelfTest();

        Console.WriteLine("SELFTEST OK");
    }

    /// <summary>Shared assertion for the Task 19a Demo/Auto-fallback trace-cleanliness checks above:
    /// every captured event must be a real success (HttpStatus 201 for ProcessResult/Inspection, 202 for
    /// Telemetry — see <see cref="DemoTransport"/>'s Ack* methods) with no <see cref="ApiTraceEvent.Error"/>
    /// — never a status-0/error row.</summary>
    private static void AssertCleanTraceEvents(IReadOnlyCollection<ApiTraceEvent> events, string phaseLabel)
    {
        if (events.Count == 0)
            throw new InvalidOperationException($"selftest: no trace events captured from the fleet during the {phaseLabel} phase");

        var unclean = events.Where(e => e.Error is not null || e.Status is not (201 or 202)).ToList();
        if (unclean.Count > 0)
            throw new InvalidOperationException(
                $"selftest: {phaseLabel} fleet run expected only clean 201/202 successes, got " +
                $"[{string.Join(", ", unclean.Select(e => $"{e.MachineCode}:{e.Status}{(e.Error is null ? "" : ":" + e.Error)}"))}]");
    }

    /// <summary>
    /// Task 19a headless check for <see cref="ResilienceProbe"/>: probing a port nothing is listening on
    /// (localhost, so the refusal is immediate — no need to wait out the probe's own 5s timeout) must
    /// report <c>Reachable=false</c> rather than throwing. <see cref="ResilienceProbe.ProbeAsync"/>
    /// already has <c>ConfigureAwait(false)</c> on its own internal awaits (see its source), so blocking
    /// on it synchronously here via <c>GetAwaiter().GetResult()</c> is safe even though OnStartup runs
    /// before Application.Run has installed WPF's SynchronizationContext — there's no captured context
    /// for the continuation to deadlock waiting on.
    /// </summary>
    private static void RunResilienceProbeSelfTest()
    {
        var probe = new ResilienceProbe();
        var result = probe.ProbeAsync("http://127.0.0.1:59999", CancellationToken.None).GetAwaiter().GetResult();

        if (result.Reachable)
            throw new InvalidOperationException($"selftest: ResilienceProbe against a dead port unexpectedly reported Reachable=true (Status={result.Status})");

        Console.WriteLine($"SELFTEST resilience probe (dead port): Reachable={result.Reachable}, Status={result.Status} — no throw, as expected");
    }

    /// <summary>
    /// Task 17 headless check for the API Inspector. Deliberately does NOT reuse the fleet run above —
    /// even though that run is ALSO clean end to end now (Task 19a's default-Demo + Auto-fallback
    /// checks above prove exactly that) — but builds its own small <see cref="EdgePipeline"/> directly
    /// over a fresh <see cref="SimulatedDriver"/> and a brand-new <see cref="DemoTransport"/> (no
    /// <see cref="AutoTransport"/>/<see cref="SwitchableTransport"/> involved at all), sharing only the
    /// DI-resolved <see cref="EventBus"/> singleton the already-constructed <see cref="InspectorViewModel"/>
    /// is listening to. That isolates this check from the fleet phase's own timing/Mode state (which by
    /// this point has already been toggled through Live/Demo/Auto/Demo/Auto/Demo above) and keeps its
    /// event count/timing assertions deterministic — every event this method produces is a clean 201/202
    /// success by construction (see <see cref="DemoTransport.AckProcessResult"/>/
    /// <see cref="DemoTransport.AckInspection"/>/<see cref="DemoTransport.AckTelemetry"/>).
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
    /// Task 18 headless check for the Onboarding wizard. Runs the DEMO flow end to end (never touches
    /// the network — see <see cref="OnboardingViewModel"/>'s class remarks): Register → asserts
    /// <see cref="OnboardingStep.Pending"/>, PollApproval → asserts <see cref="OnboardingStep.Approved"/>,
    /// Claim → asserts a fabricated <c>mk_...</c> key was produced AND persisted (read back via
    /// <see cref="CredentialStore.Load"/>, not just held in the ViewModel's own property). Then
    /// exercises the two fast paths that bypass the wizard entirely: PasteKey (store+reload a
    /// hand-entered key) and LoadFleet (against a temp <c>fleet.json</c> this method writes and cleans
    /// up itself).
    /// </summary>
    private void RunOnboardingSelfTest()
    {
        var vm = Services.GetRequiredService<OnboardingViewModel>();

        vm.SerialNumber = "SIM-SELFTEST-01";
        vm.Name = "Selftest Machine";
        vm.MachineType = "SCREWDRIVE";
        vm.IsDemo = true;

        // ── Register → Pending ──────────────────────────────────────────────────────────────
        vm.RegisterCommand.Execute(null);
        if (vm.Step != OnboardingStep.Pending)
            throw new InvalidOperationException($"selftest onboarding: Step after Register was {vm.Step}, expected Pending");

        // ── PollApproval → Approved ─────────────────────────────────────────────────────────
        vm.PollApprovalCommand.Execute(null);
        if (vm.Step != OnboardingStep.Approved)
            throw new InvalidOperationException($"selftest onboarding: Step after PollApproval was {vm.Step}, expected Approved");

        // ── Claim → Claimed, mk_ key fabricated AND persisted ───────────────────────────────
        vm.ClaimCommand.Execute(null);
        if (vm.Step != OnboardingStep.Claimed)
            throw new InvalidOperationException($"selftest onboarding: Step after Claim was {vm.Step}, expected Claimed");
        if (string.IsNullOrEmpty(vm.MkKey) || !vm.MkKey.StartsWith("mk_", StringComparison.Ordinal) || vm.MkKey.Length != "mk_".Length + 48)
            throw new InvalidOperationException($"selftest onboarding: MkKey after Claim was \"{vm.MkKey}\" — expected \"mk_\" + 48 hex chars");
        if (string.IsNullOrEmpty(vm.MachineCode))
            throw new InvalidOperationException("selftest onboarding: MachineCode was empty after Claim");

        var storedKey = CredentialStore.Load(vm.MachineCode);
        if (storedKey != vm.MkKey)
            throw new InvalidOperationException($"selftest onboarding: CredentialStore.Load(\"{vm.MachineCode}\") returned \"{storedKey}\", expected \"{vm.MkKey}\" — Claim did not durably persist the credential");

        Console.WriteLine($"SELFTEST onboarding claim: MachineCode={vm.MachineCode}, MkKey={vm.MkKey[..12]}... — stored+loaded back via CredentialStore OK");

        // ── PasteKey fast path: store+reload a hand-entered key ────────────────────────────
        const string pastedCode = "SIM-SELFTEST-PASTE";
        const string pastedKey = "mk_deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdead";
        vm.PasteMachineCode = pastedCode;
        vm.PasteMkKey = pastedKey;
        vm.PasteKeyCommand.Execute(null);
        var pastedStored = CredentialStore.Load(pastedCode);
        if (pastedStored != pastedKey)
            throw new InvalidOperationException($"selftest onboarding: paste-key round trip failed — Load(\"{pastedCode}\") returned \"{pastedStored}\", expected \"{pastedKey}\"");
        if (vm.MachineCode != pastedCode || vm.MkKey != pastedKey)
            throw new InvalidOperationException("selftest onboarding: PasteKeyCommand did not update MachineCode/MkKey on the ViewModel");

        Console.WriteLine($"SELFTEST onboarding paste-key: {pastedCode} — stored+loaded back via CredentialStore OK");

        // ── LoadFleet fast path: FleetConfig.Load against a temp fleet.json ─────────────────
        var tempFleetPath = Path.Combine(Path.GetTempPath(), $"st4i-selftest-fleet-{Guid.NewGuid():N}.json");
        try
        {
            File.WriteAllText(tempFleetPath, """
            [
              { "code": "SELFTEST-01", "serialSeed": "SN-SELFTEST-01", "deviceClass": "automation", "machineType": "SCREWDRIVE", "stepType": "screw_tightening", "driverKind": "simulated", "recipeCode": "RC-SELFTEST-A", "mappingProfile": null, "cycleSeconds": 1.0 },
              { "code": "SELFTEST-02", "serialSeed": "SN-SELFTEST-02", "deviceClass": "iot", "machineType": "IOT_SENSOR", "stepType": null, "driverKind": "simulated", "recipeCode": null, "mappingProfile": null, "cycleSeconds": 0.5 }
            ]
            """);
            vm.FleetPath = tempFleetPath;
            vm.LoadFleetCommand.Execute(null);
            if (vm.LoadedMachineCount != 2)
                throw new InvalidOperationException($"selftest onboarding: LoadFleetCommand loaded {vm.LoadedMachineCount} machine(s), expected 2");
            if (vm.LoadedMachines.Count != 2)
                throw new InvalidOperationException($"selftest onboarding: LoadedMachines.Count was {vm.LoadedMachines.Count}, expected 2");

            Console.WriteLine($"SELFTEST onboarding load-fleet: {vm.LoadedMachineCount} machine(s) loaded from {tempFleetPath}");
        }
        finally
        {
            if (File.Exists(tempFleetPath)) File.Delete(tempFleetPath);
        }
    }

    /// <summary>
    /// Task 16 headless check: verifies each <see cref="DeviceClass"/>'s Machine Detail state actually
    /// populated from the fleet run <see cref="RunSelfTest"/> already did (SpcValues for an automation
    /// machine, TelemetryValues for an IoT machine, BoardPoints for an AOI machine, CycleLog for at
    /// least one machine), then exercises <see cref="MachineViewModel.SyncConfigCommand"/> end to end
    /// against the DI-resolved <see cref="ITransport"/> (by the time this runs, <see cref="RunSelfTest"/>
    /// has restored Mode to Demo — see its own Task 19a remarks — so this is a direct
    /// <see cref="DemoTransport"/> call, not an Auto fallback) and asserts it completed without faulting
    /// and actually changed <see cref="MachineViewModel.DriftState"/>.
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
