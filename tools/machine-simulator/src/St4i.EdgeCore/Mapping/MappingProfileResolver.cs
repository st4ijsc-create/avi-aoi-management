using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Mapping;

/// <summary>
/// G2-1 (Giai đoạn 2, task 1 — docs/plans/2026-07-27-giaidoan2-synapse-connect-blueprint.md) — activates
/// the per-machine <c>mapping/*.json</c> profiles that were, until this task, dead placeholders:
/// <see cref="MappingProfile.FromJson"/> was fully implemented and unit-tested but never called from a
/// production composition root, and every machine in the fleet was normalized through one hardcoded
/// shared <c>MappingProfile { Name = "fleet-mixed" }</c> regardless of what <c>fleet.json</c>'s own
/// per-entry <see cref="MachineDescriptor.MappingProfile"/> field named.
///
/// Builds a machineCode → <see cref="MappingProfile"/> map for a set of descriptors.
///
/// <para>🔴 <b>Task J-1 changed WHEN and HOW OFTEN this runs, and the old wording ("once per fleet
/// (re)composition, see <c>FleetCore.StartLocked</c>") is now wrong in both halves.</b> It runs in
/// <c>FleetCore.BuildStartPlan</c>, with that class's <c>_gate</c> RELEASED — the point of the change, since
/// this method's <c>File.Exists</c>/<c>File.ReadAllText</c> per descriptor was measured at 2.39 ms held on
/// the lock <c>Estop()</c> takes with 50 machines. And a single fleet composition can now call it TWICE: a
/// second, supplementary <see cref="Build"/> over just the descriptors the first one did not cover runs
/// under the lock when the roster changed while the first was running. Both results are composed by the
/// caller, supplement first. Nothing about this class's own contract changed — it is still stateless, still
/// never throws, and <see cref="Resolve"/> is still a pure dictionary lookup — which is exactly what makes
/// composing two of them legitimate.</para>
///
/// <para>A descriptor naming a real
/// <c>mapping/&lt;name&gt;.json</c> file resolves to THAT file's <see cref="MappingProfile.FromJson"/>;
/// a descriptor with no name, or naming a file that is missing/unreadable/malformed, falls back to
/// <see cref="MappingProfile.ForClass"/> for that descriptor's <see cref="MachineDescriptor.DeviceClass"/>
/// — this class NEVER throws, so one bad/missing preset can never take the fleet pipeline down (same
/// "graceful fallback, not a startup crash" contract <c>FleetConfig.Load</c> already keeps for a
/// malformed <c>fleet.json</c> itself).</para>
///
/// <para>🔴 <b>Task AQ-1 (owner item 21, 2026-08-21) adds a FOURTH cause to that fallback list, and the
/// list above was an inventory that is now short by one rather than a sentence that was wrong:</b> a
/// descriptor whose <c>mappingProfile</c> resolves OUTSIDE the mapping directory's subtree is REFUSED
/// before the filesystem is touched at all, and falls back to exactly the same
/// <see cref="MappingProfile.ForClass"/> the other three causes reach. Until this task the field was a
/// path — <c>Path.Combine</c> lets an absolute right-hand side win outright — while every published
/// description of it, in <c>README</c> and on <see cref="MachineDescriptor.MappingProfile"/> alike, called
/// it a NAME. See <see cref="Build"/>'s <c>mappingDir</c> parameter for how the boundary is decided and for
/// the one thing it deliberately does not do.</para>
/// </summary>
public sealed class MappingProfileResolver
{
    private readonly IReadOnlyDictionary<string, MappingProfile> _byMachineCode;

    private MappingProfileResolver(IReadOnlyDictionary<string, MappingProfile> byMachineCode)
    {
        _byMachineCode = byMachineCode;
    }

