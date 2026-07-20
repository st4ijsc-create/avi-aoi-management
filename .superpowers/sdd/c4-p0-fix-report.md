# C4 P0 fix — config-sync REQUEST bodies deserialize with `ConfigJson.Options`

## Bug

`ConfigEndpoints`' response side was already fixed under Task C2 (`Results.Json(value, ConfigJson.Options)`
everywhere a response can carry an `St4i.EdgeCore.Config` enum). The REQUEST side was the untreated twin:
every body-bound handler bound its DTO (`ProductModel` / `MeasurementPoint` / `Recipe` /
`ConfigPushRequest` / `ConfigPullRequest`) as a direct minimal-API parameter, e.g.
`(string code, ProductModel body, ProductConfigStore store)`. Minimal API's implicit `[FromBody]`
binding uses the DI-configured GLOBAL `JsonSerializerOptions` (`Program.cs`'s
`ConfigureHttpJsonOptions` registers a plain `JsonStringEnumConverter()`, PascalCase member names, no
naming policy) — NOT `ConfigJson.Options`. Per System.Text.Json's converter-selection precedence (a
converter registered in `JsonSerializerOptions.Converters` outranks a TYPE-level `[JsonConverter]`
attribute), that global registration silently outranked every `St4i.EdgeCore.Config` enum's own
`SnakeLowerEnumConverter`/`SnakeUpperEnumConverter` attribute. A request body written in the server's
actual wire casing (`toleranceMode:"min_only"`, `measurementType:"DIMENSION"`, ...) failed to
deserialize — blocking the seed products (MODEL-A/MODEL-B) and any other config save that used those
casings, which is every real client.

## Fix

`tools/machine-simulator/src/St4i.EngineApi/Endpoints/ConfigEndpoints.cs`:

- Every body-bound handler (`POST`/`PUT /v1/products/{code}`, `POST`/`PUT /v1/products/{code}/points/{pointCode}`,
  `PUT /v1/recipes/{code}`, `POST /v1/machines/{code}/config/pull`, `POST /v1/machines/{code}/config/push`)
  no longer binds its DTO as a direct parameter. Each is now a named `internal static` handler
  (`UpsertProductAsync`, `UpsertPointAsync`, `UpsertRecipeAsync`, `PullConfigAsync`, `PushConfigAsync`)
  that takes `HttpContext context` and reads the body explicitly via a new shared helper,
  `ReadBodyAsync<T>(context, required, ct)`, which calls
  `context.Request.ReadFromJsonAsync<T>(ConfigJson.Options, ct)`. Symmetry restored: request in =
  response out = `ConfigJson.Options`.
- `required: true` for product/point/recipe/push (matches the old non-nullable-parameter contract — a
  missing body is a 400 "Request body is required."); `required: false` for pull (matches the old
  `ConfigPullRequest?` — a missing body is a legitimate no-op, `productCode` stays null).
- `ReadBodyAsync` catches `JsonException` (malformed JSON syntax) AND `InvalidOperationException`
  (the real, non-hypothetical OTHER failure mode — `ReadFromJsonAsync` throws this, not a
  `JsonException`, when the request has a body but no recognized JSON `Content-Type`, e.g. a client
  that sent the right bytes with the wrong/missing header) AND `NotSupportedException` defensively —
  all three map to a friendly `400 {"error":"Malformed JSON request body."}`, never an unhandled
  exception. Zero/absent `Content-Length` is checked BEFORE attempting to read at all, so it never even
  has to round-trip through `ReadFromJsonAsync` to get an ambiguous empty-stream exception back.
- Handlers were converted from inline lambdas to named methods (not just to route through the shared
  helper cleanly, but) so `St4i.EngineApi.Tests` can call them directly against a hand-built
  `DefaultHttpContext` carrying a raw JSON byte body — exercising the EXACT same code path a real HTTP
  request would, with no `WebApplicationFactory`/`TestServer` needed. This relies on `internal` +
  `St4i.EngineApi`'s existing `AssemblyInfo.cs` `[InternalsVisibleTo("St4i.EngineApi.Tests")]` (already
  used for exactly this purpose elsewhere in the codebase — see `FleetHost.DriverDecoratorForTests`).
- Global `JsonOptions` in `Program.cs` — untouched, as instructed (every other endpoint family keeps its
  plain PascalCase enum wire format on purpose).

## Tests

