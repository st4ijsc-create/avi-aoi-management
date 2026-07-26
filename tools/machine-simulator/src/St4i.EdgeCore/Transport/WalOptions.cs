using System.Globalization;
using St4i.EdgeCore.Infrastructure;

namespace St4i.EdgeCore.Transport;

/// <summary>
/// WS-C-T1 — configuration + pure path-resolution primitives for the durable write-ahead-log (WAL) that
/// backstops <see cref="LiveTransport"/>: readings the device can't submit right now (server down, network
/// blip) get appended to a per-machine on-disk queue file instead of being dropped, and replayed once the
/// server is reachable again. This type only resolves WHERE that queue lives and validates the knobs that
/// govern it — it does not read/write the WAL file itself (that's a later WS-C task) and is not wired into
/// any construction site yet.
///
/// The WAL root is a SIBLING of the historian/creds directories, not the same directory:
/// <c>%ProgramData%\ST4I\sim\wal</c> next to <c>...\sim\historian</c> (<see cref="St4i.EdgeCore.Historian.SqliteHistorianStore"/>)
/// and <c>...\sim\creds</c> (<see cref="CredentialStore"/>) — each concern gets its own leaf directory
/// under the shared <c>ST4I\sim</c> root.
/// </summary>
public sealed class WalOptions
{
    /// <summary>Directory override — same idiom as <c>ST4I_HISTORIAN_DIR</c> (see St4i.EngineApi's
    /// Program.cs). Unset/blank means "use <see cref="DefaultRoot"/>".</summary>
    public const string EnvVarDir = "ST4I_WAL_DIR";

    /// <summary>"false" or "0" (case-insensitive) disables the WAL; anything else (including unset)
    /// leaves it enabled.</summary>
    public const string EnvVarEnabled = "ST4I_WAL_ENABLED";

    /// <summary>Overrides <see cref="MaxBytes"/>. An unparseable value is ignored (falls back to the
    /// default) rather than crashing startup on a typo — see <see cref="FromEnvironment"/> for the
    /// full rationale. A value that DOES parse but is out of range (e.g. <c>0</c>) still throws via
    /// <see cref="Validate"/>: "ignore-on-parse-failure" is not "ignore-validation".</summary>
    public const string EnvVarMaxBytes = "ST4I_WAL_MAX_BYTES";

    private const long DefaultMaxBytes = 64L * 1024 * 1024;

    /// <summary>Whether the WAL is active at all. Defaults to <c>true</c>.</summary>
    public bool Enabled { get; init; } = true;

    /// <summary>Explicit WAL root directory, or <c>null</c> to fall back to <see cref="DefaultRoot"/>
    /// at resolution time (see <see cref="ResolveDir"/>).</summary>
    public string? Directory { get; init; }

    /// <summary>Per-queue-file size cap in bytes. Must be &gt; 0 (enforced by <see cref="Validate"/>).</summary>
    public long MaxBytes { get; init; } = DefaultMaxBytes;

    /// <summary>RESERVED — NOT YET ENFORCED (M-1, WS-C final-review fix wave). Intended meaning: minimum
    /// hours a queued entry is retained before it's eligible for age-based trimming. The value is
    /// validated (must be &gt;= 0, enforced by <see cref="Validate"/>) and settable, but nothing in
    /// <see cref="WalMaintenance"/> currently reads it — the ONLY guardrail enforced today is
    /// <see cref="MaxBytes"/>'s size-based drop-oldest trim (see <see cref="WalMaintenance.TrimFileToMaxBytes"/>).
    /// Age-based retention/trimming is a future task; do not assume queued entries are ever aged out
    /// purely by hour count today — only a full/over-budget file gets trimmed, regardless of how old its
    /// oldest line is.</summary>
    public int MinRetentionHours { get; init; } = 24;

    /// <summary>RESERVED — NOT YET ENFORCED (M-1, WS-C final-review fix wave). Intended meaning: an
    /// optional hard cap on entry age in hours; <c>null</c> means "no age cap". The value is validated
    /// (when set, must be &gt; 0, enforced by <see cref="Validate"/>) and settable, but — like
    /// <see cref="MinRetentionHours"/> — nothing in <see cref="WalMaintenance"/> currently reads it; only
    /// <see cref="MaxBytes"/>'s size-based drop-oldest trim is enforced today. Age-based retention is a
    /// future task: setting this today changes nothing about what gets trimmed or when.</summary>
    public int? MaxAgeHours { get; init; } = null;

    /// <summary>The default WAL root: <c>%ProgramData%\ST4I\sim\wal</c> — a SIBLING of the historian
    /// directory (<c>...\sim\historian</c>), never the same directory.</summary>
    public static string DefaultRoot() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ST4I", "sim", "wal");

    /// <summary>Resolves the effective WAL directory: <see cref="Directory"/> if set, else
    /// <see cref="DefaultRoot"/>. Does not create the directory — pure path arithmetic only.</summary>
    public string ResolveDir() => Directory ?? DefaultRoot();

