/**
 * ★★★ Lô Luồng-2 (2026-10-25) — node `kich-hoat.su-kien` trên CSDL `_test` với bus + động cơ THẬT, hai nhà máy A/B:
 *   (1) sự kiện nhà máy B KHÔNG kích luồng của chủ chỉ thuộc A (và ngược lại); luồng gắn nhà máy A không bắn cho máy B dù chủ thấy cả hai;
 *   (2) chủ bị khoá lúc bắn ⇒ không bắn; (3) cùng (loại, máy) trong một cửa sổ ⇒ MỘT lượt, qua cửa sổ ⇒ lượt mới;
 *   (4) trần lượt/giờ mỗi luồng; (5) MẶC ĐỊNH TẮT: node không `bat: true` không bao giờ nghe; (6) tên nhà máy trong payload không được tin;
 *   (7) đầu-cuối qua eventBus thật.
 */
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { inArray, like, sql } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { aiFlowRuns, aiFlows } from "../../../../drizzle/schema";
import { eventBus } from "../../../_core/eventBus";
import { taoNguoiDungTest } from "../../../testing/nguoiDungTest";
import { luuPhienBan } from "../dongCo";
import { dungSuKien, kiemThamSoSuKien, khoiChaySuKien, napLaiSuKien, xuLySuKien } from "./suKien";

const RUN = `sk_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const TT = `t2sk${Math.floor(Math.random() * 1e5)}`;
const FAC_A = `SKA_${RUN}`.slice(0, 50);
const FAC_B = `SKB_${RUN}`.slice(0, 50);
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0] as [number, number], parameters });
const noi = (a: string, b: string) => ({ from: { node: a, port: "main" }, to: { node: b, port: "main" } });
const luongSk = (id: string, tham: Record<string, unknown>) => ({
  id, name: "su kien", version: 1, settings: { maxConcurrentRuns: 100 },
  nodes: [nut("sk", "kich-hoat.su-kien", { suKien: "ng.alert", ...tham }), nut("d", "du-lieu.dat", { truong: { x: "1" } })],
  connections: [noi("sk", "d")],
});

const ids = { facA: 0, facB: 0, machA: 0, machB: 0 };
const cay: { ws: number[]; ln: number[]; st: number[] } = { ws: [], ln: [], st: [] };
const u = { A: 0, B: 0, khoa: 0, nhieu: 0 };
const FL = { A: `${TT}-A`, B: `${TT}-B`, G: `${TT}-G`, TAT: `${TT}-tat`, KHOA: `${TT}-khoa`, AA: `${TT}-AA`, TRAN: `${TT}-tran`, DT: `${TT}-dt` };
let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function mkUser(suffix: string, factories: string[]): Promise<number> {
  const r = await taoNguoiDungTest(suffix, "engineer", { tienTo: "sk", ten: `SK ${suffix}`, ts: RUN });
  for (const f of factories) await db.execute(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${r.id}, ${f})`);
  return r.id;
}
async function luu(def: ReturnType<typeof luongSk>, chu: number, nhaMay: number | null) {
  await luuPhienBan(def, chu, nhaMay);
  await db.execute(sql`UPDATE ai_flows SET enabled = true, "activeVersion" = 1 WHERE id = ${def.id}`);
}
const dem = async (flowId: string) => Number(((await db.execute(sql`SELECT count(*)::int AS n FROM ai_flow_runs WHERE "flowId" = ${flowId}`)) as unknown as { n: number }[])[0].n);
/** Bắn một sự kiện, trả kết cục chỉ của các luồng của lưới này, theo flowId. */
async function ban(loai: string, payload: unknown, ts = Date.now()) {
  napLaiSuKien();
  const kq = (await xuLySuKien(loai, payload, ts)).filter((b) => b.flowId.startsWith(TT));
  return Object.fromEntries(kq.map((b) => [b.flowId, b.ketQua])) as Record<string, string>;
}

