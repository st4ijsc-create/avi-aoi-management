/**
 * Seed plugin manifests for the built-in OT device connectors — SYNAPSE ADR-008 (doc 33 F2).
 *
 * Proves the manifest pattern end-to-end: each in-process OT driver (ot/driverRegistry) now
 * ALSO has a declared manifest with a Zod-derived JSON-Schema config, so the Setup Wizard can
 * auto-generate its config form. Adding a NEW vendor/protocol = add a manifest here (or ship a
 * plugin) — no change to Orchestration/Fleet/UI core. These are `signaturePresent: true`
 * (first-party) so they pass the production signature gate.
 */
import { z } from "zod";
import { zodToConfigForm } from "./configForm";
import type { PluginManifest } from "@shared/plugin/manifest";

/** Common OT connector config → JSON-Schema auto-form. */
const otConnectorConfig = z.object({
  host: z.string().min(1).describe("Địa chỉ thiết bị (IP/hostname)"),
  port: z.number().int().min(1).max(65535).describe("Cổng"),
  unitId: z.number().int().min(0).max(255).optional().describe("Unit/Slave ID (Modbus)"),
  pollIntervalMs: z.number().int().min(100).max(60_000).default(1000).describe("Chu kỳ poll (ms)"),
  timeoutMs: z.number().int().min(100).max(30_000).default(5000).describe("Timeout (ms)"),
  readOnly: z.boolean().default(true).describe("Chỉ đọc (an toàn mặc định)"),
});

const CONFIG_FORM = zodToConfigForm(otConnectorConfig);

interface OtConnectorSeed {
  id: string;
  name: string;
  protocol: string;
  defaultPort: number;
}

const OT_CONNECTORS: readonly OtConnectorSeed[] = [
  { id: "builtin-opcua", name: "OPC UA Connector", protocol: "opcua", defaultPort: 4840 },
  { id: "builtin-modbus", name: "Modbus TCP Connector", protocol: "modbus", defaultPort: 502 },
  { id: "builtin-s7", name: "Siemens S7 Connector", protocol: "s7", defaultPort: 102 },
  {
    id: "builtin-mitsubishi-mc",
    name: "Mitsubishi MC Connector",
    protocol: "mitsubishi-mc",
    defaultPort: 5007,
  },
  { id: "builtin-ethernet-ip", name: "EtherNet/IP Connector", protocol: "ethernet-ip", defaultPort: 44818 },
];

/** Build the first-party OT device-connector manifests. */
export function buildOtConnectorManifests(): PluginManifest[] {
  return OT_CONNECTORS.map((c) => ({
    id: c.id,
    name: c.name,
    version: "1.0.0",
    apiVersion: "^1.0",
    kind: "device-connector" as const,
    protocols: [c.protocol],
    configSchema: CONFIG_FORM,
    permissions: {
      publish: [`syn/{site}/{area}/{line}/{cell}/${c.protocol}-*/telemetry`],
      subscribe: [`syn/{site}/{area}/{line}/{cell}/${c.protocol}-*/cmd`],
    },
    signaturePresent: true, // first-party
    description: `Built-in ${c.name} (default port ${c.defaultPort}). Read-only mặc định; ghi lệnh qua write-gate.`,
  }));
}
