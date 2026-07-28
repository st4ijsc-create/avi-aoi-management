using St4i.EdgeCore.Drivers.Simulators;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using Xunit;

public class SimulatorFactoryTests
{
    private static MachineDescriptor D(string machineType, DeviceClass deviceClass = DeviceClass.Automation) =>
        new("MC-01", "SN", deviceClass, machineType, "step", DriverKind.Simulated, "RC1", null, 1.0);

    [Theory]
    [InlineData("SCREWDRIVE", typeof(ScrewdriveSim))]
    [InlineData("screwdrive", typeof(ScrewdriveSim))] // case-insensitive
    [InlineData(" DISPENSING ", typeof(DispensingSim))] // trimmed
    [InlineData("WELDER", typeof(WelderSim))]
    [InlineData("ASSEMBLY", typeof(AssemblySim))]
    [InlineData("LEAK_TEST", typeof(LeakTestSim))]
    [InlineData("FUNCTIONAL_TEST", typeof(FunctionalTestSim))]
    [InlineData("IOT_SENSOR", typeof(IotSensorSim))]
    [InlineData("AOI", typeof(AoiInspectorSim))]
    [InlineData("AOI_AVI", typeof(AoiInspectorSim))]
    [InlineData("AVI", typeof(AoiInspectorSim))]
    public void Create_returns_the_right_simulator_type_for_each_MachineType(string machineType, Type expected)
    {
        var sim = SimulatorFactory.Create(D(machineType), seed: 1);
        Assert.IsType(expected, sim);
    }

    [Theory]
    [InlineData(DeviceClass.Iot, typeof(IotSensorSim))]
    [InlineData(DeviceClass.AoiAvi, typeof(AoiInspectorSim))]
    [InlineData(DeviceClass.Automation, typeof(ScrewdriveSim))]
    public void Create_falls_back_to_DeviceClass_for_an_unrecognized_MachineType(DeviceClass deviceClass, Type expected)
    {
        var sim = SimulatorFactory.Create(D("SOME_TYPO_TYPE", deviceClass), seed: 1);
        Assert.IsType(expected, sim);
    }

    [Fact]
    public void Create_falls_back_by_DeviceClass_when_MachineType_is_null()
    {
        var d = new MachineDescriptor("MC-01", "SN", DeviceClass.Iot, null!, "step", DriverKind.Simulated, "RC1", null, 1.0);
        var sim = SimulatorFactory.Create(d, seed: 1);
        Assert.IsType<IotSensorSim>(sim);
    }

    [Fact]
    public void Create_throws_ArgumentNullException_for_null_descriptor()
    {
        Assert.Throws<ArgumentNullException>(() => SimulatorFactory.Create(null!, seed: 1));
    }
}
