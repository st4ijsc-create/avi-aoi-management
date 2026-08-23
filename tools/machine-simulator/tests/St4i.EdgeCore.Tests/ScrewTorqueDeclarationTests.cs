using St4i.EdgeCore.Config;
using St4i.EdgeCore.Drivers.Simulators;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using Xunit;

/// <summary>
/// 🔴 OWNER'S RULING 2026-08-23, item 41 — the witness for "a SCREWDRIVE descriptor declares which screw
/// it drives, and all three hosts of this product then report the same physics for it".
///
/// <para><b>What each test here can go RED for, stated per test rather than as a class-level promise.</b>
/// (i) <see cref="Declared_band_reports_the_same_physics_under_every_host_wiring"/> reddens if the
/// declaration stops reaching a draw on either wiring, or if the two wirings diverge for a declared
/// machine. (ii) <see cref="Undeclared_screwdrive_is_reported_by_the_loader_and_still_diverges"/> reddens
/// if the loader stops saying so, if the sentence stops naming both candidates, or if the undeclared
/// divergence silently changes size. (iii)
/// <see cref="Shipped_roster_declares_nothing_and_the_numbers_it_reports_have_not_moved"/> reddens if any
/// shipped SCREWDRIVE acquires a declaration or if either wiring's band moves off the values item 41 §41.5
/// recorded.</para>
///
/// <para>🔴 <b>WHAT THIS FILE DOES NOT MEASURE, said where the results appear.</b> It exercises the
/// <b>argument shape</b> the three hosts use, not the three host processes. Measured at commit
/// <c>334575b2</c>, the four <c>SimulatorFactory.Create</c> call sites in <c>src/</c> differ in exactly one
/// thing that reaches the torque band — whether a <see cref="MachineConfigStore"/> is passed:
/// <c>FleetCore.BuildStartPlan</c> and <c>FleetCore.StartLocked</c>'s reuse-miss arm pass one,
/// <c>EdgeWorker</c> and <c>FleetService.BuildSimulator</c> pass none. So "wired vs un-wired" below IS the
/// three-host difference, reduced to the one variable that carries it — but a host that grew a FOURTH way
/// to build a simulator would not be seen here, and neither would a WPF-only regression:
/// <c>FleetService.BuildSimulator</c> is <c>internal</c> in a project with no test assembly in
/// <c>scripts/verify-suites.sh</c>'s five suites, so it is reached in this file only through the delegate
/// it forwards to.</para>
///
/// <para>🔴 <b>And it does not settle 12.0 vs 1.35.</b> Test (iii) PINS the undeclared divergence rather
/// than removing it, on purpose: which screw the shipped roster drives is the owner's to declare, and a
/// test that quietly picked one would have made that choice on their behalf.</para>
/// </summary>
public class ScrewTorqueDeclarationTests
{
    private static string TempDir() => Directory.CreateTempSubdirectory("st4i-screw-torque-decl-").FullName;

    private static MachineDescriptor Screwdriver(string code, ScrewTorqueSpec? screwTorque = null) =>
        new(code, $"SN-{code}", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening",
            DriverKinds.Simulated, "RC1", null, 1.0, screwTorque);

    /// <summary>The FleetCore-shaped construction: a store is passed, so a <c>screw_program</c> record is
    /// ensured and the resolver runs on every cycle.</summary>
    private static IMachineSimulator WiredHost(MachineDescriptor d, int seed, MachineConfigStore store) =>
        SimulatorFactory.Create(d, seed, store, currentProductCode: _ => null, cycleRateMultiplier: 1.0);

    /// <summary>The EdgeWorker/FleetService-shaped construction: no store, so
    /// <c>SimulatorBase.ResolveEffectiveConfig</c> answers null for the instance's whole life.</summary>
    private static IMachineSimulator UnwiredHost(MachineDescriptor d, int seed) =>
        SimulatorFactory.Create(d, seed);

    private static MetricSample Torque(IMachineSimulator sim, long cycle) =>
        sim.NextCycle(cycle).Metrics.Single(m => m.Name == "torque");

