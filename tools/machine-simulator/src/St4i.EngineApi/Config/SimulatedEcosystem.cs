using System.Text.Json;
using St4i.EdgeCore.Config;

namespace St4i.EngineApi.Config;

/// <summary>
/// Task C2 — an in-process, JSON-persisted mirror of the real server's System A (recipe/device_settings,
/// pull-only) + System B (AOI/AVI points+spec+images, true 2-way) for the Demo transport mode, so
/// config-sync works fully offline. A completely SEPARATE store instance from the machine-local
/// <see cref="ProductConfigStore"/> — this is "the ecosystem", that is "the machine"; syncing moves data
/// between the two, it never shares storage with them.
///
/// Seeded DELIBERATELY DIVERGED from <see cref="ProductConfigStore"/>'s own fresh seed (see
/// <see cref="BuildSeedProducts"/>/<see cref="BuildSeedRecipes"/>) so the very first check/diff/pull a
/// fresh install performs is non-trivial and demoable, not a no-op "already in sync". Starts from
/// <see cref="ProductConfigStore.SeedProducts"/>/<see cref="ProductConfigStore.SeedRecipes"/> (the exact
/// same baseline data, made <c>public static</c> for this purpose) and patches a small, explicit,
/// readable divergence on top — rather than hand-duplicating ~300 lines of seed point data a second
/// time and risking the two copies drifting apart from each other by accident.
///
/// Implements <see cref="IConfigSyncBackend"/> — every op here is meant to behave the way the real
/// server's System A/B endpoints behave per CONFIG_SYNC_SERVER_CONTRACT.md: version bump on a real
/// points change, last-write-wins by default with an opt-in per-point optimistic lock via
/// <c>expectedUpdatedAt</c>, and threshold governance (limit-field edits stripped + <c>limitBlocked</c>
/// on an existing point of a non-development product). See <see cref="SyncPointsAsync"/>'s own remarks
/// for the exact merge/governance/lock algorithm.
///
/// Thread-safe / persistence: same "single coarse lock + whole-file rewrite on every mutation, deep
/// clone on every read" shape as <see cref="ProductConfigStore"/> — this store is small in practice, so
/// simplicity wins over fine-grained concurrency.
/// </summary>
public sealed class SimulatedEcosystem : IConfigSyncBackend
{
    private const string ProductsFileName = "ecosystem-products.json";
    private const string RecipesFileName = "ecosystem-recipes.json";

