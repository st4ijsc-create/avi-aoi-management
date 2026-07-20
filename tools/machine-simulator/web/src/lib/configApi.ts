/**
 * Task C4 — typed EngineApi client + TanStack Query hooks for the product-config domain
 * (products/points/recipes authoring + per-machine sync), mirroring `lib/api.ts`'s own
 * BASE_URL/same-origin resolution, `EngineApiError`, and query-invalidation conventions so this file
 * reads as a natural sibling rather than a parallel dialect.
 *
 * Wire shapes mirror `St4i.EngineApi.Config.ConfigDtos` / `St4i.EdgeCore.Config.*` EXACTLY (see
 * `Config/ConfigDtos.cs`, `Config/ProductModel.cs`, `Config/MeasurementPoint.cs`, and siblings) —
 * confirmed live against the running Demo engine (`GET /v1/products/{code}` round-tripped a full
 * `ProductModel` with this exact camelCase shape + `snake_lower`/`SNAKE_UPPER` enum strings; a `PUT`
 * with lower-case enum values round-tripped cleanly too — see `ConfigJson.cs`'s doc comment for why
 * responses need that dedicated options instance).
 *
 * Two families of hooks:
 *  1. Authoring (products/points/recipes CRUD, `/v1/products`·`/v1/recipes`) — Task C4 (this task)
 *     builds and fully wires the PRODUCT hooks into `routes/ProductConfig*.tsx`. The POINT/RECIPE
 *     hooks below are complete, real implementations (not fakes) against the already-live C2/C3
 *     endpoints, so Tasks C5/C6 can consume them directly instead of rewriting this layer.
 *  2. Per-machine sync (`/v1/machines/{code}/config/*`) — Task C7's seam. Also complete real
 *     implementations against the live engine, ready for C7 to build its pull/push/diff/history UI
 *     on top of.
 *
 * IMPORTANT — product PUT is a WHOLE-AGGREGATE overwrite, not a patch: `ProductConfigStore.UpsertProduct`
 * replaces the entire stored `ProductModel` (fiducials/variants/points included) with whatever body is
 * sent. `useSaveProduct` below must always be called with the full previously-loaded product spread
 * under the edited fields — see `ProductConfigDetail.tsx`'s `handleSave` for the call site that keeps
 * this invariant. Live-verified: editing just `name` on MODEL-A while omitting `points` from the body
 * zeroes its 9 points out; including the loaded `points` array back in the body preserves them.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query"

import { EngineApiError } from "./api"

const BASE_URL =
  (import.meta.env.VITE_ENGINE_URL as string | undefined) ?? (import.meta.env.DEV ? "http://localhost:5199" : "")

// ─────────────────────────────────────────────────────────────────────────
// Enum wire vocabularies — string literal unions, not TS enums (matches lib/api.ts's own
// DeviceClass/DriverKind/TransportMode style). Casing mirrors each C# enum's own
// SnakeLowerEnumConverter/SnakeUpperEnumConverter (ConfigJsonConverters.cs) exactly.
// ─────────────────────────────────────────────────────────────────────────

export type ProductLifecycleStatus = "development" | "active" | "eol" | "archived"
export type CoordinateMode = "pixel" | "mm"
export type MeasurementType = "DIMENSION" | "VISUAL" | "ELECTRICAL" | "POSITION" | "COLOR" | "SURFACE" | "OTHER"
export type ToleranceMode = "min_only" | "max_only" | "range" | "bilateral"
export type PointShape = "circle" | "rect" | "polygon" | "line" | "ring" | "mask" | "array"
export type RecipeStatus = "draft" | "active" | "archived"
export type VariantOverrideAction = "exclude" | "override"

// ─────────────────────────────────────────────────────────────────────────
// Authoring domain types — 1:1 with St4i.EdgeCore.Config's ProductModel/MeasurementPoint/Fiducial/
// ProductVariant/VariantPointOverride/LightingShot/Recipe. `JsonElement?` fields (arbitrary jsonb on
// the server) come through as `unknown` here — Geometry/Cells/Criteria/PatchJson.
// ─────────────────────────────────────────────────────────────────────────

export interface LightingShot {
  shotIndex: number
  name?: string | null
  lightSource?: string | null
  color?: string | null
  colorHex?: string | null
  intensityPct?: number | null
  angleDeg?: number | null
  exposureUs?: number | null
  gain?: number | null
  focusOffsetUm?: number | null
  opticalFilter?: string | null
  purpose?: string | null
}

export interface MeasurementPoint {
  code: string
  name: string
  description?: string | null

  measurementType: MeasurementType
  measurementTypeCode?: string | null
  unit?: string | null

  lowerLimit?: number | null
  upperLimit?: number | null
  nominalValue?: number | null
  toleranceMode?: ToleranceMode | null
  tolPlus?: number | null
  tolMinus?: number | null

  positionX: number
  positionY: number
  radius?: number | null
  normalizedX?: number | null
  normalizedY?: number | null
  normalizedRadius?: number | null

  cropWidth?: number | null
  cropHeight?: number | null
  orderIndex: number
  isActive: boolean

  shape: PointShape
  geometry?: unknown
  cells?: unknown

  positionZ?: number | null
  heightMin?: number | null
  heightMax?: number | null
  heightNominal?: number | null
  heightUnit?: string | null
  areaMin?: number | null
  areaMax?: number | null
  areaNominal?: number | null
  areaUnit?: string | null
  volumeMin?: number | null
  volumeMax?: number | null
  volumeNominal?: number | null
  volumeUnit?: string | null
  coplanarityMax?: number | null
  warpageMax?: number | null
  voidPctMax?: number | null
  offsetXMax?: number | null
  offsetYMax?: number | null
  tiltMax?: number | null
  thicknessMin?: number | null
  thicknessMax?: number | null
  criteria?: unknown

  lighting: LightingShot[]

  lastModifiedAt?: string | null
  referenceImageUrl?: string | null

  deletedAt?: string | null
  deletedAtVersion?: number | null
}

export interface Fiducial {
  code: string
  name?: string | null
  type?: string | null
  positionX: number
  positionY: number
  normalizedX?: number | null
  normalizedY?: number | null
  searchWindowW?: number | null
  searchWindowH?: number | null
  templateImageUrl?: string | null
  orderIndex: number
}

export interface VariantPointOverride {
  basePointCode: string
  action: VariantOverrideAction
  patchJson?: unknown
}

export interface ProductVariant {
  code: string
  name?: string | null
  isBase: boolean
  pointsConfigVersion: number
  referenceImageUrl?: string | null
  coordinateMode?: CoordinateMode | null
  overrides: VariantPointOverride[]
}

/** Full points-config aggregate — `GET/PUT /v1/products/{code}`'s body. See this file's header
 * comment: a `PUT` replaces `fiducials`/`variants`/`points` wholesale, so a save that only intends to
 * edit product-level fields must still round-trip these arrays unchanged. */
