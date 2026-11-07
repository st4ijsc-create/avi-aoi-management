/**
 * A2(n) T0 — napMotLan, and the rule it exists for: a module a FOE test mocks is never imported bare by the engine. Two concurrent `import()` of it from one importer lose the mock
 * (vitest 2.1.9, requestWithMock): the later one gets the REAL module, and a fault injected into the mock silently does nothing.
 */
import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { napMotLan } from "./foeNapMotLan";

describe("A2(n) T0 — napMotLan", () => {
  it("concurrent callers share one import, a later caller too", async () => {
    const nap = vi.fn(async () => ({ m: 1 }));
    const lay = napMotLan(nap);
    const [a, b, c] = await Promise.all([lay(), lay(), lay()]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(await lay()).toBe(a);
    expect(nap).toHaveBeenCalledTimes(1);
  });

  it("a failed import is not kept: every caller of that try hears it, the next caller tries again", async () => {
    const nap = vi.fn(async () => ({ m: 1 }));
    nap.mockRejectedValueOnce(new Error("import failed (test)"));
    const lay = napMotLan(nap);
    await expect(Promise.all([lay(), lay()])).rejects.toThrow("import failed");
    expect(nap).toHaveBeenCalledTimes(1);
    expect(await lay()).toEqual({ m: 1 });
    expect(nap).toHaveBeenCalledTimes(2);
  });

  it("★ census: every dynamic import of a module a FOE test mocks goes through napMotLan", () => {
    const tep = readdirSync(__dirname).filter((f) => f.endsWith(".ts"));
    const lamMock = new Set(tep.filter((f) => f.endsWith(".test.ts")).flatMap((f) => [...readFileSync(resolve(__dirname, f), "utf8").matchAll(/vi\.mock\("([^"]+)"/g)].map((m) => m[1]!)));
    const sai: string[] = [];
    let quaNap = 0;
    for (const f of tep.filter((x) => !x.endsWith(".test.ts"))) {
      for (const dong of readFileSync(resolve(__dirname, f), "utf8").split("\n")) {
        if (/^\s*(\*|\/\/|\/\*)/.test(dong)) continue;
        for (const m of dong.matchAll(/(typeof |napMotLan\(\(\) => )?import\("([^"]+)"\)/g)) {
          if (m[1] === "typeof ") continue;
          if (m[1]) quaNap++;
          else if (lamMock.has(m[2]!)) sai.push(`${f}: ${m[2]}`);
        }
      }
    }
    expect(sai).toEqual([]);
    // an empty glob must not pass as a clean census
    expect([...lamMock]).toEqual(expect.arrayContaining(["../../ot/commandDispatcher", "../../robot/criticalStopAlert", "../../auditTrailService"]));
    expect(quaNap).toBeGreaterThanOrEqual(10);
  });
});
