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
/// <para>🔴 <b>THE LIMIT, STATED SO NOBODY OVER-READS THESE ASSERTIONS.</b> This does NOT prove that
/// <c>St4i.EdgeService</c> is incapable of writing to a device. It cannot: the drivers this host builds from
/// <c>connectors.json</c> ARE writable objects (a <c>ModbusTcpDriver</c> implements
/// <see cref="IWritableDeviceDriver"/>), because the driver IS the thing that owns the port, and no
/// visibility change can alter that. What is proved is narrower and is the property that actually matters:
/// <b>the machine-code → live-writable-driver ROUTING, and the two unguarded write members built on it, are
/// not reachable from this process at all</b>, and <see cref="EdgeAgentPipelines"/> — the lifecycle this
/// host does get — never hands its caller a driver to cast. Reaching a write therefore requires ADDING code
/// that builds a driver, which is a visible, reviewable act, rather than casting a reference the host
/// already holds.</para>
/// </summary>
public sealed class EdgeAgentWriteSurfaceTests
{
    private static Assembly EdgeCore => typeof(EdgeAgentPipelines).Assembly;

    /// <summary>Every member name on <c>FleetCore</c> that mutates the fleet, the latch, the settings or a
    /// device. Enumerated from that class's own public surface at E-3, not from the two the brief named —
    /// sealing only <c>TryWriteSetpointAsync</c>/<c>TryInvokeCommandAsync</c> would have left the other ten
    /// open to this host.</summary>
    private static readonly string[] ForbiddenMemberNames =
    [
        "TryWriteSetpointAsync",
        "TryInvokeCommandAsync",
        "GetMachineDriverAvailability",
        "Estop",
        "ResetEstop",
        "RegisterMachine",
        "UpdateSettings",
        "ApplyScenario",
        "Burst",
        "RunHotFolderAoiDemoAsync",
        "SetCurrentProduct",
        // 🔴 `ApplyMode` was in this list on the first cut and the enumeration immediately found
        // St4i.EdgeCore.Transport.TransportCoordinator.ApplyMode — which is NOT a fleet member at all.
        // FleetCore.ApplyMode is a one-line forward to exactly that pre-existing public transport API, which
        // this host could always reach and which switches its OWN transport mode; it is not a device write
        // and not a roster mutation. Removed on that evidence rather than exempted by an exclusion list —
        // an exclusion list is a hole in an enumeration, and the honest fix was to correct the set.
    ];

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
                if (ForbiddenMemberNames.Contains(member.Name, StringComparer.Ordinal))
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
    private static IEnumerable<string> DriverShapedMembers(Type type)
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

            if (signature.Any(MentionsADriver))
            {
                yield return $"{type.Name}.{member.Name}";
            }
        }
    }

    private static bool MentionsADriver(Type t)
    {
        if (t.IsByRef || t.IsArray || t.IsPointer)
        {
            var element = t.GetElementType();
            if (element is not null && MentionsADriver(element)) return true;
        }

        if (t == typeof(IDeviceDriver) || t == typeof(IWritableDeviceDriver)) return true;

        return t.IsGenericType && t.GetGenericArguments().Any(MentionsADriver);
    }
}
