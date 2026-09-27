/**
 * doc 81 Đợt 1B Task 12 — cấu hình bảo mật OPC UA (THUẦN) + mật khẩu qua secretBox.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import path from "node:path";

beforeAll(() => {
  process.env.SECRET_ENCRYPTION_KEY = process.env.SECRET_ENCRYPTION_KEY || "task12-unit-test-key";
});

describe("parseOpcuaSecurityOptions", () => {
  it("unconfigured → None/None, explicit:false, trustOnFirstUse:false", async () => {
    const { parseOpcuaSecurityOptions } = await import("./opcuaSecurity");
    expect(parseOpcuaSecurityOptions(undefined)).toEqual({
      securityMode: "None",
      securityPolicy: "None",
      trustOnFirstUse: false,
      explicit: false,
    });
    expect(parseOpcuaSecurityOptions({ userName: "x" }).explicit).toBe(false);
  });

  it("SignAndEncrypt defaults policy to Basic256Sha256; policy alone implies SignAndEncrypt", async () => {
    const { parseOpcuaSecurityOptions } = await import("./opcuaSecurity");
    expect(parseOpcuaSecurityOptions({ securityMode: "SignAndEncrypt" })).toMatchObject({
      securityMode: "SignAndEncrypt",
      securityPolicy: "Basic256Sha256",
      explicit: true,
    });
    expect(parseOpcuaSecurityOptions({ securityPolicy: "Aes256_Sha256_RsaPss" })).toMatchObject({
      securityMode: "SignAndEncrypt",
      securityPolicy: "Aes256_Sha256_RsaPss",
    });
    expect(parseOpcuaSecurityOptions({ securityMode: "sign", securityPolicy: "aes128_sha256_rsaoaep" })).toMatchObject({
      securityMode: "Sign",
      securityPolicy: "Aes128_Sha256_RsaOaep",
    });
    expect(parseOpcuaSecurityOptions({ securityMode: "None" })).toMatchObject({
      securityMode: "None",
      securityPolicy: "None",
      explicit: true,
    });
  });

  it("rejects contradictory / unknown values with a reason", async () => {
    const { parseOpcuaSecurityOptions } = await import("./opcuaSecurity");
    expect(() => parseOpcuaSecurityOptions({ securityMode: "None", securityPolicy: "Basic256Sha256" })).toThrow(/cannot be combined/);
    expect(() => parseOpcuaSecurityOptions({ securityMode: "SignAndEncrypt", securityPolicy: "None" })).toThrow(/requires a securityPolicy/);
    expect(() => parseOpcuaSecurityOptions({ securityMode: "Encrypt" })).toThrow(/securityMode "Encrypt"/);
    expect(() => parseOpcuaSecurityOptions({ securityPolicy: "Basic128Rsa15" })).toThrow(/securityPolicy "Basic128Rsa15"/);
  });

  it("trustOnFirstUse only when explicitly true", async () => {
    const { parseOpcuaSecurityOptions } = await import("./opcuaSecurity");
    expect(parseOpcuaSecurityOptions({ securityMode: "SignAndEncrypt" }).trustOnFirstUse).toBe(false);
    expect(parseOpcuaSecurityOptions({ securityMode: "SignAndEncrypt", trustOnFirstUse: "false" }).trustOnFirstUse).toBe(false);
    expect(parseOpcuaSecurityOptions({ securityMode: "SignAndEncrypt", trustOnFirstUse: true }).trustOnFirstUse).toBe(true);
  });
});

describe("resolveOpcuaPkiDir", () => {
  const saved = process.env.OPCUA_PKI_DIR;
  afterEach(() => {
    if (saved === undefined) delete process.env.OPCUA_PKI_DIR;
    else process.env.OPCUA_PKI_DIR = saved;
  });
  it("defaults to <cwd>/data/opcua-pki; OPCUA_PKI_DIR overrides", async () => {
    const { resolveOpcuaPkiDir } = await import("./opcuaSecurity");
    delete process.env.OPCUA_PKI_DIR;
    expect(resolveOpcuaPkiDir()).toBe(path.resolve(process.cwd(), "data", "opcua-pki"));
    process.env.OPCUA_PKI_DIR = path.join("x", "pki");
    expect(resolveOpcuaPkiDir()).toBe(path.resolve("x", "pki"));
  });
});

describe("resolveOpcuaPassword (secretBox)", () => {
  it("decrypts enc:v1:, passes legacy plaintext, refuses tampered ciphertext", async () => {
    const { encryptSecret } = await import("../../security/secretBox");
    const { resolveOpcuaPassword } = await import("./opcuaSecurity");
    const enc = encryptSecret("s3cret")!;
    expect(enc.startsWith("enc:v1:")).toBe(true);
    expect(resolveOpcuaPassword(enc)).toBe("s3cret");
    expect(resolveOpcuaPassword("legacy-plain")).toBe("legacy-plain");
    expect(resolveOpcuaPassword(undefined)).toBeUndefined();
    const tampered = enc.slice(0, -4) + (enc.endsWith("AAAA") ? "BBBB" : "AAAA");
    expect(() => resolveOpcuaPassword(tampered)).toThrow(/cannot be decrypted/);
    // Không bao giờ để mật khẩu lọt vào thông điệp lỗi.
    try {
      resolveOpcuaPassword(tampered);
    } catch (e) {
      expect(String((e as Error).message)).not.toContain("s3cret");
    }
  });
});

describe("Fix round 1 — R20 posture warnings + TOFU gate", () => {
  it("warnSecurityPostureOnce: once per (kind, endpoint)", async () => {
    const { warnSecurityPostureOnce, __resetOpcuaSecurityWarningForTest } = await import("./opcuaSecurity");
    __resetOpcuaSecurityWarningForTest();
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(warnSecurityPostureOnce("tofu", "opc.tcp://a:4840")).toBe(true);
      expect(warnSecurityPostureOnce("tofu", "opc.tcp://a:4840")).toBe(false);
      expect(warnSecurityPostureOnce("tofu", "opc.tcp://b:4840")).toBe(true);
      expect(warnSecurityPostureOnce("none", "opc.tcp://a:4840")).toBe(true);
      expect(spy).toHaveBeenCalledTimes(3);
      expect(String(spy.mock.calls[0][0])).toMatch(/trustOnFirstUse is ON/);
      expect(String(spy.mock.calls[2][0])).toMatch(/securityMode None set explicitly/);
    } finally {
      spy.mockRestore();
    }
  });

  it("assertTrustOnFirstUseAllowed: only OPCUA_ALLOW_TRUST_ON_FIRST_USE=true|1 permits TOFU", async () => {
    const { assertTrustOnFirstUseAllowed } = await import("./opcuaSecurity");
    const saved = process.env.OPCUA_ALLOW_TRUST_ON_FIRST_USE;
    try {
      delete process.env.OPCUA_ALLOW_TRUST_ON_FIRST_USE;
      expect(() => assertTrustOnFirstUseAllowed(true)).toThrow(/OPCUA_ALLOW_TRUST_ON_FIRST_USE/);
      expect(() => assertTrustOnFirstUseAllowed(false)).not.toThrow();
      process.env.OPCUA_ALLOW_TRUST_ON_FIRST_USE = "yes";
      expect(() => assertTrustOnFirstUseAllowed(true)).toThrow();
      process.env.OPCUA_ALLOW_TRUST_ON_FIRST_USE = "true";
      expect(() => assertTrustOnFirstUseAllowed(true)).not.toThrow();
    } finally {
      if (saved === undefined) delete process.env.OPCUA_ALLOW_TRUST_ON_FIRST_USE;
      else process.env.OPCUA_ALLOW_TRUST_ON_FIRST_USE = saved;
    }
  });
});

describe("warnInsecureDefaultOnce", () => {
  it("logs exactly once per process", async () => {
    const { warnInsecureDefaultOnce, __resetOpcuaSecurityWarningForTest } = await import("./opcuaSecurity");
    __resetOpcuaSecurityWarningForTest();
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(warnInsecureDefaultOnce("opc.tcp://10.0.0.5:4840")).toBe(true);
      expect(warnInsecureDefaultOnce("opc.tcp://10.0.0.6:4840")).toBe(false);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0][0])).toMatch(/SecurityMode None/);
    } finally {
      spy.mockRestore();
    }
  });
});
