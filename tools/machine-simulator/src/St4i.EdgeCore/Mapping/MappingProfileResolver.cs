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
    /// <param name="mappingDir">Where the presets live. The file consulted for a descriptor is this
    /// directory combined with that descriptor's own <c>mappingProfile</c> value plus <c>.json</c>, and
    /// the combination is literal: the value comes from an operator-authored <c>fleet.json</c> and is not
    /// checked for separators, so it names a path relative to this directory rather than a file within
    /// it. Passing a directory that does not exist is not an error — the per-descriptor
    /// <c>File.Exists</c> simply fails and every entry falls back.</param>
    /// <param name="logWarning">Optional (defaults to a no-op) — invoked once per descriptor that names a
    /// mapping profile file which does not exist. Deliberately a plain delegate, not
    /// <c>Microsoft.Extensions.Logging.ILogger</c> — St4i.EdgeCore is intentionally logging-framework-free
    /// (same convention <see cref="St4i.EdgeCore.Historian.HistorianWriter"/>/
    /// <see cref="St4i.EdgeCore.Transport.WalFlushPump"/> already use); a host wires this to its own
    /// ILogger when it calls <see cref="Build"/>.</param>
    /// <param name="logError">Optional (defaults to a no-op) — invoked once per descriptor whose named
    /// mapping profile file exists but fails to read or parse (malformed JSON, I/O error, ACL denial).</param>
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

        var path = Path.Combine(mappingDir, descriptor.MappingProfile + ".json");

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

    /// <summary>The resolved profile for <paramref name="machineCode"/>, or <see langword="null"/> if this
    /// code wasn't part of the fleet roster <see cref="Build"/> was called with. Matches the
    /// <c>Func&lt;string, MappingProfile?&gt;</c> shape <see cref="Engine.EdgePipeline"/>'s optional
    /// per-reading resolver parameter expects — a null result there falls back to that pipeline's own
    /// single shared profile, never throws.</summary>
    public MappingProfile? Resolve(string machineCode) =>
        _byMachineCode.TryGetValue(machineCode, out var profile) ? profile : null;
}
