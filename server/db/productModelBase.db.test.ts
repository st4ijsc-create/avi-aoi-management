/**
 * ★ doc55 PV0 — MỌI đường TẠO `product_models` trong mã sản phẩm phải sinh ĐÚNG MỘT biến thể BASE, trong CÙNG giao dịch với model (2026-10-23).
 *
 * Trước đây `productModel.create` / `createProductModel` / clone / nhập gói / PLM không tạo BASE ⇒ model mồ côi ngay khi tạo (đo: 6.081 model sống thiếu BASE ở `_test`).
 * Chạy trên CSDL `_test` thật; mỗi ca chỉ khẳng định trên model do chính nó tạo (CSDL dùng chung).
 * Đột biến: bỏ lời gọi `insertBaseVariantInTx` khỏi `createProductModel` ⇒ ca 1, 3, 4 đỏ; bỏ khỏi `cloneProductModel` ⇒ ca clone đỏ.
 */
import { describe, expect, it, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "./connection";
import { cloneProductModel, createProductModel, ensureSystemProductModel } from "./product";
import { importProductPackage, exportProductPackage } from "../services/productPackageService";
import { productModelRouter } from "../routers/productRouters";
import { productModels, productVariants } from "../../drizzle/schema";
import { dangKyModelSanPhamTest } from "../testing/modelSanPhamTest";

const conTrongDb = describe.skipIf(!/_test\b/.test(process.env.DATABASE_URL ?? ""));
const TS = `pmb${Date.now()}`;

async function bases(modelId: number) {
  const db = (await getDb())!;
  return db
    .select({ id: productVariants.id, code: productVariants.code, isBase: productVariants.isBase, v: productVariants.pointsConfigVersion })
    .from(productVariants)
    .where(and(eq(productVariants.productModelId, modelId), eq(productVariants.isBase, true), isNull(productVariants.deletedAt)));
}
async function modelRows(code: string) {
  const db = (await getDb())!;
  return db.select({ id: productModels.id }).from(productModels).where(eq(productModels.code, code));
}

conTrongDb("doc55 PV0 — model mới luôn có đúng một BASE", () => {
  it("★ createProductModel ⇒ đúng 1 BASE sống, code 'BASE', version = của model", async () => {
    const id = dangKyModelSanPhamTest(await createProductModel({ code: `${TS}-a`, name: "pmb a" }));
    expect(await bases(id)).toEqual([{ id: expect.any(Number), code: "BASE", isBase: true, v: 1 }]);
  });

  it("★ tRPC productModel.create ⇒ đúng 1 BASE (đường người dùng thật)", async () => {
    const caller = productModelRouter.createCaller({
      user: { id: 1, role: "admin", twoFactorEnabled: true, name: "PMB" },
      req: { ip: null, headers: {} },
    } as never);
    const res = await caller.create({ code: `${TS}-r`, name: "pmb router" });
    dangKyModelSanPhamTest(res.id);
    expect((await bases(res.id)).map((b) => b.code)).toEqual(["BASE"]);
  });

  it("★ lỗi GIỮA CHỪNG (tạo BASE hỏng) ⇒ model cũng bị hoàn tác, không còn mồ côi", async () => {
    const db = (await getDb())!;
    const goc = db.transaction.bind(db);
    const code = `${TS}-fail`;
    const spy = vi.spyOn(db, "transaction").mockImplementation(((fn: (tx: unknown) => Promise<unknown>, ...r: unknown[]) =>
      (goc as (...a: unknown[]) => Promise<unknown>)(
        (tx: Record<string, unknown>) =>
          fn(
            new Proxy(tx, {
              get(t, p, rcv) {
                if (p === "insert") {
                  return (tbl: unknown) => {
                    if (tbl === productVariants) throw new Error("PMB: tạo BASE hỏng");
                    return (t.insert as (x: unknown) => unknown)(tbl);
                  };
                }
                return Reflect.get(t, p, rcv);
              },
            }),
          ),
        ...r,
      )) as never);
    try {
      await expect(createProductModel({ code, name: "pmb fail" })).rejects.toThrow(/BASE hỏng|Failed query|PMB/);
    } finally {
      spy.mockRestore();
    }
    expect(await modelRows(code)).toEqual([]);
  });

  it("★ trùng mã ⇒ vẫn lỗi trùng như cũ và không để lại BASE thừa", async () => {
    const id = dangKyModelSanPhamTest(await createProductModel({ code: `${TS}-dup`, name: "pmb dup" }));
    await expect(createProductModel({ code: `${TS}-dup`, name: "pmb dup 2" })).rejects.toBeTruthy();
    expect(await bases(id)).toHaveLength(1);
  });

  it("★ ensureSystemProductModel (sentinel) + chạy lại ⇒ vẫn đúng 1 BASE", async () => {
    const a = dangKyModelSanPhamTest(await ensureSystemProductModel({ code: `${TS}-sys`, name: "pmb sys" }));
    const b = await ensureSystemProductModel({ code: `${TS}-sys`, name: "pmb sys" });
    expect(b).toBe(a);
    expect(await bases(a)).toHaveLength(1);
  });

  it("★ cloneProductModel ⇒ bản sao có đúng 1 BASE", async () => {
    const src = dangKyModelSanPhamTest(await createProductModel({ code: `${TS}-src`, name: "pmb src" }));
    const r = await cloneProductModel({ sourceId: src, newCode: `${TS}-clone` });
    dangKyModelSanPhamTest(r.newProductId);
    expect(await bases(r.newProductId)).toHaveLength(1);
  });

  it("★ importProductPackage ⇒ model nhập có đúng 1 BASE", async () => {
    const src = dangKyModelSanPhamTest(await createProductModel({ code: `${TS}-psrc`, name: "pmb psrc" }));
    const pkg = await exportProductPackage(src);
    const r = await importProductPackage(pkg, { newCode: `${TS}-pimp` });
    const id = dangKyModelSanPhamTest(r.productModelId);
    expect(await bases(id)).toHaveLength(1);
  });
});
