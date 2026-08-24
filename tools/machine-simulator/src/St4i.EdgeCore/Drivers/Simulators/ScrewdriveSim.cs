using St4i.EdgeCore.Config;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Drivers.Simulators;

/// <summary>
/// Bắt vít (SCREWDRIVE) — doc-62 §6: torque ~N(12.0,0.4)Nm + angle ~N(350,10)°, waveform
/// torque-vs-angle (ramp). Verdict from torque vs. seeded LSL/USL.
///
/// Task 3 (docs/plans/2026-07-21-machine-config.md §4): when constructed with a
/// <see cref="MachineConfigStore"/>, the fixed constants below are only the FALLBACK used until a config
/// is wired — <see cref="NextCycle"/> instead re-resolves <c>torqueTarget</c>/<c>torqueTolerance</c> on
/// every cycle (see class remarks on the formula), and <see cref="CycleSecondsOverride"/> re-resolves
/// <c>speedRpm</c>/<c>clampTimeMs</c> into a cadence.
///
/// <b>Torque model</b> — <c>torque ~ N(torqueTarget, torqueTarget·ProcessNoiseFraction)</c>: the mean
/// tracks the operator's target directly; the standard deviation is a FIXED FRACTION of the target
/// (representing the tool's own inherent mechanical repeatability, e.g. rated as "±3% of reading" the
/// way real torque drivers are), deliberately NOT derived from <c>torqueTolerance</c> — physically, an
/// operator tightening the ACCEPTANCE window does not make the tool itself more repeatable. The pass/fail
/// band is <c>[torqueTarget − torqueTolerance, torqueTarget + torqueTolerance]</c>. Because the process
/// std stays fixed while the band narrows, tightening <c>torqueTolerance</c> shrinks the band's z-score
/// (band ÷ std) and therefore monotonically raises the NG rate — the exact "siết dung sai ⇒ nhiều NG hơn"
/// design-doc §4 requirement, verified statistically by <c>MachineConfigDrivesSimulationTests</c>.
///
/// <b>Cadence model</b> — <c>cycleSeconds = HandlingOverheadSeconds + (SpinRevolutions ÷ (speedRpm÷60)) +
/// clampTimeMs÷1000</c>: a fixed pick/place/tool-positioning overhead, plus how long a fixed number of
/// screw revolutions takes to spin at the configured rpm, plus the configured clamp dwell. Monotonic in
/// both directions an operator expects: faster <c>speedRpm</c> ⇒ shorter cycle; longer <c>clampTimeMs</c>
/// ⇒ longer cycle.
/// </summary>
public sealed class ScrewdriveSim : SimulatorBase
{
    private const double TorqueMean = 12.0, TorqueStd = 0.4;
    private const double TorqueLsl = 10.8, TorqueUsl = 13.2;
    private const double AngleMean = 350.0, AngleStd = 10.0;
    private const int WaveformPoints = 20;

    /// <summary>Fraction of <c>torqueTarget</c> used as the generated torque's standard deviation — the
    /// tool's own fixed mechanical repeatability, independent of the operator-set tolerance band. See
    /// class remarks.</summary>
    private const double ProcessNoiseFraction = 0.03;

    /// <summary>Fixed number of screw revolutions the cadence model spins through at <c>speedRpm</c>.</summary>
    private const double SpinRevolutions = 3.0;

    /// <summary>Fixed pick/place/tool-positioning overhead the cadence model adds regardless of config.</summary>
    private const double HandlingOverheadSeconds = 0.2;

    /// <summary>Same floor value the fleet lifecycle's own <c>FleetCore.MinCycleSeconds</c> uses — a
    /// cadence must never reach zero/negative even at extreme config values. 🔴 Task E-2: the old text here
    /// said "mirrored, not shared, since EdgeCore doesn't reference EngineApi", and that reason no longer
    /// holds — <c>FleetCore</c> now lives in this assembly. Kept separate on purpose; see
    /// <see cref="IotSensorSim"/>'s own <c>MinCycleSecondsFloor</c> for the full reasoning (two independent
    /// clamps on two different quantities, agreeing at 0.05 by intention rather than derivation).</summary>
    private const double MinCycleSecondsFloor = 0.05;

