using System.Text.Json;
using System.Text.Json.Serialization;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Infrastructure;

/// <summary>Thrown by <see cref="FleetConfig.Load"/> when <c>fleet.json</c> exists but isn't valid
/// JSON, or doesn't match the expected shape — always carries the offending path so the caller (WPF
/// startup / edge service) can surface a useful message instead of a bare parser exception.</summary>
public sealed class FleetConfigException : Exception
{
    public string Path { get; }

    public FleetConfigException(string path, string message, Exception? inner = null)
        : base($"{message} (path: {path})", inner)
    {
        Path = path;
    }
}

/// <summary>
/// Loads the simulated fleet's roster from a <c>fleet.json</c> file — a JSON array of machine
/// objects, one per simulated machine, deserialized straight into <see cref="MachineDescriptor"/>.
/// </summary>
public static class FleetConfig
{
    // Canonical fleet.json convention: enum VALUES (deviceClass/driverKind) are matched
    // case-insensitively against the C# enum member names — e.g. deviceClass: automation|iot|aoiAvi
    // (also accepts Automation/AoiAvi/AOIAVI/...); driverKind: simulated|hotFolderAoi|mqtt (also
    // accepts Simulated/HotFolderAoi/MQTT/...). Deliberately NOT pinned to one naming policy (no
    // JsonNamingPolicy passed to JsonStringEnumConverter) so a later task authoring fleet.json +
    // mapping presets can pick whichever casing style it likes without silently misparsing — see
    // FleetConfigTests.Load_parses_mixed_enum_casing_case_insensitively, which locks this in against
    // three different casing styles in one file.
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter() },
    };

    /// <summary>Parses <paramref name="path"/> into a list of <see cref="MachineDescriptor"/>.
    /// Returns an empty list if the file doesn't exist (a fleet with no config file is simply an
    /// empty fleet, not an error). Throws <see cref="FleetConfigException"/> — never a raw framework
    /// exception — if the path exists but isn't a loadable/parseable fleet file (including a path that
    /// is actually a directory — see the guard below); see the catch-all further down for why this
    /// matters beyond just the JSON-parsing cases.</summary>
    public static IReadOnlyList<MachineDescriptor> Load(string path)
    {
        ArgumentException.ThrowIfNullOrEmpty(path);

        // Fix-pass (post-Task-22 review): explicit — <see cref="File.Exists"/> is a FILE-existence
        // check, so it is FALSE for a directory. Without this guard, a fleet.json path that's actually
        // a directory (an operator's config mistake) would fall straight into the "!File.Exists ->
        // empty fleet" branch below and silently produce a ZERO-machine fleet — masking the real
        // mistake as if no fleet.json had been provided at all — rather than the clear, path-carrying
        // error every other bad-input case in this method raises. This is also the simplest portable
        // repro for the class of bug the catch-all further down closes: File.ReadAllText throws
        // UnauthorizedAccessException (not IOException) against a directory on Windows, and — before
        // that catch-all existed — that exact exception type escaped this method entirely unwrapped,
        // past FleetService.LoadFleet's own `catch (FleetConfigException)`, out of the DI constructor /
        // App.OnStartup: an unhandled startup crash despite this class's whole "never a raw framework
        // exception" promise. See FleetConfigTests.Load_path_is_a_directory_throws_FleetConfigException_not_UnauthorizedAccessException.
        if (Directory.Exists(path))
        {
            throw new FleetConfigException(path, "Fleet config path is a directory, not a file");
        }

        if (!File.Exists(path)) return Array.Empty<MachineDescriptor>();

        try
        {
            var json = File.ReadAllText(path);
            var machines = JsonSerializer.Deserialize<List<MachineDescriptor>>(json, Options);
            return (IReadOnlyList<MachineDescriptor>?)machines ?? Array.Empty<MachineDescriptor>();
        }
        catch (IOException e)
        {
            throw new FleetConfigException(path, "Could not read fleet config file", e);
        }
        catch (JsonException e)
        {
            throw new FleetConfigException(path, "Malformed fleet config JSON", e);
        }
        catch (NotSupportedException e)
        {
            // Thrown by System.Text.Json when the JSON shape doesn't match MachineDescriptor's
            // constructor (e.g. wrong types) — same "clear, path-carrying" contract as a parse error.
            throw new FleetConfigException(path, "Fleet config JSON does not match the expected machine shape", e);
        }
        catch (Exception e) when (e is not FleetConfigException)
        {
            // Fix-pass (post-Task-22 review): a bare catch-all, deliberately LAST — every failure mode
            // this method didn't anticipate above (e.g. an ACL-denied fleet.json that DOES pass
            // File.Exists but still throws UnauthorizedAccessException from File.ReadAllText; a
            // PathTooLongException; any other framework exception this method's author didn't foresee)
            // must still come out as a FleetConfigException, never a raw framework exception, because
            // FleetService.LoadFleet's whole "a bad fleet.json must never take down the kiosk" contract
            // is a `catch (FleetConfigException)` around this call.
            throw new FleetConfigException(path, $"Failed to load fleet config: {e.Message}", e);
        }
    }
}
