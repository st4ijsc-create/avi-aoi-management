using St4i.EdgeCore.Drivers.Simulators;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Mapping;
using St4i.Connector.Abstractions.Models;
using Xunit;

/// <summary>
/// Task 22 packaging proof: the SHIPPED <c>tools/machine-simulator/fleet.json</c> +
/// <c>mapping/*.json</c> preset files (not a hand-authored fixture copy) actually parse via
/// <see cref="FleetConfig.Load"/> / <see cref="MappingProfile.FromJson"/> — the "fleet.json loads"
/// hard-gate proof the task brief asks for, run against the real files on disk. Locates
/// <c>tools/machine-simulator/</c> by walking up from the test binary's own output directory (same
/// technique <c>App.xaml.cs</c>'s <c>FindProjectDirectory</c> uses for the WPF project), so this works
/// regardless of how deep the build's RID/config output nesting goes.
/// </summary>
public class PackagingFleetJsonTests
{
    private static string MachineSimulatorRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "fleet.json")) &&
                Directory.Exists(Path.Combine(dir.FullName, "mapping")))
            {
                return dir.FullName;
            }

            dir = dir.Parent;
        }

        throw new InvalidOperationException(
            $"Could not locate tools/machine-simulator (fleet.json + mapping/) by walking up from \"{AppContext.BaseDirectory}\"");
    }

    [Fact]
    public void Shipped_fleet_json_loads_11_machines_matching_the_task22_roster()
    {
        var path = Path.Combine(MachineSimulatorRoot(), "fleet.json");
        var machines = FleetConfig.Load(path);

        Assert.Equal(11, machines.Count);

        // Distribution the task brief asks for: 2xSCREWDRIVE, 1xDISPENSING, 1xWELDER, 1xASSEMBLY,
        // 1xLEAK_TEST, 1xFUNCTIONAL_TEST, 2xIOT_SENSOR, 2xAOI.
        Assert.Equal(2, machines.Count(m => m.MachineType == "SCREWDRIVE"));
        Assert.Equal(1, machines.Count(m => m.MachineType == "DISPENSING"));
        Assert.Equal(1, machines.Count(m => m.MachineType == "WELDER"));
        Assert.Equal(1, machines.Count(m => m.MachineType == "ASSEMBLY"));
        Assert.Equal(1, machines.Count(m => m.MachineType == "LEAK_TEST"));
        Assert.Equal(1, machines.Count(m => m.MachineType == "FUNCTIONAL_TEST"));
        Assert.Equal(2, machines.Count(m => m.MachineType == "IOT_SENSOR"));
        Assert.Equal(2, machines.Count(m => m.MachineType == "AOI"));

        // DeviceClass spans all 3 values (7 automation-class machine types above + 2 IoT + 2 AOI).
        Assert.Equal(7, machines.Count(m => m.DeviceClass == DeviceClass.Automation));
        Assert.Equal(2, machines.Count(m => m.DeviceClass == DeviceClass.Iot));
        Assert.Equal(2, machines.Count(m => m.DeviceClass == DeviceClass.AoiAvi));

        // Every code is unique (no accidental duplicate machine entry).
        Assert.Equal(machines.Count, machines.Select(m => m.Code).Distinct().Count());

        // Every descriptor actually builds a real simulator — SimulatorFactory recognizes every
        // MachineType string used in fleet.json (no silent DeviceClass-fallback masking a typo).
        var i = 9000;
        foreach (var m in machines)
        {
            Assert.NotNull(SimulatorFactory.Create(m, seed: i++));
        }
    }

    [Theory]
    [InlineData("screwdrive", "Automation", "screw_tightening")]
    [InlineData("dispensing", "Automation", "glue_dispense")]
    [InlineData("welder", "Automation", "weld_spot")]
    [InlineData("iot-sensor", "Iot", "telemetry")]
    [InlineData("aoi", "AoiAvi", "inspection")]
    [InlineData("hotfolder-aoi", "AoiAvi", "inspection")]
    [InlineData("mqtt-iot", "Iot", "telemetry")]
    public void Shipped_mapping_preset_parses_with_expected_shape(string fileName, string expectedDeviceClass, string expectedDefaultStepType)
    {
        var path = Path.Combine(MachineSimulatorRoot(), "mapping", fileName + ".json");
        Assert.True(File.Exists(path), $"mapping preset not found: {path}");

        var profile = MappingProfile.FromJson(File.ReadAllText(path));

        Assert.Equal(fileName, profile.Name);
        Assert.Equal(expectedDeviceClass, profile.DeviceClass);
        Assert.Equal(expectedDefaultStepType, profile.DefaultStepType);
    }

    /// <summary>Every <c>mappingProfile</c> value referenced from fleet.json (skipping nulls — ASSEMBLY/
    /// LEAK_TEST/FUNCTIONAL_TEST deliberately have no dedicated preset yet, see the task brief) must
    /// resolve to a real file under mapping/ — catches a fleet.json/mapping typo drifting apart.</summary>
    [Fact]
    public void Every_referenced_mapping_profile_in_fleet_json_has_a_matching_preset_file()
    {
        var root = MachineSimulatorRoot();
        var machines = FleetConfig.Load(Path.Combine(root, "fleet.json"));

        var referenced = machines.Select(m => m.MappingProfile).Where(p => !string.IsNullOrEmpty(p)).Distinct();
        foreach (var profileName in referenced)
        {
            var path = Path.Combine(root, "mapping", profileName + ".json");
            Assert.True(File.Exists(path), $"fleet.json references mappingProfile \"{profileName}\" but {path} does not exist");
        }
    }
}
