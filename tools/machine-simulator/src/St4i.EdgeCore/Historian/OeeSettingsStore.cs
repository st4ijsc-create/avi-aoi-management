using System.Text.Json;

namespace St4i.EdgeCore.Historian;

/// <summary>
/// Per-machine OEE inputs the rest of the data model has no home for: an optional ideal-cycle-time
/// OVERRIDE (null → the caller falls back to whatever <c>MachineDescriptor.CycleSeconds</c> says) and a
/// planned-production ratio (the fraction of calendar time this machine is actually scheduled to run —
/// <see cref="Metrics.OeeCalculator"/>'s "planned production time" input, expressed as a ratio rather than
/// a duration so it composes with any reporting window the caller picks). Fills the gap WS-A-T4's
/// <see cref="Metrics.OeeCalculator"/> needs but that neither <c>MachineDescriptor</c> nor any other store
/// captures today.
/// </summary>
public sealed class OeeMachineSettings
{
    public string MachineCode { get; set; } = "";

    /// <summary>Null → fall back to the caller-supplied ideal cycle (typically
    /// <c>MachineDescriptor.CycleSeconds</c>). Non-null values are always &gt; 0 — <see cref="OeeSettingsStore.Set"/>
    /// rejects (never clamps) anything else.</summary>
    public double? IdealCycleSecondsOverride { get; set; }

    /// <summary>Fraction (0..1) of calendar time this machine is scheduled to run. Defaults to 1.0
    /// (scheduled 100% of the time) for a machine with no stored entry.</summary>
    public double PlannedProductionRatio { get; set; } = 1.0;
}

/// <summary>
/// Edge-local, JSON-file-backed store for <see cref="OeeMachineSettings"/> — one entry per machine, keyed
/// by <see cref="OeeMachineSettings.MachineCode"/>. Mirrors the same atomic-JSON idiom as
/// <see cref="Config.MachineConfigStore"/>/<see cref="Config.ProductConfigStore"/>: a single coarse
/// <c>lock</c>, deep-clone in/out via <see cref="JsonSerializer"/> so a caller can never mutate this
/// store's live state through a returned object, and a whole-file rewrite on every mutation via a
/// temp-file-then-<see cref="File.Move(string, string, bool)"/> atomic write — a crash mid-write leaves
/// <c>oee-settings.json</c> as either the complete old content or the complete new content, never a
/// partial write.
/// <para>
/// Guardrail contract matches <see cref="Config.MachineConfigStore"/>'s: <see cref="Set"/> REJECTS an
/// out-of-range input (throws <see cref="ArgumentOutOfRangeException"/>) rather than silently clamping
/// it, and does so BEFORE touching any in-memory state or the file — a rejected call leaves the store
/// (and the on-disk file) exactly as it was.
/// </para>
/// </summary>
public sealed class OeeSettingsStore
{
    private const string FileName = "oee-settings.json";

