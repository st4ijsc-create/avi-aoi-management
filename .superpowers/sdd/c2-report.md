# Task C2 — Demo simulated-ecosystem config-sync engine + Engine REST endpoints

Status: DONE. Build clean, `St4i.EngineApi.Tests` 60/60 green (17 new), `St4i.EdgeCore.Tests` 115/115
green. Live curl smoke against the running engine confirmed the full check→diff→push→pull→history flow
plus governance/optimistic-lock/tombstone behavior.

## Files

- `src/St4i.EngineApi/Config/SimulatedEcosystem.cs` — the Demo backend (`IConfigSyncBackend`
  implementation). In-process, JSON-persisted (`ecosystem-products.json`/`ecosystem-recipes.json`,
  default dir `<baseDir>/ecosystem`, separate from `ProductConfigStore`'s `products.json`/`recipes.json`).
- `src/St4i.EngineApi/Config/IConfigSyncBackend.cs` — the seam interface (see below).
- `src/St4i.EngineApi/Config/SwitchableConfigSyncBackend.cs` — mode-switchable wrapper, mirrors
  `St4i.EdgeCore.Transport.SwitchableTransport` exactly. `ConfigSyncEngine` is registered against THIS
  type, not `SimulatedEcosystem` directly.
- `src/St4i.EngineApi/Config/ConfigSyncEngine.cs` — orchestrator: check/pull/push/diff/history,
  local-vs-ecosystem diff computation, history log.
- `src/St4i.EngineApi/Config/ConfigDtos.cs` — all wire DTOs, incl. `SyncPointDto` (contract-faithful
  reduced push shape) for C3 to reuse verbatim.
- `src/St4i.EngineApi/Config/ConfigJson.cs` — **important gotcha fix**, see below.
- `src/St4i.EngineApi/Endpoints/ConfigEndpoints.cs` — all `/v1` routes.
- `src/St4i.EdgeCore/Config/ProductConfigStore.cs` — tiny change: `SeedProducts()`/`SeedRecipes()`
  widened from `private static` to `public static` so `SimulatedEcosystem` can start from the exact same
  seed baseline (byte-identical) and patch its own divergence on top, instead of duplicating ~300 lines
  of seed point data a second time.
- `src/St4i.EngineApi/Program.cs` — DI wiring (`ProductConfigStore`, `SimulatedEcosystem`,
  `SwitchableConfigSyncBackend` → `IConfigSyncBackend`, `ConfigSyncEngine`) + `app.MapConfigEndpoints()`.
- `tests/St4i.EngineApi.Tests/ConfigSyncEngineTests.cs` — 17 tests, see below.

## GOTCHA found + fixed: enum casing through the ASP.NET JSON pipeline

`Program.cs`'s `ConfigureHttpJsonOptions` registers a global `JsonStringEnumConverter()` (no naming
policy → plain C# member names, e.g. `"Live"`, intentional for `TransportMode`/`DeviceClass`/etc. used
by every OTHER endpoint). System.Text.Json's converter precedence is: member-attr > **Options.Converters
entry** > type-attr. So a converter registered in `Options.Converters` OUTRANKS a type-level
`[JsonConverter]` attribute — meaning C1's carefully-built `SnakeLowerEnumConverter`/
`SnakeUpperEnumConverter` attributes on `ProductLifecycleStatus`/`MeasurementType`/`ToleranceMode`/
`PointShape`/`CoordinateMode`/`RecipeStatus` were being silently overridden by the global registration
whenever a config-sync response went through the normal `Results.Ok(...)` pipeline. Caught live via curl
(`"measurementType":"Dimension"` instead of the contract's `"DIMENSION"`) — NOT found by any unit test,
since C1's own tests call `JsonSerializer.Serialize()` directly with no options (no competing global
converter in that context).

