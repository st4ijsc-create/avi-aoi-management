using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;
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
/// <para><b>Why the truth side excludes test-support assemblies by what they LINK, not where they live.</b>
/// The obvious spelling — scan <c>AppDomain.CurrentDomain.GetAssemblies()</c> — was measured first and
/// rejected: it finds twenty-odd <see cref="IConnectorFactory"/> test doubles in this very assembly
/// (<c>MapReadingFakeFactory</c>, <c>AlwaysRefusesFactory</c>, <c>ThrowingKindFactory</c>, …), several
/// reporting <c>Modbus</c>.
///
/// <para>🔴 The replacement — "walk a production anchor's closure, because a product assembly cannot
/// reference a test assembly" — was DEFEATED, and the second attack was silent: a fake reporting
/// <c>DriverKinds.Modbus</c> in <c>src/St4i.Connector.Conformance</c>, a <c>src/</c> assembly carrying an
/// xunit reference for test support, contaminated the closure and left every test here green. The
/// <c>src/</c>-versus-<c>tests/</c> convention the argument rested on is one this repository already
/// breaks. See <see cref="ExistsToSupportTests"/> for the property that replaced it and the residue it
/// still carries.</para></para>
/// </summary>
public sealed class DriverTagSupportTests
{
    // ---------------------------------------------------------------------------------------------------
    // The truth side.
    // ---------------------------------------------------------------------------------------------------

    /// <summary>
    /// 🔴 <b>The signal that an assembly exists to support TESTS, and therefore may not supply the truth
    /// side: it references a test framework.</b>
    ///
    /// <para>This replaced "the assembly is not the test assembly", which a reviewer defeated twice. The
    /// first attack added a <c>ProjectReference</c> from <c>St4i.EngineApi</c> to
    /// <c>St4i.EdgeCore.Tests</c>; that reddened, but only by luck — those doubles report exotic kinds, so
    /// direction 2 caught them and direction 1 would not have. The second attack was SILENT: a fake
    /// reporting <c>DriverKinds.Modbus</c> placed in <c>src/St4i.Connector.Conformance</c> — a
    /// <c>src/</c> assembly that carries an xunit <c>PackageReference</c> for test support — left all
    /// eighteen tests in this file green, <c>Assert.DoesNotContain</c> included. The old defence rested on
    /// a location convention (<c>src/</c> versus <c>tests/</c>) that this repository already breaks.</para>
    ///
    /// <para><b>Why this signal and not a name.</b> It is a property of what the assembly IS rather than
    /// where it sits or what it is called: an assembly that links a test framework is one whose types exist
    /// to be exercised, and a factory declared there is a fixture whatever its namespace. Measured against
    /// this tree, <c>src/St4i.Connector.Conformance</c> is the ONE <c>src/</c> assembly it excludes — the
    /// exact hole the second attack used. It is not a perfect oracle (a double in a framework-free helper
    /// assembly would still pass) and <c>TheReflectedFactoryPopulation_…</c> below states that residue
    /// rather than implying none exists.</para>
    /// </summary>
    private static bool ExistsToSupportTests(Assembly assembly) =>
        assembly.GetReferencedAssemblies().Any(r =>
            r.Name is { } name &&
            (name.StartsWith("xunit", StringComparison.OrdinalIgnoreCase) ||
             name.StartsWith("nunit", StringComparison.OrdinalIgnoreCase) ||
             name.StartsWith("Microsoft.VisualStudio.TestPlatform", StringComparison.OrdinalIgnoreCase) ||
             name.StartsWith("MSTest", StringComparison.OrdinalIgnoreCase)));

