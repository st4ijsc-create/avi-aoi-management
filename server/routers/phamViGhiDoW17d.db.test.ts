/**
 * ★★★ Lô W17d — QUAY LUI MODEL (aiRobotAnomaly.manualRollback · evaluateRollback) là hành động đổi model TOÀN CỤC cho mọi nhà máy (kiểm định phamViGhi 2026-10-25).
 * Sàn: vai admin/engineer + 2FA + giấy phép MOD_AI (khuôn modelCardProcedure) + quyền module + CHỈ người TOÀN QUYỀN theo phạm vi (kỹ sư một nhà máy ⇒ NOT_FOUND).
 * Mỗi lớp có ca riêng: bỏ lớp nào ⇒ ca tương ứng đỏ.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

const RUN = `pw27${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];
const ctx = (u: { id: number; name: string }, role: string, hai = true) => ({ user: { id: u.id, role, name: u.name, openId: u.name, twoFactorEnabled: hai } }) as never;
let c: Record<string, ReturnType<typeof import("./aiRobotAnomalyRouter").aiRobotAnomalyRouter.createCaller>> = {};

async function maLoi(chay: () => Promise<unknown>): Promise<string> {
  try {
    await chay();
    return "OK";
  } catch (e) {
    return String((e as { code?: string }).code ?? "LOI");
  }
}
const MODEL = 2147483000;
const goi = {
  manual: (r: (typeof c)[string]) => r.manualRollback({ modelId: MODEL, toVersionId: MODEL + 1 }),
  danhGia: (r: (typeof c)[string]) => r.evaluateRollback({ modelId: MODEL }),
};

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  await dung(sql`INSERT INTO factories (code, name) VALUES (${RUN}, ${RUN})`);
  const sup = await taoNguoiDungTest("sup", "supervisor", { tienTo: "pw27", ts: RUN, ten: "PW27 sup" });
  const eng = await taoNguoiDungTest("eng", "engineer", { tienTo: "pw27", ts: RUN, ten: "PW27 eng" });
  const adm = await taoNguoiDungTest("adm", "admin", { tienTo: "pw27", ts: RUN, ten: "PW27 adm" });
  for (const u of [sup, eng]) {
    await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${RUN})`);
    await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${u.id}, 'machine_monitoring', 'machine_control', true, true, true, true)`);
  }
  const { aiRobotAnomalyRouter } = await import("./aiRobotAnomalyRouter");
  c = {
    sup: aiRobotAnomalyRouter.createCaller(ctx(sup, "supervisor")),
    eng: aiRobotAnomalyRouter.createCaller(ctx(eng, "engineer")),
    adm: aiRobotAnomalyRouter.createCaller(ctx(adm, "admin")),
    adm2faTat: aiRobotAnomalyRouter.createCaller(ctx(adm, "admin", false)),
  };
}, 120_000);

afterAll(async () => {
  if (!db) return;
  await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" = ${RUN}`).catch(() => undefined);
  await dung(sql`DELETE FROM factories WHERE code = ${RUN}`).catch(() => undefined);
});

describe("quay lui model toàn cục — từng lớp của sàn", () => {
  it("lớp VAI: giám sát viên (dù có quyền module + gán nhà máy) ⇒ FORBIDDEN, cả hai thủ tục", async () => {
    expect(await maLoi(() => goi.manual(c.sup))).toBe("FORBIDDEN");
    expect(await maLoi(() => goi.danhGia(c.sup))).toBe("FORBIDDEN");
  });
  it("lớp PHẠM VI: kỹ sư chỉ gán nhà máy A (có quyền module + 2FA) ⇒ NOT_FOUND, KHÔNG tới thân handler", async () => {
    expect(await maLoi(() => goi.manual(c.eng))).toBe("NOT_FOUND");
    expect(await maLoi(() => goi.danhGia(c.eng))).toBe("NOT_FOUND");
  });
  it("lớp 2FA: admin CHƯA bật 2FA ⇒ bị từ chối ở middleware", async () => {
    const m = await maLoi(() => goi.manual(c.adm2faTat));
    const d = await maLoi(() => goi.danhGia(c.adm2faTat));
    expect([m, d].every((x) => x === "FORBIDDEN" || x === "UNAUTHORIZED" || x === "PRECONDITION_FAILED")).toBe(true);
  });
  it("đối chứng: admin toàn quyền + 2FA ⇒ tới thân handler (phiên bản không tồn tại ⇒ BAD_REQUEST; cờ auto-rollback tắt ⇒ CONFLICT) — không đổi logic rollback", async () => {
    expect(await maLoi(() => goi.manual(c.adm))).toBe("BAD_REQUEST");
    expect(await maLoi(() => goi.danhGia(c.adm))).toBe("CONFLICT");
  });
});
