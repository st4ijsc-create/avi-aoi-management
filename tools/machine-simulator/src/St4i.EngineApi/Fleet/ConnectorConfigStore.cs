using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace St4i.EngineApi.Fleet;

/// <summary>
/// Task B-3 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-3-brief.md) — what a parsed map
/// declares it grants, in the ONE shape shared by both protocols (a
/// <see cref="St4i.EdgeCore.Drivers.Modbus.ModbusRegisterMap"/>'s own <c>WritablePointNames</c>/<c>CommandNames</c>,
/// or an <see cref="St4i.EdgeCore.Drivers.OpcUa.OpcUaNodeMap"/>'s own, adapted into this generic shape by
/// <see cref="ConnectorConfigValidation"/> — the same place that already adapts either protocol's own parsed
/// map into the generic <see cref="ConnectorConfigValidation.ConnectorValidationResult"/>).
///
/// <para><b>Why this surfaces as its own <see cref="ConnectorConfigStore"/> COLUMN, not left inside the
/// opaque <see cref="ConnectorConfigRecord.MapJson"/> blob</b> (the brief's own "decide, and justify"
/// question): <see cref="ConnectorConfigStore"/>'s whole design point is that <c>map_json</c> is NEVER even
/// <c>SELECT</c>ed by <see cref="ConnectorConfigStore.ListAsync"/> — it may embed OPC-UA credentials, so the
/// credential-free projection structurally cannot include it. If write-capability info lived only inside that
/// blob, <c>GET /v1/connectors/configured</c> (the one place an operator/engineer can see what is
/// CONFIGURED, credential-free) could never show "this connector can write to a device" at all — the exact
/// visibility the batch's own safety framing calls for ("the map file is the entire safety boundary" argues
/// FOR maximum visibility of what a map grants, not less). Re-parsing the protocol-specific map JSON on every
/// list call is also a non-option: <see cref="ConnectorConfigStore"/> is deliberately protocol-agnostic (it
/// has never referenced <c>St4i.EdgeCore</c>'s Modbus/OPC-UA types, and doing so here would break that
/// layering just to recompute a fact the caller already computed once at save time). So the CALLER
/// (<see cref="ConnectorConfigValidation"/>/the save endpoint) computes this once, from the map it already
/// parsed, and <see cref="ConnectorConfigStore.SaveAsync"/> simply persists what it's told — mirroring exactly
/// how <c>machine_code</c>/<c>host</c>/<c>port</c> already work (also caller-computed facts about the opaque
/// blob, stored as their own columns for exactly this reason).</para>
///
/// <para><b>What a pre-existing row means</b> (the <c>PRAGMA user_version</c> ladder's own required
/// question): <c>write_capability_json</c> is added by migration version 2 as a nullable column with NO
/// default expression — SQLite's own <c>ALTER TABLE ... ADD COLUMN</c> rule for a nullable column with no
/// <c>DEFAULT</c> sets every EXISTING row's new column to <c>NULL</c>. <see langword="null"/> here means
/// exactly "declares no write/command capability" — which is CORRECT, not merely a safe placeholder, for
/// every row written before this task existed: no schema before Task B-3 had any way to declare a writable
/// point or command at all, so every pre-existing persisted map is, in fact, read-only.</para>
/// </summary>
/// <summary>Task B-3 fix round 1 (Important #1) — one writable point's grant: its name, the wire TARGET it
/// actually points at (a Modbus register's <c>"address:&lt;n&gt;"</c>, an OPC-UA node's own NodeId), and its
/// declared bounds (<see langword="null"/> for a <c>Bool</c> OPC-UA setpoint, which has none by design — see
/// <see cref="St4i.EdgeCore.Drivers.OpcUa.OpcUaWritableSetpoint"/>'s own remarks; always populated for
/// Modbus). Originally this carried only <see cref="Name"/> — the review proved that let a map's bounds be
/// WIDENED, or a point RE-POINTED to a different address/NodeId, under an already-confirmed fingerprint,
/// which defeats the entire point of the confirmation for a task whose headline rule is "limits are
/// mandatory".</summary>
public sealed record ConnectorWritablePointGrant(string Name, string Target, double? Min, double? Max);

/// <summary>Task B-3 fix round 1 (Important #1) — one command's grant: its name and the wire target it
/// actually fires (a Modbus coil address, an OPC-UA object/method NodeId pair), formatted as one
/// human-readable string by the protocol-specific map itself (never re-parsed here) — so a RE-POINTED
/// command also changes the confirmation fingerprint, not just whether a command by this name exists.</summary>
public sealed record ConnectorCommandGrant(string Name, string Target);