    /// <summary>
    /// Every product assembly reachable from this test run — the anchor's reference closure UNIONED with
    /// every <c>St4i*.dll</c> beside the test binary, minus everything that exists to support tests.
    ///
    /// <para>🔴 <b>The union closes LOW-7.</b> A single anchor's closure sees only what that anchor
    /// references, so a factory in a product assembly the anchor does not reference would be invisible and
    /// BOTH directional tests would pass vacuously about it. The deployed-directory scan catches assemblies
    /// the closure walk misses; the source census in <c>EveryConnectorFactoryDeclaredInSrc_…</c> catches
    /// what neither sees.</para>
    /// </summary>
    private static IReadOnlyList<Assembly> ProductAssemblies()
    {
        var found = new HashSet<Assembly>();

        void Walk(Assembly assembly)
        {
            if (!found.Add(assembly)) return;
            foreach (var reference in assembly.GetReferencedAssemblies()
                         .Where(r => r.Name!.StartsWith("St4i", StringComparison.Ordinal)))
            {
                try { Walk(Assembly.Load(reference)); }
                catch (Exception ex) when (ex is FileNotFoundException or BadImageFormatException) { }
            }
        }

        Walk(typeof(DriverTagSupport).Assembly);

        foreach (var dll in Directory.EnumerateFiles(AppContext.BaseDirectory, "St4i*.dll"))
        {
            try { Walk(Assembly.LoadFrom(dll)); }
            catch (Exception ex) when (ex is FileNotFoundException or BadImageFormatException) { }
        }

        return found.Where(a => !ExistsToSupportTests(a)).ToList();
    }

    /// <summary>
    /// Every concrete <see cref="IConnectorFactory"/> this PRODUCT ships.
    /// </summary>
    private static IReadOnlyList<Type> ShippedFactoryTypes() =>
        ProductAssemblies()
            .SelectMany(a => a.GetTypes())
            .Where(t => typeof(IConnectorFactory).IsAssignableFrom(t)
                        && t is { IsAbstract: false, IsInterface: false, IsGenericTypeDefinition: false })
            .Distinct()
            .OrderBy(t => t.FullName, StringComparer.Ordinal)
            .ToList();

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

        // No assembly supplying the truth side may be one that exists to support tests. Asserted as the
        // PROPERTY over the whole population rather than as "the test assembly is absent", which was a list
        // of one and had the same weakness as a count — it named the contaminant a reviewer had already
        // used instead of the class it belongs to, and the second attack simply used a different assembly.
        var contaminated = ProductAssemblies().Where(ExistsToSupportTests).Select(a => a.GetName().Name).ToList();
        Assert.True(contaminated.Count == 0,
            "these assemblies supplied the truth side and link a test framework, so a fixture in one of them " +
            $"can decide what this product 'ships': {string.Join(", ", contaminated)}.");

