/**
 * SCADA R1a Task 6 (K6) - khoa chon (adapter, kenh) theo DB `_test` THAT. Khong mock `db`.
 * Bang `scada_khoa_chon`: adapter_id co FK -> device_adapters(id) ON DELETE CASCADE (mig 0433) => hai adapter THAT (chi cot NOT NULL, code rieng cua bai)
 * duoc tao o beforeAll va xoa o afterAll (CASCADE don not hang khoa). user_id la so thuong (khong FK).
 * Doi chung: moi ca dung SQL tho (`postgres`) doc/ghi hang, khong tin gia tri tra ve cua chinh ham.
 * Ca dua: HAI ket noi RIENG (max 1 moi ket noi) chay HAI giao dich song song, 20 vong tren cung mot khoa => dung mot nguoi thang.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { conGiuKhoa, giuKhoaChon, nhaKhoaChon } from "./khoaChon";

const DB_URL = process.env.DATABASE_URL;
const DAU = `KHOACHON-${Date.now()}`;
let ADAPTER = 0;
let ADAPTER_2 = 0;
const KEY = "set_temp";
const T0 = new Date("2026-10-24T08:00:00.000Z");
const plus = (s: number, from = T0) => new Date(from.getTime() + s * 1000);

let raw: ReturnType<typeof postgres>;
let clientA: ReturnType<typeof postgres>;
let clientB: ReturnType<typeof postgres>;
let dbA: ReturnType<typeof drizzle>;
let dbB: ReturnType<typeof drizzle>;

type Hang = { user_id: number; request_id: string; expires_at: Date };
const hang = async (key = KEY): Promise<Hang | undefined> =>
  (await raw<Hang[]>`SELECT user_id, request_id, expires_at FROM scada_khoa_chon WHERE adapter_id = ${ADAPTER} AND tag_key = ${key}`)[0];

describe.skipIf(!DB_URL || !/_test\b/.test(DB_URL ?? ""))("R1a T6 - khoa chon (K6) tren DB _test that", () => {
  beforeAll(async () => {
    raw = postgres(DB_URL!, { max: 2, connect_timeout: 30, onnotice: () => {} });
    const proto = (await raw<{ p: string }[]>`SELECT (enum_range(NULL::"otprotocolenum"))[1]::text AS p`)[0]!.p;
    const moi = async (hau: string) =>
      (await raw<{ id: number }[]>`INSERT INTO device_adapters ("code", "name", "protocol", "endpoint") VALUES (${`${DAU}-${hau}`}, ${`${DAU} ${hau}`}, ${proto}::"otprotocolenum", ${`probe://khoachon/${hau}`}) RETURNING id`)[0]!.id;
    ADAPTER = await moi("1");
    ADAPTER_2 = await moi("2");
    clientA = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    clientB = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    dbA = drizzle(clientA);
    dbB = drizzle(clientB);
  }, 60_000);

  beforeEach(async () => {
    await raw`DELETE FROM scada_khoa_chon WHERE adapter_id IN (${ADAPTER}, ${ADAPTER_2})`;
  });

  afterAll(async () => {
    if (raw) await raw`DELETE FROM scada_khoa_chon WHERE adapter_id IN (${ADAPTER}, ${ADAPTER_2})`;
    if (raw) await raw`DELETE FROM device_adapters WHERE code LIKE ${`${DAU}-%`}`;
    await Promise.all([raw?.end({ timeout: 5 }), clientA?.end({ timeout: 5 }), clientB?.end({ timeout: 5 })]);
  }, 60_000);

  it("A giu => B nhan DANG_DUOC_CHON {boiUserId: A, hetHanLuc: han cua A}; hang DB van la cua A", async () => {
    const ra = await giuKhoaChon(dbA, { adapterId: ADAPTER, tagKey: KEY, userId: 11, requestId: "req-A", hetHanLuc: plus(60) }, T0);
    expect(ra).toEqual({ ok: true });
    const rb = await giuKhoaChon(dbB, { adapterId: ADAPTER, tagKey: KEY, userId: 22, requestId: "req-B", hetHanLuc: plus(65) }, plus(1));
    expect(rb).toEqual({ ok: false, ma: "DANG_DUOC_CHON", boiUserId: 11, hetHanLuc: plus(60) });
    const h = await hang();
    expect(h?.user_id).toBe(11);
    expect(h?.request_id).toBe("req-A");
    expect(h?.expires_at.getTime()).toBe(plus(60).getTime());
  });

  it("A giu, da het han => B giu duoc (hang chuyen sang B)", async () => {
    await giuKhoaChon(dbA, { adapterId: ADAPTER, tagKey: KEY, userId: 11, requestId: "req-A", hetHanLuc: plus(60) }, T0);
    // dung bien: expires_at == now cung la het han (<=)
    const rb = await giuKhoaChon(dbB, { adapterId: ADAPTER, tagKey: KEY, userId: 22, requestId: "req-B", hetHanLuc: plus(120) }, plus(60));
    expect(rb).toEqual({ ok: true });
    const h = await hang();
    expect(h?.user_id).toBe(22);
    expect(h?.request_id).toBe("req-B");
    expect(h?.expires_at.getTime()).toBe(plus(120).getTime());
  });

  it("con 1 mili giay truoc han => van la cua A (khong het han som)", async () => {
    await giuKhoaChon(dbA, { adapterId: ADAPTER, tagKey: KEY, userId: 11, requestId: "req-A", hetHanLuc: plus(60) }, T0);
    const rb = await giuKhoaChon(dbB, { adapterId: ADAPTER, tagKey: KEY, userId: 22, requestId: "req-B", hetHanLuc: plus(130) }, new Date(plus(60).getTime() - 1));
    expect(rb.ok).toBe(false);
  });

  it("A goi lan hai (yeu cau moi) => ok va ghi de khoa cua chinh minh (request_id + han moi)", async () => {
    await giuKhoaChon(dbA, { adapterId: ADAPTER, tagKey: KEY, userId: 11, requestId: "req-1", hetHanLuc: plus(60) }, T0);
    const r2 = await giuKhoaChon(dbA, { adapterId: ADAPTER, tagKey: KEY, userId: 11, requestId: "req-2", hetHanLuc: plus(100) }, plus(10));
    expect(r2).toEqual({ ok: true });
    const h = await hang();
    expect(h?.request_id).toBe("req-2");
    expect(h?.expires_at.getTime()).toBe(plus(100).getTime());
  });

  it("khoa khac kenh / khac adapter khong chan nhau", async () => {
    await giuKhoaChon(dbA, { adapterId: ADAPTER, tagKey: KEY, userId: 11, requestId: "req-A", hetHanLuc: plus(60) }, T0);
    expect(await giuKhoaChon(dbB, { adapterId: ADAPTER, tagKey: "kenh_khac", userId: 22, requestId: "req-B", hetHanLuc: plus(60) }, T0)).toEqual({ ok: true });
    expect(await giuKhoaChon(dbB, { adapterId: ADAPTER_2, tagKey: KEY, userId: 22, requestId: "req-C", hetHanLuc: plus(60) }, T0)).toEqual({ ok: true });
  });

  it("nhaKhoaChon voi requestId CU khong xoa khoa moi; dung requestId thi xoa", async () => {
    await giuKhoaChon(dbA, { adapterId: ADAPTER, tagKey: KEY, userId: 11, requestId: "req-1", hetHanLuc: plus(60) }, T0);
    await giuKhoaChon(dbA, { adapterId: ADAPTER, tagKey: KEY, userId: 11, requestId: "req-2", hetHanLuc: plus(100) }, plus(10));
    await nhaKhoaChon(dbA, { adapterId: ADAPTER, tagKey: KEY, requestId: "req-1" });
    expect((await hang())?.request_id).toBe("req-2");
    await nhaKhoaChon(dbA, { adapterId: ADAPTER, tagKey: KEY, requestId: "req-2" });
    expect(await hang()).toBeUndefined();
    // nha khi khong co hang: khong loi
    await expect(nhaKhoaChon(dbA, { adapterId: ADAPTER, tagKey: KEY, requestId: "req-2" })).resolves.toBeUndefined();
  });

  it("conGiuKhoa: dung (user, request, chua het han) moi true; sai user / sai request / het han / khong co hang => false", async () => {
    const k = { adapterId: ADAPTER, tagKey: KEY };
    expect(await conGiuKhoa(dbA, { ...k, userId: 11, requestId: "req-A" }, T0)).toBe(false); // chua co hang
    await giuKhoaChon(dbA, { ...k, userId: 11, requestId: "req-A", hetHanLuc: plus(60) }, T0);
    expect(await conGiuKhoa(dbA, { ...k, userId: 11, requestId: "req-A" }, plus(59))).toBe(true);
    expect(await conGiuKhoa(dbA, { ...k, userId: 22, requestId: "req-A" }, plus(59))).toBe(false);
    expect(await conGiuKhoa(dbA, { ...k, userId: 11, requestId: "req-X" }, plus(59))).toBe(false);
    expect(await conGiuKhoa(dbA, { ...k, userId: 11, requestId: "req-A" }, plus(60))).toBe(false); // == han => het
    expect(await conGiuKhoa(dbA, { ...k, userId: 11, requestId: "req-A" }, plus(61))).toBe(false);
  });

  it("chay trong giao dich cua nguoi goi: rollback => khoa khong ton tai", async () => {
    await expect(
      dbA.transaction(async (tx) => {
        expect(await giuKhoaChon(tx, { adapterId: ADAPTER, tagKey: KEY, userId: 11, requestId: "req-A", hetHanLuc: plus(60) }, T0)).toEqual({ ok: true });
        throw new Error("rollback-co-y");
      }),
    ).rejects.toThrow("rollback-co-y");
    expect(await hang()).toBeUndefined();
  });

  it("khong truyen now => dung dong ho ung dung (new Date()), khoa han trong tuong lai van chan nguoi khac", async () => {
    await giuKhoaChon(dbA, { adapterId: ADAPTER, tagKey: KEY, userId: 11, requestId: "req-A", hetHanLuc: new Date(Date.now() + 60_000) });
    const rb = await giuKhoaChon(dbB, { adapterId: ADAPTER, tagKey: KEY, userId: 22, requestId: "req-B", hetHanLuc: new Date(Date.now() + 60_000) });
    expect(rb.ok).toBe(false);
    expect(await conGiuKhoa(dbA, { adapterId: ADAPTER, tagKey: KEY, userId: 11, requestId: "req-A" })).toBe(true);
  });

  it("DUA: hai giao dich tren hai ket noi rieng, 20 vong cung mot khoa => dung MOT nguoi thang moi vong, hang DB = nguoi thang", async () => {
    const thang: Record<string, number> = { A: 0, B: 0 };
    for (let vong = 0; vong < 20; vong++) {
      await raw`DELETE FROM scada_khoa_chon WHERE adapter_id = ${ADAPTER}`;
      // rao: ca hai da BEGIN truoc khi bat dau tranh; luan phien ben nao lui mot nhip de doi thu tu tranh
      let moi!: () => void;
      const sanSang = new Promise<void>((r) => (moi = r));
      let da = 0;
      const rao = async () => {
        if (++da === 2) moi();
        await sanSang;
      };
      const chay = (db: typeof dbA, userId: number, requestId: string, lui: boolean) =>
        db.transaction(async (tx) => {
          await rao();
          if (lui) await new Promise((r) => setTimeout(r, 1));
          return giuKhoaChon(tx, { adapterId: ADAPTER, tagKey: KEY, userId, requestId, hetHanLuc: plus(60) }, T0);
        });
      const [ra, rb] = await Promise.all([chay(dbA, 11, `A-${vong}`, vong % 2 === 0), chay(dbB, 22, `B-${vong}`, vong % 2 === 1)]);
      const thangA = ra.ok;
      expect(Number(ra.ok) + Number(rb.ok), `vong ${vong}: dung mot nguoi thang (A=${JSON.stringify(ra)} B=${JSON.stringify(rb)})`).toBe(1);
      const h = await hang();
      expect(h?.user_id, `vong ${vong}: hang DB la cua nguoi thang`).toBe(thangA ? 11 : 22);
      const thua = thangA ? rb : ra;
      expect(thua).toEqual({ ok: false, ma: "DANG_DUOC_CHON", boiUserId: thangA ? 11 : 22, hetHanLuc: plus(60) });
      thang[thangA ? "A" : "B"]++;
    }
    expect(thang.A + thang.B).toBe(20);
  }, 60_000);
});
