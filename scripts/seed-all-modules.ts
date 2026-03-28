/**
 * Comprehensive Seed Script for AVI/AOI Factory Management System
 * Seeds ALL modules with realistic Vietnamese manufacturing data.
 *
 * Usage: npx tsx scripts/seed-all-modules.ts
 *
 * Modules seeded (in dependency order):
 *  1. Users & Auth (admin, supervisor, operator, etc.)
 *  2. Permissions per user
 *  3. User Roles (system role templates)
 *  4. Hierarchy: Factories → Workshops → Lines → Stations → Machines → Workstations
 *  5. Product Categories, Product Models, Measurement Point Definitions
 *  6. Product-Machine Mappings
 *  7. Shift Configs
 *  8. Processes & Line Process Assignments
 *  9. Production Orders & Line Product Assignments
 * 10. Inspections + Measurement Results (48h of data)
 * 11. Daily Statistics
 * 12. Alert Settings & Yield Thresholds
 * 13. SPC Configurations & Quality Gates
 * 14. System Settings
 */
// Load environment variables
import 'dotenv/config';
import {
  getDb,
  createFactory,
  createWorkshop,
  createProductionLine,
  createStation,
  createMachine,
  createLocalUser,
  createProductModel,
  createProductInspection,
  createMeasurementResults,
  createShiftConfig,
  createProductionOrder,
  createLineStage,
  createLineProductAssignment,
  createProcess,
  createAlertSetting,
  createSpcConfiguration,
  getFactories,
  getWorkshops,
  getProductionLines,
  getStations,
  getMachines,
  getProductModels,
  upsertDailyStatistics,
} from '../server/db';

import { sql } from 'drizzle-orm';

// ───────────── Helpers ─────────────

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number, decimals = 2): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateApiKey(): string {
  const chars = 'abcdef0123456789';
  let key = 'avi_';
  for (let i = 0; i < 48; i++) key += chars[Math.floor(Math.random() * chars.length)];
  return key;
}

async function safeCreate<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    const result = await fn();
    console.log(`  ✅ ${label}`);
    return result;
  } catch (e: any) {
    if (e.message?.includes('duplicate') || e.message?.includes('unique') || e.code === '23505') {
      console.log(`  ⚠️  ${label} — already exists, skipping`);
    } else {
      console.log(`  ❌ ${label} — ${e.message}`);
    }
    return null;
  }
}

// ───────────── 1. USERS ─────────────

async function seedUsers() {
  console.log('\n👤 Seeding Users...');
  const bcrypt = await import('bcryptjs');
  const hash = await bcrypt.hash('Admin@123', 10);

  const userData = [
    { username: 'admin',       name: 'Quản trị viên',       role: 'admin' as const,  department: 'IT',               position: 'System Admin',     email: 'admin@avi-aoi.vn' },
    { username: 'supervisor1', name: 'Nguyễn Văn Hùng',     role: 'admin' as const,  department: 'Sản xuất',         position: 'Giám sát trưởng',  email: 'hung.nv@avi-aoi.vn' },
    { username: 'qc_lead',     name: 'Trần Thị Mai',        role: 'user'  as const,  department: 'Chất lượng',       position: 'QC Lead',          email: 'mai.tt@avi-aoi.vn' },
    { username: 'operator1',   name: 'Lê Minh Tuấn',        role: 'user'  as const,  department: 'Sản xuất',         position: 'Vận hành máy',     email: 'tuan.lm@avi-aoi.vn' },
    { username: 'operator2',   name: 'Phạm Thanh Hương',    role: 'user'  as const,  department: 'Sản xuất',         position: 'Vận hành máy',     email: 'huong.pt@avi-aoi.vn' },
    { username: 'maintenance1',name: 'Đỗ Quang Minh',       role: 'user'  as const,  department: 'Bảo trì',          position: 'Kỹ thuật viên',    email: 'minh.dq@avi-aoi.vn' },
    { username: 'viewer1',     name: 'Hoàng Thị Lan',       role: 'user'  as const,  department: 'Ban Giám đốc',     position: 'Trợ lý GĐ',       email: 'lan.ht@avi-aoi.vn' },
  ];

  const createdUsers: Array<{ id: number; username: string; role: string }> = [];

  for (const u of userData) {
    const result = await safeCreate(`User: ${u.username}`, () =>
      createLocalUser({ username: u.username, passwordHash: hash, name: u.name, email: u.email, department: u.department, position: u.position, role: u.role })
    );
    if (result) createdUsers.push({ id: result.id, username: u.username, role: u.role });
  }

  // Fallback: fetch existing users that weren't created (already existed)
  if (createdUsers.length < userData.length) {
    const db = await getDb();
    if (db) {
      for (const u of userData) {
        if (!createdUsers.find(c => c.username === u.username)) {
          const rows = await db.execute(sql`SELECT id, username, role FROM users WHERE username = ${u.username} LIMIT 1`);
          const row = (rows as unknown as Array<{ id: number; username: string; role: string }>)[0];
          if (row) {
            createdUsers.push({ id: row.id, username: row.username, role: row.role });
            console.log(`  📋 Loaded existing user: ${u.username} (id=${row.id})`);
          }
        }
      }
    }
  }

  // Update extended roles via raw SQL (createLocalUser only accepts 'user'|'admin')
  const db = await getDb();
  if (db && createdUsers.length > 0) {
    const roleMap: Record<string, string> = {
      supervisor1: 'supervisor',
      qc_lead:     'quality_inspector',
      operator1:   'operator',
      operator2:   'operator',
      maintenance1:'maintenance',
      viewer1:     'viewer',
    };
    for (const u of createdUsers) {
      const extRole = roleMap[u.username];
      if (extRole) {
        await db.execute(sql`UPDATE users SET role = ${extRole} WHERE id = ${u.id}`);
        console.log(`  🔄 Updated ${u.username} → role=${extRole}`);
      }
    }
  }

  return createdUsers;
}