    /// <summary>WS3-T1 — fixed number of physical fastening positions this cycle's plan visits: a
    /// plausible small-board layout (matches the flavor of the seeded automation recipe's own
    /// <c>screwCount</c>, see <c>ProductConfigStore.SeedRecipes</c>), on the same "fixed constant"
    /// footing as <see cref="SpinRevolutions"/>/<see cref="WaveformPoints"/> above — the schema has no
    /// per-board screw-count parameter to drive this from.</summary>
    private const int FasteningPositionsPerCycle = 4;

    /// <summary>Builds a SCREWDRIVE model and declares its config kind as
    /// <see cref="MachineParameterSchema.ScrewProgram"/>, which is what makes the whole live-config path
    /// below reachable. See <see cref="SimulatorBase"/>'s own constructor for what each argument does and
    /// for the two failure modes a <paramref name="configStore"/> brings with it — in particular that
    /// passing one makes this constructor <see cref="MachineConfigStore.Ensure"/> a <c>screw_program</c>
    /// record for <paramref name="d"/>'s code, which WRITES A FILE on first construction and throws
    /// <see cref="InvalidOperationException"/> if that machine already has a record under another kind.
    ///
    /// <para>🔴 <b>This type is also the factory's last-resort fallback, so machines that are not
    /// screwdrivers are built here.</b> <c>SimulatorFactory.Create</c> reaches
    /// <c>FallbackByDeviceClass</c> for any <see cref="MachineDescriptor.MachineType"/> its switch does not
    /// recognise, and that method's own default arm — everything that is not
    /// <see cref="DeviceClass.Iot"/> or <see cref="DeviceClass.AoiAvi"/> — constructs this class. With a
    /// store wired, such a machine therefore gets a <c>screw_program</c> record ensured and persisted under
    /// its code, while <c>MachineParameterSchema.ConfigKindForMachineType</c> returns null for its unknown
    /// type and the machine-settings API answers "unsupported machine type" for the very same
    /// machine.</para>
    ///
    /// <para><paramref name="cycleRateMultiplier"/> matters here and not for most siblings, because this is
    /// one of only two types that define a config-derived <see cref="CycleSecondsOverride"/>; see that
    /// property.</para></summary>
    public ScrewdriveSim(MachineDescriptor d, int seed, MachineConfigStore? configStore = null, Func<string?>? productCodeProvider = null, double cycleRateMultiplier = 1.0)
        : base(d, seed, MachineParameterSchema.ScrewProgram, configStore, productCodeProvider, cycleRateMultiplier)
    {
    }

