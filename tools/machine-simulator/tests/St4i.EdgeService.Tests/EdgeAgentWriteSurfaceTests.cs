using System.Reflection;
using St4i.Connector.Abstractions;
using St4i.EdgeCore.Engine;
using St4i.EdgeCore.Fleet;
using Xunit;

namespace St4i.EdgeService.Tests;

/// <summary>
/// 🔴 <b>Task E-3 — blueprint §3's "an edge agent's machines are read-only", asserted as a STRUCTURAL fact
/// about what this process can reach, not as a claim that some code does not happen to call something.</b>
///
/// <para><b>Why the assertion has to be structural.</b> Blueprint §2 chose the edge-agent shape in order to
/// avoid a hazard "structurally rather than by discipline"; blueprint §10.6 records that
/// <c>FleetCore.TryWriteSetpointAsync</c>/<c>TryInvokeCommandAsync</c> route a machine code to a live
/// writable driver and that <b>nothing inside either of them consults the HALT latch</b> — the guard
/// (<c>EstopGuardRule</c>), the RBAC and the audit trail all live in <c>St4i.EngineApi</c>, which this
/// process cannot reference at all. A test that asserted "EdgeWorker does not call the write path" would be
/// a statement about today's call sites; the next person to add a line would not be stopped by it. These
/// assertions are about what the compiler will accept.</para>
///
/// <para><b>WHERE THIS TEST LIVES IS PART OF THE ASSERTION.</b> It runs from
/// <c>St4i.EdgeService.Tests</c>, which reaches <c>St4i.EdgeCore</c> transitively through
/// <c>St4i.EdgeService</c> and has NO <c>InternalsVisibleTo</c> from it — the single entry in
/// <c>St4i.EdgeCore/AssemblyInfo.cs</c> names <c>St4i.EngineApi</c> and nothing else. So "not exported" here
/// means exactly what it means for the production host: not nameable, not callable, a compile error.</para>
///
/// <para><b>The method is an ENUMERATION, not an inspection</b> (Đợt D §8.1: start from the set of members).
/// It walks every exported type of <c>St4i.EdgeCore</c> and every public member on it, rather than looking
/// up the two members by name and finding them absent — "not in view" is the dangerous answer, and a
/// name-lookup is exactly the shape that gives it.</para>
///
/// <para>🔴 <b>THE LIMIT, STATED SO NOBODY OVER-READS THESE ASSERTIONS — and the first version of this
/// paragraph DID over-read, which is why it is now this long.</b>
///
/// <para>It said: "the machine-code → live-writable-driver ROUTING … is not reachable from this process at
/// all". <b>That is false, and the E-3 review proved it by compiling the counter-example.</b>
/// <see cref="ConnectorRegistry.TryGetInstanceIdForMachine"/> — whose own doc comment calls it "the ONE
/// lookup that makes per-machine write routing possible" — and <see cref="ConnectorRegistry.TryCreateDriver"/>
/// are both <c>public</c> on <c>St4i.EdgeCore</c>, and E-3 hands this host a POPULATED registry. The routing
/// <b>moved</b>, from <c>FleetCore</c> to <c>ConnectorRegistry</c>; it did not become unreachable.</para>
///
/// <para><b>What these assertions DO prove, exactly:</b> <c>FleetCore</c>'s two unguarded write members and
/// its LIVE-SLOT table — the map from a machine to the driver a pipeline is actually running — are not
/// reachable from this process, along with the other eleven members of the census below; and
/// <see cref="EdgeAgentPipelines"/> never hands its caller a driver.</para>
///
/// <para><b>What they do NOT prove:</b> that <c>St4i.EdgeService</c> is incapable of writing to a device. It
/// is not. The drivers this host builds from <c>connectors.json</c> ARE writable objects (a
/// <c>ModbusTcpDriver</c> implements <see cref="IWritableDeviceDriver"/>) — the driver IS the thing that owns
/// the port. Two things bound the residue without erasing it: a driver obtained through the registry lookup
/// is a <b>NEW</b> one, not the live one a pipeline owns, so it cannot hijack a running pipeline; and
/// obtaining it means ADDING code that constructs a driver, a visible and reviewable act rather than a cast
/// of a reference already in hand. Closing the rest is an item against
/// <see cref="ConnectorRegistry"/>, not against <c>FleetCore</c> — blueprint §11.1.</para></para>
/// </summary>
public sealed class EdgeAgentWriteSurfaceTests
{
    private static Assembly EdgeCore => typeof(EdgeAgentPipelines).Assembly;

