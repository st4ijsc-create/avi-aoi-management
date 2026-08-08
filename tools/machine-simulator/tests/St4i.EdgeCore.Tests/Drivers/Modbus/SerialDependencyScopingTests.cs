using System.Reflection;
using St4i.EdgeCore.Drivers.Modbus;
using Xunit;

namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// Task D-3 (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-3-brief.md), <b>rewritten by Task
/// D-7c</b> — <b>the structural proof that the one NuGet exception this batch grants goes exactly where it was
/// decided to go, and nowhere else.</b> These <b>seven</b> tests are that proof — four assertions and three
/// positive controls — and they answer two different questions with two different instruments, neither of
/// which is sufficient alone. (Review M-6: this said "six", counted before the never-built guard was added. A
/// hand-maintained count in a comment beside a class whose whole subject is "prove it structurally" is exactly
/// the shape that drifts; it is stated as 4 + 3 so the arithmetic is visible rather than asserted.)
///
/// <para>🔴 <b>WHAT D-7c CHANGED, and why the change is an INVERSION rather than a deletion.</b> D-3 wrote
/// this class to answer "<i>does a gateway deployment carry a serial dependency it never uses?</i>", and all
/// three deployment assertions were negative. The owner ruled on 2026-08-03 that <b>direct RS-485 goes into
/// all three hosts</b>: <c>St4i.EngineApi</c>, <c>St4i.EdgeService</c> and <c>St4iMachineSimulator</c> all
/// reference <c>St4i.EdgeCore.Serial</c>, and all three therefore ship <c>System.IO.Ports.dll</c>. The
/// question this class answers is now "<i><b>does every connector host still carry it?</b></i>", and the three
/// assertions run POSITIVE. They were not deleted, because a deleted assertion lets a capability vanish
/// silently in a later "tidy up the unused reference" refactor — which is the exact defect shape this batch
/// has graded repeatedly, and the reason the capability is worth pinning at all.</para>
///
/// <para><b>Question 1 — does the RTU framing layer COMPILE without it?</b> Answered by
/// <see cref="TheRtuFramingLayersOwnAssembly_ReferencesNeitherSystemIoPorts_NorTheSerialAssembly"/>, reading
/// <c>St4i.EdgeCore</c>'s own <see cref="Assembly.GetReferencedAssemblies"/>. The C# compiler emits an
/// <c>AssemblyRef</c> only for an assembly whose types a project's own IL actually uses — so this assertion
/// would go red the moment <c>SerialPortBusLink</c> (or anything else touching a
/// <c>System.IO.Ports</c> type) moved into <c>St4i.EdgeCore</c>, which is exactly the regression it exists to
/// catch. <b>🔴 D-7c did NOT touch it and it is still green.</b> It is unaffected by the owner's ruling and
/// must not be swept up with the other three: the ruling is about which HOSTS reference the serial assembly,
/// not about where the serial code lives. Inverting it would put <c>System.IO.Ports</c> into the framing layer
/// and therefore into every consumer of EdgeCore, which is the opposite of the point — and it is also what
/// makes D-7c's design forced rather than chosen, since a serial arm inside
/// <c>ModbusRtuBusSettings.Parse</c> would need exactly that inversion. Its positive control is
/// <see cref="TheSerialAssembly_DoesReferenceSystemIoPorts"/>.</para>
///
/// <para><b>Question 2 — does a DEPLOYMENT carry it?</b> A different question, and
/// <see cref="Assembly.GetReferencedAssemblies"/> is useless for it — that is the trap
/// <see cref="MakaretuNotShippedTests"/> documents at length: NuGet's
/// project-reference-transitive-package-copy puts a restored package's runtime assets into the output
/// directory of every project that transitively restores it, <b>whether or not that project's own IL
/// references a single type from it</b>. That mechanism used to be the hazard; after the ruling it is the
/// delivery mechanism, and it is precisely why two of the three assertions below are worth having: the two
/// hosts with no connector plumbing carry the DLL without their own IL naming a single type from it, so
/// nothing but a look at the output directory can tell whether the reference is still there.</para>
///
/// <para>🔴 <b>Why the deployment assertions name only the executables, never <c>St4i.EdgeCore</c> itself.</b>
/// Measured on this tree: a LIBRARY project's <c>bin/</c> contains only its own and its project references'
/// assemblies — <c>src/St4i.EdgeCore/bin</c> carries no <c>NModbus.dll</c> at all despite EdgeCore owning that
/// <c>PackageReference</c>. Package assets are copied for EXECUTABLES. D-3 recorded this because an
/// "<c>EdgeCore</c>'s output contains no <c>System.IO.Ports.dll</c>" assertion would have passed on a tree
/// where the dependency was completely unscoped; it still matters in the inverted direction, because the same
/// fact is what makes the executables the only place the shipped answer can be read.</para>
/// </summary>
public sealed class SerialDependencyScopingTests
{
    private const string SerialDll = "System.IO.Ports.dll";
    private const string SerialAssemblyName = "System.IO.Ports";
    private const string SerialProjectAssemblyName = "St4i.EdgeCore.Serial";

