using St4i.EngineApi.Fleet;

namespace St4i.EngineApi.Line;

/// <summary>One point-in-time read of the line's state — <see cref="HoldReason"/> is non-null only when
/// <see cref="State"/> is <see cref="PackMlState.Held"/> ("operator hold" vs "critical alarm active").
/// <see cref="IsRunning"/>/<see cref="EstopEngaged"/> are read straight off <see cref="FleetHost"/> (the
/// ACTUAL physical/pipeline truth), never cached — so a caller can always tell the LineController's own
/// COMMANDED intent (<see cref="State"/>) apart from what the fleet is really doing right now.</summary>
public sealed record LineStatus(PackMlState State, string? HoldReason, bool IsRunning, bool EstopEngaged);

/// <summary>The result of <see cref="LineController.Execute"/>: <see cref="Accepted"/> is true for a
/// legal transition (including a Start redirected into Held by the alarm gate — see the class doc
/// comment), false for an illegal one (a stale state check) OR an Unhold blocked by a still-active
/// Critical alarm. <see cref="State"/> is the resulting COMMANDED state either way (unchanged when
/// <see cref="Accepted"/> is false). <see cref="RejectReason"/> is non-null only when
/// <see cref="Accepted"/> is false.</summary>
public sealed record LineTransitionResult(bool Accepted, PackMlState State, string? RejectReason);

/// <summary>
/// GĐ3 sub-4 LC-3 — a supervisory PackML/ISA-88 state machine layered OVER <see cref="FleetHost"/>: it
/// CALLS <see cref="FleetHost.Start"/>/<see cref="FleetHost.Stop"/>/<see cref="FleetHost.Estop"/>/
/// <see cref="FleetHost.ResetEstop"/> to actually drive the fleet — it never reimplements any of that
/// logic itself. This class owns exactly one extra piece of state FleetHost doesn't have: the operator's
/// COMMANDED PackML state (<see cref="PackMlState"/>), which is richer than FleetHost's own plain
/// running/stopped/estopped booleans (e.g. it distinguishes an operator HOLD, a resumable pause, from a
/// STOP, and from an ABORT/HALT).
///
/// FleetHost mapping (HOLD is a resumable pause, not FleetHost's own STOP-as-in-"line stopped for the
/// day"): <c>Start</c> → <see cref="FleetHost.Start"/>; <c>Hold</c>/<c>Stop</c> → <see cref="FleetHost.Stop"/>
/// (both physically stop the pipeline — HOLD remembers the operator's intent to resume via <c>Unhold</c>,
/// which calls <see cref="FleetHost.Start"/> again; STOP has no implied resume); <c>Abort</c> →
/// <see cref="FleetHost.Estop"/>; <c>Reset</c> → <see cref="FleetHost.ResetEstop"/>.
///
/// Transition table (validated against the CURRENT commanded state; an illegal command is rejected —
/// <see cref="LineTransitionResult.Accepted"/> false — never silently ignored):
/// <list type="bullet">
/// <item><description><b>Start</b>: legal from {Idle, Stopped}. If <c>criticalAlarmActive</c>, the
/// interlock redirects the target to Held (HoldReason "critical alarm active") and <see cref="FleetHost.Start"/>
/// is deliberately NOT called — this is still an ACCEPTED transition (the command was legal; the
/// permissive just wasn't met), the same way a real PackML machine reports Held rather than silently
/// refusing the command. Otherwise → Execute + <see cref="FleetHost.Start"/>.</description></item>
/// <item><description><b>Hold</b>: legal only from Execute → Held (HoldReason "operator hold") +
/// <see cref="FleetHost.Stop"/>.</description></item>
/// <item><description><b>Unhold</b>: legal only from Held. If <c>criticalAlarmActive</c>, REJECTED
/// (Accepted=false, state stays Held, reason "critical alarm active") — unlike Start's redirect, there is
/// no new state to report here (the line was already Held), so this is naturally a rejection, not a
/// redirect. Otherwise → Execute + <see cref="FleetHost.Start"/>.</description></item>
/// <item><description><b>Stop</b>: legal from {Execute, Held} → Stopped + <see cref="FleetHost.Stop"/>.</description></item>
/// <item><description><b>Abort</b>: legal from any state except Aborted (a halt must always be
/// reachable) → Aborted + <see cref="FleetHost.Estop"/>. SM-4/B-8: despite the ISA-88/PackML name, this is
/// a software abort of THIS SOFTWARE's own read pipeline — it stops data collection and disconnects
/// from the configured device(s). <see cref="FleetHost.Estop"/> never calls the real write path a device
/// now has (Modbus/OPC-UA setpoints/commands, since B-4/B-5) — see that method's own doc comment for why
/// that stays a deliberate choice, not a gap — so Abort still has no effect on any physical machine. A
/// real emergency stop is a hardwired, safety-rated circuit (ISO 13849); this is not one and must never
/// be presented as one.</description></item>
/// <item><description><b>Reset</b>: legal from {Stopped, Aborted} → Idle + <see cref="FleetHost.ResetEstop"/>
/// (a no-op on the latch if it wasn't actually engaged, e.g. resetting from a plain Stopped — ResetEstop
/// is idempotent).</description></item>
/// </list>
///
/// <see cref="Snapshot"/> reports the EFFECTIVE state, which can diverge from the raw commanded state: a
/// commanded Execute with a Critical alarm currently active is reported as Held ("critical alarm active")
/// even though nothing has re-commanded it — this is what makes a Critical alarm raised WHILE already
/// running visible immediately on the next poll, without requiring a fresh Hold command. This is a pure
/// read (never mutates the commanded state) — the commanded state only changes via <see cref="Execute"/>
/// (an explicit Unhold is still required to actually resume once the alarm clears, which is itself gated
/// the same way).
///
/// Initial commanded state is <see cref="PackMlState.Stopped"/> (a freshly constructed
/// <see cref="FleetHost"/> isn't running) — deliberately NOT derived from <see cref="FleetHost.IsRunning"/>
/// at construction, since this class is normally constructed once at process startup, before any fleet
/// state exists to derive from; simplest to document and reason about.
///
/// Thread-safe: every read/mutation of the commanded state takes this instance's own private lock — the
/// SAME "own gate, never FleetHost's" discipline every other FleetHost-adjacent collaborator in this
/// codebase follows (this class never reaches into FleetHost's internals, only its public API).
///
/// Publishes to the UNS spine on every commanded-state CHANGE (never on a rejection, and never on a
/// Snapshot's effective-state override) via <see cref="St4i.EdgeCore.Uns.IUnsPublisher.PublishLineState"/>
/// — non-blocking, optional (a null <paramref name="uns"/> is a no-op, same convention as every other
/// optional <see cref="St4i.EdgeCore.Uns.IUnsPublisher"/> consumer in this codebase).
/// </summary>
public sealed class LineController
{
    private readonly FleetHost _fleet;
    private readonly St4i.EdgeCore.Uns.IUnsPublisher? _uns;
    private readonly Action<Exception, string>? _logError;
    private readonly object _gate = new();

