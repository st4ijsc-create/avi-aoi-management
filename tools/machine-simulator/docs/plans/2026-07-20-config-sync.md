# Config-Sync (Product Measurement Points / Spec / Recipe / Images) Implementation Plan

**Goal:** Give the ST4I Machine Simulator a real, versioned, **two-way** product-config sync with the ecosystem — AOI/AVI measurement points + spec + sample images (System B, true 2-way), plus automation recipe / IoT device_settings (System A, pull-down), authored in the simulator and synced up/down per machine.

**Architecture:** EdgeCore gains a product-config domain model + local JSON store. A `ConfigSyncEngine` has two backends: **Demo** = an in-process simulated ecosystem (full 2-way, versioned, diff, conflict + governance simulation) so it works offline; **Live** = real REST calls to the server's System B + A endpoints (see `docs/CONFIG_SYNC_SERVER_CONTRACT.md`) via the machine `mk_` key. The web app gets a Product-Config authoring workspace (products, points editor with an image-overlay canvas, recipe editor) and a per-machine sync panel (pull/push with confirm, version, diff, conflict/governance surface, image thumbnails, sync history).

**Tech Stack:** C# net10 (EdgeCore, EngineApi) · React 19 / Vite / Tailwind 4 / shadcn / Recharts / react-query / wouter · xUnit · Playwright + axe.

## Global Constraints
- Worktree `D:/SOURCES/avi-aoi-sim` branch `feat/machine-simulator`; commit via `git -C D:/SOURCES/avi-aoi-sim`. NEVER touch the main tree or run git branch/checkout/switch.
- Match the server contract EXACTLY (`tools/machine-simulator/docs/CONFIG_SYNC_SERVER_CONTRACT.md`) — Live wire shapes must be byte-compatible so a real server accepts them.
- Design system: white dominant / navy secondary, **tokens only (no loose hex)**, light + dark via `data-theme`. i18n vi/en, **default vi**, parity compile-enforced (`en: typeof vi`). axe AA (no serious/critical) light + dark. Motion respects reduced-motion.
- Modes: **Demo** (default, offline) = simulated ecosystem, full 2-way. **Live** = real server; **push to real server requires an explicit confirm step** and surfaces governance results (limitBlocked). **Auto** = Live if a server+key are configured else Demo.
- Depth: FULL — points carry the complete spec set (2D limits + tolerance + 3D/solder/xray + geometry/shape + criteria + lighting + per-point image), plus fiducials, variants, delta-sync tombstones, recipe (System A).
- Don't commit node_modules/dist/bin/obj/publish/screenshots. Keep EngineApi serving the built UI (same-origin) working. Reuse existing primitives + patterns.

---

