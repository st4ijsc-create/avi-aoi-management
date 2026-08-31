using System.Reflection;
using System.Runtime.CompilerServices;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Config;
using St4i.EdgeCore.Drivers.Modbus;
using St4i.EdgeCore.Drivers.OpcUa;
using St4i.EdgeCore.Fleet;
using St4i.EngineApi.Config;
using St4i.EngineApi.HmiModel;
using Xunit;

namespace St4i.EngineApi.Tests.HmiModel;

/// <summary>
/// WS-HMI-0c Task 3 — the pair of tests that stop <see cref="DriverTagSupport.DeclaredKinds"/> from being a
/// hand-written list that quietly stops matching the product.
///
/// <para><b>The trap being defended against, stated once.</b> The blueprint's lesson block records that
/// <c>dispense_program</c> and <c>weld_profile</c> were declared, domain-checked, persisted and served —
/// and no simulator read them. Nothing was broken; a thing was simply never connected, and every
/// mechanical signal (build, lint, tests, a real HTTP 200) stayed green throughout. <c>isBackedByDriver</c>
/// is the same shape: a hand-written kind list would keep answering confidently long after the factory
/// population moved underneath it. So this file derives a TRUTH side by reflection and holds the declared
/// side against it in <b>both directions</b> — a declared kind with no factory, and a factory whose kind is
/// undeclared, are each a failing test.</para>
///
/// <para><b>Why the truth side is anchored on a production assembly.</b> The obvious spelling —
/// scan <c>AppDomain.CurrentDomain.GetAssemblies()</c> — was measured first and rejected: it finds
/// twenty-odd <see cref="IConnectorFactory"/> test doubles in this very assembly
/// (<c>MapReadingFakeFactory</c>, <c>AlwaysRefusesFactory</c>, <c>ThrowingKindFactory</c>, …), several
/// reporting <c>Modbus</c>, so the truth side would have been contaminated by the tests that are supposed
/// to be checking it. Walking the reference closure of a PRODUCTION anchor instead is structural rather
/// than nominal: a product assembly cannot reference a test assembly, so no double can enter, and the rule
/// needs no ".Tests" name matching to maintain.</para>
/// </summary>
public sealed class DriverTagSupportTests
{
    // ---------------------------------------------------------------------------------------------------
    // The truth side.
    // ---------------------------------------------------------------------------------------------------

    /// <summary>
    /// Every concrete <see cref="IConnectorFactory"/> this PRODUCT ships, found by walking the reference
    /// closure of the assembly that owns the kind→factory dispatch.
    /// </summary>
    private static IReadOnlyList<Type> ShippedFactoryTypes()
    {
        var closure = new HashSet<Assembly>();

        void Walk(Assembly assembly)
        {
            if (!closure.Add(assembly)) return;
            foreach (var reference in assembly.GetReferencedAssemblies()
                         .Where(r => r.Name!.StartsWith("St4i", StringComparison.Ordinal)))
            {
                try { Walk(Assembly.Load(reference)); }
                catch (Exception ex) when (ex is FileNotFoundException or BadImageFormatException) { }
            }
        }

        // The anchor is the assembly under test, which is also the one holding RegisterAll's dispatch.
        Walk(typeof(DriverTagSupport).Assembly);

        Assert.DoesNotContain(typeof(DriverTagSupportTests).Assembly, closure);

        return closure
            .SelectMany(a => a.GetTypes())
            .Where(t => typeof(IConnectorFactory).IsAssignableFrom(t)
                        && t is { IsAbstract: false, IsInterface: false, IsGenericTypeDefinition: false })
            .OrderBy(t => t.FullName, StringComparer.Ordinal)
            .ToList();
    }

    /// <summary>
    /// The <see cref="IConnectorFactory.Kind"/> each shipped factory REPORTS — read off the property, never
    /// inferred from a type name.
    ///
    /// <para>None of the three shipped factories has a parameterless constructor (they take options, logging
    /// callbacks, a bus registry), so they cannot be <c>Activator.CreateInstance</c>d here. Their <c>Kind</c>
    /// getters are constant expressions over <see cref="DriverKinds"/> that touch no instance state, so the
    /// value is read off an uninitialized instance. If that ever stops being true — a getter that reads a
    /// field would return <see langword="null"/> or throw — this method FAILS rather than skipping the type,
    /// because a truth side that silently drops a factory is exactly the vacuous pass this file exists to
    /// prevent.</para>
    /// </summary>
    private static IReadOnlyList<string> ShippedFactoryKinds()
    {
        var kinds = new List<string>();

        foreach (var type in ShippedFactoryTypes())
        {
            string? kind;
            try
            {
                kind = ((IConnectorFactory)RuntimeHelpers.GetUninitializedObject(type)).Kind;
            }
            catch (Exception ex)
            {
                Assert.Fail(
                    $"the Kind getter on shipped factory {type.FullName} threw {ex.GetType().Name}, so this " +
                    "test can no longer measure the kind it reports. Give the factory a constructor this " +
                    "helper can call, or read the kind some other way — do NOT infer it from the type name, " +
                    "and do not let it be skipped.");
                return kinds;
            }

            Assert.False(string.IsNullOrWhiteSpace(kind),
                $"shipped factory {type.FullName} reported a blank Kind off an uninitialized instance, which " +
                "means its getter now reads instance state. See the message above: it must not be skipped.");

            kinds.Add(kind!);
        }

        return kinds.Distinct(StringComparer.Ordinal).OrderBy(k => k, StringComparer.Ordinal).ToList();
    }

