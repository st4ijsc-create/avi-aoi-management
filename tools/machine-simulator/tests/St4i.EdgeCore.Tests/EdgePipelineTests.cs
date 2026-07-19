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
