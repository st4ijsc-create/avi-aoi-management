using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;
using St4i.EdgeCore.Config;
using St4i.EdgeCore.Drivers;
using St4i.Connector.Abstractions;
using St4i.EdgeCore.Drivers.HotFolder;
using St4i.EdgeCore.Drivers.Modbus;
using St4i.EdgeCore.Drivers.Simulators;
using St4i.EdgeCore.Engine;
using St4i.EdgeCore.Historian;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Mapping;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Transport;
using St4i.EdgeCore.Uns;

namespace St4i.EdgeCore.Fleet;

/// <summary>GĐ3 sub-4 LC-2 — one pipeline slot's driver health, as read by <see cref="FleetCore.GetDriverHealth"/>:
/// the slot's label, its driver's <see cref="IDeviceDriver.Kind"/> (GP-3: a free-form connector id, no
/// longer a closed enum), and its current <see cref="DriverHealthState"/>. A top-level (not nested) type
/// — same "small DTO sitting alongside the class it's produced by" idiom as
/// <see cref="SafetySnapshot"/> for <see cref="FleetCore.GetSafetyStatus"/>.</summary>
public sealed record DriverHealthSnapshot(string SlotLabel, string Kind, DriverHealthState Health);

/// <summary>Task B-2 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-2-brief.md) — the four
/// operator-meaningful situations a caller resolving "does machine code X have a live, writable driver right
/// now" must be able to tell apart, returned by <see cref="FleetCore.GetMachineDriverAvailability"/> and
/// echoed back by <see cref="FleetCore.TryWriteSetpointAsync"/>/<see cref="FleetCore.TryInvokeCommandAsync"/>.
/// Collapsing these into one generic "not available" would produce an unhelpful error: an operator needs a
/// DIFFERENT explanation for "you mistyped the machine code" than for "the fleet is stopped" than for "this
/// driver can only be read, never written" — three different fixes, three different people who might need to
/// act.
///
/// <para>Deliberately its OWN small enum, not a reuse/extension of <see cref="St4i.Connector.Abstractions.Models.WriteOutcome"/>
/// — that vocabulary answers a different question ("what happened to one write attempt against an ALREADY-
/// resolved driver") from this one ("is there a driver to attempt a write against at all"). Folding the two
/// together would either duplicate <see cref="St4i.Connector.Abstractions.Models.WriteOutcome.Rejected"/>'s
/// meaning under a new name or force a resolution failure to borrow an outcome that implies I/O was attempted
/// when none was.</para></summary>
public enum MachineDriverAvailability
{
    /// <summary>No <see cref="St4i.EdgeCore.Models.MachineDescriptor"/> in the CURRENT roster carries this
    /// code (case-insensitive match against <see cref="St4i.EdgeCore.Models.MachineDescriptor.Code"/>) — an
    /// operator typo, or a machine that was never onboarded at all.</summary>
    MachineNotFound,

    /// <summary>The roster knows this machine, but no live <c>PipelineSlot</c> currently drives it — the
    /// fleet is stopped/<see cref="FleetCore.EstopEngaged"/>, or (for a connector-backed machine) its
    /// connector failed to start this run (see <see cref="FleetCore.GetConfiguredConnectorIssues"/>).</summary>
    NoLiveDriver,

    /// <summary>A live driver exists for this machine right now, but it does not implement
    /// <see cref="IWritableDeviceDriver"/> — every built-in driver other than <c>ModbusTcpDriver</c> (B-4),
    /// <c>OpcUaDriver</c> (B-5) and <c>ModbusRtuDriver</c> (D-5), which all three implement it: the simulated
    /// fleet, HotFolderAoi, Mqtt. (Whole-branch review M5 — the RTU driver was missing from this list.)
    ///
    /// <para>🔴 <b>Whole-branch review I3 — which of those can actually REACH this value, because the
    /// operator-facing string derived from it named a producer that cannot exist in this build.</b> Every
    /// <see cref="St4i.Connector.Abstractions.IConnectorFactory"/> here (<c>ModbusConnectorFactory</c>,
    /// <c>ModbusRtuConnectorFactory</c>, <c>OpcUaConnectorFactory</c>) produces a driver that DOES implement
    /// <see cref="IWritableDeviceDriver"/>, and there is no plugin loader — so a connector-backed slot never
    /// lands here. A writable driver whose map declares no matching point resolves as <see cref="Writable"/>
    /// and the write returns <c>Rejected</c> instead. What actually reaches this value is the simulated group
    /// (via <c>ScenarioAwareDriver</c>) and the hot-folder demo pipeline — drivers built outside the connector
    /// path — plus <c>AdditionalPipelinesForTests</c>. See <c>MachineWriteGate.ExplainUnavailable</c>.</para></summary>
    ReadOnly,

    /// <summary>A live driver implementing <see cref="IWritableDeviceDriver"/> exists for this machine right
    /// now — a write MAY be attempted (still subject to that driver's own point/command validation, and to
    /// the disposal race documented on <see cref="FleetCore.TryWriteSetpointAsync"/>).</summary>
    Writable,

    /// <summary>Review fix round 1 (Critical) — a live, writable driver exists for the SLOT this machine code
    /// resolves to, but MORE THAN ONE roster member resolves to that SAME slot, so this method cannot verify
    /// the resolved driver actually serves THIS machine code rather than a sibling's. <see cref="ConnectorRegistry"/>
    /// keeps at most one live driver per protocol <c>Kind</c> for the WHOLE fleet (last-write-wins), and
    /// neither <see cref="St4i.Connector.Abstractions.Models.SetpointWriteRequest"/> nor
    /// <see cref="St4i.Connector.Abstractions.Models.CommandRequest"/> carries a machine code the driver could
    /// cross-check its own binding against — so two roster members sharing a <c>DriverKind</c> (a hand-edited
    /// <c>fleet.json</c> with two same-kind entries, or two <see cref="RegisterMachine"/> calls for the same
    /// kind) are, from this method's point of view, INDISTINGUISHABLE: it has no way to know which of them the
    /// single live driver instance is actually talking to. Reported instead of <see cref="Writable"/> — a
    /// write reaching the wrong physical machine is the worst possible failure mode for this capability, worse
    /// than refusing outright. This is deliberately the MINIMUM safe check (count of roster members sharing the
    /// resolved slot label), not a full "does this specific driver instance serve code X" verification — that
    /// requires a driver-to-machine binding this codebase does not have anywhere yet (a later task, B-3's map
    /// work, is the first place such a binding could plausibly live). Never returned for
    /// <see cref="ReadOnly"/>/<see cref="NoLiveDriver"/> resolutions — sharing a slot is completely safe when
    /// nothing can be written through it at all (e.g. ten demo machines legitimately sharing the one
    /// "simulated" slot).
    ///
    /// <para><b>🔴 Task D-1 (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-1-brief.md) — this
    /// member is NOT reachable through any production wiring any more, and it is deliberately still here.</b>
    /// The paragraph above names the precondition exactly: <see cref="ConnectorRegistry"/> kept at most one
    /// live driver per protocol Kind, so several roster machines resolved to one slot. D-1 removed that
    /// precondition rather than removing this guard — the registry is keyed per connector INSTANCE, an
    /// instance may claim the machine code it serves, and a claim another instance already holds is refused
    /// at registration. A claimed machine therefore resolves to exactly one identifiable driver
    /// (<see cref="Writable"/>) and an unclaimed one resolves to <see cref="NoLiveDriver"/>; neither can
    /// reach this member. Every production registration path binds a machine code (they all begin from a
    /// parsed register/node map, where <c>machineCode</c> is required), so the only remaining way to
    /// construct the precondition is <see cref="FleetCore.AdditionalPipelinesForTests"/> — the test-only seam
    /// that injects a raw pipeline slot with no connector instance behind it, which is exactly how Đợt B's
    /// own regression test still reaches this state.</para>
    ///
    /// <para><b>Why it stays rather than being deleted.</b> "We removed the guard because we believe it can
    /// no longer happen" and "we proved it can no longer happen and left the guard standing" look identical
    /// in a passing test run and are not the same engineering. This member costs one enum value and one
    /// switch arm; what it buys is that the day something DOES reintroduce a many-machines-to-one-writable-
    /// slot shape — a future transport that shares one driver across slave addresses, a third-party
    /// registration path that never learns a machine code — the write is refused instead of delivered to
    /// whichever device the driver happens to be pointed at. Deleting it would convert that day's outcome
    /// from a 409 into a wrong machine moving.</para></summary>
    AmbiguousDriver,
}

/// <summary>
/// Task 3 — the headless composition root: builds + runs the simulated fleet with NO UI, reusing
/// exactly the same EdgeCore driver→normalize→transport pipeline the WPF app's <c>FleetService</c>
/// drives (<see cref="SimulatedDriver"/>/<see cref="ScenarioAwareDriver"/>/<see cref="EdgePipeline"/>/
/// <see cref="SwitchableTransport"/>/<see cref="TransportCoordinator"/> — all relocated into EdgeCore
/// by this same task specifically so this class and the WPF exhibition app can share them byte-for-byte).
///
/// Owns: the fleet roster (fleet.json with an in-code fallback — same resolution order as
/// <c>FleetService.LoadFleet</c>), per-machine <see cref="MachineState"/> (thread-safe, HTTP-GET-safe
/// snapshots), fleet-wide KPI counters, the active <see cref="ScenarioConfig"/>, and the
/// connection/Settings state a <c>PUT /v1/settings</c> mutates.
///
/// <para>🔴 <b>Task E-2 (docs/plans/2026-08-04-dotE-fleet-core-extraction-blueprint.md) — this class WAS
/// <c>St4i.EngineApi.Fleet.FleetHost</c>, and it moved here so a SECOND host can drive N drivers.</b> Đợt D
/// made RS-485 work only inside <c>St4i.EngineApi</c>, but the process that owns the serial port is
/// <c>St4i.EdgeService</c>, whose <c>EdgeWorker</c> collapsed the whole fleet into one
/// <see cref="SimulatedDriver"/> on one <see cref="EdgePipeline"/>. (🔴 <b>Past tense since E-3</b>, and
/// corrected here by E-4's census rather than left to read as current: <c>EdgeWorker</c> now runs N drivers
/// on N pipelines from its own <c>connectors.json</c>, through <c>EdgeAgentPipelines</c> — <b>not</b> through
/// this class, which is <c>internal</c> exactly so that host cannot reach its unguarded write path. README
/// §24.) Referencing <c>St4i.EngineApi</c>
/// straight from <c>St4i.EdgeService</c> is not available (NU1605 on restore, plus EngineApi's ASP.NET
/// Core/web-UI publish surface), so the lifecycle had to come DOWN to the assembly both hosts already
/// reference. <c>FleetHost</c> is now a thin shell over this class: it owns the roster's WEB projection
/// (every <c>*Dto</c>), the scenario preset catalogue, <c>IAssetRegistry</c>, <c>ConfigSyncCoordinator</c>
/// and every <c>Endpoints/</c> route. It holds NO LOCK OF ITS OWN — see <see cref="_gate"/>.</para>
///
/// <para><b>What this class deliberately does NOT do: name a web shape.</b> Every read-out returns a
/// domain record (<c>FleetSnapshots.cs</c>) and the shell projects it. That is blueprint §4's decision,
/// and it is also what makes the one-way dependency edge checkable by the compiler rather than by
/// review — <c>St4i.EdgeCore</c> cannot reference <c>St4i.EngineApi</c> at all.</para>
///
/// <para><b>Logging is nullable callbacks, not <c>ILogger</c>.</b> <c>St4i.EdgeCore</c> is intentionally
/// logging-framework-free (<c>MappingProfileResolver.cs</c> states the policy); this class follows the
/// same <c>Action&lt;string&gt;? logWarning</c> / <c>Action&lt;Exception,string&gt;? logError</c>
/// convention as every other type here. 🔴 G-1 added a THIRD, <see cref="_logDebug"/>, and <b>this class is
/// the FIRST three-channel type in <c>St4i.EdgeCore</c></b> — counted, because the sentence that used to
/// stand here claimed <c>WalFlushPump</c> "already carries three" and it does not: it carries TWO
/// (<c>logInfo</c>/<c>logError</c>, <c>WalFlushPump.cs:35-36</c>), and <c>HistorianWriter</c> carries two as
/// well. What <c>WalFlushPump</c> genuinely establishes is narrower and is the part worth citing: an
/// EdgeCore log callback pair is <b>not</b> required to be warning+error, so a third level is a precedented
/// choice rather than a new convention. See <see cref="_logWarning"/> for the D-7a trap the shape carries
/// and the rule this class holds because of it, and <see cref="_logDebug"/> for the operator cost that made
/// a third channel worth adding.</para>
///
/// <para>🔴 <b>Task E-3 — THIS TYPE IS <c>internal</c>, AND THAT IS THE WHOLE OF BLUEPRINT §3's "an edge
/// agent's machines are read-only", EXPRESSED AS A COMPILE ERROR RATHER THAN AS A SENTENCE.</b>
///
/// <para>The hazard, stated exactly. <see cref="TryWriteSetpointAsync"/> and
/// <see cref="TryInvokeCommandAsync"/> route a machine code to a live <c>IWritableDeviceDriver</c> and
/// perform I/O against it, and <b>nothing inside either of them consults the HALT latch</b> — the guard is
/// <c>St4i.EngineApi.Policy.Rules.EstopGuardRule</c>, which sits ABOVE them, in the only assembly that has
/// RBAC, an audit trail and Đợt B's <c>Indeterminate</c> contract. E-2 left this class <c>public</c> on an
/// assembly <c>St4i.EdgeService.csproj</c> already references, so the moment E-3 gave <c>EdgeWorker</c> a
/// lifecycle owner, an unguarded write path became one <c>new FleetCore(...)</c> away — reachable by
/// accident, in a host with no guard to reach for.</para>
///
/// <para><b>Why the whole type and not just the two write members.</b> The rule of this batch is to start
/// from the SET OF MEMBERS, not from a type name. Doing that: <see cref="Estop"/>/<see cref="ResetEstop"/>
/// move the supervisory latch; <see cref="RegisterMachine"/> mutates the live roster; <see cref="UpdateSettings"/>
/// rewrites the process-wide connection identity and, when a <see cref="FleetSettingsStore"/> is wired,
/// writes a machine-wide file; <see cref="ApplyScenario"/>/<see cref="Burst"/>/<see cref="RunHotFolderAoiDemoAsync"/>
/// mutate core state and the last one writes files; <see cref="ApplyMode"/> swaps the transport underneath a
/// running fleet. Sealing only the two write members would have left every one of those open to a host that
/// must not have them. One accessibility modifier closes all of it, for this host and for every future one.</para>
///
/// <para><b>What it costs: nothing measurable.</b> Outside this assembly the name <c>FleetCore</c> appears in
/// exactly one file of executable code — <c>St4i.EngineApi/Fleet/FleetHost.cs</c> — and
/// <c>St4i.EdgeCore/AssemblyInfo.cs</c> already grants <c>St4i.EngineApi</c>
/// <c>InternalsVisibleTo</c> (E-2, for the three test seams). Every other mention in <c>src/</c> and
/// <c>tests/</c> is a doc comment. So this is a one-word change that no production or test call site had to
/// follow.</para>
///
/// <para><b>And it closes blueprint §9.4(1) by construction rather than by warning.</b> That defect is "the
/// same code, run inside EdgeService, silently resolves an EMPTY roster and a missing <c>mapping/</c>
/// directory, with no exception and no warning naming the cause". Its precondition was that this class could
/// run inside <c>St4i.EdgeService</c>. It cannot. The second reader of <c>--fleet</c> that §9.4(1) warns
/// about — <see cref="ResolveFleetPath"/> — is likewise unreachable from that process, so the two roster
/// readers can never meet: see <c>EdgeAgentPipelines</c> and <c>EdgeWorker.LoadFleet</c>.</para>
///
/// <para><b>What a second host gets instead:</b> <see cref="St4i.EdgeCore.Engine.EdgeAgentPipelines"/> — a
/// narrower lifecycle owner whose entire member set is read-only, that owns the drivers it builds and never
/// hands one out. It does not wrap this class; see its own remarks for why re-using this one was rejected on
/// evidence rather than on taste.</para></para>
/// </summary>
internal sealed class FleetCore
{
    private const double BurstMultiplier = 6.0;
    private static readonly TimeSpan BurstDuration = TimeSpan.FromSeconds(4);
    private const double MinCycleSeconds = 0.05;
    private const double OutageFakeErrorRate = 0.9;
    private const double OutageLatencyMs = 60;

    /// <summary>Completion-review #1/#7 — bounded wait for a restart path's OLD run-task to finish
    /// tearing down before the new one starts, so at most a sliver of time (never unbounded) has two
    /// pipelines alive against the shared <see cref="_transport"/>. If the old task is still stuck past
    /// this, the restart proceeds anyway (an exhibition demo must never hang on Register/Scenario) —
    /// the identity guard in <see cref="StartLocked"/>'s catch handler is what actually prevents the
    /// stale task from corrupting shared state whenever it does eventually finish.</summary>
    private static readonly TimeSpan RestartTeardownTimeout = TimeSpan.FromSeconds(3);

    /// <summary>SM-3 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-3-brief.md)
    /// — deliberately BLANK, not a URL. The old value here (<c>"http://localhost:5000"</c>) LOOKED like
    /// real configuration but was actually guaranteed to fail on every install that never overrode it —
    /// a real ST4I ecosystem server is never running on an edge box's own loopback address by default,
    /// so every fresh product install got a permanently-failing connection check dressed up as a typo'd
    /// config. Blank is what makes "no ecosystem configured" a genuine, honest, non-crashing product
    /// default: a customer who never connects to anything (a fully legitimate way to own this product —
    /// see SM-1's empty-roster-is-first-class decision) gets a working standalone product.
    /// <c>web/src/lib/api.ts</c>'s <c>useEcosystemConnection</c> now reads an empty <c>serverUrl</c> as
    /// its own named <c>"standalone"</c> status — a complete, non-alarming state — never as a failure
    /// requiring a blocking form. <see cref="St4i.EdgeCore.Transport.LiveTransport.ForMachine"/>'s own
    /// substitution guard is what keeps this blank value from ever reaching the vendored
    /// <c>St4iDeviceClient</c> ctor's "serverUrl is required" throw (see that method's own remarks) — this
    /// class never needs to know about that; it just stores/reports the honest, possibly-empty value.</summary>
    public const string DefaultServerUrl = "";
    public const string DefaultMachineCode = "ENGINE-API-01";
    public const string DefaultLanguage = "vi";

    /// <summary>🔴 E-2 — THE fleet-state lock: after the cut it is the only lock ACROSS the cut, i.e. the
    /// only one <c>FleetHost</c> could have ended up needing. 🔴 <b>Whole-branch review M3 — it is not the only
    /// lock in this class.</b> <see cref="_kpiGate"/> is declared 49 lines below and guards the KPI counters;
    /// the reviewer walked both and confirmed there is <b>no nesting hazard</b> (nothing takes one while
    /// holding the other), so the sentence was wrong, not the locking — but it is this class's lock-discipline
    /// banner, and a banner that overstates is how the next reader stops checking.
    /// 🔴 <b>J-1b branch review, Minor 16 — and it is the same defect one layer in, in the repair itself.</b>
    /// Two numbers above were wrong: the distance was <b>29</b> and is <b>49</b> (650 → 699), and, worse, this
    /// class holds <b>THREE</b> lock objects, not two — <see cref="_seedNotifyGate"/> is the third and the
    /// paragraph written to punish an understated set understated it again. It IS disclosed elsewhere (it has
    /// its own doc comment and the lock-order set below excludes it deliberately and by name), so nothing was
    /// hidden; what failed is that a repair naming "the other lock" stopped counting at the one the finding
    /// handed it — §8.1(f)'s scope-from-the-critique, in the fix for a scope complaint. Counted here rather
    /// than recalled: <c>private readonly object</c> declarations in this file are <c>_gate</c> (650),
    /// <c>_kpiGate</c> (699), <c>_seedNotifyGate</c> (963).
    /// <c>FleetHost</c> takes no lock of its own and never re-derives a pair of gate-protected fields from
    /// two calls; every member that used to read two such fields in ONE acquisition
    /// (<see cref="GetSafetyStatus"/>, <see cref="ReadSnapshot"/>, <see cref="GetSettings"/>,
    /// <see cref="Start"/>/<see cref="Stop"/>'s was-running comparison, <see cref="RegisterMachine"/>,
    /// <see cref="ApplyScenario"/>) moved DOWN here whole. E-1 §3.2 enumerated two possible shapes for the
    /// cut and judged both bad — core-owns-the-gate with the shell reading through it twice (the pair stops
    /// being atomic), or a lock on each side (a real ordering, and a deadlock the moment the core ever calls
    /// back out under its own lock). The shape used here is the third one: <b>one lock, and — 🔴 corrected by
    /// the whole-branch review (I2) — exactly TWO paired reads left on the far side of the cut, both
    /// LABELLED at their own declaration</b> (<c>FleetHost.CurrentScenarioDto</c>, found by the E-2 review;
    /// <c>FleetHost.MachineDetail</c>, found by the whole-branch review). This banner claimed there were
    /// none. Neither is a regression — both pairs were two unsynchronised reads before the cut as well — but
    /// a banner that says "none" is what stops the next reader counting. That is not a refinement of E-1's
    /// finding — it is what
    /// "GetSafetyStatus must move WITH _gate" means once the same test is applied to every OTHER paired read.
    ///
    /// <para><b>The invariant this lock carries, and its honest state.</b> Blueprint §5 says nothing may
    /// dispose or perform I/O while holding it. §9.2 records that this was ALREADY FALSE before Đợt E; E-2
    /// was a MOVE and deliberately did not fix it, only proved it no worse.
    ///
    /// 🔴 <b>G-1 rebuilt the SET rather than inheriting the list, and the inherited list was short.</b> The
    /// instrument was a reachability walk from all twenty <c>lock (_gate)</c> regions <b>that existed when
    /// G-1 ran it</b> through their callees,
    /// asking of each "can this reach I/O, <c>Dispose</c> or <c>Cancel</c>" — <b>not</b> a count of
    /// host-supplied code points and not a lexical scan of <c>lock</c> bodies (a lexical scan is precisely
    /// what once reported this invariant intact while it was broken three ways; a host-callback census is
    /// the narrower instrument §8.1(a3) names).
    ///
    /// <para>🔴 <b>J-1b — THAT NUMBER IS NOW HISTORICAL, AND THIS BRANCH IS WHAT MADE IT SO. Counted, not
    /// recalled: twenty code-site <c>lock (_gate)</c> regions at this branch's base <c>0dcc2594</c>,
    /// TWENTY-ONE after J-1b's pre-check in <see cref="RebuildPipelineOffLock"/>, and <b>TWENTY-TWO
    /// here</b> — U-1 added the fault-report region in that same method's <c>catch</c>.</b>
    /// The instrument's RESULT is unaffected — neither new region reaches I/O, a
    /// <c>Dispose</c> or a <c>Cancel</c> (J-1b's reads two fields; U-1's reads one and writes one), so the
    /// set below is still the same nine paths and still 3/2/4, and neither takes another lock while held, so
    /// the five-lock ordering set further down gains no member — but anyone RE-DERIVING the set must walk
    /// twenty-two regions, not twenty, and would otherwise stop short of the newest ones.
    /// This is the widened §8.1(h) firing on the branch that widened it: a sentence
    /// true at the base commit, falsified by the diff, in the same banner that diff edits. Its past tense
    /// ("the instrument WAS") is a partial defence and was not enough; a count that a reader may re-run has
    /// to say WHEN it was taken.</para></para>
    ///
    /// <para><b>🔴 THE SET IS NINE PATHS, LABELLED P1…P9. Numbered once, in every status together, so the
    /// headline number and the list are the same object.</b> (🔴 Fix round 1, review Minor 4: this sentence
    /// read "closed and open together" until J-1 introduced a third status and left the two-status wording
    /// standing — the repair was additive, so the defective sentence survived UNDER the correct tally. That
    /// is the same shape one layer down, and the fix is to say "in every status" rather than to enumerate
    /// two of three.)
    ///
    /// <b>🔴 THE TALLY, because J-1 introduced a THIRD status and a two-status headline over a
    /// three-status list is this branch's signature defect.</b> <b>3 CLOSED</b> (P1, P2, P3) —
    /// <b>2 NARROWED</b> (P4, P5) — <b>4 OPEN</b> (P6, P7, P8, P9). 3 + 2 + 4 = 9, and every row below
    /// carries its own status word so the two are re-derivable from each other in either direction.
    ///
    /// <b>NARROWED is a real status and not a softer word for CLOSED.</b> It means: the path no longer runs
    /// under this lock on an uncontended start — which is every start a single operator makes — but it is
    /// still REACHABLE under it, on a named arm, and that arm is live code with a test driving it. A path
    /// stops being counted only when nothing can reach it. So <b>the number of paths that can reach I/O
    /// under this lock is still NINE, and the number CLOSED is still THREE</b>: J-1 moved work off the lock
    /// without removing a member from this set, and the earlier draft of this banner that let the tally read
    /// as "five closed" was corrected before it shipped. Why NARROWED could not be CLOSED — <b>every shape
    /// FOUND trades into a category the owner reserved</b> — is argued at P5 and in J-1's report, not
    /// decided here.
    ///
    /// (🔴 Fix round 2. That clause read "it needs EITHER a new way for a start to FAIL OR a way to FREEZE
    /// the roster, both public contract changes" — an exhaustive disjunction, and review had already found
    /// the third shape it excludes. The retraction was written at P5 and this copy, 200 lines above it,
    /// was not: the repair took its domain from the ONE LINE the finding cited instead of from the property
    /// <i>any sentence asserting what closing P4/P5 requires</i>. §8.1(f), vocabulary half, <b>third
    /// instance in this one task</b> and structurally identical to the additive-repair shape fixed one
    /// round earlier. The sweep that closed it greps the two phrases the claim is made of rather than the
    /// line number, and returns exactly two hits in <c>src/</c>: the assertion and its own retraction.
    /// A claim about a SEARCH can absorb a new finding; a claim about a UNIVERSE has to be retracted, and
    /// retracting it in one of two places is how it survives.)
    ///
    /// <para>🔴 <b>The P-labels are the same repair the S-list below got, applied for the same reason.</b>
    /// This list was identified purely by ORDINAL and cross-referenced from a dozen sites under several
    /// spellings — <i>"path N"</i> here, <i>"item N"</i> in the tests and the gate script, and <i>"path B"</i>
    /// (G-1's letter vocabulary) at <see cref="RegisterMachine"/>. No contradiction had surfaced yet, but an
    /// ordinal-only vocabulary is exactly what let the S-list's rows 4 and 5 transpose silently.
    ///
    /// <b>Every cross-reference to this list in this repository now uses its P-label</b>, including the ones
    /// embedded in this banner's own prose ("P1 to P3", "P4 to P7", "P8 and P9"). <b>Three deliberate
    /// exceptions, named so they are not mistaken for residue:</b> the two sentences immediately above and
    /// below, which quote the historical spellings in order to retire them; the parenthetical at
    /// <see cref="RegisterMachine"/> that glosses G-1's "path B"; and two exception-MESSAGE literals in
    /// <c>FleetHostGateCommitCompletionTests</c> that keep "item 5" because converting them would make a
    /// comment-only change executable (the reason is recorded at that site).
    ///
    /// 🔴 <b>This paragraph previously claimed "every call site in this tree has been converted", and that was
    /// FALSE when written</b> — six cross-references were unconverted, and <b>P8 had not been converted
    /// anywhere</b>, so the branch had not ended a two-vocabulary state but created a member-dependent one,
    /// which is worse. The cause is the rule this same banner promotes: the sweep's domain was inherited from
    /// the EXAMPLE the finding used (P5) instead of derived from the property (<i>any ordinal cross-reference
    /// to this list</i>). §8.1(f), of the vocabulary kind, in the change that promotes §8.1(f). Found by
    /// review; the falsifying grep was the same one that performed the rename.
    ///
    /// 🔴 <b>AND THE TOKEN "P&lt;n&gt;" IS NOT UNIQUE IN THIS REPOSITORY — named, not fixed.</b> Found while
    /// verifying the sweep above, by asking the question the sweep should have asked first: <i>is this label
    /// free?</i> <b>Four senses of <c>P&lt;n&gt;</c> coexist here</b>, counted rather than characterised:
    /// <b>36</b> .NET percentage format specifiers (<c>ToString("P1")</c>, <c>{x:P1}</c> — <c>P1</c> meaning
    /// "percent, one decimal"); <b>34</b> project-phase tags (<c>P2-1</c>, <c>P2-3</c>); one phase RANGE at
    /// <see cref="St4i.Connector.Abstractions.IDeviceDriver"/> (<i>"P3-P5 drivers"</i>, meaning phases, not
    /// paths); and these labels. A reader grepping <c>P5</c> gets this list AND a driver-phase range.
    ///
    /// 🔴 The first version of this paragraph called the format specifiers <i>"a product-code string
    /// literal"</i>. That was simply WRONG, and they are the most numerous of the four — I characterised them
    /// from their shape in a grep result instead of opening two of them, which is §8.1(f) one notch smaller,
    /// inside the note written to record §8.1(f). Corrected by review.
    ///
    /// Kept anyway, and the reasoning is the one this branch has used throughout: no reader is given a WRONG
    /// answer — the two senses are trivially distinguishable in context — so the cost is friction, not error,
    /// and renaming nine labels plus every cross-reference at merge time buys less than it risks. <b>What
    /// would NOT have been acceptable is shipping the completeness claim above while this was unexamined</b>,
    /// which is what "every call site has been converted" did the first time. If this list is ever renamed,
    /// <c>L1…L9</c> ("lock path") is free today.</para> (G-1's first draft said "eight" and no grouping of its own list
    /// produced eight — a headline that cannot be reconstructed from the enumeration it summarises is a
    /// defect in the deliverable, since the enumeration IS the deliverable. Corrected by review.)
    ///
    /// <b>🔴 THE NINE, IN ONE LIST, EACH ROW CARRYING ITS OWN STATUS.</b> (Fix round 1, review Minor 4: this
    /// heading read "Closed by G-1 — P1 to P3" and the whole nine-item list hung beneath it, so the list's
    /// heading described its first three rows only. P1 to P3 remain the three G-1 closed, and they are still
    /// the only three that are CLOSED — that fact now lives on the rows, which is where a reader who
    /// reorders the list will keep it.)
    /// <list type="number">
    /// <item><b>P1 — CLOSED.</b> <see cref="RegisterMachine"/>'s <see cref="_onMachineSeeded"/> — §9.2 violation
    /// 3, the one with the number on it: for a real <c>AssetRegistryStore</c> a complete synchronous SQLite
    /// transaction, and a thread merely reading <see cref="EstopEngaged"/> (the SAME lock
    /// <see cref="Estop"/> takes) was measured blocked up to <b>12.35 ms</b>. Now enqueued under the lock
    /// and invoked off it — see <see cref="DrainSeedNotifications"/>.</item>
    /// <item><b>P2 — CLOSED.</b> Log calls under this lock — §10.3(a)'s fourth mechanism, ONE mechanism whose
    /// members are named rather than counted (a count here is what produced the "eight" this banner already
    /// records against itself): <see cref="StartLocked"/>'s connector warning; the two
    /// <c>MappingProfileResolver.Build</c> callback arms, at BOTH of that method's <c>Build</c> sites — the
    /// off-lock one in <see cref="BuildStartPlan"/> and the under-lock SUPPLEMENT inside
    /// <see cref="StartLocked"/>; and <see cref="StopLocked"/>'s cancellation-callback error. A host wires
    /// every one to its own <c>ILogger</c>, which under <c>AddWindowsService</c> is a SYNCHRONOUS Event Log
    /// write. All of them buffer into a <see cref="DeferredLogEntry"/> list and are emitted off-lock, and
    /// that — not the size of the list — is the row's claim.
    /// <para>🔴 <b>T-1 fix round 1 — this row said "FOUR call sites in one mechanism", which J-1 falsified
    /// and nobody re-derived: splitting the resolver <c>Build</c> into an off-lock one and an under-lock
    /// supplement doubled that half.</b> PRE-EXISTING, not T-1's — recorded because T-1's own report measured
    /// exactly this ("two halves is three producers") one line away from the row it falsifies and stopped
    /// short of it. The row's substantive claim was true throughout; only its scalar was not, which is why
    /// the scalar is gone rather than corrected.</para></item>
    /// <item><b>P3 — CLOSED.</b> <see cref="Burst"/>'s <c>previousCts?.Cancel()</c> — §10.3(d)'s second
    /// <c>Cancel</c>. Moved below the lock.</item>
    ///
    /// <item><b>P4 — NARROWED by J-1, NOT closed — in this class's own code, P4 to P7.</b>
    /// <see cref="StartLocked"/> → <c>MappingProfileResolver.Build</c> →
    /// <c>File.Exists</c>/<c>File.ReadAllText</c> per machine — §9.2 violation 1, measured <b>2.39 ms</b>
    /// held with 50 machines having mapping files on a local SSD. <b>🔴 That measurement is now historical
    /// and its instrument would report a different number: J-1 moved the <c>Build</c> to
    /// <see cref="BuildStartPlan"/>, off this lock.</b> What is left under the lock is a resolve for any
    /// descriptor the plan does not already cover — see the shared J-1 note under P5.</item>
    /// <item><b>P5 — NARROWED by J-1, NOT closed.</b> 🔴 <b>On no prior list, in any batch, and it is a
    /// WRITE.</b>
    /// <see cref="StartLocked"/> → <c>SimulatorFactory.Create</c> → <c>SimulatorBase</c>'s constructor →
    /// <c>MachineConfigStore.Ensure</c> → <c>Save()</c> → <c>File.WriteAllText</c> + <c>File.Move</c>. It
    /// fires once per machine that is not yet in the store, i.e. on the first <see cref="Start"/> against a
    /// fresh data root — and it takes a SECOND lock (<c>MachineConfigStore</c>'s own) while this one is
    /// held, on every start thereafter. Every previous count of this backlog was of READ paths. It is also
    /// the throw that made <see cref="RegisterMachine"/>'s drain need a <c>finally</c>.
    /// <para>🔴 <b>H-1c CHANGED WHAT THIS PATH CAN REACH, without touching a line of it — disclosed here
    /// because no task-scoped review could see it (whole-branch review I-6).</b> H-1c gave
    /// <c>MachineConfigStore</c> a relocation seam, <c>ST4I_MACHINE_CONFIG_DIR</c>, and README §15.9 now
    /// tells operators they may set it. <b>Of the fourteen relocatable roots this product has, this is the
    /// only one whose store is written while <see cref="_gate"/> is held</b> — so it is the only variable
    /// whose value changes what happens under the fleet's global lock. Point it at
    /// a UNC share and the write above becomes a NETWORK filesystem write, plus a
    /// second lock, inside the lock <see cref="Estop"/> takes. P4 immediately above is explicitly qualified
    /// "on a local SSD"; P5 carries no such qualifier because until H-1c its root could not be anywhere
    /// else, and nobody has measured it on a share. Nothing here is a defect today — the default is
    /// unchanged and beside the binary — but a redesign of this chokepoint must treat the root as
    /// arbitrary rather than local.</para>
    /// <para>🔴 <b>BOOKED FOR P5, not charged to any task: the product now holds TWO DELIBERATE AND
    /// OPPOSITE POSTURES on an env-var-driven startup failure, and nothing reconciles them.</b> H-1a
    /// ruled that a settings root the operator can point anywhere must let the host COME UP AND SAY SO —
    /// that is the whole of S6's closure. WS-C ruled the opposite for the WAL root, in as many words at
    /// <c>St4i.EngineApi/Program.cs</c>'s <c>wal.EnsureDir()</c>: <i>"a WAL root that can't be created is
    /// a fatal misconfiguration that should stop startup, not silently downgrade"</i> — unguarded, before
    /// <c>app.Run()</c>, with no operator-facing line, on a variable README §15.9's own recipe tells
    /// operators to set. Both rulings are defensible on their own terms and neither is a defect. What
    /// does not exist is a sentence anywhere saying WHICH roots crash the host and which do not, so an
    /// operator relocating two directories in one afternoon gets two different failure semantics with no
    /// way to predict either. Surfaced by H-1c's own measurement of the WAL path; it needs one owner and
    /// one artefact, and that owner is whoever takes P5.</para>
    /// <para>🔴 <b>DISCHARGED by task J-3, and the answer was that the two rulings never disagreed.</b> The
    /// artefact is <c>docs/startup-failure-posture.md</c>; README §15.9 carries the operator-facing half,
    /// and the same rule is stated at each deciding site — <c>St4i.EngineApi/Program.cs</c>'s
    /// <c>wal.EnsureDir()</c>, its startup settings replay, and
    /// <see cref="St4i.EdgeCore.Transport.WalOptions.EnsureDir"/> for the two hosts that reach the ruling
    /// only through it. The rule: <b>a host refuses to start over a bad configuration only when starting
    /// would be the QUIETER failure</b>, and <b>the test is one test</b> — would continuing HIDE the loss?
    /// WS-C's WAL ruling stops because an in-memory queue keeps acknowledging records that die with the
    /// process; H-1a's replay comes up because the failure is named and <see cref="GetSettings"/> goes on
    /// reporting the held triple truthfully.</para>
    /// <para>🔴 <b>The DOMAIN, stated here because this paragraph is the one a later P-owner reads and it is
    /// the likeliest origin of a re-scope.</b> The rule governs <b>startup-path configuration decisions</b> —
    /// every statement a composition root runs before its host serves, at which a value from outside the
    /// running program can fail and that statement decides whether the process continues. <b>It is not a rule
    /// about roots</b>, even though the item booked above asked about roots and even though this paragraph
    /// lives in the fleet register. Roughly a third of the set is roots; the rest is argument vectors, a bind
    /// address, map files, <c>connectors.json</c>, <c>fleet.json</c>, the product and ecosystem catalogues,
    /// persisted connector rows, a broker port, an ACL step, five <c>FromEnvironment</c> factories and the
    /// replay itself. 🔴 <b>The set is ENUMERATED, not counted</b> — an earlier round of J-3 staked a scalar
    /// in five places with the members recorded nowhere the tree could reach, and an independent
    /// re-derivation returned a different number and found two divergences the scalar had absorbed
    /// (<c>ProductConfigStore</c> and <c>SimulatedEcosystem</c>). Read the list, do not inherit a
    /// count.</para>
    /// <para><b>Nothing behavioural changed.</b> J-3 also enumerated the rest of the startup path and named
    /// the sites that diverge from the rule — a settings file read unguarded above its own guard, three arms
    /// of the identity store, two operator-editable catalogues, and a nine-site class of silent env-var parse
    /// failures — plus one symmetry defect that needs no rule at all. All are recorded in the artefact, none
    /// is touched, because flipping any of them is an operator-observable startup change.</para>
    /// <para>🔴 <b>WHAT J-1 DID TO P4 AND P5, stated once for both because it is one mechanism.</b> Driver
    /// construction is hoisted: <see cref="SnapshotStartInputsLocked"/> copies the roster, the multiplier and
    /// one binding snapshot under this lock; <see cref="BuildStartPlan"/> then builds every simulator and
    /// resolves every mapping profile <b>with the lock released</b>; <see cref="StartLocked"/> installs.
    /// <b>On an uncontended start — which is every start a single operator makes — neither path touches the
    /// filesystem while this lock is held, and <c>MachineConfigStore</c>'s lock is not taken under it.</b>
    ///
    /// <b>The label is NARROWED and not CLOSED, and the difference is one reachable arm.</b>
    /// <see cref="StartLocked"/> still derives the roster it installs from the LIVE <see cref="_fleet"/>, and
    /// consumes the plan only where the live input is identical — so a machine registered by another thread
    /// between the snapshot and the install is built RIGHT THERE, under this lock, at exactly the pre-J-1
    /// per-machine cost. That arm is live code, not a defensive branch:
    /// <c>FleetHostStartBuildHoistTests.AMachineRegisteredMidBuild_HasItsOwnMappingProfileResolvedByTheInstall</c>
    /// drives it. So the honest count of paths that can reach I/O under this lock is unchanged at NINE, and
    /// the count CLOSED is unchanged at three.
    ///
    /// <b>🔴 J-1b changes NEITHER of those two numbers and changes no label.</b> It adds a pre-check to
    /// <see cref="RebuildPipelineOffLock"/>, symmetric with <see cref="Start"/>'s: one reached CASE fewer for
    /// P4 and P5 — an <see cref="Estop"/> landing in a restart's teardown no longer buys a build that the
    /// latch is about to refuse — and nothing at all about whether those paths can reach I/O under this lock,
    /// which is what the label measures. P4 and P5 stay NARROWED. The case that sounds like the point of such
    /// a check and is not covered by it, because it never needed to be: a
    /// <see cref="RegisterMachine"/>/<see cref="ApplyScenario"/> made while the latch is ALREADY engaged
    /// rebuilds nothing, since both callers rebuild only when <see cref="IsRunning"/> and a latched fleet is
    /// not running. Measured, not read.
    ///
    /// <b>Why the window is answered by exclusion rather than by detection.</b> The obvious hoist — snapshot,
    /// build, install the plan — loses a machine registered in that window <b>silently</b>: it is absent from
    /// the plan's simulator list, so nothing ever drives it, and the registering thread saw
    /// <c>IsRunning == false</c> and scheduled no restart of its own, so nothing comes back for it. (🔴 The
    /// paragraph below USED to describe that outcome as "silently degrades to <c>MappingProfile.ForClass</c>".
    /// That was wrong twice over and is corrected here: the machine is never simulated at all, so no profile
    /// is ever consulted for it; and the profile a reading with an unknown code WOULD fall back to is the
    /// group's shared <c>fleet-mixed</c> one — <see cref="EdgePipeline"/>'s <c>?? _profile</c> — not
    /// <c>ForClass</c>, which is <c>MappingProfileResolver</c>'s own fallback for a descriptor it DID see.
    /// Measured by mutation, not read: with the reuse-or-build loop replaced by the plan's list verbatim, the
    /// test above fails on <c>Cycles == 0</c>, i.e. on never being driven.) Treating the plan as a cache
    /// rather than a substitute removes that state instead of reporting it — there is no interleaving in
    /// which this method installs a pipeline that disagrees with the roster, so there is nothing to
    /// detect.</para></item>
    /// <item><b>P6 — OPEN.</b> <see cref="StopLocked"/> → <c>slot.Cts.Cancel()</c> → a driver's own
    /// <c>ct.Register</c> callback running a <c>Dispose</c> SYNCHRONOUSLY on this thread — §9.2 violation
    /// 2.</item>
    /// <item><b>P7 — OPEN.</b> <see cref="StartLocked"/> → <c>ConnectorRegistry.TryCreateDriver</c> → a
    /// THIRD-PARTY <c>IConnectorFactory.TryCreate</c>, which this codebase does not get to bound (documented
    /// at that call site as the one place third-party code runs under this lock, but never on the backlog
    /// list).</item>
    ///
    /// <item><b>P8 — OPEN — in a CALLEE's code, P8 and P9, and not fixable from this class.</b>
    /// <see cref="Start"/>/<see cref="Stop"/>/<see cref="Estop"/> hold this lock across
    /// <see cref="IUnsPublisher.PublishNodeBirth"/>/<see cref="IUnsPublisher.PublishNodeDeath"/>, whose
    /// degraded arms (publisher disposed, publish queue saturated) call the PUBLISHER's own host-supplied
    /// log callback. 🔴 The field is <see cref="IUnsPublisher"/>, not the concrete <c>UnsPublisher</c>, so
    /// this is a property of the SEAM: any host implementation's two methods run under this lock, and the
    /// interface's "non-blocking, never throws" wording is a promise, not a bound. A fifth log-under-lock
    /// path that §10.3(a)'s count could not see, because it counted <c>_logger?.</c> sites inside this file
    /// rather than walking callees. Deliberately left: keeping those two calls inside this lock is an
    /// explicit review fix (it serializes NBIRTH/NDEATH order with the transition itself), so the fix
    /// belongs behind the seam, not here.</item>
    /// <item><b>P9 — OPEN — in a callee's code.</b> <see cref="GetDriverHealth"/> reads <c>Driver.Kind</c> and
    /// <c>Driver.Health</c> under this lock — third-party property getters on
    /// <see cref="St4i.Connector.Abstractions.IDeviceDriver"/>, bounded by contract only.</item>
    /// </list></para>
    ///
    /// <para><b>Where the nine came from.</b> The inherited backlog named <b>five</b> — §9.2's three
    /// violations (P1, P4, P6 here) plus §10.3(a)'s log mechanism (P2) and §10.3(d)'s second <c>Cancel</c>
    /// (P3). P7 was documented at its own call site but never on that list. <b>P5, P8 and P9 were on no
    /// list anywhere</b>. 5 + 1 + 3 = 9.</para>
    ///
    /// <para><b>🔴 Why P4 to P7 did not move, as G-1 and G-2 left it — and what J-1 changed.</b> The
    /// paragraph that stood here said P4 and P5 live in the same place and have the same fix (hoist driver
    /// construction out of <see cref="StartLocked"/> entirely), that doing so means reading
    /// <see cref="_fleet"/>/<see cref="_scenario"/> under the lock, building off it and re-entering, and that
    /// this "introduces a roster-changed-underneath window this class has no answer for today". <b>J-1 did
    /// the hoist and the class now has an answer</b>: the plan is a CACHE consulted by an install that still
    /// reads the live roster, so the window is excluded rather than merely narrowed. See the J-1 note under
    /// P5 for the mechanism, for the label it earns (NARROWED, not CLOSED) and for the correction to that
    /// paragraph's description of what the window actually cost.
    ///
    /// <b>P6 and P7 are untouched by J-1 and the reasons are unchanged.</b> P6 would move the halt path's
    /// cancel request after the latch — an operator-observable ordering change on the safety path. P7 is
    /// third-party code (<c>ConnectorRegistry.TryCreateDriver</c> → <c>IConnectorFactory.TryCreate</c>) and
    /// J-1 deliberately left it where it was: hoisting it would let a factory open a socket or lease a serial
    /// port for a start the HALT latch is about to refuse, and would widen the gap between "which machines
    /// are excluded from simulation" and "which connector slots get built" from microseconds to the whole
    /// build — the double-drive that corrupts per-machine cycles, and therefore fleet KPI/OEE/FPY, with
    /// nothing red. Both remain reserved rather than delegated.</para>
    ///
    /// <para><b>🔴 A DIFFERENT AXIS, recorded here because nobody had written it down: this lock is held
    /// across FIVE other locks.</b> None of these is an I/O/<c>Dispose</c>/<c>Cancel</c> violation, so none
    /// belongs in the nine — but "which lock may be taken while holding this one" is its own invariant and
    /// it had no home. In acquisition order, always <see cref="_gate"/> first:
    /// <c>MachineConfigStore</c>'s own lock (P5 — 🔴 <b>J-1 did NOT remove this member, and it was expected
    /// to.</b> On the uncontended path it is no longer taken under this lock at all, because
    /// <see cref="BuildStartPlan"/> constructs every simulator off it. But the install's per-machine
    /// reuse-or-build arm reaches <c>SimulatorFactory.Create</c> for a descriptor the plan does not cover, so
    /// the acquisition remains REACHABLE and the ordering pair therefore still exists. A set member is about
    /// reachability, not frequency: removing it needs an install that can never build.
    /// <b>🔴 Fix round 1 (review I-3) — the sentence here USED to say that needs "either a new way for a
    /// start to fail or a way to freeze the roster", and that disjunction was a FALSE UNIVERSAL of exactly
    /// the kind this banner exists to catch.</b> Review found a fifth shape and it is neither: install the
    /// plan verbatim and make the start's own OFF-LOCK EPILOGUE owe a follow-up rebuild whenever the roster
    /// moved during the build — P1's own commit-under-lock/complete-off-lock pattern, applied to the roster
    /// instead of to a notification. It buys an extra operator-observable pipeline restart per lost race,
    /// and under a repeating registrant it degenerates into the unbounded-retry livelock; bounding it puts
    /// the build back under the lock, i.e. back here. So the honest sentence is <b>every shape FOUND trades
    /// into a category the owner reserved</b> — a statement about a search, which can be extended — not an
    /// exhaustive disjunction, which cannot. The verdict is unchanged and the label stays NARROWED.
    /// <b>The set is still FIVE.</b>);
    /// <c>TransportCoordinator</c>'s and
    /// <c>SwitchableTransport</c>'s (via <see cref="ApplyNetworkOutageLocked"/>);
    /// <see cref="ConnectorRegistry"/>'s (🔴 <b>branch review, Minor — <c>TryCreateDriver</c> ONLY.</b> This
    /// read "<c>SnapshotBindings</c>/<c>RegisteredIds</c>/<c>TryCreateDriver</c>" and the first two take no
    /// lock at all: <c>RegisteredIds</c> is <c>_entries.Keys.ToList()</c> and <c>SnapshotBindings</c>
    /// enumerates the same <see cref="ConcurrentDictionary{TKey,TValue}"/>, both lock-free by construction —
    /// which is precisely why <c>SnapshotBindings</c>' own doc argues for one CONSISTENT snapshot rather
    /// than a fresh one. Naming two lock-free reads as lock acquisitions overstates the set in the direction
    /// that makes a reader stop checking, the same failure mode as the "none" this banner already
    /// records. The ordering pair is real and stays — <c>_registerGate</c> is taken by
    /// <c>TryCreateDriver</c> under <see cref="_gate"/> in the connector loop — so the set is unchanged at
    /// FIVE; only its justification is now accurate); and the UNS publisher's own lifecycle lock (via
    /// <see cref="IUnsPublisher.PublishNodeBirth"/>/<see cref="IUnsPublisher.PublishNodeDeath"/>). None
    /// inverts today. <see cref="_seedNotifyGate"/> is deliberately NOT in this list and must never join it —
    /// see its own doc comment for the order that genuinely exists there and what keeps it one-way.
    ///
    /// One of these is quieter than it looks: <see cref="ApplyNetworkOutageLocked"/> reaches
    /// <c>TransportCoordinator.ApplyMode</c>, which ends in <c>ModeChanged?.Invoke(mode)</c> — a
    /// HOST-SUBSCRIBED event, i.e. arbitrary code, under this lock. It is dormant only because this call site
    /// passes the coordinator's CURRENT mode, so <c>changed</c> is always false and the event never fires.
    /// That is "benign by a property of the current call site", which is the exact sentence pattern the rest
    /// of this banner warns about — stated plainly rather than relied on silently.</para>
    ///
    /// <para><b>🔴 A THIRD AXIS — G-2. "What runs under this lock" and "what is COMMITTED under it and
    /// finished after it" are different questions, and the nine above answer only the first.</b> The class:
    /// state written while <see cref="_gate"/> is held, never rolled back, whose correctness depends on a step
    /// that runs after the lock is released — exposed to every throw in between. G-1 found one instance
    /// (<see cref="RegisterMachine"/>'s seed notification) and said plainly that it had NOT swept for
    /// siblings. This is the axis, not the count: nothing here overlaps the nine, because none of these paths
    /// is about reaching I/O under the lock.
    ///
    /// <b>EIGHT (commit, completion) PAIRS IN SEVEN ROWS, and the two numbers are reconciled here rather than
    /// made to agree.</b> The unit of this class is a <b>(commit, completion) pair</b> — that is the rule item
    /// 7 established and review C-1 vindicated: one commit can owe more than one off-lock completion, and each
    /// is separately losable. Apply that rule and you count <b>eight</b>. The list below has <b>seven rows</b>
    /// because <b>S2 carries two pairs in one row</b> (the halt teardown and the halt run event) while item
    /// 7 is a row of its own.
    ///
    /// <b>That asymmetry is historical, not principled, and it is kept deliberately.</b> S7 was found
    /// first, as a separate member; finding it is what produced S2's second pair a round later. Folding 7
    /// into 3 — or splitting 2 into two rows — would renumber a vocabulary (S1…S7) that this branch's report,
    /// its tests and its ledger all speak. So: <b>a reader deriving the set from the rule should expect eight
    /// pairs and find seven rows, and <b>S2</b> is where the extra pair lives.</b> Round 2 of review was right
    /// that "SEVEN" alone was not re-derivable.
    ///
    /// (Round 1 of G-2 said "the sweep found six more" over a list of five — a count contradicted by the list
    /// beneath it, which is the exact defect the commit BELOW this branch's base was written to fix, and which
    /// G-2's own report claimed to have caught in its commit message while leaving it here. Corrected by
    /// review. The sweep found FIVE more; re-deriving the set added a sixth, S7, which the sweep's
    /// single-completion table could not represent.)
    /// 🔴 <b>EVERY ROW CARRIES ITS S-NUMBER, and that is a repair rather than a decoration.</b> Rows 4 and 5
    /// were TRANSPOSED here — position 4 held <see cref="Burst"/> (S5 everywhere else) and position 5 held the
    /// restart chokepoint (S4 everywhere else) — while this same banner declared itself the S1…S7 vocabulary.
    /// The status labels travelled with the CONTENT, so nothing looked wrong; a maintainer resolving "what is
    /// S4?" from the canonical definition got the inverse of what the tests, the gate script, the report and
    /// the ledger mean, and one downstream artifact had already derived a false statement from it. Caught by
    /// the whole-branch review. <b>Identifying a member by its ORDINAL is what made a silent swap possible;
    /// the labels below are what make the next one visible.</b> If you reorder these rows, the labels move
    /// with them and nothing breaks — which is the point.
    /// <list type="number">
    /// <item><b>S1 — CLOSED (G-1).</b> The seed-notification queue — commit
    /// <see cref="EnqueueSeedNotification"/>, completion <see cref="DrainSeedNotifications"/>.</item>
    /// <item><b>S2 — CLOSED (G-2).</b> <see cref="Stop"/>/<see cref="Estop"/> → <see cref="StopLocked"/> →
    /// BOTH completions it owes: <see cref="WaitAndDisposeOldPipeline"/> and the historian run event. The run
    /// event needed a second round (review C-1) — round 1 guaranteed the teardown and left the run event
    /// exposed to this member's own throw site, which inflates OEE Availability.</item>
    /// <item><b>S3 — CLOSED (G-2).</b> <see cref="Start"/> → <see cref="StartLocked"/> →
    /// <see cref="CompleteStartOffLock"/> — <b>with a residual, named rather than swept: see the
    /// "S3's residual" note directly below this list. OPEN: (4) and (5), both engineering, both carried.
    /// CLOSED: (1) and (2) by J-2, (3) by T-1 on the owner's ruling.</b> Membership, not a tally — this row
    /// has produced two false summaries already (branch review Minor 1 conflated "open" with "owner
    /// decision"; the count it replaced went stale the moment a member moved), and a list of names cannot go
    /// stale in a way its own members contradict.</item>
    /// <item><b>S4 — PARTLY OPEN as an S-SET ROW; its OWNER DECISION is CLOSED (U-1). The two are different
    /// questions and this row is where they were most likely to be conflated.</b> The restart chokepoint.
    /// The rebuild is now unconditional over an
    /// off-lock TEARDOWN that throws (<see cref="RegisterMachine"/>/<see cref="ApplyScenario"/>), but a
    /// <see cref="StartLocked"/> that throws ITSELF leaves the fleet stopped with the roster/scenario write
    /// already committed, and no <c>finally</c> can start a fleet that failed to start. Rolling the commit
    /// back changes what a failed call MEANS to its caller; the root cause is P5 above. Both are owner
    /// decisions and both are named in G-2's report rather than decided here.
    /// <para>🔴 <b>J-1 moved that throw and did NOT close this half — recorded because "the root cause is
    /// P5" now points somewhere else.</b> P5's throw (<c>MachineConfigStore.Ensure</c>'s
    /// <c>InvalidOperationException</c> on a config-kind mismatch, <c>IOException</c> from its write) now
    /// fires inside <see cref="BuildStartPlan"/>, i.e. off this lock and BEFORE any slot exists — so it can
    /// no longer leave <see cref="_slots"/> half-populated. It still fires inside the same <c>finally</c>
    /// that owes the rebuild, so the fleet is still left stopped with the roster/scenario write committed.
    /// The blast radius shrank; the decision did not move. Closing it means building the new pipeline BEFORE
    /// tearing the old one down, which reverses the restart order an operator observes — exactly the class
    /// of change this branch reserves.</para>
    /// <para>🔴 <b>J-2 re-derived both of those claims instead of inheriting them. Both stand; the FIRST is
    /// also INCOMPLETE, and that matters because it is the one a reader would try to act on.</b>
    /// <list type="bullet">
    /// <item><b>"Build before tearing down" is NECESSARY AND NOT SUFFICIENT.</b> Reordering keeps the fleet
    /// up when <see cref="BuildStartPlan"/> throws — but <see cref="StartLocked"/> can throw too (see S3's
    /// residual (4)), and by then the old pipeline is gone whichever order the two ran in. Fully closing this
    /// half additionally needs an install that either completes or restores the pipeline it replaced, i.e. a
    /// transactional teardown, and the old slots have already been cancelled and disposed by that point. So
    /// the reserved change is strictly larger than the sentence above describes. The ordering claim itself
    /// holds on its own terms — an operator observes the pipeline stop, then the build's file I/O, then the
    /// pipeline start, and reordering moves what they see.
    /// <para>🔴 <b>Review I-2 — AND THE ADDENDUM THAT STOOD HERE DID NOT FOLLOW, so it is withdrawn rather
    /// than softened.</b> It argued that with the build hoisted ahead of the teardown,
    /// <c>MachineConfigStore.Ensure</c>'s writes would land while the old pipeline was still live and a
    /// config-aware simulator re-resolving EVERY CYCLE would therefore "observe the next fleet's
    /// configuration mid-restart". The write lands; the observation does not follow. <c>Ensure</c> NEVER
    /// modifies an existing record — for a machine already in the store it returns a deep clone of what is
    /// there (and throws on a config-kind mismatch), and it writes only when SEEDING a machine that has no
    /// record, which by construction is not a machine any live simulator is running. So no running machine's
    /// resolved config changes, and the per-cycle re-resolution has nothing new to see. I reasoned from "a
    /// write happens" to "a reader sees it" without opening the writer — the (a3) shape, in the sentence I
    /// added to strengthen a claim that did not need it.</para></item>
    /// <item><b>"Rolling the commit back changes what a failed call MEANS" holds, and the two concrete
    /// reasons are better than the general one.</b> (a) <c>_fleet</c> is APPEND-ONLY by documented invariant
    /// and the roster is PUBLICLY VISIBLE throughout this window — the lock is released across the whole
    /// teardown and build, so <c>GET /v1/fleet</c> <b>can</b> have reported the machine a rollback would
    /// remove. (🔴 Review Minor: this said <i>"has already reported"</i>, which asserts a READ where the
    /// premise establishes only VISIBILITY. The rollback is unsound whether or not anyone happened to look —
    /// overclaiming it invites the reply "prove someone read it" and loses an argument that does not need
    /// the read.) (b) <see cref="RegisterMachine"/>'s seed notification is delivered by the
    /// <see cref="DrainSeedNotifications"/> in its outer <c>finally</c>, which runs AFTER the rebuild throws
    /// — so a rollback would leave a durable asset row for a machine no longer in the roster. For
    /// <see cref="ApplyScenario"/> the same argument runs through <see cref="ApplyNetworkOutageLocked"/>'s
    /// transport swap and through <see cref="Burst"/>'s revert baseline, which is captured from the
    /// pre-burst scenario. Owner decision, unchanged, and now argued from mechanisms rather than from
    /// "meaning".</item>
    /// </list></para>
    /// <para>🔴 <b>U-1 — THE OWNER RULED, AND THE RULING IS NOT EITHER OF THE TWO OPTIONS ABOVE.</b>
    /// (<c>docs/owner-decisions.md</c> item 7.) <b>The decided state: the fleet stays STOPPED, the commit
    /// STANDS, and the failure is RECORDED on <see cref="LastError"/></b> — the field <c>GET /v1/health</c>
    /// answers from — by <see cref="RebuildPipelineOffLock"/>'s <c>catch</c>, which every one of the three
    /// entry paths reaches. See that <c>catch</c> for the mechanism, the identity guard and the price.
    /// <list type="bullet">
    /// <item><b>Why not "build before tearing down".</b> J-2's bullet above is the reason and it was
    /// re-derived rather than inherited: it is NECESSARY AND NOT SUFFICIENT, and sufficiency here would need
    /// an install that restores the pipeline it replaced — the old slots are cancelled and disposed by then,
    /// so there is nothing to restore. Taking it alone would buy an operator-observable ordering change for
    /// a fix that leaves the state this item exists to end.</item>
    /// <item><b>Why not rolling the commit back.</b> The two mechanisms in J-2's second bullet still hold,
    /// and a third decides it: <b>a rollback does not bring the pipeline back.</b> Even a perfect one leaves
    /// the fleet stopped, which is the half an operator actually has to act on — so a rollback buys agreement
    /// between a stopped fleet and its configuration and leaves untouched the thing an operator must respond
    /// to. It is also not one statement: for <see cref="ApplyScenario"/> it would have to unwind
    /// <see cref="ApplyNetworkOutageLocked"/>'s transport swap as well, and the five-lock note above records
    /// that that path reaches <c>TransportCoordinator.ApplyMode</c> → <c>ModeChanged?.Invoke</c> — a
    /// HOST-SUBSCRIBED event, dormant <i>only</i> because the one existing call site passes the coordinator's
    /// CURRENT mode. A rollback would be a SECOND call site on a seam whose safety is a property of the first
    /// one, added on the failure path. 🔴 Stated as the seam it is and not as "a second throw site": nothing
    /// there throws today, and the banner's own rule is that "benign by a property of the current call site"
    /// gets said plainly rather than either relied on or overstated.</item>
    /// </list>
    /// <b>WHAT U-1 DOES NOT CLOSE, so the row keeps its status.</b> The S-set property is that a commit made
    /// under this lock owes a step after it; the commit still owes a pipeline it does not get, and no
    /// <c>finally</c> can start a fleet that failed to start. U-1 changed what an operator can LEARN about
    /// that state, not the state. <b>Where the fleet and its record still diverge, named with reasons rather
    /// than left to be rediscovered:</b> <see cref="_scenario"/>/<see cref="_activePresetName"/> hold a
    /// scenario no pipeline is applying (they are CONFIGURATION — what the next start will use — and
    /// <see cref="IsRunning"/> already says no pipeline is applying it); <see cref="_fleet"/> holds the new
    /// machine (append-only by invariant, and its durable asset row is delivered by
    /// <see cref="RegisterMachine"/>'s outer <c>finally</c> AFTER the rebuild throws, so a rollback would
    /// orphan it); and <c>machine-operating-config.json</c> may hold records for the machines
    /// <see cref="BuildStartPlan"/> got through before the throw (<c>MachineConfigStore.Ensure</c> only ever
    /// SEEDS — it never modifies an existing record — so those are exactly what the next start would write,
    /// which is why they are named rather than cleaned up).</para></item>
    /// <item><b>S5 — CLOSED (G-2).</b> <see cref="Burst"/> → <see cref="RevertBurstAfterDelayAsync"/>.</item>
    /// <item><b>S6 — CLOSED (H-1a), and HOW it closed is the part worth carrying.</b>
    /// <see cref="UpdateSettings"/>'s committed triple versus its off-lock activation and persistence. G-2
    /// refused the uniform <c>finally</c> here and was right to: <c>Program.cs</c> replayed the persisted
    /// triple back into this same method during startup, UNWRAPPED, so persisting a triple that could not be
    /// activated converted "the edit evaporates at the next restart" into "the service does not start".
    /// H-1a hardened that replay FIRST — it is guarded and logs at Error — and only then made the
    /// persistence unconditional. <b>The order is the fix; reversing it ships the
    /// boot loop.</b> What closed is the S-set property (the commit's persistence is now unconditional, so
    /// the reported and persisted configurations cannot diverge). What did NOT close, and is not claimed:
    /// within one process a failed activation still leaves the transport on the old values while
    /// <see cref="GetSettings"/> reports the new ones — that is remedies (a)/(b) at the method, both
    /// contract changes, both still owner decisions.</item>
    /// <item><b>S7 — CLOSED (G-2), and on no prior list.</b> <see cref="Start"/>'s commit owes a SECOND
    /// off-lock completion after <see cref="CompleteStartOffLock"/> — the historian <c>"Start"</c> run event.
    /// It is load-bearing rather than telemetry, and that is <b>forced by the aggregation code, not
    /// chosen</b>: <c>SqliteHistorianStore</c>'s OEE query opens an interval on <c>"Start"</c>, closes it on
    /// <c>"Stop"</c>/<c>"Estop"</c>, and ignores <c>"EstopReset"</c> entirely. <b>S2</b> is its mirror on the
    /// halt path.</item>
    /// </list>
    /// <b>S3's residual — READ THE PER-CONSEQUENCE VERDICTS, NOT THIS HEADING</b> (recorded by the sweep,
    /// dropped by G-2's round 1, restored by review I-5).
    /// <b>The shape, stated once and in the present tense only where it is still true:</b> a throw inside
    /// <see cref="StartLocked"/> leaves partial work behind, and the question for each piece is who owns it
    /// afterwards. The pieces are labelled (1)…(5) below and each carries its own status and the task that
    /// set it.
    /// <para>🔴 <b>THE HEADING USED TO CARRY A TALLY</b> — "two of its three consequences closed, one still
    /// open, and a fourth that was never on this list" — and a tally over this particular list is the defect
    /// this same banner already fired on once, four paragraphs down: the list is not three, not four and not
    /// homogeneous ((5) is on the S2/S7 axis and says so), so every task that moved a member had to decide
    /// whether the heading still summarised it. T-1 moved (3) and the heading was wrong again. It is
    /// REMOVED rather than re-counted, for the reason the sibling scalar was removed rather than
    /// corrected.</para>
    /// <para>🔴 <b>WHAT THIS PARAGRAPH USED TO SAY, kept as history because the task that closed two of the
    /// four diagnosed this very sentence as the reason they stayed open — and deleting it would erase the
    /// evidence for that diagnosis.</b> It read: <i>"a throw inside <see cref="StartLocked"/> after the
    /// connector loop loses <c>orphanedConnectorDrivers</c> and <c>deferredLogs</c> outright — they are
    /// locals, so no <c>finally</c> in a caller can reach them — and leaves <see cref="_slots"/> non-empty
    /// with <c>_running == false</c>, which <see cref="StopLocked"/>'s guard [QUOTED-NOT-LIVE: the old
    /// single-disjunct form, deliberately NOT reproduced verbatim here — see the note below] then REFUSES to
    /// tear down. Closing it means restructuring <see cref="StartLocked"/> so its partial work is owned by
    /// the caller, which is the same redesign P5 needs."</i>
    /// <para>🔴 <b>Re-review, Minor — THE QUOTATION USED TO REPRODUCE THE OLD GUARD VERBATIM, and in this
    /// file that is not free.</b> A <c>grep</c> for the live guard then returned a hit that LOOKS like code,
    /// in the one file whose own banner records three defects caused by grepping a label and believing the
    /// result. The clause is described instead of quoted, and the marker is greppable on purpose: the live
    /// guard is at <see cref="StopLocked"/> and is a CONJUNCTION. History that impersonates code is a worse
    /// exhibit than history that says what it is.</para>
    /// <b>🔴 THE MARKING IS PER-CLAUSE, AND IT IS NOT A TALLY — branch review, Important 1, which is the
    /// SECOND false sentence this one paragraph has produced.</b> Round 2 replaced the refuted headline
    /// ("the fourth was never true") with a scalar one ("three FALSE, one still TRUE, one HALF") and never
    /// ran the new count against the clause set it summarises: clause 1 is COMPOUND, so the tally was wrong
    /// about how many clauses there even were. A scalar summary over a compound list is the defect this file
    /// has a banner about, so the scalar is GONE rather than corrected, and this list is the status:
    /// <list type="bullet">
    /// <item>1a. <i>"loses <c>orphanedConnectorDrivers</c> … they are locals"</i> — <b>FALSE.</b> It is the
    /// caller's list; see (1).</item>
    /// <item>1b. <i>"loses <c>deferredLogs</c> … they are locals"</i> — <b>WAS TRUE UNTIL T-1, NOW FALSE.</b>
    /// That was residual (3); the owner ruled on it and the list is the caller's, exactly as 1a's is.</item>
    /// <item>2. <i>"leaves <see cref="_slots"/> non-empty with <c>_running == false</c>"</i> — <b>STILL
    /// TRUE.</b> J-2 made that state CLEANABLE, not unreachable.</item>
    /// <item>3. <i>"which <see cref="StopLocked"/>'s [old single test] …"</i> — <b>FALSE.</b> It is a
    /// conjunction; see (2).</item>
    /// <item>4. <i>"… then REFUSES to tear down"</i> — <b>FALSE</b>, with clause 3.</item>
    /// <item>5a. <i>"Closing it means restructuring <see cref="StartLocked"/> so its partial work is owned
    /// by the caller"</i> — <b>TRUE, and DONE</b> for the orphan half: that is exactly what J-2 did.</item>
    /// <item>5b. <i>"… which is the same redesign P5 needs"</i> — <b>NEVER TRUE.</b> See below.</item>
    /// </list>
    /// <para>🔴 <b>Clause 5b is the one that cost three rounds, and the earlier headline over-reached by
    /// calling the whole sentence "never true" (re-review, Minor).</b> 5a is EXACTLY what J-2 did for the
    /// orphan half — the list is now the caller's. What was never true is 5b: the <b>P5 EQUIVALENCE</b>,
    /// and the SIZE it implied.
    /// Closing (1) took ONE parameter and two caller declarations, closing (2) took ONE <c>&amp;&amp;</c>,
    /// and <b>neither is the P5 redesign</b> — P5 is "get <c>MachineConfigStore.Ensure</c>'s write off this
    /// lock", and neither change moves any I/O relative to it. <b>That equivalence converted two cheap
    /// repairs into a reserved redesign by assertion, and three rounds of readers took their scope from it
    /// instead of from the code.</b> §8.1(f), the vocabulary half, applied to a SCOPE rather than to a name.
    /// The correction is worth its own line because the over-reach happened in the sentence written to
    /// diagnose an over-reach.</para>
    /// <para>🔴 <b>J-1 performed that restructuring for the BUILD half only, and this residual was UNCHANGED
    /// BY IT</b> (past tense as of J-2 — see (1) and (2) for what has since moved). The half that moved
    /// (simulators, mapping profiles) never owned anything a caller had to
    /// release — <c>IMachineSimulator</c> has no <c>Dispose</c> — so hoisting it bought nothing here. The two
    /// things that were lost AS OF J-1, <c>orphanedConnectorDrivers</c> and <c>deferredLogs</c>, were locals
    /// of the INSTALL half, which J-1 left under the lock along with the connector loop that fills them
    /// (<b>the first became a caller-owned list at J-2, the second at T-1; neither is lost now</b>). J-1 also
    /// made a partial route cheap that was not cheap before — the PLAN's lines exist in a
    /// <see cref="StartPlan"/> the caller already holds — and T-1 did not use it: the plan carries only the
    /// resolver's half, and the connector loop's lines are produced under the lock after it, so reaching
    /// through the plan would have emitted one half of what happened and called it the whole.</para>
    ///
    /// <para>🔴 <b>J-2 — THE SENTENCE THAT USED TO END THE PARAGRAPH ABOVE THIS ONE WAS STALE, AND IT IS THE
    /// KIND THAT MAKES A READER STOP CHECKING.</b> It read: <i>"Reachability today is only
    /// <see cref="StartSlot"/>'s <c>new EdgePipeline</c>/<c>Task.Run</c>, which is why 'named with a reason'
    /// is the honest answer rather than a fix."</i> J-1 put TWO ordinary throw sites inside this method that
    /// are not allocation failures — the reuse-MISS arm's <c>SimulatorFactory.Create</c> (P5:
    /// <c>InvalidOperationException</c> on a config-kind mismatch, <c>IOException</c> from its write) and the
    /// mapping SUPPLEMENT's <c>MappingProfileResolver.Build</c> (P4: per-descriptor file reads). This same
    /// banner says so about P5 in its own five-lock paragraph above ("the acquisition remains REACHABLE"),
    /// so the summary contradicted the list it summarises again. Both sites sit BEFORE the connector loop, so
    /// they reach exactly one of the consequences below (the deferred lines) and none of the others — which
    /// is why the correction changes a verdict rather than only a sentence: reachability is per-consequence
    /// here, and one claim covering three was always going to be wrong about at least one of them.
    ///
    /// <para><b>(1) <c>orphanedConnectorDrivers</c> — CLOSED (J-2).</b> The list is allocated by
    /// <see cref="Start"/>/<see cref="RebuildPipelineOffLock"/> and passed IN, so the orphans are owned by
    /// the caller's <c>finally</c> from the instant they are collected. Witnessed by
    /// <c>FleetHostGateCommitCompletionTests.AStartThatThrowsWhileInstallingSlots_StillDisposesTheConnectorDriverItOrphaned</c>.
    /// Its reachability is unchanged and remains allocation-failure-only in production (nothing between the
    /// first orphan and the return throws for any other reason) — it is closed because the fix costs one
    /// declaration, not because the path got likelier.</para>
    ///
    /// <para><b>(2) <c>_slots</c> non-empty with <c>_running == false</c> — CLOSED (J-2), and this was the
    /// one with a consequence on the HALT path.</b> Those slots are LIVE: their run-tasks are driving
    /// pipelines, and <see cref="Stop"/>/<see cref="Estop"/> both returned out of
    /// <see cref="StopLocked"/>'s guard without cancelling one of them, so a halt did not halt them and no
    /// operator action could (the one release that existed is not an operator's to trigger — a stranded slot
    /// whose driver later FAULTS removes itself through <see cref="StartSlot"/>'s catch; one that behaves is
    /// stranded for the process's life). The guard is now a conjunction; see <see cref="StopLocked"/> for why that changes
    /// no other reachable state, what it costs, and what it deliberately does not fix (a bare
    /// <see cref="Start"/> from that state still stacks a second set of slots — recovery means Stop or Estop
    /// first). Witnessed by
    /// <c>FleetHostGateCommitCompletionTests.AStartThatThrowsWhileInstallingSlots_LeavesSlotsTheHaltPathCanStillTearDown</c>.</para>
    ///
    /// <para><b>(3) <c>deferredLogs</c> — CLOSED (T-1), BY THE OWNER, and the ground is stated here because
    /// the argument that held it open for three rounds is refuted rather than overruled.</b> The list is the
    /// caller's now, allocated in <see cref="Start"/>/<see cref="RebuildPipelineOffLock"/> and filled by
    /// <see cref="StartLocked"/>, exactly as (1)'s is — so a throw inside the install no longer takes what
    /// already happened out of scope. Witnessed by
    /// <c>FleetHostGateCommitCompletionTests.AStartThatThrowsWhileInstallingSlots_StillSaysWhatHappenedBeforeItThrew</c>.
    /// <para>🔴 <b>WHAT THIS PARAGRAPH USED TO ARGUE, AND WHY IT DID NOT STAND.</b> It refused to act
    /// unilaterally on SYMMETRY: the two SIBLING non-installing paths — the HALT-latch refusal inside
    /// <see cref="StartLocked"/> and <see cref="Start"/>'s <c>_stopRequests</c> abandon — were each decided
    /// silent at their own site, so letting the third speak was called a change to what an operator sees.
    /// <b>The symmetry rests on a premise this same file refutes at <see cref="StopLocked"/>, in the
    /// paragraph written to distinguish the two questions:</b> "speaking for a start that never installed,
    /// where the alternative is silence about nothing having happened" is TRUE of the two siblings and FALSE
    /// of this path — on the throw path the resolver has already run and fallen back, a connector has already
    /// been rejected, and slots MAY ALREADY BE INSTALLED, which is consequence (2) of this same residual.
    /// Three paths that are not the same kind do not make a symmetry. Silence about what did not happen is
    /// right, and the two siblings keep it — pinned, not asserted, by
    /// <c>…AStartAbandonedByAConcurrentStopRequest_StillSaysNothing</c> and
    /// <c>…AnInstallRefusedByTheHaltLatch_StillSaysNothing</c>. Silence about what DID happen is what
    /// T-1 ended.</para>
    /// <para><b>What is emitted, and at what level — T-1 chose neither.</b> Every entry carries the channel
    /// its PRODUCER picked (<see cref="MappingProfileResolver"/>'s two callbacks; the connector loop's
    /// null-<c>Error</c> warning) and reaches the host through <see cref="FlushDeferredLogs"/>'s existing
    /// routing, which is the same routing a SUCCEEDING start already uses for the same lines. The throw path
    /// is now IDENTICAL to the success path for the work that actually ran, which is the property that made
    /// this a repair rather than a new operator-facing message: nothing is said that a successful start does
    /// not already say.</para>
    /// <para><b>The projection that narrowed this, RE-VERIFIED at T-1 rather than inherited (§8.1(h5.1)).</b>
    /// <c>_connectorStartIssues</c> is a FIELD, written in the same loop iteration one statement after the
    /// line is buffered, so it survives a throw the line did not, and
    /// <see cref="GetConfiguredConnectorIssues"/>/<c>GET /v1/connectors</c> still report it after a failed
    /// start — held now by
    /// <c>…AFailedInstallsRejectedConnector_IsStillReportedByTheProjectionThatOutlivesTheLine</c>, which is
    /// green on both sides of T-1's diff because it measures a property T-1 did not change. <b>The
    /// mapping-profile warnings had no such projection and were the half genuinely lost</b>, and that is
    /// checkable rather than a not-found: <see cref="MappingProfileResolver"/>'s per-descriptor resolve
    /// returns a profile and invokes one of two callbacks, and writes nothing else anywhere. A log line was
    /// therefore never the only shape available — the connector half proves it — and it is the shape taken
    /// because giving the mapping half a projection of its own would have added state, a lifetime and a read
    /// surface to say what the line already says, for one of the two halves only.</para></para>
    ///
    /// <para><b>(4) THE DRIVERS IN <c>groups</c> THAT NO SLOT TOOK — NAMED, NEW, and on no previous list.</b>
    /// If <see cref="StartSlot"/> throws at index <i>k</i>, every driver at index <i>k</i>+1 and beyond was
    /// built under this lock, is referenced only by that local list, and is never disposed — including
    /// third-party connector drivers holding live sockets, i.e. the same asset consequence (1) exists for.
    /// It is NOT fixed here and the reason is ownership ambiguity rather than cost: at index <i>k</i> itself
    /// this method cannot tell "installed" from "not installed" (<see cref="StartSlot"/> adds the slot to
    /// <see cref="_slots"/> before assigning its run-task), so handing that one over either leaks it or
    /// double-disposes it against the teardown path (2) has just made reachable. Closing it properly means
    /// making slot installation atomic inside <see cref="StartSlot"/>, which is a change to the slot
    /// lifecycle. Its only production producer is an allocation failure in that loop. Pinned as a gap by the
    /// second assertion of the <c>…StillDisposesTheConnectorDriverItOrphaned</c> test rather than left to be
    /// rediscovered.</para>
    ///
    /// <para><b>(5) AN OEE INTERVAL LEFT OPEN — NAMED at branch review, on the S2/S7 axis rather than this
    /// one, and PRE-EXISTING rather than introduced here.</b> If the stuck state is reached through an
    /// INTERNAL restart (<see cref="RegisterMachine"/>/<see cref="ApplyScenario"/> →
    /// <see cref="StopLocked"/> → <see cref="RebuildPipelineOffLock"/> → <see cref="StartLocked"/> throws),
    /// the run interval opened by the earlier operator <see cref="Start"/> is still open —
    /// <c>SqliteHistorianStore</c>'s OEE query opens on <c>"Start"</c> and closes only on
    /// <c>"Stop"</c>/<c>"Estop"</c> — and a <see cref="Stop"/> from that state computes
    /// <c>stopped = wasRunning &amp;&amp; !IsRunning</c> as FALSE, so it emits no <c>"Stop"</c> and the
    /// interval stays open, inflating Availability exactly as S2 describes.
    /// <para>🔴 <b>What J-2 changes about it is not the interval but the OPERATOR'S NEXT MOVE, and that is
    /// why it belongs here rather than only in S2.</b> Before J-2 that <see cref="Stop"/> did nothing
    /// observable at all — the slots kept running, <see cref="GetDriverHealth"/> kept listing them — so an
    /// operator would escalate to <see cref="Estop"/>, which records unconditionally and CLOSES the
    /// interval. After J-2 the same <see cref="Stop"/> is mechanically effective (slots really are torn
    /// down, the projection really does empty), so it LOOKS like a complete recovery and the escalation
    /// that used to close the interval no longer happens. The fix is right and this consequence is real:
    /// making a broken recovery work removed the symptom that drove an operator to the action which
    /// happened to repair the timeline. Not fixed here — emitting <c>"Stop"</c> from a fleet that already
    /// reported itself stopped is the S2/S7 truthfulness question, decided the other way at both
    /// call sites — and carried rather than left to be rediscovered.</para></para></para></para></para>
    ///
    /// <para><b>Two of these were WIDENED by G-1 rather than inherited from it</b>, and in the same way:
    /// <see cref="FlushDeferredLogs"/> — a host-supplied delegate, i.e. a throw site — became the FIRST
    /// statement of both completion routines, ahead of the disposals they exist to perform. The remedy is at
    /// each of those two methods. <b>It was not the only host seam inside a completion routine</b>, and
    /// saying so was G-2 round 1's own false universal: <see cref="DisposeOldSlots"/> called
    /// <see cref="_logDebug"/> from inside both per-slot catch handlers, i.e. INTERLEAVED with the disposals
    /// rather than in front of them, where a throw stranded every later slot. Buffered as of fix round 1. The
    /// general lesson, since this instrument missed it twice: a completion routine's host seams are not only
    /// the ones that PRECEDE its load-bearing work.</para></summary>
    private readonly object _gate = new();

    /// <summary>🔴 J-1 fix round 1 (review I-1) — counts OPERATOR REQUESTS FOR THE PIPELINE TO BE DOWN, and
    /// exists only so <see cref="Start"/> can tell whether one landed while its off-lock build was running.
    /// Written and read under <see cref="_gate"/>, never anywhere else.
    ///
    /// <para><b>The defect it closes, stated as the race rather than as the symptom.</b> Before J-1,
    /// <see cref="Start"/> held <see cref="_gate"/> across its whole body, so a concurrent <see cref="Stop"/>
    /// was strictly ordered against it: arrive first and the stop no-ops on a stopped fleet and the start
    /// wins; arrive second and the stop tears the just-started fleet down. J-1's hoist opened an interval in
    /// the middle of <see cref="Start"/> in which a <see cref="Stop"/> is neither — it acquires the gate,
    /// finds <see cref="_running"/> still <see langword="false"/> (the start has not installed yet), and
    /// <see cref="StopLocked"/> returns on its own opening guard — <c>_slots</c> is empty there too, so the
    /// conjunction J-2 gave that guard returns for the same reason the single test did (🔴 branch review,
    /// Important 2: this said "its own <c>!_running</c> guard", naming the guard by the form the
    /// <c>&amp;&amp;</c> replaced; the predicted behaviour was and is right, the stated form was not). The request evaporates and the
    /// start then completes, so a <c>Start</c>‖<c>Stop</c> race that used to be able to end STOPPED could
    /// only end RUNNING. Nothing was corrupted — no historian event is emitted for a stop that did not
    /// happen, and <see cref="IsRunning"/> reports honestly — which is why this was an inverted OUTCOME
    /// rather than a broken invariant.</para>
    ///
    /// <para><b>How it is resolved, and why this resolution rather than another.</b> A start whose snapshot
    /// predates a stop request abandons its install. That makes the windowed stop win, which is the outcome
    /// the pre-J-1 lock produced whenever the stop arrived second. It costs no new failure mode
    /// (<see cref="Start"/> returns <see langword="void"/> and already declines silently when latched or
    /// already running), no new lock, and no roster freeze.</para>
    ///
    /// <para>🔴 <b>What is NOT restored byte-for-byte, said plainly rather than glossed — and the first
    /// version of this paragraph got it wrong (branch review, Important 1).</b> Pre-J-1's "stop arrived
    /// second" path emitted <c>NBIRTH</c> + historian <c>"Start"</c>, then <c>NDEATH</c> + <c>"Stop"</c>,
    /// and ended STOPPED. Pre-J-1's "stop arrived first" path emitted <c>NBIRTH</c> + <c>"Start"</c> and
    /// ended RUNNING (the stop no-opped on a stopped fleet, then the start ran). The abandoned start emits
    /// NONE of the four and ends STOPPED. <b>That is a genuinely THIRD (end-state, emission) pair</b>, and
    /// the claim that once stood here — "exactly what pre-J-1's other resolution emitted" — was false:
    /// that arm emitted two of the four and ended in the opposite state.</para>
    ///
    /// <para>The ruling this change was accepted under does not rest on that sentence, which is why the
    /// sentence is corrected rather than the behaviour. It rests on the OEE leg, which is independent:
    /// <c>SqliteHistorianStore</c>'s query opens an interval on <c>"Start"</c> and closes it on
    /// <c>"Stop"</c>/<c>"Estop"</c>, so emitting a pair for a pipeline that never installed fabricates a
    /// zero-length interval — an invented production record, which is worse than an absent one. Emitting
    /// nothing is the honest report of a start that never happened.</para>
    ///
    /// <para><b>Scope, deliberately narrow.</b> Only <see cref="Start"/> consults this. The equivalent window
    /// inside <see cref="RegisterMachine"/>/<see cref="ApplyScenario"/> — between their <see cref="StopLocked"/>
    /// and their rebuild — PREDATES J-1 and is documented and accepted at <see cref="RegisterMachine"/> as
    /// "last writer wins"; J-1 made it wider but did not create it, and making those two abandon would be a
    /// behaviour change this task has no mandate for. Incrementing here rather than inside
    /// <see cref="StopLocked"/> is what keeps that distinction: an internal restart's teardown is not a
    /// request for the fleet to END stopped, so it must not cancel a concurrent start.</para></summary>
    private long _stopRequests;

    private readonly object _kpiGate = new();
    private readonly SwitchableTransport _transport;
    private readonly TransportCoordinator _transportCoordinator;
    private readonly EventBus _eventBus;

    /// <summary>🔴 E-2 — the EdgeCore-convention replacement for <c>ILogger&lt;FleetHost&gt;</c>
    /// (<c>Action&lt;string&gt;?</c> / <c>Action&lt;Exception,string&gt;?</c>, the shape every other type in
    /// this assembly already uses; see <c>MappingProfileResolver.cs</c>'s "St4i.EdgeCore is intentionally
    /// logging-framework-free"). Fourteen <c>_logger?.</c> call sites were ported — blueprint §9.5's
    /// corrected count; the original count of eight understated the surface by 75%.
    ///
    /// <para><b>🔴 THE RULE THIS PAIR CARRIES, and it is the exact shape of D-7a's Critical:</b> <c>?.</c>
    /// short-circuits the ENTIRE argument list. D-7a incremented a consecutive-failure counter INSIDE the
    /// argument of <c>_logError?.Invoke(ex, Describe())</c>, so for every driver built WITHOUT a callback the
    /// counter never moved and the backoff never started — the code read correctly, the arithmetic was
    /// correct, and the defect was that a mechanism's STATE rode an observation channel. Two of this class's
    /// own log sites sit directly beside mechanism state: <see cref="_connectorStartIssues"/> is written on
    /// the statement after the connector-failure warning, and <see cref="LastError"/> on the statement after
    /// the slot-fault error. Those assignments MUST stay their own statements. Never fold one into a log
    /// call's arguments, however tidy it looks — <c>FleetHostConnectorVisibilityTests</c> constructs its host
    /// with NO logger at all, which is exactly what makes that mutation RED rather than invisible.</para>
    ///
    /// <para>The shell passes <see langword="null"/> for both when it has no <c>ILogger</c>, rather than a
    /// lambda that closes over a null logger. That is not cosmetic: a never-null callback would make the
    /// paragraph above unfalsifiable, because there would no longer be any way to build this class without
    /// one.</para></summary>
    private readonly Action<string>? _logWarning;

    /// <summary>See <see cref="_logWarning"/> — same convention and the same rule, for the sites that carry
    /// an exception.</summary>
    private readonly Action<Exception, string>? _logError;

    /// <summary>🔴 G-1 — the THIRD channel, and the reason it exists is an operator cost, not tidiness.
    /// <c>St4i.EdgeCore</c>'s convention had exactly TWO channels, so E-2's move collapsed ten
    /// exception-carrying <c>_logger?.</c> sites onto <see cref="_logError"/>. Recounted from the pre-E-2
    /// source (commit <c>5f2b8883</c>, <c>FleetHost.cs</c>) rather than from the blueprint: fourteen sites,
    /// four message-only (all <c>LogWarning</c>, all still <see cref="_logWarning"/>) and ten
    /// exception-carrying, which were <b>five <c>LogWarning</c> + two <c>LogError</c> + three
    /// <c>LogDebug</c></b> — blueprint §10.4's accounting is exact, and there is no fourth <c>LogDebug</c>
    /// site (the count came from the runner of record, not from re-reading the note that asserts it).
    ///
    /// <para><b>The three <c>LogDebug</c> sites are the whole problem.</b> <c>St4i.EngineApi</c> ships no
    /// <c>appsettings.json</c>, so the framework's default minimum applies and <c>LogDebug</c> emitted
    /// NOTHING. Those three — <see cref="DisposeOrphanedConnectorDrivers"/>,
    /// <see cref="WaitAndDisposeOldPipeline"/>'s teardown-wait and its driver-dispose — are best-effort
    /// cleanup paths, and E-2 did not move them from Debug to Error: it moved them from <b>SILENT</b> to
    /// Error, and under <c>AddWindowsService</c> from silent to a SYNCHRONOUS Windows Event Log write.
    /// Every fleet restart that trips a slow teardown then writes an error to the Event Log on a path that
    /// previously wrote nothing, which is how an operator learns to stop reading the Event Log. The other
    /// five drifted sites went <c>LogWarning</c> → <c>LogError</c>, which does NOT change Event Log
    /// presence (<c>AddEventLog</c>'s default filter already admits Warning) — severity only, left as E-2
    /// recorded it.</para>
    ///
    /// <para>Shape: a separate, nullable, host-supplied delegate, not a level argument on an existing one.
    /// It carries an exception because all three of its sites do. <b>The precedent, stated at the size it
    /// actually is:</b> <c>WalFlushPump</c> carries <c>logInfo</c>/<c>logError</c>
    /// (<c>WalFlushPump.cs:35-36</c>) — TWO callbacks, not three — which proves an EdgeCore pair need not be
    /// warning+error, and therefore that choosing a third LEVEL is precedented. It does not prove a
    /// three-callback type is; nothing in this assembly carried three before this one did. The level the
    /// shell maps it to is <c>LogDebug</c>, not
    /// <c>LogInformation</c>: the goal is to restore the granularity E-2 collapsed, and Information would
    /// leave these three lines visible on a console path where they were silent before — a different
    /// change, not a restoration.</para>
    ///
    /// <para><b>Same nullability rule as the pair above, and it is load-bearing for the same reason.</b>
    /// The shell passes <see langword="null"/> when it has no <c>ILogger</c>; it must never pass a lambda
    /// closing over a null logger. A never-null third callback would make D-7a's Critical
    /// (mechanism state riding an observation channel, killed only because a host can be built with NO
    /// callback at all) unfalsifiable on this channel too.</para></summary>
    private readonly Action<Exception, string>? _logDebug;

    /// <summary>🔴 E-2 — the seam <c>ConfigSyncCoordinator</c> stays behind. Blueprint §9.1 lists it as one
    /// of the six things that held the core back to <c>St4i.EngineApi</c>, and §9.6(a) records that it is
    /// not a leaf (it drags <c>SwitchableConfigSyncBackend</c>/<c>SimulatedEcosystem</c>/
    /// <c>LiveConfigSyncBackend</c>/<c>IConfigSyncBackend</c> with it), so it does not move. Invoked by
    /// <see cref="UpdateSettings"/> immediately after <see cref="TransportCoordinator.RebuildLive"/> and
    /// OUTSIDE <see cref="_gate"/> — exactly where and when <c>_configSyncCoordinator?.RebuildLive(...)</c>
    /// ran before the cut, so its ordering against the transport rebuild AND against
    /// <c>FleetSettingsStore.Save</c> is byte-identical. Arguments in order: serverUrl, machineCode, mk key
    /// (may be null), verifyTls, the coordinator's current mode. The mode half of that pairing
    /// (<c>ApplyMode</c>) is not a seam at all — the shell simply calls <see cref="ApplyMode"/> and then its
    /// own coordinator, in that order, off any lock.</summary>
    private readonly Action<string, string, string?, bool, TransportMode>? _onLiveSettingsRebuilt;

    /// <summary>E1: per-machine live state, keyed case-insensitively by <see cref="MachineDescriptor.Code"/>.
    /// Was a plain <see cref="Dictionary{TKey,TValue}"/> built once in the ctor and never structurally
    /// mutated after — safe to read lock-free only because of that invariant. <see cref="RegisterMachine"/>
    /// breaks that invariant (machines can now be added after construction), so this is now a
    /// <see cref="ConcurrentDictionary{TKey,TValue}"/>: additions are safe to interleave with
    /// <see cref="ReadSnapshot"/>/<c>FleetHost.MachineDetail</c> readers on other threads with no lock needed on
    /// the read side — <c>.Values</c> hands back a point-in-time copy, never a torn live view.</summary>
    private readonly ConcurrentDictionary<string, MachineState> _states;

    /// <summary>E1: mutable backing store for the fleet roster — only ever mutated (by
    /// <see cref="RegisterMachine"/>) under <see cref="_gate"/>, same lock <see cref="StartLocked"/>/
    /// <see cref="StopLocked"/> already use. The public <see cref="Fleet"/> property hands back a
    /// defensive copy so external readers never see a torn list mid-mutation.</summary>
    private readonly List<MachineDescriptor> _fleet;

    /// <summary>Task 3 (docs/plans/2026-07-21-machine-config.md) — optional (defaults to null so every
    /// pre-existing test that constructs <see cref="FleetCore"/> directly without one keeps compiling and
    /// behaving unchanged) machine operating-configuration store. Threaded into
    /// <see cref="SimulatorFactory.Create"/> so the config-aware simulators (Screwdrive/Iot/Aoi today)
    /// re-resolve their effective config live, straight off this SAME store <c>MachineSettingsEndpoints</c>
    /// writes to — a PUT against a running fleet is visible on the very next cycle, no restart.</summary>
    private readonly MachineConfigStore? _configStore;

    /// <summary>WS3-T1 — optional (defaults null so every pre-existing test that constructs
    /// <see cref="FleetCore"/> directly without one keeps compiling/behaving unchanged) source for
    /// <see cref="AoiInspectorSim"/>'s real-product-points cycle plan, threaded into
    /// <see cref="SimulatorFactory.Create"/> exactly like <see cref="_configStore"/> already is.</summary>
    private readonly St4i.EdgeCore.Config.ProductConfigStore? _productConfigStore;

    /// <summary>WS-A-T7 — optional (defaults null so every pre-existing test/call site that constructs
    /// <see cref="FleetCore"/> directly without one, e.g. <c>FleetHostHealthAndRegistrationTests</c>,
    /// keeps compiling/behaving byte-for-byte unchanged) durable-historian sink. Fed ALONGSIDE the
    /// existing in-memory <see cref="MachineState"/> path in <see cref="OnPipelineCommitted"/> (never
    /// instead of it) and the genuine OPERATOR run-state transitions — <see cref="Start"/>/
    /// <see cref="Stop"/> (guarded to a real not-running↔running transition), <see cref="Estop"/>,
    /// <see cref="ResetEstop"/> — this class owns no historian logic itself, just forwards to
    /// <see cref="HistorianWriter"/>'s own non-blocking, non-throwing
    /// <c>Enqueue</c>/<c>RecordRunEventFireAndForget</c>. Fix round 1 (WS-A-T7 review): deliberately NOT
    /// emitted from the shared <c>StartLocked</c>/<c>StopLocked</c> helpers — those are also the internal
    /// restart chokepoint <see cref="RegisterMachine"/>/<see cref="ApplyScenario"/>/<see cref="Burst"/>
    /// use, and emitting there would pollute the historian's run-event timeline (OEE Availability =
    /// Start→next Stop/Estop) with a spurious Stop/Start pair on every internal restart, and make
    /// <see cref="Estop"/> double-emit "Stop" + "Estop" for the same teardown.</summary>
    private readonly HistorianWriter? _historianWriter;

    /// <summary>G2-2 (docs/plans/2026-07-27-giaidoan2-synapse-connect-blueprint.md task 2) — optional
    /// (defaults null, same "every pre-existing test that constructs <see cref="FleetCore"/> directly
    /// without one keeps compiling/behaving byte-for-byte unchanged" contract as every other optional
    /// store/writer above) local Unified Namespace publisher. Threaded straight into every
    /// <see cref="EdgePipeline"/> this host builds (see <see cref="StartLocked"/>) so every committed
    /// reading is additively mirrored onto the Sparkplug + <c>syn/...</c> topics — never instead of, and
    /// never able to slow down, the existing ST4I HTTP path this same pipeline already drives.
    ///
    /// G2-3 — typed against the <see cref="IUnsPublisher"/> INTERFACE (not the concrete
    /// <see cref="UnsPublisher"/>) so a test can inject a fake that records calls without a real broker;
    /// <see cref="EdgePipeline"/> already took the interface, so this only changes this field/ctor param's
    /// own declared type — every existing call site (<see cref="StartLocked"/> passing <c>_unsPublisher</c>
    /// into <see cref="EdgePipeline"/>'s ctor) keeps compiling unchanged. Also now the seam
    /// <see cref="Start"/>/<see cref="Stop"/>/<see cref="Estop"/> call <see cref="IUnsPublisher.PublishNodeBirth"/>/
    /// <see cref="IUnsPublisher.PublishNodeDeath"/> through, at the SAME guarded real-transition sites as the
    /// historian run-events above.</summary>
    private readonly IUnsPublisher? _unsPublisher;

    /// <summary>GP-4 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-4-brief.md) —
    /// optional (defaults null, same "every pre-existing test/call site that constructs
    /// <see cref="FleetCore"/> directly without one keeps compiling/behaving byte-for-byte unchanged"
    /// contract as every other optional dependency above) connector-id-keyed registry, replacing what used
    /// to be TWO separate per-driver-kind fields here: <c>Func&lt;IDeviceDriver&gt;? _modbusDriverFactory</c>
    /// and <c>OpcUaDriverFactory? _opcUaDriverFactory</c> (G2-6 / GĐ3 sub-3 OU-1). Every registered
    /// connector rides the SAME G2-5 per-slot fault isolation those two fields' pipeline slots always did
    /// (see <see cref="StartLocked"/>) — a fault in any one connector, or a connector that fails to even
    /// BUILD (a bad config, or a third-party factory that throws despite
    /// <see cref="St4i.Connector.Abstractions.IConnectorFactory.TryCreate"/>'s contract not to), can never
    /// touch the simulated fleet or any sibling connector. Production (Program.cs) registers Modbus/OPC-UA
    /// into this registry via the <c>ModbusConnectorFactory</c>/<c>OpcUaConnectorFactory</c> adapters;
    /// <see cref="StartLocked"/> asks it fresh, on every call, for the full set of configured connector ids
    /// and a driver for each — this is what "onboarding a connector" now means: one
    /// <see cref="ConnectorRegistry.Register"/> call, zero changes to this class.</summary>
    private readonly ConnectorRegistry? _connectorRegistry;

    /// <summary>GP-5 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-5-brief.md item
    /// 3, carried from the GP-4 review) — every currently-registered connector id that FAILED to start on
    /// its most recent <see cref="StartLocked"/> attempt, keyed by connector id, valued by the operator-
    /// readable error <see cref="ConnectorRegistry.TryCreateDriver"/> (or this class's own defensive catch)
    /// produced. Mutated only inside <see cref="StartLocked"/> (assumes the caller holds <see cref="_gate"/>,
    /// same as every other <see cref="StartLocked"/>-owned mutation) — a <see cref="ConcurrentDictionary{TKey,TValue}"/>
    /// purely so <see cref="GetConfiguredConnectorIssues"/> (a hot GET-style read, like
    /// <see cref="GetDriverHealth"/>) never needs to take <see cref="_gate"/> itself. An entry is added the
    /// first time its connector fails to build a driver, and removed the next time that SAME connector id
    /// succeeds (see the connector loop in <see cref="StartLocked"/>) — so this reflects the LATEST attempt
    /// only, never a permanently-stuck "once failed, always failed" state.</summary>
    private readonly ConcurrentDictionary<string, string> _connectorStartIssues = new(StringComparer.Ordinal);

    /// <summary>P2-1 (WS-J Asset Registry) — optional (defaults null, same "every pre-existing test that
    /// constructs <see cref="FleetCore"/> directly without one keeps compiling/behaving byte-for-byte
    /// unchanged" contract as every other optional dependency above) notification that a machine has
    /// entered this host's roster: once per roster-seed machine in the ctor below, and again on every
    /// dynamic <see cref="RegisterMachine"/> call.
    ///
    /// <para>🔴 E-2 — this WAS <c>IAssetRegistry? _assetRegistry</c>, called as
    /// <c>_ = _assetRegistry?.UpsertAsync(descriptor)</c>. <c>IAssetRegistry</c> stays in
    /// <c>St4i.EngineApi</c> (blueprint §9.1/§9.6(a): it is not a leaf — it drags <c>AssetRecord</c> and
    /// <c>AssetLifecycleState</c>), so the core knows only "a machine was seeded" and the shell decides what
    /// that means. <b>At E-2 the call site did not move and the operation count did not change:</b> it was
    /// still exactly one invocation per seeded machine, still on the calling thread, still inside
    /// <see cref="_gate"/> at <see cref="RegisterMachine"/> and still outside any lock in the ctor.
    /// 🔴 <b>G-1 changed the third of those four clauses and only the third</b> — see the G-1 paragraph
    /// below. One invocation per seeded machine, on the calling thread, and no lock in the ctor are all
    /// still true today.</para>
    ///
    /// <para><b>Read blueprint §9.2 before you touch this.</b> The <c>_ =</c> discard plus the <c>Async</c>
    /// suffix read as fire-and-forget. It is NOT: Microsoft.Data.Sqlite does not override the async ADO.NET
    /// members, so a real <c>AssetRegistryStore.UpsertAsync</c> runs its open+insert entirely on THIS thread
    /// and hands back an already-completed task. Until G-1 that whole SQLite transaction executed while
    /// <see cref="_gate"/> was held, measured to block a reader of <see cref="EstopEngaged"/> for up to
    /// 12.35 ms. That was a PRE-EXISTING defect E-2 deliberately did not fix (a fix folded into a move makes
    /// "behaviour unchanged" untrue), and the reason this doc comment said so out loud is that the previous
    /// wording — "fire-and-forget, never awaited, never throws" — is what let it sit unnoticed. The
    /// synchronous half of that sentence is STILL TRUE and always will be: whatever the shell wires here
    /// runs on the calling thread unless the shell itself hands the work elsewhere. Only the "under the
    /// lock" half is gone.</para>
    ///
    /// <para>🔴 <b>G-1 CLOSED the <see cref="_gate"/> half of that defect.</b> This callback is no longer
    /// invoked under <see cref="_gate"/> anywhere. <see cref="RegisterMachine"/> now ENQUEUES the descriptor
    /// onto <see cref="_pendingSeedNotifications"/> while holding the lock (a bounded, allocation-only
    /// operation) and <see cref="DrainSeedNotifications"/> invokes the callback after the lock is released.
    /// A real <c>AssetRegistryStore.UpsertAsync</c> still runs its whole SQLite transaction synchronously on
    /// the calling thread — that has not changed and is not this class's to change — but it no longer holds
    /// the lock <see cref="Estop"/> takes, so the 12.35 ms block of an <see cref="EstopEngaged"/> reader is
    /// gone. See <see cref="DrainSeedNotifications"/> for how the three invariants that move could have
    /// broken are kept.
    ///
    /// <b>The constructor's N synchronous transactions are a SEPARATE claim and G-1 did NOT close it.</b>
    /// The ctor seed loop takes no lock (it never did — blueprint §9.2 note 4 calls it "the fourth site of
    /// the same mechanism", explicitly NOT a <see cref="_gate"/> violation), so it is routed through the
    /// same queue purely so there is ONE notification path to reason about; the work still runs
    /// synchronously inside the constructor of a DI singleton, exactly as costly as before. Making it
    /// asynchronous would change when a caller may assume seeding finished — an observable-ordering change
    /// this task is not allowed to decide alone.</para></summary>
    private readonly Action<MachineDescriptor>? _onMachineSeeded;

    /// <summary>🔴 G-1 — descriptors seeded into the roster but not yet handed to
    /// <see cref="_onMachineSeeded"/>. Enqueued while <see cref="_gate"/> is held (constructor seed loop and
    /// <see cref="RegisterMachine"/>); drained by <see cref="DrainSeedNotifications"/> with NO lock held.
    /// This is the queue that lets the notification leave the lock without any of the three invariants
    /// leaving with it — see <see cref="DrainSeedNotifications"/>.
    ///
    /// <para>Nothing is enqueued when <see cref="_onMachineSeeded"/> is <see langword="null"/>, which is
    /// every pre-existing test and every no-DI-registration path: the queue has exactly ONE consumer, so
    /// queuing for a consumer that does not exist would be pure garbage. That keeps the "null callback is a
    /// no-op" contract literal rather than merely observationally true. It is NOT the D-7a shape — no
    /// mechanism state rides this queue; the queue IS the delivery of the callback and of nothing
    /// else.</para></summary>
    private readonly ConcurrentQueue<MachineDescriptor> _pendingSeedNotifications = new();

    /// <summary>🔴 G-1 — serializes <see cref="DrainSeedNotifications"/> against itself. Deliberately NOT
    /// <see cref="_gate"/>: the entire point is that a slow host callback must not block
    /// <see cref="Estop"/>/<see cref="EstopEngaged"/>.
    ///
    /// <para><b>🔴 There IS a lock order here, and the first version of this comment denied it.</b> It said
    /// "nothing inside this lock touches <see cref="_gate"/>-protected state, so no lock ordering exists to
    /// invert" — false, and falsified by this task's own test.
    /// <see cref="DrainSeedNotifications"/> invokes <see cref="_onMachineSeeded"/> INSIDE this lock; that
    /// callback is arbitrary host code and may take <see cref="_gate"/>. It does exactly that in
    /// <c>FleetHostSeedNotificationOffGateTests</c>, whose roster probe calls <see cref="Fleet"/> — itself a
    /// <c>lock (_gate)</c> getter. So the real order is <b><see cref="_seedNotifyGate"/> →
    /// <see cref="_gate"/></b>, and it is exercised.
    ///
    /// It is never INVERTED, and the reason is a contract, not an absence: <b>nothing may take
    /// <see cref="_seedNotifyGate"/> while holding <see cref="_gate"/></b>, which is precisely what
    /// <see cref="DrainSeedNotifications"/>'s "MUST NOT be called while holding <see cref="_gate"/>" rule
    /// buys — the rule exists for latency, and it pays for deadlock-freedom as well. Both call sites honour
    /// it (the constructor takes no lock; <see cref="RegisterMachine"/> drains after its lock is released).
    /// A future caller that drains under <see cref="_gate"/> would not merely reinstate the 12.35 ms block —
    /// it would create a genuine two-lock cycle against any host callback that reads this class back.</para>
    ///
    /// <para>Recorded at this length because a comment asserting "no ordering exists" is exactly what a
    /// maintainer would rely on before moving the drain, and because it is the same shape as the defect this
    /// whole task closes: the old <see cref="_onMachineSeeded"/> prose said "fire-and-forget" and nobody
    /// checked.</para></summary>
    private readonly object _seedNotifyGate = new();

    /// <summary>FF-1 (docs/plans/2026-07-27-ws-ff-fast-follows.md) — optional (defaults null, same
    /// "every pre-existing test that constructs <see cref="FleetCore"/> directly without one keeps
    /// compiling/behaving byte-for-byte unchanged" contract as every other optional store above)
    /// atomic-JSON-backed persistence for <see cref="_serverUrl"/>/<see cref="_machineCode"/>/
    /// <see cref="_verifyTls"/> — written by <see cref="UpdateSettings"/> on every change so a runtime
    /// <c>PUT /v1/settings</c> survives a process restart. Deliberately never asked to persist
    /// <see cref="_language"/> (a pure display preference) or any mk_ key (stays in
    /// <see cref="CredentialStore"/>, DPAPI-encrypted — never written here).
    ///
    /// 🔴 Task Q-1 — read "if one exists" below as <b>"if one was READ"</b>. <c>FleetSettingsStore.Load</c>
    /// now answers null both when the slot on disk is empty and when a file is there that could not be
    /// turned into a triple, and this constructor is entitled to treat those the same because it only ever
    /// sets fields — it invents nothing and it writes nothing. The composition root, which DOES decide
    /// whether anything gets written, branches on <c>FleetSettingsStore.Read</c> instead and reports the
    /// unreadable case at <c>Error</c> a few statements after this constructor returns. That ordering is why
    /// <c>Load</c> must not throw here: a throw would end the process before the line that names the file.
    ///
    /// This ctor eagerly loads a persisted file (if one exists) straight into <see cref="_serverUrl"/>/
    /// <see cref="_machineCode"/>/<see cref="_verifyTls"/> — same "read it back on construction" idiom
    /// <see cref="MachineConfigStore"/>/<see cref="Historian.OeeSettingsStore"/> already use — so
    /// <see cref="GetSettings"/> reports the right values for ANY caller immediately after construction,
    /// with no extra glue required (this is what makes "new <see cref="FleetCore"/> pointed at the same
    /// settings directory" a faithful in-process stand-in for a real process restart in tests). It
    /// deliberately does NOT also call <see cref="TransportCoordinator.RebuildLive"/> here — that requires
    /// a credential lookup and touches <see cref="_transportCoordinator"/>/<c>_configSyncCoordinator</c>,
    /// which is exactly what <c>Program.cs</c>'s startup wiring does right after this ctor returns, via a
    /// real <see cref="UpdateSettings"/> call (the one that also decides persisted-file-vs-env-var
    /// precedence) — that single call is what actually re-points the Live transport to match, before
    /// <c>app.Run()</c> ever serves a request.</summary>
    private readonly FleetSettingsStore? _settingsStore;

    /// <summary>SM-1 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-1-brief.md) —
    /// optional (defaults null, same "every pre-existing test/call site that constructs <see cref="FleetCore"/>
    /// directly without one keeps compiling/behaving byte-for-byte unchanged" contract as every other
    /// optional dependency above) reuse of the ONE existing seam that already decides demo-vs-product
    /// (<c>Program.cs</c>'s <c>TransportCoordinator</c>/auto-login wiring, <c>ModeEndpoints</c>) — deliberately
    /// NOT a second "am I in demo mode" flag invented for the fleet roster specifically. Consulted exactly
    /// once, by <see cref="LoadFleet"/>, from the constructor:
    ///  - <see langword="null"/> (every pre-existing test) or <see cref="St4i.EdgeCore.Config.DemoModeGate.Enabled"/>
    ///    keeps the ORIGINAL fleet.json/<see cref="BuildDefaultFleet"/> resolution byte-identical — the
    ///    exhibition/sales fleet must never regress.
    ///  - non-null and disabled means a real product deployment: the roster starts EMPTY. fleet.json and
    ///    <see cref="BuildDefaultFleet"/> become demo-only artifacts — see <see cref="ResolveFleet"/>.
    /// Production (Program.cs) never has to pass this explicitly: <see cref="St4i.EdgeCore.Config.DemoModeGate"/>
    /// is already registered as a DI singleton, so the container resolves it into this optional parameter
    /// automatically, the same way <see cref="MachineConfigStore"/> already does.
    ///
    /// SM-1b fix round 1 (task-1b-brief.md, review) — this class moved from
    /// <c>St4i.EngineApi.Config.DemoModeGate</c> to <see cref="St4i.EdgeCore.Config.DemoModeGate"/> so
    /// <c>St4i.EdgeService</c>'s own fleet-source gate could share it too, with no new project-reference
    /// edge (both projects already <c>ProjectReference</c> <c>St4i.EdgeCore</c>) — see that class's own
    /// doc comment for the full history. Every reference in this file updated; no behavior change.</summary>
    private readonly St4i.EdgeCore.Config.DemoModeGate? _demoModeGate;

    /// <summary>SM-1 — the fleet is "running" (an operator has called <see cref="Start"/> and neither
    /// <see cref="Stop"/>/<see cref="Estop"/> nor a total runtime fault-out has happened since). This
    /// REPLACES the old computed definition (<c>_slots.Count > 0</c>) — that definition could never
    /// distinguish "an empty roster the operator deliberately started, with nothing to pipeline yet" (a
    /// coherent running state this task makes real, see the deliverable) from "every slot has faulted out
    /// at runtime" (a degraded state that WAS, and still is, reported as not-running). Set by
    /// <see cref="StartLocked"/> (unconditionally, whenever it doesn't early-return), cleared by
    /// <see cref="StopLocked"/>, and ALSO cleared by <see cref="StartSlot"/>'s own fault-catch the moment
    /// its removal brings <see cref="_slots"/> back down to zero — that one line is what keeps every
    /// pre-existing "the sole/last slot faulting flips IsRunning false" test passing unchanged; a roster
    /// that never had any slot to begin with (the empty-roster case) never reaches that catch at all, so
    /// it stays running until a genuine <see cref="Stop"/>/<see cref="Estop"/>.</summary>
    private bool _running;

    /// <summary>Task 3 — "what product is machine X running right now", keyed case-insensitively by
    /// <see cref="MachineDescriptor.Code"/>. A machine absent from this map (the common case — nothing
    /// sets it yet outside tests) resolves machine-scoped config only, exactly like a machine whose
    /// <c>configKind</c> has no product dimension at all. Read by <see cref="CurrentProductFor"/>, which
    /// every config-aware simulator's <see cref="Func{T,TResult}"/> provider (built in
    /// <see cref="StartLocked"/>) calls fresh on every cycle — so <see cref="SetCurrentProduct"/> takes
    /// effect on an already-running fleet with no restart, same as a plain adjustment does.</summary>
    private readonly ConcurrentDictionary<string, string?> _currentProduct = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>G2-5 — one independent pipeline in the fleet: its EdgePipeline, the CTS that stops it, and its
    /// background run-task. Each slot faults in ISOLATION (a fault removes only THIS slot from <see cref="_slots"/>,
    /// never the others) so one flaky driver can't tear down the whole fleet. Mutated only under <see cref="_gate"/>
    /// (except <see cref="RunTask"/>, assigned once right after Task.Run, before the slot is observed off-thread).</summary>
    private sealed class PipelineSlot
    {
        public required string Label { get; init; }
        public required EdgePipeline Pipeline { get; init; }
        public required CancellationTokenSource Cts { get; init; }

        /// <summary>G2-6 review fix — the slot's OWN driver, so whichever code path actually removes this
        /// slot from <see cref="_slots"/> (<see cref="WaitAndDisposeOldPipeline"/> for a superseded slot, or
        /// this slot's own fault-catch in <see cref="StartSlot"/> for a self-fault) can dispose it.
        /// <see cref="ModbusTcpDriver"/> (G2-6) is the first driver to own a live resource (a TCP
        /// connection) that cancelling <see cref="Cts"/> alone does not release — before this field existed,
        /// FleetCore never called <c>DisposeAsync</c> on any slot's driver at all, so every Stop/restart/
        /// fault-removal leaked one connection until GC finalized it.</summary>
        public required IDeviceDriver Driver { get; init; }

        public Task? RunTask { get; set; }
    }

    private readonly List<PipelineSlot> _slots = new();

    private DemoTransport? _outageTransport;
    private CancellationTokenSource? _burstRevertCts;
    private double _burstBaseline = 1.0;

    private volatile ScenarioConfig _scenario = ScenarioConfig.Normal;
    private volatile string _activePresetName = "normal";

    private long _totalCycles;
    private long _totalPass;
    private long _totalJudged;

    /// <summary>SM-2 — the SAME three counters as <see cref="_totalCycles"/>/<see cref="_totalPass"/>/
    /// <see cref="_totalJudged"/> above, ADDITIVELY tracked alongside them (never instead of — those three
    /// stay exactly as they were, still read by <see cref="GetKpiCounters"/>/<see cref="ReadSnapshot"/>'s own
    /// pure-demo branch), counting ONLY readings from a non-fabricated (real) machine. See
    /// <see cref="OnPipelineCommitted"/> for how each reading is classified (cheaply, on this same hot
    /// path, from the already-resolved <see cref="MachineState.Descriptor"/> — never a second lookup) and
    /// <see cref="ReadSnapshot"/> for which of the two counter sets a caller actually sees.</summary>
    private long _totalCyclesReal;
    private long _totalPassReal;
    private long _totalJudgedReal;

    private string _serverUrl = DefaultServerUrl;
    private bool _verifyTls = true;
    private string _language = DefaultLanguage;
    private string _machineCode = DefaultMachineCode;

    /// <summary>🔴 E-2 — parameter-for-parameter the old <c>FleetHost</c> ctor, with the four EngineApi-typed
    /// parameters replaced by the seams described on their own fields: <c>ILogger&lt;FleetHost&gt;? logger</c>
    /// → <see cref="_logWarning"/>/<see cref="_logError"/>, <c>ConfigSyncCoordinator? configSyncCoordinator</c>
    /// → <see cref="_onLiveSettingsRebuilt"/>, <c>IAssetRegistry? assetRegistry</c> →
    /// <see cref="_onMachineSeeded"/>. Every remaining parameter, its optionality, its default and the order
    /// of the work this body does are unchanged — including the deliberate ordering that the settings file is
    /// loaded BEFORE the roster (so <see cref="GetSettings"/> is right for any caller the instant this
    /// returns) and that <c>SeedAoiProductLinks</c> runs last.
    ///
    /// <para>🔴 G-1 added ONE parameter, <paramref name="logDebug"/>, positioned next to the pair it
    /// completes rather than appended at the end (see <see cref="_logDebug"/> for why the channel exists).
    /// That insertion is safe because <c>FleetHost</c> — the only <c>new FleetCore(...)</c> in the tree,
    /// production or test — passes everything after <c>eventBus</c> by NAME; anything that had passed
    /// positionally would have failed to compile rather than silently shifted.</para></summary>
    public FleetCore(
        SwitchableTransport transport,
        TransportCoordinator transportCoordinator,
        EventBus eventBus,
        Action<string>? logWarning = null,
        Action<Exception, string>? logError = null,
        Action<Exception, string>? logDebug = null,
        Action<string, string, string?, bool, TransportMode>? onLiveSettingsRebuilt = null,
        MachineConfigStore? configStore = null,
        St4i.EdgeCore.Config.ProductConfigStore? productConfigStore = null,
        HistorianWriter? historianWriter = null,
        FleetSettingsStore? settingsStore = null,
        IUnsPublisher? unsPublisher = null,
        Action<MachineDescriptor>? onMachineSeeded = null,
        ConnectorRegistry? connectorRegistry = null,
        St4i.EdgeCore.Config.DemoModeGate? demoModeGate = null)
    {
        _transport = transport ?? throw new ArgumentNullException(nameof(transport));
        _transportCoordinator = transportCoordinator ?? throw new ArgumentNullException(nameof(transportCoordinator));
        _eventBus = eventBus ?? throw new ArgumentNullException(nameof(eventBus));
        _logWarning = logWarning;
        _logError = logError;
        _logDebug = logDebug;
        _onLiveSettingsRebuilt = onLiveSettingsRebuilt;
        _configStore = configStore;
        _productConfigStore = productConfigStore;
        _historianWriter = historianWriter;
        _settingsStore = settingsStore;
        _unsPublisher = unsPublisher;
        _onMachineSeeded = onMachineSeeded;
        _connectorRegistry = connectorRegistry;
        _demoModeGate = demoModeGate;

        // FF-1 — eager load, no lock needed: runs once, before this instance is published to any other
        // thread (same reasoning SeedAoiProductLinks below documents for itself). See _settingsStore's own
        // doc comment for why this only sets fields and leaves the actual transport rebuild to Program.cs.
        if (_settingsStore is not null)
        {
            var persisted = _settingsStore.Load();
            if (persisted is not null)
            {
                _serverUrl = persisted.ServerUrl;
                _machineCode = persisted.MachineCode;
                _verifyTls = persisted.VerifyTls;
            }
        }

        _fleet = LoadFleet().ToList();
        _states = new ConcurrentDictionary<string, MachineState>(StringComparer.OrdinalIgnoreCase);
        foreach (var descriptor in _fleet)
        {
            _states[descriptor.Code] = new MachineState(descriptor);
            // P2-1 — one notification per seeded machine; a null _onMachineSeeded (every pre-existing
            // test/no-DI-registration case) enqueues nothing at all, so this stays a byte-identical no-op.
            // 🔴 G-1 — enqueue, then drain once below, rather than invoking per machine here. This site is
            // NOT and never was a _gate violation (a constructor takes no lock) and G-1 does NOT claim to
            // have closed blueprint §9.2 note 4: the N synchronous SQLite transactions still run inside the
            // constructor of a DI singleton, on this thread, at exactly the same cost. What routing it
            // through the queue buys is that there is ONE notification path in this class, with one place
            // (DrainSeedNotifications) where the per-machine/ordering/never-before-registered invariants are
            // stated and tested — instead of two sites that have to agree by inspection.
            EnqueueSeedNotification(descriptor);
        }

        // Drained after the whole loop, so every seeded machine is already in _fleet AND _states before the
        // first callback runs. Strictly stronger than the per-machine invoke it replaces (which notified
        // machine 1 while machine 2 was still absent from _states) and never weaker; the instance is not
        // published to another thread yet either way.
        DrainSeedNotifications();

        SeedAoiProductLinks();
    }

    /// <summary>🔴 G-1 — records that <paramref name="descriptor"/> has entered the roster and owes exactly
    /// one <see cref="_onMachineSeeded"/> notification. Callers may hold <see cref="_gate"/>; this does
    /// nothing but a queue append (or, with no callback wired, nothing at all — see
    /// <see cref="_pendingSeedNotifications"/>). It must be called AFTER the descriptor is actually in
    /// <see cref="_fleet"/>/<see cref="_states"/>, which is what makes "never notified before the machine is
    /// registered" a property of the enqueue point rather than of the drain point.</summary>
    private void EnqueueSeedNotification(MachineDescriptor descriptor)
    {
        if (_onMachineSeeded is null) return;
        _pendingSeedNotifications.Enqueue(descriptor);
    }

    /// <summary>🔴 G-1 — invokes <see cref="_onMachineSeeded"/> for everything
    /// <see cref="EnqueueSeedNotification"/> has recorded. <b>MUST NOT be called while holding
    /// <see cref="_gate"/></b>: this is the method the host's own callback runs on, and for a real
    /// <c>AssetRegistryStore</c> that callback is a complete synchronous SQLite transaction (blueprint §9.2
    /// measured a reader of <see cref="EstopEngaged"/> — the same lock <see cref="Estop"/> takes — blocked
    /// up to 12.35 ms by it). Taking <see cref="_gate"/> here would reinstate exactly the defect this
    /// method exists to remove.
    ///
    /// <para><b>The three invariants moving the call out of the lock could have broken, and what keeps each
    /// one:</b>
    /// <list type="number">
    /// <item><b>Exactly one notification per seeded machine.</b> A descriptor is enqueued once (under
    /// <see cref="_gate"/>, only on the path where it was genuinely added to <see cref="_fleet"/>) and
    /// <see cref="ConcurrentQueue{T}.TryDequeue"/> hands it to exactly one caller. Two threads draining
    /// concurrently therefore cannot double-notify even without the lock below — but see the next
    /// item.</item>
    /// <item><b>Fleet order.</b> Enqueue happens under <see cref="_gate"/>, so the queue's FIFO order IS
    /// roster-append order. Draining under <see cref="_seedNotifyGate"/> is what stops two drainers from
    /// interleaving their invocations and delivering B's notification before A's. A drainer that finds the
    /// gate taken does not skip anything: the holder's <c>while</c> loop drains whatever arrived, which is
    /// why the waiter can find the queue empty and simply return.</item>
    /// <item><b>Never before the machine is registered.</b> Enqueue is placed after the
    /// <see cref="_fleet"/>/<see cref="_states"/> writes and the drain is strictly later still, so the
    /// callback can only ever observe a roster that already contains the machine it is being told
    /// about.</item>
    /// </list></para>
    ///
    /// <para>A caller can block here while another thread's callback runs. That is deliberate and is not a
    /// regression: before G-1 the same caller blocked on <see cref="_gate"/> for the same work, and unlike
    /// <see cref="_gate"/> this lock is invisible to <see cref="Estop"/>, <see cref="EstopEngaged"/> and
    /// every other lifecycle path.</para>
    ///
    /// <para>🔴 <b>The drain loop below is the FOURTH instance of the "host seam in a loop with no per-item
    /// guard" shape</b> (G-2's review I-3 in <see cref="DisposeOldSlots"/>, its sibling in
    /// <see cref="DisposeOrphanedConnectorDrivers"/>, NEW-1 in <see cref="StartSlot"/>'s fault handler — and
    /// this one, in G-1's code, missed by both of G-2's sibling sweeps because it is neither a disposal loop
    /// nor a fault handler. Found by the whole-branch review.) A throwing <see cref="_onMachineSeeded"/>
    /// abandons the loop with descriptors still queued.
    ///
    /// <b>Nothing can actually be stranded today, and this states WHY rather than that it cannot happen</b> —
    /// which is the sentence pattern this file flags at six other sites and had not written here. Every
    /// enqueue site drains after its own enqueue: the constructor drains after its loop (and a throw there
    /// fails construction, so the instance never becomes reachable), and <see cref="RegisterMachine"/> drains
    /// in a <c>finally</c> after its single enqueue, so a racing thread's own <c>finally</c> discharges
    /// whatever it enqueued. <b>That is a property of the current call sites, not of this method.</b> A third
    /// enqueue site that does not drain — or a batched drain — reinstates exactly the "delivered only if some
    /// LATER RegisterMachine happens to drain it" state that <see cref="RegisterMachine"/>'s <c>finally</c>
    /// exists to prevent. Left unfixed deliberately: a per-item guard here would have to decide what to do
    /// with a host callback's exception, and swallowing it is the one thing G-1's design refuses.</para></summary>
    private void DrainSeedNotifications()
    {
        if (_onMachineSeeded is null) return;

        lock (_seedNotifyGate)
        {
            while (_pendingSeedNotifications.TryDequeue(out var descriptor))
            {
                _onMachineSeeded(descriptor);
            }
        }
    }

    /// <summary>WS3-T2 (docs/PRODUCTION_UI_DESIGN.md §3.2/§3.4, ws3-t1-report.md's fast-follow #1) —
    /// WS3-T1 built the per-step cycle-plan machinery and proved AOI's plan carries a linked product's
    /// REAL points end-to-end, but nothing ever called <see cref="SetCurrentProduct"/> for the shipped
    /// roster, so AOI-01/AOI-02 ran un-linked by default and a live <c>GET /v1/machines/AOI-01</c>
    /// returned <c>"plan":null</c> — no per-point data for the living-twin schematic to draw, which is
    /// the whole point of this task. This seeds every <see cref="DeviceClass.AoiAvi"/> machine in the
    /// roster (fleet order) with one of <see cref="_productConfigStore"/>'s own catalog products,
    /// round-robin (1st AOI machine → the 1st product code alphabetically, i.e. seeded "MODEL-A"; 2nd
    /// AOI machine → "MODEL-B"; wrapping if there are more AOI machines than products) — a real,
    /// already-seeded product, never a fabricated one. A caller can still override any of these later via
    /// <see cref="SetCurrentProduct"/> (e.g. a future settings/onboarding endpoint) since this only seeds
    /// the SAME <see cref="_currentProduct"/> map that method writes.
    ///
    /// No-op (nothing to link) when no <see cref="ProductConfigStore"/> is wired or it has zero products
    /// — the same "ordinary case, not an error" contract <c>AoiInspectorSim.ResolveRealPoints</c> already
    /// documents for an unresolved product. Runs once, at construction, before this instance is published
    /// to any other thread — no lock needed, same reasoning <see cref="ProductConfigStore.Load"/> itself
    /// documents.</summary>
    private void SeedAoiProductLinks()
    {
        if (_productConfigStore is null) return;

        var products = _productConfigStore.ListProducts();
        if (products.Count == 0) return;

        var aoiMachines = _fleet.Where(d => d.DeviceClass == DeviceClass.AoiAvi).ToList();
        for (var i = 0; i < aoiMachines.Count; i++)
        {
            _currentProduct[aoiMachines[i].Code] = products[i % products.Count].Code;
        }
    }

    /// <summary>Point-in-time copy of the fleet roster. E1: no longer a fixed, ctor-built list —
    /// <see cref="RegisterMachine"/> can append to it after construction, so this getter takes
    /// <see cref="_gate"/> to hand back a stable snapshot rather than exposing the live, mutable
    /// backing list to a caller that might enumerate it while a registration is in flight.</summary>
    public IReadOnlyList<MachineDescriptor> Fleet
    {
        get { lock (_gate) return _fleet.ToArray(); }
    }

    public ITransport Transport => _transport;

    /// <summary>Test-only seam (default no-op) — lets <c>St4i.EngineApi.Tests</c> wrap the pipeline's
    /// <see cref="IDeviceDriver"/> in a fault-injecting decorator so the restart-race identity guard
    /// (completion-review.md #1/#7) can be reproduced deterministically instead of relying on real
    /// non-determinism. Applied once per <see cref="StartLocked"/> call, right after the real driver is
    /// built; production code never sets this (<c>internal</c>, requires <c>InternalsVisibleTo</c>).</summary>
    internal Func<IDeviceDriver, IDeviceDriver>? DriverDecoratorForTests { get; set; }

    /// <summary>G2-5 — test-only seam (default null) — lets <c>St4i.EngineApi.Tests</c> inject ADDITIONAL
    /// pipeline groups beyond the simulated one, so the multi-slot fault-isolation machinery can be
    /// exercised deterministically before a real second driver (Modbus, G2-6) exists. Production never
    /// sets this (<c>internal</c>, requires <c>InternalsVisibleTo</c>). Each tuple: a slot label, its
    /// driver, and the fallback MappingProfile for its readings.</summary>
    internal Func<IReadOnlyList<(string Label, IDeviceDriver Driver, MappingProfile Profile)>>? AdditionalPipelinesForTests { get; set; }

    /// <summary>🔴 J-1 — test-only seam (default null), invoked as the LAST statement of
    /// <see cref="BuildStartPlan"/>, i.e. after the whole hoisted build (P4 and P5) has run and while
    /// <see cref="_gate"/> is NOT held. Production never sets it (<c>internal</c>, requires
    /// <c>InternalsVisibleTo</c>).
    ///
    /// <para><b>Why a third seam rather than reusing one of the two above.</b> Both existing seams fire
    /// INSIDE <see cref="StartLocked"/>, under the lock — that is exactly what makes them useful as throw
    /// sites for the S-set tests, and exactly what makes them useless here. J-1's central claim is about
    /// where a piece of work runs relative to a lock, and the only way to witness that is a callback the
    /// build itself reaches with the lock released. A test can therefore do from here what no caller could
    /// do before: take <see cref="_gate"/> from ANOTHER thread and observe it granted while a start is
    /// mid-flight (which is the measurement, not a proxy for it), or mutate the roster and then assert the
    /// machine it added is still driven (which is the roster-window witness).</para>
    ///
    /// <para><b>What it is NOT.</b> It is not a synchronisation point and nothing in this class waits on it.
    /// A <see langword="null"/> delegate — production, always — costs one branch per start.</para></summary>
    internal Action? StartBuildObserverForTests { get; set; }

    /// <summary>G2-5 / SM-1 — see <see cref="_running"/>'s own doc comment for the full definition. With a
    /// non-empty roster (every roster before this task, and demo mode always) this is byte-identical to the
    /// original stored-flag behavior: the slot's fault-catch removes it (see <see cref="StartLocked"/>), so
    /// the last slot faulting flips this false exactly as before.</summary>
    public bool IsRunning { get { lock (_gate) return _running; } }

    /// <summary>Branch-review C-2 — the HALT latch, now owned by the engine (not any one browser
    /// tab's React state) so it's shared across every panel that polls <see cref="ReadSnapshot"/> and
    /// survives a page reload. Only <see cref="Estop"/> sets it; only <see cref="ResetEstop"/> clears
    /// it — never touched implicitly by <see cref="Start"/>/<see cref="Stop"/>, so an operator/API
    /// stop is never mistaken for this latch engaging.
    ///
    /// SM-4 — TRUTH, for anyone reading this property: it is a SUPERVISORY SOFTWARE latch. It reflects
    /// only whether <see cref="Estop"/> has torn down this software's own read pipeline. It is NOT a
    /// safety-rated device, has no bearing on the physical state of any real machine, and cannot have
    /// one — not because no write path exists anymore (Task B-1/B-4/B-5 built one — Modbus/OPC-UA
    /// setpoints and commands via <see cref="IWritableDeviceDriver"/>), but because THIS property, and
    /// <see cref="Estop"/>/<see cref="ResetEstop"/> which set it, deliberately never call that write path
    /// at all — see <see cref="Estop"/>'s own doc comment for why turning HALT into a software "stop the
    /// machine" command would be worse, not safer. A real emergency stop is a hardwired, safety-rated
    /// circuit per ISO 13849; software must never be the safety path. See README §1.</summary>
    public bool EstopEngaged { get { lock (_gate) return _estopEngaged; } }

    private bool _estopEngaged;

    /// <summary>XC-R40 — the single read-only accessor for the supervisory safety state (see
    /// <see cref="SafetySnapshot"/>). Pure read: takes <see cref="_gate"/> only to
    /// read a consistent estop+running pair, never mutates. No corresponding setter exists — the latch
    /// changes ONLY through <see cref="Estop"/>/<see cref="ResetEstop"/>.</summary>
    public SafetySnapshot GetSafetyStatus()
    {
        lock (_gate) { return new SafetySnapshot(_estopEngaged, IsRunning); }
    }

    /// <summary>GĐ3 sub-4 LC-2 — per-slot driver health, read-only: the FIRST production reader of
    /// <see cref="IDeviceDriver.Health"/> (added for <see cref="Alarms.AlarmEvaluator"/>'s DriverHealth
    /// alarm source). Pure read under <see cref="_gate"/> — same lock every other read of <see cref="_slots"/>
    /// in this class already takes, mirroring <see cref="GetSafetyStatus"/>'s own "pure read, never mutates"
    /// contract. Returns one entry per CURRENTLY live slot — nothing here reaches into a slot that has been
    /// removed; <see cref="Alarms.AlarmEvaluator"/> is what
    /// notices a slot's disappearance (by diffing this list against its own last pass) and clears that
    /// slot's alarms on its behalf.
    ///
    /// <para>🔴 <b>J-2 — this used to add "(an empty list while the fleet is stopped)" and that parenthesis
    /// is FALSE in exactly one state</b>, the one S3's residual (2) is about: a <see cref="StartLocked"/>
    /// that throws part-way through installing slots leaves <see cref="_slots"/> populated with
    /// <c>_running == false</c>, so this method reports live drivers for a fleet that reports itself stopped
    /// — and it is the FIRST place that divergence surfaces to a reader, since
    /// <see cref="Alarms.AlarmEvaluator"/> diffs this list. J-2 makes that state CLEANABLE (a
    /// <see cref="Stop"/>/<see cref="Estop"/> now tears those slots down) but not unreachable, so the
    /// parenthesis is removed rather than reworded: this list tracks SLOTS, and
    /// <see cref="IsRunning"/> tracks an operator's request, and they are not the same
    /// question.</para></summary>
    public IReadOnlyList<DriverHealthSnapshot> GetDriverHealth()
    {
        lock (_gate)
        {
            return _slots.Select(s => new DriverHealthSnapshot(s.Label, s.Driver.Kind, s.Driver.Health)).ToList();
        }
    }

    /// <summary>GP-5 (task-5-brief.md item 3, carried from the GP-4 review) — every currently-registered
    /// connector id that is configured but NOT currently running, because its most recent start attempt
    /// failed (a bad/malformed <c>connectors.json</c>/env-var configuration, or a third-party factory that
    /// rejected/threw — see <see cref="StartLocked"/>'s connector loop). Before this method existed, that
    /// failure produced exactly one startup <c>LogWarning</c> and nothing else: no <see cref="GetDriverHealth"/>
    /// entry (no slot was ever created for it), no alarm, no health signal — on an edge box, a
    /// <c>connectors.json</c> typo presented to an operator as "my connector just isn't there," discoverable
    /// only by reading the log file.
    ///
    /// <para>Deliberately informational, not a fault: this is surfaced through its own projection
    /// (<c>GET /v1/connectors</c>), never through <see cref="LastError"/>/<c>GET /v1/health</c> — the GP-4
    /// review specifically judged that an optional peripheral's bad config must not flip the whole host
    /// unhealthy, and this method changes nothing about that. Empty (never <see langword="null"/>) whenever
    /// no connector is currently failing to start — including the ordinary case where
    /// <see cref="_connectorRegistry"/> is null/empty, or the fleet has never been started at all (no
    /// <see cref="StartLocked"/> attempt has run yet, so nothing has had a chance to fail).</para></summary>
    public IReadOnlyList<ConnectorStartIssue> GetConfiguredConnectorIssues() =>
        _connectorStartIssues.Select(kv => new ConnectorStartIssue(kv.Key, kv.Value)).ToList();

    // ─────────────────────────────────────────────────────────────────────
    // MACHINE-CODE -> LIVE DRIVER RESOLUTION (Task B-2) — the path that did not exist before this task:
    // GetDriverHealth above is keyed by SLOT LABEL (an implementation detail — "simulated"/"modbus"/"opcua"/
    // a connector id, never a machine code), and nothing else in this class ever handed back a live
    // IDeviceDriver reference outside a test seam. This section is the ONLY place a machine code resolves to
    // a live driver, and it deliberately never exposes the raw driver beyond this class — a caller gets
    // either a MachineDriverAvailability (discovery, no I/O) or the RESULT of an attempted write (I/O already
    // done, driver reference already discarded), never the driver itself.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Resolves <paramref name="machineCode"/> to its slot's driver, entirely UNDER <see cref="_gate"/>
    /// (list scans + string compares — no I/O, so this is cheap to hold the lock for, same as
    /// <see cref="GetDriverHealth"/>). The slot label is derived by <see cref="ResolveSlotLabelFor"/> — the
    /// SAME method <see cref="StartLocked"/> itself calls to decide which slot a roster machine's
    /// <see cref="St4i.EdgeCore.Models.MachineDescriptor.DriverKind"/> belongs to. Review fix round 1
    /// (Important, task-2-report.md) — this method used to re-derive its OWN, simpler approximation of that
    /// rule inline (checking only <c>DriverKind == Simulated</c> before falling through to
    /// <see cref="ResolveConnectorSlotLabel"/>), which disagreed with <see cref="StartLocked"/>'s REAL rule for
    /// exactly the case that rule exists to handle: a third-party-kind machine with no connector currently
    /// registered for its kind is driven by the simulated group (a real, tested, intentional fallback), but
    /// the old inline approximation would compute that machine's OWN kind as its expected label instead of
    /// <see cref="SimulatedSlotLabel"/>, find no such slot, and report <see cref="MachineDriverAvailability.NoLiveDriver"/>
    /// for a machine that was actually live and cycling. Calling <see cref="ResolveSlotLabelFor"/> closes this
    /// by construction — there is now exactly one place this decision is made, not two that can drift apart.
    ///
    /// <para>Review fix round 1 (Critical, task-2-report.md) — <b>a live, writable driver is reported ONLY
    /// when exactly one roster member resolves to the same slot.</b> <see cref="ConnectorRegistry"/> keeps at
    /// most one live driver per protocol <c>Kind</c> for the WHOLE fleet, and neither
    /// <see cref="St4i.Connector.Abstractions.Models.SetpointWriteRequest"/> nor
    /// <see cref="St4i.Connector.Abstractions.Models.CommandRequest"/> carries a machine code — so if TWO
    /// roster members share a resolved slot (two same-kind entries in a hand-edited <c>fleet.json</c>, or two
    /// <see cref="RegisterMachine"/> calls for the same kind), this method has no way to tell which of them the
    /// one live driver instance actually talks to. Reporting <see cref="MachineDriverAvailability.Writable"/>
    /// in that situation would risk delivering a write to the WRONG physical machine — the worst possible
    /// failure mode for this capability — so <see cref="MachineDriverAvailability.AmbiguousDriver"/> is reported
    /// instead, and no driver reference is handed back. This is deliberately the MINIMUM safe check (count
    /// roster members sharing the resolved slot label); verifying that a specific driver INSTANCE serves
    /// machine code X specifically is deferred to B-3's map work, which is the first place such a binding could
    /// plausibly be declared — see <see cref="MachineDriverAvailability.AmbiguousDriver"/>'s own doc comment.</para>
    ///
    /// <para>Returns the live <see cref="IWritableDeviceDriver"/> reference ONLY when
    /// <see cref="MachineDriverAvailability.Writable"/> — every other case returns <see langword="null"/>. The
    /// caller (<see cref="TryWriteSetpointAsync"/>/<see cref="TryInvokeCommandAsync"/>) MUST release
    /// <see cref="_gate"/> (this method already has, by the time it returns) before doing anything with that
    /// reference other than a capability check — see those methods' own doc comments for the disposal race
    /// this resolution step does NOT, by itself, protect a caller from.</para></summary>
    private (MachineDriverAvailability Availability, IWritableDeviceDriver? Driver) ResolveWritableDriver(string machineCode)
    {
        lock (_gate)
        {
            var descriptor = _fleet.FirstOrDefault(d => string.Equals(d.Code, machineCode, StringComparison.OrdinalIgnoreCase));
            if (descriptor is null)
            {
                return (MachineDriverAvailability.MachineNotFound, null);
            }

            // Task D-1 — is this machine claimed by a specific connector INSTANCE? That is the whole
            // difference between "a driver of the right protocol exists somewhere" (what this method could
            // ask before D-1) and "THIS machine's driver is that one" (what it can ask now).
            // 🔴 D-1 review, m3 — ONE snapshot of the registry, used for every question below. Three
            // independent reads would be three independent points in time (this method holds _gate;
            // ConnectorRegistry.Register takes its own lock and nothing else), and resting a routing
            // invariant on "no interleaving is harmful today" is a property of the current call sites, not
            // of this method. See ConnectorRegistry.SnapshotBindings' own remarks.
            var bindings = _connectorRegistry?.SnapshotBindings();

            string? boundInstanceId = null;
            var boundToAnInstance =
                bindings is not null && TryFindBoundInstance(bindings, descriptor.Code, out boundInstanceId);

            var expectedLabel = boundToAnInstance
                ? ResolveConnectorSlotLabel(boundInstanceId!)
                : ResolveSlotLabelFor(descriptor.DriverKind);

            // Task D-1 — the honest answer for a machine that is NOT claimed but whose kind-derived label
            // belongs to a connector instance that IS bound to some OTHER machine: nothing is driving this
            // machine at all. A bound instance only ever emits readings for its own machine code, so a
            // second Modbus roster entry sitting next to a Modbus connector configured for a different code
            // is genuinely idle — reporting it against that connector's slot (as the pre-D-1 rule did, which
            // then had to refuse the write as AmbiguousDriver) named the wrong problem. This clause is
            // deliberately scoped to a BOUND owner: an UNBOUND instance claims no machine, so the pre-D-1
            // behaviour — including its ambiguity guard — is left completely intact for it.
            if (!boundToAnInstance && AnyBoundInstanceOwnsSlotLabel(bindings, expectedLabel))
            {
                return (MachineDriverAvailability.NoLiveDriver, null);
            }

            // 🔴 J-2 (branch review, Important 3) — THIS IS THE SECOND EXTERNAL READER OF `_slots`, AND IT IS
            // NOT A REPORTING SURFACE, WHICH IS WHY THE ROUND'S SWEEP NEVER REACHED IT. The other is
            // GetDriverHealth. This one reads `_slots` and checks NEITHER `_running` NOR `_estopEngaged`, so
            // it changes in the stuck state (`_slots` non-empty with `_running == false` — S3's residual (2))
            // exactly as that projection does, and nobody had said so.
            //
            // WHAT IT MEANT BEFORE J-2, stated plainly because it is the sharper half of that finding: an
            // Estop() made in the stuck state left the stranded slots in `_slots`, so THIS METHOD STILL
            // RESOLVED A LIVE WRITABLE DRIVER AFTER A HALT — GetMachineDriverAvailability,
            // TryWriteSetpointAsync and TryInvokeCommandAsync all resolve through here. What stopped a write
            // was EstopGuardRule, one assembly up, reading Safety.EstopEngaged. The engine-level answer and
            // the guard disagreed, and only the guard was load-bearing.
            //
            // AFTER J-2 the halt clears `_slots`, so this resolves NoLiveDriver and the two agree. ESTOP IS
            // STRENGTHENED, NEVER WEAKENED — the standing constraint holds, EstopGuardRule is untouched, and
            // this is not a regression in either direction. It is disclosed because the round CLAIMED a
            // complete newly-reachable set and derived that set over surfaces that REPORT. `_slots` has
            // readers that report nothing, and a write path is the one place where "who reads the state I
            // changed" and "who prints something" come apart most expensively.
            var slot = _slots.FirstOrDefault(s => string.Equals(s.Label, expectedLabel, StringComparison.Ordinal));
            if (slot is null)
            {
                return (MachineDriverAvailability.NoLiveDriver, null);
            }

            if (slot.Driver is not IWritableDeviceDriver writable)
            {
                return (MachineDriverAvailability.ReadOnly, null);
            }

            // Task D-1 — a machine claimed by a connector instance needs NO sharing count: at most one
            // instance can claim a machine code (ConnectorRegistry.Register refuses a second claim) and an
            // instance holds exactly one code, so exactly one roster member can ever land on this slot by
            // this branch. That is what "instance-keying is what makes routing possible" means concretely —
            // the count below was a REFUSAL standing in for a binding this codebase did not have; now it has
            // the binding.
            if (boundToAnInstance)
            {
                return (MachineDriverAvailability.Writable, writable);
            }

            // C1 fix (Đợt B review round 1), UNCHANGED and still standing — see this method's own doc
            // comment. Reached only when no connector instance claims this machine, i.e. the pre-D-1 world:
            // a slot injected by AdditionalPipelinesForTests, or an unbound registration. Only evaluated in
            // the Writable branch: sharing a slot is completely safe when nothing can be written through it
            // at all (e.g. ten demo machines legitimately sharing the one "simulated" slot), so this must
            // never downgrade ReadOnly/NoLiveDriver.
            var sharingMachineCount = _fleet.Count(
                d => string.Equals(ResolveSlotLabelForMachine(d, bindings), expectedLabel, StringComparison.Ordinal));
            if (sharingMachineCount > 1)
            {
                return (MachineDriverAvailability.AmbiguousDriver, null);
            }

            return (MachineDriverAvailability.Writable, writable);
        }
    }

    /// <summary>Pure discovery — answers "does machine code X have a live, writable driver right now" with NO
    /// I/O and no side effect, so a caller (a future write endpoint, B-6) can show an operator the right
    /// explanation BEFORE ever attempting a write. See <see cref="MachineDriverAvailability"/> for what each
    /// value means.</summary>
    public MachineDriverAvailability GetMachineDriverAvailability(string machineCode)
    {
        ArgumentException.ThrowIfNullOrEmpty(machineCode);
        return ResolveWritableDriver(machineCode).Availability;
    }

    /// <summary>
    /// Resolves <paramref name="machineCode"/> to a live <see cref="IWritableDeviceDriver"/> UNDER
    /// <see cref="_gate"/>, releases the lock, and only THEN calls <see cref="IWritableDeviceDriver.WriteSetpointAsync"/>
    /// — never the other way round, and never both at once. This is the one non-negotiable shape this task
    /// exists to build: no I/O ever runs while <see cref="_gate"/> — the same lock <see cref="Estop"/> takes —
    /// is held, so a slow/hung write can never delay HALT.
    ///
    /// <para>Returns <c>(Availability, null)</c> without touching any driver when <see cref="MachineDriverAvailability"/>
    /// is anything other than <see cref="MachineDriverAvailability.Writable"/> — <see cref="MachineDriverAvailability.MachineNotFound"/>/
    /// <see cref="MachineDriverAvailability.NoLiveDriver"/>/<see cref="MachineDriverAvailability.ReadOnly"/> are
    /// resolution-level facts, never a write attempt, so no <see cref="St4i.Connector.Abstractions.Models.WriteOutcome"/>
    /// applies (that vocabulary describes a write that was actually attempted against a live driver).</para>
    ///
    /// <para><b>The disposal race, solved deliberately.</b> Between this method resolving a live driver
    /// reference and <see cref="IWritableDeviceDriver.WriteSetpointAsync"/> returning, the SAME slot can be
    /// torn down by <see cref="Stop"/>, <see cref="Estop"/>, a <see cref="RegisterMachine"/>-triggered
    /// restart, or a per-slot fault (<c>StartSlot</c>'s own catch). Review fix round 1 correction: these four
    /// do NOT all run identical code, and this method's correctness does not depend on them doing so.
    /// <see cref="Stop"/>/<see cref="Estop"/>/a <see cref="RegisterMachine"/> restart funnel through
    /// <c>WaitAndDisposeOldPipeline</c>, which runs SYNCHRONOUSLY on the calling thread and bounds both the
    /// run-task wait and the driver's <c>DisposeAsync</c> at <c>RestartTeardownTimeout</c> via <c>.Wait(timeout)</c>.
    /// A per-slot fault is structurally different: <c>StartSlot</c>'s own catch disposes the driver via an
    /// UNBOUNDED <c>await driver.DisposeAsync().ConfigureAwait(false)</c>, running on the SLOT'S OWN background
    /// task — not on any caller's thread at all. Both shapes independently guarantee NONE of them wait for an
    /// in-flight write: the first two dispose the driver unconditionally, on their own bounded schedule, never
    /// checking whether a <see cref="WriteSetpointAsync"/>/<see cref="InvokeCommandAsync"/> call is still in
    /// flight; the third has no caller to delay in the first place, since it runs on its own background task
    /// with nothing blocked waiting for it. A lease/reference-count that made disposal WAIT for a write was
    /// considered and rejected for the first two paths: waiting, even boundedly, would couple HALT's latency to
    /// however slow the write is up to that bound, which is precisely the class of bug this project already
    /// shipped once (the orphaned-connector-driver Critical). Tearing down unconditionally instead means
    /// <see cref="Estop"/>'s own latency is COMPLETELY independent of any in-flight write — not just bounded,
    /// never coupled at all.</para>
    ///
    /// <para>What an in-flight write observes when this happens: <see cref="IWritableDeviceDriver"/>'s own
    /// contract already requires an implementation to catch whatever a concurrently-torn-down connection
    /// produces (an <see cref="OperationCanceledException"/>, an <see cref="IOException"/>, an
    /// <see cref="ObjectDisposedException"/>) and return <see cref="St4i.Connector.Abstractions.Models.WriteOutcome.Indeterminate"/>
    /// itself — never let it propagate. This method adds a DEFENSIVE backstop on top of that contract, the
    /// same "never trust a driver's own promise alone" doubling <see cref="ConnectorRegistry.TryCreateDriver"/>/
    /// <see cref="StartLocked"/> already apply to third-party code: if the call throws ANY exception anyway
    /// (a driver written before this race was accounted for, or one that simply gets it wrong), this method
    /// catches it here, LOGS it (a driver violating its own no-throw contract must leave more than an
    /// operator-visible string behind), and returns <see cref="St4i.Connector.Abstractions.Models.WriteOutcome.Indeterminate"/>
    /// with a generic, redacted <c>Detail</c> — never a crash out to the caller, never a false
    /// <see cref="St4i.Connector.Abstractions.Models.WriteOutcome.Applied"/>, and never the driver's raw
    /// <c>ex.Message</c> echoed verbatim to an operator (a map/connector config can carry credentials — see
    /// <c>ConnectorConfigStore</c>'s own redaction — and an arbitrary driver exception is not a channel this
    /// method controls the contents of). See <c>FleetHostMachineDriverResolutionTests</c>'s disposal-race
    /// tests for the genuinely-concurrent proof of this.</para>
    /// </summary>
    public async Task<(MachineDriverAvailability Availability, SetpointWriteResult? Result)> TryWriteSetpointAsync(
        string machineCode, SetpointWriteRequest request, CancellationToken ct = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(machineCode);
        ArgumentNullException.ThrowIfNull(request);

        var (availability, driver) = ResolveWritableDriver(machineCode);
        if (driver is null)
        {
            return (availability, null);
        }

        try
        {
            var result = await driver.WriteSetpointAsync(request, ct).ConfigureAwait(false);
            return (availability, result);
        }
        catch (Exception ex)
        {
            // Review fix round 1 (Important) — logged (full ex, server-side only) so a driver violating
            // IWritableDeviceDriver's own no-throw contract leaves a diagnosable trace, not just an
            // operator-visible string. Detail deliberately does NOT interpolate ex.Message: an arbitrary
            // driver exception is not a channel this method controls the contents of (a map/connector config
            // can carry credentials — same reasoning ConnectorConfigStore's own redaction already applies),
            // so only the exception's TYPE name (safe, non-sensitive) reaches the operator-visible result.
            _logError?.Invoke(ex, $"WriteSetpointAsync on machine '{machineCode}' point '{request.Point}' did not complete cleanly");
            return (availability, new SetpointWriteResult(
                request.Point,
                WriteOutcome.Indeterminate,
                Detail: $"WriteSetpointAsync did not complete cleanly ({ex.GetType().Name}) — the driver may " +
                        "have been disposed concurrently by Stop/Estop/a restart/a per-slot fault. See the log for detail."));
        }
    }

    /// <summary>Mirrors <see cref="TryWriteSetpointAsync"/> exactly — same resolve-under-<see cref="_gate"/>/
    /// I/O-off-<see cref="_gate"/> shape, same disposal-race handling, same defensive backstop — for
    /// <see cref="IWritableDeviceDriver.InvokeCommandAsync"/> instead. Kept as a genuinely separate method
    /// (not a shared private helper parameterized by delegate) for the same reason B-1 kept
    /// <see cref="SetpointWriteRequest"/>/<see cref="CommandRequest"/> as two distinct types: setpoint and
    /// command are never conflated anywhere in this contract, including here.</summary>
    public async Task<(MachineDriverAvailability Availability, CommandResult? Result)> TryInvokeCommandAsync(
        string machineCode, CommandRequest request, CancellationToken ct = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(machineCode);
        ArgumentNullException.ThrowIfNull(request);

        var (availability, driver) = ResolveWritableDriver(machineCode);
        if (driver is null)
        {
            return (availability, null);
        }

        try
        {
            var result = await driver.InvokeCommandAsync(request, ct).ConfigureAwait(false);
            return (availability, result);
        }
        catch (Exception ex)
        {
            // Review fix round 1 (Important) — same reasoning as TryWriteSetpointAsync's own catch: logged
            // server-side, redacted operator-visible Detail (type name only, never ex.Message verbatim).
            _logError?.Invoke(ex, $"InvokeCommandAsync on machine '{machineCode}' command '{request.Command}' did not complete cleanly");
            return (availability, new CommandResult(
                request.Command,
                WriteOutcome.Indeterminate,
                Detail: $"InvokeCommandAsync did not complete cleanly ({ex.GetType().Name}) — the driver may " +
                        "have been disposed concurrently by Stop/Estop/a restart/a per-slot fault. See the log for detail."));
        }
    }

    /// <summary>SM-2 fix round 1 (review CRITICAL) — the SAME "not blend, not suppress" mode-aware rule
    /// <see cref="ReadSnapshot"/> applies to <c>FleetKpisDto</c>, factored out so both call sites can
    /// never drift apart: a real (non-Simulated) machine ANYWHERE in the current roster means "there is
    /// something to blend with," so a caller must use the real-only counters; no real machine (a pure demo
    /// roster, or an empty product roster) means there is nothing to blend WITH, so the original blended
    /// counters are correct AND byte-identical to before this task. Reads <see cref="Fleet"/> once (a
    /// single <see cref="_gate"/> acquisition) rather than each caller re-deriving its own roster scan.</summary>
    private (bool HasFabricatedMachine, bool HasRealMachine) ClassifyRoster()
    {
        var fleet = Fleet;
        return (
            fleet.Any(d => DriverKinds.IsFabricated(d.DriverKind)),
            fleet.Any(d => !DriverKinds.IsFabricated(d.DriverKind)));
    }

    /// <summary>GĐ3 sub-4 LC-2 — the fleet-wide KPI counters <see cref="Alarms.AlarmEvaluator"/>'s windowed
    /// NG-rate source polls (diffing successive calls to compute a DELTA rather than a fleet-lifetime
    /// rate), which feeds a genuinely customer-facing alarm ("Fleet NG-rate X% ... exceeds the Y% limit").
    ///
    /// SM-2 fix round 1 (review CRITICAL) — this used to return the raw BLENDED
    /// <see cref="_totalPass"/>/<see cref="_totalJudged"/> unconditionally, the one customer-facing surface
    /// this task's own diff had left un-audited: in "demo fleet plus one real machine" — the brief's own
    /// opening scenario — a healthy demo stream could mask a genuine quality problem on the real machine,
    /// or a stable demo stream could trip/clear an alarm that has nothing to do with it. Now mode-aware via
    /// the SAME <see cref="ClassifyRoster"/> rule <see cref="ReadSnapshot"/> uses: a real machine anywhere in
    /// the current roster returns the real-only counters instead — never blended, and computed under the
    /// SAME <see cref="_kpiGate"/> lock either branch already used.</summary>
    public (long TotalPass, long TotalJudged) GetKpiCounters()
    {
        var (_, hasRealMachine) = ClassifyRoster();

        lock (_kpiGate)
        {
            return hasRealMachine ? (_totalPassReal, _totalJudgedReal) : (_totalPass, _totalJudged);
        }
    }

    /// <summary>The fault <c>GET /v1/health</c> answers from — that endpoint is literally
    /// <c>LastError is null</c>. <b>TWO producers, named rather than counted, because a reader who finds one
    /// of them stops looking:</b> <see cref="StartSlot"/>'s per-slot catch, for a slot that started and later
    /// faulted at runtime; and <see cref="RebuildPipelineOffLock"/>'s fault path, for an internal restart
    /// that tore the pipeline down and could not rebuild it (🔴 U-1, <c>docs/owner-decisions.md</c> item 7 —
    /// see that catch for why this field rather than a projection of its own, and for the identity guard both
    /// producers share). One event in two shapes: a pipeline stopped for a reason nobody asked for.
    ///
    /// <para><b>Not a producer, and deliberately:</b> a connector that could not be built. That is reported
    /// by <see cref="GetConfiguredConnectorIssues"/>/<c>GET /v1/connectors</c> and must never flip the whole
    /// host unhealthy — see the connector loop in <see cref="StartLocked"/>.</para>
    ///
    /// <para><b>Cleared in exactly one place:</b> <see cref="StartLocked"/>, past its own latch. So a start
    /// that actually installs clears it, and one the HALT latch refuses does not.</para></summary>
    public Exception? LastError { get; private set; }

    public TransportMode Mode => _transportCoordinator.Mode;

    public ScenarioConfig CurrentScenario => _scenario;

    public string ActivePresetName => _activePresetName;

    /// <summary>🔴 E-2 — the per-machine live state, handed to the shell so it can project it
    /// (<c>GET /v1/machines/{code}</c>) and drive <c>POST /v1/machines/{code}/sync-config</c> without this
    /// class naming a single wire type. Deliberately the SAME lock-free <see cref="_states"/> read
    /// <c>FleetHost.MachineDetail</c>/<c>SyncConfigAsync</c> always performed — <see cref="_states"/> is a
    /// <see cref="ConcurrentDictionary{TKey,TValue}"/> precisely so those hot GET paths never take
    /// <see cref="_gate"/>, and moving the read behind this method changes neither the lock nor the
    /// dictionary semantics.</summary>
    public bool TryGetMachineState(string code, [NotNullWhen(true)] out MachineState? state) =>
        _states.TryGetValue(code, out state);


    // ─────────────────────────────────────────────────────────────────────
    // START/STOP
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Completion-review #1/#7 — the OLD run-task/CTS a <see cref="StopLocked"/> tears down,
    /// handed back to the caller instead of being discarded so it can be awaited/disposed OUTSIDE
    /// <see cref="_gate"/> (see <see cref="WaitAndDisposeOldPipeline"/>'s remarks on why that has to
    /// happen off-lock).
    ///
    /// <para>🔴 G-1 — also carries whatever <see cref="StopLocked"/> wanted to LOG, for the same reason it
    /// carries the slots: a log call is a host-supplied callback, and under <c>AddWindowsService</c> a host
    /// wires it to a provider that writes the Windows Event Log SYNCHRONOUSLY. That is I/O, and it was
    /// happening while <see cref="_gate"/> was held. See <see cref="DeferredLogEntry"/>.</para></summary>
    private readonly record struct PipelineHandle(
        IReadOnlyList<PipelineSlot>? OldSlots,
        IReadOnlyList<DeferredLogEntry>? DeferredLogs);

    /// <summary>🔴 G-1 — one log line that a <see cref="_gate"/>-holding code path wanted to emit, held
    /// until the lock is released. <see cref="Error"/> <see langword="null"/> means the message belongs on
    /// <see cref="_logWarning"/>; non-null means <see cref="_logError"/> — so a single ordered list
    /// reproduces the exact interleaving of the two channels that the in-lock calls produced.
    ///
    /// <para>Appending to that list is UNCONDITIONAL — it is not guarded by whether a callback is wired.
    /// That is the D-7a rule applied forwards: <c>?.</c> short-circuits the whole argument list, so any work
    /// written inside a log call's arguments silently stops happening for a host built without a callback.
    /// Buffering first and choosing the channel later is immune to that by construction.</para></summary>
    private readonly record struct DeferredLogEntry(Exception? Error, string Message);

    /// <summary>🔴 G-1 — the two things an install owes its caller to finish OFF <see cref="_gate"/>: the
    /// orphaned connector drivers that must be disposed (review fix round 2) and
    /// the log lines it deferred rather than emitting under the lock. Both halves exist for the same
    /// reason — an operation that reaches outside this process must not run while <see cref="Estop"/>'s
    /// lock is held. See <see cref="CompleteStartOffLock"/>. (🔴 T-1 fix round 1: this opened with "what
    /// <see cref="StartLocked"/> HANDS BACK", which T-1 falsified one paragraph before saying so in bold.)
    ///
    /// <para>🔴 <b>J-2 then T-1 — BOTH HALVES ARE THE CALLER'S NOW, AND THIS TYPE IS NO LONGER A RETURN
    /// VALUE.</b> J-2 moved <see cref="OrphanedConnectorDrivers"/> out: allocated by the caller, passed INTO
    /// <see cref="StartLocked"/>, which only fills it. T-1 moved <see cref="DeferredLogs"/> the same way, for
    /// a different reason argued at <see cref="StartLocked"/> and in the S-set banner's residual (3) —
    /// releasing a socket is owed whatever happened, whereas saying what happened before a failed install is
    /// an owner's call about operator-facing output, and the owner made it. What survives is one pair
    /// handed to <see cref="CompleteStartOffLock"/>, built at each caller from two locals a throw cannot
    /// reach.</para>
    ///
    /// <para>🔴 <b>Review I-3 named the follow-up that T-1 took, and named its price too.</b> I-3 measured
    /// that the RETURNED orphan half was already dead — neither caller read it — and recorded that having
    /// <see cref="StartLocked"/> stop returning it would make the "simplification" back to
    /// <c>CompleteStartOffLock(outcome)</c> a COMPILE ERROR rather than a red test, at the cost of an
    /// executable change to the method that sits between every public entry and the HALT latch. T-1 makes
    /// that same change to the OTHER half, so the return value would have been dead in both halves; it
    /// returns <see langword="void"/> instead of carrying a value nothing reads. The price I-3 quoted was
    /// paid: the HALT-latch mutation was re-run on this tree rather than cited from an earlier one, which is
    /// the failure mode <c>FleetHostStartBuildHoistTests.AnEstopLandingDuringARestartsRebuild_…</c> exists to
    /// record.
    ///
    /// <para><b>The regression I-3 was guarding is still guarded, and now by the compiler:</b> there is no
    /// <c>outcome</c> for a completion to read back. The behavioural witness stays where it was —
    /// <c>FleetHostGateCommitCompletionTests.AStartThatThrowsWhileInstallingSlots_StillDisposesTheConnectorDriverItOrphaned</c>
    /// for the orphan half, and its T-1 sibling for the deferred half — because a compile error protects the
    /// shape and a red test protects the consequence.</para></para></summary>
    private readonly record struct StartOutcome(
        List<IDeviceDriver> OrphanedConnectorDrivers,
        List<DeferredLogEntry> DeferredLogs);

    /// <summary>🔴 J-1 — the inputs a pipeline build depends on, copied out of <see cref="_gate"/>-protected
    /// state in one acquisition so the build itself can run off the lock. See
    /// <see cref="SnapshotStartInputsLocked"/> for the enumeration of what is in here and — more
    /// importantly — what deliberately is not.</summary>
    private readonly record struct StartInputs(
        List<MachineDescriptor> Fleet,
        double Multiplier,
        IReadOnlyList<ConnectorRegistry.ConnectorBinding>? Bindings,
        long StopRequests);

    /// <summary>🔴 J-1 — the product of <see cref="BuildStartPlan"/>: everything the pipeline needs that
    /// costs I/O to produce, built with <see cref="_gate"/> RELEASED.
    ///
    /// <para><b>This is a CACHE, not a substitute for reading the roster.</b> That distinction is the whole
    /// of J-1's answer to the roster-changed-underneath window. <see cref="StartLocked"/> still derives
    /// <c>effectiveFleet</c>/<c>simFleet</c> from the LIVE <see cref="_fleet"/> under the lock, exactly as it
    /// did before J-1; this record only lets it skip the I/O for the entries it already has. An entry is
    /// reused only when the live input it would be rebuilt from is IDENTICAL, so a plan that has gone stale
    /// cannot produce a wrong pipeline — it produces a slower one, degrading per machine rather than
    /// all-or-nothing, and never silently.</para>
    ///
    /// <para>🔴 <b>WHAT IT COSTS, labelled because only the win was written down (branch review,
    /// Important 3).</b> The roster-derived work is now done TWICE per start, once in
    /// <see cref="BuildStartPlan"/> and once in <see cref="StartLocked"/>: the <c>effectiveFleet</c>
    /// projection when the multiplier is not 1, the <c>simFleet</c> filter, and a second
    /// <see cref="ConnectorRegistry.SnapshotBindings"/> — plus this record's own lists and the
    /// <c>MappingKeys</c> set. All of it is in-memory work over a roster whose size is the machine count,
    /// with no I/O and no lock beyond the one the install already holds, so the trade is a second pass over
    /// N descriptors against N file reads and up to N file writes moved off the lock. That is the trade,
    /// stated rather than measured: this task's instruments answer "is the gate grantable" and "how many
    /// times did a resolve run", and neither of them times an allocation. Calling it negligible without a
    /// measurement would be the (a3) error this file has a banner about, so it is LABELLED — if the second
    /// pass ever matters, the number to get first is the install's own hold time, not this list's length.</para>
    ///
    /// <para><b>The members, and why each reuse key is what it is:</b>
    /// <list type="bullet">
    /// <item><c>SimFleet</c> — the simulated-group roster this plan was built from, IN ORDER. Compared
    /// element-wise against the live one under the lock; index <c>i</c> of <c>Sims</c> is reused only when
    /// element <c>i</c> matches, because the seed a simulator is built with is <c>1000 + i</c>.</item>
    /// <item><c>Multiplier</c> — a precondition for reusing ANY simulator, and NOT redundant with
    /// <c>SimFleet</c>: a descriptor carries the multiplier only through its pre-scaled
    /// <c>CycleSeconds</c>, which <see cref="MinCycleSeconds"/> CLAMPS — so two different multipliers can
    /// produce byte-identical descriptors while <c>SimulatorFactory.Create</c>'s own
    /// <c>cycleRateMultiplier</c> argument (baked into the Screwdrive/Iot simulators at construction)
    /// differs. Checking the descriptors alone would be right for every multiplier pair EXCEPT the clamped
    /// ones, which is the shape of defect this file has a banner about.</item>
    /// <item><c>MappingKeys</c> — the exact input <c>MappingProfileResolver</c>'s per-descriptor resolution
    /// consumes: <c>(Code, MappingProfile, DeviceClass)</c>. Derived from the PROPERTY (what the resolved
    /// profile is a function of) rather than from the whole descriptor, so a scenario multiplier change —
    /// which moves <c>CycleSeconds</c> and nothing that resolver reads — does not force every mapping file
    /// to be re-read under the lock.</item>
    /// </list></para></summary>
    private sealed record StartPlan(
        List<MachineDescriptor> SimFleet,
        List<IMachineSimulator> Sims,
        double Multiplier,
        MappingProfileResolver MappingResolver,
        HashSet<(string Code, string? MappingProfile, DeviceClass DeviceClass)> MappingKeys,
        List<DeferredLogEntry> DeferredLogs);

    /// <summary>🔴 G-1 — emits log lines a <see cref="_gate"/>-holding path deferred. Never call this while
    /// holding <see cref="_gate"/>; that is the entire point of the deferral.</summary>
    private void FlushDeferredLogs(IReadOnlyList<DeferredLogEntry>? entries)
    {
        if (entries is null) return;

        foreach (var entry in entries)
        {
            if (entry.Error is null)
            {
                _logWarning?.Invoke(entry.Message);
            }
            else
            {
                _logError?.Invoke(entry.Error, entry.Message);
            }
        }
    }

    /// <summary>🔴 G-1 — the single off-lock epilogue every <see cref="StartLocked"/> caller runs. Order
    /// matters and reproduces the pre-G-1 sequence exactly: the lines <see cref="StartLocked"/> would have
    /// written while holding the lock come first, then the orphan disposal (which may log on its own,
    /// off-lock, exactly as it already did).
    ///
    /// <para>🔴 <b>G-2 (S3, second half) — the flush is in a <c>try</c> and the disposal in the
    /// <c>finally</c>, because G-1 put a HOST SEAM in front of a disposal that had none in front of it
    /// before.</b> <see cref="_logWarning"/>/<see cref="_logError"/> are host-supplied delegates; a host
    /// wires them to an <c>ILogger</c>, and <c>Microsoft.Extensions.Logging.Logger.Log</c> collects each
    /// provider's exception and rethrows them as an <c>AggregateException</c> rather than swallowing them —
    /// so a failing Event Log provider under <c>AddWindowsService</c> throws out of
    /// <see cref="FlushDeferredLogs"/>. Before G-2 that throw skipped
    /// <see cref="DisposeOrphanedConnectorDrivers"/> entirely, which is precisely the orphaned-connector-driver
    /// leak "review fix round 2" exists to prevent — reopened by the log deferral, in the one routine written
    /// to close it. Order is unchanged (flush first, then dispose); only the guarantee is new.</para>
    ///
    /// <para><b>Masking, stated rather than left implicit</b> (G-1's N-2 rule): if the flush throws AND the
    /// disposal throws, the disposal's exception replaces the flush's. 🔴 Round 1 said
    /// <see cref="DisposeOrphanedConnectorDrivers"/> "catches per-orphan and cannot throw today" — FALSE, and
    /// in the same way review I-3 found for the halt path: it invoked <see cref="_logDebug"/> from inside
    /// that per-orphan catch, so a throwing host logger both escaped AND stranded every later orphan. Those
    /// lines are buffered as of fix round 1, so the method can still throw but can no longer skip an orphan.
    /// Both exceptions are then "a host logger failed", so neither is the more actionable one.</para>
    ///
    /// <para><b>Tolerates a null in either half.</b> That became reachable in G-2: every caller now runs
    /// this from a <c>finally</c>, so a <see cref="StartLocked"/> that threw used to leave BOTH lists
    /// <see langword="null"/>. Both halves return immediately on null rather than the caller pre-allocating
    /// two empty lists per <see cref="Start"/>.
    ///
    /// <para>🔴 <b>J-2 then T-1 — and the sentence above USED to say "<c>default(StartOutcome)</c>", which is
    /// no longer what a throwing start produces here, in EITHER half.</b> Both production callers now
    /// allocate both lists themselves and build the pair around them, so on the throw path this method
    /// receives two real (possibly empty) lists and the completion does real work on both. The null tolerance
    /// is KEPT on both halves anyway — nothing forces a future caller to pre-allocate either one, and this
    /// method is the wrong place to discover that it did not. <b>And on the flush half it is not merely
    /// defensive:</b> <see cref="WaitAndDisposeOldPipeline"/> is handed the <see cref="PipelineHandle"/> a
    /// <see cref="StopLocked"/> early return produced, whose <c>DeferredLogs</c> IS
    /// <see langword="null"/> — so the halt path still exercises this guard on every no-op
    /// stop.</para></para>
    ///
    /// <para>🔴 <b>T-1 fix round 1 — <paramref name="installFaulted"/> GUARDS THE FLUSH, AND ONLY THE FLUSH,
    /// AND ONLY WHILE AN EXCEPTION FROM THE CALLER'S OWN BODY IS IN FLIGHT.</b> (🔴 Fix round 2: that clause
    /// said "an INSTALL'S own exception", which is narrower than the flag — at <see cref="Start"/> the
    /// <c>catch</c> spans the whole body, so <see cref="IUnsPublisher.PublishNodeBirth"/>'s throw, the
    /// enumeration's P8, sets it too, AFTER a successful install. Intended, and argued at that declaration.)
    /// T-1 made the flush do real work on the
    /// throw path, which put a host seam in front of a diagnostic that already existed: a host whose
    /// <c>ILogger</c> throws while reporting WHAT HAPPENED would replace the exception saying WHAT FAILED.
    /// That masking was <b>new</b> — round 1's justification claimed it was merely restored, and that claim
    /// was wrong; see <see cref="Start"/> for the corrected statement. The filter is the whole guard: on
    /// every non-faulting path <paramref name="installFaulted"/> is <see langword="false"/>, the filter does
    /// not match, and a host-logger failure propagates exactly as it always has — witnessed by
    /// <c>FleetHostGateCommitCompletionTests.Start_WhenTheHostLoggerThrowsFlushingDeferredLines_TheOrphanIsDisposedAndTheRunEventRecorded</c>,
    /// which is a SUCCEEDING start and still expects that throw.
    /// <para><b>What is deliberately NOT guarded, enumerated rather than implied — the guard covers ONE of
    /// <see cref="FlushDeferredLogs"/>'s two call sites:</b>
    /// <list type="bullet">
    /// <item>the <c>finally</c> below. J-2 named and accepted a four-condition window in which
    /// <see cref="DisposeOrphanedConnectorDrivers"/>'s own host seam replaces the install's exception, and
    /// that trade is J-2's to hold — widening this guard around the whole method would close it as a side
    /// effect of a different task.</item>
    /// <item><see cref="WaitAndDisposeOldPipeline"/>'s flush, which is the HALT path and reaches
    /// <see cref="FlushDeferredLogs"/> directly, not through here. It still throws out to
    /// <see cref="Stop"/>/<see cref="Estop"/> exactly as it always has, and
    /// <c>FleetHostGateCommitCompletionTests.Estop_WhenTheHostLoggerThrowsFlushingTheHaltPathLines_TheOldPipelineIsStillDisposed</c>
    /// asserts that throw. T-1 changed nothing about the halt path and this guard must not be read as
    /// having.</item>
    /// </list>
    /// The suppressed exception is lost outright, with nowhere to record it: the thing that failed IS the
    /// recording channel.</para></para></summary>
    private void CompleteStartOffLock(StartOutcome outcome, bool installFaulted)
    {
        try
        {
            FlushDeferredLogs(outcome.DeferredLogs);
        }
        catch when (installFaulted)
        {
            // The install's own exception is the message. A host logger that fails while saying what
            // happened must never replace what failed — see this method's own remarks.
        }
        finally
        {
            DisposeOrphanedConnectorDrivers(outcome.OrphanedConnectorDrivers);
        }
    }

    /// <summary>Fix round 1 (WS-A-T7 review, Important) — the historian's "Start" run event belongs HERE,
    /// not inside <see cref="StartLocked"/>: that helper is also the shared restart chokepoint
    /// <see cref="RegisterMachine"/>/<see cref="ApplyScenario"/> call directly (bypassing this public
    /// method entirely) to rebuild the pipeline after a live roster/scenario change, which is never a
    /// genuine operator "start" and must stay invisible to the historian's run-event timeline (OEE
    /// Availability = Start→next Stop/Estop; a spurious pair per internal restart would corrupt it). The
    /// <c>wasRunning</c>/<c>IsRunning</c> comparison (read under <see cref="_gate"/>, same as every other
    /// <c>IsRunning</c> read in this class) guards against emitting again when <see cref="Start"/> is
    /// called on an already-running (or still-<see cref="EstopEngaged"/>) fleet, where
    /// <see cref="StartLocked"/> itself no-ops.</summary>
    public void Start()
    {
        // 🔴 G-2 — S3 and S7, the same shape as Estop()'s S2 and with the same remedy. StartLocked commits
        // `_slots`, `_running = true`, `LastError` and `_connectorStartIssues` under _gate and leaves TWO
        // things unfinished there: the connector drivers a rejecting factory orphaned (which own live
        // sockets, and whose disposal is what "review fix round 2" exists for) and the log lines it deferred.
        //
        // 🔴 T-1 FIX ROUND 1 — THE SENTENCE ABOVE SAID StartLocked "HANDS BACK, IN THE StartOutcome" THOSE
        // TWO THINGS. That was true at base and T-1 falsified it — both lists are the caller's now and
        // StartLocked returns void — and T-1's first edit inside this same comment block is twenty-six lines
        // below it. The sweep took its domain from the paragraphs the change touched instead of from the
        // property ANY SENTENCE DESCRIBING WHAT StartLocked RETURNS, which is §8.1(f) applied to a scope, and
        // this file names that as its own recurring defect. What the two things ARE did not change; who owns
        // them did.
        //
        // The throw site between commit and completion is `PublishNodeBirth()`
        // inside the lock — the IUnsPublisher seam, the enumeration's own P8, whose "never throws" is a
        // promise and not a bound. Before this fix, that throw re-opened exactly the orphaned-driver leak
        // round 2 closed, and dropped the connector-rejection warnings with it.
        //
        // S7 is the SECOND completion the same commit owes, and it sits AFTER the first: the historian's
        // "Start" run event. It is what makes OEE Availability a Start→Stop pair — SqliteHistorianStore's OEE
        // query opens an interval on "Start" and closes it on "Stop"/"Estop" — so a dropped Start corrupts
        // that timeline exactly as the spurious pair this call site was moved here to avoid would. Both
        // completions now run in the `finally`, in the same order as before.
        //
        // 🔴 Round 1 justified this with "for Stop/Estop the historian call is a throw SITE; for Start it is a
        // VICTIM", as if those were exclusive. They are not — a call can be both, and there it IS both. That
        // sentence is why the same fix was not applied to the halt path, where a missing Stop/Estop INFLATES
        // availability. Corrected by review C-1; see Stop()/Estop().
        //
        // MASKING: if CompleteStartOffLock throws AND the run event throws, the run event's exception
        // replaces it. Round 1 said the replacing exception here "cannot throw short of OOM"; that is FALSE
        // and the same report's own S2 row said so — RecordRunEventFireAndForget is not async, and its
        // disposed-writer arm calls a host logWarning synchronously before returning a Task. Both are host
        // logger failures, so neither is the strictly more important message; it is stated because the rule
        // is that it gets stated.
        //
        // THE THROW PATH IS WHAT THE `finally` IS FOR, and J-1 did not remove it: the enumeration's P5
        // (MachineConfigStore.Ensure) now fires out of BuildStartPlan, one statement EARLIER and off the
        // lock, rather than out of StartLocked.
        //
        // 🔴 J-2 then T-1 — AND THE SENTENCE THAT FOLLOWED THIS ONE IS NO LONGER TRUE, WHICH IS THE FIX. It
        // read "Both of the outcome's halves return immediately on a null list either way, so the `finally`
        // is a no-op on that path rather than a second fault" — accurate then, and the exact statement of the
        // leak: a `finally` that is a NO-OP on the throw path is a `finally` that releases nothing on the
        // throw path. J-2 fixed the ORPHAN half and this comment then said the DEFERRED-LOG half "is still
        // null there"; T-1 fixed that half too, so neither is. Both lists are declared below, before the
        // `try`, and the completion does real work on exactly the path that used to lose both.
        //
        // Not "lost" traded for "twice": each list is allocated once per call and consumed exactly once, in
        // the finally, on every path — including the paths that never reach StartLocked at all, where it is
        // consumed EMPTY, which is what keeps the two silent siblings silent. StartLocked's own
        // `if (IsRunning || _estopEngaged) return` is what makes a repeated Start a no-op rather than a
        // second set of slots, and a retry that finally succeeds emits its own run's lines once, from its own
        // lists — never the previous attempt's.
        //
        // 🔴 T-1 FIX ROUND 1 — AND THE QUANTITY THAT FOLLOWS FROM "PER ATTEMPT", stated because the
        // stop-abandon note below states its mirror image and this one was left out (review Minor). A fleet
        // whose install fails N times now emits N copies of the same mapping warning where it emitted ZERO.
        // That is the ruling's INTENDED consequence, not a defect — every one of those attempts really did
        // run the resolver and really did fall back, and one warning per attempt is exactly what a
        // SUCCEEDING start already produces (AMappingProfileTheBuildAlreadyResolved_IsNotResolvedAgainByTheInstall
        // pins the per-start count). It is the operator-visible VOLUME change, and a restart loop against a
        // roster with a bad mappingProfile is where someone will meet it.
        //
        // 🔴 J-1 — this method now takes _gate TWICE, and the split is the whole change. The first
        // acquisition only copies what a build reads (SnapshotStartInputsLocked); the build itself runs
        // between the two, off the lock; the second acquisition is the one that has always mattered — it
        // re-reads the latch, re-reads the roster, installs, and publishes NBIRTH, all exactly where they
        // were before.
        //
        // 🔴 THE EARLY RETURN IN THE FIRST ACQUISITION IS AN OPTIMISATION AND MUST NEVER BECOME THE GUARD.
        // It exists so that a Start() made while the HALT latch is engaged does no I/O at all — before J-1
        // it did none because the latch inside StartLocked refused before any build; without this line it
        // would now write machine-config files and read mapping files for a fleet it is about to refuse to
        // start. It is the SAME test, under the SAME lock, and it errs in the safe direction (it can only
        // decline to start). What makes it safe is that it is not load-bearing: StartLocked re-reads
        // IsRunning/_estopEngaged under the second acquisition and that reading is the one that decides.
        // Deleting THAT one opens a window on the safety path; deleting THIS one only wastes work.
        //
        // 🔴 BRANCH REVIEW, Critical — AND THE SENTENCE THAT USED TO END THIS PARAGRAPH ("Both mutations are
        // covered") WAS FALSE BY THE TIME IT SHIPPED. Fix round 1 made Estop() increment _stopRequests, so
        // from that commit the abandon check below returns BEFORE StartLocked is called: the latch's
        // _estopEngaged arm became unreachable FROM THIS METHOD, and the test whose name says it covers it
        // was in fact passing through the counter. The mutation that had proved the latch (M1) was run
        // before the counter existed and was never re-run; re-run at the branch tip it SURVIVED all 1330
        // tests. Nothing was ever wrong with the BEHAVIOUR — Estop is still refused, by the counter here and
        // by the latch on the restart path — but the coverage claim was stale, which is worse than a gap
        // because it stops the next person looking.
        //
        // WHERE EACH ARM IS WITNESSED NOW, since "covered" has to name the arm to mean anything:
        //   _estopEngaged — NOT from this method (the counter shadows it). Reached and tested through
        //       RebuildPipelineOffLock: AnEstopLandingDuringARestartsRebuild_IsRefusedByTheLatchInsideTheLock.
        //       🔴 J-1b — that method now HAS a pre-check of its own, and this arm is still witnessed there
        //       because the check is sited BEFORE its build while that test's Estop lands at the END of
        //       BuildStartPlan. Re-measured on the post-J-1b tree rather than inherited, since an upstream
        //       early return is precisely what invalidated the previous measurement (§8.1(h)); it reads no
        //       counter either way.
        //   IsRunning     — still live HERE, because a racing Start moves no counter:
        //       ASecondStartWinningTheRace_LeavesTheLoserRefusedByTheLatch_NotASecondSetOfSlots.
        // M1 kills both. The pre-check below is witnessed separately by
        // AStartMadeWhileTheLatchIsEngaged_NeitherStartsNorBuilds, on the observation count.
        //
        // 🔴 J-1 fix round 1 (review I-2) — AND IT IS NOT ONLY WASTED WORK: naming the write without naming
        // the THROW understated it. If an Estop lands between the two acquisitions, the build has already
        // run, and BuildStartPlan reaches MachineConfigStore.Ensure — which throws InvalidOperationException
        // on a config-kind mismatch and IOException on a full or read-only data root. Pre-J-1 the latch
        // refused before any of that, so a Start() made while latching was a guaranteed silent no-op; now it
        // can propagate. That is a NEW WAY FOR A START TO FAIL, which is the exact category this task's own
        // enumeration refuses when it rejects "throw" as a way to close P4/P5 — so it is named here rather
        // than left as a footnote about files. It needs BOTH a poisoned data root AND an Estop inside the
        // window, and the pre-check above is what keeps the ordinary latched Start on the old path.
        //
        // 🔴 BRANCH REVIEW, Important 2 — THIS DISCLOSURE WAS WRITTEN ONLY HERE, AND THE OTHER ARM IS WORSE.
        // (🔴 J-1b: the "no pre-check" half of this paragraph is now HISTORY — read it with the J-1b block at
        // the end of this comment, which says what the pre-check that method now carries does and does not
        // cover. What is unchanged is the shape of the exposure, so the paragraph stands as written.)
        // RebuildPipelineOffLock (RegisterMachine/ApplyScenario) had NO pre-check at all, so when an Estop
        // lands after their StopLocked, the rebuild's BuildStartPlan runs P4's per-machine reads AND P5's
        // WRITE while the HALT latch is engaged — filesystem work on the halt path that pre-J-1 could not
        // happen, against a root ST4I_MACHINE_CONFIG_DIR may have pointed at a UNC share — and can throw
        // there too. My sweep for this disclosure took its domain from the method I was editing rather than
        // from the property (ANY path that now builds before the latch is read), which is §8.1(f) for the
        // fourth time in this task. Both restart sites carry the disclosure — 🔴 and that sentence was
        // itself FALSE when the branch-review round wrote it (branch re-review, N1): the disclosure went
        // into RegisterMachine only, ApplyScenario had none, and this line asserted both. Seventh instance
        // of the same class, inside the repair for the fourth. It is true as of this commit, and the way it
        // was made true was to write the fact at the missing site rather than to soften the claim here.
        //
        // NOT "fixed" by adding a symmetric pre-check there, and the reason is NOT the one first given.
        //
        // 🔴 THE MECHANISM SENTENCE THAT STOOD HERE WAS FALSE, and is replaced rather than softened: it
        // claimed a pre-check would "narrow the only window in which the latch's _estopEngaged arm is
        // reachable, which is exactly the window its sole witness uses". It would not. A pre-check goes
        // where Start()'s does — BEFORE the build — while the witness's Estop lands at the END of
        // BuildStartPlan, so a pre-build check does not touch that window at all. What shadows the latch on
        // Start()'s path is _stopRequests, which is read AFTER the build; a pre-build check reads nothing
        // after it.
        //
        // The conclusion survives on a different and better route. A pre-build check would remove halt-path
        // I/O only for the TEARDOWN SUB-WINDOW — an Estop that lands between StopLocked and the first
        // statement of the build — which is a sliver of the exposure and buys almost nothing. The check
        // that WOULD cover the build window is a POST-BUILD re-check, and that is precisely the shape this
        // branch has just paid a Critical for: a second refusal sited after the build shadows the latch
        // exactly as _stopRequests does on Start()'s path, and the latch's only remaining witness runs
        // through here. So the answer is not "a cheap win we are declining" — it is "the cheap version
        // covers almost nothing, and the version that covers it re-creates the defect".
        //
        // 🔴 J-1b — THE OWNER TOOK THAT DECISION AND TOOK IT THE OTHER WAY: the pre-build check IS there now,
        // and the paragraph above is what it was weighed against, so it stays. Three corrections it earns,
        // and the first is the one worth reading:
        //   (1) "TEARDOWN SUB-WINDOW … a sliver" is right about WHICH window and understates it. That window
        //       contains WaitAndDisposeOldPipeline — a bounded wait per old slot at RestartTeardownTimeout,
        //       twice (run-task, then the driver's own DisposeAsync, which is third-party code). 🔴 Review
        //       Minor: what that gives is a BOUND, not a typical width. Its CEILING is seconds
        //       (2 × RestartTeardownTimeout per old slot) where "a sliver" implies microseconds; the
        //       TYPICAL width is unmeasured, and on a healthy simulated fleet a cancelled run-task and an
        //       in-memory DisposeAsync both return promptly, so it is probably small. The argument for the
        //       check rests on the ceiling — a hung third-party driver is exactly when an operator is
        //       reaching for E-stop — not on a number nobody has taken.
        //   (2) The case a pre-check is INTUITIVELY for — a RegisterMachine/ApplyScenario made while the
        //       fleet is ALREADY latched — is not covered by it and never needed to be: those callers rebuild
        //       only when IsRunning, and a latched fleet is not running, so that call does no I/O at all and
        //       never has. Measured on this tree (zero build observations), because "obviously it must be
        //       doing the work" is exactly the kind of claim this file's banner exists to stop.
        //   (3) The POST-BUILD re-check is STILL refused, for the reason given above and unchanged by J-1b.
        //       The latch keeps its witness precisely because the new check reads nothing after the build.
        //
        // 🔴 J-2 — `orphanedConnectorDrivers` IS DECLARED HERE, NOT INSIDE StartLocked, and that one move is
        // the closing half of S3's residual. A connector driver a rejecting factory hands back owns a live
        // socket; before this, it lived in a local of StartLocked, so a throw from that method — between the
        // orphan's collection and its return — took it out of scope unreleased, and the `finally` below had
        // nothing to reach. It reached `default(StartOutcome)` and did nothing, which is precisely how a
        // completion written to close a leak still lost one. The list is the caller's now; the `finally`
        // names it directly and does not depend on StartLocked having returned at all.
        //
        // 🔴 WHAT IT COSTS (review Minor — StopLocked's change was given this disclosure and this one was
        // not): on the throw path the `finally` now WAITS. DisposeOrphanedConnectorDrivers bounds each
        // orphan at RestartTeardownTimeout, so a failed Start() can take that much longer per collected
        // orphan to hand its exception back, where it previously returned at once. Off _gate, so it delays
        // nobody's Estop; and the list is empty on every path where no factory rejected while leaking, which
        // is every path in a healthy fleet. The trade is that latency against a socket held for the life of
        // the process.
        //
        // 🔴 AND IT IS ALLOCATED BEFORE THE `try`, i.e. BEFORE this method's own early return — unlike
        // RebuildPipelineOffLock, which allocates AFTER its pre-check, though both are documented as the
        // same change (review Minor). The difference is forced, not stylistic: THIS method's early return
        // lives INSIDE the `try` whose `finally` consumes the list, so the declaration has to precede it;
        // that method's pre-check runs before its `try` begins. The cost of the asymmetry is one empty list
        // allocated by a Start() that declines — which is the same list the latch path has always returned.
        bool started = false;
        var orphanedConnectorDrivers = new List<IDeviceDriver>();

        // 🔴 T-1 — the second caller-owned list, and it is here for exactly the reason the first one is: a
        // list StartLocked declares is a list a throw from StartLocked deletes. What it buys is different
        // from what the orphan list buys — no resource is released — so it is argued separately, at
        // StartLocked and in the S-set banner's residual (3), and it is an OWNER'S ruling rather than a
        // repair chosen here.
        var deferredLogs = new List<DeferredLogEntry>();

        // 🔴 T-1 FIX ROUND 2 — THE NAME IS NARROWER THAN THE BEHAVIOUR, AND THE BEHAVIOUR IS THE INTENDED
        // ONE. `installFaulted` reads as "StartLocked threw". The `catch` below spans the WHOLE `try`, so it
        // is true for ANY exception leaving the start body — including PublishNodeBirth()'s, the
        // enumeration's P8, which fires AFTER a successful install with `_running == true` already committed.
        // That is correct rather than incidental: what the guard protects is "an exception is already
        // travelling that says more than a logger failure would", and P8's does. Read it as START-BODY
        // FAULTED. It is named here rather than renamed because the parameter is also `CompleteStartOffLock`'s
        // and RebuildPipelineOffLock's, where "install" IS the whole body — one name cannot be exact at all
        // three sites, so the site where it is loose is the one that says so.
        //
        // 🔴 T-1 FIX ROUND 1 — THE FAULT FLAG. Set at exactly ONE site, by the `catch` below, and read at
        // exactly one, by CompleteStartOffLock's filter. It is the FAULT polarity deliberately: a COMPLETION
        // flag would have to be set correctly on this method's early returns as well as its normal exit, so a
        // future return added inside the `try` would be wrong by default. This one is CORRECT BY DEFAULT —
        // a new return never touches it, and only an exception can make it true. Round 1 rejected the guard
        // after pricing it at the completion polarity; that was the wrong shape, and it is the shape this
        // file's own clause 5b is a monument to (an over-priced alternative carrying a decision).
        var installFaulted = false;
        try
        {
            StartInputs inputs;
            lock (_gate)
            {
                if (IsRunning || _estopEngaged) return;
                inputs = SnapshotStartInputsLocked();
            }

            // OFF-LOCK: the enumeration's P4 and P5 happen here.
            var plan = BuildStartPlan(inputs);

            lock (_gate)
            {
                // 🔴 J-1 fix round 1 (review I-1) — A STOP REQUESTED DURING THE BUILD WINS, and this is the
                // one place that decides it. Without this line a Stop() landing between the two acquisitions
                // is silently dropped (StopLocked returns on its opening guard, because this start has not
                // installed yet — no slots either, so J-2's conjunction returns there for the same reason
                // the single `!_running` test did; branch review Important 2) and the start then completes
                // — inverting a Start‖Stop race that pre-J-1
                // could end stopped. Abandoning here is not a failure: this method returns void and already
                // declines silently when latched or already running, so no caller learns anything new.
                //
                // It is NOT redundant with the latch below. The latch answers "is the fleet running or
                // halted RIGHT NOW"; after a dropped Stop the answer to both is no, so the latch admits the
                // start. Only a count of REQUESTS can see an event that left no state behind. See
                // _stopRequests for why the counter lives at the operator-facing calls rather than inside
                // StopLocked.
                //
                // 🔴 BRANCH REVIEW, Minor — THIS RETURN DROPS THE PLAN'S MAPPING WARNINGS, and unlike the
                // latch path that is NOT what pre-J-1 did. Both pre-J-1 resolutions of a Start||Stop race
                // ran StartLocked to completion at some point, so both emitted the "mappingProfile X not
                // found, falling back" line for every descriptor that had one; an abandoned start emits
                // none. The lines are not lost forever — the next start rebuilds the plan and produces the
                // same messages — so what is lost is one emission per abandoned attempt, which under the
                // repeating-Stop case below means they are never emitted at all while the loop continues.
                //
                // 🔴 T-1 — STILL DROPPED, AND NOW BY A RULING RATHER THAN BY DEFAULT; the mechanical half of
                // the old reason is also gone and is corrected rather than left. That reason was "`outcome`
                // stays default(StartOutcome) and CompleteStartOffLock is a no-op over it": the completion is
                // no longer a no-op anywhere, it flushes the caller's list, and on THIS return that list is
                // EMPTY — the plan's lines join it only inside StartLocked, past the latch, and StartLocked
                // is never called here. So the silence is produced by a statement order, not by a null. The
                // owner ruled that a start which never installed stays silent because nothing happened, and
                // that a start which threw MID-INSTALL speaks because a great deal did; this return is the
                // first kind. Pinned by
                // FleetHostGateCommitCompletionTests.AStartAbandonedByAConcurrentStopRequest_StillSaysNothing.
                if (_stopRequests != inputs.StopRequests) return;

                var wasRunning = IsRunning;
                StartLocked(plan, orphanedConnectorDrivers, deferredLogs);
                started = !wasRunning && IsRunning;

                // Review fix (Important) — the NBIRTH call is made HERE, still inside _gate, deliberately: two
                // genuinely concurrent operator calls (e.g. a Start racing a Stop on two threads) could
                // otherwise order the gate-protected transitions one way while off-gate publish calls raced
                // the other way, letting a Stop's NDEATH run before its logically-preceding Start's NBIRTH —
                // hitting the born-guard, no-op'ing, and leaving that birth's NDEATH never sent. Holding
                // _gate across this call is cheap/deadlock-free: PublishNodeBirth only takes the publisher's
                // own _lifecycleGate briefly and does a non-blocking channel TryWrite (no I/O, never calls
                // back into FleetCore), so lock order is always _gate -> _lifecycleGate, never reversed. The
                // historian run-event below stays OUTSIDE _gate — that's a pre-existing async
                // fire-and-forget pattern, unchanged/out of scope here.
                if (started)
                {
                    _unsPublisher?.PublishNodeBirth();
                }
            }
        }
        catch (Exception)
        {
            // 🔴 T-1 fix round 1 — THE ONLY WRITE TO THE FAULT FLAG, and this clause exists for nothing else.
            // `throw;` rethrows the same exception object, so the install's own diagnostic is what leaves this
            // method; see the flag's declaration for why the polarity is FAULT and not COMPLETION.
            installFaulted = true;
            throw;
        }
        finally
        {
            // 🔴 G-2 — the NESTING is load-bearing and my first draft did not have it. A throw inside a
            // `finally` abandons the REST of that same `finally`, so writing these two statements one after
            // the other left the run event exposed to a throw from CompleteStartOffLock — which is precisely
            // the throw S7 is about. Caught by the test, not by re-reading the fix.
            try
            {
                // Review fix round 2 — off-lock, same as WaitAndDisposeOldPipeline below; see
                // DisposeOrphanedConnectorDrivers' own doc comment for why this must never run inside _gate.
                // 🔴 G-1 — now also flushes the log lines StartLocked deferred; same reason, same side of the
                // lock. 🔴 G-2 — and now in a `finally`, so a throw from the in-lock PublishNodeBirth seam
                // can no longer strand the orphans or the warnings. Same two statements, same order.
                //
                // 🔴 J-2 — THE PAIR IS BUILT FROM LOCALS RATHER THAN FROM A RETURN VALUE, and it is the same
                // value on every path that had one. Both lists were handed to StartLocked, so naming them
                // here is what a returned outcome would have named on the paths that produced one — and on
                // the throw path it is the only thing there is to name. 🔴 T-1 completed that move: the
                // deferred half was still travelling by return, so it was still null exactly here.
                //
                // MASKING — ONE ROUTE, J-2's, and it is the one deliberately left open. If StartLocked threw
                // AND an orphan was collected AND that orphan's DisposeAsync faults AND the host's _logDebug
                // then throws on the buffered line, that host-logger exception replaces the exception that
                // said why the START failed: a four-condition window, traded for a socket that would
                // otherwise be held for the life of the process. That trade is J-2's and is left as J-2 made
                // it — it lives in DisposeOrphanedConnectorDrivers, which runs in the completion's `finally`
                // and is outside T-1's guard on purpose.
                //
                // 🔴 T-1 FIX ROUND 1 — T-1 OPENED A SECOND, SHORTER ROUTE AND HAS NOW CLOSED IT; THE
                // JUSTIFICATION ROUND 1 GAVE FOR LEAVING IT OPEN WAS WRONG, AND THE CORRECTION IS THE POINT.
                // Round 1 argued: before G-1 these same lines were emitted INLINE inside StartLocked, at the
                // connector loop, i.e. BEFORE the slot loop that is the throw site here — so a host logger
                // that throws on them was already the only exception a caller saw, and restoring the lines
                // only restored an exposure that always existed. THE MEASUREMENT IS TRUE AND IT PROVES SOMETHING
                // ELSE. Pre-G-1 the logger threw AHEAD of the throw site, so the install never reached the
                // slot loop and THERE WAS NO COMPETING DIAGNOSTIC TO LOSE. Post-T-1 the install runs, throws
                // for a real reason that names why the start failed, and the flush then replaces it.
                //
                //     THE EXPOSURE IS RESTORED. THE MASKING IS INVENTED. "A broken host logger can be the
                //     only exception a caller sees" is old; "a broken host logger can DESTROY A DIAGNOSTIC
                //     THAT ALREADY EXISTED" was reachable neither pre-G-1 (nothing to destroy) nor at base
                //     (the flush iterated nothing), and T-1 made it reachable.
                //
                // Stated in the file that distinguishes exposure from masking carefully everywhere else, and
                // it is what a task whose whole purpose is "a failed install must not be silent" cannot ship
                // as "a broken logger silences the failure". The guard is the `installFaulted` filter inside
                // CompleteStartOffLock — around the FLUSH only, one `catch`, set from one site.
                CompleteStartOffLock(new StartOutcome(orphanedConnectorDrivers, deferredLogs), installFaulted);
            }
            finally
            {
                if (started)
                {
                    _ = _historianWriter?.RecordRunEventFireAndForget("Start");
                }
            }
        }
    }

    /// <summary>Fix round 1 (WS-A-T7 review, Important) — mirror of <see cref="Start"/>'s reasoning: the
    /// historian's "Stop" run event belongs at THIS public operator boundary, not inside
    /// <see cref="StopLocked"/> — that helper is also the shared teardown step
    /// <see cref="RegisterMachine"/>/<see cref="ApplyScenario"/>'s internal restarts AND
    /// <see cref="Estop"/> call directly (bypassing this method), none of which are a genuine operator
    /// stop. Only a real running→not-running transition through THIS method emits "Stop" — an
    /// already-stopped fleet (where <see cref="StopLocked"/> no-ops) emits nothing.</summary>
    public void Stop()
    {
        // Wait/dispose must happen OUTSIDE _gate — see WaitAndDisposeOldPipeline's remarks. Stop()
        // itself stays synchronous (bounded by RestartTeardownTimeout) so a caller observing it return
        // can trust the old pipeline is actually torn down, not just "cancel requested".
        // 🔴 G-2 (S2) — see Estop() for the full account: of why the teardown is in a `finally`, of why the
        // run event is in one too (review C-1), and of why a latched flag rather than an unconditional call.
        // Stop() and Estop() are the same member of that set, and this method already HAD the flag Estop had
        // to grow: `stopped` is computed before the publish call, so it is exactly "a real running→
        // not-running transition happened", and an already-stopped fleet still emits nothing.
        PipelineHandle handle = default;
        bool stopped = false;
        try
        {
            lock (_gate)
            {
                // 🔴 J-1 fix round 1 (review I-1) — recorded BEFORE StopLocked and unconditionally, which is
                // the whole point: the request that used to be lost is precisely the one StopLocked drops on
                // its opening guard (a not-running fleet with no slots — J-2's conjunction drops it exactly
                // as the single `!_running` test did; branch review Important 2), so counting after it, or
                // only when something was actually torn down,
                // would count everything except the case this exists for. See _stopRequests.
                //
                // 🔴 FIX ROUND 2 — NAMED, NOT CHANGED: a caller invoking this in a loop can now starve
                // Start() indefinitely. Every start snapshots a count that the next Stop() invalidates
                // before the build finishes, so the install is abandoned every time and the fleet never
                // comes up. Pre-J-1 the same loop produced a visible FLAP — each Start won the gate, ran to
                // completion and emitted NBIRTH + historian "Start", and each Stop then emitted NDEATH +
                // "Stop". Both regimes end stopped, so the outcome class is unchanged; what changed is that
                // the flap USED TO BE IN THE HISTORIAN and now nothing is emitted at all, so an operator
                // reading the run-event timeline sees a quiet fleet rather than a thrashing one. That is a
                // loss of EVIDENCE, not of safety. Left as-is deliberately: suppressing a start that a
                // concurrent stop cancelled is the behaviour review I-1 asked for, and emitting a
                // Start/Stop pair for a pipeline that never installed would fabricate a zero-length OEE
                // interval — the worse of the two. Recorded here because a starving Start() is exactly the
                // symptom someone will debug from this side.
                //
                // 🔴 BRANCH REVIEW — AND IT COSTS MORE THAN HISTORIAN EVIDENCE. Every starved attempt still
                // runs its whole off-lock build before being abandoned, so each one repeats P5: a
                // MachineConfigStore.Ensure per not-yet-stored machine, i.e. a File.WriteAllText +
                // File.Move against a root ST4I_MACHINE_CONFIG_DIR may point at a UNC share. A Stop() loop
                // therefore drives repeated network filesystem writes for starts that never install —
                // off _gate, so it delays nobody's Estop, but it is real I/O and not merely a quiet
                // timeline. After the first pass those machines are in the store's in-memory map and Ensure
                // stops writing, so the repeat cost is the store's lock and the mapping reads rather than
                // an unbounded write loop; the write repeats only where the store keeps being reset.
                _stopRequests++;

                var wasRunning = IsRunning;
                handle = StopLocked();
                stopped = wasRunning && !IsRunning;

                // Review fix (Important) — same reasoning as Start()'s own NBIRTH call: kept inside _gate so
                // the NDEATH's enqueue order is serialized with the transition decision itself, not racing an
                // off-gate concurrent Start's NBIRTH. The historian run-event below stays OUTSIDE _gate
                // (pre-existing async fire-and-forget pattern, unchanged here).
                if (stopped)
                {
                    _unsPublisher?.PublishNodeDeath();
                }
            }
        }
        finally
        {
            // Nested — see Estop(). The run event's own synchronous prefix can throw, and it must not be able
            // to abandon the teardown that shares this `finally` with it.
            try
            {
                if (stopped)
                {
                    _ = _historianWriter?.RecordRunEventFireAndForget("Stop");
                }
            }
            finally
            {
                WaitAndDisposeOldPipeline(handle);
            }
        }
    }

    /// <summary>
    /// SM-4 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-4-brief.md) —
    /// READ THIS BEFORE CALLING: despite the name (kept for API/route stability — see the task-4 report
    /// for why the identifier stays), this method does <b>not</b> stop a machine, and cannot. It tears
    /// down THIS SOFTWARE's own read pipeline — cancels every <see cref="PipelineSlot"/>'s token,
    /// disposes each slot's <see cref="IDeviceDriver"/> (closing whatever local connection it holds) —
    /// then latches <see cref="EstopEngaged"/>. That is the entire effect: no <c>WriteAsync</c>/
    /// <c>SendCommand</c>/<c>Actuate</c> call, no Modbus/OPC-UA write, no Sparkplug NCMD (still never
    /// received either way). Nothing here reaches out and stops a real machine.
    ///
    /// <para><b>Task B-8 — this is now a DELIBERATE choice, not an absence of capability.</b> Đợt A wrote
    /// the paragraph above when it was still also true that NOTHING in this codebase could write to a
    /// device at all; Đợt B (B-1 through B-7) built exactly that — <see cref="TryWriteSetpointAsync"/>/
    /// <see cref="TryInvokeCommandAsync"/> reach a real Modbus/OPC-UA device today. This method could
    /// call them and did not, on purpose: a real emergency stop is a hardwired, safety-rated circuit per
    /// ISO 13849 (Cat 3/4) — software is never permitted to be the safety path — and a software "stop"
    /// that also pulses a coil or writes a shutdown setpoint to a PLC would look and feel MORE like a
    /// safety device than this latch already risks looking like, while still not meeting that bar. That
    /// is a worse product than an honestly-named supervisory latch that only ever touches its own
    /// pipeline. If an operator asks why HALT doesn't stop their machine now that writing is possible:
    /// this is why, and it is not going to change.</para>
    ///
    /// Branch-review C-2/C-3 — a real, confirmed stop OF THIS SOFTWARE'S PIPELINE: tears the pipeline
    /// down (same path <see cref="Stop"/> uses) and only THEN latches <see cref="EstopEngaged"/>, so a
    /// caller awaiting this method genuinely knows the read pipeline stopped before it reports success
    /// (C-3 — the client used to latch and log a success banner on a fire-and-forget POST that could
    /// still fail). The latch itself is engine-owned (not client React state), so it's visible on every
    /// subsequent <see cref="ReadSnapshot"/> to every panel/tab, and survives a page reload.
    /// </summary>
    public void Estop()
    {
        // 🔴 G-2 — S2, THE MOST SERIOUS MEMBER OF ITS SET, AND IT IS ON THE HALT PATH.
        //
        // THE CLASS: state is committed while _gate is held and COMPLETED after the lock is released, so
        // every throw in between loses the completion. Here the commit is StopLocked's — `_running = false`,
        // `_slots.Clear()`, every slot's Cts.Cancel() requested — and the completion is
        // WaitAndDisposeOldPipeline: the bounded wait for each old run-task, each driver's DisposeAsync (the
        // thing that actually closes a live TCP/serial connection) and each CTS's Dispose. Once _slots is
        // cleared, those slots are reachable through NOTHING but the PipelineHandle in this local; if this
        // method leaves without passing it on, they are unreachable and unreleased for the rest of the
        // process's life.
        //
        // TWO THROW SITES SIT BETWEEN THEM, and neither is hypothetical:
        //   1. `_unsPublisher?.PublishNodeDeath()` — INSIDE the lock, on purpose (below). The field is
        //      IUnsPublisher, so this is a property of the SEAM: any host implementation runs here, and the
        //      interface's "never throws" is a promise, not a bound (this is the enumeration's own P8).
        //   2. `RecordRunEventFireAndForget` — its name says fire-and-forget and its DISPOSED arm is not:
        //      it invokes the host's logWarning synchronously, on this thread, before it returns a Task
        //      (HistorianWriter.cs). A host wires that to an ILogger, whose Log() rethrows a provider's
        //      failure as an AggregateException.
        //
        // WHAT A THROW COST BEFORE THIS FIX: every old driver and CTS leaked — one live connection per slot,
        // during HALT — and the deferred "a driver's cancellation callback threw" line, the one that tells an
        // operator a driver misbehaved during the halt, was dropped with them. Cancellation had already been
        // REQUESTED inside StopLocked, so the pipelines still unwound; what was lost is the bounded wait, the
        // disposals and the log. Estop() also reported failure to its caller on a fleet that was in fact
        // latched.
        //
        // WHY A `finally` AND NOT A MOVE: the publish call must stay inside _gate — that is an explicit
        // earlier review fix, and it is what serialises NDEATH's enqueue order with the transition decision
        // itself so a concurrent Start's NBIRTH can never be ordered the other way. A `finally` around the
        // WHOLE lock statement changes nothing about what runs under the lock or in what order; it only makes
        // the teardown unconditional. Order preserved, guarantee added.
        //
        // NOT "LOST" TRADED FOR "TWICE" — and the ledger is _slots itself. StopLocked removes a slot from
        // _slots (via Clear) under _gate BEFORE returning it in the handle, so exactly one PipelineHandle ever
        // owns a given slot, and the only other disposer in this class — StartSlot's per-slot fault catch —
        // guards its disposal on `_slots.Remove(slot)` returning true, which it cannot for a slot already
        // cleared. The handle is passed to this method exactly once on every path, throwing or not.
        //
        // MASKING (G-1's N-2 rule, applied forwards): if the publish call throws AND a later step also
        // throws, the later exception replaces the original.
        //
        // 🔴 The throw sites in this method's off-lock tail are ENUMERATED rather than summarised, because
        // round 1 summarised them and the summary was false ("its one remaining throw site (the deferred-log
        // flush)"). There are THREE, all the same host-seam class:
        //   1. RecordRunEventFireAndForget's disposed arm — a synchronous host logWarning before it returns.
        //   2. WaitAndDisposeOldPipeline's FlushDeferredLogs — a host logWarning/logError.
        //   3. DisposeOldSlots' two per-slot _logDebug calls (review I-3).
        // What none of them can do any more is SKIP a disposal: 2 is wrapped so the disposals still run, and
        // 3 is buffered so no host code runs between two slots. Every replacement is therefore "a logger
        // failed" standing in for "a logger failed", never for "the pipeline is down".
        //
        // ORDER NOT CHANGED, deliberately: `_estopEngaged = true` still lands AFTER StopLocked, not before.
        // That the pipeline is torn down before the latch reports success is operator-observable and is this
        // method's documented contract (branch-review C-2/C-3, above) — this task does not get to reorder it.
        //
        // 🔴 G-2 FIX ROUND 1 (review C-1) — THE RUN EVENT IS THE SECOND COMPLETION THIS COMMIT OWES, AND IT
        // WAS STILL BEING DROPPED BY THIS MEMBER'S OWN THROW SITE.
        //
        // G-2 applied "a commit can owe MORE THAN ONE off-lock completion" to Start() (that is what turned up
        // S7) and did not apply it here — the mirror image, on the halt path. `RecordRunEventFireAndForget`
        // sat inside the `try`, after the lock, so a throw from `PublishNodeDeath()` — the seam this member's
        // own test injects — skipped it. Treating that call as a throw SITE and therefore not also a VICTIM
        // was the error; it is both.
        //
        // IT IS OPERATOR-VISIBLE, IN THE NUMBER A PLANT MANAGER READS. SqliteHistorianStore's OEE
        // aggregation opens an interval on "Start" (`activeStart ??= at`) and closes it only on
        // "Stop"/"Estop"; a missing halt event leaves it open, and the trailing clause then accrues run time
        // to the end of the window. Availability is INFLATED — the same corruption S7 exists to prevent,
        // with the sign reversed.
        //
        // WHY A LATCHED FLAG AND NOT AN UNCONDITIONAL `finally`. This is not Start()'s mechanical three
        // lines. An unconditional `finally` would record a halt on a path where `StopLocked` THREW, i.e. one
        // that never happened — trading "lost" for "spurious", which is the same trade in the other
        // direction and no better. `halted` is set after the two commits the event actually describes, so it
        // is true exactly when an "Estop" is truthful — including for an already-stopped fleet, where
        // StopLocked no-ops and this method has always recorded the event anyway. (🔴 Branch review,
        // Important 2 — "already-stopped fleet" means already-stopped AND SLOTLESS since J-2. A fleet that
        // is not running but still holds stranded slots is the one state where StopLocked no longer no-ops,
        // and that is the whole of J-2's safety fix; the sentence above is about the ordinary case and stays
        // true of it.)
        //
        // 🔴 IF YOU ARE HERE TO DELETE `halted` BECAUSE NOTHING FAILS WITHOUT IT: NOTHING WILL. Measured —
        // mutation N5 removed the `if (halted)` guard below and SURVIVED the whole suite, with the round's
        // positive control on record. The guard is DEFENSIVE and its path is unreachable today: `halted` is
        // false only if StopLocked() or `_estopEngaged = true` throws, and StopLocked cannot (its
        // Cts.Cancel() is caught per slot; the unsubscribe/ToList/Clear cannot throw). It is kept because
        // "effectively non-throwing today" is a property of the current callee, not of this method — this
        // branch's own recurring rule — and because the day StopLocked gains a throw, the failure this guard
        // prevents is a FABRICATED halt in the OEE timeline, which no test would catch either. Deleting it is
        // silent in both directions; that is the argument for keeping it, not against.
        PipelineHandle handle = default;
        var halted = false;
        try
        {
            lock (_gate)
            {
                // 🔴 J-1 fix round 1 (review I-1) — a HALT is a request for the pipeline to be down too, so
                // it counts here for the same reason Stop() does.
                //
                // 🔴 BRANCH REVIEW, Critical — THE ORIGINAL JUSTIFICATION HERE HAD THE EXECUTION ORDER
                // BACKWARDS. It read "belt-and-braces rather than load-bearing: `_estopEngaged` below
                // already makes StartLocked's latch refuse any start whose install lands after this point,
                // and THAT LATCH IS THE GUARD." On Start()'s path it is the other way round: this increment
                // makes Start() abandon BEFORE StartLocked runs, so for an Estop landing in Start()'s build
                // window THIS COUNTER is the guard and the latch never executes. The two mechanisms do not
                // "agree" there — this one shadows the other. Measured, not reasoned: with the latch deleted
                // the whole 1330-test suite stayed green until a witness was added on the restart path.
                //
                // KEPT, and the reason is about which failure each mechanism can still catch. The latch
                // remains the ONLY guard on the RebuildPipelineOffLock path (🔴 J-1b gave that method a
                // pre-check, but it is read BEFORE the build and reads no counter, so an Estop landing in
                // that build window still meets the latch and nothing else — which is why that arm's witness
                // survived J-1b, re-measured rather than assumed), so it is live code with its own witness;
                // this increment additionally makes an
                // Estop win Start()'s window without depending on _estopEngaged still being set by the time
                // the install runs — which an EstopReset in the same window could otherwise clear. Removing
                // it would hand that interleaving back to the latch and change which pre-J-1 arm the race
                // resolves to, for no gain now that the latch is witnessed elsewhere.
                _stopRequests++;

                handle = StopLocked();
                _estopEngaged = true;
                halted = true;

                // Review fix (Important) — same reasoning as Start()/Stop()'s own moved calls: kept inside
                // _gate so this NDEATH is serialized with the transition, never racing an off-gate concurrent
                // Start's NBIRTH. The historian run-event below stays OUTSIDE _gate (pre-existing async
                // fire-and-forget pattern, unchanged here).
                _unsPublisher?.PublishNodeDeath();
            }
        }
        finally
        {
            // Nested for the reason §8.1(e) now records: a throw inside a `finally` abandons the REST of that
            // same `finally`, and this first statement CAN throw — `RecordRunEventFireAndForget` is not
            // `async`, and its disposed-writer arm invokes the host's logWarning synchronously before
            // returning a Task. That is this member's own throw site (b). Order is unchanged: run event,
            // then teardown.
            try
            {
                if (halted)
                {
                    _ = _historianWriter?.RecordRunEventFireAndForget("Estop");
                }
            }
            finally
            {
                WaitAndDisposeOldPipeline(handle);
            }
        }
    }

    /// <summary>Clears the HALT latch <see cref="Estop"/> sets — an explicit, separate transition from
    /// <see cref="Start"/> (spec/C-2: "RESET clears the latch but does NOT auto-restart the fleet").
    /// The fleet stays stopped until an operator presses START again. SM-4/B-8: like <see cref="Estop"/>,
    /// this only ever touches this software's own supervisory latch/pipeline — it never calls
    /// <see cref="TryWriteSetpointAsync"/>/<see cref="TryInvokeCommandAsync"/> (the real write path a
    /// device now has, since B-4/B-5), so clearing the latch has no effect on any physical machine
    /// either.</summary>
    public void ResetEstop()
    {
        lock (_gate)
        {
            _estopEngaged = false;
        }

        _ = _historianWriter?.RecordRunEventFireAndForget("EstopReset");
    }

    /// <summary>Review fix round 1 — the ONLY two connector ids whose pipeline slot label must reproduce a
    /// pre-existing (pre-GP-4) literal spelling that differs from the id itself: <c>"modbus"</c>/<c>"opcua"</c>
    /// (lowercase), not <see cref="DriverKinds.Modbus"/>/<see cref="DriverKinds.OpcUa"/> (the canonical,
    /// PascalCase spelling). Every OTHER connector id — built-in or third-party — uses the id ITSELF,
    /// verbatim, as its slot label; see <see cref="ResolveConnectorSlotLabel"/>'s own remarks for why that
    /// (not a general lowercasing rule) is what actually prevents a label collision.</summary>
    private static readonly IReadOnlyDictionary<string, string> LegacyConnectorSlotLabels =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [DriverKinds.Modbus] = "modbus",
            [DriverKinds.OpcUa] = "opcua",
        };

    /// <summary>Review fix round 1 — the pipeline slot label for a registry-driven connector. Originally
    /// <c>connectorId.ToLowerInvariant()</c>, which reproduced <c>"modbus"</c>/<c>"opcua"</c> correctly but
    /// was NOT collision-free: <see cref="DriverKinds"/>' own casing rule deliberately keeps a THIRD-PARTY
    /// id case-SENSITIVE (so <c>"Vendor.Acme.Weld"</c> and <c>"vendor.acme.weld"</c> are two distinct,
    /// simultaneously-registrable connectors), and lowercasing both would have produced the SAME slot label
    /// for two genuinely different connectors — <see cref="Alarms.AlarmEvaluator"/> keys its degraded/down
    /// alarms on exactly this label (<c>DegradedKey</c>/<c>DownKey</c>, <c>TargetId: slot.SlotLabel</c>), so
    /// one connector's alarms would silently clobber the other's. Same hazard for a connector registered
    /// with <c>Kind="Simulated"</c>: lowercased, that collided with the always-present sim group's own
    /// hardcoded <c>"simulated"</c> label below.
    ///
    /// Fixed by using the (already-normalized) connector id VERBATIM as the label for everything except the
    /// two built-ins that need a literal pre-existing spelling (<see cref="LegacyConnectorSlotLabels"/>) —
    /// this is what is actually collision-free: every <see cref="ConnectorRegistry.RegisteredIds"/> entry is
    /// already guaranteed unique (it is a dictionary key), so two DIFFERENT registered ids can never produce
    /// the SAME label under this rule, and <c>"Simulated"</c> (PascalCase, the canonical built-in spelling)
    /// no longer collides with the sim group's own lowercase <c>"simulated"</c> literal.</summary>
    private static string ResolveConnectorSlotLabel(string connectorId) =>
        LegacyConnectorSlotLabels.TryGetValue(connectorId, out var legacyLabel) ? legacyLabel : connectorId;

    /// <summary>The literal, lowercase slot label the built-in simulated group always uses (see
    /// <see cref="StartLocked"/>'s <c>groups.Add((SimulatedSlotLabel, driver, ...))</c> call). Review fix
    /// round 1 (task-2-report.md, Minor) — named as a shared constant rather than a literal repeated at each
    /// of its two use sites (<see cref="StartLocked"/>'s own group-building AND <see cref="ResolveSlotLabelFor"/>
    /// below): a repeated literal is exactly the kind of "two places that can silently drift apart" hazard
    /// this same fix round closed for the machine-&gt;slot-label RULE itself (see <see cref="ResolveSlotLabelFor"/>'s
    /// own doc comment) — the label string deserves the identical guarantee.</summary>
    private const string SimulatedSlotLabel = "simulated";

    /// <summary>Review fix round 1 (Critical, task-2-report.md) — the ONE place this codebase decides which
    /// pipeline slot a <see cref="St4i.EdgeCore.Models.MachineDescriptor.DriverKind"/> maps to. Extracted
    /// verbatim (no behavior change) from <see cref="StartLocked"/>'s own <c>simFleet</c> filter — that method
    /// now calls this instead of restating the same three-clause union inline — specifically so
    /// <see cref="ResolveWritableDriver"/> could reuse the REAL rule rather than re-deriving its own,
    /// different (and, as review round 1 proved with a running probe, WRONG) approximation: a third-party-kind
    /// roster machine with NO connector currently registered for its kind falls back to being driven by the
    /// <see cref="SimulatedSlotLabel"/> group below — a real, tested, intentional behavior
    /// (<c>FleetHostThirdPartyRosterTests.ThirdPartyRosterMember_NoConnectorRegisteredForThatId_FallsBackToSimulation</c>)
    /// that <see cref="ResolveWritableDriver"/>'s original approximation didn't account for, so it reported
    /// <see cref="MachineDriverAvailability.NoLiveDriver"/> for a machine that was, in fact, live and cycling.
    ///
    /// <para>The rule itself (unchanged from <see cref="StartLocked"/>'s original inline expression — see the
    /// large comment block just above that method's <c>simFleet</c> line for the full historical reasoning,
    /// preserved there rather than duplicated here): Modbus/OPC-UA are excluded from the simulated group
    /// UNCONDITIONALLY, regardless of whether either currently has a connector registered (mirroring
    /// <see cref="ResolveConnectorSlotLabel"/>'s own legacy-label carve-out for exactly these two ids).
    /// Everything else is driven by the simulated group UNLESS a connector is actually registered for its
    /// (normalized) kind right now — <see cref="DriverKinds.Simulated"/> itself is checked FIRST, before ever
    /// consulting the registry, which is what lets a third party register a connector under
    /// <c>Kind="Simulated"</c> as a genuinely SEPARATE, additional slot without that registration silently
    /// reclassifying every ordinary simulated roster machine (whose OWN <c>DriverKind</c> is also
    /// <c>"Simulated"</c>) as "no longer simulated." <see cref="DriverKinds.Normalize"/> is applied once, up
    /// front — the SAME canonical id-comparison rule every other comparison in this class already uses, never
    /// re-derived a second time.</para></summary>
    private string ResolveSlotLabelFor(string driverKind)
    {
        var normalizedKind = DriverKinds.Normalize(driverKind);

        if (normalizedKind == DriverKinds.Modbus || normalizedKind == DriverKinds.OpcUa)
        {
            return ResolveConnectorSlotLabel(normalizedKind);
        }

        var registeredConnectorIds = _connectorRegistry?.RegisteredIds;
        var isSimulated = normalizedKind == DriverKinds.Simulated
            || registeredConnectorIds is null
            || !registeredConnectorIds.Contains(normalizedKind);

        return isSimulated ? SimulatedSlotLabel : ResolveConnectorSlotLabel(normalizedKind);
    }

    /// <summary>
    /// Task D-1 (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-1-brief.md) — the slot label for
    /// ONE ROSTER MACHINE, which is a strictly finer question than <see cref="ResolveSlotLabelFor"/>'s "which
    /// slot does this KIND go to". Before D-1 the two were the same question, and that is exactly what made
    /// multidrop inexpressible and <see cref="MachineDriverAvailability.AmbiguousDriver"/> necessary: every
    /// Modbus machine in the roster resolved to the one <c>"modbus"</c> slot, so nothing could say which
    /// physical device the single live driver was talking to.
    ///
    /// <para><b>The new rule, in one sentence:</b> if a registered connector INSTANCE declared that it serves
    /// this machine's code (<see cref="ConnectorRegistry.TryGetInstanceIdForMachine"/>), the machine belongs to
    /// THAT instance's slot; otherwise the pre-D-1 kind-based rule governs it, byte for byte. Because
    /// <see cref="ConnectorRegistry.Register"/> refuses a machine-code claim another instance already holds,
    /// the first branch is 1:1 by construction — one machine, one instance, one slot, one driver.</para>
    ///
    /// <para><b>Why this is ONE method both <see cref="StartLocked"/> and <see cref="ResolveWritableDriver"/>
    /// call</b>, rather than each deriving its own: that is the identical mistake Đợt B's review round 1
    /// caught with a running probe (<see cref="ResolveSlotLabelFor"/>'s own doc comment records it) — two
    /// independent statements of one rule drifted apart and a live machine was reported
    /// <see cref="MachineDriverAvailability.NoLiveDriver"/>. Adding a second, finer rule in D-1 without
    /// funnelling both callers through it would have re-created that hazard immediately: the simulation-
    /// exclusion filter and the write-resolution path must agree on which slot drives a machine, or a machine
    /// gets simulated AND written to, or neither.</para>
    /// </summary>
    /// <summary>🔴 D-1 review, m3 — <b>the binding snapshot is a REQUIRED parameter, and there is deliberately
    /// no convenience overload that takes its own.</b> A one-argument version existed briefly and the
    /// re-review flagged it correctly: it was the shorter, more inviting signature AND the unsafe one,
    /// because taking a fresh snapshot per call is exactly the per-iteration inconsistency m3 removed — the
    /// next person to call it in a loop would have silently reintroduced the defect. Every caller must take
    /// ONE <see cref="ConnectorRegistry.SnapshotBindings"/> and thread it through (see that method's own
    /// remarks for why independent reads are independent points in time even under <see cref="_gate"/>).
    /// A <see langword="null"/> snapshot means "no registry wired", identical to an empty one.</summary>
    private string ResolveSlotLabelForMachine(
        MachineDescriptor descriptor, IReadOnlyList<ConnectorRegistry.ConnectorBinding>? bindings)
    {
        if (bindings is not null && TryFindBoundInstance(bindings, descriptor.Code, out var boundInstanceId))
        {
            return ResolveConnectorSlotLabel(boundInstanceId);
        }

        return ResolveSlotLabelFor(descriptor.DriverKind);
    }

    /// <summary>Task D-1 — which registered instance in <paramref name="bindings"/> declared that it serves
    /// <paramref name="machineCode"/>? The snapshot-based twin of
    /// <see cref="ConnectorRegistry.TryGetInstanceIdForMachine"/>, matching case-insensitively exactly as
    /// that method does (and as every other machine-code comparison in this class does). At most one entry
    /// can match — <see cref="ConnectorRegistry.Register"/> refuses a second claim on one code — so the first
    /// hit is the only hit.</summary>
    private static bool TryFindBoundInstance(
        IReadOnlyList<ConnectorRegistry.ConnectorBinding> bindings, string machineCode,
        [NotNullWhen(true)] out string? instanceId)
    {
        foreach (var binding in bindings)
        {
            if (binding.MachineCode is not null
                && string.Equals(binding.MachineCode, machineCode, StringComparison.OrdinalIgnoreCase))
            {
                instanceId = binding.InstanceId;
                return true;
            }
        }

        instanceId = null;
        return false;
    }

    /// <summary>Task D-1 — does a registered connector instance that is BOUND to a specific machine own the
    /// pipeline slot called <paramref name="label"/>? Derived by running the one label rule
    /// (<see cref="ResolveConnectorSlotLabel"/>) forward over every registered instance rather than trying to
    /// invert it — the legacy carve-out means the label and the id differ for exactly two built-ins, and an
    /// inverse mapping would be a second, silently-drifting statement of that same table. Reads the same
    /// snapshot its caller already took (D-1 review, m3).</summary>
    private bool AnyBoundInstanceOwnsSlotLabel(
        IReadOnlyList<ConnectorRegistry.ConnectorBinding>? bindings, string label)
    {
        if (bindings is null) return false;

        foreach (var binding in bindings)
        {
            if (binding.MachineCode is not null
                && string.Equals(ResolveConnectorSlotLabel(binding.InstanceId), label, StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>🔴 J-1 — the directory <c>mapping/*.json</c> presets live in, resolved the same
    /// "next to the exe" way <see cref="ResolveFleetPath"/> resolves <c>fleet.json</c>. Named once because
    /// J-1 gave it a second reader: <see cref="BuildStartPlan"/> resolves the whole roster off-lock and
    /// <see cref="StartLocked"/> resolves any late arrival under the lock, and two independently-written
    /// copies of one path expression is the drift hazard this file's own <see cref="SimulatedSlotLabel"/>
    /// exists to record.</summary>
    private static readonly string MappingDirectory = Path.Combine(AppContext.BaseDirectory, "mapping");

    /// <summary>🔴 J-1 fix round 1 (review Minor 6) — the comparer for <see cref="StartPlan.MappingKeys"/>,
    /// pinned to <see cref="StringComparer.OrdinalIgnoreCase"/> on BOTH string members so the set answers
    /// the same question <c>MappingProfileResolver</c>'s own <c>OrdinalIgnoreCase</c> map answers. A default
    /// tuple comparer is ordinal, which made the two disagree on case; see the census loop in
    /// <see cref="BuildStartPlan"/> for what that cost and why it was unreachable rather than harmless.</summary>
    private static readonly IEqualityComparer<(string Code, string? MappingProfile, DeviceClass DeviceClass)>
        MappingKeyComparer = new MappingKeyEqualityComparer();

    private sealed class MappingKeyEqualityComparer
        : IEqualityComparer<(string Code, string? MappingProfile, DeviceClass DeviceClass)>
    {
        // 🔴 Fix round 2 (re-review Minor) — THE TWO STRINGS GET DIFFERENT COMPARERS, because they are
        // different KINDS of thing and the round-1 justification proved that only for one of them.
        //
        // Code is OrdinalIgnoreCase because the thing this set stands in for — MappingProfileResolver's
        // machineCode -> profile dictionary — is Code-keyed and OrdinalIgnoreCase.
        //
        // MappingProfile is ORDINAL, and round 1 had it insensitive on the strength of that same sentence,
        // which never applied to it: the resolver does not key on MappingProfile at all. It is a PATH
        // FRAGMENT — Path.Combine(mappingDir, MappingProfile + ".json") handed to File.Exists — so whether
        // two spellings name one file is a property of the FILESYSTEM, not of this class. On Windows they
        // do; on a case-sensitive filesystem "Foo" and "foo" are two different files with two different
        // profiles inside them. Comparing insensitively there would let this set answer "the plan already
        // resolved that" about a descriptor whose file the plan never opened — a stale profile served with
        // nothing red, which is the WRONG-WAY failure. Ordinal errs the other way: two spellings that turn
        // out to be one file cost one redundant resolve under the lock and produce the identical profile.
        public bool Equals(
            (string Code, string? MappingProfile, DeviceClass DeviceClass) x,
            (string Code, string? MappingProfile, DeviceClass DeviceClass) y) =>
            string.Equals(x.Code, y.Code, StringComparison.OrdinalIgnoreCase)
            && string.Equals(x.MappingProfile, y.MappingProfile, StringComparison.Ordinal)
            && x.DeviceClass == y.DeviceClass;

        public int GetHashCode((string Code, string? MappingProfile, DeviceClass DeviceClass) obj) =>
            HashCode.Combine(
                StringComparer.OrdinalIgnoreCase.GetHashCode(obj.Code),
                obj.MappingProfile is null ? 0 : StringComparer.Ordinal.GetHashCode(obj.MappingProfile),
                obj.DeviceClass);
    }

    /// <summary>🔴 J-1 — copies the <see cref="_gate"/>-protected inputs a pipeline build reads, so that
    /// <see cref="BuildStartPlan"/> can run with the lock released. <b>Assumes the caller holds
    /// <see cref="_gate"/>.</b>
    ///
    /// <para><b>What is in here is an enumeration, and so is what is not.</b> IN: the roster (copied — the
    /// live list keeps being mutated under the lock), the scenario's cycle-rate multiplier (the only part of
    /// <see cref="_scenario"/> a build consumes; the driver reads the scenario itself through a live lambda,
    /// so nothing else about it can go stale), and one <see cref="ConnectorRegistry.SnapshotBindings"/> —
    /// taken here for the same "one consistent view, not a fresh one" reason that method's own doc comment
    /// gives, and used ONLY to decide which machines the build should prepare simulators for.</para>
    ///
    /// <para>NOT in here, deliberately: <see cref="_running"/> and <see cref="_estopEngaged"/>. A snapshot of
    /// either would be a copy of the HALT latch, and a copy of a latch is exactly the thing that must not
    /// exist — <see cref="StartLocked"/> re-reads both under the lock at install time and that reading is
    /// the only one that decides anything. Callers may also test them before calling this, and that test is
    /// an OPTIMISATION (it keeps a start attempt made while latched from doing any I/O at all); it is never
    /// the guard.</para></summary>
    private StartInputs SnapshotStartInputsLocked()
    {
        var multiplier = _scenario.CycleRateMultiplier > 0 ? _scenario.CycleRateMultiplier : 1.0;
        return new StartInputs(_fleet.ToList(), multiplier, _connectorRegistry?.SnapshotBindings(), _stopRequests);
    }

    /// <summary>🔴 J-1 — builds everything a pipeline needs that costs I/O to produce. <b>MUST NOT be called
    /// while holding <see cref="_gate"/>; that is the entire point.</b> This is where the enumeration's P4
    /// (<c>MappingProfileResolver.Build</c> → <c>File.Exists</c>/<c>File.ReadAllText</c> per machine) and P5
    /// (<c>SimulatorFactory.Create</c> → <c>SimulatorBase</c>'s ctor → <c>MachineConfigStore.Ensure</c> →
    /// <c>File.WriteAllText</c> + <c>File.Move</c>, plus that store's own lock) now run.
    ///
    /// <para><b>Nothing this method produces owns a resource.</b> <c>IMachineSimulator</c> has no
    /// <c>Dispose</c>, and no <see cref="IDeviceDriver"/> is constructed here — driver construction stays in
    /// <see cref="StartLocked"/> on purpose, so a plan that is never installed (the HALT latch refused it)
    /// can simply be dropped. Hoisting the driver too would have created a class of leak that did not exist
    /// before: a live <c>ScenarioAwareDriver</c>, or whatever <see cref="DriverDecoratorForTests"/> wrapped
    /// it in, with no owner and no disposal path.</para>
    ///
    /// <para><b>It reads no <see cref="_gate"/>-protected field.</b> Everything comes from
    /// <paramref name="inputs"/> or from readonly ctor fields. The one apparent exception is
    /// <see cref="ResolveSlotLabelForMachine"/> → <see cref="ResolveSlotLabelFor"/>, which reads
    /// <c>_connectorRegistry.RegisteredIds</c> live — that is a <see cref="ConcurrentDictionary{TKey,TValue}"/>
    /// key enumeration behind no lock of ours, safe from any thread, and it was already an independent point
    /// in time from the bindings snapshot before J-1.</para></summary>
    private StartPlan BuildStartPlan(StartInputs inputs)
    {
        var deferredLogs = new List<DeferredLogEntry>();

        var multiplier = inputs.Multiplier;
        var effectiveFleet = Math.Abs(multiplier - 1.0) < 1e-9
            ? inputs.Fleet
            : inputs.Fleet.Select(d => d with { CycleSeconds = Math.Max(MinCycleSeconds, d.CycleSeconds / multiplier) }).ToList();

        var simFleet = effectiveFleet
            .Where(d => ResolveSlotLabelForMachine(d, inputs.Bindings) == SimulatedSlotLabel).ToList();
        var sims = simFleet
            .Select((d, i) => SimulatorFactory.Create(d, seed: 1000 + i, _configStore, CurrentProductFor, multiplier, _productConfigStore))
            .ToList();

        var mappingResolver = MappingProfileResolver.Build(
            effectiveFleet,
            MappingDirectory,
            logWarning: msg => deferredLogs.Add(new DeferredLogEntry(null, msg)),
            logError: (ex, msg) => deferredLogs.Add(new DeferredLogEntry(ex, msg)));

        // 🔴 J-1 fix round 1 (review Minor 6) — the comparer is stated, not defaulted. This set decides
        // "did the plan already resolve a mapping profile for this descriptor", and the thing it is standing
        // in for is MappingProfileResolver's own map, which is keyed OrdinalIgnoreCase. A default tuple
        // HashSet compares every string ORDINALLY, so `LINE-1` and `line-1` were two different keys here and
        // one key there — the plan would have been asked to supplement a code it had in fact already
        // resolved. That is only unreachable because RegisterMachine's duplicate check is case-insensitive,
        // i.e. "benign by a property of another call site", which is the sentence pattern the banner at the
        // top of this file exists to stop people writing. Matching the comparer to the map removes the
        // question instead of answering it. 🔴 Fix round 2 — MappingProfile does NOT get that comparer, and
        // round 1's reason for giving it one ("two spellings that name the same file must not look like two
        // different keys") was the Code argument applied to something it does not describe: whether two
        // spellings name the same file is the FILESYSTEM's answer, not this class's. See the comparer.
        //
        // 🔴 BRANCH REVIEW — AND THE REACHABILITY CLAIM AROUND IT WAS TOO GENEROUS TO ITSELF. Fix round 2
        // recorded the case-divergence as "only constructible on a case-sensitive filesystem", carrying it
        // as something a Linux runner would catch. It is not constructible ANYWHERE: this set is keyed on
        // Code among other things, `_fleet` is append-only, and MachineDescriptor is immutable, so one code
        // can never appear twice with two profile spellings for the two keys to disagree over — no
        // filesystem enters into it. The Linux-runner carry is withdrawn. What remains true, and is the only
        // thing worth watching, is that the case-insensitive duplicate check this rests on lives in
        // RegisterMachine: a roster seeded through FleetConfig.Load (fleet.json) does not pass through it,
        // so two entries differing only in case would enter `_fleet` unchallenged. That is a fleet.json
        // question, not a comparer one, and the comparer is correct either way.
        var mappingKeys = new HashSet<(string, string?, DeviceClass)>(MappingKeyComparer);
        foreach (var d in effectiveFleet)
        {
            mappingKeys.Add((d.Code, d.MappingProfile, d.DeviceClass));
        }

        // 🔴 J-1 — last statement, after both hoisted halves, and with _gate released. See
        // StartBuildObserverForTests for why this seam had to be a third one rather than a reuse of either
        // existing seam.
        StartBuildObserverForTests?.Invoke();

        return new StartPlan(simFleet, sims, multiplier, mappingResolver, mappingKeys, deferredLogs);
    }

    /// <summary>🔴 J-1 — the shared off-lock rebuild <see cref="RegisterMachine"/> and
    /// <see cref="ApplyScenario"/> owe after their teardown: build off <see cref="_gate"/>, install under it,
    /// finish off it. 🔴 J-1b prefixes one more step — READ the latch under <see cref="_gate"/> before
    /// building, symmetric with <see cref="Start"/>'s own pre-check and an optimisation in exactly the same
    /// sense; see the block comment inside for what it does and does not remove.
    /// <b>MUST NOT be called while holding <see cref="_gate"/>.</b>
    ///
    /// <para><b>Why this is a method and not three statements inlined at each caller.</b> Both callers run
    /// it from a <c>finally</c>, and blueprint §8.1(e) is specifically about a <c>finally</c> whose second
    /// statement is abandoned when its first throws. As ONE statement there is no such question to answer at
    /// either call site — the question moves in here, where it is answered once: if
    /// <see cref="BuildStartPlan"/> throws, no lock has been taken, no slot exists and nothing is committed,
    /// so the <c>finally</c> below has nothing to release and nothing to say — it runs the completion over
    /// two EMPTY lists this method allocated before the <c>try</c>. The exception propagates to the caller
    /// exactly as a throw from the pre-J-1 in-lock build did.
    /// <para>🔴 <b>T-1 fix round 1 — THIS SENTENCE SAID "over <c>default(StartOutcome)</c>, which is a no-op
    /// on both halves", AND IT HAS BEEN UNREACHABLE SINCE J-2 FOR THE ORPHAN HALF AND SINCE T-1 FOR THE
    /// OTHER.</b> Worse, T-1 rewrote the paragraph three lines below it and left this one contradicting a
    /// sentence T-1 itself wrote in <see cref="Start"/> ("the completion is no longer a no-op anywhere").
    /// That is a NEW pair of paragraphs in this file disagreeing about the same question — the thing the task
    /// existed to end — and it is recorded here rather than silently replaced.</para>
    /// <para>🔴 <b>AND THE CORRECTED SENTENCE OWES ONE MORE FACT, WHICH NOTHING IN <c>src/</c> SAYS: after
    /// T-1 the PLAN'S OWN LIST IS THE ONLY PLACE ON THE START PATH WHERE A DEFERRED LINE CAN STILL BE
    /// LOST.</b> <see cref="BuildStartPlan"/> declares its <c>deferredLogs</c> as a local and hands it out
    /// only inside the <see cref="StartPlan"/> it returns, so a throw from inside that method AFTER the
    /// resolver has already warned for earlier descriptors takes those lines out of scope with nothing able
    /// to reach them — the same shape T-1 just closed, one level up. It is NAMED rather than fixed, and the
    /// two questions are kept apart deliberately: <b>reachability</b> is narrow (<c>ResolveOne</c> catches
    /// <c>IOException</c>/<c>UnauthorizedAccessException</c>/<c>JsonException</c>, so only an exception
    /// outside those three out of <c>MappingProfile.FromJson</c>, or an allocation failure, gets past it), and
    /// narrowness answers "fix it?" but never answers "say it?". Closing it means the caller allocating the
    /// list and <see cref="BuildStartPlan"/> filling it, which is this same transformation a third time and
    /// is not T-1's to take on the owner's ruling for a different path.</para></para>
    ///
    /// <para><b>What this does NOT close, stated because it would be easy to claim.</b> A build that throws
    /// still leaves the fleet stopped with the roster/scenario write already committed — that is the second
    /// half of S4, and moving the throw site from inside the lock to outside it does not change what a
    /// failed call means to its caller. That is named in the banner at the top of this file and it is not
    /// J-1's to decide.
    /// <para>🔴 <b>J-2 then T-1 — S4's second half is STILL open here and was re-derived rather than
    /// inherited; the other two things that used to be lost at this site are not.</b> The orphaned connector
    /// drivers (J-2) and the deferred lines (T-1) are both allocated by this method and handed to
    /// <see cref="StartLocked"/>, so the <c>finally</c> below releases the first and emits the second whether
    /// that call returned or threw. 🔴 The sentence this paragraph replaced said the plan's deferred lines
    /// "are still lost on that path (they are a local of the <c>try</c>)" — it was true of the LIST, and it
    /// was already imprecise about WHOSE local: the plan's lines are the plan's, and what lost them was the
    /// list inside <see cref="StartLocked"/> they were copied into.</para></para></summary>
    private void RebuildPipelineOffLock(StartInputs inputs)
    {
        // 🔴 J-1b (brief at .superpowers/sdd/symmetric-precheck/task-1-brief.md — UNTRACKED, that whole
        // tree is gitignored, so treat this as provenance and never as a place to go for a fact; every fact
        // this comment relies on is stated here) — THE PRE-CHECK, SYMMETRIC WITH
        // Start()'s, AND AN OPTIMISATION FOR THE SAME REASON THAT ONE IS. Same test, same lock, same place
        // relative to the build: BEFORE it. StartLocked's latch re-reads both flags under the install's own
        // acquisition and that reading is the one that decides — deleting this line only wastes work;
        // deleting the latch opens a window on the safety path. J-1 left it as an owner decision and the
        // owner decided yes.
        //
        // WHAT IT REMOVES, as quantities rather than as "less work". An Estop landing between this method's
        // caller releasing _gate and this line leaves the fleet halted before the build starts. Without this
        // check the build runs anyway and is refused afterwards, having done: P4 — one File.Exists per
        // descriptor carrying a mappingProfile, plus a File.ReadAllText for each such file that exists; and
        // P5 — one whole-file rewrite of machine-operating-config.json (File.WriteAllText + File.Move) per
        // simulated machine not yet in that store, each taking MachineConfigStore's own lock. Filesystem work
        // on the HALT path, against a root ST4I_MACHINE_CONFIG_DIR may point at a UNC share, and the place
        // MachineConfigStore.Ensure's InvalidOperationException/IOException can be thrown out of a call that
        // pre-J-1 was a guaranteed silent no-op.
        //
        // 🔴 WHAT IT DOES NOT REMOVE, MEASURED RATHER THAN REASONED, because the brief that ordered it named
        // a different case: AN ALREADY-LATCHED FLEET NEVER REACHES THIS METHOD AT ALL. Both callers rebuild
        // only `if (IsRunning)` (RegisterMachine) / `if (IsRunning && multiplierChanged)` (ApplyScenario),
        // and Estop's own StopLocked leaves _running false — so a RegisterMachine/ApplyScenario made while
        // the HALT latch is engaged does ZERO reads and ZERO writes, and did so before this line existed.
        // The window this line covers is the TEARDOWN one and only that: the caller's lock release, through
        // WaitAndDisposeOldPipeline (bounded by RestartTeardownTimeout per old slot, once for the run-task
        // wait and once for the driver's DisposeAsync), to here. Both facts are pinned by tests —
        // AnEstopLandingInTheRestartTeardown_IsRefusedBeforeTheRebuildBuildsAnything (this check's own
        // witness) and ARegisterOrScenarioChangeMadeWhileTheLatchIsEngaged_NeverReachesTheRebuild (the zero
        // above, which stays green with this check deleted — that is what says the zero belongs to the
        // callers' IsRunning guards rather than to this line). 🔴 Review I-1: the second name here was
        // written WRONG the first time — a cross-reference that resolves to nothing reads as coverage, which
        // is worse than no reference at all.
        //
        // IT IS ONE MORE `lock (_gate)` REGION PER REBUILD — the twenty-first in this file — AND TAKES NO
        // OTHER LOCK WHILE HOLDING IT, so the five-lock ordering set at the top of this file is unchanged and
        // gains no sixth member. (🔴 Branch review Minor 14: this said "one more ACQUISITION", which is one
        // short — `IsRunning` re-enters the same monitor inside the region, so it is one region and two
        // acquisitions. The invariant this sentence carries is about the ORDERING SET, and re-entering the
        // monitor you already hold adds no pair to it; the count is corrected because the sentence is doing
        // invariant work, not because the invariant moved.)
        //
        // IT ERRS IN THE SAFE DIRECTION, and the one interleaving where it changes an OUTCOME rather than an
        // amount of work is worth naming: a flag that is set here and cleared again before the install (an
        // Estop then a ResetEstop, or a racing Start then a Stop, both inside the build window) used to end
        // with this rebuild installing a pipeline. It now ends stopped. Both directions move TOWARDS a
        // documented contract rather than away from one — ResetEstop's own doc says a reset "does NOT
        // auto-restart the fleet", and a Stop that an operator asked for winning is the same resolution
        // _stopRequests already chose for Start(). Note this reads STATE, never a request count: point (3) at
        // both call sites — that a restart is not a request for the fleet to end stopped — is unchanged.
        //
        // 🔴 AND THERE IS DELIBERATELY NO RE-CHECK AFTER THE BUILD. That is the check that would cover the
        // BUILD window, and it is the shape this branch has already paid a Critical for: sited after the
        // build it would shadow StartLocked's latch here exactly as _stopRequests shadows it on Start()'s
        // path — and this path carries the latch's only _estopEngaged witness. That witness survives this
        // line because the Estop it injects lands at the END of BuildStartPlan, i.e. after this check and
        // before the install. Measured on the post-J-1b tree, not inherited: §8.1(h) is exactly the rule that
        // an upstream early return like this one invalidates a mutation result nobody re-ran.
        lock (_gate)
        {
            if (IsRunning || _estopEngaged) return;
        }

        // 🔴 J-2 — declared OUTSIDE the `try`, for the reason Start()'s copy of this line records in full:
        // an orphaned connector driver owns a live socket, and a StartLocked that throws must not be able to
        // take it out of scope. This is the symmetric site, changed the same way and in the same commit.
        // 🔴 T-1 — and the deferred lines are declared beside it now, for the reason Start()'s copy of THAT
        // line records in full. Both are the caller's; StartLocked only fills them.
        var orphanedConnectorDrivers = new List<IDeviceDriver>();
        var deferredLogs = new List<DeferredLogEntry>();

        // 🔴 T-1 fix round 1 — the fault flag, symmetric with Start()'s and carrying the same argument in
        // full there: one write site below, one read site in the completion's filter, correct by default for
        // any return a future edit adds. Note this method's own pre-check returns BEFORE the `try`, so it
        // cannot reach the flag at all.
        var installFaulted = false;
        try
        {
            var plan = BuildStartPlan(inputs);
            lock (_gate) { StartLocked(plan, orphanedConnectorDrivers, deferredLogs); }
        }
        catch (Exception ex)
        {
            installFaulted = true;

            // 🔴 U-1 (docs/owner-decisions.md item 7) — S4's SECOND HALF, AND THIS WRITE IS THE WHOLE OF THE
            // BEHAVIOUR CHANGE. A restart that fails leaves the fleet STOPPED with the roster/scenario write
            // committed, and every per-field read surface is truthful about that: IsRunning says stopped,
            // GetDriverHealth lists exactly the slots the install left behind, Fleet/CurrentScenario report
            // what was committed. The surface that was NOT truthful is the one that SUMMARISES them —
            // GET /v1/health is literally `LastError is null`, so it answered HEALTHY for a fleet an internal
            // restart had torn down and could not rebuild. Every entry path reaches this catch, so one write
            // covers all three.
            //
            // 🔴 U-1 SELF-CORRECTION, and it is recorded rather than quietly rewritten because it is the
            // shape this file has a banner about: the clause above read "GetDriverHealth lists NOTHING",
            // which is a FALSE UNIVERSAL. It holds when BuildStartPlan throws (StopLocked cleared `_slots`
            // and no slot was built) and fails when StartLocked throws mid-slot-loop — that state is
            // consequence (2) of S3's residual, named in this file's own banner, so the counter-example was
            // already written down two thousand lines up. `_slots` is reported truthfully either way, which
            // is what the paragraph needed and all it needed; the universal was decoration that could be
            // wrong, in the justification for a task whose subject is a surface that lied.
            //
            // WHY THIS FIELD AND NOT A PROJECTION OF ITS OWN: the clearing rule already exists and is already
            // the right one. StartLocked's `LastError = null` sits PAST its latch, so the report survives
            // until a start actually installs, and a rebuild the latch refuses does not clear it. A new
            // projection would add state, a lifetime and a read surface to say what this field already says.
            //
            // IT BROADENS A RESERVATION, and that is the price rather than a side effect: the connector loop
            // below reserved this property for "a slot that started and later faulted at RUNTIME" (that
            // sentence is corrected there, not only here). Both producers now report ONE event — a pipeline
            // stopped for a reason nobody asked for. The connector-issue projection is untouched and still
            // never reaches this field.
            //
            // `ex` IS THE OBJECT THIS METHOD RETHROWS, so on the two paths that have a caller the HTTP 500
            // and the health surface carry the same instance and cannot disagree about what failed —
            // Assert.Same in the witness, not a message match. 🔴 NOT a universal about what the caller
            // finally sees, and the exceptions are the two masking windows this file already names: J-2's
            // four-condition window at DisposeOrphanedConnectorDrivers, in the completion's `finally` below,
            // and RegisterMachine's outer drain `finally`. Either can replace this exception on its way out.
            // Both are documented at their own sites and neither is U-1's to close; what U-1 changes is that
            // `ex` now survives on a FIELD even when a later `finally` replaces it in flight, which is
            // strictly more than the caller had.
            //
            // On the third path — Burst's revert, whose Task nothing observes — this is the only place that
            // exception lands at all.
            //
            // THE GUARD IS AN IDENTITY GUARD, the same rule StartSlot's `if (removed)` applies: report only
            // while the state this fault describes still holds. `_running` is false on every uncontended
            // reach of this catch — StartLocked's `_running = true` is its LAST statement, so nothing in it
            // throws after that — so the guard costs nothing there. What it excludes is a concurrent Start
            // that already installed; clobbering a live fleet's health with a superseded restart's fault is
            // the defect RestartRace_OldPipelineFaultsAfterNewPipelineAlreadyStarted_DoesNotClobberIsRunningOrLastError
            // exists to prevent, reached from a second direction.
            //
            // THE HALT PATH STAYS SILENT, STRUCTURALLY RATHER THAN BY ASSERTION: both refusals RETURN — this
            // method's pre-check above, and StartLocked's latch — so neither can reach a `catch`. The one arm
            // that reaches it while latched is an Estop landing INSIDE the build against a root whose write
            // then throws. That one IS recorded, deliberately: the rebuild really did fail, the latch has its
            // own surface (GetSafetyStatus/EstopEngaged), and silence about what DID happen is what the owner
            // ruled against at item 6.
            //
            // IT IS ONE MORE `lock (_gate)` REGION — the twenty-second in this file. It reads one field and
            // writes one, reaches no I/O, no Dispose and no Cancel, and takes no other lock while held, so
            // the nine-path set and the five-lock ordering set at the top of this file are both unchanged.
            // The gate is NOT held on entry: a throw out of the `lock (_gate) { StartLocked(...) }` above
            // releases it on the way out.
            lock (_gate)
            {
                if (!_running)
                {
                    LastError = ex;
                }
            }

            throw;
        }
        finally
        {
            // Review fix round 2 — off-lock, same reasoning as WaitAndDisposeOldPipeline at both call sites.
            // 🔴 T-1 — the pair is built from two locals a throw cannot take away, so the completion does
            // real work on both halves whether the install returned or threw. Start() carries the full
            // argument, including the masking note and why the guard is the FAULT polarity.
            CompleteStartOffLock(new StartOutcome(orphanedConnectorDrivers, deferredLogs), installFaulted);
        }
    }

    /// <summary>Review fix round 2 — <see cref="StartLocked"/> USED to dispose an orphaned connector
    /// driver (see the connector loop below) inline, synchronously, while <see cref="_gate"/> was held by
    /// every one of its callers. That is a hazard this class's own review has already named twice: a
    /// slow/hung third-party <see cref="IDeviceDriver.DisposeAsync"/> would delay <see cref="Estop"/> — the
    /// exact "blocks the halt call" class of bug <see cref="IConnectorFactory.TryCreate"/>'s own doc comment
    /// warns against for <c>TryCreate</c> itself. <see cref="StartLocked"/> now only COLLECTS orphaned drivers
    /// — every caller disposes them via <see cref="DisposeOrphanedConnectorDrivers"/>
    /// AFTER releasing <see cref="_gate"/>, the same "wait/dispose must happen OUTSIDE _gate" discipline
    /// <see cref="WaitAndDisposeOldPipeline"/> already documents for the restart-teardown path. The list a
    /// caller hands to that disposal is the one it allocated itself, on every path including the
    /// early-return/no-op ones — this method never gives it a different one and never gives it none.
    /// <para>🔴 <b>T-1 fix round 1 — THE TWO SENTENCES THIS PARAGRAPH USED TO END WITH WERE TRUE AT BASE AND
    /// T-1 FALSIFIED THEM WITHOUT RE-DERIVING THEM, THIRTY-THREE LINES ABOVE ITS OWN "returns
    /// <see langword="void"/>" PARAGRAPH.</b> They read: orphans are collected <i>"into the returned list"</i>,
    /// and <i>"an empty list (never <see langword="null"/>) is returned on every early-return/no-op path
    /// below, so a caller can unconditionally hand the result to
    /// <see cref="DisposeOrphanedConnectorDrivers"/>"</i>. There is no returned list, no early-return list and
    /// no result. This is the ADDITIVE-REPAIR shape the banner at <see cref="_gate"/> already records against
    /// G-1 — the correction was appended and the defective sentence survived above it — reproduced by the
    /// task whose deliverable was to end it, inside the doc comment of the method it changed. Recorded rather
    /// than quietly rewritten, because the pattern is the finding.</para>
    ///
    /// <para>🔴 <b>J-1 — this method no longer BUILDS anything that costs I/O; it INSTALLS a
    /// <see cref="StartPlan"/> that <see cref="BuildStartPlan"/> produced off <see cref="_gate"/>.</b> That
    /// is what took the enumeration's P4 and P5 off this lock. Read <see cref="BuildStartPlan"/> and
    /// <see cref="SnapshotStartInputsLocked"/> together with this method — the three are one mechanism and
    /// no one of them is correct alone. It still derives the roster it installs from the LIVE
    /// <see cref="_fleet"/> under the lock, exactly as it did before J-1; the plan is a cache it consults,
    /// never a substitute for that read.</para>
    ///
    /// <para>🔴 <b>J-2 — <paramref name="orphanedConnectorDrivers"/> IS THE CALLER'S LIST, ALLOCATED BEFORE
    /// THE CALL, AND THAT IS THE WHOLE OF THE CHANGE.</b> It used to be a local here, handed back only in the
    /// returned <c>StartOutcome</c> — so a throw anywhere after the connector loop took every orphan
    /// out of scope with its socket open, and no caller <c>finally</c> could reach them because they had
    /// never existed anywhere a caller could name. The list is now named at the call site first; this method
    /// only fills it. The success path is byte-identical (same list, same contents, same order, disposed in
    /// the same place by the same caller) — only the guarantee is new, which is exactly the shape G-2's own
    /// <c>finally</c> fixes took.
    ///
    /// <para>🔴 <b>T-1 — <paramref name="deferredLogs"/> IS THE CALLER'S LIST FOR THE SAME MECHANICAL REASON
    /// AND A DIFFERENT SUBSTANTIVE ONE, AND THE DIFFERENCE IS WHY IT TOOK AN OWNER.</b> Mechanically it is
    /// the identical move and the success path is byte-identical the same way. Substantively, releasing a
    /// socket is owed whatever happened, while SAYING what happened is operator-facing output — and this
    /// paragraph used to argue that it therefore had to stay lost, on the ground that the two SIBLING
    /// non-installing paths (the HALT-latch refusal below and <see cref="Start"/>'s stop-abandon return) were
    /// each decided silent at their own site. <b>Those two paths install NOTHING; this one throws part-way
    /// through installing</b> — the resolver has run and fallen back, a connector has been rejected, and
    /// slots may already be live, which is the S-set banner's own consequence (2). The siblings are still
    /// silent and each has its own witness. See residual (3) at <see cref="_gate"/> for the ruling, for the
    /// level (chosen by each line's producer, not here) and for the projection the ruling rests on.</para>
    ///
    /// <para><b>This method returns <see langword="void"/> as of T-1, and that is a consequence rather than
    /// a second change.</b> With both lists owned by the caller there is nothing left for a return value to
    /// carry that a caller does not already hold — review I-3 measured the orphan half dead for exactly that
    /// reason and named this as the follow-up worth taking, because it turns "read the outcome back in the
    /// completion" from a red test into a compile error.</para></para></summary>
    private void StartLocked(
        StartPlan plan, List<IDeviceDriver> orphanedConnectorDrivers, List<DeferredLogEntry> deferredLogs)
    {
        // Defense in depth: the client already disables START while latched, but the engine itself
        // must refuse too — a stale client, a second panel, or a direct API call must never be able to
        // restart the read pipeline while the HALT latch is still engaged.
        // 🔴 T-1 — the refusal returns with BOTH caller-owned lists exactly as it found them: the orphan
        // list is empty because the connector loop is far below, and the deferred list is empty because the
        // plan's lines are appended one statement AFTER this line. That statement order is the whole of why
        // this refusal is still silent; see it, and see AnInstallRefusedByTheHaltLatch_StillSaysNothing.
        if (IsRunning || _estopEngaged) return;
        LastError = null;

        // 🔴 J-1 — the plan's own deferred lines join the list ONLY once the latch above has let this call
        // through, and that placement is deliberate rather than incidental. Before J-1 a latched Start
        // produced no mapping warnings at all, because the resolver never ran; after J-1 the resolver has
        // ALREADY run off-lock by the time we get here, so emitting its lines on the refusal path would put
        // new operator-visible output on the halt path. The plan is discarded instead, and the next start
        // rebuilds it — the same messages, once, never twice. See the same argument at the reuse sites
        // below: a discarded plan holds nothing disposable (IMachineSimulator has no Dispose, and no
        // IDeviceDriver is constructed until after this point), which is exactly why driver construction
        // was left on THIS side of the lock rather than hoisted with the rest.
        //
        // 🔴 T-1 — THIS PLACEMENT IS NOW LOAD-BEARING RATHER THAN MERELY DELIBERATE, because the list it
        // appends to is the CALLER's and the caller flushes it unconditionally. Before T-1 a hoist above the
        // latch would have been invisible on the refusal path (the whole list died there anyway); now it is
        // the difference between a refused install saying nothing and a refused install speaking on the halt
        // path, which is the one thing residual (3)'s ruling did NOT authorise. Moving this line up is what
        // turns AnInstallRefusedByTheHaltLatch_StillSaysNothing red.
        deferredLogs.AddRange(plan.DeferredLogs);

        // Assumes the caller already holds _gate (Start()/ApplyScenario()/RegisterMachine() all do) —
        // reads _fleet directly rather than through the Fleet property so a Register-while-running
        // restart always rebuilds sims from the CURRENT roster, including whatever was just added.
        var multiplier = _scenario.CycleRateMultiplier > 0 ? _scenario.CycleRateMultiplier : 1.0;
        var effectiveFleet = Math.Abs(multiplier - 1.0) < 1e-9
            ? _fleet
            : _fleet.Select(d => d with { CycleSeconds = Math.Max(MinCycleSeconds, d.CycleSeconds / multiplier) }).ToList();

        // Task 3: threading _configStore/CurrentProductFor through here (rather than baking resolved
        // values into the sims at construction) is what makes a live settings edit apply to an
        // ALREADY-RUNNING fleet — each config-aware sim re-resolves fresh on every single cycle (see
        // SimulatorBase.ResolveEffectiveConfig's remarks), so nothing here needs to change on Restart
        // for a mid-run edit to show up; a restart is only needed for a scenario cycle-rate multiplier
        // change (see the surrounding ApplyScenario/RegisterMachine callers of this method).
        //
        // I-5 (mc-feature-review.md) — ALSO pass `multiplier` itself (not just the pre-scaled descriptor
        // above) so a config-aware sim's own CycleSecondsOverride (Screwdrive/Iot — always non-null once
        // _configStore is wired, which production always is) composes with the active scenario instead of
        // overriding it outright. Safe to bake in at construction (not a live Func<double>, unlike
        // _configStore itself): a multiplier change ALWAYS restarts this whole pipeline (multiplierChanged
        // check in ApplyScenario/Burst), so it can never go stale for the lifetime of these sim instances.
        // G2-6/P2-3 — a DriverKinds.Modbus machine is driven by the real Modbus pipeline slot (below), NOT
        // simulated. Excluding it here is what prevents it being double-driven (a simulator AND the Modbus
        // slot) once it's a roster member. Non-Modbus rosters are unaffected (the Where is a no-op), so sim
        // seeds/indices are byte-identical to before.
        // GĐ3 sub-3 OU-2 — same reasoning, now ALSO excluding DriverKinds.OpcUa: once Program.cs seeds a
        // roster descriptor for a configured OPC-UA machine (below), it must be driven ONLY by the real
        // OPC-UA pipeline slot, never simulated too. A roster with no Modbus/OPC-UA machines is unaffected
        // (the Where stays a no-op), so sim seeds/indices are byte-identical to before this task.
        //
        // GP-5 (task-5-brief.md item 1) — the GP-4 review's own note here ("generalizing [this] would
        // require a roster/MachineDescriptor story for third-party connectors that does not exist yet")
        // is exactly what GP-5's connectors.json supplies, so the exclusion is now a UNION, never a
        // substitution: BOTH built-in literals stay (Modbus/OPC-UA are excluded unconditionally, whether or
        // not a connector for them is currently registered — FleetHostModbusRosterTests.
        // ModbusRosterMember_NoModbusConnector_ExcludedFromSimulation_StaysIdle_SimFleetUnaffected pins this;
        // replacing the two literals with "any registered connector id" would silently re-simulate an
        // unregistered Modbus/OPC-UA roster member, which is the exact regression that test guards against)
        // PLUS a third, registry-driven clause for every other (third-party) DriverKind: once an operator
        // registers a real IConnectorFactory for some id, e.g. "vendor.acme.widget" (GP-5's whole point —
        // connectors.json makes this reachable, where before only Program.cs code could), a roster entry for
        // that same id must ALSO stop being simulated — otherwise the simulator's CycleCounter and the real
        // connector's CycleCounter both write the SAME MachineState (Cycles derives from CycleCounter),
        // corrupting per-machine cycles and therefore fleet KPI/OEE/FPY. Silently. See
        // FleetHostThirdPartyRosterTests for both directions of this third clause.
        //
        // DriverKinds.Normalize(d.DriverKind) here (not a raw d.DriverKind lookup) is required because
        // ConnectorRegistry.RegisteredIds is always normalized (Register/TryCreateDriver both fold through
        // DriverKinds.Normalize), while a MachineDescriptor's own DriverKind is normalized at FleetConfig.Load
        // (fleet.json entries) but NOT at RegisterMachine (see that method's own fix, this same task) prior
        // to this fix — normalizing on both sides here is defense in depth even after that RegisterMachine
        // fix, since _fleet can also be seeded in-process (BuildDefaultFleet, test doubles) without ever
        // passing through either normalization point.
        //
        // Null-guarded: _connectorRegistry is an optional ctor parameter (every pre-existing test/call site
        // that constructs FleetCore without one, e.g. FleetHostHealthAndRegistrationTests, must keep
        // compiling/behaving byte-for-byte unchanged) — a null registry simply contributes nothing to the
        // union, same as an empty one would.
        //
        // TDD note (caught by running FleetHostConnectorRegistryTests against the first draft of this
        // fix): `d.DriverKind == DriverKinds.Simulated` is carved out of the third clause ON PURPOSE, not an
        // oversight. Every roster machine built by BuildDefaultFleet/the shipped fleet.json carries
        // DriverKind=DriverKinds.Simulated — that is what "simulate this machine" MEANS, a completely
        // different concept from "a real connector drives this machine" (Modbus/OPC-UA/third-party).
        // ConnectorRegisteredWithKindSimulated_GetsDistinctSlotLabel_FromTheBuiltInSimSlot legitimately
        // registers a connector under Kind=DriverKinds.Simulated (item 4's own decision: the built-in sim
        // group is NOT itself registry-driven, so a THIRD PARTY choosing that same id registers a genuinely
        // separate, additional slot, never a substitute for it). Without this carve-out, that one
        // registration would make `registeredConnectorIds.Contains("Simulated")` true, and the third clause
        // would then exclude EVERY roster machine (all of them DriverKind=Simulated) from simFleet —
        // emptying it entirely and crashing SimulatedDriver's ctor ("at least one simulator is required").
        // The first draft of this fix did exactly that; this carve-out is what closes it.
        //
        // Review fix round 1 (task-2-report.md, Important) — this inline filter (everything documented in
        // the comment block above) is now expressed as a call to ResolveSlotLabelFor rather than restated as
        // a second, independently-maintained boolean expression: FleetHostMachineDriverResolutionTests'
        // ResolveWritableDriver originally re-derived its OWN, simpler (and wrong) approximation of this
        // exact rule, which misreported a live third-party-kind machine (simulated by fallback — see
        // ResolveSlotLabelFor's own doc comment) as NoLiveDriver. Extracting this rule into one method is
        // what makes that class of drift impossible going forward — every comment above still describes
        // this SAME rule correctly, just now implemented once, not twice.
        //
        // Task D-1 — now ResolveSlotLabelForMachine (per MACHINE), not ResolveSlotLabelFor (per KIND). Same
        // rule for every machine no connector instance claims; for a CLAIMED machine it resolves to that
        // instance's own slot, which is what keeps a multidrop roster (N machines, N instances, one bus) out
        // of the simulated group without any of the double-driving this filter exists to prevent. The two
        // call sites of this rule — here and ResolveWritableDriver — go through the SAME method for the
        // reason recorded on ResolveSlotLabelForMachine itself.
        // D-1 review, m3 — one snapshot for the whole filter, not one per roster member: the sim-exclusion
        // decision must be internally consistent across the fleet (a registration landing mid-filter could
        // otherwise exclude one machine and simulate its sibling), and it is the same discipline
        // ResolveWritableDriver now follows.
        // 🔴 J-1 — this snapshot is taken HERE, under the lock, and NOT carried in from the plan. That is
        // what keeps the registry window exactly as wide as it was before J-1: the filter below and the
        // connector loop further down read the registry microseconds apart under one acquisition, as they
        // always have. Threading the plan's (older) snapshot down here instead would have widened the gap
        // between "which machines are excluded from simulation" and "which connector slots get built" from
        // microseconds to the whole build — and a machine that is BOTH simulated and connector-driven writes
        // the same MachineState from two places, corrupting per-machine cycles and therefore fleet KPI/OEE/
        // FPY with nothing red. See the big union-filter comment above for why that double-drive is the
        // hazard this filter exists to prevent.
        var startBindings = _connectorRegistry?.SnapshotBindings();
        var simFleet = effectiveFleet
            .Where(d => ResolveSlotLabelForMachine(d, startBindings) == SimulatedSlotLabel).ToList();

        // 🔴 J-1 — REUSE-OR-BUILD, and the reuse is what moved P5 (SimulatorFactory.Create ->
        // SimulatorBase's ctor -> MachineConfigStore.Ensure -> File.WriteAllText + File.Move, plus that
        // store's own lock) off this one.
        //
        // `simFleet` above is derived from the LIVE _fleet, so this loop is over the roster as it is NOW,
        // never as the plan saw it. A plan entry is consumed only when the descriptor it was built from is
        // identical to the live one at the same index AND the multiplier has not moved (see StartPlan for
        // why the multiplier is not implied by the descriptor). Anything else is built right here, under the
        // lock, at exactly the pre-J-1 cost — for THAT machine only.
        //
        // That is the whole of J-1's answer to the roster-changed-underneath window, and it is an EXCLUSION
        // rather than a detection: there is no state in which this method installs a pipeline that disagrees
        // with the roster, so there is nothing to detect and nothing to report. What a lost race costs is
        // one machine's worth of construction back under the lock, which is strictly less than the whole
        // fleet's worth this method paid on every single start before J-1.
        //
        // Index equality is load-bearing, not incidental: the seed is `1000 + i`, so a simulator is a
        // function of (descriptor, position). Comparing sets instead of positions would hand back a
        // simulator seeded for a different slot and change the generated stream — silently, and only for a
        // roster whose order moved.
        var reusable = Math.Abs(multiplier - plan.Multiplier) < 1e-9;
        var sims = new List<IMachineSimulator>(simFleet.Count);
        for (var i = 0; i < simFleet.Count; i++)
        {
            if (reusable && i < plan.SimFleet.Count && plan.SimFleet[i] == simFleet[i])
            {
                sims.Add(plan.Sims[i]);
                continue;
            }

            sims.Add(SimulatorFactory.Create(
                simFleet[i], seed: 1000 + i, _configStore, CurrentProductFor, multiplier, _productConfigStore));
        }

        // SM-1 (task-1-brief.md) — a roster with no simulated machines (an empty product roster, or one
        // containing ONLY real Modbus/OPC-UA/registered-connector entries — every one of which `simFleet`
        // above already excludes) must never reach SimulatedDriver's own constructor guard ("At least one
        // simulator is required"). That guard is correct and stays exactly as strict as it is — it caught a
        // real bug once — so the fix belongs at THIS call site, not a weakened constructor: no simulators
        // simply means no "simulated" pipeline group is built this Start, never a crash.
        IDeviceDriver? driver = null;
        if (sims.Count > 0)
        {
            driver = new ScenarioAwareDriver(new SimulatedDriver(sims), () => _scenario);

            var decorator = DriverDecoratorForTests;
            if (decorator is not null)
            {
                driver = decorator(driver);
            }
        }

        // G2-1 — per-machine mapping/*.json profiles (docs/plans/2026-07-27-giaidoan2-synapse-connect-
        // blueprint.md task 1): built fresh off `effectiveFleet` on every StartLocked call (including a
        // RegisterMachine/ApplyScenario-triggered restart), so a newly-registered machine's own
        // MappingProfile name is always resolved against the CURRENT roster, never a stale one. The
        // shared `profile` below is now only the fallback for a machine code this resolver doesn't
        // recognize (should not happen in practice — every reading's driver was built from this SAME
        // effectiveFleet, see `sims` above) — never a per-machine override target itself anymore.
        //
        // 🔴 G-1 — the resolver's two callbacks are BUFFERED, not wired straight to _logWarning/_logError.
        // MappingProfileResolver.Build resolves every descriptor eagerly on the CALLING thread (see its own
        // doc comment: Resolve is a pure dictionary lookup afterwards), so both delegates only ever run
        // where Build does — which, before J-1, was here, under _gate, i.e. a per-machine Event Log write on
        // the halt path. Buffering keeps the messages, the order and the channel choice identical and moves
        // only the I/O.
        //
        // 🔴 J-1 — that Build has moved to BuildStartPlan, off the lock: this is the enumeration's P4, and
        // `plan.MappingResolver` is its result. What is left here is the same reuse-or-build rule the
        // simulators above follow. A descriptor whose (Code, MappingProfile, DeviceClass) the plan already
        // resolved is served from the plan; anything else — a machine registered since the snapshot, or one
        // whose profile name the plan never saw — is resolved NOW, under the lock, from a Build over just
        // those descriptors. The supplement is consulted FIRST so that where both have an answer the fresher
        // one wins.
        //
        // Deferred-line ORDER is preserved and that is checkable rather than asserted: the plan's lines were
        // produced in snapshot-roster order and are already in `deferredLogs` (see the AddRange above the
        // latch); the supplement's are appended for descriptors the snapshot did not contain, which _fleet's
        // append-only mutation puts AFTER them. Connector-loop lines still come last. Same messages, same
        // sequence, same channel as before J-1.
        var unresolvedForMapping = effectiveFleet
            .Where(d => !plan.MappingKeys.Contains((d.Code, d.MappingProfile, d.DeviceClass))).ToList();
        Func<string, MappingProfile?> mappingResolve = plan.MappingResolver.Resolve;
        if (unresolvedForMapping.Count > 0)
        {
            var supplement = MappingProfileResolver.Build(
                unresolvedForMapping,
                MappingDirectory,
                logWarning: msg => deferredLogs.Add(new DeferredLogEntry(null, msg)),
                logError: (ex, msg) => deferredLogs.Add(new DeferredLogEntry(ex, msg)));
            mappingResolve = code => supplement.Resolve(code) ?? plan.MappingResolver.Resolve(code);
        }

        var profile = new MappingProfile { Name = "fleet-mixed", DeviceClass = "Mixed" };

        // G2-5 — the pipeline groups to run this cycle. Today: exactly the one simulated group
        // (byte-identical to the old single pipeline). The test seam appends extra groups; a future
        // task (Modbus, G2-6) will add real per-driver groups here. A group = (label, driver, fallback
        // profile, per-reading resolver).
        // GP-5 (task-5-brief.md item 4) — deliberately NOT built through ConnectorRegistry, unlike every
        // registry-driven connector below. Two concrete, evidence-based reasons, not a convenience shortcut:
        //
        // (1) COLLISION: the registry stores at most ONE factory per normalized id (Register's own doc
        // comment: "re-registering the same id replaces the previous entry"). FleetHostConnectorRegistryTests.
        // ConnectorRegisteredWithKindSimulated_GetsDistinctSlotLabel_FromTheBuiltInSimSlot already pins that a
        // THIRD-PARTY connector registered with Kind=DriverKinds.Simulated must coexist as a slot SEPARATE
        // from this always-present sim group (2 distinct "Simulated"-kind slots, 2 distinct labels). Moving
        // this group's own driver into the SAME registry, under the SAME normalized "Simulated" key, would
        // make that coexistence impossible by construction — whichever of the two Register calls ran last
        // would silently replace the other in the dictionary. That is exactly the id-collision hazard GP-4's
        // review fix round 1 already fought to eliminate; reintroducing it here would be a regression, not a
        // simplification.
        //
        // (2) SHAPE MISMATCH: IConnectorFactory.TryCreate(string config) is one opaque, forwarded-verbatim
        // config string producing ONE driver — a shape built for a THIRD PARTY's own configuration, which
        // this codebase never inspects. This group's driver is the opposite: ONE SimulatedDriver built from
        // MANY simulators (`sims` above), one per roster machine currently in `_fleet` (minus the exclusions
        // just above), re-derived from mutable FleetCore-owned state on every single restart — `_fleet`
        // itself (mutated by RegisterMachine), `_configStore`/CurrentProductFor/`_productConfigStore` (live
        // config, re-resolved per cycle), and `multiplier` (the active scenario). There is no "opaque config
        // string" that stands in for "the entire current roster plus three FleetCore service references" —
        // forcing this through IConnectorFactory would mean either inventing a FleetCore-specific side
        // channel a factory reaches through (defeating "config is opaque, host doesn't understand it", the
        // exact property GP-4 built this contract around) or serializing the whole roster to a string every
        // restart for a factory that could only ever have ONE real implementation (FleetCore's own) — pure
        // ceremony, no third party ever plugs in here.
        //
        // Net: the built-in sim group stays exactly as special-cased as it already was before this task —
        // hardcoded label "simulated" (pinned by this same collision test above and by
        // ConnectorRegisteredWithKindSimulated_GetsDistinctSlotLabel_FromTheBuiltInSimSlot), built directly
        // here, never asked of `_connectorRegistry`. This is the ONE remaining special case in StartLocked;
        // everything else (Modbus, OPC-UA, any third-party id) goes through the registry uniformly.
        var groups = new List<(string Label, IDeviceDriver Driver, MappingProfile Profile, Func<string, MappingProfile?>? Resolver)>();
        if (driver is not null)
        {
            // Review fix round 1 (task-2-report.md, Minor) — SimulatedSlotLabel, not a second "simulated"
            // literal: see that constant's own doc comment for why a repeated literal was itself a hazard.
            groups.Add((SimulatedSlotLabel, driver, profile, mappingResolve));
        }

        var extra = AdditionalPipelinesForTests?.Invoke();
        if (extra is not null)
        {
            foreach (var g in extra) groups.Add((g.Label, g.Driver, g.Profile, null));
        }

        // GP-4 — every registered connector gets its own slot, built fresh (never reused across restarts,
        // same "a driver owns a live resource cancelling a CTS alone does not release" reasoning
        // ConnectorRegistry/IConnectorFactory's own doc comments carry) whenever one is actually wired up
        // (Program.cs only registers Modbus/OPC-UA when their respective ST4I_*_ENABLED env var is set AND
        // their config file loaded — otherwise the registry is empty/null and the fleet is byte-identical
        // to before this task). This replaces what used to be two hardcoded, copy-pasted blocks here (one
        // per driver kind) — onboarding a new connector no longer touches this method at all.
        //
        // A connector that fails to produce a driver — a bad/malformed configuration (TryCreateDriver
        // returns false), or a third-party factory that throws despite IConnectorFactory.TryCreate's
        // contract not to — is logged and skipped, exactly like today's "malformed map file disables that
        // driver for this run without crashing the host" behavior for Modbus/OPC-UA specifically. This is
        // deliberately NOT surfaced through LastError — touching it here would flip GET /v1/health unhealthy
        // merely because an optional peripheral's config is bad, which is not today's behavior and is not
        // this task's to change — only a log warning, so the failure is visible without being mistaken for
        // the whole fleet's health.
        //
        // 🔴 U-1 — THE REASON GIVEN HERE USED TO BE A UNIVERSAL ABOUT THE FIELD ("that property is RESERVED
        // for a slot that started and later faulted at RUNTIME"), and U-1 falsified it: a restart whose
        // rebuild throws now writes LastError too (RebuildPipelineOffLock's catch). The EXCLUSION this
        // paragraph states is unchanged and is what it was always for — a connector that could not be built
        // is not a fault of the fleet — so the reason is restated as the exclusion it is rather than as a
        // claim about the field's only producer. See LastError's own declaration for both producers.
        //
        // Review fix round 2 — `orphanedConnectorDrivers` COLLECTS (never disposes inline) any driver a
        // rejected/faulted connector still handed back; disposal happens in the caller, off `_gate`, via
        // `DisposeOrphanedConnectorDrivers` (see that method's own doc comment for why round 1's inline,
        // in-lock dispose was itself the hazard this round closes).
        //
        // Task D-1 — `RegisteredIds` now enumerates connector INSTANCES, not protocol kinds, so this loop
        // builds one pipeline slot per instance: two Modbus connectors produce two slots, two drivers and two
        // labels, where before they could not coexist in the registry at all. Not one line of this loop had
        // to change for that — it was already written against "whatever ids are registered", which is why the
        // identity change lands here as a no-op.
        //
        // 🔴 J-2 — `orphanedConnectorDrivers` is now a PARAMETER (the caller allocated it before this method
        // was entered), so an orphan is owned by the caller's `finally` from the instant it is collected
        // rather than from the instant this method returns. See this method's own doc comment.
        if (_connectorRegistry is not null)
        {
            foreach (var connectorId in _connectorRegistry.RegisteredIds)
            {
                IDeviceDriver? connectorDriver = null;
                string? connectorError = null;
                var built = false;
                try
                {
                    built = _connectorRegistry.TryCreateDriver(connectorId, out connectorDriver, out connectorError);
                }
                catch (Exception ex)
                {
                    // Defense in depth: IConnectorFactory.TryCreate's contract says "never throw for bad
                    // config," but a third-party factory is not this codebase's own code to trust blindly.
                    // ConnectorRegistry.TryCreateDriver ALSO guards against this now (review fix round 1) —
                    // this catch is deliberately doubled, not redundant to trim, because this is the ONE
                    // place third-party code runs while _gate is held (see IConnectorFactory.TryCreate's
                    // own "MUST return promptly" remarks) and Estop() takes the same lock. Catching here —
                    // BEFORE any slot exists for this connector — is what keeps a rogue factory from taking
                    // down the simulated fleet and every sibling connector along with it, not just disabling
                    // itself; a fault AFTER a slot exists is already isolated by StartSlot's own per-slot
                    // catch below. `built` stays false; `connectorDriver` may or may not have been assigned
                    // before the throw (an `out` parameter write is visible to the caller even if the
                    // callee then throws) — handled uniformly below, same as a contract-violating `false`
                    // return that still hands back a non-null driver.
                    connectorError = ex.Message;
                }

                if (built && connectorDriver is not null)
                {
                    // GP-5 (task-5-brief.md item 3) — a connector that just successfully started is, by
                    // definition, no longer "configured but not started"; clear any issue a PREVIOUS
                    // StartLocked call recorded for this same id (e.g. an operator fixed a typo'd
                    // connectors.json entry and restarted the fleet) so GetConfiguredConnectorIssues never
                    // reports a stale failure once the connector is actually running.
                    _connectorStartIssues.TryRemove(connectorId, out _);

                    // No per-machine MappingProfile override exists for a registry-driven connector (same
                    // as pre-GP-4 Modbus/OPC-UA), so this uses a plain Automation-class fallback profile,
                    // same shape as `profile` above.
                    var connectorLabel = ResolveConnectorSlotLabel(connectorId);
                    var connectorProfile = new MappingProfile { Name = connectorLabel, DeviceClass = "Automation" };
                    groups.Add((connectorLabel, connectorDriver, connectorProfile, null));
                    continue;
                }

                var resolvedConnectorError = connectorError ?? "factory returned no driver and no error (contract violation)";
                // 🔴 G-1 — deferred, not emitted here: this line ran with _gate held, once per failing
                // connector, and a host's ILogger under AddWindowsService makes it a synchronous Event Log
                // write on the same lock Estop() takes. Same message, same channel, emitted by
                // CompleteStartOffLock a moment later.
                deferredLogs.Add(new DeferredLogEntry(
                    null,
                    $"Connector '{connectorId}' could not be started: {resolvedConnectorError}"));

                // GP-4 review carry-over, closed by GP-5 (task-5-brief.md item 3) — before this, a
                // configured-but-failed-to-start connector produced this one LogWarning and NOTHING else:
                // no GetDriverHealth() entry (no slot was ever created), no alarm, no health signal — an
                // operator had no way to discover a connectors.json typo except by reading the log file.
                // Deliberately NOT surfaced through LastError/`/v1/health` (see the big comment above this
                // loop) — this is purely an informational projection an operator can poll
                // (GetConfiguredConnectorIssues, GET /v1/connectors), never a fault signal.
                _connectorStartIssues[connectorId] = resolvedConnectorError;

                if (connectorDriver is not null)
                {
                    // Review fix round 1 — a contract-violating factory can return false (or throw AFTER
                    // already assigning its `out` driver parameter) while still handing back a real,
                    // non-null driver instance; ModbusTcpDriver is exactly the class of driver that owns a
                    // live socket a silently-discarded reference would leak.
                    //
                    // Review fix round 2 — round 1 disposed this HERE, synchronously, inside StartLocked —
                    // which every caller invokes with `_gate` held. A slow/hung third-party DisposeAsync
                    // would then delay Estop() (which takes the same lock) for up to RestartTeardownTimeout
                    // — precisely the "blocks the halt call" hazard class IConnectorFactory.TryCreate's own doc
                    // comment warns against for TryCreate itself, reopened by round 1's own leak fix. Fixed
                    // by only COLLECTING the orphan here — the actual bounded dispose now happens in
                    // DisposeOrphanedConnectorDrivers, called by every StartLocked caller AFTER _gate is
                    // released, the same "off-lock" discipline WaitAndDisposeOldPipeline already follows.
                    orphanedConnectorDrivers.Add(connectorDriver);
                }
            }
        }

        foreach (var g in groups)
        {
            StartSlot(g.Label, g.Driver, g.Profile, g.Resolver);
        }

        // SM-1 — set unconditionally here (never gated on `groups.Count > 0`): this method already
        // early-returned above if IsRunning/_estopEngaged, so reaching this point always means a genuine
        // not-running -> running transition, whether or not any pipeline slot actually got built (an empty
        // product roster builds zero slots by design — see _running's own doc comment).
        _running = true;
    }

    /// <summary>Review fix round 2 — the off-lock counterpart to <see cref="StartLocked"/>'s orphan
    /// collection: every <see cref="StartLocked"/> caller invokes this AFTER releasing <see cref="_gate"/>,
    /// mirroring <see cref="WaitAndDisposeOldPipeline"/>'s own "wait/dispose must happen OUTSIDE _gate"
    /// discipline exactly (same reasoning: <see cref="Estop"/> takes <see cref="_gate"/> too, and a
    /// slow/hung third-party <see cref="IDeviceDriver.DisposeAsync"/> must never delay a caller's
    /// <see cref="Estop"/> call from returning). Best-effort and per-driver BOUNDED
    /// (<see cref="RestartTeardownTimeout"/>, same budget
    /// <see cref="WaitAndDisposeOldPipeline"/> uses) — a driver whose <c>DisposeAsync</c> throws or hangs
    /// past that bound cannot wedge this method or any other orphan's own disposal.
    ///
    /// <para>🔴 G-2 — the parameter is nullable now, for the same reason <see cref="FlushDeferredLogs"/>'s
    /// already was: <see cref="CompleteStartOffLock"/> runs from a <c>finally</c>, so it can be handed
    /// <c>default(StartOutcome)</c> when <see cref="StartLocked"/> threw. 🔴 <b>J-2 — that is no longer how
    /// the two production callers reach it</b>: both allocate the orphan list before the call, so this
    /// method now gets a real list on the throw path and actually disposes what it is given, which is the
    /// leak S3's residual named. The nullable parameter stays — it costs one line and it is the difference
    /// between a future caller's omission being a no-op and being a <c>NullReferenceException</c> inside a
    /// <c>finally</c>.</para></summary>
    private void DisposeOrphanedConnectorDrivers(IReadOnlyList<IDeviceDriver>? orphans)
    {
        if (orphans is null) return;

        // 🔴 G-2 fix round 1 — buffered for the same reason DisposeOldSlots buffers, and found by grepping
        // for siblings of review I-3 rather than by being told: this method has the IDENTICAL shape — a host
        // seam (_logDebug) inside a per-orphan catch, i.e. INTERLEAVED with the disposals. A throwing host
        // logger on orphan N left orphans N+1..M open, each holding whatever socket its factory built. The
        // review named the halt-path copy; this is the start-path one.
        var disposeFaults = new List<(Exception Error, string Message)>();

        foreach (var orphan in orphans)
        {
            try
            {
                orphan.DisposeAsync().AsTask().Wait(RestartTeardownTimeout);
            }
            catch (Exception ex)
            {
                // Best-effort, same "never let teardown hang/throw on a misbehaving driver" posture as
                // WaitAndDisposeOldPipeline's own dispose calls.
                // 🔴 G-1 — _logDebug, not _logError. This was LogDebug before E-2 (i.e. SILENT, since
                // St4i.EngineApi ships no appsettings.json); E-2's two-channel convention promoted it to an
                // Event Log entry under AddWindowsService. See _logDebug.
                disposeFaults.Add((ex, "FleetCore orphaned connector driver dispose observed a fault"));
            }
        }

        // Every orphan is released by the time any host code runs.
        foreach (var fault in disposeFaults)
        {
            _logDebug?.Invoke(fault.Error, fault.Message);
        }
    }

    /// <summary>Builds one pipeline slot, wires its Committed handler, adds it to <see cref="_slots"/>, and
    /// starts its background run-task with a PER-SLOT fault catch. Assumes the caller holds <see cref="_gate"/>.</summary>
    private void StartSlot(string label, IDeviceDriver driver, MappingProfile profile, Func<string, MappingProfile?>? resolver)
    {
        var pipeline = new EdgePipeline(driver, profile, _transport, _eventBus, resolver, _unsPublisher);
        pipeline.Committed += OnPipelineCommitted;
        var cts = new CancellationTokenSource();
        var slot = new PipelineSlot { Label = label, Pipeline = pipeline, Cts = cts, Driver = driver };
        _slots.Add(slot);

        slot.RunTask = Task.Run(async () =>
        {
            try
            {
                await pipeline.RunAsync(cts.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                // Expected on Stop()/restart.
            }
            catch (Exception ex)
            {
                // 🔴 G-2 FIX ROUND 2 (re-review NEW-1) — THE THIRD INSTANCE OF THE I-3 SHAPE IN THIS FILE,
                // and the one my own sibling grep could not reach. The host `_logError` call below used to be
                // the FIRST statement of this handler, ahead of everything else in it. A host wires that
                // delegate to its own ILogger; a throw there abandoned the entire catch:
                //   - the faulted slot stayed in `_slots`, so `IsRunning` kept reporting a dead slot as live;
                //   - `LastError` was never set, so `GET /v1/health` reported HEALTHY on a faulted fleet —
                //     permanently, since nothing else sets it;
                //   - `_running` was never flipped when the last slot died;
                //   - the driver and its CTS were never released;
                //   - and the exception escaped into `Task.Run`, where nothing observes it. Silent.
                // Moved to the END of the handler. Same message, same channel, same unconditional emission
                // (it still fires for a superseded slot, where `removed` is false) — only its position
                // relative to the commit and the disposals changes, and nothing in the tree asserts that
                // position. Emitting AFTER `LastError = ex` is also strictly better for an operator: a reader
                // who sees this line and then polls /v1/health can no longer beat the field write to it.
                //
                // WHY THE GREP MISSED IT, recorded because the lesson is the transferable part: I swept for
                // `_logDebug` inside per-item catches in disposal LOOPS. This is `_logError`, in a per-slot
                // FAULT handler, with no loop. Same shape, no shared vocabulary — a grep keys on the words an
                // author happened to choose, and a shape has no words. The blueprint's own D-7b correction
                // says to start from the SET OF SITES (here: every `?.Invoke` on a host log seam) and ask the
                // question at each, which is what the reviewer did and I did not.
                //
                // NOT A MEMBER OF THE S-SET, stated so this does not get miscounted: the seam runs BEFORE the
                // under-_gate commit below, so nothing is committed-then-stranded. It is the same HAZARD
                // class (a host seam in front of work that must not be skipped) reached from a different
                // direction, and closing it reopens no "CLOSED" claim.
                //
                // 🔴 J-2 (branch review, Minor 4) — AND THIS IS WHERE A REPORTING ROUTE DISAPPEARED, which
                // this block enumerated everything else about and said nothing about. §8.1(h4): silence is
                // not a treatment. `LastError = ex` below sits inside `if (removed)`, and GET /v1/health is
                // literally `LastError is null`. In the stuck state (S3's residual (2)) a stranded slot that
                // faulted LATER found `removed == true`, set LastError and flipped health unhealthy — the
                // only eventual self-report that state ever had. J-2 lets a Stop/Estop clear `_slots` first,
                // so the same fault now finds `removed == false` and health does not flip. BENIGN: the state
                // being reported no longer exists, and flipping a fleet unhealthy because a slot an operator
                // already halted later unwound is worse than silence. Recorded at both ends — the cause is
                // at StopLocked's guard, the effect is HERE, and a reader arriving from either side would
                // otherwise see only half of it.

                // G2-6 review fix — the disposes below happen OUTSIDE _gate (never dispose while holding
                // the lock): `removed` is decided under _gate (same slot-membership identity guard as
                // before — a superseded slot was already removed+disposed by StopLocked/
                // WaitAndDisposeOldPipeline, so a stale/slow-to-unwind fault can't double-own teardown), but
                // the actual driver DisposeAsync/CTS.Dispose only run when THIS catch is the one that
                // genuinely removed the slot. Idempotent either way (DisposeAsync/CTS.Dispose tolerate a
                // hypothetical double-call), but the guard keeps ownership unambiguous in the common case.
                bool removed;
                lock (_gate)
                {
                    // Slot-membership IS the identity guard (replaces the old _cts/_currentPipeline ReferenceEquals):
                    // a superseded slot was already removed by StopLocked, so a stale/slow-to-unwind fault can't
                    // clobber a freshly-restarted fleet. Removing THIS slot isolates the fault — sibling slots stay
                    // in _slots (fleet keeps running); when the LAST slot goes, IsRunning follows to false.
                    removed = _slots.Remove(slot);
                    if (removed)
                    {
                        LastError = ex;
                        pipeline.Committed -= OnPipelineCommitted;

                        // SM-1 — IsRunning is no longer computed straight off _slots.Count (see _running's
                        // own doc comment); this is the one place that old invariant must be reproduced by
                        // hand. Only fires when THIS removal is what brought _slots back down to zero — an
                        // empty roster (no slot ever built) never reaches this catch at all, so it never
                        // touches _running; only a roster that HAD live slots, all of which have now
                        // faulted out, flips running->false here, exactly like the old computed property did.
                        if (_slots.Count == 0)
                        {
                            _running = false;
                        }
                    }
                }

                if (removed)
                {
                    try
                    {
                        await driver.DisposeAsync().ConfigureAwait(false);
                    }
                    catch
                    {
                        // best-effort — a driver whose fault already tore down its own connection must not
                        // block this slot's teardown any further.
                    }

                    cts.Dispose();
                }

                // 🔴 G-2 fix round 2 — LAST, not first. See this handler's own remarks above.
                _logError?.Invoke(ex, $"FleetCore pipeline slot '{label}' faulted");
            }
        });
    }

    /// <summary>Cancels + detaches every current pipeline slot and returns them as a <see cref="PipelineHandle"/>
    /// instead of discarding them — callers that immediately restart (<see cref="RegisterMachine"/>/
    /// <see cref="ApplyScenario"/>) release <see cref="_gate"/>, wait for the old tasks via
    /// <see cref="WaitAndDisposeOldPipeline"/>, THEN re-acquire the gate to call <see cref="StartLocked"/>
    /// — never while still holding it (a slot's own catch above re-acquires <see cref="_gate"/>, so waiting for
    /// an old task from inside this same lock would deadlock whenever that catch actually needs to
    /// run). Assumes the caller already holds <see cref="_gate"/>.
    ///
    /// <para><b>Batch review (WS-G-plugin whole-batch, fix 1) — <see cref="CancellationTokenSource.Cancel"/>
    /// itself is wrapped per-slot in its own try/catch.</b> <c>Cancel()</c> runs every callback registered via
    /// <see cref="CancellationToken.Register(Action)"/> SYNCHRONOUSLY on THIS thread and rethrows any exception
    /// one of them throws. <c>ModbusTcpDriver.PollOnceAsync</c>'s <c>ct.Register(DisposeConnection)</c> (the
    /// repo's first-ever registration on a slot token) is benign today (<c>DisposeConnection</c> wraps each
    /// disposal in its own try/catch), but <see cref="Estop"/>/<see cref="Stop"/> call this method with
    /// <see cref="_gate"/> HELD — an uncaught throw here, from a THIRD-PARTY driver mirroring that same
    /// <c>ct.Register</c> pattern with a misbehaving callback, would abort this entire loop before
    /// <c>_slots.Clear()</c> below ever runs and before <see cref="Estop"/> latches <see cref="_estopEngaged"/>
    /// — a pipeline slot would keep running while the caller believes the halt succeeded (or the caller sees an
    /// exception instead of a clean stop). Caught PER-SLOT, not around the whole loop, so one misbehaving
    /// driver's callback can never also skip cancelling every OTHER slot — see
    /// <see cref="IDeviceDriver.ReadAsync"/>'s own doc comment for the contract this documents on the driver
    /// side.</para></summary>
    private PipelineHandle StopLocked()
    {
        // SM-1 — guard on _running (the operator-started flag), not _slots.Count: an empty-roster fleet
        // that was Start()ed has _running == true with zero slots, and this call must still flip it back
        // to false (a real Stop()) rather than early-returning as a no-op. Only a genuinely
        // already-not-running fleet (never started, or already stopped/faulted-out) skips everything below.
        //
        // 🔴 J-2 — AND THE GUARD IS NOW A CONJUNCTION, WHICH CLOSES THE ONE STATE IT USED TO REFUSE TO CLEAN.
        // It tested `!_running` ALONE [QUOTED-NOT-LIVE — the verbatim old line is deliberately not
        // reproduced in this file OR in the J-2 witness test that describes it; greps do not stop at a file
        // boundary, which is what the first version of this marker overlooked (branch review, Minor 3). See
        // the same marker in the S-set banner. The live guard is the conjunction below]. Testing it alone is
        // correct for every state EXCEPT
        // `_running == false` with `_slots` NON-EMPTY — and in that state the slots are LIVE: each one's
        // run-task is already driving its pipeline, publishing readings and moving KPI counters, while
        // IsRunning reports the fleet stopped. Stop() and Estop() both returned here without cancelling a
        // single one of them, so THE HALT PATH COULD NOT HALT THEM and no operator action could:
        // RegisterMachine/ApplyScenario reach this method only `if (IsRunning)`, and a Start() from that
        // state installs MORE slots rather than clearing these. The one release that did exist is not an
        // operator's to trigger: StartSlot's own fault catch removes and disposes a slot whose driver
        // happens to fault later, one at a time. A slot whose driver behaves is stranded for the life of the
        // process.
        //
        // WHERE THAT STATE COMES FROM, enumerated rather than asserted. `_running` and `_slots` are written
        // in exactly three places, all under this lock: StartLocked (`_slots.Add` per slot in StartSlot,
        // then `_running = true` as its last statement), this method (`_running = false` + `_slots.Clear()`
        // together), and StartSlot's own fault catch (`_slots.Remove`, and `_running = false` only when that
        // removal emptied the list). Only the first can separate them — a throw from StartSlot AFTER at
        // least one slot is installed and BEFORE `_running = true` leaves exactly this state. That is S3's
        // named residual, third consequence, at the top of this file.
        //
        // WHAT IT DOES NOT CHANGE, and this is why it is a repair rather than a reordering: in every OTHER
        // state the conjunction has the identical value to the disjunct it replaced (`_slots` is empty
        // whenever `_running` is false, everywhere else), so no reachable Stop/Estop/restart behaves
        // differently. Both callers compute their historian run event from `wasRunning`/a latched flag read
        // BEFORE this call — Stop()'s `stopped` is `wasRunning && !IsRunning`, false here because the fleet
        // already reported stopped, and Estop() records unconditionally as it always has — so no run event
        // is invented or lost and the OEE timeline is untouched. RegisterMachine/ApplyScenario never reach
        // this state at all: both call this method only `if (IsRunning)`.
        //
        // 🔴 WHAT IT COSTS, FIRST HALF — AND IT IS OPERATOR-VISIBLE OUTPUT, WHICH THE FIRST VERSION OF THIS
        // COMMENT DENIED. Review I-1, and it is §8.1(h3) firing on the round that was told to apply it: I
        // swept the newly reachable path for new messages and wrote "no new message exists". FALSE. Making
        // this method DO its teardown in that state makes three log lines reachable that were not:
        //   - the per-slot cancellation-callback entry buffered below carries a NON-NULL Error, so
        //     FlushDeferredLogs routes it to _logError — a HOST ERROR LINE, on a path that emitted nothing;
        //   - DisposeOldSlots' two buffered _logDebug lines (faulted run-task wait, driver dispose fault)
        //     become reachable for the same reason.
        // All three need a MISBEHAVING driver to fire at all, and Debug is silent under the shipped hosts
        // (no appsettings.json), so the Error line is the one an operator can actually meet. It is NAMED
        // rather than avoided because it is INSEPARABLE from the fix: the lines are produced BY the teardown,
        // and a teardown that cannot report a driver that refused to cancel is worse than one that can.
        //
        // 🔴 WHY THIS IS NOT THE DEFERRED-LOG QUESTION S3's RESIDUAL (3) REFUSES, AND THE FIRST ANSWER I
        // WROTE HERE WAS FALSE (re-review, Important). It said (3) is about "SPEAKING FOR A START THAT NEVER
        // INSTALLED, where the alternative is silence about nothing having happened". That is true of (3)'s
        // two SIBLING paths — the latch refusal and the stop-abandon — and FALSE of the path (3) is actually
        // about. On the throw path the start did plenty: the resolver ran and fell back, a connector was
        // rejected, and slots MAY HAVE BEEN INSTALLED before the throw — that last one is consequence (2) of
        // this same residual, a few lines up in the same banner. A distinction that is false of the case it
        // is drawn for does not draw it.
        //
        // THE DIFFERENCE THAT DOES HOLD IS INSEPARABILITY, and it is already stated one paragraph above:
        // these three lines are produced BY the teardown — there is no way to make HALT halt without running
        // the code that emits them. Emitting `deferredLogs` is a FREE-STANDING choice with no other
        // consequence: nothing else about the system changes if it is or is not done. "Output that arrives
        // with a safety fix" and "output added because it seemed better" are different categories, and only
        // the second is the one this branch reserves.
        //
        // 🔴 T-1 — THE PARAGRAPH ABOVE IS UNCHANGED BECAUSE IT WAS RIGHT, AND IT IS WHAT DECIDED (3). Two
        // things follow from it and only one of them was ever this comment's to say:
        //   - INSEPARABILITY still holds. These three lines still arrive with the halt fix, and emitting the
        //     deferred lines of a failed install is still a free-standing choice that changes nothing else.
        //     That is why the two questions stayed separate and why this fix did not decide that one.
        //   - "FREE-STANDING" was a statement about WHO decides, never about the answer. This comment's own
        //     measurement — that (3)'s path did plenty before it threw, while its two siblings did nothing —
        //     is the evidence residual (3)'s symmetry argument could not survive, and it was sitting here,
        //     in this file, for three refusals. The owner ruled on 2026-08-17 (docs/owner-decisions.md §6):
        //     emit on the throw path, leave the two siblings silent. The category that was reserved was
        //     "output added because it seemed better"; a ruling is not that category.
        // Nothing about THIS method moved for it. The lines below are still the halt path's own, still
        // buffered, still flushed by WaitAndDisposeOldPipeline off this lock.
        //
        // 🔴 AND (h3) IS SYMMETRIC — THIS CHANGE ALSO REMOVES A REPORTING ROUTE, which both my sweep and its
        // first correction missed because both looked only for reports that START (re-review, Minor).
        // Before this fix, a stranded slot that faulted at some later point reached StartSlot's catch, found
        // `_slots.Remove(slot)` == TRUE, set `LastError = ex` and flipped GET /v1/health unhealthy: that was
        // the stuck state's ONLY eventual self-report, and an operator who waited long enough got one. After
        // a halt has cleared `_slots`, that same fault finds `removed` == FALSE, so LastError is not set and
        // health does not flip. BENIGN — the state being reported no longer exists, and reporting a fleet
        // unhealthy because a slot an operator already halted later unwound is worse than silence. But
        // "follow a failure to where it is REPORTED" covers failures that STOP being reported exactly as
        // much as ones that start, and a change that removes an operator-visible signal has to say so even
        // when removing it is right.
        //
        // WHAT IT COSTS, SECOND HALF: a Stop/Estop made in that state now performs the teardown instead of
        // returning immediately — bounded by RestartTeardownTimeout per stranded slot, twice (run-task wait,
        // then the driver's own DisposeAsync), off this lock in WaitAndDisposeOldPipeline. And it widens the
        // REACHABILITY of P6 in the nine-path enumeration above by exactly one state: `slot.Cts.Cancel()`
        // below runs a third-party cancellation callback under this lock, which it already did on every
        // ordinary halt. No path is added, no member changes status, the set is still nine and the lock
        // ordering set is still five.
        //
        // WHAT IT DOES NOT FIX, stated because it is the obvious next question: a bare Start() made from
        // that state still installs a SECOND set of slots on top of the stranded ones (StartLocked's latch
        // reads IsRunning, which is false there), so recovery means Stop-or-Estop FIRST. Closing that means
        // touching the HALT latch, which this task does not do.
        if (!_running && _slots.Count == 0) return default;
        _running = false;

        if (_slots.Count == 0) return default;

        // 🔴 G-1 — same deferral as StartLocked, and here it matters most: this method runs with _gate held
        // on the HALT path itself. See DeferredLogEntry.
        var deferredLogs = new List<DeferredLogEntry>();

        var old = _slots.ToList();
        foreach (var slot in old)
        {
            try
            {
                slot.Cts.Cancel();
            }
            catch (Exception ex)
            {
                // A driver's cancellation-registration callback threw — never let it abort the halt for every
                // OTHER slot, or stop this method from reaching _slots.Clear()/the EstopEngaged latch below.
                deferredLogs.Add(new DeferredLogEntry(
                    ex,
                    $"FleetCore pipeline slot '{slot.Label}' threw from a cancellation-registration callback " +
                    "during Cts.Cancel() — IDeviceDriver.ReadAsync's contract requires such a callback to be " +
                    "prompt and non-throwing; continuing to cancel/tear down every other slot regardless"));
            }

            slot.Pipeline.Committed -= OnPipelineCommitted;
        }

        _slots.Clear();
        return new PipelineHandle(old, deferredLogs);
    }

    /// <summary>Completion-review #7 — bounded, OFF-LOCK wait for each old slot's run-task to actually
    /// finish (closing the "leaked CTS + briefly two pipelines share <see cref="_transport"/>" gap)
    /// before the caller starts fresh ones. Must never be called while holding <see cref="_gate"/>: a
    /// slot's own catch handler (see <see cref="StartSlot"/>) re-acquires <see cref="_gate"/> to apply
    /// its slot-membership-guarded write, so a caller blocked on <c>Task.Wait()</c> for that same task
    /// WHILE holding the gate would deadlock against it. If an old task is still stuck past the timeout,
    /// this gives up and disposes its CTS anyway — Cancel() has already been requested, so the task will
    /// eventually unwind and its own membership guard (not this method) is what keeps a late finish from
    /// corrupting state.
    ///
    /// G2-6 review fix — ALSO disposes each slot's <see cref="PipelineSlot.Driver"/>, best-effort, AFTER its
    /// run-task has exited (cancel → run-task exits on the cancellation → wait → dispose driver → dispose
    /// cts). Cancelling a slot's <see cref="PipelineSlot.Cts"/> alone stops its poll loop but does NOT
    /// release a driver-owned live resource (e.g. <see cref="ModbusTcpDriver"/>'s TCP
    /// connection) — before this fix, FleetCore never called <c>DisposeAsync</c> on ANY slot's driver, so
    /// every Stop/restart leaked one connection per real-driver slot until GC finalized it. Sync-waiting
    /// <c>DisposeAsync</c> here (bounded by <see cref="RestartTeardownTimeout"/>, same budget the run-task
    /// wait above already uses) is deadlock-safe: this method runs OFF <see cref="_gate"/>, and a driver's
    /// <c>DisposeAsync</c> never calls back into <see cref="FleetCore"/> (e.g. <c>ModbusTcpDriver</c> just
    /// cancels/closes its own <c>TcpClient</c>).
    ///
    /// <para>🔴 <b>G-2 (S2, second half) — the flush is in a <c>try</c> and the disposals in the
    /// <c>finally</c>, and this is the halt path.</b> G-1 put a host seam (<see cref="FlushDeferredLogs"/> →
    /// <see cref="_logWarning"/>/<see cref="_logError"/>) as the FIRST statement of the routine whose job is
    /// to release every old slot's driver and CTS. A host wires those delegates to an <c>ILogger</c>, and
    /// <c>Microsoft.Extensions.Logging.Logger.Log</c> rethrows a provider's failure as an
    /// <c>AggregateException</c> instead of swallowing it — so a failing Windows Event Log provider under
    /// <c>AddWindowsService</c> threw out of the flush and skipped every disposal below it: one leaked live
    /// connection per slot, during <see cref="Estop"/>. Order is unchanged (flush first, then dispose); only
    /// the guarantee is new.</para></summary>
    private void WaitAndDisposeOldPipeline(PipelineHandle handle)
    {
        try
        {
            // 🔴 G-1 — first thing off the lock: emit whatever StopLocked deferred. Enumerated, not assumed:
            // StopLocked has exactly four callers — Stop, Estop, RegisterMachine and ApplyScenario — and all
            // four pass the handle it returns to THIS method with _gate released. Nothing else calls
            // StopLocked (Start does not), so no deferred line can be stranded. Placed before the OldSlots
            // null-return because a handle can legitimately carry lines and no slots is not a case that
            // arises today, and relying on that would be a property of the current call sites rather than of
            // this method.
            FlushDeferredLogs(handle.DeferredLogs);
        }
        finally
        {
            DisposeOldSlots(handle.OldSlots);
        }
    }

    /// <summary>🔴 G-2 — the disposal half of <see cref="WaitAndDisposeOldPipeline"/>, split out for one
    /// reason only: a <c>finally</c> block may not contain the <c>return</c> the null-handle case needs.
    ///
    /// <para>🔴 <b>G-2 FIX ROUND 1 (review I-3) — the two <see cref="_logDebug"/> calls are BUFFERED and
    /// emitted after the loop, because they were host seams sitting BETWEEN slot disposals on the halt
    /// path.</b> Both live inside a per-slot <c>catch</c>, so they run exactly when a driver has actually
    /// misbehaved — the case the catch exists for. A host wires <see cref="_logDebug"/> to its own
    /// <c>ILogger</c>; a throw there aborted the loop and <b>every remaining slot's driver and CTS went
    /// undisposed</b>. That is the same leak <see cref="Estop"/>'s own <c>finally</c> exists to prevent, one
    /// level in — and round 1 shipped a sentence at <see cref="Estop"/> asserting the deferred-log flush was
    /// the ONLY remaining throw site here, which was false.</para>
    ///
    /// <para>Buffering is the pattern G-1 already established for this exact hazard, applied one level down;
    /// it introduces no new channel and no arbitration. The messages, their order relative to one another and
    /// their channel are unchanged — what changes is that no host code runs between two slots' disposals, so
    /// a throwing (or merely SLOW) logger can no longer truncate or stall a halt. The lines now arrive after
    /// the last disposal rather than interleaved with them; they are Debug-channel and <c>St4i.EngineApi</c>
    /// ships no <c>appsettings.json</c>, so nothing observes that interleaving today.</para>
    ///
    /// <para>A throw from the emit loop still propagates — nothing is swallowed — but by then every slot has
    /// been released.</para></summary>
    private void DisposeOldSlots(IReadOnlyList<PipelineSlot>? oldSlots)
    {
        if (oldSlots is null) return;

        var teardownFaults = new List<(Exception Error, string Message)>();

        foreach (var slot in oldSlots)
        {
            if (slot.RunTask is not null)
            {
                try
                {
                    slot.RunTask.Wait(RestartTeardownTimeout);
                }
                catch (AggregateException ex)
                {
                    // Defensive only: a slot's run-task body catches every exception it can throw
                    // (OperationCanceledException and general Exception both handled internally, see
                    // StartSlot), so this Task should never actually fault. If something inside that catch
                    // itself somehow throws, this just keeps Task.Wait()'s unwrap-and-rethrow from surfacing
                    // as an unhandled exception on the restart caller instead of a log line.
                    // 🔴 G-1 — _logDebug, not _logError; see _logDebug and the sibling site below.
                    // 🔴 G-2 fix round 1 — buffered, not emitted here. See this method's own remarks.
                    teardownFaults.Add((ex, "FleetCore old pipeline slot teardown wait observed a faulted task"));
                }
            }

            try
            {
                slot.Driver.DisposeAsync().AsTask().Wait(RestartTeardownTimeout);
            }
            catch (Exception ex)
            {
                // Best-effort, same "never let teardown hang/throw on a misbehaving driver" posture as the
                // run-task wait above.
                // 🔴 G-1 — _logDebug, not _logError; the third of the three best-effort teardown lines E-2
                // moved from SILENT to Error. See _logDebug.
                // 🔴 G-2 fix round 1 — buffered, not emitted here. See this method's own remarks.
                teardownFaults.Add((ex, "FleetCore old pipeline slot driver dispose observed a fault"));
            }

            slot.Cts.Dispose();
        }

        // Every slot is released by the time any host code runs.
        foreach (var fault in teardownFaults)
        {
            _logDebug?.Invoke(fault.Error, fault.Message);
        }
    }

    private void OnPipelineCommitted(DeviceReading reading, TransportAck ack)
    {
        // SM-2 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-2-brief.md) —
        // data lineage, classified HERE, cheaply, on this hot path: from the SAME already-resolved
        // MachineDescriptor.DriverKind every other classification in this codebase reads (via the ONE
        // canonical DriverKinds.IsFabricated call path) — never a second/independently-invented rule, and
        // never inferred later from the CURRENT roster at Snapshot()-read time (the roster can change
        // between now and then). A reading whose machine code doesn't resolve to any MachineState (no
        // descriptor to classify — not reached by any registered driver in practice) is conservatively
        // treated as not-real for the real-only counters below, same "uncertain provenance never silently
        // counts as real" posture SqliteHistorianStore's own real-presence gate documents.
        var isFabricated = true;
        if (_states.TryGetValue(reading.MachineCode, out var state))
        {
            state.ApplyReading(reading, ack);
            isFabricated = DriverKinds.IsFabricated(state.Descriptor.DriverKind);
            _historianWriter?.Enqueue(HistorianResultRecord.From(state.Descriptor, reading, ack, DateTimeOffset.UtcNow));
        }

        Interlocked.Increment(ref _totalCycles);
        if (!isFabricated) Interlocked.Increment(ref _totalCyclesReal);

        if (reading.Verdict != Verdict.Skip)
        {
            lock (_kpiGate)
            {
                _totalJudged++;
                if (reading.Verdict is Verdict.Pass or Verdict.Warn) _totalPass++;

                if (!isFabricated)
                {
                    _totalJudgedReal++;
                    if (reading.Verdict is Verdict.Pass or Verdict.Warn) _totalPassReal++;
                }
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // SNAPSHOTS
    // ─────────────────────────────────────────────────────────────────────
    /// <summary>🔴 E-2 — was <c>FleetHost.Snapshot()</c> returning <c>FleetSnapshotDto</c>. Every lock, every
    /// read and every ordering below is unchanged; only the return SHAPE is now a domain record the shell
    /// projects. It moved down WHOLE and could not have been split: it reads <c>(_running, _estopEngaged)</c>
    /// in ONE <see cref="_gate"/> acquisition, and a shell that asked for those two through two calls would
    /// have made a pair non-atomic that is atomic today — the same class of hazard blueprint §9.3b names for
    /// <see cref="GetSafetyStatus"/>, on a member nobody had looked at.</summary>
    public FleetRuntimeSnapshot ReadSnapshot()
    {
        // M-3: IsRunning is only ever WRITTEN under _gate (StartLocked/StopLocked) — read it under the
        // same lock here too (a GET can land on a different thread than whichever POST last flipped it)
        // rather than relying on an unsynchronized read of a plain, non-volatile bool. E1: read it FIRST
        // so both the per-tile status projection and the online count use the exact same running/stopped
        // verdict — no window where one reflects a stale value the other doesn't.
        bool isRunning;
        bool estopEngaged;
        lock (_gate)
        {
            isRunning = IsRunning;
            estopEngaged = _estopEngaged;
        }

        // _states.Values (ConcurrentDictionary) is a point-in-time copy, safe to enumerate here even if
        // RegisterMachine adds an entry on another thread concurrently (E1) — no lock needed.
        var machines = _states.Values
            .OrderBy(s => s.Code, StringComparer.Ordinal)
            .Select(s => s.SnapshotTile(isRunning))
            .ToList();

        // E1 (health-truth): online must reflect the RUNNING state, not "ever produced a cycle" — the
        // pre-fix bug was a stopped fleet that stayed "N/N online" forever because Cycles never resets.
        var online = isRunning ? machines.Count(m => m.Cycles > 0) : 0;

        // SM-2 — "not blend, not suppress": the CURRENT roster decides which counter set this call
        // reports. A real machine present means _totalCycles/_totalJudged/_totalPass (blended across every
        // slot, fabricated included) would silently blend fabricated cycles into a number a customer reads
        // — so the real-only counters are reported instead, excluding the fabricated fleet entirely, even
        // though Machines above still lists it (see HasMixedProvenance). No real machine present (a pure
        // demo roster, or an empty product roster) means there is nothing to blend WITH — the original
        // blended counters are reported unchanged, which is also what keeps the exhibition contract
        // (pure demo's own numbers) byte-identical to before this task.
        var (hasFabricatedMachine, hasRealMachine) = ClassifyRoster();

        long totalCycles;
        double fpy;
        if (hasRealMachine)
        {
            totalCycles = Interlocked.Read(ref _totalCyclesReal);
            lock (_kpiGate)
            {
                fpy = _totalJudgedReal == 0 ? 0.0 : (double)_totalPassReal / _totalJudgedReal;
            }
        }
        else
        {
            totalCycles = Interlocked.Read(ref _totalCycles);
            lock (_kpiGate)
            {
                fpy = _totalJudged == 0 ? 0.0 : (double)_totalPass / _totalJudged;
            }
        }

        var hasMixedProvenance = hasFabricatedMachine && hasRealMachine;

        return new FleetRuntimeSnapshot(machines, online, totalCycles, fpy, hasMixedProvenance, isRunning, estopEngaged);
    }

    // ─────────────────────────────────────────────────────────────────────
    // DYNAMIC REGISTRATION (E1) — foundation for the onboarding overhaul (E2 calls this).
    // ─────────────────────────────────────────────────────────────────────
    /// <summary>Adds a machine to the LIVE fleet roster at runtime. Returns <see langword="false"/>
    /// (no-op, no throw) if <paramref name="descriptor"/>'s <see cref="MachineDescriptor.Code"/>
    /// already exists (case-insensitively) — E2's onboarding flow can call this speculatively without
    /// pre-checking for a race against another registration.
    ///
    /// Concurrency: the roster mutation (dup-check + <c>_fleet.Add</c> + <c>_states.TryAdd</c>) happens
    /// under <see cref="_gate"/> — the same lock <see cref="StartLocked"/>/<see cref="StopLocked"/>/
    /// <see cref="ApplyScenario"/> already serialize on. <see cref="ReadSnapshot"/>/<c>FleetHost.MachineDetail</c>
    /// take no lock at all (by design — they're hot GET paths) and remain safe to call concurrently with
    /// this method because <see cref="_states"/> is a <see cref="ConcurrentDictionary{TKey,TValue}"/>:
    /// the new entry either isn't visible yet or is fully constructed when it becomes visible, never torn.
    ///
    /// If the fleet is currently running, the pipeline is restarted — completion-review #1/#7:
    /// <see cref="StopLocked"/> runs under <see cref="_gate"/> and hands back the OLD run-task/CTS, the
    /// gate is released, <see cref="WaitAndDisposeOldPipeline"/> waits for that old task OFF-LOCK (bounded
    /// by <see cref="RestartTeardownTimeout"/>, required — the old task's own catch re-acquires
    /// <see cref="_gate"/>, so waiting for it while still holding the gate would deadlock), and only THEN
    /// does a fresh <c>lock (_gate) StartLocked()</c> rebuild the pipeline from the current roster
    /// (including whatever was just added) — any connector driver <see cref="StartLocked"/> collects as
    /// orphaned (review fix round 2) is likewise disposed OFF this same lock, via
    /// <see cref="DisposeOrphanedConnectorDrivers"/>. There's a narrow window between those two locked sections
    /// where another thread could itself call <see cref="Stop"/>/<see cref="Start"/> and observe/flip
    /// <see cref="IsRunning"/> — accepted the same way the pre-existing restart-under-one-lock code
    /// accepted "last writer wins" for concurrent scenario/registration calls; this is a single-operator
    /// exhibition tool, not a multi-writer production control plane. Every other machine's
    /// <see cref="MachineState"/> (and its I-1 cycle-offset) survives the restart untouched, exactly as it
    /// does for a scenario-triggered restart. If the fleet is stopped, the new machine is simply included
    /// the next time <see cref="Start"/> runs.
    ///
    /// Either way, the new machine is visible in the very next <see cref="ReadSnapshot"/> immediately —
    /// idle status, 0 cycles — since its <see cref="MachineState"/> is inserted before this method
    /// returns.</summary>
    public bool RegisterMachine(MachineDescriptor descriptor)
    {
        ArgumentNullException.ThrowIfNull(descriptor);
        if (string.IsNullOrWhiteSpace(descriptor.Code))
        {
            throw new ArgumentException("MachineDescriptor.Code must not be null/blank.", nameof(descriptor));
        }

        // GP-5 (task-5-brief.md item 1) — FleetConfig.Load already normalizes a fleet.json entry's
        // DriverKind through DriverKinds.Normalize (so "modbus"/"MODBUS"/"Modbus" all land on the exact
        // canonical spelling); a descriptor arriving through THIS method (Program.cs's Modbus/OPC-UA seed
        // descriptors, OnboardingFleetJoin, or any future caller) never went through that same fold. Every
        // built-in seed descriptor in this codebase already passes a canonical DriverKinds constant
        // directly, so this is a no-op for them — it matters for a caller that hands in some OTHER casing
        // of a built-in id, or a third-party id whose exact-spelling storage here is what StartLocked's own
        // union filter (and every other DriverKind-literal comparison in this class) relies on comparing
        // correctly against DriverKinds.Modbus/OpcUa/registry ids.
        descriptor = descriptor with { DriverKind = DriverKinds.Normalize(descriptor.DriverKind) };

        PipelineHandle restartHandle = default;
        var restarting = false;
        StartInputs restartInputs = default;

        lock (_gate)
        {
            if (_fleet.Any(d => string.Equals(d.Code, descriptor.Code, StringComparison.OrdinalIgnoreCase)))
            {
                return false;
            }

            // 🔴 J-1 — `_fleet` is APPEND-ONLY: this is its only growth point, and the RemoveAt below is a
            // rollback of this very statement inside the same acquisition, so no descriptor already visible
            // to a reader is ever removed or replaced. StartLocked's reuse-or-build rule does not DEPEND on
            // that (it compares element-wise and falls back to building, whatever the roster did), but the
            // deferred-log ORDER argument recorded there does.
            _fleet.Add(descriptor);
            // TryAdd (not the indexer): the _fleet duplicate-check above is the source of truth under
            // this same lock, so a collision here would indicate _fleet/_states drifted out of sync —
            // fail loudly (silently returning false here) rather than clobber an existing MachineState.
            if (!_states.TryAdd(descriptor.Code, new MachineState(descriptor)))
            {
                _fleet.RemoveAt(_fleet.Count - 1);
                return false;
            }

            // P2-1 — same roster-seed notification as the ctor's loop above; a newly-registered machine
            // becomes a durable asset row too, not just the ones present at process start.
            // 🔴 G-1 CLOSES blueprint §9.2 violation 3. The host callback is no longer INVOKED here — only
            // recorded. Placed after the _fleet/_states writes and after both failure returns above, so a
            // machine that was not actually added never owes a notification.
            EnqueueSeedNotification(descriptor);

            if (IsRunning)
            {
                restartHandle = StopLocked();
                restarting = true;
                // 🔴 J-1 — the snapshot rides the acquisition this method ALREADY takes, so the hoist costs
                // no extra lock here (unlike Start(), which had only one). 🔴 J-1b — that is still true OF
                // THE SNAPSHOT and no longer true of the restart path as a whole: the pre-check in
                // RebuildPipelineOffLock is one more _gate acquisition per rebuild. It takes no OTHER lock
                // while holding it, so the five-lock ordering set at the top of this file is unchanged.
                // Taken AFTER _fleet.Add, so the
                // machine just registered is in it — which is why the common case reuses the whole plan and
                // the reuse-or-build fallback in StartLocked is for a CONCURRENT registration, not this one.
                restartInputs = SnapshotStartInputsLocked();
            }
        }

        // 🔴 G-1 — the seed notification, off _gate, and in a `finally`. Both halves of that are load-bearing
        // and the second one was a REVIEW FIX (I-3), not part of the original design.
        //
        // WHY LAST, not first-after-the-lock: before G-1 this call ran under the lock BEFORE StopLocked, so a
        // host callback that threw (a real AssetRegistryStore can throw — blueprint §10.6's "two processes,
        // one machine-wide data file, no cross-process locking") aborted RegisterMachine with the pipeline
        // still running. Draining right after the lock would have moved that throw to a point where
        // StopLocked had ALREADY torn the pipeline down and StartLocked had not yet rebuilt it, turning a
        // failed registration into a stopped fleet.
        //
        // WHY `finally`: the descriptor is committed to _fleet/_states under the lock and is never rolled
        // back, so from the instant the lock is released the machine EXISTS and owes exactly one
        // notification. Everything between here and the drain can throw — and one of those throws is
        // reachable through the very path G-1's own enumeration turned up (P5, which G-1's prose called
        // "path B" before that list was labelled: SimulatorFactory.Create -> SimulatorBase's ctor ->
        // MachineConfigStore.Ensure, which throws InvalidOperationException on a config-kind mismatch and
        // IOException from its File.WriteAllText/File.Move on a full or read-only data root — 🔴 reached
        // from RebuildPipelineOffLock -> BuildStartPlan since J-1, not from StartLocked; same throw, one
        // statement earlier and off _gate. 🔴 BRANCH REVIEW, Important 2: this used to say "SAME
        // reachability" and that is FALSE on this arm. Pre-J-1 the latch inside StartLocked refused before
        // any build, so an Estop landing after the StopLocked above made the whole rebuild — and this throw
        // — unreachable. Now the build runs first, so during a HALT this path performs P4's per-machine
        // reads and P5's WRITE (against whatever root ST4I_MACHINE_CONFIG_DIR names, possibly a UNC share)
        // and can throw where it previously could not. STRICTLY WIDER, not the same. 🔴 J-1b narrowed it
        // again by exactly one window: RebuildPipelineOffLock now reads the latch under _gate BEFORE it
        // builds, so an Estop landing anywhere in the TEARDOWN below — the widest part of that gap, bounded
        // by RestartTeardownTimeout per old slot and containing third-party DisposeAsync code — costs no
        // reads, no writes and no throw. An Estop landing INSIDE the build still does all three, and no
        // PRE-build check can change that; the POST-build one that would is refused at Start() and stays
        // refused.). Without the finally, that
        // throw leaves the machine in
        // the roster with its notification still sitting in _pendingSeedNotifications, delivered only if some
        // LATER RegisterMachine happens to drain it, and never at all if none does. Pre-G-1 the notification
        // had already been delivered by that point, so this would be a regression THIS CHANGE introduced,
        // not an inherited one — it silently weakens the brief's "exactly one notification per seeded
        // machine" to "at most one, eventually".
        //
        // The finally does NOT swallow anything: the restart exception still propagates to the caller
        // exactly as before, and a callback that itself throws still surfaces.
        //
        // 🔴 What it CAN do, stated because the first version of this comment waved it away (review N-2):
        // if BOTH throw, the drain's exception REPLACES the restart's — ordinary .NET behaviour for a
        // throwing finally, but the two are not interchangeable here. The exception being replaced is the
        // one that says THE PIPELINE IS DOWN (StartLocked threw, so the fleet is left stopped with zero
        // slots and no rollback); the one replacing it says the asset-registry callback failed. Losing the
        // first is strictly worse than losing the second.
        //
        // Left as-is rather than aggregated, and the reason is checkable rather than universal: the original
        // wording claimed "nothing downstream depends on which of the two the caller sees", which is an
        // unverified claim about ALL callers. The narrow, checked version is — enumerated, not assumed —
        // that RegisterMachine has SIX call sites in this tree: ConnectorEndpoints' single-machine path and
        // its RTU-bus loop (2), OnboardingFleetJoin (1), and Program.cs's three seed registrations (3). NONE
        // of them wraps it in try/catch: every one consumes the bool return and lets any exception
        // propagate. (The nearest try/catch, in ConnectorEndpoints' rollback block, sits inside a different
        // branch and does not enclose its RegisterMachine call.) So no caller branches on the exception type
        // TODAY. That is a property of the current call sites, not of this method — so if a caller ever does
        // branch, capture-and-aggregate (hold the restart fault, run the drain, throw an AggregateException
        // when both fired) is the fix, and it is deliberately not done here because it would be a behaviour
        // change with no test behind it.
        //
        // 🔴 This sentence said "four call sites" while its own parenthetical listed 2 + 1 + 3 — corrected by
        // review. It is worth the extra line because of WHERE it happened: this is the sentence written to
        // replace an unverified universal with a counted one, and its own words are "enumerated, not
        // assumed". The enumeration was right and the count in front of it was wrong, which is the fourth
        // instance of that pairing in this task. The claim it supports never depended on the number — all
        // six are unwrapped either way — and that is exactly why it would have survived unchallenged.
        try
        {
            if (restarting)
            {
                // 🔴 G-2 (S4, first half) — the REBUILD is what StopLocked's commit owes, so it runs in a
                // `finally` too. Before this, a throw out of WaitAndDisposeOldPipeline (its deferred-log
                // flush is a host seam) aborted this method with `_running == false` and zero slots: the
                // machine registered, the pipeline down, and nothing to bring it back. The masking direction
                // is the safe one and it is the argument G-1's N-2 already made — losing "the logger failed"
                // to keep "the pipeline is down" is the trade worth taking, never the reverse.
                //
                // What this does NOT close is the other half of S4: if the rebuild ITSELF throws (the
                // enumeration's P5), no `finally` can restart a fleet that failed to start. See this
                // method's own remarks below and the G-2 report for why that half needs an owner decision.
                //
                // 🔴 Scoped to that throw deliberately (whole-branch review I-3). An earlier wording
                // generalised it to "nothing is owed, so nothing is lost", which is FALSE about it: a
                // StartLocked that throws still leaves partial work behind, which is S3's named residual at
                // the top of this file, and a reader sent away from it by this comment would miss the one
                // thing they need. ApplyScenario's copy of this same argument never carried the
                // generalisation; the two now agree.
                //
                // 🔴 T-1 — AND THE SENTENCE THAT SAID *WHAT* WAS LOST WAS ITSELF STALE, IN TWO OF ITS THREE
                // CLAUSES, SINCE J-2. It read: StartLocked "has lost `orphanedConnectorDrivers` and
                // `deferredLogs` outright — they are its locals" and "left `_slots` non-empty with
                // `_running == false`, which StopLocked then refuses to tear down". J-2 made the orphan list
                // the caller's and made StopLocked's guard a conjunction that tears that state DOWN, and this
                // copy of the claim was not re-derived when it did; T-1 made the deferred list the caller's
                // too. Nothing here relied on the false clauses, which is exactly why nothing caught them —
                // the enumeration lives at the residual and this sentence was a summary of it. It is replaced
                // by the pointer rather than re-summarised, because a second copy is what went stale.
                //
                // 🔴 J-1 — the `finally` below is now ONE statement, and that is a deliberate answer to
                // §8.1(e) rather than a tidy-up. The paragraph that used to sit here reasoned about TWO
                // statements ("a throw from the first ABANDONS the second — that is how C# `finally` works
                // and it cost this task one wrong draft in Start()") and concluded it was harmless because
                // the second was a no-op on the only throwing path. That argument was correct and it was
                // also the kind that has to be re-derived at every copy of the pattern. The build, the
                // install and the off-lock completion now live in RebuildPipelineOffLock, so the question is
                // asked and answered once, there, instead of at each of this method's and ApplyScenario's
                // copies — and this site has no multi-statement `finally` left to reason about.
                // 🔴 J-1 FIX ROUND 2 — WHAT NOW LIVES IN THE GAP BELOW, stated at the site because neither
                // direction of approach reaches it otherwise. Three things are true here and none of them
                // was written down at this method:
                //
                //  (1) THE PIPELINE BUILD IS INSIDE THIS WINDOW. RebuildPipelineOffLock runs BuildStartPlan
                //      — every simulator, every mapping profile — before it re-takes _gate. The window
                //      between this method's two locked sections is therefore wider than it was before J-1.
                //      Its OUTCOME class is unchanged, and that is why it was merged as-is: this gap always
                //      contained unbounded third-party work (WaitAndDisposeOldPipeline's deferred-log flush
                //      is a host seam, and each driver's DisposeAsync is third-party code under a timeout),
                //      so a build is consistent in kind with what was already here rather than a new
                //      category. "Last writer wins" for a concurrent Stop/Start, documented in this
                //      method's own doc comment, still describes it exactly.
                //  (2) AN OPERATOR CAN WIDEN IT FROM OUTSIDE THE PROCESS. The build reaches
                //      MachineConfigStore.Ensure, whose root is relocatable via ST4I_MACHINE_CONFIG_DIR
                //      (H-1c; README §15.9 tells operators they may set it). Point it at a UNC share and
                //      the width of this window becomes a property of the network. That is the one input
                //      here that is neither this class's nor the caller's.
                //  (3) `_stopRequests` DELIBERATELY DOES NOT COVER THIS SITE. Start() abandons its install
                //      when an operator Stop lands in ITS window; this restart does not, because a restart
                //      is not a request for the fleet to end stopped and cancelling it would leave the
                //      roster/scenario committed with no pipeline. The exclusion is argued at _stopRequests
                //      and is repeated here because a reader arriving from this side would otherwise never
                //      see it.
                try
                {
                    WaitAndDisposeOldPipeline(restartHandle);
                }
                finally
                {
                    RebuildPipelineOffLock(restartInputs);
                }
            }
        }
        finally
        {
            DrainSeedNotifications();
        }

        return true;
    }

    // ─────────────────────────────────────────────────────────────────────
    // SCENARIO
    // ─────────────────────────────────────────────────────────────────────
    /// <summary>🔴 E-2 — was <c>FleetHost.ApplyScenario</c> returning <c>ScenarioDto</c>; it returns the
    /// applied <c>(config, presetName)</c> pair instead and the shell builds the DTO. Blueprint §4 files this
    /// under "scenario/demo — STAYS", but E-1 §1.4(6) is right that it cannot: it mutates <see cref="_scenario"/>
    /// (which <see cref="StartLocked"/> reads), swaps the transport through
    /// <see cref="ApplyNetworkOutageLocked"/>, and conditionally tears down and rebuilds every pipeline — all
    /// under <see cref="_gate"/>. Only the DTO stayed behind. Same for <see cref="Burst"/> and
    /// <see cref="RunHotFolderAoiDemoAsync"/> (E-1 §1.4(7)/(8)); the preset CATALOGUE and
    /// <c>ApplyPresetAsync</c> genuinely did stay in the shell, because they touch no lock and no core
    /// state.</summary>
    public (ScenarioConfig Config, string PresetName) ApplyScenario(ScenarioConfig config, string? presetName = null)
    {
        ArgumentNullException.ThrowIfNull(config);

        PipelineHandle restartHandle = default;
        var restarting = false;
        StartInputs restartInputs = default;

        lock (_gate)
        {
            var previous = _scenario;
            _scenario = config;
            _activePresetName = presetName ?? "custom";

            ApplyNetworkOutageLocked(config.NetworkOutage);

            var multiplierChanged = Math.Abs(config.CycleRateMultiplier - previous.CycleRateMultiplier) > 1e-9;
            if (IsRunning && multiplierChanged)
            {
                restartHandle = StopLocked();
                restarting = true;
                // 🔴 J-1 — taken AFTER `_scenario = config`, so the plan is built with the multiplier this
                // call just committed. That ordering is what makes the reuse test in StartLocked
                // (`multiplier == plan.Multiplier`) succeed on the uncontended path rather than rebuilding
                // every simulator under the lock on every scenario change — i.e. it is the difference
                // between P5 being hoisted and P5 merely being moved.
                restartInputs = SnapshotStartInputsLocked();
            }
        }

        // Completion-review #1/#7 — same off-lock wait-then-restart shape as RegisterMachine above;
        // see its doc comment for the full deadlock/identity-guard reasoning.
        // 🔴 G-2 (S4, first half) — and the same `finally` around the rebuild, for the same reason: `_scenario`,
        // `_activePresetName` and the outage transport swap are all committed under _gate and never rolled
        // back, so from the moment the lock is released the fleet OWES a pipeline built from them. A throw out
        // of the off-lock teardown must not be what decides it never gets one.
        // 🔴 J-1 — the `finally` below is ONE statement now (RebuildPipelineOffLock), so the §8.1(e)
        // question this comment used to answer here is answered once, in that method, for both copies.
        if (restarting)
        {
            // 🔴 J-1 FIX ROUND 2 — the same three facts RegisterMachine's copy of this window now records,
            // repeated here rather than cross-referenced away, because a reader debugging a scenario change
            // arrives at THIS site and not at that one: (1) the pipeline BUILD (BuildStartPlan — every
            // simulator, every mapping profile) sits inside the gap below, so it is wider than pre-J-1,
            // though its outcome class is unchanged and the gap always held unbounded third-party work;
            // (2) ST4I_MACHINE_CONFIG_DIR is an operator-settable input that directly widens it, because
            // the build reaches MachineConfigStore.Ensure and that root can be a UNC share; (3)
            // `_stopRequests` deliberately does NOT guard this site — only Start() abandons on a concurrent
            // operator Stop, because a restart that abandoned would leave `_scenario` committed with no
            // pipeline built from it. See RegisterMachine and _stopRequests for the full argument.
            //
            // 🔴 BRANCH RE-REVIEW, N1 — THE FOURTH FACT, WHICH WAS ASSERTED TO BE HERE AND WAS NOT. The
            // branch-review round wrote the I-2 disclosure into RegisterMachine and then claimed at Start()
            // that "both restart sites now carry the disclosure". It was in ONE. This site had only the
            // three facts above, none of which says what follows — which is the same shape as the universal
            // this branch already retracted once: RETRACTED IN ONE OF TWO PLACES, ASSERTED AS BOTH. Seventh
            // instance of §8.1(f) in this task, and the second to occur inside the repair for an earlier
            // one.
            //
            // The fact itself: when an Estop lands after the StopLocked above, the rebuild's BuildStartPlan
            // still runs — P4's per-machine reads and P5's WRITE — WHILE THE HALT LATCH IS ENGAGED, against
            // a root ST4I_MACHINE_CONFIG_DIR may point at a UNC share, and it can THROW there
            // (MachineConfigStore.Ensure's InvalidOperationException on a config-kind mismatch, IOException
            // on a full or read-only root). Pre-J-1 the latch refused before any build, so none of that was
            // reachable on this path. It is STRICTLY WIDER, not "the same reachability".
            //
            // 🔴 J-1b — AND IT IS NARROWER AGAIN NOW, BY ONE WINDOW AND NOT BY THE WHOLE GAP.
            // RebuildPipelineOffLock reads the latch under _gate before it builds, so an Estop landing
            // anywhere in the TEARDOWN below — bounded by RestartTeardownTimeout per old slot, twice, and
            // containing third-party DisposeAsync code, i.e. the widest part of this gap — now costs no
            // reads, no writes and no throw. An Estop landing inside the BUILD still costs all three: no
            // PRE-build check reaches that window, and the POST-build check that would is refused at
            // Start() for a reason J-1b did not change. Written at BOTH restart sites rather than at one
            // and asserted as both, which is the N1 lesson directly above.
            try
            {
                WaitAndDisposeOldPipeline(restartHandle);
            }
            finally
            {
                RebuildPipelineOffLock(restartInputs);
            }
        }

        return (_scenario, _activePresetName);
    }

    public (ScenarioConfig Config, string PresetName) Burst()
    {
        CancellationTokenSource cts;
        CancellationTokenSource? previousCts;
        double baseline;
        lock (_gate)
        {
            cts = new CancellationTokenSource();
            previousCts = _burstRevertCts;

            if (previousCts is null)
            {
                _burstBaseline = _scenario.CycleRateMultiplier;
            }

            _burstRevertCts = cts;
            baseline = _burstBaseline;
        }

        // 🔴 G-1 — blueprint §10.3(d)'s SECOND Cancel under _gate, now off it. CancellationTokenSource.Cancel
        // runs every CancellationToken.Register callback SYNCHRONOUSLY on the calling thread and rethrows what
        // one of them throws; today the only registration on this particular token is the Task.Delay inside
        // RevertBurstAfterDelayAsync, so this is cheap and benign — but "benign today" is a property of the
        // current callee, not of this method, and it was running on the lock Estop() takes.
        //
        // Cancelling after the lock is released is safe in BOTH interleavings, and the reason is that
        // _burstRevertCts (not the token) is the authority: the previous revert task re-checks
        // `_burstRevertCts == cts` under _gate before reverting, so if the Cancel lands late and its
        // Task.Delay has already completed normally, the task simply finds it has been superseded and
        // returns without reverting — exactly what the cancellation would have caused.
        //
        // 🔴 The one interleaving this reordering DOES change (review M-5), stated rather than left to be
        // rediscovered: `_burstRevertCts = cts` now commits BEFORE this Cancel instead of after it, so if a
        // registered cancellation callback throws, _burstRevertCts is left pointing at a CTS whose
        // RevertBurstAfterDelayAsync (below) was never started.
        //
        // 🔴 G-2 CLOSES THAT, and M-5 turned out to be the small half of a larger window (S5). M-5 named only
        // the Cancel; the other statement in the same window is ApplyScenario, which is REACHABLE — its
        // restart branch reaches MachineConfigStore.Ensure (the enumeration's P5: InvalidOperationException
        // on a config-kind mismatch, IOException on a full or read-only data root; 🔴 via
        // RebuildPipelineOffLock -> BuildStartPlan since J-1, via StartLocked before it — the reachability
        // this paragraph rests on is unchanged, only the frame the throw unwinds through).
        // Either throw left the fleet running at BurstMultiplier with no revert task ever scheduled —
        // indefinitely, until some later Burst — because `_burstRevertCts = cts` had already committed under
        // _gate while the thing that discharges it, `RevertBurstAfterDelayAsync`, had not been started.
        //
        // The remedy is the `finally` below. Both of M-5's stated consequences go with it: the revert task now
        // starts on every path, so it reverts the multiplier AND clears `_burstRevertCts` back to null, which
        // is what lets the NEXT Burst re-capture `_burstBaseline` instead of inheriting a burst value as its
        // baseline. That sentence in M-5 no longer describes this code — it is retracted here rather than left
        // standing beside its own fix.
        //
        // NOT "lost" traded for "twice": the revert task is started exactly once per Burst call, and
        // `_burstRevertCts` is the ledger, not the task — the task re-reads `_burstRevertCts == cts` under
        // _gate before doing anything, so a superseded one returns without reverting. Starting it after a
        // throw is CORRECT rather than merely harmless: ApplyScenario commits `_scenario = config` as its
        // second statement inside the lock, so the burst multiplier is live even when the restart it triggers
        // throws afterwards, and a revert is exactly what that state owes.
        //
        // Masking: if ApplyScenario throws AND scheduling throws, the latter replaces the former. Scheduling
        // is a `Task.Run`-free direct async call whose synchronous prefix is a single `Task.Delay` — nothing
        // there throws short of OOM.
        (ScenarioConfig Config, string PresetName) applied;
        try
        {
            previousCts?.Cancel();
            applied = ApplyScenario(_scenario with { CycleRateMultiplier = BurstMultiplier }, presetName: "burst");
        }
        finally
        {
            _ = RevertBurstAfterDelayAsync(baseline, cts);
        }

        return applied;
    }

    private async Task RevertBurstAfterDelayAsync(double baseline, CancellationTokenSource cts)
    {
        try
        {
            await Task.Delay(BurstDuration, cts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        bool shouldRevert;
        lock (_gate)
        {
            shouldRevert = _burstRevertCts == cts;
            if (shouldRevert) _burstRevertCts = null;
        }

        if (shouldRevert)
        {
            // 🔴 G-2 — the ONE genuinely SILENT instance of S4, and the reason it is silent is here rather
            // than in ApplyScenario. ApplyScenario's restart branch can throw (P5: 🔴 since J-1
            // RebuildPipelineOffLock → BuildStartPlan → MachineConfigStore.Ensure, previously StartLocked →
            // the same), leaving the fleet stopped with `_scenario` already mutated. On its
            // other two entry paths that throw reaches an operator — RegisterMachine and the scenario
            // endpoint both propagate it to their caller, which is an HTTP 500. This one does not: Burst
            // starts this method as `_ = RevertBurstAfterDelayAsync(...)`, so the Task is never observed,
            // and nothing in this tree subscribes to TaskScheduler.UnobservedTaskException (checked, not
            // assumed — no reference to it exists in src/ or tests/). The fault was therefore collected by
            // the finalizer and dropped.
            //
            // Catching here does not swallow anything that was ever reaching anyone; it converts silence
            // into one line on the channel a host actually reads. It deliberately does NOT retry, roll back
            // or re-schedule.
            //
            // 🔴 U-1 — TWO CLAUSES OF THE MESSAGE BELOW WERE FALSIFIED, ONE BY THIS TASK AND ONE THAT WAS
            // ALREADY WRONG. It read: "the fleet may still be running at the burst cycle-rate multiplier and
            // no further revert is scheduled; … so this line is the only report of it".
            //   - "THIS LINE IS THE ONLY REPORT" is what U-1 falsified. RebuildPipelineOffLock's catch now
            //     records the same exception on LastError, so GET /v1/health reports it too. A sentence true
            //     at base and left standing beside its own change is the defect this file has a banner about.
            //   - "MAY STILL BE RUNNING AT THE BURST MULTIPLIER" pointed at the WRONG ARM and predates U-1.
            //     ApplyScenario commits `_scenario` as its second statement, so the multiplier is already
            //     back at `baseline` whichever way it then fails; and on the arm that is actually reachable —
            //     the rebuild throwing — the fleet is not running at all. An operator following that line
            //     went looking for a fleet cycling too fast and found one that had stopped.
            // The G-2 sentence this replaces was right about the one thing it was written for (the silence)
            // and is kept above; only the state description is corrected.
            //
            // WHAT DID NOT CHANGE: this catch still does not decide anything. The state a failed restart
            // leaves the fleet in is decided at RebuildPipelineOffLock, once, for all three entry paths —
            // which is why this site records nothing of its own.
            try
            {
                ApplyScenario(_scenario with { CycleRateMultiplier = baseline }, presetName: _activePresetName);
            }
            catch (Exception ex)
            {
                _logError?.Invoke(
                    ex,
                    "FleetCore burst revert failed — no further revert is scheduled, so the fleet keeps the " +
                    "cycle-rate multiplier it has now. This ran on an unobserved background task, so no caller " +
                    "ever sees this exception; when the failure was the pipeline rebuild the fleet is left " +
                    "STOPPED and GET /v1/health carries this same exception");
            }
        }
    }

    /// <summary>Assumes the caller already holds <see cref="_gate"/>.</summary>
    private void ApplyNetworkOutageLocked(bool outage)
    {
        if (outage)
        {
            _outageTransport ??= new DemoTransport(latencyMs: OutageLatencyMs, fakeErrorRate: OutageFakeErrorRate);
            _transport.SetInner(_outageTransport);
        }
        else
        {
            _transportCoordinator.ApplyMode(_transportCoordinator.Mode);
        }
    }

    /// <summary>Writes one guaranteed-NG doc-28 file and runs a dedicated <see cref="EdgePipeline"/> over
    /// a real <see cref="HotFolderAoiDriver"/> watching it — the headless-host analogue of the WPF app's
    /// <c>FleetService.RunHotFolderAoiDemoAsync</c>, sharing this host's own <see cref="Transport"/>/
    /// EventBus so the round-tripped reading shows up on the WS inspector stream exactly like a real
    /// machine's would.</summary>
    public async Task<string> RunHotFolderAoiDemoAsync(CancellationToken ct)
    {
        var baseDir = Path.Combine(Path.GetTempPath(), "st4i-engineapi-hotfolder-demo");
        var watchDir = Path.Combine(baseDir, "in");
        var archiveDir = Path.Combine(baseDir, "archive");
        var errorDir = Path.Combine(baseDir, "error");

        try
        {
            var demoDescriptor = new MachineDescriptor(
                "HOTFOLDER-DEMO", "SN-HOTFOLDER", DeviceClass.AoiAvi, "AOI", "inspection",
                DriverKinds.HotFolderAoi, "RC-HOTFOLDER-DEMO", null, CycleSeconds: 1.0);
            var sim = new AoiInspectorSim(demoDescriptor, seed: 777, pointsPerBoard: 8, ngRate: 1.0);
            var reading = sim.NextCycle(cycle: 1);

            var writtenPath = new Doc28Writer().WriteAtomic(watchDir, reading);

            await using var driver = new HotFolderAoiDriver(watchDir, archiveDir, errorDir);
            var profile = new MappingProfile { Name = "hotfolder-demo", DeviceClass = nameof(DeviceClass.AoiAvi) };
            var pipeline = new EdgePipeline(driver, profile, _transport, _eventBus, uns: _unsPublisher);

            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            DeviceReading? ingested = null;
            void OnCommitted(DeviceReading r, TransportAck a)
            {
                ingested = r;
                timeoutCts.Cancel();
            }

            pipeline.Committed += OnCommitted;
            timeoutCts.CancelAfter(TimeSpan.FromSeconds(5));
            try
            {
                await pipeline.RunAsync(timeoutCts.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                // expected: either our own success-cancel above, or the 5s safety net
            }
            finally
            {
                pipeline.Committed -= OnCommitted;
            }

            var fileName = Path.GetFileName(writtenPath);
            if (ingested is null)
            {
                return $"Wrote {fileName} to {watchDir} but HotFolderAoiDriver did not confirm read-back within 5s.";
            }

            var ngCount = ingested.Measurements.Count(m => string.Equals(m.Result, "NG", StringComparison.OrdinalIgnoreCase));
            return $"Wrote {fileName} — HotFolderAoiDriver read it back: {ngCount}/{ingested.Measurements.Count} NG point(s), verdict={ingested.Verdict}.";
        }
        finally
        {
            try
            {
                if (Directory.Exists(baseDir)) Directory.Delete(baseDir, recursive: true);
            }
            catch (IOException)
            {
            }
            catch (UnauthorizedAccessException)
            {
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // CURRENT PRODUCT (Task 3) — which product's machine×product settings layer a config-aware
    // simulator resolves against right now.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Sets (or, with <paramref name="productCode"/> null, clears) the product this machine is
    /// currently running — read fresh, per cycle, by every config-aware simulator's product-code
    /// provider (see <see cref="StartLocked"/>), so this takes effect on an already-running fleet
    /// immediately, no restart. Does not validate <paramref name="productCode"/> against
    /// <c>ProductConfigStore</c> — Task 3's scope is "the effective config drives behaviour", not product
    /// catalog validation, and an unknown product code simply resolves to no product-scoped adjustments
    /// (falls through to the machine-scoped/baseline layers), never an error.</summary>
    public void SetCurrentProduct(string machineCode, string? productCode)
    {
        ArgumentException.ThrowIfNullOrEmpty(machineCode);
        if (string.IsNullOrWhiteSpace(productCode))
        {
            _currentProduct.TryRemove(machineCode, out _);
        }
        else
        {
            _currentProduct[machineCode] = productCode;
        }
    }

    /// <summary>The product <paramref name="machineCode"/> is currently running, or null if none has been
    /// set (machine-scoped config only).</summary>
    public string? CurrentProductFor(string machineCode) =>
        _currentProduct.TryGetValue(machineCode, out var productCode) ? productCode : null;

    // ─────────────────────────────────────────────────────────────────────
    // SETTINGS
    // ─────────────────────────────────────────────────────────────────────
    /// <summary>🔴 E-2 — was <c>FleetHost.GetSettings()</c> returning <c>SettingsDto</c>. E-1 §1.4(10)
    /// flagged that this member takes the LIFECYCLE lock to read four settings fields, and it is exactly why
    /// it could not stay in the shell: four fields plus <see cref="TransportCoordinator.Mode"/> read in ONE
    /// acquisition is a paired read like any other.</summary>
    public FleetSettingsSnapshot GetSettings()
    {
        lock (_gate)
        {
            return new FleetSettingsSnapshot(_serverUrl, _verifyTls, _language, _machineCode, _transportCoordinator.Mode);
        }
    }

    /// <summary>🔴 E-2 — was <c>FleetHost.UpdateSettings(SettingsUpdateRequest)</c>; the four optional fields
    /// are now plain parameters so this class names no request DTO. Everything else is verbatim, including
    /// the two subtleties it would have been easy to "tidy": the persisted triple is captured UNDER
    /// <see cref="_gate"/> (so a concurrent second call can never write a torn mix) while the transport
    /// rebuild below deliberately reads the raw fields OFF the lock, and <see cref="_onLiveSettingsRebuilt"/>
    /// fires between <see cref="TransportCoordinator.RebuildLive"/> and <c>FleetSettingsStore.Save</c>,
    /// exactly where <c>_configSyncCoordinator?.RebuildLive(...)</c> used to sit.</summary>
    public FleetSettingsSnapshot UpdateSettings(string? serverUrl, bool? verifyTls, string? language, string? machineCode)
    {
        bool rebuildNeeded;
        string persistedServerUrl;
        string persistedMachineCode;
        bool persistedVerifyTls;
        lock (_gate)
        {
            rebuildNeeded = false;
            if (serverUrl is not null) { _serverUrl = serverUrl; rebuildNeeded = true; }
            if (verifyTls is not null) { _verifyTls = verifyTls.Value; rebuildNeeded = true; }
            if (machineCode is not null) { _machineCode = machineCode; rebuildNeeded = true; }
            if (language is not null) { _language = language; }

            persistedServerUrl = _serverUrl;
            persistedMachineCode = _machineCode;
            persistedVerifyTls = _verifyTls;
        }

        // 🔴 H-1a — S6, CLOSED, and closed in the ORDER that made it legal. Read the order before touching
        // this: the `finally` below is safe ONLY because the startup replay in St4i.EngineApi/Program.cs was
        // hardened FIRST. Reversing the two ships exactly the boot loop G-2 refused.
        //
        // THE DEFECT, unchanged: the four fields are committed under _gate above and never rolled back, so
        // from the moment that lock is released GetSettings() — and therefore GET /v1/settings — reports the
        // new configuration. Everything below is ACTIVATION and every step of it can throw:
        // CredentialStore.Load is DPAPI plus a file read (and throws ArgumentException outright on an empty
        // machineCode), RebuildLive builds an St4iDeviceClient/HttpClient and touches the WAL directory, and
        // _onLiveSettingsRebuilt is an arbitrary host callback. Before this fix, any of those left the
        // process reporting a configuration it was NOT using and would NOT keep.
        //
        // WHY THE UNIFORM REMEDY WAS REFUSED, AND WHAT CHANGED. G-2 implemented `Save` in a `finally`, then
        // reverted it, and was right to: Program.cs fed FleetSettingsStore.Load() STRAIGHT BACK INTO THIS
        // METHOD during startup, before app.Run(), UNWRAPPED. For an ENVIRONMENTAL failure (a full disk
        // during EnsureDir) persisting is exactly right — the next start retries and succeeds. For a
        // VALUE-DEPENDENT one it was a boot loop: persist machineCode "" and every subsequent start threw
        // ArgumentException out of CredentialStore.Load at the same point, with no running process left to
        // correct it through. That is a property of the REPLAY, not of this method — so the replay is what
        // was fixed. It is now guarded and logs at Error; a triple that cannot be activated leaves the
        // host UP and the operator told. The boot loop is gone as a CONSEQUENCE, which is why this
        // `finally` no longer trades a recoverable failure for an unrecoverable one.
        //
        // 🔴 AND THE RATIONALE BELOW ONLY HOLDS BECAUSE THE REPLAY HAS EXACTLY ONE ARM. Fix round 1 also
        // gave that guard an env-var-floor FALLBACK, as the remedy was sketched — and a fallback replay
        // goes through THIS method, so this `finally` overwrote the operator's fleet-settings.json with
        // the floor. An environmental failure then destroyed the very triple the next start was supposed
        // to retry, which falsified the paragraph you are reading, in the same branch that wrote it. The
        // fallback was removed (see Program.cs for the full argument); what makes "the next start retries
        // and succeeds" TRUE is that nothing else WRITES this file at startup.
        //
        // 🔴 One thing does REMOVE it, and saying "nothing else touches it" would be the same class of
        // false completeness (whole-branch review I-3). On the arm where the replay is a SEED — no
        // fleet-settings.json existed — a failed activation still reaches this `finally`, so the file is
        // CREATED from the env floor merged with FleetHost's defaults, and from the next boot it would
        // win over the env vars on the strength of a triple that never activated. Program.cs deletes it
        // in exactly that case and only that case; a failed RESTORE never deletes anything, because the
        // operator's own file is what branch-review C1 exists to protect. So: ONE writer — the `Save` in
        // the `finally` below, in THIS file — and ONE deleter, at the composition root in Program.cs.
        // Both are counted by StartupSettingsReplayHardeningTests' source census.
        //
        // 🔴 That sentence carried a LINE DISTANCE and it was wrong three times running, in a sentence
        // rewritten twice for exactly this reason. The distance is gone rather than recounted: a pointer
        // that has been wrong three times should stop being a pointer, and "the `finally` below" cannot
        // drift because the thing it names moves with it.
        //
        // 🔴 Both pointers in that sentence were WRONG when first written (branch re-review I-3), in the
        // commit whose subject was this very class: it said both sites are "at the composition root" (the
        // writer is here) and credited the census to `PerHostDataRootsTests`, which contains no such
        // census. Actionable-and-wrong — a maintainer sent to either place finds nothing — and it is the
        // reason the census is named by its own test rather than by a neighbouring file.
        //
        // WHAT THIS CLOSES, precisely, and what it does not. The commit above now ALWAYS owes its
        // persistence, so the reported configuration and the persisted configuration can no longer diverge
        // — that is the S-set property, and it is the same remedy S2/S3/S5 got. It does NOT make a failed
        // activation succeed: within this process the transport is still on the old values while
        // GetSettings() reports the new ones. Making the fields not-diverge-from-the-transport is remedy
        // (a) or (b) below; both change this method's contract and neither is in scope here.
        //
        // THE TWO REMEDIES THAT REMAIN OWNER DECISIONS, and they are NOT what closed S6:
        //   (a) Validate the inputs BEFORE the commit, so a value-dependent failure never mutates the fields
        //       — changes what UpdateSettings does to its state before throwing, which is observable.
        //   (b) Roll the fields back on a failed activation — changes what a failed call MEANS to its caller
        //       and needs an arbitration rule for a rollback racing a concurrent second UpdateSettings,
        //       which this class does not have.
        //
        // 🔴 The remedy that DID close it — harden the replay one layer up — was MISSING from this comment
        // until the whole-branch review, and the omission has a lesson in it: the two remedies still listed
        // above both live in THIS METHOD, and the one that worked lives in Program.cs. Enumerating options
        // from inside the file you are editing finds the options that are inside the file you are editing.
        //
        // 🔴 §8.1(e) — THE `finally` HOLDS EXACTLY ONE STATEMENT, deliberately. A `finally` with two
        // statements is not two guarantees: a throw from the first abandons the second, which is the very
        // window a `finally` is added to close. There is nothing to sequence here, and if anything is ever
        // added below the Save, it must be nested rather than appended.
        //
        // AND THE EXCEPTION-REPLACEMENT DIRECTION, disclosed rather than discovered: if the activation
        // throws AND Save throws, Save's exception REPLACES the activation's. Same direction as S4's row,
        // and the same reason it is acceptable — a caller that sees an IOException out of this call learns
        // that the settings write failed, which is true, and the activation failure it masks is already
        // visible as a transport that did not change.
        if (rebuildNeeded)
        {
            try
            {
                var mkKey = CredentialStore.Load(_machineCode);
                _transportCoordinator.RebuildLive(_serverUrl, _machineCode, mkKey, _verifyTls);
                _onLiveSettingsRebuilt?.Invoke(_serverUrl, _machineCode, mkKey, _verifyTls, _transportCoordinator.Mode);
            }
            finally
            {
                // FF-1 — persist serverUrl/machineCode/verifyTls ONLY (never the mk_ key above, never
                // _language) so this survives a process restart; see FleetSettingsStore's own doc comment
                // for the file-vs-env-var precedence this enables. The values saved are the ones captured
                // under _gate above (this call's own effective triple), not a fresh unsynchronized field
                // read, so a concurrent second UpdateSettings call can never make this write a torn mix of
                // both calls' values.
                _settingsStore?.Save(new PersistedFleetSettings
                {
                    ServerUrl = persistedServerUrl,
                    MachineCode = persistedMachineCode,
                    VerifyTls = persistedVerifyTls,
                });
            }
        }

        return GetSettings();
    }

    /// <summary>🔴 E-2 — the transport half only. <c>FleetHost.ApplyMode</c> was a pure pass-through to TWO
    /// coordinators (E-1 §1.3 row 41 classified it NEITHER, owning no state); the config-sync half stays in
    /// the shell and is called right after this, in the same order, off any lock. This deliberately did NOT
    /// become a callback like <see cref="_onLiveSettingsRebuilt"/>: that one exists because it must fire at a
    /// specific point INSIDE <see cref="UpdateSettings"/>; this one is just two statements in a row, and a
    /// seam for it would have been ceremony.</summary>
    public void ApplyMode(TransportMode mode) => _transportCoordinator.ApplyMode(mode);

    // ─────────────────────────────────────────────────────────────────────
    // FLEET ROSTER — same resolution order as the WPF app's FleetService.LoadFleet/ResolveFleetPath.
    // ─────────────────────────────────────────────────────────────────────
    /// <summary>GP-3 — instance method (not static, as before) purely so a per-entry
    /// <see cref="FleetConfig.Load"/> warning can reach <see cref="_logWarning"/>; called exactly once, from
    /// the constructor, after <see cref="_logWarning"/> is assigned.
    ///
    /// SM-1 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-1-brief.md) —
    /// <see cref="_demoModeGate"/> now decides which of two outcomes this resolves to, reusing the same
    /// demo-vs-product seam <c>Program.cs</c>/<c>ModeEndpoints</c> already key off, rather than inventing a
    /// second one:
    ///  - null (every pre-existing test/call site that constructs <see cref="FleetCore"/> directly) or
    ///    <see cref="St4i.EdgeCore.Config.DemoModeGate.Enabled"/> — byte-identical to this method's
    ///    pre-SM-1 behavior, handled by <see cref="ResolveFleet"/> with <c>demoMode: true</c>.
    ///  - non-null and disabled (a real product deployment) — the roster starts EMPTY. No fleet.json path
    ///    at all (nothing beside the exe, no <c>--fleet</c> arg) is simply an empty roster, same as before
    ///    this task for THAT specific case; a path that DOES resolve is still handed to
    ///    <see cref="ResolveFleet"/> (with <c>demoMode: false</c>) purely so a present-but-broken file
    ///    produces a clear, visible warning instead of being silently ignored outright — but its content
    ///    (valid or not) never populates a product roster; see that method's own remarks.
    /// </summary>
    private IReadOnlyList<MachineDescriptor> LoadFleet()
    {
        var demoMode = _demoModeGate is null || _demoModeGate.Enabled;
        var path = ResolveFleetPath();

        return path is null
            ? (demoMode ? BuildDefaultFleet() : Array.Empty<MachineDescriptor>())
            : ResolveFleet(path, demoMode);
    }

    /// <summary>The shared decision core both branches of <see cref="LoadFleet"/> funnel through once a
    /// <c>fleet.json</c> PATH has actually been resolved (see <see cref="ResolveFleetPath"/>). Factored out
    /// of <see cref="LoadFleet"/> (rather than duplicated per-mode) so the parsing/exception handling is
    /// written — and tested — exactly once. <see langword="internal"/> (not <see langword="private"/>) so
    /// <c>St4i.EngineApi.Tests</c> can drive the malformed-file branch directly against a throwaway temp
    /// file: there is no clean per-test way to reach this same code path through <see cref="LoadFleet"/>
    /// itself without mutating real, shared, concurrently-read process/filesystem state (this assembly's
    /// own <c>fleet.json</c>, sitting beside every test's output directory, and the actual process command
    /// line <see cref="ResolveFleetPath"/> also consults) — which would be flaky under this solution's
    /// parallel test execution.
    ///
    /// <para><paramref name="demoMode"/> <see langword="true"/> (demo): byte-identical to this method's
    /// pre-SM-1 behavior. A <see cref="FleetConfigException"/> (genuinely unparseable JSON) or a
    /// zero-machine result both fall back to <see cref="BuildDefaultFleet"/>, exactly as before — the
    /// exhibition/sales fleet's forgiving "never crash startup over a bad file" contract is unchanged.</para>
    ///
    /// <para><paramref name="demoMode"/> <see langword="false"/> (product): NEVER falls back to
    /// <see cref="BuildDefaultFleet"/> — that would be exactly the "silently show a customer fake machines
    /// that look like production data" bug this task exists to close. A genuinely malformed file logs a
    /// clear warning naming the path and yields an empty roster — never a raw exception, never the demo
    /// fleet. A file that parses FINE but has entries ALSO yields an empty roster (with its own warning
    /// naming the ignored count): fleet.json is a demo-only artifact in product mode — its content is never
    /// a valid way to declare a real machine, only <c>connectors.json</c>/env vars
    /// (via <see cref="RegisterMachine"/>) are.</para></summary>
    internal IReadOnlyList<MachineDescriptor> ResolveFleet(string path, bool demoMode)
    {
        try
        {
            var loaded = FleetConfig.Load(path, logWarning: _logWarning);
            if (loaded.Count > 0)
            {
                if (demoMode) return loaded;

                _logWarning?.Invoke(
                    $"Product mode ignores fleet.json — {loaded.Count} entry(ies) at '{path}' were NOT loaded " +
                    "into the roster. fleet.json only supplies the demo fleet; configure real machines via " +
                    "connectors.json or the ST4I_MODBUS_*/ST4I_OPCUA_* environment variables instead. The " +
                    "roster starts empty.");
                return Array.Empty<MachineDescriptor>();
            }
        }
        catch (FleetConfigException ex)
        {
            if (demoMode)
            {
                // Malformed fleet.json — fall through to the in-code default rather than fail startup.
                _logError?.Invoke(ex, $"Malformed fleet.json at '{path}' — falling back to the in-code default fleet");
                return BuildDefaultFleet();
            }

            _logError?.Invoke(
                ex,
                $"Product mode: fleet.json at '{path}' is malformed and was ignored. fleet.json only supplies " +
                "the demo fleet; configure real machines via connectors.json or the ST4I_MODBUS_*/" +
                "ST4I_OPCUA_* environment variables instead. The roster starts empty.");
            return Array.Empty<MachineDescriptor>();
        }

        return demoMode ? BuildDefaultFleet() : Array.Empty<MachineDescriptor>();
    }

    private static string? ResolveFleetPath()
    {
        var args = Environment.GetCommandLineArgs();
        for (var i = 0; i < args.Length - 1; i++)
        {
            if (string.Equals(args[i], "--fleet", StringComparison.OrdinalIgnoreCase)) return args[i + 1];
        }

        var besideExe = Path.Combine(AppContext.BaseDirectory, "fleet.json");
        return File.Exists(besideExe) ? besideExe : null;
    }

    private static IReadOnlyList<MachineDescriptor> BuildDefaultFleet() =>
    [
        new("SCRW-01", "SN-SCRW01", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening", DriverKinds.Simulated, "RC-SCRW-A", null, 0.6),
        new("SCRW-02", "SN-SCRW02", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening", DriverKinds.Simulated, "RC-SCRW-A", null, 0.8),
        new("DISP-01", "SN-DISP01", DeviceClass.Automation, "DISPENSING", "glue_dispense", DriverKinds.Simulated, "RC-DISP-A", null, 1.0),
        new("WELD-01", "SN-WELD01", DeviceClass.Automation, "WELDER", "spot_weld", DriverKinds.Simulated, "RC-WELD-A", null, 0.9),
        new("ASSY-01", "SN-ASSY01", DeviceClass.Automation, "ASSEMBLY", "press_fit", DriverKinds.Simulated, "RC-ASSY-A", null, 0.7),
        new("LEAK-01", "SN-LEAK01", DeviceClass.Automation, "LEAK_TEST", "leak_test", DriverKinds.Simulated, "RC-LEAK-A", null, 1.2),
        new("FCT-01", "SN-FCT01", DeviceClass.Automation, "FUNCTIONAL_TEST", "functional_test", DriverKinds.Simulated, "RC-FCT-A", null, 1.1),
        new("IOT-01", "SN-IOT01", DeviceClass.Iot, "IOT_SENSOR", "telemetry", DriverKinds.Simulated, null, null, 0.4),
        new("AOI-01", "SN-AOI01", DeviceClass.AoiAvi, "AOI", "inspection", DriverKinds.Simulated, "RC-AOI-A", null, 1.8),
        new("AOI-02", "SN-AOI02", DeviceClass.AoiAvi, "AOI", "inspection", DriverKinds.Simulated, "RC-AOI-A", null, 2.0),
    ];
}
