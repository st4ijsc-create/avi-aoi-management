// scripts/seed-test-data.mjs — Doc 40: seed dữ liệu TEST cho các chức năng mới W0-W5b.
// Idempotent (ON CONFLICT / existence check). Nhắm DATABASE_URL thật.
// Chạy:  node scripts/seed-test-data.mjs   (sau khi đã sim:factory dựng topology)
import 'dotenv/config';
import postgres from 'postgres';
import { readFileSync } from 'node:fs';

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const log = (...a) => console.log('[seed-test]', ...a);
const now = new Date();
const daysAgo = (d) => new Date(now.getTime() - d * 864e5);
const hoursAgo = (h) => new Date(now.getTime() - h * 36e5);
const minsAgo = (m) => new Date(now.getTime() - m * 6e4);

// ── Trích DEFAULT_ROLE_PERMISSIONS thật từ permissionsRouter.ts (khỏi copy tay) ──
function extractRolePerms(role) {
  const src = readFileSync('server/routers/permissionsRouter.ts', 'utf8');
  const start = src.indexOf(`\n  ${role}: [`);
  if (start < 0) return [];
  const from = src.indexOf('[', start);
  let depth = 0, i = from;
  for (; i < src.length; i++) { if (src[i] === '[') depth++; else if (src[i] === ']') { depth--; if (depth === 0) break; } }
  const body = src.slice(from + 1, i);
  // body = danh sách object literal (key không quote) — eval an toàn (dữ liệu tĩnh của repo).
  // eslint-disable-next-line no-new-func
  return Function(`"use strict"; return ([${body}])`)();
}

