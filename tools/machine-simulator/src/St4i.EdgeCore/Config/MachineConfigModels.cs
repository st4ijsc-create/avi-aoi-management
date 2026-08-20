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
public enum ParameterValueKind
{
    /// <summary>Serializes as <c>number</c>. The ONLY member any shipped
    /// <see cref="MachineParameterSchema"/> entry uses — every <see cref="ParameterDef"/> in that class's
    /// <c>Registry</c>, across all five <c>configKind</c>s, declares this kind, which is what makes
    /// <see cref="MachineParameterSchema.ValidateRange"/>'s numeric min/max the whole of parameter
    /// validation today.</summary>
    Number,

    /// <summary>Serializes as <c>enum</c>. Declared, never constructed: no <see cref="ParameterDef"/> in
    /// this repository names it, and nothing branches on it — <see cref="ParameterAdjustment.Value"/> is a
    /// <see langword="double"/>, so a discrete-mode parameter has no place to put its token yet. It is a
    /// reserved wire token, not a supported shape.</summary>
    Enum,

    /// <summary>Serializes as <c>bool</c>. Declared, never constructed — same standing as
    /// <see cref="Enum"/>.</summary>
    Bool,
}

/// <summary>Which layer an adjustment lives in — <c>machine</c> (product = null, applies to every
/// product this machine ever runs) or <c>product</c> (this machine × one specific product). Wire values
/// <c>machine</c>/<c>product</c> per docs/MACHINE_CONFIG_DESIGN.md §2.</summary>
[JsonConverter(typeof(SnakeLowerEnumConverter))]
public enum AdjustmentScope
{
    /// <summary>Serializes as <c>machine</c>. Selects <see cref="MachineOperatingConfig.MachineAdjustments"/>,
    /// the layer that applies to every product this machine ever runs.
    /// <see cref="MachineConfigStore.SetAdjustment"/> accepts this scope for EVERY <c>configKind</c>,
    /// including <see cref="MachineParameterSchema.IotSettings"/> — it is the only scope an IoT machine
    /// has.</summary>
    Machine,

    /// <summary>Serializes as <c>product</c>. Selects one product's inner map inside
    /// <see cref="MachineOperatingConfig.ProductAdjustments"/> and is the higher-priority layer of the two.
    /// <see cref="MachineConfigStore.SetAdjustment"/> refuses it two ways rather than one: an
    /// <see cref="InvalidOperationException"/> when the machine's <c>configKind</c> has no product
    /// dimension (<see cref="MachineParameterSchema.SupportsProductScope"/> false), and an
    /// <see cref="ArgumentException"/> when the product code itself is blank.</summary>
    Product,
}

/// <summary>Where a resolved parameter's effective value came from — <c>baseline</c> (nobody has
/// adjusted it), <c>machine</c> (a machine-scoped adjustment won), or <c>machineProduct</c> (a
/// machine×product-scoped adjustment won, the highest-priority layer). Wire values match
/// docs/MACHINE_CONFIG_DESIGN.md §2 EXACTLY, including <c>machineProduct</c>'s camelCase (the one
/// provenance value that is NOT snake_case) — every HMI/detail-panel row must be able to say which of
/// these three produced the number it's showing.</summary>
[JsonConverter(typeof(CamelEnumConverter))]
public enum ConfigProvenance
{
    /// <summary>Serializes as <c>baseline</c>. Nobody has adjusted this key at either layer, so
    /// <see cref="EffectiveParameter.Value"/> equals <see cref="EffectiveParameter.BaselineValue"/>. This
    /// is the value <see cref="MachineConfigStore.Resolve"/> starts every key at.</summary>
    Baseline,

    /// <summary>Serializes as <c>machine</c>. A machine-scoped adjustment won — there is an entry for this
    /// key in <see cref="MachineOperatingConfig.MachineAdjustments"/> and no product-scoped entry
    /// overrode it.</summary>
    Machine,