    /// <summary>
    /// 🔴 Task D-7c — the inverted form of D-3's <c>AssertNoSerialDependencyInOutput</c>. Same probe, same
    /// never-built guard, opposite conclusion.
    ///
    /// <para>The never-built guard is <b>more</b> load-bearing now than it was, not less. Under the old
    /// negative assertion an unbuilt project produced an empty list that read as "clean"; under this one it
    /// produces an empty list that reads as "the capability is gone". Both are the same trap —
    /// <c>verify-suites.sh</c>'s trap #1, an absent negative read as a positive — and
    /// <see cref="BuildOutputProbe.FindInOutput"/> refuses an unbuilt project outright rather than returning
    /// empty, which is what <see cref="TheOutputSearch_RefusesAProjectThatWasNeverBuilt_RatherThanReportingItClean"/>
    /// pins.</para>
    /// </summary>
    private static void AssertSerialDependencyIsShippedWith(
        string projectRelativeDir, string primaryOutputFileName, string whatThisDeploymentIs)
    {
        Assert.True(
            BuildOutputProbe.PrimaryOutputExists(projectRelativeDir, primaryOutputFileName),
            $"{projectRelativeDir} has never been built — run `dotnet build St4iMachineSimulator.sln` first. " +
            "An absent build output would make the assertion below fail for a reason that has nothing to do " +
            "with the dependency.");

        var shipped = BuildOutputProbe.FindInOutput(projectRelativeDir, SerialDll);
        Assert.True(shipped.Count > 0,
            $"{projectRelativeDir} ({whatThisDeploymentIs}) does NOT carry {SerialDll} in its build output. " +
            "The owner ruled on 2026-08-03 that direct RS-485 goes into all three hosts, so every one of them " +
            "ProjectReferences St4i.EdgeCore.Serial and every one of them ships this DLL. The most likely " +
            "cause of this failure is that the ProjectReference was removed as 'unused' — which is exactly " +
            "why this assertion was inverted rather than deleted.");
    }

    /// <summary>
    /// 🔴 <b>The Windows Service host, and the one deployment assertion whose remark has to be careful.</b>
    /// It carries <c>System.IO.Ports.dll</c> because the owner's ruling puts the serial transport in every
    /// host — <b>not</b> because this host can open a COM port today, which it cannot.
    ///
    /// <para>Measured on this tree rather than assumed, because the ruling's stated basis was that
    /// <c>EdgeWorker.cs</c> uses <c>FleetHost</c>/<c>ConnectorRegistry</c>: it does not.
    /// <c>St4i.EdgeService</c> has no <c>ConnectorRegistry</c>, no <c>IConnectorFactory</c> and no
    /// <c>connectors.json</c> reader; <c>EdgeWorker.ExecuteAsync</c> builds one <c>SimulatedDriver</c> from
    /// <c>fleet.json</c>. <c>ConnectorRegistry</c> and <c>FleetHost</c> are <c>St4i.EngineApi</c> types and
    /// nothing under <c>src/</c> outside that project names either. So what this assertion pins is that the
    /// dependency the owner ruled for is still SHIPPED here — a real, checkable fact — and the remark says
    /// exactly that rather than borrowing a capability claim from the host next door.</para>
    ///
    /// <para>🔴 <b>Task E-4 census — EVERY FACTUAL SENTENCE IN THE PARAGRAPH ABOVE IS NOW FALSE, and the
    /// first one was never true.</b> Corrected in place rather than rewritten away, because what it records
    /// is the basis the D-7c ruling was argued on.
    /// <list type="bullet">
    /// <item><b>"not because this host can open a COM port today, which it cannot"</b> — never true as a
    /// CAPABILITY claim, and not because of Đợt E: <c>SerialPortBusLink.OpenAsync</c> and
    /// <c>SerialLineSettings</c> are <c>public</c> on the very assembly D-7c told all three hosts to
    /// reference. <c>St4i.EdgeService.Tests.EdgeServiceSerialReachabilityTests</c> performs the open from
    /// that host's own reference graph and is refused by the OPERATING SYSTEM, not the compiler. The true
    /// statement is about CONFIGURATION — only <c>St4i.EngineApi</c> has a configured path from
    /// <c>connectors.json</c> to a serial open — and it is README §24.5.</item>
    /// <item><b>"no <c>ConnectorRegistry</c>, no <c>IConnectorFactory</c>, no <c>connectors.json</c>
    /// reader"</b> and <b>"builds one <c>SimulatedDriver</c>"</b> — false since E-3:
    /// <c>EdgeConnectors.Build</c> reads the file and populates a <c>ConnectorRegistry</c>, and
    /// <c>EdgeAgentPipelines</c> runs N drivers on N pipelines off it.</item>
    /// <item><b>"<c>ConnectorRegistry</c> and <c>FleetHost</c> are <c>St4i.EngineApi</c> types"</b> — false
    /// for <c>ConnectorRegistry</c> since E-2, which moved it to <c>St4i.EdgeCore</c>.</item>
    /// </list>
    /// <b>What this test asserts is untouched by all of that</b>, which is why the assertion needed no
    /// change: it pins that the DLL is SHIPPED with this deployment. That was deliberately chosen over a
    /// capability claim, and the choice is what let three of the sentences around it go stale without the
    /// assertion ever becoming wrong.</para>
    /// </summary>
    [Fact]
    public void EdgeServiceDeployment_CarriesSystemIoPorts_ByTheAllThreeHostsRuling()
        => AssertSerialDependencyIsShippedWith(
            Path.Combine("src", "St4i.EdgeService"), "St4i.EdgeService.dll",
            "the Windows Service host — ruled in by the owner; since E-3 it does host connectors, but only " +
            "Modbus TCP is dispatched and an RTU entry is refused by name, so no configured path here " +
            "reaches a COM port (README §24.2/§24.5)");

