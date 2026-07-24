using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Windows;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;

namespace St4i.DesktopShell;

/// <summary>
/// Task 9 — the whole desktop shell in one window: locate + spawn the published St4i.EngineApi.exe
/// (which now also serves the built web UI at "/" — see St4i.EngineApi.csproj's wwwroot Content item +
/// Program.cs's UseStaticFiles/MapFallbackToFile, both added by this same task), poll it until it
/// answers GET /v1/fleet, then point a WebView2 control at it. No browser chrome, no separate server
/// process for the user to think about — double-click this exe and the whole offline app comes up in
/// one native window. Kills the engine child process (whole tree, not just the immediate PID) when this
/// window closes so nothing orphans on the exhibition floor after a visitor closes the app.
/// </summary>
public partial class MainWindow : Window
{
    // St4i.EngineApi.Program.cs's fixed default port (Task 3, unchanged by Task 9) — kept in sync by
    // convention (both are small, well-commented files a future task will touch together if this ever
    // needs to change), not by a shared constant, since the two projects don't otherwise reference
    // each other (the shell spawns EngineApi as an opaque child process, not a library).
    private const int EnginePort = 5199;
    private const string EngineExeName = "St4i.EngineApi.exe";
    private static readonly TimeSpan ReadyPollInterval = TimeSpan.FromMilliseconds(300);
    private static readonly TimeSpan ReadyTimeout = TimeSpan.FromSeconds(25);
    private static readonly Brush DefaultStatusBrush = new SolidColorBrush(Color.FromRgb(0x9C, 0xA9, 0xC9));

    private readonly string _engineBaseUrl = $"http://localhost:{EnginePort}";
    private readonly HttpClient _probeClient = new() { Timeout = TimeSpan.FromSeconds(2) };

    /// <summary>Non-null only if THIS shell instance spawned the engine — see
    /// <see cref="StartOrAttachToEngineAsync"/>'s "already running? attach instead of double-launching"
    /// check. Only ever killed from <see cref="MainWindow_Closing"/> when non-null, so this shell never
    /// kills an engine process some OTHER instance (or a developer's own "dotnet run") started.</summary>
    private Process? _ownedEngineProcess;

    public MainWindow()
    {
        InitializeComponent();
        Loaded += MainWindow_Loaded;
        Closing += MainWindow_Closing;
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        try
        {
            var ready = await StartOrAttachToEngineAsync();
            if (!ready)
            {
                ShowStatus(
                    $"Engine did not respond within {ReadyTimeout.TotalSeconds:0}s — " +
                    $"see %LOCALAPPDATA%\\St4iMachineSimulator\\logs\\engine.log",
                    isError: true);
                return;
            }

            // Final-review I-2(b): the engine answering GET /v1/fleet (just-checked above) only proves
            // the API is up — it says nothing about whether wwwroot actually has a UI to serve (the
            // mis-ordered-publish footgun the csproj-side guard now prevents at publish time, but an
            // ALREADY-published bad package, or attaching to someone else's already-running engine
            // that was, could still exist on disk). Probe the UI itself before hiding the splash so a
            // broken package shows this shell's own clear message instead of the WebView2 navigating
            // straight to ASP.NET's bare 404 page with no explanation.
            if (!await ProbeWebUiReadyAsync())
            {
                ShowStatus(
                    "Web UI not built — run `npm run build` in web/ then republish St4i.EngineApi " +
                    "(see README.md's publish order).",
                    isError: true);
                return;
            }

            await InitializeWebViewAsync();
        }
        catch (Exception ex)
        {
            ShowStatus($"Startup failed: {ex.Message}", isError: true);
        }
    }

