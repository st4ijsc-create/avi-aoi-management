/**
 * inspection.bulkAcknowledge — doc 27 gap F1 integration tests.
 *
 * Runs against the ISOLATED test DB (vitest.setup.ts rewrites DATABASE_URL to
 * <db>_test — provision once with `npm run test:db:setup`). Tests soft-skip
 * when no DB is reachable.
 *
 * Verifies:
 *  - stamps acknowledgedBy/acknowledgedAt for unacknowledged rows, honest counts
 *  - idempotent: already-acknowledged rows are NOT re-stamped (first acknowledger wins)
 *  - mixed batches report acknowledged / alreadyAcknowledged / notFound separately
 *  - an audit_logs row is written (action inspection.bulkAcknowledge)
 *  - input validation: empty batch and >500 ids rejected; unauthenticated → UNAUTHORIZED
 *  - legacy measurementResult.batchAcknowledge (string ids, used by QualityHome)
 *    delegates to the same idempotent path
 *
 * ⚠ Chạm `_test` (đuôi `.db.test.ts`): `product_inspections` / `audit_logs` là bảng WORM (mig 0224/0279: avi_app KHÔNG có DELETE) ⇒ cách DUY NHẤT để không
 *   để lại hàng là MỘT giao dịch drizzle mở suốt tệp kết thúc bằng ROLLBACK. Router + `createAuditLog` + `locKiemTraTrongPhamVi` đều đọc `getDb` từ
 *   `../db/connection` (mock trả `tx`), không giao dịch riêng / kết nối riêng / hàng đợi ghi nền ⇒ không tự COMMIT. Kỳ vọng các ca giữ nguyên.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { and, eq, gt, inArray, like } from "drizzle-orm";
import { getDb } from "../db/connection";
import { productInspections, auditLogs } from "../../drizzle/schema";
import { inspectionRouter, measurementResultRouter } from "./inspectionRouters";


// ═════════════════════════════════════════════════════════════════
// GIAO DỊCH HOÀN TÁC — mẫu server/db/statisticsScope.test.ts + aiAnalyticsMachineType.db.test.ts
// ═════════════════════════════════════════════════════════════════
// `getDb` (mock) trả về `tx` của MỘT giao dịch drizzle mở suốt tệp; hàm `db.create*` / `createProductInspection` tự mở `transaction(...)`:
// trên `tx` việc đó thành SAVEPOINT (không COMMIT giao dịch ngoài) nên ROLLBACK cuối cùng hoàn tác TẤT CẢ hàng đã chèn.
// Không DELETE, không TRUNCATE, không owner `aoi`. Không có DATABASE_URL ⇒ cả nhóm bị bỏ qua (skipIf).
const DB_URL = process.env.DATABASE_URL;
class HoanTacCuoiTep extends Error {}
const holder: { db: unknown } = { db: null };
vi.mock("../db/connection", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getDb: async () => holder.db,
}));
/** id các hàng đã chèn — để chứng minh (a) ca THẬT SỰ ghi trong giao dịch, (b) sau ROLLBACK không còn hàng nào. */
const daChen: Record<string, number[]> = {};
const ghiNho = (khoa: string, id: number): number => {
  (daChen[khoa] ??= []).push(id);
  return id;
};
let phienGiaoDich: ReturnType<typeof postgres> | null = null;
let moKhoaHoanTac: () => void = () => undefined;
let giaoDichXong: Promise<void> = Promise.resolve();

async function moGiaoDichHoanTac(): Promise<void> {
  phienGiaoDich = postgres(DB_URL!, { max: 1, onnotice: () => undefined });
  const choHoanTac = new Promise<void>((xong) => {
    moKhoaHoanTac = xong;
  });
  await new Promise<void>((sanSang, thatBai) => {
    giaoDichXong = drizzle(phienGiaoDich!)
      .transaction(async (tx) => {
        holder.db = tx;
        sanSang();
        await choHoanTac;
        throw new HoanTacCuoiTep();
      })
      .then(
        () => undefined,
        (e: unknown) => {
          if (!(e instanceof HoanTacCuoiTep)) thatBai(e);
        },
      );
  });
}

beforeAll(async () => {
  if (!DB_URL) return;
  await moGiaoDichHoanTac();
}, 120_000);