New file: `tools/machine-simulator/tests/St4i.EngineApi.Tests/ConfigEndpointsRequestBodyTests.cs` — 36
tests, all calling the `internal static` handler methods directly with a `DefaultHttpContext` whose
`Request.Body`/`ContentType`/`ContentLength` are set exactly like a real client's HTTP request:

- Product PUT with `toleranceMode:"min_only"`/`"max_only"` → 200, persisted values match (checked via
  both the handler's own JSON response AND a direct `store.GetProduct` re-read, standing in for GET).
  Theory over all 4 `ProductLifecycleStatus` wire values.
- Full-spec point (measurementType `DIMENSION`, shape `circle`, tolerance `range`, 3D/height fields,
  criteria, lighting) created via `POST`, then updated via `PUT` to `toleranceMode:"bilateral"` +
  `shape:"polygon"` — both persist correctly. Theory sweeps over all 4 `ToleranceMode`, all 7
  `PointShape`, and all 7 `MeasurementType` wire values.
- Recipe `PUT` with `status:"active"` round-trips; theory over all 3 `RecipeStatus` wire values.
- Malformed JSON body on product/point/recipe/push upserts → 400 `{"error":"..."}`, never a 500.
- Empty body on a required endpoint → friendly 400 ("Request body is required").
- **Regression test for the `InvalidOperationException` edge case found while hardening the fix**: valid
  JSON bytes with a missing/wrong `Content-Type` → 400, not an unhandled exception (this is the case a
  catch that only handled `JsonException` would have missed).
- `body.code` mismatch still 400 (pre-existing validation, unaffected by the read-path change).
- Pull with literally no body sent → treated as a valid omission (not an error) for a non-AOI/AVI
  machine (recipe-pull path).

## Verify

- `dotnet build` (whole solution): 0 errors (pre-existing warnings only, all in
  `examples/device-client/csharp/St4iDeviceClient.cs` and `LiveTransport.cs`, unrelated to this change).
- `dotnet test tests/St4i.EngineApi.Tests`: **110/110 passed** (36 new + 74 pre-existing).
- `dotnet test tests/St4i.EdgeCore.Tests`: **115/115 passed** (unaffected — this fix touches only
  `St4i.EngineApi`).

### Live curl evidence

Backed up the real `products.json`/`recipes.json` next to the built exe before touching them, restored
byte-identical afterward (`diff` confirmed).

```
$ curl -s http://localhost:5199/v1/products/MODEL-A | jq -c '.pointsConfigVersion, [.points[].toleranceMode]'
6
["range","null","max_only","null","bilateral","max_only","max_only","null","null"]

# Edited P01's toleranceMode to "min_only" in the captured body, PUT it back as-is:
$ curl -s -o resp.json -w 'HTTP %{http_code}\n' -X PUT -H 'Content-Type: application/json' \
    --data-binary @model-a-put-body.json http://localhost:5199/v1/products/MODEL-A
HTTP 200
$ jq -r '.points[] | select(.code=="P01") | .toleranceMode' resp.json
min_only

$ curl -s http://localhost:5199/v1/products/MODEL-A > after.json
$ diff <(jq -S . resp.json) <(jq -S . after.json)   # (no output — byte-identical)
$ jq -r '.points[] | select(.code=="P01") | .toleranceMode' after.json
min_only

# Malformed body:
$ curl -s -o /dev/null -w 'HTTP %{http_code}\n' -X PUT -H 'Content-Type: application/json' \
    --data-binary '{ this is not valid json' http://localhost:5199/v1/products/MODEL-A
HTTP 400
$ cat resp.json   # {"error":"Malformed JSON request body."}

# Seed integrity after the malformed attempt:
$ curl -s -o /dev/null -w 'MODEL-B: HTTP %{http_code}\n' http://localhost:5199/v1/products/MODEL-B
MODEL-B: HTTP 200
```

(Actual commands run used Node one-liners instead of `jq`, which isn't installed in this shell — same
assertions, see the session transcript. Results identical to the above.)

## Concerns / follow-ups

- None blocking. The `internal` visibility bump on the five handler methods is a small API-surface
  widening scoped to `ConfigEndpoints` only, already covered by the pre-existing
  `InternalsVisibleTo("St4i.EngineApi.Tests")`.
- `ConfigPullRequest`/`ConfigPushRequest` carry no enums today, so they weren't part of the actual P0
  symptom — they were switched to the same `ReadBodyAsync` path anyway for consistency/symmetry and got
  light regression coverage (empty-body-is-ok / malformed-body-is-400), per the task's "any other
  endpoint under ConfigEndpoints" instruction.
