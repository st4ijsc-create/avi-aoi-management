/**
 * TEST-DB-TAY-CAM-CU (HST 28/11, taycam-ket-luan-1.md §4 A) — tự kiểm THUẦN của móc chặn tay cầm cũ (__foeGateRunFixture: gaiTayCam). KHÔNG DB:
 * drizzle-orm THẬT (PostgresJsSession / PostgresJsTransaction) trên một client giả kiểu postgres.js (scope, savepoint, `rollback to` khi savepoint lỗi —
 * như postgres/src/index.js:251-289). "Dây" = các câu tới client giả. Móc dựa vào nội tạng drizzle 0.44.7 (session.client): nâng drizzle mà nội tạng
 * đổi thì tệp này đỏ — đó là điều muốn (TAYCAM-NOI-TANG).
 */
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { integer, pgTable, PgDialect } from "drizzle-orm/pg-core";
import { PostgresJsSession } from "drizzle-orm/postgres-js";
import { gaiTayCam, tayCamCuaTep, taoDongHoCat } from "./__foeGateRunFixture";

const bang = pgTable("t", { id: integer("id") });
const ROLLBACK = Symbol("rollback");

/** client giả kiểu postgres.js: mỗi câu tới nó được ghi vào `day` */
function taoKetNoi() {
  const day: string[] = [];
  const lamScope = (ten: string): any => {
    const scope: any = (strings: TemplateStringsArray) => {
      day.push(`${ten}:${strings.join("?")}`);
      return Promise.resolve([]);
    };
    scope.unsafe = (q: string) => {
      day.push(`${ten}:${q}`);
      const p: any = Promise.resolve([]);
      p.values = () => Promise.resolve([]);
      return p;
    };
    let n = 0;
    scope.savepoint = async (fn: (c: unknown) => unknown) => {
      const con = lamScope(`${ten}/s${n++}`);
      day.push(`${ten}:savepoint`);
      try {
        return await fn(con);
      } catch (e) {
        day.push(`${ten}:rollback to`);
        throw e;
      }
    };
    return scope;
  };
  const goc = {
    begin: async (fn: (c: unknown) => unknown) => {
      day.push("begin");
      try {
        const r = await fn(lamScope("tx"));
        day.push("commit");
        return r;
      } catch (e) {
        day.push("rollback");
        throw e;
      }
    },
  };
  const session = new PostgresJsSession(goc as any, new PgDialect(), undefined);
  /** như trongGiaoDich của các tệp DB: gài ngay đầu giao dịch, ketThuc trong finally, daRollback sau khi ROLLBACK xong */
  const trongGiaoDich = async (tep: string, fn: (tx: any) => Promise<void>) => {
    const moc: { h: ReturnType<typeof gaiTayCam> | null } = { h: null };
    try {
      await session.transaction(async (tx) => {
        moc.h = gaiTayCam(tx, tep);
        try {
          await fn(tx);
        } finally {
          moc.h?.ketThuc();
        }
        throw ROLLBACK;
      });
    } catch (e) {
      if (e !== ROLLBACK) throw e;
    } finally {
      moc.h?.daRollback();
    }
  };
  return { day, trongGiaoDich };
}

/** chữ của lời từ chối (drizzle bọc lỗi của client thành DrizzleQueryError, giữ `cause`) */
async function nhan(viec: () => PromiseLike<unknown>): Promise<string> {
  try {
    await viec();
    return "LOT";
  } catch (e) {
    const chu = `${(e as any)?.message ?? ""} ${(e as any)?.cause?.message ?? ""}`;
    return chu.includes("TAY-CAM-CU (") ? "CHAN" : `LOI-KHAC: ${chu.slice(0, 120)}`;
  }
}

/** một "hàm sản phẩm" giữ tay cầm cũ: khung của nó phải có trong bản ghi (nguonKhung "goi") */
async function ghiMuon(tx: any) {
  await tx.insert(bang).values({ id: 7 });
}

