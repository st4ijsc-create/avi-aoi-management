using St4i.Connector.Abstractions.Models;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Fleet;
using St4i.EngineApi.Policy;

namespace St4i.EngineApi.Alarms;

/// <summary>
/// 🔴 Task C-6 — a point-in-time snapshot of <see cref="RelayNotificationChannel"/>'s counters. Cumulative
/// since process start. C-7 surfaces these next to <see cref="AlarmNotifierStats"/>,
/// <see cref="WebhookChannelStats"/>, <see cref="SmtpChannelStats"/> and
/// <see cref="LocalAnnunciationStats"/>.
///
/// <para>🔴 <b>The accounting invariant, the same one C-3/C-4/C-5 hold and by the same construction.</b> For
/// every (notification, configured relay instance) pair this channel sees, EXACTLY ONE of
/// <paramref name="Suppressed"/>, <paramref name="Unchanged"/>, <paramref name="Applied"/>,
/// <paramref name="Rejected"/>, <paramref name="Failed"/>, <paramref name="Indeterminate"/>,
/// <paramref name="Refused"/>, <paramref name="MachineNotFound"/>, <paramref name="NoLiveDriver"/>,
/// <paramref name="ReadOnly"/>, <paramref name="AmbiguousDriver"/>, <paramref name="ReleaseUnsupported"/>,
/// <paramref name="Misconfigured"/> and <paramref name="Lost"/> moves; <paramref name="Cancelled"/> is
/// reached only by re-throwing, and <paramref name="RateLimited"/> is a GAUGE that rides alongside an
/// outcome rather than being one. One <c>switch</c> over a fourteen-member outcome is the only thing in the
/// class that touches the first fourteen.</para>
///
/// <para>🔴 <b>Why the list is so much longer than the other three channels', and why NONE of it may be
/// collapsed.</b> A webhook's world is "delivered or not". This channel's world is Đợt B's, and Đợt B spent
/// a whole task establishing that the four not-available cases and the four write outcomes are DIFFERENT
/// FACTS with different people who might need to act — a mistyped machine code, a stopped fleet, a
/// read-only connector, and an ambiguous roster are four different fixes. Folding them into one "failed"
/// here would undo that one layer up, which is precisely the flattening Đợt B's review was about.</para>
/// </summary>
/// <param name="Considered">Notifications handed to this channel by C-1's drain loop, before any
/// filtering.</param>
/// <param name="Suppressed">(notification, instance) pairs that were never a latch input: the instance is
/// disabled, the alarm is less severe than its minimum priority, or the edge is an
/// <see cref="AlarmEdgeKind.Acked"/> (which deliberately does NOT release this latch — see
/// <see cref="RelayNotificationChannel"/>). NOT a loss.</param>
/// <param name="Unchanged">🔴 (notification, instance) pairs that WERE a latch input and changed nothing —
/// the second alarm of a storm arriving while the beacon is already lit. <b>This is the counter that proves
/// the channel is edge-driven rather than tick-driven</b>: on a fleet with one standing alarm it grows once
/// per real edge and the coil is never touched again.</param>
/// <param name="Applied">Writes the driver reported as <see cref="WriteOutcome.Applied"/>. The only outcome
/// after which this channel believes it knows the coil's state.</param>
/// <param name="Rejected">Writes the driver refused BEFORE touching the device
/// (<see cref="WriteOutcome.Rejected"/>) — an unknown point, a point the map declares read-only, or a value
/// outside the point's declared range. The map doing its job. Never retried; the configuration is wrong and
/// retrying will not fix it.</param>
/// <param name="Failed">Writes the driver reported as definitively not applied
/// (<see cref="WriteOutcome.Failed"/>). Never retried — B-1 forbids implicit retries on ANY write outcome,
/// and this channel does not second-guess it.</param>
/// <param name="Indeterminate">
/// 🔴 Writes after which <b>nobody knows whether the coil moved</b> (<see cref="WriteOutcome.Indeterminate"/>).
///
/// <para>B-1 made this first-class precisely because a timed-out write does not tell you whether the device
/// applied it, and collapsing that into "failed" reads as "safe to try again". <b>It is not re-issued</b>,
/// and the state moves in two halves: <see cref="RelayInstanceState.Commanded"/> takes the level that WAS
/// issued (so the same level is never issued again — that is what no-retry means, and it is what keeps the
/// latch absorbing a storm behind an indeterminate write), while
/// <see cref="RelayInstanceState.Energised"/> becomes UNKNOWN (nobody knows what the device did).
///
/// <para>🔴 Review round 1 (C-1) found this the hard way: gating the write on <c>Energised</c> meant that
/// after ONE indeterminate write every subsequent latch input wrote again — 20 distinct alarms in one
/// episode produced 20 writes instead of 1, and for a <see cref="RelayTargetKind.Command"/> target every one
/// of those is a real actuation. The class doc was right and the code was wrong.</para></param>
/// <param name="Refused">🔴 Attempts the Đợt B gate REFUSED before any I/O — overwhelmingly "the HALT latch
/// is engaged". Not an error and not a loss: it is the batch's one non-negotiable invariant working. See
/// <see cref="RelayNotificationChannel"/> for what an operator sees, and for why a refused OFF write leaves
/// this channel believing the beacon is still ON.</param>
/// <param name="MachineNotFound">The configured machine code is in no roster member — an operator typo, or
/// a machine that was never onboarded. No I/O attempted.</param>
/// <param name="NoLiveDriver">The roster knows the machine but nothing is driving it right now — the fleet
/// is stopped, or its connector failed to start. No I/O attempted.</param>
/// <param name="ReadOnly">A live driver exists and cannot write at all. The configuration names a machine
/// whose connector has no write capability. No I/O attempted.</param>
/// <param name="AmbiguousDriver">More than one roster member resolves to the same live connector, so Đợt B
/// refuses to write rather than risk reaching the wrong physical machine. No I/O attempted.</param>
/// <param name="ReleaseUnsupported">🔴 The latch RELEASED on a <see cref="RelayTargetKind.Command"/> target.
/// A command is an argument-less pulse and there is no "un-pulse"; this channel says so with a counter and a
/// warning rather than pretending it de-energised something. See
/// <see cref="RelayNotificationChannel"/>.</param>
/// <param name="Misconfigured">A <see cref="RelayTargetKind.Point"/> instance whose stored latch value is
/// missing or unparseable. <see cref="NotificationConfigStore.SaveRelayAsync"/> refuses to create that
/// state, so reaching it means a hand-edited database or a row written before schema v3.</param>
/// <param name="Lost">(notification, instance) pairs lost to an internal fault, including a configuration
/// that <see cref="NotificationConfigStore.ListAsync"/> listed and
/// <see cref="NotificationConfigStore.GetRelayAsync"/> could not then read back.</param>
/// <param name="Cancelled">Notifications abandoned because the process is shutting down. Its unit is the
/// NOTIFICATION, not the pair.</param>
/// <param name="RateLimited">🔴 A GAUGE, not an outcome: how many writes had to WAIT for the minimum
/// inter-write interval before being performed. Non-zero means a storm was genuinely being throttled. The
/// write still happened — this limiter delays, it never drops, because a dropped release leaves a beacon
/// lit.</param>
public sealed record RelayChannelStats(
    long Considered,
    long Suppressed,
    long Unchanged,
    long Applied,
    long Rejected,
    long Failed,
    long Indeterminate,
    long Refused,
    long MachineNotFound,
    long NoLiveDriver,
    long ReadOnly,
    long AmbiguousDriver,
    long ReleaseUnsupported,
    long Misconfigured,
    long Lost,
    long Cancelled,
    long RateLimited);

