using System.Text.Json;
using System.Text.Json.Serialization;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests.Fleet;

/// <summary>
/// GP-3 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-3-brief.md) — the
/// "descriptor → DTO → JSON" leg of the brief's required round trip (`fleet.json → descriptor → DTO →
/// JSON`; the `fleet.json → descriptor` leg is already covered by <c>FleetConfigTests</c>). Exercises
/// <see cref="MachineState.ToTile()"/>/<see cref="MachineState.ToDetail()"/> — the exact same
/// <see cref="FleetTileDto"/>/<see cref="MachineDetailDto"/> conversions <c>GET /v1/fleet</c>/
/// <c>GET /v1/machines/{code}</c> serve — through a <see cref="JsonSerializerOptions"/> deliberately
/// built to match <c>Program.cs</c>'s real <c>ConfigureHttpJsonOptions</c> registration
/// (<see cref="JsonSerializerDefaults.Web"/> + a plain <see cref="JsonStringEnumConverter"/>, no naming
/// policy) — the ASP.NET pipeline's actual wire shape, not a hand-rolled approximation of it.
///
/// The point: <c>DriverKind</c> is a plain <see langword="string"/> now (GP-3 opened it from a closed
/// enum), so the SAME global <see cref="JsonStringEnumConverter"/> registration that still PascalCases
/// this API's real enums (<c>DeviceClass</c>, <c>TransportMode</c>, ...) must have ZERO effect on it — a
/// built-in id keeps its exact historical spelling, and a third-party id survives completely unmangled,
/// camelCase property name and all.
/// </summary>
public sealed class DriverKindWireRoundTripTests
{
    private static readonly JsonSerializerOptions WireOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    private static MachineDescriptor NewDescriptor(string driverKind) => new(
        "M-01", "SN-M01", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening",
        driverKind, "RC-TEST-A", null, CycleSeconds: 1.0);

    [Theory]
    [InlineData("Simulated")]
    [InlineData("HotFolderAoi")]
    [InlineData("Mqtt")]
    [InlineData("Modbus")]
    [InlineData("OpcUa")]
    public void FleetTileDto_BuiltInDriverKind_SerializesToExactHistoricalWireSpelling(string builtIn)
    {
        var state = new MachineState(NewDescriptor(builtIn));

        var tile = state.ToTile();
        var json = JsonSerializer.Serialize(tile, WireOptions);

        // Literal wire assertion — the compatibility guarantee itself: the JSON property is camelCase
        // ("driverKind", from JsonSerializerDefaults.Web) but the VALUE is the exact untouched PascalCase
        // spelling, unaffected by the global JsonStringEnumConverter (DriverKind is not an enum anymore).
        Assert.Contains($"\"driverKind\":\"{builtIn}\"", json);

        var back = JsonSerializer.Deserialize<FleetTileDto>(json, WireOptions);
        Assert.Equal(builtIn, back!.DriverKind);
    }

    [Fact]
    public void MachineDetailDto_ThirdPartyDriverKind_SurvivesTheFullDescriptorToDtoToJsonRoundTrip()
    {
        // The brief's own example third-party id, carried through descriptor -> DTO -> JSON -> back.
        const string thirdPartyId = "vendor.acme.weld";
        var state = new MachineState(NewDescriptor(thirdPartyId));

        var detail = state.ToDetail();
        Assert.Equal(thirdPartyId, detail.DriverKind); // descriptor -> DTO leg

        var json = JsonSerializer.Serialize(detail, WireOptions);
        Assert.Contains($"\"driverKind\":\"{thirdPartyId}\"", json); // DTO -> JSON leg, byte-for-byte

        var back = JsonSerializer.Deserialize<MachineDetailDto>(json, WireOptions);
        Assert.Equal(thirdPartyId, back!.DriverKind); // JSON -> DTO leg, the full loop closed
    }

    [Fact]
    public void FleetTileDto_ThirdPartyDriverKind_RoundTrips_AndDeviceClassEnumIsUnaffected()
    {
        // Proves the two DIFFERENT DriverKind/DeviceClass wire behaviors coexist correctly on the same
        // DTO: DeviceClass is still a real enum (PascalCased by the global converter), DriverKind is a
        // plain string (untouched) — neither leaks into the other's serialization.
        var state = new MachineState(NewDescriptor("vendor.acme.weld"));

        var json = JsonSerializer.Serialize(state.ToTile(), WireOptions);

        Assert.Contains("\"deviceClass\":\"Automation\"", json);
        Assert.Contains("\"driverKind\":\"vendor.acme.weld\"", json);
    }
}
