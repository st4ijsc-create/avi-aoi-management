using St4i.EdgeCore.Config;

namespace St4i.EdgeCore.Models;

/// <summary>
/// 🔴 OWNER'S RULING 2026-08-23, item 41 — <b>WHICH SCREW IS THIS MACHINE DRIVING?</b> The declaration a
/// SCREWDRIVE roster entry makes about its own physics, so that the answer comes from the ROSTER and not
/// from which host happened to start the machine.
///
/// <para><b>The defect this exists for, stated as a property rather than as an incident.</b>
/// <see cref="Drivers.Simulators.ScrewdriveSim"/> resolved its torque band two different ways depending on
/// whether a <see cref="MachineConfigStore"/> was wired: the un-wired path drew <c>N(12.0, 0.4)</c> Nm
/// against <c>[10.8, 13.2]</c> from the class's own constants, and the wired path drew
/// <c>N(1.35, 0.0405)</c> against <c>[1.20, 1.50]</c> because a freshly ensured <c>screw_program</c> record
/// is seeded from <see cref="MachineParameterSchema"/>'s defaults. Measured at commit <c>334575b2</c>: of
/// the four <c>SimulatorFactory.Create</c> call sites in <c>src/</c>, the two in <c>FleetCore</c>
/// (<c>BuildStartPlan</c> and <c>StartLocked</c>'s reuse-miss arm) pass a store and the two in
/// <c>St4i.EdgeService.EdgeWorker</c> and <c>St4iMachineSimulator.Services.FleetService</c> do not — so ONE
/// descriptor reported two physical quantities roughly a factor of nine apart, under three hosts of one
/// product, with nothing in the tree saying which was meant.</para>
///
/// <para>🔴 <b>This type does NOT settle which of the two is right, and it must not be read as doing
/// so.</b> Both <c>1.35</c> Nm (an M4 machine screw) and <c>12.0</c> Nm (a bolt) are legal here, and both
/// sit inside <see cref="MachineParameterSchema"/>'s hard band — that was true before this type existed and
/// is still true. What changes is that the question is now ANSWERABLE by the roster: a descriptor that
/// declares one gets that one under every host, and a descriptor that declares neither is reported as
/// undeclared rather than silently resolved differently per host (see
/// <see cref="Infrastructure.FleetConfig.Load"/>'s undeclared warning and
/// <see cref="DescribeUndeclared"/>).</para>
///
/// <para><b>Why it lives on <see cref="MachineDescriptor"/> and not in <see cref="MachineConfigStore"/>,
/// inferred from who must WRITE it and who must READ it.</b> It must be readable by all three hosts; the
/// only per-machine artefact all three already hand to <see cref="Drivers.Simulators.SimulatorFactory.Create"/>
/// is the descriptor (from <c>fleet.json</c> via
/// <see cref="Infrastructure.FleetConfig.Load"/>, or hand-built by an onboarding path). The config store is
/// exactly what the other two hosts do NOT have — putting the declaration there would have re-created the
/// asymmetry it exists to close. It must be writable by the DEPLOYMENT (a hand-edited <c>fleet.json</c>
/// next to the exe, the shipping convention README §10 already documents) rather than only by an operator
/// at an HMI, because a machine's screw size is a commissioning fact, not a shift-by-shift adjustment. The
/// operator's per-shift dimension is unchanged and still lives in the store: a machine- or product-scoped
/// <c>torqueTarget</c>/<c>torqueTolerance</c> adjustment still overrides this declaration — see
/// <see cref="Drivers.Simulators.ScrewdriveSim.NextCycle"/>.</para>
/// </summary>
/// <param name="ScrewCode">The fastener this machine drives, as the deployment names it — e.g.
/// <c>"M4"</c>, <c>"M10"</c>, or a site's own part code. Free text on purpose: this repository has no screw
/// catalogue and inventing one would be a second, unowned vocabulary (the same reason
/// <see cref="MachineDescriptor.MachineType"/> is a free string). It is REQUIRED and must be non-blank —
/// a torque band with no fastener name is half a declaration, and the half it is missing is the half a
/// human reads. It takes no part in any draw; it is the audit trail for WHY the band is what it is.</param>
/// <param name="TargetNm">The torque this machine aims for, in NEWTON-METRES. Validated against the same
/// hard band <see cref="MachineParameterSchema"/> enforces for <c>screw_program</c>'s <c>torqueTarget</c>
/// (0.10–20.00 Nm) — the SAME rule the REST write path uses, not a second one, so a value legal here is
/// legal there and vice versa. 🔴 Out of range THROWS
/// <see cref="ArgumentOutOfRangeException"/>; it is never clamped.</param>
/// <param name="ToleranceNm">Half-width of the acceptance band, in NEWTON-METRES: the pass band is
/// <c>[TargetNm − ToleranceNm, TargetNm + ToleranceNm]</c>. Validated against <c>screw_program</c>'s
/// <c>torqueTolerance</c> band (0.00–5.00 Nm) by the same call. It does NOT set the process spread — the
/// generated standard deviation stays a fixed fraction of the target (the tool's own repeatability), which
/// is what makes tightening this value raise the NG rate rather than merely narrow the drawing; see
/// <see cref="Drivers.Simulators.ScrewdriveSim"/>'s class remarks.</param>
public sealed record ScrewTorqueSpec(string ScrewCode, double TargetNm, double ToleranceNm)
{
    /// <summary>The <c>fleet.json</c> property name this is authored under, kept as a constant so the
    /// loader's warning text and any future writer name the same key the deserializer reads.</summary>
    public const string JsonPropertyName = "screwTorque";

