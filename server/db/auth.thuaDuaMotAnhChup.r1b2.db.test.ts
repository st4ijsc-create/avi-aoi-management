/**
 * SCADA R1b-2a Task 10 fix round 1 — `tieuMaDuPhongPhanLoai` đọc hàng VỪA TIÊU và hàng CHƯA DÙNG trong MỘT câu (một ảnh chụp).
 *
 * Lưới 10 song song (auth.backupDoubleSpend.r1b.db.test.ts) đỏ ~1 vòng / vài lượt chạy ở bản đầu: đọc hai loại hàng bằng HAI câu, người
 * thắng commit GIỮA hai câu ⇒ câu 1 chưa thấy hàng đã dùng, câu 2 không còn thấy hàng chưa dùng ⇒ lượt thua đua bị coi `khong_khop` (bị
 * đếm; là lượt thứ 10 thì audit + ném khoá). Ca dưới cấy ĐÚNG khe ấy một cách tất định: ngay sau khi câu SELECT ĐẦU TIÊN của lượt gọi
 * trả kết quả, một lượt khác tiêu chính mã ấy (commit), rồi lượt gọi đi tiếp.
 * Đột biến (đọc bằng hai câu) ⇒ ca này đỏ `khong_khop`.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

/** Móc chạy MỘT lần ngay sau khi một câu `db.select(...)` (bất kỳ) trả kết quả — chỉ khi được gài. */
const H = vi.hoisted(() => ({ sauSelect: null as null | (() => Promise<void>) }));

vi.mock("./connection", async (importOriginal) => {
  const real = await importOriginal<typeof import("./connection")>();
  // Bọc kết quả builder: gọi phương thức trên CHÍNH đối tượng gốc (không qua proxy ⇒ không vướng trường riêng), bọc lại kết quả còn là
  // builder (có `then`); `then` chạy móc một lần sau khi câu trả hàng.
  const boc = (b: any): any =>
    new Proxy(b, {
      get(target, prop) {
        const v = target[prop];
        if (prop === "then" && typeof v === "function") {
          return (res: any, rej: any) =>
            v
              .call(target, async (rows: unknown) => {
                const f = H.sauSelect;
                if (f) {
                  H.sauSelect = null;
                  await f();
                }
                return rows;
              })
              .then(res, rej);
        }
        if (typeof v === "function") {
          return (...a: unknown[]) => {
            const r = v.apply(target, a);
            return r && typeof r === "object" && typeof (r as { then?: unknown }).then === "function" ? boc(r) : r;
          };
        }
        return v;
      },
    });
  const daBoc = new WeakMap<object, unknown>();
  return {
    ...real,
    getDb: async () => {
      const db = await real.getDb();
      if (!db) return db;
      if (!daBoc.has(db)) {
        daBoc.set(
          db,
          new Proxy(db, {
            get(target, prop) {
              const v = (target as any)[prop];
              if (prop === "select" && typeof v === "function") return (...a: unknown[]) => boc(v.apply(target, a));
              return typeof v === "function" ? v.bind(target) : v;
            },
          }),
        );
      }
      return daBoc.get(db) as typeof db;
    },
  };
});

import * as db from "./index";
import { __resetSoTotpChoTest } from "../_core/totpOnce";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

const RUN = `t10f${process.pid}${Date.now().toString(36)}`;
const moi: number[] = [];

afterAll(async () => {
  H.sauSelect = null;
  if (!moi.length) return;
  const d = (await db.getDb())!;
  await d.execute(sql`DELETE FROM backup_codes WHERE "userId" IN (${sql.join(moi.map((i) => sql`${i}`), sql`, `)})`);
  await __resetSoTotpChoTest(moi);
});

describe("R1b-2a T10 fix round 1 — phân loại đọc MỘT ảnh chụp", () => {
  it("người thắng commit NGAY SAU câu SELECT đầu của lượt thua ⇒ lượt thua vẫn là 'thua_dua' (không 'khong_khop')", async () => {
    const u = await taoNguoiDungTest("motAnhChup", "operator", { tienTo: "t10dp", ts: RUN, ten: "R1b-2a T10 fix1 một ảnh chụp" });
    moi.push(u.id);
    const bo = await db.quayVongMaDuPhong(u.id, 3);
    const MA = bo[1]!;
    let nguoiThang: string | undefined;
    H.sauSelect = async () => {
      nguoiThang = await db.tieuMaDuPhongPhanLoai(u.id, MA); // móc đã tự gỡ ⇒ lượt này chạy thường
    };
    const kq = await db.tieuMaDuPhongPhanLoai(u.id, MA);
    expect(H.sauSelect, "móc đã chạy").toBeNull();
    expect(nguoiThang, "lượt cấy giữa chừng là người thắng").toBe("tieu");
    expect(kq, "lượt thua đua phải được nhận ra dù người thắng commit giữa chừng").toBe("thua_dua");
    const [r] = (await (await db.getDb())!.execute(
      sql`SELECT count(*)::int AS n FROM backup_codes WHERE "userId" = ${u.id} AND "isUsed" = true`,
    )) as unknown as { n: number }[];
    expect(Number(r!.n)).toBe(1);
  }, 60_000);
});
