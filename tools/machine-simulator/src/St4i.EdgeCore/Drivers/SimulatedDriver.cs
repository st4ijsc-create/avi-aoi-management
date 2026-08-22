using System.Runtime.CompilerServices;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Drivers.Simulators;
using St4i.EdgeCore.Models;

namespace St4i.EdgeCore.Drivers;

/// <summary>
/// The exhibition "south side": wraps a fleet of <see cref="IMachineSimulator"/>s and yields their
/// readings at each sim's own cadence (<see cref="MachineDescriptor.CycleSeconds"/>), round-robin
/// across the fleet — e.g. a 1s screwdriver and a 4s AOI machine both stream at their own natural
/// rate from a single <see cref="ReadAsync"/> stream. This is I/O PACING ONLY (real-time
/// <see cref="Task.Delay(TimeSpan,CancellationToken)"/>) — it never influences the deterministic
/// value logic inside each sim, which is a pure function of (seed, cycle).
/// </summary>
public sealed class SimulatedDriver : IDeviceDriver
{
    /// <summary>Task 3 — floor for <see cref="IMachineSimulator.CycleSecondsOverride"/>-derived cadence,
    /// same value each config-aware simulator's own formula already clamps to (kept here too as a final
    /// backstop in case a future override forgets to).</summary>
    private const double MinCycleSeconds = 0.05;

    private readonly IReadOnlyList<IMachineSimulator> _sims;
    private readonly long[] _cycleCounters;
    private readonly DateTimeOffset[] _nextDueAt;
    private volatile bool _disposed;

    /// <summary>Builds the exhibition driver over an already-constructed fleet of simulators. This is the one
    /// place the "at least one simulator" precondition is enforced — a <see langword="null"/> list raises
    /// <see cref="ArgumentNullException"/> and an EMPTY one raises <see cref="ArgumentException"/>, because
    /// <see cref="NextDueIndex"/> picks an index out of a fixed-size array and has no answer over zero sims.
    /// Nothing here opens a file, a socket or a session, so this class satisfies
    /// <see cref="IDeviceDriver"/>'s type-level "construction is non-blocking and performs no I/O" rule
    /// literally rather than by exemption.
    ///
    /// <para><b>The cadence clock is anchored HERE, not at the first enumeration, and that is the
    /// precondition a caller can get wrong.</b> Each sim's first due-time is set to the <c>UtcNow</c> read by
    /// this constructor, and <see cref="ReadAsync"/> advances a due-time by ADDING one cadence to the previous
    /// due-time instead of re-basing it on the current clock. Construct the driver and begin enumerating it a
    /// minute later and that minute is not skipped: the first pass emits the whole backlog of cycles back to
    /// back with no delay between them until the schedule catches up with real time. Build this at the moment
    /// the pipeline is about to enumerate it.</para></summary>
    /// <param name="sims">The simulators this driver paces and drains. Stored BY REFERENCE, while the two
    /// per-sim bookkeeping arrays are sized once from <c>sims.Count</c> here — so a caller that keeps a
    /// mutable reference and grows the list afterwards adds simulators this driver will never reach, and one
    /// that shrinks it makes the indexed read in <see cref="ReadAsync"/> throw out of the enumerator. Hand
    /// over a list nobody else still holds.</param>
    public SimulatedDriver(IReadOnlyList<IMachineSimulator> sims)
    {
        if (sims is null) throw new ArgumentNullException(nameof(sims));
        if (sims.Count == 0) throw new ArgumentException("At least one simulator is required.", nameof(sims));

        _sims = sims;
        Id = "sim-driver:" + string.Join(",", _sims.Select(s => s.Descriptor.Code));

        var now = DateTimeOffset.UtcNow;
        _cycleCounters = new long[_sims.Count];
        _nextDueAt = new DateTimeOffset[_sims.Count];
        for (var i = 0; i < _sims.Count; i++) _nextDueAt[i] = now;
    }

    /// <summary>Composed once by the constructor as <c>"sim-driver:"</c> followed by every simulator's
    /// <c>Descriptor.Code</c> joined with commas, so it names the whole fleet this single driver stands for
    /// and its length grows with that fleet rather than being bounded. Fixed for the lifetime of the
    /// instance, which is what <see cref="IDeviceDriver.Id"/> asks of it.
    ///
    /// <para><b>What reads it, measured over every <c>.cs</c> this repository owns at commit
    /// <c>927c0246</c> (2026-08-22):</b> four decorators that FORWARD it unchanged
    /// (<c>ScenarioAwareDriver</c> under <c>src/</c>, and three test-side wrappers), plus
    /// <c>DeviceDriverConformanceSuite</c>, which asserts only that it does not change. Nothing under
    /// <c>src/</c> consumes the string itself — the slot label an alarm targets is produced by
    /// <c>FleetCore.ResolveSlotLabelFor</c>/<c>ResolveConnectorSlotLabel</c> from the roster's declared driver
    /// kind or from a connector instance id, never from this property. That is a statement about this tree;
    /// for a host outside it this is still the only per-instance identity the seam
    /// exposes.</para></summary>
    public string Id { get; }

    /// <summary>Always <c>DriverKinds.Simulated</c> — the one built-in id
    /// <c>DriverKinds.IsFabricated</c> answers <see langword="true"/> for, i.e. the id that marks readings as
    /// manufactured rather than read off a machine.
    ///
    /// <para>🔴 <b>That provenance decision is NOT made through this property, and the distinction is worth
    /// keeping straight:</b> every <c>IsFabricated</c> call site measured on this tree passes a
    /// <c>MachineDescriptor.DriverKind</c> or a historian row's stored kind, not a live driver's
    /// <see cref="Kind"/>. The one production reader of THIS property is
    /// <c>FleetCore.GetDriverHealth()</c>, which copies it into <c>DriverHealthSnapshot.Kind</c>, and
    /// <c>St4i.EngineApi.Alarms.AlarmEvaluator</c> then interpolates it TWICE into the human text of a
    /// degraded/down alarm — the alarm's key and target are the SLOT LABEL, not this. So what this member
    /// decides is a sentence an operator reads, not whether a reading counts as real and not which alarm is
    /// raised.</para></summary>
    public string Kind => DriverKinds.Simulated;

