/**
 * Khoá MỘT vỏ giao dịch ROLLBACK (`trongRollbackPhatLai.ts`) — THUẦN, không DB (CSDL giả + bộ đếm giả):
 *  • HÀNH VI: thân ca xong ⇒ vỏ trả bình thường (nuốt đúng `RollbackPhatLai`); thân ca NÉM (expect hỏng) ⇒ lỗi LAN RA (không bị nuốt); lời gọi `transaction` luôn kết thúc bằng ném Rollback (⇒ ROLLBACK);
 *    `kenh.db` = tx trong thân và `null` sau (cả khi ném); bộ đếm chạy TRƯỚC khi trả kênh, cả khi thân ném; đếm > 0 ⇒ `kenh.lot` có RÒ RỈ; bộ đếm ném ⇒ "KHÔNG chạy được"; không CSDL ⇒ ném.
 *  • CẤU TRÚC: ba tệp phát lại (phatLaiFixture, phatLaiLuot, epDo) GỌI vỏ chung và KHÔNG tự dựng vỏ (không `.transaction(`, `RollbackPhatLai`, `nuotRollback`, `catch`, `vi.importActual`, `insert(users)`).
 * ĐỘT BIẾN PHẢI BẮT: nuốt mọi lỗi · bỏ throw Rollback cuối giao dịch · bỏ đếm rò rỉ khỏi finally · trả kênh trước khi đếm · bỏ `kenh.db = null` · một tệp tự dựng lại vỏ.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import type { KenhGiaoDich } from "./kenhGiaoDich";
import type { HangRoRi } from "./kiemRoRiDb";
import { trongRollbackPhatLai } from "./__trongRollbackPhatLai";

const kenhMoi = (): KenhGiaoDich => ({ db: null, lot: [], goi: { "server/x.ts:1:1": 3 } });
const khong = async (): Promise<HangRoRi> => ({ audit_logs: 0, ai_pending_actions: 0, tong: 0 });

/** CSDL giả: `transaction(cb)` chạy cb với một tx giả; ghi lại việc cb ném gì (để biết có ROLLBACK). */
function dbGia() {
  const ghi = { daMo: 0, cbNem: null as unknown, chen: 0 };
  const tx = {
    insert: () => ({
      values: () => ({
        returning: async () => {
          ghi.chen++;
          return [{ id: 4242 }];
        },
      }),
    }),
  };
  const db = {
    transaction: async (cb: (t: unknown) => Promise<void>) => {
      ghi.daMo++;
      try {
        await cb(tx);
      } catch (e) {
        ghi.cbNem = e;
        throw e; // postgres.js: cb ném ⇒ ROLLBACK + ném lại
      }
    },
  };
  return { db, tx, ghi };
}

