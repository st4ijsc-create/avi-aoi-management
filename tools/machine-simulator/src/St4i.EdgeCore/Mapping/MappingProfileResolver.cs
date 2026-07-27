using St4i.EdgeCore.Models;

namespace St4i.EdgeCore.Mapping;

/// <summary>
/// G2-1 (Giai đoạn 2, task 1 — docs/plans/2026-07-27-giaidoan2-synapse-connect-blueprint.md) — activates
/// the per-machine <c>mapping/*.json</c> profiles that were, until this task, dead placeholders:
/// <see cref="MappingProfile.FromJson"/> was fully implemented and unit-tested but never called from a
/// production composition root, and every machine in the fleet was normalized through one hardcoded
/// shared <c>MappingProfile { Name = "fleet-mixed" }</c> regardless of what <c>fleet.json</c>'s own
/// per-entry <see cref="MachineDescriptor.MappingProfile"/> field named.
///
/// Builds, once per fleet (re)composition (see <c>FleetHost.StartLocked</c>), a
/// machineCode → <see cref="MappingProfile"/> map: a descriptor naming a real
/// <c>mapping/&lt;name&gt;.json</c> file resolves to THAT file's <see cref="MappingProfile.FromJson"/>;
/// a descriptor with no name, or naming a file that is missing/unreadable/malformed, falls back to
/// <see cref="MappingProfile.ForClass"/> for that descriptor's <see cref="MachineDescriptor.DeviceClass"/>
/// — this class NEVER throws, so one bad/missing preset can never take the fleet pipeline down (same
/// "graceful fallback, not a startup crash" contract <c>FleetConfig.Load</c> already keeps for a
/// malformed <c>fleet.json</c> itself).
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
    /// "next to the exe" way <c>FleetHost.ResolveFleetPath</c> already resolves <c>fleet.json</c> itself
    /// (<c>AppContext.BaseDirectory</c>/"mapping"). Safe to call with a non-existent directory — every
    /// entry simply falls back to <see cref="MappingProfile.ForClass"/>.</summary>
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