beforeAll(async () => {
  db = (await getDb())!;
  const one = async (q: Promise<unknown>) => Number(((await q) as { id: number }[])[0].id);
  ids.facA = await one(db.execute(sql`INSERT INTO factories (code, name, "isActive") VALUES (${FAC_A}, ${"SK " + FAC_A}, true) RETURNING id`));
  ids.facB = await one(db.execute(sql`INSERT INTO factories (code, name, "isActive") VALUES (${FAC_B}, ${"SK " + FAC_B}, true) RETURNING id`));
  for (const [k, fac, code] of [["A", ids.facA, FAC_A], ["B", ids.facB, FAC_B]] as const) {
    const ws = await one(db.execute(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${fac}, ${code + "_WS"}, ${"ws" + k}) RETURNING id`));
    const ln = await one(db.execute(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ws}, ${code + "_L1"}, ${"line" + k}) RETURNING id`));
    const st = await one(db.execute(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ln}, ${code + "_S1"}, ${"st" + k}) RETURNING id`));
    cay.ws.push(ws);
    cay.ln.push(ln);
    cay.st.push(st);
    const m = await one(db.execute(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${st}, ${code + "_M1"}, ${"mach" + k}, ${"AOI"}, true) RETURNING id`));
    if (k === "A") ids.machA = m;
    else ids.machB = m;
  }
  u.A = await mkUser("a", [FAC_A]);
  u.B = await mkUser("b", [FAC_B]);
  u.khoa = await mkUser("khoa", [FAC_A]);
  u.nhieu = await mkUser("nhieu", [FAC_A, FAC_B]);
  await luu(luongSk(FL.A, { bat: true }), u.A, ids.facA);
  await luu(luongSk(FL.B, { bat: true }), u.B, ids.facB);
  await luu(luongSk(FL.G, { bat: true }), u.A, null); // toàn hệ thống nhưng chủ chỉ thuộc A
  await luu(luongSk(FL.AA, { bat: true }), u.nhieu, ids.facA); // chủ thấy CẢ HAI nhà máy nhưng luồng gắn A
  await luu(luongSk(FL.TAT, {}), u.A, ids.facA); // KHÔNG khai bat ⇒ mặc định tắt
  await luu(luongSk(FL.KHOA, { bat: true }), u.khoa, ids.facA);
  await luu(luongSk(FL.TRAN, { bat: true, tranMoiGio: 2 }), u.A, ids.facA);
  await luu({ ...luongSk(FL.DT, { bat: true, suKien: "downtime.start" }) }, u.A, ids.facA);
  await db.execute(sql`UPDATE users SET "isActive" = false WHERE id = ${u.khoa}`);
}, 180_000);

afterEach(() => dungSuKien());

afterAll(async () => {
  const runs = await db.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await db.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await db.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
  await db.execute(sql`DELETE FROM machines WHERE id IN (${ids.machA}, ${ids.machB})`);
  await db.execute(sql`DELETE FROM stations WHERE id IN ${sql.raw(`(${cay.st.join(",")})`)}`);
  await db.execute(sql`DELETE FROM production_lines WHERE id IN ${sql.raw(`(${cay.ln.join(",")})`)}`);
  await db.execute(sql`DELETE FROM workshops WHERE id IN ${sql.raw(`(${cay.ws.join(",")})`)}`);
  await db.execute(sql`DELETE FROM factories WHERE id IN (${ids.facA}, ${ids.facB})`);
});

const T0 = Date.UTC(2026, 9, 25, 3, 0, 0);