    /// <summary>Returns true once something answers GET /v1/fleet on <see cref="EnginePort"/> — either an
    /// already-running EngineApi this shell attaches to (and will NOT kill on close — see
    /// <see cref="_ownedEngineProcess"/>'s remarks) or one this call just spawned. Returns false if
    /// neither happened within <see cref="ReadyTimeout"/>.</summary>
    private async Task<bool> StartOrAttachToEngineAsync()
    {
        if (await ProbeReadyAsync())
        {
            ShowStatus("Attached to already-running engine…");
            return true;
        }

        var enginePath = ResolveEnginePath();
        if (enginePath is null)
        {
            ShowStatus(
                $"Could not find {EngineExeName} next to this app (expected .\\engine\\{EngineExeName}) — " +
                "see README.md's publish layout.",
                isError: true);
            return false;
        }

        ShowStatus("Starting engine…");
        _ownedEngineProcess = LaunchEngineProcess(enginePath);

        var deadline = DateTime.UtcNow + ReadyTimeout;
        while (DateTime.UtcNow < deadline)
        {
            if (_ownedEngineProcess.HasExited)
            {
                ShowStatus(
                    $"Engine process exited unexpectedly (code {_ownedEngineProcess.ExitCode}) — " +
                    "see %LOCALAPPDATA%\\St4iMachineSimulator\\logs\\engine.log",
                    isError: true);
                return false;
            }

            if (await ProbeReadyAsync()) return true;

            ShowStatus("Waiting for engine…");
            await Task.Delay(ReadyPollInterval);
        }

        return false;
    }

    private async Task<bool> ProbeReadyAsync()
    {
        try
        {
            using var response = await _probeClient.GetAsync($"{_engineBaseUrl}/v1/fleet");
            return response.IsSuccessStatusCode;
        }
        catch
        {
            // Connection refused (nothing listening yet) / DNS blip / request timeout — all just mean
            // "not ready yet" from this poll loop's point of view, not a fatal error.
            return false;
        }
    }

    /// <summary>True once the engine answers a GET for the SPA shell itself with something other than
    /// 404 — i.e. wwwroot actually has an <c>index.html</c> to serve (see Program.cs's
    /// UseStaticFiles/MapFallbackToFile). Distinct from <see cref="ProbeReadyAsync"/>, which only
    /// proves the API host process is up; an engine with an empty (mis-published) wwwroot still passes
    /// that check.</summary>
    private async Task<bool> ProbeWebUiReadyAsync()
    {
        try
        {
            using var response = await _probeClient.GetAsync($"{_engineBaseUrl}/");
            return response.StatusCode != System.Net.HttpStatusCode.NotFound;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>Only supports the published layout this project's own publish step produces (exact
    /// commands in the report): St4i.DesktopShell.exe sits next to an "engine\" folder containing the
    /// published, self-contained St4i.EngineApi.exe (+ its wwwroot\ built-UI assets). Dev-mode iteration
    /// (Vite on :5173 + "dotnet run" on EngineApi's :5199, per Task 3/9's documented split) is entirely
    /// unaffected by this shell — this project is only for the packaged artifact.</summary>
    private static string? ResolveEnginePath()
    {
        var candidate = Path.Combine(AppContext.BaseDirectory, "engine", EngineExeName);
        return File.Exists(candidate) ? candidate : null;
    }

    // St4i.EngineApi.Config.DemoModeGate.EnvVarName, kept in sync by convention (same reasoning as
    // EnginePort above — this project doesn't reference EngineApi as a library, only spawns its
    // published .exe as an opaque child process). WS2-T2 (docs/PRODUCTION_UI_DESIGN.md §2.5) —
    // exhibition packaging: an operator drops a tiny launcher script beside THIS shell's own .exe
    // (see packaging/run-exhibition.bat, referenced from README.md §13) that sets this env var before
    // starting the shell; product packaging is just double-clicking the .exe directly, with nothing
    // set, which boots the engine child Live (WS2-T1's default) instead.
    private const string DemoEnabledEnvVar = "ST4I_DEMO_ENABLED";

    private static Process LaunchEngineProcess(string enginePath)
    {
        var logDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "St4iMachineSimulator", "logs");
        Directory.CreateDirectory(logDir);
        var logPath = Path.Combine(logDir, "engine.log");

        var psi = new ProcessStartInfo
        {
            FileName = enginePath,
            WorkingDirectory = Path.GetDirectoryName(enginePath),
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };

        // WS2-T2 — explicit passthrough of the Demo-mode flag from THIS shell's own process
        // environment to the spawned engine child. `Process.Start` already inherits the FULL parent
        // environment by default whenever `StartInfo.EnvironmentVariables` is left untouched (Win32
        // `CreateProcess` with a null environment block) — so this line is redundant in the common
        // case, but it makes the passthrough explicit and greppable here rather than relying silently
        // on that default (which a future change adding its own `psi.EnvironmentVariables` edits
        // could break without anyone noticing this flag stopped propagating).
        var demoFlag = Environment.GetEnvironmentVariable(DemoEnabledEnvVar);
        if (!string.IsNullOrEmpty(demoFlag))
        {
            psi.EnvironmentVariables[DemoEnabledEnvVar] = demoFlag;
        }

        var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
        process.Start();

        // Fire-and-forget log drain — a published EngineApi has no console anyone will see
        // (CreateNoWindow=true), so this is the only place its startup/runtime log lines go. A fresh
        // file per shell launch (File.Create truncates) keeps this from growing unbounded across many
        // exhibition-day runs; it's diagnostics for "why won't this launch", not an audit trail.
        _ = DrainToLogFileAsync(process, logPath);

        return process;
    }

    private static async Task DrainToLogFileAsync(Process process, string logPath)
    {
        try
        {
            await using var writer = new StreamWriter(File.Create(logPath)) { AutoFlush = true };
            var stdOutTask = CopyLinesAsync(process.StandardOutput, writer);
            var stdErrTask = CopyLinesAsync(process.StandardError, writer);
            await Task.WhenAll(stdOutTask, stdErrTask);
        }
        catch
        {
            // Best-effort diagnostics only — a failure writing the log must never take down the shell.
        }
    }

    private static async Task CopyLinesAsync(StreamReader reader, StreamWriter writer)
    {
        string? line;
        while ((line = await reader.ReadLineAsync()) is not null)
        {
            await writer.WriteLineAsync($"[{DateTime.Now:HH:mm:ss}] {line}");
        }
    }

    private async Task InitializeWebViewAsync()
    {
        // Explicit user data folder under %LOCALAPPDATA% rather than the WebView2 control's default
        // (a folder next to the exe) — a published exe could land somewhere without write access
        // (e.g. a locked-down Program Files install on a future non-exhibition deployment), and
        // %LOCALAPPDATA% is always writable by the current user.
        var userDataFolder = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "St4iMachineSimulator", "WebView2");
        Directory.CreateDirectory(userDataFolder);

        var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: userDataFolder);
        await Browser.EnsureCoreWebView2Async(environment);

