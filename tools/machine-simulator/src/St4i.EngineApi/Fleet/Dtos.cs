using System.Text.Json;
using St4i.EdgeCore.Engine;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;

namespace St4i.EngineApi.Fleet;

// ─────────────────────────────────────────────────────────────────────────
// GET /v1/health
// ─────────────────────────────────────────────────────────────────────────
public sealed record HealthDto(bool Ok, TransportMode Mode);

// ─────────────────────────────────────────────────────────────────────────
// GET /v1/fleet, GET /v1/machines/{code} — 🔴 E-2 (blueprint §9.6(a)): FleetTileDto, FleetKpisDto,
// FleetSnapshotDto and MachineDetailDto MOVED to FleetProjections.cs, together with the four records
// MachineState.cs used to declare (CycleLogEntry/TelemetrySeriesDto/SpcSummaryDto/BoardPointDto) and the
// projection functions that build all of them from St4i.EdgeCore.Fleet's read-out records. That file's
// header explains why the split was a precondition of §4's "the DTOs stay in EngineApi" decision rather
// than a tidy-up: this file and MachineState.cs pointed at each other, and MachineState went down.
// ─────────────────────────────────────────────────────────────────────────

public sealed record FleetActionResultDto(bool Running, string Mode);

// ─────────────────────────────────────────────────────────────────────────
// GET/PUT /v1/mode
// ─────────────────────────────────────────────────────────────────────────
public sealed record ModeDto(TransportMode Mode);

// ─────────────────────────────────────────────────────────────────────────
// GET /v1/capabilities — WS2-T1: what this deployment allows, so the web shell knows whether to even
// render the DEMO option (topbar segmented control, Settings mode selector) instead of discovering it
// only after a rejected PUT /v1/mode. `Mode` is included too so a single fetch can seed both the
// capability AND the current mode on first paint without a second round trip.
//
// WS-F1-T1 — `Version` added: the product version (tools/machine-simulator/Directory.Build.props'
// single <Version>/<AssemblyVersion>, the same value the installer will read for upgrade-vs-fresh-install
// decisions), read back off this running assembly at request time. Web can surface it (e.g. an "About"
// panel, a support-ticket footer) later; no web change required by this task.
//
// WS-HMI-0a Task 5 — `HmiModelEnabled` added: the seam §6 of the machine-edition skill calls out
// ("capabilities là seam license") applied to the HMI component-model/tag-namespace stores this task
// wired into DI. Named for the MODEL layer specifically, not `HmiEnabled`, because the sibling plan
// (docs/plans/2026-08-30-hmi-ws0b-api-stream-blueprint.md) adds a SEPARATE `HmiApiEnabled`-shaped flag
// later — two parallel branches need to tell "the store exists" apart from "the API is open", and a
// shared name would collide the moment 0b lands. Always `true` today (no license tier exists yet to turn
// it off); WS-E License/Edition is the workstream that gives this a real gate, same as `DemoEnabled`
// eventually got one, without moving where the flag is reported.
// ─────────────────────────────────────────────────────────────────────────
// WS-HMI-0b Task 4 — `HmiApiEnabled` added, under the exact name the comment above predicted. It answers
// a DIFFERENT question from `HmiModelEnabled` and the difference is not hypothetical: WS-HMI-0a shipped
// the two stores with no route able to reach them, so there was a real released state in which
// "the store exists" was true and "the API is open" was false. A client that conflated them would have
// fetched a tree from an endpoint that did not exist.
//
// 🔴 AND NO THIRD FLAG FOR THE CHANGE LANE (WS /v1/hmi/changes), decided rather than skipped. The
// store/API split is justified because the two genuinely diverged in a shipped state. The lane and the API
// never have: they are registered in one composition root, in one commit, on one branch, gated by the same
// absence of any license tier — there is no version, released or buildable, in which `hmiApiEnabled` is
// true and the lane is absent. A flag whose value is definitionally equal to another's does not let a
// client branch; it lets a client BELIEVE it can branch, and the first release where they genuinely
// diverge is the release where that belief is wrong in the dangerous direction — a client skipping its
// subscribe because a flag it trusted said no. The honest expression of "the lane ships with the API" is
// one flag plus the sentence in docs/HMI_API_CONTRACT.md, and the moment 0c or WS-E can separate them is
// the moment to add the second. Both remain unconditionally `true` today for the reason the paragraph
// above gives.
public sealed record CapabilitiesDto(
    bool DemoEnabled, TransportMode Mode, string Version, bool HmiModelEnabled, bool HmiApiEnabled);