// ───────────── 2. PERMISSIONS ─────────────

async function seedPermissions(users: Array<{ id: number; username: string }>) {
  console.log('\n🔐 Seeding Permissions...');
  const db = await getDb();
  if (!db || users.length === 0) return;

  const categories = ['dashboard','history','analytics','reports','mqtt','settings','admin','production','machine_monitoring','annotations'] as const;
  const modules = ['dashboard','inspection_history','analytics_reports','spc','production','machines','alerts','system_settings','user_management','mqtt_monitor'];

  // Admin gets everything
  const adminUser = users.find(u => u.username === 'admin');
  if (adminUser) {
    for (let i = 0; i < modules.length; i++) {
      await safeCreate(`Permission: admin/${modules[i]}`, () =>
        db.execute(sql`INSERT INTO permissions ("userId","category","moduleName","canView","canCreate","canEdit","canDelete","canExport") VALUES (${adminUser.id},${categories[i]},${modules[i]},true,true,true,true,true) ON CONFLICT ("userId","moduleName") DO NOTHING`)
      );
    }
  }

  // Operator: view dashboard, production, machines; submit inspections
  const operators = users.filter(u => u.username.startsWith('operator'));
  for (const op of operators) {
    for (const mod of ['dashboard','production','machines'] as const) {
      const idx = modules.indexOf(mod === 'machines' ? 'machines' : mod);
      const cat = idx >= 0 ? categories[idx] : 'dashboard';
      await safeCreate(`Permission: ${op.username}/${mod}`, () =>
        db.execute(sql`INSERT INTO permissions ("userId","category","moduleName","canView","canCreate","canEdit","canDelete","canExport") VALUES (${op.id},${cat},${mod},true,true,false,false,false) ON CONFLICT ("userId","moduleName") DO NOTHING`)
      );
    }
  }
}

// ───────────── 3. USER ROLES ─────────────

async function seedUserRoles() {
  console.log('\n📋 Seeding User Role Templates...');
  const db = await getDb();
  if (!db) return;

  // The migration 0060 already inserts default roles, so just ensure they exist
  const roles = [
    { name: 'Admin',             description: 'Full system access',                       permissions: { all: true } },
    { name: 'Supervisor',        description: 'Workshop supervisor',                      permissions: { dashboard: true, production: true, analytics: true, history: true } },
    { name: 'Quality Inspector', description: 'QC specialist - quality control & reports', permissions: { dashboard: true, history: true, analytics: true, reports: true, annotations: true } },
    { name: 'Operator',          description: 'Machine operator',                         permissions: { dashboard: true, production: true, machine_monitoring: true } },
    { name: 'Maintenance',       description: 'Maintenance technician',                   permissions: { dashboard: true, machine_monitoring: true, mqtt: true } },
    { name: 'Viewer',            description: 'Read-only access',                         permissions: { dashboard: true, history: true, reports: true } },
  ];
  for (const r of roles) {
    await safeCreate(`Role: ${r.name}`, () =>
      db.execute(sql`INSERT INTO user_roles (name, description, permissions, "isSystem") VALUES (${r.name}, ${r.description}, ${JSON.stringify(r.permissions)}::jsonb, true) ON CONFLICT (name) DO NOTHING`)
    );
  }
}

// ───────────── 4. HIERARCHY ─────────────

interface HierarchyIds {
  factories:  Array<{ id: number; code: string }>;
  workshops:  Array<{ id: number; code: string; factoryId: number }>;
  lines:      Array<{ id: number; code: string; workshopId: number }>;
  stations:   Array<{ id: number; code: string; lineId: number }>;
  machines:   Array<{ id: number; code: string; stationId: number; machineType: string }>;
}