        // 🔴 The residue, stated rather than implied: this excludes assemblies that LINK a test framework.
        // A double declared in a product assembly that links none would still enter. Nothing here detects
        // that, and the census below is what would catch it arriving in src/.
    }

    /// <summary>
    /// The de-duplication, split out of the non-emptiness guard above because it is a different claim
    /// (LOW-9). The population is 3 types collapsing to 2 kinds, and that collapse is load-bearing:
    /// <c>ModbusConnectorFactory</c> (TCP) and <c>ModbusRtuConnectorFactory</c> (RS-485) both report
    /// <c>DriverKinds.Modbus</c> — one id for the protocol, not one per transport. It lived inside
    /// <c>TheReflectedFactoryPopulation_IsNonEmpty_…</c>, where deleting a Modbus factory reddened a test
    /// whose NAME says it is about the empty set, sending the next reader to the wrong question.
    ///
    /// <para>Does not measure: which transports exist — only that at least two shipped factory types agree
    /// on one kind id, which is what a de-duplication bug in the helper would break.</para>
    /// </summary>
    [Fact]
    public void TwoShippedFactoryTypesShareOneKindId_SoTheHelperMustDeduplicate()
    {
        var types = ShippedFactoryTypes();
        var kinds = ShippedFactoryKinds();

        Assert.True(types.Count > kinds.Count,
            $"expected the shipped factory types ({types.Count}) to outnumber the distinct kinds they report " +
            $"({kinds.Count}), because two Modbus transports share one kind id.");
    }

    /// <summary>
    /// 🔴 <b>LOW-7 — the census that catches a factory reflection cannot see.</b> Both directional tests
    /// are quantified over the REFLECTED population, so a factory in a product assembly this test project
    /// does not reference is invisible and both directions pass vacuously about it. This walks
    /// <c>src/</c> instead and requires every declared implementation to be one the reflected set found.
    ///
    /// <para>Does not measure: whether a type it finds is CORRECT — only that it is visible. A factory
    /// declared in a test-support assembly is excluded from BOTH sides by the same rule
    /// (<see cref="ExistsToSupportTests"/>), so the two sides cannot disagree merely about fixtures.</para>
    /// </summary>
    [Fact]
    public void EveryConnectorFactoryDeclaredInSrc_IsOneTheReflectedPopulationCanSee()
    {
        var srcRoot = Path.Combine(MachineSimulatorRoot(), "src");
        var declaration = new Regex(
            @"^\s*(?:public|internal)\s+(?:sealed\s+)?(?:partial\s+)?class\s+(?<name>\w+)\s*:\s*[^{]*\bIConnectorFactory\b",
            RegexOptions.Multiline);

        var testSupportProjects = Directory
            .EnumerateFiles(srcRoot, "*.csproj", SearchOption.AllDirectories)
            .Where(p => File.ReadAllText(p).Contains("xunit", StringComparison.OrdinalIgnoreCase))
            .Select(p => Path.GetDirectoryName(p)!)
            .ToList();

        var declaredInSrc = Directory
            .EnumerateFiles(srcRoot, "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
            .Where(f => !testSupportProjects.Any(d => f.StartsWith(d + Path.DirectorySeparatorChar, StringComparison.Ordinal)))
            .SelectMany(f => declaration.Matches(File.ReadAllText(f)).Select(m => m.Groups["name"].Value))
            .Distinct(StringComparer.Ordinal)
            .OrderBy(n => n, StringComparer.Ordinal)
            .ToList();

        Assert.NotEmpty(declaredInSrc);

        var reflected = ShippedFactoryTypes().Select(t => t.Name).ToHashSet(StringComparer.Ordinal);
        var invisible = declaredInSrc.Where(n => !reflected.Contains(n)).ToList();

        Assert.True(invisible.Count == 0,
            $"these IConnectorFactory implementations are declared in src/ but the reflected population " +
            $"cannot see them: {string.Join(", ", invisible)}. Both directional tests are therefore silent " +
            "about them. Add a reference so this test project can load the assembly, or move the factory.");

        // 🔴 THE OTHER DIRECTION, and its absence was a real hole. This census asked only src → reflected,
        // so an assembly belonging to NO csproj and NO source file — `St4i.Ghost2.dll`, built elsewhere and
        // dropped into the test output directory — was admitted to the truth side and this test, named in
        // every document as the backstop, PASSED. One-directional, like everything else this workstream has
        // had to fix. A shipped factory must correspond to a type declared in src/; if it does not, nothing
        // in this repository can review the code that is deciding what the product "ships".
        var unaccounted = ShippedFactoryTypes()
            .Where(t => !declaredInSrc.Contains(t.Name, StringComparer.Ordinal))
            .Select(t => $"{t.Assembly.GetName().Name}::{t.FullName}")
            .ToList();

        Assert.True(unaccounted.Count == 0,
            "these IConnectorFactory implementations are supplying the truth side but are declared in NO " +
            $"source file under src/: {string.Join(", ", unaccounted)}. An assembly that belongs to no " +
            "project in this repository must not decide what this product ships — it cannot be reviewed, " +
            "and it is exactly how a stale or hand-dropped DLL contaminates the population.");
    }

    private static string MachineSimulatorRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "README.md")) &&
                File.Exists(Path.Combine(dir.FullName, "fleet.json")) &&
                Directory.Exists(Path.Combine(dir.FullName, "src")))
            {
                return dir.FullName;
            }

            dir = dir.Parent;
        }

        throw new InvalidOperationException(
            "Could not locate tools/machine-simulator (README.md + fleet.json + src/) by walking up from " +
            $"\"{AppContext.BaseDirectory}\". Fix this walk — do NOT weaken the assertion above to make the " +
            "census findable.");
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
    // 🔴 LOW-6 — a NON-canonical spelling, which every other row lacked. `fleet.json` has always accepted
    // any casing, so "modbus" is an ordinary connectors.json value; without this row, deleting the fold at
    // ConnectorsConfig's dispatch leaves CanBack("modbus") answering true for a connector the real dispatch
    // SKIPPED, and the two sides disagree with the whole theory still green. Same defect class as Task 2's
    // B6, found by the same reasoning and closed with one row.
    [InlineData("modbus")]
    [InlineData("OpcUA")]
    [InlineData(DriverKinds.Mqtt)]
    [InlineData(DriverKinds.HotFolderAoi)]
    [InlineData(DriverKinds.Simulated)]
    [InlineData("vendor.acme.weld")]
    public void CanBack_AgreesWithWhetherTheRealDispatchCanActuallyBuildAConnectorOfThatKind(string kind)
    {
        // The template this is copied from (St4i.EdgeCore.Tests/UnconsumedConfigKindsTests) does not stop at
        // comparing two tables: it drives the REAL SimulatorFactory and observes whether the store it was
        // handed was ever reached. The equivalent observation here is whether the real connectors.json
        // path can construct a factory for this kind and get it into a registry. Reflection alone would
        // only prove a type with that Kind exists somewhere in the closure; this proves the production path
        // that turns an operator's config into a live connector reaches it.
        //
        // 🔴 LOW-6 — this goes through ConnectorsConfig.Load, not straight to RegisterAll with a
        // hand-built entry. The kind an operator TYPES is folded exactly once, by
        // `DriverKinds.Normalize(kind)` inside Load (ConnectorsConfig.cs:190); the dispatch downstream
        // switches on the already-canonical value. Constructing ConnectorConfigEntry directly skipped that
        // fold, so the two non-canonical rows above failed against a path production never takes — and,
        // worse, deleting the fold would have left every row green. Load takes an explicit path, so this
        // writes a temp file rather than touching AppContext.BaseDirectory, the shared artifact directory
        // this assembly's D-1 review (I-3) records as racing the whole suite.
        var configPath = Path.Combine(Path.GetTempPath(), "st4i-tagsupport", Guid.NewGuid().ToString("N"), "connectors.json");
        Directory.CreateDirectory(Path.GetDirectoryName(configPath)!);
        var registry = new ConnectorRegistry();
        int registered;
        try
        {
            File.WriteAllText(configPath,
                $$"""[ { "id": "tag-support-probe", "kind": "{{kind}}", "settings": {{Settings}} } ]""");

            var entries = ConnectorsConfig.Load(configPath, logWarning: _ => { });

            registered = ConnectorsJsonRegistration.RegisterAll(
                entries,
                new ModbusOptions { Enabled = true, Host = "127.0.0.1", Port = 15020 },
                new OpcUaOptions(),
                registry,
                NullLogger.Instance);
        }
        finally
        {
            try { Directory.Delete(Path.GetDirectoryName(configPath)!, recursive: true); } catch (IOException) { }
        }

        var theDispatchBuiltAConnector = registered == 1;

        Assert.Equal(DriverTagSupport.CanBack(kind), theDispatchBuiltAConnector);

        // Registering is the observable, but an empty registry alongside registered==1 would mean the count
        // and the effect had come apart — assert the side effect too, the way the template asserts the store
        // was reached rather than trusting the factory's return value.
        Assert.Equal(theDispatchBuiltAConnector, registry.RegisteredIds.Count == 1);
    }

    /// <summary>
    /// 🔴 <b>The same behavioural check, QUANTIFIED over <see cref="DriverTagSupport.DeclaredKinds"/>
    /// instead of listed — the fix for the contamination route the eight hand-written rows above left
    /// open.</b>
    ///
    /// <para>A reviewer added an <c>IConnectorFactory</c> reporting <c>"vendor.ghost.press"</c> to
    /// <c>src/St4i.EngineApi</c> — a product assembly linking no test framework, so
    /// <see cref="ExistsToSupportTests"/> does not exclude it — and added that kind to
    /// <c>DeclaredKinds</c>. Everything stayed green: the reflected truth side saw the factory, so both
    /// directional tests agreed, and the behavioural theory never noticed because <b>it only ever asks
    /// about kinds someone typed into an <c>[InlineData]</c></b>. A list was standing where a property
    /// belongs, which is the shape this workstream keeps finding.</para>
    ///
    /// <para>This asserts the property directly: <b>EVERY kind this build declares backable must be one the
    /// real <c>connectors.json</c> path can actually build a connector for.</b> A declared kind whose only
    /// factory is a fake now fails here, because the fake is not reachable from the dispatch — it is not in
    /// <c>ConnectorsJsonRegistration</c>'s switch, and nothing can put it there without a code change that
    /// this test then measures.</para>
    ///
    /// <para>Does not measure: kinds that are NOT declared — the reverse direction is
    /// <c>EveryKindAShippedConnectorFactoryReports_IsDeclared</c>'s job, and the non-emptiness guard below
    /// keeps this from passing over an empty list.</para>
    /// </summary>
    /// <summary>Kind-appropriate settings that are known to BUILD a driver. Test data — see the loop.</summary>
    private static readonly Dictionary<string, string> BuildableSettings = new(StringComparer.Ordinal)
    {
        [DriverKinds.Modbus] = Settings,
        [DriverKinds.OpcUa] = """
            {
              "machineCode": "CJ-TAGSUPPORT-01",
              "endpointUrl": "opc.tcp://127.0.0.1:4840",
              "pollIntervalMs": 50,
              "nodes": [ { "nodeId": "ns=2;s=Temperature", "metric": "temperature", "unit": "C" } ]
            }
            """,
    };

    [Fact]
    public void EveryDeclaredKind_CanActuallyBeBuiltByTheRealDispatch_NotJustTheOnesSomebodyListed()
    {
        Assert.NotEmpty(DriverTagSupport.DeclaredKinds);

        var unbuildable = new List<string>();

        foreach (var kind in DriverTagSupport.DeclaredKinds)
        {
            // Building a connector needs kind-APPROPRIATE settings — that is inherent, not a shortcut: a
            // Modbus blob cannot produce an OPC-UA driver. This table is TEST DATA, not a second truth
            // side; a declared kind with no entry fails below rather than being skipped, which is what
            // forces whoever declares a new kind to demonstrate that a driver can be built for it.
            if (!BuildableSettings.TryGetValue(kind, out var settings))
            {
                unbuildable.Add($"{kind} (no sample settings in this test — add one, and if you cannot " +
                                "write settings that build a driver, the kind does not belong in DeclaredKinds)");
                continue;
            }

            var configPath = Path.Combine(
                Path.GetTempPath(), "st4i-tagsupport-q", Guid.NewGuid().ToString("N"), "connectors.json");
            Directory.CreateDirectory(Path.GetDirectoryName(configPath)!);
            var registry = new ConnectorRegistry();
            try
            {
                File.WriteAllText(configPath,
                    $$"""[ { "id": "quantified-probe", "kind": "{{kind}}", "settings": {{settings}} } ]""");

                var registered = ConnectorsJsonRegistration.RegisterAll(
                    ConnectorsConfig.Load(configPath, logWarning: _ => { }),
                    new ModbusOptions { Enabled = true, Host = "127.0.0.1", Port = 15020 },
                    new OpcUaOptions(),
                    registry,
                    NullLogger.Instance);

                if (registered != 1 || registry.RegisteredIds.Count != 1)
                {
                    unbuildable.Add($"{kind} (no dispatch arm)");
                }
                // 🔴 F-4 — REGISTERING IS NOT BUILDING, and this test's name claimed the stronger thing.
                // ConnectorRegistry.Register never calls IConnectorFactory.TryCreate: it normalises Kind and
                // writes a dictionary entry. So a factory whose TryCreate returns false unconditionally
                // registers perfectly, and this test used to pass while NOTHING in the build could construct
                // a driver for that kind — CanBack answering true for a kind that can never read anything.
                // TryCreateDriver is the call that actually asks the factory.
                else if (!registry.TryCreateDriver(registry.RegisteredIds[0], out _, out var driverError))
                {
                    unbuildable.Add($"{kind} (dispatch arm exists, but TryCreate refused: {driverError})");
                }
            }
            finally
            {
                try { Directory.Delete(Path.GetDirectoryName(configPath)!, recursive: true); } catch (IOException) { }
            }
        }

        Assert.True(unbuildable.Count == 0,
            $"DriverTagSupport.DeclaredKinds says a tag may be backed by {string.Join(", ", unbuildable)}, but the " +
            "real connectors.json path builds no connector for those kinds — so CanBack answers true for a kind " +
            "this product cannot actually read. If a factory for it exists, it is not reachable from " +
            "ConnectorsJsonRegistration's dispatch; if the factory is a test fixture, it does not belong in src/.");
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
