/**
 * doc 81 Đợt 1B Task 12 — opcuaDriver với server node-opcua THẬT trong tiến trình.
 *
 * Server giả lập theo hành vi của PLC cấu hình chuẩn (S7-1500 / Omron NX): CHỈ mở endpoint
 * SignAndEncrypt + Basic256Sha256, chứng chỉ tự sinh vào thư mục tạm, biến có kiểu PLC
 * thật (REAL=Float, INT=Int16, WORD=UInt16, UDINT=UInt32, BYTE=Byte…). Server tự kiểm kiểu
 * khi ghi (Variant sai kiểu ⇒ BadTypeMismatch) — đó là ORACLE độc lập với mã sản phẩm; giá
 * trị ghi được kiểm lại bằng kho phía SERVER (không qua readTags của driver).
 *
 * Cô lập: 127.0.0.1, cổng trống do OS cấp; mọi PKI (server, client, PKI mặc định của
 * node-opcua qua APPDATA/XDG_CONFIG_HOME) nằm dưới os.tmpdir(); tắt hết trong afterAll.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const req = createRequire(import.meta.url);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "opcua-t12-"));
const SAVED_ENV: Record<string, string | undefined> = {};
for (const k of ["APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME", "OPCUA_PKI_DIR", "SECRET_ENCRYPTION_KEY", "OPCUA_ALLOW_TRUST_ON_FIRST_USE", "OT_OPCUA_MONITORED_ITEMS"]) SAVED_ENV[k] = process.env[k];
delete process.env.OPCUA_ALLOW_TRUST_ON_FIRST_USE;
delete process.env.OT_OPCUA_MONITORED_ITEMS;
// PKI mặc định của node-opcua (dùng khi SecurityMode None) → thư mục tạm, không đụng %APPDATA% thật.
process.env.APPDATA = path.join(TMP, "appdata");
process.env.LOCALAPPDATA = path.join(TMP, "localappdata");
process.env.XDG_CONFIG_HOME = path.join(TMP, "xdg");
process.env.OPCUA_PKI_DIR = path.join(TMP, "client-pki");
process.env.SECRET_ENCRYPTION_KEY = "task12-sim-test-key";

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}: test deadline ${ms}ms exceeded`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

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

// Kiểu dựng sẵn theo OPC UA Part 6 §5.1.2 — gõ tay (oracle độc lập).
const SPEC = { Boolean: 1, Byte: 3, Int16: 4, UInt16: 5, Int32: 6, UInt32: 7, Float: 10, Double: 11, String: 12 };

interface SimServer {
  server: any;
  cm: any;
  url: string;
  nsIndex: number;
  nsUri: string;
  store: Record<string, any>;
}

async function startServer(opts: { secure: boolean; pkiName: string }): Promise<SimServer> {
  const o = req("node-opcua");
  const port = await freePort();
  const cm = new o.OPCUACertificateManager({
    rootFolder: path.join(TMP, opts.pkiName),
    // Server tin client (thiết lập phía PLC của phép thử — không phải thứ đang được đo).
    automaticallyAcceptUnknownCertificate: true,
  });
  await cm.initialize();
  const server = new o.OPCUAServer({
    port,
    hostname: "127.0.0.1",
    securityModes: opts.secure ? [o.MessageSecurityMode.SignAndEncrypt] : [o.MessageSecurityMode.None],
    securityPolicies: opts.secure ? [o.SecurityPolicy.Basic256Sha256] : [o.SecurityPolicy.None],
    serverCertificateManager: cm,
    allowAnonymous: true,
    userManager: { isValidUser: (u: string, p: string) => u === "operator" && p === "s3cret-Pw" },
    nodeset_filename: [o.nodesets.standard],
  });
  await server.initialize();
  const addressSpace = server.engine.addressSpace;
  const ns = addressSpace.getOwnNamespace();
  const store: Record<string, any> = {};
  const vars: Array<[string, string, unknown]> = [
    ["F", "Float", 1.5],
    ["I16", "Int16", 1],
    ["U16", "UInt16", 1],
    ["U32", "UInt32", 1],
    ["B", "Byte", 1],
    ["BO", "Boolean", false],
    ["S", "String", "init"],
    ["D", "Double", 0.5],
    ["I32", "Int32", 7],
    ["I64", "Int64", 0],
  ];
  for (const [name, dt, init] of vars) {
    store[name] = new o.Variant({ dataType: o.DataType[dt], value: init });
    ns.addVariable({
      organizedBy: addressSpace.rootFolder.objects,
      browseName: name,
      nodeId: `s=${name}`,
      dataType: dt,
      minimumSamplingInterval: 100,
      accessLevel: "CurrentRead | CurrentWrite",
      userAccessLevel: "CurrentRead | CurrentWrite",
      value: {
        get: () => store[name],
        set: (v: any) => {
          store[name] = v;
          return o.StatusCodes.Good;
        },
      },
    });
  }
  await server.start();
  return { server, cm, url: `opc.tcp://127.0.0.1:${port}`, nsIndex: ns.index, nsUri: ns.namespaceUri, store };
}

let secure: SimServer;
let plain: SimServer;
const drivers: any[] = [];

async function newDriver() {
  const { OpcuaDriver } = await import("./opcuaDriver");
  const d = new OpcuaDriver();
  drivers.push(d);
  return d;
}

const SEC_OPTS = { securityMode: "SignAndEncrypt", securityPolicy: "Basic256Sha256" };

beforeAll(async () => {
  secure = await withTimeout(startServer({ secure: true, pkiName: "server-pki" }), 30_000, "start secure server");
  plain = await withTimeout(startServer({ secure: false, pkiName: "server-pki-plain" }), 30_000, "start plain server");
}, 60_000);

afterAll(async () => {
  for (const d of drivers) {
    await withTimeout(d.disconnect(), 5000, "driver disconnect").catch(() => undefined);
  }
  for (const s of [secure, plain]) {
    if (!s) continue;
    await withTimeout(s.server.shutdown(0), 10_000, "server shutdown").catch(() => undefined);
    await s.cm.dispose().catch(() => undefined);
  }
  try {
    const { __disposeOpcuaCertificateManagersForTest } = await import("./opcuaSecurity");
    await __disposeOpcuaCertificateManagersForTest();
  } catch {
    // module có thể chưa tồn tại (RED)
  }
  for (const [k, v] of Object.entries(SAVED_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    // Windows có thể còn khoá tệp PKI — thư mục tạm, bỏ qua
  }
}, 60_000);

// Fix round 1 — đóng driver của MỖI test (server node-opcua giới hạn số secure channel;
// để dồn tới afterAll làm test sau bị "premature disconnection").
afterEach(async () => {
  const list = drivers.splice(0);
  for (const d of list) {
    await withTimeout(d.disconnect(), 5000, "driver disconnect").catch(() => undefined);
  }
});

const clientPki = () => path.join(TMP, "client-pki");

describe("OPC UA SignAndEncrypt/Basic256Sha256 against a real in-process server (Task 12)", () => {
  it("default (no securityMode) cannot use a SignAndEncrypt-only server, with a reason; stays bounded", async () => {
    const d = await newDriver();
    const t0 = Date.now();
    // Fix round 1 (#8) — lý do CỤ THỂ, không chỉ "có lỗi".
    await expect(withTimeout(d.connect({ endpoint: secure.url, timeoutMs: 5000 }), 12_000, "None→secure connect")).rejects.toThrow(
      /no endpoint for SecurityMode None/,
    );
    expect(Date.now() - t0).toBeLessThan(12_000);
    expect(d.isConnected()).toBe(false);
  });

  it("server certificate NOT trusted ⇒ connect refused with BadCertificateUntrusted + trust path; cert lands in <pki>/rejected", async () => {
    const d = await newDriver();
    let err: Error | null = null;
    try {
      await withTimeout(d.connect({ endpoint: secure.url, options: SEC_OPTS, timeoutMs: 8000 }), 15_000, "untrusted connect");
    } catch (e) {
      err = e as Error;
    }
    expect(err, "connect must be refused").not.toBeNull();
    expect(err!.message).toMatch(/BadCertificateUntrusted/);
    expect(err!.message).toContain(path.join(clientPki(), "trusted", "certs"));
    expect(d.isConnected()).toBe(false);
    const rejected = fs.readdirSync(path.join(clientPki(), "rejected"));
    expect(rejected.length).toBeGreaterThan(0);
  });

  it("operator moves the rejected server certificate into <pki>/trusted/certs ⇒ connect + read work", async () => {
    // Bước của NGƯỜI VẬN HÀNH (ghi trong opcuaSecurity.ts): CHUYỂN tệp từ rejected/ sang
    // trusted/certs/ (danh sách rejected THẮNG trusted nếu tệp nằm ở cả hai — node-opcua-pki).
    const trustedDir = path.join(clientPki(), "trusted", "certs");
    const rejectedDir = path.join(clientPki(), "rejected");
    fs.mkdirSync(trustedDir, { recursive: true });
    const rejected = fs.readdirSync(rejectedDir);
    expect(rejected.length, "the previous test must have left the server cert in rejected/").toBeGreaterThan(0);
    // Oracle độc lập: tệp bị từ chối chính là chứng chỉ server của PLC giả (so nội dung PEM).
    const serverPem = fs.readFileSync(secure.server.certificateFile, "utf8").replace(/\s+/g, "");
    expect(fs.readFileSync(path.join(rejectedDir, rejected[0]), "utf8").replace(/\s+/g, "")).toBe(serverPem);
    for (const f of rejected) fs.renameSync(path.join(rejectedDir, f), path.join(trustedDir, f));

    const d = await newDriver();
    // Watcher của PKI đọc lại trust-list — thử lại có hạn (≤ 15 s), không dựa vào timeout vitest.
    const deadline = Date.now() + 15_000;
    let lastErr: unknown = null;
    for (;;) {
      try {
        await withTimeout(d.connect({ endpoint: secure.url, options: SEC_OPTS, timeoutMs: 8000 }), 10_000, "trusted connect");
        break;
      } catch (e) {
        lastErr = e;
        if (Date.now() > deadline) throw lastErr;
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    expect(d.isConnected()).toBe(true);
    const [s] = await withTimeout(
      d.readTags([{ tagKey: "f", address: `ns=${secure.nsIndex};s=F`, dataType: "float" }]),
      5000,
      "read",
    );
    expect(s.quality).toBe("good");
    expect(s.value).toBeCloseTo(1.5, 6);
  }, 40_000);

  it("typed writes Float/Int16/UInt16/UInt32/Byte (+Boolean/String/Double/Int32) land with the NODE's type and read back", async () => {
    const d = await newDriver();
    await withTimeout(d.connect({ endpoint: secure.url, options: SEC_OPTS, timeoutMs: 8000 }), 10_000, "connect");
    const ns = secure.nsIndex;
    const writes = [
      { tagKey: "F", address: `ns=${ns};s=F`, value: 3.25, dataType: "float" as const },
      { tagKey: "I16", address: `ns=${ns};s=I16`, value: -1234, dataType: "int" as const },
      { tagKey: "U16", address: `ns=${ns};s=U16`, value: 65000, dataType: "int" as const },
      { tagKey: "U32", address: `ns=${ns};s=U32`, value: 4000000000, dataType: "int" as const },
      { tagKey: "B", address: `ns=${ns};s=B`, value: 200, dataType: "int" as const },
      { tagKey: "BO", address: `ns=${ns};s=BO`, value: true, dataType: "bool" as const },
      { tagKey: "S", address: `ns=${ns};s=S`, value: "hello", dataType: "string" as const },
      { tagKey: "D", address: `ns=${ns};s=D`, value: 2.75, dataType: "float" as const },
      { tagKey: "I32", address: `ns=${ns};s=I32`, value: -70000, dataType: "int" as const },
    ];
    const res = await withTimeout(d.writeTags(writes), 8000, "write");
    for (const r of res) expect(r, `${r.tagKey}: ${r.error ?? ""}`).toMatchObject({ ok: true });

    // Oracle phía SERVER: kiểu + giá trị đúng như PLC nhận.
    const want: Record<string, [number, unknown]> = {
      F: [SPEC.Float, 3.25],
      I16: [SPEC.Int16, -1234],
      U16: [SPEC.UInt16, 65000],
      U32: [SPEC.UInt32, 4000000000],
      B: [SPEC.Byte, 200],
      BO: [SPEC.Boolean, true],
      S: [SPEC.String, "hello"],
      D: [SPEC.Double, 2.75],
      I32: [SPEC.Int32, -70000],
    };
    for (const [k, [dt, v]] of Object.entries(want)) {
      expect(secure.store[k].dataType, `${k} dataType`).toBe(dt);
      expect(secure.store[k].value, `${k} value`).toBe(v);
    }

    // Đọc lại qua driver.
    const samples = await withTimeout(
      d.readTags(writes.map((w) => ({ tagKey: w.tagKey, address: w.address, dataType: w.dataType }))),
      5000,
      "readback",
    );
    const byKey = Object.fromEntries(samples.map((s: any) => [s.tagKey, s]));
    for (const [k, [, v]] of Object.entries(want)) {
      expect(byKey[k].quality).toBe("good");
      expect(byKey[k].value).toBe(v);
    }
  }, 30_000);

  it("out-of-range write ⇒ ok:false and the PLC value is untouched; other writes in the batch still land", async () => {
    const d = await newDriver();
    await withTimeout(d.connect({ endpoint: secure.url, options: SEC_OPTS, timeoutMs: 8000 }), 10_000, "connect");
    const ns = secure.nsIndex;
    const before = { B: secure.store.B.value, I16: secure.store.I16.value, U16: secure.store.U16.value };
    const res = await withTimeout(
      d.writeTags([
        { tagKey: "B", address: `ns=${ns};s=B`, value: 300, dataType: "int" },
        { tagKey: "I16", address: `ns=${ns};s=I16`, value: 40000, dataType: "int" },
        { tagKey: "U16", address: `ns=${ns};s=U16`, value: -1, dataType: "int" },
        { tagKey: "I32", address: `ns=${ns};s=I32`, value: 11, dataType: "int" },
      ]),
      8000,
      "write",
    );
    expect(res.map((r: any) => r.ok)).toEqual([false, false, false, true]);
    for (const r of res.slice(0, 3)) expect(r.error).toMatch(/out of range/i);
    expect(secure.store.B.value).toBe(before.B);
    expect(secure.store.I16.value).toBe(before.I16);
    expect(secure.store.U16.value).toBe(before.U16);
    expect(secure.store.I32.value).toBe(11);
  }, 30_000);

  it("batch of 5 tags with ONE malformed nodeId ⇒ 4 good + 1 bad (with its status code)", async () => {
    const d = await newDriver();
    await withTimeout(d.connect({ endpoint: secure.url, options: SEC_OPTS, timeoutMs: 8000 }), 10_000, "connect");
    const ns = secure.nsIndex;
    const samples = await withTimeout(
      d.readTags([
        { tagKey: "F", address: `ns=${ns};s=F`, dataType: "float" },
        { tagKey: "bad", address: `ns=${ns};i=abc`, dataType: "int" },
        { tagKey: "I32", address: `ns=${ns};s=I32`, dataType: "int" },
        { tagKey: "S", address: `ns=${ns};s=S`, dataType: "string" },
        { tagKey: "D", address: `ns=${ns};s=D`, dataType: "float" },
      ]),
      5000,
      "batch read",
    );
    expect(samples.map((s: any) => s.quality)).toEqual(["good", "bad", "good", "good", "good"]);
    expect(samples[1].value).toBeNull();
    expect(samples[1].statusCode).toMatch(/BadNodeIdInvalid/);
  }, 30_000);

  it("batch with an UNKNOWN nodeId ⇒ only that tag bad with BadNodeIdUnknown", async () => {
    const d = await newDriver();
    await withTimeout(d.connect({ endpoint: secure.url, options: SEC_OPTS, timeoutMs: 8000 }), 10_000, "connect");
    const ns = secure.nsIndex;
    const samples = await withTimeout(
      d.readTags([
        { tagKey: "F", address: `ns=${ns};s=F`, dataType: "float" },
        { tagKey: "missing", address: `ns=${ns};s=DoesNotExist`, dataType: "float" },
      ]),
      5000,
      "read",
    );
    expect(samples.map((s: any) => s.quality)).toEqual(["good", "bad"]);
    expect(samples[1].statusCode).toMatch(/BadNodeIdUnknown/);
  }, 30_000);

  it("nsu=<namespace uri>;s=… resolves through the server's NamespaceArray (read + write); unknown uri ⇒ that tag bad", async () => {
    const d = await newDriver();
    await withTimeout(d.connect({ endpoint: secure.url, options: SEC_OPTS, timeoutMs: 8000 }), 10_000, "connect");
    const w = await withTimeout(
      d.writeTags([{ tagKey: "I32", address: `nsu=${secure.nsUri};s=I32`, value: 4242, dataType: "int" }]),
      5000,
      "write",
    );
    expect(w[0]).toMatchObject({ ok: true });
    expect(secure.store.I32.value).toBe(4242);
    const samples = await withTimeout(
      d.readTags([
        { tagKey: "I32", address: `nsu=${secure.nsUri};s=I32`, dataType: "int" },
        { tagKey: "nouri", address: "nsu=urn:not-on-this-server;s=I32", dataType: "int" },
      ]),
      5000,
      "read",
    );
    expect(samples[0]).toMatchObject({ quality: "good", value: 4242 });
    expect(samples[1].quality).toBe("bad");
    expect(samples[1].statusCode).toMatch(/BadNodeIdUnknown/);
  }, 30_000);

  it("UserName auth with the password stored as a secretBox ciphertext; wrong password refused", async () => {
    const { encryptSecret } = await import("../../security/secretBox");
    const enc = encryptSecret("s3cret-Pw")!;
    expect(enc).toMatch(/^enc:v1:/);
    const d = await newDriver();
    await withTimeout(
      d.connect({ endpoint: secure.url, options: { ...SEC_OPTS, userName: "operator", password: enc }, timeoutMs: 8000 }),
      10_000,
      "user connect",
    );
    expect(d.isConnected()).toBe(true);
    await d.disconnect();

    const d2 = await newDriver();
    await expect(
      withTimeout(
        d2.connect({ endpoint: secure.url, options: { ...SEC_OPTS, userName: "operator", password: encryptSecret("wrong")! }, timeoutMs: 8000 }),
        10_000,
        "bad user connect",
      ),
    ).rejects.toThrow(/Bad|denied|rejected/i);
    expect(d2.isConnected()).toBe(false);
  }, 30_000);

  it("trustOnFirstUse:true is REFUSED before any socket when OPCUA_ALLOW_TRUST_ON_FIRST_USE is not set (R20)", async () => {
    delete process.env.OPCUA_ALLOW_TRUST_ON_FIRST_USE;
    const fresh = path.join(TMP, "client-pki-tofu-refused");
    process.env.OPCUA_PKI_DIR = fresh;
    try {
      const d = await newDriver();
      await expect(
        withTimeout(d.connect({ endpoint: secure.url, options: { ...SEC_OPTS, trustOnFirstUse: true }, timeoutMs: 8000 }), 10_000, "tofu refused"),
      ).rejects.toThrow(/OPCUA_ALLOW_TRUST_ON_FIRST_USE/);
      expect(d.isConnected()).toBe(false);
      // Không PKI nào được tạo ⇒ không bước nối nào đã chạy.
      expect(fs.existsSync(fresh)).toBe(false);
    } finally {
      process.env.OPCUA_PKI_DIR = clientPki();
    }
  }, 30_000);

  it("R20: a TOFU accept lives in an ISOLATED <pki>/tofu root — a strict adapter on the same dir is STILL refused; accept WARNs with the thumbprint", async () => {
    const shared = path.join(TMP, "client-pki-shared");
    process.env.OPCUA_PKI_DIR = shared;
    process.env.OPCUA_ALLOW_TRUST_ON_FIRST_USE = "true";
    const warn = vi.spyOn(console, "warn");
    try {
      const tofu = await newDriver();
      await withTimeout(
        tofu.connect({ endpoint: secure.url, options: { ...SEC_OPTS, trustOnFirstUse: true }, timeoutMs: 8000 }),
        10_000,
        "tofu connect",
      );
      expect(tofu.isConnected()).toBe(true);
      expect(fs.readdirSync(path.join(shared, "tofu", "trusted", "certs")).length).toBeGreaterThan(0);

      // Oracle độc lập: thumbprint = SHA-1 của DER chứng chỉ server (tính từ tệp PEM của server).
      const pem = fs.readFileSync(secure.server.certificateFile, "utf8");
      const der = Buffer.from(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""), "base64");
      const thumb = createHash("sha1").update(der).digest("hex");
      const acceptWarns = warn.mock.calls.filter((c) => /trustOnFirstUse ACCEPTED/.test(String(c[0])));
      expect(acceptWarns).toHaveLength(1);
      expect(String(acceptWarns[0][0]).toLowerCase()).toContain(thumb);
      expect(warn.mock.calls.filter((c) => /trustOnFirstUse is ON/.test(String(c[0])))).toHaveLength(1);

      const strict = await newDriver();
      await expect(
        withTimeout(strict.connect({ endpoint: secure.url, options: SEC_OPTS, timeoutMs: 8000 }), 10_000, "strict after tofu"),
      ).rejects.toThrow(/BadCertificateUntrusted/);
      expect(strict.isConnected()).toBe(false);
      const strictTrusted = path.join(shared, "trusted", "certs");
      expect(fs.existsSync(strictTrusted) ? fs.readdirSync(strictTrusted) : []).toEqual([]);

      // TOFU lần hai (đã tin trong gốc tofu) ⇒ không WARN "ACCEPTED" nữa, không WARN tư thế lần 2.
      await tofu.disconnect();
      await withTimeout(
        tofu.connect({ endpoint: secure.url, options: { ...SEC_OPTS, trustOnFirstUse: true }, timeoutMs: 8000 }),
        10_000,
        "tofu reconnect",
      );
      expect(warn.mock.calls.filter((c) => /trustOnFirstUse ACCEPTED/.test(String(c[0])))).toHaveLength(1);
      expect(warn.mock.calls.filter((c) => /trustOnFirstUse is ON/.test(String(c[0])))).toHaveLength(1);
    } finally {
      warn.mockRestore();
      delete process.env.OPCUA_ALLOW_TRUST_ON_FIRST_USE;
      process.env.OPCUA_PKI_DIR = clientPki();
    }
  }, 40_000);

  it("#9 two adapters doing their FIRST secure connect in parallel on a fresh, empty PKI dir ⇒ both connect, one client certificate", async () => {
    const fresh = path.join(TMP, "client-pki-race");
    // Cách vận hành thứ hai (tài liệu): chép chứng chỉ server vào trusted/certs TRƯỚC lần nối đầu.
    fs.mkdirSync(path.join(fresh, "trusted", "certs"), { recursive: true });
    fs.copyFileSync(secure.server.certificateFile, path.join(fresh, "trusted", "certs", "plc.pem"));
    process.env.OPCUA_PKI_DIR = fresh;
    try {
      const a = await newDriver();
      const b = await newDriver();
      const res = await withTimeout(
        Promise.allSettled([
          a.connect({ endpoint: secure.url, options: SEC_OPTS, timeoutMs: 10_000 }),
          b.connect({ endpoint: secure.url, options: SEC_OPTS, timeoutMs: 10_000 }),
        ]),
        20_000,
        "parallel first connect",
      );
      expect(res.map((r) => r.status), JSON.stringify(res.map((r: any) => r.reason?.message))).toEqual(["fulfilled", "fulfilled"]);
      expect(fs.readdirSync(path.join(fresh, "own", "certs")).filter((f) => f.endsWith(".pem"))).toEqual(["client_certificate.pem"]);
      if (process.platform !== "win32") {
        expect(fs.statSync(path.join(fresh, "own", "private", "private_key.pem")).mode & 0o777).toBe(0o600);
      }
    } finally {
      process.env.OPCUA_PKI_DIR = clientPki();
    }
  }, 40_000);

  it("#4 Int64 beyond what node-opcua can encode ⇒ ok:false with a clear reason; in-range negative lands as two's complement", async () => {
    const d = await newDriver();
    await withTimeout(d.connect({ endpoint: secure.url, options: SEC_OPTS, timeoutMs: 8000 }), 10_000, "connect");
    const ns = secure.nsIndex;
    const res = await withTimeout(
      d.writeTags([
        { tagKey: "far", address: `ns=${ns};s=I64`, value: -5_000_000_000, dataType: "int" },
        { tagKey: "near", address: `ns=${ns};s=I64`, value: -5, dataType: "int" },
      ]),
      8000,
      "write",
    );
    expect(res[0].ok).toBe(false);
    expect(res[0].error).toMatch(/out of range for Int64/);
    expect(res[1]).toMatchObject({ ok: true });
    // Oracle: bù hai 64 bit tính bằng BigInt, [high, low] như node-opcua lưu Int64.
    const b = BigInt.asUintN(64, -5n);
    expect(secure.store.I64.value).toEqual([Number(b >> 32n), Number(b & 0xffffffffn)]);
  }, 30_000);

  it("#5 monitored item the server rejects ⇒ ONE rate-limited bad sample with its statusCode; good tag keeps flowing", async () => {
    process.env.OT_OPCUA_MONITORED_ITEMS = "true";
    try {
      const d = await newDriver();
      await withTimeout(d.connect({ endpoint: secure.url, options: SEC_OPTS, timeoutMs: 8000 }), 10_000, "connect");
      const got: any[] = [];
      const handle = await withTimeout(
        d.subscribe(
          [
            { tagKey: "D", address: `ns=${secure.nsIndex};s=D`, dataType: "float" },
            { tagKey: "gone", address: `ns=${secure.nsIndex};s=NotThere`, dataType: "float" },
          ],
          (s: any) => {
            got.push(s);
          },
          200,
        ),
        8000,
        "subscribe",
      );
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline && !(got.some((s) => s.tagKey === "gone") && got.some((s) => s.tagKey === "D"))) {
        await new Promise((r) => setTimeout(r, 100));
      }
      await new Promise((r) => setTimeout(r, 1000)); // cửa sổ để err + terminated cùng đến
      const bad = got.filter((s) => s.tagKey === "gone");
      expect(bad).toHaveLength(1);
      expect(bad[0]).toMatchObject({ quality: "bad", value: null });
      expect(bad[0].statusCode).toMatch(/BadNodeIdUnknown/);
      expect(got.some((s) => s.tagKey === "D" && s.quality === "good")).toBe(true);
      const before = got.length;
      await withTimeout(handle.close(), 5000, "close");
      await new Promise((r) => setTimeout(r, 300));
      // Đóng êm không sinh mẫu bad giả.
      expect(got.slice(before).filter((s) => s.quality === "bad")).toEqual([]);
    } finally {
      delete process.env.OT_OPCUA_MONITORED_ITEMS;
    }
  }, 30_000);

  it("disconnect() is bounded", async () => {
    const d = await newDriver();
    await withTimeout(d.connect({ endpoint: secure.url, options: SEC_OPTS, timeoutMs: 8000 }), 10_000, "connect");
    const t0 = Date.now();
    await withTimeout(d.disconnect(), 6000, "disconnect");
    expect(Date.now() - t0).toBeLessThan(6000);
    expect(d.isConnected()).toBe(false);
  }, 30_000);
});

describe("legacy default (no securityMode) against a None server keeps working (Task 12)", () => {
  it("connects with SecurityMode None, reads/writes, and warns ONCE across connects", async () => {
    const sec = await import("./opcuaSecurity").catch(() => null);
    sec?.__resetOpcuaSecurityWarningForTest?.();
    const warn = vi.spyOn(console, "warn");
    try {
      const d = await newDriver();
      await withTimeout(d.connect({ endpoint: plain.url, timeoutMs: 8000 }), 10_000, "plain connect");
      const [s] = await withTimeout(
        d.readTags([{ tagKey: "D", address: `ns=${plain.nsIndex};s=D`, dataType: "float" }]),
        5000,
        "read",
      );
      expect(s).toMatchObject({ quality: "good", value: 0.5 });
      const w = await withTimeout(
        d.writeTags([{ tagKey: "U16", address: `ns=${plain.nsIndex};s=U16`, value: 7, dataType: "int" }]),
        5000,
        "write",
      );
      expect(w[0]).toMatchObject({ ok: true });
      expect(plain.store.U16.dataType).toBe(SPEC.UInt16);
      await d.disconnect();
      await withTimeout(d.connect({ endpoint: plain.url, timeoutMs: 8000 }), 10_000, "plain reconnect");
      const ours = warn.mock.calls.filter((c) => /securityMode not configured/.test(String(c[0])));
      expect(ours).toHaveLength(1);
      // R20 — securityMode "None" ĐẶT TƯỜNG MINH ⇒ WARN một lần cho endpoint này (hai lần nối ⇒ 1 dòng).
      const e = await newDriver();
      await withTimeout(e.connect({ endpoint: plain.url, options: { securityMode: "None" }, timeoutMs: 8000 }), 10_000, "explicit None");
      await e.disconnect();
      await withTimeout(e.connect({ endpoint: plain.url, options: { securityMode: "None" }, timeoutMs: 8000 }), 10_000, "explicit None 2");
      expect(warn.mock.calls.filter((c) => /securityMode None set explicitly/.test(String(c[0])))).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  }, 30_000);
});