async function seedHierarchy(): Promise<HierarchyIds> {
  console.log('\n🏭 Seeding Hierarchy...');

  const h: HierarchyIds = { factories: [], workshops: [], lines: [], stations: [], machines: [] };

  // Factories
  const factoriesData = [
    { code: 'FAC-HN',  name: 'Nhà máy Hà Nội',       address: 'KCN Thăng Long, Đông Anh, Hà Nội',  description: 'Nhà máy sản xuất linh kiện điện tử', region: 'Miền Bắc', country: 'Việt Nam' },
    { code: 'FAC-BN',  name: 'Nhà máy Bắc Ninh',      address: 'KCN VSIP Bắc Ninh',                  description: 'Nhà máy lắp ráp PCB',                region: 'Miền Bắc', country: 'Việt Nam' },
    { code: 'FAC-HP',  name: 'Nhà máy Hải Phòng',     address: 'KCN VSIP Hải Phòng',                 description: 'Nhà máy sản xuất module camera',      region: 'Miền Bắc', country: 'Việt Nam' },
  ];

  for (const f of factoriesData) {
    const id = await safeCreate(`Factory: ${f.code}`, () => createFactory(f));
    if (id) h.factories.push({ id: Number(id), code: f.code });
  }
  if (h.factories.length === 0) {
    const existing = await getFactories();
    for (const f of existing) h.factories.push({ id: Number(f.id), code: f.code });
    console.log(`  📋 Using ${h.factories.length} existing factories`);
  }

  // Workshops (3 per factory)
  const workshopSuffixes = [
    { suffix: 'SMT',  name: 'Xưởng SMT',     desc: 'Surface Mount Technology', area: '2500' },
    { suffix: 'DIP',  name: 'Xưởng DIP',     desc: 'Dual In-line Package',     area: '1800' },
    { suffix: 'TEST', name: 'Xưởng Testing', desc: 'Kiểm tra chất lượng',      area: '1200' },
  ];

  for (const fac of h.factories) {
    for (const ws of workshopSuffixes) {
      const code = `${fac.code}-${ws.suffix}`;
      const id = await safeCreate(`Workshop: ${code}`, () =>
        createWorkshop({ factoryId: fac.id, code, name: `${ws.name} - ${fac.code}`, description: ws.desc, floorArea: ws.area })
      );
      if (id) h.workshops.push({ id: Number(id), code, factoryId: fac.id });
    }
  }
  if (h.workshops.length === 0) {
    const existing = await getWorkshops();
    for (const w of existing) h.workshops.push({ id: Number(w.id), code: w.code, factoryId: Number(w.factoryId) });
    console.log(`  📋 Using ${h.workshops.length} existing workshops`);
  }

  // Production Lines (2 per workshop)
  for (const ws of h.workshops) {
    for (const suffix of ['A', 'B']) {
      const code = `${ws.code}-L${suffix}`;
      const id = await safeCreate(`Line: ${code}`, () =>
        createProductionLine({ workshopId: ws.id, code, name: `Dây chuyền ${suffix} - ${ws.code}`, capacityPerHour: randomInt(200, 500) })
      );
      if (id) h.lines.push({ id: Number(id), code, workshopId: ws.id });
    }
  }
  if (h.lines.length === 0) {
    const existing = await getProductionLines();
    for (const l of existing) h.lines.push({ id: Number(l.id), code: l.code, workshopId: Number(l.workshopId) });
    console.log(`  📋 Using ${h.lines.length} existing lines`);
  }

  // Stations (3 per line)
  const stationNames = ['Pre-Inspection', 'Main-Inspection', 'Post-Inspection'];
  for (const line of h.lines) {
    for (let i = 0; i < stationNames.length; i++) {
      const code = `${line.code}-ST${i + 1}`;
      const id = await safeCreate(`Station: ${code}`, () =>
        createStation({ lineId: line.id, code, name: `${stationNames[i]} - ${line.code}`, orderIndex: i + 1 })
      );
      if (id) h.stations.push({ id: Number(id), code, lineId: line.id });
    }
  }
  if (h.stations.length === 0) {
    const existing = await getStations();
    for (const s of existing) h.stations.push({ id: Number(s.id), code: s.code, lineId: Number(s.lineId) });
    console.log(`  📋 Using ${h.stations.length} existing stations`);
  }

  // Machines (1 per station)
  const machineTypes = ['AVI', 'AOI'] as const;
  const machineModels = { AVI: ['KY-8000', 'KY-8030', 'Zenith-II'], AOI: ['Mirtec MV-6', 'Koh Young Zenith', 'Omron VT-S730'] };
  const mfrs = { AVI: ['Koh Young', 'Mirtec'], AOI: ['Mirtec', 'Koh Young', 'Omron'] };

  for (const st of h.stations) {
    const mType = randomChoice([...machineTypes]);
    const code = `MCH-${st.code}`;
    const id = await safeCreate(`Machine: ${code}`, () =>
      createMachine({
        stationId: st.id, code, name: `Máy ${mType} - ${st.code}`,
        machineType: mType,
        model: randomChoice(machineModels[mType]),
        manufacturer: randomChoice(mfrs[mType]),
        apiKey: generateApiKey(),
        registrationStatus: 'approved',
        operationStatus: 'running',
      })
    );
    if (id) h.machines.push({ id: Number(id), code, stationId: st.id, machineType: mType });
  }
  if (h.machines.length === 0) {
    const existing = await getMachines();
    for (const m of existing) h.machines.push({ id: Number(m.id), code: m.code, stationId: Number(m.stationId), machineType: m.machineType });
    console.log(`  📋 Using ${h.machines.length} existing machines`);
  }

  // Workstations
  const db = await getDb();
  if (db) {
    const wsTypes = ['SMT', 'DIP', 'ASSEMBLY', 'TESTING'] as const;
    for (const line of h.lines.slice(0, 6)) {
      for (let i = 0; i < 4; i++) {
        const code = `WS-${line.code}-${i + 1}`;
        await safeCreate(`Workstation: ${code}`, () =>
          db.execute(sql`INSERT INTO workstations (code, name, description, "lineId", "processType", "isActive") VALUES (${code}, ${`Công trạm ${wsTypes[i]} - ${line.code}`}, ${`Workstation ${wsTypes[i]}`}, ${line.id}, ${wsTypes[i]}, true) ON CONFLICT (code) DO NOTHING`)
        );
      }
    }
  }

  return h;
}

// ───────────── 5. PRODUCTS ─────────────