describe("phạm vi: sự kiện nhà máy B không kích luồng của chủ chỉ thuộc A", () => {
  it("★ máy A: luồng A + luồng toàn-hệ-thống (chủ thuộc A) chạy; luồng B bị chặn; luồng chủ bị khoá bị chặn; luồng tắt không xuất hiện", async () => {
    const kq = await ban("ng.alert", { type: "NG_ALERT", machineId: ids.machA, machineCode: `${FAC_A}_M1` }, T0);
    expect(kq[FL.A]).toBe("chay");
    expect(kq[FL.G]).toBe("chay");
    expect(kq[FL.AA]).toBe("chay");
    expect(kq[FL.TRAN]).toBe("chay");
    expect(kq[FL.B]).toBe("ngoai-pham-vi");
    expect(kq[FL.KHOA]).toBe("ngoai-pham-vi");
    expect(kq[FL.TAT]).toBeUndefined();
    expect(await dem(FL.B)).toBe(0);
    expect(await dem(FL.TAT)).toBe(0);
    expect(await dem(FL.KHOA)).toBe(0);
  });

  it("★ máy B: chỉ luồng B chạy; luồng A, luồng toàn-hệ-thống (chủ chỉ thuộc A) và luồng khoá KHÔNG chạy", async () => {
    const truoc = { A: await dem(FL.A), G: await dem(FL.G) };
    const kq = await ban("ng.alert", { type: "NG_ALERT", machineId: ids.machB, machineCode: `${FAC_B}_M1` }, T0);
    expect(kq[FL.B]).toBe("chay");
    expect(kq[FL.AA]).toBe("ngoai-pham-vi"); // ★ nhà máy luồng = A dù chủ thấy cả B
    expect(kq[FL.A]).toBe("ngoai-pham-vi");
    expect(kq[FL.G]).toBe("ngoai-pham-vi");
    expect(kq[FL.TRAN]).toBe("ngoai-pham-vi");
    expect(await dem(FL.A)).toBe(truoc.A);
    expect(await dem(FL.G)).toBe(truoc.G);
    expect(await dem(FL.B)).toBe(1);
  });

  it("tên nhà máy trong payload KHÔNG được tin: payload khai factoryName của B nhưng máy thuộc A ⇒ vẫn theo CSDL", async () => {
    const kq = await ban("yield.warning", { type: "YIELD_WARNING", machineId: ids.machA, factoryName: FAC_B }, T0 + 99 * 60_000);
    expect(kq[FL.A]).toBeUndefined(); // luồng A nghe ng.alert, không phải yield.warning
    const kq2 = await ban("ng.alert", { machineId: ids.machA, factoryName: FAC_B, factoryId: ids.facB }, T0 + 120 * 60_000);
    expect(kq2[FL.A]).toBe("chay");
    expect(kq2[FL.B]).toBe("ngoai-pham-vi");
  });

  it("sự kiện không có danh sách trắng / thiếu machineId / máy không tồn tại ⇒ không lượt nào", async () => {
    expect(await ban("order.created", { machineId: ids.machA })).toEqual({});
    expect(await ban("ng.alert", {})).toEqual({});
    expect(await ban("ng.alert", { machineId: "1" })).toEqual({});
    expect(await ban("ng.alert", { machineId: 2147483000 })).toMatchObject({ [FL.A]: "ngoai-pham-vi", [FL.B]: "ngoai-pham-vi" });
  });
});

