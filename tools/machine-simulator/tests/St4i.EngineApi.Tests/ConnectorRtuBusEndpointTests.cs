using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Drivers.Modbus;
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
/// 🔴 Task D-7b (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-7b-brief.md) — <b>the two
/// endpoint gaps D-7a deferred: <c>POST /v1/connectors</c> creating an RS-485 bus, and what a PARTIAL
/// failure means when it does.</b>
///
/// <para>Every assertion here is about a consequence an operator can observe — what the store holds, what
/// the registry claims, what the roster contains — never about a handler having been called. The partial
/// cases are the point: the brief's own framing is that <i>a rollback that is itself partial is worse than
/// no rollback</i>, so each failing case asserts the absence of every trace, not merely a 4xx.</para>
/// </summary>
public sealed class ConnectorRtuBusEndpointTests
{
    private static string TempDir() => Directory.CreateTempSubdirectory("st4i-rtu-bus-endpoint-").FullName;

    private static FleetHost CreateHost(ConnectorRegistry registry)
    {
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo);
        return new FleetHost(switchable, coordinator, new EventBus(), connectorRegistry: registry);
    }

    private static (AuditRecorder Recorder, HttpContext Context) AuditPlumbing() =>
        (new AuditRecorder(new NoOpAuditStore(), NullLogger<AuditRecorder>.Instance), new DefaultHttpContext());

    private static int StatusOf(IResult result) =>
        Assert.IsAssignableFrom<IStatusCodeHttpResult>(result).StatusCode
        ?? throw new InvalidOperationException("handler result carried no status code");

    private static string ErrorOf(IResult result) =>
        Assert.IsType<ApiErrorDto>(Assert.IsAssignableFrom<IValueHttpResult>(result).Value).Error;

    private static ConnectorCreateResultDto CreatedOf(IResult result) =>
        Assert.IsType<ConnectorCreateResultDto>(Assert.IsAssignableFrom<IValueHttpResult>(result).Value);

    private static string Device(string machineCode, int unitId) => $$"""
        {
          "machineCode": "{{machineCode}}",
          "unitId": {{unitId}},
          "pollIntervalMs": 1000,
          "readTimeoutMs": 250,
          "registers": [
            { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "temperature", "unit": "C" }
          ]
        }
        """;

    /// <summary>A directly-attached RS-485 line. <c>COM9</c> is never opened by any test here — construction
    /// opens nothing (D-7c pinned the deferred open), and none of these tests starts a fleet.</summary>
    private static string SerialBus(params string[] devices) => $$"""
        {
          "transport": "rtu-serial",
          "portName": "COM9",
          "baudRate": 19200,
          "parity": "even",
          "devices": [ {{string.Join(",", devices)}} ]
        }
        """;

    private static string GatewayBus(params string[] devices) => $$"""
        {
          "transport": "rtu-gateway",
          "host": "10.4.4.4",
          "port": 4001,
          "devices": [ {{string.Join(",", devices)}} ]
        }
        """;

    private static Task<IResult> PostAsync(
        ConnectorConfigStore store, ConnectorRegistry registry, ModbusBusRegistry busRegistry, FleetHost host,
        string busId, string mapJson)
    {
        var (recorder, ctx) = AuditPlumbing();
        return ConnectorEndpoints.CreateConnectorAsync(
            new ConnectorCreateRequest("Modbus", null, null, mapJson, InstanceId: busId),
            store, registry, host, new OpcUaOptions(), ctx, recorder, CancellationToken.None,
            busRegistry: busRegistry, loggerFactory: NullLoggerFactory.Instance);
    }

    // ─────────────────────────────────────────────────────────────────────
    // The happy path — N connectors, N claims, N roster machines, one bus
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ABusOfThreeDevices_Saves3Rows_Registers3Instances_AndSeeds3Machines()
    {
        var store = new ConnectorConfigStore(TempDir());
        var registry = new ConnectorRegistry();
        var host = CreateHost(registry);

        var result = await PostAsync(
            store, registry, new ModbusBusRegistry(), host, "line1",
            SerialBus(Device("RTU-A", 1), Device("RTU-B", 2), Device("RTU-C", 3)));

        Assert.Equal(StatusCodes.Status200OK, StatusOf(result));

        // The persisted half: one row per DEVICE, keyed under the derived namespace, all carrying the bus.
        var rows = await store.ListAsync();
        Assert.Equal(3, rows.Count);
        Assert.Equal(
            new[] { "line1:unit1", "line1:unit2", "line1:unit3" },
            rows.Select(r => r.EffectiveInstanceId).OrderBy(x => x, StringComparer.Ordinal).ToArray());
        Assert.All(rows, r => Assert.Equal("line1", r.BusInstanceId));

        // The live half: three distinct instances, three distinct machine claims. This is what makes a write
        // for RTU-B resolve to unit 2 and not to whichever device happened to register last.
        Assert.Equal(3, registry.RegisteredIds.Count);
        Assert.True(registry.TryGetInstanceIdForMachine("RTU-B", out var claimant));
        Assert.Equal("line1:unit2", claimant);

        // The roster half: three machines an operator can see, each with the RTU machine type.
        Assert.Equal(3, host.Fleet.Count(d => d.MachineType == RtuBusConfiguration.RtuMachineType));

        var created = CreatedOf(result);
        Assert.NotNull(created.Devices);
        Assert.Equal(3, created.Devices!.Count);
        Assert.True(created.AppliedLive);
    }

    /// <summary>🔴 The projection D-7a decided and D-7c handed over with no code path: the LINE goes in
    /// <c>host</c>, and a serial line's <c>port</c> is <see langword="null"/>. Asserted here through the
    /// endpoint as well as at the store boundary (<c>ConnectorConfigStoreTests</c>) because an endpoint that
    /// wrote the device's unit id into <c>host</c> would still pass the store's own test.</summary>
    [Fact]
    public async Task ASerialBus_PutsThePortNameInHost_AndNullInPort_OnEveryDeviceRow()
    {
        var store = new ConnectorConfigStore(TempDir());
        var registry = new ConnectorRegistry();

        Assert.Equal(StatusCodes.Status200OK, StatusOf(await PostAsync(
            store, registry, new ModbusBusRegistry(), CreateHost(registry), "serial-line",
            SerialBus(Device("SER-A", 1), Device("SER-B", 2)))));

        var rows = await store.ListAsync();
        Assert.Equal(2, rows.Count);
        Assert.All(rows, r =>
        {
            Assert.Equal("COM9", r.Host);
            Assert.Null(r.Port);
        });
    }

    [Fact]
    public async Task AGatewayBus_PutsTheGatewaysHostAndPortOnEveryDeviceRow()
    {
        var store = new ConnectorConfigStore(TempDir());
        var registry = new ConnectorRegistry();

        Assert.Equal(StatusCodes.Status200OK, StatusOf(await PostAsync(
            store, registry, new ModbusBusRegistry(), CreateHost(registry), "gw-line",
            GatewayBus(Device("GW-A", 1), Device("GW-B", 2)))));

        var rows = await store.ListAsync();
        Assert.All(rows, r =>
        {
            Assert.Equal("10.4.4.4", r.Host);
            Assert.Equal(4001, r.Port);
        });
    }

    // ─────────────────────────────────────────────────────────────────────
    // PARTIAL FAILURE — the whole bus, or none of it
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>The brief's own question, answered as a test: "what does a partial failure look like when device
    /// 5 of 8 is invalid — does the whole bus fail, or do 7 register?"</b>
    ///
    /// <para>The whole bus fails, and it fails with NOTHING mutated — which is stronger than "the whole bus
    /// fails and is then rolled back", because there is no rollback to be interrupted. Asserted on all four
    /// observable surfaces (store, registry, roster, and the message naming the offending element), not on
    /// the status code alone: a 400 that had already written seven rows would satisfy a status assertion and
    /// be the exact defect this case exists to refuse.</para>
    /// </summary>
    [Fact]
    public async Task ABusWhoseFifthDeviceIsInvalid_RegistersNothingAtAll_AndNamesWhichDevice()
    {
        var store = new ConnectorConfigStore(TempDir());
        var registry = new ConnectorRegistry();
        var host = CreateHost(registry);
        var rosterBefore = host.Fleet.Count;

        // Devices 0-3 and 5-7 are valid; index 4 (the fifth) declares no registers at all.
        var devices = new List<string>();
        for (var i = 1; i <= 8; i++)
        {
            devices.Add(i == 5
                ? """{ "machineCode": "RTU-BAD", "unitId": 5, "pollIntervalMs": 1000, "registers": [] }"""
                : Device($"RTU-{i}", i));
        }

        var result = await PostAsync(store, registry, new ModbusBusRegistry(), host, "line8", SerialBus(devices.ToArray()));

        Assert.Equal(StatusCodes.Status400BadRequest, StatusOf(result));
        // Named by POSITION in the array, so an operator can find it in the file they pasted.
        Assert.Contains("devices[4]", ErrorOf(result), StringComparison.Ordinal);

        Assert.Empty(await store.ListAsync());
        Assert.Empty(registry.RegisteredIds);
        Assert.Equal(rosterBefore, host.Fleet.Count);
    }

    /// <summary>🔴 The same all-or-nothing rule for the OTHER refusal an operator will actually hit: one
    /// device on the new bus names a machine an existing connector already serves. Everything before it in
    /// the array is valid — so a "register what you can" implementation would leave the earlier devices
    /// behind, which is what this asserts against.</summary>
    [Fact]
    public async Task ABusWhoseThirdDeviceCollidesWithAnExistingClaim_LeavesNoRow_NoClaim_AndSaysNothingWasSaved()
    {
        const string contested = "RTU-CONTESTED";
        var store = new ConnectorConfigStore(TempDir());
        var registry = new ConnectorRegistry();
        Assert.True(registry.Register(
            new AlwaysRefusesFactory(), "incumbent", instanceId: "other-line", machineCode: contested));

        var host = CreateHost(registry);

        var result = await PostAsync(
            store, registry, new ModbusBusRegistry(), host, "line3",
            SerialBus(Device("RTU-OK-1", 1), Device("RTU-OK-2", 2), Device(contested, 3)));

        Assert.Equal(StatusCodes.Status409Conflict, StatusOf(result));
        var error = ErrorOf(result);
        Assert.Contains("unit 3", error, StringComparison.Ordinal);
        Assert.Contains("other-line", error, StringComparison.Ordinal);
        // The sentence an operator acts on: not merely "refused", but "and nothing of yours was written".
        Assert.Contains("NOTHING was saved", error, StringComparison.Ordinal);

        Assert.Empty(await store.ListAsync());
        // The two valid devices ahead of the collision did NOT sneak in, and the incumbent is untouched.
        Assert.Equal(new[] { "other-line" }, registry.RegisteredIds);
        Assert.DoesNotContain(host.Fleet, d => d.Code.StartsWith("RTU-OK", StringComparison.Ordinal));
    }

    /// <summary>🔴 A re-save of an existing bus must not refuse ITSELF. The bus's own devices hold the claims
    /// and the roster entries the new document names, so a collision check written as "is this machine
    /// claimed / in the roster at all" makes the second save of every bus impossible — and would do it with
    /// a message blaming the operator for a connector they are in the middle of editing.</summary>
    [Fact]
    public async Task ReSavingABusWithADeviceRemoved_Succeeds_AndTheRemovedDevicesRowIsGone()
    {
        var store = new ConnectorConfigStore(TempDir());
        var registry = new ConnectorRegistry();
        var host = CreateHost(registry);

        Assert.Equal(StatusCodes.Status200OK, StatusOf(await PostAsync(
            store, registry, new ModbusBusRegistry(), host, "line1",
            SerialBus(Device("RS-A", 1), Device("RS-B", 2), Device("RS-C", 3)))));

        // The operator deletes unit 2 from their file and saves again.
        Assert.Equal(StatusCodes.Status200OK, StatusOf(await PostAsync(
            store, registry, new ModbusBusRegistry(), host, "line1",
            SerialBus(Device("RS-A", 1), Device("RS-C", 3)))));

        var rows = await store.ListAsync();
        Assert.Equal(
            new[] { "line1:unit1", "line1:unit3" },
            rows.Select(r => r.EffectiveInstanceId).OrderBy(x => x, StringComparer.Ordinal).ToArray());

        // 🔴 The persisted half of the ghost D-4's review named: a device removed from the map must not leave
        // a row describing a device the operator deleted. An upsert-per-surviving-device implementation
        // passes every other assertion in this test and fails this one.
        Assert.DoesNotContain(rows, r => r.EffectiveInstanceId == "line1:unit2");
    }

    /// <summary>
    /// 🔴 <b>Fix round 1, review I-2 — re-addressing two devices on a line WORKS. Before this round it was a
    /// permanent dead end, and the endpoint's own refusal named a cause that had not happened.</b>
    ///
    /// <para>Two devices trading slave addresses is routine RS-485 maintenance. Until fix round 1 it produced
    /// a 409 saying the machine <i>"was claimed ... while this request was in flight"</i> — where the claimant
    /// was this same bus's own device from the PREVIOUS save, claimed long before the request. Worse than a
    /// wrong cause: the store was rolled back and the registry left untouched, so <b>the identical retry
    /// failed identically, forever</b>, and the only exit was a <c>DELETE</c> the message never mentioned.</para>
    ///
    /// <para>The fix is structural, not a rewording: the bus releases its OWN namespace immediately before the
    /// register pass. The assertions below are the operator-facing consequence — the save succeeds, the
    /// machines end up on the addresses the operator's file declares, and a write for <c>SWAP-A</c> now
    /// resolves to unit 2. A message that correctly describes a dead end is still a dead end.</para>
    /// </summary>
    [Fact]
    public async Task TwoDevicesTradingSlaveAddresses_SavesAndReRegistersOnTheNewAddresses()
    {
        var store = new ConnectorConfigStore(TempDir());
        var registry = new ConnectorRegistry();
        var host = CreateHost(registry);

        Assert.Equal(StatusCodes.Status200OK, StatusOf(await PostAsync(
            store, registry, new ModbusBusRegistry(), host, "line1",
            SerialBus(Device("SWAP-A", 1), Device("SWAP-B", 2)))));

        var swap = await PostAsync(
            store, registry, new ModbusBusRegistry(), host, "line1",
            SerialBus(Device("SWAP-B", 1), Device("SWAP-A", 2)));

        Assert.Equal(StatusCodes.Status200OK, StatusOf(swap));

        // The persisted half: the machines moved, and both rows still belong to this bus.
        Assert.Equal(
            new[] { ("line1:unit1", "SWAP-B"), ("line1:unit2", "SWAP-A") },
            (await store.ListAsync())
                .Select(r => (r.EffectiveInstanceId, r.MachineCode))
                .OrderBy(x => x.EffectiveInstanceId, StringComparer.Ordinal)
                .ToArray());

        // 🔴 The live half, and the one that matters: a write for SWAP-A must now resolve to unit 2. A save
        // that persisted the swap while the registry still routed SWAP-A to unit 1 would send that write to
        // the wrong slave address on a shared wire — the failure the whole identity model exists to make
        // unreachable.
        Assert.True(registry.TryGetInstanceIdForMachine("SWAP-A", out var a));
        Assert.Equal("line1:unit2", a);
        Assert.True(registry.TryGetInstanceIdForMachine("SWAP-B", out var b));
        Assert.Equal("line1:unit1", b);
        Assert.Equal(2, registry.RegisteredIds.Count);
    }

    /// <summary>🔴 Fix round 1, I-2's second half — a device DROPPED from the map no longer keeps its machine
    /// claim. <see cref="ConnectorConfigStore.SaveBusAsync"/> already deleted its row; before this round the
    /// registry entry survived until the process restarted, so the machine could be served by nothing and a
    /// replacement connector for it was refused by a ghost. This is the endpoint half of the same sweep
    /// <c>ModbusMultidropRegistration.SweepGhosts</c> does for <c>connectors.json</c>.</summary>
    [Fact]
    public async Task ADeviceDroppedFromTheMap_LosesItsMachineClaimToo_NotJustItsRow()
    {
        var store = new ConnectorConfigStore(TempDir());
        var registry = new ConnectorRegistry();
        var host = CreateHost(registry);

        Assert.Equal(StatusCodes.Status200OK, StatusOf(await PostAsync(
            store, registry, new ModbusBusRegistry(), host, "line1",
            SerialBus(Device("KEEP", 1), Device("DROP", 2)))));

        Assert.Equal(StatusCodes.Status200OK, StatusOf(await PostAsync(
            store, registry, new ModbusBusRegistry(), host, "line1",
            SerialBus(Device("KEEP", 1)))));

        Assert.Equal(new[] { "line1:unit1" }, registry.RegisteredIds);
        Assert.False(registry.TryGetInstanceIdForMachine("DROP", out _));
    }

    /// <summary>
    /// 🔴 <b>Fix round 1, review I-1 — the sentence a failed bus save prints, over every combination.</b>
    ///
    /// <para>The previous version appended <i>"the LIVE registry entries ... were replaced before the refusal
    /// and cannot be put back"</i> UNCONDITIONALLY whenever the bus already had rows — telling an operator
    /// their running configuration had diverged from the store and needed a restart, on a path where nothing
    /// live had been touched at all. The branch is reachable only under a concurrent registration, so the
    /// sentence is a pure function and this is where the consequence question gets asked.</para>
    ///
    /// <para>These two rows are the discriminating ones: with nothing released, the message must NOT claim the
    /// registry was disturbed, and must say plainly that it was not.</para>
    /// </summary>
    [Theory]
    [InlineData(0)]
    [InlineData(2)]
    public void TheBusRollbackSentence_NeverClaimsTheRegistryWasDisturbed_WhenNothingWasReleased(
        int previousDeviceCount)
    {
        var message = ConnectorEndpoints.DescribeBusRollbackOutcome(
            "line1", rolledBack: true, previousDeviceCount, incumbentsReleased: 0);

        Assert.DoesNotContain("cannot be put back", message, StringComparison.Ordinal);
        Assert.DoesNotContain("released before the register pass", message, StringComparison.Ordinal);
        Assert.Contains("No live connector on this bus was disturbed", message, StringComparison.Ordinal);
    }

    [Fact]
    public void TheBusRollbackSentence_SaysWhatCannotBePutBack_WhenRegistrationsWereActuallyReleased()
    {
        var message = ConnectorEndpoints.DescribeBusRollbackOutcome(
            "line1", rolledBack: true, previousDeviceCount: 3, incumbentsReleased: 3);

        Assert.Contains("3 live registration(s)", message, StringComparison.Ordinal);
        Assert.Contains("cannot be put back", message, StringComparison.Ordinal);
        Assert.Contains("restored", message, StringComparison.Ordinal);
        Assert.DoesNotContain("No live connector on this bus was disturbed", message, StringComparison.Ordinal);
    }

    [Fact]
    public void TheBusRollbackSentence_ForAFailedRollback_PointsAtTheEndpointThatWouldShowTheWreckage()
    {
        var message = ConnectorEndpoints.DescribeBusRollbackOutcome(
            "line1", rolledBack: false, previousDeviceCount: 0, incumbentsReleased: 0);

        Assert.Contains("did NOT complete", message, StringComparison.Ordinal);
        Assert.Contains("GET /v1/connectors/configured", message, StringComparison.Ordinal);
        // Never the reassuring half: a message false in the direction of "nothing to check here" stops the one
        // person who could clean up from looking.
        Assert.DoesNotContain("no leftover configuration", message, StringComparison.Ordinal);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Identity and refusals
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ABusWithNoInstanceId_IsRefused_BecauseABusCannotFallBackToItsProtocolKind()
    {
        var store = new ConnectorConfigStore(TempDir());
        var registry = new ConnectorRegistry();
        var (recorder, ctx) = AuditPlumbing();

        var result = await ConnectorEndpoints.CreateConnectorAsync(
            new ConnectorCreateRequest("Modbus", null, null, SerialBus(Device("RTU-A", 1))),
            store, registry, CreateHost(registry), new OpcUaOptions(), ctx, recorder, CancellationToken.None,
            busRegistry: new ModbusBusRegistry(), loggerFactory: NullLoggerFactory.Instance);

        Assert.Equal(StatusCodes.Status400BadRequest, StatusOf(result));
        Assert.Contains("instanceId is required", ErrorOf(result), StringComparison.Ordinal);
        Assert.Empty(await store.ListAsync());
    }

    /// <summary>The derived namespace is reserved in BOTH directions, and this is the door a bus comes
    /// through. A bus named <c>line1:unit3</c> would have its own registration swept by bus <c>line1</c>'s
    /// next pass — a connector that vanished with nothing pointing at why.</summary>
    [Fact]
    public async Task ABusNamedLikeADevicePosition_IsRefused()
    {
        var store = new ConnectorConfigStore(TempDir());
        var registry = new ConnectorRegistry();

        var result = await PostAsync(
            store, registry, new ModbusBusRegistry(), CreateHost(registry), "line1:unit3",
            SerialBus(Device("RTU-A", 1)));

        Assert.Equal(StatusCodes.Status400BadRequest, StatusOf(result));
        Assert.Empty(await store.ListAsync());
    }

    /// <summary>An ordinary Modbus TCP save is byte-for-byte unaffected by the RTU arm — the ONE thing that
    /// routes a request to it is the document declaring a transport, which a TCP map never does.</summary>
    [Fact]
    public async Task AnOrdinaryModbusTcpSave_StillTakesTheSingleConnectorPath_AndCarriesNoBus()
    {
        var store = new ConnectorConfigStore(TempDir());
        var registry = new ConnectorRegistry();
        var (recorder, ctx) = AuditPlumbing();

        var result = await ConnectorEndpoints.CreateConnectorAsync(
            new ConnectorCreateRequest("Modbus", "10.1.1.1", 502, Device("TCP-ONLY", 1)),
            store, registry, CreateHost(registry), new OpcUaOptions(), ctx, recorder, CancellationToken.None,
            busRegistry: new ModbusBusRegistry(), loggerFactory: NullLoggerFactory.Instance);

        Assert.Equal(StatusCodes.Status200OK, StatusOf(result));
        var row = Assert.Single(await store.ListAsync());
        Assert.Equal("Modbus", row.EffectiveInstanceId);
        Assert.Null(row.BusInstanceId);
        Assert.Null(CreatedOf(result).Devices);
    }

    // ─────────────────────────────────────────────────────────────────────
    // DELETE — exactly the device the operator meant
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>The collision the web UI had, pinned at the server boundary the UI talks to.</b> Two devices on
    /// one bus, delete one: the right row goes, its sibling survives, and the surviving device keeps its
    /// machine claim. Before D-1 this was impossible to express at all (one connector per kind); before D-7b
    /// the web client asked for it by KIND, which on this bus addresses neither device in particular.
    /// </summary>
    [Fact]
    public async Task DeletingOneDeviceOfATwoDeviceBus_RemovesExactlyThatOne_AndLeavesItsSiblingRunning()
    {
        var store = new ConnectorConfigStore(TempDir());
        var registry = new ConnectorRegistry();
        var host = CreateHost(registry);

        Assert.Equal(StatusCodes.Status200OK, StatusOf(await PostAsync(
            store, registry, new ModbusBusRegistry(), host, "line1",
            SerialBus(Device("KEEP-ME", 1), Device("DELETE-ME", 2)))));

        var (recorder, ctx) = AuditPlumbing();
        var deleted = await ConnectorEndpoints.DeleteConnectorAsync(
            "line1:unit2", store, registry, ctx, recorder, CancellationToken.None);

        Assert.Equal(StatusCodes.Status200OK, StatusOf(deleted));

        var rows = await store.ListAsync();
        var survivor = Assert.Single(rows);
        Assert.Equal("line1:unit1", survivor.EffectiveInstanceId);
        Assert.Equal("KEEP-ME", survivor.MachineCode);

        // The sibling's live claim is untouched; the deleted device's is released.
        Assert.True(registry.TryGetInstanceIdForMachine("KEEP-ME", out var keeper));
        Assert.Equal("line1:unit1", keeper);
        Assert.False(registry.TryGetInstanceIdForMachine("DELETE-ME", out _));

        // The message names the DEVICE and its line, and says what remains — an operator who deletes one of
        // eight must not be told "the Modbus connector was removed".
        var message = Assert.IsType<ConnectorDeleteResultDto>(
            Assert.IsAssignableFrom<IValueHttpResult>(deleted).Value).Message;
        Assert.Contains("line1:unit2", message, StringComparison.Ordinal);
        Assert.Contains("line1", message, StringComparison.Ordinal);
        Assert.Contains("1 device(s) remain", message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task DeletingTheLastDeviceOfABus_SaysTheBusIsNoLongerConfigured()
    {
        var store = new ConnectorConfigStore(TempDir());
        var registry = new ConnectorRegistry();

        Assert.Equal(StatusCodes.Status200OK, StatusOf(await PostAsync(
            store, registry, new ModbusBusRegistry(), CreateHost(registry), "solo",
            SerialBus(Device("ONLY-ONE", 7)))));

        var (recorder, ctx) = AuditPlumbing();
        var deleted = await ConnectorEndpoints.DeleteConnectorAsync(
            "solo:unit7", store, registry, ctx, recorder, CancellationToken.None);

        Assert.Equal(StatusCodes.Status200OK, StatusOf(deleted));
        Assert.Empty(await store.ListAsync());
        Assert.Contains(
            "last device on that line",
            Assert.IsType<ConnectorDeleteResultDto>(Assert.IsAssignableFrom<IValueHttpResult>(deleted).Value).Message,
            StringComparison.Ordinal);
    }

    // ─────────────────────────────────────────────────────────────────────
    // The deliberate-save gate, over a whole bus
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>B-3's gate still applies to a bus, and its fingerprint is over the UNION of every device's
    /// grants — so re-pointing ONE device's writable register invalidates a confirmation obtained for the
    /// bus, which is the property that makes the confirmation mean anything.</summary>
    [Fact]
    public async Task AWritableBus_IsRefusedWithoutConfirmation_AndItsFingerprintChangesWhenOneDeviceIsRePointed()
    {
        var store = new ConnectorConfigStore(TempDir());
        var registry = new ConnectorRegistry();
        var host = CreateHost(registry);

        static string WritableDevice(string code, int unit, int address) => $$"""
            {
              "machineCode": "{{code}}", "unitId": {{unit}}, "pollIntervalMs": 1000, "readTimeoutMs": 250,
              "registers": [
                { "address": {{address}}, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "speed",
                  "unit": "rpm", "writable": { "min": 0, "max": 500 } }
              ]
            }
            """;

        var first = await PostAsync(
            store, registry, new ModbusBusRegistry(), host, "wbus",
            SerialBus(WritableDevice("W-A", 1, 10), WritableDevice("W-B", 2, 20)));

        Assert.Equal(StatusCodes.Status400BadRequest, StatusOf(first));
        var firstMessage = ErrorOf(first);
        Assert.Contains("requires deliberate confirmation", firstMessage, StringComparison.Ordinal);
        Assert.Empty(await store.ListAsync());

        // Re-point device B's writable register. The required fingerprint MUST differ — a bus-wide
        // fingerprint that only hashed the device COUNT, or the first device, would print the same value.
        var second = await PostAsync(
            store, registry, new ModbusBusRegistry(), host, "wbus",
            SerialBus(WritableDevice("W-A", 1, 10), WritableDevice("W-B", 2, 99)));

        Assert.Equal(StatusCodes.Status400BadRequest, StatusOf(second));
        Assert.NotEqual(FingerprintIn(firstMessage), FingerprintIn(ErrorOf(second)));
    }

    /// <summary>The 64-hex-character SHA-256 digest the gate's message quotes. Extracted rather than
    /// re-derived so this test cannot agree with a wrong implementation by computing the same wrong
    /// value.</summary>
    private static string FingerprintIn(string message)
    {
        var match = System.Text.RegularExpressions.Regex.Match(message, "[0-9A-F]{64}");
        Assert.True(match.Success, $"no fingerprint found in: {message}");
        return match.Value;
    }

    /// <summary>A factory whose <c>TryCreate</c> always refuses — enough to hold a registry claim without any
    /// driver ever being built. Mirrors <c>ConnectorEndpointsMachineClaimTests</c>' own helper.</summary>
    private sealed class AlwaysRefusesFactory : IConnectorFactory
    {
        public string Kind => DriverKinds.Modbus;

        // The [NotNullWhen] attributes match IConnectorFactory.TryCreate's own. Not decoration: without them
        // the compiler emits CS8767 twice, and the gate's warning count is the one number in this project
        // that nobody asserts on and that has caught a drift in each of the last two rounds.
        public bool TryCreate(
            string config,
            [System.Diagnostics.CodeAnalysis.NotNullWhen(true)] out IDeviceDriver? driver,
            [System.Diagnostics.CodeAnalysis.NotNullWhen(false)] out string? error)
        {
            driver = null;
            error = "this factory never builds a driver";
            return false;
        }
    }

    /// <summary>The same no-op audit sink <c>ConnectorEndpointsMachineClaimTests</c> uses — duplicated rather
    /// than shared because these two suites are deliberately independent and a shared test double is a shared
    /// reason for both to go red at once.</summary>
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
