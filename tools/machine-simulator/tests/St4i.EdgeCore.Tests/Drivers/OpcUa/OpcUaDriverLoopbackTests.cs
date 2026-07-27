using System.Net;
using System.Net.Sockets;
using System.Runtime.CompilerServices;
using Opc.Ua;
using Opc.Ua.Server;
using St4i.EdgeCore.Drivers.OpcUa;
using St4i.EdgeCore.Models;
using Xunit;
using Session = Opc.Ua.Client.Session;

namespace St4i.EdgeCore.Tests.Drivers.OpcUa;

/// <summary>
/// GĐ3 sub-3 OU-1 — the de-risk-gate proof, promoted into a real test: stands up a REAL in-process OPC
/// Foundation reference SERVER (<c>OPCFoundation.NetStandard.Opc.Ua.Server</c> 1.5.378.156, test-only — see
/// the .csproj comment) exposing a couple of variable nodes with known values on a DYNAMIC free port (never
/// a fixed port, mirroring <c>ModbusTcpDriverLoopbackTests</c>'s own "find a free port, then reuse the
/// number" idiom), and drives a real <see cref="OpcUaDriver"/> against it — proving the ENTIRE stack
/// (app-instance certificate auto-creation, endpoint selection, anonymous session creation, a batched Read)
/// on <c>net10.0-windows</c> end-to-end, no real PLC.
///
/// <para><b>Pki path length (de-risk gate finding — see task-1-report.md).</b> Both this test's own server
/// config AND the driven <see cref="OpcUaDriver"/>'s client config are pointed at a SHORT temp pki root
/// (<see cref="Path.GetTempPath"/>-based, not this repo's own deeply-nested build output path) — the OPC
/// Foundation stack's Directory certificate store reload silently fails once the full
/// <c>root\certs\&lt;subject&gt; [&lt;thumbprint&gt;].der</c> path gets close to Windows' legacy MAX_PATH,
/// which is exactly what the de-risk gate hit (and root-caused) under a deeply-nested sandbox scratch
/// directory before switching to a short path.</para>
///
/// <para>All waits are bounded polling (<see cref="WaitUntilAsync"/>), never a fixed <c>Task.Delay</c> for
/// correctness. <see cref="PollTimeout"/> is deliberately more generous than
/// <c>ModbusTcpDriverLoopbackTests</c>'s 5s — OPC-UA session setup (app-instance cert check + endpoint
/// discovery + CreateSession + ActivateSession) is slower than a bare Modbus TCP dial — but still bounded.
/// Serialized (via <see cref="OpcUaTestCollection"/>) against this task's OWN sibling test classes to avoid
/// the same kind of peak-concurrent-socket-load flakiness <c>SiteTestCollection</c> already documents for
/// itself.</para>
/// </summary>
[Collection("St4i.EdgeCore.Tests.OpcUa")]
public sealed class OpcUaDriverLoopbackTests
{
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(20);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(100);

    private static async Task WaitUntilAsync(Func<bool> predicate, string because)
    {
        var deadline = DateTime.UtcNow + PollTimeout;
        while (DateTime.UtcNow < deadline)
        {
            if (predicate()) return;
            await Task.Delay(PollInterval);
        }

        Assert.True(predicate(), $"timed out after {PollTimeout} waiting for: {because}");
    }

    private static int FindFreePort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    /// <summary>Builds a minimal SERVER <see cref="ApplicationConfiguration"/> (SecurityMode None,
    /// anonymous) — the test-only counterpart of <c>OpcUaDriver.BuildClientConfigAsync</c>, sharing the
    /// same "app-instance cert under a short pki root, AutoAcceptUntrustedCertificates" shape.</summary>
    private static async Task<ApplicationConfiguration> BuildServerConfigAsync(string pkiRoot, string endpointUrl)
    {
        var certId = new CertificateIdentifier
        {
            StoreType = "Directory",
            StorePath = Path.Combine(pkiRoot, "server-own"),
            SubjectName = "CN=St4iOpcUaTestServer",
            CertificateType = ObjectTypeIds.RsaSha256ApplicationCertificateType,
        };

        var config = new ApplicationConfiguration
        {
            ApplicationName = "St4iOpcUaTestServer",
            ApplicationUri = $"urn:{Environment.MachineName}:St4iOpcUaTestServer",
            ApplicationType = ApplicationType.Server,
            SecurityConfiguration = new SecurityConfiguration
            {
                ApplicationCertificate = certId,
                ApplicationCertificates = new CertificateIdentifierCollection { certId },
                TrustedPeerCertificates = new CertificateTrustList { StoreType = "Directory", StorePath = Path.Combine(pkiRoot, "trusted") },
                TrustedIssuerCertificates = new CertificateTrustList { StoreType = "Directory", StorePath = Path.Combine(pkiRoot, "issuers") },
                RejectedCertificateStore = new CertificateTrustList { StoreType = "Directory", StorePath = Path.Combine(pkiRoot, "rejected") },
                AutoAcceptUntrustedCertificates = true,
                AddAppCertToTrustedStore = true,
            },
            TransportConfigurations = new TransportConfigurationCollection(),
            TransportQuotas = new TransportQuotas { OperationTimeout = 15000 },
            ServerConfiguration = new ServerConfiguration
            {
                BaseAddresses = new StringCollection { endpointUrl },
                SecurityPolicies = new ServerSecurityPolicyCollection
                {
                    new ServerSecurityPolicy { SecurityMode = MessageSecurityMode.None, SecurityPolicyUri = SecurityPolicies.None },
                },
                UserTokenPolicies = new UserTokenPolicyCollection { new UserTokenPolicy(UserTokenType.Anonymous) },
                MinRequestThreadCount = 1,
                MaxRequestThreadCount = 10,
                MaxQueuedRequestCount = 200,
            },
        };

#pragma warning disable CS0618 // proven overloads — see OpcUaDriver's own de-risk-gate remarks.
        await config.Validate(ApplicationType.Server).ConfigureAwait(false);
        var appInstance = new Opc.Ua.Configuration.ApplicationInstance(config) { DisableCertificateAutoCreation = false };
#pragma warning restore CS0618
        await appInstance.CheckApplicationInstanceCertificatesAsync(silent: true).ConfigureAwait(false);

        return config;
    }

