using System.IO.Ports;
// The ASSEMBLY is St4i.EdgeCore.Serial; the NAMESPACE is St4i.EdgeCore.Drivers.Modbus — deliberately the
// same namespace as the RTU framing layer in St4i.EdgeCore, so a reader of a bus map does not have to know
// which of the two assemblies a type sits in (see St4i.EdgeCore.Serial.csproj's own remarks on why the
// split exists at all: it is a PackageReference boundary, not a domain boundary).
using St4i.EdgeCore.Drivers.Modbus;
using Xunit;

namespace St4i.EdgeService.Tests;

/// <summary>
/// 🔴 <b>Task E-4 (docs/plans/2026-08-04-dotE-fleet-core-extraction-blueprint.md §12) — the census rule
/// "every claim of the form <i>only X can do Y</i> gets a test" applied to the one this product repeats
/// most: README §23.6's <b>"Only <c>St4i.EngineApi</c> can open a COM port."</b></b>
///
/// <para><b>That sentence is false as a CAPABILITY claim, and it has been since D-7c — before this batch
/// started.</b> <see cref="SerialPortBusLink.OpenAsync"/> and <see cref="SerialLineSettings"/> are both
/// <c>public</c> on <c>St4i.EdgeCore.Serial</c>, and D-7c's own "all three hosts" ruling gave
/// <c>St4i.EdgeService</c> a <c>ProjectReference</c> to that project. Nothing about visibility or the
/// reference graph stops this host opening a port; the test below opens one.</para>
///
/// <para><b>What the instrument is, stated because reflection and the compiler answer different
/// questions</b> (blueprint §11.1's own correction): this is a COMPILER-level claim, not a reflection one.
/// <c>St4i.EdgeService.Tests</c> has exactly ONE <c>ProjectReference</c> — <c>St4i.EdgeService</c> — so
/// naming <see cref="SerialPortBusLink"/> here compiles only because it is reachable through THIS HOST'S own
/// reference graph. The call then actually runs, so the assertion is not about an exported name: a real
/// <see cref="SerialPort.Open"/> is attempted and fails at the operating system, which is what "this host
/// can open a COM port" means. (Measured independently the same way E-3's review measured the <c>internal</c>
/// <c>FleetCore</c>: a probe file compiled into the production <c>St4i.EdgeService</c> assembly itself
/// — see task-4-report.md. It compiles. There is no <c>CS0122</c> to be had here, which is the entire
/// difference between this claim and that one.)</para>
///
/// <para>🔴 <b>The TRUE statement, which README §24 now carries instead:</b> all three hosts can reach the
/// serial open; what differs is that only <c>St4i.EngineApi</c> has a configured path from
/// <c>connectors.json</c> to it. <c>St4i.EdgeService</c> refuses an RTU entry BY NAME — a decision, pinned
/// by <c>EdgeWorkerConnectorsTests.AnRtuBusEntry_IsRefusedByName_RatherThanSilentlyBuildingASecondFanOut</c>
/// — and the WPF shell has no connector registry at all. That is a statement about CONFIGURATION, and it has
/// a different remedy and a different risk profile from a statement about capability: "cannot" needs no
/// guard, "is not configured to" needs the refusal to stay.</para>
///
/// <para><b>Why this matters beyond tidiness.</b> Blueprint §2's whole shape rests on the OS refusing a
/// second open of a COM port — "the second process cannot open the port, by accident of the operating
/// system". A reader who believes this host CANNOT open a port at all will not think about which process
/// holds COM3, and the one protection that exists for direct serial is precisely that contention.</para>
/// </summary>
public sealed class EdgeServiceSerialReachabilityTests
{
    /// <summary>A COM name genuinely absent from this machine — DERIVED, not hardcoded, the same reflex as
    /// <c>SerialPortBusLinkTests.AbsentPortName</c> in the EdgeCore suite (duplicated rather than shared: it
    /// is four lines and the two assemblies have no shared test project). A hardcoded "COM99" is a guess
    /// about someone else's machine, and a wrong guess opens a stranger's device.</summary>
    private static string AbsentPortName()
    {
        var present = new HashSet<string>(SerialPort.GetPortNames(), StringComparer.OrdinalIgnoreCase);
        for (var i = 90; i <= 250; i++)
        {
            var candidate = $"COM{i}";
            if (!present.Contains(candidate)) return candidate;
        }

        throw new InvalidOperationException(
            "COM90..COM250 are all present on this machine, which cannot be right — refusing to guess.");
    }

    /// <summary>🔴 This host attempts a real COM open and the OPERATING SYSTEM is what refuses it — not the
    /// compiler, not an access modifier, not a missing reference. A <see cref="SerialPortUnavailableException"/>
    /// naming the absent port is only reachable by having actually called <see cref="SerialPort.Open"/>
    /// (see <c>SerialPortBusLink.DescribeOpenFailure</c>: the "NOT PRESENT" wording is chosen from the BCL
    /// exception the open really threw), so a green here cannot mean "the type was merely visible".</summary>
    [Fact]
    public async Task ThisHostCanReachTheSerialOpen_SoOnlyEngineApiCanOpenAComPortIsAboutConfigurationNotCapability()
    {
        var line = new SerialLineSettings(AbsentPortName());

        var ex = await Assert.ThrowsAsync<SerialPortUnavailableException>(
            () => SerialPortBusLink.OpenAsync(line, CancellationToken.None));

        Assert.Contains(line.PortName, ex.Message, StringComparison.Ordinal);
        Assert.Contains("NOT PRESENT", ex.Message, StringComparison.Ordinal);

        // The failure came from the OS, not from this product deciding not to try: DescribeOpenFailure
        // branches on the BCL exception, so an InnerException is the receipt that Open() actually ran.
        Assert.NotNull(ex.InnerException);
    }
}