async function ensureUser(username, role, name) {
  const bcrypt = await import('bcryptjs');
  // doc 54 fix — 2FA lockout: seed users had two_factor_enabled=true but
  // two_factor_secret=null → login prompts 2FA with NO valid code → locked out.
  // Generate a real TOTP secret and store it (idempotent: only backfill when null,
  // so a pre-existing secret e.g. engineer1's is preserved). `print-otp.mjs <user>`
  // then works for every seeded persona.
  const speakeasy = (await import('speakeasy')).default;
  const newSecret = speakeasy.generateSecret({ length: 20 }).base32;
  const [existing] = await sql`SELECT id FROM users WHERE username=${username}`;
  let id;
  if (existing) {
    id = existing.id;
    await sql`UPDATE users SET role=${role}, "isActive"=true, two_factor_enabled=true,
      two_factor_secret = COALESCE(two_factor_secret, ${newSecret}) WHERE id=${id}`;
  } else {
    const hash = await bcrypt.default.hash('Test@1234', 10);
    const [row] = await sql`INSERT INTO users ("openId", username, "passwordHash", name, role, "isActive", two_factor_enabled, two_factor_secret, "loginMethod")
      VALUES (${'seed-' + username}, ${username}, ${hash}, ${name}, ${role}, true, true, ${newSecret}, 'password') RETURNING id`;
    id = row.id;
  }
  // permissions từ template thật
  const perms = extractRolePerms(role);
  for (const p of perms) {
    await sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete", "canExport")
      VALUES (${id}, ${p.category}, ${p.moduleName}, ${!!p.canView}, ${!!p.canCreate}, ${!!p.canEdit}, ${!!p.canDelete}, ${!!p.canExport})
      ON CONFLICT ("userId", "moduleName") DO UPDATE SET
        "canView"=EXCLUDED."canView", "canCreate"=EXCLUDED."canCreate", "canEdit"=EXCLUDED."canEdit",
        "canDelete"=EXCLUDED."canDelete", "canExport"=EXCLUDED."canExport"`;
  }
  return { id, perms: perms.length };
}

try {
  // ── IDs từ topology đã seed ──
  const [fac] = await sql`SELECT id FROM factories WHERE code='SIM-FAC' ORDER BY id LIMIT 1`;
  const [ws] = await sql`SELECT id FROM workshops WHERE code='SIM-WS' ORDER BY id LIMIT 1`;
  const lines = await sql`SELECT id, code FROM production_lines ORDER BY id`;
  const machines = await sql`SELECT id, code, "machineType", "stationId" FROM machines ORDER BY id`;
  if (!fac || machines.length === 0) { console.error('Chưa có topology — chạy sim:factory trước.'); process.exit(1); }
  const factoryId = fac.id, workshopId = ws.id;
  const lineOf = new Map(); // stationId->lineId (qua station)
  const stations = await sql`SELECT id, "lineId" FROM stations`;
  for (const s of stations) lineOf.set(s.id, s.lineId);
  const [admin] = await sql`SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1`;
  const adminId = admin.id;
  log(`topology: factory=${factoryId} lines=${lines.length} machines=${machines.length}`);

  // ── 1. Users test ──
  const users = {};
  for (const [u, r, n] of [
    ['operator1', 'operator', 'Chị Lan (Operator)'],
    ['supervisor1', 'supervisor', 'Chị Hương (Quản đốc)'],
    ['maint1', 'maintenance', 'Anh Hùng (Bảo trì)'],
    ['engineer1', 'engineer', 'Anh Minh (Kỹ sư TĐH)'],
  ]) { const res = await ensureUser(u, r, n); users[r] = res.id; log(`user ${u}/${r} (${res.perms} perms) [mật khẩu: Test@1234, 2FA on]`); }

  // ── 2. OEE metrics + daily_statistics (7 ngày, mỗi máy) → OEE dashboard + war-room ──
  await sql`DELETE FROM oee_metrics WHERE "calculatedBy"='SEED'`; // idempotent re-seed (timestamp đổi mỗi lần chạy)
  await sql`DELETE FROM machine_health_history WHERE notes='SEED'`;
  let oeeN = 0, dsN = 0;
  for (const m of machines) {
    for (let d = 0; d < 7; d++) {
      const day = daysAgo(d); day.setHours(0, 0, 0, 0);
      const total = 800 + Math.floor(Math.random() * 400);
      const ng = Math.floor(total * (0.01 + Math.random() * 0.04));
      const good = total - ng;
      const avail = 0.80 + Math.random() * 0.18, perf = 0.75 + Math.random() * 0.2, qual = good / total;
      const [ex] = await sql`SELECT id FROM daily_statistics WHERE "machineId"=${m.id} AND date=${day}`;
      if (!ex) { await sql`INSERT INTO daily_statistics ("machineId","factoryId","workshopId",date,"totalCount","okCount","ngCount","ntfCount","yieldRate","avgCycleTime")
        VALUES (${m.id},${factoryId},${workshopId},${day},${total},${good},${ng},0,${(qual*100).toFixed(2)},${(20+Math.random()*10).toFixed(2)})`; dsN++; }
      const ts = daysAgo(d);
      const [exo] = await sql`SELECT id FROM oee_metrics WHERE "machineId"=${m.id} AND timestamp=${ts} AND "periodType"='DAY'`;
      if (!exo) { await sql`INSERT INTO oee_metrics ("machineId","machineCode",timestamp,"periodType",availability,performance,quality,oee,"plannedTime","runTime","idealCycleTime","totalCount","goodCount","rejectCount","calculatedBy")
        VALUES (${m.id},${m.code},${ts},'DAY',${Math.round(avail*10000)},${Math.round(perf*10000)},${Math.round(qual*10000)},${Math.round(avail*perf*qual*10000)},480,${Math.round(480*avail)},25,${total},${good},${ng},'SEED')`; oeeN++; }
    }
  }
  log(`oee_metrics +${oeeN}, daily_statistics +${dsN}`);

  // ── 2b. machine_status_logs (online/offline 24h) → Availability/OEE có SỐ (không null) ──
  await sql`DELETE FROM machine_status_logs WHERE "ipAddress"='SEED'`;
  let slN = 0;
  for (const m of machines) {
    let t = now.getTime() - 24 * 36e5;
    const events = [['online', t]];
    for (let k = 0; k < 4; k++) { t += (3 + Math.random() * 3) * 36e5; if (t < now.getTime()) events.push([Math.random() < 0.25 ? 'offline' : 'online', t]); }
    for (const [st, ts] of events) { await sql`INSERT INTO machine_status_logs ("machineId",status,"ipAddress",timestamp) VALUES (${m.id},${st},'SEED',${new Date(ts).toISOString()})`; slN++; }
  }
  log(`machine_status_logs +${slN}`);

  // ── 3. machine_health_history (mỗi máy, vài mốc) → cockpit health + Command View pdmRisk ──
  let hN = 0;
  for (const m of machines) {
    for (let d = 0; d < 3; d++) {
      const ts = hoursAgo(d * 8);
      const health = 55 + Math.floor(Math.random() * 44); // 55-99
      const risk = (100 - health) / 100;
      const [ex] = await sql`SELECT id FROM machine_health_history WHERE "machineId"=${m.id} AND timestamp=${ts}`;
      if (!ex) { await sql`INSERT INTO machine_health_history ("machineId","machineCode",timestamp,"healthScore","oeeScore","uptimeScore","errorRateScore","cycleTimeScore","predictedFailureRisk","maintenanceUrgency","calculationMethod",notes)
        VALUES (${m.id},${m.code},${ts},${health},${health-5},${health+3},${health-2},${health},${Math.round(risk*100)},${risk>0.4?'HIGH':risk>0.25?'MEDIUM':'LOW'},'WEIGHTED','SEED')`; hN++; }
    }
  }
  log(`machine_health_history +${hN}`);

  // ── 4. sensor readings (vibration/current/temp series, vài máy) → sensor trend cockpit ──
  await sql`DELETE FROM machine_sensor_readings WHERE source='SEED'`; // idempotent re-seed
  let sN = 0;
  for (const m of machines.slice(0, 8)) {
    for (const [type, base, unit] of [['vibration', 2.5, 'mm/s'], ['current', 6.0, 'A'], ['temperature', 45, '°C']]) {
      for (let k = 0; k < 24; k++) {
        const ts = hoursAgo(24 - k);
        const val = base + Math.sin(k / 3) * base * 0.15 + (Math.random() - 0.5) * base * 0.1 + (k > 18 ? (k - 18) * base * 0.05 : 0);
        await sql`INSERT INTO machine_sensor_readings ("machineId","sensorType",value,unit,timestamp,source)
          VALUES (${m.id},${type},${val.toFixed(3)},${unit},${ts},'SEED')`; sN++;
      }
    }
  }
  log(`machine_sensor_readings +${sN}`);

  // ── 5. downtime_events (một số máy) → cockpit Bảo trì + war-room top downtime ──
  await sql`DELETE FROM downtime_events WHERE reason IN ('Kẹt băng tải','Đổi sản phẩm','Hết linh kiện','NG vượt ngưỡng','Đang dừng — chờ bảo trì')`;
  let dtN = 0;
  const reasons = [['breakdown', 'Kẹt băng tải'], ['changeover', 'Đổi sản phẩm'], ['unplanned', 'Hết linh kiện'], ['unplanned', 'NG vượt ngưỡng']];
  for (const m of machines.slice(0, 12)) {
    const r = reasons[Math.floor(Math.random() * reasons.length)];
    const start = minsAgo(60 + Math.floor(Math.random() * 400));
    const dur = 8 + Math.floor(Math.random() * 40);
    const end = new Date(start.getTime() + dur * 6e4);
    await sql`INSERT INTO downtime_events ("machineId","machineCode",category,reason,"startTime","endTime",duration,"detectionMethod")
      VALUES (${m.id},${m.code},${r[0]},${r[1]},${start},${end},${dur},'MANUAL')`; dtN++;
  }
  // 2 downtime ĐANG diễn ra
  for (const m of machines.slice(0, 2)) {
    await sql`INSERT INTO downtime_events ("machineId","machineCode",category,reason,"startTime","detectionMethod")
      VALUES (${m.id},${m.code},'breakdown','Đang dừng — chờ bảo trì',${minsAgo(15)},'AUTO')`; dtN++;
  }
  log(`downtime_events +${dtN}`);

  // ── 6. andon_events (vài cái đang mở) → Command View issues rail ──
  await sql`DELETE FROM andon_events WHERE title LIKE 'Andon %'`; // idempotent re-seed
  let aN = 0;
  for (let i = 0; i < 4; i++) {
    const m = machines[i];
    const st = i === 0 ? 'red' : i === 1 ? 'yellow' : 'call';
    await sql`INSERT INTO andon_events (state,reason,status,"lineId","machineId",title,message,"raisedBy","raisedAt")
      VALUES (${st},${['quality','maintenance','material','setup'][i]},'raised',${lineOf.get(m.stationId) ?? null},${m.id},${'Andon '+m.code},${'Cần hỗ trợ tại '+m.code},${adminId},${minsAgo(5+i*7)})`; aN++;
  }
  log(`andon_events +${aN}`);

  // ── 7. Spare parts + maintenance work orders + parts + PM schedules → CMMS ──
  const spareParts = [
    ['BELT-001', 'Dây curoa conveyor', 'Cơ khí', 12, 5, 'cái', 45],
    ['NOZ-220', 'Vòi hút mounter 220', 'Vật tư máy', 3, 8, 'cái', 120],
    ['FILT-A', 'Lọc khí reflow', 'Tiêu hao', 20, 10, 'cái', 15],
    ['SQGE-01', 'Dao gạt kem hàn', 'Vật tư máy', 2, 4, 'cái', 85],
  ];
  let spN = 0;
  for (const [code, name, cat, qty, reorder, unit, cost] of spareParts) {
    await sql`INSERT INTO spare_parts_inventory ("partCode","partName",category,"quantityOnHand","reorderLevel","reorderQuantity",unit,"unitCost")
      VALUES (${code},${name},${cat},${qty},${reorder},10,${unit},${cost})
      ON CONFLICT DO NOTHING`; spN++;
  }
  let woN = 0, wopN = 0, pmN = 0;
  for (let i = 0; i < machines.length; i += 4) {
    const m = machines[i];
    const type = ['PREVENTIVE', 'CORRECTIVE', 'PREDICTIVE', 'BREAKDOWN'][i / 4 % 4];
    const status = i % 3 === 0 ? 'COMPLETED' : i % 3 === 1 ? 'IN_PROGRESS' : 'OPEN';
    const opened = daysAgo(2 + (i % 5));
    const won = `WO-${String(1000 + i)}`;
    const [ex] = await sql`SELECT id FROM maintenance_work_orders WHERE "workOrderNumber"=${won}`;
    if (!ex) {
      const closed = status === 'COMPLETED' ? new Date(opened.getTime() + (2 + Math.random() * 6) * 36e5) : null;
      const repairStart = status !== 'OPEN' ? new Date(opened.getTime() + 36e5) : null;
      const dtMin = closed ? Math.round((closed - repairStart) / 6e4) : null;
      const [wo] = await sql`INSERT INTO maintenance_work_orders ("workOrderNumber","machineId","machineCode",type,status,trigger,priority,title,description,"assignedTo","openedAt","repairStartedAt","closedAt","downtimeMinutes","resolutionNotes","factoryId")
        VALUES (${won},${m.id},${m.code},${type},${status},'MANUAL',${(i%3)+1},${'Bảo trì '+m.code},${'Công việc '+type+' cho '+m.code},${users.maintenance},${opened},${repairStart},${closed},${dtMin},${closed?'Đã thay thế linh kiện, chạy lại OK':null},${factoryId}) RETURNING id`;
      woN++;
      if (status === 'COMPLETED') {
        await sql`INSERT INTO work_order_parts ("workOrderId","partCode","quantityUsed","unitCost","consumedBy","consumedAt")
          VALUES (${wo.id},'BELT-001',1,45,${users.maintenance},${closed})`; wopN++;
      }
    }
    // PM schedule
    const [exp] = await sql`SELECT id FROM maintenance_schedules WHERE "machineId"=${m.id} AND "taskName"=${'PM định kỳ '+m.code}`;
    if (!exp) { await sql`INSERT INTO maintenance_schedules ("machineId","machineCode","scheduleType","taskName",description,"intervalDays","nextDueAt","isActive","factoryId")
      VALUES (${m.id},${m.code},'TIME_BASED',${'PM định kỳ '+m.code},'Bảo dưỡng phòng ngừa 30 ngày',30,${daysAgo(-7)},true,${factoryId})`; pmN++; }
  }
  log(`spare_parts +${spN}, work_orders +${woN}, wo_parts +${wopN}, pm_schedules +${pmN}`);

  // ── 8. robots (bảng riêng — RobotCockpit/Command Console) + commissioning để dispatch chạy ──
  let rN = 0, rcN = 0;
  for (const [code, name, vendor, model, ep] of [
    ['ROB-SIM-01', 'Robot mô phỏng (SIM)', 'sim', 'sim-arm', '127.0.0.1:30001'],
    ['ROB-UR-01', 'UR cobot (test)', 'ur', 'ur5e', '127.0.0.1:30002'],
    ['ROB-FANUC-01', 'Fanuc R-30iB', 'fanuc', 'R-30iB', '127.0.0.1:16001'],
  ]) {
    let [rb] = await sql`SELECT id FROM robots WHERE code=${code}`;
    if (!rb) { [rb] = await sql`INSERT INTO robots (code,name,vendor,model,endpoint,"isEnabled",status,"lineId") VALUES (${code},${name},${vendor},${model},${ep},true,'online',${lines[0].id}) RETURNING id`; rN++; }
    const [ex] = await sql`SELECT id FROM robot_commissioning_records WHERE "robotId"=${rb.id} AND status='active'`;
    if (!ex) { await sql`INSERT INTO robot_commissioning_records ("robotId",status,"fatReference","signedBy","signedAt",notes)
      VALUES (${rb.id},'active','FAT-SEED-001',${adminId},${now},'Seed test — cho phép dispatch robot')`; rcN++; }
  }
  log(`robots +${rN}, robot_commissioning_records +${rcN}`);

  // ── 9. product-machine mappings (link product model tới máy AOI) → changeover wizard ──
  const [pm] = await sql`SELECT id FROM product_models ORDER BY id LIMIT 1`;
  let pmmN = 0;
  if (pm) {
    for (const m of machines.filter(x => ['AOI', 'AVI', 'SPI'].includes(x.machineType)).slice(0, 6)) {
      const [ex] = await sql`SELECT id FROM product_machine_mappings WHERE "productModelId"=${pm.id} AND "machineId"=${m.id}`;
      if (!ex) { await sql`INSERT INTO product_machine_mappings ("productModelId","machineId","isActive",priority) VALUES (${pm.id},${m.id},true,1)`; pmmN++; }
    }
  }
  log(`product_machine_mappings +${pmmN}`);

  // ── 10. production session (operator đã vào ca) ──
  const [shiftA] = await sql`SELECT id FROM shift_configs ORDER BY "orderIndex" LIMIT 1`;
  let psN = 0;
  if (shiftA && users.operator) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const code = `PS-${today.toISOString().slice(0, 10)}-L1`;
    const [ex] = await sql`SELECT id FROM production_sessions WHERE "sessionCode"=${code}`;
    if (!ex) { await sql`INSERT INTO production_sessions ("sessionCode","shiftConfigId","factoryId","workshopId","lineId","operatorId",status,"shiftDate","plannedStart","plannedEnd","actualStart")
      VALUES (${code},${shiftA.id},${factoryId},${workshopId},${lines[0].id},${users.operator},'open',${today},${hoursAgo(3)},${hoursAgo(-5)},${hoursAgo(3)})`; psN++; }
  }
  log(`production_sessions +${psN}`);

  log('✅ HOÀN TẤT seed dữ liệu test.');
} catch (e) { console.error('[seed-test] LỖI:', e.message); process.exitCode = 1; }
await sql.end();
