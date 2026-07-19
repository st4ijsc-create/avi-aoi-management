using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using Xunit;

public class FleetConfigTests
{
    // Locks the canonical fleet.json convention: enum VALUES (deviceClass/driverKind) are matched
    // case-insensitively against the C# enum member names, so a later task authoring fleet.json +
    // mapping presets can't silently misparse just because it picked a different casing style than
    // this loader's original author did.
    [Fact]
    public void Load_parses_mixed_enum_casing_case_insensitively()
    {
        var tmp = Path.Combine(Path.GetTempPath(), "fleet-mixed-case-" + Guid.NewGuid() + ".json");
        File.WriteAllText(tmp, """
        [
          { "code": "AOI-01", "serialSeed": "AOI", "deviceClass": "aoiAvi", "machineType": "aoi",
            "stepType": null, "driverKind": "hotFolderAoi", "recipeCode": null,
            "mappingProfile": null, "cycleSeconds": 4.0 },
          { "code": "SCRW-01", "serialSeed": "SCRW", "deviceClass": "Automation", "machineType": "screwdriver",
            "stepType": "screw_tightening", "driverKind": "Simulated", "recipeCode": "RC1",
            "mappingProfile": null, "cycleSeconds": 2.5 },
          { "code": "IOT-01", "serialSeed": "IOT", "deviceClass": "IOT", "machineType": "sensor-hub",
            "stepType": null, "driverKind": "MQTT", "recipeCode": null,
            "mappingProfile": "default", "cycleSeconds": 1.0 }
        ]
        """);
        try
        {
            var machines = FleetConfig.Load(tmp);

            Assert.Equal(3, machines.Count);

            // lowercase/camelCase entry
            Assert.Equal("AOI-01", machines[0].Code);
            Assert.Equal(DeviceClass.AoiAvi, machines[0].DeviceClass);
            Assert.Equal(DriverKind.HotFolderAoi, machines[0].DriverKind);

            // PascalCase entry
            Assert.Equal("SCRW-01", machines[1].Code);
            Assert.Equal(DeviceClass.Automation, machines[1].DeviceClass);
            Assert.Equal(DriverKind.Simulated, machines[1].DriverKind);

            // ALL CAPS entry
            Assert.Equal("IOT-01", machines[2].Code);
            Assert.Equal(DeviceClass.Iot, machines[2].DeviceClass);
            Assert.Equal(DriverKind.Mqtt, machines[2].DriverKind);
        }
        finally
        {
            File.Delete(tmp);
        }
    }

    [Fact]
    public void Load_missing_file_returns_empty_list()
    {
        var path = Path.Combine(Path.GetTempPath(), "fleet-nope-" + Guid.NewGuid() + ".json");
        var result = FleetConfig.Load(path);
        Assert.Empty(result);
    }

    [Fact]
    public void Load_malformed_json_throws_FleetConfigException_not_raw_JsonException()
    {
        var tmp = Path.Combine(Path.GetTempPath(), "fleet-bad-" + Guid.NewGuid() + ".json");
        File.WriteAllText(tmp, "{ this is not [ valid json");
        try
        {
            var ex = Assert.Throws<FleetConfigException>(() => FleetConfig.Load(tmp));
            Assert.Contains(tmp, ex.Message);
        }
        finally
        {
            File.Delete(tmp);
        }
    }

    /// <summary>Post-Task-22 review fix: a bad fleet.json must never take down the kiosk, but
    /// <c>UnauthorizedAccessException</c> escaped <see cref="FleetConfig.Load"/> unwrapped before this
    /// fix — past <c>FleetService.LoadFleet</c>'s own <c>catch (FleetConfigException)</c>, out of the DI
    /// constructor / App.OnStartup, an unhandled startup crash. A path that is actually a DIRECTORY is
    /// the simplest portable repro: <see cref="File.Exists"/> is false for a directory (it's specifically
    /// a FILE-existence check), so without <see cref="FleetConfig.Load"/>'s explicit
    /// <see cref="Directory.Exists"/> guard this would silently fall through to the "path doesn't exist"
    /// branch and return an EMPTY fleet — masking a real config mistake — rather than raising a clear,
    /// path-carrying error; WITH that guard it takes the same "never a raw framework exception" path this
    /// whole class promises everywhere else.</summary>
    [Fact]
    public void Load_path_is_a_directory_throws_FleetConfigException_not_UnauthorizedAccessException()
    {
        var dir = Path.Combine(Path.GetTempPath(), "fleet-is-a-dir-" + Guid.NewGuid());
        Directory.CreateDirectory(dir);
        try
        {
            var ex = Assert.Throws<FleetConfigException>(() => FleetConfig.Load(dir));
            Assert.Contains(dir, ex.Message);
        }
        finally
        {
            Directory.Delete(dir);
        }
    }
}