    /// <summary>Builds the resolver from the CURRENT fleet roster. <paramref name="mappingDir"/> is the
    /// directory <c>mapping/*.json</c> presets live in — production callers resolve this the same
    /// "next to the exe" way <c>FleetCore.ResolveFleetPath</c> already resolves <c>fleet.json</c> itself
    /// (<c>AppContext.BaseDirectory</c>/"mapping"). Safe to call with a non-existent directory — every
    /// entry simply falls back to <see cref="MappingProfile.ForClass"/>.</summary>
    /// <param name="fleet">The roster to resolve, enumerated exactly once. The resulting map is keyed on
    /// <see cref="MachineDescriptor.Code"/> and compares codes case-INSENSITIVELY, so two descriptors
    /// whose codes differ only in case are ONE entry here and the later one silently wins — which is a
    /// looser identity than the historian's, where the same code is stored and compared as written. An
    /// empty roster is legal and produces a resolver that answers <see langword="null"/> for everything,
    /// i.e. one that sends every reading to its pipeline's shared profile; that is the state a host that
    /// runs this class with no roster in scope ends up in, with no exception and no warning.</param>
    /// <param name="mappingDir">Where the presets live, and — since owner item 21, task AQ-1, 2026-08-21 —
    /// the BOUNDARY the resolved file must fall inside. The file consulted for a descriptor is this
    /// directory combined with that descriptor's own <c>mappingProfile</c> value plus <c>.json</c>, and the
    /// result is then required to lie within this directory's own subtree, decided by comparing ABSOLUTE
    /// NORMALIZED paths (<see cref="Path.GetFullPath(string)"/>) and never by filtering <c>..</c> or a
    /// separator out of the string. A descriptor whose value escapes — an absolute path, a drive-relative
    /// path, a UNC share, or enough <c>..</c> segments to climb out — is REFUSED and falls back to
    /// <see cref="MappingProfile.ForClass"/> with a message on <paramref name="logWarning"/> naming what to
    /// fix. A subdirectory OF this directory is still legal and still resolves, so the confinement rejects
    /// only what leaves.
    /// <para>🔴 <b>The old wording here described the pre-AQ-1 behaviour and is retained as history, not as
    /// a claim: "the combination is literal: the value comes from an operator-authored <c>fleet.json</c> and
    /// is not checked for separators, so it names a path relative to this directory rather than a file
    /// within it."</b> That was true and is what owner item 21 was opened about; as of AQ-1 the value names
    /// a file within this directory's subtree, and nothing else.</para>
    /// <para>The boundary is LEXICAL. A symlink or junction that sits inside this directory and points out
    /// of it is followed by <see cref="File.ReadAllText(string)"/> exactly as before — link targets are not
    /// resolved here, and naming that is cheaper than pretending otherwise. Passing a directory that does
    /// not exist is still not an error — the per-descriptor <c>File.Exists</c> simply fails and every entry
    /// falls back.</para></param>
    /// <param name="logWarning">Optional (defaults to a no-op) — invoked once per descriptor that names a
    /// mapping profile file which does not exist. Deliberately a plain delegate, not
    /// <c>Microsoft.Extensions.Logging.ILogger</c> — St4i.EdgeCore is intentionally logging-framework-free
    /// (same convention <see cref="St4i.EdgeCore.Historian.HistorianWriter"/>/
    /// <see cref="St4i.EdgeCore.Transport.WalFlushPump"/> already use); a host wires this to its own
    /// ILogger when it calls <see cref="Build"/>.</param>
    /// <param name="logError">Optional (defaults to a no-op) — invoked once per descriptor whose named
    /// mapping profile file exists but fails to read or parse (malformed JSON, I/O error, ACL denial).
    /// A descriptor REFUSED by the confinement described on <paramref name="mappingDir"/> is deliberately
    /// NOT routed here: this delegate's contract carries an <see cref="Exception"/>, a refusal has none, and
    /// fabricating one to fit the shape would be a worse lie than using the warning channel the other
    /// operator-typo case already uses.</param>
    public static MappingProfileResolver Build(
        IEnumerable<MachineDescriptor> fleet,
        string mappingDir,
        Action<string>? logWarning = null,
        Action<Exception, string>? logError = null)
    {
        ArgumentNullException.ThrowIfNull(fleet);
        ArgumentNullException.ThrowIfNull(mappingDir);

        var map = new Dictionary<string, MappingProfile>(StringComparer.OrdinalIgnoreCase);
        foreach (var descriptor in fleet)
        {
            map[descriptor.Code] = ResolveOne(descriptor, mappingDir, logWarning, logError);
        }

        return new MappingProfileResolver(map);
    }

