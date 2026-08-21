using St4i.EdgeCore.Mapping;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using Xunit;

namespace St4i.EdgeCore.Tests;

/// <summary>
/// G2-1 (Giai đoạn 2 first pass) — <see cref="MappingProfileResolver"/> is what actually activates the
/// per-machine <c>mapping/*.json</c> profiles: a descriptor naming a real file resolves to THAT file's
/// <see cref="MappingProfile.FromJson"/>; a descriptor with no name, or naming a file that is
/// missing/malformed, falls back to <see cref="MappingProfile.ForClass"/> — never throws either way, so
/// one bad preset can never take the fleet pipeline down.
/// </summary>
public sealed class MappingProfileResolverTests
{
    private static string NewTempMappingDir() => Directory.CreateTempSubdirectory("st4i-mapping-resolver-tests-").FullName;

    private static MachineDescriptor NewDescriptor(string code, DeviceClass deviceClass, string? mappingProfile) =>
        new(code, $"SN-{code}", deviceClass, "DISPENSING", "glue_dispense", DriverKinds.Simulated, "RC-1", mappingProfile, CycleSeconds: 1.0);

    [Fact]
    public void Named_profile_with_real_file_loads_that_files_unitMap_and_defaultStepType_not_the_ForClass_default()
    {
        var dir = NewTempMappingDir();
        File.WriteAllText(Path.Combine(dir, "custom.json"), """
            {
              "name": "custom",
              "deviceClass": "Automation",
              "defaultStepType": "custom_step",
              "defaultRecipeCode": "RC-CUSTOM",
              "unitMap": { "C": "°C" }
            }
            """);

        var descriptor = NewDescriptor("DISP-01", DeviceClass.Automation, "custom");
        var resolver = MappingProfileResolver.Build(new[] { descriptor }, dir);

        var resolved = resolver.Resolve("DISP-01");
        Assert.NotNull(resolved);
        Assert.Equal("custom", resolved!.Name);
        Assert.Equal("custom_step", resolved.DefaultStepType);
        Assert.Equal("°C", resolved.UnitMap["C"]);

        // Proves this genuinely differs from the ForClass(Automation) default the fleet used to hardcode
        // for every machine (empty UnitMap, DefaultStepType="process") — otherwise this test would pass
        // even if the resolver silently ignored the file.
        var fallback = MappingProfile.ForClass(DeviceClass.Automation);
        Assert.NotEqual(fallback.DefaultStepType, resolved.DefaultStepType);
        Assert.False(fallback.UnitMap.ContainsKey("C"));
    }

    [Fact]
    public void No_mappingProfile_name_falls_back_to_ForClass()
    {
        var dir = NewTempMappingDir();
        var descriptor = NewDescriptor("IOT-01", DeviceClass.Iot, mappingProfile: null);
        var resolver = MappingProfileResolver.Build(new[] { descriptor }, dir);

        var resolved = resolver.Resolve("IOT-01");
        var expected = MappingProfile.ForClass(DeviceClass.Iot);

        Assert.NotNull(resolved);
        Assert.Equal(expected.Name, resolved!.Name);
        Assert.Equal(expected.DefaultStepType, resolved.DefaultStepType);
    }

    [Fact]
    public void Blank_mappingProfile_name_falls_back_to_ForClass_same_as_null()
    {
        var dir = NewTempMappingDir();
        var descriptor = NewDescriptor("IOT-02", DeviceClass.Iot, mappingProfile: "   ");
        var resolver = MappingProfileResolver.Build(new[] { descriptor }, dir);

        var resolved = resolver.Resolve("IOT-02");
        var expected = MappingProfile.ForClass(DeviceClass.Iot);
        Assert.Equal(expected.Name, resolved!.Name);
    }

