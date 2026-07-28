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
/// </summary>
public sealed class OpcUaDriver : IDeviceDriver
{
    private const string ApplicationName = "St4iOpcUaClient";

    private readonly OpcUaNodeMap _map;
    private readonly string _pkiRoot;
    private readonly Action<string>? _logWarning;
    private readonly Action<Exception, string>? _logError;

    private ApplicationConfiguration? _clientConfig;
    private Session? _session;
    private volatile bool _disposed;

    public OpcUaDriver(
        OpcUaNodeMap map, Action<string>? logWarning = null, Action<Exception, string>? logError = null,
        string? pkiDir = null)
    {
        _map = map ?? throw new ArgumentNullException(nameof(map));
        _pkiRoot = OpcUaPkiPaths.ResolveRoot(pkiDir);
        _logWarning = logWarning;
        _logError = logError;

        Id = $"opcua:{map.EndpointUrl}:{map.MachineCode}";
        Health = DriverHealthState.Down;
    }

    public string Id { get; }

    public DriverKind Kind => DriverKind.OpcUa;

    public DriverHealthState Health { get; private set; }

    /// <summary>The poll loop. Same `yield` OUTSIDE try/catch structure as
    /// <see cref="Modbus.ModbusTcpDriver.ReadAsync"/> (C# forbids a `yield` inside a `catch`-bearing
    /// `try`) — each iteration's connect+read attempt is wrapped in its OWN try/catch that only ever sets
    /// <see cref="Health"/>/logs/tears down the session, never rethrows a non-cancellation exception; the
    /// actual `yield return`/delay happen after that block has already exited.</summary>
    public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            DeviceReading? reading = null;
            try
            {
                await EnsureSessionAsync(ct).ConfigureAwait(false);
                reading = await PollOnceAsync(ct).ConfigureAwait(false);
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
                await DisposeSessionAsync().ConfigureAwait(false);
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

        // CoreClientUtils.SelectEndpoint (sync overload) is the exact call the de-risk gate proved works
        // end-to-end against a real loopback server (task-1-report.md) — the *Async replacement exists
        // (SelectEndpointAsync) but wasn't part of that verified round-trip, so this deliberately keeps the
        // PROVEN overload rather than swapping to an unverified one under time pressure. Same reasoning
        // applies to the obsolete Session.Create overload below.
#pragma warning disable CS0618 // proven overloads — see remark above.
        var selected = CoreClientUtils.SelectEndpoint(config, _map.EndpointUrl, useSecurity: false);
        var endpoint = new ConfiguredEndpoint(null, selected, EndpointConfiguration.Create(config));

        var identity = string.IsNullOrEmpty(_map.Username)
            ? new UserIdentity()
            : new UserIdentity(_map.Username, Encoding.UTF8.GetBytes(_map.Password ?? string.Empty));

        _session = await Session.Create(
            config, endpoint, updateBeforeConnect: false, sessionName: $"St4i-OpcUaDriver-{_map.MachineCode}",
            sessionTimeout: 60000, identity: identity, preferredLocales: null, ct).ConfigureAwait(false);
#pragma warning restore CS0618
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
            TransportQuotas = new TransportQuotas { OperationTimeout = 15000 },
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
    private async Task<DeviceReading> PollOnceAsync(CancellationToken ct)
    {
        var session = _session ?? throw new InvalidOperationException("OPC-UA session not connected.");

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

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;
        Health = DriverHealthState.Down;
        await DisposeSessionAsync().ConfigureAwait(false);
    }
}
