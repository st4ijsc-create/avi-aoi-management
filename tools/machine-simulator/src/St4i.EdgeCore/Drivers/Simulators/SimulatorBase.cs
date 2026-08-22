using St4i.EdgeCore.Config;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;

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

    /// <summary>The roster entry handed to the constructor, assigned once and exposed get-only — this class
    /// never reassigns it and nothing derived from it can, so the identity a reading is stamped with is
    /// fixed for the instance's whole life.
    ///
    /// <para><b>It is also the one constructor argument this class REJECTS.</b> A null
    /// <c>descriptor</c> raises <see cref="ArgumentNullException"/>; every other reference-typed parameter of
    /// the constructor below is optional, nullable, and stored exactly as handed over. So a simulator that
    /// exists at all has a descriptor, and <see cref="NewReading"/> may read
    /// <see cref="MachineDescriptor.Code"/> off it without a further check — which is what it does, on every
    /// cycle, along with <see cref="MachineDescriptor.SerialSeed"/> and
    /// <see cref="MachineDescriptor.RecipeCode"/>.</para></summary>
    public MachineDescriptor Descriptor { get; }

    /// <summary>Task 3 — the store a config-aware simulator resolves its effective parameters from, or
    /// null for the pre-Task-3 "fixed constants" construction path.</summary>
    protected MachineConfigStore? ConfigStore { get; }

    /// <summary>I-5 (mc-feature-review.md) — the active scenario's <c>CycleRateMultiplier</c> (1.0 =
    /// unscaled), baked in at construction the same way EngineApi's own <c>FleetHost</c> already bakes it
    /// into the DESCRIPTOR's <c>CycleSeconds</c> for every non-config-aware sim (the pipeline build
    /// pre-scales <c>effectiveFleet</c> before calling <c>SimulatorFactory.Create</c> — 🔴 task J-1:
    /// <c>FleetCore.BuildStartPlan</c>, off <c>_gate</c>, where it was <c>StartLocked</c> under it — safe to fix at
    /// construction time because a multiplier change always restarts the whole pipeline, see
    /// <c>FleetCore.ApplyScenario</c>'s <c>multiplierChanged</c> check. 🔴 Task E-2: this parenthetical
    /// used to end "EdgeCore doesn't reference EngineApi, same reason <c>MinCycleSecondsFloor</c> below is
    /// mirrored rather than shared" — <c>FleetCore</c> now lives in this assembly, so that reason is gone;
    /// see <see cref="IotSensorSim"/>'s <c>MinCycleSecondsFloor</c> for the reason that replaced it). A
    /// config-aware simulator's OWN
    /// <see cref="CycleSecondsOverride"/> bypasses that descriptor entirely, which is exactly what let a
    /// scenario multiplier silently do nothing for SCREWDRIVE/IOT before this fix — see
    /// <see cref="ScrewdriveSim.CycleSecondsOverride"/>/<see cref="IotSensorSim.CycleSecondsOverride"/> for
    /// where this is actually applied.</summary>
    protected double CycleRateMultiplier { get; }

    /// <param name="descriptor">The roster entry this simulator speaks for — see <see cref="Descriptor"/>.
    /// The ONE argument here that is rejected: null raises <see cref="ArgumentNullException"/>. Its
    /// <see cref="MachineDescriptor.Code"/> is also the key <see cref="MachineConfigStore.Ensure"/> is called
    /// with below, so on the config-aware path a descriptor code decides which stored record this machine
    /// reads and writes.</param>
    /// <param name="seed">The first half of the determinism contract — <see cref="Rng"/> hands this and the
    /// cycle index to <see cref="SimRng.For"/>, which is a pure function of the pair. No
    /// <see cref="Random"/> is held anywhere in this class, and — measured at commit <c>5e194ab0</c> — no
    /// type in this directory declares a non-readonly instance field at all, so nothing accumulates between
    /// cycles: replaying cycle 5 on a fresh instance draws exactly what advancing through 1..5 would have
    /// drawn. It is not
    /// validated and there is no reserved value — any <see cref="int"/>, zero and negatives included, is a
    /// legal seed, and two machines given the same one produce identical draw sequences.</param>
    /// <param name="configKind">When both this and <paramref name="configStore"/> are non-null, the
    /// machine's operating-configuration record is <see cref="MachineConfigStore.Ensure"/>d right here —
    /// so <see cref="ResolveEffectiveConfig"/> can never throw <see cref="KeyNotFoundException"/> later,
    /// no matter which order callers touch this machine's config in.</param>
    /// <param name="configStore">The live store <see cref="ResolveEffectiveConfig"/> reads from, or null for
    /// the pre-Task-3 path where that method returns null and each subclass falls back to its own constants.
    /// Stored by reference and consulted afresh on every <see cref="ResolveEffectiveConfig"/> call rather
    /// than snapshotted, so the store a caller keeps a handle to is the one this simulator answers from.
    /// Only the three config-aware types make that call at all; for the other five the store would sit
    /// unread even if one were reachable.
    ///
    /// <para><b>Two failure modes a caller reaches through this argument, both raised from
    /// <see cref="MachineConfigStore"/> rather than from here.</b> Passing it TOGETHER with a
    /// <paramref name="configKind"/> that disagrees with a record this machine code already has throws
    /// <see cref="InvalidOperationException"/> out of this constructor, because
    /// <see cref="MachineConfigStore.Ensure"/> refuses to re-ensure one machine under a second kind. Passing
    /// it WITHOUT a <paramref name="configKind"/> skips that <c>Ensure</c> entirely, which leaves the first
    /// <see cref="ResolveEffectiveConfig"/> call free to raise <see cref="KeyNotFoundException"/> if nothing
    /// else ensured or pulled a baseline for this machine first — the pairing the
    /// <paramref name="configKind"/> note above describes is therefore load-bearing, not a
    /// convention.</para>
    ///
    /// <para><b>And the <c>Ensure</c> it performs is a FILE WRITE</b> (<c>MachineConfigStore.Save</c>) on the
    /// first construction for a machine code, so this constructor is not pure and is not free; see
    /// <see cref="SimulatorFactory.Create"/>'s <c>cycleRateMultiplier</c> note for why the fleet build calls
    /// it off its own lock.</para></param>
    /// <param name="productCodeProvider">Answers "which product is this machine running right now". Invoked
    /// FRESH on every <see cref="ResolveEffectiveConfig"/> and every <see cref="CurrentProductCode"/> read,
    /// never memoized, and invoked on whichever thread is inside the cycle — so a slow delegate slows that
    /// cycle and a throwing one leaves the simulator's own <c>NextCycle</c> with the exception. Nothing here
    /// wraps it. Null (the default) makes both of those read null, which is the same shape as "this machine
    /// is running no single product", not an error. <see cref="SimulatorFactory.Create"/> binds it as a
    /// closure over the descriptor's own code.</param>
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

    /// <summary>Left ABSTRACT deliberately: the per-machine physics is the one thing this base has no
    /// default for, so every machine type states its own and there is no inherited behaviour to fall back to.
    ///
    /// <para><b>What the base contributes to the override, and the precondition an implementer can get
    /// wrong.</b> The fields that are identical for every machine type — machine code, the per-cycle unique
    /// serial, recipe code, cycle counter, wire timestamp — come from <see cref="NewReading"/>, and the
    /// draws come from <see cref="Rng"/>. An override that builds a <see cref="DeviceReading"/> some other
    /// way still compiles and still satisfies <see cref="IMachineSimulator"/>; what it loses is the serial
    /// composition <c>"{SerialSeed}-{cycle:D6}"</c> the normalizer's inspection idempotency key is built on,
    /// and the determinism contract, which holds only because the draws come from a
    /// <see cref="SimRng.For"/> keyed on (seed, cycle) rather than from any state carried between cycles.
    /// Every one of the eight implementations in this directory calls both.</para>
    ///
    /// <para><b><paramref name="cycle"/> does not always come from the pacing loop.</b> Measured over every
    /// <c>.cs</c> under <c>src/</c> at commit <c>5e194ab0</c>, there are six call sites.
    /// <see cref="SimulatedDriver"/> is one of them and is the only one that counts — PER SIMULATOR, from 1,
    /// never per stream. The other five (<c>FleetCore</c>'s roster preview, three in the WPF app's
    /// <c>App.xaml.cs</c>, and <c>FleetService</c>'s) pass the literal <c>cycle: 1</c>, so every preview
    /// surface in this product shows a machine's FIRST cycle and nothing else. Nothing here bounds the
    /// index or rejects a repeat: handing the same one twice is exactly how a replay is expressed, and
    /// those five sites rely on it.</para></summary>
    /// <param name="cycle">The 1-based cycle index to produce a reading for.</param>
    /// <returns>The reading that cycle would have produced.</returns>
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

    /// <summary>WS3-T1 — the raw product code this machine is currently running, independent of any
    /// <see cref="MachineConfigStore"/>-resolved parameter VALUES: a simulator that needs to look up the
    /// PRODUCT's own config (e.g. <see cref="AoiInspectorSim"/> resolving real
    /// <see cref="ProductConfigStore"/> measurement points for its cycle plan) reads this instead of
    /// going through <see cref="ResolveEffectiveConfig"/>. Re-invoked fresh on every read (never
    /// memoized), same "no stale product" contract <see cref="ResolveEffectiveConfig"/> already
    /// documents. Null when this instance has no product-code provider wired (the pre-Task-3
    /// construction path, or a machine running no single product right now).</summary>
    protected string? CurrentProductCode => _productCodeProvider?.Invoke();

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
