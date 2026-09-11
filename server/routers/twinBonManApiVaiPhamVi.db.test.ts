/**
 * CỔNG CSDL THẬT — ĐỢT 42 (QA Đợt 41 D-4, G116): **MỌI THỦ TỤC BỐN MÀN TWIN GỌI × VAI × NHÀ MÁY — LƯỚI TỰ ĐỘNG.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO LƯỚI NÀY TỒN TẠI — G116, nói bằng số
 * ══════════════════════════════════════════════════════════════════════════════
 * Đợt 14/15/24 rào 3 router "twin"; Đợt 40 rào 5 thủ tục của nguồn sự thật mới; QA Đợt 41 là lần ĐẦU
 * liệt kê MỌI thủ tục mà bốn màn (`/twin` · `/twin/line/:id` · `/twin/may/:id` · `/twin-studio`) gọi —
 * bằng grep `trpc.` — rồi gọi 48 lượt × 6 vai qua HTTP thật (`.qa-dot41/api-vai.mjs`). Kết quả: **4 lỗ**,
 * cả bốn ở ROUTER CŨ mà màn MỚI nhúng: `twin.usdExport` (nút cũ giữ lại), `wip.lineBalance` (hook Đợt 27),
 * `sensor.listTypes/readSeries` (cockpit nhúng). Không lưới nào trong 2.354 ca twin3d đỏ, vì không lưới
 * nào hỏi câu *"tập thủ tục màn gọi × vai 0 gán ⇒ rỗng/NOT_FOUND"*. Nhúng một mảnh cũ = nhận cả nợ của nó.
 *
 * ⇒ Lưới này biến phép quét tay ấy thành BẤT BIẾN:
 *   §0  tập thủ tục = GREP thật trên `client/src/pages/Twin*.tsx` + `MachineCockpit.tsx` +
 *       `client/src/components/twin3d/**` (cùng bộ tệp QA dùng), GHIM SỐ, và đòi **mọi** đường dẫn grep ra
 *       phải có tên ở ĐÚNG MỘT trong ba bảng dưới (đọc · ghi · ngoại lệ có lý do). Thêm một `trpc.x.y` vào
 *       một trang twin mà chưa xếp bảng ⇒ ĐỎ — đó là toàn bộ lý do tồn tại.
 *   §1  mỗi thủ tục ĐỌC × {người 0 gán, người gán A hỏi B} ⇒ rỗng / `NOT_FOUND` / không có MÃ nhà máy
 *       trong thân (đúng phép đo `coSIM`/`coT12` của harness), × người gán A hỏi A ⇒ CÓ (đối chứng dương,
 *       chiều dễ mất), × admin hỏi B ⇒ CÓ (bypass, không thêm mệnh đề nào).
 *   §2  mỗi thủ tục GHI × người 0 QUYỀN ⇒ `FORBIDDEN`/`PERMISSION_DENIED` với input rỗng — chứng minh cổng
 *       RBAC đứng TRƯỚC parse input. ⚠ Lưới này đo RÒ ĐỌC; hàng rào tenant của đường ghi đo ở các lưới
 *       `twinCanh*`/`maintenanceAndonPhamVi` (Đợt 14/24).
 *
 * ★ G43 — hai người thử được cấp ĐỦ quyền RBAC như nhau; thứ DUY NHẤT phân biệt họ là bản gán nhà máy.
 *   Chặn theo id ⇒ `ENTITY_NOT_FOUND`, KHÔNG `PERMISSION_DENIED` (G82: cùng hình dạng với không tồn tại).
 * ★ G22 — không dựa vào seed (`aoi_management_test` không có `e2e_tai_loE`): tự tạo 2 nhà máy đầy đủ chuỗi
 *   `workshop → line → station → machine` + toà/tầng twin + bản ghi bố cục + cân bằng chuyền + cảm biến +
 *   andon + phiếu bảo trì + 4 người dùng, rồi xoá đúng chừng ấy từ trong ra ngoài.
 * ★ G20 — import CHÍNH `appRouter` của module giao hàng; `createCaller` với danh tính từng người.
 * ★ Dấu vết dữ liệu = MÃ có tiền tố duy nhất (`${DAU}-TRONG` / `${DAU}-NGOAI`) trên mọi hàng dựng — thân phản
 *   hồi của người bị thu hẹp KHÔNG được chứa mã của nhà máy kia (phép `coSIM`/`coT12` của QA, tổng quát hoá).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appRouter } from "../routers";
import { resolvePermissionModule } from "@shared/permissions";

const DB_URL = process.env.DATABASE_URL;

/** Hậu tố duy nhất cho mọi hàng lưới này tạo — để xoá lại đúng chừng ấy. */
const DAU = `D42-BM-${Date.now()}`;

/** Vai KHÔNG phải admin. */
const VAI = "engineer";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// §0 — TẬP THỦ TỤC BỐN MÀN GỌI: grep thật, ghim số
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Cùng bộ tệp QA Đợt 41 dùng (G116): `pages/Twin*.tsx` · `pages/MachineCockpit.tsx` · `components/twin3d/**`. */
const GOC_CLIENT = resolve(dirname(fileURLToPath(import.meta.url)), "../../client/src");