    /// <summary>Always Connected — a pure in-process simulator has no external link to lose.</summary>
    public DriverHealthState Health => DriverHealthState.Connected;

    /// <summary>The pacing loop: on each pass it picks the simulator whose next cycle is due soonest, waits
    /// out the remaining real time, advances that sim's cycle counter and yields exactly one reading. Cycle
    /// numbers handed to a sim therefore start at 1 and count per SIMULATOR, not per stream.
    ///
    /// <para><b>Two distinct exits, and they are not interchangeable.</b> Cancelling
    /// <paramref name="ct"/> throws <see cref="OperationCanceledException"/> out of the enumerator — from the
    /// check at the top of the pass or from the <see cref="Task.Delay(TimeSpan,CancellationToken)"/> — which
    /// is the cancellable-async-iterator contract <see cref="IDeviceDriver.ReadAsync"/> permits. Calling
    /// <see cref="DisposeAsync"/> instead ends the stream with a plain <c>yield break</c> and no exception.
    /// The two are checked at different moments, so a dispose that lands while this loop is parked in its
    /// delay is NOT observed until that delay ends on its own: teardown through
    /// <see cref="DisposeAsync"/> alone is bounded by one cadence, and only cancelling
    /// <paramref name="ct"/> shortens it.</para>
    ///
    /// <para>The cadence used for the NEXT due-time is re-read from
    /// <c>IMachineSimulator.CycleSecondsOverride</c> on every pass and never cached, which is what lets a
    /// live config change take effect on the following cycle with no pipeline restart; it is floored at
    /// <see cref="MinCycleSeconds"/> here as a backstop even though each config-aware simulator already
    /// clamps its own formula.</para></summary>
    /// <param name="ct">Ends the stream by throwing when cancelled. It is honoured while the loop is parked
    /// in its inter-cycle delay, which is where this loop spends nearly all of its time.</param>
    /// <returns>One reading per due cycle, round-robin across the fleet by earliest due-time, paced in real
    /// time — whatever the chosen simulator's own <c>NextCycle</c> hands back, forwarded without
    /// copying or inspection.</returns>
    public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
    {
        while (!_disposed)
        {
            ct.ThrowIfCancellationRequested();

            var idx = NextDueIndex();
            var wait = _nextDueAt[idx] - DateTimeOffset.UtcNow;
            if (wait > TimeSpan.Zero)
            {
                await Task.Delay(wait, ct).ConfigureAwait(false);
            }

            if (_disposed) yield break;

            var sim = _sims[idx];
            _cycleCounters[idx]++;
            var reading = sim.NextCycle(_cycleCounters[idx]);

            // Task 3: re-consulted fresh on EVERY cycle (never cached) — sim.CycleSecondsOverride is a
            // property whose config-aware implementations re-resolve the live MachineConfigStore each
            // time, which is exactly what lets a speedRpm/clampTimeMs/sampleRateHz/reportIntervalSec
            // change made against an already-running fleet take effect on the very next cycle, with no
            // pipeline restart. null (every un-wired simulator) falls back to the pre-Task-3 behaviour.
            var overrideSeconds = sim.CycleSecondsOverride;
            var cadence = overrideSeconds ?? (sim.Descriptor.CycleSeconds > 0 ? sim.Descriptor.CycleSeconds : 1.0);
            if (cadence < MinCycleSeconds) cadence = MinCycleSeconds;
            _nextDueAt[idx] = _nextDueAt[idx].AddSeconds(cadence);

            yield return reading;
        }
    }

    /// <summary>Index of the sim whose next cycle is due soonest (earliest <see cref="_nextDueAt"/>).</summary>
    private int NextDueIndex()
    {
        var best = 0;
        for (var i = 1; i < _nextDueAt.Length; i++)
        {
            if (_nextDueAt[i] < _nextDueAt[best]) best = i;
        }

        return best;
    }

    /// <summary>Sets the flag <see cref="ReadAsync"/> re-tests at the top of each pass and returns a completed
    /// task. Idempotent by construction — the whole operation is one assignment of <see langword="true"/> to a
    /// <see langword="volatile"/> <see cref="bool"/>, so calling it twice, after cancellation, or without ever
    /// having enumerated is the same as calling it once, which is exactly what
    /// <see cref="IDeviceDriver"/>'s type-level idempotence rule asks for.
    ///
    /// <para><b>It releases nothing, because this driver holds nothing to release.</b> There is no socket, no
    /// file handle, no timer and no background task here, and the simulators handed to the constructor are
    /// not disposed — <c>IMachineSimulator</c> declares no disposal at all, so there is nothing this class
    /// could forward and nothing it is withholding. What this does not do is wake a reader: a
    /// <see cref="ReadAsync"/> parked in its inter-cycle delay is not disturbed, so the stream ends up to one
    /// cadence later. Where that latency matters, cancel the enumeration's own token — see
    /// <see cref="ReadAsync"/>'s two exits.</para></summary>
    /// <returns>An already-completed <see cref="ValueTask"/>; this method never yields and never
    /// awaits.</returns>
    public ValueTask DisposeAsync()
    {
        _disposed = true;
        return ValueTask.CompletedTask;
    }
}
