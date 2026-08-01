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
