using System.IO.Ports;
using System.Text.Json;
using St4i.EdgeCore.Drivers.Modbus;
using Xunit;

namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// 🔴 Task D-7c — <b>the schema half of "a <c>connectors.json</c> entry can declare a DIRECTLY-ATTACHED
/// RS-485 bus".</b> The serial twin of <see cref="ModbusRtuBusSettingsTests"/>.
///
/// <para>Three things are being pinned, and only the first is obvious. (1) Every line parameter is read and
/// every one of them reaches the BUS KEY, because the key is what decides whether two connectors share a port
/// or fight over it. (2) The defaults are MODBUS's and not <see cref="SerialPort"/>'s — a distinction with no
/// symptom until a spec-conforming device silently never answers. (3) The split between what is refused at
/// PARSE time and what is a START-UP issue, which is the question the brief asks and which is decided here
/// rather than in a report.</para>
/// </summary>
public sealed class ModbusRtuSerialBusSettingsTests
{
    private const string OneDevice =
        """
        {"machineCode":"M1","unitId":1,"pollIntervalMs":1000,"readTimeoutMs":300,
         "registers":[{"address":0,"type":"Holding","dataType":"UInt16","scale":1.0,"metric":"t","unit":"C"}]}
        """;

    private static string SerialBus(string busFields) =>
        $$"""
        {
          "transport": "rtu-serial",{{busFields}}
          "devices": [ {{OneDevice}} ]
        }
        """;

    /// <summary>
    /// 🔴 <b>THE load-bearing assertion of this file: the LITERAL bus key produced by a document that names
    /// nothing but its port.</b>
    ///
    /// <para>It is written as a literal on purpose. Asserting
    /// <c>settings.BusKey == SerialPortBusLink.CreateBusKey(new SerialLineSettings("COM7"))</c> would pass for
    /// a parser that read no defaults at all, because both sides would be built from the same
    /// <see cref="SerialLineSettings"/> constructor defaults — the "a test that supplies the value it is
    /// checking is blind to who chose it" shape blueprint §8.1 names. The literal is the value that reached
    /// the boundary, and it fails for every interesting wrong answer at once: <see cref="SerialPort"/>'s own
    /// 9600-8-N-1 defaults, a dropped parity, a dropped baud rate, and a port name left un-normalised.</para>
    /// </summary>
    [Fact]
    public void ADocumentNamingOnlyItsPort_TakesTheModbusSpecificationsDefaults_NotSerialPortsOwn()
    {
        var settings = ModbusRtuSerialBusSettings.Parse(SerialBus("""  "portName":" com7 ", """));

        Assert.Equal("modbus-rtu-serial:COM7:19200:8:E:1", settings.BusKey);

        // Spelled out beside the key so a reader does not have to decode it, and so the ONE that has no
        // symptom on the wire — parity — is named rather than folded into a string.
        Assert.Equal("COM7", settings.Line.PortName);
        Assert.Equal(19_200, settings.Line.BaudRate);
        Assert.Equal(Parity.Even, settings.Line.Parity);
        Assert.Equal(8, settings.Line.DataBits);
        Assert.Equal(StopBits.One, settings.Line.StopBits);
        Assert.Equal(ModbusRtuBusSettings.SerialTransport, settings.Transport);

        // 🔴 The discriminator, stated rather than implied: SerialPort's own constructor defaults are a
        // DIFFERENT line, and a parser that inherited them instead of declaring MODBUS's would still produce a
        // perfectly plausible key. This is the one wrong answer that has no symptom until a device stops
        // answering for no visible reason.
        Assert.NotEqual("modbus-rtu-serial:COM7:9600:8:N:1", settings.BusKey);
    }

