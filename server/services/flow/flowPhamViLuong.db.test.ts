/**
 * ★★★ Đợt 9 (IDOR, duyệt (d)) — PHẠM VI NHÀ MÁY của chính luồng: bộ kiểm `phamViLuong.ts` + ĐỘNG CƠ (bí mật, luồng con) trên `_test`
 * với hai nhà máy A/B + người dùng thật. Router: `flowRouterPhamVi.db.test.ts`.
 */
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { aiFlowCredentials, aiFlowRuns, aiFlowSteps, aiFlows } from "../../../drizzle/schema";
import { batDauRun, chayMotMuc, luuPhienBan } from "./dongCo";
import { taoBiMat } from "./biMat";
import { biMatTrongPhamVi, luongTrongPhamVi, luotTrongPhamVi, nhaMayChoLuongMoi, nhaMayHopLe } from "./phamViLuong";
import { datFetchLuong } from "./nut/tichHop";

const RUN = `pl_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const TT = `t9pl${Math.floor(Math.random() * 1e5)}`;
const FA = `PLA_${RUN}`.slice(0, 50);
const FB = `PLB_${RUN}`.slice(0, 50);
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}, them: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0] as [number, number], parameters, ...them });
const noi = (a: string, b: string) => ({ from: { node: a, port: "main" }, to: { node: b, port: "main" } });
const f: Record<string, number> = {};
const u: Record<string, number> = {};
let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
const giu = { k: process.env.AI_FLOW_KHOA_BI_MAT, h: process.env.AI_FLOW_HTTP_HOST_CHO_PHEP };
let fetchCu: typeof fetch;
const goiMang: string[] = [];
const pv = (userId: number, userRole = "engineer") => ({ userId, userRole });

async function mkUser(ten: string, role: string, ...nhaMay: string[]): Promise<number> {
  const [r] = (await db.execute(sql`INSERT INTO users ("openId", username, name, "loginMethod", role, "isActive", two_factor_enabled, "passwordChangedAt")
    VALUES (${`${RUN}-${ten}`}, ${`${RUN}_${ten}`}, ${ten}, ${"password"}, ${role}, true, false, now()) RETURNING id`)) as unknown as { id: number }[];
  for (const c of nhaMay) await db.execute(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${r.id}, ${c})`);
  return r.id;
}

