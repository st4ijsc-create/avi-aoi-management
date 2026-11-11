// node --test scripts/ai-eval/codegen-chay-duoc/agent-f/khachAgent.test.mjs — không gọi máy chủ thật.
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { chayAgent, tomTatBuocDo } from "./khachAgent.mjs";

const bd = (luot, them = {}) => ({ loai: "buoc-do", luot, bamHeThong: "aaaa1111", soTin: 2 * luot, tokenUoc: 1000 * luot, nen: null, nhacDaChen: [], ...them });

test("tomTatBuocDo: đếm lượt, nén, cứu tràn, đổi băm; đỉnh token; cache chỉ cộng lượt đo được", () => {
  const t = tomTatBuocDo([
    bd(1, { vaoThat: 900, cacheN: 0, promptN: 900 }),
    bd(2, { vaoThat: 2100, cacheN: 800, promptN: 1300 }),
    bd(3, { bamHeThong: "bbbb2222", nen: { soNen: 1, tokenTruoc: 5000, tokenSau: 2000 }, cuuTran: true, vaoThat: 1800 }),
    bd(4, { bamHeThong: "bbbb2222", tokenUoc: 7000, cacheN: 1500, promptN: 200 }),
    { loai: "usage", vao: 1, ra: 1 },
  ]);
  assert.deepEqual(t, {
    soBuocDo: 4,
    luotMax: 4,
    soNen: 1,
    soCuuTran: 1,
    soDoiBam: 1,
    tokenUocDinh: 7000,
    vaoThatDinh: 2100,
    soCoCache: 3,
    cacheNTong: 2300,
    promptNTong: 2400,
  });
});

test("tomTatBuocDo: không có buoc-do (hoặc đầu vào hỏng) ⇒ null, không phải 0", () => {
  for (const x of [[], undefined, null, "x", [{ loai: "usage" }], [{ loai: "buoc-do" }], [{ loai: "buoc-do", luot: "1" }]]) assert.equal(tomTatBuocDo(x), null);
});

test("tomTatBuocDo: thiếu cacheN hoặc promptN, hoặc số âm/NaN ⇒ lượt đó KHÔNG BIẾT, không cộng; vaoThat vắng hết ⇒ null", () => {
  const t = tomTatBuocDo([bd(1, { cacheN: 500 }), bd(2, { promptN: 300 }), bd(3, { cacheN: -1, promptN: 10 }), bd(4, { cacheN: Number.NaN, promptN: 1 })]);
  assert.equal(t.soCoCache, 0);
  assert.equal(t.cacheNTong, 0);
  assert.equal(t.promptNTong, 0);
  assert.equal(t.vaoThatDinh, null);
});

test("chayAgent: sự kiện buoc-do từ SSE (kể cả bọc {seq, suKien}) vào g.buocDo; không giữ mã khối chèn hay nội dung", async () => {
  const sv = http.createServer((req, res) => {
    res.setHeader("content-type", "text/event-stream");
    const gui = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    gui({ seq: 1, suKien: { loai: "bat-dau", runId: "r1" } });
    gui({ seq: 2, suKien: bd(1, { vaoThat: 1200, cacheN: 100, promptN: 1100, nhacDaChen: ["kiem-dac-ta"] }) });
    // lượt 4 sau lượt 1: buoc-do của lượt 2–3 không tới client (vd. bị lọc) ⇒ luotMax là số lượt, không phải số sự kiện
    gui(bd(4, { nen: { soNen: 1, tokenTruoc: 9000, tokenSau: 3000 }, vaoThat: 3100, cacheN: 2000, promptN: 1100 }));
    gui({ seq: 4, suKien: { loai: "xong", lyDo: "hoan-thanh" } });
    res.end();
  });
  await new Promise((r) => sv.listen(0, "127.0.0.1", r));
  const g = await chayAgent({ base: `http://127.0.0.1:${sv.address().port}`, cookie: "a=b", cauHoi: "x", projectId: "p", tranMs: 10_000 });
  sv.close();
  assert.equal(g.lyDo, "hoan-thanh");
  assert.deepEqual(g.buocDo, { soBuocDo: 2, luotMax: 4, soNen: 1, soCuuTran: 0, soDoiBam: 0, tokenUocDinh: 4000, vaoThatDinh: 3100, soCoCache: 2, cacheNTong: 2100, promptNTong: 2200 });
  assert.ok(!JSON.stringify(g).includes("kiem-dac-ta"));
});

test("chayAgent: máy chủ không phát buoc-do ⇒ g.buocDo null (hành vi đo cũ không đổi)", async () => {
  const sv = http.createServer((req, res) => {
    res.write(`data: ${JSON.stringify({ loai: "bat-dau", runId: "r2" })}\n\n`);
    res.end(`data: ${JSON.stringify({ loai: "xong", lyDo: "hoan-thanh" })}\n\n`);
  });
  await new Promise((r) => sv.listen(0, "127.0.0.1", r));
  const g = await chayAgent({ base: `http://127.0.0.1:${sv.address().port}`, cookie: "a=b", cauHoi: "x", projectId: "p", tranMs: 10_000 });
  sv.close();
  assert.equal(g.buocDo, null);
  assert.equal(g.runId, "r2");
});
