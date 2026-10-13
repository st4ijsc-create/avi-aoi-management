/**
 * doc 81 Đợt 10 task F2 — the edge DEPLOYMENT carries no central DB login and no central secret, and it carries every variable
 * the v2 runtime needs (R-10-ad):
 *   • deploy/edge/{docker-compose.edge.yml, docker-compose.edge.execution.yml, Dockerfile.edge, .env.edge.example}: no
 *     DATABASE_URL, JWT_SECRET, SECRET_ENCRYPTION_KEY, PG* connection variable outside comments;
 *   • the base compose file sets EDGE_CENTRAL_URL, EDGE_CENTRAL_NODE_ID, EDGE_CENTRAL_CREDENTIAL_ID (required), the credential and
 *     the keyset pin as file-based secrets (paths only), EDGE_JOURNAL_DIR on the data volume, EDGE_JOURNAL_MAX_BYTES, and
 *     AVI_PROCESS_ROLE=edge;
 *   • every env name the compose file sets for the node protocol is one the runtime actually reads (edgeNodeEnv) — a renamed
 *     variable would make the gateway start NO device;
 *   • the runtime's own parser (edgeNodeEnv) accepts exactly what the compose file + a bundle provide.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const code = (s: string) => s.replace(/\r\n/g, "\n").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n"); // CRLF working copies (autocrlf)
const FILES = ["deploy/edge/docker-compose.edge.yml", "deploy/edge/docker-compose.edge.execution.yml", "deploy/edge/Dockerfile.edge", "deploy/edge/.env.edge.example"];
const FORBIDDEN = /\b(DATABASE_URL|JWT_SECRET|SECRET_ENCRYPTION_KEY|PGHOST|PGUSER|PGPASSWORD|PGDATABASE|MIGRATION_DB_URL|TEST_DATABASE_URL|EDGE_SIGNING_KEY_(PEM|FILE|DIR))\b/;

describe("Đợt 10 F2 — edge deployment: no central DB login / secret, every node-protocol variable", () => {
  for (const f of FILES) {
    it(`${f}: no central DB URL / central secret outside comments`, () => {
      const lines = code(read(f)).split("\n").filter((l) => FORBIDDEN.test(l));
      expect(lines).toEqual([]);
    });
  }

  it("fuse: the forbidden pattern sees the Đợt 9 line it replaces", () => {
    expect(FORBIDDEN.test("      DATABASE_URL: ${DATABASE_URL:?set DATABASE_URL to the central control-plane DB}")).toBe(true);
    expect(FORBIDDEN.test("JWT_SECRET=x")).toBe(true);
    expect(FORBIDDEN.test("EDGE_JOURNAL_DIR: /app/data/edge-journal")).toBe(false);
  });

  it("base compose: node protocol vars, file-based secrets (paths only), journal on the data volume, edge role", () => {
    const base = code(read("deploy/edge/docker-compose.edge.yml"));
    for (const re of [
      /EDGE_CENTRAL_URL: \$\{EDGE_CENTRAL_URL:\?/,
      /EDGE_CENTRAL_NODE_ID: \$\{EDGE_CENTRAL_NODE_ID:\?/,
      /EDGE_CENTRAL_CREDENTIAL_ID: \$\{EDGE_CENTRAL_CREDENTIAL_ID:\?/,
      /EDGE_NODE_CREDENTIAL_FILE: \/run\/secrets\/edge_node_credential/,
      /EDGE_KEYSET_PIN_FILE: \/run\/secrets\/edge_keyset_pin/,
      /EDGE_JOURNAL_DIR: \/app\/data\/edge-journal/,
      /EDGE_JOURNAL_MAX_BYTES: \$\{EDGE_JOURNAL_MAX_BYTES:-\d+\}/,
      /AVI_PROCESS_ROLE: edge/,
      /- edgedata:\/app\/data/,
      /\n {2}edge_keyset_pin:\n\s+file: \$\{EDGE_KEYSET_PIN_HOST_FILE:\?/,
    ]) {
      expect(base, String(re)).toMatch(re);
    }
    expect(base).not.toMatch(/EDGE_GATEWAY_CONFIG_FILE|\.\/config:/); // ignored by the v2 runtime (mapping-as-code is a central CLI, D13)
    expect(read("deploy/edge/Dockerfile.edge")).toMatch(/AVI_PROCESS_ROLE=edge/);
  });

  it("every node-protocol variable the compose file sets is one the runtime reads", () => {
    const rt = read("server/services/edge/edgeGatewayRuntime.ts") + read("server/services/edge/edgeExecutionAgent.ts");
    const base = code(read("deploy/edge/docker-compose.edge.yml"));
    const set = [...base.matchAll(/^\s{6}(EDGE_[A-Z_]+):/gm)].map((m) => m[1]).filter((n) => /^EDGE_(CENTRAL|NODE_CREDENTIAL|KEYSET|JOURNAL)/.test(n));
    expect(set.sort()).toEqual(["EDGE_CENTRAL_CREDENTIAL_ID", "EDGE_CENTRAL_NODE_ID", "EDGE_CENTRAL_URL", "EDGE_JOURNAL_DIR", "EDGE_JOURNAL_MAX_BYTES", "EDGE_KEYSET_PIN_FILE", "EDGE_NODE_CREDENTIAL_FILE"]);
    for (const n of set) expect(rt, n).toContain(`env.${n}`);
  });

  it("the runtime's parser (edgeNodeEnv) accepts what compose + a bundle provide, and refuses when one is missing", async () => {
    const { edgeNodeEnv } = await import("./edgeGatewayRuntime");
    const dir = mkdtempSync(path.join(os.tmpdir(), "f2-env-"));
    try {
      const cred = path.join(dir, "edge-node.cred");
      const pin = path.join(dir, "edge-keyset.json");
      writeFileSync(cred, `edn_0123456789ab.${"A".repeat(43)}\n`);
      chmodSync(cred, 0o600);
      writeFileSync(pin, "{}");
      const env = {
        EDGE_CENTRAL_URL: "https://central.example:3000",
        EDGE_CENTRAL_NODE_ID: "7",
        EDGE_CENTRAL_CREDENTIAL_ID: "11",
        EDGE_NODE_CREDENTIAL_FILE: cred,
        EDGE_KEYSET_PIN_FILE: pin,
        EDGE_JOURNAL_DIR: path.join(dir, "journal"),
        EDGE_JOURNAL_MAX_BYTES: "67108864",
      };
      const ok = await edgeNodeEnv(env as never);
      expect(ok).toMatchObject({ centralUrl: "https://central.example:3000", nodeId: 7, credentialId: 11, journalMaxBytes: 67108864 });
      for (const k of ["EDGE_CENTRAL_URL", "EDGE_CENTRAL_NODE_ID", "EDGE_CENTRAL_CREDENTIAL_ID", "EDGE_NODE_CREDENTIAL_FILE", "EDGE_KEYSET_PIN_FILE"]) {
        const missing = { ...env, [k]: "" };
        expect(await edgeNodeEnv(missing as never), k).toHaveProperty("error");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
