using System.Windows;
using Microsoft.Extensions.DependencyInjection;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
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

        services.AddSingleton(sp =>
        {
            var vm = new AppShellViewModel(sp.GetRequiredService<EventBus>());
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

        vm.StartFleetCommand.Execute(null);
        if (!vm.IsFleetRunning)
            throw new InvalidOperationException("selftest: StartFleet did not set IsFleetRunning");

        vm.StopFleetCommand.Execute(null);
        if (vm.IsFleetRunning)
            throw new InvalidOperationException("selftest: StopFleet did not clear IsFleetRunning");

        Console.WriteLine("SELFTEST OK");
    }
}
