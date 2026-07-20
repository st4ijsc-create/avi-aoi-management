# Task C3 — Live config-sync backend (real System B + A REST via mk_, guarded push)

Status: DONE. `dotnet build` (whole solution `St4iMachineSimulator.sln`) clean. `St4i.EngineApi.Tests`
**74/74 green** (60 pre-existing + 14 new). `St4i.EdgeCore.Tests` **115/115 green, unchanged**.

## Files

- `src/St4i.EngineApi/Config/LiveConfigSyncBackend.cs` — the Live `IConfigSyncBackend` implementation: a
  raw `HttpClient` client, one instance == one calling identity (serverUrl + machine `mk_` + machineCode),
  mirroring `St4i.EdgeCore.Transport.LiveTransport`'s shape (`ForMachine(...)` factory, `IDisposable`,
  optional `HttpMessageHandler` seam for tests).
- `src/St4i.EngineApi/Config/LiveConfigSyncWireDtos.cs` — internal wire-shape records for the ecosystem's
  own response envelopes (`{success, productModels:[...]}` etc.) — kept separate from C2's `ConfigDtos.cs`
  (this engine's own `/v1` DTOs). The two image-sync request bodies (no C2 DTO existed) are declared here;
  everything else on the PUSH side reuses C2's `SyncPointsRequestDto`/`SyncPointDto` verbatim, unchanged,
  exactly as C2's report said they were built for.
- `src/St4i.EngineApi/Config/ConfigSyncCoordinator.cs` — new, mirrors
  `St4i.EdgeCore.Transport.TransportCoordinator`: owns the current `LiveConfigSyncBackend`, `ApplyMode`
  re-points `SwitchableConfigSyncBackend` at Demo/Live per `TransportMode`, `RebuildLive` rebuilds the Live
  instance from fresh serverUrl/machineCode/mk_/verifyTls (disposing the replaced one only after
  re-pointing, same ordering guarantee `TransportCoordinator.RebuildLive` uses).
- `src/St4i.EngineApi/Program.cs` — DI: an eager, unconfigured `LiveConfigSyncBackend` at startup (same
  "empty mk_ at boot, rebuilt by Settings" shape as the existing `LiveTransport` registration) +
  `ConfigSyncCoordinator` singleton.
- `src/St4i.EngineApi/Fleet/FleetHost.cs` — took an **optional** (`= null`) `ConfigSyncCoordinator` ctor
  param (existing tests that construct `FleetHost` directly, `FleetHostHealthAndRegistrationTests`/
  `OnboardingFleetJoinTests`, keep compiling unchanged — they just get a no-op config-sync side, Demo-only,
  same as before this task). `ApplyMode` and `UpdateSettings` now also forward into
  `_configSyncCoordinator` right alongside the existing `_transportCoordinator` calls — same
  `CredentialStore.Load(_machineCode)` mk_ lookup is reused for both.
- `tests/St4i.EngineApi.Tests/LiveConfigSyncTests.cs` — 14 tests (see below), including a small local
  `CapturingHandler` (duplicated, not shared — `St4i.EngineApi.Tests` has no reference to
  `St4i.EdgeCore.Tests`).

## Live endpoint mapping (per CONFIG_SYNC_SERVER_CONTRACT.md)

| `IConfigSyncBackend` method | Real endpoint | Notes |
|---|---|---|
| `CheckPointsVersionAsync` | `GET /api/machine/check-points-version?machineCode=&productModelCode=` | |
| `GetPointsAsync` | `GET /api/machine/get-points?machineCode=&productModelCode=&variantCode=` | Envelope mapped into `ProductModel` (see below) |
| `DeltaSyncPointsAsync` | `GET /api/machine/delta-sync-points?machineCode=&productModelCode=&sinceVersion=` | Not wired to any `/v1` endpoint yet (matches C2 — exercised directly in tests) |
| `SyncPointsAsync` (guarded push) | `POST /api/machine/sync-points` | Body = C2's `SyncPointsRequestDto`/`SyncPointDto` serialized unchanged |
| `GetProductImageAsync` / `SyncProductImageAsync` | `GET /api/machine/product-image` / `POST /api/machine/sync-product-image` | |
| `GetPointImageAsync` / `SyncPointImageAsync` | `GET /api/machine/point-image` / `POST /api/machine/sync-point-image` | |
| `CheckRecipeAsync` | `GET /api/machine/config-sync/check?configKind=recipe&machineCode=&configCode=` | `machineType` param accepted for interface parity but NOT sent — the real endpoint has no such query param, the server resolves `resolvedBy:"machineType"` from the caller's own identity |
| `GetRecipeAsync` | `GET /api/machine/config-sync/get?configKind=recipe&machineCode=&configCode=` | `payload` (jsonb) flattened into `Recipe.Payload` |

Auth: `X-API-Key: <mk_>` **and** `Authorization: Bearer <mk_>` sent together on every call once
`IsConfigured` (mirrors `St4iDeviceClient.HttpSendAsync`'s own dual-header send). `serverUrl.TrimEnd('/')`
applied once in the ctor.

**`GetPointsAsync` mapping**: the contract's get-points envelope (`productModelCode`/`productModelName`/
etc., NOT `ProductModel`'s own field names) is deserialized into a local `GetPointsProductWire` record,
then hand-mapped into `ProductModel` (`Code=ProductModelCode`, `Name=ProductModelName`, ...). `Points`/
`Fiducials` deserialize DIRECTLY into `List<MeasurementPoint>`/`List<Fiducial>` (C1 built those domain
types with the exact camelCase field names + `[JsonConverter(SnakeUpper/SnakeLowerEnumConverter)]` enum
attributes to make this possible — verified live in the `GetPointsAsync_builds_exact_url_and_query` test:
`"measurementType":"DIMENSION"` → `MeasurementType.Dimension`, `"toleranceMode":"range"` →
`ToleranceMode.Range`, `"shape":"circle"` → `PointShape.Circle`, `"coordinateMode":"pixel"` →
`CoordinateMode.Pixel`, all correctly, same `ConfigJson.Options` (no competing global enum converter)
mechanism C2's GOTCHA writeup describes for the `/v1` response side — this is that SAME mechanism applied
inbound). One known gap: get-points' own contract shape carries no `lifecycleStatus` — a Live-pulled
`ProductModel.LifecycleStatus` stays at its class default (`Development`); harmless, since threshold
governance for a Live push is enforced SERVER-side and its outcome (`limitBlocked`) comes back on the
sync-points response, not computed from this field locally.

**Outbound serialization gotcha (new, found by inspection, not live-verified)**: request bodies
(sync-points/sync-product-image/sync-point-image) use a SEPARATE `JsonSerializerOptions` from
`ConfigJson.Options` — same base (`JsonSerializerDefaults.Web`) plus
`DefaultIgnoreCondition = WhenWritingNull`, so optional-and-absent fields (`radius`, `expectedUpdatedAt`,
...) are OMITTED from the JSON rather than sent as an explicit `null`. This mirrors a bug C2/earlier tasks
already hit and fixed once for a DIFFERENT endpoint: `LiveTransport`'s
`Inspection_send_with_OK_point_omits_empty_defectSeverity` test documents a real server Zod field marked
`.optional()` (not `.nullable()`) REJECTING an explicit empty/`null` value with the key present. Response
deserialization still uses plain `ConfigJson.Options` exactly as the brief specifies — this only affects
the outbound direction. Flagged as a documented, reasoned deviation, not an oversight.

## Mode selection (Demo / Live / Auto)

`ConfigSyncCoordinator.ApplyMode(TransportMode)`:
- `Demo` → always `SimulatedEcosystem`.
- `Live` → always the held `LiveConfigSyncBackend`, EVEN IF unconfigured (its own methods then degrade
  friendly-empty per-call — see below) — matches "explicit Live means Live" the same way
  `TransportCoordinator` does for the transport.
- `Auto` → `LiveConfigSyncBackend` **only if** `IsConfigured` (non-empty serverUrl AND non-empty mk_),
  else `SimulatedEcosystem`. This is a STATIC per-rebuild decision, not `AutoTransport`'s per-call
  retry/fallback dance — deliberate: config-sync calls are low-frequency/operator-initiated, not a hot
  per-cycle send path, and `IConfigSyncBackend` has no shared "this failed because the network is down"
  signal to hook a retry off the way `TransportAck`/`ConfigSyncResult` do. Documented in the class's own
  doc comment.

`FleetHost.ApplyMode`/`UpdateSettings` forward the exact same `mode`/`serverUrl`/`machineCode`/`mkKey`/
`verifyTls` into `ConfigSyncCoordinator` right alongside the existing `TransportCoordinator` calls — same
`CredentialStore.Load(machineCode)` mk_, same rebuild-on-settings-change trigger. Verified via 3 direct
`ConfigSyncCoordinator` unit tests (Demo-always-Demo, Live-always-Live-even-unconfigured,
Auto-configured-vs-unconfigured) — no HTTP involved, pure mode-selection logic.

## Guarded push + flag-off handling

- **No `confirm:true`**: unchanged — `ConfigSyncEngine.PushPointsAsync`'s existing guard (C2) runs BEFORE
  `IConfigSyncBackend.SyncPointsAsync` is ever called, for both Demo and Live.
- **Live, not configured** (empty serverUrl or mk_): `SyncPointsAsync` returns `Success:false`,
  `PointsFailed = points.Count`, one `SyncPointOutcomeDto(code, "failed", false, "...not configured for
  Live...")` per point — NO HTTP attempt, NO exception. Verified: two tests assert the stub handler is
  NEVER invoked (`Assert.Null(h.LastRequest)`).
- **HTTP 404 on sync-points**: THROWS `KeyNotFoundException` — the one deliberate exception in this whole
  backend, matching `IConfigSyncBackend.SyncPointsAsync`'s own documented contract ("throws
  KeyNotFoundException if productModelCode isn't already known to the ecosystem") and
  `SimulatedEcosystem`'s identical behavior. `ConfigEndpoints` already catches this and maps it to a
  friendly HTTP 404 — so Demo and Live behave IDENTICALLY here without `ConfigSyncEngine` needing to know
  which backend answered.
- **Every other error** (401/403/409/429/500/503, network unreachable): friendly `Success:false` result,
  `FriendlyHttpError(status, body)` message on every point outcome — never a throw.
- **System A flag-off** (`CONFIG_SYNC_GENERIC_ENABLED` off → contract's documented HTTP 500
  non-retryable): `CheckRecipeAsync` returns `RecipeCheckResultDto(false, null, 0, null, "none")`;
  `GetRecipeAsync` returns `null` — both friendly "nothing resolved" states, never a throw. Verified by 2
  dedicated tests stubbing a 500 on each endpoint.

## What the push result exposes to the UI (C7)

`SyncPointsResultDto` (unchanged C2 DTO, reused verbatim) carries everything through to
`MachineConfigPushResultDto` exactly as before: `Success`, `PreviousVersion`/`NewVersion`,
`PointsCreated`/`Updated`/`Failed`, `StaleConflicts`, `BlindOverwrites`, `LimitChangesBlocked` (aggregate),
and per-point `SyncPointOutcomeDto{Code,Status,LimitBlocked,Message}` — for a Live push these are now
populated from the REAL server's response (`SyncPointsResponseWire` → `SyncPointsResultDto`), so a
`limitBlocked:true` from actual server-side threshold governance surfaces through `ConfigSyncEngine` →
`ConfigEndpoints` → the SAME `/v1/machines/{code}/config/push` response shape C7 will read regardless of
Demo/Live. Verified live-shape-wise by `SyncPointsAsync_surfaces_limitBlocked_and_governance_counts_from_response`
(stubbed `limitChangesBlocked:true`, per-point `limitBlocked:true` + message, `staleConflicts`,
`blindOverwrites` all correctly parsed through).

## Test evidence

`dotnet test tests/St4i.EngineApi.Tests` → **74/74 passed** (14 new `LiveConfigSyncTests` + 60
pre-existing, all still green). `dotnet test tests/St4i.EdgeCore.Tests` → **115/115 passed, unchanged**.
`dotnet build St4iMachineSimulator.sln` → clean (0 errors; pre-existing unrelated NU1701 .NET-Framework
package warnings only, from the WPF shell project).

New test coverage (`LiveConfigSyncTests.cs`, 14 tests):
`GetPointsAsync_builds_exact_url_and_query` (URL/query + full response mapping incl. enum casing),
`SyncPointsAsync_posts_full_point_shape_with_contract_casing_and_auth_header` (POST body field-by-field +
`"DIMENSION"`/`"circle"` casing + `expectedUpdatedAt` + X-API-Key header + null-omission),
`SyncPointsAsync_surfaces_limitBlocked_and_governance_counts_from_response`,
`CheckRecipeAsync_builds_config_sync_check_query`,
`GetRecipeAsync_with_HTTP_500_flag_off_returns_null_not_throw`,
`CheckRecipeAsync_with_HTTP_500_flag_off_returns_unresolved_not_throw`,
`CheckPointsVersionAsync_with_401_returns_empty_not_throw`,
`GetPointsAsync_with_404_returns_null_not_throw`,
`SyncPointsAsync_with_404_throws_KeyNotFoundException_matching_interface_contract`,
`SyncPointsAsync_with_no_mkKey_returns_friendly_not_configured_result_not_throw`,
`SyncPointsAsync_with_no_serverUrl_returns_friendly_not_configured_result_not_throw`,
`ConfigSyncCoordinator_Demo_mode_always_selects_SimulatedEcosystem`,
`ConfigSyncCoordinator_Live_mode_selects_Live_even_when_unconfigured`,
`ConfigSyncCoordinator_Auto_mode_selects_Live_when_configured_else_Demo`.

## Concerns / deferred (documented, not blocking)

- **sync-points response shape is a best-effort reconstruction**: the contract doc gives an explicit JSON
  block for check-points-version/get-points but only PROSE for sync-points' response ("Response includes
  per-point results, limitBlocked (per point), aggregate limitChangesBlocked, staleConflicts,
  blindOverwrites, pointsCreated/Updated/Failed, new version"). `SyncPointsResponseWire`'s field names were
  chosen to match C2's own `SyncPointsResultDto` (itself built "per the contract"), which is the best
  available cross-reference — a real-server smoke test would be the way to confirm/adjust field names,
  same caveat C2's own report flags for its Demo response shape.
- **`observedFiducials`** (contract's sync-points body, optional) is not modeled — C2's
  `SyncPointsRequestDto` doesn't carry it either; this engine never populates it. Not a regression, just an
  unexercised optional field.
- **Recipe `machineType` resolution**: the real contract's `config-sync/check` has no `machineType` query
  param at all — the server resolves `resolvedBy:"machineType"` from the calling machine's own identity.
  `IConfigSyncBackend.CheckRecipeAsync`'s `machineType` parameter is accepted (interface parity with
  `SimulatedEcosystem`, which DOES use it locally) but intentionally unused by the Live implementation.
- **One machine identity per process, not per simulated machine**: `LiveConfigSyncBackend`, like
  `LiveTransport`, is bound to ONE serverUrl+mk_+machineCode at a time (the engine's own Settings identity,
  `FleetHost._machineCode`/`_serverUrl`) — matches the existing architecture exactly (the whole simulated
  fleet already shares one `LiveTransport`/one mk_, individual readings carry their own `machineCode` in
  the envelope). A Live push still correctly identifies WHICH simulated machine pushed via
  `SyncPointsRequestDto.MachineCode` (set by `ConfigSyncEngine.PushPointsAsync` from the real
  `MachineDescriptor.Code`), independent of the bound identity's own machineCode used for GET query params.
- **`DeltaSyncPointsAsync`** has no `/v1` endpoint wiring it up yet (C2's own scoping, unchanged) — its
  error handling degrades to `HasChanges:false` on any failure rather than throwing on an unknown product
  (unlike `SimulatedEcosystem`, which throws) since it's currently dead code from `ConfigSyncEngine`'s
  perspective; noted for whoever wires a real caller to it later.
- Nothing web-facing was touched (C4-C7 remain the web tasks) — `Program.cs`/`FleetHost.cs` changes are
  additive-only (new optional ctor param, two new coordinator forwarding calls) and don't change any
  existing `/v1` response shape.