// ─────────────────────────────────────────────────────────────────────────
// POST /v1/scenario, /v1/scenario/preset, /v1/scenario/burst
// ─────────────────────────────────────────────────────────────────────────
public sealed record ScenarioRequest(double CycleRate = 1.0, double DefectRate = 0.0, double FaultRate = 0.0, bool NetworkOutage = false)
{
    public ScenarioConfig ToScenarioConfig() => new(CycleRate, DefectRate, FaultRate, NetworkOutage);
}

public sealed record ScenarioPresetRequest(string Name);

/// <summary>🔴 <b>2026-08-22 (item 33) — <c>NetworkOutage</c> ANSWERS A DIFFERENT QUESTION ON THE GET
/// THAN ON THE POSTs, ON PURPOSE, AND THE SPLIT IS THE FIX RATHER THAN A LEAK.</b> This record's shape is
/// unchanged (same six members, same types, same names) and <see cref="From"/> is still the only builder;
/// what differs is the value its one caller on each side hands it.
///
/// <para><c>GET /v1/scenario</c> → <c>FleetHost.CurrentScenarioDto</c> reports <b>the transport actually
/// installed</b>. That route is a STATUS surface polled once a second by <c>web/src/routes/Scenario.tsx</c>,
/// and answering it from the declared flag is what let it draw a lit "Network outage" switch over a fleet
/// whose readings were reaching the real server — see that member's own remarks for the three paths that
/// take the outage transport away without touching the flag.</para>
///
/// <para><c>POST /v1/scenario</c>, <c>/preset</c> and <c>/burst</c> → <c>FleetHost.ApplyScenario</c>/
/// <c>Burst</c> keep reporting <b>what was requested and accepted</b>. Deliberate, and the reason is the
/// audit row: every one of the three carries this value into <c>AuditRecorder</c> — bare as the
/// <c>scenario.apply</c> and <c>scenario.burst</c> payloads, and nested as <c>{ scenario, hotFolderStatus }</c>
/// for <c>scenario.preset</c> — and an audit trail answers "who asked for what", not "what survived the
/// next second". Deriving it there would let a mode switch racing the apply record an operator as having
/// asked for something they did not.</para>
///
/// <para><b>The two answers coincide except after a transport swap the scenario did not make</b>, which is
/// the exact window item 33 measured; anywhere else the split is invisible. Naming it here rather than
/// leaving one caller to be discovered is the point — the defect being fixed was itself a surface reporting
/// one state while another was live.</para></summary>
public sealed record ScenarioDto(double CycleRate, double DefectRate, double FaultRate, bool NetworkOutage, string ActivePreset, string StatusLine)
{
    /// <summary>Projects one <see cref="ScenarioConfig"/> onto the wire. Whether
    /// <paramref name="config"/>'s <c>NetworkOutage</c> is the DECLARED flag or the INSTALLED-transport
    /// truth is the CALLER's decision and is documented at each caller — see this record's own remarks for
    /// which route picks which, and why.</summary>
    public static ScenarioDto From(ScenarioConfig config, string activePreset) => new(
        config.CycleRateMultiplier,
        config.ExtraDefectRate,
        config.FaultRate,
        config.NetworkOutage,
        activePreset,
        BuildStatusLine(config, activePreset));

