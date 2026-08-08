using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Drivers;
using St4i.EdgeCore.Drivers.Simulators;
using St4i.EdgeCore.Engine;
using St4i.EdgeCore.Fleet;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Mapping;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using Xunit;

namespace St4i.EdgeCore.Tests.Engine;

/// <summary>
/// 🔴 Task E-3 — <see cref="EdgeAgentPipelines"/>: the N-driver lifecycle an edge agent gets.
///
/// <para>The headline assertion of the task lives here:
/// <see cref="NDeviceInstances_YieldNDriversRunning_AndEveryOneOfThemPushesToTheTransport"/>. It is measured
/// at the TRANSPORT — the thing the drivers are supposed to reach — not at the registry and not at a label
/// list, because "N were registered" and "N are actually pushing readings" are two different claims and
/// Đợt D's §8.1 is a record of what it costs to state the second in the register of the first.</para>
/// </summary>
public sealed class EdgeAgentPipelinesTests
{
    private static readonly TimeSpan Deadline = TimeSpan.FromSeconds(20);

    private static MachineDescriptor Descriptor(string code) =>
        new(code, "SN-" + code, DeviceClass.Automation, "SCREWDRIVE", "screw_tightening",
            DriverKinds.Simulated, "RC-A", null, 0.02);

    private static MappingProfile Fallback() => MappingProfile.ForClass(DeviceClass.Automation);

    /// <summary>A real, production-shaped connector factory: it receives the entry's opaque config string
    /// (here just a machine code) and hands back a driver that emits readings for it. Deliberately NOT a
    /// hand-rolled stub driver — a <see cref="SimulatedDriver"/> produces genuine
    /// <see cref="DeviceReading"/>s that normalize and reach the transport, which is what the headline
    /// assertion has to observe.</summary>
    private sealed class MachineCodeFactory : IConnectorFactory
    {
        public string Kind => "TestConnector";

        public bool TryCreate(string config, [NotNullWhen(true)] out IDeviceDriver? driver, [NotNullWhen(false)] out string? error)
        {
            driver = new SimulatedDriver(new[] { (IMachineSimulator)new ScrewdriveSim(Descriptor(config), config.GetHashCode()) });
            error = null;
            return true;
        }
    }

    private sealed class RefusingFactory : IConnectorFactory
    {
        public string Kind => "Refuser";

        public bool TryCreate(string config, [NotNullWhen(true)] out IDeviceDriver? driver, [NotNullWhen(false)] out string? error)
        {
            driver = null;
            error = "this factory refuses everything";
            return false;
        }
    }

    /// <summary>Assigns its <c>out driver</c> and THEN reports failure — the exact shape
    /// <see cref="ConnectorRegistry.TryCreateDriver"/>'s own remarks say must not leak.</summary>
    private sealed class OrphanLeavingFactory : IConnectorFactory
    {
        public readonly TrackedDriver Orphan = new();

        public string Kind => "Orphaner";

        public bool TryCreate(string config, [NotNullWhen(true)] out IDeviceDriver? driver, [NotNullWhen(false)] out string? error)
        {
            driver = Orphan;
            error = "built it, then changed my mind";
            return false;
        }
    }

    /// <summary>A driver that records its own disposal, and can be told to fault its read loop.</summary>
    internal sealed class TrackedDriver : IDeviceDriver
    {
        private readonly bool _throwOnRead;

        public TrackedDriver(bool throwOnRead = false) => _throwOnRead = throwOnRead;

        public int Disposals;

        public string Id => "tracked";

        public string Kind => "Tracked";

        public DriverHealthState Health => DriverHealthState.Connected;

        public async IAsyncEnumerable<DeviceReading> ReadAsync(
            [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct)
        {
            if (_throwOnRead)
            {
                await Task.Yield();
                throw new InvalidOperationException("this driver is broken");
            }

            await Task.Delay(Timeout.Infinite, ct).ConfigureAwait(false);
            yield break;
        }

        public ValueTask DisposeAsync()
        {
            Interlocked.Increment(ref Disposals);
            return ValueTask.CompletedTask;
        }
    }

    private sealed class CountingTransport : ITransport
    {
        public readonly ConcurrentDictionary<string, int> PerMachine = new(StringComparer.OrdinalIgnoreCase);

        public TransportMode Mode => TransportMode.Demo;

        public Task<TransportAck> SendAsync(CanonicalEnvelope env, CancellationToken ct)
        {
            PerMachine.AddOrUpdate(env.MachineCode, 1, (_, n) => n + 1);
            return Task.FromResult(new TransportAck(Success: true, Id: 1));
        }

        public Task<HeartbeatResult> HeartbeatAsync(string machineCode, CancellationToken ct) =>
            Task.FromResult(new HeartbeatResult(true, 1, "active", 365));

