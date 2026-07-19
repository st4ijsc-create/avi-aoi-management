using System.Runtime.CompilerServices;
using System.Text;
using St4i.EdgeCore.Drivers;
using St4i.EdgeCore.Models;

namespace St4i.EdgeCore.Engine;

/// <summary>
/// The sim-agnostic seam a fleet orchestrator uses to inject <see cref="ScenarioConfig.ExtraDefectRate"/>/
/// <see cref="ScenarioConfig.FaultRate"/> failures without any
/// <see cref="St4i.EdgeCore.Drivers.Simulators.IMachineSimulator"/> knowing a scenario exists: wraps
/// whatever <see cref="IDeviceDriver"/> the fleet is built on (today always a
/// <see cref="SimulatedDriver"/>, but this decorator works over any driver) and post-processes every
/// <see cref="DeviceReading"/> it yields, reading the CURRENT <see cref="ScenarioConfig"/> fresh via
/// <paramref name="scenario"/>-typed delegate on every single reading — so a slider drag (or an
/// automatic Burst revert) takes effect on the very next reading, with no pipeline restart.
///
/// Relocated from the WPF app's <c>St4iMachineSimulator.Services.ScenarioAwareDriver</c> (there
/// <c>internal</c>) into EdgeCore as <c>public</c> (Task 3, ASP.NET EngineApi host) — this class only
/// ever depended on EdgeCore types, and both the WPF exhibition app and the headless EngineApi host now
/// share the exact same implementation.
/// </summary>
public sealed class ScenarioAwareDriver : IDeviceDriver
{
    private readonly IDeviceDriver _inner;
    private readonly Func<ScenarioConfig> _scenario;

    public ScenarioAwareDriver(IDeviceDriver inner, Func<ScenarioConfig> scenario)
    {
        _inner = inner ?? throw new ArgumentNullException(nameof(inner));
        _scenario = scenario ?? throw new ArgumentNullException(nameof(scenario));
    }

    public string Id => _inner.Id;

    public DriverKind Kind => _inner.Kind;

    public DriverHealthState Health => _inner.Health;

    public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
    {
        await foreach (var reading in _inner.ReadAsync(ct).WithCancellation(ct).ConfigureAwait(false))
        {
            yield return Inject(reading, _scenario());
        }
    }

    public ValueTask DisposeAsync() => _inner.DisposeAsync();

    /// <summary>
    /// Deterministically (never <see cref="DateTime"/>-seeded — same rule <c>SimRng</c>/<c>DemoTransport</c>'s
    /// own hashes follow) decides whether THIS reading should be flipped to <see cref="Verdict.Fail"/>.
    /// Telemetry readings (no pass/fail concept — <see cref="Verdict.Skip"/> always) and readings a
    /// sim's own physics already failed are left untouched.
    /// </summary>
    private static DeviceReading Inject(DeviceReading reading, ScenarioConfig scenario)
    {
        if (reading.Kind == ReadingKind.Telemetry) return reading;
        if (reading.Verdict == Verdict.Fail) return reading;

        // ExtraDefectRate and FaultRate are combined into one injected-failure probability — P(at
        // least one of two independent events), not a plain sum, so two 60% knobs don't overflow past
        // 100%.
        var combined = 1.0 - (1.0 - Clamp01(scenario.ExtraDefectRate)) * (1.0 - Clamp01(scenario.FaultRate));
        if (combined <= 0.0) return reading;

        // Bucketed against a stable hash of this reading's own identity (machine+serial+cycle —
        // SerialNumber is already unique per cycle, see SimulatorBase.NewReading's remarks) rather than
        // a shared Random instance, so injection is reproducible per-reading regardless of call order —
        // same determinism contract DemoTransport.ShouldSimulateQueued already follows.
        var bucket = StableHash($"{reading.MachineCode}:{reading.SerialNumber}:{reading.CycleCounter}") % 10_000u;
        if (bucket >= (uint)(combined * 10_000)) return reading;

        reading.Verdict = Verdict.Fail;

        if (reading.Kind == ReadingKind.Inspection && reading.Measurements.Count > 0)
        {
            // Keep Measurements consistent with the now-Fail overall Verdict — mirrors
            // AoiInspectorSim's own "any NG measurement -> Fail" invariant (Normalizer.ComputeOverallResult
            // aggregates from Measurements when present, so an unmarked "all-OK" list would silently
            // undo the injected failure once it reaches the wire).
            var idx = reading.Measurements.FindIndex(m => !string.Equals(m.Result, "NG", StringComparison.OrdinalIgnoreCase));
            if (idx >= 0)
            {
                var point = reading.Measurements[idx];
                reading.Measurements[idx] = point with
                {
                    Result = "NG",
                    DefectCatalogCode = point.DefectCatalogCode ?? "SCENARIO_INJECTED",
                    DefectSeverity = point.DefectSeverity ?? "major",
                };
            }
        }

        return reading;
    }

    private static double Clamp01(double v) => Math.Clamp(v, 0.0, 1.0);

    /// <summary>Stable (process- and run-independent) 32-bit FNV-1a hash — same hand-rolled algorithm
    /// as <c>DemoTransport.StableHash</c> and for the same reason: <c>string.GetHashCode()</c> is
    /// randomized per-process in .NET, which would make injection non-reproducible across runs.</summary>
    private static uint StableHash(string s)
    {
        unchecked
        {
            var hash = 2166136261u;
            foreach (var b in Encoding.UTF8.GetBytes(s))
            {
                hash ^= b;
                hash *= 16777619u;
            }

            return hash;
        }
    }
}
