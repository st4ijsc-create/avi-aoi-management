using St4i.Connector.Abstractions.Models;

namespace St4i.Connector.Abstractions;

/// <summary>
/// The single seam every reading SOURCE implements — whether it's <c>SimulatedDriver</c>
/// (this task), a hot-folder AOI watcher (Task 11), or an MQTT subscriber (Task 12). Everything
/// downstream (Task 13's pipeline, Normalizer, Transport) only ever talks to this interface, so
/// P3-P5 drivers (Modbus/OPC-UA/SECS-GEM — doc-62 §11) slot in later without touching the pipeline.
///
/// <para><b>GP-6 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-6-brief.md) — this
/// interface's doc comments (this summary plus each member below) ARE the conformance contract</b> every
/// implementation, first- or third-party, must satisfy — enforced by
/// <c>St4i.Connector.Conformance.DeviceDriverConformanceSuite</c>. Two requirements apply to the type as a
/// whole rather than to any single member, so they are stated here:</para>
///
/// <list type="bullet">
/// <item><description><b>Construction is non-blocking and performs no I/O.</b> A constructor MUST return
/// promptly and must never open a socket/session/file or otherwise block on anything outside the process's
/// own memory. <c>FleetHost.StartLocked</c> constructs drivers under the SAME lock <c>Estop()</c> takes, so a
/// slow constructor blocks <c>Estop()</c> itself from returning for as long as it takes — note that
/// <c>Estop()</c> is a supervisory software halt of this codebase's own read pipeline, not a machine
/// safety function (see <c>FleetHost.Estop</c>'s own doc comment); this rule protects THAT call's
/// latency, nothing more. Any connection/session establishment belongs entirely inside
/// <see cref="ReadAsync"/>, never in the constructor.</description></item>
/// <item><description><b><see cref="IAsyncDisposable.DisposeAsync"/> is idempotent.</b> It must be safe to
/// call more than once, after cancellation, after a completed enumeration, and without
/// <see cref="ReadAsync"/> ever having been enumerated at all — in every one of those cases it must not
/// throw, and it should itself return promptly. <c>FleetHost</c> best-effort disposes drivers on fault and
/// on restart under a BOUNDED budget, so a slow <see cref="DisposeAsync"/> is effectively abandoned, not
/// awaited to completion.</description></item>
/// </list>
/// </summary>
public interface IDeviceDriver : IAsyncDisposable
{
    /// <summary>Stable identifier for this driver instance (for logging/UI, not a machine code) — non-empty
    /// and unchanging for the lifetime of this instance (it keys slot labels and, through those,
    /// alarms).</summary>
    string Id { get; }

    /// <summary>The connector's own id — GP-3 opened this from a closed enum into a free-form string so
    /// a third-party driver can report its own id without touching this assembly. See
    /// <see cref="Models.DriverKinds"/> for the five built-in ids, the casing/normalization rule, and
    /// the recommended (not enforced) third-party naming convention. Non-empty and unchanging for the
    /// lifetime of this instance, same as <see cref="Id"/>.</summary>
    string Kind { get; }

    /// <summary>
    /// Current connectivity/health state — surfaced by the UI (dashboard driver badges). Only the
    /// documented <see cref="DriverHealthState"/> members are ever valid values.
    ///
    /// <para>For a driver that models a connection to something OUTSIDE the process (a real network/serial
    /// link — Modbus/OPC-UA/a third party's own device), this must never report
    /// <see cref="DriverHealthState.Connected"/> while no such device is actually reachable — including
    /// only TRANSIENTLY reporting <see cref="DriverHealthState.Connected"/> partway through an attempt that
    /// ultimately never reaches a real device.</para>
    ///
    /// <para>A driver with no external device at all (e.g. a pure in-process simulator) is exempt from that
    /// specific rule, but MUST say so explicitly in its own class doc comment, and MUST document what
    /// value(s) <see cref="Health"/> takes instead (see <c>SimulatedDriver</c>'s own remarks for the exact
    /// pattern this exemption requires: "Always Connected — a pure in-process simulator has no external
    /// link to lose"). Claiming this exemption without documenting it is itself a conformance
    /// violation.</para>
    /// </summary>
    DriverHealthState Health { get; }

    /// <summary>
    /// Streams readings for as long as <paramref name="ct"/> is not cancelled. Implementations may
    /// throw <see cref="OperationCanceledException"/> from the enumerator when <paramref name="ct"/>
    /// is cancelled — this is the standard cancellable-async-iterator contract.
    ///
    /// <para><b>Cancellation must be honoured promptly, including when no device is reachable at all</b> —
    /// the realistic failure mode this matters for: a device that is powered off, disconnected, or that
    /// accepts a connection but never responds. A driver stuck in a connect/retry loop that ignores
    /// <paramref name="ct"/> cannot be stopped; <c>FleetHost</c>'s teardown waits on this with only a
    /// bounded (few-second) budget before giving up and moving on with the background task orphaned.</para>
    ///
    /// <para><b>A cancellation callback registered on <paramref name="ct"/> (e.g. via
    /// <see cref="System.Threading.CancellationToken.Register(Action)"/>) runs SYNCHRONOUSLY, on the
    /// CANCELLING thread, while the host holds its own internal state lock</b> — <c>FleetHost.Estop()</c>/
    /// <c>Stop()</c> cancel every slot's token from inside the SAME lock that guards every other fleet state
    /// transition, because <see cref="System.Threading.CancellationTokenSource.Cancel()"/> itself invokes
    /// every registered callback inline and rethrows any exception one of them throws. Such a callback
    /// therefore MUST be prompt, MUST NOT throw, and MUST NOT perform blocking I/O — a slow or throwing
    /// registration stalls or corrupts the SAME halt transition (<c>FleetHost.Estop()</c> — a supervisory
    /// software latch on this codebase's own read pipeline, not a machine safety function) every other
    /// member of this contract is written to protect. <c>ModbusTcpDriver.PollOnceAsync</c>'s own
    /// <c>ct.Register(DisposeConnection)</c> is the one existing example: <c>DisposeConnection</c> wraps
    /// each disposal in its own try/catch specifically because of this rule.</para>
    ///
    /// <para><b>Never reuse or mutate a previously-yielded <see cref="Models.DeviceReading"/>.</b> Each
    /// yield must be a distinct instance that is never touched again afterward — not the object itself, and
    /// not any mutable collection it holds (e.g. its <see cref="Models.DeviceReading.Telemetry"/> list, even
    /// if wrapped in a fresh <see cref="Models.DeviceReading"/> each cycle). Consumers keep the exact
    /// reference they were handed: <c>EdgePipeline</c> hands the same reference to the UNS publisher (read
    /// later, on a background thread) and to every <c>Committed</c> subscriber, with no defensive copy. A
    /// driver that pools or mutates a previously-yielded reading corrupts data that has already been
    /// delivered, in a way that is extremely hard to trace back to the driver.</para>
    ///
    /// <para><b>Every yielded <see cref="Models.DeviceReading"/> must round-trip losslessly through
    /// <see cref="Json.ConnectorJson"/>'s canonical wire options</b> — the sidecar-readiness gate (GP-2): a
    /// value that cannot survive that round trip will fail at a future out-of-process boundary instead. See
    /// <see cref="Json.ConnectorObjectConverter"/> for the exact accepted domain of
    /// <see cref="Models.TelemetrySample.Value"/>/<see cref="Models.DeviceReading.Genealogy"/> values.</para>
    /// </summary>
    IAsyncEnumerable<DeviceReading> ReadAsync(CancellationToken ct);
}
