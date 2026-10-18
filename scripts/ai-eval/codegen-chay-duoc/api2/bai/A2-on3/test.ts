import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { DataType, StatusCodes, Variant } from "node-opcua";
import { batOpcua } from "./opcua.mjs";
import { goiLenh } from "./sol.mjs";
let m: any;
const cho = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function choVe0(f: () => number) { for (let i = 0; i < 40 && f() !== 0; i++) await cho(50); return f(); }
const nhan: any[] = [];
before(async () => {
  m = await batOpcua(({ ns, objects }: any) => {
    const may = ns.addObject({ organizedBy: objects, browseName: "May1", nodeId: "s=May1" });
    const pt = ns.addMethod(may, {
      browseName: "DatToc", nodeId: "s=May1.DatToc",
      inputArguments: [
        { name: "toc", dataType: DataType.Double, description: "vong/phut" },
        { name: "chieuThuan", dataType: DataType.Boolean, description: "chieu" },
      ],
      outputArguments: [{ name: "ketQua", dataType: DataType.String, description: "ket qua" }],
    });
    pt.bindMethod(async (vao: Variant[], _ngCanh: unknown) => {
      nhan.push(vao.map((v) => v.dataType));
      const toc = vao[0].value as number;
      if (toc > 3000) return { statusCode: StatusCodes.BadOutOfRange };
      return { statusCode: StatusCodes.Good, outputArguments: [{ dataType: DataType.String, value: `OK ${toc} ${vao[1].value ? "THUAN" : "NGHICH"}` }] };
    });
  });
});
after(async () => { await m?.tat(); });
test("goi thanh cong voi toc so nguyen: phai gui dung Double + Boolean", async () => {
  const ns = m.ns.index;
  const r = await goiLenh(m.endpoint, `ns=${ns};s=May1`, `ns=${ns};s=May1.DatToc`, 1500, true);
  assert.equal(r.ma, "Good");
  assert.equal(r.ok, true);
  assert.equal(r.ketQua, "OK 1500 THUAN");
  assert.deepEqual(nhan.at(-1), [DataType.Double, DataType.Boolean]);
  assert.equal(await choVe0(m.soPhien), 0, "phien phai dong");
});
test("loi phia may chu ⇒ ok false, ma = ten statusCode, khong co ketQua", async () => {
  const ns = m.ns.index;
  const r = await goiLenh(m.endpoint, `ns=${ns};s=May1`, `ns=${ns};s=May1.DatToc`, 3500.5, false);
  assert.equal(r.ok, false);
  assert.equal(r.ma, "BadOutOfRange");
  assert.equal(r.ketQua, undefined);
  const r2 = await goiLenh(m.endpoint, `ns=${ns};s=May1`, `ns=${ns};s=May1.DatToc`, 12.5, false);
  assert.equal(r2.ketQua, "OK 12.5 NGHICH");
  assert.equal(await choVe0(m.soPhien), 0);
  assert.equal(await choVe0(m.soKenh), 0);
});