**Fix**: `ConfigJson.Options` — a plain `new JsonSerializerOptions(JsonSerializerDefaults.Web)` with NO
enum converter added. `ConfigEndpoints.Json<T>(value)` (`Results.Json(value, ConfigJson.Options)`)
replaces every `Results.Ok(...)` in that file. Verified live afterward: `"lifecycleStatus":"active"`,
`"measurementType":"DIMENSION"`, `"toleranceMode":"range"`, `"shape":"circle"|"ring"|"array"`,
`"coordinateMode":"pixel"`, `"status":"active"` (recipe) — all contract-exact. **C3 should be aware of
this pattern** if it adds any endpoint/serialization path touching these enums.

## ConfigSyncEngine backend seam (for C3)

```csharp
namespace St4i.EngineApi.Config;

public interface IConfigSyncBackend
{
    string Name { get; } // "Demo" | "Live"

    Task<IReadOnlyList<ProductVersionDto>> CheckPointsVersionAsync(string? productModelCode, CancellationToken ct);
    Task<ProductModel?> GetPointsAsync(string productModelCode, string? variantCode, CancellationToken ct);
    Task<PointsDeltaResultDto> DeltaSyncPointsAsync(string productModelCode, int sinceVersion, CancellationToken ct);
    Task<SyncPointsResultDto> SyncPointsAsync(string productModelCode, SyncPointsRequestDto request, CancellationToken ct);
    Task<(bool Found, string? ImageUrl)> GetProductImageAsync(string productModelCode, CancellationToken ct);
    Task<bool> SyncProductImageAsync(string productModelCode, string? imageBase64, string? imageUrl, string? imageMimeType, CancellationToken ct);
    Task<(bool Found, string? ImageUrl)> GetPointImageAsync(string productModelCode, string pointCode, CancellationToken ct);
    Task<bool> SyncPointImageAsync(string productModelCode, string pointCode, string? imageBase64, string? imageUrl, CancellationToken ct);
    Task<RecipeCheckResultDto> CheckRecipeAsync(string? code, string? machineType, CancellationToken ct);
    Task<Recipe?> GetRecipeAsync(string code, CancellationToken ct);
}
```