/// <summary>
/// Task B-3 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-3-brief.md) — what a parsed map
/// declares it grants, in the ONE shape shared by both protocols (a
/// <see cref="St4i.EdgeCore.Drivers.Modbus.ModbusRegisterMap"/>'s own <c>WritablePointBounds</c>/<c>CommandTargets</c>,
/// or an <see cref="St4i.EdgeCore.Drivers.OpcUa.OpcUaNodeMap"/>'s own, adapted into this generic shape by
/// <see cref="ConnectorConfigValidation"/> — the same place that already adapts either protocol's own parsed
/// map into the generic <see cref="ConnectorConfigValidation.ConnectorValidationResult"/>).
///
/// <para><b>Why this surfaces as its own <see cref="ConnectorConfigStore"/> COLUMN, not left inside the
/// opaque <see cref="ConnectorConfigRecord.MapJson"/> blob</b> (the brief's own "decide, and justify"
/// question): <see cref="ConnectorConfigStore"/>'s whole design point is that <c>map_json</c> is NEVER even
/// <c>SELECT</c>ed by <see cref="ConnectorConfigStore.ListAsync"/> — it may embed OPC-UA credentials, so the
/// credential-free projection structurally cannot include it. If write-capability info lived only inside that
/// blob, <c>GET /v1/connectors/configured</c> (the one place an operator/engineer can see what is
/// CONFIGURED, credential-free) could never show "this connector can write to a device" at all — the exact
/// visibility the batch's own safety framing calls for ("the map file is the entire safety boundary" argues
/// FOR maximum visibility of what a map grants, not less). Re-parsing the protocol-specific map JSON on every
/// list call is also a non-option: <see cref="ConnectorConfigStore"/> is deliberately protocol-agnostic (it
/// has never referenced <c>St4i.EdgeCore</c>'s Modbus/OPC-UA types, and doing so here would break that
/// layering just to recompute a fact the caller already computed once at save time). So the CALLER
/// (<see cref="ConnectorConfigValidation"/>/the save endpoint) computes this once, from the map it already
/// parsed, and <see cref="ConnectorConfigStore.SaveAsync"/> simply persists what it's told — mirroring exactly
/// how <c>machine_code</c>/<c>host</c>/<c>port</c> already work (also caller-computed facts about the opaque
/// blob, stored as their own columns for exactly this reason).</para>
///
/// <para><b>What a pre-existing row means</b> (the <c>PRAGMA user_version</c> ladder's own required
/// question): <c>write_capability_json</c> is added by migration version 2 as a nullable column with NO
/// default expression — SQLite's own <c>ALTER TABLE ... ADD COLUMN</c> rule for a nullable column with no
/// <c>DEFAULT</c> sets every EXISTING row's new column to <c>NULL</c>. <see langword="null"/> here means
/// exactly "declares no write/command capability" — which is CORRECT, not merely a safe placeholder, for
/// every row written before this task existed: no schema before Task B-3 had any way to declare a writable
/// point or command at all, so every pre-existing persisted map is, in fact, read-only.</para>
///
/// <para><b>Known gap, deliberately not fixed this round (Fix round 1, I2) — <c>ST4I_MODBUS_MAP</c>/
/// <c>ST4I_OPCUA_MAP</c> and <c>connectors.json</c>-configured connectors bypass this column entirely.</b>
/// Program.cs's startup wiring parses those maps through the SAME <c>FromJson</c> (so mandatory limits ARE
/// enforced identically — no bypass of the safety rule itself), but seeds the fleet roster directly, without
/// ever going through <see cref="ConnectorConfigValidation"/>/this store — a pre-existing SM-5 architecture
/// choice, unchanged by this task. Consequence: <c>GET /v1/connectors/configured</c> cannot show write
/// capability for that deployment shape (the one a machine builder driving a fixed-hardware line is MOST
/// likely to use, versus an operator pasting JSON through the UI). Considered and rejected fixing this here:
/// extending Program.cs's startup wiring to also populate a store row for an env/file-configured connector
/// (purely for visibility — no gate applies, since there is no interactive save to gate) is a real, bounded
/// follow-up, but it reaches into the fleet-seeding startup path this task's own brief scoped OUT of ("the
/// save-gate touches the existing POST /v1/connectors ... coordinate: change what that route requires, not
/// where writes are authorised"). Deferred rather than expanded into here — flagged explicitly rather than
/// left silent, per the review's own instruction.</para>
/// </summary>
public sealed record ConnectorWriteCapability(
    IReadOnlyList<ConnectorWritablePointGrant> WritablePoints, IReadOnlyList<ConnectorCommandGrant> Commands)
{
    /// <summary>The value every read-only connector (every map before this task, and every map after it that
    /// simply never declares a writable point/command) is stored and reported as — equivalent to, but
    /// distinguishable in code from, a bare <see langword="null"/> reference for callers that want to always
    /// have a non-null instance in hand.</summary>
    public static readonly ConnectorWriteCapability None = new(
        Array.Empty<ConnectorWritablePointGrant>(), Array.Empty<ConnectorCommandGrant>());

    /// <summary><see langword="true"/> if and only if this map declares at least one writable point or
    /// command — the ONE structural (never semantic — no name is ever inspected) check the save gate and the
    /// persisted-column decision both hinge on.</summary>
    public bool GrantsCapability => WritablePoints.Count > 0 || Commands.Count > 0;

    /// <summary>
    /// Task B-3 — the value a caller must echo back to <c>POST /v1/connectors</c> to confirm a write/command
    /// grant, mirroring <c>POST /v1/site/identity/rotate</c>'s own echo-back pattern
    /// (<see cref="St4i.EngineApi.Endpoints.SiteEndpoints.RotateIdentityAsync"/>): deterministic (the SAME
    /// capability always produces the SAME fingerprint, order-independent — every grant is formatted to a
    /// string and the two lists sorted ordinally before hashing, so JSON array order in the pasted map never
    /// changes the required confirmation value), and a SHA-256 hex digest (uppercase, via
    /// <see cref="Convert.ToHexString(byte[])"/>) of "what would be granted" rather than the granted names
    /// themselves — the same "opaque token that can only be obtained by having just seen the real thing"
    /// shape a fingerprint already is elsewhere in this codebase (<c>DeviceIdentity.Fingerprint</c>,
    /// <c>SiteEndpoints.PemFingerprint</c>).
    ///
    /// <para><b>Fix round 1 (Important #1) — binds to <see cref="ConnectorWritablePointGrant.Target"/>/
    /// <see cref="ConnectorWritablePointGrant.Min"/>/<see cref="ConnectorWritablePointGrant.Max"/> and
    /// <see cref="ConnectorCommandGrant.Target"/>, not just names.</b> The original version hashed ONLY
    /// <see cref="ConnectorWritablePointGrant.Name"/>/<see cref="ConnectorCommandGrant.Name"/> — proven by the
    /// review to produce the IDENTICAL fingerprint for <c>speed [0,500] + StartCycle@coil:5</c> and
    /// <c>speed [0,65535] + StartCycle@coil:99</c>: an operator's confirmation survived a widened limit and a
    /// re-pointed command untouched. Every field of both grant types is now part of the hashed material.</para>
    /// </summary>
    public string ComputeFingerprint()
    {
        var pointMaterial = new List<string>(WritablePoints.Count);
        foreach (var point in WritablePoints)
        {
            pointMaterial.Add($"{point.Name}@{point.Target}[{FormatBound(point.Min)},{FormatBound(point.Max)}]");
        }
        pointMaterial.Sort(StringComparer.Ordinal);

        var commandMaterial = new List<string>(Commands.Count);
        foreach (var command in Commands)
        {
            commandMaterial.Add($"{command.Name}@{command.Target}");
        }
        commandMaterial.Sort(StringComparer.Ordinal);

        var material = "points:" + string.Join(",", pointMaterial) + "|commands:" + string.Join(",", commandMaterial);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(material)));
    }

    private static string FormatBound(double? bound) => bound?.ToString("R", CultureInfo.InvariantCulture) ?? "null";

    /// <summary>The exact JSON this type is persisted as in <c>write_capability_json</c> — deliberately a
    /// plain <see cref="JsonSerializer.Serialize{TValue}(TValue, System.Text.Json.JsonSerializerOptions)"/> of
    /// this record (point/command names and wire targets are never credentials, so no redaction concern
    /// applies here the way it does for <see cref="ConnectorConfigRecord.MapJson"/>).</summary>
    public string ToJson() => JsonSerializer.Serialize(this);

    public static ConnectorWriteCapability FromJson(string json) =>
        JsonSerializer.Deserialize<ConnectorWriteCapability>(json)
        ?? throw new InvalidOperationException("ConnectorWriteCapability.FromJson: JSON deserialized to null.");
}

