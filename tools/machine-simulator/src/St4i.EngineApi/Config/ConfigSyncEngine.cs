using System.Collections.Concurrent;
using System.Text.Json;
using St4i.EdgeCore.Config;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;

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
                    var localChecksum = local is null ? null : ConfigChecksum.ComputePointsChecksum(local.Points);
                    var state = ComputePointsDriftState(localVersion, v.PointsConfigVersion, localChecksum, v.PointsChecksum);
                    return new ProductDriftDto(v.ProductModelCode, localVersion, v.PointsConfigVersion, state, localChecksum, v.PointsChecksum);
                })
                .ToList();

            return new MachineConfigCheckDto(machine.Code, "points", drift, null);
        }

        var configKind = ResolveConfigKind(machine.DeviceClass);
        var recipeCheck = await _backend.CheckRecipeAsync(null, machine.MachineType, configKind, ct).ConfigureAwait(false);
        if (!recipeCheck.Success || recipeCheck.Code is null)
        {
            return new MachineConfigCheckDto(machine.Code, "recipe", Array.Empty<ProductDriftDto>(), null);
        }

        var localRecipe = _localStore.GetRecipe(recipeCheck.Code);
        var recipeState = localRecipe is null ? "unknown" : localRecipe.Version == recipeCheck.Version ? "in_sync" : "drift";
        var recipeDto = new RecipeDriftDto(recipeCheck.Code, localRecipe?.Version, recipeCheck.Version, recipeState, recipeCheck.ResolvedBy);
        return new MachineConfigCheckDto(machine.Code, "recipe", Array.Empty<ProductDriftDto>(), recipeDto);
    }

    /// <summary>
    /// Task review #4 — the wire-level <c>configKind</c> the SERVER's own contract distinguishes
    /// (CONFIG_SYNC_SERVER_CONTRACT.md: "Recipe ↔ Automation machines. device_settings ↔ IoT.") — separate
    /// from <see cref="MachineConfigCheckDto.ConfigKind"/>/<see cref="MachineConfigPullResultDto.ConfigKind"/>,
    /// which deliberately keep using the umbrella term "recipe" for BOTH at this engine's own outward
    /// /v1 surface (see <see cref="MachineConfigCheckDto"/>'s doc comment — a UI simplification, not a
    /// wire-protocol detail). This is what actually goes out on <see cref="IConfigSyncBackend.CheckRecipeAsync"/>/
    /// <see cref="IConfigSyncBackend.GetRecipeAsync"/>'s <c>configKind</c> query param against a real Live
    /// server, so an IoT machine's <c>device_settings</c> resolves correctly instead of always asking for
    /// a <c>recipe</c> that will never match it. <see cref="DeviceClass.AoiAvi"/> never reaches this
    /// (points, not recipe/device_settings) — the "recipe" fallback below is just documentation of that.
    /// </summary>
    private static string ResolveConfigKind(DeviceClass deviceClass) => deviceClass switch
    {
        DeviceClass.Iot => "device_settings",
        _ => "recipe",
    };

    /// <summary>
    /// Task C8 — checksum-first drift verdict for a points-config product, mirroring this project's OWN
    /// server-side <c>computeDriftState</c> (server/services/configDriftService.ts) EXACTLY: "unknown"
    /// when the local machine has never seen this product at all; when BOTH sides carry a points-content
    /// checksum it is AUTHORITATIVE (byte-exact — ignores <paramref name="localVersion"/>/<paramref
    /// name="ecosystemVersion"/> entirely, so identical content reads <c>in_sync</c> even under
    /// different version LABELS, and matching version labels over DIFFERENT content still reads
    /// <c>drift</c>); otherwise falls back to plain version equality (the only signal available, e.g.
    /// against a Live backend whose check-points-version response carries no checksum per
    /// CONFIG_SYNC_SERVER_CONTRACT.md).
    ///
    /// This replaces a real bug a pure version comparison had: two independent version bumps (a local
    /// edit and an unrelated ecosystem edit) that happen to land on the SAME version NUMBER but carry
    /// genuinely different point content used to read "in_sync" — silently hiding real drift from the
    /// operator. See <c>ConfigSyncEngineTests</c>'s checksum-drift tests for the exact repro.
    /// </summary>
    private static string ComputePointsDriftState(int? localVersion, int ecosystemVersion, string? localChecksum, string? ecosystemChecksum)
    {
        if (localVersion is null) return "unknown";

        if (localChecksum is not null && ecosystemChecksum is not null)
        {
            return localChecksum == ecosystemChecksum ? "in_sync" : "drift";
        }

        return localVersion == ecosystemVersion ? "in_sync" : "drift";
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
            var configKind = ResolveConfigKind(machine.DeviceClass);
            var recipeCheck = await _backend.CheckRecipeAsync(null, machine.MachineType, configKind, ct).ConfigureAwait(false);
            if (!recipeCheck.Success || recipeCheck.Code is null)
            {
                return new MachineConfigPullResultDto(
                    machine.Code, "recipe", machine.MachineType ?? "", Applied: false, FromVersion: null, ToVersion: null,
                    PointsApplied: 0, PointsRemoved: 0, Diff: null,
                    Message: $"No recipe/device_settings found for machine type '{machine.MachineType}'.");
            }

            var ecoRecipe = await _backend.GetRecipeAsync(recipeCheck.Code, configKind, ct).ConfigureAwait(false)
                ?? throw new KeyNotFoundException($"Recipe '{recipeCheck.Code}' reported by check but not found by get.");

            var localBefore = _localStore.GetRecipe(recipeCheck.Code);
            _localStore.UpsertRecipe(ecoRecipe);

            RecordHistory(machine.Code, "pull", "success", recipeCheck.Code, localBefore?.Version, ecoRecipe.Version, "recipe payload applied");

            // Task review #4 — best-effort drift-shadow ack after a successful recipe/device_settings
            // pull: tells the server what this machine now believes its resolved config state is
            // (CONFIG_SYNC_SERVER_CONTRACT.md's POST .../config-sync/ack, "writes drift-shadow only,
            // never real config"). Fire-and-forget in spirit but still awaited so a Live failure surfaces
            // in logs/tests rather than racing the response — never allowed to fail the pull itself
            // (both IConfigSyncBackend implementations are "friendly, never throws" for this method, same
            // as every other read-ish backend call, so no try/catch is needed here).
            await _backend.AckAsync(configKind, ecoRecipe.Code, ecoRecipe.Version, ecoRecipe.Checksum, ct).ConfigureAwait(false);

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

        // Task review #2 — still recorded unconditionally (an operator attempting a push, even a no-op
        // one, is itself worth an audit trail entry — e.g. "confirmed nothing needed pushing"), but now
        // TRUTHFULLY: SimulatedEcosystem/a real server only counts a point toward PointsUpdated when its
        // content genuinely changed (ConfigChecksum.PointContentEquals) and only bumps the version when
        // created+updated > 0, so a redundant re-push of byte-identical content records "0 created, 0
        // updated" against an UNCHANGED "vN -> vN" — never the misleading "vN -> vN+1" bump a naive
        // re-push used to produce.
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

        // Task review #3 — "removed" means "a pull would remove/tombstone this locally", which is true
        // in TWO cases, not just one: (1) the usual tombstoned-on-the-ecosystem case (the point still
        // exists there, just soft-deleted); AND (2) the point is in localActive but the ecosystem has NO
        // record of it at all (never existed there, or was hard-removed rather than tombstoned) — case
        // (2) used to be silently dropped from this diff even though PullAsync's wholesale
        // UpsertProduct(ecoProduct) (a whole-aggregate REPLACE, not a merge) drops that point locally too,
        // so the diff under-reported what a pull would actually do.
        var removed = localActive.Keys
            .Where(c => ecoTombstoned.Contains(c) || !ecoActive.ContainsKey(c))
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

    /// <summary>
    /// Task review #1 — full-spec, generic property-by-property diff, driven off the SAME canonicalized
    /// serialization <see cref="ConfigChecksum.ComputePointsChecksum"/> uses (via
    /// <see cref="ConfigChecksum.CanonicalizePoint(MeasurementPoint)"/>: serialize, strip the audit fields
    /// LastModifiedAt/DeletedAt/DeletedAtVersion) instead of a hand-maintained list of ~13 <c>Cmp(...)</c>
    /// calls. This is the fix for the Important finding: the old list omitted unit/measurementType/
    /// toleranceMode/tolPlus/tolMinus/radius/normalizedRadius/crop/orderIndex/positionZ/every 3D-solder-
    /// x-ray field/criteria/lighting/cells, so a point differing ONLY in one of those showed "up to date"
    /// in this diff while the checksum-based drift badge (which hashes the whole point) simultaneously
    /// read "drift" — a contradiction between the two truthfulness surfaces. Driving both off the exact
    /// same canonicalization makes that contradiction structurally impossible: whatever field set the
    /// checksum hashes is exactly the field set this diff compares, always in lockstep.
    /// </summary>
    private static List<PointFieldChangeDto> DiffFields(MeasurementPoint a, MeasurementPoint b)
    {
        var canonicalA = ConfigChecksum.CanonicalizePoint(a);
        var canonicalB = ConfigChecksum.CanonicalizePoint(b);

        var changes = new List<PointFieldChangeDto>();
        foreach (var field in canonicalA.Keys.Union(canonicalB.Keys, StringComparer.Ordinal)
                     .Where(f => f != nameof(MeasurementPoint.Code)) // the join key, not a "changed field"
                     .OrderBy(f => f, StringComparer.Ordinal))
        {
            canonicalA.TryGetValue(field, out var va);
            canonicalB.TryGetValue(field, out var vb);
            if (JsonRawEquals(va, vb)) continue;

            changes.Add(new PointFieldChangeDto(ToCamelCase(field), FormatFieldValue(va), FormatFieldValue(vb)));
        }

        return changes;
    }

    /// <summary>Raw-JSON-text equality — the same notion of "equal" <see cref="ConfigChecksum"/>'s own
    /// stable-stringify hashing uses (numbers/strings/booleans compare by their serialized form; objects/
    /// arrays like geometry/cells/criteria/lighting compare structurally via their exact text). A missing
    /// key on either side (shouldn't happen — both canonicalizations come from the SAME POCO shape — but
    /// handled defensively) is treated via <see cref="JsonValueKind.Undefined"/>, never thrown on.</summary>
    private static bool JsonRawEquals(JsonElement a, JsonElement b)
    {
        var rawA = a.ValueKind == JsonValueKind.Undefined ? null : a.GetRawText();
        var rawB = b.ValueKind == JsonValueKind.Undefined ? null : b.GetRawText();
        return rawA == rawB;
    }

    /// <summary>Legible display value for one side of a changed field — unwraps a JSON string to its
    /// plain text (e.g. <c>circle</c>, not <c>"circle"</c>), a bool to <c>True</c>/<c>False</c> (matches
    /// this project's previous <c>bool.ToString()</c>-based formatting the web layer's
    /// <c>formatDiffScalar</c> already special-cases for <c>isActive</c>), null/missing to a plain null
    /// (the web layer renders its own em-dash placeholder for that), and everything else (numbers,
    /// objects/arrays like geometry/cells/criteria/lighting) as raw JSON text.</summary>
    private static string? FormatFieldValue(JsonElement el) => el.ValueKind switch
    {
        JsonValueKind.Undefined or JsonValueKind.Null => null,
        JsonValueKind.String => el.GetString(),
        JsonValueKind.True => bool.TrueString,
        JsonValueKind.False => bool.FalseString,
        _ => el.GetRawText(),
    };

    /// <summary>"LowerLimit" -> "lowerLimit" — every <see cref="MeasurementPoint"/> property name is
    /// simple PascalCase (no acronyms/digits needing special handling), so lower-casing just the first
    /// character reproduces the contract's camelCase wire field name exactly (matches the previous
    /// hand-written field key list byte-for-byte for the 13 fields it already covered, e.g.
    /// "ReferenceImageUrl" -> "referenceImageUrl", "PositionX" -> "positionX").</summary>
    private static string ToCamelCase(string pascal) =>
        string.IsNullOrEmpty(pascal) ? pascal : char.ToLowerInvariant(pascal[0]) + pascal[1..];

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
