namespace St4i.EdgeCore.Config;

/// <summary>
/// Machine operating-configuration design (docs/MACHINE_CONFIG_DESIGN.md §3) — static parameter
/// vocabularies, one set per <c>configKind</c>. This is the "what MAY BE WRITTEN, and within what hard
/// limits" side of the feature; <see cref="MachineConfigStore"/> is the "what HAS been written, per
/// machine × product" side.
///
/// <para>🔴 <b>RETRACTED IN PLACE 2026-08-23 (BL-1, item 42), original kept verbatim:</b> the two sentences
/// above used to read <i>"This is the 'what CAN be tuned, and within what hard limits' side of the feature;
/// <c>MachineConfigStore</c> is the 'what HAS been tuned, per machine × product' side."</i> <b>"Tuned" is
/// false for two of the five kinds.</b> <see cref="DispenseProgram"/> and <see cref="WeldProfile"/> are
/// declared here, range-checked on write, persisted, and served over
/// <c>GET /v1/machines/{code}/settings</c> — and NO simulator reads them: <c>SimulatorFactory.Create</c>
/// builds <c>new DispensingSim(d, seed)</c> and <c>new WelderSim(d, seed)</c>, the only two constructors in
/// the family that take no <see cref="MachineConfigStore"/>, so <c>ResolveEffectiveConfig</c> answers null
/// for the whole life of those instances. Writing a value is real; TUNING is not. See
/// <see cref="IsConsumedBySimulator"/>, which is the machine-readable half of this sentence.</para>
///
/// Four kinds mirror the server's own typed recipe shapes (<c>server/services/recipes/recipeSchemas.ts</c>
/// — read-only reference, not imported since this is a separate deployable) so the same parameter, on
/// either side of the wire, has the exact same field name: <c>screw_program</c>, <c>dispense_program</c>,
/// <c>weld_profile</c>, <c>iot_settings</c>. <c>aoi_inspection</c> is a NEW vocabulary this task defines —
/// the server has none for AOI/AVI (its typed-schema layer explicitly skips inspection machine types, see
/// recipeSchemas.ts's own comment: "A machineType with NO typed schema (e.g. AOI/AVI/ICT) always
/// passes"). AOI/AVI is the machine family most affected by external conditions (ambient light, board
/// batch color, camera aging) — exactly the case the whole feature exists for — so it gets the richest,
/// most deliberately-chosen range set here.
///
/// Every parameter carries a HARD <see cref="ParameterDef.Min"/>/<see cref="ParameterDef.Max"/> —
/// <see cref="ValidateRange"/> is the single enforcement point <see cref="MachineConfigStore.SetAdjustment"/>
/// calls before ever persisting a write; out-of-range is always a rejection (clear message naming the
/// allowed range), never a silent clamp — this is an industrial machine control surface.
/// </summary>
public static class MachineParameterSchema
{
    /// <summary>SCREWDRIVE machines. The literal <c>screw_program</c> is the server's own
    /// <c>recipeSchemas.ts</c> kind name, matched character for character so the same parameter carries the
    /// same key on both sides of the wire. Five parameters, product scope supported.
    ///
    /// <para>🔴 <b>Item 71, 2026-08-24 (BP-1) — the SIXTH key both the design doc and the server declare is
    /// deliberately absent here, and until now nobody had written that down.</b> <c>sequence[]</c> is an
    /// array of <c>{step, torque, angle}</c> objects in <c>recipeSchemas.ts</c>' own
    /// <c>screwProgramShape</c>, and every parameter in THIS schema is one number with a hard min/max band
    /// — the same shape argument already recorded at <see cref="IotSettings"/> for <c>thresholds{}</c>, and
    /// the same one that applies to <see cref="AoiInspection"/>'s <c>retestPolicy</c>. Three omissions, one
    /// reason, and before this task exactly one of the three was stated. The design doc row is RIGHT to
    /// list it: it mirrors the server, and it is this schema that is narrower than both. Whether to widen
    /// the schema to non-scalar parameters changes a published REST vocabulary on a kind a simulator
    /// actually reads, and is not a documentation decision.</para></summary>
    public const string ScrewProgram = "screw_program";