`SwitchableConfigSyncBackend : IConfigSyncBackend` wraps a mutable `_inner` (same one-gate-one-field
pattern as `SwitchableTransport`). DI registers `ConfigSyncEngine` against `IConfigSyncBackend` resolved
to the `SwitchableConfigSyncBackend` singleton, which itself defaults to `SimulatedEcosystem`. **C3's
job**: implement `LiveConfigSyncBackend : IConfigSyncBackend` (real HTTP calls per
CONFIG_SYNC_SERVER_CONTRACT.md, using `CredentialStore`'s `mk_` key), then call
`switchableBackend.SetInner(liveInstance)` whenever the app's transport mode flips to Live/Auto — most
naturally by subscribing to `TransportCoordinator.ModeChanged` (or adding a parallel
`ConfigSyncCoordinator` if `SetInner` needs a rebuild-on-settings-change story like `RebuildLive` does).
No change needed to `ConfigSyncEngine`, `ConfigEndpoints`, or any DTO — they only ever talk to
`IConfigSyncBackend`.

`SyncPointDto` (the push wire shape) is deliberately built to mirror `sync-points`'s exact reduced field
set from the contract (no 3D/solder/tolerance/criteria/lighting — those are SYNAPSE-UI-authored only) so
C3 can serialize this SAME type onto the real HTTP body unchanged.

`ConfigSyncEngine.PushAsync` (confirm-gated, blind/no-lock convenience — what the endpoint uses) is built
on `ConfigSyncEngine.PushPointsAsync` (lower-level: caller supplies exact `SyncPointDto`s incl. optional
per-point `ExpectedUpdatedAt` lock token) — C3's Live backend doesn't need to change this split, just
implement `SyncPointsAsync` for real.

## Per-machine config endpoints (for web / C4-C7)

All under `/v1`, machine resolved via `FleetHost.Fleet` (404 `{error}` if unknown):

- `GET /v1/machines/{code}/config/check?productCode=` — optional productCode (AOI/AVI machines; omit =
  all products). Returns `MachineConfigCheckDto{machineCode, configKind:"points"|"recipe", products[], recipe}`.
- `POST /v1/machines/{code}/config/pull` — body `{productCode?}` (**required** for AOI/AVI machines,
  ignored/auto-resolved-by-machineType for Automation/IoT). Returns `MachineConfigPullResultDto` incl. an
  embedded `diff` (the pre-apply preview) and `applied/fromVersion/toVersion`.
- `POST /v1/machines/{code}/config/push` — body `{productCode, confirm:true}` (both required; `confirm`
  omitted/false → `Success:false`, no-op, friendly message, NOT an error). Returns
  `MachineConfigPushResultDto` with per-point outcomes (`created|updated|conflict|failed`,
  `limitBlocked`), aggregate `staleConflicts`/`blindOverwrites`/`limitChangesBlocked`, new version.
- `GET /v1/machines/{code}/config/diff?productCode=` — **productCode required** (400 if missing); points
  only (400 `InvalidOperationException`-mapped if called on a recipe-class machine). Returns
  `MachineConfigDiffDto{addedPointCodes, removedPointCodes, changedPoints:[{code,name,fields:[{field,localValue,ecosystemValue}]}], versionDelta}`.
- `GET /v1/machines/{code}/config/history` — `ConfigSyncHistoryEntryDto[]`, most-recent-first
  (ordered by an incrementing `seq`, not wall-clock — deterministic).

Plus authoring CRUD (thin `ProductConfigStore` wrappers, not machine-scoped):
`GET /v1/products`, `GET/POST/PUT/DELETE /v1/products/{code}`,
`GET/POST/PUT/DELETE /v1/products/{code}/points/{pointCode}` (+ `GET .../points?includeDeleted=`),
`GET /v1/recipes`, `GET/PUT/DELETE /v1/recipes/{code}`.

## SimulatedEcosystem seed divergence

Starts from `ProductConfigStore.SeedProducts()`/`SeedRecipes()` (now `public static`, byte-identical
baseline) and patches on top:

- **MODEL-A** (Active, local seed v3 → ecosystem v5, +2): P05's limits widened (4750/5250 → 4700/5300 —
  a changed-limit diff, and the exact scenario that trips threshold governance if pushed back narrower);
  P08 tombstoned (a removed/tombstone diff); P09 added (a new point, an added diff). All three land in
  one product so a single check/diff/pull already tells the whole story.
- **MODEL-B** (Development, v1 → v2, +1): Q03's UpperLimit nudged 0.35→0.36 — light divergence, and the
  product governance bypass proves against.
- **SCREWDRIVE-M4** recipe (v2 → v3, +1): `torqueTarget` 1.35→1.40 + updated notes.

## Test evidence

`dotnet test tests/St4i.EngineApi.Tests` → **60/60 passed** (17 new `ConfigSyncEngineTests` + 43
pre-existing, all still green). `dotnet test tests/St4i.EdgeCore.Tests` → **115/115 passed** (unchanged
by the `SeedProducts`/`SeedRecipes` visibility widen). New test coverage: push-bumps-version+point-present,
push-without-confirm-noop, push-unknown-product-404(KeyNotFoundException), pull-applies-divergence
(version/added/removed/changed all asserted), pull-missing-productCode-throws, diff-detects-all-three-
categories+delta, diff-on-recipe-machine-throws, check-drift-then-in-sync-after-pull, governance-blocks-
limit-on-Active-but-applies-name, governance-allows-limit-on-Development, optimistic-lock-stale-conflicts-
not-overwritten+fresh-token-applies, delta-sync-tombstone+no-change-branch, recipe-check-and-pull,
recipe-check-no-match-graceful, history-ordering, history-empty-for-unknown-machine.

## Live curl smoke (Demo mode, port 5199)

