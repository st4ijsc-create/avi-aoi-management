// doc 56 Đ4 (CONFIG-SYNC) — LIVE proof that the generic config-sync loop closes on
// a real pilot machine, against the REAL live DB + the REAL tRPC procedures:
//
//   DEPLOY (engineer intent)  →  upsertDesiredConfig writes the desired* shadow
//   CHECK  (machine polls)     →  machineApi.checkConfigVersion → {code,version,checksum}
//   GET    (machine pulls)     →  machineApi.getActiveConfig    → full payload + checksum
//   ACK    (machine applied)   →  machineApi.ackConfigApplied   → reported* + driftState
//   DRIFT  (machine diverges)  →  ack a WRONG checksum          → driftState='drift'
//
// This drives the SAME publicProcedures the Express proxies call (real authenticateMachine
// via a freshly-minted mk_ key, real resolveActiveRecipe, real recordReportedConfig, real
// computeDriftState, real machine_config_state shadow). Only the thin HTTP proxy layer is
// skipped — that (Bearer mk_ over the wire) was already proven LIVE in Đ3 (doc 56B).
//
//   DATABASE_URL="postgresql://aoi:aoi@127.0.0.1:5434/aoi_management" npx tsx scripts/pilot-config-sync.mjs
//
// Requires owner DATABASE_URL (mints an api_keys row + writes the shadow). Idempotent:
// re-running seeds a fresh recipe version + a fresh mk_ key (old ones stay valid).

// Flags read at CALL time by the procedures — set them BEFORE importing the router.
process.env.CONFIG_SYNC_GENERIC_ENABLED = "true";
process.env.CONFIG_DRIFT_REPORT_ENABLED = "true";
process.env.RECIPE_TYPED_SCHEMA_MODE = process.env.RECIPE_TYPED_SCHEMA_MODE || "enforce";

import { createHash, randomBytes } from "node:crypto";
import { getDb } from "../server/db/connection.ts";
import { createRecipe, getActiveRecipe } from "../server/db/machineRecipe.ts";
import { upsertDesiredConfig, readConfigState } from "../server/services/configDriftService.ts";
import { appRouter } from "../server/routers.ts";
import { machines, apiKeys, machineRecipes } from "../drizzle/schema/index.ts";
import { and, eq } from "drizzle-orm";

const MACHINE_CODE = "SCRW-SIM-01";
const CONFIG_KIND = "recipe";
const hashKey = (k) => createHash("sha256").update(String(k), "utf8").digest("hex");
const line = () => console.log("─".repeat(78));
const show = (label, obj) => console.log(`${label}: ${JSON.stringify(obj)}`);

const db = await getDb();
if (!db) throw new Error("DB not connected — set owner DATABASE_URL.");

// ── 0. Resolve the pilot machine + mint a fresh mk_ key ────────────────────────
const [machine] = await db.select().from(machines).where(eq(machines.code, MACHINE_CODE)).limit(1);
if (!machine) throw new Error(`Machine ${MACHINE_CODE} not found — run scripts/pilot-provision-devices.mjs first.`);

const plaintextKey = `mk_pilot_${randomBytes(24).toString("base64url")}`;
await db.insert(apiKeys).values({
  name: `machine:${MACHINE_CODE}:configsync`,
  description: "doc56 Đ4 config-sync LIVE proof",
  keyHash: hashKey(plaintextKey),
  keyPrefix: plaintextKey.slice(0, 9),
  scopes: ["ingest:write", "equipment:read"],
  isActive: true,
  machineId: machine.id,
});
console.log(`Pilot machine ${MACHINE_CODE} (id=${machine.id}, type=${machine.machineType}) — minted fresh mk_ key.`);
line();

// ── 1. DEPLOY: seed an active recipe + write the desired* shadow (real writer) ──
// A real re-deploy archives the prior active version (uq_machine_recipes_active_code
// allows exactly ONE active row per code), so the new createRecipe lands v(n+1).
await db.update(machineRecipes)
  .set({ status: "archived", updatedAt: new Date() })
  .where(and(eq(machineRecipes.code, "SCRW-RECIPE-01"), eq(machineRecipes.status, "active")));