describe("TEST-DB-TAY-CAM-CU — gaiTayCam blocks every statement on the handle of a finished case transaction (no DB)", () => {
  it("★ TAY-CAM-SONG — while the case runs, every statement reaches the connection unchanged (insert, execute, select inside a savepoint)", async () => {
    const k = taoKetNoi();
    await k.trongGiaoDich("tc-song", async (tx) => {
      await tx.insert(bang).values({ id: 1 });
      await tx.execute(sql`select 2`);
      await tx.transaction(async (sp: any) => {
        await sp.select().from(bang);
      });
    });
    expect(k.day.map((d) => d.replace(/ values .*$/, "")), "TAY-CAM-SONG: the wire").toEqual([
      "begin",
      'tx:insert into "t" ("id")',
      "tx:select 2",
      "tx:savepoint",
      'tx/s0:select "id" from "t"',
      "rollback",
    ]);
    expect(tayCamCuaTep("tc-song"), "TAY-CAM-SONG: the file's guard state").toEqual({ giaoDich: 1, lenhMuon: [] });
  });

  it("★ TAY-CAM-SAU — after the case: the six old handles (tx, savepoint, savepoint level 2, an execute built before, a builder built before, transaction() on the old tx) are refused; nothing more reaches the wire", async () => {
    const k = taoKetNoi();
    const giu: Record<string, any> = {};
    await k.trongGiaoDich("tc-sau", async (tx) => {
      giu.tx = tx;
      giu.q = tx.execute(sql`select 3`); // prepareQuery runs NOW (pg-core/db.js:276): it must hold the guarded client
      giu.b = tx.select().from(bang);
      await tx.transaction(async (sp: any) => {
        giu.sp = sp;
        await sp.transaction(async (sp2: any) => {
          giu.sp2 = sp2;
        });
      });
    });
    const truoc = k.day.length;
    const ketQua = {
      tx: await nhan(() => giu.tx.execute(sql`select 1`)),
      savepoint: await nhan(() => giu.sp.execute(sql`select 1`)),
      "savepoint-tang-2": await nhan(() => giu.sp2.execute(sql`select 1`)),
      "execute-dung-truoc": await nhan(() => giu.q),
      "builder-dung-truoc": await nhan(() => giu.b),
      "transaction-tren-tay-cam-cu": await nhan(() => giu.tx.transaction(async () => undefined)),
    };
    expect(ketQua, "TAY-CAM-SAU: each old handle").toEqual({
      tx: "CHAN",
      savepoint: "CHAN",
      "savepoint-tang-2": "CHAN",
      "execute-dung-truoc": "CHAN",
      "builder-dung-truoc": "CHAN",
      "transaction-tren-tay-cam-cu": "CHAN",
    });
    expect(k.day.slice(truoc), "TAY-CAM-SAU: what reached the wire after the case").toEqual([]);
    const ghi = tayCamCuaTep("tc-sau").lenhMuon;
    expect(
      ghi.map((g) => [g.loai, g.tang, g.luc, g.cau]),
      "TAY-CAM-SAU: the records (one per refused statement, in order)",
    ).toEqual([
      ["unsafe", 0, "sau-rollback", "select 1"],
      ["unsafe", 1, "sau-rollback", "select 1"],
      ["unsafe", 2, "sau-rollback", "select 1"],
      ["unsafe", 0, "sau-rollback", "select 3"],
      ["unsafe", 0, "sau-rollback", 'select "id" from "t"'],
      ["savepoint", 0, "sau-rollback", "SAVEPOINT"],
    ]);
    expect(new Set(ghi.map((g) => g.caChu)), "TAY-CAM-SAU: the owner case").toEqual(new Set([expect.getState().currentTestName]));
  });

  it("★ TAY-CAM-KHUNG — a late write through a held handle is recorded with the frame of the code that made it (nguonKhung goi)", async () => {
    const k = taoKetNoi();
    const giu: Record<string, any> = {};
    await k.trongGiaoDich("tc-khung", async (tx) => {
      giu.tx = tx;
    });
    expect(await nhan(() => ghiMuon(giu.tx)), "TAY-CAM-KHUNG: the late write").toBe("CHAN");
    const ghi = tayCamCuaTep("tc-khung").lenhMuon;
    expect(ghi.map((g) => [g.nguonKhung, g.luc, g.cau.replace(/ values .*$/, "")]), "TAY-CAM-KHUNG: source / moment / statement").toEqual([["goi", "sau-rollback", 'insert into "t" ("id")']]);
    expect(ghi[0]?.khung[0] ?? "", "TAY-CAM-KHUNG: the first frame").toMatch(/server\/services\/orchestration\/foe\/chanTayCamCu\.test\.ts:\d+:\d+ ghiMuon$/);
  });

  it("★ TAY-CAM-SAVEPOINT-MO — a statement refused inside a savepoint still open: recorded with savepointDangMo; the only thing on the wire is postgres.js's own `rollback to` (TAYCAM-ROLLBACK-TO-CHEO)", async () => {
    const k = taoKetNoi();
    let mo: () => void = () => undefined;
    const cho = new Promise<void>((r) => (mo = r));
    const giu: { spMo?: Promise<string> } = {};
    await k.trongGiaoDich("tc-sp-mo", async (tx) => {
      giu.spMo = nhan(() =>
        tx.transaction(async (sp: any) => {
          await cho;
          await sp.execute(sql`select 4`);
        }),
      );
    });
    const truoc = k.day.length;
    mo();
    expect(await giu.spMo, "TAY-CAM-SAVEPOINT-MO: the statement inside").toBe("CHAN");
    expect(k.day.slice(truoc), "TAY-CAM-SAVEPOINT-MO: the wire after the case").toEqual(["tx:rollback to"]);
    expect(
      tayCamCuaTep("tc-sp-mo").lenhMuon.map((g) => [g.tang, g.savepointDangMo, g.cau]),
      "TAY-CAM-SAVEPOINT-MO: the record",
    ).toEqual([[1, true, "select 4"]]);
  });

  it("★ TAY-CAM-S1 — the wrapped transaction() returns a DERIVED promise that rethrows (never the inner one with handlers attached: a rejection nobody awaits stays an Unhandled Rejection)", async () => {
    const loi = new Error("inner refusal");
    const trong = Promise.reject(loi);
    trong.catch(() => undefined); // this case's own inner promise: handled here, only its identity is checked
    const h: any = { session: { client: {} }, transaction: () => trong };
    gaiTayCam(h, "tc-s1");
    const ra = h.transaction(async () => undefined) as Promise<unknown>;
    expect(ra, "TAY-CAM-S1: the promise returned").not.toBe(trong);
    await expect(ra, "TAY-CAM-S1: the derived promise rethrows the same error").rejects.toBe(loi);
  });

  it("★ TAY-CAM-G2 — Error.stackTraceLimit is raised only while a frame is taken, then given back unchanged", async () => {
    const k = taoKetNoi();
    const giu: Record<string, any> = {};
    await k.trongGiaoDich("tc-g2", async (tx) => {
      giu.tx = tx;
    });
    const cu = Error.stackTraceLimit;
    try {
      Error.stackTraceLimit = 7;
      expect(await nhan(() => giu.tx.execute(sql`select 5`)), "TAY-CAM-G2: the late statement").toBe("CHAN");
      expect(Error.stackTraceLimit, "TAY-CAM-G2: the limit after").toBe(7);
    } finally {
      Error.stackTraceLimit = cu;
    }
    expect(tayCamCuaTep("tc-g2").lenhMuon.length, "TAY-CAM-G2: one record").toBe(1);
  });

  it("★ TAY-CAM-DONG-HO-CAT — the hourglass (a clock passed in, ns): no mark ⇒ null; the FIRST mark counts, a later mark does not move it", () => {
    let bayGio = 1_000_000_000n;
    const d = taoDongHoCat(() => bayGio);
    expect(d.msTuMocDau(), "TAY-CAM-DONG-HO-CAT: before any mark").toBeNull();
    d.danhDau();
    bayGio += 30_000_000n; // 30 ms
    d.danhDau();
    bayGio += 12_000_000n; // 12 ms more
    expect(d.msTuMocDau(), "TAY-CAM-DONG-HO-CAT: ms since the first mark").toBe(42);
  });
});
