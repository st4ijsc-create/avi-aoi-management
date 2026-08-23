using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Drivers.Simulators;

/// <summary>
/// Leak (LEAK_TEST) — doc-62 §6: áp suất rò Pa/s (leak/pressure-decay rate), "ngưỡng cấu hình"
/// (configurable threshold — <c>maxLeakRatePa</c> below). Lower is better, and as of the owner's ruling of
/// 2026-08-23 (item 43) the verdict finally says so: the leak rate is judged against the ONE-SIDED band
/// <c>(-∞, maxLeakRatePa]</c>, not against <c>[0, maxLeakRatePa]</c>. The published metric still declares a
/// floor of 0.0 — see <see cref="NextCycle"/> for why those two sentences differ on purpose.
/// </summary>
public sealed class LeakTestSim : SimulatorBase
{
    private const double LeakRateMean = 8.0, LeakRateStd = 3.0;
    private readonly double _maxLeakRatePa;

    /// <summary>Builds a LEAK_TEST model. Like <see cref="AssemblySim"/> it wires no
    /// <c>MachineConfigStore</c> and machine type <c>LEAK_TEST</c> has no <c>configKind</c> in
    /// <c>MachineParameterSchema</c>, so there is no live-config surface to miss;
    /// <see cref="SimulatorBase.CycleSecondsOverride"/> stays null and cadence is
    /// <see cref="MachineDescriptor.CycleSeconds"/>.
    ///
    /// <para>🔴 <b><paramref name="maxLeakRatePa"/> is the one tunable this whole file has, and no caller in
    /// this repository sets it.</b> Measured at commit <c>5e194ab0</c> over every <c>*.cs</c> in the tree:
    /// the identifier occurs only inside this file. <c>SimulatorFactory.Create</c>'s <c>LEAK_TEST</c> arm
    /// passes <c>(d, seed)</c> and has no parameter that could carry a third argument, and every test
    /// construction passes two arguments as well — so the acceptance limit is 20.0 Pa/s on every leak
    /// tester this product builds, and the "ngưỡng cấu hình" of the class remarks is configurable only in
    /// the C# sense.</para>
    ///
    /// <para>🔴 <b>OWNER'S RULING 2026-08-23, item 44: KEEP THE PARAMETER, RANGE-CHECK IT.</b> The census
    /// above is re-measured and stands at <c>47862d2a</c> — the identifier still occurs only in this file and
    /// in <c>docs/owner-decisions.md</c>, and the only NEW occurrences are the ones this ruling added: the
    /// check below and the tests that drive it. The other two directions item 44 costed — deleting a public
    /// name, or wiring it to a config store — were not taken.</para></summary>
    /// <param name="d">The roster entry; see <see cref="SimulatorBase.Descriptor"/>.</param>
    /// <param name="seed">Determinism seed, forwarded to <see cref="SimulatorBase"/> unchanged.</param>
    /// <param name="maxLeakRatePa">The upper acceptance limit in Pa/s. 🔴 <b>OWNER'S RULING 2026-08-23, item
    /// 44 — RANGE-CHECKED AND KEPT.</b> It must be a finite number strictly greater than zero; anything else
    /// throws <see cref="ArgumentOutOfRangeException"/> from this constructor, naming the parameter AND the
    /// value it was given. Before that ruling it was stored as given, and this doc comment recorded the two
    /// ways that broke the model: zero made every non-zero draw a <see cref="Verdict.Fail"/>, and a negative
    /// one inverted the band handed to <c>VerdictHelper</c>. NaN was a third way the old sentence did not
    /// name — every comparison against it is false, so it silently produced <see cref="Verdict.Pass"/> for
    /// every reading. All three are refused now.
    ///
    /// <para><b>What the check costs, said plainly:</b> nothing today and possibly something later. The
    /// measurement item 44 rests on still holds — no call site in this repository supplies this parameter,
    /// so no caller changes behaviour — but a future caller that would have passed <c>0</c> and got a
    /// silently broken tester now gets an exception at construction instead.</para></param>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="maxLeakRatePa"/> is not a finite number
    /// strictly greater than zero.</exception>
    public LeakTestSim(MachineDescriptor d, int seed, double maxLeakRatePa = 20.0) : base(d, seed)
    {
        // 🔴 Item 39 established the shape this message has to have, and the twelfth round measured SIX
        // throw sites that did not name what they were about. ArgumentOutOfRangeException's three-argument
        // overload carries the parameter NAME and the offending VALUE structurally, so neither can drift out
        // of the sentence beside them. !(x > 0) rather than (x <= 0) is deliberate: NaN fails every ordered
        // comparison, so the negated form is the one that catches it.
        if (!(maxLeakRatePa > 0.0) || double.IsInfinity(maxLeakRatePa))
        {
            throw new ArgumentOutOfRangeException(
                nameof(maxLeakRatePa), maxLeakRatePa,
                $"maxLeakRatePa must be a finite leak rate strictly greater than 0 Pa/s; got {maxLeakRatePa.ToString(System.Globalization.CultureInfo.InvariantCulture)}. " +
                "Zero fails every non-zero draw, a negative limit inverts the acceptance band, and NaN passes " +
                "every reading because no comparison against it is ever true.");
        }

        _maxLeakRatePa = maxLeakRatePa;
    }

