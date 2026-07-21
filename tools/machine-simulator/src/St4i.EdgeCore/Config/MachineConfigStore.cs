using System.Text.Json;

namespace St4i.EdgeCore.Config;

/// <summary>
/// Edge-local, JSON-file-backed store for the machine operating-configuration feature
/// (docs/MACHINE_CONFIG_DESIGN.md §2) — one <see cref="MachineOperatingConfig"/> per machine, holding
/// the 3-layer <c>baseline ⊕ machine-scoped adjustments ⊕ machine×product-scoped adjustments</c> model
/// and resolving them into an <see cref="EffectiveConfig"/> with per-parameter provenance.
///
/// Same shape as <see cref="ProductConfigStore"/> — single coarse lock, whole-file rewrite on every
/// mutation, atomic temp-file-then-rename persistence, deep-clone in/out so a caller mutating a returned
/// <see cref="MachineOperatingConfig"/> can never corrupt this store's live state — chosen for the same
/// reason: small in practice (a handful of machines, a handful of parameters each), so simplicity beats
/// fine-grained concurrency.
///
/// A machine's config is created lazily via <see cref="Ensure"/> (idempotent — first call seeds
/// <see cref="MachineOperatingConfig.Baseline"/> from <see cref="MachineParameterSchema"/>'s defaults,
/// version 1) or <see cref="PullBaseline"/> (also creates on first call). Every write
/// (<see cref="SetAdjustment"/>) is guardrail-checked via <see cref="MachineParameterSchema.ValidateRange"/>
/// BEFORE it is applied — an out-of-range value is rejected, never clamped, and the store never reaches
/// a persisted state with an out-of-range adjustment.
/// </summary>
public sealed class MachineConfigStore
{
    private const string FileName = "machine-operating-config.json";

