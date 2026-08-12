using St4i.Connector.Abstractions.Models;
using St4i.EngineApi.Fleet;
using St4i.EngineApi.Tests.Auth;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// 🔴 Task D-7b — <b>the store boundary, which is where D-7a's projection decision actually lives and where
/// D-7c said it had to be asserted.</b>
///
/// <para>D-7a decided a serial port path goes in <c>host</c>/<c>SummaryColumns</c> and explicitly NOT in
/// <c>map_json</c>. D-7c pinned the structural half — a port name can never reach <c>map_json</c>, because
/// the fan-out hands each device its own array element verbatim — and recorded that the <c>host</c> half had
/// no code path at all. These tests are the <c>host</c> half, asserted <b>at the store</b> rather than at the
/// endpoint, because the <c>SummaryColumns</c>/<c>FullColumns</c> split is the thing that keeps a secret out
/// structurally, and an endpoint test cannot see it.</para>
/// </summary>
// 🔴 Task L-1 — joins this collection for the PROCESS-WIDE SQLITE CONNECTION POOL, not for env vars.
//    SqliteConnection.ClearAllPools() is process-global; membership rule and the full list are in
//    tests/St4i.EngineApi.Tests/Auth/SecurityEnvVarTests.cs.
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class ConnectorConfigStoreBusProjectionTests
{
    private static string TempDir() => Directory.CreateTempSubdirectory("st4i-connector-bus-store-").FullName;

    private static ConnectorBusDeviceRow Row(
        string instanceId, string machineCode, string? host, int? port, string busSettingsJson) =>
        new(instanceId, DriverKinds.Modbus, machineCode, host, port, $$"""{"machineCode":"{{machineCode}}"}""",
            busSettingsJson, WriteCapability: null);

    private const string SerialBusSettings =
        """{"transport":"rtu-serial","portName":"COM7","baudRate":19200,"parity":"even"}""";

    /// <summary>🔴 The projection itself: the LINE goes in <c>host</c>, and a serial line's <c>port</c> is
    /// <see langword="null"/> — never 0, which every existing client would render as <c>COM7:0</c>, a string
    /// that reads as an address that could be dialled.</summary>
    [Fact]
    public async Task ASerialBusDeviceRow_CarriesThePortNameInHostAndNullInPort_ThroughBothProjections()
    {
        var store = new ConnectorConfigStore(TempDir());

        await store.SaveBusAsync(
            "line1",
            new[]
            {
                Row("line1:unit1", "M1", "COM7", null, SerialBusSettings),
                Row("line1:unit2", "M2", "COM7", null, SerialBusSettings),
            },
            ConnectorConfigSource.Operator);

        // The credential-free projection — what GET /v1/connectors/configured returns.
        var summaries = await store.ListAsync();
        Assert.Equal(2, summaries.Count);
        Assert.All(summaries, s =>
        {
            Assert.Equal("COM7", s.Host);
            Assert.Null(s.Port);
            Assert.Equal("line1", s.BusInstanceId);
        });

        // The full projection — what the startup wiring reads.
        var full = await store.ListBusAsync("line1");
        Assert.Equal(2, full.Count);
        Assert.All(full, r =>
        {
            Assert.Equal("COM7", r.Host);
            Assert.Null(r.Port);
            Assert.Equal(SerialBusSettings, r.BusSettingsJson);
        });
    }

    /// <summary>
    /// 🔴 <b>The structural exclusion, asserted as an exclusion rather than as a redaction.</b>
    /// <c>bus_settings_json</c> is the transport blob — today it carries a COM port and line parameters, and
    /// a future transport (a gateway behind an authenticated tunnel) could carry a credential. It is kept out
    /// of the summary the same way <c>map_json</c> is: by never being in that SELECT list at all.
    ///
    /// <para>The discriminating part is the SECOND assertion. Asserting only that
    /// <see cref="ConnectorConfigSummary"/> has no such property is a statement about a C# type; putting a
    /// recognisable secret in the column and then proving it is absent from every field of every returned
    /// summary is a statement about the SQL.</para>
    /// </summary>
    [Fact]
    public async Task TheCredentialFreeProjection_NeverCarriesTheBusSettingsBlob()
    {
        const string busSentinel = "BUS-S3CRET-TUNNEL-TOKEN";
        const string mapSentinel = "MAP-S3CRET-DEVICE-PASSWORD";
        var store = new ConnectorConfigStore(TempDir());

        await store.SaveBusAsync(
            "line1",
            new[]
            {
                new ConnectorBusDeviceRow(
                    "line1:unit1", DriverKinds.Modbus, "M1", "COM7", null,
                    MapJson: $$"""{"machineCode":"M1","note":"{{mapSentinel}}"}""",
                    BusSettingsJson: $$"""{"transport":"rtu-serial","portName":"COM7","x":"{{busSentinel}}"}""",
                    WriteCapability: null),
            },
            ConnectorConfigSource.Operator);

        var summary = Assert.Single(await store.ListAsync());
        var rendered = System.Text.Json.JsonSerializer.Serialize(summary);
        Assert.DoesNotContain(busSentinel, rendered, StringComparison.Ordinal);
        // …and the same for map_json, which has had this discipline since SM-5 — restated here because both
        // columns are now excluded by the same one line, so a change to it breaks both at once.
        Assert.DoesNotContain(mapSentinel, rendered, StringComparison.Ordinal);

        // Both DO come back on the full row — otherwise the startup wiring could not rebuild the bus, and an
        // exclusion that also broke the engine would be indistinguishable from one that worked.
        var full = Assert.Single(await store.ListBusAsync("line1"));
        Assert.Contains(busSentinel, full.BusSettingsJson!, StringComparison.Ordinal);
        Assert.Contains(mapSentinel, full.MapJson, StringComparison.Ordinal);
    }

    /// <summary>🔴 One transaction, both directions: a bus save that REPLACES a bus must lose the rows the
    /// new set does not declare, and the restore must put the exact previous set back including
    /// <c>created_at</c>. A restore that bumped creation time would make every rolled-back bus look as though
    /// the failed request had created it.</summary>
    [Fact]
    public async Task SavingABusReplacesItsWholeRowSet_AndRestoringItPutsTheExactPreviousSetBack()
    {
        var store = new ConnectorConfigStore(TempDir());

        await store.SaveBusAsync(
            "line1",
            new[]
            {
                Row("line1:unit1", "M1", "COM7", null, SerialBusSettings),
                Row("line1:unit2", "M2", "COM7", null, SerialBusSettings),
                Row("line1:unit3", "M3", "COM7", null, SerialBusSettings),
            },
            ConnectorConfigSource.Operator);

        var before = await store.ListBusAsync("line1");
        Assert.Equal(3, before.Count);

        // A save declaring only two devices: the third's row must go, not linger as a row describing a
        // device the operator deleted.
        await store.SaveBusAsync(
            "line1",
            new[]
            {
                Row("line1:unit1", "M1", "COM7", null, SerialBusSettings),
                Row("line1:unit9", "M9", "COM7", null, SerialBusSettings),
            },
            ConnectorConfigSource.Operator);

        Assert.Equal(
            new[] { "line1:unit1", "line1:unit9" },
            (await store.ListBusAsync("line1")).Select(r => r.EffectiveInstanceId).ToArray());

        await store.RestoreBusAsync("line1", before);

        var restored = await store.ListBusAsync("line1");
        Assert.Equal(
            before.Select(r => r.EffectiveInstanceId).ToArray(),
            restored.Select(r => r.EffectiveInstanceId).ToArray());
        // 🔴 created_at survives the delete+reinsert. Without the explicit @created_at parameter this is the
        // assertion that fails, and it fails in the direction that rewrites history.
        Assert.Equal(
            before.Select(r => r.CreatedAtUtc).ToArray(),
            restored.Select(r => r.CreatedAtUtc).ToArray());
        // The device introduced by the failed save is gone.
        Assert.DoesNotContain(restored, r => r.EffectiveInstanceId == "line1:unit9");
    }

    /// <summary>Restoring a bus that did not exist before is a pure delete — the "this request CREATED it"
    /// arm, and the one an operator hits most, because most failed saves are first saves.</summary>
    [Fact]
    public async Task RestoringABusThatHadNoRowsBefore_RemovesEveryRowTheRequestWrote()
    {
        var store = new ConnectorConfigStore(TempDir());

        await store.SaveBusAsync(
            "line1",
            new[] { Row("line1:unit1", "M1", "COM7", null, SerialBusSettings), Row("line1:unit2", "M2", "COM7", null, SerialBusSettings) },
            ConnectorConfigSource.Operator);

        await store.RestoreBusAsync("line1", Array.Empty<ConnectorConfigRecord>());

        Assert.Empty(await store.ListBusAsync("line1"));
        Assert.Empty(await store.ListAsync());
    }

    /// <summary>A bus save must not touch a connector that is not on that bus. Keying the delete on
    /// <c>bus_instance_id</c> rather than on an id PREFIX is what guarantees it: a standalone connector whose
    /// id merely starts with the bus's name is a different row, and a prefix delete would take it.</summary>
    [Fact]
    public async Task SavingABus_LeavesEveryConnectorThatIsNotOnThatBusAlone()
    {
        var store = new ConnectorConfigStore(TempDir());

        await store.SaveAsync("Modbus", "TCP-1", "10.0.0.1", 502, """{"machineCode":"TCP-1"}""", instanceId: "line1-spare");
        await store.SaveAsync("Modbus", "TCP-2", "10.0.0.2", 502, """{"machineCode":"TCP-2"}""");

        await store.SaveBusAsync(
            "line1", new[] { Row("line1:unit1", "M1", "COM7", null, SerialBusSettings) }, ConnectorConfigSource.Operator);
        await store.RestoreBusAsync("line1", Array.Empty<ConnectorConfigRecord>());

        Assert.Equal(
            new[] { "Modbus", "line1-spare" },
            (await store.ListAsync()).Select(r => r.EffectiveInstanceId).OrderBy(x => x, StringComparer.Ordinal).ToArray());
    }

    /// <summary>Migration v5's own required question: what a row written before this rung means. NULL in both
    /// new columns — which is not a placeholder but the correct value, because no schema before D-7b could
    /// express a shared line at all.</summary>
    [Fact]
    public async Task AConnectorSavedWithoutABus_ReadsBackWithNoBusAtAll()
    {
        var store = new ConnectorConfigStore(TempDir());
        await store.SaveAsync("Modbus", "PLAIN", "10.0.0.1", 502, """{"machineCode":"PLAIN"}""");

        var summary = Assert.Single(await store.ListAsync());
        Assert.Null(summary.BusInstanceId);

        var record = await store.GetAsync("Modbus");
        Assert.NotNull(record);
        Assert.Null(record!.BusInstanceId);
        Assert.Null(record.BusSettingsJson);
    }
}
