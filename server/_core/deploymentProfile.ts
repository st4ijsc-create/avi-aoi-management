/**
 * Deployment profile resolver — SYNAPSE ADR-007 "collapsible deployment" (doc 33 §3.1 / F1).
 *
 * Resolves, at runtime, WHICH edition this process is running as and WHICH infra profile
 * is in effect, then reports the ACTUAL broker / time-series backing derived from existing
 * configuration. This is purely INFORMATIONAL in F1 — it does NOT change how the broker or
 * DB are selected (those keep reading their own env). It exists so that:
 *   • startup logs and the /edition API can state the deployment shape honestly;
 *   • compose/helm/k3s profiles (deploy/) and the client edition badge share one truth;
 *   • later phases can enforce the infra profile from a single place.
 *
 * Non-breaking: EDITION unset → `site` (full) + whatever infra the env already configures,
 * i.e. identical to today's behavior.
 *
 * Env inputs (all optional):
 *   EDITION           = machine | line | site        (default: site)
 *   INFRA_PROFILE     = embedded | external          (default: edition's default)
 *   EDITION_PROFILE   = true|false                   (F1 flag; when false, resolution is
 *                                                      advisory-only — the default)
 *   UNS_BROKER_URL / EXTERNAL_MQTT_ENABLED           → external broker detected
 *   TSDB_URL                                         → dedicated TimescaleDB detected
 */

import {
  getEdition,
  DEFAULT_EDITION,
  isEditionCode,
  type EditionCode,
  type InfraProfile,
  type Topology,
} from "@shared/editions";

export interface DeploymentProfile {
  /** Resolved edition code. */
  edition: EditionCode;
  /** Edition display name. */
  editionName: string;
  /** Topology hint from the edition descriptor. */
  topology: Topology;
  /** Effective infra profile (INFRA_PROFILE override, else edition default). */
  infraProfile: InfraProfile;
  /** Actual message broker backing, derived from configured env. */
  broker: "embedded-aedes" | "external-emqx";
  /** Actual time-series backing, derived from configured env. */
  timeseries: "dedicated-timescale" | "main-db";
  /** Whether the EDITION_PROFILE flag is on (F1: advisory when false). */
  profileEnforced: boolean;
}

function readEdition(env: NodeJS.ProcessEnv): EditionCode {
  const raw = (env.EDITION ?? "").trim().toLowerCase();
  return isEditionCode(raw) ? raw : DEFAULT_EDITION;
}

function readInfraProfile(env: NodeJS.ProcessEnv, edition: EditionCode): InfraProfile {
  const raw = (env.INFRA_PROFILE ?? "").trim().toLowerCase();
  if (raw === "embedded" || raw === "external") return raw;
  return getEdition(edition).defaultInfraProfile;
}

/**
 * Resolve the deployment profile from environment. Pure w.r.t. the passed `env` (defaults
 * to process.env) so it is unit-testable.
 */
export function resolveDeploymentProfile(env: NodeJS.ProcessEnv = process.env): DeploymentProfile {
  const edition = readEdition(env);
  const desc = getEdition(edition);
  const infraProfile = readInfraProfile(env, edition);

  // Broker: external if a UNS broker URL is configured or external MQTT is enabled.
  const hasExternalBroker =
    (env.UNS_BROKER_URL ?? "").trim().length > 0 ||
    (env.EXTERNAL_MQTT_ENABLED ?? "").trim() === "true";
  const broker: DeploymentProfile["broker"] = hasExternalBroker ? "external-emqx" : "embedded-aedes";

  // Time-series: dedicated TimescaleDB if TSDB_URL is set, else the main DB (degrade path).
  const hasDedicatedTsdb = (env.TSDB_URL ?? "").trim().length > 0;
  const timeseries: DeploymentProfile["timeseries"] = hasDedicatedTsdb
    ? "dedicated-timescale"
    : "main-db";

  return {
    edition,
    editionName: desc.name,
    topology: desc.topology,
    infraProfile,
    broker,
    timeseries,
    profileEnforced: (env.EDITION_PROFILE ?? "").trim() === "true",
  };
}

/** Human-readable one-liner for startup logs. */
export function describeDeployment(profile: DeploymentProfile = resolveDeploymentProfile()): string {
  return (
    `[edition] ${profile.editionName} (${profile.edition}) · topology=${profile.topology} · ` +
    `infra=${profile.infraProfile} · broker=${profile.broker} · ts=${profile.timeseries}` +
    (profile.profileEnforced ? " · EDITION_PROFILE=on" : " · advisory")
  );
}
