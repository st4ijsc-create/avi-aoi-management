using System.Text.Json;
using St4i.Connector.Abstractions.Models;

namespace St4i.EngineApi.Config;

/// <summary>Thrown by <see cref="ConnectorsConfig.Load"/> when <c>connectors.json</c> exists but isn't
/// valid JSON, or doesn't match the expected shape (root isn't an array) — reserved for the file genuinely
/// not parsing at all, mirroring <see cref="St4i.EdgeCore.Infrastructure.FleetConfigException"/> exactly
/// (same "GP-3 lesson": a single malformed ENTRY inside an otherwise-valid array never reaches this
/// exception, see <see cref="ConnectorsConfig.Load"/>'s own remarks).</summary>
public sealed class ConnectorsConfigException : Exception
{
    public string Path { get; }

    public ConnectorsConfigException(string path, string message, Exception? inner = null)
        : base($"{message} (path: {path})", inner)
    {
        Path = path;
    }
}

/// <summary>One parsed <c>connectors.json</c> entry, already validated (non-blank <see cref="Kind"/>, a
/// present <c>settings</c> value) but not yet dispatched to any specific connector-kind constructor — that
/// dispatch is Program.cs's job (mirroring exactly how it already owns "which built-in factory type does
/// ST4I_MODBUS_ENABLED/ST4I_OPCUA_ENABLED construct").</summary>
/// <param name="Id">The connector's own label — used ONLY for the per-entry warning naming (see
/// <see cref="ConnectorsConfig.Load"/>'s remarks) and defaulted to <paramref name="Kind"/> when the entry
/// doesn't specify one of its own. Has no other effect: <see cref="St4i.EngineApi.Fleet.ConnectorRegistry.Register"/>
/// keys on the constructed <see cref="St4i.Connector.Abstractions.IConnectorFactory.Kind"/> (a built-in
/// factory's own <c>Kind</c> getter is a fixed constant, e.g. <see cref="DriverKinds.Modbus"/>), never on
/// this field.</param>
/// <param name="Kind">Which connector kind's factory to construct — normalized the same way every other
/// connector id in this codebase is (<see cref="DriverKinds.Normalize"/>), so <c>"modbus"</c>/<c>"Modbus"</c>/
/// <c>"MODBUS"</c> all resolve identically.</param>
/// <param name="SettingsJson">The entry's <c>settings</c> value, forwarded VERBATIM as the exact JSON
/// substring it appeared as (<see cref="JsonElement.GetRawText"/>) — never re-interpreted here. See the
/// class doc comment's "settings representation" note for why this is inline JSON, not a path.</param>
public sealed record ConnectorConfigEntry(string Id, string Kind, string SettingsJson);

/// <summary>
/// GP-5 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-5-brief.md item 2) — loads
/// <c>connectors.json</c>, the config source that makes "adding/configuring a connector is configuration,
/// not a code change" actually true: alongside <c>fleet.json</c> (same shipping convention — a loose file
/// next to the exe, <c>CopyToOutputDirectory=PreserveNewest</c>, hand-editable post-publish), a JSON array
/// of <c>{ id, kind, settings }</c> objects.
///
/// <para><b>Settings representation — inline JSON, not a path (the brief's own required decision).</b>
/// <c>settings</c> is an embedded JSON value, forwarded to whichever <see cref="St4i.Connector.Abstractions.IConnectorFactory"/>
/// is constructed for its <c>kind</c> as the exact raw JSON substring it appeared as
/// (<see cref="JsonElement.GetRawText"/>) — never a path to a second file. Chosen over a path for three
/// reasons: (1) it keeps a WHOLE connector definition in ONE hand-editable file — an operator onboarding a
/// new connector edits exactly one thing, not two; (2) it needs no new path-resolution convention (relative
/// to what base directory? on what platform?) — one less thing to get wrong or need to document; (3) it is
/// already exactly what <see cref="St4i.Connector.Abstractions.IConnectorFactory.TryCreate"/>'s own contract
/// wants — a plain opaque string, forwarded verbatim, "config is completely opaque to any caller of this
/// method" (that interface's own doc comment) — <c>GetRawText()</c> satisfies that literally, byte-for-byte,
/// with zero re-interpretation. This does NOT remove the existing <c>ST4I_MODBUS_MAP</c>/<c>ST4I_OPCUA_MAP</c>
/// env-var route, which keeps reading its map from a SEPARATE physical file exactly as it always has — an
/// operator who prefers a separate file (e.g. to avoid duplicating a large register map inline) can keep
/// using that route unchanged; connectors.json is an ADDITIONAL, independent way to configure the same two
/// built-in kinds (or, once a plugin-loading mechanism exists, any other kind Program.cs knows how to
/// construct), never a replacement.</para>
///
/// <para><b>Scope boundary:</b> this class only PARSES <c>connectors.json</c> into plain
/// <see cref="ConnectorConfigEntry"/> values — it has no opinion on which <c>kind</c> strings this build can
/// actually construct a factory for (that dispatch, and any "unknown kind" warning, is Program.cs's job,
/// mirroring exactly how <c>ModbusOptions</c>/<c>OpcUaOptions</c> parsing is separate from Program.cs's own
/// "what do I DO with a successfully-parsed option set" wiring).</para>
/// </summary>
public static class ConnectorsConfig
{
    private static readonly JsonSerializerOptions Options = new() { PropertyNameCaseInsensitive = true };

