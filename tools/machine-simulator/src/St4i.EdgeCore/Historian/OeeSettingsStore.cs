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
/// 🔴 Task Z-1 — <b>the whole condition <see cref="OeeSettingsStore.Set"/> refuses on</b>: writing would
/// put this store's in-memory table over a file the table is not a copy of, so the write would discard
/// whatever is on disk. Every refusal <see cref="OeeSettingsStore.Set"/> raises derives from this, and
/// nothing else in the product does.
///
/// <para><b>Why a type rather than a bare <see cref="InvalidOperationException"/> (review M-1, task
/// V-1).</b> The endpoint that answers <c>409</c> has to catch exactly this condition and no other, because
/// its response asserts <i>"the file was NOT overwritten"</i> — a claim about what did not happen. A catch
/// of <see cref="InvalidOperationException"/> is wider than that claim:
/// <see cref="ObjectDisposedException"/> derives from it, and so would anything a future statement inside
/// the same <c>try</c> happened to throw. Then the assertion in the response would be a hope. With a type it
/// is a property. It still DERIVES from <see cref="InvalidOperationException"/>, so a caller that only wants
/// "the store refused" keeps working.</para>
///
/// <para>🔴 <b>Why this base exists at all, and it is a NAME defect that made it necessary.</b> V-1 shipped
/// one type, <see cref="OeeSettingsUnreadableException"/>, and Z-1 adds a second refusal —
/// <see cref="OeeSettingsFileAppearedException"/> — whose file is <b>perfectly readable</b>. Widening the
/// existing type to cover it would have left a published type name asserting <i>unreadable</i> about a case
/// where the read succeeded, which is the defect class P-2 measured at an enum member: a member's spelling
/// is a published string and nothing in this tree reads it as one. So the shared condition gets the shared
/// name, each arm keeps a name that is true of it, and the endpoint catches the base — which is still
/// exactly the condition its response asserts, because these two are the only types that derive from
/// it.</para>
/// </summary>
public abstract class OeeSettingsWriteRefusedException : InvalidOperationException
{
    private protected OeeSettingsWriteRefusedException(string filePath, string message, Exception? inner)
        : base(message, inner)
    {
        FilePath = filePath;
    }

    /// <summary>The file the refusal is about, so a caller can name it without restating the store's
    /// private file-name constant.</summary>
    public string FilePath { get; }
}

/// <summary>
/// 🔴 Task V-1 fix round — thrown by <see cref="OeeSettingsStore.Set"/> when writing would put the store's
/// in-memory table over bytes this process has not successfully read: either the file is unreadable at the
/// moment of the write, or the table was built from a read that failed and so is empty and represents
/// nothing.
/// </summary>
public sealed class OeeSettingsUnreadableException : OeeSettingsWriteRefusedException
{
    internal OeeSettingsUnreadableException(string filePath, string message, Exception? inner)
        : base(filePath, message, inner)
    {
    }
}