afterAll(async () => {
  holder.db = null;
  moKhoaHoanTac();
  await giaoDichXong;
  if (phienGiaoDich) await phienGiaoDich.end({ timeout: 5 });
  // (b) NGOÀI giao dịch, bằng kết nối RIÊNG sau ROLLBACK: mọi hàng của chính lượt này KHÔNG còn. Đếm theo id đã chèn
  // (id từ sequence không tái dùng) nên không nhiễu bởi tệp khác chạy song song.
  if (DB_URL) {
    const ngoai = postgres(DB_URL, { max: 1, onnotice: () => undefined });
    try {
      for (const [bang, cot, ids] of [
        ["product_inspections", "id", daChen.inspectionIds],
      ] as Array<[string, string, number[] | undefined]>) {
        if (!ids || ids.length === 0) continue;
        const n = Number((await ngoai.unsafe(`SELECT count(*)::int AS n FROM ${bang} WHERE "${cot}" = ANY($1::bigint[])`, [ids as never]))[0].n);
        expect(n, `${bang} sau ROLLBACK`).toBe(0);
      }

      const bien = daChen.auditBoundary?.[0] ?? 0;
      const nAudit = Number(
        (await ngoai.unsafe(
          `SELECT count(*)::int AS n FROM audit_logs WHERE id > $1 AND "userId" = ANY($2::bigint[]) AND action = 'inspection.bulkAcknowledge'`,
          [bien as never, [990_001, 990_002] as never],
        ))[0].n,
      );
      expect(nAudit, "audit_logs sau ROLLBACK").toBe(0);
    } finally {
      await ngoai.end({ timeout: 5 });
    }
  }
}, 60_000);

const TEST_USER_ID = 990_001;
const OTHER_USER_ID = 990_002;
const SERIAL_PREFIX = `F1-ACK-${Date.now()}`;

const t = initTRPC.context<any>().create({ transformer: superjson });
const makeInspectionCaller = t.createCallerFactory(inspectionRouter);
const makeMeasurementCaller = t.createCallerFactory(measurementResultRouter);

const caller = makeInspectionCaller({ user: { id: TEST_USER_ID, name: "F1 Tester", role: "admin" } });
const otherCaller = makeInspectionCaller({ user: { id: OTHER_USER_ID, name: "F1 Other", role: "admin" } });
const legacyCaller = makeMeasurementCaller({ user: { id: TEST_USER_ID, name: "F1 Tester", role: "admin" } });
const anonCaller = makeInspectionCaller({ user: null });

let db: Awaited<ReturnType<typeof getDb>>;

async function insertInspection(suffix: string): Promise<number> {
  const [row] = await db!
    .insert(productInspections)
    .values({
      machineId: 1,
      serialNumber: `${SERIAL_PREFIX}-${suffix}`,
      overallResult: "NG",
      originalResult: "NG",
      inspectionTime: new Date(),
    })
    .returning({ id: productInspections.id });
  return ghiNho("inspectionIds", row.id);
}

async function fetchRows(ids: number[]) {
  return db!
    .select({
      id: productInspections.id,
      acknowledgedBy: productInspections.acknowledgedBy,
      acknowledgedAt: productInspections.acknowledgedAt,
    })
    .from(productInspections)
    .where(inArray(productInspections.id, ids));
}

beforeAll(async () => {
  if (!DB_URL) return;
  db = await getDb();
  // Mốc id `audit_logs` đã COMMIT trước giao dịch này (kết nối riêng) — để (b) đếm hàng audit của chính lượt này sau ROLLBACK.
  const ngoai = postgres(DB_URL, { max: 1, onnotice: () => undefined });
  try {
    ghiNho("auditBoundary", Number((await ngoai.unsafe(`SELECT coalesce(max(id) FILTER (WHERE id <= coalesce(pg_sequence_last_value(pg_get_serial_sequence('audit_logs', 'id')::regclass), 0)), 0)::int AS n FROM audit_logs`))[0].n));
  } finally {
    await ngoai.end({ timeout: 5 });
  }
});

