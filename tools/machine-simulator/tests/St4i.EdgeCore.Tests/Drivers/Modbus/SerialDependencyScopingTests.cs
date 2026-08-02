using System.Reflection;
using St4i.EdgeCore.Drivers.Modbus;
using Xunit;

namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// Task D-3 (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-3-brief.md) — <b>the structural proof
/// that the one NuGet exception this batch grants is actually scoped.</b> The brief's global constraint is
/// "<c>System.IO.Ports</c> is added here and ONLY here … a gateway deployment must not drag in a serial
/// dependency. Verify that, do not assume it", and its Tests section says to prove it <b>structurally, not by
/// inspection</b>. These <b>seven</b> tests are that proof — four assertions and three positive controls — and
/// they answer two different questions with two different instruments, neither of which is sufficient alone.
/// (Review M-6: this said "six", counted before the never-built guard was added in the previous round. A
/// hand-maintained count in a comment beside a class whose whole subject is "prove it structurally" is exactly
/// the shape that drifts; it is stated here as 4 + 3 so the arithmetic is visible rather than asserted.)
///
/// <para><b>Question 1 — does the RTU framing layer COMPILE without it?</b> Answered by
/// <see cref="TheRtuFramingLayersOwnAssembly_ReferencesNeitherSystemIoPorts_NorTheSerialAssembly"/>, reading
/// <c>St4i.EdgeCore</c>'s own <see cref="Assembly.GetReferencedAssemblies"/>. The C# compiler emits an
/// <c>AssemblyRef</c> only for an assembly whose types a project's own IL actually uses — so this assertion
/// would go red the moment <c>SerialPortBusLink</c> (or anything else touching a
/// <c>System.IO.Ports</c> type) moved into <c>St4i.EdgeCore</c>, which is exactly the regression it exists to
/// catch. Its positive control is <see cref="TheSerialAssembly_DoesReferenceSystemIoPorts"/>.</para>
///
/// <para><b>Question 2 — does a gateway DEPLOYMENT carry it?</b> A different question, and
/// <see cref="Assembly.GetReferencedAssemblies"/> is useless for it — that is the trap
/// <see cref="MakaretuNotShippedTests"/> documents at length: NuGet's
/// project-reference-transitive-package-copy puts a restored package's runtime assets into the output
/// directory of every project that transitively restores it, <b>whether or not that project's own IL
/// references a single type from it</b>. So the deployment question can only be answered by looking at what
/// physically landed in the three executables this product ships.</para>
///
/// <para>🔴 <b>Why the deployment assertions name only the executables, never <c>St4i.EdgeCore</c> itself.</b>
/// Measured on this tree: a LIBRARY project's <c>bin/</c> contains only its own and its project references'
/// assemblies — <c>src/St4i.EdgeCore/bin</c> carries no <c>NModbus.dll</c> at all despite EdgeCore owning that
/// <c>PackageReference</c>, and <c>src/St4i.EdgeCore.Serial/bin</c> contained exactly seven files and no
/// <c>System.IO.Ports.dll</c>. Package assets are copied for EXECUTABLES. An
/// "<c>EdgeCore</c>'s output contains no <c>System.IO.Ports.dll</c>" assertion would therefore have passed
/// on a tree where the dependency was completely unscoped, which is a vacuous test in the exact sense this
/// project has caught ten times. That is also why the positive control below is this TEST assembly's own
/// output rather than the serial library's.</para>
/// </summary>
public sealed class SerialDependencyScopingTests
{
    private const string SerialDll = "System.IO.Ports.dll";
    private const string SerialAssemblyName = "System.IO.Ports";
    private const string SerialProjectAssemblyName = "St4i.EdgeCore.Serial";

    private static void AssertNoSerialDependencyInOutput(
        string projectRelativeDir, string primaryOutputFileName, string whatThisDeploymentIs)
    {
        Assert.True(
            BuildOutputProbe.PrimaryOutputExists(projectRelativeDir, primaryOutputFileName),
            $"{projectRelativeDir} has never been built — run `dotnet build St4iMachineSimulator.sln` first. " +
            "An absent build output would make the assertion below pass while proving nothing.");

        var leaked = BuildOutputProbe.FindInOutput(projectRelativeDir, SerialDll);
        Assert.True(leaked.Count == 0,
            $"{projectRelativeDir} ({whatThisDeploymentIs}) carries {SerialDll} in its build output. " +
            "Đợt D §6 scopes System.IO.Ports to St4i.EdgeCore.Serial precisely so this deployment does not " +
            "ship a serial dependency it never uses. Found: " + string.Join(", ", leaked));
    }

    [Fact]
    public void EdgeServiceDeployment_NeverCarriesSystemIoPorts()
        => AssertNoSerialDependencyInOutput(
            Path.Combine("src", "St4i.EdgeService"), "St4i.EdgeService.dll",
            "the Windows Service host — the shape a gateway-fronted site actually deploys");

    [Fact]
    public void EngineApiDeployment_NeverCarriesSystemIoPorts()
        => AssertNoSerialDependencyInOutput(
            Path.Combine("src", "St4i.EngineApi"), "St4i.EngineApi.dll",
            "the engine, which hosts every connector including the RTU-over-TCP gateway transport");