async function seedProducts(machines: Array<{ id: number; code: string }>) {
  console.log('\n📦 Seeding Product Categories & Models...');
  const db = await getDb();
  if (!db) return [];

  // Categories
  const categories = [
    { code: 'PCB', name: 'Bo mạch PCB', description: 'Bo mạch in' },
    { code: 'MODULE', name: 'Module điện tử', description: 'Module lắp ráp' },
    { code: 'CAMERA', name: 'Module Camera', description: 'Module camera cho thiết bị di động' },
  ];
  for (const cat of categories) {
    await safeCreate(`Category: ${cat.code}`, () =>
      db.execute(sql`INSERT INTO product_categories (code, name, description, "isActive") VALUES (${cat.code}, ${cat.name}, ${cat.description}, true) ON CONFLICT (code) DO NOTHING`)
    );
  }

  // Product Models
  const productsData = [
    { code: 'PCB-A100', name: 'Main Board A100',        category: 'PCB',    targetYield: '95.00', minYield: '90.00', lifecycle: 'active' as const },
    { code: 'PCB-B200', name: 'Power Board B200',       category: 'PCB',    targetYield: '97.00', minYield: '93.00', lifecycle: 'active' as const },
    { code: 'MOD-C300', name: 'WiFi Module C300',       category: 'MODULE', targetYield: '96.00', minYield: '91.00', lifecycle: 'active' as const },
    { code: 'MOD-D400', name: 'Bluetooth Module D400',  category: 'MODULE', targetYield: '94.00', minYield: '89.00', lifecycle: 'active' as const },
    { code: 'CAM-E500', name: 'Camera Module 12MP',     category: 'CAMERA', targetYield: '92.00', minYield: '87.00', lifecycle: 'active' as const },
    { code: 'PCB-F600', name: 'Sensor Board F600',      category: 'PCB',    targetYield: '96.50', minYield: '92.00', lifecycle: 'development' as const },
  ];

  const createdProducts: Array<{ id: number; code: string }> = [];

  for (const p of productsData) {
    const id = await safeCreate(`Product: ${p.code}`, () =>
      createProductModel({
        code: p.code, name: p.name, category: p.category,
        lifecycleStatus: p.lifecycle,
        targetYieldRate: p.targetYield, minYieldRate: p.minYield,
        imageWidth: 1920, imageHeight: 1080,
      })
    );
    if (id) createdProducts.push({ id: Number(id), code: p.code });
  }

  if (createdProducts.length === 0) {
    const existing = await getProductModels({ isActive: true });
    for (const p of existing) createdProducts.push({ id: Number(p.id), code: p.code });
    console.log(`  📋 Using ${createdProducts.length} existing products`);
  }

  // Measurement Point Definitions (5 per product)
  console.log('\n📐 Seeding Measurement Point Definitions...');
  const measurementTypes = ['DIMENSION', 'VISUAL', 'ELECTRICAL', 'POSITION', 'SURFACE'] as const;
  const pointNames = ['Solder Joint', 'IC Placement', 'Capacitor Position', 'Resistor Value', 'Connector Pin'];

  for (const prod of createdProducts) {
    for (let i = 0; i < 5; i++) {
      const code = `${prod.code}-MP${(i + 1).toString().padStart(2, '0')}`;
      await safeCreate(`MeasurementPoint: ${code}`, () =>
        db.execute(sql`INSERT INTO measurement_point_defs ("productModelId", code, name, "measurementType", unit, "lowerLimit", "upperLimit", "nominalValue", "positionX", "positionY", radius, "cropWidth", "cropHeight", "orderIndex", "isActive") VALUES (${prod.id}, ${code}, ${`${pointNames[i]} - ${prod.code}`}, ${measurementTypes[i]}, ${'mm'}, ${randomFloat(0.1, 1.0, 6).toString()}, ${randomFloat(2.0, 5.0, 6).toString()}, ${randomFloat(1.0, 3.0, 6).toString()}, ${randomInt(100, 1800)}, ${randomInt(100, 1000)}, ${20}, ${100}, ${100}, ${i}, true) ON CONFLICT DO NOTHING`)
      );
    }
  }

  // Product-Machine Mappings
  console.log('\n🔗 Seeding Product-Machine Mappings...');
  if (machines.length > 0 && createdProducts.length > 0) {
    for (const prod of createdProducts) {
      const assignedMachines = machines.slice(0, Math.min(3, machines.length));
      for (const m of assignedMachines) {
        await safeCreate(`Mapping: ${prod.code} → ${m.code}`, () =>
          db.execute(sql`INSERT INTO product_machine_mappings ("productModelId", "machineId", "isActive", priority) VALUES (${prod.id}, ${m.id}, true, ${0}) ON CONFLICT DO NOTHING`)
        );
      }
    }
  }

  return createdProducts;
}

// ───────────── 6. SHIFT CONFIGS ─────────────

async function seedShiftConfigs(factories: Array<{ id: number }>) {
  console.log('\n⏰ Seeding Shift Configs...');
  const shifts = [
    { name: 'Ca sáng',  code: 'SHIFT_1', startHour: 6, endHour: 14, order: 0 },
    { name: 'Ca chiều', code: 'SHIFT_2', startHour: 14, endHour: 22, order: 1 },
    { name: 'Ca đêm',   code: 'SHIFT_3', startHour: 22, endHour: 6,  order: 2 },
  ];

  // Global shifts (factoryId = null)
  for (const s of shifts) {
    await safeCreate(`Shift: ${s.code} (global)`, () =>
      createShiftConfig({ name: s.name, code: s.code, startHour: s.startHour, endHour: s.endHour, orderIndex: s.order })
    );
  }
}