```
GET /v1/products
  → [{"code":"MODEL-A",...,"lifecycleStatus":"active","pointsConfigVersion":3,"pointCount":8},
     {"code":"MODEL-B",...,"lifecycleStatus":"development","pointsConfigVersion":1,"pointCount":6}]

GET /v1/machines/AOI-01/config/check?productCode=MODEL-A
  → {"products":[{"productModelCode":"MODEL-A","localVersion":3,"ecosystemVersion":5,"driftState":"drift"}]}

GET /v1/machines/AOI-01/config/diff?productCode=MODEL-A
  → addedPointCodes:["P09"], removedPointCodes:["P08"],
    changedPoints:[{"code":"P05","fields":[{"field":"lowerLimit","localValue":"4750","ecosystemValue":"4700"},
                                            {"field":"upperLimit","localValue":"5250","ecosystemValue":"5300"}]}],
    versionDelta:2

POST /v1/machines/AOI-01/config/push {productCode:"MODEL-A",confirm:true}
  → success:true, previousVersion:5, newVersion:6, pointsUpdated:8, limitChangesBlocked:true,
    P05.limitBlocked:true ("limit fields blocked by threshold governance"), P01-P04/P06-P08 applied clean

POST /v1/machines/AOI-01/config/pull {productCode:"MODEL-A"}
  → applied:true, fromVersion:3, toVersion:6, pointsApplied:9

GET /v1/machines/AOI-01/config/history
  → [{"seq":2,"op":"pull",...},{"seq":1,"op":"push",...}]  (most-recent-first)

GET /v1/machines/SCRW-01/config/check
  → configKind:"recipe", recipe:{"code":"SCREWDRIVE-M4","localVersion":2,"ecosystemVersion":3,"driftState":"drift","resolvedBy":"machineType"}

GET /v1/machines/NOPE-99/config/check → HTTP 404 {"error":"machine \"NOPE-99\" not found"}
```

Post-fix re-verification (fresh process, casing check):
`lifecycleStatus:"active"`, `measurementType:"DIMENSION"`, `toleranceMode:"range"`,
`shape:"circle"|"ring"|"array"`, `coordinateMode:"pixel"`, recipe `status:"active"` — all contract-exact.

## Concerns / deferred (documented, not blocking)

- **Product binding for AOI/AVI machines**: `MachineDescriptor` carries no `productModelCode` (matches
  the real system — a machine doesn't own one fixed product). `productCode` is a required param on
  pull/push/diff, optional (defaults to "all products") on check. C4-C7's UI needs to let the operator
  pick/see the active product per machine.
- **Variant merging**: `GetPointsAsync`'s `variantCode` param is accepted for shape parity but variant
  overrides are NOT merged in (always returns the base product). Noted in the interface doc comment.
- **Delta-sync is a simplification**: no per-point version tracking exists, only per-product — so
  `DeltaSyncPointsAsync` returns the full active set + tombstones-since-version rather than a true
  field-level delta. Matches the contract's own "else full diff + tombstones" wording; no dedicated REST
  endpoint was added for it in C2 (not in the plan's per-machine endpoint list) — it's exercised directly
  against the backend in tests, available for C3/future use.
- **Recipe push (Demo-only, per C6's note)** was NOT implemented — `IConfigSyncBackend` has no
  `SyncRecipeAsync`; System A stayed pull-only end-to-end in C2, matching the explicit C2 test list
  (recipe check/pull only). If C6 wants a Demo-only recipe-author-push affordance, that's a small
  addition to `SimulatedEcosystem` + engine, not currently present.
- **Optimistic lock is always opt-in-active** in Demo (no simulated `MACHINE_SYNC_OPTIMISTIC_LOCK`
  global flag) — a point either carries `expectedUpdatedAt` (locked) or doesn't (blind), matching the
  contract's per-point opt-in description; the global flag toggle itself isn't modeled since Demo has no
  server settings surface for it.
- **Image sync** (`SyncProductImageAsync`/`SyncPointImageAsync`/`Get*ImageAsync`) is implemented on the
  backend interface + `SimulatedEcosystem` but has NO REST endpoint yet (not in the plan's C2 endpoint
  list — images were scoped to C4/C5's canvas work). Ready for C4/C5 to wire up when needed.
