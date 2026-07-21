/**
 * Task 4/5 (docs/plans/2026-07-21-machine-config.md) — typed EngineApi client + TanStack Query hooks
 * for the machine operating-configuration feature (`/v1/machines/{code}/settings*`), sibling to
 * `lib/configApi.ts` (same BASE_URL resolution, same `request<T>` fetch wrapper idiom, same
 * query-invalidation convention) rather than a parallel dialect.
 *
 * Wire shapes mirror `St4i.EngineApi.Config.MachineSettingsDtos` / `St4i.EdgeCore.Config.MachineConfigModels`
 * EXACTLY (see `mc-task12-report.md`) — every response goes through `ConfigJson.Options`
 * (`JsonSerializerDefaults.Web`, camelCase, no global enum converter), so enum wire values are the
 * `[JsonConverter]` each C# enum declares: `snake_lower` for `ParameterValueKind`/`AdjustmentScope`,
 * the one exception `machineProduct` (camelCase) for `ConfigProvenance`.
 *
 * A 400 from `PUT .../settings/{key}` (out-of-range write) carries `{ error: "<key> must be between
 * <min> and <max> <unit> (got <value>)." }` — `MachineSettingsApiError.serverMessage` below captures
 * that body so a caller can surface the EXACT server wording (docs/plans' hard requirement: "never
 * silently clamp", "surface that honestly") rather than inventing its own generic error text.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query"

const BASE_URL =
  (import.meta.env.VITE_ENGINE_URL as string | undefined) ?? (import.meta.env.DEV ? "http://localhost:5199" : "")

// ─────────────────────────────────────────────────────────────────────────
// Wire types — 1:1 with MachineSettingsDtos.cs / MachineConfigModels.cs
// ─────────────────────────────────────────────────────────────────────────

export type ParameterValueKind = "number" | "enum" | "bool"
export type AdjustmentScope = "machine" | "product"
/** The one camelCase provenance value — `CamelEnumConverter`, see this file's header. */
export type ConfigProvenance = "baseline" | "machine" | "machineProduct"

export interface ParameterDef {
  key: string
  labelVi: string
  labelEn: string
  unit: string
  kind: ParameterValueKind
  min: number
  max: number
  step: number
  decimals: number
  configKind: string
  default: number
}

export interface ParameterAdjustment {
  value: number
  by?: string | null
  at: string
  note?: string | null
}

export interface BaselineSnapshot {
  version: number
  values: Record<string, number>
  checksum?: string | null
  pulledAt: string
}

export interface EffectiveParameter {
  def: ParameterDef
  value: number
  source: ConfigProvenance
  baselineValue: number
  machineAdjustment?: ParameterAdjustment | null
  productAdjustment?: ParameterAdjustment | null
}

export interface MachineSettingsResponse {
  machineCode: string
  configKind: string
  supportsProductScope: boolean
  productCode?: string | null
  schema: ParameterDef[]
  baseline: BaselineSnapshot
  machineAdjustments: Record<string, ParameterAdjustment>
  productAdjustments: Record<string, ParameterAdjustment>
  effective: EffectiveParameter[]
  adjustmentsChecksum: string
  driftedKeys: string[]
}

export interface UpdateSettingRequest {
  value: number
  scope: AdjustmentScope
  product?: string | null
  note?: string | null
  by?: string | null
}

// ─────────────────────────────────────────────────────────────────────────
// Fetcher — captures the server's own `{ error }` body text (see this file's header) instead of just
// a bare status code, so a rejected out-of-range write can be shown verbatim rather than reworded.
// ─────────────────────────────────────────────────────────────────────────

export class MachineSettingsApiError extends Error {
  method: string
  path: string
  status: number
  /** The server's own `ApiErrorDto.Error` text when the response body was JSON with an `error`
   * field (every 400/404 this endpoint family returns) — undefined only for a genuinely unparseable
   * body (a 500, a network-layer failure a proxy injected, ...). */
  serverMessage?: string

