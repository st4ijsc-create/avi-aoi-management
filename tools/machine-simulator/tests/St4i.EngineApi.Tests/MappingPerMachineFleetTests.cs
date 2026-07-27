using System.Collections.Concurrent;
using St4i.EdgeCore.Drivers;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// G2-1 (Giai đoạn 2 first pass, docs/plans/2026-07-27-giaidoan2-synapse-connect-blueprint.md task 1) —
/// end-to-end proof that <see cref="FleetHost.StartLocked"/> actually wires each machine's OWN
/// <c>mapping/&lt;name&gt;.json</c> profile (resolved off the SHIPPED preset files copied next to this
/// test binary — same "next to the exe" packaging <c>PackagingFleetJsonTests</c> already proves for
/// <c>fleet.json</c> itself) into the pipeline, rather than the single hardcoded
/// <c>MappingProfile { Name = "fleet-mixed" }</c> every machine shared before this task. A
/// <see cref="RecordingTransport"/> substituted for the usual <see cref="DemoTransport"/> (same
/// "swap the inner ITransport" trick <c>FleetHostHealthAndRegistrationTests.CreateHost</c> already uses)
/// captures the REAL <see cref="CanonicalEnvelope"/> the pipeline sends, so the assertions are against
/// the actual wire payload's unit conversion — not an internal implementation detail.
/// </summary>
public sealed class MappingPerMachineFleetTests
{
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(50);

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

    /// <summary>Same composition FleetHost's own DI wiring in Program.cs uses, minus the ASP.NET host and
    /// minus DemoTransport as the SwitchableTransport's inner (a <see cref="RecordingTransport"/> takes
    /// its place so every envelope the pipeline actually sends is captured) — mirrors
    /// <c>FleetHostHealthAndRegistrationTests.CreateHost</c>.</summary>
    private static (FleetHost Host, RecordingTransport Recorder) CreateHost()
    {
        var recorder = new RecordingTransport();
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(recorder);
        // TransportCoordinator's own ctor calls ApplyModeInternal(initialMode) — for TransportMode.Demo
        // that immediately re-points `switchable` at `demo` (see TransportCoordinator.ApplyModeInternal),
        // clobbering the `recorder` just set above. Re-assert it AFTER construction so the pipeline this
        // host builds actually sends through the recorder, not silently through `demo`.
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo);
        switchable.SetInner(recorder);
        var eventBus = new EventBus();
        return (new FleetHost(switchable, coordinator, eventBus), recorder);
    }

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
    public async Task Machine_naming_a_real_shipped_mapping_profile_gets_that_profiles_unit_conversion()
    {
        var (host, recorder) = CreateHost();

        // DispensingSim (SimulatorFactory's "DISPENSING" machine type) emits a "temperature" metric with
        // raw unit "C". The shipped mapping/dispensing.json maps "C" -> "°C"; the old hardcoded
        // "fleet-mixed" profile (and MappingProfile.ForClass(Automation)) both have an EMPTY UnitMap, so
        // without per-machine resolution this would stay "C" for every machine regardless of fleet.json.
        var mapped = host.RegisterMachine(new MachineDescriptor(
            "DISP-MAP-01", "SN-DISP-MAP-01", DeviceClass.Automation, "DISPENSING", "glue_dispense",
            DriverKind.Simulated, "RC-DISP-MAP", MappingProfile: "dispensing", CycleSeconds: 0.05));
        Assert.True(mapped);

        // Same machine type, NO mappingProfile named -> must fall back to
        // MappingProfile.ForClass(Automation), whose UnitMap is empty, so "temperature" stays "C".
        var unmapped = host.RegisterMachine(new MachineDescriptor(
            "DISP-NOMAP-01", "SN-DISP-NOMAP-01", DeviceClass.Automation, "DISPENSING", "glue_dispense",
            DriverKind.Simulated, "RC-DISP-NOMAP", MappingProfile: null, CycleSeconds: 0.05));
        Assert.True(unmapped);

        host.Start();
        try
        {
            await WaitUntilAsync(
                () => recorder.Sent.Any(e => e.MachineCode == "DISP-MAP-01") && recorder.Sent.Any(e => e.MachineCode == "DISP-NOMAP-01"),
                "both machines to produce at least one envelope");

            var mappedEnv = recorder.Sent.First(e => e.MachineCode == "DISP-MAP-01");
            var unmappedEnv = recorder.Sent.First(e => e.MachineCode == "DISP-NOMAP-01");

            Assert.Equal("°C", TemperatureUnit(mappedEnv));
            Assert.Equal("C", TemperatureUnit(unmappedEnv));
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public async Task Machine_naming_a_missing_mapping_profile_falls_back_gracefully_pipeline_keeps_running()
    {
        var (host, recorder) = CreateHost();

        var added = host.RegisterMachine(new MachineDescriptor(
            "DISP-BADMAP-01", "SN-DISP-BADMAP-01", DeviceClass.Automation, "DISPENSING", "glue_dispense",
            DriverKind.Simulated, "RC-DISP-BADMAP", MappingProfile: "this-file-does-not-exist", CycleSeconds: 0.05));
        Assert.True(added);

        host.Start();
        try
        {
            await WaitUntilAsync(
                () => recorder.Sent.Any(e => e.MachineCode == "DISP-BADMAP-01"),
                "the machine to keep cycling despite naming a mapping profile whose file does not exist");

            Assert.True(host.IsRunning, "a missing mapping/*.json file must never crash the pipeline");
            Assert.Null(host.LastError);

            var env = recorder.Sent.First(e => e.MachineCode == "DISP-BADMAP-01");
            // ForClass(Automation) fallback -> empty UnitMap -> "C" stays unmapped, same as the no-name case.
            Assert.Equal("C", TemperatureUnit(env));
        }
        finally
        {
            host.Stop();
        }
    }
}