export interface ProductModel {
  code: string
  name: string
  lifecycleStatus: ProductLifecycleStatus
  referenceImageUrl?: string | null
  imageWidth?: number | null
  imageHeight?: number | null
  imageHash?: string | null
  coordinateMode: CoordinateMode
  pointsConfigVersion: number
  fiducials: Fiducial[]
  variants: ProductVariant[]
  points: MeasurementPoint[]
}

/** `GET /v1/products` row — lighter than the full aggregate (`ProductSummaryDto.From`). */
export interface ProductSummary {
  code: string
  name: string
  lifecycleStatus: ProductLifecycleStatus
  pointsConfigVersion: number
  pointCount: number
  referenceImageUrl?: string | null
}

export interface Recipe {
  code: string
  name: string
  machineType?: string | null
  version: number
  payload: Record<string, unknown>
  checksum?: string | null
  status: RecipeStatus
}

export interface RecipeSummary {
  code: string
  name: string
  machineType?: string | null
  version: number
  status: RecipeStatus
  checksum?: string | null
}

// ─────────────────────────────────────────────────────────────────────────
// Sync domain types — Task C7's seam (`/v1/machines/{code}/config/*`). 1:1 with ConfigDtos.cs's own
// "Sync" section; see this file's header for why these are real implementations, not stubs.
// ─────────────────────────────────────────────────────────────────────────

