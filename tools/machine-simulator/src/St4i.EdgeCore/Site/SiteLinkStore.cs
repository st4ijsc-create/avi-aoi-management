using System.Text.Json;

namespace St4i.EdgeCore.Site;

/// <summary>
/// GĐ3 EC-2 — edge-local, JSON-file-backed store for the <see cref="PersistedSiteLink"/>, so a runtime
/// Site-link change (EC-3's <c>PUT /v1/site</c>, applied through <see cref="SiteBridgeManager.ApplyAsync"/>)
/// survives a process restart. Deliberately the EXACT SAME shape as <see cref="Config.FleetSettingsStore"/>
/// (single coarse lock, whole-file rewrite via a temp-file-then-<see cref="File.Move(string, string, bool)"/>
/// atomic write, tolerant <see cref="Load"/> that swallows a missing/corrupt file rather than throwing) —
/// see that class's own doc comment for the full "why atomic, why tolerant" rationale, which applies here
/// unchanged. NO secrets ever pass through this file (see <see cref="PersistedSiteLink"/>'s own doc
/// comment) — only Host/Port/Enabled and the Site's PUBLIC trust-pin PEM.
/// </summary>
public sealed class SiteLinkStore
{
    /// <summary>Relocates the whole store — same "tests get a throwaway root instead of polluting
    /// %ProgramData%" rationale as <see cref="Config.FleetSettingsStore.EnvVarDir"/>/
    /// <see cref="Identity.DeviceIdentityStore.EnvVarDir"/>.</summary>
    public const string EnvVarDir = "ST4I_SITELINK_DIR";

    private const string FileName = "site-link.json";

    private static readonly JsonSerializerOptions PersistenceOptions = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true,
    };

    private readonly object _gate = new();

    /// <summary>Directory holding <c>site-link.json</c>.</summary>
    public string RootDirectory { get; }

    /// <param name="directory">Explicit directory override (tests), or <see langword="null"/> to resolve
    /// via <see cref="ResolveRoot"/> (<see cref="EnvVarDir"/>, then <see cref="DefaultRoot"/>).</param>
    public SiteLinkStore(string? directory = null)
    {
        RootDirectory = ResolveRoot(directory);
        Directory.CreateDirectory(RootDirectory);
    }

    /// <summary>The default Site-link root: <c>%ProgramData%\ST4I\sim\sitelink</c> — a SIBLING of
    /// <c>...\sim\settings</c>/<c>...\sim\identity</c>/<c>...\sim\historian</c>/<c>...\sim\creds</c>, never
    /// the same directory as any of those.</summary>
    public static string DefaultRoot() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ST4I", "sim", "sitelink");

    /// <summary>Resolves the effective Site-link directory: <paramref name="directory"/> if given, else
    /// <see cref="EnvVarDir"/> if set, else <see cref="DefaultRoot"/>. Pure path arithmetic — does not
    /// create anything on disk (the ctor does that).</summary>
    public static string ResolveRoot(string? directory = null)
    {
        if (!string.IsNullOrWhiteSpace(directory)) return directory;
        var env = Environment.GetEnvironmentVariable(EnvVarDir);
        return string.IsNullOrWhiteSpace(env) ? DefaultRoot() : env;
    }

    /// <summary>The persisted Site link, or null if <c>site-link.json</c> doesn't exist yet (fresh install
    /// / never configured) or is corrupt — tolerated, never throws. Either way the caller (
    /// <see cref="SiteBridgeManager"/>'s startup call) falls back to a fresh <see cref="PersistedSiteLink"/>
    /// (<see cref="PersistedSiteLink.Enabled"/> = <see langword="false"/> by default), i.e. standalone.</summary>
    public PersistedSiteLink? Load()
    {
        lock (_gate)
        {
            var path = Path.Combine(RootDirectory, FileName);
            if (!File.Exists(path)) return null;

            try
            {
                return JsonSerializer.Deserialize<PersistedSiteLink>(File.ReadAllText(path), PersistenceOptions);
            }
            catch (JsonException)
            {
                return null;
            }
        }
    }

    /// <summary>Overwrites the persisted Site link. <see cref="SiteBridgeManager.ApplyAsync"/> is the only
    /// production caller, on every operator-driven change so it survives a restart.</summary>
    public void Save(PersistedSiteLink link)
    {
        ArgumentNullException.ThrowIfNull(link);
        lock (_gate)
        {
            var path = Path.Combine(RootDirectory, FileName);
            var json = JsonSerializer.Serialize(link, PersistenceOptions);
            WriteAllTextAtomic(path, json);
        }
    }

    /// <summary>Same crash-safety rationale as <see cref="Config.FleetSettingsStore"/>'s own copy of this
    /// method — writes to a temp file in the same directory then atomically renames over the real
    /// target.</summary>
    private static void WriteAllTextAtomic(string path, string content)
    {
        var tempPath = path + ".tmp-" + Guid.NewGuid().ToString("N");
        File.WriteAllText(tempPath, content);
        File.Move(tempPath, path, overwrite: true);
    }
}