    /// <summary>🔴 The outage half of this line used to read "network outage (acks queued/failing)" and
    /// the second half of that pair was never true: measured on every branch of
    /// <c>DemoTransport.SendAsync</c>, the queued branch returns <c>Success=true, Queued=true</c> and the
    /// three acking branches return <c>Success=true</c> — no branch returns a failed ack, and the 0.9
    /// <c>fakeErrorRate</c> the outage scenario installs selects the QUEUED branch, not a failure. The
    /// text now says only what the transport does. This is the operator-visible string, so it is a
    /// published value: the DTO's SHAPE is unchanged (same record, same six members, same
    /// <see cref="StatusLine"/> field) — only the sentence inside it stopped promising something that
    /// never happens.
    ///
    /// <para>🔴 2026-08-22 (item 33) — the outage clause of this line follows
    /// <paramref name="config"/><c>.NetworkOutage</c>, so on the <c>GET</c> it now names the transport
    /// actually installed and on the <c>POST</c>s it names what was requested; see this record's own
    /// remarks. A cleared outage under a still-selected preset therefore renders as
    /// <c>"network-outage — … network normal."</c> — two true statements, because
    /// <paramref name="activePreset"/> is a fact about the operator's SELECTION and was never a claim
    /// about the wire.</para></summary>
    private static string BuildStatusLine(ScenarioConfig config, string activePreset)
    {
        var outageText = config.NetworkOutage ? "network outage (acks queued, never failed)" : "network normal";
        return $"{activePreset} — cycleRate={config.CycleRateMultiplier:0.00}x, defect={config.ExtraDefectRate:P0}, fault={config.FaultRate:P0}, {outageText}.";
    }
}

/// <summary>One named scenario preset — kebab-case <see cref="Name"/> keys (an API ergonomics choice;
/// the WPF app's own preset picker uses Vietnamese display names instead) that <c>POST
/// /v1/scenario/preset</c> matches case-insensitively.</summary>
public sealed record ScenarioPresetInfo(string Name, string Description, ScenarioConfig Config, bool TriggersHotFolderDemo = false);

// ─────────────────────────────────────────────────────────────────────────
// GET/PUT /v1/settings, POST /v1/settings/probe
// ─────────────────────────────────────────────────────────────────────────
public sealed record SettingsDto(string ServerUrl, bool VerifyTls, string Language, string MachineCode, TransportMode Mode);

/// <summary>All fields optional — an omitted field leaves that setting unchanged (a PUT that only wants
/// to flip <c>language</c>, say, doesn't need to also resend <c>serverUrl</c>).</summary>
public sealed record SettingsUpdateRequest(string? ServerUrl, bool? VerifyTls, string? Language, string? MachineCode);

public sealed record ProbeRequest(string ServerUrl);

// ─────────────────────────────────────────────────────────────────────────
// POST /v1/onboarding/*
//
// WS2-T1 — `IsDemo` changed from a hardcoded `= true` default to `bool?` (default `null` = "caller
// didn't say"). A `true`/`false` sent on the wire always wins unchanged. An OMITTED field used to
// silently resolve to Demo unconditionally; it now can't distinguish "unset" from "false" at the DTO
// level at all — that's deliberate, so `OnboardingEndpoints` can resolve the null case from the
// engine's ACTIVE transport mode (Live by default post-WS2-T1, Demo on an exhibition/flagged
// deployment) instead of a fact baked into the wire contract. `OnboardingService` itself (still
// fleet/mode-free by design, see its own class doc) falls back to demo-fabrication (`req.IsDemo ??
// true`) ONLY when constructed and called directly with no resolution step at all — the shape every
// pre-existing unit test in this repo already uses — never reachable from the real HTTP endpoints,
// which always resolve the null case before calling in.
// ─────────────────────────────────────────────────────────────────────────
public sealed record OnboardingRegisterRequest(string SerialNumber, string? Name, string? MachineType, bool? IsDemo = null, string? ServerUrl = null);

public sealed record OnboardingPollRequest(string SerialNumber, bool? IsDemo = null, string? ServerUrl = null);

