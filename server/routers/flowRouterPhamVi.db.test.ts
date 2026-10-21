/**
 * ★★★ Đợt 9 (IDOR, duyệt (d)) — PHẠM VI NHÀ MÁY của CHÍNH LUỒNG ở router `flow.*`, hai chiều trên `_test` (hai nhà máy A/B + người dùng
 * thật): mọi thủ tục nhận flowId/runId/credentialId và mọi danh sách. Ngoài phạm vi và không tồn tại ⇒ CÙNG một NOT_FOUND/thông điệp.
 * Census đọc mã: `flowRouterPhamViCensus.test.ts`.
 */
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray, like, sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { aiFlowCredentials, aiFlowRuns, aiFlows } from "../../drizzle/schema";
import { chayMotMuc } from "../services/flow/dongCo";
import { taoBiMat } from "../services/flow/biMat";
import { flowRouter } from "./flowRouter";

const RUN = `rp_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const TT = `t9rp${Math.floor(Math.random() * 1e5)}`;
const FA = `RPA_${RUN}`.slice(0, 50);
const FB = `RPB_${RUN}`.slice(0, 50);
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}, them: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0] as [number, number], parameters, ...them });
const noi = (a: string, b: string, pa = "main") => ({ from: { node: a, port: pa }, to: { node: b, port: "main" } });
const duyetDef = (id: string) => ({ id, name: id, version: 1, nodes: [nut("t", "kich-hoat.thu-cong"), nut("d", "nguoi.duyet", { tieuDe: "duyệt" })], connections: [noi("t", "d")] });
const thuanDef = (id: string, them: unknown[] = [], noiThem: unknown[] = []) => ({ id, name: id, version: 1, nodes: [nut("t", "kich-hoat.thu-cong"), ...them], connections: noiThem });

const f: Record<string, number> = {};
const u: Record<string, number> = {};
let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
const giu = { k: process.env.AI_FLOW_KHOA_BI_MAT };
const goi = (id: number, role: string) => flowRouter.createCaller({ user: { id, role, twoFactorEnabled: true }, sessionToken: `phien-${id}` } as never);
const NF = { code: "NOT_FOUND" } as const;

async function mkUser(ten: string, role: string, ...nhaMay: string[]): Promise<number> {
  const [r] = (await db.execute(sql`INSERT INTO users ("openId", username, name, "loginMethod", role, "isActive", two_factor_enabled, "passwordChangedAt")
    VALUES (${`${RUN}-${ten}`}, ${`${RUN}_${ten}`}, ${ten}, ${"password"}, ${role}, true, false, now()) RETURNING id`)) as unknown as { id: number }[];
  for (const c of nhaMay) await db.execute(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${r.id}, ${c})`);
  return r.id;
}

let A: ReturnType<typeof goi>;
let B: ReturnType<typeof goi>;
let AB: ReturnType<typeof goi>;
let KHONG: ReturnType<typeof goi>;
let ADMIN: ReturnType<typeof goi>;
const luongA = `${TT}-a`;
const luongB = `${TT}-b`;
const luongNull = `${TT}-null`;
let runA = "";
let runB = "";
let runNull = "";

async function chayHet() {
  for (let i = 0; i < 200 && (await chayMotMuc("w-rp", undefined, TT)); i++);
}

beforeAll(async () => {
  db = (await getDb())!;
  process.env.AI_FLOW_KHOA_BI_MAT = randomBytes(32).toString("base64");
  for (const [k, c] of [["a", FA], ["b", FB]] as const) {
    const [r] = (await db.execute(sql`INSERT INTO factories (code, name, "isActive") VALUES (${c}, ${"RP " + c}, true) RETURNING id`)) as unknown as { id: number }[];
    f[k] = r.id;
  }
  u.A = await mkUser("a", "engineer", FA);
  u.B = await mkUser("b", "engineer", FB);
  u.AB = await mkUser("ab", "engineer", FA, FB);
  u.khong = await mkUser("khong", "engineer");
  u.admin = await mkUser("admin", "admin");
  u.asup = await mkUser("asup", "supervisor", FA); // H2: bước duyệt mặc định đòi supervisor; A (engineer) không còn duyệt được
  A = goi(u.A, "engineer");
  B = goi(u.B, "engineer");
  AB = goi(u.AB, "engineer");
  KHONG = goi(u.khong, "engineer");
  ADMIN = goi(u.admin, "admin");
  // ba luồng có chờ duyệt: của A, của B, TOÀN HỆ THỐNG (admin tạo, không nhà máy)
  await A.luu({ definition: duyetDef(luongA) });
  await B.luu({ definition: duyetDef(luongB) });
  await ADMIN.luu({ definition: duyetDef(luongNull) });
  runA = (await ADMIN.chayTay({ flowId: luongA })).runId;
  runB = (await ADMIN.chayTay({ flowId: luongB })).runId;
  runNull = (await ADMIN.chayTay({ flowId: luongNull })).runId;
  await chayHet();
}, 180_000);

