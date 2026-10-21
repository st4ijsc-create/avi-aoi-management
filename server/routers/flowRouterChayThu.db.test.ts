/**
 * Đợt 9.1 — `flow.chayThuNut` qua `createCaller` trên CSDL `_test`: vai chỉ-đọc bị chặn · KHÔNG tạo hàng nào ở
 * `ai_flow_runs/steps/queue/events/waits` · HTTP chỉ xem trước (không giải mã bí mật) · đề xuất OT chỉ MÔ PHỎNG · output dài bị cắt.
 */
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { flowRouter } from "./flowRouter";

const nut = (type: string, parameters: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  id: "n1", type, typeVersion: 1, name: "n1", position: [0, 0] as [number, number], parameters, ...extra,
});
let uid = 0;
const goi = (role: string) => flowRouter.createCaller({ user: { id: uid, role } } as never);

async function demHang(): Promise<number[]> {
  const db = (await getDb())!;
  const r = (await db.execute(sql`SELECT
    (SELECT count(*) FROM ai_flow_runs)::int AS a, (SELECT count(*) FROM ai_flow_steps)::int AS b,
    (SELECT count(*) FROM ai_flow_queue)::int AS c, (SELECT count(*) FROM ai_flow_events)::int AS d,
    (SELECT count(*) FROM ai_flow_waits)::int AS e`)) as unknown as Record<string, number>[];
  return [r[0].a, r[0].b, r[0].c, r[0].d, r[0].e];
}

beforeAll(async () => {
  const [u] = (await (await getDb())!.execute(sql`SELECT id FROM users ORDER BY id LIMIT 1`)) as unknown as { id: number }[];
  uid = u.id;
});