  constructor(method: string, path: string, status: number, serverMessage?: string) {
    super(serverMessage ?? `${method} ${path} failed: ${status}`)
    this.name = "MachineSettingsApiError"
    this.method = method
    this.path = path
    this.status = status
    this.serverMessage = serverMessage
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET"
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  })
  if (!res.ok) {
    let serverMessage: string | undefined
    try {
      const body = (await res.json()) as { error?: string }
      serverMessage = body?.error
    } catch {
      // Non-JSON body (rare — a proxy/500 page) — fall back to the generic message.
    }
    throw new MachineSettingsApiError(method, path, res.status, serverMessage)
  }
  return (await res.json()) as T
}

const enc = encodeURIComponent

const endpoints = {
  settings: (machineCode: string, product?: string | null) =>
    request<MachineSettingsResponse>(
      `/v1/machines/${enc(machineCode)}/settings${product ? `?product=${enc(product)}` : ""}`
    ),
  updateSetting: (machineCode: string, key: string, body: UpdateSettingRequest) =>
    request<MachineSettingsResponse>(`/v1/machines/${enc(machineCode)}/settings/${enc(key)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  resetSetting: (machineCode: string, key: string, scope: AdjustmentScope, product?: string | null) =>
    request<MachineSettingsResponse>(
      `/v1/machines/${enc(machineCode)}/settings/${enc(key)}?scope=${enc(scope)}${product ? `&product=${enc(product)}` : ""}`,
      { method: "DELETE" }
    ),
}

// ─────────────────────────────────────────────────────────────────────────
// Query hooks
// ─────────────────────────────────────────────────────────────────────────

const QUERY_KEYS = {
  settings: (machineCode: string, product?: string | null) => ["machineSettings", machineCode, product ?? null] as const,
  settingsAny: (machineCode: string) => ["machineSettings", machineCode] as const,
}

/** `GET /v1/machines/{code}/settings?product=` — the resolved 3-layer view (schema + baseline +
 * both adjustment maps + effective values + drift keys) for one (machine, product?) pair. `product`
 * is ignored server-side for a `configKind` with no product dimension (IoT) — see this file's header
 * — so passing it defensively for every device class is harmless. */
export function useMachineSettings(
  machineCode: string | undefined,
  product?: string | null
): UseQueryResult<MachineSettingsResponse, MachineSettingsApiError> {
  return useQuery({
    queryKey: QUERY_KEYS.settings(machineCode ?? "", product),
    queryFn: () => endpoints.settings(machineCode as string, product),
    enabled: Boolean(machineCode),
    // A machine type with no operating-configuration parameter set (ASSEMBLY/LEAK_TEST/FUNCTIONAL_TEST
    // — see MachineParameterSchema.ConfigKindForMachineType) 400s permanently; retrying is pointless.
    retry: (failureCount, error) => !(error instanceof MachineSettingsApiError && error.status === 400) && failureCount < 2,
  })
}

/** `PUT /v1/machines/{code}/settings/{key}` — writes one machine- or product-scoped adjustment.
 * Invalidates every cached settings view for this machine (any product) since a machine-scoped write
 * changes what EVERY product sees, not just the one in view. */
export function useUpdateMachineSetting() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ machineCode, key, body }: { machineCode: string; key: string; body: UpdateSettingRequest }) =>
      endpoints.updateSetting(machineCode, key, body),
    onSuccess: (_data, { machineCode }) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.settingsAny(machineCode) })
    },
  })
}

/** `DELETE /v1/machines/{code}/settings/{key}?scope=&product=` — the "về mặc định" (reset to
 * default) action: drops the adjustment at `scope`, falling back to whatever layer resolves beneath
 * it. Same broad invalidation as the update mutation, for the same reason. */
export function useResetMachineSetting() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      machineCode,
      key,
      scope,
      product,
    }: {
      machineCode: string
      key: string
      scope: AdjustmentScope
      product?: string | null
    }) => endpoints.resetSetting(machineCode, key, scope, product),
    onSuccess: (_data, { machineCode }) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.settingsAny(machineCode) })
    },
  })
}