/// <summary>E2: <c>Name</c>/<c>MachineType</c> added (optional — a client that doesn't send them still
/// works, falling back to a generic Automation profile) so a successful claim can build the
/// <see cref="MachineDescriptor"/> needed to join the sim fleet (see
/// <see cref="OnboardingFleetJoin"/>) without OnboardingService having to remember state from the
/// earlier Register call keyed by serialNumber. The WEB wizard already tracks both at the top of its
/// onboarding flow (used by Register/Enroll already) — E2 just needs it threaded into the Claim POST
/// body too.</summary>
public sealed record OnboardingClaimRequest(string SerialNumber, string? ClaimToken, bool? IsDemo = null, string? ServerUrl = null, string? Name = null, string? MachineType = null);

public sealed record OnboardingEnrollRequest(string SerialNumber, string? EnrollToken, string? Name, string? MachineType, bool? IsDemo = null, string? ServerUrl = null);

public sealed record OnboardingPasteKeyRequest(string MachineCode, string MkKey);

public sealed record OnboardingStepResult(string Step, string? MachineCode, string? MkKey, bool IsApproved, string Message);

// ─────────────────────────────────────────────────────────────────────────
// POST /v1/machines/{code}/sync-config
// ─────────────────────────────────────────────────────────────────────────
public sealed record SyncConfigResponse(string Code, bool Changed, string? Version, string? DriftState, bool Applied, string DriftStateText);

public sealed record ApiErrorDto(string Error);

// ─────────────────────────────────────────────────────────────────────────
// GET /v1/connectors — GP-5 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/
// task-5-brief.md item 3): visibility for a connector that is CONFIGURED (registered into
// ConnectorRegistry) but not currently running because its last start attempt failed. See
// FleetHost.GetConfiguredConnectorIssues's own doc comment for why this is deliberately informational,
// never a /v1/health fault.
//
// `Id` here is the REGISTRY KEY — FleetHost.GetConfiguredConnectorIssues projects the keys of
// _connectorStartIssues, which StartLocked populates from ConnectorRegistry.RegisteredIds.
//
// 🔴 Task D-1 (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-1-brief.md) — WHAT that registry
// key IS changed under this comment, so the previous wording is corrected rather than left standing. It
// used to read: "`Id` here is actually the REGISTRY KEY, i.e. the normalized `kind` … ConnectorRegistry.
// Register keys purely on IConnectorFactory.Kind. A connectors.json entry `{"id":"line3-weld",
// "kind":"Modbus"}` therefore surfaces here as `{"id":"Modbus","error":...}`." Both halves of that are now
// false: Register keys on a per-connector INSTANCE id, so this field carries an instance id, and two
// connectors of one kind produce two distinct entries here rather than one silently replacing the other.
//
// What did NOT change, and is the part worth keeping: a connectors.json entry's own `id` field is still
// read only to NAME per-entry warnings and is still discarded — Program.cs's connectors.json dispatch
// deliberately lets the instance id default to the kind (see ConnectorsJsonRegistration's own remarks for
// why adopting entry.Id would silently move every such connector's pipeline slot label, and therefore its
// alarm TargetId). So that example entry STILL surfaces as `{"id":"Modbus","error":...}` today — for a
// different reason than the one the old comment gave. README §19.4's fuller writeup is stale on the same
// point and is D-7's to correct.
// ─────────────────────────────────────────────────────────────────────────
public sealed record ConnectorStatusDto(string Id, string Error);

// ─────────────────────────────────────────────────────────────────────────
// POST /v1/connectors, GET /v1/connectors/configured, DELETE /v1/connectors/{instanceId},
// POST /v1/connectors/test — SM-5 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/
// task-5-brief.md): the write path connectors.json never had. See ConnectorEndpoints' own doc comment for
// the full RBAC/audit/apply-live-or-restart write-up.
// ─────────────────────────────────────────────────────────────────────────

