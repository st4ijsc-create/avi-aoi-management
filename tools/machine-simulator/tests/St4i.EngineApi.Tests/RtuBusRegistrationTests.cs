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

    /// <summary>The namespace rule <see cref="RtuBusConfiguration.TryFindBlockedDevice"/> exempts and
    /// <see cref="RtuBusConfiguration.ReleaseOwnNamespace"/> removes, stated as a table so the two callers
    /// cannot drift apart silently. The two FALSE rows are the load-bearing ones — a rule that answered
    /// <see langword="true"/> for either would let one bus delete a neighbour's registration.</summary>
    [Theory]
    [InlineData("line1", "line1", true)]
    [InlineData("line1", "line1:unit1", true)]
    [InlineData("line1", "line1:unit247", true)]
    [InlineData("line1", "line1-spare", false)]
    [InlineData("line1", "line10:unit1", false)]
    [InlineData("line1", "line1:unitA", false)]
    [InlineData("line1", "Modbus", false)]
    public void TheBusNamespaceRule_CoversItsOwnDerivedIdsAndNothingElse(string bus, string candidate, bool expected)
        => Assert.Equal(expected, RtuBusConfiguration.IsInBusNamespace(bus, candidate));

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
