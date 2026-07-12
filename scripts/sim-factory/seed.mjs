// scripts/sim-factory/seed.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Doc 40 Wave 3B §13.4 — SEED "NHÀ MÁY ẢO" (idempotent) vào DB _sim.
//
// Dựng: 1 nhà máy ảo → 1 xưởng → 3 line × 12 máy đủ chủng loại (AOI/AVI/SPI/ICT/FCT/
// conveyor-OPCUA/power-OPCUA/assembly-Modbus/screwdrive-S7/packaging-EthernetIP/robot/AGV),
// + station cho mỗi máy, + factory_layout 2D + machine_positions (grid theo line),
// + shift_configs (3 ca), + oee_targets (mỗi line), + device_adapters/device_tags trỏ
// tới endpoint simulator (OPC-UA 4840-4842 / Modbus 5020), + commissioning cho adapter
// live, + 1 interlock rule (telemetry_tag ng_rate) cho scenario ng-spike.
//
// HONEST: KHÔNG bịa telemetry/inspection — các bảng đó do luồng ingest THẬT sinh ra
// khi simulator + server chạy. Seed chỉ dựng CẤU HÌNH tĩnh. Mọi bước idempotent
// (ON CONFLICT hoặc existence-check); in tally inserted/skipped.
//
// AN TOÀN D10: chỉ chạy khi DATABASE_URL chứa 'sim' HOẶC SIM_SEED_CONFIRM=1 (xem lib/db).
//
// Chạy:  npm run sim:factory        (nạp .env.sim tự động)
// ─────────────────────────────────────────────────────────────────────────────
import "./lib/env.mjs";
import { makeSql, assertSimWritable } from "./lib/db.mjs";
import { buildTopology, SHIFTS, OEE_TARGET, INTERLOCK_RULE, machineCode } from "./topology.mjs";

assertSimWritable();
const sql = makeSql();

// ── tally ─────────────────────────────────────────────────────────────────────
const tally = {};
const bump = (t, inserted) => {
  const e = (tally[t] ??= { inserted: 0, skipped: 0 });
  inserted ? e.inserted++ : e.skipped++;
};

/** INSERT nếu chưa có (existence-check). Trả id (mới hoặc cũ). */
async function ensure(table, findRows, insertFn) {
  if (findRows.length > 0) {
    bump(table, false);
    return findRows[0].id;
  }
  const [row] = await insertFn();
  bump(table, true);
  return row.id;
}

async function resolveUserId() {
  const admins = await sql`SELECT id FROM users WHERE role = 'admin' AND "isActive" = true ORDER BY id LIMIT 1`;
  if (admins.length > 0) return admins[0].id;
  const any = await sql`SELECT id FROM users ORDER BY id LIMIT 1`;
  return any.length > 0 ? any[0].id : null;
}