    private static readonly JsonSerializerOptions PersistenceOptions = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true,
    };

    private readonly object _gate = new();
    private readonly Dictionary<string, ProductModel> _products = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, Recipe> _recipes = new(StringComparer.OrdinalIgnoreCase);

    public string RootDirectory { get; }

    public string Name => "Demo";

    /// <param name="directory">Where ecosystem-products.json/ecosystem-recipes.json live. Defaults to
    /// an "ecosystem" subfolder beside the engine's other config files — deliberately NOT the same
    /// directory/filenames <see cref="ProductConfigStore"/> uses, so the two stores can never collide on
    /// disk even though they usually run side by side in the same process. Tests pass a temp
    /// directory.</param>
    public SimulatedEcosystem(string? directory = null)
    {
        RootDirectory = string.IsNullOrWhiteSpace(directory)
            ? Path.Combine(AppContext.BaseDirectory, "ecosystem")
            : directory;
        Directory.CreateDirectory(RootDirectory);
        Load();
    }

    // ─────────────────────────────────────────────────────────────────────
    // System B — points (AOI/AVI)
    // ─────────────────────────────────────────────────────────────────────

    public Task<IReadOnlyList<ProductVersionDto>> CheckPointsVersionAsync(string? productModelCode, CancellationToken ct)
    {
        lock (_gate)
        {
            IEnumerable<ProductModel> source = string.IsNullOrWhiteSpace(productModelCode)
                ? _products.Values
                : _products.TryGetValue(productModelCode, out var one) ? new[] { one } : Enumerable.Empty<ProductModel>();

            // Task C8 — the Demo backend actually HAS the full point set in-process (unlike a real
            // server's check-points-version, which per the contract returns version only), so it
            // computes a real checksum-first drift key here instead of leaving callers stuck with
            // version-only comparison. See ConfigChecksum.ComputePointsChecksum's own doc comment.
            IReadOnlyList<ProductVersionDto> result = source
                .OrderBy(p => p.Code, StringComparer.OrdinalIgnoreCase)
                .Select(p => new ProductVersionDto(
                    p.Code, p.PointsConfigVersion, p.ImageWidth, p.ImageHeight,
                    ConfigChecksum.ComputePointsChecksum(p.Points)))
                .ToList();
            return Task.FromResult(result);
        }
    }

    public Task<ProductModel?> GetPointsAsync(string productModelCode, string? variantCode, CancellationToken ct)
    {
        ArgumentException.ThrowIfNullOrEmpty(productModelCode);
        lock (_gate)
        {
            return Task.FromResult(_products.TryGetValue(productModelCode, out var p) ? DeepClone(p) : null);
        }
    }

    public Task<PointsDeltaResultDto> DeltaSyncPointsAsync(string productModelCode, int sinceVersion, CancellationToken ct)
    {
        ArgumentException.ThrowIfNullOrEmpty(productModelCode);
        lock (_gate)
        {
            if (!_products.TryGetValue(productModelCode, out var product))
            {
                throw new KeyNotFoundException($"Product '{productModelCode}' not found in the simulated ecosystem.");
            }

            if (product.PointsConfigVersion <= sinceVersion)
            {
                return Task.FromResult(new PointsDeltaResultDto(false, Array.Empty<MeasurementPoint>(), Array.Empty<string>(), Array.Empty<DeletedPointDto>()));
            }

            // Simplified "full diff": this store doesn't track a per-point version, only a per-product
            // one — so a real delta (only the fields that actually changed since sinceVersion) isn't
            // reconstructable. Matching the contract's OWN "else full diff + tombstones" wording, this
            // returns every currently-active point (the caller can just overwrite its local set with
            // these) plus tombstones for anything deleted AT OR AFTER sinceVersion.
            var active = product.Points.Where(p => !p.IsDeleted).Select(DeepClone).ToList();
            var deleted = product.Points.Where(p => p.IsDeleted && (p.DeletedAtVersion ?? int.MaxValue) > sinceVersion).ToList();

            return Task.FromResult(new PointsDeltaResultDto(
                true,
                active,
                deleted.Select(p => p.Code).ToList(),
                deleted.Select(p => new DeletedPointDto(p.Code, p.DeletedAt!.Value, p.DeletedAtVersion)).ToList()));
        }
    }

    /// <summary>
    /// The core push primitive — mirrors CONFIG_SYNC_SERVER_CONTRACT.md's <c>sync-points</c> exactly:
    /// upsert by code, one atomic version bump per call (only if something actually changed), and two
    /// independent guards evaluated PER POINT:
    ///
    /// 1. Optimistic lock (opt-in via <see cref="SyncPointDto.ExpectedUpdatedAt"/>): if the caller
    ///    supplies it on an update to an EXISTING point and it doesn't match that point's current
    ///    <see cref="MeasurementPoint.LastModifiedAt"/>, the point is rejected outright (status
    ///    <c>"conflict"</c>, not overwritten at all) — the rest of the batch still applies. No token
    ///    supplied on an existing-point update = blind last-write-wins (contract default), counted as a
    ///    <see cref="SyncPointsResultDto.BlindOverwrites"/> for audit visibility.
    /// 2. Threshold governance: on an EXISTING point of a product whose <see cref="ProductModel.LifecycleStatus"/>
    ///    isn't <see cref="ProductLifecycleStatus.Development"/>, a supplied lower/upper/nominal limit
    ///    that actually differs from what's stored is STRIPPED (status still <c>"updated"</c>, but
    ///    <see cref="SyncPointOutcomeDto.LimitBlocked"/> true and the limit fields stay unchanged) —
    ///    every other field (name/geometry/position/image/shape/active) still applies. New points are
    ///    never governed (nothing "existing" to protect).
    ///
    /// A push targeting an existing point that happens to be tombstoned resurrects it (clears the
    /// tombstone) — a deliberate simplification: there's no separate "undelete" primitive in this
    /// simulator, and a machine actively re-pushing a point is a reasonable enough signal that it should
    /// be live again.
    /// </summary>
    public Task<SyncPointsResultDto> SyncPointsAsync(string productModelCode, SyncPointsRequestDto request, CancellationToken ct)
    {
        ArgumentException.ThrowIfNullOrEmpty(productModelCode);
        ArgumentNullException.ThrowIfNull(request);

        lock (_gate)
        {
            if (!_products.TryGetValue(productModelCode, out var product))
            {
                throw new KeyNotFoundException(
                    $"Product '{productModelCode}' not found in the simulated ecosystem — it must already exist there before points can be pushed to it.");
            }

            var previousVersion = product.PointsConfigVersion;
            var outcomes = new List<SyncPointOutcomeDto>();
            int created = 0, updated = 0, failed = 0, staleConflicts = 0, blindOverwrites = 0;
            var anyLimitBlocked = false;

            foreach (var incoming in request.Points)
            {
                if (string.IsNullOrWhiteSpace(incoming.Code))
                {
                    failed++;
                    outcomes.Add(new SyncPointOutcomeDto(incoming.Code ?? "", "failed", false, "point code is required"));
                    continue;
                }

                var existingIndex = product.Points.FindIndex(p => string.Equals(p.Code, incoming.Code, StringComparison.OrdinalIgnoreCase));
                var isNew = existingIndex < 0;

                if (!isNew)
                {
                    var existing = product.Points[existingIndex];

                    if (incoming.ExpectedUpdatedAt is { } expected)
                    {
                        if (existing.LastModifiedAt is not { } actual || actual != expected)
                        {
                            staleConflicts++;
                            outcomes.Add(new SyncPointOutcomeDto(incoming.Code, "conflict", false,
                                "stale expectedUpdatedAt (MP_STALE_WRITE) — point not overwritten"));
                            continue;
                        }
                    }
                    else
                    {
                        blindOverwrites++;
                    }
                }

                var merged = isNew ? NewPointFrom(incoming) : DeepClone(product.Points[existingIndex]);
                var limitBlocked = false;

                if (!isNew)
                {
                    ApplyNonLimitFields(merged, incoming);

                    var governed = product.LifecycleStatus != ProductLifecycleStatus.Development;
                    if (governed && ChangesLimits(product.Points[existingIndex], incoming))
                    {
                        limitBlocked = true;
                        anyLimitBlocked = true;
                        // Threshold governance: leave merged's limit fields exactly as cloned from the
                        // pre-existing point — everything else already applied above.
                    }
                    else
                    {
                        ApplyLimitFields(merged, incoming);
                    }

                    // A push always reactivates a previously-tombstoned point it targets.
                    merged.DeletedAt = null;
                    merged.DeletedAtVersion = null;
                }

                merged.LastModifiedAt = DateTimeOffset.UtcNow;

                if (isNew)
                {
                    product.Points.Add(merged);
                    created++;
                }
                else
                {
                    product.Points[existingIndex] = merged;
                    updated++;
                }

                outcomes.Add(new SyncPointOutcomeDto(incoming.Code, isNew ? "created" : "updated", limitBlocked,
                    limitBlocked ? "limit fields blocked by threshold governance (product not in development)" : null));
            }

            if (created + updated > 0)
            {
                product.BumpVersion();
            }

            Save();

            return Task.FromResult(new SyncPointsResultDto(
                Success: failed == 0,
                ProductModelCode: productModelCode,
                PreviousVersion: previousVersion,
                NewVersion: product.PointsConfigVersion,
                PointsCreated: created,
                PointsUpdated: updated,
                PointsFailed: failed,
                StaleConflicts: staleConflicts,
                BlindOverwrites: blindOverwrites,
                LimitChangesBlocked: anyLimitBlocked,
                Points: outcomes));
        }
    }

    public Task<(bool Found, string? ImageUrl)> GetProductImageAsync(string productModelCode, CancellationToken ct)
    {
        lock (_gate)
        {
            return Task.FromResult(_products.TryGetValue(productModelCode, out var p) ? (true, p.ReferenceImageUrl) : (false, (string?)null));
        }
    }

    public Task<bool> SyncProductImageAsync(string productModelCode, string? imageBase64, string? imageUrl, string? imageMimeType, CancellationToken ct)
    {
        lock (_gate)
        {
            if (!_products.TryGetValue(productModelCode, out var p)) return Task.FromResult(false);

            if (imageUrl is not null)
            {
                p.ReferenceImageUrl = imageUrl;
            }
            else if (imageBase64 is not null)
            {
                p.ReferenceImageUrl = $"data:{imageMimeType ?? "image/png"};base64,{imageBase64}";
                p.ImageHash = ConfigChecksum.Compute(imageBase64); // crude dedupe stand-in — real server hashes decoded bytes.
            }

            Save();
            return Task.FromResult(true);
        }
    }

    public Task<(bool Found, string? ImageUrl)> GetPointImageAsync(string productModelCode, string pointCode, CancellationToken ct)
    {
        lock (_gate)
        {
            if (!_products.TryGetValue(productModelCode, out var p)) return Task.FromResult((false, (string?)null));
            var point = p.Points.FirstOrDefault(x => string.Equals(x.Code, pointCode, StringComparison.OrdinalIgnoreCase));
            return Task.FromResult(point is null ? (false, (string?)null) : (true, point.ReferenceImageUrl));
        }
    }

    public Task<bool> SyncPointImageAsync(string productModelCode, string pointCode, string? imageBase64, string? imageUrl, CancellationToken ct)
    {
        lock (_gate)
        {
            if (!_products.TryGetValue(productModelCode, out var p)) return Task.FromResult(false);
            var point = p.Points.FirstOrDefault(x => string.Equals(x.Code, pointCode, StringComparison.OrdinalIgnoreCase));
            if (point is null) return Task.FromResult(false);

            if (imageUrl is not null) point.ReferenceImageUrl = imageUrl;
            else if (imageBase64 is not null) point.ReferenceImageUrl = $"data:image/png;base64,{imageBase64}";
            point.LastModifiedAt = DateTimeOffset.UtcNow;

            Save();
            return Task.FromResult(true);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // System A — recipe / device_settings (pull-only on a real server)
    // ─────────────────────────────────────────────────────────────────────

    public Task<RecipeCheckResultDto> CheckRecipeAsync(string? code, string? machineType, CancellationToken ct)
    {
        lock (_gate)
        {
            Recipe? match = null;
            var resolvedBy = "none";

            if (!string.IsNullOrWhiteSpace(code) && _recipes.TryGetValue(code, out var byCode))
            {
                match = byCode;
                resolvedBy = "machine";
            }
            else if (!string.IsNullOrWhiteSpace(machineType))
            {
                match = _recipes.Values.FirstOrDefault(r =>
                    string.Equals(r.MachineType, machineType, StringComparison.OrdinalIgnoreCase) &&
                    r.Status == RecipeStatus.Active);
                if (match is not null) resolvedBy = "machineType";
            }

            return Task.FromResult(match is null
                ? new RecipeCheckResultDto(false, null, 0, null, "none")
                : new RecipeCheckResultDto(true, match.Code, match.Version, match.Checksum, resolvedBy));
        }
    }

    public Task<Recipe?> GetRecipeAsync(string code, CancellationToken ct)
    {
        lock (_gate)
        {
            return Task.FromResult(_recipes.TryGetValue(code, out var r) ? DeepClone(r) : null);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Merge helpers — governed/lock-aware application of an incoming SyncPointDto onto a stored point.
    // ─────────────────────────────────────────────────────────────────────

    private static MeasurementPoint NewPointFrom(SyncPointDto d) => new()
    {
        Code = d.Code,
        Name = d.Name,
        Description = d.Description,
        MeasurementType = ParseMeasurementType(d.MeasurementType, EdgeCore.Config.MeasurementType.Other),
        Unit = d.Unit,
        LowerLimit = d.LowerLimit,
        UpperLimit = d.UpperLimit,
        NominalValue = d.NominalValue,
        PositionX = d.PositionX,
        PositionY = d.PositionY,
        Radius = d.Radius,
        NormalizedX = d.NormalizedX,
        NormalizedY = d.NormalizedY,
        NormalizedRadius = d.NormalizedRadius,
        CropWidth = d.CropWidth,
        CropHeight = d.CropHeight,
        OrderIndex = d.OrderIndex ?? 0,
        IsActive = d.IsActive ?? true,
        Shape = ParseShape(d.Shape, PointShape.Circle),
        Geometry = d.Geometry,
        ReferenceImageUrl = d.ImageUrl ?? (d.ImageBase64 is not null ? $"data:{d.ImageMimeType ?? "image/png"};base64,{d.ImageBase64}" : null),
        LastModifiedAt = DateTimeOffset.UtcNow,
    };

    /// <summary>Overlays every field EXCEPT the three limit fields (governance decides those
    /// separately) — null in <paramref name="d"/> means "caller didn't send a value", so <paramref
    /// name="merged"/> (already a clone of the pre-existing point) keeps what it had.</summary>
    private static void ApplyNonLimitFields(MeasurementPoint merged, SyncPointDto d)
    {
        merged.Name = d.Name;
        if (d.Description is not null) merged.Description = d.Description;
        merged.MeasurementType = ParseMeasurementType(d.MeasurementType, merged.MeasurementType);
        if (d.Unit is not null) merged.Unit = d.Unit;
        merged.PositionX = d.PositionX;
        merged.PositionY = d.PositionY;
        if (d.Radius is not null) merged.Radius = d.Radius;
        if (d.NormalizedX is not null) merged.NormalizedX = d.NormalizedX;
        if (d.NormalizedY is not null) merged.NormalizedY = d.NormalizedY;
        if (d.NormalizedRadius is not null) merged.NormalizedRadius = d.NormalizedRadius;
        if (d.CropWidth is not null) merged.CropWidth = d.CropWidth;
        if (d.CropHeight is not null) merged.CropHeight = d.CropHeight;
        if (d.OrderIndex is not null) merged.OrderIndex = d.OrderIndex.Value;
        if (d.IsActive is not null) merged.IsActive = d.IsActive.Value;
        if (d.Shape is not null) merged.Shape = ParseShape(d.Shape, merged.Shape);
        if (d.Geometry is not null) merged.Geometry = d.Geometry;

        if (d.ImageUrl is not null) merged.ReferenceImageUrl = d.ImageUrl;
        else if (d.ImageBase64 is not null) merged.ReferenceImageUrl = $"data:{d.ImageMimeType ?? "image/png"};base64,{d.ImageBase64}";
    }

    private static void ApplyLimitFields(MeasurementPoint merged, SyncPointDto d)
    {
        if (d.LowerLimit is not null) merged.LowerLimit = d.LowerLimit;
        if (d.UpperLimit is not null) merged.UpperLimit = d.UpperLimit;
        if (d.NominalValue is not null) merged.NominalValue = d.NominalValue;
    }

    private static bool ChangesLimits(MeasurementPoint existing, SyncPointDto d) =>
        (d.LowerLimit is not null && d.LowerLimit != existing.LowerLimit) ||
        (d.UpperLimit is not null && d.UpperLimit != existing.UpperLimit) ||
        (d.NominalValue is not null && d.NominalValue != existing.NominalValue);

    private static EdgeCore.Config.MeasurementType ParseMeasurementType(string? s, EdgeCore.Config.MeasurementType fallback) =>
        !string.IsNullOrWhiteSpace(s) && Enum.TryParse<EdgeCore.Config.MeasurementType>(s, ignoreCase: true, out var v) ? v : fallback;

    private static PointShape ParseShape(string? s, PointShape fallback) =>
        !string.IsNullOrWhiteSpace(s) && Enum.TryParse<PointShape>(s, ignoreCase: true, out var v) ? v : fallback;

    // ─────────────────────────────────────────────────────────────────────
    // Persistence
    // ─────────────────────────────────────────────────────────────────────

    public void Reload()
    {
        lock (_gate)
        {
            _products.Clear();
            _recipes.Clear();
            Load();
        }
    }

    private void Load()
    {
        var productsPath = Path.Combine(RootDirectory, ProductsFileName);
        var recipesPath = Path.Combine(RootDirectory, RecipesFileName);
        var productsExisted = File.Exists(productsPath);
        var recipesExisted = File.Exists(recipesPath);

        if (productsExisted)
        {
            var loaded = JsonSerializer.Deserialize<List<ProductModel>>(File.ReadAllText(productsPath), PersistenceOptions) ?? new();
            foreach (var p in loaded) _products[p.Code] = p;
        }
        else
        {
            foreach (var p in BuildSeedProducts()) _products[p.Code] = p;
        }

        if (recipesExisted)
        {
            var loaded = JsonSerializer.Deserialize<List<Recipe>>(File.ReadAllText(recipesPath), PersistenceOptions) ?? new();
            foreach (var r in loaded) _recipes[r.Code] = r;
        }
        else
        {
            foreach (var r in BuildSeedRecipes()) _recipes[r.Code] = r;
        }

        if (!productsExisted || !recipesExisted) Save();
    }

    private void Save()
    {
        var productsPath = Path.Combine(RootDirectory, ProductsFileName);
        var recipesPath = Path.Combine(RootDirectory, RecipesFileName);
        File.WriteAllText(productsPath, JsonSerializer.Serialize(
            _products.Values.OrderBy(p => p.Code, StringComparer.OrdinalIgnoreCase).ToList(), PersistenceOptions));
        File.WriteAllText(recipesPath, JsonSerializer.Serialize(
            _recipes.Values.OrderBy(r => r.Code, StringComparer.OrdinalIgnoreCase).ToList(), PersistenceOptions));
    }

    private static T DeepClone<T>(T value) =>
        JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(value, PersistenceOptions), PersistenceOptions)!;

    // ─────────────────────────────────────────────────────────────────────
    // Seed divergence — starts from ProductConfigStore's OWN seed (byte-identical baseline) and patches
    // a small, explicit, demoable delta on top. See the class doc comment for why.
    // ─────────────────────────────────────────────────────────────────────

    private static List<ProductModel> BuildSeedProducts()
    {
        var products = ProductConfigStore.SeedProducts();

        DivergeModelA(products.First(p => p.Code == "MODEL-A"));
        DivergeModelB(products.First(p => p.Code == "MODEL-B"));

        return products;
    }

    /// <summary>MODEL-A (Active lifecycle — the governance-relevant product): local seed starts at
    /// PointsConfigVersion 3 with points P01-P08. Ecosystem diverges by +2 versions via three
    /// independent, individually-demoable changes: (1) P05's limits widened — an EXISTING point's limit
    /// changed, so pulling shows a "changed limit" diff and pushing the LOCAL (narrower) value back
    /// would itself get threshold-governed; (2) P08 tombstoned — an EXISTING point retired on the
    /// ecosystem side, so pulling shows a "removed" diff; (3) P09 added — a brand-new point the local
    /// machine has never seen, so pulling shows an "added" diff. All three land in ONE product so a
    /// single check/diff/pull already tells the whole story.</summary>
    private static void DivergeModelA(ProductModel modelA)
    {
        var now = DateTimeOffset.UtcNow;

        var p05 = modelA.Points.First(p => p.Code == "P05");
        p05.LowerLimit = 4700;
        p05.UpperLimit = 5300;
        p05.LastModifiedAt = now;

        var p08 = modelA.Points.First(p => p.Code == "P08");
        p08.DeletedAt = now;

        modelA.Points.Add(new MeasurementPoint
        {
            Code = "P09",
            Name = "Final QA Stamp Presence",
            Description = "Tem QA cuoi chuyen kiem tra da qua kiem duyet",
            MeasurementType = EdgeCore.Config.MeasurementType.Visual,
            MeasurementTypeCode = "PRESENCE",
            PositionX = 0.92 * (modelA.ImageWidth ?? 1600),
            PositionY = 0.92 * (modelA.ImageHeight ?? 1200),
            NormalizedX = 0.92,
            NormalizedY = 0.92,
            CropWidth = 50,
            CropHeight = 50,
            OrderIndex = 8,
            IsActive = true,
            Shape = PointShape.Rect,
            Geometry = ParseJson("""{"width":40,"height":40}"""),
            Criteria = ParseJson("""{"expectPresence":true}"""),
            ReferenceImageUrl = "assets/products/model-a/points/p09-qa-stamp.png",
            LastModifiedAt = now,
        });

        modelA.PointsConfigVersion += 2;
        p08.DeletedAtVersion = modelA.PointsConfigVersion;
    }

    /// <summary>MODEL-B (Development lifecycle — the governance-bypass product): a light, single-field
    /// divergence (+1 version) so it's not a byte-identical no-op either, without stacking as many
    /// scenarios onto it as MODEL-A.</summary>
    private static void DivergeModelB(ProductModel modelB)
    {
        var q03 = modelB.Points.First(p => p.Code == "Q03");
        q03.UpperLimit = 0.36;
        q03.LastModifiedAt = DateTimeOffset.UtcNow;

        modelB.PointsConfigVersion += 1;
    }

    private static List<Recipe> BuildSeedRecipes()
    {
        var recipes = ProductConfigStore.SeedRecipes();

        var screw = recipes.First(r => r.Code == "SCREWDRIVE-M4");
        screw.Payload["torqueTarget"] = 1.40;
        screw.Payload["notes"] = "Chuan xiet vit M4 - cap nhat tu he thong trung tam (torque +0.05 Nm).";
        screw.Version += 1;
        screw.RecomputeChecksum();

        return recipes;
    }

    private static JsonElement ParseJson(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }
}
