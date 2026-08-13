using System.Net;
using System.Net.Sockets;

namespace St4i.EdgeCore.Tests.Drivers;

/// <summary>
/// 🔴 A loopback TCP port that is guaranteed to refuse connections <b>and</b> guaranteed not to be handed to
/// anybody else, for the lifetime of the test assembly.
///
/// <para><b>Why this exists — a measured cross-test failure, not a precaution.</b> The idiom this replaces
/// was "start a <see cref="TcpListener"/> on port 0, read its port, <see cref="TcpListener.Stop"/> it, and
/// keep the number". That hands the ephemeral port straight back to the OS, which is free to reassign it to
/// another test's listener. A later connect to that number then <b>succeeds against a stranger's listener</b>
/// and immediately drops it, and the stranger sees a connection reset out of nowhere. A D-2 gate run failed
/// <c>DeviceIdentityStoreTests.Certificate_LoadedFromStore_CanCompleteARealMutualTlsHandshake</c> with
/// "An existing connection was forcibly closed by the remote host" thrown out of its SERVER-side handshake —
/// a test in a subsystem the change never touched. The easy reading, "a pre-existing TLS flake", was
/// available, plausible, and wrong; that is how an entry lands on a standing flaky list and stays there
/// misattributed.</para>
///
/// <para><b>The conformance suites' version is worse than the one that was caught</b>, which is why both now
/// come here. Theirs is a <see langword="static"/> <see langword="readonly"/> field, so the port is released
/// once and then handed to a DRIVER that reconnects on a poll cadence — the reassignment window is many
/// connects over the whole class's lifetime, not a single one.</para>
///
/// <para><b>The mechanism, and why it is not merely rarer.</b> The socket is <see cref="Socket.Bind"/>-ed and
/// <b>never</b> <see cref="Socket.Listen(int)"/>-ed. Bound means the port cannot be assigned to anyone else;
/// not listening means the stack answers a connect with RST, so a connect fails fast rather than hanging.
/// Both properties come from holding the binding, so the hazard is removed rather than made less likely.</para>
///
/// <para><b>Deliberately never disposed.</b> The holder must outlive every test in the assembly — releasing
/// it is precisely the bug. The process exit reclaims it, which is the correct lifetime for a
/// process-wide reservation.</para>
/// </summary>
internal static class ClosedLoopbackPort
{
    private static readonly Socket Holder = BindWithoutListening();

    /// <summary>A port on <see cref="IPAddress.Loopback"/> that will refuse every connection for as long as
    /// this process lives.</summary>
    public static int Port { get; } = ((IPEndPoint)Holder.LocalEndPoint!).Port;

    private static Socket BindWithoutListening()
    {
        var socket = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
        socket.Bind(new IPEndPoint(IPAddress.Loopback, 0));
        // No Listen() — see this class's own doc comment. Bound so nobody else can be assigned it; not
        // listening so a connect is refused instead of accepted or hung.
        return socket;
    }
}