function tepBonMan(): string[] {
  const ds: string[] = [];
  for (const f of readdirSync(join(GOC_CLIENT, "pages"))) {
    if (/^Twin.*\.tsx$/.test(f) || f === "MachineCockpit.tsx") ds.push(join(GOC_CLIENT, "pages", f));
  }
  const di = (d: string): void => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) di(p);
      else if (/\.(ts|tsx)$/.test(f) && !/\.(test|unit|dom|spec)\./.test(f)) ds.push(p);
    }
  };
  di(join(GOC_CLIENT, "components", "twin3d"));
  return ds.sort();
}

/**
 * Đường dẫn thủ tục (`router.proc`, kể cả lồng `twin.models.uploadAndRegister`) sau `trpc.` / `utils.` /
 * `tienIch.` / mọi bí danh gán từ `trpc.useUtils()` trong tệp, kết thúc bằng một phương thức của tRPC-react.
 * ⚠ Phép grep này phải TRÙNG với `.qa-dot42/grep-thu-tuc.mjs` — cùng một cái thước cho QA và cho lưới.
 */
function quetThuTuc(): Map<string, Set<string>> {
  const PHUONG_THUC =
    "useQuery|useMutation|useInfiniteQuery|useSubscription|useSuspenseQuery|fetch|query|mutate|mutateAsync|prefetch|invalidate|refetch|cancel|setData|getData";
  const tap = new Map<string, Set<string>>();
  for (const p of tepBonMan()) {
    const src = readFileSync(p, "utf8");
    const biDanh = new Set(["trpc", "utils", "tienIch"]);
    for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*trpc\.useUtils\(\)/g)) biDanh.add(m[1]!);
    const re = new RegExp(`\\b(?:${[...biDanh].join("|")})\\.((?:[A-Za-z_]\\w*\\.)+)(?:${PHUONG_THUC})\\b`, "g");
    for (const m of src.matchAll(re)) {
      const duong = m[1]!.slice(0, -1);
      if (!tap.has(duong)) tap.set(duong, new Set());
      tap.get(duong)!.add(p.split("\\").join("/").replace(`${GOC_CLIENT.split("\\").join("/")}/`, ""));
    }
  }
  return tap;
}

/** ★ GHIM — đo 2026-09-11 trên `6eec818f` (`.qa-dot42/grep-thu-tuc.mjs`: 115 tệp, 42 đường dẫn). */
const SO_THU_TUC_GHIM = 42;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Fixture
// ═══════════════════════════════════════════════════════════════════════════════════════════════

interface NhaMay {
  /** `${DAU}-TRONG` / `${DAU}-NGOAI` — mọi mã của nhà máy này đều CHỨA chuỗi này (dấu vết). */
  ma: string;
  factoryId: number;
  toaNhaId: number;
  toaNhaMa: string;
  tangId: number;
  workshopId: number;
  lineId: number;
  tramId: number;
  mayId: number;
  woId: number;
  banGhiId: number;
  andonId: number;
  sensorIds: number[];
  lineBalanceIds: number[];
}

interface Fixture {
  trong: NhaMay;
  ngoai: NhaMay;
  /** Gán nhà máy TRONG, đủ quyền. */
  userTrongId: number;
  /** 0 gán, đủ quyền — (G43) chỉ khác người trên ở bản gán. */
  userKhongGanId: number;
  /** 0 quyền, 0 gán — đo cổng RBAC của đường ghi (§2). */
  userKhongQuyenId: number;
  /** role admin, 0 quyền, 0 gán — bypass. */
  userAdminId: number;
}
let fx: Fixture | null = null;
let sql: ReturnType<typeof postgres>;

const id = (r: unknown): number => (Array.isArray(r) ? (r[0] as { id: number }).id : (r as { id: number }).id);