describe("trongRollbackPhatLai — hành vi (CSDL giả)", () => {
  it("★★★ thân xong ⇒ giao dịch kết thúc bằng NÉM Rollback (⇒ ROLLBACK) nhưng vỏ trả bình thường; kenh.db = tx trong thân, null sau; người dùng thử được tạo trong tx", async () => {
    const { db, tx, ghi } = dbGia();
    const kenh = kenhMoi();
    let thay: unknown = "chua";
    let uidThay = 0;
    await trongRollbackPhatLai(
      kenh,
      "x",
      async ({ tx: t, userId }) => {
        thay = kenh.db;
        uidThay = userId;
        expect(t).toBe(tx);
      },
      { layDb: async () => db, dem: khong },
    );
    expect(thay).toBe(tx);
    expect(uidThay).toBe(4242);
    expect(kenh.db).toBeNull();
    expect(ghi.daMo).toBe(1);
    expect(ghi.chen).toBe(1);
    expect(ghi.cbNem, "giao dịch PHẢI kết thúc bằng ném (ROLLBACK), không bao giờ trả bình thường").toBeInstanceOf(Error);
    expect((ghi.cbNem as Error).constructor.name).toBe("RollbackPhatLai");
  });
  it("★★★ thân NÉM (expect hỏng) ⇒ lỗi LAN RA nguyên văn (ca ĐỎ), kenh.db về null, bộ đếm VẪN chạy trước khi trả kênh", async () => {
    const { db } = dbGia();
    const kenh = kenhMoi();
    const thuTu: string[] = [];
    const dem = async (id: number): Promise<HangRoRi> => {
      thuTu.push(`dem(${id}) kenh.db=${kenh.db === null ? "null" : "tx"}`);
      return khong();
    };
    await expect(
      trongRollbackPhatLai(
        kenh,
        "x",
        async () => {
          throw new Error("expect hỏng giữa ca");
        },
        { layDb: async () => db, dem },
      ),
    ).rejects.toThrow("expect hỏng giữa ca");
    expect(kenh.db).toBeNull();
    expect(thuTu, "đếm phải chạy khi kênh CÒN là tx (trước khi trả kênh)").toEqual(["dem(4242) kenh.db=tx"]);
  });
  it("★★★ đếm > 0 ⇒ kenh.lot có đúng một câu RÒ RỈ; đếm ném ⇒ lot có 'KHÔNG chạy được' (không nuốt); đếm 0 ⇒ lot rỗng", async () => {
    const { db } = dbGia();
    const k1 = kenhMoi();
    await trongRollbackPhatLai(k1, "x", async () => undefined, { layDb: async () => db, dem: async () => ({ audit_logs: 1, ai_pending_actions: 1, tong: 2 }) });
    expect(k1.lot).toHaveLength(1);
    expect(k1.lot[0]).toContain("RÒ RỈ");
    expect(k1.lot[0]).toContain("userId=4242");
    const k2 = kenhMoi();
    await trongRollbackPhatLai(k2, "x", async () => undefined, {
      layDb: async () => db,
      dem: async () => {
        throw new Error("mất kết nối");
      },
    });
    expect(k2.lot[0]).toContain("KHÔNG chạy được");
    const k3 = kenhMoi();
    await trongRollbackPhatLai(k3, "x", async () => undefined, { layDb: async () => db, dem: khong });
    expect(k3.lot).toEqual([]);
  });
  it("không có CSDL ⇒ ném 'cần CSDL _test' (không xanh im lặng)", async () => {
    await expect(trongRollbackPhatLai(kenhMoi(), "x", async () => undefined, { layDb: async () => null })).rejects.toThrow("cần CSDL _test");
  });
});

const doc = (t: string) => {
  const p = path.join(__dirname, t);
  const nguon = fs.readFileSync(p, "utf8");
  return { nguon, sf: ts.createSourceFile(p, nguon, ts.ScriptTarget.Latest, true) };
};
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
function duyet(sf: ts.SourceFile, fn: (n: ts.Node) => void): void {
  const di = (n: ts.Node) => {
    fn(n);
    ts.forEachChild(n, di);
  };
  di(sf);
}

