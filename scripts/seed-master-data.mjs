// scripts/seed-master-data.mjs — Doc 54 §11 P0.2: seed REAL MES/MOM MASTER DATA.
//
// Phase-0 base data was EMPTY (verified): suppliers, material_classes, materials,
// customers, skills, tools, units_of_measure, unit_conversions, plant_calendars,
// calendar_days, warehouses, storage_locations, inventory_balances, routing_master,
// routing_steps, bom_definitions, bom_line_items — plus 0 component_footprints and
// 0 measurement_point_defs carrying a componentCode. Without these masters the
// setup / traceability / Pareto / routing / BOM screens render hollow and the
// component-package Pareto chain (measurement_results → pointDef.componentCode →
// materials.packageId → component_packages) is broken at its first hop.
//
// This seeds a realistic small-but-complete SMT/AOI factory master dataset and wires
// the componentCode/BOM/package linkage so Phase-0 lights up. DEFINITION data only —
// no device is written; nothing here alters existing tables' STRUCTURE (only a data
// backfill of the nullable measurement_point_defs.componentCode/refDesignator).
//
// Modeled on scripts/seed-test-data.mjs + scripts/seed-engineering-data.mjs:
// `postgres` driver + DATABASE_URL (avi_app), plain sql template inserts, one log()
// per table, main() + sql.end().
//
// IDEMPOTENCY: safe to run repeatedly. Every table is guarded — ON CONFLICT DO
// NOTHING on its natural unique key, an existence check, or a deterministic UPDATE
// (the measurement_point_defs backfill). A re-run inserts nothing new.
//
// Run:  node scripts/seed-master-data.mjs   (after sim:factory built the topology)
import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const log = (...a) => console.log('[seed-master]', ...a);
const jb = (v) => sql.json(v); // jsonb helper (repo convention — see seed-engineering-data.mjs)

// ── IPC-7351-ish nominal land-pattern generator (advisory geometry, mm, body-centered) ──
function genFootprint(pkg) {
  const L = parseFloat(pkg.bodyLengthMm), W = parseFloat(pkg.bodyWidthMm);
  const n = pkg.pinCount, p = pkg.pitchMm != null ? parseFloat(pkg.pitchMm) : null;
  if (!(L > 0) || !(W > 0) || !(n > 0)) return null; // need real body + pins
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const clamp = (w, h) => [Math.max(0.2, r3(w)), Math.max(0.2, r3(h))];
  const fam = pkg.family;
  const pads = [];

  if (n === 2) {
    // two-terminal chip (CHIP/LED/SOD/TANTALUM/ELECTROLYTIC): end pads along L axis
    const [pw, ph] = clamp(L * 0.45, W * 0.9);
    const dx = r3(L / 2);
    pads.push({ x: -dx, y: 0, w: pw, h: ph, shape: 'rect', angle: 0, pin: 1 });
    pads.push({ x: dx, y: 0, w: pw, h: ph, shape: 'rect', angle: 0, pin: 2 });
  } else if (fam === 'QFP' || fam === 'QFN') {
    // 4-sided perimeter, n/4 pins per side
    const per = Math.max(1, Math.round(n / 4));
    const pitch = p || r3(Math.min(L, W) / (per + 1));
    const [pw, ph] = clamp(Math.max(0.3, W * 0.12), Math.max(0.25, pitch * 0.6));
    const span = (per - 1) * pitch, hx = r3(L / 2), hy = r3(W / 2);
    let pin = 1;
    for (let i = 0; i < per; i++) pads.push({ x: -hx, y: r3(-span / 2 + i * pitch), w: pw, h: ph, shape: 'rect', angle: 0, pin: pin++ });
    for (let i = 0; i < per; i++) pads.push({ x: r3(-span / 2 + i * pitch), y: -hy, w: ph, h: pw, shape: 'rect', angle: 0, pin: pin++ });
    for (let i = 0; i < per; i++) pads.push({ x: hx, y: r3(-span / 2 + i * pitch), w: pw, h: ph, shape: 'rect', angle: 0, pin: pin++ });
    for (let i = 0; i < per; i++) pads.push({ x: r3(-span / 2 + i * pitch), y: hy, w: ph, h: pw, shape: 'rect', angle: 0, pin: pin++ });
  } else if (fam === 'BGA') {
    // ball grid
    const g = Math.max(1, Math.round(Math.sqrt(n)));
    const pitch = p || 1.0;
    const start = -((g - 1) / 2) * pitch;
    const d = r3(Math.min(0.6, pitch * 0.5));
    let pin = 1;
    for (let r = 0; r < g; r++) for (let c = 0; c < g; c++)
      pads.push({ x: r3(start + c * pitch), y: r3(start + r * pitch), w: d, h: d, shape: 'circle', angle: 0, pin: pin++ });
  } else {
    // gullwing two-side rows (SOT/SOIC/TSSOP/DPAK …)
    const a = Math.ceil(n / 2), b = n - a;
    const pitch = p || r3(L / (Math.max(a, 1) + 1));
    const [pw, ph] = clamp(Math.max(0.4, W * 0.35), Math.max(0.25, pitch * 0.6));
    const xoff = r3(W / 2 + pw / 2);
    const yFor = (count, i) => r3(-((count - 1) / 2) * pitch + i * pitch);
    let pin = 1;
    for (let i = 0; i < a; i++) pads.push({ x: -xoff, y: yFor(a, i), w: pw, h: ph, shape: 'rect', angle: 0, pin: pin++ });
    for (let i = 0; i < b; i++) pads.push({ x: xoff, y: yFor(b, i), w: pw, h: ph, shape: 'rect', angle: 0, pin: pin++ });
  }
  return {
    code: (pkg.ipcName || pkg.code) + '-N',
    density: 'nominal',
    padCount: pads.length,
    geometry: { pads },
    courtyard: { w: r3(L + 1.0), h: r3(W + 1.0) },
  };
}

