/**
 * doc 81 Đợt 10 task D (design §2.12, re-review N3) — which robots a process connects to (`_test`, avi_app, rolled back):
 *   • CENTRAL (no scope) skips robots an edge node OWNS (robots.edgeNodeId, mig 0374): one owner = one session / ingest / lock;
 *   • a scope (the DB-backed edge, kept one release) REQUIRES its factory: line codes are unique only per workshop, so line codes
 *     without a factory load NOTHING (N3; before, every factory's line of that code); with the factory, only that factory's.
 */
import { describe, it, expect, vi } from "vitest";
import { sql } from "drizzle-orm";

const H = vi.hoisted(() => ({ tx: null as any }));
vi.mock("../../db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db/connection")>();
  return { ...actual, getDb: vi.fn(async () => H.tx ?? actual.getDb()) };
});
vi.mock("./driverRegistry", () => ({ createRobotDriver: () => ({ vendor: "sim" }) }));

import { getDb } from "../../db/connection";
import { loadEnabledRobots } from "./robotAdapter";

const onTest = /_test\b/.test(process.env.DATABASE_URL ?? "");
const T = `D10O-${Date.now()}`;
class Rollback extends Error {}
const one = async (tx: any, q: ReturnType<typeof sql>) => Number(((await tx.execute(q)) as Array<Record<string, any>>)[0].id);

describe.skipIf(!onTest)("robot load scope + edge ownership (_test, rolled back)", () => {
  it("★ central skips edge-owned robots; ★ N3 a scope without its factory loads nothing; with it, only that factory's line", async () => {
    const d = (await getDb())!;
    try {
      await d.transaction(async (tx) => {
        H.tx = tx;
        try {
          const facA = await one(tx, sql`INSERT INTO factories (code, name) VALUES (${`${T}-FA`}, 'a') RETURNING id`);
          const facB = await one(tx, sql`INSERT INTO factories (code, name) VALUES (${`${T}-FB`}, 'b') RETURNING id`);
          const wsA = await one(tx, sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${facA}, ${`${T}-WA`}, 'w') RETURNING id`);
          const wsB = await one(tx, sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${facB}, ${`${T}-WB`}, 'w') RETURNING id`);
          const lA = await one(tx, sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${wsA}, ${`${T}-L1`}, 'l') RETURNING id`);
          const lB = await one(tx, sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${wsB}, ${`${T}-L1`}, 'l') RETURNING id`);
          const rA = await one(tx, sql`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled", "lineId") VALUES (${`${T}-RA`}, 'a', 'sim', 'sim://a', true, ${lA}) RETURNING id`);
          const rB = await one(tx, sql`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled", "lineId") VALUES (${`${T}-RB`}, 'b', 'sim', 'sim://b', true, ${lB}) RETURNING id`);
          const rE = await one(tx, sql`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled", "lineId") VALUES (${`${T}-RE`}, 'e', 'sim', 'sim://e', true, ${lA}) RETURNING id`);
          const node = await one(tx, sql`INSERT INTO edge_nodes (code, name, status) VALUES (${`${T}-N`}, 'n', 'offline') RETURNING id`);
          await tx.execute(sql`UPDATE robots SET "edgeNodeId" = ${node} WHERE id = ${rE}`);
          const mine = (rs: Array<{ id: number }>) => rs.map((r) => r.id).filter((id) => [rA, rB, rE].includes(id)).sort((a, b) => a - b);

          expect(mine(await loadEnabledRobots())).toEqual([rA, rB].sort((a, b) => a - b)); // central: rE (edge-owned) skipped
          expect(mine(await loadEnabledRobots({ lineCodes: [`${T}-L1`], factoryCode: null }))).toEqual([]); // N3
          expect(mine(await loadEnabledRobots({ lineCodes: [`${T}-L1`], factoryCode: "  " }))).toEqual([]); // N3 (blank)
          expect(mine(await loadEnabledRobots({ lineCodes: [`${T}-L1`], factoryCode: `${T}-FA` }))).toEqual([rA, rE].sort((a, b) => a - b));
          expect(mine(await loadEnabledRobots({ lineCodes: [`${T}-L1`], factoryCode: `${T}-FB` }))).toEqual([rB]);
        } finally {
          H.tx = null;
        }
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
  });
});
