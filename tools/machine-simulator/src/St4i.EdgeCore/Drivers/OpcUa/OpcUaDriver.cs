using System.Linq;
using System.Runtime.CompilerServices;
using System.Text;
using Opc.Ua;
using Opc.Ua.Client;
using Opc.Ua.Configuration;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Drivers.OpcUa;

/// <summary>
/// GĐ3 sub-3 OU-1 — the OPC-UA CLIENT driver: a periodic POLLER (same shape as
/// <see cref="Modbus.ModbusTcpDriver"/> — read a fixed, ordered set of tags every
/// <see cref="OpcUaNodeMap.PollIntervalMs"/>, yield ONE <see cref="DeviceReading"/> per poll) built on the
/// OPC Foundation .NET reference stack (<c>OPCFoundation.NetStandard.Opc.Ua.Client</c> 1.5.378.156, MIT —
/// relicensed from GPLv2/RCL on 2025-12-04, see docs/plans/2026-07-27-giaidoan3-opcua-driver-blueprint.md's
/// licensing-spike note). Proven end-to-end (no real PLC) against an in-process OPC Foundation reference
/// server in <c>OpcUaDriverLoopbackTests</c> — see task-1-report.md for the full de-risk-gate write-up
/// (the exact API surface verified against the installed 1.5.378.156 package, and the ONE real gotcha it
/// surfaced: a too-long pki root path breaks the Directory certificate store's native crypto reload — see
/// <see cref="OpcUaPkiPaths"/>'s own doc comment).
///
/// <para><b>Session setup (MVP scope).</b> Unlike Modbus's plain TCP dial, an OPC-UA session needs an
/// <see cref="ApplicationConfiguration"/> (an app-instance certificate is REQUIRED by the stack even at
/// <see cref="OpcUaSecurityMode.None"/> — it identifies the client to the server's audit log, not for
/// encryption) — built ONCE, lazily, on the first <see cref="EnsureSessionAsync"/> call, and reused across
/// reconnects (only the <see cref="Session"/> itself is rebuilt on a fault, not the app config/cert check).
/// The client auto-generates that certificate into <see cref="OpcUaPkiPaths.ResolveRoot"/> (default
/// <c>%ProgramData%\ST4I\sim\opcua-pki</c>, env-relocatable via <see cref="OpcUaOptions.EnvVarPkiDir"/>).
/// <see cref="Opc.Ua.SecurityConfiguration.AutoAcceptUntrustedCertificates"/> is <see langword="true"/> —
/// acceptable for the MVP/loopback-and-trusted-network scope this task covers; tightening this (validate +
/// pin the SPECIFIC server certificate a real PLC presents, rather than blanket-trusting) is a documented
/// follow-up, same posture the brief calls out for Sign/SignAndEncrypt security modes.</para>
///
/// <para><b>Resilience/health model</b> — identical contract to <see cref="Modbus.ModbusTcpDriver"/>:
/// <see cref="Health"/> starts <see cref="DriverHealthState.Down"/> (ctor never connects — non-blocking),
/// flips to <see cref="DriverHealthState.Connected"/> on a successful poll, and to
/// <see cref="DriverHealthState.Degraded"/> on ANY session-setup/read failure — which also tears down the
/// current <see cref="Session"/> so the NEXT poll iteration reconnects from scratch. A transient failure
/// (server restart, network blip) therefore never throws out of <see cref="ReadAsync"/> — this is what
/// makes it safe to run as its own G2-5 pipeline slot.</para>
///
/// <para><b>Task B-5 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-5-brief.md) — the
/// FIRST OPC-UA write path.</b> This class now also implements <see cref="IWritableDeviceDriver"/>:
/// <see cref="WriteSetpointAsync"/> calls <c>Session.WriteAsync</c> against a single declared node;
/// <see cref="InvokeCommandAsync"/> calls <c>Session.CallAsync</c> against a single declared object/method
/// pair, with every argument re-narrowed from <see cref="OpcUaCommand.Arguments"/>'s own declaration (never
/// guessed from <see cref="Models.CommandRequest.Arguments"/>'s untyped runtime value — B-1's own documented
/// gap). Both accept a <see cref="CancellationToken"/> NATIVELY (no NModbus-style disposal-based workaround
/// is needed or used — see the cancellation remarks below).</para>
///
/// <para><b>Concurrency — deliberately NOT a single all-encompassing lock, unlike <see cref="Modbus.ModbusTcpDriver"/>.</b>
/// NModbus's raw byte stream needed <c>ModbusTcpDriver._ioLock</c> to serialize EVERY I/O call, because that
/// transport has no per-request framing that would survive two logical calls interleaving on it. OPC-UA's
/// binary protocol is different: every response is correlated back to its own request by a
/// <c>RequestHandle</c> over one secure channel, so this driver imposes NO client-side mutual exclusion
/// around a <see cref="Session.ReadAsync"/>/<see cref="Session.WriteAsync"/>/<see cref="Session.CallAsync"/>
/// call itself — <see cref="_sessionLock"/> guards ONLY the narrow "ensure a live session exists,
/// reconnecting from scratch if needed" step (<see cref="AcquireSessionAsync"/>/<see cref="TeardownSessionIfCurrentAsync"/>).
/// The mutable <see cref="_session"/> FIELD is the actual hazard this closes (a poll iteration and a
/// write/command could otherwise race to independently rebuild it — the "write during reconnect" case the
/// task brief calls out, proven closed: task-5-report.md, a real loopback server's own
/// <c>SessionManager.SessionCreated</c> event count stays at 1 even when a poll and a write race to
/// reconnect simultaneously on a fresh driver) — not the I/O itself, which runs OUTSIDE the lock once each
/// caller holds a live <see cref="Session"/> reference.</para>
///
/// <para><b>Correctness under concurrency, not a timing guarantee — an empirically-corrected finding.</b> An
/// earlier version of this design reasoned that <c>RequestHandle</c> correlation alone implies two
/// concurrent calls proceed independently and quickly; task-5-report.md's own tests caught that this is
/// FALSE in general: a real OPC Foundation reference SERVER (the same stack many lightweight OPC-UA servers
/// build on) was found, empirically, to serialize ALL Read/Write/Call dispatch through one NodeManager-wide
/// critical section — so a write genuinely CAN end up queued behind an in-flight poll's read AT THE SERVER,
/// and vice versa, exactly as it might behind a real PLC's own request-processing model. This driver has no
/// way to know, and does not need to control, how any given server chooses to process concurrent requests —
/// what <c>RequestHandle</c> correlation actually guarantees, and what this driver's own tests prove, is
/// CORRECTNESS regardless of that ordering (no deadlock, no corruption, no misdelivered result — see
/// <c>OpcUaDriverWriteTests</c>'s own interleaving tests and their doc comments for the full empirical
/// story), not that either side finishes fast.</para>
///
/// <para><b>Cancellation — honoured natively, no workaround needed.</b> Unlike NModbus's write methods
/// (which take no <see cref="CancellationToken"/> at all, forcing <see cref="Modbus.ModbusTcpDriver"/> to
/// force-close the connection via <c>ct.Register(DisposeConnection)</c> to unblock one), <c>Session.WriteAsync</c>/
/// <c>CallAsync</c> both accept <paramref name="ct"/>-equivalent tokens directly and honour them — measured
/// empirically (task-5-report.md): a call cancelled well before the session's own operation timeout unblocks
/// in ~300ms (matching the cancellation delay, not the full timeout), throwing a <c>ServiceResultException</c>
/// (NOT an <see cref="OperationCanceledException"/> — a real difference from Modbus/the interface's own doc
/// comment's example, caught via <c>catch (Exception) when (ct.IsCancellationRequested)</c>, the same
/// discriminator <see cref="Modbus.ModbusTcpDriver"/> already uses for its own differently-shaped
/// cancellation exception).</para>
///
/// <para><b>Failed vs. Indeterminate — asymmetric between a setpoint write and a command, DELIBERATELY.</b>
/// OPC-UA's Write service is atomic per value: a <c>Bad</c> result status means the server refused the write
/// BEFORE applying anything — there is no partial-write concept — so ANY <c>Bad</c> <see cref="WriteResponse"/>
/// status maps to <see cref="Models.WriteOutcome.Failed"/> (a KNOWN "no", mirroring
/// <see cref="Modbus.ModbusTcpDriver"/>'s own <c>SlaveException</c> branch). A <c>CallAsync</c> is NOT
/// atomic in the same sense: the Call service validates preconditions (does the object/method exist, is it
/// executable, do the input arguments match in count/type) BEFORE invoking the method's own logic, but once
/// invoked, the method may run for real (possibly starting motion) before deciding to report failure on its
/// own — and a client cannot tell those two cases apart from the returned <c>CallMethodResult.StatusCode</c>
/// alone in general. Empirically (task-5-report.md, a real loopback server with an instrumented method):
/// a per-argument rejection (<c>CallMethodResult.InputArgumentResults</c> containing a <c>Bad</c> entry) and
/// the argument-COUNT-level <c>BadArgumentsMissing</c>/<c>BadTooManyArguments</c> codes are PROVEN to occur
/// only BEFORE the method is invoked (confirmed by an independent invocation counter on the test server) —
/// these map to <see cref="Models.WriteOutcome.Failed"/>. Every OTHER <c>Bad</c> status (confirmed, in the
/// same probe, to include the case where the method WAS invoked and then chose to report failure itself) maps
/// to <see cref="Models.WriteOutcome.Indeterminate"/>, with a <c>Detail</c> that says the command may have
/// already been invoked and its physical effect is unconfirmed — never <see cref="Models.WriteOutcome.Failed"/>,
/// which would wrongly tell an operator nothing happened.</para>
///
/// <para><b>Session recovery after a write/command failure — the B-4 Critical #1 shape, checked.</b> B-4
/// found that a timed-out Modbus write left the shared connection open, so the NEXT write silently reused a
/// desynchronised connection and physically reached the device while being reported <c>Indeterminate</c> —
/// because the write path never force-closed the connection on failure, unlike the read path's own
/// documented resilience model. The OPC-UA equivalent was checked, empirically, not assumed: after a
/// GENUINE service-level timeout (a real loopback server, an instrumented method sleeping past the client's
/// own operation timeout) AND after a genuine cancellation, the SAME <see cref="Session"/> was proven
/// (task-5-report.md) to serve the very NEXT call correctly — because OPC-UA's <c>RequestHandle</c>
/// correlation means a late, abandoned response can never be misdelivered as the answer to a later, unrelated
/// call, structurally unlike Modbus's raw byte stream. No forced teardown is therefore needed for
/// correctness on an ordinary write/command timeout or cancellation — this is a DELIBERATE, proven "does not
/// transfer the same way" finding, not an oversight. <see cref="BestEffortReconnectIfUnhealthyAsync"/> is a
/// purely defensive EXTRA on top: if a failure leaves <see cref="Session.Connected"/> reporting unhealthy
/// (e.g. the server process is genuinely gone), it forces a teardown so a driver instance with no ACTIVE
/// poll loop still self-heals on its own next write/command attempt, rather than depending solely on the
/// read loop's resilience model to notice. It is reference-checked (never tears down a session a
/// CONCURRENT reconnect has already superseded) and wrapped in a best-effort <c>catch</c> — see its own doc
/// comment for the B-4 Critical #2 shape this specifically avoids reproducing.</para>
///
/// <para><b>No implicit retry.</b> Neither <see cref="WriteSetpointAsync"/> nor <see cref="InvokeCommandAsync"/>
/// contains a retry loop, and — unlike Modbus, where NModbus's OWN transport-level <c>Retries</c> setting
/// silently resent an unacknowledged write (B-4's own empirical finding) — this OPC-UA client stack has no
/// equivalent hidden retry knob for an ordinary service call (<c>Session.WriteAsync</c>/<c>CallAsync</c> each
/// make exactly ONE service-level attempt; verified empirically, not merely assumed — task-5-report.md).</para>
/// </summary>
public sealed class OpcUaDriver : IWritableDeviceDriver
{
    private const string ApplicationName = "St4iOpcUaClient";

