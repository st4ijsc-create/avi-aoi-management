using St4i.EdgeCore.Historian;
using Xunit;

namespace St4i.EdgeCore.Tests.Historian;

/// <summary>
/// WS-A-T5 — <see cref="OeeSettingsStore"/>: default resolution with no stored data, set-then-resolve,
/// restart-survival, the reject-not-clamp guardrail contract (an out-of-range <c>Set</c> throws
/// <see cref="ArgumentOutOfRangeException"/> BEFORE any write — the file is left byte-for-byte unchanged),
/// and a partial update (one field supplied, the other left alone on an existing entry).
/// </summary>
public sealed class OeeSettingsStoreTests : IDisposable
{
    private readonly List<string> _tempDirs = new();

    public void Dispose()
    {
        foreach (var dir in _tempDirs)
        {
            try { Directory.Delete(dir, recursive: true); } catch { /* best-effort cleanup */ }
        }
    }

    private string NewTempDir()
    {
        var dir = Directory.CreateTempSubdirectory("st4i-oee-settings-tests-").FullName;
        _tempDirs.Add(dir);
        return dir;
    }

    [Fact]
    public void Resolve_WithNoStoredData_ReturnsDefaults()
    {
        var store = new OeeSettingsStore(NewTempDir());

        var resolved = store.Resolve("M1", fallbackIdealCycleSeconds: 1.5);

        Assert.Equal("M1", resolved.MachineCode);
        Assert.Null(resolved.IdealCycleSecondsOverride);
        Assert.Equal(1.0, resolved.PlannedProductionRatio);
    }

    [Fact]
    public void Set_ThenResolve_ReturnsStoredOverrideAndRatio()
    {
        var store = new OeeSettingsStore(NewTempDir());

        store.Set("M1", idealCycleSecondsOverride: 2.0, plannedProductionRatio: 0.8);
        var resolved = store.Resolve("M1", fallbackIdealCycleSeconds: 1.5);

        Assert.Equal(2.0, resolved.IdealCycleSecondsOverride);
        Assert.Equal(0.8, resolved.PlannedProductionRatio);
    }

    [Fact]
    public void Set_SurvivesRestart_ANewStoreInstancePointedAtSameDirectorySeesIt()
    {
        var dir = NewTempDir();
        var store = new OeeSettingsStore(dir);
        store.Set("M1", idealCycleSecondsOverride: 2.0, plannedProductionRatio: 0.8);

        var reopened = new OeeSettingsStore(dir);
        var resolved = reopened.Resolve("M1", fallbackIdealCycleSeconds: 1.5);

        Assert.Equal(2.0, resolved.IdealCycleSecondsOverride);
        Assert.Equal(0.8, resolved.PlannedProductionRatio);
    }

    [Fact]
    public void Set_RatioAboveOne_ThrowsAndLeavesFileUnchanged()
    {
        var dir = NewTempDir();
        var store = new OeeSettingsStore(dir);
        store.Set("M1", idealCycleSecondsOverride: 2.0, plannedProductionRatio: 0.8);
        var filePath = Path.Combine(dir, "oee-settings.json");
        var before = File.ReadAllText(filePath);

        Assert.Throws<ArgumentOutOfRangeException>(() => store.Set("M1", null, 1.5));

        Assert.Equal(before, File.ReadAllText(filePath));
        var resolved = store.Resolve("M1", fallbackIdealCycleSeconds: 1.5);
        Assert.Equal(2.0, resolved.IdealCycleSecondsOverride);
        Assert.Equal(0.8, resolved.PlannedProductionRatio);
    }

