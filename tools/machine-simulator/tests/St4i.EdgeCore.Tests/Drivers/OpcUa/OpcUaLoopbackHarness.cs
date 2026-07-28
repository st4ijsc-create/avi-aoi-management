using System.Net;
using System.Net.Sockets;
using Opc.Ua;
using Opc.Ua.Server;
using St4i.EdgeCore.Drivers.OpcUa;

namespace St4i.EdgeCore.Tests.Drivers.OpcUa;

/// <summary>
/// GP-6 (task-6-report.md) — the "stand up a real in-process OPC Foundation reference SERVER" setup,
/// extracted out of <see cref="OpcUaDriverLoopbackTests"/> so <c>OpcUaDriverConformanceTests</c> can reuse
/// the EXACT same real-server harness (task-6-brief.md: "Modbus and OPC-UA have existing in-process
/// loopback harnesses ... reuse them where the checks need real readings") instead of hand-rolling a second
/// one. Behaviour is unchanged from what <see cref="OpcUaDriverLoopbackTests"/> always did inline; this is a
/// mechanical extraction, not a rewrite.
/// </summary>
internal static class OpcUaLoopbackHarness
{
    public static int FindFreePort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    public static OpcUaNodeMap BuildMap(string machineCode, string endpointUrl, int pollIntervalMs = 200) => new()
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

    /// <summary>Builds a minimal SERVER <see cref="ApplicationConfiguration"/> (SecurityMode None,
    /// anonymous) — the test-only counterpart of <c>OpcUaDriver.BuildClientConfigAsync</c>, sharing the
    /// same "app-instance cert under a short pki root, AutoAcceptUntrustedCertificates" shape.</summary>
    public static async Task<ApplicationConfiguration> BuildServerConfigAsync(string pkiRoot, string endpointUrl)
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

    /// <summary>Running server + its dynamic endpoint URL, torn down via <see cref="DisposeAsync"/>.</summary>
    public sealed class RunningTestServer : IAsyncDisposable
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

    public static async Task<RunningTestServer> StartServerAsync(string pkiRoot, IReadOnlyList<(string Name, object Value)> variables)
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
}
