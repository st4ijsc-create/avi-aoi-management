/**
 * `mqttDocHet` — aedes thật + WebSocket thật + mqtt.js thật, không CSDL. mqtt.js chia CONNECT thành nhiều frame WebSocket
 * nên đây đúng là đường bị kẹt trên Node 26. `mqttBrokerAdmission.db.test.ts` đo tiếp qua `initMqttBroker` với xác thực thật.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Duplex } from "node:stream";
import Aedes from "aedes";
import { createServer } from "aedes-server-factory";
import mqtt from "mqtt";
import { boDocHetVaoBroker, docHetMoiLan } from "./mqttDocHet";

type XacThuc = ConstructorParameters<typeof Aedes>[0];
type KetQua = { ok: boolean; code?: unknown; loi?: string };

const donDep: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const d of donDep.splice(0)) await d();
});

function dongCoNhieuChunk(): Duplex {
  const s = new Duplex({ read() {}, write(_c, _e, cb) { cb(); } });
  for (const n of [1, 1, 2, 4]) s.push(Buffer.alloc(n));
  return s;
}

async function ketNoiQuaWs(tuyChon: XacThuc, boc: boolean): Promise<KetQua> {
  const broker = new Aedes(tuyChon);
  if (boc) boDocHetVaoBroker(broker);
  const server = createServer(broker, { ws: true });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  donDep.push(async () => {
    await new Promise<void>((r) => broker.close(() => r()));
    await new Promise<void>((r) => server.close(() => r()));
  });
  const { port } = server.address() as { port: number };
  return new Promise<KetQua>((resolve) => {
    const c = mqtt.connect(`ws://127.0.0.1:${port}`, { username: "u", reconnectPeriod: 0, connectTimeout: 1500 });
    c.on("connect", () => {
      c.end(true);
      resolve({ ok: true });
    });
    c.on("error", (e: Error & { code?: unknown }) => {
      c.end(true);
      resolve({ ok: false, code: e.code, loi: e.message });
    });
  });
}

const choQua: XacThuc = { authenticate: (_c, _u, _p, cb) => cb(null, true) };
const tuChoiMa4: XacThuc = {
  authenticate: (_c, _u, _p, cb) => cb(Object.assign(new Error("bad"), { returnCode: 4 }) as never, false),
};

describe("docHetMoiLan", () => {
  it("★★★ read(null) và read() rút HẾT buffer nhiều chunk, bất kể bản Node", () => {
    for (const doc of [(s: Duplex) => s.read(null as never), (s: Duplex) => s.read()]) { // aedes gọi read(null), kiểu Node chỉ khai number
      const s = docHetMoiLan(dongCoNhieuChunk());
      expect(doc(s)?.length).toBe(8);
      expect(s.readableLength).toBe(0);
      expect(doc(s)).toBeNull();
    }
  });
  it("★ read(n) giữ nguyên nghĩa", () => {
    const s = docHetMoiLan(dongCoNhieuChunk());
    expect(s.read(3)?.length).toBe(3);
    expect(s.readableLength).toBe(5);
  });
});

describe("broker aedes qua ws:// với CONNECT nhiều frame", () => {
  it("★★★ tài khoản đúng ⇒ CONNACK, kết nối được", async () => {
    expect(await ketNoiQuaWs(choQua, true)).toEqual({ ok: true });
  });
  it("★★★ bị từ chối ⇒ client nhận ĐÚNG mã CONNACK 4, không phải 'connack timeout'", async () => {
    const r = await ketNoiQuaWs(tuChoiMa4, true);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(4);
  });
  it.runIf(Number(process.versions.node.split(".")[0]) >= 26)("★★ đối chứng trên Node ≥ 26: bỏ lớp bọc ⇒ kẹt, đúng triệu chứng", async () => {
    expect(await ketNoiQuaWs(choQua, false)).toMatchObject({ ok: false, loi: "connack timeout" });
  });
  it("★★★ initMqttBroker bọc broker NGAY sau khi tạo, trước khi mở listener", () => {
    const src = readFileSync(join(process.cwd(), "server/services/mqttService.ts"), "utf8");
    const tao = src.indexOf("aedes = new Aedes();");
    const boc = src.indexOf("boDocHetVaoBroker(aedes);");
    expect(tao).toBeGreaterThan(-1);
    expect(boc).toBeGreaterThan(tao);
    expect(boc).toBeLessThan(src.indexOf("createServer(aedes"));
  });
});