    [Fact]
    public void Set_NegativeRatio_ThrowsAndLeavesFileUnchanged()
    {
        var dir = NewTempDir();
        var store = new OeeSettingsStore(dir);
        store.Set("M1", idealCycleSecondsOverride: 2.0, plannedProductionRatio: 0.8);
        var filePath = Path.Combine(dir, "oee-settings.json");
        var before = File.ReadAllText(filePath);

        Assert.Throws<ArgumentOutOfRangeException>(() => store.Set("M1", null, -0.1));

        Assert.Equal(before, File.ReadAllText(filePath));
        var resolved = store.Resolve("M1", fallbackIdealCycleSeconds: 1.5);
        Assert.Equal(2.0, resolved.IdealCycleSecondsOverride);
        Assert.Equal(0.8, resolved.PlannedProductionRatio);
    }

    [Fact]
    public void Set_NonPositiveIdealCycle_ThrowsAndLeavesFileUnchanged()
    {
        var dir = NewTempDir();
        var store = new OeeSettingsStore(dir);
        store.Set("M1", idealCycleSecondsOverride: 2.0, plannedProductionRatio: 0.8);
        var filePath = Path.Combine(dir, "oee-settings.json");
        var before = File.ReadAllText(filePath);

        Assert.Throws<ArgumentOutOfRangeException>(() => store.Set("M1", 0, null));

        Assert.Equal(before, File.ReadAllText(filePath));
        var resolved = store.Resolve("M1", fallbackIdealCycleSeconds: 1.5);
        Assert.Equal(2.0, resolved.IdealCycleSecondsOverride);
        Assert.Equal(0.8, resolved.PlannedProductionRatio);
    }

    [Fact]
    public void Set_GuardrailAlsoAppliesOnFirstWriteForANewMachine()
    {
        var store = new OeeSettingsStore(NewTempDir());

        Assert.Throws<ArgumentOutOfRangeException>(() => store.Set("NEW-MACHINE", null, 2.0));
        Assert.Throws<ArgumentOutOfRangeException>(() => store.Set("NEW-MACHINE", -1.0, null));

        // Neither rejected call should have created an entry.
        var resolved = store.Resolve("NEW-MACHINE", fallbackIdealCycleSeconds: 3.0);
        Assert.Null(resolved.IdealCycleSecondsOverride);
        Assert.Equal(1.0, resolved.PlannedProductionRatio);
    }

    [Fact]
    public void Set_PartialUpdate_LeavesUnspecifiedFieldUnchanged()
    {
        var store = new OeeSettingsStore(NewTempDir());
        store.Set("M1", idealCycleSecondsOverride: 2.0, plannedProductionRatio: 0.8);

        store.Set("M1", idealCycleSecondsOverride: null, plannedProductionRatio: 0.5);
        var resolved = store.Resolve("M1", fallbackIdealCycleSeconds: 1.5);

        Assert.Equal(2.0, resolved.IdealCycleSecondsOverride);
        Assert.Equal(0.5, resolved.PlannedProductionRatio);
    }

    [Fact]
    public void Set_ReturnsResolvedSettingsAfterChange()
    {
        var store = new OeeSettingsStore(NewTempDir());

        var returned = store.Set("M1", idealCycleSecondsOverride: 2.0, plannedProductionRatio: 0.8);

        Assert.Equal("M1", returned.MachineCode);
        Assert.Equal(2.0, returned.IdealCycleSecondsOverride);
        Assert.Equal(0.8, returned.PlannedProductionRatio);
    }

    // ═══ TASK V-1 — THE THREE-OUTCOME READ ═════════════════════════════════════════════════════════════
    //
    // The property, stated once: a caller may establish a value of its own — and this store's only mutator
    // then PERSISTS it over the whole file — exactly when the slot on disk is EMPTY. Before V-1 the read
    // answered the same thing for "empty" and for "present and I could not parse it", so the operator's
    // whole table was replaceable by one machine's PUT.
    //
    // WHY SEVERAL CAUSES AND ONE OUTCOME, and why each is asserted separately: the unreadable rows differ
    // in cause — bad syntax, no bytes at all, legal JSON that yields no list, another handle refusing to
    // share — and three of them do not throw the same type. They are one outcome because they create one
    // obligation. Asserting them member by member is what makes this a measured claim about a population
    // instead of a claim written from one member of it, which is the failure
    // `docs/startup-failure-posture.md` §3.1a records twice against earlier rounds of this same question.
    // Same construction and the same reasoning as FleetSettingsStoreTests' own block.

