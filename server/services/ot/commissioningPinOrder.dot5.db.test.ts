/**
 * doc 81 Đợt 5 task F7 (item 31) — a commissioning SIGNATURE and a STOP-PIN change of the same adapter are strictly
 * ordered, and the "re-check commissioning" chip (latestCommissioningRecheck) follows that order — on the REAL `_test` DB.
 *
 * The hole: the chip compared control_audit_log."createdAt" with commissioning_records."createdAt"; both are DEFAULT now()
 * = TRANSACTION START. A pin-change tx that began before the signing tx but committed after it got the earlier stamp ⇒ no
 * chip, although the signer never saw that change. Fix: pg_advisory_xact_lock(<ns>, adapterId) in createRecord and in
 * every pin-change tx (taken after the tag row locks, before reading the signature state), and the pin-change audit
 * records the signature id in force when it was made (afterJson.commissioningSignatureId) — the chip compares ids under
 * that lock, not transaction-start clocks.
 *
 * Interleavings are forced, not hoped for: a raw connection holds the tag row lock (FOR UPDATE) to park the pin-change tx
 * right after its BEGIN; a gate inside recordAuditEvent parks it after its audit insert (before COMMIT). Every wait is
 * bounded by an explicit timer. Oracle: raw SELECTs on a separate `postgres` connection.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import postgres from "postgres";

const gate = vi.hoisted(() => ({ armed: false, reached: null as null | (() => void), release: null as null | Promise<void> }));
vi.mock("../audit/controlAuditService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../audit/controlAuditService")>();
  return {
    ...actual,
    recordAuditEvent: async (...args: Parameters<typeof actual.recordAuditEvent>) => {
      const row = await actual.recordAuditEvent(...args);
      if (gate.armed && args[1].entityType === "device_tag_stop_pin") {
        gate.reached?.();
        await gate.release;
      }
      return row;
    },
  };
});

import { getDb } from "../../db";
import { createRecord, latestCommissioningRecheck, COMMISSIONING_PIN_LOCK_NS } from "./commissioningService";
// doc 81 Đợt 5 task F fix 1 — the CLI importer's pin-clear (scripts/mappings-import.mjs ⇒ goStopPinCliTx) takes the same lock.
import { goStopPinCliTx, COMMISSIONING_PIN_LOCK_NS as CLI_LOCK_NS } from "../../../scripts/lib/stopPinCli.mjs";
import { datStopPin, ghiAuditGoStopPinTx, GO_STOP_PIN_PATCH } from "./stopPin";
import { deviceTags } from "../../../drizzle/schema";
import { eq } from "drizzle-orm";

const DB_URL = process.env.DATABASE_URL;
const RUN = `F7PO${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`;
let sql: ReturnType<typeof postgres>;
const fx = { adapter: 0, tag: 0, user: 0 };
const nguoiSua = () => ({ id: fx.user, name: "F7 probe" });

/** Bounded: resolves "pending" if `p` has not settled within `ms`. */
async function settledWithin<T>(p: Promise<T>, ms: number): Promise<"settled" | "pending"> {
  let t: NodeJS.Timeout | undefined;
  const r = await Promise.race([p.then(() => "settled" as const, () => "settled" as const), new Promise<"pending">((res) => (t = setTimeout(() => res("pending"), ms)))]);
  clearTimeout(t);
  return r;
}
async function within<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, rej) => (t = setTimeout(() => rej(new Error(`${label}: still pending after ${ms} ms`)), ms)))]);
  } finally {
    clearTimeout(t);
  }
}
/** Arms the audit gate: resolves `reached` when the pin-change tx sits after its audit insert, before COMMIT. */
function armGate() {
  let open!: () => void;
  gate.release = new Promise<void>((r) => (open = r));
  const reached = new Promise<void>((r) => (gate.reached = r));
  gate.armed = true;
  return {
    reached,
    open: () => {
      gate.armed = false;
      open();
    },
  };
}
/** Holds the tag row lock on a raw connection (parks a pin-change tx at its FOR UPDATE, right after BEGIN). */
async function holdTagRow() {
  const conn = await sql.reserve();
  await conn`BEGIN`;
  await conn`SELECT id FROM device_tags WHERE id = ${fx.tag} FOR UPDATE`;
  return async () => {
    await conn`COMMIT`;
    conn.release();
  };
}
const xactStartOf = async (tagAuditAfter: number) =>
  (await sql<{ createdAt: Date; afterJson: any }[]>`
    SELECT "createdAt", "afterJson" FROM control_audit_log
     WHERE "entityType" = 'device_tag_stop_pin' AND "entityId" = ${String(fx.tag)} AND id > ${tagAuditAfter} ORDER BY id`);