    private readonly OpcUaNodeMap _map;
    private readonly string _pkiRoot;
    private readonly Action<string>? _logWarning;
    private readonly Action<Exception, string>? _logError;
    private readonly int _operationTimeoutMs;

    private ApplicationConfiguration? _clientConfig;
    private Session? _session;
    private volatile bool _disposed;

    /// <summary>Task B-5 — guards <see cref="EnsureSessionAsync"/>/<see cref="DisposeSessionAsync"/> (and
    /// every place that mutates <see cref="_session"/> to reconnect or tear down) against a poll iteration
    /// and a write/command racing each other over that SAME field. Deliberately narrow — see the class doc
    /// comment's "Concurrency" remarks for why this does NOT wrap the actual Read/Write/Call I/O itself.</summary>
    private readonly SemaphoreSlim _sessionLock = new(1, 1);

    /// <summary>Task B-5 — snapshotted ONCE at construction, mirroring <see cref="Modbus.ModbusTcpDriver"/>'s
    /// identical fix-round-1 shape: <see cref="IWritableDeviceDriver.WritablePoints"/> must be "fixed for the
    /// lifetime of this instance" and "effectively immutable... never a live view" — <c>.AsReadOnly()</c> (a
    /// genuine <see cref="System.Collections.ObjectModel.ReadOnlyCollection{T}"/>, not merely an
    /// <see cref="IReadOnlyList{T}"/>-typed reference to <see cref="OpcUaNodeMap"/>'s own freshly-built
    /// <see cref="List{T}"/>) cannot be cast back to a mutable list by a careless or adversarial caller.</summary>
    private readonly IReadOnlyList<string> _writablePoints;

    /// <summary>Task B-5 — the <see cref="IWritableDeviceDriver.Commands"/> mirror of
    /// <see cref="_writablePoints"/>; see that field's own remarks.</summary>
    private readonly IReadOnlyList<string> _commands;

