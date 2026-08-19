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
/// exactly the condition its response asserts, because the derived types are the only types that derive
/// from it.</para>
///
/// <para>🔴 <b>Task AJ-1 adds a THIRD derived type, <see cref="OeeSettingsFileChangedException"/> (owner
/// decision item 13, 2026-08-19), and the property the <c>409</c> response rests on is stated as a property
/// rather than as a count.</b> The endpoint's claim is <i>"nothing was written"</i>. What makes it true is
/// not that there are two arms or three: it is that <b>every</b> type deriving from this base is raised by
/// <see cref="OeeSettingsStore.Set"/> and by nothing else, and every one of them is raised <b>before</b> the
/// mutation and the <c>Save</c> — the same ordering the range guardrails already have. A fourth arm added
/// later keeps the response honest exactly as long as it keeps that ordering; a scalar written here would
/// have to be re-counted every time and would say nothing about the ordering, which is the half that
/// carries the claim. Same reason each arm still gets its own name: this one's file <b>reads perfectly and
/// is not the file the table came from</b>, and neither existing name is true of that.</para>
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

/// <summary>
/// 🔴 Task AJ-1 (owner decision, item 13 of <c>docs/owner-decisions.md</c>, 2026-08-19) — thrown by
/// <see cref="OeeSettingsStore.Set"/> when this store came up on a file it read successfully and the file on
/// disk is <b>no longer the same bytes</b>. Both reads succeeded; the file is not the file the in-memory
/// table was built from.
///
/// <para>The distinguishing fact from <see cref="OeeSettingsFileAppearedException"/> is which half moved.
/// There the store had <b>no file</b> and one appeared, so the table represents nothing. Here the store had
/// a file, the table is a faithful copy of <i>that</i> one, and something outside this store has replaced it
/// since — a restore onto a running host being the ordinary trigger, a hand-edit and a second host on the
/// same historian directory being the others. Writing the table now would publish a pre-restore table over
/// a post-restore file.</para>
///
/// <para>🔴 <b>The known ceiling of this arm, named here because a price the owner accepted must be
/// findable from the type that charges it.</b> The comparison is over the <b>bytes</b>, so a file that was
/// merely REFORMATTED — re-indented, CRLF↔LF, a BOM added, keys reordered — is a different file to this
/// store and is refused, although it means the same thing. That is deliberate and is the accepted price:
/// the only comparison that would let a reformat through is one that compares the <i>parsed</i> table, and
/// that comparison has a false NEGATIVE at the case this arm exists to close (<see cref="OeeSettingsStore"/>
/// drops entries with an empty machine code and collapses duplicate ones, so a restored file carrying either
/// would compare EQUAL to the table and be overwritten). Refusing a reformat is recoverable by
/// <see cref="OeeSettingsStore.Reload"/>; overwriting a restore is not recoverable at all.</para>
/// </summary>
public sealed class OeeSettingsFileChangedException : OeeSettingsWriteRefusedException
{
    internal OeeSettingsFileChangedException(string filePath, string message)
        : base(filePath, message, null)
    {
    }
}

/// <summary>🔴 Task V-1 — the outcome of one <see cref="OeeSettingsStore.Read"/> call.</summary>
public sealed class OeeSettingsRead
{
    private OeeSettingsRead(
        OeeSettingsReadStatus status, IReadOnlyList<OeeMachineSettings>? entries, string filePath,
        string? reason, Exception? failure, string? text)
    {
        Status = status;
        Entries = entries;
        FilePath = filePath;
        Reason = reason;
        Failure = failure;
        Text = text;
    }