    private static readonly JsonSerializerOptions PersistenceOptions = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true,
    };

    private readonly object _gate = new();
    private readonly Dictionary<string, OeeMachineSettings> _settings = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Directory holding <c>oee-settings.json</c>.</summary>
    public string RootDirectory { get; }

    /// <param name="directory">Defaults to the same <c>%ProgramData%\ST4I\sim\historian</c> folder
    /// <see cref="SqliteHistorianStore"/> resolves <c>historian.db</c> from (see
    /// <see cref="Infrastructure.CredentialStore"/>'s own <c>%ProgramData%</c> root convention) — so an
    /// operator/backup tool finds every historian-adjacent file in one place. Tests pass a temp
    /// directory so runs don't share state.</param>
    public OeeSettingsStore(string? directory = null)
    {
        RootDirectory = string.IsNullOrWhiteSpace(directory) ? DefaultRoot() : directory;
        Directory.CreateDirectory(RootDirectory);
        Load();
    }

    private static string DefaultRoot() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ST4I", "sim", "historian");

    /// <summary>Returns the effective settings for <paramref name="machineCode"/>: the stored entry if one
    /// exists (its raw <see cref="OeeMachineSettings.IdealCycleSecondsOverride"/> carried through
    /// as-is — callers compute <c>override ?? fallbackIdealCycleSeconds</c> themselves), else a fresh
    /// default (<c>IdealCycleSecondsOverride = null</c>, <c>PlannedProductionRatio = 1.0</c>).
    /// <paramref name="fallbackIdealCycleSeconds"/> is accepted for symmetry with that caller-side
    /// computation but isn't otherwise used here — it never appears in the returned object.</summary>
    public OeeMachineSettings Resolve(string machineCode, double fallbackIdealCycleSeconds)
    {
        ArgumentException.ThrowIfNullOrEmpty(machineCode);
        _ = fallbackIdealCycleSeconds;

        lock (_gate)
        {
            if (_settings.TryGetValue(machineCode, out var existing))
            {
                return DeepClone(existing);
            }

            return new OeeMachineSettings
            {
                MachineCode = machineCode,
                IdealCycleSecondsOverride = null,
                PlannedProductionRatio = 1.0,
            };
        }
    }

    /// <summary>Persists an override and/or ratio for <paramref name="machineCode"/>, creating the entry
    /// if this is the first time it's been set. Guardrail-checked BEFORE any mutation: a non-null
    /// <paramref name="plannedProductionRatio"/> outside [0,1], or a non-null
    /// <paramref name="idealCycleSecondsOverride"/> that is &lt;= 0, throws
    /// <see cref="ArgumentOutOfRangeException"/> and leaves the store (and the on-disk file) untouched.
    /// A null argument leaves that field unchanged on an existing entry, or takes its type's default for
    /// a brand-new entry (null override stays null; null ratio becomes 1.0). Returns the resolved
    /// settings after the change.</summary>
    public OeeMachineSettings Set(string machineCode, double? idealCycleSecondsOverride, double? plannedProductionRatio)
    {
        ArgumentException.ThrowIfNullOrEmpty(machineCode);

        if (plannedProductionRatio is < 0.0 or > 1.0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(plannedProductionRatio), plannedProductionRatio,
                "plannedProductionRatio must be in the range [0, 1].");
        }

        if (idealCycleSecondsOverride is <= 0.0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(idealCycleSecondsOverride), idealCycleSecondsOverride,
                "idealCycleSecondsOverride must be > 0.");
        }

        lock (_gate)
        {
            if (!_settings.TryGetValue(machineCode, out var existing))
            {
                existing = new OeeMachineSettings
                {
                    MachineCode = machineCode,
                    IdealCycleSecondsOverride = null,
                    PlannedProductionRatio = 1.0,
                };
            }

            var updated = new OeeMachineSettings
            {
                MachineCode = machineCode,
                IdealCycleSecondsOverride = idealCycleSecondsOverride ?? existing.IdealCycleSecondsOverride,
                PlannedProductionRatio = plannedProductionRatio ?? existing.PlannedProductionRatio,
            };

            _settings[machineCode] = updated;
            Save();
            return DeepClone(updated);
        }
    }

    /// <summary>Discards all in-memory state and re-reads <c>oee-settings.json</c> from
    /// <see cref="RootDirectory"/> — the mechanism the restart-survival test uses in-process (a fresh
    /// instance pointed at the same directory is the more realistic "process restarted" case).</summary>
    public void Reload()
    {
        lock (_gate)
        {
            _settings.Clear();
            Load();
        }
    }

    private void Load()
    {
        var path = Path.Combine(RootDirectory, FileName);
        if (!File.Exists(path)) return;

        try
        {
            var loaded = JsonSerializer.Deserialize<List<OeeMachineSettings>>(File.ReadAllText(path), PersistenceOptions);
            if (loaded is null) return;
            foreach (var entry in loaded)
            {
                if (string.IsNullOrEmpty(entry.MachineCode)) continue;
                _settings[entry.MachineCode] = entry;
            }
        }
        catch (JsonException)
        {
            // Missing/corrupt file → tolerate, start from an empty store (mirrors MachineConfigStore/
            // ProductConfigStore's "never throw out of the constructor over a bad file" stance).
        }
    }

    /// <summary>Always called with <see cref="_gate"/> already held.</summary>
    private void Save()
    {
        var path = Path.Combine(RootDirectory, FileName);
        var json = JsonSerializer.Serialize(
            _settings.Values.OrderBy(s => s.MachineCode, StringComparer.OrdinalIgnoreCase).ToList(), PersistenceOptions);
        WriteAllTextAtomic(path, json);
    }

    /// <summary>Same crash-safety rationale as <see cref="Config.MachineConfigStore"/>/
    /// <see cref="Config.ProductConfigStore"/>'s own copy of this method — writes to a temp file in the
    /// same directory then atomically renames over the real target.</summary>
    private static void WriteAllTextAtomic(string path, string content)
    {
        var tempPath = path + ".tmp-" + Guid.NewGuid().ToString("N");
        File.WriteAllText(tempPath, content);
        File.Move(tempPath, path, overwrite: true);
    }

    private static OeeMachineSettings DeepClone(OeeMachineSettings value) =>
        JsonSerializer.Deserialize<OeeMachineSettings>(JsonSerializer.Serialize(value, PersistenceOptions), PersistenceOptions)!;
}
