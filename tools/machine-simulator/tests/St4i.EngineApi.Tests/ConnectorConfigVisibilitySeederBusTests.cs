using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// 🔴 Task D-7b — <b>the second endpoint gap D-7a deferred: <c>GET /v1/connectors/configured</c> now seeds an
/// RTU bus.</b>
///
/// <para>D-7a skipped every RTU <c>connectors.json</c> entry in the visibility-seeding pass, explicitly and
/// with the reason written at the skip: the seeder wrote ONE row from ONE single-device map, and a bus
/// document handed to it would throw on every startup and warn about a <c>machineCode</c> the operator never
/// omitted. Its consequence was an RS-485 line visible in the startup log and in
/// <c>GET /v1/connectors</c> but absent from the one screen this product has for "what is configured here".
/// These tests are that placeholder removed.</para>
/// </summary>
public sealed class ConnectorConfigVisibilitySeederBusTests
{
    private static string TempDir() => Directory.CreateTempSubdirectory("st4i-connector-bus-seed-").FullName;

    private static string Device(string machineCode, int unitId) => $$"""
        {
          "machineCode": "{{machineCode}}", "unitId": {{unitId}}, "pollIntervalMs": 1000, "readTimeoutMs": 250,
          "registers": [
            { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "temperature", "unit": "C" }
          ]
        }
        """;

    private static string SerialBus(params string[] devices) => $$"""
        { "transport": "rtu-serial", "portName": "COM5", "baudRate": 19200,
          "devices": [ {{string.Join(",", devices)}} ] }
        """;

    [Fact]
    public async Task ABusOfThreeDevices_SeedsThreeRows_OnePerDevice_TaggedSeeded()
    {
        var store = new ConnectorConfigStore(TempDir());
        var warnings = new List<string>();

        await ConnectorConfigVisibilitySeeder.SeedBusAsync(
            store, "line1", SerialBus(Device("S-A", 1), Device("S-B", 2), Device("S-C", 3)), warnings.Add);

        var rows = await store.ListAsync();
        Assert.Equal(3, rows.Count);
        Assert.Equal(
            new[] { "line1:unit1", "line1:unit2", "line1:unit3" },
            rows.Select(r => r.EffectiveInstanceId).OrderBy(x => x, StringComparer.Ordinal).ToArray());
        Assert.All(rows, r =>
        {
            Assert.Equal(ConnectorConfigSource.Seeded, r.Source);
            Assert.Equal("line1", r.BusInstanceId);
            // The LINE, per row — the projection D-7a decided and D-7c handed over.
            Assert.Equal("COM5", r.Host);
            Assert.Null(r.Port);
        });
        Assert.Empty(warnings);
    }

    /// <summary>Re-seeding on the next boot refreshes the whole set in place — including LOSING a device the
    /// operator removed from <c>connectors.json</c>. An insert-only seeder would leave that device's row
    /// behind forever, which is B-4's own documented staleness gap in its worst form: a row for a device that
    /// is not on the wire at all.</summary>
    [Fact]
    public async Task ReSeedingAfterADeviceWasRemovedFromTheFile_LosesThatDevicesRow()
    {
        var store = new ConnectorConfigStore(TempDir());

        await ConnectorConfigVisibilitySeeder.SeedBusAsync(
            store, "line1", SerialBus(Device("S-A", 1), Device("S-B", 2)), logWarning: null);
        await ConnectorConfigVisibilitySeeder.SeedBusAsync(
            store, "line1", SerialBus(Device("S-A", 1)), logWarning: null);

        var row = Assert.Single(await store.ListAsync());
        Assert.Equal("line1:unit1", row.EffectiveInstanceId);
    }

    /// <summary>🔴 The provenance rule, applied to the WHOLE bus. An operator's own saved rows are never
    /// overwritten in the name of visibility — and the skip is loud, because by construction this call only
    /// happens for a bus this run's <c>connectors.json</c> is actively driving, so an operator row here is
    /// already shadowed and may be describing something other than what is on the wire.</summary>
    [Fact]
    public async Task ABusWithAnyOperatorOwnedRow_IsSkippedWhole_AndWarnsLoudly()
    {
        var store = new ConnectorConfigStore(TempDir());

        // An operator saved this line themselves, at two devices.
        await ConnectorConfigVisibilitySeeder.SeedBusAsync(
            store, "line1", SerialBus(Device("S-A", 1), Device("S-B", 2)), logWarning: null);
        var seeded = await store.ListBusAsync("line1");
        await store.RestoreBusAsync(
            "line1", seeded.Select(r => r with { Source = ConnectorConfigSource.Operator }).ToList());

        var warnings = new List<string>();
        await ConnectorConfigVisibilitySeeder.SeedBusAsync(
            store, "line1", SerialBus(Device("S-A", 1), Device("S-B", 2), Device("S-C", 3)), warnings.Add);

        // 🔴 Skipped WHOLE: two rows, not two-of-three refreshed and a third inserted. Half a seeded bus is
        // worse than none — it shows some devices with nothing saying the others exist.
        var rows = await store.ListAsync();
        Assert.Equal(2, rows.Count);
        Assert.All(rows, r => Assert.Equal(ConnectorConfigSource.Operator, r.Source));

        var warning = Assert.Single(warnings);
        Assert.Contains("line1", warning, StringComparison.Ordinal);
        Assert.Contains("DELETE /v1/connectors/{instanceId}", warning, StringComparison.Ordinal);
    }

    /// <summary>Never throws, and never seeds half a bus. A document whose third device is malformed leaves
    /// the store exactly as it was, with a named warning — the same "a bad config source disables itself for
    /// this run" posture every other startup path in this product takes.</summary>
    [Fact]
    public async Task ABusWithAMalformedDevice_SeedsNothing_AndWarnsWithoutThrowing()
    {
        var store = new ConnectorConfigStore(TempDir());
        var warnings = new List<string>();

        await ConnectorConfigVisibilitySeeder.SeedBusAsync(
            store, "line1",
            SerialBus(Device("S-A", 1), Device("S-B", 2), """{ "machineCode": "S-BAD", "unitId": 3, "registers": [] }"""),
            warnings.Add);

        Assert.Empty(await store.ListAsync());
        Assert.Contains("devices[2]", Assert.Single(warnings), StringComparison.Ordinal);
    }

    /// <summary>A bus whose document will not even name a transport correctly is refused the same way, and
    /// the seeding pass survives it. This is the arm D-7a's skip existed to avoid crashing into.</summary>
    [Fact]
    public async Task ABusWhoseTransportSettingsAreUnreadable_SeedsNothing_AndWarnsWithoutThrowing()
    {
        var store = new ConnectorConfigStore(TempDir());
        var warnings = new List<string>();

        await ConnectorConfigVisibilitySeeder.SeedBusAsync(
            store, "line1",
            """{ "transport": "rtu-serial", "devices": [ { "machineCode": "S-A", "unitId": 1, "registers": [] } ] }""",
            warnings.Add);

        Assert.Empty(await store.ListAsync());
        Assert.Contains("portName", Assert.Single(warnings), StringComparison.Ordinal);
    }
}