    private static readonly JsonSerializerOptions PersistenceOptions = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true,
    };

    private readonly object _gate = new();
    private readonly Dictionary<string, MachineOperatingConfig> _configs = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Directory holding <c>machine-operating-config.json</c>.</summary>
    public string RootDirectory { get; }

    /// <param name="directory">Defaults to <see cref="AppContext.BaseDirectory"/> — same "beside the
    /// built binary" convention <see cref="ProductConfigStore"/>/<c>FleetConfig</c> use. Tests pass a
    /// temp directory so runs don't share state.</param>
    public MachineConfigStore(string? directory = null)
    {
        RootDirectory = string.IsNullOrWhiteSpace(directory) ? AppContext.BaseDirectory : directory;
        Directory.CreateDirectory(RootDirectory);
        Load();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Ensure / read
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Returns this machine's config, creating it (baseline seeded from
    /// <see cref="MachineParameterSchema.ParametersFor"/>'s defaults, version 1, no adjustments) if this
    /// is the first time it's been seen. Idempotent — a machine already configured with a DIFFERENT
    /// <paramref name="configKind"/> throws <see cref="InvalidOperationException"/> rather than silently
    /// reinterpreting its stored adjustments under a new parameter vocabulary.</summary>
    public MachineOperatingConfig Ensure(string machineCode, string configKind)
    {
        ArgumentException.ThrowIfNullOrEmpty(machineCode);
        ArgumentException.ThrowIfNullOrEmpty(configKind);

        lock (_gate)
        {
            if (_configs.TryGetValue(machineCode, out var existing))
            {
                if (!string.Equals(existing.ConfigKind, configKind, StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidOperationException(
                        $"Machine \"{machineCode}\" is already configured as \"{existing.ConfigKind}\" — cannot re-ensure as \"{configKind}\".");
                }

                return DeepClone(existing);
            }

            var created = SeedConfig(machineCode, configKind);
            _configs[machineCode] = created;
            Save();
            return DeepClone(created);
        }
    }

    /// <summary>This machine's config, or null if <see cref="Ensure"/>/<see cref="PullBaseline"/> has
    /// never been called for it. A deep clone.</summary>
    public MachineOperatingConfig? GetConfig(string machineCode)
    {
        ArgumentException.ThrowIfNullOrEmpty(machineCode);
        lock (_gate)
        {
            return _configs.TryGetValue(machineCode, out var cfg) ? DeepClone(cfg) : null;
        }
    }

    private static MachineOperatingConfig SeedConfig(string machineCode, string configKind)
    {
        var defs = MachineParameterSchema.ParametersFor(configKind);
        var values = defs.ToDictionary(d => d.Key, d => d.Default, StringComparer.OrdinalIgnoreCase);

        return new MachineOperatingConfig
        {
            MachineCode = machineCode,
            ConfigKind = configKind,
            Baseline = new BaselineSnapshot
            {
                Version = 1,
                Values = values,
                Checksum = ConfigChecksum.Compute(values),
                PulledAt = DateTimeOffset.UtcNow,
            },
        };
    }

    // ─────────────────────────────────────────────────────────────────────
    // Resolve — baseline ⊕ machine ⊕ machine×product, with provenance
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Resolves this machine's effective configuration for <paramref name="productCode"/> (pass
    /// null for a machine that runs no single product right now, or for any machine whose
    /// <c>configKind</c> doesn't support the product layer at all — see
    /// <see cref="MachineParameterSchema.SupportsProductScope"/>). Resolution order per
    /// docs/MACHINE_CONFIG_DESIGN.md §2: baseline, then overwritten by a machine-scoped adjustment if one
    /// exists for that key, then overwritten AGAIN by a machine×product-scoped adjustment if one exists.
    /// A <paramref name="productCode"/> is silently ignored (never throws) for a machine whose
    /// <c>configKind</c> has no product dimension — <see cref="EffectiveConfig.ProductCode"/> comes back
    /// null either way, so "IoT has no product dimension" is enforced by the resolver itself, not left to
    /// every caller to remember.</summary>
    public EffectiveConfig Resolve(string machineCode, string? productCode)
    {
        ArgumentException.ThrowIfNullOrEmpty(machineCode);
        lock (_gate)
        {
            var cfg = RequireConfigLocked(machineCode);
            var defs = MachineParameterSchema.ParametersFor(cfg.ConfigKind);
            var scopedProductCode = MachineParameterSchema.SupportsProductScope(cfg.ConfigKind) ? productCode : null;

            var parameters = new List<EffectiveParameter>(defs.Count);
            foreach (var def in defs)
            {
                var baselineValue = cfg.Baseline.Values.TryGetValue(def.Key, out var bv) ? bv : def.Default;
                var value = baselineValue;
                var source = ConfigProvenance.Baseline;

                cfg.MachineAdjustments.TryGetValue(def.Key, out var machineAdj);
                if (machineAdj is not null)
                {
                    value = machineAdj.Value;
                    source = ConfigProvenance.Machine;
                }

                ParameterAdjustment? productAdj = null;
                if (!string.IsNullOrEmpty(scopedProductCode) &&
                    cfg.ProductAdjustments.TryGetValue(scopedProductCode, out var byKey) &&
                    byKey.TryGetValue(def.Key, out productAdj))
                {
                    value = productAdj!.Value;
                    source = ConfigProvenance.MachineProduct;
                }

                parameters.Add(new EffectiveParameter(def, value, source, baselineValue, machineAdj, productAdj));
            }

            return new EffectiveConfig(machineCode, scopedProductCode, cfg.ConfigKind, parameters);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Write — hard-guardrailed, scoped adjustments
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Sets (creates or replaces) one adjustment. Guardrail-checked against
    /// <see cref="MachineParameterSchema.ValidateRange"/> BEFORE anything is mutated — an out-of-range
    /// <paramref name="value"/> throws <see cref="ArgumentOutOfRangeException"/> (message names the
    /// allowed range) and leaves the store untouched. Throws <see cref="KeyNotFoundException"/> for an
    /// unknown <paramref name="key"/>, <see cref="InvalidOperationException"/> for a product-scoped write
    /// on a <c>configKind</c> with no product dimension, and <see cref="ArgumentException"/> for a
    /// product-scoped write with no <paramref name="productCode"/>.</summary>
    public MachineOperatingConfig SetAdjustment(
        string machineCode, string key, double value, AdjustmentScope scope,
        string? productCode, string? by, string? note)
    {
        ArgumentException.ThrowIfNullOrEmpty(machineCode);
        ArgumentException.ThrowIfNullOrEmpty(key);

        lock (_gate)
        {
            var cfg = RequireConfigLocked(machineCode);
            var def = MachineParameterSchema.ParameterFor(cfg.ConfigKind, key)
                ?? throw new KeyNotFoundException($"\"{key}\" is not a known parameter for config kind \"{cfg.ConfigKind}\".");

            MachineParameterSchema.ValidateRange(def, value);

            var adjustment = new ParameterAdjustment { Value = value, By = by, At = DateTimeOffset.UtcNow, Note = note };
            double? oldValue;

            if (scope == AdjustmentScope.Machine)
            {
                oldValue = cfg.MachineAdjustments.TryGetValue(key, out var existing) ? existing.Value : null;
                cfg.MachineAdjustments[key] = adjustment;
            }
            else
            {
                if (!MachineParameterSchema.SupportsProductScope(cfg.ConfigKind))
                {
                    throw new InvalidOperationException(
                        $"Machine \"{machineCode}\" (config kind \"{cfg.ConfigKind}\") has no product dimension — product-scoped adjustments are not supported.");
                }

                if (string.IsNullOrWhiteSpace(productCode))
                {
                    throw new ArgumentException("productCode is required for a product-scoped adjustment.", nameof(productCode));
                }

                if (!cfg.ProductAdjustments.TryGetValue(productCode, out var byKey))
                {
                    byKey = new Dictionary<string, ParameterAdjustment>(StringComparer.OrdinalIgnoreCase);
                    cfg.ProductAdjustments[productCode] = byKey;
                }

                oldValue = byKey.TryGetValue(key, out var existingProduct) ? existingProduct.Value : null;
                byKey[key] = adjustment;
            }

            AppendHistoryLocked(cfg, "set", key, scope, scope == AdjustmentScope.Product ? productCode : null, by, note, oldValue, value,
                BuildSetSummary(key, value, def.Unit, scope, productCode));

            Save();
            return DeepClone(cfg);
        }
    }

    /// <summary>Removes one adjustment, falling that key back to the layer below (product-scoped falls
    /// to machine-scoped or baseline; machine-scoped falls to baseline) — docs/MACHINE_CONFIG_DESIGN.md
    /// §5's "nút về mặc định". A no-op (still returns the current config, no history entry, no save) if
    /// nothing was actually set at that scope. Throws <see cref="KeyNotFoundException"/> if the machine
    /// has no config yet.</summary>
    public MachineOperatingConfig RemoveAdjustment(string machineCode, string key, AdjustmentScope scope, string? productCode, string? by)
    {
        ArgumentException.ThrowIfNullOrEmpty(machineCode);
        ArgumentException.ThrowIfNullOrEmpty(key);

        lock (_gate)
        {
            var cfg = RequireConfigLocked(machineCode);
            var removed = false;
            double? oldValue = null;

            if (scope == AdjustmentScope.Machine)
            {
                if (cfg.MachineAdjustments.TryGetValue(key, out var existing))
                {
                    oldValue = existing.Value;
                    cfg.MachineAdjustments.Remove(key);
                    removed = true;
                }
            }
            else if (!string.IsNullOrWhiteSpace(productCode) &&
                     cfg.ProductAdjustments.TryGetValue(productCode, out var byKey) &&
                     byKey.TryGetValue(key, out var existingProduct))
            {
                oldValue = existingProduct.Value;
                byKey.Remove(key);
                if (byKey.Count == 0) cfg.ProductAdjustments.Remove(productCode);
                removed = true;
            }

            if (removed)
            {
                AppendHistoryLocked(cfg, "delete", key, scope, scope == AdjustmentScope.Product ? productCode : null, by, null, oldValue, null,
                    $"{key} reset to the layer below ({DescribeScope(scope, productCode)}).");
                Save();
            }

            return DeepClone(cfg);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Baseline pull — never discards adjustments
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Refreshes <see cref="MachineOperatingConfig.Baseline"/> — creating the machine's config
    /// on first call (a "first install", version 1) or replacing the whole baseline snapshot and bumping
    /// <see cref="BaselineSnapshot.Version"/> on a later call. <see cref="MachineOperatingConfig.MachineAdjustments"/>/
    /// <see cref="MachineOperatingConfig.ProductAdjustments"/> are NEVER touched here — this is the
    /// docs/MACHINE_CONFIG_DESIGN.md §2 guarantee ("kéo baseline mới không xóa điều chỉnh tại máy") this
    /// whole layered design exists to make possible. <paramref name="newValues"/> lets a real backend
    /// (a later task) hand in server-fetched numbers; when null/empty, the schema's own defaults are used
    /// (this task has no live server yet — see docs/plans/2026-07-21-machine-config.md Task 6/7). Any key
    /// present in <paramref name="newValues"/> but not in the schema is ignored; any schema key absent
    /// from <paramref name="newValues"/> falls back to that parameter's own default.</summary>
    public MachineOperatingConfig PullBaseline(string machineCode, string configKind, IReadOnlyDictionary<string, double>? newValues, string? by)
    {
        ArgumentException.ThrowIfNullOrEmpty(machineCode);
        ArgumentException.ThrowIfNullOrEmpty(configKind);

        lock (_gate)
        {
            if (!_configs.TryGetValue(machineCode, out var cfg))
            {
                cfg = SeedConfig(machineCode, configKind);
                if (newValues is { Count: > 0 })
                {
                    var defs = MachineParameterSchema.ParametersFor(configKind);
                    cfg.Baseline.Values = defs.ToDictionary(
                        d => d.Key,
                        d => newValues.TryGetValue(d.Key, out var v) ? v : d.Default,
                        StringComparer.OrdinalIgnoreCase);
                    cfg.Baseline.Checksum = ConfigChecksum.Compute(cfg.Baseline.Values);
                }

                _configs[machineCode] = cfg;
                AppendHistoryLocked(cfg, "pull", null, null, null, by, null, null, null, $"Initial baseline pulled (v{cfg.Baseline.Version}).");
                Save();
                return DeepClone(cfg);
            }

            if (!string.Equals(cfg.ConfigKind, configKind, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    $"Machine \"{machineCode}\" is configured as \"{cfg.ConfigKind}\" — cannot pull a \"{configKind}\" baseline onto it.");
            }

            var schemaDefs = MachineParameterSchema.ParametersFor(configKind);
            var values = newValues is { Count: > 0 }
                ? schemaDefs.ToDictionary(d => d.Key, d => newValues.TryGetValue(d.Key, out var v) ? v : d.Default, StringComparer.OrdinalIgnoreCase)
                : schemaDefs.ToDictionary(d => d.Key, d => d.Default, StringComparer.OrdinalIgnoreCase);

            cfg.Baseline = new BaselineSnapshot
            {
                Version = cfg.Baseline.Version + 1,
                Values = values,
                Checksum = ConfigChecksum.Compute(values),
                PulledAt = DateTimeOffset.UtcNow,
            };

            AppendHistoryLocked(cfg, "pull", null, null, null, by, null, null, null, $"Baseline refreshed to v{cfg.Baseline.Version}.");
            Save();
            return DeepClone(cfg);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Push (report actual config) — history only, never mutates baseline or adjustments
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Records a history entry for a "reported actual configuration to the server" event
    /// (docs/MACHINE_CONFIG_DESIGN.md §2: "Đẩy lên server = báo cáo cấu hình THỰC TẾ của máy này, KHÔNG
    /// phải ghi đè baseline chung"). Deliberately does NOT touch <see cref="MachineOperatingConfig.Baseline"/>
    /// or either adjustment map — a push is pure reporting, the caller (<c>St4i.EngineApi</c>'s settings
    /// endpoints, Task 2) has already computed what to report via <see cref="Resolve"/>.</summary>
    public MachineOperatingConfig RecordPush(string machineCode, string? productCode, string? by, string summary)
    {
        ArgumentException.ThrowIfNullOrEmpty(machineCode);
        lock (_gate)
        {
            var cfg = RequireConfigLocked(machineCode);
            AppendHistoryLocked(cfg, "push", null, null, productCode, by, null, null, null, summary);
            Save();
            return DeepClone(cfg);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Checksum + history
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Stable, key-order-independent checksum of THIS machine's adjustments (both scopes) via
    /// <see cref="ConfigChecksum.Compute(object?)"/> — deliberately over adjustment VALUES only (not the
    /// by/at/note audit metadata), so re-saving the identical value under a different note/timestamp
    /// doesn't change the checksum. This is the drift/content key a settings-response or a push report
    /// surfaces (Task 2).</summary>
    public string ComputeAdjustmentsChecksum(string machineCode)
    {
        ArgumentException.ThrowIfNullOrEmpty(machineCode);
        lock (_gate)
        {
            var cfg = RequireConfigLocked(machineCode);
            return ComputeAdjustmentsChecksumLocked(cfg);
        }
    }

    private static string ComputeAdjustmentsChecksumLocked(MachineOperatingConfig cfg)
    {
        var canonical = new Dictionary<string, object?>
        {
            ["machine"] = cfg.MachineAdjustments.ToDictionary(kv => kv.Key, kv => (object?)kv.Value.Value, StringComparer.OrdinalIgnoreCase),
            ["product"] = cfg.ProductAdjustments.ToDictionary(
                kv => kv.Key,
                kv => (object?)kv.Value.ToDictionary(k2 => k2.Key, k2 => (object?)k2.Value.Value, StringComparer.OrdinalIgnoreCase),
                StringComparer.OrdinalIgnoreCase),
        };
        return ConfigChecksum.Compute(canonical);
    }

    /// <summary>This machine's full audit trail, newest first. Empty (not an error) for a machine with no
    /// config yet.</summary>
    public IReadOnlyList<MachineConfigHistoryEntry> History(string machineCode)
    {
        var cfg = GetConfig(machineCode);
        return cfg is null
            ? Array.Empty<MachineConfigHistoryEntry>()
            : cfg.History.OrderByDescending(h => h.Seq).ToList();
    }

    private static void AppendHistoryLocked(
        MachineOperatingConfig cfg, string op, string? key, AdjustmentScope? scope, string? productCode,
        string? by, string? note, double? oldValue, double? newValue, string summary)
    {
        var seq = cfg.History.Count == 0 ? 1L : cfg.History.Max(h => h.Seq) + 1;
        cfg.History.Add(new MachineConfigHistoryEntry
        {
            Seq = seq,
            At = DateTimeOffset.UtcNow,
            Op = op,
            Key = key,
            Scope = scope,
            ProductCode = productCode,
            By = by,
            Note = note,
            OldValue = oldValue,
            NewValue = newValue,
            Summary = summary,
        });
    }

    private static string BuildSetSummary(string key, double value, string unit, AdjustmentScope scope, string? productCode) =>
        $"{key} set to {value} {unit} ({DescribeScope(scope, productCode)}).";

    private static string DescribeScope(AdjustmentScope scope, string? productCode) =>
        scope == AdjustmentScope.Machine ? "machine-scoped" : $"product-scoped/{productCode}";

    // ─────────────────────────────────────────────────────────────────────
    // Persistence
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Discards all in-memory state and re-reads <c>machine-operating-config.json</c> from
    /// <see cref="RootDirectory"/> — the mechanism <see cref="MachineConfigStoreTests"/>'s
    /// restart-survival test uses (a fresh instance pointed at the same directory is the more realistic
    /// "process restarted" case; this method is the in-process equivalent).</summary>
    public void Reload()
    {
        lock (_gate)
        {
            _configs.Clear();
            Load();
        }
    }

    private void Load()
    {
        var path = Path.Combine(RootDirectory, FileName);
        if (!File.Exists(path)) return;

        var loaded = JsonSerializer.Deserialize<List<MachineOperatingConfig>>(File.ReadAllText(path), PersistenceOptions) ?? new();
        foreach (var cfg in loaded) _configs[cfg.MachineCode] = cfg;
    }

    /// <summary>Always called with <see cref="_gate"/> already held.</summary>
    private void Save()
    {
        var path = Path.Combine(RootDirectory, FileName);
        var json = JsonSerializer.Serialize(
            _configs.Values.OrderBy(c => c.MachineCode, StringComparer.OrdinalIgnoreCase).ToList(), PersistenceOptions);
        WriteAllTextAtomic(path, json);
    }

    /// <summary>Same crash-safety rationale as <see cref="ProductConfigStore"/>'s own copy of this method
    /// — writes to a temp file in the same directory then atomically renames over the real target, so
    /// <paramref name="path"/> is always either the complete old content or the complete new content,
    /// never a partial write.</summary>
    private static void WriteAllTextAtomic(string path, string content)
    {
        var tempPath = path + ".tmp-" + Guid.NewGuid().ToString("N");
        File.WriteAllText(tempPath, content);
        File.Move(tempPath, path, overwrite: true);
    }

    private static T DeepClone<T>(T value) =>
        JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(value, PersistenceOptions), PersistenceOptions)!;

    private MachineOperatingConfig RequireConfigLocked(string machineCode)
    {
        if (!_configs.TryGetValue(machineCode, out var cfg))
        {
            throw new KeyNotFoundException(
                $"Machine \"{machineCode}\" has no operating configuration yet (call Ensure/pull first).");
        }

        return cfg;
    }
}
