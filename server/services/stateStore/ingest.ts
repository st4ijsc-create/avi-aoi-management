/**
 * doc 44 W2-B1 / G2.12 — LIVE ingest hooks for the state store.
 *
 * WHERE the live feed comes from: the `machine:status_update` broadcast the
 * task hunts for ORIGINATES in server/_core/socket.ts — the
 * `socket.on("machine:heartbeat")` handler (machine clients push status +
 * metrics), with online/offline transitions on `machine:confirm_mapping` /
 * `disconnect`. socket.ts registers ADDITIVE listeners on those same events
 * (running AFTER the primary handlers — socket.io invokes listeners in
 * registration order) that call the hooks below. ONE write point:
 * `stateStoreOnMachineStatus` — every source funnels through it.
 *
 * HONEST LIMITATIONS (documented, not hidden):
 *   • telemetryBus/mqttService are owned by a parallel batch and are NOT
 *     hooked here — `values` refresh on machine heartbeats (metrics payload)
 *     and on lazy DB backfill only, until the telemetry hook lands.
 *   • `machine:sync_started` sets its guard state asynchronously (the primary
 *     handler awaits DB verification), so the FIRST snapshot for a machine
 *     that never confirms a mapping arrives with its first heartbeat.
 *
 * Flag: STATE_STORE_ENABLED (default OFF → every hook is a no-op).
 * READ-ONLY toward devices; never throws into the socket hot path.
 */

import { resolveIsa95Path } from "../uns/isa95Resolver";
import { isa95PathString, extractScalarMetrics } from "../uns/topicV2";
import { toCanonicalState } from "../uns/topicV2";
import {
  setState,
  stateStoreEnabled,
  valuesMax,
  type StateSnapshot,
  type StateSnapshotValue,
} from "./stateStore";

// Track which socket carries which machine so a disconnect can honestly mark
// the machine offline (the primary socket.ts disconnect handler clears its own
// map BEFORE our additive listener runs, so we keep an independent one).
const socketMachine = new Map<string, number>();

/** Remember that `socketId` speaks for `machineId` (called from socket.ts). */
export function trackMachineSocket(socketId: string, machineId: number): void {
  if (!Number.isInteger(machineId) || machineId <= 0) return;
  socketMachine.set(socketId, machineId);
}

/**
 * THE one write point: build a §10.1 StateSnapshot for a machine status
 * change and put it in the state store. Fire-and-forget safe (never throws).
 */
export async function stateStoreOnMachineStatus(input: {
  machineId: number;
  status: string;
  metrics?: unknown;
  ts?: Date | string;
}): Promise<void> {
  if (!stateStoreEnabled()) return;
  const machineId = Number(input.machineId);
  if (!Number.isInteger(machineId) || machineId <= 0) return;
  try {
    const path = await resolveIsa95Path(machineId);
    if (!path) return; // unknown machine / no hierarchy → nothing honest to store

    // values-rút-gọn: top-level scalars of the heartbeat metrics payload.
    let values: Record<string, StateSnapshotValue> | undefined;
    const scalars = extractScalarMetrics(input.metrics);
    if (scalars.length > 0) {
      values = {};
      for (const s of scalars.slice(0, valuesMax())) values[s.name] = { v: s.value };
    }

    const statusRaw = String(input.status ?? "").toLowerCase();
    const snap: StateSnapshot = {
      path: isa95PathString(path),
      ts: input.ts ? new Date(input.ts).toISOString() : new Date().toISOString(),
      state: toCanonicalState(input.status),
      ...(values ? { values } : {}),
      health: statusRaw === "offline" || statusRaw === "disconnected" ? "offline" : "online",
      source: "live",
      machineId,
    };
    setState(snap.path, snap);
  } catch (err) {
    console.error("[StateStore] ingest hook failed:", (err as Error)?.message ?? err);
  }
}

/**
 * Socket disconnect hook: if the socket carried a machine, store an OFFLINE
 * snapshot for it. Safe no-op for browser sockets / unknown ids.
 */
export async function stateStoreOnMachineSocketDisconnect(socketId: string): Promise<void> {
  const machineId = socketMachine.get(socketId);
  socketMachine.delete(socketId);
  if (machineId == null) return;
  await stateStoreOnMachineStatus({ machineId, status: "offline" });
}

/** Test seam: clear the socket→machine tracking map. */
export function _resetStateStoreIngestForTests(): void {
  socketMachine.clear();
}