/// <summary><c>MapJson</c> is the register-map (Modbus) / node-map (OPC-UA) JSON text, pasted or uploaded
/// verbatim by the operator — forwarded opaque to <see cref="St4i.Connector.Abstractions.IConnectorFactory.TryCreate"/>,
/// exactly like a <c>connectors.json</c> entry's own <c>settings</c> value. <c>Host</c>/<c>Port</c> only
/// apply to <see cref="DriverKinds.Modbus"/> — ignored (not an error) for <see cref="DriverKinds.OpcUa"/>,
/// whose endpoint/credentials already live inside <c>MapJson</c> itself.</summary>
/// <param name="ConfirmedWriteCapabilityFingerprint">Task B-3 — the deliberate-save gate, mirroring
/// <c>POST /v1/site/identity/rotate</c>'s own echo-back pattern
/// (<see cref="St4i.EngineApi.Endpoints.SiteEndpoints.RotateIdentityAsync"/>). <see langword="null"/>/omitted
/// is fine for a map that declares no write/command capability — the overwhelming majority of saves, and
/// every save this build ever accepted before this task. When <c>MapJson</c> DOES declare a writable point or
/// command, this must echo <see cref="ConnectorWriteCapability.ComputeFingerprint"/>'s own value for that
/// EXACT map — <see cref="Endpoints.ConnectorEndpoints.CreateConnectorAsync"/> returns 400 (missing/blank) or
/// 409 (present but not matching what this specific map currently declares) rather than silently arming the
/// capability on a bare, unconfirmed POST.</param>
/// <param name="InstanceId">Task D-1 (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-1-brief.md)
/// — this connector INSTANCE's own id, and the segment <c>DELETE /v1/connectors/&#123;instanceId&#125;</c>
/// takes. Optional: omitted/blank means "use <paramref name="Kind"/>", which is the id every pre-D-1 row
/// already has and the id <see cref="St4i.EdgeCore.Fleet.ConnectorRegistry.Register"/> defaults to — so a
/// client that has never heard of instance ids keeps configuring exactly the one Modbus / one OPC-UA
/// connector it always did, at the same URLs. Supply a distinct id to run a SECOND connector of the same
/// kind (two RS-485 devices on one bus, two Modbus TCP PLCs): that is what this field exists for, and it is
/// the only field that makes the second one addressable.</param>
public sealed record ConnectorCreateRequest(string Kind, string? Host, int? Port, string MapJson, string? ConfirmedWriteCapabilityFingerprint = null, string? InstanceId = null);

/// <summary>Task B-3 — the write/command capability a saved (or about-to-be-saved) map declares, shaped for
/// direct display: never omit <see cref="Fingerprint"/> only because it's inconvenient to compute twice —
/// <see cref="GrantsWriteCapability"/> is <see langword="false"/> and every list empty for the overwhelming
/// majority of connectors (every map this build accepted before this task, and every map after it that simply
/// declares neither). <see cref="Fingerprint"/> is <see langword="null"/> in that case too — there is nothing
/// to confirm.
///
/// <para><b>Fix round 1 (Important #1) — <see cref="WritablePoints"/>/<see cref="Commands"/> carry the FULL
/// grant</b> (<see cref="ConnectorWritablePointGrant"/>'s own <c>Target</c>/<c>Min</c>/<c>Max</c>,
/// <see cref="ConnectorCommandGrant"/>'s own <c>Target</c>) — not just a bare name — reusing the SAME shape
/// <see cref="ConnectorWriteCapability"/> itself carries, the SAME shape <c>GET /v1/connectors/configured</c>'s
/// own <see cref="ConnectorConfigSummary.WriteCapability"/> uses, so an operator can see EXACTLY what a save
/// grants (which register/node, what bounds, which coil/method) directly in the 400/409/200 response body and
/// in the configured-connectors list — the review's own finding that neither the limits nor the target ever
/// appeared anywhere.</para></summary>
public sealed record ConnectorWriteCapabilityDto(
    bool GrantsWriteCapability,
    IReadOnlyList<ConnectorWritablePointGrant> WritablePoints,
    IReadOnlyList<ConnectorCommandGrant> Commands,
    string? Fingerprint)
{
    public static ConnectorWriteCapabilityDto From(ConnectorWriteCapability capability) => new(
        capability.GrantsCapability, capability.WritablePoints, capability.Commands,
        capability.GrantsCapability ? capability.ComputeFingerprint() : null);
}

