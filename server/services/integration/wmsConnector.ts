/**
 * WMS CONNECTOR — doc 44 W6-5 (G5.24) · SYNAPSE_Tang5 §8–9 (WMS integration).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Talks to a Warehouse Management System, ISA-95 style, ASYNCHRONOUSLY and
 * IDEMPOTENTLY, and stays AUTONOMOUS when the WMS is down:
 *
 *   OUTBOUND (durable outbox — never blocks production):
 *     • requestMaterial            → "hãy cấp vật tư X cho lệnh Y"
 *     • confirmMaterialConsumption → "đã tiêu thụ vật tư/lô X ở lệnh Y"
 *     • reportFinishedGoodsPallet  → pallet thành phẩm (genealogy family)
 *
 *   INBOUND (poll → anti-corruption map → id-map + audit):
 *     • pullInventory  → tồn kho theo material (khớp external id ↔ canonical code)
 *
 * All outbound rides the EXISTING integration_outbox (circuit-breaker/dead-letter),
 * reusing an event family + a `kind` discriminator (we don't touch erpOutbox).
 * External material identifiers are mapped to canonical `materials.code` via
 * enterprise_id_map — they NEVER leak into canonical inventory. Gated by
 * WMS_INTEGRATION_ENABLED (default OFF → every call is a no-op).
 * ════════════════════════════════════════════════════════════════════════════
 */
import {
  enqueueEnterpriseOutbound,
  resolveInternalId,
  upsertIdMap,
  recordSync,
  pullExternalJson,
  getPath,
  toNumber,
  wmsEnabled,
  type EnterpriseOutboundResult,
} from "./enterpriseIntegrationCore";

const SYSTEM = "wms" as const;

// ── Endpoint resolution (env; empty → not subscribed) ────────────────────────

function outboundEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  return (env.WMS_OUTBOUND_ENDPOINT ?? env.WMS_ENDPOINT ?? "").trim();
}

// ── OUTBOUND ─────────────────────────────────────────────────────────────────

export interface MaterialRequestInput {
  orderCode: string;
  componentCode: string;
  quantity: number;
  unit?: string;
  lineId?: number | null;
  needBy?: string | null;
  corporateCode?: string | null;
  /** Override the derived idempotency key (default: one open request per order+component). */
  idempotencyKey?: string;
}

/** Ask the WMS to issue material for a production order. Durable + idempotent. */
export function requestMaterial(input: MaterialRequestInput): Promise<EnterpriseOutboundResult> {
  const idem = input.idempotencyKey ?? `wms-mreq-${input.orderCode}-${input.componentCode}`;
  return enqueueEnterpriseOutbound({
    system: SYSTEM,
    family: "production-event",
    kind: "wms.material.request",
    payload: {
      orderCode: input.orderCode,
      componentCode: input.componentCode,
      quantity: input.quantity,
      unit: input.unit ?? "pcs",
      lineId: input.lineId ?? null,
      needBy: input.needBy ?? null,
      requestedAt: new Date().toISOString(),
    },
    idempotencyKey: idem,
    targetEndpoint: outboundEndpoint(),
    corporateCode: input.corporateCode ?? null,
  });
}

export interface MaterialConfirmInput {
  orderCode: string;
  componentCode: string;
  quantity: number;
  lotCode?: string | null;
  unit?: string;
  corporateCode?: string | null;
  idempotencyKey?: string;
}

/** Confirm material/lot consumption back to the WMS. Durable + idempotent. */
export function confirmMaterialConsumption(input: MaterialConfirmInput): Promise<EnterpriseOutboundResult> {
  const idem = input.idempotencyKey ?? `wms-mconf-${input.orderCode}-${input.componentCode}-${input.lotCode ?? ""}`;
  return enqueueEnterpriseOutbound({
    system: SYSTEM,
    family: "production-event",
    kind: "wms.material.confirm",
    payload: {
      orderCode: input.orderCode,
      componentCode: input.componentCode,
      lotCode: input.lotCode ?? null,
      quantity: input.quantity,
      unit: input.unit ?? "pcs",
      confirmedAt: new Date().toISOString(),
    },
    idempotencyKey: idem,
    targetEndpoint: outboundEndpoint(),
    corporateCode: input.corporateCode ?? null,
  });
}

export interface FinishedGoodsPalletInput {
  palletCode: string;
  orderCode: string;
  quantity: number;
  serials?: string[];
  corporateCode?: string | null;
  idempotencyKey?: string;
}

/** Report a completed finished-goods pallet to the WMS (genealogy family). */
export function reportFinishedGoodsPallet(input: FinishedGoodsPalletInput): Promise<EnterpriseOutboundResult> {
  const idem = input.idempotencyKey ?? `wms-pallet-${input.palletCode}`;
  return enqueueEnterpriseOutbound({
    system: SYSTEM,
    family: "genealogy-record",
    kind: "wms.fg.pallet",
    payload: {
      palletCode: input.palletCode,
      orderCode: input.orderCode,
      quantity: input.quantity,
      serials: input.serials ?? [],
      builtAt: new Date().toISOString(),
    },
    idempotencyKey: idem,
    targetEndpoint: outboundEndpoint(),
    corporateCode: input.corporateCode ?? null,
  });
}