    [Fact]
    public void Named_but_missing_file_falls_back_gracefully_no_throw_and_warns()
    {
        var dir = NewTempMappingDir(); // no files written — every name is "missing"
        var descriptor = NewDescriptor("SCRW-01", DeviceClass.Automation, "this-file-does-not-exist");

        string? warning = null;
        var resolver = MappingProfileResolver.Build(new[] { descriptor }, dir, logWarning: msg => warning = msg);

        var resolved = resolver.Resolve("SCRW-01");
        var expected = MappingProfile.ForClass(DeviceClass.Automation);

        Assert.NotNull(resolved);
        Assert.Equal(expected.Name, resolved!.Name);
        Assert.Equal(expected.DefaultStepType, resolved.DefaultStepType);
        Assert.NotNull(warning);
        Assert.Contains("SCRW-01", warning);
        Assert.Contains("this-file-does-not-exist", warning);
    }

    [Fact]
    public void Malformed_json_file_falls_back_gracefully_no_throw_and_logs_error()
    {
        var dir = NewTempMappingDir();
        File.WriteAllText(Path.Combine(dir, "broken.json"), "{ not valid json ][");

        var descriptor = NewDescriptor("WELD-01", DeviceClass.Automation, "broken");

        Exception? loggedEx = null;
        string? loggedMsg = null;
        var resolver = MappingProfileResolver.Build(
            new[] { descriptor }, dir,
            logError: (ex, msg) => { loggedEx = ex; loggedMsg = msg; });

        var resolved = resolver.Resolve("WELD-01");
        var expected = MappingProfile.ForClass(DeviceClass.Automation);

        Assert.NotNull(resolved);
        Assert.Equal(expected.Name, resolved!.Name);
        Assert.NotNull(loggedEx);
        Assert.Contains("WELD-01", loggedMsg);
    }