// ───────────── 7. PROCESSES ─────────────

async function seedProcesses(lines: Array<{ id: number; code: string }>) {
  console.log('\n⚙️ Seeding Processes...');

  const processesData = [
    { code: 'SMT-PRINT',   name: 'In kem hàn',        type: 'SMT' as const,      cycleTime: '3.50', color: '#3b82f6', icon: 'printer',    order: 0 },
    { code: 'SMT-PLACE',   name: 'Gắn linh kiện SMT', type: 'SMT' as const,      cycleTime: '5.00', color: '#10b981', icon: 'cpu',        order: 1 },
    { code: 'SMT-REFLOW',  name: 'Hàn reflow',        type: 'SMT' as const,      cycleTime: '8.00', color: '#f59e0b', icon: 'flame',      order: 2 },
    { code: 'DIP-INSERT',  name: 'Cắm linh kiện DIP', type: 'DIP' as const,      cycleTime: '10.00', color: '#8b5cf6', icon: 'plug',      order: 3 },
    { code: 'DIP-WAVE',    name: 'Hàn sóng',          type: 'DIP' as const,      cycleTime: '6.00', color: '#ec4899', icon: 'waves',      order: 4 },
    { code: 'TEST-AOI',    name: 'Kiểm tra AOI',      type: 'INSPECTION' as const, cycleTime: '2.50', color: '#06b6d4', icon: 'scan-eye', order: 5 },
    { code: 'TEST-AVI',    name: 'Kiểm tra AVI',      type: 'INSPECTION' as const, cycleTime: '3.00', color: '#14b8a6', icon: 'eye',      order: 6 },
    { code: 'PKG-PACK',    name: 'Đóng gói',          type: 'PACKAGING' as const,  cycleTime: '4.00', color: '#64748b', icon: 'package',  order: 7 },
  ];

  const createdProcesses: Array<{ id: number; code: string }> = [];

  for (const p of processesData) {
    const result = await safeCreate(`Process: ${p.code}`, () =>
      createProcess({ code: p.code, name: p.name, processType: p.type, cycleTimeTarget: p.cycleTime, color: p.color, icon: p.icon, orderIndex: p.order })
    );
    if (result) createdProcesses.push({ id: result.id, code: p.code });
  }

  // Line Process Assignments (assign all processes to first 4 lines)
  if (createdProcesses.length > 0 && lines.length > 0) {
    console.log('\n🔗 Seeding Line Process Assignments...');
    const db = await getDb();
    if (db) {
      for (const line of lines.slice(0, 4)) {
        for (let i = 0; i < createdProcesses.length; i++) {
          await safeCreate(`LineProcess: ${line.code} → ${createdProcesses[i].code}`, () =>
            db.execute(sql`INSERT INTO line_process_assignments ("lineId", "processId", "orderIndex", "isActive") VALUES (${line.id}, ${createdProcesses[i].id}, ${i}, true) ON CONFLICT DO NOTHING`)
          );
        }
      }
    }
  }

  return createdProcesses;
}

// ───────────── 8. PRODUCTION ORDERS ─────────────

async function seedProductionOrders(
  hierarchy: HierarchyIds,
  products: Array<{ id: number; code: string }>
) {
  console.log('\n📋 Seeding Production Orders...');
  if (hierarchy.lines.length === 0 || products.length === 0) return;

  const now = new Date();
  const statuses = ['pending', 'in_progress', 'completed'] as const;

  // Find workshopId and factoryId for lines
  const lineToWorkshop = new Map<number, number>();
  const workshopToFactory = new Map<number, number>();
  for (const ws of hierarchy.workshops) workshopToFactory.set(ws.id, ws.factoryId);
  for (const line of hierarchy.lines) lineToWorkshop.set(line.id, line.workshopId);

  let orderIdx = 0;
  for (const line of hierarchy.lines.slice(0, 6)) {
    for (const prod of products.slice(0, 3)) {
      orderIdx++;
      const status = statuses[orderIdx % 3];
      const wsId = lineToWorkshop.get(line.id) || 1;
      const facId = workshopToFactory.get(wsId) || 1;
      const target = randomInt(500, 2000);

      await safeCreate(`Order: PO-${String(orderIdx).padStart(4, '0')}`, () =>
        createProductionOrder({
          orderCode: `PO-${String(orderIdx).padStart(4, '0')}`,
          companyCode: 'AVI-VN',
          factoryId: facId,
          workshopId: wsId,
          lineId: line.id,
          productModelId: prod.id,
          targetQuantity: target,
          completedQuantity: status === 'completed' ? target : status === 'in_progress' ? Math.floor(target * 0.6) : 0,
          okQuantity: status === 'completed' ? Math.floor(target * 0.95) : status === 'in_progress' ? Math.floor(target * 0.55) : 0,
          ngQuantity: status === 'completed' ? Math.floor(target * 0.04) : status === 'in_progress' ? Math.floor(target * 0.04) : 0,
          ntfQuantity: status === 'completed' ? Math.floor(target * 0.01) : status === 'in_progress' ? Math.floor(target * 0.01) : 0,
          status,
          priority: randomInt(0, 3),
          plannedStartDate: new Date(now.getTime() - 7 * 86400000),
          plannedEndDate: new Date(now.getTime() + 7 * 86400000),
          actualStartDate: status !== 'pending' ? new Date(now.getTime() - 5 * 86400000) : undefined,
          actualEndDate: status === 'completed' ? new Date(now.getTime() - 1 * 86400000) : undefined,
        })
      );
    }
  }

  // Line Product Assignments
  console.log('\n🔗 Seeding Line Product Assignments...');
  for (const line of hierarchy.lines.slice(0, 6)) {
    for (const prod of products.slice(0, 2)) {
      await safeCreate(`LineProduct: ${line.code} → ${prod.code}`, () =>
        createLineProductAssignment({ lineId: line.id, productModelId: prod.id, isActive: true })
      );
    }
  }

  // Line Stages
  console.log('\n📊 Seeding Line Stages...');
  const stageNames = [
    { code: 'A', name: 'Công đoạn A - Nạp liệu', cycleTime: '5.00' },
    { code: 'B', name: 'Công đoạn B - Gắn linh kiện', cycleTime: '8.00' },
    { code: 'C', name: 'Công đoạn C - Hàn', cycleTime: '6.00' },
    { code: 'D', name: 'Công đoạn D - Kiểm tra', cycleTime: '3.00' },
  ];
  for (const line of hierarchy.lines.slice(0, 4)) {
    for (let i = 0; i < stageNames.length; i++) {
      const st = stageNames[i];
      await safeCreate(`Stage: ${line.code}/${st.code}`, () =>
        createLineStage({ lineId: line.id, code: st.code, name: st.name, orderIndex: i, cycleTimeTarget: st.cycleTime })
      );
    }
  }
}

