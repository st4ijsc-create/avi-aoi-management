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
/// 🔴 Task V-1 — what a read of <c>oee-settings.json</c> found. THREE outcomes. The full statement of the
/// property, of why several causes are one outcome, and of why the absent case is the only one that
/// entitles a caller to write, is on <see cref="Config.FleetSettingsReadStatus"/> and is not restated here.
///
/// <para>This is the third such type in the product and the third is what settled the shape: Q-1 built two
/// near-identical ones and named sharing them as the better structure it had no mandate to take. V-1 has no
/// mandate to take it either — it is a refactor of two shipped, reviewed arms — so the note is carried
/// forward rather than dropped. Whoever generalises them has three call sites now, not two.</para>
/// </summary>
public enum OeeSettingsReadStatus
{
    /// <summary>A file was opened and produced a list of entries. <c>Entries</c> is non-null (possibly
    /// empty — an operator, or an earlier run, may have deliberately stored nothing).</summary>
    Loaded,

    /// <summary>There is nothing at the path — the open itself reported the file, or the directory holding
    /// it, missing. The ONLY outcome that entitles a caller to establish its own value.</summary>
    Absent,

    /// <summary>Something is at the path and this read could not turn it into entries. On this file the
    /// content is every machine's ideal-cycle override and planned-production ratio, and the unreadable
    /// bytes are the last surviving record of them.</summary>
    Unreadable,
}

/// <summary>
/// 🔴 Task V-1 fix round — thrown by <see cref="OeeSettingsStore.Set"/> when writing would put the store's
/// in-memory table over bytes this process has not successfully read.
///
/// <para><b>Why a type rather than a bare <see cref="InvalidOperationException"/> (review M-1).</b> The
/// endpoint that answers <c>409</c> has to catch exactly this condition and no other, because its response
/// asserts <i>"the file was NOT overwritten"</i> — a claim about what did not happen. A catch of
/// <see cref="InvalidOperationException"/> is wider than that claim:
/// <see cref="ObjectDisposedException"/> derives from it, and so would anything a future statement inside
/// the same <c>try</c> happened to throw. Then the assertion in the response would be a hope. With a type it
/// is a property. It still DERIVES from <see cref="InvalidOperationException"/>, so a caller that only wants
/// "the store refused" keeps working.</para>
/// </summary>
public sealed class OeeSettingsUnreadableException : InvalidOperationException
{
    internal OeeSettingsUnreadableException(string filePath, string message, Exception? inner)
        : base(message, inner)
    {
        FilePath = filePath;
    }

    /// <summary>The file the refusal is about, so a caller can name it without restating the store's
    /// private file-name constant.</summary>
    public string FilePath { get; }
}

/// <summary>🔴 Task V-1 — the outcome of one <see cref="OeeSettingsStore.Read"/> call.</summary>
public sealed class OeeSettingsRead
{
    private OeeSettingsRead(
        OeeSettingsReadStatus status, IReadOnlyList<OeeMachineSettings>? entries, string filePath,
        string? reason, Exception? failure)
    {
        Status = status;
        Entries = entries;
        FilePath = filePath;
        Reason = reason;
        Failure = failure;
    }

    /// <summary>Which of the three outcomes this read reached.</summary>
    public OeeSettingsReadStatus Status { get; }

    /// <summary>The entries, non-null exactly when <see cref="Status"/> is
    /// <see cref="OeeSettingsReadStatus.Loaded"/>.</summary>
    public IReadOnlyList<OeeMachineSettings>? Entries { get; }

    /// <summary>The full path this read attempted, so a caller can name the file in a message without
    /// restating this store's private file-name constant.</summary>
    public string FilePath { get; }

    /// <summary>A short description of why <see cref="OeeSettingsReadStatus.Unreadable"/> was reached,
    /// non-null exactly on that outcome — including on the shape that produces no exception at all (a file
    /// whose JSON is well-formed and deserializes to nothing).</summary>
    public string? Reason { get; }