    // ─────────────────────────────────────────────────────────────────────
    // (i) DECLARED — the three hosts agree
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Property (i) of item 41's ruling. One descriptor declaring an M6-ish band, built both the
    /// wired way and the un-wired way from the SAME seed: every cycle's drawn value, band and nominal must
    /// be identical, not merely close — the draw is a pure function of (seed, cycle) and of the band, so any
    /// difference at all means the two hosts resolved different physics.
    ///
    /// <para>Before this ruling the same assertion over the same descriptor compared ~12.0 Nm against
    /// ~1.35 Nm, which is the defect stated as a failing test.</para></summary>
    [Fact]
    public void Declared_band_reports_the_same_physics_under_every_host_wiring()
    {
        const string code = "SCRW-DECL-01";
        const int seed = 7311;
        var declared = new ScrewTorqueSpec("M6", 4.50, 0.40);
        var d = Screwdriver(code, declared);

        var store = new MachineConfigStore(TempDir());
        var wired = WiredHost(d, seed, store);
        var unwired = UnwiredHost(d, seed);

        for (long cycle = 1; cycle <= 50; cycle++)
        {
            var a = Torque(wired, cycle);
            var b = Torque(unwired, cycle);

            Assert.Equal(a.Value, b.Value);
            Assert.Equal(a.Lsl, b.Lsl);
            Assert.Equal(a.Usl, b.Usl);
            Assert.Equal(a.Nominal, b.Nominal);

            // And the shared answer is the ROSTER's, not either host's old fallback.
            Assert.Equal(4.50, a.Nominal);
            Assert.Equal(4.10, a.Lsl!.Value, 9);
            Assert.Equal(4.90, a.Usl!.Value, 9);
        }
    }

    /// <summary>The declaration must not cost the operator their settings screen. With a band declared AND
    /// a machine-scoped adjustment set, the adjustment wins — this is the rung-1-over-rung-2 precedence
    /// <c>ScrewdriveSim.ResolveTorqueBand</c> documents, and it is what keeps
    /// <c>MachineConfigDrivesSimulationTests</c>' "tighten the tolerance ⇒ more NG" property alive for a
    /// declared machine. Reddens if a declaration were ever made to outrank an operator.</summary>
    [Fact]
    public void An_operator_adjustment_still_outranks_the_roster_declaration()
    {
        const string code = "SCRW-DECL-ADJ";
        const int seed = 991;
        var d = Screwdriver(code, new ScrewTorqueSpec("M6", 4.50, 0.40));

        var store = new MachineConfigStore(TempDir());
        store.Ensure(code, MachineParameterSchema.ScrewProgram);

        Assert.Equal(4.50, Torque(WiredHost(d, seed, store), 1).Nominal);

        store.SetAdjustment(code, "torqueTarget", 6.25, AdjustmentScope.Machine, null, "test", "operator wins");
        var after = Torque(WiredHost(d, seed, store), 1);

        Assert.Equal(6.25, after.Nominal);
        Assert.Equal(6.25 - 0.40, after.Lsl!.Value, 9);
    }

