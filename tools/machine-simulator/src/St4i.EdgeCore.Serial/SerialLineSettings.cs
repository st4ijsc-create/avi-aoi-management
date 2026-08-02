using System.IO.Ports;

namespace St4i.EdgeCore.Drivers.Modbus;

/// <summary>
/// Task D-3 — thrown when a COM port cannot be opened. A subclass of <see cref="IOException"/> deliberately:
/// <see cref="ModbusRtuDriver"/>'s poll catch and <see cref="ModbusBus"/>'s own link handling already treat an
/// <see cref="IOException"/> as an ordinary "the link is not usable, degrade and rebuild", and inventing a type
/// outside that hierarchy would have made a vanished USB adapter escape the handling that already exists.
///
/// <para><b>Why a wrapper at all, rather than letting the BCL's own exception out.</b> Measured on this
/// machine, the three ways an open fails say nothing an operator can act on:
/// a port that is not present throws <c>System.IO.FileNotFoundException: Could not find file 'COM99'</c>;
/// a port another process already holds throws
/// <c>System.UnauthorizedAccessException: Access to the path 'COM1' is denied</c>; and a name that is not a
/// port at all throws <c>System.ArgumentException: The given port name (NOTAPORT) does not resolve to a valid
/// serial port</c>. None of the three names the LINE PARAMETERS, and on RS-485 the line parameters are the
/// most common thing to have got wrong. This type puts the port, its framing and the three realistic causes
/// into one message, and keeps the original as <see cref="Exception.InnerException"/>.</para>
/// </summary>
public sealed class SerialPortUnavailableException : IOException
{
    public SerialPortUnavailableException(string message, Exception? inner = null) : base(message, inner) { }
}

/// <summary>
/// Task D-3 (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-3-brief.md) — <b>the line parameters
/// of one RS-485 segment</b>, and the answer to "where are baud/parity/data bits/stop bits configured".
///
/// <para><b>They are configured HERE, on the link, and NOT on <see cref="ModbusRegisterMap"/>.</b> The map is
/// per-DEVICE (it carries <c>UnitId</c>, the register list and the per-device timeout); the line parameters are
/// per-BUS, and on a multidrop segment every device shares them by physics. Putting them on the map would let
/// two devices on one wire declare different baud rates, which is not a configuration — it is a contradiction,
/// and the reference-counted seam would silently resolve it in favour of whichever driver constructed the bus
/// first (see <see cref="ModbusBusRegistry"/>'s key rule). Keeping them here makes that contradiction
/// impossible to express as one bus: <see cref="SerialPortBusLink.CreateBusKey"/> folds every one of these
/// values into the key, so two connectors that disagree about baud rate get two buses and two ports rather
/// than one shared misconfiguration. D-2 wrote that obligation down explicitly (task-2-report.md §6.1) and
/// this type is the discharge of it.</para>
///
/// <para><b>The defaults are the MODBUS specification's, not <see cref="SerialPort"/>'s.</b>
/// <c>MODBUS over Serial Line Specification V1.02</c> §2.5.1 requires 19200 baud as the default (9600 must
/// also be supported), an 11-bit character — 1 start, 8 data, 1 parity, 1 stop — and <b>even parity as the
/// default parity mode</b>. <see cref="SerialPort"/>'s own constructor defaults are 9600-8-N-1, which is a
/// different line and would be wrong on a spec-conforming device. A default that silently disagrees with the
/// protocol's own default is the "plausible wrong number" shape this batch keeps finding, so the defaults are
/// stated here and pinned by a test rather than inherited.</para>
///
/// <para>🔴 <b>A record CLASS, not a <c>readonly record struct</c>.</b> Same trap
/// <see cref="ModbusBusSettings"/>'s own remarks record: for a struct, <c>new S()</c> and <c>default</c>
/// silently discard every declared parameter default, so <c>BaudRate</c> would be 0 and <c>Parity</c> would be
/// <see cref="Parity.None"/> (ordinal 0) — a line that is both unopenable and, in the parity case, quietly
/// different from what was written down. The check that would catch it (the constructor below) is here for the
/// same "assert the failure, don't assume it can't happen" reason, but the type being a class is what makes the
/// declared defaults exist at all.</para>
/// </summary>
public sealed record SerialLineSettings
{
    /// <summary>MODBUS over Serial Line V1.02 §2.5.1 — the required default. 9600 must also be supported and
    /// is simply another value of this property.</summary>
    public const int DefaultBaudRate = 19_200;

    /// <summary>RTU is 8 data bits by definition — a Modbus RTU character is 8 bits of data inside an 11-bit
    /// frame. 7 data bits is ASCII framing, which blueprint §9 puts out of scope for this batch, so
    /// <see cref="DataBits"/> is validated to 8 rather than merely defaulted to it.</summary>
    public const int DefaultDataBits = 8;

    /// <summary>Even parity — the specification's default parity mode.</summary>
    public const Parity DefaultParity = Parity.Even;

    /// <summary>One stop bit, which is what the 11-bit frame has when parity is present. See
    /// <see cref="StopBits"/> for the one case where the specification wants two.</summary>
    public const StopBits DefaultStopBits = StopBits.One;

