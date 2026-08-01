namespace St4i.EdgeCore.Config;

/// <summary>
/// Machine operating-configuration design (docs/MACHINE_CONFIG_DESIGN.md §3) — static parameter
/// vocabularies, one set per <c>configKind</c>. This is the "what CAN be tuned, and within what hard
/// limits" side of the feature; <see cref="MachineConfigStore"/> is the "what HAS been tuned, per
/// machine × product" side.
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
    public const string ScrewProgram = "screw_program";
    public const string DispenseProgram = "dispense_program";
    public const string WeldProfile = "weld_profile";
    public const string IotSettings = "iot_settings";
    public const string AoiInspection = "aoi_inspection";

    /// <summary>
    /// <c>MachineDescriptor.MachineType</c> (a free string — see <c>SimulatorFactory.Create</c>'s own
    /// switch, the same source of truth for which strings are real) → <c>configKind</c>. Mirrors the
    /// server's <c>MACHINE_TYPE_TO_RECIPE_KIND</c> for the four families it already knows, plus AOI/AVI
    /// → <see cref="AoiInspection"/>. A machine type not listed here (ASSEMBLY, LEAK_TEST,
    /// FUNCTIONAL_TEST, ...) simply has no operating-configuration parameter set yet — out of this
    /// task's scope, not an error condition callers need to special-case beyond checking for null.
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