/// <summary>🔴 Task C-6 — what this channel currently believes about ONE configured relay instance. A
/// gauge, exposed so C-7 can render "is the beacon lit?" without asking the device (which would be a second
/// machine round trip per page load) and — more importantly — so an operator can see the one state that
/// matters after a refused write: <see cref="Energised"/> still <see langword="true"/> while the alarm list
/// is empty means the product asked for the beacon to go out and was refused.</summary>
/// <param name="Instance">The configured instance key.</param>
/// <param name="LatchedAlarms">How many qualifying alarm keys are currently active for this instance. The
/// latch is asserted iff this is greater than zero.</param>
/// <param name="Commanded">
/// 🔴 Review round 1 (C-1) — the level this channel last ISSUED A WRITE FOR, which is a different question
/// from <see cref="Energised"/> and is the one the write gate asks.
///
/// <para>It moves on <see cref="WriteOutcome.Applied"/> AND on <see cref="WriteOutcome.Indeterminate"/>,
/// because in both cases a write for that level reached the device and <b>must not be issued again</b> —
/// that is what "no retry" means. It does NOT move on <see cref="WriteOutcome.Failed"/>,
/// <see cref="WriteOutcome.Rejected"/>, a policy refusal or an unresolvable driver, because nothing reached
/// the device and the next edge should try again.</para></param>
/// <param name="Energised">🔴 What this channel BELIEVES the annunciator is doing: <see langword="true"/> =
/// last successfully commanded ON; <see langword="false"/> = OFF; <see langword="null"/> = <b>UNKNOWN</b> —
/// either nothing has been commanded in this process yet, or the last write came back
/// <see cref="WriteOutcome.Indeterminate"/>. Never inferred from the device, and deliberately NOT what the
/// write gate consults — see <paramref name="Commanded"/>.</param>
/// <param name="LastAttemptUtc">When a write was last ATTEMPTED (including one the gate refused), which is
/// what the rate limiter measures from.</param>
public sealed record RelayInstanceState(
    string Instance,
    int LatchedAlarms,
    bool? Commanded,
    bool? Energised,
    DateTimeOffset? LastAttemptUtc);