    // ─────────────────────────────────────────────────────────────────────
    // (ii) NOT DECLARED — loud, and the divergence is pinned rather than hidden
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Property (ii). An undeclared SCREWDRIVE is REPORTED by the loader every host already routes
    /// its roster through, and its behaviour is left exactly as it was. Both halves are asserted here in one
    /// test on purpose: a warning that fired while the numbers had quietly been unified would be a different
    /// (and worse) outcome than the one item 41 shipped, and splitting them would let either half go green
    /// alone.</summary>
    [Fact]
    public void Undeclared_screwdrive_is_reported_by_the_loader_and_still_diverges()
    {
        var dir = TempDir();
        var path = Path.Combine(dir, "fleet.json");
        File.WriteAllText(path, """
        [
          { "code": "SCRW-UND-01", "serialSeed": "SN-U1", "deviceClass": "automation", "machineType": "SCREWDRIVE",
            "stepType": "screw_tightening", "driverKind": "simulated", "recipeCode": "RC1", "mappingProfile": null,
            "cycleSeconds": 1.0 },
          { "code": "WELD-UND-01", "serialSeed": "SN-W1", "deviceClass": "automation", "machineType": "WELDER",
            "stepType": "weld_spot", "driverKind": "simulated", "recipeCode": "RC2", "mappingProfile": null,
            "cycleSeconds": 1.0 }
        ]
        """);

        var warnings = new List<string>();
        var machines = FleetConfig.Load(path, warnings.Add);

        Assert.Equal(2, machines.Count);
        Assert.All(machines, m => Assert.Null(m.ScrewTorque));

        // Exactly one warning: the SCREWDRIVE. A WELDER is not a screwdriver and must not be counted —
        // that scope is stated in FleetConfig.IsScrewdriveType and asserted here so it cannot drift.
        var warning = Assert.Single(warnings);
        Assert.Contains("SCRW-UND-01", warning);
        Assert.DoesNotContain("WELD-UND-01", warning);

        // It must name BOTH candidates and pick neither, and it must name the key that closes the question.
        Assert.Contains("12.0", warning);
        Assert.Contains("1.35", warning);
        Assert.Contains(ScrewTorqueSpec.JsonPropertyName, warning);

        // ...and the numbers are untouched: this is the divergence item 41 measured, still exactly here.
        var d = machines.Single(m => m.Code == "SCRW-UND-01");
        var unwired = Torque(UnwiredHost(d, 4242), 1);
        var wired = Torque(WiredHost(d, 4242, new MachineConfigStore(TempDir())), 1);

        Assert.Equal(12.0, unwired.Nominal);
        Assert.Equal(10.8, unwired.Lsl!.Value, 9);
        Assert.Equal(13.2, unwired.Usl!.Value, 9);

        Assert.Equal(1.35, wired.Nominal);
        Assert.Equal(1.20, wired.Lsl!.Value, 9);
        Assert.Equal(1.50, wired.Usl!.Value, 9);
    }