    /// <summary>Every line parameter is READ, and every one of them reaches the key. Asserted as one literal
    /// per field-set rather than field-by-field, because the key is the thing the bus registry compares and a
    /// field that parses but never reaches it would be invisible to a property-by-property check.</summary>
    [Theory]
    [InlineData(""" "portName":"COM3","baudRate":9600, """, "modbus-rtu-serial:COM3:9600:8:E:1")]
    [InlineData(""" "portName":"COM3","parity":"none","stopBits":2, """, "modbus-rtu-serial:COM3:19200:8:N:2")]
    [InlineData(""" "portName":"COM3","parity":"Odd", """, "modbus-rtu-serial:COM3:19200:8:O:1")]
    [InlineData(""" "portName":"COM3","parity":" MARK ", """, "modbus-rtu-serial:COM3:19200:8:M:1")]
    [InlineData(""" "portName":"COM3","parity":"space", """, "modbus-rtu-serial:COM3:19200:8:S:1")]
    [InlineData(""" "portName":"COM12","baudRate":115200,"parity":"none","dataBits":8,"stopBits":2, """,
        "modbus-rtu-serial:COM12:115200:8:N:2")]
    public void EveryLineParameterIsRead_AndReachesTheBusKey(string busFields, string expectedKey)
        => Assert.Equal(expectedKey, ModbusRtuSerialBusSettings.Parse(SerialBus(busFields)).BusKey);

    /// <summary>
    /// The parse-time refusals, each asserted to NAME THE FIELD the operator got wrong. A refusal that does not
    /// say which key is at fault sends someone to re-read the whole document, which on a bus of eight devices
    /// is the difference between a fix and an afternoon.
    /// </summary>
    [Theory]
    [InlineData("""  """, "portName")]                                   // absent
    [InlineData(""" "portName":"", """, "portName")]                     // blank
    [InlineData(""" "portName":"   ", """, "portName")]
    [InlineData(""" "portName":3, """, "portName")]                      // not a string
    [InlineData(""" "portName":"COM3","baudRate":0, """, "baudRate")]
    [InlineData(""" "portName":"COM3","baudRate":-1, """, "baudRate")]
    [InlineData(""" "portName":"COM3","baudRate":"19200", """, "baudRate")]
    [InlineData(""" "portName":"COM3","dataBits":7, """, "dataBits")]    // ASCII framing, out of scope
    [InlineData(""" "portName":"COM3","dataBits":"8", """, "dataBits")]
    [InlineData(""" "portName":"COM3","parity":"almost", """, "parity")]
    [InlineData(""" "portName":"COM3","parity":2, """, "parity")]        // the enum ordinal, not a token
    [InlineData(""" "portName":"COM3","stopBits":0, """, "stopBits")]
    [InlineData(""" "portName":"COM3","stopBits":3, """, "stopBits")]
    [InlineData(""" "portName":"COM3","stopBits":"1", """, "stopBits")]
    public void AMalformedSerialBus_IsRefusedNamingTheFieldThatIsWrong(string busFields, string expectedField)
    {
        var error = Assert.Throws<InvalidOperationException>(
            () => ModbusRtuSerialBusSettings.Parse(SerialBus(busFields)));

        Assert.Contains(expectedField, error.Message, StringComparison.Ordinal);
    }