// ───────────── 9. INSPECTIONS + MEASUREMENT RESULTS ─────────────

async function seedInspections(
  machines: Array<{ id: number; code: string }>,
  products: Array<{ id: number; code: string }>
) {
  console.log('\n🔬 Seeding Inspections (48h of data)...');
  if (machines.length === 0 || products.length === 0) return;

  const db = await getDb();
  if (!db) return;

  // Get measurement point IDs for linking results
  const pointDefsResult = await db.execute(sql`SELECT id, "productModelId" FROM measurement_point_defs WHERE "isActive" = true ORDER BY "productModelId", "orderIndex" LIMIT 200`);
  const pointsByProduct = new Map<number, number[]>();
  for (const row of pointDefsResult as unknown as Array<{ id: number; productModelId: number }>) {
    const arr = pointsByProduct.get(row.productModelId) || [];
    arr.push(row.id);
    pointsByProduct.set(row.productModelId, arr);
  }

  const now = Date.now();
  const hours48 = 48 * 60 * 60 * 1000;
  let inspCount = 0;

  // Generate ~6 inspections per hour per machine for 48 hours = ~288 per machine
  for (const machine of machines.slice(0, 8)) {
    const prod = randomChoice(products);
    const pointIds = pointsByProduct.get(prod.id) || [];

    for (let t = now - hours48; t < now; t += 10 * 60 * 1000) { // Every 10 minutes
      const rand = Math.random();
      const overallResult = rand < 0.85 ? 'OK' : rand < 0.95 ? 'NG' : 'NTF';
      const originalResult = overallResult === 'NTF' ? 'NG' : overallResult === 'OK' ? 'OK' : 'NG';
      const serialNum = `SN-${machine.code}-${Date.now()}-${randomInt(1000, 9999)}`;

      const inspId = await safeCreate(inspCount % 50 === 0 ? `Inspection batch (${inspCount}+)...` : '', async () => {
        const result = await createProductInspection({
          machineId: machine.id,
          productModelId: prod.id,
          serialNumber: serialNum,
          productModel: prod.code,
          overallResult: overallResult as any,
          originalResult: originalResult as any,
          inspectionTime: new Date(t),
          cycleTime: randomFloat(1.5, 8.0).toString(),
        });
        return result;
      });

      if (inspId && pointIds.length > 0) {
        const measResults = pointIds.map(pointDefId => ({
          inspectionId: Number(inspId),
          pointDefId,
          measuredValue: randomFloat(0.5, 4.0, 6).toString(),
          result: (overallResult === 'NG' && Math.random() < 0.3 ? 'NG' : 'OK') as any,
          aiConfidence: randomFloat(0.85, 0.99, 4).toString(),
          aiComparisonScore: (overallResult === 'OK' ? randomFloat(0.85, 0.99, 4) : randomFloat(0.3, 0.7, 4)).toString(),
        }));
        try {
          await createMeasurementResults(measResults);
        } catch (_) { /* skip measurement result errors */ }
      }

      inspCount++;
    }
  }
  console.log(`  📊 Created ~${inspCount} inspection records`);
}

// ───────────── 10. DAILY STATISTICS ─────────────

