/**
 * Vá PKI Node 26 (2026-10-30) — manager chứng chỉ client của node-opcua-pki giữ chỉ mục "rejected" TRONG BỘ NHỚ; trên Node 26.13 watcher của
 * <pki>/rejected không phát add/unlink ⇒ sau khi người vận hành CHUYỂN chứng chỉ server sang <pki>/trusted/certs, manager đang sống (sản phẩm giữ
 * MỘT manager mỗi gốc PKI suốt đời tiến trình) vẫn từ chối nó cho tới khi restart. Bản vá: nối lỗi BadCertificateUntrusted mà thumbprint (theo NỘI DUNG
 * tệp) ĐÃ nằm trong trusted/certs trên đĩa ⇒ cm.reloadCertificates() (quét lại đĩa) + thử nối lại ĐÚNG MỘT lần với client mới. Bất biến: KHÔNG BAO GIỜ tự tin cậy.
 *
 * Đếm "số lần nối" bằng sự kiện `newChannel` của server giả (bắn ở HEL/ACK, trước khi client kiểm chứng chỉ server).
 * Chạy được trên cả Node 24 (watcher tự lành, 0 lần dựng lại) lẫn Node 26 (dựng lại đúng 1 lần).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { createRequire } from "node:module";
import { createHash, X509Certificate } from "node:crypto";

const req = createRequire(import.meta.url);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "opcua-pkifix-"));
const SAVED: Record<string, string | undefined> = {};
for (const k of ["APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME", "OPCUA_PKI_DIR", "OPCUA_ALLOW_TRUST_ON_FIRST_USE"]) SAVED[k] = process.env[k];
delete process.env.OPCUA_ALLOW_TRUST_ON_FIRST_USE;
process.env.APPDATA = path.join(TMP, "appdata");
process.env.LOCALAPPDATA = path.join(TMP, "localappdata");
process.env.XDG_CONFIG_HOME = path.join(TMP, "xdg");

const ESCALA = 3;
const SEC_OPTS = { securityMode: "SignAndEncrypt", securityPolicy: "Basic256Sha256" };
const NODE_MAJOR = Number(process.versions.node.split(".")[0]);

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

let server: any;
let serverCm: any;
let url = "";
let channels = 0;
const drivers: any[] = [];
let n = 0;

beforeAll(async () => {
  const o = req("node-opcua");
  const port = await freePort();
  serverCm = new o.OPCUACertificateManager({ rootFolder: path.join(TMP, "server-pki"), automaticallyAcceptUnknownCertificate: true });
  await serverCm.initialize();
  server = new o.OPCUAServer({
    port,
    hostname: "127.0.0.1",
    securityModes: [o.MessageSecurityMode.SignAndEncrypt],
    securityPolicies: [o.SecurityPolicy.Basic256Sha256],
    serverCertificateManager: serverCm,
    allowAnonymous: true,
    nodeset_filename: [o.nodesets.standard],
  });
  await server.initialize();
  server.on("newChannel", () => {
    channels++;
  });
  await server.start();
  url = `opc.tcp://127.0.0.1:${port}`;
}, 60_000 * ESCALA);

afterEach(async () => {
  for (const d of drivers.splice(0)) await d.disconnect().catch(() => undefined);
});

afterAll(async () => {
  await server?.shutdown(0).catch(() => undefined);
  await serverCm?.dispose().catch(() => undefined);
  try {
    const { __disposeOpcuaCertificateManagersForTest } = await import("./opcuaSecurity");
    await __disposeOpcuaCertificateManagersForTest();
  } catch {
    // bỏ qua
  }
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    // Windows có thể còn khoá tệp PKI
  }
}, 60_000 * ESCALA);

/** Mỗi ca một gốc PKI riêng (manager được giữ theo gốc). */
function pkiMoi(): string {
  const dir = path.join(TMP, `client-pki-${++n}`);
  process.env.OPCUA_PKI_DIR = dir;
  return dir;
}
async function thuNoi(): Promise<{ err: Error | null; driver: any }> {
  const { OpcuaDriver } = await import("./opcuaDriver");
  const d = new OpcuaDriver();
  drivers.push(d);
  try {
    await d.connect({ endpoint: url, options: SEC_OPTS, timeoutMs: 8000 * ESCALA });
    return { err: null, driver: d };
  } catch (e) {
    return { err: e as Error, driver: d };
  }
}
const sha1 = (pemOrDer: Buffer) => createHash("sha1").update(new X509Certificate(pemOrDer).raw).digest("hex");
const serverCertThumb = () => sha1(fs.readFileSync(server.certificateFile));
const demTep = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).length : 0);