describe.skipIf(!DB_URL)("inspection.bulkAcknowledge (integration, isolated test DB)", () => {
  it("stamps acknowledgedBy/acknowledgedAt and returns honest counts", async () => {
    if (!db) return; // no DB in this environment — soft skip
    const ids = [await insertInspection("a1"), await insertInspection("a2"), await insertInspection("a3")];

    const res = await caller.bulkAcknowledge({ ids });
    expect(res).toMatchObject({
      success: true,
      acknowledgedCount: 3,
      alreadyAcknowledgedCount: 0,
      notFoundCount: 0,
    });

    const rows = await fetchRows(ids);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.acknowledgedBy).toBe(TEST_USER_ID);
      expect(r.acknowledgedAt).toBeInstanceOf(Date);
    }
  });

  it("is idempotent — a second acknowledge does NOT re-stamp (first acknowledger wins)", async () => {
    if (!db) return;
    const id = await insertInspection("b1");

    await caller.bulkAcknowledge({ ids: [id] });
    const [first] = await fetchRows([id]);

    const res2 = await otherCaller.bulkAcknowledge({ ids: [id] });
    expect(res2.acknowledgedCount).toBe(0);
    expect(res2.alreadyAcknowledgedCount).toBe(1);

    const [second] = await fetchRows([id]);
    expect(second.acknowledgedBy).toBe(TEST_USER_ID); // NOT overwritten by OTHER_USER_ID
    expect(second.acknowledgedAt?.getTime()).toBe(first.acknowledgedAt?.getTime());
  });

  it("mixed batch: new + already-acknowledged + nonexistent id are counted separately", async () => {
    if (!db) return;
    const ackedId = await insertInspection("c1");
    await caller.bulkAcknowledge({ ids: [ackedId] });
    const freshId = await insertInspection("c2");
    const missingId = 2_000_000_000; // int4-safe, guaranteed absent

    const res = await caller.bulkAcknowledge({ ids: [freshId, ackedId, missingId] });
    expect(res.acknowledgedCount).toBe(1);
    expect(res.alreadyAcknowledgedCount).toBe(1);
    expect(res.notFoundCount).toBe(1);
  });

  it("writes an audit_logs entry with the acknowledge counts", async () => {
    if (!db) return;
    const id = await insertInspection("d1");
    await caller.bulkAcknowledge({ ids: [id] });

    const logs = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "inspection.bulkAcknowledge"), eq(auditLogs.userId, TEST_USER_ID)));
    expect(logs.length).toBeGreaterThanOrEqual(1);

    const withThisId = logs
      .map((l) => (l.details ? JSON.parse(l.details) : null))
      .filter((d) => d && Array.isArray(d.acknowledgedIds) && d.acknowledgedIds.includes(id));
    expect(withThisId).toHaveLength(1);
    expect(withThisId[0].acknowledgedCount).toBe(1);
  });

  it("rejects an empty batch and a batch over the 500 cap", async () => {
    if (!db) return;
    await expect(caller.bulkAcknowledge({ ids: [] })).rejects.toThrow();
    const tooMany = Array.from({ length: 501 }, (_, i) => i + 1);
    await expect(caller.bulkAcknowledge({ ids: tooMany })).rejects.toThrow();
  });

  it("rejects unauthenticated callers", async () => {
    if (!db) return;
    await expect(anonCaller.bulkAcknowledge({ ids: [1] })).rejects.toThrow(/login|UNAUTHORIZED/i);
  });
});

describe.skipIf(!DB_URL)("measurementResult.batchAcknowledge (legacy string-id path, used by QualityHome)", () => {
  it("delegates to the same idempotent path and returns the real updated count", async () => {
    if (!db) return;
    const id = await insertInspection("e1");

    const res = await legacyCaller.batchAcknowledge({ ids: [String(id)] });
    expect(res).toEqual({ success: true, count: 1 });

    const [row] = await fetchRows([id]);
    expect(row.acknowledgedBy).toBe(TEST_USER_ID);

    // Second call: already acknowledged → count 0, row untouched.
    const res2 = await legacyCaller.batchAcknowledge({ ids: [String(id)] });
    expect(res2.count).toBe(0);
  });

  it("rejects non-numeric ids", async () => {
    if (!db) return;
    await expect(legacyCaller.batchAcknowledge({ ids: ["abc"] })).rejects.toThrow();
  });
});

describe.skipIf(!DB_URL)("(a) các ca THẬT SỰ ghi trong giao dịch (đếm qua tx, trước ROLLBACK)", () => {
  it("8 bản ghi kiểm đã chèn + 8 hàng audit_logs `inspection.bulkAcknowledge` của hai người dùng test (đếm hộ từ các ca trên)", async () => {
    // Hàng chèn: a1-a3 (3) + b1 (1) + c1,c2 (2) + d1 (1) + e1 (1) = 8. Lượt gọi hợp lệ có ghi audit: ca1 ×1, ca2 ×2, ca3 ×2, ca4 ×1, legacy ×2 = 8.
    expect(daChen.inspectionIds).toHaveLength(8);
    const hang = await db!.select({ id: productInspections.id }).from(productInspections).where(inArray(productInspections.id, daChen.inspectionIds));
    expect(hang).toHaveLength(8);
    const logs = await db!
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(
        gt(auditLogs.id, daChen.auditBoundary[0]),
        eq(auditLogs.action, "inspection.bulkAcknowledge"),
        inArray(auditLogs.userId, [TEST_USER_ID, OTHER_USER_ID]),
      ));
    expect(logs).toHaveLength(8);
  });
});
