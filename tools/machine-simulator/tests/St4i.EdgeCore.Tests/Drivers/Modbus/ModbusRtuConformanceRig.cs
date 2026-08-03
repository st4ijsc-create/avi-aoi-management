// SerialLineSettings/SerialPortBusLink/SerialPortUnavailableException live in the SEPARATE
// St4i.EdgeCore.Serial assembly (D-3, so System.IO.Ports cannot leak into a gateway deployment) but share the
// St4i.EdgeCore.Drivers.Modbus namespace with the rest of the stack, so this one using covers both.
using St4i.EdgeCore.Drivers.Modbus;

namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// 🔴 Task D-6 (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-6-brief.md) — <b>the three device
/// shapes <see cref="St4i.Connector.Conformance.DeviceDriverConformanceSuite"/> asks a driver author for,
/// built for a transport that has no portable virtual COM port.</b> Shared by
/// <c>ModbusRtuConformanceTestsBase</c>'s two concrete subclasses AND by
/// <c>ModbusRtuConformanceRigTests</c>, which is the file that proves this rig can FAIL — a harness whose
/// peers always behave makes several conformance checks vacuous, so its own teeth are tested separately
/// rather than assumed.
///
/// <para><b>The seam is <see cref="IModbusBusLink"/>, not <c>IStreamResource</c>, and that was decided by
/// D-2 rather than re-litigated here.</b> <see cref="InMemoryBusLinkPair"/>'s own doc comment states the
/// argument: the two capabilities this stack's safety rests on — <see cref="IModbusBusLink.AbortPendingRead"/>
/// (cancel a read WITHOUT closing a line N devices share) and <see cref="IModbusBusLink.DrainBufferedInput"/>
/// (a drain that reports its COUNT, which is what makes the quiet window observable rather than merely
/// elapsed) — do not exist on <c>IStreamResource</c>. A double implementing only the narrower contract would
/// drive a <see cref="ModbusBus"/> that cannot cancel and cannot observe silence, i.e. it would conformance-test
/// a bus nobody ships. Everything below therefore reuses D-2's <see cref="InMemoryBusLinkPair"/> and D-5's
/// <see cref="RawRtuResponder"/> unforked.</para>
///
/// <para>🔴 <b>The RTU form of the <c>ClosedLoopbackPort</c> mistake, and why every rig here holds a
/// KEEP-ALIVE lease.</b> D-2's review (I-3) found a TCP harness that obtained a port number by starting a
/// listener, stopping it, and keeping the number — releasing the resource while retaining the identifier that
/// names it, so the OS could hand the same number to a stranger. <b>The RTU equivalent is a lease.</b>
/// <see cref="DeviceDriverConformanceSuite.CreateDriver"/> is called many times per check and every driver it
/// returns is disposed; each disposal releases that driver's <see cref="ModbusBusLease"/>, and
/// <see cref="ModbusBusRegistry.ReleaseAsync"/> disposes the whole <see cref="ModbusBus"/> — <b>and its
/// link</b> — the moment the count reaches zero. A rig that kept only the bus KEY and the
/// <see cref="InMemoryBusLinkPair"/> would then hand the next <see cref="ModbusBusRegistry.Acquire"/> a
/// brand-new bus over an already-disposed link: same shape, same failure, RTU spelling. Holding one lease for
/// the rig's whole lifetime holds the RESOURCE rather than the identifier, which is exactly what
/// <c>ClosedLoopbackPort</c> does by binding without listening. <c>ModbusRtuConformanceRigTests</c> pins the
/// trap itself, so this paragraph is a description of a tested fact rather than a caution.</para>
/// </summary>
internal static class ModbusRtuConformanceRig
{
    /// <summary>A port name that cannot be a COM port on any machine (a real one is <c>COM</c> followed by
    /// digits), so nothing here can ever be "fixed" into touching real hardware by accident. <b>No
    /// <see cref="System.IO.Ports.SerialPort"/> is ever constructed</b> — see <see cref="UnopenableLine"/>.</summary>
    public const string AbsentPortName = "COM-CONFORMANCE-ABSENT";