    /// <summary>
    /// 🔴 <b>THE CENSUS: every public member of <c>FleetCore</c> that mutates the fleet, the latch, the
    /// settings, the filesystem or a device. THIRTEEN, plus one indirect (see
    /// <see cref="NothingExportedHandsOutAMachineState_WhichIsTheFOURTEENTHIndirectMutationPath"/>).</b>
    ///
    /// <para><b>E-3's own first cut of this list had EIGHT, and the two it was missing are the two that
    /// matter most.</b> The E-3 review found <c>Start</c> (<c>FleetCore.cs:1058</c>) and <c>Stop</c>
    /// (<c>:1101</c>) absent from both this array and from the report's prose. <b><c>Start</c> is the member
    /// that builds every driver and opens every port.</b> Recording that plainly rather than quietly
    /// correcting the number: E-3's central methodological argument was "I started from the SET OF MEMBERS,
    /// which is why the two the brief named were the wrong unit" — and that set was itself short by its two
    /// most consequential entries. Enumerating is not a result; it is a step you can perform badly.</para>
    ///
    /// <para>Nothing was ever unprotected: one keyword closes all fourteen, and
    /// <see cref="TheNDriverLifecycleCore_IsNotPublicApiOfStI4EdgeCore"/> guards the TYPE, not the names. This
    /// list is defence in depth against one of them being re-exposed on some OTHER public type — and it is
    /// what E-4 inherits as the statement of what is being kept out.</para>
    /// </summary>
    private static readonly string[] CensusOfMutatingMembers =
    [
        "TryWriteSetpointAsync",
        "TryInvokeCommandAsync",
        "GetMachineDriverAvailability",
        "Estop",
        "ResetEstop",
        "Start",                // 🔴 review-found. Builds every driver, opens every port.
        "Stop",                 // 🔴 review-found. Tears every one of them down.
        "RegisterMachine",
        "UpdateSettings",
        "ApplyScenario",
        "Burst",
        "RunHotFolderAoiDemoAsync",
        "SetCurrentProduct",
    ];

    /// <summary>The subset of <see cref="CensusOfMutatingMembers"/> that can be walked across the WHOLE
    /// assembly by name, because the name belongs to the fleet surface and nothing else.
    ///
    /// <para>🔴 Two names are deliberately excluded from the assembly-wide walk and the reasons are
    /// measurements, not taste. <c>ApplyMode</c> was in the first cut and the walk immediately flagged
    /// <c>St4i.EdgeCore.Transport.TransportCoordinator.ApplyMode</c> — not a fleet member at all;
    /// <c>FleetCore.ApplyMode</c> is a one-line forward to exactly that pre-existing public transport API,
    /// which this host could always reach. <c>Start</c>/<c>Stop</c> are generic enough that any future public
    /// lifecycle type in this assembly would collide with them, which would turn a red test into a rename
    /// rather than into a finding.</para>
    ///
    /// <para><b>The exclusion is not a hole, because the census above is separately CHECKED</b> against
    /// <c>FleetCore</c>'s real public surface by
    /// <see cref="TheCensusOfMutatingMembers_IsCheckedAgainstFleetCoresRealSurface_NotAssertedInProse"/> —
    /// so a name dropping out of the census is a red test, and the count is a measurement rather than a
    /// sentence.</para></summary>
    private static readonly string[] FleetOnlyNamesSafeToWalkAssemblyWide =
        CensusOfMutatingMembers.Except(["Start", "Stop"], StringComparer.Ordinal).ToArray();

    [Fact]
    public void TheAssemblyUnderTest_IsTheRealStI4EdgeCore_AndItDoesExportThings()
    {
        // Positive control. Without it every absence assertion below could pass because the walker looked at
        // the wrong assembly, or at an empty one — the exact failure mode `mutate-guard.sh`'s own header
        // calls out ("a wrong --filter, the wrong assembly ... produce a confident SURVIVED").
        Assert.Equal("St4i.EdgeCore", EdgeCore.GetName().Name);

        var exported = EdgeCore.GetExportedTypes().Select(t => t.Name).ToHashSet(StringComparer.Ordinal);
        Assert.Contains("ConnectorRegistry", exported);
        Assert.Contains("EdgePipeline", exported);
        Assert.Contains("EdgeAgentPipelines", exported);
        Assert.Contains("SimulatedDriver", exported);
    }