describe("vá PKI Node 26 — tự lành đúng một lần, không bao giờ tự tin cậy", () => {
  it("cầu chì: thumbprint theo NỘI DUNG khớp tệp chứng chỉ của server giả", () => {
    expect(serverCertThumb()).toMatch(/^[0-9a-f]{40}$/);
  });

  it("★ chứng chỉ KHÔNG có trong trusted/ ⇒ vẫn bị từ chối, KHÔNG quét lại, manager giữ nguyên, đúng 1 lần nối, trusted/ vẫn rỗng (không TOFU ngầm)", async () => {
    const pki = pkiMoi();
    const { opcuaPkiThongKe, getOpcuaClientCertificateManager } = await import("./opcuaSecurity");
    const quetLai0 = opcuaPkiThongKe.quetLai;
    channels = 0;
    const { err } = await thuNoi();
    expect(err?.message).toMatch(/BadCertificateUntrusted/);
    const cm1 = await getOpcuaClientCertificateManager(req("node-opcua"), pki, false);
    // thử lần nữa với CÙNG manager (cert vẫn lạ)
    const { err: err2 } = await thuNoi();
    expect(err2?.message).toMatch(/BadCertificateUntrusted/);
    expect(await getOpcuaClientCertificateManager(req("node-opcua"), pki, false)).toBe(cm1); // manager giữ nguyên
    expect(opcuaPkiThongKe.quetLai).toBe(quetLai0);
    expect(channels).toBe(2); // hai lần nối của người gọi, KHÔNG có lần thử lại
    expect(demTep(path.join(pki, "trusted", "certs"))).toBe(0);
  });

  it("★ operator CHUYỂN cert sang trusted/ khi manager đang sống ⇒ nối được; Node ≥ 25: quét lại đúng 1 lần, manager giữ nguyên", async () => {
    const pki = pkiMoi();
    const sec = await import("./opcuaSecurity");
    expect((await thuNoi()).err?.message).toMatch(/BadCertificateUntrusted/);
    const cmCu = await sec.getOpcuaClientCertificateManager(req("node-opcua"), pki, false);
    let reloadCalls = 0;
    const reload0 = cmCu.reloadCertificates.bind(cmCu);
    cmCu.reloadCertificates = async (...a: unknown[]) => {
      reloadCalls++;
      return reload0(...a);
    };
    const rejectedDir = path.join(pki, "rejected");
    const trustedDir = path.join(pki, "trusted", "certs");
    fs.mkdirSync(trustedDir, { recursive: true });
    const files = fs.readdirSync(rejectedDir);
    expect(files.length, "cert phải nằm ở rejected/ sau lần từ chối đầu").toBeGreaterThan(0);
    for (const f of files) fs.renameSync(path.join(rejectedDir, f), path.join(trustedDir, f)); // Bước của người vận hành, KHÔNG chờ watcher
    // Node 24: watcher còn sống ⇒ chờ nó thấy tệp (nối NGAY trước đó là cuộc đua đã biết: pki dời cert ngược về rejected/ — xem opcuaDriver.secure.sim.test.ts).
    if (NODE_MAJOR < 25) await new Promise((r) => setTimeout(r, 700 * ESCALA));
    const quetLai0 = sec.opcuaPkiThongKe.quetLai;
    channels = 0;
    const { err, driver } = await thuNoi();
    expect(err, err?.message).toBeNull();
    expect(driver.isConnected()).toBe(true);
    const quetLai = sec.opcuaPkiThongKe.quetLai - quetLai0;
    expect(quetLai).toBeLessThanOrEqual(1); // KHÔNG BAO GIỜ quá một lần
    if (NODE_MAJOR >= 25) expect(quetLai, "Node ≥ 25: watcher rejected/ hỏng ⇒ phải tự lành bằng quét lại").toBe(1);
    expect(channels).toBe(2 + quetLai); // nối thành công = 2 kênh (khám phá endpoint + kênh bảo mật) + tối đa 1 lần thử lại bị từ chối ở kênh đầu
    expect(reloadCalls).toBe(quetLai); // reloadCertificates (đóng + dựng lại watcher) đúng bằng số lần quét lại
    expect(await sec.getOpcuaClientCertificateManager(req("node-opcua"), pki, false)).toBe(cmCu); // manager dùng chung KHÔNG bị thay/dispose
    // Trust-list chỉ gồm đúng thứ người vận hành chuyển vào
    expect(fs.readdirSync(trustedDir).map((f) => sha1(fs.readFileSync(path.join(trustedDir, f))))).toEqual([serverCertThumb()]);
  });

  it("★ thumbprint CÓ trong trusted/ nhưng manager mới VẪN từ chối (còn nằm cả ở rejected/) ⇒ thử lại ĐÚNG MỘT lần rồi báo lỗi (rejected thắng)", async () => {
    const pki = pkiMoi();
    const sec = await import("./opcuaSecurity");
    expect((await thuNoi()).err?.message).toMatch(/BadCertificateUntrusted/);
    const rejectedDir = path.join(pki, "rejected");
    const trustedDir = path.join(pki, "trusted", "certs");
    fs.mkdirSync(trustedDir, { recursive: true });
    for (const f of fs.readdirSync(rejectedDir)) fs.copyFileSync(path.join(rejectedDir, f), path.join(trustedDir, f)); // CHÉP, không chuyển ⇒ rejected thắng
    const quetLai0 = sec.opcuaPkiThongKe.quetLai;
    channels = 0;
    const { err } = await thuNoi();
    expect(err?.message).toMatch(/BadCertificateUntrusted/);
    expect(sec.opcuaPkiThongKe.quetLai - quetLai0).toBe(1);
    expect(channels).toBe(2); // 1 nối + ĐÚNG 1 lần thử lại, không lặp
  });

  it("chungChiDaTinTrenDia: so theo NỘI DUNG, không theo tên tệp; tệp rác bị bỏ qua", async () => {
    const { chungChiDaTinTrenDia } = await import("./opcuaSecurity");
    const root = path.join(TMP, "unit-pki");
    const dir = path.join(root, "trusted", "certs");
    fs.mkdirSync(dir, { recursive: true });
    const pem = fs.readFileSync(server.certificateFile);
    fs.writeFileSync(path.join(dir, "ten-khong-lien-quan-gi.pem"), pem);
    fs.writeFileSync(path.join(dir, "rac.txt"), "không phải chứng chỉ");
    expect(chungChiDaTinTrenDia(root, serverCertThumb())).toBe(true);
    expect(chungChiDaTinTrenDia(root, "0".repeat(40))).toBe(false);
    expect(chungChiDaTinTrenDia(path.join(TMP, "khong-ton-tai"), serverCertThumb())).toBe(false);
  });
});
