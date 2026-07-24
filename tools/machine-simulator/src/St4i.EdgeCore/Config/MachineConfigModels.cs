using System.Text.Json.Serialization;

namespace St4i.EdgeCore.Config;

/// <summary>
/// Domain model for the machine operating-configuration feature (docs/MACHINE_CONFIG_DESIGN.md §2) —
/// the 3-layer <c>baseline ⊕ machine-scoped adjustments ⊕ machine×product-scoped adjustments</c> resolve
/// model. See <see cref="MachineParameterSchema"/> for "what CAN be tuned" and
/// <see cref="MachineConfigStore"/> for "what HAS been tuned, persisted".
/// </summary>

/// <summary>Wire value <c>number|enum|bool</c> — every parameter defined today is <see cref="Number"/>;
/// the other two members exist so a future non-numeric parameter (a discrete mode, a toggle) doesn't
/// need a schema-shape change.</summary>
[JsonConverter(typeof(SnakeLowerEnumConverter))]
public enum ParameterValueKind { Number, Enum, Bool }

/// <summary>Which layer an adjustment lives in — <c>machine</c> (product = null, applies to every
/// product this machine ever runs) or <c>product</c> (this machine × one specific product). Wire values
/// <c>machine</c>/<c>product</c> per docs/MACHINE_CONFIG_DESIGN.md §2.</summary>
[JsonConverter(typeof(SnakeLowerEnumConverter))]
public enum AdjustmentScope { Machine, Product }

/// <summary>Where a resolved parameter's effective value came from — <c>baseline</c> (nobody has
/// adjusted it), <c>machine</c> (a machine-scoped adjustment won), or <c>machineProduct</c> (a
/// machine×product-scoped adjustment won, the highest-priority layer). Wire values match
/// docs/MACHINE_CONFIG_DESIGN.md §2 EXACTLY, including <c>machineProduct</c>'s camelCase (the one
/// provenance value that is NOT snake_case) — every HMI/detail-panel row must be able to say which of
/// these three produced the number it's showing.</summary>
[JsonConverter(typeof(CamelEnumConverter))]
public enum ConfigProvenance { Baseline, Machine, MachineProduct }

/// <summary>One tunable parameter's definition — <see cref="MachineParameterSchema"/> is a static
/// catalogue of these, never mutated at runtime. <see cref="Min"/>/<see cref="Max"/> are the HARD
/// guardrail band (docs/MACHINE_CONFIG_DESIGN.md §3) — <see cref="MachineParameterSchema.ValidateRange"/>
/// is the only place that checks a value against them; every write path funnels through it.</summary>
public sealed record ParameterDef(
    string Key,
    string LabelVi,
    string LabelEn,
    string Unit,
    ParameterValueKind Kind,
    double Min,
    double Max,
    double Step,
    int Decimals,
    string ConfigKind,
    double Default);

/// <summary>One adjustment — a single overridden value at either the machine or machine×product layer,
/// carrying who/when/why (docs/MACHINE_CONFIG_DESIGN.md §2: "map thưa, chỉ chứa tham số đã đổi:
/// <c>{ key: { value, by, at, note } }</c>"). A parameter with no entry in the owning adjustment map
/// simply falls through to the layer below — that's what makes the map "thưa" (sparse): most parameters
/// on most machines have no adjustment at all.</summary>
public sealed class ParameterAdjustment
{
    public double Value { get; set; }
    public string? By { get; set; }
    public DateTimeOffset At { get; set; } = DateTimeOffset.UtcNow;
    public string? Note { get; set; }
}

