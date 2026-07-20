using System.Collections.Concurrent;
using St4i.EdgeCore.Config;
using St4i.EdgeCore.Models;

namespace St4i.EngineApi.Config;

/// <summary>
/// Task C2 — orchestrates config-sync for the web UI (Tasks C4-C7) and, eventually, real machines: owns
/// the local <see cref="ProductConfigStore"/> vs. the <see cref="IConfigSyncBackend"/> ("the ecosystem" —
/// today always <see cref="SimulatedEcosystem"/> via <see cref="SwitchableConfigSyncBackend"/>, see that
/// type's doc comment for the C3 Live seam), computes field-level diffs, and records sync history.
///
/// Dispatches by <see cref="MachineDescriptor.DeviceClass"/>: <see cref="DeviceClass.AoiAvi"/> machines
/// sync POINTS (System B, a specific <c>productCode</c> the caller names — a machine doesn't own a
/// single fixed product any more than the real system does, per CONFIG_SYNC_SERVER_CONTRACT.md's own
/// check-points-version taking an optional <c>productModelCode</c>); every other <see cref="DeviceClass"/>
/// syncs a RECIPE (System A), auto-resolved by <see cref="MachineDescriptor.MachineType"/> (mirrors the
/// contract's <c>resolvedBy:"machineType"</c>).
///
/// Push has two layers: <see cref="PushAsync"/> is the convenience path the REST endpoint uses — pushes
/// every active local point BLIND (no optimistic-lock token), matching the contract's default
/// (MACHINE_SYNC_OPTIMISTIC_LOCK off = last-write-wins). <see cref="PushPointsAsync"/> is the lower-level
/// primitive it's built on, taking caller-supplied <see cref="SyncPointDto"/>s directly (including any
/// <see cref="SyncPointDto.ExpectedUpdatedAt"/> lock token) — this is what exercises/would expose the
/// optimistic-lock path precisely.
/// </summary>
public sealed class ConfigSyncEngine
{
    private readonly ProductConfigStore _localStore;
    private readonly IConfigSyncBackend _backend;

    private readonly ConcurrentDictionary<string, List<ConfigSyncHistoryEntryDto>> _history =
        new(StringComparer.OrdinalIgnoreCase);
    private readonly object _historyGate = new();
    private long _historySeq;

    public ConfigSyncEngine(ProductConfigStore localStore, IConfigSyncBackend backend)
    {
        _localStore = localStore ?? throw new ArgumentNullException(nameof(localStore));
        _backend = backend ?? throw new ArgumentNullException(nameof(backend));
    }

    // ─────────────────────────────────────────────────────────────────────
    // CHECK
    // ─────────────────────────────────────────────────────────────────────
    public async Task<MachineConfigCheckDto> CheckAsync(MachineDescriptor machine, string? productCode, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(machine);

        if (machine.DeviceClass == DeviceClass.AoiAvi)
        {
            var versions = await _backend.CheckPointsVersionAsync(productCode, ct).ConfigureAwait(false);
            var drift = versions
                .Select(v =>
                {
                    var local = _localStore.GetProduct(v.ProductModelCode);
                    var localVersion = local?.PointsConfigVersion;
                    var state = localVersion is null ? "unknown" : localVersion == v.PointsConfigVersion ? "in_sync" : "drift";
                    return new ProductDriftDto(v.ProductModelCode, localVersion, v.PointsConfigVersion, state);
                })
                .ToList();

            return new MachineConfigCheckDto(machine.Code, "points", drift, null);
        }

        var recipeCheck = await _backend.CheckRecipeAsync(null, machine.MachineType, ct).ConfigureAwait(false);
        if (!recipeCheck.Success || recipeCheck.Code is null)
        {
            return new MachineConfigCheckDto(machine.Code, "recipe", Array.Empty<ProductDriftDto>(), null);
        }

        var localRecipe = _localStore.GetRecipe(recipeCheck.Code);
        var recipeState = localRecipe is null ? "unknown" : localRecipe.Version == recipeCheck.Version ? "in_sync" : "drift";
        var recipeDto = new RecipeDriftDto(recipeCheck.Code, localRecipe?.Version, recipeCheck.Version, recipeState, recipeCheck.ResolvedBy);
        return new MachineConfigCheckDto(machine.Code, "recipe", Array.Empty<ProductDriftDto>(), recipeDto);
    }