    [Fact]
    public void TheNDriverLifecycleCore_IsNotPublicApiOfStI4EdgeCore()
    {
        // FleetCore owns the roster, the HALT latch, the settings and the unguarded write path. E-3 made it
        // `internal`; St4i.EngineApi keeps it through the InternalsVisibleTo E-2 already added, and no other
        // host — this one, the WPF shell, or any future one — can name it.
        var fleetCore = EdgeCore.GetExportedTypes().SingleOrDefault(t => t.Name == "FleetCore");
        Assert.True(fleetCore is null,
            "FleetCore is exported from St4i.EdgeCore again. That re-opens the unguarded write path " +
            "(TryWriteSetpointAsync/TryInvokeCommandAsync consult no HALT latch) to every host that " +
            "references this assembly, including this one — see blueprint §3 and §10.6.");

        // And it really is still in there, non-public: proving the type was made internal rather than
        // deleted, which is a different change with a different meaning.
        var nonPublic = EdgeCore.GetTypes().SingleOrDefault(t => t.Name == "FleetCore");
        Assert.NotNull(nonPublic);
        Assert.False(nonPublic!.IsPublic);
    }

    [Fact]
    public void NoPublicMemberOfStI4EdgeCore_ExposesAWriteOrMutationPathIntoTheFleet()
    {
        // The enumeration: every exported type, every public member, matched against the whole forbidden set
        // — never a lookup of the two named members, which would answer "not in view" for the other ten.
        var offenders = new List<string>();

        foreach (var type in EdgeCore.GetExportedTypes())
        {
            foreach (var member in type.GetMembers(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly))
            {
                if (FleetOnlyNamesSafeToWalkAssemblyWide.Contains(member.Name, StringComparer.Ordinal))
                {
                    offenders.Add($"{type.FullName}.{member.Name}");
                }
            }
        }

        Assert.True(offenders.Count == 0,
            "St4i.EdgeCore now exports a fleet mutation/write member to every host that references it: " +
            string.Join(", ", offenders));
    }

    [Fact]
    public void TheCensusOfMutatingMembers_IsCheckedAgainstFleetCoresRealSurface_NotAssertedInProse()
    {
        // 🔴 The census is THIRTEEN. E-3 wrote EIGHT, in an argument whose whole point was that enumerating
        // beats naming — so the number gets checked here rather than restated. Every name in the census must
        // still be a public member of FleetCore; if one is renamed or removed, this goes red and whoever did
        // it updates the census, instead of the list silently drifting into fiction while still reading like
        // a complete statement of what is kept out.
        var fleetCore = EdgeCore.GetTypes().Single(t => t.Name == "FleetCore");
        var publicMembers = fleetCore
            .GetMembers(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly)
            .Select(m => m.Name)
            .ToHashSet(StringComparer.Ordinal);

        var missing = CensusOfMutatingMembers.Where(n => !publicMembers.Contains(n)).ToList();
        Assert.True(missing.Count == 0,
            "the recorded census names members FleetCore no longer has — update the census: " + string.Join(", ", missing));

        Assert.Equal(13, CensusOfMutatingMembers.Length);

        // ...and all thirteen are unreachable by the one mechanism: the declaring type is not exported.
        Assert.False(fleetCore.IsPublic);
    }

