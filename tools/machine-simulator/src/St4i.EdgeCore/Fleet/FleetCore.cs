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
    /// lock in this class.</b> <see cref="_kpiGate"/> is declared 29 lines below and guards the KPI counters;
    /// the reviewer walked both and confirmed there is <b>no nesting hazard</b> (nothing takes one while
    /// holding the other), so the sentence was wrong, not the locking — but it is this class's lock-discipline
    /// banner, and a banner that overstates is how the next reader stops checking.
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
    /// instrument was a reachability walk from all twenty <c>lock (_gate)</c> regions through their callees,
    /// asking of each "can this reach I/O, <c>Dispose</c> or <c>Cancel</c>" — <b>not</b> a count of
    /// host-supplied code points and not a lexical scan of <c>lock</c> bodies (a lexical scan is precisely
    /// what once reported this invariant intact while it was broken three ways; a host-callback census is
    /// the narrower instrument §8.1(a3) names).</para>
    ///
    /// <para><b>🔴 THE SET IS NINE PATHS. Numbered once, closed and open together, so the headline number
    /// and the list are the same object.</b> (G-1's first draft said "eight" and no grouping of its own list
    /// produced eight — a headline that cannot be reconstructed from the enumeration it summarises is a
    /// defect in the deliverable, since the enumeration IS the deliverable. Corrected by review.)
    ///
    /// <b>Closed by G-1 — 1 to 3:</b>
    /// <list type="number">
    /// <item><b>CLOSED.</b> <see cref="RegisterMachine"/>'s <see cref="_onMachineSeeded"/> — §9.2 violation
    /// 3, the one with the number on it: for a real <c>AssetRegistryStore</c> a complete synchronous SQLite
    /// transaction, and a thread merely reading <see cref="EstopEngaged"/> (the SAME lock
    /// <see cref="Estop"/> takes) was measured blocked up to <b>12.35 ms</b>. Now enqueued under the lock
    /// and invoked off it — see <see cref="DrainSeedNotifications"/>.</item>
    /// <item><b>CLOSED.</b> Log calls under this lock — §10.3(a)'s fourth mechanism, <b>four call sites in
    /// one mechanism</b> (this is where "eight" came from: counting sites here and mechanisms elsewhere).
    /// <see cref="StartLocked"/>'s connector warning and the two <c>MappingProfileResolver.Build</c>
    /// callbacks (up to one per machine), plus <see cref="StopLocked"/>'s cancellation-callback error, all
    /// of which a host wires to its own <c>ILogger</c> and which under <c>AddWindowsService</c> is a
    /// SYNCHRONOUS Event Log write. All four now buffer into a <see cref="DeferredLogEntry"/> list and are
    /// emitted off-lock.</item>
    /// <item><b>CLOSED.</b> <see cref="Burst"/>'s <c>previousCts?.Cancel()</c> — §10.3(d)'s second
    /// <c>Cancel</c>. Moved below the lock.</item>
    ///
    /// <item><b>OPEN — in this class's own code, 4 to 7.</b> <see cref="StartLocked"/> →
    /// <c>MappingProfileResolver.Build</c> → <c>File.Exists</c>/<c>File.ReadAllText</c> per machine — §9.2
    /// violation 1, measured <b>2.39 ms</b> held with 50 machines having mapping files on a local
    /// SSD.</item>
    /// <item><b>OPEN.</b> 🔴 <b>On no prior list, in any batch, and it is a WRITE.</b>
    /// <see cref="StartLocked"/> → <c>SimulatorFactory.Create</c> → <c>SimulatorBase</c>'s constructor →
    /// <c>MachineConfigStore.Ensure</c> → <c>Save()</c> → <c>File.WriteAllText</c> + <c>File.Move</c>. It
    /// fires once per machine that is not yet in the store, i.e. on the first <see cref="Start"/> against a
    /// fresh data root — and it takes a SECOND lock (<c>MachineConfigStore</c>'s own) while this one is
    /// held, on every start thereafter. Every previous count of this backlog was of READ paths. It is also
    /// the throw that made <see cref="RegisterMachine"/>'s drain need a <c>finally</c>.</item>
    /// <item><b>OPEN.</b> <see cref="StopLocked"/> → <c>slot.Cts.Cancel()</c> → a driver's own
    /// <c>ct.Register</c> callback running a <c>Dispose</c> SYNCHRONOUSLY on this thread — §9.2 violation
    /// 2.</item>
    /// <item><b>OPEN.</b> <see cref="StartLocked"/> → <c>ConnectorRegistry.TryCreateDriver</c> → a
    /// THIRD-PARTY <c>IConnectorFactory.TryCreate</c>, which this codebase does not get to bound (documented
    /// at that call site as the one place third-party code runs under this lock, but never on the backlog
    /// list).</item>
    ///
    /// <item><b>OPEN — in a CALLEE's code, 8 and 9, and not fixable from this class.</b>
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
    /// <item><b>OPEN — in a callee's code.</b> <see cref="GetDriverHealth"/> reads <c>Driver.Kind</c> and
    /// <c>Driver.Health</c> under this lock — third-party property getters on
    /// <see cref="St4i.Connector.Abstractions.IDeviceDriver"/>, bounded by contract only.</item>
    /// </list></para>
    ///
    /// <para><b>Where the nine came from.</b> The inherited backlog named <b>five</b> — §9.2's three
    /// violations (1, 4, 6 here) plus §10.3(a)'s log mechanism (2) and §10.3(d)'s second <c>Cancel</c> (3).
    /// Item 7 was documented at its own call site but never on that list. Items <b>5, 8 and 9 were on no
    /// list anywhere</b>. 5 + 1 + 3 = 9.</para>
    ///
    /// <para><b>Why 4 to 7 did not move.</b> 4 and 5 live in the same place and have the same fix: hoist
    /// driver construction out of <see cref="StartLocked"/> entirely. That means reading
    /// <see cref="_fleet"/>/<see cref="_scenario"/> under the lock, building off it, and re-entering — which
    /// introduces a roster-changed-underneath window this class has no answer for today, and silently
    /// degrades a machine registered in that window to <c>MappingProfile.ForClass</c>. 6 would move the halt
    /// path's cancel request after the latch. 7 is third-party code. Each is a redesign of the restart
    /// chokepoint or an operator-observable ordering change, which G-1's brief reserves rather than
    /// delegates.</para>
    ///
    /// <para><b>🔴 A DIFFERENT AXIS, recorded here because nobody had written it down: this lock is held
    /// across FIVE other locks.</b> None of these is an I/O/<c>Dispose</c>/<c>Cancel</c> violation, so none
    /// belongs in the nine — but "which lock may be taken while holding this one" is its own invariant and
    /// it had no home. In acquisition order, always <see cref="_gate"/> first:
    /// <c>MachineConfigStore</c>'s own lock (path 5); <c>TransportCoordinator</c>'s and
    /// <c>SwitchableTransport</c>'s (via <see cref="ApplyNetworkOutageLocked"/>);
    /// <see cref="ConnectorRegistry"/>'s (<c>SnapshotBindings</c>/<c>RegisteredIds</c>/
    /// <c>TryCreateDriver</c>); and the UNS publisher's own lifecycle lock (via
    /// <see cref="IUnsPublisher.PublishNodeBirth"/>/<see cref="IUnsPublisher.PublishNodeDeath"/>). None
    /// inverts today. <see cref="_seedNotifyGate"/> is deliberately NOT in this list and must never join it —
    /// see its own doc comment for the order that genuinely exists there and what keeps it one-way.
    ///
    /// One of these is quieter than it looks: <see cref="ApplyNetworkOutageLocked"/> reaches
    /// <c>TransportCoordinator.ApplyMode</c>, which ends in <c>ModeChanged?.Invoke(mode)</c> — a
    /// HOST-SUBSCRIBED event, i.e. arbitrary code, under this lock. It is dormant only because this call site
    /// passes the coordinator's CURRENT mode, so <c>changed</c> is always false and the event never fires.
    /// That is "benign by a property of the current call site", which is the exact sentence pattern the rest
    /// of this banner warns about — stated plainly rather than relied on silently.</para></summary>
    private readonly object _gate = new();

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
    /// every other lifecycle path.</para></summary>
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
    /// contract. Returns one entry per CURRENTLY live slot (an empty list while the fleet is stopped) —
    /// nothing here reaches into a slot that has been removed; <see cref="Alarms.AlarmEvaluator"/> is what
    /// notices a slot's disappearance (by diffing this list against its own last pass) and clears that
    /// slot's alarms on its behalf.</summary>
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

    /// <summary>🔴 G-1 — what <see cref="StartLocked"/> hands back for its caller to finish OFF
    /// <see cref="_gate"/>: the orphaned connector drivers that must be disposed (review fix round 2) and
    /// the log lines it deferred rather than emitting under the lock. Both halves exist for the same
    /// reason — an operation that reaches outside this process must not run while <see cref="Estop"/>'s
    /// lock is held. See <see cref="CompleteStartOffLock"/>.</summary>
    private readonly record struct StartOutcome(
        List<IDeviceDriver> OrphanedConnectorDrivers,
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
    /// off-lock, exactly as it already did).</summary>
    private void CompleteStartOffLock(StartOutcome outcome)
    {
        FlushDeferredLogs(outcome.DeferredLogs);
        DisposeOrphanedConnectorDrivers(outcome.OrphanedConnectorDrivers);
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
        bool started;
        StartOutcome outcome;
        lock (_gate)
        {
            var wasRunning = IsRunning;
            outcome = StartLocked();
            started = !wasRunning && IsRunning;

            // Review fix (Important) — the NBIRTH call is made HERE, still inside _gate, deliberately: two
            // genuinely concurrent operator calls (e.g. a Start racing a Stop on two threads) could otherwise
            // order the gate-protected transitions one way while off-gate publish calls raced the other way,
            // letting a Stop's NDEATH run before its logically-preceding Start's NBIRTH — hitting the
            // born-guard, no-op'ing, and leaving that birth's NDEATH never sent. Holding _gate across this
            // call is cheap/deadlock-free: PublishNodeBirth only takes the publisher's own _lifecycleGate
            // briefly and does a non-blocking channel TryWrite (no I/O, never calls back into FleetCore), so
            // lock order is always _gate -> _lifecycleGate, never reversed. The historian run-event below
            // stays OUTSIDE _gate — that's a pre-existing async fire-and-forget pattern, unchanged/out of
            // scope here.
            if (started)
            {
                _unsPublisher?.PublishNodeBirth();
            }
        }

        // Review fix round 2 — off-lock, same as WaitAndDisposeOldPipeline below; see
        // DisposeOrphanedConnectorDrivers' own doc comment for why this must never run inside _gate.
        // 🔴 G-1 — now also flushes the log lines StartLocked deferred; same reason, same side of the lock.
        CompleteStartOffLock(outcome);

        if (started)
        {
            _ = _historianWriter?.RecordRunEventFireAndForget("Start");
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
        PipelineHandle handle;
        bool stopped;
        lock (_gate)
        {
            var wasRunning = IsRunning;
            handle = StopLocked();
            stopped = wasRunning && !IsRunning;

            // Review fix (Important) — same reasoning as Start()'s own NBIRTH call: kept inside _gate so the
            // NDEATH's enqueue order is serialized with the transition decision itself, not racing an
            // off-gate concurrent Start's NBIRTH. The historian run-event below stays OUTSIDE _gate
            // (pre-existing async fire-and-forget pattern, unchanged here).
            if (stopped)
            {
                _unsPublisher?.PublishNodeDeath();
            }
        }

        if (stopped)
        {
            _ = _historianWriter?.RecordRunEventFireAndForget("Stop");
        }

        WaitAndDisposeOldPipeline(handle);
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
        PipelineHandle handle;
        lock (_gate)
        {
            handle = StopLocked();
            _estopEngaged = true;

            // Review fix (Important) — same reasoning as Start()/Stop()'s own moved calls: kept inside
            // _gate so this NDEATH is serialized with the transition, never racing an off-gate concurrent
            // Start's NBIRTH. The historian run-event below stays OUTSIDE _gate (pre-existing async
            // fire-and-forget pattern, unchanged here).
            _unsPublisher?.PublishNodeDeath();
        }

        _ = _historianWriter?.RecordRunEventFireAndForget("Estop");
        WaitAndDisposeOldPipeline(handle);
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

    /// <summary>Review fix round 2 — <see cref="StartLocked"/> USED to dispose an orphaned connector
    /// driver (see the connector loop below) inline, synchronously, while <see cref="_gate"/> was held by
    /// every one of its callers. That is a hazard this class's own review has already named twice: a
    /// slow/hung third-party <see cref="IDeviceDriver.DisposeAsync"/> would delay <see cref="Estop"/> — the
    /// exact "blocks the halt call" class of bug <see cref="IConnectorFactory.TryCreate"/>'s own doc comment
    /// warns against for <c>TryCreate</c> itself. <see cref="StartLocked"/> now only COLLECTS orphaned drivers
    /// into the returned list — every caller disposes them via <see cref="DisposeOrphanedConnectorDrivers"/>
    /// AFTER releasing <see cref="_gate"/>, the same "wait/dispose must happen OUTSIDE _gate" discipline
    /// <see cref="WaitAndDisposeOldPipeline"/> already documents for the restart-teardown path. An empty
    /// list (never <see langword="null"/>) is returned on every early-return/no-op path below, so a caller
    /// can unconditionally hand the result to <see cref="DisposeOrphanedConnectorDrivers"/> with no null
    /// check.</summary>
    private StartOutcome StartLocked()
    {
        // 🔴 G-1 — every log line this method would have written while holding _gate lands here instead and
        // is emitted by CompleteStartOffLock after the lock is released. A host wires _logWarning/_logError
        // to its own ILogger, and under AddWindowsService that provider writes the Windows Event Log
        // SYNCHRONOUSLY — so these were genuine I/O calls on the lock Estop() takes, not bookkeeping.
        var deferredLogs = new List<DeferredLogEntry>();

        // Defense in depth: the client already disables START while latched, but the engine itself
        // must refuse too — a stale client, a second panel, or a direct API call must never be able to
        // restart the read pipeline while the HALT latch is still engaged.
        if (IsRunning || _estopEngaged) return new StartOutcome(new List<IDeviceDriver>(), deferredLogs);
        LastError = null;

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
        var startBindings = _connectorRegistry?.SnapshotBindings();
        var simFleet = effectiveFleet
            .Where(d => ResolveSlotLabelForMachine(d, startBindings) == SimulatedSlotLabel).ToList();
        var sims = simFleet.Select((d, i) => SimulatorFactory.Create(d, seed: 1000 + i, _configStore, CurrentProductFor, multiplier, _productConfigStore)).ToList();

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
        var mappingDir = Path.Combine(AppContext.BaseDirectory, "mapping");
        // 🔴 G-1 — the resolver's two callbacks are BUFFERED, not wired straight to _logWarning/_logError.
        // MappingProfileResolver.Build resolves every descriptor eagerly on THIS thread (see its own doc
        // comment: Resolve is a pure dictionary lookup afterwards), so both delegates only ever run here,
        // under _gate — which is exactly what makes them a per-machine Event Log write on the halt path.
        // Buffering keeps the messages, the order and the channel choice identical and moves only the I/O.
        var mappingResolver = MappingProfileResolver.Build(
            effectiveFleet,
            mappingDir,
            logWarning: msg => deferredLogs.Add(new DeferredLogEntry(null, msg)),
            logError: (ex, msg) => deferredLogs.Add(new DeferredLogEntry(ex, msg)));

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
            groups.Add((SimulatedSlotLabel, driver, profile, mappingResolver.Resolve));
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
        // deliberately NOT surfaced through LastError (that property is reserved for a slot that started
        // and later faulted at RUNTIME — see StartSlot's catch below; touching it here would flip
        // GET /v1/health unhealthy merely because an optional peripheral's config is bad, which is not
        // today's behavior and is not this task's to change) — only a log warning, so the failure is
        // visible without being mistaken for the whole fleet's health.
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
        var orphanedConnectorDrivers = new List<IDeviceDriver>();
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

        return new StartOutcome(orphanedConnectorDrivers, deferredLogs);
    }

    /// <summary>Review fix round 2 — the off-lock counterpart to <see cref="StartLocked"/>'s orphan
    /// collection: every <see cref="StartLocked"/> caller invokes this AFTER releasing <see cref="_gate"/>,
    /// mirroring <see cref="WaitAndDisposeOldPipeline"/>'s own "wait/dispose must happen OUTSIDE _gate"
    /// discipline exactly (same reasoning: <see cref="Estop"/> takes <see cref="_gate"/> too, and a
    /// slow/hung third-party <see cref="IDeviceDriver.DisposeAsync"/> must never delay a caller's
    /// <see cref="Estop"/> call from returning). Best-effort and per-driver BOUNDED
    /// (<see cref="RestartTeardownTimeout"/>, same budget
    /// <see cref="WaitAndDisposeOldPipeline"/> uses) — a driver whose <c>DisposeAsync</c> throws or hangs
    /// past that bound cannot wedge this method or any other orphan's own disposal.</summary>
    private void DisposeOrphanedConnectorDrivers(IReadOnlyList<IDeviceDriver> orphans)
    {
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
                _logDebug?.Invoke(ex, "FleetCore orphaned connector driver dispose observed a fault");
            }
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
                _logError?.Invoke(ex, $"FleetCore pipeline slot '{label}' faulted");

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
        if (!_running) return default;
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
    /// cancels/closes its own <c>TcpClient</c>).</summary>
    private void WaitAndDisposeOldPipeline(PipelineHandle handle)
    {
        // 🔴 G-1 — first thing off the lock: emit whatever StopLocked deferred. Enumerated, not assumed:
        // StopLocked has exactly four callers — Stop, Estop, RegisterMachine and ApplyScenario — and all
        // four pass the handle it returns to THIS method with _gate released. Nothing else calls StopLocked
        // (Start does not), so no deferred line can be stranded. Placed before the OldSlots null-return
        // because a handle can legitimately carry lines and no slots is not a case that arises today, and
        // relying on that would be a property of the current call sites rather than of this method.
        FlushDeferredLogs(handle.DeferredLogs);

        if (handle.OldSlots is null) return;

        foreach (var slot in handle.OldSlots)
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
                    _logDebug?.Invoke(ex, "FleetCore old pipeline slot teardown wait observed a faulted task");
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
                _logDebug?.Invoke(ex, "FleetCore old pipeline slot driver dispose observed a fault");
            }

            slot.Cts.Dispose();
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

        lock (_gate)
        {
            if (_fleet.Any(d => string.Equals(d.Code, descriptor.Code, StringComparison.OrdinalIgnoreCase)))
            {
                return false;
            }

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
        // reachable through the very path G-1's own enumeration turned up (path B: StartLocked ->
        // SimulatorFactory.Create -> SimulatorBase's ctor -> MachineConfigStore.Ensure, which throws
        // InvalidOperationException on a config-kind mismatch and IOException from its File.WriteAllText/
        // File.Move on a full or read-only data root). Without the finally, that throw leaves the machine in
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
        // that RegisterMachine has four call sites in this tree (ConnectorEndpoints' single-machine and
        // RTU-bus paths, OnboardingFleetJoin, and Program.cs's three seed registrations) and NONE of them
        // wraps it in try/catch at all: every one consumes the bool return and lets any exception propagate.
        // So no caller branches on the exception type TODAY. That is a property of the current call sites,
        // not of this method — so if a caller ever does branch, capture-and-aggregate (hold the restart
        // fault, run the drain, throw an AggregateException when both fired) is the fix, and it is
        // deliberately not done here because it would be a behaviour change with no test behind it.
        try
        {
            if (restarting)
            {
                WaitAndDisposeOldPipeline(restartHandle);
                StartOutcome outcome;
                lock (_gate) { outcome = StartLocked(); }
                // Review fix round 2 — off-lock, same reasoning as WaitAndDisposeOldPipeline just above.
                CompleteStartOffLock(outcome);
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
            }
        }

        // Completion-review #1/#7 — same off-lock wait-then-restart shape as RegisterMachine above;
        // see its doc comment for the full deadlock/identity-guard reasoning.
        if (restarting)
        {
            WaitAndDisposeOldPipeline(restartHandle);
            StartOutcome outcome;
            lock (_gate) { outcome = StartLocked(); }
            // Review fix round 2 — off-lock, same reasoning as WaitAndDisposeOldPipeline just above.
            CompleteStartOffLock(outcome);
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
        // RevertBurstAfterDelayAsync (below) was never started — the next Burst then sees previousCts != null
        // and does not re-capture _burstBaseline. Unreachable today (the only registration on this token is
        // Task.Delay's own, which does not throw), and the pre-G-1 order was differently broken on the same
        // path (the throw escaped while _gate was held, aborting the whole method mid-mutation). Named
        // because "no registration throws" is a property of the current callee, not of this method.
        previousCts?.Cancel();

        var applied = ApplyScenario(_scenario with { CycleRateMultiplier = BurstMultiplier }, presetName: "burst");
        _ = RevertBurstAfterDelayAsync(baseline, cts);
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
            ApplyScenario(_scenario with { CycleRateMultiplier = baseline }, presetName: _activePresetName);
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

        if (rebuildNeeded)
        {
            var mkKey = CredentialStore.Load(_machineCode);
            _transportCoordinator.RebuildLive(_serverUrl, _machineCode, mkKey, _verifyTls);
            _onLiveSettingsRebuilt?.Invoke(_serverUrl, _machineCode, mkKey, _verifyTls, _transportCoordinator.Mode);

            // FF-1 — persist serverUrl/machineCode/verifyTls ONLY (never the mk_ key above, never
            // _language) so this survives a process restart; see FleetSettingsStore's own doc comment for
            // the file-vs-env-var precedence this enables. The values saved are the ones captured under
            // _gate above (this call's own effective triple), not a fresh unsynchronized field read, so a
            // concurrent second UpdateSettings call can never make this write a torn mix of both calls'
            // values.
            _settingsStore?.Save(new PersistedFleetSettings
            {
                ServerUrl = persistedServerUrl,
                MachineCode = persistedMachineCode,
                VerifyTls = persistedVerifyTls,
            });
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
