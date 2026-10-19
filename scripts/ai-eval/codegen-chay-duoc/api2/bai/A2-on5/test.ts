import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { batModbus } from "./modbus.mjs";
import { docNhietDo } from "./sol.mjs";
let m: any;
const cho = (ms: number) => new Promise((r) => setTimeout(r, ms));
const giaTri: number[] = Array.from({ length: 80 }, (_, i) => Math.round((i * 13.37 - 250.5 + (i % 7) * 0.01) * 100) / 100);
function ghiCDAB(dia: number, x: number) {
  const bf = Buffer.alloc(4); bf.writeFloatBE(x, 0);
  m.hr[dia] = bf.readUInt16BE(2); m.hr[dia + 1] = bf.readUInt16BE(0);
}
before(async () => {
  m = await batModbus({ unitID: 7 });
  giaTri.forEach((x, i) => ghiCDAB(200 + 2 * i, x));
  ghiCDAB(0, 21.37); ghiCDAB(2, -5.5); ghiCDAB(4, 1234.56);
});
after(async () => { await m?.tat(); });
test("3 kenh CDAB tai dia chi 0", async () => {
  assert.deepEqual(await docNhietDo(m.host, m.port, 7, 0, 3), [21.37, -5.5, 1234.56]);
});
test("80 kenh = 160 thanh ghi ⇒ phai chia lenh <= 125, khong cat doi gia tri", async () => {
  m.nhatKy.length = 0;
  const kq = await docNhietDo(m.host, m.port, 7, 200, 80);
  assert.deepEqual(kq, giaTri);
  assert.ok(m.nhatKy.length >= 2, "phai nhieu lenh doc");
  for (const l of m.nhatKy) { assert.ok(l.n <= 125, `lenh doc ${l.n} thanh ghi vuot 125`); assert.equal(l.n % 2, 0); assert.equal((l.dia - 200) % 2, 0); }
});
test("dong ket noi sau moi lan doc", async () => {
  await docNhietDo(m.host, m.port, 7, 0, 1);
  let n = -1;
  for (let i = 0; i < 20; i++) { n = await m.soKetNoi(); if (n === 0) break; await cho(50); }
  assert.equal(n, 0, "con ket noi treo");
});
