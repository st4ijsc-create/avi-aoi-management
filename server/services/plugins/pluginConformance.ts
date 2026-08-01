/**
 * Plugin CONFORMANCE / certification runner (MVP) — doc 37 C3 (dev-portal cap-12).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Runs an automatable conformance suite over ONE plugin manifest → pass/fail, so the Developer
 * Portal (and the `plugin-scaffold certify` CLI) can gate a plugin before it is trusted. Two tiers:
 *
 *   (1) runPluginConformance(manifest)  — PURE static checks (no I/O, never throws):
 *       manifest validates · apiVersion compatible · configSchema renders the Setup Wizard ·
 *       least-privilege topic ACLs · signed-before-production · a device-connector carries a sidecar.
 *
 *   (2) probePluginSidecar(driver)      — OPT-IN live check (spawns the sidecar out-of-process and
 *       drives the real connect → health → readTags → disconnect RPC handshake). This is a runtime
 *       action, invoked ONLY when someone explicitly certifies a plugin — it is NEVER called at boot.
 *
 * `certified` = zero FAIL checks (WARNs are allowed; they flag things to fix before production such
 * as an unsigned artifact). This mirrors the checklist in devportal/pluginTemplate.conformanceChecklist
 * but turns the mechanically-checkable subset into an executable gate.
 * ════════════════════════════════════════════════════════════════════════════
 */
import {
  validateManifest,
  satisfiesApiVersion,
  PLUGIN_API_VERSION,
  type PluginManifest,
} from "@shared/plugin/manifest";
import { hasSidecar, type PluginDriverManifest } from "./pluginDriverManifests";

export type CheckStatus = "pass" | "fail" | "warn" | "skip";

export interface ConformanceCheck {
  id: string;
  title: string;
  status: CheckStatus;
  detail?: string;
}

