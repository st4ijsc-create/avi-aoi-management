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
/// FF-1 (docs/plans/2026-07-27-ws-ff-fast-follows.md) — edge-local, JSON-file-backed store for
/// <c>FleetHost</c>'s serverUrl/machineCode/verifyTls, so a runtime <c>PUT /v1/settings</c> change
/// survives a process restart. Before this task, WS-F1 only seeded these three fields from the
/// <c>ST4I_SERVER_URL</c>/<c>ST4I_MACHINE_CODE</c>/<c>ST4I_VERIFY_TLS</c> env vars at startup — real, but
/// a genuine operator edit made through the Settings UI/API afterward was still purely in-memory
/// (<c>FleetHost</c>'s <c>_serverUrl</c>/<c>_machineCode</c>/<c>_verifyTls</c> fields) and reverted to
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

    /// <summary>The persisted settings, or null if <c>fleet-settings.json</c> doesn't exist yet (fresh
    /// install / never saved) or is corrupt — tolerated, same "never throw out of a read over a bad file"
    /// stance as <see cref="Historian.OeeSettingsStore"/>/<see cref="MachineConfigStore"/>. Either way the
    /// caller falls back to its own env-var/default floor (see this class's own precedence remarks).</summary>
    public PersistedFleetSettings? Load()
    {
        lock (_gate)
        {
            var path = Path.Combine(RootDirectory, FileName);
            if (!File.Exists(path)) return null;

            try
            {
                return JsonSerializer.Deserialize<PersistedFleetSettings>(File.ReadAllText(path), PersistenceOptions);
            }
            catch (JsonException)
            {
                return null;
            }
        }
    }

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