    [Fact]
    public void DesktopShellDeployment_NeverCarriesSystemIoPorts()
        => AssertNoSerialDependencyInOutput(
            Path.Combine("src", "St4iMachineSimulator"), "St4iMachineSimulator.exe",
            "the WPF exhibition shell");

    /// <summary>
    /// 🔴 <b>The positive control for the three assertions above, and simultaneously a demonstration of the
    /// leak mechanism they guard against.</b> This test assembly is the ONLY thing in the repository that
    /// references <c>St4i.EdgeCore.Serial</c> — and the moment it did, three copies of
    /// <c>System.IO.Ports.dll</c> appeared in its output (the flat directory plus
    /// <c>runtimes/win/lib/net10.0</c> and <c>runtimes/unix/lib/net10.0</c>). That is precisely what would
    /// have happened to all three deployments above had the <c>PackageReference</c> gone on
    /// <c>St4i.EdgeCore</c>. If this assertion ever fails, the file search itself is broken and the three
    /// "must not carry it" tests are meaningless rather than reassuring.
    /// </summary>
    [Fact]
    public void ThisTestAssemblysOwnOutput_DoesCarrySystemIoPorts_ProvingTheSearchCanFindIt()
    {
        var projectDir = Path.Combine("tests", "St4i.EdgeCore.Tests");
        Assert.True(
            BuildOutputProbe.PrimaryOutputExists(projectDir, "St4i.EdgeCore.Tests.dll"),
            "St4i.EdgeCore.Tests has never been built — which cannot be true while this test is running, so " +
            "the solution-root walk in BuildOutputProbe is what is broken.");

        var found = BuildOutputProbe.FindInOutput(projectDir, SerialDll);
        Assert.True(found.Count > 0,
            $"Positive control failed: this test assembly references St4i.EdgeCore.Serial, so {SerialDll} " +
            "must be in its own output. If it is not, the search below/above cannot detect the dependency at " +
            "all and the three deployment assertions in this class prove nothing.");
    }

    /// <summary>
    /// The compile-time half: <c>St4i.EdgeCore</c> — which holds <see cref="ModbusBus"/>, the RTU framing
    /// layer, the arbitration, the quarantine and <see cref="GatewayTcpBusLink"/> — must not reference the
    /// serial package OR the serial assembly. This is the assertion that fails if a future task "simplifies"
    /// the layout by moving <c>SerialPortBusLink</c> back in beside the seam it implements.
    /// </summary>
    [Fact]
    public void TheRtuFramingLayersOwnAssembly_ReferencesNeitherSystemIoPorts_NorTheSerialAssembly()
    {
        var referenced = typeof(ModbusBus).Assembly
            .GetReferencedAssemblies()
            .Select(a => a.Name)
            .ToList();

        Assert.DoesNotContain(SerialAssemblyName, referenced);
        Assert.DoesNotContain(SerialProjectAssemblyName, referenced);

        // Naming the transport explicitly, so the reason this matters is not only in a comment: the gateway
        // transport lives in the SAME assembly as the bus, and it is the one a serial-free deployment ships.
        Assert.Equal(typeof(ModbusBus).Assembly, typeof(GatewayTcpBusLink).Assembly);
    }

    /// <summary>
    /// 🔴 <b>Mutation-found (M18), and it is this repository's oldest trap wearing a new costume.</b>
    /// <see cref="BuildOutputProbe.FindInOutput"/> refuses a project whose <c>bin/</c> does not exist instead
    /// of returning an empty list — because an empty list is indistinguishable, at the assertion, from "this
    /// deployment carries no serial dependency". That is <c>verify-suites.sh</c>'s own trap #1 verbatim: an
    /// absent negative read as a positive.
    ///
    /// <para>The mutation that turns the refusal into <c>return Array.Empty&lt;string&gt;()</c>
    /// <b>survived every test in this class and in <see cref="MakaretuNotShippedTests"/></b>, and the reason
    /// is the consequence question rather than a missing assertion: every caller happens to check
    /// <see cref="BuildOutputProbe.PrimaryOutputExists"/> first, so nothing ever ASKED the guard anything. A
    /// mutation cannot reach a branch nothing runs through; this test is what makes it run.</para>
    /// </summary>
    [Fact]
    public void TheOutputSearch_RefusesAProjectThatWasNeverBuilt_RatherThanReportingItClean()
    {
        var ex = Assert.Throws<InvalidOperationException>(
            () => BuildOutputProbe.FindInOutput(Path.Combine("src", "St4i.NoSuchProject"), SerialDll));

        Assert.Contains("does not exist", ex.Message, StringComparison.Ordinal);
        Assert.Contains("build St4iMachineSimulator.sln", ex.Message, StringComparison.Ordinal);
    }

    /// <summary>The positive control for the assertion above: the serial assembly DOES reference
    /// <c>System.IO.Ports</c>, so "no such reference" is a fact about EdgeCore rather than about
    /// <see cref="Assembly.GetReferencedAssemblies"/> being unable to see one.</summary>
    [Fact]
    public void TheSerialAssembly_DoesReferenceSystemIoPorts()
    {
        var referenced = typeof(SerialPortBusLink).Assembly
            .GetReferencedAssemblies()
            .Select(a => a.Name)
            .ToList();

        Assert.Contains(SerialAssemblyName, referenced);
        Assert.NotEqual(typeof(ModbusBus).Assembly, typeof(SerialPortBusLink).Assembly);
    }
}