    [Fact]
    public void NothingExportedHandsOutAMachineState_WhichIsTheFOURTEENTHIndirectMutationPath()
    {
        // 🔴 The fourteenth, which is indirect and which the review named: FleetCore.TryGetMachineState hands
        // out a MachineState, and MachineState IS exported and DOES carry public mutators
        // (ApplyReading/ApplyConfigSync/ApplyConfigSyncError). So the type being nameable from this host is
        // not by itself the question — the question is whether anything can hand one over.
        var machineState = EdgeCore.GetExportedTypes().Single(t => t.Name == "MachineState");

        // Positive control for the premise: this really is a mutable, exported type. Without it the assertion
        // below could pass because MachineState turned into something harmless and nobody noticed.
        var mutators = machineState
            .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Select(m => m.Name)
            .ToHashSet(StringComparer.Ordinal);
        Assert.Contains("ApplyReading", mutators);

        // The enumeration: no exported type has a public member that can hand a caller a MachineState —
        // return type, property, field, out/ref parameter, or generic argument of any of those.
        var sources = new List<string>();
        foreach (var type in EdgeCore.GetExportedTypes())
        {
            sources.AddRange(MembersMentioning(type, machineState));
        }

        Assert.True(sources.Count == 0,
            "St4i.EdgeCore now hands a MachineState to every host that references it, which re-opens the " +
            "indirect mutation path FleetCore.TryGetMachineState is the only source of: " + string.Join(", ", sources));
    }

    [Fact]
    public void TheLifecycleThisHostDoesGet_NeverHandsBackADriver()
    {
        // EdgeAgentPipelines' own public surface, walked the same way. The caller supplies simulators and a
        // ConnectorRegistry; the drivers are built, owned and disposed inside. So this host's own code holds
        // no IDeviceDriver reference to cast to IWritableDeviceDriver.
        var leaks = DriverShapedMembers(typeof(EdgeAgentPipelines)).ToList();

        Assert.True(leaks.Count == 0,
            "EdgeAgentPipelines now exposes a driver through its public surface: " + string.Join(", ", leaks));
    }

    [Fact]
    public void TheDriverShapeWalker_CanActuallySeeADriverWhenThereIsOne()
    {
        // Positive control for the walker used by the test above — without this, that assertion would pass
        // just as happily against a walker that never matches anything. ConnectorRegistry.TryCreateDriver
        // genuinely does hand back an IDeviceDriver (through an `out` parameter, which is the shape most
        // likely to be missed), so it must be flagged.
        var seen = DriverShapedMembers(typeof(ConnectorRegistry)).ToList();

        Assert.Contains(seen, s => s.Contains("TryCreateDriver", StringComparison.Ordinal));
    }

    /// <summary>Every public member of <paramref name="type"/> whose signature mentions
    /// <see cref="IDeviceDriver"/> or <see cref="IWritableDeviceDriver"/> anywhere a caller could obtain one:
    /// a return type, a property/field type, a parameter (including <c>out</c>/<c>ref</c>, whose reflected
    /// type is a by-ref wrapper), or a generic argument of any of those.</summary>
    private static IEnumerable<string> DriverShapedMembers(Type type) => MembersMentioning(type, null);

    /// <summary>The same walk, parameterised by what it is looking for: <paramref name="target"/> when given,
    /// otherwise the two driver interfaces. Shared so the MachineState assertion and the driver assertion
    /// cannot drift in what counts as "a caller could obtain one" — the E-3 review's own lesson about a rule
    /// stated twice.</summary>
    private static IEnumerable<string> MembersMentioning(Type type, Type? target)
    {
        foreach (var member in type.GetMembers(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly))
        {
            var signature = member switch
            {
                MethodInfo m => new[] { m.ReturnType }.Concat(m.GetParameters().Select(p => p.ParameterType)),
                ConstructorInfo c => c.GetParameters().Select(p => p.ParameterType),
                PropertyInfo p => [p.PropertyType],
                FieldInfo f => [f.FieldType],
                EventInfo e when e.EventHandlerType is not null => [e.EventHandlerType],
                _ => Enumerable.Empty<Type>(),
            };

            if (signature.Any(t => Mentions(t, target)))
            {
                yield return $"{type.Name}.{member.Name}";
            }
        }
    }

    private static bool Mentions(Type t, Type? target)
    {
        if (t.IsByRef || t.IsArray || t.IsPointer)
        {
            var element = t.GetElementType();
            if (element is not null && Mentions(element, target)) return true;
        }

        if (target is null)
        {
            if (t == typeof(IDeviceDriver) || t == typeof(IWritableDeviceDriver)) return true;
        }
        else if (t == target)
        {
            return true;
        }

        return t.IsGenericType && t.GetGenericArguments().Any(a => Mentions(a, target));
    }
}