    /// <summary>Draws a leak rate from <c>N(8, 3)</c> Pa/s and floors it at zero, then judges it against the
    /// one-sided band <c>(-∞, maxLeakRatePa]</c>. The floor is a clamp rather than a re-draw, so the
    /// distribution is truncated and the mass below zero — about 0.4% of cycles at these constants — arrives
    /// as exactly 0.0.
    ///
    /// <para>🔴 <b>OWNER'S RULING 2026-08-23, item 43 — this call no longer seeds an LSL, and that ONE
    /// argument is the whole fix.</b> Until then it passed <c>0.0</c> as the lower limit, and
    /// <c>VerdictHelper</c> applied its 15% near-edge rule to that bound like any other: margin 3.0 Pa/s at
    /// the default limit, so every leak rate at or below 3.0 Pa/s — the best result the machine can report,
    /// including every clamped 0.0 — came back <see cref="Verdict.Warn"/> for hugging a limit that is not an
    /// acceptance limit at all. Roughly 4.8% of cycles at these constants warned for being too GOOD, which is
    /// more than warned for being too leaky.</para>
    ///
    /// <para>🔴 <b>The premise item 43 states for this half does NOT survive re-measurement, and the fix is
    /// smaller because of it.</b> The item says <c>VerdictHelper</c> "has no notion of lower-is-better".
    /// It has one: <c>MarginOf</c>'s second branch is written for exactly this case and NAMES leak rate as
    /// its example ("One-sided spec (e.g. leak rate has only a USL)"). What was wrong was this call site
    /// defeating it by seeding a bound the quantity does not have. <b><c>VerdictHelper</c> is therefore
    /// UNCHANGED by this fix, and so is every other simulator that calls it.</b></para>
    ///
    /// <para><b>The bands, before and after.</b> Before: Pass only in (3.0, 17.0), Warn in [0, 3.0] and
    /// [17.0, 23.0], Fail above 23.0. After: Pass in [0, 17.0), Warn in [17.0, 23.0], Fail above 23.0.
    /// <b>The Fail boundary does not move</b>, which is the load-bearing half of that sentence — see the
    /// remark below on what does and does not follow from it.</para>
    ///
    /// <para>🔴 <b>WHAT THIS DOES NOT SHIFT, written here because item 43 predicts that it does.</b> The item
    /// says fixing this "shifts <c>Quality</c> too". Measured: it does not. Every good-count definition in
    /// this tree counts <b>Pass OR Warn</b> as good — <c>SqliteHistorianStore.AggregateForOeeAsync</c> (the
    /// numerator behind <see cref="St4i.EdgeCore.Metrics.OeeCalculator"/>'s Quality term),
    /// <c>MachineState.PassRate</c>, <c>MachineViewModel.PassRate</c> and
    /// <c>Normalizer.ComputeOverallResult</c> — and this change only moves readings from Warn to Pass, both
    /// of which are inside that set, while leaving the Fail boundary where it was. So OEE, Quality and
    /// PassRate are byte-identical before and after; what moves is the VERDICT COLUMN a reader sees, on about
    /// 4.8% of this machine's cycles.</para>
    ///
    /// <para>🔴 <b>And what this deliberately leaves standing.</b> The published <c>MetricSample</c> below
    /// still carries an LSL of <c>0.0</c>. That is the physical floor of the quantity and it is what a chart
    /// bands on; changing it would move a value that crosses the wire (<c>Normalizer</c> copies it into the
    /// envelope as <c>lsl</c>), which is a change item 43's ruling does not cover. The consequence is stated
    /// rather than hidden: <b>a reader who re-derives the verdict from the limits this reading publishes gets
    /// the PRE-FIX answer</b>, because the verdict is computed from one limit and the reading declares two.
    /// That residue is named in the task report and left for a decision, not fixed here.</para>
    ///
    /// <para>One metric, no waveform, step type from the descriptor or the literal <c>leak_test</c>.</para></summary>
    public override DeviceReading NextCycle(long cycle)
    {
        var rng = Rng(cycle);
        var leakRate = Math.Max(0.0, rng.NextGaussian(LeakRateMean, LeakRateStd));

        var reading = NewReading(cycle, ReadingKind.ProcessResult, Descriptor.StepType ?? "leak_test");
        reading.Metrics.Add(new MetricSample("leak_rate", leakRate, "Pa/s", 0.0, _maxLeakRatePa, LeakRateMean));
        reading.Verdict = VerdictHelper.Evaluate(leakRate, lsl: null, usl: _maxLeakRatePa);
        return reading;
    }
}