    [Fact]
    public void Read_NoFileYet_ReportsAbsent()
    {
        var store = new OeeSettingsStore(NewTempDir());

        var read = store.Read();

        Assert.Equal(OeeSettingsReadStatus.Absent, read.Status);
        Assert.Null(read.Entries);
        Assert.Null(read.Reason);
        Assert.Equal(OeeSettingsReadStatus.Absent, store.Status);
    }

    [Fact]
    public void Read_AfterSet_ReportsLoaded_AndCarriesTheEntries()
    {
        var store = new OeeSettingsStore(NewTempDir());
        store.Set("V1-LOADED-01", idealCycleSecondsOverride: 3.25, plannedProductionRatio: 0.6);

        var read = store.Read();

        Assert.Equal(OeeSettingsReadStatus.Loaded, read.Status);
        Assert.NotNull(read.Entries);
        var entry = Assert.Single(read.Entries!);
        Assert.Equal("V1-LOADED-01", entry.MachineCode);
        Assert.Equal(3.25, entry.IdealCycleSecondsOverride);
        Assert.Null(read.Reason);
        Assert.EndsWith("oee-settings.json", read.FilePath, StringComparison.Ordinal);
    }

    /// <summary>An operator who cleared the table left an EMPTY ARRAY, which is a file that read fine and
    /// said "nothing". That is Loaded-with-no-entries and must never be Unreadable — otherwise the fix
    /// would make a legitimately empty file permanently unwritable.</summary>
    [Fact]
    public void Read_EmptyJsonArray_ReportsLoaded_AndSetStillWorks()
    {
        var dir = NewTempDir();
        File.WriteAllText(Path.Combine(dir, "oee-settings.json"), "[]");
        var store = new OeeSettingsStore(dir);

        Assert.Equal(OeeSettingsReadStatus.Loaded, store.Read().Status);
        Assert.Empty(store.Read().Entries!);
        Assert.Equal(0.5, store.Set("M1", null, 0.5).PlannedProductionRatio);
    }

    /// <summary>🔴 The likeliest vector of all of them: a hand-edited file with a typo in it. This file has
    /// no schema and is meant to be repairable by hand. Before V-1 this answered exactly as "there is no
    /// file".</summary>
    [Fact]
    public void Read_MalformedFile_ReportsUnreadable_AndNeverAbsent()
    {
        var dir = NewTempDir();
        File.WriteAllText(Path.Combine(dir, "oee-settings.json"), "[ { machineCode: \"M1\" ]");
        var store = new OeeSettingsStore(dir);

        var read = store.Read();

        Assert.Equal(OeeSettingsReadStatus.Unreadable, read.Status);
        Assert.Null(read.Entries);
        Assert.NotNull(read.Reason);
        Assert.IsAssignableFrom<System.Text.Json.JsonException>(read.Failure);
    }

    [Fact]
    public void Read_EmptyFile_ReportsUnreadable_AndNeverAbsent()
    {
        var dir = NewTempDir();
        File.WriteAllText(Path.Combine(dir, "oee-settings.json"), string.Empty);

        var read = new OeeSettingsStore(dir).Read();

        Assert.Equal(OeeSettingsReadStatus.Unreadable, read.Status);
        Assert.Null(read.Entries);
        Assert.NotNull(read.Reason);
    }

    /// <summary>The one unreadable shape that throws NOTHING: four legal JSON bytes that deserialize to no
    /// list at all. Asserted separately because it is the row that forces <c>OeeSettingsRead.Failure</c> to
    /// be nullable on the Unreadable outcome.</summary>
    [Fact]
    public void Read_FileHoldingLiteralNullJson_ReportsUnreadable_WithNoException()
    {
        var dir = NewTempDir();
        File.WriteAllText(Path.Combine(dir, "oee-settings.json"), "null");

        var read = new OeeSettingsStore(dir).Read();

        Assert.Equal(OeeSettingsReadStatus.Unreadable, read.Status);
        Assert.Null(read.Entries);
        Assert.NotNull(read.Reason);
        Assert.Null(read.Failure);
    }