    /// <summary>🔴 Task AJ-1 — the file's own text, exactly as this read obtained it, non-null exactly when
    /// <see cref="Status"/> is <see cref="OeeSettingsReadStatus.Loaded"/>.
    ///
    /// <para><b>It is retained rather than digested, and that is the whole of the identity mechanism item 13
    /// asked for.</b> The read has already called <c>File.ReadAllText</c> to reach
    /// <see cref="Entries"/> — before AJ-1 this string was built and then dropped on the floor. A hash, an
    /// mtime or a length exists to answer <i>"are these two the same"</i> for a caller that cannot hold both
    /// operands; <see cref="OeeSettingsStore"/> holds both, in one lock, at zero extra I/O, so every one of
    /// those is a lossy function of something it already has and can only ADD failure modes.</para>
    ///
    /// <para>🔴 <b>And the direction in which it is WORSE, said here because the sentence this replaces
    /// ("cheaper AND strictly stronger than any digest") was written without a condition, in the paragraph
    /// whose job is to justify the choice.</b> Cheaper is true of <b>I/O</b> (0 against 0) and of <b>CPU</b>
    /// (an ordinal compare exits at the first difference, or at the length check; a digest must traverse
    /// every byte of both sides). It is <b>false of RETAINED MEMORY</b>, and that is not a rounding error: a
    /// SHA-256 is 32 bytes whatever the file is, and this is the size of the file for as long as the store
    /// lives. See <see cref="OeeSettingsStore"/>'s own field for what bounds that and what does not.</para>
    ///
    /// <para><b>INTERNAL on purpose.</b> <see cref="OeeSettingsStore.Read"/> is public and this type is its
    /// return value, so a public member here would be new published surface — and nothing outside this store
    /// needs the raw bytes to decide anything. The store is the only comparer.</para></summary>
    internal string? Text { get; }

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

    internal static OeeSettingsRead ForLoaded(
        string filePath, IReadOnlyList<OeeMachineSettings> entries, string text) =>
        new(OeeSettingsReadStatus.Loaded, entries, filePath, null, null, text);

    internal static OeeSettingsRead ForAbsent(string filePath) =>
        new(OeeSettingsReadStatus.Absent, null, filePath, null, null, null);

    internal static OeeSettingsRead ForUnreadable(string filePath, string reason, Exception? failure = null) =>
        new(OeeSettingsReadStatus.Unreadable, null, filePath, reason, failure, null);
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
/// <para>🔴 <b>THE FOURTH DISAGREEMENT IS NOW REFUSED TOO — TASK AJ-1, ON THE OWNER'S DECISION OF
/// 2026-08-19 (item 13), AND IT IS THE PAIR BOTH V-1 AND Z-1 NAMED AS THEIR CEILING:</b>
///
/// <code>
///   _tableBuiltFrom == Loaded   AND   fresh.Status == Loaded,   WITH DIFFERENT BYTES
/// </code>
///
/// A host comes up on a good file, an operator restores a backup over it, and both facts still read
/// <c>Loaded</c> — so neither arm above sees it, and before AJ-1 the next <see cref="Set"/> wrote the
/// pre-restore table over the post-restore file with no throw, no <c>409</c> and no log line. That is item
/// 11's own harm on the arm where the operator HAD a file, which is the more ordinary shape of a restore
/// rather than the rarer one. <see cref="Set"/> now raises
/// <see cref="OeeSettingsFileChangedException"/> on that pair.</para>
///
/// <para><b>The store now records the IDENTITY of the bytes, which is the fact V-1 and Z-1 both said it did
/// not keep — and keeping it cost NO extra read.</b> <see cref="ReadLocked"/> had always loaded the whole
/// file into a string to reach the entries and then discarded that string; <see cref="_tableBuiltFromText"/>
/// keeps it. Both sides of the comparison were therefore already in memory, under one lock. See that field
/// for why a retained operand rather than a hash, an mtime or a length.</para>
///
/// <para>🔴 <b>The price, which the owner accepted when he decided it and which is therefore recorded and
/// not softened:</b> <c>PUT /v1/historian/oee/settings</c> answers <c>409</c> at moments it answers
/// <c>200</c> today, INCLUDING when the thing that changed the file was a legitimate hand-edit or a mere
/// reformat of the same settings. <see cref="Reload"/> (in production, a restart) is the way out, as it is
/// for every other refusal here.</para>
///
/// <para>🔴 <b>WHAT IS STILL NOT REACHED, AT ITS FULL SIZE, BECAUSE THIS PARAGRAPH HAS BEEN CORRECTED TWICE
/// FOR NAMING A CEILING TOO SMALL.</b> One pair still writes:
/// <list type="bullet">
/// <item><description><c>_tableBuiltFrom == Loaded</c> AND <c>fresh.Status == Absent</c> — the file has been
/// removed since the load, and <see cref="Set"/> re-creates it from the table. Nothing this process read is
/// discarded; what is discarded is the removal itself, if that removal was deliberate. AJ-1's arm is gated on
/// the PAIR and not on "the bytes differ", specifically so that closing item 13 does not close this one
/// as a side effect: that would be widening a predicate the owner did not decide.</description></item>
/// </list>
/// And one thing no predicate here can reach at all: <b>this store has no FILE lock</b>, only
/// <see cref="_gate"/>, which is in-process. Two hosts on one <c>ST4I_HISTORIAN_DIR</c> both write, and
/// <see cref="WriteAllTextAtomic"/> prevents a TORN file, not a LOST one. AJ-1's arm makes that collision
/// audible on the second host's next <see cref="Set"/> instead of silent, which is a report and not a fix;
/// README §15.9 states the shape and what would close it.</para>
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

