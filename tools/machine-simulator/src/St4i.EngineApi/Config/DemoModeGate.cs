namespace St4i.EngineApi.Config;

/// <summary>
/// WS2-T1 (docs/PRODUCTION_UI_DESIGN.md §2.2) — the single source of truth for whether Demo mode is
/// permitted on THIS deployment. Read ONCE at process startup from the <see cref="EnvVarName"/>
/// environment variable (settable in a launch-env/config file dropped beside the packaged `.exe`,
/// exactly like an exhibition build's `fleet.json`) — absent/unset/anything-not-truthy means
/// <see cref="Enabled"/> is <see langword="false"/>, the deliberately-safe default for a customer
/// (product) deployment: nobody can switch this machine's transport to a fabricated fleet by mistake.
///
/// Two things key off this single flag:
///  1. <c>Program.cs</c>'s <c>TransportCoordinator</c> registration — the exhibition-packaging case
///     (design doc §2.5: "cờ Demo bật → khách bật máy là có fleet 11 máy giả offline") starts the
///     engine directly IN Demo mode when this is enabled, so an exhibition `.exe` is offline out of
///     the box with zero extra clicks, same as before this task. Disabled (the product default)
///     starts in Live instead (WS2-T1 goal 1).
///  2. <c>ModeEndpoints</c>'s <c>PUT /v1/mode</c> — rejects an explicit switch TO Demo when this is
///     disabled (honest 400, not a silent no-op or a vague failure), and <c>/v1/capabilities</c>
///     reports it so the web topbar/Settings mode selectors know whether to even render the DEMO
///     option.
/// </summary>
public sealed class DemoModeGate
{
    public const string EnvVarName = "ST4I_DEMO_ENABLED";

    public bool Enabled { get; }

    /// <summary>Normal entry point — reads the real process environment variable.</summary>
    public DemoModeGate() : this(Environment.GetEnvironmentVariable(EnvVarName))
    {
    }

    /// <summary>Test-only seam — lets unit tests exercise the parsing rules with an explicit raw value
    /// instead of mutating the process-wide environment (flaky under a parallel test run).</summary>
    internal DemoModeGate(string? rawValue)
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