export interface SyncPointDto {
  code: string
  name: string
  description?: string | null
  measurementType: string
  unit?: string | null
  lowerLimit?: number | null
  upperLimit?: number | null
  nominalValue?: number | null
  positionX: number
  positionY: number
  radius?: number | null
  normalizedX?: number | null
  normalizedY?: number | null
  normalizedRadius?: number | null
  cropWidth?: number | null
  cropHeight?: number | null
  orderIndex?: number | null
  workstationCode?: string | null
  isActive?: boolean | null
  imageBase64?: string | null
  imageMimeType?: string | null
  imageUrl?: string | null
  shape?: string | null
  geometry?: unknown
  expectedUpdatedAt?: string | null
}

export interface SyncPointsRequestDto {
  machineCode?: string | null
  productModelCode: string
  sourceImageWidth?: number | null
  sourceImageHeight?: number | null
  clientVersion?: number | null
  variantCode?: string | null
  points: SyncPointDto[]
}

export interface SyncPointOutcomeDto {
  code: string
  /** `created | updated | conflict | failed`. */
  status: string
  limitBlocked: boolean
  message?: string | null
}

export interface SyncPointsResultDto {
  success: boolean
  productModelCode: string
  previousVersion: number
  newVersion: number
  pointsCreated: number
  pointsUpdated: number
  pointsFailed: number
  staleConflicts: number
  blindOverwrites: number
  limitChangesBlocked: boolean
  points: SyncPointOutcomeDto[]
}

export interface ProductVersionDto {
  productModelCode: string
  pointsConfigVersion: number
  imageWidth?: number | null
  imageHeight?: number | null
}

/** `driftState`: `in_sync | drift | unknown`. */
export interface ProductDriftDto {
  productModelCode: string
  localVersion?: number | null
  ecosystemVersion: number
  driftState: string
}

/** `resolvedBy`: `machine | machineType | none`. */
export interface RecipeDriftDto {
  code: string
  localVersion?: number | null
  ecosystemVersion: number
  driftState: string
  resolvedBy: string
}

/** `configKind`: `points | recipe`. Exactly one of `products`/`recipe` is populated. */
export interface MachineConfigCheckDto {
  machineCode: string
  configKind: string
  products: ProductDriftDto[]
  recipe: RecipeDriftDto | null
}

export interface PointFieldChangeDto {
  field: string
  localValue?: string | null
  ecosystemValue?: string | null
}

export interface ChangedPointDto {
  code: string
  name: string
  fields: PointFieldChangeDto[]
}

export interface MachineConfigDiffDto {
  machineCode: string
  productModelCode: string
  localVersion?: number | null
  ecosystemVersion: number
  versionDelta: number
  addedPointCodes: string[]
  removedPointCodes: string[]
  changedPoints: ChangedPointDto[]
}

export interface MachineConfigPullResultDto {
  machineCode: string
  configKind: string
  code: string
  applied: boolean
  fromVersion?: number | null
  toVersion?: number | null
  pointsApplied: number
  pointsRemoved: number
  diff: MachineConfigDiffDto | null
  message: string
}

export interface MachineConfigPushResultDto {
  machineCode: string
  productModelCode: string
  success: boolean
  previousVersion?: number | null
  newVersion?: number | null
  pointsCreated: number
  pointsUpdated: number
  pointsFailed: number
  staleConflicts: number
  blindOverwrites: number
  limitChangesBlocked: boolean
  points: SyncPointOutcomeDto[]
  message: string
}

/** `op`: `pull | push`; `status`: `success | failed`. */
export interface ConfigSyncHistoryEntryDto {
  seq: number
  occurredAt: string
  machineCode: string
  op: string
  status: string
  code: string
  fromVersion?: number | null
  toVersion?: number | null
  summary: string
}

/** `resolvedBy`: `machine | machineType | none`. */
export interface RecipeCheckResultDto {
  success: boolean
  code?: string | null
  version: number
  checksum?: string | null
  resolvedBy: string
}

export interface DeletedPointDto {
  code: string
  deletedAt: string
  deletedAtVersion?: number | null
}

export interface PointsDeltaResultDto {
  hasChanges: boolean
  points: MeasurementPoint[]
  deletedCodes: string[]
  deletedPoints: DeletedPointDto[]
}

export interface ConfigPullRequest {
  productCode?: string | null
}

export interface ConfigPushRequest {
  productCode: string
  confirm: boolean
}