    /// <summary>
    /// 🔴 <b>The refusal that is not about a malformed value at all — a key that is perfectly well-formed and
    /// does NOTHING.</b> <c>host</c> and <c>port</c> belong to the gateway transport; on a serial bus they
    /// would be silently ignored, so the file on disk and the configuration actually running would be two
    /// different things while the operator believed they had set the port. That is
    /// <see cref="ModbusMultidropMap"/>'s own "a device-level key at the bus root" defect, one level up, and it
    /// is refused for the same reason.
    ///
    /// <para>Swept in BOTH directions in the same commit, which is the point:
    /// <see cref="TheSerialTransportsOwnField_IsRefusedOnAGatewayBus_RatherThanIgnored"/> is the mirror. Fixing
    /// one direction of a symmetric rule is the "fixed an instance rather than the class" failure blueprint
    /// §8.1 records.</para>
    /// </summary>
    [Theory]
    [InlineData(""" "portName":"COM3","host":"gw.example", """, "host")]
    [InlineData(""" "portName":"COM3","port":4001, """, "port")]
    public void AGatewaysOwnFields_AreRefusedOnASerialBus_RatherThanIgnored(string busFields, string field)
    {
        var error = Assert.Throws<InvalidOperationException>(
            () => ModbusRtuSerialBusSettings.Parse(SerialBus(busFields)));

        Assert.Contains($"'{field}'", error.Message, StringComparison.Ordinal);
        // …and it says what to write instead, which is the half that makes it actionable.
        Assert.Contains("portName", error.Message, StringComparison.Ordinal);

        // 🔴 Fix round 1, MUTATION-FOUND (F6). The two assertions above are BOTH satisfied by the generic
        // unknown-key refusal added in this round — it quotes the offending key and lists 'portName' among the
        // keys this transport understands — so a mutation that ran the unknown-key check FIRST survived them
        // both. That is the "a test cannot tell which of two producing paths answered it" shape, and it makes
        // the ordering comment in Parse unenforced. These two are what discriminate: this refusal must name the
        // transport the key BELONGS to, and must not read as "we do not know that key", because the operator's
        // remedy differs (move the segment behind a gateway vs fix a typo).
        Assert.Contains(ModbusRtuBusSettings.GatewayTransport, error.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("not a key this build reads", error.Message, StringComparison.Ordinal);
    }

    /// <summary>
    /// 🔴 <b>This parser refuses the OTHER transport's document BY NAME, and that is what makes the transport
    /// switch safe to get wrong.</b> The composition root picks a parser from
    /// <see cref="ModbusRtuBusSettings.ReadTransport"/>; if a future edit ever routes a document to the wrong
    /// one, whoever reads the log must be told "wrong parser", not "your document is missing a field" — which
    /// is what a gateway document handed to THIS parser would otherwise produce (no <c>portName</c>), sending
    /// someone to add a COM port to a bus that is behind a device server.
    ///
    /// <para>The mirror direction — a serial document handed to the gateway parser — is
    /// <see cref="ModbusRtuBusSettingsTests.TheSerialTransport_IsNoLongerRefusedAsUnavailable_ButAsTheWrongParser"/>,
    /// beside the type that produces it.</para>
    /// </summary>
    [Fact]
    public void AGatewayDocument_IsRefusedByThisParser_NamingWhereItIsActuallyRead()
    {
        var error = Assert.Throws<InvalidOperationException>(
            () => ModbusRtuSerialBusSettings.Parse("""{"transport":"rtu-gateway","host":"gw","port":4001}"""));

        Assert.Contains("ModbusRtuBusSettings", error.Message, StringComparison.Ordinal);
        Assert.Contains(ModbusRtuBusSettings.GatewayTransport, error.Message, StringComparison.Ordinal);

        // Not "portName is missing", which is the answer a parser that simply fell through would give and the
        // one that sends an operator to fix the wrong thing.
        Assert.DoesNotContain($"requires a non-blank '{ModbusRtuSerialBusSettings.PortNameProperty}'",
            error.Message, StringComparison.Ordinal);
    }

    /// <summary>
    /// 🔴 <b>THE DECISION the brief asks for, as a test rather than a paragraph: a port that is not present on
    /// THIS machine is NOT a parse-time refusal.</b>
    ///
    /// <para>It parses, it produces a bus key, and it produces an opener — and only the OPENER fails, at the
    /// first transaction, with the port named. That split is what lets one <c>connectors.json</c> be written
    /// for a site and reviewed on a laptop, and what lets an unplugged USB RS-485 adapter recover when it is
    /// plugged back in rather than requiring a restart. The three reasons are on
    /// <see cref="ModbusRtuSerialBusSettings"/> itself.</para>
    ///
    /// <para>Both halves are asserted in one test on purpose: "it parses" alone would also be satisfied by a
    /// parser that produced a settings object nothing could ever open, and "the open fails" alone would be
    /// satisfied by a build where the parse had already refused it.</para>
    /// </summary>
    [Fact]
    public async Task APortThatIsAbsentFromThisMachine_ParsesCleanly_AndFailsOnlyWhenItIsOPENED()
    {
        var absent = SerialPortBusLinkTests.AbsentPortNameForTests();

        var settings = ModbusRtuSerialBusSettings.Parse(SerialBus($""" "portName":"{absent}", """));
        Assert.Equal(absent, settings.Line.PortName);
        Assert.Contains(absent, settings.BusKey, StringComparison.Ordinal);

        var ex = await Assert.ThrowsAsync<SerialPortUnavailableException>(
            () => settings.Opener()(CancellationToken.None));

        Assert.Contains(absent, ex.Message, StringComparison.Ordinal);
        Assert.Contains("NOT PRESENT", ex.Message, StringComparison.Ordinal);
    }

    /// <summary>
    /// 🔴 <b>Blueprint §9's hardware limit is carried ON THE SETTINGS TYPE, so the host can put it in front of
    /// the person who just configured a port.</b> A limit that lives only in a plan document is a limit the
    /// operator discovers on a bench.
    /// </summary>
    [Fact]
    public void TheAutomaticDirectionControlLimit_IsCarried_AndNamesTheLineItAppliesTo()
    {
        var settings = ModbusRtuSerialBusSettings.Parse(SerialBus(""" "portName":"COM3","baudRate":9600, """));
        var limit = settings.DescribeLimit();

        // WHICH line, WHAT is unsupported, and WHAT happens instead — the three things that make a limit
        // actionable rather than ominous.
        Assert.Contains("COM3 9600-8-E-1", limit, StringComparison.Ordinal);
        Assert.Contains("AUTOMATIC direction control", limit, StringComparison.Ordinal);
        Assert.Contains("will not transmit at all", limit, StringComparison.Ordinal);
    }

    /// <summary>
    /// 🔴 <b>The serial bus composes with D-7a's multidrop fan-out UNCHANGED — proven structurally, on the one
    /// property that matters, rather than argued.</b>
    ///
    /// <para>The two parsers read the SAME document and DISJOINT keys. So the same document that this file's
    /// parser reads five serial keys out of still fans out into N devices, and — the load-bearing half —
    /// <b>no device's stored configuration carries the port name</b>, because each device's <c>MapJson</c> is
    /// its own array element verbatim. That is what makes D-7a's projection decision survive contact: a COM
    /// port path is machine-identifying and belongs in the <c>host</c> column that <c>SummaryColumns</c>
    /// selects, and it can never leak into <c>map_json</c> — not because something filters it out, but because
    /// the fan-out never puts it there. The <c>SummaryColumns</c>/<c>FullColumns</c> split keeps things out by
    /// never selecting them; this is the same discipline one layer up, keeping a field out of a blob by never
    /// writing it into one.</para>
    /// </summary>
    [Fact]
    public void TheDeviceHalfOfTheDocumentIsUntouched_AndNoDevicesStoredConfigCarriesThePortName()
    {
        const string busJson =
            """
            {"transport":"rtu-serial","portName":"COM31","baudRate":9600,"parity":"none","stopBits":2,
             "devices":[
               {"machineCode":"S1","unitId":1,"pollIntervalMs":1000,"readTimeoutMs":300,
                "registers":[{"address":0,"type":"Holding","dataType":"UInt16","scale":1.0,"metric":"t","unit":"C"}]},
               {"machineCode":"S2","unitId":2,"pollIntervalMs":1000,"readTimeoutMs":300,
                "registers":[{"address":1,"type":"Holding","dataType":"UInt16","scale":1.0,"metric":"t","unit":"C"}]}]}
            """;

        // The bus half reads its five keys…
        Assert.Equal("modbus-rtu-serial:COM31:9600:8:N:2", ModbusRtuSerialBusSettings.Parse(busJson).BusKey);

        // …and the device half, on the SAME document, is unaffected by their presence.
        var devices = ModbusMultidropMap.FanOut(busJson, "rs485-line1");
        Assert.Equal(2, devices.Count);
        Assert.Equal(new[] { "S1", "S2" }, devices.Select(d => d.MachineCode).ToArray());

        foreach (var device in devices)
        {
            Assert.DoesNotContain("COM31", device.MapJson, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("portName", device.MapJson, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("transport", device.MapJson, StringComparison.OrdinalIgnoreCase);

            // A positive control for the three absences above: this device's own document DID survive the
            // fan-out with its own content, so "does not contain" is a fact about the port name rather than
            // about an empty string.
            using var parsed = JsonDocument.Parse(device.MapJson);
            Assert.Equal(device.MachineCode, parsed.RootElement.GetProperty("machineCode").GetString());
        }
    }

    /// <summary>
    /// 🔴 <b>Fix round 1, review I-2 — the THIRD direction of the sweep, and the one the new schema created.</b>
    ///
    /// <para>D-7c swept the cross-TRANSPORT directions (<c>host</c>/<c>port</c> refused on a serial bus,
    /// <c>portName</c> on a gateway bus) and missed the cross-LEVEL one. Measured by the reviewer: a
    /// <c>devices[]</c> element carrying <c>"portName":"COM99"</c> was accepted by every parser, did nothing,
    /// and was copied <b>verbatim into that device's <c>MapJson</c></b> — so the bus ran on <c>COM31</c> while
    /// the device's stored configuration said <c>COM99</c>. It is the most likely operator error of the three,
    /// because <c>portName</c> is the one field the serial schema teaches an operator to write and nothing in
    /// the document says which level owns it. It also falsified this file's own
    /// <see cref="TheDeviceHalfOfTheDocumentIsUntouched_AndNoDevicesStoredConfigCarriesThePortName"/> claim for
    /// anything but a well-formed document.</para>
    ///
    /// <para><b>This [Theory] is also the DRIFT GUARD for a list that cannot be shared.</b>
    /// <c>ModbusMultidropMap.BusLevelKeys</c> must hold string literals, because half of these keys are declared
    /// in <c>St4i.EdgeCore.Serial</c> — which <c>St4i.EdgeCore</c> may never reference. The rows below are the
    /// parsers' own <c>const</c> fields, so RENAMING one breaks this file's compilation and points at the list.
    /// <b>ADDING a bus-level key is not caught automatically</b>; that is stated on <c>BusLevelKeys</c>
    /// itself.</para>
    /// </summary>
    [Theory]
    [InlineData(ModbusRtuBusSettings.TransportProperty)]
    [InlineData(ModbusRtuSerialBusSettings.PortNameProperty)]
    [InlineData(ModbusRtuSerialBusSettings.BaudRateProperty)]
    [InlineData(ModbusRtuSerialBusSettings.ParityProperty)]
    [InlineData(ModbusRtuSerialBusSettings.DataBitsProperty)]
    [InlineData(ModbusRtuSerialBusSettings.StopBitsProperty)]
    [InlineData("host")]
    [InlineData("port")]
    public void EveryBusLevelKeyOfBothTransports_IsRefusedInsideADeviceElement(string busLevelKey)
    {
        var json = $$"""
            {"transport":"rtu-serial","portName":"COM31",
             "devices":[{"machineCode":"S1","unitId":1,"pollIntervalMs":1000,"{{busLevelKey}}":"x",
                         "registers":[{"address":0,"type":"Holding","dataType":"UInt16","scale":1.0,"metric":"t","unit":"C"}]}]}
            """;

        var error = Assert.Throws<InvalidOperationException>(() => ModbusMultidropMap.FanOut(json, "line1"));

        Assert.Contains($"'{busLevelKey}'", error.Message, StringComparison.Ordinal);
        Assert.Contains("devices[0]", error.Message, StringComparison.Ordinal);
        // …and it says WHY, which is the half that stops a reader "fixing" it by moving the key somewhere else
        // it also does nothing.
        Assert.Contains("BUS-level key", error.Message, StringComparison.Ordinal);
    }

    /// <summary>
    /// 🔴 <b>Fix round 1 — the same leak in its PUREST shape, which the review did not name and which the
    /// per-element check above cannot reach.</b>
    ///
    /// <para><see cref="ModbusMultidropMap.FanOut"/> has a degenerate branch for a document with no
    /// <c>devices</c> array: the root IS the device, and the WHOLE document becomes that device's
    /// <c>MapJson</c>. So a single-device serial bus with nothing malformed in it at all —
    /// <c>{"transport":"rtu-serial","portName":"COM3","machineCode":"M1", …}</c> — stored the port path inside
    /// the device's own configuration. Refusing it is what makes the guarantee unconditional rather than "true
    /// for the <c>devices</c> form".</para>
    ///
    /// <para><b>It forecloses nothing that exists.</b> The degenerate branch is the LEGACY single-device map (a
    /// pre-D-4 Modbus TCP document), which carries no bus-level key, and RTU has no legacy at all — nothing in
    /// <c>src/</c> could construct an RTU driver before D-7a. The control below is that half: an ordinary
    /// single-device map still fans out exactly as it did, under its own instance id, so no shipped pipeline
    /// slot label or alarm <c>TargetId</c> moves.</para>
    /// </summary>
    [Fact]
    public void ADegenerateSingleDeviceDocumentDeclaringABusLevelKey_IsRefused_BecauseItsRootIsAlsoItsDevice()
    {
        const string deviceFields =
            """
            "machineCode":"M1","unitId":1,"pollIntervalMs":1000,
            "registers":[{"address":0,"type":"Holding","dataType":"UInt16","scale":1.0,"metric":"t","unit":"C"}]
            """;

        var error = Assert.Throws<InvalidOperationException>(() => ModbusMultidropMap.FanOut(
            $$"""{"transport":"rtu-serial","portName":"COM3",{{deviceFields}}}""", "line1"));

        Assert.Contains("BUS-level key", error.Message, StringComparison.Ordinal);
        Assert.Contains($"'{ModbusMultidropMap.DevicesProperty}'", error.Message, StringComparison.Ordinal);
        Assert.Contains("a bus of one is still a bus", error.Message, StringComparison.Ordinal);

        // 🔴 The control, and it is what makes the refusal a narrowing rather than a break: the SAME degenerate
        // document without a bus-level key still fans out to one device under its own instance id verbatim.
        var legacy = ModbusMultidropMap.FanOut($$"""{{{deviceFields}}}""", "legacy-modbus");
        var only = Assert.Single(legacy);
        Assert.Equal("legacy-modbus", only.InstanceId);
        Assert.Equal("M1", only.MachineCode);
    }

    /// <summary>
    /// 🔴 <b>Fix round 1, review M-2 — a misspelled key of the operator's OWN transport, in the one place with
    /// no symptom.</b>
    ///
    /// <para>Measured: <c>{"transport":"rtu-serial","portName":"COM31","baudrate":9600,"Parity":"none"}</c>
    /// parsed cleanly to <c>modbus-rtu-serial:COM31:19200:8:E:1</c>. <c>TryGetProperty</c> is case-sensitive and
    /// nothing refused the two misspellings, so <b>the operator asked for 9600-8-N-1 and got
    /// 19200-8-E-1</b> — and this type's own doc says what that costs: "a parity mismatch never throws on the
    /// wire: it surfaces as a device that simply never answers", indistinguishable from a wiring fault or a
    /// wrong unit id.</para>
    ///
    /// <para>The near-miss suggestion is asserted, not merely the refusal: the failure being closed is a
    /// misspelling of a key the operator already knows, so "did you mean 'baudRate'?" is the actionable half and
    /// a bare "unrecognised" would leave them re-reading their own document.</para>
    /// </summary>
    [Theory]
    [InlineData(""" "portName":"COM3","baudrate":9600, """, "baudrate", "baudRate")]
    [InlineData(""" "portName":"COM3","Parity":"none", """, "Parity", "parity")]
    [InlineData(""" "portName":"COM3","STOPBITS":2, """, "STOPBITS", "stopBits")]
    [InlineData(""" "portname":"COM3", """, "portname", "portName")]
    public void AMisspelledBusLevelKey_IsRefusedWithTheNearMiss_NotSilentlyIgnored(
        string busFields, string written, string meant)
    {
        var error = Assert.Throws<InvalidOperationException>(
            () => ModbusRtuSerialBusSettings.Parse(SerialBus(busFields)));

        Assert.Contains($"'{written}'", error.Message, StringComparison.Ordinal);
        Assert.Contains($"Did you mean '{meant}'?", error.Message, StringComparison.Ordinal);
        Assert.Contains("SILENTLY IGNORED", error.Message, StringComparison.Ordinal);
    }

    /// <summary>An invented key gets the list of what this transport understands, since there is no near miss to
    /// suggest. Both halves ship because a message that only ever says "did you mean X" has nothing to say when
    /// there is no X.</summary>
    [Fact]
    public void AnInventedBusLevelKey_IsRefusedNamingWhatThisTransportUnderstands()
    {
        var error = Assert.Throws<InvalidOperationException>(
            () => ModbusRtuSerialBusSettings.Parse(SerialBus(""" "portName":"COM3","flowControl":"rts", """)));

        Assert.Contains("'flowControl'", error.Message, StringComparison.Ordinal);
        Assert.Contains($"'{ModbusRtuSerialBusSettings.PortNameProperty}'", error.Message, StringComparison.Ordinal);
        Assert.Contains($"'{ModbusRtuSerialBusSettings.StopBitsProperty}'", error.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("Did you mean", error.Message, StringComparison.Ordinal);
    }
}
