using System;
using St4i.EdgeCore.Drivers.Modbus;
using Xunit;

namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// 🔴 <b>Task F-1 — ONE HOST PER SEGMENT is stated on BOTH transports, and stated as a CONSTRAINT rather
/// than as a guarantee.</b>
///
/// <para><b>What this is about.</b> Since E-5 both <c>St4i.EngineApi</c> and <c>St4i.EdgeService</c> have a
/// configured path from their own <c>connectors.json</c> to a real RS-485 segment. Nothing in this product
/// arbitrates between them: machine-code claims are a <c>ConcurrentDictionary</c> inside one process and
/// <c>ModbusBusRegistry</c>'s shared-link bookkeeping is per-process too. On a directly attached COM port the
/// OPERATING SYSTEM refuses the second open — real protection, but an accident of how Windows opens a serial
/// port rather than anything this build arranges. On a gateway there is not even that: both hosts connect
/// normally and neither can observe the other.</para>
///
/// <para><b>Why the two transports are asserted TOGETHER in one file.</b> The claim is a PAIR — each
/// transport carries the rule exactly once, in the one place its operator can meet it — and a pair is not
/// established by two tests that each look at one half. E-5's own record is the evidence: it rewrote the
/// serial message to name the sibling host and left the gateway with nothing, and the asymmetry was invisible
/// because nothing asked both questions in the same place.</para>
///
/// <para><b>No socket, no port, no I/O.</b> Every assertion below is on a pure function of a parsed document
/// or of an exception — the same reason <c>SerialPortBusLink.DescribeOpenFailure</c> was extracted from the
/// open in the first place. Nothing here connects to <c>gw.example</c>.</para>
/// </summary>
public sealed class RtuSegmentOwnershipTests
{
    private static string GatewayBus(string host, int port) => $$"""
        {
          "transport": "rtu-gateway",
          "host": "{{host}}",
          "port": {{port}},
          "devices": [
            {"machineCode":"SEG-A","unitId":1,"pollIntervalMs":1000,
             "registers":[{"address":0,"type":"Holding","dataType":"UInt16","scale":1.0,"metric":"speed","unit":"rpm"}]}
          ]
        }
        """;

    private static string SerialBus(string portName) => $$"""
        {
          "transport": "rtu-serial",
          "portName": "{{portName}}",
          "devices": [
            {"machineCode":"SEG-A","unitId":1,"pollIntervalMs":1000,
             "registers":[{"address":0,"type":"Holding","dataType":"UInt16","scale":1.0,"metric":"speed","unit":"rpm"}]}
          ]
        }
        """;

    /// <summary>
    /// 🔴 The pair, at the one type that owns the transport switch: a gateway plan carries the segment-
    /// ownership notice and no hardware limit; a serial plan carries the hardware limit and no segment-
    /// ownership notice. Both arms in one test because either arm alone would pass on a build that put the
    /// same string on both — which is the specific mistake available here, since the rule is TRUE of both
    /// transports and only its DELIVERY differs.
    /// </summary>
    [Fact]
    public void AGatewayPlanCarriesTheSegmentOwnershipNotice_AndASerialPlanCarriesTheHardwareLimitInstead()
    {
        var gateway = ModbusRtuBusPlan.Resolve(GatewayBus("gw.example", 4001));
        var serial = ModbusRtuBusPlan.Resolve(SerialBus("COM7"));

        Assert.NotNull(gateway.SegmentOwnershipNotice);
        Assert.Null(gateway.LimitNotice);

        Assert.NotNull(serial.LimitNotice);
        Assert.Null(serial.SegmentOwnershipNotice);
    }

    /// <summary>
    /// 🔴 <b>THE WORDING IS THE DELIVERABLE, so it is asserted rather than assumed.</b> The brief this task
    /// came from is explicit: do not write a sentence that lets a reader believe the product enforces one host
    /// per wire, and keep the write-side consequence labelled UNMEASURED rather than inheriting it as a fact.
    ///
    /// <para>The <c>DoesNotContain</c> arms are the discriminating ones. A notice that merely mentioned the
    /// rule would pass every positive check while reading, to the person on shift, as a promise — and a
    /// promise is what stops them going to look at the other host's <c>connectors.json</c>, which is the only
    /// thing that actually settles it. "prevents" and "blocks" are the two words that would turn this string
    /// into that promise.</para>
    ///
    /// <para>It also names the segment. A notice that says "a gateway" without saying WHICH gateway is
    /// unusable on a machine with two of them — the same reason the hardware limit renders the line.</para>
    /// </summary>
    [Fact]
    public void TheGatewayNotice_SaysNothingEnforcesIt_LabelsTheWriteConsequenceUnmeasured_AndNamesTheSegment()
    {
        var notice = ModbusRtuBusSettings.Parse(GatewayBus("gw.example", 4001)).DescribeSegmentOwnership();

        Assert.Contains("ONE HOST PER SEGMENT", notice, StringComparison.Ordinal);
        Assert.Contains("gw.example:4001", notice, StringComparison.Ordinal);

        // Constraint, not guarantee — both halves, because "nothing enforces it" and "this is a deployment
        // constraint" are two different sentences and an operator may only read one of them.
        Assert.Contains("NOTHING enforces it", notice, StringComparison.Ordinal);
        Assert.Contains("CONSTRAINT ON THE DEPLOYMENT, not a guarantee", notice, StringComparison.Ordinal);

        // The consequence, kept honest at both ends: it degrades rather than corrupts, and the FREQUENCY is
        // not a number anybody has.
        Assert.Contains("Indeterminate", notice, StringComparison.Ordinal);
        Assert.Contains("NOBODY HAS MEASURED", notice, StringComparison.Ordinal);

        Assert.DoesNotContain("prevents", notice, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("blocks", notice, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// 🔴 The serial half of the same pair: the held-port message now says WHOSE refusal produced it, and that
    /// the gateway transport produces no such refusal.
    ///
    /// <para>E-5 made this arm name the sibling host first — correctly, because that is the most likely holder
    /// on a machine running the whole product — but every sentence in it described the OS's exclusive open
    /// while reading like something this build does. A reader who takes it for arbitration never asks the
    /// question the gateway needs asked, and the gateway is where the constraint actually carries the weight.
    /// The final assertion is the one that matters: this arm points at the other transport, so the two halves
    /// of the rule cannot be learned separately.</para>
    /// </summary>
    [Fact]
    public void TheHeldPortMessage_AttributesTheRefusalToTheOperatingSystem_AndSaysAGatewayHasNoEquivalent()
    {
        var held = SerialPortBusLink.DescribeOpenFailure(
            new SerialLineSettings("COM3"), new UnauthorizedAccessException("Access to the path 'COM3' is denied."));

        // Unchanged from E-5, asserted here so this task cannot be read as having weakened it.
        Assert.Contains("already held", held, StringComparison.Ordinal);
        Assert.Contains("THE OTHER ST4I HOST", held, StringComparison.Ordinal);

        Assert.Contains("OPERATING SYSTEM", held, StringComparison.Ordinal);
        Assert.Contains("ONE HOST PER SEGMENT", held, StringComparison.Ordinal);
        Assert.Contains("GATEWAY nothing raises this error at all", held, StringComparison.Ordinal);
    }
}