/// <summary>
/// 🔴 Task C-6 (.superpowers/sdd/2026-07-30-dotC-alarm-notification-blueprint/task-6-brief.md) — <b>the only
/// channel in this product where a notification moves something physical.</b> A beacon or a horn, driven
/// automatically from the alarm stream, with no human in the loop.
///
/// <para>🔴🔴 <b>THIS IS NOT A SAFETY DEVICE.</b> A real annunciator that must work when everything else has
/// failed is a hardwired circuit (ISO 13849 Cat 3/4). This is an ordinary machine write on an ordinary
/// software path: it is subject to the HALT latch, to the register map's own limits, to a network that may
/// be down, and to this process being alive. <b>Anyone who needs a light or a horn that works while HALT is
/// engaged, or while this software is not running, must hardwire it — not route it through this
/// product.</b> Nothing in this class, its configuration, its logs or its UI may be worded to suggest
/// otherwise.</para>
///
/// <h3>The one rule this channel does not bend</h3>
/// <para>🔴 <b>The write goes through the full Đợt B gate, intact, under the SAME action ids a human uses.</b>
/// <see cref="MachineWriteGate.SetpointAction"/> for a point, <see cref="MachineWriteGate.CommandAction"/>
/// for a command — evaluated by the SAME <see cref="PolicyEngine"/> singleton the HTTP endpoints use, which
/// means <see cref="Policy.Rules.EstopGuardRule"/>, <see cref="Policy.Rules.CriticalAlarmGuardRule"/> and
/// <see cref="Policy.Rules.RoleObligationRule"/> all run, and any rule added later runs too without this
/// class being edited. <b>HALT latched ⇒ the beacon does not light.</b></para>
///
/// <para>🔴 <b>Review round 1 (I-1) — but only ONE of those three rules can actually deny this caller, and
/// saying "all three run" without saying that reads as defence-in-depth that is not there.</b>
/// <list type="bullet">
/// <item><description><see cref="Policy.Rules.EstopGuardRule"/> — <b>the sole enforcement</b>. Nothing below
/// it re-checks the halt latch: <c>FleetHost.TryWriteSetpointAsync</c> does not consult it, so if this rule
/// did not deny, the write would reach the device.</description></item>
/// <item><description><see cref="Policy.Rules.CriticalAlarmGuardRule"/> — <b>structurally inert here</b>,
/// because this caller resolves <see cref="PolicyRequest.CriticalAlarmActive"/> as a literal
/// <see langword="false"/> (the derivation is below). It runs and always returns "does not
/// apply".</description></item>
/// <item><description><see cref="Policy.Rules.RoleObligationRule"/> — <b>can never deny this caller</b>,
/// because <see cref="MachineWriteGate.ActionFor"/> and <see cref="MachineWriteGate.RoleFor"/> switch on the
/// same <see cref="RelayTargetKind"/>: the relay always presents exactly the role its own action requires.
/// It is a real check that this caller cannot fail by construction, which is not the same as a check that
/// protects it.</description></item>
/// </list>
/// The value of going through the engine is therefore NOT redundancy — it is that the HALT check is the
/// engine's, under the same action id a human uses, so it cannot drift from the human path and any rule
/// added later applies here automatically.</para>
///
/// <para>The reason is not ceremony. <b>The system cannot know that a coil an operator declared
/// <c>annunciator</c> is a beacon rather than a conveyor.</b> The register map IS the safety boundary — Đợt
/// B settled that — and this class lets an AUTOMATIC process write through it. Inventing a private action id
/// so the automatic write could skip a rule would be exactly the second, unvalidated boundary C-2 refused to
/// create for addresses. Using the same ids also makes the coupling testable rather than asserted:
/// <c>RelayNotificationChannelTests</c> proves the rules deny those exact strings.</para>
///
/// <h3>🔴 The ONE fact this channel resolves differently from the HTTP endpoint, and the derivation</h3>
/// <para><see cref="PolicyRequest.CriticalAlarmActive"/> is, by Đợt B's own design, resolved <b>by the
/// caller</b> before the engine ever runs (it is an async fact from another subsystem, and every
/// <see cref="IPolicyRule"/> must stay synchronous). B-6 already resolves it with a deliberate exclusion —
/// <see cref="AlarmSource.Policy"/> alarms are left out, because a Policy alarm records a refusal the same
/// request path just wrote rather than an independent observation about the plant, and counting it in
/// produced a genuine self-latch. <b>This channel resolves the same fact as <c>false</c>, and the derivation
/// is short enough to check:</b></para>
/// <list type="number">
/// <item><description><see cref="AlarmPriority"/> is declared most-severe-first with
/// <c>Critical = 0</c>, and <see cref="NotificationDelivery.MeetsThreshold"/> is <c>priority &lt;= min</c>.
/// Therefore <b>a Critical alarm meets EVERY relay threshold</b>, whatever an operator configured.</description></item>
/// <item><description>So every Critical alarm is, by construction, one this relay is itself annunciating —
/// it is the INPUT to this write, never an independent reason to withhold it.</description></item>
/// <item><description>Resolving it as <see langword="true"/> would therefore make a relay configured at
/// <see cref="AlarmPriority.Critical"/> — the headline configuration — <b>structurally incapable of ever
/// lighting</b>: the very alarm that should light the beacon is the one that blocks the write. Not "rarely
/// fires"; never fires. A beacon that is guaranteed dark exactly when the plant is in its worst state is
/// worse than no beacon, because a dark beacon reads as "no alarm".</description></item>
/// </list>
/// <para>The premise is PINNED by a test (<c>ACriticalAlarmMeetsEveryRelayThreshold_…</c>) rather than
/// assumed: if a priority above Critical is ever added, or the threshold comparison changes, that test goes
/// red and this derivation must be redone. <b>This is a caller resolving a caller-resolved fact — the seam
/// B-6 built and itself used — not an exception carved into a rule.</b>
/// <see cref="Policy.Rules.CriticalAlarmGuardRule"/> is untouched and still applies in full to every HTTP
/// write. It is nonetheless the one place where the automatic path is more permissive than the human one,
/// which is stated here rather than buried.</para>
///
/// <h3>The latch, and the energise/de-energise decision</h3>
/// <para><b>Edge-driven, not tick-driven, and stateful.</b> Each instance keeps the SET of qualifying alarm
/// keys that are currently active. The latch is asserted iff that set is non-empty. A write happens only
/// when the DERIVED level differs from the level this channel last ISSUED A WRITE FOR
/// (<see cref="RelayInstanceState.Commanded"/> — <b>not</b>
/// <see cref="RelayInstanceState.Energised"/>; review round 1's Critical was exactly that confusion) — so a
/// hundred alarms raising produce ONE energise, and the 5 s evaluator re-raising the same alarm forever
/// produces none at all (C-1's edge detector never even hands those over). <b>That absorption holds after an
/// <see cref="WriteOutcome.Indeterminate"/> write too</b>, which is the whole reason the two are separate
/// pieces of state.</para>
/// <list type="bullet">
/// <item><description><see cref="AlarmEdgeKind.Raised"/>/<see cref="AlarmEdgeKind.Escalated"/>/
/// <see cref="AlarmEdgeKind.Restored"/> ADD the key (if it meets the threshold).
/// <see cref="AlarmEdgeKind.Restored"/> is what relights the beacon after a restart into standing
/// alarms — the case C-1's adopt-and-announce decision exists for.</description></item>
/// <item><description><see cref="AlarmEdgeKind.Cleared"/> REMOVES the key, <b>unconditionally — without
/// re-checking the threshold</b>. A key can only be in the set because it passed the threshold on the way
/// in, so re-filtering here could only ever fail to remove one, and a key that cannot be removed is a
/// beacon that never goes out.</description></item>
/// <item><description>🔴 <see cref="AlarmEdgeKind.Acked"/> does <b>NOT</b> release the latch, and this is a
/// decision rather than an omission. ISA-18.2's ack means "silence the horn", and C-5's local annunciation
/// honours it — because C-5 KNOWS it is driving a sound. This channel does not know what it is driving: the
/// same coil that is a horn on one machine is a lamp on the next, and extinguishing a LAMP because somebody
/// acknowledged the alarm hides a condition that is still live. The latch therefore tracks the alarm's
/// EXISTENCE, not the operator's attention. (An ack of an <see cref="Alarm.ClearOnAck"/> alarm — every
/// <see cref="AlarmSource.Policy"/> denial — still releases it, because C-1 reports that as a
/// <see cref="AlarmEdgeKind.Cleared"/>: the row really is gone.) An operator who needs ack-to-silence needs
/// an acknowledge circuit in the panel, not a software latch.</description></item>
/// </list>
/// <para><b>The values.</b> A <see cref="RelayTargetKind.Point"/> target carries an explicit
/// energise and de-energise value (schema v3 — see <see cref="RelayChannelConfig.OnValueJson"/>); there is
/// deliberately no default, because a default is this product choosing what to write to a coil it cannot
/// identify. A <see cref="RelayTargetKind.Command"/> target carries none: it PULSES on assert and
/// <b>cannot release</b>, which is counted as <see cref="RelayChannelStats.ReleaseUnsupported"/> and warned
/// about rather than silently ignored. A command target is right for a horn; a latching beacon needs a
/// point.</para>
///
/// <h3>Rate limiting — the first in this product</h3>
/// <para>Đợt B deferred rate limiting on its command endpoint and named it the top carried debt; this pays
/// part of it, for the one caller that can fire without a human. <see cref="DefaultMinWriteInterval"/> is
/// the minimum wall-clock gap between two write ATTEMPTS on one instance. It <b>delays, it never
/// drops</b>: a limiter that discarded a write could discard a RELEASE, and a beacon left lit is exactly
/// the failure this whole channel is supposed to prevent.</para>
/// <para>Note what the latch already does and what is therefore left for the limiter: a raise storm is
/// absorbed entirely by the latch (a hundred raises are one write), so the limiter only bites on FLAPPING —
/// a condition that raises and clears repeatedly, or alarm episodes back to back. 2 s is below any
/// edge rate the alarm engine can legitimately produce (<see cref="AlarmThresholds.EvalIntervalMs"/> is
/// 5 s), so in normal operation it never delays anything; under a pathological flap it bounds the coil at
/// 0.5 Hz, which a contactor tolerates indefinitely. The visible cost, stated rather than hidden: two alarm
/// episodes back to back can leave the beacon dark for up to one interval between them.</para>
/// <para><b>The seam for C-7 is a seam, not an implementation.</b> C-7 owns the ENDPOINT limiter (a
/// different thing: it bounds what a human or a script may ask for over HTTP, and it must distinguish "N
/// legitimate writes" from "one stuck script"). This limiter bounds only what THIS channel emits, is keyed
/// by relay instance, and is injectable — so C-7 can tighten it from configuration without reshaping
/// anything here.</para>
///
/// <h3>Failure modes, each decided</h3>
/// <list type="bullet">
/// <item><description>🔴 <b>The beacon is on and the process dies: it stays on. That is deliberate.</b> Two
/// reasons. (a) For an annunciator, failing DARK is strictly worse than failing LIT: a dark beacon is read
/// as "no alarm" and is indistinguishable from a healthy quiet plant, whereas a stuck-lit beacon sends
/// somebody to look — a false positive costs a walk, a false negative costs the thing the beacon exists to
/// prevent. (b) De-energising on exit could only ever work for a GRACEFUL exit; a power cut or a kill leaves
/// the coil exactly as it was. A guarantee that holds in the easy case and fails in the hard one is not a
/// guarantee, and it would make the beacon's meaning depend on how the process happened to die. So the coil
/// means one thing in all cases: <i>this product last commanded ON and has not since observed everything
/// clear.</i>
/// <para><b>What an operator has to do about it.</b> On restart the latch is re-derived from
/// <see cref="AlarmEdgeKind.Restored"/> and, because <see cref="RelayInstanceState.Commanded"/> starts
/// UNKNOWN, the first derived level is written unconditionally — so a restart into standing alarms re-asserts
/// ON, and the eventual clear writes OFF. The residual case is a beacon lit by a process that died while the
/// alarms cleared underneath it AND whose relay was disabled or reconfigured before the restart: then
/// nothing re-derives, and it stays lit until an alarm episode runs to completion or somebody de-energises
/// the coil by hand. That case is visible — <see cref="RelayInstanceState.Energised"/> reads
/// <see langword="null"/> with an empty <see cref="RelayInstanceState.LatchedAlarms"/> — and C-7's "send
/// test" is the affordance that resolves it.</para></description></item>
/// <item><description>🔴 <b>Review round 1 (m-3) — a relay ENABLED part-way through an alarm episode never
/// lights for it, and its eventual clear writes OFF to a coil this product never lit.</b> The latch is built
/// from EDGES and there is no backfill, so an alarm that raised before the instance was enabled is not in the
/// latch set; the first thing the instance sees is that alarm's <see cref="AlarmEdgeKind.Cleared"/>, which
/// removes nothing, derives OFF, and — because <see cref="RelayInstanceState.Commanded"/> is still UNKNOWN —
/// is written unconditionally. So the unconditional first write is NOT only the restart re-assert: it is also
/// what makes a mid-episode enable converge, and the price is one de-energise of an already-dark annunciator.
/// Writing OFF to something already off is idempotent for a
/// <see cref="RelayTargetKind.Point"/> target and impossible for a <see cref="RelayTargetKind.Command"/> one
/// (which cannot release at all), so the cost is a spurious audit row rather than an actuation — but it is a
/// real, reachable behaviour and it is enumerated here rather than discovered. The alternative, seeding the
/// latch from <c>active_alarms</c> at enable time, needs a store read this channel deliberately does not
/// have (see the <see cref="PolicyRequest.CriticalAlarmActive"/> derivation) and an enable-time hook that
/// only C-7 can provide.</description></item>
/// <item><description>🔴 <b>Review round 1 (m-4) — a <see cref="AlarmEdgeKind.Cleared"/> edge EVICTED from
/// this channel's own saturated queue leaves its key latched forever.</b> C-6's per-channel queues are
/// <see cref="System.Threading.Channels.BoundedChannelFullMode.DropOldest"/>, so under sustained saturation
/// an edge is lost; losing a <c>Cleared</c> means the key is never removed, the latch never empties, and for
/// a non-recurring alarm nothing later re-derives it — the same end state as the process-death residual
/// above, and with the same remedy. Remote rather than theoretical: it needs roughly
/// <see cref="AlarmNotifier.DefaultCapacity"/> queued edges against a consumer this channel deliberately
/// rate-limits to 0.5 Hz. It is not silent — the loss is counted on
/// <see cref="AlarmNotifierChannelStats.Dropped"/> for the <c>Relay</c> channel by name, which is exactly
/// what the per-channel split was built to make visible.</description></item>
/// <item><description>🔴 <b>HALT is latched while the beacon is on: the gate refuses the OFF write too, and
/// this channel does NOT pretend otherwise.</b> No exception is carved for the release — the rule has no
/// exceptions, and a rule with one exception is a rule that will get a second. So the OFF write is
/// <see cref="RelayChannelStats.Refused"/>, and — the part that matters —
/// <see cref="RelayInstanceState.Energised"/> is <b>left at <see langword="true"/></b>, because the beacon
/// really is still on. The product never believes the beacon is off while it is on. What the operator sees:
/// a <c>Warning</c> naming the machine, the point, and the fact that the annunciator is STILL ENERGISED and
/// will stay that way until the latch is reset; an audit row under this channel's own identity; and, in C-7,
/// <c>Energised = true</c> beside an empty alarm list. When HALT is reset, the next edge finds
/// <see cref="RelayInstanceState.Commanded"/> still disagreeing with the (empty) latch set and writes
/// OFF.</description></item>
/// <item><description>The declared point does not resolve, or the machine is not in the roster: all four of
/// Đợt B's cases are counted separately and none is collapsed — see
/// <see cref="RelayChannelStats.MachineNotFound"/> and its three neighbours.</description></item>
/// <item><description>The write returns <see cref="WriteOutcome.Rejected"/> because a limit in the map
/// refuses the value: counted, logged with the driver's own rejection reason, and not re-issued for that
/// edge. Neither half of the state moves, because nothing was written — so the NEXT edge attempts it again,
/// deliberately: a rejection is a statement about the configuration, and an operator who fixes the point's
/// declared range must not also have to manufacture a level transition to get the beacon
/// working.</description></item>
/// <item><description>🔴 <see cref="WriteOutcome.Indeterminate"/>: <b>never re-issued, reported as itself,
/// and the two halves of the state move differently</b> —
/// <see cref="RelayInstanceState.Commanded"/> moves (a write for that level was issued and must not be
/// issued again) while <see cref="RelayInstanceState.Energised"/> becomes UNKNOWN (nobody knows what the
/// device did). See <see cref="RelayChannelStats.Indeterminate"/>.</description></item>
/// </list>
///
/// <h3>Shape</h3>
/// <para>Behind C-1's <see cref="AlarmNotifier"/>, on <b>its own</b> drain thread — Task C-6's per-channel
/// queues exist for this channel above all others, so that a dead webhook cannot hold a beacon dark. Reads
/// its configuration on every notification rather than caching, the same decision C-3/C-4/C-5 made and for
/// the same reason. Never throws, with the single deliberate exception of a genuine shutdown
/// <see cref="OperationCanceledException"/>, which C-1's drain loop counts as a drop. Does not call back
/// into <see cref="IAlarmStore"/> at all — see the <see cref="PolicyRequest.CriticalAlarmActive"/>
/// derivation above, which is what removes the need.</para>
/// </summary>
public sealed class RelayNotificationChannel
{
    /// <summary>🔴 The audit identity every write by this channel is recorded under — deliberately NOT
    /// <see cref="AuditRecorder.SystemActor"/>, so an investigator six months later can separate "an
    /// engineer wrote to this machine" from "the alarm relay did", and can separate this automation from the
    /// next one. Parenthesised so it can never collide with a real account name.</summary>
    public const string SystemActor = "(system:alarm-relay)";