    /// <summary>
    /// Validates and normalises. <b>Everything is checked here rather than at
    /// <see cref="SerialPort.Open"/></b>, because a bad line parameter that reaches <c>Open</c> surfaces as
    /// either an <see cref="ArgumentOutOfRangeException"/> from deep inside the BCL naming a property rather
    /// than a bus, or — for the values that are physically legal but wrong for RTU — as no exception at all
    /// and a stream of CRC failures.
    /// </summary>
    /// <exception cref="ArgumentException"><paramref name="portName"/> is blank.</exception>
    /// <exception cref="ArgumentOutOfRangeException">A line parameter a Modbus RTU port cannot honour.</exception>
    public SerialLineSettings(
        string portName,
        int baudRate = DefaultBaudRate,
        Parity parity = DefaultParity,
        int dataBits = DefaultDataBits,
        StopBits stopBits = DefaultStopBits)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(portName);

        if (baudRate <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(baudRate), baudRate,
                "SerialLineSettings: baudRate must be > 0.");
        }

        if (dataBits != DefaultDataBits)
        {
            throw new ArgumentOutOfRangeException(nameof(dataBits), dataBits,
                "SerialLineSettings: Modbus RTU is 8 data bits by definition — a 7-bit character is ASCII " +
                "framing, which this product does not implement (blueprint §9). A map or connector asking for " +
                "anything but 8 is a configuration that could never have worked on the wire.");
        }

        if (!Enum.IsDefined(parity))
        {
            throw new ArgumentOutOfRangeException(nameof(parity), parity, "SerialLineSettings: unknown parity.");
        }

        if (stopBits is not (StopBits.One or StopBits.Two))
        {
            throw new ArgumentOutOfRangeException(nameof(stopBits), stopBits,
                "SerialLineSettings: stopBits must be One or Two. StopBits.None is not a line a port can be " +
                "opened on at all, and StopBits.OnePointFive is only defined for a 5-bit character, which RTU " +
                "is not.");
        }

        // Upper-cased because "com3" and "COM3" are one physical port, and the bus key is built from this
        // string: two connectors spelling the port differently must share one link, not open it twice (the
        // second open fails — measured: UnauthorizedAccessException, "Access to the path 'COM1' is denied").
        PortName = portName.Trim().ToUpperInvariant();
        BaudRate = baudRate;
        Parity = parity;
        DataBits = dataBits;
        StopBits = stopBits;
    }

    /// <summary>The COM port, normalised to upper case and trimmed.</summary>
    public string PortName { get; }

    public int BaudRate { get; }

    /// <summary>
    /// <b>The parameter most likely to be wrong on a real installation, and the one whose failure is least
    /// informative.</b> A parity mismatch does not throw: the UART either flags a receive-parity error the
    /// BCL surfaces only through <see cref="SerialPort.ErrorReceived"/>, or — when the wrong setting still
    /// produces a self-consistent frame — hands up bytes that fail Modbus's CRC. Either way what the operator
    /// sees is "the device never answers", identical to a wiring fault or a wrong unit id. There is no
    /// software fix for that from here; what this design does instead is put <see cref="Describe"/>'s
    /// rendering of these four values into every exception message the link throws, so the framing in use is
    /// in front of whoever is reading the log.
    /// </summary>
    public Parity Parity { get; }

    /// <summary>Always 8 — see <see cref="DefaultDataBits"/>. A property rather than a constant because it is
    /// part of the line's identity and therefore part of the bus key.</summary>
    public int DataBits { get; }

    /// <summary>
    /// <b>Not silently rewritten, and that is a decision.</b> MODBUS over Serial Line V1.02 §2.5.1 requires
    /// <b>two</b> stop bits when <see cref="Parity"/> is <see cref="Parity.None"/>, so that the character stays
    /// 11 bits wide. 8-N-1 is nonetheless extremely common in the field and interoperates in practice (a
    /// receiver frames on the first stop bit; the second is idle line). Silently upgrading a declared
    /// <c>None</c>+<c>One</c> to <c>None</c>+<c>Two</c> would be safer on the wire and would also mean the
    /// product runs a line the operator did not write down — which is the surprise this codebase refuses
    /// elsewhere. So it is accepted as declared, and recorded here so the decision is findable.
    /// </summary>
    public StopBits StopBits { get; }

    /// <summary>The conventional one-line rendering of a serial line — <c>"COM3 19200-8-E-1"</c>. Used in every
    /// exception this transport raises: on RS-485 "which line was I actually driving" is the first question,
    /// and an exception that does not answer it sends the reader to the configuration store instead of the
    /// log.</summary>
    public string Describe() => $"{PortName} {BaudRate}-{DataBits}-{ParityLetter}-{StopBitsLabel}";

    /// <summary>N/O/E/M/S — the conventional single letter, so <see cref="Describe"/> reads the way a serial
    /// line is written on a wiring diagram.</summary>
    internal char ParityLetter => Parity switch
    {
        Parity.None => 'N',
        Parity.Odd => 'O',
        Parity.Even => 'E',
        Parity.Mark => 'M',
        Parity.Space => 'S',
        _ => '?',
    };

    internal string StopBitsLabel => StopBits switch
    {
        StopBits.One => "1",
        StopBits.Two => "2",
        StopBits.OnePointFive => "1.5",
        _ => "?",
    };
}