    /// <summary>The exception the read failed with, when there was one. Nullable EVEN ON
    /// <see cref="OeeSettingsReadStatus.Unreadable"/>, for the same reason as
    /// <see cref="Config.FleetSettingsRead.Failure"/>.</summary>
    public Exception? Failure { get; }

    internal static OeeSettingsRead ForLoaded(string filePath, IReadOnlyList<OeeMachineSettings> entries) =>
        new(OeeSettingsReadStatus.Loaded, entries, filePath, null, null);

    internal static OeeSettingsRead ForAbsent(string filePath) =>
        new(OeeSettingsReadStatus.Absent, null, filePath, null, null);

    internal static OeeSettingsRead ForUnreadable(string filePath, string reason, Exception? failure = null) =>
        new(OeeSettingsReadStatus.Unreadable, null, filePath, reason, failure);
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
///
/// <para>🔴 <b>Task V-1 — an unreadable file is a THIRD state here too, and the sentence that used to stand
/// in its place was false.</b> <see cref="Load"/> caught <see cref="JsonException"/> and started from an
/// empty store — byte-for-byte the in-memory state it reaches when the file is not there — and
/// <see cref="Set"/> then wrote that state back over the file, so an operator's whole table was replaced by
/// whatever single entry the next <c>PUT /v1/historian/oee/settings</c> carried, with no exception, no log
/// line and no returned status. The one reason recorded for it was <i>"mirrors
/// <see cref="Config.MachineConfigStore"/>/<see cref="Config.ProductConfigStore"/>'s 'never throw out of the
/// constructor over a bad file' stance"</i>, and that is measurably wrong in both directions: both of those
/// stores DO throw over a bad file (<c>OperatorDataRemovalCensusTests.ExpectedPostures</c> pins it), and
/// neither of them writes on the failure arm, which is the half that made this one destructive.</para>
///
/// <para><b>What it does now, and why this arm rather than throwing.</b> The read answers
/// <see cref="OeeSettingsReadStatus.Unreadable"/>; the store comes up empty so every reader keeps working on
/// the documented defaults; and <see cref="Set"/> — the only writer — REFUSES, naming the file and saying it
/// was not overwritten. Throwing from the constructor instead would take down every endpoint that resolves
/// this store over two optional per-machine inputs, and the loss is nameable without doing that: the caller
/// that would have destroyed the file is told at the moment it would have destroyed it. That is
/// <c>docs/startup-failure-posture.md</c> §1's test applied one statement earlier, and it yields the same
/// answer it yielded at <c>fleet-settings.json</c> and <c>site-link.json</c>.</para>
///
/// <para>🔴 <b>WHEN the refusal is decided, because V-1's FIRST ROUND closed the wrong moment and named that
/// nowhere (review I-3).</b> Round one gated <see cref="Set"/> on a classification the CONSTRUCTOR had
/// cached, so what shipped was <i>"the file was unreadable when this store was built"</i>. A host running on
/// a good file, an operator hand-editing it into invalid JSON — the very repair this store's own message
/// asks for — and one <c>PUT</c> afterwards still overwrote the operator's bytes silently: no throw, no 409,
/// no log line. Same harm, same store, same mutator, one moment later, and <b>no instrument in the tree
/// could see it</b>, because Reach C only ever constructs a store over an <i>already-corrupt</i> directory.
/// <see cref="Set"/> now takes its own read, under the same lock, immediately before it writes.</para>
///
/// <para><b>WHAT THAT STILL DOES NOT REACH, named rather than left to be found.</b> The read and the write
/// are one critical section in THIS process, so nothing here can interleave — but this store holds no lock
/// on the file itself. Another process (or a hand editor) replacing the file with <i>other valid</i> content
/// between that read and that write loses it to the whole-file rewrite. That is a LOST UPDATE, not this
/// law's situation — the bytes were readable — and this store's single-writer contract is pinned in
/// <c>OperatorDataRemovalCensusTests</c>. It is written here because the first round's ceiling being
/// unstated is the entire reason this paragraph exists.</para>
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
    private readonly Action<Exception?, string>? _logError;