    /// <summary>Parses <paramref name="path"/> into a list of <see cref="ConnectorConfigEntry"/>. Returns
    /// an empty list if the file doesn't exist — a deployment with no <c>connectors.json</c> (or an
    /// existing install that predates it) is simply "no additional connectors configured this way," never
    /// an error; this is exactly what keeps the compatibility rule ("an existing install with only the four
    /// env vars set must behave byte-identically") true. Throws <see cref="ConnectorsConfigException"/> —
    /// never a raw framework exception — only when the file itself isn't loadable at all (a directory, an
    /// I/O failure, or JSON whose root isn't an array).
    ///
    /// <para>GP-3's parsing lesson, applied here too: a per-ENTRY parse failure (missing/blank <c>kind</c>,
    /// a missing <c>settings</c> value, or an entry that isn't a JSON object at all) never fails the whole
    /// file — that entry is skipped, reported via <paramref name="logWarning"/> naming it by its <c>id</c>
    /// field (or its 1-based position if <c>id</c> itself isn't readable), while every other valid entry in
    /// the same file still loads. Only genuinely unparseable JSON (bad syntax, or a non-array root) falls
    /// back wholesale, via <see cref="ConnectorsConfigException"/> — the same "one typo must never destroy
    /// the whole file" contract <see cref="St4i.EdgeCore.Infrastructure.FleetConfig.Load"/> already
    /// established for <c>fleet.json</c>.</para>
    /// </summary>
    /// <param name="path">The connectors.json path.</param>
    /// <param name="logWarning">Invoked once per malformed entry skipped, naming the entry and the reason.
    /// Optional — a <see langword="null"/> callback just means the warning isn't surfaced anywhere (the
    /// entry is still skipped either way).</param>
    public static IReadOnlyList<ConnectorConfigEntry> Load(string path, Action<string>? logWarning = null)
    {
        ArgumentException.ThrowIfNullOrEmpty(path);

        if (Directory.Exists(path))
        {
            throw new ConnectorsConfigException(path, "Connectors config path is a directory, not a file");
        }

        if (!File.Exists(path)) return Array.Empty<ConnectorConfigEntry>();

        try
        {
            var json = File.ReadAllText(path);
            using var document = JsonDocument.Parse(json);

            if (document.RootElement.ValueKind == JsonValueKind.Null) return Array.Empty<ConnectorConfigEntry>();

            if (document.RootElement.ValueKind != JsonValueKind.Array)
            {
                throw new ConnectorsConfigException(path, "Connectors config JSON does not match the expected {id, kind, settings} array shape");
            }

            var entries = new List<ConnectorConfigEntry>();
            var index = 0;
            foreach (var element in document.RootElement.EnumerateArray())
            {
                index++;
                var label = DescribeId(element, index);

                if (element.ValueKind != JsonValueKind.Object)
                {
                    logWarning?.Invoke($"connectors.json entry {label} is not a JSON object — skipped (path: {path})");
                    continue;
                }

                if (!element.TryGetProperty("kind", out var kindProp) ||
                    kindProp.ValueKind != JsonValueKind.String ||
                    string.IsNullOrWhiteSpace(kindProp.GetString()))
                {
                    logWarning?.Invoke($"connectors.json entry {label} is missing a non-blank 'kind' — skipped (path: {path})");
                    continue;
                }

                if (!element.TryGetProperty("settings", out var settingsProp))
                {
                    logWarning?.Invoke($"connectors.json entry {label} is missing a 'settings' value — skipped (path: {path})");
                    continue;
                }

                var kind = kindProp.GetString()!;
                var id = element.TryGetProperty("id", out var idProp) && idProp.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(idProp.GetString())
                    ? idProp.GetString()!
                    : kind;

                entries.Add(new ConnectorConfigEntry(id, DriverKinds.Normalize(kind), settingsProp.GetRawText()));
            }

            return entries;
        }
        catch (IOException e)
        {
            throw new ConnectorsConfigException(path, "Could not read connectors config file", e);
        }
        catch (JsonException e)
        {
            throw new ConnectorsConfigException(path, "Malformed connectors config JSON", e);
        }
        catch (Exception e) when (e is not ConnectorsConfigException)
        {
            throw new ConnectorsConfigException(path, $"Failed to load connectors config: {e.Message}", e);
        }
    }

