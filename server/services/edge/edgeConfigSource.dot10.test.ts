/**
 * doc 81 Đợt 10 task E (design §2.4, D4, D9) — the edge CONFIG SOURCE against a fake central:
 *   • only a config signed by a trusted key, for THIS node and the PROVISIONED credential, whose hash is the answer's
 *     configHash, is adopted; a refused one leaves the previous verified config in force;
 *   • no rollback below the last ACCEPTED version — also across a restart (config-state.json, R-10-f);
 *   • the encrypted cache (AES-GCM under HKDF(credential)) lets a restarted edge know its devices while central is down — and it
 *     is VERIFIED AGAIN when loaded (a tampered / foreign cache is refused);
 *   • a keyset update chained from a trusted key is accepted, persisted, and replayed at the next boot;
 *   • the runtime adapters are only the node's ENABLED adapters with their ENABLED tags.
 */
import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { EdgeCentralClient } from "./edgeCentralClient";
import { EDGE_CONFIG_CACHE_FILE, EdgeConfigSource, configAdaptersToRuntime, openEdgeConfigCache, sealEdgeConfigCache } from "./edgeConfigSource";
import { FakeCentral, KIT_TOKEN } from "./edgeFakeCentral.testkit";
import { edgeConfigHash } from "./edgeProtocol";
import { generateEdgeSigningKey, signEdgeObject } from "./edgeSigning";

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true }).catch(() => undefined);
});
async function setup(central = new FakeCentral(), dir?: string) {
  const d = dir ?? (await fs.mkdtemp(path.join(os.tmpdir(), "edge-cfg-")));
  if (!dir) dirs.push(d);
  const client = new EdgeCentralClient({ centralUrl: "http://central.test", credential: KIT_TOKEN, requestTimeoutMs: 2_000, fetchImpl: central.fetchImpl, log: () => undefined });
  const src = await EdgeConfigSource.create({ client, pin: central.pin, nodeId: central.nodeId, credentialId: central.credentialId, credential: KIT_TOKEN, dir: d, log: () => undefined });
  return { central, src, dir: d };
}

describe("doc 81 Đợt 10 E — config source: verification", () => {
  it("★ a verified config is adopted; notModified by hash afterwards", async () => {
    const { central, src } = await setup();
    expect(await src.refresh()).toEqual({ ok: true, changed: true, version: 1 });
    expect(src.current()?.node).toMatchObject({ id: 7, credentialId: 31 });
    expect(src.ownsAdapter(21) && src.ownsRobot(12)).toBe(true);
    expect(src.ownsRobot(13)).toBe(false);
    expect(await src.refresh()).toEqual({ ok: true, changed: false, version: 1 });
    expect(central.callsTo("config")[1].body.configHash).toBe(src.hash());
  });

  it("★ refused: attacker key, another node, another credential, a hash that is not the envelope's — the previous config stays", async () => {
    const { central, src } = await setup();
    await src.refresh();
    const before = src.hash();
    const evil = generateEdgeSigningKey().key;
    const cases: Array<[string, () => unknown]> = [
      ["attacker", () => signEdgeObject("config", { ...central.makeConfig({ configVersion: 5 }) }, evil)],
      ["node", () => central.sign("config", central.makeConfig({ configVersion: 5, node: { id: 8, code: "x", credentialId: 31, factoryCode: null, lineCodes: [] } }))],
      ["credential", () => central.sign("config", central.makeConfig({ configVersion: 5, node: { id: 7, code: "x", credentialId: 99, factoryCode: null, lineCodes: [] } }))],
    ];
    for (const [why, make] of cases) {
      const env = make();
      central.handlers.config = () => ({ status: 200, data: { config: env, configHash: edgeConfigHash(env as never) } });
      const r = await src.refresh();
      expect(r.ok, why).toBe(false);
      expect(src.hash(), why).toBe(before);
    }
    const good = central.sign("config", central.makeConfig({ configVersion: 6 }));
    central.handlers.config = () => ({ status: 200, data: { config: good, configHash: "0".repeat(64) } });
    expect(await src.refresh()).toMatchObject({ ok: false, reason: "config_hash_mismatch" });
    expect(src.hash()).toBe(before);
  });

  it("★ no rollback below the last ACCEPTED version — also after a restart", async () => {
    const { central, src, dir } = await setup();
    central.setConfig({});
    central.setConfig({});
    expect(await src.refresh()).toMatchObject({ ok: true, version: 3 });
    const old = central.sign("config", central.makeConfig({ configVersion: 2 }));
    central.handlers.config = () => ({ status: 200, data: { config: old, configHash: edgeConfigHash(old) } });
    expect(await src.refresh()).toMatchObject({ ok: false, reason: "rollback" });
    // restart: a fresh source in the same dir remembers v3
    const again = await setup(central, dir);
    expect(await again.src.refresh()).toMatchObject({ ok: false, reason: "rollback" });
    expect(again.src.current()).toBeNull();
  });
});

