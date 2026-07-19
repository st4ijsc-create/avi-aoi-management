using System.Collections.Concurrent;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Mapping;
using St4i.EdgeCore.Transport;
using St4i.EdgeCore.Drivers;
using St4i.EdgeCore.Drivers.Simulators;
using St4i.EdgeCore.Engine;
using St4i.EdgeCore.Infrastructure;
using Xunit;

public class EdgePipelineTests
{
    // Order-dependent stub proving EdgePipeline's central resilience guarantee: a thrown SendAsync
    // (call #1) and a permanent-4xx failed ack (call #2, no throw) must both be recorded via
    // Committed/EventBus rather than killing the read loop — call #3+ still succeeds. Mirrors the
    // DownTransport stub pattern in AutoTransportTests.cs.
    sealed class ThrowThenFailThenOkTransport : ITransport
    {
        private int _calls;

        public TransportMode Mode => TransportMode.Demo;

        public Task<TransportAck> SendAsync(CanonicalEnvelope env, CancellationToken ct)
        {
            var n = Interlocked.Increment(ref _calls);
            return n switch
            {
                1 => throw new InvalidOperationException("boom"),
                2 => Task.FromResult(new TransportAck(Success: false, Error: "perm-4xx")),
                _ => Task.FromResult(new TransportAck(Success: true, Id: n)),
            };
        }

        public Task<HeartbeatResult> HeartbeatAsync(string machineCode, CancellationToken ct) =>
            Task.FromResult(new HeartbeatResult(true, 1, "active", 365));

        public Task<ConfigSyncResult> SyncConfigAsync(string machineCode, string configKind, string? cachedVersion, CancellationToken ct) =>
            Task.FromResult(new ConfigSyncResult(false, null, null));
    }

    [Fact]
    public async Task Pipeline_survives_throwing_and_failing_transport()
    {
        var d = new MachineDescriptor("SCRW-03", "SN", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening", DriverKind.Simulated, "RC1", null, 0.02);
        var drv = new SimulatedDriver(new[] { (IMachineSimulator)new ScrewdriveSim(d, 99) });
        int committed = 0;
        var acks = new ConcurrentBag<TransportAck>();
        var pipe = new EdgePipeline(drv, MappingProfile.ForClass(DeviceClass.Automation), new ThrowThenFailThenOkTransport(), new EventBus());
        pipe.Committed += (_, ack) => { Interlocked.Increment(ref committed); acks.Add(ack); };
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        try { await pipe.RunAsync(cts.Token); } catch (OperationCanceledException) { }

        // If the pipeline died on the throw (call #1), committed would be <=1 here.
        Assert.True(committed >= 3, $"expected the loop to survive both the throw and the failed ack and keep going, got {committed} Committed invocations");
        Assert.Contains(acks, a => !a.Success);
    }

    [Fact]
    public async Task Pipeline_commits_readings_via_demo()
    {
        var d = new MachineDescriptor("SCRW-01", "SN", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening", DriverKind.Simulated, "RC1", null, 0.05);
        var drv = new SimulatedDriver(new[] { (IMachineSimulator)new ScrewdriveSim(d, 42) });
        int committed = 0;
        var pipe = new EdgePipeline(drv, MappingProfile.ForClass(DeviceClass.Automation), new DemoTransport(latencyMs: 0), new EventBus());
        pipe.Committed += (_, __) => Interlocked.Increment(ref committed);
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        try { await pipe.RunAsync(cts.Token); } catch (OperationCanceledException) { }
        Assert.True(committed >= 1);
    }

    [Fact]
    public async Task Pipeline_publishes_trace_events_to_bus()
    {
        var d = new MachineDescriptor("SCRW-02", "SN", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening", DriverKind.Simulated, "RC1", null, 0.05);
        var drv = new SimulatedDriver(new[] { (IMachineSimulator)new ScrewdriveSim(d, 7) });
        int traced = 0;
        ApiTraceEvent? last = null;
        var bus = new EventBus();
        bus.Traced += e => { Interlocked.Increment(ref traced); last = e; };
        var pipe = new EdgePipeline(drv, MappingProfile.ForClass(DeviceClass.Automation), new DemoTransport(latencyMs: 0), bus);
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        try { await pipe.RunAsync(cts.Token); } catch (OperationCanceledException) { }
        Assert.True(traced >= 1);
        Assert.NotNull(last);
        Assert.Equal("SCRW-02", last!.MachineCode);
        Assert.Equal("POST", last.Method);
        Assert.Equal(TransportMode.Demo, last.Mode);
    }
}
