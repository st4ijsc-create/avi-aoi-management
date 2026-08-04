using System.IO.Ports;
using St4i.EdgeCore.Drivers.Modbus;
using Xunit;

namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// Task D-3 — the line parameters of an RS-485 segment: where they live, what they default to, and what a
/// port cannot be asked to do. See <see cref="SerialLineSettingsTests.TheDefaults_AreTheModbusSpecsFraming_NotSerialPortsOwn"/>
/// for why the defaults are asserted against <see cref="SerialPort"/>'s own rather than in isolation.
/// </summary>
public sealed class SerialLineSettingsTests
{
    /// <summary>
    /// 🔴 Two things at once, and the second is why the first is not a tautology.
    ///
    /// <para>The declared defaults survive construction — the <c>readonly record struct</c> trap
    /// <see cref="ModbusBusSettings"/>'s own remarks record, where <c>new S()</c> silently discards every
    /// declared default and hands back the zero value. Here the zero value would be baud 0 (a port that cannot
    /// open) and <see cref="Parity.None"/> (ordinal 0 — a line that opens fine and quietly disagrees with the
    /// device).</para>
    ///
    /// <para>And they are the MODBUS SPECIFICATION's framing, not <see cref="SerialPort"/>'s. The control in
    /// this test is a real <see cref="SerialPort"/> object constructed the BCL's own way: it comes out
    /// 9600-8-N-1, which is a DIFFERENT LINE. Asserting <c>19200</c> and <c>Even</c> in isolation would prove
    /// only that the numbers written in the type are the numbers read back out; asserting them beside the
    /// defaults they deliberately override is what makes the test about the decision.</para>
    /// </summary>
    [Fact]
    public void TheDefaults_AreTheModbusSpecsFraming_NotSerialPortsOwn()
    {
        var line = new SerialLineSettings("COM3");

        Assert.Equal(19_200, line.BaudRate);
        Assert.Equal(Parity.Even, line.Parity);
        Assert.Equal(8, line.DataBits);
        Assert.Equal(StopBits.One, line.StopBits);
        Assert.Equal("COM3 19200-8-E-1", line.Describe());

        using var bclDefaults = new SerialPort("COM3");
        Assert.Equal(9600, bclDefaults.BaudRate);
        Assert.Equal(Parity.None, bclDefaults.Parity);
        Assert.NotEqual(bclDefaults.BaudRate, line.BaudRate);
        Assert.NotEqual(bclDefaults.Parity, line.Parity);
    }

    /// <summary>
    /// Every one of these opens a port successfully with no exception on some other protocol, and produces
    /// either an unopenable port or a line Modbus RTU is not defined on. Checked in the constructor rather
    /// than left to <see cref="SerialPort.Open"/>, because the BCL's own failures name a property rather than
    /// a bus — and for the RTU-specific ones (7 data bits) there is no BCL failure at all, only CRC errors
    /// forever.
    /// </summary>
    [Theory]
    [InlineData(0, 8, StopBits.One)]                    // a baud rate no port can be opened at
    [InlineData(-1, 8, StopBits.One)]
    [InlineData(19_200, 7, StopBits.One)]               // ASCII framing — blueprint §9 puts it out of scope
    [InlineData(19_200, 9, StopBits.One)]
    [InlineData(19_200, 8, StopBits.None)]              // not a line at all
    [InlineData(19_200, 8, StopBits.OnePointFive)]      // only defined for a 5-bit character
    public void Construction_RefusesALineAPortCannotHonour(int baudRate, int dataBits, StopBits stopBits)
        => Assert.Throws<ArgumentOutOfRangeException>(
            () => new SerialLineSettings("COM3", baudRate, Parity.Even, dataBits, stopBits));

    [Fact]
    public void Construction_RefusesABlankPortName()
    {
        Assert.ThrowsAny<ArgumentException>(() => new SerialLineSettings(null!));
        Assert.ThrowsAny<ArgumentException>(() => new SerialLineSettings(""));
        Assert.ThrowsAny<ArgumentException>(() => new SerialLineSettings("   "));
    }

    /// <summary>"com3" and "COM3" are one physical port. The normalisation matters beyond tidiness because
    /// the bus key is built from this string — see
    /// <c>SerialPortBusLinkTests.TwoConnectorsOnOneSerialLine_ShareOneBus_AndInvokeTheOpenerOnce</c>, which drives
    /// the consequence through the real registry rather than comparing two strings.</summary>
    [Fact]
    public void ThePortName_IsTrimmedAndUpperCased_BecauseCom3AndCOM3AreOnePort()
    {
        Assert.Equal("COM3", new SerialLineSettings("  com3 ").PortName);
        Assert.Equal("COM3 19200-8-E-1", new SerialLineSettings("com3").Describe());
    }
}
