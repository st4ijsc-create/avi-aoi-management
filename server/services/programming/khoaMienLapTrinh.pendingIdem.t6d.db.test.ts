/**
 * R1b-2b-2a T6d kd2 (m62) — `requestDeployApproval`: khoá hàng `ai_pending_actions` (`pendingIdem` = `progdeploy-<khoá bên gọi>-<8 hex>`) PHẢI bị chặn ≤ 128
 * (`boundedKey`; cột varchar(128)). Khoá bên gọi dài 128 ký tự là hợp lệ (router `z.string().max(128)`) nhưng khoá thô + tiền tố + hậu tố = 147 ký tự ⇒ nếu bỏ
 * `boundedKey` thì INSERT vỡ varchar(128) và cả giao dịch yêu cầu duyệt bị huỷ.
 *
 * DB `_test` THẬT (vitest.setup ép), mọi thứ trong MỘT giao dịch ROLLBACK (không DELETE / TRUNCATE; không chèn id tường minh).
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { like } from "drizzle-orm";

const H = vi.hoisted(() => ({ tx: null as unknown }));
vi.mock("../../db/connection", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../db/connection")>();
  return {
    ...real,
    getDb: (async () => H.tx ?? null) as typeof real.getDb,
    __realGetDb: real.getDb,
  };
});

import * as conn from "../../db/connection";
import { aiPendingActions, programArtifacts, programBuilds, programDeployments, programProjects } from "../../../drizzle/schema";
import { requestDeployApproval } from "./programmingService";

const DB_URL = process.env.DATABASE_URL;
const DAU = `T6DKD2-${Date.now()}`;
const ROLLBACK = Symbol("rollback");
const realGetDb = (conn as unknown as { __realGetDb: typeof conn.getDb }).__realGetDb;
const REQUESTER = { id: 990_908_001, role: "engineer", name: "kd2-req" };

async function trongGiaoDich(fn: (tx: NonNullable<Awaited<ReturnType<typeof conn.getDb>>>) => Promise<void>): Promise<void> {
  const db = await realGetDb();
  if (!db) throw new Error("no db");
  try {
    await db.transaction(async (tx) => {
      H.tx = tx;
      try {
        await fn(tx as never);
      } finally {
        H.tx = null;
      }
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}

describe.skipIf(!DB_URL)("T6d kd2 — khoá pending-action của yêu cầu duyệt deploy luôn ≤ 128 (DB thật, ROLLBACK)", () => {
  beforeAll(() => {
    expect(DB_URL).toMatch(/_test/);
  });

  it("★ KD-12 (m62) khoá bên gọi dài 128 ký tự ⇒ yêu cầu duyệt KHÔNG vỡ varchar(128); khoá pending lưu ≤ 128, có tiền tố `progdeploy-`; hai yêu cầu khác khoá cho hai khoá pending khác nhau", async () => {
    await trongGiaoDich(async (tx) => {
      const [p] = await tx.insert(programProjects).values({ code: `${DAU}-P`, name: `${DAU} project`, kind: "stub" }).returning();
      const [a] = await tx.insert(programArtifacts).values({ projectId: p!.id, kind: "stub", language: "text", content: "A\nB", version: 1 }).returning();
      const [b] = await tx.insert(programBuilds).values({ artifactId: a!.id, adapterKind: "stub", status: "ok", ok: true, outputRef: "stub://build/2-lines" }).returning();

      const khoaDai = `${DAU}-${"k".repeat(128)}`.slice(0, 127);
      const khoa1 = `${khoaDai}1`;
      const khoa2 = `${khoaDai}2`;
      expect(khoa1).toHaveLength(128);
      expect(`progdeploy-${khoa1}-`.length + 8).toBeGreaterThan(128); // khoá thô + tiền tố + hậu tố THỰC SỰ vượt 128

      const r1 = await requestDeployApproval({ buildId: b!.id, deviceId: 990_908_201, reason: "kd2", idempotencyKey: khoa1 }, REQUESTER);
      const r2 = await requestDeployApproval({ buildId: b!.id, deviceId: 990_908_202, reason: "kd2", idempotencyKey: khoa2 }, REQUESTER);
      expect(r1.status).toBe("awaiting_approval");
      expect(r2.status).toBe("awaiting_approval");

      const dongs = await tx.select().from(programDeployments).where(like(programDeployments.idempotencyKey, `${DAU}-%`));
      expect(dongs).toHaveLength(2);
      const pendingIds = dongs.map((x) => (x.detailJson as { pendingActionId?: string }).pendingActionId);
      expect(pendingIds.every((x) => typeof x === "string")).toBe(true);
      const acts = await tx.select().from(aiPendingActions).where(like(aiPendingActions.idempotencyKey, "progdeploy-%"));
      const cuaTa = acts.filter((x) => pendingIds.includes(x.id));
      expect(cuaTa).toHaveLength(2);
      for (const x of cuaTa) {
        expect(x.idempotencyKey.length).toBeLessThanOrEqual(128);
        expect(x.idempotencyKey.startsWith("progdeploy-")).toBe(true);
      }
      expect(new Set(cuaTa.map((x) => x.idempotencyKey)).size).toBe(2);
    });
  }, 60_000);
});
