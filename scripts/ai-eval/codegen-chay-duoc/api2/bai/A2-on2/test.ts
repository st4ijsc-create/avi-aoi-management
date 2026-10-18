import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { DataType } from "node-opcua";
import { batOpcua } from "./opcua.mjs";
import { thuMauThayDoi } from "./sol.mjs";
let m: any;
let hen: any;
const cho = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function choVe0(f: () => number) { for (let i = 0; i < 40 && f() !== 0; i++) await cho(50); return f(); }
before(async () => {
  m = await batOpcua(({ ns, objects }: any) => {
    const v = ns.addVariable({ organizedBy: objects, browseName: "Dem", nodeId: "s=Line1.Dem", dataType: "Int32", minimumSamplingInterval: 20 });
    let n = 100;
    v.setValueFromSource({ dataType: DataType.Int32, value: n });
    hen = setInterval(() => { n += 1; v.setValueFromSource({ dataType: DataType.Int32, value: n }); }, 40);
  });
});
after(async () => { clearInterval(hen); await m?.tat(); });
test("thu dung soMau gia tri tang dan bang subscription, khong tham do", async () => {
  const nodeId = `ns=${m.ns.index};s=Line1.Dem`;
  const doc0 = m.yeuCau.ReadRequest ?? 0;
  const kq = await thuMauThayDoi(m.endpoint, nodeId, 6, 50);
  assert.equal(kq.length, 6);
  for (let i = 0; i < kq.length; i++) assert.equal(typeof kq[i], "number");
  for (let i = 1; i < kq.length; i++) assert.ok(kq[i] > kq[i - 1], `phai tang dan: ${kq}`);
  assert.ok(kq[0] >= 100);
  assert.ok((m.yeuCau.CreateSubscriptionRequest ?? 0) >= 1, "phai tao subscription");
  assert.ok((m.yeuCau.CreateMonitoredItemsRequest ?? 0) >= 1, "phai tao monitored item");
  assert.equal((m.yeuCau.ReadRequest ?? 0) - doc0, 0, "khong duoc tham do bang session.read");
  assert.equal(await choVe0(m.soSubscription), 0, "subscription phai ket thuc");
  assert.equal(await choVe0(m.soPhien), 0, "phien phai dong");
  assert.equal(await choVe0(m.soKenh), 0, "phai ngat ket noi");
});
test("soMau 1 ⇒ chi gia tri khoi dau", async () => {
  const kq = await thuMauThayDoi(m.endpoint, `ns=${m.ns.index};s=Line1.Dem`, 1, 50);
  assert.equal(kq.length, 1);
  assert.equal(await choVe0(m.soPhien), 0);
});
