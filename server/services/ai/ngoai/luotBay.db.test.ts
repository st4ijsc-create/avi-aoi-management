/**
 * ★ Đợt 10.4b L0a' (rà kiem-dinh 553497193 mục 1) — `luotBay.ts` trên SQL THẬT (CSDL `_test`): hai lượt giữ đồng thời ⇒ đúng MỘT thắng;
 * hàng HẾT HẠN ⇒ lượt mới chiếm + token đổi; thả SAI token không xoá; thả đúng token xoá; TTL tính bằng now() phía SQL.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { taoNguoiDungTest } from "../../../testing/nguoiDungTest";
import { giuLuotBay, thaLuotBay, type DbBay } from "./luotBay";
import { LoiNgoai } from "./loi";

const hang = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>;
const db = async () => (await getDb()) as unknown as DbBay;
const hangCua = async (u: number) => hang(await (await db()).execute(sql`SELECT token, "hetHan" > now() AS "conHan", extract(epoch FROM "hetHan" - "batDau")::int AS ttl FROM ai_ngoai_dang_bay WHERE "userId" = ${u}`));

let U = 0;
beforeAll(async () => {
  U = (await taoNguoiDungTest("lbU", "user")).id;
});

describe("luotBay — SQL thật", () => {
  it("hai lượt giữ ĐỒNG THỜI ⇒ đúng một thắng, lượt kia NGOAI_DANG_CHAY; TTL = batDau + ttl (SQL now())", async () => {
    const kq = await Promise.allSettled([giuLuotBay(await db(), U, 1, 120), giuLuotBay(await db(), U, 1, 120)]);
    const thang = kq.filter((x) => x.status === "fulfilled");
    const thua = kq.filter((x) => x.status === "rejected") as PromiseRejectedResult[];
    expect(thang).toHaveLength(1);
    expect(thua).toHaveLength(1);
    expect(thua[0]!.reason).toBeInstanceOf(LoiNgoai);
    expect((thua[0]!.reason as LoiNgoai).ma).toBe("NGOAI_DANG_CHAY");
    const [r] = await hangCua(U);
    expect(r).toMatchObject({ token: (thang[0] as PromiseFulfilledResult<string>).value, conHan: true, ttl: 120 });
    await thaLuotBay(await db(), U, (thang[0] as PromiseFulfilledResult<string>).value);
  });

  it("hàng HẾT HẠN (đẩy về quá khứ bằng SQL) ⇒ lượt mới chiếm được, token ĐỔI, batDau đặt lại (CHECK ≤ 15 phút không đỏ oan)", async () => {
    const t1 = await giuLuotBay(await db(), U, 1, 900);
    await (await db()).execute(sql`UPDATE ai_ngoai_dang_bay SET "batDau" = now() - interval '20 minutes', "hetHan" = now() - interval '6 minutes' WHERE "userId" = ${U}`);
    const t2 = await giuLuotBay(await db(), U, 1, 900);
    expect(t2).not.toBe(t1);
    expect((await hangCua(U))[0]).toMatchObject({ token: t2, conHan: true, ttl: 900 });
    await thaLuotBay(await db(), U, t2);
  });

  it("thả SAI token (lượt cũ đã hết hạn và bị chiếm) KHÔNG xoá hàng của lượt mới; thả đúng token xoá", async () => {
    const moi = await giuLuotBay(await db(), U, 1, 120);
    await thaLuotBay(await db(), U, "token-cu-da-het-han");
    expect((await hangCua(U))[0]?.token).toBe(moi);
    await thaLuotBay(await db(), U, moi);
    expect(await hangCua(U)).toHaveLength(0);
  });
});