        // Kiosk-adjacent polish — no right-click "View page source"/"Inspect" menu, no WebView2 status
        // bar flashing hovered-link URLs. DevTools (F12) intentionally left enabled: useful for
        // diagnosing a live exhibition issue, and it doesn't reintroduce any browser chrome (no
        // address bar/tabs) the brief asked to avoid.
        Browser.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
        Browser.CoreWebView2.Settings.IsStatusBarEnabled = false;

        Browser.CoreWebView2.Navigate($"{_engineBaseUrl}/");

        StatusPanel.Visibility = Visibility.Collapsed;
        Browser.Visibility = Visibility.Visible;
    }

    private void ShowStatus(string text, bool isError = false)
    {
        // Dispatcher.Invoke rather than touching StatusText directly: every caller today already resumes
        // on the UI thread (plain "await" inside a WPF app's Dispatcher SynchronizationContext does that
        // automatically), but this makes ShowStatus safe to call from anywhere without relying on that —
        // same defensive "always marshal before touching a bound/visual element" convention
        // St4iMachineSimulator's ViewModels use (see their DispatcherHelper.RunOnUiThread calls).
        Dispatcher.Invoke(() =>
        {
            StatusText.Text = text;
            StatusText.Foreground = isError ? Brushes.OrangeRed : DefaultStatusBrush;
        });
    }

    private void MainWindow_Closing(object? sender, CancelEventArgs e)
    {
        if (_ownedEngineProcess is { HasExited: false })
        {
            try
            {
                _ownedEngineProcess.Kill(entireProcessTree: true);
            }
            catch
            {
                // Best-effort shutdown — the window is closing regardless of whether this succeeds.
            }
        }
    }
}
