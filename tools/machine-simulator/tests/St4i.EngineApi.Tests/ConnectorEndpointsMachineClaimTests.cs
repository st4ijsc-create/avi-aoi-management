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

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 D-1 review, I-1 — the orphan row. The claim pre-check, SaveAsync and Register are three statements,
    // not one atomic unit, and the store write sits between the first and the third: two concurrent POSTs
    // naming one machine under two instance ids both pass the pre-check, and the loser writes its row before
    // being refused. Before the fix it returned 409 and left that row behind FOREVER — durably persisted,
    // listed in GET /v1/connectors/configured, refused again by Program.cs's startup loop on every boot,
    // never in the roster. Exactly the state this endpoint's own SM-5 comment says must never be creatable.
    //
    // The race itself cannot be forced deterministically from a test (no seam interposes between the
    // pre-check and Register — ConnectorRegistry is sealed and taken as a concrete type), and a
    // probabilistic "run it 500 times and hope" test is precisely the shape this project has learned to
    // distrust. So the COMPENSATION is tested directly instead, both arms, deterministically — it is the
    // part that has logic in it, and it is what a mutation can kill.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task CompensatingAFailedRegistration_ThatCreatedTheRow_RemovesIt_LeavingNoOrphan()
    {
        var store = new ConnectorConfigStore(TempDir());
        await store.SaveAsync("Modbus", "D1-COMP-NEW", "10.0.0.1", 502, "{}", instanceId: "modbus-line-new");
        Assert.Single(await store.ListAsync());

        // `previous: null` means "this request created the row" — rolling back is a plain delete.
        await ConnectorEndpoints.CompensateFailedLiveRegistrationAsync(
            store, "modbus-line-new", previous: null, CancellationToken.None);

        Assert.Empty(await store.ListAsync());
    }

    [Fact]
    public async Task CompensatingAFailedRegistration_ThatOverwroteARow_RestoresThePreviousOne_FieldForField()
    {
        // The arm that must NOT delete: this request overwrote somebody's existing configuration, so the
        // rollback has to put it back. Deleting instead would destroy a connector the operator never asked
        // to remove — strictly worse than the orphan the compensation exists to prevent.
        var store = new ConnectorConfigStore(TempDir());
        var capability = new ConnectorWriteCapability(
            new[] { new ConnectorWritablePointGrant("speed", "address:40001", 0, 500) },
            new[] { new ConnectorCommandGrant("StartCycle", "coil:5") });

        await store.SaveAsync(
            "Modbus", "D1-COMP-ORIGINAL", "10.0.0.1", 502, """{"original":true}""",
            capability, ConnectorConfigSource.Seeded, CancellationToken.None, "modbus-line-x");
        var previous = await store.GetAsync("modbus-line-x");
        Assert.NotNull(previous);

        // The failing request's own overwrite.
        await store.SaveAsync(
            "Modbus", "D1-COMP-USURPER", "10.9.9.9", 5020, """{"usurper":true}""",
            instanceId: "modbus-line-x");

        await ConnectorEndpoints.CompensateFailedLiveRegistrationAsync(
            store, "modbus-line-x", previous, CancellationToken.None);

        var restored = await store.GetAsync("modbus-line-x");
        Assert.NotNull(restored);
        Assert.Equal("D1-COMP-ORIGINAL", restored!.MachineCode);
        Assert.Equal("10.0.0.1", restored.Host);
        Assert.Equal(502, restored.Port);
        Assert.Equal("""{"original":true}""", restored.MapJson);
        // Provenance is part of the row's identity — a Seeded row restored as Operator would start warning
        // on every boot (ConnectorConfigVisibilitySeeder branches on exactly this).
        Assert.Equal(ConnectorConfigSource.Seeded, restored.Source);
        Assert.NotNull(restored.WriteCapability);
        Assert.Equal(capability.ComputeFingerprint(), restored.WriteCapability!.ComputeFingerprint());
        // created_at survives the whole round trip — SaveAsync's upsert never updates it — so the row kept
        // its identity rather than being deleted and re-created.
        Assert.Equal(previous!.CreatedAtUtc, restored.CreatedAtUtc);
        Assert.Single(await store.ListAsync());
    }

    [Fact]
    public async Task CompensatingAFailedRegistration_NeverThrows_WhenTheStoreCallItselfFails()
    {
        // The compensation runs on a path that is already returning a 409. If it threw, an honest "your
        // connector was not registered" would become an opaque 500 AND the row would still be there — the
        // worst of both outcomes.
        //
        // The failure is injected with an already-cancelled token rather than by corrupting the database
        // file: a cancelled request is a REAL way this is reached (the client hung up mid-save, which is
        // exactly when a compensation is most likely to be running), it fails deterministically inside
        // OpenConnectionAsync, and it needs no filesystem games — the first draft of this test deleted the
        // .db file and failed on its own teardown, because Microsoft.Data.Sqlite pools the handle.
        var store = new ConnectorConfigStore(TempDir());
        await store.SaveAsync("Modbus", "D1-COMP-BOOM", "10.0.0.1", 502, "{}", instanceId: "modbus-line-boom");

        using var cancelled = new CancellationTokenSource();
        await cancelled.CancelAsync();

        var exception = await Record.ExceptionAsync(() =>
            ConnectorEndpoints.CompensateFailedLiveRegistrationAsync(
                store, "modbus-line-boom", previous: null, cancelled.Token));

        Assert.Null(exception);

        // And the residue is named honestly rather than pretended away: a compensation that could not run
        // leaves the row it was meant to remove. That is strictly no worse than never having tried, and it
        // is what GET /v1/connectors/configured would show.
        Assert.Single(await store.ListAsync());
    }

    [Fact]
    public async Task ConcurrentSavesForOneMachine_LeaveNoRowForAnyConnectorThatFailedToRegister()
    {
        // 🔴 The compensation's CALL SITE, exercised the only way it can be. The three statements
        // (pre-check → SaveAsync → Register) are not atomic, and no seam interposes between them —
        // ConnectorRegistry is sealed and taken as a concrete type — so a single-threaded test cannot reach
        // the failure branch at all. The two tests above prove the compensation's LOGIC deterministically;
        // this one proves it is actually WIRED, by producing the interleaving for real.
        //
        // 🔴 Stated plainly, with a MEASURED number rather than an asserted one, because this project's own
        // rules demand it: this test is PROBABILISTIC in what it KILLS, never in whether it passes. Its
        // assertion — "every persisted row is backed by a live registration" — holds under every
        // interleaving, including the one where no race occurs at all, so it cannot fail spuriously; what
        // varies is only whether the window is hit on a given run.
        //
        // Measured against the mutation that deletes the compensation call, by running it and counting —
        // never by reasoning about what the rate ought to be:
        //   1 round  x 12 racers  ->  killed  3/10 runs   (too weak to be worth having)
        //   8 rounds x 16 racers  ->  killed 10/10 runs
        // The first shape is weak because SQLite serialises the store read every racer performs BEFORE the
        // pre-check, which spreads their arrival at the window; rounds compound the chance instead of
        // relying on one draw. The two deterministic tests above remain the primary coverage of the
        // compensation's LOGIC — this one exists to prove it is WIRED, and if a future change makes the
        // window quieter it degrades to a no-op rather than to a false green.
        const int rounds = 8;
        const int racers = 16;
        var store = new ConnectorConfigStore(TempDir());

        for (var round = 0; round < rounds; round++)
        {
            var contested = $"D1-RACE-CONTESTED-{round}";
            // A fresh registry and host per round: a registry already holding the previous round's claim
            // would make every racer fail the PRE-CHECK instead of the registration, which is the branch
            // this test is not about.
            var registry = new ConnectorRegistry();
            var host = CreateHost(registry);
            var map = ValidModbusMap(contested);

            using var barrier = new Barrier(racers);
            var threads = Enumerable.Range(0, racers).Select(i => new Thread(() =>
            {
                var (recorder, ctx) = AuditPlumbing();
                barrier.SignalAndWait();
                try
                {
                    ConnectorEndpoints.CreateConnectorAsync(
                            new ConnectorCreateRequest("Modbus", "10.9.9.9", 502, map, InstanceId: $"modbus-r{round}-{i}"),
                            store, registry, host, new OpcUaOptions(), ctx, recorder, CancellationToken.None)
                        .GetAwaiter().GetResult();
                }
                catch
                {
                    // A racer's own failure is not what this test measures — the invariant below is.
                }
            })).ToList();

            foreach (var t in threads) t.Start();
            foreach (var t in threads) Assert.True(t.Join(TimeSpan.FromSeconds(60)), "a racer thread did not finish");

            // Exactly one connector may serve the machine — the registry's own gate.
            Assert.True(registry.TryGetInstanceIdForMachine(contested, out var winner));
            Assert.Single(registry.RegisteredIds);

            // 🔴 The invariant. Before the compensation existed, every racer that passed the pre-check and
            // then lost at Register left its row behind permanently: durably persisted, listed in
            // GET /v1/connectors/configured, refused again by Program.cs's startup loop on every boot, never
            // in the roster. The only row this round may have added is the winner's.
            var rows = await store.ListAsync();
            var thisRound = rows.Where(r => r.MachineCode == contested).ToList();
            Assert.All(thisRound, r => Assert.Equal(winner, r.EffectiveInstanceId));
            Assert.True(
                thisRound.Count <= 1,
                $"round {round}: the store holds {thisRound.Count} rows for '{contested}' — only the winning " +
                "connector's may survive; the rest are orphans no restart will ever bring to life");
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 D-1 review, m2 — a live registry claim OUTLIVES its persisted row (DELETE removes only the
    // configuration; there is no live unregister path). Telling an operator to "remove that connector first"
    // when they already did, and can see it is gone, is the product blaming them for doing the right thing.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task WhenTheClaimingConnectorHasAlreadyBeenDeleted_The409_SaysSoRatherThanTellingTheOperatorToDeleteIt()
    {
        const string contested = "D1-CLAIM-GHOST";
        var store = new ConnectorConfigStore(TempDir());

        var registry = new ConnectorRegistry();
        Assert.True(registry.Register(
            new AlwaysFailsToBuildFactory(DriverKinds.Modbus), "cfg",
            instanceId: "modbus-line-deleted", machineCode: contested));
        // No store row for the claimant — the shape a DELETE leaves behind.
        Assert.Null(await store.GetAsync("modbus-line-deleted"));

        var host = CreateHost(registry);
        var (recorder, ctx) = AuditPlumbing();

        var result = await ConnectorEndpoints.CreateConnectorAsync(
            new ConnectorCreateRequest("Modbus", "10.9.9.9", 502, ValidModbusMap(contested), InstanceId: "modbus-line-new"),
            store, registry, host, new OpcUaOptions(), ctx, recorder, CancellationToken.None);

        Assert.Equal(StatusCodes.Status409Conflict, StatusOf(result));
        var message = Assert.IsAssignableFrom<IValueHttpResult<ApiErrorDto>>(result).Value!.Error;

        // The actionable fact is that a restart is required, NOT that the operator should delete something
        // they have already deleted.
        Assert.Contains("restart", message, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("DELETE /v1/connectors/", message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task WhenTheClaimingConnectorIsStillConfigured_The409_NamesTheDeleteThatWouldFreeTheMachine()
    {
        // The control for the test above: with the claimant's row still present, "remove that connector
        // first" IS the right advice, and the message must still give it. Without this pair, a fix that
        // simply deleted the actionable half of the message would pass.
        const string contested = "D1-CLAIM-LIVE";
        var store = new ConnectorConfigStore(TempDir());
        await store.SaveAsync("Modbus", contested, "10.0.0.1", 502, "{}", instanceId: "modbus-line-live");

        var registry = new ConnectorRegistry();
        Assert.True(registry.Register(
            new AlwaysFailsToBuildFactory(DriverKinds.Modbus), "cfg",
            instanceId: "modbus-line-live", machineCode: contested));

        var host = CreateHost(registry);
        var (recorder, ctx) = AuditPlumbing();

        var result = await ConnectorEndpoints.CreateConnectorAsync(
            new ConnectorCreateRequest("Modbus", "10.9.9.9", 502, ValidModbusMap(contested), InstanceId: "modbus-line-new"),
            store, registry, host, new OpcUaOptions(), ctx, recorder, CancellationToken.None);

        Assert.Equal(StatusCodes.Status409Conflict, StatusOf(result));
        var message = Assert.IsAssignableFrom<IValueHttpResult<ApiErrorDto>>(result).Value!.Error;
        Assert.Contains("DELETE /v1/connectors/modbus-line-live", message, StringComparison.Ordinal);
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