    /// <summary>🔴 The minimum wall-clock gap between two write ATTEMPTS on one relay instance — the first
    /// rate limit in this product. See the class doc comment for why 2 s, and for why it delays rather than
    /// drops.</summary>
    public static readonly TimeSpan DefaultMinWriteInterval = TimeSpan.FromSeconds(2);

    private readonly NotificationConfigStore _store;
    private readonly FleetHost _fleet;
    private readonly PolicyEngine _policy;
    private readonly AuditRecorder _audit;
    private readonly TimeSpan _minWriteInterval;
    private readonly Action<Exception, string>? _logError;
    private readonly Action<string>? _logWarning;

    /// <summary>Guards <see cref="_instances"/> — the latch sets, the asserted level and the rate-limit
    /// stamps.
    ///
    /// <para><b>What it does and does not buy, stated because the difference matters.</b> It makes
    /// <see cref="InstanceStates"/> a consistent snapshot for a reader on another thread (C-7's endpoint),
    /// and it makes each state transition atomic. It does NOT serialise the WRITE itself — the gate is
    /// released before any I/O, deliberately, because holding a lock across a device round trip is the
    /// pattern Đợt B spent a Critical removing. What guarantees two writes cannot interleave is the SHAPE
    /// this channel runs in: C-1's drain loop is single-reader and C-6 gave this channel its own, so exactly
    /// one <see cref="DispatchAsync"/> is ever in flight. Wiring the same instance into two lanes would break
    /// that assumption, which is why it is written down rather than left to be rediscovered.</para></summary>
    private readonly object _gate = new();
    private readonly Dictionary<string, InstanceState> _instances = new(StringComparer.Ordinal);

    private long _considered;
    private long _suppressed;
    private long _unchanged;
    private long _applied;
    private long _rejected;
    private long _failed;
    private long _indeterminate;
    private long _refused;
    private long _machineNotFound;
    private long _noLiveDriver;
    private long _readOnly;
    private long _ambiguousDriver;
    private long _releaseUnsupported;
    private long _misconfigured;
    private long _lost;
    private long _cancelled;
    private long _rateLimited;

    /// <summary>What one (notification, instance) pair did. Fourteen members, one <c>switch</c>, every path
    /// through <see cref="ApplyAsync"/> ending at exactly one of them — the accounting choke point described
    /// on <see cref="RelayChannelStats"/>. <c>Cancelled</c> is deliberately not a member: it is reached only
    /// by re-throwing, so it cannot be confused with an outcome that was decided.</summary>
    private enum RelayOutcome
    {
        Suppressed,
        Unchanged,
        Applied,
        Rejected,
        Failed,
        Indeterminate,
        Refused,
        MachineNotFound,
        NoLiveDriver,
        ReadOnly,
        AmbiguousDriver,
        ReleaseUnsupported,
        Misconfigured,
        Lost,
    }

