# ST4I Server Config-Sync Contract (reference for the simulator)

Verified from `D:/SOURCES/avi-aoi-management/server` (2026-07-20). The simulator's Live mode must match these exact shapes. All machine endpoints authenticate with the machine key (`mk_`), header `X-API-Key` (or `Authorization: Bearer`), or `?apiKey=`.

## System A — Generic config-sync (recipe / device_settings) — PULL-ONLY, flag-gated
Endpoints (REST proxies, plain JSON, NOT the `{ok,data,error}` v1 envelope):
- `GET /api/machine/config-sync/check?configKind=recipe|device_settings|points|model&machineCode=&configCode=&productModelCode=&variantCode=`
  → recipe/device_settings: `{success, configKind, code, version:"<int>", checksum:"<sha256>", resolvedBy:"machine|machineType|none"}`
  → points: `{success, configKind:"points", productModels:[{productModelCode, pointsConfigVersion:int, imageWidth, imageHeight}]}` (alias of check-points-version; version only)
- `GET /api/machine/config-sync/get?...` → for recipe/device_settings adds full `payload` (jsonb, e.g. `{speedRpm,angleTarget,torqueTarget,torqueTolerance}`). For `points` returns ONLY the version stub (no payload — must use System B get-points).
- `POST /api/machine/config-sync/ack {configKind, machineCode|apiKey, code?, version?, checksum?}` → `{success, machineId, configKind, driftState:"in_sync|drift|unknown"}` (writes drift-shadow only, never real config).
- **Gated**: `CONFIG_SYNC_GENERIC_ENABLED` default OFF → the check/get/ack return **HTTP 500 non-retryable** when off. Machines CANNOT author recipes (human-authored in SYNAPSE UI, 2-person approve). So recipe direction = pull-only; machine→ecosystem for recipe is Demo-simulated only.
- `version` = incrementing integer (string-serialized); `checksum` = sha256(stableStringify(payload)) is the authoritative drift key.
- MQTT notify (optional wake-up): topic `synapse/v1/machine/{machineCode}/config/{configKind}`, payload `{type:CONFIG_CHANGED,machineCode,configKind,code,version,checksum,timestamp}` — descriptor only, machine still pulls body.

## System B — AOI/AVI points + spec + images — TRUE 2-WAY, always live
### Pull down
- `GET /api/machine/check-points-version?machineCode=&apiKey=&productModelCode=` → `{success, productModels:[{productModelCode, pointsConfigVersion:int, imageWidth, imageHeight}]}`
- `GET /api/machine/get-points?machineCode=&apiKey=&productModelCode=&variantCode=` → `{success, machineId, machineCode, productModels:[{productModelId, productModelCode, productModelName, referenceImageUrl, imageWidth, imageHeight, pointsConfigVersion, coordinateMode:"pixel|mm", fiducials:[{id,code,name,type,positionX,positionY,normalizedX,normalizedY,searchWindowW,searchWindowH,templateImageUrl,orderIndex}], totalPoints, points:[<POINT>]}]}`
- `GET /api/machine/delta-sync-points?...&sinceVersion=int` → if currentVersion<=sinceVersion: `{hasChanges:false, points:[], deletedCodes:[], deletedPoints:[]}` else full diff + tombstones `deletedCodes:string[]`, `deletedPoints:[{id,code,deletedAt,deletedAtVersion}]`.
- `GET /api/machine/product-image?...&productModelCode=` and `GET /api/machine/point-image?...&pointCode=` → `{...,imageUrl}` (imageUrl = base64 data-URL if stored local, else absolute URL).

### Push up (machine→ecosystem, REAL write)
- `POST /api/machine/sync-points {machineCode?,apiKey?,productModelCode, sourceImageWidth?,sourceImageHeight?, clientVersion?, variantCode?, observedFiducials?:[{code,observedX,observedY}], points:[{code,name,description?,measurementType,unit?, lowerLimit?,upperLimit?,nominalValue?, positionX,positionY,radius?,normalizedX?,normalizedY?,normalizedRadius?, cropWidth?,cropHeight?,orderIndex?,workstationCode?,isActive?, imageBase64?,imageMimeType?,imageUrl?, shape?,geometry?, expectedUpdatedAt?}]}`
  → upserts by (productModelId, code); bumps `pointsConfigVersion` atomically; MQTT-notifies. Response includes per-point results, `limitBlocked` (per point), aggregate `limitChangesBlocked`, `staleConflicts`, `blindOverwrites`, `pointsCreated/Updated/Failed`, new version.
