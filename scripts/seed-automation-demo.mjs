// scripts/seed-automation-demo.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Automation Orchestration — V1 (activation prep) DEMO SEED.
//
// Populates a SMALL, coherent demo dataset for the new automation entities
// (migrations 0141–0150, already applied) so the new flag-gated pages show real
// data once the operator enables the flags. See:
//   docs/ECOSYSTEM/18_...FORWARD_PLAN_2026-07.md §6 Group B (V1)
//   docs/ECOSYSTEM/19_AUTOMATION_ACTIVATION_RUNBOOK_2026-07.md
//
// This script adds NO product code and NO device-control path. It only inserts
// orchestration STATE rows (zones, operation codes, shared resources, chargers,
// 3D-model registry entries, operator assignments, a couple of pending tasks).
//
// PRINCIPLES (honesty + safety):
//   • IDEMPOTENT — every insert is `ON CONFLICT DO NOTHING` on the row's unique
//     key (code/modelKey/taskKey/…), or an existence check where the table has no
//     unique index. Re-running is safe; a per-table inserted/skipped count is
//     printed.
//   • REAL anchors only — the seed references EXISTING factory/line/station/
//     machine/user/skill ids (queried at runtime). It NEVER fabricates FK ids.
//     If an anchor is missing (e.g. no robots registered), the rows that would
//     require it are SKIPPED and reported honestly — no fake robot/telemetry ids.
//   • Runtime-generated tables are LEFT EMPTY: safety_events, anomalies, model
//     rollbacks, zone/resource reservations, charging plans, collaboration
//     sessions. Those are produced by the running services, not seeded.
//
// Usage:   node scripts/seed-automation-demo.mjs
// Guard:   refuses to run unless DATABASE_URL is set.
// ─────────────────────────────────────────────────────────────────────────────
import postgres from "postgres";
import "dotenv/config";

if (!process.env.DATABASE_URL) {
  console.error("[seed-automation-demo] REFUSING TO RUN: DATABASE_URL is not set.");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL);

// Per-table tally { inserted, skipped }.
const tally = {};
function bump(table, inserted) {
  const t = (tally[table] ??= { inserted: 0, skipped: 0 });
  if (inserted) t.inserted++;
  else t.skipped++;
}
const notes = [];

// ── helper: insert-if-absent with an explicit conflict target ────────────────
// Runs `INSERT ... ON CONFLICT (<target>) DO NOTHING RETURNING id`. Returns the
// new id, or (when the row already existed) looks it up via `findSql` so callers
// that need the id for a child row still get it. `table` is only for the tally.
async function upsert(table, insertQuery, findQuery) {
  const inserted = await insertQuery;
  if (inserted.length > 0) {
    bump(table, true);
    return inserted[0].id;
  }
  bump(table, false);
  const existing = await findQuery;
  return existing.length > 0 ? existing[0].id : null;
}