    /// <summary>One configured relay instance's live state. <c>Latched</c> is the set of qualifying alarm
    /// keys currently active; <c>Energised</c> is what this channel last SUCCESSFULLY commanded, with
    /// <see langword="null"/> meaning UNKNOWN (nothing commanded yet, or the last write was
    /// <see cref="WriteOutcome.Indeterminate"/>).</summary>
    private sealed class InstanceState
    {
        public readonly HashSet<string> Latched = new(StringComparer.Ordinal);

        /// <summary>🔴 Review round 1 (C-1) — the level a write was last ISSUED for. What the write gate
        /// consults. See <see cref="RelayInstanceState.Commanded"/>.</summary>
        public bool? Commanded;

        /// <summary>What the channel BELIEVES the device is doing. Reporting only — never the gate. See
        /// <see cref="RelayInstanceState.Energised"/>.</summary>
        public bool? Energised;

        public DateTimeOffset? LastAttemptUtc;
    }

    /// <param name="store">C-2's configuration store. Read on EVERY notification rather than cached, so an
    /// operator disabling this channel through C-7 takes effect on the next alarm with no restart. On a
    /// channel that moves a contactor, "takes effect immediately" is worth one SQLite read per edge.</param>
    /// <param name="fleet">Đợt B's write path. Resolution and the write itself both go through
    /// <see cref="FleetHost.TryWriteSetpointAsync"/>/<see cref="FleetHost.TryInvokeCommandAsync"/>, never a
    /// driver reference this class holds — so the <c>_gate</c>-release-before-I/O discipline and the
    /// disposal-race backstop B-2 built both apply unchanged.</param>
    /// <param name="policy">The SAME <see cref="PolicyEngine"/> singleton the HTTP write endpoints use. Not
    /// a private list of rules: a rule added to the engine later must gate this caller too, without anyone
    /// remembering to come here.</param>
    /// <param name="audit">Every attempt is recorded, including refused ones, under
    /// <see cref="SystemActor"/>.</param>
    /// <param name="minWriteInterval">Injectable so tests can measure the bound in a reasonable time and so
    /// C-7 can tighten it from configuration. Defaults to <see cref="DefaultMinWriteInterval"/>.</param>
    public RelayNotificationChannel(
        NotificationConfigStore store,
        FleetHost fleet,
        PolicyEngine policy,
        AuditRecorder audit,
        TimeSpan? minWriteInterval = null,
        Action<Exception, string>? logError = null,
        Action<string>? logWarning = null)
    {
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(fleet);
        ArgumentNullException.ThrowIfNull(policy);
        ArgumentNullException.ThrowIfNull(audit);

        _store = store;
        _fleet = fleet;
        _policy = policy;
        _audit = audit;
        _minWriteInterval = minWriteInterval ?? DefaultMinWriteInterval;
        _logError = logError;
        _logWarning = logWarning;
    }

    /// <summary>Cumulative counters — see <see cref="RelayChannelStats"/>.</summary>
    public RelayChannelStats Stats => new(
        Interlocked.Read(ref _considered),
        Interlocked.Read(ref _suppressed),
        Interlocked.Read(ref _unchanged),
        Interlocked.Read(ref _applied),
        Interlocked.Read(ref _rejected),
        Interlocked.Read(ref _failed),
        Interlocked.Read(ref _indeterminate),
        Interlocked.Read(ref _refused),
        Interlocked.Read(ref _machineNotFound),
        Interlocked.Read(ref _noLiveDriver),
        Interlocked.Read(ref _readOnly),
        Interlocked.Read(ref _ambiguousDriver),
        Interlocked.Read(ref _releaseUnsupported),
        Interlocked.Read(ref _misconfigured),
        Interlocked.Read(ref _lost),
        Interlocked.Read(ref _cancelled),
        Interlocked.Read(ref _rateLimited));

