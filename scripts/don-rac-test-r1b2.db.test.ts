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

// Tiền tố RIÊNG (không phải ^(r1b2|pvk|tth) dùng chung trên _test): đích tìm bằng mauMaSql riêng ⇒ không chạm fixture của test DB khác đang chạy.
const T = Date.now().toString(36);
const DAU = `t13dr${T}`;
const DAU_CANH = `t13dq${T}`; // lính canh: KHÔNG khớp ^t13dr
const MAU = `^${DAU}`; // duy nhất cho lượt chạy này: dư lại của lượt chạy hỏng trước đó không bị tìm thấy
let sql: ReturnType<typeof postgres>;
let adminId: number;
const muc = { adapters: [] as number[], edgeNodes: [] as number[], machines: [] as number[], stations: [] as number[], lines: [] as number[], workshops: [] as number[], factories: [] as number[] };
const linhGac = { edgeNodes: [] as number[], adapters: [] as number[], machines: [] as number[], stations: [] as number[], lines: [] as number[], workshops: [] as number[], factories: [] as number[] };

const one = async (p: Promise<any[]>) => Number((await p)[0].id);

async function dungChuoi(nhan: string, m: typeof muc, DAU: string) {
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
  const a = await dungChuoi("a", muc, DAU);
  muc.edgeNodes.push(await one(sql`INSERT INTO edge_nodes (code, name, status) VALUES (${`${DAU}-en`}, 'r1b2 edge', 'offline') RETURNING id`));
  // STOP đã bị từ chối và chưa giải quyết — chặn xoá thiết bị cho tới khi `edge_stop_resolve`
  const [{ ownerEpoch: ep }] = await sql`UPDATE device_adapters SET "edgeNodeId" = ${muc.edgeNodes[0]} WHERE id = ${a} RETURNING "ownerEpoch"`;
  const q = await one(sql`INSERT INTO robot_motion_lock_requests ("adapterId", "edgeNodeId", kind, "requestedBy", "expiresAt", "ownerEpoch")
            VALUES (${a}, ${muc.edgeNodes[0]}, 'stop', ${adminId}, now() + interval '1 hour', ${ep}) RETURNING id`);
  await sql`UPDATE robot_motion_lock_requests SET "deliveredAt" = now(), "ackedAt" = now(), outcome = 'refused' WHERE id = ${q}`;
  linhGac.edgeNodes.push(await one(sql`INSERT INTO edge_nodes (code, name, status) VALUES (${`${DAU_CANH}-eg`}, 'r1b2 edge', 'offline') RETURNING id`));
  await dungChuoi("g", linhGac, DAU_CANH); // lính canh: tiền tố khác, KHÔNG khớp mẫu tìm
});

afterAll(async () => {
  await xoaHet(muc);
  await xoaHet(linhGac);
  await sql.end({ timeout: 2 });
});

const chayThat = (argv: string[]) => {
  const out: string[] = [];
  const err: string[] = [];
  return chay({ argv, mauMaSql: MAU, log: (x: string) => out.push(x), err: (x: string) => err.push(x) }).then((code: number) => ({ code, out: out.join("\n"), err: err.join("\n") }));
};

/** Chạy khô rồi lấy đúng chuỗi --ids đã in. */
async function layIds() {
  const kho = await chayThat(["--test-only"]);
  expect(kho.code, kho.err).toBe(0);
  const m = /--ids=(\S+)/.exec(kho.out);
  expect(m, kho.out).not.toBeNull();
  return { kho, ids: m![1] };
}