async function main() {
  // ── Resolve shared refs (abort early if topology missing) ──
  const [fac] = await sql`SELECT id, code FROM factories WHERE code='SIM-FAC' ORDER BY id LIMIT 1`;
  if (!fac) { console.error('[seed-master] Chưa có factory SIM-FAC — chạy `npm run sim:factory` trước.'); process.exitCode = 1; return; }
  const FAC = fac.code; // 'SIM-FAC'
  const [admin] = await sql`SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1`;
  const adminId = admin?.id ?? null;
  const usersByName = new Map();
  for (const u of await sql`SELECT id, username FROM users`) usersByName.set(u.username, u.id);
  log(`refs: factory=${FAC} admin=${adminId} users=${usersByName.size}`);

  // ═══════════════ 1. Units of measure + conversions ═══════════════
  try {
    const uoms = [
      ['pcs', 'Cái (piece)', 'count', true], ['set', 'Bộ (set)', 'count', false],
      ['reel', 'Cuộn (reel)', 'count', false], ['roll', 'Cuộn băng (roll)', 'count', false],
      ['m', 'Mét', 'length', true], ['cm', 'Xăng-ti-mét', 'length', false],
      ['mm', 'Mi-li-mét', 'length', false], ['um', 'Mi-crô-mét', 'length', false],
      ['kg', 'Ki-lô-gam', 'mass', true], ['g', 'Gam', 'mass', false], ['mg', 'Mi-li-gam', 'mass', false],
      ['L', 'Lít', 'volume', true], ['mL', 'Mi-li-lít', 'volume', false],
      ['s', 'Giây', 'time', true], ['min', 'Phút', 'time', false], ['hour', 'Giờ', 'time', false],
      ['degC', 'Độ C', 'temperature', true], ['degF', 'Độ F', 'temperature', false],
      ['pct', 'Phần trăm', 'percent', true],
    ];
    let n = 0;
    for (const [code, name, dim, isBase] of uoms) {
      const r = await sql`INSERT INTO units_of_measure (code,name,dimension,"isBase","isActive")
        VALUES (${code},${name},${dim},${isBase},true) ON CONFLICT (code) DO NOTHING RETURNING id`;
      if (r.length) n++;
    }
    log(`units_of_measure +${n} (${uoms.length} tổng)`);

    // value_to = value_from * factor + offset  (offset covers affine temperature scales)
    const convs = [
      ['mm', 'm', '0.001', '0'], ['cm', 'm', '0.01', '0'], ['um', 'm', '0.000001', '0'],
      ['g', 'kg', '0.001', '0'], ['mg', 'kg', '0.000001', '0'],
      ['mL', 'L', '0.001', '0'], ['min', 's', '60', '0'], ['hour', 's', '3600', '0'],
      ['degF', 'degC', '0.555555555556', '-17.777777777778'],
      ['degC', 'degF', '1.8', '32'],
    ];
    let c = 0;
    for (const [f, t, factor, offset] of convs) {
      const r = await sql`INSERT INTO unit_conversions ("fromUomCode","toUomCode",factor,"offset")
        VALUES (${f},${t},${factor},${offset}) ON CONFLICT ("fromUomCode","toUomCode") DO NOTHING RETURNING id`;
      if (r.length) c++;
    }
    log(`unit_conversions +${c} (${convs.length} tổng)`);
  } catch (e) { console.error('[seed-master] UOM LỖI:', e.message); }

  // ═══════════════ 2. Suppliers / material classes / materials / customers ═══════════════
  try {
    const suppliers = [
      ['SUP-DIGIKEY', 'Digi-Key Electronics', 'component', 'US', '4.80'],
      ['SUP-MOUSER', 'Mouser Electronics', 'component', 'US', '4.70'],
      ['SUP-MURATA', 'Murata Manufacturing Co.', 'component', 'JP', '4.90'],
      ['SUP-YAGEO', 'Yageo Corporation', 'component', 'TW', '4.50'],
      ['SUP-ALPHA', 'Alpha Assembly Solutions', 'raw_material', 'US', '4.60'],
    ];
    let s = 0;
    for (const [code, name, type, country, rating] of suppliers) {
      const r = await sql`INSERT INTO suppliers (code,name,type,country,rating,"approvalStatus","isActive","factoryCode")
        VALUES (${code},${name},${type},${country},${rating},'approved',true,${FAC})
        ON CONFLICT (code) DO NOTHING RETURNING id`;
      if (r.length) s++;
    }
    log(`suppliers +${s}`);

    const classes = [
      ['MC-PASSIVE', 'Linh kiện thụ động', null], ['MC-RES', 'Điện trở', 'MC-PASSIVE'],
      ['MC-CAP', 'Tụ điện', 'MC-PASSIVE'], ['MC-IND', 'Cuộn cảm', 'MC-PASSIVE'],
      ['MC-SEMI', 'Bán dẫn', null], ['MC-IC', 'Vi mạch (IC)', 'MC-SEMI'],
      ['MC-DIODE', 'Diode', 'MC-SEMI'], ['MC-TRANS', 'Transistor', 'MC-SEMI'], ['MC-LED', 'Đèn LED', 'MC-SEMI'],
      ['MC-CONN', 'Đầu nối / giắc cắm', null], ['MC-XTAL', 'Thạch anh / dao động', null],
      ['MC-SOLDER', 'Vật liệu hàn (kem/thiếc)', null], ['MC-MECH', 'Cơ khí / vỏ', null],
    ];
    let mc = 0;
    for (const [code, name, parent] of classes) {
      const r = await sql`INSERT INTO material_classes (code,name,"parentCode","isActive")
        VALUES (${code},${name},${parent},true) ON CONFLICT (code) DO NOTHING RETURNING id`;
      if (r.length) mc++;
    }
    log(`material_classes +${mc}`);

    // Resolve component_packages id by code (soft-ref packageId link).
    const pkgs = await sql`SELECT id, code, "ipcName", family, "mountType", "bodyLengthMm", "bodyWidthMm", "bodyHeightMm", "pinCount", "pitchMm", "leadType" FROM component_packages`;
    const pkgIdByCode = new Map(pkgs.map((p) => [p.code, p.id]));

    // [code, name, class, packageCode|null, mpn, manufacturer, supplierCode, unit]
    const materials = [
      ['RES-0402-10K', 'Điện trở 10kΩ ±1% 0402', 'MC-RES', '0402', 'RC0402FR-0710KL', 'Yageo', 'SUP-YAGEO', 'pcs'],
      ['RES-0603-1K', 'Điện trở 1kΩ ±1% 0603', 'MC-RES', '0603', 'RC0603FR-071KL', 'Yageo', 'SUP-YAGEO', 'pcs'],
      ['RES-0805-100R', 'Điện trở 100Ω ±1% 0805', 'MC-RES', '0805', 'RC0805FR-07100RL', 'Yageo', 'SUP-YAGEO', 'pcs'],
      ['RES-2512-0R05', 'Điện trở shunt 0.05Ω ±1% 2512', 'MC-RES', '2512', 'CSR2512-R050F', 'Bourns', 'SUP-DIGIKEY', 'pcs'],
      ['CAP-0402-100N', 'Tụ gốm 100nF X7R 16V 0402', 'MC-CAP', '0402', 'CL05B104KO5NNNC', 'Samsung', 'SUP-MOUSER', 'pcs'],
      ['CAP-0402-22P', 'Tụ gốm 22pF C0G 50V 0402', 'MC-CAP', '0402', 'CL05C220JB5NNNC', 'Samsung', 'SUP-MOUSER', 'pcs'],
      ['CAP-0603-1U', 'Tụ gốm 1µF X5R 25V 0603', 'MC-CAP', '0603', 'GRM188R61E105KA12', 'Murata', 'SUP-MURATA', 'pcs'],
      ['CAP-0805-10U', 'Tụ gốm 10µF X5R 6.3V 0805', 'MC-CAP', '0805', 'GRM21BR60J106KE19', 'Murata', 'SUP-MURATA', 'pcs'],
      ['CAP-TANT-10U', 'Tụ tantalum 10µF 16V loại A', 'MC-CAP', 'CAP-TANT-A', 'TAJA106K016RNJ', 'AVX', 'SUP-DIGIKEY', 'pcs'],
      ['CAP-ELEC-100U', 'Tụ hóa 100µF 6.3V SMD', 'MC-CAP', 'CAP-ELEC-6.3', 'EEE-FK0J101P', 'Panasonic', 'SUP-DIGIKEY', 'pcs'],
      ['LED-0603-GRN', 'LED xanh lá 0603', 'MC-LED', 'LED-0603', 'LTST-C190GKT', 'Lite-On', 'SUP-MOUSER', 'pcs'],
      ['DIODE-BAT54', 'Diode Schottky BAT54 SOD-123', 'MC-DIODE', 'SOD-123', 'BAT54WS-7-F', 'Diodes Inc.', 'SUP-DIGIKEY', 'pcs'],
      ['TRANS-MMBT3904', 'Transistor NPN MMBT3904 SOT-23', 'MC-TRANS', 'SOT-23-3', 'MMBT3904LT1G', 'onsemi', 'SUP-DIGIKEY', 'pcs'],
      ['IC-MCU-STM32', 'Vi điều khiển STM32F103 LQFP-64', 'MC-IC', 'LQFP-64', 'STM32F103RCT6', 'STMicroelectronics', 'SUP-DIGIKEY', 'pcs'],
      ['IC-OPAMP-LM358', 'Op-amp kép LM358 SOIC-8', 'MC-IC', 'SOIC-8', 'LM358DR', 'Texas Instruments', 'SUP-MOUSER', 'pcs'],
      ['IC-REG-QFN48', 'IC nguồn PMIC QFN-48', 'MC-IC', 'QFN-48-7x7', 'TPS65217CRSLR', 'Texas Instruments', 'SUP-MOUSER', 'pcs'],
      ['IC-FPGA-BGA256', 'FPGA Artix-7 BGA-256', 'MC-IC', 'BGA-256', 'XC7A35T-1FGG256C', 'AMD/Xilinx', 'SUP-DIGIKEY', 'pcs'],
      ['XTAL-8MHZ', 'Thạch anh 8MHz 3225 SMD', 'MC-XTAL', 'XTAL-3225', 'ABM8-8.000MHZ-B2-T', 'Abracon', 'SUP-DIGIKEY', 'pcs'],
      ['CONN-USB-C', 'Đầu nối USB Type-C SMT', 'MC-CONN', 'CONN-SMT-GENERIC', 'USB4085-GF-A', 'GCT', 'SUP-MOUSER', 'pcs'],
      ['SOLDER-SAC305-T4', 'Kem hàn SAC305 T4 no-clean', 'MC-SOLDER', null, 'OM-338-T4', 'Alpha', 'SUP-ALPHA', 'g'],
    ];
    let m = 0;
    for (const [code, name, cls, pkgCode, mpn, mfr, sup, unit] of materials) {
      const pkgId = pkgCode ? (pkgIdByCode.get(pkgCode) ?? null) : null;
      const r = await sql`INSERT INTO materials (code,name,"materialClass",mpn,manufacturer,"packageType","packageId",unit,rohs,"defaultSupplierCode","isActive","factoryCode")
        VALUES (${code},${name},${cls},${mpn},${mfr},${pkgCode},${pkgId},${unit},true,${sup},true,${FAC})
        ON CONFLICT (code) DO NOTHING RETURNING id`;
      if (r.length) m++;
    }
    log(`materials +${m} (${materials.length} tổng, linked to component_packages by packageId)`);

    const customers = [
      ['CUST-NVIDIA', 'NVIDIA Corporation', 'US'],
      ['CUST-ACME', 'ACME Electronics Co., Ltd.', 'VN'],
      ['CUST-VHT', 'Viettel High Technology', 'VN'],
    ];
    let cu = 0;
    for (const [code, name, country] of customers) {
      const r = await sql`INSERT INTO customers (code,name,country,"isActive","factoryCode")
        VALUES (${code},${name},${country},true,${FAC}) ON CONFLICT (code) DO NOTHING RETURNING id`;
      if (r.length) cu++;
    }
    log(`customers +${cu}`);
  } catch (e) { console.error('[seed-master] suppliers/materials/customers LỖI:', e.message); }

  // ═══════════════ 3. Skills / tools / user_certifications ═══════════════
  try {
    const skills = [
      ['SK-SMT-OP', 'Vận hành dây chuyền SMT', 'SMT'], ['SK-AOI-INSP', 'Kiểm tra AOI/AVI', 'AOI'],
      ['SK-SPI-OP', 'Vận hành máy SPI', 'SPI'], ['SK-REFLOW', 'Vận hành lò reflow', 'SMT'],
      ['SK-SOLDER', 'Hàn tay theo IPC-A-610', 'soldering'], ['SK-MAINT', 'Bảo trì thiết bị', 'maintenance'],
      ['SK-PROG', 'Lập trình PLC/robot/thị giác', 'engineering'], ['SK-SAFETY', 'An toàn lao động', 'safety'],
    ];
    let sk = 0;
    for (const [code, name, cat] of skills) {
      const r = await sql`INSERT INTO skills (code,name,category,"isActive")
        VALUES (${code},${name},${cat},true) ON CONFLICT (code) DO NOTHING RETURNING id`;
      if (r.length) sk++;
    }
    log(`skills +${sk}`);
    const skillIdByCode = new Map((await sql`SELECT id, code FROM skills`).map((x) => [x.code, x.id]));

    const tools = [
      ['TOOL-NOZ-CN040', 'Vòi hút CN040 (mounter)', 'nozzle', 'MOUNTER', 2000000, 'Tủ vòi hút A1'],
      ['TOOL-NOZ-CN140', 'Vòi hút CN140 (mounter)', 'nozzle', 'MOUNTER', 2000000, 'Tủ vòi hút A1'],
      ['TOOL-STENCIL-SIM-MAIN', 'Stencil SIM-PCB-MAIN 120µm', 'stencil', 'PRINTER', 50000, 'Giá stencil B2'],
      ['TOOL-SQ-300', 'Dao gạt kem hàn 300mm', 'squeegee', 'PRINTER', 100000, 'Giá stencil B2'],
      ['TOOL-LENS-AOI-25', 'Ống kính AOI 25mm', 'lens', 'AOI', null, 'Máy AOI L1'],
      ['TOOL-JIG-SIM-MAIN', 'Đồ gá đỡ SIM-PCB-MAIN', 'jig', 'ASSEMBLY', null, 'Kệ đồ gá C3'],
      ['TOOL-FIX-ICT01', 'Đồ gá ICT bed-of-nails', 'fixture', 'ICT', null, 'Trạm ICT'],
      ['TOOL-FEEDER-8MM', 'Feeder băng 8mm', 'other', 'MOUNTER', 5000000, 'Xe feeder L1'],
    ];
    let to = 0;
    for (const [code, name, type, mt, lifeLimit, loc] of tools) {
      const r = await sql`INSERT INTO tools (code,name,type,"machineType","lifeLimit","lifeUsed",status,location,"isActive","factoryCode")
        VALUES (${code},${name},${type},${mt},${lifeLimit},0,'available',${loc},true,${FAC})
        ON CONFLICT (code) DO NOTHING RETURNING id`;
      if (r.length) to++;
    }
    log(`tools +${to}`);

    // user_certifications for the seeded personas. [username, skillCode, level]
    const certs = [
      ['operator1', 'SK-SMT-OP', 'qualified'], ['operator1', 'SK-SOLDER', 'qualified'],
      ['supervisor1', 'SK-AOI-INSP', 'expert'], ['supervisor1', 'SK-SAFETY', 'trainer'],
      ['maint1', 'SK-MAINT', 'expert'], ['maint1', 'SK-SAFETY', 'qualified'],
      ['engineer1', 'SK-PROG', 'expert'], ['engineer1', 'SK-AOI-INSP', 'qualified'], ['engineer1', 'SK-REFLOW', 'qualified'],
    ];
    let ce = 0;
    const inTwoYears = new Date(Date.now() + 2 * 365 * 864e5);
    for (const [uname, skc, level] of certs) {
      const uid = usersByName.get(uname), sid = skillIdByCode.get(skc);
      if (!uid || !sid) continue;
      const r = await sql`INSERT INTO user_certifications ("userId","skillId",level,"expiresAt","certifiedBy","isActive")
        VALUES (${uid},${sid},${level},${inTwoYears},${adminId},true)
        ON CONFLICT ("userId","skillId") DO NOTHING RETURNING id`;
      if (r.length) ce++;
    }
    log(`user_certifications +${ce}`);
  } catch (e) { console.error('[seed-master] skills/tools/certs LỖI:', e.message); }

  // ═══════════════ 4. Plant calendar + days + shifts + warehouses + inventory ═══════════════
  try {
    const calCode = 'CAL-SIM-FAC-2026';
    const pcIns = await sql`INSERT INTO plant_calendars (code,name,"factoryCode",timezone,"isActive")
      VALUES (${calCode},'Lịch nhà máy SIM 2026',${FAC},'Asia/Ho_Chi_Minh',true)
      ON CONFLICT (code) DO NOTHING RETURNING id`;
    const pc = pcIns.length;
    const [cal] = await sql`SELECT id FROM plant_calendars WHERE code=${calCode}`;
    const calId = cal.id;
    // One week of days from today; Sunday = holiday, others working with 3 shifts.
    const shiftIds = (await sql`SELECT id FROM shift_configs ORDER BY "orderIndex"`).map((s) => s.id);
    let cd = 0, cds = 0;
    for (let d = 0; d < 7; d++) {
      const dt = new Date(); dt.setHours(0, 0, 0, 0); dt.setDate(dt.getDate() + d);
      const iso = dt.toISOString().slice(0, 10);
      const isSunday = dt.getDay() === 0;
      const dayType = isSunday ? 'holiday' : 'working';
      const ins = await sql`INSERT INTO calendar_days ("calendarId",date,"dayType")
        VALUES (${calId},${iso},${dayType}) ON CONFLICT ("calendarId",date) DO NOTHING RETURNING id`;
      if (ins.length) cd++;
      const [day] = ins.length ? ins : await sql`SELECT id FROM calendar_days WHERE "calendarId"=${calId} AND date=${iso}`;
      if (!isSunday) {
        for (const sid of shiftIds) {
          const r = await sql`INSERT INTO calendar_day_shifts ("calendarDayId","shiftConfigId","isActive")
            VALUES (${day.id},${sid},true) ON CONFLICT ("calendarDayId","shiftConfigId") DO NOTHING RETURNING id`;
          if (r.length) cds++;
        }
      }
    }
    log(`plant_calendars +${pc}, calendar_days +${cd}, calendar_day_shifts +${cds}`);

    const warehouses = [
      ['WH-RAW', 'Kho nguyên vật liệu SMT', 'raw'],
      ['WH-FG', 'Kho thành phẩm', 'fg'],
    ];
    let wh = 0;
    for (const [code, name, type] of warehouses) {
      const r = await sql`INSERT INTO warehouses (code,name,"factoryCode",type,"isActive")
        VALUES (${code},${name},${FAC},${type},true) ON CONFLICT (code) DO NOTHING RETURNING id`;
      if (r.length) wh++;
    }
    const whIdByCode = new Map((await sql`SELECT id, code FROM warehouses`).map((x) => [x.code, x.id]));

    // [warehouseCode, locationCode, name, kind]
    const locations = [
      ['WH-RAW', 'RM-A-01', 'Kệ A hàng 1', 'shelf'], ['WH-RAW', 'RM-A-02', 'Kệ A hàng 2', 'shelf'],
      ['WH-RAW', 'RM-B-01', 'Kệ B hàng 1', 'shelf'], ['WH-RAW', 'REEL-01', 'Tủ cuộn SMD 01', 'bin'],
      ['WH-RAW', 'REEL-02', 'Tủ cuộn SMD 02', 'bin'], ['WH-FG', 'FG-Z-01', 'Khu thành phẩm 1', 'zone'],
    ];
    let lo = 0;
    for (const [whc, code, name, kind] of locations) {
      const wid = whIdByCode.get(whc); if (!wid) continue;
      const r = await sql`INSERT INTO storage_locations ("warehouseId",code,name,kind,"isActive")
        VALUES (${wid},${code},${name},${kind},true) ON CONFLICT ("warehouseId",code) DO NOTHING RETURNING id`;
      if (r.length) lo++;
    }
    log(`warehouses +${wh}, storage_locations +${lo}`);

    // [materialCode, warehouseCode, locationCode, lotCode, qty, uom]
    const balances = [
      ['RES-0402-10K', 'WH-RAW', 'REEL-01', 'LOT-2601', '50000', 'pcs'],
      ['CAP-0402-100N', 'WH-RAW', 'REEL-02', 'LOT-2602', '42000', 'pcs'],
      ['IC-MCU-STM32', 'WH-RAW', 'RM-A-01', 'LOT-2603', '1200', 'pcs'],
      ['LED-0603-GRN', 'WH-RAW', 'RM-A-02', 'LOT-2604', '8000', 'pcs'],
      ['SOLDER-SAC305-T4', 'WH-RAW', 'RM-B-01', 'LOT-2605', '5000', 'g'],
      ['IC-FPGA-BGA256', 'WH-RAW', 'RM-A-01', 'LOT-2606', '300', 'pcs'],
    ];
    let ib = 0;
    for (const [mc, whc, loc, lot, qty, uom] of balances) {
      const r = await sql`INSERT INTO inventory_balances ("materialCode","warehouseCode","locationCode","lotCode","quantityOnHand","uomCode")
        VALUES (${mc},${whc},${loc},${lot},${qty},${uom})
        ON CONFLICT ("materialCode","warehouseCode","locationCode","lotCode") DO NOTHING RETURNING id`;
      if (r.length) ib++;
    }
    log(`inventory_balances +${ib}`);
  } catch (e) { console.error('[seed-master] calendar/warehouse/inventory LỖI:', e.message); }

  // ═══════════════ 5. Routing master + steps (SMT line sequence) ═══════════════
  try {
    // SPI → Print → Place → Reflow → AOI → ICT → FCT (ISA-95 operation sequence).
    const steps = [
      [10, 'PRINT', 'In kem hàn (stencil printer)', 'Stencil Printer', 25],
      [20, 'SPI', 'Kiểm tra kem hàn (SPI)', 'SPI', 12],
      [30, 'PLACE', 'Gắp đặt linh kiện (pick & place)', 'Mounter', 40],
      [40, 'REFLOW', 'Hàn reflow', 'Reflow Oven', 300],
      [50, 'AOI', 'Kiểm tra quang học (AOI)', 'AOI', 18],
      [60, 'ICT', 'Kiểm tra trong mạch (ICT)', 'ICT', 45],
      [70, 'FCT', 'Kiểm tra chức năng (FCT)', 'FCT', 60],
    ];
    // [productModelCode, routingCode, name]
    const routings = [
      ['GB300', 'RT-GB300', 'Tuyến công nghệ GB300'],
      ['SIM-PCB-MAIN', 'RT-SIM-PCB-MAIN', 'Tuyến công nghệ SIM Bo mạch chính'],
      ['SIM-PCB-SENSOR', 'RT-SIM-PCB-SENSOR', 'Tuyến công nghệ SIM Bo cảm biến'],
    ];
    let rm = 0, rs = 0;
    for (const [pmCode, rtCode, name] of routings) {
      const [pm] = await sql`SELECT id FROM product_models WHERE code=${pmCode} AND "deletedAt" IS NULL ORDER BY id LIMIT 1`;
      if (!pm) continue;
      const ins = await sql`INSERT INTO routing_master ("productModelId",code,version,name,description,status,"createdBy")
        VALUES (${pm.id},${rtCode},1,${name},'Seed routing — SMT line','active',${adminId})
        ON CONFLICT (code,version) DO NOTHING RETURNING id`.catch(async () => {
          // 'active' partial-unique may reject a 2nd active for same product — fall back to draft.
          return sql`INSERT INTO routing_master ("productModelId",code,version,name,description,status,"createdBy")
            VALUES (${pm.id},${rtCode},1,${name},'Seed routing — SMT line','draft',${adminId})
            ON CONFLICT (code,version) DO NOTHING RETURNING id`;
        });
      const [rt] = ins.length ? ins : await sql`SELECT id FROM routing_master WHERE code=${rtCode} AND version=1`;
      if (ins.length) rm++;
      for (const [no, op, desc, station, secs] of steps) {
        const r = await sql`INSERT INTO routing_steps ("routingId","stepNo","operationCode","stationOrMachineType","standardTimeSec",description)
          VALUES (${rt.id},${no},${op},${station},${secs},${desc})
          ON CONFLICT ("routingId","stepNo") DO NOTHING RETURNING id`;
        if (r.length) rs++;
      }
    }
    log(`routing_master +${rm}, routing_steps +${rs}`);
  } catch (e) { console.error('[seed-master] routing LỖI:', e.message); }

  // ═══════════════ 6. BOM definitions + line items (link materials) ═══════════════
  try {
    const matIdByCode = new Map((await sql`SELECT id, code FROM materials`).map((x) => [x.code, x.id]));
    // [productModelCode, bomCode, name, lines[]]  line = [componentCode, componentName, qtyPer, refDesignator]
    const boms = [
      ['SIM-PCB-MAIN', 'BOM-SIM-PCB-MAIN', 'BOM SIM Bo mạch chính', [
        ['IC-MCU-STM32', 'MCU STM32F103', '1', 'U3'],
        ['IC-FPGA-BGA256', 'FPGA Artix-7', '1', 'U1'],
        ['TRANS-MMBT3904', 'Transistor NPN', '1', 'Q1'],
        ['CAP-0805-10U', 'Tụ 10µF', '1', 'C12'],
        ['RES-0603-1K', 'Điện trở 1kΩ', '1', 'R7'],
        ['RES-0402-10K', 'Điện trở 10kΩ', '2', 'R1,R2'],
        ['CAP-0402-100N', 'Tụ 100nF', '3', 'C1,C2,C3'],
        ['CAP-0402-22P', 'Tụ 22pF', '2', 'C4,C5'],
        ['XTAL-8MHZ', 'Thạch anh 8MHz', '1', 'Y1'],
        ['LED-0603-GRN', 'LED xanh', '1', 'D1'],
      ]],
      ['SIM-PCB-SENSOR', 'BOM-SIM-PCB-SENSOR', 'BOM SIM Bo cảm biến', [
        ['CONN-USB-C', 'Đầu nối USB-C', '1', 'J1'],
        ['RES-2512-0R05', 'Điện trở shunt 0.05Ω', '1', 'R1'],
        ['IC-OPAMP-LM358', 'Op-amp LM358', '1', 'U2'],
        ['CAP-0603-1U', 'Tụ 1µF', '2', 'C1,C2'],
        ['RES-0805-100R', 'Điện trở 100Ω', '1', 'R3'],
        ['CAP-TANT-10U', 'Tụ tantalum 10µF', '1', 'CT1'],
        ['LED-0603-GRN', 'LED xanh', '1', 'D1'],
      ]],
    ];
    let bd = 0, bl = 0;
    for (const [pmCode, bomCode, name, lines] of boms) {
      const [pm] = await sql`SELECT id FROM product_models WHERE code=${pmCode} AND "deletedAt" IS NULL ORDER BY id LIMIT 1`;
      if (!pm) continue;
      const ins = await sql`INSERT INTO bom_definitions ("productModelId",code,version,name,status,"createdBy","isActive")
        VALUES (${pm.id},${bomCode},1,${name},'active',${adminId},true)
        ON CONFLICT ("productModelId",code,version) DO NOTHING RETURNING id`;
      const [bom] = ins.length ? ins : await sql`SELECT id FROM bom_definitions WHERE "productModelId"=${pm.id} AND code=${bomCode} AND version=1`;
      if (ins.length) bd++;
      // bom_line_items has NO unique key → gate on "does this BOM already have lines?"
      const [{ n: existing }] = await sql`SELECT count(*)::int n FROM bom_line_items WHERE "bomId"=${bom.id}`;
      if (existing > 0) continue;
      for (const [cc, cn, qty, ref] of lines) {
        await sql`INSERT INTO bom_line_items ("bomId","componentCode","materialId","componentName","qtyPer",unit,"refDesignator")
          VALUES (${bom.id},${cc},${matIdByCode.get(cc) ?? null},${cn},${qty},'pcs',${ref})`;
        bl++;
      }
    }
    log(`bom_definitions +${bd}, bom_line_items +${bl}`);
  } catch (e) { console.error('[seed-master] BOM LỖI:', e.message); }

  // ═══════════════ 7. Component footprints (IPC-7351 nominal geometry) ═══════════════
  try {
    const pkgs = await sql`SELECT id, code, "ipcName", family, "mountType", "bodyLengthMm", "bodyWidthMm", "bodyHeightMm", "pinCount", "pitchMm", "leadType" FROM component_packages WHERE "isActive"=true ORDER BY id`;
    let fp = 0, skipped = 0;
    for (const pkg of pkgs) {
      const f = genFootprint(pkg);
      if (!f) { skipped++; continue; }
      const r = await sql`INSERT INTO component_footprints ("packageId",code,density,"padCount",geometry,"courtyardMm")
        VALUES (${pkg.id},${f.code},${f.density},${f.padCount},${jb(f.geometry)},${jb(f.courtyard)})
        ON CONFLICT ("packageId",code) DO NOTHING RETURNING id`;
      if (r.length) fp++;
    }
    log(`component_footprints +${fp} (bỏ qua ${skipped} package thiếu body/pin geometry)`);
  } catch (e) { console.error('[seed-master] footprints LỖI:', e.message); }

  // ═══════════════ 8. Backfill measurement_point_defs.componentCode (traceability/Pareto) ═══════════════
  try {
    // Explicit per-point map derived from the SIM/GB300 points' feature names (refdes-encoded).
    // [productModelCode, pointCode, componentCode, refDesignator]
    const explicit = [
      ['SIM-PCB-MAIN', 'MP-SLDR-H', 'TRANS-MMBT3904', 'Q1'],
      ['SIM-PCB-MAIN', 'MP-OFFS-X', 'IC-MCU-STM32', 'U3'],
      ['SIM-PCB-MAIN', 'MP-COMP-H', 'CAP-0805-10U', 'C12'],
      ['SIM-PCB-MAIN', 'MP-SLDR-V', 'RES-0603-1K', 'R7'],
      ['SIM-PCB-MAIN', 'MP-COPLAN', 'IC-FPGA-BGA256', 'U1'],
      ['SIM-PCB-MAIN', 'MP-OCR', 'IC-MCU-STM32', 'U3'],
      ['SIM-PCB-SENSOR', 'MP-PAD-W', 'CONN-USB-C', 'J1'],
      ['SIM-PCB-SENSOR', 'MP-GAP', 'CONN-USB-C', 'J1'],
      ['SIM-PCB-SENSOR', 'MP-RES', 'RES-2512-0R05', 'R1'],
      ['SIM-PCB-SENSOR', 'MP-HEIGHT', 'CONN-USB-C', 'J1'],
      ['SIM-PCB-SENSOR', 'MP-TILT', 'LED-0603-GRN', 'D1'],
      ['SIM-PCB-SENSOR', 'MP-COLOR', 'LED-0603-GRN', 'D1'],
      ['GB300', 'AREA1', 'RES-0402-10K', 'R1'],
      ['GB300', 'MP-002', 'CAP-0402-100N', 'C1'],
    ];
    // Resolve product ids once.
    const pmIdByCode = new Map();
    for (const c of ['SIM-PCB-MAIN', 'SIM-PCB-SENSOR', 'GB300', '__UNMAPPED__']) {
      const [pm] = await sql`SELECT id FROM product_models WHERE code=${c} AND "deletedAt" IS NULL ORDER BY id LIMIT 1`;
      if (pm) pmIdByCode.set(c, pm.id);
    }
    let bf = 0;
    for (const [pmCode, pc, cc, ref] of explicit) {
      const pmId = pmIdByCode.get(pmCode); if (!pmId) continue;
      const r = await sql`UPDATE measurement_point_defs
        SET "componentCode"=${cc}, "refDesignator"=COALESCE("refDesignator",${ref})
        WHERE "productModelId"=${pmId} AND code=${pc} AND "deletedAt" IS NULL RETURNING id`;
      bf += r.length;
    }
    // Representative round-robin for the __UNMAPPED__ pseudo-product's generic BP points
    // (gives the component-package Pareto real variety across families).
    const rr = [
      ['RES-0402-10K', 'R'], ['CAP-0402-100N', 'C'], ['IC-MCU-STM32', 'U'], ['LED-0603-GRN', 'D'],
      ['TRANS-MMBT3904', 'Q'], ['RES-0603-1K', 'R'], ['CAP-0805-10U', 'C'], ['DIODE-BAT54', 'D'],
    ];
    const unmappedId = pmIdByCode.get('__UNMAPPED__');
    if (unmappedId) {
      const pts = await sql`SELECT id, code FROM measurement_point_defs WHERE "productModelId"=${unmappedId} AND "deletedAt" IS NULL ORDER BY code`;
      let i = 0;
      for (const pt of pts) {
        const [cc, letter] = rr[i % rr.length];
        const r = await sql`UPDATE measurement_point_defs
          SET "componentCode"=${cc}, "refDesignator"=COALESCE("refDesignator",${letter + (i + 1)})
          WHERE id=${pt.id} RETURNING id`;
        bf += r.length;
        i++;
      }
    }
    const [{ n: withCc }] = await sql`SELECT count(*)::int n FROM measurement_point_defs WHERE "componentCode" IS NOT NULL AND "deletedAt" IS NULL`;
    log(`measurement_point_defs backfill: ${bf} điểm cập nhật componentCode (tổng điểm live có componentCode = ${withCc})`);
  } catch (e) { console.error('[seed-master] point backfill LỖI:', e.message); }

  // ═══════════════ Summary counts ═══════════════
  try {
    const tables = ['units_of_measure', 'unit_conversions', 'suppliers', 'material_classes', 'materials',
      'customers', 'skills', 'tools', 'user_certifications', 'plant_calendars', 'calendar_days',
      'calendar_day_shifts', 'warehouses', 'storage_locations', 'inventory_balances', 'routing_master',
      'routing_steps', 'bom_definitions', 'bom_line_items', 'component_footprints'];
    const parts = [];
    for (const t of tables) {
      const [{ n }] = await sql.unsafe(`SELECT count(*)::int n FROM ${t}`);
      parts.push(`${t}=${n}`);
    }
    log('TỔNG HÀNG:', parts.join(', '));
  } catch (e) { console.error('[seed-master] summary LỖI:', e.message); }

  log('✅ HOÀN TẤT seed master data (doc 54 §11 P0.2).');
}

main()
  .catch((e) => { console.error('[seed-master] LỖI TOÀN CỤC:', e); process.exitCode = 1; })
  .finally(() => sql.end());