/// <summary>
/// SM-5 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-5-brief.md) — the WRITE
/// path <c>connectors.json</c> never had: a persisted, operator-addable connector configuration for the two
/// protocols this build can actually drive (Modbus TCP, OPC-UA), surviving a restart, applied without
/// hand-editing a file.
///
/// <para><b>Why SQLite, not a JSON file (the brief's own required decision):</b> <c>connectors.json</c> is
/// explicitly documented (<see cref="St4i.EngineApi.Config.ConnectorsConfig"/>) as the HAND-EDITED,
/// read-at-startup-only config source — its whole design point is "a loose file next to the exe an operator
/// can hand-edit," which is precisely the deployment-script experience this task exists to replace. A
/// second hand-editable JSON file would just be a second connectors.json with extra steps. This class
/// instead reuses the SAME never-throws-on-the-hot-path, <c>PRAGMA user_version</c>-migration-ladder SQLite
/// shape every other DURABLE, API-WRITABLE store in this codebase already uses —
/// <see cref="St4i.EngineApi.AssetRegistry.AssetRegistryStore"/> (own file, own migration ladder, short-lived
/// WAL-mode connections) is the closest analogue and this class mirrors its shape line-for-line rather than
/// inventing a third persistence pattern (the brief's own instruction: "pick one of these and say why").
/// <see cref="St4i.EngineApi.Alarms.AlarmStore"/>/<see cref="St4i.EdgeCore.Site.SiteLinkStore"/>/
/// <see cref="St4i.EdgeCore.Site.BridgeSpool"/> are the other three precedents named in the brief; a plain
/// JSON file (like <see cref="St4i.EdgeCore.Infrastructure.FleetSettingsStore"/> for a handful of scalar
/// settings) would have been a defensible alternative for something this small, but SQLite was chosen
/// specifically so a FUTURE task that needs to support more than one connector per kind or richer querying
/// never has to migrate storage formats — the migration ladder already exists from day one. <b>Task D-1 is
/// that future task, and this bet paid off exactly as described:</b> supporting N connectors per kind cost
/// one migration rung (v4) on a ladder that already existed, and this cross-reference — which used to point
/// at "this class's own 'one row per kind' note below" — now points at the paragraph that RETIRED that
/// note.</para>
///
/// <para><b>The primary key WAS the connector KIND — Task D-1 replaced it with a per-INSTANCE id.</b> The
/// original rule is recorded here verbatim, because its reasoning was correct for the system it described:
/// <i>"<see cref="ConnectorRegistry.Register"/> keys purely on <c>IConnectorFactory.Kind</c>, so this build
/// can only ever run ONE live Modbus connector and ONE live OPC-UA connector at a time no matter how many
/// rows a store held — a second registration for the same kind silently replaces the first. Persisting more
/// than one row per kind would let an operator believe two Modbus machines are configured when only the
/// most-recently-applied one could ever actually run — a dishonesty this whole batch exists to remove."</i>
/// Đợt D (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-1-brief.md) removed that PREMISE: the
/// registry is now keyed by connector instance, so two Modbus connectors genuinely do run side by side and a
/// second row for one kind is now HONEST rather than a lie the schema had to prevent. <c>instance_id</c> is
/// therefore the PRIMARY KEY (migration v4) and <c>kind</c> is an ordinary, non-unique column.</para>
///
/// <para><b>What an existing row's instance id becomes, and why it is DERIVED rather than generated</b> (the
/// <c>PRAGMA user_version</c> ladder's own required question): <c>instance_id = kind</c>. Migration v4
/// rebuilds the table — SQLite cannot ALTER a PRIMARY KEY — and copies each surviving row's own <c>kind</c>
/// into its new <c>instance_id</c>. Derived, deterministic, stable: an operator who upgrades still sees the
/// connector they already had, still named <c>Modbus</c>/<c>OpcUa</c> in <c>GET /v1/connectors/configured</c>,
/// still removable at the same <c>DELETE /v1/connectors/&#123;instanceId&#125;</c> URL they were already using,
/// still driving the same pipeline slot label (<c>"modbus"</c>/<c>"opcua"</c> — <see cref="FleetHost"/>'s
/// legacy-label carve-out keys on exactly this id) and therefore still raising alarms under the same
/// <c>TargetId</c>. A GENERATED id (a GUID, a rowid) would have broken every one of those and renamed the
/// operator's connector for nothing. It is also EXACTLY the default <see cref="ConnectorRegistry.Register"/>
/// applies when no instance id is supplied, so the on-disk and in-memory halves of this one decision cannot
/// drift apart.</para>
///
/// <para><b>Never-throws is NOT this class's contract</b> (unlike <see cref="AssetRegistryStore.UpsertAsync"/>,
/// which sits on FleetHost's hot registration path and must never fail a live registration over a database
/// hiccup). Every method here is reached ONLY from an explicit, caller-invoked HTTP mutation
/// (<c>POST</c>/<c>DELETE /v1/connectors</c>) or from startup config-loading (wrapped in its own try/catch at
/// the Program.cs call site, the same "never crash startup over a bad config source" posture every other
/// startup config load in this file already has) — a genuine SQLite failure here is allowed to surface as an
/// ordinary exception (→ the framework's default 500 for the HTTP paths), same as
/// <see cref="AssetRegistryStore.SetLifecycleAsync"/>/<see cref="St4i.EngineApi.Alarms.AlarmStore"/>'s own
/// explicit-mutation members already do.</para>
///
/// <para><b>Credentials never leave this class un-redacted.</b> <see cref="MapJson"/> — the opaque
/// register-map/node-map JSON text forwarded verbatim to <see cref="St4i.Connector.Abstractions.IConnectorFactory.TryCreate"/>
/// — MAY embed an OPC-UA username/password (<see cref="St4i.EdgeCore.Drivers.OpcUa.OpcUaNodeMap.Username"/>/
/// <see cref="St4i.EdgeCore.Drivers.OpcUa.OpcUaNodeMap.Password"/> are part of that same JSON shape). Every
/// PUBLIC read (<see cref="ListAsync"/>) uses a projection that never selects <c>map_json</c> at all — the
/// exact same discipline <c>GET /v1/connectors</c> already established (that endpoint's own doc comment:
/// "a factory's error message is operator-visible and settings may contain credentials"). Only
/// <see cref="LoadAllAsync"/> — the STARTUP wiring path, never exposed over HTTP — reads the full row
/// including <see cref="ConnectorConfigRecord.MapJson"/>.</para>
/// </summary>
/// <summary>
/// Task B-6 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-6-brief.md) — closes the
/// carried B-4 finding (fix round 1, Important #3): before this, an env-var/<c>connectors.json</c>-seeded
/// row (<see cref="ConnectorConfigVisibilitySeeder"/>) and an operator's own row (<c>POST /v1/connectors</c>)
/// were STORED IDENTICALLY — nothing distinguished them — which produced three real, reachable defects:
/// <c>POST</c> 409ing against a machine code the operator never actually persisted (the mismatch-conflict
/// guard couldn't tell "an operator's own prior row" from "the seeder's own artifact for the SAME kind, under
/// a DIFFERENT machine"), <c>DELETE</c> succeeding on a row nobody created (harmless, but with no way to say
/// so), and the seeder's OWN "an existing row may not reflect what's actually running" warning firing on
/// EVERY subsequent boot about its own prior artifact (a seeded row for a kind the same env var/
/// <c>connectors.json</c> entry still actively drives will always be found "already existing" by the next
/// boot's seeding pass).
///
/// <para><b><see cref="Operator"/> is the default</b> (<see cref="ConnectorConfigStore.SaveAsync"/>'s own
/// parameter default, and migration v3's column default for every row written before this column existed) —
/// the conservative choice: every row a real operator explicitly persisted via <c>POST /v1/connectors</c>
/// keeps its full "protect this from being silently overwritten" treatment, and a pre-migration row that
/// actually WAS seeded by an earlier build's <see cref="ConnectorConfigVisibilitySeeder"/> (B-4 shipped before
/// this column existed) is treated as if an operator owned it.</para>
///
/// <para><b>Fix round 1 (review) — the cost of that conservatism, stated correctly.</b> The original wording
/// here claimed the seeder "will warn once" for such a row — WRONG: nothing ever re-tags an existing row's
/// <see cref="Source"/>, so a row misclassified <see cref="Operator"/> at the migration boundary stays that
/// way, and <see cref="ConnectorConfigVisibilitySeeder.SeedAsync"/> sees <c>Source == Operator</c> and warns
/// EVERY subsequent boot, indefinitely — not once. Only a manual <c>DELETE /v1/connectors/{instanceId}</c> + restart
/// corrects it (the next seeding pass inserts it fresh, correctly tagged <see cref="Seeded"/>, and the warnings
/// stop from then on). This remains the right default — a false-positive warning that never stops until an
/// operator acts is a far safer failure mode than silently overwriting data this store cannot prove it didn't
/// create — but the cost must be described accurately, not minimized. Same "assert the failure, don't assume
/// it can't happen" bias this whole codebase already applies elsewhere (e.g.
/// <c>ModbusRegister.TryComputeRawWordForWrite</c> re-checking bounds on every call even though B-3 already
/// proved parse-time enforcement sufficient).</para>
/// </summary>
public enum ConnectorConfigSource
{
    /// <summary>Persisted by an explicit operator action — <c>POST /v1/connectors</c>. The ONLY source this
    /// column could ever record before this task (every migrated pre-existing row defaults to this).</summary>
    Operator,

    /// <summary>Persisted by <see cref="ConnectorConfigVisibilitySeeder.SeedAsync"/> — a VISIBILITY-only row
    /// for a connector this run's <c>ST4I_MODBUS_MAP</c>/<c>ST4I_OPCUA_MAP</c>/<c>connectors.json</c> is
    /// actively driving, never something an operator explicitly asked this product to persist.</summary>
    Seeded,
}