    /// <summary>DISPENSING machines. <c>dispense_program</c>, again the server's own spelling. Four
    /// parameters, product scope supported.
    ///
    /// <para>🔴 <b>NO SIMULATOR READS IT — measured 2026-08-23 (BL-1, item 42) at commit <c>334575b2</c>,
    /// and this sentence is added because its absence was the whole defect.</b> <c>SimulatorFactory.Create</c>'s
    /// <c>DISPENSING</c> arm builds <c>new DispensingSim(d, seed)</c>, which takes no
    /// <see cref="MachineConfigStore"/>, so every value written under this kind is validated, persisted,
    /// served and then consumed by nothing.</para>
    ///
    /// <para>🔴 <b>And here the surface does not merely stay silent — it lies in the affirmative.</b> TWO of
    /// these four keys are spelled EXACTLY as metric keys <c>DispensingSim.NextCycle</c> publishes:
    /// <c>pressure</c> and <c>temperature</c>, character for character. An operator who raises
    /// <c>pressure</c> sees the stored record change and the <c>pressure</c> metric not change. (The third
    /// near-miss, <c>volumeTarget</c>, names the quantity behind the <c>volume</c> metric without matching
    /// its key; <c>speed</c> has no metric at all.) Contrast <see cref="WeldProfile"/>, where the same trap
    /// does NOT exist.</para></summary>
    public const string DispenseProgram = "dispense_program";

    /// <summary>WELDER machines. <c>weld_profile</c>, the server's own spelling. Four parameters, product
    /// scope supported.
    ///
    /// <para>🔴 <b>NO SIMULATOR READS IT</b> — same measurement, same date, same reason:
    /// <c>SimulatorFactory.Create</c>'s <c>WELDER</c> arm builds <c>new WelderSim(d, seed)</c>, the other
    /// constructor in this family that takes no <see cref="MachineConfigStore"/>.</para>
    ///
    /// <para><b>The name collision is where this kind DIFFERS from <see cref="DispenseProgram"/>, and the
    /// difference was measured rather than assumed.</b> A source report (BC-1 §7.2) wrote that "two of the
    /// four keys on EACH side share a name with a metric that same simulator emits". Re-measured
    /// 2026-08-23 against <c>WelderSim.NextCycle</c>, whose only two metric keys are <c>weld_current</c> and
    /// <c>weld_time</c>: <b>ZERO of these four keys collide exactly</b> — <c>current</c> and <c>time</c> are
    /// the same QUANTITIES under a different spelling, <c>tempMax</c> has no metric, and a welder emits no
    /// voltage metric at all. So the operator-facing trap ("edit a key, watch the identically-named metric
    /// stand still") lives at DISPENSING only, while the unwired-vocabulary gap lives at both. The count is
    /// 2 for DISPENSING and 0 for WELDER, not "two on each side".</para></summary>
    public const string WeldProfile = "weld_profile";

    /// <summary>IOT_SENSOR and IOT_GATEWAY machines — the one kind mapped from TWO machine types, and the
    /// one kind with NO product dimension: <see cref="SupportsProductScope"/> returns false for this value
    /// alone, which is what makes a product-scoped write against an IoT machine throw. Two parameters;
    /// design doc §3 also lists a <c>thresholds{}</c> map for this kind and it is deliberately absent here,
    /// because every parameter in this schema is one number with a hard band and a free-form map is not
    /// that shape.
    ///
    /// <para>🔴 <b>Item 71, 2026-08-24 (BP-1) — narrowed: the sentence above credits the DESIGN DOC with
    /// listing <c>thresholds{}</c>, and the doc is not where it comes from.</b> <c>recipeSchemas.ts</c>'
    /// <c>iotSettingsShape</c> declares <c>thresholds: z.record(z.string(), z.number()).optional()</c>, so
    /// the omission is a divergence from the SERVER contract this schema mirrors, not merely from an
    /// internal design note — a materially larger statement than the one that stood here. Same reason,
    /// wider consequence. See <see cref="ScrewProgram"/> and <see cref="AoiInspection"/> for the two
    /// siblings that share it.</para></summary>
    public const string IotSettings = "iot_settings";

    /// <summary>AOI and AVI machines, and the only one of the five with NO counterpart on the server —
    /// <c>recipeSchemas.ts</c> has no typed schema for inspection machine types at all, so nothing on the
    /// far side will recognize this kind or its six parameter keys. It exists because AOI/AVI is the
    /// family most affected by ambient conditions, which is the case the whole feature was built
    /// for.
    ///
    /// <para>🔴 <b>Item 71, 2026-08-24 (BP-1) — the SEVENTH key the design doc lists is deliberately absent
    /// here, and until now nobody had written that down.</b> <c>retestPolicy</c> is a policy, not a
    /// magnitude, and every parameter in this schema is one number with a hard min/max band — the same
    /// reason recorded at <see cref="IotSettings"/> for <c>thresholds{}</c> and at
    /// <see cref="ScrewProgram"/> for <c>sequence[]</c>. 🔴 <b>And this row differs from those two in a way
    /// worth stating: it has NO arbiter.</b> <c>RECIPE_KINDS</c> holds four kinds and this is not one of
    /// them, so there is no server declaration to be right or wrong against — the design doc invented the
    /// vocabulary and this schema implemented six of the seven it invented. <c>retestPolicy</c> appears
    /// nowhere in <c>src/</c>, and removing it from the doc would decide a design question by
    /// deletion.</para></summary>
    public const string AoiInspection = "aoi_inspection";

