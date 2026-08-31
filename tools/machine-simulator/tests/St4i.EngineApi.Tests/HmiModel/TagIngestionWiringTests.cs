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
/// <para><b>What this file does NOT measure:</b> (1) it does NOT run the startup ingestion loop against
/// real files — the default tag-map directory is deliberately absent in every build output, and a test that
/// created it would write into <c>AppContext.BaseDirectory</c>, the one shared artifact directory this
/// assembly's own D-1 review (I-3) records as racing the whole suite; (2) it does NOT measure the swallow
/// in <c>Program.cs</c> — no test here can make a registered connector's map throw at boot without that
/// same shared-directory write; the swallow is reasoned about in this task's report and its cost is stated
/// in the code, not asserted here, and that gap is named rather than papered over; (3) it does NOT measure
/// ingestion behaviour at all — every proposition about parsing, §5, identity and replacement is
/// <c>TagIngestionServiceTests</c>' subject, against a real store.</para>
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class TagIngestionWiringTests
{
    private static readonly SemaphoreSlim EnvLock = new(1, 1);

    /// <summary>Same force-Production, eager-build idiom <c>HmiModelWiringTests.CreateFactoryAsync</c>
    /// documents at length — duplicated for the same reason it duplicates it from the auth tests.</summary>
    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync()
    {
        await EnvLock.WaitAsync().ConfigureAwait(false);
        var previous = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
        try
        {
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Production");
            var factory = new WebApplicationFactory<Program>();
            _ = factory.Server; // build NOW, while the override is live
            return factory;
        }
        finally
        {
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", previous);
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
        await using var factory = await CreateFactoryAsync().ConfigureAwait(false);

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
        Assert.Equal("hmi-tagmaps", TagIngestionService.DirectoryName);

        // The README §15.9 rule, applied rather than restated.
        Assert.Equal(
            "ST4I_" + TagIngestionService.DirectoryName.ToUpperInvariant().Replace('-', '_') + "_DIR",
            TagIngestionService.EnvVarDir);

        // Derivable from the machine-wide root, which is what makes the variable legal under BF-1.
        Assert.Equal(
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                "ST4I", "sim", TagIngestionService.DirectoryName),
            TagIngestionService.DefaultRoot);

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
        await using var factory = await CreateFactoryAsync().ConfigureAwait(false);
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/v1/capabilities");
        response.EnsureSuccessStatusCode();
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
        await using var factory = await CreateFactoryAsync().ConfigureAwait(false);
        _ = factory.Server;

        Assert.True(TagMapStartupIngestion.HasRunAgainstTheProductionDirectory,
            "no host boot in this test run has called TagMapStartupIngestion.IngestAll with " +
            $"'{TagMapStartupIngestion.ResolveDirectory()}'. Program.cs's call site is the only place that " +
            "passes it, so WS-HMI-0c is not wired into startup — every other test in this branch can pass " +
            "with the whole feature disconnected.");
    }
}
