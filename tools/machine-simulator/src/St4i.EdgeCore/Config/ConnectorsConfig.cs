using System.Text.Json;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Drivers.Modbus;

namespace St4i.EdgeCore.Config;

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
/// dispatch belongs to whichever HOST is reading the file (E-3: <c>St4i.EngineApi</c>'s
/// <c>ConnectorsJsonRegistration</c>, or <c>St4i.EdgeService</c>'s <c>EdgeConnectors</c>).</summary>
/// <param name="Id">The connector's own label, defaulted to <paramref name="Kind"/> when the entry doesn't
/// specify one of its own.
///
/// <para>🔴 <b>WHAT THIS FIELD DOES IS NOW HOST-DEPENDENT, and this paragraph used to deny that.</b> It said
/// the id is "used ONLY for the per-entry warning naming … has no other effect:
/// <see cref="St4i.EdgeCore.Fleet.ConnectorRegistry.Register"/> keys on the constructed
/// <see cref="St4i.Connector.Abstractions.IConnectorFactory.Kind"/> … never on this field." <b>That was true
/// of the one host that existed when it was written and is false of the host E-3 added.</b>
/// <list type="bullet">
/// <item><b><c>St4i.EngineApi</c></b> — still true for a TCP/OPC-UA entry: it registers under the KIND
/// (<c>ConnectorsJsonRegistration.RegistrationKeyOf</c>), deliberately, because adopting the operator's id
/// there would move a running install's pipeline slot label and therefore its alarm <c>TargetId</c>. An RTU
/// bus entry is already the exception — it registers under this id.</item>
/// <item><b><c>St4i.EdgeService</c></b> — <b>THE ID IS THE REGISTRATION KEY</b>
/// (<c>EdgeConnectors.RegistrationKeyOf</c>). That host has no legacy slot labels to move, and keying on the
/// kind would collapse every Modbus entry in a file into one instance, which is exactly what "N devices"
/// must not mean.</item>
/// </list>
/// Corrected by the E-3 review. Worth naming the mechanism as well as the instance: this is the second stale
/// doc-comment claim found in THIS file in THIS task — the first was a <c>cref</c> E-2's move had falsified,
/// repaired two lines from here — and neither was caught by the build, because XML doc generation is off and
/// nothing checks prose. A doc comment carrying a load-bearing invariant needs the invariant asserted
/// somewhere that can go red; this one now is, by
/// <c>EdgeWorkerConnectorsTests.NEntries_YieldNRegisteredInstances_EachKeyedByItsOwnId</c>.</para></param>
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
    /// <param name="registrationKeyOf">🔴 Task D-7a — <b>what key an entry will actually be REGISTERED under</b>,
    /// which is the only thing either rule above can honestly compare on. <see langword="null"/> (the default)
    /// means <c>entry =&gt; entry.Kind</c>, i.e. byte-for-byte the behaviour this method had before D-7a and
    /// the correct answer for every entry that existed before it.
    ///
    /// <para>It became a parameter because it stopped being always-the-kind. A Modbus RTU entry is not one
    /// connector but a BUS, registered under the operator's own <see cref="ConnectorConfigEntry.Id"/> and
    /// fanned out into N instances — so a site with two RS-485 lines has two Modbus-kind entries that do not
    /// conflict with each other, and neither of them conflicts with an <c>ST4I_MODBUS_MAP</c>-configured TCP
    /// connector. Keyed on the kind, both rules would have suppressed the second bus and both would have called
    /// it a duplicate.</para>
    ///
    /// <para><b>The compatibility rule survives literally, not by argument:</b> the env-precedence set holds
    /// KINDS, and both pre-D-7a arms register under the kind, so for every entry a pre-D-7a build could have
    /// carried this resolver returns exactly the value the old code compared. The one production caller passes
    /// <c>ConnectorsJsonRegistration.RegistrationKeyOf</c>, which is the same method the dispatch itself uses —
    /// deliberately, so "what will this register as" has one implementation rather than two that can
    /// drift.</para></param>
    public static IReadOnlyList<ConnectorConfigEntry> ResolveEntries(
        IReadOnlyList<ConnectorConfigEntry> entries,
        IReadOnlySet<string> alreadyConfiguredKinds,
        Action<string>? logWarning = null,
        Func<ConnectorConfigEntry, string>? registrationKeyOf = null)
    {
        ArgumentNullException.ThrowIfNull(entries);
        ArgumentNullException.ThrowIfNull(alreadyConfiguredKinds);

        var keyOf = registrationKeyOf ?? (entry => entry.Kind);

        var resolved = new List<ConnectorConfigEntry>();
        var acceptedKeys = new Dictionary<string, string>(StringComparer.Ordinal); // registration key -> accepted entry's id, for the duplicate-naming warning.

        foreach (var entry in entries)
        {
            var key = keyOf(entry);

            if (alreadyConfiguredKinds.Contains(key))
            {
                logWarning?.Invoke(
                    $"connectors.json entry '{entry.Id}' (kind '{entry.Kind}') ignored — an environment " +
                    "variable already configures this connector kind for this run; environment variables take precedence.");
                continue;
            }

            if (acceptedKeys.TryGetValue(key, out var firstId))
            {
                logWarning?.Invoke(
                    $"connectors.json entry '{entry.Id}' (kind '{entry.Kind}') ignored — entry '{firstId}' " +
                    "already configures this same kind earlier in the file; the first entry for a given kind wins.");
                continue;
            }

            acceptedKeys[key] = entry.Id;
            resolved.Add(entry);
        }

        return resolved;
    }

    /// <summary>
    /// 🔴 Task E-5 — <b>whether this entry is an RS-485 BUS rather than a single connector.</b> One statement,
    /// because after E-5 there are FOUR places that have to answer it identically and they sit in two
    /// assemblies that cannot see each other's private helpers.
    ///
    /// <para>The four: <c>ConnectorsJsonRegistration.RegisterAll</c>'s dispatch and its
    /// <c>RegistrationKeyOf</c> (St4i.EngineApi), and <c>EdgeConnectors.Build</c>'s dispatch and its
    /// <c>RegistrationKeyOf</c> (St4i.EdgeService). Two of them decide WHICH CODE RUNS and two decide WHAT KEY
    /// THE ENTRY OCCUPIES, and a drift between a host's own pair is the worst kind: an entry dispatched as a
    /// bus while its de-duplication key says "one Modbus connector" collapses a second bus in the same file
    /// into the first, silently.</para>
    ///
    /// <para><b>Why the predicate is "declares a transport" and not a sixth <see cref="DriverKinds"/> value</b>
    /// is <see cref="ModbusRtuBusSettings.DeclaresATransport"/>'s own subject; this method exists only so the
    /// four sites ask it through one name rather than re-spelling the conjunction.</para>
    /// </summary>
    public static bool IsRtuBus(ConnectorConfigEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);

        return entry.Kind == DriverKinds.Modbus && ModbusRtuBusSettings.DeclaresATransport(entry.SettingsJson);
    }
}