    /// <summary>C-1 (Critical, WS-C final-review fix wave) — creates <see cref="ResolveDir"/> on disk
    /// (the full directory tree, if needed) and returns that path. MUST be called before anything writes
    /// to a queue file resolved via <see cref="ResolveQueueFile"/>: the vendored SDK's own
    /// <c>St4iDeviceClient.Enqueue</c> writes with <see cref="File.AppendAllText(string,string)"/>
    /// directly, which does NOT create missing parent directories, so on a fresh install (nothing has
    /// ever created <c>%ProgramData%\ST4I\sim\wal</c>) the very first offline write throws
    /// <see cref="DirectoryNotFoundException"/> — which escapes <see cref="LiveTransport.SendAsync"/>'s
    /// catch clauses (it only catches the three <c>St4i*Exception</c> types) and is swallowed by
    /// <c>EdgePipeline</c>'s generic catch into an unqueued failed ack: the record is LOST, not buffered.
    ///
    /// Same idiom as <see cref="CredentialStore.Save"/> (<c>Directory.CreateDirectory(...)</c> right
    /// before the first write) and <see cref="St4i.EdgeCore.Historian.SqliteHistorianStore"/>'s own ctor
    /// (<c>Directory.CreateDirectory(root)</c> unconditionally, before ever opening the DB file) —
    /// idempotent (a no-op when the directory already exists) and, DELIBERATELY, not wrapped in a
    /// try/catch here either: a WAL root that genuinely cannot be created (e.g. a ProgramData ACL/disk
    /// issue) is a fatal misconfiguration that should surface immediately (at startup, or at the next
    /// Settings-triggered <see cref="TransportCoordinator.RebuildLive"/>) and stop whatever composition
    /// root called this — silently downgrading to a null queuePath instead would make durable
    /// store-and-forward look like it's working when it silently isn't, which is the exact failure mode
    /// this fix exists to close.</summary>
    public string EnsureDir()
    {
        var dir = ResolveDir();
        System.IO.Directory.CreateDirectory(dir);
        return dir;
    }

    /// <summary>Resolves the on-disk queue FILE for <paramref name="machineCode"/>:
    /// <c>&lt;ResolveDir()&gt;\&lt;sanitized machineCode&gt;.jsonl</c>. Reuses
    /// <see cref="CredentialStore.SanitizeFileName"/> so an arbitrary machineCode can't escape the WAL
    /// directory or collide with a reserved filename — the exact same guarantee
    /// <see cref="CredentialStore"/> already gives the creds directory. Pure function of
    /// (<see cref="Directory"/>, machineCode): identical inputs always resolve to the identical path,
    /// which is what lets a later RebuildLive preserve an on-disk backlog across restarts.</summary>
    public string ResolveQueueFile(string machineCode)
    {
        ArgumentException.ThrowIfNullOrEmpty(machineCode);
        return Path.Combine(ResolveDir(), CredentialStore.SanitizeFileName(machineCode) + ".jsonl");
    }

    /// <summary>Builds a <see cref="WalOptions"/> from the <c>ST4I_WAL_*</c> environment variables,
    /// mirroring the <c>ST4I_HISTORIAN_DIR</c> override idiom in St4i.EngineApi's Program.cs:
    /// <list type="bullet">
    /// <item><c>ST4I_WAL_DIR</c> → <see cref="Directory"/> (null/blank → null, i.e. use the default).</item>
    /// <item><c>ST4I_WAL_ENABLED</c> → <see cref="Enabled"/> ("false"/"0" → false; unset/anything else → true).</item>
    /// <item><c>ST4I_WAL_MAX_BYTES</c> → <see cref="MaxBytes"/>. An unparseable value is IGNORED (keeps
    /// the default) rather than throwing, so a typo'd env var doesn't crash startup — but the resulting
    /// options are still run through <see cref="Validate"/>, so a value that parses fine but is
    /// out-of-range (e.g. <c>0</c>) still throws.</item>
    /// </list>
    /// Throws <see cref="ArgumentOutOfRangeException"/> (via <see cref="Validate"/>) before returning if
    /// the resolved options are invalid.</summary>
    public static WalOptions FromEnvironment()
    {
        var dir = Environment.GetEnvironmentVariable(EnvVarDir);
        var enabledRaw = Environment.GetEnvironmentVariable(EnvVarEnabled);
        var maxBytesRaw = Environment.GetEnvironmentVariable(EnvVarMaxBytes);

        var enabled = true;
        if (enabledRaw == "0" || string.Equals(enabledRaw, "false", StringComparison.OrdinalIgnoreCase))
        {
            enabled = false;
        }

        var maxBytes = DefaultMaxBytes;
        if (!string.IsNullOrWhiteSpace(maxBytesRaw) &&
            long.TryParse(maxBytesRaw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedMaxBytes))
        {
            maxBytes = parsedMaxBytes;
        }

        var options = new WalOptions
        {
            Directory = string.IsNullOrWhiteSpace(dir) ? null : dir,
            Enabled = enabled,
            MaxBytes = maxBytes,
        };
        options.Validate();
        return options;
    }

    /// <summary>Reject-before-mutate guardrail (same idiom as <see cref="St4i.EdgeCore.Historian.OeeSettingsStore.Set"/>):
    /// throws <see cref="ArgumentOutOfRangeException"/> — never clamps — when <see cref="MaxBytes"/> is
    /// &lt;= 0, <see cref="MinRetentionHours"/> is negative, or <see cref="MaxAgeHours"/> is set to &lt;= 0.</summary>
    public void Validate()
    {
        if (MaxBytes <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(MaxBytes), MaxBytes, "MaxBytes must be > 0.");
        }

        if (MinRetentionHours < 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(MinRetentionHours), MinRetentionHours, "MinRetentionHours must be >= 0.");
        }

        if (MaxAgeHours is <= 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(MaxAgeHours), MaxAgeHours, "MaxAgeHours must be > 0 when set.");
        }
    }
}
