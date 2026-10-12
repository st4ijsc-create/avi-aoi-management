/**
 * doc 81 Đợt 10 task E (design §2.15) — the DB trap is only as good as the moment the role is set. Measured:
 *   • server/edge/edgeGatewayMain.ts's FIRST statement-level import is `./edgeRole` (ES imports evaluate in order: nothing —
 *     not dotenv, not the logger, not the runtime — is evaluated before it), and edgeRole.ts imports nothing itself;
 *   • importing edgeRole in a process whose environment says NOTHING about the role (and does carry a DATABASE_URL, as a
 *     mis-configured edge host would) makes getDb / getJobsDb / getReadDb refuse: EDGE_DB_TRAP thrown under
 *     EDGE_DB_TRAP=throw, no Postgres client constructed, no socket opened;
 *   • a .env / environment value AVI_PROCESS_ROLE=central cannot turn the edge back into a DB client.
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const h = vi.hoisted(() => {
  process.env.AVI_PROCESS_ROLE = "central"; // what a wrong .env could say
  process.env.EDGE_DB_TRAP = "throw";
  process.env.DATABASE_URL = "postgres://edge:secret@127.0.0.1:1/never_connect";
  return { pgConstructed: 0 };
});
vi.mock("postgres", () => ({
  default: () => {
    h.pgConstructed++;
    throw new Error("postgres client constructed");
  },
}));

const ROOT = path.resolve(__dirname, "../../..");
const importsOf = (file: string): string[] => {
  const sf = ts.createSourceFile(file, fs.readFileSync(path.join(ROOT, file), "utf8"), ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  return sf.statements.filter(ts.isImportDeclaration).map((d) => (d.moduleSpecifier as ts.StringLiteral).text);
};

describe("doc 81 Đợt 10 E — AVI_PROCESS_ROLE=edge is set by the edge entrypoint before any import", () => {
  it("★ edgeGatewayMain imports ./edgeRole FIRST; edgeRole imports nothing", () => {
    const main = importsOf("server/edge/edgeGatewayMain.ts");
    expect(main.length).toBeGreaterThan(2); // instrument check: the scan sees the real imports
    expect(main[0]).toBe("./edgeRole");
    expect(main).toContain("../services/edge/edgeGatewayRuntime");
    expect(importsOf("server/edge/edgeRole.ts")).toEqual([]);
  });

  it("★ after edgeRole, every DB accessor refuses — even with a DATABASE_URL and a role of 'central' in the environment", async () => {
    const before = await import("../../db/edgeDbTrap");
    expect(before.isEdgeProcessRole()).toBe(false); // instrument check: the environment alone would allow the DB
    await import("../../edge/edgeRole");
    expect(process.env.AVI_PROCESS_ROLE).toBe("edge");
    const conn = await import("../../db/connection");
    for (const acc of [conn.getDb, conn.getJobsDb, conn.getReadDb]) await expect(acc()).rejects.toMatchObject({ code: "EDGE_DB_TRAP" });
    expect(conn.edgeDbTrapCount()).toBe(3);
    expect(h.pgConstructed).toBe(0);
  });
});