    // ---------------------------------------------------------------------------------------------------
    // Direction 1 — a declared kind with nothing shipped behind it.
    // ---------------------------------------------------------------------------------------------------

    [Fact]
    public void EveryDeclaredKind_IsAKindSomeShippedConnectorFactoryActuallyReports()
    {
        var shipped = ShippedFactoryKinds();

        var declaredWithNoFactory = DriverTagSupport.DeclaredKinds
            .Where(k => !shipped.Contains(k, StringComparer.Ordinal))
            .ToList();

        Assert.True(declaredWithNoFactory.Count == 0,
            $"DriverTagSupport.DeclaredKinds names {string.Join(", ", declaredWithNoFactory)}, but no connector " +
            $"factory this product ships reports that kind (shipped kinds: {string.Join(", ", shipped)}). A tag " +
            "whose source names such a kind would be reported as driver-backed while nothing in this build can " +
            "construct a connector to read it — the exact false claim DriverTagSupport exists to prevent.");
    }

    // ---------------------------------------------------------------------------------------------------
    // Direction 2 — a shipped factory whose kind nobody declared.
    // ---------------------------------------------------------------------------------------------------

    [Fact]
    public void EveryKindAShippedConnectorFactoryReports_IsDeclared()
    {
        var undeclared = ShippedFactoryKinds()
            .Where(k => !DriverTagSupport.DeclaredKinds.Contains(k, StringComparer.Ordinal))
            .ToList();

        Assert.True(undeclared.Count == 0,
            $"this product ships a connector factory reporting kind {string.Join(", ", undeclared)}, which " +
            "DriverTagSupport.DeclaredKinds does not list. Tags backed by that kind are being reported as NOT " +
            "driver-backed. If the new kind reads by address, add it to DeclaredKinds; if it does not (the way " +
            "Mqtt subscribes to a topic and HotFolderAoi parses dropped documents), say so in DriverTagSupport's " +
            "doc comment and add the exclusion here — do not simply widen the list to make this green.");
    }

    // ---------------------------------------------------------------------------------------------------
    // Direction 3 — the anti-vacuity guard. Both tests above pass trivially against an empty truth side.
    // ---------------------------------------------------------------------------------------------------

    [Fact]
    public void TheReflectedFactoryPopulation_IsNonEmpty_SoTheTwoDirectionsAboveAreNotVacuous()
    {
        var types = ShippedFactoryTypes();
        var kinds = ShippedFactoryKinds();

        // Without this, a reflection query that silently stopped matching (a renamed interface, an anchor
        // whose closure no longer reaches St4i.EdgeCore, a trimmed publish) would turn both directional
        // tests into assertions about the empty set — green, and measuring nothing.
        Assert.True(types.Count > 0,
            "reflection over the production assembly closure found NO IConnectorFactory implementations, so " +
            "the two directional tests above are asserting about an empty set and are measuring nothing.");

        Assert.True(kinds.Count > 0,
            $"found {types.Count} shipped factory types but zero readable kinds among them.");

        // The population is 3 types collapsing to 2 kinds, and that collapse is load-bearing rather than
        // incidental: ModbusConnectorFactory (TCP) and ModbusRtuConnectorFactory (RS-485) both report
        // DriverKinds.Modbus — one id for the protocol, not one per transport. Asserting types > kinds keeps
        // a future de-duplication bug in the helper (returning types instead of distinct kinds) visible.
        Assert.True(types.Count > kinds.Count,
            $"expected the shipped factory types ({types.Count}) to outnumber the distinct kinds they report " +
            $"({kinds.Count}), because two Modbus transports share one kind id.");
    }

    // ---------------------------------------------------------------------------------------------------
    // Direction 4 — the behavioural half, copied deliberately from UnconsumedConfigKindsTests.
    // ---------------------------------------------------------------------------------------------------