const payload = { torqueTarget: 12.5, torqueTolerance: 0.5, angleTarget: 720, speedRpm: 300 };
const recipe = await createRecipe({
  machineId: machine.id,
  machineType: machine.machineType,
  code: "SCRW-RECIPE-01",
  name: "Pilot siết vít M3 — 12.5 N·m",
  payload,
  status: "active",
});
await upsertDesiredConfig({
  machineId: machine.id,
  configKind: CONFIG_KIND,
  code: recipe.code,
  version: recipe.version,
  checksum: recipe.checksum,
});
console.log(`DEPLOY: recipe ${recipe.code} v${recipe.version} checksum=${recipe.checksum?.slice(0, 16)}… (active, bound to machine ${machine.id})`);
const afterDeploy = await readConfigState(machine.id, CONFIG_KIND);
show("  shadow after deploy", { desiredCode: afterDeploy?.desiredCode, desiredVersion: afterDeploy?.desiredVersion, desiredChecksum: afterDeploy?.desiredChecksum?.slice(0, 16) + "…", reportedChecksum: afterDeploy?.reportedChecksum, driftState: afterDeploy?.driftState });
line();

// ── The machine now talks to the server ONLY via its mk_ key (no session). ──────
const caller = appRouter.createCaller({});
const auth = { apiKey: plaintextKey, configKind: CONFIG_KIND };

// ── 2. CHECK: does my active config differ from what I run? ─────────────────────
const check = await caller.machineApi.checkConfigVersion({ ...auth });
show("CHECK  (checkConfigVersion)", { code: check.code, version: check.version, checksum: check.checksum?.slice(0, 16) + "…", resolvedBy: check.resolvedBy });

// ── 3. GET: pull the full payload to apply ─────────────────────────────────────
const got = await caller.machineApi.getActiveConfig({ ...auth });
show("GET    (getActiveConfig)  ", { code: got.code, version: got.version, resolvedBy: got.resolvedBy, payload: got.payload });
line();

// ── 4. ACK in-sync: machine reports it applied EXACTLY the checksum it was given ─
const ackOk = await caller.machineApi.ackConfigApplied({ ...auth, code: got.code, version: got.version, checksum: got.checksum });
show("ACK #1 (applied correct)  ", ackOk);
const afterAck = await readConfigState(machine.id, CONFIG_KIND);
show("  shadow after ACK #1", { desiredChecksum: afterAck?.desiredChecksum?.slice(0, 16) + "…", reportedChecksum: afterAck?.reportedChecksum?.slice(0, 16) + "…", driftState: afterAck?.driftState });
line();

// ── 5. ACK drift: machine reports a DIFFERENT checksum (operator changed setpoint)
const ackDrift = await caller.machineApi.ackConfigApplied({ ...auth, code: got.code, version: got.version, checksum: "deadbeef_operator_hand_edit" });
show("ACK #2 (operator diverged)", ackDrift);
const afterDrift = await readConfigState(machine.id, CONFIG_KIND);
show("  shadow after ACK #2", { desiredChecksum: afterDrift?.desiredChecksum?.slice(0, 16) + "…", reportedChecksum: afterDrift?.reportedChecksum, driftState: afterDrift?.driftState });
line();

// ── Verdict ────────────────────────────────────────────────────────────────────
// NB: jsonb does not preserve key insertion order, so compare payload VALUES
// order-independently (the checksum is the canonical order-free signature and is
// asserted separately via check.checksum === recipe.checksum).
const gotPayload = got.payload ?? {};
const payloadMatches =
  Object.keys(payload).length === Object.keys(gotPayload).length &&
  Object.keys(payload).every((k) => gotPayload[k] === payload[k]);
const pass =
  check.checksum === recipe.checksum &&
  check.resolvedBy === "machine" &&
  payloadMatches &&
  ackOk.driftState === "in_sync" &&
  ackDrift.driftState === "drift" &&
  afterDrift?.driftState === "drift";
console.log(pass
  ? "✅ CONFIG-SYNC LOOP PROVEN: deploy→check→get→ack(in_sync)→drift, shadow persisted, drift detected."
  : "❌ FAILED — see values above.");
process.exit(pass ? 0 : 1);
