/**
 * doc 44 W6-3 — security tests: device mTLS option/admission builders (G5.22),
 * secret manager Vault-hit + honest env fallback (G5.23), SIEM RFC5424/webhook
 * formatting + audit mapping (G5.18), anomalous-login scoring (G5.18).
 *
 * All assertions target the PURE cores (no network / no DB) + the flag-OFF
 * bit-compat guarantees.
 */
import { describe, it, expect, beforeEach } from "vitest";

import {
  buildMqttTlsOptions,
  decideMtlsAdmission,
  derToPem,
  mqttMtlsEnabled,
  mqttMtlsMode,
} from "../mqttService";
import {
  getSecret,
  getSecretSync,
  secretManagerEnabled,
  secretManagerConfigured,
  _resetSecretManager,
  _primeSecretBundle,
} from "./secretManager";
import {
  formatRfc5424,
  formatWebhookPayload,
  escapeSdValue,
  deriveSeverity,
  rfc5424Timestamp,
  categorizeAuditAction,
  auditRowToSiemEvent,
  siemExportEnabled,
  type SiemEvent,
} from "./siemExporter";
import {
  scoreLogin,
  deriveHistoryFromAuditRows,
  checkLoginAnomaly,
  anomalousLoginEnabled,
} from "./anomalousLoginDetector";

// ─── G5.22 — MQTT device mTLS option/admission builders ───────────────────────
describe("G5.22 buildMqttTlsOptions — bit-compat OFF, requestCert ON", () => {
  it("mTLS OFF → options are exactly { key, cert } (no requestCert)", () => {
    const opts = buildMqttTlsOptions({ key: "K", cert: "C" }, { mtlsEnabled: false });
    expect(opts).toEqual({ key: "K", cert: "C" });
    expect("requestCert" in opts).toBe(false);
    expect("ca" in opts).toBe(false);
  });

  it("mTLS ON → adds requestCert:true, rejectUnauthorized:false, pinned CA", () => {
    const opts = buildMqttTlsOptions({ key: "K", cert: "C" }, { mtlsEnabled: true, caPems: ["CA-PEM"] });
    expect(opts.requestCert).toBe(true);
    expect(opts.rejectUnauthorized).toBe(false);
    expect(opts.ca).toEqual(["CA-PEM"]);
  });

  it("mTLS ON with no CA → requestCert set but no ca key", () => {
    const opts = buildMqttTlsOptions({ key: "K", cert: "C" }, { mtlsEnabled: true, caPems: [] });
    expect(opts.requestCert).toBe(true);
    expect("ca" in opts).toBe(false);
  });
});

describe("G5.22 decideMtlsAdmission — permissive vs strict", () => {
  it("disabled → always allow (mtls-off)", () => {
    expect(decideMtlsAdmission({ enabled: false, mode: "strict", hasCert: false, certValid: false }))
      .toEqual({ allow: true, reason: "mtls-off" });
  });
  it("valid cert → allow in both modes", () => {
    expect(decideMtlsAdmission({ enabled: true, mode: "strict", hasCert: true, certValid: true }).allow).toBe(true);
    expect(decideMtlsAdmission({ enabled: true, mode: "permissive", hasCert: true, certValid: true }).allow).toBe(true);
  });
  it("no cert → strict rejects, permissive allows(+logs)", () => {
    expect(decideMtlsAdmission({ enabled: true, mode: "strict", hasCert: false, certValid: false }).allow).toBe(false);
    const perm = decideMtlsAdmission({ enabled: true, mode: "permissive", hasCert: false, certValid: false });
    expect(perm.allow).toBe(true);
    expect(perm.reason).toMatch(/permissive/);
  });
  it("invalid cert → strict rejects, permissive allows(+logs)", () => {
    expect(decideMtlsAdmission({ enabled: true, mode: "strict", hasCert: true, certValid: false }).allow).toBe(false);
    expect(decideMtlsAdmission({ enabled: true, mode: "permissive", hasCert: true, certValid: false }).allow).toBe(true);
  });
});