    /// <summary>The line parameters the absent port would have. Built through the real
    /// <see cref="SerialLineSettings"/> so the bus key below comes out of the product's own builder.</summary>
    public static SerialLineSettings AbsentLine { get; } = new(AbsentPortName);

    /// <summary>
    /// 🔴 <b>Built by <see cref="SerialPortBusLink.CreateBusKey"/>, the ONLY supported way to name an RTU
    /// serial bus.</b> <see cref="ModbusBusRegistry"/>'s own doc comment names inventing a key format as the
    /// one hazard its design cannot close for a caller — two callers agreeing on a key silently share a link,
    /// and delegates cannot be compared, so a mismatch is undetectable at that seam. A conformance harness is
    /// exactly the sort of code that would hand-roll one.
    ///
    /// <para>Cross-test collision is impossible for a second, independent reason: every rig owns its own
    /// <see cref="ModbusBusRegistry"/> (xunit constructs a fresh test-class instance per test), and a key only
    /// means anything inside one registry.</para>
    /// </summary>
    public static string AbsentLineBusKey { get; } = SerialPortBusLink.CreateBusKey(AbsentLine);

    /// <summary>
    /// 🔴 <b><see cref="DeviceDriverConformanceSuite.CreateDriver"/>'s "no device reachable, and FAST to fail"
    /// target — RTU's answer to TCP's definitely-closed port, and it is not a timeout.</b>
    ///
    /// <para>The brief asks how a silent RS-485 line produces a FAST failure, because it does not: a device
    /// that never answers costs a whole <c>readTimeoutMs</c> per attempt. The answer is that on RTU
    /// "unreachable" has a second, cheaper form that TCP does not have a close analogue for — <b>the LINE
    /// itself cannot be opened.</b> <see cref="SerialPortBusLink.OpenAsync"/> throws
    /// <see cref="SerialPortUnavailableException"/> the instant <c>SerialPort.Open()</c> reports the port
    /// absent (an unplugged USB RS-485 adapter), held by another process, or not a serial port at all; there
    /// is no handshake and no timeout to wait out. That is the genuine "cheap and fast to fail" target the
    /// hook asks for, and it is the commonest way an RTU connector is unreachable in the field.</para>
    ///
    /// <para><b>It is produced WITHOUT a serial port.</b> <see cref="ModbusBus"/> reaches its link only through
    /// this delegate, so a delegate that fails is indistinguishable — from every layer above it — from a real
    /// port that would not open. The real exception TYPE is used rather than a stand-in so the driver's
    /// degrade path is exercised by the thing it will actually be handed.</para>
    ///
    /// <para><paramref name="onAttempt"/> counts invocations, which is what lets
    /// <c>ModbusRtuConformanceRigTests</c> prove this target is genuinely ASKED rather than passing because
    /// nothing ever tried — the same distinction D-5 drew between "the master timed out" and "the master never
    /// transmitted".</para>
    /// </summary>
    public static Func<CancellationToken, Task<IModbusBusLink>> UnopenableLine(Action? onAttempt = null) =>
        _ =>
        {
            onAttempt?.Invoke();
            return Task.FromException<IModbusBusLink>(new SerialPortUnavailableException(
                $"Could not open the Modbus RTU serial line {AbsentLine.Describe()}: the port is not present on " +
                "this machine. (Conformance rig — no SerialPort is ever constructed; this is the exception " +
                "SerialPortBusLink.OpenAsync raises for an absent port, raised without one.)"));
        };