/// <param name="InstanceId">Task D-1 — this connector INSTANCE's id: the table's primary key, and the id
/// <see cref="ConnectorRegistry.Register"/> is keyed on. Declared LAST, with a <see langword="null"/>
/// default meaning "derive it from <paramref name="Kind"/>", purely so the ~40 pre-existing positional
/// construction/assertion sites (production and test alike) keep compiling and behaving identically — the
/// alternative, putting the primary key first where it conceptually belongs, would have rewritten every one
/// of them for a cosmetic gain. <see cref="ConnectorConfigStore"/> itself always populates it explicitly
/// from the column, so a record that came out of the store never carries the derived default.</param>
/// <param name="BusInstanceId">🔴 Task D-7b — the Modbus RTU BUS this row is one device on, or
/// <see langword="null"/> for every connector that is not on a shared line (every row this store held before
/// D-7b, and every Modbus TCP / OPC-UA connector after it). Non-null makes this row a DEVICE row: its
/// <see cref="InstanceId"/> is <c>{bus}:unit{n}</c>, minted by
/// <see cref="St4i.EdgeCore.Drivers.Modbus.ModbusMultidropMap.DeviceInstanceId"/>, and it is not
/// independently registerable — see <see cref="BusSettingsJson"/>.</param>
/// <param name="BusSettingsJson">🔴 Task D-7b — the BUS-LEVEL half of the RTU document (the transport token
/// plus the line parameters: <c>portName</c>/<c>baudRate</c>/<c>parity</c>/… for a serial line, <c>host</c>/
/// <c>port</c> for a gateway). <see langword="null"/> for every non-RTU row.
///
/// <para><b>Why it is stored per DEVICE and not once per bus, which is the obvious alternative.</b> A bus row
/// would need a <c>machine_code</c>, and a bus serves N machines — so that column would have to hold either a
/// lie or a synthesised value, in the one table whose whole job is "which connector serves which machine".
/// Denormalising the LINE onto each device on it costs one duplicated (small, immutable-per-operation)
/// document and buys three things: every row is self-sufficient, so deleting one device is a one-row delete
/// with nothing left dangling; the table keeps exactly one row KIND; and <c>host</c> — which already carries
/// the line identity for exactly this reason (D-7a's projection decision) — is denormalised the same way, so
/// this is the existing shape rather than a new one.</para>
///
/// <para><b>It is never in <see cref="ConnectorConfigSummary"/>.</b> Structurally, by never being in
/// <see cref="ConnectorConfigStore"/>'s <c>SummaryColumns</c> — the same discipline <c>map_json</c> is held
/// to. Today's two transports carry no credential, and that is precisely why the exclusion has to be
/// structural now: a third transport that carries one (a gateway behind an authenticated tunnel, say) would
/// otherwise leak on the day it is added, with nothing in this file to stop it.</para></param>
public sealed record ConnectorConfigRecord(
    string Kind,
    string MachineCode,
    string? Host,
    int? Port,
    string MapJson,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc,
    ConnectorWriteCapability? WriteCapability = null,
    ConnectorConfigSource Source = ConnectorConfigSource.Operator,
    string? InstanceId = null,
    string? BusInstanceId = null,
    string? BusSettingsJson = null)
{
    /// <summary>Task D-1 — the instance id this row is keyed by, never <see langword="null"/>: falls back to
    /// <see cref="Kind"/>, the exact same default <see cref="ConnectorRegistry.Register"/> and migration v4
    /// both apply. Callers should use this, not <see cref="InstanceId"/>, unless they specifically need to
    /// know whether one was supplied.</summary>
    public string EffectiveInstanceId => string.IsNullOrWhiteSpace(InstanceId) ? Kind : InstanceId;
}

/// <summary>🔴 Task D-7b — ONE device's row as <see cref="ConnectorConfigStore.SaveBusAsync"/> takes it.
/// Deliberately not <see cref="ConnectorConfigRecord"/>: a caller writing a bus supplies no timestamps and no
/// provenance (the store stamps the first, the call stamps the second for the whole set at once), and letting
/// it hand in a <c>CreatedAtUtc</c> it invented is exactly the drift this shape removes.</summary>
/// <param name="Host">🔴 The LINE, not a device address — D-7a's projection decision, and the half D-7c
/// handed to D-7b with no code path. A serial bus puts its <c>portName</c> here (and <c>null</c> in
/// <paramref name="Port"/>, because a COM port has no port number and a 0 would read as one); a gateway bus
/// puts the gateway's host and TCP port. That is what makes "which physical line is this device on?" answerable
/// from the credential-free projection — see <see cref="ConnectorConfigRecord.BusSettingsJson"/> for why the
/// rest of the line's parameters are NOT.</param>
public sealed record ConnectorBusDeviceRow(
    string InstanceId,
    string Kind,
    string MachineCode,
    string? Host,
    int? Port,
    string MapJson,
    string BusSettingsJson,
    ConnectorWriteCapability? WriteCapability);

/// <summary>The credential-free projection every caller OUTSIDE startup wiring gets — see
/// <see cref="ConnectorConfigStore"/>'s own doc comment for why <c>MapJson</c> (which may embed OPC-UA
/// credentials) is never part of this shape at all, not merely omitted at the DTO layer.
///
/// <para><see cref="WriteCapability"/> is safe to include here, unlike <c>MapJson</c> — a point/command
/// NAME is never a credential — see <see cref="ConnectorWriteCapability"/>'s own doc comment for why this is
/// its own column rather than staying locked inside the opaque map blob.</para></summary>
/// <param name="WriteCapability"><see cref="ConnectorWriteCapabilityDto"/> — deliberately the SAME shape
/// <c>POST /v1/connectors</c>'s own response uses (see that DTO's own doc comment), rather than the raw
/// <see cref="ConnectorWriteCapability"/> persistence record, so a caller reads one consistent capability
/// shape regardless of which endpoint it came from. <see langword="null"/> for a read-only connector — every
/// connector this build accepted before this task, and any map that simply declares neither.</param>
/// <param name="Source">Task B-6 — see <see cref="ConnectorConfigSource"/>'s own doc comment. Surfaced here
/// (not a credential — an origin tag) so an operator/auditor reading <c>GET /v1/connectors/configured</c> can
/// tell an env-var/<c>connectors.json</c>-driven visibility row apart from one they explicitly persisted
/// themselves, rather than the two being visually identical.</param>
/// <param name="InstanceId">Task D-1 — the connector instance this row describes. Additive and declared LAST
/// for the same "do not rewrite every pre-existing call site" reason as
/// <see cref="ConnectorConfigRecord.InstanceId"/>; never a credential (it is an operator-chosen label), and
/// the field a client needs to address one of two same-kind connectors at
/// <c>DELETE /v1/connectors/&#123;instanceId&#125;</c>. Equals <see cref="Kind"/> for every row that predates
/// D-1 and for every connector saved without naming an id of its own.</param>
/// <param name="BusInstanceId">🔴 Task D-7b — see <see cref="ConnectorConfigRecord.BusInstanceId"/>. This is
/// the ONE of the two D-7b columns that IS in the credential-free projection, and the reason is the whole
/// point of the task: without it a web client receiving eight rows named <c>line1:unit1</c> …
/// <c>line1:unit8</c> would have to parse an id to learn they are one physical line, and an id is a label,
/// not a schema. <see cref="ConnectorConfigRecord.BusSettingsJson"/> is NOT here — see its own remarks.
/// <see langword="null"/> for every connector that is not on a shared RS-485 line.</param>
public sealed record ConnectorConfigSummary(
    string Kind,
    string MachineCode,
    string? Host,
    int? Port,
    DateTimeOffset UpdatedAtUtc,
    ConnectorWriteCapabilityDto? WriteCapability = null,
    ConnectorConfigSource Source = ConnectorConfigSource.Operator,
    string? InstanceId = null,
    string? BusInstanceId = null)
{
    /// <summary>Task D-1 — see <see cref="ConnectorConfigRecord.EffectiveInstanceId"/>.</summary>
    public string EffectiveInstanceId => string.IsNullOrWhiteSpace(InstanceId) ? Kind : InstanceId;
}

public sealed class ConnectorConfigStore
{
    /// <summary>Directory override — same idiom as <c>ST4I_ASSETS_DIR</c>/<c>ST4I_ALARMS_DIR</c>.</summary>
    public const string EnvVarDir = "ST4I_CONNECTOR_CONFIG_DIR";

    public string DbPath { get; }

    private static readonly string[] OpenPragmas =
    {
        "PRAGMA journal_mode=WAL;",
        "PRAGMA synchronous=NORMAL;",
        "PRAGMA busy_timeout=5000;",
        "PRAGMA foreign_keys=ON;",
    };

