// scripts/seed-engineering-data.mjs — Doc 54 Wave D: engineering / telemetry seed.
//
// Fills the tables that make the Engineering + telemetry screens look HOLLOW when a
// fresh factory topology has been created (sim:factory) but nobody has authored
// programs / recipes / ECNs / edge nodes / MQTT clients yet. Nothing here writes a
// device — every row is DEFINITION / AUDIT / TELEMETRY metadata only.
//
// Modeled on scripts/seed-test-data.mjs: `postgres` driver + DATABASE_URL (avi_app),
// plain `sql` template inserts, idempotent, relative timestamps, one log() per table.
//
// IDEMPOTENCY: safe to run many times. Tables that migration 0279 hardened to
// APPEND-ONLY for avi_app (program_deployments — REVOKE DELETE) use ON CONFLICT DO
// NOTHING and are additionally gated by an existence check so a re-run inserts nothing.
// Other tables use existence-check / delete-by-SEED-tag / ON CONFLICT DO NOTHING.
//
// Run:  node scripts/seed-engineering-data.mjs   (after sim:factory built the topology)
import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const log = (...a) => console.log('[seed-eng]', ...a);
const now = new Date();
const daysAgo = (d) => new Date(now.getTime() - d * 864e5);
const hoursAgo = (h) => new Date(now.getTime() - h * 36e5);
const minsAgo = (m) => new Date(now.getTime() - m * 6e4);
// jsonb / json helpers — postgres.js `sql.json()` (repo convention, see
// scripts/seed-automation-demo.mjs). Sends a properly-typed json param; Postgres
// casts json→jsonb implicitly on insert into a jsonb column.
const jb = (v) => sql.json(v);
const js = (v) => sql.json(v);

