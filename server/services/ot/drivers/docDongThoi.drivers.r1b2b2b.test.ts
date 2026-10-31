/**
 * SCADA R1b-2b-2b A C4 (mục 5) Step 1 — CỔNG ĐỌC ĐỒNG THỜI cho Lab "thử đọc một địa chỉ" (`scadaDiag.thuDocDiaChi`).
 *
 * Câu hỏi (kiem-dinh KD-2bA 4.2 / 4.3): một lượt Lab đọc trên phiên ĐANG CHẠY, song song với vòng poll và với lời ghi STOP, có
 *   (a/b) làm một lần đọc của poll trả SAI giá trị / sai tag khi trả lời tới chậm hoặc ĐẢO thứ tự?
 *   (c)   trì hoãn lời ghi STOP khi lượt Lab đang treo (peer im lặng với riêng yêu cầu đó)?
 *   (4.3) làm lệch trạng thái dùng chung của driver (`health()`: lastOkAt / lastError / latencyMs; phiên / kết nối)?
 * Chỉ giao thức qua CẢ BA mới vào `GIAO_THUC_THU_DOC`. Mọi phép đo dùng THƯ VIỆN THẬT (không thư viện giả) trên peer viết tay trong tiến trình (127.0.0.1,
 * cổng OS cấp): modbus-serial 8.0.25 · node-opcua 2.174.0 (máy chủ node-opcua thật) · st-ethernet-ip 2.7.5 · SLMP (driver tự viết trên node:net).
 * S7 (nodes7) / MC (mcprotocol): điều phối Q1 — không chứng minh được (danh sách item DÙNG CHUNG của kết nối: `setTranslationCB` / `addItems`) ⇒ LOẠI,
 * không đo ở đây. STOP đi đường THẬT `executeOtDeviceWrite` (như dispatcher). Cận đồng hồ tường dùng `batDauDoLag`.
 */
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { batDauDoLag } from "../../../testing/doLagBucleSuKien";
import { executeOtDeviceWrite, _resetAdapterCommandQueuesForTests, _sweepStaleWriteRiskForTests, type ExecutedWrite } from "../otDeviceWrite";
import type { OtDriver, OtSample, OtTagAddress } from "../otDriver";
import { GIAO_THUC_THU_DOC } from "../thuDocDiaChi";

const require_ = createRequire(import.meta.url);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Ngưỡng STOP hiện hành của các lưới đường ghi (modbusDriver.ghiMoCoi.repro: STOP được ack trên LAN giả < 500 ms). */
const NGUONG_STOP_MS = 500;

const don: Array<() => unknown> = [];
afterEach(async () => {
  while (don.length) await don.pop()!();
  _resetAdapterCommandQueuesForTests();
  _sweepStaleWriteRiskForTests(Number.MAX_SAFE_INTEGER);
});

let soAdapter = 997_000;
/** STOP qua đường ghi THẬT (executeOtDeviceWrite), đo ms. */
async function stop(driver: OtDriver, address: string, dataType: "int" | "bool", value: unknown): Promise<{ ex: ExecutedWrite; ms: number }> {
  const adapterId = ++soAdapter;
  const t0 = performance.now();
  const ex = await executeOtDeviceWrite({
    input: { adapterId, machineId: null, commandType: "stop", idempotencyKey: `c4-${adapterId}`, writes: [{ tagKey: "stop", value }] } as any,
    driver,
    resolved: [{ write: { tagKey: "stop", value }, address, dataType }] as any,
    driverWrites: [{ tagKey: "stop", address, value, dataType }] as any,
    timeoutMs: 5000,
    stopTyped: true,
    bumpStopEpoch: true,
    ledger: { intentIds: [1], confirmedBy: 1 },
  });
  return { ex, ms: Math.round(performance.now() - t0) };
}

const hinhHealth = async (d: OtDriver) => {
  const h = await d.health();
  return { connected: h.connected, lastOkAt: h.lastOkAt?.getTime() ?? null, lastError: h.lastError ?? null, latencyMs: h.latencyMs ?? null };
};