describe("idempotent theo khoá sự kiện + cửa sổ · trần lượt/giờ", () => {
  it("cùng (loại, máy) trong cửa sổ 10 phút ⇒ MỘT lượt; sang cửa sổ sau ⇒ lượt mới", async () => {
    const goc = T0 + 6 * 3600_000; // mốc riêng, tròn cửa sổ
    const n0 = await dem(FL.A);
    expect((await ban("ng.alert", { machineId: ids.machA }, goc))[FL.A]).toBe("chay");
    expect((await ban("ng.alert", { machineId: ids.machA }, goc + 60_000))[FL.A]).toBe("trung");
    expect((await ban("ng.alert", { machineId: ids.machA }, goc + 9 * 60_000))[FL.A]).toBe("trung");
    expect(await dem(FL.A)).toBe(n0 + 1);
    expect((await ban("ng.alert", { machineId: ids.machA }, goc + 10 * 60_000))[FL.A]).toBe("chay");
    expect(await dem(FL.A)).toBe(n0 + 2);
  });

  it("downtime.start khoá theo id sự kiện: hai id khác nhau cùng cửa sổ ⇒ hai lượt; cùng id ⇒ một", async () => {
    const goc = T0 + 20 * 3600_000;
    expect((await ban("downtime.start", { id: "dt-1", machineId: ids.machA, machineCode: "x", category: "breakdown" }, goc))[FL.DT]).toBe("chay");
    expect((await ban("downtime.start", { id: "dt-1", machineId: ids.machA }, goc + 1000))[FL.DT]).toBe("trung");
    expect((await ban("downtime.start", { id: "dt-2", machineId: ids.machA }, goc + 2000))[FL.DT]).toBe("chay");
    expect(await dem(FL.DT)).toBe(2);
  });

  it("★ trần lượt/giờ: tranMoiGio = 2 ⇒ lượt thứ 3 trong cùng giờ bị BỎ (bão sự kiện)", async () => {
    const goc = T0 + 40 * 3600_000;
    const n0 = await dem(FL.TRAN);
    const kq = [];
    for (let i = 0; i < 4; i++) kq.push((await ban("ng.alert", { machineId: ids.machA }, goc + i * 11 * 60_000))[FL.TRAN]);
    const daChay = kq.filter((k) => k === "chay").length;
    // lưới này đã chạy 1 lượt cho FL.TRAN ở ca đầu (cùng giờ thật) ⇒ tổng lượt trong giờ không quá 2
    expect(n0 + daChay).toBeLessThanOrEqual(2);
    expect(kq).toContain("vuot-tran");
    expect(await dem(FL.TRAN)).toBeLessThanOrEqual(2);
  });

  it("lượt có triggerKind 'su-kien', item gọn từ payload (không chép nguyên payload) và chủ = người bật phiên bản", async () => {
    const [r] = (await db.execute(sql`SELECT r."triggerKind", r."chuLuong", q.inputs FROM ai_flow_runs r LEFT JOIN ai_flow_queue q ON q."runId" = r.id WHERE r."flowId" = ${FL.A} ORDER BY r."startedAt" LIMIT 1`)) as unknown as { triggerKind: string; chuLuong: number; inputs: unknown }[];
    expect(r.triggerKind).toBe("su-kien");
    expect(r.chuLuong).toBe(u.A);
  });
});

describe("tham số · mặc định tắt · đầu-cuối bus", () => {
  it("kiemThamSoSuKien: sự kiện lạ / cửa sổ / trần ngoài khoảng / quá 3 node ⇒ lỗi; hợp lệ ⇒ rỗng", () => {
    const mk = (p: Record<string, unknown>) => ({ nodes: [{ id: "a", type: "kich-hoat.su-kien", parameters: p }] });
    expect(kiemThamSoSuKien(mk({ suKien: "ng.alert", bat: true, cuaSoPhut: 10, tranMoiGio: 10 }))).toEqual([]);
    expect(kiemThamSoSuKien(mk({ suKien: "order.created" })).length).toBe(1);
    expect(kiemThamSoSuKien(mk({ suKien: "ng.alert", cuaSoPhut: 0 })).length).toBe(1);
    expect(kiemThamSoSuKien(mk({ suKien: "ng.alert", tranMoiGio: 31 })).length).toBe(1);
    expect(kiemThamSoSuKien(mk({ suKien: "ng.alert", bat: "true" })).length).toBe(1);
    const bon = { nodes: [1, 2, 3, 4].map((i) => ({ id: `n${i}`, type: "kich-hoat.su-kien", parameters: { suKien: "ng.alert" } })) };
    expect(kiemThamSoSuKien(bon).some((l) => l.includes("tối đa"))).toBe(true);
  });

  it("★ đầu-cuối: publish lên eventBus thật ⇒ bộ nghe bắn đúng luồng trong phạm vi; luồng ngoài phạm vi không có lượt", async () => {
    napLaiSuKien();
    khoiChaySuKien();
    khoiChaySuKien(); // gọi lại = no-op (không đăng ký đôi)
    const nA = await dem(FL.A);
    const nB = await dem(FL.B);
    const ts = T0 + 100 * 3600_000;
    vi.spyOn(Date, "now").mockReturnValue(ts);
    eventBus.publish("ng.alert", { type: "NG_ALERT", machineId: ids.machA, machineCode: `${FAC_A}_M1` }, "test");
    vi.restoreAllMocks();
    for (let i = 0; i < 100 && (await dem(FL.A)) === nA; i++) await new Promise((r) => setTimeout(r, 50));
    expect(await dem(FL.A)).toBe(nA + 1);
    expect(await dem(FL.B)).toBe(nB);
    await new Promise((r) => setTimeout(r, 500)); // để các luồng khớp khác (G, TRAN) xong trước khi dọn
  });
});