describe("flow.chayThuNut (Đợt 9.1, DB)", () => {
  it("vai chỉ-đọc (viewer) bị chặn", async () => {
    await expect(goi("viewer").chayThuNut({ nut: nut("du-lieu.dat", { truong: { a: 1 } }) })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("chạy thật node lõi; không tạo hàng nào ở bảng lượt chạy", async () => {
    const truoc = await demHang();
    const r = await goi("engineer").chayThuNut({ nut: nut("du-lieu.dat", { truong: { gap: "{{ $json.x * 2 }}" } }), inputs: { main: [{ json: { x: 4 } }] } });
    expect(r).toMatchObject({ che: "chay", ok: true, output: { main: [{ json: { x: 4, gap: 8 } }] } });
    expect(await demHang()).toEqual(truoc);
  });

  it("HTTP: xem trước, không giải mã bí mật (id không có trong CSDL vẫn không lỗi)", async () => {
    const r = await goi("engineer").chayThuNut({
      nut: nut("tich-hop.http-gui", { url: "https://x.example/{{ $json.id }}" }, { credentialRef: "khong-ton-tai" }),
      inputs: { main: [{ json: { id: "Q" } }] },
    });
    expect(r).toMatchObject({ che: "xem-truoc", ok: true, thamSoDaDanhGia: { url: "https://x.example/Q" }, credentialRef: "khong-ton-tai" });
  });

  it("đầu ra dài bị cắt như dòng thời gian", async () => {
    const dai = "x".repeat(40_000);
    const r = await goi("engineer").chayThuNut({ nut: nut("du-lieu.dat", { truong: { d: "{{ $json.s }}" } }), inputs: { main: [{ json: { s: dai } }] } });
    expect(r.ok).toBe(true);
    expect(r.output).toMatchObject({ __catBot: true });
  });

  it("node loại lạ ⇒ ok=false kèm lý do; id cổng sai khuôn bị zod từ chối", async () => {
    const r = await goi("engineer").chayThuNut({ nut: nut("khong.co") });
    expect(r.ok).toBe(false);
    await expect(goi("engineer").chayThuNut({ nut: nut("du-lieu.dat"), inputs: { "co khoang": [] } })).rejects.toBeTruthy();
  });
});

// ── IDOR hai chiều trên CSDL thật: phạm vi người gọi cho node tham chiếu MÁY ────────────────────────────────────────
const RUN = `f9_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const FAC_A = `F9A_${RUN}`.slice(0, 50);
const FAC_B = `F9B_${RUN}`.slice(0, 50);
const U_A = 961001;
const U_B = 961002;
const U_NONE = 961003;
const U_ADMIN = 961004;
const ids = { facA: 0, facB: 0, wsA: 0, wsB: 0, lineA: 0, lineB: 0, stA: 0, stB: 0, machA: 0, machB: 0 };
const GONE = 2_000_900_001;
const caller = (id: number, role: string) => flowRouter.createCaller({ user: { id, role } } as never);
const thuOt = (c: ReturnType<typeof caller>, loai: "ot.doc-tag" | "ot.de-xuat-lenh", may: number) =>
  c.chayThuNut({ nut: nut(loai, loai === "ot.doc-tag" ? { may, tag: "t1" } : { may, lenh: "pause" }), inputs: { main: [{ json: {} }] } });

describe("flow.chayThuNut — IDOR: máy phải TỒN TẠI và thuộc phạm vi người gọi (ctx, không input)", () => {
  let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
  beforeAll(async () => {
    db = (await getDb())!;
    const one = async (q: Promise<unknown>) => Number(((await q) as { id: number }[])[0].id);
    ids.facA = await one(db.execute(sql`INSERT INTO factories (code, name, "isActive") VALUES (${FAC_A}, ${"F9 " + FAC_A}, true) RETURNING id`));
    ids.facB = await one(db.execute(sql`INSERT INTO factories (code, name, "isActive") VALUES (${FAC_B}, ${"F9 " + FAC_B}, true) RETURNING id`));
    ids.wsA = await one(db.execute(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.facA}, ${FAC_A + "_WS"}, ${"wsA"}) RETURNING id`));
    ids.wsB = await one(db.execute(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.facB}, ${FAC_B + "_WS"}, ${"wsB"}) RETURNING id`));
    ids.lineA = await one(db.execute(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.wsA}, ${FAC_A + "_L1"}, ${"lineA"}) RETURNING id`));
    ids.lineB = await one(db.execute(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.wsB}, ${FAC_B + "_L1"}, ${"lineB"}) RETURNING id`));
    ids.stA = await one(db.execute(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.lineA}, ${FAC_A + "_S1"}, ${"stA"}) RETURNING id`));
    ids.stB = await one(db.execute(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.lineB}, ${FAC_B + "_S1"}, ${"stB"}) RETURNING id`));
    ids.machA = await one(db.execute(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${ids.stA}, ${FAC_A + "_M1"}, ${"machA"}, ${"AOI"}, true) RETURNING id`));
    ids.machB = await one(db.execute(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${ids.stB}, ${FAC_B + "_M1"}, ${"machB"}, ${"AOI"}, true) RETURNING id`));
    await db.execute(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${U_A}, ${FAC_A}), (${U_B}, ${FAC_B})`);
  }, 90_000);
  afterAll(async () => {
    await db.execute(sql`DELETE FROM user_factory_assignments WHERE "userId" IN (${U_A}, ${U_B}, ${U_NONE}, ${U_ADMIN})`);
    await db.execute(sql`DELETE FROM machines WHERE id IN (${ids.machA}, ${ids.machB})`);
    await db.execute(sql`DELETE FROM stations WHERE id IN (${ids.stA}, ${ids.stB})`);
    await db.execute(sql`DELETE FROM production_lines WHERE id IN (${ids.lineA}, ${ids.lineB})`);
    await db.execute(sql`DELETE FROM workshops WHERE id IN (${ids.wsA}, ${ids.wsB})`);
    await db.execute(sql`DELETE FROM factories WHERE id IN (${ids.facA}, ${ids.facB})`);
  });

  it("ot.doc-tag: A đọc máy của A; máy của B và máy không tồn tại ⇒ NOT_FOUND GIỐNG HỆT; chiều ngược lại cho B", async () => {
    const a = caller(U_A, "engineer");
    const b = caller(U_B, "engineer");
    expect(await thuOt(a, "ot.doc-tag", ids.machA)).toMatchObject({ che: "chay", ok: true });
    const bi = await thuOt(a, "ot.doc-tag", ids.machB).catch((e) => e);
    const mat = await thuOt(a, "ot.doc-tag", GONE).catch((e) => e);
    expect(bi).toMatchObject({ code: "NOT_FOUND" });
    expect(mat).toMatchObject({ code: "NOT_FOUND" });
    expect(bi.message).toBe(mat.message); // không lộ tồn tại
    expect(await thuOt(b, "ot.doc-tag", ids.machB)).toMatchObject({ ok: true });
    await expect(thuOt(b, "ot.doc-tag", ids.machA)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("tài khoản chưa gán nhà máy ⇒ NOT_FOUND với mọi máy (phạm vi rỗng, fail-closed)", async () => {
    const n = caller(U_NONE, "engineer");
    await expect(thuOt(n, "ot.doc-tag", ids.machA)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(thuOt(n, "ot.doc-tag", ids.machB)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("admin (toàn quyền) đọc được máy của cả hai nhà máy, nhưng máy KHÔNG TỒN TẠI vẫn NOT_FOUND", async () => {
    const ad = caller(U_ADMIN, "admin");
    expect(await thuOt(ad, "ot.doc-tag", ids.machA)).toMatchObject({ ok: true });
    expect(await thuOt(ad, "ot.doc-tag", ids.machB)).toMatchObject({ ok: true });
    await expect(thuOt(ad, "ot.doc-tag", GONE)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("ot.de-xuat-lenh: A đề xuất cho máy của A (MÔ PHỎNG, không ghi hàng chờ); máy của B ⇒ NOT_FOUND", async () => {
    const truoc = await demHang();
    const a = caller(U_A, "engineer");
    const ok = await thuOt(a, "ot.de-xuat-lenh", ids.machA);
    expect(ok).toMatchObject({ che: "chay", ok: true });
    expect(JSON.stringify(ok.cho)).toMatch(/MÔ PHỎNG|moPhong/);
    expect(JSON.stringify(ok)).not.toMatch(/"daGui":\s*true/);
    await expect(thuOt(a, "ot.de-xuat-lenh", ids.machB)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await demHang()).toEqual(truoc);
  });

  it("id lấy từ biểu thức theo item: một item trỏ máy của B ⇒ cả lần chạy thử bị từ chối", async () => {
    const a = caller(U_A, "engineer");
    await expect(
      a.chayThuNut({ nut: nut("ot.doc-tag", { may: "{{ $json.m }}", tag: "t1" }), inputs: { main: [{ json: { m: ids.machA } }, { json: { m: ids.machB } }] } }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