    /// <summary>Resolves the live config once at the top, derives the torque distribution and the pass band
    /// from it (falling back to the constants above when no store is wired), draws torque and angle, builds
    /// the torque-vs-angle waveform, judges the torque, and then builds the four-position fastening plan
    /// described at <see cref="BuildFasteningPlan"/>.
    ///
    /// <para><b>The plan can only make the verdict worse.</b> After the primary judgement, any step whose
    /// own result is NG forces the reading to <see cref="Verdict.Fail"/>; nothing in this method can move a
    /// verdict the other way. So a Pass primary torque can leave with a Fail reading, and a Warn primary
    /// with no NG step stays Warn — the aggregate is a tally, not a re-judgement.</para>
    ///
    /// <para><b>Of the five <c>screw_program</c> parameters, this class reads four.</b>
    /// <c>torqueTarget</c> and <c>torqueTolerance</c> here, <c>speedRpm</c> and <c>clampTimeMs</c> in
    /// <see cref="CycleSecondsOverride"/>. <c>angleTarget</c> reaches no draw: the angle metric is always
    /// <c>N(350, 10)</c> from the constants above, is published with no LSL/USL, and takes no part in the
    /// verdict — so an operator who edits <c>angleTarget</c> changes the stored record and nothing this
    /// machine reports.</para>
    ///
    /// <para>🔴 <b>WHEN THE DESCRIPTOR DECLARES, THE STORE NO LONGER DECIDES THE BAND — owner's ruling
    /// 2026-08-23, item 41.</b> A descriptor carrying a <see cref="MachineDescriptor.ScrewTorque"/> gets its
    /// target and tolerance from THAT, wired or un-wired, so all three hosts of this product report one
    /// physics for one roster entry. An operator adjustment still wins over the declaration — see
    /// <see cref="ResolveTorqueBand"/> for the exact precedence and for why it is keyed on PROVENANCE rather
    /// than on the value.</para>
    ///
    /// <para>🔴 <b>With NO declaration, wiring a store still changes the reported torque by roughly a factor
    /// of nine before any operator touches anything, and that is UNCHANGED on purpose.</b> The un-wired path
    /// draws <c>N(12.0, 0.4)</c> Nm against <c>[10.8, 13.2]</c>. A freshly ensured record is seeded from the
    /// schema's own defaults, so the wired path resolves <c>torqueTarget = 1.35</c> and
    /// <c>torqueTolerance = 0.15</c> and draws <c>N(1.35, 0.0405)</c> against <c>[1.20, 1.50]</c>. Both are
    /// plausible screwdrivers and both keep the monotonicity the design doc asks for; what they do not do is
    /// agree on the value, and NOTHING in this repository says which one the shipped roster means. Choosing
    /// one here would have been choosing a screw on the owner's behalf, so the undeclared case is REPORTED
    /// instead — <see cref="St4i.EdgeCore.Infrastructure.FleetConfig.Load"/> emits
    /// <see cref="ScrewTorqueSpec.DescribeUndeclared"/> once per undeclared SCREWDRIVE, naming both
    /// candidates and picking neither.</para>
    ///
    /// <para><b>The measurement behind that, re-taken at commit <c>334575b2</c></b> (and it corrects the
    /// record in two places): there are FOUR <c>SimulatorFactory.Create</c> call sites in <c>src/</c> across
    /// THREE hosts, split 2–2 — <c>FleetCore.BuildStartPlan</c> and <c>FleetCore.StartLocked</c>'s
    /// reuse-miss arm pass <c>_configStore</c>; <c>St4i.EdgeService.EdgeWorker</c> and
    /// <c>St4iMachineSimulator.Services.FleetService.BuildSimulator</c> pass none. Both of the first pair
    /// are in <c>FleetCore</c>, but only ONE of them is in <c>StartLocked</c> — the other was hoisted off
    /// the gate into <c>BuildStartPlan</c> by task J-1, which is why <c>docs/owner-decisions.md</c> §41.1's
    /// cell naming them "hai chỗ trong <c>StartLocked</c>" is wrong about the first. And the same §41.1
    /// says THIS doc comment writes <i>"hai host"</i>: measured over all 63447 files of that commit, the
    /// strings <c>two host</c> and <c>hai host</c> appear NOWHERE in the tree, and the only occurrence of
    /// <c>host</c> in this file was the sentence "…under one host and about 1.35 Nm under another", which
    /// counted BEHAVIOURS, not hosts, and was true.</para>
    ///
    /// <para><b>Two independent config resolutions happen inside one cycle</b> — this method's own, and a
    /// second one through <see cref="CycleSecondsOverride"/> when the plan's duration is computed. They are
    /// separate reads of a store another thread may write between, which is the cost of the "never memoize"
    /// rule <c>SimulatorBase.ResolveEffectiveConfig</c> states.</para></summary>
    public override DeviceReading NextCycle(long cycle)
    {
        var rng = Rng(cycle);
        var cfg = ResolveEffectiveConfig();

        var (torqueTarget, torqueStd, lsl, usl) = ResolveTorqueBand(cfg);

        var torque = rng.NextGaussian(torqueTarget, torqueStd);
        var angle = rng.NextGaussian(AngleMean, AngleStd);
        var waveform = BuildTorqueAngleWaveform(rng, torque, angle);

        var reading = NewReading(cycle, ReadingKind.ProcessResult, Descriptor.StepType ?? "screw_tightening");
        reading.Metrics.Add(new MetricSample("torque", torque, "Nm", lsl, usl, torqueTarget));
        reading.Metrics.Add(new MetricSample("angle", angle, "deg", null, null, AngleMean));
        reading.Waveforms.Add(waveform);
        reading.Verdict = VerdictHelper.Evaluate(torque, lsl, usl);

        // WS3-T1 — the fastening-sequence plan for the twin. Step 0 reuses THIS SAME torque draw/verdict
        // (never a second, independently-drawn "claim" about the primary screw); steps 1..N-1 draw fresh
        // from the identical resolved distribution. Any step's own NG is then folded into the reading's
        // aggregate Verdict below — "aggregate == per-step tally" (design-doc §3.4/§4), not a second,
        // disagreeing narrative. With the schema-default torqueTolerance this almost never fires (the
        // baseline NG rate stays near zero, same as before this task); a tightened torqueTolerance makes
        // it fire far more often, exactly the "siết dung sai ⇒ nhiều điểm đỏ hơn trên bản vẽ" WS3-T1
        // exists to expose.
        var plan = BuildFasteningPlan(
            rng, cycle, reading.Timestamp, CycleSecondsOverride ?? Descriptor.CycleSeconds,
            torqueTarget, torqueStd, lsl, usl, torque, reading.Verdict);
        if (plan.Steps.Any(s => s.Result == "NG")) reading.Verdict = Verdict.Fail;
        reading.Plan = plan;

        return reading;
    }

