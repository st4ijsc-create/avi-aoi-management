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

        // Task 20 — merges the default-language (vi) Strings dictionary. Must run before
        // ConfigureServices/BuildServiceProvider below: every ViewModel that builds Nav/Kpi text off
        // LocalizationService.GetString (AppShellViewModel, FleetViewModel) is constructed lazily off
        // the service provider built from that point on, so the dictionary needs to already be merged
        // by the time the first one resolves — including in the --selftest path.
        LocalizationService.Initialize();

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
        //
        // Task 19b — FleetService now takes the CONCRETE SwitchableTransport (not just the ITransport
        // seam) plus TransportCoordinator, so its ApplyScenario can swap the transport for the "Mất
        // mạng demo" preset and restore the current Mode's real transport afterward (see FleetService's
        // own remarks) — SwitchableTransport still implements ITransport, so every existing consumer of
        // FleetService.Transport is unaffected.
        services.AddSingleton(sp => new FleetService(
            sp.GetRequiredService<SwitchableTransport>(),
            sp.GetRequiredService<TransportCoordinator>(),
            sp.GetRequiredService<EventBus>()));
        services.AddSingleton(sp => new FleetViewModel(sp.GetRequiredService<FleetService>()));
        services.AddSingleton(sp => new DashboardView(sp.GetRequiredService<FleetViewModel>()));

        // Task 17 — API Inspector. Singleton (like DashboardView/FleetViewModel above) so the trace
        // history survives navigating away and back, rather than resubscribing to EventBus.Traced
        // (and losing everything captured so far) on every nav click.
        services.AddSingleton(sp => new InspectorViewModel(sp.GetRequiredService<EventBus>()));
        services.AddSingleton(sp => new ApiInspectorView(sp.GetRequiredService<InspectorViewModel>()));

        // Task 20 — attract mode. Depends only on FleetViewModel/DashboardView/ApiInspectorView (NOT
        // AppShellViewModel — that would be circular, since AppShellViewModel needs to react to this
        // service's tour advances; see AttractModeService's own class remarks) so it can be constructed
        // before AppShellViewModel/SettingsViewModel below, both of which depend on it.
        services.AddSingleton(sp => new AttractModeService(
            sp.GetRequiredService<FleetViewModel>(),
            sp.GetRequiredService<DashboardView>(),
            sp.GetRequiredService<ApiInspectorView>()));

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
        // nav, so SettingsViewModel depending back on AppShellViewModel would be circular). Task 20 adds
        // AttractModeService — same non-circular shape (AttractModeService doesn't depend on Settings).
        services.AddSingleton(sp => new SettingsViewModel(
            sp.GetRequiredService<TransportCoordinator>(),
            sp.GetRequiredService<AttractModeService>()));
        services.AddSingleton(sp => new SettingsView(sp.GetRequiredService<SettingsViewModel>()));

        // Task 19b — Scenario control. Singleton (same lifetime pattern as every other nav screen's
        // ViewModel) so slider/preset state — and the FleetService.ScenarioChanged subscription that
        // mirrors Burst's automatic revert back onto the sliders — survives navigating away and back.
        services.AddSingleton(sp => new ScenarioViewModel(sp.GetRequiredService<FleetService>()));
        services.AddSingleton(sp => new ScenarioView(sp.GetRequiredService<ScenarioViewModel>()));

        services.AddSingleton(sp => new AppShellViewModel(
            sp.GetRequiredService<EventBus>(),
            sp.GetRequiredService<FleetService>(),
            sp.GetRequiredService<DashboardView>(),
            sp.GetRequiredService<FleetViewModel>(),
            sp.GetRequiredService<ApiInspectorView>(),
            sp.GetRequiredService<OnboardingView>(),
            sp.GetRequiredService<SettingsView>(),
            sp.GetRequiredService<ScenarioView>(),
            sp.GetRequiredService<TransportCoordinator>(),
            sp.GetRequiredService<SettingsViewModel>(),
            sp.GetRequiredService<AttractModeService>()));

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

        // ── Task 19b: Scenario control — defect injection / network outage / burst ─────────────
        // Same "reuse the already-running fleet" reasoning as the Machine Detail check above.
        RunScenarioSelfTest();

        vm.StopFleetCommand.Execute(null);
        if (vm.IsFleetRunning)
            throw new InvalidOperationException("selftest: StopFleet did not clear IsFleetRunning");

        // ── Task 17: API Inspector ──────────────────────────────────────────────────────────
        RunInspectorSelfTest();

        // ── Task 18: Onboarding wizard ──────────────────────────────────────────────────────
        RunOnboardingSelfTest();

        // ── Task 19a: ResilienceProbe against a dead port must report Reachable=false, never throw ──
        RunResilienceProbeSelfTest();

        // ── Task 20: attract mode / i18n / branding assets ──────────────────────────────────
        RunAttractModeSelfTest();
        RunLocalizationSelfTest();
        RunBrandingSelfTest();

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
    /// Task 20 headless check for <see cref="AttractModeService"/>: proves the tour actually advances
    /// <see cref="AppShellViewModel.CurrentView"/> and that simulated input exits it — WITHOUT waiting
    /// out the real 45s idle / 10s tour <see cref="System.Windows.Threading.DispatcherTimer"/>s (see
    /// <see cref="AttractModeService.Tick"/>'s own remarks on why it's public specifically for this).
    /// Runs after the fleet has been started at least once earlier in <see cref="RunSelfTest"/>, so
    /// <c>FleetViewModel.Machines</c> has real entries and the tour's machine-detail stop is buildable —
    /// but reuses no running state itself (Tick/AdvanceTour/NotifyActivity are synchronous, so no
    /// dispatcher pumping is needed the way the fleet/scenario checks above require).
    /// </summary>
    private void RunAttractModeSelfTest()
    {
        var vm = Services.GetRequiredService<AppShellViewModel>();
        var attract = Services.GetRequiredService<AttractModeService>();

        // Known starting point so "CurrentView changed" below is meaningful.
        vm.CurrentView = Services.GetRequiredService<DashboardView>();
        attract.Enabled = true;

        if (attract.IsActive)
            throw new InvalidOperationException("selftest attract: IsActive was already true before any Tick() — unexpected leftover state");

        var viewBeforeTick = vm.CurrentView;
        attract.Tick(); // simulated idle-timeout — the real DispatcherTimer would take 45s to fire this

        if (!attract.IsActive)
            throw new InvalidOperationException("selftest attract: IsActive was still false after a simulated idle Tick()");
        if (ReferenceEquals(vm.CurrentView, viewBeforeTick))
            throw new InvalidOperationException("selftest attract: CurrentView did not change across the simulated idle Tick()");

        Console.WriteLine($"SELFTEST attract tick: CurrentView changed ({viewBeforeTick?.GetType().Name} -> {vm.CurrentView?.GetType().Name}) after a simulated idle Tick(), IsActive={attract.IsActive}");

        var viewAfterTick = vm.CurrentView;
        attract.AdvanceTour(); // a second, explicit tour advance — proves the tour actually cycles, not just a one-shot jump
        if (ReferenceEquals(vm.CurrentView, viewAfterTick))
            throw new InvalidOperationException("selftest attract: CurrentView did not change on a second AdvanceTour() call");

        Console.WriteLine($"SELFTEST attract advance: CurrentView changed again ({viewAfterTick?.GetType().Name} -> {vm.CurrentView?.GetType().Name})");

        // Simulated visitor input must exit attract mode immediately.
        attract.NotifyActivity();
        if (attract.IsActive)
            throw new InvalidOperationException("selftest attract: IsActive was still true after NotifyActivity() (simulated input)");
        if (vm.CurrentView != Services.GetRequiredService<DashboardView>())
            throw new InvalidOperationException("selftest attract: CurrentView did not return to Dashboard after NotifyActivity() exited attract mode");

        Console.WriteLine("SELFTEST attract exit: NotifyActivity() (simulated input) exited attract mode (IsActive=false) and returned CurrentView to Dashboard");

        attract.Enabled = false; // restore the default (off) for the remainder of this run
    }

    /// <summary>
    /// Task 20 headless check for vi/en localization: proves <see cref="LocalizationService.SetLanguage"/>
    /// actually swaps which Str_* resources resolve (checked both via <see cref="LocalizationService.GetString"/>
    /// and directly off <c>Application.Current.Resources</c>, per the task brief), and that
    /// <see cref="SettingsViewModel.Language"/> is wired straight through to it.
    /// </summary>
    private void RunLocalizationSelfTest()
    {
        const string ProbeKey = "Str_Kpi_Online";
        const string ViExpected = "ĐANG HOẠT ĐỘNG";
        const string EnExpected = "ONLINE";

        // vi is the default — App.OnStartup already called LocalizationService.Initialize() before any
        // DI resolution happened, so this should already be true without any SetLanguage call here.
        if (LocalizationService.CurrentLanguage != "vi")
            throw new InvalidOperationException($"selftest i18n: default language was \"{LocalizationService.CurrentLanguage}\", expected \"vi\"");
        var viLabel = LocalizationService.GetString(ProbeKey);
        if (viLabel != ViExpected)
            throw new InvalidOperationException($"selftest i18n: {ProbeKey} under the default vi was \"{viLabel}\", expected \"{ViExpected}\"");

        LocalizationService.SetLanguage("en");
        if (LocalizationService.CurrentLanguage != "en")
            throw new InvalidOperationException($"selftest i18n: CurrentLanguage after SetLanguage(\"en\") was \"{LocalizationService.CurrentLanguage}\"");
        var enLabel = LocalizationService.GetString(ProbeKey);
        if (enLabel != EnExpected)
            throw new InvalidOperationException($"selftest i18n: {ProbeKey} under en (via GetString) was \"{enLabel}\", expected \"{EnExpected}\"");
        // Directly off Application.Current.Resources / the merged dictionary lookup too — not just the
        // GetString helper — proving the merged-dictionary swap itself, per the task brief.
        var enViaResources = Application.Current!.Resources[ProbeKey] as string;
        if (enViaResources != EnExpected)
            throw new InvalidOperationException($"selftest i18n: Application.Current.Resources[\"{ProbeKey}\"] under en was \"{enViaResources}\", expected \"{EnExpected}\"");

        LocalizationService.SetLanguage("vi");
        if (LocalizationService.CurrentLanguage != "vi")
            throw new InvalidOperationException("selftest i18n: SetLanguage(\"vi\") did not restore CurrentLanguage to \"vi\"");
        var viLabelAgain = LocalizationService.GetString(ProbeKey);
        if (viLabelAgain != ViExpected)
            throw new InvalidOperationException($"selftest i18n: {ProbeKey} after switching back to vi was \"{viLabelAgain}\", expected \"{ViExpected}\"");

        Console.WriteLine($"SELFTEST i18n round-trip: {ProbeKey} vi=\"{viLabel}\" -> en=\"{enLabel}\" (GetString + Application.Current.Resources agree) -> vi=\"{viLabelAgain}\"");

        // ── SettingsViewModel.Language -> LocalizationService.SetLanguage wiring ────────────────
        var settingsVm = Services.GetRequiredService<SettingsViewModel>();
        if (settingsVm.Language != "vi")
            throw new InvalidOperationException($"selftest i18n: SettingsViewModel.Language default was \"{settingsVm.Language}\", expected \"vi\"");

        settingsVm.Language = "en";
        if (LocalizationService.CurrentLanguage != "en")
            throw new InvalidOperationException("selftest i18n: setting SettingsViewModel.Language=\"en\" did not switch LocalizationService.CurrentLanguage");
        if (LocalizationService.GetString(ProbeKey) != EnExpected)
            throw new InvalidOperationException($"selftest i18n: {ProbeKey} was not \"{EnExpected}\" after SettingsViewModel.Language=\"en\"");

        settingsVm.Language = "vi";
        if (LocalizationService.CurrentLanguage != "vi")
            throw new InvalidOperationException("selftest i18n: setting SettingsViewModel.Language=\"vi\" did not restore LocalizationService.CurrentLanguage");

        Console.WriteLine("SELFTEST i18n Settings wiring: SettingsViewModel.Language=\"en\"/\"vi\" round-tripped LocalizationService.CurrentLanguage correctly");
    }

    /// <summary>
    /// Task 20 headless check for branding: the logo/icon asset FILES exist on disk under the project's
    /// <c>Assets/</c> folder, and the csproj actually sets <c>&lt;ApplicationIcon&gt;</c> to the icon.
    /// Locates the project directory by walking UP from <see cref="AppContext.BaseDirectory"/> (the
    /// build output dir) looking for the .csproj, rather than assuming a fixed relative depth — robust
    /// to both plain `dotnet build`/`dotnet run` output layouts and however deep the RID-specific
    /// (win-x64) output folder nesting goes.
    /// </summary>
    private static void RunBrandingSelfTest()
    {
        var projectDir = FindProjectDirectory();
        var logoPath = Path.Combine(projectDir, "Assets", "logo.png");
        var iconPath = Path.Combine(projectDir, "Assets", "icon.ico");
        var csprojPath = Path.Combine(projectDir, "St4iMachineSimulator.csproj");

        if (!File.Exists(logoPath))
            throw new InvalidOperationException($"selftest branding: logo.png not found at \"{logoPath}\"");
        if (!File.Exists(iconPath))
            throw new InvalidOperationException($"selftest branding: icon.ico not found at \"{iconPath}\"");

        var logoBytes = new FileInfo(logoPath).Length;
        var iconBytes = new FileInfo(iconPath).Length;
        if (logoBytes == 0) throw new InvalidOperationException("selftest branding: logo.png exists but is 0 bytes");
        if (iconBytes == 0) throw new InvalidOperationException("selftest branding: icon.ico exists but is 0 bytes");

        if (!File.Exists(csprojPath))
            throw new InvalidOperationException($"selftest branding: csproj not found at \"{csprojPath}\"");
        var csprojText = File.ReadAllText(csprojPath);
        if (!csprojText.Contains("<ApplicationIcon>Assets\\icon.ico</ApplicationIcon>", StringComparison.Ordinal))
            throw new InvalidOperationException("selftest branding: csproj does not set <ApplicationIcon>Assets\\icon.ico</ApplicationIcon>");

        Console.WriteLine($"SELFTEST branding: logo.png ({logoBytes} bytes) + icon.ico ({iconBytes} bytes) present under \"{Path.Combine(projectDir, "Assets")}\", csproj ApplicationIcon set");
    }

    /// <summary>Walks up from <paramref name="startDir"/> (defaults to <see cref="AppContext.BaseDirectory"/>)
    /// looking for the directory containing <c>St4iMachineSimulator.csproj</c>.</summary>
    private static string FindProjectDirectory(string? startDir = null)
    {
        var dir = new DirectoryInfo(startDir ?? AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "St4iMachineSimulator.csproj"))) return dir.FullName;
            dir = dir.Parent;
        }

        throw new InvalidOperationException($"selftest branding: could not locate St4iMachineSimulator.csproj by walking up from \"{startDir ?? AppContext.BaseDirectory}\"");
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
    /// Task 19b headless check for the Scenario control screen: exercises the SAME
    /// <see cref="ScenarioViewModel"/>/<see cref="FleetService"/> the "Scenario" nav screen binds to,
    /// against the fleet <see cref="RunSelfTest"/> already has running (never starts a second one) —
    /// <list type="bullet">
    /// <item>"Lô lỗi cao" (High-defect lot) must raise the observed Fail rate in committed readings
    /// MATERIALLY above the "Ca bình thường" baseline (doc 19b brief's first assertion).</item>
    /// <item>"Mất mạng demo" (Network outage) must make acks come back queued/failed while the fleet
    /// keeps running (doesn't crash/stop) — and turning it back off (re-applying "Ca bình thường") must
    /// restore clean acks (the brief's reversibility requirement).</item>
    /// <item><see cref="FleetService.Burst"/> must raise throughput (readings/sec) materially above a
    /// same-length baseline window.</item>
    /// </list>
    /// </summary>
    private void RunScenarioSelfTest()
    {
        var fleetService = Services.GetRequiredService<FleetService>();
        var scenarioVm = Services.GetRequiredService<ScenarioViewModel>();

        if (!fleetService.IsRunning)
            throw new InvalidOperationException("selftest scenario: fleet was not running at the start of the Scenario checks");

        // ── baseline "Ca bình thường" fail rate ─────────────────────────────────────────────
        // Nothing before this method ever calls ApplyScenario, so Scenario should still be
        // ScenarioConfig.Normal here — assert that rather than assuming it (a false assumption would
        // make the "materially higher" comparison below meaningless).
        if (fleetService.Scenario != ScenarioConfig.Normal)
            throw new InvalidOperationException($"selftest scenario: expected Scenario to still be Normal before any preset is applied, was {fleetService.Scenario}");

        var (normalFail, normalTotal) = MeasureFailRate(fleetService, TimeSpan.FromSeconds(2.5));
        if (normalTotal == 0)
            throw new InvalidOperationException("selftest scenario: captured 0 judged (non-Telemetry) readings during the Normal baseline window");
        var normalRate = (double)normalFail / normalTotal;

        // ── "Lô lỗi cao" (High-defect lot) preset ───────────────────────────────────────────
        var highDefectPreset = scenarioVm.Presets.FirstOrDefault(p => p.Name == "Lô lỗi cao")
            ?? throw new InvalidOperationException("selftest scenario: \"Lô lỗi cao\" preset not found in ScenarioViewModel.Presets");
        scenarioVm.ApplyPresetCommand.Execute(highDefectPreset);
        if (fleetService.Scenario != highDefectPreset.Config)
            throw new InvalidOperationException("selftest scenario: FleetService.Scenario did not update after applying the \"Lô lỗi cao\" preset");

        var (highFail, highTotal) = MeasureFailRate(fleetService, TimeSpan.FromSeconds(2.5));
        if (highTotal == 0)
            throw new InvalidOperationException("selftest scenario: captured 0 judged readings during the \"Lô lỗi cao\" window");
        var highRate = (double)highFail / highTotal;

        const double MinMaterialRateIncrease = 0.15; // 15 percentage points — see ScenarioAwareDriver's remarks for the expected ~35-40pp jump this preset actually produces
        if (highRate <= normalRate + MinMaterialRateIncrease)
            throw new InvalidOperationException(
                $"selftest scenario: \"Lô lỗi cao\" fail rate ({highRate:P1}, {highFail}/{highTotal}) was not materially higher than Normal's " +
                $"({normalRate:P1}, {normalFail}/{normalTotal}) — expected at least +{MinMaterialRateIncrease:P0}");

        Console.WriteLine($"SELFTEST scenario defect: Normal fail rate {normalRate:P1} ({normalFail}/{normalTotal}) -> \"Lô lỗi cao\" {highRate:P1} ({highFail}/{highTotal})");

        // ── "Mất mạng demo" (Network outage) preset ─────────────────────────────────────────
        var outagePreset = scenarioVm.Presets.FirstOrDefault(p => p.Name == "Mất mạng demo")
            ?? throw new InvalidOperationException("selftest scenario: \"Mất mạng demo\" preset not found in ScenarioViewModel.Presets");
        scenarioVm.ApplyPresetCommand.Execute(outagePreset);
        if (!fleetService.Scenario.NetworkOutage)
            throw new InvalidOperationException("selftest scenario: NetworkOutage was not applied after the \"Mất mạng demo\" preset");

        var outageAcks = MeasureAcks(fleetService, TimeSpan.FromSeconds(2));
        if (!fleetService.IsRunning)
            throw new InvalidOperationException("selftest scenario: fleet stopped running during the network-outage window — it must keep running through an outage");
        if (outageAcks.Count == 0)
            throw new InvalidOperationException("selftest scenario: captured 0 acks during the network-outage window");

        var queuedOrFailed = outageAcks.Count(a => !a.Success || a.Queued);
        if (queuedOrFailed == 0)
            throw new InvalidOperationException($"selftest scenario: expected at least one queued/failed ack during the network-outage window, got {outageAcks.Count} all-clean ack(s)");

        Console.WriteLine($"SELFTEST scenario outage: {queuedOrFailed}/{outageAcks.Count} ack(s) queued/failed while fleet kept running (IsRunning={fleetService.IsRunning})");

        // ── restore "Ca bình thường" — NetworkOutage must clear and acks must go clean again ──────
        var normalPreset = scenarioVm.Presets.First(p => p.Name == "Ca bình thường");
        scenarioVm.ApplyPresetCommand.Execute(normalPreset);
        if (fleetService.Scenario.NetworkOutage)
            throw new InvalidOperationException("selftest scenario: NetworkOutage did not clear after re-applying the \"Ca bình thường\" preset");

        var restoredAcks = MeasureAcks(fleetService, TimeSpan.FromSeconds(1.5));
        if (restoredAcks.Count == 0)
            throw new InvalidOperationException("selftest scenario: captured 0 acks after restoring the Normal preset");
        if (restoredAcks.All(a => !a.Success || a.Queued))
            throw new InvalidOperationException("selftest scenario: acks were STILL all queued/failed after restoring the Normal preset — NetworkOutage did not actually restore the real transport");

        Console.WriteLine($"SELFTEST scenario outage-restore: {restoredAcks.Count(a => a.Success && !a.Queued)}/{restoredAcks.Count} ack(s) clean again after restoring \"Ca bình thường\"");

        // ── Restart race (fix-pass regression check): a CycleRateMultiplier-changing preset restarts
        // the running pipeline exactly once — capture Committed events spanning that restart and assert
        // no machine's CycleCounter sequence shows MORE than the ONE legitimate "reset to 1" a restart
        // is supposed to produce (StartLocked always rebuilds fresh sims — see its own remarks). Before
        // the fix, the OUTGOING pipeline's Committed handler stayed wired after Stop(), so a straggling
        // old-generation reading could arrive interleaved with the new generation's — visible here as a
        // SECOND decrease in a machine's cycle-counter sequence within this one restart's window.
        var perMachineCycles = new Dictionary<string, List<long>>();
        void CaptureCycles(DeviceReading r, TransportAck a)
        {
            if (!perMachineCycles.TryGetValue(r.MachineCode, out var list))
            {
                list = new List<long>();
                perMachineCycles[r.MachineCode] = list;
            }

            list.Add(r.CycleCounter);
        }

        fleetService.Committed += CaptureCycles;
        PumpDispatcherFor(TimeSpan.FromMilliseconds(500)); // a little pre-restart baseline, still at 1.0x

        var sensorDriftPreset = scenarioVm.Presets.FirstOrDefault(p => p.Name == "Sensor drift")
            ?? throw new InvalidOperationException("selftest scenario: \"Sensor drift\" preset not found in ScenarioViewModel.Presets");
        scenarioVm.ApplyPresetCommand.Execute(sensorDriftPreset); // exactly one restart: CycleRateMultiplier 1.0 -> 5.0
        if (Math.Abs(fleetService.Scenario.CycleRateMultiplier - sensorDriftPreset.Config.CycleRateMultiplier) > 1e-6)
            throw new InvalidOperationException($"selftest scenario: \"Sensor drift\" did not apply CycleRateMultiplier (was {fleetService.Scenario.CycleRateMultiplier})");

        PumpDispatcherFor(TimeSpan.FromSeconds(1.5)); // let the new (faster) pipeline run for a bit
        fleetService.Committed -= CaptureCycles;

        if (perMachineCycles.Count == 0)
            throw new InvalidOperationException("selftest scenario: captured 0 readings across the Sensor-drift restart window");

        foreach (var (machineCode, cycles) in perMachineCycles)
        {
            var decreases = 0;
            for (var i = 1; i < cycles.Count; i++)
            {
                if (cycles[i] < cycles[i - 1]) decreases++;
            }

            if (decreases > 1)
                throw new InvalidOperationException(
                    $"selftest scenario: {machineCode} showed {decreases} cycle-counter decrease(s) across the Sensor-drift restart window " +
                    $"(sequence: [{string.Join(",", cycles)}]) — expected at most 1 (the restart's own legitimate reset to 1); more than 1 means a " +
                    "straggling old-generation reading interleaved with the new generation (the restart-race bug this fix pass closes)");
        }

        Console.WriteLine($"SELFTEST scenario restart-race: {perMachineCycles.Count} machine(s) captured across the Sensor-drift restart, each with at most 1 cycle-counter reset (no old/new pipeline overlap)");

        scenarioVm.ApplyPresetCommand.Execute(normalPreset);
        if (Math.Abs(fleetService.Scenario.CycleRateMultiplier - 1.0) > 1e-6)
            throw new InvalidOperationException($"selftest scenario: CycleRateMultiplier did not restore to 1.0x after re-applying \"Ca bình thường\" post Sensor-drift (was {fleetService.Scenario.CycleRateMultiplier})");

        // ── Burst throughput ─────────────────────────────────────────────────────────────────
        var baselineWindow = TimeSpan.FromSeconds(1.5);
        var baselineCount = MeasureThroughput(fleetService, baselineWindow);

        scenarioVm.BurstCommand.Execute(null);
        if (Math.Abs(fleetService.Scenario.CycleRateMultiplier - 6.0) > 1e-6)
            throw new InvalidOperationException($"selftest scenario: Burst did not raise CycleRateMultiplier to 6.0x (was {fleetService.Scenario.CycleRateMultiplier})");

        var burstWindow = TimeSpan.FromSeconds(1.5);
        var burstCount = MeasureThroughput(fleetService, burstWindow);

        var baselineRate = baselineCount / baselineWindow.TotalSeconds;
        var burstRate = burstCount / burstWindow.TotalSeconds;
        if (burstRate <= baselineRate * 1.3)
            throw new InvalidOperationException(
                $"selftest scenario: Burst throughput ({burstRate:0.0}/s, {burstCount} in {burstWindow.TotalSeconds}s) was not materially higher than " +
                $"baseline ({baselineRate:0.0}/s, {baselineCount} in {baselineWindow.TotalSeconds}s)");

        Console.WriteLine($"SELFTEST scenario burst: baseline {baselineRate:0.0} readings/s ({baselineCount}) -> burst {burstRate:0.0} readings/s ({burstCount})");

        if (!fleetService.IsRunning)
            throw new InvalidOperationException("selftest scenario: fleet is not running after the Burst throughput check");

        // Restore CycleRateMultiplier to 1.0 rather than leaving the burst's own 4s auto-revert timer
        // as the only thing that will do it — StopFleetCommand runs right after this method returns, so
        // a pending revert firing later is harmless (ApplyScenario no-ops the restart when !IsRunning),
        // but resetting explicitly here keeps this method's own effects fully undone before it returns.
        scenarioVm.ApplyPresetCommand.Execute(normalPreset);
        if (Math.Abs(fleetService.Scenario.CycleRateMultiplier - 1.0) > 1e-6)
            throw new InvalidOperationException($"selftest scenario: CycleRateMultiplier did not restore to 1.0x after re-applying \"Ca bình thường\" (was {fleetService.Scenario.CycleRateMultiplier})");

        // ── Burst-baseline correctness across OVERLAPPING clicks (fix-pass regression check) ──────
        // Reproduces the bug directly: clicking Burst a SECOND time while the first burst is still
        // active used to re-read _scenario.CycleRateMultiplier — by then already the BURST value 6.0 —
        // as the new "baseline", so the eventual revert left the fleet stuck at 6x forever. Scenario is
        // back at CycleRateMultiplier=1.0 here (just restored above), so 1.0 is the correct value to
        // expect once BOTH bursts' revert windows have expired.
        scenarioVm.BurstCommand.Execute(null);
        PumpDispatcherFor(TimeSpan.FromSeconds(1)); // still well inside the first burst's 4s window
        if (Math.Abs(fleetService.Scenario.CycleRateMultiplier - 6.0) > 1e-6)
            throw new InvalidOperationException($"selftest scenario: first overlapping Burst did not raise CycleRateMultiplier to 6.0x (was {fleetService.Scenario.CycleRateMultiplier})");

        scenarioVm.BurstCommand.Execute(null); // second click WHILE the first burst is still active
        if (Math.Abs(fleetService.Scenario.CycleRateMultiplier - 6.0) > 1e-6)
            throw new InvalidOperationException($"selftest scenario: second overlapping Burst did not keep CycleRateMultiplier at 6.0x (was {fleetService.Scenario.CycleRateMultiplier})");

        PumpDispatcherFor(TimeSpan.FromSeconds(5)); // both bursts' 4s revert windows must have expired by now

        if (Math.Abs(fleetService.Scenario.CycleRateMultiplier - 1.0) > 1e-6)
            throw new InvalidOperationException(
                $"selftest scenario: after two overlapping Bursts, CycleRateMultiplier did not revert to the pre-burst baseline 1.0x " +
                $"(was {fleetService.Scenario.CycleRateMultiplier}) — Burst-baseline-corruption regression");

        Console.WriteLine("SELFTEST scenario double-burst: two overlapping Burst clicks correctly reverted CycleRateMultiplier to the true pre-burst baseline (1.0x), not the burst value");

        // ── "Hot-folder AOI" preset — one-shot doc28 write + REAL HotFolderAoiDriver ingest ────────
        // Fire-and-forget + pump + poll — same pattern RunMachineDetailSelfTest already uses for
        // SyncConfigCommand, and for the same reason: ApplyPresetAsync's own await (on
        // FleetService.RunHotFolderAoiDemoAsync) has no ConfigureAwait(false), so a raw
        // ExecuteAsync(...).GetAwaiter().GetResult() here risks the classic sync-over-async deadlock if
        // ANY SynchronizationContext is current on this thread when that await's continuation needs to
        // post back (confirmed by trying it: it hung indefinitely). Pumping the dispatcher while polling
        // sidesteps that regardless of whether such a context exists.
        var hotFolderPreset = scenarioVm.Presets.FirstOrDefault(p => p.Name == "Hot-folder AOI")
            ?? throw new InvalidOperationException("selftest scenario: \"Hot-folder AOI\" preset not found in ScenarioViewModel.Presets");
        scenarioVm.ApplyPresetCommand.Execute(hotFolderPreset);
        PumpDispatcherFor(TimeSpan.FromSeconds(6)); // comfortably above RunHotFolderAoiDemoAsync's own 5s safety-net timeout

        if (scenarioVm.ApplyPresetCommand.IsRunning)
            throw new InvalidOperationException("selftest scenario: Hot-folder AOI preset's ApplyPresetCommand was still running 6s after Execute");
        if (scenarioVm.ApplyPresetCommand.ExecutionTask is { IsFaulted: true } faultedHotFolderTask)
            throw new InvalidOperationException($"selftest scenario: Hot-folder AOI preset faulted: {faultedHotFolderTask.Exception}");
        if (string.IsNullOrEmpty(scenarioVm.HotFolderStatus) || scenarioVm.HotFolderStatus.Contains("Lỗi", StringComparison.Ordinal))
            throw new InvalidOperationException($"selftest scenario: Hot-folder AOI demo did not report success — HotFolderStatus=\"{scenarioVm.HotFolderStatus}\"");

        Console.WriteLine($"SELFTEST scenario hot-folder: {scenarioVm.HotFolderStatus}");

        // Fix-pass: RunHotFolderAoiDemoAsync must clean up its own %TEMP% base dir once the round trip
        // completes — this used to accumulate one file-set per run forever.
        var hotFolderBaseDir = Path.Combine(Path.GetTempPath(), "st4i-sim-hotfolder-demo");
        if (Directory.Exists(hotFolderBaseDir))
            throw new InvalidOperationException($"selftest scenario: hot-folder temp dir \"{hotFolderBaseDir}\" still exists after the demo completed — cleanup did not run");

        Console.WriteLine($"SELFTEST scenario hot-folder cleanup: \"{hotFolderBaseDir}\" no longer exists");
    }

    /// <summary>Subscribes to <see cref="FleetService.Committed"/> for exactly <paramref name="window"/>
    /// (via <see cref="PumpDispatcherFor"/>), returning (failCount, judgedTotal). "Judged" excludes
    /// Telemetry readings (<see cref="Verdict.Skip"/>, no pass/fail concept) — same accounting rule
    /// <c>FleetViewModel.OnCommitted</c> already uses for its own FPY. The handler only touches these two
    /// local counters, and only from the background pipeline thread that fires <c>Committed</c> — the
    /// calling (UI/selftest) thread is parked inside <see cref="PumpDispatcherFor"/> for the whole
    /// window and only reads them after unsubscribing, so no synchronization is needed (same reasoning
    /// as <see cref="RunSelfTest"/>'s own <c>CaptureDemoPhase</c>/<c>CaptureAutoPhase</c> handlers).</summary>
    private static (int FailCount, int JudgedTotal) MeasureFailRate(FleetService fleetService, TimeSpan window)
    {
        var fail = 0;
        var total = 0;
        void OnCommitted(DeviceReading r, TransportAck a)
        {
            if (r.Verdict == Verdict.Skip) return;
            total++;
            if (r.Verdict == Verdict.Fail) fail++;
        }

        fleetService.Committed += OnCommitted;
        PumpDispatcherFor(window);
        fleetService.Committed -= OnCommitted;
        return (fail, total);
    }

    /// <summary>Same capture shape as <see cref="MeasureFailRate"/>, but returns every
    /// <see cref="TransportAck"/> committed during the window (used by the network-outage checks, which
    /// care about <see cref="TransportAck.Success"/>/<see cref="TransportAck.Queued"/>, not Verdict).</summary>
    private static List<TransportAck> MeasureAcks(FleetService fleetService, TimeSpan window)
    {
        var acks = new List<TransportAck>();
        void OnCommitted(DeviceReading r, TransportAck a) => acks.Add(a);

        fleetService.Committed += OnCommitted;
        PumpDispatcherFor(window);
        fleetService.Committed -= OnCommitted;
        return acks;
    }

    /// <summary>Same capture shape as <see cref="MeasureFailRate"/>, but just counts every reading
    /// committed during the window (used by the Burst throughput check).</summary>
    private static int MeasureThroughput(FleetService fleetService, TimeSpan window)
    {
        var count = 0;
        void OnCommitted(DeviceReading r, TransportAck a) => count++;

        fleetService.Committed += OnCommitted;
        PumpDispatcherFor(window);
        fleetService.Committed -= OnCommitted;
        return count;
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