    private static readonly (int Version, string[] Statements)[] Migrations =
    {
        (1, new[]
        {
            """
            CREATE TABLE IF NOT EXISTS connector_configs (
              kind TEXT PRIMARY KEY,
              machine_code TEXT NOT NULL,
              host TEXT NULL,
              port INTEGER NULL,
              map_json TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL);
            """,
        }),
        // Task B-3 — see ConnectorWriteCapability's own doc comment for why this is its own column (never
        // folded into the opaque map_json blob) and what a pre-existing (pre-migration) row's NULL means:
        // SQLite's ADD COLUMN with no DEFAULT sets every existing row's new column to NULL, which is the
        // CORRECT value for a row written before this task — no schema before it could ever declare a
        // writable point or command, so every such row is, in fact, read-only.
        (2, new[]
        {
            "ALTER TABLE connector_configs ADD COLUMN write_capability_json TEXT NULL;",
        }),
        // Task B-6 — see ConnectorConfigSource's own doc comment for why "Operator" is the correct default
        // for every row that predates this column (SQLite's ADD COLUMN with a literal DEFAULT applies it to
        // every existing row at migration time, same mechanism v2 already relies on for write_capability_json).
        (3, new[]
        {
            "ALTER TABLE connector_configs ADD COLUMN source TEXT NOT NULL DEFAULT 'Operator';",
        }),
        // Task D-1 (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-1-brief.md) — connector
        // identity moves from "the protocol kind" to "this instance". See this class's own doc comment for
        // WHY instance_id = kind is the right value for every pre-existing row (derived, stable, keeps the
        // operator's connector name, its DELETE URL, its pipeline slot label and its alarm TargetId).
        //
        // This is a TABLE REBUILD, not an ALTER: SQLite's ALTER TABLE cannot change a PRIMARY KEY, and the
        // whole point of this task is that `kind` stops being one. The twelve-step rebuild recipe from
        // sqlite.org is followed in the shortened form that is valid here — create, copy, drop, rename —
        // because this database contains exactly ONE table, no foreign keys pointing at it, no triggers, no
        // views and no indexes, so the steps that exist to preserve those have nothing to preserve. It runs
        // inside the same transaction as every other rung of this ladder (see EnsureSchema), so a failure
        // anywhere leaves the ORIGINAL table intact and user_version at 3 — this migration either completes
        // or never happened; there is no state where the old table is gone and the new one is not there.
        //
        // 🔴 The SELECT list is spelled out COLUMN BY COLUMN rather than `SELECT *`: an installed system's
        // real connector rows are the thing this rung must not lose, and `INSERT INTO ... SELECT *` binds by
        // POSITION, so it would silently write the wrong column into the wrong field the moment the two
        // tables' declaration orders differ (they do — write_capability_json/source were appended by v2/v3,
        // while the new table groups them logically). Naming both sides is what makes the copy checkable by
        // reading it.
        //
        // NOT declared UNIQUE on machine_code, deliberately, even though "one instance per machine code" is
        // exactly the invariant D-1 enforces in ConnectorRegistry.Register: a system that upgrades from
        // BEFORE Đợt B's cross-kind collision guard existed can legitimately hold a Modbus row and an OPC-UA
        // row carrying the SAME machine_code (ConnectorEndpointsTests' own SeedLoopCollision test constructs
        // exactly that shape on purpose). A UNIQUE constraint would abort this rung on such a database — i.e.
        // fail the upgrade, on the one install where the data is most unusual. The invariant is enforced
        // where it actually matters (at registration, on the live path) and the schema stays permissive
        // enough to carry every row forward.
        (4, new[]
        {
            """
            CREATE TABLE connector_configs_v4 (
              instance_id TEXT PRIMARY KEY,
              kind TEXT NOT NULL,
              machine_code TEXT NOT NULL,
              host TEXT NULL,
              port INTEGER NULL,
              map_json TEXT NOT NULL,
              write_capability_json TEXT NULL,
              source TEXT NOT NULL DEFAULT 'Operator',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL);
            """,
            """
            INSERT INTO connector_configs_v4
              (instance_id, kind, machine_code, host, port, map_json, write_capability_json, source, created_at, updated_at)
            SELECT kind, kind, machine_code, host, port, map_json, write_capability_json, source, created_at, updated_at
            FROM connector_configs;
            """,
            "DROP TABLE connector_configs;",
            "ALTER TABLE connector_configs_v4 RENAME TO connector_configs;",
        }),
        // 🔴 Task D-7b (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-7b-brief.md) — the two
        // columns an RS-485 DEVICE row needs and no other row has. See ConnectorConfigRecord.BusInstanceId/
        // BusSettingsJson for why the line is denormalised onto each device rather than held in a bus row.
        //
        // What a pre-existing row means (this ladder's own required question): NULL in both, which is not a
        // placeholder but the CORRECT value — no schema before D-7b could express a shared line at all, so
        // every row written before this rung is, in fact, a connector that is on no bus. SQLite's ADD COLUMN
        // with no DEFAULT sets exactly that for every existing row, the same mechanism v2 already relies on.
        //
        // Two plain ADD COLUMNs rather than v4's table rebuild: neither column is (or is part of) a key, so
        // there is nothing ALTER TABLE cannot do here.
        (5, new[]
        {
            "ALTER TABLE connector_configs ADD COLUMN bus_instance_id TEXT NULL;",
            "ALTER TABLE connector_configs ADD COLUMN bus_settings_json TEXT NULL;",
        }),
    };

    public ConnectorConfigStore(string? directory = null)
    {
        var root = ResolveRoot(directory);
        Directory.CreateDirectory(root);
        DbPath = Path.Combine(root, "connector-config.db");
        EnsureSchema();
    }

    /// <summary>The default root: <c>%ProgramData%\ST4I\sim\connector-config</c> — a SIBLING of
    /// <c>...\sim\assets</c>/<c>...\sim\alarms</c>/<c>...\sim\wal</c>, never the same directory.</summary>
    public static string DefaultRoot() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ST4I", "sim", "connector-config");