    /// <summary>🔴 What this channel currently believes about each configured instance — see
    /// <see cref="RelayInstanceState"/>. The one read that can tell an operator "the product asked for the
    /// beacon to go out and was refused".</summary>
    public IReadOnlyList<RelayInstanceState> InstanceStates
    {
        get
        {
            lock (_gate)
            {
                return _instances
                    .Select(kv => new RelayInstanceState(
                        kv.Key, kv.Value.Latched.Count, kv.Value.Commanded, kv.Value.Energised,
                        kv.Value.LastAttemptUtc))
                    .OrderBy(s => s.Instance, StringComparer.Ordinal)
                    .ToList();
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Dispatch — the delegate AlarmNotifier's drain loop calls.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// C-1's <c>dispatch</c> delegate, running on THIS channel's own queue and drain thread (Task C-6).
    ///
    /// <para>Instances are walked SEQUENTIALLY rather than fanned out with <c>Task.WhenAll</c>, unlike C-3
    /// and C-4. Theirs are independent network destinations whose budgets would otherwise add up; these are
    /// physical outputs, and two coil writes racing each other on one drain thread buys nothing while making
    /// the order in which two annunciators light non-deterministic. It also keeps the rate limiter's
    /// arithmetic per instance and exact.</para>
    /// </summary>
    public async Task DispatchAsync(NotificationJob job, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(job);
        Interlocked.Increment(ref _considered);

        try
        {
            // Both guards are belt-and-braces in the same way C-3's and C-5's are: since C-4 the store
            // itself throws on a cancelled token. They are kept because without them a future store that
            // went back to never-throws would turn a shutdown into "nothing is configured", and this
            // notification would vanish with no counter moving — and on this channel, vanishing means a
            // beacon that neither lights nor goes out.
            ct.ThrowIfCancellationRequested();

            var configured = await _store.ListAsync(ct).ConfigureAwait(false);

            ct.ThrowIfCancellationRequested();

            foreach (var summary in configured)
            {
                if (summary.Channel != NotificationChannel.Relay) continue;

                // A cheap first pass over the credential-free summary, so a disabled instance never causes
                // its side table to be read at all. The AUTHORITATIVE decision is re-taken on the full
                // configuration below, which is where the target and the latch values live.
                if (!summary.Enabled)
                {
                    Interlocked.Increment(ref _suppressed);
                    continue;
                }

                var config = await _store.GetRelayAsync(summary.Instance, ct).ConfigureAwait(false);
                ct.ThrowIfCancellationRequested();

                if (config is null)
                {
                    // ListAsync's LEFT JOIN listed it and GetRelayAsync's INNER JOIN could not resolve it —
                    // the same read-back disagreement C-3 and C-4 count as a loss, for the same reason: this
                    // is a configured channel that did not act, which is not the same as one that was
                    // switched off.
                    Interlocked.Increment(ref _lost);
                    ReportError(
                        new InvalidOperationException($"relay_config row missing for instance '{summary.Instance}'"),
                        $"Alarm relay '{summary.Instance}': the channel is configured and enabled but its target " +
                        $"could not be read back — the annunciator was NOT driven for {Describe(job)}.");
                    continue;
                }

                await ApplyAndCountAsync(config, job, ct).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Unit is the NOTIFICATION, not the pair — the per-instance work is sequential, so a shutdown
            // is observed in exactly one place. Re-thrown either way: C-1's drain loop counts a
            // shutdown-abandoned job as a drop, and swallowing it would make a truncated drain invisible.
            Interlocked.Increment(ref _cancelled);
            throw;
        }
        catch (Exception ex)
        {
            // Defensive: nothing above should be able to throw anything else. Counted rather than merely
            // logged, for the reason AlarmNotifier's own catch-all is — a log saying an alarm was lost, next
            // to a counter reading zero, says the opposite of the log.
            Interlocked.Increment(ref _lost);
            ReportError(ex, "Alarm relay: resolving the configured instances faulted — the annunciator was " +
                            $"NOT driven for {Describe(job)}.");
        }
    }

    /// <summary>🔴 The accounting choke point: exactly one counter moves per (notification, instance) pair,
    /// and every path through <see cref="ApplyAsync"/> ends at this switch.</summary>
    private async Task ApplyAndCountAsync(RelayChannelConfig config, NotificationJob job, CancellationToken ct)
    {
        RelayOutcome outcome;
        try
        {
            outcome = await ApplyAsync(config, job, ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            outcome = RelayOutcome.Lost;
            ReportError(ex, $"Alarm relay '{config.Instance}': the channel itself faulted — the annunciator " +
                            $"was NOT driven for {Describe(job)}.");
        }

        switch (outcome)
        {
            case RelayOutcome.Suppressed: Interlocked.Increment(ref _suppressed); break;
            case RelayOutcome.Unchanged: Interlocked.Increment(ref _unchanged); break;
            case RelayOutcome.Applied: Interlocked.Increment(ref _applied); break;
            case RelayOutcome.Rejected: Interlocked.Increment(ref _rejected); break;
            case RelayOutcome.Failed: Interlocked.Increment(ref _failed); break;
            case RelayOutcome.Indeterminate: Interlocked.Increment(ref _indeterminate); break;
            case RelayOutcome.Refused: Interlocked.Increment(ref _refused); break;
            case RelayOutcome.MachineNotFound: Interlocked.Increment(ref _machineNotFound); break;
            case RelayOutcome.NoLiveDriver: Interlocked.Increment(ref _noLiveDriver); break;
            case RelayOutcome.ReadOnly: Interlocked.Increment(ref _readOnly); break;
            case RelayOutcome.AmbiguousDriver: Interlocked.Increment(ref _ambiguousDriver); break;
            case RelayOutcome.ReleaseUnsupported: Interlocked.Increment(ref _releaseUnsupported); break;
            case RelayOutcome.Misconfigured: Interlocked.Increment(ref _misconfigured); break;
            default: Interlocked.Increment(ref _lost); break;
        }
    }

    /// <summary>Updates one instance's latch from this edge and, if the derived level differs from what was
    /// last successfully commanded, performs one gated write.</summary>
    private async Task<RelayOutcome> ApplyAsync(RelayChannelConfig config, NotificationJob job, CancellationToken ct)
    {
        bool desired;
        lock (_gate)
        {
            if (!_instances.TryGetValue(config.Instance, out var state))
            {
                state = new InstanceState();
                _instances[config.Instance] = state;
            }

            switch (job.Edge)
            {
                case AlarmEdgeKind.Raised:
                case AlarmEdgeKind.Escalated:
                case AlarmEdgeKind.Restored:
                    if (!NotificationDelivery.MeetsThreshold(job.Alarm.Priority, config.MinPriority))
                    {
                        return RelayOutcome.Suppressed;
                    }

                    state.Latched.Add(job.Alarm.Key);
                    break;

                case AlarmEdgeKind.Cleared:
                    // 🔴 Deliberately NOT threshold-filtered. Belt-and-braces rather than a reachable branch
                    // today — recorded rather than left as folklore, and review round 1 (m-1) corrected the
                    // REASON, which matters because the original one was wrong in a way that would have
                    // justified deleting this line.
                    //
                    // The high-water mark does NOT protect this. It lives in AlarmNotifier's own private
                    // KeyState; the job carries the STORE's Alarm, and AlarmStore's upsert sets
                    // `priority = excluded.priority` — so a source re-raising the same key at a LOWER
                    // priority lowers the priority the eventual Cleared job carries, with no change to
                    // AlarmNotifier at all. Threshold-filtering here would then fail to remove a key that
                    // had legitimately been latched.
                    //
                    // What actually makes it unreachable is narrower and more fragile: no source in this
                    // build ever re-raises a key at a lower priority (Policy's code and priority are 1:1,
                    // NgRate/DriverHealth/Identity are fixed). The day one does — or the day de-escalation
                    // becomes an edge, which AlarmNotifier's doc explicitly reserves — filtering here would
                    // start stranding keys, and a key that cannot be removed is a beacon that never goes
                    // out. Do not delete this as redundant without answering that.
                    state.Latched.Remove(job.Alarm.Key);
                    break;

                case AlarmEdgeKind.Acked:
                    // ISA-18.2's ack silences a HORN. This channel does not know it is driving one — see the
                    // class doc comment for why an ack must not extinguish what might be a lamp.
                    return RelayOutcome.Suppressed;

                default:
                    return RelayOutcome.Suppressed;
            }

            desired = state.Latched.Count > 0;

            // 🔴 THE line that makes this channel edge-driven rather than tick-driven — and it consults
            // Commanded (what a write was last ISSUED for), never Energised (what the device is BELIEVED to
            // be doing). Review round 1 (C-1) found that distinction the hard way.
            //
            // Gating on Energised meant that after ONE Indeterminate write the belief was null, `null ==
            // true` is false, and so EVERY subsequent latch input wrote again — not just a level transition.
            // Measured: 20 distinct alarms in one episode produced 20 writes instead of 1, and for a
            // RelayTargetKind.Command every one of those is a real actuation, not a redundant attempt at the
            // same one. That contradicted this class's own no-retry warning, and the doc was right where the
            // code was wrong ("the next real TRANSITION writes unconditionally").
            //
            // Commanded is null only at process start, so the first derived level is still always written —
            // which is what re-asserts the beacon on a restart into standing alarms. After an Indeterminate
            // it holds the level that WAS issued, so a storm behind it is absorbed exactly as it would have
            // been after a clean Applied, while Energised stays null and keeps reporting UNKNOWN, which is
            // the honest thing to report and is load-bearing for the operator.
            if (state.Commanded == desired) return RelayOutcome.Unchanged;
        }

        return await WriteAsync(config, desired, job, ct).ConfigureAwait(false);
    }

    /// <summary>One gated, rate-limited, audited write. Never retries anything, for any outcome.</summary>
    private async Task<RelayOutcome> WriteAsync(
        RelayChannelConfig config, bool desired, NotificationJob job, CancellationToken ct)
    {
        // ── A command target cannot release. Say so; do not pretend. ───────────────────────────────────
        if (config.TargetKind == RelayTargetKind.Command && !desired)
        {
            lock (_gate)
            {
                if (_instances.TryGetValue(config.Instance, out var s))
                {
                    // The LATCH is released, so the next episode must pulse again rather than being
                    // suppressed as redundant.
                    s.Commanded = false;

                    // 🔴 Review round 1 (m-5) — the BELIEF becomes UNKNOWN, not false. Nothing was written,
                    // so claiming the annunciator is off would be this product asserting something about a
                    // physical output it did not command and cannot observe. What a pulse left behind is
                    // whatever the device does with a pulse, which is exactly what this channel does not
                    // know.
                    s.Energised = null;
                }
            }

            ReportWarning(
                $"Alarm relay '{config.Instance}': the last qualifying alarm cleared, but this instance is " +
                $"configured as a COMMAND target ('{config.TargetName}' on machine '{config.MachineCode}') and a " +
                "command is an argument-less pulse with no release. The annunciator was NOT de-energised by this " +
                "product. Use a writable POINT target if the annunciator must latch and release.");

            // 🔴 Review round 1 (m-5) — audited, even though no device was touched. §8 claims every attempt
            // is recorded; this is not an attempt, but it IS the product changing what it believes about a
            // physical output, and an investigator reconstructing "why did the beacon stay on" needs the row
            // that says the release was structurally impossible rather than merely refused.
            await AuditAsync(
                MachineWriteGate.CommandAction, config, job, desired, value: null,
                MachineWriteGate.RoleFor(config.TargetKind),
                new { attempted = false, releaseUnsupported = true }).ConfigureAwait(false);

            return RelayOutcome.ReleaseUnsupported;
        }

        // ── Resolve the value a point target writes. No defaults, ever. ────────────────────────────────
        object? value = null;
        if (config.TargetKind == RelayTargetKind.Point)
        {
            var json = desired ? config.OnValueJson : config.OffValueJson;
            if (!RelayValue.TryParse(json, out value, out var valueError))
            {
                ReportWarning(
                    $"Alarm relay '{config.Instance}': cannot {(desired ? "energise" : "de-energise")} " +
                    $"'{config.TargetName}' on machine '{config.MachineCode}' — {valueError} This product does " +
                    "NOT invent a value for a point it cannot identify; re-save the relay configuration with an " +
                    "explicit energise and de-energise value.");
                return RelayOutcome.Misconfigured;
            }
        }

        var action = MachineWriteGate.ActionFor(config.TargetKind);
        var role = MachineWriteGate.RoleFor(config.TargetKind);

        // ── The rate limiter. Delays; never drops. ─────────────────────────────────────────────────────
        await AwaitWriteSlotAsync(config.Instance, ct).ConfigureAwait(false);

        // ── 🔴 THE ĐỢT B GATE. Full, intact, same engine, same action ids. ─────────────────────────────
        var decision = _policy.Evaluate(new PolicyRequest(
            action, role, SystemActor, _fleet.GetSafetyStatus(),
            // See the class doc comment for the derivation. Every Critical alarm meets every relay
            // threshold, so every Critical alarm is one this relay is itself annunciating — the INPUT to
            // this write, never an independent reason to withhold it.
            CriticalAlarmActive: false));

        if (!decision.IsPermitted)
        {
            // 🔴 NEITHER half of the state is changed here. Nothing was written, so if the beacon was on it
            // is STILL ON — the product must never believe otherwise — and leaving Commanded alone is what
            // makes the next edge re-attempt once the refusal is lifted. See the class doc's HALT paragraph.
            var believed = CurrentlyEnergised(config.Instance);
            var stillEnergised = !desired && believed == true;
            var maybeEnergised = !desired && believed is null;
            ReportWarning(
                $"Alarm relay '{config.Instance}': {(desired ? "energising" : "de-energising")} " +
                $"'{config.TargetName}' on machine '{config.MachineCode}' was REFUSED by the machine-write " +
                $"policy ({decision.Reason.ToWireCode()}). {decision.Message} " +
                (stillEnergised
                    ? "🔴 The annunciator is STILL ENERGISED and this product cannot turn it off while the " +
                      "refusal stands — clear the refusal, or de-energise it at the panel."
                    : maybeEnergised
                        // Review round 1 — after an INDETERMINATE write the belief is UNKNOWN, and reporting
                        // "was NOT driven" here would read as "it is off", which is precisely the claim this
                        // channel must never make.
                        ? "🔴 The annunciator's state is UNKNOWN to this product (an earlier write was " +
                          "indeterminate) and this refusal means it cannot be turned off either — look at it."
                        : "The annunciator was NOT driven.") +
                " (This annunciator is not a safety device; a light or horn that must work while HALT is " +
                "engaged has to be hardwired.)");

            await AuditAsync(
                $"{action}.denied", config, job, desired, value, role,
                new
                {
                    reason = decision.Reason.ToWireCode(),
                    message = decision.Message,
                    attempted = false,
                    stillEnergised,
                    believedEnergised = believed,
                }).ConfigureAwait(false);

            return RelayOutcome.Refused;
        }

        // ── The write. CancellationToken.None from here on, exactly as B-6 does. ───────────────────────
        // B-4's carried finding: a cancelled write tears down the SAME connection the poll loop shares and
        // can flap driver Health to Degraded like a genuine fault. Shutdown is bounded instead by
        // AlarmNotifier.DisposeAsync's 5 s drain window and by the driver's own transport timeout, so
        // nothing here can hang forever.
        MachineDriverAvailability availability;
        WriteOutcome outcome;
        string? detail;
        string? rejection;

        if (config.TargetKind == RelayTargetKind.Command)
        {
            var (a, r) = await _fleet.TryInvokeCommandAsync(
                config.MachineCode, new CommandRequest(config.TargetName), CancellationToken.None).ConfigureAwait(false);
            availability = a;
            if (r is null) return await UnavailableAsync(availability, config, job, desired, value, role).ConfigureAwait(false);
            outcome = r.Outcome;
            detail = r.Detail;
            rejection = r.RejectionReason?.ToString();
        }
        else
        {
            var (a, r) = await _fleet.TryWriteSetpointAsync(
                config.MachineCode, new SetpointWriteRequest(config.TargetName, value), CancellationToken.None).ConfigureAwait(false);
            availability = a;
            if (r is null) return await UnavailableAsync(availability, config, job, desired, value, role).ConfigureAwait(false);
            outcome = r.Outcome;
            detail = r.Detail;
            rejection = r.RejectionReason?.ToString();
        }

        await AuditAsync(
            action, config, job, desired, value, role,
            new
            {
                attempted = true,
                availability = availability.ToString(),
                outcome = outcome.ToString(),
                rejectionReason = rejection,
                detail,
            }).ConfigureAwait(false);

        switch (outcome)
        {
            case WriteOutcome.Applied:
                lock (_gate)
                {
                    if (_instances.TryGetValue(config.Instance, out var s))
                    {
                        s.Commanded = desired;
                        s.Energised = desired;
                    }
                }
                return RelayOutcome.Applied;

            case WriteOutcome.Rejected:
                // The map refused the value before touching the device. Nothing was written, so NEITHER
                // Commanded nor Energised moves — which means the next edge will attempt it again, and that
                // is deliberate: a rejection is a statement about the CONFIGURATION, and an operator fixing
                // the point's declared range must not also have to manufacture a level transition to get the
                // beacon working.
                //
                // 🔴 Review round 1 (m-2) — "not retried" below means THIS write is not re-issued for this
                // edge; it does not mean the channel gives up. Said explicitly because the previous wording
                // promised more than the code does: 20 alarms in one episode produce 20 rejected attempts
                // (no device touched, and rate-limited to 0.5 Hz, so this is noise rather than actuation).
                ReportWarning(
                    $"Alarm relay '{config.Instance}': the driver REJECTED " +
                    $"{(desired ? "energising" : "de-energising")} '{config.TargetName}' on machine " +
                    $"'{config.MachineCode}' ({rejection ?? "no reason given"}) — the register map refused it and " +
                    "no device was touched. This write is not re-issued; the next alarm edge WILL attempt it " +
                    "again, and will keep being rejected until the configuration is fixed. Check the point's " +
                    "declared range and writability.");
                return RelayOutcome.Rejected;

            case WriteOutcome.Failed:
                // Definitively not applied, so nothing reached the device and neither Commanded nor Energised
                // moves. Not re-issued for this edge (B-1 forbids implicit retries on any write outcome, and
                // this channel does not second-guess it); the next edge attempts it again.
                ReportWarning(
                    $"Alarm relay '{config.Instance}': the write to '{config.TargetName}' on machine " +
                    $"'{config.MachineCode}' FAILED ({detail ?? "no detail"}) — the annunciator was not driven. " +
                    "Not re-issued; the next alarm edge will try again.");
                return RelayOutcome.Failed;

            default:
                // 🔴 Indeterminate. The device may or may not have applied it, and re-pulsing a coil that
                // may already have been pulsed is the wrong move — B-1 made this outcome first-class for
                // exactly this reason.
                //
                // 🔴 Review round 1 (C-1) — the two halves of the state move DIFFERENTLY here, and that is
                // the whole point. Commanded moves to `desired`: a write for that level WAS issued and must
                // not be issued again, which is what no-retry means and what stops the next twenty alarms in
                // the same episode from each producing another actuation. Energised becomes UNKNOWN: the
                // product genuinely does not know what the device did, and saying so is the honest report.
                // Gating the write on Energised — as this class originally did — silently turned "do not
                // retry" into "retry on every subsequent latch input".
                lock (_gate)
                {
                    if (_instances.TryGetValue(config.Instance, out var s))
                    {
                        s.Commanded = desired;
                        s.Energised = null;
                    }
                }

                ReportWarning(
                    $"🔴 Alarm relay '{config.Instance}': the write to '{config.TargetName}' on machine " +
                    $"'{config.MachineCode}' returned INDETERMINATE ({detail ?? "no detail"}). The device may or " +
                    "may not have applied it and this product will NOT retry — re-pulsing a coil that may already " +
                    "have been pulsed is worse than not knowing. The annunciator's state is now UNKNOWN to this " +
                    "product; look at it.");
                return RelayOutcome.Indeterminate;
        }
    }

    /// <summary>The four Đợt B resolution failures, each kept distinct and each audited. No I/O was
    /// attempted, so the channel's belief about the coil is untouched.</summary>
    private async Task<RelayOutcome> UnavailableAsync(
        MachineDriverAvailability availability, RelayChannelConfig config, NotificationJob job,
        bool desired, object? value, string role)
    {
        var action = MachineWriteGate.ActionFor(config.TargetKind);
        await AuditAsync(
            action, config, job, desired, value, role,
            new { attempted = false, availability = availability.ToString() }).ConfigureAwait(false);

        var (outcome, explanation) = availability switch
        {
            MachineDriverAvailability.MachineNotFound => (
                RelayOutcome.MachineNotFound,
                "no roster member carries that machine code — check the code, or onboard the machine."),
            MachineDriverAvailability.NoLiveDriver => (
                RelayOutcome.NoLiveDriver,
                "the roster knows the machine but nothing is driving it right now — the fleet may be stopped, " +
                "or its connector failed to start this run."),
            MachineDriverAvailability.ReadOnly => (
                RelayOutcome.ReadOnly,
                "the live driver for that machine cannot write at all — this connector declares no writable " +
                "points or commands."),
            _ => (
                RelayOutcome.AmbiguousDriver,
                "more than one roster member resolves to the same live connector, so Đợt B refuses to write " +
                "rather than risk reaching the wrong physical machine."),
        };

        ReportWarning(
            $"Alarm relay '{config.Instance}': cannot {(desired ? "energise" : "de-energise")} " +
            $"'{config.TargetName}' on machine '{config.MachineCode}' — {explanation} No device was touched.");

        return outcome;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Rate limiting
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 Waits until this instance is allowed another write attempt. <b>Delays, never drops</b> — see the
    /// class doc comment.
    ///
    /// <para>Stamped on ATTEMPT rather than on success, deliberately: a refused or unavailable attempt still
    /// costs a policy evaluation and an audit row, and a storm of those is as much a storm as a storm of
    /// coil writes. Stamped BEFORE the write rather than after, so the bound is on the interval between
    /// STARTS and cannot be stretched by a slow device into something looser than advertised.</para>
    ///
    /// <para>Runs on this channel's own drain thread (Task C-6), which is what makes a blocking delay here
    /// acceptable at all: it costs this channel's own throughput and nothing else's. Under C-1's single
    /// shared queue the same code would have throttled every other channel too.</para>
    /// </summary>
    private async Task AwaitWriteSlotAsync(string instance, CancellationToken ct)
    {
        TimeSpan wait;
        lock (_gate)
        {
            var state = _instances[instance];
            var now = DateTimeOffset.UtcNow;
            var since = state.LastAttemptUtc is { } last ? now - last : TimeSpan.MaxValue;
            wait = since >= _minWriteInterval ? TimeSpan.Zero : _minWriteInterval - since;

            if (wait <= TimeSpan.Zero)
            {
                state.LastAttemptUtc = now;
            }
        }

        if (wait <= TimeSpan.Zero) return;

        Interlocked.Increment(ref _rateLimited);
        await Task.Delay(wait, ct).ConfigureAwait(false);

        lock (_gate)
        {
            _instances[instance].LastAttemptUtc = DateTimeOffset.UtcNow;
        }
    }

    private bool? CurrentlyEnergised(string instance)
    {
        lock (_gate)
        {
            return _instances.TryGetValue(instance, out var s) ? s.Energised : null;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Audit
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 Every attempt, including refused ones, under <see cref="SystemActor"/>.
    ///
    /// <para>The ACTION is Đợt B's own id (with <c>.denied</c> appended on a policy refusal, matching
    /// <see cref="PolicyResults.DenyAsync"/>'s convention) and the target is <c>machine</c>/machine code —
    /// so an investigator asking "what wrote to this machine?" finds these rows by the query they already
    /// use, and the ACTOR is what separates them from a human's. Inventing a private action id would have
    /// hidden automatic writes from exactly that query.</para>
    ///
    /// <para>Never throws (<see cref="AuditRecorder"/>'s own contract) and takes
    /// <see cref="CancellationToken.None"/>: the event has already happened, and B-6's fix round established
    /// that using a possibly-cancelled token here loses the row for something that genuinely
    /// occurred.</para>
    /// </summary>
    private Task AuditAsync(
        string action, RelayChannelConfig config, NotificationJob job, bool desired, object? value,
        string role, object result) =>
        _audit.RecordSystemActorAsync(
            SystemActor, role, action, targetType: "machine", targetId: config.MachineCode,
            oldValue: null,
            newValue: new
            {
                via = "alarm.relay",
                instance = config.Instance,
                targetKind = config.TargetKind.ToString(),
                target = config.TargetName,
                intent = desired ? "energise" : "de-energise",
                requestedValue = value,
                edge = job.Edge.ToString(),
                alarmKey = job.Alarm?.Key,
                alarmPriority = job.Alarm?.Priority.ToString(),
                sequence = job.Sequence,
                result,
            },
            CancellationToken.None);

    // ─────────────────────────────────────────────────────────────────────
    // Reporting — never itself a failure.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Null-safe for the reason C-5 found by mutation rather than by reading: the only way to reach
    /// a never-throws handler is a structurally broken job, and the likeliest way for one to be broken is a
    /// null <see cref="NotificationJob.Alarm"/> — which is precisely what an interpolated
    /// <c>job.Alarm.Key</c> then dereferences, throwing out of the handler that existed to absorb it.</summary>
    private static string Describe(NotificationJob? job) =>
        job is null ? "<null job>"
        : job.Alarm is null ? $"{job.Edge} <null alarm>"
        : $"{job.Edge} '{job.Alarm.Key}'";

    private void ReportError(Exception ex, string message)
    {
        try { _logError?.Invoke(ex, message); } catch { /* nothing left to report it to */ }
    }

    private void ReportWarning(string message)
    {
        try { _logWarning?.Invoke(message); } catch { /* nothing left to report it to */ }
    }
}
