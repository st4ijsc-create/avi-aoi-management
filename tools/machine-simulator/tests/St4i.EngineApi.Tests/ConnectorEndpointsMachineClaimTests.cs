using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Drivers.OpcUa;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Endpoints;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// 🔴 Task D-1 (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-1-brief.md) — handler-level proof
/// for <see cref="ConnectorEndpoints.CreateConnectorAsync"/>'s machine-code CLAIM check: a save whose map
/// names a machine another connector instance already serves is refused BEFORE anything is written.
///
/// <para><b>Why this suite exists rather than another case in <c>ConnectorEndpointsTests</c> — a mutation
/// finding, recorded because a passing test that cannot fail is worth less than no test.</b> The first
/// version of this coverage went through the real HTTP surface: POST connector A for machine M, then POST
/// connector B for the same M, assert 409. It passed — and it passed with the claim check DELETED, because
/// a machine that a live connector serves is also a machine in the roster, and
/// <see cref="ConnectorEndpoints.CreateConnectorAsync"/>'s PRE-EXISTING cross-kind roster-collision guard
/// (Đợt A/SM-5, fix round 1) rejects that request one branch earlier. Two different invariants — "machine
/// codes are unique across the roster" and "two connectors may not serve one machine" — happen to coincide
/// for every request an HTTP client can construct, so the HTTP test could not tell which one answered.</para>
///
/// <para>Calling the handler directly is what separates them: a <see cref="ConnectorRegistry"/> holding a
/// claim for a machine that is NOT in the <see cref="FleetHost"/> roster is trivially constructible here and
/// not constructible over HTTP. The discriminating assertion is not the 409 (the request is refused either
/// way, since <see cref="ConnectorRegistry.Register"/> would also refuse it) — it is that <b>the store is
/// still empty</b>. Without the pre-check the row is written first and the registration fails afterwards,
/// leaving a persisted connector that can never go live: refused, but only after half-applying.</para>
/// </summary>
public sealed class ConnectorEndpointsMachineClaimTests
{
    private static string TempDir() => Directory.CreateTempSubdirectory("st4i-connector-claim-tests-").FullName;