async function main() {
  console.log("[sim/seed] bắt đầu — dựng nhà máy ảo (idempotent)\n");
  const topo = buildTopology();
  const userId = await resolveUserId();
  if (!userId) {
    console.warn("[sim/seed] CẢNH BÁO: không có user nào — oee_targets/interlock/commissioning (cần setBy/approvedBy) sẽ bị BỎ QUA.");
  }

  // 1) Factory ─────────────────────────────────────────────────────────────
  const factoryId = await ensure(
    "factories",
    await sql`SELECT id FROM factories WHERE code = ${topo.factory.code}`,
    () => sql`INSERT INTO factories (code, name, description, region, country, timezone, "isActive")
      VALUES (${topo.factory.code}, ${topo.factory.name}, 'Nhà máy mô phỏng cho đánh giá toàn hệ (doc 40 §13.4)',
              'SIM', 'VN', 'Asia/Ho_Chi_Minh', true) RETURNING id`,
  );

  // 2) Workshop ────────────────────────────────────────────────────────────
  const workshopId = await ensure(
    "workshops",
    await sql`SELECT id FROM workshops WHERE "factoryId" = ${factoryId} AND code = ${topo.workshop.code} AND "isActive" = true`,
    () => sql`INSERT INTO workshops ("factoryId", code, name, "isActive")
      VALUES (${factoryId}, ${topo.workshop.code}, ${topo.workshop.name}, true) RETURNING id`,
  );

  // 3) factory_layout (WORKSHOP-level) cho machine_positions ────────────────
  const layoutName = "SIM Workshop Layout";
  const layoutId = await ensure(
    "factory_layouts",
    await sql`SELECT id FROM factory_layouts WHERE "workshopId" = ${workshopId} AND name = ${layoutName}`,
    () => sql`INSERT INTO factory_layouts ("workshopId", "layoutLevel", name, "layoutType", width, height, "isActive")
      VALUES (${workshopId}, 'WORKSHOP', ${layoutName}, '2D', 1280, 820, true) RETURNING id`,
  );

  // 4) Lines + Stations + Machines + Positions + Adapters + Tags ────────────
  const machineIdByCode = {}; // "SIM-L1-CONVEYOR" -> id
  const adapterIdByCode = {};

  for (const line of topo.lines) {
    const lineId = await ensure(
      "production_lines",
      await sql`SELECT id FROM production_lines WHERE "workshopId" = ${workshopId} AND code = ${line.code} AND "isActive" = true`,
      () => sql`INSERT INTO production_lines ("workshopId", code, name, "capacityPerHour", "isActive")
        VALUES (${workshopId}, ${line.code}, ${line.name}, 600, true) RETURNING id`,
    );
    line._id = lineId;

    for (const m of line.machines) {
      // Station (1 per machine)
      const stCode = `${m.code}-ST`;
      const stationId = await ensure(
        "stations",
        await sql`SELECT id FROM stations WHERE "lineId" = ${lineId} AND code = ${stCode} AND "isActive" = true`,
        () => sql`INSERT INTO stations ("lineId", code, name, "orderIndex", "isActive")
          VALUES (${lineId}, ${stCode}, ${m.name + " Station"}, ${m.orderIndex}, true) RETURNING id`,
      );

      // Machine
      const machineId = await ensure(
        "machines",
        await sql`SELECT id FROM machines WHERE code = ${m.code} AND "isActive" = true`,
        () => sql`INSERT INTO machines
          ("stationId", code, name, "machineType", model, manufacturer, "apiKey",
           "registrationStatus", "lifecycleStatus", "operationStatus", "isActive")
          VALUES (${stationId}, ${m.code}, ${m.name}, ${m.type}, ${"SIM-" + m.type}, 'ST4I-SIM',
                  ${m.apiKey}, 'approved', 'active',
                  ${m.backbone ? "running" : "stopped"}, true) RETURNING id`,
      );
      machineIdByCode[m.code] = machineId;

      // Machine position (grid: line = row, role = column)
      const posX = 60 + m.orderIndex * 95;
      const posY = 120 + (line.lineNo - 1) * 230;
      await ensure(
        "machine_positions",
        await sql`SELECT id FROM machine_positions WHERE "layoutId" = ${layoutId} AND "machineId" = ${machineId}`,
        () => sql`INSERT INTO machine_positions ("layoutId", "machineId", "positionX", "positionY", width, height)
          VALUES (${layoutId}, ${machineId}, ${posX}, ${posY}, 80, 80) RETURNING id`,
      );

      // Device adapter + tags
      if (m.adapter) {
        const a = m.adapter;
        // connectionOptions.unitId cho modbus (driver setID); giữ JSON nhỏ gọn.
        const connOpts = a.transport === "modbus" ? { unitId: line.modbusUnitId } : null;
        const adapterId = await ensure(
          "device_adapters",
          await sql`SELECT id FROM device_adapters WHERE code = ${a.code}`,
          () => sql`INSERT INTO device_adapters
            ("machineId", code, name, protocol, endpoint, "connectionOptions", "pollIntervalMs",
             status, "isEnabled", "createdBy")
            VALUES (${machineId}, ${a.code}, ${m.name + " " + a.protocol.toUpperCase()}, ${a.protocol},
                    ${a.endpoint}, ${connOpts ? sql.json(connOpts) : null}, ${a.pollIntervalMs},
                    'disabled', true, ${userId}) RETURNING id`,
        );
        adapterIdByCode[a.code] = { id: adapterId, live: a.live };

        for (const t of a.tags) {
          await ensure(
            "device_tags",
            await sql`SELECT id FROM device_tags WHERE "adapterId" = ${adapterId} AND "tagKey" = ${t.key}`,
            () => sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", unit, writable, "isEnabled")
              VALUES (${adapterId}, ${t.key}, ${t.addr}, ${t.dataType}, ${t.unit ?? null}, false, true) RETURNING id`,
          );
        }
      }
    }

    // oee_targets cho line (machineId null) ─────────────────────────────────
    if (userId) {
      await ensure(
        "oee_targets",
        await sql`SELECT id FROM oee_targets WHERE "lineId" = ${lineId} AND "machineId" IS NULL AND "isActive" = true`,
        () => sql`INSERT INTO oee_targets
          ("lineId", "targetOEE", "targetAvailability", "targetPerformance", "targetQuality",
           "alertThreshold", "criticalThreshold", "isActive", "setBy", notes)
          VALUES (${lineId}, ${OEE_TARGET.targetOEE}, ${OEE_TARGET.targetAvailability},
                  ${OEE_TARGET.targetPerformance}, ${OEE_TARGET.targetQuality},
                  ${OEE_TARGET.alertThreshold}, ${OEE_TARGET.criticalThreshold}, true, ${userId},
                  'SIM OEE target (doc 40 §13.4)') RETURNING id`,
      );
    }
  }

  // 5) shift_configs (factory-scoped) ───────────────────────────────────────
  for (const s of SHIFTS) {
    await ensure(
      "shift_configs",
      await sql`SELECT id FROM shift_configs WHERE "factoryId" = ${factoryId} AND code = ${s.code}`,
      () => sql`INSERT INTO shift_configs ("factoryId", name, code, "startHour", "startMinute", "endHour", "endMinute", "isActive", "orderIndex")
        VALUES (${factoryId}, ${s.name}, ${s.code}, ${s.startHour}, ${s.startMinute}, ${s.endHour}, ${s.endMinute}, true, ${s.orderIndex}) RETURNING id`,
    );
  }

  // 6) commissioning_records cho adapter LIVE (để real-write path armed) ─────
  if (userId) {
    for (const [code, info] of Object.entries(adapterIdByCode)) {
      if (!info.live) continue;
      await ensure(
        "commissioning_records",
        await sql`SELECT id FROM commissioning_records WHERE "adapterId" = ${info.id} AND status = 'active'`,
        () => sql`INSERT INTO commissioning_records ("adapterId", status, "fatReference", "signedBy", notes)
          VALUES (${info.id}, 'active', ${"SIM-FAT-" + code}, ${userId}, 'SIM auto-commissioning (đánh giá, không phải FAT thật)') RETURNING id`,
      );
    }
  }

  // 7) interlock rule cho scenario ng-spike ─────────────────────────────────
  if (userId) {
    const r = INTERLOCK_RULE;
    const targetLine = topo.lines.find((l) => l.lineNo === r.lineNo);
    const targetMachineId = machineIdByCode[machineCode(targetLine.code, r.machineRole)];
    if (targetMachineId) {
      await ensure(
        "interlock_rules",
        await sql`SELECT id FROM interlock_rules WHERE name = ${r.name}`,
        () => sql`INSERT INTO interlock_rules
          (name, description, scope, "lineId", "machineId", "sourceType", "sourceKey",
           "comparisonOperator", threshold, "windowSeconds", action, "requiresHumanConfirm",
           enabled, "approvedBy", "approvedAt", "cooldownSeconds", "createdBy")
          VALUES (${r.name}, 'SIM interlock (alert-only) cho scenario ng-spike', ${r.scope},
                  ${targetLine._id}, ${targetMachineId}, ${r.sourceType}, ${r.sourceKey},
                  ${r.comparisonOperator}, ${r.threshold}, ${r.windowSeconds}, ${r.action},
                  ${r.requiresHumanConfirm}, true, ${userId}, now(), ${r.cooldownSeconds}, ${userId}) RETURNING id`,
      );
    }
  }

  // ── báo cáo ─────────────────────────────────────────────────────────────
  console.log("\n[sim/seed] HOÀN TẤT. Tally (inserted / skipped):");
  for (const [t, e] of Object.entries(tally)) {
    console.log(`  ${t.padEnd(22)} +${e.inserted}  ~${e.skipped}`);
  }
  console.log(
    `\n  factory=${factoryId} workshop=${workshopId} layout=${layoutId}\n` +
      `  Máy: ${Object.keys(machineIdByCode).length}  Adapter: ${Object.keys(adapterIdByCode).length}\n` +
      "  Kế tiếp: chạy simulator (node scripts/sim-factory/simulator.mjs) + server (.env.sim), rồi npm run sim:scenario.\n",
  );
}

main()
  .then(() => sql.end())
  .catch((err) => {
    console.error("[sim/seed] LỖI:", err);
    sql.end();
    process.exit(1);
  });