/// <summary>The recommended values pulled from the server, versioned — the machine NEVER edits this
/// layer directly (docs/MACHINE_CONFIG_DESIGN.md §2: "Máy không bao giờ sửa lớp này"); only
/// <see cref="MachineConfigStore.PullBaseline"/> replaces it wholesale, and doing so must never touch
/// <see cref="MachineOperatingConfig.MachineAdjustments"/>/<see cref="MachineOperatingConfig.ProductAdjustments"/>.
/// <see cref="Checksum"/> is <see cref="ConfigChecksum.Compute(object?)"/> over <see cref="Values"/>, so
/// a pulled baseline's identity is content-addressed the same way the rest of this codebase's drift keys
/// are (see <see cref="ConfigChecksum"/>'s own doc comment).</summary>
public sealed class BaselineSnapshot
{
    public int Version { get; set; } = 1;
    public Dictionary<string, double> Values { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    public string? Checksum { get; set; }
    public DateTimeOffset PulledAt { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>I-2 (mc-feature-review.md) — the server-fetched value that <see cref="MachineConfigStore.PullBaseline"/>
    /// REJECTED for a key because it fell outside <see cref="MachineParameterSchema.ValidateRange"/>'s
    /// hard min/max — <see cref="Values"/> falls back to that parameter's schema default instead (never
    /// the out-of-range number itself, so an out-of-range recipe can never silently become the effective
    /// value/drive a simulator — see design doc §3: "dải tại máy phải nằm trong dải đó"). Empty for every
    /// baseline that had nothing rejected (the overwhelming common case). A UI can use this to render "◉
    /// khuyến nghị vượt dải, đã dùng mặc định" per key instead of showing it as a normal "recommended"
    /// value — the distinct state the design review asked for.</summary>
    public Dictionary<string, double> OutOfRangeRejected { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

/// <summary>One machine's whole operating-configuration record — everything <see cref="MachineConfigStore"/>
/// persists for a single <see cref="MachineCode"/>. <see cref="ProductAdjustments"/> is keyed by product
/// code (case-insensitive) and stays empty for a machine whose <see cref="ConfigKind"/> is
/// <see cref="MachineParameterSchema.IotSettings"/> (no product dimension — see
/// <see cref="MachineParameterSchema.SupportsProductScope"/>).</summary>
public sealed class MachineOperatingConfig
{
    public string MachineCode { get; set; } = "";
    public string ConfigKind { get; set; } = "";
    public BaselineSnapshot Baseline { get; set; } = new();
    public Dictionary<string, ParameterAdjustment> MachineAdjustments { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, Dictionary<string, ParameterAdjustment>> ProductAdjustments { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    public List<MachineConfigHistoryEntry> History { get; set; } = new();
}

/// <summary>One resolved parameter row — everything an HMI/detail-panel line needs to render "value ·
/// unit · allowed range · recommended value · WHY it's this value" in one shot (docs/MACHINE_CONFIG_DESIGN.md
/// §5). <see cref="BaselineValue"/> is always populated (even when <see cref="Source"/> isn't
/// <see cref="ConfigProvenance.Baseline"/>) so a caller can compute "is this drifted from the
/// recommendation" (<see cref="Value"/> != <see cref="BaselineValue"/>) without a second lookup.
/// <see cref="MachineAdjustment"/>/<see cref="ProductAdjustment"/> are populated whenever that layer HAS
/// an entry for this key, regardless of which one ultimately won — so a UI can show a machine-level
/// adjustment even while a product-level one is the active source.</summary>
public sealed record EffectiveParameter(
    ParameterDef Def,
    double Value,
    ConfigProvenance Source,
    double BaselineValue,
    ParameterAdjustment? MachineAdjustment,
    ParameterAdjustment? ProductAdjustment);

/// <summary>The full resolved parameter set for one (machine, product?) pair — the result of
/// <see cref="MachineConfigStore.Resolve"/>. <see cref="ProductCode"/> is always null for a
/// <see cref="MachineParameterSchema.IotSettings"/> machine, even if a caller asked for one (see
/// <see cref="MachineConfigStore.Resolve"/>'s own remarks) — "IoT has no product dimension" is enforced
/// here, not just left to the caller to remember.</summary>
public sealed record EffectiveConfig(
    string MachineCode,
    string? ProductCode,
    string ConfigKind,
    IReadOnlyList<EffectiveParameter> Parameters);

/// <summary>One audit-trail row — <see cref="Seq"/> is a per-machine incrementing counter (never
/// wall-clock-derived, so ordering stays deterministic even if two entries land in the same tick),
/// mirroring <c>ConfigSyncHistoryEntryDto.Seq</c>'s same rationale in <c>St4i.EngineApi</c>.
/// <see cref="Op"/> is one of <c>pull|set|delete|push</c>. <see cref="Scope"/>/<see cref="ProductCode"/>
/// are only populated for <c>set</c>/<c>delete</c> (and, for <c>push</c>, <see cref="ProductCode"/> alone
/// records which product's effective config was reported).</summary>
public sealed class MachineConfigHistoryEntry
{
    public long Seq { get; set; }
    public DateTimeOffset At { get; set; } = DateTimeOffset.UtcNow;
    public string Op { get; set; } = "";
    public string? Key { get; set; }
    public AdjustmentScope? Scope { get; set; }
    public string? ProductCode { get; set; }
    public string? By { get; set; }
    public string? Note { get; set; }
    public double? OldValue { get; set; }
    public double? NewValue { get; set; }
    public string Summary { get; set; } = "";
}
