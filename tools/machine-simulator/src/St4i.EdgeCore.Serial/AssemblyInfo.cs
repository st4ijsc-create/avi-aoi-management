using System.Runtime.CompilerServices;

// Task D-3 — the same convention St4i.EngineApi and St4i.EdgeService already use for their own test
// assemblies: the members a test needs to reach are `internal` rather than `public`, and the grant is here.
//
// St4i.EdgeCore deliberately has NO such grant (see its own AssemblyInfo.cs), and this is not a departure
// from that: EdgeCore's entry was removed because nothing needed it any more, not because the convention was
// rejected.
//
// What actually needs it, and why each one is internal rather than public:
//
//   SerialPortBusLink.CreatePort  — builds a fully configured but UNOPENED SerialPort. It is the only part of
//     this transport a machine with no RS-485 adapter can drive, so the whole line-parameter decision
//     (baud/parity/data bits/stop bits, the forced Handshake.None, the deasserted RTS) is asserted through it.
//     It stays internal because a public form hands a caller a raw SerialPort that this link believes it owns
//     — a second owner of the port object is exactly the shape the reference-counted seam exists to prevent.
//
//   SerialPortBusLink.ReadSliceMs — the abort-latency slice. A test asserts the port is actually pinned to it;
//     duplicating the literal in the test instead would assert only that 20 == 20.
//
//   SerialLineSettings.ParityLetter / StopBitsLabel — the rendering the bus key and Describe() are built from.
//
// The test project is NOT named St4i.EdgeCore.Serial.Tests: this transport's tests live beside D-2's in
// St4i.EdgeCore.Tests/Drivers/Modbus, because they exercise the SAME seam (ModbusBus, ModbusBusRegistry) and
// splitting them across assemblies would put a sixth suite into scripts/verify-suites.sh for no gain.
[assembly: InternalsVisibleTo("St4i.EdgeCore.Tests")]