beforeAll(async () => {
  db = (await getDb())!;
  process.env.AI_FLOW_KHOA_BI_MAT = randomBytes(32).toString("base64");
  process.env.AI_FLOW_HTTP_HOST_CHO_PHEP = "dich.gia";
  fetchCu = datFetchLuong((async (url: URL) => {
    goiMang.push(String(url));
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch);
  for (const [k, c] of [["a", FA], ["b", FB]] as const) {
    const [r] = (await db.execute(sql`INSERT INTO factories (code, name, "isActive") VALUES (${c}, ${"PL " + c}, true) RETURNING id`)) as unknown as { id: number }[];
    f[k] = r.id;
  }
  u.A = await mkUser("a", "engineer", FA);
  u.B = await mkUser("b", "engineer", FB);
  u.AB = await mkUser("ab", "engineer", FA, FB);
  u.khong = await mkUser("khong", "engineer");
  u.admin = await mkUser("admin", "admin");
}, 120_000);

afterEach(() => void goiMang.splice(0));
afterAll(async () => {
  datFetchLuong(fetchCu);
  for (const [k, v] of [["AI_FLOW_KHOA_BI_MAT", giu.k], ["AI_FLOW_HTTP_HOST_CHO_PHEP", giu.h]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const runs = await db.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await db.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await db.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
  await db.delete(aiFlowCredentials).where(like(aiFlowCredentials.id, `${TT}%`));
  const tat = Object.values(u).join(",");
  await db.execute(sql`DELETE FROM user_factory_assignments WHERE "userId" IN ${sql.raw(`(${tat})`)}`);
  await db.execute(sql`DELETE FROM users WHERE id IN ${sql.raw(`(${tat})`)}`);
  await db.execute(sql`DELETE FROM factories WHERE id IN (${f.a}, ${f.b})`);
});

describe("bộ kiểm phạm vi luồng / lượt / bí mật (service)", () => {
  it("nhaMayHopLe: NULL chỉ hợp lệ với tập 'tất cả'", () => {
    expect(nhaMayHopLe(null, null)).toBe(true);
    expect(nhaMayHopLe(5, null)).toBe(true);
    expect(nhaMayHopLe(null, [5])).toBe(false);
    expect(nhaMayHopLe(undefined, [5])).toBe(false);
    expect(nhaMayHopLe(5, [5, 6])).toBe(true);
    expect(nhaMayHopLe(7, [5, 6])).toBe(false);
    expect(nhaMayHopLe(5, [])).toBe(false);
  });

  it("luồng / lượt / bí mật: A thấy của A, KHÔNG thấy của B hay NULL hay không tồn tại; admin thấy hết (trừ không tồn tại); chưa gán nhà máy ⇒ không thấy gì", async () => {
    for (const [ten, fac] of [["a", f.a], ["b", f.b], ["null", null]] as const) {
      await db.insert(aiFlows).values({ id: `${TT}-${ten}`, name: ten, factoryId: fac });
      await db.execute(sql`INSERT INTO ai_flow_versions ("flowId", version, definition, "riskClass") VALUES (${`${TT}-${ten}`}, 1, ${"{}"}::jsonb, ${"thuan"})`);
      await taoBiMat({ id: `${TT}-${ten}`, ten, loai: "token", giaTri: "gia-tri-bi-mat", factoryId: fac }, null);
      await db.execute(sql`INSERT INTO ai_flow_runs (id, "flowId", version, "triggerKind") VALUES (${randomUUID()}, ${`${TT}-${ten}`}, 1, ${"thu-cong"})`);
    }
    const run = async (ten: string) => ((await db.execute(sql`SELECT id FROM ai_flow_runs WHERE "flowId" = ${`${TT}-${ten}`}`)) as unknown as { id: string }[])[0].id;
    const nguoi = [
      ["A", pv(u.A), { a: true, b: false, null: false }],
      ["B", pv(u.B), { a: false, b: true, null: false }],
      ["AB", pv(u.AB), { a: true, b: true, null: false }],
      ["khong", pv(u.khong), { a: false, b: false, null: false }],
      ["admin", pv(u.admin, "admin"), { a: true, b: true, null: true }],
    ] as const;
    for (const [ten, p, mong] of nguoi) {
      for (const k of ["a", "b", "null"] as const) {
        expect(await luongTrongPhamVi(p, `${TT}-${k}`), `${ten} luồng ${k}`).toBe(mong[k]);
        expect(await biMatTrongPhamVi(p, `${TT}-${k}`), `${ten} bí mật ${k}`).toBe(mong[k]);
        expect(await luotTrongPhamVi(p, await run(k)), `${ten} lượt ${k}`).toBe(mong[k]);
      }
      expect(await luongTrongPhamVi(p, `${TT}-khong-co`), `${ten} không tồn tại`).toBe(false);
      expect(await biMatTrongPhamVi(p, `${TT}-khong-co`)).toBe(false);
      expect(await luotTrongPhamVi(p, randomUUID())).toBe(false);
    }
  });

  it("nhaMayChoLuongMoi: đúng 1 nhà máy ⇒ tự gán; nhiều ⇒ bắt buộc chọn trong phạm vi; chưa có ⇒ từ chối; chỉ admin NULL", async () => {
    expect(await nhaMayChoLuongMoi(pv(u.A), undefined)).toEqual({ ok: true, factoryId: f.a });
    expect(await nhaMayChoLuongMoi(pv(u.A), f.a)).toEqual({ ok: true, factoryId: f.a });
    expect(await nhaMayChoLuongMoi(pv(u.A), f.b)).toEqual({ ok: false, lyDo: "ngoai-pham-vi" });
    expect(await nhaMayChoLuongMoi(pv(u.AB), undefined)).toEqual({ ok: false, lyDo: "can-chon-nha-may" });
    expect(await nhaMayChoLuongMoi(pv(u.AB), f.b)).toEqual({ ok: true, factoryId: f.b });
    expect(await nhaMayChoLuongMoi(pv(u.khong), undefined)).toEqual({ ok: false, lyDo: "chua-co-nha-may" });
    expect(await nhaMayChoLuongMoi(pv(u.khong), f.a)).toEqual({ ok: false, lyDo: "chua-co-nha-may" });
    expect(await nhaMayChoLuongMoi(pv(u.admin, "admin"), undefined)).toEqual({ ok: true, factoryId: null });
    expect(await nhaMayChoLuongMoi(pv(u.admin, "admin"), f.b)).toEqual({ ok: true, factoryId: f.b });
    expect(await nhaMayChoLuongMoi(pv(u.admin, "admin"), 2_000_800_001)).toEqual({ ok: false, lyDo: "ngoai-pham-vi" });
  });
});

describe("động cơ: bí mật và luồng con theo phạm vi CHỦ LƯỢT", () => {
  const chayHet = async () => {
    for (let i = 0; i < 200 && (await chayMotMuc("w-pl", undefined, TT)); i++);
  };
  const buocLoi = async (runId: string, nodeId: string) => JSON.stringify((await db.select().from(aiFlowSteps).where(and(eq(aiFlowSteps.runId, runId), eq(aiFlowSteps.nodeId, nodeId))))[0]?.error ?? null);
  const tt = async (id: string) => ((await db.execute(sql`SELECT status FROM ai_flow_runs WHERE id = ${id}`)) as unknown as { status: string }[])[0].status;

  it("node HTTP dùng credentialRef: bí mật CỦA B / toàn hệ thống / không tồn tại ⇒ cùng lỗi 'không có bí mật', KHÔNG giải mã, KHÔNG gọi mạng; bí mật của A ⇒ chạy", async () => {
    for (const [ten, fac] of [["bm-a", f.a], ["bm-b", f.b], ["bm-null", null]] as const) await taoBiMat({ id: `${TT}-${ten}`, ten, loai: "token", giaTri: "gia-tri-bi-mat-12345", factoryId: fac }, null);
    const mk = async (ten: string, ref: string, chu: number) => {
      const def = { id: `${TT}-${ten}`, name: ten, version: 1, nodes: [nut("t", "kich-hoat.thu-cong"), nut("h", "tich-hop.http-doc", { url: "https://dich.gia/x", kieuXacThuc: "bearer" }, { credentialRef: ref })], connections: [noi("t", "h")] };
      const { version } = await luuPhienBan(def, null);
      return batDauRun({ flowId: def.id, version, chuLuong: chu, items: [{ json: {} }] });
    };
    const ok = await mk("h-ok", `${TT}-bm-a`, u.A);
    const b = await mk("h-b", `${TT}-bm-b`, u.A);
    const nul = await mk("h-null", `${TT}-bm-null`, u.A);
    const mat = await mk("h-mat", `${TT}-bm-khong-co`, u.A);
    const ad = await mk("h-ad", `${TT}-bm-null`, u.admin); // admin dùng được bí mật toàn hệ thống
    await chayHet();
    expect(await tt(ok)).toBe("xong");
    for (const r of [b, nul, mat]) expect(await tt(r)).toBe("loi");
    expect(await tt(ad)).toBe("xong");
    const loiB = await buocLoi(b, "h");
    expect(loiB).toContain("không có bí mật");
    expect(loiB.replace(`${TT}-bm-b`, "X")).toBe((await buocLoi(mat, "h")).replace(`${TT}-bm-khong-co`, "X")); // cùng câu với không tồn tại
    expect(goiMang).toHaveLength(2); // chỉ lượt của A (bí mật A) và của admin gọi mạng
  });

  it("luồng con: con CỦA B ⇒ cha lỗi 'không tồn tại hoặc chưa có phiên bản hoạt động' (không lộ); con của A ⇒ chạy; chủ = admin ⇒ chạy cả hai", async () => {
    const dung = async (ten: string, fac: number | null) => {
      const def = { id: `${TT}-${ten}`, name: ten, version: 1, nodes: [nut("t", "kich-hoat.thu-cong")], connections: [] };
      const { version } = await luuPhienBan(def, null);
      await db.update(aiFlows).set({ activeVersion: version, enabled: true, factoryId: fac }).where(eq(aiFlows.id, def.id));
    };
    await dung("con-a", f.a);
    await dung("con-b", f.b);
    await dung("con-mat", f.a);
    const cha = async (ten: string, con: string, chu: number) => {
      const def = { id: `${TT}-${ten}`, name: ten, version: 1, nodes: [nut("t", "kich-hoat.thu-cong"), nut("c", "luong.goi-con", { flowId: `${TT}-${con}` })], connections: [noi("t", "c")] };
      const { version } = await luuPhienBan(def, null);
      return batDauRun({ flowId: def.id, version, chuLuong: chu, items: [{ json: {} }] });
    };
    const ok = await cha("cha-ok", "con-a", u.A);
    const b = await cha("cha-b", "con-b", u.A);
    const mat = await cha("cha-mat", "con-mat", u.A);
    const ad = await cha("cha-ad", "con-b", u.admin);
    await db.delete(aiFlows).where(eq(aiFlows.id, `${TT}-con-mat`)); // con biến mất SAU khi cha đã lưu ⇒ "không tồn tại"
    await chayHet();
    expect(await tt(ok)).toBe("xong");
    expect(await tt(b)).toBe("loi");
    expect(await tt(mat)).toBe("loi");
    expect((await buocLoi(b, "c")).replace("con-b", "X")).toBe((await buocLoi(mat, "c")).replace("con-mat", "X"));
    expect(await tt(ad)).toBe("xong");
  });
});