    /// <summary>A minimal <see cref="CustomNodeManager2"/> exposing a fixed set of variable nodes with
    /// known initial values, directly under the Objects folder (Organizes references) — the smallest
    /// address space that lets <see cref="OpcUaDriver"/> read something real back.</summary>
    private sealed class LoopbackNodeManager : CustomNodeManager2
    {
        public const string NamespaceUri = "http://st4i.local/opcua/loopback-test";
        private readonly IReadOnlyList<(string Name, object Value)> _variables;

        public LoopbackNodeManager(IServerInternal server, ApplicationConfiguration configuration, IReadOnlyList<(string Name, object Value)> variables)
            : base(server, configuration, NamespaceUri)
        {
            _variables = variables;
        }

        public override void CreateAddressSpace(IDictionary<NodeId, IList<IReference>> externalReferences)
        {
            lock (Lock)
            {
                if (!externalReferences.TryGetValue(ObjectIds.ObjectsFolder, out var references))
                {
                    externalReferences[ObjectIds.ObjectsFolder] = references = new List<IReference>();
                }

                foreach (var (name, value) in _variables)
                {
                    var variable = new BaseDataVariableState(null)
                    {
                        NodeId = new NodeId(name, NamespaceIndex),
                        BrowseName = new QualifiedName(name, NamespaceIndex),
                        DisplayName = name,
                        TypeDefinitionId = VariableTypeIds.BaseDataVariableType,
                        ReferenceTypeId = ReferenceTypeIds.Organizes,
                        DataType = TypeInfo.GetDataTypeId(value.GetType()),
                        ValueRank = ValueRanks.Scalar,
                        AccessLevel = AccessLevels.CurrentRead,
                        UserAccessLevel = AccessLevels.CurrentRead,
                        Value = value,
                    };

                    references.Add(new NodeStateReference(ReferenceTypeIds.Organizes, false, variable.NodeId));
                    AddPredefinedNode(SystemContext, variable);
                }
            }
        }
    }

    private sealed class LoopbackNodeManagerFactory(IReadOnlyList<(string Name, object Value)> variables) : INodeManagerFactory
    {
        public StringCollection NamespacesUris => new(new[] { LoopbackNodeManager.NamespaceUri });

        public INodeManager Create(IServerInternal server, ApplicationConfiguration configuration) =>
            new LoopbackNodeManager(server, configuration, variables);
    }

    /// <summary>Test-only harness bundling the running server + its dynamic endpoint URL, torn down via
    /// <see cref="DisposeAsync"/>.</summary>
    private sealed class RunningTestServer : IAsyncDisposable
    {
        public required StandardServer Server { get; init; }
        public required string EndpointUrl { get; init; }
        public required CancellationTokenSource Cts { get; init; }

        public async ValueTask DisposeAsync()
        {
            try { await Cts.CancelAsync().ConfigureAwait(false); } catch { /* best-effort */ }
            try { await Server.StopAsync(CancellationToken.None).ConfigureAwait(false); } catch { /* best-effort */ }
            try { Server.Dispose(); } catch { /* best-effort */ }
            Cts.Dispose();
        }
    }

    private static async Task<RunningTestServer> StartServerAsync(string pkiRoot, IReadOnlyList<(string Name, object Value)> variables)
    {
        var port = FindFreePort();
        var endpointUrl = $"opc.tcp://localhost:{port}/St4iOpcUaLoopbackTest";

        var config = await BuildServerConfigAsync(pkiRoot, endpointUrl).ConfigureAwait(false);

        var server = new StandardServer();
        server.AddNodeManager(new LoopbackNodeManagerFactory(variables));

        var cts = new CancellationTokenSource();
        await server.StartAsync(config, cts.Token).ConfigureAwait(false);

        return new RunningTestServer { Server = server, EndpointUrl = endpointUrl, Cts = cts };
    }