    /// <summary>
    /// 🔴 <b>The engine — the one deployment where "carries it" and "can open a COM port" are the same
    /// statement</b>, and the difference is asserted rather than asserted-about. This class cannot make that
    /// second half: it would need to load <c>St4i.EngineApi</c>, which <c>St4i.EdgeCore.Tests</c> does not
    /// reference. The companion assertion lives where the assembly IS loadable —
    /// <c>St4i.EngineApi.Tests.Config.ConnectorsJsonRegistrationTests.TheEngineApisOwnIl_ReferencesTheSerialAssembly_…</c>
    /// — and it reads <c>St4i.EngineApi</c>'s own <see cref="Assembly.GetReferencedAssemblies"/>, which a host
    /// that merely inherits a copied package asset does not populate.
    ///
    /// <para>🔴 <b>Fix round 1, review M-1 — THE OBLIGATION, stated because this test DOES NOT VERIFY ITS OWN
    /// NAME.</b> Measured by the reviewer: delete the serial arm from
    /// <c>ConnectorsJsonRegistration.RegisterRtuBus</c> but keep the ProjectReference, and all seven tests in
    /// this class stay green — only the companion goes red. The <c>…BecauseItCanOpenAComPortDirectly</c> half of
    /// this name is true <b>only because a test in another assembly makes it true</b>.
    /// <b>THE TWO MOVE TOGETHER: renaming, weakening or deleting either one without the other leaves a name
    /// asserting something nothing checks</b> — which is the defect class this batch keeps grading, wearing a
    /// test's costume instead of a comment's.</para>
    /// </summary>
    [Fact]
    public void EngineApiDeployment_CarriesSystemIoPorts_BecauseItCanOpenAComPortDirectly()
        => AssertSerialDependencyIsShippedWith(
            Path.Combine("src", "St4i.EngineApi"), "St4i.EngineApi.dll",
            "the engine — the only host with a connector registry, and the one that opens a directly-attached " +
            "RS-485 line from a connectors.json 'rtu-serial' entry");

    /// <summary>The WPF exhibition shell. Same careful remark as
    /// <see cref="EdgeServiceDeployment_CarriesSystemIoPorts_ByTheAllThreeHostsRuling"/>: measured,
    /// <c>Services/FleetService.cs</c> builds a <c>ScenarioAwareDriver</c> over a <c>SimulatedDriver</c> plus a
    /// <c>HotFolderAoiDriver</c>, and has no connector plumbing at all.</summary>
    [Fact]
    public void DesktopShellDeployment_CarriesSystemIoPorts_ByTheAllThreeHostsRuling()
        => AssertSerialDependencyIsShippedWith(
            Path.Combine("src", "St4iMachineSimulator"), "St4iMachineSimulator.exe",
            "the WPF exhibition shell — ruled in by the owner, though it has no connector registry to open a " +
            "port from today");

    /// <summary>
    /// 🔴 <b>The positive control for the three assertions above — and Task D-7c changed its ROLE, which is
    /// worth saying because a control that no longer controls anything is worse than none.</b>
    ///
    /// <para><b>Before D-7c</b> it was the control for three NEGATIVE assertions: this test assembly was the
    /// only thing in the repository referencing <c>St4i.EdgeCore.Serial</c>, and the moment it did, copies of
    /// <c>System.IO.Ports.dll</c> appeared in its output — demonstrating the very leak mechanism the three
    /// "must not carry it" assertions guarded against, and proving their absence-finding was not vacuous.</para>
    ///
    /// <para><b>After D-7c</b> the three assertions run in the OPPOSITE direction, and this control's job
    /// changed with them: it no longer demonstrates a hazard, it proves that
    /// <see cref="BuildOutputProbe.FindInOutput"/> can find <c>System.IO.Ports.dll</c> at all. If the search
    /// were broken — a changed output layout, a wrong solution-root walk — every one of the three assertions
    /// above would fail together, and this control is what tells a reader "the search is broken" apart from
    /// "the three references were removed". That is a smaller claim than the one it used to make, and it is
    /// stated here rather than left for someone to infer from a test name that did not change.</para>
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
            "must be in its own output. If it is not, the search cannot detect the dependency at all and the " +
            "three deployment assertions in this class prove nothing — they would all fail together for a " +
            "reason that has nothing to do with what the hosts reference.");
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