    [Fact]
    public void Unknown_machine_code_not_in_roster_returns_null_so_the_pipeline_falls_back_to_its_own_shared_profile()
    {
        var dir = NewTempMappingDir();
        var descriptor = NewDescriptor("SCRW-01", DeviceClass.Automation, null);
        var resolver = MappingProfileResolver.Build(new[] { descriptor }, dir);

        Assert.Null(resolver.Resolve("SOME-OTHER-CODE"));
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────────────
    // 🔴 Owner item 21, task AQ-1 (2026-08-21) — the operator-authored `mappingProfile` string is confined
    // to the mapping directory's own subtree. THREE tests, and the third is the one that keeps the ceiling
    // from being set too small: a confinement that also rejected legitimate subdirectories would be a
    // narrower promise than the item asked for, and the item names that exact deployment as the thing a
    // fix must not break.
    // ─────────────────────────────────────────────────────────────────────────────────────────────────

    private const string CustomProfileJson = """
        {
          "name": "outside-profile",
          "deviceClass": "Automation",
          "defaultStepType": "outside_step",
          "defaultRecipeCode": "RC-OUTSIDE",
          "unitMap": { "C": "°C" }
        }
        """;

    [Fact]
    public void An_ABSOLUTE_mappingProfile_pointing_outside_the_mapping_directory_is_refused_and_warns_what_to_fix()
    {
        var mappingDir = NewTempMappingDir();
        var elsewhere = NewTempMappingDir();
        File.WriteAllText(Path.Combine(elsewhere, "outside-profile.json"), CustomProfileJson);

        // Path.Combine's documented behaviour: an absolute right-hand side wins outright, so before the
        // confinement this loaded the file from `elsewhere` and DefaultStepType came back "outside_step".
        var absoluteName = Path.Combine(elsewhere, "outside-profile");
        var descriptor = NewDescriptor("SCRW-01", DeviceClass.Automation, absoluteName);

        string? warning = null;
        var resolver = MappingProfileResolver.Build(
            new[] { descriptor }, mappingDir, logWarning: msg => warning = msg);

        var resolved = resolver.Resolve("SCRW-01");
        var expected = MappingProfile.ForClass(DeviceClass.Automation);

        Assert.NotNull(resolved);
        Assert.Equal(expected.Name, resolved!.Name);
        Assert.Equal(expected.DefaultStepType, resolved.DefaultStepType);
        Assert.NotEqual("outside_step", resolved.DefaultStepType);
        Assert.False(resolved.UnitMap.ContainsKey("C"));

        // The refusal has to be legible to the operator who wrote the string, so it names the machine, the
        // value, the directory that bounds it, and what a legal value looks like.
        Assert.NotNull(warning);
        Assert.Contains("SCRW-01", warning);
        Assert.Contains("REFUSED", warning);
        Assert.Contains(Path.GetFullPath(mappingDir), warning);
        Assert.Contains("profile NAME, not a path", warning);
    }

    [Fact]
    public void A_dotdot_mappingProfile_that_climbs_out_of_the_mapping_directory_is_refused_and_warns()
    {
        var root = NewTempMappingDir();
        var mappingDir = Path.Combine(root, "mapping");
        Directory.CreateDirectory(mappingDir);
        File.WriteAllText(Path.Combine(root, "outside-profile.json"), CustomProfileJson);

        // Before the confinement, File.Exists resolved "<mappingDir>/../outside-profile.json" for itself and
        // this loaded the file one level up. Both separator spellings are exercised because the refusal is
        // decided by normalizing the path, not by scanning the string for a token.
        foreach (var name in new[] { "../outside-profile", @"..\outside-profile" })
        {
            var descriptor = NewDescriptor("WELD-01", DeviceClass.Automation, name);

            string? warning = null;
            var resolver = MappingProfileResolver.Build(
                new[] { descriptor }, mappingDir, logWarning: msg => warning = msg);

            var resolved = resolver.Resolve("WELD-01");
            Assert.NotNull(resolved);
            Assert.Equal(MappingProfile.ForClass(DeviceClass.Automation).Name, resolved!.Name);
            Assert.NotEqual("outside_step", resolved.DefaultStepType);
            Assert.NotNull(warning);
            Assert.Contains("REFUSED", warning);
        }
    }

    [Fact]
    public void A_SUBDIRECTORY_of_the_mapping_directory_still_resolves_so_the_confinement_rejects_only_what_LEAVES()
    {
        var mappingDir = NewTempMappingDir();
        var nested = Path.Combine(mappingDir, "vendor-a");
        Directory.CreateDirectory(nested);
        File.WriteAllText(Path.Combine(nested, "outside-profile.json"), CustomProfileJson);

        var descriptor = NewDescriptor("DISP-01", DeviceClass.Automation, "vendor-a/outside-profile");

        string? warning = null;
        var resolver = MappingProfileResolver.Build(
            new[] { descriptor }, mappingDir, logWarning: msg => warning = msg);

        var resolved = resolver.Resolve("DISP-01");

        // Loads the nested file, and does NOT fall back — proving the confinement did not simply refuse
        // every value containing a separator.
        Assert.NotNull(resolved);
        Assert.Equal("outside-profile", resolved!.Name);
        Assert.Equal("outside_step", resolved.DefaultStepType);
        Assert.Equal("°C", resolved.UnitMap["C"]);
        Assert.Null(warning);
    }

    [Fact]
    public void Missing_mapping_directory_entirely_falls_back_gracefully_for_every_machine()
    {
        var dir = Path.Combine(Path.GetTempPath(), "st4i-mapping-resolver-tests-does-not-exist-" + Guid.NewGuid());
        var descriptor = NewDescriptor("SCRW-01", DeviceClass.Automation, "screwdrive");

        var resolver = MappingProfileResolver.Build(new[] { descriptor }, dir);
        var resolved = resolver.Resolve("SCRW-01");

        Assert.NotNull(resolved);
        Assert.Equal(MappingProfile.ForClass(DeviceClass.Automation).Name, resolved!.Name);
    }
}
