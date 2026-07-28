using System.Text.Json;
using System.Text.Json.Serialization;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Infrastructure;

/// <summary>Thrown by <see cref="FleetConfig.Load"/> when <c>fleet.json</c> exists but isn't valid
/// JSON, or doesn't match the expected shape — always carries the offending path so the caller (WPF
/// startup / edge service) can surface a useful message instead of a bare parser exception. Since GP-3
/// this is reserved for genuinely unparseable input (bad JSON syntax, or the root isn't an array) —
/// one malformed MACHINE ENTRY inside an otherwise-valid array no longer reaches this exception at all,
/// see <see cref="FleetConfig.Load"/>'s own remarks.</summary>
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
    // Canonical fleet.json convention: deviceClass is matched case-insensitively against the C# enum
    // member names (via JsonStringEnumConverter, still an enum) — e.g. deviceClass:
    // automation|iot|aoiAvi (also accepts Automation/AoiAvi/AOIAVI/...). driverKind (GP-3: now a plain
    // string, not an enum — JsonStringEnumConverter has no say in it) accepts any casing too, but for a
    // DIFFERENT reason: Load normalizes each parsed entry's DriverKind through
    // St4i.Connector.Abstractions.Models.DriverKinds.Normalize below, which case-insensitively folds
    // anything matching one of the five built-in ids to its canonical spelling (e.g. "simulated" ->
    // "Simulated") and leaves anything else (a third-party id) untouched, byte-for-byte. Deliberately
    // NOT pinned to one naming policy for deviceClass (no JsonNamingPolicy passed to
    // JsonStringEnumConverter) so a later task authoring fleet.json + mapping presets can pick whichever
    // casing style it likes without silently misparsing — see
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
    /// exception — only when the path exists but the FILE ITSELF isn't loadable (a directory, an I/O
    /// failure, or JSON that doesn't even parse / whose root isn't an array — see the guards below).
    ///
    /// GP-3 fix (the "one operator typo destroys the whole fleet" bug): a per-ENTRY parse failure (e.g.
    /// a machine object whose <c>deviceClass</c> doesn't match any enum member) no longer fails the
    /// whole file. Each array element is parsed independently; an entry that doesn't fit
    /// <see cref="MachineDescriptor"/>'s shape is skipped — reported to the caller via
    /// <paramref name="logWarning"/>, naming the entry by its <c>code</c> field (or its 1-based position
    /// if <c>code</c> itself isn't readable) — while every other, valid entry in the same file still
    /// loads. <c>FleetHost</c>/<c>FleetService</c>/<c>EdgeWorker</c> all called this method with the SAME
    /// "malformed file -> fall back to the in-code default fleet" contract before this fix; that
    /// whole-file fallback is now reserved for the file genuinely not parsing at all (caught here as
    /// <see cref="FleetConfigException"/>) — a single bad entry among otherwise-valid ones no longer
    /// throws, so those callers' fallback is simply never reached for that case: the valid entries load,
    /// the operator's real roster survives, and only the one malformed entry is missing.
    /// </summary>
    /// <param name="path">The fleet.json path.</param>
    /// <param name="logWarning">Invoked once per malformed entry skipped, with a human-readable message
    /// naming the entry and the reason it was skipped. Optional — a <see langword="null"/> callback just
    /// means the warning isn't surfaced anywhere (the entry is still skipped either way).</param>
    public static IReadOnlyList<MachineDescriptor> Load(string path, Action<string>? logWarning = null)
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

            using var document = JsonDocument.Parse(json);

            // A literal JSON `null` root used to deserialize to a null List<MachineDescriptor>, coalesced
            // to an empty fleet by the old single-shot JsonSerializer.Deserialize call below — preserved
            // here rather than treated as a shape mismatch, so this edge case is byte-for-byte unchanged.
            if (document.RootElement.ValueKind == JsonValueKind.Null) return Array.Empty<MachineDescriptor>();

            if (document.RootElement.ValueKind != JsonValueKind.Array)
            {
                throw new FleetConfigException(path, "Fleet config JSON does not match the expected machine shape");
            }

            var machines = new List<MachineDescriptor>();
            var index = 0;
            foreach (var element in document.RootElement.EnumerateArray())
            {
                index++;
                try
                {
                    var descriptor = element.Deserialize<MachineDescriptor>(Options);
                    if (descriptor is null)
                    {
                        logWarning?.Invoke($"fleet.json entry #{index} is JSON null — skipped (path: {path})");
                        continue;
                    }

                    // GP-3 — the one place an externally-authored driverKind is normalized against the
                    // five built-ins (see DriverKinds.Normalize's own doc comment for the casing rule).
                    //
                    // Task 9 fix — an OMITTED driverKind key deserializes descriptor.DriverKind to null
                    // (MachineDescriptor.DriverKind is a plain, non-required string since GP-3 opened it
                    // from a closed enum), and DriverKinds.Normalize(null) returns null BY DESIGN (see its
                    // own doc comment: "nothing to normalize against" — several OTHER call sites, e.g.
                    // FleetHost's registry-key lookups, rely on that null-passthrough and must not change).
                    // BEFORE GP-3, the same omission deserialized straight to the closed enum's ordinal 0
                    // (DriverKind.Simulated) for free, via System.Text.Json's default-enum-member behavior
                    // — GP-3 silently lost that: a null DriverKind sails through this loader (simFleet's
                    // filter still happens to include it), but AssetRegistryStore.UpsertAsync writes into a
                    // driver_kind TEXT NOT NULL column and its blanket catch swallows the resulting
                    // constraint failure, so that machine's asset row is silently never written. Restoring
                    // the pre-GP-3 default HERE (the one shared entry point FleetHost/FleetService/
                    // EdgeWorker all load fleet.json through) rather than inside DriverKinds.Normalize
                    // itself keeps every other Normalize call site's null-passthrough intact.
                    var driverKind = descriptor.DriverKind is null
                        ? DriverKinds.Simulated
                        : DriverKinds.Normalize(descriptor.DriverKind);
                    machines.Add(descriptor with { DriverKind = driverKind });
                }
                catch (Exception e) when (e is JsonException or NotSupportedException or FormatException)
                {
                    logWarning?.Invoke($"fleet.json entry #{index}{DescribeCode(element)} is malformed and was skipped: {e.Message} (path: {path})");
                }
            }

            return machines;
        }
        catch (IOException e)
        {
            throw new FleetConfigException(path, "Could not read fleet config file", e);
        }
        catch (JsonException e)
        {
            throw new FleetConfigException(path, "Malformed fleet config JSON", e);
        }
        catch (Exception e) when (e is not FleetConfigException)
        {
            // Fix-pass (post-Task-22 review): a bare catch-all, deliberately LAST — every failure mode
            // this method didn't anticipate above (e.g. an ACL-denied fleet.json that DOES pass
            // File.Exists but still throws UnauthorizedAccessException from File.ReadAllText; a
            // PathTooLongException; any other framework exception this method's author didn't foresee)
            // must still come out as a FleetConfigException, never a raw framework exception, because
            // every caller's whole "a bad fleet.json must never take down the kiosk/service" contract is
            // a `catch (FleetConfigException)` around this call.
            throw new FleetConfigException(path, $"Failed to load fleet config: {e.Message}", e);
        }
    }

    /// <summary>Best-effort label for a per-entry warning: the entry's own <c>code</c> field if it's
    /// readable (the common case — most malformed entries still have an intact <c>code</c>, since the
    /// field that actually failed to parse is usually something else, e.g. <c>deviceClass</c>), else
    /// empty (the caller's message already names the entry by its 1-based position).</summary>
    private static string DescribeCode(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object &&
            element.TryGetProperty("code", out var codeProp) &&
            codeProp.ValueKind == JsonValueKind.String)
        {
            return $" ('{codeProp.GetString()}')";
        }

        return string.Empty;
    }
}
