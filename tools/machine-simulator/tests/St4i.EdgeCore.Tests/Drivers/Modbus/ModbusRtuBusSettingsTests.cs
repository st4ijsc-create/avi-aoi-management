using St4i.EdgeCore.Drivers.Modbus;
using Xunit;

namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// 🔴 Task D-7a — <b>the schema half of "a <c>connectors.json</c> entry can declare a multidrop RTU bus".</b>
///
/// <para>Two things are being pinned. The first is the COMPATIBILITY RULE, which is the reason the transport is
/// an optional field rather than a sixth <c>DriverKinds</c> value: a Modbus <c>settings</c> document that does
/// not mention a transport must take byte-for-byte the path it took before this task. The second is that every
/// refusal names what is wrong AND what to do instead.</para>
///
/// <para>🔴 <b>Task D-7c — this type is now the GATEWAY half of a two-transport schema, and several of the
/// assertions below changed direction because of it.</b> The serial half lives in
/// <see cref="ModbusRtuSerialBusSettingsTests"/>, against <c>ModbusRtuSerialBusSettings</c> in
/// <c>St4i.EdgeCore.Serial</c> — the two parsers cannot be one, because that assembly references this one and
/// an arm here would be a circular reference. What this file keeps is everything about the gateway document
/// plus the two members that belong to the SCHEMA rather than to either transport:
/// <c>DeclaresATransport</c> (is this an RTU bus at all) and <c>ReadTransport</c> (which one).</para>
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

        // Including the OTHER transport, which this parser does not read. Routing ("is this an RTU bus?") and
        // parser selection ("which one?") are different questions, and this predicate answers only the first —
        // which is what lets one `if` in the composition root route both transports without either settings
        // type knowing the other exists.
        Assert.True(ModbusRtuBusSettings.DeclaresATransport("""{"transport":"rtu-serial","portName":"COM3"}"""));
    }

    /// <summary>
    /// 🔴 <b>Task D-7c — this refusal changed meaning completely, and the OLD wording is what the test now
    /// guards against.</b>
    ///
    /// <para>D-7a refused <c>rtu-serial</c> with "not available in this build … put the RS-485 segment behind a
    /// serial device server", because no host referenced <c>St4i.EdgeCore.Serial</c>. All three hosts do now
    /// (the owner's ruling of 2026-08-03) and a directly-attached line ships — so that sentence became a false
    /// claim on a source record AND, worse, an actionable one: an operator who believed it would buy and cable
    /// a gateway they do not need.</para>
    ///
    /// <para>What this parser refuses now is the WRONG PARSER, not a missing feature — an <c>rtu-serial</c>
    /// document is read by <c>ModbusRtuSerialBusSettings</c> in <c>St4i.EdgeCore.Serial</c>, which this
    /// assembly cannot reference (the project reference runs the other way, which is what keeps
    /// <c>System.IO.Ports</c> out of the RTU framing layer). The three negative assertions are the load-bearing
    /// half: they pin the two readings an operator would ACT on and get wrong.</para>
    /// </summary>
    [Fact]
    public void TheSerialTransport_IsNoLongerRefusedAsUnavailable_ButAsTheWrongParser()
    {
        var error = Assert.Throws<InvalidOperationException>(
            () => ModbusRtuBusSettings.Parse("""{"transport":"rtu-serial","portName":"COM3","baudRate":19200}"""));

        Assert.Contains("rtu-serial", error.Message);
        Assert.Contains("ModbusRtuSerialBusSettings", error.Message);
        Assert.Contains("St4i.EdgeCore.Serial", error.Message);

        // 🔴 It must NOT read as "we have never heard of that" — the message an operator acts on by assuming a
        // typo…
        Assert.DoesNotContain("unknown transport", error.Message, StringComparison.OrdinalIgnoreCase);
        // …nor as "this build cannot do that" — the message an operator acts on by installing a gateway in
        // front of a line that is already wired straight into the machine. That claim was TRUE at D-7a and is
        // false now, which is exactly the kind of sentence that survives a feature landing unless something
        // asserts against it.
        Assert.DoesNotContain("not available in this build", error.Message, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("no code in this process", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void AnUnknownTransport_IsRefusedNamingBothTransportsThisBuildUnderstands()
    {
        var error = Assert.Throws<InvalidOperationException>(
            () => ModbusRtuBusSettings.Parse("""{"transport":"rtu-carrier-pigeon"}"""));

        Assert.Contains("rtu-carrier-pigeon", error.Message);
        Assert.Contains(ModbusRtuBusSettings.GatewayTransport, error.Message);

        // 🔴 Task D-7c — and it names the serial transport too. D-7a's version said 'rtu-serial' "is recognised
        // but unavailable"; an operator reading the unknown-transport message after a typo must now be shown
        // BOTH real options, or the one that ships as of this task is invisible to the person most likely to
        // need it.
        Assert.Contains(ModbusRtuBusSettings.SerialTransport, error.Message);
        Assert.DoesNotContain("unavailable", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// 🔴 Task D-7c — <b>the serial transport's own field, refused on a gateway bus rather than silently
    /// ignored.</b> Same class of defect as <c>ModbusMultidropMap</c>'s "a device-level key at the bus root":
    /// the key reads as though it configures this bus and does nothing, so the file on disk and the
    /// configuration actually running are two different things.
    ///
    /// <para>Swept in BOTH directions in one commit — the mirror is
    /// <c>ModbusRtuSerialBusSettingsTests.AGatewaysOwnFields_AreRefusedOnASerialBus_RatherThanIgnored</c>.
    /// Fixing one direction of a symmetric rule is the "fixed an instance rather than the class" failure
    /// blueprint §8.1 records, twice.</para>
    /// </summary>
    [Fact]
    public void TheSerialTransportsOwnField_IsRefusedOnAGatewayBus_RatherThanIgnored()
    {
        var error = Assert.Throws<InvalidOperationException>(() => ModbusRtuBusSettings.Parse(
            """{"transport":"rtu-gateway","host":"gw.example","port":4001,"portName":"COM3"}"""));

        Assert.Contains("'portName'", error.Message, StringComparison.Ordinal);
        Assert.Contains(ModbusRtuBusSettings.SerialTransport, error.Message, StringComparison.Ordinal);
    }

    /// <summary>🔴 Task D-7c — the routing peek the composition root switches on to choose between the two
    /// parsers. It answers with the operator's OWN SPELLING, never a normalised token, because the
    /// unknown-transport message has to be able to quote what they wrote; and it never throws, because it is
    /// asked BEFORE validation and a document too malformed to answer it must fall down the path that already
    /// knows how to report a malformed document.</summary>
    [Theory]
    [InlineData("""{"transport":"rtu-serial","portName":"COM3"}""", "rtu-serial")]
    [InlineData("""{"transport":"  RTU-Serial  ","portName":"COM3"}""", "RTU-Serial")]
    [InlineData("""{"transport":"rtu-gateway","host":"h","port":1}""", "rtu-gateway")]
    [InlineData("""{"machineCode":"M1","registers":[]}""", null)]
    [InlineData("""{"transport":"   "}""", null)]
    [InlineData("""{"transport":7}""", null)]
    [InlineData("""{"transport":null}""", null)]
    [InlineData("[1,2,3]", null)]
    [InlineData("{ not json at all", null)]
    [InlineData("", null)]
    [InlineData(null, null)]
    public void ReadTransport_AnswersWithTheOperatorsOwnSpelling_AndNeverThrows(string? json, string? expected)
        => Assert.Equal(expected, ModbusRtuBusSettings.ReadTransport(json));

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