async function main() {
  // ── Resolve shared refs from the seeded topology (abort early if missing) ──
  const [fac] = await sql`SELECT id FROM factories WHERE code='SIM-FAC' ORDER BY id LIMIT 1`;
  const machines = await sql`SELECT id, code, "machineType", "stationId" FROM machines ORDER BY id`;
  if (!fac || machines.length === 0) {
    console.error('[seed-eng] Chưa có topology (factory SIM-FAC / machines) — chạy `npm run sim:factory` trước.');
    process.exitCode = 1;
    return;
  }
  const factoryId = fac.id;
  const stations = await sql`SELECT id, "lineId" FROM stations ORDER BY id`;
  const lineOf = new Map();
  for (const s of stations) lineOf.set(s.id, s.lineId);
  const [admin] = await sql`SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1`;
  const adminId = admin?.id;
  const [eng] = await sql`SELECT id FROM users WHERE role='engineer' ORDER BY id LIMIT 1`;
  const engineerId = eng?.id ?? adminId;
  const byType = (t) => machines.find((m) => m.machineType === t);
  const aoi = byType('AOI'), avi = byType('AVI'), spi = byType('SPI');
  const robot = byType('ROBOT'), conv = byType('AUTOMATION'), screw = byType('SCREWDRIVE');
  log(`topology: factory=${factoryId} machines=${machines.length} admin=${adminId} engineer=${engineerId}`);

  // ── 1. machine_heartbeats — recent heartbeats (last few min) so Device Monitor
  //       shows ONLINE > 0. Idempotent via ipAddress='SEED' tag (DELETE allowed). ──
  try {
    await sql`DELETE FROM machine_heartbeats WHERE "ipAddress"='SEED'`;
    let n = 0;
    for (const m of machines) {
      // Most machines running; a few maintenance/stopped for realism.
      const base = m.id % 11 === 0 ? 'maintenance' : m.id % 13 === 0 ? 'stopped' : 'running';
      for (const [k, mins] of [[0, 1], [1, 6], [2, 13]]) {
        const status = k === 0 ? base : 'running';
        const cpu = (18 + Math.random() * 62).toFixed(2);
        const mem = (30 + Math.random() * 55).toFixed(2);
        const disk = (40 + Math.random() * 45).toFixed(2);
        const temp = (34 + Math.random() * 30).toFixed(2);
        await sql`INSERT INTO machine_heartbeats ("machineId","ipAddress",status,"cpuUsage","memoryUsage","diskUsage",temperature,timestamp)
          VALUES (${m.id},'SEED',${status},${cpu},${mem},${disk},${temp},${minsAgo(mins)})`;
        n++;
      }
    }
    log(`machine_heartbeats +${n} (${machines.length} máy, tươi < 15 phút)`);
  } catch (e) { console.error('[seed-eng] machine_heartbeats LỖI:', e.message); }

  // ── 2. Programming: projects → artifacts → build → sim → deploy (Engineering
  //       Workspace build/sim/deploy history). program_deployments = ON CONFLICT
  //       DO NOTHING (0279 REVOKE DELETE) + gated by artifact existence. ──
  try {
    const projSpecs = [
      { code: 'SEED-PLC-CONV-L1', name: 'PLC băng tải L1 (ST)', kind: 'iec61131-st', language: 'st',
        deviceId: conv?.id ?? null, content: 'PROGRAM main\n  VAR conveyorRun : BOOL; END_VAR\n  conveyorRun := TRUE;\nEND_PROGRAM' },
      { code: 'SEED-ROBOT-CELL-L1', name: 'Robot gắp-đặt L1 (IR-Flow)', kind: 'ir-flow', language: 'json',
        deviceId: robot?.id ?? null, content: '{"flow":[{"op":"moveL","to":"P1"},{"op":"grip"},{"op":"moveL","to":"P2"},{"op":"release"}]}' },
      { code: 'SEED-MOTION-L1', name: 'Điều khiển chuyển động Zmotion L1', kind: 'zmotion-basic', language: 'basic',
        deviceId: screw?.id ?? null, content: "BASE(0)\nATYPE=1\nUNITS=1000\nSPEED=200\nMOVE(100)\nWAIT IDLE" },
    ];
    let projN = 0, chainN = 0;
    for (const p of projSpecs) {
      let [pr] = await sql`SELECT id FROM program_projects WHERE code=${p.code}`;
      if (!pr) {
        [pr] = await sql`INSERT INTO program_projects (code,name,kind,"deviceId",description,"defaultBranch","createdBy","factoryId")
          VALUES (${p.code},${p.name},${p.kind},${p.deviceId},${'Seed project — ' + p.kind},'main',${engineerId},${factoryId}) RETURNING id`;
        projN++;
      }
      const projectId = pr.id;
      const [ac] = await sql`SELECT count(*)::int n FROM program_artifacts WHERE "projectId"=${projectId}`;
      if (ac.n > 0) continue; // chain already seeded for this project → skip (idempotent)

      const [a1] = await sql`INSERT INTO program_artifacts ("projectId",branch,version,kind,language,content,"contentHash",status,"reviewStatus","reviewedBy","reviewedAt","diagnosticsJson","createdBy","factoryId")
        VALUES (${projectId},'main',1,${p.kind},${p.language},${p.content},${'seedhash-' + p.code + '-1'},'released','approved',${adminId},${daysAgo(3)},${jb({ errors: 0, warnings: 1 })},${engineerId},${factoryId}) RETURNING id`;
      // A newer draft version (four-eyes pending) so the version list isn't singleton.
      await sql`INSERT INTO program_artifacts ("projectId",branch,version,kind,language,content,"contentHash",status,"reviewStatus","createdBy","factoryId")
        VALUES (${projectId},'main',2,${p.kind},${p.language},${p.content + '\n// v2 WIP'},${'seedhash-' + p.code + '-2'},'draft','pending_review',${engineerId},${factoryId})`;

      const [b1] = await sql`INSERT INTO program_builds ("artifactId","adapterKind",status,ok,"diagnosticsJson","outputRef","durationMs","createdBy","factoryId")
        VALUES (${a1.id},${p.kind},'ok',true,${jb({ errors: 0, warnings: 1 })},${'build/' + p.code + '/v1.out'},${900 + Math.floor(Math.random() * 1400)},${engineerId},${factoryId}) RETURNING id`;

      await sql`INSERT INTO program_sim_runs ("buildId","scenarioJson",ok,"timelineJson","warningsJson","durationMs","createdBy","factoryId")
        VALUES (${b1.id},${jb({ scenario: 'nominal', cycles: 10 })},true,${jb({ steps: [{ t: 0, s: 'start' }, { t: 500, s: 'done' }] })},${jb([])},${600 + Math.floor(Math.random() * 500)},${engineerId},${factoryId})`;

      // Append-only deploy audit (simulated — DPC_DEPLOY_ENABLED off). ON CONFLICT DO NOTHING.
      await sql`INSERT INTO program_deployments ("buildId","projectId","deviceId",stage,status,simulated,"signedOffBy","requestedBy","idempotencyKey","detailJson","factoryId")
        VALUES (${b1.id},${projectId},${p.deviceId},'staging','simulated',true,${adminId},${engineerId},${'seed-deploy-' + p.code},${jb({ note: 'seed dry-run staging deploy' })},${factoryId})
        ON CONFLICT DO NOTHING`;
      chainN++;
    }
    log(`program_projects +${projN}, build/sim/deploy chains +${chainN}`);
  } catch (e) { console.error('[seed-eng] programming LỖI:', e.message); }

  // ── 3. machine_recipes + recipe_deployments (Recipe management). Exactly ONE
  //       'active' version per code (DB partial-unique). Existence-checked. ──
  try {
    const recipeSpecs = [
      { code: 'SEED-RCP-AOI-L1', name: 'AOI L1 — cấu hình chuẩn', machine: aoi, payload: { exposureMs: 120, gain: 1.5, ngThreshold: 0.82, lightLevel: 70 } },
      { code: 'SEED-RCP-AVI-L1', name: 'AVI L1 — kiểm tra ngoại quan', machine: avi, payload: { fov: 'A', contrast: 1.2, blobMinPx: 40 } },
      { code: 'SEED-RCP-SPI-L1', name: 'SPI L1 — đo kem hàn', machine: spi, payload: { heightUpper: 180, heightLower: 90, volumeTolPct: 25 } },
    ];
    let rN = 0, dN = 0;
    for (const r of recipeSpecs) {
      if (!r.machine) continue;
      let [rc] = await sql`SELECT id FROM machine_recipes WHERE code=${r.code} AND version=1`;
      if (!rc) {
        [rc] = await sql`INSERT INTO machine_recipes ("machineId","machineType",code,name,version,payload,checksum,status,notes,"createdBy","isGolden","approvedBy","approvedAt")
          VALUES (${r.machine.id},${r.machine.machineType},${r.code},${r.name},1,${jb(r.payload)},${'seedsum-' + r.code},'active','Seed recipe (baseline golden)',${engineerId},true,${adminId},${daysAgo(2)}) RETURNING id`;
        rN++;
      }
      const [dep] = await sql`SELECT id FROM recipe_deployments WHERE "recipeId"=${rc.id}`;
      if (!dep) {
        await sql`INSERT INTO recipe_deployments ("recipeId","machineId","deployedBy","deployedAt",status,notes)
          VALUES (${rc.id},${r.machine.id},${adminId},${daysAgo(2)},'deployed','Seed deploy ledger')`;
        dN++;
      }
    }
    log(`machine_recipes +${rN}, recipe_deployments +${dN}`);
  } catch (e) { console.error('[seed-eng] recipes LỖI:', e.message); }

  // ── 4. interlock_events — fired by the existing interlock rule (Interlock ▸ Events). ──
  try {
    const [rule] = await sql`SELECT id, threshold FROM interlock_rules ORDER BY id LIMIT 1`;
    if (!rule) { log('interlock_events: bỏ qua (chưa có interlock_rules)'); }
    else {
      await sql`DELETE FROM interlock_events WHERE notes='SEED'`;
      let n = 0;
      const thr = Number(rule.threshold ?? 20);
      for (let i = 0; i < 3; i++) {
        const observed = (thr + 4 + i * 3).toFixed(2);
        await sql`INSERT INTO interlock_events ("ruleId","firedAt","sourceType","observedValue",threshold,action,status,detail,notes)
          VALUES (${rule.id},${minsAgo(25 + i * 18)},'telemetry_tag',${observed},${rule.threshold ?? 20},'alert','alert_only',${jb({ tag: 'ng_rate', window: '5m', samples: 20 })},'SEED')`;
        n++;
      }
      log(`interlock_events +${n} (rule ${rule.id})`);
    }
  } catch (e) { console.error('[seed-eng] interlock_events LỖI:', e.message); }

  // ── 5. engineering_changes + items (ECN list). Existence-checked by ecnKey. ──
  try {
    const ecnSpecs = [
      { key: 'SEED-ECN-0001', title: 'Cập nhật ngưỡng NG cho AOI L1', changeType: 'recipe', status: 'approved',
        reason: 'Giảm false-call sau khi phân tích 2 tuần dữ liệu.', productModelId: null,
        impact: { affectedLines: ['SIM-L1'], notes: 'Chỉ ảnh hưởng recipe AOI, không đổi phần cứng.' },
        items: [
          { entityType: 'recipe', entityCode: 'SEED-RCP-AOI-L1', action: 'modify', description: 'ngThreshold 0.80 → 0.82' },
          { entityType: 'document', entityCode: 'WI-AOI-01', action: 'modify', description: 'Cập nhật hướng dẫn công việc' },
        ] },
      { key: 'SEED-ECN-0002', title: 'Chương trình robot gắp-đặt phiên bản 2', changeType: 'program', status: 'draft',
        reason: 'Tối ưu quỹ đạo giảm thời gian chu kỳ 8%.', productModelId: null,
        impact: { affectedPrograms: ['SEED-ROBOT-CELL-L1'], notes: 'Chờ mô phỏng trước khi trình duyệt.' },
        items: [{ entityType: 'program', entityCode: 'SEED-ROBOT-CELL-L1', action: 'modify', description: 'Rút ngắn quỹ đạo P1→P2' }] },
      { key: 'SEED-ECN-0003', title: 'Thêm biến thể sản phẩm mới', changeType: 'product', status: 'submitted',
        reason: 'Yêu cầu khách hàng bổ sung màu vỏ.', productModelId: null,
        impact: { notes: 'Cần cập nhật điểm đo cho biến thể.' },
        items: [{ entityType: 'product', entityCode: 'VARIANT-BLK', action: 'add', description: 'Biến thể vỏ đen' }] },
    ];
    let eN = 0, iN = 0;
    for (const e of ecnSpecs) {
      let [ec] = await sql`SELECT id FROM engineering_changes WHERE "ecnKey"=${e.key}`;
      if (ec) continue; // already seeded (items were inserted with it) → skip
      const submittedAt = e.status === 'draft' ? null : daysAgo(5);
      const reviewedAt = ['in_review', 'approved', 'rejected', 'implemented', 'closed'].includes(e.status) ? daysAgo(4) : null;
      const approvedAt = ['approved', 'implemented', 'closed'].includes(e.status) ? daysAgo(3) : null;
      const reviewedBy = reviewedAt ? adminId : null;
      const approvedBy = approvedAt ? adminId : null;
      const effectivity = approvedAt ? daysAgo(-3) : null;
      [ec] = await sql`INSERT INTO engineering_changes ("ecnKey",title,"changeType","productModelId",reason,"impactSummary",status,"effectivityDate","requestedBy","reviewedBy","approvedBy","submittedAt","reviewedAt","approvedAt","factoryId",note)
        VALUES (${e.key},${e.title},${e.changeType},${e.productModelId},${e.reason},${jb(e.impact)},${e.status},${effectivity},${engineerId},${reviewedBy},${approvedBy},${submittedAt},${reviewedAt},${approvedAt},${factoryId},'Seed ECN') RETURNING id`;
      eN++;
      for (const it of e.items) {
        await sql`INSERT INTO engineering_change_items ("ecnId","entityType","entityRef","entityCode",action,description)
          VALUES (${ec.id},${it.entityType},${it.entityRef ?? null},${it.entityCode},${it.action},${it.description})`;
        iN++;
      }
    }
    log(`engineering_changes +${eN}, engineering_change_items +${iN}`);
  } catch (e) { console.error('[seed-eng] ECN LỖI:', e.message); }

  // ── 6. device_types hierarchy + master_alarms (Equipment standards).
  //       alarm_taxonomy already seeded (166) → skipped. Existence-checked. ──
  try {
    const dtSpecs = [
      { typeKey: 'Equipment', parent: null, label: 'Thiết bị (gốc)', adapterKind: null, mapped: [] },
      { typeKey: 'Robot', parent: 'Equipment', label: 'Robot', adapterKind: 'robot', mapped: ['ROBOT'] },
      { typeKey: 'CollaborativeRobot', parent: 'Robot', label: 'Robot cộng tác (cobot)', adapterKind: 'robot', mapped: [] },
      // doc 56 Đ0 việc 8 — adapterKind 'aoi' là SAI vocabulary (không có trong
      // AdapterKind union); máy quang học dùng 'vision' (capabilityModel).
      { typeKey: 'AOI', parent: 'Equipment', label: 'Máy AOI', adapterKind: 'vision', mapped: ['AOI', 'AVI'] },
      { typeKey: 'SPI', parent: 'Equipment', label: 'Máy SPI', adapterKind: null, mapped: ['SPI'] },
    ];
    let dN = 0;
    for (const d of dtSpecs) {
      const [ex] = await sql`SELECT id FROM device_types WHERE "typeKey"=${d.typeKey} AND version='1.0.0'`;
      if (ex) continue;
      await sql`INSERT INTO device_types ("typeKey","parentTypeKey",version,status,label,description,"attributesSchema","supportedCommands","supportedStates","extensionFields","mappedMachineTypes","adapterKind",origin,"publishedAt","createdBy")
        VALUES (${d.typeKey},${d.parent},'1.0.0','published',${d.label},${'Seed device type — ' + d.typeKey},${jb([])},${jb([])},${jb([])},${jb({})},${jb(d.mapped)},${d.adapterKind},'seed',${daysAgo(5)},${adminId})`;
      dN++;
    }
    const maSpecs = [
      { key: 'COLLISION_DETECT', asset: 'ROBOT', vendor: 'universal_robots', native: 'C153', label: 'Phát hiện va chạm', priority: 'critical', consequence: 'severe', ttr: 1, setpoint: 'lực > 150N', deadband: '10N', rationalization: 'Dừng ngay, kiểm tra vùng làm việc trước khi chạy lại.' },
      { key: 'OVERTEMP', asset: 'AOI', vendor: null, native: null, label: 'Quá nhiệt buồng chiếu sáng', priority: 'high', consequence: 'major', ttr: 5, setpoint: '> 65°C', deadband: '3°C', rationalization: 'Giảm tải, kiểm tra quạt tản nhiệt.' },
      { key: 'AIR_PRESSURE_LOW', asset: 'SPI', vendor: null, native: null, label: 'Áp suất khí thấp', priority: 'medium', consequence: 'minor', ttr: 15, setpoint: '< 4 bar', deadband: '0.3 bar', rationalization: 'Kiểm tra nguồn khí nén trung tâm.' },
      { key: 'DOOR_OPEN', asset: null, vendor: null, native: null, label: 'Cửa an toàn mở', priority: 'high', consequence: 'major', ttr: 2, setpoint: 'công tắc cửa = mở', deadband: null, rationalization: 'Đóng cửa, xác nhận vùng an toàn trước khi tiếp tục.' },
    ];
    let mN = 0;
    for (const a of maSpecs) {
      const [ex] = await sql`SELECT id FROM master_alarms WHERE "alarmKey"=${a.key} AND "assetType" IS NOT DISTINCT FROM ${a.asset}`;
      if (ex) continue;
      await sql`INSERT INTO master_alarms ("alarmKey","assetType",vendor,"nativeCode",label,priority,consequence,"timeToRespond",setpoint,deadband,rationalization,"createdBy")
        VALUES (${a.key},${a.asset},${a.vendor},${a.native},${a.label},${a.priority},${a.consequence},${a.ttr},${a.setpoint},${a.deadband},${a.rationalization},${adminId})`;
      mN++;
    }
    log(`device_types +${dN}, master_alarms +${mN} (alarm_taxonomy đã có sẵn → bỏ qua)`);
  } catch (e) { console.error('[seed-eng] equipment standards LỖI:', e.message); }

  // ── 7. orchestration_runs + steps for the existing workflows (FOE Studio history).
  //       Gated per-workflow: only inserts when the workflow has no runs yet. ──
  try {
    const wfs = await sql`SELECT id, ref, name FROM orchestration_workflows ORDER BY id`;
    let runN = 0, stepN = 0;
    for (let wi = 0; wi < wfs.length; wi++) {
      const wf = wfs[wi];
      const [c] = await sql`SELECT count(*)::int n FROM orchestration_runs WHERE "workflowId"=${wf.id}`;
      if (c.n > 0) continue;
      // A finished run.
      const started = hoursAgo(3 + wi), finished = hoursAgo(2.5 + wi);
      const [run] = await sql`INSERT INTO orchestration_runs ("workflowId","workflowRef",status,"paramsJson","contextJson","startedBy","startedAt","finishedAt")
        VALUES (${wf.id},${wf.ref},'completed',${jb({ lineCode: 'SIM-L1' })},${jb({ seed: true, gate: 'passed' })},${adminId},${started},${finished}) RETURNING id`;
      runN++;
      for (const [sid, stype] of [['s1', 'command'], ['s2', 'hitl_gate'], ['s3', 'command']]) {
        await sql`INSERT INTO orchestration_run_steps ("runId","stepId","stepType",status,attempt,"resultJson","startedAt","finishedAt")
          VALUES (${run.id},${sid},${stype},'completed',1,${jb({ ok: true })},${started},${finished})
          ON CONFLICT DO NOTHING`;
        stepN++;
      }
      // First workflow also gets a currently-running run for a live-history feel.
      if (wi === 0) {
        const [run2] = await sql`INSERT INTO orchestration_runs ("workflowId","workflowRef",status,"paramsJson","contextJson","currentStepId","startedBy","startedAt")
          VALUES (${wf.id},${wf.ref},'running',${jb({ lineCode: 'SIM-L1' })},${jb({ seed: true })},'s2',${adminId},${minsAgo(8)}) RETURNING id`;
        runN++;
        await sql`INSERT INTO orchestration_run_steps ("runId","stepId","stepType",status,attempt,"resultJson","startedAt","finishedAt")
          VALUES (${run2.id},'s1','command','completed',1,${jb({ ok: true })},${minsAgo(8)},${minsAgo(7)}) ON CONFLICT DO NOTHING`;
        await sql`INSERT INTO orchestration_run_steps ("runId","stepId","stepType",status,attempt,"resultJson","startedAt")
          VALUES (${run2.id},'s2','hitl_gate','running',1,${jb({})},${minsAgo(7)}) ON CONFLICT DO NOTHING`;
        stepN += 2;
      }
    }
    log(`orchestration_runs +${runN}, orchestration_run_steps +${stepN}`);
  } catch (e) { console.error('[seed-eng] orchestration LỖI:', e.message); }

  // ── 8. MQTT: clients + subscriptions + client profile + recent message logs. ──
  try {
    const st = stations;
    const clientSpecs = [
      { clientId: 'seed-mqtt-01', deviceId: 'seed-dev-01', name: 'Tablet trạm AOI L1', model: 'Galaxy Tab A8', ip: '192.168.10.11', stationId: aoi?.stationId ?? st[0]?.id ?? null },
      { clientId: 'seed-mqtt-02', deviceId: 'seed-dev-02', name: 'Tablet trạm AVI L1', model: 'Redmi Pad', ip: '192.168.10.12', stationId: avi?.stationId ?? st[1]?.id ?? null },
      { clientId: 'seed-mqtt-03', deviceId: 'seed-dev-03', name: 'Điện thoại quản đốc L1', model: 'Galaxy S22', ip: '192.168.10.13', stationId: spi?.stationId ?? st[2]?.id ?? null },
    ];
    const clientIds = [];
    let cN = 0, sN = 0;
    for (const c of clientSpecs) {
      let [cl] = await sql`SELECT id FROM mqtt_clients WHERE "clientId"=${c.clientId}`;
      if (!cl) {
        [cl] = await sql`INSERT INTO mqtt_clients ("clientId","deviceId","deviceName","deviceModel","osVersion","appVersion","ipAddress",brand,manufacturer,"stationId","approvalStatus","approvedBy","approvedAt","mappingType","connectionStatus","lastConnectedAt","lastHeartbeat","isActive")
          VALUES (${c.clientId},${c.deviceId},${c.name},${c.model},'Android 13','1.4.2',${c.ip},'Samsung','Samsung',${c.stationId},'APPROVED',${adminId},${daysAgo(1)},'MANUAL','ONLINE',${minsAgo(4)},${minsAgo(1)},true) RETURNING id`;
        cN++;
      }
      clientIds.push(cl.id);
      const topics = [c.stationId ? `avi/factory/${factoryId}/station/${c.stationId}/errors` : `avi/factory/${factoryId}/errors`, `avi/factory/${factoryId}/broadcast`];
      for (const t of topics) {
        const before = await sql`SELECT id FROM mqtt_subscriptions WHERE "clientId"=${cl.id} AND topic=${t}`;
        await sql`INSERT INTO mqtt_subscriptions ("clientId",topic,qos,"isActive") VALUES (${cl.id},${t},1,true) ON CONFLICT DO NOTHING`;
        if (before.length === 0) sN++;
      }
    }
    // recent message logs — idempotent via seed/ topic prefix (DELETE allowed here).
    await sql`DELETE FROM mqtt_message_logs WHERE topic LIKE 'seed/%'`;
    let lN = 0;
    for (let i = 0; i < 6 && clientIds.length; i++) {
      const cid = clientIds[i % clientIds.length];
      await sql`INSERT INTO mqtt_message_logs ("messageType",topic,payload,"targetClientId","deliveryStatus","deliveredAt","createdAt")
        VALUES ('NG_ALERT',${'seed/eng/ng-alert/' + i},${js({ serial: 'SN' + (1000 + i), point: 'MP0' + ((i % 5) + 1), result: 'NG', ts: minsAgo(3 + i).toISOString() })},${cid},'DELIVERED',${minsAgo(3 + i)},${minsAgo(3 + i)})`;
      lN++;
    }
    // broker profile
    let pN = 0;
    const [pf] = await sql`SELECT id FROM mqtt_client_profiles WHERE name='SEED Broker chính (local)'`;
    if (!pf) {
      await sql`INSERT INTO mqtt_client_profiles (name,description,"brokerUrl",port,protocol,username,"defaultQos","isDefault","isActive","createdBy")
        VALUES ('SEED Broker chính (local)','Hồ sơ broker MQTT mặc định (seed)','127.0.0.1',1883,'mqtt','avi_bridge','1',true,true,${adminId})`;
      pN++;
    }
    log(`mqtt_clients +${cN}, mqtt_subscriptions +${sN}, mqtt_message_logs +${lN}, mqtt_client_profiles +${pN}`);
  } catch (e) { console.error('[seed-eng] MQTT LỖI:', e.message); }

  // ── 9. edge_nodes (Edge runtime registry). ON CONFLICT DO NOTHING on code. ──
  try {
    let n = 0;
    const nodes = [
      { code: 'SEED-EDGE-L1', name: 'Edge biên — Line 1', lines: ['SIM-L1'] },
      { code: 'SEED-EDGE-L2', name: 'Edge biên — Line 2', lines: ['SIM-L2'] },
      { code: 'SEED-EDGE-L3', name: 'Edge biên — Line 3', lines: ['SIM-L3'] },
    ];
    for (const e of nodes) {
      const [ex] = await sql`SELECT id FROM edge_nodes WHERE code=${e.code}`;
      await sql`INSERT INTO edge_nodes (code,name,"factoryCode",status,"lastHeartbeatAt","assignedLineCodes",version,"healthJson")
        VALUES (${e.code},${e.name},'SIM-FAC','online',${minsAgo(1)},${jb(e.lines)},'1.4.0',${jb({ queueDepth: 0, buffered: 0, cpu: 0.2 })})
        ON CONFLICT DO NOTHING`;
      if (!ex) n++;
    }
    log(`edge_nodes +${n}`);
  } catch (e) { console.error('[seed-eng] edge_nodes LỖI:', e.message); }

  // ── 10. uns_tag_mappings (UNS designer). unique (adapterId, tag) → ON CONFLICT. ──
  try {
    const adapters = await sql`SELECT id, code FROM device_adapters ORDER BY id LIMIT 5`;
    const tags = [['temperature', '°C'], ['pressure', 'bar'], ['cycleCount', '']];
    let n = 0;
    for (const ad of adapters) {
      for (const [tag, unit] of tags) {
        const [ex] = await sql`SELECT id FROM uns_tag_mappings WHERE "adapterId"=${ad.id} AND tag=${tag}`;
        await sql`INSERT INTO uns_tag_mappings ("adapterId",tag,"unsTopic","sparkplugMetric",transform,enabled,notes,"createdBy")
          VALUES (${ad.id},${tag},${'AVI-AOI/SIM-FAC/' + ad.code + '/' + tag},${tag},${jb({ unit })},true,'Seed UNS mapping',${adminId})
          ON CONFLICT DO NOTHING`;
        if (!ex) n++;
      }
    }
    log(`uns_tag_mappings +${n} (${adapters.length} adapter)`);
  } catch (e) { console.error('[seed-eng] uns_tag_mappings LỖI:', e.message); }

  // ── 11. product_machine_mappings (Changeover wizard). product_models already
  //        has data → skip creating models; map existing real models to AOI/AVI/SPI. ──
  try {
    const pmModels = await sql`SELECT id, code FROM product_models WHERE code <> '__UNMAPPED__' AND "deletedAt" IS NULL AND "isActive"=true ORDER BY id LIMIT 2`;
    const insMachines = machines.filter((m) => ['AOI', 'AVI', 'SPI'].includes(m.machineType)).slice(0, 4);
    let n = 0;
    for (const pm of pmModels) {
      for (const m of insMachines) {
        const [ex] = await sql`SELECT id FROM product_machine_mappings WHERE "productModelId"=${pm.id} AND "machineId"=${m.id}`;
        await sql`INSERT INTO product_machine_mappings ("productModelId","machineId","isActive",priority,notes)
          VALUES (${pm.id},${m.id},true,1,'Seed changeover mapping') ON CONFLICT DO NOTHING`;
        if (!ex) n++;
      }
    }
    log(`product_machine_mappings +${n} (${pmModels.length} model × ${insMachines.length} máy; product_models đã có sẵn → bỏ qua tạo mới)`);
  } catch (e) { console.error('[seed-eng] product_machine_mappings LỖI:', e.message); }

  log('✅ HOÀN TẤT seed dữ liệu Engineering / telemetry (doc 54 Wave D).');
}

main()
  .catch((e) => { console.error('[seed-eng] LỖI TOÀN CỤC:', e); process.exitCode = 1; })
  .finally(() => sql.end());