afterAll(async () => {
  if (giu.k === undefined) delete process.env.AI_FLOW_KHOA_BI_MAT;
  else process.env.AI_FLOW_KHOA_BI_MAT = giu.k;
  const runs = await db.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await db.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await db.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
  await db.delete(aiFlowCredentials).where(like(aiFlowCredentials.id, `${TT}%`));
  const tat = Object.values(u).join(",");
  await db.execute(sql`DELETE FROM user_factory_assignments WHERE "userId" IN ${sql.raw(`(${tat})`)}`);
  await db.execute(sql`DELETE FROM users WHERE id IN ${sql.raw(`(${tat})`)}`);
  await db.execute(sql`DELETE FROM factories WHERE id IN (${f.a}, ${f.b})`);
});

describe("tạo luồng: nhà máy được gán theo người tạo", () => {
  it("đúng 1 nhà máy ⇒ gán; admin ⇒ NULL; chưa gán nhà máy ⇒ FORBIDDEN; nhiều nhà máy ⇒ bắt buộc chọn trong phạm vi", async () => {
    const nm = async (id: string) => ((await db.execute(sql`SELECT "factoryId" AS f FROM ai_flows WHERE id = ${id}`)) as unknown as { f: number | null }[])[0].f;
    expect(await nm(luongA)).toBe(f.a);
    expect(await nm(luongB)).toBe(f.b);
    expect(await nm(luongNull)).toBeNull();
    await expect(KHONG.luu({ definition: thuanDef(`${TT}-k1`) })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(AB.luu({ definition: thuanDef(`${TT}-ab0`) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await AB.luu({ definition: thuanDef(`${TT}-ab1`), factoryId: f.b });
    expect(await nm(`${TT}-ab1`)).toBe(f.b);
    await expect(A.luu({ definition: thuanDef(`${TT}-a2`), factoryId: f.b })).rejects.toMatchObject({ code: "FORBIDDEN" }); // nhà máy ngoài phạm vi
    await ADMIN.luu({ definition: thuanDef(`${TT}-ad1`), factoryId: f.a });
    expect(await nm(`${TT}-ad1`)).toBe(f.a);
  });

  it("★ luu vào id ĐÃ CÓ của nhà máy khác bị chặn (không thêm phiên bản); id của chính phạm vi ⇒ thêm phiên bản", async () => {
    const dem = async (id: string) => ((await db.execute(sql`SELECT count(*)::int AS n FROM ai_flow_versions WHERE "flowId" = ${id}`)) as unknown as { n: number }[])[0].n;
    const truoc = await dem(luongB);
    await expect(A.luu({ definition: duyetDef(luongB) })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(A.luu({ definition: duyetDef(luongNull) })).rejects.toMatchObject({ code: "CONFLICT" }); // NULL = toàn hệ thống
    expect(await dem(luongB)).toBe(truoc);
    const a0 = await dem(luongA);
    await A.luu({ definition: duyetDef(luongA) });
    expect(await dem(luongA)).toBe(a0 + 1);
    await ADMIN.luu({ definition: duyetDef(luongB) }); // admin: mọi phạm vi
    expect(await dem(luongB)).toBe(truoc + 1);
  });

  it("tham chiếu LÚC LƯU: credentialRef và luồng con ngoài phạm vi / không tồn tại ⇒ cùng một lỗi", async () => {
    await taoBiMat({ id: `${TT}-bm-a`, ten: "a", loai: "token", giaTri: "gia-tri-bi-mat", factoryId: f.a }, null);
    await taoBiMat({ id: `${TT}-bm-b`, ten: "b", loai: "token", giaTri: "gia-tri-bi-mat", factoryId: f.b }, null);
    const http = (ref: string, id: string) => thuanDef(id, [nut("h", "tich-hop.http-doc", { url: "https://dich.gia/x" }, { credentialRef: ref })], [noi("t", "h")]);
    await A.luu({ definition: http(`${TT}-bm-a`, `${TT}-h-ok`) });
    const b = await A.luu({ definition: http(`${TT}-bm-b`, `${TT}-h-b`) }).catch((e) => e);
    const mat = await A.luu({ definition: http(`${TT}-bm-khong-co`, `${TT}-h-mat`) }).catch((e) => e);
    expect(b).toMatchObject({ code: "BAD_REQUEST" });
    expect(b.message.replace(`${TT}-bm-b`, "X")).toBe(mat.message.replace(`${TT}-bm-khong-co`, "X"));
    // luồng con
    const dungCon = async (id: string, cli: typeof A) => {
      await cli.luu({ definition: thuanDef(id) });
      const [v] = (await db.execute(sql`SELECT max(version)::int AS v FROM ai_flow_versions WHERE "flowId" = ${id}`)) as unknown as { v: number }[];
      await ADMIN.datPhienBanHoatDong({ flowId: id, version: v.v, bat: true });
    };
    await dungCon(`${TT}-con-a`, A);
    await dungCon(`${TT}-con-b`, B);
    const cha = (con: string, id: string) => thuanDef(id, [nut("c", "luong.goi-con", { flowId: con })], [noi("t", "c")]);
    await A.luu({ definition: cha(`${TT}-con-a`, `${TT}-cha-ok`) });
    const cb = await A.luu({ definition: cha(`${TT}-con-b`, `${TT}-cha-b`) }).catch((e) => e);
    const cm = await A.luu({ definition: cha(`${TT}-con-khong-co`, `${TT}-cha-mat`) }).catch((e) => e);
    expect(cb).toMatchObject({ code: "BAD_REQUEST" });
    expect(cb.message.replace(`${TT}-con-b`, "X")).toBe(cm.message.replace(`${TT}-con-khong-co`, "X"));
  });
});

describe("đọc / điều khiển theo flowId: ngoài phạm vi ≡ không tồn tại", () => {
  const khongCo = `${TT}-khong-co`;

  it("danhSach lọc theo nhà máy (A thấy A; B thấy B; admin thấy cả NULL; chưa gán ⇒ rỗng)", async () => {
    const id = async (c: ReturnType<typeof goi>) => (await c.danhSach()).map((x) => x.id as string).filter((x) => x.startsWith(TT));
    const a = await id(A);
    expect(a).toContain(luongA);
    expect(a).not.toContain(luongB);
    expect(a).not.toContain(luongNull);
    const b = await id(B);
    expect(b).toContain(luongB);
    expect(b).not.toContain(luongA);
    expect(await id(KHONG)).toEqual([]);
    const ab = await id(AB);
    expect(ab).toEqual(expect.arrayContaining([luongA, luongB]));
    expect(ab).not.toContain(luongNull);
    const ad = await id(ADMIN);
    expect(ad).toEqual(expect.arrayContaining([luongA, luongB, luongNull]));
  });

  it("chiTiet · lichSuChay · chayTay · datPhienBanHoatDong: luồng của B / NULL / không tồn tại ⇒ NOT_FOUND CÙNG thông điệp (A); của A ⇒ được", async () => {
    await A.chiTiet({ flowId: luongA });
    await A.lichSuChay({ flowId: luongA });
    const cacLoi = async (fn: (flowId: string) => Promise<unknown>) => {
      const ra = [] as { code?: string; message: string }[];
      for (const fl of [luongB, luongNull, khongCo]) ra.push(await fn(fl).then(() => ({ message: "KHÔNG LỖI" }), (e) => e));
      for (const e of ra) expect(e).toMatchObject(NF);
      return ra.map((e, i) => e.message.replace([luongB, luongNull, khongCo][i], "X"));
    };
    for (const fn of [
      (fl: string) => A.chiTiet({ flowId: fl }),
      (fl: string) => A.lichSuChay({ flowId: fl }),
      (fl: string) => A.chayTay({ flowId: fl }),
      (fl: string) => A.datPhienBanHoatDong({ flowId: fl, version: 1, bat: true }),
    ]) {
      const m = await cacLoi(fn);
      expect(new Set(m).size, `thông điệp phải GIỐNG HỆT: ${m.join(" | ")}`).toBe(1);
    }
    // chiều ngược lại
    await B.chiTiet({ flowId: luongB });
    await expect(B.chiTiet({ flowId: luongA })).rejects.toMatchObject(NF);
    await expect(KHONG.chiTiet({ flowId: luongA })).rejects.toMatchObject(NF);
    // A không bật được luồng của B, và luồng B vẫn tắt
    expect(((await db.execute(sql`SELECT enabled FROM ai_flows WHERE id = ${luongB}`)) as unknown as { enabled: boolean }[])[0].enabled).toBe(false);
  });

  it("dongThoiGian · duyet: lượt của B / NULL / không tồn tại ⇒ NOT_FOUND cùng thông điệp; lượt của A ⇒ được; duyet lượt B không lách được", async () => {
    await A.dongThoiGian({ runId: runA });
    const rid = ["00000000-0000-4000-8000-000000000999"];
    const msg = async (fn: (r: string) => Promise<unknown>, ids: string[]) =>
      Promise.all(ids.map((i) => fn(i).then(() => "KHÔNG LỖI", (e: { code?: string; message: string }) => `${e.code}|${e.message.replace(i, "X")}`)));
    const dtg = await msg((r) => A.dongThoiGian({ runId: r }), [runB, runNull, ...rid]);
    expect(new Set(dtg).size).toBe(1);
    expect(dtg[0]).toMatch(/^NOT_FOUND\|/);
    const dy = await msg((r) => A.duyet({ runId: r, nodeId: "d", dongY: true }), [runB, runNull, ...rid]);
    expect(new Set(dy).size).toBe(1);
    expect(dy[0]).toMatch(/^NOT_FOUND\|/);
    // lượt B vẫn đang chờ (A không duyệt được)
    expect(((await db.execute(sql`SELECT count(*)::int AS n FROM ai_flow_waits WHERE "runId" = ${runB}`)) as unknown as { n: number }[])[0].n).toBe(1);
    await expect(B.dongThoiGian({ runId: runA })).rejects.toMatchObject(NF);
    await B.dongThoiGian({ runId: runB });
  });

  it("danhSachCho lọc theo nhà máy của luồng", async () => {
    const ch = async (c: ReturnType<typeof goi>) => (await c.danhSachCho()).filter((x) => x.flowId.startsWith(TT)).map((x) => x.runId);
    expect(await ch(A)).toEqual([runA]);
    expect(await ch(B)).toEqual([runB]);
    expect(await ch(KHONG)).toEqual([]);
    expect((await ch(ADMIN)).sort()).toEqual([runA, runB, runNull].sort());
  });

  it("★ duyet đúng phạm vi: A duyệt lượt của A ⇒ xong", async () => {
    await goi(u.asup, "supervisor").duyet({ runId: runA, nodeId: "d", dongY: true }); // supervisor CÙNG nhà máy A (không phải người bật/chủ lượt: admin)
    await chayHet();
    expect(((await db.execute(sql`SELECT status FROM ai_flow_runs WHERE id = ${runA}`)) as unknown as { status: string }[])[0].status).toBe("xong");
  });
});

describe("bí mật: danh sách lọc; tạo/xoá/ghi đè theo phạm vi", () => {
  it("biMatDanhSach: A thấy bí mật của A, KHÔNG thấy của B / toàn hệ thống; admin thấy hết", async () => {
    await taoBiMat({ id: `${TT}-bm-null`, ten: "n", loai: "token", giaTri: "gia-tri-bi-mat" }, null); // toàn hệ thống
    const id = async (c: ReturnType<typeof goi>) => (await c.biMatDanhSach()).map((b) => b.id).filter((x) => x.startsWith(TT));
    const a = await id(A);
    expect(a).toContain(`${TT}-bm-a`);
    expect(a).not.toContain(`${TT}-bm-b`);
    expect(a).not.toContain(`${TT}-bm-null`);
    expect(await id(KHONG)).toEqual([]);
    expect(await id(ADMIN)).toEqual(expect.arrayContaining([`${TT}-bm-a`, `${TT}-bm-b`, `${TT}-bm-null`]));
  });

  it("biMatTao / biMatXoa (admin): mặc định NULL; chọn nhà máy; nhà máy không tồn tại ⇒ lỗi; xoá bí mật không tồn tại ⇒ NOT_FOUND", async () => {
    const nm = async (id: string) => ((await db.execute(sql`SELECT "factoryId" AS f FROM ai_flow_credentials WHERE id = ${id}`)) as unknown as { f: number | null }[])[0].f;
    await ADMIN.biMatTao({ id: `${TT}-bm-t1`, ten: "t", loai: "token", giaTri: "gia-tri-bi-mat", hostChoPhep: ["dich.gia"] });
    expect(await nm(`${TT}-bm-t1`)).toBeNull();
    await ADMIN.biMatTao({ id: `${TT}-bm-t2`, ten: "t", loai: "token", giaTri: "gia-tri-bi-mat", hostChoPhep: ["dich.gia"], factoryId: f.b });
    expect(await nm(`${TT}-bm-t2`)).toBe(f.b);
    await expect(ADMIN.biMatTao({ id: `${TT}-bm-t3`, ten: "t", loai: "token", giaTri: "gia-tri-bi-mat", hostChoPhep: ["dich.gia"], factoryId: 2_000_900_001 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(ADMIN.biMatXoa({ id: `${TT}-bm-khong-co` })).rejects.toMatchObject(NF);
    expect(await ADMIN.biMatXoa({ id: `${TT}-bm-t2` })).toMatchObject({ daXoa: true });
  });
});