        public Task<ConfigSyncResult> SyncConfigAsync(string machineCode, string configKind, string? cachedVersion, CancellationToken ct) =>
            Task.FromResult(new ConfigSyncResult(false, null, null));
    }

    /// <summary>Runs the agent until <paramref name="until"/> holds (or the deadline expires), then cancels
    /// and joins. Asserting on a CONDITION rather than on a fixed delay is what keeps this from being a
    /// timing test.</summary>
    private static async Task RunUntil(
        EdgeAgentPipelines agent,
        IReadOnlyList<IMachineSimulator>? sims,
        ConnectorRegistry? connectors,
        Func<bool> until)
    {
        using var cts = new CancellationTokenSource();
        var run = agent.RunAsync(sims, connectors, cts.Token);
        var deadline = DateTime.UtcNow + Deadline;

        while (!until() && DateTime.UtcNow < deadline && !run.IsCompleted)
        {
            await Task.Delay(20).ConfigureAwait(false);
        }

        cts.Cancel();
        try { await run.ConfigureAwait(false); } catch (OperationCanceledException) { }
    }

    // ─────────────────────────────────────────────────────────────────────
    // THE HEADLINE: N declared devices → N drivers running, each one reaching the transport.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task NDeviceInstances_YieldNDriversRunning_AndEveryOneOfThemPushesToTheTransport()
    {
        const int n = 4;
        var registry = new ConnectorRegistry();
        var factory = new MachineCodeFactory();
        for (var i = 1; i <= n; i++)
        {
            Assert.True(registry.Register(factory, $"DEV-{i}", instanceId: $"line1:unit{i}"));
        }

        var transport = new CountingTransport();
        var agent = new EdgeAgentPipelines(transport, new EventBus(), Fallback());

        await RunUntil(agent, sims: null, connectors: registry,
            until: () => Enumerable.Range(1, n).All(i => transport.PerMachine.ContainsKey($"DEV-{i}")));

        Assert.Equal(n, agent.StartedLabels.Count);
        Assert.Empty(agent.StartIssues);

        // Measured at the transport, per machine — not "n slots exist".
        for (var i = 1; i <= n; i++)
        {
            Assert.True(transport.PerMachine.TryGetValue($"DEV-{i}", out var sent) && sent > 0,
                $"DEV-{i} never reached the transport; observed: {string.Join(", ", transport.PerMachine.Keys)}");
        }
    }

    [Fact]
    public async Task NoConnectors_RunsExactlyTheOneSimulatedPipeline_AndNothingElse()
    {
        var transport = new CountingTransport();
        var agent = new EdgeAgentPipelines(transport, new EventBus(), Fallback());
        var sims = new[] { (IMachineSimulator)new ScrewdriveSim(Descriptor("SIM-01"), 7) };

        await RunUntil(agent, sims, connectors: null, until: () => transport.PerMachine.ContainsKey("SIM-01"));

        Assert.Equal(new[] { EdgeAgentPipelines.SimulatedLabel }, agent.StartedLabels);
        Assert.Empty(agent.StartIssues);
        Assert.Equal(new[] { "SIM-01" }, transport.PerMachine.Keys.OrderBy(k => k).ToArray());
    }

    [Fact]
    public async Task AConnectorThatWillNotBuild_IsNamedInStartIssues_AndItsSiblingsKeepRunning()
    {
        var registry = new ConnectorRegistry();
        Assert.True(registry.Register(new MachineCodeFactory(), "GOOD-01", instanceId: "good"));
        Assert.True(registry.Register(new RefusingFactory(), "irrelevant", instanceId: "bad"));

        var transport = new CountingTransport();
        var agent = new EdgeAgentPipelines(transport, new EventBus(), Fallback());

        await RunUntil(agent, sims: null, connectors: registry,
            until: () => transport.PerMachine.ContainsKey("GOOD-01"));

        Assert.Equal(new[] { "good" }, agent.StartedLabels);
        var issue = Assert.Single(agent.StartIssues);
        Assert.Equal("bad", issue.Id);
        Assert.Contains("refuses everything", issue.Error);
    }

