using St4i.EdgeCore.Config;
using St4i.EdgeCore.Models;

namespace St4i.EdgeCore.Drivers.Simulators;

/// <summary>
/// Shared scaffolding for the 8 per-machine-type simulators: owns <see cref="Descriptor"/>/seed and
/// the boilerplate every <see cref="IMachineSimulator.NextCycle"/> needs to fill in identically
/// (machine code, per-cycle unique serial number, recipe/step type, cycle counter, wire timestamp).
///
/// Task 3 (docs/plans/2026-07-21-machine-config.md): also owns the OPTIONAL live-config-resolution seam
/// every simulator can use to make its generated values/cadence track <see cref="Config.MachineConfigStore"/>
/// — <see cref="ConfigStore"/> is null for every construction path that predates this task (every
/// existing test/call site that doesn't pass one), which keeps every un-wired simulator's behaviour
/// byte-for-byte unchanged.
/// </summary>
public abstract class SimulatorBase : IMachineSimulator
{
    private readonly int _seed;
    private readonly Func<string?>? _productCodeProvider;

    public MachineDescriptor Descriptor { get; }

    /// <summary>Task 3 — the store a config-aware simulator resolves its effective parameters from, or
    /// null for the pre-Task-3 "fixed constants" construction path.</summary>
    protected MachineConfigStore? ConfigStore { get; }

    /// <summary>I-5 (mc-feature-review.md) — the active scenario's <c>CycleRateMultiplier</c> (1.0 =
    /// unscaled), baked in at construction the same way EngineApi's own <c>FleetHost</c> already bakes it
    /// into the DESCRIPTOR's <c>CycleSeconds</c> for every non-config-aware sim (<c>StartLocked</c>
    /// pre-scales <c>effectiveFleet</c> before calling <c>SimulatorFactory.Create</c> — safe to fix at
    /// construction time because a multiplier change always restarts the whole pipeline, see
    /// <c>FleetHost.ApplyScenario</c>'s <c>multiplierChanged</c> check; EdgeCore doesn't reference
    /// EngineApi, same reason <c>MinCycleSecondsFloor</c> below is mirrored rather than shared). A
    /// config-aware simulator's OWN
    /// <see cref="CycleSecondsOverride"/> bypasses that descriptor entirely, which is exactly what let a
    /// scenario multiplier silently do nothing for SCREWDRIVE/IOT before this fix — see
    /// <see cref="ScrewdriveSim.CycleSecondsOverride"/>/<see cref="IotSensorSim.CycleSecondsOverride"/> for
    /// where this is actually applied.</summary>
    protected double CycleRateMultiplier { get; }

    /// <param name="configKind">When both this and <paramref name="configStore"/> are non-null, the
    /// machine's operating-configuration record is <see cref="MachineConfigStore.Ensure"/>d right here —
    /// so <see cref="ResolveEffectiveConfig"/> can never throw <see cref="KeyNotFoundException"/> later,
    /// no matter which order callers touch this machine's config in.</param>
    /// <param name="cycleRateMultiplier">See <see cref="CycleRateMultiplier"/>. Defaults to 1.0 (every
    /// pre-existing call site/test that doesn't pass one behaves exactly as before).</param>
    protected SimulatorBase(
        MachineDescriptor descriptor,
        int seed,
        string? configKind = null,
        MachineConfigStore? configStore = null,
        Func<string?>? productCodeProvider = null,
        double cycleRateMultiplier = 1.0)
    {
        Descriptor = descriptor ?? throw new ArgumentNullException(nameof(descriptor));
        _seed = seed;
        ConfigStore = configStore;
        _productCodeProvider = productCodeProvider;
        CycleRateMultiplier = cycleRateMultiplier > 0 ? cycleRateMultiplier : 1.0;

        if (ConfigStore is not null && configKind is not null)
        {
            ConfigStore.Ensure(Descriptor.Code, configKind);
        }
    }

    public abstract DeviceReading NextCycle(long cycle);

    /// <summary>Base default — "no cadence override, use <see cref="MachineDescriptor.CycleSeconds"/> as
    /// before". Overridden by whichever simulators Task 3 wires for cadence.</summary>
    public virtual double? CycleSecondsOverride => null;

    /// <summary>Deterministic per-cycle RNG — see <see cref="SimRng.For"/> for the determinism contract.</summary>
    protected Random Rng(long cycle) => SimRng.For(_seed, cycle);

    /// <summary>
    /// Task 3 — live-resolves this machine's effective operating configuration. Deliberately re-resolved
    /// on EVERY call (never memoized on this instance) — that is what lets a
    /// <see cref="MachineConfigStore.SetAdjustment"/> call from another thread/HTTP request take effect
    /// on the very next <see cref="NextCycle"/>/<see cref="CycleSecondsOverride"/> read, with no pipeline
    /// restart (docs/plans/2026-07-21-machine-config.md Task 3: "Re-resolve on change rather than caching
    /// at pipeline construction"). Returns null when this instance has no <see cref="ConfigStore"/> — the
    /// pre-Task-3 construction path every existing call site still uses.
    /// </summary>
    protected EffectiveConfig? ResolveEffectiveConfig() =>
        ConfigStore?.Resolve(Descriptor.Code, _productCodeProvider?.Invoke());

    /// <summary>The value of <paramref name="key"/> from a resolved config, or <paramref name="fallback"/>
    /// when <paramref name="cfg"/> is null (no config store wired) or the key isn't present.</summary>
    protected static double GetValue(EffectiveConfig? cfg, string key, double fallback) =>
        cfg is null
            ? fallback
            : cfg.Parameters.FirstOrDefault(p => string.Equals(p.Def.Key, key, StringComparison.OrdinalIgnoreCase))?.Value ?? fallback;

    /// <summary>
    /// Pre-fills the fields every reading needs regardless of machine type. The SerialNumber is
    /// UNIQUE per cycle (<c>"{SerialSeed}-{cycle:D6}"</c>) — required so Normalizer's inspection
    /// idempotency key (machineCode:recipe:serialNumber:cycleCounter) never collides across
    /// distinct cycles/boards on the same machine (see the idempotency-fix commit this task
    /// follows). <see cref="DeviceReading.Timestamp"/> uses wall-clock now deliberately: it's the
    /// wire timestamp sent with the reading, not simulation state, so it is NOT part of the
    /// determinism contract.
    /// </summary>
    protected DeviceReading NewReading(long cycle, ReadingKind kind, string? stepType) => new()
    {
        MachineCode = Descriptor.Code,
        Kind = kind,
        SerialNumber = $"{Descriptor.SerialSeed}-{cycle:D6}",
        StepType = stepType,
        RecipeCode = Descriptor.RecipeCode,
        CycleCounter = cycle,
        Timestamp = DateTimeOffset.Now,
    };
}