async function seedDailyStatistics(
  machines: Array<{ id: number }>,
  hierarchy: HierarchyIds
) {
  console.log('\n📈 Seeding Daily Statistics (last 30 days)...');

  // Load FULL hierarchy from DB to avoid partial lookup issues
  const allWorkshops = await getWorkshops();
  const allLines = await getProductionLines();
  const allStations = await getStations();
  const allMachines = await getMachines();

  const stationToLine = new Map<number, number>();
  const lineToWorkshop = new Map<number, number>();
  const workshopToFactory = new Map<number, number>();
  for (const line of allLines) lineToWorkshop.set(Number(line.id), Number(line.workshopId));
  for (const ws of allWorkshops) workshopToFactory.set(Number(ws.id), Number(ws.factoryId));
  for (const st of allStations) stationToLine.set(Number(st.id), Number(st.lineId));

  const machineDetails = new Map<number, { factoryId: number; workshopId: number }>();
  for (const m of allMachines) {
    const lineId = stationToLine.get(Number(m.stationId));
    const wsId = lineId ? lineToWorkshop.get(lineId) : undefined;
    const facId = wsId ? workshopToFactory.get(wsId) : undefined;
    if (facId && wsId) machineDetails.set(Number(m.id), { factoryId: facId, workshopId: wsId });
  }

  const now = new Date();
  for (const m of machines.slice(0, 10)) {
    const details = machineDetails.get(m.id);
    if (!details) continue;

    for (let d = 29; d >= 0; d--) {
      const date = new Date(now.getTime() - d * 86400000);
      date.setHours(0, 0, 0, 0);

      const total = randomInt(150, 400);
      const ok = Math.floor(total * randomFloat(0.90, 0.97));
      const ng = Math.floor(total * randomFloat(0.02, 0.06));
      const ntf = Math.max(0, total - ok - ng);
      const yieldRate = ((ok / total) * 100).toFixed(2);

      await safeCreate(d === 29 ? `Stats: Machine ${m.id} (30 days)...` : '', async () => {
        const db2 = await getDb();
        if (!db2) throw new Error('Database not available');
        await db2.execute(sql`INSERT INTO daily_statistics ("machineId", "factoryId", "workshopId", "date", "totalCount", "okCount", "ngCount", "ntfCount", "yieldRate", "avgCycleTime") VALUES (${m.id}, ${details.factoryId}, ${details.workshopId}, ${date.toISOString()}, ${total}, ${ok}, ${ng}, ${ntf}, ${yieldRate}, ${randomFloat(2.0, 6.0).toFixed(2)}) ON CONFLICT DO NOTHING`);
      });
    }
  }
}

// ───────────── 11. ALERTS & THRESHOLDS ─────────────

async function seedAlerts(users: Array<{ id: number; username: string }>, machines: Array<{ id: number }>) {
  console.log('\n🔔 Seeding Alert Settings & Yield Thresholds...');

  const adminUser = users.find(u => u.username === 'admin');
  if (!adminUser) return;

  const alertsData = [
    { name: 'Yield Rate Drop',  type: 'yield_rate' as const,    threshold: '90.00', operator: 'lt' as const, cooldown: 30 },
    { name: 'NG Count High',    type: 'ng_count' as const,      threshold: '50',    operator: 'gt' as const, cooldown: 60 },
    { name: 'Machine Offline',  type: 'machine_offline' as const, threshold: '5',   operator: 'gt' as const, cooldown: 15 },
  ];

  for (const a of alertsData) {
    await safeCreate(`Alert: ${a.name}`, () =>
      createAlertSetting({
        userId: adminUser.id,
        name: a.name,
        alertType: a.type,
        threshold: a.threshold,
        comparisonOperator: a.operator,
        machineId: machines.length > 0 ? machines[0].id : undefined,
        cooldownMinutes: a.cooldown,
        notifyEmail: true,
        notifyInApp: true,
      })
    );
  }

  // Yield Alert Thresholds
  const db = await getDb();
  if (db) {
    const thresholds = [
      { metric: 'FPY', warning: '92.0000', critical: '88.0000', target: '95.0000', desc: 'First Pass Yield' },
      { metric: 'FY',  warning: '94.0000', critical: '90.0000', target: '97.0000', desc: 'Final Yield' },
      { metric: 'NTF', warning: '3.0000',  critical: '5.0000',  target: '1.0000',  desc: 'No Trouble Found rate' },
      { metric: 'UPH', warning: '180',     critical: '150',     target: '250',     desc: 'Units Per Hour' },
    ];
    for (const t of thresholds) {
      await safeCreate(`Threshold: ${t.metric}`, () =>
        db.execute(sql`INSERT INTO yield_alert_thresholds ("metricType", "warningThreshold", "criticalThreshold", "targetValue", "comparisonOperator", "isEnabled", description) VALUES (${t.metric}, ${t.warning}, ${t.critical}, ${t.target}, 'gte', true, ${t.desc}) ON CONFLICT DO NOTHING`)
      );
    }
  }
}

// ───────────── 12. SPC + QUALITY GATES ─────────────

async function seedSpcAndQualityGates(
  products: Array<{ id: number }>,
  machines: Array<{ id: number }>,
  users: Array<{ id: number; username: string }>
) {
  console.log('\n📉 Seeding SPC Configurations & Quality Gates...');
  const db = await getDb();
  if (!db) return;

  const admin = users.find(u => u.username === 'admin');

  // SPC Configurations
  for (const prod of products.slice(0, 3)) {
    for (const m of machines.slice(0, 2)) {
      await safeCreate(`SPC: Product ${prod.id} / Machine ${m.id}`, () =>
        createSpcConfiguration({
          productModelId: prod.id,
          machineId: m.id,
          chartType: 'xbar_r',
          subgroupSize: 5,
          controlLimitMethod: 'auto',
          isActive: true,
          createdBy: admin?.id,
        })
      );
    }
  }

  // Quality Gates
  const gates = [
    { name: 'Yield Rate Gate',     type: 'yield_rate',     threshold: '90.0000', action: 'alert', windowSize: 50,  consecutiveCount: 3 },
    { name: 'NG Count Gate',       type: 'ng_count',       threshold: '10.0000', action: 'pause', windowSize: 20,  consecutiveCount: 5 },
    { name: 'Consecutive NG Gate', type: 'consecutive_ng', threshold: '5.0000',  action: 'stop',  windowSize: 10,  consecutiveCount: 5 },
  ];

  for (const line of [machines[0]?.id].filter(Boolean)) {
    for (const g of gates) {
      await safeCreate(`QualityGate: ${g.name}`, () =>
        db.execute(sql`INSERT INTO quality_gates (name, "gateType", threshold, action, "windowSize", "consecutiveCount", "machineId", "isActive", "createdBy") VALUES (${g.name}, ${g.type}, ${g.threshold}, ${g.action}, ${g.windowSize}, ${g.consecutiveCount}, ${line}, true, ${admin?.id ?? null}) ON CONFLICT DO NOTHING`)
      );
    }
  }
}