    /// <summary>
    /// <c>MachineDescriptor.MachineType</c> (a free string — see <c>SimulatorFactory.Create</c>'s own
    /// switch, the same source of truth for which strings are real) → <c>configKind</c>. Mirrors the
    /// server's <c>MACHINE_TYPE_TO_RECIPE_KIND</c> for the four families it already knows, plus AOI/AVI
    /// → <see cref="AoiInspection"/>. A machine type not listed here (ASSEMBLY, LEAK_TEST,
    /// FUNCTIONAL_TEST, ...) simply has no operating-configuration parameter set yet — out of this
    /// task's scope, not an error condition callers need to special-case beyond checking for null.
    ///
    /// <para>🔴 <b>THE SENTENCE ABOVE IS KEPT VERBATIM AND ITS IMPLICATION IS RETRACTED — 2026-08-23
    /// (BL-1, item 42).</b> It draws exactly one distinction, "listed = in scope, absent = not yet", and a
    /// reader takes the complement: that a type present in this dictionary is wired. <c>DISPENSING</c> and
    /// <c>WELDER</c> are present here and are as unwired as the three named absentees — their values reach
    /// no draw. Membership of THIS map decides only which REST vocabulary a machine is served; whether
    /// anything consumes it is a separate fact, and <see cref="IsConsumedBySimulator"/> is where that fact
    /// now lives so the two questions cannot be confused again.</para>
    /// </summary>
    private static readonly Dictionary<string, string> MachineTypeToConfigKind = new(StringComparer.OrdinalIgnoreCase)
    {
        ["SCREWDRIVE"] = ScrewProgram,
        ["DISPENSING"] = DispenseProgram,
        ["WELDER"] = WeldProfile,
        ["IOT_SENSOR"] = IotSettings,
        ["IOT_GATEWAY"] = IotSettings,
        ["AOI"] = AoiInspection,
        ["AVI"] = AoiInspection,
    };

    /// <summary>The <c>configKind</c> for a <c>MachineDescriptor.MachineType</c> string, or null when
    /// that machine type has no operating-configuration parameter set (see
    /// <see cref="MachineTypeToConfigKind"/>'s doc comment).</summary>
    public static string? ConfigKindForMachineType(string? machineType) =>
        !string.IsNullOrWhiteSpace(machineType) && MachineTypeToConfigKind.TryGetValue(machineType.Trim(), out var kind)
            ? kind
            : null;

    /// <summary>🔴 Item 42, 2026-08-23 — <b>does any simulator in this product actually READ values written
    /// under <paramref name="configKind"/>?</b> Declared here as data rather than left as prose in five
    /// doc comments, because prose is what let the answer stay wrong: two kinds have been fully declared,
    /// range-checked, persisted and served over REST since the feature shipped, and consumed by nothing.
    ///
    /// <para><b>What it measures, exactly:</b> whether <c>SimulatorFactory.Create</c> forwards a
    /// <see cref="MachineConfigStore"/> to the simulator class it builds for that kind's machine types.
    /// <c>ScrewdriveSim</c>, <c>IotSensorSim</c> and <c>AoiInspectorSim</c> take one;
    /// <c>DispensingSim</c> and <c>WelderSim</c> take no such argument at all, which is the whole of the
    /// answer for those two.</para>
    ///
    /// <para>🔴 <b>What it does NOT measure, stated here because the result is read here.</b> It is
    /// REACHABILITY of the store, not the fate of any individual key: a <see langword="true"/> means the
    /// values arrive at a simulator, NOT that every parameter of the kind reaches a draw. At least one key
    /// on a "true" kind does not — <c>screw_program</c>'s <c>angleTarget</c>, which
    /// <c>ScrewdriveSim.NextCycle</c>'s own doc comment records as reaching no draw. A per-KEY answer would
    /// be a different instrument and this is not it.</para></summary>
    /// <param name="configKind">One of the five kind constants on this class; any other string answers
    /// <see langword="false"/>, which is the safe direction — an unknown vocabulary is certainly not being
    /// consumed by a simulator that has never heard of it.</param>
    /// <returns>True when a store reaches the simulator built for that kind's machine types.</returns>
    public static bool IsConsumedBySimulator(string? configKind) =>
        configKind is not null &&
        (string.Equals(configKind, ScrewProgram, StringComparison.OrdinalIgnoreCase) ||
         string.Equals(configKind, IotSettings, StringComparison.OrdinalIgnoreCase) ||
         string.Equals(configKind, AoiInspection, StringComparison.OrdinalIgnoreCase));

