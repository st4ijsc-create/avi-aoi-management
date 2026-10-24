/**
 * ★★★ Lô W15 — hai lỗ ngoài-phạm vi do kiểm định W14 phát hiện (dieu-phoi giao 2026-10-25):
 *  (1) machine.register CÔNG KHAI không được sửa máy ĐÃ CÓ theo serial / không đổi registrationStatus / phản hồi y hệt máy mới (không lộ serial, không trả id);
 *  (2) hot-folder: watchPath / archivePath / errorPath chỉ trong gốc HOT_FOLDER_ROOTS (mặc định rỗng ⇒ từ chối), chặn `..` và symlink ra ngoài.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

process.env.PROCESS_RESULT_INGEST_ENABLED = "true";
process.env.MACHINE_REGISTER_PENDING_CAP = "0"; // _test có thể đã đầy hàng chờ; trần được kiểm riêng ở hierarchyRegisterThrottle.test
const RUN = `pw18${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];
const one = async (q: ReturnType<typeof sql>) => (await dung(q))[0];
const so = async (q: ReturnType<typeof sql>) => Number((await one(q)).n);
let mid = 0;
let sid = 0;
const factories: string[] = [];
let thuMuc = "";
let ngoai = "";
let sidB = 0;
let hot!: ReturnType<typeof import("./hotFolderRouter").hotFolderRouter.createCaller>;
let mach!: ReturnType<typeof import("./hierarchyRouters").machineRouter.createCaller>;
const code = `${RUN}a`;
const serialCo = `${RUN}-sn-co`;

async function maLoi(chay: () => Promise<unknown>): Promise<string | null> {
  try {
    await chay();
    return null;
  } catch (e) {
    return String((e as { code?: string }).code ?? "LOI_LA");
  }
}

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code + " f"}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code + " l"}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`);
  sid = Number(s.id);
  const [m] = await dung(
    sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive", "serialNumber", "registrationStatus", "lifecycleStatus", model, "firmwareVersion")
        VALUES (${s.id}, ${code}, 'TEN-GOC', 'AOI', true, ${serialCo}, 'approved', 'active', 'MODEL-GOC', 'FW-1') RETURNING id`,
  );
  mid = Number(m.id);
  factories.push(code);
  // nhà máy B (trạm để máy A khai nhầm)
  const codeB = `${RUN}b`;
  const [fb] = await dung(sql`INSERT INTO factories (code, name) VALUES (${codeB}, ${codeB + " f"}) RETURNING id`);
  const [wb] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${fb.id}, ${codeB}, ${codeB + " w"}) RETURNING id`);
  const [lb] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${wb.id}, ${codeB}, ${codeB + " l"}) RETURNING id`);
  const [sb] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${lb.id}, ${codeB}, ${codeB + " s"}) RETURNING id`);
  sidB = Number(sb.id);
  factories.push(codeB);
  const u = await taoNguoiDungTest("ua", "supervisor", { tienTo: "pw18", ts: RUN, ten: "PW18 ua" });
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`);
  for (const [cat, mod] of [
    ["machine_monitoring", "machine_control"],
    ["machine_monitoring", "machine_monitoring"],
  ] as const) {
    await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${u.id}, ${cat}, ${mod}, true, true, true, true)`);
  }
  thuMuc = fs.mkdtempSync(path.join(os.tmpdir(), "pw18-"));
  fs.mkdirSync(path.join(thuMuc, "goc", "may1"), { recursive: true });
  ngoai = path.join(thuMuc, "goc-anh-em");
  fs.mkdirSync(ngoai, { recursive: true });
  const ctx = { user: { id: u.id, role: "supervisor", name: u.name, twoFactorEnabled: true } } as never;
  hot = (await import("./hotFolderRouter")).hotFolderRouter.createCaller(ctx);
  mach = (await import("./hierarchyRouters")).machineRouter.createCaller({ user: null, req: { ip: "203.0.113.9" } } as never);
}, 120_000);

afterAll(async () => {
  delete process.env.HOT_FOLDER_ROOTS;
  if (!db) return;
  const like = RUN + "%";
  await dung(sql`DELETE FROM hot_folder_configs WHERE "machineId" = ${mid}`).catch(() => undefined);
  await dung(sql`DELETE FROM machines WHERE "serialNumber" LIKE ${like} OR code LIKE ${like}`).catch(() => undefined);
  for (const c of factories) {
    await dung(sql`DELETE FROM stations WHERE code = ${c}`).catch(() => undefined);
    await dung(sql`DELETE FROM production_lines WHERE code = ${c}`).catch(() => undefined);
    await dung(sql`DELETE FROM workshops WHERE code = ${c}`).catch(() => undefined);
  }
  await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM factories WHERE code LIKE ${like}`).catch(() => undefined);
  if (thuMuc) fs.rmSync(thuMuc, { recursive: true, force: true });
}, 60_000);

describe("machine.register công khai", () => {
  it("máy ĐÃ DUYỆT + register cùng serial với tên / loại / firmware khác ⇒ hàng KHÔNG đổi, registrationStatus vẫn 'approved'; phản hồi y hệt serial mới; không trả id", async () => {
    const truoc = await one(sql`SELECT name, "machineType", model, "firmwareVersion", "registrationStatus", "lifecycleStatus" FROM machines WHERE id = ${mid}`);
    const rCo = await mach.register({ serialNumber: serialCo, name: "KE-TAN-CONG", machineType: "SPI", model: "X", firmwareVersion: "FW-HACK", syncMode: "offline" } as never);
    const rMoi = await mach.register({ serialNumber: `${RUN}-sn-moi`, name: "may-moi", machineType: "AOI" } as never);
    expect(rCo).toEqual(rMoi);
    expect(Object.keys(rCo)).not.toContain("id");
    const sau = await one(sql`SELECT name, "machineType", model, "firmwareVersion", "registrationStatus", "lifecycleStatus" FROM machines WHERE id = ${mid}`);
    expect(sau).toEqual(truoc);
    expect(sau.registrationStatus).toBe("approved");
    expect(await so(sql`SELECT count(*)::int AS n FROM machines WHERE "serialNumber" = ${RUN + "-sn-moi"} AND "registrationStatus" = 'pending'`)).toBe(1);
  });
});

describe("hot-folder — gốc cho phép", () => {
  it("không đặt HOT_FOLDER_ROOTS ⇒ từ chối tạo; ngoài gốc / traversal / thư mục anh em tiền tố trùng ⇒ từ chối; trong gốc ⇒ được; đổi sang đường ngoài gốc ⇒ từ chối", async () => {
    const goc = path.join(thuMuc, "goc");
    const dat = (watchPath: string, extra: Record<string, unknown> = {}) => hot.createConfig({ machineId: mid, adapterKey: "generic-json", watchPath, ...extra } as never);
    delete process.env.HOT_FOLDER_ROOTS;
    expect(await maLoi(() => dat(path.join(goc, "may1")))).toBe("BAD_REQUEST");
    process.env.HOT_FOLDER_ROOTS = goc;
    expect(await maLoi(() => dat(ngoai))).toBe("BAD_REQUEST");
    expect(await maLoi(() => dat(path.join(goc, "may1", "..", "..", "goc-anh-em")))).toBe("BAD_REQUEST");
    expect(await maLoi(() => dat(path.join(goc, "may1"), { archivePath: path.join(ngoai, "arch") }))).toBe("BAD_REQUEST");
    expect(await so(sql`SELECT count(*)::int AS n FROM hot_folder_configs WHERE "machineId" = ${mid}`)).toBe(0);
    const tao = (await hot.createConfig({ machineId: mid, adapterKey: "generic-json", watchPath: path.join(goc, "may1"), enabled: false } as never)) as { id: number };
    expect(tao.id).toBeGreaterThan(0);
    expect(await maLoi(() => hot.updateConfig({ id: tao.id, patch: { watchPath: ngoai } }))).toBe("BAD_REQUEST");
    expect(await so(sql`SELECT count(*)::int AS n FROM hot_folder_configs WHERE id = ${tao.id} AND "watchPath" = ${path.join(goc, "may1")}`)).toBe(1);
  });
});

describe("machineApi.submitProcessResult — qua KHOÁ MÁY thật (đầu–cuối)", () => {
  it("máy A gửi kết quả khai stationId của nhà máy B ⇒ BAD_REQUEST, không ghi process_results; khai trạm của chính nhà máy A ⇒ được", async () => {
    const { issueMachineKey } = await import("../services/machineAuthService");
    const k = await issueMachineKey({ machineId: mid, name: `${RUN}-e2e` });
    const api = (await import("./machineApiRouters")).machineApiRouter.createCaller({ user: null, req: { ip: "203.0.113.10", headers: {} } } as never);
    const serial = `${RUN}-ps`;
    const goi = (stationId: number) => api.submitProcessResult({ apiKey: k.plaintextKey, machineCode: code, serialNumber: serial, stepType: "reflow", result: "pass", stationId } as never);
    const loi = await maLoi(() => goi(sidB));
    expect(loi).toBe("BAD_REQUEST");
    expect(await so(sql`SELECT count(*)::int AS n FROM process_results WHERE "serialNumber" = ${serial}`)).toBe(0);
    const ok = await goi(sid);
    expect(ok).toMatchObject({ success: true });
    expect(await so(sql`SELECT count(*)::int AS n FROM process_results WHERE "serialNumber" = ${serial} AND "stationId" = ${sid}`)).toBe(1);
    await dung(sql`DELETE FROM process_results WHERE "serialNumber" = ${serial}`).catch(() => undefined);
    await dung(sql`DELETE FROM api_keys WHERE name = ${RUN + "-e2e"}`).catch(() => undefined);
  });
});