/// <summary>
/// 🔴 Task Z-1 (owner decision, item 11 of <c>docs/owner-decisions.md</c>, 2026-08-18) — thrown by
/// <see cref="OeeSettingsStore.Set"/> when this store came up with <b>no file</b> and a file has
/// <b>appeared since</b> that the in-memory table was never built from.
///
/// <para>The distinguishing fact from <see cref="OeeSettingsUnreadableException"/> is that the read
/// SUCCEEDED — <c>fresh.Status</c> is <see cref="OeeSettingsReadStatus.Loaded"/> — and the write is refused
/// anyway, because a successful read is not the same fact as <i>the table came from this file</i>. The known
/// trigger is restoring a backup into the historian directory on a running host.</para>
/// </summary>
public sealed class OeeSettingsFileAppearedException : OeeSettingsWriteRefusedException
{
    internal OeeSettingsFileAppearedException(string filePath, string message)
        : base(filePath, message, null)
    {
    }
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
/// <para>🔴 <b>THE THIRD DISAGREEMENT IS NOW REFUSED TOO — TASK Z-1, ON THE OWNER'S DECISION OF
/// 2026-08-18 (item 11).</b> The refusal compares two facts, <c>fresh.Status</c> and
/// <see cref="_tableBuiltFrom"/>, and they can disagree three ways. V-1 refused two and NAMED the third as
/// its ceiling — after first naming it too small, as a lost update, which it is not:
///
/// <code>
///   _tableBuiltFrom == Absent   AND   fresh.Status == Loaded
/// </code>
///
/// The store came up with <b>no file</b>; a file has appeared since; the read immediately above <b>sees
/// it</b>; and before Z-1 the predicate was false, so <see cref="Set"/> wrote the empty table plus one
/// machine <b>over a file it had just read successfully</b> — no throw, no <c>409</c>, no log line. It needs
/// no concurrency and no second writer: the trigger is restoring a backup into
/// <c>%ProgramData%\ST4I\sim\historian</c> on a running host, which is the workflow the <c>directory</c>
/// parameter below advertises that folder for in as many words. <see cref="Set"/> now raises
/// <see cref="OeeSettingsFileAppearedException"/> on that pair, and <c>Reload</c> (in production, a restart)
/// is the way out, exactly as it is for the repaired-file arm.</para>
///
/// <para><b>The first-boot path is what the refusal had to avoid taking with it, and it is kept by the
/// SECOND fact rather than by an exemption.</b> A clean start leaves <see cref="_tableBuiltFrom"/> at
/// <see cref="OeeSettingsReadStatus.Absent"/>, and on the first <c>PUT</c> the fresh read is
/// <see cref="OeeSettingsReadStatus.Absent"/> too — no file has appeared — so the pair does not match and
/// the write proceeds and establishes the file. A successful <see cref="Set"/> then moves both facts to
/// <see cref="OeeSettingsReadStatus.Loaded"/>, so the very next write is outside this arm by construction.
/// An EMPTY ARRAY that appears after the store came up IS refused, deliberately: an empty array is
/// <see cref="OeeSettingsReadStatus.Loaded"/> with no entries, which this store's own <see cref="Read"/>
/// documents as the state an operator who cleared the table leaves, and publishing an invented table over a
/// deliberate one is the same act as publishing it over a populated one.</para>
///
/// <para>🔴 <b>WHAT IS STILL NOT REACHED, AND IT IS THE SAME OPERATOR WORKFLOW WITH A FILE ALREADY ON
/// DISK.</b> Naming this small would repeat exactly what V-1 was corrected for, so it is stated at its full
/// size. Two pairs still write:
/// <list type="bullet">
/// <item><description><c>_tableBuiltFrom == Loaded</c> AND <c>fresh.Status == Loaded</c> — <b>and the two
/// readings can be of DIFFERENT CONTENT.</b> A host comes up on a good file, an operator restores a backup
/// over it, and both facts still read <c>Loaded</c>, so nothing here can tell that the file just read is not
/// the file the table was built from. The next <see cref="Set"/> writes the pre-restore table over the
/// restored file. That is item 11's own harm, on the arm where the operator had a file to begin with — which
/// is the more ordinary shape of a restore, not the rarer one.</description></item>
/// <item><description><c>_tableBuiltFrom == Loaded</c> AND <c>fresh.Status == Absent</c> — the file has been
/// removed since the load, and <see cref="Set"/> re-creates it from the table. Nothing this process read is
/// discarded; what is discarded is the removal itself, if that removal was deliberate.</description></item>
/// </list>
/// Closing either one needs a fact this store does not keep — the IDENTITY of the bytes the table was built
/// from, not merely the outcome of that read — and deciding to keep it changes <i>when a write is
/// licensed</i> a second time. Z-1 executes the predicate the owner decided and does not widen it; the
/// residue is written here rather than left to be discovered.</para>
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
    /// that has since been repaired, and (task Z-1) when the store came up with no file and one has appeared
    /// since — this property reads <c>Loaded</c> in BOTH of those states. Catch
    /// <see cref="OeeSettingsWriteRefusedException"/> rather than pre-testing this.</para></summary>
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
    /// overwrite.</para>
    ///
    /// <para>🔴 <b>Task Z-1 — REFUSES a SECOND way, with <see cref="OeeSettingsFileAppearedException"/>, and
    /// on that arm the file reads perfectly.</b> The store came up with no file and one has appeared since,
    /// so the table is not a copy of it. Same ordering, same "nothing was written" guarantee, same way out
    /// (<see cref="Reload"/>, or a restart). Catch <see cref="OeeSettingsWriteRefusedException"/> to mean
    /// "the store declined and the file is untouched" without caring which arm fired.</para></summary>
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
                // 🔴 THREE messages, not two (review N-2). The stale-table arm fires on `fresh == Loaded`
                // AND on `fresh == Absent`, and one sentence cannot be true of both: an operator who took
                // the sibling message's own advice and MOVED THE FILE ASIDE was being told "the file reads
                // correctly again now" about a file that no longer exists. Naming the wrong state in the
                // remedy is the same defect class as naming the wrong tree in a transcript.
                throw new OeeSettingsUnreadableException(
                    SettingsFilePath,
                    fresh.Status switch
                    {
                        OeeSettingsReadStatus.Unreadable =>
                            $"\"{SettingsFilePath}\" is present and this process could not read it " +
                            $"({fresh.Reason}). The file was NOT overwritten: it holds every machine's " +
                            "ideal-cycle override and planned-production ratio and is the only record of " +
                            "them, so writing one machine's values over it would discard the rest. Repair " +
                            "the file or move it aside and restart, then set the value again.",

                        OeeSettingsReadStatus.Absent =>
                            $"\"{SettingsFilePath}\" could not be read when this process loaded it, and it " +
                            "is NOT THERE NOW — moved aside or deleted since. The in-memory OEE settings " +
                            "are therefore EMPTY and are not a copy of anything: writing them would " +
                            "publish an empty table as though it were configuration. Nothing was written. " +
                            "Restart the host (or call Reload) so this process starts from what is " +
                            "actually on disk, then set the value again.",

                        _ =>
                            $"\"{SettingsFilePath}\" could not be read when this process loaded it, so the " +
                            "in-memory OEE settings are EMPTY and do not represent the file. The file " +
                            "reads correctly again now, which means writing the empty table over it would " +
                            "discard whatever repaired it. Nothing was overwritten. Restart the host (or " +
                            "call Reload) so the repaired file is loaded, then set the value again.",
                    },
                    fresh.Failure);
            }

            // 🔴 TASK Z-1 — THE THIRD DISAGREEMENT, REFUSED ON THE OWNER'S DECISION OF 2026-08-18 (item 11).
            // V-1 refused the two pairs in which one of the two facts is Unreadable and named this one as
            // what it did not reach. It is NOT the same situation as the arm above and must not be spelled
            // as one: the read SUCCEEDED. What is missing is not readability, it is PROVENANCE — the table
            // was built when there was no file, so it is empty and is not a copy of the file that is there
            // now, and writing it would publish an invented table over one this process never read into
            // itself. No concurrency is needed to reach it; a backup restored into the historian directory
            // on a running host is enough, and that directory is advertised for exactly that workflow.
            //
            // The FIRST-BOOT path survives on the second fact rather than on an exemption: a clean start
            // leaves `_tableBuiltFrom` at Absent AND the fresh read at Absent, so the pair does not match.
            // The `Loaded` half is the whole difference between "nobody has established a value yet" and
            // "somebody put a file here that I have never read".
            if (_tableBuiltFrom == OeeSettingsReadStatus.Absent &&
                fresh.Status == OeeSettingsReadStatus.Loaded)
            {
                throw new OeeSettingsFileAppearedException(
                    SettingsFilePath,
                    $"\"{SettingsFilePath}\" WAS NOT THERE when this process loaded it, and it IS THERE NOW " +
                    "— restored, or created by hand, since this store came up. The in-memory OEE settings " +
                    "are therefore EMPTY and are not a copy of that file: writing them would replace every " +
                    "machine's ideal-cycle override and planned-production ratio in it with nothing. The " +
                    "file reads correctly and NOTHING WAS WRITTEN. Restart the host (or call Reload) so " +
                    "this process starts from what is actually on disk, then set the value again.");
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
