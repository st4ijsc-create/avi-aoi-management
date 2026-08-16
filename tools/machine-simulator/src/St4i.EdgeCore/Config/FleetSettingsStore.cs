using System.Text.Json;

namespace St4i.EdgeCore.Config;

/// <summary>
/// Persisted snapshot of <c>FleetHost</c>'s connection identity — serverUrl/machineCode/verifyTls ONLY.
/// A plain data record; validation (if any) happens at the caller (<c>FleetHost.UpdateSettings</c>), which
/// is the only writer and only ever hands in values it has already accepted. Deliberately has NO field for
/// an mk_ key or any other secret — those stay exactly where they already live, DPAPI-encrypted in
/// <see cref="Infrastructure.CredentialStore"/> — and no field for <c>language</c> either, since that is a
/// pure UI/display preference FleetHost never uses to decide what to connect to.
/// </summary>
public sealed class PersistedFleetSettings
{
    public string ServerUrl { get; set; } = "";
    public string MachineCode { get; set; } = "";
    public bool VerifyTls { get; set; } = true;
}

/// <summary>
/// 🔴 Task Q-1 — <b>what a read of <c>fleet-settings.json</c> found. THREE outcomes, and the third one is
/// why this type exists.</b>
///
/// <para>Before Q-1 the read answered two things — a triple, or <see langword="null"/> — and
/// <see langword="null"/> covered two situations that must never be handled the same way: <i>there is
/// nothing on disk</i> and <i>there is something on disk that this process could not turn into a triple</i>.
/// A caller that cannot tell those apart is entitled to establish a value of its own in both, and doing that
/// in the second one replaces the last surviving record of a decision somebody made with a value the caller
/// invented.</para>
///
/// <para><b>Why one member covers a population whose causes differ.</b> A file can fail to become a triple
/// because its bytes are not the shape expected (bad syntax, an empty file, a run of NULs, a literal
/// <c>null</c>), or because this process cannot reach its bytes at all right now (a share-mode lock, a
/// withheld access right, a device error). Those are not one cause and they are not repaired the same way.
/// They are one member here because they create <b>one obligation</b>: do not write, do not proceed as
/// though nothing was configured, and put the fact where somebody looks. A reader also cannot reliably tell
/// them apart — which is the second reason splitting them would buy a distinction nobody could act on.</para>
/// </summary>
public enum FleetSettingsReadStatus
{
    /// <summary>A file was opened and produced a settings triple. <c>Settings</c> is non-null.</summary>
    Loaded,

    /// <summary>There is nothing at the path — the open itself reported the file, or the directory holding
    /// it, missing. This is the ONLY outcome that entitles a caller to establish its own value, and it is
    /// answered by the read attempt rather than by a separate existence probe (see
    /// <see cref="FleetSettingsStore.Read"/> for why that distinction is load-bearing).</summary>
    Absent,

    /// <summary>Something is at the path and this read could not turn it into a triple. Nothing about the
    /// bytes on disk is known except that they are still there, so they are the last surviving record of
    /// what was configured.</summary>
    Unreadable,
}

/// <summary>🔴 Task Q-1 — the outcome of one <see cref="FleetSettingsStore.Read"/> call.</summary>
public sealed class FleetSettingsRead
{
    private FleetSettingsRead(
        FleetSettingsReadStatus status, PersistedFleetSettings? settings, string filePath, string? reason,
        Exception? failure)
    {
        Status = status;
        Settings = settings;
        FilePath = filePath;
        Reason = reason;
        Failure = failure;
    }

    /// <summary>Which of the three outcomes this read reached.</summary>
    public FleetSettingsReadStatus Status { get; }

    /// <summary>The triple, non-null exactly when <see cref="Status"/> is
    /// <see cref="FleetSettingsReadStatus.Loaded"/>.</summary>
    public PersistedFleetSettings? Settings { get; }

    /// <summary>The full path this read attempted. Carried here so a caller can name the file in a message
    /// without restating this store's private file-name constant — the same reason
    /// <see cref="FleetSettingsStore.Delete"/> lives on the store rather than at its call site.</summary>
    public string FilePath { get; }

