namespace St4i.EdgeService;

/// <summary>
/// Task F1-2 — EdgeService's OWN copy of <c>St4i.EngineApi.Config.DemoModeGate</c>'s
/// <see cref="EnvVarName"/> env variable + truthy-parse semantics, REPLICATED rather than referenced:
/// <see cref="EdgeWorker"/>'s own doc comment already establishes that this project "deliberately does
/// NOT reference the WPF project or any WPF assembly" to stay a plain console host — the same reasoning
/// rules out a <c>ProjectReference</c> to St4i.EngineApi here too, since that would drag the whole
/// ASP.NET Core stack into what is otherwise just <c>Microsoft.Extensions.Hosting</c> + EdgeCore. This is
/// the THIRD place in the solution that duplicates this exact env-var name + parse rule rather than link
/// the assembly that owns the canonical copy — after <c>St4i.DesktopShell</c>'s
/// <c>MainWindow.xaml.cs</c> (<c>DemoEnabledEnvVar</c>, "kept in sync by convention... this project
/// doesn't reference EngineApi as a library") and the WPF exhibition app before it. Kept in sync by the
/// same convention: if <c>DemoModeGate.EnvVarName</c> ever changes, this literal must change with it.
///
/// SM-1b (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-1b-brief.md) — tried
/// collapsing this into a direct reference to <c>St4i.EngineApi.Config.DemoModeGate</c> instead, per that
/// task's brief. Confirmed NOT viable, not just architecturally undesirable: adding
/// <c>&lt;ProjectReference Include="..\St4i.EngineApi\St4i.EngineApi.csproj" /&gt;</c> to this project and
/// restoring fails immediately with <c>NU1605</c> ("Detected package downgrade:
/// Microsoft.Extensions.Hosting from 10.0.10 to 9.0.0") — St4i.EngineApi transitively requires
/// <c>Microsoft.Extensions.Hosting</c> &gt;= 10.0.10 via its <c>Microsoft.Extensions.Hosting.WindowsServices</c>
/// package reference, while this project pins 9.0.0. Bumping past that would still pull in every one of
/// St4i.EngineApi's other dependencies this lean host has no use for — the <c>Microsoft.NET.Sdk.Web</c>
/// SDK (an implicit <c>Microsoft.AspNetCore.App</c> FrameworkReference), a publish-time
/// <c>Error Condition="!Exists(...web/dist/index.html)"</c> target, <c>PDFsharp-MigraDoc-GDI</c>, and
/// <c>Makaretu.Dns.Multicast.New</c>. This is the same "project-reference direction problem" the doc
/// comment above already predicted in principle; this note records the concrete build failure that
/// confirms it, so this duplicate is now known-necessary rather than merely unexamined. This same class
/// also now decides the fleet SOURCE (see <c>EdgeWorker.LoadFleet</c>'s own <c>_demoModeGate</c> remarks),
/// not just the transport — one env var, one parse rule, reused for both decisions within this project.
///
/// Absent/unset/anything-not-truthy → <see cref="Enabled"/> is <see langword="false"/>, which
/// <see cref="EdgeWorker.BuildTransport"/> reads as "use Live" — the product default this task
/// introduces (previously EdgeWorker hardcoded <c>new DemoTransport()</c> unconditionally). Truthy
/// (<c>"1"</c>/<c>"true"</c>, case-insensitive) means Demo, exactly like the WPF app's exhibition mode.
/// </summary>
public sealed class TransportModeGate
{
    public const string EnvVarName = "ST4I_DEMO_ENABLED";

    public bool Enabled { get; }

    /// <summary>Normal entry point — reads the real process environment variable.</summary>
    public TransportModeGate() : this(Environment.GetEnvironmentVariable(EnvVarName))
    {
    }

    /// <summary>Test-only seam — lets unit tests exercise the parsing rules with an explicit raw value
    /// instead of mutating the process-wide environment (flaky under a parallel test run). `internal`,
    /// reachable from <c>St4i.EdgeService.Tests</c> via this project's <c>AssemblyInfo.cs</c>
    /// <c>InternalsVisibleTo</c>.</summary>
    internal TransportModeGate(string? rawValue)
    {
        Enabled = ParseFlag(rawValue);
    }

    /// <summary>Same truthy rule as <c>DemoModeGate.ParseFlag</c>: accepts <c>"true"</c>/<c>"1"</c>
    /// (case-insensitive, surrounding whitespace tolerated); anything else, including unset/empty/
    /// whitespace-only, resolves to disabled.</summary>
    private static bool ParseFlag(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return false;
        var trimmed = raw.Trim();
        return trimmed == "1" || string.Equals(trimmed, "true", StringComparison.OrdinalIgnoreCase);
    }
}