async function taoNhaMay(nhan: "TRONG" | "NGOAI"): Promise<NhaMay> {
  const ma = `${DAU}-${nhan}`;
  const factoryId = id(await sql`INSERT INTO factories (code, name) VALUES (${ma}, ${`${ma} nha may`}) RETURNING id`);
  const workshopId = id(await sql`
    INSERT INTO workshops ("factoryId", code, name) VALUES (${factoryId}, ${`${ma}-W`}, ${`${ma} xuong`}) RETURNING id`);
  const lineId = id(await sql`
    INSERT INTO production_lines ("workshopId", code, name) VALUES (${workshopId}, ${`${ma}-L`}, ${`${ma} chuyen`}) RETURNING id`);
  const tramId = id(await sql`
    INSERT INTO stations ("lineId", code, name) VALUES (${lineId}, ${`${ma}-S`}, ${`${ma} tram`}) RETURNING id`);
  // ⚠ `machineType` enum NOT NULL; `isActive` mặc định true — `overview` chỉ lấy máy đang hoạt động.
  const mayId = id(await sql`
    INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${tramId}, ${`${ma}-M`}, ${`${ma} may`}, 'AOI') RETURNING id`);
  const toaNhaMa = `${ma}-TOA`;
  const toaNhaId = id(await sql`
    INSERT INTO twin_toa_nha ("factoryId", ma, ten, nguon) VALUES (${factoryId}, ${toaNhaMa}, ${`${ma} toa nha`}, 'tay') RETURNING id`);
  const tangId = id(await sql`
    INSERT INTO twin_tang ("toaNhaId", "capSo", ten, nguon) VALUES (${toaNhaId}, 1, ${`${ma} tang 1`}, 'tay') RETURNING id`);
  const banGhiId = id(await sql`
    INSERT INTO twin_ban_ghi ("tangId", nhan, "anhChup")
    VALUES (${tangId}, ${`${ma}-BANGHI`}, ${sql.json({ phienBan: 1, ghiLuc: new Date().toISOString(), datCho: [] })}) RETURNING id`);
  const bayGio = Date.now();
  const lb = await sql`
    INSERT INTO line_balance_metrics ("lineId", "periodStart", "periodEnd", "taktTimeMs", "avgCycleTimeMs", "bottleneckStationId")
    VALUES (${lineId}, ${new Date(bayGio - 7_200_000)}, ${new Date(bayGio - 3_600_000)}, 30000, 28000, ${tramId}),
           (${lineId}, ${new Date(bayGio - 3_600_000)}, ${new Date(bayGio)}, 30000, 29000, ${tramId})
    RETURNING id`;
  const sr = await sql`
    INSERT INTO machine_sensor_readings ("machineId", "sensorType", value, unit, timestamp)
    VALUES (${mayId}, 'temperature', 41.5, 'C', ${new Date(bayGio - 1_800_000)}),
           (${mayId}, 'temperature', 42.0, 'C', ${new Date(bayGio - 1_200_000)}),
           (${mayId}, 'temperature', 42.5, 'C', ${new Date(bayGio - 600_000)})
    RETURNING id`;
  const andonId = id(await sql`
    INSERT INTO andon_events (state, reason, status, title, "machineId", "stationId", "lineId", "raisedBySystem", "raisedAt")
    VALUES ('red', 'quality', 'raised', ${`${ma}-ANDON`}, ${mayId}, ${tramId}, ${lineId}, true, now()) RETURNING id`);
  const woId = id(await sql`
    INSERT INTO maintenance_work_orders ("workOrderNumber", "machineId", type, status, trigger, priority, title, "factoryId")
    VALUES (${`${ma}-WO`}, ${mayId}, 'CORRECTIVE', 'OPEN', 'MANUAL', 3, ${`${ma}-PHIEU`}, ${factoryId}) RETURNING id`);
  return {
    ma, factoryId, toaNhaId, toaNhaMa, tangId, workshopId, lineId, tramId, mayId, woId, banGhiId, andonId,
    sensorIds: (sr as unknown as Array<{ id: number }>).map((x) => x.id),
    lineBalanceIds: (lb as unknown as Array<{ id: number }>).map((x) => x.id),
  };
}

async function xoaNhaMay(nm: NhaMay): Promise<void> {
  await sql`DELETE FROM maintenance_work_orders WHERE id = ${nm.woId}`;
  await sql`DELETE FROM andon_events WHERE id = ${nm.andonId}`;
  await sql`DELETE FROM machine_sensor_readings WHERE id = ANY(${nm.sensorIds})`;
  await sql`DELETE FROM line_balance_metrics WHERE id = ANY(${nm.lineBalanceIds})`;
  await sql`DELETE FROM twin_ban_ghi WHERE id = ${nm.banGhiId}`;
  await sql`DELETE FROM twin_tang WHERE id = ${nm.tangId}`;
  await sql`DELETE FROM twin_toa_nha WHERE id = ${nm.toaNhaId}`;
  await sql`DELETE FROM machines WHERE id = ${nm.mayId}`;
  await sql`DELETE FROM stations WHERE id = ${nm.tramId}`;
  await sql`DELETE FROM production_lines WHERE id = ${nm.lineId}`;
  await sql`DELETE FROM workshops WHERE id = ${nm.workshopId}`;
  await sql`DELETE FROM factories WHERE id = ${nm.factoryId}`;
}

async function taoUser(suffix: string, role: string): Promise<number> {
  return id(await sql`
    INSERT INTO users ("openId", username, name, role, "isActive")
    VALUES (${`${DAU}-${suffix}`}, ${`${DAU}-${suffix}`}, ${`${DAU} ${suffix}`}, ${role}, true) RETURNING id`);
}

/**
 * ★ G43 — ĐỦ quyền cho MỌI cổng RBAC mà 28 thủ tục đọc dưới đây dựng: `machine_status` (= alias của
 *   `machine_monitoring`: cockpit, factoryCommand, twin, orchestration, maintenance, `user.assignableTechnicians`
 *   canCreate), `analytics_oee` (`quyenVanHanh`, `wip.lineBalance`), `andon` (`andon.active`), `settings_factory`
 *   (`quyenThietKe`/`quyenDocHinhHoc`). Thiếu một quyền thì ô (−) đỏ vì `PERMISSION_DENIED` — và lưới sẽ
 *   nói đúng cổng nào (xem `chanTheoPhamVi`).
 */
