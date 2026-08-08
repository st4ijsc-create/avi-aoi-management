using Microsoft.Extensions.Logging.Abstractions;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Drivers.Modbus;
using St4i.EdgeCore.Models;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// 🔴 <b>Fix round 1 (D-7b review I-2) — <see cref="RtuBusConfiguration"/> at its own seam, which is where the
/// rollback is now provable and the endpoint no longer is.</b>
///
/// <para>I-2's fix (release this bus's own namespace before the register pass) turned re-addressing two
/// devices on a line from a permanent dead end into an ordinary save. It also removed the ONE deterministic
/// path that reached the endpoint's rollback — the swap — so what is left there really is a concurrent
/// registration, exactly as D-1's review proved for the single-connector case. That is a coverage cost of a
/// correctness fix and it is not waved away: both halves of the undo are driven here instead, directly, with
/// an OUTSIDE claim that no pre-check has any reason to have caught.</para>
/// </summary>
public sealed class RtuBusRegistrationTests
{
    private static string Device(string machineCode, int unitId) => $$"""
        {
          "machineCode": "{{machineCode}}", "unitId": {{unitId}}, "pollIntervalMs": 1000, "readTimeoutMs": 250,
          "registers": [
            { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "temperature", "unit": "C" }
          ]
        }
        """;

    private static string SerialBus(params string[] devices) => $$"""
        { "transport": "rtu-serial", "portName": "COM8", "baudRate": 19200,
          "devices": [ {{string.Join(",", devices)}} ] }
        """;

    private static RtuBusConfiguration.ResolvedBus Resolve(string busId, string json)
    {
        Assert.True(RtuBusConfiguration.TryResolve(busId, json, logWarning: null, out var bus, out var error), error);
        return bus!;
    }

    /// <summary>
    /// 🔴 <b>The registry undo: one success ahead of the refusal, and it is taken back.</b> An outside
    /// connector (not on this bus, not in its namespace) holds the machine the SECOND device claims — the
    /// shape a concurrent <c>POST</c> produces, staged here without concurrency. Device 1 registers, device 2
    /// is refused, and device 1's registration must not survive: a live connector created by an operation the
    /// operator was told had failed is exactly the "persisted/registered but reported as refused" asymmetry
    /// this whole endpoint exists to prevent.
    /// </summary>
    [Fact]
    public async Task ARefusalAfterOneSuccess_UnregistersTheSuccess_LeavingNoPartOfTheBusLive()
    {
        var registry = new ConnectorRegistry();
        Assert.True(registry.Register(
            new OutsiderFactory(), "outsider", instanceId: "some-other-connector", machineCode: "RTU-B"));

        var bus = Resolve("line1", SerialBus(Device("RTU-A", 1), Device("RTU-B", 2)));
        await using var busRegistry = new ModbusBusRegistry();

        var outcome = RtuBusConfiguration.TryRegisterAll(bus, busRegistry, registry, NullLogger.Instance);

        Assert.False(outcome.Succeeded);
        Assert.Contains("unit 2", outcome.Refusal!, StringComparison.Ordinal);
        Assert.Contains("some-other-connector", outcome.Refusal!, StringComparison.Ordinal);
        // 🔴 Fix round 1, I-2 — the message no longer asserts a cause it cannot know. It says the claimant is
        // not part of this bus and took the claim after the request was checked, which is true of every way
        // this branch is now reachable.
        Assert.DoesNotContain("while this request was in flight", outcome.Refusal!, StringComparison.Ordinal);

        // The discriminating assertion: unit 1 registered and was taken back.
        Assert.Equal(new[] { "some-other-connector" }, registry.RegisteredIds);
        Assert.False(registry.TryGetInstanceIdForMachine("RTU-A", out _));
    }

    /// <summary>🔴 I-1's input, at its source: <see cref="RtuBusConfiguration.BusRegistrationOutcome.IncumbentsReleased"/>
    /// is a COUNT of what was actually released, not an inference from "this bus had rows". A first save
    /// releases nothing, and the endpoint's 409 must not then tell an operator their registry was
    /// disturbed.</summary>
    [Fact]
    public async Task AFirstSaveOfABus_ReleasesNothing_AndSaysSo()
    {
        var registry = new ConnectorRegistry();
        var bus = Resolve("line1", SerialBus(Device("RTU-A", 1), Device("RTU-B", 2)));
        await using var busRegistry = new ModbusBusRegistry();

        var outcome = RtuBusConfiguration.TryRegisterAll(bus, busRegistry, registry, NullLogger.Instance);

        Assert.True(outcome.Succeeded);
        Assert.Equal(2, outcome.Registered);
        Assert.Equal(0, outcome.IncumbentsReleased);
    }