    // ─────────────────────────────────────────────────────────────────────
    // PULL (ecosystem → machine)
    // ─────────────────────────────────────────────────────────────────────
    public async Task<MachineConfigPullResultDto> PullAsync(MachineDescriptor machine, string? productCode, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(machine);

        if (machine.DeviceClass == DeviceClass.AoiAvi)
        {
            if (string.IsNullOrWhiteSpace(productCode))
            {
                throw new ArgumentException("productCode is required to pull points-config for an AOI/AVI machine.", nameof(productCode));
            }

            var ecoProduct = await _backend.GetPointsAsync(productCode, null, ct).ConfigureAwait(false)
                ?? throw new KeyNotFoundException($"Product '{productCode}' not found in the ecosystem.");

            var localBefore = _localStore.GetProduct(productCode);
            var diff = ComputeDiff(machine.Code, productCode, localBefore, ecoProduct);

            _localStore.UpsertProduct(ecoProduct);

            RecordHistory(machine.Code, "pull", "success", productCode, localBefore?.PointsConfigVersion, ecoProduct.PointsConfigVersion,
                $"{diff.AddedPointCodes.Count} added, {diff.RemovedPointCodes.Count} removed, {diff.ChangedPoints.Count} changed");

            return new MachineConfigPullResultDto(
                machine.Code, "points", productCode,
                Applied: true,
                FromVersion: localBefore?.PointsConfigVersion,
                ToVersion: ecoProduct.PointsConfigVersion,
                PointsApplied: ecoProduct.ActivePoints.Count(),
                PointsRemoved: diff.RemovedPointCodes.Count,
                Diff: diff,
                Message: $"Pulled '{productCode}' from ecosystem: v{(localBefore?.PointsConfigVersion.ToString() ?? "none")} -> v{ecoProduct.PointsConfigVersion}.");
        }
        else
        {
            var recipeCheck = await _backend.CheckRecipeAsync(null, machine.MachineType, ct).ConfigureAwait(false);
            if (!recipeCheck.Success || recipeCheck.Code is null)
            {
                return new MachineConfigPullResultDto(
                    machine.Code, "recipe", machine.MachineType ?? "", Applied: false, FromVersion: null, ToVersion: null,
                    PointsApplied: 0, PointsRemoved: 0, Diff: null,
                    Message: $"No recipe/device_settings found for machine type '{machine.MachineType}'.");
            }

            var ecoRecipe = await _backend.GetRecipeAsync(recipeCheck.Code, ct).ConfigureAwait(false)
                ?? throw new KeyNotFoundException($"Recipe '{recipeCheck.Code}' reported by check but not found by get.");

            var localBefore = _localStore.GetRecipe(recipeCheck.Code);
            _localStore.UpsertRecipe(ecoRecipe);

            RecordHistory(machine.Code, "pull", "success", recipeCheck.Code, localBefore?.Version, ecoRecipe.Version, "recipe payload applied");

            return new MachineConfigPullResultDto(
                machine.Code, "recipe", recipeCheck.Code,
                Applied: true, FromVersion: localBefore?.Version, ToVersion: ecoRecipe.Version,
                PointsApplied: 0, PointsRemoved: 0, Diff: null,
                Message: $"Pulled recipe '{recipeCheck.Code}' from ecosystem: v{(localBefore?.Version.ToString() ?? "none")} -> v{ecoRecipe.Version}.");
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // PUSH (machine → ecosystem)
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Convenience path: pushes every currently-active local point for <paramref
    /// name="productCode"/>, blind (no optimistic-lock token) — matches the contract's default. This is
    /// what <c>POST /v1/machines/{code}/config/push</c> calls.</summary>
    public Task<MachineConfigPushResultDto> PushAsync(MachineDescriptor machine, string productCode, bool confirm, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(machine);
        ArgumentException.ThrowIfNullOrEmpty(productCode);

        var local = _localStore.GetProduct(productCode)
            ?? throw new KeyNotFoundException($"Product '{productCode}' not found locally — nothing to push.");

        var dtos = local.ActivePoints.Select(p => ToWireDto(p, expectedUpdatedAt: null)).ToList();
        return PushPointsAsync(machine, productCode, dtos, confirm, ct);
    }

    /// <summary>Lower-level primitive: pushes the EXACT <paramref name="points"/> given (caller controls
    /// every field, including any per-point <see cref="SyncPointDto.ExpectedUpdatedAt"/> lock token) —
    /// what exercises the optimistic-lock path precisely, and the natural extension point for a future
    /// "push just this one edited point" UI affordance.</summary>
    public async Task<MachineConfigPushResultDto> PushPointsAsync(
        MachineDescriptor machine, string productCode, IReadOnlyList<SyncPointDto> points, bool confirm, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(machine);
        ArgumentException.ThrowIfNullOrEmpty(productCode);
        ArgumentNullException.ThrowIfNull(points);

        if (!confirm)
        {
            return new MachineConfigPushResultDto(
                machine.Code, productCode, Success: false, PreviousVersion: null, NewVersion: null,
                PointsCreated: 0, PointsUpdated: 0, PointsFailed: 0, StaleConflicts: 0, BlindOverwrites: 0,
                LimitChangesBlocked: false, Points: Array.Empty<SyncPointOutcomeDto>(),
                Message: "push requires confirm:true (guarded — see plan's C3 'guarded push' note).");
        }

        var request = new SyncPointsRequestDto(machine.Code, productCode, null, null, null, null, points);
        var result = await _backend.SyncPointsAsync(productCode, request, ct).ConfigureAwait(false);

        RecordHistory(machine.Code, "push", result.Success ? "success" : "failed", productCode, result.PreviousVersion, result.NewVersion,
            $"{result.PointsCreated} created, {result.PointsUpdated} updated, {result.StaleConflicts} conflicts, limitBlocked={result.LimitChangesBlocked}");

        return new MachineConfigPushResultDto(
            machine.Code, productCode, result.Success,
            result.PreviousVersion, result.NewVersion,
            result.PointsCreated, result.PointsUpdated, result.PointsFailed,
            result.StaleConflicts, result.BlindOverwrites, result.LimitChangesBlocked,
            result.Points,
            BuildPushMessage(result));
    }

    // ─────────────────────────────────────────────────────────────────────
    // DIFF (local vs ecosystem, points only)
    // ─────────────────────────────────────────────────────────────────────
    public async Task<MachineConfigDiffDto> DiffAsync(MachineDescriptor machine, string productCode, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(machine);
        ArgumentException.ThrowIfNullOrEmpty(productCode);

        if (machine.DeviceClass != DeviceClass.AoiAvi)
        {
            throw new InvalidOperationException("diff is only available for AOI/AVI (points-based) machines; use check/pull for recipe machines.");
        }

        var ecoProduct = await _backend.GetPointsAsync(productCode, null, ct).ConfigureAwait(false)
            ?? throw new KeyNotFoundException($"Product '{productCode}' not found in the ecosystem.");
        var local = _localStore.GetProduct(productCode);

        return ComputeDiff(machine.Code, productCode, local, ecoProduct);
    }

    // ─────────────────────────────────────────────────────────────────────
    // HISTORY
    // ─────────────────────────────────────────────────────────────────────
    public IReadOnlyList<ConfigSyncHistoryEntryDto> History(string machineCode)
    {
        lock (_historyGate)
        {
            return _history.TryGetValue(machineCode, out var list)
                ? list.OrderByDescending(e => e.Seq).ToList()
                : Array.Empty<ConfigSyncHistoryEntryDto>();
        }
    }

    private void RecordHistory(string machineCode, string op, string status, string code, int? fromVersion, int? toVersion, string summary)
    {
        var seq = Interlocked.Increment(ref _historySeq);
        var entry = new ConfigSyncHistoryEntryDto(seq, DateTimeOffset.UtcNow, machineCode, op, status, code, fromVersion, toVersion, summary);
        lock (_historyGate)
        {
            var list = _history.GetOrAdd(machineCode, _ => new List<ConfigSyncHistoryEntryDto>());
            list.Add(entry);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Diff computation — field-level, points only.
    // ─────────────────────────────────────────────────────────────────────
    private static MachineConfigDiffDto ComputeDiff(string machineCode, string productCode, ProductModel? local, ProductModel eco)
    {
        var localActive = (local?.Points ?? new List<MeasurementPoint>())
            .Where(p => !p.IsDeleted)
            .ToDictionary(p => p.Code, p => p, StringComparer.OrdinalIgnoreCase);
        var ecoActive = eco.Points.Where(p => !p.IsDeleted).ToDictionary(p => p.Code, p => p, StringComparer.OrdinalIgnoreCase);
        var ecoTombstoned = eco.Points.Where(p => p.IsDeleted).Select(p => p.Code).ToHashSet(StringComparer.OrdinalIgnoreCase);

        var added = ecoActive.Keys
            .Where(c => !localActive.ContainsKey(c))
            .OrderBy(c => c, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var removed = localActive.Keys
            .Where(c => ecoTombstoned.Contains(c))
            .OrderBy(c => c, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var changed = new List<ChangedPointDto>();
        foreach (var code in localActive.Keys.Intersect(ecoActive.Keys, StringComparer.OrdinalIgnoreCase)
                     .OrderBy(c => c, StringComparer.OrdinalIgnoreCase))
        {
            var fields = DiffFields(localActive[code], ecoActive[code]);
            if (fields.Count > 0) changed.Add(new ChangedPointDto(code, ecoActive[code].Name, fields));
        }

        var localVersion = local?.PointsConfigVersion;
        return new MachineConfigDiffDto(
            machineCode, productCode, localVersion, eco.PointsConfigVersion,
            eco.PointsConfigVersion - (localVersion ?? 0),
            added, removed, changed);
    }

    private static List<PointFieldChangeDto> DiffFields(MeasurementPoint a, MeasurementPoint b)
    {
        var changes = new List<PointFieldChangeDto>();

        void Cmp<T>(string field, T? x, T? y)
        {
            if (!Equals(x, y)) changes.Add(new PointFieldChangeDto(field, x?.ToString(), y?.ToString()));
        }

        Cmp("name", a.Name, b.Name);
        Cmp("description", a.Description, b.Description);
        Cmp("lowerLimit", a.LowerLimit, b.LowerLimit);
        Cmp("upperLimit", a.UpperLimit, b.UpperLimit);
        Cmp("nominalValue", a.NominalValue, b.NominalValue);
        Cmp("positionX", a.PositionX, b.PositionX);
        Cmp("positionY", a.PositionY, b.PositionY);
        Cmp("normalizedX", a.NormalizedX, b.NormalizedX);
        Cmp("normalizedY", a.NormalizedY, b.NormalizedY);
        Cmp("shape", a.Shape, b.Shape);
        Cmp("isActive", a.IsActive, b.IsActive);
        Cmp("referenceImageUrl", a.ReferenceImageUrl, b.ReferenceImageUrl);

        var geomA = a.Geometry?.GetRawText();
        var geomB = b.Geometry?.GetRawText();
        if (geomA != geomB) changes.Add(new PointFieldChangeDto("geometry", geomA, geomB));

        return changes;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Wire conversion (local domain model → contract-shaped push DTO).
    // ─────────────────────────────────────────────────────────────────────
    private static SyncPointDto ToWireDto(MeasurementPoint p, DateTimeOffset? expectedUpdatedAt) => new(
        p.Code, p.Name, p.Description, p.MeasurementType.ToString().ToUpperInvariant(), p.Unit,
        p.LowerLimit, p.UpperLimit, p.NominalValue,
        p.PositionX, p.PositionY, p.Radius,
        p.NormalizedX, p.NormalizedY, p.NormalizedRadius,
        p.CropWidth, p.CropHeight, p.OrderIndex, null, p.IsActive,
        null, null, p.ReferenceImageUrl,
        p.Shape.ToString().ToLowerInvariant(), p.Geometry,
        expectedUpdatedAt);

    private static string BuildPushMessage(SyncPointsResultDto r)
    {
        if (!r.Success) return $"Push completed with {r.PointsFailed} failed point(s).";
        var parts = new List<string> { $"{r.PointsCreated} created", $"{r.PointsUpdated} updated" };
        if (r.StaleConflicts > 0) parts.Add($"{r.StaleConflicts} conflict(s)");
        if (r.LimitChangesBlocked) parts.Add("some limit changes blocked by threshold governance");
        return $"Pushed to ecosystem v{r.PreviousVersion} -> v{r.NewVersion}: {string.Join(", ", parts)}.";
    }
}