    private static OpcUaNodeMap BuildMap(string machineCode, string endpointUrl, int pollIntervalMs = 200) => new()
    {
        MachineCode = machineCode,
        EndpointUrl = endpointUrl,
        PollIntervalMs = pollIntervalMs,
        Nodes = new List<OpcUaNode>
        {
            new("ns=2;s=Temperature", "temperature", "C"),
            new("ns=2;s=Status", "status"),
        },
    };

    [Fact]
    public async Task ReadAsync_AgainstLoopbackServer_YieldsDecodedTelemetry_HealthConnected()
    {
        var pkiRoot = Path.Combine(Path.GetTempPath(), "st4i-opcua-t1-" + Guid.NewGuid().ToString("N")[..8]);

        await using var testServer = await StartServerAsync(
            pkiRoot,
            new (string, object)[] { ("Temperature", 42.5), ("Status", "RUNNING") });

        await using var driver = new OpcUaDriver(BuildMap("PLC-OPCUA-LOOPBACK", testServer.EndpointUrl), pkiDir: pkiRoot);

        using var readCts = new CancellationTokenSource(PollTimeout);
        DeviceReading? firstReading = null;
        var readTask = Task.Run(async () =>
        {
            await foreach (var reading in driver.ReadAsync(readCts.Token))
            {
                firstReading = reading;
                return;
            }
        });

        try
        {
            await WaitUntilAsync(() => firstReading is not null, "the driver to yield its first decoded reading");

            Assert.NotNull(firstReading);
            Assert.Equal("PLC-OPCUA-LOOPBACK", firstReading!.MachineCode);
            Assert.Equal(ReadingKind.Telemetry, firstReading.Kind);
            // Telemetry carries no pass/fail — Verdict MUST be Skip so it can never inflate the fleet-wide
            // FPY/pass KPIs in FleetHost.OnPipelineCommitted (the Modbus KPI-inflation lesson, G2-6).
            Assert.Equal(Verdict.Skip, firstReading.Verdict);
            Assert.Equal(2, firstReading.Telemetry.Count);

            var temperature = firstReading.Telemetry.Single(t => t.Metric == "temperature");
            Assert.Equal(42.5, (double)temperature.Value!, precision: 10);
            Assert.Equal("C", temperature.Unit);
            Assert.Equal("good", temperature.Quality);

            var status = firstReading.Telemetry.Single(t => t.Metric == "status");
            Assert.Equal("RUNNING", status.Value);
            Assert.Equal("good", status.Quality);

            await WaitUntilAsync(() => driver.Health == DriverHealthState.Connected, "driver Health to reach Connected after a successful poll");
            Assert.Equal(DriverKind.OpcUa, driver.Kind);
        }
        finally
        {
            await readCts.CancelAsync();
            try { await readTask; } catch (OperationCanceledException) { }
        }
    }

    /// <summary>Health-on-fault (mirrors <c>ModbusTcpDriverLoopbackTests</c>'s own sibling test): after a
    /// successful read, the server is torn down out from under the driver, and we assert (bounded) that
    /// <see cref="OpcUaDriver.Health"/> degrades to <see cref="DriverHealthState.Degraded"/> — the
    /// load-bearing assertion is that the background <c>ReadAsync</c> enumeration task is STILL RUNNING
    /// (not faulted/completed): a resilient driver must never throw a non-cancellation exception out of its
    /// iterator.</summary>
    [Fact]
    public async Task ReadAsync_ServerGoesAway_HealthDegrades_AndIteratorKeepsRunning_NoThrow()
    {
        var pkiRoot = Path.Combine(Path.GetTempPath(), "st4i-opcua-t2-" + Guid.NewGuid().ToString("N")[..8]);

        var testServer = await StartServerAsync(
            pkiRoot,
            new (string, object)[] { ("Temperature", 1.0), ("Status", "OK") });

        await using var driver = new OpcUaDriver(BuildMap("PLC-OPCUA-FAULT", testServer.EndpointUrl), pkiDir: pkiRoot);

        using var readCts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var readingCount = 0;
        var readTask = Task.Run(async () =>
        {
            await foreach (var _ in driver.ReadAsync(readCts.Token))
            {
                Interlocked.Increment(ref readingCount);
            }
        });

        try
        {
            await WaitUntilAsync(() => Volatile.Read(ref readingCount) > 0, "at least one successful poll before killing the server");
            await WaitUntilAsync(() => driver.Health == DriverHealthState.Connected, "driver Health to reach Connected before killing the server");

            // Kill the server out from under the driver — the NEXT poll's session read must fail, degrading
            // Health rather than throwing out of the iterator.
            await testServer.DisposeAsync();

            await WaitUntilAsync(() => driver.Health == DriverHealthState.Degraded, "driver Health to degrade after the server disappears");

            Assert.False(readTask.IsCompleted, "ReadAsync must keep looping (not throw/complete) after a poll failure");
        }
        finally
        {
            await readCts.CancelAsync();
            try { await readTask; } catch (OperationCanceledException) { }
        }
    }
}
