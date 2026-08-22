namespace St4i.EdgeCore.Config;

/// <summary>
/// WS2-T1 (docs/PRODUCTION_UI_DESIGN.md §2.2) — the single source of truth for whether Demo mode is
/// permitted on THIS deployment. Read ONCE at process startup from the <see cref="EnvVarName"/>
/// environment variable (settable in a launch-env/config file dropped beside the packaged `.exe`,
/// exactly like an exhibition build's `fleet.json`) — absent/unset/anything-not-truthy means
/// <see cref="Enabled"/> is <see langword="false"/>, the deliberately-safe default for a customer
/// (product) deployment: nobody can switch this machine's transport to a fabricated fleet by mistake.
///
/// Two things key off this single flag in <c>St4i.EngineApi</c>:
///  1. <c>Program.cs</c>'s <c>TransportCoordinator</c> registration — the exhibition-packaging case
///     (design doc §2.5: "cờ Demo bật → khách bật máy là có fleet 11 máy giả offline") starts the
///     engine directly IN Demo mode when this is enabled, so an exhibition `.exe` is offline out of
///     the box with zero extra clicks, same as before this task. Disabled (the product default)
///     starts in Live instead (WS2-T1 goal 1).
///  2. <c>ModeEndpoints</c>'s <c>PUT /v1/mode</c> — rejects an explicit switch TO Demo when this is
///     disabled (honest 400, not a silent no-op or a vague failure), and <c>/v1/capabilities</c>
///     reports it so the web topbar/Settings mode selectors know whether to even render the DEMO
///     option.
///
/// SM-1b fix round 1 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-1b-brief.md,
/// review) — MOVED here from <c>St4i.EngineApi.Config.DemoModeGate</c>, collapsing what had been TWO of
/// three duplicated copies of this exact env-var name + parse rule in the solution
/// (<c>St4i.EngineApi.Config.DemoModeGate</c> and <c>St4i.EdgeService.TransportModeGate</c> — see below
/// for why that second one existed at all). <see cref="St4i.EdgeCore"/> is the one project BOTH
/// <c>St4i.EngineApi</c> and <c>St4i.EdgeService</c> already <c>ProjectReference</c>, so this move adds
/// NO new project-reference edge in either direction and carries none of
/// <c>St4i.EngineApi.csproj</c>'s dependency weight (ASP.NET Core, the web-UI publish gate,
/// <c>PDFsharp-MigraDoc-GDI</c>, <c>Makaretu.Dns.Multicast.New</c>) that made a direct
/// <c>St4i.EdgeService → St4i.EngineApi</c> reference fail at restore (confirmed empirically —
/// <c>NU1605</c> package downgrade — during the SM-1b task; see the task's report for the exact error).
///
/// The THIRD duplicate, <c>St4i.DesktopShell/MainWindow.xaml.cs</c>'s <c>DemoEnabledEnvVar</c> const,
/// does NOT collapse into this move: that project has ZERO <c>ProjectReference</c>s at all (it only
/// spawns the published <c>St4i.EngineApi.exe</c> as an external child process and forwards this env
/// var's raw string value into its environment) — referencing this class would require giving that
/// project its first-ever library dependency for a single string constant it doesn't even parse.
/// Left as its own copy, kept in sync by convention, same as before.
/// </summary>
public sealed class DemoModeGate
{
    /// <summary>The environment variable this gate reads: <c>ST4I_DEMO_ENABLED</c>. That spelling is
    /// duplicated, not shared, in <c>St4i.DesktopShell/MainWindow.xaml.cs</c>'s own <c>DemoEnabledEnvVar</c>
    /// const — see the class doc comment for why that copy cannot collapse into this one. The two must be
    /// edited together; nothing asserts they agree.</summary>
    public const string EnvVarName = "ST4I_DEMO_ENABLED";

