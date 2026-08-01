using System.Net;
using System.Net.Sockets;
using Opc.Ua;
using Opc.Ua.Server;
using St4i.Connector.Abstractions.Models;
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

    // ─────────────────────────────────────────────────────────────────────────────────────────────────
    // Task B-5 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-5-brief.md) — a SECOND,
    // purely-additive server shape exposing WRITABLE variables and CALLABLE methods, so
    // OpcUaDriverWriteTests can prove a setpoint write / command invocation genuinely reaches a real OPC-UA
    // server end-to-end. Everything ABOVE this comment is completely unchanged — mirrors
    // ModbusLoopbackHarness's own purely-additive `RunningSlave.Slave` property (B-4's "extend, never
    // weaken" precedent) applied here.
    // ─────────────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Mutable, thread-safe knobs a test can flip WHILE the server is running: how long the
    /// "StartCycle" method (and the "Speed" variable's own write handler) blocks before returning —
    /// simulating a slow/hung device for genuine-timeout and cancellation tests — and whether "StartCycle"
    /// reports failure AFTER having already run (for the pre-invocation-vs-post-invocation CallAsync
    /// outcome-mapping distinction — see <c>OpcUaDriver</c>'s own doc comment / task-5-report.md).</summary>
    public sealed class WritableServerControls
    {
        private int _methodDelayMs;
        private int _readDelayMs;
        private int _startCycleRejectsAfterRunning;
        private int _startCycleInvokedCount;
        private int _pingInvokedCount;
        private volatile object? _lastStartCycleArgument;

        public int MethodDelayMs
        {
            get => Volatile.Read(ref _methodDelayMs);
            set => Volatile.Write(ref _methodDelayMs, value);
        }

        /// <summary>Stalls a read of the "Count" node by this many milliseconds — used ONLY by the
        /// interleaving tests (a poll mid-write / write mid-poll proof), independent of
        /// <see cref="MethodDelayMs"/> so a test can hold a READ open without also slowing a write/call.
        /// Zero (the default) is a no-op, so every other test using the same map is unaffected.</summary>
        public int ReadDelayMs
        {
            get => Volatile.Read(ref _readDelayMs);
            set => Volatile.Write(ref _readDelayMs, value);
        }

        /// <summary>Fired the instant a read of "Count" begins (BEFORE <see cref="ReadDelayMs"/>'s own
        /// sleep) — lets an interleaving test wait deterministically for "the poll's read is now genuinely
        /// stuck" instead of guessing a wall-clock delay.</summary>
        public Action? OnCountReadStarted { get; set; }

        /// <summary>Fired the instant a write of "Speed" begins (BEFORE <see cref="MethodDelayMs"/>'s own
        /// sleep) — the write-side mirror of <see cref="OnCountReadStarted"/>.</summary>
        public Action? OnSpeedWriteStarted { get; set; }

        public bool StartCycleRejectsAfterRunning
        {
            get => Volatile.Read(ref _startCycleRejectsAfterRunning) != 0;
            set => Volatile.Write(ref _startCycleRejectsAfterRunning, value ? 1 : 0);
        }

        public int StartCycleInvokedCount => Volatile.Read(ref _startCycleInvokedCount);

        public int PingInvokedCount => Volatile.Read(ref _pingInvokedCount);

        public object? LastStartCycleArgument => _lastStartCycleArgument;

        internal ServiceResult InvokeStartCycle(object argument)
        {
            var delay = MethodDelayMs;
            if (delay > 0)
            {
                Thread.Sleep(delay);
            }

            Interlocked.Increment(ref _startCycleInvokedCount);
            _lastStartCycleArgument = argument;

            return StartCycleRejectsAfterRunning
                ? new ServiceResult(StatusCodes.BadInvalidState, "test server: StartCycle rejected after running")
                : ServiceResult.Good;
        }

        internal ServiceResult InvokePing()
        {
            Interlocked.Increment(ref _pingInvokedCount);
            return ServiceResult.Good;
        }
    }

    /// <summary>A minimal <see cref="CustomNodeManager2"/> exposing WRITABLE variables (one per relevant
    /// <c>CommandArgumentType</c> shape — Bool/Int16/UInt32/Double — plus one the SERVER itself marks
    /// read-only, to prove a device-level rejection) and a "Machine" object with two methods: "StartCycle"
    /// (one UInt16 input argument, controllable via <see cref="WritableServerControls"/>) and "Ping" (no
    /// arguments) — so a test can prove "only the declared method was invoked".</summary>
    internal sealed class WritableLoopbackNodeManager : CustomNodeManager2
    {
        public const string NamespaceUri = "http://st4i.local/opcua/writable-loopback-test";

        private readonly WritableServerControls _controls;
        private readonly Dictionary<string, BaseDataVariableState> _variables = new(StringComparer.Ordinal);

        public WritableLoopbackNodeManager(IServerInternal server, ApplicationConfiguration configuration, WritableServerControls controls)
            : base(server, configuration, NamespaceUri)
        {
            _controls = controls;
        }

        /// <summary>Reads a variable's CURRENT value directly off the server's own address space —
        /// independent of any driver/client — the OPC-UA analog of <c>ModbusLoopbackHarness.RunningSlave.Slave</c>'s
        /// direct <c>DataStore</c> read: the load-bearing "the write genuinely reached the device" proof.</summary>
        public object GetVariableValue(string name)
        {
            lock (Lock)
            {
                return _variables[name].Value;
            }
        }

        public override void CreateAddressSpace(IDictionary<NodeId, IList<IReference>> externalReferences)
        {
            lock (Lock)
            {
                if (!externalReferences.TryGetValue(ObjectIds.ObjectsFolder, out var references))
                {
                    externalReferences[ObjectIds.ObjectsFolder] = references = new List<IReference>();
                }

                var speed = AddVariable(references, "Speed", DataTypeIds.Double, 0.0, readOnly: false);
                speed.OnWriteValue = OnSpeedWriteValue;
                AddVariable(references, "Enabled", DataTypeIds.Boolean, false, readOnly: false);
                AddVariable(references, "Mode", DataTypeIds.Int16, (short)0, readOnly: false);
                var count = AddVariable(references, "Count", DataTypeIds.UInt32, (uint)0, readOnly: false);
                count.OnSimpleReadValue = OnCountReadValue;
                // Server-side READ-ONLY (unlike the others) — a map that (mis)declares this writable proves
                // the device-level-rejection path (WriteOutcome.Failed, device untouched) rather than one of
                // this driver's OWN pre-flight rejections.
                AddVariable(references, "Locked", DataTypeIds.Double, 1.0, readOnly: true);

                var machine = new BaseObjectState(null)
                {
                    NodeId = new NodeId("Machine", NamespaceIndex),
                    BrowseName = new QualifiedName("Machine", NamespaceIndex),
                    DisplayName = "Machine",
                    TypeDefinitionId = ObjectTypeIds.BaseObjectType,
                };
                references.Add(new NodeStateReference(ReferenceTypeIds.Organizes, false, machine.NodeId));

                var startCycle = new MethodState(machine)
                {
                    NodeId = new NodeId("StartCycle", NamespaceIndex),
                    BrowseName = new QualifiedName("StartCycle", NamespaceIndex),
                    DisplayName = "StartCycle",
                    Executable = true,
                    UserExecutable = true,
                    InputArguments = new PropertyState<Argument[]>(null)
                    {
                        NodeId = new NodeId("StartCycle_InputArguments", NamespaceIndex),
                        BrowseName = BrowseNames.InputArguments,
                        DataType = DataTypeIds.Argument,
                        ValueRank = ValueRanks.OneDimension,
                        Value = new[] { new Argument("speed", DataTypeIds.UInt16, ValueRanks.Scalar, "the target speed") },
                    },
                };
                startCycle.OnCallMethod = (context, method, inputArguments, outputArguments) =>
                    _controls.InvokeStartCycle(inputArguments[0]);
                machine.AddChild(startCycle);
                references.Add(new NodeStateReference(ReferenceTypeIds.HasComponent, false, startCycle.NodeId));
                AddPredefinedNode(SystemContext, startCycle);

                var ping = new MethodState(machine)
                {
                    NodeId = new NodeId("Ping", NamespaceIndex),
                    BrowseName = new QualifiedName("Ping", NamespaceIndex),
                    DisplayName = "Ping",
                    Executable = true,
                    UserExecutable = true,
                };
                ping.OnCallMethod = (context, method, inputArguments, outputArguments) => _controls.InvokePing();
                machine.AddChild(ping);
                references.Add(new NodeStateReference(ReferenceTypeIds.HasComponent, false, ping.NodeId));
                AddPredefinedNode(SystemContext, ping);

                AddPredefinedNode(SystemContext, machine);
            }
        }

        /// <summary>Lets <see cref="WritableServerControls.MethodDelayMs"/> ALSO stall a "Speed" write
        /// (not just "StartCycle"), so a genuine setpoint-write timeout can be proven the same way a genuine
        /// command timeout can — the default handling this replaces is a plain field assignment, reproduced
        /// here manually after the (possible) delay.</summary>
        private ServiceResult OnSpeedWriteValue(
            ISystemContext context, NodeState node, NumericRange indexRange, QualifiedName dataEncoding,
            ref object value, ref StatusCode statusCode, ref DateTime timestamp)
        {
            _controls.OnSpeedWriteStarted?.Invoke();
            var delay = _controls.MethodDelayMs;
            if (delay > 0)
            {
                Thread.Sleep(delay);
            }

            ((BaseDataVariableState)node).Value = value;
            return ServiceResult.Good;
        }

        /// <summary>Lets <see cref="WritableServerControls.ReadDelayMs"/> stall a read of "Count" — used
        /// ONLY by the interleaving tests to hold a poll's own Read service call open deliberately, so a
        /// concurrent write/command can be proven to proceed WITHOUT waiting for it (unlike
        /// <c>Modbus.ModbusTcpDriver</c>, whose raw byte stream forces mutual exclusion — see
        /// <c>OpcUaDriver</c>'s own "Concurrency" doc-comment remarks). <paramref name="value"/> already
        /// carries the node's current value on entry (the framework's own default read behaviour); this
        /// handler only ever delays, never changes it.</summary>
        private ServiceResult OnCountReadValue(ISystemContext context, NodeState node, ref object value)
        {
            _controls.OnCountReadStarted?.Invoke();
            var delay = _controls.ReadDelayMs;
            if (delay > 0)
            {
                Thread.Sleep(delay);
            }

            return ServiceResult.Good;
        }

        private BaseDataVariableState AddVariable(IList<IReference> references, string name, NodeId dataType, object initialValue, bool readOnly)
        {
            var accessLevel = readOnly ? AccessLevels.CurrentRead : AccessLevels.CurrentReadOrWrite;
            var variable = new BaseDataVariableState(null)
            {
                NodeId = new NodeId(name, NamespaceIndex),
                BrowseName = new QualifiedName(name, NamespaceIndex),
                DisplayName = name,
                TypeDefinitionId = VariableTypeIds.BaseDataVariableType,
                ReferenceTypeId = ReferenceTypeIds.Organizes,
                DataType = dataType,
                ValueRank = ValueRanks.Scalar,
                AccessLevel = accessLevel,
                UserAccessLevel = accessLevel,
                Value = initialValue,
            };
            references.Add(new NodeStateReference(ReferenceTypeIds.Organizes, false, variable.NodeId));
            AddPredefinedNode(SystemContext, variable);
            _variables[name] = variable;
            return variable;
        }
    }

    private sealed class WritableLoopbackNodeManagerFactory : INodeManagerFactory
    {
        private readonly WritableServerControls _controls;

        public WritableLoopbackNodeManagerFactory(WritableServerControls controls)
        {
            _controls = controls;
        }

        public WritableLoopbackNodeManager? Created { get; private set; }

        public StringCollection NamespacesUris => new(new[] { WritableLoopbackNodeManager.NamespaceUri });

        public INodeManager Create(IServerInternal server, ApplicationConfiguration configuration)
        {
            Created = new WritableLoopbackNodeManager(server, configuration, _controls);
            return Created;
        }
    }

    /// <summary>Running writable-shape server + its dynamic endpoint URL, torn down via
    /// <see cref="DisposeAsync"/> — the write/command-testing counterpart of <see cref="RunningTestServer"/>.</summary>
    public sealed class RunningWritableTestServer : IAsyncDisposable
    {
        public required StandardServer Server { get; init; }
        public required string EndpointUrl { get; init; }
        public required CancellationTokenSource Cts { get; init; }
        public required WritableServerControls Controls { get; init; }

        private WritableLoopbackNodeManager? _nodeManager;
        private int _sessionCreatedCount;

        internal void AttachNodeManager(WritableLoopbackNodeManager nodeManager) => _nodeManager = nodeManager;

        /// <summary>See <see cref="WritableLoopbackNodeManager.GetVariableValue"/> — reads the CURRENT value
        /// straight off the server's own address space, independent of any driver/client.</summary>
        public object GetVariableValue(string name) =>
            (_nodeManager ?? throw new InvalidOperationException("WritableLoopbackNodeManager not attached.")).GetVariableValue(name);

        /// <summary>How many OPC-UA sessions this server has created over its lifetime — the load-bearing
        /// proof for the "write during reconnect" interleaving case: if a poll iteration and a write/command
        /// raced to independently rebuild <c>OpcUaDriver</c>'s own session, this would count 2 (or more);
        /// <c>_sessionLock</c> existing to prevent exactly that means it stays 1 even when both are issued
        /// concurrently against a freshly-constructed driver with no session yet.</summary>
        public int SessionCreatedCount => Volatile.Read(ref _sessionCreatedCount);

        internal void ObserveSessionCreation() =>
            Server.CurrentInstance.SessionManager.SessionCreated += (_, _) => Interlocked.Increment(ref _sessionCreatedCount);

        public async ValueTask DisposeAsync()
        {
            try { await Cts.CancelAsync().ConfigureAwait(false); } catch { /* best-effort */ }
            try { await Server.StopAsync(CancellationToken.None).ConfigureAwait(false); } catch { /* best-effort */ }
            try { Server.Dispose(); } catch { /* best-effort */ }
            Cts.Dispose();
        }
    }

    public static async Task<RunningWritableTestServer> StartWritableServerAsync(string pkiRoot)
    {
        var port = FindFreePort();
        var endpointUrl = $"opc.tcp://localhost:{port}/St4iOpcUaWritableLoopbackTest";

        var config = await BuildServerConfigAsync(pkiRoot, endpointUrl).ConfigureAwait(false);

        var controls = new WritableServerControls();
        var factory = new WritableLoopbackNodeManagerFactory(controls);
        var server = new StandardServer();
        server.AddNodeManager(factory);

        var cts = new CancellationTokenSource();
        await server.StartAsync(config, cts.Token).ConfigureAwait(false);

        var result = new RunningWritableTestServer { Server = server, EndpointUrl = endpointUrl, Cts = cts, Controls = controls };
        result.AttachNodeManager(factory.Created ?? throw new InvalidOperationException("WritableLoopbackNodeManagerFactory.Create was never called."));
        result.ObserveSessionCreation();
        return result;
    }

    public static OpcUaNodeMap BuildWritableMap(string machineCode, string endpointUrl, int pollIntervalMs = 200) => new()
    {
        MachineCode = machineCode,
        EndpointUrl = endpointUrl,
        PollIntervalMs = pollIntervalMs,
        Nodes = new List<OpcUaNode>
        {
            new("ns=2;s=Speed", "speed", "rpm", new OpcUaWritableSetpoint(CommandArgumentType.Double, 0, 500)),
            new("ns=2;s=Enabled", "enabled", null, new OpcUaWritableSetpoint(CommandArgumentType.Bool, null, null)),
            new("ns=2;s=Mode", "mode", null, new OpcUaWritableSetpoint(CommandArgumentType.Int16, -10, 10)),
            new("ns=2;s=Count", "count", null, new OpcUaWritableSetpoint(CommandArgumentType.UInt32, 0, 1000)),
            new("ns=2;s=Locked", "locked", null, new OpcUaWritableSetpoint(CommandArgumentType.Double, 0, 10)),
            // Deliberately declared READ-ONLY in the MAP (Writable: null) — reuses "Speed"'s own NodeId so
            // no extra server node is needed; only this driver's OWN NotWritable pre-flight rejection is
            // being exercised here, never a device-level one.
            new("ns=2;s=Speed", "speed-readonly"),
        },
        Commands = new List<OpcUaCommand>
        {
            new("start-cycle", "ns=2;s=Machine", "ns=2;s=StartCycle",
                new List<CommandArgumentDeclaration> { new("speed", CommandArgumentType.UInt16, 0, 1000) }),
            new("ping", "ns=2;s=Machine", "ns=2;s=Ping"),
        },
    };
}