// ── INBOUND: inventory snapshot (anti-corruption mapping) ─────────────────────

/** How to read a WMS inventory JSON body (configurable → no vendor shape hardcoded). */
export interface WmsInventoryFieldMap {
  /** Dot-path to the line-item array (default "items"). */
  itemsPath?: string;
  /** Field holding the WMS's own material identifier. */
  externalIdField: string;
  /** Field holding the on-hand quantity. */
  quantityField: string;
  /** Optional field already carrying OUR canonical material code. */
  componentCodeField?: string;
}

export interface WmsInventoryItem {
  externalId: string;
  componentCode: string | null;
  quantity: number;
}

/**
 * PURE anti-corruption map: WMS body → canonical inventory items. Drops every WMS
 * field except the mapped id/qty (+ optional pre-supplied canonical code). No DB.
 */
export function mapWmsInventory(body: unknown, fieldMap: WmsInventoryFieldMap): WmsInventoryItem[] {
  const arr = getPath(body, fieldMap.itemsPath ?? "items");
  if (!Array.isArray(arr)) return [];
  const out: WmsInventoryItem[] = [];
  for (const raw of arr) {
    const externalId = getPath(raw, fieldMap.externalIdField);
    const qty = toNumber(getPath(raw, fieldMap.quantityField));
    if (externalId == null || qty == null) continue;
    const codeVal = fieldMap.componentCodeField ? getPath(raw, fieldMap.componentCodeField) : undefined;
    out.push({
      externalId: String(externalId),
      componentCode: typeof codeVal === "string" && codeVal.trim() ? codeVal.trim() : null,
      quantity: qty,
    });
  }
  return out;
}

export interface IngestInventoryResult {
  ok: boolean;
  /** Canonical metric map { componentCode → qty } for reconciliation. */
  metrics: Record<string, number>;
  mapped: number;
  unmapped: number;
  error?: string;
}

/**
 * Persist an inventory snapshot: resolve each external material id → canonical
 * `materials.code` (via enterprise_id_map, or the pre-supplied canonical code, which
 * also (re)writes the mapping), then return the canonical metric map. Fail-safe.
 */
export async function ingestInventorySnapshot(items: WmsInventoryItem[], corporateCode?: string | null): Promise<IngestInventoryResult> {
  const metrics: Record<string, number> = {};
  let mapped = 0;
  let unmapped = 0;
  try {
    for (const item of items) {
      let code = item.componentCode;
      if (code) {
        // WMS already told us the canonical code → record/refresh the mapping.
        await upsertIdMap({ system: SYSTEM, entityType: "material", externalId: item.externalId, internalId: code, externalRef: { quantity: item.quantity }, corporateCode });
      } else {
        // Resolve from a previously established mapping.
        code = await resolveInternalId(SYSTEM, "material", item.externalId);
      }
      if (code) {
        metrics[code] = (metrics[code] ?? 0) + item.quantity;
        mapped += 1;
      } else {
        // Bookkeep the unmapped external material for later resolution.
        await upsertIdMap({ system: SYSTEM, entityType: "material", externalId: item.externalId, internalId: null, externalRef: { quantity: item.quantity }, corporateCode });
        unmapped += 1;
      }
    }
    await recordSync({ system: SYSTEM, direction: "inbound", operation: "wms.inventory.snapshot", status: "ok", detail: { mapped, unmapped, keys: Object.keys(metrics).length } });
    return { ok: true, metrics, mapped, unmapped };
  } catch (err) {
    const error = (err as Error)?.message ?? String(err);
    await recordSync({ system: SYSTEM, direction: "inbound", operation: "wms.inventory.snapshot", status: "error", detail: { error } });
    return { ok: false, metrics, mapped, unmapped, error };
  }
}

export interface PullInventoryConfig extends WmsInventoryFieldMap {
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  corporateCode?: string | null;
  fetchImpl?: typeof fetch;
}

/**
 * Poll the WMS for a live inventory snapshot and persist it. AUTONOMOUS: any
 * transport/parse failure is caught, logged to the sync-log, and returned as
 * `{ ok:false }` — it NEVER throws and NEVER blocks production. No-op (disabled)
 * when WMS_INTEGRATION_ENABLED is off.
 */
export async function pullInventory(cfg: PullInventoryConfig): Promise<IngestInventoryResult & { disabled?: boolean }> {
  if (!wmsEnabled()) return { ok: false, metrics: {}, mapped: 0, unmapped: 0, disabled: true };
  try {
    const body = await pullExternalJson({ url: cfg.url, headers: cfg.headers, timeoutMs: cfg.timeoutMs, fetchImpl: cfg.fetchImpl });
    const items = mapWmsInventory(body, cfg);
    return await ingestInventorySnapshot(items, cfg.corporateCode);
  } catch (err) {
    const error = (err as Error)?.message ?? String(err);
    await recordSync({ system: SYSTEM, direction: "inbound", operation: "wms.inventory.pull", status: "error", detail: { error } });
    return { ok: false, metrics: {}, mapped: 0, unmapped: 0, error };
  }
}
