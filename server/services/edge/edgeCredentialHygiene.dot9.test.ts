/**
 * doc 81 Đợt 9 task S fix (security scan "secret-exposure") — INSTRUMENT: no edge node credential can live in the repository.
 *   • no tracked file is a credential file (`*.cred`, anything under deploy/edge/secrets/ but its README);
 *   • git ignores the places an operator might drop one (deploy/edge/secrets/<x>, any *.cred) — measured with `git check-ignore`;
 *   • no tracked non-test file contains a complete node token (`edn_<12 hex>.<43 base64url>`);
 *   • the compose files never carry the secret: the base file has no credential at all, the execution overlay passes only the
 *     PATH of a file-based compose secret (never `EDGE_NODE_CREDENTIAL`, never a bind mount from the repo);
 *   • the agent refuses the secret from an env var (edgeExecutionAgent.dot9.test.ts measures that behaviour).
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const git = (...args: string[]) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const TOKEN = /edn_[0-9a-f]{12}\.[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/;

describe("doc 81 Đợt 9 S — the node credential never lives in the repository", () => {
  const tracked = git("ls-files", "-z").split("\0").filter(Boolean);

  it("★ the scan sees the repo (instrument check)", () => {
    expect(tracked).toContain("deploy/edge/docker-compose.edge.yml");
    expect(tracked.length).toBeGreaterThan(1000);
    expect(TOKEN.test(`edn_0123456789ab.${"A".repeat(43)}`)).toBe(true);
    expect(TOKEN.test("edn_<12 hex>.<43 chars>")).toBe(false);
  });

  it("★ no tracked credential file", () => {
    const bad = tracked.filter((f) => /\.cred$/i.test(f) || (f.startsWith("deploy/edge/secrets/") && f !== "deploy/edge/secrets/README.md"));
    expect(bad).toEqual([]);
  });

  it("★ git ignores the places a credential could be dropped (the README stays tracked)", () => {
    for (const p of ["deploy/edge/secrets/edge-node.cred", "deploy/edge/secrets/anything", "edge-line1.cred", "scripts/new.cred"]) {
      expect(git("check-ignore", "--no-index", p).trim(), p).toBe(p);
    }
    let readmeIgnored = true;
    try {
      git("check-ignore", "--no-index", "deploy/edge/secrets/README.md");
    } catch {
      readmeIgnored = false; // exit 1 ⇔ not ignored
    }
    expect(readmeIgnored).toBe(false);
  });

  it("★ no tracked non-test file holds a complete node token", () => {
    const hits: string[] = [];
    for (const f of tracked) {
      if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(f) || /\.(png|jpe?g|gif|ico|pdf|zip|gz|onnx|bin|woff2?|ttf|apk|exe|dll|pt|gguf)$/i.test(f)) continue;
      let src: string;
      try {
        src = readFileSync(path.join(ROOT, f), "utf8");
      } catch {
        continue; // deleted in the working tree
      }
      if (src.includes("edn_") && TOKEN.test(src)) hits.push(f);
    }
    expect(hits).toEqual([]);
  });

  it("★ compose: the base file carries no credential; the overlay passes only the PATH of a file-based secret", () => {
    const base = readFileSync(path.join(ROOT, "deploy/edge/docker-compose.edge.yml"), "utf8");
    const overlay = readFileSync(path.join(ROOT, "deploy/edge/docker-compose.edge.execution.yml"), "utf8");
    const code = (s: string) => s.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    expect(code(base)).not.toMatch(/EDGE_NODE_CREDENTIAL|\.cred\b|secrets\//);
    expect(code(overlay)).not.toMatch(/EDGE_NODE_CREDENTIAL\s*:/);
    expect(code(overlay)).toMatch(/EDGE_NODE_CREDENTIAL_FILE: \/run\/secrets\/edge_node_credential/);
    expect(code(overlay)).toMatch(/\nsecrets:\n\s+edge_node_credential:\n\s+file: \$\{EDGE_NODE_CREDENTIAL_HOST_FILE:\?/);
    expect(code(overlay)).not.toMatch(/volumes:/); // no bind mount of a credential
  });
});