    /// <summary>🔴 The non-malformed vector, kept because these do NOT share a cause: a well-formed file
    /// whose bytes this process cannot reach because another handle refuses to share them. Measured in task
    /// M-1: <c>FileShare.None</c> reaches the read and <c>FileShare.Read</c> does not.</summary>
    [Fact]
    public void Read_FileHeldWithADenyShareLock_ReportsUnreadable_WithoutThrowing()
    {
        var dir = NewTempDir();
        var store = new OeeSettingsStore(dir);
        store.Set("V1-LOCK", idealCycleSecondsOverride: 2.0, plannedProductionRatio: null);
        var path = Path.Combine(dir, "oee-settings.json");

        OeeSettingsRead read;
        using (var _ = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.None))
        {
            read = store.Read();
        }

        Assert.Equal(OeeSettingsReadStatus.Unreadable, read.Status);
        Assert.NotNull(read.Reason);
        Assert.IsAssignableFrom<IOException>(read.Failure);

        // …and the lock is a property of the moment, not of the file. Without this half, a Read() that
        // simply always answered Unreadable would pass everything above.
        Assert.Equal(OeeSettingsReadStatus.Loaded, store.Read().Status);
    }

    /// <summary>🔴 <b>The refusal, and the reason it is the whole point.</b> This store's only mutator
    /// rewrites the WHOLE table, so performing one machine's update over bytes this process never read
    /// replaces every other machine's entry with nothing.</summary>
    [Fact]
    public void Set_WhileTheFileIsUnreadable_Refuses_AndLeavesEveryByteWhereItWas()
    {
        var dir = NewTempDir();
        var path = Path.Combine(dir, "oee-settings.json");
        var operatorBytes = "[ { \"machineCode\": \"M1\", idealCycleSecondsOverride: 42 ]";
        File.WriteAllText(path, operatorBytes);

        var store = new OeeSettingsStore(dir);
        Assert.Equal(OeeSettingsReadStatus.Unreadable, store.Status);
        Assert.NotNull(store.UnreadableReason);

        var refusal = Assert.Throws<OeeSettingsUnreadableException>(
            () => store.Set("M2", idealCycleSecondsOverride: 1.0, plannedProductionRatio: 0.5));
        Assert.IsAssignableFrom<InvalidOperationException>(refusal);
        Assert.Contains("oee-settings.json", refusal.Message, StringComparison.Ordinal);

        Assert.Equal(operatorBytes, File.ReadAllText(path));
        Assert.Equal(new[] { "oee-settings.json" },
            Directory.GetFiles(dir).Select(Path.GetFileName).OrderBy(f => f, StringComparer.Ordinal).ToArray());
    }

    /// <summary>The range guardrails still run FIRST, so a caller sending a bad value over an unreadable
    /// file gets the 400-shaped error it would always have got. Ordering, not preference: the request is
    /// invalid whatever the disk says, and swapping these would make a rejected input report a filesystem
    /// problem.</summary>
    [Fact]
    public void Set_WithAnOutOfRangeValue_OverAnUnreadableFile_StillReportsTheRangeFailure()
    {
        var dir = NewTempDir();
        File.WriteAllText(Path.Combine(dir, "oee-settings.json"), "{ not a list ]");
        var store = new OeeSettingsStore(dir);

        Assert.Throws<ArgumentOutOfRangeException>(() => store.Set("M1", null, plannedProductionRatio: 4.0));
    }

    /// <summary>Reads keep working while the file is unreadable, which is what makes refusing the write a
    /// REPORT rather than an outage — the same honest divergence the settings arm carries: the process
    /// answers on its documented defaults and says so.</summary>
    [Fact]
    public void Resolve_WhileTheFileIsUnreadable_AnswersTheDocumentedDefaults()
    {
        var dir = NewTempDir();
        File.WriteAllText(Path.Combine(dir, "oee-settings.json"), "{ not a list ]");

        var resolved = new OeeSettingsStore(dir).Resolve("M1", fallbackIdealCycleSeconds: 9.0);

        Assert.Null(resolved.IdealCycleSecondsOverride);
        Assert.Equal(1.0, resolved.PlannedProductionRatio);
    }

    /// <summary>The unreadable file is named once, at construction, on the callback <c>Program.cs</c> wires
    /// to an <c>ILogger</c> at <c>Error</c>. Asserted rather than assumed, because a store that refuses the
    /// write and tells nobody is only half of the rule in <c>docs/startup-failure-posture.md</c> §1.</summary>
    [Fact]
    public void Ctor_OverAnUnreadableFile_ReportsOnce_AndAReadableOneReportsNothing()
    {
        var unreadable = NewTempDir();
        File.WriteAllText(Path.Combine(unreadable, "oee-settings.json"), "{ not a list ]");
        var reported = new List<string>();
        _ = new OeeSettingsStore(unreadable, (_, message) => reported.Add(message));

        var line = Assert.Single(reported);
        Assert.Contains("oee-settings.json", line, StringComparison.Ordinal);
        Assert.Contains("NOT be overwritten", line, StringComparison.Ordinal);

        // The control arm: a store with nothing wrong says nothing at all, which is what makes the line
        // above evidence about the file rather than about the callback.
        var quiet = new List<string>();
        var clean = new OeeSettingsStore(NewTempDir(), (_, message) => quiet.Add(message));
        clean.Set("M1", idealCycleSecondsOverride: 2.0, plannedProductionRatio: null);
        Assert.Empty(quiet);
    }

    // ═══ V-1 FIX ROUND (review I-3) — THE REFUSAL IS DECIDED AT THE WRITE, NOT AT CONSTRUCTION ═════════
    //
    // Round one gated Set on a classification the CONSTRUCTOR cached, so the guarantee was "the file was
    // unreadable when this store was built". Reach C only ever constructs a store over an already-corrupt
    // directory, so no instrument in the tree could see the other moment. These three are that instrument.

    /// <summary>🔴 The arm round one shipped open: a host running on a GOOD file, the operator hand-edits it
    /// into invalid JSON — the very repair this store's message asks for — and one write arrives afterwards.
    /// Before this fix <c>Set</c> wrote the in-memory table straight over those bytes with no throw, no 409
    /// and no log line.</summary>
    [Fact]
    public void Set_WhenTheFileIsCorruptedAfterConstruction_Refuses_AndLeavesTheOperatorsBytes()
    {
        var dir = NewTempDir();
        var path = Path.Combine(dir, "oee-settings.json");

        var store = new OeeSettingsStore(dir);
        store.Set("M1", idealCycleSecondsOverride: 2.0, plannedProductionRatio: 0.8);

        // Premise: the store came up on a perfectly good file, so nothing about construction can explain
        // the refusal below.
        Assert.Equal(OeeSettingsReadStatus.Loaded, store.Status);

        var handEdited = "[ { \"machineCode\": \"M1\", idealCycleSecondsOverride: 2.0 ]";
        File.WriteAllText(path, handEdited);

        var refusal = Assert.Throws<OeeSettingsUnreadableException>(
            () => store.Set("M2", idealCycleSecondsOverride: 1.0, plannedProductionRatio: 0.5));
        Assert.Equal(path, refusal.FilePath);

        Assert.Equal(handEdited, File.ReadAllText(path));
        Assert.Equal(new[] { "oee-settings.json" },
            Directory.GetFiles(dir).Select(Path.GetFileName).OrderBy(f => f, StringComparer.Ordinal).ToArray());
    }

    /// <summary>🔴 The hole re-reading would have OPENED if it were the only change. A file unreadable at
    /// construction leaves the table EMPTY; if the operator then repairs the file the freshest read says
    /// <c>Loaded</c>, and writing the empty table over the repair would destroy it. So this arm keeps
    /// refusing, exactly as round one did, and <c>Reload</c> is the way out. Without it the fix would have
    /// traded one silent overwrite for another.</summary>
    [Fact]
    public void Set_WhenAnUnreadableFileIsRepairedAfterConstruction_StillRefuses_UntilReload()
    {
        var dir = NewTempDir();
        var path = Path.Combine(dir, "oee-settings.json");
        File.WriteAllText(path, "{ not a list ]");
        var store = new OeeSettingsStore(dir);

        var repaired = "[ { \"machineCode\": \"REPAIRED\", \"plannedProductionRatio\": 0.25 } ]";
        File.WriteAllText(path, repaired);

        // The freshest read is fine — which is exactly why refusing here is the load-bearing half.
        Assert.Equal(OeeSettingsReadStatus.Loaded, store.Read().Status);

        Assert.Throws<OeeSettingsUnreadableException>(() => store.Set("M2", null, 0.5));
        Assert.Equal(repaired, File.ReadAllText(path));

        // …and the way out is the documented one, after which the write lands ON TOP of the repaired
        // content rather than instead of it.
        store.Reload();
        Assert.Equal(0.5, store.Set("M2", null, 0.5).PlannedProductionRatio);
        Assert.Equal(0.25, store.Resolve("REPAIRED", 1.0).PlannedProductionRatio);
    }

    /// <summary><c>Status</c>'s doc says what this store last established about the file (review M-2).
    /// Before the fix round only the constructor and <c>Reload</c> wrote it, so the public <c>Read()</c> —
    /// the method whose name IS the read — left it stale, on the member the whole refusal hangs on.</summary>
    [Fact]
    public void Read_RecordsWhatItAnswered_SoStatusMeansTheMostRecentRead()
    {
        var dir = NewTempDir();
        var path = Path.Combine(dir, "oee-settings.json");
        var store = new OeeSettingsStore(dir);
        Assert.Equal(OeeSettingsReadStatus.Absent, store.Status);

        File.WriteAllText(path, "[]");
        Assert.Equal(OeeSettingsReadStatus.Loaded, store.Read().Status);
        Assert.Equal(OeeSettingsReadStatus.Loaded, store.Status);
        Assert.Null(store.UnreadableReason);

        File.WriteAllText(path, "{ not a list ]");
        Assert.Equal(OeeSettingsReadStatus.Unreadable, store.Read().Status);
        Assert.Equal(OeeSettingsReadStatus.Unreadable, store.Status);
        Assert.NotNull(store.UnreadableReason);
    }

    /// <summary>A repaired file is readable again by the same instance — the status is a property of the
    /// last read, not a latch. Without this, "refuses forever" would be indistinguishable from "refuses
    /// while broken".</summary>
    [Fact]
    public void Reload_AfterTheFileIsRepaired_ClearsTheRefusal()
    {
        var dir = NewTempDir();
        var path = Path.Combine(dir, "oee-settings.json");
        File.WriteAllText(path, "{ not a list ]");
        var store = new OeeSettingsStore(dir);
        Assert.Equal(OeeSettingsReadStatus.Unreadable, store.Status);

        File.WriteAllText(path, "[ { \"machineCode\": \"M1\", \"plannedProductionRatio\": 0.25 } ]");
        store.Reload();

        Assert.Equal(OeeSettingsReadStatus.Loaded, store.Status);
        Assert.Null(store.UnreadableReason);
        Assert.Equal(0.25, store.Resolve("M1", 1.0).PlannedProductionRatio);
        Assert.Equal(0.75, store.Set("M1", null, 0.75).PlannedProductionRatio);
    }
}