async function capDuQuyen(userId: number): Promise<void> {
  const rows: Array<[string, string, boolean]> = [
    ["machine_monitoring", resolvePermissionModule("machine_monitoring"), true],
    ["analytics", "analytics_oee", false],
    ["andon", "andon", false],
    ["settings", "settings_factory", false],
  ];
  for (const [category, moduleName, canCreate] of rows) {
    await sql`
      INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete", "canExport")
      VALUES (${userId}, ${category}::permissioncategoryenum, ${moduleName}, true, ${canCreate}, false, false, false)`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Bộ gọi + hình dạng kết quả
// ═══════════════════════════════════════════════════════════════════════════════════════════════

type Caller = ReturnType<typeof appRouter.createCaller>;
function goiVoi(userId: number, role: string = VAI): Caller {
  return appRouter.createCaller({ user: { id: userId, role, name: "probe" } } as never);
}

type KetQua = { ok: true; data: unknown } | { ok: false; code: string; appCode: string | null; msg: string };
async function thu(p: Promise<unknown>): Promise<KetQua> {
  try {
    return { ok: true, data: await p };
  } catch (e: unknown) {
    const err = e as { code?: string; cause?: { appCode?: string; code?: string }; message?: string };
    return {
      ok: false,
      code: err?.code ?? err?.cause?.code ?? "?",
      appCode: err?.cause?.appCode ?? null,
      msg: String(err?.message ?? "").slice(0, 160),
    };
  }
}

const chuoi = (k: KetQua): string => (k.ok ? JSON.stringify(k.data) ?? "" : "");

/** Thân KHÔNG chứa dấu vết `ma` — phép `coSIM`/`coT12` của harness, tổng quát hoá. */
const khongCoMa = (k: KetQua, ma: string): boolean => !chuoi(k).includes(ma);

/** Bị chặn theo PHẠM VI (G43): `NOT_FOUND` + `ENTITY_NOT_FOUND`, KHÔNG phải cổng RBAC. */
const laNotFound = (k: KetQua): boolean => !k.ok && k.code === "NOT_FOUND" && k.appCode !== "PERMISSION_DENIED";

function rong(d: unknown): boolean {
  if (d == null) return true;
  if (Array.isArray(d)) return d.length === 0;
  if (typeof d === "object") return Object.values(d as Record<string, unknown>).every((v) => !Array.isArray(v) || v.length === 0);
  return false;
}
const laRong = (k: KetQua): boolean => k.ok && rong(k.data);
const notFoundHoacRong = (k: KetQua): boolean => laNotFound(k) || laRong(k);
/** Hình dạng YẾU nhất: không ném (hoặc `NOT_FOUND`) — phép "không có mã" ở ngoài mới là cổng thật. */
const okHoacNotFound = (k: KetQua): boolean => k.ok || laNotFound(k);
const coChuoi = (d: unknown, s: string): boolean => (JSON.stringify(d) ?? "").includes(s);

interface CaDoc {
  duongDan: string;
  goi: (c: Caller, nm: NhaMay) => Promise<unknown>;
  /** Hình dạng khi NGOÀI phạm vi (người 0 gán; người gán A hỏi B). */
  chan: (k: KetQua) => boolean;
  /** Đối chứng DƯƠNG trên dữ liệu: người gán A hỏi A, admin hỏi B. */
  duong: (d: any, nm: NhaMay) => boolean;
  /** Thủ tục KHÔNG nhận nhà máy trong input — chiều (−) chỉ đo được bằng dấu vết mã. */
  khongInput?: true;
  ghi?: string;
}

/**
 * §1 — 24 thủ tục ĐỌC. Chú thích `ghi` nói phép đo mạnh tới đâu: nơi fixture có hàng thì đối chứng dương
 * là HÀNG ẤY; nơi không dựng được hàng thì đối chứng chỉ là "không ném" + "không có mã" (ghi rõ).
 */
const CA_DOC: CaDoc[] = [
  { duongDan: "andon.active", khongInput: true, goi: (c) => c.andon.active(),
    chan: (k) => k.ok, duong: (d, nm) => coChuoi(d, `${nm.ma}-ANDON`), ghi: "andon `raised` dựng cho từng máy" },
  { duongDan: "assetCockpit.machineDetail", goi: (c, nm) => c.assetCockpit.machineDetail({ machineId: nm.mayId }),
    chan: laNotFound, duong: (d, nm) => d?.identity?.id === nm.mayId },
  { duongDan: "dashboard.getMachineStats", goi: (c, nm) => c.dashboard.getMachineStats({ machineId: nm.mayId }),
    chan: okHoacNotFound, duong: (d) => d != null, ghi: "số thuần — chỉ đo 'không có mã' + không ném" },
  { duongDan: "digitalTwin.wipFlowState", goi: (c, nm) => c.digitalTwin.wipFlowState({ lineId: nm.lineId }),
    chan: (k) => k.ok && rong((k.data as { stations?: unknown[] })?.stations), duong: (d) => Array.isArray(d?.stations),
    ghi: "không dựng WIP — chiều (−) đo `stations: []`; sâu hơn ở `digitalTwinPhamVi.db.test.ts`" },
  { duongDan: "factory.list", khongInput: true, goi: (c) => c.factory.list(),
    chan: (k) => k.ok, duong: (d, nm) => Array.isArray(d) && d.some((f: { code: string }) => f.code === nm.ma) },
  { duongDan: "factoryCommand.overview", goi: (c, nm) => c.factoryCommand.overview({ factoryId: nm.factoryId }),
    chan: (k) => k.ok && rong((k.data as { machines?: unknown[] })?.machines),
    duong: (d, nm) => Array.isArray(d?.machines) && d.machines.some((m: { id: number }) => m.id === nm.mayId) },
  { duongDan: "machine.checkCapabilities", goi: (c, nm) => c.machine.checkCapabilities({ id: nm.mayId }),
    chan: laNotFound, duong: (d) => d != null },
  { duongDan: "maintenance.listPartsForWorkOrder", goi: (c, nm) => c.maintenance.listPartsForWorkOrder({ workOrderId: nm.woId }),
    chan: notFoundHoacRong, duong: (d) => d != null, ghi: "phiếu dựng cho từng máy, 0 linh kiện" },
  { duongDan: "maintenance.listWorkOrders", goi: (c, nm) => c.maintenance.listWorkOrders({ machineId: nm.mayId }),
    chan: okHoacNotFound, duong: (d, nm) => coChuoi(d, `${nm.ma}-PHIEU`), ghi: "phiếu OPEN dựng cho từng máy" },
  { duongDan: "mqttClient.getDowntimeHistory", goi: (c, nm) => c.mqttClient.getDowntimeHistory({ machineId: nm.mayId }),
    chan: okHoacNotFound, duong: (d) => d != null, ghi: "không dựng downtime — chỉ đo 'không có mã' + không ném" },
  { duongDan: "sensor.listTypes", goi: (c, nm) => c.sensor.listTypes({ machineId: nm.mayId, windowHours: 24 }),
    chan: laNotFound, duong: (d) => d?.available === true && d.types.some((t: { sensorType: string; count: number }) => t.sensorType === "temperature" && t.count === 3),
    ghi: "LỖ #4 Đợt 41 — 3 hàng `temperature` dựng cho từng máy" },
  { duongDan: "sensor.readSeries", goi: (c, nm) => c.sensor.readSeries({ machineId: nm.mayId, sensorType: "temperature", windowHours: 24 }),
    chan: laNotFound, duong: (d) => d?.available === true && d.rawCount === 3, ghi: "LỖ #4 Đợt 41" },
  { duongDan: "twin.usdExport", goi: (c, nm) => c.twin.usdExport({ factoryId: nm.factoryId }),
    chan: laNotFound, duong: (d, nm) => typeof d?.usda === "string" && d.usda.includes(nm.ma),
    ghi: "LỖ #1 Đợt 41 — USDA ghi `st4i:factoryCode` nguyên văn" },
  { duongDan: "twinCanh.anToanRobot", goi: (c, nm) => c.twinCanh.anToanRobot({ factoryId: nm.factoryId }),
    chan: okHoacNotFound, duong: (d) => d != null, ghi: "không dựng robot — chỉ đo 'không có mã' + không ném" },
  { duongDan: "twinCanh.anhLichSu", goi: (c, nm) => c.twinCanh.anhLichSu({ factoryId: nm.factoryId, moc: Date.now() }),
    chan: okHoacNotFound, duong: (d) => d != null, ghi: "chỉ đo 'không có mã' + không ném" },
  { duongDan: "twinCanh.canhThietKe", goi: (c, nm) => c.twinCanh.canhThietKe({ factoryId: nm.factoryId, tangIds: [nm.tangId] }),
    chan: okHoacNotFound, duong: (d, nm) => coChuoi(d, nm.ma), ghi: "cây phân cấp mang mã xưởng/chuyền/trạm/máy" },
  { duongDan: "twinCanh.chiTietBanGhi", goi: (c, nm) => c.twinCanh.chiTietBanGhi({ id: nm.banGhiId }),
    chan: notFoundHoacRong, duong: (d, nm) => d?.id === nm.banGhiId, ghi: "bản ghi bố cục dựng cho từng tầng" },
  { duongDan: "twinCanh.chiTietToaNha", goi: (c, nm) => c.twinCanh.chiTietToaNha({ id: nm.toaNhaId }),
    chan: notFoundHoacRong, duong: (d, nm) => coChuoi(d, nm.toaNhaMa) },
  { duongDan: "twinCanh.danhSachBanGhi", goi: (c, nm) => c.twinCanh.danhSachBanGhi({ tangIds: [nm.tangId] }),
    chan: notFoundHoacRong, duong: (d, nm) => Array.isArray(d) && d.some((b: { id: number }) => b.id === nm.banGhiId) },
  { duongDan: "twinCanh.danhSachModel", khongInput: true, goi: (c) => c.twinCanh.danhSachModel(),
    chan: (k) => k.ok, duong: (d) => d != null, ghi: "bảng `equipment_3d_models` cấp chủng loại — chỉ đo 'không có mã'" },
  { duongDan: "twinCanh.danhSachToaNha", goi: (c, nm) => c.twinCanh.danhSachToaNha({ factoryId: nm.factoryId }),
    chan: notFoundHoacRong, duong: (d, nm) => Array.isArray(d) && d.some((t: { ma: string }) => t.ma === nm.toaNhaMa) },
  { duongDan: "twinCanh.sucKhoeMay", goi: (c, nm) => c.twinCanh.sucKhoeMay({ factoryId: nm.factoryId }),
    chan: (k) => k.ok && rong((k.data as { khai?: unknown[] })?.khai) && (k.data as { tongMayTrongPhamVi?: number })?.tongMayTrongPhamVi === 0,
    duong: (d) => d?.tongMayTrongPhamVi === 1, ghi: "`tongMayTrongPhamVi` đếm máy trong phạm vi — 1 cho người gán A, 0 khi ngoài" },
  { duongDan: "twinCanh.xemTruocSinh", goi: (c, nm) => c.twinCanh.xemTruocSinh({ factoryId: nm.factoryId, tangIds: [nm.tangId] }),
    chan: okHoacNotFound, duong: (d) => d != null, ghi: "chỉ đo 'không có mã' + không ném" },
  { duongDan: "wip.lineBalance", goi: (c, nm) => c.wip.lineBalance({ lineId: nm.lineId, limit: 10 }),
    chan: laRong, duong: (d, nm) => Array.isArray(d) && d.length === 2 && d.every((r: { lineId: number }) => r.lineId === nm.lineId),
    ghi: "LỖ #3 Đợt 41 — 2 hàng `line_balance_metrics` dựng cho từng chuyền" },
];

interface CaGhi {
  duongDan: string;
  goi: (c: Caller) => Promise<unknown>;
  /** Cổng RBAC (grep tại chỗ) — để người đọc biết lưới đang đo cổng nào. */
  cong: string;
}

/** §2 — 14 thủ tục GHI: người 0 QUYỀN, input RỖNG ⇒ `FORBIDDEN` TRƯỚC khi zod chạy (cổng đứng trước parse). */
const CA_GHI: CaGhi[] = [
  { duongDan: "andon.acknowledge", goi: (c) => c.andon.acknowledge({} as never), cong: "requirePermission(andon, canEdit)" },
  { duongDan: "maintenance.createWorkOrder", goi: (c) => c.maintenance.createWorkOrder({} as never), cong: "requirePermission(machine_monitoring, canCreate)" },
  { duongDan: "twin.models.uploadAndRegister", goi: (c) => c.twin.models.uploadAndRegister({} as never), cong: "requirePermission(machine_control, canCreate)" },
  { duongDan: "twinCanh.dungNhaXuong", goi: (c) => c.twinCanh.dungNhaXuong({} as never), cong: "quyenThietKe(canCreate)" },
  { duongDan: "twinCanh.goKhoiMatBang", goi: (c) => c.twinCanh.goKhoiMatBang({} as never), cong: "quyenThietKe(canDelete)" },
  { duongDan: "twinCanh.luuBanGhi", goi: (c) => c.twinCanh.luuBanGhi({} as never), cong: "quyenThietKe(canCreate)" },
  { duongDan: "twinCanh.luuHangLoat", goi: (c) => c.twinCanh.luuHangLoat({} as never), cong: "quyenThietKe(canEdit)" },
  { duongDan: "twinCanh.luuVungAnToan", goi: (c) => c.twinCanh.luuVungAnToan({} as never), cong: "quyenThietKe(canEdit)" },
  { duongDan: "twinCanh.sinhTuDong", goi: (c) => c.twinCanh.sinhTuDong({} as never), cong: "adminProcedure" },
  { duongDan: "twinCanh.taiAnhNen", goi: (c) => c.twinCanh.taiAnhNen({} as never), cong: "quyenThietKe(canCreate)" },
  { duongDan: "twinCanh.taiModelMay", goi: (c) => c.twinCanh.taiModelMay({} as never), cong: "quyenThietKe(canCreate)" },
  { duongDan: "twinCanh.xoaBanGhi", goi: (c) => c.twinCanh.xoaBanGhi({} as never), cong: "quyenThietKe(canDelete)" },
  { duongDan: "twinCanh.xoaVungAnToan", goi: (c) => c.twinCanh.xoaVungAnToan({} as never), cong: "quyenThietKe(canDelete)" },
  { duongDan: "twinCanh.xuatBanBanGhi", goi: (c) => c.twinCanh.xuatBanBanGhi({} as never), cong: "quyenThietKe(canEdit)" },
];

/**
 * §0 — NGOẠI LỆ CÓ LÝ DO. Mỗi dòng là một lời khai công khai; thêm dòng = review phải thấy đúng dòng ấy.
 * ⚠ `user.assignableTechnicians` KHÔNG phải "vô hại" — nó là món CÒN MỞ được ghi ra đây để không ai tưởng
 *   lưới đã phủ nó.
 */
const NGOAI_LE: Record<string, string> = {
  "digitalTwin.whatIf":
    "THUẦN — tính trên `stations[]` client gửi, không đọc CSDL (QA Đợt 41: 'tinh thuan, khong doc DB'); không có dữ liệu tenant để rò.",
  "orchestration.listWorkflows":
    "bảng `orchestration_workflows` TOÀN CỤC, không có cột nhà máy (QA Đợt 41 ghi nhận) — không có trục tenant để rào; cổng `machine_monitoring canView`.",
  "orchestration.simulate":
    "mô phỏng THUẦN trên định nghĩa workflow trong input; cổng `machine_monitoring canView`.",
  "user.assignableTechnicians":
    "CÒN MỞ (không thuộc 4 lỗ Đợt 42): `userRouters.ts:87` trả MỌI user isActive (id+name) qua `db.traKyThuatVienGanDuoc()`, không lọc nhà máy — QA Đợt 41 D-4 ghi nhận. Cổng `machine_monitoring canCreate`.",
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe.skipIf(!DB_URL)("Đợt 42 — thủ tục bốn màn twin gọi × vai × nhà máy (lưới tự động, G116)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    const trong = await taoNhaMay("TRONG");
    const ngoai = await taoNhaMay("NGOAI");
    const userTrongId = await taoUser("trong", VAI);
    const userKhongGanId = await taoUser("khonggan", VAI);
    const userKhongQuyenId = await taoUser("khongquyen", VAI);
    const userAdminId = await taoUser("admin", "admin");
    await capDuQuyen(userTrongId);
    await capDuQuyen(userKhongGanId);
    // ⚠ Nối bằng `factoryCode`, KHÔNG phải `factoryId` — bảng này không có cột `factoryId` (42703).
    await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${userTrongId}, ${trong.ma})`;
    fx = { trong, ngoai, userTrongId, userKhongGanId, userKhongQuyenId, userAdminId };
  }, 90_000);

  afterAll(async () => {
    if (fx) {
      const uids = [fx.userTrongId, fx.userKhongGanId, fx.userKhongQuyenId, fx.userAdminId];
      await sql`DELETE FROM permissions WHERE "userId" = ANY(${uids})`;
      await sql`DELETE FROM user_factory_assignments WHERE "userId" = ANY(${uids})`;
      await sql`DELETE FROM users WHERE id = ANY(${uids})`;
      await xoaNhaMay(fx.trong);
      await xoaNhaMay(fx.ngoai);
    }
    await sql.end({ timeout: 5 });
  }, 90_000);

  // ═══════════════════════════════════════════════════════════════════════════
  describe("§0 — BẤT BIẾN: tập thủ tục bốn màn gọi = tập lưới phủ (grep N = phủ N)", () => {
    const QUET = quetThuTuc();

    it(`★ grep ra ĐÚNG ${SO_THU_TUC_GHIM} đường dẫn (ghim — đổi số là một lời khai, kèm bảng ở dưới)`, () => {
      expect(QUET.size, [...QUET.keys()].sort().join("\n")).toBe(SO_THU_TUC_GHIM);
    });

    it("★★★ MỌI đường dẫn grep ra có tên ở ĐÚNG MỘT bảng (đọc · ghi · ngoại lệ) — và không bảng nào ghi thừa", () => {
      const doc = CA_DOC.map((c) => c.duongDan);
      const ghi = CA_GHI.map((c) => c.duongDan);
      const ngoaiLe = Object.keys(NGOAI_LE);
      const tatCa = [...doc, ...ghi, ...ngoaiLe];
      expect(new Set(tatCa).size, "một đường dẫn xuất hiện ở HAI bảng").toBe(tatCa.length);
      const thieu = [...QUET.keys()].filter((k) => !tatCa.includes(k)).sort();
      expect(
        thieu,
        `thủ tục MỚI mà bốn màn twin gọi, CHƯA có ca trong lưới này — xếp vào CA_DOC/CA_GHI hoặc NGOAI_LE (có lý do):\n` +
          thieu.map((k) => `  ${k}  ← ${[...(QUET.get(k) ?? [])].join(", ")}`).join("\n"),
      ).toEqual([]);
      const thua = tatCa.filter((k) => !QUET.has(k)).sort();
      expect(thua, "bảng ghi một thủ tục mà không màn twin nào còn gọi — gỡ dòng").toEqual([]);
    });

    it("cầu chì — mỗi thủ tục grep ra phải là một thủ tục CÓ THẬT trên `appRouter` (tên gõ sai ⇒ đỏ ở đây, không ở §1)", () => {
      const thuTuc = Object.keys((appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures);
      const khongCo = [...QUET.keys()].filter((k) => !thuTuc.includes(k)).sort();
      expect(khongCo).toEqual([]);
    });

    it("cầu chì — quét trúng ≥ 100 tệp và bốn trang (chống 'xanh vì quét trúng 0 thứ')", () => {
      const tep = tepBonMan().map((p) => p.split("\\").join("/"));
      expect(tep.length).toBeGreaterThanOrEqual(100);
      for (const t of ["TwinVanHanh.tsx", "TwinLine.tsx", "TwinMay.tsx", "TwinStudio.tsx", "MachineCockpit.tsx"]) {
        expect(tep.some((p) => p.endsWith(`/${t}`)), t).toBe(true);
      }
    });
  });

  it("ca dương DỰNG ĐƯỢC THẬT + ĐỐI CHỨNG DANH TÍNH (người thử gán ĐÚNG MỘT nhà máy, người kia 0)", async () => {
    expect(fx).not.toBeNull();
    const g = await sql`SELECT "factoryCode" FROM user_factory_assignments WHERE "userId" = ${fx!.userTrongId}`;
    expect((g as unknown as Array<{ factoryCode: string }>).map((r) => r.factoryCode)).toEqual([fx!.trong.ma]);
    expect(await sql`SELECT 1 FROM user_factory_assignments WHERE "userId" = ${fx!.userKhongGanId}`).toHaveLength(0);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe.each(CA_DOC)("§1 $duongDan", (ca) => {
    const chanTheoPhamVi = (k: KetQua, nhan: string): void => {
      expect(
        (k.ok ? false : k.appCode) !== "PERMISSION_DENIED",
        `${ca.duongDan} ${nhan}: bị chặn bởi cổng RBAC (PERMISSION_DENIED) — fixture thiếu quyền, chưa chạm hàng rào tenant (G43)`,
      ).toBe(true);
      expect(ca.chan(k), `${ca.duongDan} ${nhan}: ${JSON.stringify(k).slice(0, 300)}`).toBe(true);
    };

    it("(0) người 0 gán — hỏi A lẫn B ⇒ chặn/rỗng, thân KHÔNG có mã của bất kỳ nhà máy nào", async () => {
      const c = goiVoi(fx!.userKhongGanId);
      for (const nm of ca.khongInput ? [fx!.trong] : [fx!.trong, fx!.ngoai]) {
        const k = await thu(ca.goi(c, nm));
        chanTheoPhamVi(k, `0-gán hỏi ${nm.ma}`);
        expect(khongCoMa(k, DAU), `${ca.duongDan}: thân rò mã ${DAU}: ${chuoi(k).slice(0, 200)}`).toBe(true);
      }
    });

    it("(−) người gán A hỏi B ⇒ chặn/rỗng, thân KHÔNG có mã của B", async () => {
      const k = await thu(ca.goi(goiVoi(fx!.userTrongId), fx!.ngoai));
      if (!ca.khongInput) chanTheoPhamVi(k, "A hỏi B");
      else expect(k.ok, `${ca.duongDan}: ${JSON.stringify(k).slice(0, 200)}`).toBe(true);
      expect(khongCoMa(k, fx!.ngoai.ma), `${ca.duongDan}: thân rò mã ${fx!.ngoai.ma}: ${chuoi(k).slice(0, 200)}`).toBe(true);
    });

    it("(+) người gán A hỏi A ⇒ CÓ — đối chứng dương, chống 'vá quá tay thành chặn tất cả'", async () => {
      const k = await thu(ca.goi(goiVoi(fx!.userTrongId), fx!.trong));
      expect(k.ok, `${ca.duongDan} (+): ${JSON.stringify(k).slice(0, 300)}`).toBe(true);
      expect(ca.duong(k.ok ? k.data : null, fx!.trong), `${ca.duongDan} (+): đối chứng dương không thấy dữ liệu của A: ${chuoi(k).slice(0, 300)}`).toBe(true);
    });

    it("(∞) admin hỏi B ⇒ CÓ — phạm vi `null` không thêm mệnh đề nào", async () => {
      const k = await thu(ca.goi(goiVoi(fx!.userAdminId, "admin"), fx!.ngoai));
      expect(k.ok, `${ca.duongDan} admin: ${JSON.stringify(k).slice(0, 300)}`).toBe(true);
      expect(ca.duong(k.ok ? k.data : null, fx!.ngoai), `${ca.duongDan} admin: không thấy dữ liệu của B`).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("§2 — đường GHI: người 0 QUYỀN, input rỗng ⇒ cổng RBAC chặn TRƯỚC parse (không BAD_REQUEST, không ghi)", () => {
    it.each(CA_GHI)("$duongDan — $cong", async (ca) => {
      const k = await thu(ca.goi(goiVoi(fx!.userKhongQuyenId)));
      expect(k.ok, `${ca.duongDan}: mutation THÀNH CÔNG với người 0 quyền, input rỗng`).toBe(false);
      if (k.ok) return;
      expect(["FORBIDDEN", "UNAUTHORIZED"], `${ca.duongDan}: ${k.code} ${k.appCode ?? ""} ${k.msg}`).toContain(k.code);
      expect(k.code, `${ca.duongDan}: zod chạy TRƯỚC cổng quyền`).not.toBe("BAD_REQUEST");
    });
  });
});
