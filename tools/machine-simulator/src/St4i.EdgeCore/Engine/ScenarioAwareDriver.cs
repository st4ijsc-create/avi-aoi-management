using System.Runtime.CompilerServices;
using System.Text;
using St4i.EdgeCore.Drivers;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Engine;

/// <summary>
/// The sim-agnostic seam a fleet orchestrator uses to inject <see cref="ScenarioConfig.ExtraDefectRate"/>/
/// <see cref="ScenarioConfig.FaultRate"/> failures without any
/// <see cref="St4i.EdgeCore.Drivers.Simulators.IMachineSimulator"/> knowing a scenario exists: wraps
/// whatever <see cref="IDeviceDriver"/> the fleet is built on (today always a
/// <see cref="SimulatedDriver"/>, but this decorator works over any driver) and post-processes every
/// <see cref="DeviceReading"/> it yields, reading the CURRENT <see cref="ScenarioConfig"/> fresh via
/// <c>scenario</c>-typed delegate on every single reading — so a slider drag (or an
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

    /// <summary>Wraps a driver. Takes ownership for DISPOSAL — <see cref="DisposeAsync"/> forwards to the
    /// inner driver — but not for lifetime: nothing is started here.</summary>
    /// <param name="inner">The driver whose readings are post-processed. Required. Every identity and
    /// health member below is a pass-through to it, so this decorator is invisible to anything that
    /// inspects the driver rather than its readings.</param>
    /// <param name="scenario">Invoked ONCE PER READING, never cached — that is the whole reason this is a
    /// delegate rather than a value. It is what lets a slider drag or an automatic burst revert take effect
    /// on the very next reading with no pipeline restart. Required.</param>
    public ScenarioAwareDriver(IDeviceDriver inner, Func<ScenarioConfig> scenario)
    {
        _inner = inner ?? throw new ArgumentNullException(nameof(inner));
        _scenario = scenario ?? throw new ArgumentNullException(nameof(scenario));
    }

    /// <summary>The inner driver's id, unchanged. The decorator deliberately does not decorate the NAME:
    /// a pipeline slot, an alarm target and a trace row all key on this, so wrapping must not move
    /// them.
    /// <para>🔴 <b>"a pipeline slot, an alarm target ... all key on this" IS RETRACTED, 2026-08-23, BJ-1</b>
    /// (<c>docs/owner-decisions.md</c> item 52). Kept verbatim above, as this repository does with a
    /// published claim that measurement refutes. The pipeline slot label and the alarm <c>TargetId</c> are
    /// derived in the host from the roster's driver kind or a connector instance id
    /// (<c>FleetCore.ResolveSlotLabelFor</c> / <c>ResolveConnectorSlotLabel</c>, and
    /// <c>AlarmEvaluator</c>'s <c>TargetId: slot.SlotLabel</c>); neither reads a driver's id.
    /// <b>The DECISION the sentence defends is unchanged and is still right</b> — this decorator must not
    /// decorate the name — but the reason is narrower than it was written: what keys on the id is logging,
    /// UI and four test suites that assert on its content, not the alarm route. The retraction moves the
    /// justification, not the behaviour.</para></summary>
    public string Id => _inner.Id;

    /// <summary>The inner driver's kind, unchanged — so a fleet built on simulators still reports
    /// <c>Simulated</c>, not a wrapper kind.</summary>
    public string Kind => _inner.Kind;

    /// <summary>The inner driver's health, unchanged. Scenario injection can turn a healthy machine's
    /// readings into failures without ever making the DRIVER unhealthy: a fabricated defect is a bad
    /// product, not a broken link.</summary>
    public DriverHealthState Health => _inner.Health;

    /// <summary>Streams the inner driver's readings with scenario failures injected. One in, one out —
    /// nothing is dropped, buffered or reordered, and the yielded object is the SAME instance the inner
    /// driver produced, mutated in place when a failure is injected.</summary>
    /// <param name="ct">Forwarded to the inner driver and also applied to the enumeration itself, so
    /// cancellation ends the stream rather than being swallowed.</param>
    /// <returns>The inner sequence, each element post-processed against the scenario read at the moment
    /// that element arrived.</returns>
    public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
    {
        await foreach (var reading in _inner.ReadAsync(ct).WithCancellation(ct).ConfigureAwait(false))
        {
            yield return Inject(reading, _scenario());
        }
    }

    /// <summary>Disposes the inner driver and nothing else — this decorator holds no resource of its own.
    /// Not idempotent here: a second call reaches the inner driver a second time, so idempotence is
    /// whatever the wrapped driver provides.</summary>
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