### Task C1: EdgeCore product-config domain model + local store + versioning
**Files:** Create `src/St4i.EdgeCore/Config/{ProductModel,MeasurementPoint,Fiducial,LightingShot,ProductVariant,VariantPointOverride,Recipe,ConfigChecksum}.cs`, `src/St4i.EdgeCore/Config/ProductConfigStore.cs`; Test `tests/St4i.EdgeCore.Tests/ProductConfigTests.cs`.
**Interfaces produced:** `ProductModel{Code,Name,LifecycleStatus,ReferenceImageUrl,ImageWidth,ImageHeight,CoordinateMode,PointsConfigVersion,Fiducials[],Variants[],Points[]}`; `MeasurementPoint{Code,Name,Description,MeasurementType,MeasurementTypeCode,Unit,LowerLimit,UpperLimit,NominalValue,ToleranceMode,TolPlus,TolMinus,PositionX,PositionY,Radius,NormalizedX,NormalizedY,NormalizedRadius,CropWidth,CropHeight,OrderIndex,IsActive,Shape,Geometry,PositionZ,HeightMin/Max/Nominal,AreaMin/Max,VolumeMin/Max,CoplanarityMax,WarpageMax,VoidPctMax,OffsetXMax,OffsetYMax,TiltMax,ThicknessMin/Max,Criteria,Lighting[],LastModifiedAt,ReferenceImageUrl,DeletedAt,DeletedAtVersion}`; `Recipe{Code,Name,MachineType,Version,Payload(dict),Checksum,Status}`.
- Model classes mirror `CONFIG_SYNC_SERVER_CONTRACT.md` <POINT>/recipe shapes (nullable where server is optional). `ConfigChecksum.Compute(payload)` = sha256 of a stable-stringified JSON (match server's `stableStringify` semantics: sorted keys). Version = int; a `BumpVersion()` helper.
- `ProductConfigStore`: load/save product configs + recipes as JSON under a configurable dir (default beside `fleet.json`); seed 2-3 realistic demo products (an AOI board model with ~6-10 points incl. limits+positions+per-point image path, an automation recipe with torque/speed payload). Thread-safe (lock) CRUD; soft-delete points (tombstone). Reuse `MachineDescriptor`/existing JSON conventions.
- Tests: round-trip serialize/deserialize a full product (all spec fields survive); checksum stable + order-independent; version bump; soft-delete produces a tombstone; seed loads.

### Task C2: Demo simulated-ecosystem sync engine + Engine endpoints
**Files:** Create `src/St4i.EngineApi/Config/SimulatedEcosystem.cs`, `src/St4i.EngineApi/Config/ConfigSyncEngine.cs` (Demo backend here; Live added C3), `src/St4i.EngineApi/Endpoints/ConfigEndpoints.cs`, DTOs in `Fleet/Dtos.cs` (or `Config/ConfigDtos.cs`); Test `tests/St4i.EngineApi.Tests/ConfigSyncEngineTests.cs`.
**Interfaces produced (Engine REST, all under /v1):** `GET /v1/products` (list local product configs + versions), `GET /v1/products/{code}`, `POST/PUT /v1/products/{code}` (author), `DELETE`, points CRUD under `/v1/products/{code}/points`; recipes `GET/PUT /v1/recipes/{code}`; per-machine sync: `GET /v1/machines/{code}/config/check` (versions vs ecosystem), `POST /v1/machines/{code}/config/pull` (ecosystem→machine: get-points/recipe, apply, return applied+diff), `POST /v1/machines/{code}/config/push` (machine→ecosystem, body `{productCode,confirm:true}`), `GET /v1/machines/{code}/config/diff?productCode=` (local vs ecosystem field-level diff), `GET /v1/machines/{code}/config/history`.
- `SimulatedEcosystem`: an in-memory (persisted JSON) mirror of the server for Demo — holds product configs + recipes + versions; implements check/getPoints/syncPoints(bump+lww+optimistic-lock sim + threshold-governance sim: block limit edits on non-development products, return `limitBlocked`)/getImage/syncImage/deltaSync(tombstones)/recipe check+get. Seed it slightly DIVERGED from the local store so the first diff/sync is non-trivial (demoable).
- `ConfigSyncEngine` (Demo): routes pull/push/check/diff to `SimulatedEcosystem`; computes a **field-level diff** (added/removed/changed points + changed spec fields + version delta) for the UI; records history entries (op, status, counts, fromVersion→toVersion).
- Endpoints map 1:1 to engine methods; friendly errors, never 500 on expected states.
- Tests: author a product → push to sim-ecosystem bumps version; pull applies; diff detects a changed limit + added/removed point; governance blocks a limit edit on an `active` product (limitBlocked) but allows geometry; optimistic-lock stale write → conflict; delta tombstone removes a point.

### Task C3: Live backend — real System B + A REST wiring (guarded push)
**Files:** `src/St4i.EdgeCore/Transport/` add a `ProductConfigClient.cs` (raw HttpClient, mk_ auth) OR extend `LiveTransport`; wire into `ConfigSyncEngine` Live branch; Test `tests/St4i.EngineApi.Tests/LiveConfigSyncTests.cs` (request-shaping via stub handler).
- Implement Live calls per `CONFIG_SYNC_SERVER_CONTRACT.md`: pull = `check-points-version`/`get-points`/`delta-sync-points`/`product-image`/`point-image`; push = `sync-points` (+ `sync-product-image`/`sync-point-image`), sending the full point shape incl. limits/geometry/image (base64 or url) + `expectedUpdatedAt`; recipe = `config-sync/check|get|ack` (handle HTTP 500 flag-off as a friendly "generic config-sync disabled on server" state, not a crash). Auth via the machine's stored `mk_` (CredentialStore) + server URL from settings.
- **Guarded push**: Live push requires `confirm:true`; surface the server's `limitBlocked`/`limitChangesBlocked`/`staleConflicts`/`blindOverwrites`/counts in the result. Map server error codes (401/403/404/409/429/500/503) to friendly results.
- `ConfigSyncEngine` selects Demo vs Live from the current mode (like the transport). Auto = Live if server+key present.
- Tests: stub HttpMessageHandler asserts the exact URLs + JSON bodies for get-points/sync-points/config-sync; a 500 flag-off maps to the disabled state; a limitBlocked response surfaces correctly.

### Task C4 (web): Product-Config workspace — product list + editor
**Files:** `web/src/routes/ProductConfig.tsx` (list), `web/src/routes/ProductConfigDetail.tsx` (edit one product), api hooks in `web/src/lib/configApi.ts`, nav in `shell/Shell.tsx` + `Sidebar` + i18n. 
- New sidebar entry **"Cấu hình sản phẩm"**. List products (code, name, lifecycle, #points, version, thumbnail). Create/edit a product: name, lifecycleStatus, reference image (path/URL or upload→base64), coordinateMode, imageWidth/Height. Version shown; edits bump a local dirty/version indicator.
- i18n vi/en, tokens, dark, axe; loading/empty states; react-query.

### Task C5 (web): Measurement-point editor + image-overlay canvas
**Files:** `web/src/components/PointsEditor.tsx`, `web/src/components/BoardCanvas.tsx` (reference image + point markers positioned by normalizedX/Y, click to select/add), point detail form; extend ProductConfigDetail.
- Table of points + a **canvas overlay**: render the product reference image with each point drawn at its normalized position (reuse the AOI board-bbox idea from MachineDetail). Select a point → edit full spec form (type, unit, nominal, LSL/USL, tolerance mode, 3D/solder fields shown per measurementType, shape/geometry, per-point image, lighting shots, orderIndex, isActive). Add/remove points (soft-delete). Fiducials + variants editable (basic).
- Keep the form manageable: group advanced (3D/solder/xray/lighting) in collapsible sections. i18n, tokens, dark, axe.

### Task C6 (web): Recipe editor (System A) for automation/IoT
**Files:** `web/src/routes/RecipeConfig.tsx` or a tab in ProductConfig; api hooks.
- Author a recipe payload (key-value + typed fields e.g. speedRpm/torqueTarget/torqueTolerance for SCREWDRIVE; device_settings for IoT), version + checksum shown. Note in UI that recipe push-to-ecosystem is Demo-only (server is pull-only) — pull works in Live. i18n/tokens/dark/axe.

### Task C7 (web): Per-machine config-sync panel (replace the stub)
**Files:** rewrite `web/src/components/ConfigSyncPanel.tsx`; wire into `routes/MachineDetail.tsx` "Cấu hình" tab; api hooks.
- For the machine's product(s): show local version vs ecosystem version + drift; **Pull** (ecosystem→machine, apply, toast) and **Push** (machine→ecosystem) with a **confirm dialog** (Live) showing what will change; a **diff view** (added/removed/changed points, changed spec fields, image changes) before applying; surface governance (limitBlocked) + conflicts; image thumbnails (before/after); sync history list. Recipe machines show recipe check/pull. Demo vs Live indicator.
- i18n/tokens/dark/axe; empty/loading/error states.

### Task C8: i18n sweep + Playwright + axe + rebuild .exe + review
- Full i18n vi/en parity for all new strings; motion polish; empty/skeleton/toast consistency.
- Playwright E2E: author a product+points (Demo) → push to sim-ecosystem (version bumps) → edit a limit → diff shows it → pull applies; governance-blocked limit on an active product surfaces; recipe pull. Visual baselines (light+dark) for the new screens; axe AA both themes. Update `tests/support/screens.ts` + visual sweep.
- Rebuild the standalone desktop `.exe` (npm build → publish engine → publish shell) and smoke it. Whole-branch review of the config-sync commits; fix Critical/Important.