    /// <summary>A short description of why <see cref="FleetSettingsReadStatus.Unreadable"/> was reached,
    /// non-null exactly on that outcome. Always present there, including on the one shape that produces no
    /// exception at all (a file whose JSON is well-formed and deserializes to nothing).</summary>
    public string? Reason { get; }

    /// <summary>The exception the read failed with, when there was one. 🔴 Nullable EVEN ON
    /// <see cref="FleetSettingsReadStatus.Unreadable"/>: a file holding the four bytes <c>null</c> is
    /// well-formed JSON that deserializes to no object, so that shape reaches Unreadable without throwing.
    /// Use <see cref="Reason"/> when a message must always say something; use this when a logger can take
    /// an exception.</summary>
    public Exception? Failure { get; }

    internal static FleetSettingsRead ForLoaded(string filePath, PersistedFleetSettings settings) =>
        new(FleetSettingsReadStatus.Loaded, settings, filePath, null, null);

    internal static FleetSettingsRead ForAbsent(string filePath) =>
        new(FleetSettingsReadStatus.Absent, null, filePath, null, null);

    internal static FleetSettingsRead ForUnreadable(string filePath, string reason, Exception? failure = null) =>
        new(FleetSettingsReadStatus.Unreadable, null, filePath, reason, failure);
}

/// <summary>
/// FF-1 (docs/plans/2026-07-27-ws-ff-fast-follows.md) — edge-local, JSON-file-backed store for
/// <c>FleetHost</c>'s serverUrl/machineCode/verifyTls, so a runtime <c>PUT /v1/settings</c> change
/// survives a process restart. Before this task, WS-F1 only seeded these three fields from the
/// <c>ST4I_SERVER_URL</c>/<c>ST4I_MACHINE_CODE</c>/<c>ST4I_VERIFY_TLS</c> env vars at startup — real, but
/// a genuine operator edit made through the Settings UI/API afterward was still purely in-memory
/// (<c>FleetCore</c>'s <c>_serverUrl</c>/<c>_machineCode</c>/<c>_verifyTls</c> fields, behind the
/// <c>FleetHost</c> shell) and reverted to
/// whatever the env vars (or <c>FleetHost.DefaultServerUrl</c>/<c>DefaultMachineCode</c>, absent even
/// those) said on the very next restart.
///
/// Same atomic-JSON idiom as <see cref="MachineConfigStore"/>/<see cref="Historian.OeeSettingsStore"/>:
/// a single coarse lock, deep-clone-free (this record has no nested mutable collections to alias, unlike
/// those two), whole-file rewrite via a temp-file-then-<see cref="File.Move(string, string, bool)"/>
/// atomic write, so a crash mid-write leaves <c>fleet-settings.json</c> as either the complete old content
/// or the complete new content, never a partial write.
///
/// <para><b>Precedence</b> (see <c>Program.cs</c>'s startup wiring and <c>FleetHost</c>'s own remarks on
/// <c>_settingsStore</c>): on startup, if <c>fleet-settings.json</c> exists it is the source of truth for
/// serverUrl/machineCode/verifyTls — the <c>ST4I_SERVER_URL</c>/<c>ST4I_MACHINE_CODE</c>/
/// <c>ST4I_VERIFY_TLS</c> env vars (WS-F1) are only ever a FLOOR, applied exclusively when NO persisted
/// file exists yet (a brand-new install, or one where an operator has deleted the file to fall back to
/// the floor again). Once any of the three has ever been set — via a real operator
/// <c>PUT /v1/settings</c>, OR via that very first env-seeded boot itself (<c>FleetHost.UpdateSettings</c>
/// persists unconditionally whenever any of the three changes, not just for a "real" operator call) — this
/// file wins on every subsequent restart, env vars included. This is the RECOMMENDED ordering from the
/// FF-1 plan: env is a floor/initial default, a persisted runtime change overrides it so an operator's PUT
/// sticks.</para>
///
/// <para>🔴 <b>Q-1 sharpens exactly one word in that paragraph: "exists".</b> The floor applies when this
/// store's slot on disk is <b>empty</b> — <see cref="FleetSettingsReadStatus.Absent"/> — and NOT merely
/// when a read failed to produce a triple. A file that is present but could not be read is neither the
/// floor's case nor the file's case: see <see cref="Read"/>, and see the composition root's own arm for
/// what it does instead.</para>
/// </summary>
public sealed class FleetSettingsStore
{
    /// <summary>Relocates the whole store — same "ops can point a deployment at a different disk/volume;
    /// tests get a throwaway root instead of polluting %ProgramData%" rationale as
    /// <c>ST4I_HISTORIAN_DIR</c>/<c>ST4I_SECURITY_DIR</c> (that one lives on
    /// <c>St4i.EngineApi.Auth.SecurityDb</c>, a different project — mentioned here only for the
    /// convention, not a compile-time reference).</summary>
    public const string EnvVarDir = "ST4I_SETTINGS_DIR";

