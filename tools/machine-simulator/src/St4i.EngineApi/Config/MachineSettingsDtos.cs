using St4i.EdgeCore.Config;

namespace St4i.EngineApi.Config;

// ─────────────────────────────────────────────────────────────────────────
// Task 2 — wire DTOs for the machine operating-configuration settings endpoints
// (docs/plans/2026-07-21-machine-config.md Task 2). Reuses the EdgeCore.Config domain types
// (ParameterDef/BaselineSnapshot/ParameterAdjustment/EffectiveParameter) directly as response fields,
// same convention ConfigEndpoints/ConfigDtos already use for ProductModel/MeasurementPoint/Recipe — they
// already carry their own [JsonConverter] attributes, so re-shaping them into separate DTOs would just
// duplicate fields for no benefit.
// ─────────────────────────────────────────────────────────────────────────

/// <summary>
/// <c>GET /v1/machines/{code}/settings?product=</c> response. <see cref="ProductCode"/> echoes back
/// whatever the resolver actually used (null for a machine whose <c>configKind</c> has no product
/// dimension, even if the caller asked for one — see <see cref="MachineConfigStore.Resolve"/>).
/// <see cref="ProductAdjustments"/> is scoped to <see cref="ProductCode"/> alone (not every product this
/// machine has ever had an adjustment for) — a settings screen is always looking at one product at a
/// time. <see cref="DriftedKeys"/> is every schema key whose effective value differs from the baseline
/// recommendation, letting a UI light up the "◉ đang lệch" marker (docs/MACHINE_CONFIG_DESIGN.md §5)
/// without recomputing it client-side.
/// </summary>
public sealed record MachineSettingsResponseDto(
    string MachineCode,
    string ConfigKind,
    bool SupportsProductScope,
    string? ProductCode,
    IReadOnlyList<ParameterDef> Schema,
    BaselineSnapshot Baseline,
    IReadOnlyDictionary<string, ParameterAdjustment> MachineAdjustments,
    IReadOnlyDictionary<string, ParameterAdjustment> ProductAdjustments,
    IReadOnlyList<EffectiveParameter> Effective,
    string AdjustmentsChecksum,
    IReadOnlyList<string> DriftedKeys);

/// <summary><c>PUT /v1/machines/{code}/settings/{key}</c> request body — <c>{ value, scope, product?,
/// note? }</c> per the plan. <see cref="Product"/> is required when <see cref="Scope"/> is
/// <see cref="AdjustmentScope.Product"/> (enforced by <see cref="MachineConfigStore.SetAdjustment"/>),
/// ignored otherwise.</summary>
public sealed record UpdateSettingRequestDto(double Value, AdjustmentScope Scope, string? Product, string? Note, string? By);

/// <summary><c>POST /v1/machines/{code}/settings/pull</c> request body — entirely optional (a bare POST
/// with no body just refreshes the baseline). <see cref="Product"/> only affects which product's
/// adjustments the RESPONSE echoes back (pull itself never touches any product's adjustments — see
/// <see cref="MachineConfigStore.PullBaseline"/>).</summary>
public sealed record PullSettingsRequestDto(string? Product, string? By);

/// <summary><c>POST /v1/machines/{code}/settings/push</c> request body — <see cref="Product"/> selects
/// which (machine, product) pair's effective configuration gets reported; required for a machine whose
/// <c>configKind</c> supports the product dimension (an AOI/AVI/automation machine always runs SOME
/// product), optional/ignored for IoT.</summary>
public sealed record PushSettingsRequestDto(string? Product, string? By);

/// <summary>
/// <c>POST /v1/machines/{code}/settings/push</c> response — reports this machine's ACTUAL configuration
/// (docs/MACHINE_CONFIG_DESIGN.md §2: "Đẩy lên server = báo cáo cấu hình THỰC TẾ của máy này, KHÔNG phải
/// ghi đè baseline chung"). <see cref="BaselineVersion"/> is included specifically so a caller/test can
/// confirm push never bumped it — compare against the version <c>GET /settings</c> reported before the
/// push.
/// </summary>
public sealed record MachineSettingsPushResultDto(
    string MachineCode,
    string ConfigKind,
    string? ProductCode,
    IReadOnlyList<EffectiveParameter> Effective,
    string AdjustmentsChecksum,
    int BaselineVersion,
    string Message);
