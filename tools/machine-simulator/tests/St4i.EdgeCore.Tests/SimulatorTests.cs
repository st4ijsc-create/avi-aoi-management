using St4i.EdgeCore.Drivers;
using St4i.EdgeCore.Drivers.Simulators;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using Xunit;

public class SimulatorTests
{
    private static MachineDescriptor D(string machineType, DeviceClass deviceClass = DeviceClass.Automation, double cycleSeconds = 1.0) =>
        new("SCRW-01", "SN", deviceClass, machineType, "screw_tightening", DriverKind.Simulated, "RC1", null, cycleSeconds);

    // ── Brief's 2 required facts (verbatim intent) ─────────────────────────

    [Fact]
    public void Screwdrive_is_deterministic_for_same_seed()
    {
        var a = new ScrewdriveSim(D("SCREWDRIVE"), seed: 42).NextCycle(1);
        var b = new ScrewdriveSim(D("SCREWDRIVE"), seed: 42).NextCycle(1);
        Assert.Equal(a.Metrics[0].Value, b.Metrics[0].Value);
        Assert.Equal(ReadingKind.ProcessResult, a.Kind);
    }

    [Fact]
    public void Aoi_produces_inspection_with_measurements()
    {
        var d = new MachineDescriptor("AOI-01", "SN", DeviceClass.AoiAvi, "AOI", null, DriverKind.Simulated, null, null, 2.0);
        var r = new AoiInspectorSim(d, seed: 7).NextCycle(1);
        Assert.Equal(ReadingKind.Inspection, r.Kind);
        Assert.NotEmpty(r.Measurements);
    }

    // ── Additional coverage ─────────────────────────────────────────────────

    [Fact]
    public void Screwdrive_different_seed_usually_produces_different_value()
    {
        var a = new ScrewdriveSim(D("SCREWDRIVE"), seed: 42).NextCycle(1);
        var b = new ScrewdriveSim(D("SCREWDRIVE"), seed: 43).NextCycle(1);
        Assert.NotEqual(a.Metrics[0].Value, b.Metrics[0].Value);
    }

    [Fact]
    public void Screwdrive_same_seed_different_cycle_produces_different_value_and_serial()
    {
        var sim = new ScrewdriveSim(D("SCREWDRIVE"), seed: 42);
        var r1 = sim.NextCycle(1);
        var r2 = sim.NextCycle(2);
        Assert.NotEqual(r1.Metrics[0].Value, r2.Metrics[0].Value);
        Assert.NotEqual(r1.SerialNumber, r2.SerialNumber);
        Assert.Equal("SN-000001", r1.SerialNumber);
        Assert.Equal("SN-000002", r2.SerialNumber);
    }

    [Fact]
    public void Screwdrive_replaying_same_cycle_reproduces_identical_reading_regardless_of_call_order()
    {
        // doc-62 §6 determinism rule: values vary by cycle INDEX, never by wall clock/call order —
        // calling cycle 5 directly must equal calling cycles 1..5 then reading cycle 5's value.
        var sim = new ScrewdriveSim(D("SCREWDRIVE"), seed: 99);
        for (var i = 1; i < 5; i++) sim.NextCycle(i);
        var replayed = sim.NextCycle(5);

        var fresh = new ScrewdriveSim(D("SCREWDRIVE"), seed: 99).NextCycle(5);

        Assert.Equal(fresh.Metrics[0].Value, replayed.Metrics[0].Value);
        Assert.Equal(fresh.SerialNumber, replayed.SerialNumber);
    }

    [Fact]
    public void Aoi_produces_unique_serial_number_per_board_cycle()
    {
        var d = new MachineDescriptor("AOI-01", "SN", DeviceClass.AoiAvi, "AOI", null, DriverKind.Simulated, null, null, 2.0);
        var sim = new AoiInspectorSim(d, seed: 7);
        var r1 = sim.NextCycle(1);
        var r2 = sim.NextCycle(2);
        Assert.NotEqual(r1.SerialNumber, r2.SerialNumber);
    }

    [Fact]
    public void Aoi_defects_carry_bbox_and_values3d_and_ipc_a610_catalog_code()
    {
        var d = new MachineDescriptor("AOI-01", "SN", DeviceClass.AoiAvi, "AOI", null, DriverKind.Simulated, null, null, 2.0);
        // High NG-rate forces at least one defect within a small board so we can assert its shape.
        var r = new AoiInspectorSim(d, seed: 7, pointsPerBoard: 10, ngRate: 1.0).NextCycle(1);

        Assert.All(r.Measurements, m =>
        {
            Assert.Equal("NG", m.Result);
            Assert.NotNull(m.DefectCatalogCode);
            Assert.NotNull(m.DefectSeverity);
            Assert.NotNull(m.Bbox);
            Assert.NotNull(m.Values3d);
        });
        Assert.Equal(Verdict.Fail, r.Verdict);
    }