    /// <summary>🔴 Task AJ-1 (owner decision item 13, 2026-08-19) — the BYTES <see cref="_settings"/> was
    /// built from, non-null exactly when <see cref="_tableBuiltFrom"/> is
    /// <see cref="OeeSettingsReadStatus.Loaded"/>. Written by <see cref="Load"/>, and by a write this store
    /// completed itself; never by <see cref="ClassifyLocked"/>, for the same reason
    /// <see cref="_tableBuiltFrom"/> is never written there.
    ///
    /// <para><b>Why a retained string and not a hash, an mtime or a length.</b> The three were weighed and
    /// none of them is what this store needs, because the question they answer is not the question here. A
    /// fingerprint compresses an operand you cannot keep; <see cref="ReadLocked"/> has ALREADY read the whole
    /// file into memory on both sides of the comparison, inside <see cref="_gate"/>, so the operands are both
    /// in hand and the extra I/O cost of comparing them is zero. A hash is then a lossy function of a string
    /// this store is holding — it can collide, so it can answer "same" about two different files, which is
    /// the answer that overwrites. A length is the same fault, enormously more often. An mtime is worse in
    /// kind: it is a SECOND SURFACE asked a question the read itself answers, which is exactly the mistake
    /// <see cref="Read"/> discarded <c>File.Exists</c> for, and restore tools preserve timestamps — so it is
    /// blind at the one case this arm exists to close.</para>
    ///
    /// <para>🔴 <b>WHAT IT COSTS, WHICH IS THE HALF THE FIRST WRITING OF THIS BLOCK LEFT OUT.</b> This field
    /// holds a whole file, and <see cref="OeeSettingsStore"/> is registered as a <b>singleton</b>, so it
    /// holds it <b>for the life of the process</b>. There is <b>NO CEILING</b> anywhere on the path: no size
    /// check in <see cref="ReadLocked"/>, no limit on the number of entries, no limit on the length of a
    /// machine code. A digest would have been 32 bytes regardless; this is O(file), retained, unbounded —
    /// and past roughly 85 000 bytes a .NET string is allocated on the large-object heap, where a singleton
    /// keeps it for good. No byte figure is given here on purpose: nobody has measured one, and a number
    /// written in this position would read as a measurement.</para>
    ///
    /// <para>🔴 <b>And the text retained is the DISK'S, not the TABLE'S — which is the same fact that makes
    /// the byte comparison correct, read in the other direction.</b> <see cref="Load"/> SKIPS an entry whose
    /// machine code is empty and COLLAPSES duplicate ones, while this field keeps the file whole. That
    /// asymmetry is exactly why a comparison over the parsed table would have a false negative at the case
    /// item 13 closes — and it is also why a file that produces a table of ZERO entries can still be held
    /// here in full. Both readings come from one fact and only one of them was written down first.</para>
    ///
    /// <para><b>What bounds it, and when.</b> Only until the first successful <see cref="Set"/>: from there
    /// this field is the text of the TABLE (<see cref="Save"/>'s own output), and the table is bounded by
    /// the fleet roster, because <c>PutOeeSettingsAsync</c> only ever passes a machine code it resolved from
    /// that roster rather than a caller-supplied string. The unbounded window is the one between
    /// construction (or <see cref="Reload"/>) and that first write. A file large enough to defeat
    /// <c>File.ReadAllText</c> outright becomes <see cref="OeeSettingsReadStatus.Unreadable"/> through the
    /// catch-all rather than taking the process down — behaviour inherited from V-1, not introduced
    /// here, and named because it is the only natural ceiling in sight.</para></summary>
    private string? _tableBuiltFromText;

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
    /// that has since been repaired, when (task Z-1) the store came up with no file and one has appeared
    /// since, and when (task AJ-1) the file reads fine and its bytes are not the bytes the table was built
    /// from — this property reads <c>Loaded</c> in ALL THREE of those states. Catch
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
    /// "the store declined and the file is untouched" without caring which arm fired.</para>
    ///
    /// <para>🔴 <b>Task AJ-1 — REFUSES a THIRD way, with <see cref="OeeSettingsFileChangedException"/>, and
    /// on that arm BOTH reads succeeded.</b> The store came up on a file, and the file on disk is no longer
    /// the bytes it loaded — a restore over a running host, a hand-edit, or a second host on the same
    /// historian directory. Same ordering and the same "nothing was written" guarantee. 🔴 <b>It fires on a
    /// pure REFORMAT of the same settings too</b>, which is the price the owner accepted with the decision:
    /// see <see cref="OeeSettingsFileChangedException"/> for why the comparison that would let a reformat
    /// through is the one that cannot see a restore.</para></summary>
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

