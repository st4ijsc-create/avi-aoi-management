using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Drivers.Simulators;

/// <summary>
/// Ép (ASSEMBLY, press-fit) — doc-62 §6: lực ép N + độ sâu mm.
///
/// <para>🔴 <b>OWNER'S RULING 2026-08-24, item 43 — DIRECTION A: THE PRESS FORCE NOW HAS AN ACCEPTANCE
/// BAND, AND THE BAND IS DECLARED AN ASSUMPTION.</b> Quoted verbatim from the ruling: <i>"Các còn số đang
/// có đều là giả định và dùng để test nên ko cần quan tâm tính chính xác của nó, hãy đảm bảo rằng logic
/// code của chức năng trong các trường hợp là đúng là được"</i>. Until that ruling this class passed
/// neither limit to <see cref="VerdictHelper"/>, so its first branch answered
/// <see cref="Verdict.Warn"/> for EVERY reading and <see cref="Verdict.Pass"/> and
/// <see cref="Verdict.Fail"/> were unreachable — doc-62 §6's "chưa seed spec → warn-only" row behaving as
/// written, and an assembly cell that could not be quality-penalised because Warn counts as GOOD for OEE
/// (owner-decisions item 2). Measured before the ruling on the shipped <c>ASSY-01</c> descriptor, seed 11,
/// 100 000 cycles: <b>Pass 0, Warn 100 000, Fail 0, Quality 1.000000000000</b>.</para>
///
/// <para>🔴 <b>WHICH EXEMPTIONS THIS TOUCHES, NAMED RATHER THAN WALKED PAST.</b> Two of the three standing
/// exemptions are crossed here and both are crossed WITH PERMISSION, granted 2026-08-24, for the reason the
/// ruling itself gives (the numbers are assumptions used for test). (a) <b>The reported OEE number</b>: any
/// band that makes Fail reachable lowers <c>ASSY-01</c>'s Quality below 1.0, and that is the shift item
/// 43's own record says the 2026-08-23 ruling had already accepted and never received. (b) <b>The MQTT
/// payload</b>: <c>Normalizer</c> carries the verdict out as <c>result</c> and copies <c>lsl</c>/<c>usl</c>
/// into the envelope, so both move for this machine. <b>The third exemption — the SHAPE of the data on the
/// wire — is NOT crossed and was not opened</b>: <c>MetricSample</c> already carried nullable
/// <c>Lsl</c>/<c>Usl</c>, <c>Normalizer</c> already writes both keys unconditionally, and this change moves
/// their VALUES from null to numbers without adding, removing or retyping a field.</para>
/// </summary>
public sealed class AssemblySim : SimulatorBase
{
    private const double ForceMean = 450.0, ForceStd = 25.0;
    private const double DepthMean = 8.0, DepthStd = 0.3;

    /// <summary>🔴 <b>AN ASSUMED acceptance limit, and the name says so at every use site because the
    /// number cannot be read without it</b> — owner's ruling 2026-08-24, item 43, direction A. No source in
    /// this repository states what a valid <c>press_force</c> is: BM-1's 2026-08-23 census over every
    /// <c>*.cs</c>, <c>*.json</c>, <c>*.ts</c>, <c>*.tsx</c>, <c>*.md</c>, <c>*.ps1</c> and <c>*.sh</c> in
    /// the tree found the identifier in exactly three places — this file, <c>docs/owner-decisions.md</c>,
    /// and <c>press_fit</c> as a <c>stepType</c> — with no recipe, no <c>MachineParameterSchema</c> entry
    /// (<c>ConfigKindForMachineType("ASSEMBLY")</c> returns null and
    /// <c>UnconsumedConfigKindsTests</c> pins that), and no <c>MachineDescriptor</c> member. That census is
    /// re-run and unchanged. <b>450 ± 50 N is therefore a decision, not a measurement</b>: a round ±11%
    /// window on this class's own <c>N(450, 25)</c> draw, chosen so all three verdicts are reachable at a
    /// rate a reader can actually see.
    ///
    /// <para><b>Why the CONSTANT NAME carries the word rather than a comment.</b> The reader of this number
    /// is a developer reading C#, and this type has no config store, no <c>configKind</c> and no roster
    /// member to hang the declaration on — so there is no operator-facing surface where the assumption
    /// could live. The name is the one place it cannot be skipped: <c>AssumedForceLsl</c> appears in the
    /// verdict call and in the published <c>MetricSample</c>, so both sites read as assumptions at a
    /// glance. <b>It is not a runtime flag</b> — nothing branches on it, and downstream the wire carries the
    /// number with no marker that it was assumed. That gap is real and is stated rather than
    /// hidden.</para></summary>
    private const double AssumedForceLsl = 400.0;