describe("doc 81 Đợt 10 E — config source: cache + keyset chain", () => {
  it("★ restart while central is down: the encrypted cache is loaded and VERIFIED again; a tampered / foreign cache is refused", async () => {
    const { central, src, dir } = await setup();
    await src.refresh();
    const raw = await fs.readFile(path.join(dir, EDGE_CONFIG_CACHE_FILE), "utf8");
    expect(raw).not.toContain("plc-21"); // encrypted at rest
    central.down = true;
    const a = await setup(central, dir);
    expect((await a.src.refresh()).ok).toBe(false);
    expect(await a.src.loadCached()).toBe(true);
    expect(a.src.current()?.adapters[0].code).toBe("plc-21");
    // a cache sealed with a forged envelope does not verify
    const evil = generateEdgeSigningKey().key;
    await fs.writeFile(path.join(dir, EDGE_CONFIG_CACHE_FILE), sealEdgeConfigCache(KIT_TOKEN, signEdgeObject("config", central.makeConfig(), evil)));
    const b = await setup(central, dir);
    expect(await b.src.loadCached()).toBe(false);
    // a cache sealed under another credential cannot even be opened
    expect(() => openEdgeConfigCache(`edn_ffffffffffff.${"Q".repeat(43)}`, raw)).toThrow();
  });

  it("★ a keyset update chained from the pinned key is accepted, persisted, and replayed at the next boot (a config signed by the NEW key verifies)", async () => {
    const central = new FakeCentral();
    const { src, dir } = await setup(central);
    await src.refresh();
    const next = generateEdgeSigningKey().key;
    const t = Date.now() - 1_000;
    const ks = signEdgeObject(
      "keyset",
      { v: 1, version: 2, issuedAt: t, keys: [
        { kid: central.key.kid, publicKeyPem: central.key.publicKeyPem, status: "active", notBefore: t - 60_000, notAfter: null },
        { kid: next.kid, publicKeyPem: next.publicKeyPem, status: "active", notBefore: t, notAfter: null },
      ] },
      central.key,
    );
    const cfg = signEdgeObject("config", central.makeConfig({ configVersion: 2, keyset: ks }), next);
    central.handlers.config = () => ({ status: 200, data: { config: cfg, configHash: edgeConfigHash(cfg) } });
    expect(await src.refresh()).toMatchObject({ ok: true, version: 2 });
    expect(src.trust().version).toBe(2);
    const again = await setup(central, dir);
    expect(again.src.trust().version).toBe(2);
  });

  it("runtime adapters: only enabled adapters, only enabled tags", async () => {
    const { central, src } = await setup();
    await src.refresh();
    const c = central.makeConfig();
    c.adapters.push({ ...c.adapters[0], id: 22, code: "off", isEnabled: false });
    c.adapters[0].tags[0].isEnabled = false;
    const rt = configAdaptersToRuntime(c, () => ({}) as never);
    expect(rt.map((a) => a.adapterId)).toEqual([21]);
    expect(rt[0].tags.map((t) => t.tagKey)).toEqual(["run"]);
  });
});