    private PackMlState _commanded = PackMlState.Stopped;
    private string? _holdReason;

    public LineController(FleetHost fleet, St4i.EdgeCore.Uns.IUnsPublisher? uns = null, Action<Exception, string>? logError = null)
    {
        _fleet = fleet ?? throw new ArgumentNullException(nameof(fleet));
        _uns = uns;
        _logError = logError;
    }

    /// <summary>The effective state — see the class doc comment for the commanded-vs-effective
    /// distinction. Never mutates <see cref="_commanded"/>/<see cref="_holdReason"/>.</summary>
    public LineStatus Snapshot(bool criticalAlarmActive)
    {
        PackMlState commanded;
        string? holdReason;
        lock (_gate)
        {
            commanded = _commanded;
            holdReason = _holdReason;
        }

        if (commanded == PackMlState.Execute && criticalAlarmActive)
        {
            return new LineStatus(PackMlState.Held, "critical alarm active", _fleet.IsRunning, _fleet.EstopEngaged);
        }

        return new LineStatus(
            commanded,
            commanded == PackMlState.Held ? holdReason : null,
            _fleet.IsRunning,
            _fleet.EstopEngaged);
    }

    /// <summary>Validates the transition, applies the alarm gate, drives <see cref="FleetHost"/>, and
    /// publishes the new state to UNS — see the class doc comment for the full table.</summary>
    public LineTransitionResult Execute(LineCommand cmd, bool criticalAlarmActive)
    {
        lock (_gate)
        {
            var current = _commanded;
            return cmd switch
            {
                LineCommand.Start => ExecuteStart(current, criticalAlarmActive),
                LineCommand.Hold => ExecuteHold(current),
                LineCommand.Unhold => ExecuteUnhold(current, criticalAlarmActive),
                LineCommand.Stop => ExecuteStop(current),
                LineCommand.Abort => ExecuteAbort(current),
                LineCommand.Reset => ExecuteReset(current),
                _ => Reject(current, $"Unknown line command '{cmd}'."),
            };
        }
    }

