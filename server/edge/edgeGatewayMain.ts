/**
 * W7-1 (doc 44 gap G1.14) — EDGE GATEWAY entry point (SYNAPSE Tầng-1 §5.2).
 *
 * A STANDALONE process that runs AT THE EDGE, near the devices — one gateway per
 * line/cell (deploy/edge/*). It runs ONLY the southbound OT collectors (otManager +
 * ConnectionSupervisor) and the northbound UNS bridge (Sparkplug/normalized), plus
 * the edge-autonomy store-and-forward. It binds NO HTTP API, NO Socket.IO, and NO
 * in-process MQTT broker (contrast the all-in-one entry `server/_core/index.ts`).
 *
 * Pair it with a central platform reachable over the UNS broker:
 *
 *   Edge gateway:  npm run start:edge          (OT + UNS bridge + store-forward)
 *   Dev edge:      npm run dev:edge
 *
 * Default topology is UNCHANGED: with EDGE_GATEWAY_MODE unset the all-in-one entry
 * still runs everything in one process and this file is simply never used.
 *
 * SINGLE-GATEWAY-PER-LINE ASSUMPTION: run exactly ONE edge gateway process per line
 * (each is a distinct Sparkplug Edge Node). Two gateways for the same adapter set
 * double-poll the devices.
 */
import "dotenv/config";
import { installConsoleBridge } from "../logger";
import { runEdgeGateway } from "../services/edge/edgeGatewayRuntime";

// This entrypoint IS the edge gateway — default edge mode ON (before any edge-mode
// read). Operators can still force it OFF with EDGE_GATEWAY_MODE=false. The all-in-one
// server NEVER imports this file, so it is unaffected.
if (process.env.EDGE_GATEWAY_MODE == null) process.env.EDGE_GATEWAY_MODE = "true";

// Structured logging parity with the other entries (no-op unless LOG_JSON=1).
installConsoleBridge();

runEdgeGateway().catch((err) => {
  console.error("[EdgeGateway] Fatal startup error:", err);
  process.exit(1);
});
