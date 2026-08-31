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

        Assert.IsType<CanonicalizingTagNamespaceStore>(storeField.GetValue(service));
    }

    /// <summary>
    /// The tag-map folder constant, pinned the same way <c>HmiModelWiringTests</c> pins the two store env
    /// vars: a constant nothing names is a constant that drifts from whatever is keyed on it.
    ///
    /// <para><b>And the deliberate ABSENCE of a relocation variable</b>, which is the half a reader is
    /// most likely to think was an oversight. Tag maps sit beside the binary with no
    /// <c>ST4I_*_DIR</c> — the same shape as <c>connectors.json</c> and <c>fleet.json</c>. A version with
    /// both a variable and a beside-the-binary default was written and reverted after
    /// <c>PerHostDataRootsTests</c> and <c>TestHarnessIsolationTests</c> refused it; asserting the absence
    /// here means a future edit that adds the variable back without also moving the default under
    /// <c>%ProgramData%</c> fails HERE, next to the explanation, rather than in a whole-tree census whose
    /// message cannot know why this directory exists.</para>
    ///
    /// <para>Does not measure: that any file is read from it. The folder is absent in every build output,
    /// which is exactly what makes this task's startup change byte-identical for an existing deployment —
    /// and is why no test here creates it.</para>
    /// </summary>
    [Fact]
    public void Tag_maps_live_beside_the_binary_and_deliberately_have_no_relocation_variable()
    {
        Assert.Equal("tag-maps", TagIngestionService.DirectoryName);

        var relocationVariables = typeof(TagIngestionService)
            .GetFields(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static)
            .Where(f => f.FieldType == typeof(string))
            .Select(f => f.GetValue(null) as string)
            .Where(v => v is not null && v.StartsWith("ST4I_", StringComparison.Ordinal) &&
                        v.EndsWith("_DIR", StringComparison.Ordinal))
            .ToList();

        Assert.Empty(relocationVariables);
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
}
