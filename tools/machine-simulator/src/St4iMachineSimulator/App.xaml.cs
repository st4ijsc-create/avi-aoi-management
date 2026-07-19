using System.Windows;
using System.Windows.Threading;
using LiveChartsCore;
using LiveChartsCore.SkiaSharpView;
using LiveChartsCore.SkiaSharpView.WPF;
using Microsoft.Extensions.DependencyInjection;
using St4i.EdgeCore.Infrastructure;
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

        services.AddSingleton(sp =>
        {
            var vm = new AppShellViewModel(
                sp.GetRequiredService<EventBus>(),
                sp.GetRequiredService<FleetService>(),
                sp.GetRequiredService<DashboardView>());
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

        PumpDispatcherFor(TimeSpan.FromSeconds(3));

        var reportingMachines = fleetVm.Machines.Count(m => m.Cycles > 0);
        if (reportingMachines == 0)
            throw new InvalidOperationException("selftest: no MachineViewModel tile's Cycles incremented after running the fleet for 3s");
        if (fleetVm.TotalCycles <= reportingMachines)
            throw new InvalidOperationException($"selftest: FleetViewModel.TotalCycles ({fleetVm.TotalCycles}) did not grow beyond the fleet's initial round-robin burst ({reportingMachines}) — pipeline does not appear to be running repeated cycles");

        Console.WriteLine(
            $"SELFTEST fleet: {reportingMachines}/{fleetVm.Machines.Count} machine tiles reported >=1 cycle, " +
            $"TotalCycles={fleetVm.TotalCycles}, OnlineCount={fleetVm.OnlineCount}, Fpy={fleetVm.Fpy:P1}");

        vm.StopFleetCommand.Execute(null);
        if (vm.IsFleetRunning)
            throw new InvalidOperationException("selftest: StopFleet did not clear IsFleetRunning");

        Console.WriteLine("SELFTEST OK");
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