    [Fact]
    public async Task AFaultedPipeline_DoesNotStopItsSiblings()
    {
        var registry = new ConnectorRegistry();
        Assert.True(registry.Register(new MachineCodeFactory(), "GOOD-02", instanceId: "good"));
        Assert.True(registry.Register(new ThrowingFactory(), "irrelevant", instanceId: "broken"));

        var transport = new CountingTransport();
        var agent = new EdgeAgentPipelines(transport, new EventBus(), Fallback());

        // The healthy sibling must reach the transport MORE THAN ONCE after the broken one has died: a single
        // reading could have landed before the fault. This is the assertion that separates "isolated" from
        // "happened to be first".
        await RunUntil(agent, sims: null, connectors: registry,
            until: () => transport.PerMachine.TryGetValue("GOOD-02", out var c) && c >= 3);

        Assert.True(transport.PerMachine.TryGetValue("GOOD-02", out var count) && count >= 3,
            $"the healthy pipeline stopped when its sibling faulted (observed {transport.PerMachine.GetValueOrDefault("GOOD-02")} sends)");
    }

    private sealed class ThrowingFactory : IConnectorFactory
    {
        public string Kind => "Thrower";

        public bool TryCreate(string config, [NotNullWhen(true)] out IDeviceDriver? driver, [NotNullWhen(false)] out string? error)
        {
            driver = new TrackedDriver(throwOnRead: true);
            error = null;
            return true;
        }
    }

    [Fact]
    public async Task EveryPipelineFaulted_Rethrows_SoTheHostLearnsTheAgentIsDead()
    {
        var registry = new ConnectorRegistry();
        Assert.True(registry.Register(new ThrowingFactory(), "irrelevant", instanceId: "broken"));

        var agent = new EdgeAgentPipelines(new CountingTransport(), new EventBus(), Fallback());
        using var cts = new CancellationTokenSource(Deadline);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => agent.RunAsync(simulators: null, connectors: registry, ct: cts.Token));
        Assert.Equal("this driver is broken", ex.Message);
    }

    [Fact]
    public async Task AnOrphanedDriverFromARejectingFactory_IsDisposed_NotLeaked()
    {
        var registry = new ConnectorRegistry();
        var factory = new OrphanLeavingFactory();
        Assert.True(registry.Register(factory, "irrelevant", instanceId: "orphaner"));

        var agent = new EdgeAgentPipelines(new CountingTransport(), new EventBus(), Fallback());
        using var cts = new CancellationTokenSource(Deadline);

        // Nothing started, so RunAsync returns immediately rather than waiting on the token.
        await agent.RunAsync(simulators: null, connectors: registry, ct: cts.Token);

        Assert.Equal(1, Volatile.Read(ref factory.Orphan.Disposals));
        Assert.Empty(agent.StartedLabels);
        Assert.Single(agent.StartIssues);
    }

    [Fact]
    public async Task EveryDriverItBuilt_IsDisposedWhenTheRunEnds()
    {
        var registry = new ConnectorRegistry();
        var factory = new HandBackFactory();
        Assert.True(registry.Register(factory, "irrelevant", instanceId: "tracked"));

        var agent = new EdgeAgentPipelines(new CountingTransport(), new EventBus(), Fallback());
        using var cts = new CancellationTokenSource();
        var run = agent.RunAsync(simulators: null, connectors: registry, ct: cts.Token);

        var deadline = DateTime.UtcNow + Deadline;
        while (agent.StartedLabels.Count == 0 && DateTime.UtcNow < deadline) await Task.Delay(20);
        Assert.Equal(0, Volatile.Read(ref factory.Built!.Disposals));

        cts.Cancel();
        try { await run; } catch (OperationCanceledException) { }

        Assert.Equal(1, Volatile.Read(ref factory.Built!.Disposals));
    }

    private sealed class HandBackFactory : IConnectorFactory
    {
        public TrackedDriver? Built;

        public string Kind => "HandBack";

        public bool TryCreate(string config, [NotNullWhen(true)] out IDeviceDriver? driver, [NotNullWhen(false)] out string? error)
        {
            Built = new TrackedDriver();
            driver = Built;
            error = null;
            return true;
        }
    }

    [Fact]
    public async Task NoSimulatorsAndNoConnectors_ReturnsWithoutStartingAnything()
    {
        var agent = new EdgeAgentPipelines(new CountingTransport(), new EventBus(), Fallback());
        var warnings = new List<string>();
        var quiet = new EdgeAgentPipelines(new CountingTransport(), new EventBus(), Fallback(), logWarning: warnings.Add);
        using var cts = new CancellationTokenSource(Deadline);

        // SimulatedDriver's own ctor guard ("at least one simulator is required") stays as strict as it is —
        // an empty roster simply never reaches it, the same fix FleetCore.StartLocked applies at its own call
        // site rather than by weakening the guard.
        await agent.RunAsync(simulators: Array.Empty<IMachineSimulator>(), connectors: null, ct: cts.Token);
        await quiet.RunAsync(simulators: null, connectors: new ConnectorRegistry(), ct: cts.Token);

        Assert.Empty(agent.StartedLabels);
        Assert.Contains(warnings, w => w.Contains("nothing to poll"));
    }
}
