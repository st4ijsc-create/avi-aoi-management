using System.Reflection;
using System.Reflection.Emit;
using System.Text.RegularExpressions;
using St4i.EdgeCore.Config;
using St4i.EdgeCore.Historian;
using St4i.EdgeCore.Site;
using St4i.EngineApi.Alarms;
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
///   <item><description><b>Reach C — execution.</b> Nine stores constructed for real over a deliberately
///   unreadable artifact in this test's own temp directory, and the outcome observed. This is the only reach
///   that can answer "do they behave differently", because the other two can only read code.</description></item>
/// </list></para>
///
/// <para>🔴 <b>WHAT IS OUTSIDE ALL THREE, NAMED RATHER THAN LEFT TO BE DISCOVERED.</b>
/// <list type="number">
///   <item><description><b>Reach A does not cover four of the eight projects</b> —
///   <c>St4i.EdgeService</c>, <c>St4i.Connector.Conformance</c>, <c>St4iMachineSimulator</c> and
///   <c>St4i.DesktopShell</c>. No test project references the two WPF hosts at all. So in those four the
///   vocabulary is UNREFUTED: a removal spelled in a way Reach B's patterns do not match would be invisible.
///   What bounds the damage is that no persistent store lives in any of the four — every one of them is in
///   <c>St4i.EdgeCore</c> or <c>St4i.EngineApi</c>, both inside Reach A.</description></item>
///   <item><description><b>SQL is unrefuted everywhere.</b> Reach A cannot see a string. The SQL vocabulary
///   is the set of SQL statements that remove or replace stored rows, which is a closed set in SQLite
///   (<c>DELETE</c>, <c>DROP</c>, <c>TRUNCATE</c>—absent in SQLite—, <c>REPLACE</c>/<c>INSERT OR REPLACE</c>,
///   <c>ON CONFLICT … DO UPDATE</c>, and <c>UPDATE … SET</c>), but nothing here proves a statement was not
///   assembled at runtime out of fragments none of those patterns match.</description></item>
///   <item><description><b>Removal by something that is not this code.</b>
///   <c>packaging/remove-data.ps1</c>, an installer, an operator with Explorer, SQLite's own
///   <c>-wal</c>/<c>-shm</c> sidecars, the ASP.NET DataProtection key ring's own rolls, and the vendored SDK
///   under <c>examples/</c> which is the actual writer of the WAL <c>.jsonl</c> files. None is under
///   <c>src/</c>; all of them destroy bytes.</description></item>
///   <item><description><b>Reachability.</b> Reach A proves a call is EMITTED, never that it runs — the same
///   ceiling <c>SerialPortBusLinkTests</c> states for its own IL read. Nothing below claims any enumerated
///   site is reachable on any particular input.</description></item>
///   <item><description><b>One situation only.</b> See the third numbered point above. In particular a
///   deny-share lock and a Windows ACL are NOT the same situation as a malformed file even though prose
///   calls them all "unreadable" — <c>docs/startup-failure-posture.md</c> §3.1a paid for that lesson twice
///   with a measurement, and the postures below are measured with a MALFORMED artifact, which is the vector
///   that entry ended up calling the likeliest one.</description></item>
/// </list></para>
///
/// <para><b>PRECONDITION.</b> Like <c>PerHostDataRootsTests</c> and <c>EnumSpellingContractTests</c>, Reach B
/// requires being run from inside the source tree. A scan that cannot find its corpus has measured nothing,
/// and "nothing measured" must never read as "nothing wrong", so it fails rather than passing.</para>
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
    // tree, `grep -rn "Delete(" src/ --include=*.cs` returns 20 lines in 10 files, and it is wrong in BOTH
    // directions at once: 13 of the 20 are `MapDelete(` route REGISTRATIONS or doc-comment prose, which
    // remove nothing, and it misses every `File.Move(..., overwrite: true)`, every whole-file rewrite and
    // every SQL statement — which is where nearly all of this product's byte destruction actually happens.
    //
    // So the population is closed somewhere a tool can reach instead: the TYPES through which a .NET program
    // can make an existing filesystem entry's bytes stop being retrievable. That set is small and arguable,
    // which is what a stated domain should be. `System.IO.Path` is excluded because it is pure string
    // arithmetic; `Stream`/`TextWriter` are excluded because by the time you hold one, the decision to
    // truncate was already taken by whichever member below opened it.

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

            i += operand;
            if (i > il.Length) yield break;
        }
    }

    // ══ REACH B — THE SOURCE TEXT ══════════════════════════════════════════════════════════════════════
    //
    // Two passes over the same corpus, because the two things being looked for live on opposite sides of a
    // quotation mark. The API pass blanks every string literal and cuts every trailing `//` comment, so a
    // doc comment that NAMES `File.Delete` is not counted as a call — which is most of what the `Delete(`
    // vocabulary was actually counting. The SQL pass does the reverse: it reads ONLY inside literals.

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

    /// <summary>The SQL pass: every statement in a string literal anywhere under <c>src/</c> that removes or
    /// replaces stored rows. Reach A is blind to all of this — a SQL statement is a string, and a string has
    /// no metadata.</summary>
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

        // Three shapes that MUST be visible, chosen because each is a different way for the decode to be
        // broken: a plain static call, an overload the arity must separate, and a whole-file rewrite.
        Assert.Contains("System.IO.File.Delete/1", edgeCore);
        Assert.Contains("System.IO.File.Move/3", edgeCore);
        Assert.Contains("System.IO.File.WriteAllText/2", edgeCore);

        foreach (var assembly in AssembliesInReachA())
        {
            WalkCalls(assembly, out var unresolved);
            Assert.True(unresolved == 0,
                $"{assembly.GetName().Name}: the IL decode framed {unresolved} call token(s) that reflection " +
                "refused to resolve. Every assertion in Reach A is then a claim about a population this " +
                "walker did not finish reading. Fix the walker; do not lower this to a tolerance.");
        }
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
        ["src/St4i.EdgeCore/Infrastructure/CredentialStore.cs"] = "File.WriteAllBytes",
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
    /// <c>src/</c>, and both label it a machine-countable lower bound rather than a total. It is a true
    /// lower bound. It is also useless as a census, and the two facts are separable and both worth pinning:
    /// the vocabulary is wrong in BOTH directions at once, which is the shape §8.1(f) keeps warning about.
    ///
    /// <para>The arithmetic is done here rather than in prose because four counts in the previous task were
    /// stated by hand and all four were wrong by the same mechanism.</para></summary>
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

        // Seven of the twenty are removals or a removal's declaration. Written as the subtraction rather
        // than as a fourth literal, so it cannot drift away from the three above it.
        Assert.Equal(7, lines.Count - routeRegistrations - prose);
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
    private sealed record ArtifactUnderTest(
        string Store,
        string Artifact,
        bool OperatorAuthored,
        Func<string, Posture> Measure);

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
                ? Posture.ThirdState : Posture.UnreadableIsAbsent)),

        new("SiteLinkStore", "site-link.json", true, dir => Observe(() =>
            new SiteLinkStore(dir).Read().Status == SiteLinkReadStatus.Unreadable
                ? Posture.ThirdState : Posture.UnreadableIsAbsent)),

        new("MachineConfigStore", "machine-operating-config.json", true, dir => Observe(() =>
        {
            _ = new MachineConfigStore(dir);
            return Posture.UnreadableIsAbsent;
        })),

        new("ProductConfigStore", "products.json", true, dir => Observe(() =>
        {
            _ = new ProductConfigStore(dir);
            return Posture.UnreadableIsAbsent;
        })),

        new("OeeSettingsStore", "oee-settings.json", true, dir => Observe(() =>
        {
            _ = new OeeSettingsStore(dir);
            return Posture.UnreadableIsAbsent;
        })),

        new("SimulatedEcosystem", "ecosystem-products.json", false, dir => Observe(() =>
        {
            _ = new SimulatedEcosystem(dir);
            return Posture.UnreadableIsAbsent;
        })),

        new("ConnectorConfigStore", "connector-config.db", true, dir => Observe(() =>
        {
            _ = new ConnectorConfigStore(dir);
            return Posture.UnreadableIsAbsent;
        })),

        new("NotificationConfigStore", "notifications.db", true, dir => Observe(() =>
        {
            _ = new NotificationConfigStore(dir);
            return Posture.UnreadableIsAbsent;
        })),

        new("SecurityDb", "security.db", true, dir => Observe(() =>
        {
            _ = new SecurityDb(dir);
            return Posture.UnreadableIsAbsent;
        })),
    ];

    /// <summary>🔴 <b>THE ANSWER, PINNED.</b> Measured, not read. Touching a store's behaviour at this
    /// situation moves a row here and reopens item 5 in <c>docs/owner-decisions.md</c> — which is the whole
    /// point of pinning it rather than writing it in a report nobody can diff.</summary>
    private static readonly Dictionary<string, Posture> ExpectedPostures = new(StringComparer.Ordinal)
    {
        // Q-1's two, and the only two that express the state at all.
        ["FleetSettingsStore"] = Posture.ThirdState,
        ["SiteLinkStore"] = Posture.ThirdState,

        // Six that end the operation instead. Nothing is destroyed here; nothing continues either, and the
        // store itself says nothing — the caller learns only by catching.
        ["MachineConfigStore"] = Posture.Throws,
        ["ProductConfigStore"] = Posture.Throws,
        ["SimulatedEcosystem"] = Posture.Throws,
        ["ConnectorConfigStore"] = Posture.Throws,
        ["NotificationConfigStore"] = Posture.Throws,
        ["SecurityDb"] = Posture.Throws,

        // 🔴 ONE. Measured, not read, and it is the whole reason item 5 is a decision rather than a note.
        // See TheOneStoreThatCannotTellUnreadableFromAbsent_ReplacesTheOperatorsBytes for what it costs.
        ["OeeSettingsStore"] = Posture.UnreadableIsAbsent,
    };

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
    /// <para><b>THIS TEST FIXES NOTHING.</b> It is a baseline: S-1 is a measurement task, and a measurement
    /// that quietly repairs what it measures destroys the thing the decision rests on. If the owner rules
    /// FIX, this assertion inverts and that inversion is the diff.</para>
    ///
    /// <para><b>What it does NOT establish:</b> that this is reachable on any particular deployment. It
    /// drives the store directly. What makes it more than a laboratory result is that the store's only
    /// mutator has exactly one production caller — <c>HistorianEndpoints.PutOeeSettingsAsync</c> — and that
    /// caller passes one machine's values, which is precisely the shape that leaves every other machine's
    /// entry out of the rewrite.</para></summary>
    [Fact]
    public void TheOneStoreThatCannotTellUnreadableFromAbsent_ReplacesTheOperatorsBytes()
    {
        const string Marker = "OPERATOR-WROTE-THIS-AND-IT-DID-NOT-PARSE";

        var dir = Path.Combine(Path.GetTempPath(), "st4i-removal-census", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, "oee-settings.json");
        File.WriteAllText(path, "[ { \"machineCode\": \"" + Marker + "\", idealCycleSecondsOverride: 42 ]");

        // Positive control on the premise: the bytes really are there, and they really do not parse.
        Assert.Contains(Marker, File.ReadAllText(path), StringComparison.Ordinal);
        Assert.Equal(Posture.UnreadableIsAbsent,
            OperatorArtifacts.Single(a => a.Store == "OeeSettingsStore").Measure(CorruptDirWith("oee-settings.json")));

        var store = new OeeSettingsStore(dir);
        store.Set("SOME-OTHER-MACHINE", idealCycleSecondsOverride: 7.5, plannedProductionRatio: null);

        var after = File.ReadAllText(path);
        Assert.DoesNotContain(Marker, after, StringComparison.Ordinal);
        Assert.Contains("SOME-OTHER-MACHINE", after, StringComparison.Ordinal);
    }

    [Fact]
    public void ThePosturesAtTheFixedSituation_AreNotAllTheSame()
    {
        // 🔴 THE ANSWER TO ITEM 5's QUESTION, asserted rather than written down. If somebody later brings
        // every store onto one posture, this goes red — which is correct: the answer published in
        // docs/owner-decisions.md would have stopped being true, and an item that says "they diverge" must
        // not be able to outlive the divergence.
        var observed = OperatorArtifacts.ToDictionary(
            a => a.Store,
            a => a.Measure(CorruptDirWith(a.Artifact)),
            StringComparer.Ordinal);

        var classes = observed.Values.Distinct().OrderBy(p => p.ToString(), StringComparer.Ordinal).ToList();

        Assert.True(classes.Count > 1,
            "Every store now behaves the same way when its artifact is present and unreadable. That is the " +
            "outcome item 5 of docs/owner-decisions.md would CLOSE on — go and close it, with this run as " +
            "the evidence.");

        // The names, so a reader of a red run knows which classes exist without re-deriving them.
        Assert.Equal(
            ExpectedPostures.Values.Distinct().OrderBy(p => p.ToString(), StringComparer.Ordinal).ToList(),
            classes);
    }
}