    /// <summary>Whether Demo mode is permitted on this deployment. Fixed at construction — this gate never
    /// re-reads the environment, so changing the variable after startup has no effect until the process
    /// restarts. False is the safe default and covers unset, blank and any non-truthy value.
    ///
    /// 🔴 CORRECTED — this used to record that what the flag gates "is narrower than the name suggests":
    /// that it governed the startup mode and <c>PUT /v1/mode</c>'s acceptance of <c>Demo</c> but did NOT
    /// gate <c>POST /v1/scenario</c>'s network-outage path, which installed a fabricating transport
    /// without consulting it. That gap is now closed, so the sentence would be false if left standing.
    /// <c>St4i.EngineApi.Endpoints.ScenarioEndpoints</c> now consults this flag on BOTH routes that can
    /// install that transport — <c>POST /v1/scenario</c> with <c>networkOutage:true</c> and
    /// <c>POST /v1/scenario/preset</c> with a preset whose config carries it — and refuses each with the
    /// same honest 400 <c>PUT /v1/mode</c> uses.
    ///
    /// What this flag governs is therefore the TRANSPORT, and only the transport: the startup mode, an
    /// explicit switch to <c>Demo</c>, and the scenario paths that repoint the running fleet at a
    /// fabricated one. It does NOT gate the simulators themselves — <c>ScenarioConfig</c>'s
    /// <c>ExtraDefectRate</c>, <c>FaultRate</c> and <c>CycleRateMultiplier</c> change what the simulated
    /// machines produce and are deliberately left ungated, because their output still goes to the real
    /// server and is still reported truthfully by <c>GET /v1/scenario</c>. Turning this flag off buys
    /// "this machine will not fabricate its TRANSPORT", not "this machine will not simulate".
    ///
    /// <para>🔴 CORRECTED 2026-08-22 (item 33) — "still reported truthfully by <c>GET /v1/scenario</c>"
    /// held for the three simulator knobs and it still does; it did NOT hold for the fourth field on that
    /// same response. <c>NetworkOutage</c> reported a DECLARED flag, and <c>PUT /v1/mode</c> /
    /// <c>PUT /v1/settings</c> / a switch to Demo each replace the outage transport without clearing it,
    /// so the one field on that payload that is about THIS flag's own axis was the one that could lie.
    /// It now reports the transport actually installed. <b>This gate is not affected either way</b> — it
    /// runs before <c>FleetHost.ApplyScenario</c> and decides admission, not reporting; what changed is
    /// the honesty of the surface that the gate's own rationale pointed at.</para></summary>
    public bool Enabled { get; }

    /// <summary>Normal entry point — reads the real process environment variable.</summary>
    public DemoModeGate() : this(Environment.GetEnvironmentVariable(EnvVarName))
    {
    }

    /// <summary>Explicit-raw-value seam: given an already-resolved string, applies the SAME truthy-parse
    /// rule as <see cref="EnvVarName"/> without touching the process environment at all. Originally
    /// `internal` and test-only (mutating the real, process-wide env var is flaky under a parallel test
    /// run); made <see langword="public"/> in SM-1b fix round 1 (task-1b-brief.md, review) once
    /// <c>St4i.EdgeService.EdgeWorker.ResolveGate</c> became a second, genuinely-PRODUCTION caller — it
    /// needs to build a gate from a value it already resolved itself (the <c>--smoke</c> CI-path default,
    /// or an already-fetched raw env var), not a fabricated test-only capability. A public overload here
    /// is more honest than granting one production assembly `InternalsVisibleTo` access into another's
    /// internals for a non-test reason.</summary>
    public DemoModeGate(string? rawValue)
    {
        Enabled = ParseFlag(rawValue);
    }

    /// <summary>Accepts the common truthy spellings an operator/launcher script might reasonably type
    /// (`"true"`/`"1"`, case-insensitive, surrounding whitespace tolerated) — anything else, including
    /// unset/empty/whitespace-only, resolves to disabled. Deliberately NOT bool.Parse alone: that would
    /// reject `"1"`, a very common shell/launch-config convention for boolean env vars.</summary>
    private static bool ParseFlag(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return false;
        var trimmed = raw.Trim();
        return trimmed == "1" || string.Equals(trimmed, "true", StringComparison.OrdinalIgnoreCase);
    }
}