    /// <summary>IoT sensor/gateway machines run no product — per
    /// docs/MACHINE_CONFIG_DESIGN.md §2 ("Máy không chạy sản phẩm... chỉ có lớp theo máy; giao diện
    /// không hiện chiều sản phẩm"), <see cref="IotSettings"/> is the one <c>configKind</c> with no
    /// product-scoped adjustment layer at all. Every other kind supports it.</summary>
    public static bool SupportsProductScope(string configKind) =>
        !string.Equals(configKind, IotSettings, StringComparison.OrdinalIgnoreCase);

    /// <summary>Every parameter defined for <paramref name="configKind"/>, in a stable display order.
    /// Throws <see cref="KeyNotFoundException"/> for an unknown <c>configKind</c> — callers always reach
    /// this via <see cref="ConfigKindForMachineType"/> first, so an unknown kind here means a
    /// programming error, not user input.</summary>
    public static IReadOnlyList<ParameterDef> ParametersFor(string configKind) =>
        Registry.TryGetValue(configKind, out var defs)
            ? defs
            : throw new KeyNotFoundException($"\"{configKind}\" is not a known machine operating-configuration kind.");

    /// <summary>The single parameter named <paramref name="key"/> under <paramref name="configKind"/>,
    /// or null if it doesn't exist (a bad/typo'd key from a client — the caller turns this into a 404,
    /// not an exception, since it's ordinary bad input rather than a programming error).</summary>
    public static ParameterDef? ParameterFor(string configKind, string key) =>
        ParametersFor(configKind).FirstOrDefault(d => string.Equals(d.Key, key, StringComparison.OrdinalIgnoreCase));

