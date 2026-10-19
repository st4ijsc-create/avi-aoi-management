import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { DataType, StatusCodes } from "node-opcua";
import { batOpcua } from "./opcua.mjs";
import { docNhieuBien } from "./sol.mjs";
let m: any;
const cho = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function choVe0(f: () => number) { for (let i = 0; i < 40 && f() !== 0; i++) await cho(50); return f(); }
before(async () => {
  m = await batOpcua(({ ns, objects }: any) => {
    const f = ns.addFolder(objects, { browseName: "Line1" });
    const a = ns.addVariable({ componentOf: f, browseName: "Temp", nodeId: "s=Line1.Temp", dataType: "Double" });
    a.setValueFromSource({ dataType: DataType.Double, value: 21.5 });
    const b = ns.addVariable({ componentOf: f, browseName: "Count", nodeId: "s=Line1.Count", dataType: "Int32" });
    b.setValueFromSource({ dataType: DataType.Int32, value: 42 });
    const c = ns.addVariable({ componentOf: f, browseName: "Hong", nodeId: "s=Line1.Hong", dataType: "Double" });
    c.setValueFromSource({ dataType: DataType.Double, value: 7 }, StatusCodes.BadSensorFailure);
  });
});
after(async () => { await m?.tat(); });
test("doc gop MOT ReadRequest; Good ⇒ so, khac Good ⇒ null; dong phien", async () => {
  const ns = m.ns.index;
  const ids = [`ns=${ns};s=Line1.Temp`, `ns=${ns};s=Line1.Count`, `ns=${ns};s=Line1.Hong`, `ns=${ns};s=Line1.KhongCo`];
  const truoc = m.yeuCau.ReadRequest ?? 0;
  const kq = await docNhieuBien(m.endpoint, ids);
  assert.deepEqual(kq, { [ids[0]]: 21.5, [ids[1]]: 42, [ids[2]]: null, [ids[3]]: null });
  assert.equal((m.yeuCau.ReadRequest ?? 0) - truoc, 1, "phai doc tat ca trong MOT lan session.read");
  assert.equal(await choVe0(m.soPhien), 0, "phien phai duoc dong");
  assert.equal(await choVe0(m.soKenh), 0, "phai ngat ket noi");
});
test("goi lan hai van dung (khong ro tai nguyen)", async () => {
  const ns = m.ns.index;
  const id = `ns=${ns};s=Line1.Count`;
  assert.deepEqual(await docNhieuBien(m.endpoint, [id]), { [id]: 42 });
  assert.equal(await choVe0(m.soPhien), 0);
});
test("may chu khong ton tai ⇒ nem loi nhanh", { timeout: 20000 }, async () => {
  const t0 = Date.now();
  await assert.rejects(() => docNhieuBien("opc.tcp://127.0.0.1:1", ["ns=1;s=X"]));
  assert.ok(Date.now() - t0 < 15000, "khong duoc thu lai vo han");
});