    /// <summary>🔴 OWNER'S RULING 2026-08-23, item 41 — the ONE place this class decides what physics it is
    /// reporting, extracted so there is a single answer to "where does the torque band come from" instead of
    /// three ternaries a reader has to intersect.
    ///
    /// <para><b>Precedence, highest first, and each rung states who owns it.</b>
    /// (1) an OPERATOR adjustment in <paramref name="cfg"/> — machine- or product-scoped, i.e. any
    /// <see cref="EffectiveParameter.Source"/> that is not <see cref="ConfigProvenance.Baseline"/>;
    /// (2) the DEPLOYMENT's <see cref="MachineDescriptor.ScrewTorque"/> declaration;
    /// (3) the store's baseline, when there is a store and no declaration;
    /// (4) this class's own constants, when there is neither.</para>
    ///
    /// <para>🔴 <b>Rung 1 is keyed on PROVENANCE, not on the value, and that is load-bearing.</b> A
    /// baseline of 1.35 and an operator adjustment that happens to also be 1.35 are the same number and
    /// different facts; comparing values would have made a deliberate operator setting invisible whenever it
    /// coincided with the seed. Because it reads <see cref="EffectiveParameter.Source"/>, declaring a band
    /// does NOT take the settings screen away from an operator: the "siết dung sai ⇒ nhiều NG hơn" property
    /// <c>MachineConfigDrivesSimulationTests</c> pins is unchanged for a declared machine and for an
    /// undeclared one alike.</para>
    ///
    /// <para><b>Rungs 3 and 4 are byte-for-byte what this method did before the declaration existed</b> —
    /// including <see cref="TorqueStd"/> being an ABSOLUTE 0.4 Nm on the un-wired path while every other
    /// rung derives the spread as <see cref="ProcessNoiseFraction"/> of the target. That asymmetry is
    /// preserved deliberately: changing it would move a number the shipped roster reports today, which is
    /// exactly the thing item 41 must not do on its own authority.</para></summary>
    /// <param name="cfg">The live resolved config, or null when no store is wired.</param>
    /// <returns>Target (Nm), the generated distribution's standard deviation (Nm), and the pass band's two
    /// limits (Nm).</returns>
    private (double Target, double Std, double Lsl, double Usl) ResolveTorqueBand(EffectiveConfig? cfg)
    {
        var declared = Descriptor.ScrewTorque;
        if (declared is null)
        {
            var baseTarget = GetValue(cfg, "torqueTarget", TorqueMean);
            var baseTolerance = GetValue(cfg, "torqueTolerance", TorqueUsl - TorqueMean);
            return cfg is null
                ? (baseTarget, TorqueStd, TorqueLsl, TorqueUsl)
                : (baseTarget, Math.Max(baseTarget * ProcessNoiseFraction, 1e-6), baseTarget - baseTolerance, baseTarget + baseTolerance);
        }

        var target = AdjustedOrDeclared(cfg, "torqueTarget", declared.TargetNm);
        var tolerance = AdjustedOrDeclared(cfg, "torqueTolerance", declared.ToleranceNm);
        return (target, Math.Max(target * ProcessNoiseFraction, 1e-6), target - tolerance, target + tolerance);
    }

