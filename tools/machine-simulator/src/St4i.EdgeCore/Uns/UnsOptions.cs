using System.Globalization;

namespace St4i.EdgeCore.Uns;

/// <summary>
/// G2-2 (docs/plans/2026-07-27-giaidoan2-synapse-connect-blueprint.md task 2) — configuration for the
/// local Unified Namespace spine: the ISA-95-shaped address (<see cref="Site"/>/<see cref="Area"/>/
/// <see cref="Line"/>/<see cref="Cell"/>) every reading's Sparkplug + semantic-mirror topics are built
/// from (see <see cref="UnsTopicBuilder"/>), plus whether the spine is on at all and which loopback port
/// the embedded <see cref="UnsBroker"/> listens on.
///
/// Mirrors the <see cref="St4i.EdgeCore.Transport.WalOptions.FromEnvironment"/> idiom exactly: env vars
/// are read ONCE at startup, an unset/blank string falls back to its default rather than throwing, and an
/// unparseable <see cref="EnvVarPort"/> value is silently ignored (keeps the default) instead of crashing
/// startup on a typo.
///
/// Loopback-only for this task (G2-2) — <see cref="BrokerPort"/> is deliberately NOT 1883 (the standard
/// MQTT port) so this never collides with a real broker someone might also have running on the same
/// machine; a LAN bind is explicitly out of scope until mTLS lands (see <see cref="UnsBroker"/>'s own
/// doc comment).
/// </summary>
public sealed class UnsOptions
{
    public const string EnvVarEnabled = "ST4I_UNS_ENABLED";
    public const string EnvVarSite = "ST4I_UNS_SITE";
    public const string EnvVarArea = "ST4I_UNS_AREA";
    public const string EnvVarLine = "ST4I_UNS_LINE";
    public const string EnvVarCell = "ST4I_UNS_CELL";
    public const string EnvVarPort = "ST4I_UNS_PORT";

    /// <summary>Non-1883 loopback default — see the class doc comment.</summary>
    public const int DefaultBrokerPort = 18830;

    /// <summary>Whether the UNS spine is active at all. Defaults to <see langword="true"/> — additive by
    /// default, but every call site that wires this up (FleetHost/Program.cs) treats a <see langword="null"/>
    /// publisher/broker (this flag off) as "byte-identical to today", so turning it off is always safe.</summary>
    public bool Enabled { get; init; } = true;

    public string Site { get; init; } = "site";

    public string Area { get; init; } = "area";

    public string Line { get; init; } = "line";

    public string Cell { get; init; } = "cell";

    /// <summary>The embedded loopback broker's TCP port. See <see cref="DefaultBrokerPort"/> for why this
    /// isn't 1883.</summary>
    public int BrokerPort { get; init; } = DefaultBrokerPort;

    /// <summary>Builds a <see cref="UnsOptions"/> from the <c>ST4I_UNS_*</c> environment variables, same
    /// "read once at startup, unparseable falls back to default rather than throwing" idiom as
    /// <see cref="St4i.EdgeCore.Transport.WalOptions.FromEnvironment"/>:
    /// <list type="bullet">
    /// <item><c>ST4I_UNS_ENABLED</c> → <see cref="Enabled"/> ("false"/"0" (case-insensitive) → false;
    /// unset/anything else → true).</item>
    /// <item><c>ST4I_UNS_SITE</c>/<c>ST4I_UNS_AREA</c>/<c>ST4I_UNS_LINE</c>/<c>ST4I_UNS_CELL</c> →
    /// <see cref="Site"/>/<see cref="Area"/>/<see cref="Line"/>/<see cref="Cell"/> (unset/blank → the
    /// built-in default for that field).</item>
    /// <item><c>ST4I_UNS_PORT</c> → <see cref="BrokerPort"/>. An unparseable value is IGNORED (keeps
    /// <see cref="DefaultBrokerPort"/>) rather than throwing.</item>
    /// </list>
    /// </summary>
    public static UnsOptions FromEnvironment()
    {
        var enabledRaw = Environment.GetEnvironmentVariable(EnvVarEnabled);
        var enabled = true;
        if (enabledRaw == "0" || string.Equals(enabledRaw, "false", StringComparison.OrdinalIgnoreCase))
        {
            enabled = false;
        }

        var port = DefaultBrokerPort;
        var portRaw = Environment.GetEnvironmentVariable(EnvVarPort);
        if (!string.IsNullOrWhiteSpace(portRaw) &&
            int.TryParse(portRaw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedPort))
        {
            port = parsedPort;
        }

        return new UnsOptions
        {
            Enabled = enabled,
            Site = ReadOrDefault(EnvVarSite, "site"),
            Area = ReadOrDefault(EnvVarArea, "area"),
            Line = ReadOrDefault(EnvVarLine, "line"),
            Cell = ReadOrDefault(EnvVarCell, "cell"),
            BrokerPort = port,
        };
    }

    private static string ReadOrDefault(string envVar, string fallback)
    {
        var raw = Environment.GetEnvironmentVariable(envVar);
        return string.IsNullOrWhiteSpace(raw) ? fallback : raw;
    }
}
