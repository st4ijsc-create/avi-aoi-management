/**
 * doc 81 Đợt 9 task S3 — the EDGE AGENT's configuration from the environment (fail-closed; the node credential ONLY from a
 * file others cannot read).
 *
 * doc 81 Đợt 10 task E — the v1 behaviours this file also measured are GONE with the central DB login: the local check of
 * the workflow row (ID mapping), the local binding digest, the local run status and the run-guard fallback. Their v2
 * successors (offline ⇒ nothing claimed / held, abortRequested ⇒ one local abort, release, interrupted, STOP re-send from the
 * signed sweep picture, claim back-off, the credential never logged) are measured against a fake central in
 * edgeExecutionAgent.dot10.test.ts.
 */
import { describe, it, expect } from "vitest";
import { edgeExecutionConfigFromEnv } from "./edgeExecutionAgent";

const TOKEN = `edn_0123456789ab.${"S".repeat(43)}`;

describe("doc 81 Đợt 9 S3 — the edge agent", () => {
  it("★ config: anything missing ⇒ it does not start (fail-closed); the secret comes ONLY from a file that others cannot read", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = mkdtempSync(path.join(os.tmpdir(), "s9-cred-"));
    try {
      const file = path.join(dir, "node.cred");
      writeFileSync(file, `${TOKEN}\n`, { mode: 0o600 });
      const bad = path.join(dir, "bad.cred");
      writeFileSync(bad, "ak_live_123\n", { mode: 0o600 });
      const good = { EDGE_EXECUTION_ENABLED: "true", FOE_ENABLED: "true", EDGE_RUNTIME_ENABLED: "true", EDGE_CENTRAL_URL: "https://c.example", EDGE_NODE_CREDENTIAL_FILE: file };
      const posix600 = { platform: "linux" as const, stat: async () => ({ mode: 0o100600, isFile: () => true }) };
      const ok = await edgeExecutionConfigFromEnv(good as never, posix600);
      expect("error" in ok ? ok.error : (ok as { credential: string }).credential).toBe(TOKEN);
      for (const k of Object.keys(good)) {
        const env = { ...good, [k]: "" };
        expect("error" in (await edgeExecutionConfigFromEnv(env as never, posix600)), k).toBe(true);
      }
      expect("error" in (await edgeExecutionConfigFromEnv({ ...good, EDGE_NODE_CREDENTIAL_FILE: bad } as never, posix600))).toBe(true);
      expect("error" in (await edgeExecutionConfigFromEnv({ ...good, EDGE_CENTRAL_URL: "ftp://x" } as never, posix600))).toBe(true);
      // the secret in an env var is refused even with a valid file
      expect(await edgeExecutionConfigFromEnv({ ...good, EDGE_NODE_CREDENTIAL: TOKEN } as never, posix600)).toEqual({ error: expect.stringMatching(/not accepted/) });
      // POSIX: group / world bits ⇒ refused
      for (const mode of [0o100644, 0o100640, 0o100604, 0o100660]) {
        const r = await edgeExecutionConfigFromEnv(good as never, { platform: "linux", stat: async () => ({ mode, isFile: () => true }) });
        expect(r, mode.toString(8)).toEqual({ error: expect.stringMatching(/group \/ others/) });
      }
      // Windows: no POSIX mode — accepted with a warning naming the ACL to set
      const warns: string[] = [];
      const w = await edgeExecutionConfigFromEnv(good as never, { platform: "win32", stat: async () => ({ mode: 0o100666, isFile: () => true }), warn: (m) => warns.push(m) });
      expect("error" in w).toBe(false);
      expect(warns.join(" ")).toMatch(/icacls/);
      expect(warns.join(" ")).not.toContain(TOKEN.split(".")[1]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