- `POST /api/machine/sync-product-image {productModelCode, imageBase64?|imageUrl?, imageMimeType?, imageWidth?, imageHeight?}` → updates product referenceImage, dedup by sha256.
- `POST /api/machine/sync-point-image {productModelCode, pointCode, imageBase64?|imageUrl?}` → updates one point's image (never limit-gated).
- `GET /api/machine/sync-history?...` → `sync_logs` (POINTS_PUSH|POINTS_PULL|IMAGE_PUSH|IMAGE_PULL|FULL_SYNC|DELTA_SYNC, SUCCESS|PARTIAL|FAILED, counts, fromVersion/toVersion, durationMs).

### Conflict / governance (push)
- Default **last-write-wins**; opt-in per-point optimistic lock via `expectedUpdatedAt` + server flag `MACHINE_SYNC_OPTIMISTIC_LOCK` (default OFF) → stale write → per-point `CONFLICT`/`MP_STALE_WRITE`, counted in `staleConflicts`, that point not overwritten (rest apply). Blind stale writes (flag off) still apply but audited (`blindOverwrites`).
- **Threshold governance**: if a push changes `lowerLimit`/`upperLimit`/`nominalValue` on an EXISTING point of a product NOT in `development` lifecycle (or `development` with a released inspection program), the limit fields are STRIPPED (geometry/image/name still sync), response per-point `limitBlocked:true`, aggregate `limitChangesBlocked`. Bypass: `THRESHOLD_GATE_ENFORCED=false`.

## <POINT> full shape (from get-points, per measurement_point_defs)
`{id, code, name, description, measurementType(DIMENSION|VISUAL|ELECTRICAL|POSITION|COLOR|SURFACE|OTHER), measurementTypeCode, unit, lowerLimit, upperLimit, nominalValue, toleranceMode(min_only|max_only|range|bilateral), tolPlus, tolMinus, positionX, positionY, radius, normalizedX, normalizedY, normalizedRadius, cropWidth, cropHeight, orderIndex, isActive, shape(circle|rect|polygon|line|ring|mask|array), geometry(jsonb per shape), positionZ, heightMin/Max/Nominal/Unit, areaMin/Max/Nominal/Unit, volumeMin/Max/Nominal/Unit, coplanarityMax, warpageMax, voidPctMax, offsetXMax, offsetYMax, tiltMax, thicknessMin/Max, criteria(jsonb), lighting:[{shotIndex,name,lightSource,color,colorHex,intensityPct,angleDeg,exposureUs,gain,focusOffsetUm,opticalFilter,purpose}], cells(if shape=array), lastModifiedAt, referenceImageUrl, workstationId}`

## Data model (server tables, for reference)
- `product_models`: code(unique), name, lifecycleStatus(development|active|eol|archived), referenceImageUrl/Key, imageWidth/Height, coordinateMode(pixel|mm), pointsConfigVersion(int, atomic bump `col=col+1`), imageHash.
- `measurement_point_defs`: full spec above; unique (productModelId, COALESCE(variantId,0), code) WHERE deletedAt IS NULL; soft-delete via deletedAt/deletedAtVersion.
- `measurement_point_versions`: snapshot per edit (version, snapshotJson, changedBy, changeReason, productPointsConfigVersion).
- `product_variants`: code('BASE' base), isBase, pointsConfigVersion (mirrors base), referenceImage override, coordinateMode override.
- `variant_point_overrides`: variantId, basePointDefId, action(exclude|override), patchJson.
- `fiducial_marks`, `mp_lighting_profiles`, `sync_logs`.
- `machine_recipes` (System A): code, name, machineType, version(int), payload(jsonb), checksum, status(draft|active|archived), unique(code,version) + unique-partial(code) WHERE active.
- Images: `STORAGE_MODE=local` → `./uploads/...` served at `/uploads/`; base64/data-URL decoded + stored; reads normalized to data-URL for external machines. Dedup by sha256 imageHash.

## Simulator mapping
- Points/spec/images ↔ AOI/AVI machines (deviceClass AoiAvi). Recipe ↔ Automation machines. device_settings ↔ IoT.
- Simulator sends the machine `mk_` key (from onboarding/CredentialStore) for Live.