    /// <summary>A re-save releases exactly the bus's own live entries and no others — the count the 409's
    /// wording branches on, and the guarantee that makes releasing safe at all.</summary>
    [Fact]
    public async Task AReSave_ReleasesExactlyThisBussOwnEntries_AndLeavesEveryOtherConnectorAlone()
    {
        var registry = new ConnectorRegistry();
        Assert.True(registry.Register(new OutsiderFactory(), "cfg", instanceId: "line1-spare", machineCode: "SPARE"));
        Assert.True(registry.Register(new OutsiderFactory(), "cfg", instanceId: "line2:unit1", machineCode: "OTHERBUS"));

        var bus = Resolve("line1", SerialBus(Device("RTU-A", 1), Device("RTU-B", 2)));
        await using var busRegistry = new ModbusBusRegistry();

        Assert.True(RtuBusConfiguration.TryRegisterAll(bus, busRegistry, registry, NullLogger.Instance).Succeeded);

        var again = RtuBusConfiguration.TryRegisterAll(bus, busRegistry, registry, NullLogger.Instance);

        Assert.True(again.Succeeded);
        Assert.Equal(2, again.IncumbentsReleased);

        // 🔴 `line1-spare` merely STARTS WITH the bus's name and `line2:unit1` is another bus's device. Neither
        // is in this bus's namespace, and a release keyed on a bare prefix would have taken the first one.
        Assert.Contains("line1-spare", registry.RegisteredIds);
        Assert.Contains("line2:unit1", registry.RegisteredIds);
        Assert.True(registry.TryGetInstanceIdForMachine("SPARE", out var spare));
        Assert.Equal("line1-spare", spare);
    }

    /// <summary>
    /// 🔴 <b>Task E-5 moved the predicate to <see cref="ModbusMultidropMap.IsInBusNamespace"/></b> — off
    /// <c>RtuBusConfiguration</c> (St4i.EngineApi) and onto the St4i.EdgeCore type that declares the
    /// <c>{bus}:unit{n}</c> format it decodes. (Not "every fact it reasons about": its third dependency,
    /// <c>DriverKinds.Normalize</c>, is <c>St4i.Connector.Abstractions</c>' — the E-5 review's correction, and
    /// this theory is the thing that would go red if the arithmetic ever moved with the prose.) That one
    /// reference was the whole of what made the multidrop fan-out un-moveable, and
    /// therefore the whole of what kept RS-485 out of <c>St4i.EdgeService</c>. This theory is deliberately
    /// left HERE rather than moved with it: the three callers it guards are still two of
    /// <c>RtuBusConfiguration</c>'s and one of the fan-out's, and this file is where the endpoint path that
    /// uses two of them is tested. It is also the E-3 precedent — <c>ConnectorsConfigTests</c> stayed put when
    /// <c>ConnectorsConfig</c> moved down.
    ///
    /// <para>The namespace rule <see cref="RtuBusConfiguration.TryFindBlockedDevice"/> exempts,
    /// <see cref="RtuBusConfiguration.ReleaseOwnNamespace"/> removes and
    /// <c>ModbusMultidropRegistration.SweepGhosts</c> sweeps — stated as a table so those three cannot drift
    /// apart silently. The FALSE rows are the load-bearing ones: a rule answering <see langword="true"/> for
    /// any of them lets one bus delete a neighbour's registration.</para>
    ///
    /// <para>🔴 <b>Fix round 2, review N-2 — the two <c>:unitA:unit3</c> rows are the ones this theory was
    /// missing, and their absence is why it could be named <c>…AndNothingElse</c> while being false.</b>
    /// <c>ValidateBusInstanceId</c> reserves only an all-DIGIT suffix, so <c>line1:unitA</c> is a legal bus
    /// name and <c>line1:unitA:unit3</c> is a legitimate device of it. The previous predicate answered
    /// <see langword="true"/> for bus <c>line1</c>, which would release that device's machine claim while its
    /// driver kept polling. The positive row beneath it is the other half: the id must still belong to the bus
    /// that DID derive it.</para>
    /// </summary>
    [Theory]
    [InlineData("line1", "line1", true)]
    [InlineData("line1", "line1:unit1", true)]
    [InlineData("line1", "line1:unit247", true)]
    [InlineData("line1", "line1-spare", false)]
    [InlineData("line1", "line10:unit1", false)]
    [InlineData("line1", "line1:unitA", false)]
    [InlineData("line1", "Modbus", false)]
    // 🔴 N-2's falsifying row, and its mirror: an id belongs to the LONGEST bus name that can precede its
    // final ":unit", and to no other.
    [InlineData("line1", "line1:unitA:unit3", false)]
    [InlineData("line1:unitA", "line1:unitA:unit3", true)]
    // Same length as the bus name, nothing else in common — proves the position check has not replaced the
    // prefix check.
    [InlineData("abcde", "xyzab:unit3", false)]
    public void TheBusNamespaceRule_CoversItsOwnDerivedIdsAndNothingElse(string bus, string candidate, bool expected)
        => Assert.Equal(expected, ModbusMultidropMap.IsInBusNamespace(bus, candidate));

