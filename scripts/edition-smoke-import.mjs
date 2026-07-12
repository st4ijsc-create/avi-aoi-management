/**
 * doc 44 §9 / DEVPLAN §9.8 — edition anti-drift SMOKE (import-level, runs under tsx).
 *
 * The heavy docker-compose edition boot lives in .github/workflows/edition-smoke.yml and only
 * runs on deploy/** changes. THIS smoke is the cheap, every-PR guard: it imports the edition
 * resolvers under a given EDITION and asserts the collapsed shape is internally consistent —
 * so a code change that keeps one edition working while silently breaking another fails CI
 * fast, without booting containers.
 *
 * Usage:  EDITION=machine tsx scripts/edition-smoke-import.mjs
 * Exit 0 = consistent, non-zero = drift.
 */
import { resolveDeploymentProfile, describeDeployment } from "../server/_core/deploymentProfile.ts";
import { getEdition } from "../shared/editions.ts";
import {
  isDualPublishEnabled,
  isLegacyDisabled,
  planPublishTopics,
} from "../server/services/mqtt/topicRebrand.ts";

const EXPECTED = {
  machine: { topology: "single-node", infra: "embedded" },
  line: { topology: "line-cluster", infra: "external" },
  site: { topology: "site-ha", infra: "external" },
};

const edition = (process.env.EDITION || "site").trim().toLowerCase();
const failures = [];
const ok = (cond, msg) => {
  if (!cond) failures.push(msg);
};

// 1. Edition descriptor is coherent with the requested EDITION.
const want = EXPECTED[edition];
ok(!!want, `unknown EDITION="${edition}" (expected machine|line|site)`);
if (want) {
  const desc = getEdition(edition);
  ok(desc.code === edition, `descriptor code ${desc.code} !== EDITION ${edition}`);
  ok(desc.topology === want.topology, `topology ${desc.topology} !== ${want.topology}`);
  ok(desc.defaultInfraProfile === want.infra, `infra ${desc.defaultInfraProfile} !== ${want.infra}`);
}

// 2. Runtime deployment-profile resolver agrees with the descriptor (advisory F1 path).
const profile = resolveDeploymentProfile(process.env);
ok(profile.edition === edition, `resolveDeploymentProfile.edition ${profile.edition} !== ${edition}`);
if (want) ok(profile.topology === want.topology, `profile.topology ${profile.topology} !== ${want.topology}`);

// 3. R-3 wire rebrand must be INERT by default in BOTH editions (byte-compatible with field
//    clients until an operator opts in). This catches an accidental flip of the topic default.
ok(isDualPublishEnabled(process.env) === false, "MQTT dual-publish must default OFF");
ok(isLegacyDisabled(process.env) === false, "MQTT legacy-disable must default OFF");
const plan = planPublishTopics("avi/factory/1/errors", "avi", "synapse", process.env);
ok(plan.length === 1 && plan[0] === "avi/factory/1/errors", `default publish plan must be legacy-only, got ${JSON.stringify(plan)}`);

// Report.
console.log(`[edition-smoke] EDITION=${edition} → ${describeDeployment(profile)}`);
if (failures.length) {
  console.error(`[edition-smoke] DRIFT DETECTED (${failures.length}):`);
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}
console.log(`[edition-smoke] OK — ${edition} edition shape is consistent (no drift).`);