    /// <summary>What this store last established about the file — written by EVERY read, and by a write it
    /// completed itself.</summary>
    private OeeSettingsReadStatus _status = OeeSettingsReadStatus.Absent;
    private string? _unreadableReason;
    private Exception? _unreadableFailure;

    /// <summary>🔴 Task V-1 fix round — the status of the read <see cref="_settings"/> was BUILT FROM, which
    /// is a different fact from <see cref="_status"/> and is the one that licenses a write.
    ///
    /// <para>Keeping them apart is what stops the fix round opening a hole while closing one. A file that was
    /// <see cref="OeeSettingsReadStatus.Unreadable"/> at load and has since been REPAIRED reads
    /// <c>Loaded</c> on the freshest read — while the in-memory table is still EMPTY, so writing it would
    /// discard the repair. One field could not express both, and re-reading alone would have turned
    /// "refuses" into "overwrites the repair".</para></summary>
    private OeeSettingsReadStatus _tableBuiltFrom = OeeSettingsReadStatus.Absent;

    /// <summary>Directory holding <c>oee-settings.json</c>.</summary>
    public string RootDirectory { get; }

    /// <summary>The full path of the file this store reads and writes.</summary>
    public string SettingsFilePath => Path.Combine(RootDirectory, FileName);

    /// <summary>🔴 Task V-1 — <b>what this store last established about the file on disk</b>: the outcome of
    /// its most recent read, or <see cref="OeeSettingsReadStatus.Loaded"/> after a write it completed itself.
    ///
    /// <para>🔴 <b>Fix round: this said "the most recent read" and was false twice over, on the member the
    /// whole refusal hangs on (review M-2).</b> The field was written only by the constructor and by
    /// <see cref="Reload"/>, so <see cref="Read"/> — the public method whose name IS the read — left it
    /// stale. Making every read record what it saw exposed the second half: a successful <see cref="Set"/>
    /// over an empty directory then left it at <see cref="OeeSettingsReadStatus.Absent"/>, describing a
    /// moment that no longer existed. Both are closed, and the predicate is widened to what is true rather
    /// than narrowed to what was convenient.</para>
    ///
    /// <para><b>This is NOT the whole condition <see cref="Set"/> refuses on</b>, and a caller must not treat
    /// it as one: <see cref="Set"/> also refuses when the in-memory table was built from an unreadable read
    /// that has since been repaired, a state in which this property reads <c>Loaded</c>. Catch
    /// <see cref="OeeSettingsUnreadableException"/> rather than pre-testing this.</para></summary>
    public OeeSettingsReadStatus Status
    {
        get { lock (_gate) { return _status; } }
    }

    /// <summary>Why the file could not be read, non-null exactly when <see cref="Status"/> is
    /// <see cref="OeeSettingsReadStatus.Unreadable"/>.</summary>
    public string? UnreadableReason
    {
        get { lock (_gate) { return _unreadableReason; } }
    }

