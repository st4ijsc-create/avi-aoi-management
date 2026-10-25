/**
 * R1b-2a T14 — don-rac-test-r1b2.mjs chạy THẬT trên `_test` (vai owner), bằng bộ hàng RIÊNG của test (không động rác thật):
 * chạy khô không ghi gì · chạy thật xoá ĐÚNG danh sách (hàng "lính canh" trùng tiền tố r1b2 nhưng không có trong danh sách vẫn còn) ·
 * chạy lại ⇒ xoá 0 · mã không khớp mẫu ⇒ từ chối, không xoá gì.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
// @ts-expect-error — .mjs không có khai báo kiểu
import { chay } from "./don-rac-test-r1b2.mjs";
// @ts-expect-error — .mjs không có khai báo kiểu
import { asOwner, testDbUrl } from "./apply-migration-dot10-common.mjs";

const DAU = `r1b2t14${Date.now().toString(36)}`;
let sql: ReturnType<typeof postgres>;
let adminId: number;
const muc = { adapters: [] as number[], edgeNodes: [] as number[], machines: [] as number[], stations: [] as number[], lines: [] as number[], workshops: [] as number[], factories: [] as number[] };
const linhGac = { edgeNodes: [] as number[], adapters: [] as number[], machines: [] as number[], stations: [] as number[], lines: [] as number[], workshops: [] as number[], factories: [] as number[] };

const one = async (p: Promise<any[]>) => Number((await p)[0].id);

async function dungChuoi(nhan: string, m: typeof muc) {
  const f = await one(sql`INSERT INTO factories (code, name) VALUES (${`${DAU}${nhan}`}, ${`${DAU}${nhan}`}) RETURNING id`);
  const w = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f}, ${`${DAU}${nhan}`}, 'w') RETURNING id`);
  const l = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w}, ${`${DAU}${nhan}`}, 'l') RETURNING id`);
  const s = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l}, ${`${DAU}${nhan}`}, 's') RETURNING id`);
  const mc = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s}, ${`${DAU}${nhan}`}, 'm', 'AUTOMATION', true) RETURNING id`);
  const a = await one(sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled", "machineId") VALUES (${`${DAU}${nhan}`}, 'a', 'stub', 'stub://t14', false, ${mc}) RETURNING id`);
  await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable) VALUES (${a}, 'sp', 'holding:1', 'int', false)`;
  m.factories.push(f); m.workshops.push(w); m.lines.push(l); m.stations.push(s); m.machines.push(mc); m.adapters.push(a);
  return a;
}

async function dem(m: typeof muc) {
  const c = async (bang: string, ids: number[]) => (ids.length ? Number((await sql`SELECT count(*)::int AS n FROM ${sql(bang)} WHERE id IN ${sql(ids)}`)[0].n) : 0);
  return {
    adapters: await c("device_adapters", m.adapters),
    edgeNodes: await c("edge_nodes", m.edgeNodes),
    machines: await c("machines", m.machines),
    stations: await c("stations", m.stations),
    lines: await c("production_lines", m.lines),
    workshops: await c("workshops", m.workshops),
    factories: await c("factories", m.factories),
    tags: m.adapters.length ? Number((await sql`SELECT count(*)::int AS n FROM device_tags WHERE "adapterId" IN ${sql(m.adapters)}`)[0].n) : 0,
    stops: m.adapters.length ? Number((await sql`SELECT count(*)::int AS n FROM robot_motion_lock_requests WHERE "adapterId" IN ${sql(m.adapters)}`)[0].n) : 0,
  };
}

async function xoaHet(m: typeof muc) {
  // dọn dự phòng (lỗi giữa chừng): STOP refused cần giải quyết trước
  for (const r of m.adapters.length ? await sql`SELECT id FROM robot_motion_lock_requests WHERE "adapterId" IN ${sql(m.adapters)} AND outcome IN ('refused','failed') AND "resolvedAt" IS NULL` : [])
    await sql`SELECT public.edge_stop_resolve(${r.id}, ${adminId}, 'T14 test don')`.catch(() => undefined);
  const del = async (bang: string, ids: number[]) => ids.length && sql`DELETE FROM ${sql(bang)} WHERE id IN ${sql(ids)}`.catch(() => undefined);
  if (m.adapters.length) {
    await sql`DELETE FROM robot_motion_lock_requests WHERE "adapterId" IN ${sql(m.adapters)}`.catch(() => undefined);
    await sql`DELETE FROM device_tags WHERE "adapterId" IN ${sql(m.adapters)}`.catch(() => undefined);
  }
  await del("device_adapters", m.adapters);
  await del("edge_nodes", m.edgeNodes);
  await del("machines", m.machines);
  await del("stations", m.stations);
  await del("production_lines", m.lines);
  await del("workshops", m.workshops);
  await del("factories", m.factories);
}

beforeAll(async () => {
  sql = postgres(asOwner(testDbUrl()), { max: 1, onnotice: () => undefined });
  const [d] = await sql`SELECT current_database() AS d`;
  expect(String(d.d)).toMatch(/_test$/);
  adminId = Number((await sql`SELECT id FROM users WHERE role = 'admin' AND "isActive" = true ORDER BY id LIMIT 1`)[0].id);
  const a = await dungChuoi("a", muc);
  muc.edgeNodes.push(await one(sql`INSERT INTO edge_nodes (code, name, status) VALUES (${`${DAU}-en`}, 'r1b2 edge', 'offline') RETURNING id`));
  // STOP đã bị từ chối và chưa giải quyết — chặn xoá thiết bị cho tới khi `edge_stop_resolve`
  const [{ ownerEpoch: ep }] = await sql`UPDATE device_adapters SET "edgeNodeId" = ${muc.edgeNodes[0]} WHERE id = ${a} RETURNING "ownerEpoch"`;
  const q = await one(sql`INSERT INTO robot_motion_lock_requests ("adapterId", "edgeNodeId", kind, "requestedBy", "expiresAt", "ownerEpoch")
            VALUES (${a}, ${muc.edgeNodes[0]}, 'stop', ${adminId}, now() + interval '1 hour', ${ep}) RETURNING id`);
  await sql`UPDATE robot_motion_lock_requests SET "deliveredAt" = now(), "ackedAt" = now(), outcome = 'refused' WHERE id = ${q}`;
  linhGac.edgeNodes.push(await one(sql`INSERT INTO edge_nodes (code, name, status) VALUES (${`${DAU}-eg`}, 'r1b2 edge', 'offline') RETURNING id`));
  await dungChuoi("g", linhGac); // lính canh: tiền tố r1b2 nhưng KHÔNG nằm trong danh sách
});

afterAll(async () => {
  await xoaHet(muc);
  await xoaHet(linhGac);
  await sql.end({ timeout: 2 });
});

const chayThat = (argv: string[], m = muc) => {
  const out: string[] = [];
  const err: string[] = [];
  return chay({ argv, muc: m, log: (x: string) => out.push(x), err: (x: string) => err.push(x) }).then((code: number) => ({ code, out: out.join("\n"), err: err.join("\n") }));
};

describe("don-rac-test-r1b2 trên _test", () => {
  it("chạy khô: in bảng, thoát 0, KHÔNG ghi gì (đếm trước = sau, STOP vẫn chưa giải quyết)", async () => {
    const truoc = await dem(muc);
    expect(truoc).toMatchObject({ adapters: 1, edgeNodes: 1, machines: 1, stations: 1, lines: 1, workshops: 1, factories: 1, tags: 1, stops: 1 });
    const r = await chayThat(["--test-only"]);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/CHAY KHO/);
    expect(r.out).toMatch(/device_adapters\s+1\b/);
    expect(r.out).toMatch(/WORM/);
    expect(await dem(muc)).toEqual(truoc);
    const [st] = await sql`SELECT "resolvedAt" FROM robot_motion_lock_requests WHERE "adapterId" IN ${sql(muc.adapters)}`;
    expect(st.resolvedAt).toBeNull();
  });

  it("mã không khớp mẫu ⇒ từ chối (thoát 2), không xoá gì", async () => {
    const truoc = await dem(muc);
    const r = await chay({ argv: ["--test-only", "--ghi"], muc, mauMa: /^khong-khop-/, log: () => undefined, err: () => undefined });
    expect(r).toBe(2);
    expect(await dem(muc)).toEqual(truoc);
  });

  it("--ghi xoá ĐÚNG danh sách; lính canh r1b2 (không có trong danh sách) còn nguyên", async () => {
    const canhTruoc = await dem(linhGac);
    const r = await chayThat(["--test-only", "--ghi"]);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/DA XOA/);
    expect(await dem(muc)).toEqual({ adapters: 0, edgeNodes: 0, machines: 0, stations: 0, lines: 0, workshops: 0, factories: 0, tags: 0, stops: 0 });
    expect(await dem(linhGac)).toEqual(canhTruoc);
    expect(canhTruoc.adapters).toBe(1);
  });

  it("chạy lại ⇒ xoá 0 (idempotent)", async () => {
    const r = await chayThat(["--test-only", "--ghi"]);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/so hang xoa: 0\b/);
  });
});