    /// <summary>An operator's adjustment for <paramref name="key"/> if one exists at either scope, otherwise
    /// the roster's declared value. See <see cref="ResolveTorqueBand"/> for why this asks
    /// <see cref="EffectiveParameter.Source"/> rather than comparing numbers.</summary>
    /// <param name="cfg">The resolved config, or null when no store is wired — in which case there is no
    /// adjustment layer at all and <paramref name="declared"/> is returned unchanged.</param>
    /// <param name="key">The <c>screw_program</c> parameter key to look up, case-insensitively.</param>
    /// <param name="declared">The roster's own value, returned whenever no adjustment outranks it.</param>
    /// <returns>The value this cycle should use, in Nm.</returns>
    private static double AdjustedOrDeclared(EffectiveConfig? cfg, string key, double declared)
    {
        var p = cfg?.Parameters.FirstOrDefault(x => string.Equals(x.Def.Key, key, StringComparison.OrdinalIgnoreCase));
        return p is null || p.Source == ConfigProvenance.Baseline ? declared : p.Value;
    }

    /// <summary>See <see cref="FasteningPositionsPerCycle"/> and this method's call site for the
    /// "aggregate == per-step tally" contract. Positions are evenly spaced along the board's normalized
    /// width at a fixed centreline height — pure data (this task makes no web change), for a future twin
    /// build to place the head along.</summary>
    private static CyclePlan BuildFasteningPlan(
        Random rng, long cycle, DateTimeOffset startedAt, double durationSeconds,
        double torqueTarget, double torqueStd, double lsl, double usl,
        double primaryTorque, Verdict primaryVerdict)
    {
        var steps = new List<CyclePlanStep>(FasteningPositionsPerCycle);
        for (var i = 0; i < FasteningPositionsPerCycle; i++)
        {
            double torque;
            Verdict verdict;
            if (i == 0)
            {
                // The exact same draw/verdict already computed above — not a second, disagreeing sample.
                torque = primaryTorque;
                verdict = primaryVerdict;
            }
            else
            {
                torque = rng.NextGaussian(torqueTarget, torqueStd);
                verdict = VerdictHelper.Evaluate(torque, lsl, usl);
            }

            var nx = FasteningPositionsPerCycle == 1
                ? 0.5
                : 0.2 + i * (0.6 / (FasteningPositionsPerCycle - 1));

            steps.Add(new CyclePlanStep(
                Index: i,
                PointCode: $"FSTN-{i + 1:D2}",
                NormalizedX: nx,
                NormalizedY: 0.5,
                Result: verdict == Verdict.Fail ? "NG" : "OK",
                // 🔴 OWNER'S RULING 2026-08-24, item 70 — DIRECTION A ONLY: the rounding is dropped, so
                // step 0 and the published `spc` series carry the SAME double for the SAME draw instead of
                // two renderings of it. `Math.Round(torque, 3)` stood here and its worst-case error was
                // 5e-4 Nm; re-measured 2026-08-24 and that bound holds (see item 70 §70.5).
                //
                // 🔴 AND WHAT DIRECTION A DOES NOT BUY, WRITTEN AT THE LINE IT CHANGES, because the item
                // it belongs to is about something else entirely. Item 70's headline is that this response
                // ships FOUR torque numbers for ONE cycle while ingest, SPC and the historian each ship
                // ONE. This edit does not remove a single one of those three extra draws — steps 1..3 are
                // untouched, they still decide the reading's verdict (see NextCycle), and they still exist
                // on no other surface. It removes an 0.0005 Nm discrepancy between two of the four.
                // Directions B (delete the extra draws — moves OEE Quality) and C (persist them — widens a
                // published payload) were NOT authorised and remain the owner's.
                //
                // 🔴 AND IT DOES NOT MAKE THIS RESPONSE SELF-CONSISTENT EITHER. `MachineState.FormatKeyMetric`
                // renders the same primary draw as a STRING with the format "0.###" — three decimals, and
                // away-from-zero at the midpoint where Math.Round was to-even. So `cycleLog[last].keyMetric`
                // still disagrees with `spc.values[last]` in the same digit this line used to. Naming it
                // here rather than letting the next reader think item 70 was closed by this.
                MetricValue: torque,
                Unit: "Nm"));
        }

        return new CyclePlan(cycle, startedAt, durationSeconds, steps);
    }