/** Số cặp (i<j) mà yêu cầu i gửi TRƯỚC j nhưng trả lời SAU j — > 0 ⇒ thật sự có đảo thứ tự (phép đo không rỗng). */
function soCapDao(guiTheoThuTu: ReadonlyArray<number | string>, traTheoThuTu: ReadonlyArray<number | string>): number {
  // C4 fix 1 (review M1) — khoá phải DUY NHẤT (Map giữ vị trí CUỐI của khoá lặp ⇒ khoá lặp làm phép đo rỗng)
  if (new Set(guiTheoThuTu).size !== guiTheoThuTu.length || new Set(traTheoThuTu).size !== traTheoThuTu.length) throw new Error("soCapDao: khoá không duy nhất");
  const viTri = new Map(traTheoThuTu.map((id, i) => [id, i] as const));
  let n = 0;
  for (let i = 0; i < guiTheoThuTu.length; i++) {
    for (let j = i + 1; j < guiTheoThuTu.length; j++) {
      const a = viTri.get(guiTheoThuTu[i]);
      const b = viTri.get(guiTheoThuTu[j]);
      if (a !== undefined && b !== undefined && a > b) n += 1;
    }
  }
  return n;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// MODBUS TCP — modbus-serial 8.0.25 THẬT, máy chủ Modbus TCP viết tay (MBAP + FC1/FC3/FC5), độ trễ theo THANH GHI để đảo thứ tự trả lời
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const giaTriThanhGhi = (reg: number) => (reg * 7 + 3) & 0x7fff;

interface MbSim {
  port: number;
  /** tid theo thứ tự NHẬN / thứ tự TRẢ LỜI */
  nhan: Array<{ tid: number; fc: number; reg: number }>;
  tra: number[];
  coil: { v: number };
  /** trễ (ms) hoặc "im_lang" (không bao giờ trả lời yêu cầu này, KHÔNG đóng socket); "loi" ⇒ exception 2 */
  tre: (fc: number, reg: number) => number | "im_lang" | "loi";
  close(): Promise<void>;
}

async function startMb(): Promise<MbSim> {
  const socks = new Set<net.Socket>();
  const sim: MbSim = { port: 0, nhan: [], tra: [], coil: { v: 0 }, tre: () => 0, close: async () => undefined };
  const srv = net.createServer((s) => {
    socks.add(s);
    s.on("close", () => socks.delete(s));
    s.on("error", () => undefined);
    let buf = Buffer.alloc(0);
    s.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 7) {
        const len = buf.readUInt16BE(4);
        if (buf.length < 6 + len) return;
        const f = Buffer.from(buf.subarray(0, 6 + len));
        buf = buf.subarray(6 + len);
        const tid = f.readUInt16BE(0);
        const unit = f[6];
        const fc = f[7];
        const reg = f.readUInt16BE(8);
        sim.nhan.push({ tid, fc, reg });
        const gui = (pdu: Buffer) => {
          const h = Buffer.alloc(7);
          h.writeUInt16BE(tid, 0);
          h.writeUInt16BE(0, 2);
          h.writeUInt16BE(pdu.length + 1, 4);
          h[6] = unit;
          if (s.destroyed) return;
          sim.tra.push(tid);
          s.write(Buffer.concat([h, pdu]));
        };
        const t = sim.tre(fc, reg);
        if (t === "im_lang") continue;
        let pdu: Buffer;
        if (t === "loi") pdu = Buffer.from([fc | 0x80, 2]);
        else if (fc === 3) {
          const n = f.readUInt16BE(10);
          pdu = Buffer.alloc(2 + n * 2);
          pdu[0] = 3;
          pdu[1] = n * 2;
          for (let i = 0; i < n; i++) pdu.writeUInt16BE(giaTriThanhGhi(reg + i), 2 + i * 2);
        } else if (fc === 1) pdu = Buffer.from([1, 1, sim.coil.v & 1]);
        else if (fc === 5) {
          sim.coil.v = f.readUInt16BE(10) === 0xff00 ? 1 : 0;
          pdu = Buffer.from(f.subarray(7, 12));
        } else pdu = Buffer.from([fc | 0x80, 1]);
        const ms = typeof t === "number" ? t : 0;
        if (ms > 0) setTimeout(() => gui(pdu), ms);
        else gui(pdu);
      }
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  sim.port = (srv.address() as net.AddressInfo).port;
  sim.close = () =>
    new Promise<void>((r) => {
      for (const x of socks) x.destroy();
      srv.close(() => r());
    });
  return sim;
}

async function moModbus(sim: MbSim, timeoutMs = 2000) {
  const { ModbusDriver } = await import("./modbusDriver");
  const d = new ModbusDriver();
  don.push(() => sim.close(), () => d.disconnect());
  await d.connect({ endpoint: `tcp://127.0.0.1:${sim.port}`, timeoutMs, options: { unitId: 1 } } as any);
  return d;
}

const mbTag = (tagKey: string, reg1: number): OtTagAddress => ({ tagKey, address: String(40001 + reg1), dataType: "int" });

describe("Modbus TCP (modbus-serial 8.0.25 THẬT) — ĐẠT ⇒ trong GIAO_THUC_THU_DOC", () => {
  it("(a) driver CHỈ nói Modbus TCP (connectTCP — transaction-id MBAP); không RTU / serial / RTU-over-TCP; setID chỉ ở connect, docLab không đụng", () => {
    const src = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "modbusDriver.ts"), "utf8");
    expect(src).toMatch(/client\.connectTCP\(/);
    expect(src).not.toMatch(/connect(RTU|RTUBuffered|TcpRTU|TcpRTUBuffered|Telnet|C701|UDP|AsciiSerial)\s*\(/);
    expect(src.match(/\.setID\(/g)?.length).toBe(1);
    const lab = src.slice(src.indexOf("async docLab("), src.indexOf("async docLab(") + 400);
    expect(lab).not.toMatch(/setID|connect\s*\(|writeTags|lastOkAt =|lastError =|lastLatencyMs =/);
    expect(require_("modbus-serial/package.json").version).toBe("8.0.25");
  });

  it("★ (a/b) poll 3 tag + 20 lượt Lab xen giữa, trả lời trễ khác nhau ĐẢO thứ tự ⇒ MỌI mẫu poll đúng giá trị/đúng tag; mọi mẫu Lab đúng địa chỉ", async () => {
    const sim = await startMb();
    // poll: thanh ghi 0..2; Lab: 10..29 — trễ khác nhau để trả lời tới NGƯỢC thứ tự gửi
    const trePoll = [25, 3, 14];
    sim.tre = (_fc, reg) => (reg < 3 ? trePoll[reg] : [1, 37, 6, 22, 0, 30, 9, 2][reg % 8]);
    const d = await moModbus(sim);
    const mauPoll: OtSample[] = [];
    const tagPoll = [mbTag("p0", 0), mbTag("p1", 1), mbTag("p2", 2)];
    const h = await d.subscribe(tagPoll, (s) => void mauPoll.push(s), 20);
    don.push(() => h.close());
    const lab: Array<Promise<{ reg: number; s: OtSample[] }>> = [];
    for (let i = 0; i < 20; i++) {
      const reg = 10 + i;
      // từng cặp đồng thời (Lab không bao giờ chờ poll) — trễ cách quãng để rơi vào giữa các lần đọc của poll
      lab.push(d.docLab([mbTag(`lab${i}`, reg)]).then((s) => ({ reg, s })));
      if (i % 2 === 1) await sleep(11);
    }
    const kqLab = await Promise.all(lab);
    await sleep(120);
    await h.close();
    const sai = mauPoll.filter((s) => {
      const reg = Number(s.tagKey.slice(1));
      return s.quality !== "good" || s.value !== giaTriThanhGhi(reg);
    });
    const saiLab = kqLab.filter(({ reg, s }) => s.length !== 1 || s[0].tagKey !== `lab${reg - 10}` || s[0].quality !== "good" || s[0].value !== giaTriThanhGhi(reg));
    const dao = soCapDao(
      sim.nhan.map((x) => x.tid),
      sim.tra,
    );
    // eslint-disable-next-line no-console
    console.log("[C4 modbus a/b]", JSON.stringify({ mauPoll: mauPoll.length, sai: sai.length, lab: kqLab.length, saiLab: saiLab.length, yeuCau: sim.nhan.length, capDao: dao }));
    expect(dao, "phép đo phải thật sự có trả lời đảo thứ tự").toBeGreaterThan(0);
    expect(mauPoll.length).toBeGreaterThanOrEqual(9);
    expect(sai).toEqual([]);
    expect(saiLab).toEqual([]);
  }, 15_000);

  it("★ (c) lượt Lab TREO (peer im lặng với riêng yêu cầu đó) ⇒ STOP vẫn được ack ≤ ngưỡng (đo cả nền không Lab); phiên còn nguyên, poll đọc tiếp", async () => {
    const sim = await startMb();
    sim.tre = (fc, reg) => (fc === 3 && reg === 49 ? "im_lang" : fc === 5 ? 4 : 2);
    const d = await moModbus(sim, 1500);
    const nen = await stop(d, "coil:1", "int", 1);
    expect(nen.ex.outcomes[0].ok).toBe(true);
    sim.coil.v = 0;
    let labXong = false;
    const pLab = d.docLab([mbTag("lab", 49)]).then((s) => ((labXong = true), s));
    while (!sim.nhan.some((x) => x.reg === 49)) await sleep(2);
    const lag = batDauDoLag();
    const r = await stop(d, "coil:1", "int", 1);
    const lagMs = await lag.dung(200);
    const labConTreo = !labXong;
    const s = await pLab;
    const sau = await d.readTags([mbTag("p0", 0)]);
    // eslint-disable-next-line no-console
    console.log("[C4 modbus c]", JSON.stringify({ stopNenMs: nen.ms, stopKhiLabTreoMs: r.ms, lagMs, labConTreo, lab: s[0].quality, sau: sau[0].quality, ketNoi: d.isConnected() }));
    expect(labConTreo, "STOP phải chạy TRONG lúc Lab đang treo").toBe(true);
    expect(r.ex.outcomes[0].ok).toBe(true);
    expect(sim.coil.v).toBe(1);
    expect(r.ms).toBeLessThanOrEqual(NGUONG_STOP_MS + lagMs);
    expect(s[0].quality).toBe("bad"); // hết hạn giao dịch của thư viện (1500 ms) ⇒ mẫu bad, không ném
    expect(d.isConnected()).toBe(true); // hết hạn một giao dịch không hạ phiên
    expect([sau[0].quality, sau[0].value]).toEqual(["good", giaTriThanhGhi(0)]);
  }, 15_000);

  it("★ (4.3) poll đang HỎNG, Lab đọc OK ⇒ health() KHÔNG đổi (lastOkAt / lastError / latencyMs); đối chứng: readTags thường có đổi", async () => {
    const sim = await startMb();
    sim.tre = (_fc, reg) => (reg === 59 ? "loi" : 0);
    const d = await moModbus(sim);
    const hong = await d.readTags([mbTag("hong", 59)]); // = lần đọc của poll: exception ⇒ lastError, latencyMs
    expect(hong[0].quality).toBe("bad");
    const truoc = await hinhHealth(d);
    expect(truoc.lastError).toMatch(/exception/i);
    await sleep(5);
    const lab = await d.docLab([mbTag("lab", 10)]);
    expect([lab[0].quality, lab[0].value]).toEqual(["good", giaTriThanhGhi(10)]);
    const labHong = await d.docLab([mbTag("lab2", 59)]);
    expect(labHong[0].quality).toBe("bad");
    expect(await hinhHealth(d)).toEqual(truoc);
    await d.readTags([mbTag("p", 10)]);
    expect((await hinhHealth(d)).lastOkAt, "đối chứng: phép đo thấy được thay đổi").not.toBe(truoc.lastOkAt);
  }, 10_000);
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// OPC UA — node-opcua 2.174.0 THẬT (client trong driver + OPCUAServer trong tiến trình); trễ theo node bằng refreshFunc (đọc Value bất đồng bộ)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "c4-opcua-"));
const SAVED_ENV: Record<string, string | undefined> = {};
const ENV_OPCUA = ["APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME", "OPCUA_PKI_DIR", "OPCUA_ALLOW_TRUST_ON_FIRST_USE", "OT_OPCUA_MONITORED_ITEMS"];

interface UaSim {
  url: string;
  ns: number;
  /** trễ (ms) theo tên node; -1 = im lặng tới khi `nha()` */
  tre: Record<string, number>;
  giaTri: (ten: string) => number;
  stop: { v: boolean };
  thuTuGui: string[];
  thuTuTra: string[];
  nha(): void;
}
let ua: UaSim;
let uaServer: any;
let uaCm: any;
const choIm: Array<() => void> = [];

async function startUa(): Promise<UaSim> {
  const o = require_("node-opcua");
  const port = await new Promise<number>((res, rej) => {
    const s = net.createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => res(p));
    });
  });
  uaCm = new o.OPCUACertificateManager({ rootFolder: path.join(TMP, "server-pki"), automaticallyAcceptUnknownCertificate: true });
  await uaCm.initialize();
  uaServer = new o.OPCUAServer({
    port,
    hostname: "127.0.0.1",
    securityModes: [o.MessageSecurityMode.None],
    securityPolicies: [o.SecurityPolicy.None],
    serverCertificateManager: uaCm,
    allowAnonymous: true,
    nodeset_filename: [o.nodesets.standard],
  });
  await uaServer.initialize();
  const as = uaServer.engine.addressSpace;
  const nsp = as.getOwnNamespace();
  const sim: UaSim = {
    url: `opc.tcp://127.0.0.1:${port}`,
    ns: nsp.index,
    tre: {},
    giaTri: (ten) => 1000 + Number(ten.slice(1)) * 13,
    stop: { v: false },
    thuTuGui: [],
    thuTuTra: [],
    nha: () => {
      while (choIm.length) choIm.shift()!();
    },
  };
  const ten = ["P0", "P1", "P2", ...Array.from({ length: 20 }, (_, i) => `L${10 + i}`), "L99"];
  for (const t of ten) {
    nsp.addVariable({
      organizedBy: as.rootFolder.objects,
      browseName: t,
      nodeId: `s=${t}`,
      dataType: "Int32",
      minimumSamplingInterval: 0,
      value: {
        refreshFunc: (cb: (e: Error | null, dv?: unknown) => void) => {
          sim.thuTuGui.push(t);
          const tra = () => {
            sim.thuTuTra.push(t);
            cb(null, new o.DataValue({ value: new o.Variant({ dataType: o.DataType.Int32, value: sim.giaTri(t) }), statusCode: o.StatusCodes.Good, sourceTimestamp: new Date() }));
          };
          const ms = sim.tre[t] ?? 0;
          if (ms < 0) choIm.push(tra);
          else if (ms > 0) setTimeout(tra, ms);
          else tra();
        },
      },
    });
  }
  nsp.addVariable({
    organizedBy: as.rootFolder.objects,
    browseName: "Stop",
    nodeId: "s=Stop",
    dataType: "Boolean",
    accessLevel: "CurrentRead | CurrentWrite",
    userAccessLevel: "CurrentRead | CurrentWrite",
    value: {
      get: () => new o.Variant({ dataType: o.DataType.Boolean, value: sim.stop.v }),
      set: (v: any) => {
        sim.stop.v = v.value === true;
        return o.StatusCodes.Good;
      },
    },
  });
  await uaServer.start();
  return sim;
}

describe("OPC UA (node-opcua 2.174.0 THẬT) — ĐẠT ⇒ trong GIAO_THUC_THU_DOC", () => {
  const kenh = () => require_("node-opcua-secure-channel").ClientSecureChannelLayer;
  let cuMin = 0;
  let cuMacDinh = 0;
  beforeAll(async () => {
    for (const k of ENV_OPCUA) SAVED_ENV[k] = process.env[k];
    delete process.env.OPCUA_ALLOW_TRUST_ON_FIRST_USE;
    delete process.env.OT_OPCUA_MONITORED_ITEMS; // đường POLL (mặc định sản xuất)
    process.env.APPDATA = path.join(TMP, "appdata");
    process.env.LOCALAPPDATA = path.join(TMP, "localappdata");
    process.env.XDG_CONFIG_HOME = path.join(TMP, "xdg");
    process.env.OPCUA_PKI_DIR = path.join(TMP, "client-pki");
    // hết hạn giao dịch của THƯ VIỆN rút xuống 1500 ms (mặc định 15 s, sàn 5 s) chỉ để ca (c) quan sát được hành vi SAU hết hạn trong thời gian test
    cuMin = kenh().minTransactionTimeout;
    cuMacDinh = kenh().defaultTransactionTimeout;
    kenh().minTransactionTimeout = 1000;
    kenh().defaultTransactionTimeout = 1500;
    ua = await startUa();
  }, 90_000);
  afterAll(async () => {
    ua?.nha();
    kenh().minTransactionTimeout = cuMin;
    kenh().defaultTransactionTimeout = cuMacDinh;
    await uaServer?.shutdown(0).catch(() => undefined);
    await uaCm?.dispose().catch(() => undefined);
    for (const [k, v] of Object.entries(SAVED_ENV)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      fs.rmSync(TMP, { recursive: true, force: true });
    } catch {
      // Windows còn khoá tệp PKI — thư mục tạm
    }
  }, 60_000);

  async function moUa(timeoutMs = 4000) {
    ua.tre = {};
    ua.nha();
    ua.thuTuGui.length = 0;
    ua.thuTuTra.length = 0;
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    don.push(() => d.disconnect());
    await d.connect({ endpoint: ua.url, timeoutMs } as any);
    return d;
  }
  const uaTag = (tagKey: string, ten: string): OtTagAddress => ({ tagKey, address: `ns=${ua.ns};s=${ten}`, dataType: "int" });

  it("version", () => {
    expect(require_("node-opcua/package.json").version).toBe("2.174.0");
  });

  it("★ (a/b) poll 3 node + 20 lượt Lab xen giữa, trả lời trễ khác nhau ĐẢO thứ tự ⇒ MỌI mẫu poll đúng giá trị/đúng tag; mọi mẫu Lab đúng node", async () => {
    const d = await moUa();
    ua.tre = { P0: 40, P1: 5, P2: 20 };
    for (let i = 0; i < 20; i++) ua.tre[`L${10 + i}`] = [2, 55, 9, 30, 0, 45, 14, 3][i % 8];
    const mauPoll: OtSample[] = [];
    const h = await d.subscribe([uaTag("p0", "P0"), uaTag("p1", "P1"), uaTag("p2", "P2")], (s) => void mauPoll.push(s), 30);
    don.push(() => h.close());
    const lab: Array<Promise<{ ten: string; s: OtSample[] }>> = [];
    for (let i = 0; i < 20; i++) {
      const ten = `L${10 + i}`;
      lab.push(d.docLab([uaTag(`lab${i}`, ten)]).then((s) => ({ ten, s })));
      if (i % 2 === 1) await sleep(13);
    }
    const kqLab = await Promise.all(lab);
    await sleep(200);
    await h.close();
    const sai = mauPoll.filter((s) => s.quality !== "good" || s.value !== ua.giaTri(`P${s.tagKey.slice(1)}`));
    const saiLab = kqLab.filter(({ ten, s }) => s.length !== 1 || s[0].quality !== "good" || s[0].value !== ua.giaTri(ten));
    // C4 fix 1 (review M1) — đếm đảo CHỈ trên tên node Lab DUY NHẤT (L10..L29); node poll lặp mỗi tick không vào phép đếm
    const laLab = (t: string) => /^L[12]\d$/.test(t);
    const dao = soCapDao(ua.thuTuGui.filter(laLab), ua.thuTuTra.filter(laLab));
    // eslint-disable-next-line no-console
    console.log("[C4 opcua a/b]", JSON.stringify({ mauPoll: mauPoll.length, sai: sai.length, lab: kqLab.length, saiLab: saiLab.length, capDaoLab: dao }));
    expect(dao, "phép đo phải thật sự có trả lời đảo thứ tự").toBeGreaterThan(0);
    expect(mauPoll.length).toBeGreaterThanOrEqual(9);
    expect(sai).toEqual([]);
    expect(saiLab).toEqual([]);
  }, 20_000);

  it("thiết bị đo đảo thứ tự (M1): trễ TĂNG theo thứ tự gửi ⇒ 0 cặp đảo; trễ GIẢM theo thứ tự gửi ⇒ đảo — phép đếm có thể đỏ", async () => {
    const d = await moUa();
    const ten = Array.from({ length: 20 }, (_, i) => `L${10 + i}`);
    const doMot = async (tre: (i: number) => number) => {
      ua.thuTuGui.length = 0;
      ua.thuTuTra.length = 0;
      ten.forEach((t, i) => (ua.tre[t] = tre(i)));
      const kq = await Promise.all(ten.map((t, i) => d.docLab([uaTag(`l${i}`, t)])));
      expect(kq.every((x, i) => x[0].quality === "good" && x[0].value === ua.giaTri(ten[i]))).toBe(true);
      return soCapDao(ua.thuTuGui.filter((t) => ten.includes(t)), ua.thuTuTra.filter((t) => ten.includes(t)));
    };
    const tang = await doMot((i) => 5 + i * 8);
    const giam = await doMot((i) => 5 + (19 - i) * 8);
    // eslint-disable-next-line no-console
    console.log("[C4 opcua M1 thiet bi do]", JSON.stringify({ treTang: tang, treGiam: giam }));
    expect(tang).toBe(0);
    expect(giam).toBeGreaterThan(100);
  }, 20_000);

  it("★ (c) lượt Lab TREO (node im lặng) ⇒ STOP (WriteRequest) vẫn ok ≤ ngưỡng; hết hạn của thư viện KHÔNG hạ kênh; trả lời MUỘN bị bỏ; poll đọc tiếp đúng", async () => {
    const d = await moUa(1000); // hạn driver = 1000 + 1000 ⇒ docLab ném "opcua read timeout after 2000ms"; thư viện tự hết hạn ở 1500 ms
    const nen = await stop(d, `ns=${ua.ns};s=Stop`, "bool", true);
    expect(nen.ex.outcomes[0].ok).toBe(true);
    ua.stop.v = false;
    ua.tre = { L99: -1 };
    let labXong = false;
    const pLab = d.docLab([uaTag("lab", "L99")]).then(
      (s) => ((labXong = true), { s, e: null as Error | null }),
      (e: Error) => ((labXong = true), { s: null, e }),
    );
    while (!ua.thuTuGui.includes("L99")) await sleep(2);
    const lag = batDauDoLag();
    const r = await stop(d, `ns=${ua.ns};s=Stop`, "bool", true);
    const lagMs = await lag.dung(200);
    const labConTreo = !labXong;
    const kq = await pLab;
    ua.nha(); // trả lời MUỘN của L99 (sau hết hạn của thư viện) — phải bị bỏ, không giải nhầm yêu cầu khác
    ua.tre = { P0: 15 };
    const sau = await d.readTags([uaTag("p0", "P0")]);
    // eslint-disable-next-line no-console
    console.log("[C4 opcua c]", JSON.stringify({ stopNenMs: nen.ms, stopKhiLabTreoMs: r.ms, lagMs, labConTreo, lab: kq.e?.message ?? kq.s?.[0].quality, sau: [sau[0].quality, sau[0].value], ketNoi: d.isConnected() }));
    expect(labConTreo, "STOP phải chạy TRONG lúc Lab đang treo").toBe(true);
    expect(r.ex.outcomes[0].ok).toBe(true);
    expect(ua.stop.v).toBe(true);
    expect(r.ms).toBeLessThanOrEqual(NGUONG_STOP_MS + lagMs);
    expect(kq.e?.message ?? "").toMatch(/timed out|timeout/i);
    expect(d.isConnected()).toBe(true);
    expect([sau[0].quality, sau[0].value]).toEqual(["good", ua.giaTri("P0")]);
  }, 20_000);

  it("★ (4.3) poll đang HỎNG (node không tồn tại / BadNodeIdUnknown), Lab đọc OK ⇒ health() KHÔNG đổi; đối chứng: readTags thường có đổi", async () => {
    const d = await moUa();
    await d.readTags([uaTag("p0", "P0")]); // một lần poll tốt (latencyMs / lastOkAt có giá trị)
    const hong = await d.readTags([{ tagKey: "x", address: `ns=${ua.ns};s=KhongCo`, dataType: "int" }]);
    expect(hong[0].quality).toBe("bad");
    const truoc = await hinhHealth(d);
    await sleep(5);
    ua.tre = { L10: 30 };
    const lab = await d.docLab([uaTag("lab", "L10")]);
    expect([lab[0].quality, lab[0].value]).toEqual(["good", ua.giaTri("L10")]);
    expect(await hinhHealth(d)).toEqual(truoc);
    await d.readTags([uaTag("p1", "P1")]);
    expect((await hinhHealth(d)).lastOkAt, "đối chứng: phép đo thấy được thay đổi").not.toBe(truoc.lastOkAt);
  }, 20_000);
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// STUB — luôn trong tập; C4 fix 1 (review M3): lượt Lab HỎNG không ghi trạng thái dùng chung
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("Stub — trong GIAO_THUC_THU_DOC (luôn)", () => {
  it("★ (4.3) Lab đọc HỎNG (treo ⇒ hết hạn) ⇒ mẫu bad/timeout nhưng health().lastError KHÔNG đổi; đối chứng: readTags thường có ghi lastError", async () => {
    const { StubDriver } = await import("./stubDriver");
    const d = new StubDriver();
    don.push(() => d.disconnect());
    await d.connect({ endpoint: `stub://c4-gate-${process.pid}`, timeoutMs: 30 } as any);
    d.simDatLoi({ treo: true });
    const truoc = await hinhHealth(d);
    const lab = await d.docLab([{ tagKey: "lab", address: "x", dataType: "int" }]);
    expect([lab[0].quality, lab[0].statusCode]).toEqual(["bad", "timeout"]);
    expect(await hinhHealth(d)).toEqual(truoc);
    await d.readTags([{ tagKey: "p", address: "x", dataType: "int" }]);
    expect((await hinhHealth(d)).lastError, "đối chứng: phép đo thấy được thay đổi").not.toBe(truoc.lastError);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// EtherNet/IP — st-ethernet-ip 2.7.5 THẬT trên thiết bị ENIP giả (khuôn enipAckMuon.thuVienThat.r1b2b2.test.ts) — KHÔNG ĐẠT ⇒ LOẠI
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const enip = require_("st-ethernet-ip/dist/enip");
const cauHinhEip = require_("st-ethernet-ip/dist/config");
const DINT = 0xc4;
const BOOL = 0xc1;

async function thietBiEip(onDoc: (ten: string, tl: (v: number) => void) => void) {
  const socks = new Set<net.Socket>();
  let soKetNoi = 0;
  const ghi: string[] = [];
  const session = 0x1234;
  const connId = 0x55667788;
  const mr = (service: number, status = 0, data: Buffer = Buffer.alloc(0)) => Buffer.concat([Buffer.from([service | 0x80, 0, status, 0]), data]);
  const tags: Array<[string, number]> = [["TagA", DINT], ["TagB", DINT], ["Stop", BOOL]];
  const srv = net.createServer((s) => {
    socks.add(s);
    soKetNoi += 1;
    s.on("close", () => socks.delete(s));
    s.on("error", () => undefined);
    let buf = Buffer.alloc(0);
    s.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 24) {
        const len = buf.readUInt16LE(2);
        if (buf.length < 24 + len) break;
        const goi = buf.subarray(0, 24 + len);
        buf = buf.subarray(24 + len);
        const cmd = goi.readUInt16LE(0);
        if (cmd === 0x65) {
          s.write(enip.encapsulation.header.build(0x65, session, Buffer.from([1, 0, 0, 0])));
          continue;
        }
        if (cmd === 0x66) continue;
        const cpf = enip.encapsulation.CPF.parse(goi.subarray(24).subarray(6));
        const connected = cmd === 0x70;
        const raw: Buffer = cpf[1].data;
        const seq = connected ? raw.readUInt16LE(0) : 0;
        const m = connected ? raw.subarray(2) : raw;
        const service = m[0];
        const p = m.subarray(2, 2 + m[1] * 2);
        const ten = p[0] === 0x91 ? p.subarray(2, 2 + p[1]).toString() : "";
        const gui = (resp: Buffer) => !s.destroyed && s.write(connected ? enip.encapsulation.sendUnitData(session, resp, connId, seq) : enip.encapsulation.sendRRData(session, resp));
        if (service === 0x54) {
          const d2 = Buffer.alloc(26);
          d2.writeUInt32LE(connId, 0);
          gui(mr(service, 0, d2));
        } else if (service === 0x4e) gui(mr(service, 0, Buffer.alloc(10)));
        else if (service === 0x01) {
          const n = Buffer.from("1769-L33ER/A LOGIX5333ER");
          const d2 = Buffer.alloc(15 + n.length);
          d2.writeUInt8(33, 6);
          d2.writeUInt8(11, 7);
          d2.writeUInt16LE(0x0060, 8);
          d2.writeUInt32LE(0xabcdef, 10);
          d2.writeUInt8(n.length, 14);
          n.copy(d2, 15);
          gui(mr(service, 0, d2));
        } else if (service === 0x55) {
          gui(
            mr(
              service,
              0,
              Buffer.concat(
                tags.map(([t, k], i) => {
                  const b = Buffer.alloc(8 + t.length);
                  b.writeUInt32LE(i + 1, 0);
                  b.writeUInt16LE(t.length, 4);
                  b.write(t, 6);
                  b.writeUInt16LE(k, 6 + t.length);
                  return b;
                }),
              ),
            ),
          );
        } else if (service === 0x4c) {
          onDoc(ten, (v) => {
            const b = Buffer.alloc(6);
            b.writeUInt16LE(DINT, 0);
            b.writeInt32LE(v, 2);
            gui(mr(service, 0, b));
          });
        } else if (service === 0x4d) {
          ghi.push(ten);
          gui(mr(service, 0));
        } else gui(mr(service, 0x08));
      }
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  return {
    port: (srv.address() as net.AddressInfo).port,
    soKetNoi: () => soKetNoi,
    ghi,
    dong: async () => {
      for (const s of socks) s.destroy();
      await new Promise<void>((r) => srv.close(() => r()));
    },
  };
}

describe("EtherNet/IP (st-ethernet-ip 2.7.5 THẬT) — KHÔNG ĐẠT ⇒ LOẠI khỏi GIAO_THUC_THU_DOC", () => {
  const portGoc = cauHinhEip.EIP_PORT;
  afterEach(() => {
    cauHinhEip.EIP_PORT = portGoc;
  });

  it("★ (a/b + 4.3) lượt 'Lab' TREO trước một lần đọc của poll: thư viện XẾP HÀNG đọc (workers.read) ⇒ poll chờ tới hết hạn rồi BAD, phiên bị HẠ (kết nối mới, lastError đổi)", async () => {
    const tb = await thietBiEip((ten, tl) => {
      if (ten === "TagB") return; // Lab: im lặng
      tl(111);
    });
    don.push(tb.dong);
    cauHinhEip.EIP_PORT = tb.port;
    const { EthernetIpDriver } = await import("./ethernetIpDriver");
    const d = new EthernetIpDriver();
    don.push(async () => {
      const dangMo: Promise<unknown> | null = (d as any).moDangChay;
      await d.disconnect();
      await dangMo;
    });
    await d.connect({ endpoint: "127.0.0.1", timeoutMs: 300 } as any);
    (d as any).plc.timeout_sp = 300;
    expect(typeof (d as any).docLab).toBe("undefined"); // không cài đường Lab
    const soKetNoiTruoc = tb.soKetNoi();
    const plcTruoc = (d as any).plc;
    const t0 = performance.now();
    // "Lab" (nếu dùng readTags) TREO, rồi lần đọc của poll tới ngay sau
    const pLab = d.readTags([{ tagKey: "lab", address: "TagB", dataType: "int" }]);
    await sleep(5);
    const poll = await d.readTags([{ tagKey: "p", address: "TagA", dataType: "int" }]);
    const msPoll = Math.round(performance.now() - t0);
    await pLab;
    await sleep(50);
    const sau = await hinhHealth(d);
    // eslint-disable-next-line no-console
    console.log("[C4 eip]", JSON.stringify({ poll: [poll[0].quality, poll[0].value], msPoll, soKetNoi: [soKetNoiTruoc, tb.soKetNoi()], lastError: sau.lastError }));
    // poll lẽ ra good 111 ngay (~ vài ms) — nay bị Lab chặn và hỏng
    expect(poll[0].quality === "good" && poll[0].value === 111 && msPoll < 100).toBe(false);
    // 4.3 — lượt Lab làm đổi trạng thái dùng chung: phiên NHIỄM bị hạ + mở lại (kết nối TCP mới; lastError giữa chừng "session contaminated",
    // connectedAt của phiên mới ⇒ health().lastOkAt đổi)
    expect(tb.soKetNoi()).toBeGreaterThan(soKetNoiTruoc);
    expect((d as any).plc).not.toBe(plcTruoc); // Controller của phiên bị thay
  }, 15_000);
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// SLMP 3E — driver tự viết trên node:net (không có thư viện ngoài: "thư viện thật" = chính `transact`); máy chủ SLMP giả — KHÔNG ĐẠT ⇒ LOẠI
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
async function slmpGia() {
  const { expectedFrameLength } = await import("./slmpEncoder");
  const socks = new Set<net.Socket>();
  const lenh: number[] = [];
  let imLangDocKe = false;
  const srv = net.createServer((s) => {
    socks.add(s);
    s.on("close", () => socks.delete(s));
    s.on("error", () => undefined);
    let buf = Buffer.alloc(0);
    s.on("data", (c) => {
      buf = Buffer.concat([buf, c]);
      for (;;) {
        const need = expectedFrameLength(buf, "3E");
        if (need < 0 || buf.length < need) break;
        const req = Buffer.from(buf.subarray(0, need));
        buf = buf.subarray(need);
        const body = req.subarray(9);
        const cmd = body.readUInt16LE(2);
        const sub = body.readUInt16LE(4);
        const points = body.readUInt16LE(10);
        lenh.push(cmd);
        if (cmd === 0x0401 && imLangDocKe) {
          imLangDocKe = false;
          continue; // Lab: im lặng
        }
        let data = Buffer.alloc(0);
        if (cmd === 0x0401) data = sub === 0x0001 ? Buffer.alloc(Math.ceil(points / 2)) : Buffer.alloc(points * 2);
        const head = Buffer.from([0xd0, 0x00, 0x00, 0xff, 0xff, 0x03, 0x00, 0, 0]);
        head.writeUInt16LE(2 + data.length, 7);
        s.write(Buffer.concat([head, Buffer.from([0, 0]), data]));
      }
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  return {
    port: (srv.address() as net.AddressInfo).port,
    lenh,
    imLangLanDocKe: () => {
      imLangDocKe = true;
    },
    dong: async () => {
      for (const s of socks) s.destroy();
      await new Promise<void>((r) => srv.close(() => r()));
    },
  };
}

describe("SLMP (driver node:net) — KHÔNG ĐẠT ⇒ LOẠI khỏi GIAO_THUC_THU_DOC", () => {
  it("★ (c) `transact` tuần tự hoá (1 outstanding / socket): lượt 'Lab' TREO ⇒ STOP XẾP HÀNG sau nó tới hết hạn, phiên bị hạ ⇒ STOP KHÔNG ack (> ngưỡng)", async () => {
    const sv = await slmpGia();
    don.push(sv.dong);
    const { SlmpDriver } = await import("./slmpDriver");
    const d = new SlmpDriver();
    don.push(() => d.disconnect());
    await d.connect({ endpoint: `tcp://127.0.0.1:${sv.port}`, timeoutMs: 1000 } as any);
    expect(typeof (d as any).docLab).toBe("undefined");
    sv.imLangLanDocKe();
    const pLab = d.readTags([{ tagKey: "lab", address: "D100", dataType: "int" }]);
    while (!sv.lenh.includes(0x0401)) await sleep(2);
    const r = await stop(d, "M0", "bool", true);
    await pLab;
    const soGhi = sv.lenh.filter((c) => c === 0x1401).length;
    // eslint-disable-next-line no-console
    console.log("[C4 slmp c]", JSON.stringify({ stopMs: r.ms, ok: r.ex.outcomes[0].ok, status: r.ex.outcomes[0].status, soGhiToiThietBi: soGhi, ketNoi: d.isConnected() }));
    expect(r.ex.outcomes[0].ok).toBe(false);
    expect(r.ms).toBeGreaterThan(NGUONG_STOP_MS);
    expect(soGhi).toBe(0); // STOP chưa bao giờ lên dây
  }, 15_000);
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// KẾT LUẬN — tập Lab = đúng các giao thức ĐẠT (a)(b)(c)(4.3) ở trên + stub; driver trong tập cài `docLab`, driver ngoài tập KHÔNG cài
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("GIAO_THUC_THU_DOC = kết luận đo", () => {
  it("đúng { stub, modbus, opcua } — S7 / MC (điều phối Q1: không chứng minh được) · EIP · SLMP (đo KHÔNG ĐẠT ở trên) bị loại", () => {
    expect([...GIAO_THUC_THU_DOC].sort()).toEqual(["modbus", "opcua", "stub"]);
  });
  it("driver trong tập cài docLab; driver ngoài tập không (Lab từ chối protocolNotSupported, không bao giờ rơi về readTags)", async () => {
    const tao: Record<string, () => OtDriver> = {
      stub: (await import("./stubDriver")).createStubDriver,
      modbus: (await import("./modbusDriver")).createModbusDriver,
      opcua: (await import("./opcuaDriver")).createOpcuaDriver,
      s7: (await import("./s7Driver")).createS7Driver,
      "mitsubishi-mc": (await import("./mitsubishiMcDriver")).createMitsubishiMcDriver,
      "ethernet-ip": (await import("./ethernetIpDriver")).createEthernetIpDriver,
      slmp: (await import("./slmpDriver")).createSlmpDriver,
    };
    for (const [p, f] of Object.entries(tao)) expect(typeof f().docLab === "function", p).toBe(GIAO_THUC_THU_DOC.has(p));
    for (const p of GIAO_THUC_THU_DOC) expect(Object.keys(tao), p).toContain(p);
  });
});
