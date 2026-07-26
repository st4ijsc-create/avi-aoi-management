using System.Diagnostics;
using System.ServiceProcess;

namespace St4i.EngineApi.ServiceHost;

/// <summary>WS-F1-T1 — self-registration CLI verbs (<c>--install</c>/<c>--uninstall</c>/<c>--status</c>)
/// so operators/the installer never need `sc.exe` command-line knowledge of their own: they just run
/// `St4i.EngineApi.exe --install`. <see cref="TryHandle"/> is called from the FIRST lines of
/// <c>Program.cs</c>, BEFORE <c>WebApplication.CreateBuilder</c> — a pure install/uninstall/status
/// invocation must never spin up Kestrel, touch the security/historian/WAL directories, or initialize
/// DPAPI, so the entire verb path here is deliberately self-contained and has zero dependency on the rest
/// of the composition root.
///
/// <see cref="BuildScCreateArgs"/>/<see cref="BuildScDeleteArgs"/> are PURE (no I/O) and unit-tested
/// (<c>ServiceInstallVerbsTests</c>). The actual `sc.exe` process launch + the <see cref="ServiceController"/>
/// status query below are NOT unit-tested — both need either elevation (create/delete) or a real installed
/// service (status) that CI/a plain dev box doesn't have; see task-1-report.md for the manual verification
/// steps.</summary>
public static class ServiceInstallVerbs
{
    /// <summary>Runs as LocalSystem by default — the standard account for a service with no need to
    /// reach another machine's resources under a specific identity (this engine talks to the ST4I server
    /// over HTTP/MQTT, not via Windows-integrated auth).</summary>
    public const string DefaultAccount = "LocalSystem";

    /// <summary>Starts automatically at boot, before any user logs on — matches "runs continuously in
    /// the background" from <see cref="ServiceHostConstants.Description"/>.</summary>
    public const string DefaultStartType = "auto";

    /// <summary>Builds the exact `sc.exe create` argument vector. Deliberately returns a
    /// <see langword="string"/>[] (one array element per intended process argument) rather than a single
    /// pre-joined command line: handing each element to <see cref="ProcessStartInfo.ArgumentList"/>
    /// individually is what lets an element that itself CONTAINS a literal space (`binPath= "C:\Program
    /// Files\..."`) survive Windows' own command-line re-quoting round-trip intact — building one long
    /// string and re-splitting it on spaces would break exactly on paths like that.
    ///
    /// sc.exe's own `key= value` syntax is quirky and easy to get backwards: NO space before the `=`, but
    /// EXACTLY ONE space after it (`binPath=value` and `binPath =value` are both parse errors — sc.exe's
    /// own docs call this out explicitly). `binPath`/`DisplayName` are additionally wrapped in literal
    /// double quotes so a value containing spaces (an install path, this product's own multi-word display
    /// name) survives sc.exe's tokenizing of ITS OWN argument.</summary>
    public static string[] BuildScCreateArgs(string exePath, string serviceName, string account, string startType) =>
    [
        "create",
        serviceName,
        $"binPath= \"{exePath}\"",
        $"start= {startType}",
        $"obj= {account}",
        $"DisplayName= \"{ServiceHostConstants.DisplayName}\"",
    ];

    /// <summary>Builds the `sc.exe delete` argument vector — just the verb and the service name; sc.exe
    /// itself refuses to delete a service that's currently running (the caller gets its own clear error
    /// from sc.exe in that case; this project doesn't try to stop the service first on the caller's
    /// behalf, to keep `--uninstall` predictable/scriptable).</summary>
    public static string[] BuildScDeleteArgs(string serviceName) => ["delete", serviceName];

    /// <summary>Recognizes <c>--install</c>/<c>--uninstall</c>/<c>--status</c> in <paramref name="args"/>
    /// and, if present, handles the whole request itself (returns <see langword="true"/> so
    /// <c>Program.cs</c> early-returns <paramref name="exitCode"/> without ever calling
    /// <c>WebApplication.CreateBuilder</c>). Returns <see langword="false"/> with zero I/O for every other
    /// argument shape (normal engine startup, `--urls`, etc.) — that check happens BEFORE anything else in
    /// this method runs, so a non-service invocation is guaranteed to never touch `sc.exe`/
    /// <see cref="ServiceController"/> at all.</summary>
    public static bool TryHandle(string[] args, out int exitCode)
    {
        if (args.Contains("--install", StringComparer.OrdinalIgnoreCase))
        {
            exitCode = Install();
            return true;
        }

        if (args.Contains("--uninstall", StringComparer.OrdinalIgnoreCase))
        {
            exitCode = Uninstall();
            return true;
        }

        if (args.Contains("--status", StringComparer.OrdinalIgnoreCase))
        {
            exitCode = Status();
            return true;
        }

        exitCode = 0;
        return false;
    }