    /// <summary>Task 3 cadence model — see class remarks. Returns null (no override — the driver falls
    /// back to <see cref="MachineDescriptor.CycleSeconds"/>) when this instance has no
    /// <see cref="MachineConfigStore"/> wired.
    ///
    /// I-5 (mc-feature-review.md) — the config-derived cadence is divided by <see cref="SimulatorBase.CycleRateMultiplier"/>
    /// before the floor is applied, composing it with whichever scenario is active instead of silently
    /// ignoring it (a config override used to always win outright over the descriptor-baked multiplier —
    /// see that property's doc comment). A multiplier &gt;1 (e.g. <c>sensor-drift</c>'s 5x, Burst's 6x)
    /// shortens the resulting cadence, exactly as it already does for every un-wired simulator.</summary>
    public override double? CycleSecondsOverride
    {
        get
        {
            var cfg = ResolveEffectiveConfig();
            if (cfg is null) return null;

            var speedRpm = GetValue(cfg, "speedRpm", 450);
            var clampTimeMs = GetValue(cfg, "clampTimeMs", 250);
            var spinSeconds = SpinRevolutions * 60.0 / Math.Max(speedRpm, 1e-6);
            var cycleSeconds = (HandlingOverheadSeconds + spinSeconds + clampTimeMs / 1000.0) / CycleRateMultiplier;
            return Math.Max(cycleSeconds, MinCycleSecondsFloor);
        }
    }

    /// <summary>Monotonic ramp from 0 to the final (angle, torque), with small per-sample noise —
    /// stands in for the torque-vs-angle curve a real screwdriver controller streams.</summary>
    private static WaveformSeries BuildTorqueAngleWaveform(Random rng, double finalTorque, double finalAngle)
    {
        var samples = new List<double[]>(WaveformPoints);
        for (var i = 1; i <= WaveformPoints; i++)
        {
            var frac = (double)i / WaveformPoints;
            var angle = finalAngle * frac;
            var torque = finalTorque * frac + (rng.NextDouble() - 0.5) * 0.05;
            samples.Add(new[] { angle, torque });
        }

        return new WaveformSeries("torque_vs_angle", "Nm", null, samples);
    }
}