    /// <summary>Serializes as <c>machineProduct</c> — the one member of this enum whose wire token is not a
    /// single lowercase word, which is why this enum carries <c>CamelEnumConverter</c> where its two
    /// neighbours in this file carry <c>SnakeLowerEnumConverter</c>. The highest-priority layer:
    /// <see cref="MachineConfigStore.Resolve"/> applies it last, so it wins over
    /// <see cref="Machine"/> for the same key.</summary>
    MachineProduct,
}

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
    /// <summary>The overriding value, in the parameter's own <see cref="ParameterDef.Unit"/>. Already
    /// inside <see cref="ParameterDef.Min"/>..<see cref="ParameterDef.Max"/> for anything this process
    /// wrote: <see cref="MachineConfigStore.SetAdjustment"/> runs
    /// <see cref="MachineParameterSchema.ValidateRange"/> BEFORE constructing this object, so an
    /// out-of-range write throws and no adjustment is created at all. That guarantee covers the write
    /// path only — a hand-edited <c>machine-operating-config.json</c> is deserialized straight into this
    /// property with no range check on load.</summary>
    public double Value { get; set; }

    /// <summary>Who made the adjustment, verbatim as the caller supplied it — nullable and never
    /// validated or resolved against any identity store. This is an audit annotation, not an
    /// authorization fact.</summary>
    public string? By { get; set; }

    /// <summary>When the adjustment was made. Set to <see cref="DateTimeOffset.UtcNow"/> by
    /// <see cref="MachineConfigStore.SetAdjustment"/> at the moment of the write, and the field
    /// initializer here makes UTC-now the value for any instance constructed without one — this is never
    /// a caller-supplied timestamp.</summary>
    public DateTimeOffset At { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>Free-text reason, nullable. Copied verbatim into the matching
    /// <see cref="MachineConfigHistoryEntry.Note"/> when the adjustment is recorded, so the audit row and
    /// the live adjustment carry the same string rather than two independently-edited ones.</summary>
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
    /// <summary>Monotonic baseline generation, starting at 1. <c>MachineConfigStore.SeedConfig</c> creates
    /// the first one at 1 out of <see cref="MachineParameterSchema"/>'s own defaults — so version 1 does
    /// NOT mean "the server has been asked"; it means "nobody has pulled yet". Every later
    /// <see cref="MachineConfigStore.PullBaseline"/> that carries values increments it by exactly one.
    /// It is a counter local to this machine's file, not the server's own version number.</summary>
    public int Version { get; set; } = 1;

    /// <summary>The recommended value per parameter key, case-insensitive. Every key of the machine's
    /// <c>configKind</c> is always present: this map is rebuilt from the schema's key list on every write,
    /// and a key the pull did not supply takes <see cref="ParameterDef.Default"/> — so
    /// <see cref="MachineConfigStore.Resolve"/>'s per-key fallback to that same default is a defence
    /// against a hand-edited file, not the normal path. 🔴 The corollary is the surprising half: a pull
    /// REPLACES this map wholesale rather than merging into it, so a server response that omits a key
    /// resets that key to its schema default and does not preserve the number the previous pull put
    /// there. A supplied value outside the parameter's hard range never lands here either — it is
    /// diverted to <see cref="OutOfRangeRejected"/> and this map keeps the schema default instead.</summary>
    public Dictionary<string, double> Values { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Content address of <see cref="Values"/>, from
    /// <see cref="ConfigChecksum.Compute(object?)"/>. Recomputed by every writer of
    /// <see cref="Values"/>, so it is derived state rather than an input — nothing in this repository
    /// verifies it against the map on load, and nothing rejects a mismatch. Nullable only because the
    /// property has no initializer; every code path that builds a <see cref="BaselineSnapshot"/> sets
    /// it.</summary>
    public string? Checksum { get; set; }

    /// <summary>When this baseline generation was established — UTC-now at seed time and again at each
    /// <see cref="MachineConfigStore.PullBaseline"/>, never a server-supplied timestamp. It answers "how
    /// stale is the recommendation this machine holds", not "when did the server publish it".</summary>
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
    /// <summary>The machine this record belongs to — the same <c>MachineDescriptor.Code</c> that keys it
    /// in <see cref="MachineConfigStore"/>'s own dictionary and in the persisted
    /// <c>machine-operating-config.json</c>. Duplicated inside the record on purpose so a single
    /// deserialized entry is self-identifying, but nothing reconciles the two: a hand-edited file whose
    /// key and this field disagree is looked up by the KEY.</summary>
    public string MachineCode { get; set; } = "";

    /// <summary>Which parameter vocabulary this machine is bound to — one of
    /// <see cref="MachineParameterSchema.ScrewProgram"/>,
    /// <see cref="MachineParameterSchema.DispenseProgram"/>,
    /// <see cref="MachineParameterSchema.WeldProfile"/>,
    /// <see cref="MachineParameterSchema.IotSettings"/> or
    /// <see cref="MachineParameterSchema.AoiInspection"/>. Fixed for the life of the record:
    /// <see cref="MachineConfigStore.PullBaseline"/> throws
    /// <see cref="InvalidOperationException"/> rather than re-kind an existing machine, because every
    /// adjustment already stored is keyed by a vocabulary that would no longer apply.</summary>
    public string ConfigKind { get; set; } = "";

    /// <summary>The recommended layer, replaced wholesale by
    /// <see cref="MachineConfigStore.PullBaseline"/> and never edited in place by any operator path —
    /// docs/MACHINE_CONFIG_DESIGN.md §2's "Máy không bao giờ sửa lớp này".</summary>
    public BaselineSnapshot Baseline { get; set; } = new();

    /// <summary>Adjustments that apply to this machine whatever product it runs, keyed by parameter key,
    /// case-insensitive. SPARSE — only keys somebody actually changed appear, and a key with no entry
    /// falls through to <see cref="Baseline"/>. Surviving a
    /// <see cref="MachineConfigStore.PullBaseline"/> untouched is the point of the whole layered
    /// design.</summary>
    public Dictionary<string, ParameterAdjustment> MachineAdjustments { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Adjustments scoped to one product on this machine: outer key product code, inner key
    /// parameter key, both case-insensitive. Sparse at BOTH levels — a product with no adjustment has no
    /// outer entry at all. Stays empty for a machine whose <see cref="ConfigKind"/> is
    /// <see cref="MachineParameterSchema.IotSettings"/>, enforced at the write
    /// (<see cref="MachineConfigStore.SetAdjustment"/> throws) rather than merely by convention.</summary>
    public Dictionary<string, Dictionary<string, ParameterAdjustment>> ProductAdjustments { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>The audit trail, append-only and in ascending <see cref="MachineConfigHistoryEntry.Seq"/>
    /// order as stored — <see cref="MachineConfigStore.History"/> reverses it for callers, so a reader of
    /// THIS property gets oldest-first while a reader of that method gets newest-first. Unbounded: nothing
    /// in this repository trims it, so it grows for the life of the file.</summary>
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
    /// <summary>Per-machine counter, first entry 1, each later entry <c>MAX(Seq) + 1</c> over the entries
    /// already in <see cref="MachineOperatingConfig.History"/>. Derived from the list rather than from a
    /// clock, so two entries appended inside one tick still order deterministically — and derived from
    /// MAX rather than from Count, so it stays strictly increasing even though nothing trims the list
    /// today.</summary>
    public long Seq { get; set; }

    /// <summary>When the entry was appended, UTC-now at that moment. Ordering is
    /// <see cref="Seq"/>'s job, not this field's.</summary>
    public DateTimeOffset At { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>What happened. Exactly four values are ever written — <c>set</c>, <c>delete</c>,
    /// <c>pull</c>, <c>push</c> — one per writing method on <see cref="MachineConfigStore"/>. A plain
    /// string rather than an enum, so a reader must treat an unknown value as possible; the four spellings
    /// are pinned by <c>MachineConfigStoreTests</c>, which asserts the exact sequence a mixed session
    /// produces.</summary>
    public string Op { get; set; } = "";

    /// <summary>Which parameter the entry is about. Non-null only for <c>set</c> and <c>delete</c>; a
    /// <c>pull</c> or <c>push</c> concerns the whole record and leaves this null.</summary>
    public string? Key { get; set; }

    /// <summary>Which layer a <c>set</c>/<c>delete</c> touched. Null for <c>pull</c> and <c>push</c>,
    /// which belong to no layer.</summary>
    public AdjustmentScope? Scope { get; set; }

    /// <summary>The product this entry concerns, and it carries two different meanings by
    /// <see cref="Op"/>: for a <c>set</c>/<c>delete</c> it is populated only when
    /// <see cref="Scope"/> is <see cref="AdjustmentScope.Product"/> (a machine-scoped edit deliberately
    /// stores null even when the caller passed a product code); for a <c>push</c> it records which
    /// product's effective configuration was reported, with <see cref="Scope"/> still null.</summary>
    public string? ProductCode { get; set; }

    /// <summary>Who, verbatim from the caller and never validated — the same annotation as
    /// <see cref="ParameterAdjustment.By"/>, copied at the same moment.</summary>
    public string? By { get; set; }

    /// <summary>Why, verbatim from the caller. Reachable for <c>set</c> only — the other three writers
    /// append a null here, and <see cref="MachineConfigStore.RemoveAdjustment"/> has no note parameter at
    /// all, so a reason for REMOVING an adjustment has nowhere to be recorded.</summary>
    public string? Note { get; set; }

    /// <summary>The value that was in effect AT THAT LAYER before the operation, or null if the layer had
    /// no entry for the key. Null for <c>pull</c> and <c>push</c>. It is not the previously EFFECTIVE
    /// value — a product-scoped set records the previous product-scoped value, not whatever a
    /// machine-scoped adjustment or the baseline was serving.</summary>
    public double? OldValue { get; set; }

    /// <summary>The value written, for <c>set</c>. Null for <c>delete</c> (which restores the layer below
    /// rather than writing anything), and null for <c>pull</c>/<c>push</c>.</summary>
    public double? NewValue { get; set; }

    /// <summary>The rendered, human-readable line for this entry, composed at append time in English and
    /// stored — never recomputed on read, so an entry keeps the wording of the build that wrote it. For a
    /// <c>pull</c> that rejected out-of-range values, this is the ONLY place those rejections are recorded
    /// permanently: <see cref="BaselineSnapshot.OutOfRangeRejected"/> is replaced by the next pull, this
    /// sentence is not.</summary>
    public string Summary { get; set; } = "";
}