    /// <summary>Best-effort label for a per-entry warning: the entry's own <c>id</c> field if it's a
    /// readable string, else its 1-based position — mirrors <c>FleetConfig.Load</c>'s own <c>DescribeCode</c>
    /// exactly.</summary>
    private static string DescribeId(JsonElement element, int index)
    {
        if (element.ValueKind == JsonValueKind.Object &&
            element.TryGetProperty("id", out var idProp) &&
            idProp.ValueKind == JsonValueKind.String &&
            !string.IsNullOrWhiteSpace(idProp.GetString()))
        {
            return $"#{index} ('{idProp.GetString()}')";
        }

        return $"#{index}";
    }

    /// <summary>
    /// GP-5 (task-5-brief.md item 2) — the precedence rule between the four legacy env vars
    /// (<c>ST4I_MODBUS_ENABLED</c>/<c>ST4I_MODBUS_MAP</c>/<c>ST4I_OPCUA_ENABLED</c>/<c>ST4I_OPCUA_MAP</c>)
    /// and a <c>connectors.json</c> entry configuring the SAME connector kind: <b>the env var wins,
    /// unconditionally</b>, and the conflicting <c>connectors.json</c> entry is skipped with a warning
    /// naming the conflict — never silent.
    ///
    /// <para><b>Why env wins (not "last one wins" or "connectors.json wins"):</b> the compatibility rule
    /// this whole task is built around is "an existing install with only the four env vars set must behave
    /// byte-identically." The only way to guarantee that unconditionally — even for an install that LATER
    /// also gains an unrelated <c>connectors.json</c> (say, to onboard a genuinely different third-party
    /// connector) — is for the env-var route to always win any conflict over the SAME kind. If
    /// <c>connectors.json</c> won instead, a stray or copy-pasted entry for <c>"kind": "Modbus"</c> could
    /// silently reconfigure (or shadow) a working env-var-configured production Modbus connector the moment
    /// that file was dropped in for an unrelated reason — exactly the kind of silent behavior change this
    /// task's compatibility rule forbids.</para>
    ///
    /// <para>Also de-duplicates WITHIN <c>connectors.json</c> itself: <see cref="ConnectorRegistry.Register"/>
    /// (GP-4) is "last write wins" for the SAME normalized kind, which would otherwise let a second entry
    /// for an already-accepted kind silently supersede the first with no warning at all — a second instance
    /// of the exact same "one bad/duplicate entry must never silently destroy another's config" hazard GP-3
    /// already fixed for <c>fleet.json</c>. Entries are resolved in array order — the FIRST entry for a given
    /// kind (that isn't already env-configured) wins; any later entry for the SAME kind is skipped with a
    /// warning naming both.</para>
    /// </summary>
    /// <param name="entries">Parsed <c>connectors.json</c> entries, in file order.</param>
    /// <param name="alreadyConfiguredKinds">Normalized kinds already wired up via the legacy env vars this
    /// process run (e.g. <c>{"Modbus"}</c> when <c>ST4I_MODBUS_ENABLED</c>+<c>ST4I_MODBUS_MAP</c> both
    /// succeeded) — empty when neither env-var route is active.</param>
    /// <param name="logWarning">Invoked once per entry skipped for precedence/duplicate reasons, naming the
    /// entry and why. Optional.</param>
    public static IReadOnlyList<ConnectorConfigEntry> ResolveEntries(
        IReadOnlyList<ConnectorConfigEntry> entries,
        IReadOnlySet<string> alreadyConfiguredKinds,
        Action<string>? logWarning = null)
    {
        ArgumentNullException.ThrowIfNull(entries);
        ArgumentNullException.ThrowIfNull(alreadyConfiguredKinds);

        var resolved = new List<ConnectorConfigEntry>();
        var acceptedKinds = new Dictionary<string, string>(StringComparer.Ordinal); // kind -> accepted entry's id, for the duplicate-naming warning.

        foreach (var entry in entries)
        {
            if (alreadyConfiguredKinds.Contains(entry.Kind))
            {
                logWarning?.Invoke(
                    $"connectors.json entry '{entry.Id}' (kind '{entry.Kind}') ignored — an environment " +
                    "variable already configures this connector kind for this run; environment variables take precedence.");
                continue;
            }

            if (acceptedKinds.TryGetValue(entry.Kind, out var firstId))
            {
                logWarning?.Invoke(
                    $"connectors.json entry '{entry.Id}' (kind '{entry.Kind}') ignored — entry '{firstId}' " +
                    "already configures this same kind earlier in the file; the first entry for a given kind wins.");
                continue;
            }

            acceptedKinds[entry.Kind] = entry.Id;
            resolved.Add(entry);
        }

        return resolved;
    }
}
