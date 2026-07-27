using System.Collections.Concurrent;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Mapping;
using St4i.EdgeCore.Transport;
using St4i.EdgeCore.Drivers;
using St4i.EdgeCore.Drivers.Simulators;
using St4i.EdgeCore.Engine;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Uns;
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

    // ─────────────────────────────────────────────────────────────────────
    // G2-1 — per-reading MappingProfile resolver (docs/plans/2026-07-27-giaidoan2-synapse-connect-
    // blueprint.md task 1). EdgePipeline still ties the WHOLE fleet to one shared IDeviceDriver/pipeline
    // (per-machine pipelines are a later task) — the resolver lets THAT one pipeline normalize each
    // reading against ITS OWN machine's mapping profile instead of one profile shared by every machine.
    // ─────────────────────────────────────────────────────────────────────

    private sealed class RecordingTransport : ITransport
    {
        public ConcurrentBag<CanonicalEnvelope> Sent { get; } = new();

        public TransportMode Mode => TransportMode.Demo;

        public Task<TransportAck> SendAsync(CanonicalEnvelope env, CancellationToken ct)
        {
            Sent.Add(env);
            return Task.FromResult(new TransportAck(Success: true, Id: 1));
        }

        public Task<HeartbeatResult> HeartbeatAsync(string machineCode, CancellationToken ct) =>
            Task.FromResult(new HeartbeatResult(true, 1, "active", 365));

        public Task<ConfigSyncResult> SyncConfigAsync(string machineCode, string configKind, string? cachedVersion, CancellationToken ct) =>
            Task.FromResult(new ConfigSyncResult(false, null, null));
    }

    private static string? TemperatureUnit(CanonicalEnvelope env)
    {
        foreach (var item in (System.Collections.IEnumerable)env.Payload["metrics"])
        {
            var m = (Dictionary<string, object?>)item;
            if (m["name"] as string == "temperature") return m["unit"] as string;
        }

        return null;
    }

    [Fact]
    public async Task Resolver_null_behaves_byte_identical_to_no_resolver_at_all()
    {
        // DispensingSim emits a "temperature" metric with raw unit "C" — ForClass(Automation)'s UnitMap
        // is empty, so it stays unmapped either way. This locks in that passing profileResolver: null
        // explicitly (rather than omitting the parameter) changes nothing.
        var d = new MachineDescriptor("DISP-BASE", "SN", DeviceClass.Automation, "DISPENSING", "glue_dispense", DriverKind.Simulated, "RC1", null, 0.02);
        var drv = new SimulatedDriver(new[] { (IMachineSimulator)new DispensingSim(d, 55) });
        var recorder = new RecordingTransport();
        var pipe = new EdgePipeline(drv, MappingProfile.ForClass(DeviceClass.Automation), recorder, new EventBus(), profileResolver: null);
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(1));
        try { await pipe.RunAsync(cts.Token); } catch (OperationCanceledException) { }

        Assert.NotEmpty(recorder.Sent);
        Assert.All(recorder.Sent, env => Assert.Equal("C", TemperatureUnit(env)));
    }

    [Fact]
    public async Task Resolver_routes_each_machine_to_its_own_profile_by_machineCode()
    {
        var mapped = new MachineDescriptor("DISP-MAPPED", "SN", DeviceClass.Automation, "DISPENSING", "glue_dispense", DriverKind.Simulated, "RC1", "custom", 0.02);
        var unmapped = new MachineDescriptor("DISP-PLAIN", "SN", DeviceClass.Automation, "DISPENSING", "glue_dispense", DriverKind.Simulated, "RC1", null, 0.02);
        var drv = new SimulatedDriver(new IMachineSimulator[] { new DispensingSim(mapped, 1), new DispensingSim(unmapped, 2) });

        var customProfile = new MappingProfile
        {
            Name = "custom",
            DeviceClass = "Automation",
            UnitMap = new Dictionary<string, string> { ["C"] = "°C" },
        };
        MappingProfile? Resolve(string code) => code == "DISP-MAPPED" ? customProfile : null;

        var recorder = new RecordingTransport();
        var fallbackProfile = MappingProfile.ForClass(DeviceClass.Automation); // empty UnitMap
        var pipe = new EdgePipeline(drv, fallbackProfile, recorder, new EventBus(), profileResolver: Resolve);
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(1));
        try { await pipe.RunAsync(cts.Token); } catch (OperationCanceledException) { }

        var mappedEnvs = recorder.Sent.Where(e => e.MachineCode == "DISP-MAPPED").ToList();
        var unmappedEnvs = recorder.Sent.Where(e => e.MachineCode == "DISP-PLAIN").ToList();
        Assert.NotEmpty(mappedEnvs);
        Assert.NotEmpty(unmappedEnvs);

        Assert.All(mappedEnvs, env => Assert.Equal("°C", TemperatureUnit(env)));
        Assert.All(unmappedEnvs, env => Assert.Equal("C", TemperatureUnit(env)));
    }

    [Fact]
    public async Task Resolver_returning_null_for_an_unrecognized_machineCode_falls_back_to_the_shared_profile()
    {
        var d = new MachineDescriptor("DISP-UNKNOWN", "SN", DeviceClass.Automation, "DISPENSING", "glue_dispense", DriverKind.Simulated, "RC1", null, 0.02);
        var drv = new SimulatedDriver(new[] { (IMachineSimulator)new DispensingSim(d, 3) });

        var recorder = new RecordingTransport();
        var fallbackProfile = MappingProfile.ForClass(DeviceClass.Automation); // empty UnitMap -> "C" stays "C"
        var pipe = new EdgePipeline(drv, fallbackProfile, recorder, new EventBus(), profileResolver: _ => null);
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(1));
        try { await pipe.RunAsync(cts.Token); } catch (OperationCanceledException) { }

        Assert.NotEmpty(recorder.Sent);
        Assert.All(recorder.Sent, env => Assert.Equal("C", TemperatureUnit(env)));
    }

    // ─────────────────────────────────────────────────────────────────────
    // G2-2 — UNS spine (docs/plans/2026-07-27-giaidoan2-synapse-connect-blueprint.md task 2): EdgePipeline's
    // new trailing `uns` param must be purely additive — a null (the default, and every pre-existing test
    // above never passes one) behaves byte-identical to today; a fake IUnsPublisher records one publish
    // per reading while the existing transport/Committed path keeps firing completely unaffected.
    // ─────────────────────────────────────────────────────────────────────

    private sealed class FakeUnsPublisher : IUnsPublisher
    {
        public ConcurrentBag<(DeviceReading Reading, CanonicalEnvelope Envelope)> Published { get; } = new();

        public void PublishReading(DeviceReading reading, CanonicalEnvelope envelope) => Published.Add((reading, envelope));

        public void PublishBirth(string equipmentCode)
        {
        }

        public void PublishDeath(string equipmentCode)
        {
        }
    }

    [Fact]
    public async Task Pipeline_WithNullUnsPublisher_BehavesByteIdenticalToNoUnsParameterAtAll()
    {
        var d = new MachineDescriptor("UNS-NULL", "SN", DeviceClass.Automation, "DISPENSING", "glue_dispense", DriverKind.Simulated, "RC1", null, 0.02);
        var drv = new SimulatedDriver(new[] { (IMachineSimulator)new DispensingSim(d, 11) });
        var recorder = new RecordingTransport();
        var pipe = new EdgePipeline(drv, MappingProfile.ForClass(DeviceClass.Automation), recorder, new EventBus(), profileResolver: null, uns: null);
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(1));
        try { await pipe.RunAsync(cts.Token); } catch (OperationCanceledException) { }

        Assert.NotEmpty(recorder.Sent);
    }

    [Fact]
    public async Task Pipeline_WithFakeUnsPublisher_RecordsOnePublishPerReading_AndTransportCommittedStillFire()
    {
        var d = new MachineDescriptor("UNS-FAKE", "SN", DeviceClass.Automation, "DISPENSING", "glue_dispense", DriverKind.Simulated, "RC1", null, 0.02);
        var drv = new SimulatedDriver(new[] { (IMachineSimulator)new DispensingSim(d, 12) });
        var recorder = new RecordingTransport();
        var uns = new FakeUnsPublisher();
        int committed = 0;

        var pipe = new EdgePipeline(drv, MappingProfile.ForClass(DeviceClass.Automation), recorder, new EventBus(), profileResolver: null, uns: uns);
        pipe.Committed += (_, __) => Interlocked.Increment(ref committed);
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(1));
        try { await pipe.RunAsync(cts.Token); } catch (OperationCanceledException) { }

        Assert.NotEmpty(recorder.Sent);
        Assert.True(committed >= 1);
        // One UNS publish per committed reading — never more, never fewer.
        Assert.Equal(recorder.Sent.Count, uns.Published.Count);
        Assert.All(uns.Published, p => Assert.Equal("UNS-FAKE", p.Reading.MachineCode));
        Assert.All(uns.Published, p => Assert.Equal("UNS-FAKE", p.Envelope.MachineCode));
    }

}