    /// <param name="directory">Defaults to the same <c>%ProgramData%\ST4I\sim\historian</c> folder
    /// <see cref="SqliteHistorianStore"/> resolves <c>historian.db</c> from (see
    /// <see cref="Infrastructure.CredentialStore"/>'s own <c>%ProgramData%</c> root convention) — so an
    /// operator/backup tool finds every historian-adjacent file in one place. Tests pass a temp
    /// directory so runs don't share state.</param>
    /// <param name="logError">🔴 Task V-1 — where an unreadable file is reported, once, at construction.
    /// Same optional-callback idiom as <see cref="Identity.DeviceIdentityStore"/>/<c>AlarmStore</c>/
    /// <see cref="Site.BridgeSpool"/>. The exception is nullable because one shape of Unreadable produces
    /// none (legal JSON that deserializes to nothing); <see cref="OeeSettingsRead.Reason"/> is always
    /// present, which is why the message carries the reason and the exception is only extra.</param>
    public OeeSettingsStore(string? directory = null, Action<Exception?, string>? logError = null)
    {
        RootDirectory = string.IsNullOrWhiteSpace(directory) ? DefaultRoot() : directory;
        Directory.CreateDirectory(RootDirectory);
        _logError = logError;
        Load();

        if (_status == OeeSettingsReadStatus.Unreadable)
        {
            _logError?.Invoke(
                _unreadableFailure,
                $"OEE SETTINGS FILE COULD NOT BE READ — \"{SettingsFilePath}\" is present and this process " +
                $"could not turn it into per-machine OEE settings ({_unreadableReason}). It was NOT applied " +
                "and it will NOT be overwritten: every machine's ideal-cycle override and planned-production " +
                "ratio are recorded nowhere else, so the unreadable bytes are the only remaining record of " +
                "them. OEE is being reported on the built-in defaults (no override, ratio 1.0) for every " +
                "machine, and PUT /v1/historian/oee/settings will be REFUSED until the file is repaired or " +
                "moved aside.");
        }
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
    /// settings after the change.
    ///
    /// <para>🔴 <b>Task V-1 — REFUSES while <see cref="Status"/> is
    /// <see cref="OeeSettingsReadStatus.Unreadable"/>, with <see cref="InvalidOperationException"/>.</b> This
    /// is the only writer of <c>oee-settings.json</c> in the product and it writes the WHOLE table, so
    /// performing one machine's update over bytes this process never managed to read replaces every other
    /// machine's entry with nothing. The refusal is checked AFTER the range guardrails and BEFORE any
    /// mutation, so the ordering contract above still holds: a refused call leaves the store and the file
    /// exactly as they were. Repair or move the file aside and construct the store again (in production, a
    /// restart) — there is no in-product override, deliberately, because an override is a licence to
    /// overwrite.</para></summary>
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
            // 🔴 TASK V-1 FIX ROUND (review I-3) — THE READ IS TAKEN HERE, NOT INHERITED FROM CONSTRUCTION.
            // Round one gated this on a field the constructor wrote, so the delivered guarantee was "the
            // file was unreadable when this store was built" rather than "...is unreadable now". A host
            // running on a good file, an operator hand-editing that file into invalid JSON — which is what
            // the refusal message itself tells them to go and do — and then one PUT, wrote the in-memory
            // table straight over the operator's just-typed bytes with no throw, no 409 and no log line.
            // Nothing in the tree could see it: Reach C only ever constructs a store over an ALREADY-corrupt
            // directory, so the census is blind to corruption that arrives after construction.
            var fresh = ClassifyLocked();

            // TWO conditions, and they are different facts rather than belt and braces.
            //   * `fresh` is about the FILE right now: bytes are there and this process cannot use them.
            //   * `_tableBuiltFrom` is about the TABLE: it was built from a read that failed, so it is empty
            //     and does not represent the file. If the operator has since REPAIRED the file, `fresh` says
            //     Loaded and writing would discard the repair — so this arm keeps refusing, exactly as round
            //     one did, and Reload() is the way out. Re-reading WITHOUT this condition would have closed
            //     one hole by opening another.
            if (fresh.Status == OeeSettingsReadStatus.Unreadable ||
                _tableBuiltFrom == OeeSettingsReadStatus.Unreadable)
            {
                throw new OeeSettingsUnreadableException(
                    SettingsFilePath,
                    fresh.Status == OeeSettingsReadStatus.Unreadable
                        ? $"\"{SettingsFilePath}\" is present and this process could not read it " +
                          $"({fresh.Reason}). The file was NOT overwritten: it holds every machine's " +
                          "ideal-cycle override and planned-production ratio and is the only record of " +
                          "them, so writing one machine's values over it would discard the rest. Repair " +
                          "the file or move it aside and restart, then set the value again."
                        : $"\"{SettingsFilePath}\" could not be read when this process loaded it, so the " +
                          "in-memory OEE settings are EMPTY and do not represent the file. The file reads " +
                          "correctly again now, which means writing the empty table over it would discard " +
                          "whatever repaired it. Nothing was overwritten. Restart the host (or call " +
                          "Reload) so the repaired file is loaded, then set the value again.",
                    fresh.Failure);
            }

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

            // 🔴 A write establishes the same fact a read would, and leaving these stale would reintroduce
            // review M-2 one statement later: after a successful Set over a directory that had NO file, the
            // freshest classification was `Absent` — describing a moment that no longer exists, on the
            // public member the refusal hangs on. The file now exists and holds exactly this table, so both
            // are `Loaded` by construction rather than by a read nobody took.
            _status = OeeSettingsReadStatus.Loaded;
            _tableBuiltFrom = OeeSettingsReadStatus.Loaded;
            _unreadableReason = null;
            _unreadableFailure = null;

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

    /// <summary>
    /// 🔴 <b>Task V-1 — the three-outcome read, and the ONLY read a caller may use to decide whether it is
    /// entitled to write.</b> Same construction and the same reasoning as
    /// <see cref="Config.FleetSettingsStore.Read"/>: there is no existence probe, because two surfaces
    /// answering one question can disagree and on this runtime they measurably do
    /// (<c>docs/startup-failure-posture.md</c> §3.1a); the open itself is the classifier, and only the
    /// filesystem's own missing-file / missing-directory answers mean <i>absent</i>. The catch of
    /// <see cref="Exception"/> is the safe direction for the same reason — being wrong about an enumerated
    /// list of I/O failure types means falling through to the one outcome that licenses an overwrite.
    ///
    /// <para>Well-formed JSON that deserializes to nothing is Unreadable, not Absent — a file exists and it
    /// did not produce entries. An EMPTY ARRAY is <see cref="OeeSettingsReadStatus.Loaded"/> with no
    /// entries, which is a different thing and is the shape an operator who cleared the table leaves.</para>
    /// </summary>
    public OeeSettingsRead Read()
    {
        lock (_gate)
        {
            return ClassifyLocked();
        }
    }

    /// <summary>Reads, and RECORDS what the read answered. Every path that reads the file goes through here,
    /// which is what makes <see cref="Status"/>'s sentence a property. It deliberately does NOT touch
    /// <see cref="_tableBuiltFrom"/>: only <see cref="Load"/> rebuilds the table, so only <see cref="Load"/>
    /// may say what the table came from.</summary>
    private OeeSettingsRead ClassifyLocked()
    {
        var read = ReadLocked();
        _status = read.Status;
        _unreadableReason = read.Reason;
        _unreadableFailure = read.Failure;
        return read;
    }

    private OeeSettingsRead ReadLocked()
    {
        var path = SettingsFilePath;

        string text;
        try
        {
            text = File.ReadAllText(path);
        }
        catch (FileNotFoundException)
        {
            return OeeSettingsRead.ForAbsent(path);
        }
        catch (DirectoryNotFoundException)
        {
            return OeeSettingsRead.ForAbsent(path);
        }
        catch (Exception ex)
        {
            return OeeSettingsRead.ForUnreadable(
                path, $"the file could not be opened or read ({ex.GetType().Name}: {ex.Message})", ex);
        }

        List<OeeMachineSettings>? entries;
        try
        {
            entries = JsonSerializer.Deserialize<List<OeeMachineSettings>>(text, PersistenceOptions);
        }
        catch (JsonException ex)
        {
            return OeeSettingsRead.ForUnreadable(
                path, $"the file's contents are not valid OEE settings JSON ({ex.Message})", ex);
        }

        return entries is not null
            ? OeeSettingsRead.ForLoaded(path, entries)
            : OeeSettingsRead.ForUnreadable(path, "the file parsed as JSON but produced no settings list");
    }

    /// <summary>Always called with <see cref="_gate"/> already held, or from the constructor before this
    /// instance is published to any other thread.</summary>
    private void Load()
    {
        var read = ClassifyLocked();
        _tableBuiltFrom = read.Status;

        if (read.Entries is null) return;

        foreach (var entry in read.Entries)
        {
            if (string.IsNullOrEmpty(entry.MachineCode)) continue;
            _settings[entry.MachineCode] = entry;
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