// ─────────────────────────────────────────────────────────────────────────
// Fetcher + endpoints
// ─────────────────────────────────────────────────────────────────────────

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET"
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  })
  if (!res.ok) throw new EngineApiError(method, path, res.status)
  return (await res.json()) as T
}

const enc = encodeURIComponent

const endpoints = {
  // Products
  products: () => request<ProductSummary[]>("/v1/products"),
  product: (code: string) => request<ProductModel>(`/v1/products/${enc(code)}`),
  saveProduct: (code: string, body: ProductModel) =>
    request<ProductModel>(`/v1/products/${enc(code)}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteProduct: (code: string) => request<{ deleted: boolean }>(`/v1/products/${enc(code)}`, { method: "DELETE" }),

  // Points (C5's seam)
  points: (code: string, includeDeleted?: boolean) =>
    request<MeasurementPoint[]>(
      `/v1/products/${enc(code)}/points${includeDeleted ? "?includeDeleted=true" : ""}`
    ),
  point: (code: string, pointCode: string) =>
    request<MeasurementPoint>(`/v1/products/${enc(code)}/points/${enc(pointCode)}`),
  savePoint: (code: string, pointCode: string, body: MeasurementPoint) =>
    request<MeasurementPoint>(`/v1/products/${enc(code)}/points/${enc(pointCode)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deletePoint: (code: string, pointCode: string) =>
    request<{ deleted: boolean }>(`/v1/products/${enc(code)}/points/${enc(pointCode)}`, { method: "DELETE" }),

  // Recipes (C6's seam)
  recipes: () => request<RecipeSummary[]>("/v1/recipes"),
  recipe: (code: string) => request<Recipe>(`/v1/recipes/${enc(code)}`),
  saveRecipe: (code: string, body: Recipe) =>
    request<Recipe>(`/v1/recipes/${enc(code)}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteRecipe: (code: string) => request<{ deleted: boolean }>(`/v1/recipes/${enc(code)}`, { method: "DELETE" }),

  // Per-machine sync (C7's seam)
  machineConfigCheck: (machineCode: string, productCode?: string) =>
    request<MachineConfigCheckDto>(
      `/v1/machines/${enc(machineCode)}/config/check${productCode ? `?productCode=${enc(productCode)}` : ""}`
    ),
  machineConfigPull: (machineCode: string, body: ConfigPullRequest) =>
    request<MachineConfigPullResultDto>(`/v1/machines/${enc(machineCode)}/config/pull`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  machineConfigPush: (machineCode: string, body: ConfigPushRequest) =>
    request<MachineConfigPushResultDto>(`/v1/machines/${enc(machineCode)}/config/push`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  machineConfigDiff: (machineCode: string, productCode: string) =>
    request<MachineConfigDiffDto>(
      `/v1/machines/${enc(machineCode)}/config/diff?productCode=${enc(productCode)}`
    ),
  machineConfigHistory: (machineCode: string) =>
    request<ConfigSyncHistoryEntryDto[]>(`/v1/machines/${enc(machineCode)}/config/history`),
}

/** Resolves a `referenceImageUrl`/`templateImageUrl` value into something an `<img src>` can load:
 * `data:`/absolute `http(s):` URLs pass through untouched (a base64 upload or a fully-qualified
 * ecosystem URL); anything else is treated as engine-relative (mirrors `BASE_URL`'s own
 * same-origin-in-prod / fixed-port-in-dev split — see this file's header). Returns `null` for
 * empty/absent so callers can render a placeholder instead of an empty `src`. */
export function resolveProductImageUrl(url: string | null | undefined): string | null {
  if (!url || url.trim().length === 0) return null
  if (/^(data:|https?:\/\/)/i.test(url)) return url
  return `${BASE_URL}/${url.replace(/^\/+/, "")}`
}

// ─────────────────────────────────────────────────────────────────────────
// Query hooks
// ─────────────────────────────────────────────────────────────────────────

const QUERY_KEYS = {
  products: ["configProducts"] as const,
  product: (code: string) => ["configProduct", code] as const,
  points: (code: string, includeDeleted: boolean) => ["configPoints", code, includeDeleted] as const,
  point: (code: string, pointCode: string) => ["configPoint", code, pointCode] as const,
  recipes: ["configRecipes"] as const,
  recipe: (code: string) => ["configRecipe", code] as const,
  machineConfigCheck: (machineCode: string, productCode?: string) =>
    ["machineConfigCheck", machineCode, productCode ?? null] as const,
  machineConfigDiff: (machineCode: string, productCode: string) =>
    ["machineConfigDiff", machineCode, productCode] as const,
  machineConfigHistory: (machineCode: string) => ["machineConfigHistory", machineCode] as const,
}

/** `GET /v1/products` — the list view (`ProductConfig.tsx`). Not polled (unlike the fleet's live
 * telemetry queries) — product configs only change through this same client's own authoring
 * mutations, which invalidate this key explicitly on success. */
export function useProducts(): UseQueryResult<ProductSummary[]> {
  return useQuery({ queryKey: QUERY_KEYS.products, queryFn: endpoints.products })
}

/** `GET /v1/products/{code}` — the full aggregate (`ProductConfigDetail.tsx`, and C5's points
 * editor). A confirmed 404 stops retrying/polling for the same reason `useMachine` does in
 * `lib/api.ts` (a deleted/mistyped code isn't about to start existing). */
export function useProduct(code: string | undefined): UseQueryResult<ProductModel> {
  return useQuery({
    queryKey: QUERY_KEYS.product(code ?? ""),
    queryFn: () => endpoints.product(code as string),
    enabled: code !== undefined && code.length > 0,
    retry: (failureCount, error) => !(error instanceof EngineApiError && error.status === 404) && failureCount < 2,
  })
}

/** `PUT /v1/products/{code}` — create OR replace-whole-aggregate (see this file's header comment on
 * why callers editing an existing product must spread the full loaded `ProductModel`, not just the
 * fields a form happens to show). On success, seeds the detail cache and invalidates the list (name/
 * lifecycle/point-count can all have changed). */
export function useSaveProduct() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ code, product }: { code: string; product: ProductModel }) => endpoints.saveProduct(code, product),
    onSuccess: (data) => {
      queryClient.setQueryData(QUERY_KEYS.product(data.code), data)
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.products })
    },
  })
}

export function useDeleteProduct() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (code: string) => endpoints.deleteProduct(code),
    onSuccess: (_data, code) => {
      queryClient.removeQueries({ queryKey: QUERY_KEYS.product(code) })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.products })
    },
  })
}

// ── Points (C5's seam) ──────────────────────────────────────────────────

export function useProductPoints(code: string | undefined, includeDeleted = false): UseQueryResult<MeasurementPoint[]> {
  return useQuery({
    queryKey: QUERY_KEYS.points(code ?? "", includeDeleted),
    queryFn: () => endpoints.points(code as string, includeDeleted),
    enabled: code !== undefined && code.length > 0,
  })
}

export function usePoint(code: string | undefined, pointCode: string | undefined): UseQueryResult<MeasurementPoint> {
  return useQuery({
    queryKey: QUERY_KEYS.point(code ?? "", pointCode ?? ""),
    queryFn: () => endpoints.point(code as string, pointCode as string),
    enabled: Boolean(code) && Boolean(pointCode),
  })
}

/** `POST/PUT /v1/products/{code}/points/{pointCode}` — a granular per-point upsert (unlike
 * `useSaveProduct`, this does NOT require re-sending the whole product). Bumps the product's
 * `pointsConfigVersion` server-side, so both the points list and the product detail query are
 * invalidated on success. */
export function useSavePoint() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ code, pointCode, point }: { code: string; pointCode: string; point: MeasurementPoint }) =>
      endpoints.savePoint(code, pointCode, point),
    onSuccess: (_data, { code }) => {
      queryClient.invalidateQueries({ queryKey: ["configPoints", code] })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.product(code) })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.products })
    },
  })
}

export function useDeletePoint() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ code, pointCode }: { code: string; pointCode: string }) => endpoints.deletePoint(code, pointCode),
    onSuccess: (_data, { code }) => {
      queryClient.invalidateQueries({ queryKey: ["configPoints", code] })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.product(code) })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.products })
    },
  })
}

// ── Recipes (C6's seam) ─────────────────────────────────────────────────

export function useRecipes(): UseQueryResult<RecipeSummary[]> {
  return useQuery({ queryKey: QUERY_KEYS.recipes, queryFn: endpoints.recipes })
}

export function useRecipe(code: string | undefined): UseQueryResult<Recipe> {
  return useQuery({
    queryKey: QUERY_KEYS.recipe(code ?? ""),
    queryFn: () => endpoints.recipe(code as string),
    enabled: code !== undefined && code.length > 0,
  })
}

export function useSaveRecipe() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ code, recipe }: { code: string; recipe: Recipe }) => endpoints.saveRecipe(code, recipe),
    onSuccess: (data) => {
      queryClient.setQueryData(QUERY_KEYS.recipe(data.code), data)
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.recipes })
    },
  })
}

export function useDeleteRecipe() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (code: string) => endpoints.deleteRecipe(code),
    onSuccess: (_data, code) => {
      queryClient.removeQueries({ queryKey: QUERY_KEYS.recipe(code) })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.recipes })
    },
  })
}

// ── Per-machine sync (C7's seam) ────────────────────────────────────────

export function useMachineConfigCheck(
  machineCode: string | undefined,
  productCode?: string
): UseQueryResult<MachineConfigCheckDto> {
  return useQuery({
    queryKey: QUERY_KEYS.machineConfigCheck(machineCode ?? "", productCode),
    queryFn: () => endpoints.machineConfigCheck(machineCode as string, productCode),
    enabled: Boolean(machineCode),
  })
}

export function useMachineConfigDiff(
  machineCode: string | undefined,
  productCode: string | undefined
): UseQueryResult<MachineConfigDiffDto> {
  return useQuery({
    queryKey: QUERY_KEYS.machineConfigDiff(machineCode ?? "", productCode ?? ""),
    queryFn: () => endpoints.machineConfigDiff(machineCode as string, productCode as string),
    enabled: Boolean(machineCode) && Boolean(productCode),
  })
}

export function useMachineConfigHistory(machineCode: string | undefined): UseQueryResult<ConfigSyncHistoryEntryDto[]> {
  return useQuery({
    queryKey: QUERY_KEYS.machineConfigHistory(machineCode ?? ""),
    queryFn: () => endpoints.machineConfigHistory(machineCode as string),
    enabled: Boolean(machineCode),
  })
}

/** Task C7: pull writes into the LOCAL `ProductConfigStore` (`ConfigSyncEngine.PullAsync` calls
 * `_localStore.UpsertProduct`/`UpsertRecipe`), so beyond this machine's own check/diff/history, the
 * product/recipe AUTHORING screens (`ProductConfigDetail.tsx`, `PointsEditor.tsx`, `RecipeConfigDetail.tsx`)
 * need to catch up too — invalidating the broad `"configProduct"`/`"configPoints"`/`"configRecipe"`
 * prefixes (not just this one product's key) is cheap here (small local dataset) and correct regardless
 * of which product/recipe code the pull actually touched. */
export function useMachineConfigPull() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ machineCode, body }: { machineCode: string; body: ConfigPullRequest }) =>
      endpoints.machineConfigPull(machineCode, body),
    onSuccess: (_data, { machineCode }) => {
      queryClient.invalidateQueries({ queryKey: ["machineConfigCheck", machineCode] })
      queryClient.invalidateQueries({ queryKey: ["machineConfigDiff", machineCode] })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.machineConfigHistory(machineCode) })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.products })
      queryClient.invalidateQueries({ queryKey: ["configProduct"] })
      queryClient.invalidateQueries({ queryKey: ["configPoints"] })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.recipes })
      queryClient.invalidateQueries({ queryKey: ["configRecipe"] })
    },
  })
}

/** Push doesn't touch the local store (only the ecosystem's version advances — see
 * `ConfigSyncEngine.PushAsync`'s own doc comment: it reads local points but never calls
 * `_localStore.Upsert*`), so only the check/diff/history queries need to catch up here. */
export function useMachineConfigPush() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ machineCode, body }: { machineCode: string; body: ConfigPushRequest }) =>
      endpoints.machineConfigPush(machineCode, body),
    onSuccess: (_data, { machineCode }) => {
      queryClient.invalidateQueries({ queryKey: ["machineConfigCheck", machineCode] })
      queryClient.invalidateQueries({ queryKey: ["machineConfigDiff", machineCode] })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.machineConfigHistory(machineCode) })
    },
  })
}

// Re-export so route/component files don't need a second import from "./api" just for the error type.
export { EngineApiError }
export type { UseQueryResult }