async function main() {
  console.log("[seed-automation-demo] starting — idempotent demo seed for automation V1\n");

  // ═══════════════════════════════════════════════════════════════════════════
  // 0) Resolve REAL anchors (never fabricate). Pick the richest coherent chain.
  // ═══════════════════════════════════════════════════════════════════════════
  const factories = await sql`SELECT id, code, "corporateCode" FROM factories ORDER BY id`;
  if (factories.length === 0) {
    console.error("[seed-automation-demo] No factories exist — cannot anchor a demo. Aborting.");
    return;
  }
  // Prefer FAC-HN (has the deepest line/station/machine tree); else first factory.
  const factory = factories.find((f) => f.code === "FAC-HN") ?? factories[0];
  const FACTORY_ID = factory.id;
  const CORP = factory.corporateCode ?? null; // may be NULL in dev — mirror it honestly.
  console.log(`  anchor factory: id=${FACTORY_ID} code=${factory.code} corporateCode=${CORP ?? "NULL"}`);

  // A line + station under that factory (via workshop join).
  const lineRow = (await sql`
    SELECT pl.id, pl.code
    FROM production_lines pl
    JOIN workshops w ON w.id = pl."workshopId"
    WHERE w."factoryId" = ${FACTORY_ID}
    ORDER BY pl.id LIMIT 1`)[0] ?? null;
  const LINE_ID = lineRow?.id ?? null;

  const stationRow = LINE_ID
    ? (await sql`SELECT id, code FROM stations WHERE "lineId" = ${LINE_ID} ORDER BY id LIMIT 1`)[0] ?? null
    : null;
  const STATION_ID = stationRow?.id ?? null;

  // Two machines under that factory (for 3D-model registry bindings).
  const machineRows = await sql`
    SELECT m.id, m.code, m."machineType"
    FROM machines m
    JOIN stations s ON s.id = m."stationId"
    JOIN production_lines pl ON pl.id = s."lineId"
    JOIN workshops w ON w.id = pl."workshopId"
    WHERE w."factoryId" = ${FACTORY_ID}
    ORDER BY m.id LIMIT 2`;

  // Real skill ids (for operation_codes.requiredSkillIds).
  const skillRows = await sql`SELECT id, code FROM skills ORDER BY id LIMIT 4`;
  const skillIds = skillRows.map((s) => s.id);

  // Real operator user ids (for operator_assignments).
  const operatorRows = await sql`
    SELECT id, username FROM users
    WHERE role IN ('operator','maintenance') AND "isActive" = true
    ORDER BY id LIMIT 2`;

  // A shift config to attach an assignment to (optional).
  const shiftRow = (await sql`SELECT id FROM shift_configs ORDER BY id LIMIT 1`)[0] ?? null;
  const SHIFT_ID = shiftRow?.id ?? null;

  // Program projects (for A/B variants + operation→program map; optional).
  const programRows = await sql`SELECT id, name FROM program_projects ORDER BY id LIMIT 2`;

  // Robots — the FK anchor for tasks.assignedDeviceId, chargers' owners,
  // safety_events.robotId, collaboration robotDeviceId. In dev there may be NONE.
  const robotRows = await sql`SELECT id, code FROM robots ORDER BY id LIMIT 2`;
  const HAS_ROBOTS = robotRows.length > 0;
  if (!HAS_ROBOTS) {
    notes.push(
      "No robots registered — tasks are seeded as status='pending' with assignedDeviceId=NULL (safe; the allocator assigns a real robot at runtime). No robot-FK rows (charging plans / safety events / collaboration sessions) were fabricated.",
    );
  }

  console.log(
    `  anchors: line=${LINE_ID ?? "—"} station=${STATION_ID ?? "—"} machines=${machineRows.length} ` +
      `skills=[${skillIds.join(",")}] operators=${operatorRows.length} programs=${programRows.length} robots=${robotRows.length}\n`,
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // 1) ZONES — production / transit / charging / human_shared
  // ═══════════════════════════════════════════════════════════════════════════
  const zoneDefs = [
    { code: "ZONE-PROD-A", name: "Production Cell A", zoneType: "production", maxConcurrentRobots: 2, bounds: { x: 0, y: 0, w: 10, h: 6 } },
    { code: "ZONE-TRANSIT-1", name: "Transit Corridor 1", zoneType: "transit", maxConcurrentRobots: 3, bounds: { x: 10, y: 0, w: 4, h: 12 } },
    { code: "ZONE-CHARGE", name: "Charging Bay", zoneType: "charging", maxConcurrentRobots: 2, bounds: { x: 14, y: 0, w: 4, h: 4 } },
    { code: "ZONE-HUMAN-SHARED", name: "Human-Shared Assembly", zoneType: "human_shared", maxConcurrentRobots: 1, bounds: { x: 0, y: 6, w: 10, h: 6 } },
  ];
  const zoneIdByCode = {};
  for (const z of zoneDefs) {
    const id = await upsert(
      "zones",
      sql`INSERT INTO zones (code, name, "zoneType", "maxConcurrentRobots", bounds, "corporateCode", "factoryId")
          VALUES (${z.code}, ${z.name}, ${z.zoneType}, ${z.maxConcurrentRobots}, ${sql.json(z.bounds)}, ${CORP}, ${FACTORY_ID})
          ON CONFLICT (code) DO NOTHING RETURNING id`,
      sql`SELECT id FROM zones WHERE code = ${z.code}`,
    );
    zoneIdByCode[z.code] = id;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 2) OPERATION CODES — requiredCapability + requiredSkillIds + toolType + cycle
  // ═══════════════════════════════════════════════════════════════════════════
  // Use REAL skill ids where available, else an empty array (honest).
  const opDefs = [
    { code: "PICK_PLACE", description: "Pick a component and place it on the board", requiredCapability: "run_job", toolType: "gripper", estimatedCycleMs: 4500, skills: skillIds.slice(0, 1) },
    { code: "SCREW_DRIVE", description: "Drive a fastener to torque spec", requiredCapability: "run_job", toolType: "tool_changer", estimatedCycleMs: 6000, skills: skillIds.slice(0, 2) },
    { code: "INSPECT_AOI", description: "Run an AOI inspection cycle", requiredCapability: "select_recipe", toolType: "fixture", estimatedCycleMs: 8000, skills: skillIds.slice(0, 1) },
  ];
  const opIdByCode = {};
  for (const o of opDefs) {
    const id = await upsert(
      "operation_codes",
      sql`INSERT INTO operation_codes (code, description, "requiredCapability", "requiredSkillIds", "toolType", "estimatedCycleMs", scope, "corporateCode", "factoryId")
          VALUES (${o.code}, ${o.description}, ${o.requiredCapability}, ${sql.json(o.skills)}, ${o.toolType}, ${o.estimatedCycleMs}, ${"demo"}, ${CORP}, ${FACTORY_ID})
          ON CONFLICT (code) DO NOTHING RETURNING id`,
      sql`SELECT id FROM operation_codes WHERE code = ${o.code}`,
    );
    opIdByCode[o.code] = id;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 2b) OPERATION → PROGRAM MAP + A/B PROGRAM VARIANTS (only if programs exist)
  // ═══════════════════════════════════════════════════════════════════════════
  if (programRows.length > 0 && opIdByCode["PICK_PLACE"]) {
    const prog = programRows[0];
    await upsert(
      "operation_program_map",
      sql`INSERT INTO operation_program_map ("operationCodeId", "programProjectId", "deviceKind", compatible, notes, "corporateCode", "factoryId")
          VALUES (${opIdByCode["PICK_PLACE"]}, ${prog.id}, ${"scara"}, ${true}, ${"demo mapping (seed)"}, ${CORP}, ${FACTORY_ID})
          ON CONFLICT ("operationCodeId", "programProjectId", "deviceKind") DO NOTHING RETURNING id`,
      sql`SELECT id FROM operation_program_map WHERE "operationCodeId"=${opIdByCode["PICK_PLACE"]} AND "programProjectId"=${prog.id} AND "deviceKind"=${"scara"}`,
    );
    // A/B/control split on the same program.
    const variants = [
      { variant: "A", trafficSplitPct: 50, status: "active" },
      { variant: "B", trafficSplitPct: 50, status: "active" },
      { variant: "control", trafficSplitPct: 0, status: "paused" },
    ];
    for (const v of variants) {
      await upsert(
        "program_variants",
        sql`INSERT INTO program_variants ("programProjectId", variant, "trafficSplitPct", status, scope, "corporateCode", "factoryId")
            VALUES (${prog.id}, ${v.variant}, ${v.trafficSplitPct}, ${v.status}, ${"demo"}, ${CORP}, ${FACTORY_ID})
            ON CONFLICT ("programProjectId", variant) DO NOTHING RETURNING id`,
        sql`SELECT id FROM program_variants WHERE "programProjectId"=${prog.id} AND variant=${v.variant}`,
      );
    }
  } else {
    notes.push("operation_program_map / program_variants skipped — no program_projects to map (optional G2 demo).");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3) SHARED RESOURCES — gripper / jig / fixture (status available)
  // ═══════════════════════════════════════════════════════════════════════════
  const resDefs = [
    { code: "RES-GRIPPER-01", name: "Parallel Gripper 01", type: "gripper", zone: "ZONE-PROD-A" },
    { code: "RES-JIG-01", name: "Assembly Jig 01", type: "jig", zone: "ZONE-HUMAN-SHARED" },
    { code: "RES-FIXTURE-01", name: "Inspection Fixture 01", type: "fixture", zone: "ZONE-PROD-A" },
  ];
  for (const r of resDefs) {
    await upsert(
      "shared_resources",
      sql`INSERT INTO shared_resources (code, name, type, status, "locationZoneId", scope, "corporateCode", "factoryId")
          VALUES (${r.code}, ${r.name}, ${r.type}, ${"available"}, ${zoneIdByCode[r.zone] ?? null}, ${"demo"}, ${CORP}, ${FACTORY_ID})
          ON CONFLICT (code) DO NOTHING RETURNING id`,
      sql`SELECT id FROM shared_resources WHERE code = ${r.code}`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4) CHARGER STATIONS — tied to the charging zone
  // ═══════════════════════════════════════════════════════════════════════════
  const chargerDefs = [
    { code: "CHG-01", name: "Charger Bay 01", chargerType: "contact", powerWatts: 3000 },
    { code: "CHG-02", name: "Charger Bay 02", chargerType: "inductive", powerWatts: 2000 },
  ];
  for (const c of chargerDefs) {
    await upsert(
      "charger_stations",
      sql`INSERT INTO charger_stations (code, name, "locationZoneId", "chargerType", "powerWatts", status, scope, "corporateCode", "factoryId")
          VALUES (${c.code}, ${c.name}, ${zoneIdByCode["ZONE-CHARGE"] ?? null}, ${c.chargerType}, ${c.powerWatts}, ${"available"}, ${"demo"}, ${CORP}, ${FACTORY_ID})
          ON CONFLICT (code) DO NOTHING RETURNING id`,
      sql`SELECT id FROM charger_stations WHERE code = ${c.code}`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 5) EQUIPMENT 3D MODELS — REAL glTF assets, conversionStatus='ready' (doc 22 P5)
  // ═══════════════════════════════════════════════════════════════════════════
  // Bind one to a real machine (if any) + one class-level ROBOT fallback. The URIs
  // point at REAL, self-contained glTF 2.0 files shipped in client/public/models/
  // (generated by scripts/generate-twin-gltf.mts via the urdfToGltf emitter). Vite
  // serves client/public at the web root, so /models/*.gltf is fetchable with no
  // server change and no flag. conversionStatus='ready' → the FE renders the mesh.
  const modelDefs = [];
  if (machineRows[0]) {
    modelDefs.push({
      modelKey: `MODEL-MACHINE-${machineRows[0].id}`,
      machineId: machineRows[0].id,
      equipmentClass: machineRows[0].machineType ?? null,
      modelUri: "/models/aoi-machine.gltf",
      notes: `REAL glTF for machine ${machineRows[0].code} — parametric AOI inspection machine (urdfToGltf).`,
    });
  }
  // Class-level fallback (used by resolve when a specific robot has no model).
  modelDefs.push({
    modelKey: "MODEL-CLASS-ROBOT",
    machineId: null,
    equipmentClass: "ROBOT",
    modelUri: "/models/robot-arm.gltf",
    notes: "REAL class-level glTF for ROBOT — 3-DOF articulated arm (urdfToGltf).",
  });
  for (const m of modelDefs) {
    // DO UPDATE (not DO NOTHING) so a re-seed heals rows still holding old placeholder
    // URIs — the modelKey is stable so this is idempotent.
    await upsert(
      "equipment_3d_models",
      sql`INSERT INTO equipment_3d_models ("modelKey", "machineId", "equipmentClass", "modelUri", "modelKind", "sourceFormat", "conversionStatus", status, scope, notes, "corporateCode", "factoryId")
          VALUES (${m.modelKey}, ${m.machineId}, ${m.equipmentClass}, ${m.modelUri}, ${"gltf"}, ${"urdf"}, ${"ready"}, ${"active"}, ${"demo"}, ${m.notes}, ${CORP}, ${FACTORY_ID})
          ON CONFLICT ("modelKey") DO UPDATE SET
            "modelUri" = EXCLUDED."modelUri",
            "sourceFormat" = EXCLUDED."sourceFormat",
            "conversionStatus" = EXCLUDED."conversionStatus",
            notes = EXCLUDED.notes,
            "updatedAt" = now()
          RETURNING id`,
      sql`SELECT id FROM equipment_3d_models WHERE "modelKey" = ${m.modelKey}`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 6) OPERATOR ASSIGNMENTS — real user + line/station (existence-checked; no uq idx)
  // ═══════════════════════════════════════════════════════════════════════════
  if (operatorRows.length > 0 && LINE_ID) {
    const now = new Date();
    const end = new Date(now.getTime() + 8 * 3600 * 1000);
    const assignDefs = operatorRows.slice(0, 2).map((op, i) => ({
      operatorId: op.id,
      skillLevel: i === 0 ? "qualified" : "trainee",
      status: i === 0 ? "active" : "planned",
    }));
    for (const a of assignDefs) {
      // No unique index on operator_assignments → existence check on the natural key.
      const existing = await sql`
        SELECT id FROM operator_assignments
        WHERE "operatorId" = ${a.operatorId} AND "lineId" = ${LINE_ID}
          AND "stationId" IS NOT DISTINCT FROM ${STATION_ID}
          AND "shiftConfigId" IS NOT DISTINCT FROM ${SHIFT_ID}`;
      if (existing.length > 0) {
        bump("operator_assignments", false);
        continue;
      }
      await sql`
        INSERT INTO operator_assignments ("operatorId", "lineId", "stationId", "shiftConfigId", "skillLevel", role, status, "assignedStart", "assignedEnd", scope, "corporateCode", "factoryId")
        VALUES (${a.operatorId}, ${LINE_ID}, ${STATION_ID}, ${SHIFT_ID}, ${a.skillLevel}, ${"human"}, ${a.status}, ${now}, ${end}, ${"demo"}, ${CORP}, ${FACTORY_ID})`;
      bump("operator_assignments", true);
    }
  } else {
    notes.push("operator_assignments skipped — no operator users and/or no production line to anchor to.");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 7) TASKS — a couple of PENDING tasks so the Fleet queue shows real rows.
  //    assignedDeviceId is LEFT NULL (pending) — no robot is fabricated. The
  //    allocator assigns a real robot at runtime once robots exist + flag is on.
  // ═══════════════════════════════════════════════════════════════════════════
  const taskDefs = [
    { taskKey: "DEMO-TASK-PICK-1", requiredCapability: "run_job", priority: 3, locationStart: "ZONE-TRANSIT-1", locationEnd: "ZONE-PROD-A", estimatedDurationMs: 4500, payload: { operationCode: "PICK_PLACE", demo: true } },
    { taskKey: "DEMO-TASK-INSPECT-1", requiredCapability: "select_recipe", priority: 4, locationStart: "ZONE-PROD-A", locationEnd: "ZONE-PROD-A", estimatedDurationMs: 8000, payload: { operationCode: "INSPECT_AOI", demo: true } },
  ];
  for (const t of taskDefs) {
    await upsert(
      "tasks",
      sql`INSERT INTO tasks ("taskKey", "requiredCapability", priority, status, "locationStart", "locationEnd", "estimatedDurationMs", payload, "corporateCode", "factoryId")
          VALUES (${t.taskKey}, ${t.requiredCapability}, ${t.priority}, ${"pending"}, ${t.locationStart}, ${t.locationEnd}, ${t.estimatedDurationMs}, ${sql.json(t.payload)}, ${CORP}, ${FACTORY_ID})
          ON CONFLICT ("taskKey") DO NOTHING RETURNING id`,
      sql`SELECT id FROM tasks WHERE "taskKey" = ${t.taskKey}`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 8) INTENTIONALLY LEFT EMPTY (runtime-generated — DO NOT fabricate):
  //    safety_events, collaboration_sessions, zone_reservations,
  //    resource_reservations, battery_charging_plans, robot anomalies,
  //    model rollbacks, device_types (seeded from capabilityModel by the E1
  //    service on flag-enable), alarm_taxonomy / change requests.
  // ═══════════════════════════════════════════════════════════════════════════
  notes.push(
    "Left EMPTY on purpose (runtime-generated): safety_events, collaboration_sessions, zone_reservations, resource_reservations, battery_charging_plans, robot anomalies, model rollbacks.",
  );
  notes.push(
    "device_types / alarm_taxonomy NOT seeded here — E1 seeds device_types from capabilityModel and ships an ISA-18.2 taxonomy via its own service/CI on EQ_GOVERN enable (see runbook). Seeding them by hand would duplicate that.",
  );

  // ── report ─────────────────────────────────────────────────────────────────
  console.log("\n[seed-automation-demo] per-table result (inserted / skipped-existing):");
  const order = ["zones", "operation_codes", "operation_program_map", "program_variants", "shared_resources", "charger_stations", "equipment_3d_models", "operator_assignments", "tasks"];
  for (const t of order) {
    const c = tally[t] ?? { inserted: 0, skipped: 0 };
    console.log(`  ${t.padEnd(24)} inserted=${c.inserted}  skipped=${c.skipped}`);
  }
  if (notes.length) {
    console.log("\n[seed-automation-demo] notes / honest seams:");
    for (const n of notes) console.log("  • " + n);
  }
  console.log("\n[seed-automation-demo] done.");
}

try {
  await main();
} catch (e) {
  console.error("[seed-automation-demo] FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
