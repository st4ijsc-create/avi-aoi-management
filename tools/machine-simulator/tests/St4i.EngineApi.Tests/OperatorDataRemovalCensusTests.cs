using System.Reflection;
using System.Reflection.Emit;
using System.Text.RegularExpressions;
using St4i.EdgeCore.Config;
using St4i.EdgeCore.Historian;
using St4i.EdgeCore.Identity;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Site;
using St4i.EdgeCore.Uns;
using St4i.EngineApi.Alarms;
using St4i.EngineApi.AssetRegistry;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Config;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// Task S-1 (<c>.superpowers/sdd/deletion-paths-enumerated/task-1-brief.md</c>) — <b>the instrument
/// <c>docs/owner-decisions.md</c> item 5 says must exist before that item can become a decision.</b>
/// It measures; it changes nothing.
///
/// <para><b>THE QUESTION, RESTATED RATHER THAN INHERITED (§8.1(a)).</b> The sentence handed over was
/// <i>"is there any path in <c>src/</c> that deletes operator data, and do those paths behave differently in
/// the same situation".</i> Three things in it are assumed rather than given, and each one had to be turned
/// into a property before any tool could be chosen:
/// <list type="number">
///   <item><description><b>"delete" is not an action, it is an EFFECT.</b> Nothing here asks whether a
///   statement is spelled <c>Delete</c>. It asks whether, after the statement completes normally, bytes that
///   were retrievable at a named location are no longer retrievable there. A rename onto an occupied path, a
///   whole-file rewrite, an <c>INSERT … ON CONFLICT DO UPDATE</c>, a <c>DROP TABLE</c> in a migration and a
///   <c>FileMode.Create</c> all satisfy that and none of them is spelled <c>Delete</c>. Q-1 already settled
///   this direction for this codebase: it treated a <c>Save</c> over an operator's file as the data loss,
///   not as a write.</description></item>
///   <item><description><b>"operator data" is not a kind a tool can recognise.</b> Provenance — did a human
///   choose these bytes, or did the product mint them — is a judgement about intent, and no scan can make it.
///   So it is DECLARED here, per artifact, with the evidence beside it, and the declaration is checked for
///   COVERAGE against the mechanically-enumerated set of persisted artifacts rather than used as a filter
///   that quietly hides members.</description></item>
///   <item><description><b>"the same situation" is constructed, not found.</b> There is more than one
///   candidate and they give different answers. The one held fixed here is the one item 5 inherited from
///   Q-1: <b>the artifact is present on disk and this process cannot make sense of its bytes.</b> Other
///   situations — a full volume, a concurrent writer, a deny-share lock, an operator deliberately asking for
///   a delete — are NOT held fixed by anything below, and each of them can reorder the answer.</description></item>
/// </list></para>
///
/// <para><b>THE DOMAIN, STATED SO IT CAN BE ARGUED WITH, AND WHAT IS OUTSIDE IT (§8.1(f)).</b> This file
/// stands in three places at once, deliberately, because no one of them can check the other two:
/// <list type="bullet">
///   <item><description><b>Reach A — the IL of four built assemblies</b> (<c>St4i.EngineApi</c>,
///   <c>St4i.EdgeCore</c>, <c>St4i.EdgeCore.Serial</c>, <c>St4i.Connector.Abstractions</c> — this test
///   project's own reference closure, so they are by construction the exact build under test). Population:
///   every method body the compiler emitted, including lambdas, local functions, iterator and async state
///   machines and property accessors, walked instruction by instruction with a length table read off
///   <see cref="OpCodes"/> rather than guessed. This is what makes the vocabulary below a MEASUREMENT
///   instead of a guess: every member of a byte-owning BCL type that this product actually calls must be
///   classified here, or <see cref="TheRemovalCapableApiSurface_IsDerivedFromTheIl_AndEveryMemberIsClassified"/>
///   refuses.</description></item>
///   <item><description><b>Reach B — the text of every <c>.cs</c> file under <c>src/</c></b>, all eight
///   projects. It reaches the two WPF hosts and <c>St4i.Connector.Conformance</c>, which Reach A does not; it
///   reaches SQL, which Reach A cannot see at all; and it reaches ARGUMENT VALUES
///   (<c>overwrite: true</c>, <c>FileMode.Create</c>), which decide whether a removal-capable call removes
///   anything and which are invisible in a metadata signature.</description></item>
///   <item><description><b>Reach C — execution.</b> Every store in <see cref="OperatorArtifacts"/>,
///   constructed for real over a deliberately unreadable artifact in this test's own temp directory, and the
///   outcome observed. (That table is the population; its size is not restated here.) This is the only reach
///   that can answer "do they behave differently", because the other two can only read code.</description></item>
/// </list></para>
///
/// <para>🔴 <b>WHAT IS OUTSIDE ALL THREE, NAMED RATHER THAN LEFT TO BE DISCOVERED.</b>
/// <list type="number">
///   <item><description><b>Reach A does not cover four of the eight projects</b> —
///   <c>St4i.EdgeService</c>, <c>St4i.Connector.Conformance</c>, <c>St4iMachineSimulator</c> and
///   <c>St4i.DesktopShell</c>. No test project references the two WPF hosts at all. So in those four the
///   vocabulary is UNREFUTED: a removal spelled in a way Reach B's patterns do not match would be invisible.
///   <para><b>Its SIZE, derived rather than left as an adjective</b> (review I6). The three counts that
///   size it — how many shapes Reach B carries, how many members <see cref="ApiEffects"/> classifies as
///   removal-capable, and how many of those have no Reach B pattern at all — are asserted at the end of
///   <see cref="TheRemovalCapableApiSurface_IsDerivedFromTheIl_AndEveryMemberIsClassified"/> and are
///   deliberately NOT repeated here. Read them there. What this paragraph is for is the part an assertion
///   cannot carry: <c>File.Replace</c>, <c>File.Copy/3</c>, <c>File.WriteAllLines</c>,
///   <c>File.CreateText</c>, <c>File.OpenWrite</c>, <c>FileInfo.MoveTo</c>, <c>FileInfo.Delete</c>,
///   <c>DirectoryInfo.Delete</c>, <c>FileSystemInfo.Delete</c>, <c>StreamWriter..ctor/1</c> and the async
///   writers are the KINDS of removal that have no text pattern; inside Reach A each is caught red by
///   <see cref="EveryRemovalCapableCallTheIlSees_IsAlsoSeenByTheSourceScan"/>, and outside it each is
///   silent.</para>
///   <para>🔴 <b>The bound offered on this hole is NARROWER than it first read.</b> It used to say "no
///   persistent store lives in any of the four". That is true and it is not the whole picture, and a
///   universal denial with nothing able to refute it is the shape this file exists to catch. What is
///   measured: <see cref="ExpectedRemovalSites"/> pins, by name, the files in those four projects that DO
///   destroy bytes — <c>App.xaml.cs</c>, <c>FleetService.cs</c>, <c>InspectorViewModel.cs</c> and
///   <c>MainWindow.xaml.cs</c> — and one of them, <c>InspectorViewModel</c>'s <c>File.WriteAllText</c> to
///   an operator-CHOSEN export path, can overwrite an operator's file. (Named rather than counted: the
///   pinned table is the census, and a count of it here would be a second copy of it.) What is true is only
///   the narrow claim: none of the four owns a store whose artifact this product persists and re-reads, so
///   none appears in the posture table.</para></description></item>
///   <item><description><b>SQL is unrefuted everywhere.</b> Reach A cannot see a string. The SQL vocabulary
///   is the set of SQL statements that remove or replace stored rows, which is a closed set in SQLite
///   (<c>DELETE</c>, <c>DROP</c>, <c>TRUNCATE</c>—absent in SQLite—, <c>REPLACE</c>/<c>INSERT OR REPLACE</c>,
///   <c>ON CONFLICT … DO UPDATE</c>, and <c>UPDATE … SET</c>), but nothing here proves a statement was not
///   assembled at runtime out of fragments none of those patterns match.</description></item>
///   <item><description><b>Removal by something that is not this code.</b>
///   <c>packaging/remove-data.ps1</c>, an installer, an operator with Explorer, SQLite's own
///   <c>-wal</c>/<c>-shm</c> sidecars, the ASP.NET DataProtection key ring's own rolls, and the vendored SDK
///   under <c>examples/</c> which is the actual writer of the WAL <c>.jsonl</c> files. None is under
///   <c>src/</c>; all of them destroy bytes.
///   <para>🔴 <b>And one that IS under <c>src/</c>, which the list above used to imply did not exist</b>
///   (review M2): <c>src/St4i.EngineApi/ServiceHost/ServiceInstallVerbs.cs</c> spawns <c>sc.exe</c> through
///   <see cref="System.Diagnostics.Process"/>. A subprocess is a removal channel <b>no reach here covers</b>
///   — not the IL (the callee is <c>Process.Start</c>, which destroys nothing itself), not the text (the
///   verbs are arguments), not execution. Today it removes a service registration and no operator file, so
///   nothing is missed; the channel is named because "outside" was previously stated as if every actor
///   outside were also outside <c>src/</c>.</para></description></item>
///   <item><description><b>Reachability.</b> Reach A proves a call is EMITTED, never that it runs — the same
///   ceiling <c>SerialPortBusLinkTests</c> states for its own IL read. Nothing below claims any enumerated
///   site is reachable on any particular input.</description></item>
///   <item><description><b>One situation only.</b> See the third numbered point above. In particular a
///   deny-share lock and a Windows ACL are NOT the same situation as a malformed file even though prose
///   calls them all "unreadable" — <c>docs/startup-failure-posture.md</c> §3.1a paid for that lesson twice
///   with a measurement, and the postures below are measured with a MALFORMED artifact, which is the vector
///   that entry ended up calling the likeliest one.</description></item>
///   <item><description>🔴 <b>Reach B's lexer is line-scoped and literal-naive, and this entry replaces one
///   that was measurably false.</b> The previous wording said raw strings were "~30 single-line ones in
///   <c>ProductConfigStore</c> plus one in <c>App.xaml.cs</c>", that "none contains a removal shape today",
///   and that the IL cross-check closed the hole — <b>all three wrong</b>, and the paragraph was marked
///   "Checked, not assumed". Re-derived from scratch rather than corrected, because editing a census is how
///   the previous task produced three wrong counts in a row, and the derivation now lives in
///   <see cref="TheRawStringBlindSpot_IsMeasuredRatherThanDenied"/> so it can be refuted instead of
///   believed. How many blocks there are, in how many files, how many carry removal SQL and in how many
///   files, are all asserted in that test and deliberately not copied here — the previous version of this
///   sentence copied them and got them wrong. The IL bound could never have applied, whatever the counts:
///   the content is SQL and Reach A cannot see a string.
///   <para><b>Why the census is nevertheless right about those ten:</b> the SQL pass scans every
///   non-comment LINE, literal or not (see its own header — which used to claim the opposite). Raw-string
///   content is therefore inside its corpus. The remaining lexer gaps are real and left standing:
///   <see cref="StringLiteral"/> is not verbatim-string (<c>@"…"</c>) or raw-string aware, so the API pass
///   does not blank raw-string content; <see cref="IsCommentLine"/> does not track <c>/* */</c> across
///   lines; and the <c>File.Move(no-overwrite)</c> negative lookahead is line-bounded, so a three-argument
///   <c>File.Move</c> split across lines would be misclassified. Inside Reach A all three are closed by the
///   IL cross-check; outside it they are open, and that is the honest statement.</para></description></item>
/// </list></para>
///
/// <para><b>PRECONDITION.</b> Like <c>PerHostDataRootsTests</c> and <c>EnumSpellingContractTests</c>, Reach B
/// requires being run from inside the source tree. A scan that cannot find its corpus has measured nothing,
/// and "nothing measured" must never read as "nothing wrong", so it fails rather than passing.</para>
///
/// <para>🔴 <b>THE RULE THIS FILE IS WRITTEN UNDER, AND IT WAS BOUGHT HERE RATHER THAN BROUGHT HERE.</b>
///
/// <code>
///   WHERE AN ASSERTION HOLDS A NUMBER, DO NOT RESTATE THE NUMBER IN PROSE — NAME THE ASSERTION.
/// </code>
///
/// <para>A scalar copied into a comment is <b>a second, uncounted copy that nothing checks</b>: the original
/// defect with an extra step. The first version of this file argued at length that "a scalar summarising a
/// set nobody has enumerated is not a fact", turned those scalars into assertions — and then <b>left the
/// refuted numbers standing in the comments beside them</b>. Some survivors were contradicted by an
/// assertion in the same method, one of them a few lines below a paragraph correcting that very number; and
/// one had propagated arithmetically into a second wrong number, computed off a scalar the run had already
/// refuted. A review named several instances; sweeping the file for the SHAPE rather than fixing the named
/// instances found more than twice as many, <b>including one in this paragraph's own first draft</b>, which
/// is why this paragraph now names no count either.</para>
///
/// <para>So the rule is not "assert your numbers". It is <b>"do not keep a copy"</b> — because the copy is
/// what rots, and it rots in the artifact a reader trusts most, the one explaining what the assertion means.
/// Every count below is therefore either absent from the prose and named by its assertion, or, where the
/// number genuinely belongs in a sentence (a quoted claim, a record of a correction), stated together with
/// how it was derived and what asserts it now.</para></para>
/// </summary>
public sealed class OperatorDataRemovalCensusTests
{
    // ══ THE TREE ═══════════════════════════════════════════════════════════════════════════════════════