    public OpcUaDriver(
        OpcUaNodeMap map, Action<string>? logWarning = null, Action<Exception, string>? logError = null,
        string? pkiDir = null, int operationTimeoutMs = 15000)
    {
        _map = map ?? throw new ArgumentNullException(nameof(map));
        _pkiRoot = OpcUaPkiPaths.ResolveRoot(pkiDir);
        _logWarning = logWarning;
        _logError = logError;
        _operationTimeoutMs = operationTimeoutMs;

        Id = $"opcua:{map.EndpointUrl}:{map.MachineCode}";
        Health = DriverHealthState.Down;

        _writablePoints = new List<string>(_map.WritablePointNames).AsReadOnly();
        _commands = new List<string>(_map.CommandNames).AsReadOnly();
    }

    public string Id { get; }

    public string Kind => DriverKinds.OpcUa;

    public DriverHealthState Health { get; private set; }

    /// <inheritdoc/>
    public IReadOnlyList<string> WritablePoints => _writablePoints;

    /// <inheritdoc/>
    public IReadOnlyList<string> Commands => _commands;

    /// <summary>The poll loop. Same `yield` OUTSIDE try/catch structure as
    /// <see cref="Modbus.ModbusTcpDriver.ReadAsync"/> (C# forbids a `yield` inside a `catch`-bearing
    /// `try`) — each iteration's connect+read attempt is wrapped in its OWN try/catch that only ever sets
    /// <see cref="Health"/>/logs/tears down the session, never rethrows a non-cancellation exception; the
    /// actual `yield return`/delay happen after that block has already exited.</summary>
    public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            // GP-6b (task-6b-report.md) — same reasoning as ModbusTcpDriver.ReadAsync's own guard: a
            // post-dispose iteration must not rebuild a fresh Session on a driver DisposeAsync has already
            // torn down; the enumeration is over the moment dispose has run.
            if (_disposed)
            {
                yield break;
            }

            DeviceReading? reading = null;
            Session? sessionInUse = null;
            try
            {
                // Task B-5 — _sessionLock spans ONLY the "ensure a live session" step (see the class doc
                // comment's "Concurrency" remarks); the actual read below runs OUTSIDE it, concurrently with
                // any in-flight write/command, which is safe by the same reasoning.
                sessionInUse = await AcquireSessionAsync(ct).ConfigureAwait(false);
                reading = await PollOnceAsync(sessionInUse, ct).ConfigureAwait(false);
                Health = DriverHealthState.Connected;
            }
            catch (OperationCanceledException)
            {
                yield break;
            }
            catch (Exception ex)
            {
                // Resilient by design — see the class doc comment's resilience/health model remarks: a
                // transient session/read failure degrades + tears down the current session so the NEXT
                // iteration reconnects from scratch. It does NOT throw out of this iterator.
                Health = DriverHealthState.Degraded;
                _logError?.Invoke(ex, $"OPC-UA poll failed for {_map.MachineCode}");

                // Only tear down if a session was actually acquired and it was THIS read that failed against
                // it — if AcquireSessionAsync itself threw, EnsureSessionAsync already left _session cleared
                // (it disposes-then-rebuilds internally), so there is nothing stale left to tear down.
                if (sessionInUse is not null)
                {
                    await TeardownSessionIfCurrentAsync(sessionInUse).ConfigureAwait(false);
                }
            }

            if (reading is not null)
            {
                yield return reading;
            }

