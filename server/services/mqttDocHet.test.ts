/**
 * `mqttDocHet` — aedes thật, WebSocket + TCP thật, không CSDL. mqtt.js chia CONNECT thành nhiều frame WebSocket
 * nên đây đúng là đường bị kẹt trên Node 26. `mqttBrokerAdmission.db.test.ts` đo tiếp qua `initMqttBroker` với xác thực thật.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { connect as ketNoiTcp } from "node:net";
import { join } from "node:path";
import { Duplex } from "node:stream";
import Aedes from "aedes";
import { createServer } from "aedes-server-factory";
import mqtt from "mqtt";
import mqttPacket from "mqtt-packet";
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

/**
 * TCP: xác thực bất đồng bộ như CSDL thật. Trong lúc chờ, aedes không đọc nên PUBLISH QoS1 chia 5 mảnh chất trong buffer của socket.
 * Trả "PUBACK", hoặc "ket" nếu không có PUBACK sau 800 ms.
 */
async function publishNhieuManhQuaTcp(boc: boolean): Promise<"PUBACK" | "ket"> {
  const broker = new Aedes({ authenticate: (_c, _u, _p, cb) => void setTimeout(() => cb(null, true), 80) });
  if (boc) boDocHetVaoBroker(broker);
  const server = createServer(broker);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  donDep.push(async () => {
    await new Promise<void>((r) => broker.close(() => r()));
    await new Promise<void>((r) => server.close(() => r()));
  });
  const { port } = server.address() as { port: number };
  const goiKetNoi = mqttPacket.generate({ cmd: "connect", protocolId: "MQTT", protocolVersion: 4, clean: true, clientId: "doc-het", keepalive: 60, username: "u" });
  const goiPublish = mqttPacket.generate({ cmd: "publish", topic: "a/b", payload: Buffer.alloc(300, 1), qos: 1, messageId: 7, retain: false, dup: false });
  const cho = (ms: number) => new Promise((r) => setTimeout(r, ms));
  return new Promise((resolve) => {
    const s = ketNoiTcp(port, "127.0.0.1");
    s.setNoDelay(true);
    s.on("error", () => undefined);
    const hetGio = setTimeout(() => {
      s.destroy();
      resolve("ket");
    }, 800);
    const parser = mqttPacket.parser({ protocolVersion: 4 });
    parser.on("packet", (g) => {
      if (g.cmd !== "puback") return;
      clearTimeout(hetGio);
      s.destroy();
      resolve("PUBACK");
    });
    s.on("data", (d) => parser.parse(d));
    s.on("connect", async () => {
      s.write(goiKetNoi);
      await cho(10);
      const manh = Math.ceil(goiPublish.length / 5);
      for (let i = 0; i < goiPublish.length; i += manh) {
        s.write(goiPublish.subarray(i, i + manh));
        await cho(5);
      }
    });
  });
}

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
  it("★★★ TCP: gói chia nhiều mảnh chất trong buffer lúc xác thực ⇒ vẫn nhận đủ, có PUBACK", async () => {
    expect(await publishNhieuManhQuaTcp(true)).toBe("PUBACK");
  });
  it.runIf(Number(process.versions.node.split(".")[0]) >= 26)("★★ đối chứng TCP trên Node ≥ 26: bỏ lớp bọc ⇒ kẹt", async () => {
    expect(await publishNhieuManhQuaTcp(false)).toBe("ket");
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