    private static FleetHost CreateHost(ConnectorRegistry registry)
    {
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo);
        return new FleetHost(switchable, coordinator, new EventBus(), connectorRegistry: registry);
    }

    private static string ValidModbusMap(string machineCode) => $$"""
        {
          "machineCode": "{{machineCode}}",
          "unitId": 1,
          "pollIntervalMs": 50,
          "registers": [
            { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "temperature", "unit": "C" }
          ]
        }
        """;

    private static (AuditRecorder Recorder, HttpContext Context) AuditPlumbing() =>
        (new AuditRecorder(new NoOpAuditStore(), NullLogger<AuditRecorder>.Instance), new DefaultHttpContext());

    private static int StatusOf(IResult result) =>
        Assert.IsAssignableFrom<IStatusCodeHttpResult>(result).StatusCode
        ?? throw new InvalidOperationException("handler result carried no status code");

    [Fact]
    public async Task ASaveNamingAMachineAnotherInstanceAlreadyClaims_Is409_AndPersistsNothing()
    {
        const string contested = "D1-CLAIM-CONTESTED";
        var store = new ConnectorConfigStore(TempDir());

        // A live connector instance already serving this machine — but deliberately WITHOUT a roster entry
        // for it, which is what takes the pre-existing roster-collision guard out of the picture and leaves
        // the claim check as the only thing that can answer.
        var registry = new ConnectorRegistry();
        Assert.True(registry.Register(
            new AlwaysFailsToBuildFactory(DriverKinds.Modbus), "incumbent-config",
            instanceId: "modbus-line-a", machineCode: contested));

        var host = CreateHost(registry);
        Assert.DoesNotContain(host.Fleet, d => string.Equals(d.Code, contested, StringComparison.OrdinalIgnoreCase));

        var (recorder, ctx) = AuditPlumbing();
        var result = await ConnectorEndpoints.CreateConnectorAsync(
            new ConnectorCreateRequest("Modbus", "10.9.9.9", 502, ValidModbusMap(contested), InstanceId: "modbus-line-b"),
            store, registry, host, new OpcUaOptions(), ctx, recorder, CancellationToken.None);

        Assert.Equal(StatusCodes.Status409Conflict, StatusOf(result));

        // 🔴 The discriminating assertion. Delete the claim check and this fails: the row for
        // "modbus-line-b" is written, THEN Register refuses it, and the operator is left with a persisted
        // connector configuration that no restart will ever bring to life.
        Assert.Empty(await store.ListAsync());
        Assert.Null(await store.GetAsync("modbus-line-b"));

        // The incumbent's claim is untouched — a refused save must not disturb the connector that won.
        Assert.True(registry.TryGetInstanceIdForMachine(contested, out var claimant));
        Assert.Equal("modbus-line-a", claimant);
        Assert.Equal(new[] { "modbus-line-a" }, registry.RegisteredIds);
    }

    [Fact]
    public async Task AConnectorReSavingItsOwnMachine_IsNotBlockedByItsOwnClaim()
    {
        // The claim gate must reject only OTHER instances. Reconfiguring an existing connector (a new host,
        // a corrected map) is the ordinary operator action and must not be refused by the claim that
        // connector itself placed — a check written as "is this machine claimed at all" would break it.
        const string own = "D1-CLAIM-OWN";
        var store = new ConnectorConfigStore(TempDir());

        var registry = new ConnectorRegistry();
        Assert.True(registry.Register(
            new AlwaysFailsToBuildFactory(DriverKinds.Modbus), "v1",
            instanceId: "modbus-line-a", machineCode: own));

        var host = CreateHost(registry);
        var (recorder, ctx) = AuditPlumbing();

        var result = await ConnectorEndpoints.CreateConnectorAsync(
            new ConnectorCreateRequest("Modbus", "10.9.9.10", 502, ValidModbusMap(own), InstanceId: "modbus-line-a"),
            store, registry, host, new OpcUaOptions(), ctx, recorder, CancellationToken.None);

        Assert.Equal(StatusCodes.Status200OK, StatusOf(result));
        var saved = Assert.Single(await store.ListAsync());
        Assert.Equal("modbus-line-a", saved.EffectiveInstanceId);
        Assert.Equal("10.9.9.10", saved.Host);
    }

    [Fact]
    public async Task ASuccessfulSave_BindsTheLiveRegistration_ToTheMachineItsMapDeclares()
    {
        // 🔴 A mutation finding: dropping `machineCode:` from this endpoint's own
        // ConnectorRegistry.Register call left every test green. An unbound registration looks like a
        // perfectly working connector — until a write, at which point resolution silently falls back to the
        // pre-D-1 kind rule and a second same-kind machine makes both of them ambiguous again. The binding
        // is the single thing that makes a write resolvable, so it gets its own assertion rather than being
        // inferred from "the save returned 200".
        const string code = "D1-CLAIM-BIND";
        var store = new ConnectorConfigStore(TempDir());
        var registry = new ConnectorRegistry();
        var host = CreateHost(registry);
        var (recorder, ctx) = AuditPlumbing();

        var result = await ConnectorEndpoints.CreateConnectorAsync(
            new ConnectorCreateRequest("Modbus", "10.9.9.11", 502, ValidModbusMap(code), InstanceId: "modbus-line-z"),
            store, registry, host, new OpcUaOptions(), ctx, recorder, CancellationToken.None);

        Assert.Equal(StatusCodes.Status200OK, StatusOf(result));
        Assert.True(registry.TryGetInstanceIdForMachine(code, out var claimant));
        Assert.Equal("modbus-line-z", claimant);
        Assert.True(registry.IsBoundToAMachine("modbus-line-z"));
    }

    /// <summary>A factory whose <c>TryCreate</c> always fails: these tests never start a fleet, so no driver
    /// is ever needed — what matters is only that the registry entry (and therefore the machine CLAIM)
    /// exists. Failing loudly rather than returning a stub keeps this double from accidentally becoming a
    /// live driver if a future edit does start the host.</summary>
    private sealed class AlwaysFailsToBuildFactory : St4i.Connector.Abstractions.IConnectorFactory
    {
        public AlwaysFailsToBuildFactory(string kind) => Kind = kind;

        public string Kind { get; }

        public bool TryCreate(
            string config,
            out St4i.Connector.Abstractions.IDeviceDriver? driver,
            out string? error)
        {
            driver = null;
            error = "AlwaysFailsToBuildFactory (test double) never builds a driver.";
            return false;
        }
    }

    private sealed class NoOpAuditStore : IAuditStore
    {
        public Task<AuditEntry> AppendAsync(AuditAppend e, CancellationToken ct) =>
            Task.FromResult(new AuditEntry(
                1, e.AtUtc, e.ActorUsername, e.ActorRole, e.Action, e.TargetType, e.TargetId,
                e.OldValueJson, e.NewValueJson, e.CorrelationId, e.ClientIp, new string('0', 64), "hash"));

        public Task<AuditPage> QueryAsync(
            DateTimeOffset? from, DateTimeOffset? to, string? actor, string? action, string? target,
            int limit, int offset, CancellationToken ct) =>
            Task.FromResult(new AuditPage(Array.Empty<AuditEntry>(), 0, limit, offset));

        public Task<AuditVerifyResult> VerifyChainAsync(CancellationToken ct) =>
            Task.FromResult(new AuditVerifyResult(true, null, "test double"));
    }
}