            try
            {
                await Task.Delay(_map.PollIntervalMs, ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                yield break;
            }
        }
    }

    /// <summary>Lazily builds the client <see cref="ApplicationConfiguration"/> (once — cached in
    /// <see cref="_clientConfig"/>, reused across reconnects) and, whenever there is no live
    /// <see cref="Session"/>, dials a fresh one. Mirrors
    /// <see cref="Modbus.ModbusTcpDriver.EnsureConnectedAsync"/>'s "reuse an already-live connection,
    /// otherwise tear down and rebuild" shape.</summary>
    private async Task EnsureSessionAsync(CancellationToken ct)
    {
        if (_session is { Connected: true })
        {
            return;
        }

        await DisposeSessionAsync().ConfigureAwait(false);

        _clientConfig ??= await BuildClientConfigAsync(ct).ConfigureAwait(false);
        var config = _clientConfig;

        // GP-6b (task-6b-report.md) — CoreClientUtils.SelectEndpoint (the sync overload this used to call)
        // is a SYNCHRONOUS call on this async path that also pins a thread-pool thread and — confirmed by
        // elimination against every OTHER step on this path already taking `ct`
        // (CheckApplicationInstanceCertificatesAsync / Session.Create / session.ReadAsync) — blocks for
        // exactly this driver's own configured TransportQuotas.OperationTimeout (15s) regardless of the
        // caller's token: 5x FleetHost's 3-second teardown budget, and completely uncancellable while in
        // flight. SelectEndpointAsync fixes exactly that — confirmed PRESENT in the installed 1.5.378.156
        // package via reflection against the actual assembly (not inference), with the
        // (config, url, useSecurity, discoverTimeout, ct) shape used below. Reusing
        // config.TransportQuotas.OperationTimeout as discoverTimeout keeps the NON-cancelled bound
        // numerically IDENTICAL to today's behaviour — a genuinely slow-but-healthy endpoint negotiation is
        // unaffected — the fix is purely that it can now also be interrupted via `ct`.
        //
        // Still needs CS0618, contrary to what this fix was expected going in to allow (see
        // task-6b-report.md): this specific overload is ALSO [Obsolete] in 1.5.378.156 (in favour of an
        // ITelemetryContext-taking sibling this codebase does not thread anywhere), and Session.Create below
        // has NO non-obsolete overload in this package version at all — every one points callers at
        // ISessionFactory.CreateAsync, a materially larger client-API migration out of this defect's scope.
#pragma warning disable CS0618 // SelectEndpointAsync (no ITelemetryContext overload) / Session.Create — see remark above.
        var selected = await CoreClientUtils.SelectEndpointAsync(
            config, _map.EndpointUrl, useSecurity: false, config.TransportQuotas.OperationTimeout, ct).ConfigureAwait(false);
        var endpoint = new ConfiguredEndpoint(null, selected, EndpointConfiguration.Create(config));

        var identity = string.IsNullOrEmpty(_map.Username)
            ? new UserIdentity()
            : new UserIdentity(_map.Username, Encoding.UTF8.GetBytes(_map.Password ?? string.Empty));

        var newSession = await Session.Create(
            config, endpoint, updateBeforeConnect: false, sessionName: $"St4i-OpcUaDriver-{_map.MachineCode}",
            sessionTimeout: 60000, identity: identity, preferredLocales: null, ct).ConfigureAwait(false);
#pragma warning restore CS0618

        // GP-6b — Session.Create above already takes `ct`, but DisposeAsync could still have run to
        // completion WHILE it was in flight (there is no lock spanning both), landing a live Session on an
        // already-disposed driver that will never call DisposeSessionAsync again. Close it here instead of
        // leaking it.
        if (_disposed)
        {
            try
            {
                await newSession.CloseAsync(CancellationToken.None).ConfigureAwait(false);
            }
            catch
            {
                // best-effort — same reasoning as DisposeSessionAsync's own catch below.
            }
            finally
            {
                newSession.Dispose();
            }

            throw new OperationCanceledException("OpcUaDriver was disposed while establishing a session.", ct);
        }

        _session = newSession;
    }

    /// <summary>Task B-5 — acquires <see cref="_sessionLock"/>, ensures a live <see cref="Session"/> exists
    /// (reconnecting from scratch if needed, via <see cref="EnsureSessionAsync"/>), and returns it. Used by
    /// BOTH the poll loop and a write/command attempt, so the two can never race to independently rebuild a
    /// session at the same time — the "write during reconnect" case the task brief calls out. The lock is
    /// released BEFORE this method returns; the actual Read/Write/Call I/O that follows runs OUTSIDE it —
    /// see the class doc comment's "Concurrency" remarks for why that is safe.</summary>
    private async Task<Session> AcquireSessionAsync(CancellationToken ct)
    {
        try
        {
            await _sessionLock.WaitAsync(ct).ConfigureAwait(false);
        }
        catch (ObjectDisposedException)
        {
            // A concurrent DisposeAsync already disposed the lock — re-shape as the SAME cancellation-like
            // outcome every existing caller already handles safely (write/call: Indeterminate; the poll
            // loop: yield break) rather than adding a third exception shape for callers to reason about.
            throw new OperationCanceledException("OpcUaDriver was disposed.", ct);
        }

        try
        {
            await EnsureSessionAsync(ct).ConfigureAwait(false);
            return _session ?? throw new InvalidOperationException("OPC-UA session not connected.");
        }
        finally
        {
            ReleaseSessionLock();
        }
    }

    /// <summary>Review fix round 1 (Minor) — <see cref="_sessionLock"/> is now disposed in
    /// <see cref="DisposeAsync"/> (it previously never was). A bare <c>_sessionLock.Release()</c> in a
    /// <c>finally</c> would throw <see cref="ObjectDisposedException"/> if <see cref="DisposeAsync"/> races
    /// and disposes the semaphore WHILE another caller is still holding it — replacing whatever result/
    /// exception was already flowing through that `finally`, the EXACT B-4 Critical #2 shape this whole task
    /// has been careful to avoid reproducing elsewhere. Every <c>Release()</c> call site goes through this
    /// helper instead, so that race is merely a no-op, never a thrown exception that clobbers a real
    /// result.</summary>
    private void ReleaseSessionLock()
    {
        try
        {
            _sessionLock.Release();
        }
        catch (ObjectDisposedException)
        {
            // DisposeAsync already disposed the lock — nothing left to release, and nothing to propagate.
        }
    }

    /// <summary>Task B-5 — tears <see cref="_session"/> down (acquiring <see cref="_sessionLock"/> first),
    /// but ONLY if it is still the SAME object as <paramref name="expected"/> — i.e. only if nobody else (a
    /// concurrent poll iteration, or a concurrent write/command) has already superseded it with a fresh
    /// reconnect. Without this check, a caller holding a now-stale session reference could otherwise tear
    /// down a DIFFERENT, perfectly healthy session a concurrent caller just finished building — wasteful
    /// churn, not silent corruption, but avoidable and caught during this task's own design review
    /// (task-5-report.md) before it ever shipped. Used by the poll loop's own failure handling (mirroring
    /// its pre-B-5 unconditional-teardown behaviour, now reference-safe) — <see cref="BestEffortReconnectIfUnhealthyAsync"/>
    /// uses its OWN non-blocking variant instead (review fix round 1, Minor — see that method's own doc
    /// comment for why blocking here would be wrong for a best-effort caller). Always waits for the lock
    /// with <see cref="CancellationToken.None"/> — this is best-effort cleanup, never something a caller's
    /// own cancellation should be able to skip.</summary>
    private async Task TeardownSessionIfCurrentAsync(Session expected)
    {
        try
        {
            await _sessionLock.WaitAsync(CancellationToken.None).ConfigureAwait(false);
        }
        catch (ObjectDisposedException)
        {
            // A concurrent DisposeAsync already disposed the lock — and its own DisposeSessionAsync() call
            // already tore down whatever session existed. Nothing left for this call to do.
            return;
        }

        try
        {
            if (ReferenceEquals(_session, expected))
            {
                await DisposeSessionAsync().ConfigureAwait(false);
            }
        }
        finally
        {
            ReleaseSessionLock();
        }
    }

    /// <summary>Task B-5 — checked for the SAME shape as B-4's Critical #1 (see the class doc comment's
    /// "Session recovery after a write/command failure" remarks for the full empirical finding: an ordinary
    /// OPC-UA write/call timeout or cancellation does NOT require forcing a session teardown for
    /// correctness). This is a defensive EXTRA, not a required fix: if <paramref name="session"/>'s own
    /// <see cref="Session.Connected"/> already reports unhealthy, force a reference-checked teardown so a
    /// driver instance with no ACTIVE poll loop still self-heals on its own next write/command attempt.
    ///
    /// <para><b>Review fix round 1 (Minor) — a NON-BLOCKING lock attempt, deliberately NOT
    /// <see cref="TeardownSessionIfCurrentAsync"/>'s own blocking wait.</b> This method runs on the
    /// write/command's OWN return path, after a result has already been produced — <see cref="AcquireSessionAsync"/>
    /// can hold <see cref="_sessionLock"/> for the FULL connect budget (a session establishment against a
    /// slow/unresponsive server, bounded only by <see cref="_operationTimeoutMs"/>, e.g. 15s+) if a poll
    /// iteration or another caller is mid-reconnect. Reusing <see cref="TeardownSessionIfCurrentAsync"/>'s
    /// blocking <c>WaitAsync(CancellationToken.None)</c> here would let a "best-effort" self-heal step
    /// withhold an ALREADY-PRODUCED, actionable "check the machine" result from the caller for that same
    /// 15s+ — including past the caller's OWN cancellation, which this step deliberately ignores by design
    /// (<see cref="CancellationToken.None"/>, so the housekeeping itself can't be interrupted mid-teardown).
    /// A zero-timeout <c>WaitAsync(TimeSpan.Zero)</c> is genuinely best-effort instead: if the lock is
    /// contended, this skip is harmless — the NEXT write/command attempt (or the read loop, if one is
    /// running) will observe the SAME unhealthy session and retry the self-heal then.</para>
    ///
    /// <para><b>Why the whole body is wrapped in its own best-effort <c>catch</c> — the B-4 Critical #2
    /// shape, audited.</b> B-4's Critical #2 was a <c>finally</c> that restored a Modbus transport setting on
    /// an object the CANCELLATION path had already disposed BY DESIGN, throwing <see cref="NullReferenceException"/>
    /// and silently discarding the caller's already-produced, carefully-worded <c>Indeterminate</c> result in
    /// favour of a generic backstop message. This method is called from exactly the same kind of place (a
    /// write/command's own failure-handling code, right before returning its real result) and touches the
    /// SAME kind of object (a session a concurrent <see cref="DisposeAsync"/> may be disposing right now) —
    /// so reading <see cref="Session.Connected"/> or tearing the session down here must NEVER be allowed to
    /// throw and replace the real result the caller is about to return. Unlike B-4, this driver has no
    /// analogous `finally`-restores-a-shared-setting construct at all (see the class doc comment: no
    /// per-call session-wide property is mutated and restored), so the EXACT shape does not reproduce here —
    /// but the underlying risk (a best-effort cleanup step touching a possibly-disposed object) is the same
    /// class of hazard, and is guarded the same way: wrapped, swallowed, never load-bearing.</para></summary>
    private async Task BestEffortReconnectIfUnhealthyAsync(Session session)
    {
        try
        {
            if (session.Connected)
            {
                return;
            }

            if (!await _sessionLock.WaitAsync(TimeSpan.Zero).ConfigureAwait(false))
            {
                // Contended — genuinely best-effort: skip rather than wait, see this method's own remarks.
                return;
            }

            try
            {
                if (ReferenceEquals(_session, session))
                {
                    await DisposeSessionAsync().ConfigureAwait(false);
                }
            }
            finally
            {
                ReleaseSessionLock();
            }
        }
        catch
        {
            // best-effort self-heal only — never let this discard the caller's already-produced result.
        }
    }

    /// <summary>Builds the ONE-TIME client <see cref="ApplicationConfiguration"/>: app-instance cert (an
    /// RSA-SHA256 application certificate — the stack requires <see cref="Opc.Ua.SecurityConfiguration.ApplicationCertificates"/>
    /// (the collection, not just the single <see cref="Opc.Ua.SecurityConfiguration.ApplicationCertificate"/>
    /// property) to carry an explicit <see cref="Opc.Ua.CertificateIdentifier.CertificateType"/> or its
    /// setter null-refs — confirmed against 1.5.378.156, see task-1-report.md) auto-generated under
    /// <see cref="_pkiRoot"/> if one doesn't already exist yet (<see cref="ApplicationInstance.DisableCertificateAutoCreation"/>
    /// left at its explicit <see langword="false"/>).</summary>
    private async Task<ApplicationConfiguration> BuildClientConfigAsync(CancellationToken ct)
    {
        var certId = new CertificateIdentifier
        {
            StoreType = "Directory",
            StorePath = Path.Combine(_pkiRoot, "own"),
            SubjectName = $"CN={ApplicationName}",
            CertificateType = ObjectTypeIds.RsaSha256ApplicationCertificateType,
        };

        var config = new ApplicationConfiguration
        {
            ApplicationName = ApplicationName,
            ApplicationUri = $"urn:{Environment.MachineName}:{ApplicationName}",
            ApplicationType = ApplicationType.Client,
            SecurityConfiguration = new SecurityConfiguration
            {
                ApplicationCertificate = certId,
                ApplicationCertificates = new CertificateIdentifierCollection { certId },
                TrustedPeerCertificates = new CertificateTrustList
                {
                    StoreType = "Directory", StorePath = Path.Combine(_pkiRoot, "trusted"),
                },
                TrustedIssuerCertificates = new CertificateTrustList
                {
                    StoreType = "Directory", StorePath = Path.Combine(_pkiRoot, "issuers"),
                },
                RejectedCertificateStore = new CertificateTrustList
                {
                    StoreType = "Directory", StorePath = Path.Combine(_pkiRoot, "rejected"),
                },
                // MVP/loopback posture — see the class doc comment's session-setup remarks for the
                // documented follow-up (validate + pin specific server certs instead).
                AutoAcceptUntrustedCertificates = true,
                AddAppCertToTrustedStore = true,
            },
            TransportConfigurations = new TransportConfigurationCollection(),
            // Task B-5 — configurable (default 15000, unchanged from before this task) so a test can prove a
            // GENUINE write/call timeout without waiting out 15 real seconds; production callers never pass
            // this constructor parameter and get today's exact behavior.
            TransportQuotas = new TransportQuotas { OperationTimeout = _operationTimeoutMs },
            ClientConfiguration = new ClientConfiguration { DefaultSessionTimeout = 60000 },
        };

#pragma warning disable CS0618 // Validate/ApplicationInstance(config) — proven overloads, see EnsureSessionAsync's remark.
        await config.Validate(ApplicationType.Client).ConfigureAwait(false);
        var appInstance = new ApplicationInstance(config) { DisableCertificateAutoCreation = false };
#pragma warning restore CS0618
        await appInstance.CheckApplicationInstanceCertificatesAsync(silent: true, ct: ct).ConfigureAwait(false);

        return config;
    }

    /// <summary>Reads every configured node in ONE batched <see cref="Session.ReadAsync"/> call (unlike
    /// Modbus's one-register-per-round-trip — OPC-UA's Read service is natively batched) and boxes each
    /// <see cref="DataValue.Value"/> into a <see cref="TelemetrySample"/>, bundled into a single
    /// <see cref="DeviceReading"/> for this poll. A per-node bad/uncertain <see cref="StatusCode"/> does
    /// NOT fail the whole poll — that metric is emitted with <c>Quality="bad"</c>/a null value instead (see
    /// <see cref="BoxValue"/>'s doc comment for exactly which .NET type each OPC-UA scalar type becomes).</summary>
    private async Task<DeviceReading> PollOnceAsync(Session session, CancellationToken ct)
    {
        var nodesToRead = new ReadValueIdCollection();
        foreach (var node in _map.Nodes)
        {
            nodesToRead.Add(new ReadValueId { NodeId = new NodeId(node.NodeId), AttributeId = Attributes.Value });
        }

        var response = await session.ReadAsync(null, 0, TimestampsToReturn.Neither, nodesToRead, ct)
            .ConfigureAwait(false);

        var samples = new List<TelemetrySample>(_map.Nodes.Count);
        for (var i = 0; i < _map.Nodes.Count; i++)
        {
            var node = _map.Nodes[i];
            var dv = response.Results[i];

            if (!StatusCode.IsGood(dv.StatusCode))
            {
                samples.Add(new TelemetrySample(node.Metric, null, node.Unit, "bad"));
                continue;
            }

            samples.Add(new TelemetrySample(node.Metric, BoxValue(dv.Value), node.Unit, "good"));
        }

        return new DeviceReading
        {
            MachineCode = _map.MachineCode,
            Kind = ReadingKind.Telemetry,
            // Telemetry has no pass/fail concept (the Modbus KPI-inflation lesson, G2-6) — Verdict MUST be
            // Skip, not the enum default (Pass). FleetHost.OnPipelineCommitted increments the fleet-wide
            // FPY/judged/pass KPIs for any reading whose Verdict != Skip, so a defaulted Pass here would
            // silently inflate the operator FPY toward 100% on every OPC-UA poll.
            Verdict = Verdict.Skip,
            Telemetry = samples,
            Timestamp = DateTimeOffset.UtcNow,
        };
    }

    /// <summary>Unboxes an OPC-UA <see cref="Variant"/>'s raw <see cref="DataValue.Value"/> into the
    /// telemetry value this driver emits. Deliberately minimal (mirrors
    /// <see cref="Modbus.ModbusRegister"/>'s "no fancy decode" scope): every signed/unsigned integer and
    /// floating-point <see cref="BuiltInType"/> (SByte/Byte/Int16/UInt16/Int32/UInt32/Int64/UInt64/Float/
    /// Double) widens to <see cref="double"/> — one uniform numeric representation, same as
    /// <see cref="Modbus.ModbusTcpDriver"/>'s <see cref="TelemetrySample"/> values; <see cref="bool"/> and
    /// <see cref="string"/> pass through as their native .NET type. Anything else (arrays, structured/
    /// extension-object types, a null value) falls back to <see cref="object.ToString"/> (or
    /// <see langword="null"/> for an actual null) rather than throwing — an unexpected node's VALUE never
    /// takes down the whole poll (complex/structured-type decoding is a documented follow-up, same as the
    /// GĐ3 sub-3 blueprint's "Deferred" list already calls out).</summary>
    private static object? BoxValue(object? raw) => raw switch
    {
        null => null,
        bool b => b,
        sbyte v => (double)v,
        byte v => (double)v,
        short v => (double)v,
        ushort v => (double)v,
        int v => (double)v,
        uint v => (double)v,
        long v => (double)v,
        ulong v => (double)v,
        float v => (double)v,
        double v => v,
        string s => s,
        _ => raw.ToString(),
    };

    /// <summary>Best-effort, idempotent teardown of the current session — called both on a poll failure
    /// (forces a fresh reconnect next iteration) and from <see cref="DisposeAsync"/>.</summary>
    private async Task DisposeSessionAsync()
    {
        var session = _session;
        _session = null;
        if (session is null)
        {
            return;
        }

        try
        {
            await session.CloseAsync(CancellationToken.None).ConfigureAwait(false);
        }
        catch
        {
            // best-effort — a session whose underlying channel already faulted must not block teardown.
        }
        finally
        {
            session.Dispose();
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Task B-5 — IWritableDeviceDriver: WriteSetpointAsync (a single declared node) and InvokeCommandAsync
    // (a single declared object/method pair). See the class doc comment for the concurrency, cancellation,
    // Failed-vs-Indeterminate, and session-recovery decisions both methods below share.
    // ─────────────────────────────────────────────────────────────────────

    /// <inheritdoc/>
    public async Task<SetpointWriteResult> WriteSetpointAsync(SetpointWriteRequest request, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(request);

        var node = FindNodeByMetric(request.Point);
        if (node is null)
        {
            return new SetpointWriteResult(request.Point, WriteOutcome.Rejected, SetpointRejectionReason.UnknownPoint,
                $"'{request.Point}' does not name a node this map declares.");
        }

        if (node.Writable is null)
        {
            return new SetpointWriteResult(request.Point, WriteOutcome.Rejected, SetpointRejectionReason.NotWritable,
                $"'{request.Point}' is declared read-only in this map.");
        }

        // B-3's own guarantee (OpcUaWritableSetpoint.TryNarrowForWrite) — enforces the declared [min,max],
        // finiteness (NaN rejected), and narrowing to the declared value type. Called here, never re-derived.
        if (!node.Writable.TryNarrowForWrite(request.Value, out var narrowedValue, out var rangeError))
        {
            return new SetpointWriteResult(request.Point, WriteOutcome.Rejected, SetpointRejectionReason.OutOfRange, rangeError);
        }

        if (_disposed)
        {
            return new SetpointWriteResult(request.Point, WriteOutcome.Indeterminate, Detail: "this driver has already been disposed.");
        }

        try
        {
            return await ExecuteWriteAsync(request.Point, node.NodeId, narrowedValue!, ct).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            // Final backstop — B-1's contract: neither write method may EVER let an exception propagate, for
            // any reason. Every specific, well-understood failure is already translated inside
            // ExecuteWriteAsync; this only catches something genuinely unforeseen.
            return new SetpointWriteResult(request.Point, WriteOutcome.Indeterminate, Detail: $"unexpected failure: {ex.Message}");
        }
    }

    /// <inheritdoc/>
    public async Task<CommandResult> InvokeCommandAsync(CommandRequest request, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(request);

        var command = FindCommandByName(request.Command);
        if (command is null)
        {
            return new CommandResult(request.Command, WriteOutcome.Rejected, CommandRejectionReason.UnknownCommand,
                $"'{request.Command}' does not name a command this map declares.");
        }

        var declaredArguments = command.Arguments ?? Array.Empty<CommandArgumentDeclaration>();

        // Shared library logic (St4i.Connector.Abstractions) — re-narrows EVERY supplied argument against
        // its OWN declared type (B-1's documented gap: an OPC-UA UInt16 argument arrives here as a boxed
        // `long`, with no type information of its own, and must be re-narrowed from the declaration, never
        // guessed from the runtime value). Also catches a missing required argument and an unknown-named one.
        if (!CommandArgumentDeclaration.TryNarrowAll(declaredArguments, request.Arguments, out var narrowedByName, out var argumentError))
        {
            return new CommandResult(request.Command, WriteOutcome.Rejected, CommandRejectionReason.InvalidArgument, argumentError);
        }

        if (_disposed)
        {
            return new CommandResult(request.Command, WriteOutcome.Indeterminate, Detail: "this driver has already been disposed.");
        }

        // OPC-UA's Call service takes POSITIONAL input arguments (a VariantCollection, no names on the
        // wire) — order them exactly as the map declared them, never the (unordered) dictionary's own order.
        var orderedArguments = new List<object>(declaredArguments.Count);
        foreach (var declaration in declaredArguments)
        {
            orderedArguments.Add(narrowedByName[declaration.Name]!);
        }

        try
        {
            return await ExecuteCallAsync(request.Command, command.ObjectNodeId, command.MethodNodeId, orderedArguments, ct).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            // Final backstop — see WriteSetpointAsync's own remarks; identical reasoning.
            return new CommandResult(request.Command, WriteOutcome.Indeterminate, Detail: $"unexpected failure: {ex.Message}");
        }
    }

    private OpcUaNode? FindNodeByMetric(string metric)
    {
        foreach (var node in _map.Nodes)
        {
            if (string.Equals(node.Metric, metric, StringComparison.Ordinal))
            {
                return node;
            }
        }

        return null;
    }

    private OpcUaCommand? FindCommandByName(string name)
    {
        foreach (var command in _map.Commands)
        {
            if (string.Equals(command.Name, name, StringComparison.Ordinal))
            {
                return command;
            }
        }

        return null;
    }

    /// <summary>Task B-5 — the actual I/O for <see cref="WriteSetpointAsync"/>: acquires a live
    /// <see cref="Session"/> (see <see cref="AcquireSessionAsync"/>), issues ONE <c>Session.WriteAsync</c>
    /// call carrying exactly one <see cref="WriteValue"/>, and translates every outcome — never lets
    /// anything propagate. See the class doc comment for why a <c>Bad</c> write status always maps to
    /// <see cref="WriteOutcome.Failed"/> (OPC-UA's Write service is atomic per value — never a partial
    /// write), unlike <see cref="ExecuteCallAsync"/>'s own, deliberately different, mapping.</summary>
    private async Task<SetpointWriteResult> ExecuteWriteAsync(string point, string nodeId, object narrowedValue, CancellationToken ct)
    {
        Session session;
        try
        {
            session = await AcquireSessionAsync(ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return new SetpointWriteResult(point, WriteOutcome.Indeterminate,
                Detail: $"cancelled while establishing the device session for '{point}' — the write was never attempted.");
        }
        catch (Exception ex)
        {
            return new SetpointWriteResult(point, WriteOutcome.Indeterminate,
                Detail: $"could not reach the device for '{point}': {ex.Message}");
        }

        WriteValue writeValue;
        try
        {
            writeValue = new WriteValue
            {
                NodeId = new NodeId(nodeId),
                AttributeId = Attributes.Value,
                Value = new DataValue(ToVariant(narrowedValue)),
            };
        }
        catch (Exception ex)
        {
            // Review fix round 1 (Important #1) — B-3's OpcUaNodeMap.FromJson validates only that a
            // declared NodeId is non-blank, never that it PARSES (new NodeId(string) can throw
            // ServiceResultException OR ArgumentException for a malformed string — confirmed empirically,
            // task-5-report.md). This construction used to sit OUTSIDE any try, so a malformed map's NodeId
            // fell through to the generic backstop's "unexpected failure: {ex.Message}" — losing the one
            // fact that actually matters here: NO I/O was attempted at all (this happens before WriteAsync
            // is ever called), so this is provably a map defect, not a device ambiguity. Consistent with
            // "could not reach the device" above (also a provably-untouched-device case reported the same
            // way in this class) — Indeterminate, not Rejected, but with a Detail that says exactly that.
            return new SetpointWriteResult(point, WriteOutcome.Indeterminate,
                Detail: $"'{point}' was never sent to the device — its declared nodeId ('{nodeId}') failed to parse ({ex.Message}); fix the map's nodeId for this point.");
        }

        try
        {
            var response = await session.WriteAsync(null, new WriteValueCollection { writeValue }, ct).ConfigureAwait(false);
            var status = response.Results[0];

            if (StatusCode.IsGood(status))
            {
                return new SetpointWriteResult(point, WriteOutcome.Applied);
            }

            // The Write service is atomic per value — a Bad status means the server explicitly refused this
            // write BEFORE applying anything (see the class doc comment's "Failed vs. Indeterminate" remarks).
            return new SetpointWriteResult(point, WriteOutcome.Failed,
                Detail: $"device rejected the write to '{point}': {status}");
        }
        catch (Exception) when (ct.IsCancellationRequested)
        {
            await BestEffortReconnectIfUnhealthyAsync(session).ConfigureAwait(false);
            return new SetpointWriteResult(point, WriteOutcome.Indeterminate,
                Detail: $"cancelled before a definitive response arrived for '{point}' — whether the device applied the value is unconfirmed.");
        }
        catch (Exception ex)
        {
            await BestEffortReconnectIfUnhealthyAsync(session).ConfigureAwait(false);
            return new SetpointWriteResult(point, WriteOutcome.Indeterminate,
                Detail: $"write to '{point}' did not complete ({ex.Message}) — whether the device applied the value is unconfirmed.");
        }
    }

    /// <summary>Task B-5 — the actual I/O for <see cref="InvokeCommandAsync"/>: acquires a live
    /// <see cref="Session"/>, issues ONE <c>Session.CallAsync</c> call carrying exactly one
    /// <see cref="CallMethodRequest"/>, and translates every outcome. See the class doc comment for the
    /// Failed-vs-Indeterminate distinction this method alone needs (unlike a setpoint write, a command is
    /// NOT atomic — the method may already have run, possibly starting motion, before reporting failure).</summary>
    private async Task<CommandResult> ExecuteCallAsync(
        string commandName, string objectNodeId, string methodNodeId, IReadOnlyList<object> orderedArguments, CancellationToken ct)
    {
        Session session;
        try
        {
            session = await AcquireSessionAsync(ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return new CommandResult(commandName, WriteOutcome.Indeterminate,
                Detail: $"cancelled while establishing the device session for '{commandName}' — it was never invoked.");
        }
        catch (Exception ex)
        {
            return new CommandResult(commandName, WriteOutcome.Indeterminate,
                Detail: $"could not reach the device for '{commandName}': {ex.Message}");
        }

        CallMethodRequest callRequest;
        try
        {
            callRequest = new CallMethodRequest
            {
                ObjectId = new NodeId(objectNodeId),
                MethodId = new NodeId(methodNodeId),
                InputArguments = new VariantCollection(orderedArguments.Select(ToVariant)),
            };
        }
        catch (Exception ex)
        {
            // Review fix round 1 (Important #1) — the identical shape as ExecuteWriteAsync's own fix above,
            // and the HIGHER-risk one: a malformed objectNodeId/methodNodeId used to fall through to the
            // generic backstop ("unexpected failure: {ex.Message}"), destroying the one message that matters
            // for a COMMAND — whether it started. This is provably NOT that case (CallAsync is never
            // reached), so it says so plainly instead of leaving an operator to wonder.
            return new CommandResult(commandName, WriteOutcome.Indeterminate,
                Detail: $"'{commandName}' was never invoked — its declared objectNodeId/methodNodeId ('{objectNodeId}' / '{methodNodeId}') failed to parse ({ex.Message}); fix the map's command declaration.");
        }

        try
        {
            var response = await session.CallAsync(null, new CallMethodRequestCollection { callRequest }, ct).ConfigureAwait(false);
            var result = response.Results[0];

            if (StatusCode.IsGood(result.StatusCode))
            {
                return new CommandResult(commandName, WriteOutcome.Applied);
            }

            if (IsPreInvocationCallRejection(result))
            {
                return new CommandResult(commandName, WriteOutcome.Failed,
                    Detail: $"device rejected '{commandName}' before invoking it: {result.StatusCode}");
            }

            // NOT provably pre-invocation — the method may already have run (and possibly started motion)
            // before choosing to report failure itself (see the class doc comment's "Failed vs. Indeterminate"
            // remarks, and task-5-report.md's empirical proof that a real server can do exactly this). This is
            // the highest-risk outcome this whole interface exists to represent honestly.
            return new CommandResult(commandName, WriteOutcome.Indeterminate,
                Detail: $"'{commandName}' reported failure ({result.StatusCode}) after possibly having already run — " +
                        "whether it started is unconfirmed; check the machine before retrying.");
        }
        catch (Exception) when (ct.IsCancellationRequested)
        {
            await BestEffortReconnectIfUnhealthyAsync(session).ConfigureAwait(false);
            return new CommandResult(commandName, WriteOutcome.Indeterminate,
                Detail: $"cancelled before a definitive response arrived for '{commandName}' — whether it started is unconfirmed; check the machine before retrying.");
        }
        catch (Exception ex)
        {
            await BestEffortReconnectIfUnhealthyAsync(session).ConfigureAwait(false);
            return new CommandResult(commandName, WriteOutcome.Indeterminate,
                Detail: $"'{commandName}' did not complete ({ex.Message}) — whether it started is unconfirmed; check the machine before retrying.");
        }
    }

    /// <summary>Task B-5 — the confidently-provable "the method was never invoked" signals available from a
    /// <see cref="CallMethodResult"/> without seeing the server's own internals, per the OPC-UA specification
    /// (Part 4 §5.11.2, Call Service) — the FULL precondition table the Call service is specified to check
    /// BEFORE ever invoking the method's own logic, not just the argument-shape subset of it:
    /// <list type="bullet">
    /// <item><description>a per-argument rejection (<see cref="CallMethodResult.InputArgumentResults"/>
    /// contains a <c>Bad</c> entry — argument presence/type/range, checked before invocation);</description></item>
    /// <item><description><see cref="StatusCodes.BadArgumentsMissing"/>/<see cref="StatusCodes.BadTooManyArguments"/>
    /// — the SAME check, one level up (argument COUNT; <see cref="CallMethodResult.InputArgumentResults"/>
    /// stays empty for these two specifically, since there is no single argument to point at);</description></item>
    /// <item><description><see cref="StatusCodes.BadNodeIdUnknown"/>/<see cref="StatusCodes.BadNodeIdInvalid"/>
    /// — the declared <c>objectId</c>/<c>methodId</c> does not resolve to a real node at all (a map typo
    /// pointing at a NodeId the server has never heard of);</description></item>
    /// <item><description><see cref="StatusCodes.BadMethodInvalid"/> — the declared <c>methodId</c> resolves
    /// to a real node, but that node is not a callable method on the given object;</description></item>
    /// <item><description><see cref="StatusCodes.BadNotExecutable"/>/<see cref="StatusCodes.BadUserAccessDenied"/>
    /// — the method exists but this session may not currently invoke it (state/permission gate).</description></item>
    /// </list>
    /// Review fix round 1 (Important #2) — the original version of this method allowlisted ONLY the
    /// argument-shape entries above, missing the node/method-identity ones from the SAME spec table, even
    /// though they satisfy this method's own stated criterion exactly. Consequence, reproduced empirically
    /// (task-5-report.md): a typo'd command/object/method name in the MAP (never touched by a caller at all)
    /// produced <see cref="Models.WriteOutcome.Indeterminate"/> — "check the machine" — for a command that
    /// provably never ran, the server's own invocation counter staying at 0 throughout. Every entry above is
    /// now empirically confirmed the same way: the counter stays at 0 for each, and increments for anything
    /// NOT on this list — i.e. the method genuinely ran. Deliberately still NOT a larger allowlist of
    /// "probably safe" vendor-specific codes beyond this spec-guaranteed table — anything off this list is
    /// treated as possibly-post-invocation (see <see cref="ExecuteCallAsync"/>'s own remarks), because the
    /// wrong direction to be confident in is claiming "nothing happened" when it might have.</summary>
    private static bool IsPreInvocationCallRejection(CallMethodResult result)
    {
        if (result.InputArgumentResults is { Count: > 0 } argumentResults)
        {
            foreach (var argumentStatus in argumentResults)
            {
                if (StatusCode.IsBad(argumentStatus))
                {
                    return true;
                }
            }
        }

        return result.StatusCode == StatusCodes.BadArgumentsMissing
            || result.StatusCode == StatusCodes.BadTooManyArguments
            || result.StatusCode == StatusCodes.BadNodeIdUnknown
            || result.StatusCode == StatusCodes.BadNodeIdInvalid
            || result.StatusCode == StatusCodes.BadMethodInvalid
            || result.StatusCode == StatusCodes.BadNotExecutable
            || result.StatusCode == StatusCodes.BadUserAccessDenied;
    }

    /// <summary>Task B-5 — narrows a value already-narrowed by <see cref="OpcUaWritableSetpoint.TryNarrowForWrite"/>/
    /// <see cref="CommandArgumentDeclaration.TryNarrow"/> (a <see langword="bool"/>/<see langword="short"/>/
    /// <see langword="ushort"/>/<see langword="int"/>/<see langword="uint"/>/<see langword="double"/>/
    /// <see langword="string"/> — the exact CLR type the map declared) into the <see cref="Variant"/> an OPC-UA
    /// <see cref="WriteValue"/>/<see cref="CallMethodRequest"/> needs on the wire. Deliberately a type-safe
    /// <see langword="switch"/> over each EXACT typed <see cref="Variant"/> constructor, never the generic
    /// <c>new Variant(object)</c> overload's own runtime-type inference — removing any doubt about whether
    /// boxing preserves the precise wire type (e.g. a boxed <see langword="ushort"/> genuinely becoming a
    /// <see cref="BuiltInType.UInt16"/> <see cref="Variant"/>, not silently widening to something else).</summary>
    private static Variant ToVariant(object value) => value switch
    {
        bool b => new Variant(b),
        short s => new Variant(s),
        ushort us => new Variant(us),
        int i => new Variant(i),
        uint ui => new Variant(ui),
        double d => new Variant(d),
        string str => new Variant(str),
        _ => throw new ArgumentOutOfRangeException(nameof(value), value, "unreachable — every narrowed value type is listed above."),
    };

    /// <summary>Review fix round 1 — recorded, deliberately NOT fixed, per the reviewer's own instruction to
    /// write it down rather than silently accept the tradeoff.
    ///
    /// <para><b>This method deliberately does NOT acquire <see cref="_sessionLock"/> before mutating
    /// <see cref="_session"/> (via <see cref="DisposeSessionAsync"/>).</b> Mirrors B-2/B-4's own signed-off
    /// "disposal never waits on in-flight work, not even boundedly" design (a driver <c>DisposeAsync</c> can
    /// run while <c>FleetHost._gate</c>/<c>FleetHost.Estop</c> is involved, and this class has no way to know
    /// that). The PRE-EXISTING GP-6b race this preserves: <see cref="EnsureSessionAsync"/>'s own late
    /// <c>if (_disposed)</c> check before assigning <c>_session = newSession</c> is not airtight — a narrow
    /// window between that check and the assignment is not covered by any lock, so <see cref="DisposeAsync"/>
    /// can still, in principle, complete WHILE a session is being established, landing a live
    /// <see cref="Session"/> on an already-disposed driver that never gets torn down again. <see cref="_sessionLock"/>
    /// (introduced by this task) COULD close this — <see cref="DisposeAsync"/> could acquire it before
    /// tearing down — but deliberately does not, because doing so would make HALT/disposal wait on whatever
    /// currently holds the lock (a full session-establishment attempt against a slow server, up to
    /// <see cref="_operationTimeoutMs"/>), recreating exactly the coupling B-2's own design exists to
    /// forbid. This is a defensible, ACCEPTED tradeoff, not an oversight — written down here so it reads as
    /// one.</para>
    ///
    /// <para><b><see cref="DisposeSessionAsync"/> calls <c>session.CloseAsync(CancellationToken.None)</c> —
    /// a network round-trip that can block up to this driver's own configured operation timeout (15s by
    /// default) against a hung server.</b> This runs on <see cref="DisposeAsync"/>'s OWN path, which is also
    /// the HALT path — a 3-second budget elsewhere in this system (<c>FleetHost</c>'s own teardown budget).
    /// This task's own dispose-racing-a-stuck-write test (<c>DisposeAsync_WhileCommandIsStuckMidFlight_...</c>)
    /// only exercises a LIVE server (the stuck command's own connection, not the close call against a
    /// server that has itself gone unresponsive) — the close-against-a-hung-server case is UNTESTED here.
    /// B-6/B-8 need to know this before building HALT-path guarantees on top of this driver.</para></summary>
    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;
        Health = DriverHealthState.Down;
        await DisposeSessionAsync().ConfigureAwait(false);
        _sessionLock.Dispose();
    }
}