    /// <summary>See the <c>ScrewCode</c> parameter. Redeclared with an initializer purely so the check
    /// below runs: a positional record's primary constructor cannot carry statements, and this is the one
    /// shape that validates EVERY construction path — hand-built, JSON-deserialized, or produced by
    /// <see cref="Infrastructure.FleetConfig.Load"/>. 🔴 It does NOT re-run for a <c>with</c>-expression
    /// (records copy through the compiler-generated copy constructor, which skips initializers), so a
    /// <c>with</c> can carry a validated value onto a new instance but cannot introduce an unvalidated one
    /// except by naming this member — a ceiling stated here rather than left for a reader to
    /// discover.</summary>
    public string ScrewCode { get; init; } = !string.IsNullOrWhiteSpace(ScrewCode)
        ? ScrewCode
        : throw new ArgumentException(
            $"{JsonPropertyName}.screwCode must name the fastener (e.g. \"M4\") — a torque band with no fastener name does not say which screw this machine is driving.",
            nameof(ScrewCode));

    /// <summary>See the <c>TargetNm</c> parameter; validated by
    /// <see cref="MachineParameterSchema.ValidateRange"/> against <c>screw_program</c>'s own
    /// <c>torqueTarget</c> definition, so the roster and the REST write path enforce ONE rule.</summary>
    public double TargetNm { get; init; } = ValidatedAgainstSchema("torqueTarget", TargetNm);

    /// <summary>See the <c>ToleranceNm</c> parameter; validated against <c>screw_program</c>'s own
    /// <c>torqueTolerance</c> definition by the same call.</summary>
    public double ToleranceNm { get; init; } = ValidatedAgainstSchema("torqueTolerance", ToleranceNm);

    /// <summary>Runs <paramref name="value"/> through the hard band <see cref="MachineParameterSchema"/>
    /// already publishes for <paramref name="key"/> under <c>screw_program</c> and returns it unchanged, or
    /// throws <see cref="ArgumentOutOfRangeException"/> naming the allowed range. Never clamps — the same
    /// rule, and the same message, an operator gets from the REST surface.</summary>
    /// <param name="key">A <c>screw_program</c> parameter key that must exist in the schema; this type only
    /// ever passes the two it declares, so a null lookup here would be a programming error, not input.</param>
    /// <param name="value">The value to check.</param>
    /// <returns><paramref name="value"/>, unchanged.</returns>
    private static double ValidatedAgainstSchema(string key, double value)
    {
        var def = MachineParameterSchema.ParameterFor(MachineParameterSchema.ScrewProgram, key)
            ?? throw new InvalidOperationException($"screw_program has no \"{key}\" parameter — schema and this type have diverged.");
        MachineParameterSchema.ValidateRange(def, value);
        return value;
    }

    /// <summary>The pass band's lower limit, in Nm.</summary>
    public double Lsl => TargetNm - ToleranceNm;

    /// <summary>The pass band's upper limit, in Nm.</summary>
    public double Usl => TargetNm + ToleranceNm;

    /// <summary>🔴 The sentence a host prints for a SCREWDRIVE roster entry that declares NOTHING. It names
    /// BOTH outcomes and picks NEITHER — that is deliberate, and it is the whole difference between this and
    /// the silent default it replaces: the reader is told the number they are about to see is decided by the
    /// host they started, is given both candidates with their bands, and is told which key closes the
    /// question. It changes no behaviour by design; see item 41's execution record in
    /// <c>docs/owner-decisions.md</c> for the price of the two directions that would have.</summary>
    /// <param name="machineCode">The roster entry being described.</param>
    /// <returns>One line, no trailing newline, safe to hand to any <c>Action&lt;string&gt;</c> log sink.</returns>
    public static string DescribeUndeclared(string machineCode) =>
        $"machine \"{machineCode}\" is a SCREWDRIVE with no \"{JsonPropertyName}\" declaration — the torque it " +
        "reports is decided by the HOST that starts it, not by this roster: ~12.0 Nm (N(12.0, 0.4), band " +
        "[10.8, 13.2]) where no machine config store is wired, ~1.35 Nm (N(1.35, 0.0405), band [1.20, 1.50]) " +
        $"where one is. Declare \"{JsonPropertyName}\": {{ \"screwCode\": ..., \"targetNm\": ..., " +
        "\"toleranceNm\": ... } to make every host report the same physics.";
}