            // 🔴 TASK AJ-1 — THE PAIR V-1 AND Z-1 BOTH NAMED AS THE CEILING, REFUSED ON THE OWNER'S
            // DECISION OF 2026-08-19 (item 13). It sits HERE, after the other two, because those two say
            // different things and every word of their three messages is held by a test.
            //
            // Both facts read `Loaded` and BOTH READS SUCCEEDED — so neither of the arms above can see this
            // one. What differs is the BYTES: the table is a faithful copy of the file this store loaded,
            // and the file on disk is no longer that file. A host comes up on a good file, an operator
            // restores a backup over it, and before this arm the next Set wrote the pre-restore table over
            // the post-restore file — no throw, no 409, no log line. That is item 11's harm on the arm where
            // the operator HAD a file, which is the more ordinary shape of a restore rather than the rarer.
            //
            // WHY THIS COMPARISON AND NOT A FINGERPRINT: see `_tableBuiltFromText`. Both operands are
            // already in memory under this lock, so a digest of either can only lose information the store
            // is holding. The extra disk cost of this arm is ZERO — `ClassifyLocked` above is the same read
            // `Set` has taken since V-1's fix round, not a new one.
            //
            // THE GATE IS THE PAIR, NOT "THE TEXT DIFFERS", and that is load-bearing: the OTHER open pair —
            // `_tableBuiltFrom == Loaded` with `fresh.Status == Absent`, the file removed since the load —
            // would also have differing text, and the owner decided item 13, not that one. It still writes,
            // deliberately, and §3.6 of docs/startup-failure-posture.md still names it as the ceiling.
            if (_tableBuiltFrom == OeeSettingsReadStatus.Loaded &&
                fresh.Status == OeeSettingsReadStatus.Loaded &&
                !string.Equals(fresh.Text, _tableBuiltFromText, StringComparison.Ordinal))
            {
                throw new OeeSettingsFileChangedException(
                    SettingsFilePath,
                    $"\"{SettingsFilePath}\" READS CORRECTLY but it is NOT THE FILE this process loaded — " +
                    "its content has been replaced since, by a restore, a hand-edit, or another process " +
                    "writing the same historian directory. The in-memory OEE settings are a copy of the " +
                    "EARLIER file, so writing them would replace every machine's ideal-cycle override and " +
                    "planned-production ratio in the file that is there now. NOTHING WAS WRITTEN. Restart " +
                    "the host (or call Reload) so this process starts from what is actually on disk, then " +
                    "set the value again. This is refused even when the change was only a REFORMAT of the " +
                    "same settings: the comparison is over the file's bytes, deliberately, because the one " +
                    "that would let a reformat through cannot tell a restore from a rewrite.");
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
            var written = Save();

            // 🔴 A write establishes the same fact a read would, and leaving these stale would reintroduce
            // review M-2 one statement later: after a successful Set over a directory that had NO file, the
            // freshest classification was `Absent` — describing a moment that no longer exists, on the
            // public member the refusal hangs on. The file now exists and holds exactly this table, so both
            // are `Loaded` by construction rather than by a read nobody took.
            //
            // 🔴 TASK AJ-1 — AND THE IDENTITY IS REFRESHED IN THE SAME PLACE, FOR THE SAME REASON, AND
            // OMITTING IT WOULD BE WORSE THAN NOT SHIPPING THE ARM. `Save` has just written these exact
            // bytes, so they ARE the file; leaving the field at what the load read would make the very next
            // Set on this instance compare the new file against the OLD one and refuse — a 409 on every
            // consecutive pair of PUTs, with nothing wrong. `Set_PartialUpdate_LeavesUnspecifiedFieldUnchanged`
            // and `Set_TheFirstTimeAfterACleanStart_StillEstablishesTheFile` are the two that redden if this
            // line is removed; they are named here because that is what makes this a checkable claim.
            _status = OeeSettingsReadStatus.Loaded;
            _tableBuiltFrom = OeeSettingsReadStatus.Loaded;
            _tableBuiltFromText = written;
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
            ? OeeSettingsRead.ForLoaded(path, entries, text)
            : OeeSettingsRead.ForUnreadable(path, "the file parsed as JSON but produced no settings list");
    }

    /// <summary>Always called with <see cref="_gate"/> already held, or from the constructor before this
    /// instance is published to any other thread.</summary>
    private void Load()
    {
        var read = ClassifyLocked();
        _tableBuiltFrom = read.Status;
        _tableBuiltFromText = read.Text;

        if (read.Entries is null) return;

        foreach (var entry in read.Entries)
        {
            if (string.IsNullOrEmpty(entry.MachineCode)) continue;
            _settings[entry.MachineCode] = entry;
        }
    }

    /// <summary>Always called with <see cref="_gate"/> already held. 🔴 Task AJ-1 — RETURNS the text it
    /// wrote, so the caller can record the identity of the file it has just established without re-reading
    /// it. Returning is what keeps the serialisation a single expression: a second
    /// <c>JsonSerializer.Serialize</c> at the call site would be a second chance to drift.</summary>
    /// <returns>The exact content written to <c>oee-settings.json</c>.</returns>
    private string Save()
    {
        var path = Path.Combine(RootDirectory, FileName);
        var json = JsonSerializer.Serialize(
            _settings.Values.OrderBy(s => s.MachineCode, StringComparer.OrdinalIgnoreCase).ToList(), PersistenceOptions);
        WriteAllTextAtomic(path, json);
        return json;
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