    private static string MachineSimulatorRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "README.md")) &&
                File.Exists(Path.Combine(dir.FullName, "fleet.json")) &&
                Directory.Exists(Path.Combine(dir.FullName, "docs")))
            {
                return dir.FullName;
            }

            dir = dir.Parent;
        }

        throw new InvalidOperationException(
            "Could not locate tools/machine-simulator (README.md + fleet.json + docs/) by walking up from " +
            $"\"{AppContext.BaseDirectory}\". If the output layout changed, fix this walk — do NOT weaken " +
            "the assertions below to make the corpus findable.");
    }

    /// <summary>Every C# file the product ships, all eight projects, build output excluded. Closed at the
    /// filesystem, which is the one place this reach can close.</summary>
    private static IReadOnlyList<string> ProductSources()
    {
        var srcRoot = Path.Combine(MachineSimulatorRoot(), "src");
        if (!Directory.Exists(srcRoot))
        {
            throw new InvalidOperationException(
                $"{srcRoot} does not exist. Every scan below would return nothing and every enumeration " +
                "would agree with an empty expectation, which is the failure mode this file exists to avoid.");
        }

        return Directory.EnumerateFiles(srcRoot, "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.Ordinal)
                     && !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
            .OrderBy(f => f, StringComparer.Ordinal)
            .ToList();
    }

    private static string Relative(string absolutePath) =>
        Path.GetRelativePath(MachineSimulatorRoot(), absolutePath).Replace(Path.DirectorySeparatorChar, '/');

    // ══ THE VOCABULARY — DERIVED, THEN CLASSIFIED ══════════════════════════════════════════════════════
    //
    // 🔴 The brief's own warning, and the reason this section is not a grep: `Delete(` is a VOCABULARY, and a
    // vocabulary is a domain inherited from wherever its author happened to be standing. Measured on this
    // tree, `grep -rn "Delete(" src/ --include=*.cs` is wrong in BOTH directions at once: most of what it
    // returns is `MapDelete(` route REGISTRATIONS and doc-comment prose, which remove nothing, and it misses
    // every `File.Move(..., overwrite: true)`, every whole-file rewrite and every SQL statement — which is
    // where nearly all of this product's byte destruction actually happens. Every count in that sentence is
    // asserted in TheDeleteVocabularyThisTaskArrivedWith_IsATrueLowerBound_AndUselessAsACensus and is not
    // repeated here.
    //
    // So the population is closed somewhere a tool can reach instead: the TYPES through which a .NET program
    // can make an existing filesystem entry's bytes stop being retrievable. That set is small and arguable,
    // which is what a stated domain should be. `System.IO.Path` is excluded because it is pure string
    // arithmetic — no member of it touches a byte.
    //
    // 🔴 `Stream`/`TextWriter` ARE ALSO EXCLUDED, AND THE REASON FIRST GIVEN FOR IT WAS FALSE (review M1).
    // It said "by the time you hold one, the decision to truncate was already taken by whichever member
    // below opened it". `Stream.SetLength(0)` refutes that: a handle opened with `FileMode.Open` — the one
    // mode Reach B has no pattern for — truncates on the STREAM, with the decision taken there and nowhere
    // else. And it escapes all three reaches, not just this one: Roslyn emits virtual calls against the
    // least-overridden declaration, so `FileStream.SetLength` resolves to `System.IO.Stream`, which is not
    // in the list below; Reach B has no pattern; Reach C drives only constructors.
    //
    // The honest statement is therefore a COST, not a justification: these two types carry a large surface
    // (`Write`, `Flush`, `CopyTo`, `Seek`, `SetLength`) of which exactly one member is removal-capable, and
    // including them would put every stream write in this product into a classification table that exists
    // to make removal visible. The escape is real, it is named here, and it is bounded by a MEASUREMENT
    // rather than by this paragraph: `TheSourceScanner_…`'s last assertion pins `.SetLength(` at ZERO
    // occurrences under `src/`. Zero is a lower bound on what the reaches would miss, and the day it stops
    // being zero the assertion goes red and somebody decides.

    private static readonly string[] ByteOwningTypes =
    [
        "System.IO.File",
        "System.IO.Directory",
        "System.IO.FileInfo",
        "System.IO.DirectoryInfo",
        "System.IO.FileSystemInfo",
        "System.IO.FileStream",
        "System.IO.StreamWriter",
    ];

    /// <summary>What each member of a <see cref="ByteOwningTypes"/> type does to bytes that were already at
    /// the target. Keyed <c>Type.Member/arity</c> so overloads are distinguished — which matters, and is the
    /// single thing a source regex gets wrong most often here: <c>File.Move/2</c> THROWS when the destination
    /// exists and therefore destroys nothing, while <c>File.Move/3</c> carries the <c>overwrite</c> flag and
    /// is this codebase's universal atomic-rewrite idiom.
    ///
    /// <para><c>MODE</c> means the answer is an ARGUMENT, not a signature: <c>FileMode.Create</c> truncates
    /// and <c>FileMode.Open</c> does not, and metadata cannot see which was passed. Those are removal-capable
    /// and Reach B reads the argument.</para></summary>
    private enum Effect
    {
        /// <summary>Cannot make prior bytes unretrievable.</summary>
        None,

        /// <summary>The entry itself stops existing.</summary>
        Unlink,

        /// <summary>Prior bytes at the target are replaced wholesale.</summary>
        Replace,

        /// <summary>Removal-capable, but decided by an argument this reach cannot see.</summary>
        Mode,
    }

    private static readonly Dictionary<string, Effect> ApiEffects = new(StringComparer.Ordinal)
    {
        // ── System.IO.File ────────────────────────────────────────────────────────────────────────────
        ["System.IO.File.Delete/1"] = Effect.Unlink,
        ["System.IO.File.Move/2"] = Effect.None,          // throws when the destination exists
        ["System.IO.File.Move/3"] = Effect.Replace,       // the overwrite flag
        ["System.IO.File.Copy/2"] = Effect.None,          // throws when the destination exists
        ["System.IO.File.Copy/3"] = Effect.Replace,
        ["System.IO.File.Replace/3"] = Effect.Replace,
        ["System.IO.File.Replace/4"] = Effect.Replace,
        ["System.IO.File.WriteAllText/2"] = Effect.Replace,
        ["System.IO.File.WriteAllText/3"] = Effect.Replace,
        ["System.IO.File.WriteAllBytes/2"] = Effect.Replace,
        ["System.IO.File.WriteAllLines/2"] = Effect.Replace,
        ["System.IO.File.WriteAllLines/3"] = Effect.Replace,
        ["System.IO.File.WriteAllTextAsync/3"] = Effect.Replace,
        ["System.IO.File.WriteAllTextAsync/4"] = Effect.Replace,
        ["System.IO.File.WriteAllBytesAsync/3"] = Effect.Replace,
        ["System.IO.File.Create/1"] = Effect.Replace,     // truncates an existing file to zero
        ["System.IO.File.Create/2"] = Effect.Replace,
        ["System.IO.File.Create/3"] = Effect.Replace,
        ["System.IO.File.CreateText/1"] = Effect.Replace,
        ["System.IO.File.Open/2"] = Effect.Mode,
        ["System.IO.File.Open/3"] = Effect.Mode,
        ["System.IO.File.Open/4"] = Effect.Mode,
        ["System.IO.File.OpenWrite/1"] = Effect.Mode,     // opens at 0 without truncating: overwrites a prefix
        ["System.IO.File.SetAttributes/2"] = Effect.None,
        ["System.IO.File.SetLastWriteTimeUtc/2"] = Effect.None,
        ["System.IO.File.Exists/1"] = Effect.None,
        ["System.IO.File.ReadAllText/1"] = Effect.None,
        ["System.IO.File.ReadAllText/2"] = Effect.None,
        ["System.IO.File.ReadAllTextAsync/2"] = Effect.None,
        ["System.IO.File.ReadAllTextAsync/3"] = Effect.None,
        ["System.IO.File.ReadAllBytes/1"] = Effect.None,
        ["System.IO.File.ReadAllBytesAsync/2"] = Effect.None,
        ["System.IO.File.ReadAllLines/1"] = Effect.None,
        ["System.IO.File.ReadAllLinesAsync/2"] = Effect.None,
        ["System.IO.File.ReadLines/1"] = Effect.None,
        ["System.IO.File.AppendAllText/2"] = Effect.None,
        ["System.IO.File.AppendAllText/3"] = Effect.None,
        ["System.IO.File.AppendAllLines/2"] = Effect.None,
        ["System.IO.File.AppendText/1"] = Effect.None,
        ["System.IO.File.OpenRead/1"] = Effect.None,
        ["System.IO.File.OpenText/1"] = Effect.None,
        ["System.IO.File.GetLastWriteTimeUtc/1"] = Effect.None,
        ["System.IO.File.GetAttributes/1"] = Effect.None,

        // ── System.IO.Directory ───────────────────────────────────────────────────────────────────────
        ["System.IO.Directory.Delete/1"] = Effect.Unlink,
        ["System.IO.Directory.Delete/2"] = Effect.Unlink, // the recursive flag
        ["System.IO.Directory.Move/2"] = Effect.None,     // throws when the destination exists
        ["System.IO.Directory.CreateDirectory/1"] = Effect.None,
        ["System.IO.Directory.Exists/1"] = Effect.None,
        ["System.IO.Directory.EnumerateFiles/1"] = Effect.None,
        ["System.IO.Directory.EnumerateFiles/2"] = Effect.None,
        ["System.IO.Directory.EnumerateFiles/3"] = Effect.None,
        ["System.IO.Directory.EnumerateDirectories/1"] = Effect.None,
        ["System.IO.Directory.EnumerateDirectories/2"] = Effect.None,
        ["System.IO.Directory.EnumerateFileSystemEntries/1"] = Effect.None,
        ["System.IO.Directory.EnumerateFileSystemEntries/3"] = Effect.None,
        ["System.IO.Directory.GetFiles/1"] = Effect.None,
        ["System.IO.Directory.GetFiles/2"] = Effect.None,
        ["System.IO.Directory.GetFiles/3"] = Effect.None,
        ["System.IO.Directory.GetDirectories/1"] = Effect.None,
        ["System.IO.Directory.GetCurrentDirectory/0"] = Effect.None,
        ["System.IO.Directory.GetLastWriteTimeUtc/1"] = Effect.None,

        // ── instance shapes ───────────────────────────────────────────────────────────────────────────
        ["System.IO.FileInfo..ctor/1"] = Effect.None,
        ["System.IO.FileInfo.get_Length/0"] = Effect.None,
        ["System.IO.FileInfo.Delete/0"] = Effect.Unlink,
        ["System.IO.FileInfo.MoveTo/2"] = Effect.Replace,
        ["System.IO.FileInfo.Create/0"] = Effect.Replace,
        ["System.IO.FileInfo.CreateText/0"] = Effect.Replace,
        ["System.IO.FileInfo.Replace/2"] = Effect.Replace,
        ["System.IO.DirectoryInfo..ctor/1"] = Effect.None,
        ["System.IO.DirectoryInfo.Delete/0"] = Effect.Unlink,
        ["System.IO.DirectoryInfo.Delete/1"] = Effect.Unlink,
        ["System.IO.DirectoryInfo.Create/0"] = Effect.None,
        ["System.IO.DirectoryInfo.CreateSubdirectory/1"] = Effect.None,
        ["System.IO.DirectoryInfo.EnumerateFiles/0"] = Effect.None,
        ["System.IO.DirectoryInfo.EnumerateFiles/2"] = Effect.None,
        ["System.IO.DirectoryInfo.GetFiles/0"] = Effect.None,
        ["System.IO.DirectoryInfo.GetFiles/1"] = Effect.None,
        ["System.IO.FileSystemInfo.get_FullName/0"] = Effect.None,
        ["System.IO.FileSystemInfo.get_Name/0"] = Effect.None,
        ["System.IO.FileSystemInfo.get_Exists/0"] = Effect.None,
        ["System.IO.FileSystemInfo.get_Length/0"] = Effect.None,
        ["System.IO.FileSystemInfo.get_LastWriteTimeUtc/0"] = Effect.None,
        ["System.IO.FileSystemInfo.get_Extension/0"] = Effect.None,
        ["System.IO.FileSystemInfo.Delete/0"] = Effect.Unlink,
        ["System.IO.FileStream.Flush/1"] = Effect.None,   // Flush(flushToDisk) — pushes bytes, removes none
        ["System.IO.FileStream..ctor/3"] = Effect.Mode,
        ["System.IO.FileStream..ctor/4"] = Effect.Mode,
        ["System.IO.FileStream..ctor/5"] = Effect.Mode,
        ["System.IO.StreamWriter..ctor/1"] = Effect.Replace,  // (string path) truncates
        ["System.IO.StreamWriter..ctor/2"] = Effect.Mode,     // (string, bool append) — or (Stream, Encoding)
        ["System.IO.StreamWriter..ctor/3"] = Effect.Mode,
    };

    private static bool Removes(Effect e) => e is Effect.Unlink or Effect.Replace or Effect.Mode;

    // ══ REACH A — THE IL ═══════════════════════════════════════════════════════════════════════════════

    private static readonly Dictionary<short, OpCode> OpCodeByValue = typeof(OpCodes)
        .GetFields(BindingFlags.Public | BindingFlags.Static)
        .Where(f => f.FieldType == typeof(OpCode))
        .Select(f => (OpCode)f.GetValue(null)!)
        .GroupBy(o => o.Value)
        .ToDictionary(g => g.Key, g => g.First());

    private static Assembly[] AssembliesInReachA() =>
    [
        typeof(Program).Assembly,                                       // St4i.EngineApi
        typeof(FleetSettingsStore).Assembly,                            // St4i.EdgeCore
        typeof(St4i.Connector.Abstractions.Models.DeviceClass).Assembly, // St4i.Connector.Abstractions
        typeof(St4i.EdgeCore.Drivers.Modbus.SerialPortBusLink).Assembly, // St4i.EdgeCore.Serial
    ];

    /// <summary>One observed call: which assembly emitted it, in which method, to which BCL member.</summary>
    private sealed record IlCall(string Assembly, string Caller, string Api);

    /// <summary>Every call instruction in every method body of <paramref name="assembly"/> whose target
    /// declaring type is one of <see cref="ByteOwningTypes"/>.
    ///
    /// <para>The walk is a real decode, not a byte scan for <c>0x28</c>: operand lengths come from
    /// <see cref="OpCode.OperandType"/> on the table read out of <see cref="OpCodes"/>, so a token-shaped
    /// byte inside another instruction's operand cannot be mistaken for a call. A byte scan can over-report
    /// as well as under-report, and a census that over-reports names sites that do not exist.</para>
    ///
    /// <para><paramref name="unresolved"/> counts tokens the decode framed correctly but reflection refused
    /// to resolve. It is asserted to be zero rather than swallowed: silent under-reporting is exactly how an
    /// absence claim becomes vacuous.</para></summary>
    private static List<IlCall> WalkCalls(Assembly assembly, out int unresolved)
    {
        var found = new List<IlCall>();
        var misses = 0;
        var watched = ByteOwningTypes.ToHashSet(StringComparer.Ordinal);

        foreach (var type in SafeTypes(assembly))
        {
            const BindingFlags Flags = BindingFlags.Public | BindingFlags.NonPublic |
                                       BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly;

            IEnumerable<MethodBase> methods;
            try
            {
                methods = type.GetMethods(Flags).Cast<MethodBase>().Concat(type.GetConstructors(Flags));
            }
            catch (Exception)
            {
                continue;
            }

            foreach (var method in methods)
            {
                byte[]? il;
                try
                {
                    il = method.GetMethodBody()?.GetILAsByteArray();
                }
                catch (Exception)
                {
                    continue;
                }

                if (il is null) continue;

                foreach (var token in CallTokens(il))
                {
                    MethodBase? callee;
                    try
                    {
                        callee = method.Module.ResolveMethod(
                            token,
                            type.IsGenericType ? type.GetGenericArguments() : null,
                            method.IsGenericMethod ? method.GetGenericArguments() : null);
                    }
                    catch (Exception)
                    {
                        misses++;
                        continue;
                    }

                    var declaring = callee?.DeclaringType?.FullName;
                    if (declaring is null || !watched.Contains(declaring)) continue;

                    found.Add(new IlCall(
                        assembly.GetName().Name!,
                        $"{type.FullName}.{method.Name}",
                        $"{declaring}.{callee!.Name}/{callee.GetParameters().Length}"));
                }
            }
        }

        unresolved = misses;
        return found;
    }

    private static IEnumerable<Type> SafeTypes(Assembly assembly)
    {
        try
        {
            return assembly.GetTypes();
        }
        catch (ReflectionTypeLoadException ex)
        {
            return ex.Types.Where(t => t is not null)!;
        }
    }

    /// <summary>The metadata tokens of every <c>call</c>/<c>callvirt</c>/<c>newobj</c>/<c>ldftn</c>/
    /// <c>ldvirtftn</c> in a method body, framed by a full instruction-length decode.</summary>
    /// <summary>🔴 Decode aborts, counted rather than swallowed (review M3). <see cref="CallTokens"/> stops
    /// walking a body the moment it cannot frame the next instruction, which is the honest move — mis-framed
    /// bytes are how a byte scan invents call sites — but stopping silently is the same failure mode the
    /// <c>unresolved</c> counter beside it calls out in its own comment ("silent under-reporting is exactly
    /// how an absence claim becomes vacuous"). One guard was asserted to zero and its twin was not. Now both
    /// are.</summary>
    private static int _decodeAborts;

    private static IEnumerable<int> CallTokens(byte[] il)
    {
        var i = 0;
        while (i < il.Length)
        {
            short value;
            if (il[i] == 0xFE && i + 1 < il.Length)
            {
                value = (short)(0xFE00 | il[i + 1]);
                i += 2;
            }
            else
            {
                value = il[i];
                i += 1;
            }

            if (!OpCodeByValue.TryGetValue(value, out var op))
            {
                // An opcode this decode does not know. Stopping is the honest move: everything after it
                // would be mis-framed, and mis-framed bytes are how a byte scan invents call sites.
                Interlocked.Increment(ref _decodeAborts);
                yield break;
            }

            var operand = op.OperandType switch
            {
                OperandType.InlineNone => 0,
                OperandType.ShortInlineBrTarget or OperandType.ShortInlineI or OperandType.ShortInlineVar => 1,
                OperandType.InlineVar => 2,
                OperandType.InlineI8 or OperandType.InlineR => 8,
                OperandType.InlineSwitch => 4 + (4 * (i + 4 <= il.Length ? BitConverter.ToInt32(il, i) : 0)),
                _ => 4,
            };

            if (op.OperandType is OperandType.InlineMethod && i + 4 <= il.Length)
            {
                yield return BitConverter.ToInt32(il, i);
            }

            // 🔴 `operand < 0` is review M4: an adversarial `switch` count can overflow `4 * N`. Compiled
            // IL cannot produce it, but a negative step would walk BACKWARDS forever, and the length guard
            // below only catches overrun. Both directions abort, and both are counted.
            if (operand < 0)
            {
                Interlocked.Increment(ref _decodeAborts);
                yield break;
            }

            i += operand;
            if (i > il.Length)
            {
                Interlocked.Increment(ref _decodeAborts);
                yield break;
            }
        }
    }

    // ══ REACH B — THE SOURCE TEXT ══════════════════════════════════════════════════════════════════════
    //
    // Two passes over the same corpus, and they are NOT mirror images — this header used to say they were,
    // and the code has always disagreed with it. Saying what each one does, from the code:
    //
    //   * The API pass BLANKS every `"…"` literal and cuts every trailing `//`, then matches. A doc comment
    //     that NAMES `File.Delete` is therefore not counted as a call, which is most of what the `Delete(`
    //     vocabulary was actually counting.
    //
    //   * The SQL pass skips comment-LEADING lines and then matches the WHOLE LINE — literal or not. It
    //     does no literal extraction at all.
    //
    // 🔴 THE SECOND ONE IS DELIBERATE, AND THE REVIEW IS THE REASON THIS PARAGRAPH EXISTS. The header
    // previously claimed the SQL pass "reads ONLY inside literals" and the method's own doc comment claimed
    // it read "every statement in a string literal". Both were false, and their being false is WHY the SQL
    // census is correct: `StringLiteral` is not raw-string aware, so a literal-only pass would have had to
    // extract `"""…"""` blocks — and raw-string blocks in this tree DO carry removal SQL, counted and
    // asserted in TheRawStringBlindSpot_IsMeasuredRatherThanDenied. The documented instrument would have
    // missed every one of them; the implemented one misses none. Two false self-descriptions cancelling each
    // other, in a file whose own finding #2 is "the store describes itself falsely". The code is now the
    // authority and this comment describes it.
    //
    // What scanning whole lines costs, stated rather than discovered: a trailing `// … DELETE FROM …` on a
    // code line counts as a SQL removal site. That is a false positive by construction. It is accepted
    // because the pinned enumeration is checked against the tree on every run, so such a hit would appear
    // in the table where a reader can see and challenge it — whereas a missed raw-string block would be
    // invisible. An over-reporting census is arguable; an under-reporting one is not.

    private static readonly Regex StringLiteral = new("\"(?:\\\\.|[^\"\\\\])*\"", RegexOptions.Compiled);

    private static string CodeOnly(string line)
    {
        var blanked = StringLiteral.Replace(line, "\"\"");
        var comment = blanked.IndexOf("//", StringComparison.Ordinal);
        return comment >= 0 ? blanked[..comment] : blanked;
    }

    private static bool IsCommentLine(string line)
    {
        var t = line.TrimStart();
        return t.StartsWith("//", StringComparison.Ordinal)
            || t.StartsWith("*", StringComparison.Ordinal)
            || t.StartsWith("/*", StringComparison.Ordinal);
    }

    /// <summary>The API-call pass: for every file, the set of removal-capable BCL call shapes its executable
    /// text mentions. Keyed by shape rather than by line number — a position is a pointer that decays
    /// without anybody touching it, which is the discipline <c>docs/startup-failure-posture.md</c> adopted
    /// after a line-distance pointer in <c>Program.cs</c> was found stale by 66 lines (§8.1(h8)).</summary>
    private static SortedDictionary<string, SortedSet<string>> SourceRemovalSites()
    {
        var result = new SortedDictionary<string, SortedSet<string>>(StringComparer.Ordinal);

        foreach (var file in ProductSources())
        {
            var hits = new SortedSet<string>(StringComparer.Ordinal);

            foreach (var raw in File.ReadLines(file))
            {
                if (IsCommentLine(raw)) continue;
                var code = CodeOnly(raw);

                foreach (var (pattern, shape) in SourcePatterns)
                {
                    if (pattern.IsMatch(code)) hits.Add(shape);
                }
            }

            if (hits.Count > 0) result[Relative(file)] = hits;
        }

        return result;
    }

    /// <summary>The shapes Reach B looks for, and the argument values that decide them. These are named
    /// SHAPES rather than API names precisely because the argument is the discriminator:
    /// <c>File.Move/3</c> is one shape when <c>overwrite</c> is true and a different one when it is not.</summary>
    private static readonly (Regex Pattern, string Shape)[] SourcePatterns =
    [
        (new Regex(@"\bFile\.Delete\s*\(", RegexOptions.Compiled), "File.Delete"),
        (new Regex(@"\bDirectory\.Delete\s*\(", RegexOptions.Compiled), "Directory.Delete"),
        (new Regex(@"\bFile\.Move\s*\([^;]*overwrite:\s*true", RegexOptions.Compiled), "File.Move(overwrite:true)"),
        (new Regex(@"\bFile\.Move\s*\((?![^;]*overwrite:\s*true)", RegexOptions.Compiled), "File.Move(no-overwrite)"),
        (new Regex(@"\bFile\.WriteAllText\s*\(", RegexOptions.Compiled), "File.WriteAllText"),
        (new Regex(@"\bFile\.WriteAllBytes\s*\(", RegexOptions.Compiled), "File.WriteAllBytes"),
        (new Regex(@"\bFile\.Create\s*\(", RegexOptions.Compiled), "File.Create"),
        (new Regex(@"\bFileMode\.Create\b", RegexOptions.Compiled), "FileMode.Create"),
        (new Regex(@"\bFileMode\.Truncate\b", RegexOptions.Compiled), "FileMode.Truncate"),
    ];

    /// <summary>The SQL pass's vocabulary: the statements SQLite offers for removing or replacing stored
    /// rows. Reach A is blind to every one of them — a SQL statement is a string, and a string has no
    /// metadata.</summary>
    private static readonly (Regex Pattern, string Shape)[] SqlPatterns =
    [
        (new Regex(@"\bDELETE\s+FROM\s+", RegexOptions.Compiled | RegexOptions.IgnoreCase), "DELETE FROM"),
        (new Regex(@"\bDROP\s+TABLE\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), "DROP TABLE"),
        (new Regex(@"\bDROP\s+INDEX\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), "DROP INDEX"),
        (new Regex(@"\bINSERT\s+OR\s+REPLACE\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), "INSERT OR REPLACE"),
        (new Regex(@"\bREPLACE\s+INTO\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), "REPLACE INTO"),
        (new Regex(@"\bDO\s+UPDATE\s+SET\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), "ON CONFLICT DO UPDATE SET"),
        (new Regex(@"\bUPDATE\s+\w+\s+SET\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), "UPDATE SET"),
        (new Regex(@"\bTRUNCATE\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), "TRUNCATE"),
    ];

    /// <summary>Every file under <c>src/</c> whose non-comment text contains a row-removing or
    /// row-replacing SQL statement, and which ones.
    ///
    /// <para>🔴 <b>It matches the WHOLE LINE, literal or not</b> — see the section header for why that is
    /// the deliberate choice and what it costs. This doc comment previously said "every statement in a
    /// string literal", which the method has never done.</para></summary>
    private static SortedDictionary<string, SortedSet<string>> SqlRemovalSites()
    {
        var result = new SortedDictionary<string, SortedSet<string>>(StringComparer.Ordinal);

        foreach (var file in ProductSources())
        {
            var hits = new SortedSet<string>(StringComparer.Ordinal);

            foreach (var raw in File.ReadLines(file))
            {
                if (IsCommentLine(raw)) continue;

                foreach (var (pattern, shape) in SqlPatterns)
                {
                    if (pattern.IsMatch(raw)) hits.Add(shape);
                }
            }

            if (hits.Count > 0) result[Relative(file)] = hits;
        }

        return result;
    }

    private static string Render(SortedDictionary<string, SortedSet<string>> census) =>
        string.Join("\n", census.Select(kv => $"  [\"{kv.Key}\"] = \"{string.Join(", ", kv.Value)}\","));

    // ══ FACTS — REACH A ════════════════════════════════════════════════════════════════════════════════

    [Fact]
    public void TheIlWalker_ResolvesEveryTokenItFrames_AndSeesCallsItIsSupposedToSee()
    {
        // Positive control, and it comes FIRST because everything else in Reach A is an "and nothing else"
        // claim. A walker pointed at the wrong assemblies, or one whose decode desynchronised, produces a
        // confident empty answer — the failure mode `mutate-guard.sh`'s own header names.
        var byAssembly = AssembliesInReachA()
            .ToDictionary(a => a.GetName().Name!, a => WalkCalls(a, out _));

        Assert.Equal(
            ["St4i.Connector.Abstractions", "St4i.EdgeCore", "St4i.EdgeCore.Serial", "St4i.EngineApi"],
            byAssembly.Keys.OrderBy(k => k, StringComparer.Ordinal).ToArray());

        var edgeCore = byAssembly["St4i.EdgeCore"].Select(c => c.Api).ToHashSet(StringComparer.Ordinal);

        // The shapes below MUST be visible, and they are chosen so that each is a different way for the
        // decode to be broken: a plain static call, an overload the arity must separate, and a whole-file
        // rewrite. (Listed, not counted — the assertions are the list.)
        Assert.Contains("System.IO.File.Delete/1", edgeCore);
        Assert.Contains("System.IO.File.Move/3", edgeCore);
        Assert.Contains("System.IO.File.WriteAllText/2", edgeCore);

        Interlocked.Exchange(ref _decodeAborts, 0);

        foreach (var assembly in AssembliesInReachA())
        {
            WalkCalls(assembly, out var unresolved);
            Assert.True(unresolved == 0,
                $"{assembly.GetName().Name}: the IL decode framed {unresolved} call token(s) that reflection " +
                "refused to resolve. Every assertion in Reach A is then a claim about a population this " +
                "walker did not finish reading. Fix the walker; do not lower this to a tolerance.");
        }

        // 🔴 The twin guard, asserted symmetrically (review M3/M4). A body the decode abandoned part-way is
        // a body whose remaining call sites were never looked at, which is the same vacuity the
        // `unresolved` assertion above refuses — and until this line existed, one of the two was policed
        // and the other was not.
        Assert.True(Volatile.Read(ref _decodeAborts) == 0,
            $"the IL decode abandoned {Volatile.Read(ref _decodeAborts)} method body/bodies part-way — an " +
            "unknown opcode, an operand running past the end of the body, or a negative operand length. " +
            "Every call site after the abort point in those bodies is unread, so Reach A's 'and nothing " +
            "else' assertions are claims about a population it did not finish walking.");
    }

    [Fact]
    public void TheRemovalCapableApiSurface_IsDerivedFromTheIl_AndEveryMemberIsClassified()
    {
        // 🔴 THE POINT OF THIS FILE, in one assertion. The vocabulary is not a list somebody thought of; it
        // is whatever this product actually calls on a byte-owning type, read out of the shipped IL. A new
        // call to a member nobody has classified turns this red and makes somebody decide whether it can
        // destroy an operator's bytes — which is the question `grep "Delete("` cannot ask.
        var observed = AssembliesInReachA()
            .SelectMany(a => WalkCalls(a, out _))
            .Select(c => c.Api)
            .ToHashSet(StringComparer.Ordinal);

        Assert.NotEmpty(observed);

        var unclassified = observed.Where(api => !ApiEffects.ContainsKey(api))
            .OrderBy(a => a, StringComparer.Ordinal).ToList();

        Assert.True(unclassified.Count == 0,
            "St4i now calls member(s) of a byte-owning BCL type that this file has never classified. Decide, " +
            "for each, whether it can make bytes that were already at the target unretrievable, and add it to " +
            "ApiEffects — a member left out is a removal path this census cannot see:\n  " +
            string.Join("\n  ", unclassified.Select(a => $"[\"{a}\"] = Effect.???,")));

        // And the classification is not allowed to rot into fiction the other way either: an entry naming a
        // member nothing calls any more is a sentence, not a measurement. Kept as a report rather than a
        // failure, because ApiEffects deliberately classifies the whole *shape* space of these seven types.
        Assert.True(ApiEffects.Keys.Any(observed.Contains),
            "ApiEffects and the observed IL surface have no member in common at all, which means one of them " +
            "is measuring something else entirely.");

        // 🔴 THE SIZE OF REACH B's HOLE, derived from this file's own data rather than left as an adjective
        // (review I6). The brief's scalar rule says a number is the right answer where the population is
        // closed at the tool's reach, and both of these are: the removal-capable half of a table in this
        // file, and the pattern array beside it. The three assertions below ARE that number — they are the
        // only statement of it in this file, and nothing restates them in prose.
        //
        // 🔴 THIS BLOCK IS WHERE THE RULE AT THE TOP OF THE FILE WAS BOUGHT. It used to open by narrating
        // the answer: "nine shapes against twenty-six removal-capable members, so seventeen have no Reach B
        // pattern". Twenty-six was a guess the very next line refuted (the run says thirty-seven), and
        // seventeen was 26 − 9 — a wrong scalar PROPAGATING ARITHMETICALLY into a second wrong scalar, in a
        // comment sitting on top of the assertion that contradicted it. Nothing checks a sentence.
        var removalCapable = ApiEffects.Where(kv => Removes(kv.Value)).Select(kv => kv.Key).ToList();
        var unreachableByText = removalCapable.Where(api => ShapesFor(api).Length == 0)
            .OrderBy(a => a, StringComparer.Ordinal).ToList();

        Assert.Equal(37, removalCapable.Count);
        Assert.Equal(9, SourcePatterns.Length);
        Assert.Equal(21, unreachableByText.Count);
    }

    [Fact]
    public void EveryRemovalCapableCallTheIlSees_IsAlsoSeenByTheSourceScan()
    {
        // 🔴 THE REFUTER. Reach B is a text scan and therefore has a vocabulary; this is the arm that can
        // prove the vocabulary is short. For each assembly Reach A covers, every removal-capable shape the
        // IL contains must also have been found by the patterns in that project's own source directory. A
        // removal spelled some way the patterns do not match — a fully-qualified call, an alias, a helper
        // wrapper, an overload — shows up here as a shape the IL has and the text does not.
        var projectDirOf = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["St4i.EngineApi"] = "src/St4i.EngineApi/",
            ["St4i.EdgeCore"] = "src/St4i.EdgeCore/",
            ["St4i.EdgeCore.Serial"] = "src/St4i.EdgeCore.Serial/",
            ["St4i.Connector.Abstractions"] = "src/St4i.Connector.Abstractions/",
        };

        var source = SourceRemovalSites();
        var missing = new List<string>();

        foreach (var assembly in AssembliesInReachA())
        {
            var name = assembly.GetName().Name!;
            var dir = projectDirOf[name];
            var textShapes = source
                .Where(kv => kv.Key.StartsWith(dir, StringComparison.Ordinal))
                .SelectMany(kv => kv.Value)
                .ToHashSet(StringComparer.Ordinal);

            foreach (var call in WalkCalls(assembly, out _))
            {
                if (!ApiEffects.TryGetValue(call.Api, out var effect) || !Removes(effect)) continue;
                if (!ShapesFor(call.Api).Any(textShapes.Contains))
                {
                    missing.Add($"{name}: IL calls {call.Api} (from {call.Caller}) and no source pattern found it");
                }
            }
        }

        Assert.True(missing.Count == 0,
            "The IL contains a removal-capable call that the source-text scan's vocabulary cannot see. That " +
            "vocabulary is what the enumeration below is built out of, so the enumeration is short by at " +
            "least these:\n  " + string.Join("\n  ", missing.Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal)));
    }

    /// <summary>Which Reach B shape names could account for a Reach A member. One-to-many because an
    /// argument splits some members into two shapes, and because <c>FileStream</c>/<c>StreamWriter</c>
    /// constructors are spelled by their MODE argument in source rather than by their type name.</summary>
    private static string[] ShapesFor(string api) => api switch
    {
        "System.IO.File.Delete/1" => ["File.Delete"],
        "System.IO.Directory.Delete/1" or "System.IO.Directory.Delete/2" => ["Directory.Delete"],
        "System.IO.File.Move/3" => ["File.Move(overwrite:true)", "File.Move(no-overwrite)"],
        "System.IO.File.Move/2" => ["File.Move(no-overwrite)"],
        "System.IO.File.WriteAllText/2" or "System.IO.File.WriteAllText/3" => ["File.WriteAllText"],
        "System.IO.File.WriteAllBytes/2" => ["File.WriteAllBytes"],
        "System.IO.File.Create/1" or "System.IO.File.Create/2" or "System.IO.File.Create/3" => ["File.Create"],
        _ when api.StartsWith("System.IO.FileStream..ctor", StringComparison.Ordinal) =>
            ["FileMode.Create", "FileMode.Truncate", "File.Create"],
        _ when api.StartsWith("System.IO.StreamWriter..ctor", StringComparison.Ordinal) =>
            ["FileMode.Create", "File.Create"],
        _ => [],
    };

    // ══ FACTS — REACH B: THE ENUMERATION ═══════════════════════════════════════════════════════════════

    /// <summary>🔴 <b>THE ENUMERATION.</b> Every file under <c>src/</c> whose executable text contains a
    /// removal-capable filesystem call, and which shapes. This is the artifact item 5 asked for, and it is
    /// pinned rather than printed: a new removal path anywhere in the product turns this red and makes
    /// somebody say which artifact it targets and whose bytes those are.
    ///
    /// <para>A number is offered here because the population is closed where a tool reaches it — every
    /// <c>.cs</c> file under <c>src/</c>, build output excluded. That is the condition under which a scalar
    /// is a fix rather than a fiction.</para></summary>
    private static readonly Dictionary<string, string> ExpectedRemovalSites = new(StringComparer.Ordinal)
    {
        // ── operator-authored artifacts ───────────────────────────────────────────────────────────────
        ["src/St4i.EdgeCore/Config/FleetSettingsStore.cs"] = "File.Delete, File.Move(overwrite:true), File.WriteAllText",
        ["src/St4i.EdgeCore/Config/MachineConfigStore.cs"] = "File.Move(overwrite:true), File.WriteAllText",
        ["src/St4i.EdgeCore/Config/ProductConfigStore.cs"] = "File.Move(overwrite:true), File.WriteAllText",
        ["src/St4i.EdgeCore/Historian/OeeSettingsStore.cs"] = "File.Move(overwrite:true), File.WriteAllText",
        ["src/St4i.EdgeCore/Site/SiteLinkStore.cs"] = "File.Move(overwrite:true), File.WriteAllText",

        // ── product-generated artifacts ───────────────────────────────────────────────────────────────
        ["src/St4i.EdgeCore/Identity/DeviceIdentityStore.cs"] = "File.Move(overwrite:true), File.WriteAllBytes, File.WriteAllText",
        // 🔴 TASK Z-1 — this row GAINED `File.Move(no-overwrite)`, and the enumeration's own failure text
        // asks which artifact the new site targets and whose bytes those are. It targets THIS store's own
        // `<machine code>.bin`, and the bytes are a DPAPI-sealed `mk_` credential — product-generated, so
        // the provenance row below is unchanged. It is the overload WITHOUT the overwrite flag on purpose:
        // classified `Effect.None` because it THROWS when the destination exists, which is what makes
        // "a kept blob is never replaced" a property rather than an intention. Owner decision item 10,
        // 2026-08-18: keep an unusable blob aside instead of overwriting it.
        ["src/St4i.EdgeCore/Infrastructure/CredentialStore.cs"] = "File.Move(no-overwrite), File.WriteAllBytes",
        ["src/St4i.EdgeCore/Transport/WalMaintenance.cs"] = "File.Delete, File.Move(overwrite:true), File.WriteAllText",
        ["src/St4i.EngineApi/Config/SimulatedEcosystem.cs"] = "File.Move(overwrite:true), File.WriteAllText",

        // ── not a store: scratch, demo, diagnostics, and one operator-chosen export path ──────────────
        ["src/St4i.DesktopShell/MainWindow.xaml.cs"] = "File.Create",
        ["src/St4i.EdgeCore/Drivers/HotFolder/Doc28Writer.cs"] = "File.Move(overwrite:true), FileMode.Create",
        ["src/St4i.EdgeCore/Drivers/HotFolder/HotFolderAoiDriver.cs"] = "File.Move(no-overwrite)",
        ["src/St4i.EdgeCore/Fleet/FleetCore.cs"] = "Directory.Delete",
        ["src/St4iMachineSimulator/App.xaml.cs"] = "File.Delete, File.WriteAllText, FileMode.Create",
        ["src/St4iMachineSimulator/Services/FleetService.cs"] = "Directory.Delete",
        ["src/St4iMachineSimulator/ViewModels/InspectorViewModel.cs"] = "File.WriteAllText",
    };

    [Fact]
    public void TheEnumerationOfRemovalCapableFilesystemSites_IsExactlyThis()
    {
        var observed = SourceRemovalSites();
        var rendered = observed.ToDictionary(kv => kv.Key, kv => string.Join(", ", kv.Value), StringComparer.Ordinal);

        Assert.True(
            rendered.Count == ExpectedRemovalSites.Count &&
            rendered.All(kv => ExpectedRemovalSites.TryGetValue(kv.Key, out var e) && e == kv.Value),
            "The removal-site enumeration moved. This is a MEASUREMENT, not a formality: something in src/ " +
            "gained, lost or changed a way of making persisted bytes unretrievable. Update the pinned table " +
            "AND say in the commit which artifact the new site targets and whose bytes those are.\n" +
            "OBSERVED:\n" + Render(observed));
    }

    /// <summary>🔴 The SQL half of the enumeration. Reach A cannot see one line of this.</summary>
    private static readonly Dictionary<string, string> ExpectedSqlSites = new(StringComparer.Ordinal)
    {
        // ── operator-authored rows ────────────────────────────────────────────────────────────────────
        ["src/St4i.EngineApi/Alarms/NotificationConfigStore.cs"] = "DELETE FROM, ON CONFLICT DO UPDATE SET",
        ["src/St4i.EngineApi/Auth/SqliteUserStore.cs"] = "UPDATE SET",
        ["src/St4i.EngineApi/Fleet/ConnectorConfigStore.cs"] = "DELETE FROM, DROP TABLE, ON CONFLICT DO UPDATE SET",

        // ── product-generated rows, one operator-owned column ─────────────────────────────────────────
        ["src/St4i.EngineApi/AssetRegistry/AssetRegistryStore.cs"] = "ON CONFLICT DO UPDATE SET, UPDATE SET",

        // ── product-generated rows ────────────────────────────────────────────────────────────────────
        ["src/St4i.EdgeCore/Historian/SqliteHistorianStore.cs"] = "DELETE FROM",
        ["src/St4i.EdgeCore/Site/BridgeSpool.cs"] = "DELETE FROM, ON CONFLICT DO UPDATE SET",
        ["src/St4i.EngineApi/Alarms/AlarmStore.cs"] = "DELETE FROM, ON CONFLICT DO UPDATE SET, UPDATE SET",
    };

    [Fact]
    public void TheEnumerationOfRowRemovingSqlSites_IsExactlyThis()
    {
        var observed = SqlRemovalSites();
        var rendered = observed.ToDictionary(kv => kv.Key, kv => string.Join(", ", kv.Value), StringComparer.Ordinal);

        Assert.True(
            rendered.Count == ExpectedSqlSites.Count &&
            rendered.All(kv => ExpectedSqlSites.TryGetValue(kv.Key, out var e) && e == kv.Value),
            "The SQL removal enumeration moved. Same obligation as the filesystem half.\n" +
            "OBSERVED:\n" + Render(observed));
    }

    /// <summary>🔴 <b>§8.1(h5.1) — the number that arrived with this task is an ASSERTION, so it gets
    /// measured.</b> The brief and item 5 both say <c>Delete(</c> appears in "at least eight" files under
    /// <c>src/</c> — quoted here because it is the CLAIM under test, and it is the one number in this file's
    /// prose that is not a copy of an assertion but the thing an assertion checks. It is a true lower bound.
    /// It is also useless as a census, and the two facts are separable and both worth pinning: the
    /// vocabulary is wrong in BOTH directions at once, which is the shape §8.1(f) keeps warning about.
    ///
    /// <para>Every other quantity in this measurement lives in the assertions below and nowhere else. The
    /// arithmetic is done here rather than in prose because four counts in the previous task were stated by
    /// hand and all four were wrong by the same mechanism — and then this file did it again, in its own
    /// comments, which is the rule recorded at the top.</para></summary>
    [Fact]
    public void TheDeleteVocabularyThisTaskArrivedWith_IsATrueLowerBound_AndUselessAsACensus()
    {
        var lines = new List<(string File, string Text)>();
        foreach (var file in ProductSources())
        {
            foreach (var raw in File.ReadLines(file))
            {
                if (raw.Contains("Delete(", StringComparison.Ordinal)) lines.Add((Relative(file), raw));
            }
        }

        var files = lines.Select(l => l.File).Distinct(StringComparer.Ordinal).ToList();

        // The briefed bound holds — stated as the inequality it is, not re-fitted to today's value.
        Assert.True(files.Count >= 8, $"the briefed lower bound of eight files no longer holds: {files.Count}");

        // OVER-INCLUSIVE: route registrations remove nothing, and prose about deletion removes nothing.
        var routeRegistrations = lines.Count(l => l.Text.Contains("MapDelete(", StringComparison.Ordinal));
        var prose = lines.Count(l => IsCommentLine(l.Text));

        // UNDER-INCLUSIVE, and this is the half that matters: files this file's own enumeration lists as
        // containing a removal-capable filesystem call, whose text never spells `Delete(` at all.
        var deleteFiles = files.ToHashSet(StringComparer.Ordinal);
        var invisibleToTheVocabulary = ExpectedRemovalSites.Keys
            .Where(f => !deleteFiles.Contains(f))
            .OrderBy(f => f, StringComparer.Ordinal)
            .ToList();

        Assert.Equal(20, lines.Count);
        Assert.Equal(10, files.Count);
        Assert.Equal(9, routeRegistrations);
        Assert.Equal(4, prose);
        Assert.Equal(11, invisibleToTheVocabulary.Count);

        // The remainder — the hits that really are removals or a removal's declaration — is written as the
        // SUBTRACTION rather than as a fourth independent literal, so it cannot drift away from the three
        // asserted above it. That is the same rule as the file header, applied to a number in code rather
        // than in prose: one copy, and let arithmetic hold the rest.
        Assert.Equal(7, lines.Count - routeRegistrations - prose);
    }

    /// <summary>Every raw-string (<c>"""…"""</c>) block under <c>src/</c>, with its text. A block is a pair
    /// of delimiters; a single-line block's text is its line, a multi-line block's is its lines joined.</summary>
    private static IReadOnlyList<(string File, string Text)> RawStringBlocks()
    {
        var blocks = new List<(string, string)>();

        foreach (var file in ProductSources())
        {
            var open = false;
            var buffer = new List<string>();

            foreach (var raw in File.ReadLines(file))
            {
                var delimiters = 0;
                for (var i = 0; i + 2 < raw.Length + 1; i++)
                {
                    if (i + 3 <= raw.Length && raw.AsSpan(i, 3) is "\"\"\"") { delimiters++; i += 2; }
                }

                if (open)
                {
                    buffer.Add(raw);
                    if (delimiters % 2 == 1)
                    {
                        open = false;
                        blocks.Add((Relative(file), string.Join("\n", buffer)));
                        buffer.Clear();
                    }
                }
                else if (delimiters > 0)
                {
                    for (var pair = 0; pair < delimiters / 2; pair++) blocks.Add((Relative(file), raw));
                    if (delimiters % 2 == 1) { open = true; buffer.Add(raw); }
                }
            }
        }

        return blocks;
    }

    /// <summary>🔴 <b>The hole that was stated as already-checked and was false three ways.</b> The class
    /// doc comment used to assert, under the heading "Checked, not assumed", that raw strings were roughly
    /// thirty in one file plus one in another, that <b>none</b> contained a removal shape, and that the IL
    /// cross-check closed the gap. All three false. The measured counts are the four assertions below and
    /// are stated nowhere else in this file; the IL bound could never have applied whatever they came to,
    /// because the content is SQL and Reach A cannot see a string.
    ///
    /// <para>It is a test rather than a corrected sentence for the reason the brief gives: a universal
    /// denial is only worth anything when something exists that could refute it, and editing a census is
    /// how the previous task produced three wrong counts in a row. This is the refuter.</para></summary>
    [Fact]
    public void TheRawStringBlindSpot_IsMeasuredRatherThanDenied()
    {
        var blocks = RawStringBlocks();
        var files = blocks.Select(b => b.File).Distinct(StringComparer.Ordinal).ToList();

        var withRemovalSql = blocks
            .Where(b => SqlPatterns.Any(p => p.Pattern.IsMatch(b.Text)))
            .ToList();
        var filesWithRemovalSql = withRemovalSql.Select(b => b.File).Distinct(StringComparer.Ordinal)
            .OrderBy(f => f, StringComparer.Ordinal).ToList();

        Assert.Equal(67, blocks.Count);
        Assert.Equal(12, files.Count);

        // The half that refutes the old sentence outright: raw-string blocks DO carry removal SQL.
        Assert.Equal(10, withRemovalSql.Count);

        // 🔴 The review that found the original sentence false gave a block count and a FILE count, and
        // then enumerated one fewer file than its own count claimed. Re-deriving rather than adopting is the
        // whole discipline the previous task was written up for, and it caught a scalar disagreeing with
        // its own list one more time — this time in the correction, not in the thing corrected. The right
        // value is the assertion on the next line; the wrong one is deliberately not repeated here, because
        // a refuted number quoted in a comment is exactly the second uncounted copy the file header refuses.
        Assert.Equal(5, filesWithRemovalSql.Count);

        // And the reason the census is nevertheless right about them: the SQL pass scans whole lines, so
        // every one of those files is already in the pinned SQL enumeration. This is the assertion that
        // ties the blind spot to the thing that covers it — without it, the two facts sit side by side and
        // a reader has to take the connection on trust.
        var pinned = ExpectedSqlSites.Keys.ToHashSet(StringComparer.Ordinal);
        Assert.All(filesWithRemovalSql, f => Assert.Contains(f, pinned));
    }

    [Fact]
    public void TheSourceScanner_FindsSitesItIsKnownToContain_AndIgnoresProseThatMerelyNamesThem()
    {
        // Positive control in both directions, which is the half a scanner census usually skips. The first
        // half proves the patterns match real calls. The second proves the comment/string stripping works —
        // without it this scanner would report FleetSettingsStore's doc comment, which spells `File.Delete`
        // three times in prose, as three removal sites, and would report Program.cs's long explanatory
        // comment as a fourth.
        var sites = SourceRemovalSites();

        Assert.Contains("src/St4i.EdgeCore/Config/FleetSettingsStore.cs", sites.Keys);
        Assert.Contains("File.Delete", sites["src/St4i.EdgeCore/Config/FleetSettingsStore.cs"]);
        Assert.Contains("File.Move(overwrite:true)", sites["src/St4i.EdgeCore/Config/FleetSettingsStore.cs"]);

        // ConnectorEndpoints.cs mentions "DELETE /v1/connectors/…" in a dozen comments and route strings and
        // performs no filesystem removal at all. If it appears in the filesystem census, the stripping broke.
        Assert.DoesNotContain("src/St4i.EngineApi/Endpoints/ConnectorEndpoints.cs", sites.Keys);

        // 🔴 The named escape's lower bound (review M1). `Stream.SetLength` truncates a file through a
        // handle, and no reach here can see it: not the IL (the callee resolves to `System.IO.Stream`,
        // which is deliberately outside ByteOwningTypes — see the note there), not the patterns, not the
        // nine constructors. What makes that a bounded hole rather than an open one is this count, and
        // nothing else. If it ever moves off zero, the escape has become live and somebody has to decide
        // whether `System.IO.Stream` joins the byte-owning types.
        var setLength = ProductSources()
            .SelectMany(f => File.ReadLines(f).Where(l => !IsCommentLine(l)).Select(l => (f, l)))
            .Where(x => CodeOnly(x.l).Contains(".SetLength(", StringComparison.Ordinal))
            .Select(x => Relative(x.f))
            .Distinct(StringComparer.Ordinal)
            .OrderBy(x => x, StringComparer.Ordinal)
            .ToList();

        Assert.True(setLength.Count == 0,
            "`.SetLength(` now appears under src/. It truncates through a Stream handle and EVERY reach in " +
            "this file is blind to it — decide whether System.IO.Stream joins ByteOwningTypes, and add a " +
            "Reach B pattern, before pinning anything else: " + string.Join(", ", setLength));
    }

    // ══ REACH C — EXECUTION: THE POSTURE AT THE FIXED SITUATION ════════════════════════════════════════
    //
    // 🔴 THE SITUATION, held fixed and stated once: the artifact is PRESENT on disk, and its bytes are not
    // something this process can make sense of. It is produced the same way for every store — real bytes,
    // written into this test's own temp directory, never anywhere under %ProgramData%\ST4I.
    //
    // What is measured is the property Q-1 installed and item 5 inherited: CAN A CALLER TELL "present and
    // unreadable" FROM "absent"? That is not a matter of taste. Where the two are the same value, the
    // branch that seeds defaults and then persists them is selectable with the operator's bytes on disk —
    // which is the mechanism, verbatim, that destroyed fleet-settings.json and site-link.json before Q-1.

    /// <summary>Whose bytes an enumerated removal site can destroy. Declared, because provenance is a
    /// judgement about intent and no scan makes it — and then CHECKED FOR COVERAGE against the two
    /// mechanically-derived enumerations, which is the part the class doc comment used to claim and this
    /// file did not have (review I3).</summary>
    private enum Provenance
    {
        /// <summary>A human chose these bytes: settings typed in, a recipe, a connector row, a site link,
        /// notification config, users.</summary>
        OperatorAuthored,

        /// <summary>The product minted them: an identity key blob, a credential blob, a WAL queue, a
        /// historian sample stream, a spool, the simulated ecosystem catalogue.</summary>
        ProductGenerated,

        /// <summary>Not a persisted store at all: demo scratch, a temp file, a per-launch log, a
        /// hot-folder hand-off, or a path the operator picks at the moment of export.</summary>
        NotAStore,
    }

    /// <summary>🔴 The declaration, keyed by exactly the same relative paths the two enumerations produce.
    /// <see cref="EveryEnumeratedRemovalSite_IsClassified_AndEveryMeasuredStoreIsAccountedFor"/> asserts
    /// SET EQUALITY against their union, so a site cannot be enumerated and left unclassified, and a
    /// classification cannot name a site the enumerations do not contain.</summary>
    private static readonly Dictionary<string, Provenance> ProvenanceOfSite = new(StringComparer.Ordinal)
    {
        ["src/St4i.EdgeCore/Config/FleetSettingsStore.cs"] = Provenance.OperatorAuthored,
        ["src/St4i.EdgeCore/Config/MachineConfigStore.cs"] = Provenance.OperatorAuthored,
        ["src/St4i.EdgeCore/Config/ProductConfigStore.cs"] = Provenance.OperatorAuthored,
        ["src/St4i.EdgeCore/Historian/OeeSettingsStore.cs"] = Provenance.OperatorAuthored,
        ["src/St4i.EdgeCore/Site/SiteLinkStore.cs"] = Provenance.OperatorAuthored,
        ["src/St4i.EngineApi/Alarms/NotificationConfigStore.cs"] = Provenance.OperatorAuthored,
        ["src/St4i.EngineApi/Auth/SqliteUserStore.cs"] = Provenance.OperatorAuthored,
        ["src/St4i.EngineApi/Fleet/ConnectorConfigStore.cs"] = Provenance.OperatorAuthored,

        ["src/St4i.EdgeCore/Identity/DeviceIdentityStore.cs"] = Provenance.ProductGenerated,
        ["src/St4i.EdgeCore/Infrastructure/CredentialStore.cs"] = Provenance.ProductGenerated,
        ["src/St4i.EdgeCore/Transport/WalMaintenance.cs"] = Provenance.ProductGenerated,
        ["src/St4i.EngineApi/Config/SimulatedEcosystem.cs"] = Provenance.ProductGenerated,
        ["src/St4i.EdgeCore/Historian/SqliteHistorianStore.cs"] = Provenance.ProductGenerated,
        ["src/St4i.EdgeCore/Site/BridgeSpool.cs"] = Provenance.ProductGenerated,
        ["src/St4i.EngineApi/Alarms/AlarmStore.cs"] = Provenance.ProductGenerated,
        // Product-minted rows, but `AssetRegistryStore`'s UPDATE touches an operator-owned lifecycle column.
        // Classified by the ROW's provenance; the column is named in item 5's residue rather than hidden by
        // splitting the row.
        ["src/St4i.EngineApi/AssetRegistry/AssetRegistryStore.cs"] = Provenance.ProductGenerated,

        ["src/St4i.DesktopShell/MainWindow.xaml.cs"] = Provenance.NotAStore,
        ["src/St4i.EdgeCore/Drivers/HotFolder/Doc28Writer.cs"] = Provenance.NotAStore,
        ["src/St4i.EdgeCore/Drivers/HotFolder/HotFolderAoiDriver.cs"] = Provenance.NotAStore,
        ["src/St4i.EdgeCore/Fleet/FleetCore.cs"] = Provenance.NotAStore,
        ["src/St4iMachineSimulator/App.xaml.cs"] = Provenance.NotAStore,
        ["src/St4iMachineSimulator/Services/FleetService.cs"] = Provenance.NotAStore,
        // 🔴 The one NotAStore entry that can still destroy an operator's bytes: an export to a path the
        // operator picks in a save dialog. It owns no artifact this product re-reads, so it is outside the
        // posture table by construction — and saying that here is the point of classifying rather than
        // filtering.
        ["src/St4iMachineSimulator/ViewModels/InspectorViewModel.cs"] = Provenance.NotAStore,
    };

    /// <summary>Which source file owns each store whose posture is measured. The link the class doc comment
    /// claimed and did not have.</summary>
    private static readonly Dictionary<string, string> ArtifactOwners = new(StringComparer.Ordinal)
    {
        ["FleetSettingsStore"] = "src/St4i.EdgeCore/Config/FleetSettingsStore.cs",
        ["SiteLinkStore"] = "src/St4i.EdgeCore/Site/SiteLinkStore.cs",
        ["MachineConfigStore"] = "src/St4i.EdgeCore/Config/MachineConfigStore.cs",
        ["ProductConfigStore"] = "src/St4i.EdgeCore/Config/ProductConfigStore.cs",
        ["OeeSettingsStore"] = "src/St4i.EdgeCore/Historian/OeeSettingsStore.cs",
        ["SimulatedEcosystem"] = "src/St4i.EngineApi/Config/SimulatedEcosystem.cs",
        ["ConnectorConfigStore"] = "src/St4i.EngineApi/Fleet/ConnectorConfigStore.cs",
        ["NotificationConfigStore"] = "src/St4i.EngineApi/Alarms/NotificationConfigStore.cs",

        // 🔴 TASK V-1 — five stores S-1 enumerated as removal sites and did NOT measure a posture for. Every
        // one of them owns an artifact this product writes and re-reads, which is the property that puts a
        // store in this table; S-1's table held the eight above plus SecurityDb and stopped there. The
        // exclusion was never stated as a rule, so nothing could refute it — see
        // EveryArtifactOwningStore_HasARow_AndTheOnesOutsideAreNamed.
        ["AlarmStore"] = "src/St4i.EngineApi/Alarms/AlarmStore.cs",
        ["AssetRegistryStore"] = "src/St4i.EngineApi/AssetRegistry/AssetRegistryStore.cs",
        ["BridgeSpool"] = "src/St4i.EdgeCore/Site/BridgeSpool.cs",
        ["DeviceIdentityStore"] = "src/St4i.EdgeCore/Identity/DeviceIdentityStore.cs",
        ["SqliteHistorianStore"] = "src/St4i.EdgeCore/Historian/SqliteHistorianStore.cs",

        // 🔴 `SecurityDb` is the one store in the posture table that appears in NEITHER enumeration, and the
        // review found that by noticing the two halves were unlinked. It is correct and it is information:
        // `SecurityDb` owns the FILE (`security.db`) and its schema ladder, while every row-removing
        // statement against that database lives in `SqliteUserStore` and `SqliteAuditStore`. So it is a
        // store with no removal site of its own, and it is declared as such here rather than being a silent
        // gap between two tables that never met.
        ["SecurityDb"] = NoRemovalSiteOfItsOwn,
    };

    private const string NoRemovalSiteOfItsOwn = "(owns a persisted artifact; performs no removal itself)";

    [Fact]
    public void EveryEnumeratedRemovalSite_IsClassified_AndEveryMeasuredStoreIsAccountedFor()
    {
        // 🔴 THE COVERAGE CHECK. Until the review, the class doc comment claimed provenance was "checked for
        // COVERAGE against the mechanically-enumerated set" and nothing did that: the two enumerations and
        // the posture table were never referenced by one another, and `SecurityDb` sat in the posture table
        // and in neither enumeration with nothing to notice. A declaration that is never compared to the
        // measurement is a filter wearing a census's clothes.
        var enumerated = ExpectedRemovalSites.Keys
            .Concat(ExpectedSqlSites.Keys)
            .ToHashSet(StringComparer.Ordinal);

        var unclassified = enumerated.Except(ProvenanceOfSite.Keys, StringComparer.Ordinal)
            .OrderBy(f => f, StringComparer.Ordinal).ToList();
        Assert.True(unclassified.Count == 0,
            "a removal site is enumerated and nobody has said whose bytes it can destroy:\n  " +
            string.Join("\n  ", unclassified));

        var invented = ProvenanceOfSite.Keys.Except(enumerated, StringComparer.Ordinal)
            .OrderBy(f => f, StringComparer.Ordinal).ToList();
        Assert.True(invented.Count == 0,
            "the provenance table classifies a file neither enumeration contains — either it stopped " +
            "removing anything (delete the entry and say so) or the enumeration lost it:\n  " +
            string.Join("\n  ", invented));

        // The other direction of the link: every store whose posture is published must be traceable to a
        // classified site, or be declared as owning no removal of its own.
        foreach (var (store, owner) in ArtifactOwners)
        {
            if (owner == NoRemovalSiteOfItsOwn) continue;
            Assert.True(ProvenanceOfSite.ContainsKey(owner),
                $"{store}'s posture is published but its owning file {owner} is not a classified removal site.");
        }

        Assert.Equal(
            OperatorArtifacts.Select(a => a.Store).OrderBy(s => s, StringComparer.Ordinal).ToArray(),
            ArtifactOwners.Keys.OrderBy(s => s, StringComparer.Ordinal).ToArray());

        // And the classification the ANSWER rests on: every store carrying operator-authored bytes is
        // declared as such on both sides, so the posture table cannot quietly come to include a
        // product-generated artifact and dilute the divergence it reports.
        foreach (var artifact in OperatorArtifacts.Where(a => a.OperatorAuthored))
        {
            var owner = ArtifactOwners[artifact.Store];
            if (owner == NoRemovalSiteOfItsOwn) continue;
            Assert.Equal(Provenance.OperatorAuthored, ProvenanceOfSite[owner]);
        }
    }

    private enum Posture
    {
        /// <summary>The read returns a distinct outcome for "present but unreadable". A caller CAN branch.</summary>
        ThirdState,

        /// <summary>The read throws. Nothing is destroyed and nothing continues; the caller decides by
        /// catching, and the store itself expresses no state.</summary>
        Throws,

        /// <summary>🔴 The read swallows and reports the same thing it reports for a file that is not there.
        /// A caller CANNOT branch, because there is nothing to branch on.</summary>
        UnreadableIsAbsent,
    }

    /// <summary>One operator-visible persisted artifact, the store that owns it, and how to put this test's
    /// unreadable bytes where that store will look for them.</summary>
    /// <param name="Measure">The posture, observed over a directory holding one unreadable artifact.</param>
    /// <param name="ConstructOverEmpty">🔴 The ATTRIBUTION control (review I1). <see cref="Observe"/> maps
    /// <i>any</i> throw to <see cref="Posture.Throws"/>, so a store that threw for a reason belonging to the
    /// RIG — a missing native dependency, a permission fault, a subdirectory it expected — would be recorded
    /// as <c>Throws</c> and would silently prop up a published row. Constructing the same store over an
    /// EMPTY directory separates the two: if that succeeds, the throw over the corrupt artifact is
    /// attributable to the artifact.</param>
    private sealed record ArtifactUnderTest(
        string Store,
        string Artifact,
        bool OperatorAuthored,
        Func<string, Posture> Measure,
        Action<string> ConstructOverEmpty);

    /// <summary>A fresh directory holding exactly one artifact, whose bytes are not what its name promises.
    ///
    /// <para>🔴 It is built under <see cref="Path.GetTempPath"/>, which <c>tests/Shared/TestRunTempRoot.cs</c>
    /// has already redirected into this run's own swept root. The brief forbids touching anything under
    /// <c>%ProgramData%\ST4I\</c> even to build a case, and every store below takes an explicit directory,
    /// so no environment variable is set and no machine-wide root is read.</para></summary>
    private static string CorruptDirWith(string fileName)
    {
        var dir = Path.Combine(Path.GetTempPath(), "st4i-removal-census", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, fileName), "{ this is not the json (or the database) it claims");
        return dir;
    }

    private static string EmptyDir()
    {
        var dir = Path.Combine(Path.GetTempPath(), "st4i-removal-census", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        return dir;
    }

    private static Posture Observe(Func<Posture> body)
    {
        try
        {
            return body();
        }
        catch (Exception)
        {
            return Posture.Throws;
        }
    }

    private static readonly ArtifactUnderTest[] OperatorArtifacts =
    [
        new("FleetSettingsStore", "fleet-settings.json", true, dir => Observe(() =>
            new FleetSettingsStore(dir).Read().Status == FleetSettingsReadStatus.Unreadable
                ? Posture.ThirdState : Posture.UnreadableIsAbsent),
            dir => _ = new FleetSettingsStore(dir).Read()),

        new("SiteLinkStore", "site-link.json", true, dir => Observe(() =>
            new SiteLinkStore(dir).Read().Status == SiteLinkReadStatus.Unreadable
                ? Posture.ThirdState : Posture.UnreadableIsAbsent),
            dir => _ = new SiteLinkStore(dir).Read()),

        new("MachineConfigStore", "machine-operating-config.json", true, dir => Observe(() =>
        {
            _ = new MachineConfigStore(dir);
            return Posture.UnreadableIsAbsent;
        }), dir => _ = new MachineConfigStore(dir)),

        new("ProductConfigStore", "products.json", true, dir => Observe(() =>
        {
            _ = new ProductConfigStore(dir);
            return Posture.UnreadableIsAbsent;
        }), dir => _ = new ProductConfigStore(dir)),

        new("OeeSettingsStore", "oee-settings.json", true, dir => Observe(() =>
            new OeeSettingsStore(dir).Status == OeeSettingsReadStatus.Unreadable
                ? Posture.ThirdState : Posture.UnreadableIsAbsent),
            dir => _ = new OeeSettingsStore(dir).Read()),

        new("SimulatedEcosystem", "ecosystem-products.json", false, dir => Observe(() =>
        {
            _ = new SimulatedEcosystem(dir);
            return Posture.UnreadableIsAbsent;
        }), dir => _ = new SimulatedEcosystem(dir)),

        new("ConnectorConfigStore", "connector-config.db", true, dir => Observe(() =>
        {
            _ = new ConnectorConfigStore(dir);
            return Posture.UnreadableIsAbsent;
        }), dir => _ = new ConnectorConfigStore(dir)),

        new("NotificationConfigStore", "notifications.db", true, dir => Observe(() =>
        {
            _ = new NotificationConfigStore(dir);
            return Posture.UnreadableIsAbsent;
        }), dir => _ = new NotificationConfigStore(dir)),

        new("SecurityDb", "security.db", true, dir => Observe(() =>
        {
            _ = new SecurityDb(dir);
            return Posture.UnreadableIsAbsent;
        }), dir => _ = new SecurityDb(dir)),

        // ── 🔴 TASK V-1 — the five S-1 enumerated and did not measure ────────────────────────────────
        new("AlarmStore", "alarms.db", false, dir => Observe(() =>
        {
            _ = new AlarmStore(dir);
            return Posture.UnreadableIsAbsent;
        }), dir => _ = new AlarmStore(dir)),

        new("AssetRegistryStore", "assets.db", false, dir => Observe(() =>
        {
            _ = new AssetRegistryStore(new UnsOptions(), dir);
            return Posture.UnreadableIsAbsent;
        }), dir => _ = new AssetRegistryStore(new UnsOptions(), dir)),

        new("BridgeSpool", "bridge-spool.db", false, dir => Observe(() =>
        {
            _ = new BridgeSpool(dir);
            return Posture.UnreadableIsAbsent;
        }), dir => _ = new BridgeSpool(dir)),

        // The logError callback is swallowed on purpose: this measures what the READ answers, and a store
        // that reports and then answers "absent" anyway is still a store whose caller cannot branch. That
        // distinction is the whole reason DeviceIdentityStore stays on this posture DELIBERATELY — see
        // docs/owner-decisions.md item 1's residue 2 — and it is measured here rather than declared.
        new("DeviceIdentityStore", "device-identity.bin", false, dir => Observe(() =>
            new DeviceIdentityStore(dir, (_, _) => { }).TryLoad() is null
                ? Posture.UnreadableIsAbsent : Posture.ThirdState),
            dir => _ = new DeviceIdentityStore(dir, (_, _) => { }).TryLoad()),

        new("SqliteHistorianStore", "historian.db", false, dir => Observe(() =>
        {
            _ = new SqliteHistorianStore(dir);
            return Posture.UnreadableIsAbsent;
        }), dir => _ = new SqliteHistorianStore(dir)),
    ];

    /// <summary>🔴 <b>THE ANSWER, PINNED.</b> Measured, not read. Touching a store's behaviour at this
    /// situation moves a row here, and after task V-1 that also means the law published in
    /// <c>docs/startup-failure-posture.md</c> §3.6 has a new member to account for.</summary>
    private static readonly Dictionary<string, Posture> ExpectedPostures = new(StringComparer.Ordinal)
    {
        // The read answers a distinct outcome, so the caller can decline the write. Q-1 built the first two;
        // V-1 brought the third onto the same shape under the same law.
        ["FleetSettingsStore"] = Posture.ThirdState,
        ["SiteLinkStore"] = Posture.ThirdState,
        ["OeeSettingsStore"] = Posture.ThirdState,

        // The read ends the operation instead. Nothing is destroyed here (measured — see
        // TheThrowingStores_…) and nothing continues either; the caller learns by catching.
        ["MachineConfigStore"] = Posture.Throws,
        ["ProductConfigStore"] = Posture.Throws,
        ["SimulatedEcosystem"] = Posture.Throws,
        ["ConnectorConfigStore"] = Posture.Throws,
        ["NotificationConfigStore"] = Posture.Throws,
        ["SecurityDb"] = Posture.Throws,
        ["AlarmStore"] = Posture.Throws,
        ["AssetRegistryStore"] = Posture.Throws,
        ["BridgeSpool"] = Posture.Throws,
        ["SqliteHistorianStore"] = Posture.Throws,

        // 🔴 The one row left on the posture the law forbids, and it is DECIDED rather than surviving.
        // docs/owner-decisions.md item 1's residue 2 records why: the bytes are a product-minted key, the
        // store DOES report at Error before regenerating, and the correct repair — keeping the old blob
        // under another name — is a data MOVE, which V-1's brief requires be stopped and reported rather
        // than performed. It is in this table so the exception is measured rather than asserted.
        //
        // 🔴 TASK Z-1 — THE OWNER GRANTED THAT MOVE, AND GRANTED IT AT ONE ITEM ONLY. Item 10
        // (CredentialStore) is now executed; item 1's residue 2 (this row) is NOT exempted by that
        // decision and nobody has touched it. Reading the sibling's exemption as a general licence is how
        // a constraint dies — not repealed, generalised.
        ["DeviceIdentityStore"] = Posture.UnreadableIsAbsent,
    };

    /// <summary>🔴 <b>The exceptions to the law, by name.</b> A store may sit on
    /// <see cref="Posture.UnreadableIsAbsent"/> only if it is here, and being here means somebody wrote down
    /// a decision. <c>CredentialStore</c> is a member and is measured apart — see
    /// <see cref="CredentialStorePostureCensusTests.TheCredentialStore_CannotTellAnUnusableBlobFromNoBlob_AndTheReclaimNowKeepsItAside"/>
    /// for why it cannot join the table above.
    ///
    /// <para>🔴 <b>Task Z-1 — <c>CredentialStore</c> STAYS on this list, and that is the decided outcome
    /// rather than an omission.</b> Item 10 named two repairs and the owner chose the one that leaves
    /// <c>Load</c> alone: the null is still ambiguous, so the READ is still non-compliant with §3.6's law
    /// and the exception is still needed. What changed is the CONSEQUENCE — the re-claim path can no
    /// longer destroy the blob, because <c>Save</c> keeps an unusable one aside. A store may be on this
    /// list only while a decision says so, and item 10's decision now says so with a reason that is
    /// executed rather than pending.</para>
    ///
    /// <para>🔴 <b>That cross-reference named a member that does not exist, until V-1's fix round (review
    /// I-6), and nothing in this repository could have caught it</b> — these projects do not set
    /// <c>GenerateDocumentationFile</c>, so there is no <c>CS1574</c> and the gate is green over a dangling
    /// <c>cref</c>. This file's own neighbour paid for the same thing once already
    /// (<c>docs/startup-failure-posture.md</c> §3.1a-now, fix round 2, review N5: <i>"a cross-reference that
    /// did not resolve. It was made true rather than deleted"</i>). Same disposition here.</para></summary>
    private static readonly string[] DecidedExceptionsToTheLaw =
    [
        "CredentialStore",
        "DeviceIdentityStore",
    ];

    [Fact]
    public void EveryOperatorArtifact_HasThePostureRecordedForIt_AtTheOneSituationHeldFixed()
    {
        var observed = OperatorArtifacts.ToDictionary(
            a => a.Store,
            a => a.Measure(CorruptDirWith(a.Artifact)),
            StringComparer.Ordinal);

        Assert.True(
            observed.Count == ExpectedPostures.Count &&
            observed.All(kv => ExpectedPostures.TryGetValue(kv.Key, out var e) && e == kv.Value),
            "A store's posture at the fixed situation moved. If that was deliberate, item 5 of " +
            "docs/owner-decisions.md is now describing a tree that no longer exists and must be rewritten " +
            "in the same commit.\nOBSERVED:\n" +
            string.Join("\n", observed.OrderBy(kv => kv.Key, StringComparer.Ordinal)
                .Select(kv => $"  [\"{kv.Key}\"] = Posture.{kv.Value},")));
    }

    [Fact]
    public void ThePostureRig_ReallyDoesPutUnreadableBytesWhereTheStoreLooks()
    {
        // Positive control for Reach C, and it is not optional: every posture above would be reported
        // identically by a rig that wrote its corrupt file into the wrong directory, or under the wrong
        // name, or not at all. Then "Absent" would be the truth and "UnreadableIsAbsent" would be an
        // artefact of the rig rather than a property of the product.
        foreach (var artifact in OperatorArtifacts)
        {
            var dir = CorruptDirWith(artifact.Artifact);
            var path = Path.Combine(dir, artifact.Artifact);
            Assert.True(File.Exists(path), $"{artifact.Store}: the rig did not create {artifact.Artifact}.");
            Assert.True(new FileInfo(path).Length > 0, $"{artifact.Store}: {artifact.Artifact} is empty.");
        }

        // And the control that matters most: the SAME rig, pointed at a store Q-1 fixed, must report the
        // third state — proving the measurement can return something other than "cannot tell".
        var settingsDir = CorruptDirWith("fleet-settings.json");
        Assert.Equal(FleetSettingsReadStatus.Unreadable, new FleetSettingsStore(settingsDir).Read().Status);

        // ...and, with nothing on disk at all, the same read must report Absent. Without this, "Unreadable"
        // could be what this store says about every directory it is ever given.
        Assert.Equal(FleetSettingsReadStatus.Absent, new FleetSettingsStore(EmptyDir()).Read().Status);
    }

    /// <summary>🔴 <b>WHAT THE ONE DIVERGENT POSTURE COSTS, EXECUTED.</b> A posture on its own is a
    /// classification; this is the harm, and it is the thing item 5 needs in order to be a decision instead
    /// of an observation.
    ///
    /// <para><c>OeeSettingsStore.Load</c> catches <see cref="System.Text.Json.JsonException"/> and starts
    /// from an empty store, which is byte-for-byte the same in-memory state it reaches when the file is not
    /// there. The store's only mutator then persists that state over the file. So an operator's
    /// <c>oee-settings.json</c> — every machine's ideal-cycle override and planned-production ratio — is
    /// replaced by whatever single entry the next <c>PUT /v1/historian/oee/settings</c> happens to carry,
    /// with <b>no exception, no log line and no returned status</b>. This is the mechanism Q-1 fixed at
    /// <c>fleet-settings.json</c> and at <c>site-link.json</c>, still live at a third file.</para>
    ///
    /// <para>🔴 <b>THIS ASSERTION IS INVERTED, AND THE INVERSION IS TASK V-1's DIFF.</b> S-1 was forbidden
    /// to fix what it measured, so it pinned the live defect as a baseline and wrote that a FIX ruling would
    /// invert it. The owner ruled <i>consolidate to one way</i>; the marker now SURVIVES and the write is
    /// REFUSED.</para>
    ///
    /// <para>⚠️ <b>A sentence here claimed a run that CANNOT have happened — withdrawn in V-1's fix round,
    /// kept visible rather than deleted (review I-1).</b> It read <i>"Run at <c>f18f5c29</c> this same test
    /// fails on its first surviving-marker assertion"</i>. This file names <c>OeeSettingsReadStatus</c> and
    /// <c>OeeSettingsStore.Status</c>, neither of which exists at <c>f18f5c29</c>, so it does not COMPILE
    /// against that tree and <i>"this same test"</i> was never run there. It is the fifth instance of the
    /// class V-1 withdrew four sentences for — <b>a claim about a measurement that was not the measurement
    /// taken</b> — and the first to land inside a test file, where it reads as evidence.</para>
    ///
    /// <para><b>What actually ran on the base arm</b>, in the honest form Q-1 used at
    /// <c>StartupSettingsReplayHardeningTests.AMalformedSettingsFile_…</c>: a separate control file naming
    /// nothing V-1 introduced, so one file compiles and runs on both trees. Source and both transcripts are
    /// RETAINED under <c>.superpowers/sdd/one-unreadable-posture/evidence/</c>. Base <c>f18f5c29</c>:
    /// <c>Set</c> succeeded, the marker was gone and <c>SOME-OTHER-MACHINE</c> was on disk. HEAD: refused,
    /// bytes byte-for-byte, no temp file beside them.</para>
    ///
    /// <para><b>What it does NOT establish:</b> that this is reachable on any particular deployment. It
    /// drives the store directly. What makes it more than a laboratory result is that the store's only
    /// mutator has exactly one production caller — <c>HistorianEndpoints.PutOeeSettingsAsync</c> — and that
    /// caller passes one machine's values, which is precisely the shape that left every other machine's
    /// entry out of the rewrite.</para></summary>
    [Fact]
    public void TheStoreThatCouldNotTellUnreadableFromAbsent_NowRefusesTheWrite_AndTheOperatorsBytesSurvive()
    {
        const string Marker = "OPERATOR-WROTE-THIS-AND-IT-DID-NOT-PARSE";

        var dir = Path.Combine(Path.GetTempPath(), "st4i-removal-census", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, "oee-settings.json");
        var operatorBytes = "[ { \"machineCode\": \"" + Marker + "\", idealCycleSecondsOverride: 42 ]";
        File.WriteAllText(path, operatorBytes);

        // Positive control on the premise: the bytes really are there, and they really do not parse.
        Assert.Contains(Marker, File.ReadAllText(path), StringComparison.Ordinal);
        Assert.Equal(Posture.ThirdState,
            OperatorArtifacts.Single(a => a.Store == "OeeSettingsStore").Measure(CorruptDirWith("oee-settings.json")));

        var store = new OeeSettingsStore(dir);
        Assert.Equal(OeeSettingsReadStatus.Unreadable, store.Status);

        // Reads keep working on the documented defaults — the store came up, which is what makes refusing
        // the write a report rather than an outage.
        var resolved = store.Resolve("SOME-OTHER-MACHINE", fallbackIdealCycleSeconds: 12.0);
        Assert.Null(resolved.IdealCycleSecondsOverride);
        Assert.Equal(1.0, resolved.PlannedProductionRatio);

        var refusal = Assert.Throws<OeeSettingsUnreadableException>(
            () => store.Set("SOME-OTHER-MACHINE", idealCycleSecondsOverride: 7.5, plannedProductionRatio: null));
        Assert.Contains("oee-settings.json", refusal.Message, StringComparison.Ordinal);

        // 🔴 The measurement the whole task turns on: byte for byte, not merely "the marker is still there".
        Assert.Equal(operatorBytes, File.ReadAllText(path));
        Assert.DoesNotContain("SOME-OTHER-MACHINE", File.ReadAllText(path), StringComparison.Ordinal);

        // And nothing was left beside it either — the atomic write's temp file is created by Save, which
        // was never reached.
        Assert.Equal(new[] { "oee-settings.json" },
            Directory.GetFiles(dir).Select(Path.GetFileName).OrderBy(f => f, StringComparer.Ordinal).ToArray());
    }

    /// <summary>🔴 <b>Task V-1 — the OTHER write S-1 found, and it needed no unreadable file at all.</b>
    /// <c>ProductConfigStore.Load</c> seeded <c>recipes.json</c> when it was missing and then called a
    /// <c>Save</c> that wrote BOTH files, so merely constructing the store rewrote a hand-written
    /// <c>products.json</c> — reserialised out of the typed model, dropping any field <c>ProductModel</c>
    /// does not declare, on a start where nothing failed.
    ///
    /// <para>⚠️ <b>This said <i>"Run at <c>f18f5c29</c> this fails"</i> and it is withdrawn (review
    /// I-2).</b> Unlike its neighbour this file WOULD compile at base — but the base arm was taken with
    /// <c>git checkout f18f5c29 -- src tests</c>, so this test was not present on that arm and did not run
    /// there. The outcome is real and the attribution was not: it was measured by the retained control file
    /// (<c>.superpowers/sdd/one-unreadable-posture/evidence/</c>), which at base reports
    /// <c>products.json intact=False</c> and <c>undeclared field survived=False</c>.</para></summary>
    [Fact]
    public void SeedingTheRecipesFile_DoesNotRewriteAHandWrittenProductsFile()
    {
        var dir = Path.Combine(Path.GetTempPath(), "st4i-removal-census", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        var productsPath = Path.Combine(dir, "products.json");
        var recipesPath = Path.Combine(dir, "recipes.json");

        var operatorBytes =
            "[ { \"code\": \"OP-BOARD\", \"name\": \"hand written\", \"annotationTheModelDoesNotDeclare\": 123 } ]";
        File.WriteAllText(productsPath, operatorBytes);

        // Premise: products.json is present and recipes.json is not, which is the only shape that reaches
        // the seed-persist branch with an operator file already on disk.
        Assert.False(File.Exists(recipesPath));

        var store = new ProductConfigStore(dir);

        Assert.Equal(operatorBytes, File.ReadAllText(productsPath));
        Assert.Contains("annotationTheModelDoesNotDeclare", File.ReadAllText(productsPath), StringComparison.Ordinal);

        // The half that must NOT change: the missing file is still seeded and persisted, so a fresh install
        // still boots with real content. Both halves in one test, because fixing the first by dropping the
        // second would be a regression this file could not see.
        Assert.True(File.Exists(recipesPath));
        Assert.NotEmpty(store.ListRecipes());
        Assert.Equal("OP-BOARD", Assert.Single(store.ListProducts()).Code);
    }

    /// <summary>🔴 <b>The <c>Throws</c> posture, ATTRIBUTED rather than inferred (review I1) — and the
    /// "nothing is destroyed" half of it, MEASURED rather than asserted in prose.</b>
    ///
    /// <para><see cref="Observe"/> maps any exception to <see cref="Posture.Throws"/>. That is the right
    /// shape for the question but it makes every <see cref="Posture.Throws"/> row in
    /// <see cref="ExpectedPostures"/> — the majority of them — depend on a throw whose CAUSE nothing
    /// checks. A store that threw here for a reason belonging to the rig would be recorded as
    /// <c>Throws</c> and would look exactly like a store refusing a bad artifact. Two assertions separate
    /// them: the same store constructs cleanly over an EMPTY directory, so the throw is attributable to the
    /// artifact; and the unreadable artifact is still on disk, byte for byte, after the throw — which is the
    /// evidence for the claim published in <c>docs/owner-decisions.md</c> that on this posture
    /// <b>nothing is destroyed</b>, a sentence that until now was a reading.</para></summary>
    [Fact]
    public void TheThrowingStores_ConstructCleanlyOverAnEmptyDirectory_AndLeaveTheUnreadableBytesIntact()
    {
        var throwers = ExpectedPostures.Where(kv => kv.Value == Posture.Throws)
            .Select(kv => kv.Key).ToHashSet(StringComparer.Ordinal);

        // Non-vacuity: the Throws set must be exactly this size, not an empty set that would turn the loop
        // below into a no-op and every assertion in it into a sentence. The literal stays a LITERAL on
        // purpose — deriving it from ExpectedPostures, which is where `throwers` already comes from, would
        // make this a tautology and pin nothing. This is the one copy of that number in the file.
        // 🔴 Task V-1 moved it: four stores S-1 never measured are on this posture too.
        Assert.Equal(10, throwers.Count);

        foreach (var artifact in OperatorArtifacts.Where(a => throwers.Contains(a.Store)))
        {
            var empty = EmptyDir();
            var ex = Record.Exception(() => artifact.ConstructOverEmpty(empty));
            Assert.True(ex is null,
                $"{artifact.Store} throws over an EMPTY directory too, so its published `Throws` posture is " +
                $"not attributable to the unreadable artifact — it is a property of this rig or this " +
                $"machine. Observed: {ex?.GetType().Name}: {ex?.Message}");

            var corrupt = CorruptDirWith(artifact.Artifact);
            var path = Path.Combine(corrupt, artifact.Artifact);
            var before = ReadSharing(path);

            Assert.Equal(Posture.Throws, artifact.Measure(corrupt));

            Assert.True(File.Exists(path),
                $"{artifact.Store} removed the unreadable artifact on its way out. The `Throws` row in " +
                "docs/owner-decisions.md says nothing is destroyed on this posture; that is now false.");
            Assert.Equal(before, ReadSharing(path));
        }
    }

    /// <summary>Reads a file without demanding exclusivity.
    ///
    /// <para>🔴 Not incidental plumbing — it is a measurement this test produced. The three SQLite-backed
    /// stores open the database from their constructors and the constructor THROWS, so nothing disposes the
    /// connection and Microsoft.Data.Sqlite's pool keeps the handle. A plain
    /// <see cref="File.ReadAllBytes(string)"/> then fails with "used by another process" — which would have
    /// been reported as this test's own failure rather than as what it is. The artifact is intact; the
    /// process is simply still holding it. Reading with <see cref="FileShare.ReadWrite"/> asks the question
    /// this test means to ask ("are the bytes still there") instead of a stricter one it does not
    /// ("can I take exclusive access").</para></summary>
    private static byte[] ReadSharing(string path)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read,
            FileShare.ReadWrite | FileShare.Delete);
        using var memory = new MemoryStream();
        stream.CopyTo(memory);
        return memory.ToArray();
    }

    /// <summary>🔴 <b>THE LAW, ASSERTED — task V-1, and this REPLACES S-1's headline.</b>
    ///
    /// <para>S-1's headline assertion was <c>classes.Count &gt; 1</c>: <i>the postures diverge</i>. It was
    /// the right answer to item 5's question and it is the wrong guard for item 5's ANSWER, because the
    /// answer is not one posture. <c>docs/startup-failure-posture.md</c> §1's test yields <b>S</b> at some
    /// sites and <b>U</b> at others and both are the same rule; a store's read expresses that as
    /// <see cref="Posture.Throws"/> or as <see cref="Posture.ThirdState"/>. So a guard that reddens when the
    /// postures converge would redden on a tree that is MORE compliant, and stay green on the one thing the
    /// law forbids.</para>
    ///
    /// <para>What the law forbids is <see cref="Posture.UnreadableIsAbsent"/>, and the derivation is short
    /// enough to check: §1's two outcomes are <b>S</b> (the process ends) and <b>U</b> (the host comes up and
    /// the failure is REPORTED), and both are loud. A read that answers the same value for <i>absent</i> and
    /// for <i>present and unreadable</i> can produce neither — nothing throws, so not S; nothing
    /// distinguished the cases, so there is nothing to report, so not U. It produces the third thing, which
    /// is the host coming up and saying nothing, which is §1's own definition of the failure it exists to
    /// forbid.</para>
    ///
    /// <para>Both directions redden, which is what makes this a measurement rather than a rule: a store
    /// falling ONTO that posture reddens it, and a NAMED EXCEPTION leaving it reddens it too — because the
    /// exception is written down in <c>docs/owner-decisions.md</c> and a decision must not outlive the tree
    /// it was taken about.</para></summary>
    [Fact]
    public void NoStoreAnswersAbsentForAnArtifactThatIsPresent_ExceptTheOnesNamedAndDecided()
    {
        var observed = OperatorArtifacts.ToDictionary(
            a => a.Store,
            a => a.Measure(CorruptDirWith(a.Artifact)),
            StringComparer.Ordinal);

        var cannotTell = observed.Where(kv => kv.Value == Posture.UnreadableIsAbsent)
            .Select(kv => kv.Key).OrderBy(s => s, StringComparer.Ordinal).ToList();

        var decided = DecidedExceptionsToTheLaw.ToHashSet(StringComparer.Ordinal);

        var undecided = cannotTell.Where(s => !decided.Contains(s)).ToList();
        Assert.True(undecided.Count == 0,
            "A store answers the SAME thing for \"there is nothing here\" and \"there is something here I " +
            "could not read\", and nobody has decided that it may. Its caller cannot branch, so the arm " +
            "that seeds defaults and persists them is selectable with the operator's bytes on disk — the " +
            "mechanism that destroyed fleet-settings.json and site-link.json before Q-1 and oee-settings.json " +
            "before V-1. Give the read a third outcome, or throw, or add it to DecidedExceptionsToTheLaw " +
            "WITH an item in docs/owner-decisions.md:\n  " + string.Join("\n  ", undecided));

        // The other direction. A named exception that has come onto a compliant posture is good news and it
        // still reddens: docs/owner-decisions.md and docs/startup-failure-posture.md §3.6 both name it, and
        // a decision that outlives its tree is exactly what those files exist to stop.
        var stillExceptional = cannotTell.ToHashSet(StringComparer.Ordinal);
        var measurable = OperatorArtifacts.Select(a => a.Store).ToHashSet(StringComparer.Ordinal);
        var noLongerNeeded = DecidedExceptionsToTheLaw
            .Where(s => measurable.Contains(s) && !stillExceptional.Contains(s))
            .OrderBy(s => s, StringComparer.Ordinal).ToList();
        Assert.True(noLongerNeeded.Count == 0,
            "A store named as a DECIDED exception to the law no longer needs the exception — its read now " +
            "distinguishes the two cases. Remove it here and close its item in docs/owner-decisions.md, " +
            "with this run as the evidence:\n  " + string.Join("\n  ", noLongerNeeded));

        // And the whole table, so a red run says which postures exist without re-deriving them.
        Assert.Equal(
            ExpectedPostures.Values.Distinct().OrderBy(p => p.ToString(), StringComparer.Ordinal).ToList(),
            observed.Values.Distinct().OrderBy(p => p.ToString(), StringComparer.Ordinal).ToList());
    }

    /// <summary>🔴 <b>Task V-1 — the population this table measures, closed against the enumerations rather
    /// than declared.</b>
    ///
    /// <para>S-1's posture table held nine stores. Nine was not wrong; it was the size of a set nobody had
    /// stated a membership rule for, and the brief that commissioned this task carried it forward as if it
    /// were the population. The rule, stated here so it can be argued with: <b>a store belongs in the posture
    /// table when it owns a persisted artifact this product WRITES and later RE-READS.</b> That is the only
    /// shape at which "unreadable was treated as absent" can cost anything, because it needs both a read to
    /// misclassify and a write to act on the misclassification.</para>
    ///
    /// <para>Applied to the two mechanical enumerations, that rule leaves exactly three files out, and each
    /// is named below with the reason rather than filtered away. Provenance is NOT the rule — S-1's table
    /// excluded the product-generated stores and that exclusion was never stated, so nothing could refute
    /// it; five of them turned out to be measurable and four of the five are compliant, which is information
    /// the published table did not carry.</para></summary>
    [Fact]
    public void EveryArtifactOwningStore_HasARow_AndTheOnesOutsideAreNamed()
    {
        // Files in the two enumerations that own NO artifact this product writes and re-reads. Every one is
        // a write-only or third-party-owned path, and each reason is checkable by opening the file.
        var ownsNoReReadArtifact = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["src/St4i.EdgeCore/Transport/WalMaintenance.cs"] =
                "a static trimmer over a queue file it does not own; the WAL's writer is the vendored SDK",
            ["src/St4i.EdgeCore/Infrastructure/CredentialStore.cs"] =
                "owns one; static, with no per-call directory seam — measured in its own fact below",
            ["src/St4i.EngineApi/Auth/SqliteUserStore.cs"] =
                "rows inside security.db, whose FILE and schema ladder SecurityDb owns and is measured for",
        };

        var storeOwned = ArtifactOwners.Values.Where(v => v != NoRemovalSiteOfItsOwn)
            .ToHashSet(StringComparer.Ordinal);

        var enumeratedStoreFiles = ProvenanceOfSite
            .Where(kv => kv.Value != Provenance.NotAStore)
            .Select(kv => kv.Key)
            .ToList();

        var unaccounted = enumeratedStoreFiles
            .Where(f => !storeOwned.Contains(f) && !ownsNoReReadArtifact.ContainsKey(f))
            .OrderBy(f => f, StringComparer.Ordinal)
            .ToList();

        Assert.True(unaccounted.Count == 0,
            "A file the enumerations classify as a STORE has no posture row and no stated reason for not " +
            "having one. That is how nine became a population nobody had checked. Either measure it in " +
            "OperatorArtifacts or say here why it owns no artifact this product writes and re-reads:\n  " +
            string.Join("\n  ", unaccounted));

        // And the reverse, so the exclusion list cannot rot into fiction: nothing may be excused that the
        // enumerations no longer contain, or that the posture table now measures anyway.
        var invented = ownsNoReReadArtifact.Keys
            .Where(f => !ProvenanceOfSite.ContainsKey(f) || storeOwned.Contains(f))
            .OrderBy(f => f, StringComparer.Ordinal).ToList();
        Assert.True(invented.Count == 0,
            "the exclusion list excuses a file the enumerations no longer classify as a store, or one the " +
            "posture table now measures:\n  " + string.Join("\n  ", invented));
    }

    /// <summary>The law's named exceptions, exposed so the one store that cannot join the parallel table
    /// can still be checked against the same list.</summary>
    internal static IReadOnlyList<string> DecidedExceptions => DecidedExceptionsToTheLaw;
}

/// <summary>🔴 <b>Task V-1 — <c>CredentialStore</c>, measured, and measured APART for a reason that is
/// itself a finding.</b>
///
/// <para>S-1 recorded this store as outside the posture table because its bytes are not operator-typed
/// configuration. That reason is arguable — one of the <c>CredentialStore.Save</c> call sites is the operator
/// PASTING an <c>mk_</c> key — but it is not the reason it cannot join the table. The reason is mechanical:
/// <c>Load</c> is <see langword="static"/> and resolves the process-wide <c>ST4I_CREDS_DIR</c> per call, with
/// no directory parameter, so a row in a table whose every other member takes an explicit directory would
/// have to flip a process-global variable to be measured. That is the same "a measurement that makes the run
/// environment-dependent is not a measurement" ceiling <c>docs/startup-failure-posture.md</c> §2 states for
/// its own instrument 2.</para>
///
/// <para>So it is measured here instead, with no environment mutation at all: the machine CODE is the
/// discriminator inside whatever creds root this run already resolved, and a code nothing else uses gives
/// this fact an artifact of its own. It is nevertheless in the serialized env-var collection, because
/// another class in that collection repointing <c>ST4I_CREDS_DIR</c> mid-fact would make this measure two
/// different directories.</para></summary>
[Collection(St4i.EngineApi.Tests.Auth.SecurityEnvVarTests.CollectionName)]
public sealed class CredentialStorePostureCensusTests
{
    /// <summary>🔴 <b>Task Z-1 — THIS IS THE ASSERTION ITEM 10 SAID WOULD INVERT, AND THIS IS THE
    /// INVERSION.</b> V-1 pinned a live defect as a baseline and did not fix it, exactly as S-1 did for
    /// item 5; <c>docs/owner-decisions.md</c> item 10 recorded that <i>"when the fix arrives, that
    /// assertion inverts, and the inversion is the diff"</i>. The owner decided on 2026-08-18 to keep the
    /// old blob under another name, so the last two lines now assert that the bytes SURVIVE where they
    /// previously asserted that a re-claim replaced them.
    ///
    /// <para><b>The first half does NOT invert, and that is the finding rather than an oversight.</b>
    /// <c>Load</c> still answers the same <see langword="null"/> for both situations — the owner
    /// explicitly chose the keep-aside repair over the make-<c>Load</c>-throw one, because the second
    /// changes the contract of a <see langword="static"/> method several projects call. So this store is
    /// still on <see cref="OperatorDataRemovalCensusTests.DecidedExceptions"/>, still non-compliant with
    /// the read law, and no longer destructive.</para></summary>
    [Fact]
    public void TheCredentialStore_CannotTellAnUnusableBlobFromNoBlob_AndTheReclaimNowKeepsItAside()
    {
        Assert.Contains("CredentialStore", OperatorDataRemovalCensusTests.DecidedExceptions);

        var root = CredentialStore.ResolveRoot();
        Directory.CreateDirectory(root);

        var present = "V1-CENSUS-PRESENT-" + Guid.NewGuid().ToString("N");
        var absent = "V1-CENSUS-ABSENT-" + Guid.NewGuid().ToString("N");
        var blob = Path.Combine(root, present + ".bin");
        var unusable = "these bytes are not a DPAPI envelope this machine can unprotect"u8.ToArray();
        File.WriteAllBytes(blob, unusable);

        // Positive control on the premise, in both directions: the bytes really are on disk where the store
        // looks, and the control code really has nothing.
        Assert.True(File.Exists(blob));
        Assert.False(File.Exists(Path.Combine(root, absent + ".bin")));

        // 🔴 The measurement. Two situations that must never be handled the same way, one answer.
        Assert.Null(CredentialStore.Load(present));
        Assert.Null(CredentialStore.Load(absent));

        // 🔴 THE INVERTED HALF. The caller's re-claim path calls Save, and Save used to OVERWRITE — a blob
        // sealed under a different DPAPI scope or on a different machine is READABLE AGAIN once the
        // environment is repaired, while it still exists, so a recoverable fault became an unrecoverable
        // loss. Task Z-1, on the owner's decision: the re-claim still succeeds, and the bytes it could not
        // read are kept beside it under a name that says what they are.
        CredentialStore.Save(present, "mk_reclaimed_after_the_unreadable_blob_was_kept");
        Assert.Equal("mk_reclaimed_after_the_unreadable_blob_was_kept", CredentialStore.Load(present));

        var kept = Directory.GetFiles(root)
            .Where(f => Path.GetFileName(f)!.StartsWith(present + ".bin.unreadable-", StringComparison.Ordinal))
            .ToList();
        Assert.Equal(unusable, File.ReadAllBytes(Assert.Single(kept)));
    }
}