    /// <summary>
    /// The settings blob every row below uses — the SAME one for all five kinds, which is what makes this a
    /// controlled experiment rather than five unrelated observations. The only thing that varies across rows
    /// is the kind string, so a row that fails to register cannot be explained away by its blob.
    ///
    /// <para>An unparseable-for-that-kind blob does not by itself prevent registration: the dispatch
    /// validates only to learn the machine code to bind to, and an entry whose blob will not validate still
    /// registers UNBOUND. So the OPC-UA row registering on a Modbus-shaped blob is expected, and is itself
    /// evidence that the kind — not the blob — is what the negative rows are failing on.</para>
    /// </summary>
    private const string Settings = """
        {
          "machineCode": "CJ-TAGSUPPORT-01",
          "unitId": 1,
          "pollIntervalMs": 50,
          "registers": [
            { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "temperature", "unit": "C" }
          ]
        }
        """;

    [Theory]
    [InlineData(DriverKinds.Modbus)]
    [InlineData(DriverKinds.OpcUa)]
    [InlineData(DriverKinds.Mqtt)]
    [InlineData(DriverKinds.HotFolderAoi)]
    [InlineData(DriverKinds.Simulated)]
    [InlineData("vendor.acme.weld")]
    public void CanBack_AgreesWithWhetherTheRealDispatchCanActuallyBuildAConnectorOfThatKind(string kind)
    {
        // The template this is copied from (St4i.EdgeCore.Tests/UnconsumedConfigKindsTests) does not stop at
        // comparing two tables: it drives the REAL SimulatorFactory and observes whether the store it was
        // handed was ever reached. The equivalent observation here is whether the real connectors.json
        // dispatch can construct a factory for this kind and get it into a registry. Reflection alone would
        // only prove a type with that Kind exists somewhere in the closure; this proves the production path
        // that turns an operator's config into a live connector reaches it.
        var registry = new ConnectorRegistry();

        var registered = ConnectorsJsonRegistration.RegisterAll(
            new[] { new ConnectorConfigEntry("tag-support-probe", kind, Settings) },
            new ModbusOptions { Enabled = true, Host = "127.0.0.1", Port = 15020 },
            new OpcUaOptions(),
            registry,
            NullLogger.Instance);

        var theDispatchBuiltAConnector = registered == 1;

        Assert.Equal(DriverTagSupport.CanBack(kind), theDispatchBuiltAConnector);

        // Registering is the observable, but an empty registry alongside registered==1 would mean the count
        // and the effect had come apart — assert the side effect too, the way the template asserts the store
        // was reached rather than trusting the factory's return value.
        Assert.Equal(theDispatchBuiltAConnector, registry.RegisteredIds.Count == 1);
    }

    // ---------------------------------------------------------------------------------------------------
    // CanBack's own behaviour. The four tests above pin the LIST; these pin what CanBack does with it.
    // ---------------------------------------------------------------------------------------------------

    [Theory]
    [InlineData("modbus")]
    [InlineData("MODBUS")]
    [InlineData(" Modbus ")]
    [InlineData("opcua")]
    [InlineData("OPCUA")]
    public void CanBack_FoldsCasingAndWhitespace_TheSameWayEveryOtherBuiltInComparisonInThisCodebaseDoes(string kind)
    {
        // fleet.json has always accepted any casing for driverKind, and DriverKinds.Normalize is the ONE
        // place that decision is made. If CanBack compared the raw string instead, a perfectly ordinary
        // lowercase "modbus" would report an addressable tag as unbacked.
        Assert.True(DriverTagSupport.CanBack(kind));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void CanBack_FailsClosedOnAMissingKind(string? kind)
    {
        // Fail CLOSED: the harmful direction is telling an operator a fabricated or absent number is real.
        Assert.False(DriverTagSupport.CanBack(kind));
    }

    [Fact]
    public void CanBack_IsNotTheSameQuestionAsIsFabricated()
    {
        // The cheap-looking reuse this task must not make. DriverKinds.IsFabricated already exists and is
        // false for Mqtt and HotFolderAoi — both are real drivers talking to real machines. Neither is
        // ADDRESSABLE: one delivers whatever a broker publishes on a topic, the other parses documents a
        // machine drops in a folder. If someone "simplifies" CanBack to !IsFabricated, this reddens.
        foreach (var kind in new[] { DriverKinds.Mqtt, DriverKinds.HotFolderAoi })
        {
            Assert.False(DriverKinds.IsFabricated(kind));
            Assert.False(DriverTagSupport.CanBack(kind));
        }

        // And the two predicates do agree about Simulated — for different reasons, which is why the
        // agreement is not evidence they are one question.
        Assert.True(DriverKinds.IsFabricated(DriverKinds.Simulated));
        Assert.False(DriverTagSupport.CanBack(DriverKinds.Simulated));
    }
}
