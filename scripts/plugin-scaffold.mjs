#!/usr/bin/env node
/**
 * plugin-scaffold — doc 37 C3 (dev-portal). "Time-to-first-plugin ≤ 1 day."
 *
 * Two subcommands, self-contained Node ESM (no build step — the generated sidecar runs as-is):
 *
 *   node scripts/plugin-scaffold.mjs new <plugin-id> [--protocol=modbus] [--kind=device-connector] [--out=./plugins]
 *       Scaffolds <out>/<plugin-id>/ with plugin.json (manifest + sidecar + signed block for
 *       PLUGIN_DRIVERS), a RUNNABLE sidecar.mjs device-connector skeleton, README.md, and an
 *       .env.snippet you paste into PLUGIN_DRIVERS.
 *
 *   node scripts/plugin-scaffold.mjs certify <path-to-plugin.json> [--live] [--require-signature]
 *       Runs the conformance suite (MVP) over a manifest → pass/fail + per-check table. `--live`
 *       additionally spawns the sidecar and drives the real connect→health→readTags→disconnect RPC.
 *
 * The AUTHORITATIVE conformance logic lives in server/services/plugins/pluginConformance.ts (TS);
 * this CLI mirrors the mechanically-checkable subset so it can run without a TS build. The RPC
 * contract it generates + probes matches server/services/plugins/pluginDriverBridge.ts.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { spawn } from "node:child_process";

const PLUGIN_API_VERSION = "1.0";

// ── arg parsing ────────────────────────────────────────────────────────────────
const [, , cmd, ...rest] = process.argv;
const positionals = rest.filter((a) => !a.startsWith("--"));
const flags = Object.fromEntries(
  rest
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v] = a.slice(2).split("=");
      return [k, v === undefined ? true : v];
    }),
);

function die(msg) {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`);
  process.exit(1);
}
function ok(msg) {
  console.log(`\x1b[32m✓\x1b[0m ${msg}`);
}

const KEBAB = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

// ── `new` ────────────────────────────────────────────────────────────────────
function scaffold() {
  const id = positionals[0];
  if (!id) die("usage: plugin-scaffold new <plugin-id> [--protocol=x] [--kind=device-connector] [--out=./plugins]");
  if (!KEBAB.test(id)) die(`plugin id "${id}" must be kebab-case (a-z, 0-9, '-')`);
  const kind = String(flags.kind ?? "device-connector");
  const protocol = String(flags.protocol ?? id.replace(/[^a-z0-9]+/g, "-"));
  const outRoot = resolve(String(flags.out ?? "./plugins"));
  const dir = join(outRoot, id);
  if (existsSync(dir)) die(`target already exists: ${dir}`);
  mkdirSync(dir, { recursive: true });

  const sidecarPath = join(dir, "sidecar.mjs");
  const manifest = {
    id,
    name: id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    version: "0.1.0",
    apiVersion: `^${PLUGIN_API_VERSION}`,
    kind,
    protocols: [protocol],
    // The auto-form (Đợt-B) renders this JSON-Schema in the Setup Wizard. Edit for your device.
    configSchema: {
      type: "object",
      properties: {
        host: { type: "string", title: "Host / endpoint" },
        port: { type: "number", title: "Port", default: 502 },
      },
      required: ["host"],
    },
    // Least-privilege UNS topic ACL — declare only what the connector needs.
    permissions: {
      publish: [`syn/{site}/{area}/{line}/{cell}/${protocol}-*/telemetry`],
      subscribe: [`syn/{site}/{area}/{line}/{cell}/${protocol}-*/cmd`],
    },
    signaturePresent: false, // sign (Ed25519) + attach an SBOM before production
    description: `Device connector for protocol "${protocol}".`,
    // How the Hub spawns the out-of-process sidecar (also the PLUGIN_DRIVERS shape).
    sidecar: { command: "node", args: [sidecarPath] },
    signed: { pluginId: id, version: "0.1.0", artifactSha256: "", signature: null },
  };

  writeFileSync(join(dir, "plugin.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(sidecarPath, SIDECAR_JS);

  // The PLUGIN_DRIVERS env entry (JSON array element) that registers this as an OT driver.
  const driverEntry = { id, protocol, command: "node", args: [sidecarPath] };
  const envSnippet =
    `# Paste into your environment (JSON array). PLUGIN_DRIVERS_ENABLED=true must also be set.\n` +
    `PLUGIN_DRIVERS='${JSON.stringify([driverEntry])}'\n`;
  writeFileSync(join(dir, ".env.snippet"), envSnippet);
  writeFileSync(join(dir, "README.md"), readme(id, protocol, sidecarPath));

  ok(`scaffolded ${kind} "${id}" (protocol ${protocol}) → ${dir}`);
  console.log("\nNext steps (≤ 1 day to first plugin):");
  console.log(`  1. Edit ${sidecarPath} — replace the simulated device with your vendor I/O.`);
  console.log(`  2. Smoke-test the RPC:   node scripts/plugin-scaffold.mjs certify ${join(dir, "plugin.json")} --live`);
  console.log(`  3. Register the driver:  set PLUGIN_DRIVERS_ENABLED=true and PLUGIN_DRIVERS (see .env.snippet).`);
  console.log(`  4. Sign + attach an SBOM, then submit for certification.\n`);
}