    /// <summary>The upper half of the same assumed band; see <see cref="AssumedForceLsl"/> for why it is
    /// assumed, who reads it, and what the label does not do.</summary>
    private const double AssumedForceUsl = 500.0;

    /// <summary>Builds an ASSEMBLY model with no tuning surface at all. It passes neither a
    /// <c>configKind</c> nor a <c>MachineConfigStore</c> to <see cref="SimulatorBase"/> and accepts no
    /// argument that could supply either, so <c>ResolveEffectiveConfig</c> answers null for this instance's
    /// whole life and <see cref="SimulatorBase.CycleSecondsOverride"/> keeps the base's null — cadence is
    /// <see cref="MachineDescriptor.CycleSeconds"/>.
    ///
    /// <para>Unlike <see cref="WelderSim"/> and <see cref="DispensingSim"/>, that is not a gap here: machine
    /// type <c>ASSEMBLY</c> has no <c>configKind</c> in <c>MachineParameterSchema</c> at all — that class
    /// names <c>ASSEMBLY</c>, <c>LEAK_TEST</c> and <c>FUNCTIONAL_TEST</c> in its own remarks as types with no
    /// operating-configuration parameter set — so there is nothing an operator could set that this
    /// constructor is failing to read.</para></summary>
    public AssemblySim(MachineDescriptor d, int seed) : base(d, seed)
    {
    }

    /// <summary>Draws a press force from <c>N(450, 25)</c> N and a depth from <c>N(8, 0.3)</c> mm, judges
    /// the FORCE against the assumed band <c>[400, 500]</c> N, and publishes that band with the force.
    ///
    /// <para><b>All three verdicts are reachable now, and the bands are stated rather than left to be
    /// re-derived.</b> <c>VerdictHelper</c>'s two-sided margin is <c>(500 − 400) × 0.15 = 15</c> N, so:
    /// Pass in <c>(415, 485)</c>; Warn in <c>[385, 415]</c> and <c>[485, 515]</c> — the near-edge band on
    /// BOTH sides of BOTH limits; Fail below 385 or above 515. Measured on the shipped <c>ASSY-01</c>
    /// descriptor, seed 11, 100 000 cycles, and recorded beside the before-figures in this class's
    /// remarks — the numbers are in <c>docs/owner-decisions.md</c> item 43 and pinned by
    /// <c>AssumedProcessBandTests</c>.</para>
    ///
    /// <para>🔴 <b><c>press_depth</c> IS STILL NOT JUDGED, AND THAT IS A DECISION WITH A MEASURED REASON,
    /// not an omission carried forward.</b> Item 43's direction A offers a depth band as optional ("nếu
    /// anh muốn"). It was measured and refused, for two reasons that each stand alone. (1) A reading
    /// carries ONE <see cref="DeviceReading.Verdict"/>, so judging two metrics needs a FOLD rule, and this
    /// tree has exactly one precedent for folding — <see cref="ScrewdriveSim"/>'s plan tally, which folds
    /// only NG into Fail and cannot express a depth Warn. Inventing a second fold semantics is a design
    /// decision the ruling did not delegate, and <c>VerdictFoldingCensusTests</c> exists precisely because
    /// unexamined folds accumulate. (2) Declaring depth limits WITHOUT judging them would reproduce, at a
    /// second simulator, the exact residue that is open on the owner's shelf as item 62 — a reading that
    /// publishes a limit pair its own verdict does not use, so a reader who re-derives the verdict from the
    /// published limits gets a different answer. So <c>press_depth</c> keeps null limits: it publishes no
    /// promise it does not keep. What remains true, and is not fixed here, is item 43's original sentence
    /// that depth "is never judged even in principle".</para>
    ///
    /// <para>Step type is the descriptor's own or the literal <c>press_fit</c>.</para></summary>
    public override DeviceReading NextCycle(long cycle)
    {
        var rng = Rng(cycle);
        var force = rng.NextGaussian(ForceMean, ForceStd);
        var depth = rng.NextGaussian(DepthMean, DepthStd);

        var reading = NewReading(cycle, ReadingKind.ProcessResult, Descriptor.StepType ?? "press_fit");
        reading.Metrics.Add(new MetricSample("press_force", force, "N", AssumedForceLsl, AssumedForceUsl, ForceMean));
        reading.Metrics.Add(new MetricSample("press_depth", depth, "mm", null, null, DepthMean));
        reading.Verdict = VerdictHelper.Evaluate(force, AssumedForceLsl, AssumedForceUsl);
        return reading;
    }
}