/// <summary><c>AppliedLive</c> is true only when this was a genuinely NEW machine code
/// (<see cref="FleetHost.RegisterMachine"/> added it — which restarts the pipeline itself if it was already
/// running, see that method's own doc comment); false means a connector config for this kind already existed
/// under the SAME machine code, so only the persisted store + the live <c>ConnectorRegistry</c> entry were
/// updated — an already-running fleet does not pick up the change until it is stopped/started again (or the
/// process restarts). <c>Message</c> is the operator-facing sentence saying exactly which of those two
/// happened — never leave the operator guessing why nothing visibly changed.
///
/// <para><b>Task B-3 — <see cref="WriteCapability"/> is deliberately the FIRST field</b>, the same reason
/// <c>POST /v1/site/identity/rotate</c>'s own response returns the new fingerprint first (see
/// <see cref="St4i.EngineApi.Endpoints.SiteEndpoints.RotateIdentityAsync"/>'s own doc comment): whatever a
/// save just granted must be impossible to miss in the response, not a field a caller has to know to go
/// looking for.</para></summary>
/// <param name="Devices">🔴 Task D-7b — every device row a Modbus RTU BUS save produced, in bus order;
/// <see langword="null"/> for every single-connector save (which is every save this endpoint accepted before
/// D-7b). <see cref="Config"/> stays populated for a bus too — it is the FIRST device — so a pre-D-7b client
/// reading only that field still gets a well-formed row rather than a null, and a D-7b client reading this
/// one learns that the request created N connectors rather than the one its shape implies.</param>
public sealed record ConnectorCreateResultDto(
    ConnectorWriteCapabilityDto WriteCapability, ConnectorConfigSummary Config, bool AppliedLive, string Message,
    IReadOnlyList<ConnectorConfigSummary>? Devices = null);

/// <summary>The <c>DELETE /v1/connectors/{instanceId}</c> response (the segment was <c>{kind}</c> before Task D-1). <c>Message</c> states plainly that this only
/// removes the PERSISTED configuration — <see cref="FleetHost.RegisterMachine"/> has no unregister, so a
/// machine already in the roster (and any currently-running connector for this kind) is unaffected until a
/// full process restart, which is when Program.cs would next decide what to seed from a (now-empty) store.</summary>
/// <param name="Kind">Task D-1 — kept as the property NAME (a wire-shape change no client asked for is a
/// gratuitous break) but it now carries the deleted connector's INSTANCE id, which for every pre-D-1 row and
/// every connector saved without its own id is the same string it always was.</param>
public sealed record ConnectorDeleteResultDto(string Kind, string Message);

/// <summary>Same shape as <see cref="ConnectorCreateRequest"/> — a connection test never persists anything,
/// so it takes exactly the fields needed to build a throwaway driver and nothing else.</summary>
public sealed record ConnectorTestRequest(string Kind, string? Host, int? Port, string MapJson);

/// <summary>Returned <c>200 OK</c> (never 4xx/5xx) for anything past request-shape validation — mirrors
/// <c>POST /v1/settings/probe</c>'s own precedent exactly (a malformed REQUEST, e.g. a missing/blank
/// <c>serverUrl</c>/kind/map, is a 400; a request that parses fine but can't actually reach a device is a
/// 200 with the verdict IN the body, never an exception-shaped response) — <see cref="Ok"/> false covers
/// both "the connector factory rejected this configuration" and "no response within the bounded window",
/// since an operator does not need to know or care which.</summary>
public sealed record ConnectorTestResultDto(bool Ok, string? Error);

// ─────────────────────────────────────────────────────────────────────────
// POST /v1/machines/{code}/setpoint, POST /v1/machines/{code}/command — Task B-6
// (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-6-brief.md): the last thing standing
// between an authenticated session and a moving machine. See MachineWriteEndpoints' own class doc comment
// for the full policy/RBAC/audit/rate-limit write-up.
// ─────────────────────────────────────────────────────────────────────────