    private const string FileName = "fleet-settings.json";

    private static readonly JsonSerializerOptions PersistenceOptions = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true,
    };

    private readonly object _gate = new();

    /// <summary>Directory holding <c>fleet-settings.json</c>.</summary>
    public string RootDirectory { get; }

    /// <param name="directory">Explicit directory override (tests), or <see langword="null"/> to resolve
    /// via <see cref="ResolveRoot"/> (<see cref="EnvVarDir"/>, then <see cref="DefaultRoot"/>).</param>
    public FleetSettingsStore(string? directory = null)
    {
        RootDirectory = ResolveRoot(directory);
        Directory.CreateDirectory(RootDirectory);
    }

    /// <summary>The default settings root: <c>%ProgramData%\ST4I\sim\settings</c> — a SIBLING of
    /// <c>...\sim\historian</c>/<c>...\sim\wal</c>/<c>...\sim\creds</c>/<c>...\sim\security</c>, never the
    /// same directory as any of those (in particular never <c>...\sim\creds</c> — this file only ever
    /// holds non-secret fields, but a physically separate directory keeps that invariant obvious on disk
    /// too, not just in code).</summary>
    public static string DefaultRoot() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ST4I", "sim", "settings");

    /// <summary>Resolves the effective settings directory: <paramref name="directory"/> if given, else
    /// <see cref="EnvVarDir"/> if set, else <see cref="DefaultRoot"/>. Pure path arithmetic — does not
    /// create anything on disk (the ctor does that).</summary>
    public static string ResolveRoot(string? directory = null)
    {
        if (!string.IsNullOrWhiteSpace(directory)) return directory;
        var env = Environment.GetEnvironmentVariable(EnvVarDir);
        return string.IsNullOrWhiteSpace(env) ? DefaultRoot() : env;
    }

    /// <summary>
    /// 🔴 <b>Task Q-1 — the three-outcome read, and the ONLY read a caller may use to decide whether it is
    /// entitled to write.</b> See <see cref="FleetSettingsReadStatus"/> for the outcomes and for why the
    /// third one is one member rather than several.
    ///
    /// <para><b>There is no existence probe here any more, and that is the change.</b> This used to open
    /// with <c>File.Exists</c> and return null when it answered false. Two surfaces answering one question
    /// can disagree, and on Windows they measurably do: with read rights withheld on the settings directory
    /// AND on the file, <c>File.Exists</c> answers <b>false</b> while the file is sitting right there —
    /// measured by <c>tools/settings-acl-probe</c> and tabulated in <c>docs/startup-failure-posture.md</c>
    /// §3.1a. The composition root then took the "no file" branch with the operator's file present. Opening
    /// the file and classifying what the open says removes the second surface entirely: the only answers
    /// that mean <i>there is nothing here</i> are the two the filesystem gives for a missing file or a
    /// missing directory, and they come from the same call that would have read it.</para>
    ///
    /// <para><b>The catch of <see cref="Exception"/> is deliberate and it is the safe direction.</b> An
    /// enumerated list of I/O failure types is a closed claim about a set nobody controls, and the cost of
    /// that claim being wrong is falling through to <see cref="FleetSettingsReadStatus.Absent"/> — the one
    /// outcome that licenses a caller to overwrite. Two derived types are matched first because they carry
    /// the opposite meaning; everything else is treated as <i>something is there and I could not read
    /// it</i>, which destroys nothing whatever it turns out to be.</para>
    ///
    /// <para>Well-formed JSON that deserializes to no object is Unreadable, not Absent: a file exists and it
    /// did not produce a triple, which is exactly the third outcome regardless of the bytes being legal.</para>
    /// </summary>
    public FleetSettingsRead Read()
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
                return FleetSettingsRead.ForAbsent(path);
            }
            catch (DirectoryNotFoundException)
            {
                return FleetSettingsRead.ForAbsent(path);
            }
            catch (Exception ex)
            {
                return FleetSettingsRead.ForUnreadable(
                    path, $"the file could not be opened or read ({ex.GetType().Name}: {ex.Message})", ex);
            }

            PersistedFleetSettings? settings;
            try
            {
                settings = JsonSerializer.Deserialize<PersistedFleetSettings>(text, PersistenceOptions);
            }
            catch (JsonException ex)
            {
                return FleetSettingsRead.ForUnreadable(
                    path, $"the file's contents are not valid settings JSON ({ex.Message})", ex);
            }

            return settings is not null
                ? FleetSettingsRead.ForLoaded(path, settings)
                : FleetSettingsRead.ForUnreadable(
                    path, "the file parsed as JSON but produced no settings object");
        }
    }

    /// <summary>
    /// The persisted settings, or null when <see cref="Read"/> did not reach
    /// <see cref="FleetSettingsReadStatus.Loaded"/> — i.e. <b>null still means two different things</b>, and
    /// that is why this is not the read a caller may write against.
    ///
    /// <para>🔴 <b>Task Q-1 — what this may and may not be used for.</b> It answers "is there a triple to
    /// apply", which is a fair question and the only one its two callers ask. It does NOT answer "is this
    /// store's slot on disk empty", and a caller that reads it as though it did is reproducing the defect
    /// Q-1 closed. Anything that goes on to <see cref="Save"/> or <see cref="Delete"/> must branch on
    /// <see cref="Read"/>.</para>
    ///
    /// <para><b>It no longer throws on an unreadable file</b>, and the one production caller that depends on
    /// that is named here rather than left to be found: <c>FleetCore</c>'s constructor eagerly loads a
    /// persisted triple into its own fields, and it runs BEFORE the composition root's own read. Were this
    /// to throw, an unreadable file would end the process there and the composition root would never reach
    /// the line that reports it. Leaving the fields at their built-in defaults invents nothing, writes
    /// nothing, and lets the report happen a few statements later in the same start.</para>
    /// </summary>
    public PersistedFleetSettings? Load() => Read().Settings;

    /// <summary>Overwrites the persisted settings with the current effective triple.
    /// <c>FleetHost.UpdateSettings</c> is the only caller, and only when at least one of
    /// serverUrl/machineCode/verifyTls actually changed — a <c>language</c>-only edit never reaches
    /// here.</summary>
    public void Save(PersistedFleetSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        lock (_gate)
        {
            var path = Path.Combine(RootDirectory, FileName);
            var json = JsonSerializer.Serialize(settings, PersistenceOptions);
            WriteAllTextAtomic(path, json);
        }
    }

    /// <summary>
    /// 🔴 <b>Whole-branch review I-3 — removes <c>fleet-settings.json</c> if it exists. It has exactly ONE
    /// caller and it is not a general-purpose delete: <c>Program.cs</c>'s startup replay, on the one path
    /// where the replay was a SEED rather than a restore and the seed did not activate.</b>
    ///
    /// <para><b>Why the store owns it rather than the caller.</b> The file name is private here and stays
    /// private; a caller composing <c>Path.Combine(RootDirectory, "fleet-settings.json")</c> would be a
    /// second place that has to move if the name ever changes. Takes the same lock as
    /// <see cref="Save"/>/<see cref="Load"/>, so it cannot interleave with a concurrent write.</para>
    ///
    /// <para><b>It throws.</b> Same posture as <see cref="Save"/> — an <c>IOException</c> here is a real
    /// filesystem problem and swallowing it inside the store would hide it from the one caller that has a
    /// log channel. That caller guards it; see the block at its call site for what a failed delete means
    /// (the seeded file survives, the env vars stop being the floor, and the operator is told).</para>
    ///
    /// <para>🔴 <b>TWO instruments hold "one deleter", and naming the pairing is the point (branch
    /// re-review).</b> The cheap one is a NAMING census in
    /// <c>StartupSettingsReplayHardeningTests.TheStartupReplayHasExactlyOneArm_AndTheSettingsFileOneWriterAndOneDeleter</c>,
    /// and it cannot see <c>new FleetSettingsStore(dir).Delete()</c> or a raw
    /// <c>File.Delete(Path.Combine(root, "fleet-settings.json"))</c> — the same stated non-reach as its
    /// <see cref="Save"/> census. The one that closes it is a PROPERTY witness,
    /// <c>AFailedReplay_LeavesThePersistedTripleIntact_AndDoesNotLetTheEnvFloorWin</c>, which reads the
    /// operator's file back through a separate store instance and therefore fails on a deleter of ANY
    /// shape. Two instruments, two questions — deliberately not one heavier guard, which would buy
    /// nothing the property witness does not already hold.</para>
    /// </summary>
    /// <remarks>🔴 <b>Q-1 removed the <c>File.Exists</c> gate this used to open with</b>, for the reason
    /// <see cref="Read"/> gives at length: a second surface can disagree with the operation it is guarding,
    /// and here it measurably did — with read rights withheld on both the directory and the file, that gate
    /// answered false and this became a NO-OP while the caller went on to log that the file had been
    /// removed. <see cref="File.Delete(string)"/> is already a no-op for a file that is not there, so the
    /// gate bought nothing and cost a false report. A missing DIRECTORY is swallowed for the same reason it
    /// was before: there is nothing to remove. Every other failure still propagates to the one caller, which
    /// has a log channel and uses it.
    ///
    /// <para>🔴 <b>AND SAY THE OTHER HALF, HERE RATHER THAN AT THE CALL SITE: this method is now STRICTLY
    /// MORE DESTRUCTIVE IN ISOLATION.</b> Under the measured both-objects-denied ACL the old gate answered
    /// false and this silently did nothing; it now actually deletes. That is only safe because of something
    /// this method cannot see — its single caller in <c>Program.cs</c> is gated on
    /// <see cref="FleetSettingsReadStatus.Absent"/>, so by the time it runs the only file that can be on
    /// disk is one that same start wrote. <b>Anyone adding a second caller must reproduce that gate</b>, and
    /// a caller that reaches this on any other outcome is deleting an operator's file. The census in
    /// <c>StartupSettingsReplayHardeningTests</c> asserts that there is exactly ONE caller; nothing asserts
    /// what that caller is gated on, so this paragraph is the guard, and it is deliberately written where
    /// the capability lives rather than where today's one use of it happens to be.</para></remarks>
    public void Delete()
    {
        lock (_gate)
        {
            var path = Path.Combine(RootDirectory, FileName);
            try
            {
                File.Delete(path);
            }
            catch (DirectoryNotFoundException)
            {
                // Nothing to remove: the directory holding it is not there either.
            }
        }
    }

    /// <summary>Same crash-safety rationale as <see cref="MachineConfigStore"/>/
    /// <see cref="Historian.OeeSettingsStore"/>'s own copy of this method — writes to a temp file in the
    /// same directory then atomically renames over the real target.</summary>
    private static void WriteAllTextAtomic(string path, string content)
    {
        var tempPath = path + ".tmp-" + Guid.NewGuid().ToString("N");
        File.WriteAllText(tempPath, content);
        File.Move(tempPath, path, overwrite: true);
    }
}
