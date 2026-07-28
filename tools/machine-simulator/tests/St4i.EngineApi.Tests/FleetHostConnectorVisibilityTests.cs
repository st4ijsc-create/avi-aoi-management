using System.Diagnostics.CodeAnalysis;
using St4i.Connector.Abstractions;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// GP-5 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-5-brief.md item 3, carried
/// from the GP-4 review) — before this task, a connector that was configured (registered) but failed to
/// start produced exactly one startup <c>LogWarning</c> and NOTHING else: no <see cref="FleetHost.GetDriverHealth"/>
/// entry (no slot was ever created), no alarm, no health signal. This suite proves
/// <see cref="FleetHost.GetConfiguredConnectorIssues"/> (surfaced over HTTP as <c>GET /v1/connectors</c>,
/// see <c>ConnectorEndpoints</c>) closes that gap — and, just as importantly, proves it does NOT flip
/// <see cref="FleetHost.LastError"/>/<c>GET /v1/health</c>, since the GP-4 review specifically judged that an
/// optional peripheral's bad config must never make the whole host look unhealthy.
/// </summary>
public sealed class FleetHostConnectorVisibilityTests
{
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(100);

    private static FleetHost CreateHost(ConnectorRegistry? registry)
    {
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo);
        var eventBus = new EventBus();
        return new FleetHost(switchable, coordinator, eventBus, connectorRegistry: registry);
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

    [Fact]
    public void NoConnectorRegistry_GetConfiguredConnectorIssues_ReturnsEmpty_NeverThrows()
    {
        var host = CreateHost(registry: null);
        Assert.Empty(host.GetConfiguredConnectorIssues());
    }

    [Fact]
    public async Task ConnectorConfiguredButRejected_VisibleThroughGetConfiguredConnectorIssues_NamingItAndTheError_HealthUnaffected()
    {
        var registry = new ConnectorRegistry();
        registry.Register(new RejectingFactory("vendor.acme.broken", "bad config: missing field 'x'"), config: "garbage");
        var host = CreateHost(registry);

        // Nothing to see before the fleet has ever attempted a start — this is a projection of the LATEST
        // start attempt's outcome, not a standing validation pass.
        Assert.Empty(host.GetConfiguredConnectorIssues());

        host.Start();
        try
        {
            await WaitUntilAsync(() => host.GetConfiguredConnectorIssues().Count > 0,
                "the rejected connector to show up in GetConfiguredConnectorIssues");

            var issue = Assert.Single(host.GetConfiguredConnectorIssues());
            Assert.Equal("vendor.acme.broken", issue.Id);
            Assert.Contains("bad config", issue.Error);

            // The GP-4 review's own judgment, unchanged: an optional peripheral's bad config must never
            // flip the whole host unhealthy — this is purely an informational projection.
            Assert.Null(host.LastError);

            // And it must NOT show up as a running driver either (GetDriverHealth is unaffected/unchanged).
            Assert.DoesNotContain(host.GetDriverHealth(), s => s.Kind == "vendor.acme.broken");
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public async Task ConnectorFixedAndRestarted_IssueClears_NoLongerReportedAsNotStarted()
    {
        // A connector whose factory rejects the FIRST time, then succeeds on every subsequent call —
        // models an operator noticing the /v1/connectors entry, fixing a connectors.json typo, and
        // restarting the fleet (RegisterMachine/ApplyScenario/Start-after-Stop all re-invoke StartLocked).
        var flakyFactory = new FlakyFactory("vendor.acme.flaky");
        var registry = new ConnectorRegistry();
        registry.Register(flakyFactory, config: "x");
        var host = CreateHost(registry);

        host.Start();
        try
        {
            await WaitUntilAsync(() => host.GetConfiguredConnectorIssues().Count > 0,
                "the first (rejected) attempt to show up as an issue");
            Assert.Equal("vendor.acme.flaky", Assert.Single(host.GetConfiguredConnectorIssues()).Id);
        }
        finally
        {
            host.Stop();
        }

        // Fixed now (FlakyFactory always succeeds from its second call onward) — Start() again re-invokes
        // StartLocked's connector loop fresh.
        host.Start();
        try
        {
            await WaitUntilAsync(() => host.GetDriverHealth().Any(s => s.Kind == "vendor.acme.flaky"),
                "the now-fixed connector to actually start");

            Assert.Empty(host.GetConfiguredConnectorIssues());
        }
        finally
        {
            host.Stop();
        }
    }

    private sealed class RejectingFactory : IConnectorFactory
    {
        private readonly string _error;

        public RejectingFactory(string kind, string error)
        {
            Kind = kind;
            _error = error;
        }

        public string Kind { get; }

        public bool TryCreate(string config, [NotNullWhen(true)] out IDeviceDriver? driver, [NotNullWhen(false)] out string? error)
        {
            driver = null;
            error = _error;
            return false;
        }
    }

    private sealed class FlakyFactory : IConnectorFactory
    {
        private int _calls;

        public FlakyFactory(string kind) => Kind = kind;

        public string Kind { get; }

        public bool TryCreate(string config, [NotNullWhen(true)] out IDeviceDriver? driver, [NotNullWhen(false)] out string? error)
        {
            if (Interlocked.Increment(ref _calls) == 1)
            {
                driver = null;
                error = "first attempt always fails (test double)";
                return false;
            }

            driver = new AlwaysOnDriver(Kind);
            error = null;
            return true;
        }
    }

    private sealed class AlwaysOnDriver : IDeviceDriver
    {
        public AlwaysOnDriver(string kind) => Kind = kind;

        public string Id => $"fake-{Kind}-driver";
        public string Kind { get; }
        public St4i.Connector.Abstractions.Models.DriverHealthState Health => St4i.Connector.Abstractions.Models.DriverHealthState.Connected;

        public async IAsyncEnumerable<St4i.Connector.Abstractions.Models.DeviceReading> ReadAsync(
            [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct)
        {
            while (true)
            {
                ct.ThrowIfCancellationRequested();
                yield return new St4i.Connector.Abstractions.Models.DeviceReading
                {
                    MachineCode = "FLAKY-01",
                    Kind = St4i.Connector.Abstractions.Models.ReadingKind.Telemetry,
                    SerialNumber = "SN-FLAKY-01",
                    Timestamp = DateTimeOffset.UtcNow,
                };
                await Task.Delay(TimeSpan.FromMilliseconds(20), ct).ConfigureAwait(false);
            }
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
