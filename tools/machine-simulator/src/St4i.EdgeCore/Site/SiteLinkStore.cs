using System.Text.Json;

namespace St4i.EdgeCore.Site;

/// <summary>
/// 🔴 Task Q-1 fix round — what a read of <c>site-link.json</c> found. THREE outcomes, not two. The full
/// statement of the property, of why several causes are one outcome, and of why the absent case is the only
/// one that entitles a caller to write, is on <see cref="Config.FleetSettingsReadStatus"/> and is not
/// restated here.
///
/// <para>🔴 <b>Two near-identical three-outcome types now exist in this assembly, and that is deliberate
/// rather than unnoticed.</b> This store is documented below as an exact copy of
/// <see cref="Config.FleetSettingsStore"/>'s shape, and the copy is what let the defect survive Q-1's first
/// round: the settings store was fixed and its twin was not. Sharing ONE status type across both is the
/// better structure and it is a refactor of code that has already been reviewed and shipped on this branch,
/// so it is named here rather than taken — the fix round's mandate is the twin, not a rework of its
/// sibling. Whoever generalises them should start here.</para>
/// </summary>
public enum SiteLinkReadStatus
{
    /// <summary>A file was opened and produced a Site link. <c>Link</c> is non-null.</summary>
    Loaded,

    /// <summary>There is nothing at the path — the open itself reported the file, or the directory holding
    /// it, missing. The ONLY outcome that entitles a caller to establish its own value.</summary>
    Absent,

    /// <summary>Something is at the path and this read could not turn it into a Site link. On this file the
    /// content includes the Site broker's host, its port and the pinned trust PEM, and the unreadable bytes
    /// are the last surviving record of them.</summary>
    Unreadable,
}

/// <summary>🔴 Task Q-1 fix round — the outcome of one <see cref="SiteLinkStore.Read"/> call.</summary>
public sealed class SiteLinkRead
{
    private SiteLinkRead(
        SiteLinkReadStatus status, PersistedSiteLink? link, string filePath, string? reason, Exception? failure)
    {
        Status = status;
        Link = link;
        FilePath = filePath;
        Reason = reason;
        Failure = failure;
    }

    /// <summary>Which of the three outcomes this read reached.</summary>
    public SiteLinkReadStatus Status { get; }

    /// <summary>The Site link, non-null exactly when <see cref="Status"/> is
    /// <see cref="SiteLinkReadStatus.Loaded"/>.</summary>
    public PersistedSiteLink? Link { get; }

    /// <summary>The full path this read attempted, so a caller can name the file in a message without
    /// restating this store's private file-name constant.</summary>
    public string FilePath { get; }

    /// <summary>A short description of why <see cref="SiteLinkReadStatus.Unreadable"/> was reached, non-null
    /// exactly on that outcome — including on the shape that produces no exception at all (a file whose JSON
    /// is well-formed and deserializes to nothing).</summary>
    public string? Reason { get; }

    /// <summary>The exception the read failed with, when there was one. 🔴 Added in fix round 2 (review N4):
    /// without it this arm's <c>LogError</c> passed no exception while its settings twin passed one, so the
    /// structured exception was dropped on one of two arms built to be identical. Nullable EVEN ON
    /// <see cref="SiteLinkReadStatus.Unreadable"/>, for the same reason as
    /// <see cref="Config.FleetSettingsRead.Failure"/>: a file holding the four bytes <c>null</c> is
    /// well-formed JSON that deserializes to no object, so that shape reaches Unreadable without throwing.
    /// Use <see cref="Reason"/> when a message must always say something.</summary>
    public Exception? Failure { get; }

    internal static SiteLinkRead ForLoaded(string filePath, PersistedSiteLink link) =>
        new(SiteLinkReadStatus.Loaded, link, filePath, null, null);

    internal static SiteLinkRead ForAbsent(string filePath) =>
        new(SiteLinkReadStatus.Absent, null, filePath, null, null);

    internal static SiteLinkRead ForUnreadable(string filePath, string reason, Exception? failure = null) =>
        new(SiteLinkReadStatus.Unreadable, null, filePath, reason, failure);
}

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

    /// <summary>
    /// 🔴 <b>Task Q-1 fix round — the three-outcome read, and the ONLY read a caller may use to decide
    /// whether it is entitled to write.</b> Same construction and the same reasoning as
    /// <see cref="Config.FleetSettingsStore.Read"/>: there is no existence probe, because two surfaces
    /// answering one question can disagree and on this runtime they measurably do; the open itself is the
    /// classifier, and only the filesystem's own missing-file / missing-directory answers mean <i>absent</i>.
    /// The catch of <see cref="Exception"/> is the safe direction for the same reason — an enumerated list
    /// of I/O failure types is a closed claim about a set nobody controls, and being wrong about it means
    /// falling through to the one outcome that licenses an overwrite.
    ///
    /// <para>🔴 <b>Why this store needed it MORE than the settings store did, which is the finding.</b>
    /// The settings overwrite required one of three <c>ST4I_*</c> variables to be set. This one required
    /// nothing: <c>Program.cs</c> called <c>ApplyAsync(Load() ?? new PersistedSiteLink())</c> on the ordinary
    /// startup path, <see cref="SiteBridgeManager.ApplyAsync"/> calls <see cref="Save"/> UNCONDITIONALLY,
    /// and the local UNS spine that gates the whole block is ON by default. So an unreadable
    /// <c>site-link.json</c> was overwritten with <c>Enabled=false, Host="", Port=8883, SiteTrustPem=""</c>
    /// on a start where nothing failed — host, port and the pinned trust anchor gone, the device silently
    /// standalone — and because <see cref="Save"/> SUCCEEDED, the manager's error path never fired and
    /// there was no log line either.</para>
    /// </summary>
    public SiteLinkRead Read()
    {
        lock (_gate)
        {
            var path = Path.Combine(RootDirectory, FileName);

            string text;
            try
            {
                text = File.ReadAllText(path);
            }
            catch (FileNotFoundException)
            {
                return SiteLinkRead.ForAbsent(path);
            }
            catch (DirectoryNotFoundException)
            {
                return SiteLinkRead.ForAbsent(path);
            }
            catch (Exception ex)
            {
                return SiteLinkRead.ForUnreadable(
                    path, $"the file could not be opened or read ({ex.GetType().Name}: {ex.Message})", ex);
            }

            PersistedSiteLink? link;
            try
            {
                link = JsonSerializer.Deserialize<PersistedSiteLink>(text, PersistenceOptions);
            }
            catch (JsonException ex)
            {
                return SiteLinkRead.ForUnreadable(
                    path, $"the file's contents are not a valid Site link ({ex.Message})", ex);
            }

            return link is not null
                ? SiteLinkRead.ForLoaded(path, link)
                : SiteLinkRead.ForUnreadable(path, "the file parsed as JSON but produced no Site link object");
        }
    }

    /// <summary>
    /// The persisted Site link, or null when <see cref="Read"/> did not reach
    /// <see cref="SiteLinkReadStatus.Loaded"/> — i.e. <b>null still means two different things</b>, which is
    /// why this is not the read a caller may write against.
    ///
    /// <para>🔴 <b>Task Q-1 fix round.</b> It answers "is there a Site link to apply". It does NOT answer
    /// "is this store's slot on disk empty". The composition root branches on <see cref="Read"/> instead,
    /// because the arm it selects ends in <see cref="Save"/>. Kept because read-only callers ask the first
    /// question and it is a fair one.</para>
    /// </summary>
    public PersistedSiteLink? Load() => Read().Link;

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