/// <summary><c>Value</c> is bound as a raw <see cref="JsonElement"/>, deliberately — NOT <c>object?</c>. This
/// host's global HTTP JSON options (<c>Program.cs</c>'s <c>ConfigureHttpJsonOptions</c>) have no converter for
/// bare <see cref="object"/>, so an <c>object?</c>-typed property would bind to a boxed <see cref="JsonElement"/>
/// anyway (System.Text.Json's own default for an untyped member) — <see cref="MachineWriteEndpoints"/> makes
/// that explicit and then re-parses it through <see cref="St4i.Connector.Abstractions.Json.ConnectorJson"/>'s
/// own <c>object?</c> converter (the SAME already-hardened domain <see cref="IWritableDeviceDriver.WriteSetpointAsync"/>
/// expects: <c>double | bool | string | null</c>, decision (b) rejecting arrays/objects/decimal loudly rather
/// than silently coercing) — reusing that logic rather than re-deriving a second, possibly-inconsistent
/// narrowing rule at the HTTP boundary. An omitted <c>"value"</c> key binds to
/// <see cref="JsonValueKind.Undefined"/> (distinguishable from an explicit JSON <c>null</c>,
/// <see cref="JsonValueKind.Null"/>) — <see cref="MachineWriteEndpoints"/> rejects the former with 400
/// ("value is required") and lets the latter through as a genuine (if unusual) write attempt, exactly the
/// same "a value was never supplied" vs. "a value was supplied and IS null" distinction this codebase already
/// insists on elsewhere (e.g. <c>ConnectorWritablePointGrant</c>'s own nullable-not-sentinel bounds).</summary>
public sealed record MachineSetpointWriteRequestDto(string Point, JsonElement Value);

/// <summary><c>Arguments</c>' values are bound as raw <see cref="JsonElement"/>s for the identical reason
/// <see cref="MachineSetpointWriteRequestDto.Value"/> is — see that DTO's own doc comment. <see langword="null"/>/
/// omitted for a command that takes none (the only shape a Modbus coil-pulse command can ever declare today —
/// see <see cref="St4i.EdgeCore.Drivers.Modbus.ModbusRegisterMap"/>'s own remarks on Modbus commands carrying
/// no wire-mapping for arguments yet).</summary>
public sealed record MachineCommandRequestDto(string Command, Dictionary<string, JsonElement>? Arguments = null);

/// <summary>The <c>404</c>/<c>409</c> body for the three-and-a-half operator-meaningful "cannot even attempt
/// this write" cases (<see cref="Fleet.MachineDriverAvailability"/>, minus <see cref="Fleet.MachineDriverAvailability.MachineNotFound"/>,
/// which reuses the plain <see cref="ApiErrorDto"/> shape <c>GET /v1/machines/{code}</c> already returns for
/// an unknown code — one consistent "unknown machine" shape across the whole API). <see cref="Reason"/> is a
/// stable, SCREAMING_SNAKE machine code (mirrors <see cref="Policy.PolicyDenyDto"/>'s own <c>Reason</c>) an
/// operator-facing client can branch on; <see cref="Error"/> is the human-readable explanation — same field
/// order/naming as <see cref="Policy.PolicyDenyDto"/> so a caller that already knows one error shape in this
/// API recognizes the other immediately.</summary>
public sealed record MachineWriteUnavailableDto(string Error, string Reason);

/// <summary>The <c>200 OK</c> body for an ATTEMPTED setpoint write — every <see cref="WriteOutcome"/>
/// (<c>Applied</c>/<c>Rejected</c>/<c>Failed</c>/<c>Indeterminate</c>) returns this SAME shape at this SAME
/// status code; see <see cref="MachineWriteEndpoints"/>'s own class doc comment for why status code 200
/// (never 4xx/5xx) is deliberate for every outcome once a live driver was actually resolved and a write
/// genuinely attempted — the exact same "verdict IN the body, never an exception-shaped response" posture
/// <see cref="ConnectorTestResultDto"/> already established for <c>POST /v1/connectors/test</c>.</summary>
public sealed record MachineSetpointWriteResponseDto(string MachineCode, SetpointWriteResult Result);

/// <summary>The command-invocation mirror of <see cref="MachineSetpointWriteResponseDto"/> — same reasoning,
/// same status-code posture, for <see cref="CommandResult"/> instead.</summary>
public sealed record MachineCommandInvokeResponseDto(string MachineCode, CommandResult Result);