    /// <summary>
    /// 🔴 <b>Fix round 4 (branch review) — the bus-save refusal names the incumbent and states the
    /// PROBLEM; it no longer guesses the remedy, because the field the remedy depends on is not in this
    /// method's scope.</b>
    ///
    /// <para>"Remove that connector (DELETE …)" was emitted unconditionally, and it is wrong for a
    /// <see cref="ConnectorConfigSource.Seeded"/> incumbent — a <c>connectors.json</c> row is re-created at
    /// every start, so the DELETE frees the machine until the next restart and no longer. This method takes
    /// bindings and a roster and never the store, so it could not have decided that. It hands the incumbent
    /// out instead.</para>
    ///
    /// <para>The ROSTER arm hands out <see langword="null"/> and keeps its advice, and that is a finding
    /// rather than an omission: nothing removes a machine from the roster, so "use a different machine code"
    /// is the only honest advice whatever wrote it. A sentence true without the field beats a fork that
    /// cannot be built.</para>
    /// </summary>
    [Fact]
    public void TheBusSaveRefusal_NamesTheIncumbent_AndLeavesTheRemedyToTheCallerThatCanSeeItsProvenance()
    {
        var registry = new ConnectorRegistry();
        Assert.True(registry.Register(
            new OutsiderFactory(), "cfg", instanceId: "some-other-connector", machineCode: "RTU-B"));

        var bus = Resolve("line1", SerialBus(Device("RTU-A", 1), Device("RTU-B", 2)));

        Assert.True(RtuBusConfiguration.TryFindBlockedDevice(
            bus, registry.SnapshotBindings(), Array.Empty<MachineDescriptor>(), out var reason, out var incumbent));

        Assert.Equal("some-other-connector", incumbent);
        Assert.Contains("unit 2", reason, StringComparison.Ordinal);
        Assert.Contains("NOTHING was saved", reason, StringComparison.Ordinal);
        // 🔴 The remedy is ABSENT here, not merely different: a type that cannot see provenance must not
        // ship a sentence that depends on it.
        Assert.DoesNotContain("DELETE /v1/connectors", reason, StringComparison.Ordinal);
    }

    /// <summary>The roster arm: no incumbent connector exists, so there is nothing whose provenance could
    /// change the advice — and the advice says so, naming the reason nothing can be removed.</summary>
    [Fact]
    public void TheRosterArm_HandsOutNoIncumbent_AndItsAdviceNeedsNoProvenance()
    {
        var bus = Resolve("line1", SerialBus(Device("ROSTER-HIT", 1)));
        var roster = new[] { RtuBusConfiguration.DescriptorFor(bus.Devices[0]) };

        Assert.True(RtuBusConfiguration.TryFindBlockedDevice(
            bus, Array.Empty<ConnectorRegistry.ConnectorBinding>(), roster, out var reason, out var incumbent));

        Assert.Null(incumbent);
        Assert.Contains("nothing can remove a machine from the roster", reason, StringComparison.Ordinal);
        Assert.Contains("different machine code", reason, StringComparison.Ordinal);
        Assert.DoesNotContain("DELETE /v1/connectors", reason, StringComparison.Ordinal);
    }

    /// <summary>🔴 Fix round 2, N-2/N-3 — the over-breadth reaching its CONSEQUENCE on the production path,
    /// not just the predicate. Bus <c>line1:unitA</c> is registered; saving bus <c>line1</c> must not release
    /// it. Before this fix the release took it, so a device on a different line lost its machine claim while
    /// its driver kept polling and its store row stayed — with nothing said until a restart.</summary>
    [Fact]
    public async Task SavingOneBus_NeverReleasesADeviceOfADifferentBusWhoseNameSharesItsPrefix()
    {
        var registry = new ConnectorRegistry();
        Assert.True(registry.Register(
            new OutsiderFactory(), "cfg", instanceId: "line1:unitA:unit3", machineCode: "NEIGHBOUR"));

        var bus = Resolve("line1", SerialBus(Device("RTU-A", 1)));
        await using var busRegistry = new ModbusBusRegistry();

        var outcome = RtuBusConfiguration.TryRegisterAll(bus, busRegistry, registry, NullLogger.Instance);

        Assert.True(outcome.Succeeded);
        Assert.Equal(0, outcome.IncumbentsReleased);
        Assert.Contains("line1:unitA:unit3", registry.RegisteredIds);
        Assert.True(registry.TryGetInstanceIdForMachine("NEIGHBOUR", out var neighbour));
        Assert.Equal("line1:unitA:unit3", neighbour);
    }

    /// <summary>A factory that never builds a driver — enough to hold a registry claim. Its
    /// <c>[NotNullWhen]</c> attributes match <see cref="IConnectorFactory.TryCreate"/>'s own, because a
    /// mismatch costs two <c>CS8767</c> warnings and the gate's warning count is the one number nobody asserts
    /// on.</summary>
    private sealed class OutsiderFactory : IConnectorFactory
    {
        public string Kind => DriverKinds.Modbus;

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
}