    // ─────────────────────────────────────────────────────────────────────
    // (iii) THE SHIPPED ROSTER — not one number moved
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Property (iii). The roster this product ships declares NOTHING, and both of its SCREWDRIVE
    /// entries still report exactly the bands <c>docs/owner-decisions.md</c> §41.5 recorded before item 41
    /// was executed. This is the assertion that would have caught the fix choosing a screw on the owner's
    /// behalf: declaring a band in <c>fleet.json</c> — either band — reddens this test.</summary>
    [Fact]
    public void Shipped_roster_declares_nothing_and_the_numbers_it_reports_have_not_moved()
    {
        var path = Path.Combine(MachineSimulatorRoot(), "fleet.json");
        var machines = FleetConfig.Load(path);
        var screwdrivers = machines.Where(m => m.MachineType == "SCREWDRIVE").ToList();

        Assert.Equal(2, screwdrivers.Count);
        Assert.All(screwdrivers, m => Assert.Null(m.ScrewTorque));

        var seed = 1000;
        foreach (var d in screwdrivers)
        {
            var unwired = Torque(UnwiredHost(d, seed), 1);
            Assert.Equal(12.0, unwired.Nominal);
            Assert.Equal(10.8, unwired.Lsl!.Value, 9);
            Assert.Equal(13.2, unwired.Usl!.Value, 9);
            Assert.Equal("Nm", unwired.Unit);

            var wired = Torque(WiredHost(d, seed, new MachineConfigStore(TempDir())), 1);
            Assert.Equal(1.35, wired.Nominal);
            Assert.Equal(1.20, wired.Lsl!.Value, 9);
            Assert.Equal(1.50, wired.Usl!.Value, 9);

            seed++;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // The declaration's own guardrail
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>A declared band is checked against the SAME hard range the REST write path enforces, and it
    /// is REJECTED rather than clamped — the design doc's "chặn cứng min/max là bắt buộc, không phải trang
    /// trí". 🔴 Note what is NOT asserted and cannot be: both 1.35 and 12.0 are INSIDE that range, so no
    /// guardrail anywhere can prefer one of them. That is item 41's whole point and it is stated here, at
    /// the guardrail, so nobody reads a green range check as an answer to the screw question.</summary>
    [Theory]
    [InlineData(0.05, 0.15)]   // target below the schema's 0.10 floor
    [InlineData(25.0, 0.15)]   // target above the schema's 20.00 ceiling
    [InlineData(4.50, 7.50)]   // tolerance above the schema's 5.00 ceiling
    public void An_out_of_range_declaration_is_rejected_never_clamped(double target, double tolerance)
    {
        var ex = Assert.Throws<ArgumentOutOfRangeException>(() => new ScrewTorqueSpec("M6", target, tolerance));
        Assert.Contains("must be between", ex.Message);
    }

    /// <summary>A band with no fastener name is half a declaration — the half a human reads. Rejected at
    /// construction, so no host can hold one.</summary>
    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void A_declaration_with_no_screw_code_is_rejected(string screwCode)
    {
        Assert.Throws<ArgumentException>(() => new ScrewTorqueSpec(screwCode, 4.50, 0.40));
    }

    /// <summary>The per-entry tolerance <c>FleetConfig.Load</c> already keeps for a malformed
    /// <c>deviceClass</c> now also covers an out-of-range band: ONE bad entry is skipped with a named
    /// warning and every other entry in the same file still loads. Without the <c>ArgumentException</c>
    /// clause added to that catch, this file would have thrown and taken the whole roster with it — the
    /// "one operator typo destroys the whole fleet" shape GP-3 closed.</summary>
    [Fact]
    public void An_out_of_range_declaration_skips_only_its_own_entry()
    {
        var path = Path.Combine(TempDir(), "fleet.json");
        File.WriteAllText(path, """
        [
          { "code": "SCRW-BAD", "serialSeed": "SN-B", "deviceClass": "automation", "machineType": "SCREWDRIVE",
            "stepType": "screw_tightening", "driverKind": "simulated", "recipeCode": "RC1", "mappingProfile": null,
            "cycleSeconds": 1.0, "screwTorque": { "screwCode": "M99", "targetNm": 90.0, "toleranceNm": 0.4 } },
          { "code": "SCRW-GOOD", "serialSeed": "SN-G", "deviceClass": "automation", "machineType": "SCREWDRIVE",
            "stepType": "screw_tightening", "driverKind": "simulated", "recipeCode": "RC1", "mappingProfile": null,
            "cycleSeconds": 1.0, "screwTorque": { "screwCode": "M6", "targetNm": 4.5, "toleranceNm": 0.4 } }
        ]
        """);

        var warnings = new List<string>();
        var machines = FleetConfig.Load(path, warnings.Add);

        var survivor = Assert.Single(machines);
        Assert.Equal("SCRW-GOOD", survivor.Code);
        Assert.Equal("M6", survivor.ScrewTorque!.ScrewCode);
        Assert.Contains(warnings, w => w.Contains("SCRW-BAD") && w.Contains("skipped"));
    }

    /// <summary>A roster authored before this member existed parses byte-for-byte as it did: the key is
    /// absent, the descriptor's declaration is null, and nothing else on the entry moves.</summary>
    [Fact]
    public void A_roster_written_before_the_declaration_existed_still_parses()
    {
        var path = Path.Combine(TempDir(), "fleet.json");
        File.WriteAllText(path, """
        [
          { "code": "SCRW-OLD", "serialSeed": "SN-O", "deviceClass": "automation", "machineType": "SCREWDRIVE",
            "stepType": "screw_tightening", "driverKind": "simulated", "recipeCode": "RC1", "mappingProfile": null,
            "cycleSeconds": 0.8 }
        ]
        """);

        var m = Assert.Single(FleetConfig.Load(path));
        Assert.Null(m.ScrewTorque);
        Assert.Equal("SCRW-OLD", m.Code);
        Assert.Equal(0.8, m.CycleSeconds);
        Assert.Equal(DriverKinds.Simulated, m.DriverKind);
    }

    /// <summary>Walks up from the test binary to <c>tools/machine-simulator/</c>, the same technique
    /// <c>PackagingFleetJsonTests</c> uses, so test (iii) runs against the file that actually ships rather
    /// than a fixture copy of it.</summary>
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
}