// ── `certify` ──────────────────────────────────────────────────────────────────
async function certify() {
  const p = positionals[0];
  if (!p) die("usage: plugin-scaffold certify <path-to-plugin.json> [--live] [--require-signature]");
  const path = resolve(p);
  if (!existsSync(path)) die(`manifest not found: ${path}`);
  let m;
  try {
    m = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    die(`plugin.json is not valid JSON: ${e.message}`);
  }
  const requireSignature = Boolean(flags["require-signature"]);
  const checks = staticChecks(m, requireSignature);

  if (flags.live) {
    if (m.kind !== "device-connector" || !m.sidecar?.command) {
      checks.push({ id: "sidecar.spawn", title: "Sidecar spawns", status: "skip", detail: "no sidecar.command / not a device-connector" });
    } else {
      const live = await probeSidecar(m.sidecar);
      checks.push(...live);
    }
  }

  // Report table.
  console.log(`\nConformance report — ${m.id ?? "(unknown)"} (${m.kind ?? "?"})\n`);
  const glyph = { pass: "\x1b[32m✓\x1b[0m", fail: "\x1b[31m✗\x1b[0m", warn: "\x1b[33m▲\x1b[0m", skip: "\x1b[90m∘\x1b[0m" };
  for (const c of checks) {
    console.log(`  ${glyph[c.status]} ${c.id.padEnd(28)} ${c.title}${c.detail ? `\n      → ${c.detail}` : ""}`);
  }
  const failed = checks.filter((c) => c.status === "fail").length;
  const warned = checks.filter((c) => c.status === "warn").length;
  console.log(
    `\n${failed === 0 ? "\x1b[32mCERTIFIED\x1b[0m" : "\x1b[31mNOT CERTIFIED\x1b[0m"} — ${checks.filter((c) => c.status === "pass").length} passed, ${failed} failed, ${warned} warned.\n`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

/** Static suite — mirrors server/services/plugins/pluginConformance.ts runPluginConformance. */
function staticChecks(m, requireSignature) {
  const checks = [];
  const push = (id, title, status, detail) => checks.push({ id, title, status, detail });
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

  const errs = [];
  if (!m.id || !KEBAB.test(m.id)) errs.push("id missing or not kebab-case");
  if (!m.name) errs.push("name missing");
  if (!/^\d+(\.\d+){0,2}$/.test(String(m.version ?? ""))) errs.push("version missing or not SemVer");
  if (!["device-connector", "robot-adapter", "skill", "enterprise-connector", "ai-model", "ui-widget"].includes(m.kind))
    errs.push("kind missing or invalid");
  if (!m.apiVersion) errs.push("apiVersion range missing");
  push("manifest.valid", "Manifest validates against the plugin contract", errs.length === 0 ? "pass" : "fail", errs.join("; ") || undefined);

  const apiOk = typeof m.apiVersion === "string" && satisfies(m.apiVersion, PLUGIN_API_VERSION);
  push("apiVersion.compatible", `apiVersion compatible with Plugin API ${PLUGIN_API_VERSION}`, apiOk ? "pass" : "fail", apiOk ? `declared "${m.apiVersion}"` : `declared "${m.apiVersion ?? "(missing)"}" excludes ${PLUGIN_API_VERSION}`);

  push("configSchema.present", "configSchema is a JSON-Schema object (auto-form renderer)", m.configSchema === undefined ? "warn" : isObj(m.configSchema) ? "pass" : "fail", m.configSchema === undefined ? "no configSchema — the Setup Wizard cannot render a form" : undefined);

  const needsAcl = m.kind === "device-connector" || m.kind === "robot-adapter";
  const hasAcl = m.permissions && ((m.permissions.publish?.length ?? 0) > 0 || (m.permissions.subscribe?.length ?? 0) > 0);
  push("permissions.leastPrivilege", "Declares only the topic ACLs it needs (least privilege)", !needsAcl ? "skip" : hasAcl ? "pass" : "warn", needsAcl && !hasAcl ? "no publish/subscribe ACL declared" : undefined);

  push("signature.present", "Artifact is signed (Ed25519) before production", m.signaturePresent ? "pass" : requireSignature ? "fail" : "warn", m.signaturePresent ? undefined : "unsigned — sign + attach an SBOM before publishing");

  if (m.kind === "device-connector") {
    const runnable = m.sidecar && typeof m.sidecar.command === "string" && m.sidecar.command.length > 0;
    push("sidecar.declared", "Device-connector declares a runnable sidecar command", runnable ? "pass" : "warn", runnable ? undefined : "no sidecar.command — declare one so the bridge can spawn it");
  }
  return checks;
}

/** Minimal SemVer range check (exact / caret / wildcard) — mirrors shared/plugin/manifest.ts. */
function satisfies(range, current) {
  const cur = current.split(".").map(Number);
  const r = range.trim();
  const wild = /^(\d+)\.(x|\*)$/i.exec(r);
  if (wild) return cur[0] === Number(wild[1]);
  if (r.startsWith("^")) {
    const b = r.slice(1).split(".").map(Number);
    return cur[0] === b[0] && (cur[0] > b[0] || cur[1] >= (b[1] ?? 0));
  }
  const ex = r.split(".").map(Number);
  return cur[0] === ex[0] && cur[1] === (ex[1] ?? 0);
}

/** Live probe: spawn the sidecar and drive connect→health→readTags→disconnect JSON-lines RPC. */
function probeSidecar(sidecar) {
  return new Promise((resolveAll) => {
    const checks = [];
    let child;
    try {
      child = spawn(sidecar.command, sidecar.args ?? [], { stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      return resolveAll([{ id: "sidecar.spawn", title: "Sidecar spawns", status: "fail", detail: e.message }]);
    }
    checks.push({ id: "sidecar.spawn", title: "Sidecar spawns", status: "pass" });
    child.stderr.on("data", (d) => process.stderr.write(`[sidecar] ${d}`));

    let nextId = 1;
    let buf = "";
    const pending = new Map();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        const cb = pending.get(msg.id);
        if (cb) {
          pending.delete(msg.id);
          cb(msg);
        }
      }
    });
    const request = (method, params) =>
      new Promise((res, rej) => {
        const id = nextId++;
        const t = setTimeout(() => {
          if (pending.delete(id)) rej(new Error(`timeout: ${method}`));
        }, 5000);
        pending.set(id, (msg) => {
          clearTimeout(t);
          if (msg.error) rej(new Error(msg.error));
          else res(msg.result);
        });
        child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
      });

    (async () => {
      const step = async (id, title, fn) => {
        try {
          await fn();
          checks.push({ id, title, status: "pass" });
        } catch (e) {
          checks.push({ id, title, status: "fail", detail: e.message });
        }
      };
      await step("rpc.connect", "connect() handshake succeeds", () => request("connect", { endpoint: "conformance://probe" }));
      await step("rpc.health", "health() responds", () => request("health"));
      await step("rpc.readTags", "readTags() returns samples", async () => {
        const r = await request("readTags", [{ tagKey: "probe", address: "probe/0", dataType: "float" }]);
        if (!Array.isArray(r)) throw new Error("readTags did not return an array");
        if (r.length > 0 && typeof r[0].tagKey !== "string") throw new Error("sample missing tagKey");
      });
      await step("rpc.disconnect", "disconnect() succeeds", () => request("disconnect"));
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      resolveAll(checks);
    })();
  });
}

// ── generated runnable device-connector sidecar (JS port of deviceConnectorSidecar.ts) ──
const SIDECAR_JS = `#!/usr/bin/env node
/**
 * Generated device-connector sidecar (JSON-lines over stdio). Runnable as-is: \`node sidecar.mjs\`.
 * The Hub speaks: request { id, method, params } -> response { id, result | error }.
 * Methods the bridge calls: connect / readTags / writeTags / health / disconnect.
 * Replace the in-memory simulation with your vendor I/O. NEVER fabricate a write success — throw.
 */
const state = { connected: false, endpoint: null, values: new Map() };

function synthValue(tag) {
  if (state.values.has(tag.tagKey)) return state.values.get(tag.tagKey);
  let h = 0;
  for (const c of String(tag.address ?? "")) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  if (tag.dataType === "bool") return (h & 1) === 1;
  if (tag.dataType === "string") return "sim:" + tag.address;
  return h / 100;
}

function handle(req) {
  const { id, method, params } = req;
  try {
    switch (method) {
      case "connect":
        state.connected = true;
        state.endpoint = (params && params.endpoint) || null;
        // TODO: open your vendor session here; throw to reject.
        return { id, result: { connected: true, endpoint: state.endpoint } };
      case "readTags": {
        if (!state.connected) return { id, error: "not connected" };
        const tags = Array.isArray(params) ? params : [];
        const now = new Date().toISOString();
        return { id, result: tags.map((t) => ({ tagKey: t.tagKey, value: synthValue(t), quality: "good", timestamp: now })) };
      }
      case "writeTags": {
        // WRITE-GATE: reached ONLY via the Hub's gated commandDispatcher.
        if (!state.connected) return { id, error: "not connected" };
        const writes = Array.isArray(params) ? params : [];
        return { id, result: writes.map((w) => { state.values.set(w.tagKey, w.value ?? null); return { tagKey: w.tagKey, ok: true }; }) };
      }
      case "health":
        return { id, result: { connected: state.connected, latencyMs: 1 } };
      case "disconnect":
        state.connected = false;
        state.endpoint = null;
        return { id, result: { connected: false } };
      default:
        return { id, error: "unknown method: " + method };
    }
  } catch (err) {
    return { id, error: (err && err.message) || String(err) };
  }
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try { process.stdout.write(JSON.stringify(handle(JSON.parse(line))) + "\\n"); } catch { /* ignore malformed line */ }
  }
});
`;

function readme(id, protocol, sidecarPath) {
  return `# ${id} — device-connector plugin

Scaffolded by \`plugin-scaffold\` (doc 37 C3). Speaks the Hub's stdio JSON-lines RPC
(see \`server/services/plugins/pluginDriverBridge.ts\`).

## RPC contract
| method | params | result |
| --- | --- | --- |
| \`connect\` | \`OtConnectionConfig\` | any |
| \`readTags\` | \`OtTagAddress[]\` | \`{ tagKey, value, quality?, timestamp? }[]\` |
| \`writeTags\` | \`OtWrite[]\` | \`{ tagKey, ok, error? }[]\` (via dispatcher only) |
| \`health\` | — | \`{ connected?, latencyMs? }\` |
| \`disconnect\` | — | any |

## Quickstart (≤ 1 day)
1. Edit \`sidecar.mjs\` — replace the simulated device with your vendor I/O for protocol \`${protocol}\`.
2. Smoke-test:  \`node scripts/plugin-scaffold.mjs certify plugin.json --live\`
3. Register (turns this into a live OT driver):
   \`\`\`
   set PLUGIN_DRIVERS_ENABLED=true
   # paste .env.snippet → PLUGIN_DRIVERS
   \`\`\`
4. Sign (Ed25519) + attach an SBOM, then certify for production:
   \`node scripts/plugin-scaffold.mjs certify plugin.json --require-signature\`

## Safety
Writes reach \`writeTags\` ONLY through the Hub's commandDispatcher (HITL / commissioning /
interlock gates). Never add a side-channel write. On a fault, throw — never fake success.
`;
}

// ── dispatch ────────────────────────────────────────────────────────────────
if (cmd === "new") scaffold();
else if (cmd === "certify") certify();
else {
  console.log("plugin-scaffold — usage:");
  console.log("  node scripts/plugin-scaffold.mjs new <plugin-id> [--protocol=x] [--kind=device-connector] [--out=./plugins]");
  console.log("  node scripts/plugin-scaffold.mjs certify <path-to-plugin.json> [--live] [--require-signature]");
  process.exit(cmd ? 1 : 0);
}

void dirname; // reserved for future relative-path resolution