    public static string ResolveRoot(string? directory = null)
    {
        if (!string.IsNullOrWhiteSpace(directory)) return directory;
        var env = Environment.GetEnvironmentVariable(EnvVarDir);
        return string.IsNullOrWhiteSpace(env) ? DefaultRoot() : env;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Schema
    // ─────────────────────────────────────────────────────────────────────

    private void EnsureSchema()
    {
        using var connection = OpenConnection();
        var currentVersion = GetUserVersion(connection);

        foreach (var (version, statements) in Migrations)
        {
            if (version <= currentVersion) continue;

            using var transaction = connection.BeginTransaction();
            foreach (var statement in statements)
            {
                using var cmd = connection.CreateCommand();
                cmd.Transaction = transaction;
                cmd.CommandText = statement;
                cmd.ExecuteNonQuery();
            }

            using (var pragmaCmd = connection.CreateCommand())
            {
                pragmaCmd.Transaction = transaction;
                // PRAGMA user_version does not support bind parameters; `version` always comes from this
                // fixed, code-defined migration ladder above (never external/user input).
                pragmaCmd.CommandText = $"PRAGMA user_version = {version};";
                pragmaCmd.ExecuteNonQuery();
            }

            transaction.Commit();
            currentVersion = version;
        }
    }

    private static long GetUserVersion(SqliteConnection connection)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = "PRAGMA user_version;";
        var result = cmd.ExecuteScalar();
        return result is null ? 0 : Convert.ToInt64(result, CultureInfo.InvariantCulture);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Connections
    // ─────────────────────────────────────────────────────────────────────

    private SqliteConnection OpenConnection()
    {
        var connection = new SqliteConnection($"Data Source={DbPath}");
        connection.Open();
        ApplyPragmas(connection);
        return connection;
    }

    private async Task<SqliteConnection> OpenConnectionAsync(CancellationToken ct)
    {
        var connection = new SqliteConnection($"Data Source={DbPath}");
        await connection.OpenAsync(ct).ConfigureAwait(false);
        await ApplyPragmasAsync(connection, ct).ConfigureAwait(false);
        return connection;
    }

    private static void ApplyPragmas(SqliteConnection connection)
    {
        foreach (var pragma in OpenPragmas)
        {
            using var cmd = connection.CreateCommand();
            cmd.CommandText = pragma;
            cmd.ExecuteNonQuery();
        }
    }

    private static async Task ApplyPragmasAsync(SqliteConnection connection, CancellationToken ct)
    {
        foreach (var pragma in OpenPragmas)
        {
            using var cmd = connection.CreateCommand();
            cmd.CommandText = pragma;
            await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Write — upsert by connector INSTANCE (last write wins, mirroring ConnectorRegistry.Register's own
    // semantics, which Task D-1 moved from per-kind to per-instance on both sides at once).
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Inserts or replaces the ONE persisted row for this connector INSTANCE (see
    /// <paramref name="instanceId"/>; <paramref name="kind"/> is already normalized by the caller — see
    /// <see cref="St4i.Connector.Abstractions.Models.DriverKinds.Normalize"/>). Returns the credential-free
    /// summary of what was just saved.</summary>
    /// <param name="writeCapability">Task B-3 — what the map being saved declares (already computed by the
    /// caller, which already parsed the map — see <see cref="ConnectorWriteCapability"/>'s own doc comment for
    /// why this store never derives it itself). <see langword="null"/> (the default) is stored and reported
    /// identically to <see cref="ConnectorWriteCapability.None"/> — every call site that predates this task
    /// (and every test of this method that never passes it) keeps saving a plain read-only connector, byte
    /// for byte.
    ///
    /// <para><b>Fix round 1, I3 — acknowledged design tension, deliberately NOT resolved by removing this
    /// default.</b> The review correctly flags that a FUTURE second call site could pass a genuinely
    /// write-capable map while omitting this parameter, silently persisting it as read-only. Making it a
    /// required (non-optional, non-nullable) parameter would close that risk — but every PRE-EXISTING test of
    /// this method (predating Task B-3, and this task's own additions to those same files) calls it with
    /// exactly the five original positional arguments, and the brief's own "extend, never weaken" instruction
    /// forbids editing those call sites' source. Today there is exactly ONE production call site
    /// (<see cref="Endpoints.ConnectorEndpoints.CreateConnectorAsync"/>), and it always passes this argument
    /// explicitly and correctly — the risk is real but currently contained, not exercised. Left as a
    /// documented tension rather than a code change; a future task adding a second call site should treat this
    /// paragraph as the reminder to get it right, since the type system will not catch an omission here.</para>
    /// </param>
    /// <param name="source">Task B-6 — see <see cref="ConnectorConfigSource"/>'s own doc comment. Defaults to
    /// <see cref="ConnectorConfigSource.Operator"/> — every pre-existing call site/test (predating this task)
    /// that never mentions it keeps persisting an operator row, byte for byte. The one production call site
    /// that must pass <see cref="ConnectorConfigSource.Seeded"/> explicitly is
    /// <see cref="ConnectorConfigVisibilitySeeder.SeedAsync"/>.</param>
    /// <param name="ct">Task B-8 — moved to be the LAST parameter (was previously between
    /// <paramref name="writeCapability"/> and <paramref name="source"/>, a carried finding from B-6's
    /// review: every other method in this codebase that takes a <see cref="CancellationToken"/> takes it
    /// last). Safe to reorder: every test call site names <paramref name="source"/> explicitly when it
    /// passes it (never positionally past <paramref name="writeCapability"/>), and the two production call
    /// sites (<see cref="Endpoints.ConnectorEndpoints.CreateConnectorAsync"/>,
    /// <see cref="ConnectorConfigVisibilitySeeder.SeedAsync"/>) are updated alongside this signature to
    /// pass it by name.</param>
    /// <param name="instanceId">Task D-1 — the connector INSTANCE this row is keyed by.
    /// <see langword="null"/>/blank (the default) means "use <paramref name="kind"/>", the same derivation
    /// migration v4 applies to every pre-D-1 row and the same default
    /// <see cref="ConnectorRegistry.Register"/> applies to an unnamed instance — so every pre-existing call
    /// site (production and test) keeps writing exactly the row it always did, one per kind. Declared LAST,
    /// after <paramref name="ct"/>, which breaks this codebase's "the token goes last" convention
    /// deliberately: every existing caller passes <paramref name="source"/>/<paramref name="ct"/> BY NAME
    /// and <paramref name="writeCapability"/> positionally, so any earlier slot would have silently changed
    /// what an existing positional argument binds to. A convention broken visibly in one signature is
    /// cheaper than a mis-bound argument nobody notices.</param>
    /// <param name="busInstanceId">🔴 Task D-7b — see <see cref="ConnectorConfigRecord.BusInstanceId"/>.
    /// <see langword="null"/> (the default) for every connector that is not one device on a shared RS-485
    /// line, which is every call site that predates D-7b.</param>
    /// <param name="busSettingsJson">🔴 Task D-7b — see <see cref="ConnectorConfigRecord.BusSettingsJson"/>.</param>
    public async Task<ConnectorConfigSummary> SaveAsync(
        string kind, string machineCode, string? host, int? port, string mapJson,
        ConnectorWriteCapability? writeCapability = null,
        ConnectorConfigSource source = ConnectorConfigSource.Operator, CancellationToken ct = default,
        string? instanceId = null, string? busInstanceId = null, string? busSettingsJson = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(kind);
        ArgumentException.ThrowIfNullOrWhiteSpace(machineCode);
        ArgumentNullException.ThrowIfNull(mapJson);

        // 🔴 D-1 review, m1 — DriverKinds.Normalize, not a bare Trim(). ConnectorRegistry.Register and
        // DELETE /v1/connectors/{instanceId} both fold an id through Normalize; a store that only trimmed
        // would happily persist instance_id = "modbus" while the registry keyed the same connector as
        // "Modbus" — and the row would then be UNDELETABLE, because the DELETE route normalizes its segment
        // to "Modbus" and GetAsync would miss, answering 404 for a row an operator can see in
        // GET /v1/connectors/configured. No production path reaches that divergence today (the one endpoint
        // that accepts an operator-supplied id normalizes it first), which is exactly why it would have sat
        // here unnoticed until some future caller did not. The claim in this class's own migration note —
        // that the on-disk and in-memory halves of the identity decision "cannot drift" — was true of the
        // DEFAULT and not of the NORMALIZATION until this line.
        var effectiveInstanceId = string.IsNullOrWhiteSpace(instanceId)
            ? kind
            : St4i.Connector.Abstractions.Models.DriverKinds.Normalize(instanceId.Trim());
        var nowIso = ToIso(DateTimeOffset.UtcNow);
        var normalizedCapability = (writeCapability is not null && writeCapability.GrantsCapability) ? writeCapability : null;
        var writeCapabilityJson = normalizedCapability?.ToJson();
        var sourceText = source.ToString();

        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = UpsertSql;
        BindUpsert(
            cmd, effectiveInstanceId, kind, machineCode, host, port, mapJson, writeCapabilityJson, sourceText,
            nowIso, createdAtIso: nowIso, busInstanceId, busSettingsJson);

        await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);

        return new ConnectorConfigSummary(
            kind, machineCode, host, port, ParseIso(nowIso),
            normalizedCapability is null ? null : ConnectorWriteCapabilityDto.From(normalizedCapability),
            source, effectiveInstanceId, NullIfBlank(busInstanceId));
    }

    // Task D-1 — the conflict target is instance_id (the primary key), NOT kind: two rows of one kind under
    // two different instance ids must both survive, which is the entire point of that task. `kind` is in the
    // DO UPDATE SET list for the same reason it is now an ordinary column — an instance keeps its id across a
    // re-save while everything else about it, protocol included, is whatever the caller just supplied.
    //
    // 🔴 Task D-7b — hoisted out of SaveAsync into a shared const because SaveBusAsync and RestoreBusAsync
    // must write rows through the SAME statement. A second copy of an upsert is a second place for a column
    // to be forgotten, and the column most likely to be forgotten is exactly the one D-7b adds.
    //
    // @created_at is a parameter rather than reusing @now: an ordinary save never touches created_at (the
    // upsert simply does not list it), but RestoreBusAsync re-INSERTS rows this request already deleted, so
    // it has to be able to put the original creation timestamp back. Passing @now for it — what SaveAsync
    // does — is byte-identical to the previous behaviour for an insert and irrelevant for an update.
    private const string UpsertSql = """
        INSERT INTO connector_configs (instance_id, kind, machine_code, host, port, map_json, write_capability_json, source, created_at, updated_at, bus_instance_id, bus_settings_json)
        VALUES (@instance_id, @kind, @machine_code, @host, @port, @map_json, @write_capability_json, @source, @created_at, @now, @bus_instance_id, @bus_settings_json)
        ON CONFLICT(instance_id) DO UPDATE SET
            kind = excluded.kind,
            machine_code = excluded.machine_code,
            host = excluded.host,
            port = excluded.port,
            map_json = excluded.map_json,
            write_capability_json = excluded.write_capability_json,
            source = excluded.source,
            updated_at = excluded.updated_at,
            bus_instance_id = excluded.bus_instance_id,
            bus_settings_json = excluded.bus_settings_json;
        """;

    private static void BindUpsert(
        SqliteCommand cmd, string instanceId, string kind, string machineCode, string? host, int? port,
        string mapJson, string? writeCapabilityJson, string sourceText, string nowIso, string createdAtIso,
        string? busInstanceId, string? busSettingsJson)
    {
        cmd.Parameters.AddWithValue("@instance_id", instanceId);
        cmd.Parameters.AddWithValue("@kind", kind);
        cmd.Parameters.AddWithValue("@machine_code", machineCode);
        cmd.Parameters.AddWithValue("@host", (object?)host ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@port", (object?)port ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@map_json", mapJson);
        cmd.Parameters.AddWithValue("@write_capability_json", (object?)writeCapabilityJson ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@source", sourceText);
        cmd.Parameters.AddWithValue("@now", nowIso);
        cmd.Parameters.AddWithValue("@created_at", createdAtIso);
        cmd.Parameters.AddWithValue("@bus_instance_id", (object?)NullIfBlank(busInstanceId) ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@bus_settings_json", (object?)NullIfBlank(busSettingsJson) ?? DBNull.Value);
    }

    private static string? NullIfBlank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value;

    /// <summary>
    /// 🔴 <b>Task D-7b — every device on one RS-485 bus, written in ONE SQLite transaction.</b>
    ///
    /// <para><b>This is the answer to "a rollback that is itself partial is worse than no rollback".</b>
    /// <c>POST /v1/connectors</c> creating a bus of eight makes eight machine claims and eight persisted rows;
    /// the obvious implementation — eight <see cref="SaveAsync"/> calls, and eight compensating deletes if
    /// something later fails — has a failure mode where the compensation itself dies after undoing three of
    /// them, and the operator is then told the operation failed while five rows stand. Making the store write
    /// atomic removes that state rather than reporting it: the transaction either commits every row or none,
    /// and the same is true of <see cref="RestoreBusAsync"/>, so neither direction can be half-done.</para>
    ///
    /// <para><b>Delete-then-insert, not upsert-and-leave.</b> Re-saving a bus whose map lost a device must
    /// LOSE that device's row — an upsert per surviving device would leave the removed one behind as a row
    /// describing a device the operator deleted from their configuration, which is the persisted half of
    /// exactly the ghost <c>ModbusMultidropRegistration.SweepGhosts</c> exists to stop in the registry. Both
    /// statements are inside the one transaction, so there is no window in which the bus has no rows.</para>
    /// </summary>
    /// <param name="busInstanceId">The bus every row in <paramref name="rows"/> belongs to. Every row with
    /// this <c>bus_instance_id</c> that is NOT in <paramref name="rows"/> is deleted by the same
    /// transaction.</param>
    /// <param name="rows">One entry per device, in bus order.</param>
    /// <param name="source">Provenance for every row written — <see cref="ConnectorConfigSource.Operator"/>
    /// for <c>POST /v1/connectors</c>, <see cref="ConnectorConfigSource.Seeded"/> for
    /// <see cref="ConnectorConfigVisibilitySeeder"/>'s <c>connectors.json</c> pass.</param>
    /// <returns>The credential-free summary of each row written, in the order supplied.</returns>
    public async Task<IReadOnlyList<ConnectorConfigSummary>> SaveBusAsync(
        string busInstanceId, IReadOnlyList<ConnectorBusDeviceRow> rows, ConnectorConfigSource source,
        CancellationToken ct = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(busInstanceId);
        ArgumentNullException.ThrowIfNull(rows);

        var nowIso = ToIso(DateTimeOffset.UtcNow);
        var sourceText = source.ToString();
        var summaries = new List<ConnectorConfigSummary>(rows.Count);

        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
        using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(ct).ConfigureAwait(false);

        using (var deleteCmd = connection.CreateCommand())
        {
            deleteCmd.Transaction = transaction;
            deleteCmd.CommandText = "DELETE FROM connector_configs WHERE bus_instance_id = @bus_instance_id;";
            deleteCmd.Parameters.AddWithValue("@bus_instance_id", busInstanceId);
            await deleteCmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }

        foreach (var row in rows)
        {
            var capability = (row.WriteCapability is not null && row.WriteCapability.GrantsCapability) ? row.WriteCapability : null;
            using var cmd = connection.CreateCommand();
            cmd.Transaction = transaction;
            cmd.CommandText = UpsertSql;
            BindUpsert(
                cmd, row.InstanceId, row.Kind, row.MachineCode, row.Host, row.Port, row.MapJson,
                capability?.ToJson(), sourceText, nowIso, createdAtIso: nowIso, busInstanceId, row.BusSettingsJson);
            await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);

            summaries.Add(new ConnectorConfigSummary(
                row.Kind, row.MachineCode, row.Host, row.Port, ParseIso(nowIso),
                capability is null ? null : ConnectorWriteCapabilityDto.From(capability),
                source, row.InstanceId, busInstanceId));
        }

        await transaction.CommitAsync(ct).ConfigureAwait(false);
        return summaries;
    }

    /// <summary>🔴 Task D-7b — every persisted row belonging to one RS-485 bus, FULL rows (including
    /// <see cref="ConnectorConfigRecord.MapJson"/>/<see cref="ConnectorConfigRecord.BusSettingsJson"/>).
    /// Engine-internal only, never routed to an HTTP response — this is what
    /// <c>POST /v1/connectors</c> captures BEFORE it writes, so a failed registration can put the store back
    /// exactly as it was.</summary>
    public async Task<IReadOnlyList<ConnectorConfigRecord>> ListBusAsync(string busInstanceId, CancellationToken ct = default)
    {
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = $"SELECT {FullColumns} FROM connector_configs WHERE bus_instance_id = @bus_instance_id ORDER BY instance_id;";
        cmd.Parameters.AddWithValue("@bus_instance_id", busInstanceId);

        var results = new List<ConnectorConfigRecord>();
        using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        while (await reader.ReadAsync(ct).ConfigureAwait(false))
        {
            results.Add(ReadFullRecord(reader));
        }
        return results;
    }

    /// <summary>
    /// 🔴 Task D-7b — puts one bus's rows back the way <see cref="ListBusAsync"/> found them, in ONE
    /// transaction. An empty <paramref name="previous"/> means "there was no such bus", so this is a pure
    /// delete — the same two arms <see cref="Endpoints.ConnectorEndpoints.CompensateFailedLiveRegistrationAsync"/>
    /// already has for the single-connector case, with the whole set as the unit instead of one row.
    ///
    /// <para><see cref="ConnectorConfigRecord.CreatedAtUtc"/> is restored verbatim — unlike the single-row
    /// compensation, whose one documented residue is that <c>created_at</c> survives only because its upsert
    /// never touches it. Here the rows were DELETED, so the restore has to carry the original value itself or
    /// the bus would silently claim to have been created by the failed request.</para>
    /// </summary>
    public async Task RestoreBusAsync(
        string busInstanceId, IReadOnlyList<ConnectorConfigRecord> previous, CancellationToken ct = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(busInstanceId);
        ArgumentNullException.ThrowIfNull(previous);

        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
        using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(ct).ConfigureAwait(false);

        using (var deleteCmd = connection.CreateCommand())
        {
            deleteCmd.Transaction = transaction;
            deleteCmd.CommandText = "DELETE FROM connector_configs WHERE bus_instance_id = @bus_instance_id;";
            deleteCmd.Parameters.AddWithValue("@bus_instance_id", busInstanceId);
            await deleteCmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }

        foreach (var row in previous)
        {
            using var cmd = connection.CreateCommand();
            cmd.Transaction = transaction;
            cmd.CommandText = UpsertSql;
            BindUpsert(
                cmd, row.EffectiveInstanceId, row.Kind, row.MachineCode, row.Host, row.Port, row.MapJson,
                row.WriteCapability?.ToJson(), row.Source.ToString(), ToIso(row.UpdatedAtUtc),
                ToIso(row.CreatedAtUtc), row.BusInstanceId, row.BusSettingsJson);
            await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }

        await transaction.CommitAsync(ct).ConfigureAwait(false);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Read
    // ─────────────────────────────────────────────────────────────────────

    // 🔴 Task D-7b — `bus_settings_json` is in FullColumns and NOT in SummaryColumns, and that asymmetry is
    // the same one `map_json` has had since SM-5: the credential-free projection does not select it, so there
    // is no redaction step anywhere that could be forgotten. `bus_instance_id` IS in both — an operator-chosen
    // bus label is the same class of thing as `instance_id`, never a credential, and it is what lets a client
    // group eight device rows into one physical line without parsing an id.
    private const string FullColumns = "instance_id, kind, machine_code, host, port, map_json, created_at, updated_at, write_capability_json, source, bus_instance_id, bus_settings_json";
    private const string SummaryColumns = "instance_id, kind, machine_code, host, port, updated_at, write_capability_json, source, bus_instance_id";

    /// <summary>The FULL row (including <see cref="ConnectorConfigRecord.MapJson"/>, which may embed OPC-UA
    /// credentials) for one connector INSTANCE — engine-internal use only (validating an update targets the
    /// same machine, or re-registering a live factory). Never routed to an HTTP response.
    ///
    /// <para>Task D-1 — the parameter is the INSTANCE id, not the kind. For every row that predates D-1 and
    /// every connector saved without naming an id, the two are the same string (see this class's own doc
    /// comment on the derived default), so every pre-existing caller — <c>GetAsync("Modbus")</c> — keeps
    /// finding exactly the row it always found.</para></summary>
    public async Task<ConnectorConfigRecord?> GetAsync(string instanceId, CancellationToken ct = default)
    {
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = $"SELECT {FullColumns} FROM connector_configs WHERE instance_id = @instance_id;";
        cmd.Parameters.AddWithValue("@instance_id", instanceId);

        using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        if (!await reader.ReadAsync(ct).ConfigureAwait(false)) return null;
        return ReadFullRecord(reader);
    }

    /// <summary>Every persisted connector config, FULL rows — the startup-wiring path (Program.cs), never
    /// exposed over HTTP. See <see cref="ListAsync"/> for the credential-free public projection.</summary>
    public async Task<IReadOnlyList<ConnectorConfigRecord>> LoadAllAsync(CancellationToken ct = default)
    {
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = $"SELECT {FullColumns} FROM connector_configs ORDER BY instance_id;";

        var results = new List<ConnectorConfigRecord>();
        using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        while (await reader.ReadAsync(ct).ConfigureAwait(false))
        {
            results.Add(ReadFullRecord(reader));
        }
        return results;
    }

    /// <summary>The <c>GET /v1/connectors/configured</c> projection: every persisted connector config
    /// WITHOUT <c>map_json</c> — the column simply is never in the SELECT list, so there is no redaction
    /// step to forget (see this class's own doc comment).</summary>
    public async Task<IReadOnlyList<ConnectorConfigSummary>> ListAsync(CancellationToken ct = default)
    {
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = $"SELECT {SummaryColumns} FROM connector_configs ORDER BY instance_id;";

        var results = new List<ConnectorConfigSummary>();
        using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        while (await reader.ReadAsync(ct).ConfigureAwait(false))
        {
            results.Add(ReadSummary(reader));
        }
        return results;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Remove — see ConnectorEndpoints.DeleteConnectorAsync's own doc comment for exactly what removal
    // means (a persisted-config-only deletion; the live roster/ConnectorRegistry are untouched until the
    // next process restart — FleetHost.RegisterMachine has no unregister, and this class does not invent
    // one).
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Task D-1 — deletes ONE connector instance's row (the parameter is the instance id, which for
    /// every pre-D-1 row equals its kind — see <see cref="GetAsync"/>'s own remark). Removing one of two
    /// same-kind connectors must never take its sibling with it, which is exactly what keying this on the
    /// primary key rather than on <c>kind</c> guarantees.</summary>
    public async Task<bool> DeleteAsync(string instanceId, CancellationToken ct = default)
    {
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = "DELETE FROM connector_configs WHERE instance_id = @instance_id;";
        cmd.Parameters.AddWithValue("@instance_id", instanceId);

        var rows = await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        return rows > 0;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Row mapping / ISO-8601 helpers
    // ─────────────────────────────────────────────────────────────────────

    private static ConnectorConfigRecord ReadFullRecord(SqliteDataReader reader) => new(
        Kind: reader.GetString(reader.GetOrdinal("kind")),
        MachineCode: reader.GetString(reader.GetOrdinal("machine_code")),
        Host: GetNullableString(reader, "host"),
        Port: GetNullableInt(reader, "port"),
        MapJson: reader.GetString(reader.GetOrdinal("map_json")),
        CreatedAtUtc: ParseIso(reader.GetString(reader.GetOrdinal("created_at"))),
        UpdatedAtUtc: ParseIso(reader.GetString(reader.GetOrdinal("updated_at"))),
        WriteCapability: GetWriteCapability(reader),
        Source: GetSource(reader),
        InstanceId: reader.GetString(reader.GetOrdinal("instance_id")),
        BusInstanceId: GetNullableString(reader, "bus_instance_id"),
        BusSettingsJson: GetNullableString(reader, "bus_settings_json"));

    private static ConnectorConfigSummary ReadSummary(SqliteDataReader reader)
    {
        var rawCapability = GetWriteCapability(reader);
        return new ConnectorConfigSummary(
            Kind: reader.GetString(reader.GetOrdinal("kind")),
            MachineCode: reader.GetString(reader.GetOrdinal("machine_code")),
            Host: GetNullableString(reader, "host"),
            Port: GetNullableInt(reader, "port"),
            UpdatedAtUtc: ParseIso(reader.GetString(reader.GetOrdinal("updated_at"))),
            WriteCapability: rawCapability is null ? null : ConnectorWriteCapabilityDto.From(rawCapability),
            Source: GetSource(reader),
            InstanceId: reader.GetString(reader.GetOrdinal("instance_id")),
            BusInstanceId: GetNullableString(reader, "bus_instance_id"));
    }

    /// <summary>Task B-6 — <see cref="Enum.Parse{TEnum}(string)"/>, not a raw string comparison: this column
    /// only ever holds one of the two <see cref="ConnectorConfigSource"/> member names (this class is the
    /// ONLY writer of this column — see <see cref="SaveAsync"/> and the migration's own literal default),
    /// so a value this doesn't recognize is a genuine corruption/schema-drift signal worth throwing loudly
    /// for, not silently defaulting past.</summary>
    private static ConnectorConfigSource GetSource(SqliteDataReader reader) =>
        Enum.Parse<ConnectorConfigSource>(reader.GetString(reader.GetOrdinal("source")));

    /// <summary>Task B-3 — <see langword="null"/> (a pre-existing row, or a map that declares no write/command
    /// capability — see <see cref="ConnectorWriteCapability"/>'s own doc comment for why the two are stored
    /// identically) reads back as <see langword="null"/>, never as <see cref="ConnectorWriteCapability.None"/>
    /// — a caller that wants a non-null instance can fall back to that constant itself; this store reports
    /// exactly what is persisted.</summary>
    private static ConnectorWriteCapability? GetWriteCapability(SqliteDataReader reader)
    {
        var ordinal = reader.GetOrdinal("write_capability_json");
        return reader.IsDBNull(ordinal) ? null : ConnectorWriteCapability.FromJson(reader.GetString(ordinal));
    }

    private static string? GetNullableString(SqliteDataReader reader, string column)
    {
        var ordinal = reader.GetOrdinal(column);
        return reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);
    }

    private static int? GetNullableInt(SqliteDataReader reader, string column)
    {
        var ordinal = reader.GetOrdinal(column);
        return reader.IsDBNull(ordinal) ? null : reader.GetInt32(ordinal);
    }

    private static string ToIso(DateTimeOffset value) => value.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);

    private static DateTimeOffset ParseIso(string value) =>
        DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
}
