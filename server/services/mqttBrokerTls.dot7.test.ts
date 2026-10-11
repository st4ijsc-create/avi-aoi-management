/**
 * doc 81 Đợt 7 task J1 — the built-in broker's site TLS certificate (mqttBrokerTls.ts).
 *
 * Oracles independent of the product code:
 *   · the fingerprint is recomputed here from the PEM text (base64 → DER → sha256), not read from the module;
 *   · the certificate is exercised by a REAL TLS handshake (node:tls server + client on 127.0.0.1:0) whose client
 *     trusts it ONLY by that fingerprint (CA = the certificate itself + an explicit fingerprint check);
 *   · "never overwritten" is checked on the file bytes.
 * Temp dirs only (os.tmpdir) — never the repo's data/ dir.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { createHash, X509Certificate } from "node:crypto";
import {
  BrokerTlsError,
  SITE_TLS_FILE_NAME,
  loadOrCreateSiteBrokerTls,
  mintSiteBrokerCertificate,
  mqttPlainEnabled,
  mqttTlsDir,
  mqttTlsEnabled,
  resolveBrokerTls,
} from "./mqttBrokerTls";

const dirs: string[] = [];
function tempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "dot7-j1-"));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

/** Independent fingerprint: SHA-256 over the DER inside the first CERTIFICATE block, `AB:CD:…`. */
function fingerprintFromPem(text: string): string {
  const b64 = text.match(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/)![1].replace(/\s+/g, "");
  const hex = createHash("sha256").update(Buffer.from(b64, "base64")).digest("hex").toUpperCase();
  return hex.match(/../g)!.join(":");
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${ms}ms: ${label}`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** Real handshake; the client accepts the server ONLY if its leaf fingerprint equals `pin`. */
async function handshake(keyPem: string, certPem: string, pin: string): Promise<{ ok: boolean; err?: string; echoed?: string }> {
  const server = tls.createServer({ key: keyPem, cert: certPem }, (s) => s.pipe(s));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  try {
    return await withTimeout(new Promise((resolve) => {
      const c = tls.connect({
        host: "127.0.0.1",
        port,
        ca: certPem,
        checkServerIdentity: (_h, cert) => (cert.fingerprint256 === pin ? undefined : new Error("PIN_MISMATCH")),
      });
      c.once("secureConnect", () => {
        c.write("ping");
        c.once("data", (d) => { c.end(); resolve({ ok: true, echoed: d.toString() }); });
      });
      c.once("error", (e) => resolve({ ok: false, err: e.message }));
    }), 8000, "handshake");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

describe("flags — TLS on unless EXPLICITLY off; plaintext open unless EXPLICITLY off", () => {
  it("MQTT_TLS_ENABLED", () => {
    expect(mqttTlsEnabled({})).toBe(true);
    for (const v of ["false", "0", "off", "no", " OFF ", "False"]) expect(mqttTlsEnabled({ MQTT_TLS_ENABLED: v })).toBe(false);
    for (const v of ["true", "1", "flase", "", "yes"]) expect(mqttTlsEnabled({ MQTT_TLS_ENABLED: v })).toBe(true);
  });
  it("MQTT_PLAIN_ENABLED", () => {
    expect(mqttPlainEnabled({})).toBe(true);
    for (const v of ["false", "0", "off", "no"]) expect(mqttPlainEnabled({ MQTT_PLAIN_ENABLED: v })).toBe(false);
    for (const v of ["true", "typo", ""]) expect(mqttPlainEnabled({ MQTT_PLAIN_ENABLED: v })).toBe(true);
  });
  it("MQTT_TLS_DIR default is <cwd>/data/mqtt-tls (gitignored /data/)", () => {
    expect(mqttTlsDir({})).toBe(path.resolve(process.cwd(), "data", "mqtt-tls"));
    const d = tempDir();
    expect(mqttTlsDir({ MQTT_TLS_DIR: d })).toBe(path.resolve(d));
  });
});

describe("mintSiteBrokerCertificate", () => {
  it("is a parseable ECDSA P-256 self-signed server certificate, valid ~20 years, key matches", () => {
    const { keyPem, certPem } = mintSiteBrokerCertificate({ commonName: "T-J1", days: 7300 });
    const x = new X509Certificate(certPem);
    expect(x.ca).toBe(false);
    expect(x.subject).toContain("CN=T-J1");
    expect(x.issuer).toBe(x.subject);
    expect(x.verify(x.publicKey)).toBe(true);
    expect(x.publicKey.asymmetricKeyType).toBe("ec");
    expect(x.publicKey.asymmetricKeyDetails?.namedCurve).toBe("prime256v1");
    expect(x.keyUsage).toContain("1.3.6.1.5.5.7.3.1"); // extKeyUsage serverAuth
    const years = (new Date(x.validTo).getTime() - Date.now()) / (365.25 * 86_400_000);
    expect(years).toBeGreaterThan(19.9);
    expect(new Date(x.validFrom).getTime()).toBeLessThan(Date.now());
    expect(x.fingerprint256.toUpperCase()).toBe(fingerprintFromPem(certPem));
    expect(keyPem).toContain("BEGIN PRIVATE KEY");
  });

  it("dates from 2050 use GeneralizedTime (still parseable, exact year)", () => {
    const { certPem } = mintSiteBrokerCertificate({ commonName: "T-2050", days: 3650, now: new Date("2049-06-01T00:00:00Z") });
    expect(new Date(new X509Certificate(certPem).validTo).getUTCFullYear()).toBe(2059);
  });

  it("a real TLS handshake succeeds with the right pin and is REFUSED with any other pin", async () => {
    const a = mintSiteBrokerCertificate({ commonName: "T-A", days: 30 });
    const b = mintSiteBrokerCertificate({ commonName: "T-B", days: 30 });
    const pinA = fingerprintFromPem(a.certPem);
    expect(await handshake(a.keyPem, a.certPem, pinA)).toEqual({ ok: true, echoed: "ping" });
    const wrong = await handshake(a.keyPem, a.certPem, fingerprintFromPem(b.certPem));
    expect(wrong.ok).toBe(false);
    expect(wrong.err).toContain("PIN_MISMATCH");
  });
});

describe("loadOrCreateSiteBrokerTls — generated once, stored outside git, never overwritten", () => {
  it("first start generates (0600 file), second start loads the SAME certificate", () => {
    const dir = path.join(tempDir(), "nested", "mqtt-tls");
    const first = loadOrCreateSiteBrokerTls({ dir });
    const file = path.join(dir, SITE_TLS_FILE_NAME);
    expect(first.created).toBe(true);
    expect(first.source).toBe("generated");
    expect(first.file).toBe(file);
    const text = fs.readFileSync(file, "utf8");
    expect(first.fingerprintSha256).toBe(fingerprintFromPem(text));
    expect(first.fingerprintSha256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(dir)).toEqual([SITE_TLS_FILE_NAME]); // no temp file left behind

    const second = loadOrCreateSiteBrokerTls({ dir });
    expect(second.created).toBe(false);
    expect(second.fingerprintSha256).toBe(first.fingerprintSha256);
    expect(fs.readFileSync(file, "utf8")).toBe(text);
  });

  it("a corrupt file ⇒ BrokerTlsError TLS_FILE_CORRUPT and the file is NOT touched", () => {
    const dir = tempDir();
    const file = path.join(dir, SITE_TLS_FILE_NAME);
    fs.writeFileSync(file, "garbage-not-pem");
    expect(() => loadOrCreateSiteBrokerTls({ dir })).toThrow(BrokerTlsError);
    try { loadOrCreateSiteBrokerTls({ dir }); } catch (e) { expect((e as BrokerTlsError).code).toBe("TLS_FILE_CORRUPT"); }
    expect(fs.readFileSync(file, "utf8")).toBe("garbage-not-pem");
  });

  it("a key that does not match the certificate ⇒ TLS_KEY_MISMATCH, file untouched", () => {
    const dir = tempDir();
    const a = mintSiteBrokerCertificate({ commonName: "A", days: 30 });
    const b = mintSiteBrokerCertificate({ commonName: "B", days: 30 });
    const file = path.join(dir, SITE_TLS_FILE_NAME);
    fs.writeFileSync(file, b.keyPem + a.certPem);
    let code = "";
    try { loadOrCreateSiteBrokerTls({ dir }); } catch (e) { code = (e as BrokerTlsError).code; }
    expect(code).toBe("TLS_KEY_MISMATCH");
    expect(fs.readFileSync(file, "utf8")).toBe(b.keyPem + a.certPem);
  });

  it("losing the generation race loads the WINNER's certificate (exclusive link, no overwrite)", () => {
    const dir = tempDir();
    const winner = mintSiteBrokerCertificate({ commonName: "WINNER", days: 30 });
    const file = path.join(dir, SITE_TLS_FILE_NAME);
    const realLink = fs.linkSync;
    const spy = vi.spyOn(fs, "linkSync").mockImplementation((src, dst) => {
      fs.writeFileSync(file, winner.keyPem + winner.certPem); // the other process got there first
      return realLink(src, dst);
    });
    try {
      const got = loadOrCreateSiteBrokerTls({ dir });
      expect(got.created).toBe(false);
      expect(got.fingerprintSha256).toBe(fingerprintFromPem(winner.certPem));
      expect(fs.readFileSync(file, "utf8")).toBe(winner.keyPem + winner.certPem);
      expect(fs.readdirSync(dir)).toEqual([SITE_TLS_FILE_NAME]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("resolveBrokerTls — operator certificate wins; half a config refuses", () => {
  it("MQTT_TLS_CERT + MQTT_TLS_KEY ⇒ that certificate (source configured)", () => {
    const dir = tempDir();
    const c = mintSiteBrokerCertificate({ commonName: "OPERATOR", days: 30 });
    fs.writeFileSync(path.join(dir, "c.pem"), c.certPem);
    fs.writeFileSync(path.join(dir, "k.pem"), c.keyPem);
    const m = resolveBrokerTls({ MQTT_TLS_CERT: path.join(dir, "c.pem"), MQTT_TLS_KEY: path.join(dir, "k.pem"), MQTT_TLS_DIR: dir });
    expect(m.source).toBe("configured");
    expect(m.fingerprintSha256).toBe(fingerprintFromPem(c.certPem));
    expect(fs.existsSync(path.join(dir, SITE_TLS_FILE_NAME))).toBe(false);
  });

  it("only one of MQTT_TLS_CERT / MQTT_TLS_KEY ⇒ TLS_CONFIG_INCOMPLETE (no silent fallback)", () => {
    const dir = tempDir();
    for (const env of [{ MQTT_TLS_CERT: "/x.pem" }, { MQTT_TLS_KEY: "/k.pem" }]) {
      let code = "";
      try { resolveBrokerTls({ ...env, MQTT_TLS_DIR: dir }); } catch (e) { code = (e as BrokerTlsError).code; }
      expect(code).toBe("TLS_CONFIG_INCOMPLETE");
    }
    expect(fs.existsSync(path.join(dir, SITE_TLS_FILE_NAME))).toBe(false);
  });

  it("an unreadable configured file ⇒ TLS_FILE_UNREADABLE", () => {
    const dir = tempDir();
    let code = "";
    try { resolveBrokerTls({ MQTT_TLS_CERT: path.join(dir, "nope.pem"), MQTT_TLS_KEY: path.join(dir, "nope.key") }); } catch (e) { code = (e as BrokerTlsError).code; }
    expect(code).toBe("TLS_FILE_UNREADABLE");
  });

  it("nothing configured ⇒ the generated site certificate in MQTT_TLS_DIR", () => {
    const dir = tempDir();
    const m = resolveBrokerTls({ MQTT_TLS_DIR: dir });
    expect(m.source).toBe("generated");
    expect(m.fingerprintSha256).toBe(fingerprintFromPem(fs.readFileSync(path.join(dir, SITE_TLS_FILE_NAME), "utf8")));
  });
});