export interface PluginConformanceReport {
  pluginId: string;
  kind: string;
  /** True when NO check FAILED (warnings are allowed). */
  certified: boolean;
  passed: number;
  failed: number;
  warned: number;
  checks: ConformanceCheck[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Static conformance suite over a manifest. Pure + fail-safe. `requireSignature` (default false)
 * turns the "signed before production" WARN into a hard FAIL (use it when certifying for prod).
 */
export function runPluginConformance(
  manifest: Partial<PluginManifest> | null | undefined,
  opts: { requireSignature?: boolean; current?: string } = {},
): PluginConformanceReport {
  const current = opts.current ?? PLUGIN_API_VERSION;
  const checks: ConformanceCheck[] = [];
  const id = (manifest as PluginManifest)?.id ?? "(unknown)";
  const kind = (manifest as PluginManifest)?.kind ?? "(unknown)";

  // 1 — manifest validates against the contract (id/name/version/kind/apiVersion/permissions).
  const v = validateManifest(manifest, { current, requireSignature: opts.requireSignature });
  checks.push({
    id: "manifest.valid",
    title: "Manifest validates against the plugin contract",
    status: v.ok ? "pass" : "fail",
    detail: v.ok ? undefined : v.errors.join("; "),
  });

  // 2 — apiVersion range is compatible with the Hub's Plugin API (explicit, human-readable check).
  const range = (manifest as PluginManifest)?.apiVersion;
  const apiOk = typeof range === "string" && satisfiesApiVersion(range, current);
  checks.push({
    id: "apiVersion.compatible",
    title: `apiVersion is compatible with Plugin API ${current}`,
    status: apiOk ? "pass" : "fail",
    detail: apiOk ? `declared "${range}"` : `declared "${range ?? "(missing)"}" excludes ${current}`,
  });

  // 3 — configSchema present + a JSON-Schema object → the Setup Wizard auto-renders a form.
  const cfg = (manifest as PluginManifest)?.configSchema;
  checks.push({
    id: "configSchema.present",
    title: "configSchema is a JSON-Schema object (auto-form renderer)",
    status: cfg === undefined ? "warn" : isPlainObject(cfg) ? "pass" : "fail",
    detail:
      cfg === undefined
        ? "no configSchema — the Setup Wizard cannot render a config form"
        : isPlainObject(cfg)
          ? undefined
          : "configSchema must be a JSON-Schema object",
  });

  // 4 — least-privilege topic ACLs (device/robot connectors should declare what they need).
  const needsAcl = kind === "device-connector" || kind === "robot-adapter";
  const perms = (manifest as PluginManifest)?.permissions;
  const hasAcl = !!perms && ((perms.publish?.length ?? 0) > 0 || (perms.subscribe?.length ?? 0) > 0);
  checks.push({
    id: "permissions.leastPrivilege",
    title: "Declares only the topic ACLs it needs (least privilege)",
    status: !needsAcl ? "skip" : hasAcl ? "pass" : "warn",
    detail: needsAcl && !hasAcl ? "no publish/subscribe ACL declared" : undefined,
  });

  // 5 — signed (Ed25519) before production. WARN by default; FAIL when requireSignature is set.
  const signed = Boolean((manifest as PluginManifest)?.signaturePresent);
  checks.push({
    id: "signature.present",
    title: "Artifact is signed (Ed25519) before production",
    status: signed ? "pass" : opts.requireSignature ? "fail" : "warn",
    detail: signed ? undefined : "manifest is unsigned — sign + attach an SBOM before publishing to production",
  });

  // 6 — a device-connector needs a runnable sidecar command to become a real OT driver.
  if (kind === "device-connector") {
    const runnable = hasSidecar(manifest as PluginManifest);
    checks.push({
      id: "sidecar.declared",
      title: "Device-connector declares a runnable sidecar command",
      status: runnable ? "pass" : "warn",
      detail: runnable ? undefined : "no sidecar.command — declare one (PLUGIN_DRIVERS) so the bridge can spawn it",
    });
  }

  return summarize(id, kind, checks);
}

function summarize(pluginId: string, kind: string, checks: ConformanceCheck[]): PluginConformanceReport {
  const passed = checks.filter((c) => c.status === "pass").length;
  const failed = checks.filter((c) => c.status === "fail").length;
  const warned = checks.filter((c) => c.status === "warn").length;
  return { pluginId, kind, certified: failed === 0, passed, failed, warned, checks };
}

/**
 * OPT-IN live check: spawn the plugin's sidecar out-of-process and drive the real RPC handshake
 * (connect → health → readTags → disconnect) the bridge speaks. Returns the per-step checks.
 *
 * RUNTIME NOTE: this spawns a child process, so it is a deliberate action — call it ONLY from an
 * explicit certification flow (CLI / dev-portal button), never at import/boot. Fail-safe: any spawn
 * or RPC error becomes a FAIL check rather than a throw. The child is always killed at the end.
 */
export async function probePluginSidecar(
  manifest: PluginDriverManifest,
  opts: { timeoutMs?: number; sampleTag?: { tagKey: string; address: string; dataType?: string } } = {},
): Promise<ConformanceCheck[]> {
  const checks: ConformanceCheck[] = [];
  if (!hasSidecar(manifest)) {
    return [{ id: "sidecar.spawn", title: "Sidecar spawns", status: "fail", detail: "manifest carries no sidecar.command" }];
  }
  const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : 5000;
  const { spawnSidecarWithTransport } = await import("./sidecar/nodeSpawner");

  type SidecarChild = { handle: { kill: (s?: string) => void }; transport: { request: <T>(m: string, p?: unknown) => Promise<T>; close: () => void } };
  let child: SidecarChild | null = null;
  try {
    child = spawnSidecarWithTransport({ command: manifest.sidecar.command, args: manifest.sidecar.args }) as SidecarChild;
    checks.push({ id: "sidecar.spawn", title: "Sidecar spawns", status: "pass" });
  } catch (err) {
    return [{ id: "sidecar.spawn", title: "Sidecar spawns", status: "fail", detail: (err as Error)?.message ?? String(err) }];
  }

  const transport = child!.transport;
  const step = async (id: string, title: string, fn: () => Promise<unknown>) => {
    try {
      await withTimeout(fn(), timeoutMs);
      checks.push({ id, title, status: "pass" });
    } catch (err) {
      checks.push({ id, title, status: "fail", detail: (err as Error)?.message ?? String(err) });
    }
  };

  await step("rpc.connect", "connect() handshake succeeds", () => transport.request("connect", { endpoint: "conformance://probe" }));
  await step("rpc.health", "health() responds", () => transport.request("health"));
  const tag = opts.sampleTag ?? { tagKey: "probe", address: "probe/0", dataType: "float" };
  await step("rpc.readTags", "readTags() returns samples", async () => {
    const r = (await transport.request<unknown[]>("readTags", [tag])) as Array<{ tagKey?: string }>;
    if (!Array.isArray(r)) throw new Error("readTags did not return an array");
    if (r.length > 0 && typeof r[0]?.tagKey !== "string") throw new Error("sample missing tagKey");
  });
  await step("rpc.disconnect", "disconnect() succeeds", () => transport.request("disconnect"));

  try {
    transport.close();
    child!.handle.kill("SIGTERM");
  } catch {
    /* best-effort teardown */
  }
  return checks;
}

/** Race a promise against a timeout (local copy — avoids importing the quota module's private helper). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    if (typeof (t as NodeJS.Timeout).unref === "function") (t as NodeJS.Timeout).unref();
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Full certification = static suite + (optional) live sidecar probe merged into one report.
 * `live` defaults OFF (static only). Pass `live:true` to also spawn + probe a device-connector.
 */
export async function certifyPlugin(
  manifest: Partial<PluginManifest>,
  opts: { requireSignature?: boolean; live?: boolean; timeoutMs?: number } = {},
): Promise<PluginConformanceReport> {
  const report = runPluginConformance(manifest, { requireSignature: opts.requireSignature });
  if (opts.live && manifest.kind === "device-connector" && hasSidecar(manifest as PluginManifest)) {
    const live = await probePluginSidecar(manifest as PluginDriverManifest, { timeoutMs: opts.timeoutMs });
    report.checks.push(...live);
  }
  return summarize(report.pluginId, report.kind, report.checks);
}
