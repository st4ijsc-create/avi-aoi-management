using St4i.EdgeCore.Drivers.Modbus;
using Xunit;

namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// 🔴 Task D-7a — <b>the schema half of "a <c>connectors.json</c> entry can declare a multidrop RTU bus".</b>
///
/// <para>Two things are being pinned. The first is the COMPATIBILITY RULE, which is the reason the transport is
/// an optional field rather than a sixth <c>DriverKinds</c> value: a Modbus <c>settings</c> document that does
/// not mention a transport must take byte-for-byte the path it took before this task. The second is that every
/// refusal names what is wrong AND what to do instead — including the one refusal that is about this build
/// rather than about the operator's document.</para>
/// </summary>
public sealed class ModbusRtuBusSettingsTests
{
    private const string GatewayBus =
        """
        {"transport":"rtu-gateway","host":"192.168.1.50","port":4001,
         "devices":[{"machineCode":"M1","unitId":1,"pollIntervalMs":1000,
                     "registers":[{"address":0,"type":"Holding","dataType":"UInt16","scale":1.0,"metric":"t","unit":"C"}]}]}
        """;

    [Fact]
    public void AGatewayBus_ParsesIntoAHostPortAndABusKeyBuiltByTheLinkType()
    {
        var settings = ModbusRtuBusSettings.Parse(GatewayBus);

        Assert.Equal(ModbusRtuBusSettings.GatewayTransport, settings.Transport);
        Assert.Equal("192.168.1.50", settings.Host);
        Assert.Equal(4001, settings.Port);

        // 🔴 The bus key is the link type's own, never string interpolation here — ModbusBusRegistry's doc
        // comment records what a hand-built key costs (two connectors silently riding one link they were not
        // configured for, which surfaces as a device answering wrongly). Asserted against the SAME builder a
        // production caller would use, so a change to the format cannot make these two disagree.
        Assert.Equal(GatewayTcpBusLink.CreateBusKey("192.168.1.50", 4001), settings.BusKey);
        Assert.NotNull(settings.Opener());
    }

    /// <summary>
    /// 🔴 <b>The compatibility rule, stated as a test rather than as an argument.</b> Every Modbus
    /// <c>settings</c> document that has ever existed is a register map with no <c>transport</c>, and this is
    /// the predicate that routes it: it must answer <see langword="false"/> for all of them, and it must answer
    /// <see langword="false"/> rather than throw for a document too broken to read at all — because a malformed
    /// document has to fall down the path that already knows how to report one, not take a new path that
    /// reports it a second, different way.
    /// </summary>
    [Theory]
    [InlineData("""{"machineCode":"M1","unitId":1,"registers":[]}""")]      // the pre-D-7a shape
    [InlineData("""{"devices":[]}""")]                                       // a bus shape with no transport
    [InlineData("""{"transport":""}""")]                                     // blank
    [InlineData("""{"transport":"   "}""")]                                  // whitespace
    [InlineData("""{"transport":4001}""")]                                   // not a string
    [InlineData("""{"transport":null}""")]
    [InlineData("[1,2,3]")]                                                  // not an object
    [InlineData("{ not json at all")]                                        // not parseable
    [InlineData("")]
    [InlineData(null)]
    public void ADocumentWithoutAUsableTransport_IsNotAnRtuBus_AndNeverThrows(string? settingsJson)
    {
        Assert.False(ModbusRtuBusSettings.DeclaresATransport(settingsJson));
    }

    [Fact]
    public void ADocumentDeclaringATransport_IsAnRtuBus()
    {
        Assert.True(ModbusRtuBusSettings.DeclaresATransport(GatewayBus));

        // Including one whose transport this build cannot open — routing and availability are different
        // questions, and answering them with one predicate is how "unknown transport" gets reported for a
        // transport the product knows perfectly well.
        Assert.True(ModbusRtuBusSettings.DeclaresATransport("""{"transport":"rtu-serial","portName":"COM3"}"""));
    }

    /// <summary>
    /// 🔴 <b>The refusal that is about this BUILD, not about the operator's document — and the one place in
    /// D-7a where an honest "no" replaces a feature.</b> The serial link exists, works and is tested; the
    /// engine is deliberately built without <c>System.IO.Ports</c> so a gateway deployment does not carry it,
    /// and <c>SerialDependencyScopingTests</c> pins that. So the token is recognised and answered with the
    /// truth and with the alternative, which is the opposite of a stub.
    /// </summary>
    [Fact]
    public void TheSerialTransport_IsRefusedWithTheReasonAndTheAlternative_NotAsAnUnknownToken()
    {
        var error = Assert.Throws<InvalidOperationException>(
            () => ModbusRtuBusSettings.Parse("""{"transport":"rtu-serial","portName":"COM3","baudRate":19200}"""));

        // What is wrong, why, and what to do instead — the three things a refusal an operator can act on has
        // to carry. Asserted individually so a rewrite that drops one is red rather than merely different.
        Assert.Contains("rtu-serial", error.Message);
        Assert.Contains("System.IO.Ports", error.Message);
        Assert.Contains("rtu-gateway", error.Message);

        // 🔴 And it must NOT read as "we have never heard of that", which is the message an operator would act
        // on by assuming they had a typo.
        Assert.DoesNotContain("unknown transport", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void AnUnknownTransport_IsRefusedNamingWhatThisBuildUnderstands()
    {
        var error = Assert.Throws<InvalidOperationException>(
            () => ModbusRtuBusSettings.Parse("""{"transport":"rtu-carrier-pigeon"}"""));

        Assert.Contains("rtu-carrier-pigeon", error.Message);
        Assert.Contains(ModbusRtuBusSettings.GatewayTransport, error.Message);
    }

    [Theory]
    [InlineData("""{"transport":"rtu-gateway","port":4001}""", "host")]
    [InlineData("""{"transport":"rtu-gateway","host":"","port":4001}""", "host")]
    [InlineData("""{"transport":"rtu-gateway","host":"h"}""", "port")]
    [InlineData("""{"transport":"rtu-gateway","host":"h","port":0}""", "port")]
    [InlineData("""{"transport":"rtu-gateway","host":"h","port":70000}""", "port")]
    [InlineData("""{"transport":"rtu-gateway","host":"h","port":"4001"}""", "port")]
    public void AGatewayBusMissingItsEndpoint_IsRefusedNamingTheField(string settingsJson, string expectedField)
    {
        var error = Assert.Throws<InvalidOperationException>(() => ModbusRtuBusSettings.Parse(settingsJson));
        Assert.Contains(expectedField, error.Message);
    }

    /// <summary>There is deliberately NO default gateway port. Serial device servers expose one TCP port per
    /// physical line, so a default would be a guess about which RS-485 segment the operator meant — and this
    /// batch's whole subject is that a write reaching the wrong line is the failure that matters.</summary>
    [Fact]
    public void ThePortHasNoDefault_BecauseAGatewayExposesOneLinePerPort()
    {
        var error = Assert.Throws<InvalidOperationException>(
            () => ModbusRtuBusSettings.Parse("""{"transport":"rtu-gateway","host":"192.168.1.50"}"""));

        Assert.Contains("one port per physical line", error.Message);
    }

    [Fact]
    public void TransportMatchingIsCaseInsensitive_AndTrimmed()
    {
        var settings = ModbusRtuBusSettings.Parse("""{"transport":"  RTU-Gateway ","host":" gw.local ","port":4002}""");

        Assert.Equal(ModbusRtuBusSettings.GatewayTransport, settings.Transport);
        Assert.Equal("gw.local", settings.Host);
    }
}