    private static int Install()
    {
        var exePath = Environment.ProcessPath;
        if (string.IsNullOrWhiteSpace(exePath))
        {
            Console.Error.WriteLine("--install: could not determine this process's own executable path (Environment.ProcessPath was null).");
            return 1;
        }

        var createArgs = BuildScCreateArgs(exePath, ServiceHostConstants.ServiceName, DefaultAccount, DefaultStartType);
        var (createExit, createOutput) = RunSc(createArgs);

        if (createExit != 0)
        {
            ReportScFailure("--install", createExit, createOutput);
            return createExit;
        }

        // sc.exe's `create` verb has no description switch — set it with a second call. Best-effort: a
        // service the SCM already accepted (the line above succeeded) is a fully usable service even if
        // this cosmetic follow-up somehow fails, so a non-zero exit here is logged but not fatal to
        // --install as a whole.
        var (descExit, descOutput) = RunSc(["description", ServiceHostConstants.ServiceName, ServiceHostConstants.Description]);
        if (descExit != 0)
        {
            Console.Error.WriteLine($"--install: service '{ServiceHostConstants.ServiceName}' was created, but setting its description failed (sc.exe exit {descExit}): {descOutput.Trim()}");
        }

        Console.WriteLine($"Installed service '{ServiceHostConstants.ServiceName}' ({ServiceHostConstants.DisplayName}), start type '{DefaultStartType}', binPath \"{exePath}\".");
        Console.WriteLine($"Start it with: sc start {ServiceHostConstants.ServiceName}  (or services.msc / a reboot, since start type is auto).");
        return 0;
    }

    private static int Uninstall()
    {
        var (exit, output) = RunSc(BuildScDeleteArgs(ServiceHostConstants.ServiceName));
        if (exit != 0)
        {
            ReportScFailure("--uninstall", exit, output);
            return exit;
        }

        Console.WriteLine($"Uninstalled service '{ServiceHostConstants.ServiceName}'.");
        return 0;
    }

    private static int Status()
    {
        try
        {
            using var controller = new ServiceController(ServiceHostConstants.ServiceName);
            // Touch .Status now (not deferred) so a service name the SCM doesn't recognize throws HERE,
            // inside this try, rather than propagating out as an unhandled InvalidOperationException.
            var status = controller.Status;
            Console.WriteLine($"{ServiceHostConstants.ServiceName}: {status}");
            return 0;
        }
        catch (InvalidOperationException)
        {
            // ServiceController throws this (wrapping a Win32Exception) both when the service was never
            // installed AND, distinctly, when the SCM itself can't be reached — the message text differs
            // between those two, so surface it verbatim instead of collapsing to one guess.
            Console.WriteLine($"{ServiceHostConstants.ServiceName}: not installed (or the Service Control Manager could not be queried).");
            return 1;
        }
    }

    /// <summary>Launches `sc.exe` with <paramref name="scArgs"/> via <see cref="ProcessStartInfo.ArgumentList"/>
    /// (never a hand-joined command-line string — see <see cref="BuildScCreateArgs"/>'s own remarks on
    /// why), captures stdout+stderr, and returns the combined text alongside the process exit code. Never
    /// throws on a launch failure — an environment with no `sc.exe` on PATH (not expected on any real
    /// Windows box, but defensively handled) reports a clear error instead of crashing the whole verb.</summary>
    private static (int ExitCode, string Output) RunSc(string[] scArgs)
    {
        try
        {
            var startInfo = new ProcessStartInfo("sc.exe")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            foreach (var arg in scArgs)
            {
                startInfo.ArgumentList.Add(arg);
            }

            using var process = Process.Start(startInfo);
            if (process is null)
            {
                return (1, "sc.exe failed to start (Process.Start returned null).");
            }

            var stdout = process.StandardOutput.ReadToEnd();
            var stderr = process.StandardError.ReadToEnd();
            process.WaitForExit();
            return (process.ExitCode, stdout + stderr);
        }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            return (1, $"Failed to launch sc.exe: {ex.Message}");
        }
    }

    /// <summary>sc.exe returns exit code 5 (and prints "Access is denied.") when the SCM refuses the
    /// create/delete because the current process isn't elevated — by far the most common failure an
    /// operator will hit, so it gets its own explicit, actionable message instead of just the raw sc.exe
    /// output.</summary>
    private static void ReportScFailure(string verb, int exitCode, string output)
    {
        Console.Error.WriteLine($"{verb}: sc.exe failed (exit {exitCode}): {output.Trim()}");
        if (exitCode == 5 || output.Contains("Access is denied", StringComparison.OrdinalIgnoreCase))
        {
            Console.Error.WriteLine($"{verb}: this requires administrator privileges. Re-run from an elevated (\"Run as administrator\") command prompt.");
        }
    }
}
