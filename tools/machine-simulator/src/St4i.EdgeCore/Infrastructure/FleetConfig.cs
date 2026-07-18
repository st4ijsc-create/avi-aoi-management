using System.Text.Json;
using System.Text.Json.Serialization;
using St4i.EdgeCore.Models;

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
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase, allowIntegerValues: true) },
    };

    /// <summary>Parses <paramref name="path"/> into a list of <see cref="MachineDescriptor"/>.
    /// Returns an empty list if the file doesn't exist (a fleet with no config file is simply an
    /// empty fleet, not an error). Throws <see cref="FleetConfigException"/> — never a raw
    /// <see cref="JsonException"/> — if the file exists but can't be parsed into the expected shape.</summary>
    public static IReadOnlyList<MachineDescriptor> Load(string path)
    {
        ArgumentException.ThrowIfNullOrEmpty(path);

        if (!File.Exists(path)) return Array.Empty<MachineDescriptor>();

        string json;
        try
        {
            json = File.ReadAllText(path);
        }
        catch (IOException e)
        {
            throw new FleetConfigException(path, "Could not read fleet config file", e);
        }

        try
        {
            var machines = JsonSerializer.Deserialize<List<MachineDescriptor>>(json, Options);
            return (IReadOnlyList<MachineDescriptor>?)machines ?? Array.Empty<MachineDescriptor>();
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
    }
}