const maxAuditId = async () =>
  Number((await sql<{ m: number | null }[]>`SELECT max(id)::int AS m FROM control_audit_log`)[0].m ?? 0);

describe.skipIf(!DB_URL || !/_test\b/.test(DB_URL ?? ""))("Đợt 5 F7 — signature vs stop-pin change are strictly ordered (DB _test)", () => {
  // The parked transactions here are deliberate: their lock waits cross the query monitor's slow threshold. Those
  // "[SLOW QUERY]" lines are expected and kept out of the output; any other warning still prints.
  let warnSpy: ReturnType<typeof vi.spyOn> | undefined;
  beforeAll(async () => {
    const realWarn = console.warn.bind(console);
    warnSpy = vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => {
      if (typeof a[0] === "string" && a[0].startsWith("[SLOW QUERY]")) return;
      realWarn(...a);
    });
    sql = postgres(DB_URL!, { max: 4, connect_timeout: 30, onnotice: () => {} });
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
    fx.adapter = await one(sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled")
                               VALUES (${`${RUN}-A`}, 'F7 order', 'stub', 'stub://f7', false) RETURNING id`);
    fx.tag = await one(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled")
                           VALUES (${fx.adapter}, 'stop_cmd', 'DB1.stop', 'bool', true, true) RETURNING id`);
    fx.user = await one(sql`INSERT INTO users ("openId", username, name, role, "isActive")
                            VALUES (${`${RUN}-u`}, ${`${RUN}-u`}, 'F7 signer', 'admin', true) RETURNING id`);
  }, 60_000);

  beforeEach(async () => {
    gate.armed = false;
    await sql`UPDATE device_tags SET stop_value = NULL, stop_pinned_by = NULL, stop_pinned_at = NULL, writable = true, "isEnabled" = true WHERE id = ${fx.tag}`;
    await sql`DELETE FROM commissioning_records WHERE "adapterId" = ${fx.adapter}`;
  });

  afterAll(async () => {
    warnSpy?.mockRestore();
    if (!sql) return;
    gate.armed = false;
    await sql`DELETE FROM commissioning_records WHERE "adapterId" = ${fx.adapter}`;
    await sql`DELETE FROM device_tags WHERE "adapterId" = ${fx.adapter}`;
    await sql`DELETE FROM device_adapters WHERE id = ${fx.adapter}`;
    await sql`DELETE FROM users WHERE id = ${fx.user}`;
    await sql.end({ timeout: 5 });
  });

  it("★ a pin change that BEGAN before the signature but landed after it ⇒ the re-check chip shows (was: earlier tx-start stamp ⇒ no chip)", async () => {
    const before = await maxAuditId();
    const unhold = await holdTagRow();
    // P begins (its now() is stamped) and parks on the tag row lock.
    const p = datStopPin({ adapterId: fx.adapter, tagKey: "stop_cmd", stopValue: false, reason: "F7 P", nguoiSua: nguoiSua(), phamViMay: null });
    await new Promise((r) => setTimeout(r, 150));
    // S signs and COMMITS while P is parked.
    let s: Awaited<ReturnType<typeof createRecord>>;
    try {
      s = await within(createRecord({ adapterId: fx.adapter, signedBy: fx.user, fatReference: `${RUN}-S` }), 5000, "createRecord");
    } finally {
      await unhold();
    }
    const r = await within(p, 5000, "datStopPin");
    expect(r).toMatchObject({ changed: true, commissioningRecheckRequired: true });
    const [audit] = await xactStartOf(before);
    const [rec] = await sql<{ createdAt: Date }[]>`SELECT "createdAt" FROM commissioning_records WHERE id = ${s.id}`;
    expect(audit.createdAt.getTime()).toBeLessThan(rec.createdAt.getTime()); // the race really happened (P's stamp is EARLIER)
    expect(audit.afterJson).toMatchObject({ commissioningRecheckRequired: true, commissioningSignatureId: s.id });
    const chip = await latestCommissioningRecheck(fx.adapter);
    expect(chip).toMatchObject({ signatureId: s.id, tagId: fx.tag }); // the signer never saw this change ⇒ re-check
  }, 30_000);

  it("★ a signature cannot land INSIDE a pin-change tx: createRecord waits until the pin change committed (advisory lock)", async () => {
    const g = armGate();
    // P: lock taken, signature state read (none), audit written — parked BEFORE COMMIT.
    const p = datStopPin({ adapterId: fx.adapter, tagKey: "stop_cmd", stopValue: false, reason: "F7 P2", nguoiSua: nguoiSua(), phamViMay: null });
    await within(g.reached, 5000, "pin-change audit");
    const s = createRecord({ adapterId: fx.adapter, signedBy: fx.user, fatReference: `${RUN}-S2` });
    let early: string;
    try {
      early = await settledWithin(s, 800);
    } finally {
      g.open(); // never leave the pin-change tx parked (it holds the tag row)
    }
    expect(early).toBe("pending"); // the signature waited for the pin change
    expect(await within(p, 5000, "datStopPin")).toMatchObject({ changed: true, commissioningRecheckRequired: false });
    const rec = await within(s, 5000, "createRecord");
    // The signature came after a COMMITTED pin change ⇒ nothing for it to re-check.
    expect(await latestCommissioningRecheck(fx.adapter)).toBeNull();
    expect(rec.status).toBe("active");
  }, 30_000);

  it("the automatic clear path (ghiAuditGoStopPinTx, tag edit) takes the same lock: a signature waits for it too", async () => {
    await sql`UPDATE device_tags SET stop_value = 'false'::jsonb WHERE id = ${fx.tag}`;
    const db = (await getDb())!;
    const g = armGate();
    const p = db.transaction(async (tx) => {
      const [t] = await tx.select().from(deviceTags).where(eq(deviceTags.id, fx.tag)).for("update");
      await tx.update(deviceTags).set({ ...GO_STOP_PIN_PATCH, writable: false }).where(eq(deviceTags.id, fx.tag));
      return ghiAuditGoStopPinTx(tx, { tag: t, nguon: "tag_not_writable", nguoiSua: nguoiSua(), thaoTac: "F7 probe" });
    });
    await within(g.reached, 5000, "auto-clear audit");
    const s = createRecord({ adapterId: fx.adapter, signedBy: fx.user, fatReference: `${RUN}-S3` });
    let early: string;
    try {
      early = await settledWithin(s, 800);
    } finally {
      g.open();
    }
    expect(early).toBe("pending");
    expect(await within(p, 5000, "auto-clear tx")).toEqual({ commissioningRecheckRequired: false });
    await within(s, 5000, "createRecord");
    expect(await latestCommissioningRecheck(fx.adapter)).toBeNull();
  }, 30_000);

  it("F fix 1 — CLI importer pin-clear (goStopPinCliTx): same lock namespace; a signature waits for it; audit stamps the signature in force", async () => {
    expect(CLI_LOCK_NS).toBe(COMMISSIONING_PIN_LOCK_NS);
    await sql`UPDATE device_tags SET stop_value = 'false'::jsonb WHERE id = ${fx.tag}`;
    const s0 = await createRecord({ adapterId: fx.adapter, signedBy: fx.user, fatReference: `${RUN}-C0` });
    const before = await maxAuditId();
    let open!: () => void;
    const parked = new Promise<void>((r) => (open = r));
    let reached!: () => void;
    const atAudit = new Promise<void>((r) => (reached = r));
    const cli = sql.begin(async (tx) => {
      const [row] = await tx`SELECT id, "adapterId", "tagKey", address, "dataType", scale, "offset", writable, "isEnabled", stop_value
                              FROM device_tags WHERE id = ${fx.tag} FOR UPDATE`;
      await goStopPinCliTx(tx, { row, nguon: "tag_not_writable", actorId: fx.user, actorName: "F7 cli" });
      reached();
      await parked; // the CLI transaction sits before COMMIT, holding the lock
    });
    await within(atAudit, 5000, "cli audit");
    const s1 = createRecord({ adapterId: fx.adapter, signedBy: fx.user, fatReference: `${RUN}-C1` });
    let early: string;
    try {
      early = await settledWithin(s1, 800);
    } finally {
      open();
    }
    expect(early).toBe("pending");
    await within(cli, 5000, "cli tx");
    await within(s1, 5000, "createRecord");
    const [audit] = await xactStartOf(before);
    expect(audit.afterJson).toMatchObject({ commissioningRecheckRequired: true, commissioningSignatureId: s0.id, autoClearedBy: "tag_not_writable" });
    expect(await latestCommissioningRecheck(fx.adapter)).toBeNull(); // the newer signature came after the committed clear
  }, 30_000);

  it("a pin change made under a signature, then a NEW signature ⇒ chip shows, then clears (id comparison)", async () => {
    const s1 = await createRecord({ adapterId: fx.adapter, signedBy: fx.user, fatReference: `${RUN}-S4` });
    await datStopPin({ adapterId: fx.adapter, tagKey: "stop_cmd", stopValue: false, reason: "F7 P4", nguoiSua: nguoiSua(), phamViMay: null });
    expect(await latestCommissioningRecheck(fx.adapter)).toMatchObject({ signatureId: s1.id });
    const s2 = await createRecord({ adapterId: fx.adapter, signedBy: fx.user, fatReference: `${RUN}-S5` });
    expect(s2.id).toBeGreaterThan(s1.id);
    expect(await latestCommissioningRecheck(fx.adapter)).toBeNull();
  }, 30_000);
});
