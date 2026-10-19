import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import mqtt from "mqtt";
import { batBroker } from "./mqtt.mjs";
import { ketNoiThietBi } from "./sol.mjs";
let b: any;
const cho = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function docGiuLai(topic: string): Promise<string | null> {
  const c = await mqtt.connectAsync(b.url, { clientId: "kiem-" + Math.random().toString(16).slice(2), clean: true, reconnectPeriod: 0 });
  return new Promise((ok) => {
    const h = setTimeout(() => { c.end(true); ok(null); }, 1500);
    c.on("message", (_t, p, pkt) => { if (pkt.retain) { clearTimeout(h); c.end(true); ok(p.toString()); } });
    c.subscribe(topic, { qos: 1 });
  });
}
before(async () => { b = await batBroker(); });
after(async () => { await b?.tat(); });
test("ket noi: will dung, TRUC_TUYEN giu lai; guiTrangThai; dong sach khong phat will", async () => {
  const thietBi = await ketNoiThietBi(b.url, "M01");
  const cl = b.broker.clients["may-M01"];
  assert.ok(cl, "clientId phai la may-M01");
  assert.equal(cl.clean, true);
  assert.ok(cl.will, "phai khai bao Last Will");
  assert.equal(cl.will.topic, "nhamay/M01/trangthai");
  assert.equal(String(cl.will.payload), "MAT_KET_NOI");
  assert.equal(cl.will.qos, 1);
  assert.equal(cl.will.retain, true);
  assert.equal(await docGiuLai("nhamay/M01/trangthai"), "TRUC_TUYEN");
  await thietBi.guiTrangThai("CHAY");
  assert.equal(await docGiuLai("nhamay/M01/trangthai"), "CHAY");
  await thietBi.dong();
  await cho(300);
  assert.equal(b.broker.clients["may-M01"], undefined, "phai ngat ket noi");
  assert.equal(await docGiuLai("nhamay/M01/trangthai"), "NGOAI_TUYEN", "dong sach thi khong duoc phat will");
});
test("mat ket noi dot ngot ⇒ broker phat will giu lai MAT_KET_NOI", async () => {
  await ketNoiThietBi(b.url, "M02");
  assert.equal(await docGiuLai("nhamay/M02/trangthai"), "TRUC_TUYEN");
  b.broker.clients["may-M02"].conn.destroy();
  await cho(300);
  assert.equal(await docGiuLai("nhamay/M02/trangthai"), "MAT_KET_NOI");
});