describe("trongRollbackPhatLai.ts — cấu trúc", () => {
  const VO = doc("__trongRollbackPhatLai.ts");
  it("★★★ `.transaction(cb)`: câu CUỐI của cb là `throw new …Rollback…()`; đúng MỘT `catch (e)` và nó chỉ gọi `nuotRollback(e)`", () => {
    let hoanTac = false;
    duyet(VO.sf, (n) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "transaction") {
        for (const a of n.arguments) {
          if (!(ts.isArrowFunction(a) || ts.isFunctionExpression(a)) || !ts.isBlock(a.body)) continue;
          const cuoi = a.body.statements[a.body.statements.length - 1];
          if (cuoi && ts.isThrowStatement(cuoi) && cuoi.expression && /rollback/i.test(cuoi.expression.getText(VO.sf))) hoanTac = true;
        }
      }
    });
    expect(hoanTac, "thiếu ROLLBACK ở cuối giao dịch").toBe(true);
    const catchs: string[] = [];
    duyet(VO.sf, (n) => {
      if (ts.isCatchClause(n) && n.variableDeclaration && ts.isIdentifier(n.variableDeclaration.name)) {
        const ten = n.variableDeclaration.name.text;
        catchs.push(new RegExp(`^\\{\\s*nuotRollback\\(${ten}\\);\\s*\\}$`).test(n.block.getText(VO.sf).trim()) ? "dung" : `sai: ${n.block.getText(VO.sf).trim().slice(0, 60)}`);
      }
    });
    expect(catchs).toEqual(["dung"]);
  });
  it("★★★ `finally`: `if (nguoiId !== null) await ghiNhanRoRi(kenh, nguoiId, …)` TRƯỚC `kenh.db = null`; `insert(users)` gọi trên `tx`; không `.delete(` / DELETE / TRUNCATE; `getDb` thật lấy qua `vi.importActual`", () => {
    expect(VO.nguon).toMatch(/finally\s*\{\s*if \(nguoiId !== null\) await ghiNhanRoRi\(kenh, nguoiId, tuyChon\.dem\);\s*kenh\.db = null;/);
    // dọn auth cache cho người dùng thử SAU khi trả kênh, vẫn trong finally (census permissionsDonCache)
    expect(VO.nguon).toMatch(/kenh\.db = null;[\s\S]{0,300}?if \(nguoiId !== null\) await \(await import\("\.\.\/services\/authSessionCache"\)\)\.invalidateAuthUser\(nguoiId\);\s*\}\s*throw new RollbackPhatLai\(\);/);
    expect(VO.nguon).toMatch(/kenh\.db = tx;/);
    let chenQuaTx = false;
    let goiDelete = 0;
    duyet(VO.sf, (n) => {
      if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return;
      if (n.expression.name.text === "delete") goiDelete++;
      if (n.expression.name.text === "insert" && n.arguments[0]?.getText(VO.sf) === "users") chenQuaTx = /^tx\b/.test(n.expression.expression.getText(VO.sf));
    });
    expect(chenQuaTx).toBe(true);
    expect(goiDelete).toBe(0);
    expect(/DELETE\s+FROM|TRUNCATE/i.test(boChuThich(VO.nguon))).toBe(false);
    expect(VO.nguon).toMatch(/vi\.importActual<typeof import\("\.\.\/db\/connection"\)>\("\.\.\/db\/connection"\)/);
  });
});

describe("ba tệp phát lại — dùng vỏ chung, không tự dựng vỏ", () => {
  for (const tep of ["phatLaiFixture.test.ts", "phatLaiLuot.test.ts", "phatLaiFixture.epDo.db.test.ts"]) {
    it(`★★★ ${tep}: gọi trongRollbackPhatLai(kenh, …) đúng 1 lần; không .transaction( / RollbackPhatLai / nuotRollback / catch / vi.importActual / insert(users) / ghiNhanRoRi / taoNguoiDungTest`, () => {
      const T = doc(tep);
      const sach = boChuThich(T.nguon);
      expect((sach.match(/\btrongRollbackPhatLai\(kenh, "/g) ?? []).length).toBe(1);
      expect(sach).toMatch(/from "\.\/__trongRollbackPhatLai"/);
      for (const cam of [/\.transaction\(/, /\bRollbackPhatLai\b/, /\bnuotRollback\b/, /\bcatch\b/, /vi\.importActual/, /\.insert\(users\)/, /\bghiNhanRoRi\b/, /taoNguoiDungTest/]) {
        expect(cam.test(sach), `${tep} tự dựng vỏ: ${cam}`).toBe(false);
      }
      let goiDelete = 0;
      duyet(T.sf, (n) => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "delete") goiDelete++;
      });
      expect(goiDelete).toBe(0);
    });
  }
});
