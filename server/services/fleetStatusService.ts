/**
 * Doc 38 T-1 (P1) — UNIFIED FLEET-STATUS view.
 *
 * The existing `getFleetOverview()` (aiEdgeEnhanced.ts) only covers ONE of the
 * three fleet planes — AI-model edge_deployments. Operations also runs:
 *   • edge_nodes      — the edge CONTROL runtimes (heartbeat/status/scope), and
 *   • device_adapters — the OT connectivity endpoints (protocol/status/enabled).
 * This service gathers all three into ONE read-only overview so a single card can
 * answer "what is my fleet, and what is up?" without three round-trips.
 *
 * SCOPE: read-only aggregation. NO new table, NO writes, NO device I/O — it only
 * SELECTs from tables the platform already maintains (edge_nodes/device_adapters
 * via drizzle; edge_deployments via the existing getFleetOverview()). Honest-degrade:
 * a missing DB throws (surfaced by the router as a 500); an empty plane returns zeros.
 *
 * WIRING NOTE (for the wave-lead): exposed as `getUnifiedFleetStatus`; already
 * surfaced by edgeDeploymentRouter.getUnifiedFleetStatus (admin-only). No routers.ts
 * edit needed.
 */
import { getDb } from "../db";
import { edgeNodes, deviceAdapters } from "../../drizzle/schema";
import { getFleetOverview, type FleetOverview } from "./aiEdgeEnhanced";

export interface EdgeNodesPlane {
  total: number;
  online: number;
  offline: number;
  degraded: number;
  nodes: Array<{
    id: number;
    code: string;
    name: string;
    factoryCode: string | null;
    status: string;
    version: string | null;
    lastHeartbeatAt: Date | null;
    assignedLineCodes: string[] | null;
  }>;
}

export interface DeviceAdaptersPlane {
  total: number;
  enabled: number;
  connected: number;
  byProtocol: Record<string, number>;
  byStatus: Record<string, number>;
  adapters: Array<{
    id: number;
    code: string;
    name: string;
    machineId: number | null;
    protocol: string;
    endpoint: string;
    status: string;
    isEnabled: boolean;
    lastConnectedAt: Date | null;
    lastError: string | null;
  }>;
}

export interface UnifiedFleetStatus {
  generatedAt: string;
  /** AI-model edge deployments (reused verbatim from getFleetOverview). */
  deployments: FleetOverview;
  /** Edge CONTROL runtimes (edge_nodes). */
  edgeNodes: EdgeNodesPlane;
  /** OT connectivity endpoints (device_adapters). */
  deviceAdapters: DeviceAdaptersPlane;
  /** Cross-plane roll-up (endpoints = adapters + edge nodes + deployed devices). */
  summary: {
    totalEndpoints: number;
    onlineEndpoints: number;
    offlineEndpoints: number;
  };
}

async function loadEdgeNodesPlane(): Promise<EdgeNodesPlane> {
  const db = await getDb();
  if (!db) return { total: 0, online: 0, offline: 0, degraded: 0, nodes: [] };
  const rows = await db
    .select({
      id: edgeNodes.id,
      code: edgeNodes.code,
      name: edgeNodes.name,
      factoryCode: edgeNodes.factoryCode,
      status: edgeNodes.status,
      version: edgeNodes.version,
      lastHeartbeatAt: edgeNodes.lastHeartbeatAt,
      assignedLineCodes: edgeNodes.assignedLineCodes,
    })
    .from(edgeNodes)
    .orderBy(edgeNodes.code);

  let online = 0;
  let offline = 0;
  let degraded = 0;
  for (const r of rows) {
    if (r.status === "online") online++;
    else if (r.status === "degraded") degraded++;
    else offline++;
  }
  return { total: rows.length, online, offline, degraded, nodes: rows };
}

async function loadDeviceAdaptersPlane(): Promise<DeviceAdaptersPlane> {
  const db = await getDb();
  if (!db)
    return { total: 0, enabled: 0, connected: 0, byProtocol: {}, byStatus: {}, adapters: [] };
  const rows = await db
    .select({
      id: deviceAdapters.id,
      code: deviceAdapters.code,
      name: deviceAdapters.name,
      machineId: deviceAdapters.machineId,
      protocol: deviceAdapters.protocol,
      endpoint: deviceAdapters.endpoint,
      status: deviceAdapters.status,
      isEnabled: deviceAdapters.isEnabled,
      lastConnectedAt: deviceAdapters.lastConnectedAt,
      lastError: deviceAdapters.lastError,
    })
    .from(deviceAdapters)
    .orderBy(deviceAdapters.code);

  const byProtocol: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  let enabled = 0;
  let connected = 0;
  for (const r of rows) {
    byProtocol[r.protocol] = (byProtocol[r.protocol] ?? 0) + 1;
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    if (r.isEnabled) enabled++;
    if (r.status === "connected") connected++;
  }
  return { total: rows.length, enabled, connected, byProtocol, byStatus, adapters: rows };
}

/**
 * One read-only overview across the three fleet planes. Each plane is loaded
 * independently; the deployments plane reuses the existing getFleetOverview().
 */
export async function getUnifiedFleetStatus(): Promise<UnifiedFleetStatus> {
  // Fail loudly only if there is no DB at all (mirrors getFleetOverview).
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [deployments, edgeNodesPlane, deviceAdaptersPlane] = await Promise.all([
    getFleetOverview(),
    loadEdgeNodesPlane(),
    loadDeviceAdaptersPlane(),
  ]);

  const totalEndpoints =
    deviceAdaptersPlane.total + edgeNodesPlane.total + deployments.totalDevices;
  const onlineEndpoints =
    deviceAdaptersPlane.connected + edgeNodesPlane.online + deployments.onlineDevices;

  return {
    generatedAt: new Date().toISOString(),
    deployments,
    edgeNodes: edgeNodesPlane,
    deviceAdapters: deviceAdaptersPlane,
    summary: {
      totalEndpoints,
      onlineEndpoints,
      offlineEndpoints: Math.max(0, totalEndpoints - onlineEndpoints),
    },
  };
}
