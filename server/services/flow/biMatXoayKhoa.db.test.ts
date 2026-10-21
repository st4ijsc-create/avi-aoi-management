/**
 * ★★ Đợt 9.4 — XOAY KHOÁ BÍ MẬT trên CSDL `_test`: mã lại bí mật cũ sang khoá mới, nguyên tử, chạy khô được, chạy lại vô hại,
 * và BẤT BIẾN KHÔNG RÒ (giá trị · bản mã · khoá không xuất hiện trong kết quả, lỗi, console, stdout/stderr).
 * Phạm vi bằng tiền tố id (`tienTo`) để không đụng bí mật của các tệp test khác chạy song song.
 */
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { like, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { aiFlowCredentials } from "../../../drizzle/schema";
import { bienTheBiMat, giaiMaChoChay, taoBiMat, xoayKhoaBiMat } from "./biMat";

const TT = "t9xk";
const k1 = randomBytes(32).toString("base64");
const k2 = randomBytes(32).toString("base64");
const k3 = randomBytes(32).toString("base64");
const GIA_TRI = {
  [`${TT}-a`]: { loai: "token", v: `tok-${randomBytes(16).toString("hex")}` },
  [`${TT}-b`]: { loai: "tai-khoan", v: `nguoi:${randomBytes(10).toString("base64url")}` },
  [`${TT}-c`]: { loai: "token", v: `key-${randomBytes(14).toString("hex")}` },
} as const;
const IDS = Object.keys(GIA_TRI);
const env1 = { AI_FLOW_KHOA_BI_MAT: k1 } as NodeJS.ProcessEnv;
const env2 = { AI_FLOW_KHOA_BI_MAT: k2, AI_FLOW_KHOA_BI_MAT_PHIEN_BAN: "2", AI_FLOW_KHOA_BI_MAT_CU: k1 } as NodeJS.ProcessEnv;
const env2ChiMoi = { AI_FLOW_KHOA_BI_MAT: k2, AI_FLOW_KHOA_BI_MAT_PHIEN_BAN: "2" } as NodeJS.ProcessEnv;

const batDuoc: string[] = [];
const spies: { mockRestore(): void }[] = [];

async function gieo() {
  const db = (await getDb())!;
  await db.delete(aiFlowCredentials).where(like(aiFlowCredentials.id, `${TT}%`));
  for (const [id, { loai, v }] of Object.entries(GIA_TRI)) await taoBiMat({ id, ten: `bí mật ${id}`, loai, giaTri: v }, null, env1);
}
async function phienBan(): Promise<Record<string, number>> {
  const db = (await getDb())!;
  const r = await db.select({ id: aiFlowCredentials.id, p: aiFlowCredentials.phienBanKhoa }).from(aiFlowCredentials).where(like(aiFlowCredentials.id, `${TT}%`));
  return Object.fromEntries(r.map((x) => [x.id, x.p]));
}

beforeAll(() => {
  const bat = (...a: unknown[]) => void batDuoc.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  for (const m of ["log", "info", "warn", "error", "debug"] as const) spies.push(vi.spyOn(console, m).mockImplementation(bat));
  for (const s of [process.stdout, process.stderr]) {
    const goc = s.write.bind(s);
    spies.push(vi.spyOn(s, "write").mockImplementation(((c: unknown, ...r: unknown[]) => {
      batDuoc.push(String(c));
      return (goc as (...x: unknown[]) => boolean)(c, ...r);
    }) as never));
  }
});
afterAll(async () => {
  for (const s of spies) s.mockRestore();
  const db = await getDb();
  if (db) await db.delete(aiFlowCredentials).where(like(aiFlowCredentials.id, `${TT}%`));
});
beforeEach(async () => {
  batDuoc.length = 0;
  await gieo();
});
afterEach(() => void 0);

describe("xoayKhoaBiMat (Đợt 9.4)", () => {
  it("chạy KHÔ: đếm đúng, không đổi hàng nào", async () => {
    const truoc = (await (await getDb())!.select().from(aiFlowCredentials).where(like(aiFlowCredentials.id, `${TT}%`))).map((h) => Buffer.from(h.banMa).toString("hex"));
    const r = await xoayKhoaBiMat(env2, { tienTo: TT, kho: true });
    expect(r).toMatchObject({ kho: true, tong: 3, canChuyen: 3, daChuyen: 0, phienBanDen: 2 });
    expect(await phienBan()).toEqual({ [`${TT}-a`]: 1, [`${TT}-b`]: 1, [`${TT}-c`]: 1 });
    const sau = (await (await getDb())!.select().from(aiFlowCredentials).where(like(aiFlowCredentials.id, `${TT}%`))).map((h) => Buffer.from(h.banMa).toString("hex"));
    expect(sau).toEqual(truoc);
  });

  it("xoay thật: mọi hàng sang phiên bản 2, giải ĐƯỢC chỉ bằng khoá mới, giá trị nguyên vẹn, khoá cũ không còn cần", async () => {
    const truoc = new Map((await (await getDb())!.select().from(aiFlowCredentials).where(like(aiFlowCredentials.id, `${TT}%`))).map((h) => [h.id, Buffer.from(h.banMa).toString("hex")]));
    const r = await xoayKhoaBiMat(env2, { tienTo: TT });
    expect(r).toMatchObject({ kho: false, tong: 3, canChuyen: 3, daChuyen: 3, phienBanDen: 2 });
    expect(await phienBan()).toEqual({ [`${TT}-a`]: 2, [`${TT}-b`]: 2, [`${TT}-c`]: 2 });
    for (const [id, { v, loai }] of Object.entries(GIA_TRI)) {
      // env2ChiMoi KHÔNG có khoá cũ ⇒ chứng minh hàng đã thật sự ở khoá mới
      await expect(giaiMaChoChay(id, env2ChiMoi)).resolves.toEqual({ giaTri: v, loai, hostChoPhep: [] });
    }
    const sau = await (await getDb())!.select().from(aiFlowCredentials).where(like(aiFlowCredentials.id, `${TT}%`));
    for (const h of sau) expect(Buffer.from(h.banMa).toString("hex")).not.toBe(truoc.get(h.id)); // bản mã mới, IV mới
    // khoá cũ một mình không giải được nữa
    await expect(giaiMaChoChay(`${TT}-a`, env1)).rejects.toMatchObject({ code: expect.stringMatching(/THIEU_KHOA|GIAI_MA_HONG/) });
  });

  it("chạy lại sau khi xong ⇒ daChuyen 0 (vô hại, idempotent)", async () => {
    await xoayKhoaBiMat(env2, { tienTo: TT });
    const r = await xoayKhoaBiMat(env2ChiMoi, { tienTo: TT }); // lần hai không cần khoá cũ nữa
    expect(r).toMatchObject({ tong: 3, canChuyen: 0, daChuyen: 0 });
  });

  it("NGUYÊN TỬ: một hàng hỏng ⇒ cả lô lùi lại, không hàng nào đổi, lỗi nêu id nhưng không nêu giá trị", async () => {
    const db = (await getDb())!;
    await db.execute(sql`UPDATE ai_flow_credentials SET tag = decode('00000000000000000000000000000000','hex') WHERE id = ${`${TT}-b`}`);
    const e = await xoayKhoaBiMat(env2, { tienTo: TT }).catch((x) => x);
    expect(e).toMatchObject({ name: "LoiBiMat", code: "GIAI_MA_HONG" });
    expect(String(e.message)).toContain(`${TT}-b`);
    expect(await phienBan()).toEqual({ [`${TT}-a`]: 1, [`${TT}-b`]: 1, [`${TT}-c`]: 1 });
  });

  it("thiếu khoá cũ khi còn hàng phiên bản cũ ⇒ THIEU_KHOA, không đổi gì", async () => {
    const e = await xoayKhoaBiMat(env2ChiMoi, { tienTo: TT }).catch((x) => x);
    expect(e).toMatchObject({ code: "THIEU_KHOA" });
    expect(await phienBan()).toEqual({ [`${TT}-a`]: 1, [`${TT}-b`]: 1, [`${TT}-c`]: 1 });
  });

  it("nhảy cóc hai phiên bản (hàng v1, hiện hành v3) ⇒ từ chối ngay từ tiền kiểm, liệt kê id + phiên bản, không đổi gì", async () => {
    const env3 = { AI_FLOW_KHOA_BI_MAT: k3, AI_FLOW_KHOA_BI_MAT_PHIEN_BAN: "3", AI_FLOW_KHOA_BI_MAT_CU: k2 } as NodeJS.ProcessEnv;
    const e = await xoayKhoaBiMat(env3, { tienTo: TT }).catch((x) => x);
    expect(e).toMatchObject({ code: "THIEU_KHOA" });
    expect(String(e.message)).toMatch(new RegExp(`${TT}-a.*1`));
    expect(await phienBan()).toEqual({ [`${TT}-a`]: 1, [`${TT}-b`]: 1, [`${TT}-c`]: 1 });
  });

  it("xoay hai bậc liên tiếp (v1 → v2 → v3) giữ nguyên giá trị", async () => {
    await xoayKhoaBiMat(env2, { tienTo: TT });
    const env3 = { AI_FLOW_KHOA_BI_MAT: k3, AI_FLOW_KHOA_BI_MAT_PHIEN_BAN: "3", AI_FLOW_KHOA_BI_MAT_CU: k2 } as NodeJS.ProcessEnv;
    const r = await xoayKhoaBiMat(env3, { tienTo: TT });
    expect(r).toMatchObject({ daChuyen: 3, phienBanDen: 3 });
    const chiMoi = { AI_FLOW_KHOA_BI_MAT: k3, AI_FLOW_KHOA_BI_MAT_PHIEN_BAN: "3" } as NodeJS.ProcessEnv;
    for (const [id, { v }] of Object.entries(GIA_TRI)) expect((await giaiMaChoChay(id, chiMoi)).giaTri).toBe(v);
  });

  it("★ KHÔNG RÒ: giá trị / mọi biến thể / khoá (base64) không xuất hiện trong kết quả, lỗi, console, stdout, stderr", async () => {
    const dau: string[] = [];
    dau.push(JSON.stringify(await xoayKhoaBiMat(env2, { tienTo: TT, kho: true })));
    dau.push(JSON.stringify(await xoayKhoaBiMat(env2, { tienTo: TT })));
    // đường lỗi
    const db = (await getDb())!;
    await db.execute(sql`UPDATE ai_flow_credentials SET "banMa" = decode('00112233','hex') WHERE id = ${`${TT}-c`}`);
    const e1 = await xoayKhoaBiMat(env2ChiMoi, { tienTo: TT }).catch((x) => x);
    dau.push(String(e1?.message), String(e1?.stack ?? ""));
    const e2 = await xoayKhoaBiMat({ AI_FLOW_KHOA_BI_MAT: k2 } as NodeJS.ProcessEnv, { tienTo: TT }).catch((x) => x);
    dau.push(String(e2?.message), String(e2?.stack ?? ""));
    const bien = [
      ...Object.values(GIA_TRI).flatMap((g) => bienTheBiMat(g.v, g.loai)),
      k1, k2, k3, Buffer.from(k1, "base64").toString("hex"), Buffer.from(k2, "base64").toString("hex"),
    ];
    const kho = [...dau, ...batDuoc].join("\n");
    for (const b of bien) expect(kho.includes(b), `rò: ${b.slice(0, 6)}…`).toBe(false);
    // đối chứng dương: bộ dò phải THẤY một giá trị nếu nó có mặt (không phải chân lý rỗng)
    expect(bien.some((b) => `${kho}
${GIA_TRI[`${TT}-a`].v}`.includes(b))).toBe(true);
    expect(kho.length).toBeGreaterThan(0);
  });
});