    /// <summary>Hard min/max enforcement (docs/MACHINE_CONFIG_DESIGN.md §3: "Chặn cứng min/max là bắt
    /// buộc, không phải trang trí"). Throws <see cref="ArgumentOutOfRangeException"/> — never clamps —
    /// with a message that names the allowed range so the rejection is immediately actionable at the
    /// point of entry (HMI text field, REST client, ...).</summary>
    public static void ValidateRange(ParameterDef def, double value)
    {
        ArgumentNullException.ThrowIfNull(def);
        if (value < def.Min || value > def.Max || double.IsNaN(value))
        {
            var format = $"F{Math.Max(def.Decimals, 0)}";
            throw new ArgumentOutOfRangeException(
                nameof(value),
                value,
                $"{def.Key} must be between {def.Min.ToString(format)} and {def.Max.ToString(format)} {def.Unit} (got {value.ToString(format)}).");
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Parameter vocabularies
    // ─────────────────────────────────────────────────────────────────────

    private static readonly IReadOnlyDictionary<string, IReadOnlyList<ParameterDef>> Registry =
        new Dictionary<string, IReadOnlyList<ParameterDef>>(StringComparer.OrdinalIgnoreCase)
        {
            [ScrewProgram] = new List<ParameterDef>
            {
                new("torqueTarget", "Mô-men xiết mục tiêu", "Target torque", "Nm", ParameterValueKind.Number, 0.10, 20.00, 0.01, 2, ScrewProgram, 1.35),
                new("torqueTolerance", "Dung sai mô-men", "Torque tolerance", "Nm", ParameterValueKind.Number, 0.00, 5.00, 0.01, 2, ScrewProgram, 0.15),
                new("angleTarget", "Góc xiết mục tiêu", "Target angle", "deg", ParameterValueKind.Number, 0, 720, 1, 0, ScrewProgram, 90),
                new("speedRpm", "Tốc độ xiết vít", "Screw speed", "rpm", ParameterValueKind.Number, 50, 2000, 10, 0, ScrewProgram, 450),
                new("clampTimeMs", "Thời gian giữ kẹp", "Clamp dwell time", "ms", ParameterValueKind.Number, 0, 5000, 10, 0, ScrewProgram, 250),
            },

            [DispenseProgram] = new List<ParameterDef>
            {
                new("volumeTarget", "Thể tích nhả keo mục tiêu", "Target dispense volume", "mL", ParameterValueKind.Number, 0.01, 50.00, 0.01, 2, DispenseProgram, 0.50),
                new("pressure", "Áp suất nhả keo", "Dispense pressure", "kPa", ParameterValueKind.Number, 0, 700, 1, 0, DispenseProgram, 150),
                new("speed", "Tốc độ di chuyển đầu nhả", "Dispense head travel speed", "mm/s", ParameterValueKind.Number, 1, 500, 1, 0, DispenseProgram, 50),
                new("temperature", "Nhiệt độ keo", "Adhesive temperature", "°C", ParameterValueKind.Number, 0, 250, 1, 0, DispenseProgram, 25),
            },

            [WeldProfile] = new List<ParameterDef>
            {
                new("current", "Dòng hàn", "Weld current", "A", ParameterValueKind.Number, 1, 500, 1, 0, WeldProfile, 120),
                new("time", "Thời gian hàn", "Weld time", "ms", ParameterValueKind.Number, 1, 10000, 1, 0, WeldProfile, 200),
                new("tempMax", "Nhiệt độ tối đa", "Max temperature", "°C", ParameterValueKind.Number, 0, 500, 1, 0, WeldProfile, 220),
                new("voltage", "Điện áp hàn", "Weld voltage", "V", ParameterValueKind.Number, 1, 100, 0.5, 1, WeldProfile, 24),
            },

            // thresholds{} (a nested map, per docs/MACHINE_CONFIG_DESIGN.md §3's table) is deliberately
            // NOT a scalar parameter here — every parameter in this schema is a single tunable number
            // with a hard min/max, and a free-form threshold map doesn't fit that shape. Only the two
            // scalar IoT settings are exposed as adjustable rows.
            [IotSettings] = new List<ParameterDef>
            {
                new("sampleRateHz", "Tần suất lấy mẫu", "Sample rate", "Hz", ParameterValueKind.Number, 0.01, 1000, 0.01, 2, IotSettings, 1.0),
                new("reportIntervalSec", "Chu kỳ báo cáo", "Report interval", "s", ParameterValueKind.Number, 1, 3600, 1, 0, IotSettings, 60),
            },

            // ── aoi_inspection — NEW vocabulary (server has none for AOI/AVI). Ranges/defaults chosen
            // for a realistic inline AOI/AVI inspection cell, consistent with this project's own seeded
            // lighting-shot data (ProductConfigStore.SeedProducts: ExposureUs ~900-8000, IntensityPct
            // ~55-100, SearchWindow ~20-24px):
            //   exposureUs        — camera exposure time; 50-20000us covers a fast-strobe bright-field
            //                        shot up to a slow dark-field/X-ray-adjacent shot.
            //   gain              — sensor analog gain (x); kept in the 1.0-8.0 band where noise stays
            //                        acceptable for defect detection (higher gain trades SNR for speed).
            //   lightIntensity    — % of a lighting channel's max output (matches seeded IntensityPct).
            //   conveyorSpeed     — mm/s through the inspection cell; too slow starves throughput, too
            //                        fast blurs the captured image.
            //   fiducialTolerance — mm search-window tolerance around a fiducial's nominal position.
            //   matchThreshold    — 0-1 template/fiducial match confidence; too low → false accepts
            //                        (missed defects), too high → nuisance false-NG (design doc §4:
            //                        "siết ngưỡng → nhiều NG hơn").
            [AoiInspection] = new List<ParameterDef>
            {
                new("exposureUs", "Thời gian phơi sáng", "Exposure time", "us", ParameterValueKind.Number, 50, 20000, 50, 0, AoiInspection, 1500),
                new("gain", "Độ khuếch đại cảm biến", "Sensor gain", "x", ParameterValueKind.Number, 1.0, 8.0, 0.1, 1, AoiInspection, 1.0),
                new("lightIntensity", "Cường độ đèn chiếu sáng", "Light intensity", "%", ParameterValueKind.Number, 0, 100, 1, 0, AoiInspection, 75),
                new("conveyorSpeed", "Tốc độ băng tải", "Conveyor speed", "mm/s", ParameterValueKind.Number, 10, 500, 5, 0, AoiInspection, 120),
                new("fiducialTolerance", "Dung sai định vị fiducial", "Fiducial search tolerance", "mm", ParameterValueKind.Number, 0.05, 2.00, 0.05, 2, AoiInspection, 0.30),
                new("matchThreshold", "Ngưỡng khớp mẫu", "Template match threshold", "score", ParameterValueKind.Number, 0.50, 0.99, 0.01, 2, AoiInspection, 0.85),
            },
        };
}