describe("G5.22 helpers", () => {
  it("derToPem wraps DER in PEM armour", () => {
    const pem = derToPem(Buffer.from("hello-world-der-bytes"));
    expect(pem).toMatch(/^-----BEGIN CERTIFICATE-----\n/);
    expect(pem).toMatch(/-----END CERTIFICATE-----\n$/);
  });
  it("flag parsing defaults OFF / permissive", () => {
    expect(mqttMtlsEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(mqttMtlsEnabled({ MQTT_MTLS_ENABLED: "true" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(mqttMtlsMode({} as NodeJS.ProcessEnv)).toBe("permissive");
    expect(mqttMtlsMode({ MQTT_MTLS_MODE: "strict" } as unknown as NodeJS.ProcessEnv)).toBe("strict");
  });
});

// ─── G5.23 — secret manager ───────────────────────────────────────────────────
describe("G5.23 secretManager — Vault-hit + honest env fallback", () => {
  const vaultEnv = {
    SECRET_MANAGER_ENABLED: "true",
    VAULT_ADDR: "http://127.0.0.1:8200",
    VAULT_TOKEN: "test-token",
  } as unknown as NodeJS.ProcessEnv;

  beforeEach(() => _resetSecretManager());

  it("disabled → getSecret reads process.env (bit-compat)", async () => {
    const env = { FOO_SECRET: "from-env" } as unknown as NodeJS.ProcessEnv;
    expect(secretManagerEnabled(env)).toBe(false);
    expect(await getSecret("FOO_SECRET", { env })).toBe("from-env");
    expect(getSecretSync("FOO_SECRET", { env })).toBe("from-env");
  });

  it("enabled+configured with primed bundle → serves the Vault value", async () => {
    expect(secretManagerConfigured(vaultEnv)).toBe(true);
    _primeSecretBundle({ MASTER_API_KEY: "vault-master" }, vaultEnv);
    expect(await getSecret("MASTER_API_KEY", { env: vaultEnv })).toBe("vault-master");
    expect(getSecretSync("MASTER_API_KEY", { env: vaultEnv })).toBe("vault-master");
  });

  it("enabled but key absent from Vault → honest fallback to env", async () => {
    const env = { ...vaultEnv, ONLY_IN_ENV: "env-only" } as unknown as NodeJS.ProcessEnv;
    _primeSecretBundle({ SOMETHING_ELSE: "x" }, env);
    expect(await getSecret("ONLY_IN_ENV", { env })).toBe("env-only");
  });

  it("returns undefined when neither source has the key", async () => {
    _primeSecretBundle({ A: "1" }, vaultEnv);
    expect(await getSecret("MISSING", { env: vaultEnv })).toBeUndefined();
  });
});

// ─── G5.18 — SIEM exporter formatting ─────────────────────────────────────────
describe("G5.18 siemExporter — RFC5424 + webhook + audit mapping", () => {
  const authFail: SiemEvent = {
    ts: Date.parse("2026-07-12T04:05:06.789Z"),
    category: "auth",
    action: "login",
    outcome: "failure",
    actor: "alice",
    ip: "10.0.0.9",
    detail: { reason: "bad_password" },
  };

  it("deriveSeverity maps outcome/category", () => {
    expect(deriveSeverity({ ...authFail, outcome: "deny" })).toBe(4);
    expect(deriveSeverity(authFail)).toBe(4); // auth failure → warning
    expect(deriveSeverity({ ts: 0, category: "actuation", action: "cmd", outcome: "success" })).toBe(5);
    expect(deriveSeverity({ ts: 0, category: "audit", action: "x", outcome: "success" })).toBe(6);
    expect(deriveSeverity({ ...authFail, severity: 3 })).toBe(3); // override wins
  });

  it("formatRfc5424 produces a valid header with computed PRI", () => {
    const line = formatRfc5424(authFail, { appName: "synapse-avi", facility: 13, host: "edge01" });
    // PRI = facility(13)*8 + severity(4) = 108
    expect(line.startsWith("<108>1 2026-07-12T04:05:06.789Z edge01 synapse-avi ")).toBe(true);
    expect(line).toContain("[synEvent@32473 ");
    expect(line).toContain('category="auth"');
    expect(line).toContain('action="login"');
    expect(line).toContain('outcome="failure"');
    expect(line).toContain('reason="bad_password"');
  });

  it("escapeSdValue escapes quote, backslash, bracket", () => {
    expect(escapeSdValue('a"b\\c]d')).toBe('a\\"b\\\\c\\]d');
  });

  it("rfc5424Timestamp is RFC3339 ms UTC", () => {
    expect(rfc5424Timestamp(Date.parse("2026-07-12T04:05:06.789Z"))).toBe("2026-07-12T04:05:06.789Z");
  });

  it("formatWebhookPayload carries the core fields", () => {
    const p = formatWebhookPayload(authFail, { appName: "synapse-avi", facility: 13, host: "edge01" });
    expect(p.category).toBe("auth");
    expect(p.action).toBe("login");
    expect(p.outcome).toBe("failure");
    expect(p.severity).toBe(4);
    expect(p.src_ip).toBe("10.0.0.9");
    expect(p.actor).toBe("alice");
  });

  it("categorizeAuditAction routes actions to categories", () => {
    expect(categorizeAuditAction("login")).toBe("auth");
    expect(categorizeAuditAction("anomalous_login")).toBe("auth");
    expect(categorizeAuditAction("policy.override")).toBe("policy");
    expect(categorizeAuditAction("command.dispatch")).toBe("actuation");
    expect(categorizeAuditAction("interlock_auto_block")).toBe("actuation");
    expect(categorizeAuditAction("config_change")).toBe("config");
    expect(categorizeAuditAction("update", "system_config")).toBe("config");
    expect(categorizeAuditAction("report_generate")).toBe("audit");
  });

  it("auditRowToSiemEvent maps an existing audit_log row (no duplication)", () => {
    const ev = auditRowToSiemEvent({
      action: "login",
      status: "failure",
      userName: "bob",
      ipAddress: "192.168.1.5",
      entityType: "auth",
      details: JSON.stringify({ reason: "unknown_user" }),
      createdAt: new Date("2026-07-12T00:00:00.000Z"),
    });
    expect(ev.category).toBe("auth");
    expect(ev.outcome).toBe("failure");
    expect(ev.actor).toBe("bob");
    expect(ev.ip).toBe("192.168.1.5");
    expect(ev.detail?.reason).toBe("unknown_user");
  });

  it("SIEM export is OFF by default", () => {
    expect(siemExportEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });
});

// ─── G5.18 — anomalous-login scoring ──────────────────────────────────────────
describe("G5.18 anomalousLoginDetector — scoring core", () => {
  const baseHistory = {
    knownIps: ["1.1.1.1"],
    typicalHours: [9, 10, 11],
    recentFailures: 0,
  };

  it("flags a login from a NEW source IP", () => {
    const r = scoreLogin(
      { ip: "9.9.9.9", at: new Date(2026, 0, 1, 10, 0, 0).getTime() },
      baseHistory,
    );
    expect(r.anomalous).toBe(true);
    expect(r.reasons.join(" ")).toMatch(/new source IP/);
  });

  it("flags success after a burst of failures", () => {
    const r = scoreLogin(
      { ip: "1.1.1.1", at: new Date(2026, 0, 1, 10, 0, 0).getTime() },
      { ...baseHistory, recentFailures: 4 },
      { failBurst: 3 },
    );
    expect(r.anomalous).toBe(true);
    expect(r.reasons.join(" ")).toMatch(/failed attempts/);
  });

  it("new IP + unusual hour compound to a higher score", () => {
    const r = scoreLogin(
      { ip: "9.9.9.9", at: new Date(2026, 0, 1, 3, 0, 0).getTime() }, // hour 3 not in [9,10,11]
      baseHistory,
    );
    expect(r.anomalous).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(0.8);
  });

  it("does NOT flag a known IP at a typical hour with no failures", () => {
    const r = scoreLogin(
      { ip: "1.1.1.1", at: new Date(2026, 0, 1, 10, 0, 0).getTime() },
      baseHistory,
    );
    expect(r.anomalous).toBe(false);
    expect(r.reasons).toHaveLength(0);
  });

  it("first-ever login has no baseline → not flagged for new IP", () => {
    const r = scoreLogin(
      { ip: "5.5.5.5", at: new Date(2026, 0, 1, 3, 0, 0).getTime() },
      { knownIps: [], typicalHours: [], recentFailures: 0, firstEverLogin: true },
    );
    expect(r.anomalous).toBe(false);
  });

  it("flags a country change when geo is supplied", () => {
    const r = scoreLogin(
      { ip: "1.1.1.1", at: new Date(2026, 0, 1, 10, 0, 0).getTime(), country: "RU" },
      { ...baseHistory, knownCountries: ["VN"] },
    );
    expect(r.reasons.join(" ")).toMatch(/new country RU/);
  });
});

describe("G5.18 deriveHistoryFromAuditRows + flag-off no-op", () => {
  it("derives known IPs, hours and the current failure streak (newest-first)", () => {
    const rows = [
      { action: "login", status: "failure" as const, ipAddress: "9.9.9.9", createdAt: new Date("2026-07-12T02:00:00Z") },
      { action: "login", status: "failure" as const, ipAddress: "9.9.9.9", createdAt: new Date("2026-07-12T01:59:00Z") },
      { action: "login", status: "success" as const, ipAddress: "1.1.1.1", createdAt: new Date(2026, 0, 1, 9, 0, 0) },
    ];
    const h = deriveHistoryFromAuditRows(rows);
    expect(h.recentFailures).toBe(2);
    expect(h.knownIps).toEqual(["1.1.1.1"]);
    expect(h.typicalHours).toEqual([9]);
    expect(h.firstEverLogin).toBe(false);
  });

  it("checkLoginAnomaly is a no-op when the flag is OFF (no DB touched)", async () => {
    expect(anomalousLoginEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    const res = await checkLoginAnomaly(
      { userId: 1, username: "x", ip: "1.2.3.4" },
      {} as NodeJS.ProcessEnv,
    );
    expect(res.checked).toBe(false);
    expect(res.reason).toBe("flag-off");
    expect(res.anomalous).toBe(false);
  });
});