    private static MappingProfile ResolveOne(
        MachineDescriptor descriptor, string mappingDir, Action<string>? logWarning, Action<Exception, string>? logError)
    {
        if (string.IsNullOrWhiteSpace(descriptor.MappingProfile))
        {
            return MappingProfile.ForClass(descriptor.DeviceClass);
        }

        var combined = Path.Combine(mappingDir, descriptor.MappingProfile + ".json");

        // 🔴 Owner item 21, task AQ-1 (2026-08-21) — the operator-authored string above is confined to the
        // mapping directory's own subtree here, BEFORE it reaches the filesystem. Path.Combine's documented
        // behaviour is that an absolute right-hand side wins outright, so without this the field named a
        // path rather than a file; MachineDescriptor.MappingProfile's own doc has always said "a profile
        // NAME, not a path", and this is the line that makes that true.
        if (!TryConfineToMappingDirectory(combined, mappingDir, out var path, out var describedTarget))
        {
            logWarning?.Invoke(
                $"Machine {descriptor.Code}: mappingProfile \"{descriptor.MappingProfile}\" resolves to " +
                $"{describedTarget}, which is OUTSIDE the mapping profile directory " +
                $"{DescribeDirectory(mappingDir)} — REFUSED, falling back to " +
                $"MappingProfile.ForClass({descriptor.DeviceClass}). mappingProfile is a profile NAME, not a " +
                "path: in fleet.json give it the file's name without the \".json\" extension, and put that " +
                "file inside the mapping directory (a subdirectory of it is fine). A drive letter, a leading " +
                "separator, a UNC prefix or a \"..\" segment that climbs out of the directory is refused.");
            return MappingProfile.ForClass(descriptor.DeviceClass);
        }

        try
        {
            if (!File.Exists(path))
            {
                logWarning?.Invoke(
                    $"Machine {descriptor.Code}: mappingProfile \"{descriptor.MappingProfile}\" not found at " +
                    $"{path} — falling back to MappingProfile.ForClass({descriptor.DeviceClass})");
                return MappingProfile.ForClass(descriptor.DeviceClass);
            }

            var json = File.ReadAllText(path);
            return MappingProfile.FromJson(json);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.Text.Json.JsonException)
        {
            logError?.Invoke(
                ex,
                $"Machine {descriptor.Code}: mappingProfile \"{descriptor.MappingProfile}\" at {path} failed to " +
                $"load — falling back to MappingProfile.ForClass({descriptor.DeviceClass})");
            return MappingProfile.ForClass(descriptor.DeviceClass);
        }
    }

    /// <summary>🔴 Owner item 21, task AQ-1 (2026-08-21) — decides whether <paramref name="candidatePath"/>
    /// lies inside <paramref name="mappingDir"/>'s subtree, and hands back the ABSOLUTE path to use if it
    /// does. The comparison is made on normalized absolute paths, which is the whole point: filtering
    /// <c>..</c> or a separator out of the operator's string is the classic wrong answer, because it decides
    /// a path question with a string rule and gets beaten by the encodings it did not think of. Normalizing
    /// first and comparing after asks the filesystem's own question instead.
    /// <para>The root is compared WITH a trailing separator so a sibling directory whose name merely starts
    /// with the root's — <c>mapping-archive</c> next to <c>mapping</c> — is not mistaken for a child. The
    /// comparison is <see cref="StringComparison.OrdinalIgnoreCase"/> because every project in this solution
    /// targets <c>net10.0-windows</c> and Windows paths are case-insensitive; on a case-sensitive filesystem
    /// this rule would be too PERMISSIVE, never too strict, and this is the file to change if that day
    /// comes.</para>
    /// <para>Normalization itself can throw, and that is the reason the call sits here rather than inline:
    /// this class's published contract is that it NEVER throws, so a path the runtime cannot normalize at
    /// all is treated as a refusal like any other escape. The out-parameter carries a description fit to put
    /// in front of an operator in either case.</para></summary>
    private static bool TryConfineToMappingDirectory(
        string candidatePath, string mappingDir, out string fullPath, out string describedTarget)
    {
        try
        {
            var rootFull = Path.GetFullPath(mappingDir);
            var rootWithSeparator = rootFull.EndsWith(Path.DirectorySeparatorChar)
                ? rootFull
                : rootFull + Path.DirectorySeparatorChar;

            fullPath = Path.GetFullPath(candidatePath);
            describedTarget = fullPath;

            return fullPath.StartsWith(rootWithSeparator, StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception ex) when (
            ex is ArgumentException or PathTooLongException or NotSupportedException or IOException
                or System.Security.SecurityException)
        {
            fullPath = string.Empty;
            describedTarget = $"a path the runtime could not normalize ({ex.GetType().Name}: {ex.Message})";
            return false;
        }
    }

    /// <summary>The mapping directory as it should appear in a refusal message: its absolute form when that
    /// can be computed, and the caller's own spelling when it cannot. A message that names a RELATIVE
    /// directory tells an operator nothing about where the resolver actually looked, and the one case where
    /// the absolute form is unavailable is exactly the case where the message matters most.</summary>
    private static string DescribeDirectory(string mappingDir)
    {
        try { return Path.GetFullPath(mappingDir); }
        catch (Exception ex) when (
            ex is ArgumentException or PathTooLongException or NotSupportedException or IOException
                or System.Security.SecurityException)
        {
            return mappingDir;
        }
    }

    /// <summary>The resolved profile for <paramref name="machineCode"/>, or <see langword="null"/> if this
    /// code wasn't part of the fleet roster <see cref="Build"/> was called with. Matches the
    /// <c>Func&lt;string, MappingProfile?&gt;</c> shape <see cref="Engine.EdgePipeline"/>'s optional
    /// per-reading resolver parameter expects — a null result there falls back to that pipeline's own
    /// single shared profile, never throws.</summary>
    public MappingProfile? Resolve(string machineCode) =>
        _byMachineCode.TryGetValue(machineCode, out var profile) ? profile : null;
}