// ───────────── 13. SYSTEM SETTINGS ─────────────

async function seedSystemSettings() {
  console.log('\n⚙️ Seeding System Settings...');
  const db = await getDb();
  if (!db) return;

  const settings = [
    { key: 'system.name',             value: 'AVI-AOI Management System', desc: 'Tên hệ thống',         category: 'general' },
    { key: 'system.version',          value: '2.0.0',                     desc: 'Phiên bản',             category: 'general' },
    { key: 'system.language',         value: 'vi',                        desc: 'Ngôn ngữ mặc định',     category: 'general' },
    { key: 'security.session.timeout', value: '3600',                     desc: 'Session timeout (s)',    category: 'security' },
    { key: 'security.password.minLength', value: '8',                    desc: 'Độ dài tối thiểu password', category: 'security' },
    { key: 'security.2fa.enabled',    value: 'true',                      desc: 'Bật xác thực 2 bước',   category: 'security' },
    { key: 'notification.email.enabled', value: 'true',                  desc: 'Bật thông báo email',    category: 'notification' },
    { key: 'notification.sms.enabled', value: 'false',                   desc: 'Bật thông báo SMS',      category: 'notification' },
    { key: 'mqtt.broker.url',          value: 'mqtt://localhost:1883',    desc: 'MQTT Broker URL',        category: 'mqtt' },
    { key: 'mqtt.reconnect.interval',  value: '5000',                    desc: 'MQTT reconnect interval (ms)', category: 'mqtt' },
    { key: 'inspection.autosave',     value: 'true',                      desc: 'Tự động lưu kết quả',   category: 'inspection' },
    { key: 'report.default.format',   value: 'PDF',                      desc: 'Định dạng báo cáo mặc định', category: 'report' },
  ];

  for (const s of settings) {
    await safeCreate(`Setting: ${s.key}`, () =>
      db.execute(sql`INSERT INTO system_settings ("settingKey", "settingValue", description, category) VALUES (${s.key}, ${s.value}, ${s.desc}, ${s.category}) ON CONFLICT ("settingKey") DO NOTHING`)
    );
  }
}

// ───────────── MAIN ─────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  AVI-AOI Management — Comprehensive Data Seed   ║');
  console.log('╚══════════════════════════════════════════════════╝');

  const startTime = Date.now();

  try {
    // 1. Users
    const users = await seedUsers();

    // 2. Permissions
    await seedPermissions(users);

    // 3. User Roles
    await seedUserRoles();

    // 4. Hierarchy
    const hierarchy = await seedHierarchy();

    // 5. Products
    const products = await seedProducts(hierarchy.machines);

    // 6. Shift Configs
    await seedShiftConfigs(hierarchy.factories);

    // 7. Processes
    await seedProcesses(hierarchy.lines);

    // 8. Production Orders
    await seedProductionOrders(hierarchy, products);

    // 9. Inspections (48h)
    await seedInspections(hierarchy.machines, products);

    // 10. Daily Statistics (30 days)
    await seedDailyStatistics(hierarchy.machines, hierarchy);

    // 11. Alerts & Thresholds
    await seedAlerts(users, hierarchy.machines);

    // 12. SPC + Quality Gates
    await seedSpcAndQualityGates(products, hierarchy.machines, users);

    // 13. System Settings
    await seedSystemSettings();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log(`║  ✅ Seed completed in ${elapsed}s                      ║`);
    console.log('║                                                  ║');
    console.log('║  Summary:                                        ║');
    console.log(`║  • ${users.length} users                                     ║`);
    console.log(`║  • ${hierarchy.factories.length} factories                                  ║`);
    console.log(`║  • ${hierarchy.workshops.length} workshops                                  ║`);
    console.log(`║  • ${hierarchy.lines.length} production lines                          ║`);
    console.log(`║  • ${hierarchy.stations.length} stations                                   ║`);
    console.log(`║  • ${hierarchy.machines.length} machines                                   ║`);
    console.log(`║  • ${products.length} product models                             ║`);
    console.log('║  • 48h inspection data + measurement results     ║');
    console.log('║  • 30 days daily statistics                      ║');
    console.log('║  • Alert settings + yield thresholds             ║');
    console.log('║  • SPC configs + quality gates                   ║');
    console.log('║  • System settings                               ║');
    console.log('╚══════════════════════════════════════════════════╝');
  } catch (error) {
    console.error('\n❌ Seed failed:', error);
    process.exit(1);
  }

  process.exit(0);
}

main();
