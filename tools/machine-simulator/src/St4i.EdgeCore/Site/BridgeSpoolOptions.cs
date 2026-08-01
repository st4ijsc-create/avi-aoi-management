using System.Globalization;

namespace St4i.EdgeCore.Site;

/// <summary>
/// GĐ3 closeout WI-2 — configuration knobs for <see cref="BridgeSpool"/>, the durable SQLite queue that
/// will backstop <c>UnsBridge</c>'s northbound forward loop against a Site outage (WI-3 wires it in; this
/// task is the store in isolation). Deliberately the SAME shape as
/// <see cref="St4i.EdgeCore.Transport.WalOptions"/> — a plain options bag with a <c>FromEnvironment()</c>
/// that reads the <c>ST4I_BRIDGE_SPOOL_*</c> variables, where an unparseable value is IGNORED (falls back
/// to the default) rather than crashing startup on a typo. This class only resolves the configuration; it
/// does not open or touch the database file itself (that is <see cref="BridgeSpool"/>'s job), and — like
/// <see cref="St4i.EdgeCore.Transport.WalOptions"/> — nothing in this task yet constructs a
/// <see cref="BridgeSpool"/> from it (that wiring, plus honoring <see cref="Enabled"/>, is WI-3's job).
/// </summary>
public sealed class BridgeSpoolOptions
{
    /// <summary>"false" or "0" (case-insensitive) disables the spool; anything else (including unset)
    /// leaves it enabled. Consumed by WI-3's composition root, not by <see cref="BridgeSpool"/> itself.</summary>
    public const string EnvVarEnabled = "ST4I_BRIDGE_SPOOL_ENABLED";

    /// <summary>Directory override — same idiom as <see cref="St4i.EdgeCore.Transport.WalOptions.EnvVarDir"/>/
    /// <see cref="SiteLinkStore.EnvVarDir"/>. Unset or blank means "use <see cref="DefaultRoot"/>". Mirrored
    /// by <see cref="BridgeSpool.EnvVarDir"/> (same constant value) so the store can resolve its own root
    /// independently of this options bag.</summary>
    public const string EnvVarDir = "ST4I_BRIDGE_SPOOL_DIR";

    /// <summary>Overrides <see cref="MaxBytes"/>. An unparseable OR non-positive value is ignored (falls
    /// back to the default) rather than crashing startup on a typo.</summary>
    public const string EnvVarMaxBytes = "ST4I_BRIDGE_SPOOL_MAX_BYTES";

    /// <summary>Overrides <see cref="MaxAgeHours"/>. An unparseable OR non-positive value is ignored (falls
    /// back to the default).</summary>
    public const string EnvVarMaxAgeHours = "ST4I_BRIDGE_SPOOL_MAX_AGE_HOURS";

    private const long DefaultMaxBytes = 64L * 1024 * 1024;

    // The product requirement is a >= 24h buffer; 48h gives headroom over that floor.
    private const int DefaultMaxAgeHours = 48;

    /// <summary>Whether the spool is active at all. Defaults to <c>true</c>.</summary>
    public bool Enabled { get; init; } = true;

    /// <summary>Explicit spool root directory, or <c>null</c> to fall back to <see cref="DefaultRoot"/> at
    /// resolution time.</summary>
    public string? Directory { get; init; }

    /// <summary>Total spool size cap in bytes, enforced by <see cref="BridgeSpool.TrimAsync"/> via a
    /// drop-oldest policy. Defaults to 64 MiB.</summary>
    public long MaxBytes { get; init; } = DefaultMaxBytes;

    /// <summary>Maximum age, in hours, a spooled item is retained before <see cref="BridgeSpool.TrimAsync"/>
    /// drops it. Defaults to 48h (product requirement is >= 24h; this gives headroom).</summary>
    public int MaxAgeHours { get; init; } = DefaultMaxAgeHours;

    /// <summary>The default spool root: <c>%ProgramData%\ST4I\sim\bridge-spool</c> — a SIBLING of
    /// <c>...\sim\sitelink</c>/<c>...\sim\alarms</c>/<c>...\sim\wal</c>, never the same directory.</summary>
    public static string DefaultRoot() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ST4I", "sim", "bridge-spool");

    /// <summary>Resolves the effective spool directory: <see cref="Directory"/> if set, else
    /// <see cref="DefaultRoot"/>. Does not create the directory — pure path arithmetic only.</summary>
    public string ResolveDir() => Directory ?? DefaultRoot();

    /// <summary>Builds a <see cref="BridgeSpoolOptions"/> from the <c>ST4I_BRIDGE_SPOOL_*</c> environment
    /// variables, mirroring <see cref="St4i.EdgeCore.Transport.WalOptions.FromEnvironment"/>:
    /// <list type="bullet">
    /// <item><see cref="EnvVarDir"/> → <see cref="Directory"/> (null/blank → null, i.e. use the default).</item>
    /// <item><see cref="EnvVarEnabled"/> → <see cref="Enabled"/> ("false"/"0" → false; unset/anything else → true).</item>
    /// <item><see cref="EnvVarMaxBytes"/> → <see cref="MaxBytes"/>. Unparseable OR &lt;= 0 → default, never throws.</item>
    /// <item><see cref="EnvVarMaxAgeHours"/> → <see cref="MaxAgeHours"/>. Unparseable OR &lt;= 0 → default, never throws.</item>
    /// </list>
    /// Never throws — a typo'd env var falls back to the corresponding default, same rationale as
    /// <see cref="St4i.EdgeCore.Transport.WalOptions.FromEnvironment"/>'s own doc comment.</summary>
    public static BridgeSpoolOptions FromEnvironment()
    {
        var dir = Environment.GetEnvironmentVariable(EnvVarDir);
        var enabledRaw = Environment.GetEnvironmentVariable(EnvVarEnabled);
        var maxBytesRaw = Environment.GetEnvironmentVariable(EnvVarMaxBytes);
        var maxAgeHoursRaw = Environment.GetEnvironmentVariable(EnvVarMaxAgeHours);

        var enabled = true;
        if (enabledRaw == "0" || string.Equals(enabledRaw, "false", StringComparison.OrdinalIgnoreCase))
        {
            enabled = false;
        }

        var maxBytes = DefaultMaxBytes;
        if (!string.IsNullOrWhiteSpace(maxBytesRaw) &&
            long.TryParse(maxBytesRaw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedMaxBytes) &&
            parsedMaxBytes > 0)
        {
            maxBytes = parsedMaxBytes;
        }

        var maxAgeHours = DefaultMaxAgeHours;
        if (!string.IsNullOrWhiteSpace(maxAgeHoursRaw) &&
            int.TryParse(maxAgeHoursRaw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedMaxAgeHours) &&
            parsedMaxAgeHours > 0)
        {
            maxAgeHours = parsedMaxAgeHours;
        }

        return new BridgeSpoolOptions
        {
            Directory = string.IsNullOrWhiteSpace(dir) ? null : dir,
            Enabled = enabled,
            MaxBytes = maxBytes,
            MaxAgeHours = maxAgeHours,
        };
    }
}