    /// <summary>
    /// 🔴 <b><see cref="DeviceDriverConformanceSuite.CreateUnresponsiveDeviceAsync"/>'s target: a peer that
    /// ACCEPTS every byte and never answers one.</b> The RTU counterpart of TCP's "accept the connection, never
    /// write a byte back", and the shape that reproduces the realistic stuck-driver failure the read-side
    /// cancellation check exists to catch.
    ///
    /// <para>The peer is a <see cref="RawRtuResponder"/> whose reply function always returns
    /// <see langword="null"/>. That is D-5's own double, reused rather than forked, and it buys the one thing a
    /// bare pipe cannot: <see cref="RawRtuResponder.RequestsSeen"/>, so a check that concludes "the driver
    /// never got an answer" can be shown to differ from "the driver never asked". Both look identical from the
    /// master's side, and only one of them is a conformance result.</para>
    /// </summary>
    public sealed class SilentPeer : IAsyncDisposable
    {
        private readonly ModbusBusLease _keepAlive;

        private SilentPeer(InMemoryBusLinkPair links, RawRtuResponder responder, ModbusBusRegistry registry, string busKey)
        {
            Links = links;
            Responder = responder;
            Registry = registry;
            BusKey = busKey;
            _keepAlive = Acquire();
        }

        public InMemoryBusLinkPair Links { get; }

        public RawRtuResponder Responder { get; }

        public ModbusBusRegistry Registry { get; }

        public string BusKey { get; }

        /// <summary>How many complete request frames the far end has read off the line.</summary>
        public int RequestsSeen => Responder.RequestsSeen;

        /// <summary>A lease on this rig's one bus. Safe to call after any number of drivers have been created
        /// and disposed — see this class's own keep-alive remarks.</summary>
        public ModbusBusLease Acquire() =>
            Registry.Acquire(BusKey, _ => Task.FromResult<IModbusBusLink>(Links.Master));

        /// <summary>
        /// 🔴 Request frames that reached the BUS BOUNDARY carrying this unit id and this function code —
        /// the externally-observable count
        /// <see cref="DeviceDriverConformanceSuite.UnresponsiveWritableDeviceSession.CommandAttemptsReachingDevice"/>
        /// asks for.
        ///
        /// <para><b>Taken from the link, never from the driver</b>, which is the whole point of that hook: B-4
        /// found a resend that happened entirely BENEATH the driver's own code (NModbus's
        /// <c>Transport.Retries</c>), so a driver's own return value cannot answer this question either way.
        /// Filtered by unit id AND function code rather than counted in total, because on a MULTIDROP rig the
        /// same line also carries another machine's polls — a bare total would answer a different question
        /// than the one asked.</para>
        /// </summary>
        public int RequestFramesAtTheBusBoundary(byte unitId, byte functionCode) =>
            Links.Master.WrittenFrames.Count(f =>
                f.Length == RtuFrames.RequestFrameLength && f[0] == unitId && f[1] == functionCode);

        /// <summary>The reply function that makes this peer silent: it reads the whole request frame (so
        /// <see cref="RawRtuResponder.RequestsSeen"/> moves) and answers nothing at all.</summary>
        private static byte[]? NeverAnswer(byte[] request, int index) => null;

        public static SilentPeer Start(string label)
        {
            var links = InMemoryBusLinkPair.Create();
            var responder = new RawRtuResponder(links.Device, NeverAnswer);
            return new SilentPeer(
                links,
                responder,
                new ModbusBusRegistry(),
                // A GUID because this key names an IN-MEMORY link, for which no product-side builder exists
                // (SerialPortBusLink/GatewayTcpBusLink both own theirs). Two rigs must never be able to share
                // a bus by spelling, so the identity is generated rather than composed.
                busKey: $"modbus-rtu-inmemory:conformance-{label}:{Guid.NewGuid():N}");
        }

        public async ValueTask DisposeAsync()
        {
            try { await _keepAlive.DisposeAsync(); } catch { /* best-effort teardown */ }
            try { await Responder.DisposeAsync(); } catch { /* best-effort teardown */ }
            try { await Registry.DisposeAsync(); } catch { /* best-effort teardown */ }
            try { Links.Master.Dispose(); } catch { /* best-effort teardown */ }
        }
    }
}
