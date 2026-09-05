using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using St4i.EngineApi.HmiModel;
// See HmiModelWiringTests' own note: this using exists so [Collection(...)] below can be written in the
// SHORT form every other WebApplicationFactory<Program>-booting class in this assembly uses, because
// grep-findability is the entire defence for collection membership.
using St4i.EngineApi.Tests.Auth;
using Xunit;

namespace St4i.EngineApi.Tests.HmiModel;

/// <summary>
/// WS-HMI-0c Task 4 — the composition root half, which <c>TagIngestionServiceTests</c> deliberately does
/// not cover: that the service DI hands out is built around the CANONICALIZING store (ruling S-3), and that
/// the tag-map directory constant is the one the startup wiring reads.
///
/// <para>🔴 <b>Two clauses of the list below were RETRACTED once tag maps moved machine-wide; kept verbatim
/// because each was an argument that something could not be tested, and both turned out to be wrong.</b>
/// (1) said this file <i>"does NOT run the startup ingestion loop against real files — the default tag-map
/// directory is deliberately absent in every build output, and a test that created it would write into
/// <c>AppContext.BaseDirectory</c>, the one shared artifact directory this assembly's own D-1 review (I-3)
/// records as racing the whole suite"</i>. It DOES now:
/// <c>Startup_ingests_a_tag_map_for_a_machine_a_connector_is_actually_bound_to</c> writes a map into a
/// redirected <c>ST4I_HMI_TAGMAPS_DIR</c> and asserts the namespace appears. (2) said the swallow <i>"in
/// <c>Program.cs</c>"</i> could not be measured — the swallows are in <c>TagIngestionService.cs</c>, not
/// <c>Program.cs</c>, and BOTH are pinned in <c>TagIngestionServiceTests</c>.</para>
///
/// <para><b>What this file does NOT measure:</b> (3) it does NOT measure
/// ingestion behaviour at all — every proposition about parsing, §5, identity and replacement is
/// <c>TagIngestionServiceTests</c>' subject, against a real store.</para>
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class TagIngestionWiringTests
{
    private static readonly SemaphoreSlim EnvLock = new(1, 1);

    /// <summary>Same force-Production, eager-build idiom <c>HmiModelWiringTests.CreateFactoryAsync</c>
    /// documents at length — duplicated for the same reason it duplicates it from the auth tests.</summary>
    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync(
        IReadOnlyDictionary<string, string?>? environment = null)
    {
        await EnvLock.WaitAsync().ConfigureAwait(false);
        var previous = new Dictionary<string, string?>
        {
            ["ASPNETCORE_ENVIRONMENT"] = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT"),
        };
        foreach (var key in environment?.Keys ?? Enumerable.Empty<string>())
        {
            previous[key] = Environment.GetEnvironmentVariable(key);
        }

        try
        {
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Production");
            foreach (var (key, value) in environment ?? new Dictionary<string, string?>())
            {
                Environment.SetEnvironmentVariable(key, value);
            }

            var factory = new WebApplicationFactory<Program>();
            _ = factory.Server; // build NOW, while the overrides are live
            return factory;
        }
        finally
        {
            // Restored in ALL cases, so a host booted with a Modbus connector cannot leak that configuration
            // into the next test in this collection.
            foreach (var (key, value) in previous) Environment.SetEnvironmentVariable(key, value);
            EnvLock.Release();
        }
    }

    /// <summary>
    /// <b>Ruling S-3.</b> The store the ingestion service resolves with must be the canonicalising
    /// decorator, never the raw <c>TagNamespaceStore</c>. Asserted on the resolved OBJECT rather than on
    /// the registration expression, because what matters is what the service actually holds — a factory
    /// lambda that looked right and closed over the raw store would satisfy a source-text check and fail
    /// this one.
    ///
    /// <para>Does not measure: that <c>CanonicalizingTagNamespaceStore</c> canonicalises correctly — that
    /// is <c>CanonicalMachineCodeStoresTests</c>, six directions of it.</para>
    /// </summary>
    [Fact]
    public async Task The_ingestion_service_resolves_around_the_canonicalizing_store_never_the_raw_one()
    {
        await using var factory = await CreateFactoryAsync();

        var resolved = factory.Services.GetRequiredService<ITagNamespaceStore>();
        Assert.IsType<CanonicalizingTagNamespaceStore>(resolved);

        // The service itself is resolvable, and resolving it twice yields the one singleton — so the
        // startup loop and any future consumer cannot end up writing through two different stores.
        var service = factory.Services.GetRequiredService<TagIngestionService>();
        Assert.NotNull(service);
        Assert.Same(service, factory.Services.GetRequiredService<TagIngestionService>());

        // The store the service was actually constructed with. There is exactly one constructor taking
        // exactly one ITagNamespaceStore (pinned in TagIngestionServiceTests), so the single private field
        // of that type is the one DI supplied.
        var storeField = Assert.Single(
            typeof(TagIngestionService)
                .GetFields(System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic),
            f => typeof(ITagNamespaceStore).IsAssignableFrom(f.FieldType));

        // 🔴 IDENTITY, not type. Asserting `IsType<CanonicalizingTagNamespaceStore>` was satisfied by ANY
        // canonicalising store — including a second one over a DIFFERENT directory. Measured: replacing
        // Program.cs's by-type registration with a factory handing the service its own store left the whole
        // suite green while ingestion wrote to a database no route reads, and GET /v1/tags answered
        // empty-200 for every ingested machine. The property is that the ingestion door and the read routes
        // are the SAME OBJECT, and only reference equality says that.
        Assert.Same(resolved, storeField.GetValue(service));
    }

    /// <summary>
    /// The tag-map directory constants, pinned the same way <c>HmiModelWiringTests</c> pins the two store
    /// env vars: a constant nothing names is a constant that drifts from whatever is keyed on it.
    ///
    /// <para>🔴 <b>MACHINE-WIDE, after the owner ruled the leaf PURGE-on-decommission.</b> An earlier
    /// version of this test asserted the OPPOSITE — that tag maps sat beside the binary and deliberately
    /// had no relocation variable. That shape was legal but carried a real cost: a publish replaces a
    /// directory beside the binary, so hand-authored tag maps died on every upgrade. Completing the
    /// machine-wide shape required a keep-versus-purge classification, which is owner ruling
    /// 2026-08-23(b)'s territory; with the ruling made, the variable exists and the default is derivable
    /// from the machine-wide root, which is what BF-1 requires of any directory that HAS a variable.</para>
    ///
    /// <para>The variable's NAME is derived rather than chosen — README §15.9's rule is <c>ST4I_</c> + the
    /// leaf uppercased with <c>-</c> → <c>_</c> + <c>_DIR</c> — so this asserts the derivation rather than
    /// a spelling, and a leaf rename that forgot the variable fails here as well as in
    /// <c>PerHostDataRootsTests</c>.</para>
    ///
    /// <para>Does not measure: that any file is read from it, or that the directory exists. It is absent on
    /// a machine that has never declared a tag map, which is the ordinary state.</para>
    /// </summary>
    [Fact]
    public void Tag_maps_live_under_the_machine_wide_root_with_a_variable_whose_name_is_derived()
    {
        // The leaf is read off the LIVE path rather than a constant: a `DirectoryName` constant existed and
        // had no production consumer, so a sweep row mutating it reddened for a reason its label did not
        // describe. There is one spelling now, and this reads it.
        var leaf = Path.GetFileName(TagIngestionService.DefaultRoot);
        Assert.Equal("hmi-tagmaps", leaf);

        // The README §15.9 rule, applied rather than restated.
        Assert.Equal(TagIngestionService.EnvVarDir, "ST4I_" + leaf.ToUpperInvariant().Replace('-', '_') + "_DIR");

        // Derivable from the machine-wide root, which is what makes the variable legal under BF-1.
        Assert.Equal(
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                "ST4I", "sim", leaf),
            TagIngestionService.DefaultRoot);

        // 🔴 A red-able witness for TestRunTempRoot's redirect of this variable. Without that line every
        // host boot in every suite would ingest the DEVELOPER'S REAL %ProgramData% tag maps, and nothing
        // named this leaf as the thing being protected. Remove the redirect and this fails.
        Assert.NotEqual(TagIngestionService.DefaultRoot, TagIngestionService.ResolveDir());

        // …and the env var wins when set, which is the whole point of having one.
        var previous = Environment.GetEnvironmentVariable(TagIngestionService.EnvVarDir);
        try
        {
            Environment.SetEnvironmentVariable(TagIngestionService.EnvVarDir, @"X:\relocated");
            Assert.Equal(@"X:\relocated", TagIngestionService.ResolveDir());
        }
        finally
        {
            Environment.SetEnvironmentVariable(TagIngestionService.EnvVarDir, previous);
        }
    }

    /// <summary>
    /// Booting the host with no tag-map directory present must be a complete no-op — no throw, no store
    /// write, a served application. This is the ingestion loop's own §5-bis: an install that has never
    /// heard of tag maps starts exactly as it did before this task.
    ///
    /// <para>Does not measure: that the loop RAN. It runs unconditionally at startup and iterates whatever
    /// bindings exist; with no directory there is nothing to ingest, which is the state being pinned.</para>
    /// </summary>
    [Fact]
    public async Task A_host_with_no_tag_map_directory_starts_and_serves_normally()
    {
        await using var factory = await CreateFactoryAsync();
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/v1/capabilities");
        response.EnsureSuccessStatusCode();
    }

    /// <summary>
    /// 🔴 <b>F-1 — the property the flag alone could not express: the production path must be reached
    /// WITH WORK TO DO, not merely entered.</b>
    ///
    /// <para><c>Startup_actually_calls_the_tag_map_ingestion_loop</c> below asks "was the loop entered".
    /// Mutating <c>Program.cs</c>'s <c>SnapshotBindings()</c> to <c>.Take(0)</c> disables tag-map ingestion
    /// for every machine on every host and leaves that pin GREEN, because the flag is set before the
    /// bindings list is consumed. The session's biggest finding, one argument to the right.</para>
    ///
    /// <para>This boots a host that has an actual bound connector — a Modbus one, configured the way an
    /// operator configures it, through <c>ST4I_MODBUS_ENABLED</c> and <c>ST4I_MODBUS_MAP</c> — with a tag
    /// map on disk for the machine that connector binds to, and asserts the namespace EXISTS afterwards.
    /// An empty bindings list, a truncated one, a block moved above the registration sources, or a wrong
    /// kind from <c>KindOf</c> all produce a different observable here, because the flag it checks is the
    /// stored document rather than a marker set on entry.</para>
    ///
    /// <para>🔴 <b>This test is only possible as of the commit that moved tag maps machine-wide.</b> While
    /// the folder was <c>AppContext.BaseDirectory\tag-maps</c>, writing one meant writing into the shared
    /// build output that races the whole assembly — which is why the flag existed. It is now
    /// <c>%ProgramData%\ST4I\sim\hmi-tagmaps</c> behind <c>ST4I_HMI_TAGMAPS_DIR</c>, redirected per test
    /// run, so a temp directory is enough.</para>
    ///
    /// <para>Does not measure: that a driver ever polls a register. No device exists; <c>isBackedByDriver</c>
    /// is a statement about the KIND, which is Task 3's boundary.</para>
    /// </summary>
    [Fact]
    public async Task Startup_ingests_a_tag_map_for_a_machine_a_connector_is_actually_bound_to()
    {
        var tagMapDir = Directory.CreateTempSubdirectory("st4i-startup-tagmaps-").FullName;
        var tagsDir = Directory.CreateTempSubdirectory("st4i-startup-tags-").FullName;
        var mapPath = Path.Combine(Directory.CreateTempSubdirectory("st4i-startup-modbus-").FullName, "map.json");

        File.WriteAllText(mapPath, """
            { "machineCode": "STARTUP-01", "unitId": 1, "pollIntervalMs": 50,
              "registers": [ { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0,
                               "metric": "temperature", "unit": "C" } ] }
            """);

        File.WriteAllText(Path.Combine(tagMapDir, "STARTUP-01.json"), """
            { "schemaVersion": 1, "machineCode": "STARTUP-01", "entries": [
              { "path": "STARTUP-01/oven/temp", "dataType": "float", "unit": "C", "engMin": 0, "engMax": 300,
                "access": "r", "source": { "kind": "modbus", "unitId": 1, "register": 40001 } } ] }
            """);

        await using var factory = await CreateFactoryAsync(new Dictionary<string, string?>
        {
            ["ST4I_MODBUS_ENABLED"] = "true",
            ["ST4I_MODBUS_MAP"] = mapPath,
            [TagIngestionService.EnvVarDir] = tagMapDir,
            [TagNamespaceStore.EnvVarDir] = tagsDir,
        });

        // The connector really did bind to that machine — without this the assertion below could pass for
        // a host that ingested nothing and a store that was never asked.
        var registry = factory.Services.GetRequiredService<St4i.EdgeCore.Fleet.ConnectorRegistry>();
        Assert.Contains(registry.SnapshotBindings(), b =>
            string.Equals(b.MachineCode, "STARTUP-01", StringComparison.OrdinalIgnoreCase));

        var stored = await factory.Services.GetRequiredService<ITagNamespaceStore>().GetAsync("STARTUP-01");

        Assert.True(stored is not null,
            "startup did not ingest the tag map for STARTUP-01, although a connector is bound to it and the " +
            "map is on disk in the configured tag-map directory. Program.cs either did not run the loop, ran " +
            "it with no bindings, or ran it before the connector sources registered.");

        var tag = Assert.Single(stored!.Tags);
        Assert.Equal("STARTUP-01/oven/temp", tag.Path);

        // KindOf: the flag is true only because the binding's kind resolved to Modbus. A wrong kind here
        // stores the same tag with the flag false, which is the observable that pins KindOf.
        Assert.True(tag.IsBackedByDriver,
            "the tag was ingested but not marked driver-backed, so the connector kind the startup loop " +
            "passed for this binding is not the Modbus kind the registry holds — ConnectorRegistry.KindOf.");
    }

    /// <summary>
    /// 🔴 <b>The feature's ONLY production call site, which had no pin at all — found by giving the
    /// composition root a sweep row and watching it come back GREEN.</b> Wrapping <c>Program.cs</c>'s
    /// <c>TagMapStartupIngestion.IngestAll(...)</c> in <c>if (false)</c> disabled every part of WS-HMI-0c
    /// that a user could reach, and the entire suite stayed green: parser, flag, builder, service and
    /// startup loop were each pinned, and the line that makes any of them RUN was not. That is the
    /// <c>dispense_program</c> shape one level up — complete, correct, and connected to nothing.
    ///
    /// <para>Booting the host is the assertion: an absent <c>tag-maps/</c> folder is the normal state, so
    /// startup leaves no namespace behind to look for, and the folder itself is in
    /// <c>AppContext.BaseDirectory</c>, which this assembly's D-1 review (I-3) records as the shared
    /// artifact directory a test must not write to.</para>
    ///
    /// <para>Does not measure: that anything was INGESTED — nothing is, because no map exists. It measures
    /// that the loop was entered with the production directory, which is precisely what a disabled call
    /// site removes.</para>
    /// </summary>
    [Fact]
    public async Task Startup_actually_calls_the_tag_map_ingestion_loop()
    {
        await using var factory = await CreateFactoryAsync();
        _ = factory.Server;

        Assert.True(TagMapStartupIngestion.HasRunAgainstTheProductionDirectory,
            "no host boot in this test run has called TagMapStartupIngestion.IngestAll with " +
            $"'{TagMapStartupIngestion.ResolveDirectory()}'. Program.cs's call site is the only place that " +
            "passes it, so WS-HMI-0c is not wired into startup — every other test in this branch can pass " +
            "with the whole feature disconnected.");
    }
}
