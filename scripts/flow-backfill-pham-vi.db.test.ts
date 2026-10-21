/**
 * Đợt 9 — backfill phạm vi nhà máy (mig 0411) trên `_test`: người tạo thuộc ĐÚNG MỘT nhà máy ⇒ gán; admin / nhiều nhà máy / không người
 * tạo ⇒ NULL; chạy khô không ghi; áp dụng chỉ đụng hàng NULL; báo cáo đếm đúng; chạy lại vô hại.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db/connection";
import { backfillPhamVi, chayCli } from "./flow-backfill-pham-vi";

const RUN = `bf${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const FA = `BFA_${RUN}`.slice(0, 50);
const FB = `BFB_${RUN}`.slice(0, 50);
let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
const u: Record<string, number> = {};
const f: Record<string, number> = {};

async function mkUser(ten: string, role: string): Promise<number> {
  const [r] = (await db.execute(sql`INSERT INTO users ("openId", username, name, "loginMethod", role, "isActive", two_factor_enabled, "passwordChangedAt")
    VALUES (${`${RUN}-${ten}`}, ${`${RUN}_${ten}`}, ${ten}, ${"password"}, ${role}, true, false, now()) RETURNING id`)) as unknown as { id: number }[];
  return r.id;
}
const nhaMay = async (bang: string, id: string) => ((await db.execute(sql`SELECT "factoryId" AS f FROM ${sql.raw(`public.${bang}`)} WHERE id = ${id}`)) as unknown as { f: number | null }[])[0].f;

beforeAll(async () => {
  db = (await getDb())!;
  for (const [k, code] of [["a", FA], ["b", FB]] as const) {
    const [r] = (await db.execute(sql`INSERT INTO factories (code, name, "isActive") VALUES (${code}, ${"BF " + code}, true) RETURNING id`)) as unknown as { id: number }[];
    f[k] = r.id;
  }
  u.mot = await mkUser("mot", "engineer");
  u.nhieu = await mkUser("nhieu", "engineer");
  u.admin = await mkUser("admin", "admin");
  await db.execute(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.mot}, ${FA}), (${u.nhieu}, ${FA}), (${u.nhieu}, ${FB})`);
  const luong = async (id: string, owner: number | null) => db.execute(sql`INSERT INTO ai_flows (id, name, "ownerId") VALUES (${id}, ${id}, ${owner})`);
  await luong(`${RUN}-l-mot`, u.mot);
  await luong(`${RUN}-l-nhieu`, u.nhieu);
  await luong(`${RUN}-l-admin`, u.admin);
  await luong(`${RUN}-l-khong`, null);
  await db.execute(sql`INSERT INTO ai_flows (id, name, "ownerId", "factoryId") VALUES (${`${RUN}-l-da`}, ${"da"}, ${u.mot}, ${f.b})`); // đã có nhà máy ⇒ không đụng
  const bm = (id: string, nguoi: number | null) => db.execute(sql`INSERT INTO ai_flow_credentials (id, ten, loai, "banMa", "iv", "tag", "phienBanKhoa", "createdBy") VALUES (${id}, ${id}, ${"token"}, ${Buffer.alloc(8, 1)}, ${Buffer.alloc(12, 2)}, ${Buffer.alloc(16, 3)}, 1, ${nguoi})`);
  await bm(`${RUN}-b-mot`, u.mot);
  await bm(`${RUN}-b-admin`, u.admin);
});

afterAll(async () => {
  await db.execute(sql`DELETE FROM ai_flows WHERE id LIKE ${RUN + "%"}`);
  await db.execute(sql`DELETE FROM ai_flow_credentials WHERE id LIKE ${RUN + "%"}`);
  await db.execute(sql`DELETE FROM user_factory_assignments WHERE "userId" IN (${u.mot}, ${u.nhieu}, ${u.admin})`);
  await db.execute(sql`DELETE FROM users WHERE id IN (${u.mot}, ${u.nhieu}, ${u.admin})`);
  await db.execute(sql`DELETE FROM factories WHERE id IN (${f.a}, ${f.b})`);
});

describe("backfill phạm vi nhà máy (Đợt 9)", () => {
  it("chạy KHÔ: báo cáo đúng, KHÔNG ghi", async () => {
    const kq = await backfillPhamVi(false, RUN);
    expect(kq.luong).toEqual({ tong: 4, gan: 1, nullAdminHoacKhongNhaMay: 1, nullNhieuNhaMay: 1, nullKhongNguoiTao: 1 });
    expect(kq.biMat).toEqual({ tong: 2, gan: 1, nullAdminHoacKhongNhaMay: 1, nullNhieuNhaMay: 0, nullKhongNguoiTao: 0 });
    expect(await nhaMay("ai_flows", `${RUN}-l-mot`)).toBeNull();
  });

  it("áp dụng: đúng một nhà máy ⇒ gán; admin / nhiều / không rõ ⇒ NULL; hàng đã có nhà máy giữ nguyên; chạy lại vô hại", async () => {
    await backfillPhamVi(true, RUN);
    expect(await nhaMay("ai_flows", `${RUN}-l-mot`)).toBe(f.a);
    expect(await nhaMay("ai_flows", `${RUN}-l-nhieu`)).toBeNull();
    expect(await nhaMay("ai_flows", `${RUN}-l-admin`)).toBeNull();
    expect(await nhaMay("ai_flows", `${RUN}-l-khong`)).toBeNull();
    expect(await nhaMay("ai_flows", `${RUN}-l-da`)).toBe(f.b);
    expect(await nhaMay("ai_flow_credentials", `${RUN}-b-mot`)).toBe(f.a);
    expect(await nhaMay("ai_flow_credentials", `${RUN}-b-admin`)).toBeNull();
    const lai = await backfillPhamVi(true, RUN);
    expect(lai.luong.gan).toBe(0);
    expect(lai.luong.tong).toBe(3);
  });

  it("CLI in báo cáo (số NULL = chỉ admin còn thấy)", async () => {
    const ra: string[] = [];
    expect(await chayCli([`--tien-to=${RUN}`], (s) => ra.push(s))).toBe(0);
    expect(ra.join("\n")).toMatch(/CHẠY KHÔ/);
    expect(ra.join("\n")).toMatch(/Luồng: 3 hàng chưa có nhà máy · gán nhà máy 0 · NULL \(chỉ admin thấy\): 3/);
  });
});
