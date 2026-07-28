using System.Runtime.CompilerServices;
using St4i.Connector.Abstractions;
using St4i.EdgeCore.Engine;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Transport;
using Xunit;

// Task 3 (St4i.EngineApi) relocated SwitchableTransport/TransportCoordinator/ScenarioConfig/
// ScenarioAwareDriver OUT of the WPF-only St4iMachineSimulator.Services namespace and INTO EdgeCore —
// they only ever depended on EdgeCore types, so both the WPF exhibition app and the headless EngineApi
// host now share the exact same implementation. None of these had a dedicated EdgeCore test before
// (they lived in the untested WPF project); this file gives each a first EdgeCore-level test.

public class SwitchableTransportTests
{
    private sealed class StubTransport : ITransport
    {
        public TransportMode Mode { get; }
        public StubTransport(TransportMode mode) => Mode = mode;

        public Task<TransportAck> SendAsync(CanonicalEnvelope env, CancellationToken ct) =>
            Task.FromResult(new TransportAck(true, HttpStatus: 201));

        public Task<HeartbeatResult> HeartbeatAsync(string machineCode, CancellationToken ct) =>
            Task.FromResult(new HeartbeatResult(true, 1, "active", 365));

        public Task<ConfigSyncResult> SyncConfigAsync(string machineCode, string configKind, string? cachedVersion, CancellationToken ct) =>
            Task.FromResult(new ConfigSyncResult(false, cachedVersion, "none"));
    }

    [Fact]
    public void SetInner_redirects_every_subsequent_call()
    {
        var demo = new StubTransport(TransportMode.Demo);
        var live = new StubTransport(TransportMode.Live);
        var switchable = new SwitchableTransport(demo);

        Assert.Equal(TransportMode.Demo, switchable.Mode);
        Assert.Same(demo, switchable.Inner);

        switchable.SetInner(live);

        Assert.Equal(TransportMode.Live, switchable.Mode);
        Assert.Same(live, switchable.Inner);
    }
}

public class TransportCoordinatorTests
{
    [Fact]
    public void ApplyMode_points_switchable_at_matching_transport_and_only_fires_ModeChanged_on_real_change()
    {
        var demo = new DemoTransport(latencyMs: 0);
        using var live = LiveTransport.ForMachine("http://localhost:1", "", "TEST", null, true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo);

        var fireCount = 0;
        coordinator.ModeChanged += _ => fireCount++;

        coordinator.ApplyMode(TransportMode.Demo); // same value as the ctor's initial mode — must NOT fire
        Assert.Equal(0, fireCount);
        Assert.Same(demo, switchable.Inner);

        coordinator.ApplyMode(TransportMode.Live);
        Assert.Equal(1, fireCount);
        Assert.Same(live, switchable.Inner);

        coordinator.ApplyMode(TransportMode.Auto);
        Assert.Equal(2, fireCount);
        Assert.Same(auto, switchable.Inner);
    }
}

public class ScenarioAwareDriverTests
{
    private sealed class FixedReadingDriver : IDeviceDriver
    {
        private readonly DeviceReading[] _readings;
        public FixedReadingDriver(params DeviceReading[] readings) => _readings = readings;

        public string Id => "fixed";
        public DriverKind Kind => DriverKind.Simulated;
        public DriverHealthState Health => DriverHealthState.Connected;

        public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
        {
            foreach (var r in _readings)
            {
                ct.ThrowIfCancellationRequested();
                yield return r;
                await Task.Yield();
            }
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }

    private static DeviceReading MakeReading(ReadingKind kind, Verdict verdict, string serial, long cycle) => new()
    {
        MachineCode = "SCRW-01",
        Kind = kind,
        SerialNumber = serial,
        Verdict = verdict,
        CycleCounter = cycle,
        Timestamp = DateTimeOffset.UnixEpoch,
    };

    [Fact]
    public async Task ExtraDefectRate_1_always_flips_process_readings_to_Fail()
    {
        var readings = Enumerable.Range(1, 10)
            .Select(i => MakeReading(ReadingKind.ProcessResult, Verdict.Pass, $"S{i}", i))
            .ToArray();
        var driver = new ScenarioAwareDriver(new FixedReadingDriver(readings), () => new ScenarioConfig(ExtraDefectRate: 1.0));

        var results = new List<DeviceReading>();
        await foreach (var r in driver.ReadAsync(CancellationToken.None)) results.Add(r);

        Assert.Equal(10, results.Count);
        Assert.All(results, r => Assert.Equal(Verdict.Fail, r.Verdict));
    }

    [Fact]
    public async Task Telemetry_readings_are_never_flipped_regardless_of_rate()
    {
        var reading = MakeReading(ReadingKind.Telemetry, Verdict.Skip, "S1", 1);
        var driver = new ScenarioAwareDriver(
            new FixedReadingDriver(reading),
            () => new ScenarioConfig(ExtraDefectRate: 1.0, FaultRate: 1.0));

        var results = new List<DeviceReading>();
        await foreach (var r in driver.ReadAsync(CancellationToken.None)) results.Add(r);

        Assert.Single(results);
        Assert.Equal(Verdict.Skip, results[0].Verdict);
    }

    [Fact]
    public async Task ExtraDefectRate_0_never_flips_readings()
    {
        var readings = Enumerable.Range(1, 20)
            .Select(i => MakeReading(ReadingKind.ProcessResult, Verdict.Pass, $"S{i}", i))
            .ToArray();
        var driver = new ScenarioAwareDriver(new FixedReadingDriver(readings), () => ScenarioConfig.Normal);

        var results = new List<DeviceReading>();
        await foreach (var r in driver.ReadAsync(CancellationToken.None)) results.Add(r);

        Assert.All(results, r => Assert.Equal(Verdict.Pass, r.Verdict));
    }
}
