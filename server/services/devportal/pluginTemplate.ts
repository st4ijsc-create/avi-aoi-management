/**
 * `synapse plugin new` template generator — SYNAPSE §6.4.5 / DX attribute (doc 33 §3.8 / P6).
 *
 * Generates a starter plugin manifest + a conformance checklist for each extension point so a
 * third-party dev reaches "first plugin" in ≤ 1 day (KPI time-to-first-plugin). Pure. Consumed by
 * the Developer Portal (serve) + a future CLI. Reuses the F2 manifest contract.
 */
import { PLUGIN_API_VERSION, type PluginKind, type PluginManifest } from "@shared/plugin/manifest";

/** A ready-to-edit manifest scaffold for a new plugin of the given kind. */
export function newPluginManifest(id: string, kind: PluginKind): PluginManifest {
  const base: PluginManifest = {
    id,
    name: id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    version: "0.1.0",
    apiVersion: `^${PLUGIN_API_VERSION}`,
    kind,
    signaturePresent: false, // sign before publishing to production
    description: `TODO: describe this ${kind}.`,
  };
  if (kind === "device-connector" || kind === "robot-adapter") {
    base.protocols = ["TODO-protocol"];
    base.configSchema = { type: "object", properties: { host: { type: "string" }, port: { type: "number" } }, required: ["host"] };
    base.permissions = { publish: ["syn/{site}/{area}/{line}/{cell}/vendor-*/telemetry"], subscribe: ["syn/{site}/{area}/{line}/{cell}/vendor-*/cmd"] };
  }
  return base;
}

/** The conformance suite a plugin must pass before certification (SDD §6.4.5). */
export function conformanceChecklist(kind: PluginKind): string[] {
  const common = [
    "Manifest validates + apiVersion is compatible with the Hub",
    "configSchema is valid JSON-Schema (the Setup Wizard renders it)",
    "Declares only the topic ACLs it needs (least privilege)",
    "Signed (Ed25519) + SBOM attached before production",
    "Drains cleanly within 30s; a crash is isolated (does not affect the Hub)",
  ];
  const byKind: Partial<Record<PluginKind, string[]>> = {
    "device-connector": [
      "Connect / disconnect / reconnect (LWT + Birth/Death) behave correctly",
      "Tag→UNS mapping carries unit + quality code; payload passes the schema registry",
      "Store-and-forward preserves order across a broker outage (no loss / no dup)",
    ],
    "robot-adapter": [
      "Passes the 4-point + dock/undock + loss-of-connection onboarding test",
      "Normalizes to the VDA 5050-like order/state/factsheet/instantActions model",
    ],
    "enterprise-connector": ["Maps to/from the ISA-95 canonical model behind an anti-corruption layer"],
    "ai-model": ["Ships a model card + input/output schema + declared action bounds"],
  };
  return [...common, ...(byKind[kind] ?? [])];
}

/** The six extension points a plugin may implement. */
export const EXTENSION_POINTS: { kind: PluginKind; title: string; contract: string }[] = [
  { kind: "device-connector", title: "Device Connector", contract: "Connector SDK: Discover/Configure/Validate/Run/Drain + tag→UNS mapping" },
  { kind: "robot-adapter", title: "Robot Adapter", contract: "VDA 5050-like order/state/factsheet/instantActions" },
  { kind: "skill", title: "Skill Plugin", contract: "Skill descriptor: params + preconditions + compensate action" },
  { kind: "enterprise-connector", title: "Enterprise Connector", contract: "ISA-95 canonical ↔ external via anti-corruption layer" },
  { kind: "ai-model", title: "AI Model Plugin", contract: "Model contract: in/out schema + model card + action bounds" },
  { kind: "ui-widget", title: "UI Widget", contract: "Module federation + design-system component (R3+)" },
];