    // Assumes the caller holds _gate.
    private LineTransitionResult ExecuteStart(PackMlState current, bool criticalAlarmActive)
    {
        if (current != PackMlState.Idle && current != PackMlState.Stopped)
        {
            return Reject(current, $"Cannot Start from {current} — Start is only legal from Idle or Stopped.");
        }

        return criticalAlarmActive
            ? Transition(PackMlState.Held, "critical alarm active", fleetAction: null)
            : Transition(PackMlState.Execute, holdReason: null, fleetAction: _fleet.Start);
    }

    private LineTransitionResult ExecuteHold(PackMlState current)
    {
        if (current != PackMlState.Execute)
        {
            return Reject(current, $"Cannot Hold from {current} — Hold is only legal from Execute.");
        }

        return Transition(PackMlState.Held, "operator hold", _fleet.Stop);
    }

    private LineTransitionResult ExecuteUnhold(PackMlState current, bool criticalAlarmActive)
    {
        if (current != PackMlState.Held)
        {
            return Reject(current, $"Cannot Unhold from {current} — Unhold is only legal from Held.");
        }

        // Unlike Start's redirect above, there is no NEW state to report here — the line was already
        // Held — so a still-active Critical alarm makes this a REJECTION (Accepted=false), not a
        // same-state "accepted no-op".
        if (criticalAlarmActive)
        {
            return Reject(current, "critical alarm active");
        }

        return Transition(PackMlState.Execute, holdReason: null, _fleet.Start);
    }

    private LineTransitionResult ExecuteStop(PackMlState current)
    {
        if (current != PackMlState.Execute && current != PackMlState.Held)
        {
            return Reject(current, $"Cannot Stop from {current} — Stop is only legal from Execute or Held.");
        }

        return Transition(PackMlState.Stopped, holdReason: null, _fleet.Stop);
    }

    private LineTransitionResult ExecuteAbort(PackMlState current)
    {
        if (current == PackMlState.Aborted)
        {
            return Reject(current, "Cannot Abort — the line is already Aborted.");
        }

        return Transition(PackMlState.Aborted, holdReason: null, _fleet.Estop);
    }

    private LineTransitionResult ExecuteReset(PackMlState current)
    {
        if (current != PackMlState.Stopped && current != PackMlState.Aborted)
        {
            return Reject(current, $"Cannot Reset from {current} — Reset is only legal from Stopped or Aborted.");
        }

        return Transition(PackMlState.Idle, holdReason: null, _fleet.ResetEstop);
    }

    /// <summary>Applies an ACCEPTED transition: drives <see cref="FleetHost"/> (defensively try/catch'd —
    /// FleetHost's own Start/Stop/Estop/ResetEstop are not documented to throw in normal operation, but
    /// this is a safety-adjacent command surface, so a hypothetical fault here must never crash the
    /// caller's request; it's logged via <see cref="_logError"/> and the commanded-state bookkeeping still
    /// proceeds — <see cref="Snapshot"/>'s own IsRunning/EstopEngaged always reflect FleetHost's REAL state
    /// regardless, so a caller can still tell the two apart if they ever disagree), then updates the
    /// commanded state and publishes it to UNS. Assumes the caller holds _gate.</summary>
    private LineTransitionResult Transition(PackMlState next, string? holdReason, Action? fleetAction)
    {
        if (fleetAction is not null)
        {
            try
            {
                fleetAction();
            }
            catch (Exception ex)
            {
                _logError?.Invoke(ex, $"LineController: FleetHost call faulted while transitioning to {next}");
            }
        }

        _commanded = next;
        _holdReason = holdReason;

        _uns?.PublishLineState(next.ToString());

        return new LineTransitionResult(true, next, null);
    }

    private static LineTransitionResult Reject(PackMlState current, string reason) => new(false, current, reason);
}