describe("don-rac-test-r1b2 trên _test", () => {
  it("adapter tìm được mà gắn máy KHÔNG khớp mẫu ⇒ từ chối (mồ côi), 0 xoá; gỡ nó ⇒ chạy khô in JSON đúng id", async () => {
    const orphan = await one(sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled", "machineId") VALUES (${`${DAU}yy`}, 'o', 'stub', 'stub://t13', false, ${linhGac.machines[0]}) RETURNING id`);
    linhGac.adapters.push(orphan);
    try {
      const truoc = await dem(muc);
      const r = await chayThat(["--test-only"]);
      expect(r.code, r.out).toBe(2);
      expect(r.err).toMatch(new RegExp(`device_adapters id ${orphan} gan may`));
      expect(await dem(muc)).toEqual(truoc);
    } finally {
      await sql`DELETE FROM device_adapters WHERE id = ${orphan}`;
      linhGac.adapters.pop();
    }
    const k = await chayThat(["--test-only"]);
    expect(k.code, k.err).toBe(0);
    const json = JSON.parse(/MUC_TIEU tìm được:\n([\s\S]*?)\n\[don-rac r1b2\] --ids=/.exec(k.out)![1]);
    expect(json).toEqual({ adapters: muc.adapters, edgeNodes: muc.edgeNodes, machines: muc.machines, stations: muc.stations, lines: muc.lines, workshops: muc.workshops, factories: muc.factories, machineMoCoi: {} });
  });

  it("adapter NGOÀI đích trỏ máy đích ⇒ từ chối (xoá máy sẽ làm nó mồ côi), 0 xoá", async () => {
    const ngoai = await one(sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled", "machineId") VALUES (${`${DAU_CANH}pp`}, 'p', 'stub', 'stub://t13', false, ${muc.machines[0]}) RETURNING id`);
    linhGac.adapters.push(ngoai);
    try {
      const truoc = await dem(muc);
      const ids = (["adapters", "edgeNodes", "machines", "stations", "lines", "workshops", "factories"] as const)
        .filter((k) => muc[k].length)
        .map((k) => `${k}:${muc[k].join(".")}`)
        .join(",");
      for (const argv of [["--test-only"], ["--test-only", "--ghi", `--ids=${ids}`]]) {
        const r = await chayThat(argv);
        expect(r.code, r.out).toBe(2);
        expect(r.err).toMatch(new RegExp(`adapter ngoai dich id ${ngoai} tro may dich`));
      }
      expect(await dem(muc)).toEqual(truoc);
    } finally {
      await sql`DELETE FROM device_adapters WHERE id = ${ngoai}`;
      linhGac.adapters.pop();
    }
  });

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

  it("STOP chưa ack trên adapter đích ⇒ từ chối (thoát 2), không xoá gì — cả chạy khô lẫn --ghi", async () => {
    const [{ ownerEpoch: ep }] = await sql`SELECT "ownerEpoch" FROM device_adapters WHERE id = ${muc.adapters[0]}`;
    const q = await one(sql`INSERT INTO robot_motion_lock_requests ("adapterId", "edgeNodeId", kind, "requestedBy", "expiresAt", "ownerEpoch")
              VALUES (${muc.adapters[0]}, ${muc.edgeNodes[0]}, 'stop', ${adminId}, now() + interval '1 hour', ${ep}) RETURNING id`);
    try {
      const truoc = await dem(muc);
      const { ids } = await (async () => {
        // chạy khô bị chặn bởi STOP chưa ack ⇒ dựng --ids từ tập đã biết
        const g = (m: typeof muc) => ["adapters", "edgeNodes", "machines", "stations", "lines", "workshops", "factories"].map((k) => [k, (m as any)[k]] as const).filter(([, v]) => v.length).map(([k, v]) => `${k}:${v.join(".")}`).join(",");
        return { ids: g(muc) };
      })();
      for (const argv of [["--test-only"], ["--test-only", "--ghi", `--ids=${ids}`]]) {
        const r = await chayThat(argv);
        expect(r.code, r.out).toBe(2);
        expect(r.err).toMatch(new RegExp(`STOP chua ack \\(id ${q}\\)`));
      }
      expect(await dem(muc)).toEqual(truoc);
    } finally {
      // đưa về trạng thái "đã ack, bị từ chối" để các ca sau (giải quyết + xoá) chạy như thường
      await sql`UPDATE robot_motion_lock_requests SET "deliveredAt" = now(), "ackedAt" = now(), outcome = 'refused' WHERE id = ${q}`;
    }
  });

  it("mã không khớp mẫu ⇒ từ chối (thoát 2), không xoá gì", async () => {
    const truoc = await dem(muc);
    const { ids } = await layIds();
    const r = await chay({ argv: ["--test-only", "--ghi", `--ids=${ids}`], mauMaSql: MAU, mauMa: /^khong-khop-/, log: () => undefined, err: () => undefined });
    expect(r).toBe(2);
    expect(await dem(muc)).toEqual(truoc);
  });

  it("--ghi thiếu --ids, hoặc --ids thiếu/dư một id so với tập tìm lại ⇒ từ chối, 0 xoá", async () => {
    const truoc = await dem(muc);
    const { ids } = await layIds();
    expect((await chayThat(["--test-only", "--ghi"])).code).toBe(2);
    const bot = ids.replace(/^adapters:\d+,?/, "") || "-"; // bỏ nhóm adapters
    const thua = ids.replace(/factories:(\d+)/, "factories:$1.999999999");
    for (const sai of [bot, thua]) {
      const r = await chayThat(["--test-only", "--ghi", `--ids=${sai}`]);
      expect(r.code, r.out).toBe(2);
      expect(r.err).toMatch(/KHAC --ids da duyet/);
    }
    expect(await dem(muc)).toEqual(truoc);
  });

  it("--ghi xoá ĐÚNG danh sách tìm được; lính canh (tiền tố khác) còn nguyên", async () => {
    const canhTruoc = await dem(linhGac);
    // adapter mồ côi lơ lửng: machineId trỏ id không tồn tại (không FK), id rất cao hơn last_value của machines_id_seq
    const [{ last_value: lv }] = await sql`SELECT last_value FROM machines_id_seq`;
    const may = Number(lv) + 1_000_000;
    expect(Number((await sql`SELECT count(*)::int AS n FROM machines WHERE id = ${may}`)[0].n)).toBe(0);
    const treo = await one(sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled", "machineId") VALUES (${`${DAU}dd`}, 'd', 'stub', 'stub://t13', false, ${may}) RETURNING id`);
    // adapter machineId NULL cũng là đích hợp lệ
    const khong = await one(sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled") VALUES (${`${DAU}nn`}, 'n', 'stub', 'stub://t13', false) RETURNING id`);
    try {
      const { kho, ids } = await layIds();
      expect(ids).toContain(`moCoi:${treo}>${may}`);
      expect(ids).toContain(String(khong));
      expect(kho.out).toMatch(new RegExp(`"machineMoCoi": \\{\\s*"${treo}": ${may}\\s*\\}`));
      // bỏ nhóm moCoi khỏi chuỗi duyệt ⇒ từ chối, treo còn nguyên
      const khongMoCoi = ids.replace(/,moCoi:\S+$/, "");
      const tu = await chayThat(["--test-only", "--ghi", `--ids=${khongMoCoi}`]);
      expect(tu.code, tu.out).toBe(2);
      expect(Number((await sql`SELECT count(*)::int AS n FROM device_adapters WHERE id = ${treo}`)[0].n)).toBe(1);
      const r = await chayThat(["--test-only", "--ghi", `--ids=${ids}`]);
      expect(r.code, r.err).toBe(0);
      expect(r.out).toMatch(/DA XOA/);
      expect(Number((await sql`SELECT count(*)::int AS n FROM device_adapters WHERE id IN (${treo}, ${khong})`)[0].n)).toBe(0);
    } finally {
      await sql`DELETE FROM device_adapters WHERE id IN (${treo}, ${khong})`;
    }
    expect(await dem(muc)).toEqual({ adapters: 0, edgeNodes: 0, machines: 0, stations: 0, lines: 0, workshops: 0, factories: 0, tags: 0, stops: 0 });
    expect(await dem(linhGac)).toEqual(canhTruoc);
    expect(canhTruoc.adapters).toBe(1);
  });

  it("chạy lại ⇒ xoá 0 (idempotent)", async () => {
    const { ids } = await layIds();
    expect(ids).toBe("-");
    const r = await chayThat(["--test-only", "--ghi", `--ids=${ids}`]);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/so hang xoa: 0\b/);
  });
});
