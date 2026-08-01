/**
 * Out-of-process plugin sidecar tests — SYNAPSE §6.4.3/§6.4.5 (doc 33 F3 · P4).
 * Lifecycle gate · quota/rate-limit/timeout · watchdog backoff + circuit-break · signature.
 */
import { describe, it, expect } from "vitest";

import { transition, canRun, isServing, type PluginPhase } from "./pluginLifecycle";
import { createBucket, tryConsume, withinBudget, withTimeout, CallTimeoutError } from "./pluginQuota";
import {
  computeBackoffMs,
  decideRestart,
  PluginSupervisor,
  DEFAULT_RESTART_POLICY,
  type ChildHandle,
} from "./pluginSupervisor";
import { verifyPluginSignature, type SignedPlugin } from "./pluginSignature";
import { generateEd25519Keypair, signLicenseEd25519 } from "../../../license/ed25519License";

describe("plugin lifecycle — validate gate", () => {
  it("run is reachable ONLY from validated", () => {
    expect(canRun("validated")).toBe(true);
    for (const p of ["installed", "discovered", "configured", "validating", "failed"] as PluginPhase[]) {
      expect(canRun(p)).toBe(false);
    }
  });
  it("legal transitions succeed, illegal fail", () => {
    expect(transition("installed", "discover").to).toBe("discovered");
    expect(transition("validating", "validate_ok").to).toBe("validated");
    expect(transition("configured", "run").ok).toBe(false); // must validate first
    expect(transition("running", "drain").to).toBe("draining");
  });
  it("only running serves traffic", () => {
    expect(isServing("running")).toBe(true);
    expect(isServing("validated")).toBe(false);
  });
});

describe("plugin quota — rate-limit / budget / timeout", () => {
  it("token bucket consumes + refills", () => {
    const cfg = { capacity: 2, refillPerSec: 1 };
    let st = createBucket(cfg, 0);
    let r = tryConsume(st, cfg, 0);
    expect(r.allowed).toBe(true);
    r = tryConsume(r.state, cfg, 0);
    expect(r.allowed).toBe(true);
    r = tryConsume(r.state, cfg, 0);
    expect(r.allowed).toBe(false); // empty
    r = tryConsume(r.state, cfg, 1000); // +1s → +1 token
    expect(r.allowed).toBe(true);
  });
  it("budget violations detected", () => {
    expect(withinBudget({ cpuMillicores: 400, memoryMiB: 200 }, { cpuMillicores: 500, memoryMiB: 256 }).ok).toBe(true);
    const over = withinBudget({ cpuMillicores: 800, memoryMiB: 300 }, { cpuMillicores: 500, memoryMiB: 256 });
    expect(over.ok).toBe(false);
    expect(over.violations).toHaveLength(2);
  });
  it("withTimeout resolves fast, rejects slow", async () => {
    await expect(withTimeout(Promise.resolve(42), 1000)).resolves.toBe(42);
    await expect(withTimeout(new Promise(() => {}), 10)).rejects.toBeInstanceOf(CallTimeoutError);
  });
});

describe("plugin supervisor — watchdog backoff + circuit-break", () => {
  it("computeBackoffMs is exponential + capped", () => {
    const p = DEFAULT_RESTART_POLICY;
    expect(computeBackoffMs(0, p)).toBe(500);
    expect(computeBackoffMs(1, p)).toBe(1000);
    expect(computeBackoffMs(2, p)).toBe(2000);
    expect(computeBackoffMs(100, p)).toBe(p.maxMs); // capped
  });
  it("decideRestart: clean exit no restart; crash restarts; window opens circuit", () => {
    const p = DEFAULT_RESTART_POLICY;
    expect(decideRestart(0, [], 0, p).restart).toBe(false);
    expect(decideRestart(1, [], 0, p).restart).toBe(true);
    const many = [0, 0, 0, 0, 0]; // 5 restarts in-window
    const d = decideRestart(1, many, 0, p);
    expect(d.restart).toBe(false);
    expect(d.circuitOpen).toBe(true);
  });

  it("restarts a crashing plugin then circuit-breaks, raising an incident", () => {
    // Fake env: exits are triggered manually; scheduler runs immediately.
    let exitCb: ((code: number | null) => void) | undefined;
    const spawn = () => {
      const child: ChildHandle = { pid: 1, kill() {}, onExit: (cb) => (exitCb = cb) };
      return child;
    };
    const schedule = (fn: () => void) => {
      fn(); // fire immediately (deterministic)
      return { cancel() {} };
    };
    const incidents: string[] = [];
    const sup = new PluginSupervisor(
      { pluginId: "vendor-x", command: "node", args: ["x.js"] },
      { spawn, schedule, now: () => 0, onIncident: (id, r) => incidents.push(`${id}:${r}`) },
    );
    sup.start();
    // Crash repeatedly; each crash within the (fixed now=0) window.
    for (let i = 0; i < 6; i++) exitCb?.(1);
    const status = sup.getStatus();
    expect(status.circuitOpen).toBe(true);
    expect(status.restarts).toBe(DEFAULT_RESTART_POLICY.maxRestartsInWindow);
    expect(incidents.length).toBe(1);
  });

  it("clean exit (0) does not restart", () => {
    let exitCb: ((code: number | null) => void) | undefined;
    const spawn = () => ({ pid: 1, kill() {}, onExit: (cb: (c: number | null) => void) => (exitCb = cb) });
    const sup = new PluginSupervisor(
      { pluginId: "p", command: "n", args: [] },
      { spawn, schedule: (fn) => (fn(), { cancel() {} }), now: () => 0 },
    );
    sup.start();
    exitCb?.(0);
    expect(sup.getStatus().restarts).toBe(0);
    expect(sup.getStatus().circuitOpen).toBe(false);
  });
});

describe("plugin signature enforcement", () => {
  const kp = generateEd25519Keypair();
  const base = { pluginId: "vendor-acme", version: "1.4.2", artifactSha256: "abc123" };
  const sign = (claims: object) => signLicenseEd25519(claims, kp.privateKeyPem);

  it("valid signature accepted; tampered/wrong-key rejected", () => {
    const signed: SignedPlugin = { ...base, signature: sign(base) };
    expect(verifyPluginSignature(signed, kp.publicKeyPem, { requireSignature: true }).ok).toBe(true);
    // tampered artifact hash
    const tampered: SignedPlugin = { ...base, artifactSha256: "evil", signature: sign(base) };
    expect(verifyPluginSignature(tampered, kp.publicKeyPem, { requireSignature: true }).ok).toBe(false);
  });
  it("unsigned rejected in production, allowed otherwise", () => {
    const unsigned: SignedPlugin = { ...base };
    expect(verifyPluginSignature(unsigned, kp.publicKeyPem, { requireSignature: true }).ok).toBe(false);
    expect(verifyPluginSignature(unsigned, kp.publicKeyPem, { requireSignature: false }).ok).toBe(true);
  });
});