    [Fact]
    public void Aoi_zero_ng_rate_yields_all_ok_and_pass_verdict()
    {
        var d = new MachineDescriptor("AOI-01", "SN", DeviceClass.AoiAvi, "AOI", null, DriverKind.Simulated, null, null, 2.0);
        var r = new AoiInspectorSim(d, seed: 7, pointsPerBoard: 10, ngRate: 0.0).NextCycle(1);

        Assert.All(r.Measurements, m => Assert.Equal("OK", m.Result));
        Assert.Equal(Verdict.Pass, r.Verdict);
    }

    [Fact]
    public void IotSensor_emits_telemetry_kind_with_no_verdict_semantics()
    {
        var d = new MachineDescriptor("IOT-01", "SN", DeviceClass.Iot, "IOT_SENSOR", null, DriverKind.Simulated, null, null, 1.0);
        var r = new IotSensorSim(d, seed: 3).NextCycle(1);
        Assert.Equal(ReadingKind.Telemetry, r.Kind);
        Assert.NotEmpty(r.Telemetry);
    }

    public static IEnumerable<object[]> AllSimulators()
    {
        var d = new MachineDescriptor("MC-01", "SN", DeviceClass.Automation, "TYPE", "step", DriverKind.Simulated, "RC1", null, 1.0);
        yield return new object[] { new ScrewdriveSim(d, 11), ReadingKind.ProcessResult };
        yield return new object[] { new DispensingSim(d, 11), ReadingKind.ProcessResult };
        yield return new object[] { new WelderSim(d, 11), ReadingKind.ProcessResult };
        yield return new object[] { new AssemblySim(d, 11), ReadingKind.ProcessResult };
        yield return new object[] { new LeakTestSim(d, 11), ReadingKind.ProcessResult };
        yield return new object[] { new FunctionalTestSim(d, 11), ReadingKind.ProcessResult };
        yield return new object[] { new IotSensorSim(d, 11), ReadingKind.Telemetry };
        yield return new object[] { new AoiInspectorSim(d, 11), ReadingKind.Inspection };
    }

    [Theory]
    [MemberData(nameof(AllSimulators))]
    public void Every_simulator_produces_its_documented_ReadingKind(IMachineSimulator sim, ReadingKind expectedKind)
    {
        var r = sim.NextCycle(1);
        Assert.Equal(expectedKind, r.Kind);
        Assert.Equal(1, r.CycleCounter);
        Assert.Equal("SN-000001", r.SerialNumber);
    }

    [Fact]
    public void Assembly_has_no_seeded_spec_so_verdict_is_warn_only()
    {
        var d = new MachineDescriptor("ASM-01", "SN", DeviceClass.Automation, "ASSEMBLY", "press_fit", DriverKind.Simulated, "RC1", null, 1.0);
        var r = new AssemblySim(d, seed: 5).NextCycle(1);
        Assert.Equal(Verdict.Warn, r.Verdict);
    }

    [Fact]
    public async Task SimulatedDriver_round_robins_all_sims_at_their_own_cadence()
    {
        var d1 = new MachineDescriptor("SCRW-01", "SN1", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening", DriverKind.Simulated, "RC1", null, 0.02);
        var d2 = new MachineDescriptor("WELD-01", "SN2", DeviceClass.Automation, "WELDER", "weld_spot", DriverKind.Simulated, "RC2", null, 0.02);
        var sims = new IMachineSimulator[] { new ScrewdriveSim(d1, 1), new WelderSim(d2, 2) };
        await using var driver = new SimulatedDriver(sims);

        Assert.Equal(DriverKind.Simulated, driver.Kind);
        Assert.Equal(DriverHealthState.Connected, driver.Health);

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var machineCodes = new List<string>();
        await foreach (var r in driver.ReadAsync(cts.Token))
        {
            machineCodes.Add(r.MachineCode);
            if (machineCodes.Count >= 4) break;
        }

        Assert.Equal(4, machineCodes.Count);
        Assert.Contains("SCRW-01", machineCodes);
        Assert.Contains("WELD-01", machineCodes);
    }
}
